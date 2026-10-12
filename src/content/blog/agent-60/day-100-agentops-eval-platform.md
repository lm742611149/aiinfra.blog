---
title: 'Day 100 · AgentOps(四):评测平台与线上实验'
description: '「新 prompt 通过率从 82% 涨到 86%」这句话,在 50 条用例上几乎没有意义。今天把评测做成平台服务:结果按用例落库,两个版本做配对比较,给出 McNemar 检验和成本差的置信区间;再加一个按客户稳定分流的 A/B 实验,让改动先在 10% 的流量上跑。'
pubDate: 2026-10-12
regime: none
tags: ['agentops', 'evals', 'statistics', 'ab-testing', 'mcnemar', 'agent-60']
series: 'agent-60'
day: 100
lang: 'zh'
---

## 今天要解决的问题

第 100 天。基础篇的 W5 教了怎么建测试集、怎么写 judge、怎么评轨迹,进阶篇的 W11 讲了评测里的统计学和线上实验。今天把这些做成 AgentOps 的第四个子系统,让每个租户都不用自己再写一遍。

先说一个我在实际项目里见过很多次的场景。有人改了 prompt,跑了一遍 50 条用例,通过率从 41 条变成 43 条,于是在群里说「新版本提升了 4 个点」,当天就上线了。一周后发现转人工率反而升了。回头看,那 2 条的差异完全在噪声范围内,而且新版本修好了 4 条、弄坏了 2 条,弄坏的那 2 条恰好是高频场景。

平台要做的,就是让这种判断变得困难:比较两个版本时,平台给出的不是两个平均分,而是「配对后有几条变好、几条变差、这个差异是不是噪声、变差的是哪几条」。学完以后你应该能:

1. 实现评测结果按用例落库,并用数据集指纹防止跨数据集比较。
2. 算出通过率的 Wilson 置信区间,解释它为什么比教科书上的正态近似靠谱。
3. 用 McNemar 精确检验比较两个版本,说清楚为什么只看不一致的用例。
4. 用配对 bootstrap 给成本、延迟这类连续指标的差值算置信区间。
5. 估算一个评测集能检测出多大的差异,判断「用例够不够」。
6. 实现按客户稳定分桶的 A/B 分流。

预计用时 5 到 6 小时。前置:Day 29 到 35 的评测基础;Day 69 的统计检验;Day 71 的线上实验设计;Day 96 定义的 `eval_runs`、`eval_results` 两张表。

## 平台评测和自己跑脚本有什么不同

基础篇 Day 35 的评测脚本跑完打印一个分数,结果存在本地文件里。放到平台上,有三件事变得重要:

**结果要按用例存,而不是只存汇总分。** 只有按用例存,才能做配对比较(同一条用例在两个版本上的结果放在一起看),才能在分数下降时立刻知道是哪几条坏了。汇总分丢掉了几乎所有有用的信息。

**数据集要有身份。** 两轮评测用的如果不是同一份用例,分数没有可比性。最常见的「虚假提升」来源之一就是有人顺手删了几条一直失败的难用例。平台用数据集内容的哈希做指纹,指纹不同直接拒绝比较。

**比较要带统计检验。** 这是今天的重点,下面详细讲。

评测本身在哪跑?我的选择是在租户自己的 CI 里跑,用平台提供的 `run_eval` 函数,结果写进平台的库。原因是评测要调租户自己的 Agent 代码,把租户代码搬到平台进程里执行会带来隔离和依赖问题。平台提供的是记录、统计、比较和展示,执行留在租户侧。

## 数据集和指纹

```python
# agentops/src/agentops/evals/dataset.py
"""评测集:一行一个用例的 JSONL。指纹用内容哈希,用例改一个字,指纹就变,比较时不会把两个版本的集子混在一起。"""
import hashlib
import json
from pathlib import Path


def load(path: str | Path) -> list[dict]:
    rows = [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]
    ids = [r["id"] for r in rows]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate case id in dataset")
    return rows


def fingerprint(name: str, rows: list[dict]) -> str:
    h = hashlib.sha256(json.dumps(rows, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return f"{name}@{h[:8]}"
```

指纹是名字加内容哈希的前 8 位,形如 `tickets_v1@3fa9c1d2`。改了任何一条用例的任何一个字,指纹都会变。这看起来很严格,有人会抱怨「我只是改了一个错别字」,但正因为这样,任何人都无法在不被发现的情况下改动评测集。真需要更新评测集时,新旧版本各跑一遍基线,然后用新版本作为后续比较的基准。

## 三个统计工具

```python
# agentops/src/agentops/evals/stats.py
"""评测里最常用的三个统计工具,纯标准库实现,不依赖 scipy。"""
import math
import random
from math import comb


def wilson_interval(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """通过率的 95% 置信区间。样本小、通过率接近 0 或 1 时比「p ± 1.96·sqrt(p(1-p)/n)」靠谱得多。"""
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (max(0.0, center - half), min(1.0, center + half))


def mcnemar_exact(b: int, c: int) -> float:
    """配对的二元结果比较。b = A 过 B 不过的用例数,c = A 不过 B 过。只有不一致的用例携带信息。
    返回双侧精确 p 值(二项检验,H0: b 和 c 各占一半)。"""
    n = b + c
    if n == 0:
        return 1.0
    tail = sum(comb(n, i) for i in range(min(b, c) + 1)) / 2 ** n
    return min(1.0, 2 * tail)


def paired_bootstrap(a: list[float], b: list[float], iters: int = 5000, seed: int = 0) -> tuple[float, float, float]:
    """配对差值(b - a)的均值和 95% 置信区间。用于连续分数,比如 judge 打的 0–1 分、成本、延迟。"""
    if len(a) != len(b) or not a:
        raise ValueError("need two equal-length, non-empty lists")
    diffs = [y - x for x, y in zip(a, b, strict=True)]
    rng = random.Random(seed)
    n = len(diffs)
    means = sorted(sum(rng.choice(diffs) for _ in range(n)) / n for _ in range(iters))
    return (sum(diffs) / n, means[int(0.025 * iters)], means[int(0.975 * iters) - 1])


def min_detectable_diff(n: int, p: float = 0.85, z_alpha: float = 1.96, z_beta: float = 0.84) -> float:
    """粗估:两个独立版本、各 n 条用例、基线通过率 p 时,80% 把握能检测出的最小差异。
    配对设计会比这个数小一些,用它做「用例集够不够大」的量级判断。"""
    return (z_alpha + z_beta) * math.sqrt(2 * p * (1 - p) / n)
```

**Wilson 区间。** 教科书上的通过率置信区间是 p 加减 1.96 乘以根号下 p(1-p)/n,这个公式在样本小、通过率接近 0 或 1 的时候会出问题,比如 50 条用例全部通过,算出来的区间是 [1, 1],好像完全确定;而实际上真实通过率完全可能只有 93%。Wilson 区间在这些情况下表现好得多。手算一遍 45/50:

p = 0.9,z² = 3.8416,分母 1 + 3.8416/50 = 1.0768;中心 (0.9 + 3.8416/100) / 1.0768 = 0.8715;半宽 1.96 × √(0.9 × 0.1/50 + 3.8416/10000) / 1.0768 = 1.96 × √0.002184 / 1.0768 ≈ 0.0851。区间约为 [0.786, 0.957]。

也就是说,50 条用例上 90% 的通过率,真实值可能在 79% 到 96% 之间。这一个数字就足够让人对「提升了 4 个点」保持警惕。

**McNemar 检验。** 比较两个版本时,最自然的做法是把两个通过率当成两个独立样本比较。但它们不是独立的:同一条用例,难的在两个版本上都难,容易的在两个版本上都容易。配对检验利用了这一点。

把每条用例按两个版本的结果分成四类:都通过、都不通过、A 过 B 不过(变差)、A 不过 B 过(变好)。前两类不携带任何关于「哪个版本更好」的信息。只看后两类,如果两个版本其实一样好,变好和变差的用例数应该差不多,各占一半,这就是一个二项分布。McNemar 精确检验算的就是:在各占一半的假设下,观察到这么不平衡的分布的概率。

手算一个例子:12 条不一致的用例里 10 条变好、2 条变差。在 n = 12、p = 0.5 的二项分布里,出现 2 条或更少「变差」的概率是 (C(12,0) + C(12,1) + C(12,2)) / 2¹² = (1 + 12 + 66) / 4096 = 0.0193,双侧乘以 2,p 约等于 0.0386。小于 0.05,可以说新版本更好。

如果是 5 条变好、5 条变差,p 值是 1。哪怕总通过率完全一样,这两个版本也可能在完全不同的用例上失败,对用户的影响可能天差地别。这就是为什么平台的比较结果里一定要列出 `regressed_cases`。

**配对 bootstrap。** 成本、延迟、judge 打的连续分数,用 bootstrap:对每条用例算差值,有放回地重抽样很多次,看差值均值的分布。不需要任何分布假设,实现只有几行。

**最小可检测差异。** 这个函数回答「我的评测集够不够大」。基线通过率 85%、每个版本 50 条用例,80% 的把握能检测出的最小差异大约是 20 个百分点;要检测 5 个百分点的差异,需要上千条用例。配对设计会好一些,但量级就是这样。所以当你只有 50 条用例时,能做的结论是「没有明显变差」,而不是「提升了 4 个点」。这个现实很残酷,但面试时能说出这句话的人不多。

## 评测运行器和比较

```python
# agentops/src/agentops/evals/runner.py
"""跑评测、落库、比较。agent_fn 和 check_fn 由租户提供,平台只管调度、记录和统计。"""
import asyncio
import secrets
import time
from collections.abc import Awaitable, Callable

from sqlalchemy import insert, select
from sqlalchemy.engine import Engine

from agentops.db import eval_results, eval_runs
from agentops.evals.stats import mcnemar_exact, paired_bootstrap, wilson_interval

AgentFn = Callable[[dict], Awaitable[dict]]            # 用例 → 输出(含 cost_cny)
CheckFn = Callable[[dict, dict], Awaitable[dict]]      # (用例, 输出) → {"passed": bool, "scores": {...}}


async def run_eval(engine: Engine, tenant_id: str, dataset_id: str, variant: str, cases: list[dict],
                   agent_fn: AgentFn, check_fn: CheckFn, concurrency: int = 4) -> str:
    sem = asyncio.Semaphore(concurrency)               # 别让评测把网关的租户限流打满

    async def one(case: dict) -> dict:
        async with sem:
            t0 = time.perf_counter()
            try:
                out = await agent_fn(case)
                verdict = await check_fn(case, out)
            except Exception as e:  # noqa: BLE001 一条用例崩了不能让整轮评测作废
                out, verdict = {}, {"passed": False, "scores": {"error": type(e).__name__}}
            return {"case_id": case["id"], "passed": bool(verdict["passed"]), "scores": verdict.get("scores", {}),
                    "cost_cny": float(out.get("cost_cny", 0.0)),
                    "latency_ms": int((time.perf_counter() - t0) * 1000)}

    results = await asyncio.gather(*(one(c) for c in cases))
    k, n = sum(r["passed"] for r in results), len(results)
    lo, hi = wilson_interval(k, n)
    lat = sorted(r["latency_ms"] for r in results)
    summary = {"n": n, "passed": k, "pass_rate": k / n if n else 0.0, "ci95": [lo, hi],
               "avg_cost_cny": sum(r["cost_cny"] for r in results) / n if n else 0.0,
               "p95_latency_ms": lat[max(0, int(0.95 * n) - 1)] if n else 0}
    rid = "ev_" + secrets.token_hex(6)
    with engine.begin() as c:
        c.execute(insert(eval_runs).values(id=rid, tenant_id=tenant_id, dataset=dataset_id, variant=variant,
                                           summary=summary))
        c.execute(insert(eval_results), [{"eval_run_id": rid, **r} for r in results])
    return rid


def load_run(engine: Engine, run_id: str, tenant_id: str) -> tuple[dict, dict[str, dict]] | None:
    with engine.connect() as c:
        run = c.execute(select(eval_runs).where(eval_runs.c.id == run_id, eval_runs.c.tenant_id == tenant_id)
                        ).mappings().first()
        if run is None:
            return None
        rows = c.execute(select(eval_results).where(eval_results.c.eval_run_id == run_id)).mappings().all()
    return dict(run), {r["case_id"]: dict(r) for r in rows}


def compare(engine: Engine, tenant_id: str, a_id: str, b_id: str) -> dict:
    a, b = load_run(engine, a_id, tenant_id), load_run(engine, b_id, tenant_id)
    if a is None or b is None:
        raise KeyError("eval run not found")
    (ra, ca), (rb, cb) = a, b
    if ra["dataset"] != rb["dataset"]:
        # 不同评测集上的分数不能直接比,这是最常见的「改进」幻觉来源
        raise ValueError(f"dataset mismatch: {ra['dataset']} vs {rb['dataset']}")
    ids = sorted(set(ca) & set(cb))
    b_only = sum(1 for i in ids if ca[i]["passed"] and not cb[i]["passed"])     # 变差的
    c_only = sum(1 for i in ids if not ca[i]["passed"] and cb[i]["passed"])     # 变好的
    cost_mean, cost_lo, cost_hi = paired_bootstrap([ca[i]["cost_cny"] for i in ids], [cb[i]["cost_cny"] for i in ids])
    return {
        "n_paired": len(ids),
        "pass_rate": {"a": ra["summary"]["pass_rate"], "b": rb["summary"]["pass_rate"]},
        "regressed": b_only, "improved": c_only,
        "mcnemar_p": mcnemar_exact(b_only, c_only),
        "cost_diff_cny": {"mean": cost_mean, "ci95": [cost_lo, cost_hi]},
        "regressed_cases": [i for i in ids if ca[i]["passed"] and not cb[i]["passed"]][:20],
    }
```

几个工程细节:

**并发要有上限。** 评测会对每条用例调一次 Agent,Agent 又会调网关。一百条用例同时打过去,会把租户自己在网关的限流配额打满,评测反而变慢、出一堆 429。默认并发 4,可调。

**单条用例出错不能让整轮作废。** 某条用例触发了 Agent 的 bug 抛了异常,记为不通过、记下异常类型,继续跑其他用例。评测是为了发现问题的,不能因为发现了问题就停下来。

**比较时先检查数据集。** 指纹不同直接拒绝,接口返回 409。

**汇总里带 P95 延迟和平均成本。** 质量提升了但成本翻倍,也是需要知道的。

API 只做查询和比较:

```python
# agentops/src/agentops/evals/app.py
"""评测接口:查一轮结果、比较两轮。跑评测在租户自己的 CI 里(runner.run_eval),结果写到同一个库。"""
from fastapi import APIRouter, Depends, HTTPException, Request

from agentops.deps import tenant
from agentops.evals.runner import compare, load_run
from agentops.tenancy.keys import TenantContext

router = APIRouter()


@router.get("/evals/runs/{run_id}")
def get_eval_run(run_id: str, request: Request, ctx: TenantContext = Depends(tenant("evals"))) -> dict:
    found = load_run(request.app.state.engine, run_id, ctx.tenant_id)
    if found is None:
        raise HTTPException(404, "eval run not found")
    run, results = found
    return run | {"failed_cases": sorted(i for i, r in results.items() if not r["passed"])}


@router.get("/evals/compare")
def compare_runs(a: str, b: str, request: Request, ctx: TenantContext = Depends(tenant("evals"))) -> dict:
    try:
        return compare(request.app.state.engine, ctx.tenant_id, a, b)
    except KeyError as e:
        raise HTTPException(404, str(e)) from e
    except ValueError as e:
        raise HTTPException(409, str(e)) from e
```

在 `main.py` 里挂上:

```python
    from agentops.evals.app import router as evals_router   # Day 100
    app.include_router(evals_router)
```

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="配对比较:60 条用例按两个版本的结果分为四类,只有不一致的 9 条进入 McNemar 检验">
  <g font-family="var(--font-mono)" font-size="12">
    <text x="10" y="24" fill="var(--ink)">60 条用例,prompt_v3 对 prompt_v4</text>
    <rect x="10" y="40" width="310" height="70" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="165" y="70" text-anchor="middle" fill="var(--ink)">两版都通过 49 条</text>
    <text x="165" y="92" text-anchor="middle" font-size="11" fill="var(--ink-faint)">不携带比较信息</text>
    <rect x="10" y="120" width="310" height="50" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="165" y="150" text-anchor="middle" fill="var(--ink)">两版都失败 2 条</text>
    <rect x="340" y="40" width="290" height="60" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="485" y="66" text-anchor="middle" fill="var(--ink)">变好 8 条</text>
    <text x="485" y="86" text-anchor="middle" font-size="11" fill="var(--ink-soft)">v3 失败 → v4 通过</text>
    <rect x="340" y="110" width="290" height="60" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="485" y="136" text-anchor="middle" fill="var(--ink)">变差 1 条(c040)</text>
    <text x="485" y="156" text-anchor="middle" font-size="11" fill="var(--ink-soft)">v3 通过 → v4 失败</text>
    <text x="340" y="200" font-size="11" fill="var(--ink)">McNemar 只看这 9 条:p = 2 × (1 + 9) / 2⁹ ≈ 0.039</text>
    <text x="340" y="220" font-size="11" fill="var(--ink-faint)">变差的那条要单独看,是不是高频场景</text>
  </g>
</svg>
<figcaption>平均分的比较是 50/60 对 57/60。配对比较告诉你更多:哪几条变了、方向是什么、差异是不是噪声。</figcaption>
</figure>

## A/B 分流

离线评测再好,也替代不了线上数据。线上实验的第一步是分流:

```python
# agentops/src/agentops/evals/experiments.py
"""线上 A/B 分流:按单位(客户、会话)稳定分桶。同一个客户永远落在同一组,不会今天 A 明天 B。"""
import hashlib
from dataclasses import dataclass


@dataclass(frozen=True)
class Experiment:
    name: str                       # 实验名参与哈希,不同实验的分组互相独立
    variants: tuple[tuple[str, int], ...]   # (组名, 权重),如 (("control", 90), ("prompt_v4", 10))
    enabled: bool = True


def bucket(unit_id: str, salt: str, buckets: int = 10_000) -> int:
    h = hashlib.sha256(f"{salt}:{unit_id}".encode()).digest()
    return int.from_bytes(h[:8], "big") % buckets


def assign(exp: Experiment, unit_id: str) -> str:
    if not exp.enabled:
        return exp.variants[0][0]   # 关掉实验 = 全部回到第一组(对照组)
    total = sum(w for _, w in exp.variants)
    b = bucket(unit_id, exp.name) * total // 10_000
    acc = 0
    for name, w in exp.variants:
        acc += w
        if b < acc:
            return name
    return exp.variants[-1][0]
```

分流的要求有三条,每一条都对应一种常见错误:

**稳定。** 同一个客户在实验期间永远落在同一组。如果每次请求随机分组,同一个客户今天看到新版本的回复、明天看到旧版本,不但体验混乱,实验也测不准(客户对新版本的反应会被旧版本的体验干扰)。所以用客户 ID 做哈希,而不是用随机数。

**实验之间独立。** 实验名参与哈希,两个同时进行的实验各自分组,不会出现「实验 A 的处理组恰好全是实验 B 的处理组」这种混淆。

**能一键关掉。** `enabled=False` 时全部回到第一组(对照组)。实验期间如果发现新版本出问题,改一个开关就回滚,不用重新部署。

分流单位的选择很关键。客服场景我选客户 ID,因为一个客户的多张工单之间有关联(同一个账户问题可能分几次问);如果选工单 ID,同一个客户的不同工单会落在不同组,结果互相污染。代价是客户数量比工单少,样本量小,实验需要跑更久。

把分流结果用起来:SupportPilot 处理工单时,用 `assign(exp, customer_id)` 决定用哪个 prompt 版本,把版本名作为 `X-AgentOps-Feature` 的后缀报给网关(比如 `ticket.draft:prompt_v4`),这样 Day 97 的 `usage` 表天然按实验组拆分了成本,Day 102 的看板可以直接按组对比转人工率、重问率和成本。

## 测试

```python
# agentops/tests/test_evals.py
from collections import Counter

import pytest
from fastapi.testclient import TestClient

from agentops.config import Settings
from agentops.evals.dataset import fingerprint
from agentops.evals.experiments import Experiment, assign
from agentops.evals.runner import run_eval
from agentops.evals.stats import mcnemar_exact, min_detectable_diff, paired_bootstrap, wilson_interval
from agentops.main import create_app
from agentops.tenancy.keys import issue_key
from tests.conftest import PEPPER

CASES = [{"id": f"c{i:03d}", "q": f"工单 {i}"} for i in range(60)]


def test_wilson_matches_hand_calculation():
    lo, hi = wilson_interval(45, 50)
    assert lo == pytest.approx(0.7864, abs=1e-3) and hi == pytest.approx(0.9565, abs=1e-3)


def test_mcnemar_exact():
    # 12 条不一致的用例里 10 条变好 2 条变差:2 × (1 + 12 + 66) / 4096 ≈ 0.0386
    assert mcnemar_exact(2, 10) == pytest.approx(0.03857, abs=1e-4)
    assert mcnemar_exact(5, 5) == 1.0


def test_bootstrap_ci_contains_true_diff():
    a = [0.010] * 50
    b = [0.008] * 25 + [0.009] * 25
    mean, lo, hi = paired_bootstrap(a, b)
    assert mean == pytest.approx(-0.0015) and lo <= mean <= hi < 0


def test_min_detectable_diff_is_large_for_small_sets():
    assert min_detectable_diff(50) > 0.19          # 50 条用例:约 20 个百分点以下的差异测不出来
    assert min_detectable_diff(1000) < 0.05


def test_assignment_is_stable_and_respects_weights():
    exp = Experiment("prompt_v4", (("control", 90), ("prompt_v4", 10)))
    assert all(assign(exp, "C007") == assign(exp, "C007") for _ in range(5))
    share = Counter(assign(exp, f"C{i}") for i in range(20_000))["prompt_v4"] / 20_000
    assert 0.09 < share < 0.11
    assert assign(Experiment("prompt_v4", exp.variants, enabled=False), "anyone") == "control"


async def test_compare_reports_paired_test(engine, keys):
    ds = fingerprint("tickets_v1", CASES)

    def agent(fail: set[int], cost: float):
        async def fn(case):
            return {"ok": int(case["id"][1:]) not in fail, "cost_cny": cost}
        return fn

    async def check(case, out):
        return {"passed": out["ok"], "scores": {}}

    a = await run_eval(engine, "t_cloudledger", ds, "prompt_v3", CASES, agent({1, 2, 3, 4, 5, 6, 7, 8, 9, 10}, 0.03), check)
    b = await run_eval(engine, "t_cloudledger", ds, "prompt_v4", CASES, agent({1, 2, 40}, 0.02), check)
    c = TestClient(create_app(Settings(key_pepper=PEPPER), engine=engine))
    h = {"Authorization": f"Bearer {keys['cloudledger']}"}
    r = c.get(f"/evals/compare?a={a}&b={b}", headers=h).json()
    assert (r["improved"], r["regressed"]) == (8, 1)
    assert r["mcnemar_p"] == pytest.approx(0.0391, abs=1e-3)          # 2 × (1 + 9) / 512
    assert r["regressed_cases"] == ["c040"]
    assert r["cost_diff_cny"]["mean"] == pytest.approx(-0.01)
    # 别的租户(带 evals 权限)也看不到:404 而不是 403
    with engine.begin() as conn:
        acme = issue_key(conn, "t_acme", "ci", ["evals"], PEPPER)
    assert c.get(f"/evals/runs/{a}", headers={"Authorization": f"Bearer {acme}"}).status_code == 404
    assert c.get(f"/evals/runs/{a}", headers=h).status_code == 200


async def test_compare_refuses_different_datasets(engine, keys):
    async def fn(case):
        return {}

    async def check(case, out):
        return {"passed": True}

    a = await run_eval(engine, "t_cloudledger", fingerprint("tickets_v1", CASES), "x", CASES, fn, check)
    b = await run_eval(engine, "t_cloudledger", fingerprint("tickets_v1", CASES[:-1]), "y", CASES[:-1], fn, check)
    c = TestClient(create_app(Settings(key_pepper=PEPPER), engine=engine))
    assert c.get(f"/evals/compare?a={a}&b={b}", headers={"Authorization": f"Bearer {keys['cloudledger']}"}
                 ).status_code == 409
```

前四个测试验证统计函数和上面的手算一致,第五个验证分流的稳定性和比例(两万个客户里落在 10% 组的比例在 9% 到 11% 之间)。第六个是端到端:两个版本在 60 条用例上跑,v3 失败 10 条,v4 失败 3 条,配对后变好 8 条、变差 1 条(c040 在 v3 通过、在 v4 失败),McNemar 的 p 值约 0.039,成本差均值是每条少 0.01 元;别的租户就算有评测权限,查我的评测结果也是 404。第七个验证数据集不同时拒绝比较。

我本机跑全部测试的输出是 `29 passed`。到这里,AgentOps 的四个核心子系统都有了:网关 10 个测试、工具中心 5 个、运行时 4 个、评测 7 个,加上 Day 96 的 3 个。

## 把 SupportPilot 的评测迁过来

Day 50 SupportPilot 有 100 条用例和三层检查(规则断言、LLM judge、轨迹)。迁到平台只需要两步:

1. 用 `dataset.load` 读 `evals/datasets/tickets_v1.jsonl`,算指纹。
2. 把 Day 50 的 `run_eval.py` 里「对每条用例跑 Agent、跑检查」那部分包成 `agent_fn` 和 `check_fn`,交给平台的 `run_eval`。

`check_fn` 里如果用了 LLM judge,judge 的调用也要走网关,功能名报 `eval.judge`,这样评测本身花了多少钱也能在看板上看到。评测成本经常被忽略,一个用 smart 路由做 judge 的百条评测,每天在 CI 里跑十次,一个月的花费可能比线上业务还高。

## 动手练习

**步骤 1:** 写 `evals/` 下的五个文件,挂载 router,写 `tests/test_evals.py`,跑通全部 26 个测试。

**步骤 2:迁移 SupportPilot 评测。** 按上一节把 Day 50 的评测接到平台,跑当前版本作为基线。

**步骤 3:做一次真实的比较。** 改 SupportPilot 起草回复的 prompt(Day 51 的改动日志里有现成的思路),跑新版本,调 `/evals/compare`,把结果填进下表。

| 指标 | 基线 | 新版本 |
| --- | --- | --- |
| 通过率(Wilson 95% 区间) |  |  |
| 变好 / 变差 |  |  |
| McNemar p 值 |  |  |
| 每条成本差(95% 区间) |  |  |
| 变差的用例 ID |  |  |

**步骤 4:写结论。** 用一段话写你的上线建议。要求必须引用 p 值和变差的用例,并用 `min_detectable_diff` 说明这个评测集能检测的最小差异。如果结论是「证据不足」,也是合格的结论。

**步骤 5:设计一个线上实验。** 写一页实验方案:分流单位、两组比例、主要指标(比如转人工率)、护栏指标(比如成本、客户差评率)、计划跑多久、什么情况下提前停止。

**验收标准:** 26 个测试全绿;比较表填完;结论里有统计依据;实验方案五项齐全。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 数据集指纹 | 名字加内容哈希,内容变则指纹变,用于防止跨数据集比较 |
| Wilson 区间 | 二项比例的置信区间,小样本和极端比例下比正态近似可靠 |
| 配对比较 | 同一条用例在两个版本上的结果放在一起比较 |
| McNemar 检验 | 配对二元结果的检验,只用不一致的配对 |
| bootstrap | 有放回重抽样估计统计量分布的方法 |
| 最小可检测差异 | 给定样本量和把握度,能检测出的最小真实差异 |
| 分流单位 | A/B 实验中被随机分组的对象,如客户、会话 |
| 护栏指标 | 实验中不能变差的指标,变差就停止实验 |
| 对照组 / 处理组 | 用旧版本的一组 / 用新版本的一组 |

## 常见误区

**只比平均分。** 两个版本通过率一样,也可能在完全不同的用例上失败。看配对结果,看变差的是哪些。

**在小评测集上宣称几个点的提升。** 50 条用例检测不出 5 个百分点的差异。先算最小可检测差异,再决定结论怎么写。

**改了评测集还和旧分数比较。** 删掉几条难用例,分数自然上涨。指纹不同就不能比。

**每次请求随机分组。** 同一个客户在两组之间跳来跳去,体验混乱,实验结果也被污染。按单位哈希稳定分组。

**线上实验只看主要指标。** 转人工率降了,但成本涨了三倍、差评率涨了,不能算成功。实验方案里要先写好护栏指标。

**评测跑得太猛。** 并发不设上限会打满限流,还会让评测成本失控。评测本身的成本也要记账。

## 学习资料

### 文档与文章

- [Adding Error Bars to Evals](https://arxiv.org/abs/2411.00640):Evan Miller 的论文,系统讲 LLM 评测里怎么算置信区间、为什么要配对、怎么估计样本量。今天最重要的一篇,1.5 小时。Anthropic 对这篇工作的 [介绍文章](https://www.anthropic.com/research/statistical-approach-to-model-evals) 更短,可以先读。
- [How Not To Run an A/B Test](https://www.evanmiller.org/how-not-to-run-an-ab-test.html):同一作者讲 A/B 测试最常见的错误(反复偷看结果),20 分钟。他的 [样本量计算器](https://www.evanmiller.org/ab-testing/sample-size.html) 可以直接用。
- [Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/):Hamel Husain 的经典文章,基础篇读过,今天带着平台视角再读一遍。
- [McNemar's test(维基百科)](https://en.wikipedia.org/wiki/McNemar%27s_test) 和 [Binomial proportion confidence interval](https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval):公式出处,遇到疑问时查。
- [ExP Platform](https://exp-platform.com/):微软实验平台团队的论文合集,线上实验的工业实践。
- [GrowthBook 统计文档](https://docs.growthbook.io/statistics/overview):开源实验平台怎么做统计,看它对「偷看问题」的处理。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV14PtwziE6S&autoplay=0&high_quality=1" title="人话统计学概念:置信区间!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>DataCafe · 人话统计学概念:置信区间! · 5 分钟,如果你对置信区间的含义还模糊,先看这个。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1CTYkzWE3Q&autoplay=0&high_quality=1" title="8分钟弄懂AB实验" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>小生凡一 · 8分钟弄懂AB实验|AB Testing、空转、AA Testing、显著性检验、Z校验、正交实验 · 8 分钟,AA 测试和正交实验两个概念对应本篇的分流设计。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1QMTg6AE52&autoplay=0&high_quality=1" title="超细致Agent评估全流程讲解及面试真题解析" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>不转到大模型不改名 · 超细致Agent评估全流程讲解及面试真题解析 · 41 分钟,当作面试复习,看完试着补上它没讲到的统计检验部分。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/trfUBIDeI1Y" title="LLM as a Judge: Scaling AI Evaluation Strategies" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>IBM Technology · LLM as a Judge: Scaling AI Evaluation Strategies · 平台化评测里 judge 的位置和局限,英文,短。</figcaption>
</figure>

### 书籍

- **Trustworthy Online Controlled Experiments**,Ron Kohavi、Diane Tang、Ya Xu,Cambridge University Press,2020(中译本《关键迭代:可信赖的线上对照实验》,电子工业出版社)。线上实验的权威著作。读第 3 章(实验的常见陷阱)和讲分流单位、护栏指标的章节。
- **AI Engineering**,Chip Huyen,O'Reilly,2025。读第 3、4 章(评测方法和评测 AI 系统),对照今天的平台设计看哪些环节平台能自动化。

### 开源项目与代码

- [promptfoo](https://github.com/promptfoo/promptfoo):开源的评测和红队工具,看它的结果对比视图怎么展示新旧版本差异。
- [openai/evals](https://github.com/openai/evals):OpenAI 早期的评测框架,看它的 registry 怎么组织数据集。

## 自测

1. 50 条用例,基线 41 条通过,新版本 43 条通过。你会怎么在群里汇报?

<details><summary>答案</summary>

先不说「提升 4 个点」。要报:两个版本的通过率和 Wilson 区间(大约都在 ±10 个百分点的量级,高度重叠);配对后变好几条、变差几条和 McNemar p 值;变差的是哪几条、是不是高频场景。然后给结论:如果 p 值很大,结论是「没有发现明显差异,也没有发现明显退化」,是否上线取决于改动的其他收益(比如成本),并建议用线上小流量实验进一步验证。

</details>

2. McNemar 检验为什么只看不一致的用例?

<details><summary>答案</summary>

两个版本都通过或都失败的用例,对「哪个版本更好」没有提供任何信息,它们只反映用例本身的难度。只有一个版本通过、另一个失败的用例,才说明两个版本在这条用例上表现不同。如果两个版本真的一样好,这类用例里变好和变差应该各占一半,检验就是看观察到的不平衡程度在这个假设下有多罕见。

</details>

3. 用 min_detectable_diff 估算:基线通过率 85%,想以 80% 的把握检测出 5 个百分点的差异,大约需要多少条用例?

<details><summary>答案</summary>

公式 d = (1.96 + 0.84) × √(2 × 0.85 × 0.15 / n)。令 d = 0.05,解得 n = 2 × 0.1275 × (2.8 / 0.05)² = 0.255 × 3136 ≈ 800。每个版本大约 800 条(独立样本的估算,配对设计会少一些)。这个量级说明靠几十条用例做精细比较是不现实的,需要线上实验或更大的评测集。

</details>

4. 为什么 A/B 分流用客户 ID 哈希而不是随机数?为什么实验名要参与哈希?

<details><summary>答案</summary>

用客户 ID 哈希保证同一个客户在实验期间始终在同一组,体验一致,实验结果不会被跨组污染;随机数会让同一个客户在两组之间跳。实验名参与哈希,是为了让同时进行的不同实验各自独立分组,否则所有实验的处理组会是同一批客户,实验之间互相混淆,无法分辨效果来自哪个实验。

</details>

5. 资深面试题:老板问「我们的客服 Agent 新版本到底比旧版好多少」,你手上有 100 条离线用例的评测结果和两周的线上 A/B 数据,两者结论不一致:离线显示新版本更好,线上转人工率没变。你怎么解释、怎么决策?

<details><summary>答案</summary>

先排查两边的可比性:离线用例的分布是否和线上工单分布一致(离线集可能偏向难例或旧场景);线上实验的样本量是否足以检测预期的效果(先算最小可检测差异,两周可能不够);转人工率这个指标是否对新版本改进的那类问题敏感(新版本可能改进了回复质量,但转人工主要由业务规则触发)。然后给出可能的解释:离线改进集中在线上占比很小的场景;或者改进真实存在但线上样本不足以检测。决策上:如果护栏指标(成本、差评率)没有变差,可以继续扩大实验流量以获得足够样本;同时把线上转人工的工单抽样加进离线评测集,让离线集更接近线上分布。汇报时说清楚「现在能确定的」和「还不能确定的」,不要为了给出一个数字而夸大结论。

</details>

6. 资深面试题:你负责的评测平台被五个团队使用。有个团队抱怨「每次改一点 prompt 都要跑 100 条用例,太慢太贵」。你怎么设计让评测既快又可靠?

<details><summary>答案</summary>

分层评测:第一层是几十条最关键、最快的冒烟用例(规则断言为主,不用 judge),每次提交都跑,几分钟内出结果;第二层是完整评测集,合并前或每天跑一次;第三层是线上实验,上线后持续跑。在平台上提供用例分级标签,让团队标记哪些是冒烟用例。成本上:judge 用小模型并定期与人工标注校准;利用 prompt caching(评测集的系统提示每次相同,缓存命中率高);对没有改动影响到的模块,只跑相关子集(按用例的标签和改动的模块对应)。可靠性上:冒烟层只用来拦截明显退化,不用来宣称提升;所有「提升」的结论必须来自完整评测加统计检验。最后用数据说服:统计评测发现的回归次数,让团队看到评测拦住了多少问题。

</details>

## 明天预告

Day 101 · AgentOps(五):接入微调小模型做路由。把 Day 81 训练的分类小模型部署成一个 OpenAI 兼容的上游,在网关里加一条 auto 路由:简单的请求交给小模型,置信度不够时回退到大模型,用今天的评测平台对比成本和质量。
