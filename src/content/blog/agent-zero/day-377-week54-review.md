---
title: 'Day 377 · 第 54 周复习:评测与可观测(Day 371–376)'
description: '这一周把手册式的提示词优化、线上反馈闭环、评测系统和 CI 门禁连成了一个圈。今天默写三段:门禁函数、手册整理者、改写比例,各自和原版对拍;3000 组随机输入抓得到五种改错里的四种,抓不到「小于号写成小于等于号」(只有 4 组)。小项目把一周的虚构回复走完整条线:聚类阈值 0.7 把一条误点并进了专票组,新用例刚加进去时门禁会因为总分下降而拦住加用例本身。'
pubDate: 2026-10-27
regime: none
tags: ['eval', 'ci', 'review', 'agent-zero']
series: 'agent-zero'
day: 377
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 376](/blog/agent-zero/day-376-eval-project-3/) 是评测小项目的最后一天。不再调模型,用存下来的运行记录做了两个离线实验:重判分数,以及模拟「代码一行没改,门禁会误报几次」(第一版规则 12.5%,改完 4.7%)。后面是把项目讲成一个带数字的故事、十道面试题和一份坑清单。

今天是第六部分的最后一天,也是这一周的复习日。这一周的六天看起来是三件事:自动优化提示词(Day 371)、线上反馈闭环(Day 372–373)、评测小项目(Day 374–376)。其实是一个圈:线上的问题变成测试用例,用例喂给评测,评测结果由门禁把关,门禁放行的改动上线,上线以后又产生新的线上问题。今天把这个圈走一遍。

## 今天要解决的问题

学完今天,你应该能:

1. 说出这一周每一课在那个圈里管哪一块,并各用一个具体数字复述。
2. 合上文章默写 Day 375 的门禁函数,用随机对拍和原版比,说得出哪类改错对拍抓得到,哪类抓不到。
3. 合上文章默写 Day 371 手册的整理者(去重、淘汰、清理)和 Day 372 的改写比例,和原版结果一致。
4. 用本周的零件拼一个小项目:一周的回复 → 候选 → 聚类 → 用例 → 门禁,并读出其中两个只有走完全程才会碰到的问题。

预计用时 3.5 小时:三段默写各 30 分钟,小项目 1 小时,剩下做练习和自测。前置:这一周所有文件,具体是 [Day 371](/blog/agent-zero/day-371-prompt-opt-3/) 的 `part06/ace_lite.py`、[Day 372](/blog/agent-zero/day-372-feedback-1/) 的 `part06/fb_signals.py`、[Day 373](/blog/agent-zero/day-373-feedback-2/) 的 `part06/fb_cluster.py`、[Day 374](/blog/agent-zero/day-374-eval-project-1/) 的 `part06/eval_checks.py`、[Day 375](/blog/agent-zero/day-375-eval-project-2/) 的 `part06/gate.py`,以及 [Day 217](/blog/agent-zero/day-217-embed-service/) 的 `common/embed.py`。

**今天一次模型都没有调**(DeepSeek 费用 0 元)。小项目里聚类用了 embedding,三个脚本合计约 2,700 token,按我用的 bge-m3 在硅基流动上的价格这是几乎可以忽略的量(我没有当场查最新价,所以不写具体金额)。

**说清楚我这次实跑的环境**:我的实跑目录里没有 Day 371 到 Day 376 的全部文件,所以把今天要用到的那几个函数从文章里原样抽了出来(`gate.py` 整个文件,`ace_lite.py` 里的 `Bullet`、`too_similar`、`curate`、`prune`,`fb_signals.py` 里的 `edit_ratio`,`fb_cluster.py` 里的 `cluster`、`purity`),另外补了一个只含 `CRITICAL` 名单的 `eval_checks.py`。你的仓库里这些文件都是全的,直接 `import` 就行,不需要照着我的抽法做。

学法和平时一样:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章把三段默写代码再写一遍;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 290" role="img" aria-label="第 54 周知识地图:线上回复经改写比例和聚类变成可疑回复,人审后变成测试用例,进评测系统,由回归门禁把关,放行的改动(包括手册改动)上线,上线后又产生新的线上回复">
<rect x="0" y="0" width="640" height="290" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="30" width="170" height="60" rx="5" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
<text x="105" y="54" fill="var(--ink)" text-anchor="middle">线上回复 · 372</text>
<text x="105" y="74" fill="var(--ink-soft)" text-anchor="middle" font-size="11">草稿/改写/点踩</text>
<rect x="235" y="30" width="170" height="60" rx="5" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
<text x="320" y="54" fill="var(--ink)" text-anchor="middle">可疑回复 · 373</text>
<text x="320" y="74" fill="var(--ink-soft)" text-anchor="middle" font-size="11">改写比例 + 聚类</text>
<rect x="450" y="30" width="170" height="60" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="535" y="54" fill="var(--ink)" text-anchor="middle">测试用例 · 373</text>
<text x="535" y="74" fill="var(--ink-soft)" text-anchor="middle" font-size="11">人审、脱敏、护栏</text>
<rect x="450" y="160" width="170" height="60" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="535" y="184" fill="var(--ink)" text-anchor="middle">评测系统 · 374</text>
<text x="535" y="204" fill="var(--ink-soft)" text-anchor="middle" font-size="11">三层检查 × 多次</text>
<rect x="235" y="160" width="170" height="60" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="184" fill="var(--ink)" text-anchor="middle">回归门禁 · 375</text>
<text x="320" y="204" fill="var(--ink-soft)" text-anchor="middle" font-size="11">越权零容忍/新挂/兜底</text>
<rect x="20" y="160" width="170" height="60" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="105" y="184" fill="var(--ink)" text-anchor="middle">改动上线 · 371</text>
<text x="105" y="204" fill="var(--ink-soft)" text-anchor="middle" font-size="11">手册改动也是一个 PR</text>
<path d="M190 60 L235 60" stroke="var(--ink-faint)" marker-end="url(#m377)"/>
<path d="M405 60 L450 60" stroke="var(--ink-faint)" marker-end="url(#m377)"/>
<path d="M535 90 L535 160" stroke="var(--ink-faint)" marker-end="url(#m377)"/>
<path d="M450 190 L405 190" stroke="var(--ink-faint)" marker-end="url(#m377)"/>
<path d="M235 190 L190 190" stroke="var(--ink-faint)" marker-end="url(#m377)"/>
<path d="M105 160 L105 90" stroke="var(--ink-faint)" marker-end="url(#m377)"/>
<text x="20" y="250" fill="var(--ink-soft)" font-size="11">376:拿存下来的运行离线重判、模拟门禁在代码没改时的误报率(12.5% → 4.7%)。</text>
<text x="20" y="270" fill="var(--ink-faint)" font-size="11">今天的小项目:把一周的虚构回复从左上走到门禁,中间有两个坑。</text>
<defs><marker id="m377" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--ink-faint)"/></marker></defs>
</g>
</svg>
<figcaption>这一周是一个圈。上半圈把线上的问题变成用例,下半圈让用例守着每一次改动;改动上线后又产生新的线上问题。哪一步断了,圈就停:没有 372 就不知道线上哪里错,没有 375 就没人拦坏改动。</figcaption>
</figure>

这张图里最容易漏的是**每一个箭头上都有一个人**:372 到 373 之间有分诊的人,373 到用例之间有人审(模型只能猜原因,不能决定什么算错),375 放行以后手册改动怎么合并也要人点。自动化的是搬运和计算,判断留给人。

## 本周每天一句话

- [Day 371](/blog/agent-zero/day-371-prompt-opt-3/) · ACE 和怎么上生产:整段重写的优化器会把规则写宽、把「重复扣款」这种细节写丢;ACE 的做法是基础说明不动,手册里一条条加规则,每条记帮了几次、害了几次,整理(去重、淘汰、清理)交给不调模型的普通代码;手册改动当成 PR 过一道门禁,实测拦下了一条写太宽的规则和一次丢规则的改动。
- [Day 372](/blog/agent-zero/day-372-feedback-1/) · 显式和隐式反馈:建回复表和反馈事件表,三个收反馈的接口,算改写比例;造一周虚构数据,200 条回复只有 60 条有人点,重度改写的 39 条里只有 8 条被点踩。
- [Day 373](/blog/agent-zero/day-373-feedback-2/) · badcase 分诊、聚类、进测试集:41 条可疑回复聚成 3 个真问题加 2 个误点(阈值 0.7);人审以后变成带脱敏和护栏的测试用例,知识缺失的起草成帮助中心文章,最后接回 Day 371 的门禁。
- [Day 374](/blog/agent-zero/day-374-eval-project-1/) · 评测系统:12 条用例、代码/轨迹/评分器三层检查、每条跑三次、一页报告;第一版 66.7% 通过,读报告读出评分器悄悄放过了一次没回答问题的回复。
- [Day 375](/blog/agent-zero/day-375-eval-project-2/) · CI 门禁:越权零容忍、基线里稳的用例不能退步、总分兜底;11 个测试加变异测试;本机模拟三个 PR,精简 prompt 的被拦,只改措辞的被误拦,查原因后改的是「新挂」的定义,不是阈值。
- [Day 376](/blog/agent-zero/day-376-eval-project-3/) · 面试题和坑清单:离线重判;模拟门禁在代码没改时的误报率,第一版规则 12.5%,改完 4.7%;「4.7%」只能说「大约 5%」。

## 默写一:门禁函数

这是这一周最该会默的一段,因为它是整个圈里最后一道关。先在空文件里自己写 `my_gate`,输入输出和 Day 375 的 `gate.gate` 完全一样。写完怎么判断对不对?如果只靠你记得的几个例子,你只会验证你想到的情况。这里用一个新办法:**对拍**,把同一批输入同时喂给你的版本和原版,比较输出。输入不手写,用随机数造 3000 组。

下面的文件里,前半是我默写的版本(逐字和原版的逻辑一致),后半是对拍用的随机输入、对拍函数,以及「故意改坏」的五个版本:

```python
# agent-zero-lab/part06/drill_gate.py
"""默写一:Day 375 的门禁函数。写完和原版 gate.gate 对拍:3000 组随机输入,看有几组结论不一样。不调模型。
用法: uv run python -m part06.drill_gate"""
from __future__ import annotations

import inspect
import random
from collections.abc import Callable
from typing import Any

from part06.eval_checks import CRITICAL
from part06.gate import gate as original

HARD = {"no_crash", "traj:scope"}
MONEY = CRITICAL - HARD


def my_gate(summary: dict, rows: list[dict], baseline: dict | None,
            max_drop: float = 0.10, new_fail_ratio: float = 0.05) -> dict:
    reasons: list[str] = []
    hard = sorted({(r["case"], k) for r in rows for k in r["failed"] if k in HARD})
    if hard:
        reasons.append(f"崩溃或越权 {len(hard)} 处: " + ", ".join(f"{c}/{k}" for c, k in hard[:8]))
    newly_failed: list[str] = []
    newly_passed: list[str] = []
    if baseline:
        base, now = baseline["case_rate"], summary["case_rate"]
        solid = {c for c, rate in base.items() if rate == 1.0}
        money = sorted({(r["case"], k) for r in rows for k in r["failed"] if k in MONEY and r["case"] in solid})
        if money:
            reasons.append(f"原本稳的用例退款出错 {len(money)} 处: " + ", ".join(f"{c}/{k}" for c, k in money[:8]))
        newly_failed = sorted(c for c in now if c in base and base[c] == 1.0 and now[c] == 0.0)
        newly_passed = sorted(c for c in now if c in base and base[c] == 0.0 and now[c] == 1.0)
        allowed = max(1, int(len(now) * new_fail_ratio))
        if len(newly_failed) > allowed:
            reasons.append(f"{len(newly_failed)} 条原来每次都过的用例现在一次也没过(允许 {allowed} 条): {', '.join(newly_failed[:8])}")
        if summary["single_pass"] < baseline["single_pass"] - max_drop:
            reasons.append(f"单次通过率 {summary['single_pass']:.1%} 比基线 {baseline['single_pass']:.1%} 低了超过 {max_drop:.0%}")
    return {"ok": not reasons, "reasons": reasons, "newly_failed": newly_failed, "newly_passed": newly_passed}


CHECKS = ["no_crash", "outcome", "traj:scope", "traj:refund_args", "judge:facts"]
RATES = [0.0, 0.5, 1.0]
Gate = Callable[..., dict[str, Any]]


def random_input(rng: random.Random) -> tuple[dict, list[dict], dict | None]:
    names = [f"c{i}" for i in range(rng.randint(3, 14))]
    base_rate = {c: rng.choice(RATES) for c in names if rng.random() < 0.85}   # 有的用例是新加的,基线里没有
    now_rate = {c: rng.choice(RATES) for c in names}
    rows = [{"case": c, "failed": {k: "x" for k in CHECKS if rng.random() < 0.06}} for c in names for _ in range(2)]
    summary = {"case_rate": now_rate, "single_pass": round(rng.uniform(0.5, 1.0), 3)}
    baseline = None if rng.random() < 0.1 else {"case_rate": base_rate, "single_pass": round(rng.uniform(0.5, 1.0), 3)}
    return summary, rows, baseline


def fuzz(fn: Gate, n: int = 3000, seed: int = 7) -> list[int]:
    rng = random.Random(seed)
    bad: list[int] = []
    for i in range(n):
        args = random_input(rng)
        if fn(*args) != original(*args):
            bad.append(i)
    return bad


def make_mutant(old: str, new: str) -> Gate:
    """把 my_gate 的源码里 old 换成 new,再编译成一个新函数。换不到就报错,免得「没变异」被当成「没被抓住」。"""
    src = inspect.getsource(my_gate)
    assert old in src, old
    ns: dict[str, Any] = {"HARD": HARD, "MONEY": MONEY}
    exec(src.replace(old, new), ns)
    return ns["my_gate"]


MUTANTS = {
    "去掉 max(1, ..) 保底": ("max(1, int(len(now) * new_fail_ratio))", "int(len(now) * new_fail_ratio)"),
    "总分比较 < 改成 <=": ('summary["single_pass"] < baseline', 'summary["single_pass"] <= baseline'),
    "新挂不排除基线里没有的用例": ("if c in base and base[c] == 1.0 and now[c] == 0.0", "if base.get(c, 1.0) == 1.0 and now[c] == 0.0"),
    "稳的定义放宽到 >= 0.5": ("if rate == 1.0}", "if rate >= 0.5}"),
    "越权也要看基线": ("if k in HARD})\n    if hard:", "if k in HARD and baseline is None})\n    if hard:"),
}


if __name__ == "__main__":
    print("我的版本和原版结论不一致:", len(fuzz(my_gate)), "/ 3000 组")
    for name, (old, new) in MUTANTS.items():
        bad = fuzz(make_mutant(old, new))
        print(f"{name:<22} 不一致 {len(bad):>4} / 3000 组")
```

<div class="line-notes">

- `HARD = {"no_crash", "traj:scope"}` 崩溃和越权:不看基线,出现一次就拦。默写时最容易记反的一行,原版叫 `ALWAYS_BLOCK`,换名字没关系。
- `MONEY = CRITICAL - HARD` 集合相减:`{"outcome", "traj:refund_args"}`,这两个管「钱算对没有」。
- `def my_gate(` 参数和默认值(`max_drop=0.10`、`new_fail_ratio=0.05`)和原版一致,对拍时才能直接传同样的位置参数。
- `hard = sorted({(r["case"], k)` 集合推导式,去重,同一条用例三次都越权只算一处。
- `solid = {c for c, rate` 基线里每次都过(通过率恰好等于 1.0)的用例。
- `money = sorted({(r["case"], k)` 只看「原本稳的用例」上的退款出错。基线里本来就不稳的用例,金额错不算新问题。
- `newly_failed = sorted(` 新挂的定义:基线里是 1.0、现在是 0.0。写成「通过率掉了就算」会误报,这是 Day 375 第五步踩过的。
- `allowed = max(1, int(` 12 条用例时 `int(12 * 0.05)` 是 0,`max(1, ...)` 保底允许一条。
- `if summary["single_pass"] < baseline["single_pass"] - max_drop:` 总分兜底:比基线低了超过 10 个点才拦。注意是严格小于,「刚好 10 个点」放行。
- `CHECKS = [` 对拍用的检查名,包含四个关键检查和一个 `judge:facts`。
- `RATES = [0.0, 0.5, 1.0]` 每条用例的通过率只取三个值,对应「每次都挂、一半、每次都过」(每条跑两次)。
- `def random_input(` 随机造一组 `(summary, rows, baseline)`。
- `base_rate = {c: rng.choice(RATES) for c in names if rng.random() < 0.85}` 15% 的用例不在基线里,模拟「新加的用例」。
- `rows = [{"case": c` 每条用例两行逐次结果,每个检查有 6% 的概率失败。
- `def fuzz(` 对拍:同一个 `seed` 造同一批输入,返回「结论不一样」的那些组的编号。
- `if fn(*args) != original(*args):` 直接比较两个返回的字典(`ok`、`reasons`、`newly_failed`、`newly_passed` 全部要一样)。
- `def make_mutant(` 变异测试在 Day 375 做过。这里换一种做法:拿 `my_gate` 的源码,把某一段文字替换掉,再编译成新函数。
- `assert old in src, old` 如果要替换的文字根本不在源码里,马上报错。否则「没有改到」会被当成「改了但没被抓住」。
- `exec(src.replace(old, new), ns)` 执行替换后的源码,得到一个新的 `my_gate`。`ns` 里要提前放好它依赖的 `HARD`、`MONEY`。
- `MUTANTS = {` 五种故意改坏:去掉保底、小于改成小于等于、新挂不排除基线里没有的用例、稳的定义放宽、越权也要看基线。
- `for name, (old, new) in MUTANTS.items():` 每种各拿 3000 组去对拍,数有几组结论和原版不一样。

</div>

```bash
uv run python -m part06.drill_gate
```

```text
我的版本和原版结论不一致: 0 / 3000 组
去掉 max(1, ..) 保底       不一致 1461 / 3000 组
总分比较 < 改成 <=           不一致    4 / 3000 组
新挂不排除基线里没有的用例          不一致  944 / 3000 组
稳的定义放宽到 >= 0.5         不一致 1085 / 3000 组
越权也要看基线                不一致 2239 / 3000 组
```

我的版本和原版 3000 组全部一致。五种故意改坏的版本里,有四种被抓得很猛(944 到 2239 组),只有「小于改成小于等于」只被抓到 4 组,3000 组里只有千分之一点三。

原因想一想就明白:`<` 和 `<=` 只在「总分恰好等于阈值」时才有区别,而随机造的总分是 `uniform(0.5, 1.0)` 取三位小数,恰好落在「基线减 0.10」上的概率只有千分之几。这类**边界错误,随机对拍几乎抓不到**,要靠一条专门瞄准边界的手写用例,练习 1 就是做这件事。所以 Day 375 的测试里有 `test_small_score_wobble_is_not_a_regression` 和 `test_big_score_drop_blocks` 这类贴着阈值的用例,不是多余的。

另一个顺带的收获:`去掉 max(1, ..) 保底` 被抓到 1461 组,几乎一半,说明这个保底影响很大。12 条用例时 `int(12 * 0.05)` 是 0,没有保底,任何一条用例抖一下都会拦。

## 默写二:手册的整理者

第二段是 Day 371 的 `curate` 和 `prune`:去重、加新条目、超限淘汰、清理害多帮少的。这段代码里有一个很小但很关键的写法,`book[:-1]`。默写以后和原版对拍,再故意去掉它。

```python
# agent-zero-lab/part06/drill_ace.py
"""默写二:Day 371 手册的整理者(去重、淘汰、清理)。写完和原版 ace_lite 对拍,再故意去掉 [:-1] 看会怎样。不调模型。
用法: uv run python -m part06.drill_ace"""
from __future__ import annotations

import difflib
import random
from copy import deepcopy

from part06 import ace_lite
from part06.ace_lite import Bullet

POOL = [
    "出现「重复扣款」,类别是 refund",
    "出现「重复扣款」两个字,类别要选 refund",        # 和上一条很像,应该被去重
    "验证码收不到、E4031,类别是 tech",
    "客户要专票、要抬头,类别是 invoice",
    "年付中途取消想退钱,类别是 refund",
    "登录不上、密码重置,类别是 account",
    "导出一直转圈,类别是 tech",
    "想换绑手机号,类别是 account",
    "发票抬头写错要重开,类别是 invoice",
    "催问退款进度,类别是 refund",
    "优惠券用不了,类别是 billing",
    "套餐升级补差价,类别是 billing",
]


def too_similar(rule: str, book: list[Bullet]) -> bool:
    return any(difflib.SequenceMatcher(None, rule, b.text).ratio() > 0.6 for b in book)


def curate(book: list[Bullet], rule: str, limit: int = 12) -> str:
    if too_similar(rule, book):
        return "重复,没加"
    book.append(Bullet(id=max((b.id for b in book), default=0) + 1, text=rule))
    if len(book) > limit:
        worst = min(book[:-1], key=lambda b: b.helpful - b.harmful)
        book.remove(worst)
        return f"超限,淘汰 [{worst.id}]"
    return "加入"


def prune(book: list[Bullet]) -> list[int]:
    dead = [b.id for b in book if b.harmful - b.helpful >= 2]
    book[:] = [b for b in book if b.id not in dead]
    return dead


def curate_no_exclude(book: list[Bullet], rule: str, limit: int = 12) -> str:
    """故意写错:淘汰时没把刚加进来的那条排除在外。"""
    if too_similar(rule, book):
        return "重复,没加"
    book.append(Bullet(id=max((b.id for b in book), default=0) + 1, text=rule))
    if len(book) > limit:
        worst = min(book, key=lambda b: b.helpful - b.harmful)
        book.remove(worst)
        return f"超限,淘汰 [{worst.id}]"
    return "加入"


def run(curate_fn, prune_fn, seed: int, limit: int = 5) -> tuple[list[tuple[int, str, int, int]], list[str], list[list[int]]]:
    """随机喂 40 条规则,每条之后随机给手册里每条加几次帮/害,偶尔 prune。返回最终手册、每步日志、每次 prune 删了谁。"""
    rng = random.Random(seed)
    book: list[Bullet] = []
    log: list[str] = []
    pruned: list[list[int]] = []
    for _ in range(40):
        log.append(curate_fn(book, rng.choice(POOL), limit))
        for b in book:
            b.helpful += rng.randint(0, 1)
            b.harmful += rng.randint(0, 1) if rng.random() < 0.4 else 0
        if rng.random() < 0.3:
            pruned.append(prune_fn(book))
    return [(b.id, b.text, b.helpful, b.harmful) for b in book], log, pruned


if __name__ == "__main__":
    same = sum(run(curate, prune, s) == run(ace_lite.curate, ace_lite.prune, s) for s in range(500))
    print(f"我的版本和原版完全一致: {same} / 500 个随机种子")
    same2 = sum(run(curate_no_exclude, prune, s) == run(ace_lite.curate, ace_lite.prune, s) for s in range(500))
    print(f"去掉 [:-1] 的错版本和原版一致: {same2} / 500 个随机种子")

    book = [Bullet(1, "规则一", helpful=2), Bullet(2, "规则二", helpful=1)]
    print("手册满了(上限 2),来一条全新的规则:")
    for fn in (curate, curate_no_exclude):
        b = deepcopy(book)
        print(f"  {fn.__name__:<18}", fn(b, "完全不同的第三条规则 abc", limit=2), "→ 手册里剩", [x.id for x in b])
```

<div class="line-notes">

- `POOL = [` 十二条规则的素材,第二条故意和第一条很像,用来触发去重。
- `def too_similar(` 用标准库 `difflib` 的字符串相似度,比例超过 0.6 就算重复。
- `def curate(book` 整理:太像不加;加了以后超过上限就淘汰一条。返回一句话说明发生了什么。
- `worst = min(book[:-1]` `book[:-1]` 把刚加进去的那条排除在淘汰候选之外。新规则的帮/害计数都是 0,净分最低,不排除的话它一进来就被淘汰。
- `def prune(` 害的次数比帮的次数多 2 次或以上,删掉。
- `def curate_no_exclude(` 故意写错的版本,和上面唯一的区别是下面那一行。
- `worst = min(book, key` 去掉了 `[:-1]`,候选里包含刚加的那条。
- `def run(curate_fn` 随机喂 40 条规则,把整个过程的最终手册、每步日志、每次 `prune` 删了谁都收集起来,返回一个元组,方便整体比较。
- `rng = random.Random(seed)` 同一个 `seed` 造出同一串随机数,原版和我的版本才能吃到完全一样的输入。
- `log.append(curate_fn(book, rng.choice(POOL), limit))` 手册上限设成 5,这样很快就会超限,淘汰的逻辑每个种子都会被走到。
- `for b in book:` 每一步之后,给手册里每条随机加「帮」和「害」的计数,模拟训练过程里的引用。
- `if rng.random() < 0.3:` 30% 的概率顺手整理一次(调用 `prune`)。
- `same = sum(run(curate, prune, s) == run(ace_lite.curate, ace_lite.prune, s) for s in range(500))` 500 个随机种子,每个种子两边各跑一遍,比较整个过程。`True` 当作 1 求和。
- `b = deepcopy(book)` 手册满了(上限 2)时来一条全新的规则,两个版本各用一份拷贝,互不影响。

</div>

```bash
uv run python -m part06.drill_ace
```

```text
我的版本和原版完全一致: 500 / 500 个随机种子
去掉 [:-1] 的错版本和原版一致: 7 / 500 个随机种子
手册满了(上限 2),来一条全新的规则:
  curate             超限,淘汰 [2] → 手册里剩 [1, 3]
  curate_no_exclude  超限,淘汰 [3] → 手册里剩 [1, 2]
```

我的版本 500 个种子全部一致。去掉 `[:-1]` 以后只有 7 个种子碰巧一致,其余 493 个都不同,最后那个小演示讲得最清楚:手册里有 1 号(帮了 2 次)和 2 号(帮了 1 次),来了第三条规则,正确的版本淘汰了净分最低的 2 号,留下 1 号和新来的 3 号;错版本淘汰的是 3 号,**新规则一进来就被踢出去了**,手册永远学不到新东西。这个错在运行的时候不会报任何异常,日志里还会打印「超限,淘汰 [3]」,只有读日志的人才能发现淘汰的总是最新那条。

## 默写三:改写比例

第三段最短。`edit_ratio` 是一行,再加一个「重度改写」的判断。顺带验证一个我自己都没想过的问题:草稿和客服发出的版本换个顺序,算出来的比例一样吗?

```python
# agent-zero-lab/part06/drill_ratio.py
"""默写三:Day 372 的改写比例,外加一个顺带发现:草稿和发出版本换个顺序,比例会不会变。不调模型。
用法: uv run python -m part06.drill_ratio"""
from __future__ import annotations

import random
from difflib import SequenceMatcher

from part06.fb_signals import edit_ratio as original

HEAVY = 0.5


def edit_ratio(draft: str, sent: str) -> float:
    return round(1 - SequenceMatcher(None, draft, sent).ratio(), 3)


def is_heavy(draft: str, sent: str) -> bool:
    return edit_ratio(draft, sent) >= HEAVY


CASES = [
    ("原样发出", "可以重开。请在「发票管理」里点作废,再按新抬头重新申请,一般 1 个工作日内开出。",
     "可以重开。请在「发票管理」里点作废,再按新抬头重新申请,一般 1 个工作日内开出。"),
    ("短草稿加客套", "企业版年付 1908 元/年。", "企业版年付 1908 元/年。如还有问题随时联系我们。"),
    ("专票资料补全", "请提供公司名称和税号即可。", "请提供公司名称、税号、注册地址和电话、开户行及账号,四项缺一不可。"),
    ("错误码答错", "请清除浏览器缓存后重试。", "E4031 表示验证码已过期,请点「重新发送」,并在 5 分钟内输入。"),
]

if __name__ == "__main__":
    for name, d, s in CASES:
        print(f"{name:<8} 我的 {edit_ratio(d, s):.3f}  原版 {original(d, s):.3f}  重度改写={is_heavy(d, s)}")
    rng = random.Random(1)
    alphabet = "退款发票验证码登录年付专票重开抬头"
    diff = asym = 0
    for _ in range(2000):
        a = "".join(rng.choice(alphabet) for _ in range(rng.randint(5, 40)))
        b = "".join(rng.choice(alphabet) for _ in range(rng.randint(5, 40)))
        diff += edit_ratio(a, b) != original(a, b)
        asym += edit_ratio(a, b) != edit_ratio(b, a)
    print(f"2000 对随机字符串:和原版不一致 {diff} 对;(草稿,发出) 和 (发出,草稿) 结果不同 {asym} 对")
```

<div class="line-notes">

- `HEAVY = 0.5` Day 372 实测六种改法后取的门槛:客套话最高 0.286,真改错最低 0.522。这个数只在那份数据上成立。
- `def edit_ratio` 默写的一行函数。
- `return round(1 - SequenceMatcher` `SequenceMatcher(None, draft, sent).ratio()` 是相似度,1 减掉就是「改了多少」。`None` 表示不忽略任何字符。
- `def is_heavy` 超过门槛就算重度改写。
- `CASES = [` 从 Day 372 的六种改法里挑四种:原样、短草稿加客套、专票资料补全、错误码答错。
- `for name, d, s in CASES:` 每条打印我的值、原版的值、是不是重度改写。
- `rng = random.Random(1)` 固定种子,造 2000 对随机字符串。字符表只有 17 个字,所以字符串之间有很多重复片段。
- `diff += edit_ratio(a, b) != original(a, b)` 我的版本和原版不一致的对数。
- `asym += edit_ratio(a, b) != edit_ratio(b, a)` 把两个参数调换以后,结果不同的对数。`SequenceMatcher` 不保证对称。

</div>

```bash
uv run python -m part06.drill_ratio
```

```text
原样发出     我的 0.000  原版 0.000  重度改写=False
短草稿加客套   我的 0.286  原版 0.286  重度改写=False
专票资料补全   我的 0.522  原版 0.522  重度改写=True
错误码答错    我的 0.872  原版 0.872  重度改写=True
2000 对随机字符串:和原版不一致 0 对;(草稿,发出) 和 (发出,草稿) 结果不同 1166 对
```

和原版没有任何不一致。意外的是第二个数字:**2000 对随机字符串里有 1166 对,调换两个参数以后比例会变。** `SequenceMatcher` 找「最长公共片段」时,两边谁在前面会影响它怎么切,所以 `ratio()` 不对称。

这个问题在真实数据上严重吗?我用小项目的 24 条真实风格的回复各算了一遍两个方向:只有 1 条不同(`r04`,0.753 对 0.778),差 0.025,不会越过 0.5 的门槛。随机字符串是最坏情况(字符表小、重复片段多)。但这个现象值得记住:**用 `SequenceMatcher` 算出的数,只在同一个方向上才能互相比较。** Day 372 的 `edit_ratio` 永远是「草稿在前、发出在后」,这没问题;如果有人以后在别处写成反的,同一对文本会得到略有不同的数字。

## 小项目:一周的回复,走到门禁

三段默写都是单个零件。小项目把它们接起来,只用本周的东西:改写比例(372)、聚类(373)、门禁(375)。数据是我手写的一周 24 条虚构回复,模拟 [Day 372](/blog/agent-zero/day-372-feedback-1/) 的 `fb_simulate` 造出来的那种情况:三个真问题(年付退款政策答反了、错误码 E4031 答错、专票资料不全),加上一些「改写只是加了句客套」和「没人改但被点了踩」的回复。

先看数据。每条是 `(编号, 客户问法, Agent 草稿, 客服发出的, 是否点踩, 真实场景)`:

```python
# agent-zero-lab/part06/week54_data.py
"""第 54 周小项目的虚构数据:一周里 24 条回复。每条 (id, 客户问法, Agent 草稿, 客服发出的版本, 点踩?, 真实场景)。
真实场景只在评估聚类时用,线上没有这一列。"""
from __future__ import annotations

REFUND_OK = "可以退。专业版年付中途取消按剩余整月退款,已用的月数和当月不退,主管审批后原路退回。"
REFUND_BAD = "很抱歉,年付套餐不支持中途退款,取消后可以使用到本期结束。"
E4031_OK = "E4031 表示验证码已过期,请点「重新发送」,并在 5 分钟内输入。"
E4031_BAD = "请清除浏览器缓存后重试。"
VAT_OK = "专票需要公司名称、税号、注册地址和电话、开户行及账号,四项缺一不可。"
VAT_BAD = "请提供公司名称和税号即可。"
POLITE = "如还有问题随时联系我们。"

REPLIES: list[tuple[str, str, str, str, bool, str]] = [
    ("r01", "专业版年付用了 4 个月,剩下的能退吗?", REFUND_BAD, REFUND_OK, True, "refund"),
    ("r02", "年付买早了,现在想取消,钱能退回来不", REFUND_BAD, REFUND_OK, False, "refund"),
    ("r03", "我们年度套餐才用半年,申请退剩下的款", REFUND_BAD, REFUND_OK, True, "refund"),
    ("r04", "annual plan 中途退订有退款吗", REFUND_BAD, REFUND_OK + "金额以系统计算为准。", False, "refund"),
    ("r05", "年付的还剩好几个月,不想用了怎么退", REFUND_BAD, REFUND_OK, False, "refund"),
    ("r06", "错误码 E4031,登不上去", E4031_BAD, E4031_OK, True, "e4031"),
    ("r07", "一登录就弹 E4031 是什么意思", E4031_BAD, E4031_OK, False, "e4031"),
    ("r08", "收不到验证码,页面显示 E4031", E4031_BAD, E4031_OK + "仍收不到请联系客服。", False, "e4031"),
    ("r09", "输入验证码提示 E4031,试了三次都不行", E4031_BAD, E4031_OK, False, "e4031"),
    ("r10", "我们要专票,需要准备哪些信息", VAT_BAD, VAT_OK, False, "vat"),
    ("r11", "开增值税专用发票要填什么", VAT_BAD, VAT_OK, True, "vat"),
    ("r12", "公司要专票报销,资料怎么给你们", VAT_BAD, VAT_OK, False, "vat"),
    ("r13", "企业版年付多少钱?", "企业版年付 1908 元/年。", "企业版年付 1908 元/年。" + POLITE, False, "fine"),
    ("r14", "专业版月付多少钱?", "专业版月付 39 元/月。", "专业版月付 39 元/月。" + POLITE, False, "fine"),
    ("r15", "怎么导出发票 PDF?", "在「发票管理」里选中发票,点右上角「导出 PDF」。", "在「发票管理」里选中发票,点右上角「导出 PDF」。" + POLITE, False, "fine"),
    ("r16", "发票抬头写错了,能重开吗?", "可以重开。请在「发票管理」里点作废,再按新抬头重新申请,一般 1 个工作日内开出。",
     "可以重开。请在「发票管理」里点作废,再按新抬头重新申请,一般 1 个工作日内开出。", False, "fine"),
    ("r17", "怎么改绑手机号?", "在「账号设置」里点「换绑手机」,按提示验证旧手机和新手机。", "在「账号设置」里点「换绑手机」,按提示验证旧手机和新手机。", False, "fine"),
    ("r18", "子账号怎么加?", "在「成员管理」点「邀请成员」,输入邮箱即可。", "在「成员管理」点「邀请成员」,输入邮箱即可。", False, "fine"),
    ("r19", "月付能开发票吗?", "能,每月账单生成后可在「发票管理」申请。", "能,每月账单生成后可在「发票管理」申请。", True, "fine"),
    ("r20", "怎么看本月用量?", "在「用量」页顶部可以切换月份。", "在「用量」页顶部可以切换月份。", True, "fine"),
    ("r21", "试用期多少天?", "试用 14 天。", "试用 14 天。", False, "fine"),
    ("r22", "支持哪些支付方式?", "支持银行卡、支付宝和对公转账。", "支持银行卡、支付宝和对公转账。", False, "fine"),
    ("r23", "怎么导出客户列表?", "在「客户」页右上角点「导出」。", "在「客户」页右上角点「导出」。" + POLITE, False, "fine"),
    ("r24", "忘记密码怎么办?", "点登录页的「忘记密码」,用注册邮箱收重置链接。", "点登录页的「忘记密码」,用注册邮箱收重置链接。", False, "fine"),
]
```

<div class="line-notes">

- `REFUND_OK =` 年付退款的正确说法,和 Day 373 里的政策一致。`REFUND_BAD` 是 Agent 答反了的版本。
- `POLITE =` 一句客套话,加在末尾,模拟「改写只是礼貌」的情况。
- `REPLIES: list[tuple[` 24 条,类型标成六元组。最后一列「真实场景」只在评估聚类时用,线上没有这一列。
- `("r01",` 年付退款的五种问法之一,草稿答反了,客服改成了正确的,客户点了踩。同一个问题 `r02` 到 `r05` 措辞各不同,有的没点踩。
- `("r13",` 草稿是对的,客服只在末尾加了一句客套话:改写比例不低,但不是真问题。
- `("r19",` 草稿一个字没改,但客户点了踩:这是误点。一共有两条这样的(`r19`、`r20`)。

</div>

第一步:算改写比例,把「重度改写,或者被点踩」的挑出来当候选,再聚类。

```python
# agent-zero-lab/part06/week54_project.py
"""第 54 周小项目(上):一周的回复 → 改写比例 → 候选 → 聚类 → 各组留一条代表。只用本周学过的东西。
先 set -a; source .env; set +a 把 EMB_* 读进终端。用法: uv run python -m part06.week54_project"""
from __future__ import annotations

from collections import Counter
from typing import Any

from common.embed import embed, usage
from part06.fb_cluster import cluster, purity
from part06.fb_signals import edit_ratio
from part06.week54_data import REPLIES

HEAVY = 0.5


def candidates() -> list[dict[str, Any]]:
    out = []
    for rid, ticket, draft, sent, thumb_down, truth in REPLIES:
        ratio = edit_ratio(draft, sent)
        if ratio >= HEAVY or thumb_down:
            out.append({"id": rid, "ticket": ticket, "draft": draft, "ratio": ratio,
                        "thumb_down": thumb_down, "truth": truth})
    return out


if __name__ == "__main__":
    cands = candidates()
    print(f"24 条回复,候选 {len(cands)} 条(改写比例 >= {HEAVY} 或被点踩)")
    for c in cands:
        print(f"  {c['id']} 改写 {c['ratio']:.3f} 点踩 {'是' if c['thumb_down'] else '否'}  真实 {c['truth']}")
    vecs = embed([f"客户:{c['ticket']}\n回复:{c['draft']}" for c in cands])
    print(f"embedding 用了 {usage['tokens']} token")
    for th in (0.6, 0.7, 0.8):
        labels = cluster(vecs, th)
        print(f"阈值 {th}: {len(set(labels))} 组, 纯度 {purity(labels, [c['truth'] for c in cands]):.2f}")
    labels = cluster(vecs, 0.7)
    for lab, n in sorted(Counter(labels).items(), key=lambda kv: -kv[1]):
        members = [c for c, x in zip(cands, labels) if x == lab]
        print(f"组 {lab}: {n} 条 {dict(Counter(m['truth'] for m in members))} 代表: {members[0]['ticket']}")
```

<div class="line-notes">

- `HEAVY = 0.5` 沿用 Day 372 的门槛。
- `def candidates()` 返回候选列表,每条带着改写比例、点踩、真实场景。
- `ratio = edit_ratio(draft, sent)` 用的是 Day 372 的 `edit_ratio`,不是我今天默写的那个。
- `if ratio >= HEAVY or thumb_down:` 两个信号任一个就进候选:重度改写,或者被点踩。这是 Day 373 的「可疑度」最简版。
- `vecs = embed([` 客户问法加 Agent 草稿拼在一起,变成向量。和 Day 373 的 `text_of` 一样。
- `for th in (0.6, 0.7, 0.8):` 试三个阈值。
- `labels = cluster(vecs, 0.7)` 按 Day 373 选的 0.7 打印每一组。

</div>

```bash
set -a; source .env; set +a
uv run python -m part06.week54_project
```

```text
24 条回复,候选 14 条(改写比例 >= 0.5 或被点踩)
  r01 改写 0.746 点踩 是  真实 refund
  r02 改写 0.746 点踩 否  真实 refund
  r03 改写 0.746 点踩 是  真实 refund
  r04 改写 0.753 点踩 否  真实 refund
  r05 改写 0.746 点踩 否  真实 refund
  r06 改写 0.872 点踩 是  真实 e4031
  r07 改写 0.872 点踩 否  真实 e4031
  r08 改写 0.895 点踩 否  真实 e4031
  r09 改写 0.872 点踩 否  真实 e4031
  r10 改写 0.660 点踩 否  真实 vat
  r11 改写 0.660 点踩 是  真实 vat
  r12 改写 0.660 点踩 否  真实 vat
  r19 改写 0.000 点踩 是  真实 fine
  r20 改写 0.000 点踩 是  真实 fine
embedding 用了 456 token
阈值 0.6: 4 组, 纯度 0.93
阈值 0.7: 4 组, 纯度 0.93
阈值 0.8: 5 组, 纯度 1.00
组 0: 5 条 {'refund': 5} 代表: 专业版年付用了 4 个月,剩下的能退吗?
组 1: 4 条 {'e4031': 4} 代表: 错误码 E4031,登不上去
组 2: 4 条 {'vat': 3, 'fine': 1} 代表: 我们要专票,需要准备哪些信息
组 3: 1 条 {'fine': 1} 代表: 怎么看本月用量?
```

24 条里挑出 14 条候选:12 条真问题(改写 0.66 以上)加 2 条误点(改写 0.000,但被点踩)。注意专票那三条的改写比例只有 0.660,比另外两类低,草稿「请提供公司名称和税号即可」和正确答案「四项缺一不可」的字数差别不大,但意思差很远。这就是为什么 Day 372 强调要在自己的数据上画分布,不能照抄 0.5。

**第一个只有走完全程才会碰到的问题:Day 373 选的阈值 0.7,在今天这份数据上不够好。** 看 0.7 那一行:4 组,纯度 0.93,组 2 里是 `{'vat': 3, 'fine': 1}`,也就是那条误点的「月付能开发票吗?」(`r19`)被并进了专票那一组,因为「开发票」「专票」在向量里很近。阈值提到 0.8,5 组,纯度 1.00,误点自己成了一组。Day 373 的数据里 0.7 到 0.8 都能用,今天这份数据里只有 0.8 行,同一个 0.7 在不同数据上结果不同,和 Day 373 里写的「阈值要在自己的数据上抽几组看」是同一回事。下面都用 0.8。

第二步:每组留一条代表变成用例,再用 Day 375 的门禁看它们进入基线前后会怎样。评测结果是手工造的,不调模型(`fake_eval`:每条用例两次,按给定的通过率决定几次通过)。

```python
# agent-zero-lab/part06/week54_gate.py
"""第 54 周小项目(下):各组留一条代表变成用例,再用 Day 375 的门禁看它们进基线前后的区别。
评测结果是手工造的 dict(不调模型),只演示门禁怎么判。
用法: uv run python -m part06.week54_gate"""
from __future__ import annotations

from collections import Counter
from typing import Any

from common.embed import embed
from part06.fb_cluster import cluster
from part06.gate import gate
from part06.week54_project import HEAVY, candidates

OLD_RATES = {f"c{i:02d}": 1.0 for i in range(1, 11)} | {"c11": 0.5, "c12": 0.0}   # 12 条老用例:10 条稳,1 条抖,1 条一直挂
RUNS = 2


def promote(cands: list[dict[str, Any]], labels: list[int]) -> list[dict[str, Any]]:
    """每组留一条代表。至少有一条真被客服重度改写的组才收;只有点踩、没人改的组(误点)不收。"""
    cases = []
    for lab, n in sorted(Counter(labels).items()):
        members = [c for c, x in zip(cands, labels) if x == lab]
        if not any(m["ratio"] >= HEAVY for m in members):
            print(f"  组 {lab}({n} 条,{members[0]['ticket']}):没有人改过,只有点踩,不收")
            continue
        cases.append({"id": f"fb-{members[0]['id']}", "ticket": members[0]["ticket"], "group_size": n,
                      "source": "feedback"})
    return cases


def fake_eval(rates: dict[str, float], fail_key: dict[str, str] | None = None) -> tuple[dict, list[dict]]:
    """造一份评测结果:每条用例跑 RUNS 次,按 rates 决定几次通过。fail_key 指出某条用例失败时挂的检查名。"""
    fail_key = fail_key or {}
    rows = []
    for case, rate in rates.items():
        passed = round(rate * RUNS)
        for i in range(RUNS):
            ok = i < passed
            rows.append({"case": case, "pass": ok, "failed": {} if ok else {fail_key.get(case, "judge:facts"): "x"}})
    single = sum(r["pass"] for r in rows) / len(rows)
    return {"case_rate": rates, "single_pass": round(single, 3)}, rows


def show(title: str, summary: dict, rows: list[dict], baseline: dict | None) -> dict:
    v = gate(summary, rows, baseline)
    print(f"{title}: {'放行' if v['ok'] else '拦截'}  单次通过率 {summary['single_pass']:.1%}")
    for r in v["reasons"]:
        print("   -", r)
    print("   新挂:", v["newly_failed"] or "无", " 新修好:", v["newly_passed"] or "无")
    return v


if __name__ == "__main__":
    cands = candidates()
    labels = cluster(embed([f"客户:{c['ticket']}\n回复:{c['draft']}" for c in cands]), 0.8)
    print("聚类阈值 0.8,逐组决定:")
    cases = promote(cands, labels)
    ids = [c["id"] for c in cases]
    print("新用例:", ids)

    s0, r0 = fake_eval(OLD_RATES)
    base0 = {"case_rate": OLD_RATES, "single_pass": s0["single_pass"]}
    print(f"\n老基线:12 条用例,单次通过率 {base0['single_pass']:.1%}")

    broken = OLD_RATES | {i: 0.0 for i in ids}
    s1, r1 = fake_eval(broken, {"fb-r01": "outcome"})
    show("S1 新用例刚进来、Agent 还没修", s1, r1, base0)

    fixed = OLD_RATES | {i: 1.0 for i in ids}
    s2, r2 = fake_eval(fixed)
    show("S2 补完知识库以后", s2, r2, base0)
    base1 = {"case_rate": fixed, "single_pass": s2["single_pass"]}
    print(f"  → 在 main 上更新基线:{len(fixed)} 条用例,单次通过率 {base1['single_pass']:.1%}")

    two = fixed | {"fb-r01": 0.0, "fb-r06": 0.0}
    s3, r3 = fake_eval(two, {"fb-r01": "outcome"})
    show("S3 某个 PR 同时弄坏退款和 E4031", s3, r3, base1)

    one = fixed | {"fb-r06": 0.0}
    s4, r4 = fake_eval(one)
    show("S4 某个 PR 只弄坏 E4031", s4, r4, base1)
```

<div class="line-notes">

- `OLD_RATES = {` 12 条老用例:10 条每次都过,`c11` 通过率 0.5,`c12` 一直挂。基线里有稳的、抖的、一直挂的,才能测门禁对三种用例的反应。
- `RUNS = 2` 每条用例跑两次。
- `def promote(` 每组留一条代表,变成一条用例。
- `if not any(m["ratio"] >= HEAVY for m in members):` 一组里**至少有一条真被客服重度改写过**才收。只有点踩、没有人改的组(比如误点)不收。这是 Day 373 说的「人审」的一个机器可以代劳的子集,最后拍板仍然是人。
- `cases.append({"id": f"fb-{members[0]['id']}"` 用例编号取代表那条回复的编号,`fb-` 前缀表示来自线上反馈。
- `def fake_eval(` 造一份评测结果,格式和 Day 374 `eval_run` 的汇总一致:`case_rate`、`single_pass`,以及逐次的 `rows`。
- `passed = round(rate * RUNS)` 通过率乘以次数,四舍五入得到通过几次。
- `ok = i < passed` 前 `passed` 次算通过,后面的算失败,失败时挂在 `fail_key` 指定的检查名上(默认是 `judge:facts`)。
- `def show(` 调门禁,打印放行还是拦截、理由、新挂和新修好。
- `labels = cluster(embed(` 候选聚类,阈值 0.8。
- `broken = OLD_RATES | {i: 0.0 for i in ids}` 场景 1:三条新用例加进来,但 Agent 还没修,三条都是 0。`{...} | {...}` 合并两个字典,相当于 JS 的 `{...a, ...b}`。
- `fixed = OLD_RATES | {i: 1.0 for i in ids}` 场景 2:补完知识库以后,三条都过。
- `two = fixed |` 场景 3:某个 PR 同时弄坏退款和 E4031。
- `one = fixed |` 场景 4:某个 PR 只弄坏 E4031。

</div>

```bash
uv run python -m part06.week54_gate
```

```text
聚类阈值 0.8,逐组决定:
  组 3(1 条,月付能开发票吗?):没有人改过,只有点踩,不收
  组 4(1 条,怎么看本月用量?):没有人改过,只有点踩,不收
新用例: ['fb-r01', 'fb-r06', 'fb-r10']

老基线:12 条用例,单次通过率 87.5%
S1 新用例刚进来、Agent 还没修: 拦截  单次通过率 70.0%
   - 单次通过率 70.0% 比基线 87.5% 低了超过 10%
   新挂: 无  新修好: 无
S2 补完知识库以后: 放行  单次通过率 90.0%
   新挂: 无  新修好: 无
  → 在 main 上更新基线:15 条用例,单次通过率 90.0%
S3 某个 PR 同时弄坏退款和 E4031: 拦截  单次通过率 76.7%
   - 原本稳的用例退款出错 1 处: fb-r01/outcome
   - 2 条原来每次都过的用例现在一次也没过(允许 1 条): fb-r01, fb-r06
   - 单次通过率 76.7% 比基线 90.0% 低了超过 10%
   新挂: ['fb-r01', 'fb-r06']  新修好: 无
S4 某个 PR 只弄坏 E4031: 放行  单次通过率 83.3%
   新挂: ['fb-r06']  新修好: 无
```

三个用例(退款、E4031、专票)进来,两条误点没有收。四个场景:

**S1 是第二个只有走完全程才会碰到的问题。** 用例刚加进来,Agent 还没有修,新用例当然是挂的。门禁的第一道规则「新挂」不会拦它们(它们不在基线里,不算退步);但总分兜底会:单次通过率从 87.5% 掉到 70.0%,掉了 17.5 个点,超过 10,**拦住了「加用例」这件事本身**。这很荒谬:你只是把一个线上发现的问题写成了用例,门禁就红了。实际的做法有两个:把用例和修复放进同一个 PR(S2),或者让门禁区分「新用例」和「老用例」,总分只比较老用例。练习 3 就是写第二种。

**S2** 补完知识库,三条新用例都过了,总分 90.0%,放行,在 main 上更新基线,这时基线里有 15 条用例。

**S3** 某个 PR 同时弄坏了退款(`fb-r01`)和 E4031(`fb-r06`)。这两条现在是基线里「原本稳」的用例,所以门禁出了三条理由:退款出错(因为 `fb-r01/outcome` 是钱的检查,稳的用例上出错就拦)、两条稳的用例同时挂(超过允许的 1 条)、总分掉了 13.3 个点。线上反馈变成用例,现在在拦坏改动。这就是圈闭合的价值。

**S4** 只弄坏了 E4031 一条,门禁**放行**了,理由是允许一条稳的用例抖一下(用例不到 40 条时,`max(1, ...)` 保底允许一条)。`新挂: ['fb-r06']` 会写在评论里提醒你,但它不会拦。这是 Day 375 讲过的取舍:一条一条拦,会天天误报;要拦住一条,就要把它归进越权那一类零容忍的检查里。E4031 答错只是答案不对,不属于零容忍。

## 本周错题与坑清单

这六天踩过的坑,按「会在什么时候发现」排,而不是按天数:

| 坑 | 症状 | 怎么办 |
| --- | --- | --- |
| 手册淘汰逻辑没排除刚加的那条(371) | 日志里总是「淘汰最新那条」,手册学不到新东西,不报错 | `book[:-1]`;日志要读,不要只看有没有异常 |
| 手册只增不减(371) | prompt 越来越长 | `curate` 设上限,`prune` 清理害多帮少的 |
| 把帮/害计数当因果(371) | 一条错例引用三条规则,三条都挨一次害 | 计数只是线索,真因果要逐条判断或长期累计 |
| 只存最终发出的版本(372) | 算不出改写比例,事后补不回来 | 草稿和最终版本分开存 |
| 阈值照抄别人的(372、373) | 同一句客套话在短草稿后是 0.286,在长草稿后是 0.128;0.7 的聚类阈值在另一份数据上把误点并进了真问题 | 在自己的数据上画分布、抽样看 |
| 信号沉默就当没问题(372) | 客服忙的时候不改不点,所有信号都是 0 | 每周随机抽一批没有负面信号的回复人工看 |
| 让模型决定什么进测试集(373) | 起草的文章多加了一句话;E4031 的含义靠猜 | 模型只能起草和猜原因,「算不算错」「正确答案」由人定 |
| 线上原文不脱敏入库(373) | 手机号、邮箱进了 git 和 CI 日志 | 入库前脱敏,脱敏函数要有「不该误伤」的测试 |
| 评分器的「判不了」被跳过(374) | 答非所问的回复拿满分 | 凡是「跳过」「忽略」的分支,都问一句会不会让坏结果消失 |
| 门禁只看总分(375) | 随机波动被当成改进或退步 | 越权零容忍、新挂看基线、总分兜底 |
| 门禁自己没有测试(375) | 比较方向写反,CI 永远是绿的 | 11 个测试 + 变异测试 |
| 新用例刚加进来就被总分兜底拦住(377 小项目) | 加一条线上发现的用例,门禁变红 | 用例和修复同一个 PR;或总分只比较老用例 |
| 随机对拍抓不到边界错误(377) | `<` 写成 `<=` 在 3000 组里只被抓到 4 组 | 对每个阈值写一条贴着边界的手写用例 |
| 用 `SequenceMatcher` 却不固定方向(377) | 同一对文本调换顺序,比例略有不同 | 永远是「草稿在前、发出在后」 |
| 4.7% 当成精确值(376) | 以为门禁不会误报 | 说「大约每 20 个无害 PR 误拦 1 个」 |

## 动手练习

练习一:写一条贴着边界的手写用例,抓住对拍几乎抓不到的 `<` 改 `<=` 的变异。

<details><summary>参考答案</summary>

```python
```python
# agent-zero-lab/part06/ex377_boundary.py
"""练习 1:随机对拍几乎抓不到的边界变异,用一个手写边界用例抓住。不调模型。
用法: uv run python -m part06.ex377_boundary"""
from __future__ import annotations

from part06.drill_gate import MUTANTS, Gate, fuzz, make_mutant, my_gate
from part06.gate import gate as original


def boundary_ok(fn: Gate) -> bool:
    """基线 90%,这次刚好 80%:掉了整整 10 个百分点,规则写的是「超过 10 个点才拦」,所以应该放行。"""
    base = {"case_rate": {"a": 1.0}, "single_pass": 0.9}
    summ = {"case_rate": {"a": 1.0}, "single_pass": 0.8}
    return fn(summ, [], base)["ok"] is True


if __name__ == "__main__":
    old, new = MUTANTS["总分比较 < 改成 <="]
    mutant = make_mutant(old, new)
    print("原版边界用例:", boundary_ok(original))
    print("我的版本边界用例:", boundary_ok(my_gate))
    print("变异版本边界用例:", boundary_ok(mutant), "(False 就是抓住了)")
    print("随机对拍抓到它:", len(fuzz(mutant)), "/ 3000 组")
```
```

<div class="line-notes">

- `def boundary_ok(` 一个用例:返回 `True` 表示这个门禁函数在边界上行为正确。
- `base = {"case_rate": {"a": 1.0}, "single_pass": 0.9}` 基线 90%,只有一条用例,每次都过。
- `return fn(summ, [], base)["ok"] is True` 这次是 80%,掉了正好 10 个点。规则是「超过 10 个点才拦」,所以应该放行。`0.9 - 0.10` 在浮点数里恰好等于 `0.8`(不是每对数都这么巧,这条用例是挑过的),所以 `0.8 < 0.8` 是 `False`,`0.8 <= 0.8` 是 `True`。
- `old, new = MUTANTS[` 取出今天默写一里那个「小于改成小于等于」的变异。
- `print("随机对拍抓到它:"` 把随机对拍的结果放在旁边对比。

</div>

```bash
uv run python -m part06.ex377_boundary
```

```text
原版边界用例: True
我的版本边界用例: True
变异版本边界用例: False (False 就是抓住了)
随机对拍抓到它: 4 / 3000 组
```

一条手写用例抓住了 3000 组随机输入只抓到 4 次的错。**随机对拍擅长抓「大面积」的错,手写边界用例擅长抓「一条线上」的错,两个要一起用。** 写边界用例的习惯:阈值是多少,就造一组「刚好等于」「比它小一点」「比它大一点」,三组。

</details>

练习二(观察):小项目里每组用 `members[0]`(第一条)当代表。把候选倒过来喂,阈值 0.7,分别看「选第一条」和「选改写最重的一条」选出来的代表。

<details><summary>参考答案</summary>

```python
```python
# agent-zero-lab/part06/ex377_rep.py
"""练习 2:代表用例该选组里的第一条,还是改写最重的一条?把候选倒过来喂,看聚类和代表怎么变。
用法: uv run python -m part06.ex377_rep"""
from __future__ import annotations

from collections import Counter

from common.embed import embed
from part06.fb_cluster import cluster
from part06.week54_project import candidates


def reps(cands: list[dict], th: float, pick: str) -> list[str]:
    labels = cluster(embed([f"客户:{c['ticket']}\n回复:{c['draft']}" for c in cands]), th)
    out = []
    for lab in sorted(Counter(labels)):
        members = [c for c, x in zip(cands, labels) if x == lab]
        best = members[0] if pick == "first" else max(members, key=lambda m: m["ratio"])
        out.append(f"{best['id']}(改写 {best['ratio']:.2f},组内 {len(members)} 条)")
    return out


if __name__ == "__main__":
    cands = candidates()
    for name, order in (("原顺序", cands), ("倒过来", cands[::-1])):
        for pick in ("first", "heaviest"):
            print(f"{name} 阈值 0.7 选{pick:<9}:", "; ".join(reps(order, 0.7, pick)))
```
```

<div class="line-notes">

- `def reps(` 按阈值聚类,每组按两种办法选代表,返回描述。
- `best = members[0] if pick == "first"` 选第一条,和小项目一样;否则选改写比例最大的一条(`max(..., key=...)`)。
- `for name, order in` 两种顺序(原顺序和倒过来)乘两种选法,共四行输出。

</div>

```bash
set -a; source .env; set +a
uv run python -m part06.ex377_rep
```

```text
原顺序 阈值 0.7 选first    : r01(改写 0.75,组内 5 条); r06(改写 0.87,组内 4 条); r10(改写 0.66,组内 4 条); r20(改写 0.00,组内 1 条)
原顺序 阈值 0.7 选heaviest : r04(改写 0.75,组内 5 条); r08(改写 0.90,组内 4 条); r10(改写 0.66,组内 4 条); r20(改写 0.00,组内 1 条)
倒过来 阈值 0.7 选first    : r20(改写 0.00,组内 1 条); r19(改写 0.00,组内 4 条); r09(改写 0.87,组内 4 条); r05(改写 0.75,组内 5 条)
倒过来 阈值 0.7 选heaviest : r20(改写 0.00,组内 1 条); r12(改写 0.66,组内 4 条); r08(改写 0.90,组内 4 条); r04(改写 0.75,组内 5 条)
```

关键在第三行:候选倒过来以后,0.7 的贪心聚类里,误点的 `r19`(改写 0.00)排在专票组的最前面,「选第一条」选出来的代表就是它,一条根本没人改的回复,被拿去当专票用例的样本。「选改写最重」(第四行)选了 `r12`,是一条真的专票问题。同时看出两件事:聚类结果和顺序有关(正如 Day 373 说过的);代表的选法值得多想一步,第一条是随机的,改写最重的更可能是真问题。这个办法没有解决 0.7 把误点并进专票组的问题,它只是让代表更可靠,阈值还是要调到 0.8。

</details>

练习三(开放题):让门禁区分「新用例」和「老用例」,总分只比较老用例,新用例仍然检查越权。用小项目的 S1 验证。

<details><summary>参考答案</summary>

```python
```python
# agent-zero-lab/part06/ex377_known.py
"""练习 3:新加的用例还在挂着,总分兜底会拦住「加用例」本身。让门禁把新用例排除在总分之外。不调模型。
用法: uv run python -m part06.ex377_known"""
from __future__ import annotations

from part06.gate import gate
from part06.week54_gate import OLD_RATES, fake_eval


def gate_with_new(summary: dict, rows: list[dict], baseline: dict | None, new_cases: set[str]) -> dict:
    """基线里没有的用例叫「新用例」。它们照样检查越权,但不参与单次通过率的比较。"""
    old_rows = [r for r in rows if r["case"] not in new_cases]
    single = sum(r["pass"] for r in old_rows) / len(old_rows)
    return gate({**summary, "single_pass": round(single, 3)}, rows, baseline)


if __name__ == "__main__":
    s0, _ = fake_eval(OLD_RATES)
    base = {"case_rate": OLD_RATES, "single_pass": s0["single_pass"]}
    new = {"fb-r01", "fb-r06", "fb-r10"}
    s1, r1 = fake_eval(OLD_RATES | {c: 0.0 for c in new})
    print("原门禁:", gate(s1, r1, base)["ok"], gate(s1, r1, base)["reasons"])
    v = gate_with_new(s1, r1, base, new)
    print("排除新用例后:", v["ok"], v["reasons"])
    s2, r2 = fake_eval(OLD_RATES | {c: 0.0 for c in new} | {"c03": 0.0, "c04": 0.0, "c05": 0.0})
    v2 = gate_with_new(s2, r2, base, new)
    print("同时弄坏 3 条老用例:", v2["ok"], v2["reasons"])
```
```

<div class="line-notes">

- `def gate_with_new(` 在 Day 375 的 `gate` 外面包一层,不改原函数。多一个参数:哪些是新用例。
- `old_rows = [r for r in rows if r["case"] not in new_cases]` 去掉新用例的行,只留老用例的逐次结果。
- `single = sum(r["pass"] for r in old_rows) / len(old_rows)` 重新算单次通过率,只算老用例。代入 S1:老用例 12 条 × 2 次 = 24 行,通过 21 行,87.5%。
- `return gate({**summary, "single_pass": round(single, 3)}, rows, baseline)` 把重新算的总分塞进汇总里,再调用原来的 `gate`。**`rows` 仍然是完整的**,所以越权和崩溃的检查照样覆盖新用例。
- `new = {"fb-r01"` 三条新用例。
- `s2, r2 = fake_eval(` 第三个演示:新用例还在挂,同时弄坏 3 条老用例,看门禁还拦不拦。

</div>

```bash
uv run python -m part06.ex377_known
```

```text
原门禁: False ['单次通过率 70.0% 比基线 87.5% 低了超过 10%']
排除新用例后: True []
同时弄坏 3 条老用例: False ['3 条原来每次都过的用例现在一次也没过(允许 1 条): c03, c04, c05', '单次通过率 62.5% 比基线 87.5% 低了超过 10%']
```

原来的门禁因为新用例拦了 PR;排除新用例以后放行;同时弄坏三条老用例,门禁还是拦,理由是新挂超过允许数和总分掉了 25 个点。注意这个做法有一个小代价:新用例在被收进基线之前,它们的退步没有人管。所以流程上要有「新用例一旦过了,就更新基线把它收进去」这一步(S2 的最后一行)。

</details>

验收标准:不看文章,能默写 `gate` 并在 3000 组随机输入上和原版 0 组不一致;能默写 `curate` 并说出去掉 `[:-1]` 的后果;能说出本周圈里每一步的输入输出;能解释小项目里两个坑(阈值 0.7 把误点并进了专票组,新用例让总分兜底拦住了加用例本身)。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 对拍 | 同一批输入同时喂给两份实现(你写的和一份已知正确的),比较输出。不用事先想好期望值 |
| 边界用例 | 专门瞄准阈值的用例:刚好等于、比它小一点、比它大一点。随机输入很难碰到 |
| 变异测试 | 故意把代码改坏一处,看测试能不能发现(Day 375 学的)。今天用字符串替换自动造变异 |
| 新用例 | 基线里没有的用例。刚进来时没有历史,不能判断它「退步」 |
| 基线 | 一次被接受的评测结果(Day 375),只在 main 上更新 |
| 代表用例 | 一组相似的问题里挑出来写成测试用例的那一条 |
| 浮点数相等 | 小数在计算机里是近似存的,`0.9 - 0.1` 恰好等于 `0.8` 只是碰巧。比较阈值时要意识到这一点 |

## 常见误区

**以为通过了对拍就等于正确。** 对拍只能说明你的版本和「原版」一致,原版自己有错就一起错。而且随机输入对阈值边界无能为力,实测「小于改成小于等于」3000 组只抓到 4 组。

**把对拍的随机输入造得太散。** 如果总分在 0.5 到 1.0 之间均匀分布,「恰好等于基线减 10 个点」几乎不会发生。要抓边界,让一部分输入专门落在边界上。

**聚类阈值在一份数据上调好就当通用。** 同一个 0.7,Day 373 的数据上纯度 1.00,今天这份数据上是 0.93。

**新用例直接和老基线比总分。** 用例加进来还没修,总分一定掉,门禁会拦「加用例」这件事。要么和修复同一个 PR,要么总分只比较老用例。

**门禁放行就以为没有问题。** S4 里 E4031 的用例挂了,门禁放行,只是在评论里留了一行「新挂」。没人看评论,这条退步就这么合进去了。

**把误点点踩的回复也写成用例。** 一条没有人改过的回复被点了踩,多半是误点。用例至少要有一条真被改写过的回复作证据。

## 学习资料

### 文档与文章

- [Python 文档:difflib](https://docs.python.org/zh-cn/3/library/difflib.html)。`SequenceMatcher` 的说明,里面提醒了 `ratio()` 的结果可能取决于两个参数的顺序,和今天默写三的发现一致。
- [pytest 文档:参数化](https://docs.pytest.org/en/stable/how-to/parametrize.html)。今天练习和上周的测试都用了 `parametrize`,读一遍把「一个测试函数多组数据」的写法记牢。
- [Hypothesis 文档](https://hypothesis.readthedocs.io/en/latest/)。Python 里成熟的「随机输入测试」库,会自动缩小失败的输入。今天自己写的对拍是它最简单的形式。
- [GitHub Actions 文档](https://docs.github.com/zh/actions)。Day 375 的 workflow 是照着这里的语法写的。
- [ACE 论文:Agentic Context Engineering](https://arxiv.org/abs/2510.04618)。Day 371 的来源。论文报告的提升是在智能体基准上量的,和我们的分类任务不是一回事。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Qp4y137wF&autoplay=0&high_quality=1" title="突变测试——Mutation Testing" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>无人可超 · 突变测试——Mutation Testing · 6 分半,讲「故意改坏代码、看测试抓不抓得住」,对应 Day 375 的变异测试和今天默写一的五个变异。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1aT421y7Ar&autoplay=0&high_quality=1" title="GitHub Actions工作流自动化的入门核心" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>技术蛋老师 · GitHub Actions工作流自动化的入门核心 · 16 分钟,回顾 Day 375 的 workflow 文件里每一块是什么。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/TLB5MY9BBa4" title="GitHub Actions Tutorial | From Zero to Hero in 90 minutes" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>CoderDave · GitHub Actions Tutorial | From Zero to Hero in 90 minutes (Environments, Secrets, Runners, etc) · 英文,90 分钟,只看 Secrets 和 Runners 两部分,对应 Day 375 里「fork 来的 PR 拿不到 secrets」。</figcaption>
</figure>

### 书籍

- Titus Winters、Tom Manshreck、Hyrum Wright 编,《Software Engineering at Google》(O'Reilly,2020)。其中讲测试规模、测试的「大中小」划分、持续集成的几章,和这一周的门禁一脉相承:好的门禁要快、要稳、不能天天误报。英文原版;我没有确认有无中译本。

### 开源项目与代码

- [HypothesisWorks/hypothesis](https://github.com/HypothesisWorks/hypothesis):随机输入测试的库,源码里的「缩小(shrinking)」值得读一读。
- [boxed/mutmut](https://github.com/boxed/mutmut):Python 里最常用的变异测试工具之一,今天是用字符串替换手工造变异,它是自动的。我没有在本机跑过它。
- [ace-agent/ace](https://github.com/ace-agent/ace):ACE 论文的官方仓库,按我之前核实的信息是 Apache-2.0。我没有在本机跑过它,Day 371 的版本是自己写的最小版。
- [stanfordnlp/dspy](https://github.com/stanfordnlp/dspy):Day 368–369 用过的框架。

## 自测

1. 今天默写一里,「小于改成小于等于」为什么随机对拍抓不到?怎么办?

<details><summary>答案</summary>

`<` 和 `<=` 只在总分恰好等于阈值时才有区别。随机造的总分(三位小数,均匀分布)几乎不会恰好等于「基线减 10 个点」,3000 组只碰到 4 次。办法是为每个阈值写一条手写的边界用例:刚好等于、比它小一点、比它大一点。

</details>

2. 手册满了要淘汰一条,为什么淘汰候选里要排除刚加进来的那条?

<details><summary>答案</summary>

新规则刚进来时帮/害计数都是 0,净分比别的都低(别的至少帮过几次),不排除就会第一个被淘汰,手册学不到新东西。更隐蔽的是这个错不报异常,日志里只会反复出现「淘汰最新那条」。

</details>

3. 聚类阈值 0.7 在 Day 373 的数据上纯度 1.00,在今天的数据上是 0.93。为什么?

<details><summary>答案</summary>

0.7 本身没有普遍意义,取决于数据。今天的数据里,误点的「月付能开发票吗?」和专票那几条在向量里很近(都是「发票」),0.7 把它并进了专票组;提到 0.8 才分开。阈值要在自己的数据上抽几组打开看,看同一组里是不是同一件事。

</details>

4. 你给门禁新加了三条线上发现的用例,CI 变红,原因是什么?两种解决办法?

<details><summary>答案</summary>

新用例在 Agent 还没修的时候是挂的,拉低了单次通过率,总分兜底拦住了。第一种办法:用例和修复放进同一个 PR,PR 合并时新用例已经过了。第二种:让门禁区分新用例和老用例,总分只比较老用例,新用例照样检查越权。后者要配一个流程,新用例过了以后更新基线把它收进去。

</details>

5. (面试题)你们的评测门禁上线后,有同事抱怨「我的 PR 明明没改 Agent,也被拦了」。你怎么排查?

<details><summary>答案</summary>

先查是不是随机波动:对同一个 commit 重跑几次,看拦不拦;或者用 Day 376 的离线重判,拿存下来的运行记录重新判一遍。再看拦截理由是哪一条:总分兜底最容易误报,「新挂」的定义太粗也会(只改措辞的 PR 被拦过)。治法是读失败原因,改规则(比如「新挂」只算原来每次都过、现在一次也没过的用例),不是把阈值调松。最后用模拟估计误报率,告诉团队「大约每 20 个无害 PR 会拦 1 个」,而不是假装是 0。

</details>

6. (面试题)线上反馈怎么变成测试用例?哪一步不能交给模型?

<details><summary>答案</summary>

信号(改写比例、点踩、转人工)筛出可疑回复,聚类合并相似问题,人审以后写成用例(脱敏、带护栏),知识缺失的另外起草文章补知识库。不能交给模型的是「这条回复算不算错」和「正确答案是什么」,这两件只能由人定;模型可以帮忙猜原因、起草文章,但起草的文章也要人批准才能入库。

</details>

## 明天预告

[Day 378](/blog/agent-zero/day-378-agent-api/) · 把 Agent 做成服务:Agent 接口和普通接口差在哪。第六部分到今天结束了:评测和可观测让你知道 Agent 有没有变好。从明天起进入第七部分,生产化与安全:先把一直活在终端里的工单 Agent 放到一个 HTTP 接口后面,量一量它和普通接口到底差在哪,为什么阻塞的接口会在线上出事,以及为什么要走流式。
