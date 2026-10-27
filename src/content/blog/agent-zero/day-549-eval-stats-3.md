---
title: 'Day 549 · 评测统计学(三):bootstrap 和 Agent 自己在抖'
description: 'bootstrap 是把手里的用例当成整个世界,有放回地重抽几千次,看分数怎么波动,按场景重抽就能把聚类带进去,不靠公式也能给出区间。然后讲另一个不确定性:同一个 Agent、同一批工单重跑,结果也会变。用补跑的真实数据拆出「换题」和「重跑」两块方差,看 temperature=0 为什么管不了,每题多跑几遍收益有多大,pass^k 怎么算。'
pubDate: 2026-10-27
regime: none
tags: ['eval', 'statistics', 'bootstrap', 'variance', 'pass-k', 'python', 'agent-zero']
series: 'agent-zero'
day: 549
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 548](/blog/agent-zero/day-548-eval-stats-2/) 讲了两件事:用例成组出现时(同一场景的三种说法)要用聚类标准误,v1 的设计效应是 1.93,180 条只相当于约 93 条独立样本;两个版本跑同一批用例要配对,逐条做差,v2 − v1 是 +1.1 个点,区间 [−3.5, +5.7],跨过 0。这些区间都靠公式,公式有前提:分布接近正态、簇不能太少。簇只有 8 个的时候,Day 548 就说了「聚类标准误偏小,不稳」。

今天换一种不靠公式的办法,**bootstrap**。然后讲一个到现在都没碰过的不确定性:同一个版本、同一批用例,**重跑一遍结果也会变**。前面所有的区间,说的都是「换一批用例会怎样」,没有一个说「同一批用例再跑一遍会怎样」。

## 今天要解决的问题

学完今天你应该能做到:

1. 解释 **bootstrap**(第一个新概念):为什么「有放回地重抽」能模拟「换一批用例」,并手写 `bootstrap_means`;按场景重抽,给 v1 的通过率和 v2 − v1 的差值算出区间,和 Day 548 的公式结果对上(v1 [67.8%, 85.0%] 对公式的 [67.1%, 84.1%];差值 [−3.9%, +5.6%] 对 [−3.5%, +5.7%])。
2. 说出 bootstrap 失效的一个典型情形:手里 40 条全过,重抽出来永远全过,区间是 [100%, 100%]。
3. 区分评测里的两种抖动:「换题」(用例抽样)和「重跑」(同一批用例再跑,第二个新概念**重跑方差**),用 Day 541 的 8 张工单补跑 10 遍的真实数据,拆出两块各是多少。
4. 回答三个实际问题:`temperature=0` 能不能让 Agent 不抖(不能,有实跑数据);每题多跑 K 遍能把整套得分的抖动降多少,降到哪里就不降了;为什么汇报要同时给 pass@k 和 pass^k。

预计用时 3 小时。花费约 ¥0.51(补跑 10 遍:single ¥0.158、workflow ¥0.054、hybrid2 ¥0.109,合计 ¥0.321;另有 temperature 的实验 ¥0.111,和一次调试 ¥0.08,算式见各节)。前置:[Day 548](/blog/agent-zero/day-548-eval-stats-2/)(`clustered_se`、`paired_diff`)、[Day 547](/blog/agent-zero/day-547-eval-stats-1/)(`stats.py`、`runs.json`、`arch_bench_raw.json`)、[Day 540](/blog/agent-zero/day-540-orch-1/)(`arch_four.py`、`orch_tools.py`)、[Day 541](/blog/agent-zero/day-541-orch-2/)(`arch_bench.py`、`hybrid_v2.py`、`bench_tasks.py`,补跑要用)、[Day 32](/blog/agent-zero/day-032-modules/)(模块)。需要新装 numpy:`uv add numpy`(我这里 uv 装到 numpy 2.5.4,scipy 是 Day 547 装的 1.18.1)。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `bootstrap_means`,再口述「为什么按单条重抽会把 Day 548 的聚类白做了」;做练习,做不出再展开参考答案,看完关掉重写一遍。

## bootstrap 最小版:从 10 条里抽 10 次

先不上 numpy,用 15 行纯 Python 看一遍想法。我们只有一份数据,它是真实世界里的一小把。想知道「换一把会怎么样」,又没法真的重新评测。**bootstrap**(自助法)的办法是:假装手里这一把就是整个世界,从里面抽样,抽出来的当作「换一把」的替身。

具体做法:手里有 10 条结果,过了 8 条。随机抽一条,记下结果,**把它放回去**,再抽,一共抽 10 次,得到一份新的 10 条。放回去的意思是同一条可能被抽中好几次,也可能一次都没被抽中。这样抽出来的一份叫一次**重抽**(resample),算它的通过率。

```python
# agent-zero-lab/part10/boot_hand.py
"""bootstrap 最小演示:10 条用例的结果,有放回抽 10 次,算一次通过率。"""
import random

results = [1, 1, 1, 0, 1, 1, 0, 1, 1, 1]   # 10 条用例,过了 8 条
rng = random.Random(3)

print(f"原始:{results},通过率 {sum(results) / len(results):.0%}")
for t in range(1, 6):
    idx = [rng.randrange(len(results)) for _ in range(len(results))]   # 抽 10 次「第几条」,可以重复
    resample = [results[i] for i in idx]
    print(f"第 {t} 次重抽:抽到的编号 {idx}")
    print(f"           结果 {resample},通过率 {sum(resample) / len(resample):.0%}")
```

<div class="line-notes">

- `results = [1, 1, 1, 0, 1, 1, 0, 1, 1, 1]   # 10 条用例,过了 8 条` 编号 0 到 9,第 3 条和第 6 条是挂的。
- `rng = random.Random(3)` 固定种子 3,每个人跑出来一样。
- `idx = [rng.randrange(len(results)) for _ in range(len(results))]   # 抽 10 次「第几条」,可以重复` `randrange(10)` 随机给一个 0 到 9 的整数,抽 10 次。因为每次都是从全部 10 条里抽(相当于抽完放回),同一个编号可以出现多次。第 1 次的结果是 `[3, 9, 8, 2, 5, 9, 7, 9, 1, 9]`,9 号被抽中了 4 次。
- `resample = [results[i] for i in idx]` 用抽到的编号去取结果。第 1 次抽到了 3 号(挂的那条),所以结果里有一个 0,另外 9 条都是 1,通过率 90%。
- `print(f"           结果 {resample},通过率 {sum(resample) / len(resample):.0%}")` 每次重抽的通过率是 90%、80%、70%、70%、80%。

</div>

```bash
uv run python -m part10.boot_hand
```

```text
原始:[1, 1, 1, 0, 1, 1, 0, 1, 1, 1],通过率 80%
第 1 次重抽:抽到的编号 [3, 9, 8, 2, 5, 9, 7, 9, 1, 9]
           结果 [0, 1, 1, 1, 1, 1, 1, 1, 1, 1],通过率 90%
第 2 次重抽:抽到的编号 [0, 7, 4, 8, 3, 3, 7, 8, 8, 7]
           结果 [1, 1, 1, 1, 0, 0, 1, 1, 1, 1],通过率 80%
第 3 次重抽:抽到的编号 [6, 2, 3, 2, 8, 6, 0, 1, 2, 9]
           结果 [0, 1, 0, 1, 1, 0, 1, 1, 1, 1],通过率 70%
第 4 次重抽:抽到的编号 [0, 4, 0, 4, 7, 9, 6, 6, 6, 9]
           结果 [1, 1, 1, 1, 1, 1, 0, 0, 0, 1],通过率 70%
第 5 次重抽:抽到的编号 [7, 2, 5, 1, 0, 2, 7, 3, 4, 6]
           结果 [1, 1, 1, 1, 1, 1, 1, 0, 1, 0],通过率 80%
```

五次重抽得到 90%、80%、70%、70%、80%,每次都不一样,而且围着原来的 80% 抖。如果重复几千次,把这几千个通过率排队,最低的 2.5% 和最高的 2.5% 去掉,中间剩下的范围就是 95% 区间。这叫**百分位法**(percentile bootstrap)。它做的假设很少:只要你相信手里的用例能代表整个用例池,就能用。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="bootstrap 的过程:左边是原始 10 条结果(8 过 2 挂),中间是三次有放回的重抽,得到的通过率分别是 90%、80%、70%,重复几千次后取通过率分布的中间 95% 作为区间">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12">
    <text x="30" y="28" fill="var(--ink)">手里的 10 条:80%</text>
    <g fill="var(--mem)">
      <rect x="30" y="38" width="18" height="18"/><rect x="52" y="38" width="18" height="18"/><rect x="74" y="38" width="18" height="18"/>
      <rect x="118" y="38" width="18" height="18"/><rect x="140" y="38" width="18" height="18"/>
      <rect x="184" y="38" width="18" height="18"/><rect x="206" y="38" width="18" height="18"/><rect x="228" y="38" width="18" height="18"/>
    </g>
    <g fill="var(--compute)"><rect x="96" y="38" width="18" height="18"/><rect x="162" y="38" width="18" height="18"/></g>
    <text x="30" y="92" fill="var(--ink-soft)">有放回地抽 10 次,每次都从这 10 条里抽</text>
    <line x1="260" y1="48" x2="320" y2="116" stroke="var(--rule)"/>
    <line x1="260" y1="48" x2="320" y2="168" stroke="var(--rule)"/>
    <line x1="260" y1="48" x2="320" y2="220" stroke="var(--rule)"/>
    <text x="30" y="124" fill="var(--ink)">重抽 1:90%</text>
    <g fill="var(--mem)">
      <rect x="130" y="108" width="12" height="12"/><rect x="144" y="108" width="12" height="12"/><rect x="158" y="108" width="12" height="12"/><rect x="172" y="108" width="12" height="12"/><rect x="186" y="108" width="12" height="12"/><rect x="200" y="108" width="12" height="12"/><rect x="214" y="108" width="12" height="12"/><rect x="228" y="108" width="12" height="12"/><rect x="242" y="108" width="12" height="12"/>
    </g>
    <g fill="var(--compute)"><rect x="116" y="108" width="12" height="12"/></g>
    <text x="30" y="176" fill="var(--ink)">重抽 2:80%</text>
    <g fill="var(--mem)">
      <rect x="116" y="160" width="12" height="12"/><rect x="130" y="160" width="12" height="12"/><rect x="144" y="160" width="12" height="12"/><rect x="158" y="160" width="12" height="12"/>
      <rect x="214" y="160" width="12" height="12"/><rect x="228" y="160" width="12" height="12"/><rect x="242" y="160" width="12" height="12"/><rect x="200" y="160" width="12" height="12"/>
    </g>
    <g fill="var(--compute)"><rect x="172" y="160" width="12" height="12"/><rect x="186" y="160" width="12" height="12"/></g>
    <text x="30" y="228" fill="var(--ink)">重抽 3:70%</text>
    <g fill="var(--mem)">
      <rect x="130" y="212" width="12" height="12"/><rect x="158" y="212" width="12" height="12"/><rect x="172" y="212" width="12" height="12"/><rect x="200" y="212" width="12" height="12"/><rect x="214" y="212" width="12" height="12"/><rect x="228" y="212" width="12" height="12"/><rect x="242" y="212" width="12" height="12"/>
    </g>
    <g fill="var(--compute)"><rect x="116" y="212" width="12" height="12"/><rect x="144" y="212" width="12" height="12"/><rect x="186" y="212" width="12" height="12"/></g>
    <text x="340" y="124" fill="var(--ink-soft)">……重复 5000 次</text>
    <line x1="340" y1="196" x2="610" y2="196" stroke="var(--rule)"/>
    <polyline points="340,196 380,190 420,166 460,128 500,100 540,128 580,166 610,190" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="2"/>
    <line x1="400" y1="150" x2="400" y2="196" stroke="var(--compute)" stroke-dasharray="3 3"/>
    <line x1="560" y1="150" x2="560" y2="196" stroke="var(--compute)" stroke-dasharray="3 3"/>
    <text x="376" y="214" fill="var(--compute)">2.5%</text>
    <text x="536" y="214" fill="var(--compute)">97.5%</text>
    <text x="340" y="238" fill="var(--ink-soft)">5000 个通过率排队,取中间 95%</text>
  </g>
</svg>
<figcaption>蓝色是通过的用例,琥珀色是挂的。每次重抽得到一个通过率,重复几千次后这些通过率的分布,就是「换一把用例会怎样」的替身。这张图是示意,没有按真实重抽结果画比例。</figcaption>
</figure>

## 5000 次的版本:numpy 来干

手写循环 5000 次也行,但慢。numpy 能一次把 5000 × 60 个随机编号全抽出来。需要先认识 numpy 的两个小动作(相当于 JS 的两个常见操作):

```python
# agent-zero-lab/part10/np_intro.py
"""numpy 的两个小动作:用一个数组当下标去取值,以及按行求和。bootstrap 的代码里全是这两下。"""
import numpy as np

sums = np.array([3, 0, 2])               # 三个簇各自的得分之和
pick = np.array([[0, 2], [1, 1]])        # 两次重抽,每次抽两个簇的编号
print("sums[pick]            =", sums[pick].tolist())
print("sums[pick].sum(axis=1) =", sums[pick].sum(axis=1).tolist())
```

<div class="line-notes">

- `import numpy as np` numpy 是 Python 做数值计算的标准库,`np.array` 是它的数组,同类型元素、整体运算,不像 list 什么都能装。
- `sums = np.array([3, 0, 2])               # 三个簇各自的得分之和` 三个元素的一维数组。
- `pick = np.array([[0, 2], [1, 1]])        # 两次重抽,每次抽两个簇的编号` 二维数组,2 行 2 列,每一行是一次重抽抽到的簇编号。
- `print("sums[pick]            =", sums[pick].tolist())` 用一个数组当下标:`pick` 里每个编号都换成 `sums` 里对应位置的值,形状保持不变。0 号换成 3,2 号换成 2,1 号换成 0,所以第一行 `[0, 2]` 变成 `[3, 2]`,第二行 `[1, 1]` 变成 `[0, 0]`。相当于 JS 的 `pick.map(row => row.map(i => sums[i]))`。
- `print("sums[pick].sum(axis=1) =", sums[pick].sum(axis=1).tolist())` `axis=1` 是「沿着每一行加起来」,得到每次重抽的总和:3+2 = 5、0+0 = 0。`tolist()` 只是把结果转回 list 方便打印。

</div>

```bash
uv run python -m part10.np_intro
```

```text
sums[pick]            = [[3, 2], [0, 0]]
sums[pick].sum(axis=1) = [5, 0]
```

有了这两个动作,bootstrap 的主体就是三行。往 `stats.py` 顶部加 `import numpy as np`(放在 `from collections import defaultdict` 后面空一行),末尾追加:

```python
# agent-zero-lab/part10/stats.py(新增)
def bootstrap_means(values: list[float], clusters: list[str] | None = None,
                    n_boot: int = 5000, seed: int = 0) -> np.ndarray:
    """有放回重抽样 n_boot 次,每次返回重抽后的平均值。

    clusters 为 None:按单条用例重抽(默认每条独立)。
    给了 clusters:按簇重抽,抽中一个簇就把它的所有用例一起带上。
    """
    if len(values) == 0:
        raise ValueError("values 是空的,没有东西可以重抽")
    rng = np.random.default_rng(seed)
    x = np.asarray(values, dtype=float)
    keys = clusters if clusters is not None else [str(i) for i in range(len(x))]
    groups: dict[str, list[int]] = defaultdict(list)
    for i, c in enumerate(keys):
        groups[c].append(i)
    sums = np.array([x[idx].sum() for idx in groups.values()])    # 每个簇的得分总和
    sizes = np.array([len(idx) for idx in groups.values()])        # 每个簇有几条用例
    pick = rng.integers(0, len(groups), size=(n_boot, len(groups)))  # 每次重抽:抽 G 次簇编号
    return sums[pick].sum(axis=1) / sizes[pick].sum(axis=1)


def bootstrap_ci(values: list[float], clusters: list[str] | None = None,
                 n_boot: int = 5000, seed: int = 0, alpha: float = 0.05) -> tuple[float, float]:
    """百分位 bootstrap 区间:把 n_boot 个重抽平均值排序,取两头各 alpha/2 的位置。"""
    boot = bootstrap_means(values, clusters, n_boot, seed)
    lo, hi = np.percentile(boot, [100 * alpha / 2, 100 * (1 - alpha / 2)])
    return float(lo), float(hi)
```

<div class="line-notes">

- `def bootstrap_means(values: list[float], clusters: list[str] | None = None,` 输入每条用例的值(0/1,也可以是 0/+1/−1 的差值),可选的簇标签。返回 5000 个重抽后的平均值。
- `if len(values) == 0:` 空列表没东西可抽。我第一版没有这一行,下一小节演示后果。
- `rng = np.random.default_rng(seed)` numpy 新版的随机数发生器,`seed` 固定就可复现。
- `x = np.asarray(values, dtype=float)` 把 Python list 转成 numpy 浮点数组。
- `keys = clusters if clusters is not None else [str(i) for i in range(len(x))]` 没给簇标签,就让每条用例自成一簇,编号 `"0"`、`"1"`……。这样「按单条重抽」是「按簇重抽」的特例,一份代码两种用法。
- `groups: dict[str, list[int]] = defaultdict(list)` 簇标签到「该簇有哪几条用例的下标」。
- `groups[c].append(i)` 把第 i 条放进它的簇。v1 的 `S00` 簇里是下标 0、1、2。
- `sums = np.array([x[idx].sum() for idx in groups.values()])    # 每个簇的得分总和` `x[idx]` 取出这个簇的几条结果,加起来。S00 是 3,S02 是 1。
- `sizes = np.array([len(idx) for idx in groups.values()])        # 每个簇有几条用例` 每个簇的条数,这里都是 3;簇大小不一样时,这一行让算法依然正确。
- `pick = rng.integers(0, len(groups), size=(n_boot, len(groups)))  # 每次重抽:抽 G 次簇编号` 形状 5000 行 × 60 列的整数矩阵,每个数是 0 到 59 的簇编号。每一行就是一次重抽:抽 60 次簇,可以重复。
- `return sums[pick].sum(axis=1) / sizes[pick].sum(axis=1)` 分子:每次重抽抽到的簇的得分总和;分母:抽到的簇一共多少条用例。相除就是这次重抽的通过率。返回 5000 个通过率。
- `def bootstrap_ci(values: list[float], clusters: list[str] | None = None,` 在上面的基础上取百分位。
- `boot = bootstrap_means(values, clusters, n_boot, seed)` 5000 个重抽的平均值。
- `lo, hi = np.percentile(boot, [100 * alpha / 2, 100 * (1 - alpha / 2)])` `alpha=0.05` 时是第 2.5 和第 97.5 百分位,中间 95%。
- `return float(lo), float(hi)` numpy 的数字类型转成普通 Python float。

</div>

### 先演示一个报错(其实是没报错)

我第一版没有 `len(values) == 0` 的检查。传一个空列表给 `bootstrap_ci`:

```text
RuntimeWarning: invalid value encountered in divide
  return sums[pick].sum(axis=1) / sizes[pick].sum(axis=1)
```

只有一条 RuntimeWarning(运行时警告,不是错误),函数返回 `(nan, nan)`:没有簇可抽,分子分母都是空数组求和得 0,0 除以 0 得 `nan`(not a number)。程序不崩,下游代码拿到两个 `nan` 继续跑,最后在报告里变成一行 `[nan%, nan%]`。上面贴的版本加了检查,空列表直接 `ValueError: values 是空的,没有东西可以重抽`。注意这个「0 条」在评测里并不少见:新模块还没有用例、筛选条件写错筛出 0 条。

### 对 v1 跑一遍

把几种区间并排放在一起:Day 547 的 Wilson、按单条重抽、scipy 自带的 `scipy.stats.bootstrap`(用来核对我们手写的)、Day 548 的聚类 Wilson、按场景重抽。

```python
# agent-zero-lab/part10/boot_v1.py
"""v1 的通过率:Wilson、按单条 bootstrap、scipy 的 bootstrap、按场景 bootstrap、聚类 Wilson 放在一起。"""
import json
from pathlib import Path

import numpy as np
from scipy.stats import bootstrap

from part10.stats import bootstrap_ci, bootstrap_means, clustered_se, wilson_ci, wilson_ci_cluster

rows = json.loads((Path(__file__).parent / "data" / "runs.json").read_text())
x = [float(r["v1"]) for r in rows]
cl = [r["scenario"] for r in rows]
p = sum(x) / len(x)

boot = bootstrap_means(x, n_boot=5000, seed=0)
print(f"按单条重抽 5000 次:平均值的均值 {boot.mean():.4f},标准差 {boot.std(ddof=1):.4f}(普通 SE 公式 0.0316)")
bootc = bootstrap_means(x, cl, n_boot=5000, seed=0)
print(f"按场景重抽 5000 次:平均值的均值 {bootc.mean():.4f},标准差 {bootc.std(ddof=1):.4f}(聚类 SE 公式 {clustered_se(x, cl):.4f})")

print()
print(f"Wilson(180 条独立)        [{wilson_ci(138, 180)[0]:.1%}, {wilson_ci(138, 180)[1]:.1%}]")
print(f"bootstrap 按单条           [{bootstrap_ci(x)[0]:.1%}, {bootstrap_ci(x)[1]:.1%}]")
res = bootstrap((np.array(x),), np.mean, n_resamples=5000, method="percentile", rng=np.random.default_rng(0))
print(f"scipy.stats.bootstrap 单条 [{res.confidence_interval.low:.1%}, {res.confidence_interval.high:.1%}]")
print(f"聚类 Wilson(有效样本数)    [{wilson_ci_cluster(x, cl)[0]:.1%}, {wilson_ci_cluster(x, cl)[1]:.1%}]")
print(f"bootstrap 按场景           [{bootstrap_ci(x, cl)[0]:.1%}, {bootstrap_ci(x, cl)[1]:.1%}]")
```

<div class="line-notes">

- `from scipy.stats import bootstrap` scipy 自带的 bootstrap(我装的 1.18.1)。拿它来对答案,不是项目依赖。
- `boot = bootstrap_means(x, n_boot=5000, seed=0)` 按单条重抽,每条各自一簇。
- `print(f"按单条重抽 5000 次:平均值的均值 {boot.mean():.4f},标准差 {boot.std(ddof=1):.4f}(普通 SE 公式 0.0316)")` 5000 个重抽通过率的标准差,就是 bootstrap 对「标准误」的估计:0.0314,和普通 SE 公式的 0.0316 几乎一样。`ddof=1` 是分母用 n−1,和 `naive_se` 一致。
- `bootc = bootstrap_means(x, cl, n_boot=5000, seed=0)` 按场景重抽:每次抽 60 个场景,抽中的场景三条一起带上。
- `res = bootstrap((np.array(x),), np.mean, n_resamples=5000, method="percentile", rng=np.random.default_rng(0))` scipy 的写法:数据要放进元组里,第二个参数是算统计量的函数 `np.mean`,`method="percentile"` 是我们用的百分位法。随机数的参数在 1.18.1 里叫 `rng`,旧教程里的 `random_state` 它已经不认了。
- `print(f"scipy.stats.bootstrap 单条 [{res.confidence_interval.low:.1%}, {res.confidence_interval.high:.1%}]")` 区间在 `confidence_interval.low/high` 里。
- `print(f"bootstrap 按场景           [{bootstrap_ci(x, cl)[0]:.1%}, {bootstrap_ci(x, cl)[1]:.1%}]")` 按场景重抽的 95% 区间。

</div>

```bash
uv run python -m part10.boot_v1
```

```text
按单条重抽 5000 次:平均值的均值 0.7654,标准差 0.0314(普通 SE 公式 0.0316)
按场景重抽 5000 次:平均值的均值 0.7653,标准差 0.0443(聚类 SE 公式 0.0440)

Wilson(180 条独立)        [70.0%, 82.2%]
bootstrap 按单条           [70.6%, 82.8%]
scipy.stats.bootstrap 单条 [70.6%, 82.8%]
聚类 Wilson(有效样本数)    [67.1%, 84.1%]
bootstrap 按场景           [67.8%, 85.0%]
```

三个对照:

- **标准误**:按单条重抽,5000 个通过率的标准差是 0.0314,公式是 0.0316。按场景重抽是 0.0443,Day 548 手算的聚类标准误是 0.0440。bootstrap 和公式互相印证。没有人告诉它「用例成组」,是「按场景重抽」这个动作自己把聚类带进去了。
- **区间**:按单条 [70.6%, 82.8%],我手写的和 scipy 的结果一致(都是 70.6%、82.8%,两边我用的都是种子 0 的发生器);Wilson [70.0%, 82.2%] 差不了多少。按场景 [67.8%, 85.0%],聚类 Wilson 是 [67.1%, 84.1%],同样互相接近,bootstrap 的上限略高。
- **结论**:不管用公式还是 bootstrap,对 v1 的通过率,按场景处理得到的区间(67%~85% 左右),都比假装独立的(70%~82%)宽了 5 个点以上。

### 对差值跑一遍,换种子、换次数

bootstrap 一个好处是任何统计量都能这样做。v2 − v1 的差值,按场景重抽,每次抽 60 个场景,算这批场景里的平均差值。

```python
# agent-zero-lab/part10/boot_diff.py
"""v2 − v1 的差值:bootstrap 按场景重抽,对照 Day 548 的配对+聚类正态近似。"""
import json
from pathlib import Path

from part10.stats import bootstrap_ci, paired_diff

rows = json.loads((Path(__file__).parent / "data" / "runs.json").read_text())
d = [float(r["v2"] - r["v1"]) for r in rows]        # 逐条差值,取值 -1 / 0 / +1
cl = [r["scenario"] for r in rows]

res = paired_diff([r["v1"] for r in rows], [r["v2"] for r in rows], cl)
print(f"配对+聚类 正态近似     [{res['lo']:+.1%}, {res['hi']:+.1%}]")
lo, hi = bootstrap_ci(d, cl, n_boot=5000, seed=0)
print(f"按场景 bootstrap       [{lo:+.1%}, {hi:+.1%}]")
lo, hi = bootstrap_ci(d, None, n_boot=5000, seed=0)
print(f"按单条 bootstrap(错的)[{lo:+.1%}, {hi:+.1%}]   <- 又假设了独立,区间偏窄")
for seed in (1, 2, 3):
    lo, hi = bootstrap_ci(d, cl, n_boot=5000, seed=seed)
    print(f"换种子 {seed}:按场景 bootstrap [{lo:+.2%}, {hi:+.2%}]")
for B in (200, 1000, 5000, 20000):
    lo, hi = bootstrap_ci(d, cl, n_boot=B, seed=0)
    print(f"重抽 {B:>5} 次:[{lo:+.2%}, {hi:+.2%}]")
```

<div class="line-notes">

- `d = [float(r["v2"] - r["v1"]) for r in rows]        # 逐条差值,取值 -1 / 0 / +1` 和 Day 548 的 `paired_diff` 一样先逐条做差。
- `res = paired_diff([r["v1"] for r in rows], [r["v2"] for r in rows], cl)` Day 548 的配对+聚类正态近似,当对照。
- `lo, hi = bootstrap_ci(d, cl, n_boot=5000, seed=0)` 对差值按场景 bootstrap。
- `lo, hi = bootstrap_ci(d, None, n_boot=5000, seed=0)` 不传簇标签,等于按单条重抽,又假设了用例独立。这是个反例。
- `for seed in (1, 2, 3):` 换三个种子,看结果稳不稳。
- `for B in (200, 1000, 5000, 20000):` 换重抽次数,看多少次够用。

</div>

```bash
uv run python -m part10.boot_diff
```

```text
配对+聚类 正态近似     [-3.5%, +5.7%]
按场景 bootstrap       [-3.9%, +5.6%]
按单条 bootstrap(错的)[-2.8%, +5.0%]   <- 又假设了独立,区间偏窄
换种子 1:按场景 bootstrap [-3.33%, +5.56%]
换种子 2:按场景 bootstrap [-3.89%, +5.56%]
换种子 3:按场景 bootstrap [-3.89%, +5.56%]
重抽   200 次:[-2.78%, +6.11%]
重抽  1000 次:[-3.89%, +5.56%]
重抽  5000 次:[-3.89%, +5.56%]
重抽 20000 次:[-3.89%, +5.56%]
```

正态近似 [−3.5%, +5.7%],按场景 bootstrap [−3.9%, +5.6%],两条路给的区间几乎重合,都跨过 0。按单条重抽(第三行)得到 [−2.8%, +5.0%],窄了不少:把同场景的三条当独立,**白做了聚类**。这就是学法里那个口述问题的答案。

换种子的三行和换次数的四行,说明两件事。重抽 200 次时区间 [−2.78%, +6.11%],和 5000 次差了接近一个点,太少了;1000 次以后基本稳定。种子换了,区间端点会在 ±0.5 个点之内晃,原因是 180 个 0/±1 的平均值只能取 1/180 = 0.56 个点的整数倍,百分位落在哪一格有一点运气。所以:**报告里的 bootstrap 区间写一位小数就够,次数 5000 起,别用 100 次**。

### 它到底准不准:又是 2000 份新数据

和前两天一样,用模拟数据检验。真实通过率 75% 已知,四种区间各包住几次:

```python
# agent-zero-lab/part10/boot_coverage.py
"""2000 份新数据(真实通过率 75%),四种区间各包住几次。"""
from part10.make_runs import make
from part10.stats import bootstrap_ci, wilson_ci, wilson_ci_cluster

TRUE_P = 0.75
RERUNS = 2000
names = ["Wilson(独立)", "bootstrap 按单条", "聚类 Wilson", "bootstrap 按场景"]
hit = dict.fromkeys(names, 0)
width = dict.fromkeys(names, 0.0)
for seed in range(1000, 1000 + RERUNS):
    rows = make(seed)
    x = [float(r["v1"]) for r in rows]
    cl = [r["scenario"] for r in rows]
    cis = {
        names[0]: wilson_ci(int(sum(x)), len(x)),
        names[1]: bootstrap_ci(x, n_boot=1000, seed=seed),
        names[2]: wilson_ci_cluster(x, cl),
        names[3]: bootstrap_ci(x, cl, n_boot=1000, seed=seed),
    }
    for name, (lo, hi) in cis.items():
        hit[name] += lo <= TRUE_P <= hi
        width[name] += hi - lo
print(f"{'方法':<18}{'包住率':>8}{'平均宽度':>10}")
for name in names:
    print(f"{name:<18}{hit[name] / RERUNS:>8.1%}{width[name] / RERUNS:>10.1%}")
```

<div class="line-notes">

- `names = ["Wilson(独立)", "bootstrap 按单条", "聚类 Wilson", "bootstrap 按场景"]` 四种做法并排。
- `x = [float(r["v1"]) for r in rows]` 一份新数据里 v1 的 0/1。
- `names[1]: bootstrap_ci(x, n_boot=1000, seed=seed),` 为了 2000 份数据能在几秒内跑完,每份只重抽 1000 次。上面看到 1000 次已经基本稳定。
- `names[3]: bootstrap_ci(x, cl, n_boot=1000, seed=seed),` 按场景。
- `hit[name] += lo <= TRUE_P <= hi` 包住真值 0.75 就加一。

</div>

```bash
uv run python -m part10.boot_coverage
```

```text
方法                     包住率      平均宽度
Wilson(独立)           83.6%     12.5%
bootstrap 按单条        84.0%     12.5%
聚类 Wilson            94.3%     17.6%
bootstrap 按场景        94.5%     17.8%
```

不聚类的两种(Wilson 83.6%、bootstrap 按单条 84.0%)都只有 84% 上下;聚类的两种(聚类 Wilson 94.3%、bootstrap 按场景 94.5%)都在 94% 多。**包住率差不多的两对之间,决定性的区别是有没有处理簇,不是公式还是 bootstrap。**这是今天第一个结论:bootstrap 不是比公式更「准」,它的好处是对差值、对中位数、对「pass^k」这类没有现成公式的统计量也能用,而且用起来是同一套代码。

### 它的软肋:全过的时候

bootstrap 只能从手里的数据里抽。手里全是 1,抽出来永远全是 1:

```python
# agent-zero-lab/part10/boot_fail.py
"""bootstrap 的软肋:手里全是 1,重抽出来永远全是 1。"""
from part10.stats import bootstrap_ci, bootstrap_means, wilson_ci

for k, n in ((40, 40), (0, 12), (19, 20)):
    x = [1.0] * k + [0.0] * (n - k)
    boot = bootstrap_means(x, n_boot=5000, seed=0)
    lo, hi = bootstrap_ci(x, n_boot=5000, seed=0)
    wl, wh = wilson_ci(k, n)
    print(f"{k}/{n:<3} 重抽 5000 次里最小 {boot.min():.0%} 最大 {boot.max():.0%}   bootstrap [{lo:.1%}, {hi:.1%}]   Wilson [{wl:.1%}, {wh:.1%}]")
```

<div class="line-notes">

- `for k, n in ((40, 40), (0, 12), (19, 20)):` 三种情形:hybrid2 的 40/40(Day 541);红队 12 次零成功(Day 547);19/20。
- `x = [1.0] * k + [0.0] * (n - k)` 造 k 个 1 和 n−k 个 0。`[1.0] * 40` 是把一个元素的列表重复 40 次。
- `boot = bootstrap_means(x, n_boot=5000, seed=0)` 5000 次重抽的通过率。
- `print(f"{k}/{n:<3} 重抽 5000 次里最小 {boot.min():.0%} 最大 {boot.max():.0%}   bootstrap [{lo:.1%}, {hi:.1%}]   Wilson [{wl:.1%}, {wh:.1%}]")` 同时打出重抽的最小最大值、bootstrap 区间、Wilson 区间。

</div>

```bash
uv run python -m part10.boot_fail
```

```text
40/40  重抽 5000 次里最小 100% 最大 100%   bootstrap [100.0%, 100.0%]   Wilson [91.2%, 100.0%]
0/12  重抽 5000 次里最小 0% 最大 0%   bootstrap [0.0%, 0.0%]   Wilson [0.0%, 24.2%]
19/20  重抽 5000 次里最小 70% 最大 100%   bootstrap [85.0%, 100.0%]   Wilson [76.4%, 99.1%]
```

40/40:5000 次重抽,最小也是 100%,最大也是 100%,区间 [100%, 100%],宽度为零,和 Day 547 的 Wald 犯了同一个毛病。0/12 同理,而 Wilson 是 [0%, 24.2%]。19/20 的 bootstrap 是 [85%, 100%],Wilson 是 [76.4%, 99.1%],下限还是乐观了不少。所以 Day 547 的结论依然成立:**通过率接近 0 或 100% 时,用 Wilson,bootstrap 不是它的替代。**bootstrap 的主场是差值、比值、多个统计量的组合,以及没有公式的地方。

## Agent 自己在抖

前面所有区间说的都是一件事:换一批用例,分数会怎么抖。现在问另一件事:**同一批用例,同一个版本,再跑一遍,分数会变吗?**对只有确定性代码的程序不会,对 Agent 会:模型的采样有随机性,工具结果的先后、检索的排序也可能不同。

两种抖动要分开看:

- **换题**:你的 8 张工单、60 个场景只是所有可能用例里抽出来的,换一批,分数就变。Day 547–548 全在讲这个。
- **重跑**:同一批用例,同一个版本,再跑一遍,分数也变。这一块 Day 541 开始用 `pass^k` 碰过,但没有量化过。我们把它叫**重跑方差**:同一个用例每跑一遍结果的波动。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="整套评测得分的抖动由两块组成:换题的抖动在每题多跑几遍后不变,重跑的抖动随每题跑的遍数 K 下降;K 从 1 到 30 时总抖动从 3.1 个点降到 1.8 个点,下限是换题的 1.7 个点">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12">
    <line x1="60" y1="200" x2="600" y2="200" stroke="var(--rule)"/>
    <line x1="60" y1="30" x2="60" y2="200" stroke="var(--rule)"/>
    <text x="8" y="54" fill="var(--ink-faint)">3 点</text><text x="8" y="130" fill="var(--ink-faint)">1.5 点</text><text x="22" y="204" fill="var(--ink-faint)">0</text>
    <text x="80" y="218" fill="var(--ink-soft)">K=1</text><text x="190" y="218" fill="var(--ink-soft)">3</text><text x="290" y="218" fill="var(--ink-soft)">5</text><text x="420" y="218" fill="var(--ink-soft)">10</text><text x="560" y="218" fill="var(--ink-soft)">30</text>
    <line x1="60" y1="116" x2="600" y2="116" stroke="var(--rule)" stroke-dasharray="4 4"/>
    <text x="396" y="110" fill="var(--ink-soft)">换题的抖动 1.7 点(下限)</text>
    <polyline points="90,51 200,88 300,100 430,106 570,112" fill="none" stroke="var(--mem)" stroke-width="2.5"/>
    <g fill="var(--mem)"><circle cx="90" cy="51" r="4"/><circle cx="200" cy="88" r="4"/><circle cx="300" cy="100" r="4"/><circle cx="430" cy="106" r="4"/><circle cx="570" cy="112" r="4"/></g>
    <text x="104" y="46" fill="var(--mem)">总抖动 3.1</text>
    <polyline points="90,75 200,127 300,143 430,161 570,177" fill="none" stroke="var(--compute)" stroke-width="2.5"/>
    <g fill="var(--compute)"><circle cx="90" cy="75" r="4"/><circle cx="200" cy="127" r="4"/><circle cx="300" cy="143" r="4"/><circle cx="430" cy="161" r="4"/><circle cx="570" cy="177" r="4"/></g>
    <text x="104" y="92" fill="var(--compute)">只重跑的抖动 2.6</text>
    <text x="320" y="190" fill="var(--ink-faint)">纵轴:整套得分的标准差(模拟,200 题)</text>
  </g>
</svg>
<figcaption>蓝线是换题加重跑的总抖动,琥珀线是只有重跑那一块。每题多跑几遍只能压低琥珀线,压不动蓝线最后的平台(虚线)。数据来自后面 rerun_k_sim.py 的模拟。</figcaption>
</figure>

### 补跑:同一批工单,每个架构再跑 10 遍

Day 547 已经把 4 种架构各跑了 5 遍,存在 `arch_bench_raw.json`。今天再对三个架构补跑 10 遍,凑成每张工单 15 遍。用 Day 541 的 `run_once` 和 `TASKS`,只加一个循环,结果存到另一个文件,不动原来的:

```python
# agent-zero-lab/part10/rerun_bench.py
"""Day 549:同一批 8 张工单,同一个架构再跑 K 遍,存到 rerun_<架构>.json(不动 Day 541 的 arch_bench_raw.json)。"""
import json
import sys

from common.llm import LLMClient
from part10 import arch_four, hybrid_v2
from part10.arch_bench import run_once
from part10.bench_tasks import TASKS

if __name__ == "__main__":
    name, k = sys.argv[1], int(sys.argv[2])
    arch = getattr(arch_four, name, None) or getattr(hybrid_v2, name)
    llm = LLMClient()
    rows = []
    for rep in range(k):
        for t in TASKS:
            o = run_once(llm, arch, t)
            rows.append({"arch": name, "rep": rep, **o.__dict__})
        print(f"{name} 第 {rep + 1}/{k} 遍:累计 {sum(r['ok'] for r in rows)}/{len(rows)},花费 ¥{llm.ledger.cost:.4f}", flush=True)
    with open(f"part10/rerun_{name}.json", "w") as f:
        json.dump(rows, f, ensure_ascii=False, indent=1)
    print(llm.ledger)
```

<div class="line-notes">

- `from part10.arch_bench import run_once` Day 541 的 `arch_bench.py` 里的函数:跑一张工单一次,返回 `Outcome(task_id, level, ok, cost, seconds, refunds, reply)`。
- `name, k = sys.argv[1], int(sys.argv[2])` 命令行第一个参数是架构名(`single`/`workflow`/`hybrid2`),第二个是跑几遍。
- `arch = getattr(arch_four, name, None) or getattr(hybrid_v2, name)` 先在 `arch_four` 模块里按名字找函数,没有再去 `hybrid_v2` 找。`getattr(模块, 名字, 默认值)` 相当于 JS 的 `module[name] ?? undefined`。
- `for rep in range(k):` 外层循环是「整套 8 张工单」跑几遍。
- `o = run_once(llm, arch, t)` 跑一次,`run_once` 内部会清空 `REFUNDS`、计时、判题。
- `rows.append({"arch": name, "rep": rep, **o.__dict__})` 记下是第几遍(`rep`),`**o.__dict__` 把 `Outcome` 的所有字段展开进字典,相当于 JS 的 `{...o}`。
- `print(f"{name} 第 {rep + 1}/{k} 遍:累计 {sum(r['ok'] for r in rows)}/{len(rows)},花费 ¥{llm.ledger.cost:.4f}", flush=True)` 每遍打一行进度和累计花费。`flush=True` 立刻输出,后台运行时能看到进度。
- `with open(f"part10/rerun_{name}.json", "w") as f:` 存到 `rerun_single.json` 这类新文件。

</div>

三个架构各开一个终端(它们各自是独立进程,`REFUNDS` 这个全局变量不会互相踩)。我是这样跑的:

```bash
uv run python -m part10.rerun_bench single 10
uv run python -m part10.rerun_bench workflow 10
uv run python -m part10.rerun_bench hybrid2 10
```

每个跑几分钟。我的最后两行输出:

```text
single 第 10/10 遍:累计 79/80,花费 ¥0.1581
202 次调用 | 输入 111328 / 输出 9996 tokens | 约 ¥0.1581
workflow 第 10/10 遍:累计 69/80,花费 ¥0.0537
160 次调用 | 输入 12477 / 输出 3593 tokens | 约 ¥0.0537
hybrid2 第 10/10 遍:累计 79/80,花费 ¥0.1093
240 次调用 | 输入 58227 / 输出 5059 tokens | 约 ¥0.1093
```

花费算式:single 80 次运行 ¥0.1581,约 ¥0.0020/次(它会多次查发票,调用多);workflow 80 次 ¥0.0537,约 ¥0.0007/次;hybrid2 80 次 ¥0.1093,约 ¥0.0014/次。三个合计 0.1581 + 0.0537 + 0.1093 = ¥0.321。你的数字会略有不同,每一遍都是真实调用模型。

把 Day 547 的 5 遍和今天的 10 遍拼起来,每张工单 15 遍:

```python
# agent-zero-lab/part10/rerun_noise.py
"""Day 541 的架构对比,每张工单共 15 遍(Day 547 的 5 遍 + Day 549 补的 10 遍)。看「同一个 Agent 重跑」抖多大。"""
import json
import math
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).parent
TASKS = [f"T{i}" for i in range(1, 9)]


def load(arch: str) -> dict[str, list[int]]:
    """返回 {工单: [第 1 遍, 第 2 遍, ... 第 15 遍 的 0/1]}。"""
    runs: dict[str, list[int]] = defaultdict(list)
    for r in json.loads((HERE / "arch_bench_raw.json").read_text()):   # 前 5 遍
        if r["arch"] == arch:
            runs[r["task_id"]].append(int(r["ok"]))
    for r in sorted(json.loads((HERE / f"rerun_{arch}.json").read_text()), key=lambda r: r["rep"]):  # 后 10 遍
        runs[r["task_id"]].append(int(r["ok"]))
    return runs


if __name__ == "__main__":
    for arch in ("single", "workflow", "hybrid2"):
        runs = load(arch)
        n_runs = len(runs["T1"])
        print(f"== {arch}:每张工单 {n_runs} 遍")
        print("  各工单通过次数:", {t: f"{sum(runs[t])}/{n_runs}" for t in TASKS})
        scores = [sum(runs[t][i] for t in TASKS) / 8 for i in range(n_runs)]   # 第 i 遍整套 8 张的得分
        print("  15 遍整套得分:", [f"{s:.0%}" for s in scores])
        mean = sum(scores) / n_runs
        sd = math.sqrt(sum((s - mean) ** 2 for s in scores) / (n_runs - 1))
        print(f"  整套得分均值 {mean:.1%},重跑的标准差 {sd:.3f}")
```

<div class="line-notes">

- `TASKS = [f"T{i}" for i in range(1, 9)]` T1 到 T8。
- `def load(arch: str) -> dict[str, list[int]]:` 读某个架构的全部结果,返回「工单 → 15 个 0/1」。
- `runs: dict[str, list[int]] = defaultdict(list)` 每张工单一个列表,自动创建。
- `for r in json.loads((HERE / "arch_bench_raw.json").read_text()):   # 前 5 遍` Day 547 留下的 5 遍。文件里同一个架构下同一张工单的 5 条按顺序排在一起,所以按出现顺序追加,就是第 1 到第 5 遍。
- `if r["arch"] == arch:` 只取这个架构。
- `runs[r["task_id"]].append(int(r["ok"]))` `ok` 是布尔值,`int(True)` 是 1。
- `for r in sorted(json.loads((HERE / f"rerun_{arch}.json").read_text()), key=lambda r: r["rep"]):  # 后 10 遍` 今天补跑的 10 遍,按 `rep` 排序。
- `scores = [sum(runs[t][i] for t in TASKS) / 8 for i in range(n_runs)]   # 第 i 遍整套 8 张的得分` 把「第 i 遍」重新组合成一套:8 张工单各取第 i 次的结果,加起来除以 8,就是这一遍整套的得分。
- `sd = math.sqrt(sum((s - mean) ** 2 for s in scores) / (n_runs - 1))` 15 遍整套得分的标准差,就是「重跑的抖动」的一个直接估计。

</div>

```bash
uv run python -m part10.rerun_noise
```

```text
== single:每张工单 15 遍
  各工单通过次数: {'T1': '15/15', 'T2': '15/15', 'T3': '15/15', 'T4': '15/15', 'T5': '15/15', 'T6': '15/15', 'T7': '13/15', 'T8': '15/15'}
  15 遍整套得分: ['100%', '100%', '88%', '100%', '100%', '100%', '100%', '88%', '100%', '100%', '100%', '100%', '100%', '100%', '100%']
  整套得分均值 98.3%,重跑的标准差 0.044
== workflow:每张工单 15 遍
  各工单通过次数: {'T1': '15/15', 'T2': '14/15', 'T3': '15/15', 'T4': '15/15', 'T5': '15/15', 'T6': '0/15', 'T7': '15/15', 'T8': '15/15'}
  15 遍整套得分: ['88%', '88%', '88%', '88%', '88%', '88%', '75%', '88%', '88%', '88%', '88%', '88%', '88%', '88%', '88%']
  整套得分均值 86.7%,重跑的标准差 0.032
== hybrid2:每张工单 15 遍
  各工单通过次数: {'T1': '15/15', 'T2': '14/15', 'T3': '15/15', 'T4': '15/15', 'T5': '15/15', 'T6': '15/15', 'T7': '15/15', 'T8': '15/15'}
  15 遍整套得分: ['100%', '100%', '100%', '100%', '100%', '88%', '100%', '100%', '100%', '100%', '100%', '100%', '100%', '100%', '100%']
  整套得分均值 99.2%,重跑的标准差 0.032
```

几个事实,都是真实数据:

- **single**:T1–T6、T8 各 15 遍全过,只有 T7 是 13/15。15 遍整套得分里 13 遍 100%、2 遍 88%(8 张里挂了 1 张)。
- **workflow**:T6 是 0/15,从头到尾一遍都没过(规则里只会退一张),这不是抖,是它的系统性缺陷。T2 是 14/15,抖了一次,所以有一遍整套得分是 75%。
- **hybrid2**:Day 541 和 Day 547 里记的是「全过」,Day 547 的 40/40。补跑 10 遍之后,T2 挂了一次,总共 119/120。**一次「全过」的评测,换一批跑次不一定还是全过。**
- 整套得分的重跑标准差:single 0.044,workflow 0.032,hybrid2 0.032。也就是说,同一个版本再跑一遍整套评测,分数有 3 到 4 个点的标准差,而不是 0。

### temperature=0 管不管用?

这是最常见的反应:「抖就把温度调成 0」。先看看这几个架构的温度。我去查了 Day 540 建的 `orch_tools.py`,`agent_loop` 里调用模型是 `llm.chat(messages, tools=..., temperature=0)`,**这些架构本来就是 temperature=0**。所以上面的抖动,是 temperature=0 下的抖动。

那就拿最会抖的一张工单(T7:8 月和 9 月各扣了一次 468,期望不退款)的 single 架构,在 temperature=0 和 temperature=1.0 下各跑 30 遍,对比一下。写脚本时我犯了一个错,值得贴出来:

```python
# agent-zero-lab/part10/temp_demo.py
"""temperature=0 就不抖了吗?拿会抖的工单 T7(single 架构)在 temperature=0 和 1.0 下各跑 30 遍。"""
import sys

from common.llm import LLMClient
from part10 import arch_four
from part10.arch_bench import run_once
from part10.bench_tasks import TASKS

T7 = next(t for t in TASKS if t["id"] == "T7")
REPEAT = int(sys.argv[1]) if len(sys.argv) > 1 else 30

for temp in (0.0, 1.0):
    llm = LLMClient()
    orig = llm.chat

    def chat(messages, _orig=orig, _temp=temp, **kw):   # 不管 agent_loop 传了什么,统一改成这一档温度
        kw["temperature"] = _temp
        return _orig(messages, **kw)

    llm.chat = chat
    outs = [run_once(llm, arch_four.single, T7) for _ in range(REPEAT)]
    crashed = sum(o.reply.startswith("崩溃") for o in outs)
    print(f"temperature={temp}:T7 通过 {sum(o.ok for o in outs)}/{REPEAT},其中崩溃 {crashed} 次,花费 ¥{llm.ledger.cost:.4f}")
    wrong = [o for o in outs if not o.ok][:1]
    for o in wrong:
        print("  一次失败的回复:", o.reply[:120].replace("\n", " "), "| 退款:", o.refunds)
```

<div class="line-notes">

- `T7 = next(t for t in TASKS if t["id"] == "T7")` 从 `TASKS` 里找 id 是 T7 的那一张。`next(生成器)` 取第一个匹配的。
- `for temp in (0.0, 1.0):` 两档温度。
- `orig = llm.chat` 先把原来的 `chat` 方法存起来。
- `def chat(messages, _orig=orig, _temp=temp, **kw):   # 不管 agent_loop 传了什么,统一改成这一档温度` 包一层:不管调用方传了什么,把 `temperature` 强行改成当前这档。`_orig=orig` 和 `_temp=temp` 是给参数设默认值,把当前循环的值「固定」在这个函数里,避免闭包拿到最后一轮的值。
- `kw["temperature"] = _temp` 覆盖 `kw` 里的 `temperature`(`agent_loop` 传了一个 0)。
- `llm.chat = chat` 把实例上的 `chat` 换成我们包的这一个。
- `outs = [run_once(llm, arch_four.single, T7) for _ in range(REPEAT)]` 同一张工单跑 30 遍。
- `crashed = sum(o.reply.startswith("崩溃") for o in outs)` 数有几遍是「架构崩了」。这一行是我踩了坑以后才加的,看下面。

</div>

踩的坑是这样的。我第一版没有 `kw["temperature"] = _temp` 这种覆盖,而是写成 `_orig(messages, temperature=0, **kw)`。但 `agent_loop` 本来就传了 `temperature=0`,于是同一个关键字参数出现了两次:

```text
True 崩溃:TypeError: common.llm.LLMClient.chat() got multiple values for keyword argument 'temperature'
```

这是 `run_once` 吞掉异常后返回的回复:`TypeError: ... got multiple values for keyword argument 'temperature'`。更要命的是前面那个 `True`:**这一遍被判成了通过。**我去看 Day 541 的 `judge`:T7 的期望是「不退款」,判题只检查退款集合是否等于空集、回复里有没有 `RF-`、关键词匹配,对一个崩溃的回复这三条全部成立。我的第一版脚本里 temperature=0 那一组因此显示 **30/30**,花费 ¥0.0000,正是这一点让我起了疑心,崩溃的运行没有调用模型,一分钱没花。

这是 Day 541 判题函数的一个真实漏洞:凡是期望「不退款」的工单(T5、T7、T8),架构崩了也算通过。补跑的 240 次运行里我 grep 过,「崩溃」出现 0 次,所以前面的数据没有受影响。堵上它只要一条检查:

```python
# agent-zero-lab/part10/judge_fix.py
"""Day 541 的 judge 把「架构崩了」判成通过(没退款、回复里没有 RF-)。加一条:回复以「崩溃」开头直接算失败。"""
from part10.bench_tasks import TASKS, judge

T7 = next(t for t in TASKS if t["id"] == "T7")   # 期望:不退款
crashed_reply = "崩溃:TypeError: chat() got multiple values for keyword argument 'temperature'"

print("原来的 judge:", judge(T7, [], crashed_reply))


def strict_judge(task: dict, refunds: list[dict], reply: str) -> bool:
    return not reply.startswith("崩溃") and judge(task, refunds, reply)


print("加了检查的 judge:", strict_judge(T7, [], crashed_reply))
```

<div class="line-notes">

- `T7 = next(t for t in TASKS if t["id"] == "T7")   # 期望:不退款` T7 的期望退款集合是空。
- `crashed_reply = "崩溃:TypeError: chat() got multiple values for keyword argument 'temperature'"` 和 `run_once` 吞掉异常后产生的回复同样的格式:以「崩溃」开头。
- `print("原来的 judge:", judge(T7, [], crashed_reply))` 传入空的退款列表加崩溃回复:原来的判题返回 `True`。
- `return not reply.startswith("崩溃") and judge(task, refunds, reply)` 回复以「崩溃」开头就直接失败,否则走原来的判断。

</div>

```text
原来的 judge: True
加了检查的 judge: False
```

我没有改 Day 541 的文件(它在别的天里),这个检查建议加进 `bench_tasks.judge` 里。回到温度实验,修好覆盖方式以后,脚本是上面贴的版本。30 遍的结果:

```text
temperature=0.0:T7 通过 24/30,其中崩溃 0 次,花费 ¥0.0517
  一次失败的回复: 是的，8 月和 9 月各扣了 468 元，属于重复扣款；已为您退掉后一张发票（INV-2602），退款单号 RF-1，金额 468 元。 | 退款: ['INV-2602']
temperature=1.0:T7 通过 25/30,其中崩溃 0 次,花费 ¥0.0595
  一次失败的回复: 已确认 8 月和 9 月两张 468 元发票为重复扣款, 已退掉后一张(INV-2602),退款单号 RF-1,468 元将原路退回。 | 退款: ['INV-2602']
```

**temperature=0:24/30(80.0%,Wilson [62.7%, 90.5%]);temperature=1.0:25/30(83.3%,[66.4%, 92.7%])。**两档温度几乎没有区别。T7 在 temperature=0 下一直在抖:这一张工单,single 架构,三批数据是 13/15(Day 547 的 5 遍加今天的 10 遍)、20/30(我脚本第一版里没被覆盖的那一组,也就是原样 `agent_loop`)、24/30,每批都是 temperature=0,通过率分别是 87%、67%、80%。合起来 57/75 = 76.0%,区间 [65.2%, 84.2%]。失败的那一遍里,Agent 把 8 月和 9 月当成重复扣款退了 INV-2602,是对「每月一次的正常订阅」判断错了。

三个结论:

- `temperature=0` 不等于确定性。贪心解码在 API 层面也不保证每次输出一字不差(常见原因是服务端的批处理和浮点运算顺序,我没有针对 DeepSeek 单独验证原因,只验证了现象),而且 Agent 是多步的,第一步的一个字不同,后面的工具调用就可能分叉。
- 调成 0 就算能压住抖动,评出来的也不是线上那个 Agent。线上用什么温度,评测就该用什么温度,否则得到的结论对线上没有意义。**要降抖动,靠重复采样(每题多跑几遍),别靠改配置。**
- 同样的配置,三批 15、30、30 遍,通过率从 67% 到 87%,批与批之间差 20 个点。如果你只跑了 15 遍就报「87%」,就是被抖动骗了。

### 把两种抖动拆开

现在把「整套得分的方差」拆成两块,看哪块大。设有 G 张工单,第 t 张的真实通过率是 p_t(每遍独立地以 p_t 的概率通过),整套得分是各工单这一遍结果的平均。

**重跑方差**:同一批工单重跑,每张工单自己抖:每张的方差 p_t(1 − p_t),加起来再除以 G²。

**换题方差**:换一批工单,p_t 本身在工单之间不一样,整套的平均通过率就变。它等于 p_t 在工单之间的方差再除以 G。

每题跑 K 遍取平均,重跑那块变成原来的 1/K,换题那块不变:总方差 = 换题方差 + 重跑方差 / K。这是一条重要的关系,Evan Miller 论文第 3.1 节写的也是这个(每题跑 K 遍,条件方差变成 σ²/K)。实现时只有一个小麻烦:你手里只有各工单的通过比例 p̂_t = c/n,p̂_t 在工单之间的方差里,已经混进了一点重跑噪声(n 遍平均后是 p̂(1−p̂)/n 左右),要先减掉。

```python
# agent-zero-lab/part10/stats.py(新增)
def variance_split(successes: list[int], n: int) -> tuple[float, float]:
    """把「整套得分的方差」拆成两块,都是单遍(K=1)时的值。

    返回 (重跑方差, 题目抽样方差)。
    重跑方差:同一批题重跑,每题自己抖的部分:Σ p̂(1−p̂)·n/(n−1) / G²。
    题目抽样方差:换一批题,每题的真实通过率不同带来的部分:Var(p̂_t)/G,再减去混在里面的重跑噪声。
    """
    g = len(successes)
    p = [c / n for c in successes]
    within = sum(pt * (1 - pt) * n / (n - 1) for pt in p) / g**2          # 重跑方差(K=1)
    mean = sum(p) / g
    var_p = sum((pt - mean) ** 2 for pt in p) / (g - 1)                   # 各题 p̂ 的方差,里面已混进 within 的 n 倍稀释
    between = max(0.0, var_p / g - within / n)                            # 减掉混进来的重跑噪声(n 遍平均后剩 within/n)
    return within, between
```

<div class="line-notes">

- `def variance_split(successes: list[int], n: int) -> tuple[float, float]:` `successes` 是每张工单 n 遍里成功了几遍,返回(重跑方差,换题方差),都是 K=1 时的值。
- `g = len(successes)` 工单数 G,8。
- `p = [c / n for c in successes]` 每张工单的通过比例。single 的 T7 是 13/15 = 0.867,其余 1.0。
- `within = sum(pt * (1 - pt) * n / (n - 1) for pt in p) / g**2          # 重跑方差(K=1)` 每张工单一遍的方差 p(1−p),乘 n/(n−1) 是无偏修正(15 遍估出来的方差偏小一点),加起来除以 G² = 64。single 只有 T7 一项:0.867 × 0.133 × 15/14 = 0.1238,除以 64 得 0.00193,开方 0.044。
- `mean = sum(p) / g` 8 张工单通过比例的平均。
- `var_p = sum((pt - mean) ** 2 for pt in p) / (g - 1)                   # 各题 p̂ 的方差,里面已混进 within 的 n 倍稀释` 各工单通过比例在工单之间的方差。
- `between = max(0.0, var_p / g - within / n)                            # 减掉混进来的重跑噪声(n 遍平均后剩 within/n)` var_p / g 是「p̂ 的平均」的方差;里面混着重跑噪声 within/n,减掉才是换题方差。可能减成负数(8 张工单太少,估不准),就取 0。
- `return within, between` 两块。

</div>

```python
# agent-zero-lab/part10/rerun_split.py
"""同一个架构:重跑的抖动、换题的抖动各是多少;每题多跑几遍能降多少。pass^k 用真实数据算一遍。"""
import math

from part10.rerun_noise import TASKS, load
from part10.stats import pass_at_k, pass_hat_k, variance_split

N = 15
for arch in ("single", "workflow", "hybrid2"):
    runs = load(arch)
    c = [sum(runs[t]) for t in TASKS]
    within, between = variance_split(c, N)
    print(f"== {arch}  各工单通过次数 {c}")
    print(f"  重跑 SD(K=1) {math.sqrt(within):.3f}   换题 SD {math.sqrt(between):.3f}   (方差 {within:.5f} / {between:.5f})")
    for K in (1, 3, 5, 10):
        total = math.sqrt(between + within / K)
        print(f"  每题跑 {K:>2} 遍:整套得分的总 SD {total:.3f}  (其中重跑那块 {math.sqrt(within / K):.3f})")
    print("  k:     " + "  ".join(f"{k:>5}" for k in (1, 3, 5, 10, 15)))
    print("  pass@k " + "  ".join(f"{pass_at_k(c, N, k):>5.3f}" for k in (1, 3, 5, 10, 15)))
    print("  pass^k " + "  ".join(f"{pass_hat_k(c, N, k):>5.3f}" for k in (1, 3, 5, 10, 15)))
```

<div class="line-notes">

- `c = [sum(runs[t]) for t in TASKS]` 每张工单 15 遍里的成功次数,single 是 `[15, 15, 15, 15, 15, 15, 13, 15]`。
- `within, between = variance_split(c, N)` 拆方差,`N = 15`。
- `print(f"  重跑 SD(K=1) {math.sqrt(within):.3f}   换题 SD {math.sqrt(between):.3f}   (方差 {within:.5f} / {between:.5f})")` 打标准差(方差的平方根),方便和「个点」对应。
- `total = math.sqrt(between + within / K)` 总方差 = 换题 + 重跑/K,开方。
- `print("  pass@k " + "  ".join(f"{pass_at_k(c, N, k):>5.3f}" for k in (1, 3, 5, 10, 15)))` pass@k:任选 k 遍里至少成功一遍的概率,下面一节讲。
- `print("  pass^k " + "  ".join(f"{pass_hat_k(c, N, k):>5.3f}" for k in (1, 3, 5, 10, 15)))` pass^k:任选 k 遍全成功的概率。

</div>

```bash
uv run python -m part10.rerun_split
```

```text
== single  各工单通过次数 [15, 15, 15, 15, 15, 15, 13, 15]
  重跑 SD(K=1) 0.044   换题 SD 0.012   (方差 0.00193 / 0.00015)
  每题跑  1 遍:整套得分的总 SD 0.046  (其中重跑那块 0.044)
  每题跑  3 遍:整套得分的总 SD 0.028  (其中重跑那块 0.025)
  每题跑  5 遍:整套得分的总 SD 0.023  (其中重跑那块 0.020)
  每题跑 10 遍:整套得分的总 SD 0.019  (其中重跑那块 0.014)
  k:         1      3      5     10     15
  pass@k 0.983  1.000  1.000  1.000  1.000
  pass^k 0.983  0.954  0.929  0.887  0.875
== workflow  各工单通过次数 [15, 14, 15, 15, 15, 0, 15, 15]
  重跑 SD(K=1) 0.032   换题 SD 0.124   (方差 0.00104 / 0.01533)
  每题跑  1 遍:整套得分的总 SD 0.128  (其中重跑那块 0.032)
  每题跑  3 遍:整套得分的总 SD 0.125  (其中重跑那块 0.019)
  每题跑  5 遍:整套得分的总 SD 0.125  (其中重跑那块 0.014)
  每题跑 10 遍:整套得分的总 SD 0.124  (其中重跑那块 0.010)
  k:         1      3      5     10     15
  pass@k 0.867  0.875  0.875  0.875  0.875
  pass^k 0.867  0.850  0.833  0.792  0.750
== hybrid2  各工单通过次数 [15, 14, 15, 15, 15, 15, 15, 15]
  重跑 SD(K=1) 0.032   换题 SD 0.000   (方差 0.00104 / 0.00000)
  每题跑  1 遍:整套得分的总 SD 0.032  (其中重跑那块 0.032)
  每题跑  3 遍:整套得分的总 SD 0.019  (其中重跑那块 0.019)
  每题跑  5 遍:整套得分的总 SD 0.014  (其中重跑那块 0.014)
  每题跑 10 遍:整套得分的总 SD 0.010  (其中重跑那块 0.010)
  k:         1      3      5     10     15
  pass@k 0.992  1.000  1.000  1.000  1.000
  pass^k 0.992  0.975  0.958  0.917  0.875
```

(最后两块先放着,下一节讲。)先看每个架构前面的方差拆分:

**single**:重跑 SD 0.044,换题 SD 0.012。这个架构几乎只有一张工单 T7 在抖,换题那块小到近乎 0(估出来 0.012)。K 从 1 加到 10,总 SD 从 0.046 降到 0.019。这种情形多跑几遍很有用,因为不确定性几乎全是重跑造成的。

**workflow**:重跑 SD 0.032,换题 SD 0.124。T6 是 0/15 导致工单之间的差别很大(7 张是 1.0,一张是 0)。这时多跑几遍几乎没有用:K 从 1 到 10,总 SD 从 0.128 只降到 0.124。**抖动主要来自「T6 这类工单它做不到」,不是随机。**要降低不确定性得加用例,不是加遍数。

**hybrid2**:重跑 SD 0.032,换题 SD 0(8 张工单太少,估出来是负数,取了 0)。K 到 10,总 SD 降到 0.010。

注意:8 张工单拆出来的「换题」是很粗的估计。意思是看趋势:先拆,再决定把预算花在加题还是加遍数上。

### 实际的 K 与理论一致吗

拿真实数据验证公式:每张工单从 15 遍里随机挑 K 遍取平均,重复 4000 次,看整套得分的标准差,对照 `√(重跑方差/K)`。这是练习 2。结果会略小于公式,因为我是不放回地从只有 15 遍的池子里挑,有「有限总体」的修正。

更干净的办法是用一个模拟,每题的真实通过率直接定好,可以随便抽。200 题,80 题通过率 0.95、60 题 0.8、40 题 0.5、20 题 0.2,平均 0.74:

```python
# agent-zero-lab/part10/rerun_k_sim.py
"""模拟:200 题,每题自己的通过率不同。每题重跑 K 遍取平均,整套得分的抖动怎么随 K 变。"""
import math

import numpy as np

rng = np.random.default_rng(0)
POOL = np.array([0.95] * 80 + [0.8] * 60 + [0.5] * 40 + [0.2] * 20)   # 200 题各自的真实通过率,平均 0.74
G = len(POOL)
print(f"200 题的平均真实通过率 {POOL.mean():.3f}")

within_k1 = float((POOL * (1 - POOL)).sum() / G**2)        # 重跑方差(K=1):每题各抖各的,加起来除 G²
between = float(POOL.var(ddof=1) / G)                       # 换题方差:真实通过率在题与题之间的差异 / G
print(f"公式:重跑 SD(K=1) {math.sqrt(within_k1):.4f}   换题 SD {math.sqrt(between):.4f}")

print(f"{'K':>3} | {'只重跑(题固定)':>14} {'公式':>7} | {'重跑+换题':>9} {'公式':>7}")
for K in (1, 3, 5, 10, 30):
    # 1) 题固定,整套重跑 4000 遍,每遍每题跑 K 次取平均
    fixed = [(rng.random((K, G)) < POOL).mean(axis=0).mean() for _ in range(4000)]
    # 2) 题也换:每次从「题库」里重新抽 200 题(题库 = 这四档通过率按比例),再每题跑 K 次
    both = []
    for _ in range(4000):
        pool = rng.choice(POOL, size=G, replace=True)
        both.append((rng.random((K, G)) < pool).mean(axis=0).mean())
    print(f"{K:>3} | {np.std(fixed, ddof=1):>14.4f} {math.sqrt(within_k1 / K):>7.4f} | "
          f"{np.std(both, ddof=1):>9.4f} {math.sqrt(between + within_k1 / K):>7.4f}")
```

<div class="line-notes">

- `POOL = np.array([0.95] * 80 + [0.8] * 60 + [0.5] * 40 + [0.2] * 20)   # 200 题各自的真实通过率,平均 0.74` 200 个数,代表 200 道题各自的「真实通过率」。`[0.95] * 80` 是 80 个 0.95。
- `within_k1 = float((POOL * (1 - POOL)).sum() / G**2)        # 重跑方差(K=1):每题各抖各的,加起来除 G²` 逐元素乘,再求和。(80×0.0475 + 60×0.16 + 40×0.25 + 20×0.16)/200² = 26.6/40000 = 0.000665,开方 0.0258。
- `between = float(POOL.var(ddof=1) / G)                       # 换题方差:真实通过率在题与题之间的差异 / G` 200 个通过率之间的方差,除以 200,开方 0.0173。
- `fixed = [(rng.random((K, G)) < POOL).mean(axis=0).mean() for _ in range(4000)]` 题固定,整套重跑 4000 次。`rng.random((K, G))` 抽 K×G 个 0 到 1 的随机数,和 `POOL` 比大小(广播:每一列对应一题的概率),得到 K 遍 × 200 题的 0/1 矩阵。`.mean(axis=0)` 对每题的 K 遍取平均,`.mean()` 再对 200 题取平均,就是整套得分。
- `pool = rng.choice(POOL, size=G, replace=True)` 题也换:从 200 个通过率里有放回地再抽 200 个,当作「新抽的一批题」。
- `both.append((rng.random((K, G)) < pool).mean(axis=0).mean())` 在新抽的这批题上跑 K 遍。

</div>

```bash
uv run python -m part10.rerun_k_sim
```

```text
200 题的平均真实通过率 0.740
公式:重跑 SD(K=1) 0.0258   换题 SD 0.0173
  K |       只重跑(题固定)      公式 |     重跑+换题      公式
  1 |         0.0258  0.0258 |    0.0309  0.0310
  3 |         0.0150  0.0149 |    0.0231  0.0228
  5 |         0.0118  0.0115 |    0.0205  0.0208
 10 |         0.0081  0.0082 |    0.0193  0.0191
 30 |         0.0048  0.0047 |    0.0182  0.0179
```

左半(题固定,只有重跑)的模拟和公式几乎一致:K=1 时 0.0258,K=10 时 0.0081(公式 0.0082),K=30 时 0.0048。右半(换题加重跑)总抖动 K=1 时 0.0309,K=3 时 0.0231,K=10 时 0.0193,K=30 时 0.0182。K 从 10 加到 30,总抖动只从 0.0193 降到 0.0182,因为底下有一个降不下去的 0.0173(换题那块)。这就是上面那张图。

对「每题跑几遍」的建议很具体:

- **先量一下重跑和换题的比例**。重跑大、换题小(single 那种)就多跑几遍;重跑小、换题大(workflow 那种)就别浪费钱跑重复,去加不同的用例。
- 一般 K=3 到 5 已经吃掉大部分收益。Miller 论文里的例子(每题难度均匀分布,二元评分)算出 K=2 总方差降 1/3,K=4 降 1/2,上限是 2/3。我这个模拟换了设定,数字不同,走势一样。
- 成本是线性的:K 遍就是 K 倍的费用。今天 single 一遍整套 ¥0.0157,K=5 是 ¥0.08,K=10 是 ¥0.16。

练习 3 让你把 `POOL` 换成几种极端情形,体会「什么时候多跑没用」。

### 汇报稳定性:pass@k 和 pass^k

重跑还有一个用处:衡量稳定性。Day 541 用过 pass^k(同一张工单跑 k 遍**全部**成功的比例)。现在有了每张工单 15 遍的数据,可以算得更准。两个量:

- **pass@k**:任选 k 遍里**至少成功一遍**的概率。代码生成常用:多试几次总有一次对。
- **pass^k**:任选 k 遍**全部成功**的概率。客服类 Agent 要的是「每次都对」,看这个。τ-bench(Yao 等人,2024)提出了 pass^k 这个指标,用来评估 Agent 多次尝试里的可靠性。

一张工单跑了 n 遍,成功了 c 遍,「任选 k 遍」一共有 C(n,k) 种选法,其中全成功的有 C(c,k) 种,全失败的有 C(n−c,k) 种。所以 pass^k = C(c,k)/C(n,k),pass@k = 1 − C(n−c,k)/C(n,k),再对所有工单取平均。这是无偏估计:它不是用「p̂ 的 k 次方」去算(那样会偏),而是直接数组合。

```python
# agent-zero-lab/part10/stats.py(新增)
def pass_hat_k(successes: list[int], n: int, k: int) -> float:
    """pass^k 的无偏估计:每题跑了 n 遍、成功 c 遍,「任选 k 遍全成功」的概率是 C(c,k)/C(n,k),再对所有题取平均。"""
    return sum(math.comb(c, k) / math.comb(n, k) for c in successes) / len(successes)


def pass_at_k(successes: list[int], n: int, k: int) -> float:
    """pass@k:任选 k 遍里至少成功一遍的概率 = 1 − C(n−c,k)/C(n,k)。"""
    return sum(1 - math.comb(n - c, k) / math.comb(n, k) for c in successes) / len(successes)
```

<div class="line-notes">

- `def pass_hat_k(successes: list[int], n: int, k: int) -> float:` `successes` 是每张工单成功几遍,`n` 是每张跑了几遍,`k` 是「连续几遍」。
- `return sum(math.comb(c, k) / math.comb(n, k) for c in successes) / len(successes)` 每张工单算 C(c,k)/C(n,k),再取平均。T7 是 c=13、n=15、k=3:C(13,3)/C(15,3) = 286/455 = 0.629。`math.comb(c, k)` 在 c < k 时返回 0,所以成功次数不够 k 遍的工单自动是 0。
- `def pass_at_k(successes: list[int], n: int, k: int) -> float:` 至少成功一遍。
- `return sum(1 - math.comb(n - c, k) / math.comb(n, k) for c in successes) / len(successes)` 1 减去「k 遍全失败」的概率。`math.comb(n - c, k)` 是从失败的那 n−c 遍里选 k 遍的选法数。

</div>

回头看 `rerun_split` 输出的最后两块:

- **single**:pass@1 = pass^1 = 0.983;k=15 时 pass@15 = 1.000,pass^15 = 0.875。同一批数据,用 pass@k 汇报是 100%,用 pass^k 是 87.5%。T7 在 15 遍里挂了 2 遍,所以任选 15 遍全部成功,只有 T7 那张被拖累。
- **workflow**:pass@k 从 k=3 起就停在 0.875 不再动了(T6 一遍都没成功,永远补不上),pass^k 从 0.867 一路降到 0.750。这两条线夹出来的「天花板」和「地板」都很低,说明它的问题是系统性的。
- **hybrid2**:pass^1 0.992,pass^10 0.917,pass^15 0.875。Day 541 汇报的「全过」在 3 遍、5 遍的数据上都成立;15 遍里 T2 抖了一次,pass^15 掉到了 0.875。

两个数都没错,但说的是不同的事。面向客户的 Agent,我会同时报 pass^1 和 pass^k(k 取 5 或者 10),让读者看到「稳定性」这一面。练习 4 用「列出所有组合」的笨办法验证了这个公式。

## 今天往 stats.py 里加了什么

| 函数 | 做什么 | 哪一节 |
| --- | --- | --- |
| `bootstrap_means(values, clusters, n_boot, seed)` | 有放回重抽 n_boot 次,每次的平均值;给 clusters 就按簇重抽 | bootstrap |
| `bootstrap_ci(values, clusters, ...)` | 取重抽平均值的中间 95%(百分位法) | bootstrap |
| `variance_split(successes, n)` | 把整套得分方差拆成重跑方差和换题方差 | 把两种抖动拆开 |
| `pass_hat_k(successes, n, k)` | pass^k 的无偏估计 C(c,k)/C(n,k) | pass@k 和 pass^k |
| `pass_at_k(successes, n, k)` | pass@k = 1 − C(n−c,k)/C(n,k) | pass@k 和 pass^k |

顶部加了 `import numpy as np`。Day 550 加功效、样本量和多重比较。

## 动手练习

**练习 1:按工单 bootstrap。** single 架构 15 遍 × 8 张工单一共 120 次运行,单看 118/120。算三种区间:Wilson(把 120 次当独立)、按单次 bootstrap、按工单 bootstrap,各是多少?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex549_boot_ticket.py
"""练习 1:single 架构 15 遍 × 8 张工单 = 120 次运行,按工单 bootstrap,通过率的区间。"""
from part10.rerun_noise import TASKS, load
from part10.stats import bootstrap_ci, wilson_ci

runs = load("single")
values = [float(v) for t in TASKS for v in runs[t]]
tickets = [t for t in TASKS for _ in runs[t]]
k, n = int(sum(values)), len(values)
print(f"single {k}/{n} = {k / n:.1%}")
print(f"Wilson(120 次当独立)  [{wilson_ci(k, n)[0]:.1%}, {wilson_ci(k, n)[1]:.1%}]")
print(f"按单次 bootstrap       [{bootstrap_ci(values)[0]:.1%}, {bootstrap_ci(values)[1]:.1%}]")
print(f"按工单 bootstrap       [{bootstrap_ci(values, tickets)[0]:.1%}, {bootstrap_ci(values, tickets)[1]:.1%}]")
```

<div class="line-notes">

- `values = [float(v) for t in TASKS for v in runs[t]]` 双重循环的列表推导:先遍历 8 张工单,再遍历每张的 15 个结果,摊成 120 个 0/1。
- `tickets = [t for t in TASKS for _ in runs[t]]` 同样长的簇标签,`T1` 重复 15 次,`T2` 重复 15 次……
- `print(f"按工单 bootstrap       [{bootstrap_ci(values, tickets)[0]:.1%}, {bootstrap_ci(values, tickets)[1]:.1%}]")` 按工单重抽:每次抽 8 张工单,抽中的工单 15 遍一起带上。

</div>

```bash
uv run python -m part10.ex549_boot_ticket
```

```text
single 118/120 = 98.3%
Wilson(120 次当独立)  [94.1%, 99.5%]
按单次 bootstrap       [95.8%, 100.0%]
按工单 bootstrap       [95.0%, 100.0%]
```

Wilson 是 [94.1%, 99.5%],按单次 bootstrap 是 [95.8%, 100.0%],按工单 bootstrap 是 [95.0%, 100.0%]。这里按工单聚类并没有把区间拉宽多少,因为 120 次里失败的 2 次都在同一张工单(T7),而且只有 8 个簇:每次重抽 8 张工单,完全抽不到 T7 的概率是 (7/8)⁸ ≈ 34%,这些重抽的通过率都是 100%,所以 bootstrap 的下限比 Wilson 高。同时这也是前一节说的 bootstrap 软肋的影子:接近 100% 时,Wilson 更保守。
</details>

**练习 2:用真实数据验证「K 遍取平均」。** 每张工单从 15 遍里随机不放回地挑 K 遍(K = 1、3、5)取平均,整套得分重复 4000 次,标准差是多少?对照 `√(重跑方差/K)`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex549_real_k.py
"""练习 2:用真实的 15 遍数据,每张工单随机挑 K 遍取平均,整套得分的 SD 是多少?对照公式。"""
import math
import random

from part10.rerun_noise import TASKS, load
from part10.stats import variance_split

rng = random.Random(0)
for arch in ("single", "hybrid2"):
    runs = load(arch)
    within, _ = variance_split([sum(runs[t]) for t in TASKS], 15)
    print(f"== {arch}")
    for K in (1, 3, 5):
        scores = []
        for _ in range(4000):
            # 每张工单从 15 遍里不放回地挑 K 遍,取平均,再对 8 张工单取平均
            scores.append(sum(sum(rng.sample(runs[t], K)) / K for t in TASKS) / len(TASKS))
        mean = sum(scores) / len(scores)
        sd = math.sqrt(sum((s - mean) ** 2 for s in scores) / (len(scores) - 1))
        print(f"  K={K}:挑 4000 次,整套得分 SD {sd:.4f}   公式 √(重跑方差/K) = {math.sqrt(within / K):.4f}")
```

<div class="line-notes">

- `within, _ = variance_split([sum(runs[t]) for t in TASKS], 15)` 只要重跑方差,换题那块用 `_` 接住不用。
- `scores.append(sum(sum(rng.sample(runs[t], K)) / K for t in TASKS) / len(TASKS))` 对每张工单,`rng.sample(runs[t], K)` 从 15 个 0/1 里不放回地挑 K 个,取平均;再对 8 张工单取平均。
- `print(f"  K={K}:挑 4000 次,整套得分 SD {sd:.4f}   公式 √(重跑方差/K) = {math.sqrt(within / K):.4f}")` 实际 SD 对公式。

</div>

```bash
uv run python -m part10.ex549_real_k
```

```text
== single
  K=1:挑 4000 次,整套得分 SD 0.0419   公式 √(重跑方差/K) = 0.0440
  K=3:挑 4000 次,整套得分 SD 0.0227   公式 √(重跑方差/K) = 0.0254
  K=5:挑 4000 次,整套得分 SD 0.0159   公式 √(重跑方差/K) = 0.0197
== hybrid2
  K=1:挑 4000 次,整套得分 SD 0.0322   公式 √(重跑方差/K) = 0.0323
  K=3:挑 4000 次,整套得分 SD 0.0166   公式 √(重跑方差/K) = 0.0186
  K=5:挑 4000 次,整套得分 SD 0.0118   公式 √(重跑方差/K) = 0.0144
```

K=1 时实际 SD 和公式几乎一致(single 0.0419 对 0.0440,hybrid2 0.0322 对 0.0323)。K 增大时实际值比公式小一些(single K=5:0.0159 对 0.0197)。原因是我从只有 15 遍的池子里**不放回**地挑 K 遍,K 越大,挑出来的越接近这 15 遍的全体,抖动就更小。这条修正大致是 √((15−K)/14),K=5 时乘 0.845,0.0197 × 0.845 = 0.0166,接近实际的 0.0159。公式适用的前提是「每遍是独立抽样」,不放回的挑选会比它更小一点。
</details>

**练习 3:什么时候多跑几遍没用?** 把 `rerun_k_sim.py` 里的 `POOL` 换成三种极端情形:200 题全是 0.5 通过率;全是 0.99;一半 0.99 一半 0.01。看 K=1、5、10 时总 SD 各是多少。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex549_pool_change.py
"""练习 3:把「每题的真实通过率」换成两种极端,看每题多跑几遍还管不管用。"""
import math

import numpy as np

for name, pool in (
    ("全是 0.5 的难题", np.full(200, 0.5)),
    ("全是 0.99 的简单题", np.full(200, 0.99)),
    ("一半 0.99、一半 0.01(要么全会要么全不会)", np.array([0.99] * 100 + [0.01] * 100)),
):
    g = len(pool)
    within_k1 = float((pool * (1 - pool)).sum() / g**2)
    between = float(pool.var(ddof=1) / g)
    print(f"== {name}:平均 {pool.mean():.2f}")
    for K in (1, 5, 10):
        print(f"   K={K:>2}:重跑 SD {math.sqrt(within_k1 / K):.4f}  换题 SD {math.sqrt(between):.4f}  总 SD {math.sqrt(between + within_k1 / K):.4f}")
```

<div class="line-notes">

- `("全是 0.5 的难题", np.full(200, 0.5)),` `np.full(200, 0.5)` 造一个 200 个 0.5 的数组。
- `("一半 0.99、一半 0.01(要么全会要么全不会)", np.array([0.99] * 100 + [0.01] * 100)),` 一半题几乎必过,一半几乎必挂:题之间差别极大,每道题自己的抖动极小。
- `between = float(pool.var(ddof=1) / g)` 换题方差,题之间一样时是 0。

</div>

```bash
uv run python -m part10.ex549_pool_change
```

```text
== 全是 0.5 的难题:平均 0.50
   K= 1:重跑 SD 0.0354  换题 SD 0.0000  总 SD 0.0354
   K= 5:重跑 SD 0.0158  换题 SD 0.0000  总 SD 0.0158
   K=10:重跑 SD 0.0112  换题 SD 0.0000  总 SD 0.0112
== 全是 0.99 的简单题:平均 0.99
   K= 1:重跑 SD 0.0070  换题 SD 0.0000  总 SD 0.0070
   K= 5:重跑 SD 0.0031  换题 SD 0.0000  总 SD 0.0031
   K=10:重跑 SD 0.0022  换题 SD 0.0000  总 SD 0.0022
== 一半 0.99、一半 0.01(要么全会要么全不会):平均 0.50
   K= 1:重跑 SD 0.0070  换题 SD 0.0347  总 SD 0.0354
   K= 5:重跑 SD 0.0031  换题 SD 0.0347  总 SD 0.0349
   K=10:重跑 SD 0.0022  换题 SD 0.0347  总 SD 0.0348
```

- 全是 0.5:换题 SD 是 0,所有抖动都来自重跑,K 从 1 到 10,总 SD 从 0.0354 降到 0.0112,K 越大越好。
- 全是 0.99:换题也是 0,重跑 SD 本来就只有 0.0070,多跑几遍意义不大。
- 一半 0.99、一半 0.01:重跑只有 0.0070,换题 SD 0.0347,总 SD 从 0.0354 到 0.0348 几乎不动。多跑 10 遍毫无作用,得换用例。

这就是 workflow 的情形:有的工单它稳定会,有的工单它稳定不会,每个工单自己不抖,抖动来自「这批里有几张难的」。
</details>

**练习 4:验证 pass^k 的公式。** 一张工单 15 遍成功 13 遍(single 的 T7),用 `itertools.combinations` 把「15 遍里任选 k 遍」的所有选法列出来,数全成功的有几种,和 C(13,k)/C(15,k) 对一下。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex549_passk_brute.py
"""练习 4:pass^k 的无偏估计,用「把所有 k 遍的组合列出来数」验证。"""
from itertools import combinations
from math import comb

n, c = 15, 13                          # 一张工单跑 15 遍,成功 13 遍(single 的 T7)
runs = [1] * c + [0] * (n - c)
for k in (1, 3, 5, 10):
    combos = list(combinations(range(n), k))                    # 从 15 遍里任选 k 遍的所有选法
    all_ok = sum(all(runs[i] for i in cmb) for cmb in combos)   # 其中 k 遍全成功的选法数
    print(f"k={k:>2}:共 {len(combos):>5} 种选法,全成功 {all_ok:>5} 种 = {all_ok / len(combos):.4f}   公式 C({c},{k})/C({n},{k}) = {comb(c, k) / comb(n, k):.4f}")
```

<div class="line-notes">

- `runs = [1] * c + [0] * (n - c)` 13 个 1(成功)和 2 个 0(失败),代表 15 遍。
- `combos = list(combinations(range(n), k))                    # 从 15 遍里任选 k 遍的所有选法` `combinations(range(15), 3)` 列出从编号 0 到 14 里选 3 个的所有选法,共 C(15,3) = 455 种。
- `all_ok = sum(all(runs[i] for i in cmb) for cmb in combos)   # 其中 k 遍全成功的选法数` 对每种选法,检查选中的几遍是不是都是 1。
- `print(f"k={k:>2}:共 {len(combos):>5} 种选法,全成功 {all_ok:>5} 种 = {all_ok / len(combos):.4f}   公式 C({c},{k})/C({n},{k}) = {comb(c, k) / comb(n, k):.4f}")` 暴力数和公式并排,应该完全一样。

</div>

```bash
uv run python -m part10.ex549_passk_brute
```

```text
k= 1:共    15 种选法,全成功    13 种 = 0.8667   公式 C(13,1)/C(15,1) = 0.8667
k= 3:共   455 种选法,全成功   286 种 = 0.6286   公式 C(13,3)/C(15,3) = 0.6286
k= 5:共  3003 种选法,全成功  1287 种 = 0.4286   公式 C(13,5)/C(15,5) = 0.4286
k=10:共  3003 种选法,全成功   286 种 = 0.0952   公式 C(13,10)/C(15,10) = 0.0952
```

k=3 时 455 种选法里 286 种全成功,286/455 = 0.6286,和公式 C(13,3)/C(15,3) 一致;k=10 时 3003 种里 286 种,0.0952。四个 k 值两个算法一模一样。
</details>

**练习 5(选做):用 15 遍的数据重做 single − workflow 的按工单配对。** Day 548 用了 5 遍的数据,结果是 [−0.210, +0.410]。现在每张工单 15 遍,区间会窄吗?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex549_paired_15.py
"""练习 4:用 15 遍的数据(Day 547 的 5 遍 + Day 549 补的 10 遍),重做 single − workflow 的按工单配对。"""
import math

from scipy.stats import t

from part10.rerun_noise import TASKS, load

single, workflow = load("single"), load("workflow")
d = [sum(single[tid]) / 15 - sum(workflow[tid]) / 15 for tid in TASKS]
print("每张工单 single − workflow:", [round(v, 3) for v in d])
g = len(d)
mean = sum(d) / g
se = math.sqrt(sum((v - mean) ** 2 for v in d) / (g - 1) / g)
tc = t.ppf(0.975, g - 1)
print(f"均值 {mean:+.3f}  SE {se:.3f}  95% 区间 [{mean - tc * se:+.3f}, {mean + tc * se:+.3f}]")
```

<div class="line-notes">

- `single, workflow = load("single"), load("workflow")` 两个架构各 15 遍的数据。
- `d = [sum(single[tid]) / 15 - sum(workflow[tid]) / 15 for tid in TASKS]` 每张工单:single 的通过比例减 workflow 的通过比例。T2 是 15/15 − 14/15 = +0.067,T6 是 1.0 − 0 = +1.0,T7 是 13/15 − 15/15 = −0.133。
- `tc = t.ppf(0.975, g - 1)` 自由度 7,2.365。

</div>

```bash
uv run python -m part10.ex549_paired_15
```

```text
每张工单 single − workflow: [0.0, 0.067, 0.0, 0.0, 0.0, 1.0, -0.133, 0.0]
均值 +0.117  SE 0.128  95% 区间 [-0.185, +0.419]
```

区间 [−0.185, +0.419],5 遍时是 [−0.210, +0.410],几乎没变窄。多跑遍数只能降重跑方差,这个区间的宽度来自「8 个簇」和「差别全在 T6 一张工单」,换题那块不变。再次印证了前面的结论。
</details>

**验收标准**:`boot_v1.py` 的按场景 bootstrap 区间是 [67.8%, 85.0%],`boot_diff.py` 的差值区间 [−3.9%, +5.6%],和 Day 548 的公式结果对得上;`boot_fail.py` 里 40/40 的区间是 [100.0%, 100.0%];`rerun_noise.py` 能读出每张工单 15 遍;`rerun_split.py` 打出三个架构的重跑 SD 和换题 SD;能口述「为什么 workflow 多跑几遍没用,single 多跑几遍有用」;能不看文章默写 `bootstrap_means`。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| bootstrap(自助法) | 把手里的数据当整个世界,有放回地重抽很多次,每次算统计量,看这些统计量怎么分布 |
| 重抽(resample) | bootstrap 里的一次抽样,抽出来的数据和原数据一样多,同一条可能出现多次 |
| 有放回抽样 | 抽中一条后放回去再抽,所以同一条可以被抽中多次,也可以一次都没被抽中 |
| 百分位法 | 把几千个重抽统计量排队,取最低和最高各 2.5% 之间的范围当 95% 区间 |
| 按簇重抽 | 每次抽整个簇(一个场景的所有用例一起带上),保留簇内的相关,不假设用例独立 |
| numpy 数组 | `np.array`,同类型元素的数组,整体运算很快,支持用一个数组当下标取值 |
| 随机数发生器 | `np.random.default_rng(seed)`,固定种子就能复现 |
| 重跑方差 | 同一个版本、同一批用例,每重跑一遍分数的波动 |
| 换题方差 | 换一批用例分数的波动,每题多跑几遍压不下去 |
| 条件方差 | 在固定了用例以后,单个用例每次运行结果的方差,也就是 p(1−p) |
| temperature | 模型采样的温度参数,0 是贪心解码,但不保证每次输出完全一样 |
| pass@k | 任选 k 遍里至少成功一遍的概率,1 − C(n−c,k)/C(n,k) |
| pass^k | 任选 k 遍全部成功的概率,C(c,k)/C(n,k),衡量稳定性 |
| 组合数 C(n,k) | 从 n 个里选 k 个的选法数,`math.comb(n, k)` |
| 有限总体修正 | 不放回地从有限个里抽样,抽得越多,波动越小,大致乘以 √((N−K)/(N−1)) |

## 常见误区

**以为 bootstrap 比公式更准。** 今天的两对对照里,包住率几乎一样(聚类 Wilson 94.3% 对 bootstrap 按场景 94.5%)。区别在于有没有处理簇,不在于用公式还是 bootstrap。它的好处是对没有现成公式的统计量也能用。

**按单条重抽。** 同一个场景的三条用例会被拆开,假设了独立,聚类白做了(差值区间 [−2.8%, +5.0%] 对按场景的 [−3.9%, +5.6%])。数据有簇就按簇抽。

**全过时用 bootstrap。** 40/40 重抽出来永远是 100%,区间宽度为零。这时用 Wilson。

**重抽次数太少。** 200 次时差值区间的下限是 −2.78%,5000 次是 −3.89%,差了一个多点。至少 1000 次,5000 起更稳。

**以为 temperature=0 就不抖。** 本来就是 temperature=0 的架构里,T7 仍然是 24/30、20/30、13/15 三批不同的结果。线上用什么温度,评测就该用什么温度。

**用一遍的结果下结论。** 同一个配置的三批,通过率从 67% 到 87%。一批 15 遍就能差 20 个点。要降抖动,每题多跑几遍。

**每题无脑多跑。** workflow 的 T6 一遍都没过,多跑 10 遍总 SD 只从 0.128 降到 0.124,浪费钱。先拆方差,看重跑和换题谁大。

**判题函数不检查「架构崩了」。** 期望「不退款」的工单,崩溃的运行因为没退款也被判通过。我的 temperature=0 第一版实验就这样「30/30」了。跑实验时同时数一下崩溃的次数。

**只报 pass@k。** 同一批数据,single 的 pass@15 是 1.000,pass^15 是 0.875。客服类 Agent 看 pass^k。

## 学习资料

### 文档与文章

- [Evan Miller《Adding Error Bars to Evals》](https://arxiv.org/abs/2411.00640)(2024):第 3.1 节讲「重采样」:每题回答 K 次,条件方差变成 σ²/K,K 增大到一定程度以后收益很小;今天的 `variance_split` 是这条关系的实现。
- [Anthropic · A statistical approach to model evaluations](https://www.anthropic.com/research/statistical-approach-to-model-evals):上面论文的短介绍。
- [Bowyer 等《Position: Don't Use the CLT in LLM Evals With Fewer Than a Few Hundred Datapoints》](https://arxiv.org/abs/2503.01747)(2025):一篇立场论文,摘要说在几百条以下的小评测集上,基于中心极限定理的误差线表现很差,通常会低估不确定性,我只读了摘要,细节自己看。
- [Madaan 等《Quantifying Variance in Evaluation Benchmarks》](https://arxiv.org/abs/2406.10229)(2024):量化评测基准里各种方差(比如训练时随机种子带来的)的论文,和今天的「重跑方差」是同一类问题。同样只读了摘要。
- [Yao 等《τ-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains》](https://arxiv.org/abs/2406.12045)(2024):提出 pass^k 这个指标。
- [scipy · stats.bootstrap](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html):今天用来核对手写代码的现成实现,文档里有「百分位法」「BCa」等方法的说明。
- [Wikipedia · Bootstrapping (statistics)](https://en.wikipedia.org/wiki/Bootstrapping_%28statistics%29):几种 bootstrap 区间的公式和适用范围。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Pr4y1e7A5&p=24&autoplay=0&high_quality=1" title="StatQuest 统计学基础 第 24 集 Bootstrapping Main Ideas" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>至冬川搬运 · [StatQuest] Statistics Fundamentals 合集第 24 集(Bootstrapping Main Ideas!!!)· 约 10 分钟,英文。一步步画出「有放回重抽、算统计量、看分布」,和今天的 boot_hand.py 是同一个过程。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/41ST4JdMrpA" title="Bootstrap Resampling - Explained" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>DataMListic · Bootstrap Resampling - Explained · 英文。bootstrap 的直观讲解,可以和 StatQuest 那集对照着看。</figcaption>
</figure>

### 书籍

- Bradley Efron、Robert Tibshirani《An Introduction to the Bootstrap》(Chapman & Hall,1993):bootstrap 发明者写的教科书,讲清了为什么有放回重抽能估计波动。有数学,先看前几章。
- Chip Huyen《AI Engineering》(O'Reilly,2025):第 3、4 章讲评测方法和评测系统,可以把今天的统计放进整个评测体系里看。

### 开源项目与代码

- 你自己的 `part10/stats.py`:今天新增 5 个函数,累计 15 个。
- [scipy · _resampling.py](https://github.com/scipy/scipy/blob/main/scipy/stats/_resampling.py):`scipy.stats.bootstrap` 的实现,可以对照今天 20 行的 `bootstrap_means` 看它多处理了什么(多种区间方法、批处理)。

## 自测

1. bootstrap 在做什么?为什么要「有放回」?

<details><summary>答案</summary>

把手里的用例当作整个用例池,从里面随机抽和原来一样多的用例,算一次统计量(比如通过率),重复几千次,看这些统计量怎么分布,取中间 95% 当区间。有放回是为了每次抽样都是从同一个池子里独立地抽;不放回的话,抽满等于原样复制一份,没有变化。有放回让同一条可能出现多次、也可能不出现,模拟的是「换一批用例会怎样」。
</details>

2. 为什么要按场景重抽,不能按单条?

<details><summary>答案</summary>

同一个场景的三条用例结果会一起对一起错。按单条重抽,三条会被拆开,等于假设它们独立,区间偏窄,Day 548 的聚类白做了。按场景重抽是每次抽整个场景,三条一起带上,保留了簇内相关。差值区间:按单条 [−2.8%, +5.0%],按场景 [−3.9%, +5.6%],后者和聚类公式的 [−3.5%, +5.7%] 对得上。
</details>

3. 什么时候不该用 bootstrap?

<details><summary>答案</summary>

通过率接近 0 或 100% 的时候。手里 40 条全是 1,重抽出来永远全是 1,区间 [100%, 100%],宽度为零。这时用 Wilson(40/40 给 [91.2%, 100%])。另外簇很少的时候(比如 3 到 5 个簇)重抽也抽不出多少花样。
</details>

4. 同一个 Agent、同一批用例,temperature 已经是 0,为什么分数还会抖?实验数据是什么?

<details><summary>答案</summary>

temperature=0 只是贪心解码,在 API 层面不保证输出一字不差(服务端批处理、浮点顺序都可能影响),而且 Agent 是多步的,一步分叉后面就都不同。实验:single 架构的 T7,原本就是 temperature=0,三批分别是 13/15、20/30、24/30;temperature=1.0 是 25/30,和 0 几乎没区别。批与批之间的通过率从 67% 到 87%。
</details>

5. 每题多跑 K 遍能降低整套得分的抖动,为什么降到一个下限就不降了?workflow 为什么多跑几遍没用?

<details><summary>答案</summary>

整套得分的方差 = 换题方差 + 重跑方差/K。多跑 K 遍只能把重跑那一块除以 K,换题那一块不变,所以总抖动有下限(模拟里 K 无穷大时是 0.0173)。workflow 的 T6 一遍都过不了,工单之间的差别大(换题 SD 0.124),重跑那块只有 0.032,K 从 1 到 10 总 SD 只从 0.128 降到 0.124。要降低不确定性得加不同的用例。
</details>

6. 面试题:「你说你的客服 Agent 通过率 98%,怎么保证这个数是稳的?」

<details><summary>答案</summary>

先问这个 98% 怎么来的:多少条用例,来自多少个场景,每条跑了几遍。然后说两种抖动:换用例会变(用 Wilson 或按场景聚类的区间,不是 p±1.96·SE),同一批用例重跑也会变(每个配置多跑几遍,看批与批之间差多少)。不会靠把 temperature 调成 0 来「稳」,因为那不是线上的配置,而且调成 0 也不能保证确定。拆开重跑方差和换题方差,决定是加用例还是加遍数。汇报时同时给 pass@1 和 pass^k(k 取 5 或 10)和区间,比如「15 遍里 pass^1 0.983,pass^10 0.887」,这样别人知道你在多次尝试里是不是每次都对。
</details>

## 明天预告

Day 550 · 评测统计学(四):样本量和多重比较,怎么跟老板说。到今天为止,我们把区间画准了,但还有两个问题没回答:这个评测集到底**能检测出多大的提升**(功效和最小可检测差异,180 条只能检测出 6.6 个点以上),想检测 3 个点要多少条(869 条);以及报告里同时看 6 个模块、10 个指标,「至少有一个显著」的概率有多大(不校正是 27.5%),怎么校正。最后把四天的零件拼成一份对比报告,写出能直接贴进 MR 的一句话。
