---
title: 'Day 69 · 评测里的统计学:样本量、置信区间、显著性'
description: 'v2 在 180 条用例上比 v1 高了 1.1 个点,能合并吗?今天用 SupportPilot 那种「场景 × 说法」的评测数据,把 Wilson 区间、聚类标准误、配对比较、McNemar、按簇 bootstrap、重复采样和功效分析全部写成代码跑一遍。跑完你会发现,这 1.1 个点在统计上什么也说明不了,而这个评测集连 6 个点以下的提升都看不出来。'
pubDate: 2026-10-12
regime: none
tags: ['eval', 'statistics', 'confidence-interval', 'power-analysis', 'senior', 'agent-60']
series: 'agent-60'
day: 69
lang: 'zh'
---

## 今天要解决的问题

假设你改了 SupportPilot 的分类 prompt,跑了一遍评测。v1 是 76.7%,v2 是 77.8%,涨了 1.1 个点。同事在 MR 里评论「涨了,合吧」。

你该不该合?

Day 31 我们算过一个粗略的数:50 条用例、通过率 85% 左右时,95% 置信区间大概是 ±10 个点。所以直觉上你会觉得 1.1 个点不算什么。但这个直觉不够用,原因有三个:

1. SupportPilot 的评测集(Day 50)是「场景 × 说法」结构,同一个场景有三种问法,这三条用例的结果高度相关,不是 180 次独立抽样。直接套 Day 31 的公式,区间会算窄。
2. 我们要回答的不是「v2 的通过率是多少」,而是「v2 比 v1 好不好」。两个版本跑的是同一批题,应该用配对比较,这时区间反而会算宽了。
3. Agent 本身有随机性。同一个版本、同一批题,重跑一遍分数也会变。

今天把这三件事都算清楚。学完你应该能:

1. 解释为什么通过率接近 0 或 1、样本又少的时候要用 Wilson 区间。
2. 用聚类标准误处理「同一场景多种说法」这种相关结构,并说出它比普通标准误大多少。
3. 用配对差值、McNemar 检验和按簇 bootstrap 比较两个版本,给出差值的置信区间。
4. 知道每题重复跑 K 次能把分数的抖动降多少,以及为什么不该靠调低 temperature 来降抖动。
5. 做功效分析:给定评测集大小,算出能可靠检测的最小提升;给定想检测的提升,算出需要多少题。
6. 在面试里回答「你怎么证明你的改动有效」。

预计用时 4 到 5 小时,统计基础薄的同学留出更多时间看视频。前置:Day 31(测试集大小)、Day 50(SupportPilot 评测集结构)、Day 68(评测的组织)。

这一天的理论主要来自 Evan Miller 2024 年 11 月的论文《Adding Error Bars to Evals》(Anthropic 也发了对应的研究文章)。论文只有 14 页,公式都很朴素,我建议今天学完之后通读一遍。

## 先准备数据

为了让每个数字都能复现,我用一个小脚本造了两次评测运行的结果。结构和 Day 50 一样:60 个场景,每个场景 3 种说法,一共 180 条用例。每个场景有自己的难度,同一场景的几种说法七成概率结果一样(要么一起过要么一起挂),这和真实情况很接近:如果 Agent 不懂「年付按剩余整月退」这条规则,换三种问法它也大概率都答错。

```python
# data/make_runs.py:造两次评测运行的结果,用来演示统计方法。
# 结构和 Day 50 的 SupportPilot 评测集一样:场景 × 说法,每个场景 3 种说法。
import json, random
random.seed(7)
rows = []
for s in range(60):                      # 60 个场景
    hard = random.random()               # 场景本身的难度,同场景的几种说法共享
    base = 0.55 + 0.4 * (1 - hard)       # v1 在这个场景上的成功概率
    lift = 0.06 if hard > 0.5 else 0.01  # v2 主要改善了难场景
    shared = int(random.random() < base) # 同一场景的几种说法,结果往往一起对一起错
    for v in range(3):                   # 3 种说法
        a = shared if random.random() < 0.7 else int(random.random() < base)
        b = a if random.random() < 0.8 else int(random.random() < min(base + lift, 0.99))
        rows.append({"case": f"S{s:02d}-{v}", "scenario": f"S{s:02d}", "v1": a, "v2": b})
json.dump(rows, open("data/runs.json", "w"), indent=0)
print(len(rows), "rows")
```

你自己的项目里不需要这个脚本,直接用 Day 50 评测报告里每条用例的 0/1 结果就行,字段名对上即可。

下面所有的统计函数都放在 `agentops/evals/stats.py` 里,完整代码在后面「把它们放进一个模块」那一节。

## 第一件事:通过率的区间,别再用 p ± 1.96·SE

Day 31 用的公式叫 Wald 区间:p ± 1.96 × √(p(1−p)/n)。它在 n 大、p 不靠近 0 或 1 的时候没问题,但在评测里我们恰恰经常碰到 p 接近 1 的情况(回归集本来就应该接近 100%),这时 Wald 区间会给出很离谱的结果。

看几个真实算出来的例子:

| 结果 | Wald 区间 | Wilson 区间 |
| --- | --- | --- |
| 20 条过了 19 条 | 85.4% ~ 104.6% | 76.4% ~ 99.1% |
| 20 条全过 | 100% ~ 100% | 83.9% ~ 100% |
| 50 条过了 47 条 | 87.4% ~ 100.6% | 83.8% ~ 97.9% |
| 180 条过了 138 条 | 70.5% ~ 82.8% | 70.0% ~ 82.2% |

第一行区间上限超过了 100%,这显然不可能。第二行更糟:20 条全过,Wald 区间宽度是零,好像在说「真实通过率一定是 100%」。可实际上 20 条全过,真实通过率是 85% 的可能性一点都不小。Wilson 区间告诉你,它可能低到 84%。

最后一行 n 大、p 适中,两者几乎一样。所以规则很简单:**统一用 Wilson**,它在所有情况下都不比 Wald 差。代码只有几行:

```python
def wilson_ci(k: int, n: int, z: float = 1.959964) -> tuple[float, float]:
    if n == 0:
        return 0.0, 1.0
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, centre - half), min(1.0, centre + half)
```

这一条对红队尤其重要(Day 72 会用到):12 次攻击 0 次成功,Wilson 区间上限是 24%。你不能说「攻击成功率是 0」,只能说「有 95% 把握低于 24%」,这两句话给老板的感觉完全不一样。

## 第二件事:用例不独立,区间要放宽

中心极限定理给的标准误公式有个前提:每条用例是独立抽出来的。「场景 × 说法」结构违反了这个前提。直观地想,如果一个场景的 3 种说法总是一起对一起错,那 180 条用例里真正的「独立信息」更接近 60 条,而不是 180 条。

Miller 的论文给出了聚类标准误的公式:在普通标准误的平方上,加上所有「同簇内两两残差乘积」的和。实现上等价于:先把每个簇内的残差加起来,再对这些簇和求平方和。

```python
def clustered_se(scores: list[float], clusters: list[str]) -> float:
    x = np.asarray(scores, dtype=float)
    n = len(x)
    resid = x - x.mean()
    by_c: dict[str, float] = defaultdict(float)
    for r, c in zip(resid, clusters):
        by_c[c] += r
    var = sum(v * v for v in by_c.values()) / (n * n)
    return float(math.sqrt(var))
```

如果每条用例自成一簇,这个公式就退化成普通标准误(测试里我专门验证了这一点)。在我们的数据上跑出来:

```text
v1: 0.767  naive SE 0.032  clustered SE 0.044  Wilson [0.700, 0.822]
v2: 0.778  naive SE 0.031  clustered SE 0.044  Wilson [0.712, 0.832]
```

聚类标准误是普通标准误的 1.38 倍。换算成 95% 区间,v1 不是「76.7% ± 6.3 个点」,而是「± 8.6 个点」。Miller 在论文里用真实 Anthropic 模型跑的结果更夸张:DROP 这个数据集(一篇文章出好几道题)聚类标准误是普通标准误的 3.05 倍,MGSM(同一道题翻译成多种语言)是 1.88 倍。

什么时候要用聚类标准误?只要你的评测集里有「同一个来源派生出多条用例」的结构,就要用。常见的有:

- 同一个场景的多种说法(SupportPilot 就是)。
- 同一个客户的多轮对话被拆成多条用例。
- 同一份长文档上出的多道问答题。
- 合成数据时,同一个种子样本改写出的多个变体。

报告里要同时写上簇的数量。「180 条用例、60 个场景」比「180 条用例」诚实得多。

## 第三件事:比较两个版本,要配对

现在回到最初的问题:v2 比 v1 好吗?

很多人的做法是把两个区间画出来,看重不重叠。v1 是 [70.0%, 82.2%],v2 是 [71.2%, 83.2%],大面积重叠,所以「没差别」。这个结论碰巧是对的,但方法是错的,换一组数据就可能得出错误结论。

问题在于两个版本跑的是同一批题。题目难度的差异在两个版本里是同时存在的,比较的时候应该把它消掉。做法是**先逐题算差值,再对差值做统计**:

d_i = v2 在第 i 题的得分 − v1 在第 i 题的得分

差值的均值就是提升量,差值的标准误就是提升量的标准误。Miller 论文里给了另一种写法,能看出配对为什么有用:

SE(配对) = √(SE_A² + SE_B² − 2·SE_A·SE_B·Corr(A, B))

两个版本在同一题上的表现越相关(大部分题两个版本都对或都错),减掉的那一项越大,配对标准误就越小。在我们的数据上:

```text
unpaired SE of diff = 0.0443  (paired 0.0208)
paired      : se 0.0208  CI [-0.030, +0.052]
paired+clust: se 0.0235  CI [-0.035, +0.057]
```

不配对的话,差值的标准误是 4.4 个点;配对之后是 2.1 个点,缩小了一半多。再考虑场景聚类,是 2.35 个点。最终 v2 相对 v1 的提升是 +1.1 个点,95% 区间是 −3.5 到 +5.7 个点。区间跨过了零,所以这次改动在统计上没有可靠的提升,也没有可靠的下降。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="不配对与配对比较的区间对比">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink-soft)">左:两个版本各自的 95% 区间(聚类)    右:差值 v2 − v1 的 95% 区间</text>
<line x1="40" y1="220" x2="300" y2="220" stroke="var(--rule)"/>
<text x="20" y="224" fill="var(--ink-faint)">60%</text>
<text x="20" y="64" fill="var(--ink-faint)">90%</text>
<line x1="110" y1="177" x2="110" y2="85" stroke="var(--mem)" stroke-width="3"/>
<circle cx="110" cy="131" r="5" fill="var(--mem)"/>
<text x="90" y="244" fill="var(--ink)">v1</text>
<line x1="210" y1="170" x2="210" y2="80" stroke="var(--compute)" stroke-width="3"/>
<circle cx="210" cy="125" r="5" fill="var(--compute)"/>
<text x="190" y="244" fill="var(--ink)">v2</text>
<line x1="360" y1="140" x2="620" y2="140" stroke="var(--rule)"/>
<line x1="490" y1="60" x2="490" y2="220" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
<text x="484" y="236" fill="var(--ink-faint)">0</text>
<line x1="455" y1="110" x2="547" y2="110" stroke="var(--mem)" stroke-width="3"/>
<circle cx="501" cy="110" r="5" fill="var(--mem)"/>
<text x="370" y="96" fill="var(--ink)">配对+聚类 −3.5 ~ +5.7</text>
<line x1="414" y1="170" x2="588" y2="170" stroke="var(--rule)" stroke-width="3"/>
<circle cx="501" cy="170" r="5" fill="var(--ink-faint)"/>
<text x="370" y="196" fill="var(--ink-faint)">不配对 −7.6 ~ +9.8</text>
</g>
</svg>
<figcaption>左边两个区间大面积重叠,看起来能说明「没区别」,但这种看法本身不严谨。右边是正确的做法:直接算差值的区间。配对之后区间窄了一半多,只是这次仍然跨过了零。</figcaption>
</figure>

配对还有一个附带的好处:你能看到具体是哪些题变了。这就是 McNemar 检验的思路,它只看「两个版本结果不一致」的那些题:

```text
mcnemar     : {'a_only': 6, 'b_only': 8, 'p_value': 0.79052734375}
```

v1 对、v2 错的有 6 题,v1 错、v2 对的有 8 题,其余 166 题两个版本结果一样。如果两个版本真的一样好,不一致的题应该一半一半,8 比 6 完全在随机波动范围内,p 值 0.79。

McNemar 输出的「新挂了 6 条、新修好了 8 条」对工程师特别有用。Day 35 的门禁报告里已经有这个列表,今天只是给它配上了统计判断。我在 MR 评论里通常会直接贴这两个列表,让改动的人去读那 6 条新挂的 trace,很多时候能发现改动带来的副作用。

## 第四件事:不想依赖正态假设,就 bootstrap

上面的区间都基于正态近似。样本少、分布奇怪的时候(比如分数是 0 到 1 之间的连续值,大部分堆在两端),可以用 bootstrap 交叉验证一下。

注意要按簇重抽样:每次从 60 个场景里有放回地抽 60 个,把抽中场景的所有用例都带上,算一次差值。重复 5000 次,取 2.5% 和 97.5% 分位数。如果按单条用例重抽,就又假设了用例独立,前面聚类的工作就白做了。

```python
def cluster_bootstrap_diff(a, b, clusters, n_boot=5000, seed=0):
    rng = np.random.default_rng(seed)
    groups = defaultdict(list)
    for i, c in enumerate(clusters):
        groups[c].append(i)
    keys = list(groups)
    d = np.asarray(b, dtype=float) - np.asarray(a, dtype=float)
    sums = np.array([d[groups[k]].sum() for k in keys])
    sizes = np.array([len(groups[k]) for k in keys])
    idx = rng.integers(0, len(keys), size=(n_boot, len(keys)))
    boot = sums[idx].sum(axis=1) / sizes[idx].sum(axis=1)
    lo, hi = np.percentile(boot, [2.5, 97.5])
    return float(lo), float(hi)
```

跑出来是 −3.9% 到 +5.6%,和配对加聚类的正态近似(−3.5% 到 +5.7%)基本一致。两种方法对得上,结论就比较放心。对不上的时候,通常说明样本太少或者分布很偏,这时以 bootstrap 为准,同时考虑扩大评测集。

## 第五件事:Agent 自己在抖

前面算的都是「题目抽样」带来的不确定性:你的 180 题只是所有可能工单里的一小部分。还有另一种不确定性:同一个版本、同一批题,重跑一遍结果也会变,因为模型采样有随机性,工具返回的时间和顺序也可能不同。

这个抖动有多大?我模拟了一个 200 题的评测集,每题有自己的成功率,然后把整套评测重跑 2000 遍,看总分的标准差:

```text
K= 1  score std across reruns = 0.0300
K= 3  score std across reruns = 0.0172
K= 5  score std across reruns = 0.0134
K=10  score std across reruns = 0.0095
```

每题只跑一次时,光是重跑,总分就会有 3 个点的标准差。也就是说,同一个版本今天跑 78%、明天跑 74% 是完全正常的。每题跑 5 次取平均,抖动降到 1.3 个点;跑 10 次降到 1 个点以下。代价是评测成本翻 5 倍或 10 倍。

Miller 论文里对这件事有两条建议,我都照做:

- 重复采样来降低方差,但收益有上限。 重复采样只能消掉「同一题重跑的随机性」,消不掉「题目抽样」本身的不确定性。论文里的例子是每题跑 2 次方差降 1/3,跑 4 次降 1/2,上限是 2/3。实践里 K = 3 到 5 是性价比比较高的区间。
- 不要靠调低 temperature 来降抖动。 温度调低,评测分数是稳了,但你评的已经不是线上那个 Agent 了。线上用 0.7,评测用 0,得出的结论对线上没有意义。

重复采样还有一个用途:算 pass^k。Day 29 讲过,客服类 Agent 关心的是「每次都能做对」,τ-bench 用 pass^k 来衡量:同一题跑 k 次全部成功的概率。每题跑 n 次、成功 c 次,pass^k 的无偏估计是 C(c, k) / C(n, k) 在所有题上的平均。我造了 30 道题(10 道成功率 95%、10 道 80%、10 道 50%),每题跑 8 次:

```text
k=1: pass@k 0.762  pass^k 0.762
k=2: pass@k 0.910  pass^k 0.615
k=4: pass@k 0.989  pass^k 0.466
k=8: pass@k 1.000  pass^k 0.367
```

同样一批题,用 pass@8 汇报是 100%,用 pass^8 汇报是 36.7%。这两个数字都没错,但讲的是完全不同的事。面向客户的 Agent,我会在报告里同时给 pass^1 和 pass^4,让读者看到「稳定性」这一面。

## 第六件事:先算评测集够不够大

上面所有分析都是在跑完评测之后做的。资深一点的做法是跑之前先算:我这个评测集,能检测出多小的提升?

这就是功效分析(power analysis)。你要定三个数:

- 显著性水平 α,一般 0.05,意思是「真的没差别时,误报有差别」的概率最多 5%。
- 功效,一般 80%,意思是「真的有这么大的提升时,能检测出来」的概率。
- 配对差值的方差 ω²,可以用以前的评测数据估计。

最小可检测差异(MDE)= (z_{0.975} + z_{0.8}) × √(ω² / n) ≈ 2.80 × 差值的标准误。

在我们的数据上,ω² = 0.0781。不同评测集大小对应的 MDE(先不考虑聚类):

| 配对题数 n | MDE |
| --- | --- |
| 50 | 11.1 个点 |
| 100 | 7.8 个点 |
| 180 | 5.8 个点 |
| 400 | 3.9 个点 |
| 700 | 3.0 个点 |
| 1000 | 2.5 个点 |

<figure>
<svg viewBox="0 0 640 240" role="img" aria-label="评测集大小与最小可检测差异的关系">
<rect x="0" y="0" width="640" height="240" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<line x1="70" y1="200" x2="610" y2="200" stroke="var(--rule)"/>
<line x1="70" y1="200" x2="70" y2="20" stroke="var(--rule)"/>
<text x="20" y="38" fill="var(--ink-faint)">12 点</text>
<text x="24" y="121" fill="var(--ink-faint)">6 点</text>
<text x="30" y="204" fill="var(--ink-faint)">0</text>
<line x1="70" y1="158" x2="610" y2="158" stroke="var(--compute)" stroke-dasharray="4 4"/>
<text x="470" y="152" fill="var(--compute)">想检测的提升:3 点</text>
<polyline points="97,47 124,92 167,119 286,146 448,159 610,166" fill="none" stroke="var(--mem)" stroke-width="2"/>
<circle cx="97" cy="47" r="3" fill="var(--mem)"/>
<circle cx="124" cy="92" r="3" fill="var(--mem)"/>
<circle cx="167" cy="119" r="3" fill="var(--mem)"/>
<circle cx="286" cy="146" r="3" fill="var(--mem)"/>
<circle cx="448" cy="159" r="3" fill="var(--mem)"/>
<circle cx="610" cy="166" r="3" fill="var(--mem)"/>
<text x="88" y="218" fill="var(--ink-soft)">50</text>
<text x="157" y="218" fill="var(--ink-soft)">180</text>
<text x="274" y="218" fill="var(--ink-soft)">400</text>
<text x="436" y="218" fill="var(--ink-soft)">700</text>
<text x="590" y="218" fill="var(--ink-soft)">1000</text>
<text x="178" y="112" fill="var(--ink)">180 题:5.8 点</text>
</g>
</svg>
<figcaption>MDE 随题数的平方根下降。想把 MDE 压到 3 个点,需要大约 700 道独立的配对题;如果用例之间有聚类相关,需要的更多。</figcaption>
</figure>

结论很扎心:**我们这个 180 条的评测集,连 6 个点以下的提升都检测不出来**,考虑聚类之后是 6.6 个点。想检测 3 个点的提升,需要大约 682 道独立的题(`required_n(0.03, 0.0781)` 算出来的),Miller 论文的例子里(ω² = 1/9)是 969 道。

这件事改变的是你做决策的方式。如果你知道评测集只能看出 6 个点以上的变化,那么:

- 小的 prompt 微调,别指望靠这个评测集来证明它有效。要么扩大评测集,要么每题多跑几次(重复采样能降 ω²),要么接受「没有证据说明它更差,出于其他理由合并」。
- 报告里写「没有显著差异」时,要同时写上 MDE。「没有显著差异(本评测集只能检测 ≥6.6 个点的变化)」和「没有显著差异」给人的信息完全不同,前者在告诉读者:我们其实没能力判断。
- 提出「要把评测集扩到 700 条」时,你有了一个算出来的理由,而不是「感觉不够」。

## 多重比较:看的指标越多,越容易「发现」提升

还有一个坑。评测报告里通常不止一个分数:总分、5 个模块的分数、3 个严重级别的分数、judge 分、延迟、成本……假设看 10 个指标,每个都用 α = 0.05,两个版本其实完全一样,至少有一个指标「显著」的概率是 1 − 0.95¹⁰ ≈ 40%。

所以:

- 事先定好一个主指标(比如回归集 P0 通过率或者能力集总分),合不合并主要看它。其余指标只当参考和护栏。
- 如果确实要同时检验多个指标,用 Holm 或 Bonferroni 校正。最简单的 Bonferroni:10 个指标,每个用 α = 0.005。
- 对着报告找「哪个模块涨了」然后只汇报那个模块,这在统计上叫 p-hacking。它通常不是故意的,但结果一样。

## 把它们放进一个模块

上面的函数整理成 `agentops/evals/stats.py`。这是 AgentOps 评测平台的统计内核,Day 74 的对比报告和 Day 100 的评测平台都会用它。

```python
# agentops/evals/stats.py
"""评测结果的统计工具:置信区间、聚类标准误、配对比较、功效分析、pass^k。

约定:scores 是 0/1(或 0~1 的分数)的列表;clusters 是同长度的分组标签
(比如 SupportPilot 评测集里的「场景 id」,同一场景的几种说法算一个簇)。
"""
from __future__ import annotations

import math
from collections import defaultdict
from math import comb

import numpy as np
from scipy import stats

Z95 = 1.959964


def mean_se(scores: list[float]) -> tuple[float, float]:
    """均值和中心极限定理给的标准误(样本标准差 / √n)。"""
    x = np.asarray(scores, dtype=float)
    n = len(x)
    return float(x.mean()), float(x.std(ddof=1) / math.sqrt(n))


def wilson_ci(k: int, n: int, z: float = Z95) -> tuple[float, float]:
    """Wilson 区间。通过率接近 0 或 1、样本又少时,比 p ± 1.96·SE 靠谱得多。"""
    if n == 0:
        return 0.0, 1.0
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, centre - half), min(1.0, centre + half)


def clustered_se(scores: list[float], clusters: list[str]) -> float:
    """聚类标准误(Miller 2024 的公式):把同簇内的协方差加回去。"""
    x = np.asarray(scores, dtype=float)
    n = len(x)
    resid = x - x.mean()
    by_c: dict[str, float] = defaultdict(float)
    for r, c in zip(resid, clusters):
        by_c[c] += r
    var = sum(v * v for v in by_c.values()) / (n * n)
    return float(math.sqrt(var))


def paired_diff(a: list[float], b: list[float], clusters: list[str] | None = None) -> dict:
    """同一批用例上 B 相对 A 的提升:点估计、标准误、95% CI。"""
    d = np.asarray(b, dtype=float) - np.asarray(a, dtype=float)
    mean = float(d.mean())
    se = clustered_se(list(d), clusters) if clusters else float(d.std(ddof=1) / math.sqrt(len(d)))
    return {"diff": mean, "se": se, "ci": (mean - Z95 * se, mean + Z95 * se), "n": len(d)}


def mcnemar(a: list[int], b: list[int]) -> dict:
    """McNemar 精确检验:只看「A 对 B 错」和「A 错 B 对」两种不一致的题。"""
    a_only = sum(1 for x, y in zip(a, b) if x == 1 and y == 0)
    b_only = sum(1 for x, y in zip(a, b) if x == 0 and y == 1)
    n = a_only + b_only
    p = 1.0 if n == 0 else stats.binomtest(b_only, n, 0.5).pvalue
    return {"a_only": a_only, "b_only": b_only, "p_value": float(p)}


def cluster_bootstrap_diff(a, b, clusters, n_boot: int = 5000, seed: int = 0) -> tuple[float, float]:
    """按簇重抽样的 bootstrap,给配对差值一个 95% 百分位区间。"""
    rng = np.random.default_rng(seed)
    groups: dict[str, list[int]] = defaultdict(list)
    for i, c in enumerate(clusters):
        groups[c].append(i)
    keys = list(groups)
    d = np.asarray(b, dtype=float) - np.asarray(a, dtype=float)
    sums = np.array([d[groups[k]].sum() for k in keys])
    sizes = np.array([len(groups[k]) for k in keys])
    idx = rng.integers(0, len(keys), size=(n_boot, len(keys)))
    boot = sums[idx].sum(axis=1) / sizes[idx].sum(axis=1)
    lo, hi = np.percentile(boot, [2.5, 97.5])
    return float(lo), float(hi)


def mde(n: int, omega2: float, alpha: float = 0.05, power: float = 0.8) -> float:
    """最小可检测差异:n 道配对题、配对差值方差 ω² 时,能可靠发现的最小提升。"""
    z = stats.norm.ppf(1 - alpha / 2) + stats.norm.ppf(power)
    return float(z * math.sqrt(omega2 / n))


def required_n(delta: float, omega2: float, alpha: float = 0.05, power: float = 0.8) -> int:
    """想可靠地发现 delta 的提升,需要多少道独立的配对题。"""
    z = stats.norm.ppf(1 - alpha / 2) + stats.norm.ppf(power)
    return math.ceil(z * z * omega2 / (delta * delta))


def pass_hat_k(trials: dict[str, list[int]], k: int) -> float:
    """τ-bench 的 pass^k:每题 n 次试验里 c 次成功,估计「连续 k 次都成功」的概率。"""
    vals = []
    for outcomes in trials.values():
        n, c = len(outcomes), sum(outcomes)
        if n < k:
            raise ValueError(f"每题至少要跑 {k} 次")
        vals.append(comb(c, k) / comb(n, k))
    return float(np.mean(vals))


def pass_at_k(trials: dict[str, list[int]], k: int) -> float:
    """pass@k:k 次里至少成功一次的概率(无偏估计)。"""
    vals = []
    for outcomes in trials.values():
        n, c = len(outcomes), sum(outcomes)
        vals.append(1 - comb(n - c, k) / comb(n, k))
    return float(np.mean(vals))
```

依赖:`uv add numpy scipy`。统计代码最怕「看起来对」,所以一定要配测试。我写了 7 个测试,其中两个拿论文和教科书上的已知结果做对照:

```python
# tests/test_stats.py
import math
import pytest
from agentops.evals import stats as S


def test_wilson_matches_textbook():
    lo, hi = S.wilson_ci(8, 10)
    assert round(lo, 3) == 0.490 and round(hi, 3) == 0.943


def test_wilson_never_leaves_0_1():
    lo, hi = S.wilson_ci(10, 10)
    assert hi == pytest.approx(1.0) and lo > 0.6


def test_clustered_se_equals_naive_when_each_case_is_its_own_cluster():
    x = [1, 0, 1, 1, 0, 1, 1, 1]
    naive = math.sqrt(sum((v - sum(x) / 8) ** 2 for v in x) / 8 / 8)
    assert S.clustered_se(x, [str(i) for i in range(8)]) == pytest.approx(naive)


def test_clustered_se_grows_when_clusters_move_together():
    x = [1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0]
    together = S.clustered_se(x, list("aaabbbcccddd"))
    apart = S.clustered_se(x, [str(i) for i in range(12)])
    assert together > apart * 1.5


def test_pass_hat_k_known_value():
    # 4 次里成功 3 次:连续 2 次都成功的概率 = C(3,2)/C(4,2) = 0.5
    assert S.pass_hat_k({"t": [1, 1, 1, 0]}, 2) == pytest.approx(0.5)
    assert S.pass_at_k({"t": [1, 1, 1, 0]}, 2) == pytest.approx(1.0)


def test_required_n_matches_miller_example():
    # Miller 2024:ω² = 1/9、δ = 3 个点、α=0.05、功效 80% 时约 969 题
    assert S.required_n(0.03, 1 / 9) == pytest.approx(969, abs=2)


def test_mcnemar_ignores_agreements():
    a = [1] * 50 + [0] * 5
    b = [1] * 50 + [1] * 5
    r = S.mcnemar(a, b)
    assert r["b_only"] == 5 and r["a_only"] == 0 and r["p_value"] < 0.07
```

`python -m pytest -q tests/test_stats.py` 7 个全过。顺便说一个写测试时踩的小坑:第一版断言写的是 `hi == 1.0`,结果 Wilson 上限算出来是 0.9999999999,浮点误差让测试挂了。统计代码里比较浮点数,一律用 `pytest.approx`。

## 怎么跟 PM 和老板说

统计结果最后要变成一句人话。我自己用的几个模板:

- 显著提升:「v2 比 v1 高 4.2 个点,95% 区间 1.1 到 7.3 个点,可以比较有把握地说是真的变好了。」
- 没有结论:「v2 高了 1.1 个点,但这个评测集只能检测出 6 个点以上的变化,所以我们没法判断。如果这个改动很重要,我们需要把评测集扩到 700 条左右,大约多花两天。」
- 没变差:「没有证据显示 v2 更差(区间下限 −1.2 个点),改动是为了降成本,所以建议合并。」

注意第二句的写法:不说「没效果」,而是说「我们测不出来」,并且给出要花多少代价才能测出来。让决策者自己权衡,这是资深工程师该有的姿态。

## 动手练习

1. 把 `agentops/evals/stats.py` 和测试放进 AgentOps 仓库,`pytest` 全部通过。
2. 拿 Day 50/51 SupportPilot 两个版本(比如 v1 和 v2-e)的真实评测结果,按场景聚类,输出:两个版本各自的 Wilson 区间和聚类标准误、配对差值的区间(正态近似和按簇 bootstrap 各一个)、McNemar 的新挂/新修数量和 p 值。
3. 对同一个版本,每题跑 5 次,算出总分在「每题 1 次」和「每题 5 次平均」两种做法下的抖动大小(可以把 5 次运行两两组合估计)。
4. 用你的数据估计 ω²,画出 MDE 随评测集大小变化的表,算出要检测 3 个点的提升需要多少题。
5. 用上面「怎么跟 PM 说」的模板,写一段 MR 评论,解释 Day 51 某一次改动到底有没有用。

**验收标准**:所有数字都来自真实运行;报告里每个分数都带区间和样本量(含簇数);你能用一句话说清楚你的评测集最小能检测出多大的变化。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 标准误(SE) | 估计值的波动大小。通过率的标准误随样本量的平方根下降 |
| Wilson 区间 | 比例的置信区间,在 p 接近 0 或 1、样本少时比 Wald 区间可靠 |
| 聚类标准误 | 考虑了「同簇样本相关」的标准误,一般比普通标准误大 |
| 配对比较 | 两个版本在同一批题上比较时,先逐题做差再统计 |
| McNemar 检验 | 只看两个版本结果不一致的那些题的配对检验 |
| bootstrap | 通过有放回重抽样估计统计量分布的方法,不依赖正态假设 |
| pass^k | 同一题连续 k 次都成功的概率,衡量稳定性 |
| 功效(power) | 真实存在某个差异时,能检测出来的概率 |
| MDE | 最小可检测差异:在给定 α 和功效下能可靠检测的最小提升 |
| 多重比较 | 同时检验很多指标时,至少一个「假显著」的概率会大大增加 |

## 常见误区

**两个区间重叠就是没差别。** 两个独立区间重叠不能推出差值不显著,反过来也不行。比较两个版本,要直接算差值的区间,而且要配对。

**180 条用例就是 180 个独立样本。** 同场景的多种说法、同文档的多道题都是相关的,要用聚类标准误,并在报告里写簇数。

**区间跨零就说明改动没用。** 跨零只说明「没能证明有用」。如果评测集的 MDE 是 6 个点,一个真实 3 个点的提升也会跨零。结论里要带上 MDE。

**调低 temperature 让评测更稳定。** 稳定了,但评的不是线上那个 Agent。用重复采样降方差。

**对着报告找哪个模块涨了。** 看的指标越多,越容易碰到假显著。事先定主指标,其余当参考,必要时做多重比较校正。

**pass@k 越高越好。** 对客服这种要求每次都对的场景,该看 pass^k。同一批结果 pass@8 可以是 100%,pass^8 只有 37%。

## 学习资料

### 文档与文章

- [Evan Miller · Adding Error Bars to Evals](https://arxiv.org/abs/2411.00640):今天的理论主线,14 页,五条建议(报标准误、聚类、重复采样、配对、功效分析)都有公式和例子,通读约 1.5 小时。HTML 版更好读。
- [Anthropic · A statistical approach to model evaluations](https://www.anthropic.com/research/statistical-approach-to-model-evals):上面论文的科普版,先读这篇再读论文,约 20 分钟。
- [Madaan 等 · Quantifying Variance in Evaluation Benchmarks](https://arxiv.org/abs/2406.10229):系统测量了各种公开 benchmark 的随机种子方差,能帮你建立「分数本身会抖多少」的直觉,读结论部分即可。
- [Wikipedia · Binomial proportion confidence interval](https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval):Wald、Wilson、Clopper-Pearson 等区间的对比,查公式用。
- [Wikipedia · McNemar's test](https://en.wikipedia.org/wiki/McNemar%27s_test):检验的定义和精确版本。
- [SciPy · stats.binomtest](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.binomtest.html) 和 [stats.bootstrap](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html):今天代码里用到的库函数文档,想用库自带的 bootstrap(支持 BCa 区间)可以看后者。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV14PtwziE6S&autoplay=0&high_quality=1" title="人话统计学概念：置信区间！" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>DataCafe · 人话统计学概念:置信区间! · 5 分钟,统计基础薄的同学先看这个,建立「区间在说什么」的直觉。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1vr421M75j&autoplay=0&high_quality=1" title="【小白学统计】Power功效分析及样本量计算，实验设计如何确定最小样本量？假设检验中的两类错误，Power功效分析专用软件分享" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>小白在学统计 ·【小白学统计】Power 功效分析及样本量计算 · 11 分钟,讲两类错误和样本量的关系,对应今天第六件事。</figcaption>
</figure>

- DataCafe · 彻底搞懂P值:P<0.05到底在告诉我们什么?(BV1CJagzwEHJ):4 分钟,纠正几个常见的 p 值误读。
- 深圳麦粮 · 统计学与质量041 - McNemar检验与卡帕系数(Kappa)(BV1s7411B7Dj):11 分钟,McNemar 和明天要用的 kappa 一起讲了。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/TqOeMYtOc1w" title="Confidence Intervals, Clearly Explained!!!" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>StatQuest with Josh Starmer · Confidence Intervals, Clearly Explained!!! · 7 分钟,用 bootstrap 的方式解释置信区间,和今天的 bootstrap 一节正好对上。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/jsvBxkvTyQg" title="9.4 ML Confidence Intervals via Normal Approximation (L09 Model Eval 2: Confidence Intervals)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Sebastian Raschka · 9.4 ML Confidence Intervals via Normal Approximation · 16 分钟,从机器学习模型评估的角度讲正态近似区间,他这一章后面几集还讲了 McNemar 和 bootstrap,感兴趣可以接着看。</figcaption>
</figure>

### 书籍

- Peter Bruce、Andrew Bruce、Peter Gedeck《Practical Statistics for Data Scientists》(第 2 版,O'Reilly,2020):第 2 章「Data and Sampling Distributions」讲标准误和 bootstrap,第 3 章「Statistical Experiments and Significance Testing」讲假设检验、多重比较和功效,写给工程师的统计书,读这两章约 4 小时。
- Ron Kohavi 等《Trustworthy Online Controlled Experiments》(Cambridge University Press,2020):第 17 章「The Statistics behind Online Controlled Experiments」,和 Day 71 一起读。

### 开源项目与代码

- 今天的 `agentops/evals/stats.py`、`tests/test_stats.py`、`data/report.py`:放进 AgentOps 仓库。
- [SciPy](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html):`scipy.stats.bootstrap` 支持 BCa 区间和配对数据,可以和今天手写的按簇 bootstrap 对照。

## 自测

1. 20 条回归用例全部通过,能不能说回归集的通过率是 100%?应该怎么报告?

<details><summary>答案</summary>

不能。20 条全过时 Wilson 区间是 83.9% 到 100%,真实通过率可能低到 84%。应该报告「20/20 通过,95% 区间 84%~100%」。如果需要更强的保证,要么增加用例,要么每条多跑几次。

</details>

2. 为什么「场景 × 说法」结构的评测集要用聚类标准误?不用会怎样?

<details><summary>答案</summary>

同一场景的几种说法结果高度相关(Agent 不懂某条规则,换种问法也会错),180 条用例里的独立信息远少于 180。不用聚类标准误会低估不确定性,区间偏窄,容易把随机波动当成真实提升。我们的数据里聚类标准误是普通标准误的 1.38 倍。

</details>

3. 配对比较为什么能让区间变窄?在什么情况下配对的收益最大?

<details><summary>答案</summary>

两个版本跑同一批题,题目难度带来的差异在两个版本里同时存在,逐题做差就消掉了。公式上 SE(配对) = √(SE_A² + SE_B² − 2·SE_A·SE_B·Corr),两个版本在同一题上的结果越相关,减掉的越多。大部分题两个版本结果一样时收益最大,我们的数据里标准误从 4.4 个点降到 2.1 个点。

</details>

4. 每题重复跑 K 次能消掉什么不确定性?不能消掉什么?

<details><summary>答案</summary>

能消掉同一题重跑的随机性(模型采样、工具时序带来的抖动),我们的模拟里从每题 1 次的 3 个点标准差降到每题 5 次的 1.3 个点。不能消掉题目抽样本身的不确定性,也就是「你的题只是所有可能工单的一个样本」。所以收益有上限,K 一般取 3 到 5。

</details>

5. 资深面试题:你说你的改动让 Agent 的任务成功率提升了 3 个点。面试官问:你怎么证明这不是噪声?

<details><summary>答案</summary>

从几个层面回答。一,比较方法:两个版本在同一批题上做配对比较,给出差值的 95% 区间,而不是各自的分数;评测集有场景聚类,用聚类标准误或按簇 bootstrap。二,随机性:每题跑多次(比如 5 次)取平均,不靠调低温度。三,功效:事先算过 MDE,说明评测集足够检测 3 个点的变化,比如 700 道以上的配对题;如果不够,会如实说「区间是 X 到 Y,不能排除噪声」。四,具体证据:McNemar 的新挂和新修数量,以及读过新修好那几条的 trace,确认是改动解决的问题。五,只定了一个主指标,没有在很多指标里挑显著的。最后如果条件允许,线上 A/B 再验证一次(Day 71)。

</details>

6. 评测报告里有 12 个指标,v2 在其中一个模块上「显著」提升(p = 0.03),其他都不显著。你怎么解读?

<details><summary>答案</summary>

12 个指标都用 α = 0.05,两个版本完全一样时至少一个假显著的概率约 46%。所以这个结果很可能是多重比较带来的偶然。如果这个模块事先就是改动的目标,并且定为主指标,结论才比较可信;否则要做 Bonferroni 或 Holm 校正(12 个指标时 Bonferroni 阈值约 0.004),0.03 过不了。更好的做法是在新的一批题或线上实验里再验证。

</details>

## 明天预告

Day 70 讲大规模 LLM 评审:校准、一致性、成本。Day 32 我们校准过一个 judge,算了 TPR、TNR 和 kappa。到了每天几千条线上流量都要评审的规模,新问题会冒出来:校正后的通过率本身也有不确定性、多个 judge 投票为什么救不了相关的错误、judge 模型升级之后怎么发现它悄悄变松了。明天会用今天的 Wilson 区间和 bootstrap 把这些都算出来。
