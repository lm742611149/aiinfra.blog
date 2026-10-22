---
title: 'Day 363 · 第 52 周复习:评测与可观测(Day 357–362)'
description: '这一周评测对象换了两次:先是 Agent 写的回复(评分 prompt、和人对齐、偏差和成本),再是 Agent 做的事(结果和轨迹、四种匹配、模拟客户)。今天默写 match()、kappa 和两处「角色翻译」并跑通,再用本周的东西给 Day 362 的 14 段多轮对话出一份完整评测报告:修正后的通过率算出了 100.6%,Day 361 预言的「2392 和 2392.0」也真的踩到了。'
pubDate: 2026-10-22
regime: none
tags: ['eval', 'review', 'agent-zero']
series: 'agent-zero'
day: 363
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 362](/blog/agent-zero/day-362-simulated-user/) 让另一个模型照着剧本扮演客户,和工单 Agent 最多聊 5 轮。4 条用例各跑 3 次,结果评测和轨迹检查全过;读完对话却发现 Agent 编了一条「账户设置 → 订阅管理 → 取消自动续费」的后台路径,还在客户只是问一句的时候就把退款提交了。练习里又加了一条 C013 的用例,两次都过,可第一轮都说错了话。

这一周的六课,评测对象换了两次。前三天评的是 Agent 写出来的回复,用的是 LLM 评分器;后三天评的是 Agent 做了什么,用的是数据库终态、工具调用轨迹和多轮对话。今天停一天,把它们拼成一张图,默写三段核心代码,再用一个小项目把六天的东西串起来跑一遍。

## 今天要解决的问题

学完今天,你应该能:

1. 说出这一周每一课在「评一次 Agent 运行」这件事里管哪一块,并说清楚结果、轨迹、回复三种评法各抓什么、漏什么。
2. 合上文章默写 Day 361 的 `match()`,和原版在 168 次比较上 0 个不一致。
3. 合上文章默写 Day 358 的 TPR、TNR、kappa 和修正公式,用 Day 358 test 上的数字核对到小数点后三位。
4. 默写 Day 359 和 Day 362 里那两处「翻译」(交换顺序后把 A/B 翻回来、把对话翻成模拟客户视角),并用断言验证。
5. 用本周知识拼一个 `week52_report.py`,给 Day 362 的多轮对话出一份「结果 + 轨迹 + 回复 + 警告」的报告,并读懂报告里那个超过 100% 的数。

预计用时 3.5 小时:三段默写各 30 分钟,小项目 1 小时,剩下的时间做练习和自测。前置:[Day 357](/blog/agent-zero/day-357-llm-judge-2/) 到 [Day 362](/blog/agent-zero/day-362-simulated-user/) 全部,以及它们留在 `part06/` 下的文件(`llm_judge.py`、`align.py`、`trajectory_match.py`、`trajectory.py`、`run_multiturn.py`、`traj/`、`traj_fake/`、`dialogs/`)。默写三段都不调模型;小项目和练习 4 调评分器,今天实跑合计约 0.10 元,算式在小项目末尾。

学法和平时一样:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章把三段默写代码再写一遍;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 本周知识地图

一次 Agent 运行(单轮或多轮)结束后,我们手里有三样东西:数据库变成了什么样、它调了哪些工具、它说了什么话。这一周的六课,就是分别给这三样东西配评法,再把输入从「一句工单」扩成「一段对话」。

<figure>
<svg viewBox="0 0 640 320" role="img" aria-label="第 52 周知识地图:一次 Agent 运行产生三样东西,数据库终态由结果评测判,工具调用由轨迹检查判,回复由 LLM 评分器判;评分器要写好 prompt、和人对齐、控制偏差和成本;多轮输入由模拟客户产生">
<rect x="0" y="0" width="640" height="320" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="20" width="160" height="52" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="96" y="42" fill="var(--ink)" text-anchor="middle">模拟客户</text>
<text x="96" y="60" fill="var(--ink-soft)" text-anchor="middle" font-size="11">362 多轮输入</text>
<path d="M176 46 L236 46" stroke="var(--ink-faint)" marker-end="url(#m363)"/>
<rect x="240" y="20" width="160" height="52" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="42" fill="var(--ink)" text-anchor="middle">一次 Agent 运行</text>
<text x="320" y="60" fill="var(--ink-soft)" text-anchor="middle" font-size="11">360 traj_agent</text>
<path d="M280 72 L110 118" stroke="var(--ink-faint)" marker-end="url(#m363)"/>
<path d="M320 72 L320 118" stroke="var(--ink-faint)" marker-end="url(#m363)"/>
<path d="M360 72 L530 118" stroke="var(--ink-faint)" marker-end="url(#m363)"/>
<rect x="16" y="122" width="190" height="60" rx="5" fill="none" stroke="var(--ink-soft)"/>
<text x="111" y="144" fill="var(--ink)" text-anchor="middle">数据库终态</text>
<text x="111" y="164" fill="var(--ink-soft)" text-anchor="middle" font-size="11">360 结果评测 · 判题器</text>
<rect x="225" y="122" width="190" height="60" rx="5" fill="none" stroke="var(--ink-soft)"/>
<text x="320" y="144" fill="var(--ink)" text-anchor="middle">工具调用轨迹</text>
<text x="320" y="164" fill="var(--ink-soft)" text-anchor="middle" font-size="11">361 四种匹配 + 五条规则</text>
<rect x="434" y="122" width="190" height="60" rx="5" fill="none" stroke="var(--ink-soft)"/>
<text x="529" y="144" fill="var(--ink)" text-anchor="middle">说的话(回复)</text>
<text x="529" y="164" fill="var(--ink-soft)" text-anchor="middle" font-size="11">357 评分 prompt</text>
<path d="M529 182 L529 214" stroke="var(--ink-faint)" marker-end="url(#m363)"/>
<rect x="434" y="218" width="190" height="40" rx="5" fill="none" stroke="var(--ink-soft)"/>
<text x="529" y="243" fill="var(--ink-soft)" text-anchor="middle" font-size="11">358 对齐 TPR/TNR/kappa</text>
<path d="M529 258 L529 270" stroke="var(--ink-faint)" marker-end="url(#m363)"/>
<rect x="434" y="274" width="190" height="36" rx="5" fill="none" stroke="var(--ink-soft)"/>
<text x="529" y="297" fill="var(--ink-soft)" text-anchor="middle" font-size="11">359 位置/长度偏差 · 成本</text>
<text x="16" y="222" fill="var(--ink)">确定性的:代码判,不用对齐</text>
<text x="16" y="244" fill="var(--ink-soft)" font-size="11">结果是主,轨迹是约束;</text>
<text x="16" y="262" fill="var(--ink-soft)" font-size="11">轨迹只写必须和禁止</text>
<text x="16" y="294" fill="var(--ink-faint)" font-size="11">今天的小项目:三列一起出报告</text>
<defs><marker id="m363" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--ink-faint)"/></marker></defs>
</g>
</svg>
<figcaption>一次运行,三样产出,三种评法。左边两列用代码判,结果确定;右边一列要用模型判,所以多了对齐、偏差、成本三件事要管。模拟客户在最上游,负责把输入变成一段对话。</figcaption>
</figure>

这张图里最值得记住的是左右两边的区别。数据库终态和工具调用都是确定的数据,代码一判就准,不需要对齐;回复是自然语言,只能靠模型判,于是就有了 Day 358 的对齐和 Day 359 的偏差。所以这一周的顺序其实是倒着讲的:先讲了最难的那一列,再讲最简单的两列。实际做评测时反过来,能用代码判的先用代码判完,剩下的才交给评分器。

## 本周每天一句话

- [Day 357](/blog/agent-zero/day-357-llm-judge-2/) · 评分 prompt 怎么写:一个评分器只判一件事,二元判定,先写理由再给结论,给判定标准和例子,要点由用例提供;`judge_facts` 和版本号 `facts-v1` 是这天建的。
- [Day 358](/blog/agent-zero/day-358-llm-judge-3/) · 和人工对齐:亲手标 40 条,分 train/dev/test,看 TPR、TNR 和 kappa 而不是准确率;facts-v1 在 test 上 TPR 0.923、TNR 1.000、kappa 0.870;用 TPR 和 TNR 修正评分器报的通过率。
- [Day 359](/blog/agent-zero/day-359-llm-judge-4/) · 偏差和成本:两两比较要交换顺序各判一次,两次不一致记平局;长度偏差用「内容不变只改长度」的对照实验测;一轮 450 次评分约三毛钱,钱的乘数是次数 × 评分器数 × trial 数。
- [Day 360](/blog/agent-zero/day-360-trajectory-1/) · 结果和轨迹:结果评测看库里的最终状态,抓「说了没做」;轨迹评测看工具名加参数,抓「结果对了但查了别人」;结果是主,轨迹是约束,不写标准路径。
- [Day 361](/blog/agent-zero/day-361-trajectory-2/) · 四种匹配和轨迹检查:strict、unordered、subset、superset 用 `Counter` 二十行实现;参数按关键字段比;规则式检查写顺序、越权、重复、参数、预算五条,客服场景推荐 superset 加规则。
- [Day 362](/blog/agent-zero/day-362-simulated-user/) · 模拟客户:写死的剧本接不上,用另一个模型扮客户;角色要反过来,规则写清楚被问才说、不许编、什么时候结束;分数之外一定要读对话,模拟客户自己也要检查。

## 默写一:四种匹配模式

这是本周最短、也最容易被问到的一段。先自己在空文件里写,写完再和 Day 361 的 `trajectory_match.match` 在全部 14 条轨迹上逐个比。

```python
# agent-zero-lab/part06/drill_match.py
"""默写一:四种匹配模式。写完和 Day 361 的 trajectory_match.match 在全部轨迹上对一遍。不调模型。"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from part06.trajectory_match import KEY_ARGS, MODES
from part06.trajectory_match import match as day361_match


def key(tc: dict, args: str) -> str:
    if args == "ignore":
        return tc["name"]
    picked = tc["args"] if args == "exact" else {k: tc["args"].get(k) for k in KEY_ARGS.get(tc["name"], [])}
    return tc["name"] + json.dumps(picked, sort_keys=True, ensure_ascii=False)


def my_match(actual: list[dict], reference: list[dict], mode: str, args: str = "ignore") -> bool:
    a = [key(tc, args) for tc in actual]
    r = [key(tc, args) for tc in reference]
    if mode == "strict":
        return a == r
    if mode == "unordered":
        return Counter(a) == Counter(r)
    if mode == "subset":
        return not (Counter(a) - Counter(r))
    return not (Counter(r) - Counter(a))      # superset


paths = sorted(Path("part06/traj").glob("*.json")) + sorted(Path("part06/traj_fake").glob("*.json"))
runs = {p.stem: json.loads(p.read_text(encoding="utf-8"))["tool_calls"] for p in paths}
ref = runs["run-c007-1"]
diff = total = 0
for mode in MODES:
    for args in ("ignore", "exact", "keys"):
        for name, got in runs.items():
            total += 1
            if my_match(got, ref, mode, args) != day361_match(got, ref, mode, args):
                diff += 1
                print(f"不一致 {mode}/{args} {name}")
print(f"{total} 次比较,不一致 {diff} 次")
```

<div class="line-notes">

- `from part06.trajectory_match import KEY_ARGS, MODES` 关键参数表和四种模式名不用默写,直接借。要默写的是两个函数。
- `from part06.trajectory_match import match as day361_match` `import ... as` 起个别名,免得和自己写的重名。相当于 JS 的 `import { match as day361Match } from ...`。
- `def key(tc: dict, args: str) -> str:` 默写版把参数类型写成了普通 `str`,没写 Day 361 的 `Literal`。能跑,只是传错字符串时编辑器不再画红线。
- `picked = tc["args"] if args == "exact" else {k: tc["args"].get(k) for k in KEY_ARGS.get(tc["name"], [])}` 这一行最容易漏的是 `.get(tc["name"], [])` 的默认值:`search_policy` 不在 `KEY_ARGS` 里,不给默认值会 `KeyError`。
- `return tc["name"] + json.dumps(picked, sort_keys=True, ensure_ascii=False)` 第二容易漏的是 `sort_keys=True`。不排序的话,模型给的参数顺序一变,同一个调用就变成两个字符串。
- `return not (Counter(a) - Counter(r))` subset:实际减参考为空。默写时最常见的错误是把 subset 和 superset 的减法方向写反,记法是「谁不许多,谁在减号左边」:subset 不许实际多,所以实际在左边。
- `return not (Counter(r) - Counter(a))      # superset` 前三种都没命中就是 superset,默写版省掉了 Day 361 那个 `raise ValueError`。
- `paths = sorted(Path("part06/traj").glob("*.json")) + sorted(Path("part06/traj_fake").glob("*.json"))` Day 360 的 12 条真实轨迹加 Day 361 的两条手工坏轨迹。
- `diff = total = 0` 连等赋值,两个变量都是 0。

</div>

在 `agent-zero-lab` 根目录跑:

```bash
uv run python -m part06.drill_match
```

实测输出:

```text
168 次比较,不一致 0 次
```

4 种模式 × 3 种参数比法 × 14 条轨迹 = 168 次,一次不差。如果你的版本有不一致,打印出来的那行会告诉你是哪种模式、哪种参数比法、哪条轨迹,拿那条轨迹手算一遍,通常是减法方向或 `sort_keys` 的问题。

## 默写二:TPR、TNR、kappa 和修正公式

Day 358 的四个指标,公式不长,但分子分母很容易写串。拿 Day 358 在 test 上的真实结果当答案:人判 pass 的 13 条里评分器漏判 1 条,人判 fail 的 5 条全抓住。

```python
# agent-zero-lab/part06/drill_kappa.py
"""默写二:混淆矩阵、TPR、TNR、kappa 和修正通过率。拿 Day 358 test 上的结果核对。不调模型。"""
from __future__ import annotations

from part06.align import metrics


def my_metrics(pairs: list[tuple[str, str]]) -> dict[str, float]:
    tp = sum(h == "pass" and j == "pass" for h, j in pairs)
    fn = sum(h == "pass" and j == "fail" for h, j in pairs)
    fp = sum(h == "fail" and j == "pass" for h, j in pairs)
    tn = sum(h == "fail" and j == "fail" for h, j in pairs)
    n = len(pairs)
    po = (tp + tn) / n
    pe = (tp + fn) / n * (tp + fp) / n + (fp + tn) / n * (fn + tn) / n
    return {"tpr": tp / (tp + fn), "tnr": tn / (tn + fp), "acc": po, "kappa": (po - pe) / (1 - pe)}


def my_corrected(p_obs: float, tpr: float, tnr: float) -> float:
    return (p_obs + tnr - 1) / (tpr + tnr - 1)


# Day 358 在 test 上的结果:人判 pass 13 条(评分器漏判 1 条),人判 fail 5 条(全抓住)
pairs = [("pass", "pass")] * 12 + [("pass", "fail")] + [("fail", "fail")] * 5
mine, theirs = my_metrics(pairs), metrics(pairs)
for k in ("tpr", "tnr", "acc", "kappa"):
    print(f"{k:<6} 默写 {mine[k]:.3f}  Day 358 {theirs[k]:.3f}")
print(f"评分器报 80%,修正后 {my_corrected(0.80, mine['tpr'], mine['tnr']):.3f}")
```

<div class="line-notes">

- `from part06.align import metrics` Day 358 的原版,用来对答案。
- `tp = sum(h == "pass" and j == "pass" for h, j in pairs)` 每对是 `(人, 评分器)`。布尔值求和就是计数。这里 `tp` 是 12。
- `fn = sum(h == "pass" and j == "fail" for h, j in pairs)` 人说 pass、评分器说 fail:冤枉了好回复。这里是 1。
- `fp = sum(h == "fail" and j == "pass" for h, j in pairs)` 人说 fail、评分器说 pass:放过了坏回复。这里是 0。记法:F/T 说评分器判得对不对,P/N 说评分器给的结论。
- `pe = (tp + fn) / n * (tp + fp) / n + (fp + tn) / n * (fn + tn) / n` 碰巧一致率:人说 pass 的比例 × 评分器说 pass 的比例,加上两边都说 fail 的同样乘积。代入是 13/18 × 12/18 + 5/18 × 6/18 = 0.4815 + 0.0926 = 0.574。
- `return {"tpr": tp / (tp + fn), "tnr": tn / (tn + fp), "acc": po, "kappa": (po - pe) / (1 - pe)}` TPR 的分母是「人说 pass 的」,TNR 的分母是「人说 fail 的」,分母都按人来分。kappa = (0.944 − 0.574) / (1 − 0.574) = 0.870。默写版没处理分母为 0 的情况,原版有,用在只有一类标注的数据上会报 `ZeroDivisionError`。
- `return (p_obs + tnr - 1) / (tpr + tnr - 1)` 修正公式。推导的直觉:评分器报的通过率 = 真实通过率 × TPR + (1 − 真实通过率) × (1 − TNR),把真实通过率解出来就是这一行。
- `pairs = [("pass", "pass")] * 12 + [("pass", "fail")] + [("fail", "fail")] * 5` 列表乘整数是重复,`[x] * 12` 就是 12 个 x,相当于 JS 的 `Array(12).fill(x)`。拼起来正好 18 条。

</div>

```bash
uv run python -m part06.drill_kappa
```

实测输出:

```text
tpr    默写 0.923  Day 358 0.923
tnr    默写 1.000  Day 358 1.000
acc    默写 0.944  Day 358 0.944
kappa  默写 0.870  Day 358 0.870
评分器报 80%,修正后 0.867
```

四个数和 Day 358 文章里 test 那一行一字不差,修正后的 86.7% 也和那天手算的一样。

## 默写三:两处「翻译」

这一周有两个地方,代码本身只有几行,但脑子里要先翻一道:Day 359 交换顺序判两次以后,第二次的 A/B 要翻回 x/y 才能比;Day 362 把对话记录交给模拟客户时,customer 和 agent 要翻成 assistant 和 user。两个都写错过的人很多,所以放在一起默写,用断言检查。

```python
# agent-zero-lab/part06/drill_roles.py
"""默写三:两处「翻译」。Day 359 交换顺序后把 A/B 翻回 x/y;Day 362 把对话记录翻成模拟客户视角。不调模型。"""
from __future__ import annotations

A_FIRST = {"A": "x", "B": "y", "tie": "tie"}     # x 放在 A 位时
Y_FIRST = {"A": "y", "B": "x", "tie": "tie"}     # y 放在 A 位时


def final_winner(first: str, second: str) -> str:
    r1, r2 = A_FIRST[first], Y_FIRST[second]
    return r1 if r1 == r2 else "tie"


def to_sim_messages(system: str, history: list[dict]) -> list[dict]:
    msgs = [{"role": "system", "content": system}]
    for h in history:
        msgs.append({"role": "assistant" if h["role"] == "customer" else "user", "content": h["text"]})
    return msgs


assert final_winner("A", "B") == "x"          # 两次都选 x
assert final_winner("A", "A") == "tie"        # 两次都选前面那个:位置偏差,记平局
assert final_winner("tie", "tie") == "tie"
hist = [{"role": "customer", "text": "退款"}, {"role": "agent", "text": "请问是哪种?"}]
msgs = to_sim_messages("你扮演客户", hist)
assert [m["role"] for m in msgs] == ["system", "assistant", "user"]
print("4 个断言全过")
print(msgs)
```

<div class="line-notes">

- `A_FIRST = {"A": "x", "B": "y", "tie": "tie"}     # x 放在 A 位时` 第一次判:x 在 A 位,评分器说 A 赢就是 x 赢。用字典做翻译表,比写一串 if 清楚。
- `Y_FIRST = {"A": "y", "B": "x", "tie": "tie"}     # y 放在 A 位时` 第二次判:位置换了,评分器说 A 赢,这回是 y 赢。
- `return r1 if r1 == r2 else "tie"` 两次翻译完一致才算数,不一致记平局。这是 Day 359 治位置偏差的那一招。
- `msgs.append({"role": "assistant" if h["role"] == "customer" else "user", "content": h["text"]})` 模拟客户自己的话是 assistant。
- `assert final_winner("A", "A") == "tie"        # 两次都选前面那个:位置偏差,记平局` 两次都选 A 位,翻译后一次是 x 一次是 y,说明它看的是位置不是内容。`assert 条件` 不成立就抛 `AssertionError`,和 Day 71 学的 pytest 里的断言是同一个关键字。
- `assert [m["role"] for m in msgs] == ["system", "assistant", "user"]` 只检查角色顺序。客户第一句「退款」必须是 assistant。

</div>

```bash
uv run python -m part06.drill_roles
```

实测输出:

```text
4 个断言全过
[{'role': 'system', 'content': '你扮演客户'}, {'role': 'assistant', 'content': '退款'}, {'role': 'user', 'content': '请问是哪种?'}]
```

你可以故意把 `Y_FIRST` 写成和 `A_FIRST` 一样,再跑一次,会看到第一个断言就挂了:`AssertionError`,没有说明文字,行号指向 `assert final_winner("A", "B") == "x"`。这也是为什么断言后面最好跟一句注释,挂的时候一眼知道它在测什么。

## 小项目:给多轮对话出一份评测报告

Day 362 留下了 14 段对话(正文 12 段 + 练习 1 的 2 段),每段都有 `refunds`、`tool_calls` 和 `history`。今天用本周的全部东西给它们出一份报告:

| 列 | 判什么 | 来自哪天 |
| --- | --- | --- |
| 结果 | 库里的退款和判题器一致 | Day 360 `outcome`(Day 362 搬进 `run_multiturn.py`) |
| 轨迹 | 顺序、越权、重复三条规则 | Day 361 `trajectory.py` |
| 回复 | 客服说的话有没有讲到要点、有没有矛盾 | Day 357 `judge_facts` |
| 修正 | 回复通过率按评分器的 TPR/TNR 修正 | Day 358 |
| 警告 | 编了后台路径,不算分,标出来给人看 | Day 362 读对话的发现 |
| pass^k | 每条用例几次全过 | Day 344,Day 362 用过 |

多轮对话的回复怎么判,有一个取舍:要点可能分散在好几轮里说(第一轮讲政策、第二轮报金额),只判最后一句会冤枉它。所以这里把客服说过的所有话拼起来交给评分器,把客户说的所有话拼起来当「工单」。代价是 Day 362 练习 4 看到的那种「第一轮说错、后面改口」,拼起来以后要看评分器怎么权衡。

```python
# agent-zero-lab/part06/week52_report.py
"""第 52 周小项目:给 Day 362 的多轮对话出一份评测报告。
结果(查库)+ 轨迹(规则)+ 回复(LLM 评分器,按 Day 358 的 TPR/TNR 修正)+ 一个读对话时发现的警告。"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

from part06.llm_judge import JUDGE_VERSION, USAGE, judge_facts
from part06.run_multiturn import outcome
from part06.trajectory import check_no_repeat, check_order, check_scope

FACTS = {
    "mt-cancel-c023": ["按剩余整月退款,金额 6578 元", "当月不退", "退款要等主管审批"],
    "mt-dup-c007": ["10 月 8 日有两张同金额的已付发票,属于重复扣款", "退的是 INV-2026-0123,2392 元", "退款要等主管审批"],
    "mt-dup-c012": ["10 月 8 日只有一张发票,而且还没付款", "不存在重复扣款,不需要退款"],
    "mt-monthly-c002": ["月付中途取消不退款", "可以用到本期结束 2026-11-11"],
    "mt-cancel-c013": ["本期(2026-10-09 那张)年费还没付,没有可退的钱"],
}
TPR, TNR = 0.923, 1.0                                 # Day 358 facts-v1 在 test 上的对齐结果
UI_PATH = re.compile(r"→[^。\n]*(设置|订阅|计费|账单)")

cases = {}
for f in ["part06/cases/multiturn.jsonl", "part06/cases/multiturn_ex1.jsonl"]:
    for line in Path(f).read_text(encoding="utf-8").splitlines():
        if line.strip():
            c = json.loads(line)
            cases[c["id"]] = c

rows = []
for path in sorted(Path("part06/dialogs").glob("*.json")):
    run = json.loads(path.read_text(encoding="utf-8"))
    case = cases[run["case"]]
    agent_text = "\n".join(h["text"] for h in run["history"] if h["role"] == "agent")
    customer_text = "\n".join(h["text"] for h in run["history"] if h["role"] == "customer")
    checks = {"outcome": outcome(case, run)[0], "order": check_order(run)[0],
              "scope": check_scope(run)[0], "no_repeat": check_no_repeat(run)[0]}
    v = judge_facts(customer_text, agent_text, FACTS[case["id"]])
    rows.append({"name": path.stem, "case": case["id"], **checks, "reply": v.verdict,
                 "ui_path": bool(UI_PATH.search(agent_text))})

print(f"{'对话':<20}{'结果':<5}{'轨迹':<5}{'回复':<8}警告")
for r in rows:
    traj = all(r[k] for k in ("order", "scope", "no_repeat"))
    warn = "编了后台路径" if r["ui_path"] else ""
    print(f"{r['name']:<20}{'✓' if r['outcome'] else '✗':<5}{'✓' if traj else '✗':<5}{r['reply']:<8}{warn}")

n = len(rows)
p_reply = sum(r["reply"] == "pass" for r in rows) / n
by_case: dict[str, list[bool]] = defaultdict(list)
for r in rows:
    by_case[r["case"]].append(r["outcome"] and r["order"] and r["scope"] and r["no_repeat"] and r["reply"] == "pass")
print(f"\n共 {n} 段对话")
print(f"结果通过 {sum(r['outcome'] for r in rows)}/{n},轨迹通过 {sum(r['order'] and r['scope'] and r['no_repeat'] for r in rows)}/{n}")
print(f"回复:评分器 {JUDGE_VERSION} 报 {p_reply:.1%},按 TPR {TPR} / TNR {TNR} 修正后约 {(p_reply + TNR - 1) / (TPR + TNR - 1):.1%}")
print(f"警告:{sum(r['ui_path'] for r in rows)} 段编了后台路径(没算进分数,要人看)")
for cid, oks in by_case.items():
    print(f"  {cid:<17} {sum(oks)}/{len(oks)} 段全过  pass^{len(oks)} = {int(all(oks))}")
print(f"评分器调用 {USAGE['calls']} 次 · 输入 {USAGE['in']} · 输出 {USAGE['out']}")
```

<div class="line-notes">

- `from collections import defaultdict` 带默认值的字典:访问不存在的键时自动建一个默认值。`defaultdict(list)` 第一次访问某个键就给它一个空列表,省了 `if k not in d: d[k] = []`。相当于 JS 里 `(m[k] ??= []).push(x)`。
- `from part06.run_multiturn import outcome` Day 362 写的多轮版结果评测,场景从用例里读。注意 `run_multiturn.py` 的跑对话代码都在 `if __name__ == "__main__":` 里,import 它不会触发对话。
- `FACTS = {` 每条用例的要点。Day 357 说过要点由用例提供,正式的测试集里它是用例的一个字段;今天用例文件是 Day 362 写的,没有这个字段,就在这里补。
- `"mt-cancel-c013": ["本期(2026-10-09 那张)年费还没付,没有可退的钱"],` C013 只写一条必须说到的要点。Day 362 练习 4 把「不能承诺免除」也塞进要点,造成了假失败,今天不再这么写,禁止类的放到练习 4 单独判。
- `TPR, TNR = 0.923, 1.0                                 # Day 358 facts-v1 在 test 上的对齐结果` 这两个数是在单轮回复上对齐出来的,拿到多轮拼接的回复上用,严格说要重新对齐。先借来用,报告里要写明。
- `UI_PATH = re.compile(r"→[^。\n]*(设置|订阅|计费|账单)")` Day 362 练习 2 的正则太宽(「后台同事」也命中),这里收紧:箭头后面跟着设置、订阅这类菜单词才算。练习 2 会看到它又漏了什么。
- `cases = {}` 用例 id → 用例,两个 jsonl 文件合在一起。
- `agent_text = "\n".join(h["text"] for h in run["history"] if h["role"] == "agent")` 客服说过的所有话,用换行连起来。
- `checks = {"outcome": outcome(case, run)[0], "order": check_order(run)[0],` 每个检查只取「过没过」那个布尔值,说明文字报告里不要。
- `v = judge_facts(customer_text, agent_text, FACTS[case["id"]])` 每段对话调一次评分器,14 段就是 14 次。
- `rows.append({"name": path.stem, "case": case["id"], **checks, "reply": v.verdict,` 一段对话一行,`**checks` 把四个检查结果展开进去。
- `print(f"{'对话':<20}{'结果':<5}{'轨迹':<5}{'回复':<8}警告")` 表头。`{'对话':<20}` 字符串常量也能在 f-string 里格式化。中文字符在终端里占两格,所以中文表头对得不太齐,不影响读。
- `traj = all(r[k] for k in ("order", "scope", "no_repeat"))` `all()` 全部为真才是真,相当于 JS 的 `arr.every(...)`。
- `p_reply = sum(r["reply"] == "pass" for r in rows) / n` 回复通过率,评分器报的原始值。
- `by_case[r["case"]].append(r["outcome"] and r["order"] and r["scope"] and r["no_repeat"] and r["reply"] == "pass")` 每段对话「全部都过」记一个布尔值,按用例分组。警告不算在内。
- `print(f"回复:评分器 {JUDGE_VERSION} 报 {p_reply:.1%},按 TPR {TPR} / TNR {TNR} 修正后约 {(p_reply + TNR - 1) / (TPR + TNR - 1):.1%}")` `:.1%` 把小数格式化成百分数、保留一位,0.929 打印成 `92.9%`。修正公式直接写在花括号里。
- `print(f"  {cid:<17} {sum(oks)}/{len(oks)} 段全过  pass^{len(oks)} = {int(all(oks))}")` `int(True)` 是 1。C013 只跑了 2 次,所以那一行是 pass^2。

</div>

```bash
uv run python -m part06.week52_report
```

实测输出:

```text
对话                  结果   轨迹   回复      警告
mt-cancel-c013-1    ✓    ✓    pass    
mt-cancel-c013-2    ✓    ✓    fail    编了后台路径
mt-cancel-c023-1    ✓    ✓    pass    
mt-cancel-c023-2    ✓    ✓    pass    
mt-cancel-c023-3    ✓    ✓    pass    
mt-dup-c007-1       ✓    ✓    pass    
mt-dup-c007-2       ✓    ✓    pass    
mt-dup-c007-3       ✓    ✓    pass    
mt-dup-c012-1       ✓    ✓    pass    
mt-dup-c012-2       ✓    ✓    pass    
mt-dup-c012-3       ✓    ✓    pass    
mt-monthly-c002-1   ✓    ✓    pass    编了后台路径
mt-monthly-c002-2   ✓    ✓    pass    编了后台路径
mt-monthly-c002-3   ✓    ✓    pass    

共 14 段对话
结果通过 14/14,轨迹通过 14/14
回复:评分器 facts-v1 报 92.9%,按 TPR 0.923 / TNR 1.0 修正后约 100.6%
警告:3 段编了后台路径(没算进分数,要人看)
  mt-cancel-c013    1/2 段全过  pass^2 = 0
  mt-cancel-c023    3/3 段全过  pass^3 = 1
  mt-dup-c007       3/3 段全过  pass^3 = 1
  mt-dup-c012       3/3 段全过  pass^3 = 1
  mt-monthly-c002   3/3 段全过  pass^3 = 1
评分器调用 14 次 · 输入 15779 · 输出 1076
```

一行一行读这份报告。

**回复那一列只有一个 fail,是 `mt-cancel-c013-2`。** 我单独把它的理由打出来:评分器说回复「开头明确说『可以退』并给出约 1089 元的预估退款金额,与『没有可退的钱』直接矛盾」。这正是 Day 362 练习 1 读对话时发现的那句。而 `mt-cancel-c013-1` 判了 pass,理由是「多次明确表达了未付账单不涉及退款」:它第一轮虽然也说「可以按剩余整月退款」,但没说出「可以退」三个字和具体金额,后面又说清楚了,评分器在拼接文本上就放过了它。拼接的代价在这里显出来了:第一轮的错话被后面的对话稀释了。要抓这种「先说错再改口」,还是得逐轮判。

**修正后约 100.6%。** 通过率超过了 100%,这不是代码写错了。修正公式的分子是 0.929 + 1.0 − 1 = 0.929,分母是 0.923 + 1.0 − 1 = 0.923,分子比分母大。意思是:按 Day 358 的数字,这个评分器会冤枉 7.7% 的好回复,所以它报 92.9% 时,真实值应该更高;可 14 条里只有一条 fail,真实值最高也就 100%,两者对不上。原因有两个:一是 TPR 0.923 只来自 13 条 pass 样本,误差很大([Day 353](/blog/agent-zero/day-353-stats-intuition/) 的抽样误差),二是这 14 段对话太少,92.9% 本身的误差也有十几个百分点。Day 358 的练习 3 讲过公式什么时候失效,这就是一次。练习 1 会给它加截断。汇报时我会这么写:「facts-v1 报 13/14,修正后无意义(样本太少),人工复核了唯一一条 fail,确认是真问题」。

**警告 3 段,没进分数。** 编路径这件事 Day 362 刚发现,还没有对齐过的检查,只是一条正则。正则的准确率没验证过,直接算进分数会让分数失真,所以只作为警告列出来,让人去看。新发现的问题,先警告,攒够例子、对齐过了,再升级成正式的评分项,这是 Day 345 错误分析那套流程的最后一步。

**pass^k。** C013 那条 pass^2 = 0,是被回复评分器拉下来的;其他四条全是 1。如果只看结果和轨迹,五条都是 1。

算账:评分器 14 次,15779 × 2 / 100 万 + 1076 × 8 / 100 万 ≈ 0.032 + 0.009 = 0.04 元。我写文章时手滑,在另一个命令里 `import` 了 `week52_report`,模块顶层的代码又整个跑了一遍,多花了约 0.04 元(这也是个教训:脚本主体不放进 `if __name__ == "__main__":`,被 import 时就会执行)。加上单独打印 C013 两条理由的 2 次调用和练习 4 的 7 次调用(约 0.01 元),今天合计约 0.10 元。

## 本周错题与坑清单

这一周我自己写代码、写文章时真踩过的坑,按出现的天排:

- **评分 prompt 不给要点**(Day 357):评分器只能凭自己的理解判,同一条回复今天 pass 明天 fail。要点由用例提供,写进 prompt。
- **只看准确率**(Day 358):永远说 pass 的「评分器」在 dev 上准确率 73%,kappa 是 0。看 TPR、TNR、kappa。
- **读了 test 上的错例去改 prompt**(Day 358):test 就变成第二个 dev,分数不干净了。test 只在最后跑一次。
- **两两比较只判一次**(Day 359):不交换顺序,位置偏差就混进结论里。交换各判一次,不一致记平局。
- **用 1 到 10 分打分**(Day 359):包了一层客套话的错回复,分数被抬高。二元判定加要点更稳。
- **只评回复**(Day 360):C023 回复讲全了要点却没提交退款。会做事的 Agent,要看库。
- **只评结果**(Day 360):删了半句 prompt,Agent 顺手查了 C028,结果评测满分。要看轨迹参数。
- **把一条成功轨迹当标准路径**(Day 360):多查一次政策的 `run-c023-4` 被判失败。只写必须和禁止。
- **agentevals 里所有调用塞一条消息**(Day 361):strict 不比消息内部顺序,先退款后查发票被放过。一次调用一条消息。
- **预算上限拍脑袋**(Day 361):5000 把正常的 5106 判超。从正常轨迹的分布里定。
- **用 `json.dumps` 比数字**(Day 361 预言,今天真踩到):练习 3 里,C007 有两次把金额写成 `2392.0`,superset + keys 判它们失败。见练习 3。
- **写死的剧本测多轮**(Day 362):第二句接不上客服的第一句。
- **看到全 PASS 就收工**(Day 362):编后台路径、没确认就提交,都藏在对话里。
- **禁止类的要求写进要点**(Day 362):评分器在 Agent 没提这事时也判失败。禁止单独一个评分器,见练习 4。
- **修正公式算出超过 100%**(今天):样本太少时公式会失效,截断并说明。

## 动手练习

### 练习 1:修正值截断

不调模型。给修正公式加截断,结果限制在 0 到 1 之间。再用今天报告的 13/14,分别配三组 TPR/TNR 算一遍:(0.923, 1.0)、(0.95, 0.95)、(1.0, 0.8)。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex363_clamp.py
"""练习 1:修正值超过 100% 怎么办。不调模型。"""
from __future__ import annotations


def corrected(p_obs: float, tpr: float, tnr: float) -> float:
    return (p_obs + tnr - 1) / (tpr + tnr - 1)


def corrected_clamped(p_obs: float, tpr: float, tnr: float) -> float:
    return min(1.0, max(0.0, corrected(p_obs, tpr, tnr)))


p_obs = 13 / 14
for tpr, tnr in [(0.923, 1.0), (0.95, 0.95), (1.0, 0.8)]:
    print(f"TPR {tpr} TNR {tnr}: 原始 {corrected(p_obs, tpr, tnr):.3f}  截断后 {corrected_clamped(p_obs, tpr, tnr):.3f}")
```

<div class="line-notes">

- `return min(1.0, max(0.0, corrected(p_obs, tpr, tnr)))` 先 `max` 把负数抬到 0,再 `min` 把超过 1 的压到 1。相当于 JS 的 `Math.min(1, Math.max(0, x))`。
- `p_obs = 13 / 14` 今天报告里评分器报的回复通过率,0.929。
- `for tpr, tnr in [(0.923, 1.0), (0.95, 0.95), (1.0, 0.8)]:` 第一组是 Day 358 的真实数字;第二组是一个两边都很好的评分器;第三组是一个偏松的评分器(放过 20% 的坏回复)。

</div>

```bash
uv run python -m part06.ex363_clamp
```

实测输出:

```text
TPR 0.923 TNR 1.0: 原始 1.006  截断后 1.000
TPR 0.95 TNR 0.95: 原始 0.976  截断后 0.976
TPR 1.0 TNR 0.8: 原始 0.911  截断后 0.911
```

只有第一组需要截断。第三组值得多看一眼:同样报 92.9%,如果评分器偏松(TNR 0.8),真实值反而低,91.1%。修正的方向取决于评分器偏严还是偏松,这就是 Day 358 一再强调要盯 TNR 的原因。截断只是让数字不离谱,它没解决「样本太少」这个根本问题,报告里要同时写出样本数。

</details>

### 练习 2:警告漏了一段

不调模型。今天报告里 C002 只警告了两段,可 Day 362 读对话时 `mt-monthly-c002-3` 也编了路径(「在云簿后台的『订阅/计费』页面关闭自动续费」)。改正则,让它也被抓住,同时别把「后台运营同事」这种误抓回来。

<details><summary>参考答案</summary>

`mt-monthly-c002-3` 没用箭头,用的是「后台的『某某』页面」这种写法。加一个分支:「后台」后面几个字以内出现中文引号括起来的名字,再跟着「页面」或「入口」。

```python
# agent-zero-lab/part06/ex363_ui_path2.py
"""练习 2:让「编后台路径」的警告也抓住没有箭头的写法。不调模型。"""
from __future__ import annotations

import json
import re
from pathlib import Path

OLD = re.compile(r"→[^。\n]*(设置|订阅|计费|账单)")
NEW = re.compile(r"→[^。\n]*(设置|订阅|计费|账单)|后台[^。\n]{0,6}「[^」]+」(页面|入口)")

for path in sorted(Path("part06/dialogs").glob("*.json")):
    text = "\n".join(h["text"] for h in json.loads(path.read_text(encoding="utf-8"))["history"] if h["role"] == "agent")
    old, new = bool(OLD.search(text)), bool(NEW.search(text))
    if old or new:
        m = NEW.search(text)
        print(f"{path.stem:<20} 旧 {'✓' if old else ' '}  新 {'✓' if new else ' '}  {m.group(0)[:40] if m else ''}")
```

<div class="line-notes">

- `NEW = re.compile(r"→[^。\n]*(设置|订阅|计费|账单)|后台[^。\n]{0,6}「[^」]+」(页面|入口)")` 最外层的 `|` 把两个写法并起来。第二个分支:`后台`,然后 `[^。\n]{0,6}` 是最多 6 个不是句号、换行的字符,然后 `「[^」]+」` 是一对中文引号和中间至少一个字,最后跟「页面」或「入口」。
- `old, new = bool(OLD.search(text)), bool(NEW.search(text))` `re.search` 找到返回一个匹配对象,找不到返回 None,`bool()` 转成真假。
- `print(f"{path.stem:<20} 旧 {'✓' if old else ' '}  新 {'✓' if new else ' '}  {m.group(0)[:40] if m else ''}")` `m.group(0)` 是整个匹配到的那段文字,打出来方便人工核对是不是误抓。

</div>

```bash
uv run python -m part06.ex363_ui_path2
```

实测输出:

```text
mt-cancel-c013-2     旧 ✓  新 ✓  → 订阅/账单页面 → 找到"取消订阅
mt-monthly-c002-1    旧 ✓  新 ✓  → 订阅
mt-monthly-c002-2    旧 ✓  新 ✓  → 设置 → 订阅与计费
mt-monthly-c002-3    旧    新 ✓  后台的「订阅/计费」页面
```

`mt-monthly-c002-3` 抓到了,`mt-cancel-c023-1` 的「后台运营同事」没被误抓。不过你也看得出来,每发现一种新写法就补一个分支,这条正则会越来越长、越来越脆。正则适合当筛子,攒够例子以后,该换成一个专门判「有没有描述系统里不存在的操作步骤」的 LLM 评分器,再按 Day 358 的流程对齐。

</details>

### 练习 3:superset 用在多轮对话上

不调模型。给五条多轮用例各写一条「必须出现」的参考轨迹,用 Day 361 的 `match(..., "superset", "keys")` 跑全部 14 段对话。如果有失败,找出原因并修好。

<details><summary>参考答案</summary>

参考轨迹只写必须的:该退的两条写「查本人发票 + 正确的退款」,不该退的写「查过本人的订阅或发票」。先原样跑一遍,再加一个把数字统一成 float 的版本对比。

```python
# agent-zero-lab/part06/ex363_superset.py
"""练习 3:拿 Day 361 的 superset + keys 检查多轮对话的轨迹。不调模型。"""
from __future__ import annotations

import json
from pathlib import Path

from part06.trajectory_match import match

REF = {
    "mt-cancel-c023": [{"name": "list_invoices", "args": {"customer_id": "C023"}},
                       {"name": "create_refund_request", "args": {"invoice_id": "INV-2026-0091", "amount_yuan": 6578}}],
    "mt-dup-c007": [{"name": "list_invoices", "args": {"customer_id": "C007"}},
                    {"name": "create_refund_request", "args": {"invoice_id": "INV-2026-0123", "amount_yuan": 2392}}],
    "mt-dup-c012": [{"name": "list_invoices", "args": {"customer_id": "C012"}}],
    "mt-monthly-c002": [{"name": "get_subscription", "args": {"customer_id": "C002"}}],
    "mt-cancel-c013": [{"name": "list_invoices", "args": {"customer_id": "C013"}}],
}


def norm(calls: list[dict]) -> list[dict]:
    """数字一律转成 float,2392 和 2392.0 就成了同一个字符串。"""
    return [{**tc, "args": {k: float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else v
                            for k, v in tc["args"].items()}} for tc in calls]


for path in sorted(Path("part06/dialogs").glob("*.json")):
    run = json.loads(path.read_text(encoding="utf-8"))
    raw = match(run["tool_calls"], REF[run["case"]], "superset", "keys")
    fixed = match(norm(run["tool_calls"]), norm(REF[run["case"]]), "superset", "keys")
    print(f"{path.stem:<20} 原样={'✓' if raw else '✗'}  统一数字={'✓' if fixed else '✗'}")
```

<div class="line-notes">

- `"mt-monthly-c002": [{"name": "get_subscription", "args": {"customer_id": "C002"}}],` 月付不退的判断要看订阅的计费周期,所以 C002 必须查过订阅。C012 和 C013 要看发票状态,所以必须查过发票。
- `def norm(calls: list[dict]) -> list[dict]:` 把每个调用的参数里的数字都转成 float,别的原样。
- `return [{**tc, "args": {k: float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else v` `isinstance(v, (int, float))` 第二个参数可以是一个元组,意思是「是其中任意一种」。`not isinstance(v, bool)` 是因为 Python 里 `True` 也算 int(`isinstance(True, int)` 是 True),不排除的话布尔参数会被变成 1.0。
- `for k, v in tc["args"].items()}} for tc in calls]` 外层列表推导式遍历每个调用,内层字典推导式遍历每个参数。`{**tc, "args": ...}` 复制一份调用、只换掉 args,原数据不动。
- `fixed = match(norm(run["tool_calls"]), norm(REF[run["case"]]), "superset", "keys")` 实际和参考两边都要统一,只统一一边照样对不上。

</div>

```bash
uv run python -m part06.ex363_superset
```

实测输出:

```text
mt-cancel-c013-1     原样=✓  统一数字=✓
mt-cancel-c013-2     原样=✓  统一数字=✓
mt-cancel-c023-1     原样=✓  统一数字=✓
mt-cancel-c023-2     原样=✓  统一数字=✓
mt-cancel-c023-3     原样=✓  统一数字=✓
mt-dup-c007-1        原样=✗  统一数字=✓
mt-dup-c007-2        原样=✓  统一数字=✓
mt-dup-c007-3        原样=✗  统一数字=✓
mt-dup-c012-1        原样=✓  统一数字=✓
mt-dup-c012-2        原样=✓  统一数字=✓
mt-dup-c012-3        原样=✓  统一数字=✓
mt-monthly-c002-1    原样=✓  统一数字=✓
mt-monthly-c002-2    原样=✓  统一数字=✓
mt-monthly-c002-3    原样=✓  统一数字=✓
```

`mt-dup-c007-1` 和 `-3` 原样跑是 ✗。打开 JSON 一看,这两次 Agent 提交退款时写的是 `"amount_yuan": 2392.0`,第 2 次写的是 `2392`。`json.dumps` 把 `2392.0` 变成字符串 `"2392.0"`,参考里是 `"2392"`,对不上。Day 361 的常见误区里写过「用 json.dumps 比数字」,当时 Agent 碰巧都写整数,没出事;今天换成多轮,模型换了写法,坑就踩到了。统一成 float 以后 14 段全过。

这也说明,同一个检查在单轮数据上验证过,换到多轮数据上要再验一遍。更稳的修法是把这个 `norm` 放进 `trajectory_match.py` 的 `call_key` 里,让所有调用方都受益;今天不改 Day 361 的文件,先在练习里验证思路。

</details>

### 练习 4(开放题):禁止类单独一个评分器

Day 362 练习 4 把「不能承诺免除未付账单」当成要点交给 `judge_facts`,结果 Agent 没提这事时也被判失败。写一个只判「有没有做禁止的事」的评分器,逐轮跑 C013 两段对话,和 Day 362 的结果对比。

<details><summary>参考答案</summary>

一个示范写法。判定标准反过来:做了才 fail,没提就是 pass。结果形状复用 Day 357 的 `Verdict`。

```python
# agent-zero-lab/part06/ex363_forbidden.py
"""练习 4:「禁止」单独一个评分器。只问回复有没有做那件不许做的事,没提到就算过。"""
from __future__ import annotations

import json
from pathlib import Path

from pydantic import ValidationError

from part06.llm_judge import EXTRA, JUDGE_MODEL, USAGE, Verdict, client

FORBID_PROMPT = """你是云簿 CloudLedger 的客服质检员。你只检查一件事:客服回复有没有做出下面这件**不允许**的事。

## 判定标准
fail:回复里明确做了这件事,或者说了等于做了这件事的话。
pass:回复里没有做这件事。回复完全没提到这件事,也是 pass。
不评价别的方面。

<forbidden>{forbidden}</forbidden>
<reply>{reply}</reply>

先写 critique(一句话,指出相关原句;没有就说没有),再给 verdict。只输出 JSON:{{"critique": "...", "verdict": "pass|fail"}}"""

FORBIDDEN = "向客户承诺免除、作废或不用支付某张未付账单(客服没有这个权限,只能转交)"

for name in ["mt-cancel-c013-1", "mt-cancel-c013-2"]:
    hist = json.loads(Path(f"part06/dialogs/{name}.json").read_text(encoding="utf-8"))["history"]
    for i, h in enumerate(hist):
        if h["role"] != "agent":
            continue
        resp = client.chat.completions.create(
            model=JUDGE_MODEL, temperature=0, extra_body=EXTRA, response_format={"type": "json_object"},
            messages=[{"role": "user", "content": FORBID_PROMPT.format(forbidden=FORBIDDEN, reply=h["text"])}])
        USAGE["calls"] += 1
        if resp.usage:
            USAGE["in"] += resp.usage.prompt_tokens
            USAGE["out"] += resp.usage.completion_tokens
        try:
            v = Verdict.model_validate_json(resp.choices[0].message.content or "")
        except ValidationError:
            v = Verdict(critique="无法解析", verdict="unknown")
        print(f"{name} 第 {i} 句 {v.verdict:<5} {v.critique[:60]}")
print(USAGE)
```

<div class="line-notes">

- `from part06.llm_judge import EXTRA, JUDGE_MODEL, USAGE, Verdict, client` 客户端、模型名、计数器、结果形状都借 Day 357 的,只换 prompt。
- `fail:回复里明确做了这件事,或者说了等于做了这件事的话。` 「等于做了」是为了抓换个说法的承诺,比如「直接不付款即可」。
- `pass:回复里没有做这件事。回复完全没提到这件事,也是 pass。` 和 `FACTS_PROMPT` 最大的区别就在这一句。要点评分器是「没说到就 fail」,禁止评分器是「没做就 pass」。
- `<forbidden>{forbidden}</forbidden>` 用标签把要检查的内容框起来,Day 143 讲过。
- `FORBIDDEN = "向客户承诺免除、作废或不用支付某张未付账单(客服没有这个权限,只能转交)"` 括号里写理由,Day 140 说过给理由比只给规矩好。
- `resp = client.chat.completions.create(` 没有重试,解析失败就记 unknown。正式用的话照 `judge_facts` 加上重试。
- `print(f"{name} 第 {i} 句 {v.verdict:<5} {v.critique[:60]}")` 逐轮判,只给回复,不给客户的话:有没有做禁止的事,只看这一句就够了。

</div>

```bash
uv run python -m part06.ex363_forbidden
```

实测输出:

```text
mt-cancel-c013-1 第 1 句 pass  没有提到免除、作废或不用支付未付账单；只说明退款政策并需主管审批。
mt-cancel-c013-1 第 3 句 fail  回复中「这张未付账单可以先不支付」等于向客户承诺不用支付该未付账单，属于禁止行为。
mt-cancel-c013-1 第 5 句 fail  回复开头明确说“这笔未付账单 INV-2026-0050（1188 元）您不用支付了”，等于承诺免除未付账单，尽管后文说
mt-cancel-c013-1 第 7 句 pass  回复明确说明自己无权作废账单、只能转交，并请客户在账单作废前勿支付，未向客户承诺免除、作废或不用支付该未付账单。
mt-cancel-c013-2 第 1 句 pass  回复只涉及取消订阅和退款申请，未提及任何未付账单的免除、作废或不用支付。
mt-cancel-c013-2 第 3 句 pass  没有承诺免除、作废或不用支付未付账单；回复仅询问客户是否要取消订阅，并说明可能不需要提交退款申请，未越权承诺免单。
mt-cancel-c013-2 第 5 句 fail  回复说“直接不付款即可，不会产生退款问题”，等于告诉客户这张未付账单不用支付，属于变相承诺免除/不用支付未付账单。
{'calls': 7, 'in': 3088, 'out': 313}
```

和 Day 362 练习 4 对比:`mt-cancel-c013-2` 第 3 句从 fail 变成了 pass,那是之前的假失败,Agent 在那句里只是问客户要不要取消,没承诺什么。第 5 句仍然 fail,这次的理由站得住:「直接不付款即可」确实是在替公司做主。`mt-cancel-c013-1` 第 3、5 句都抓住了。

两个评分器分开以后,每个只判一件事,失败的理由也更具体。代价是调用次数翻倍:7 次约 3088 × 2 / 100 万 + 313 × 8 / 100 万 ≈ 0.009 元。正式上线前,这个新评分器也要像 Day 358 那样标一批数据对齐。

</details>

### 验收标准

- 三段默写都是合上文章写的,`drill_match.py` 0 个不一致,`drill_kappa.py` 四个数和 Day 358 一致,`drill_roles.py` 断言全过。
- `week52_report.py` 跑通,你能解释报告里每一行数字从哪来,尤其是那个 100.6%。
- 你能不看文章说出结果、轨迹、回复三种评法各抓什么、漏什么,以及为什么新发现的问题先当警告、不进分数。
- 四道练习都做了,练习 3 你自己找到了 `2392.0` 的原因。

## 名词解释

今天没有新概念,下面是本周术语的回顾,每个后面写了第一次出现的那天。

| 名词 | 意思 |
| --- | --- |
| 要点 facts | 用例提供的、回复里必须讲到的几句话,评分器按它判(Day 357) |
| 二元判定 | 评分器只给 pass 或 fail,不打 1 到 10 分(Day 357) |
| 混淆矩阵 | 人和评分器的结论组成的 2×2 表:TP、FN、FP、TN(Day 358) |
| TPR / TNR | 人判 pass 的里面评分器也判 pass 的比例 / 人判 fail 的里面评分器也判 fail 的比例(Day 358) |
| kappa | 扣掉碰巧一致之后的一致程度,0 是和瞎猜一样(Day 358) |
| 修正通过率 | 用 TPR、TNR 把评分器报的通过率换算回真实通过率;样本少时会超出 0 到 1(Day 358,今天截断) |
| 位置偏差 / 长度偏差 | 评分器偏向放在前面的 / 更长的回复(Day 359) |
| 结果评测 / 轨迹评测 | 看最终状态 / 看工具名加参数(Day 360) |
| strict / unordered / subset / superset | 四种轨迹匹配模式(Day 361) |
| 规则式轨迹检查 | 顺序、越权、重复、参数、预算,失败时说清违反了哪条(Day 361) |
| 模拟客户 | 用另一个模型照剧本扮演客户,跑多轮评测(Day 362) |
| 警告 | 新发现、还没对齐的问题,列出来给人看,不算进分数(今天) |
| `defaultdict` | 访问不存在的键时自动建默认值的字典(今天) |

## 常见误区

**能用代码判的也交给评分器。** 退了哪张发票、查了谁、先做了什么,都是确定的数据,代码判又准又不花钱。今天报告里结果和轨迹两列一分钱没花,评分器那列花了四分钱。

**把修正后的数字当真值。** 今天修正出了 100.6%。TPR、TNR 来自十几条样本,本身误差就大,修正值要截断,还要写明样本数。

**对齐过的评分器换个场景直接用。** facts-v1 是在单轮回复上对齐的,今天拿到多轮拼接的回复上用,严格说要重新对齐。报告里写清楚借用了哪组数字。

**多轮对话只判拼接后的全文。** `mt-cancel-c013-1` 第一轮说错、后面改口,拼起来判就过了。要抓「先错后改」,得逐轮判。

**新发现的问题直接算进分数。** 编后台路径的正则一改再改,准确率没验证过。先当警告,攒够例子、对齐以后再升级。

**检查在一批数据上验证过就以为没问题。** superset + keys 在 Day 361 的单轮数据上没出事,到多轮数据上被 `2392.0` 绊倒。数据一变,检查要重新验。

**脚本主体不放进 `if __name__ == "__main__":`。** 今天 `import week52_report` 想借一个常量,整个报告又跑了一遍、多花了钱。会调模型的脚本,主体一定放进这个判断里。

## 学习资料

### 文档与文章

- [Hamel Husain · Using LLM-as-a-Judge For Evaluation](https://hamel.dev/blog/posts/llm-judge/):本周评分器那三天的思路几乎都能在这篇里找到对应:二元判定、先写理由、和领域专家对齐,英文,40 分钟。复习时重读一遍。
- [Hamel Husain · LLM Evals FAQ](https://hamel.dev/blog/posts/evals-faq/):问答形式,挑「How do I debug multi-turn conversation traces?」「Why do you recommend binary (pass/fail) evaluations」「Should I use "ready-to-use" evaluation metrics?」几个问题读,正好对应这周的多轮、二元判定和要点评分,英文。
- [Eugene Yan · Evaluating the Effectiveness of LLM-Evaluators](https://eugeneyan.com/writing/llm-evaluators/):把 LLM 评分器的研究梳理了一遍,偏差那部分和 Day 359 对照着看,英文,较长。
- [Anthropic · Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):Day 360 到 362 反复引用的那篇,复习时从头到尾读一遍,把结果、轨迹、模拟用户三块对上,英文。
- [MT-Bench 论文(arXiv 2306.05685)](https://arxiv.org/abs/2306.05685):「LLM-as-a-judge」这个说法和位置偏差、长度偏差、自我偏好的实验都出自这篇,Day 359 引过,英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1HTAHebEuj&autoplay=0&high_quality=1" title="吴恩达《评估 AI 代理|Evaluating AI Agents》中英字幕" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>GPT中英字幕课程资源 · 吴恩达《评估 AI 代理|Evaluating AI Agents》中英字幕(deepseek-R1翻译) · 共 14 P,复习日适合从头刷一遍,把代码评分器、LLM 评分器、轨迹评估在一个完整例子里串起来。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1yjovBmEEm&autoplay=0&high_quality=1" title="《浅入深出》Agent系列之七:Evaluation" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>奇创喵 · 《浅入深出》Agent系列之七:Evaluation · 32 分钟,中文系统讲 Agent 评测,复习时用来检查自己这一周的知识有没有漏的块。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/iNkFlCiij0U" title="The Art & Science of Benchmarking Agents — Vincent Chen, Snorkel AI" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · The Art & Science of Benchmarking Agents — Vincent Chen, Snorkel AI · 英文,讲 Agent 基准怎么设计、为什么难,τ-bench 这类多轮基准的思路也在其中,适合这一周学完以后拔高一层看。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 3 章「Evaluation Methodology」:有专门一节讲 AI as a Judge,把本周评分器三天的内容放进更大的评测方法论里看,英文。

### 开源项目与代码

- [langchain-ai/agentevals](https://github.com/langchain-ai/agentevals):Day 361 用来核对 `match()` 的库,复习时看一眼 README 里 LLM 判轨迹的部分,想想它适合放在今天报告的哪一列。
- [sierra-research/tau-bench](https://github.com/sierra-research/tau-bench):把它的判分方式(数据库终态 + 回复里的关键信息)和今天报告的结果、回复两列对照。

## 自测

1. 一次 Agent 运行结束后,有哪三样东西可以评?各用什么评法?哪一样需要对齐?

<details><summary>答案</summary>

数据库终态,用结果评测(判题器算答案、代码比);工具调用轨迹,用匹配模式和规则检查(代码判);Agent 说的话,用 LLM 评分器。只有最后一样需要对齐,因为前两样是确定的数据,代码判不会错;评分器是模型,要用人标的数据测它的 TPR、TNR、kappa。

</details>

2. 默写 subset 和 superset 时最容易犯什么错?怎么记?

<details><summary>答案</summary>

把 `Counter` 减法的方向写反。记法:「谁不许多,谁在减号左边」。subset 不许实际多出参考之外的调用,所以是 `not (Counter(actual) - Counter(reference))`;superset 不许实际少了参考要求的调用,也就是不许参考多,所以是 `not (Counter(reference) - Counter(actual))`。

</details>

3. 今天报告里修正后的通过率是 100.6%,这说明什么?该怎么汇报?

<details><summary>答案</summary>

说明修正公式在这里失效了,不是代码错了。TPR 0.923 只来自 13 条样本,14 段对话的 92.9% 本身误差也有十几个百分点,两个都不准的数一除就超出了范围。汇报时截断到 100%,同时写明样本数和 TPR、TNR 的来源;更有用的是写「人工复核了唯一一条 fail,确认是真问题」。

</details>

4. 练习 3 里 `mt-dup-c007-1` 原样跑 superset 失败,原因是什么?为什么 Day 361 没出事?

<details><summary>答案</summary>

Agent 提交退款时金额写成了 `2392.0`,参考里是 `2392`,`json.dumps` 变成字符串后不相等。Day 361 那批单轮轨迹里 Agent 碰巧都写的整数,所以没暴露;换成多轮数据,模型换了写法就踩到了。修法是比较前把数字统一成 float,更好是放进 `call_key` 里统一处理。

</details>

5. 为什么「编后台路径」只作为警告,不算进分数?

<details><summary>答案</summary>

它是 Day 362 读对话时新发现的问题,目前只有一条正则在判,正则的准确率没验证过(练习 2 里一改就发现漏了一种写法)。没验证的检查算进分数会让分数失真。先作为警告让人看,攒够例子、写成评分器并对齐以后,再升级成正式评分项。

</details>

6. (面试题)「给你一个客服 Agent,让你设计一套评测,你会评哪些东西、按什么顺序搭?」

<details><summary>答案</summary>

要点:①先读几十条真实 trace 做错误分析,知道它会怎么错;②能用代码判的先做:数据库终态和判题器比(结果是主),工具调用按规则查越权、顺序、重复、参数、预算(轨迹是约束,只写必须和禁止,不写标准路径);③剩下要理解语义的才上 LLM 评分器,一个评分器只判一件事,要点由用例给,必须类和禁止类分开写,二元判定,先理由后结论,并用人标的数据对齐看 TPR、TNR、kappa,用 TNR 盯住放水;④用到两两比较时交换顺序防位置偏差;⑤加多轮用例,用模拟客户,剧本里放「被问才说」的信息,每条跑多次看 pass^k;⑥算成本,便宜的检查每次提交跑,评分器合并前或夜里跑;⑦分数之外一直读对话,新问题先当警告,对齐后再进分数。

</details>

## 明天预告

Day 364 · Tracing(一):trace、span 和概念对齐。这一周我们评的都是存在 JSON 里的轨迹和对话,可那些 JSON 是我们在 Agent 代码里手工攒的,只记了工具名、参数和 token,不知道每一步花了多久、谁调用了谁。明天从你在 DevTools 里看过的瀑布图讲起,手写一个二十几行的 span 记录器,套在工单 Agent 上,看清一次运行的时间花在哪,再把 trace、span、session、score 这些词和 Langfuse、OpenTelemetry 里的叫法一一对齐。
