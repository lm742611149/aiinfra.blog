---
title: 'Day 550 · 评测统计学(四):样本量和多重比较,怎么跟老板说'
description: '区间画准了,还剩两个问题:这个评测集能测出多小的提升(功效和最小可检测差异,180 条只能测出 6.6 个点以上,想测 3 个点要 869 条),以及报告里同时看六个模块,不校正的话至少一个「显著」的概率是 27.5%(多重比较,Bonferroni 和 Holm)。最后把四天的零件拼成一份对比报告,写出能直接贴进 MR 的话。'
pubDate: 2026-10-27
regime: none
tags: ['eval', 'statistics', 'power', 'sample-size', 'multiple-comparisons', 'python', 'agent-zero']
series: 'agent-zero'
day: 550
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 549](/blog/agent-zero/day-549-eval-stats-3/) 用 bootstrap 给 v1 的通过率和 v2 − v1 的差值算了区间(按场景重抽,和 Day 548 的公式对得上),然后量了 Agent 自己的抖动:同一批工单重跑 15 遍,整套得分的标准差有 3 到 4 个点,`temperature=0` 管不了,每题多跑几遍能压低「重跑」那一块,压不动「换题」那一块。

到今天为止,v2 对比 v1 的结论一直是「区间 [−3.5%, +5.7%],跨过 0,没有结论」。今天的问题是:**没有结论,是 v2 真的没用,还是这个评测集根本没能力测出来?**这是第一个新概念,**功效**。第二个是**多重比较**:报告里不止一个数,看的数越多,碰巧「显著」的概率越大。最后把 Day 547 到今天的零件拼成一份对比报告。

## 今天要解决的问题

学完今天你应该能做到:

1. 解释**功效**(power)和**最小可检测差异**(MDE):手算出这个 180 条的评测集,MDE 是 6.6 个点;如果 v2 真的比 v1 好 3 个点,这个评测集只有 25% 的概率能检测出来。用 2000 次模拟验证公式。
2. 用 `required_n` 算样本量:想检测 3 个点的提升,要 869 条用例(290 个场景 × 3 种说法);并说出配对让这个数字缩小了多少倍(4.5 倍)。
3. 解释**多重比较**:6 个模块的 v1 和 v2 其实完全一样,至少有一个模块「显著」的概率是 27.5%,不是 5%;手写 Bonferroni 和 Holm,用 statsmodels 核对,并手算一个 8 个指标的例子。
4. 把统计结果写成一句给 PM 和老板看的话:有结论、没结论(测不出来)、没变差,三种说法各一个模板,并拼出 `compare_report.py`。

预计用时 3 小时。花费 0 元(今天全部是模拟和计算,不调模型)。前置:[Day 547](/blog/agent-zero/day-547-eval-stats-1/)(`stats.py`、`runs.json`)、[Day 548](/blog/agent-zero/day-548-eval-stats-2/)(`clustered_se`、`paired_diff`、`mcnemar_exact`、`wilson_ci_cluster`)、[Day 549](/blog/agent-zero/day-549-eval-stats-3/)(`bootstrap_ci`)。今天要装一个只用来对答案的包:`uv add --dev statsmodels`(我装到 0.15.0),scipy 是 Day 547 装的。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `mde` 和 `holm`,再口述「没有显著差异」这句话为什么必须带上 MDE;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先看一个怪事:真有提升,为什么测不出来

Day 548 的 v2 只比 v1 好 1.1 个点,没测出来可以理解。换一个情形:v2 是我换了设定重新造的,**真实提升 2.8 个点**(造数据时 v2 的提升放大 4 倍,`sim_runs.py` 里的 `boost=4`,真实值用积分算出来),评测还是 180 条(60 个场景)。这次评测应该能看出 v2 更好吧?把这个实验重复 2000 次,每次造一份新数据,看「区间下限大于 0」(检测到提升)的次数。先建 `sim_runs.py`,它和 Day 547 的 `make_runs.py` 是同一个造法,多了场景数、提升倍数、每个场景几种说法三个旋钮:

```python
# agent-zero-lab/part10/sim_runs.py
"""Day 550:和 make_runs.py 同一个造数据的办法,多了两个旋钮:场景数,和 v2 的提升倍数。"""
import random


def make_n(scenarios: int, seed: int, boost: float = 1.0, per: int = 3) -> list[dict]:
    """scenarios 个场景 × per 种说法(默认 3)。boost=1 就是 make_runs.make 的设定;boost=4 时 v2 的提升放大 4 倍。"""
    rng = random.Random(seed)
    rows = []
    for s in range(scenarios):
        hard = rng.random()
        base = 0.55 + 0.4 * (1 - hard)
        lift = (0.06 if hard > 0.5 else 0.01) * boost
        shared = int(rng.random() < base)
        for v in range(per):
            a = shared if rng.random() < 0.7 else int(rng.random() < base)
            b = a if rng.random() < 0.8 else int(rng.random() < min(base + lift, 0.99))
            rows.append({"case": f"S{s:03d}-{v}", "scenario": f"S{s:03d}", "v1": a, "v2": b})
    return rows


def true_diff(boost: float, grid: int = 100_000) -> float:
    """v2 − v1 的真实差值:v2 只在 20% 的用例上重抽,重抽概率比 base 高 lift,对 hard 在 0~1 上积分。"""
    total = 0.0
    for i in range(grid):
        hard = (i + 0.5) / grid
        base = 0.55 + 0.4 * (1 - hard)
        lift = (0.06 if hard > 0.5 else 0.01) * boost
        total += min(base + lift, 0.99) - base
    return 0.2 * total / grid


if __name__ == "__main__":
    for boost in (1, 3, 4, 5):
        print(f"boost={boost}:真实提升 {true_diff(boost):.4f}")
```

<div class="line-notes">

- `def make_n(scenarios: int, seed: int, boost: float = 1.0, per: int = 3) -> list[dict]:` `scenarios` 是场景数,`boost` 是 v2 提升的倍数,`per` 是每个场景几种说法。`boost=1`、`per=3`、`scenarios=60` 就是 `make_runs.make` 的设定。
- `lift = (0.06 if hard > 0.5 else 0.01) * boost` 难场景(`hard > 0.5`)v2 比 v1 多 0.06 的成功概率,易场景多 0.01,再乘 `boost`。
- `for v in range(per):` 每个场景 per 条用例。
- `def true_diff(boost: float, grid: int = 100_000) -> float:` 算 v2 − v1 的真实差值。
- `hard = (i + 0.5) / grid` 把 0 到 1 切成 10 万小段,取每段中点,模拟 `hard` 在 0 到 1 上均匀分布。
- `total += min(base + lift, 0.99) - base` v2 在这个难度下的成功概率,比 v1 的多多少。
- `return 0.2 * total / grid` 乘 0.2,因为 v2 只在 20% 的用例上重新抽;再对 10 万个点取平均。`boost=1` 时 0.0070,`boost=4` 时 0.0280。

</div>

```bash
uv run python -m part10.sim_runs
```

```text
boost=1:真实提升 0.0070
boost=3:真实提升 0.0210
boost=4:真实提升 0.0280
boost=5:真实提升 0.0341
```

现在是检验功效的实验。先不看代码,看结果(一部分是公式的预测,稍后解释):

```python
# agent-zero-lab/part10/power_sim.py
"""公式说「检测出来的概率」是 x%,真的去跑 2000 次评测,数一数有几次检测出来。"""
import math

from part10.sim_runs import make_n, true_diff
from part10.stats import Z95, clustered_se, power_of

BOOST = 4
delta = true_diff(BOOST)
print(f"v2 的真实提升 = {delta:.4f}")

# 用 5 份很大的数据(各 3000 个场景)估计「SE × √n」这个常数,以后 SE(n) = c / √n
cs = []
for seed in range(90, 95):
    big = make_n(3000, seed=seed, boost=BOOST)
    d_big = [float(r["v2"] - r["v1"]) for r in big]
    cs.append(clustered_se(d_big, [r["scenario"] for r in big]) * math.sqrt(len(d_big)))
c = sum(cs) / len(cs)
print(f"聚类 SE × √n = {c:.4f}")

RERUNS = 2000
print(f"{'场景数':>6} {'用例数':>6} | {'公式 SE':>8} {'公式功效':>8} | {'实际检测到':>10}")
for g in (30, 60, 120, 200, 300):
    n = g * 3
    detected = 0
    for seed in range(RERUNS):
        rows = make_n(g, seed=5000 + seed, boost=BOOST)
        d = [float(r["v2"] - r["v1"]) for r in rows]
        diff = sum(d) / n
        se = clustered_se(d, [r["scenario"] for r in rows])
        detected += diff - Z95 * se > 0          # 区间下限大于 0,算「检测到了提升」
    se_formula = c / math.sqrt(n)
    print(f"{g:>6} {n:>6} | {se_formula:>8.4f} {power_of(delta, se_formula):>8.0%} | {detected / RERUNS:>10.1%}")
```

<div class="line-notes">

- `BOOST = 4` v2 的提升放大 4 倍。
- `delta = true_diff(BOOST)` 真实提升 0.0280。
- `cs = []` 要估一个常数 c,使「聚类标准误 ≈ c / √用例数」,公式部分要用。
- `for seed in range(90, 95):` 用 5 份很大的数据(每份 3000 个场景 = 9000 条)来估,大数据下标准误估得准。
- `cs.append(clustered_se(d_big, [r["scenario"] for r in big]) * math.sqrt(len(d_big)))` 聚类标准误乘以 √n,得到「与 n 无关」的常数。
- `c = sum(cs) / len(cs)` 5 份取平均,c = 0.2541。
- `for g in (30, 60, 120, 200, 300):` 场景数 30 到 300,用例数是它的 3 倍。
- `rows = make_n(g, seed=5000 + seed, boost=BOOST)` 每次造一份新数据,种子不同。
- `se = clustered_se(d, [r["scenario"] for r in rows])` 这份数据配对加聚类的标准误。
- `detected += diff - Z95 * se > 0          # 区间下限大于 0,算「检测到了提升」` 差值减 1.96 倍标准误,就是 95% 区间的下限。下限 > 0,就说「提升是真的」。
- `se_formula = c / math.sqrt(n)` 公式预测的标准误。
- `power_of(delta, se_formula)` 公式预测的功效,下面马上解释。

</div>

```bash
uv run python -m part10.power_sim
```

```text
v2 的真实提升 = 0.0280
聚类 SE × √n = 0.2541
   场景数    用例数 |    公式 SE     公式功效 |      实际检测到
    30     90 |   0.0268      18% |      17.8%
    60    180 |   0.0189      32% |      29.9%
   120    360 |   0.0134      55% |      55.4%
   200    600 |   0.0104      77% |      78.6%
   300    900 |   0.0085      91% |      90.2%
```

最后一列是实际检测到提升的比例。**180 条(60 个场景)评测集、真实提升 2.8 个点时,只有 29.9% 的评测能检测出来**。三分之二以上的评测会告诉你「区间跨过 0,没有结论」,而 v2 实际上是真的更好。要到 600 条(200 个场景)才有 78.6%,900 条才 90%。

这个概率有个名字:**功效**(power),意思是「真有这么大的提升时,你的评测能把它检测出来的概率」。常用的目标是 80%。**漏报**(把真实的提升看成没提升)的概率是 1 − 功效,叫第二类错误。和它对应的是**误报**(没提升却说有提升),通常控制在 5%(显著性水平 α,第一类错误)。95% 区间「下限大于 0」这个规则,保证了误报率约 5%,但它管不了漏报。**漏报的概率是评测集大小决定的。**

<figure>
<svg viewBox="0 0 640 240" role="img" aria-label="两条钟形曲线:左边是「真的没提升」时差值的分布,中心在 0;右边是「真提升 2.8 个标准误」时差值的分布。竖线在 1.96 个标准误处,是判定「检测到」的门槛;右边曲线在门槛右边的面积是 80%,就是功效">
  <rect x="0" y="0" width="640" height="240" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12">
    <line x1="0" y1="190" x2="400" y2="190" stroke="var(--rule)"/>
    <polygon points="212,190 212,113 216,107 227,93 237,83 248,80 258,83 269,93 279,107 290,123 300,140 311,154 321,166 332,175 342,181 353,185 363,187 374,189 374,190" fill="var(--mem-wash)"/>
    <polyline points="4,189 14,187 25,185 36,181 46,175 56,166 67,154 78,140 88,123 98,107 109,93 120,83 130,80 140,83 151,93 162,107 172,123 182,140 193,154 204,166 214,175 224,181 235,185 246,187 256,189" fill="none" stroke="var(--compute)" stroke-width="2"/>
    <polyline points="122,189 132,187 143,185 153,181 164,175 174,166 185,154 195,140 206,123 216,107 227,93 237,83 248,80 258,83 269,93 279,107 290,123 300,140 311,154 321,166 332,175 342,181 353,185 363,187 374,189" fill="none" stroke="var(--mem)" stroke-width="2"/>
    <line x1="212" y1="60" x2="212" y2="190" stroke="var(--ink)" stroke-dasharray="4 3"/>
    <text x="130" y="208" fill="var(--compute)" text-anchor="middle">真实差值 0</text>
    <text x="248" y="208" fill="var(--mem)" text-anchor="middle">真实差值 2.8 SE</text>
    <text x="212" y="54" fill="var(--ink)" text-anchor="middle">门槛 1.96 SE</text>
    <text x="410" y="84" fill="var(--ink)">琥珀线:真的没提升,门槛右边</text>
    <text x="410" y="102" fill="var(--ink-soft)">只有约 2.5% 会被误判成有提升</text>
    <text x="410" y="132" fill="var(--ink)">蓝线:真有 2.8 SE 的提升</text>
    <text x="410" y="150" fill="var(--ink-soft)">门槛右边的蓝色面积 = 80%</text>
    <text x="410" y="168" fill="var(--ink-soft)">就是功效</text>
    <text x="410" y="200" fill="var(--ink-faint)">2.8 = 1.96 + 0.84</text>
  </g>
</svg>
<figcaption>横轴是「评测测出的差值」,SE 是差值的标准误。要让真实提升有 80% 的概率被检测到,它必须比门槛(1.96 SE)再高 0.84 个 SE,合起来 2.8 个 SE。这个 2.8 就是下面公式里的 z 值之和。</figcaption>
</figure>

## MDE:这个评测集能测出多小的提升

图里的关系可以直接变成公式。**最小可检测差异**(MDE,minimum detectable effect)指:在给定 α 和功效下,真实提升至少多大,评测才有 80% 的把握检测出来。门槛是 z_{α/2} 个标准误,再往上要 z_{功效} 个标准误才够到 80%,所以:

MDE = (z_{α/2} + z_{功效}) × SE

z 值是标准正态分布的分位数:α = 0.05 时 z_{0.975} = 1.96,功效 80% 时 z_{0.80} = 0.8416,加起来 2.8016。SE 用 Day 548 的配对加聚类标准误 0.0235:MDE = 2.8016 × 0.0235 = 0.0658,约 6.6 个点。

反过来,想知道需要多少条:SE = √(ω²/n)(ω² 是逐条差值的方差,n 是用例数,聚类时再乘一个设计效应),代入上面的式子,解出 n:

n = (z_{α/2} + z_{功效})² × ω² / Δ²

Δ 是你想检测的提升。Evan Miller 论文第 5 节(公式 9)就是这个形式,不过他把 ω² 进一步拆成「用例层面」的 ω² 加上「每题重跑」的 σ²/K 两部分(Day 549 讲的重跑方差),今天为了简单,把整个「逐条差值的方差」都叫 ω²,是单遍评测的情形。

实现成四个函数。顶部加一行 `from statistics import NormalDist`(Python 标准库自带,不需要 scipy),末尾追加:

```python
# agent-zero-lab/part10/stats.py(新增)
def z_of(p: float) -> float:
    """标准正态分布的分位数(p 分位),比如 z_of(0.975) ≈ 1.96。标准库 statistics 自带,不用 scipy。"""
    return NormalDist().inv_cdf(p)


def mde(se: float, alpha: float = 0.05, power: float = 0.8) -> float:
    """最小可检测差异:真实差值至少多大,这个评测才有 power 的把握检测出来。MDE = (z_{1-α/2} + z_{power}) × SE。"""
    return (z_of(1 - alpha / 2) + z_of(power)) * se


def required_n(delta: float, omega2: float, alpha: float = 0.05, power: float = 0.8) -> float:
    """要检测出差值 delta,需要多少条独立的配对用例。omega2 是逐条差值的方差。n = (z_a + z_b)² · ω² / Δ²。"""
    if delta == 0:
        raise ValueError("要检测的提升不能是 0:差值越小,需要的用例越多,0 需要无穷多")
    return (z_of(1 - alpha / 2) + z_of(power)) ** 2 * omega2 / delta**2


def power_of(delta: float, se: float, alpha: float = 0.05) -> float:
    """真实差值是 delta、标准误是 se 时,检测出来(区间不含 0)的概率。"""
    z_a = z_of(1 - alpha / 2)
    return NormalDist().cdf(delta / se - z_a) + NormalDist().cdf(-delta / se - z_a)
```

<div class="line-notes">

- `def z_of(p: float) -> float:` 标准正态分布的 p 分位数。
- `return NormalDist().inv_cdf(p)` `NormalDist()` 是均值 0、标准差 1 的正态分布,`inv_cdf(p)` 是累积概率 p 对应的位置:`inv_cdf(0.975)` = 1.9600,`inv_cdf(0.8)` = 0.8416。我拿 scipy 的 `norm.ppf` 对过,两个值一样到 1e-15。
- `def mde(se: float, alpha: float = 0.05, power: float = 0.8) -> float:` 输入标准误,返回 MDE。
- `return (z_of(1 - alpha / 2) + z_of(power)) * se` `1 - alpha / 2` = 0.975。(1.96 + 0.8416) × se。
- `def required_n(delta: float, omega2: float, alpha: float = 0.05, power: float = 0.8) -> float:` 输入想检测的提升 delta 和逐条差值方差 omega2,返回需要多少条。
- `if delta == 0:` 想检测「0 的提升」没有意义,下一小节演示不加这一行会怎样。
- `raise ValueError("要检测的提升不能是 0:差值越小,需要的用例越多,0 需要无穷多")` 一句话解释为什么。
- `return (z_of(1 - alpha / 2) + z_of(power)) ** 2 * omega2 / delta**2` n = (z+z)² · ω² / Δ²。
- `def power_of(delta: float, se: float, alpha: float = 0.05) -> float:` 反过来:真实提升是 delta、标准误是 se 时的功效。
- `return NormalDist().cdf(delta / se - z_a) + NormalDist().cdf(-delta / se - z_a)` 对应图里蓝色曲线在门槛右边的面积。`delta / se` 是「真实提升有几个标准误」,减去门槛 `z_a`,`cdf` 查这个位置左边的累积概率。第二项是蓝线跑到左边门槛之外的一点点面积,基本为 0,为完整保留。

</div>

### 先演示一个报错

我第一版没有 `delta == 0` 的检查,问了一个傻问题「要检测 0 的提升需要多少条」:

```bash
uv run python -c "
from part10.stats import required_n
required_n(0.0, 0.0781)"
```

```text
Traceback (most recent call last):
  File "<string>", line 3, in <module>
    required_n(0.0, 0.0781)
    ~~~~~~~~~~^^^^^^^^^^^^^
  File "/Users/你/agent-zero-lab/part10/stats.py", line 171, in required_n
    return (z_of(1 - alpha / 2) + z_of(power)) ** 2 * omega2 / delta**2
           ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~^~~~~~~~~~
ZeroDivisionError: division by zero
```

`ZeroDivisionError`:`Δ²` 在分母上。在 `ex550` 那种要扫一排 Δ 的循环里,有人从 0 开始扫,就会炸。加了检查之后变成 `ValueError: 要检测的提升不能是 0:差值越小,需要的用例越多,0 需要无穷多`。

### 代入 runs.json 的数字

```python
# agent-zero-lab/part10/power_formula.py
"""Day 550:我们这个 180 条的评测集,最小能检测出多大的提升?要检测 3 个点需要多少条?"""
import json
from pathlib import Path

from part10.stats import clustered_se, mde, naive_se, power_of, required_n, z_of

rows = json.loads((Path(__file__).parent / "data" / "runs.json").read_text())
d = [float(r["v2"] - r["v1"]) for r in rows]
cl = [r["scenario"] for r in rows]
n = len(d)

omega2 = sum((x - sum(d) / n) ** 2 for x in d) / (n - 1)           # 逐条差值的方差
se_naive = naive_se(d)
se_cl = clustered_se(d, cl)
deff = (se_cl / se_naive) ** 2
print(f"z(0.975) = {z_of(0.975):.4f}   z(0.80) = {z_of(0.80):.4f}   两者之和 {z_of(0.975) + z_of(0.8):.4f}")
print(f"逐条差值方差 ω² = {omega2:.4f}   配对 SE {se_naive:.4f}  配对+聚类 SE {se_cl:.4f}   设计效应 {deff:.2f}")
print(f"180 条的 MDE:不考虑聚类 {mde(se_naive):.1%}   考虑聚类 {mde(se_cl):.1%}")

print()
print(f"{'配对用例数':>8} {'MDE(不聚类)':>12} {'MDE(聚类)':>11}")
for m in (50, 100, 180, 400, 700, 1000):
    se1 = (omega2 / m) ** 0.5
    print(f"{m:>8} {mde(se1):>12.1%} {mde(se1 * deff ** 0.5):>11.1%}")

print()
for delta in (0.05, 0.03, 0.02, 0.01):
    n0 = required_n(delta, omega2)
    print(f"要检测 {delta:.0%} 的提升:不聚类 {n0:>6.0f} 条,聚类 {n0 * deff:>6.0f} 条(= {n0 * deff / 3:>5.0f} 个场景 × 3 种说法)")

print()
print(f"真实提升 3 个点、就用现在这 180 条,检测出来的概率 = {power_of(0.03, se_cl):.0%}")
print(f"真实提升 1.1 个点(今天看到的),检测出来的概率 = {power_of(0.011, se_cl):.0%}")

# 配对到底省了多少?如果 v1、v2 不配对(各自独立评测),差值的方差是两个分数的方差之和
var_unpaired = naive_se([float(r["v1"]) for r in rows]) ** 2 * n + naive_se([float(r["v2"]) for r in rows]) ** 2 * n
print()
print(f"不配对时的「逐条方差」{var_unpaired:.4f}(配对时 {omega2:.4f}),要检测 3 个点需要 {required_n(0.03, var_unpaired):.0f} 条,"
      f"是配对的 {var_unpaired / omega2:.1f} 倍")
```

<div class="line-notes">

- `d = [float(r["v2"] - r["v1"]) for r in rows]` 逐条差值,和 Day 548 一样。
- `omega2 = sum((x - sum(d) / n) ** 2 for x in d) / (n - 1)           # 逐条差值的方差` 方差:每个差值减平均再平方,求和除以 n−1。180 个差值里 8 个 +1、6 个 −1、166 个 0,算出来 0.0781。
- `se_naive = naive_se(d)` 配对的标准误 0.0208,等于 √(ω²/n) = √(0.0781/180)。
- `se_cl = clustered_se(d, cl)` 配对加聚类的标准误 0.0235。
- `deff = (se_cl / se_naive) ** 2` 设计效应 1.28。注意这是**差值**的设计效应(1.28),不是 v1 分数的设计效应(1.93)。差值里同场景的相关弱一些。
- `print(f"180 条的 MDE:不考虑聚类 {mde(se_naive):.1%}   考虑聚类 {mde(se_cl):.1%}")` 2.8016 × 0.0208 = 5.8%;2.8016 × 0.0235 = 6.6%。
- `se1 = (omega2 / m) ** 0.5` 假设用例数变成 m,标准误 = √(ω²/m)。
- `print(f"{m:>8} {mde(se1):>12.1%} {mde(se1 * deff ** 0.5):>11.1%}")` 不聚类和聚类两列 MDE,聚类就是标准误乘 √deff。
- `n0 = required_n(delta, omega2)` 不聚类时需要的条数。要检测 3 个点:2.8016² × 0.0781 / 0.03² = 7.849 × 0.0781 / 0.0009 = 681。
- `print(f"要检测 {delta:.0%} 的提升:不聚类 {n0:>6.0f} 条,聚类 {n0 * deff:>6.0f} 条(= {n0 * deff / 3:>5.0f} 个场景 × 3 种说法)")` 聚类时乘设计效应:681 × 1.28 = 869,每个场景 3 条,就是 290 个场景。
- `print(f"真实提升 3 个点、就用现在这 180 条,检测出来的概率 = {power_of(0.03, se_cl):.0%}")` 3 / 2.35 = 1.28 个标准误,减去 1.96,查正态累积概率:Φ(1.28 − 1.96) = Φ(−0.68) ≈ 25%。
- `var_unpaired = naive_se([float(r["v1"]) for r in rows]) ** 2 * n + naive_se([float(r["v2"]) for r in rows]) ** 2 * n` 不配对时「逐条方差」:v1 的方差(n × SE²)加 v2 的方差,0.3537。

</div>

```bash
uv run python -m part10.power_formula
```

```text
z(0.975) = 1.9600   z(0.80) = 0.8416   两者之和 2.8016
逐条差值方差 ω² = 0.0781   配对 SE 0.0208  配对+聚类 SE 0.0235   设计效应 1.28
180 条的 MDE:不考虑聚类 5.8%   考虑聚类 6.6%

   配对用例数     MDE(不聚类)     MDE(聚类)
      50        11.1%       12.5%
     100         7.8%        8.8%
     180         5.8%        6.6%
     400         3.9%        4.4%
     700         3.0%        3.3%
    1000         2.5%        2.8%

要检测 5% 的提升:不聚类    245 条,聚类    313 条(=   104 个场景 × 3 种说法)
要检测 3% 的提升:不聚类    681 条,聚类    869 条(=   290 个场景 × 3 种说法)
要检测 2% 的提升:不聚类   1532 条,聚类   1955 条(=   652 个场景 × 3 种说法)
要检测 1% 的提升:不聚类   6129 条,聚类   7820 条(=  2607 个场景 × 3 种说法)

真实提升 3 个点、就用现在这 180 条,检测出来的概率 = 25%
真实提升 1.1 个点(今天看到的),检测出来的概率 = 8%

不配对时的「逐条方差」0.3537(配对时 0.0781),要检测 3 个点需要 3085 条,是配对的 4.5 倍
```

读法:

- 180 条的 MDE 是 5.8 个点(不聚类)或 6.6 个点(聚类)。意思是:**真实提升小于 6.6 个点的话,这个评测集多半检测不出来。**今天看到的 1.1 个点,远在 MDE 以下;检测出它的概率只有 8%。
- 想检测 3 个点的提升,要 869 条,也就是 290 个场景。5 个点要 313 条;2 个点要 1955 条;1 个点要 7820 条。**MDE 随 √n 下降,想把 MDE 减半,要 4 倍的用例。**
- 配对省了多少:不配对时逐条方差 0.3537,是配对时 0.0781 的 4.5 倍,要检测 3 个点要 3085 条(不聚类),配对只要 681 条。Day 548 讲的配对,在这里换算成 4.5 倍的用例。

### 公式对吗:对照前面的模拟

最前面的模拟里,公式预测的功效是 18%、32%、55%、77%、91%,实际检测到的比例是 17.8%、29.9%、55.4%、78.6%、90.2%,最大差 2 个点多。公式是对的,可以拿它做规划。

<figure>
<svg viewBox="0 0 640 240" role="img" aria-label="功效随用例数增长的曲线:90 条时 18%,180 条时 32%,360 条时 55%,600 条时 77%,900 条时 91%;80% 的目标线在约 650 条处与曲线相交">
  <rect x="0" y="0" width="640" height="240" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12">
    <line x1="60" y1="200" x2="600" y2="200" stroke="var(--rule)"/>
    <line x1="60" y1="30" x2="60" y2="200" stroke="var(--rule)"/>
    <text x="22" y="204" fill="var(--ink-faint)">0%</text><text x="14" y="118" fill="var(--ink-faint)">50%</text><text x="6" y="34" fill="var(--ink-faint)">100%</text>
    <line x1="60" y1="64" x2="600" y2="64" stroke="var(--compute)" stroke-dasharray="4 4"/>
    <text x="470" y="58" fill="var(--compute)">80% 的目标</text>
    <polyline points="109,169 157,146 254,106 384,69 546,45" fill="none" stroke="var(--mem)" stroke-width="2.5"/>
    <g fill="var(--mem)"><circle cx="109" cy="169" r="4"/><circle cx="157" cy="146" r="4"/><circle cx="254" cy="106" r="4"/><circle cx="384" cy="69" r="4"/><circle cx="546" cy="45" r="4"/></g>
    <text x="112" y="186" fill="var(--ink-soft)">90 条 18%</text>
    <text x="160" y="140" fill="var(--ink-soft)">180 条 32%</text>
    <text x="258" y="100" fill="var(--ink-soft)">360 条 55%</text>
    <text x="388" y="90" fill="var(--ink-soft)">600 条 77%</text>
    <text x="500" y="82" fill="var(--ink-soft)">900 条 91%</text>
    <text x="250" y="226" fill="var(--ink-faint)">横轴:评测集的用例数(3 种说法 × 场景数),真实提升 2.8 个点</text>
  </g>
</svg>
<figcaption>点是公式给的功效(power_sim.py 的「公式功效」列)。180 条的评测集只有三分之一的功效,要达到 80% 得 650 条左右。</figcaption>
</figure>

## 怎么把 MDE 压下去

知道了尺子的量程,下一个问题是怎么加长它。几条路,效果各不相同:

**加用例。**最直接。MDE 与 √n 成反比。但加什么用例有讲究。练习 4 用同一个模拟比较了几种加法:

```python
# agent-zero-lab/part10/ex550_more_cases.py
"""练习 4:想把评测集的 MDE 压下去,多加「说法」还是多加「场景」?"""
import math

from part10.sim_runs import make_n
from part10.stats import clustered_se, mde

RERUNS = 300
print(f"{'场景数':>6} {'每场景说法数':>10} {'用例数':>6} | {'差值聚类 SE(平均)':>16} {'MDE':>7}")
for g, per in ((60, 3), (60, 10), (180, 1), (180, 3), (600, 1)):
    ses = []
    for seed in range(RERUNS):
        rows = make_n(g, seed=7000 + seed, boost=1, per=per)
        d = [float(r["v2"] - r["v1"]) for r in rows]
        ses.append(clustered_se(d, [r["scenario"] for r in rows]))
    se = sum(ses) / len(ses)
    print(f"{g:>6} {per:>10} {g * per:>6} | {se:>16.4f} {mde(se):>7.1%}")
```

<div class="line-notes">

- `for g, per in ((60, 3), (60, 10), (180, 1), (180, 3), (600, 1)):` 五种设计:(场景数, 每场景几种说法)。60×3 是现在的 180 条。
- `rows = make_n(g, seed=7000 + seed, boost=1, per=per)` 用 `per` 参数造每个场景 per 条用例的数据。
- `ses.append(clustered_se(d, [r["scenario"] for r in rows]))` 每份数据的差值聚类标准误。
- `se = sum(ses) / len(ses)` 300 份取平均。
- `print(f"{g:>6} {per:>10} {g * per:>6} | {se:>16.4f} {mde(se):>7.1%}")` 场景数、每场景说法数、总用例数、平均标准误和 MDE。

</div>

```bash
uv run python -m part10.ex550_more_cases
```

```text
   场景数     每场景说法数    用例数 |      差值聚类 SE(平均)     MDE
    60          3    180 |           0.0199    5.6%
    60         10    600 |           0.0125    3.5%
   180          1    180 |           0.0189    5.3%
   180          3    540 |           0.0117    3.3%
   600          1    600 |           0.0105    2.9%
```

60 个场景 × 3 条(180 条)的 MDE 是 5.6 个点。同样 60 个场景,把说法加到每个场景 10 条(600 条),MDE 3.5 个点;180 个场景 × 3 条(540 条)是 3.3 个点;600 个场景 × 1 条(同样 600 条)是 2.9 个点。**用例数相同时,场景越多越好**:加说法是在同一个簇里加相关的信息,边际收益递减;加新场景是加独立的信息。所以如果你要扩评测集,先扩场景,不要只给老场景多造几种说法。

**配对。**前面 4.5 倍。已经用上了,但要靠「两个版本跑同一批用例」,别为了省事换了用例。

**重跑。**每题跑 K 遍,Miller 的公式 9 里 `(ω² + σ²_A/K_A + σ²_B/K_B)` 的后两项变小,前面的 ω² 不变。Day 549 的结论照搬:重跑方差占大头时有用(single),换题方差占大头时没用(workflow)。这一条我没有在 runs.json 上实算,因为那份模拟数据没有重跑结构。

**接受更大的 MDE。**如果加不动用例,就承认评测集只能看出大改动,小的 prompt 微调别指望靠它证明有效。这不是丢人的事,是尺子的量程。

## 多重比较:看的指标越多,越容易「发现」提升

另一个坑,和样本量无关。评测报告里不止一个数:总分、6 个模块各自的分数、3 个严重级别、judge 分、延迟、成本。每个数都做一次「区间跨不跨 0」的检验,每次有 5% 的概率碰巧显著。假设两个版本**完全一样**,m 个互相独立的检验里,至少有一个碰巧显著的概率是 1 − 0.95^m:m = 6 时 26.5%,m = 10 时 40.1%,m = 20 时 64.2%。

先用最小的脚本验证这个公式,再用贴近评测的版本:6 个模块,每个模块 60 个场景 × 3 条 = 180 条(和今天的评测集一样大),`boost=0` 让 v1 和 v2 没有任何真实差别,每个模块用配对加聚类的 z 检验算一个 p 值。

```python
# agent-zero-lab/part10/multi_sim.py
"""v1 和 v2 其实完全一样(boost=0),报告里看 6 个模块各自的差值。至少有一个模块「显著」的概率是多少?"""
import math
import random

from part10.sim_runs import make_n
from part10.stats import bonferroni, clustered_se, holm

# 第一步:纯理论。m 个互相独立的检验,每个误报概率 5%,至少一个误报的概率
rng = random.Random(0)
print(f"{'m':>3} {'公式 1-0.95^m':>14} {'模拟(20000 次)':>16}")
for m in (1, 3, 6, 10, 20):
    hits = sum(any(rng.random() < 0.05 for _ in range(m)) for _ in range(20000))
    print(f"{m:>3} {1 - 0.95**m:>14.1%} {hits / 20000:>16.1%}")

# 第二步:贴近评测的版本。6 个模块,每个模块 60 个场景 × 3 种说法 = 180 条,和今天的评测集一样大
MODULES = 6
RERUNS = 3000
any_raw = any_bonf = any_holm = 0
raw_hits_per_module = [0] * MODULES
for seed in range(RERUNS):
    rows = make_n(60 * MODULES, seed=20_000 + seed, boost=0)   # boost=0:v2 和 v1 没有任何真实差别
    pvals = []
    for module in range(MODULES):
        part = [r for r in rows if int(r["scenario"][1:]) % MODULES == module]
        d = [float(r["v2"] - r["v1"]) for r in part]
        se = clustered_se(d, [r["scenario"] for r in part])        # 配对 + 聚类的标准误
        z = (sum(d) / len(d)) / se if se > 0 else 0.0
        pvals.append(math.erfc(abs(z) / math.sqrt(2)))             # 两侧 p 值
    for i, p in enumerate(pvals):
        raw_hits_per_module[i] += p < 0.05
    any_raw += any(p < 0.05 for p in pvals)
    any_bonf += any(bonferroni(pvals))
    any_holm += any(holm(pvals))
print()
print(f"v1 和 v2 完全一样,6 个模块各做一次检验,{RERUNS} 次评测里:")
print(f"  单个模块 p<0.05 的比例(每个模块):{[f'{h / RERUNS:.1%}' for h in raw_hits_per_module]}")
print(f"  至少一个模块 p<0.05(不校正) {any_raw / RERUNS:.1%}   独立时的理论值 1-0.95^6 = {1 - 0.95**6:.1%}")
print(f"  Bonferroni 校正后至少一个显著    {any_bonf / RERUNS:.1%}")
print(f"  Holm 校正后至少一个显著          {any_holm / RERUNS:.1%}")
```

<div class="line-notes">

- `rng = random.Random(0)` 第一部分用最简单的理论模拟。
- `hits = sum(any(rng.random() < 0.05 for _ in range(m)) for _ in range(20000))` 重复 20000 次:每次做 m 个检验,每个检验有 5% 的概率碰巧显著(`rng.random() < 0.05`),`any(...)` 问「至少一个显著吗」,`sum` 数 20000 次里有几次。
- `print(f"{m:>3} {1 - 0.95**m:>14.1%} {hits / 20000:>16.1%}")` 公式 1 − 0.95^m 和模拟对照。
- `MODULES = 6` 6 个模块。
- `rows = make_n(60 * MODULES, seed=20_000 + seed, boost=0)   # boost=0:v2 和 v1 没有任何真实差别` 360 个场景,6 个模块各分 60 个。
- `part = [r for r in rows if int(r["scenario"][1:]) % MODULES == module]` 场景号 `S017` 去掉第一个字母得 17,对 6 取余,把场景轮流分给 6 个模块。
- `se = clustered_se(d, [r["scenario"] for r in part])        # 配对 + 聚类的标准误` 这个模块里差值的聚类标准误。
- `z = (sum(d) / len(d)) / se if se > 0 else 0.0` z = 差值均值 / 标准误;标准误为 0(差值全是 0)时 z 取 0,避免除以零。
- `pvals.append(math.erfc(abs(z) / math.sqrt(2)))             # 两侧 p 值` 两侧 p 值。z = 1.96 时 p = 0.05。
- `any_raw += any(p < 0.05 for p in pvals)` 不校正:6 个模块里有一个 p < 0.05 就算「有显著」。
- `any_bonf += any(bonferroni(pvals))` Bonferroni 校正后还有显著吗。
- `any_holm += any(holm(pvals))` Holm 校正后。

</div>

```bash
uv run python -m part10.multi_sim
```

```text
  m    公式 1-0.95^m      模拟(20000 次)
  1           5.0%             5.4%
  3          14.3%            14.2%
  6          26.5%            26.7%
 10          40.1%            40.0%
 20          64.2%            63.9%

v1 和 v2 完全一样,6 个模块各做一次检验,3000 次评测里:
  单个模块 p<0.05 的比例(每个模块):['5.7%', '5.1%', '5.2%', '5.1%', '4.9%', '5.2%']
  至少一个模块 p<0.05(不校正) 27.5%   独立时的理论值 1-0.95^6 = 26.5%
  Bonferroni 校正后至少一个显著    5.4%
  Holm 校正后至少一个显著          5.4%
```

第一部分:公式和模拟几乎一样,m = 10 时 40.1% 对 40.0%。第二部分:每个模块单独看,误报率都在 5% 上下(4.9% 到 5.7%),这是对的;但 6 个模块**至少一个**显著的比例是 27.5%,理论值(独立时)26.5%。v1 和 v2 完全一样,你有四分之一的机会在 6 个模块里找到一个「v2 在 XX 模块显著提升」。这就是**多重比较问题**。

后面两行是校正以后的结果,都降回了 5.4% 左右。两个方法:

**Bonferroni**:把显著性门槛从 α 降到 α/m。8 个指标,每个的门槛是 0.05/8 = 0.00625。想法是:每个检验的误报概率压到 α/m,m 个加起来最多 α(概率的并集不超过各自概率之和)。简单,但偏保守。

**Holm**:把 p 值从小到大排队,第 1 小的和 α/m 比,第 2 小的和 α/(m−1) 比,第 3 小的和 α/(m−2) 比……直到第一个没通过的,它和后面所有的都判为不显著。第一关和 Bonferroni 一样严,后面逐步放松,所以 Holm **总是至少和 Bonferroni 一样能检测出来**,同样保证整体误报率不超过 α。没有理由不用 Holm。

```python
# agent-zero-lab/part10/stats.py(新增)
def holm(pvalues: list[float], alpha: float = 0.05) -> list[bool]:
    """Holm 校正:p 值从小到大排,第 i 小(i 从 0 数)的和 alpha/(m−i) 比,第一次不过就全部停下。返回每个是否显著(顺序同输入)。"""
    m = len(pvalues)
    order = sorted(range(m), key=lambda i: pvalues[i])
    reject = [False] * m
    for rank, i in enumerate(order):
        if pvalues[i] <= alpha / (m - rank):
            reject[i] = True
        else:
            break
    return reject


def bonferroni(pvalues: list[float], alpha: float = 0.05) -> list[bool]:
    """Bonferroni:每个 p 值和 alpha/m 比。"""
    return [p <= alpha / len(pvalues) for p in pvalues]
```

<div class="line-notes">

- `def holm(pvalues: list[float], alpha: float = 0.05) -> list[bool]:` 输入一组 p 值,返回每个是否显著(顺序和输入一致)。
- `m = len(pvalues)` 一共 m 个检验。
- `order = sorted(range(m), key=lambda i: pvalues[i])` 按 p 值从小到大排下标。`sorted(下标, key=...)` 相当于 JS 的 `idx.sort((a, b) => p[a] - p[b])`。
- `reject = [False] * m` 先全部判为不显著。
- `for rank, i in enumerate(order):` 从最小的 p 值开始,`rank` 是 0、1、2……排名,`i` 是原始位置。
- `if pvalues[i] <= alpha / (m - rank):` 第 rank 小的和 α/(m−rank) 比:排第 0 的是 α/m,排第 1 的是 α/(m−1)。
- `reject[i] = True` 通过,标成显著。
- `else:` `break` 第一个没通过的,它和后面所有的都停下,保持不显著。
- `return [p <= alpha / len(pvalues) for p in pvalues]` Bonferroni 一行:每个 p 值都和 α/m 比。

</div>

写完要核对。statsmodels 里有现成实现 `multipletests`,只在这个脚本里对答案(`uv add --dev statsmodels`):

```python
# agent-zero-lab/part10/check_holm.py
"""用 statsmodels 的现成实现核对我们手写的 holm、bonferroni。statsmodels 只在这里对答案。"""
import random

import statsmodels
from statsmodels.stats.multitest import multipletests

from part10.stats import bonferroni, holm

print("statsmodels", statsmodels.__version__)
p = [0.001, 0.008, 0.009, 0.04, 0.2, 0.5]
print("Bonferroni 手写", bonferroni(p), "→", sum(bonferroni(p)), "个显著")
print("Holm       手写", holm(p), "→", sum(holm(p)), "个显著")
print("Holm statsmodels", list(multipletests(p, alpha=0.05, method="holm")[0]))

rng = random.Random(1)
bad = 0
for _ in range(500):
    q = [rng.random() ** 2 for _ in range(rng.randint(1, 12))]    # 平方让小 p 值多一些,更容易出现分歧
    if list(multipletests(q, alpha=0.05, method="holm")[0]) != holm(q):
        bad += 1
    if list(multipletests(q, alpha=0.05, method="bonferroni")[0]) != bonferroni(q):
        bad += 1
print(f"随机 500 组 p 值(各 1~12 个),两种方法共 1000 次比较,不一致 {bad} 次")
```

<div class="line-notes">

- `from statsmodels.stats.multitest import multipletests` statsmodels 的多重检验校正函数,`method` 参数选 `"holm"`、`"bonferroni"` 等。
- `p = [0.001, 0.008, 0.009, 0.04, 0.2, 0.5]` 6 个 p 值。Bonferroni 的门槛 0.05/6 = 0.0083:0.001、0.008 通过,0.009 不过。Holm:0.001 ≤ 0.0083;0.008 ≤ 0.05/5 = 0.01;0.009 ≤ 0.05/4 = 0.0125;0.04 ≤ 0.05/3 = 0.0167?不,不过,停。所以 Holm 判 3 个,Bonferroni 判 2 个。
- `print("Holm statsmodels", list(multipletests(p, alpha=0.05, method="holm")[0]))` `multipletests` 返回一个元组,第一项是「每个是否拒绝原假设」的布尔数组。
- `q = [rng.random() ** 2 for _ in range(rng.randint(1, 12))]    # 平方让小 p 值多一些,更容易出现分歧` 随机造 1 到 12 个 p 值,平方让它们偏小,这样 Holm 和 Bonferroni 经常有分歧,才有检验价值。
- `if list(multipletests(q, alpha=0.05, method="holm")[0]) != holm(q):` 随机 500 组,两个实现必须一致。

</div>

```bash
uv run python -m part10.check_holm
```

```text
statsmodels 0.15.0
Bonferroni 手写 [True, True, False, False, False, False] → 2 个显著
Holm       手写 [True, True, True, False, False, False] → 3 个显著
Holm statsmodels [np.True_, np.True_, np.True_, np.False_, np.False_, np.False_]
随机 500 组 p 值(各 1~12 个),两种方法共 1000 次比较,不一致 0 次
```

手写的 Holm 对了:6 个 p 值那组 Holm 判 3 个显著(0.001、0.008、0.009),Bonferroni 只判 2 个。500 组随机 p 值、两种方法共 1000 次比较,一次不一致都没有。

### 怎么用:事先定一个主指标

校正是亡羊补牢。更好的办法是**事先定一个主指标**:合不合并只看它(比如回归集 P0 通过率,或者能力集总分),其余当护栏和参考。只有一个主指标,就没有多重比较的问题。要同时检验多个模块时,用 Holm。「对着报告找哪个模块涨了,只汇报那个」这种做法叫 **p-hacking**(靠挑选结果制造显著),上面 27.5% 就是它的代价,通常不是故意的,结果一样。

## 怎么跟 PM 和老板说

统计结果最后要变成一句人话。写一个函数 `report_line`,把差值、区间、MDE 变成一句话,三种情形各一个模板:

```python
# agent-zero-lab/part10/stats.py(新增)
def report_line(name: str, diff: float, lo: float, hi: float, mde_value: float, margin: float | None = None) -> str:
    """把一次配对比较写成给人看的一句话。diff、lo、hi、mde_value、margin 都是小数(0.011 = 1.1 个点)。

    margin 是「最多容忍变差多少」,为 None 表示这次的目标是变好,不是「别变差」。
    """
    pts = lambda x: f"{x * 100:+.1f}"  # noqa: E731  0.011 -> "+1.1"
    head = f"{name}:差值 {pts(diff)} 个点,95% 区间 [{pts(lo)}, {pts(hi)}]。"
    if margin is not None:
        if lo > -margin:
            return head + f"区间下限高于 −{margin * 100:.0f} 个点,没有证据显示变差超过能容忍的范围,可以合。"
        return head + (f"区间下限 {pts(lo)} 低于 −{margin * 100:.0f} 个点,这批用例排除不了「变差超过容忍范围」。"
                       f"本评测集只能检测 ≥{mde_value * 100:.1f} 个点的变化,不是说变差了,是没能力判断。")
    if lo > 0:
        return head + "区间整个在 0 以上,可以比较有把握地说确实变好了。"
    if hi < 0:
        return head + "区间整个在 0 以下,确实变差了。"
    return head + f"区间跨过 0,没有结论。本评测集只能检测 ≥{mde_value * 100:.1f} 个点的变化,不是「没效果」,是「测不出来」。"
```

<div class="line-notes">

- `def report_line(name: str, diff: float, lo: float, hi: float, mde_value: float, margin: float | None = None) -> str:` `diff`、`lo`、`hi`、`mde_value`、`margin` 都是小数(0.011 就是 1.1 个点)。`margin` 是「最多容忍变差多少」,`None` 表示这次的目标是变好。
- `pts = lambda x: f"{x * 100:+.1f}"  # noqa: E731  0.011 -> "+1.1"` 一个小函数把小数变成「带正负号的个点」。`lambda` 是匿名函数,相当于 JS 的 `x => ...`。`:+.1f` 是带符号、一位小数。
- `head = f"{name}:差值 {pts(diff)} 个点,95% 区间 [{pts(lo)}, {pts(hi)}]。"` 开头一句固定:差值和区间。
- `if lo > -margin:` 想证明「没变差」时:区间下限高于 −margin,就说没有证据显示变差超过能容忍的范围。
- `return head + (f"区间下限 {pts(lo)} 低于 −{margin * 100:.0f} 个点,这批用例排除不了「变差超过容忍范围」。"` 下限低于 −margin,不是说变差了,是排除不了。
- `if lo > 0:` 目标是变好时:整个区间在 0 以上,可以说确实变好。
- `if hi < 0:` 整个区间在 0 以下,确实变差。
- `return head + f"区间跨过 0,没有结论。本评测集只能检测 ≥{mde_value * 100:.1f} 个点的变化,不是「没效果」,是「测不出来」。"` 跨过 0:**一定带上 MDE**。

</div>

跑三种情形:

```python
# agent-zero-lab/part10/report_demo.py
"""三种情形,各写一句给 PM 和老板看的话。"""
import json
import math
from pathlib import Path

from part10.sim_runs import make_n
from part10.stats import clustered_se, mde, paired_diff, report_line, required_n

# 情形一:今天的 v1 → v2(runs.json,180 条)
rows = json.loads((Path(__file__).parent / "data" / "runs.json").read_text())
a, b, cl = [r["v1"] for r in rows], [r["v2"] for r in rows], [r["scenario"] for r in rows]
res = paired_diff(a, b, cl)
m = mde(res["se"])
print(report_line("v2 对比 v1", res["diff"], res["lo"], res["hi"], m))

# 情形二:目标是降成本,只要求「别变差超过 3 个点」(同一份数据)
print(report_line("v2(降成本版)对比 v1", res["diff"], res["lo"], res["hi"], m, margin=0.03))

# 情形三:评测集扩到 200 个场景 × 3 = 600 条,v2 的真实提升更大一点(造的数据,boost=4)
big = make_n(200, seed=11, boost=4)
a2, b2, cl2 = [r["v1"] for r in big], [r["v2"] for r in big], [r["scenario"] for r in big]
res2 = paired_diff(a2, b2, cl2)
print(report_line("扩到 600 条后 v2 对比 v1", res2["diff"], res2["lo"], res2["hi"], mde(res2["se"])))

# 要证明「没变差(容忍 3 个点)」要多少条?和证明「变好 3 个点」是同一个算式
d = [float(y - x) for x, y in zip(a, b)]
omega2 = sum((x - sum(d) / len(d)) ** 2 for x in d) / (len(d) - 1)
deff = (clustered_se(d, cl) / math.sqrt(omega2 / len(d))) ** 2
print(f"证明「没变差超过 3 个点」(真实差值 0):约 {required_n(0.03, omega2) * deff:.0f} 条")
```

<div class="line-notes">

- `res = paired_diff(a, b, cl)` Day 548 的配对加聚类,v2 对比 v1。
- `m = mde(res["se"])` 这批用例的 MDE,6.6 个点。
- `print(report_line("v2 对比 v1", res["diff"], res["lo"], res["hi"], m))` 情形一:想变好,区间跨 0。
- `print(report_line("v2(降成本版)对比 v1", res["diff"], res["lo"], res["hi"], m, margin=0.03))` 情形二:同一份数据,但这个改动的目标是降成本,只要求「别变差超过 3 个点」,传入 `margin=0.03`。
- `big = make_n(200, seed=11, boost=4)` 情形三:评测集扩到 200 个场景 × 3 = 600 条,v2 的真实提升更大(造的数据)。
- `d = [float(y - x) for x, y in zip(a, b)]` 回到 180 条的数据,算逐条差值。
- `omega2 = sum((x - sum(d) / len(d)) ** 2 for x in d) / (len(d) - 1)` 方差 0.0781。
- `deff = (clustered_se(d, cl) / math.sqrt(omega2 / len(d))) ** 2` 差值的设计效应 1.28。
- `print(f"证明「没变差超过 3 个点」(真实差值 0):约 {required_n(0.03, omega2) * deff:.0f} 条")` 想证明「没变差」要多少条?用的还是同一个样本量公式。

</div>

```bash
uv run python -m part10.report_demo
```

```text
v2 对比 v1:差值 +1.1 个点,95% 区间 [-3.5, +5.7]。区间跨过 0,没有结论。本评测集只能检测 ≥6.6 个点的变化,不是「没效果」,是「测不出来」。
v2(降成本版)对比 v1:差值 +1.1 个点,95% 区间 [-3.5, +5.7]。区间下限 -3.5 低于 −3 个点,这批用例排除不了「变差超过容忍范围」。本评测集只能检测 ≥6.6 个点的变化,不是说变差了,是没能力判断。
扩到 600 条后 v2 对比 v1:差值 +3.2 个点,95% 区间 [+1.2, +5.1]。区间整个在 0 以上,可以比较有把握地说确实变好了。
证明「没变差超过 3 个点」(真实差值 0):约 869 条
```

三个情形的口径:

- **没有结论**(第一行):「v2 比 v1 高 1.1 个点,区间 [−3.5, +5.7],区间跨过 0,没有结论。本评测集只能检测 ≥6.6 个点的变化,不是『没效果』,是『测不出来』。」我自己在 MR 里的写法会再加一句代价:要检测 3 个点的提升需要约 869 条(290 个场景)。运行几乎不要钱(按 Day 549 实测 single 每次约 ¥0.002 估,869 条 × 两个版本 × 3 遍约 ¥10),贵的是造用例和标注的人力,具体按你们 Day 546 预算表里的单价算,这里我没有实算。让决策者自己权衡,这是资深工程师该有的姿态。
- **没变差**(第二行):同一份数据,如果这个改动的目标是降成本、允许变差不超过 3 个点,区间下限 −3.5 低于 −3,**这批用例也排除不了「变差超过 3 个点」**。证明「没变差」和证明「变好」一样贵:同样要 869 条才能把区间收窄到 ±3 个点以内。如果容忍度是 5 个点,下限 −3.5 高于 −5,就可以合(练习 3 的例子)。「没变差」要先定容忍度,事后挑容忍度等于偷看。
- **有结论**(第三行):评测集扩到 600 条后,v2 +3.2 个点,区间 [+1.2, +5.1],可以说确实变好了。

别用的说法:「没有显著差异」(不带 MDE,读的人会理解成「没效果」)、「p = 0.79」(老板不看 p 值)、「通过率提升 1.1%」(不带区间,看着像事实)。

### 拼成对比报告

四天的零件拼在一起,`compare_report.py` 对两个版本的结果输出一份完整报告:

| 零件 | 来自 | 在 compare_report 里的作用 |
| --- | --- | --- |
| `fmt_rate`、`wilson_ci_cluster`、`design_effect` | Day 547、548 | 每个版本的 k/n 和聚类后的区间、设计效应 |
| `mcnemar_exact` | Day 548 | 新挂几条、新修好几条、McNemar p 值 |
| `paired_diff` | Day 548 | 差值和配对加聚类的正态区间 |
| `bootstrap_ci` | Day 549 | 同一个差值的 bootstrap 区间,和正态近似互相核对 |
| `mde`、`required_n` | Day 550 | 这批用例的 MDE,以及要检测 3 个点需要多少条 |
| `report_line` | Day 550 | 最后一句给人看的话 |

```python
# agent-zero-lab/part10/compare_report.py
"""把 Day 547–550 的零件拼成一份对比报告:两个版本在同一批用例上,到底有没有差别。"""
import json
from pathlib import Path

from part10.sim_runs import make_n
from part10.stats import (
    bootstrap_ci,
    clustered_se,
    design_effect,
    fmt_rate,
    mcnemar_exact,
    mde,
    paired_diff,
    report_line,
    required_n,
    wilson_ci_cluster,
)


def compare(name: str, a: list[int], b: list[int], clusters: list[str], margin: float | None = None) -> None:
    n, g = len(a), len(set(clusters))
    xa, xb = [float(v) for v in a], [float(v) for v in b]
    print(f"=== {name}:{n} 条用例,{g} 个场景(簇)")
    for label, x in (("v1", xa), ("v2", xb)):
        lo, hi = wilson_ci_cluster(x, clusters)
        print(f"  {label} {fmt_rate(int(sum(x)), n)}   聚类后 [{lo:.1%}, {hi:.1%}]  设计效应 {design_effect(x, clusters):.2f}")
    res = paired_diff(a, b, clusters)                     # type: ignore[arg-type]
    d = [y - x for x, y in zip(xa, xb)]
    blo, bhi = bootstrap_ci(d, clusters, n_boot=5000, seed=0)
    mc = mcnemar_exact(a, b)
    print(f"  新挂 {mc['a_only']} 条,新修好 {mc['b_only']} 条,其余 {n - mc['a_only'] - mc['b_only']} 条不变(McNemar p = {mc['p_value']:.3f},没考虑聚类)")
    print(f"  配对+聚类差值 {res['diff']:+.1%}  正态 [{res['lo']:+.1%}, {res['hi']:+.1%}]  bootstrap [{blo:+.1%}, {bhi:+.1%}]")
    m = mde(res["se"])
    n_need = required_n(0.03, res["se"] ** 2 * n)         # res["se"]² × n 就是聚类后的「每条方差」,已含设计效应
    print(f"  这批用例的 MDE {m:.1%};要检测 3 个点约需 {n_need:.0f} 条")
    print("  " + report_line(name, res["diff"], res["lo"], res["hi"], m, margin))


if __name__ == "__main__":
    rows = json.loads((Path(__file__).parent / "data" / "runs.json").read_text())
    compare("v2 对比 v1", [r["v1"] for r in rows], [r["v2"] for r in rows], [r["scenario"] for r in rows])
    print()
    big = make_n(200, seed=11, boost=4)
    compare("扩到 600 条", [r["v1"] for r in big], [r["v2"] for r in big], [r["scenario"] for r in big])
```

<div class="line-notes">

- `def compare(name: str, a: list[int], b: list[int], clusters: list[str], margin: float | None = None) -> None:` 输入两个版本的 0/1 结果、簇标签,可选容忍度。函数只打印,不返回。
- `n, g = len(a), len(set(clusters))` 用例数和簇数。`set(clusters)` 去重后的簇集合。
- `lo, hi = wilson_ci_cluster(x, clusters)` 每个版本聚类后的 Wilson 区间。
- `print(f"  {label} {fmt_rate(int(sum(x)), n)}   聚类后 [{lo:.1%}, {hi:.1%}]  设计效应 {design_effect(x, clusters):.2f}")` 先打 Day 547 的写法(假设独立),再打聚类后的区间。
- `res = paired_diff(a, b, clusters)                     # type: ignore[arg-type]` 配对加聚类。`# type: ignore` 是告诉类型检查器:`a` 是 `list[int]`,函数标的是 `list[float]`,这里忽略这个差别。
- `blo, bhi = bootstrap_ci(d, clusters, n_boot=5000, seed=0)` 对同一个差值按簇 bootstrap。
- `mc = mcnemar_exact(a, b)` 数不一致的条数。
- `n_need = required_n(0.03, res["se"] ** 2 * n)         # res["se"]² × n 就是聚类后的「每条方差」,已含设计效应` `res["se"]` 是聚类后的标准误,平方乘 n 反推出「每条的有效方差」,已经含了设计效应,不用再乘一次。
- `print("  " + report_line(name, res["diff"], res["lo"], res["hi"], m, margin))` 最后一句给人看的话。
- `big = make_n(200, seed=11, boost=4)` 主程序里跑两次:runs.json 的 180 条,和扩到 600 条的造数据。

</div>

```bash
uv run python -m part10.compare_report
```

```text
=== v2 对比 v1:180 条用例,60 个场景(簇)
  v1 138/180 = 76.7% [70.0%, 82.2%]   聚类后 [67.1%, 84.1%]  设计效应 1.93
  v2 140/180 = 77.8% [71.2%, 83.2%]   聚类后 [68.3%, 85.1%]  设计效应 1.96
  新挂 6 条,新修好 8 条,其余 166 条不变(McNemar p = 0.791,没考虑聚类)
  配对+聚类差值 +1.1%  正态 [-3.5%, +5.7%]  bootstrap [-3.9%, +5.6%]
  这批用例的 MDE 6.6%;要检测 3 个点约需 869 条
  v2 对比 v1:差值 +1.1 个点,95% 区间 [-3.5, +5.7]。区间跨过 0,没有结论。本评测集只能检测 ≥6.6 个点的变化,不是「没效果」,是「测不出来」。

=== 扩到 600 条:600 条用例,200 个场景(簇)
  v1 433/600 = 72.2% [68.4%, 75.6%]   聚类后 [66.6%, 77.1%]  设计效应 2.17
  v2 452/600 = 75.3% [71.7%, 78.6%]   聚类后 [70.1%, 79.9%]  设计效应 2.01
  新挂 7 条,新修好 26 条,其余 567 条不变(McNemar p = 0.001,没考虑聚类)
  配对+聚类差值 +3.2%  正态 [+1.2%, +5.1%]  bootstrap [+1.3%, +5.2%]
  这批用例的 MDE 2.8%;要检测 3 个点约需 512 条
  扩到 600 条:差值 +3.2 个点,95% 区间 [+1.2, +5.1]。区间整个在 0 以上,可以比较有把握地说确实变好了。
```

第一份报告就是今天的主线:v1、v2 聚类后的区间大面积重叠,新挂 6 条、新修好 8 条,配对加聚类差值 +1.1%,区间 [−3.5%, +5.7%],bootstrap [−3.9%, +5.6%],MDE 6.6%,要测 3 个点约需 869 条,最后一句「测不出来」。第二份(造的 600 条数据)新修好 26 条、新挂 7 条,差值 +3.2%,区间 [+1.2%, +5.1%],能说确实变好。注意第二份的「要检测 3 个点约需 512 条」比第一份少,因为这份数据里不一致的用例更多,逐条差值的方差是另一个数。样本量公式里的 ω² 要用**你自己的数据**估,别抄别人的数字。

最后给这些函数加一份测试,锁住已知答案:

```python
# agent-zero-lab/part10/test_stats548.py
"""Day 548–550 加进 stats.py 的函数,各锁一个已知答案。运行:uv run pytest part10/test_stats548.py -q"""
import math
from itertools import combinations
from math import comb

from part10.stats import (
    bonferroni,
    bootstrap_ci,
    clustered_se,
    holm,
    mcnemar_exact,
    mde,
    naive_se,
    paired_diff,
    pass_hat_k,
    required_n,
    wilson_ci,
    wilson_ci_float,
)


def test_each_case_own_cluster_equals_naive():
    x = [1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 1.0, 1.0]
    own = [str(i) for i in range(len(x))]
    assert math.isclose(clustered_se(x, own), naive_se(x) * math.sqrt((len(x) - 1) / len(x)))


def test_clustered_se_bigger_when_cluster_agrees():
    x = [1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0]
    cl = ["a", "a", "a", "b", "b", "b", "c", "c", "c", "d", "d", "d"]
    assert clustered_se(x, cl) > 1.5 * naive_se(x)   # 同簇结果完全一致,标准误至少大一半(实际 0.25 对 0.151)


def test_wilson_float_matches_int():
    assert wilson_ci_float(19.0, 20.0) == wilson_ci(19, 20)


def test_mcnemar_14_vs_4():
    a = [1] * 4 + [0] * 14
    b = [0] * 4 + [1] * 14
    r = mcnemar_exact(a, b)
    assert (r["a_only"], r["b_only"]) == (4, 14)
    assert math.isclose(r["p_value"], 0.030884, abs_tol=1e-5)


def test_mcnemar_no_discordant():
    assert mcnemar_exact([1, 0, 1], [1, 0, 1])["p_value"] == 1.0


def test_paired_diff_all_same_has_zero_width():
    r = paired_diff([1, 0, 1, 1], [1, 0, 1, 1])
    assert r["diff"] == 0 and r["lo"] == r["hi"] == 0


def test_bootstrap_ci_reproducible_and_inside_range():
    x = [1.0] * 8 + [0.0] * 2
    assert bootstrap_ci(x, seed=1) == bootstrap_ci(x, seed=1)
    lo, hi = bootstrap_ci(x, seed=1)
    assert 0.5 <= lo < 0.8 < hi <= 1.0


def test_pass_hat_k_matches_brute_force():
    runs = [1] * 13 + [0] * 2
    for k in (1, 3, 5):
        brute = sum(all(runs[i] for i in c) for c in combinations(range(15), k)) / comb(15, k)
        assert math.isclose(pass_hat_k([13], 15, k), brute)


def test_required_n_and_mde_roundtrip():
    n = required_n(0.03, 0.0781)
    assert round(n) == 681
    assert math.isclose(mde(math.sqrt(0.0781 / n)), 0.03)


def test_holm_beats_bonferroni():
    p = [0.001, 0.008, 0.009, 0.04, 0.2, 0.5]
    assert sum(bonferroni(p)) == 2 and sum(holm(p)) == 3
```

<div class="line-notes">

- `def test_each_case_own_cluster_equals_naive():` 每条自成一簇时,聚类 SE 等于普通 SE 乘 √((n−1)/n)(Day 548 练习 1 的结论)。
- `assert clustered_se(x, cl) > 1.5 * naive_se(x)   # 同簇结果完全一致,标准误至少大一半(实际 0.25 对 0.151)` 四个簇,每个簇内三条完全一致:聚类 SE 0.25,普通 SE 0.151。
- `assert wilson_ci_float(19.0, 20.0) == wilson_ci(19, 20)` 浮点版和整数版给同样的答案。
- `assert math.isclose(r["p_value"], 0.030884, abs_tol=1e-5)` McNemar 14 比 4,p = 0.030884(Day 548 练习 3)。
- `assert bootstrap_ci(x, seed=1) == bootstrap_ci(x, seed=1)` 同一个种子,bootstrap 结果完全一样。
- `brute = sum(all(runs[i] for i in c) for c in combinations(range(15), k)) / comb(15, k)` pass^k 的公式和暴力列举对照(Day 549 练习 4)。
- `assert round(n) == 681` 3 个点、ω² = 0.0781 要 681 条。
- `assert math.isclose(mde(math.sqrt(0.0781 / n)), 0.03)` `required_n` 和 `mde` 是互逆的:用 681 条算出的 MDE 正好是 3 个点。
- `assert sum(bonferroni(p)) == 2 and sum(holm(p)) == 3` Holm 比 Bonferroni 多判一个。

</div>

```bash
uv run pytest part10/test_stats548.py -q
```

```text
..........                                                               [100%]
10 passed in 1.06s
```

## 今天往 stats.py 里加了什么

| 函数 | 做什么 | 哪一节 |
| --- | --- | --- |
| `z_of(p)` | 标准正态分位数(标准库 `NormalDist`) | MDE |
| `mde(se, alpha, power)` | 最小可检测差异 = (z + z) × SE | MDE |
| `required_n(delta, omega2, ...)` | 检测出 delta 需要的条数 | MDE |
| `power_of(delta, se)` | 真实提升 delta、标准误 se 时的功效 | MDE |
| `holm(pvalues)`、`bonferroni(pvalues)` | 多重比较校正,返回每个是否显著 | 多重比较 |
| `report_line(...)` | 把差值、区间、MDE 变成给人看的一句话 | 怎么跟老板说 |

到这里 `part10/stats.py` 一共有 22 个函数,按顺序是:Day 547 的 `wald_ci`、`wilson_ci`、`fmt_rate`;Day 548 的 `naive_se`、`clustered_se`、`design_effect`、`wilson_ci_cluster`、`wilson_ci_float`、`paired_diff`、`mcnemar_exact`;Day 549 的 `bootstrap_means`、`bootstrap_ci`、`pass_hat_k`、`pass_at_k`、`variance_split`;Day 550 的上面这 7 个(`z_of`、`mde`、`required_n`、`power_of`、`holm`、`bonferroni`、`report_line`)。顶部的导入有 `math`、`defaultdict`、`NormalDist`、`numpy`。Day 551 开始讲大规模评审,会再用到区间。

## 动手练习

**练习 1:三个样本量问题。** (A)想检测 4 个点的提升(α = 0.05,功效 80%,考虑聚类,ω² = 0.0781,设计效应 1.28);(B)功效从 80% 提到 90%,检测 3 个点;(C)α 放宽到 0.10,检测 3 个点。各需要多少条?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex550_n.py
"""练习 1:三个问题,算要多少条。"""
from part10.stats import required_n

OMEGA2 = 0.0781   # Day 550 前面算出的逐条差值方差
DEFF = 1.28       # 设计效应

print("问题 A:想检测 4 个点的提升(α=0.05,功效 80%,考虑聚类)")
n = required_n(0.04, OMEGA2) * DEFF
print(f"  需要 {n:.0f} 条 = {n / 3:.0f} 个场景 × 3 种说法")
print("问题 B:功效从 80% 提到 90%,检测 3 个点")
n80 = required_n(0.03, OMEGA2) * DEFF
n90 = required_n(0.03, OMEGA2, power=0.9) * DEFF
print(f"  80% 要 {n80:.0f} 条,90% 要 {n90:.0f} 条,多 {n90 / n80 - 1:.0%}")
print("问题 C:检测 3 个点,但只要求 α=0.10(宽松一点)")
n10 = required_n(0.03, OMEGA2, alpha=0.10) * DEFF
print(f"  α=0.10 要 {n10:.0f} 条,比 α=0.05 的 {n80:.0f} 条少 {1 - n10 / n80:.0%}")
```

<div class="line-notes">

- `OMEGA2 = 0.0781   # Day 550 前面算出的逐条差值方差` 前面算出的 ω²。
- `n = required_n(0.04, OMEGA2) * DEFF` 公式 2.8016² × 0.0781 / 0.04² = 383,乘设计效应 1.28 得 490。
- `n90 = required_n(0.03, OMEGA2, power=0.9) * DEFF` 功效 90% 时 z_{0.90} = 1.2816,(1.96 + 1.2816)² = 10.51,比 80% 时的 7.85 多 34%。
- `n10 = required_n(0.03, OMEGA2, alpha=0.10) * DEFF` α = 0.10 时 z_{0.95} = 1.645,(1.645 + 0.8416)² = 6.18,比 7.85 少 21%。

</div>

```bash
uv run python -m part10.ex550_n
```

```text
问题 A:想检测 4 个点的提升(α=0.05,功效 80%,考虑聚类)
  需要 490 条 = 163 个场景 × 3 种说法
问题 B:功效从 80% 提到 90%,检测 3 个点
  80% 要 872 条,90% 要 1167 条,多 34%
问题 C:检测 3 个点,但只要求 α=0.10(宽松一点)
  α=0.10 要 687 条,比 α=0.05 的 872 条少 21%
```

(A)490 条,即 163 个场景 × 3 种说法;(B)90% 的功效要 1167 条,比 80% 多 34%,功效越高越贵;(C)α 放宽到 0.10 只要 687 条,少 21%,代价是误报率翻倍。把 α 放宽是换了一个更容易出结论的标准,不是免费的午餐。
</details>

**练习 2:8 个指标,Holm 一步一步走。** 报告里有 8 个指标的 p 值,`[0.003, 0.006, 0.007, 0.0075, 0.034, 0.18, 0.4, 0.76]`。用 Holm 和 Bonferroni 各判哪些显著?不校正的话呢?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex550_holm_hand.py
"""练习 2:报告里有 8 个指标的 p 值,Holm 一步一步走。"""
from part10.stats import bonferroni, holm

names = ["总分", "退款模块", "发票模块", "套餐模块", "P0 回归", "judge 分", "延迟", "成本"]
pvals = [0.003, 0.006, 0.007, 0.0075, 0.034, 0.18, 0.4, 0.76]
m = len(pvals)
order = sorted(range(m), key=lambda i: pvals[i])
print(f"{'排名':>4} {'指标':<8} {"p":>7} {'Holm 门槛 α/(m−排名)':>20} {'过?':>4}")
stopped = False
for rank, i in enumerate(order):
    thr = 0.05 / (m - rank)
    ok = (not stopped) and pvals[i] <= thr
    if not ok:
        stopped = True
    print(f"{rank + 1:>4} {names[i]:<8} {pvals[i]:>7.4f} {thr:>20.4f} {'过' if ok else '不过':>4}")
print("Bonferroni 门槛 0.05/8 = 0.00625,显著的:", [names[i] for i in range(m) if bonferroni(pvals)[i]])
print("Holm 显著的:", [names[i] for i in range(m) if holm(pvals)[i]])
print("不校正(p<0.05)显著的:", [names[i] for i in range(m) if pvals[i] < 0.05])
```

<div class="line-notes">

- `names = ["总分", "退款模块", "发票模块", "套餐模块", "P0 回归", "judge 分", "延迟", "成本"]` 8 个指标的名字,和 p 值一一对应。
- `order = sorted(range(m), key=lambda i: pvals[i])` p 值从小到大排队,这里本来就是有序的。
- `thr = 0.05 / (m - rank)` Holm 门槛:排第 1(rank=0)的是 0.05/8 = 0.00625,第 2 是 0.05/7 = 0.00714,第 3 是 0.05/6 = 0.00833,第 4 是 0.05/5 = 0.01。
- `ok = (not stopped) and pvals[i] <= thr` 只要有一个没过,后面全部不过(`stopped` 变成 True 后一直是 False)。
- `print("Bonferroni 门槛 0.05/8 = 0.00625,显著的:", [names[i] for i in range(m) if bonferroni(pvals)[i]])` Bonferroni:所有指标都和 0.00625 比。

</div>

```bash
uv run python -m part10.ex550_holm_hand
```

```text
  排名 指标             p     Holm 门槛 α/(m−排名)   过?
   1 总分        0.0030               0.0063    过
   2 退款模块      0.0060               0.0071    过
   3 发票模块      0.0070               0.0083    过
   4 套餐模块      0.0075               0.0100    过
   5 P0 回归     0.0340               0.0125   不过
   6 judge 分   0.1800               0.0167   不过
   7 延迟        0.4000               0.0250   不过
   8 成本        0.7600               0.0500   不过
Bonferroni 门槛 0.05/8 = 0.00625,显著的: ['总分', '退款模块']
Holm 显著的: ['总分', '退款模块', '发票模块', '套餐模块']
不校正(p<0.05)显著的: ['总分', '退款模块', '发票模块', '套餐模块', 'P0 回归']
```

Holm 前 4 个都通过(0.003 ≤ 0.00625,0.006 ≤ 0.00714,0.007 ≤ 0.00833,0.0075 ≤ 0.01),第 5 个 0.034 > 0.0125 没过,停。显著的是总分、退款、发票、套餐 4 个。Bonferroni 的门槛一直是 0.00625,只有总分和退款(0.006)过。不校正的话 5 个都显著,P0 回归(0.034)是校正后被淘汰的那一个。
</details>

**练习 3:写 MR 评论。** v2 是降成本的改动(换了便宜的模型)。240 条用例(80 个场景),差值 −0.8 个点,聚类标准误 0.0205。容忍变差不超过 5 个点和不超过 3 个点,两种情况下评论各怎么写?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex550_comment.py
"""练习 3:v2 是一个降成本的改动(换了便宜的模型)。评测:240 条用例(80 个场景),v2 比 v1 低 0.8 个点。写 MR 评论。"""
from part10.stats import mde, report_line

# 假设这是配对 + 聚类算出来的:差值 -0.8 个点,聚类 SE 0.0205
diff, se = -0.008, 0.0205
lo, hi = diff - 1.959964 * se, diff + 1.959964 * se
m = mde(se)
print(f"区间 [{lo:+.1%}, {hi:+.1%}],MDE {m:.1%}")
print(report_line("便宜模型 v2 对比 v1", diff, lo, hi, m))                 # 把它当「想变好」来写,不合适
print(report_line("便宜模型 v2 对比 v1", diff, lo, hi, m, margin=0.05))   # 容忍变差不超过 5 个点
print(report_line("便宜模型 v2 对比 v1", diff, lo, hi, m, margin=0.03))   # 容忍变差不超过 3 个点
```

<div class="line-notes">

- `diff, se = -0.008, 0.0205` 差值 −0.8 个点,聚类标准误 2.05 个点。
- `lo, hi = diff - 1.959964 * se, diff + 1.959964 * se` 区间:−0.008 ± 0.0402 = [−0.048, +0.032]。
- `m = mde(se)` 2.8016 × 0.0205 = 5.7 个点。
- `print(report_line("便宜模型 v2 对比 v1", diff, lo, hi, m))` 把它当「想变好」来写。区间跨 0,会得到一句「没有结论」,这和这次改动的目的不符,第一行只是对照。
- `print(report_line("便宜模型 v2 对比 v1", diff, lo, hi, m, margin=0.05))` 容忍 5 个点:区间下限 −4.8 高于 −5,可以合。
- `print(report_line("便宜模型 v2 对比 v1", diff, lo, hi, m, margin=0.03))` 容忍 3 个点:下限 −4.8 低于 −3,排除不了。

</div>

```bash
uv run python -m part10.ex550_comment
```

```text
区间 [-4.8%, +3.2%],MDE 5.7%
便宜模型 v2 对比 v1:差值 -0.8 个点,95% 区间 [-4.8, +3.2]。区间跨过 0,没有结论。本评测集只能检测 ≥5.7 个点的变化,不是「没效果」,是「测不出来」。
便宜模型 v2 对比 v1:差值 -0.8 个点,95% 区间 [-4.8, +3.2]。区间下限高于 −5 个点,没有证据显示变差超过能容忍的范围,可以合。
便宜模型 v2 对比 v1:差值 -0.8 个点,95% 区间 [-4.8, +3.2]。区间下限 -4.8 低于 −3 个点,这批用例排除不了「变差超过容忍范围」。本评测集只能检测 ≥5.7 个点的变化,不是说变差了,是没能力判断。
```

容忍 5 个点:「便宜模型 v2 对比 v1:差值 −0.8 个点,95% 区间 [−4.8, +3.2]。区间下限高于 −5 个点,没有证据显示变差超过能容忍的范围,可以合。」容忍 3 个点:「……区间下限 −4.8 低于 −3 个点,这批用例排除不了『变差超过容忍范围』。本评测集只能检测 ≥5.7 个点的变化,不是说变差了,是没能力判断。」**同一份数据,两个结论,取决于事先定的容忍度。**容忍度必须在看结果之前定,并写进设计文档(Day 543 那种 G4「差异不显著」要改成「变差不超过 X 个点」),事后挑一个能过的容忍度,就是偷看。
</details>

**练习 4:扩评测集,加场景还是加说法?** 用 `sim_runs.py` 的 `per` 参数,比较五种设计的 MDE:60 场景 × 3、60 × 10、180 × 1、180 × 3、600 × 1,各取 300 份数据的平均标准误。

<details><summary>参考答案</summary>

代码和输出就是上一节「怎么把 MDE 压下去」里的 `ex550_more_cases.py`,结果:60×3(180 条)MDE 5.6%,60×10(600 条)3.5%,180×1(180 条)5.3%,180×3(540 条)3.3%,600×1(600 条)2.9%。三点:同样 180 条,180 个场景 × 1 条(5.3%)比 60 个场景 × 3 条(5.6%)略好;同样 600 条,600 个场景 × 1 条(2.9%)明显好过 60 个场景 × 10 条(3.5%);从 3 条加到 10 条,边际收益在下降,把 600 条全花在新场景上最划算。造新场景比给老场景多想几种说法贵,这是现实里要权衡的:如果造新场景的成本是造新说法的 5 倍,加说法反而更划算。这个比例今天没有实测。
</details>

**验收标准**:`power_formula.py` 打出 MDE 6.6%(聚类)、要检测 3 个点需 869 条;`power_sim.py` 公式功效与实际检测比例的最大差 3 个点以内;`multi_sim.py` 里 6 个模块不校正的至少一个显著约 27%、校正后约 5%;`check_holm.py` 500 组随机 p 值零不一致;`pytest` 10 个全过;能不看文章默写 `mde` 和 `holm`;能回答「没有显著差异」这句话为什么必须带上 MDE。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 功效(power) | 真实存在某个大小的提升时,评测能把它检测出来的概率。常用目标 80% |
| 第一类错误 / 误报 | 其实没提升,却判定有提升。概率就是显著性水平 α,通常 5% |
| 第二类错误 / 漏报 | 其实有提升,却没检测出来。概率 = 1 − 功效 |
| 显著性水平 α | 愿意承担的误报概率,0.05 时对应 95% 区间 |
| 最小可检测差异(MDE) | 给定 α 和功效,真实提升至少多大才有把握检测出来:(z_{α/2} + z_{功效}) × SE |
| ω²(逐条差值方差) | 两个版本在同一条用例上得分之差的方差,样本量公式的输入。严格地说它还含重跑噪声,今天不细分 |
| 多重比较 | 同时检验很多指标,至少一个碰巧显著的概率远大于 α(m 个独立检验是 1 − (1−α)^m) |
| Bonferroni 校正 | 每个检验用 α/m 做门槛,简单但保守 |
| Holm 校正 | p 值排队,第 i 小的和 α/(m−i+1) 比,第一个没过的停止。不比 Bonferroni 弱 |
| p-hacking | 靠挑选指标、模块、子集、容忍度,直到出现显著结果,再只汇报那个 |
| 主指标 | 事先约定、合不合并只看它的那一个指标,其余当护栏 |
| 容忍度(margin) | 「没变差」的判断里,允许变差多少,必须事先定 |
| 非劣效 | 想证明新版本「不比旧版本差超过 margin」,和证明「更好」是两种目标 |
| z 值 | 标准正态分布的分位数,1.96 对应 95% 双侧,0.8416 对应 80% 功效 |

## 常见误区

**「没有显著差异」不带 MDE。** 读的人会听成「没效果」。同样一句话,带上「本评测集只能检测 ≥6.6 个点的变化」,意思就变成「我们没能力判断」。

**把区间跨 0 当成「改动没用」。** 跨 0 只说明没证明有用。真实提升 2.8 个点时,180 条的评测集有 70% 的概率跨 0。

**样本量公式里的 ω² 抄别人的数字。** 两份数据里,不一致用例多的那份 ω² 大,需要的条数就不同(512 对 869)。用你自己以前评测的数据估。

**想靠加说法扩评测集。** 用例数相同时,新场景比新说法值钱。60 个场景 × 10 条(MDE 3.5%)不如 180 个场景 × 3 条(3.3%)。

**不配对。** 同样检测 3 个点,不配对要 3085 条,配对 681 条。别为了省事让两个版本跑不同的用例。

**看 8 个指标,只报告「显著」的那个。** 不校正,6 个模块里至少一个「显著」的概率是 27.5%。事先定主指标,其余当护栏;一定要同时看多个时用 Holm。

**事后挑容忍度。** 同一份数据,容忍 5 个点能合,容忍 3 个点不能合。容忍度写进设计文档,在看结果之前定。

**证明「没变差」比证明「变好」便宜。** 一样贵:同样要 869 条才能把区间收窄到 ±3 个点。

**把功效目标拉到 90% 以上,把 α 放宽到 0.1,以为是免费的。** 前者多 34% 的用例,后者误报率翻倍。

## 学习资料

### 文档与文章

- [Evan Miller《Adding Error Bars to Evals》](https://arxiv.org/abs/2411.00640)(2024):第 5 节是今天的样本量公式(公式 9)和最小可检测差异,附录 B 有推导。这条路四天的统计内容,基本都能在这篇里对上。
- [Anthropic · A statistical approach to model evaluations](https://www.anthropic.com/research/statistical-approach-to-model-evals):论文的短介绍,面向做评测的工程师。
- [Wikipedia · Power of a test](https://en.wikipedia.org/wiki/Power_of_a_test):功效的定义,两类错误的对照表。
- [Wikipedia · Holm–Bonferroni method](https://en.wikipedia.org/wiki/Holm%E2%80%93Bonferroni_method):Holm 的步骤和为什么它总是不弱于 Bonferroni。
- [statsmodels · multipletests](https://www.statsmodels.org/stable/generated/statsmodels.stats.multitest.multipletests.html):今天用来核对的现成实现,还有 `fdr_bh`(控制错误发现率)等别的方法。
- [scipy · false_discovery_control](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.false_discovery_control.html):另一类多重比较校正:控制「显著的里面有多少是假的」(FDR),指标很多(几十上百个)时比 Holm 更常用。
- [Hamel Husain《Your AI Product Needs Evals》](https://hamel.dev/blog/posts/evals/):从工程角度讲怎么做评测。统计之外的部分,做评测的人都该读。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1vr421M75j&autoplay=0&high_quality=1" title="【小白学统计】Power功效分析及样本量计算,实验设计如何确定最小样本量?假设检验中的两类错误,Power功效分析专用软件分享" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>小白在学统计 · 【小白学统计】Power功效分析及样本量计算 · 10 分钟。两类错误和功效分析的概念,有专用软件的演示,我们用自己的代码,看前半部分概念就够。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Pr4y1e7A5&p=13&autoplay=0&high_quality=1" title="StatQuest 统计学基础 第 13 集 Statistical Power" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>至冬川搬运 · [StatQuest] Statistics Fundamentals 合集第 13 集(Statistical Power, Clearly Explained!!!)· 英文。用两条钟形曲线讲功效,和今天的图是同一回事;第 14 集讲 Power Analysis。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/VX_M3tIyiYk" title="Power Analysis, Clearly Explained!!!" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>StatQuest with Josh Starmer · Power Analysis, Clearly Explained!!! · 英文,有字幕。怎么用功效分析算样本量,和 required_n 对照着看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/HDCOUXE3HMM" title="p-hacking: What it is and how to avoid it!" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>StatQuest with Josh Starmer · p-hacking: What it is and how to avoid it! · 英文。多重比较为什么会让人「发现」不存在的东西。</figcaption>
</figure>

### 书籍

- Alex Reinhart《Statistics Done Wrong: The Woefully Complete Guide》(No Starch Press,2015):讲样本太少的研究为什么常测不出真实效果、多重比较和 p-hacking,和今天的内容高度重合。
- Ron Kohavi、Diane Tang、Ya Xu《Trustworthy Online Controlled Experiments》(Cambridge University Press,2020):线上 A/B 实验的统计方法,包含样本量、功效、多重比较和「不要偷看」的建议,Day 554 起讲线上评测会再用到。
- Jacob Cohen《Statistical Power Analysis for the Behavioral Sciences》(Lawrence Erlbaum,第 2 版,1988):功效分析的经典教科书,偏心理学。不用读,知道出处。

### 开源项目与代码

- 你自己的 `part10/stats.py`:四天一共 22 个函数,加上 `test_stats548.py` 的 10 个测试。
- [statsmodels · stats/power.py](https://github.com/statsmodels/statsmodels/blob/main/statsmodels/stats/power.py):各种检验的功效和样本量计算,可以对照今天的 `required_n` 看现成实现多处理了哪些情形。
- [statsmodels · stats/multitest.py](https://github.com/statsmodels/statsmodels/blob/main/statsmodels/stats/multitest.py):`multipletests` 的实现,几种校正方法都在里面。

## 自测

1. 什么是功效?为什么 180 条的评测集,真实提升 2.8 个点时只有约三成概率检测出来?

<details><summary>答案</summary>

功效是真实存在某个大小的提升时,评测把它检测出来(区间下限大于 0)的概率。180 条的配对加聚类标准误约 0.0189(提升 2.8 个点的那份数据),2.8 个点只有约 1.5 个标准误,而要有 80% 的功效需要 2.8 个标准误,所以功效只有约 32%(公式),2000 次模拟实测 29.9%。
</details>

2. 手算:ω² = 0.0781,想检测 3 个点的提升(α = 0.05,功效 80%),不考虑聚类要多少条?

<details><summary>答案</summary>

n = (1.96 + 0.8416)² × 0.0781 / 0.03² = 7.849 × 0.0781 / 0.0009 ≈ 681 条。考虑聚类(差值的设计效应 1.28)要 681 × 1.28 ≈ 869 条,即 290 个场景 × 3 种说法。
</details>

3. 报告里同时看 6 个模块,v1 和 v2 完全一样,至少有一个显著的概率大概是多少?怎么校正?

<details><summary>答案</summary>

独立时 1 − 0.95⁶ = 26.5%,模拟里实测 27.5%。校正:Bonferroni 每个检验用 α/6 做门槛;Holm 把 p 值排队,第 i 小的和 α/(6−i+1) 比,第一个没过的停下,不弱于 Bonferroni。校正后整体误报率降回约 5%(5.4%)。更根本的办法是事先定一个主指标。
</details>

4. 「v2 没有显著差异」这句话,为什么必须带上 MDE?

<details><summary>答案</summary>

不带的话读的人会理解成「v2 没效果」。带上「本评测集只能检测 ≥6.6 个点的变化」,意思就变成「我们没能力判断」:真实提升 3 个点时,这个评测集只有约 25% 的概率检测出来,没检测出来不能说明没提升。
</details>

5. 想证明「改动没让效果变差超过 3 个点」,和想证明「变好 3 个点」,谁需要的用例更少?

<details><summary>答案</summary>

一样多。两种目标用的是同一个公式,都要把区间收窄到足够精确的程度,都约需要 869 条(本课的数据)。不比「证明变好」便宜。而且容忍度要在看结果之前定。
</details>

6. 面试题:「你们的评测集 150 条,改了一个 prompt 后分数涨了 2 个点,PM 问能不能上线,你怎么回答?」

<details><summary>答案</summary>

先问评测集的结构:150 条来自多少个场景(簇),按场景聚类的标准误是多少。再算两个版本在同一批用例上的配对差值和区间,以及新挂、新修好的用例列表。然后算这个评测集的 MDE:150 条大致只能检测 6 到 7 个点以上的变化,2 个点在它之下,所以多半是「测不出来」,不是「没效果」。我会写:「涨了 2 个点,区间跨过 0,这个评测集只能检测 ≥6 个点的变化;如果要证明 2 个点的提升需要约 X 条(用自己数据的 ω² 算),大约多花 Y」。如果这个改动的目的是不让别的变差(比如重构),先说好容忍度,检验「没变差超过容忍度」。如果同时看了很多指标,事先说明主指标,多个模块一起看时用 Holm 校正。上线与否由风险决定:回滚成本低、小范围灰度,就可以在没有结论的情况下上线并继续观察。
</details>

## 明天预告

Day 551 · 大规模评审(一):校准集差评太少,校正后的通过率带区间。到今天为止,「通过」都是代码判的,准确无误。但很多评测靠另一个模型当裁判(LLM-as-judge),裁判本身会判错。Day 546 实测过:LLM 裁判和代码判题 40 条里不一致 11 条,错在裁判没看到发票数据。明天讲怎么用一小份人工标好的校准集,估计裁判的错误率,再把校正后的通过率也带上区间,把今天学的区间用在「裁判不完美」这个新的不确定性上。
