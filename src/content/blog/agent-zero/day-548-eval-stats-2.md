---
title: 'Day 548 · 评测统计学(二):用例不独立和配对比较'
description: '180 条用例其实只来自 60 个场景,同一场景的三种说法七成一起对一起错。今天用模拟证明把它们当独立样本,区间只有 84% 的次数包住真值,再手写聚类标准误和设计效应;然后讲配对:v1 和 v2 跑的是同一批用例,逐条做差、McNemar 检验、看新挂和新修好的用例,区间比各画各的窄一半多。'
pubDate: 2026-10-27
regime: none
tags: ['eval', 'statistics', 'cluster', 'paired', 'mcnemar', 'python', 'agent-zero']
series: 'agent-zero'
day: 548
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 547](/blog/agent-zero/day-547-eval-stats-1/) 讲了一个分数的误差带:Wald 区间(p±1.96·SE)在通过率接近 100% 时会越界、会宽度为零,换成 Wilson 区间,并建了 `part10/stats.py`,里面有 `wilson_ci`、`wald_ci` 和报告里统一用的 `fmt_rate`。那天最后留了两个伏笔,今天接着还。

第一个:Day 541 的 40 次运行只来自 8 张工单,每张跑 5 遍,它们不是 40 个独立样本,Wilson 给的区间会偏窄。第二个:`part10/data/runs.json` 里 v1 是 138/180,v2 是 140/180,涨了 1.1 个点,两个版本跑的是同一批用例,该怎么比,而不是各画各的区间看重不重叠。今天一个概念讲一个伏笔:**聚类**(用例成组出现,怎么算误差),**配对**(同一批用例比两个版本,怎么算差值的误差)。

## 今天要解决的问题

学完今天你应该能做到:

1. 解释为什么 180 条用例不等于 180 个独立样本,用 `runs.json` 数出来:60 个场景里有 43 个场景的三条结果完全一致,三条独立的话只该有 28 个。
2. 手写**聚类标准误**(第一个新概念),算出 v1 的聚类 SE 是普通 SE 的 1.39 倍,「设计效应」是 1.93,180 条相当于约 93 条独立样本;并用 2000 次模拟证明:不聚类的 Wilson 区间只有 83.6% 的次数包住真值,聚类之后是 94% 左右。
3. 解释**配对比较**(第二个新概念):为什么「两个区间重叠就是没差别」是错的,怎么逐条做差,差值的标准误怎么算,McNemar 检验在看什么;并能说出「新挂了几条、新修好了几条」。
4. 把聚类和配对叠在一起,得出 v2 相对 v1 的提升是 +1.1 个点,95% 区间 [−3.5, +5.7] 个点,跨过 0,所以今天这批数据说不了谁更好。

预计用时 2.5 小时。花费 0 元(今天的脚本都不调模型;第六节读 Day 541 留下的 `part10/arch_bench_raw.json`)。前置:[Day 547](/blog/agent-zero/day-547-eval-stats-1/)(`stats.py`、`runs.json`)、[Day 353](/blog/agent-zero/day-353-stats-intuition/)(标准误和置信区间的直觉)、[Day 541](/blog/agent-zero/day-541-orch-2/)(`arch_bench_raw.json`)、[Day 28](/blog/agent-zero/day-028-functions-1/)(函数)。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `clustered_se` 和 `paired_diff`,再口述「为什么 3 条同场景的用例不能算 3 个独立样本」;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先把数据拿出来

Day 547 已经建好 `part10/data/runs.json`(60 个场景 × 3 种说法 = 180 条,v1 和 v2 跑同一批)。如果你的 `part10/data/` 里没有它,在 `agent-zero-lab` 根目录重新生成,种子固定,每个人的 180 条一模一样:

```bash
cd agent-zero-lab
mkdir -p part10/data
uv run python -m part10.make_runs
```

```text
180 条,写入 runs.json
v1 138/180 = 76.7%   v2 140/180 = 77.8%
```

今天所有数字都从这份数据来。它是我造的模拟数据(造法在 Day 547 的 `make_runs.py` 里:同一个场景的三种说法,70% 的概率照搬场景的共同结果),好处是我知道「上帝视角」的真值,可以直接检验方法准不准。真实的评测数据没有这个条件,所以今天的两个检验,都放在这份造出来的数据上做。

## 用例不独立,到底是什么意思

先看数据长什么样。下面的图是 v1 在前 8 个场景上的结果,每个场景三条用例,实心是过,空心是挂。

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="前 8 个场景各三条用例的结果:S00、S01、S03、S04、S06 三条全过,S02 只过中间一条,S05 和 S07 过了第一和第三条,一个场景内的三条多半同色">
  <rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12">
    <rect x="24" y="30" width="64" height="118" rx="6" fill="var(--mem-wash)" stroke="var(--rule)"/>
    <rect x="96" y="30" width="64" height="118" rx="6" fill="var(--mem-wash)" stroke="var(--rule)"/>
    <rect x="168" y="30" width="64" height="118" rx="6" fill="var(--compute-wash)" stroke="var(--rule)"/>
    <rect x="240" y="30" width="64" height="118" rx="6" fill="var(--mem-wash)" stroke="var(--rule)"/>
    <rect x="312" y="30" width="64" height="118" rx="6" fill="var(--mem-wash)" stroke="var(--rule)"/>
    <rect x="384" y="30" width="64" height="118" rx="6" fill="var(--compute-wash)" stroke="var(--rule)"/>
    <rect x="456" y="30" width="64" height="118" rx="6" fill="var(--mem-wash)" stroke="var(--rule)"/>
    <rect x="528" y="30" width="64" height="118" rx="6" fill="var(--compute-wash)" stroke="var(--rule)"/>
    <g fill="var(--mem)">
      <circle cx="56" cy="62" r="9"/><circle cx="56" cy="90" r="9"/><circle cx="56" cy="118" r="9"/>
      <circle cx="128" cy="62" r="9"/><circle cx="128" cy="90" r="9"/><circle cx="128" cy="118" r="9"/>
      <circle cx="200" cy="90" r="9"/>
      <circle cx="272" cy="62" r="9"/><circle cx="272" cy="90" r="9"/><circle cx="272" cy="118" r="9"/>
      <circle cx="344" cy="62" r="9"/><circle cx="344" cy="90" r="9"/><circle cx="344" cy="118" r="9"/>
      <circle cx="416" cy="62" r="9"/><circle cx="416" cy="118" r="9"/>
      <circle cx="488" cy="62" r="9"/><circle cx="488" cy="90" r="9"/><circle cx="488" cy="118" r="9"/>
      <circle cx="560" cy="62" r="9"/><circle cx="560" cy="118" r="9"/>
    </g>
    <g fill="none" stroke="var(--compute)" stroke-width="2">
      <circle cx="200" cy="62" r="8"/><circle cx="200" cy="118" r="8"/>
      <circle cx="416" cy="90" r="8"/>
      <circle cx="560" cy="90" r="8"/>
    </g>
    <g fill="var(--ink-soft)" text-anchor="middle">
      <text x="56" y="168">S00</text><text x="128" y="168">S01</text><text x="200" y="168">S02</text><text x="272" y="168">S03</text>
      <text x="344" y="168">S04</text><text x="416" y="168">S05</text><text x="488" y="168">S06</text><text x="560" y="168">S07</text>
    </g>
    <text x="24" y="20" fill="var(--ink)">每个竖条是一个场景,三个圆是它的三种说法</text>
    <text x="24" y="196" fill="var(--ink-faint)">实心=过 空心=挂。全部 60 个场景里:三条全过 36 个、全挂 7 个、一半一半 17 个</text>
  </g>
</svg>
<figcaption>S00、S01、S03、S04、S06 三条都过,S02 只过中间那条。一个场景里的三条大多同色,换一种说法并没有带来「新的、独立的信息」。</figcaption>
</figure>

用一个脚本把这件事数出来,同时算一个对照:如果三条用例真的互相独立,会是什么样。

```python
# agent-zero-lab/part10/agree_count.py
"""同一个场景的三种说法,结果一致的场景有多少?如果三条真的互相独立,应该有多少?"""
import json
from collections import Counter
from pathlib import Path

rows = json.loads((Path(__file__).parent / "data" / "runs.json").read_text())
by_scenario: dict[str, list[int]] = {}
for r in rows:
    by_scenario.setdefault(r["scenario"], []).append(r["v1"])

p = sum(r["v1"] for r in rows) / len(rows)               # v1 总体通过率 0.7667
counts = Counter(sum(v) for v in by_scenario.values())   # 每个场景三条里过了几条
for k in (3, 2, 1, 0):
    print(f"三条里过 {k} 条的场景:{counts[k]:>2} 个")
agree = counts[3] + counts[0]
print(f"三条结果完全一致(全过或全挂):{agree} / {len(by_scenario)} 个场景")
indep = p**3 + (1 - p) ** 3                              # 三条独立时,全过或全挂的概率
print(f"如果三条互相独立:p³ + (1−p)³ = {p:.4f}³ + {1 - p:.4f}³ = {indep:.3f},应该有 {indep * len(by_scenario):.0f} 个场景一致")
```

<div class="line-notes">

- `by_scenario: dict[str, list[int]] = {}` 字典,键是场景号 `S00`,值是这个场景三条用例的 v1 结果。相当于 JS 里的 `Record<string, number[]>`。
- `by_scenario.setdefault(r["scenario"], []).append(r["v1"])` `setdefault` 的意思是「这个键还没有就先放一个空列表,然后返回它」,再往里 `append`。循环完,`S00` 对应 `[1, 1, 1]`,`S02` 对应 `[0, 1, 0]`。
- `p = sum(r["v1"] for r in rows) / len(rows)               # v1 总体通过率 0.7667` 138 除以 180。
- `counts = Counter(sum(v) for v in by_scenario.values())   # 每个场景三条里过了几条` 先把每个场景的三个 0/1 加起来(0 到 3),`Counter` 数这四种结果各出现几次。
- `agree = counts[3] + counts[0]` 三条全过的 36 个场景加上全挂的 7 个场景,一共 43 个,是「三条结果一致」。
- `indep = p**3 + (1 - p) ** 3                              # 三条独立时,全过或全挂的概率` 三条互相独立、每条通过率都是 0.7667,三条全过的概率是 0.7667³ = 0.451,全挂是 0.2333³ = 0.013,加起来 0.463。60 个场景里应该有 60 × 0.463 ≈ 28 个。

</div>

```bash
uv run python -m part10.agree_count
```

```text
三条里过 3 条的场景:36 个
三条里过 2 条的场景:13 个
三条里过 1 条的场景: 4 个
三条里过 0 条的场景: 7 个
三条结果完全一致(全过或全挂):43 / 60 个场景
如果三条互相独立:p³ + (1−p)³ = 0.7667³ + 0.2333³ = 0.463,应该有 28 个场景一致
```

实际有 43 个场景三条一致,独立的话只该有 28 个。同一个场景里的三条大概率一起对一起错,这就是「**用例不独立**」。造数据的时候我就是这么设的(70% 的概率照搬场景的共同结果),但真实评测集里这种事天然就有:同一个意图的多种问法、同一个客户的几轮对话、同一篇文档上出的几道题、同一个种子样本改写出来的几个变体。这类用例成组出现,一组叫一个**簇**(cluster,在这份数据里就是一个场景)。

直觉上,如果三条每次都一起过一起挂,那它们的信息量约等于一条。反过来三条完全独立,就是三条的信息量。真实情况在两者之间:这 180 条里,独立信息的量比 60 多,比 180 少。后面会算出具体是多少。

## 聚类标准误

Day 353 的标准误公式,默认每条用例是独立抽出来的。把它当成「普通 SE」:

SE = s / √n,s 是 180 个 0/1 的样本标准差。代入 v1:p = 0.7667,SE = 0.0316。

**聚类标准误**的做法是:不再一条条看残差(「这条用例的结果比平均数高多少或低多少」),先把同一个簇里的残差加起来,变成一个「簇残差」,再对 60 个簇残差求平方和。同一簇的三条同向偏离时(三条都比平均数高),加起来会变得很大;如果三条方向随机、互相抵消,加起来就小。簇内越一致,聚类标准误越大于普通标准误。公式:

聚类 SE = √( Σ_簇 (簇内残差之和)² ) / n

跑一下,把前 4 个簇的残差一个个打出来:

```python
# agent-zero-lab/part10/cluster_demo.py
"""Day 548:把 runs.json 的 180 条当独立样本 vs 按 60 个场景聚类,标准误差多少。"""
import json
import math
from collections import defaultdict
from pathlib import Path

from part10.stats import clustered_se, design_effect, naive_se, wilson_ci

rows = json.loads((Path(__file__).parent / "data" / "runs.json").read_text())
scores = [r["v1"] for r in rows]
clusters = [r["scenario"] for r in rows]
n = len(scores)
mean = sum(scores) / n
print(f"{n} 条用例,{len(set(clusters))} 个场景,v1 通过率 {mean:.4f}")

# 手算:每个场景内,三条用例的「残差」加起来
sums: dict[str, float] = defaultdict(float)
for x, c in zip(scores, clusters):
    sums[c] += x - mean
for c in ("S00", "S01", "S02", "S03"):
    members = [r["v1"] for r in rows if r["scenario"] == c]
    print(f"  {c}: 三条结果 {members},残差之和 {sums[c]:+.4f}")
print(f"  60 个簇和的平方和 = {sum(v * v for v in sums.values()):.4f}")
print(f"  聚类 SE = √平方和 / n = {math.sqrt(sum(v * v for v in sums.values())) / n:.4f}")

print(f"普通 SE   {naive_se(scores):.4f}")
print(f"聚类 SE   {clustered_se(scores, clusters):.4f}  (函数)")
ratio = clustered_se(scores, clusters) / naive_se(scores)
deff = design_effect(scores, clusters)
print(f"比值 {ratio:.2f}  设计效应 {deff:.2f}  有效样本数 {n / deff:.0f} 条")
lo, hi = wilson_ci(sum(scores), n)
print(f"Wilson 区间(假装 180 条独立) [{lo:.1%}, {hi:.1%}]  宽 {hi - lo:.1%}")

# 核对「簇和的平方和」= 单条残差平方和 + 同簇内两两交叉项
single_sq = sum((x - mean) ** 2 for x in scores)
cross = sum(sums[c] ** 2 for c in sums) - single_sq
print(f"单条残差平方和 {single_sq:.4f} + 同簇交叉项 {cross:.4f} = {single_sq + cross:.4f}")
```

<div class="line-notes">

- `scores = [r["v1"] for r in rows]` v1 的 180 个 0/1。
- `clusters = [r["scenario"] for r in rows]` 同样长的 180 个簇标签,`S00` `S00` `S00` `S01`……三条一组。
- `mean = sum(scores) / n` 平均通过率 138/180 = 0.7667,这是「残差」的参照线。
- `sums: dict[str, float] = defaultdict(float)` `defaultdict(float)` 是「键第一次出现时自动补 0.0」的字典,不用先判断键在不在。
- `sums[c] += x - mean` 把每条用例的残差 `x - mean` 加到它所在簇的格子里。S00 三条都是 1,每条残差 1 − 0.7667 = +0.2333,三条加起来 +0.7000。S02 是 `[0, 1, 0]`,残差 −0.7667、+0.2333、−0.7667,加起来 −1.3000。
- `print(f"  {c}: 三条结果 {members},残差之和 {sums[c]:+.4f}")` 前四个簇的值:+0.7000、+0.7000、−1.3000、+0.7000。三条一起对,簇残差就是 +0.7;一对一错一错,就是 −1.3。
- `print(f"  60 个簇和的平方和 = {sum(v * v for v in sums.values()):.4f}")` 60 个簇残差各自平方,再全部加起来:62.6000。
- `print(f"  聚类 SE = √平方和 / n = {math.sqrt(sum(v * v for v in sums.values())) / n:.4f}")` √62.6 = 7.912,除以 180 得 0.0440。
- `ratio = clustered_se(scores, clusters) / naive_se(scores)` 聚类 SE 和普通 SE 之比,0.0440 / 0.0316 = 1.39。
- `deff = design_effect(scores, clusters)` **设计效应**(design effect)就是这个比值的平方:1.39² = 1.93。它的意思是:这 180 条用例的方差,是 180 条独立样本时的 1.93 倍。
- `print(f"比值 {ratio:.2f}  设计效应 {deff:.2f}  有效样本数 {n / deff:.0f} 条")` 180 / 1.93 = 93。**有效样本数**:这 180 条的信息量,大约相当于 93 条独立样本。
- `single_sq = sum((x - mean) ** 2 for x in scores)` 单条残差的平方和,普通 SE 用的就是它,32.2000。
- `cross = sum(sums[c] ** 2 for c in sums) - single_sq` 簇残差平方和 62.6 减去单条残差平方和 32.2,剩下的 30.4 是「同簇内两两乘积」的部分。

</div>

```bash
uv run python -m part10.cluster_demo
```

```text
180 条用例,60 个场景,v1 通过率 0.7667
  S00: 三条结果 [1, 1, 1],残差之和 +0.7000
  S01: 三条结果 [1, 1, 1],残差之和 +0.7000
  S02: 三条结果 [0, 1, 0],残差之和 -1.3000
  S03: 三条结果 [1, 1, 1],残差之和 +0.7000
  60 个簇和的平方和 = 62.6000
  聚类 SE = √平方和 / n = 0.0440
普通 SE   0.0316
聚类 SE   0.0440  (函数)
比值 1.39  设计效应 1.93  有效样本数 93 条
Wilson 区间(假装 180 条独立) [70.0%, 82.2%]  宽 12.3%
单条残差平方和 32.2000 + 同簇交叉项 30.4000 = 62.6000
```

最后一行解释了为什么聚类 SE 更大:簇残差之和的平方,展开来等于「每条残差自己的平方」(32.2,普通 SE 用的就是这部分)加上「同簇内两条不同用例的残差相乘」(30.4)。同簇的两条要是总同向偏离,乘积为正,这部分就大;互相独立时,正负抵消,这部分约等于 0,聚类 SE 就退化成普通 SE。Evan Miller 那篇给 LLM 评测加误差线的论文(见学习资料)里的公式就是这个形式,我这里的写法是它等价的实现。

函数写进 `stats.py`。顶部加一行 `from collections import defaultdict`,末尾追加三个函数:

```python
# agent-zero-lab/part10/stats.py(新增)
def naive_se(scores: list[float]) -> float:
    """把每条用例都当独立样本的标准误:s/√n,s 是样本标准差(分母用 n-1)。"""
    n = len(scores)
    if n < 2:
        raise ValueError(f"算标准误至少要 2 条用例,现在只有 {n} 条")
    mean = sum(scores) / n
    var = sum((x - mean) ** 2 for x in scores) / (n - 1)
    return math.sqrt(var / n)


def clustered_se(scores: list[float], clusters: list[str]) -> float:
    """聚类标准误:每个簇内的残差先加起来,再对各簇的和求平方和。"""
    if len(scores) != len(clusters):   # zip 遇到长度不同会悄悄截断,这里主动拦住
        raise ValueError(f"scores 有 {len(scores)} 条,clusters 有 {len(clusters)} 条,必须一样长")
    n = len(scores)
    mean = sum(scores) / n
    by_cluster: dict[str, float] = defaultdict(float)
    for x, c in zip(scores, clusters):
        by_cluster[c] += x - mean
    return math.sqrt(sum(v * v for v in by_cluster.values())) / n


def design_effect(scores: list[float], clusters: list[str]) -> float:
    """设计效应 = (聚类 SE / 普通 SE)²,「同样的用例数,相当于几分之一的独立样本」的倒数。"""
    base = naive_se(scores)
    if base == 0:  # 全过或全挂,标准误都是 0,谈不上放大
        return 1.0
    return (clustered_se(scores, clusters) / base) ** 2
```

<div class="line-notes">

- `def naive_se(scores: list[float]) -> float:` 普通标准误。
- `if n < 2:` 只有 0 条或 1 条时,样本标准差没有意义。我第一版这里没有这个判断,下一小节演示它会怎么炸。
- `raise ValueError(f"算标准误至少要 2 条用例,现在只有 {n} 条")` 主动报错,比一个 `ZeroDivisionError` 好懂。
- `var = sum((x - mean) ** 2 for x in scores) / (n - 1)` 样本方差,分母是 n−1(不是 n),这是统计里的惯例,180 条时 179 和 180 差别很小。
- `return math.sqrt(var / n)` 标准误 = √(方差/n)。v1 算出来 0.0316。
- `def clustered_se(scores: list[float], clusters: list[str]) -> float:` 聚类标准误。
- `if len(scores) != len(clusters):` 两个列表必须一样长。下面的 `zip` 遇到长度不同不会报错,只会悄悄截掉多的那部分,这一行是为了拦住它。
- `by_cluster: dict[str, float] = defaultdict(float)` 每个簇一格,放簇内残差之和。
- `by_cluster[c] += x - mean` 和上面脚本里的 `sums[c] += x - mean` 是同一件事。
- `return math.sqrt(sum(v * v for v in by_cluster.values())) / n` 簇残差平方和开方再除以 n,0.0440。
- `def design_effect(scores: list[float], clusters: list[str]) -> float:` 设计效应。
- `if base == 0:` 全过或全挂时普通 SE 是 0,下面要拿它当分母,先挡住。这时返回 1.0,等于「不放大」。
- `return (clustered_se(scores, clusters) / base) ** 2` 比值的平方,v1 是 1.93。

</div>

### 先演示两个报错

只有一条用例的时候,`naive_se` 会怎样。我第一版没有 `n < 2` 那个判断:

```bash
uv run python -c "
from part10.stats import naive_se
naive_se([1.0])"
```

```text
Traceback (most recent call last):
  File "<string>", line 3, in <module>
    naive_se([1.0])
    ~~~~~~~~^^^^^^^
  File "/Users/你/agent-zero-lab/part10/stats.py", line 40, in naive_se
    var = sum((x - mean) ** 2 for x in scores) / (n - 1)
          ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~^~~~~~~~~
ZeroDivisionError: division by zero
```

`ZeroDivisionError`:分母 `n - 1` 是 0。一个新模块的评测集只有一条用例,正是这种情况。加上 `n < 2` 的检查后,同样的调用变成 `ValueError: 算标准误至少要 2 条用例,现在只有 1 条`,看一眼就知道哪里不对。

第二个更隐蔽。传给 `clustered_se` 的 `clusters` 比 `scores` 少一个,没有任何报错:

```bash
uv run python -c "
import json
from part10.stats import clustered_se
rows = json.load(open('part10/data/runs.json'))
x = [float(r['v1']) for r in rows]; c = [r['scenario'] for r in rows]
print(clustered_se(x, c), clustered_se(x, c[:-1]), len(x), len(c[:-1]))"
```

```text
0.043955645433005515 0.04345937667667161 180 179
```

少了一个簇标签,返回的是 0.04346 而不是 0.04396,没有警告。Python 的 `zip` 遇到两个长度不同的列表,按短的截断,最后一条用例被悄悄丢了。这种错不会让程序崩,只会让数字差一点点,最难发现。所以上面的 `clustered_se` 开头加了长度检查。(Python 3.10 起 `zip` 可以传 `strict=True` 在长度不同时报错,但这里要给用户一个能看懂的信息,所以自己检查。)

## 聚类之后,区间准了吗

公式推出来了,但怎么知道它是对的?和 Day 547 的办法一样:造很多份新数据,真值已知,数区间包住真值的次数。`make_runs.py` 里的 `make(seed)` 换个种子就是一份新数据。v1 的真实通过率可以推出来:每条用例的成功概率是 `base = 0.55 + 0.4·(1 − hard)`,`hard` 在 0 到 1 之间均匀,所以平均是 0.55 + 0.4 × 0.5 = 0.75。脚本里先用 20 万个场景抽样核对了这个推导。

要比三种区间:Day 547 的 Wilson(当 180 条独立)、聚类 Wald(v1 的通过率 ± 1.96 × 聚类 SE)、聚类 Wilson(把样本数缩成有效样本数再套 Wilson)。最后一个要新加两个函数:

```python
# agent-zero-lab/part10/stats.py(新增)
def wilson_ci_cluster(scores: list[float], clusters: list[str], z: float = Z95) -> tuple[float, float]:
    """把 n 缩成「有效样本数」n/deff、k 同比例缩小,再套 Wilson。deff 小于 1 时不放大。"""
    n = len(scores)
    deff = max(1.0, design_effect(scores, clusters))
    n_eff = n / deff
    k_eff = sum(scores) / deff
    lo, hi = wilson_ci_float(k_eff, n_eff, z)
    return lo, hi


def wilson_ci_float(k: float, n: float, z: float = Z95) -> tuple[float, float]:
    """和 wilson_ci 同一个公式,只是 k、n 允许是小数(有效样本数通常不是整数)。"""
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, centre - half), min(1.0, centre + half)
```

<div class="line-notes">

- `def wilson_ci_cluster(scores: list[float], clusters: list[str], z: float = Z95) -> tuple[float, float]:` 聚类版 Wilson。
- `deff = max(1.0, design_effect(scores, clusters))` 设计效应小于 1 时(这批用例里刚好没看出相关),不去放大样本,取 1.0。
- `n_eff = n / deff` 有效样本数。v1 是 180 / 1.93 = 93.3。
- `k_eff = sum(scores) / deff` 通过条数也同比例缩:138 / 1.93 = 71.5。通过率还是 71.5 / 93.3 = 0.7667,不变。
- `lo, hi = wilson_ci_float(k_eff, n_eff, z)` 用缩小后的 k 和 n 套 Wilson。
- `def wilson_ci_float(k: float, n: float, z: float = Z95) -> tuple[float, float]:` 和 Day 547 的 `wilson_ci` 同一个公式,只是 k、n 允许是小数,因为有效样本数 93.3 不是整数。
- `return max(0.0, centre - half), min(1.0, centre + half)` 同样裁剪到 0 到 1 之间。

</div>

```python
# agent-zero-lab/part10/cluster_coverage.py
"""造 2000 份新的「60 场景 × 3 说法」数据,真实通过率已知是 75%,数三种区间各包住几次。"""
import random

from part10.make_runs import make
from part10.stats import clustered_se, wilson_ci, wilson_ci_cluster, Z95

# 真实通过率的推导:v1 每条的成功概率 = base = 0.55 + 0.4(1-hard),hard 在 0~1 均匀,期望 0.55+0.4×0.5 = 0.75
# 先用 20 万个场景抽样核对一下这个推导
rng = random.Random(0)
est = sum(0.55 + 0.4 * (1 - rng.random()) for _ in range(200_000)) / 200_000
print(f"核对:200000 个场景的平均成功概率 {est:.4f}(推导值 0.75)")

TRUE_P = 0.75
RERUNS = 2000
hit = {"naive Wilson": 0, "聚类 Wald": 0, "聚类 Wilson(有效样本数)": 0}
width = {k: 0.0 for k in hit}
for seed in range(1000, 1000 + RERUNS):
    rows = make(seed)
    x = [r["v1"] for r in rows]
    c = [r["scenario"] for r in rows]
    n, p = len(x), sum(x) / len(x)
    half = Z95 * clustered_se(x, c)
    cis = {
        "naive Wilson": wilson_ci(sum(x), n),
        "聚类 Wald": (p - half, p + half),
        "聚类 Wilson(有效样本数)": wilson_ci_cluster(x, c),
    }
    for name, (lo, hi) in cis.items():
        hit[name] += lo <= TRUE_P <= hi
        width[name] += hi - lo
print(f"{'方法':<24}{'包住率':>8}{'平均宽度':>10}")
for name in hit:
    print(f"{name:<24}{hit[name] / RERUNS:>8.1%}{width[name] / RERUNS:>10.1%}")
```

<div class="line-notes">

- `from part10.make_runs import make` 复用 Day 547 的造数据函数,`make(seed)` 返回 180 条的列表。
- `est = sum(0.55 + 0.4 * (1 - rng.random()) for _ in range(200_000)) / 200_000` 抽 20 万个场景难度,算每个场景的 `base`,取平均,核对推导值 0.75,实际 0.7502。
- `TRUE_P = 0.75` 真实通过率,只有模拟里才知道。
- `for seed in range(1000, 1000 + RERUNS):` 种子 1000 到 2999,各生成一份新数据,一共 2000 份。
- `half = Z95 * clustered_se(x, c)` 聚类 Wald 的半宽。
- `"naive Wilson": wilson_ci(sum(x), n),` Day 547 的做法,把 180 条当独立。注意 `sum(x)` 是浮点数 138.0,`wilson_ci` 吃得下。
- `hit[name] += lo <= TRUE_P <= hi` 区间包住 0.75 就加 1。
- `width[name] += hi - lo` 同时累计区间宽度,看「准」是不是靠变宽换来的。

</div>

```bash
uv run python -m part10.cluster_coverage
```

```text
核对:200000 个场景的平均成功概率 0.7502(推导值 0.75)
方法                           包住率      平均宽度
naive Wilson               83.6%     12.5%
聚类 Wald                    94.0%     17.9%
聚类 Wilson(有效样本数)           94.3%     17.6%
```

标签写的是 95%,不聚类的 Wilson 实际只有 **83.6%** 的数据集包住了真值,区间平均宽 12.5 个点。聚类 Wald 是 94.0%,聚类 Wilson 是 94.3%,平均宽度 17.6 到 17.9 个点,比前者宽 5 个点左右。变宽是代价,也是应该的:这 180 条用例本来就只值 93 条独立样本的信息,区间不该装得像 180 条那么窄。

对 v1 来说,Day 547 的区间是 [70.0%, 82.2%],聚类之后是 [67.1%, 84.1%]。这是 Day 547 埋下的第一个伏笔:**Wilson 假设每条独立,用例成组时它给的区间偏窄。**

## 套回 Day 541:8 张工单 × 5 遍

Day 547 的 `bench_intervals.py` 把 Day 541 的 40 次运行当 40 个独立样本。现在按工单聚类,看区间怎么变。读 `arch_bench.py` 留下的 `part10/arch_bench_raw.json`(Day 541 的原始结果,每个架构 8 张工单 × 5 遍):

```python
# agent-zero-lab/part10/cluster_bench.py
"""Day 541 的架构对比(8 张工单 × 5 遍):普通 Wilson 和按工单聚类的 Wilson 各给什么区间。"""
import json
from collections import defaultdict
from pathlib import Path

from part10.stats import clustered_se, design_effect, naive_se, wilson_ci, wilson_ci_cluster

raw = json.loads((Path(__file__).parent / "arch_bench_raw.json").read_text())
by_arch: dict[str, list[dict]] = defaultdict(list)
for r in raw:
    by_arch[r["arch"]].append(r)

print(f"{'架构':<9}{'k/n':>6}  {'普通 SE':>8} {'聚类 SE':>8} {'deff':>5} {'有效n':>6}  {'普通 Wilson':<16}{'聚类 Wilson':<16}")
for arch, runs in by_arch.items():
    x = [int(r["ok"]) for r in runs]
    c = [r["task_id"] for r in runs]
    n, k = len(x), sum(x)
    lo, hi = wilson_ci(k, n)
    clo, chi = wilson_ci_cluster([float(v) for v in x], c)
    d = design_effect([float(v) for v in x], c)
    print(f"{arch:<9}{k:>3}/{n:<3}  {naive_se([float(v) for v in x]):>8.4f} {clustered_se([float(v) for v in x], c):>8.4f} "
          f"{d:>5.2f} {n / d:>6.1f}  [{lo:>5.1%}, {hi:>5.1%}]  [{clo:>5.1%}, {chi:>5.1%}]")
```

<div class="line-notes">

- `by_arch: dict[str, list[dict]] = defaultdict(list)` 按架构分组,和 Day 547 的 `bench_intervals.py` 一样。
- `x = [int(r["ok"]) for r in runs]` `ok` 是布尔值,转成 0/1。
- `c = [r["task_id"] for r in runs]` 簇标签是工单号,`T1` 重复 5 次,`T2` 重复 5 次……
- `clo, chi = wilson_ci_cluster([float(v) for v in x], c)` 把 0/1 转成浮点数再传,函数签名要求 `list[float]`。
- `d = design_effect([float(v) for v in x], c)` 设计效应。workflow 的 40 次里有 5 次失败,全在 T6,设计效应是 4.88。
- `print(f"{arch:<9}{k:>3}/{n:<3}  {naive_se(` 一行打出 k/n、普通 SE、聚类 SE、设计效应、有效样本数、两种 Wilson。

</div>

```bash
uv run python -m part10.cluster_bench
```

```text
架构          k/n     普通 SE    聚类 SE  deff    有效n  普通 Wilson       聚类 Wilson       
workflow  35/40     0.0530   0.1169  4.88    8.2  [73.9%, 94.5%]  [53.4%, 97.7%]
single    39/40     0.0250   0.0234  0.88   45.7  [87.1%, 99.6%]  [87.1%, 99.6%]
hybrid2   40/40     0.0000   0.0000  1.00   40.0  [91.2%, 100.0%]  [91.2%, 100.0%]
hybrid    10/40     0.0693   0.1531  4.87    8.2  [14.2%, 40.2%]  [ 7.3%, 58.7%]
```

两个值得停一下的地方。

workflow(35/40)的聚类 SE 是普通 SE 的 2.2 倍(0.1169 对 0.0530),设计效应 4.88,40 次运行只相当于 8.2 条独立样本,聚类 Wilson 是 [53.4%, 97.7%],比 Day 547 的 [73.9%, 94.5%] 宽了一大截。原因很直白:它的 5 次失败全是同一张工单 T6(规则里只会退一张,5 遍都错),同一个坏消息说了 5 遍,不是 5 个独立的坏消息。hybrid(10/40)同理,下限从 14.2% 掉到 7.3%,上限从 40.2% 涨到 58.7%。

single(39/40)的设计效应是 0.88,小于 1,函数里取 1.0 当不放大,区间不变。唯一一次失败是 T7 的一遍,并没有出现成组失败,所以没看到聚类的影响。hybrid2(40/40)全过,普通 SE 为 0,设计效应也是返回 1.0,区间和 Day 547 一样 [91.2%, 100%]。

要提醒一点:**只有 8 个簇的时候,聚类标准误本身就不太稳**。簇越少,这个估计越粗,倾向于偏小。8 张工单勉强能用,拿它做精确判断不合适,今天看的是「大概宽了多少」。这类小样本的区间,Day 549 会换成 bootstrap 再看一次。

## 配对:同一批用例上比两个版本

聚类讲的是「一个分数的误差」。现在回到第二个伏笔:v1 是 138/180,v2 是 140/180,谁好?

### 先看一个常见的错:比两个区间有没有重叠

最常见的做法是画出两个区间,看重不重叠,重叠就说没差别。v1 的 Wilson 是 [70.0%, 82.2%],v2 是 [71.2%, 83.2%],大面积重叠,所以没差别。这个结论碰巧对,方法不对,换一份数据就会错。用一张我构造的表来看(不是真实运行,为了让配对的好处一眼看清):200 条用例,两个版本都过 140 条,v1 对 v2 错 4 条,v1 错 v2 对 14 条,都错 42 条。

```python
# agent-zero-lab/part10/overlap_trap.py
"""区间重叠 ≠ 没差别。这张表是我构造的(不是真实运行),为了让配对的好处一眼看清。"""
import math

from part10.stats import wilson_ci

n = 200
both_pass, a_only, b_only, both_fail = 140, 4, 14, 42   # v1 对 v2 错 4 条,v1 错 v2 对 14 条
k1, k2 = both_pass + a_only, both_pass + b_only
print(f"v1 {k1}/{n} = {k1 / n:.1%}  Wilson [{wilson_ci(k1, n)[0]:.1%}, {wilson_ci(k1, n)[1]:.1%}]")
print(f"v2 {k2}/{n} = {k2 / n:.1%}  Wilson [{wilson_ci(k2, n)[0]:.1%}, {wilson_ci(k2, n)[1]:.1%}]   <- 两个区间大面积重叠")

# 不配对:两个独立比例的 z 检验
p1, p2 = k1 / n, k2 / n
se = math.sqrt(p1 * (1 - p1) / n + p2 * (1 - p2) / n)
z = (p2 - p1) / se
p_unpaired = math.erfc(abs(z) / math.sqrt(2))   # 两侧 p 值
print(f"不配对:差 {p2 - p1:+.1%},SE {se:.4f},z = {z:.2f},p = {p_unpaired:.3f}")

# 配对:只看不一致的 18 条
m = a_only + b_only
tail = sum(math.comb(m, i) for i in range(min(a_only, b_only) + 1)) / 2**m
print(f"配对 McNemar:不一致 {m} 条,{b_only} 比 {a_only},p = {min(1.0, 2 * tail):.4f}")
```

<div class="line-notes">

- `n = 200` 200 条用例。
- `both_pass, a_only, b_only, both_fail = 140, 4, 14, 42   # v1 对 v2 错 4 条,v1 错 v2 对 14 条` 四种组合。这就是一张 2×2 的表,四个数加起来 200。
- `k1, k2 = both_pass + a_only, both_pass + b_only` v1 过的是「两个都过」加「只有 v1 过」,144;v2 是 140 + 14 = 154。
- `p1, p2 = k1 / n, k2 / n` 72.0% 和 77.0%。
- `se = math.sqrt(p1 * (1 - p1) / n + p2 * (1 - p2) / n)` 两个独立比例的差的标准误,是两个各自方差加起来再开方。这里把两个版本当成毫无关系的两批评测。
- `p_unpaired = math.erfc(abs(z) / math.sqrt(2))   # 两侧 p 值` 标准正态分布下,取绝对值 z 以外两侧的概率。`math.erfc` 是互补误差函数,这个写法就是两侧 p 值。
- `tail = sum(math.comb(m, i) for i in range(min(a_only, b_only) + 1)) / 2**m` 配对 McNemar 的核心:只看 18 条不一致的用例,如果两个版本一样好,每条偏向哪边是 50/50。偏向较少一边的有 0 到 4 条的概率加起来,是单侧。下面练习 3 会手算这一行。

</div>

```bash
uv run python -m part10.overlap_trap
```

```text
v1 144/200 = 72.0%  Wilson [65.4%, 77.8%]
v2 154/200 = 77.0%  Wilson [70.7%, 82.3%]   <- 两个区间大面积重叠
不配对:差 +5.0%,SE 0.0435,z = 1.15,p = 0.251
配对 McNemar:不一致 18 条,14 比 4,p = 0.0309
```

v1 的区间 [65.4%, 77.8%] 和 v2 的 [70.7%, 82.3%] 大面积重叠,不配对的检验给出 p = 0.251,差别「不显著」。配对的 McNemar 给出 p = 0.031,「显著」。同一份数据,两个结论,为什么?

关键在那 18 条不一致的用例。v1 和 v2 在 182 条上结果一样(140 条都过,42 条都挂),这 182 条对「谁更好」毫无贡献,它们的差异是难度带来的:有些用例容易,两个版本都过,有些用例难,两个都挂。不配对的比较,把这种「用例难度本身的差别」混进了噪声里。配对比较只看两个版本**在同一条用例上**的差,用例的难度自动抵消。剩下的 18 条里 14 条偏向 v2、4 条偏向 v1,这就是真正的信号。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="把 v1 和 v2 的结果配成 2 乘 2 的表:两个都过 132 条,两个都挂 34 条,只有 v2 对 8 条,只有 v1 对 6 条,后两格是配对比较真正使用的信息">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="13">
    <text x="250" y="28" fill="var(--ink)" text-anchor="middle">v2 过</text>
    <text x="410" y="28" fill="var(--ink)" text-anchor="middle">v2 挂</text>
    <text x="96" y="82" fill="var(--ink)" text-anchor="middle">v1 过</text>
    <text x="96" y="162" fill="var(--ink)" text-anchor="middle">v1 挂</text>
    <rect x="170" y="40" width="160" height="70" fill="var(--paper)" stroke="var(--rule)"/>
    <rect x="330" y="40" width="160" height="70" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <rect x="170" y="110" width="160" height="70" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <rect x="330" y="110" width="160" height="70" fill="var(--paper)" stroke="var(--rule)"/>
    <text x="250" y="84" fill="var(--ink-soft)" text-anchor="middle">132</text>
    <text x="410" y="84" fill="var(--ink)" text-anchor="middle">6</text>
    <text x="250" y="154" fill="var(--ink)" text-anchor="middle">8</text>
    <text x="410" y="154" fill="var(--ink-soft)" text-anchor="middle">34</text>
    <text x="410" y="100" fill="var(--compute)" text-anchor="middle" font-size="11">新挂的</text>
    <text x="250" y="170" fill="var(--mem)" text-anchor="middle" font-size="11">新修好的</text>
    <text x="250" y="204" fill="var(--ink-faint)" text-anchor="middle">两个都对/都错:166 条,不提供信息</text>
    <text x="520" y="84" fill="var(--ink-soft)">只看这两格:</text>
    <text x="520" y="104" fill="var(--ink-soft)">6 对 8,14 条</text>
  </g>
</svg>
<figcaption>runs.json 的 v1 和 v2 配成 2×2 表。配对比较只用有颜色的两格(两个版本结果不一致的 14 条),其余 166 条两个版本一样,不影响谁好谁坏。</figcaption>
</figure>

### 逐条做差,算差值的标准误

不只要 p 值,还要差值的区间。做法很直接:对每条用例算 d = v2 的得分 − v1 的得分,取值是 +1(v1 挂 v2 过,新修好)、0(两个一样)或 −1(v1 过 v2 挂,新挂)。然后对这 180 个 d 求平均和标准误,就是「提升了多少」和「这个提升的误差」。如果还要考虑聚类,就用 d 去算聚类标准误。

两个函数:

```python
# agent-zero-lab/part10/stats.py(新增)
def paired_diff(a: list[float], b: list[float], clusters: list[str] | None = None, z: float = Z95) -> dict:
    """配对比较 b 相对 a:逐条做差,再对差值求均值和标准误(给了 clusters 就按簇)。"""
    if len(a) != len(b):
        raise ValueError(f"a 有 {len(a)} 条,b 有 {len(b)} 条,配对比较要求同一批用例")
    d = [y - x for x, y in zip(a, b)]
    mean = sum(d) / len(d)
    se = clustered_se(d, clusters) if clusters else naive_se(d)
    return {"diff": mean, "se": se, "lo": mean - z * se, "hi": mean + z * se}


def mcnemar_exact(a: list[int], b: list[int]) -> dict:
    """McNemar 精确检验:只数「a 对 b 错」和「a 错 b 对」的条数,看是不是对半开。"""
    a_only = sum(1 for x, y in zip(a, b) if x == 1 and y == 0)
    b_only = sum(1 for x, y in zip(a, b) if x == 0 and y == 1)
    m = a_only + b_only
    if m == 0:
        p = 1.0
    else:
        tail = sum(math.comb(m, i) for i in range(min(a_only, b_only) + 1)) / 2**m  # 单侧:少的那边及更少的概率
        p = min(1.0, 2 * tail)  # 两侧
    return {"a_only": a_only, "b_only": b_only, "p_value": p}
```

<div class="line-notes">

- `def paired_diff(a: list[float], b: list[float], clusters: list[str] | None = None, z: float = Z95) -> dict:` `a` 是 v1 的结果,`b` 是 v2 的,同一条用例在同一个位置。`clusters` 给了就按簇算标准误。`list[str] | None` 相当于 TS 的 `string[] | null`。
- `if len(a) != len(b):` 配对要求同一批用例,长度不同一定出了问题。
- `d = [y - x for x, y in zip(a, b)]` 逐条做差。`zip(a, b)` 把两个列表同位置的元素配成对,和 JS 里 `a.map((x, i) => [x, b[i]])` 一个意思。
- `mean = sum(d) / len(d)` 差值的平均,就是通过率之差。v2 − v1 = (140 − 138) / 180 = +0.0111。
- `se = clustered_se(d, clusters) if clusters else naive_se(d)` 给了簇就用聚类标准误,否则用普通标准误。对 d 算,不是对分数算。
- `return {"diff": mean, "se": se, "lo": mean - z * se, "hi": mean + z * se}` 返回差值、标准误和 95% 区间。
- `def mcnemar_exact(a: list[int], b: list[int]) -> dict:` McNemar 检验,只数不一致的用例。
- `a_only = sum(1 for x, y in zip(a, b) if x == 1 and y == 0)` 新挂的:a(v1)过、b(v2)挂。runs.json 里 6 条。
- `b_only = sum(1 for x, y in zip(a, b) if x == 0 and y == 1)` 新修好的:8 条。
- `m = a_only + b_only` 不一致的总数,14。
- `tail = sum(math.comb(m, i) for i in range(min(a_only, b_only) + 1)) / 2**m  # 单侧:少的那边及更少的概率` 如果两个版本一样好,每条不一致偏向哪边是抛硬币。14 条里偏向少的那边是 6 条或更少的概率。`math.comb(14, i)` 是 14 个里选 i 个,`/ 2**14` 是每种选法的概率。
- `p = min(1.0, 2 * tail)  # 两侧` 两侧检验,乘 2。上限 1.0,因为两个数一样时 2 × tail 会超过 1。

</div>

跑在 `runs.json` 上:

```python
# agent-zero-lab/part10/paired_demo.py
"""Day 548:v1 和 v2 跑的是同一批 180 条用例。不配对、配对、配对加聚类,差值的区间各是多少。"""
import json
import math
from pathlib import Path

from part10.stats import clustered_se, mcnemar_exact, naive_se, paired_diff, wilson_ci

rows = json.loads((Path(__file__).parent / "data" / "runs.json").read_text())
a = [r["v1"] for r in rows]
b = [r["v2"] for r in rows]
cl = [r["scenario"] for r in rows]
n = len(rows)

print(f"v1 {sum(a)}/{n} {wilson_ci(sum(a), n)}   v2 {sum(b)}/{n} {wilson_ci(sum(b), n)}")
se_a, se_b = naive_se(a), naive_se(b)
unpaired_se = math.sqrt(se_a**2 + se_b**2)
print(f"不配对:两个分数各自的 SE {se_a:.4f}、{se_b:.4f},差值 SE = √(SE_a²+SE_b²) = {unpaired_se:.4f}")

ma, mb = sum(a) / n, sum(b) / n
corr = sum((x - ma) * (y - mb) for x, y in zip(a, b)) / (n - 1) / (naive_se(a) * math.sqrt(n) * naive_se(b) * math.sqrt(n))
print(f"同一条用例上 v1、v2 的相关系数 {corr:.3f}")
print(f"配对公式 √(SE_a²+SE_b²−2·SE_a·SE_b·corr) = {math.sqrt(se_a**2 + se_b**2 - 2 * se_a * se_b * corr):.4f}")

d = [y - x for x, y in zip(a, b)]
print(f"逐条差值 d = v2−v1:取 +1 的 {d.count(1)} 条,0 的 {d.count(0)} 条,−1 的 {d.count(-1)} 条,均值 {sum(d) / n:+.4f}")
print(f"  直接对 d 算 SE {naive_se(d):.4f}(和配对公式一致)")

for name, res in (
    ("不配对     ", {"diff": mb - ma, "se": unpaired_se}),
    ("配对       ", paired_diff(a, b)),
    ("配对+聚类  ", paired_diff(a, b, cl)),
):
    lo, hi = res["diff"] - 1.959964 * res["se"], res["diff"] + 1.959964 * res["se"]
    print(f"{name} 差值 {res['diff']:+.1%}  SE {res['se']:.4f}  区间 [{lo:+.1%}, {hi:+.1%}]")

m = mcnemar_exact(a, b)
print(f"McNemar:v1 对 v2 错 {m['a_only']} 条,v1 错 v2 对 {m['b_only']} 条,其余 {n - m['a_only'] - m['b_only']} 条结果一样,p = {m['p_value']:.4f}")
broke = [r["case"] for r in rows if r["v1"] == 1 and r["v2"] == 0]
fixed = [r["case"] for r in rows if r["v1"] == 0 and r["v2"] == 1]
print("新挂的:", broke)
print("新修好的:", fixed)
print("新挂的来自", len({c.split('-')[0] for c in broke}), "个场景,新修好的来自", len({c.split('-')[0] for c in fixed}), "个场景")
```

<div class="line-notes">

- `a = [r["v1"] for r in rows]` v1 的 180 个 0/1。
- `unpaired_se = math.sqrt(se_a**2 + se_b**2)` 不配对时,差值的标准误是两个分数的标准误平方相加再开方:√(0.0316² + 0.0311²) = 0.0443。
- `ma, mb = sum(a) / n, sum(b) / n` 两个平均通过率。
- `corr = sum((x - ma) * (y - mb) for x, y in zip(a, b)) / (n - 1) / (naive_se(a) * math.sqrt(n) * naive_se(b) * math.sqrt(n))` 相关系数,「同一条用例上 v1 和 v2 的结果有多同步」。分子是协方差,分母是两个标准差的乘积。算出来 0.779:大部分用例两个版本同对同错。
- `print(f"配对公式 √(SE_a²+SE_b²−2·SE_a·SE_b·corr) = {math.sqrt(se_a**2 + se_b**2 - 2 * se_a * se_b * corr):.4f}")` 配对的标准误公式,比不配对的多减一项 `2·SE_a·SE_b·corr`。同步程度越高,减得越多。√(0.0316² + 0.0311² − 2 × 0.0316 × 0.0311 × 0.779) = 0.0208。
- `d = [y - x for x, y in zip(a, b)]` 直接做差。
- `print(f"逐条差值 d = v2−v1:取 +1 的 {d.count(1)} 条,0 的 {d.count(0)} 条,−1 的 {d.count(-1)} 条,均值 {sum(d) / n:+.4f}")` 8 条 +1、166 条 0、6 条 −1,均值 (8 − 6)/180 = +0.0111。
- `print(f"  直接对 d 算 SE {naive_se(d):.4f}(和配对公式一致)")` 直接对 d 求标准误,0.0208,和上一行的公式结果一样,说明「逐条做差」和「公式」是同一件事。
- `("不配对     ", {"diff": mb - ma, "se": unpaired_se}),` 三种算法放在一个循环里对比。
- `m = mcnemar_exact(a, b)` 对 180 条做 McNemar。
- `broke = [r["case"] for r in rows if r["v1"] == 1 and r["v2"] == 0]` 新挂的用例编号列表。
- `fixed = [r["case"] for r in rows if r["v1"] == 0 and r["v2"] == 1]` 新修好的。
- `print("新挂的来自", len({c.split('-')[0] for c in broke}), "个场景,新修好的来自", len({c.split('-')[0] for c in fixed}), "个场景")` 用例编号形如 `S22-0`,`split('-')[0]` 取场景号,放进集合去重,数有几个不同场景。

</div>

```bash
uv run python -m part10.paired_demo
```

```text
v1 138/180 (0.6997021798119246, 0.8224868877910797)   v2 140/180 (0.7115975043523399, 0.8323494410674561)
不配对:两个分数各自的 SE 0.0316、0.0311,差值 SE = √(SE_a²+SE_b²) = 0.0443
同一条用例上 v1、v2 的相关系数 0.779
配对公式 √(SE_a²+SE_b²−2·SE_a·SE_b·corr) = 0.0208
逐条差值 d = v2−v1:取 +1 的 8 条,0 的 166 条,−1 的 6 条,均值 +0.0111
  直接对 d 算 SE 0.0208(和配对公式一致)
不配对      差值 +1.1%  SE 0.0443  区间 [-7.6%, +9.8%]
配对        差值 +1.1%  SE 0.0208  区间 [-3.0%, +5.2%]
配对+聚类   差值 +1.1%  SE 0.0235  区间 [-3.5%, +5.7%]
McNemar:v1 对 v2 错 6 条,v1 错 v2 对 8 条,其余 166 条结果一样,p = 0.7905
新挂的: ['S22-0', 'S22-2', 'S31-0', 'S33-0', 'S33-2', 'S55-2']
新修好的: ['S02-0', 'S10-0', 'S19-0', 'S20-2', 'S24-2', 'S35-2', 'S49-0', 'S59-1']
新挂的来自 4 个场景,新修好的来自 8 个场景
```

几个数字对着读:

不配对的差值标准误是 0.0443,配对之后降到 0.0208,**缩小了一半多**,原因就是那个 0.779 的相关系数:v1 和 v2 在同一条用例上高度同步,减掉的那一项很大。再考虑场景聚类,是 0.0235。最终 v2 相对 v1 提升 +1.1 个点,95% 区间 [−3.5, +5.7],跨过 0。

McNemar 的 p = 0.7905:v1 对 v2 错 6 条,v1 错 v2 对 8 条,14 条不一致的偏向哪边几乎是对半开,看不出差别。它没有考虑聚类,但对这份数据结论一致。

最后两行是配对比较的另一个好处,对工程师比 p 值有用得多:你能看到**具体哪几条用例变了**。新挂的 6 条来自 4 个场景(S22 两条、S33 两条,S31 和 S55 各一条),新修好的 8 条来自 8 个不同场景。改动的人应该去读那 6 条新挂用例的 trace,看是什么副作用;新修好的是不是真的被这次改动修好了。比如同一个场景 S22 的三种说法里有两条同时挂掉,更像是场景级的问题,不是随机抖动。很多时候,MR 评论里直接贴这两个列表,比一个 p 值有用。

### 配对到底值多少,聚类到底值多少

还是用模拟数据检验。对 2000 份新数据,v2 比 v1 的真实提升是已知的:v2 只在 20% 的用例上重新抽,难场景(`hard > 0.5`)的概率多 0.06,其余多 0.01,期望 0.2 × (0.5 × 0.06 + 0.5 × 0.01) = 0.007,即 0.7 个点。三种算法的区间,各包住几次真值、各多宽、区间不含 0(被判成「有差别」)的比例是多少:

```python
# agent-zero-lab/part10/paired_sim.py
"""2000 份新数据,v2 比 v1 的真实提升已知是 0.7 个点。三种差值区间各包住几次、各宽多少。"""
import math

from part10.make_runs import make
from part10.stats import Z95, clustered_se, mcnemar_exact, naive_se, paired_diff

# 真实提升:v2 只在 20% 的用例上重抽,重抽概率比 base 高 lift。hard>0.5 时 lift=0.06,否则 0.01,各占一半。
TRUE_DIFF = 0.2 * (0.5 * 0.06 + 0.5 * 0.01)
print(f"真实提升 = 0.2 × (0.5×0.06 + 0.5×0.01) = {TRUE_DIFF:.4f}")

RERUNS = 2000
names = ["不配对", "配对", "配对+聚类"]
hit = dict.fromkeys(names, 0)
reject_zero = dict.fromkeys(names + ["McNemar"], 0)
width = dict.fromkeys(names, 0.0)
for seed in range(1000, 1000 + RERUNS):
    rows = make(seed)
    a = [r["v1"] for r in rows]
    b = [r["v2"] for r in rows]
    cl = [r["scenario"] for r in rows]
    n = len(rows)
    diff = (sum(b) - sum(a)) / n
    ses = {
        "不配对": math.sqrt(naive_se(a) ** 2 + naive_se(b) ** 2),
        "配对": paired_diff(a, b)["se"],
        "配对+聚类": paired_diff(a, b, cl)["se"],
    }
    for name, se in ses.items():
        lo, hi = diff - Z95 * se, diff + Z95 * se
        hit[name] += lo <= TRUE_DIFF <= hi
        reject_zero[name] += not (lo <= 0 <= hi)   # 区间不含 0 = 「显著」
        width[name] += hi - lo
    reject_zero["McNemar"] += mcnemar_exact(a, b)["p_value"] < 0.05

print(f"{'方法':<10}{'包住真值':>8}{'平均宽度':>10}{'区间不含 0':>12}")
for name in names:
    print(f"{name:<10}{hit[name] / RERUNS:>8.1%}{width[name] / RERUNS:>10.1%}{reject_zero[name] / RERUNS:>12.1%}")
print(f"McNemar p<0.05 的占比 {reject_zero['McNemar'] / RERUNS:.1%}")
```

<div class="line-notes">

- `TRUE_DIFF = 0.2 * (0.5 * 0.06 + 0.5 * 0.01)` 真实提升 0.007。
- `names = ["不配对", "配对", "配对+聚类"]` 三种做法。
- `reject_zero = dict.fromkeys(names + ["McNemar"], 0)` `dict.fromkeys(键列表, 初始值)` 一次造出一个所有键初始值相同的字典。
- `diff = (sum(b) - sum(a)) / n` 这份数据里 v2 比 v1 高多少。
- `"不配对": math.sqrt(naive_se(a) ** 2 + naive_se(b) ** 2),` 三种标准误,和 `paired_demo.py` 里是同样的算法。
- `hit[name] += lo <= TRUE_DIFF <= hi` 区间包住 0.007 就加 1。
- `reject_zero[name] += not (lo <= 0 <= hi)   # 区间不含 0 = 「显著」` 区间不包含 0,就是「检测出有差别」。
- `reject_zero["McNemar"] += mcnemar_exact(a, b)["p_value"] < 0.05` McNemar 的 p 值小于 0.05 算「显著」。

</div>

```bash
uv run python -m part10.paired_sim
```

```text
真实提升 = 0.2 × (0.5×0.06 + 0.5×0.01) = 0.0070
方法            包住真值      平均宽度      区间不含 0
不配对         100.0%     17.7%        0.0%
配对           94.4%      7.5%        6.8%
配对+聚类        95.3%      7.7%        5.9%
McNemar p<0.05 的占比 3.5%
```

读法:

- 不配对的区间包住率是 100%,平均宽 17.7 个点,「区间不含 0」是 0%。它不是准,是宽到永远包得住,同时什么差别都检测不出来。
- 配对的区间宽 7.5 个点,包住率 94.4%;配对加聚类宽 7.7 个点,包住率 95.3%。两个都接近 95%,聚类让它再稳一点。
- 因为真实差值是 0.7 个点(几乎为 0),「区间不含 0」的比例就是误报率,理论上 5% 左右:配对 6.8%,配对加聚类 5.9%,McNemar 3.5%(精确检验偏保守)。聚类那一行更接近 5%。

配对省下来的东西,在 Day 550 讲样本量时会换算成一个数字:同样检测 3 个点的提升,不配对要 3085 条,配对只要 681 条。

### 回到 Day 541:配对也救不了 8 张工单

Day 547 练习 3 说,workflow 是 21/24、single 是 24/24,区间重叠不等于没差别。现在按配对做。单位用「工单」:每张工单算 single 的通过比例减 workflow 的通过比例,8 个差值,在这 8 个差值上求平均和区间。簇数只有 8,不能用 1.96,要用 t 分布的临界值(自由度 7 时是 2.365),这个值用 scipy 的 `t.ppf` 查。

```python
# agent-zero-lab/part10/paired_bench.py
"""Day 541 的 single 和 workflow:按工单配对(8 个簇),差值的区间。"""
import json
import math
from collections import defaultdict
from pathlib import Path

from scipy.stats import t

raw = json.loads((Path(__file__).parent / "arch_bench_raw.json").read_text())
rate: dict[str, dict[str, float]] = {}
for arch in ("single", "workflow"):
    per: dict[str, list[bool]] = defaultdict(list)
    for r in raw:
        if r["arch"] == arch:
            per[r["task_id"]].append(r["ok"])
    rate[arch] = {tid: sum(v) / len(v) for tid, v in per.items()}

d = {tid: rate["single"][tid] - rate["workflow"][tid] for tid in rate["single"]}
print("每张工单 single − workflow:", {k: round(v, 1) for k, v in d.items()})
g = len(d)
mean = sum(d.values()) / g
sd = math.sqrt(sum((v - mean) ** 2 for v in d.values()) / (g - 1))
se = sd / math.sqrt(g)
tcrit = t.ppf(0.975, g - 1)
print(f"均值 {mean:+.3f}  标准差 {sd:.3f}  SE {se:.3f}  t 临界值(自由度 {g - 1}){tcrit:.3f}")
print(f"95% 区间 [{mean - tcrit * se:+.3f}, {mean + tcrit * se:+.3f}]")
```

<div class="line-notes">

- `from scipy.stats import t` 导入 t 分布。样本很少(这里 8 个)时,95% 区间的乘数不是 1.96,而是 t 分布的分位数,更大。
- `rate: dict[str, dict[str, float]] = {}` 两层字典:架构 → 工单 → 通过比例。
- `per: dict[str, list[bool]] = defaultdict(list)` 每张工单的 5 次结果。
- `rate[arch] = {tid: sum(v) / len(v) for tid, v in per.items()}` 字典推导式,每张工单的通过比例。single 的 T7 是 4/5 = 0.8,workflow 的 T6 是 0/5 = 0。
- `d = {tid: rate["single"][tid] - rate["workflow"][tid] for tid in rate["single"]}` 逐张工单做差。
- `sd = math.sqrt(sum((v - mean) ** 2 for v in d.values()) / (g - 1))` 8 个差值的标准差。
- `se = sd / math.sqrt(g)` 均值的标准误,8 个差值,所以除以 √8。
- `tcrit = t.ppf(0.975, g - 1)` 自由度 7 的 t 分布 97.5% 分位数,2.365(正态分布是 1.96)。

</div>

```bash
uv run python -m part10.paired_bench
```

```text
每张工单 single − workflow: {'T1': 0.0, 'T2': 0.0, 'T3': 0.0, 'T4': 0.0, 'T5': 0.0, 'T6': 1.0, 'T7': -0.2, 'T8': 0.0}
均值 +0.100  标准差 0.370  SE 0.131  t 临界值(自由度 7)2.365
95% 区间 [-0.210, +0.410]
```

8 张工单里,6 张两个架构一样(差 0),T6 差 +1.0(single 5 遍全过,workflow 5 遍全挂),T7 差 −0.2(single 有一遍挂了)。均值 +0.100,SE 0.131,区间 [−0.210, +0.410],跨过 0。**按工单配对,今天这批数据也没法说 single 比 workflow 好。**区间很宽的原因是只有 8 个簇,而且差别几乎全来自一张工单 T6。这个结论比 Day 547 的练习 3 更扎实一点:不是「两个区间重叠所以不知道」,而是「用最合适的方法比,仍然不知道,因为数据少」。

## 今天往 stats.py 里加了什么

| 函数 | 做什么 | 哪一节 |
| --- | --- | --- |
| `naive_se(scores)` | 把每条当独立样本的标准误 | 聚类标准误 |
| `clustered_se(scores, clusters)` | 簇残差之和的平方和开方,除以 n | 聚类标准误 |
| `design_effect(scores, clusters)` | 聚类 SE 与普通 SE 之比的平方 | 聚类标准误 |
| `wilson_ci_float(k, n)` | k、n 允许小数的 Wilson | 聚类之后 |
| `wilson_ci_cluster(scores, clusters)` | 把 n 缩成有效样本数的 Wilson | 聚类之后 |
| `paired_diff(a, b, clusters)` | 逐条做差,再求均值和(聚类)标准误 | 配对 |
| `mcnemar_exact(a, b)` | 只数不一致的条数,精确二项 p 值 | 配对 |

顶部加了一行 `from collections import defaultdict`。Day 549 往里加 bootstrap,Day 550 加样本量和多重比较。

## 动手练习

**练习 1:每条自成一簇,聚类 SE 等于普通 SE 吗?** 对 `runs.json` 的 v1,把簇标签换成 `r["case"]`(每条用例一个独立编号),算聚类 SE 和普通 SE,看它们差多少、为什么差这么多。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex548_unique_clusters.py
"""练习 1:每条用例自成一簇时,聚类 SE 和普通 SE 差多少?"""
import json
import math
from pathlib import Path

from part10.stats import clustered_se, naive_se

rows = json.loads((Path(__file__).parent / "data" / "runs.json").read_text())
x = [float(r["v1"]) for r in rows]
n = len(x)
own = [r["case"] for r in rows]       # 每条用例一个簇,编号 S00-0、S00-1……互不相同
print(f"普通 SE            {naive_se(x):.5f}")
print(f"聚类 SE(各自成簇) {clustered_se(x, own):.5f}")
print(f"两者之比           {clustered_se(x, own) / naive_se(x):.5f}")
print(f"√((n-1)/n)         {math.sqrt((n - 1) / n):.5f}")
```

<div class="line-notes">

- `own = [r["case"] for r in rows]       # 每条用例一个簇,编号 S00-0、S00-1……互不相同` 用 `case` 字段(`S00-0`、`S00-1`……)当簇标签,180 条各是一个簇。
- `print(f"两者之比           {clustered_se(x, own) / naive_se(x):.5f}")` 聚类 SE / 普通 SE。
- `print(f"√((n-1)/n)         {math.sqrt((n - 1) / n):.5f}")` n = 180 时 √(179/180) = 0.99722。

</div>

```bash
uv run python -m part10.ex548_unique_clusters
```

```text
普通 SE            0.03161
聚类 SE(各自成簇) 0.03153
两者之比           0.99722
√((n-1)/n)         0.99722
```

比值是 0.99722,正好是 √((n−1)/n)。每条自成一簇时,「簇残差之和」就是单条残差,聚类 SE 变成 √(Σ残差²)/n,普通 SE 是 √(Σ残差²/(n−1)/n),差别只是分母 n 和 n−1,180 条时差千分之三。所以聚类标准误是普通标准误的推广:簇之间独立、簇内可以任意相关,簇的大小是 1 的时候就是普通标准误。
</details>

**练习 2:60 条独立的 vs 180 条聚类的,谁的误差小?** 只留每个场景的第一种说法(60 条,真正互相独立),算普通 SE,和全部 180 条按场景聚类的 SE 比。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex548_one_per_scenario.py
"""练习 2:每个场景只留第一种说法(60 条真独立),和 180 条聚类比,SE 差多少?"""
import json
from pathlib import Path

from part10.stats import clustered_se, naive_se

rows = json.loads((Path(__file__).parent / "data" / "runs.json").read_text())
first = [float(r["v1"]) for r in rows if r["case"].endswith("-0")]
print(f"只留每个场景的第 1 种说法:{len(first)} 条,通过 {int(sum(first))} 条,普通 SE {naive_se(first):.4f}")
all_x = [float(r["v1"]) for r in rows]
print(f"全部 180 条(按场景聚类):聚类 SE {clustered_se(all_x, [r['scenario'] for r in rows]):.4f}")
print(f"全部 180 条(当独立的,错的):普通 SE {naive_se(all_x):.4f}")
for k in (1, 2):
    xs = [float(r["v1"]) for r in rows if r["case"].endswith(f"-{k}")]
    print(f"只留第 {k + 1} 种说法:{len(xs)} 条,通过 {int(sum(xs))} 条,普通 SE {naive_se(xs):.4f}")
```

<div class="line-notes">

- `first = [float(r["v1"]) for r in rows if r["case"].endswith("-0")]` 用例编号以 `-0` 结尾的,就是每个场景的第一种说法,60 条。
- `print(f"只留每个场景的第 1 种说法:{len(first)} 条,通过 {int(sum(first))} 条,普通 SE {naive_se(first):.4f}")` 这 60 条之间互相独立,普通 SE 是对的。
- `print(f"全部 180 条(按场景聚类):聚类 SE {clustered_se(all_x, [r['scenario'] for r in rows]):.4f}")` 180 条按场景聚类。
- `xs = [float(r["v1"]) for r in rows if r["case"].endswith(f"-{k}")]` 同样的方法再试第 2、第 3 种说法。

</div>

```bash
uv run python -m part10.ex548_one_per_scenario
```

```text
只留每个场景的第 1 种说法:60 条,通过 46 条,普通 SE 0.0551
全部 180 条(按场景聚类):聚类 SE 0.0440
全部 180 条(当独立的,错的):普通 SE 0.0316
只留第 2 种说法:60 条,通过 48 条,普通 SE 0.0521
只留第 3 种说法:60 条,通过 44 条,普通 SE 0.0576
```

只留 60 条独立的,SE 是 0.055(三种说法分别是 0.0551、0.0521、0.0576,稍有波动)。全部 180 条按场景聚类,SE 是 0.0440,比 60 条的小。所以多出来的 120 条**不是白加的**,它们仍然带来了信息(同一场景的三种说法不是完全一样,有 30% 的概率自己重新抽),只是没有 180/60 = 3 倍那么多:信息量约从 60 条涨到 93 条。把 180 条当独立样本,SE 是 0.0316,那就谎报了。
</details>

**练习 3:手算 McNemar。** 不用 `mcnemar_exact`,用 `math.comb` 一步步算 14 比 4 的 p 值,打出每一项。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex548_mcnemar_hand.py
"""练习 3:不用 mcnemar_exact,手算 14 比 4 的 McNemar p 值。"""
from math import comb

b_only, a_only = 14, 4
m = a_only + b_only                       # 不一致的条数
print(f"不一致 {m} 条,如果两个版本一样好,每条不一致各 50% 概率偏向 v2")
tail = 0.0
for i in range(a_only + 1):               # 少的那边是 0、1、2、3、4 条
    pr = comb(m, i) / 2**m
    tail += pr
    print(f"  恰好 {i} 条偏向 v1:C({m},{i}) / 2^{m} = {comb(m, i)} / {2**m} = {pr:.5f}   累计 {tail:.5f}")
print(f"单侧 {tail:.5f},两侧 p = {2 * tail:.5f}")
```

<div class="line-notes">

- `b_only, a_only = 14, 4` 14 条新修好、4 条新挂。
- `m = a_only + b_only                       # 不一致的条数` 18。
- `for i in range(a_only + 1):               # 少的那边是 0、1、2、3、4 条` 把「偏向 v1 的有 0、1、2、3、4 条」的概率逐项加起来。
- `pr = comb(m, i) / 2**m` 18 条里选 i 条偏向 v1,有 C(18, i) 种选法,每种的概率是 1/2¹⁸ = 1/262144。i = 3 时 C(18,3) = 816,816/262144 = 0.00311。
- `print(f"单侧 {tail:.5f},两侧 p = {2 * tail:.5f}")` 累计 0.01544,乘 2 是 0.03088。

</div>

```bash
uv run python -m part10.ex548_mcnemar_hand
```

```text
不一致 18 条,如果两个版本一样好,每条不一致各 50% 概率偏向 v2
  恰好 0 条偏向 v1:C(18,0) / 2^18 = 1 / 262144 = 0.00000   累计 0.00000
  恰好 1 条偏向 v1:C(18,1) / 2^18 = 18 / 262144 = 0.00007   累计 0.00007
  恰好 2 条偏向 v1:C(18,2) / 2^18 = 153 / 262144 = 0.00058   累计 0.00066
  恰好 3 条偏向 v1:C(18,3) / 2^18 = 816 / 262144 = 0.00311   累计 0.00377
  恰好 4 条偏向 v1:C(18,4) / 2^18 = 3060 / 262144 = 0.01167   累计 0.01544
单侧 0.01544,两侧 p = 0.03088
```

p = 0.0309。意思是:如果两个版本真的一样好,18 条不一致的用例里,偏向 v1 的只有 4 条或更少的概率是 1.5%,两侧合起来 3.1%。比 5% 小,所以可以说差别不是抽样巧合。这个数和 `overlap_trap.py` 里 `mcnemar_exact` 给出的 0.0309 一致。
</details>

**练习 4:hybrid2 和 workflow 按工单配对。** Day 541 的数据里 hybrid2 是 40/40,workflow 是 35/40,按工单配对,差值的区间是什么?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex548_paired_hybrid.py
"""练习 4:Day 541 的 hybrid2 和 workflow,按工单配对(每张工单 5 遍,取通过比例),差值的区间。"""
import json
import math
from collections import defaultdict
from pathlib import Path

from scipy.stats import t

raw = json.loads((Path(__file__).parent / "arch_bench_raw.json").read_text())
rate: dict[str, dict[str, float]] = {}
for arch in ("hybrid2", "workflow"):
    per: dict[str, list[bool]] = defaultdict(list)
    for r in raw:
        if r["arch"] == arch:
            per[r["task_id"]].append(r["ok"])
    rate[arch] = {tid: sum(v) / len(v) for tid, v in per.items()}

d = [rate["hybrid2"][tid] - rate["workflow"][tid] for tid in sorted(rate["hybrid2"])]
print("每张工单 hybrid2 − workflow:", [round(v, 1) for v in d])
g = len(d)
mean = sum(d) / g
se = math.sqrt(sum((v - mean) ** 2 for v in d) / (g - 1) / g)
tc = t.ppf(0.975, g - 1)
print(f"均值 {mean:+.3f}  SE {se:.3f}  t 临界值 {tc:.3f}  95% 区间 [{mean - tc * se:+.3f}, {mean + tc * se:+.3f}]")
```

<div class="line-notes">

- `for arch in ("hybrid2", "workflow"):` 这次比的是这两个架构。
- `d = [rate["hybrid2"][tid] - rate["workflow"][tid] for tid in sorted(rate["hybrid2"])]` 逐工单做差,`sorted` 让 T1 到 T8 顺序固定。
- `se = math.sqrt(sum((v - mean) ** 2 for v in d) / (g - 1) / g)` 和 `paired_bench.py` 里的 `sd / math.sqrt(g)` 是同一个量,写成一行:方差 /(g−1) /g 再开方。
- `tc = t.ppf(0.975, g - 1)` t 分布的临界值 2.365。

</div>

```bash
uv run python -m part10.ex548_paired_hybrid
```

```text
每张工单 hybrid2 − workflow: [0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0]
均值 +0.125  SE 0.125  t 临界值 2.365  95% 区间 [-0.171, +0.421]
```

只有 T6 不同(+1.0),均值 +0.125,SE 0.125,区间 [−0.171, +0.421],跨过 0。hybrid2 40/40 看起来比 workflow 35/40 强,但 8 张工单里只有一张分得出高下,这个差别不足以排除巧合。Day 543 的 ADR 选 hybrid2,理由要靠成本和代码核对,不能靠这个数。
</details>

**验收标准**:`cluster_demo.py` 能打出聚类 SE 0.0440、设计效应 1.93、有效样本数 93;`cluster_coverage.py` 里不聚类 Wilson 的包住率约 84%,聚类后约 94%;`paired_demo.py` 打出配对 SE 0.0208、区间 [−3.5%, +5.7%]、McNemar p = 0.7905,并列出 6 条新挂和 8 条新修好;能不看文章默写 `clustered_se` 和 `paired_diff`;能回答「为什么 180 条的 v1 通过率区间,要比 Day 547 给的更宽」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 用例不独立 | 同一场景的几种说法、同一客户的几轮对话等,结果会一起对一起错,不能当成互不相干的样本 |
| 簇(cluster) | 一组互相相关的用例。今天的簇是一个场景(3 条),Day 541 里的簇是一张工单(5 次运行) |
| 残差 | 一条用例的结果减去平均通过率。v1 平均 0.7667,过的那条残差是 +0.2333,挂的是 −0.7667 |
| 聚类标准误 | 先把簇内的残差加起来,再对各簇的和求平方和,开方除以 n。簇内越一致,它比普通标准误越大 |
| 设计效应(design effect) | 聚类 SE 与普通 SE 之比的平方。v1 是 1.93,意思是 180 条的方差是独立样本的 1.93 倍 |
| 有效样本数 | 样本数除以设计效应。v1 是 180/1.93 ≈ 93,相当于 93 条独立样本的信息量 |
| 配对比较 | 两个版本跑同一批用例,先逐条做差,再对差值做统计 |
| 新挂 / 新修好 | 配对里两个版本结果不一致的两类用例:v1 对 v2 错(新挂),v1 错 v2 对(新修好) |
| McNemar 检验 | 只看不一致的用例,如果两个版本一样好,每条偏向哪边是 50/50,算偏离这个 50/50 的 p 值 |
| 相关系数 | 两列数字「同步」的程度,−1 到 1。v1 和 v2 在同一条用例上是 0.779 |
| p 值 | 如果两个版本真没差别,看到这么大(或更大)差别的概率。小于 0.05 习惯上叫显著 |
| t 分布 | 样本很少时,估计标准误本身不准,95% 区间要乘一个比 1.96 更大的数(8 个簇时是 2.365) |
| 精确检验 | 不靠正态近似,直接用二项分布把所有可能结果的概率加起来 |

## 常见误区

**把 180 条用例当 180 个样本。** 同一个场景的三种说法,43 个场景三条结果一致,独立的话该只有 28 个。报告里要同时写用例数和簇数:「180 条用例,60 个场景」。

**两个区间重叠就说没差别。** 重叠说明「单看两个分数不够下结论」,不是「差值包含 0」。构造的例子里两个区间大面积重叠,配对的 McNemar p = 0.031。比较两个版本直接算差值的区间。

**配对要求用例一一对应,不是随便两批用例。** 如果 v2 是在另一批新用例上跑的,就不能配对。`paired_diff` 要求两个列表同长、同序,用例编号对得上,最好先按 `case` 字段排序。

**`zip` 悄悄截断。** 两个长度不同的列表传给 `clustered_se` 不报错,只是少算一条。写统计函数时先检查长度。

**设计效应小于 1 就把样本数放大。** 一批用例里刚好没看出相关性,算出来 deff = 0.88,这是噪声,不是「独立性比独立还好」。取 `max(1.0, deff)`。

**簇很少时也照用聚类标准误。** 8 张工单的聚类 SE 偏小,不稳。今天的 8 个簇只能看量级。

**把 McNemar 当成「大样本才能用」。** 它看的是不一致的那几条,不一致只有 14 条,精确检验照样能算。但它不考虑聚类,簇内相关强时 p 值会偏乐观,对重要结论要同时看聚类版的区间。

**只看 p 值不看是哪几条。** p = 0.79 只告诉你没差别。6 条新挂、8 条新修好才是工程上能动手的东西。

## 学习资料

### 文档与文章

- [Evan Miller《Adding Error Bars to Evals》](https://arxiv.org/abs/2411.00640)(2024):今天的聚类标准误和配对差值的公式来源。第 2.2 节讲聚类,第 4.2 节讲配对。表 4 用真实 Anthropic 模型的数字说,DROP 数据集的聚类标准误是普通标准误的 3.05 倍,MGSM 是 1.88 倍。
- [Anthropic · A statistical approach to model evaluations](https://www.anthropic.com/research/statistical-approach-to-model-evals):对上面那篇论文的短介绍,更好读。
- [Wikipedia · Design effect](https://en.wikipedia.org/wiki/Design_effect):设计效应的定义和「有效样本数 = n / deff」,调查抽样里的老概念,和我们今天的聚类是同一回事。
- [Wikipedia · McNemar's test](https://en.wikipedia.org/wiki/McNemar%27s_test):2×2 表和不一致的两格,精确版和近似版的区别。
- [scipy · binomtest](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.binomtest.html):McNemar 的精确版本等价于对不一致的条数做 p = 0.5 的二项检验,`scipy.stats.binomtest(a_only, a_only + b_only, 0.5)` 能核对我们手写的 `mcnemar_exact`。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1XW4y1279o&autoplay=0&high_quality=1" title="【数据分析说人话】十分钟学会配对样本t检验·SPSS" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>宇彦学长 · 【数据分析说人话】十分钟学会配对样本t检验·SPSS · 10 分钟。操作界面是 SPSS,我们不用它,看前几分钟「为什么要配对、差值怎么看」的那部分就够。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Pr4y1e7A5&p=28&autoplay=0&high_quality=1" title="StatQuest 统计学基础 第 28 集 Sample Size and Effective Sample Size" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>至冬川搬运 · [StatQuest] Statistics Fundamentals 合集第 28 集(Sample Size and Effective Sample Size, Clearly Explained!!!)· 6 分多钟,英文。「有效样本数」的另一种讲法,对应今天的 n/deff。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/p338YiJVi18" title="The McNemar test" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>TileStats · The McNemar test · 英文。用 2×2 表讲 McNemar 看哪两格、为什么忽略「都对」和「都错」。</figcaption>
</figure>

### 书籍

- Alex Reinhart《Statistics Done Wrong: The Woefully Complete Guide》(No Starch Press,2015):其中讲「伪重复」(pseudoreplication,把相关的测量当成独立重复)的那一章,就是今天聚类要解决的问题。
- A. Colin Cameron、Douglas Miller 的论文《A Practitioner's Guide to Cluster-Robust Inference》(Journal of Human Resources,2015):计量经济学里聚类标准误的实务指南,簇很少时怎么办也在里面。需要细节再读,今天不用。

### 开源项目与代码

- 你自己的 `part10/stats.py`:今天新增 7 个函数。
- [statsmodels · stats/proportion.py](https://github.com/statsmodels/statsmodels/blob/main/statsmodels/stats/proportion.py):里面有 `proportion_confint`,以及比较两个比例的函数,可以对照今天手写的东西看。

## 自测

1. 为什么 `runs.json` 的 180 条用例不能当作 180 个独立样本?用数据说一个证据。

<details><summary>答案</summary>

同一个场景的三种说法大概率一起过或一起挂。60 个场景里有 43 个场景三条结果完全一致(36 个全过、7 个全挂),如果三条真的互相独立、每条通过率 0.7667,应该只有约 28 个场景一致。
</details>

2. 聚类标准误怎么算?为什么比普通标准误大?

<details><summary>答案</summary>

先把每个簇内的残差(结果减平均)加起来,得到簇残差;对所有簇的簇残差求平方和,开方,再除以 n。簇残差之和的平方,展开等于每条残差自己的平方,加上同簇内两条不同用例的残差乘积。同簇的用例总是同向偏离时,乘积为正,这一项让标准误变大;互相独立时这一项约等于 0,聚类标准误等于普通标准误。v1 上是 0.0440 对 0.0316。
</details>

3. v1 的设计效应是 1.93,意思是什么?有效样本数是多少?

<details><summary>答案</summary>

设计效应是聚类 SE 与普通 SE 之比的平方(1.39² ≈ 1.93),意思是这 180 条用例的方差是 180 条独立样本时的 1.93 倍。有效样本数 = 180 / 1.93 ≈ 93,也就是这 180 条的信息量大约只相当于 93 条独立样本。
</details>

4. 比较两个版本,为什么不能看两个区间重不重叠?

<details><summary>答案</summary>

两个版本跑的是同一批用例,用例本身的难度在两个版本里同时存在。各画各的区间,把「用例难度的差别」当成了噪声,区间被撑得很宽,重叠了也不代表差值包含 0。配对比较逐条做差,用例难度自动抵消,只剩下两个版本真实的差别。构造例子里两个区间大面积重叠,配对 McNemar 的 p 是 0.031。
</details>

5. McNemar 检验为什么只看不一致的那几条?runs.json 上它得到什么结论?

<details><summary>答案</summary>

两个版本结果一样的用例(都对或都错)对「谁更好」没有提供信息。如果两个版本一样好,不一致的用例偏向哪个版本应该是 50/50。runs.json 上不一致 14 条,v1 对 v2 错 6 条、v1 错 v2 对 8 条,p = 0.7905,看不出差别。
</details>

6. 面试题:「你的评测集 200 条,是 50 个场景各 4 种说法,v2 比 v1 高了 3 个点,你怎么判断是不是真的变好?」

<details><summary>答案</summary>

先说样本:这 200 条不是 200 个独立样本,是 50 个簇,要用按场景聚类的标准误(或者按场景 bootstrap),有效样本数大概只有一半甚至更少。然后说比较方法:两个版本跑的是同一批用例,所以对每条做差,在差值上算均值和聚类标准误,得到差值的区间,不是比较两个各自的区间。再看不一致的用例:新挂了几条、新修好几条,各来自几个场景,用 McNemar 的思路判断是不是偏向 v2。最后看区间有没有跨 0;跨过 0 的话要同时说清楚这个评测集的最小可检测差异(MDE)是多少,是「没效果」还是「测不出来」(Day 550 讲 MDE)。
</details>

## 明天预告

Day 549 · 评测统计学(三):bootstrap 和 Agent 自己在抖。今天的区间都靠公式,公式有前提(接近正态、簇够多)。明天换一种不靠公式的办法:**bootstrap**,把手里的用例当成「整个世界」,有放回地重抽几千次,看分数怎么波动,按簇重抽就能把聚类带进去。然后讲另一个不确定性来源:同一个 Agent、同一批用例,重跑一遍结果也会变。Day 541 那 8 张工单我补跑了 10 遍,看实际抖多大、`temperature=0` 管不管用、每题多跑几遍值不值得。
