---
title: 'Day 553 · 大规模评审(二):投票、评审漂移、钱和人、多人标注'
description: '一个裁判不放心,就请三个投票?今天用真实调用跑出来:两个偏松的裁判会一起判错 9 条,多数投票反而比最好的那个单裁判差;投票真正的用处是找出 11.5% 意见不一致的样本送人工。接着让裁判的 prompt 悄悄改一句话,看金丝雀集怎么报警、多大的金丝雀集才抓得到小漂移;算一笔每天的评审账(模型 ¥0.90,人工 1 小时);最后讲标注员之间的一致性,写出 judge_monitor.py。'
pubDate: 2026-10-27
regime: none
tags: ['eval', 'llm-as-judge', 'panel', 'drift', 'kappa', 'python', 'agent-zero']
series: 'agent-zero'
day: 553
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 551](/blog/agent-zero/day-551-judge-scale-1/) 用一份差评多抽的校准集,把裁判报出来的通过率校正回去,并把校准集和线上样本两边的误差一起画进区间。[Day 552](/blog/agent-zero/day-552-week79-review/) 的周报里,线上通过率用的是裁判 M 判的:M 偏松,TNR 只有 0.662,校正后区间有 14 个点宽。

一个自然的想法是:一个裁判不放心,就请几个来投票。另一个更现实的问题是:裁判不是一成不变的,有人改一句 prompt,或者厂商悄悄换了模型快照,它的标准就会变,而你的日报还在照常出数字。再往后是钱和人:这套东西每天要花多少模型费、占多少专家时间。今天一并回答。

## 今天要解决的问题

学完今天你应该能做到:

1. 再请一个裁判(只核对数字的 V),让 M、C、V 三个对同样 480 条投票,看到一个反直觉的结果:多数投票的 TNR(0.938)比 V 单独(0.993)还低。解释为什么:M 和 C 的错高度重合(C 判错的 16 条里 M 也错了 9 条),两个错的一起把对的 V 投输了。这是今天的第一个新概念:**评审团(投票和分流)**,以及它真正的用处:找出意见不一致的 11.5% 送人工。
2. 手写 `panel_vote`,并用练习 1 的另一种规则(一票否决)和练习 3 的两两搭配,看到「裁判怎么搭」比「裁判有几个」重要。
3. 给裁判建一个**金丝雀集**(冻结的人工标注,专门用来发现裁判自己变了),这是第二个新概念,**评审漂移**。实跑一次:有人给 M 的 prompt 加了一句「态度礼貌就倾向通过」,TNR 从 0.70 掉到 0.24,`drift_check` 报警;再用模拟看金丝雀集里放多少条 fail 才抓得到小漂移,以及误报率有多高。
4. 算清楚每天的评审账:三个裁判每张工单 ¥0.00149,模型钱每天不到 ¥1,人工复核才是大头。
5. 两个标注员的一致性怎么量、怎么靠标注指南提高(40 条里 10 条边界情况,kappa 从 0.58 到 0.95),并写出 `judge_monitor.py`。

预计用时 3.5 小时。这一天内容偏多,标注员那一节可以第二天再看。实跑花费约 ¥0.30(V 跑 480 条 ¥0.2540,漂移实验 100 条 ¥0.0492),其余脚本不调模型。前置:[Day 551](/blog/agent-zero/day-551-judge-scale-1/)(`judge_run.py`、`judge_split.py`、`judge_stats.py`)、[Day 552](/blog/agent-zero/day-552-week79-review/)、[Day 358](/blog/agent-zero/day-358-llm-judge-3/)(kappa 的定义)、[Day 359](/blog/agent-zero/day-359-llm-judge-4/)(偏差)。今天要装一个只用来核对 kappa 的包:`uv add --dev scikit-learn`(我装到 1.9.1)。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `panel_vote` 和 `drift_check`,再口述「为什么报警要两个条件」;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 再请一个裁判

Day 551 已经有三个裁判:A(只看工单和回复,全判通过,已经废了)、C(有发票清单和规则)、M(有发票清单没规则)。要做投票,再加一个角度不同的:V,扮演「账务核对员」,逐项核对发票编号和金额,全部对得上才算通过。同时顺手加一个后面漂移实验要用的 M2。两个 prompt 都是往 `judge_run.py` 的 `PROMPTS` 字典里加:

```python
# agent-zero-lab/part10/judge_run.py(新增两个 prompt,放进 PROMPTS 字典里)
PROMPTS = {
    ...
    # V:换一个判断角度,只核对数字:退款金额、发票编号能不能和清单对上(Day 553 投票用)
    "V": "你是账务核对员。给你一张工单、客服的回复和发票清单。逐项核对:回复里提到的发票编号是不是清单里重复扣款的那一张,"
        "退款金额是不是那一张的金额;如果回复没有退款,看清单里有没有真正的重复扣款。全部对得上才算通过。"
        '只输出 JSON:{"pass": true 或 false}。',
    # M2:有人「优化」了 M,多加了一句话(Day 553 演示漂移)
    "M2": "你是客服质检员。给你一张工单、客服的回复和这位客户的发票清单,判断客服的回复处理得对不对。"
        "客服只要态度礼貌、给出了明确的处理结论,就倾向于判通过,不要过分挑剔数字细节。"
        '只输出 JSON:{"pass": true 或 false}。',
}
```

`user_message` 里原来的 `if prompt in ("C", "M"):` 也要改成 `if prompt in ("C", "M", "V", "M2"):`,因为这两个也要拼发票清单。V 的 prompt 和 C 一样把规则写明了,只是换了个说法和视角;为了让三个裁判有差别,M 保持「不写规则」。跑 V(我没有先试跑,因为 M 和 C 已经证明了输出格式没问题,直接放大,风险是白花 ¥0.25):

```bash
uv run python -m part10.judge_run V
```

```text
裁判 V:480 条,和标准答案一致 479,解析失败 0,花费 ¥0.2540,平均输入 245 tokens
```

V 480 条里只错 1 条。它的 prompt 里明确要求核对发票编号和金额,这正好是造数据时埋的所有错(金额错、发票错、该退没退、不该退却退)。**这个结果很大程度上是我的 prompt 刚好对准了数据里的坑,不要期待你们的真实评审也有 479/480。**

## 评审团:投票

先写今天的模块。`kappa` 是 Day 358 的 Cohen's kappa(两个人或裁判之间扣掉碰巧一致之后的一致程度),`panel_vote` 是多数投票加「意见不一致」分流:

```python
# agent-zero-lab/part10/judge_monitor.py
"""规模化用 LLM 当裁判的几件事:kappa、投票分流、漂移报警(Day 553 建)。校正在 judge_stats.py。"""
from part10.judge_stats import rates


def kappa(a: list[int], b: list[int]) -> float:
    """Cohen kappa:两列 0/1 标签的一致程度,扣掉「碰巧一致」的部分。"""
    n = len(a)
    po = sum(x == y for x, y in zip(a, b)) / n
    pa, pb = sum(a) / n, sum(b) / n
    pe = pa * pb + (1 - pa) * (1 - pb)
    return (po - pe) / (1 - pe) if pe < 1 else 1.0


def panel_vote(votes: list[list[int]]) -> tuple[list[int], list[int]]:
    """votes[j][i] 是第 j 个裁判对第 i 条的判断。返回(多数票结果, 意见不一致的下标)。"""
    n_judges, n = len(votes), len(votes[0])
    major, split = [], []
    for i in range(n):
        s = sum(v[i] for v in votes)
        major.append(int(s * 2 > n_judges))
        if 0 < s < n_judges:
            split.append(i)
    return major, split
```

<div class="line-notes">

- `from part10.judge_stats import rates` 今天后面的漂移检查要用 `rates` 的输出。
- `def kappa(a: list[int], b: list[int]) -> float:` 两列 0/1 标签。可以是两个人,可以是人和裁判,也可以是两个裁判。
- `po = sum(x == y for x, y in zip(a, b)) / n` 实际一致的比例。
- `pa, pb = sum(a) / n, sum(b) / n` 两列各自判 1 的比例。
- `pe = pa * pb + (1 - pa) * (1 - pb)` 碰巧一致的比例:两个人都判 1 的概率加都判 0 的概率,假设两人互不相干。
- `return (po - pe) / (1 - pe) if pe < 1 else 1.0` 扣掉碰巧一致之后的一致程度。`pe = 1` 是两列全一样的特殊情况(比如都是全 1),避免除以零。
- `def panel_vote(votes: list[list[int]]) -> tuple[list[int], list[int]]:` `votes[j][i]` 是第 j 个裁判对第 i 条的判断。返回多数票结果和意见不一致的下标。
- `n_judges, n = len(votes), len(votes[0])` 几个裁判、几条。
- `s = sum(v[i] for v in votes)` 第 i 条里判通过的票数。
- `major.append(int(s * 2 > n_judges))` 超过一半才算通过。`s * 2 > n_judges` 比 `s > n_judges / 2` 少一次浮点除法。
- `if 0 < s < n_judges:` 既不是全票通过(`s = n_judges`)也不是全票不通过(`s = 0`),就是意见不一致,记下这一条。

</div>

再写一个脚本,把三个裁判各自的成绩、多数投票的成绩、一致和不一致两部分的成绩一次列出来:

```python
# agent-zero-lab/part10/panel_demo.py
"""三个裁判(M、C、V)各自的成绩,多数投票的成绩,以及意见不一致的有多少。"""
import json
from pathlib import Path

from part10.judge_monitor import kappa, panel_vote
from part10.judge_stats import rates

HERE = Path(__file__).parent
pool = json.loads((HERE / "data" / "judge_pool.json").read_text())
human = [c["ok"] for c in pool]


def load(name: str) -> list[int]:
    rows = {r["id"]: r["judge"] for r in json.loads((HERE / "data" / f"judge_{name}.json").read_text())}
    return [rows[c["id"]] for c in pool]


votes = {n: load(n) for n in ("M", "C", "V")}


def show(title: str, judge: list[int], idx: list[int]) -> None:
    h, j = [human[i] for i in idx], [judge[i] for i in idx]
    r = rates(h, j)
    print(f"{title:<12} TPR {r['tpr']:.3f}  TNR {r['tnr']:.3f}  kappa {kappa(h, j):.3f}  判错 {sum(a != b for a, b in zip(h, j))} 条")


everyone = list(range(len(pool)))
for n, v in votes.items():
    show(f"裁判 {n}", v, everyone)
major, split = panel_vote(list(votes.values()))
show("多数投票", major, everyone)
agree = [i for i in everyone if i not in set(split)]
show("只看一致的", major, agree)
print(f"意见不一致 {len(split)} 条 = {len(split) / len(pool):.1%},一致 {len(agree)} 条")

wrong = {n: {i for i in everyone if v[i] != human[i]} for n, v in votes.items()}
print("各裁判判错的条数:", {n: len(s) for n, s in wrong.items()})
print(f"M 和 C 同时判错 {len(wrong['M'] & wrong['C'])} 条;C 判错的 {len(wrong['C'])} 条里,M 也错了 {len(wrong['M'] & wrong['C'])} 条")
```

<div class="line-notes">

- `votes = {n: load(n) for n in ("M", "C", "V")}` 三个裁判的判断,字典推导式,键是裁判名。
- `def show(title: str, judge: list[int], idx: list[int]) -> None:` 在 `idx` 指定的那些条上,打一行成绩。`idx` 可以是全部,也可以只是「一致的那部分」。
- `r = rates(h, j)` Day 551 的 TPR、TNR。
- `print(f"{title:<12} TPR {r['tpr']:.3f}  TNR {r['tnr']:.3f}  kappa {kappa(h, j):.3f}  判错 {sum(a != b for a, b in zip(h, j))} 条")` 四个数一行:TPR、TNR、和人的 kappa、判错几条。
- `major, split = panel_vote(list(votes.values()))` 多数投票的结果和意见不一致的下标。
- `agree = [i for i in everyone if i not in set(split)]` 意见一致的下标。`set(split)` 让 `in` 判断是常数时间。
- `show("只看一致的", major, agree)` 只在一致的那部分上算成绩,这是「一致的直接采信」的可靠程度。
- `wrong = {n: {i for i in everyone if v[i] != human[i]} for n, v in votes.items()}` 每个裁判判错的下标集合(集合推导式)。
- `print(f"M 和 C 同时判错 {len(wrong['M'] & wrong['C'])} 条;` `&` 是集合的交集,同时在两个集合里的才算。

</div>

```bash
uv run python -m part10.panel_demo
```

```text
裁判 M         TPR 1.000  TNR 0.662  kappa 0.732  判错 49 条
裁判 C         TPR 1.000  TNR 0.890  kappa 0.918  判错 16 条
裁判 V         TPR 1.000  TNR 0.993  kappa 0.995  判错 1 条
多数投票         TPR 1.000  TNR 0.938  kappa 0.955  判错 9 条
只看一致的        TPR 1.000  TNR 0.989  kappa 0.993  判错 1 条
意见不一致 55 条 = 11.5%,一致 425 条
各裁判判错的条数: {'M': 49, 'C': 16, 'V': 1}
M 和 C 同时判错 9 条;C 判错的 16 条里,M 也错了 9 条
```

几个数要对着看。

**三个裁判差别很大。**M 判错 49 条(kappa 0.732),C 判错 16 条(0.918),V 只错 1 条(0.995)。三个的 TPR 都是 1.000,和 Day 551 一样,错都是放过坏回复。

**多数投票反而不如 V 单独。**多数投票判错 9 条,TNR 0.938,kappa 0.955;V 一个人错 1 条。原因看最后两行:C 判错的 16 条里,M 也错了 9 条。如果两个裁判的错互相独立,M 判错的概率是 49/480,约 10.2%,C 的 16 条错里预期 M 同时错只有 16 × 10.2% ≈ 1.6 条,实际有 9 条,是预期的五倍多。M 和 C 都是「看了发票清单,但没核对金额」,盲点是同一个,在「金额错了」这类回复上一起放行(C 的 16 条错全是金额错的)。这 9 条里 V 其实判对了,但多数票是 2 比 1,V 被投输了。

这是 PoLL 那篇论文([Verga 等,2024](https://arxiv.org/abs/2404.18796))强调「评审团要来自不同模型家族」的原因:它的摘要说,由多个较小模型组成的评审团比单个大模型裁判更好,偏差更小,而且便宜七倍以上,前提是评审团成员来自互不相干的模型家族。我们今天三个裁判都是同一个 `deepseek-flash`,只是 prompt 不同。我没有跑别家的模型(这门课今天只用 `deepseek-flash`),所以这个对比只能说明「同一个模型换 prompt,错误高度相关」,不能说明「换厂商就不相关」。

**投票的真正用处是分流。**三个裁判意见不一致的有 55 条,占 11.5%;一致的 425 条里只有 1 条判错,kappa 0.993。结构就是这样:一致的直接采信,不一致的送人工。多数投票的 9 条错里有 8 条落在这 55 条里(V 不同意 M 和 C,所以意见不一致),送人工就能改过来;剩下 1 条是三个裁判一致判错的,人工那里看不到它。所以人工把这 55 条判对以后,整批 480 条里只剩 1 条错。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="线上评审流水线:线上工单分层抽样,三个裁判投票;意见一致的 425 条直接采信、只有 1 条判错;意见不一致的 55 条送人工;人工结果回流进校准集;金丝雀集冻结,每周重跑,和基线对比报警">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="40" width="104" height="44" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="26" y="60" fill="var(--ink)">线上工单</text>
<text x="26" y="76" fill="var(--ink-faint)">每天抽样</text>
<line x1="120" y1="62" x2="150" y2="62" stroke="var(--rule)"/>
<rect x="150" y="30" width="130" height="64" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="162" y="52" fill="var(--ink)">评审团 M C V</text>
<text x="162" y="70" fill="var(--ink-faint)">同一条各判一次</text>
<text x="162" y="86" fill="var(--ink-faint)">要尽量不同</text>
<line x1="280" y1="52" x2="320" y2="40" stroke="var(--mem)"/>
<line x1="280" y1="74" x2="320" y2="110" stroke="var(--compute)"/>
<rect x="320" y="18" width="304" height="44" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="332" y="38" fill="var(--ink)">一致 425 条:直接采信,只错 1 条</text>
<text x="332" y="54" fill="var(--ink-faint)">→ 校正(Day 551)→ 日报,带区间</text>
<rect x="320" y="88" width="304" height="44" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="332" y="108" fill="var(--ink)">不一致 55 条(11.5%):送人工</text>
<text x="332" y="124" fill="var(--ink-faint)">专家标注,标注指南有版本号</text>
<line x1="472" y1="132" x2="472" y2="176" stroke="var(--compute)"/>
<rect x="352" y="176" width="272" height="44" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="364" y="196" fill="var(--ink)">校准集(定期补新样本)</text>
<text x="364" y="212" fill="var(--ink-faint)">覆盖线上每一类工单</text>
<rect x="150" y="176" width="170" height="44" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="162" y="196" fill="var(--ink)">金丝雀集(冻结)</text>
<text x="162" y="212" fill="var(--ink-faint)">每周、每次改动重跑</text>
<line x1="235" y1="176" x2="215" y2="94" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="16" y="260" fill="var(--ink-soft)">实线是每天的数据流。虚线是漂移检查:评审团在金丝雀集上的 TPR、TNR</text>
<text x="16" y="280" fill="var(--ink-soft)">和基线比,明显下降就报警,停用新版本。</text>
</g>
</svg>
<figcaption>线上评审的整体结构。投票的价值在分流:一致的直接采信,不一致的送人工,人工结果回流成校准集。金丝雀集是冻结的,不参与调 prompt,专门用来发现裁判自己变了。</figcaption>
</figure>

## 评审会漂移

裁判不是常数。下面任何一件事都会改变它的行为:改了裁判 prompt(比如有人「优化」加了一句话)、换了模型或厂商更新了同一个名字背后的快照、Agent 的回复格式变了导致裁判看到的输入变了。结果是校准集上估出的 TPR、TNR 悄悄过期,而日报上的数字照样每天出,看不出任何异常。

对策是把裁判当成有版本的产物:模型名、prompt、参数一起打版本号,任何一项改了就是新版本。光有版本号不够,还要知道新版本有没有变差,办法是**金丝雀集**:从有人工标注的样本里拿出一批(pass、fail 各一半),冻结,永远不用它调 prompt。每周、每次换版本之前都重跑一遍,把 TPR、TNR 和基线比。

报警规则写成 `drift_check`:

```python
# agent-zero-lab/part10/judge_monitor.py(新增)
def drift_check(base: dict, now: dict, max_drop: float = 0.05) -> list[str]:
    """base、now 是 rates() 的结果。掉得多、而且新区间的上限也低于基线,才报警。"""
    alerts = []
    for m in ("tpr", "tnr"):
        drop = base[m] - now[m]
        lo, hi = now[f"{m}_ci"]
        if drop > max_drop and hi < base[m]:
            alerts.append(f"{m.upper()} 从 {base[m]:.2f} 掉到 {now[m]:.2f}(新区间 [{lo:.2f}, {hi:.2f}],上限也低于基线)")
    return alerts
```

<div class="line-notes">

- `def drift_check(base: dict, now: dict, max_drop: float = 0.05) -> list[str]:` `base` 是基线(裁判上一个版本在金丝雀集上的成绩),`now` 是这次的成绩,都是 Day 551 `rates()` 返回的字典。返回报警信息的列表,空列表表示没事。
- `for m in ("tpr", "tnr"):` TPR、TNR 各检查一次。
- `drop = base[m] - now[m]` 掉了多少。掉得越多数越大,变好了是负数。
- `lo, hi = now[f"{m}_ci"]` 这次成绩的 Wilson 区间。`f"{m}_ci"` 拼出 `tpr_ci` 或 `tnr_ci`。
- `if drop > max_drop and hi < base[m]:` 两个条件同时满足才报警:掉了超过 5 个点,**而且**新区间的上限也低于基线。只用第一个条件,金丝雀里 fail 才几十条,TNR 自己就会抖几个点,天天误报。第二个条件是说「连新区间最乐观的那端都没回到基线」。
- `alerts.append(f"{m.upper()} 从 {base[m]:.2f} 掉到 {now[m]:.2f}(新区间 [{lo:.2f}, {hi:.2f}],上限也低于基线)")` 报警信息带上数字,方便直接贴进群里。

</div>

实跑一次。金丝雀集是用 Day 551 的 `draw(100, True, seed=11)` 抽的 100 条(pass、fail 各 50),基线是 M 在这 100 条上的判断(已经有了,不用再调);新版本是 M2,也就是在 M 的 prompt 上加了一句「客服只要态度礼貌、给出了明确的处理结论,就倾向于判通过,不要过分挑剔数字细节」。这 100 条要真的调一次模型:

```python
# agent-zero-lab/part10/drift_demo.py
"""金丝雀集:100 条冻结的人工标注(pass、fail 各 50)。有人给裁判 prompt 加了一句话,金丝雀能不能发现?"""
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from common.llm import LLMClient
from part10.judge_split import draw, human, pool, verdict
from part10.judge_monitor import drift_check
from part10.judge_run import judge_one
from part10.judge_stats import rates

HERE = Path(__file__).parent
canary, _ = draw(100, True, seed=11)          # 种子 11 抽出来的 100 条,以后永远不动
h = [human[i] for i in canary]
base = rates(h, [verdict[i] for i in canary])  # 基线:裁判 M 现在的成绩

llm = LLMClient()
with ThreadPoolExecutor(max_workers=8) as ex:
    rows = list(ex.map(lambda i: judge_one(llm, pool[i], "M2"), canary))
(HERE / "data" / "drift_M2.json").write_text(json.dumps(rows))
new = rates(h, [r["judge"] for r in rows])
print(f"M  基线:TPR {base['tpr']:.2f}  TNR {base['tnr']:.2f} [{base['tnr_ci'][0]:.2f}, {base['tnr_ci'][1]:.2f}]")
print(f"M2 新版:TPR {new['tpr']:.2f}  TNR {new['tnr']:.2f} [{new['tnr_ci'][0]:.2f}, {new['tnr_ci'][1]:.2f}]")
print("报警:", drift_check(base, new) or "无")
print(f"花费 ¥{sum(r['cost'] for r in rows):.4f}")
```

<div class="line-notes">

- `canary, _ = draw(100, True, seed=11)          # 种子 11 抽出来的 100 条,以后永远不动` 金丝雀的关键是**固定**。种子 11 和校准集用的种子 3 不同,两个集合不是同一批(不过都从同一个池子里抽,所以会有重叠的用例,真实项目里金丝雀应该和校准集、调 prompt 用的开发集彼此不重叠)。
- `h = [human[i] for i in canary]` 金丝雀的标准答案。
- `base = rates(h, [verdict[i] for i in canary])  # 基线:裁判 M 现在的成绩` 基线是 M 在这 100 条上的 TPR、TNR。
- `rows = list(ex.map(lambda i: judge_one(llm, pool[i], "M2"), canary))` 用 M2 在这 100 条上重新判一遍,`judge_one` 是 Day 551 的函数。
- `(HERE / "data" / "drift_M2.json").write_text(json.dumps(rows))` 结果存下来,练习 2 要用。
- `new = rates(h, [r["judge"] for r in rows])` M2 的成绩。
- `print("报警:", drift_check(base, new) or "无")` 空列表是假值,`or "无"` 让没报警时打印「无」。

</div>

```bash
uv run python -m part10.drift_demo
```

```text
M  基线:TPR 1.00  TNR 0.70 [0.56, 0.81]
M2 新版:TPR 1.00  TNR 0.24 [0.14, 0.37]
报警: ['TNR 从 0.70 掉到 0.24(新区间 [0.14, 0.37],上限也低于基线)']
花费 ¥0.0492
```

一句话的改动,TNR 从 0.70 掉到 0.24,报警准时响了。TPR 没变:M2 不会冤枉好回复,只是对坏回复睁一只眼闭一只眼,这正是「宽松偏差」的样子。如果没有金丝雀集,这一周的日报里通过率会悄悄涨十几个点,而没有人改过 Agent。

这一次太明显了。真实的漂移常常小得多,比如 TNR 从 0.70 掉到 0.60。金丝雀集里放多少条 fail 才抓得到?用模拟看(没有调模型:基线和新版本的成绩都是从二项分布里抽出来的,和 `drift_check` 一起跑 2000 次):

```python
# agent-zero-lab/part10/drift_power.py
"""金丝雀集里放多少条 fail,才抓得到「TNR 从 0.70 悄悄掉到 0.60」?纯模拟,不调模型。"""
import random

from part10.judge_monitor import drift_check
from part10.stats import wilson_ci


def alert_rate(n_fail: int, true_base: float, true_now: float, trials: int = 2000, seed: int = 0) -> float:
    rng = random.Random(seed)
    hits = 0
    for _ in range(trials):
        k0 = sum(rng.random() < true_base for _ in range(n_fail))   # 基线那次在金丝雀上量到的
        k1 = sum(rng.random() < true_now for _ in range(n_fail))    # 新版本这次量到的
        base = {"tpr": 1.0, "tpr_ci": (1.0, 1.0), "tnr": k0 / n_fail, "tnr_ci": wilson_ci(k0, n_fail)}
        now = {"tpr": 1.0, "tpr_ci": (1.0, 1.0), "tnr": k1 / n_fail, "tnr_ci": wilson_ci(k1, n_fail)}
        hits += bool(drift_check(base, now))
    return hits / trials


print("金丝雀里的 fail 条数 | 真掉了 0.70→0.60 报警率 | 没掉(0.70→0.70)误报率")
for n in (25, 50, 100, 200, 400):
    print(f"{n:>8} | {alert_rate(n, 0.70, 0.60):>14.1%} | {alert_rate(n, 0.70, 0.70):>14.1%}")
```

<div class="line-notes">

- `def alert_rate(n_fail: int, true_base: float, true_now: float, trials: int = 2000, seed: int = 0) -> float:` 金丝雀里有 `n_fail` 条 fail,裁判真实的 TNR 从 `true_base` 变成 `true_now`,重复 `trials` 次,返回报警的比例。
- `k0 = sum(rng.random() < true_base for _ in range(n_fail))   # 基线那次在金丝雀上量到的` 基线那次的抓住条数。基线也是量出来的,也带抽样误差,所以要模拟,不能当成精确的 0.70。
- `k1 = sum(rng.random() < true_now for _ in range(n_fail))    # 新版本这次量到的` 新版本这次的抓住条数。
- `base = {"tpr": 1.0, "tpr_ci": (1.0, 1.0), "tnr": k0 / n_fail, "tnr_ci": wilson_ci(k0, n_fail)}` 拼成 `drift_check` 要的字典。TPR 这里用不到,随便填 1.0。
- `hits += bool(drift_check(base, now))` 有报警就记一次。`bool([])` 是假,非空列表是真。
- `print("金丝雀里的 fail 条数 | 真掉了 0.70→0.60 报警率 | 没掉(0.70→0.70)误报率")` 两列:真掉了的报警率,和没掉时的误报率。
- `print(f"{n:>8} | {alert_rate(n, 0.70, 0.60):>14.1%} | {alert_rate(n, 0.70, 0.70):>14.1%}")` 每个 fail 条数跑两种情形。

</div>

```bash
uv run python -m part10.drift_power
```

```text
金丝雀里的 fail 条数 | 真掉了 0.70→0.60 报警率 | 没掉(0.70→0.70)误报率
      25 |          29.8% |          10.0%
      50 |          39.7% |          10.8%
     100 |          55.5% |          10.4%
     200 |          76.7% |           8.2%
     400 |          93.5% |           6.5%
```

三个结论。一,TNR 掉 10 个点这种小漂移,金丝雀里放 50 条 fail 只有 40% 的概率报警,放 200 条是 77%,要到 400 条才有 93%。金丝雀集不是越小越方便,太小的金丝雀等于没有。二,没掉也会误报,6% 到 11%,因为基线和这次都是量出来的,碰巧一高一低就会触发。所以**报警是线索,不是判决**:响了以后先用同一批金丝雀重跑一遍确认,再去查是 prompt、模型还是输入变了。三,Day 551 的结论在这里又出现了一次:想抓小变化,要扩大的是金丝雀里的 fail 条数。

除了金丝雀,还有两个便宜的信号可以一起看:裁判的通过率分布(裁判版本和 Agent 版本都没变,通过率却突然跳了几个点,要么流量变了,要么裁判被动过);每天送人工的那批样本,专家标完以后可以反过来算裁判在这批最难的样本上的准确率,趋势有意义。

## 钱和人

线上评审有两块成本:模型调用的钱和人工复核的时间。很多团队只算第一块,第二块才是大头。先用今天实测的单价算:

```python
# agent-zero-lab/part10/judge_budget.py
"""线上评审团每天花多少钱、占多少人工。单价是今天实测的,工单量和抽样比例是假设。"""
import json
from pathlib import Path

HERE = Path(__file__).parent
PER_CALL = {}
for name in ("M", "C", "V"):
    rows = json.loads((HERE / "data" / f"judge_{name}.json").read_text())
    PER_CALL[name] = sum(r["cost"] for r in rows) / len(rows)
PANEL = sum(PER_CALL.values())                     # 一张工单过三个裁判
SPLIT_RATE = 55 / 480                              # panel_demo 实测:三人意见不一致的比例
MIN_PER_REVIEW = 1.0                               # 假设:专家看一张要 1 分钟
HOURLY = 100.0                                     # 假设:专家一小时按 100 元算

print("每次评审实测:", {k: f"¥{v:.5f}" for k, v in PER_CALL.items()}, f"三人一张工单 ¥{PANEL:.5f}")
plans = {
    "全部工单抽 20%": [(3000, 0.20)],
    "退款类 300 张抽 50%、其余 2700 张抽 5%": [(300, 0.50), (2700, 0.05)],
}
for title, tiers in plans.items():
    n = sum(total * frac for total, frac in tiers)
    review = n * SPLIT_RATE
    hours = review * MIN_PER_REVIEW / 60
    print(f"\n{title}:每天评审 {n:.0f} 张")
    print(f"  模型 {n:.0f} × ¥{PANEL:.5f} = ¥{n * PANEL:.2f}")
    print(f"  人工 {n:.0f} × {SPLIT_RATE:.1%} = {review:.0f} 张 → {hours:.1f} 小时 → ¥{hours * HOURLY:.0f}")
```

<div class="line-notes">

- `PER_CALL[name] = sum(r["cost"] for r in rows) / len(rows)` 每个裁判的平均单价,来自今天实跑记下的 `cost` 字段:M 约 ¥0.00046、C 约 ¥0.00051、V 约 ¥0.00053。
- `PANEL = sum(PER_CALL.values())                     # 一张工单过三个裁判` 三个加起来,每张工单 ¥0.00149。
- `SPLIT_RATE = 55 / 480                              # panel_demo 实测:三人意见不一致的比例` 11.5%,来自上一节。
- `MIN_PER_REVIEW = 1.0                               # 假设:专家看一张要 1 分钟` 这个是假设的,真实项目里自己计时。
- `HOURLY = 100.0                                     # 假设:专家一小时按 100 元算` 也是假设的,换成你们的口径。
- `"全部工单抽 20%": [(3000, 0.20)],` 方案一:每天 3000 张,不分类别抽 20%,600 张。
- `"退款类 300 张抽 50%、其余 2700 张抽 5%": [(300, 0.50), (2700, 0.05)],` 方案二按风险抽:退款类 300 张抽一半,其余抽 5%。退款类占比 10% 是我假设的。
- `n = sum(total * frac for total, frac in tiers)` 每天评审多少张:方案一 600,方案二 150 + 135 = 285。
- `review = n * SPLIT_RATE` 其中要送人工的张数。
- `hours = review * MIN_PER_REVIEW / 60` 换算成小时。

</div>

```bash
uv run python -m part10.judge_budget
```

```text
每次评审实测: {'M': '¥0.00046', 'C': '¥0.00051', 'V': '¥0.00053'} 三人一张工单 ¥0.00149

全部工单抽 20%:每天评审 600 张
  模型 600 × ¥0.00149 = ¥0.90
  人工 600 × 11.5% = 69 张 → 1.1 小时 → ¥115

退款类 300 张抽 50%、其余 2700 张抽 5%:每天评审 285 张
  模型 285 × ¥0.00149 = ¥0.43
  人工 285 × 11.5% = 33 张 → 0.5 小时 → ¥54
```

模型的钱几乎可以忽略:每天不到 ¥1。人工是 1.1 小时、约 ¥115(按我假设的单价),贵 100 多倍。所以优化的重点在人工这一侧:

- **抽样比例按风险调。**方案二把退款类抽到 50%、查询类降到 5%,总量从 600 张降到 285 张,高风险的覆盖率反而从 20% 升到 50%。
- **降低不一致率。**练习 3 会看到,把裁判 M 换掉、只留 C 和 V,不一致率从 11.5% 降到 3.1%,人工量降到约四分之一。
- **人工复核的结果一定要回流进校准集。**这些是最难的样本,对校准最有价值;不回流,专家的时间只换来当天一个数。

## 标注员也要校准

上面把「人工标注」当标准答案。量大了以后,不是一个专家在标,而是两三个人,这时候出现一个新问题:**人和人也不一致。**裁判的 TPR、TNR 是拿人工标注当标准答案算的,如果两个标注员对同一批样本只有 0.5 的 kappa,「标准答案」本身就在晃,把裁判校准得再好也没有意义。

做法分三步。第一步,抽 40 条,两个人**各自独立**标完再讨论,算两人之间的 kappa(用上面写的 `kappa`,把两个人的标签当成两列)。低于 0.6 先别开工,把分歧的样本逐条拿出来看,多半发现是标准没写清楚,比如「错退了加购费,算不算错」。把结论写进标注指南,指南带版本号,再标一轮,直到 kappa 稳定在 0.7 以上。第二步,日常分工时留 10% 的样本让两个人都标,持续监控一致性。第三步,分歧要有一个人拍板:[Hamel Husain 的 evals FAQ](https://hamel.dev/blog/posts/evals-faq/)里建议用一位懂用户的领域专家当质量决策人(他的说法是 benevolent dictator),并且建议多人标注时先各自独立标、再一起讨论分歧、测量一致性。

我们没有真人标注员,所以今天用模拟演示这个过程(明确说一遍:这一节的标注员是代码模拟的,目的是演示 kappa 怎么用、指南怎么降分歧,数字不代表真人)。造 40 条,里面故意放 10 条「错退了加购费」的边界情况(Day 551 的 `wrong_refund`)。标注员 A 一向认为这种算错,标注员 B 在指南没写时,遇到边界情况抛硬币;其余情况两人都有 3% 的手滑:

```python
# agent-zero-lab/part10/annotators.py
"""两个标注员的一致性。标注员是模拟的(没有真人),目的是演示 kappa 怎么用、指南怎么降分歧。"""
import random

from part10.judge_split import human, pool
from part10.judge_monitor import kappa

rng = random.Random(5)
greys = [i for i, c in enumerate(pool) if c["cat"] == "wrong_refund"]
others = [i for i, c in enumerate(pool) if c["cat"] != "wrong_refund"]
items = rng.sample(greys, 10) + rng.sample(others, 30)   # 40 条里故意放 10 条边界情况,两个人各自独立标
truth = [human[i] for i in items]
# 边界情况:退的是加购费,算不算对,指南没写。标注员 A 觉得错,标注员 B 看心情
grey = [pool[i]["cat"] == "wrong_refund" for i in items]


def annotate(guide_clear: bool, lenient: bool) -> list[int]:
    out = []
    for t, g in zip(truth, grey):
        if g and not guide_clear and lenient:
            out.append(int(rng.random() < 0.5))    # 没有指南:边界情况抛硬币
        elif rng.random() < 0.03:
            out.append(1 - t)                      # 其余情况 3% 手滑
        else:
            out.append(t)
    return out


a1, b1 = annotate(False, False), annotate(False, True)
print(f"40 条里边界情况(退加购费)有 {sum(grey)} 条")
print(f"指南 v1(没写边界):kappa = {kappa(a1, b1):.2f},一致 {sum(x == y for x, y in zip(a1, b1))}/40")
a2, b2 = annotate(True, False), annotate(True, True)
print(f"指南 v2(写了「退加购费算错」):kappa = {kappa(a2, b2):.2f},一致 {sum(x == y for x, y in zip(a2, b2))}/40")
```

<div class="line-notes">

- `greys = [i for i, c in enumerate(pool) if c["cat"] == "wrong_refund"]` 所有「错退加购费」的用例下标,这是边界情况。
- `items = rng.sample(greys, 10) + rng.sample(others, 30)   # 40 条里故意放 10 条边界情况,两个人各自独立标` `rng.sample(列表, k)` 不放回地抽 k 个。10 条边界加 30 条普通。
- `truth = [human[i] for i in items]` 这 40 条的标准答案,标注员的「手滑」都以它为基准。
- `grey = [pool[i]["cat"] == "wrong_refund" for i in items]` 这 40 条里哪些是边界情况,布尔列表。
- `def annotate(guide_clear: bool, lenient: bool) -> list[int]:` 模拟一个标注员。`guide_clear` 是指南有没有写这种情况怎么判,`lenient` 是这个人会不会在没指南时随性。
- `if g and not guide_clear and lenient:` 边界情况、指南没写、又是随性的那位:
- `out.append(int(rng.random() < 0.5))    # 没有指南:边界情况抛硬币` 抛硬币,一半概率判通过。
- `elif rng.random() < 0.03:` 其余情况有 3% 概率手滑。
- `a1, b1 = annotate(False, False), annotate(False, True)` 指南 v1(没写边界):A 照标准答案标(只有手滑),B 抛硬币。
- `a2, b2 = annotate(True, False), annotate(True, True)` 指南 v2(写了「错退加购费算错」):两个人都只剩手滑。

</div>

```bash
uv run python -m part10.annotators
```

```text
40 条里边界情况(退加购费)有 10 条
指南 v1(没写边界):kappa = 0.58,一致 32/40
指南 v2(写了「退加购费算错」):kappa = 0.95,一致 39/40
```

指南 v1 时 40 条里两人一致 32 条,kappa 0.58,低于 0.6 的开工线;40 条里两人有 8 条不一致:4 条落在那 10 条边界情况上(B 抛硬币的结果),另外 4 条是随机手滑。把「错退加购费算错」写进指南 v2 以后,一致 39 条,kappa 0.95。**kappa 从 0.58 到 0.95,没有换人,没有加人,只是把一句话写进了指南。**

手写的 `kappa` 用 scikit-learn 核对一下。我用三组随机的 50 条标签对过,小数点后六位都一样:

```text
0.839744 0.839744
0.76 0.76
0.714519 0.714519
```

(这是我一次性的核对脚本输出,没有收进仓库;测试文件里有一个同样的对照,见下一节。)

工具方面不用一上来就上平台。Day 346 那个几十行的标注页,加一个「标注人」下拉框和一个「指南版本」字段,两三个人就够用。人多了、要分任务看进度,再换现成的:Langfuse 有 [Annotation Queues](https://langfuse.com/docs/evaluation/evaluation-methods/annotation-queues)(把 trace 放进队列、指定评分维度和标注人),通用的标注平台有 [Label Studio](https://labelstud.io/) 和 [Argilla](https://github.com/argilla-io/argilla)。不管用哪个,导出的数据里都要带三样:标注人、指南版本、标注时间。

## 给 `judge_monitor.py` 写测试

三个函数都有「手算得出答案」的例子,适合写测试:

```python
# agent-zero-lab/tests/test_judge_monitor.py
import pytest
from sklearn.metrics import cohen_kappa_score

from part10.judge_monitor import drift_check, kappa, panel_vote


def test_kappa_hand_example():
    a = [1, 1, 1, 1, 0, 0, 0, 0, 1, 0]
    b = [1, 1, 1, 0, 0, 0, 0, 1, 1, 0]
    # po = 8/10;a、b 各有 5 个 1,pe = 0.5×0.5 + 0.5×0.5 = 0.5;kappa = (0.8 - 0.5) / 0.5 = 0.6
    assert kappa(a, b) == pytest.approx(0.6)


def test_kappa_matches_sklearn():
    a = [1, 0, 1, 1, 0, 0, 1, 1, 1, 0, 1, 0]
    b = [1, 0, 0, 1, 0, 1, 1, 1, 0, 0, 1, 0]
    assert kappa(a, b) == pytest.approx(cohen_kappa_score(a, b))


def test_kappa_always_pass_judge_is_zero():
    assert kappa([1, 1, 0, 0, 1], [1, 1, 1, 1, 1]) == pytest.approx(0.0)


def test_panel_vote_majority_and_split():
    votes = [[1, 1, 0, 0], [1, 0, 0, 1], [1, 0, 0, 0]]
    major, split = panel_vote(votes)
    assert major == [1, 0, 0, 0]
    assert split == [1, 3]


def test_panel_vote_can_be_outvoted_by_two_wrong_judges():
    # 第三个裁判是对的(真答案 0),前两个一起错
    major, _ = panel_vote([[1], [1], [0]])
    assert major == [1]


def _rates(tpr: float, tnr: float, lo: float, hi: float) -> dict:
    return {"tpr": tpr, "tpr_ci": (tpr, tpr), "tnr": tnr, "tnr_ci": (lo, hi)}


def test_drift_check_needs_both_conditions():
    base = _rates(1.0, 0.70, 0.56, 0.81)
    assert drift_check(base, _rates(1.0, 0.64, 0.50, 0.76)) == []        # 掉了 6 个点,但区间上限 0.76 高于基线
    assert drift_check(base, _rates(1.0, 0.66, 0.60, 0.72)) == []        # 区间上限低于基线,但只掉了 4 个点
    assert len(drift_check(base, _rates(1.0, 0.50, 0.40, 0.60))) == 1    # 两个条件都满足
```

<div class="line-notes">

- `def test_kappa_hand_example():` 10 条,两人各有 5 个 1,8 条一致:`po = 0.8`,`pe = 0.5 × 0.5 + 0.5 × 0.5 = 0.5`,kappa = (0.8 − 0.5) / (1 − 0.5) = 0.6。手算和代码对上。
- `def test_kappa_matches_sklearn():` 和 `sklearn.metrics.cohen_kappa_score` 在另一组 12 条上对照。所以今天要 `uv add --dev scikit-learn`,它只在测试里用。
- `def test_kappa_always_pass_judge_is_zero():` Day 358 讲过:永远判通过的裁判,kappa 正好是 0。
- `votes = [[1, 1, 0, 0], [1, 0, 0, 1], [1, 0, 0, 0]]` 三个裁判、四条。第 0 条三人都判 1,第 2 条都判 0,一致;第 1、3 条有分歧。
- `assert major == [1, 0, 0, 0]` 第 1 条 1 票通过、第 3 条 1 票通过,都不到半数,判不通过;只有第 0 条通过。
- `assert split == [1, 3]` 意见不一致的是第 1 条和第 3 条。
- `major, _ = panel_vote([[1], [1], [0]])` 一条用例,前两个裁判错判 1、第三个对判 0。
- `assert major == [1]` 多数票是 1,对的那个被投输了,今天实验里的 9 条就是这样。
- `assert drift_check(base, _rates(1.0, 0.64, 0.50, 0.76)) == []        # 掉了 6 个点,但区间上限 0.76 高于基线` 掉得够多,但上限没低于基线,不报警。
- `assert drift_check(base, _rates(1.0, 0.66, 0.60, 0.72)) == []        # 区间上限低于基线,但只掉了 4 个点` 上限低于基线,但没掉够 5 个点,不报警。
- `assert len(drift_check(base, _rates(1.0, 0.50, 0.40, 0.60))) == 1    # 两个条件都满足` 两个条件都满足,报一条警。

</div>

```bash
uv run pytest tests/test_judge_monitor.py -q
```

```text
......                                                                   [100%]
6 passed in 2.59s
```

## 今天往仓库里加了什么

| 文件 / 函数 | 做什么 | 哪一节 |
| --- | --- | --- |
| `judge_run.py` 的 `V`、`M2` 两个 prompt | 换角度的第三个裁判;被「优化」过的 M | 再请一个裁判、评审会漂移 |
| `judge_monitor.py` 的 `kappa(a, b)` | 两列标签的 Cohen kappa | 评审团、标注员 |
| `panel_vote(votes)` | 多数投票和意见不一致的下标 | 评审团 |
| `drift_check(base, now)` | 掉得多、且新区间上限也低于基线才报警 | 评审会漂移 |
| `panel_demo.py`、`drift_demo.py`、`drift_power.py` | 投票实验、漂移实验、金丝雀功效模拟 | 各节 |
| `judge_budget.py`、`annotators.py` | 每天的评审账、两个标注员的 kappa | 钱和人、标注员 |

## 动手练习

1. **换一种投票规则。**把「多数投票」换成「全票才算通过」(任何一个裁判判不通过就不通过),比较 M、C、V 三票、C 和 V 两票、V 单独的 TPR、TNR、kappa、判错条数。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex553_1.py
"""练习 1:换投票规则。多数投票、全票才算通过、两个裁判(C 和 V),哪个最好?"""
import json
from pathlib import Path

from part10.judge_monitor import kappa
from part10.judge_stats import rates

HERE = Path(__file__).parent
pool = json.loads((HERE / "data" / "judge_pool.json").read_text())
human = [c["ok"] for c in pool]


def load(name: str) -> list[int]:
    rows = {r["id"]: r["judge"] for r in json.loads((HERE / "data" / f"judge_{name}.json").read_text())}
    return [rows[c["id"]] for c in pool]


M, C, V = load("M"), load("C"), load("V")
rules = {
    "多数投票(M、C、V)": [int(m + c + v >= 2) for m, c, v in zip(M, C, V)],
    "全票才通过(M、C、V)": [int(m + c + v == 3) for m, c, v in zip(M, C, V)],
    "全票才通过(C、V)": [int(c + v == 2) for c, v in zip(C, V)],
    "裁判 V 单独": V,
}
print(f"{'规则':<18}{'TPR':>7}{'TNR':>7}{'kappa':>7}{'判错':>5}")
for name, judge in rules.items():
    r = rates(human, judge)
    print(f"{name:<16}{r['tpr']:>7.3f}{r['tnr']:>7.3f}{kappa(human, judge):>7.3f}{sum(a != b for a, b in zip(human, judge)):>5}")
```

<div class="line-notes">

- `M, C, V = load("M"), load("C"), load("V")` 三个裁判的判断。
- `"多数投票(M、C、V)": [int(m + c + v >= 2) for m, c, v in zip(M, C, V)],` 三个 0/1 加起来,至少 2 票就是通过。
- `"全票才通过(M、C、V)": [int(m + c + v == 3) for m, c, v in zip(M, C, V)],` 三票全通过才通过,等价于「一票否决」。
- `"全票才通过(C、V)": [int(c + v == 2) for c, v in zip(C, V)],` 只用 C 和 V 两个。
- `print(f"{name:<16}{r['tpr']:>7.3f}{r['tnr']:>7.3f}{kappa(human, judge):>7.3f}{sum(a != b for a, b in zip(human, judge)):>5}")` 每条规则一行:TPR、TNR、kappa、判错条数。

</div>

```text
规则                    TPR    TNR  kappa   判错
多数投票(M、C、V)       1.000  0.938  0.955    9
全票才通过(M、C、V)      1.000  0.993  0.995    1
全票才通过(C、V)        1.000  0.993  0.995    1
裁判 V 单独           1.000  0.993  0.995    1
```

一票否决的结果是 TNR 0.993、判错 1 条,和 V 单独一样好,远好于多数投票的 9 条错。差别在于今天三个裁判的错全是同一个方向(放过坏回复,TPR 都是 1.000):只要有一个裁判看出问题就不放行,V 的发现不会被 M 和 C 投输。多数投票假设「错是随机的、各管各的」,一票否决假设「错是单方向的」。**代价没有出现在这份数据里,但真实项目会有:一票否决会提高误杀好回复的概率,拉低 TPR,多出来的不一致样本又要人工看。**选哪种规则看你们的裁判错在哪个方向。

</details>

2. **金丝雀集缩小。**`drift_demo.py` 那次漂移,金丝雀集只留 40 条(pass、fail 各 20)、20 条(各 10)时还报不报警?(用已存好的结果,不用再调模型。)

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex553_2.py
"""练习 2:金丝雀集缩到 40 条、20 条,drift_demo 里那次明显的漂移还报不报警?(用已存好的结果,不再调模型)"""
import json
from pathlib import Path

from part10.judge_monitor import drift_check
from part10.judge_split import draw, human, pool, verdict
from part10.judge_stats import rates

canary, _ = draw(100, True, seed=11)               # 和 drift_demo.py 同一份金丝雀
new_rows = {r["id"]: r["judge"] for r in json.loads((Path(__file__).parent / "data" / "drift_M2.json").read_text())}

h_all = [human[i] for i in canary]
old_all = [verdict[i] for i in canary]
new_all = [new_rows[pool[i]["id"]] for i in canary]
for n in (100, 40, 20):
    half = n // 2
    keep = [k for k, h in enumerate(h_all) if h == 1][:half] + [k for k, h in enumerate(h_all) if h == 0][:half]
    h = [h_all[k] for k in keep]
    base, now = rates(h, [old_all[k] for k in keep]), rates(h, [new_all[k] for k in keep])
    print(f"金丝雀 {n:>3} 条(fail {half}):TNR {base['tnr']:.2f} → {now['tnr']:.2f},"
          f"新区间 [{now['tnr_ci'][0]:.2f}, {now['tnr_ci'][1]:.2f}],报警 {drift_check(base, now) or '无'}")
```

<div class="line-notes">

- `canary, _ = draw(100, True, seed=11)               # 和 drift_demo.py 同一份金丝雀` 同一个种子,抽出同一批 100 条。
- `new_rows = {r["id"]: r["judge"] for r in json.loads(` 读 `drift_demo.py` 存下来的 M2 结果。
- `new_all = [new_rows[pool[i]["id"]] for i in canary]` 按金丝雀的顺序取出 M2 的判断。
- `for n in (100, 40, 20):` 三种大小。
- `keep = [k for k, h in enumerate(h_all) if h == 1][:half] + [k for k, h in enumerate(h_all) if h == 0][:half]` 前 `half` 条 pass 加前 `half` 条 fail,一半一半。
- `base, now = rates(h, [old_all[k] for k in keep]), rates(h, [new_all[k] for k in keep])` 用缩小后的集合重算基线和新版本的成绩。

</div>

```text
金丝雀 100 条(fail 50):TNR 0.70 → 0.24,新区间 [0.14, 0.37],报警 ['TNR 从 0.70 掉到 0.24(新区间 [0.14, 0.37],上限也低于基线)']
金丝雀  40 条(fail 20):TNR 0.75 → 0.15,新区间 [0.05, 0.36],报警 ['TNR 从 0.75 掉到 0.15(新区间 [0.05, 0.36],上限也低于基线)']
金丝雀  20 条(fail 10):TNR 0.70 → 0.10,新区间 [0.02, 0.40],报警 ['TNR 从 0.70 掉到 0.10(新区间 [0.02, 0.40],上限也低于基线)']
```

三种大小全都报了警。这次漂移太大(TNR 掉了 50 到 60 个点),连 10 条 fail 的金丝雀都抓得到。但别因此以为小金丝雀够用:上一节的模拟是 TNR 只掉 10 个点,50 条 fail 的报警率只有 40%。金丝雀的大小要按「你想抓多小的漂移」来定,不是按「最明显的那次」。

</details>

3. **配对。**人工预算只有 5%,三个裁判里选哪两个搭一对?对每一对列出意见不一致的条数、比例,以及「两人一致但判错」的条数。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex553_3.py
"""练习 3:人工只有 5% 的预算。哪两个裁判配成一对,送人工的比例最低、一致的那部分又最干净?"""
import json
from itertools import combinations
from pathlib import Path

HERE = Path(__file__).parent
pool = json.loads((HERE / "data" / "judge_pool.json").read_text())
human = [c["ok"] for c in pool]


def load(name: str) -> list[int]:
    rows = {r["id"]: r["judge"] for r in json.loads((HERE / "data" / f"judge_{name}.json").read_text())}
    return [rows[c["id"]] for c in pool]


judges = {n: load(n) for n in ("M", "C", "V")}
print(f"{'一对裁判':<8}{'意见不一致':>10}{'占比':>7}{'一致部分判错':>12}")
for a, b in combinations(judges, 2):
    split = [i for i in range(len(pool)) if judges[a][i] != judges[b][i]]
    same_wrong = sum(1 for i in range(len(pool)) if judges[a][i] == judges[b][i] and judges[a][i] != human[i])
    print(f"{a} 和 {b:<5}{len(split):>10}{len(split) / len(pool):>7.1%}{same_wrong:>12}")
```

<div class="line-notes">

- `for a, b in combinations(judges, 2):` `combinations` 从三个里取所有两两组合,共 3 对。
- `split = [i for i in range(len(pool)) if judges[a][i] != judges[b][i]]` 两个裁判意见不同的下标。
- `same_wrong = sum(1 for i in range(len(pool)) if judges[a][i] == judges[b][i] and judges[a][i] != human[i])` 两个裁判**一致,但一起错**的条数,这部分送不到人工那里,是漏网的。
- `print(f"{a} 和 {b:<5}{len(split):>10}{len(split) / len(pool):>7.1%}{same_wrong:>12}")` 每对一行。

</div>

```text
一对裁判         意见不一致     占比      一致部分判错
M 和 C            47   9.8%           9
M 和 V            48  10.0%           1
C 和 V            15   3.1%           1
```

C 和 V 这一对只有 15 条不一致(3.1%),低于 5% 的预算,一致部分只漏 1 条。M 和 C、M 和 V 都接近 10%,而且 M 和 C 一致的部分漏掉 9 条。两个好裁判搭一对,比「三个里有一个差的」又省人工又少漏。**裁判怎么搭比有几个重要。**

</details>

4. **(开放题)人工复核比例压到 5% 的方案。**每天抽样 3000 × 20%,不一致率分别是 11.5%、8%、5%,人工时间和费用各是多少?再列出你会做的三件事让不一致率降下来。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex553_4.py
"""练习 4 的示范:人工复核比例每降一档,每天的人工时间怎么变。数字是假设的,算式是真的。"""
DAILY, SAMPLE = 3000, 0.20            # 每天 3000 张,抽 20%
MIN_PER_REVIEW, HOURLY = 1.0, 100.0   # 假设:一张 1 分钟,一小时 100 元
for split in (0.115, 0.08, 0.05):
    n = DAILY * SAMPLE * split
    hours = n * MIN_PER_REVIEW / 60
    print(f"不一致率 {split:.1%}:每天 {n:.0f} 张送人工,{hours:.1f} 小时,¥{hours * HOURLY:.0f}")
```

<div class="line-notes">

- `DAILY, SAMPLE = 3000, 0.20            # 每天 3000 张,抽 20%` 每天评审 600 张。
- `MIN_PER_REVIEW, HOURLY = 1.0, 100.0   # 假设:一张 1 分钟,一小时 100 元` 两个假设,和 `judge_budget.py` 一致。
- `n = DAILY * SAMPLE * split` 每天送人工的张数。
- `hours = n * MIN_PER_REVIEW / 60` 换算成小时。

</div>

```text
不一致率 11.5%:每天 69 张送人工,1.1 小时,¥115
不一致率 8.0%:每天 48 张送人工,0.8 小时,¥80
不一致率 5.0%:每天 30 张送人工,0.5 小时,¥50
```

不一致率 11.5% 要每天 1.1 小时、约 ¥115;降到 5% 是 0.5 小时、约 ¥50,每天省 ¥65。我会做的三件事:一,像练习 3 那样去掉拖后腿的裁判,把 C 和 V 配成一对(实测不一致率 3.1%);二,把人工看完的不一致样本拿回来,逐条看是哪一类,针对性改 prompt 或补规则,每周一轮;三,风险低的工单类别只用单个裁判加金丝雀监控,不上评审团。第三件事我没有实验支持,是个假设,上线前要拿真实数据验证。

</details>

**验收标准**:`judge_monitor.py` 的 6 个测试全过;练习 1 能说出「多数投票和一票否决什么时候谁更好」;练习 3 的表里 C 和 V 一对最低;练习 4 的算式和 `judge_budget.py` 一致。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 评审团(panel / jury) | 多个裁判对同一条各判一次,按规则合成一个结论。成员最好来自不同模型家族(PoLL) |
| 多数投票 | 超过半数判通过才算通过。假设各裁判的错互相独立 |
| 一票否决 | 任何一个裁判判不通过就不通过。裁判的错全是「放过坏回复」时很有效,代价是误杀 |
| 相关错误 | 多个裁判在同一批样本上一起错,投票消除不了 |
| 分流 | 一致的采信,不一致的送人工 |
| 评审漂移 | 裁判因为 prompt、模型版本或输入变化而悄悄改变判断标准 |
| 金丝雀集 | 冻结的人工标注集,不参与调 prompt,只用来检测裁判有没有变 |
| 误报 | 没变却报了警。金丝雀里 fail 条数少时 6% 到 11% 很常见 |
| 标注员一致性 | 两个标注员独立标同一批样本的一致程度,用 kappa 量 |
| 标注指南 | 写明每个判断标准和边界例子的文档,带版本号,分歧的结论要写回去 |

## 常见误区

**多找几个裁判投票就可靠了。**今天三个裁判投票,判错 9 条,比最好的单裁判(1 条)差得多。三个都是同一个模型、只换 prompt,盲点相同。投票消除的只是互相独立的随机错误。

**裁判越多越好。**C 和 V 两个搭一对,不一致率 3.1%,漏判 1 条;三个裁判不一致率 11.5%。差的裁判多一个,多的是人工活。

**投票的价值是提高准确率。**更大的价值是分流:一致的采信,不一致的送人工,一致部分的 kappa 能到 0.99。

**裁判调好了就不用管了。**一句话的 prompt 改动就能让 TNR 从 0.70 掉到 0.24。裁判要有版本号和金丝雀集。

**金丝雀集越小越省事。**TNR 掉 10 个点,50 条 fail 的金丝雀只有 40% 概率报警,400 条才到 93%。太小的金丝雀等于没有。

**漂移报警响了就是裁判变了。**没掉也有 6% 到 11% 的误报。报警是线索,先重跑确认,再查原因。

**线上评审的成本主要是模型调用。**今天每天模型费不到 ¥1,人工 1 小时、约 ¥115(假设单价)。省钱要从降低不一致率和按风险抽样下手。

**人工标注就是标准答案,不用检查。**两个标注员的 kappa 可能只有 0.58。人和人都对不齐,先改标注指南,再谈裁判校准。

## 学习资料

### 文档与文章

- [Verga 等 · Replacing Judges with Juries](https://arxiv.org/abs/2404.18796):用多个来自不同模型家族的较小模型组成评审团(PoLL)的研究,摘要说它比单个大模型裁判更好、偏差更小、便宜七倍以上。今天的评审团设计出处,读摘要和实验部分。
- [Thakur 等 · Judging the Judges](https://arxiv.org/abs/2406.12624):比较了十三个裁判模型和人工的一致程度,发现只有最好、最大的模型才算对齐得合理,而且裁判对 prompt 复杂度和长度敏感、倾向宽松,读摘要和错误分析。
- [Zheng 等 · Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena](https://arxiv.org/abs/2306.05685):LLM 裁判的奠基论文,系统讨论位置偏差、冗长偏差、自我偏好,约 40 分钟。
- [Hamel Husain · LLM Evals FAQ](https://hamel.dev/blog/posts/evals-faq/):看「How many people should annotate my LLM outputs?」一条,讲单人决策和多人标注怎么用 kappa、怎么处理分歧,15 分钟。
- [Langfuse Annotation Queues](https://langfuse.com/docs/evaluation/evaluation-methods/annotation-queues):把 trace 放进人工标注队列,10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1wf4y1P7Mi&autoplay=0&high_quality=1" title="32.Kappa一致性检验" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>统计小菜鸟 · 32.Kappa一致性检验 · 4 分钟。kappa 是什么、怎么算、多少算好,对应今天标注员那一节。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1f13R6JEfP&autoplay=0&high_quality=1" title="【MT-Bench 实测】LLM-as-Judge 的四大偏差:位置/冗长/自我偏好/风格" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>古希腊掌管代码的神 · 【MT-Bench 实测】LLM-as-Judge 的四大偏差 · 4 分钟。今天看到的「同一个模型的几个裁判盲点相同」,和自我偏好是一个方向的问题。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/RKBibsoK7Yg" title="LLM-as-a-Judge Is Biased: 10 Hidden Biases You Need to Know" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Analytics Vidhya · LLM-as-a-Judge Is Biased: 10 Hidden Biases You Need to Know · 英文,把裁判的各种偏差列了一遍,当扩展清单看。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):评估一章讲 AI 当裁判的局限和做法,英文原版。我没有逐页核对,按章名找。

### 开源项目与代码

- [scikit-learn 的 cohen_kappa_score](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.cohen_kappa_score.html):今天用来核对手写的 kappa。
- [Label Studio](https://labelstud.io/) 和 [Argilla](https://github.com/argilla-io/argilla):人多了以后的开源标注平台。

## 自测

1. 为什么三个裁判多数投票,反而比其中最好的单个裁判差?

<details><summary>答案</summary>

三个裁判同一个模型、只换了 prompt,盲点相关:M 和 C 在「金额错了」的回复上一起放行(9 条同时判错,独立的话预期只有约 1.6 条)。多数票是 2 比 1,把判对的 V 投输了。多数投票只能消除互相独立的错误。

</details>

2. 投票的真正用处是什么?今天的数字是多少?

<details><summary>答案</summary>

分流:三个裁判意见一致的采信,不一致的送人工。今天不一致 55 条(11.5%),一致的 425 条只错 1 条(kappa 0.993)。

</details>

3. 为什么 `drift_check` 报警要两个条件?

<details><summary>答案</summary>

只看「掉了多少」会误报:金丝雀里 fail 只有几十条,TNR 自己就会抖几个点。第二个条件要求新区间的上限也低于基线,即使最乐观的估计也回不到基线,才算真掉了。代价是小漂移可能漏报,要扩大金丝雀里的 fail 条数才抓得到。

</details>

4. 金丝雀集里放多少条 fail,才有把握抓到 TNR 掉 10 个点?

<details><summary>答案</summary>

按今天的模拟:50 条 fail 报警率约 40%,100 条约 56%,200 条约 77%,400 条约 93%。同时误报率在 6% 到 11% 之间,所以报警后要先重跑确认。

</details>

5. 两个标注员 kappa 只有 0.58,你怎么做?

<details><summary>答案</summary>

先别开工,把分歧的样本逐条拿出来看,多半是标准没写清楚(比如「错退加购费算不算错」)。把结论写进标注指南、给指南加版本号,再标一轮,直到 kappa 稳定在 0.7 以上。日常留 10% 的样本两人都标,持续监控;分歧由一位懂业务的人拍板,拍板理由回流进指南。今天的模拟里,写进一句话 kappa 就从 0.58 升到 0.95。

</details>

6. (面试题)线上评审用三个 LLM 裁判投票,你觉得有什么问题?怎么改进?

<details><summary>答案</summary>

问题:一,如果三个是同一个模型或同一个思路,错误相关,投票消除不了,今天实测多数投票的 TNR 比最好的单裁判还低;二,成本是三倍,而主要收益是分流不是准确率;三,裁判会漂移,没有金丝雀集就发现不了。改进:裁判要尽量不同(不同模型家族、不同 prompt、不同判断角度,比如一个看政策一个核对数字);把投票当分流用,一致的采信、不一致的送人工;如果裁判错的方向一致(都偏松),可以考虑一票否决;建金丝雀集每周重跑,金丝雀里 fail 要够多;人工复核回流进校准集;按风险调抽样比例。

</details>

## 明天预告

Day 554 · 线上评测(一):离线和线上,实验五要素,指标。到今天为止,所有评测都是离线的:拿一份固定的用例集,跑 v1 和 v2,比较分数。可是离线分数涨了,线上用户未必满意,明天讲为什么离线和线上会不一致,一个线上实验需要哪五个要素(假设、指标、分流、样本量、决策规则),以及怎么选指标。
