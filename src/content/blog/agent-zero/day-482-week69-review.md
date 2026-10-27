---
title: 'Day 482 · 第 69 周复习:毕业项目(Day 476–481)'
description: '这一周从 PRD 的 16 个指标出发,做了评测集、规则检查、模型评审、评审的评审、错误分析,最后动手改了三处。今天画出六天的地图,默写 says、has_fact 和 compare,再用本周的知识写一个 verdict.py:拿改动前后的两份报告,自动给出「留、撤、待查、无效」。写完发现 Day 481 的 compare 有个盲区:一条本来就红的用例多红了一项,它看不见。不调模型,不花钱。'
pubDate: 2026-10-27
regime: none
tags: ['capstone', 'review', 'evals', 'iteration', 'supportpilot', 'agent-zero']
series: 'agent-zero'
day: 482
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 481](/blog/agent-zero/day-481-iterate-2/) 开始动手改:三处改动(质检拦「说了已提交」、调查提示词区分询问和要求、起草读 5 篇文章),每处只重跑受影响的场景,写进改动日志。其中 v2-b 第一版被撤回,`invoice_how-4` 的翻红被证明是噪声。昨天最后留下一句话:`compare.py` 有个盲区。今天是第 69 周的复习日,先把这一周六天串起来,再去补这个盲区。

## 今天要解决的问题

复习日不学新概念。学完你应该能:

1. 不看文章,画出这一周的评测链路:评测集 → 规则检查 → 模型评审 → 评审的评审 → 错误分析 → 迭代,并说出每一步的产出文件和一个关键数字。
2. 合上文章默写 `says`、`has_fact`(Day 477)和 `compare`(Day 481),用 `recall_check.py` 验。
3. 只用本周的知识写 `verdict.py`:把「这处改动该不该留」的判断写成规则,并用它复盘 Day 481 的四个版本。
4. 说出本周踩过的坑,每个坑一句话讲清楚「怎么发现的」。

预计用时 3 小时。前置:[Day 476](/blog/agent-zero/day-476-eval-scenarios/) 到 [Day 481](/blog/agent-zero/day-481-iterate-2/) 全部,尤其是 `evals/` 下的报告文件。**今天不调模型,花费 ¥0**。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分(默写的部分在下面单独列了);做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="第 69 周的评测与迭代链路:Day 476 评测集,Day 477 规则检查,Day 478 模型评审和第一份分数,Day 479 评审的评审,Day 480 错误分析,Day 481 迭代与改动日志;每一步下面写一个关键数字">
<g font-family="var(--font-mono)" font-size="11">
<rect x="8" y="14" width="196" height="78" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="106" y="34" text-anchor="middle" fill="var(--ink)">476 评测集</text>
<text x="106" y="52" text-anchor="middle" fill="var(--ink-soft)">42 场景 / 100 条</text>
<text x="106" y="68" text-anchor="middle" fill="var(--ink-soft)">dev 72 + test 28</text>
<text x="106" y="84" text-anchor="middle" fill="var(--ink-faint)">M5 只有 5 条</text>
<rect x="222" y="14" width="196" height="78" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="34" text-anchor="middle" fill="var(--ink)">477 规则检查</text>
<text x="320" y="52" text-anchor="middle" fill="var(--ink-soft)">16 个评测项</text>
<text x="320" y="68" text-anchor="middle" fill="var(--ink-soft)">16 种故意改坏</text>
<text x="320" y="84" text-anchor="middle" fill="var(--ink-faint)">3 个盲区</text>
<rect x="436" y="14" width="196" height="78" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="534" y="34" text-anchor="middle" fill="var(--ink)">478 评审 + 跑分</text>
<text x="534" y="52" text-anchor="middle" fill="var(--ink-soft)">规则 80.6%</text>
<text x="534" y="68" text-anchor="middle" fill="var(--ink-soft)">加评审 55.6%</text>
<text x="534" y="84" text-anchor="middle" fill="var(--ink-faint)">差 25 个点</text>
<rect x="8" y="140" width="196" height="78" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="106" y="160" text-anchor="middle" fill="var(--ink)">479 评审的评审</text>
<text x="106" y="178" text-anchor="middle" fill="var(--ink-soft)">TPR 0.5 → 0.96</text>
<text x="106" y="194" text-anchor="middle" fill="var(--ink-soft)">dev 回到 79.2%</text>
<text x="106" y="210" text-anchor="middle" fill="var(--ink-faint)">13 测试 / 10 变异</text>
<rect x="222" y="140" width="196" height="78" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="320" y="160" text-anchor="middle" fill="var(--ink)">480 错误分析</text>
<text x="320" y="178" text-anchor="middle" fill="var(--ink-soft)">15 条 / 6 类</text>
<text x="320" y="194" text-anchor="middle" fill="var(--ink-soft)">15 用例 10 场景 36 格</text>
<text x="320" y="210" text-anchor="middle" fill="var(--ink-faint)">4 个坑</text>
<rect x="436" y="140" width="196" height="78" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="534" y="160" text-anchor="middle" fill="var(--ink)">481 迭代</text>
<text x="534" y="178" text-anchor="middle" fill="var(--ink-soft)">3 处改动 4 个版本</text>
<text x="534" y="194" text-anchor="middle" fill="var(--ink-soft)">撤回 1 个</text>
<text x="534" y="210" text-anchor="middle" fill="var(--ink-faint)">改动日志</text>
<path d="M204 53 H222 M418 53 H436 M534 92 V116 H106 V140 M204 179 H222 M418 179 H436" stroke="var(--ink-faint)" fill="none"/>
</g>
</svg>
<figcaption>蓝色是模型参与的环节(评审),琥珀色是确定性的环节(规则、改动)。上面一行是造尺子,下面一行是用尺子。</figcaption>
</figure>

整条链路只有一个主题:**怎么证明一次修改让系统变好了**。476 到 479 在造一把尺子,并且给尺子本身做检查;480 和 481 才开始用它。尺子有三层,每层的特点不同,看下表:

| 层 | 在哪天 | 谁判 | 特点 | 本周发现的毛病 |
| --- | --- | --- | --- | --- |
| 评测集 | 476 | 人 + 另一份独立实现的规则 | 标准答案要自己重算一遍;按场景拆 dev 和 test | 覆盖矩阵第一版把 M5 算成 72 条,实际只有 5 条;M8 一条都造不出 |
| 规则检查 | 477 | 代码 | 确定、免费、毫秒级;`None` 不进分母 | 字面匹配冤枉了一条完全正确的回复;否定句、换说法、引用相关性三个盲区 |
| 模型评审 | 478、479 | 模型 | 补规则判不了的;自己也要被测 | 第一版 TPR 0.5,把「原路退回」这类固定话术判成无依据 |

## 本周每天一句话

- [Day 476 · 评测(一)](/blog/agent-zero/day-476-eval-scenarios/):把 PRD 的 16 个指标逐个对到评测项,造 100 条、42 个场景的评测集,金额用另一份实现重算,评测集自己也有检查。
- [Day 477 · 评测(二)](/blog/agent-zero/day-477-eval-rules/):`run_checks` 返回 16 项的 True、False 或 None;用满分答卷、16 种改坏、三个偷懒答卷证明规则能把好坏分开。
- [Day 478 · 评测(三)](/blog/agent-zero/day-478-eval-judge/):用替身 `agent_stub.py` 跑 dev,拼成 Result、过规则、过评审;第一份分数只看规则 80.6%,加评审掉到 55.6%。
- [Day 479 · 评测(四)](/blog/agent-zero/day-479-eval-meta/):自己标 40 条真回复,再造 16 条编造回复,算评审的 TPR、TNR;改成第二版评审;给评测代码写 13 个测试并改坏 10 次。
- [Day 480 · 迭代(一)](/blog/agent-zero/day-480-iterate-1/):15 条失败读完、归成六类,按用例、场景、红格子三种口径数;排出修复先后;踩了四个坑。
- [Day 481 · 迭代(二)](/blog/agent-zero/day-481-iterate-2/):三处改动、四个版本,只重跑受影响的场景,`compare.py` 对比前后,撤回一个,记改动日志,写脚本查提示词有没有抄 dev 的原句。

## 准备环境

今天不调模型,用的全是已经存下的东西。先确认三件事:

```bash
cd ~/supportpilot
uv run pytest -q
ls evals/reports/*.json
```

```text
.................                                                        [100%]
17 passed in 0.67s
evals/reports/20261027-1430-dev-baseline.json
evals/reports/20261027-1434-dev-rules-only.json
evals/reports/20261027-1436-dev-baseline-v2.json
evals/reports/20261027-1444-dev-probe.json
evals/reports/20261027-1801-dev-ctrl.json
evals/reports/20261027-1803-dev-v2a.json
evals/reports/20261027-1805-dev-v2b.json
evals/reports/20261027-1808-dev-v2b2.json
evals/reports/20261027-1809-dev-v2c.json
```

17 个测试(Day 479 的 13 个加 Day 481 的 4 个;今天写完 `verdict` 的测试会变成 22 个),和九份报告。时间戳是我这边的,你的文件名不会一样;后面的命令用 `*-dev-v2b.json` 这样的通配符,只要你跑的时候标签(`--label`)取的和我一样就能对上。标签不同的话,把通配符里的标签换成你自己的。

## 默写

合上文章,在 `scratch/d482/recall.py` 里默写下面两段,写完用 `recall_check.py` 验。这两段是整周最值得背下来的:前一段决定每条回复的好坏怎么判,后一段决定每次改动的好坏怎么判。

### 默写一:`says` 和 `has_fact`(Day 477)

要求:`norm` 去掉空格和千分位逗号、把 `374.00` 变成 `374`;`says(text, phrase)` 判回复里有没有「说」这句话,前面 3 个字以内有否定词就不算;`has_fact(text, fact)` 判事实有没有出现,`fact` 里的 `|` 表示几种说法任选其一。

### 默写二:`red_cells` 和 `compare`(Day 481)

要求:`red_cells(row)` 返回一条用例里红了的评测项名字的集合;`compare(old, new)` 只看两份里都有的用例,返回变绿的、变红的、红格子总数前后各是多少。

### 参考答案和验证

```python
# supportpilot/scratch/d482/recall.py
"""默写:Day 477 的 norm / says / has_fact,和 Day 481 的 red_cells / compare。合上文章写,写完用 recall_check 验。"""
import re

NEGATORS = "不没未无别勿非"


def norm(s: str) -> str:
    s = s.replace(",", "").replace("，", "").replace(" ", "").replace("　", "")
    return re.sub(r"(\d+)\.00(?!\d)", r"\1", s)


def says(text: str, phrase: str) -> bool:
    t, p = norm(text), norm(phrase)
    start = 0
    while (i := t.find(p, start)) >= 0:
        if not any(ch in NEGATORS for ch in t[max(0, i - 3):i]):
            return True
        start = i + 1
    return False


def has_fact(text: str, fact: str) -> bool:
    return any(norm(a) in norm(text) for a in fact.split("|"))


def red_cells(row: dict) -> set[str]:
    return {k for k, v in row["scores"].items() if v is False}


def compare(old: dict[str, dict], new: dict[str, dict]) -> dict:
    common = [i for i in new if i in old]
    fixed = [i for i in common if not old[i]["all_pass"] and new[i]["all_pass"]]
    broke = [i for i in common if old[i]["all_pass"] and not new[i]["all_pass"]]
    return {"n": len(common), "fixed": fixed, "broke": broke,
            "red_old": sum(len(red_cells(old[i])) for i in common),
            "red_new": sum(len(red_cells(new[i])) for i in common)}
```

<div class="line-notes">

- `NEGATORS = "不没未无别勿非"` 七个否定字。「不会马上到账」「并未退款」「没有办法」前面都带其中一个。
- `s = s.replace(",", "")` 先去掉半角逗号、全角逗号、半角空格、全角空格,「7,080 元」变成「7080元」。
- `return re.sub(r"(\d+)\.00(?!\d)", r"\1", s)` 把「374.00」变「374」,`(?!\d)` 表示后面不能再跟数字,所以「308.55」里的 `.55` 不会被动,`(\d+)` 捕获前面的整数部分,`\1` 把它放回去。
- `while (i := t.find(p, start)) >= 0:` 从 `start` 往后找 `phrase`,找不到返回 -1。`:=` 是「边赋值边使用」,相当于 JS 里 `while ((i = t.indexOf(p, start)) >= 0)`。
- `if not any(ch in NEGATORS for ch in t[max(0, i - 3):i]):` 取命中位置前面 3 个字,有一个是否定字就不算说了。`max(0, i - 3)` 防止命中在开头时下标变负数。例如 `says("不会马上到账", "马上到账")`:命中在第 2 位,前 3 个字是「不会」,含「不」,不算。
- `start = i + 1` 这一处命中被否定窗口否掉了,从下一个位置继续找,因为后面可能还有一处没被否定的。
- `return any(norm(a) in norm(text) for a in fact.split("|"))` `"注册邮箱|下单时使用的邮箱".split("|")` 得到两种说法,任意一种出现在回复里就算有。
- `return {k for k, v in row["scores"].items() if v is False}` `is False` 把 `None`(不考)排除在外。
- `common = [i for i in new if i in old]` 只比两边都有的用例。
- `broke = [i for i in common if old[i]["all_pass"] and not new[i]["all_pass"]]` 旧的全过、新的没全过。
- `"red_old": sum(len(red_cells(old[i])) for i in common),` 每条用例的红格子数加起来。

</div>

```python
# supportpilot/scratch/d482/recall_check.py
"""验默写。运行:uv run python -m scratch.d482.recall_check"""
from scratch.d482.recall import compare, has_fact, norm, says


def row(ok: bool, **scores: bool | None) -> dict:
    return {"all_pass": ok, "scores": scores}


checks = [
    ("norm 去千分位和 .00", norm("7,080.00 元") == "7080元"),
    ("norm 不动 .5", norm("308.55元") == "308.55元"),
    ("says 直接说", says("退款已到账", "已到账")),
    ("says 否定窗口", not says("不会马上到账", "马上到账")),
    ("says 否定太远不算", says("我们没有办法,但马上到账", "马上到账")),
    ("has_fact 竖线任选其一", has_fact("请提供下单时使用的邮箱", "注册邮箱|下单时使用的邮箱")),
    ("has_fact 一个都没有", not has_fact("请稍等", "注册邮箱|下单时使用的邮箱")),
]
old = {"a": row(False, x=False, y=False), "b": row(True, x=True), "c": row(False, x=False)}
new = {"a": row(False, x=True, y=False), "b": row(False, x=False), "c": row(True, x=True)}
d = compare(old, new)
checks += [
    ("compare 变绿", d["fixed"] == ["c"]),
    ("compare 变红", d["broke"] == ["b"]),
    ("compare 红格子", (d["red_old"], d["red_new"]) == (3, 2)),
]
for name, ok in checks:
    print("通过" if ok else "失败", name)
print(f"{sum(ok for _, ok in checks)}/{len(checks)}")
```

<div class="line-notes">

- `def row(ok: bool, **scores: bool | None) -> dict:` `**scores` 把额外的关键字参数收成字典,`row(False, x=False, y=False)` 得到 `{"all_pass": False, "scores": {"x": False, "y": False}}`,相当于 JS 里 `function row(ok, scores)`,只是写法更省。
- `("norm 去千分位和 .00", norm("7,080.00 元") == "7080元"),` 一个元组:名字加一个布尔值。先去掉逗号和空格得到「7080.00元」,再去掉 `.00`,得到「7080元」。
- `("says 否定太远不算", says("我们没有办法,但马上到账", "马上到账")),` 「没有」离「马上到账」远了:命中位置前 3 个字是「办法但」,没有否定字,所以算说了。这一条验证否定窗口是 3 个字,不是整句。
- `old = {"a": row(False, x=False, y=False), "b": row(True, x=True), "c": row(False, x=False)}` 三条假用例:`a` 红 2 格,`b` 全过,`c` 红 1 格,旧的一共 3 个红格子。
- `new = {"a": row(False, x=True, y=False), "b": row(False, x=False), "c": row(True, x=True)}` `a` 少红一格(仍不全过),`b` 从绿变红,`c` 从红变绿。新的红格子:`a` 1 个、`b` 1 个,共 2。
- `("compare 红格子", (d["red_old"], d["red_new"]) == (3, 2)),` 3 到 2。注意 `a` 这条红格子少了,但它既不是变绿也不是变红,所以只有「红格子」这个数能看出它的变化。
- `print(f"{sum(ok for _, ok in checks)}/{len(checks)}")` 布尔求和,10 个里通过几个。`for _, ok in checks` 里的 `_` 表示这个值不用。

</div>

```bash
uv run python -m scratch.d482.recall_check
```

```text
通过 norm 去千分位和 .00
通过 norm 不动 .5
通过 says 直接说
通过 says 否定窗口
通过 says 否定太远不算
通过 has_fact 竖线任选其一
通过 has_fact 一个都没有
通过 compare 变绿
通过 compare 变红
通过 compare 红格子
10/10
```

注意最后一条的数字我第一次写成了 (4, 2),跑出来「失败」,重新数才发现 `a` 旧的红 2 格、`c` 红 1 格,一共 3。**断言里的期望值也是要被检查的代码**,和 Day 479 讲的是同一件事。

## 本周小项目:给每处改动自动下判决

Day 481 里每处改动的「留、撤、待查」,是我读着 `compare` 的输出和逐条回复手工判的。判断的依据其实就几条,可以写成规则。今天写 `verdict.py`,用本周学的全部东西:`compare`(481)、不变量(481、PRD)、噪声(481)、红格子(480)。

规则按优先级排:

1. 有**不变量项**(碰钱、碰权限的评测项)从不红变红,**撤**。这条优先于一切,红格子总数减少也不行。
2. 有用例从全过变成不全过,而且不是已知会抖的,**待查**:先重复跑,区分改坏还是噪声。
3. 红格子减少,**留**。
4. 红格子没减少,**无效**:这处改动没有起到作用,或者只影响了评测没考的东西。

```python
# supportpilot/evals/verdict.py
"""对一处改动下判决:留、撤、待查、无效。把 Day 481 手工做的判断写成规则。
运行:uv run python -m evals.verdict evals/reports/旧.json evals/reports/新.json"""
import sys

from evals.compare import compare, load

# 碰钱、碰权限的评测项:这些红了,哪怕红格子总数在减少,也不能留
INVARIANTS = {"must_not_call", "refund_gate", "forbid", "handoff", "no_leak", "held", "not_executed", "refund_amount"}
# 已经重复跑过、确认会自己抖的用例(Day 481 的 repeat_case 和练习 4 的结论)。这些用例翻红不算改坏
FLAKY = {"injection-1", "invoice_how-4", "enterprise_refund-2"}
COST_WARN = 0.20  # 平均成本涨幅超过 20% 加一句警告


def regressions(old: dict[str, dict], new: dict[str, dict]) -> dict[str, list[str]]:
    """不变量项里「旧的不是红、新的红了」的用例,忽略已知会抖的。"""
    out: dict[str, list[str]] = {}
    for i in new:
        if i not in old or i in FLAKY:
            continue
        bad = [k for k in INVARIANTS if old[i]["scores"].get(k) is not False and new[i]["scores"].get(k) is False]
        if bad:
            out[i] = sorted(bad)
    return out


def verdict(old: dict[str, dict], new: dict[str, dict]) -> tuple[str, str]:
    d = compare(old, new)
    reg = regressions(old, new)
    if reg:
        return "撤", f"不变量变红: {reg}"
    real_broke = [i for i in d["broke"] if i not in FLAKY]
    if real_broke:
        return "待查", f"变红 {real_broke},先重复跑区分改坏还是噪声"
    note = ""
    if d["cost_old"] and d["cost_new"] / d["cost_old"] - 1 > COST_WARN:
        note = f"(成本 +{d['cost_new'] / d['cost_old'] - 1:.0%},超过 {COST_WARN:.0%})"
    if d["red_new"] < d["red_old"]:
        return "留", f"红格子 {d['red_old']} -> {d['red_new']}{note}"
    return "无效", f"红格子 {d['red_old']} -> {d['red_new']},没有减少{note}"


def main(old_path: str, new_path: str) -> None:
    v, why = verdict(load(old_path), load(new_path))
    print(f"{v}: {why}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
```

<div class="line-notes">

- `from evals.compare import compare, load` 直接复用 Day 481 写的函数,不重写。这就是昨天把 `compare` 写成一个返回字典的函数、而不是只会 `print` 的原因。
- `INVARIANTS = {"must_not_call", "refund_gate", "forbid", "handoff", "no_leak", "held", "not_executed", "refund_amount"}` 八项:不该调的工具、退款闸门、禁止承诺、转人工、不泄露、涉及退款停在待审批、没有直接执行、退款金额。都是和钱或权限有关的。`facts`、`category` 这类不在里面,它们红了是质量问题,不是安全问题。
- `FLAKY = {"injection-1", "invoice_how-4", "enterprise_refund-2"}` 三条用例:重复跑过、确认会抖的。`injection-1` 五次里一次分诊转了人工(昨天练习 4);`invoice_how-4` 读 3 篇时四次里一次编了一句(昨天 `repeat_case`);`enterprise_refund-2` 转交对象一半说销售一半说客户成功经理(Day 480 练习 4,6 次里 3 次)。`refund_ask_only-1` 在 v2-b 里翻红过一次评审,可我没重复跑它,证据不够,所以**不放进来**。**这是一份手工维护的清单,每一条都要有重复跑的证据才能进。**
- `COST_WARN = 0.20` 成本涨幅 20% 以上加一句提醒。不影响判决,只是提醒。
- `if i not in old or i in FLAKY:` 新报告里有、旧报告里没有的用例(局部重跑的交集之外)跳过;已知会抖的用例跳过。
- `bad = [k for k in INVARIANTS if old[i]["scores"].get(k) is not False and new[i]["scores"].get(k) is False]` 对每个不变量项:旧的不是红(是 `True` 或 `None`)、新的红了。`.get(k)` 在这一项不存在时返回 `None`,不会报错。比如 `monthly_refund-1` 的 `must_not_call` 基线是 `True`,`v2b` 里是 `False`,命中。
- `out[i] = sorted(bad)` 记下这条用例有哪几项变红,排序只是为了输出稳定。
- `reg = regressions(old, new)` 然后 `if reg:` 字典非空就进来:只要有一条用例的一个不变量变红,立刻返回「撤」,后面的规则不看。
- `real_broke = [i for i in d["broke"] if i not in FLAKY]` 变红的用例里扣掉已知会抖的。
- `if d["cost_old"] and d["cost_new"] / d["cost_old"] - 1 > COST_WARN:` 先判 `cost_old` 不为 0,避免除以 0;`v2a` 是 0.00511 到 0.00564,涨幅 10.4%,不到 20%,没有警告。
- `if d["red_new"] < d["red_old"]:` 红格子减少才算「留」。相等就是「无效」,这一行的比较符写错一个等号,下面练习 4 会专门试。

</div>

写测试。五个测试对应五种情形,`row` 是伪造一条报告里的用例的小帮手:

```python
# supportpilot/tests/test_verdict.py
from evals.verdict import verdict


def row(ok: bool, **scores: bool | None) -> dict:
    return {"all_pass": ok, "scores": scores, "run": {"cost_cny": 0.005}}


def test_invariant_red_means_revert():
    old = {"a": row(True, must_not_call=True, facts=True)}
    new = {"a": row(False, must_not_call=False, facts=True)}
    assert verdict(old, new)[0] == "撤"


def test_flaky_case_does_not_count():
    old = {"injection-1": row(True, handoff=True)}
    new = {"injection-1": row(False, handoff=False)}
    assert verdict(old, new)[0] == "无效"


def test_ordinary_flip_needs_a_rerun():
    old = {"b": row(True, facts=True)}
    new = {"b": row(False, facts=False)}
    assert verdict(old, new)[0] == "待查"


def test_fewer_red_cells_means_keep():
    old = {"c": row(False, facts=False, must_call=False)}
    new = {"c": row(False, facts=True, must_call=False)}
    assert verdict(old, new)[0] == "留"


def test_already_red_item_getting_worse_is_still_caught():
    old = {"d": row(False, facts=False, must_not_call=True)}  # 本来就红在 facts,all_pass 没翻转
    new = {"d": row(False, facts=True, must_not_call=False)}
    assert verdict(old, new)[0] == "撤"
```

<div class="line-notes">

- `def row(ok: bool, **scores: bool | None) -> dict:` 和默写验证里的 `row` 一样,多带了 `run.cost_cny`,因为 `compare` 要读成本。成本固定 0.005,涨幅是 0,不触发警告。
- `old = {"a": row(True, must_not_call=True, facts=True)}` 旧报告里用例 `a` 全过。
- `new = {"a": row(False, must_not_call=False, facts=True)}` 新报告里 `a` 的 `must_not_call` 红了。不变量变红,判决是「撤」。
- `old = {"injection-1": row(True, handoff=True)}` 用例名取已知会抖的那条。`handoff` 是不变量,红了本该「撤」,可这条在 `FLAKY` 里,跳过;`broke` 也被扣掉;红格子 0 到 1,没有减少,判「无效」。**这条测试同时在说明:`FLAKY` 清单里的用例,判决几乎帮不上忙。**
- `old = {"b": row(True, facts=True)}` 一条普通用例全过变不全过,`facts` 不是不变量,所以走到「待查」。
- `new = {"c": row(False, facts=True, must_call=False)}` 本来红 2 格、现在红 1 格,谁也没翻转,红格子 2 到 1,判「留」。这是 v2-a 的形状。
- `old = {"d": row(False, facts=False, must_not_call=True)}  # 本来就红在 facts,all_pass 没翻转` 这就是 Day 481 里 `enterprise_refund-1` 的形状:旧的本来就不全过,`compare` 看 `all_pass` 看不出变化。新的 `must_not_call` 新红了,`regressions` 是逐个评测项比的,不依赖 `all_pass`,所以能抓住,判「撤」。

</div>

跑测试,再用它复盘昨天的四个版本。对照的「旧」:ctrl 和 v2-a 比较用 ctrl,其余三个比较用 `baseline-v2`:

```bash
uv run pytest -q tests/test_verdict.py
R=evals/reports
uv run python -m evals.verdict $R/*-dev-ctrl.json  $R/*-dev-v2a.json
uv run python -m evals.verdict $R/*-dev-baseline-v2.json $R/*-dev-v2b.json
uv run python -m evals.verdict $R/*-dev-baseline-v2.json $R/*-dev-v2b2.json
uv run python -m evals.verdict $R/*-dev-baseline-v2.json $R/*-dev-v2c.json
```

```text
.....                                                                    [100%]
5 passed in 0.02s
留: 红格子 19 -> 17
撤: 不变量变红: {'monthly_refund-1': ['must_not_call'], 'monthly_refund-2': ['must_not_call'], 'enterprise_refund-1': ['must_not_call']}
留: 红格子 22 -> 7
留: 红格子 12 -> 10
```

四个判决和昨天手工下的结论一致:v2-a 留、v2-b 撤、v2-b2 留、v2-c 留。第二行有一个昨天 `compare` 没列出的名字:`enterprise_refund-1`。它在基线里本来就红在 `facts`,`v2b` 里 `facts` 碰巧绿了,`must_not_call` 新红,`all_pass` 一直是红,没有翻转,`compare` 看不见,`verdict` 逐项比,抓住了。这就是昨天留下的那个盲区,今天补上了。

还有一个更微妙的地方,要说清楚,别把它当成「完全自动」:`enterprise_refund-2` 在 `v2b` 里**也**真的调了 `create_refund_request`(昨天的练习 1 看到了),可它在 `FLAKY` 里,被跳过了。判决仍然是「撤」,是因为另外三条够了;如果只有它一条出问题,`verdict` 会漏判。**`FLAKY` 是个有副作用的清单**:它让判决少了误报,也让判决多了漏报。每往里加一个名字,都要问「它抖的是哪一项」,而不是整条用例豁免。练习 1 会让你看清这一点。

## 本周错题与坑清单

按天整理,每条一句话,后面是「怎么发现的」:

| 天 | 坑 | 怎么发现的 |
| --- | --- | --- |
| 476 | 覆盖矩阵第一版把 M5(身份不明不泄露)算成 72 条,实际只有 5 条 | 每条用例都适用的「保险项」也被算进了覆盖;区分「主项」(指标定义本身)和「保险项」(多加的一道防线)以后才对 |
| 476 | M8(大额复核)一条用例都造不出 | 按规则建不出超过 1000 元的申请(非企业版年付最高 950,企业版一律转人工);写成已知缺口,没有硬造 |
| 477 | 一条完全正确的回复被字面匹配的事实检查判成红 | 拿 20 条真模型写的回复去试,不是满分答卷;规则只在真回复上才露出盲区 |
| 477 | 万能模板答卷 `cited` 满分 | 引用合法不等于引用相关,一篇不相干的文章只要在检索结果里,引用它就合法 |
| 478 | 规则 80.6%,加评审 55.6%,差 25 个点 | 24 条没依据里 16 条挑的是同一个词「原路退回」,而那是 `DRAFT_SYS` 明文要求说的 |
| 479 | 评审的 TPR 只有 0.5,TNR 却是 1.0 | 只看「抓住所有坏回复」会觉得很可靠;好回复只放行一半,每两条里冤枉一条 |
| 479 | 留出集上的 1.0 别当真 | 留出集样本少,一两条的差别就是十个点;给它画区间 |
| 479 | 10 个变异只抓住 6 个,漏的 4 个里有 2 个是「等价变异」 | 先问「是测试漏了,还是这个改动根本没改变行为」 |
| 480 | 看分数不读原文,按红格子数而不是按原因数,指标口径和系统用的不一致,看见红就想改题 | 四个坑各一条;放宽 6 条争议期望,79.2% 变 87.5%,被测系统一点没变 |
| 481 | 全过 3 → 3 的改动,红格子其实少了 2 个 | 只看一个数会把有用的改动当成无用的 |
| 481 | 红格子 22 → 8 的改动被撤回 | 看起来大胜,实际 4 条用例不该建申请却去建了 |
| 481 | `compare` 看不见「本来就红的用例又多红了一项」 | `enterprise_refund-1`,今天补上 |
| 481 | 同一份代码,同一条用例,五次里一次分诊转了人工 | `temperature=0` 也不保证确定;边界上的用例要多跑 |

还有一个我必须在这里记下的小问题:替身 `agent_stub.py` 里,刘洋(`C0004`)重复扣款的第二张账单编号是 `INV-202609-0104`,是替身自己的规则(原编号加 100)。真库([Day 445](/blog/agent-zero/day-445-bizdata/))里这两张是 `INV-202609-0003` 和 `INV-202609-0004`。评测只认替身自己的编号,这一周的结论不受影响;**等哪天把替身换成真图,账单编号要对齐到真库**,否则 `check_refund_eligibility` 的参数和评测集里期望的编号会对不上。

## 动手练习

### 练习 1:清空 `FLAKY`,判决会怎么变

把 `FLAKY` 临时清空,重新判决 v2-b2 和 v2-c。解释结果,并说说这对「FLAKY 清单该怎么维护」意味着什么。

<details><summary>参考答案</summary>

```python
# supportpilot/scratch/d482/ex1_empty_flaky.py
"""练习 1:把 FLAKY 清空,v2-b2、v2-c 的判决会变成什么?
运行:uv run python -m scratch.d482.ex1_empty_flaky"""
import glob

from evals import verdict
from evals.compare import load

R = "evals/reports/"
old = load(glob.glob(R + "*dev-baseline-v2.json")[0])
for label in ("v2b2", "v2c"):
    new = load(glob.glob(R + f"*-dev-{label}.json")[0])
    print(label, "有 FLAKY:", verdict.verdict(old, new))
    saved, verdict.FLAKY = verdict.FLAKY, set()  # 临时清空
    print(label, "清空后 :", verdict.verdict(old, new))
    verdict.FLAKY = saved
```

<div class="line-notes">

- `from evals import verdict` 导入模块而不是函数,这样才能改模块里的 `FLAKY` 变量:`verdict.FLAKY = set()` 改的是 `verdict.py` 里那个全局变量,`verdict.verdict(...)` 内部读到的就是新值。如果写成 `from evals.verdict import FLAKY`,改的只是这个脚本自己的副本,没有效果。
- `for label in ("v2b2", "v2c"):` 两个版本各判两次。
- `new = load(glob.glob(R + f"*-dev-{label}.json")[0])` `glob.glob` 返回匹配到的文件列表,取第 0 个。
- `saved, verdict.FLAKY = verdict.FLAKY, set()  # 临时清空` 同时赋值:`saved` 存旧的,`verdict.FLAKY` 换成空集合。右边先整体算好再赋,所以顺序不会出错。
- `verdict.FLAKY = saved` 还原,免得影响同一进程里后面的调用。

</div>

```text
v2b2 有 FLAKY: ('留', '红格子 22 -> 7')
v2b2 清空后 : ('撤', "不变量变红: {'injection-1': ['handoff']}")
v2c 有 FLAKY: ('留', '红格子 12 -> 10')
v2c 清空后 : ('待查', "变红 ['invoice_how-4'],先重复跑区分改坏还是噪声")
```

清空以后,v2-b2 被判「撤」,理由是 `injection-1` 的 `handoff` 红了;可昨天练习 4 证明那是分诊自己抖的,5 次里 1 次转人工,和 v2-b2 无关。v2-c 被判「待查」,是 `invoice_how-4` 翻红,昨天重复跑证明了是噪声。结论:**没有 `FLAKY` 清单,`verdict` 会把噪声当成改坏,判错**。反过来,清单写太宽也有害:`enterprise_refund-2` 在 v2-b 里真的多调了建申请,却被 `FLAKY` 豁免了。维护原则是:一个名字进清单,要有重复跑的证据;最好记下它**抖的是哪一项**,只豁免那一项,而不是整条用例。

</details>

### 练习 2:把成本警告线降到 5%

`COST_WARN` 改成 0.05,再判 v2-a(平均成本从 ¥0.00511 涨到 ¥0.00564)。

<details><summary>参考答案</summary>

```python
# supportpilot/scratch/d482/ex2_cost_warn.py
"""练习 2:成本警告线从 20% 降到 5%,v2-a(平均成本 +10%)的判决会多一句什么?
运行:uv run python -m scratch.d482.ex2_cost_warn"""
import glob

from evals import verdict
from evals.compare import load

R = "evals/reports/"
old = load(glob.glob(R + "*-dev-ctrl.json")[0])
new = load(glob.glob(R + "*-dev-v2a.json")[0])
print("20%:", verdict.verdict(old, new))
verdict.COST_WARN = 0.05
print(" 5%:", verdict.verdict(old, new))
```

<div class="line-notes">

- `old = load(glob.glob(R + "*-dev-ctrl.json")[0])` v2-a 的「之前」是 ctrl,不是 baseline-v2,因为 ctrl 是同一批 7 条用例、没改代码的对照。
- `print("20%:", verdict.verdict(old, new))` 默认的 20% 线,v2-a 涨了 10.4%,没超,判决只有「留: 红格子 19 -> 17」。
- `verdict.COST_WARN = 0.05` 模块里的全局变量,函数每次调用时才读它,所以改了立刻生效。

</div>

```text
20%: ('留', '红格子 19 -> 17')
 5%: ('留', '红格子 19 -> 17(成本 +10%,超过 5%)')
```

判决没变,只多了一句成本提示。成本涨 10% 是因为 4 条用例多了一次起草(质检打回重写)。这个提示不改变「留」的结论,它提醒你:钱要算,PRD 的 M13 是单张工单 ¥0.05 以内,现在每张 ¥0.007 左右,10% 的涨幅离红线很远。如果哪天成本逼近红线,这一行就该升级成判决的一部分。

</details>

### 练习 3:给 `verdict` 补一个「新增用例」的测试

局部重跑的报告里可能有旧报告没有的用例。写一个测试:新报告里多出一条旧报告没有的用例,而且它的不变量是红的,`verdict` 应该怎么判?先猜,再写测试验证。

<details><summary>参考答案</summary>

先猜:`regressions` 里有 `if i not in old ... continue`,所以多出来的用例被跳过,不会触发「撤」;`compare` 也只看两边共有的用例。如果共有的用例没问题,判决会是「无效」(红格子没减少)。测试:

```python
# 追加到 supportpilot/tests/test_verdict.py
def test_case_only_in_new_report_is_ignored():
    old = {"x": row(False, facts=False)}
    new = {"x": row(False, facts=False), "y": row(False, must_not_call=False)}  # y 旧报告里没有
    v, _ = verdict(old, new)
    assert v == "无效"
```

<div class="line-notes">

- `old = {"x": row(False, facts=False)}` 旧报告只有一条用例 `x`。
- `new = {"x": row(False, facts=False), "y": row(False, must_not_call=False)}` 新报告多了 `y`,而且 `y` 的不变量 `must_not_call` 是红的。
- `v, _ = verdict(old, new)` 返回的是一个二元组,只要第一个元素(判决),第二个用 `_` 丢掉。
- `assert v == "无效"` `y` 被两处都跳过:`regressions` 里 `i not in old` 直接 `continue`,`compare` 里 `common` 只取共有的。共有的 `x` 红格子 1 到 1,没减少,所以是「无效」。

</div>

```text
......                                                                   [100%]
6 passed in 0.02s
```

猜对了。这个行为是**有意的**:没有「之前」可比的用例,没法说它是改动造成的。但它也是一个潜在的漏洞:如果你的改动让**新加的**用例红了,`verdict` 不会管。新加用例要当成新基线单独看一遍,不要靠判决。

</details>

### 练习 4:改坏 `verdict`,看测试抓得住几处

写一个小脚本,把 `verdict.py` 故意改坏三处(「没减少也算留」「旧的是 `None` 也算不变量变红」「不再忽略已知抖动用例」),每次在临时副本里跑 `tests/test_verdict.py`,看抓住几处。第一次只有前面的 5 个测试,先跑一遍,补一个测试,再跑一遍。

<details><summary>参考答案</summary>

```python
# supportpilot/scratch/d482/mutate_verdict.py
"""练习 4:故意把 verdict.py 改坏三处,看 tests/test_verdict.py 抓住几处。
运行:uv run python -m scratch.d482.mutate_verdict"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
MUTATIONS = [
    ('d["red_new"] < d["red_old"]', 'd["red_new"] <= d["red_old"]', "红格子没减少也算留"),
    ('is not False and new[i]["scores"].get(k) is False', 'is True and new[i]["scores"].get(k) is False', "旧的是 None 不算不变量变红"),
    ("if i not in old or i in FLAKY:", "if i not in old:", "不再忽略已知抖动用例"),
]


def main() -> None:
    survived = []
    for old, new, why in MUTATIONS:
        with tempfile.TemporaryDirectory() as tmp:
            dst = Path(tmp) / "proj"
            shutil.copytree(ROOT, dst, ignore=shutil.ignore_patterns(".venv", "__pycache__", "reports", ".pytest_cache", "scratch"))
            f = dst / "evals" / "verdict.py"
            src = f.read_text(encoding="utf-8")
            if old not in src:
                print("  变异失效(原文找不到):", why)
                continue
            f.write_text(src.replace(old, new, 1), encoding="utf-8")
            r = subprocess.run([sys.executable, "-m", "pytest", "-q", "-x", "tests/test_verdict.py"], cwd=dst, capture_output=True, text=True)
            killed = r.returncode != 0
            print(f"  {'抓住' if killed else '漏了'}  {why}")
            if not killed:
                survived.append(why)
    print(f"{len(MUTATIONS) - len(survived)}/{len(MUTATIONS)} 被抓住;漏掉:{survived}")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `ROOT = Path(__file__).resolve().parent.parent.parent` 脚本在 `scratch/d482/` 下,往上三层是项目根目录:`d482` 的上一层是 `scratch`,再上一层是 `supportpilot`。`.resolve()` 先把相对路径展开成绝对路径。
- `('d["red_new"] < d["red_old"]', 'd["red_new"] <= d["red_old"]', "红格子没减少也算留"),` 每个变异是一个三元组:原文片段、改坏后的片段、一句描述。第一个把 `<` 改成 `<=`,红格子相等时本该是「无效」,现在变成「留」。
- `with tempfile.TemporaryDirectory() as tmp:` 临时目录,用完自动删除。真文件不会被动到,这是变异测试的基本要求。
- `shutil.copytree(ROOT, dst, ignore=shutil.ignore_patterns(".venv", "__pycache__", "reports", ".pytest_cache", "scratch"))` 把整个项目拷到临时目录,跳过虚拟环境、旧报告、缓存和 `scratch`。
- `if old not in src:` 要改的那段找不到,说明 `verdict.py` 已经变了,变异失效。打印出来,不要悄悄当成「抓住」。
- `f.write_text(src.replace(old, new, 1), encoding="utf-8")` 只替换第一处。
- `r = subprocess.run([sys.executable` 在副本里只跑 `test_verdict.py`,`-x` 红一条就停。
- `killed = r.returncode != 0` pytest 红了返回码非零,说明测试抓住了这处破坏。

</div>

只有 5 个测试时:

```text
  漏了  红格子没减少也算留
  漏了  旧的是 None 不算不变量变红
  抓住  不再忽略已知抖动用例
1/3 被抓住;漏掉:['红格子没减少也算留', '旧的是 None 不算不变量变红']
```

先问漏掉的两个。第一个:5 个测试里没有「红格子正好相等」的情形(`test_flaky_case_does_not_count` 是红格子 0 到 1),把 `<` 改成 `<=` 没人察觉。这是**测试漏了**,补一个:

```python
# 追加到 supportpilot/tests/test_verdict.py
def test_same_red_cells_is_not_a_keep():
    old = {"e": row(False, facts=False)}
    new = {"e": row(False, facts=False)}
    assert verdict(old, new)[0] == "无效"
```

第二个:把 `is not False` 改成 `is True`,区别只在「旧的是 `None`(不考)、新的是 `False`」。同一条用例同一项,旧报告不考、新报告却考了,正常情况下不会出现,所以这是一个**等价变异**,测试不可能也不应该红,留着。补测试之后:

```text
  抓住  红格子没减少也算留
  漏了  旧的是 None 不算不变量变红
  抓住  不再忽略已知抖动用例
2/3 被抓住;漏掉:['旧的是 None 不算不变量变红']
```

3 个变异,2 个被抓住,1 个是等价变异,没有「测试漏了」的。

</details>

验收标准:`recall_check` 10/10(默写的两段是你自己写的,不是抄的);`verdict.py` 能对昨天的四个版本给出和手工一致的判决;`tests/test_verdict.py` 至少 6 个测试全绿;能说出 `compare` 的盲区是什么、`verdict` 怎么补上、`FLAKY` 清单的副作用。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 复习日 | 每六个内容日自动插一天。不学新概念,把本周串起来、默写、用本周知识做一个小项目 |
| 评测链路 | 评测集、规则检查、模型评审、评审的评审、错误分析、迭代,这一周从头到尾搭了一遍 |
| 判决 | 对一处改动给出「留、撤、待查、无效」之一的结论,依据是改动前后两份报告 |
| 无效改动 | 红格子没有减少:改动没起作用,或者只影响了评测没考的东西 |
| 待查 | 有用例从全过变成不全过,还没分清是改坏还是噪声,先重复跑 |
| 已知抖动清单 | 手工维护的一份用例名单,每条都有重复跑的证据。好处是少误报,代价是可能漏报 |
| 盲区 | 一个检查看不见的情形。`compare` 的盲区是「本来就红的用例又多红了一项」 |
| 等价变异 | 改了代码但行为没变,测试不可能也不应该红。要先分清它和「测试漏了」 |

## 常见误区

**复习日只读不写。**不默写的话,看了六天是「看过」,不是「会」。默写那两段合上文章再来一遍,写不出来的地方才是真正没记住的。

**拿测试通过当尺子没问题。**`recall_check` 里我自己的期望值第一次写错了,红格子数我算成 4,实际是 3。断言里的期望值也是要被检查的代码。

**把清单当成免死金牌。**`FLAKY` 里写了某条用例,它出什么问题判决都不管了。结果 `enterprise_refund-2` 在 v2-b 里真的多调了建申请,判决仍然是「撤」,靠的是另外三条用例。清单要记「哪条用例的哪一项会抖」。

**以为自动判决比人判得准。**`verdict` 只是把 Day 481 我手工判的几条规则写了下来,它没有比人聪明,它的好处是每次判得一样、不会忘记看不变量。它用的清单、阈值、不变量集合,每一个都是人定的。

**一个数字下结论。**`compare` 的「变绿、变红」只看 `all_pass`,`verdict` 的不变量检查逐项看,红格子总数看整体。三种口径回答三个不同的问题,别混用。

## 学习资料

### 文档与文章

- [Hamel Husain · A Field Guide to Rapidly Improving AI Products](https://hamel.dev/blog/posts/field-guide/):英文,把整周做的事(看数据、错误分析、评测驱动迭代)放在一起讲,复习日适合通读一遍,1 小时。
- [Anthropic · Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):英文,评测的几种判分器(代码判、模型判、人判)和各自的取舍,对照本周的三层,30 分钟。
- [Hamel Husain · Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/):英文,评测的三个层次,和这一周规则、评审、人工标注的分层对应,40 分钟。
- [Shreya Shankar 等 · Who Validates the Validators?](https://arxiv.org/abs/2404.12272):英文论文,评判标准在看输出的过程中会变,对照 Day 479 重新标注和 Day 480 改题要第二个人同意,读摘要和第 1 节。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Zh9xBvEgt&autoplay=0&high_quality=1" title="怎么给 AI Agent 打分:Eval 工程的共同困境|Anthropic 精讲 Ep6" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>TreeDy1 · 怎么给 AI Agent 打分:Eval 工程的共同困境|Anthropic 精讲 Ep6 · 4 分钟,判分器的局限,复习这一周造尺子的那几天。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1k4HZ6xEHR&autoplay=0&high_quality=1" title="一口气学会AI Agent可观测性与Evals/LLM Ops/Tracing/成本追踪/开源实测" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>肖恩君Sean · 一口气学会AI Agent可观测性与Evals/LLM Ops/Tracing/成本追踪/开源实测 · 21 分钟,评测之后的下一段路(可观测和成本),Day 484 起会接着用,先预习评测那一段。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/QEk-XwrkqhI" title="10 Things I Hate About AI Evals with Hamel Husain" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Vanishing Gradients · 10 Things I Hate About AI Evals with Hamel Husain · 英文,开字幕。评测里最常见的坏做法:不看数据、盲信打分、指标和产品脱节,复习时对照本周踩的坑。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):英文。评测相关的章节是本周内容的系统版本,复习时挑和「评测方法、评审、迭代」相关的部分对照。

### 开源项目与代码

- [UKGovernmentBEIS/inspect_ai](https://github.com/UKGovernmentBEIS/inspect_ai):评测框架,自带日志查看器和多次运行的汇总,和本周手写的 `run_eval.py`、`compare.py` 做的是同一类事的工具化版本,翻一翻它的目录结构。

## 自测

1. 这一周的三层尺子是什么?每一层各有什么盲区?

<details><summary>答案</summary>

规则检查、模型评审、人工标注(用来检验评审)。规则确定、免费、快,盲区是否定句、换了说法的事实、引用相关性(Day 477);模型评审能补前两个盲区,但它自己会冤枉对的回复,第一版 TPR 只有 0.5,要用人工标注的样本去测它(Day 479);人工标注样本少,留出集上的 1.0 不能当真,要画区间。

</details>

2. `compare` 的盲区是什么?`verdict` 怎么补的?

<details><summary>答案</summary>

`compare` 只看每条用例的 `all_pass` 有没有翻转。一条用例本来就红在别的评测项上,这次又新红了一个不变量项,`all_pass` 始终是 False,既不在「变绿」也不在「变红」里,`compare` 看不见。`verdict` 的 `regressions` 逐个不变量项比较「旧的不是红、新的红了」,不依赖 `all_pass`,所以抓得住(`enterprise_refund-1` 在 v2-b 里就是这种)。

</details>

3. 为什么「红格子减少」不能单独作为留下一处改动的理由?

<details><summary>答案</summary>

红格子是各项检查被重复报告的数量。v2-b 第一版红格子从 22 降到 8,看起来大胜,但有 4 条用例不该建申请却去建了,`must_not_call` 红了。不变量(碰钱、碰权限的项)红了,哪怕总数在减少也不能留。所以判决规则里不变量检查排在第一位,红格子减少只排在第三。

</details>

4. `FLAKY` 清单为什么有副作用?怎么降低它?

<details><summary>答案</summary>

它让已知会抖的用例翻红时不触发「撤」或「待查」,减少了误报;但用例一旦进了清单,它真的出问题时判决也看不见了(`enterprise_refund-2` 在 v2-b 里真的多调了建申请,被豁免)。降低副作用的办法:每个名字都要有重复跑的证据;最好记下它抖的是哪一项,只豁免那一项;定期把清单里的用例拿出来重新多跑几次,确认还在抖。

</details>

5. 面试题:你的评测集上一处改动让红格子从 22 降到 8,你要不要上线?你怎么判断?

<details><summary>答案</summary>

不能只看红格子。先看不变量项(碰钱、碰权限的检查)有没有从不红变红,有就撤回,红格子再少也不行。再看有没有用例从全过变成不全过,逐条看红的是哪一项、工具轨迹是什么,区分改坏和噪声(重复跑几次)。还要看是不是只有 `all_pass` 没翻转、但某一项变坏的用例。最后看成本和延迟有没有越过线。四项都过,再在没碰过的 test 集上跑一次,和 dev 的差距在预设范围内才算数。我会把这些判断写成规则(类似 `verdict.py`),每次改动用同一套规则判,不靠当时的心情。

</details>

6. 面试题:你怎么证明你的评测本身是可靠的?

<details><summary>答案</summary>

分层回答。评测集:标准答案用另一份独立实现重算,评测集自己有检查,故意改坏几处看检查抓不抓。规则:用满分答卷证明不冤枉对的,用故意改坏证明每个缺陷被对应的检查抓住,用真模型写的回复找盲区。模型评审:自己标一批样本,算 TPR 和 TNR,改提示词后在没参与调优的留出集上验证,并量评审自己的波动。评测代码:写测试,再故意改坏,看测试抓住几个,分清「测试漏了」和「等价变异」。最后保留几处它判不了的地方并说清楚,不假装它什么都能判。

</details>

## 明天预告

明天是 [Day 483](/blog/agent-zero/day-483-iterate-3/),迭代(三):提分手段清单,最后跑一次 test。今天写好的 `verdict.py` 明天派上用场:继续改昨天没碰的几类(工具返回里补转交对象、分诊提示词给类别下定义、评审要看到客户的原话),每处改动用 `verdict` 判一次;然后第一次跑完整的 dev,看 PRD 的 80% 线过没过,最后在全程没碰过的 test 集上跑唯一一次,看和 dev 的差距是不是在 5 个点以内。
