---
title: 'Day 623 · 前沿技术选型报告:打分矩阵和敏感性分析'
description: '这几周看了 Coding Agent、Computer Use、语音、Deep Research、Agent 互联和支付,每样都诱人。资深工程师要回答的是「我们明年该不该做 X」。今天写一份能被别人审、被反驳、半年后能复盘的选型报告:加权打分矩阵,三种检查结论有多脆弱的敏感性分析(其中一种只抖「估计出来的分数」),一个用代码把数字填进报告的生成器,和一个检查报告有没有「先有结论再凑分数」的 lint。'
pubDate: 2026-10-27
regime: none
tags: ['tech-selection', 'decision-making', 'sensitivity-analysis', 'python', 'agent-zero']
series: 'agent-zero'
day: 623
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 622](/blog/agent-zero/day-622-week89-review/) 把本周的六天串成了「一个动作要过几道门才能做出去」,默写了钱包授权框和放权梯子,又拼了一个退款加回复的动作闸门,用五条不变量跑两千轮随机操作,抓到了闸门里我自己写的几处 bug。

这几周讲过的东西太多:[Coding Agent](/blog/agent-zero/day-604-coding-agents-1/)、[Computer Use](/blog/agent-zero/day-606-computer-use-1/)、[语音](/blog/agent-zero/day-610-voice-1/)、[Deep Research](/blog/agent-zero/day-612-deep-research-1/)、[Agent 互联](/blog/agent-zero/day-614-a2a-1/)、[支付](/blog/agent-zero/day-617-payments-1/)。每一样单独拿出来都能写一份「我们也该做」的提案。可是团队的人手和预算是固定的。今天讲怎么在这些选项里做取舍,并且把理由写成别人能审的东西。

## 今天要解决的问题

学完今天你应该能:

1. 写出一份结构完整的技术选型报告:背景、选项、标准和权重、证据、建议、风险、敏感性、复盘条件。
2. 用加权打分矩阵比较选项,并用三种敏感性分析判断结论稳不稳:单个权重变一变、权重一起抖、只抖估计出来的分数。
3. 说出一份报告里哪些格子有实测依据、哪些只是估计,并找出「最值得先去实测的那一格」。
4. 用代码把矩阵结果自动填进报告,再用一个 lint 检查报告有没有「没有不做选项」「全是估计」这类毛病。

今天两个新概念:**选型报告(加权打分矩阵)**和**敏感性分析**。预计用时 3 小时,有一次真模型调用(30 次流式请求量首 token 延迟,约 ¥0.004)。前置:[Day 610](/blog/agent-zero/day-610-voice-1/) 和 [Day 611](/blog/agent-zero/day-611-voice-2/)(语音延迟预算和过渡语,今天的例子要用它们的数字)、[Day 135](/blog/agent-zero/day-135-llm-client-1/) 起建的 `common/llm.py`(量延迟要用)、[Day 50](/blog/agent-zero/day-050-dataclass/)(dataclass)。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `decision_matrix.py` 里的 `weighted` 和 `score_jitter`;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 为什么要写选型报告

你做前端的时候一定经历过技术选型会:状态管理用 Redux、Zustand 还是干脆不引入,构建工具换不换 Vite。会议上最常听到的论据是「某某公司在用」「这个最近很火」「我试了一下挺顺手」。这几句话本身没错,问题是它们没法被反驳,也没法在半年后回头检查「当时的判断对不对」。

选型报告要解决的就是这两件事:**让别人能挑出你哪里错了,让半年后的自己能知道当时依据什么**。一份报告至少要有这八部分:

1. **背景和要解决的问题**:业务上的痛点是什么,用数字说话。「客服电话每月 4 万通,其中三成是查退款和发票进度」比「语音很火」强一百倍。
2. **选项**:至少三个,其中一个必须是「不做或者晚点做」。没有这个选项的报告,结论多半是写之前就定好的。回到前端的例子,「不引入状态管理库,继续用 Context」就是那个选项。
3. **标准和权重**:先定标准再打分,权重要和相关方一起定,并写下为什么这么定。
4. **证据**:每个分数背后的依据。能实测的实测(做个原型、跑个评测),不能实测的标明是估计。
5. **建议和理由**:选哪个,为什么,以及**为什么不选其他的**。
6. **风险和缓解**:最可能出错的三件事,出了怎么办。
7. **敏感性**:结论在多大程度上依赖某个假设。改一个权重结论就翻了,要老实写出来。
8. **复盘条件**:什么情况下要重新评估。「首音频 P95 小于 1.5 秒」这种有数字的才算,「效果不好就重来」不算。

第 8 条最容易被忽略,它决定这份报告是一份活文档还是一次性的会议材料。[Day 640](/blog/agent-zero/day-640-design-docs-1/) 讲设计文档时会再展开,[Day 543](/blog/agent-zero/day-543-design-doc-2/) 已经示范过一份。

## 打分矩阵怎么算

先把算法说清楚,再写代码。打分矩阵就是一张表:行是选项,列是标准,每一格是一个 1 到 5 的分数(越高越好,所以「风险」和「成本」也按「风险越低、成本越低分越高」来打)。每个标准有一个权重,权重加起来是 1。一个选项的加权得分,就是它每一格的分数乘以那一列的权重,再加起来。

一个小例子。两个选项 A 和 B,两个标准:价值权重 0.5、风险权重 0.5。A 价值 5 分、风险 2 分;B 价值 2 分、风险 4 分。A 的得分是 5 × 0.5 + 2 × 0.5 = 3.5,B 是 2 × 0.5 + 4 × 0.5 = 3.0,A 领先。

这个数看着很精确,其实非常脆弱,因为它同时依赖两样东西:**权重**(你有多看重价值,多看重风险)和**分数**(A 的风险真的是 2 分吗,凭什么)。所以光算出一个数没有意义,还得回答「这个结论经得起多大的摇晃」。这就是敏感性分析:把权重或分数晃一晃,看第一名会不会换人。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="敏感性分析的三种晃法:单个权重晃一晃,所有权重一起随机抖,只抖估计出来的分数,实测的分数不动">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
  <text x="20" y="24" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">三种晃法,每一种回答一个不同的问题</text>
  <rect x="20" y="40" width="190" height="130" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="115" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">单个权重 ±50%</text>
  <text x="32" y="88" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">一次只动一个权重</text>
  <text x="32" y="108" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">第一名换人了吗?</text>
  <text x="32" y="140" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">会换的权重,就是开会</text>
  <text x="32" y="156" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">要重点对齐的地方</text>
  <rect x="225" y="40" width="190" height="130" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="320" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">权重一起随机抖</text>
  <text x="237" y="88" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">每个权重 ×0.5 到 ×1.5</text>
  <text x="237" y="108" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">抖 5000 次,数谁拿第一</text>
  <text x="237" y="140" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">问的是:大家对「看重什么」</text>
  <text x="237" y="156" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">的分歧,会不会翻盘</text>
  <rect x="430" y="40" width="190" height="130" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="525" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">只抖估计的分数</text>
  <text x="442" y="88" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">估计的格子 ±1 分</text>
  <text x="442" y="108" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">实测的格子不动</text>
  <text x="442" y="140" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">问的是:我们拍脑袋打的</text>
  <text x="442" y="156" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">分数,错了会怎样</text>
  <text x="320" y="204" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">评审会上被质疑最多的是第三种:分数,不是权重的数学</text>
  <text x="320" y="226" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">所以每个格子要标明是实测还是估计,估计的才需要晃</text>
</svg>
<figcaption>三种敏感性分析。前两种晃的是权重,第三种晃的是分数,而且只晃那些没有实测依据的分数。今天的代码三种都写。</figcaption>
</figure>

## 第 1 步:矩阵和三种晃法

下面这个文件是今天的核心。和旧版常见写法比,它有一个小改动:每一格不只是一个数,而是 `Score(value, kind, why)`,**带着「是实测还是估计」和「依据是什么」**。这个改动是第三种晃法的前提。

```python
# agent-zero-lab/part10/selection/decision_matrix.py
"""选型用的加权打分矩阵,外加三种「这个结论有多脆弱」的检查:
1) 单个权重上下浮动,第一名会不会换人;2) 权重一起随机抖,每个方案赢的概率;
3) 只抖「估计出来的分数」(实测的分数不动),每个方案赢的概率。"""
import random
from dataclasses import dataclass, replace


@dataclass(frozen=True)
class Criterion:
    name: str
    weight: float


@dataclass(frozen=True)
class Score:
    value: int
    kind: str  # "measured" 有实测依据,"estimate" 只是估计
    why: str


Scores = dict[str, dict[str, Score]]


def weighted(scores: Scores, criteria: list[Criterion]) -> dict[str, float]:
    total = sum(c.weight for c in criteria)
    return {opt: round(sum(s[c.name].value * c.weight for c in criteria) / total, 3) for opt, s in scores.items()}


def winner(scores: Scores, criteria: list[Criterion]) -> str:
    w = weighted(scores, criteria)
    return max(w, key=lambda o: w[o])


def one_at_a_time(scores: Scores, criteria: list[Criterion], swing: float = 0.5) -> list[str]:
    """每个权重单独乘以 (1±swing),报告哪些会让第一名换人。"""
    base = winner(scores, criteria)
    flips: list[str] = []
    for i, c in enumerate(criteria):
        for f in (1 - swing, 1 + swing):
            changed = criteria[:i] + [replace(c, weight=c.weight * f)] + criteria[i + 1:]
            top = winner(scores, changed)
            if top != base:
                flips.append(f"{c.name} 权重 ×{f:g}:第一名从「{base}」变成「{top}」")
    return flips


def weight_jitter(scores: Scores, criteria: list[Criterion], n: int = 5000, seed: int = 7) -> dict[str, float]:
    """所有权重同时在原值的 0.5 到 1.5 倍之间随机抖,统计每个方案拿第一的比例。"""
    rng = random.Random(seed)
    wins = {o: 0 for o in scores}
    for _ in range(n):
        jittered = [replace(c, weight=c.weight * rng.uniform(0.5, 1.5)) for c in criteria]
        wins[winner(scores, jittered)] += 1
    return {o: round(k / n, 3) for o, k in wins.items()}


def score_jitter(scores: Scores, criteria: list[Criterion], n: int = 5000, seed: int = 7, delta: int = 1) -> dict[str, float]:
    """只动「估计」的分数:每格随机加减 0 到 delta 分(限制在 1 到 5),实测的分数不动。"""
    rng = random.Random(seed)
    wins = {o: 0 for o in scores}
    for _ in range(n):
        shaken: Scores = {
            o: {
                c: s if s.kind == "measured" else replace(s, value=min(5, max(1, s.value + rng.randint(-delta, delta))))
                for c, s in row.items()
            }
            for o, row in scores.items()
        }
        wins[winner(shaken, criteria)] += 1
    return {o: round(k / n, 3) for o, k in wins.items()}


def measured_share(scores: Scores, criteria: list[Criterion]) -> dict[str, float]:
    """每个方案的加权总分里,有多大比例来自有实测依据的格子。"""
    total = sum(c.weight for c in criteria)
    return {
        o: round(sum(row[c.name].value * c.weight for c in criteria if row[c.name].kind == "measured") /
                 (sum(row[c.name].value * c.weight for c in criteria)), 3)
        for o, row in scores.items()
        if total
    }


def cell_flips(scores: Scores, criteria: list[Criterion], delta: int = 1) -> list[str]:
    """逐格检查:只把某一个「估计」的格子加或减 delta 分,第一名会不会换人。会换的格子就是最值得先去实测的格子。"""
    base = winner(scores, criteria)
    out: list[str] = []
    for o, row in scores.items():
        for c, s in row.items():
            if s.kind == "measured":
                continue
            for d in (-delta, delta):
                v = s.value + d
                if not 1 <= v <= 5:
                    continue
                changed = {**scores, o: {**row, c: replace(s, value=v)}}
                top = winner(changed, criteria)
                if top != base:
                    out.append(f"「{o}」的「{c}」从 {s.value} 改成 {v}:第一名变成「{top}」")
    return out
```

<div class="line-notes">

- `import random` 标准库的随机数,两种随机抖动都要用。
- `from dataclasses import dataclass, replace` `replace` 是 dataclass 自带的「复制一份,改其中几个字段」。因为下面的类都是 `frozen=True`(创建后不能改),要「改」一个权重就得复制一份新的。相当于 JS 里 `{ ...c, weight: 0.15 }`。
- `@dataclass(frozen=True)` 加上 `frozen=True`,对象创建后改字段会直接报错,避免打分时不小心改了原始数据。
- `class Criterion:` 一个标准:名字和权重。`Criterion("业务价值", 0.30)`。
- `kind: str  # "measured" 有实测依据,"estimate" 只是估计` 这一格的来历。只有两个取值,我没有用 `Literal` 或枚举,先用字符串,够简单。
- `why: str` 一句依据,写进报告的「证据」一节。
- `Scores = dict[str, dict[str, Score]]` 类型别名。外层 key 是选项名,内层 key 是标准名。相当于 TS 的 `type Scores = Record<string, Record<string, Score>>`。
- `total = sum(c.weight for c in criteria)` 权重之和。权重抖动以后不再等于 1,所以每次都重新算,再除掉,保证得分仍在 1 到 5 之间。
- `return {opt: round(sum(s[c.name].value * c.weight for c in criteria) / total, 3) for opt, s in scores.items()}` 字典推导式。对每个选项,把每个标准的分数乘权重加起来,除以权重总和,保留三位小数。代入 A:5×0.3 + 3×0.2 + 4×0.15 + 2×0.2 + 2×0.15 = 3.4。
- `def winner(scores: Scores, criteria: list[Criterion]) -> str:` 返回得分最高的选项名。
- `return max(w, key=lambda o: w[o])` `max` 在字典上默认比 key,这里传 `key=` 改成比 value,取出分最高的那个选项名。相当于 JS 里按值取最大的 key。
- `base = winner(scores, criteria)` 第一种晃法先记下原来的第一名。
- `for i, c in enumerate(criteria):` `enumerate` 同时给下标和元素。要下标是为了下一行把第 `i` 个标准换掉。
- `for f in (1 - swing, 1 + swing):` 每个权重各试两次:乘 0.5 和乘 1.5。
- `changed = criteria[:i] + [replace(c, weight=c.weight * f)] + criteria[i + 1:]` 把第 `i` 个标准换成改过权重的副本,前后原样拼回去。切片 `[:i]` 取前 i 个,`[i + 1:]` 取 i 之后的,相当于 JS 的 `slice(0, i)` 和 `slice(i + 1)`。
- `flips.append(f"{c.name} 权重 ×{f:g}:第一名从「{base}」变成「{top}」")` 翻盘了就记一句人话。`{f:g}` 把 0.5 显示成 `0.5`,不带多余的 0。
- `rng = random.Random(seed)` 独立的随机数生成器,固定种子 7,每次跑结果一样,方便你对照文章。
- `wins = {o: 0 for o in scores}` 每个选项拿第一的次数,先都是 0。
- `jittered = [replace(c, weight=c.weight * rng.uniform(0.5, 1.5)) for c in criteria]` 每个权重各自乘一个 0.5 到 1.5 之间的随机数。「一起抖」的意思是五个权重同时被抖,不是一个一个。
- `wins[winner(scores, jittered)] += 1` 这一轮谁赢了,谁的次数加一。
- `return {o: round(k / n, 3) for o, k in wins.items()}` 次数除以 5000 得到比例。
- `def score_jitter(` 第三种晃法。和上一个函数的区别在循环里面。
- `shaken: Scores = {` 每一轮造一份「被晃过」的新矩阵,不改原来的。三层嵌套的字典推导,从外往里读:每个选项 `o`,每个标准 `c`,每一格 `s`。
- `c: s if s.kind == "measured" else replace(s, value=min(5, max(1, s.value + rng.randint(-delta, delta))))` **今天的关键一行**。实测的格子原样保留;估计的格子加上一个 -1 到 +1 的随机整数,再用 `max(1, ...)` 和 `min(5, ...)` 夹在 1 到 5 之间。`randint(-1, 1)` 两头都包含,可能是 -1、0、1。
- `def measured_share(` 每个选项的总分里有多大比例来自实测的格子。越低说明这个选项的得分越靠估计。
- `if row[c.name].kind == "measured")` 只累加实测格子的「分数乘权重」,除以全部格子的「分数乘权重」。代入 A:只有技术成熟度一格是实测,3×0.2 = 0.6,除以 3.4 得 17.6%。
- `def cell_flips(` 第四个小工具,逐格检查。
- `if s.kind == "measured":` 实测的格子跳过,不去怀疑它。
- `if not 1 <= v <= 5:` Python 允许链式比较,`1 <= v <= 5` 就是 JS 的 `v >= 1 && v <= 5`。越界的跳过。
- `changed = {**scores, o: {**row, c: replace(s, value=v)}}` 字典展开,和 JS 的 `{...scores, [o]: {...row, [c]: ...}}` 一样:原矩阵,只把选项 `o` 的标准 `c` 那一格换掉。
- `out.append(f"「{o}」的「{c}」从 {s.value} 改成 {v}:第一名变成「{top}」")` 只记会翻盘的格子。这个列表是空的,说明没有任何一个估计格子「单独错一点」就能推翻结论。

</div>

三种晃法里随机的那两种用 5000 次,固定种子。这里有个值得想一下的问题:为什么是随机抖而不是把所有组合都试一遍?因为五个权重、每个连续取值,组合是无穷多的;随机抽 5000 个,足够看出「大致多大比例」,而且代码只要十几行。这种「用随机试验估计概率」的办法叫蒙特卡洛(Monte Carlo),名字很吓人,做的事就是掷骰子数次数。

## 第 2 步:语音客服的例子

回到场景。云簿(CloudLedger,虚构公司)的老板问:明年要不要做语音客服 Agent?三个选项:A 现在就全量做,B 文字渠道为主、语音只试点两类工单,C 明年不做。标准和权重:业务价值 30%、技术成熟度 20%、团队能力匹配 15%、风险与合规 20%、成本 15%。风险权重给得不低,因为电话里误操作和录音合规出了事,影响面比文字大。

分数怎么来?我要把每一格的「是实测还是估计」老实标出来。技术成熟度这一格我有真数据:[Day 610](/blog/agent-zero/day-610-voice-1/) 的延迟预算表里,除了 LLM 首 token 之外的几段(VAD 静音等待 500、ASR 150、网络 80、攒第一句 100、TTS 首包 200)加起来是 1030 毫秒;LLM 首 token 那一段,我今天重新量一遍。

### 先量:DeepSeek 首 token 延迟

```python
# agent-zero-lab/part10/selection/measure_ttft.py
"""给选型报告里「技术成熟度」那一格找一条实测依据:DeepSeek 流式首 token 延迟,30 次,看 P50 和 P95。"""
import statistics
import sys

from common.llm import LLMClient

N = int(sys.argv[1]) if len(sys.argv) > 1 else 30
MESSAGES = [
    {"role": "system", "content": "你是电话客服。回答不超过 20 个字。"},
    {"role": "user", "content": "我上个月被重复扣款了,怎么办?"},
]

llm = LLMClient()
ttfts: list[float] = []
for i in range(N):
    for _ in llm.stream(MESSAGES):
        pass
    t = llm.last.ttft
    assert t is not None  # 流式调用一定有首 token 时间
    ttfts.append(t)
    print(f"第 {i + 1} 次 ttft={t:.3f}s")

ttfts.sort()
p50 = statistics.median(ttfts)
p95 = ttfts[min(len(ttfts) - 1, int(len(ttfts) * 0.95))]
print(f"{N} 次:最快 {ttfts[0]:.3f}s  P50 {p50:.3f}s  P95 {p95:.3f}s  最慢 {ttfts[-1]:.3f}s")
print(f"账本:{llm.ledger.calls} 次调用 | 输入 {llm.ledger.prompt_tokens} / 输出 {llm.ledger.completion_tokens} tokens | 约 ¥{llm.ledger.cost:.4f}")
```

<div class="line-notes">

- `import statistics` 标准库的统计模块,用它的 `median` 求中位数。
- `from common.llm import LLMClient` Day 135 起建的 LLM 客户端,`stream()` 逐段产出文本,结束后 `llm.last.ttft` 是这次的首 token 时间。
- `N = int(sys.argv[1]) if len(sys.argv) > 1 else 30` 命令行可以传次数,不传就是 30。`sys.argv[0]` 是脚本名,所以参数从下标 1 起。
- `{"role": "system", "content": "你是电话客服。回答不超过 20 个字。"},` 电话场景的回答要短,每次问的内容完全一样,这样波动全来自网络和服务端,不是内容。
- `llm = LLMClient()` 读 `.env` 里的 `LLM_*` 配置,我这里是 `deepseek-flash`,关了思考。
- `for _ in llm.stream(MESSAGES):` 把流读完。循环体只写 `pass`,因为只要首 token 时间,不要内容。
- `assert t is not None  # 流式调用一定有首 token 时间` `ttft` 的类型是 `float | None`,断言一下让类型检查器放心。
- `ttfts.sort()` 排序,下面取分位数要用。
- `p95 = ttfts[min(len(ttfts) - 1, int(len(ttfts) * 0.95))]` 排好序后取第 95% 的位置。30 个数里 `int(30 * 0.95)` 是 28,取下标 28,也就是第 29 小的数。
- `print(f"账本:{llm.ledger.calls} 次调用` `LLMClient` 自带账本,记了调用次数、token 数和花费(元)。

</div>

```bash
uv run python -m part10.selection.measure_ttft 30
```

输出(最后两行,前面 30 行每次一行):

```text
30 次:最快 0.426s  P50 0.696s  P95 1.080s  最慢 1.229s
账本:30 次调用 | 输入 810 / 输出 344 tokens | 约 ¥0.0044
```

30 次里,P50(中位数)0.696 秒,P95 1.080 秒,最慢 1.229 秒。花费 ¥0.0044,按 `.env` 里 `LLM_PRICE=0.04,2,8`(元每百万 token,缓存命中、未命中、输出)算:810 个输入 token 约 ¥0.0016,344 个输出 token 约 ¥0.0028,合计 ¥0.0044,对得上。这是我在北京家庭宽带直连 DeepSeek 的数字,你的会不一样。

用它填预算:其余几段 1030 毫秒,加上 LLM 首 token 的 P95 1080 毫秒,约 2.1 秒,远超 1.5 秒的 P95 目标(这里把两个 P95 直接相加,偏悲观,但方向不会错)。[Day 611](/blog/agent-zero/day-611-voice-2/) 的模拟里,加了过渡语以后 P95 能压到 1.97 秒,仍然超过 1.5。所以「现在就全量做语音」的技术成熟度,我打 3 分,**并且标成实测**。其余的格子我都没有实测,诚实地标「估计」。

### 把数字填进矩阵

```python
# agent-zero-lab/part10/selection/voice_decision.py
"""示例:「明年要不要做语音客服 Agent」。CloudLedger 是虚构公司,电话量和分数里的估计部分是示例,你要用自己团队的数据重填。"""
from part10.selection.decision_matrix import (
    Criterion, Score, Scores, cell_flips, measured_share, one_at_a_time, score_jitter, weight_jitter, weighted,
)

CRITERIA = [
    Criterion("业务价值", 0.30),
    Criterion("技术成熟度", 0.20),
    Criterion("团队能力匹配", 0.15),
    Criterion("风险与合规", 0.20),
    Criterion("成本", 0.15),
]

A, B, C = "A 现在就全量做语音", "B 文字为主加语音试点", "C 明年不做"


def est(v: int, why: str) -> Score:
    return Score(v, "estimate", why)


SCORES: Scores = {
    A: {
        "业务价值": est(5, "每月约 4 万通电话(示例数字),全量接住最多"),
        "技术成熟度": Score(3, "measured", "首 token P95 实测 1.08s(30 次),其余环节取 Day 610 预算表 1.03s,合计超过 1.5s 的目标"),
        "团队能力匹配": est(4, "评测、工具、审批能复用,电话线路和 ASR 是新的"),
        "风险与合规": est(2, "录音告知、误操作、外呼规定,全量面最大"),
        "成本": est(2, "ASR、TTS、线路按分钟计费,全量最贵"),
    },
    B: {
        "业务价值": est(3, "只覆盖查退款进度、查发票两类,约占电话量三成(示例)"),
        "技术成熟度": est(4, "两类问答短,Day 611 的模拟里配过渡语 P95 1.97s,没在真线路上测过"),
        "团队能力匹配": est(5, "完全复用 SupportPilot 现有评测和审批"),
        "风险与合规": est(4, "试点范围小,两类都是只读"),
        "成本": est(4, "试点量小"),
    },
    C: {
        "业务价值": est(1, "没有新增价值"),
        "技术成熟度": est(5, "不涉及"),
        "团队能力匹配": est(3, "不涉及,但团队学不到语音经验"),
        "风险与合规": est(5, "没有新风险"),
        "成本": est(5, "没有新成本"),
    },
}

if __name__ == "__main__":
    print("加权得分:", weighted(SCORES, CRITERIA))
    print("实测分数占比:", measured_share(SCORES, CRITERIA))
    flips = one_at_a_time(SCORES, CRITERIA)
    print("单因素 ±50%:", flips if flips else "没有任何一个权重能让第一名换人")
    print("权重一起抖:", weight_jitter(SCORES, CRITERIA))
    print("估计分数 ±1:", score_jitter(SCORES, CRITERIA))
    print("估计分数 ±2:", score_jitter(SCORES, CRITERIA, delta=2))
    for d in (1, 2):
        cf = cell_flips(SCORES, CRITERIA, d)
        print(f"逐格 ±{d}:", *(cf if cf else ["没有任何一格能单独翻盘"]), sep="\n  ")
```

<div class="line-notes">

- `from part10.selection.decision_matrix import (` 括号里的导入可以换行写,每行一串,最后有个逗号也没事。
- `CRITERIA = [` 五个标准和权重。0.30 + 0.20 + 0.15 + 0.20 + 0.15 = 1.00。
- `A, B, C = "A 现在就全量做语音", "B 文字为主加语音试点", "C 明年不做"` 一次给三个变量赋值。选项名里不放逗号,下面报告里要用逗号分隔。
- `def est(v: int, why: str) -> Score:` 一个小帮手,省得每格都写 `Score(v, "estimate", ...)`。
- `SCORES: Scores = {` 整张矩阵。每个选项一个字典,每个标准一个 `Score`。
- `"业务价值": est(5, "每月约 4 万通电话(示例数字),全量接住最多"),` A 的业务价值 5 分,是估计,依据是电话量(示例数字)。
- `"技术成熟度": Score(3, "measured", "首 token P95 实测 1.08s(30 次)` **整张表里唯一一个实测格子**,3 分。依据写进 `why`,报告里会原样出现。
- `"团队能力匹配": est(5, "完全复用 SupportPilot 现有评测和审批"),` B 的团队匹配最高,因为不用学新东西。
- `"风险与合规": est(5, "没有新风险"),` C 的风险最低,因为它什么都不做。注意「不做」这一行大多数格子是 5 分,它就是靠这个拿到 3.5 分的,下面会看到它是 B 最大的对手。
- `print("加权得分:", weighted(SCORES, CRITERIA))` 三个选项的加权得分。
- `print("实测分数占比:", measured_share(SCORES, CRITERIA))` 每个选项的分数有多少来自实测。
- `print("单因素 ±50%:", flips if flips else "没有任何一个权重能让第一名换人")` `flips` 是空列表时 `if flips` 为假,走 else。相当于 JS 的 `flips.length ? flips : "..."`。
- `print("估计分数 ±2:", score_jitter(SCORES, CRITERIA, delta=2))` 把估计格子晃得更狠:最多错 2 分。
- `for d in (1, 2):` 逐格检查跑两轮,错 1 分和错 2 分。
- `print(f"逐格 ±{d}:", *(cf if cf else ["没有任何一格能单独翻盘"]), sep="\n  ")` 星号 `*` 把列表展开成多个参数,`sep="\n  "` 让每个参数之间换行并缩进两格。相当于 JS 的 `console.log(...list)`,只是分隔符可以改。

</div>

```bash
uv run python -m part10.selection.voice_decision
```

真实输出:

```text
加权得分: {'A 现在就全量做语音': 3.4, 'B 文字为主加语音试点': 3.85, 'C 明年不做': 3.5}
实测分数占比: {'A 现在就全量做语音': 0.176, 'B 文字为主加语音试点': 0.0, 'C 明年不做': 0.0}
单因素 ±50%: 没有任何一个权重能让第一名换人
权重一起抖: {'A 现在就全量做语音': 0.023, 'B 文字为主加语音试点': 0.925, 'C 明年不做': 0.053}
估计分数 ±1: {'A 现在就全量做语音': 0.097, 'B 文字为主加语音试点': 0.758, 'C 明年不做': 0.144}
估计分数 ±2: {'A 现在就全量做语音': 0.19, 'B 文字为主加语音试点': 0.567, 'C 明年不做': 0.243}
逐格 ±1:
  没有任何一格能单独翻盘
逐格 ±2:
  「B 文字为主加语音试点」的「业务价值」从 3 改成 1:第一名变成「C 明年不做」
  「B 文字为主加语音试点」的「技术成熟度」从 4 改成 2:第一名变成「C 明年不做」
  「B 文字为主加语音试点」的「风险与合规」从 4 改成 2:第一名变成「C 明年不做」
  「C 明年不做」的「业务价值」从 1 改成 3:第一名变成「C 明年不做」
```

逐行读这几个数。

**加权得分**:B 3.85、C 3.50、A 3.40。B 领先,但 C(什么都不做)只落后 0.35 分,A 反而垫底。这其实是一个很常见又很有价值的发现:当「做」的方案风险和成本拉得很重时,「不做」会比「全做」得分高。没有 C 这个选项,这个对比根本看不见。

**实测占比**:A 17.6%,B 和 C 是 0。意思是,我们推荐的 B,它那 3.85 分**没有一格是量过的**。这不是说结论错,是说这个结论目前有多少是基于证据、多少是基于判断,一目了然。

**单因素 ±50%**:任何一个权重单独上下浮动一半,第一名都不变。

**权重一起抖**:B 拿第一的比例 92.5%,A 2.3%,C 5.3%。如果只做到这一步,会觉得「结论非常稳,九成多」。旧版的写法大概就停在这里。

**只抖估计分数**:估计的格子最多错 1 分,B 拿第一的比例掉到 75.8%;错 2 分,掉到 56.7%,C 涨到 24.3%,A 涨到 19.0%。这才是结论的真实脆弱程度:权重上的分歧动摇不了它,但我们对 B 的那些「估计」只要有几格偏乐观,第一名就不一定是 B 了。

**逐格检查**:每个估计格子**单独**错 1 分,没有任何一格能翻盘,所以不用担心某一个数字。错 2 分,B 的业务价值(3 到 1)、B 的技术成熟度(4 到 2)、B 的风险与合规(4 到 2),任何一个单独错这么多,第一名就变成 C。这三个格子,就是**最值得先去实测的格子**。B 的技术成熟度正好是我手上最容易量的:找两类工单,在真实的电话录音上量首音频延迟,而不是用模拟器。这比去争论权重有用得多。

## 第 3 步:把数字自动填进报告

报告里的数字如果靠手抄,迟早抄错,或者改了分数忘了改正文。所以用一个生成器,矩阵一变,报告自动跟着变:

```python
# agent-zero-lab/part10/selection/report.py
"""把打分矩阵和敏感性结果自动填进选型报告的八个部分,数字永远和代码算出来的一致,不会手抄错。"""
from dataclasses import dataclass

from part10.selection.decision_matrix import (
    Criterion, Scores, cell_flips, measured_share, one_at_a_time, score_jitter, weight_jitter, weighted, winner,
)


@dataclass
class ReportText:
    title: str
    background: str
    why_not_others: dict[str, str]  # 没选的方案各自为什么不选
    reason: str
    risks: list[str]
    review_conditions: list[str]


def build_report(t: ReportText, scores: Scores, criteria: list[Criterion]) -> str:
    w = weighted(scores, criteria)
    top = winner(scores, criteria)
    lines = [f"# {t.title}", "", "## 1. 背景", t.background, "", "## 2. 选项"]
    lines += [f"- {o}" for o in scores]
    lines += ["", "## 3. 标准和权重", " ".join(f"{c.name} {c.weight:.0%}" for c in criteria), "", "## 4. 证据"]
    for o, row in scores.items():
        for c in criteria:
            s = row[c.name]
            tag = "实测" if s.kind == "measured" else "估计"
            lines.append(f"- {o} / {c.name} = {s.value}({tag}):{s.why}")
    share = measured_share(scores, criteria)
    lines += ["", "加权得分:" + ",".join(f"{o} {v}" for o, v in w.items()),
              "实测分数占比:" + ",".join(f"{o} {v:.0%}" for o, v in share.items()), "", "## 5. 建议和理由",
              f"建议:{top}。{t.reason}"]
    lines += [f"不选「{o}」:{why}" for o, why in t.why_not_others.items()]
    lines += ["", "## 6. 风险和缓解"] + [f"- {r}" for r in t.risks]
    flips = one_at_a_time(scores, criteria)
    wj, sj = weight_jitter(scores, criteria), score_jitter(scores, criteria)
    lines += ["", "## 7. 敏感性",
              "单个权重 ±50%:" + ("第一名都不变" if not flips else ";".join(flips)),
              f"权重一起随机抖 5000 次,{top} 拿第一的比例 {wj[top]:.1%}",
              f"只抖估计分数(±1)5000 次,{top} 拿第一的比例 {sj[top]:.1%}"]
    for d in (2,):
        cf = cell_flips(scores, criteria, d)
        lines.append(f"单格估计错 {d} 分就会翻盘的格子:" + (";".join(cf) if cf else "没有"))
    lines += ["", "## 8. 复盘条件"] + [f"- {c}" for c in t.review_conditions]
    return "\n".join(lines)
```

<div class="line-notes">

- `class ReportText:` 报告里「必须由人来写」的部分:背景、没选的方案为什么不选、理由、风险、复盘条件。数字类的内容不在这里,由矩阵自动算。
- `why_not_others: dict[str, str]  # 没选的方案各自为什么不选` 逼你对每个落选的方案都写理由。写不出来,说明你还没想清楚为什么不选它。
- `w = weighted(scores, criteria)` 先算一次加权得分,后面几处要用。
- `top = winner(scores, criteria)` 第一名是谁,报告里写「建议:……」。
- `lines = [f"# {t.title}", "", "## 1. 背景", t.background, "", "## 2. 选项"]` 用一个字符串列表逐行攒出整篇报告,最后用 `"\n".join(lines)` 拼成一个字符串。标题里的 `## 1.` 到 `## 8.` 编号是给下面的 lint 认的。
- `lines += [f"- {o}" for o in scores]` 把每个选项名变成一个列表项追加到末尾。`+=` 在列表上就是追加多个元素。
- `tag = "实测" if s.kind == "measured" else "估计"` 每一格的来历,直接写进证据一节,读报告的人一眼能看出哪些格子靠谱。
- `lines.append(f"- {o} / {c.name} = {s.value}({tag}):{s.why}")` 一格一行:「选项 / 标准 = 分数(来历):依据」。这一节会很长,故意的。
- `share = measured_share(scores, criteria)` 实测占比单独一行,把「证据有多硬」摆在敏感性之前。
- `lines += [f"不选「{o}」:{why}" for o, why in t.why_not_others.items()]` 每个落选方案一行。
- `flips = one_at_a_time(scores, criteria)` 第一种晃法。
- `wj, sj = weight_jitter(scores, criteria), score_jitter(scores, criteria)` 另外两种。一行里同时给两个变量赋值。
- `f"权重一起随机抖 5000 次,{top} 拿第一的比例 {wj[top]:.1%}"` `:.1%` 把 0.925 显示成 `92.5%`。这句话里的「拿第一的比例 92.5%」是下面 lint 要找的特征。
- `for d in (2,):` 只报错 2 分的逐格翻盘,错 1 分的都不翻,写进去只会占版面。括号里一个元素后面的逗号不能省,否则它就不是元组了。

</div>

再写一个文件,把语音这个例子的文字部分填上,生成并保存报告:

```python
# agent-zero-lab/part10/selection/voice_report.py
"""生成「明年要不要做语音客服 Agent」的选型报告,并存成 voice_report.md。"""
from pathlib import Path

from part10.selection.report import ReportText, build_report
from part10.selection.voice_decision import A, B, C, CRITERIA, SCORES

TEXT = ReportText(
    title="明年要不要做语音客服 Agent(CloudLedger,示例数据)",
    background="客服电话每月约 4 万通(示例数字),其中查退款进度和查发票约占三成。文字渠道的 SupportPilot 已经上线,"
               "主要工单类型的原样采纳率超过 90%。业务方希望把同样的能力扩展到电话。",
    why_not_others={
        A: "技术成熟度实测不过关:首 token P95 1.08 秒,加预算表里其余环节 1.03 秒,超过 1.5 秒的 P95 目标;风险和成本两项拉分太多;没有电话场景自有评测数据,全量上线等于盲飞。",
        C: "完全不做就拿不到电话场景的任何数据,一年后还是没法决策。",
    },
    reason="它复用 SupportPilot 已有的评测、工具和审批,风险可控;试点能拿到真实的延迟、字错误率、转人工率,给下一年的全量决策提供证据。",
    risks=[
        "试点工单选得太简单,数据不代表全量:缓解,试点选两类难度不同的工单",
        "ASR 在方言和噪声下表现差:缓解,在自有录音上测字错误率,不达标不上线",
        "录音告知和外呼规定:缓解,上线前法务评审",
    ],
    review_conditions=[
        "试点三个月后,首音频 P95 小于 1.5 秒、转人工率不高于人工渠道、无合规问题,则在下一个预算周期评估全量方案 A",
        "任一端到端实时模型在中文电话场景的实测 P95 小于 1.0 秒,提前复盘",
    ],
)

if __name__ == "__main__":
    text = build_report(TEXT, SCORES, CRITERIA)
    Path("voice_report.md").write_text(text)
    print(text)
```

<div class="line-notes">

- `from part10.selection.voice_decision import A, B, C, CRITERIA, SCORES` 直接用上一个文件里的矩阵。数字只有一处来源。
- `A: "技术成熟度实测不过关:` 这里的数字(1.08 秒、1.03 秒、1.5 秒)和矩阵里的 `why` 是同一批,如果以后重测改了,两处都要改。这是手写文字里最容易漏的地方,练习里不处理,留给你自己警惕。
- `risks=[` 每条风险后面跟一句缓解。风险和缓解写在一起,不让「只列风险不说怎么办」混过去。
- `review_conditions=[` 复盘条件,每一条都带具体数字。
- `Path("voice_report.md").write_text(text)` 把整篇报告存成文件,当前目录下。

</div>

```bash
uv run python -m part10.selection.voice_report
```

输出就是一整篇报告,我把重要的几段贴在这里(完整的证据一节有 15 行,按选项和标准展开,这里省略中间):

```text
加权得分:A 现在就全量做语音 3.4,B 文字为主加语音试点 3.85,C 明年不做 3.5
实测分数占比:A 现在就全量做语音 18%,B 文字为主加语音试点 0%,C 明年不做 0%

## 5. 建议和理由
建议:B 文字为主加语音试点。它复用 SupportPilot 已有的评测、工具和审批,风险可控;试点能拿到真实的延迟、字错误率、转人工率,给下一年的全量决策提供证据。
不选「A 现在就全量做语音」:技术成熟度实测不过关:首 token P95 1.08 秒,加预算表里其余环节 1.03 秒,超过 1.5 秒的 P95 目标;风险和成本两项拉分太多;没有电话场景自有评测数据,全量上线等于盲飞。
不选「C 明年不做」:完全不做就拿不到电话场景的任何数据,一年后还是没法决策。

## 6. 风险和缓解
- 试点工单选得太简单,数据不代表全量:缓解,试点选两类难度不同的工单
- ASR 在方言和噪声下表现差:缓解,在自有录音上测字错误率,不达标不上线
- 录音告知和外呼规定:缓解,上线前法务评审

## 7. 敏感性
单个权重 ±50%:第一名都不变
权重一起随机抖 5000 次,B 文字为主加语音试点 拿第一的比例 92.5%
只抖估计分数(±1)5000 次,B 文字为主加语音试点 拿第一的比例 75.8%
单格估计错 2 分就会翻盘的格子:「B 文字为主加语音试点」的「业务价值」从 3 改成 1:第一名变成「C 明年不做」;「B 文字为主加语音试点」的「技术成熟度」从 4 改成 2:第一名变成「C 明年不做」;「B 文字为主加语音试点」的「风险与合规」从 4 改成 2:第一名变成「C 明年不做」;「C 明年不做」的「业务价值」从 1 改成 3:第一名变成「C 明年不做」

## 8. 复盘条件
- 试点三个月后,首音频 P95 小于 1.5 秒、转人工率不高于人工渠道、无合规问题,则在下一个预算周期评估全量方案 A
- 任一端到端实时模型在中文电话场景的实测 P95 小于 1.0 秒,提前复盘
```

这份报告有几处值得对着看。「证据」一节每一格都标了(实测)或(估计),读的人不用问「这个 3 分哪来的」。「实测分数占比:B 0%」摆在推荐方案旁边,没有遮掩。敏感性一节有三个数,其中 75.8% 比 92.5% 低很多,就是前面说的:只晃权重会高估结论的稳定。最后一行告诉你 B 的哪几格最该先量,下一步行动直接来自分析。

## 第 4 步:检查报告有没有常见毛病

最后写一个检查器。它不判断结论对不对(这个没法自动判断),只检查**该有的东西有没有**:

```python
# agent-zero-lab/part10/selection/lint_report.py
"""检查一份选型报告有没有「先有结论再凑分数」的毛病。不判断结论对不对,只检查该有的东西有没有。"""
import re
import sys
from pathlib import Path

SECTIONS = ["背景", "选项", "标准和权重", "证据", "建议和理由", "风险和缓解", "敏感性", "复盘条件"]


def section(text: str, name: str) -> str | None:
    m = re.search(rf"^## \d+\. {name}\n(.*?)(?=^## |\Z)", text, re.S | re.M)
    return m.group(1) if m else None


def lint(text: str) -> list[str]:
    problems: list[str] = []
    body = {n: section(text, n) for n in SECTIONS}
    for n, b in body.items():
        if b is None:
            problems.append(f"缺少「{n}」这一部分")
    opts = [ln for ln in (body["选项"] or "").splitlines() if ln.startswith("- ")]
    if len(opts) < 3:
        problems.append(f"只有 {len(opts)} 个选项,至少要 3 个")
    if not any(re.search(r"不做|观望|推迟|晚点", o) for o in opts):
        problems.append("选项里没有「不做或晚点做」,结论很可能是预设的")
    if "(实测)" not in (body["证据"] or ""):
        problems.append("证据里没有一格是实测的,全是估计")
    if not re.search(r"比例\s*\d+(\.\d+)?%", body["敏感性"] or ""):
        problems.append("敏感性部分没有「拿第一的比例」这种概率,只写「第一名不变」不算做过")
    if not re.search(r"\d", body["复盘条件"] or ""):
        problems.append("复盘条件里没有具体数字,半年后没法判断要不要重来")
    if "不选" not in (body["建议和理由"] or ""):
        problems.append("建议里没有写为什么不选其他方案")
    return problems


if __name__ == "__main__":
    issues = lint(Path(sys.argv[1]).read_text())
    print("通过" if not issues else "\n".join(f"- {p}" for p in issues))
```

<div class="line-notes">

- `SECTIONS = ["背景", "选项", "标准和权重", "证据", "建议和理由", "风险和缓解", "敏感性", "复盘条件"]` 八个部分的名字,和报告里的标题一一对应。
- `def section(text: str, name: str) -> str | None:` 取出某一部分的内容,找不到返回 `None`。
- `m = re.search(rf"^## \d+\. {name}\n(.*?)(?=^## |\Z)", text, re.S | re.M)` 正则:`^## \d+\. 名字\n` 匹配标题行,`(.*?)` 非贪婪地取内容,`(?=^## |\Z)` 是「向前看」:遇到下一个 `## ` 开头的行或文件末尾就停,但不把它吃掉。`re.S` 让 `.` 能匹配换行,`re.M` 让 `^` 匹配每行开头。前面的 `rf"` 是 raw 加 f-string,反斜杠不用转义。
- `body = {n: section(text, n) for n in SECTIONS}` 一次取出八个部分。
- `problems.append(f"缺少「{n}」这一部分")` 缺哪个报哪个。
- `opts = [ln for ln in (body["选项"] or "").splitlines() if ln.startswith("- ")]` 选项一节里以 `- ` 开头的行就是选项。`(x or "")` 在 `x` 是 `None` 时用空字符串顶上,不然 `None.splitlines()` 会报错。
- `if len(opts) < 3:` 至少三个选项。
- `if not any(re.search(r"不做|观望|推迟|晚点", o) for o in opts):` **没有「不做」的选项,多半是预设了结论。** `any` 只要有一个满足就是真。
- `if "(实测)" not in (body["证据"] or ""):` 证据一节里一个「(实测)」都没有,说明全是估计。
- `if not re.search(r"比例\s*\d+(\.\d+)?%", body["敏感性"] or ""):` 敏感性一节必须有「比例 数字%」这种概率。这个正则我第一版写的是 `\d+(\.\d+)?%`,下面练习 3 会看到它有一个漏洞。
- `if not re.search(r"\d", body["复盘条件"] or ""):` 复盘条件里至少要有一个数字。
- `if "不选" not in (body["建议和理由"] or ""):` 建议里要写「不选」哪个、为什么。

</div>

```bash
uv run python -m part10.selection.lint_report voice_report.md
```

```text
通过
```

通过不等于结论正确,只说明这份报告没有犯那几个最常见的错。

### 测试

晃法的代码也要有测试,尤其是要证明三件事:晃法能识别出「势均力敌」的情况;实测的格子真的不被晃;「估计的不确定性比权重的不确定性更伤结论」这个核心判断在例子里成立。

```python
# agent-zero-lab/part10/selection/test_decision.py
from part10.selection.decision_matrix import (
    Criterion, Score, Scores, cell_flips, one_at_a_time, score_jitter, weight_jitter, weighted, winner,
)
from part10.selection.voice_decision import B, CRITERIA, SCORES


def grid(rows: dict[str, tuple[int, int]], kind: str = "estimate") -> Scores:
    return {o: {"价值": Score(v, kind, ""), "风险": Score(r, kind, "")} for o, (v, r) in rows.items()}


def test_weighted_math() -> None:
    c = [Criterion("价值", 1), Criterion("风险", 3)]
    s = grid({"A": (5, 1), "B": (1, 3)})
    assert weighted(s, c) == {"A": 2.0, "B": 2.5}
    assert winner(s, c) == "B"


def test_voice_example_is_robust_to_weights_but_not_to_everything() -> None:
    assert winner(SCORES, CRITERIA) == B
    assert one_at_a_time(SCORES, CRITERIA) == []
    wj = weight_jitter(SCORES, CRITERIA)
    assert abs(sum(wj.values()) - 1) < 0.01 and wj[B] > 0.9
    sj = score_jitter(SCORES, CRITERIA, delta=2)
    assert sj[B] < wj[B]  # 估计分数的不确定性,比权重的不确定性更伤结论


def test_close_call_is_detected() -> None:
    c = [Criterion("价值", 0.5), Criterion("风险", 0.5)]
    wide = grid({"做": (5, 4), "不做": (2, 3)})  # 4.5 对 2.5,差得远
    assert one_at_a_time(wide, c) == []
    close = grid({"做": (5, 3), "不做": (2, 5)})  # 4.0 对 3.5,价值权重减半就翻盘
    assert one_at_a_time(close, c)


def test_measured_cells_never_move() -> None:
    c = [Criterion("价值", 0.5), Criterion("风险", 0.5)]
    s = grid({"做": (5, 4), "不做": (2, 3)}, kind="measured")
    assert score_jitter(s, c, delta=2) == {"做": 1.0, "不做": 0.0}
    assert cell_flips(s, c, 2) == []  # 实测的格子不参与逐格检查
```

<div class="line-notes">

- `def grid(rows: dict[str, tuple[int, int]], kind: str = "estimate") -> Scores:` 测试用的小工具:传 `{"A": (价值, 风险)}`,造出一张两列的矩阵。`kind` 默认是估计。
- `def test_weighted_math() -> None:` 第一条:手算验证。权重 1 和 3,A 是 5 和 1,B 是 1 和 3。A = (5×1 + 1×3) / 4 = 2.0,B = (1×1 + 3×3) / 4 = 2.5。
- `assert abs(sum(wj.values()) - 1) < 0.01` 三个比例加起来应该是 1。因为每个数都四舍五入到三位小数,加起来可能是 1.001,所以允许 0.01 的误差。我第一版写的是 `< 1e-9`,红了,才知道四舍五入会留下误差。
- `assert sj[B] < wj[B]  # 估计分数的不确定性,比权重的不确定性更伤结论` 今天的核心判断,固定成测试。以后有人改了分数,让这个关系不成立了,测试会叫。
- `wide = grid({"做": (5, 4), "不做": (2, 3)})  # 4.5 对 2.5,差得远` 领先很多的例子:单因素晃不动。
- `close = grid({"做": (5, 3), "不做": (2, 5)})  # 4.0 对 3.5,价值权重减半就翻盘` 势均力敌的例子。价值权重从 0.5 减半成 0.25、风险权重不变 0.5 时,做 = (5×0.25 + 3×0.5) / 0.75 ≈ 3.67,不做 = (2×0.25 + 5×0.5) / 0.75 = 4.0,第一名换人。
- `s = grid({"做": (5, 4), "不做": (2, 3)}, kind="measured")` 全是实测的矩阵。
- `assert score_jitter(s, c, delta=2) == {"做": 1.0, "不做": 0.0}` 全是实测就一格也晃不动,「做」每次都赢。
- `assert cell_flips(s, c, 2) == []` 实测格子不参与逐格检查。

</div>

```bash
uv run pytest part10/selection -q
```

```text
....                                                                     [100%]
4 passed in 0.30s
```

## 动手练习

### 练习 1:为「要不要做 Deep Research 内部研究助手」写一份报告

用今天的工具,为「财务每月要查资料对账,要不要做一个 Deep Research 内部研究助手」写一份选型报告。三个选项:A 全公司统一做研究平台,B 只给财务对账团队做报告助手,C 不做。分数里要有至少一格来自 [Day 612](/blog/agent-zero/day-612-deep-research-1/) 和 [Day 613](/blog/agent-zero/day-613-deep-research-2/) 的真实数字。生成报告,并用 lint 检查。

<details>
<summary>参考答案</summary>

```python
# agent-zero-lab/part10/selection/ex623_research.py
"""练习 1:用同一套工具,写「要不要做 Deep Research 内部研究助手」的选型报告。分数里有来自 Day 612、613 的实测数字,其余是示例估计。"""
from pathlib import Path

from part10.selection.decision_matrix import Criterion, Score
from part10.selection.lint_report import lint
from part10.selection.report import ReportText, build_report

CRITERIA = [Criterion("业务价值", 0.30), Criterion("技术成熟度", 0.20), Criterion("团队能力匹配", 0.15),
            Criterion("风险与合规", 0.20), Criterion("成本", 0.15)]
A, B, C = "A 全公司统一做研究平台", "B 只给财务对账团队做报告助手", "C 不做,继续人工查资料"


def est(v: int, why: str) -> Score:
    return Score(v, "estimate", why)


def got(v: int, why: str) -> Score:
    return Score(v, "measured", why)


SCORES = {
    A: {"业务价值": est(4, "各团队都有查资料的活(示例)"),
        "技术成熟度": got(3, "Day 613 核验器第一版报 26 处问题,22 处是误报;逐句评审把分析句判成不支持"),
        "团队能力匹配": est(3, "要支持多种资料来源"),
        "风险与合规": est(2, "报告引用造假要有人兜底,全公司铺开风险面大"),
        "成本": est(2, "Anthropic 复盘里多 Agent 约多花 15 倍 token(二手数字,没自己测)")},
    B: {"业务价值": est(3, "财务每月对账说明和政策问答集中,价值明确但面窄"),
        "技术成熟度": got(4, "Day 612 在 8 篇离线资料上跑通提纲、并行研究、写报告,云簿政策问答可控"),
        "团队能力匹配": est(5, "Day 612、613 的流水线直接复用"),
        "风险与合规": est(4, "只读内部资料,输出前有核验器"),
        "成本": est(4, "范围小,Day 613 的预算上限可以直接用")},
    C: {"业务价值": est(1, "没有新增价值"), "技术成熟度": est(5, "不涉及"), "团队能力匹配": est(3, "不涉及"),
        "风险与合规": est(5, "没有新风险"), "成本": est(5, "没有新成本")},
}

TEXT = ReportText(
    title="要不要做 Deep Research 内部研究助手(CloudLedger,示例数据)",
    background="财务每月要把退款政策、发票规则和客户争议对一遍,查资料占掉人工的大头(示例)。Day 612、613 已经有一条能跑的研究流水线。",
    why_not_others={A: "核验器的误报率和成本都还没压下来,铺开等于把别人的时间也搭进来。",
                    C: "不做就没有任何真实使用数据,核验器的误报也没法在真任务里调。"},
    reason="范围窄、直接复用已有代码,而且能在真实任务里继续调核验器。",
    risks=["核验器漏掉假引用:缓解,上线前对 20 份人工标注的报告测漏报率",
           "成本失控:缓解,每份报告设预算上限,超了停下来给人"],
    review_conditions=["试点两个月,核验后人工改动率低于 20%、单份报告成本低于 3 元,则评估扩到销售团队",
                       "核验器误报率压到 10% 以下再评估方案 A"],
)

if __name__ == "__main__":
    text = build_report(TEXT, SCORES, CRITERIA)
    Path("research_report.md").write_text(text)
    print("\n".join(text.splitlines()[-14:]))
    problems = lint(text)
    print("lint:", "通过" if not problems else problems)
```

<div class="line-notes">

- `from part10.selection.lint_report import lint` 直接调用 lint 函数,不是命令行。
- `def got(v: int, why: str) -> Score:` 实测格子的小帮手,和 `est` 对称。
- `"技术成熟度": got(3, "Day 613 核验器第一版报 26 处问题,22 处是误报;逐句评审把分析句判成不支持"),` A 的技术成熟度用 Day 613 的真实结果:规则层核验器第一版报了 26 处问题,其中 22 处是误报。这是我们自己实验里量出来的,标实测。
- `"成本": est(2, "Anthropic 复盘里多 Agent 约多花 15 倍 token(二手数字,没自己测)")` 来自别人的复盘,不是我们量的,所以标估计,并写明「二手数字」。
- `"技术成熟度": got(4, "Day 612 在 8 篇离线资料上跑通提纲、并行研究、写报告,云簿政策问答可控"),` B 的成熟度是实测:Day 612 的流水线在同一批资料上真的跑通了。
- `"团队能力匹配": est(5, "Day 612、613 的流水线直接复用"),` B 的匹配度满分,因为代码现成。
- `print("\n".join(text.splitlines()[-14:]))` 只打印报告的最后 14 行(风险、敏感性、复盘条件),完整报告存在 `research_report.md`。
- `print("lint:", "通过" if not problems else problems)` lint 返回空列表就打「通过」,否则打出问题清单。

</div>

```bash
uv run python -m part10.selection.ex623_research
```

```text

## 6. 风险和缓解
- 核验器漏掉假引用:缓解,上线前对 20 份人工标注的报告测漏报率
- 成本失控:缓解,每份报告设预算上限,超了停下来给人

## 7. 敏感性
单个权重 ±50%:第一名都不变
权重一起随机抖 5000 次,B 只给财务对账团队做报告助手 拿第一的比例 94.7%
只抖估计分数(±1)5000 次,B 只给财务对账团队做报告助手 拿第一的比例 82.5%
单格估计错 2 分就会翻盘的格子:「B 只给财务对账团队做报告助手」的「业务价值」从 3 改成 1:第一名变成「C 不做,继续人工查资料」;「B 只给财务对账团队做报告助手」的「风险与合规」从 4 改成 2:第一名变成「C 不做,继续人工查资料」;「C 不做,继续人工查资料」的「业务价值」从 1 改成 3:第一名变成「C 不做,继续人工查资料」

## 8. 复盘条件
- 试点两个月,核验后人工改动率低于 20%、单份报告成本低于 3 元,则评估扩到销售团队
- 核验器误报率压到 10% 以下再评估方案 A
lint: 通过
```

B 在两种晃法下的比例是 94.7% 和 82.5%,比语音例子的 75.8% 高一些。分数是我设的,这个对比只说明工具怎么用,不说明 Deep Research 比语音更该做。逐格检查里还是有三格,错 2 分会让 C 赢,其中 C 的业务价值从 1 改成 3 就会翻盘:如果「不做」其实也有价值(比如人工查资料的效率比想象中高),结论就变了。这一条要拿去和财务确认。

</details>

### 练习 2:每个权重要变几倍,第一名才换人?

单因素晃法只试了乘 0.5 和乘 1.5,结论是「不翻」。写一个函数,对每个权重找出**最小的倍数**,让第一名换人:往下降到多少倍、往上升到多少倍。这个数字越靠近 1,说明这个权重越是要和相关方对齐的地方。

<details>
<summary>参考答案</summary>

```python
# agent-zero-lab/part10/selection/ex623_flip.py
"""练习 2:每个权重要乘多少倍,第一名才会换人?离 1 越近,这个权重越要和相关方对齐。"""
from dataclasses import replace

from part10.selection.decision_matrix import Criterion, Scores, winner
from part10.selection.voice_decision import CRITERIA, SCORES


def flip_factors(scores: Scores, criteria: list[Criterion]) -> dict[str, tuple[float | None, float | None]]:
    base = winner(scores, criteria)
    out: dict[str, tuple[float | None, float | None]] = {}
    for i, c in enumerate(criteria):
        def flips(f: float) -> bool:
            changed = criteria[:i] + [replace(c, weight=c.weight * f)] + criteria[i + 1:]
            return winner(scores, changed) != base

        down = next((f / 100 for f in range(99, -1, -1) if flips(f / 100)), None)
        up = next((f / 100 for f in range(101, 1001) if flips(f / 100)), None)
        out[c.name] = (down, up)
    return out


if __name__ == "__main__":
    for name, (down, up) in flip_factors(SCORES, CRITERIA).items():
        d = f"降到 ×{down:.2f}" if down is not None else "怎么降都不翻"
        u = f"升到 ×{up:.2f}" if up is not None else "升到 10 倍也不翻"
        print(f"{name:<8} {d:<14} {u}")
```

<div class="line-notes">

- `def flip_factors(scores: Scores, criteria: list[Criterion]) -> dict[str, tuple[float | None, float | None]]:` 返回每个标准的(往下翻盘的倍数, 往上翻盘的倍数),没有就是 `None`。
- `def flips(f: float) -> bool:` 在循环里定义的小函数:把第 `i` 个权重乘 `f`,看第一名是不是变了。它「看见」外层循环的 `i`、`c`、`base`。相当于 JS 里循环体里的闭包。
- `down = next((f / 100 for f in range(99, -1, -1) if flips(f / 100)), None)` 从 0.99 倍开始往下试,一直到 0。`next(生成器, None)` 取第一个满足条件的值,没有就取 `None`,相当于 JS 数组的 `find`。因为是从 1 往 0 方向找,找到的第一个就是**离 1 最近**的翻盘点。
- `up = next((f / 100 for f in range(101, 1001) if flips(f / 100)), None)` 从 1.01 倍往上试到 10 倍。
- `d = f"降到 ×{down:.2f}" if down is not None else "怎么降都不翻"` 把结果翻成人话。
- `print(f"{name:<8} {d:<14} {u}")` 对齐列。

</div>

```bash
uv run python -m part10.selection.ex623_flip
```

```text
业务价值     降到 ×0.41       升到 ×1.75
技术成熟度    怎么降都不翻         升到 ×2.76
团队能力匹配   怎么降都不翻         升到 10 倍也不翻
风险与合规    怎么降都不翻         升到 ×2.76
成本       怎么降都不翻         升到 ×3.34
```

读法:业务价值的权重降到原来的 0.41 倍(从 30% 降到约 12%),或者升到 1.75 倍(升到约 53%),第一名就会换人。其他四个权重,即使降到 0 也不翻,要升到 2.76 倍以上甚至 10 倍都翻不了。所以这份报告的结论**只有一个权重要紧**:业务价值。评审会上不用花时间吵成本和团队匹配的权重,把时间花在「我们到底有多看重业务价值」上,如果相关方的意见是业务价值应该占一半以上,结论就不一样了。

</details>

### 练习 3:lint 没抓到什么?

下面是一份故意写坏的报告 `bad_report.md`。对它跑 lint,数一数报了几条;再自己数一数这份报告实际有几处毛病,找出 lint 漏掉的,修好 lint。

<details>
<summary>参考答案</summary>

```markdown
# 我们一定要做 A2A 互联(示例,故意写得有问题)

## 1. 背景
A2A 很火,大厂都在做。

## 2. 选项
- A 现在做 A2A
- B 做 A2A 加网关

## 3. 标准和权重
技术先进性 50% 业务价值 50%

## 4. 证据
- A 技术先进性 = 5(估计):很先进
- B 技术先进性 = 5(估计):更先进

## 5. 建议和理由
建议做 B,因为它最全面。

## 6. 风险和缓解
- 暂无

## 7. 敏感性
单个权重 ±50%:第一名都不变

## 8. 复盘条件
- 做完以后看效果
```

这份报告的毛病我数了八处:选项只有两个、没有「不做」、证据全是估计、背景没有数字、风险写「暂无」、敏感性只说「第一名都不变」没有任何概率、复盘条件没有数字、建议没写为什么不选另一个。lint 第一版(敏感性检查写的是 `\d+(\.\d+)?%`,只要有百分号就算过)跑出来:

```text
- 只有 2 个选项,至少要 3 个
- 选项里没有「不做或晚点做」,结论很可能是预设的
- 证据里没有一格是实测的,全是估计
- 复盘条件里没有具体数字,半年后没法判断要不要重来
- 建议里没有写为什么不选其他方案
```

五条。漏了敏感性那一条:因为「±50%」里有个 `50%`,正则看到百分号就放过了。把它改成必须是「比例 数字%」(今天正文里已经是改过的版本),再跑:

```text
- 只有 2 个选项,至少要 3 个
- 选项里没有「不做或晚点做」,结论很可能是预设的
- 证据里没有一格是实测的,全是估计
- 敏感性部分没有「拿第一的比例」这种概率,只写「第一名不变」不算做过
- 复盘条件里没有具体数字,半年后没法判断要不要重来
- 建议里没有写为什么不选其他方案
```

六条。还剩两处 lint 没管:背景有没有数字、风险是不是「暂无」。这两条我故意没写进 lint:背景里「有没有数字」很容易被敷衍过去(随便塞个数就能通过),「暂无」这类词的穷举又永远写不完。lint 只能挡住最常见、能被机械判断的毛病,剩下的要靠评审的人读。**不要因为 lint 通过了就觉得报告没问题。**

</details>

**验收标准:** `pytest part10/selection` 四条全绿;`voice_report.md` 通过 lint;能说清「权重一起抖 92.5%」和「估计分数 ±1 是 75.8%」为什么不一样、哪个更接近结论的真实稳定程度;练习 3 能说出 lint 第一版漏了哪一条、为什么。

## 本周资深面试题汇总

这几周的内容在资深岗位的面试里,最常变成下面这类题。每道给答题骨架,细节在各天的自测里。

1. **设计一个修 bug 的 Coding Agent,工具集怎么定、怎么证明有效?**([Day 604](/blog/agent-zero/day-604-coding-agents-1/)、[605](/blog/agent-zero/day-605-coding-agents-2/))骨架:约束(仓库规模、语言、构建成本)、五块设计(工具、上下文、执行环境、验证、停止)、对比实验(只给 bash 的基线对你的工具集,多次运行)、去掉没带来提升的工具。
2. **老系统没有 API,要让 Agent 每天自动处理 500 单,怎么评估和设计?**([Day 606](/blog/agent-zero/day-606-computer-use-1/)、[607](/blog/agent-zero/day-607-computer-use-2/))骨架:能不能拿到底层数据、路线选择(DOM 优先,固定流程沉淀成脚本)、写操作分级审批、离线评测和灰度、ROI。
3. **电话客服语音 Agent,首音频 P95 小于 1.5 秒,怎么设计和验证?**([Day 610](/blog/agent-zero/day-610-voice-1/)、[611](/blog/agent-zero/day-611-voice-2/))骨架:级联架构和理由、每一段的延迟优化、写操作的身份核验、打断处理、分段打点、P95、压测、灰度。
4. **给投资团队设计一个尽调研究 Agent。**([Day 612](/blog/agent-zero/day-612-deep-research-1/)、[613](/blog/agent-zero/day-613-deep-research-2/))骨架:主管加研究员、来源分级、压缩和引用、三层质量保障、预算上限。
5. **20 个团队各有 Agent,怎么设计互联?要不要上 A2A?**([Day 614](/blog/agent-zero/day-614-a2a-1/)、[616](/blog/agent-zero/day-616-a2a-2/))骨架:团队内外分开、跨团队用 A2A 的理由、目录、鉴权(代表用户)、网关、版本治理、试点推广。
6. **Agent 要替用户花钱,怎么设计授权?**([Day 617](/blog/agent-zero/day-617-payments-1/)、[618](/blog/agent-zero/day-618-payments-2/))骨架:授权、结账、结算三层、授权框用确定性代码、先拒绝后问人、预算和重复交易号、人批准时再判一次。
7. **客服负责人不放心用 Agent,怎么推动落地?**([Day 619](/blog/agent-zero/day-619-agent-ux-1/)、[620](/blog/agent-zero/day-620-agent-ux-2/))骨架:弄清担心什么、按动作定自主级别、协作者模式起步、展示依据、埋点和放权规则。
8. **今天的题:你的团队明年该做哪个方向?你怎么做这个决定?** 骨架:先问业务问题不问技术、至少三个选项含「不做」、和相关方定标准和权重、能实测的做原型拿证据并标清哪些是估计、打分后做三种敏感性分析、写清建议和不选的理由和复盘条件。

## 本周坑清单

- **Coding Agent**:工具越加越多从不删;编辑不校验导致越改越乱;拿 SWE-bench 分数直接比模型。
- **Computer Use**:截图历史全留;Retina 屏不换算坐标;把「没报错」当成完成;以为过滤隐藏文字就能防注入。
- **语音**:以为延迟都在 LLM;整段生成完才送 TTS;打断后整段回复写进历史;只看平均延迟。
- **Deep Research**:原文直接交给写作模型;有引用就以为可信;预算到了悄悄截断。
- **A2A 和支付**:把 A2A 当成另一种 MCP;只按调用方身份授权;签名都对就当成用户同意;授权框不防重复交易。
- **产品交互**:问「我们第几级」;用裸比例放权;错误提示只写「出错了」。
- **选型本身**:没有「不做」选项;先有结论再凑分数;只给一个精确的得分;只晃权重不晃分数;分数不标实测还是估计;报告里没有复盘条件。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 加权打分矩阵 | 行是选项、列是标准的一张表,每格一个分数,每列一个权重,加权求和得出每个选项的总分 |
| 敏感性分析 | 把权重或分数晃一晃,看第一名会不会换人,衡量结论有多脆弱 |
| 蒙特卡洛 | 用大量随机试验估计一个概率。今天就是随机抖动 5000 次,数每个选项拿第一的次数 |
| 实测、估计 | 一个分数有没有自己量过。量过的是实测,拍脑袋或引用别人的是估计。两者要分开标注 |
| ADR | Architecture Decision Record,架构决策记录:一页纸写清「当时面对什么、选了什么、为什么、有什么后果」,选型报告可以浓缩成一份 ADR |
| 复盘条件 | 写在报告里的、什么情况下要回头重新评估的具体触发条件,带数字 |
| P50、P95 | 第 50 和第 95 百分位:100 次里排在中间的、排在倒数第 5 的那一次的值([Day 611](/blog/agent-zero/day-611-voice-2/) 讲过) |
| lint | 用程序机械地检查文本或代码里有没有某类常见毛病,不判断对错 |

## 常见误区

**只算出一个精确的得分,不做敏感性。** 3.85 看着很精确,其实是「5 个权重加 15 个估计分数」拼出来的,每一样都有误差。

**只晃权重,不晃分数。** 今天的例子里,权重一起抖,B 赢 92.5%;估计分数最多错 1 分,掉到 75.8%。评审会上被质疑最多的是分数,不是权重。

**所有格子都写「估计」,或者所有格子都写「实测」。** 前者是没做功课,后者多半在撒谎。诚实的矩阵是大部分估计、少数几格实测,并且知道**该先去量哪一格**。

**分数先打、权重后定。** 先看到分数再调权重,就是在凑结论。权重要在打分之前和相关方定好,并写下来。

**没有「不做」这个选项。** 今天的例子里「不做」排第二,只比 B 低 0.35 分,没有它就看不见「全做」比「不做」还差。

**把 lint 通过当成报告通过。** 练习 3 里第一版 lint 漏了一条,而且两条毛病根本没法机械检查。

**照抄文章里的分数。** 今天的分数是示例,电话量、成本、团队情况都是虚构的,只有首 token 那一格是我量的。你的团队要用自己的数据重填。

## 学习资料

### 文档与文章

- [Documenting Architecture Decisions(Michael Nygard)](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions):ADR 的出处,一页纸讲清为什么要写决策记录,10 分钟。英文。
- [adr.github.io](https://adr.github.io/):ADR 的模板和各种格式汇总,翻一翻几种模板,15 分钟。英文。
- [Sensitivity analysis(维基百科)](https://en.wikipedia.org/wiki/Sensitivity_analysis):敏感性分析的整体框架,先看开头和「Methodology」一节,20 分钟。英文。
- [Building effective agents(Anthropic)](https://www.anthropic.com/engineering/building-effective-agents):讲什么时候该做 Agent、什么时候不该,「先从简单的开始」这条原则是选型的好参照,20 分钟。英文。
- [Monte Carlo method(维基百科)](https://en.wikipedia.org/wiki/Monte_Carlo_method):想知道随机抖动为什么管用,看开头的「Overview」一节,15 分钟。英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1SqAVzLEci&autoplay=0&high_quality=1" title="2026 AI Agent框架终极指南:从入门到生产部署的选型地图,10大框架五大范式,一期全讲透" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>唐国梁Tommy · 2026 AI Agent框架终极指南:从入门到生产部署的选型地图 · 17 分钟,看别人怎么组织一张选型地图,注意它的维度划分,可以借来做你自己报告的标准。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/LP5OCa20Zpg" title="Tips for building AI agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Anthropic · Tips for building AI agents · 18 分钟,Anthropic 几位工程师讨论什么时候该做 Agent、什么时候不该,是选型讨论很好的参照。英文。</figcaption>
</figure>

### 书籍

- Neal Ford、Mark Richards、Pramod Sadalage、Zhamak Dehghani《Software Architecture: The Hard Parts》(O'Reilly, 2021):专门讲架构取舍分析,里面有一整套「把权衡量化」的做法,和今天的打分矩阵是一个思路。英文原版。
- Daniel Kahneman、Olivier Sibony、Cass Sunstein《Noise: A Flaw in Human Judgment》(Little, Brown Spark, 2021):讲同一个问题不同的人打分会差多少,为什么要把判断拆成独立的维度再汇总,对理解「估计分数有多不可靠」有帮助。英文原版。

### 开源项目与代码

- [joelparkerhenderson/architecture-decision-record](https://github.com/joelparkerhenderson/architecture-decision-record):ADR 的例子和模板大全,挑两三个看,感受别人怎么写「考虑过的其他方案」。
- [SALib/SALib](https://github.com/SALib/SALib):Python 里正经的敏感性分析库(Sobol、Morris 等方法),今天手写的只是最粗的一种,想看更系统的做法来这里。

## 自测

1. 为什么选型报告里一定要有「不做」这个选项?
2. 今天的例子里,权重一起抖 B 赢 92.5%,只抖估计分数 B 赢 75.8%。这两个数分别回答什么问题?哪个更接近结论的真实稳定程度?
3. 「实测分数占比 B 是 0%」说明什么?它是不是说明推荐 B 是错的?
4. 逐格检查显示 B 的技术成熟度错 2 分会翻盘。这条信息应该导致你下一步做什么?
5. 面试题:老板问「明年我们要不要做 Agent 互联(A2A)?」你怎么回答?

<details>
<summary>答案</summary>

1. 没有「不做」,结论多半是写之前就定好的,打分只是在给它凑理由;而且你看不到「做」到底有没有比「不做」更好。今天的例子里「不做」排第二、「全做」排第三,这个信息只有放进去才看得见。
2. 前者问「大家对看重什么有分歧,结论会不会翻」,后者问「我们拍脑袋打的分数如果错了一点,结论会不会翻」。后者更接近真实稳定程度,因为评审会上被质疑最多的是分数,而且估计出来的分数误差往往比权重的分歧大。
3. 说明推荐 B 的那些分数目前都是判断,没有一格量过。不能说 B 错,只能说证据还不够硬,应该先去量最关键的格子。
4. 先去实测那一格:在真实的电话录音上量首音频延迟,而不是继续争论权重。逐格检查的价值就是告诉你有限的时间该花在哪里。
5. 参考骨架:先问业务问题(是不是真的有 20 个团队要互相调用,还是只有两个);选项至少三个(现在上 A2A、先用现有的 HTTP 加 MCP、不做);标准和权重和相关方一起定;能实测的做个原型(Day 616 的 a2a-sdk 跑通对账 Agent),估计的格子标清楚;打分后做三种敏感性分析;写建议、不选的理由、风险和复盘条件(「跨团队调用超过 N 个、出现鉴权事故」才重新评估)。

</details>

## 明天预告

[Day 624](/blog/agent-zero/day-624-agentops-kickoff-1/) · AgentOps 开题(一):真的需要平台吗,包含什么,控制面数据面。今天学会了怎么在几个选项里做取舍并写下理由。明天要把进阶篇的毕业项目 AgentOps 平台开起来,第一件事不是写代码,是回答「真的需要做平台吗」,并写清楚要做什么、不做什么,这是选型思路的直接应用。

