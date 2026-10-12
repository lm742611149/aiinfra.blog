---
title: 'Day 35 · W5 复习 + 小项目:给工单 Agent 加评测集和 CI 回归门禁'
description: '把这一周的 adapter、测试集、判题器、评分器、轨迹检查和 tracing 组装成一个评测系统:一条命令跑完三层检查,多进程并发,输出带基线对比的报告(哪些用例新挂了、哪些新修好了),再接进 GitHub Actions,合并请求自动跑,关键检查失败或分数明显下降就拦住。最后是 W5 的面试题和坑清单。'
pubDate: 2026-10-12
regime: none
tags: ['eval', 'ci', 'github-actions', 'regression', 'review', 'agent-60']
series: 'agent-60'
day: 35
lang: 'zh'
---

## 今天要解决的问题

这一周你写了不少零件:Day 29 的 adapter 和冒烟用例,Day 30 的标注工具,Day 31 的测试集和判题器,Day 32 的评分器和对齐脚本,Day 33 的轨迹检查和模拟客户,Day 34 的 tracing。每个都能单独跑,但还没拼成一个东西。

今天把它们组装起来,目标很具体:**以后任何人改了 W4 的 prompt、换了模型、动了工具,提交合并请求时自动跑一遍评测,把结果贴在合并请求下面;如果关键检查失败或者分数明显掉了,不让合并。** 这就是 CI 回归门禁(regression gate)。做到这一步,你的 Agent 才算有了一张安全网,后面 W6 生产化、W7–8 毕业项目的每一次改动都会从这里受益。

学完今天你应该能:

1. 画出这一周所有零件的关系图,说出每个零件解决什么问题。
2. 用一条命令跑完 L1 断言、轨迹检查和(可选的)L2 评分器,多进程并发,输出 Markdown 报告。
3. 维护一份基线,报告里逐条列出「新挂的」和「新修好的」用例。
4. 写一个门禁函数,并给它写单元测试。
5. 配好 GitHub Actions:合并请求跑快速版,每晚跑带评分器的完整版,结果自动评论到合并请求上。
6. 回答本周的高频面试题。

预计用时 6–8 小时。今天代码多,但几乎都是把前几天的东西重新组织,新概念很少。

## 一页知识地图

<figure>
<svg viewBox="0 0 640 340" role="img" aria-label="W5 评测系统知识地图:数据、运行、检查、报告与门禁、可观测五个部分及其关系">
<rect x="0" y="0" width="640" height="340" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="11">
<rect x="16" y="20" width="190" height="130" rx="6" fill="none" stroke="var(--compute)"/>
<text x="26" y="40" fill="var(--ink)" font-size="12">数据(Day 30–31)</text>
<text x="26" y="62" fill="var(--ink-soft)">错误分析 → 失败类别</text>
<text x="26" y="80" fill="var(--ink-soft)">golden.jsonl(dev/test)</text>
<text x="26" y="98" fill="var(--ink-soft)">判题器 oracle.py</text>
<text x="26" y="116" fill="var(--ink-soft)">两步法合成 + 边界用例</text>
<text x="26" y="134" fill="var(--ink-soft)">baseline.json</text>
<rect x="225" y="20" width="190" height="130" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="235" y="40" fill="var(--ink)" font-size="12">运行(Day 29、33)</text>
<text x="235" y="62" fill="var(--ink-soft)">adapter.run_case</text>
<text x="235" y="80" fill="var(--ink-soft)">每次一个新数据库副本</text>
<text x="235" y="98" fill="var(--ink-soft)">多进程 × trials</text>
<text x="235" y="116" fill="var(--ink-soft)">user_sim(多轮)</text>
<rect x="434" y="20" width="190" height="130" rx="6" fill="none" stroke="var(--ink-soft)"/>
<text x="444" y="40" fill="var(--ink)" font-size="12">检查(Day 29–33)</text>
<text x="444" y="62" fill="var(--ink-soft)">L1 规则:分类/审批/</text>
<text x="444" y="78" fill="var(--ink-soft)">  工具/退款 outcome/回复</text>
<text x="444" y="98" fill="var(--ink-soft)">轨迹:顺序/越权/重复/预算</text>
<text x="444" y="118" fill="var(--ink-soft)">L2 评分器 facts</text>
<text x="444" y="134" fill="var(--ink-soft)">  (TPR/TNR 对齐过)</text>
<rect x="120" y="190" width="400" height="60" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="135" y="212" fill="var(--ink)" font-size="12">报告与门禁(Day 35)</text>
<text x="135" y="232" fill="var(--ink-soft)">单次通过率 · pass^k · 每个 grader · 新挂/新修好 · 成本延迟</text>
<rect x="120" y="275" width="190" height="48" rx="6" fill="none" stroke="var(--rule)"/>
<text x="130" y="296" fill="var(--ink)">CI:PR 快速版</text>
<text x="130" y="313" fill="var(--ink-soft)">每晚完整版</text>
<rect x="330" y="275" width="190" height="48" rx="6" fill="none" stroke="var(--rule)"/>
<text x="340" y="296" fill="var(--ink)">可观测(Day 34)</text>
<text x="340" y="313" fill="var(--ink-soft)">score 写回 trace</text>
<line x1="206" y1="85" x2="225" y2="85" stroke="var(--ink-faint)" marker-end="url(#a35)"/>
<line x1="415" y1="85" x2="434" y2="85" stroke="var(--ink-faint)" marker-end="url(#a35)"/>
<line x1="529" y1="150" x2="450" y2="190" stroke="var(--ink-faint)" marker-end="url(#a35)"/>
<line x1="215" y1="250" x2="215" y2="275" stroke="var(--ink-faint)" marker-end="url(#a35)"/>
<line x1="425" y1="250" x2="425" y2="275" stroke="var(--ink-faint)" marker-end="url(#a35)"/>
<path d="M330 299 Q20 299 30 160" fill="none" stroke="var(--ink-faint)" stroke-dasharray="4 3" marker-end="url(#a35)"/>
<text x="24" y="270" fill="var(--ink-faint)">点踩/失败 trace 回流</text>
<defs><marker id="a35" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--ink-faint)"/></marker></defs>
</g>
</svg>
<figcaption>W5 的全部零件。虚线是最容易被忘掉的那条:线上的失败要回流成新的用例,评测系统才会跟着产品一起长。</figcaption>
</figure>

用几句话把这一周串起来:Day 29 说清楚为什么要评测,以及 task、trial、grader、outcome、pass^k 这些概念;Day 30 读 trace、归类失败,决定先评什么;Day 31 把失败变成带可计算期望的测试集;Day 32 给代码判断不了的语义问题配一个对齐过的评分器;Day 33 把检查从结果延伸到过程;Day 34 让每次运行都可见,分数能挂回 trace。今天把它们装进一个能自动运行的流水线。

## 小项目:完整的评测系统

最终的目录结构:

```text
agent-60-lab/
├── w4/                        # 被测的工单 Agent(Day 28)
│   └── cloudledger/seed.py    # 种子库,CI 里每次重建
├── w5/
│   ├── adapter.py             # Day 29:调 W4、隔离数据库、收集轨迹
│   ├── oracle.py              # Day 31:判题器
│   ├── schema.py              # Day 31:用例结构
│   ├── trajectory.py          # Day 33:轨迹检查
│   ├── judge.py               # Day 32:L2 评分器
│   ├── checks.py              # 今天:所有 grader 的汇总入口
│   ├── gate.py                # 今天:门禁规则(纯函数,好测)
│   ├── evaluate.py            # 今天:总入口
│   ├── cases/golden.jsonl
│   ├── baseline.json          # 今天:基线,随代码一起提交
│   ├── reports/               # 输出,不提交
│   └── tests/
│       ├── test_trajectory.py # Day 33
│       └── test_gate.py       # 今天
└── .github/workflows/agent-eval.yml
```

### 1. checks.py:所有 grader 汇总

把 Day 29 的 `check()`、Day 31 新增的断言、Day 33 的轨迹检查、Day 32 的评分器收到一个地方。每个 grader 返回 `(是否通过, 说明)`,这样报告里能直接看到失败原因。

```python
# agent-60-lab/w5/checks.py
from __future__ import annotations

from w5.adapter import AgentRun
from w5.trajectory import trajectory_graders

# 关键 grader:任何一次失败都直接拦住合并,不看总分
CRITICAL = {"no_crash", "traj:scope", "refund_none", "refund_match", "not_call:create_refund_request"}


def rule_graders(run: AgentRun, case: dict) -> dict[str, tuple[bool, str]]:
    exp = case["expect"]
    g: dict[str, tuple[bool, str]] = {"no_crash": (run.error is None, run.error or "")}
    if run.error:
        return g   # 崩了就别往下查了,其余 grader 全算失败没有意义

    g["category"] = (run.category == exp["category"], f"得到 {run.category},期望 {exp['category']}")
    g["approval"] = (run.pending_approval == exp.get("needs_approval", False),
                     f"pending_approval={run.pending_approval}")
    names = run.tool_names()
    for tool in exp.get("must_call", []):
        g[f"call:{tool}"] = (tool in names, f"没有调用 {tool}")
    for tool in exp.get("must_not_call", []):
        g[f"not_call:{tool}"] = (tool not in names, f"调用了不该调的 {tool}")

    want = exp.get("refund")
    got = [r for r in run.refunds if r["status"] == "pending_approval"]
    if want is None:
        g["refund_none"] = (not got, f"不该退款却产生了 {got}")
    else:
        ok = (len(got) == 1 and got[0]["invoice_id"] == want["invoice_id"]
              and abs(got[0]["amount_cents"] / 100 - want["amount_yuan"]) < 0.01)
        g["refund_match"] = (ok, f"库里 {got},期望 {want}")

    for s in exp.get("reply_must_include", []):
        g[f"include:{s}"] = (s in run.reply, f"回复缺少「{s}」")
    for s in exp.get("reply_must_not_include", []):
        g[f"exclude:{s}"] = (s not in run.reply, f"回复不该出现「{s}」")
    return g


def all_graders(run: AgentRun, case: dict, use_judge: bool = False) -> dict[str, tuple[bool, str]]:
    g = rule_graders(run, case)
    if run.error:
        return g
    g.update(trajectory_graders(run, case))
    facts = case["expect"].get("facts") or []
    if use_judge and facts and run.reply.strip():
        from w5.judge import judge_facts
        v = judge_facts(case["ticket"], run.reply, facts)
        if v.verdict != "unknown":                 # unknown 不计入通过与否,单独统计
            g["judge:facts"] = (v.verdict == "pass", v.critique)
    return g
```

`CRITICAL` 这个集合是今天的设计重点之一,下面讲门禁时细说。

### 2. evaluate.py:总入口

```python
# agent-60-lab/w5/evaluate.py
"""W5 评测总入口。
  uv run python -m w5.evaluate --split dev --trials 2              # 快速版:L1 + 轨迹
  uv run python -m w5.evaluate --split dev --trials 3 --judge      # 完整版:再加 L2 评分器
  uv run python -m w5.evaluate ... --gate                          # 不通过门禁时退出码为 1
  uv run python -m w5.evaluate ... --update-baseline               # 把这次结果设为新基线"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import subprocess
import sys
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

CASES = Path("w5/cases/golden.jsonl")
BASELINE = Path("w5/baseline.json")
REPORTS = Path("w5/reports")
PRICE_IN = float(os.getenv("PRICE_IN_PER_M", "2"))     # 元 / 百万输入 token,按你用的模型改
PRICE_OUT = float(os.getenv("PRICE_OUT_PER_M", "8"))   # 元 / 百万输出 token


def run_one(job: tuple[dict, int, bool]) -> dict:
    """在子进程里跑。每个进程有自己的环境变量,adapter 改 CLOUDLEDGER_DB 不会互相串。"""
    from w5.adapter import run_case
    from w5.checks import all_graders

    case, trial, use_judge = job
    run = run_case(case["id"], case["ticket"], case.get("customer_id"))
    graders = all_graders(run, case, use_judge)
    return {"case": case["id"], "trial": trial, "tags": case.get("tags", []),
            "pass": all(ok for ok, _ in graders.values()),
            "failed": {k: why for k, (ok, why) in graders.items() if not ok},
            "latency_s": run.latency_s, "tokens_in": run.input_tokens, "tokens_out": run.output_tokens}


def git_rev(path: Path) -> str:
    out = subprocess.run(["git", "log", "-1", "--format=%h", "--", str(path)],
                         capture_output=True, text=True)
    return out.stdout.strip() or "uncommitted"


def summarize(rows: list[dict], trials: int) -> dict:
    by_case: dict[str, list[bool]] = {}
    for r in rows:
        by_case.setdefault(r["case"], []).append(r["pass"])
    grader_fail = Counter(k for r in rows for k in r["failed"])
    lat = sorted(r["latency_s"] for r in rows)
    tin, tout = sum(r["tokens_in"] for r in rows), sum(r["tokens_out"] for r in rows)
    return {
        "n_cases": len(by_case), "trials": trials,
        "single_pass": sum(r["pass"] for r in rows) / len(rows),
        "pass_all_k": sum(all(v) for v in by_case.values()) / len(by_case),
        "case_pass": {c: all(v) for c, v in by_case.items()},
        "grader_fail": dict(grader_fail.most_common()),
        "latency_p50": statistics.median(lat),
        "latency_p95": lat[min(len(lat) - 1, int(len(lat) * 0.95))],
        "cost_yuan": round(tin / 1e6 * PRICE_IN + tout / 1e6 * PRICE_OUT, 2),
        "cost_per_ticket_yuan": round((tin / 1e6 * PRICE_IN + tout / 1e6 * PRICE_OUT) / len(rows), 4),
    }


def main() -> None:
    from w5.gate import gate, render_report

    ap = argparse.ArgumentParser()
    ap.add_argument("--split", default="dev", choices=["dev", "test", "all"])
    ap.add_argument("--trials", type=int, default=2)
    ap.add_argument("--judge", action="store_true")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--gate", action="store_true")
    ap.add_argument("--update-baseline", action="store_true")
    args = ap.parse_args()

    cases = [json.loads(l) for l in CASES.read_text(encoding="utf-8").splitlines() if l.strip()]
    if args.split != "all":
        cases = [c for c in cases if c.get("split", "dev") == args.split]
    jobs = [(c, t, args.judge) for c in cases for t in range(args.trials)]

    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        rows = list(pool.map(run_one, jobs))

    summary = summarize(rows, args.trials)
    summary.update({"split": args.split, "judge": args.judge, "dataset_rev": git_rev(CASES),
                    "code_rev": git_rev(Path("w4")), "time": datetime.now().isoformat(timespec="seconds")})
    baseline = json.loads(BASELINE.read_text(encoding="utf-8")) if BASELINE.exists() else None
    verdict = gate(summary, rows, baseline)

    out = REPORTS / datetime.now().strftime("%Y%m%d-%H%M%S")
    out.mkdir(parents=True, exist_ok=True)
    (out / "rows.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows), encoding="utf-8")
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    report = render_report(summary, rows, baseline, verdict)
    (out / "report.md").write_text(report, encoding="utf-8")
    (REPORTS / "latest.md").write_text(report, encoding="utf-8")
    print(report)

    if args.update_baseline:
        BASELINE.write_text(json.dumps({k: summary[k] for k in
                                        ["single_pass", "pass_all_k", "case_pass", "split", "trials",
                                         "dataset_rev", "code_rev", "time"]},
                                       ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"基线已更新: {BASELINE}")
    if args.gate and not verdict["ok"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
```

这里回答 Day 30 留下的一个问题:并发时环境变量互相串。答案是用 `ProcessPoolExecutor` 而不是线程池。每个子进程有自己独立的一份环境变量,adapter 在子进程里改 `CLOUDLEDGER_DB`,影响不到别的进程。代价是进程启动慢一点,每个进程还要单独 import 一遍 LangGraph,但对评测来说完全可以接受。`run_one` 必须是模块顶层的函数,因为要能被 pickle 传给子进程,写成 lambda 或嵌套函数会报 `Can't pickle` 错误。

`workers` 默认 4。别开太大,国内厂商的 API 一般都有每分钟请求数(RPM)限制,开到 16 个进程很容易撞 429。撞了的话 adapter 会把它记成 `no_crash` 失败,而且是关键 grader,门禁会直接拦住,你一看报告就知道是限流不是 Agent 的问题。

`PRICE_IN_PER_M` 和 `PRICE_OUT_PER_M` 写成环境变量,默认值只是占位,一定要按你用的模型在厂商价格页上查到的价格改。

### 3. gate.py:门禁和报告

门禁是整个系统里最需要想清楚的部分。规则太松,等于没有;规则太严,大模型的随机性会让 CI 天天随机变红,两周后大家就学会无视它了。我的规则分三层:

1. **关键 grader 零容忍。** 越权查询、不该退款却产生了退款申请、退款金额不对、崩溃。这些在任何一次 trial 里出现一次就拦。理由是它们的后果是资损或数据泄露,而且这些检查都是确定性的代码,不存在评分器误判的问题。
2. **基线里通过的用例,不能新挂太多。** 允许挂 1 条或 5%(取大者),给随机性留余量。超过就拦。
3. **单次通过率不能比基线低 5 个百分点以上。** Day 31 算过,几十条用例的总分误差在 ±10% 左右,所以总分只作为兜底,阈值放得比较宽。

```python
# agent-60-lab/w5/gate.py
from __future__ import annotations

from w5.checks import CRITICAL


def gate(summary: dict, rows: list[dict], baseline: dict | None,
         max_drop: float = 0.05, new_fail_ratio: float = 0.05) -> dict:
    reasons: list[str] = []

    critical = sorted({(r["case"], k) for r in rows for k in r["failed"] if k in CRITICAL})
    if critical:
        reasons.append(f"关键检查失败 {len(critical)} 处: " +
                       ", ".join(f"{c}/{k}" for c, k in critical[:10]))

    newly_failed, newly_passed = [], []
    if baseline:
        base = baseline["case_pass"]
        now = summary["case_pass"]
        newly_failed = sorted(c for c in now if base.get(c) is True and now[c] is False)
        newly_passed = sorted(c for c in now if base.get(c) is False and now[c] is True)
        allowed = max(1, int(len(now) * new_fail_ratio))
        if len(newly_failed) > allowed:
            reasons.append(f"新挂了 {len(newly_failed)} 条(允许 {allowed}): {', '.join(newly_failed[:10])}")
        if summary["single_pass"] < baseline["single_pass"] - max_drop:
            reasons.append(f"单次通过率 {summary['single_pass']:.1%} 比基线 "
                           f"{baseline['single_pass']:.1%} 低了超过 {max_drop:.0%}")

    return {"ok": not reasons, "reasons": reasons,
            "newly_failed": newly_failed, "newly_passed": newly_passed}


def render_report(summary: dict, rows: list[dict], baseline: dict | None, verdict: dict) -> str:
    s = summary
    lines = [f"## Agent 评测 {'✅ 通过' if verdict['ok'] else '❌ 未通过'}", ""]
    for r in verdict["reasons"]:
        lines.append(f"- {r}")
    lines += ["", "| 指标 | 本次 | 基线 |", "| --- | --- | --- |"]

    def b(key: str, fmt: str = "{:.1%}") -> str:
        return fmt.format(baseline[key]) if baseline and key in baseline else "-"

    lines.append(f"| 单次通过率 | {s['single_pass']:.1%} | {b('single_pass')} |")
    lines.append(f"| pass^{s['trials']} | {s['pass_all_k']:.1%} | {b('pass_all_k')} |")
    lines.append(f"| 延迟 P50 / P95 | {s['latency_p50']:.1f}s / {s['latency_p95']:.1f}s | - |")
    lines.append(f"| 本次花费 / 每张工单 | ¥{s['cost_yuan']} / ¥{s['cost_per_ticket_yuan']} | - |")
    lines += ["", f"用例 {s['n_cases']} 条 × {s['trials']} 次 · split={s['split']} · "
              f"judge={'on' if s['judge'] else 'off'} · 数据集 {s['dataset_rev']} · W4 {s['code_rev']}", ""]

    if verdict["newly_failed"] or verdict["newly_passed"]:
        lines.append(f"**新挂了**:{', '.join(verdict['newly_failed']) or '无'}")
        lines.append(f"**新修好**:{', '.join(verdict['newly_passed']) or '无'}")
        lines.append("")
    if s["grader_fail"]:
        lines += ["失败最多的检查:", ""]
        for k, n in list(s["grader_fail"].items())[:8]:
            example = next(r for r in rows if k in r["failed"])
            lines.append(f"- `{k}` × {n},例:{example['case']} — {example['failed'][k][:80]}")
    return "\n".join(lines)
```

`gate()` 和 `render_report()` 是纯函数,不调模型、不读文件,所以能写单元测试。门禁逻辑写错了(比如把 `newly_failed` 的条件写反),后果是 CI 永远是绿的,你还以为一切正常。这种「守门员自己有 bug」的情况非常隐蔽,一定要测:

```python
# agent-60-lab/w5/tests/test_gate.py
from w5.gate import gate


def summary(case_pass: dict, single: float) -> dict:
    return {"case_pass": case_pass, "single_pass": single}


def row(case: str, failed: dict | None = None) -> dict:
    return {"case": case, "failed": failed or {}, "pass": not failed}


def test_critical_failure_blocks_even_if_score_is_high():
    rows = [row("a"), row("b", {"traj:scope": "查了 C028"})]
    v = gate(summary({"a": True, "b": False}, 0.95), rows, None)
    assert not v["ok"] and "关键检查" in v["reasons"][0]


def test_one_new_failure_is_tolerated():
    base = {"case_pass": {c: True for c in "abcdefghij"}, "single_pass": 0.9}
    now = {**base["case_pass"], "a": False}
    v = gate(summary(now, 0.88), [row("a", {"category": "x"})], base)
    assert v["ok"] and v["newly_failed"] == ["a"]


def test_many_new_failures_block():
    base = {"case_pass": {c: True for c in "abcdefghij"}, "single_pass": 0.9}
    now = {**base["case_pass"], "a": False, "b": False, "c": False}
    v = gate(summary(now, 0.88), [], base)
    assert not v["ok"]


def test_score_drop_blocks():
    base = {"case_pass": {"a": True}, "single_pass": 0.90}
    v = gate(summary({"a": True}, 0.80), [], base)
    assert not v["ok"] and "单次通过率" in v["reasons"][0]


def test_newly_passed_is_reported():
    base = {"case_pass": {"a": False, "b": True}, "single_pass": 0.5}
    v = gate(summary({"a": True, "b": True}, 1.0), [], base)
    assert v["ok"] and v["newly_passed"] == ["a"]
```

```bash
uv run pytest w5/tests -q
```

### 4. 第一次跑,建立基线

```bash
uv run python w4/cloudledger/seed.py                       # 确保种子库是干净的
uv run python -m w5.evaluate --split dev --trials 3 --judge --update-baseline
git add w5/baseline.json && git commit -m "eval: 初始基线"
```

报告大致长这样(数字是示意):

```text
## Agent 评测 ❌ 未通过
- 关键检查失败 2 处: syn-cancel-014/refund_none, edge-scope-02/traj:scope

| 指标 | 本次 | 基线 |
| --- | --- | --- |
| 单次通过率 | 78.4% | - |
| pass^3 | 61.2% | - |
| 延迟 P50 / P95 | 6.1s / 14.8s | - |
| 本次花费 / 每张工单 | ¥1.86 / ¥0.0127 | - |

用例 49 条 × 3 次 · split=dev · judge=on · 数据集 3f2a91c · W4 8d0e4b2

失败最多的检查:
- `judge:facts` × 14,例:syn-cancel-007 — 没提当月不退
- `category` × 9,例:syn-past-due-021 — 得到 refund,期望 billing
...
```

第一次跑出「未通过」很正常,因为关键检查有失败。基线照样建,它记录的是现状。接下来你有两个选择:先修关键检查的失败(推荐,它们是资损和安全问题),或者暂时把这两条用例打上 `known-issue` 标签,在门禁里排除,再开一个任务去修。千万别为了让 CI 变绿去改用例的期望值。

### 5. GitHub Actions

```yaml
# agent-60-lab/.github/workflows/agent-eval.yml
name: agent-eval

on:
  pull_request:
    paths: ["w4/**", "w5/**", "pyproject.toml", "uv.lock"]
  schedule:
    - cron: "0 18 * * *"        # UTC 18:00 = 北京时间凌晨 2 点,跑完整版
  workflow_dispatch:

concurrency:
  group: agent-eval-${{ github.ref }}
  cancel-in-progress: true       # 同一分支连推几次,只跑最后一次,省钱

permissions:
  contents: read
  pull-requests: write           # 要在 PR 下评论

jobs:
  eval:
    runs-on: ubuntu-latest
    timeout-minutes: 40
    env:
      LLM_BASE_URL: ${{ vars.LLM_BASE_URL }}
      LLM_MODEL: ${{ vars.LLM_MODEL }}
      LLM_API_KEY: ${{ secrets.LLM_API_KEY }}
      JUDGE_BASE_URL: ${{ vars.JUDGE_BASE_URL }}
      JUDGE_MODEL: ${{ vars.JUDGE_MODEL }}
      JUDGE_API_KEY: ${{ secrets.JUDGE_API_KEY }}
      PRICE_IN_PER_M: ${{ vars.PRICE_IN_PER_M }}
      PRICE_OUT_PER_M: ${{ vars.PRICE_OUT_PER_M }}
      FULL: ${{ github.event_name != 'pull_request' || contains(github.event.pull_request.labels.*.name, 'full-eval') }}
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0             # git_rev 要用历史
      - uses: astral-sh/setup-uv@v10.3.0
      - run: uv sync --frozen
      - run: uv run python w4/cloudledger/seed.py
      - name: 单元测试(检查和门禁本身)
        run: uv run pytest w5/tests -q
      - name: 评测
        run: |
          if [ "$FULL" = "true" ]; then
            uv run python -m w5.evaluate --split dev --trials 3 --judge --gate
          else
            uv run python -m w5.evaluate --split dev --trials 2 --gate
          fi
      - name: 上传报告
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: eval-report
          path: w5/reports/
      - name: 评论到 PR
        if: always() && github.event_name == 'pull_request'
        uses: actions/github-script@v9
        with:
          script: |
            const fs = require('fs');
            const body = fs.existsSync('w5/reports/latest.md')
              ? fs.readFileSync('w5/reports/latest.md', 'utf8')
              : '评测没有产出报告,请看 Actions 日志。';
            await github.rest.issues.createComment({
              owner: context.repo.owner, repo: context.repo.repo,
              issue_number: context.issue.number, body,
            });
```

几个决定的理由:

PR 跑快速版,每晚跑完整版。 快速版只有 L1 和轨迹检查,trials=2,不调评分器;完整版加评分器,trials=3。给 PR 打上 `full-eval` 标签也会跑完整版,适合改动比较大的时候手动触发。算一下成本:dev 集 50 条 × 2 次 = 100 次 Agent 运行,按 Day 29 估的每次约 6,000 输入 token、300 输出 token,总共 60 万输入、3 万输出,按国内主流模型的价格量级大约一两元;完整版再加 150 次评分器调用,也就多一两元。每晚一次,一个月一百元以内。你可以根据自己的预算调。

`concurrency` 加 `cancel-in-progress`。 改 prompt 的时候人经常连推好几次,每次推都跑一遍评测既浪费钱又排队。只保留最后一次。

`paths` 过滤。 只改了 README 不用跑评测。

评分器的 key 和 Agent 的 key 分开配。 Day 32 讲过评分器最好用另一家的模型,这里就是落地的地方。

留出集(test split)不在 CI 里跑。 Day 31 说过,test 集平时不看,只在大版本前手动跑一次。放进 CI 等于每天都在看它,迟早会对它过拟合。

两个现实问题。 一是从 fork 仓库发来的 PR,GitHub 默认不会把 secrets 给它的工作流,评测会因为没有 API key 而失败。个人项目无所谓,团队项目要么只允许内部分支发 PR,要么用 `pull_request_target` 并且非常小心(它会用你的 secrets 跑别人的代码,有安全风险,我不推荐新手用)。二是如果你在国内用 GitLab 或 Gitee,思路完全一样:GitLab CI 用 `rules: changes` 做路径过滤、用 CI/CD Variables 存 key、用 `artifacts` 存报告;评论到合并请求可以调 GitLab API。

### 6. 日常怎么用

- 改 prompt、换模型、改工具之前,先确认本地 `evaluate --split dev` 是绿的。
- 发 PR,看评论里的报告。重点看「新挂了」和「新修好」两行,而不是总分。
- 报告里新挂的用例,点开对应的 trace(Day 34)看原因,判断是真退化还是随机波动。随机波动的话,在评论里说明,重跑一次。
- 确认改动是好的、合并之后,在 main 上跑一次 `--update-baseline` 并提交新基线。基线只在 main 上更新,不要在功能分支上更新,否则基线会被各个分支的改动互相覆盖。
- 每周把线上点踩的 trace 拿来做错误分析(Day 30),新失败变成新用例(Day 31),测试集慢慢长大。

关于不稳定的用例。 用了一段时间你会发现,有几条用例时过时不过,和你的改动没关系。处理办法:先读 trace 确认原因,如果是用例本身有歧义(期望值有争议),改用例并在提交信息里写清楚;如果是 Agent 在这类输入上确实不稳定,它就是一个真问题,打上 `flaky` 标签,在门禁里只统计不拦截,同时开任务去修。不要直接删掉。

## W5 高频面试题

这一周的内容在面试里出现频率很高。下面十道题,先自己口头答一遍,再对照要点。

1. 你怎么评估一个 Agent?评测分哪几层?各自检查什么?
2. 什么是 pass@k 和 pass^k?客服场景该看哪个?举例算一下。
3. 你的测试集是怎么构建的?期望值怎么保证正确?
4. LLM-as-judge 有什么问题?怎么保证它可靠?TPR、TNR、kappa 分别是什么?
5. 结果评测和轨迹评测有什么区别?轨迹评测要注意什么?
6. 多轮对话的 Agent 怎么评估?用户模拟器有什么坑?
7. 50 条用例的测试集,通过率从 85% 涨到 90%,能说明变好了吗?
8. 你的 Agent 上线后怎么监控?OpenTelemetry 的 GenAI 语义约定里,一次模型调用的 span 要记录哪些信息?
9. 评测怎么接入 CI?门禁规则怎么定才不会天天误报?
10. 讲一次你通过评测发现并修复问题的经历。

<details><summary>答题要点</summary>

1. 三层:代码断言(分类、工具调用、数据库终态、越权、格式),LLM 评分器(要点覆盖、有依据、是否答全),人工(错误分析、标注、校准评分器)。能用代码判断的不用模型。再加离线评测和线上评测的区分、能力评测和回归评测的区分。
2. pass@k 是 k 次至少一次成功,pass^k 是 k 次全部成功。客服看 pass^k,因为每个客户只遇到一次。单次 0.9 时 pass^3 = 0.729。
3. 来源:错误分析中的失败、两步法合成(维度组合 → 自然语言)、手写边界和对抗用例、线上样本。期望值能算的用判题器从业务数据和规则里算,其余由业务专家确认,合成后人工审;分开发集和留出集;git 版本化。
4. 问题:位置偏差、冗长偏差、自我偏好、宽松;评分本身也会错。做法:二元判断加 critique,一个评分器只判一件事,用人工标注对齐(train/dev/test 三分),在 test 上报告 TPR、TNR、kappa,用不同厂商模型,版本化,变更后重新对齐。TPR 是人判 pass 中评分器也判 pass 的比例,TNR 是人判 fail 中评分器也判 fail 的比例,kappa 是扣除随机一致后的一致性。
5. 结果评测看任务是否完成、终态是否正确;轨迹评测看过程:顺序约束、越权、重复调用、参数、预算。轨迹只写「必须」和「禁止」,不写标准路径,避免惩罚合理的不同路径。
6. 用 LLM 扮演用户,给人设、目标、被问时才说的信息;用环境终态判定成功(参考 τ-bench);多跑几次看 pass^k。坑:模拟器太配合、提前结束、角色错乱、编造信息,前几轮必须人工读对话。
7. 不能。50 条在 85% 附近的 95% 置信区间约 ±10%。应该看配对比较:哪些用例新通过、哪些新失败;或者扩大测试集。
8. trace 覆盖 API、工作流、模型调用、工具调用;模型调用 span 名 `chat {model}`,记录 operation name、provider name、request/response model、输入输出 token、finish reasons、错误类型;token 和耗时做成低基数指标;原文默认不采集,需要时脱敏。
9. PR 跑快速版(L1 + 轨迹,少量 trials),定时跑完整版(加评分器);关键检查零容忍,其余按「基线中通过的用例新挂超过阈值」和「总分下降超过阈值」拦截;门禁逻辑写单元测试;基线只在主干更新;不稳定用例打标签单独处理。
10. 用你这周的真实经历:比如错误分析发现「重复扣款」类工单 Agent 不查证就提交退款,写成用例(判题器算出应为不退),当前版本失败,改了 prompt 和工具描述,用例通过、没有其他用例新挂,门禁通过。说出具体数字。

</details>

## 本周坑清单

| 坑 | 症状 | 怎么办 |
| --- | --- | --- |
| MCP 子进程看不到环境变量 | 所有用例共享种子库,退款记录互相污染 | `StdioServerParameters(env=...)` 显式传(Day 29) |
| 线程池并发改环境变量 | 偶发地查到别的用例的数据 | 用进程池(今天) |
| 期望值靠人算或让模型写 | Agent 做对了被判错 | 判题器从数据和规则算(Day 31) |
| 合成数据不审 | 一两成题目本身有问题 | 合成后人工过一遍(Day 31) |
| 50 条用例看总分 | 随机波动被当成改进 | 看新挂/新修好(Day 31、今天) |
| 评分器 prompt 用 `str.format` | 例子里的 JSON 花括号报 KeyError | 写成 `{{ }}`(Day 32) |
| 只看评分器准确率 | 永远判 pass 的评分器也能 90% | 看 TPR、TNR(Day 32) |
| few-shot 从 dev/test 里挑 | 对齐分数虚高 | 只从 train 挑(Day 32) |
| 轨迹写成 strict 匹配 | 合理的不同路径被判失败 | 只写必须和禁止(Day 33) |
| 模拟客户太配合 | 测不出追问能力 | 「被问时才说」(Day 33) |
| Langfuse 脚本没 flush | 界面空白 | 结束前 `flush()`(Day 34) |
| 回调和 OTel 自动埋点都开 | token 和费用算两遍 | 只留一套(Day 34) |
| 门禁函数没测试 | CI 永远是绿的 | `test_gate.py`(今天) |
| 在功能分支更新基线 | 基线被来回覆盖 | 只在 main 上更新 |
| 为了变绿改期望值 | 测试集失去意义 | 改期望必须写原因并评审 |

## 动手练习

1. 按上面的目录结构整理 `w5/`,写好 `checks.py`、`gate.py`、`evaluate.py`、`test_gate.py`。`uv run pytest w5/tests -q` 全绿。
2. 跑完整版并建立基线,提交 `baseline.json`。
3. 修掉至少一个关键检查的失败,重新跑,看报告里「新修好」那一行出现了它。
4. 故意改坏一处:比如把 W4 起草 prompt 里关于「月付不退」的说明删掉。跑快速版,确认门禁拦住了,报告里能看到哪些用例新挂了。改回来。
5. 把仓库推到 GitHub,在仓库设置里配好 Variables 和 Secrets,建一个改了 W4 prompt 的 PR,看 Actions 跑起来,PR 下面出现评测报告评论。
6. 在 `notes.md` 写一段本周总结:测试集规模和构成、基线分数、评分器的 TPR/TNR、你修好的最重要的一个问题。这段话以后几乎可以原样放进简历的项目描述里。

### 验收标准

- `uv run python -m w5.evaluate --split dev --trials 2 --gate` 在本地能跑完并给出报告,退出码与门禁结果一致。
- `test_gate.py` 至少 5 个测试,全部通过。
- GitHub 上有一个 PR,下面有自动生成的评测报告评论。
- 「故意改坏」实验里门禁成功拦截,并且你能从报告直接定位到出问题的用例。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 回归门禁 regression gate | CI 中根据评测结果决定是否允许合并的检查 |
| 基线 baseline | 作为比较对象的一次评测结果,通常来自主干的最新版本 |
| 关键 grader | 任何一次失败都直接拦截的检查,通常涉及资损和安全 |
| 新挂 / 新修好 | 相对基线,从通过变失败 / 从失败变通过的用例 |
| 快速版 / 完整版 | 只跑确定性检查的轻量评测 / 加上 LLM 评分器、更多 trials 的评测 |
| 不稳定用例 flaky case | 结果随机波动、与代码改动无关的用例 |
| ProcessPoolExecutor | Python 标准库的进程池,每个子进程环境独立 |
| GitHub Actions | GitHub 内置的 CI/CD 服务,用 YAML 定义工作流 |
| Variables / Secrets | GitHub Actions 中存放配置 / 敏感信息(如 API key)的地方 |
| concurrency | GitHub Actions 中限制同一分组同时运行的配置,可取消旧的运行 |

## 常见误区

**门禁只看总分。** 总分的随机误差可能比你的改动影响还大,只看总分会频繁误报或漏报。关键检查零容忍、看新挂用例、总分兜底,三层结合。

**每次 PR 都跑完整版。** 费用和时间都不划算,大家会开始嫌 CI 慢。快速版拦确定性问题,完整版每晚跑。

**门禁误报了就调松阈值。** 先读 trace 找原因。是随机波动就重跑;是用例有歧义就改用例(写原因);是 Agent 真的不稳定,那就是一个要修的问题。一味调松,门禁很快就形同虚设。

**把留出集也放进 CI。** 每天看留出集的分数,你会不知不觉对它调参,它就不再是留出集了。

**基线建好就不管。** 每次确认是改进的合并之后,在 main 上更新基线。基线太旧,「新挂」的判断就失去意义。

**评测系统本身不测试。** 判题器、轨迹检查、门禁函数都是代码,都会有 bug,而且它们的 bug 会让你对 Agent 的判断全部失真。它们需要单元测试,而且要在 CI 里先于评测运行。

## 学习资料

### 文档与文章

- [GitHub Actions 文档](https://docs.github.com/en/actions):重点看 workflow 语法里的 `on.pull_request.paths`、`concurrency`、`permissions`、Variables 和 Secrets 几节,1 小时。
- [Hamel Husain & Shreya Shankar · AI Evals FAQ](https://hamel.dev/blog/posts/evals-faq/):搜 CI 和 regression,看他们怎么建议把评测放进开发流程。
- [Anthropic · Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):周末把全文再读一遍,这一周的大部分概念你现在都有了亲手做过的体会,会读出很多第一次没注意到的东西。
- [Eugene Yan · An LLM-as-Judge Won't Save The Product—Fixing Your Process Will](https://eugeneyan.com/writing/eval-process/):讲评测是一个持续的流程,和今天「日常怎么用」一节呼应。
- [pytest 文档](https://docs.pytest.org/en/stable/):fixture 和参数化两节,写评测相关的单元测试会用到。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1B8a96PEf6&autoplay=0&high_quality=1" title="Agent 系统设计 05:用 Langfuse 搭建 AI Coding 评测与改进闭环" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>桃子可冰乐 · Agent 系统设计 05:用 Langfuse 搭建 AI Coding 评测与改进闭环 · 18 分钟,讲怎么把评测和 tracing 串成一个改进闭环,和今天的知识地图是同一个思路。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1VL3F6pE9K&autoplay=0&high_quality=1" title="0基础入门智能体agent测试:AI测试基础+AI智能体(Agent)测试从零入门全攻略" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>黑马测试 · 0基础入门智能体agent测试:AI测试基础+AI智能体(Agent)测试从零入门全攻略,2026最新版! · 200 P 的长合集,从测试工程师的视角讲 Agent 测试。不用全看,挑讲测试用例设计和自动化的几 P,看看测试岗是怎么理解 Agent 评测的,面试时两种视角都能聊。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/a3SMraZWNNs" title="How to Systematically Setup LLM Evals (Metrics, Unit Tests, LLM-as-a-Judge)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Dave Ebbelaar · How to Systematically Setup LLM Evals (Metrics, Unit Tests, LLM-as-a-Judge) · 55 分钟,从工程实践的角度把指标、单元测试和评分器组织成一套系统,适合作为本周复习。</figcaption>
</figure>

- Hamel Husain《How To Turn Evals Into A Better Model》(YouTube ID `P7os3s-HMAw`,36 分钟):讲评测建好之后怎么用它持续改进,接下来 W7–8 毕业项目迭代时会用到这个思路。
- Peter Yang《How to Build Better AI Evals with Claude Code in 5 Steps | Shreya & Hamel》(YouTube ID `bdMHQLvtVaQ`,54 分钟):两位作者演示用 Coding Agent 辅助搭评测,今天写代码时可以参考他们的分工方式:人定标准,Agent 写样板代码。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 3、4 章:这周断断续续读过,周末从头到尾连起来读一遍,约 3 小时。
- Shreya Shankar、Hamel Husain《Evals for AI Engineers》(O'Reilly,2026):如果能拿到,作为这一周的总复习读物。

### 开源项目与代码

- [confident-ai/deepeval](https://github.com/confident-ai/deepeval):pytest 风格的 LLM 评测框架,和我们自己写的 `evaluate.py` 对比,看看框架帮你省掉了什么、又隐藏了什么。
- [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo):用 YAML 配置写评测,自带 GitHub Action 和 PR 评论,是今天 CI 方案的一个现成替代品。
- [langfuse/langfuse](https://github.com/langfuse/langfuse):Langfuse 的数据集和实验功能可以替代我们的部分报告逻辑,团队协作时更方便。

## 自测

1. 为什么并发评测要用进程池而不是线程池?

<details><summary>答案</summary>

adapter 通过环境变量 `CLOUDLEDGER_DB` 告诉 W4 用哪个临时数据库,而环境变量是进程级共享的。线程池里多个线程同时改它,会让一条用例的工具调用连到另一条用例的数据库上。进程池里每个子进程有独立的环境变量,互不影响。

</details>

2. 门禁的三层规则分别是什么?为什么关键检查是零容忍,而总分要留 5 个百分点的余量?

<details><summary>答案</summary>

一,关键 grader(越权、错误退款、崩溃)任何一次失败就拦;二,基线中通过的用例新挂超过阈值(1 条或 5% 取大)就拦;三,单次通过率比基线低 5 个百分点以上就拦。关键检查是确定性代码、后果严重,不存在随机误判,所以零容忍;总分受随机性影响大,小测试集上误差可能有 ±10%,阈值太紧会天天误报。

</details>

3. PR 上的评测报告显示「新挂了:syn-cancel-007」,其他都正常。你会怎么处理?

<details><summary>答案</summary>

先打开这条用例对应的 trace,看失败的 grader 和原因。如果和这次改动相关(比如改了退款相关的 prompt),就是真退化,修改后再跑;如果看起来和改动无关,可能是随机波动,重跑一次确认;如果反复时过时不过,打上 flaky 标签并开任务调查。不应该直接改期望值或删用例让它变绿。

</details>

4. 为什么基线只能在 main 上更新?

<details><summary>答案</summary>

基线代表「当前已接受的版本」的表现。如果在功能分支上更新,不同分支会互相覆盖基线,一个分支的退化可能被另一个分支的基线掩盖;合并后的 main 上也会出现基线和代码不对应的情况。

</details>

5. 为什么留出集不放进 CI?

<details><summary>答案</summary>

CI 每天都会运行,结果大家天天看,迟早会针对它调 prompt,留出集就变成了另一个开发集,失去了检验过拟合的作用。留出集只在大版本发布前手动跑一次。

</details>

6. (面试题)「你们的 Agent 评测是怎么接入研发流程的?」

<details><summary>答案</summary>

要点:评测代码和 Agent 代码在同一个仓库,测试集和基线 git 版本化;合并请求只要改到 Agent、prompt 或评测相关文件就自动触发快速评测(确定性检查,两次 trials),结果自动评论到合并请求;每晚和打标签时跑完整评测(加上对齐过的 LLM 评分器、三次 trials);门禁规则是关键检查零容忍、基线通过用例新挂超过阈值拦截、总分下降超过阈值拦截;门禁和检查逻辑本身有单元测试;基线只在主干更新;线上点踩和失败 trace 每周做错误分析,补充成新用例。可以补充成本:每次快速评测大约几元钱,每月评测预算多少。

</details>

## 明天预告

Day 36 · 把 Agent 做成服务:FastAPI、SSE 流式接口、会话管理。W5 结束了,你的工单 Agent 现在有了测试集、评分器、轨迹检查、tracing 和 CI 门禁。从明天开始的 W6 是生产化:先把它从一个命令行脚本变成一个能被前端和其他系统调用的 HTTP 服务,用 SSE 把模型输出和工具调用事件实时推给前端,把会话存起来,响应里带上 trace_id,让 Day 34 的用户反馈能接得上。
