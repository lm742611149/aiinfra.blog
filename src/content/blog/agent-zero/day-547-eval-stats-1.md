---
title: 'Day 547 · 评测统计学(一):通过率区间,别再用 p±1.96·SE'
description: '评测跑出来 19/20 通过,真实通过率是 95% 吗?今天先用模拟看清「一次评测的分数会抖多大」,再证明 Day 354 那个 p±1.96·SE 的区间在通过率接近 100% 时会越界、会宽度为零,包住真值的次数只有 63%;然后推出 Wilson 区间,手写、用 scipy 核对、算它的精确包住率,最后套到 Day 541 的架构对比结果上,看「全过」到底能说明什么。'
pubDate: 2026-10-27
regime: none
tags: ['eval', 'statistics', 'confidence-interval', 'wilson', 'python', 'agent-zero']
series: 'agent-zero'
day: 547
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 546](/blog/agent-zero/day-546-eval-process/) 把评测分了工、钉进了流程、算了预算,还写了 `registry.py`,它的 `health` 报告里有一行「回归集最新一版没全过的」。那些通过率的数字是怎么来的、有多可靠,到今天为止都没有问过。

这个问题其实在更早的地方埋过。[Day 543](/blog/agent-zero/day-543-design-doc-2/) 的设计文档里,目标 G4 写的是「迁移后成功率与迁移前**差异不显著**」,第 8 节写的评测方法却是「迁移前后各跑一次」;模型预审第二轮指出,一次运行没法判断显不显著。[Day 541](/blog/agent-zero/day-541-orch-2/) 里「单 Agent、多 Agent、混合第二版 pass^3 都是 100%」这句话,也一直没人问过:8 张工单跑 3 遍全过,到底能说明什么。接下来四天(Day 547–550)专门回答这类问题,今天是第一步:一个通过率,误差带有多大。

## 今天要解决的问题

学完今天你应该能做到:

1. 解释「95% 置信区间」到底在说什么:不是「真值有 95% 的概率在这个区间里」,而是「用这个办法画区间,重复评测很多次,约 95% 的区间包得住真值」。这个说法今天用模拟和精确计算各验证一次。这是今天的第一个新概念:**包住率**(覆盖率,coverage)。
2. 说出 Day 354 的 p±1.96·SE 区间(下文叫 Wald 区间)在评测里的两种坏法:区间越过 100%,以及全过时区间宽度为零。给出一组具体数字:真实通过率 95%、评测 20 条时,它的 95% 区间只有 63.3% 的次数包住真值。
3. 手写 **Wilson 区间**(第二个新概念),用 scipy 的现成实现核对,并能用它回答「全过要跑多少条,才敢说下限不低于 95%」。答案是 73 条。
4. 把区间套到 Day 541 的真实结果上,并看出一个今天只埋伏笔的问题:40 次运行来自 8 张工单,它们不是 40 个独立样本。

预计用时 2.5 小时。花费 0 元(今天的脚本都不调模型;第五节用到 Day 541 `arch_bench.py` 留下的 `part10/arch_bench_raw.json`,如果你没有,见那一节开头)。前置:[Day 353](/blog/agent-zero/day-353-stats-intuition/)(抽样误差和置信区间的直觉)、[Day 354](/blog/agent-zero/day-354-testset-size/)(样本量算式,也就是 Wald 区间)、[Day 541](/blog/agent-zero/day-541-orch-2/)(`arch_bench.py`)、[Day 546](/blog/agent-zero/day-546-eval-process/)(`registry.py`,练习 4 要改它)、[Day 28](/blog/agent-zero/day-028-functions-1/)(函数)、[Day 32](/blog/agent-zero/day-032-modules/)(模块)。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `wilson_ci` 函数,再口述「为什么全过 20/20 的 Wald 区间宽度是零」;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先准备数据

后面几天(Day 548 起)要用同一份数据,今天先造出来。结构和 SupportPilot 的评测集一样:60 个场景,每个场景 3 种说法,一共 180 条用例;同一个场景的几种说法,结果七成概率一样(要么一起过要么一起挂)。这很贴近真实:Agent 不懂「年付按剩余整月退」这条规则,换三种问法也大概率都答错。数据里有两个版本 v1 和 v2,跑的是同一批用例。

```python
# agent-zero-lab/part10/make_runs.py
"""造两次评测运行的结果,用来演示统计方法。结构:60 个场景 × 3 种说法 = 180 条用例。"""
import json
import random
from pathlib import Path

OUT = Path(__file__).parent / "data" / "runs.json"


def make(seed: int = 7) -> list[dict]:
    rng = random.Random(seed)  # 自己的随机数发生器,不动全局的 random
    rows = []
    for s in range(60):                              # 60 个场景
        hard = rng.random()                          # 场景本身的难度,同场景的几种说法共享
        base = 0.55 + 0.4 * (1 - hard)               # v1 在这个场景上的成功概率
        lift = 0.06 if hard > 0.5 else 0.01          # v2 主要改善了难场景
        shared = int(rng.random() < base)            # 同场景的说法,结果往往一起对一起错
        for v in range(3):                           # 3 种说法
            a = shared if rng.random() < 0.7 else int(rng.random() < base)
            b = a if rng.random() < 0.8 else int(rng.random() < min(base + lift, 0.99))
            rows.append({"case": f"S{s:02d}-{v}", "scenario": f"S{s:02d}", "v1": a, "v2": b})
    return rows


if __name__ == "__main__":
    rows = make()
    OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=0))
    k1, k2 = sum(r["v1"] for r in rows), sum(r["v2"] for r in rows)
    print(f"{len(rows)} 条,写入 {OUT.name}")
    print(f"v1 {k1}/{len(rows)} = {k1 / len(rows):.1%}   v2 {k2}/{len(rows)} = {k2 / len(rows):.1%}")
```

<div class="line-notes">

- `OUT = Path(__file__).parent / "data" / "runs.json"` 输出放在 `part10/data/runs.json`。`__file__` 是这个脚本自己的路径,`.parent` 取它所在的目录,所以在哪里运行都写到同一个地方。先 `mkdir -p part10/data`。
- `rng = random.Random(seed)  # 自己的随机数发生器,不动全局的 random` 创建一个独立的随机数发生器,种子是 7。种子固定,每个人跑出来的 180 条一模一样,文中所有数字都能复现。
- `for s in range(60):                              # 60 个场景` 外层循环 60 个场景,s 是 0 到 59。
- `hard = rng.random()                          # 场景本身的难度,同场景的几种说法共享` 给场景抽一个 0 到 1 的难度,三种说法共用它。
- `base = 0.55 + 0.4 * (1 - hard)               # v1 在这个场景上的成功概率` 难度越高成功概率越低:`hard=0` 时是 0.95,`hard=1` 时是 0.55。
- `lift = 0.06 if hard > 0.5 else 0.01          # v2 主要改善了难场景` v2 比 v1 平均只好一点:难场景(难度大于 0.5)加 6 个点,易场景加 1 个点。
- `shared = int(rng.random() < base)            # 同场景的说法,结果往往一起对一起错` 先给场景抽一个「共同结果」。`rng.random() < base` 是布尔值,`int` 把它变成 0 或 1。
- `a = shared if rng.random() < 0.7 else int(rng.random() < base)` v1 在这条用例上的结果:70% 的概率照搬场景共同结果,30% 的概率自己再抽一次。三种说法之间的相关性就是这么来的。
- `b = a if rng.random() < 0.8 else int(rng.random() < min(base + lift, 0.99))` v2 的结果:80% 的概率和 v1 一样,20% 的概率重新抽,这次用提升后的概率。`min(..., 0.99)` 是不让概率超过 0.99。
- `rows.append({"case": f"S{s:02d}-{v}", "scenario": f"S{s:02d}", "v1": a, "v2": b})` 每条用例记 4 个字段。`f"S{s:02d}"` 把场景号补成两位,3 变成 `S03`。`scenario` 字段 Day 548 讲「用例不独立」时要用。
- `k1, k2 = sum(r["v1"] for r in rows), sum(r["v2"] for r in rows)` 0/1 直接相加就是通过条数。

</div>

```bash
cd agent-zero-lab
mkdir -p part10/data
uv run python -m part10.make_runs
```

```text
180 条,写入 runs.json
v1 138/180 = 76.7%   v2 140/180 = 77.8%
```

v1 是 138/180 = 76.7%,v2 是 140/180 = 77.8%,涨了 1.1 个点。同事在 MR 里评论「涨了,合吧」。今天只回答第一个问题:**76.7% 这个数本身,有多大的误差**。两个版本谁好谁坏,是后天的事。

## 一个分数不是真值

先不用任何公式,用模拟看一件事。假设你有一个 Agent,上帝视角告诉你它的真实通过率正好是 80%(现实里你永远不知道这个数)。你用 20 条用例评测一次。把「评测一次」重复 10000 遍,每遍得到一个分数,看这些分数怎么分布。

```python
# agent-zero-lab/part10/rerun_sim.py
"""同一个 Agent,真实通过率 80%,评测 20 条。把「评测一次」重复 10000 遍,看分数怎么分布。"""
import random
from collections import Counter

TRUE_P = 0.8   # 上帝视角:这个 Agent 真实通过率。现实里你永远不知道它
N = 20         # 一次评测 20 条用例
RERUNS = 10_000

rng = random.Random(1)


def one_eval() -> int:
    """评测一次:20 条用例各自以 80% 的概率通过,返回通过几条。"""
    return sum(rng.random() < TRUE_P for _ in range(N))


counts = Counter(one_eval() for _ in range(RERUNS))
for k in range(10, N + 1):
    bar = "#" * round(counts[k] / RERUNS * 100)
    print(f"{k:>2}/20 = {k / N:>4.0%}  {counts[k] / RERUNS:>6.1%}  {bar}")

scores = sorted(k / N for k in counts.elements())
print(f"中间 95% 的评测结果落在 {scores[int(RERUNS * 0.025)]:.0%} ~ {scores[int(RERUNS * 0.975)]:.0%}")
print(f"拿到 100% 的评测占 {counts[N] / RERUNS:.1%}")
```

<div class="line-notes">

- `TRUE_P = 0.8   # 上帝视角:这个 Agent 真实通过率。现实里你永远不知道它` 整个模拟的前提。统计学的核心困难就是:你只能看到评测分数,看不到这个数。
- `N = 20         # 一次评测 20 条用例` 一次评测的用例数。
- `RERUNS = 10_000` 重复多少次评测。数字里的下划线只是方便阅读,等于 10000。
- `rng = random.Random(1)` 固定种子,输出可复现。
- `return sum(rng.random() < TRUE_P for _ in range(N))` 20 条用例各自以 80% 的概率通过,`rng.random() < 0.8` 是布尔值,20 个布尔值相加就是通过几条。`_` 是「用不上的循环变量」的惯用名字。
- `counts = Counter(one_eval() for _ in range(RERUNS))` 重复 10000 遍,`Counter` 数每种分数出现几次(字典计数的现成版本)。
- `bar = "#" * round(counts[k] / RERUNS * 100)` 每 1% 画一个 `#`,字符串乘整数就是重复。
- `scores = sorted(k / N for k in counts.elements())` `counts.elements()` 把计数还原成 10000 个分数,排序。
- `scores[int(RERUNS * 0.025)]` 排序后第 250 个(2.5% 位置)和 `[int(RERUNS * 0.975)]` 第 9750 个(97.5% 位置)之间,是中间 95% 的结果。

</div>

```bash
uv run python -m part10.rerun_sim
```

```text
10/20 =  50%    0.2%  
11/20 =  55%    0.7%  #
12/20 =  60%    2.2%  ##
13/20 =  65%    5.6%  ######
14/20 =  70%   11.3%  ###########
15/20 =  75%   17.4%  #################
16/20 =  80%   22.0%  ######################
17/20 =  85%   20.2%  ####################
18/20 =  90%   13.5%  ##############
19/20 =  95%    5.7%  ######
20/20 = 100%    1.1%  #
中间 95% 的评测结果落在 60% ~ 95%
拿到 100% 的评测占 1.1%
```

同一个真实通过率 80% 的 Agent,评测 20 条,**得分能从 55% 到 95% 乱跳**:中间 95% 的评测落在 60% 到 95% 之间,最常见的是 16/20,但 15/20 和 17/20 也各占约两成。只有 1.1% 的评测会拿到满分,这个数可以直接算出来:0.8 的 20 次方 = 1.15%。

这就是**抽样误差**([Day 353](/blog/agent-zero/day-353-stats-intuition/) 讲过):你手里的 20 条用例只是所有可能用例里抽出来的一小把,换一把分数就变。后面所有的区间,都是想回答同一个问题:**看到 k/n 这个分数,真实通过率可能在哪个范围。**

## 老办法:p ± 1.96·SE,和它的两种坏法

[Day 354](/blog/agent-zero/day-354-testset-size/) 给的办法是这样的。通过率 p = k/n,标准误(SE,分数的典型波动幅度)是 √(p(1−p)/n),95% 区间取 p 上下各 1.96 个标准误。这个区间叫 **Wald 区间**。代入今天的 v1:

p = 138/180 = 0.7667;SE = √(0.7667 × 0.2333 / 180) = 0.0315;1.96 × SE = 0.0618;区间 = 0.7667 ± 0.0618 = [70.5%, 82.8%]。

这个结果没问题。麻烦出在评测里经常碰到的另外一种情况:通过率接近 100% 的时候(回归集本来就该接近 100%)。先把工具箱建起来,把 Wald 和今天的主角 Wilson 放在一起:

```python
# agent-zero-lab/part10/stats.py
"""评测统计的小工具箱。Day 547 先放两个区间公式,后面几天往里加。"""
import math

Z95 = 1.959964  # 标准正态分布的 97.5% 分位数,95% 区间用它


def wald_ci(k: int, n: int, z: float = Z95) -> tuple[float, float]:
    """老办法:p ± z·√(p(1-p)/n)。故意不做裁剪,好让你看到它越界。"""
    p = k / n
    half = z * math.sqrt(p * (1 - p) / n)
    return p - half, p + half


def wilson_ci(k: int, n: int, z: float = Z95) -> tuple[float, float]:
    """Wilson 区间。n 为 0 时什么都不知道,返回 (0, 1)。"""
    if n == 0:
        return 0.0, 1.0
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, centre - half), min(1.0, centre + half)


def fmt_rate(k: int, n: int) -> str:
    """138/180 = 76.7% [70.0%, 82.2%],报告里统一用这个写法。"""
    lo, hi = wilson_ci(k, n)
    return f"{k}/{n} = {k / n:.1%} [{lo:.1%}, {hi:.1%}]"
```

<div class="line-notes">

- `Z95 = 1.959964  # 标准正态分布的 97.5% 分位数,95% 区间用它` 常说的 1.96 是它的四舍五入。「95% 区间」意思是去掉两头各 2.5%,所以取 97.5% 位置的那个 z 值。
- `def wald_ci(k: int, n: int, z: float = Z95) -> tuple[float, float]:` 输入通过条数 k 和总条数 n,返回(下限,上限)。`tuple[float, float]` 是两个浮点数的元组,相当于 TS 的 `[number, number]`。
- `p = k / n` 通过率。n 是 0 时这行会除以零,下面会演示。
- `half = z * math.sqrt(p * (1 - p) / n)` 半宽 = 1.96 × SE。注意 SE 里用的 p 是**观察到的**通过率,这是 Wald 的根本问题,后面讲。
- `return p - half, p + half` 故意不裁剪,让你看到它会越界。
- `def wilson_ci(k: int, n: int, z: float = Z95) -> tuple[float, float]:` 同样的输入输出,换一个算法。公式的来历下一节讲,先照抄。
- `if n == 0:` 一条用例都没有,什么都不知道,真实通过率可能是 0 到 1 之间的任何值。
- `denom = 1 + z * z / n` 分母。n 越大,这一项越接近 1,Wilson 就越接近 Wald。
- `centre = (p + z * z / (2 * n)) / denom` 区间中心。它不是 p,而是被拉向 50% 的一个点,下一节解释。
- `half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom` 半宽,根号里比 Wald 多了一项 `z²/(4n²)`,它保证了 p 为 0 或 1 时半宽不为零。
- `return max(0.0, centre - half), min(1.0, centre + half)` 最后裁剪到 0 到 1 之间,Wilson 理论上不会越界,浮点误差可能让它差一点点。
- `return f"{k}/{n} = {k / n:.1%} [{lo:.1%}, {hi:.1%}]"` 报告里的统一写法:`138/180 = 76.7% [70.0%, 82.2%]`。`:.1%` 是百分数保留一位小数。

</div>

先看一组对照,覆盖了从常见到极端的几种结果。最后几行是 Day 541 的真实结果(`24/24`、`21/24`)和红队的 `0/12`:

```python
# agent-zero-lab/part10/wald_vs_wilson.py
"""同样的 k/n,Wald 和 Wilson 各给什么区间。"""
from part10.stats import wald_ci, wilson_ci

CASES = [
    (19, 20), (20, 20), (47, 50), (138, 180),
    (0, 12), (24, 24), (21, 24), (28, 28),
]
print(f"{'结果':<10}{'p':>7}   {'Wald 区间':<20}{'Wilson 区间':<20}")
for k, n in CASES:
    wl, wh = wald_ci(k, n)
    sl, sh = wilson_ci(k, n)
    print(f"{k:>3}/{n:<6}{k / n:>7.1%}   [{wl:>6.1%}, {wh:>6.1%}]   [{sl:>6.1%}, {sh:>6.1%}]")
```

<div class="line-notes">

- `(19, 20), (20, 20), (47, 50), (138, 180),` 前四个是常见规模:20 条过 19 条、20 条全过、50 条过 47 条、今天的 v1。
- `(0, 12), (24, 24), (21, 24), (28, 28),` `0/12` 是红队 12 次攻击没有一次成功;`24/24` 和 `21/24` 是 Day 541 的 single 和 workflow;`28/28` 是 Day 544 的回归集大小。
- `wl, wh = wald_ci(k, n)` 元组拆包成两个变量,下限和上限。
- `print(f"{k:>3}/{n:<6}{k / n:>7.1%}   [{wl:>6.1%}, {wh:>6.1%}]   [{sl:>6.1%}, {sh:>6.1%}]")` `:>3` 右对齐占 3 格,`:<6` 左对齐占 6 格,让表格对齐。

</div>

```bash
uv run python -m part10.wald_vs_wilson
```

```text
结果              p   Wald 区间             Wilson 区间           
 19/20      95.0%   [ 85.4%, 104.6%]   [ 76.4%,  99.1%]
 20/20     100.0%   [100.0%, 100.0%]   [ 83.9%, 100.0%]
 47/50      94.0%   [ 87.4%, 100.6%]   [ 83.8%,  97.9%]
138/180     76.7%   [ 70.5%,  82.8%]   [ 70.0%,  82.2%]
  0/12       0.0%   [  0.0%,   0.0%]   [  0.0%,  24.2%]
 24/24     100.0%   [100.0%, 100.0%]   [ 86.2%, 100.0%]
 21/24      87.5%   [ 74.3%, 100.7%]   [ 69.0%,  95.7%]
 28/28     100.0%   [100.0%, 100.0%]   [ 87.9%, 100.0%]
```

看四处:

- **19/20**:Wald 的上限是 104.6%,通过率超过 100%,不可能。算一下:p = 0.95,SE = 0.0487,1.96 × SE = 0.0955,0.95 + 0.0955 = 1.0455。Wilson 是 [76.4%, 99.1%],上限在 100% 以内,下限也比 Wald 低了 9 个点。
- **20/20 和 24/24 和 28/28**:Wald 的区间是 [100%, 100%],宽度为零。公式里 p(1−p) = 1 × 0 = 0,SE 就是 0,它在说「真实通过率一定是 100%」。Wilson 说 20/20 的下限是 83.9%,24/24 是 86.2%,28/28 是 87.9%。
- **0/12**:Wald 是 [0%, 0%],「攻击成功率一定是 0」。Wilson 的上限是 24.2%:12 次攻击一次没成功,不能排除真实成功率高达近四分之一。
- **138/180**:n 大、p 居中,两个几乎一样(Wald [70.5%, 82.8%],Wilson [70.0%, 82.2%])。所以 Wald 不是处处都错,是在评测里最关心的两头错得离谱。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="四组结果的两种区间画在 0 到 100% 的轴上:19/20 时 Wald 区间的右端越过了 100% 线;20/20 和 24/24 时 Wald 只是 100% 处的一个点而 Wilson 是一段;0/12 时 Wald 是 0% 处的一个点而 Wilson 一直延伸到约 24%">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12">
    <line x1="60" y1="18" x2="60" y2="226" stroke="var(--rule)"/>
    <line x1="320" y1="18" x2="320" y2="226" stroke="var(--rule)" stroke-dasharray="3 3"/>
    <line x1="580" y1="18" x2="580" y2="226" stroke="var(--rule)"/>
    <text x="60" y="244" text-anchor="middle" fill="var(--ink-soft)">0%</text>
    <text x="320" y="244" text-anchor="middle" fill="var(--ink-soft)">50%</text>
    <text x="580" y="244" text-anchor="middle" fill="var(--ink-soft)">100%</text>
    <text x="8" y="54" fill="var(--ink)">19/20</text>
    <line x1="504.1" y1="43" x2="603.9" y2="43" stroke="var(--compute)" stroke-width="5"/>
    <line x1="457.3" y1="57" x2="575.3" y2="57" stroke="var(--mem)" stroke-width="5"/>
    <text x="8" y="104" fill="var(--ink)">20/20</text>
    <circle cx="580" cy="93" r="4" fill="var(--compute)"/>
    <line x1="496.3" y1="107" x2="580" y2="107" stroke="var(--mem)" stroke-width="5"/>
    <text x="8" y="154" fill="var(--ink)">0/12</text>
    <circle cx="60" cy="143" r="4" fill="var(--compute)"/>
    <line x1="60" y1="157" x2="185.8" y2="157" stroke="var(--mem)" stroke-width="5"/>
    <text x="8" y="204" fill="var(--ink)">24/24</text>
    <circle cx="580" cy="193" r="4" fill="var(--compute)"/>
    <line x1="508.2" y1="207" x2="580" y2="207" stroke="var(--mem)" stroke-width="5"/>
    <text x="420" y="22" fill="var(--compute)">上:Wald</text>
    <text x="500" y="22" fill="var(--mem)">下:Wilson</text>
  </g>
</svg>
<figcaption>每组结果两条线,上面琥珀色是 Wald,下面蓝色是 Wilson。19/20 的 Wald 右端伸出了 100% 的竖线;全过和零次的 Wald 只是一个点(宽度为零);Wilson 在这些地方都老老实实留出了「说不准」的一段。</figcaption>
</figure>

### 先演示一个报错

n 为 0 的时候,`wald_ci` 会怎样?一条用例都没跑就想算区间,比如某个新模块的回归集还是空的:

```bash
uv run python -c "
from part10.stats import wald_ci
wald_ci(0, 0)"
```

```text
Traceback (most recent call last):
  File "<string>", line 3, in <module>
  File "/Users/你/agent-zero-lab/part10/stats.py", line 10, in wald_ci
    p = k / n
        ~~^~~
ZeroDivisionError: division by zero
```

`ZeroDivisionError`,除以零。`wilson_ci` 单独处理了 `n == 0` 返回 (0, 1),意思是「一无所知」。在报告工具里这个差别很实际:空的回归集不应该让整份报告崩掉(Day 546 那个 `KeyError` 的同类问题),而应该老实写「0 条,什么都说不了」。

## 「95%」到底是什么意思

两种坏法是看得见的。更要紧的是看不见的:Wald 区间标着 95%,它**实际**包住真值的次数是多少?这件事可以直接数。上帝视角给一个真实通过率 p,评测一次得到 k,画出区间,看区间里有没有 p。重复 10000 次,数有几次包住。

```python
# agent-zero-lab/part10/coverage_sim.py
"""95% 区间到底有几成真包住了真实通过率?把评测重复 10000 遍,数。"""
import random

from part10.stats import wald_ci, wilson_ci

RERUNS = 10_000
rng = random.Random(2)


def covered(ci: tuple[float, float], p: float) -> bool:
    return ci[0] <= p <= ci[1]


print(f"{'真实 p':>6} {'n':>4} | {'Wald 包住':>9} {'Wilson 包住':>11} | 这些评测里 k=n(全过)的占比")
for p, n in [(0.5, 50), (0.8, 20), (0.95, 20), (0.95, 50), (0.99, 100)]:
    hit_wald = hit_wilson = all_pass = 0
    for _ in range(RERUNS):
        k = sum(rng.random() < p for _ in range(n))
        hit_wald += covered(wald_ci(k, n), p)
        hit_wilson += covered(wilson_ci(k, n), p)
        all_pass += k == n
    print(f"{p:>6.2f} {n:>4} | {hit_wald / RERUNS:>9.1%} {hit_wilson / RERUNS:>11.1%} | {all_pass / RERUNS:>6.1%}")
```

<div class="line-notes">

- `rng = random.Random(2)` 固定种子 2。
- `def covered(ci: tuple[float, float], p: float) -> bool:` 真值 p 在不在区间里。
- `return ci[0] <= p <= ci[1]` Python 允许把比较连起来写,相当于 JS 的 `ci[0] <= p && p <= ci[1]`。
- `for p, n in [(0.5, 50), (0.8, 20), (0.95, 20), (0.95, 50), (0.99, 100)]:` 五种情形:从居中到接近 100%,从 20 条到 100 条。每种情形下真实通过率是已知的,这是只有在模拟里才有的上帝视角。
- `k = sum(rng.random() < p for _ in range(n))` 模拟一次评测:n 条用例各以概率 p 通过。
- `hit_wald += covered(wald_ci(k, n), p)` 布尔值能加,包住了加 1。
- `all_pass += k == n` 顺便数一下「全过」的评测有多少,最后一列用。

</div>

```bash
uv run python -m part10.coverage_sim
```

```text
  真实 p    n |   Wald 包住   Wilson 包住 | 这些评测里 k=n(全过)的占比
  0.50   50 |     93.6%       93.6% |   0.0%
  0.80   20 |     92.4%       95.9% |   1.1%
  0.95   20 |     63.3%       92.1% |  36.4%
  0.95   50 |     91.8%       96.4% |   7.9%
  0.99  100 |     63.1%       92.1% |  36.8%
```

读第三行:真实通过率 95%,评测 20 条,Wald 区间**只有 63.3% 的评测包住了真值**,标签写的是 95%。Wilson 是 92.1%,也不到 95,但离得近多了。第五行:真实通过率 99%、评测 100 条,Wald 63.1%,Wilson 92.1%。最后一列解释了原因:这两种情形里有 36% 的评测是全过的,而全过时 Wald 区间宽度为零、一定包不住 95% 或 99%。它的失败集中在通过率接近 100% 的地方,而那恰恰是评测里最常见的地方。第一行(p = 0.5,n = 50)两个都是 93.6%,居中的时候没有区别。

模拟是抽样出来的,多少有点随机。同一件事也可以不抽样,直接算:真实通过率是 p,评测 n 条,通过 k 条的概率是个确定的数(二项分布),把「区间包得住 p」的那些 k 的概率加起来就是精确的包住率。

```python
# agent-zero-lab/part10/exact_coverage.py
"""不抽样,直接把二项分布的每一种结果加起来,算区间的「精确包住率」。"""
from math import comb

from part10.stats import wald_ci, wilson_ci


def exact_coverage(ci_fn, p: float, n: int) -> float:
    """真实通过率是 p、评测 n 条时,k 取 0..n 各有多大概率,哪些 k 的区间包得住 p,概率加起来。"""
    total = 0.0
    for k in range(n + 1):
        prob_k = comb(n, k) * p**k * (1 - p) ** (n - k)  # 恰好通过 k 条的概率
        lo, hi = ci_fn(k, n)
        if lo <= p <= hi:
            total += prob_k
    return total


if __name__ == "__main__":
    print(f"{'真实 p':>6} {'n':>4} | {'Wald':>6} {'Wilson':>7}")
    for p, n in [(0.5, 50), (0.8, 20), (0.95, 20), (0.95, 50), (0.99, 100)]:
        print(f"{p:>6.2f} {n:>4} | {exact_coverage(wald_ci, p, n):>6.1%} {exact_coverage(wilson_ci, p, n):>7.1%}")

    # 把 p 在 0.90~0.995 之间扫一遍,看 n=20 时 Wilson 的最差情况
    grid = [0.90 + 0.001 * i for i in range(96)]
    cov = [exact_coverage(wilson_ci, p, 20) for p in grid]
    covw = [exact_coverage(wald_ci, p, 20) for p in grid]
    print(f"n=20, p 从 0.90 扫到 0.995:Wilson 最低 {min(cov):.1%} 平均 {sum(cov) / len(cov):.1%};"
          f"Wald 最低 {min(covw):.1%} 平均 {sum(covw) / len(covw):.1%}")
```

<div class="line-notes">

- `from math import comb` `comb(n, k)` 是「从 n 个里选 k 个」有几种选法,组合数,C(n,k)。
- `def exact_coverage(ci_fn, p: float, n: int) -> float:` `ci_fn` 是一个函数参数,传 `wald_ci` 或 `wilson_ci` 进来。Python 的函数可以像 JS 一样当参数传。
- `prob_k = comb(n, k) * p**k * (1 - p) ** (n - k)  # 恰好通过 k 条的概率` 二项分布的公式:恰好 k 条通过、n−k 条没过,有 C(n,k) 种排列。比如 n=20、p=0.95、k=19:20 × 0.95¹⁹ × 0.05 = 0.377。
- `lo, hi = ci_fn(k, n)` 这个 k 对应的区间。
- `if lo <= p <= hi:` 区间包得住真值,就把「这个 k 出现的概率」加进总数。
- `grid = [0.90 + 0.001 * i for i in range(96)]` 把真实通过率从 0.90 一直扫到 0.995,步长 0.001。
- `print(f"n=20, p 从 0.90 扫到 0.995:Wilson 最低 {min(cov):.1%} 平均 {sum(cov) / len(cov):.1%};"` 看最差情况和平均情况。

</div>

```bash
uv run python -m part10.exact_coverage
```

```text
  真实 p    n |   Wald  Wilson
  0.50   50 |  93.5%   93.5%
  0.80   20 |  92.1%   95.6%
  0.95   20 |  63.9%   92.5%
  0.95   50 |  92.0%   96.2%
  0.99  100 |  63.3%   92.1%
n=20, p 从 0.90 扫到 0.995:Wilson 最低 85.2% 平均 95.4%;Wald 最低 9.5% 平均 60.0%
```

精确值和模拟对得上(Wald 63.9% 对 63.3%,Wilson 92.5% 对 92.1%)。最后一行有两个值得停一下的数。一,**Wilson 也不是精确的 95%**:n = 20、真实通过率在 0.90 到 0.995 之间扫,平均 95.4%,但最低掉到过 85.2%。包住率随 p 呈锯齿形上下摆,因为 k 只能取整数。二,Wald 在同一范围里平均只有 60.0%,最低 9.5%。

所以「Wilson 比 Wald 好」的准确说法是:**在评测常见的范围里,Wilson 的包住率平均接近标称值,Wald 的平均远低于标称值,并且坏在最关心的那一头。** 学界对二项比例区间有一篇经典的比较研究(Brown、Cai、DasGupta 2001,见学习资料),结论也是不建议在小样本里用 Wald。还有一类更保守的做法叫 Clopper–Pearson(「精确」区间),它保证包住率不低于标称值,代价是区间更宽:同样是 20/20,它给的下限是 83.2%(Wilson 是 83.9%);0/12 时它给的上限是 26.5%(Wilson 是 24.2%)。这两个数我用 scipy 的 `method="exact"` 算过。做评测报告,Wilson 是个好默认;需要「宁可宽一点也别说大话」时,换 Clopper–Pearson。

## Wilson 区间是怎么来的

公式放最后。先用一个笨办法找到它。

Wald 的毛病在哪?它算标准误的时候用的是**观察到的** p,可观察到的 p 恰恰是不可靠的那个数(20/20 的 p 是 1,标准误就是 0)。Wilson 的想法是倒过来问:不围着观察到的分数画区间,而是逐个试「真实通过率 p 如果是这个值,我看到的这个分数算不算离谱」。判断离谱的标准还是 1.96 个标准误,但标准误用的是**被试的那个 p**:

```python
# agent-zero-lab/part10/wilson_scan.py
"""Wilson 区间的来历:不是围着 p̂ 画区间,而是问「哪些真实 p,能让我看到的结果不算离谱」。"""
import math

from part10.stats import Z95, wilson_ci

k, n = 19, 20
p_hat = k / n

# 一个一个试:真实通过率如果是 p,评测 20 条的分数波动(标准误)是 √(p(1-p)/n)。
# 我看到的 p_hat 离 p 不超过 1.96 个标准误,就说「p 这个猜测说得通」。
keep = []
for i in range(1, 10000):          # p = 0.0001, 0.0002, ... , 0.9999
    p = i / 10000
    se = math.sqrt(p * (1 - p) / n)  # 注意:标准误用的是「猜测的 p」,不是 p_hat
    if abs(p_hat - p) <= Z95 * se:
        keep.append(p)

print(f"{k}/{n}:逐个试 p,说得通的范围是 {min(keep):.4f} ~ {max(keep):.4f}")
lo, hi = wilson_ci(k, n)
print(f"        公式算出的 Wilson 区间   {lo:.4f} ~ {hi:.4f}")

# 区间中心:不在 p_hat=0.95,而是往 50% 那边挪一点
centre = (lo + hi) / 2
print(f"区间中心 {centre:.4f},约等于先补 z²/2 次成功、z²/2 次失败再算比例:"
      f"({k}+{Z95**2 / 2:.2f})/({n}+{Z95**2:.2f}) = {(k + Z95**2 / 2) / (n + Z95**2):.4f}")
```

<div class="line-notes">

- `k, n = 19, 20` 以 19/20 为例,`p_hat` 是观察到的 0.95。
- `for i in range(1, 10000):          # p = 0.0001, 0.0002, ... , 0.9999` 把真实通过率从 0.0001 到 0.9999 逐个试一遍。
- `se = math.sqrt(p * (1 - p) / n)  # 注意:标准误用的是「猜测的 p」,不是 p_hat` 这一行就是 Wilson 和 Wald 的全部区别。Wald 在这里用的是 `p_hat`。
- `if abs(p_hat - p) <= Z95 * se:` 如果真实通过率是 p,观察到的分数 `p_hat` 离它不超过 1.96 个标准误,就说这个 p 说得通,留下。
- `print(f"{k}/{n}:逐个试 p,说得通的范围是 {min(keep):.4f} ~ {max(keep):.4f}")` 留下来的 p 里最小和最大的,就是区间的两端。
- `lo, hi = wilson_ci(k, n)` 公式直接算出的 Wilson 区间,拿来对答案。
- `centre = (lo + hi) / 2` 区间中心。
- `({k}+{Z95**2 / 2:.2f})/({n}+{Z95**2:.2f}) = {(k + Z95**2 / 2) / (n + Z95**2):.4f}` Wilson 的中心等于「先补 z²/2 ≈ 1.92 次成功、1.92 次失败」再算比例。19/20 补上以后是 20.92/23.84。

</div>

```bash
uv run python -m part10.wilson_scan
```

```text
19/20:逐个试 p,说得通的范围是 0.7639 ~ 0.9911
        公式算出的 Wilson 区间   0.7639 ~ 0.9911
区间中心 0.8775,约等于先补 z²/2 次成功、z²/2 次失败再算比例:(19+1.92)/(20+3.84) = 0.8775
```

逐个试出来的范围是 0.7639 ~ 0.9911,公式给的也是 0.7639 ~ 0.9911,一模一样。`wilson_ci` 里那行看着吓人的公式,其实就是把这个「逐个试」的过程解成了一个二次方程。

最后一行给了一个好记的直觉:Wilson 的区间中心是 0.8775,不是 0.95。它等于「先在成绩单上补 1.92 次成功、1.92 次失败(合起来约 4 条虚拟用例),再算比例」。小样本的分数不可信,所以先往 50% 那边拉一下;样本大了,补的那 4 条就微不足道,区间自然回到 Wald 附近。这也解释了为什么 138/180 时两者几乎一样。

公式写对了没有?用 scipy 现成的实现核对。scipy 只在这个脚本里对答案,不是项目依赖,用 `uv add --dev scipy` 装:

```python
# agent-zero-lab/part10/check_wilson.py
"""用 scipy 的现成实现核对我们手写的 Wilson。scipy 只在这里用来对答案,不是项目依赖。"""
from scipy.stats import binomtest

from part10.stats import wilson_ci

worst = 0.0
for n in (1, 2, 5, 12, 20, 24, 50, 180, 1000):
    for k in range(n + 1):
        ours = wilson_ci(k, n)
        ref = binomtest(k, n).proportion_ci(confidence_level=0.95, method="wilson")
        worst = max(worst, abs(ours[0] - ref.low), abs(ours[1] - ref.high))
print(f"9 种 n、共 {sum(n + 1 for n in (1, 2, 5, 12, 20, 24, 50, 180, 1000))} 组 k/n,最大差 {worst:.2e}")

ref = binomtest(138, 180).proportion_ci(confidence_level=0.95, method="wilson")
print(f"138/180  ours={wilson_ci(138, 180)[0]:.4f}~{wilson_ci(138, 180)[1]:.4f}  scipy={ref.low:.4f}~{ref.high:.4f}")
```

<div class="line-notes">

- `from scipy.stats import binomtest` 二项检验。它返回的结果对象带一个 `proportion_ci` 方法,可以按指定方法算比例的置信区间。
- `for n in (1, 2, 5, 12, 20, 24, 50, 180, 1000):` 九种总条数,从 1 条到 1000 条。
- `for k in range(n + 1):` 每种 n 下,k 取 0 到 n 的每一个值都比一遍,共 1303 组。
- `ref = binomtest(k, n).proportion_ci(confidence_level=0.95, method="wilson")` 请 scipy 按 Wilson 方法算 95% 区间。
- `worst = max(worst, abs(ours[0] - ref.low), abs(ours[1] - ref.high))` 记下所有组里下限和上限的最大差。
- `ref = binomtest(138, 180).proportion_ci(` 再单独看今天的 v1。

</div>

```bash
uv add --dev scipy
uv run python -m part10.check_wilson
```

```text
9 种 n、共 1303 组 k/n,最大差 3.88e-09
138/180  ours=0.6997~0.8225  scipy=0.6997~0.8225
```

1303 组 k/n 里最大的差是 3.9e-9,是因为我写的 `Z95 = 1.959964` 只取了六位小数。今天 v1 的区间 [0.6997, 0.8225] 两边完全一致。以后要用现成的,`scipy.stats.binomtest(...).proportion_ci(method="wilson")` 或者 statsmodels 的 `proportion_confint(k, n, method="wilson")` 都行;自己手写的好处是你知道每个数从哪来,也不用为一个函数引入整个 scipy。

## 具体数字:全过了,能说什么

有了工具,回答几个评测里每天会碰到的问题。

**问题一:全过 n 条,下限能到多少?要跑多少条才敢说不低于 95%?** 全过(k = n)时 Wilson 的下限正好是 n/(n + z²),反解出 n。直接用代码找:

```python
# agent-zero-lab/part10/n_for_allpass.py
"""全过(k = n)的时候,想让 Wilson 下限不低于某个值,至少要跑多少条?"""
from part10.stats import Z95, wilson_ci


def min_n(floor: float) -> int:
    n = 1
    while wilson_ci(n, n)[0] < floor:
        n += 1
    return n


for floor in (0.80, 0.90, 0.95, 0.99):
    n = min_n(floor)
    closed = Z95**2 * floor / (1 - floor)  # 全过时下限恰好是 n/(n+z²),反解 n
    print(f"下限 ≥ {floor:.0%}:至少 {n:>3} 条全过(反解公式 n ≥ {closed:.1f});"
          f"{n} 条的下限是 {wilson_ci(n, n)[0]:.3%},少一条({n - 1})是 {wilson_ci(n - 1, n - 1)[0]:.3%}")

print()
print("0 次失败时,上限:")
for n in (12, 24, 30, 100):
    print(f"  0/{n:<3} Wilson 上限 {wilson_ci(0, n)[1]:.1%}   三法则 3/n = {3 / n:.1%}")
```

<div class="line-notes">

- `def min_n(floor: float) -> int:` 找最小的 n,使「n 条全过」时 Wilson 下限不低于 `floor`。
- `while wilson_ci(n, n)[0] < floor:` 从 n = 1 开始一条一条加,`wilson_ci(n, n)` 就是 n 条全过,`[0]` 取下限。
- `closed = Z95**2 * floor / (1 - floor)  # 全过时下限恰好是 n/(n+z²),反解 n` 下限 = n/(n+z²),令它等于 floor 解出 n = z² × floor/(1−floor)。95% 时 = 3.8415 × 0.95/0.05 = 73.0。
- `print(f"下限 ≥ {floor:.0%}:至少 {n:>3} 条全过` 打印找到的 n 和反解公式对照,两者应该只差取整。
- `f"{n} 条的下限是 {wilson_ci(n, n)[0]:.3%},少一条({n - 1})是 {wilson_ci(n - 1, n - 1)[0]:.3%}"` 验证「最小」:n 条刚好过线,少一条就差一点点。
- `for n in (12, 24, 30, 100):` 零次失败时的上限,和「三法则」对照。

</div>

```bash
uv run python -m part10.n_for_allpass
```

```text
下限 ≥ 80%:至少  16 条全过(反解公式 n ≥ 15.4);16 条的下限是 80.639%,少一条(15)是 79.612%
下限 ≥ 90%:至少  35 条全过(反解公式 n ≥ 34.6);35 条的下限是 90.110%,少一条(34)是 89.849%
下限 ≥ 95%:至少  73 条全过(反解公式 n ≥ 73.0);73 条的下限是 95.001%,少一条(72)是 94.935%
下限 ≥ 99%:至少 381 条全过(反解公式 n ≥ 380.3);381 条的下限是 99.002%,少一条(380)是 98.999%

0 次失败时,上限:
  0/12  Wilson 上限 24.2%   三法则 3/n = 25.0%
  0/24  Wilson 上限 13.8%   三法则 3/n = 12.5%
  0/30  Wilson 上限 11.4%   三法则 3/n = 10.0%
  0/100 Wilson 上限 3.7%   三法则 3/n = 3.0%
```

想让「全过」的下限不低于 90%,至少要 35 条全过;不低于 95%,73 条;不低于 99%,381 条。**20 条全过只能保证不低于 83.9%,24 条全过(Day 541 那种规模)不低于 86.2%。** 一批 20 来条的回归集全过,你可以说「没有发现问题」,但不能说「通过率 100%」,更不能说「至少 95%」。

最后一部分是反过来的:一次失败也没有时,上限在哪。有个简单的经验法则叫**三法则**(rule of three):n 次里零次发生,真实发生率的 95% 上限约是 3/n。输出里 0/100 的 Wilson 上限是 3.7%,三法则是 3.0%;0/12 是 24.2% 对 25.0%。两者量级一致,脑算用三法则、写报告用 Wilson 就行。红队测试尤其用得上:12 次攻击零次成功,你只能说「95% 的把握下,成功率不超过 24%」,和「攻击成功率是 0」给老板的感觉完全不同;要想把上限压到 3% 以下,得有 100 次以上的零成功。

**问题二:Day 541 的结果加上区间是什么样?** 下面读 `arch_bench.py` 留下的 `part10/arch_bench_raw.json`。我这次用 5 遍重跑了四种架构(2026 年 10 月 27 日,每种 8 张工单 × 5 遍 = 40 次,总共约 ¥0.21),你想对上数字就这样跑,否则用你自己的 Day 541 的文件也行,数字会略有不同:

```bash
uv run python -m part10.arch_bench 5 workflow single hybrid2 hybrid
```

```python
# agent-zero-lab/part10/bench_intervals.py
"""给 Day 541 的架构对比结果加上区间。读 arch_bench.py 留下的 part10/arch_bench_raw.json。"""
import json
from collections import defaultdict
from pathlib import Path

from part10.stats import fmt_rate

raw = json.loads((Path(__file__).parent / "arch_bench_raw.json").read_text())

by_arch: dict[str, list[dict]] = defaultdict(list)
for r in raw:
    by_arch[r["arch"]].append(r)

print("按「每一次运行」数(把每次运行当一个独立样本):")
for arch, runs in by_arch.items():
    k = sum(r["ok"] for r in runs)
    print(f"  {arch:<8} {fmt_rate(k, len(runs))}")

print("按「工单」数(一张工单的几次运行要全过才算这张过):")
for arch, runs in by_arch.items():
    tickets: dict[str, list[bool]] = defaultdict(list)
    for r in runs:
        tickets[r["task_id"]].append(r["ok"])
    k = sum(all(v) for v in tickets.values())
    print(f"  {arch:<8} {fmt_rate(k, len(tickets))}")
```

<div class="line-notes">

- `raw = json.loads((Path(__file__).parent / "arch_bench_raw.json").read_text())` 读 Day 541 的原始结果。每条是一次运行:`arch`、`task_id`、`ok`、`cost` 等。
- `by_arch: dict[str, list[dict]] = defaultdict(list)` 按架构分组,`defaultdict(list)` 在键第一次出现时自动建一个空列表。
- `k = sum(r["ok"] for r in runs)` `ok` 是布尔值,加起来就是通过几次。
- `print(f"  {arch:<8} {fmt_rate(k, len(runs))}")` 第一种算法:把每一次运行当一个样本,40 次里过了 k 次。
- `tickets: dict[str, list[bool]] = defaultdict(list)` 第二种算法:按工单归并。
- `k = sum(all(v) for v in tickets.values())` 一张工单的 5 次**全过**才算这张过(`all` 相当于 JS 的 `every`),8 张里过了几张。这其实是 Day 541 里 pass^k 的算法。

</div>

```bash
uv run python -m part10.bench_intervals
```

```text
按「每一次运行」数(把每次运行当一个独立样本):
  workflow 35/40 = 87.5% [73.9%, 94.5%]
  single   39/40 = 97.5% [87.1%, 99.6%]
  hybrid2  40/40 = 100.0% [91.2%, 100.0%]
  hybrid   10/40 = 25.0% [14.2%, 40.2%]
按「工单」数(一张工单的几次运行要全过才算这张过):
  workflow 7/8 = 87.5% [52.9%, 97.8%]
  single   7/8 = 87.5% [52.9%, 97.8%]
  hybrid2  8/8 = 100.0% [67.6%, 100.0%]
  hybrid   2/8 = 25.0% [7.1%, 59.1%]
```

先看上半部分,每一次运行当一个独立样本:

- hybrid2 全过 40/40,区间 [91.2%, 100%]。「100%」这个数,实际能支持的说法是「大概率不低于 91%」。
- single 是 39/40(有一次把「8 月和 9 月各扣 468」当成了重复),区间 [87.1%, 99.6%],和 hybrid2 的区间大面积重叠。**在这个样本量下,single 和 hybrid2 谁更好,这批数据说不出来。** Day 541 里「混合第二版和单 Agent 都是 100%」那句话,当时的措辞没问题,但没人该拿它推出「两个一样好」。
- workflow 35/40 = 87.5%,区间 [73.9%, 94.5%],hybrid 第一版 10/40 = 25%,区间 [14.2%, 40.2%]。后者和其他三个根本不在一个范围,这种差距不需要统计也看得出来。

再看下半部分,按工单数(8 张):hybrid2 是 8/8,区间 [67.6%, 100%]。Day 543 的 ADR 0003 理由里写「pass^3 都是 100%」,准确的读法是:8 张工单全部稳定通过,但 8 张这么少,真实的「工单稳定通过率」下限只能说不低于约 68%。这不是说选混合架构错了,选它的理由本来就不是靠这个数(还有成本和代码核对)。它说的是:**别拿这么小的样本去证明两个架构一样好。**

还有一件事要放在心上。第一种算法把 40 次运行当成 40 个独立样本,可它们只来自 8 张工单,每张跑 5 遍。workflow 的 5 次失败全部是同一张工单 T6(规则里只会退一张),这 5 次不是 5 个独立的坏消息,而是同一个坏消息说了 5 遍。把它们当独立样本,区间会算窄(上半部分的 [73.9%, 94.5%] 偏乐观);按工单数,区间又宽得多(下半部分的 [52.9%, 97.8%]),但那是另一个指标(5 次全过才算过)。真实的不确定性在两者之间。同一份数据里这样的相关,Day 548 会专门讲,叫**聚类**,那里会给出正确的算法。今天记住一句话就够:**Wilson 假设每个样本独立,用例成组出现时,它给的区间偏窄。**

## 放进 registry

最后把区间接进 [Day 546](/blog/agent-zero/day-546-eval-process/) 的 `health` 报告里:数字不带区间,就是只报了一半的事。这是练习 4,答案里会给出输出。到这里 `part10/stats.py` 里有了 `wald_ci`、`wilson_ci` 和 `fmt_rate`,后面几天会往里继续加聚类标准误、配对比较、bootstrap 和样本量计算。

## 动手练习

**练习 1:9/10 的 Wilson 区间,手算一遍。** 把 `wilson_ci` 里的几步拆开,一步一步打印中间量(分母、中心、半宽),手算出 9/10 的区间,再和函数的结果对一下。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex547_hand.py
"""练习 1:把 9/10 的 Wilson 区间一步一步算出来,最后和 wilson_ci 对一下。"""
import math

from part10.stats import Z95, wilson_ci

k, n = 9, 10
p = k / n
z2 = Z95**2                                   # z 的平方,约 3.84
denom = 1 + z2 / n                            # 分母
centre = (p + z2 / (2 * n)) / denom           # 区间中心
half = Z95 * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denom  # 半宽
print(f"p={p}  z²={z2:.4f}  分母={denom:.4f}  中心={centre:.4f}  半宽={half:.4f}")
print(f"手算:[{centre - half:.4f}, {centre + half:.4f}]")
print(f"函数:[{wilson_ci(k, n)[0]:.4f}, {wilson_ci(k, n)[1]:.4f}]")
```

<div class="line-notes">

- `z2 = Z95**2                                   # z 的平方,约 3.84` `**` 是乘方。Wilson 公式里到处出现 z²,先算出来。
- `denom = 1 + z2 / n                            # 分母` 1 + 3.8415/10 = 1.3841。
- `centre = (p + z2 / (2 * n)) / denom           # 区间中心` (0.9 + 3.8415/20) / 1.3841 = 1.0921/1.3841 = 0.7890。9/10 的中心在 0.789,被拉向 50% 的一边。
- `half = Z95 * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denom  # 半宽` 根号里:0.9×0.1/10 + 3.8415/400 = 0.009 + 0.0096 = 0.0186,开方 0.1364,乘 1.96 得 0.2673,除以 1.3841 得 0.1931。
- `print(f"手算:[{centre - half:.4f}, {centre + half:.4f}]")` 0.7890 − 0.1931 = 0.5958,0.7890 + 0.1931 = 0.9821。

</div>

```bash
uv run python -m part10.ex547_hand
```

```text
p=0.9  z²=3.8415  分母=1.3841  中心=0.7890  半宽=0.1931
手算:[0.5958, 0.9821]
函数:[0.5958, 0.9821]
```

手算和函数一致:9/10 的 95% Wilson 区间是 [59.6%, 98.2%]。10 条里过了 9 条,真实通过率低到 60% 也说得通。你可以对比一下 Wald:0.9 ± 1.96 × √(0.09/10) = 0.9 ± 0.186,是 [71.4%, 108.6%],上限又越界了。

</details>

**练习 2:回归集全过能写「100%」吗?** 回归集 28 条(Day 544 的大小)全过、挂 1 条、挂 2 条,各给一个带区间的写法。红队测了 12 次零成功,和测了 120 次零成功,各自该怎么汇报?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex547_regression.py
"""练习 2:回归集全过能说「100%」吗?红队 0 次攻击成功呢?"""
from part10.stats import fmt_rate

print("回归集 28 条:")
for k in (28, 27, 26):
    print("  ", fmt_rate(k, 28))
print("红队 12 次攻击:")
print("  ", fmt_rate(0, 12), "<- 这是「攻击成功」的比例")
print("红队 120 次攻击:")
print("  ", fmt_rate(0, 120))
```

```bash
uv run python -m part10.ex547_regression
```

```text
回归集 28 条:
   28/28 = 100.0% [87.9%, 100.0%]
   27/28 = 96.4% [82.3%, 99.4%]
   26/28 = 92.9% [77.4%, 98.0%]
红队 12 次攻击:
   0/12 = 0.0% [0.0%, 24.2%] <- 这是「攻击成功」的比例
红队 120 次攻击:
   0/120 = 0.0% [0.0%, 3.1%]
```

回归集 28/28:写「28/28 全过,95% 区间 [87.9%, 100%]」,不要写「通过率 100%」。挂 1 条的 27/28 区间是 [82.3%, 99.4%],挂 2 条是 [77.4%, 98.0%]。注意:28 条全过和挂 1 条挂 2 条的区间**大面积重叠**,所以「挂了 1 条」本身说明不了通过率下降了,它是个需要看具体用例的信号(Day 544 说过,回归集挂的是具体哪几条,点名去看就行,不必等统计),而不是需要统计去证明的东西。

红队 12 次零成功:「攻击成功率 95% 上限约 24%」;120 次零成功:「上限约 3.1%」。要说「低于 5%」,至少得有 73 次零成功(和全过要 73 条才敢说不低于 95% 是同一个数,因为两头对称)(你可以用 `wilson_ci(0, n)[1]` 试出来)。汇报时写次数和上限,不写「0%」。

</details>

**练习 3:21/24 和 24/24 能不能说有差别?** Day 541 正式实验里 workflow 是 21/24,single 是 24/24。各算区间,看重不重叠,然后说说「重叠就说明没差别」这个看法对不对。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex547_compare.py
"""练习 3:Day 541 的正式实验(8 张工单 × 3 次 = 24 次):workflow 21/24,single 24/24。"""
from part10.stats import fmt_rate

print("workflow", fmt_rate(21, 24))
print("single  ", fmt_rate(24, 24))
```

```bash
uv run python -m part10.ex547_compare
```

```text
workflow 21/24 = 87.5% [69.0%, 95.7%]
single   24/24 = 100.0% [86.2%, 100.0%]
```

区间 [69.0%, 95.7%] 和 [86.2%, 100%] 有一大段重叠(86% 到 96%)。但「区间重叠就说明没差别」这个判断本身是错的:两个区间重叠,差值的区间仍然可能不包含 0。原因是这两个版本跑的是**同一批工单**,逐张比较(配对)比各画各的区间灵敏得多。这个留到 Day 548。今天能说的只有:单看这两个分数,24 次的样本不足以下结论,而且已知 workflow 的 3 次失败全是同一张工单 T6,换句话说差别其实只来自一张工单,别被「3 次」吓到,也别被「重叠」安慰到。

</details>

**练习 4:让 `health` 带上区间。** 在 `registry.py` 的 `health` 报告最后加一行:回归集最新一版的通过率,用 `fmt_rate` 写成带区间的形式。不要改 `registry.py`,新建 `part10/ex547_health.py` 调用它。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex547_health.py
"""练习 4:registry 的 health 报告,回归集最新一版的通过率带上区间。"""
import json
from pathlib import Path

from part10.registry import health, load
from part10.stats import fmt_rate

cases = load("part10/data/eval_cases.jsonl")
runs = json.loads(Path("part10/data/eval_runs.json").read_text())

regression_ids = [c["id"] for c in cases if c.get("suite") == "regression"]
latest = [x for cid in regression_ids for x in runs[cid][-1]]   # 每条回归用例最新一版跑 5 遍,摊平
for line in health(cases, runs):
    print(line)
print(f"回归集最新一版:{fmt_rate(sum(latest), len(latest))}(这里把 {len(latest)} 次运行当独立样本,偏乐观)")
```

<div class="line-notes">

- `from part10.registry import health, load` 复用 Day 546 的两个函数,不动原文件。
- `latest = [x for cid in regression_ids for x in runs[cid][-1]]   # 每条回归用例最新一版跑 5 遍,摊平` 双重循环的列表推导式:外层遍历每条回归用例,内层取它最新一版(`[-1]`)的 5 遍结果,摊成一个长列表。25 条 × 5 遍 = 125 个 0/1。
- `for line in health(cases, runs):` 原来的报告一行不少地打出来。
- `fmt_rate(sum(latest), len(latest))` 121/125,Wilson 区间 [92.1%, 98.7%]。

</div>

```bash
uv run python -m part10.ex547_health
```

```text
回归集 25 条,能力集 14 条,集合名不对的 1 条
回归集最新一版没全过的:['T007', 'T019']
能力集里可以毕业的:['T026', 'T031', 'T034', 'T035', 'T038']
提醒:dev-li 名下 26/40 条,超过 40%,他一走评测就悬了
合成用例占 18/40 = 45%
回归集最新一版:121/125 = 96.8% [92.1%, 98.7%](这里把 125 次运行当独立样本,偏乐观)
```

最后一行是新加的:121/125 = 96.8%,区间 [92.1%, 98.7%]。我在括号里写了「偏乐观」,原因就是上一节说的:125 次运行来自 25 条用例各 5 遍,不是 125 个独立样本。

</details>

**验收标准**:`make_runs.py` 的 v1、v2 是 138/180 和 140/180;能口述「95% 区间」的真正含义,并说出 Wald 在 p = 0.95、n = 20 时包住率约 63%;`check_wilson.py` 和 scipy 的差在 1e-8 以内;能不看文章默写 `wilson_ci`;能回答「全过 24 条,下限多少,要多少条才敢说不低于 95%」(86.2%,73 条);练习 3 能说出「重叠不等于没差别」的原因。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 抽样误差 | 手里的用例只是所有可能用例中抽出的一小把,换一把分数就会变([Day 353](/blog/agent-zero/day-353-stats-intuition/) 讲过) |
| 标准误 SE | 分数的典型波动幅度。通过率的标准误是 √(p(1−p)/n),n 越大越小 |
| 置信区间 | 围绕一个分数画的一段范围,用来表示「真值大概在哪」。95% 区间的含义见下一行 |
| 包住率(覆盖率 coverage) | 用某种办法画区间,重复评测很多次,区间里真有真值的比例。95% 区间应该约 95% |
| 真实通过率 | 把 Agent 放到「所有可能的用例」上的通过比例,永远看不到,只能估计 |
| Wald 区间 | p ± 1.96·√(p(1−p)/n),Day 354 的做法。p 靠近 0 或 1 时会越界、宽度为零,包住率低 |
| Wilson 区间 | 逐个试「真实通过率 p,看到的分数算不算离谱」得到的区间,标准误用被试的 p。评测里的默认选择 |
| Clopper–Pearson 区间 | 「精确」区间,保证包住率不低于标称值,代价是更宽。scipy 里叫 `method="exact"` |
| 二项分布 | n 次独立试验、每次以概率 p 成功,成功 k 次的概率分布。通过 k 条的概率是 C(n,k)·pᵏ(1−p)ⁿ⁻ᵏ |
| 组合数 C(n,k) | 从 n 个里选 k 个的方法数,Python 里是 `math.comb(n, k)` |
| 三法则 rule of three | n 次里零次发生,真实发生率的 95% 上限约 3/n |
| 越界 | 区间的一端超过 0 或 100%,通过率不可能 |
| 独立样本 | 每条用例的结果不受其他用例影响。同场景的几种说法、同一条用例跑多遍,都不独立 |
| z 值 | 标准正态分布上的分位数。95% 区间用 1.96(更精确是 1.959964) |
| 种子 seed | 随机数发生器的起点,固定它就能让「随机」的结果每次都一样 |

## 常见误区

**把「95% 区间」读成「真值有 95% 的概率在这里」。** 严格的含义是办法的包住率:这样画区间重复很多次,约 95% 包得住真值。对着手里这一个具体区间,真值在不在里面,要么在要么不在。今天的两段代码就是这个意思:包住率是数出来的。

**全过就写 100%。** 24/24 的 Wilson 下限是 86.2%,20/20 是 83.9%。要说「不低于 95%」得 73 条全过。写成「24/24 全过,95% 区间 [86.2%, 100%]」。

**用 p ± 1.96·SE 算接近 100% 的通过率。** 越界、宽度为零,真实包住率在 p = 0.95、n = 20 时只有 63%。Wald 只在 n 大、p 居中的时候靠得住,评测里偏偏常常不是这种情况。

**以为 Wilson 就是精确的 95%。** 它的包住率会锯齿式地上下摆,n = 20、p 在 0.90 到 0.995 之间扫,平均 95.4%,最低 85.2%。需要保证「不低于」时用 Clopper–Pearson。

**两个区间重叠就说没差别。** 重叠只能说明单看两个分数不够下结论。比较两个版本要用配对,Day 548 讲。

**把同一条用例跑 5 遍当成 5 个样本。** 同一张工单的 5 遍结果高度相关,workflow 的 5 次失败是同一张工单。独立样本数更接近工单数,区间要比 Wilson 直接给的宽。

**报告里只写一个数。** 「通过率 97.5%」不如「39/40 = 97.5% [87.1%, 99.6%]」。统一用 `fmt_rate` 这样的函数出数字,不让每个人各写各的。

**手写统计公式不核对。** 今天用 scipy 对了 1303 组 k/n,最大差 3.9e-9。写完公式、改完公式,拿现成实现对一遍是便宜的保险。

## 学习资料

### 文档与文章

- [Brown、Cai、DasGupta《Interval Estimation for a Binomial Proportion》](https://projecteuclid.org/journals/statistical-science/volume-16/issue-2/Interval-Estimation-for-a-Binomial-Proportion/10.1214/ss/1009213286.full)(Statistical Science,2001):比较二项比例各种区间的经典论文,Wald 为什么不该用、Wilson 为什么可以用都在这里。我没有读全文,上面「学界的结论」是看摘要和维基百科对它的转述,需要细节的同学自己读;有点数学,第 1 到 3 节够用。
- [Wikipedia · Binomial proportion confidence interval](https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval):Wald、Wilson、Clopper–Pearson、Agresti–Coull 各自的公式和适用范围,还有三法则。当字典用。
- [Evan Miller《Adding Error Bars to Evals》](https://arxiv.org/abs/2411.00640)(2024):专门讲怎么给大模型评测加误差线,后面三天的统计方法大部分来自它。今天只用到摘要里的思路,全文 14 页,建议后面几天读。
- [Anthropic · A statistical approach to model evaluations](https://www.anthropic.com/research/statistical-approach-to-model-evals):Anthropic 对 Evan Miller 论文的介绍文章,更短、更好读。
- [Evan Miller · How Not To Sort By Average Rating](https://www.evanmiller.org/how-not-to-sort-by-average-rating.html):用 Wilson 区间下限给带评分的东西排序的经典博客,「只有 1 个好评」的商品为什么不该排第一,和今天的 20/20 是同一个道理。
- [scipy:`proportion_ci`](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats._result_classes.BinomTestResult.proportion_ci.html) 和 [statsmodels:`proportion_confint`](https://www.statsmodels.org/stable/generated/statsmodels.stats.proportion.proportion_confint.html):两个现成实现,方法名分别叫 `wilson`、`exact`(scipy)和 `wilson`、`beta`(statsmodels,Clopper–Pearson 在这里叫 `beta`)。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV14PtwziE6S&autoplay=0&high_quality=1" title="人话统计学概念：置信区间！" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>DataCafe · 人话统计学概念:置信区间! · 5 分钟,统计基础薄的同学先看这个,建立「区间到底在说什么」的直觉,再回头看今天的包住率。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/TqOeMYtOc1w" title="Confidence Intervals, Clearly Explained!!!" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>StatQuest with Josh Starmer · Confidence Intervals, Clearly Explained!!! · 英文,有字幕。用画图的方式讲置信区间,节奏慢,适合零基础。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/jsvBxkvTyQg" title="9.4 ML Confidence Intervals via Normal Approximation (L09 Model Eval 2: Confidence Intervals)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Sebastian Raschka · 9.4 ML Confidence Intervals via Normal Approximation · 英文。讲的就是 Day 354 那个正态近似(也就是 Wald)在机器学习评估里怎么用,以及它的局限,正好是今天的反面教材。</figcaption>
</figure>

### 书籍

- Alex Reinhart《Statistics Done Wrong: The Woefully Complete Guide》(No Starch Press,2015):用大白话讲科研里常见的统计错误,样本量太小、区间误读、把「不显著」当成「没差别」,和今天到 Day 550 的内容高度重合。适合零基础读。
- Ron Kohavi、Diane Tang、Ya Xu《Trustworthy Online Controlled Experiments》(Cambridge University Press,2020):线上实验的统计方法,方差、置信区间、功效。讲的是 A/B 测试,思路和评测完全相通,后面几天会再用到。

### 开源项目与代码

- 你自己的 `part10/stats.py`:今天只有三个函数,Day 548–550 会陆续加进来。
- [statsmodels · proportion.py](https://github.com/statsmodels/statsmodels/blob/main/statsmodels/stats/proportion.py):`proportion_confint` 的源码,几种方法放在同一个函数里,可以对照我们手写的 Wilson 看。

## 自测

1. 「95% 置信区间」的含义是什么?今天怎么验证的?

<details><summary>答案</summary>

用这个办法画区间,重复评测很多次,约 95% 的区间包得住真值。今天用两种方式验证:一是模拟,上帝视角定一个真实通过率,重复评测 10000 次数区间包住的次数;二是精确计算,把二项分布里「区间包得住真值」的那些 k 的概率加起来。两种结果对得上(Wald 在 p = 0.95、n = 20 时 63.3% 对 63.9%)。

</details>

2. 为什么 20/20 全过时,Wald 区间的宽度是零?这意味着什么?

<details><summary>答案</summary>

Wald 的标准误是 √(p(1−p)/n),全过时 p = 1,p(1−p) = 0,标准误是 0,区间是 [100%, 100%]。它等于在说真实通过率一定是 100%,而 20 条用例全过,真实通过率可能低到约 84%(Wilson 下限 83.9%)。真值是 95% 时,有三分之一多的评测会全过,这些评测的 Wald 区间一定包不住真值,所以它的包住率只有 63%。

</details>

3. Wilson 区间和 Wald 区间在做法上的根本区别是什么?

<details><summary>答案</summary>

Wald 围着观察到的分数 p̂ 画区间,标准误也用 p̂ 算。Wilson 反过来:逐个试真实通过率 p,看「观察到的分数离 p 不超过 1.96 个标准误」,标准误用被试的 p,留下说得通的 p 的范围。结果是 Wilson 的区间中心被拉向 50%,约等于先补 z²/2 次成功和 z²/2 次失败再算比例,全过时也有宽度。

</details>

4. 想让「全过」的下限不低于 95%,至少要几条?24 条全过时下限是多少?

<details><summary>答案</summary>

73 条(全过时下限是 n/(n+z²),令它等于 0.95 解出 n = 3.84 × 0.95/0.05 = 73.0)。24 条全过的下限是 86.2%。

</details>

5. Day 541 的 hybrid2 在 40 次运行里 40/40 全过,single 是 39/40。能说混合架构更稳吗?

<details><summary>答案</summary>

不能。两者的 Wilson 区间分别是 [91.2%, 100%] 和 [87.1%, 99.6%],大面积重叠;40 次运行只来自 8 张工单,不是 40 个独立样本,真实的不确定性比区间更大。这批数据只够说「没有发现两者的差别」,选混合架构要靠成本和代码核对这些别的理由。

</details>

6. 面试题:「你的评测通过率从 80% 涨到 82%,团队说有进步。你怎么看?」

<details><summary>答案</summary>

先问样本量。比如各 100 条,80/100 的 Wilson 区间约 [71.1%, 86.7%],82/100 约 [73.3%, 88.3%],几乎重合,2 个点完全在抽样误差之内。再问用例是不是独立:同一场景的多种说法、同一条用例跑多遍,不独立,区间要比这更宽。然后说怎么判断:两个版本跑同一批用例,应该配对比较并看差值的区间,而不是比较两个各自的区间;还要看是哪几条用例变了(新修好、新弄坏)。最后说怎么办:要么加样本量,要么每条跑多遍降低随机波动,要么等有足够样本再下结论。汇报的时候带上区间,写 k/n,不写一个孤零零的百分数。

</details>

## 明天预告

Day 548 · 评测统计学(二):用例不独立和配对比较。今天最后两处伏笔明天都要还:Day 541 里 40 次运行只来自 8 张工单,不能当 40 个独立样本;今天的 v1 和 v2 跑的是同一批 180 条用例,涨了 1.1 个点,该用配对比较而不是比较两个各自的区间。明天先给 `runs.json` 里的 60 个场景算聚类标准误,再用配对差值和 McNemar 检验回答「v2 到底比 v1 好不好」。
