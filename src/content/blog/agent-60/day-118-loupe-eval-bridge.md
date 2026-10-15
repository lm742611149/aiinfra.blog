---
title: 'Day 118 · Agent Loupe(七):把失败步骤变成评测用例'
description: '在 Loupe 里看到一个失败的步骤,一键存成评测用例:快照保存那一步的完整输入和原运行的工具结果,写几条断言;批量多次运行算通过率和 pass^k,把模型服务的 503 和 Agent 自己的失败分开统计;导出成 Day 35 的 golden.jsonl;改提示词前后各跑一批,用回归对比看哪些用例变差了。'
pubDate: 2026-10-15
regime: none
tags: ['agent-loupe', 'evals', 'regression', 'pass-k', 'portfolio', 'agent-60']
series: 'agent-60'
day: 118
lang: 'zh'
---

## 今天要解决的问题

到昨天为止,Loupe 已经能看、能比、能重跑。你发现第 3 步模型乱算,改了提示词,从第 3 步重跑三次,三次都好了。很好,然后呢?

然后通常是这样的:两周后有人为了另一个问题又改了提示词,第 3 步那个毛病悄悄回来了,没有人发现,直到客户投诉。Day 29 到 Day 35 讲过,防止这种事的办法是评测集和回归门禁。问题在于评测用例从哪来。凭空写的用例往往测的是你想到的情况,而真正出问题的是你没想到的。最好的用例来源,就是你在调试工具里亲眼看到的那些失败。

Hamel Husain 在他那篇被引用很多的 evals 文章里反复强调一件事:先看数据,从真实的 trace 里找出错误,再把错误变成测试。今天就把这条路在 Loupe 里打通:**看到失败 → 一键存成用例 → 批量跑 → 回归对比**。

学完你应该能:

1. 说清楚「步级用例」和「端到端用例」的区别,以及为什么用例要存快照,不能只存一个指向原运行的引用。
2. 实现用例的存储、断言评分、多次运行、通过率和 pass^k 统计。
3. 把基础设施错误(模型服务 503、限流、超时)和 Agent 的真实失败分开统计。
4. 把用例导出成 Day 35 的 `golden.jsonl` 格式,接进已有的 CI 门禁。
5. 做一个回归对比:两批结果逐条比,列出变差的用例。

预计用时 6 小时。前置:Day 35 的评测集格式和门禁,Day 69 的统计方法(只用到结论),Day 113 的 `load_trace` / `save_trace`,Day 117 的 `run_loop`、`Cassette`、`finish` 和白名单,以及 Day 117 在 `StepInspector` 里加的按钮位置。

## 两种用例:步级和端到端

Day 35 的用例是端到端的:给一张工单、一个客户 id,Agent 从头跑到尾,检查分类、有没有调该调的工具、回复里有没有该有的内容。它测的是整个系统。

从 Loupe 里存下来的用例天然是**步级**的:它从某一次运行的第 N 步开始。第 N 步之前发生的事情(用户说了什么、前面查到了什么)被冻结在快照里,只有从第 N 步往后是重新跑的。

两种用例各有用处。端到端用例覆盖面广,但慢、贵、噪声大:前面 10 步里任何一步走偏,第 14 步那个场景就根本到不了。步级用例精准:它直接把模型放到你关心的那个位置,问它「现在你会怎么做」。这和单元测试、集成测试的关系很像。一个成熟的评测集里两种都要有。

所以今天做两件事:Loupe 里原生跑步级用例;同时提供导出,把用例里的用户问题和断言转成 Day 35 的格式,放进端到端评测集。导出会丢掉快照里的中间状态,只保留最初的用户输入,这一点在导出文件里要标清楚。

## 为什么要存快照

最省事的做法是用例只存 `(run_id, step_idx)` 加断言,跑的时候去原运行里取第 N 步的输入。我一开始也想这么做,后来放弃了,理由有三个:

- **原运行会被删。** trace 是有保留期的,Day 119 的演示站会定期清理,生产环境的 trace 平台通常也只保留 30 到 90 天。用例的寿命比 trace 长得多。
- **原运行可能包含敏感数据,需要脱敏后再存。** 快照可以单独脱敏,不影响原运行的排查。
- **用例应该是不可变的。** 如果原运行被重新导入、被修改,用例的含义就悄悄变了。

快照里存什么?第 N 步发给模型的完整 messages 和 tools,原来用的模型,以及原运行里**所有**工具步的输入输出(作为回放磁带)。为什么是所有工具步,而不只是第 N 步之后的?因为模型重跑时可能去调前面调过的工具(比如重新查一次天气),这些结果也应该能回放。

快照会让每条用例占几 KB 到几百 KB。一个几百条用例的评测集也就几十 MB,SQLite 完全无所谓。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="从失败步骤到回归对比的流程:运行详情里选中失败步骤,存成带快照和断言的用例,批量多次运行得到一批结果,两批结果逐条对比找出变差的用例,也可以导出成 golden.jsonl 进 CI">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="16" y="40" width="120" height="58" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="76" y="62" text-anchor="middle" fill="var(--mem)">运行详情</text>
    <text x="76" y="82" text-anchor="middle" fill="var(--ink-soft)">选中第 N 步</text>
    <rect x="166" y="30" width="140" height="78" fill="none" stroke="var(--ink-soft)"/>
    <text x="236" y="52" text-anchor="middle" fill="var(--ink)">评测用例</text>
    <text x="236" y="70" text-anchor="middle" fill="var(--ink-soft)">快照:messages+tools</text>
    <text x="236" y="86" text-anchor="middle" fill="var(--ink-soft)">磁带 + 断言</text>
    <rect x="336" y="40" width="130" height="58" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="401" y="62" text-anchor="middle" fill="var(--compute)">批量运行</text>
    <text x="401" y="82" text-anchor="middle" fill="var(--ink-soft)">每条 k 次</text>
    <rect x="496" y="40" width="128" height="58" fill="none" stroke="var(--ink-soft)"/>
    <text x="560" y="62" text-anchor="middle" fill="var(--ink)">一批结果</text>
    <text x="560" y="82" text-anchor="middle" fill="var(--ink-soft)">通过率 / pass^k</text>
    <rect x="166" y="160" width="140" height="50" fill="none" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
    <text x="236" y="182" text-anchor="middle" fill="var(--ink-soft)">golden.jsonl</text>
    <text x="236" y="198" text-anchor="middle" fill="var(--ink-faint)">Day 35 的 CI 门禁</text>
    <rect x="420" y="160" width="204" height="50" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="522" y="182" text-anchor="middle" fill="var(--mem)">回归对比</text>
    <text x="522" y="198" text-anchor="middle" fill="var(--ink-soft)">基线批 vs 新批,逐条</text>
  </g>
  <g stroke="var(--ink-soft)" fill="none">
    <line x1="136" y1="69" x2="164" y2="69"/><line x1="306" y1="69" x2="334" y2="69"/><line x1="466" y1="69" x2="494" y2="69"/>
    <line x1="236" y1="108" x2="236" y2="158" stroke-dasharray="4 3"/><line x1="560" y1="98" x2="560" y2="158"/>
  </g>
  <text x="20" y="238" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">模型 503 / 限流 / 超时记为基础设施错误,不进通过率</text>
</svg>
<figcaption>从一个失败步骤到一条回归检查。虚线那条是导出到 Day 35 的端到端评测集。</figcaption>
</figure>

## 断言:和 Day 35 同名

断言字段直接沿用 Day 35 `golden.jsonl` 里 `expect` 的名字:`must_call`、`must_not_call`、`reply_must_include`、`reply_must_not_include`。同名的好处是导出时不用转换,两边的评分逻辑也能互相参照。另外加一个 `max_tool_calls`,这是在 Loupe 里调试时特别常见的一类问题:模型没做错,但绕了很多圈,多花了很多钱。

Day 35 里的 `category`、`needs_approval`、`refund` 这些是 SupportPilot 业务相关的断言,依赖 SupportPilot 的 `AgentRun` 结构。Loupe 是通用工具,不知道你的 Agent 有什么业务字段,所以不放。导出以后你可以在 `golden.jsonl` 里手动补。

断言只评估快照那一步**往后**的步骤。这一点很重要:如果用例是从第 3 步存的,断言「必须调用 get_weather」,而 get_weather 是在第 1 步调的,那么这条用例应该失败,因为从第 3 步往后模型没有再调它。用例测的是「模型在这个位置会怎么做」。

## 代码:evalcases.py

```python
# agent-loupe/server/loupe/evalcases.py
import json
import sqlite3
import uuid
from typing import Any

from pydantic import BaseModel, Field

from loupe import db
from loupe.models import Run, Step
from loupe.replay import Cassette, LLMCall, Overrides, apply_overrides, finish, messages_at, now, run_loop

SCHEMA = """
CREATE TABLE IF NOT EXISTS eval_cases (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, run_id TEXT NOT NULL, step_idx INTEGER NOT NULL,
  snapshot TEXT NOT NULL, expect TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eval_batches (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, label TEXT, overrides TEXT NOT NULL, trials INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS eval_results (
  batch_id TEXT NOT NULL, case_id TEXT NOT NULL, trial INTEGER NOT NULL,
  passed INTEGER NOT NULL, reasons TEXT NOT NULL, run_id TEXT,
  PRIMARY KEY (batch_id, case_id, trial)
);
"""


class Expect(BaseModel):
    """和 Day 35 golden.jsonl 里 expect 的字段同名,导出时可以直接用。"""
    must_call: list[str] = Field(default_factory=list)
    must_not_call: list[str] = Field(default_factory=list)
    reply_must_include: list[str] = Field(default_factory=list)
    reply_must_not_include: list[str] = Field(default_factory=list)
    max_tool_calls: int | None = None  # Loupe 新增:防止「绕圈子」


class CaseIn(BaseModel):
    run_id: str
    step_idx: int
    title: str
    expect: Expect
    tags: list[str] = Field(default_factory=list)


def init(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)


def snapshot_of(conn: sqlite3.Connection, run_id: str, step_idx: int) -> dict[str, Any]:
    """把第 step_idx 步的输入、以及原运行全部工具结果存成快照:原运行以后删了,用例照样能跑。"""
    trace = db.load_trace(conn, run_id)
    if trace is None:
        raise ValueError(f"run {run_id} 不存在")
    messages, tools, at = messages_at(trace.steps, step_idx)
    tape = [{"name": s.name, "input": s.input, "output": s.output, "error": s.error}
            for s in trace.steps if s.kind == "tool"]
    return {"messages": messages, "tools": tools, "model": at.model or trace.run.model,
            "parent_idx": at.parent_idx, "tape": tape}


def create_case(conn: sqlite3.Connection, c: CaseIn) -> str:
    case_id = f"case-{uuid.uuid4().hex[:8]}"
    snap = snapshot_of(conn, c.run_id, c.step_idx)
    with conn:
        conn.execute("INSERT INTO eval_cases VALUES (?,?,?,?,?,?,?,?)",
                     (case_id, c.title, c.run_id, c.step_idx, json.dumps(snap, ensure_ascii=False),
                      c.expect.model_dump_json(), json.dumps(c.tags, ensure_ascii=False), now().isoformat()))
    return case_id


def list_cases(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute("SELECT * FROM eval_cases ORDER BY created_at").fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["snapshot"], d["expect"], d["tags"] = json.loads(d["snapshot"]), json.loads(d["expect"]), json.loads(d["tags"])
        out.append(d)
    return out


def grade(tail: list[Step], expect: Expect) -> tuple[bool, list[str]]:
    """只看从快照那一步往后的步骤。reasons 为空就是通过。"""
    called = [s.name for s in tail if s.kind == "tool"]
    finals = [s for s in tail if s.kind == "llm" and not (s.output or {}).get("tool_calls")]
    reply = (finals[-1].output or {}).get("content") or "" if finals else ""
    reasons = []
    reasons += [f"没有调用 {t}" for t in expect.must_call if t not in called]
    reasons += [f"调用了不该调的 {t}" for t in expect.must_not_call if t in called]
    reasons += [f"回复缺少「{s}」" for s in expect.reply_must_include if s not in reply]
    reasons += [f"回复不该出现「{s}」" for s in expect.reply_must_not_include if s in reply]
    if expect.max_tool_calls is not None and len(called) > expect.max_tool_calls:
        reasons.append(f"工具调用 {len(called)} 次,超过上限 {expect.max_tool_calls}")
    if any(s.kind == "other" and s.error for s in tail):
        reasons.append("运行出错或超过最大步数")
    if not finals:
        reasons.append("没有最终回答")
    return not reasons, reasons


def run_case(conn: sqlite3.Connection, case: dict[str, Any], llm_call: LLMCall, ov: Overrides,
             label: str, live_tools: dict[str, Any] | None = None) -> tuple[bool, list[str], str]:
    snap = case["snapshot"]
    t0 = now()
    cassette = Cassette.from_steps([Step(run_id="tape", idx=i, kind="tool", name=t["name"], started_at=t0,
                                         ended_at=t0, input=t["input"], output=t["output"], error=t["error"])
                                    for i, t in enumerate(snap["tape"])])

    def exec_tool(name: str, args: Any) -> tuple[Any, str | None]:
        if live_tools and name in live_tools:  # 白名单里的只读工具真实执行,避免 cassette miss 把模型逼得绕圈
            try:
                return live_tools[name](**args), None
            except Exception as e:
                return None, f"{type(e).__name__}: {e}"
        hit, out, err = cassette.play(name, args)
        return (out, err) if hit else (None, f"cassette miss: {name}")

    run = Run(id=f"{case['id']}-{uuid.uuid4().hex[:6]}", name=f"[eval] {case['title']}", started_at=t0,
              ended_at=t0, model=ov.model or snap["model"], tags=["eval", label],
              parent_run_id=case["run_id"], forked_from_step=case["step_idx"])
    messages = apply_overrides(json.loads(json.dumps(snap["messages"])), ov)
    tail = run_loop(run, messages, snap["tools"], llm_call, exec_tool, start_idx=case["step_idx"],
                    parent_idx=snap.get("parent_idx"), temperature=ov.temperature)
    db.save_trace(conn, finish(run, tail))  # 每次评测运行都存成普通的 run,失败了可以在 Loupe 里打开看
    ok, reasons = grade(tail, Expect(**case["expect"]))
    return ok, reasons, run.id


def is_infra_error(e: Exception) -> bool:
    """模型服务 5xx、限流、超时:不是 Agent 的错,不该算进通过率。"""
    status = getattr(e, "status_code", None)
    return (status is not None and (status >= 500 or status == 429)) or "Timeout" in type(e).__name__


def run_batch(conn: sqlite3.Connection, case_ids: list[str] | None, trials: int, ov: Overrides,
              llm_call: LLMCall, label: str = "", live_tools: dict[str, Any] | None = None) -> str:
    batch_id = f"batch-{uuid.uuid4().hex[:8]}"
    cases = [c for c in list_cases(conn) if case_ids is None or c["id"] in case_ids]
    with conn:
        conn.execute("INSERT INTO eval_batches VALUES (?,?,?,?,?)",
                     (batch_id, now().isoformat(), label, ov.model_dump_json(), trials))
    for c in cases:
        for t in range(trials):
            try:
                ok, reasons, run_id = run_case(conn, c, llm_call, ov, label or batch_id, live_tools)
                passed = int(ok)
            except Exception as e:  # 一条用例炸了不影响别的
                passed = -1 if is_infra_error(e) else 0  # -1 = 基础设施错误,单独统计
                reasons, run_id = [f"{type(e).__name__}: {str(e)[:200]}"], None
            with conn:
                conn.execute("INSERT INTO eval_results VALUES (?,?,?,?,?,?)",
                             (batch_id, c["id"], t, passed, json.dumps(reasons, ensure_ascii=False), run_id))
    return batch_id


def batch_summary(conn: sqlite3.Connection, batch_id: str) -> dict[str, Any]:
    rows = conn.execute("SELECT case_id, passed, reasons, run_id FROM eval_results WHERE batch_id = ?",
                        (batch_id,)).fetchall()
    per: dict[str, dict[str, Any]] = {}
    infra = 0
    for r in rows:
        d = per.setdefault(r["case_id"], {"passed": 0, "trials": 0, "fail_reasons": [], "runs": []})
        if r["passed"] == -1:
            infra += 1
            continue
        d["trials"] += 1
        d["passed"] += r["passed"]
        d["runs"].append(r["run_id"])
        d["fail_reasons"] += json.loads(r["reasons"])
    n = sum(d["trials"] for d in per.values())
    return {
        "batch_id": batch_id,
        "cases": per,
        "pass_rate": round(sum(d["passed"] for d in per.values()) / n, 4) if n else None,
        # pass^k:k 次全过才算这条用例稳定
        "pass_all_k": sum(d["passed"] == d["trials"] for d in per.values()),
        "n_cases": len(per),
        "infra_errors": infra,
    }


def compare(conn: sqlite3.Connection, base: str, head: str) -> dict[str, Any]:
    a, b = batch_summary(conn, base)["cases"], batch_summary(conn, head)["cases"]
    def rate(d: dict[str, Any]) -> float | None:
        return d["passed"] / d["trials"] if d["trials"] else None

    rows = []
    for cid in sorted(set(a) | set(b)):
        ra, rb = (rate(a[cid]) if cid in a else None), (rate(b[cid]) if cid in b else None)
        status = ("new" if ra is None else "dropped" if rb is None else
                  "regressed" if rb < ra else "improved" if rb > ra else "same")
        rows.append({"case_id": cid, "base": ra, "head": rb, "status": status})
    return {"rows": rows, "regressed": [r["case_id"] for r in rows if r["status"] == "regressed"]}


def export_jsonl(conn: sqlite3.Connection) -> str:
    """导出成 Day 35 golden.jsonl 的格式,拿去端到端回归。"""
    lines = []
    for c in list_cases(conn):
        user = next((m["content"] for m in c["snapshot"]["messages"] if m.get("role") == "user"), "")
        exp = {k: v for k, v in c["expect"].items() if v not in (None, [])}
        lines.append(json.dumps({"id": c["id"], "ticket": user, "customer_id": None, "expect": exp,
                                 "tags": [*c["tags"], "from-loupe"], "split": "dev",
                                 "loupe": {"run_id": c["run_id"], "step_idx": c["step_idx"]}}, ensure_ascii=False))
    return "\n".join(lines) + "\n"
```

要点:

**`grade` 收集所有失败原因,而不是遇到第一个就返回。** 报告里一条用例失败时,你想一次看到所有问题:没调计算器、回复里没有 10.4、工具调用超了。只告诉你第一个,改完再跑才发现第二个,浪费一轮。

**`snapshot_of` 用 Day 113 的 `load_trace` 读原运行。** 快照里除了 messages、tools、模型名和磁带,还记下第 N 步的 `parent_idx`,跑用例时新步骤挂在同一个父步骤下,和重跑的结构一致。

**`run_case` 复用了 Day 117 的 `run_loop`、`Cassette` 和 `finish`。** 用例跑起来和在界面上重跑是同一套代码,只是起点来自快照而不是原运行。每次运行的结果也用 `save_trace` 存成一条普通的 Run(成本照样由 `fill_costs` 按 `prices.json` 算)(tags 带 `eval` 和批次名,`parent_run_id` 指向用例的来源),所以任何一次失败都能在 Loupe 里打开、看每一步、和原运行对比。评测结果不是一个孤零零的「失败」,而是一条可以调试的 trace。这是 Loupe 和普通评测脚本最大的区别。

**白名单工具默认真实执行。** 下面实测一节会讲,不这么做的话,用例会因为 cassette miss 大量误判。

**基础设施错误单独统计。** `run_batch` 在一条用例运行抛异常时,用 `is_infra_error` 判断:有 `status_code` 而且是 5xx 或 429,或者异常类型名里有 Timeout,就记成 `passed = -1`。`batch_summary` 统计时跳过它们,单独给出 `infra_errors` 计数。openai SDK 的 `APIStatusError` 子类都带 `status_code` 属性,`APITimeoutError` 的类型名里有 Timeout,所以不需要 import SDK 的异常类,测试里也能用一个带 `status_code` 的假异常模拟。

**`pass_all_k` 就是 pass^k。** τ-bench 论文提出了这个指标:同一个任务跑 k 次,k 次全部成功才算这个任务通过。它衡量的是**稳定性**。通过率 80% 可能是「每条用例 80% 的时候能过」,也可能是「80% 的用例总能过、20% 总是挂」,两种情况的修法完全不同。pass^k 能区分它们。客服这种场景,一个 Agent 十次里有两次乱退款,比一个永远不会处理退款的 Agent 危险得多。

**`compare` 按用例逐条比通过率。** 输出每条用例在两批里的通过率和状态(变差、变好、不变、新增、移除),以及变差用例的列表。门禁看的就是这个列表。

## 路由

在 `routes.py` 里追加(import 补上 `from fastapi.responses import PlainTextResponse` 和 `from loupe import evalcases`):

```python
# ---- Day 118:评测用例 ----
class BatchRequest(BaseModel):
    case_ids: list[str] | None = None
    trials: int = 3
    overrides: replay.Overrides = replay.Overrides()
    label: str = ""
    live_tools: bool = True


def register_eval(app: FastAPI, conn: sqlite3.Connection, llm_call: replay.LLMCall = replay.openai_llm_call) -> None:
    evalcases.init(conn)

    @app.post("/api/eval-cases")
    def create_case(c: evalcases.CaseIn) -> dict:
        try:
            return {"id": evalcases.create_case(conn, c)}
        except ValueError as e:
            raise HTTPException(400, str(e)) from e

    @app.get("/api/eval-cases")
    def list_cases() -> list[dict]:
        return [{k: v for k, v in c.items() if k != "snapshot"} for c in evalcases.list_cases(conn)]

    @app.get("/api/eval-cases/export.jsonl", response_class=PlainTextResponse)
    def export() -> str:
        return evalcases.export_jsonl(conn)

    @app.post("/api/eval-batches")
    def run_batch(req: BatchRequest) -> dict:
        if not 1 <= req.trials <= 5:
            raise HTTPException(400, "trials 只能是 1–5")
        bid = evalcases.run_batch(conn, req.case_ids, req.trials, req.overrides, llm_call, req.label,
                                 LIVE_TOOLS if req.live_tools else None)
        return evalcases.batch_summary(conn, bid)

    @app.get("/api/eval-batches/compare")  # 必须写在 /{batch_id} 前面
    def compare(base: str, head: str) -> dict:
        return evalcases.compare(conn, base, head)

    @app.get("/api/eval-batches/{batch_id}")
    def get_batch(batch_id: str) -> dict:
        return evalcases.batch_summary(conn, batch_id)
```

`create_app` 末尾再加一行 `register_eval(app, conn)`。三张新表(用例、批次、结果)在 `evalcases.init` 里用 `CREATE TABLE IF NOT EXISTS` 建,和 Day 113 的 `db.connect` 一样,第一次启动自动建好。

注意最后两个路由的顺序:`/api/eval-batches/compare` 必须写在 `/api/eval-batches/{batch_id}` 前面。FastAPI 按注册顺序匹配,反过来写的话,`compare` 会被当成一个叫 compare 的 batch_id,永远返回空结果,而且不报错。这种 bug 很难查,我是看到对比结果永远是空的才反应过来。

列表接口去掉了 `snapshot` 字段,快照可能很大,列表页用不到。

批量运行接口也是同步的,一批 10 条用例、每条 3 次,就是 30 次 Agent 运行,可能要几分钟。本地自己用可以接受;用例多了以后,和昨天说的一样,改成后台任务加进度推送。

## 测试

```python
# agent-loupe/server/tests/test_evalcases.py
import json

import pytest

from loupe import db, evalcases
from loupe.evalcases import CaseIn, Expect, grade
from loupe.replay import Overrides
from tests.helpers import llm, tool
from tests.helpers import call
from tests.test_replay import FakeLLM, seed


@pytest.fixture
def conn(tmp_path):
    c = db.connect(str(tmp_path / "t.db"))
    evalcases.init(c)
    seed(c)
    return c


def test_grade_reports_every_reason():
    tail = [llm(0, "get_weather"), tool(1, "get_weather", {"city": "北京"}), llm(2)]
    ok, reasons = grade(tail, Expect(must_call=["calculate"], reply_must_include=["11.9"], max_tool_calls=0))
    assert not ok
    assert reasons == ["没有调用 calculate", "回复缺少「11.9」", "工具调用 1 次,超过上限 0"]


def test_case_survives_deleting_original_run(conn):
    cid = evalcases.create_case(conn, CaseIn(run_id="orig", step_idx=0, title="北京天气要带温度",
                                             expect=Expect(must_call=["get_weather"], reply_must_include=["11.9"])))
    with conn:
        conn.execute("DELETE FROM runs WHERE id = 'orig'")  # 外键级联,步骤一起删掉
    script = [
        {"role": "assistant", "content": None, "tool_calls": [call(1, "get_weather", {"city": "北京"})]},
        {"role": "assistant", "content": "北京 11.9 度"},
    ]
    bid = evalcases.run_batch(conn, None, 1, Overrides(), FakeLLM(script))
    s = evalcases.batch_summary(conn, bid)
    assert s["cases"][cid]["passed"] == 1 and s["pass_rate"] == 1.0


def test_compare_finds_regression(conn):
    cid = evalcases.create_case(conn, CaseIn(run_id="orig", step_idx=0, title="t",
                                             expect=Expect(reply_must_include=["11.9"])))
    good = [{"role": "assistant", "content": "11.9 度"}] * 2
    bad = [{"role": "assistant", "content": "不知道"}, {"role": "assistant", "content": "11.9 度"}]
    base = evalcases.run_batch(conn, None, 2, Overrides(), FakeLLM(good))
    head = evalcases.run_batch(conn, None, 2, Overrides(), FakeLLM(bad))
    cmp = evalcases.compare(conn, base, head)
    assert cmp["regressed"] == [cid]
    assert evalcases.batch_summary(conn, head)["pass_all_k"] == 0


def test_export_matches_day35_format(conn):
    evalcases.create_case(conn, CaseIn(run_id="orig", step_idx=0, title="t", tags=["weather"],
                                       expect=Expect(must_call=["get_weather"])))
    line = json.loads(evalcases.export_jsonl(conn).splitlines()[0])
    assert line["ticket"] == "北京现在多少度?"
    assert line["expect"] == {"must_call": ["get_weather"]}
    assert line["split"] == "dev" and "from-loupe" in line["tags"]


def test_infra_errors_do_not_count_as_failures(conn):
    evalcases.create_case(conn, CaseIn(run_id="orig", step_idx=0, title="t", expect=Expect()))

    class Busy(Exception):
        status_code = 503

    def flaky(*_):
        raise Busy("Service is too busy")

    s = evalcases.batch_summary(conn, evalcases.run_batch(conn, None, 2, Overrides(), flaky))
    assert s["infra_errors"] == 2 and s["pass_rate"] is None
```

`test_case_survives_deleting_original_run` 是这一组里最重要的:先存用例,再把原运行删掉(Day 113 的表开了外键级联,删 run 时步骤一起没了),用例照样能跑能过。它守护的是「快照」这个设计决定,以后谁想把快照改成引用,这个测试会拦住他。

`test_compare_finds_regression` 用了一个小技巧:同一个 `FakeLLM` 按剧本依次返回,第二批的剧本是「先答错一次,再答对一次」,所以这条用例在第二批是 1/2,第一批是 2/2,对比结果应该是 regressed,而且 pass^k 为 0。

## 用 DeepSeek 实测:第一批结果就在说谎

用昨天那条 6 步的天气运行,从第 3 步(模型决定怎么算温差的那一步)存一条用例,标题「温差换算要用计算器且不绕圈」,断言:必须调用 `calculate`,回复里必须有 `10.4`,工具调用不超过 2 次。

我第一次跑的时候,`run_case` 还没有白名单真实执行,也还没有区分基础设施错误。3 次运行,结果 1/3 通过。看失败原因:

- 一次是「工具调用 6 次,超过上限 2」。打开那条 eval 运行一看,模型要算 `(17.7 - 11.9) * 9 / 5`,磁带里没有,miss;它换了个写法再算,又 miss;来回折腾了好几次。和 Day 117 第二组重跑是同一个问题。
- 另一次是 `InternalServerError: Error code: 503`,DeepSeek 返回 `Service is too busy`。

所以这个 1/3 里,真正能说明 Agent 行为的数据一条都没有:一条是测试工具本身的问题(cassette miss),一条是服务商的问题。如果我拿这个数字去判断「新提示词好不好」,结论完全是错的。

修了两处以后(计算器在白名单里,真实执行;503 记成基础设施错误不进通过率),又跑了两批,每批 3 次:基线(原提示词)3/3 通过,加了「温差直接用摄氏温差乘 9/5 一次算出」的新提示词也是 3/3。

这又暴露了另一个问题:**一条用例、三次运行,区分不出两个版本。** 这不是用例的错,是样本太少。Day 69 讲过,要可靠地检测出几个百分点的差异,需要几十到几百次观测。一个可用的评测集至少要有十几二十条从真实失败里来的用例,覆盖不同的失败模式,每条跑 3 到 5 次。今天的练习会让你攒够这些。

这段经历我觉得比任何「评测很重要」的说教都有说服力:评测数字首先要可信,然后才谈得上有用。在相信一个通过率之前,先打开失败的那几条 trace 看看,它们到底是怎么失败的。Loupe 把每次评测运行存成可调试的 trace,就是为了让这一步零成本。

## 导出到 Day 35 的评测集

`GET /api/eval-cases/export.jsonl` 返回的每一行长这样(我实测的那条):

```json
{"id": "case-6fc1c928", "ticket": "北京和上海现在温差几度?换算成华氏度差多少?", "customer_id": null, "expect": {"must_call": ["calculate"], "reply_must_include": ["10.4"], "max_tool_calls": 2}, "tags": ["from-loupe"], "split": "dev", "loupe": {"run_id": "weather-011033", "step_idx": 3}}
```

`ticket` 取的是快照里第一条 user 消息,`customer_id` 是 null(Loupe 不知道你的业务字段,导出以后手动补)。`expect` 里只保留非空的断言。`split` 默认是 `dev`,Day 35 的门禁会按 split 过滤。`loupe` 字段记录来源,Day 35 的脚本会忽略不认识的字段,但人看报告时可以顺着它回到 Loupe。

`max_tool_calls` 是 Loupe 新增的断言,Day 35 的 `rule_graders` 不认识它。在 Day 35 的 `checks.py` 里加三行就能支持:

```python
    if exp.get("max_tool_calls") is not None:
        n = len(run.tool_names())
        g["max_tool_calls"] = (n <= exp["max_tool_calls"], f"工具调用 {n} 次,上限 {exp['max_tool_calls']}")
```

导出的用例在端到端评测里会从头跑,所以「从第 3 步开始」的精确性丢了。一个从第 14 步存下来的用例,导出以后可能根本走不到那个场景。建议在 `tags` 里给这类用例加 `deep-step`,端到端报告里单独看它们的通过率,低得离谱时回 Loupe 用步级方式跑。

## 前端:存用例和批量运行

`web/src/api.ts` 末尾追加类型和请求函数,`postJson` 是昨天写的:

```typescript
// ---- Day 118 新增:评测用例 ----
export interface Expect {
  must_call: string[];
  must_not_call: string[];
  reply_must_include: string[];
  reply_must_not_include: string[];
  max_tool_calls: number | null;
}

export interface EvalCase {
  id: string;
  title: string;
  run_id: string;
  step_idx: number;
  expect: Expect;
  tags: string[];
  created_at: string;
}

export interface CaseResult {
  passed: number;
  trials: number;
  fail_reasons: string[];
  runs: (string | null)[];
}

export interface BatchSummary {
  batch_id: string;
  cases: Record<string, CaseResult>;
  pass_rate: number | null;
  pass_all_k: number; // pass^k:k 次全过的用例数
  n_cases: number;
  infra_errors: number; // 模型服务 5xx / 限流 / 超时,不进通过率
}

export interface CompareRow {
  case_id: string;
  base: number | null;
  head: number | null;
  status: 'new' | 'dropped' | 'regressed' | 'improved' | 'same';
}

export const fetchCases = () => getJson<EvalCase[]>('/api/eval-cases');

export const createCase = (body: { run_id: string; step_idx: number; title: string; expect: Expect; tags: string[] }) =>
  postJson<{ id: string }>('/api/eval-cases', body);

export const exportCasesUrl = () => `${API_BASE}/api/eval-cases/export.jsonl`;

export const runBatch = (body: {
  case_ids?: string[];
  trials: number;
  overrides: ReplayOverrides;
  label: string;
  live_tools: boolean;
}) => postJson<BatchSummary>('/api/eval-batches', body);

export const compareBatches = (base: string, head: string) =>
  getJson<{ rows: CompareRow[]; regressed: string[] }>(
    `/api/eval-batches/compare?base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`,
  );
```

存用例的对话框,`web/src/components/SaveCaseDialog.tsx`:

```tsx
// agent-loupe/web/src/components/SaveCaseDialog.tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { createCase, type Expect, type StepFull } from '../api';

const split = (s: string) => s.split(/[,,\n]/).map((x) => x.trim()).filter(Boolean);

export function SaveCaseDialog({ runId, step, onClose }: { runId: string; step: StepFull; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [mustCall, setMustCall] = useState('');
  const [mustNotCall, setMustNotCall] = useState('');
  const [include, setInclude] = useState('');
  const [exclude, setExclude] = useState('');
  const [maxCalls, setMaxCalls] = useState('');
  const [tags, setTags] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const expect: Expect = {
      must_call: split(mustCall),
      must_not_call: split(mustNotCall),
      reply_must_include: split(include),
      reply_must_not_include: split(exclude),
      max_tool_calls: maxCalls === '' ? null : Number(maxCalls),
    };
    const empty = Object.values(expect).every((v) => v === null || (Array.isArray(v) && v.length === 0));
    if (!title.trim() || empty) {
      setError('写个标题,并且至少填一条断言,不然这个用例永远是通过');
      return;
    }
    try {
      const { id } = await createCase({ run_id: runId, step_idx: step.idx, title, expect, tags: split(tags) });
      setSaved(id);
    } catch (e) {
      setError(String(e));
    }
  }

  if (saved) {
    return (
      <dialog open className="dialog">
        <p>已保存为 <code>{saved}</code>,在 <Link to="/eval">评测用例</Link> 页可以批量跑。</p>
        <button onClick={onClose}>好</button>
      </dialog>
    );
  }
  return (
    <dialog open className="dialog">
      <h3>把第 {step.idx} 步存成评测用例</h3>
      <p className="hint">保存的是这一步发给模型的完整输入和原运行里所有工具结果的快照,原运行以后删掉也能跑。</p>
      <label>标题 <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如:温差换算不该绕圈" /></label>
      <label>必须调用的工具 <input value={mustCall} onChange={(e) => setMustCall(e.target.value)} placeholder="逗号分隔" /></label>
      <label>不许调用的工具 <input value={mustNotCall} onChange={(e) => setMustNotCall(e.target.value)} /></label>
      <label>回复必须包含 <input value={include} onChange={(e) => setInclude(e.target.value)} /></label>
      <label>回复不许包含 <input value={exclude} onChange={(e) => setExclude(e.target.value)} /></label>
      <label>工具调用次数上限 <input type="number" min="0" value={maxCalls} onChange={(e) => setMaxCalls(e.target.value)} /></label>
      <label>标签 <input value={tags} onChange={(e) => setTags(e.target.value)} /></label>
      {error && <p className="bad">{error}</p>}
      <menu>
        <button onClick={onClose}>取消</button>
        <button onClick={save}>保存</button>
      </menu>
    </dialog>
  );
}
```

保存前检查「至少一条断言」。一条没有断言的用例永远是通过的,放进评测集只会让通过率虚高,这是我在别的团队的评测集里见过不止一次的问题。

入口还是 Day 115 的 `StepInspector`,昨天的「从这一步重跑」旁边再加一个按钮。import `SaveCaseDialog`,然后把昨天那段改成:

```tsx
{isLlm && (
  <p className="actions">
    <button onClick={() => setDialog('replay')}>从这一步重跑</button>
    <button onClick={() => setDialog('case')}>存成评测用例</button>
  </p>
)}
{dialog === 'replay' && <ReplayDialog runId={runId} step={step} onClose={() => setDialog(null)} />}
{dialog === 'case' && <SaveCaseDialog runId={runId} step={step} onClose={() => setDialog(null)} />}
```

评测用例页,`web/src/pages/EvalCasesPage.tsx`:

```tsx
// agent-loupe/web/src/pages/EvalCasesPage.tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { compareBatches, exportCasesUrl, fetchCases, runBatch, type BatchSummary, type CompareRow, type EvalCase } from '../api';

const pct = (x: number | null | undefined) => (x == null ? '—' : `${Math.round(x * 100)}%`);

export function EvalCasesPage() {
  const [cases, setCases] = useState<EvalCase[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [trials, setTrials] = useState(3);
  const [label, setLabel] = useState('');
  const [system, setSystem] = useState('');
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [cmp, setCmp] = useState<CompareRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCases().then(setCases).catch((e: Error) => setError(e.message));
  }, []);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const s = await runBatch({
        case_ids: selected.size ? [...selected] : undefined,
        trials,
        label: label || `batch ${batches.length + 1}`,
        overrides: system ? { system_prompt: system } : {},
        live_tools: true,
      });
      setBatches((b) => [...b, s]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function compareLastTwo() {
    if (batches.length < 2) return;
    const [base, head] = batches.slice(-2);
    setCmp((await compareBatches(base.batch_id, head.batch_id)).rows);
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const last = batches.at(-1);

  return (
    <main className="page eval-page">
      <header className="toolbar">
        <Link to="/">← 全部运行</Link>
        <h1>评测用例({cases.length})</h1>
      </header>
      <p>
        <a href={exportCasesUrl()} download="loupe-cases.jsonl">导出成 Day 35 的 golden.jsonl 格式</a>
      </p>
      {error && <p className="bad">{error}</p>}
      <table className="runs">
        <thead>
          <tr><th /><th>标题</th><th>来源</th><th>断言</th><th>上一批通过</th></tr>
        </thead>
        <tbody>
          {cases.map((c) => {
            const r = last?.cases[c.id];
            return (
              <tr key={c.id}>
                <td><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} /></td>
                <td>{c.title}</td>
                <td><Link to={`/runs/${encodeURIComponent(c.run_id)}`}>{c.run_id}</Link> · 第 {c.step_idx} 步</td>
                <td><code>{JSON.stringify(c.expect)}</code></td>
                <td title={r?.fail_reasons.join('\n')}>{r ? `${r.passed}/${r.trials}` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <fieldset disabled={busy}>
        <legend>跑一批(不勾选就跑全部)</legend>
        <label>每条跑 <input type="number" min={1} max={5} value={trials} onChange={(e) => setTrials(Number(e.target.value))} /> 次</label>
        <label>批次名 <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例如:改提示词前" /></label>
        <label>换系统提示词(可选)<textarea rows={3} value={system} onChange={(e) => setSystem(e.target.value)} /></label>
        <button onClick={run}>{busy ? '运行中…' : '开始'}</button>
      </fieldset>
      {batches.length > 0 && (
        <table className="runs">
          <thead>
            <tr><th>批次</th><th>通过率</th><th>k 次全过</th><th>基础设施错误</th></tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.batch_id}>
                <td>{b.batch_id}</td>
                <td>{pct(b.pass_rate)}</td>
                <td>{b.pass_all_k}/{b.n_cases}</td>
                <td>{b.infra_errors}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button onClick={compareLastTwo} disabled={batches.length < 2}>对比最近两批</button>
      {cmp && (
        <table className="runs">
          <thead>
            <tr><th>用例</th><th>前</th><th>后</th><th>变化</th></tr>
          </thead>
          <tbody>
            {cmp.map((r) => (
              <tr key={r.case_id} className={`cmp-${r.status}`}>
                <td>{cases.find((c) => c.id === r.case_id)?.title ?? r.case_id}</td>
                <td>{pct(r.base)}</td>
                <td>{pct(r.head)}</td>
                <td>{{ regressed: '变差', improved: '变好', same: '不变', new: '新增', dropped: '移除' }[r.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
```

在 `App.tsx` 里接在 `/diff` 后面加 `<Route path="/eval" element={<EvalCasesPage />} />`,运行列表页的工具栏放一个指向 `/eval` 的链接。

这个页面刻意做得朴素:勾选用例(不勾就是全部)、设置次数和批次名、可选地换一个系统提示词、开始。跑完的批次列在下面,点「对比最近两批」出回归表。最常见的用法就两步:改提示词前跑一批叫「before」,改完跑一批叫「after」,对比。

鼠标悬停在「上一批通过」那一格上,`title` 会显示所有失败原因。来源那一列链接回原运行的详情页 `/runs/:id`,第几步写在旁边。批次结果里每条用例的 `runs` 字段是每次评测运行的 id,也可以做成链接,点进去就是那次运行的时间轴。

## 动手练习

1. **跑通。** 后端 `uv run pytest -q` 全过,前端 `pnpm typecheck` 通过;在界面上从一条真实运行存一条用例,跑一批 3 次,能在批次表里看到通过率。
2. **攒一个 15 条的评测集。** 用 `samples/day09_cities.jsonl`、`samples/day117_weather.jsonl`,以及你在 SupportPilot 上导出的 trace,找出至少 15 个「模型做得不对或不够好」的步骤,存成用例。至少覆盖四种失败:调错工具、该调没调、绕圈子、回复缺关键信息。每种失败模式给用例打一个标签。
3. **一次真实的改进实验。** 针对练习 2 里最常见的一种失败改提示词,before/after 各跑一批(每条 3 次),把结果填进下表,用 Day 69 的方法判断差异是否可信:

| 批次 | 通过率 | pass^3 | 基础设施错误 | 变差的用例 |
| --- | --- | --- | --- | --- |
| before | | | | |
| after | | | | |

4. **导出并接上 CI。** 导出 `golden.jsonl`,合并进 Day 35 的评测集,在 `checks.py` 里支持 `max_tool_calls`,本地跑一次 Day 35 的门禁脚本。
5. **用例按标签统计。** 给 `batch_summary` 加一个按标签分组的通过率,在评测页按标签显示。这能告诉你哪一类失败模式最顽固。

**验收标准:** 测试全过;评测集里至少 15 条带断言的用例,每条都能链接回来源 trace;练习 3 的表填完,并写一段话说明这次改动有没有效、证据是什么、置信度如何;导出的用例能在 Day 35 的门禁脚本里跑。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 步级用例 | 从某次运行的第 N 步开始的用例,之前的上下文冻结在快照里 |
| 端到端用例 | 从用户输入开始、整个 Agent 从头跑到尾的用例 |
| 快照(snapshot) | 用例里保存的第 N 步完整输入、模型名和原运行的全部工具结果 |
| 断言(assertion) | 判断一次运行是否通过的规则,如必须调用某工具、回复必须包含某词 |
| 批次(batch) | 一组用例各跑 k 次的一次完整评测 |
| pass^k | 同一用例跑 k 次全部通过才算通过,衡量稳定性(τ-bench 提出) |
| 基础设施错误 | 模型服务 5xx、限流、超时等不是 Agent 本身造成的失败 |
| 回归(regression) | 某条用例在新版本里的通过率比基线低 |
| error analysis | 先看大量真实 trace,把失败归类,再决定修什么、测什么 |

## 常见误区

**用例只存一个指向原运行的引用。** trace 会过期、会被删、会被改。用例要存快照,自包含、不可变。

**没有断言的用例。** 它永远通过,只会把通过率往上拉。保存时就拦住。

**把 503 算成 Agent 失败。** 服务商忙的那几分钟,所有用例的通过率都会掉,你会以为自己的改动搞坏了什么。基础设施错误单独统计,比例太高时整批作废重跑。

**评测时所有工具都只回放。** 模型一走到原运行没走过的路就 miss,然后开始绕圈,用例因为测试工具的限制而失败。纯函数工具真实执行,查询类工具回放,写操作永远回放。

**只看通过率,不看 pass^k。** 80% 通过率可能意味着每条用例都不稳定,也可能意味着少数用例完全挂掉。两种情况修法完全不同。

**一条用例跑三次就下结论。** 样本太少,任何差异都可能是噪声。先攒够用例,再谈改进。

**相信数字之前不看失败的 trace。** 我第一批的 1/3 里没有一条是 Agent 的真实失败。打开失败的运行看一眼,往往比盯着数字看半天有用。

## 学习资料

### 文档与文章

- [Hamel Husain · Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/):评测领域引用最多的文章之一,重点看「先看数据」和把 trace 变成测试用例的部分,和今天做的事一模一样,40 分钟。
- [τ-bench 论文](https://arxiv.org/abs/2406.12045):读摘要和介绍 pass^k 的那一节,理解为什么 Agent 的可靠性要用「k 次全过」衡量,30 分钟。
- [Langfuse · Datasets](https://langfuse.com/docs/evaluation/dataset-runs/datasets):Langfuse 怎么从 trace 建数据集、怎么跑 dataset run,和 Loupe 的设计对照,20 分钟。
- [Langfuse · Evaluation overview](https://langfuse.com/docs/evaluation/overview):它对评测方法的分类(离线、线上、LLM-as-judge、人工),帮你把今天的规则断言放进更大的图景里,15 分钟。
- [LangSmith · Evaluation](https://docs.smith.langchain.com/evaluation):另一家的做法,看「从 trace 加到 dataset」的流程,15 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1B8a96PEf6&autoplay=0&high_quality=1" title="Agent 系统设计 05:用 Langfuse 搭建 AI Coding 评测与改进闭环" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>桃子可冰乐 · Agent 系统设计 05:用 Langfuse 搭建 AI Coding 评测与改进闭环 · 18 分钟,讲从 trace 到评测再到改进的闭环,正好是今天的主题,看它怎么组织数据集和对比实验。</figcaption>
</figure>

- 蹦跶波《LangSmith完整流程:RAG 项目评估与测试全实战》(BV1mfAHzAEru,7 分钟):LangSmith 里建数据集、跑评估的完整演示,和我们的批量运行对照。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/hd-LmPwfrVc" title="Turn Flagged Traces Into a Dataset in 3 Minutes with the LangSmith CLI" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Turn Flagged Traces Into a Dataset in 3 Minutes with the LangSmith CLI · 4 分钟,官方演示把标记过的 trace 变成数据集,和「存成评测用例」按钮是同一个想法。</figcaption>
</figure>

- Peter Yang 访谈 Hamel Husain《AI Evaluations Clearly Explained in 50 Minutes (Real Example)》(YouTube `uiza7wp1KrE`,52 分钟):用一个真实产品演示 error analysis 怎么做,看前 20 分钟就有收获。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 3 章「Evaluation Methodology」和第 4 章「Evaluate AI Systems」。第 4 章讲怎么设计评测流水线、怎么从生产数据里构造评测集,今天的「从 trace 存用例」是其中一种具体做法。

### 开源项目与代码

- [sierra-research/tau-bench](https://github.com/sierra-research/tau-bench):pass^k 的出处,看它怎么定义任务、怎么多次运行和统计。
- [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo):流行的开源评测工具,它的断言类型(contains、not-contains、javascript 等)很丰富,可以给 Loupe 的断言扩展找灵感。
- [langfuse/langfuse](https://github.com/langfuse/langfuse):数据集和 dataset run 的完整实现,看它的数据模型怎么把 trace、dataset item、run 关联起来。

## 自测

1. 步级用例和端到端用例的区别是什么?各自适合测什么?

<details><summary>答案</summary>

步级用例从某次运行的第 N 步开始,之前的上下文冻结在快照里,适合精准测试「模型在某个具体位置的决策」,快、便宜、噪声小。端到端用例从用户输入开始跑完全程,适合测整个系统的表现,但慢、贵、噪声大,深层的场景可能根本走不到。

</details>

2. 为什么用例要存完整快照,而不是存 `(run_id, step_idx)`?

<details><summary>答案</summary>

trace 有保留期会被删;原运行可能被修改或重新导入,用例的含义会悄悄改变;快照可以单独脱敏。用例应该自包含、不可变,寿命比 trace 长。

</details>

3. 一批评测里有 30 次运行,其中 6 次是 503。通过率应该怎么算?什么时候应该整批作废?

<details><summary>答案</summary>

503 是基础设施错误,不计入分母也不计入分子,通过率用剩下 24 次算,同时单独报告基础设施错误数。如果基础设施错误比例高(比如超过一两成),或者集中在某几条用例上导致这些用例几乎没有有效样本,结论就不可靠,应该整批重跑。

</details>

4. 两个版本的通过率都是 80%。只看这个数字,你能判断它们一样好吗?还需要看什么?

<details><summary>答案</summary>

不能。要看 pass^k:一个版本可能是每条用例都有 20% 的概率失败(不稳定),另一个可能是 80% 的用例总能过、20% 总是失败(有确定的缺陷)。还要看逐条对比:哪些用例变好、哪些变差,变差的是不是关键用例。最后看样本量够不够支撑结论。

</details>

5. `/api/eval-batches/compare` 写在 `/api/eval-batches/{batch_id}` 后面会出什么问题?

<details><summary>答案</summary>

FastAPI 按注册顺序匹配路由,`compare` 会先被 `{batch_id}` 匹配到,当成一个叫 compare 的批次 id,返回空结果而不是报错,很难发现。固定路径的路由要写在带参数的路由前面。

</details>

6. 资深面试题:团队的 Agent 评测集有 300 条用例,通过率稳定在 92%,但线上投诉一直没减少。你会怎么分析?

<details><summary>答案</summary>

评测集和线上分布脱节是最常见的原因。先查用例来源:是不是大多是早期人工编的、覆盖的是「已知会处理」的场景?把最近一个月的投诉对应的 trace 拿出来,看它们的失败模式在评测集里有没有对应用例;没有的话,用 error analysis 把它们归类,每类存几条步级用例进评测集。再查断言质量:有没有空断言、断言太宽松(只检查调了工具,不检查结果对不对)。然后看 pass^k 而不是通过率,线上一个用户只遇到一次,不稳定比偶尔失败更伤人。最后建立机制:线上失败的 trace 定期进入评测集,评测集按失败模式分组报告,每次改动看分组变化而不是总分。

</details>

## 明天预告

Loupe 的核心功能到今天都齐了:看、比、重跑、存用例、跑评测。但它还只在你自己的电脑上。明天(Day 119)把它放到网上,让招聘方点开链接就能试:**只读演示模式、样例脱敏、重跑限流和每日花费上限、CORS,前端部署到 Cloudflare Pages,后端部署到云服务器或 Fly.io**,最后按清单测一遍性能,把数字回填进表格。
