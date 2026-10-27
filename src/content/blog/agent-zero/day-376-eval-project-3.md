---
title: 'Day 376 · 小项目(三):面试题和坑清单'
description: '收尾:把评测小项目讲成一个带真实数字的故事,答十道面试题,列出这六天踩过的坑。再做两个不花钱的离线实验:用存下来的运行记录重判分数,和模拟一份门禁在代码没改时会误报多少次(第一版规则 12.5%,改完 4.7%)。'
pubDate: 2026-10-27
regime: none
tags: ['eval', 'interview', 'simulation', 'retrospective', 'agent-zero']
series: 'agent-zero'
day: 376
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 375](/blog/agent-zero/day-375-eval-project-2/) 给评测接上了门禁:越权零容忍、基线里稳的用例不能退步、总分兜底;在本机模拟了三个 PR,精简 prompt 的被拦住,只改措辞的被误拦,查出原因后改了「新挂」的定义。结尾说这条改动「是看到误报以后才改的」,验证它的那份数据也是同一份,不够独立。

今天不再调模型,做三件事:用存下来的运行记录做两个模拟实验,把门禁的误报率估出来;把这个小项目整理成能在面试里讲的故事;把这六天踩的坑列成清单。

## 今天要解决的问题

学完今天你应该能:

1. 不重新调用 Agent,用 `rows.jsonl` 里存的运行记录,把改过的检查函数重新跑一遍(离线重判)。
2. 用一份模拟估计「代码一行没改,门禁平均误报多少次」,并知道它受哪两个因素影响。
3. 把这个评测小项目讲成一段带真实数字、不吹牛的项目描述。
4. 答出十道评测和 CI 相关的面试题,每道题里至少用上一个自己项目里的数字。

今天两个新概念:**离线重判**(用存下来的运行记录重新判分,不调模型)和**误报率模拟**(用已知的通过率反复模拟「没改代码的 PR」,数门禁拦了几次)。

预计用时 2.5 小时。今天**一分钱 API 费都不花**,所有脚本读的是 Day 374、375 存下来的 `part06/reports/` 目录。前置:Day 374、375 的全部文件,尤其是 `part06/reports/` 下的这几份:`baseline-run`、`main-baseline`、`prod2-nokb`、`pr-trim`、`pr-reword`(是 Day 375 把两个 PR 报告目录改了名存的)和 `part06/baseline.json`。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章,把 `judge()` 和 `run_cases()` 默写出来;面试题先自己口头答,再看要点;做练习时先自己写,做不出再展开参考答案,看完关掉重写一遍。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="门禁误报率:代码没改时,第一版规则在两种世界里误报 12.5% 和 57.3%,改后规则误报 4.7% 和 13.7%">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink)">代码一行没改的 PR,门禁误报了多少(2000 次模拟)</text>
<line x1="140" y1="50" x2="140" y2="220" stroke="var(--rule)"/>
<text x="14" y="86" fill="var(--ink-soft)">世界 A</text>
<text x="14" y="104" fill="var(--ink-faint)" font-size="11">按测到的</text>
<rect x="140" y="62" width="75" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="224" y="78" fill="var(--ink)">第一版 12.5%</text>
<rect x="140" y="90" width="28" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="177" y="106" fill="var(--ink)">现在 4.7%</text>
<text x="14" y="176" fill="var(--ink-soft)">世界 B</text>
<text x="14" y="194" fill="var(--ink-faint)" font-size="11">用例更不稳</text>
<rect x="140" y="150" width="344" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="492" y="166" fill="var(--ink)">第一版 57.3%</text>
<rect x="140" y="178" width="82" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="231" y="194" fill="var(--ink)">现在 13.7%</text>
<text x="140" y="238" fill="var(--ink-faint)" font-size="11">条的长度 = 误报比例;每个世界里用例的真实通过率是模拟前设定的</text>
</g>
</svg>
<figcaption>琥珀色是第一版「新挂」规则,蓝色是改过的规则。改规则同时把误报砍掉大半,但用例本身越不稳,误报越多。</figcaption>
</figure>

## 第一步:离线重判

回忆昨天 `eval_run.py` 里的一个细节:每一行逐次结果,除了 `pass` 和 `failed`,还存了 `"run": run`,也就是这一次运行的完整记录(工具调用、库里的退款、回复)。当时的理由是「以后改了检查函数,可以不重新调模型」。今天兑现。

先想一个场景。你改了 `eval_checks.py`,或者想知道「没有评分器这一层,分数会是什么样」。重新跑一遍评测要钱要时间,而且 Agent 有随机性,重跑得到的是**另一批**运行,没法回答「同一批运行换个判法会怎样」。离线重判就是把存下来的运行记录重新喂给检查函数:

```python
# agent-zero-lab/part06/ex376_regrade.py
"""Day 376 练习 1:不重跑 Agent,只用存下来的运行记录重新判分。
rows.jsonl 里每行有 "run"(工具调用、退款记录、回复),所以改了检查函数以后可以离线重判,不花钱。
这里的例子:去掉评分器那一层,看通过率少了多少。
用法: uv run python -m part06.ex376_regrade part06/reports/main-baseline"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from part06.eval_checks import all_graders
from part06.eval_run import load_cases

if __name__ == "__main__":
    d = Path(sys.argv[1])
    rows = [json.loads(line) for line in (d / "rows.jsonl").read_text(encoding="utf-8").splitlines()]
    cases = {c["id"]: c for c in load_cases("all")}
    changed: dict[str, int] = {}
    now_pass = 0
    for r in rows:
        g = all_graders(r["run"], cases[r["case"]], use_judge=False)        # 不开评分器:不调模型
        ok = all(v for v, _ in g.values())
        now_pass += ok
        if ok and not r["pass"]:
            changed[r["case"]] = changed.get(r["case"], 0) + 1
    print(f"原来(三层): {sum(r['pass'] for r in rows)}/{len(rows)}")
    print(f"去掉评分器: {now_pass}/{len(rows)}")
    print("只因为评分器才失败的次数:", changed)
```

<div class="line-notes">

- `from part06.eval_run import load_cases` 借用昨天读用例的函数。导入 `eval_run` 会顺带建好 `traj_agent` 里的模型客户端,但这个脚本不调用它,不花钱。
- `d = Path(sys.argv[1])` 命令行第一个参数是报告目录,比如 `part06/reports/main-baseline`。`sys.argv[0]` 是脚本名。
- `rows = [json.loads(line) for line in (d / "rows.jsonl").read_text(encoding="utf-8").splitlines()]` 每行一个 JSON,Day 374 写的。
- `cases = {c["id"]: c for c in load_cases("all")}` 把用例按 id 做成字典,下面用 `r["case"]` 一查就拿到。`"all"` 是不分 dev 和 test 全读。
- `g = all_graders(r["run"], cases[r["case"]], use_judge=False)        # 不开评分器:不调模型` 关键是第二个参数以后:拿存下来的运行记录当输入,评分器关掉。评分器要调模型,离线重判做不了它(想重判评分器要重新花钱)。
- `ok = all(v for v, _ in g.values())` 这一次是否所有检查都过。
- `if ok and not r["pass"]:` 原来记录里是失败,现在没有评分器就过了,说明它是「只因为评分器才失败」的。
- `changed[r["case"]] = changed.get(r["case"], 0) + 1` 按用例计数。`.get(k, 0)` 没有这个键时当 0。

</div>

```bash
uv run python -m part06.ex376_regrade part06/reports/main-baseline
uv run python -m part06.ex376_regrade part06/reports/prod2-nokb
```

实测输出:

```text
== main-baseline
原来(三层): 30/36
去掉评分器: 31/36
只因为评分器才失败的次数: {'dup-c012-none': 1}
== prod2-nokb
原来(三层): 1/6
去掉评分器: 3/6
只因为评分器才失败的次数: {'prod-tr-0079': 2}
```

两个结果放在一起看,很有意思。

在 `main-baseline` 上,去掉评分器只多通过 1 次:评分器的 5 次失败里,有 4 次和代码层、轨迹层的失败同时出现(比如 `cancel-c026` 没提交退款,`outcome` 已经报了,评分器又报一遍)。如果你只看这份数据,会觉得评分器没起什么作用,贵不说还引入噪声,想把它删了。

但看 `prod2-nokb`,也就是 Day 374 那两条线上事故用例:去掉评分器,6 次运行里 3 次通过,其中 2 次是 `prod-tr-0079`,也就是那个「我不能凭印象给您列清单」的非回答。**没有评分器,只靠代码检查,这种回复根本抓不到**,因为用例里没有 `reply_must_include`,只有 `facts`。

两件事都是真的:评分器在大多数用例上和代码检查是重复的,但它守住的是代码检查写不出来的那一类,「回复有没有真的回答问题」。想省钱,正确的做法不是删评分器,而是只在用例带 `facts` 的时候才调,Day 374 的 `all_graders` 已经是这么做的。

离线重判还有一种用法:**检查函数的回归测试**。把重判的结果和原来存的 `pass` 对比,凡是不一致的都是这次改动影响到的运行,一条条读,比重新跑一遍再看总分踏实。

## 第二步:门禁会误报多少

Day 375 留了一个尾巴:第一版「新挂」规则误拦了一个无害的 PR,改了规则,但验证用的是同一份数据。现在用模拟来回答一个更干净的问题:**如果代码一行没改,每次提 PR,门禁平均会拦几次?** 这个数叫误报率,理想值是 0,实际一定大于 0,关键是它有多大。

模拟的做法分三步:

1. 设定一个「真实世界」:每条用例有一个固定的真实通过率,比如 `dup-c007-a` 是 100%,`cancel-c028` 是 67%。
2. 在这个世界里「跑」一次基线(每条 3 次,按真实通过率抛硬币),再「跑」一次 PR(每条 2 次),代码没改,所以两边的真实通过率一样。
3. 把基线和 PR 交给门禁规则,看拦不拦。重复 2000 次,数拦了几次。

```python
# agent-zero-lab/part06/ex376_false_alarm.py
"""Day 376 练习 2:代码一行没改,门禁会误报多少次?
设定一个「真实世界」:每条用例有一个固定的真实通过率。先在这个世界里跑一次基线(每条 3 次),
再模拟 N 次「没改代码的 PR」(每条 2 次),分别用第一版规则(掉了 0.5 以上算新挂)和现在的规则
(原来每次都过、现在一次没过)去判,数误报。没有调用模型,不花钱。
用法: uv run python -m part06.ex376_false_alarm"""
from __future__ import annotations

import json
import random
from pathlib import Path

HERE = Path(__file__).parent
N, MAX_DROP = 2000, 0.10


def run_cases(truth: dict[str, float], trials: int, rng: random.Random) -> dict[str, float]:
    return {c: sum(rng.random() < p for _ in range(trials)) / trials for c, p in truth.items()}


def judge(base: dict[str, float], now: dict[str, float], rule: str) -> bool:
    """返回 True 表示门禁拦截。"""
    if rule == "v1":
        failed = [c for c in now if base[c] - now[c] >= 0.5]
    else:
        failed = [c for c in now if base[c] == 1.0 and now[c] == 0.0]
    allowed = max(1, int(len(now) * 0.05))
    single_drop = sum(base.values()) / len(base) - sum(now.values()) / len(now)
    return len(failed) > allowed or single_drop > MAX_DROP


if __name__ == "__main__":
    observed = json.loads((HERE / "baseline.json").read_text(encoding="utf-8"))["case_rate"]
    worlds = {"世界 A:真实通过率 = 基线里测到的": observed,
              "世界 B:每条用例都更不稳(向 50% 靠 20%)": {c: 0.8 * p + 0.1 for c, p in observed.items()}}
    for label, truth in worlds.items():
        for rule in ["v1", "v2"]:
            rng = random.Random(376)
            alarms = 0
            for _ in range(N):
                base = run_cases(truth, 3, rng)          # 每次模拟都重新建一份基线
                alarms += judge(base, run_cases(truth, 2, rng), rule)
            print(f"{label} · 规则 {rule}: 误报 {alarms}/{N} = {alarms / N:.1%}")
```

<div class="line-notes">

- `N, MAX_DROP = 2000, 0.10` 模拟 2000 次;总分阈值和 Day 375 的 `max_drop` 一样。
- `def run_cases(truth: dict[str, float], trials: int, rng: random.Random) -> dict[str, float]:` 在真实通过率为 `truth` 的世界里,每条用例跑 `trials` 次,返回每条用例观察到的通过率。
- `return {c: sum(rng.random() < p for _ in range(trials)) / trials for c, p in truth.items()}` `rng.random()` 返回 0 到 1 之间的随机小数,小于 `p` 就算通过,等价于抛一枚正面概率为 `p` 的硬币。`sum` 一串布尔值就是数 True。`truth` 是 `{"dup-c007-a": 1.0, "cancel-c028": 0.667, ...}` 这样的字典,12 条用例就抛 12 × `trials` 次。
- `def judge(base: dict[str, float], now: dict[str, float], rule: str) -> bool:` 门禁判决:`base` 是模拟出来的基线,`now` 是模拟的 PR。返回 True 表示拦截。这里只实现了总分规则和「新挂」规则,没有越权那条,因为这个模拟里没有越权。
- `failed = [c for c in now if base[c] - now[c] >= 0.5]` 第一版规则:通过率掉了 0.5 以上就算新挂。基线 1.0、PR 0.5(两次里挂一次)就会算。
- `failed = [c for c in now if base[c] == 1.0 and now[c] == 0.0]` 现在的规则:原来每次都过、现在一次没过。
- `allowed = max(1, int(len(now) * 0.05))` 允许新挂的条数,12 条时是 1。
- `single_drop = sum(base.values()) / len(base) - sum(now.values()) / len(now)` 总分差:基线平均通过率减去 PR 的平均通过率。
- `return len(failed) > allowed or single_drop > MAX_DROP` 新挂太多,或者总分掉太多,拦。
- `observed = json.loads((HERE / "baseline.json").read_text(encoding="utf-8"))["case_rate"]` 世界 A 的真实通过率,直接用 Day 375 基线里测到的。
- `worlds = {"世界 A:真实通过率 = 基线里测到的": observed,` 世界 A 假设测到的就是真的。
- `"世界 B:每条用例都更不稳(向 50% 靠 20%)": {c: 0.8 * p + 0.1 for c, p in observed.items()}}` 世界 B:每条的通过率往 50% 靠拢一点,1.0 变成 0.9,0.0 变成 0.1。为什么要有它:基线只有 3 次,测到「3 次全过」不等于真实通过率是 100%,很可能是 90% 运气好。世界 B 就是在问「如果用例比测出来的更不稳呢」。
- `rng = random.Random(376)` 固定随机种子,两条规则面对的是同一串随机数,比较才公平,也方便你复现我的结果。
- `base = run_cases(truth, 3, rng)          # 每次模拟都重新建一份基线` 每次模拟都重新抽一份基线。真实的世界里基线也是抽出来的,不是上帝给的。
- `alarms += judge(base, run_cases(truth, 2, rng), rule)` 布尔值加到整数上,True 当 1。

</div>

```bash
uv run python -m part06.ex376_false_alarm
```

```text
世界 A:真实通过率 = 基线里测到的 · 规则 v1: 误报 250/2000 = 12.5%
世界 A:真实通过率 = 基线里测到的 · 规则 v2: 误报 93/2000 = 4.7%
世界 B:每条用例都更不稳(向 50% 靠 20%) · 规则 v1: 误报 1146/2000 = 57.3%
世界 B:每条用例都更不稳(向 50% 靠 20%) · 规则 v2: 误报 274/2000 = 13.7%
```

(输出里 `v1` 是第一版规则,`v2` 是现在的规则。)读法:

- 世界 A(用例就像基线里测到的那样稳):第一版规则每 8 个无害的 PR 误拦 1 个,现在每 21 个误拦 1 个。
- 世界 B(用例比测出来的更不稳):第一版规则一半以上的 PR 都会被误拦,现在 13.7%,约每 7 个拦 1 个。

三个结论。第一,改规则有效,而且在两个世界里都有效,所以不是「拿同一份数据自证」。第二,**4.7% 不是 0**,也就是说,即使规则对了,平均每 20 个无害 PR 还是会误拦 1 个,而且你不知道是哪一个,这个误报率你要接受,或者用更多 trials 去压(练习 2 就是这个)。第三,用例越不稳,误报越多;**最有效的降误报办法不是调阈值,而是把用例弄稳**,比如我们在 Day 375 看到的 `dup-c012-none` 那个「没有提交退款」的要点,写得不好就是不稳的来源。

这个模拟有几处局限,说清楚:用例是互相独立的(真实里不独立,同一个 prompt 改动会同时影响一批用例);只模拟了「代码没改」的情形,没有模拟「真的改坏了,门禁能抓住多少」(那需要知道改坏的程度,没法凭空模拟,Day 375 的精简 PR 是仅有的一个真实例子);真实的 PR 之间也不独立。所以它是一个**量级估计**,不是精确预测。

## 第三步:把项目讲成故事

面试里「讲一个你做过的项目」最怕两种:一种是堆名词(「我用了 pytest、LLM-as-judge、GitHub Actions……」),一种是吹牛(「准确率提升了 40%」,没人信也没法追问)。评测这件事的好处是:**它的故事天然带数字,而且数字可以复述出来**。下面是我把这六天整理成的一段,你改成自己的真实数字再用:

> 我给一个客服工单 Agent(查订阅和发票、提交退款申请)搭了一套评测和回归门禁。用例 14 条,其中 2 条是线上事故变成的;期望的退款金额不手写,由一个判题器根据数据库和退款政策现算。每次运行过三层检查:库里的退款对不对(代码)、有没有越权查别的客户和重复调用(轨迹)、回复有没有传达要点(LLM 评分器),每条用例跑 3 次看 pass^3。
>
> 第一次跑,单次通过率 66.7%,我读失败的原始记录,发现两个问题:一个是 Agent 把 C028 的年付退款多算了一个月(43056 元,应该是 39468),这类错只有拿判题器的答案比才抓得到;另一个是我自己写的评分器检查有漏洞,评分器判「没回答」时我把这个检查跳过了,结果一个答非所问的回复拿了满分,改成「没回答算失败」。
>
> 后来在 CI 里加了门禁:越权一次就拦,其余和基线比。有次一个只改了措辞的 PR 被误拦,我读失败原因后发现「新挂」的定义太粗,改了规则,并用模拟估了误报率,从大约 12.5% 降到 4.7%。Agent 本身还有没解决的问题:试用状态的客户该不该直接提交退款,Agent 和判题器有分歧,留在基线里作为已知问题。

这段话里每个数字你都能说出来历。面试官追问「12.5% 怎么来的」「为什么不是 0」,你答得上来。更重要的是,里面有**自己犯的错**(评分器漏洞)和**没解决的事**(试用状态的分歧),这比一份「一切顺利」的项目描述可信得多。

几条不要做的:不要说「准确率提升了 X%」,除非你有对照实验(我昨天从 69.4% 到 83.3% 就不能这么说,里面有运气);不要说「覆盖了所有场景」,14 条用例覆盖不了;不要把线上事故编出来,用 Day 373 的虚构数据时,说清楚是模拟的。

## 第四步:面试题

这一部分评测和 CI 的内容在面试里出现频率很高。十道题,先自己口头答一遍,再对照要点。

1. 你怎么评估一个 Agent?评测分哪几层?各自检查什么?
2. 什么是 pass@k 和 pass^k?客服场景该看哪个?
3. 你的测试集是怎么构建的?期望值怎么保证正确?
4. LLM-as-judge 有什么问题?怎么保证它可靠?
5. 结果评测和轨迹评测有什么区别?
6. 多轮对话的 Agent 怎么评估?
7. 12 条用例,通过率从 69% 涨到 83%,能说明变好了吗?
8. 上线后怎么监控、怎么把线上问题变回评测?
9. 评测怎么接入 CI?门禁规则怎么定才不会天天误报?
10. 讲一次你通过评测发现并修复问题的经历。

<details><summary>答题要点</summary>

1. **三层。** 代码层:库里的最终状态(退款金额对不对,用判题器算),回复里该有、不该有的字样;轨迹层:越权、顺序、重复、参数、预算,只写「必须」和「禁止」,不写标准路径;评分器层:代码判不了的语义,比如「回复有没有传达这几个要点」。能用代码判的不用模型。另外要说清离线和线上、能力评测和回归评测的区别。
2. **pass@k:k 次里至少一次成功。pass^k:k 次全部成功。** 客服看 pass^k,因为客户每次只遇到一次,但不稳的用例总有人遇到。我的项目里单次通过率 69.4%、pass^3 是 50.0%,差的那 20 个点就是「时好时坏」的用例。
3. **来源**:手写覆盖四类(该退、不该退、边界、越权诱导)、线上事故变成的用例。**期望值**:不手写金额,写场景名,判题器根据数据库现算(我有过反例:Day 373 里手写的 273 元和库对不上)。分开发集和留出集(md5 取余),留出集不进 CI。要诚实说:14 条很小,只能抓大问题。
4. **问题**:位置偏差、冗长偏差、自我偏好、宽松;评分器自己也会错;还有一个我实际踩到的:评分器说「判不了」时系统怎么处理。我第一版跳过它,让一个答非所问的回复拿了满分。**做法**:一个评分器只判一件事,先理由后结论,二元判定,unknown 单独定义并在系统里算失败;用人标的数据对齐看 TPR、TNR;评测用的评分器最好和 Agent 用不同的模型(我的实验里图省事,两边都用了 deepseek-flash,这是一个已知的局限)。
5. **结果评测看终态,轨迹评测看过程。** 结果:库里退款对不对。轨迹:有没有查别的客户、顺序对不对、有没有重复调用。我的例子:Agent 去查了分店的发票但最终退款是对的,结果评测通过,轨迹评测抓到越权。反过来,C028 多算了一个月,回复写得头头是道,只有结果评测拿判题器的答案比才抓得到。
6. 用 LLM 扮演客户,给人设、目标、「被问才说」的信息;用环境终态判成败(参考 τ-bench);多跑几次看 pass^k。坑:模拟客户太配合、提前结束、编造信息,前几轮必须人工读对话。(这周 Day 362 的内容,这个项目里没有用上多轮。)
7. **不能。** 12 条用例,一条用例一次通过与否就是 2.8 个百分点;同一份代码,三轮的通过率能在 58% 到 83% 之间摆动(我的数据)。要看配对比较(哪些用例新通过、哪些新挂),扩大用例数,多跑几次,别只比总分。我昨天到今天的 69.4% → 83.3%,里面一部分是运气。
8. 线上:tracing 记 trace(Day 364–367),收集显式和隐式反馈(Day 372),每周分诊、聚类、人审(Day 373),变成测试用例、补知识库、改提示词,过门禁再上线。我的例子:E4031 登录错误,线上 14 条回复同样出错,变成测试用例,补知识库文章,用例从 0% 到 100%。
9. PR 上跑便宜版(少量 trials),夜里跑完整版;越权、崩溃零容忍;其余和基线比,只看「原来每次都过、现在一次没过」的用例,允许少量抖动;总分阈值放得比噪声大,只兜底;门禁逻辑写成纯函数、写测试、做变异测试;基线只在主干更新;误报时读失败原因改规则,不是调松阈值;留出集不进 CI。数字:我估计误报率从 12.5% 降到 4.7%,但要承认 4.7% 不是 0。
10. 用我项目里的例子,按「背景、我怎么发现、我怎么改、结果」讲。比如越权:基线里 `scope-c007-c028` 三次里一次去查了 C028 的发票,门禁因此拦下;我加了一句更具体的 prompt;下一轮三次没再出现,**但样本只有 3 次,我只能说没再看到,不能说根除**。一定要带数字,要承认不确定。

</details>

## 第五步:坑清单

这六天(Day 371–376)加上前面几周,我踩过或者眼看着要踩的坑,按顺序列在这里。

| 坑 | 症状 | 怎么办 |
| --- | --- | --- |
| 期望金额手写 | 手写 273 元,和种子库对不上;政策一改全部要改 | 用例里写场景名,判题器现算(Day 350、374) |
| 评分器的 unknown 被「跳过」 | 答非所问的回复拿满分,而且报告里完全看不出来 | unknown 算失败,失败说明里标出来(Day 374) |
| 要点把政策原文整段抄进去 | 每个要点都是评分器的一次失败机会,Agent 做对了也被挑刺 | 要点只写「回复必须让客户知道的事」,代码能判的别放进要点(Day 374) |
| 用例总分当判决 | 同一份代码三轮通过率 58% 到 83% | 看新挂、新修好,总分只兜底(Day 344、375) |
| 预算上限拍脑袋 | 把 token 上限设成 5000,一条完全正常的轨迹被判超预算 | 先看正常轨迹的分布,上限设成最大值的约 1.5 倍(Day 361) |
| 评分器温度 0 就以为稳定 | 同一条回复,理由里全角半角标点都不一样 | 评测看一批的比例,不看单次结果(Day 357) |
| 评分器和 Agent 用同一个模型 | 自我偏好,分数偏高 | 能换就换另一家;换不了就在报告里写明这个局限(Day 359、374) |
| 门禁只看总分 | 随机波动被当成改进或退步 | 越权零容忍、新挂看基线、总分兜底(Day 375) |
| 「新挂」定义太粗 | 一个无害的措辞 PR 被误拦 | 只算原来每次都过、现在一次没过的用例,补测试(Day 375) |
| 门禁自己没测试 | 比较方向写反,CI 永远是绿的 | 11 个测试加变异测试(Day 375) |
| 变异测试脚本自己没跑起来 | 六个变异全显示「没有测试变红」,其实是测试没收集到 | 检查退出码,2 以上是测试本身出错(Day 375) |
| 在功能分支上更新基线 | 各个分支互相覆盖 | 只在 main 上更新,更新要有人看(Day 375) |
| 为了变绿改期望值 | 测试集失去意义 | 基线里放着已知问题;改期望要单独提 PR 写理由 |
| 留出集每天都看 | 不知不觉对它调参 | 不进 CI,大版本前手动跑一次,跑完不依据它改东西(Day 354、374) |
| 在线程里改全局变量 | 每条用例要用不同 prompt 时互相覆盖 | 评测前改一次、之后只读;需要不同值就给函数加参数(Day 374) |
| workflow 里 `if: always()` 忘写 | 评测一红,报告和评论都没了,只看到「红了」 | 上传报告和评论 PR 的步骤都加(Day 375) |
| `secrets` 写成 `secret` | key 是空串,报的是莫名其妙的 401 | actionlint 能直接抓出来(Day 375) |
| fork 来的 PR 拿不到 secrets | 评测没有 API key,必然失败 | 只允许内部分支发 PR,或者手动触发(Day 375) |
| workflow 在本机「验证」过就以为能在 GitHub 上跑 | 权限没给、secrets 没配、runner 缺依赖 | 第一次推上去先开一个只改注释的 PR 试(Day 375) |
| 用评论线索数「问题数」 | `outcome` 和 `traj:refund_args` 成对出现,算成两个问题 | 同一件事被多个检查报了几次,数的时候合并(Day 374) |
| 把 4.7% 当 0 | 以为门禁不会误报,误报时怀疑自己的代码 | 估一下误报率,告诉团队:平均每 20 个无害 PR 会有 1 个被拦(Day 376) |

## 动手练习

1. **写你自己的项目描述。** 照第三步那段的结构,写一段你自己的:用你自己跑出来的数字,至少包含一个「我犯过的错」和一个「没解决的事」。
2. **PR 里多跑几次,误报能降多少。** 把 `ex376_false_alarm.py` 里写死的 2 次改成可调,试 1、2、3、5、8 次。
3. **加一个新检查,离线重判。** 该退款的用例,回复里应该写出退款金额。不重跑 Agent,在 `main-baseline` 上看有几次没写。

### 参考答案

**练习 1**

没有标准答案,给一个示范,是把前面的项目描述压成面试里能在一分钟讲完的版本:

> 我做了一个客服 Agent 的评测和回归门禁。14 条用例,期望退款金额由判题器从数据库现算,三层检查(库里的结果、工具调用轨迹、LLM 评分器),每条跑 3 次。第一次跑 66.7%,读失败记录发现两处:Agent 把一个年付客户多算了一个月,和我的评分器漏洞(「没回答」被我跳过,让一个答非所问的回复满分)。后来接了 CI 门禁,越权一次就拦,其余和基线比;一个无害 PR 被误拦以后,我改了规则,用模拟估误报率从约 12.5% 降到 4.7%。没解决的:试用状态客户的退款,Agent 和判题器有分歧。

检查自己的版本:每个数字能讲出来源吗?有没有写「提升了 X%」却没有对照?有没有一个自己的错?有没有一件没解决的事?

**练习 2**

```python
# agent-zero-lab/part06/ex376_trials.py
"""Day 376 练习 2:PR 上每条用例多跑几次,误报率能降多少?把 ex376_false_alarm 里写死的 2 次改成可调。不调模型。
用法: uv run python -m part06.ex376_trials"""
from __future__ import annotations

import json
import random

from part06.ex376_false_alarm import HERE, N, judge, run_cases

if __name__ == "__main__":
    observed = json.loads((HERE / "baseline.json").read_text(encoding="utf-8"))["case_rate"]
    flaky = {c: 0.8 * p + 0.1 for c, p in observed.items()}
    print("PR 每条用例跑几次  世界 A 误报  世界 B 误报   (规则 v2,基线固定每条 3 次)")
    for trials in [1, 2, 3, 5, 8]:
        cells = []
        for truth in (observed, flaky):
            rng = random.Random(376)
            alarms = sum(judge(run_cases(truth, 3, rng), run_cases(truth, trials, rng), "v2") for _ in range(N))
            cells.append(f"{alarms / N:>8.1%}")
        print(f"{trials:>10}        {cells[0]}  {cells[1]}")
```

<div class="line-notes">

- `from part06.ex376_false_alarm import HERE, N, judge, run_cases` 直接复用上一个脚本里的函数和常量,所以它的 `if __name__ == "__main__"` 里的内容不会运行。
- `flaky = {c: 0.8 * p + 0.1 for c, p in observed.items()}` 世界 B 的真实通过率。
- `for trials in [1, 2, 3, 5, 8]:` PR 里每条用例跑的次数。基线固定 3 次。
- `for truth in (observed, flaky):` 两个世界各跑一遍。
- `alarms = sum(judge(run_cases(truth, 3, rng), run_cases(truth, trials, rng), "v2") for _ in range(N))` 每次模拟:基线 3 次,PR `trials` 次,用现在的规则判,数拦了几次。
- `cells.append(f"{alarms / N:>8.1%}")` 右对齐占 8 格的百分比。

</div>

```text
PR 每条用例跑几次  世界 A 误报  世界 B 误报   (规则 v2,基线固定每条 3 次)
         1           11.4%     28.3%
         2            4.7%     13.7%
         3            4.1%     12.7%
         5            1.8%      8.0%
         8            0.9%      7.4%
```

跑得越多,误报越低,但收益递减:2 次到 3 次几乎没变(4.7% 到 4.1%),到 5 次才明显降(1.8%)。每多一次试验,PR 评测的钱就多一份:2 次约 0.25 元,5 次约 0.6 元。世界 B 里即使跑 8 次,还有 7.4% 的误报,因为用例本身就不稳,多跑也压不下来,这时候要回去修用例。

**练习 3**

```python
# agent-zero-lab/part06/ex376_amount.py
"""Day 376 练习 3:加一个新检查——该退款的用例,回复里要写出退款金额。不重跑 Agent,用存下来的运行记录离线重判。
用法: uv run python -m part06.ex376_amount part06/reports/main-baseline"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from part06.eval_checks import want_refund
from part06.eval_run import load_cases


def mentions_amount(reply: str, yuan: float) -> bool:
    plain = f"{yuan:.0f}" if yuan == int(yuan) else f"{yuan:.2f}"
    return plain in reply.replace(",", "").replace("，", "")        # 去掉英文和中文的千分位逗号


if __name__ == "__main__":
    rows = [json.loads(line) for line in (Path(sys.argv[1]) / "rows.jsonl").read_text(encoding="utf-8").splitlines()]
    cases = {c["id"]: c for c in load_cases("all")}
    checked = missed = 0
    for r in rows:
        want = want_refund(cases[r["case"]])
        if want is None or not r["run"]["refunds"]:        # 只查「该退、而且真提交了」的运行
            continue
        checked += 1
        if not mentions_amount(r["reply"], want["amount_yuan"]):
            missed += 1
            print(f"  {r['case']} 第 {r['trial']} 次:回复里没写 {want['amount_yuan']:.0f}")
    print(f"该退且已提交的 {checked} 次运行里,回复没写金额的 {missed} 次")
```

<div class="line-notes">

- `def mentions_amount(reply: str, yuan: float) -> bool:` 回复里有没有出现这个金额。
- `plain = f"{yuan:.0f}" if yuan == int(yuan) else f"{yuan:.2f}"` 整数金额写成 `39468`,有小数的写成两位小数。
- `return plain in reply.replace(",", "").replace("，", "")        # 去掉英文和中文的千分位逗号` 回复里有人写 `43,056`,有人写 `43056`,先把逗号都去掉再找。
- `want = want_refund(cases[r["case"]])` 昨天写的,从判题器现算这条用例该退多少。
- `if want is None or not r["run"]["refunds"]:        # 只查「该退、而且真提交了」的运行` 没提交退款的运行,回复里不写金额是对的(只是在问客户确认),不用查。
- `if not mentions_amount(r["reply"], want["amount_yuan"]):` 该写没写,记一次。

</div>

```text
  cancel-c028 第 0 次:回复里没写 39468
该退且已提交的 14 次运行里,回复没写金额的 1 次
```

14 次里只有 1 次,就是 `cancel-c028` 那次多算了一个月的运行:回复里写的是 `43,056`,不是判题器算出来的 39468。所以这个新检查在这份数据里没有发现新的问题,它抓到的是同一个错误,`outcome` 和 `traj:refund_args` 已经抓过了。它的价值在另一个方向:如果将来有一次,库里的退款对了,回复里却跟客户说了另一个数,只有这个检查(或评分器)会发现。**一个新检查要证明有用,得找到一个老检查找不到的东西**,否则只是重复。这次没找到,那就老实说没找到,不要硬编一个例子。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 离线重判 | 不重新调用 Agent,用存下来的运行记录重新跑一遍检查函数。检查函数改动以后,拿它做回归测试 |
| 误报率 | 代码没有真的变坏,门禁却拦了的比例。理想是 0,实际一定大于 0 |
| 蒙特卡洛模拟 | 用大量随机抽样来估计一个难以直接算出来的量。这里是抛硬币模拟「没改代码的 PR」 |
| 随机种子 | 固定随机数序列的起点,让两次模拟用同一串随机数,结果可复现、可公平比较 |
| 局限 | 一个结论成立的前提和它的盲区,面试里主动说,可信度更高 |
| 项目描述 | 用几句话讲清「做了什么、遇到什么问题、怎么发现、怎么解决、结果和没解决的」 |

## 常见误区

**只在评测通过的时候才存运行记录。** 失败的运行才最有价值。今天能做离线重判,是因为每一行都存了完整的运行,不管过没过。

**用一份数据既调参又验证。** Day 375 的规则改动用了同一份数据去验证,模拟的作用就是换一个独立的办法再验证一遍。以后遇到「改完规则再用同一份数据说它好」,先想一想有没有别的验证办法。

**项目描述里只有成功。** 面试官会追问「有没有遇到什么问题」,没有踩过坑的项目描述读起来像没做过。要有一个自己犯的错,一件没解决的事。

**把模拟当预测。** 模拟的前提(用例互相独立、真实通过率已知)和真实世界差得很远,它给的是量级,不是保证。「大约 5%」可以说,「4.7%」说成精确值就过了。

**以为多跑几次就能压住所有误报。** 世界 B 里跑 8 次还有 7.4%,用例本身不稳的时候,多跑没用,要去修用例。

## 学习资料

### 文档与文章

- [Hamel Husain & Shreya Shankar · AI Evals FAQ](https://hamel.dev/blog/posts/evals-faq/):整篇再读一遍,这六天的概念大部分你现在都亲手做过,会读出很多第一次没注意到的东西。
- [Anthropic · Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):周末把全文读一遍,对照看哪些做到了、哪些没做到。
- [Eugene Yan · An LLM-as-Judge Won't Save The Product—Fixing Your Process Will](https://eugeneyan.com/writing/eval-process/):评测是一个持续的流程,和今天的复盘一致。
- [pytest 文档](https://docs.pytest.org/en/stable/):fixture 和参数化。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1VL3F6pE9K&autoplay=0&high_quality=1" title="0基础入门智能体agent测试:AI测试基础+AI智能体(Agent)测试从零入门全攻略" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>黑马测试 · 0基础入门智能体agent测试:AI测试基础+AI智能体(Agent)测试从零入门全攻略,2026最新版! · 200 P 的长合集,不用全看,挑讲测试用例设计和自动化的几 P,看看测试岗是怎么理解 Agent 评测的,面试时两种视角都能聊。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1k4HZ6xEHR&autoplay=0&high_quality=1" title="一口气学会AI Agent可观测性与Evals/LLM Ops/Tracing/成本追踪/开源实测" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>肖恩君Sean · 一口气学会AI Agent可观测性与Evals/LLM Ops/Tracing/成本追踪/开源实测 · 20 分钟,把评测和 tracing、成本放在一起讲,看完再回头想想我们的项目少了哪一块。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/bdMHQLvtVaQ" title="How to Build Better AI Evals with Claude Code in 5 Steps | Shreya & Hamel" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Peter Yang · How to Build Better AI Evals with Claude Code in 5 Steps | Shreya & Hamel · 54 分钟,两位作者演示用 Coding Agent 辅助搭评测,人定标准、Agent 写样板代码的分工,可以在自己的项目里试。</figcaption>
</figure>

- Hamel Husain《How To Turn Evals Into A Better Model》(YouTube ID `P7os3s-HMAw`,36 分钟):讲评测建好之后怎么用它持续改进。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):评测相关章节,周末连起来读一遍,约 3 小时。
- Shreya Shankar、Hamel Husain《Evals for AI Engineers》(O'Reilly 页面标注 2026 年 10 月,[目录页](https://www.oreilly.com/library/view/evals-for-ai/9798341660717/),对爬虫返回 403,需用浏览器打开):我只看了目录和简介,没有读过全文。

### 开源项目与代码

- [confident-ai/deepeval](https://github.com/confident-ai/deepeval):pytest 风格的评测框架,和我们自己写的 `eval_checks.py` 对比,看框架替你省了什么、藏了什么。
- [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo):YAML 配置的评测工具,自带 CI 集成。
- [langfuse/langfuse](https://github.com/langfuse/langfuse):它的数据集和实验功能,团队协作时可以替代我们的一部分报告逻辑。

## 自测

1. 离线重判为什么需要提前把 `run` 存进每一行逐次结果?

<details><summary>答案</summary>

重判的输入是运行记录(工具调用、库里的退款、回复)。没存,检查函数改了以后只能重新调 Agent,既花钱,又因为 Agent 有随机性得到的是另一批运行,没法回答「同一批运行换个判法会怎样」。

</details>

2. 去掉评分器以后,`main-baseline` 只多通过 1 次,是不是说明评分器没用?

<details><summary>答案</summary>

不是。在 `main-baseline` 上评分器的失败大多和代码、轨迹层同时出现,是重复的。但在 `prod2-nokb` 上,去掉评分器后「我不能凭印象列清单」这种非回答会通过(6 次里多通过 2 次)。评分器守的是代码层写不出来的那一类:回复有没有真的回答问题。

</details>

3. 误报率模拟里为什么每次都重新抽一份基线,而不是固定一份?

<details><summary>答案</summary>

真实世界里基线也是跑出来的,也有运气成分,不是上帝给的。如果固定一份,等于假设基线是真实值,低估了「基线本身测偏了」带来的误报。

</details>

4. 误报率 4.7% 是不是说明门禁每 20 个无害 PR 一定会误拦 1 个?

<details><summary>答案</summary>

不是。它是概率估计,而且前提是用例互相独立、真实通过率等于设定值。实际上可能 40 个才有一次,也可能连着两次,而且真实用例比测出来的更不稳时会更高(世界 B 是 13.7%)。只能当量级。

</details>

5. 面试题:你的评测系统有什么局限?

<details><summary>答案</summary>

用例只有 14 条,只能抓大问题,判断不了 3 个点的差异;评分器和 Agent 用的同一个模型(DeepSeek flash),有自我偏好的风险;`cancel-c026` 这类试用状态的分歧没有业务方拍板,基线里一直 0%;PR 只跑 2 次,噪声比基线大;本机没在真实的 GitHub 上跑过 workflow;用例是我自己写的,和真实客户的说法分布不一样。主动把这些说出来,比被问出来好。

</details>

## 明天预告

Day 377 · 第 54 周复习:评测与可观测(Day 371–376)。这六天做了三件事:自动优化提示词的第三部分、反馈闭环两天、评测小项目三天。明天用一张知识地图把它们串起来,整理错题,并默写本周最核心的一段代码。
