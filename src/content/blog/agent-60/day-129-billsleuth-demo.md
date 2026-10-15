---
title: 'Day 129 · BillSleuth(八):在线演示、实时调查面板与部署'
description: '把 BillSleuth 做成招聘方点开就能试的网页:FastAPI 用 SSE 把调查图的每个节点更新实时推给前端，页面上并排展示调查步骤、复算对比表、结论和证据链。每次调查在独立子进程里、用独立的库副本跑，标准答案不下发，按 IP 限流加每日花费上限。调查结束可以下载 Agent Loupe SDK 格式的 JSONL,拖进作品一回放，我用作品一的导入器实际导入验证过。最后给出两种部署。'
pubDate: 2026-10-15
regime: none
tags: ['sse', 'fastapi', 'deployment', 'demo', 'agent-60']
series: 'agent-60'
day: 129
lang: 'zh'
---

## 今天要解决的问题

到昨天为止,BillSleuth 的所有成果都在你自己的终端里：评测报告、改动日志、几段回复。招聘方不会 clone 你的仓库、配 API key、跑 `uv run`。他们会点开一个链接，看三十秒，如果看到的是一个在实时干活的 Agent,会多看三分钟；如果看到的是白屏或者「服务出错」,就关掉了。

今天的目标就是那个链接。思路和 Day 49 给 SupportPilot 做界面一样，用 SSE 把过程推给前端，但这次是对公网开放的演示，有几件事 Day 49 不用操心：

1. 任何人都能点，所以要限流、要有每日花费上限。
2. 访客之间不能互相影响。A 让 Agent 起草了一张贷记单，B 再跑同一个场景不能被 A 的草稿挡住。
3. 场景的标准答案(`truth`)不能从任何接口漏出去，否则评测集就公开了。
4. 访客可以改写客户原话，这是不可信输入，会出现在页面上，要防注入。

学完今天，你应该能：

1. 用 FastAPI 和 sse-starlette 把调查图的 `stream(stream_mode="updates")` 变成 SSE 流。
2. 说清楚为什么每次调查要放进子进程，以及子进程和 web 进程之间怎么传事件。
3. 实现每访客一份库、按 IP 限流、每日预算、并发上限四道保护。
4. 写一个纯 HTML 加原生 JS 的调查面板，用 fetch 读 POST 请求的 SSE 流，所有动态内容转义。
5. 把一次调查导出成作品一 Agent Loupe 的 SDK JSONL,并用它的导入器验证。
6. 用两种方式部署上线，逐项过检查清单。

预计用时 5–6 小时。前置:Day 36(FastAPI 与 SSE)、Day 49(为什么 POST 请求不用 EventSource)、Day 53(Docker、Caddy)、Day 112(Agent Loupe 的 SDK 和 JSONL 格式)、Day 119(Agent Loupe 的部署)、Day 124–126。

## 为什么每次调查要一个子进程

先说最反直觉的一个决定。Day 49 的做法是在 web 进程里开一个线程跑工作流，用 `call_soon_threadsafe` 把事件交给事件循环。这次不行。

原因在 Day 122 和 123 的设计里：库路径是环境变量 `BILLSLEUTH_DB`,审计的会话号是 `BILLSLEUTH_SESSION`,MCP server 每次调工具时现读。昨天的评测已经因为这个用了进程池。演示服务更是这样：两个访客同时调查，如果在两个线程里各自设 `BILLSLEUTH_DB`,后设的会把先设的覆盖掉，第一个访客的 Agent 会去查第二个访客的库副本。

你可能会想：把环境变量改成函数参数或者 contextvar 不就行了？可以，但要改的地方从 MCP server 一路穿到 `db_path()`,而且 MCP 的 in-process 客户端在另一个线程里跑事件循环，contextvar 不会自动跟过去。为了一个演示改动底层设计，不划算。子进程是最省事也最干净的隔离：每次调查一个进程，环境变量、内存、崩溃都互不影响。代价是每次多一两秒的进程启动时间(主要是导入 LangChain),在 15 到 60 秒的调查面前可以忽略。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="演示服务结构：浏览器经 Caddy 访问 FastAPI,FastAPI 过限流和预算后起子进程，子进程设环境变量、复制库、跑调查图，事件经多进程队列回到 SSE 流">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
  <rect x="20" y="120" width="100" height="50" fill="none" stroke="var(--ink-soft)" rx="4"/>
  <text x="70" y="149" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">浏览器</text>
  <rect x="150" y="120" width="80" height="50" fill="none" stroke="var(--ink-soft)" rx="4"/>
  <text x="190" y="149" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Caddy</text>
  <line x1="120" y1="145" x2="146" y2="145" stroke="var(--ink-soft)" marker-end="url(#a129)"/>
  <rect x="260" y="40" width="160" height="210" fill="none" stroke="var(--ink-soft)" rx="4"/>
  <text x="340" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">web 进程</text>
  <line x1="230" y1="145" x2="256" y2="145" stroke="var(--ink-soft)" marker-end="url(#a129)"/>
  <rect x="275" y="75" width="130" height="34" fill="none" stroke="var(--rule)" rx="3"/>
  <text x="340" y="96" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">限流 / 预算 / 并发</text>
  <rect x="275" y="125" width="130" height="34" fill="none" stroke="var(--rule)" rx="3"/>
  <text x="340" y="146" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">多进程队列</text>
  <rect x="275" y="175" width="130" height="34" fill="none" stroke="var(--rule)" rx="3"/>
  <text x="340" y="196" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">SSE 生成器</text>
  <line x1="340" y1="159" x2="340" y2="171" stroke="var(--ink-soft)" marker-end="url(#a129)"/>
  <path d="M275 192 C 220 230, 120 230, 72 172" fill="none" stroke="var(--ink-soft)" stroke-dasharray="4 4" marker-end="url(#a129)"/>
  <text x="110" y="244" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">event: tool_call / tool_result / finding / reply / approval / done</text>
  <rect x="460" y="50" width="160" height="80" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="540" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">子进程(每次一个)</text>
  <text x="540" y="92" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">设 BILLSLEUTH_DB</text>
  <text x="540" y="110" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">graph.stream(...)</text>
  <line x1="420" y1="92" x2="456" y2="92" stroke="var(--mem)" marker-end="url(#a129)"/>
  <path d="M460 120 C 440 135, 430 142, 409 142" fill="none" stroke="var(--mem)" marker-end="url(#a129)"/>
  <text x="430" y="160" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">q.put(事件)</text>
  <rect x="460" y="180" width="160" height="60" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="540" y="205" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">/tmp/xxx/billing.db</text>
  <text x="540" y="224" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">每次调查一份副本</text>
  <line x1="540" y1="130" x2="540" y2="176" stroke="var(--compute)" marker-end="url(#a129)"/>
  <defs><marker id="a129" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
</svg>
<figcaption>每次调查一个子进程，只在子进程里设环境变量。事件通过多进程队列回到 web 进程，再由 SSE 推给浏览器。</figcaption>
</figure>

## 服务端

演示服务叫 `billsleuth/web.py`。注意别和 `billsleuth/server.py` 搞混，那是 Day 123 的 MCP server。

```python
# billsleuth/billsleuth/web.py
"""Day 129 新增:在线演示服务。uv run uvicorn billsleuth.web:app --port 8000

(billsleuth/server.py 是 Day 123 的 MCP server,演示服务另起一个名字。)
每次调查在一个独立的子进程里跑:库路径和会话号是环境变量(Day 122、123 的设计),
线程之间会互相覆盖,进程不会。子进程把事件放进队列,这边从队列里取出来用 SSE 推给浏览器。
"""
from __future__ import annotations

import asyncio
import json
import multiprocessing as mp
import os
import queue
import shutil
import tempfile
import threading
import time
from collections import defaultdict, deque
from datetime import date
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from pydantic import BaseModel
from sse_starlette import EventSourceResponse

from billsleuth.approval_api import router as approval_router
from billsleuth.db import ROOT, db_path

DAILY_BUDGET_CNY = float(os.environ.get("DAILY_BUDGET_CNY", "5"))
PER_IP_PER_HOUR = int(os.environ.get("PER_IP_PER_HOUR", "6"))
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "3"))
RUN_TIMEOUT_S = 180

app = FastAPI(title="BillSleuth demo")
app.include_router(approval_router)  # Day 126 的审批接口;演示页本身用不到,给内部审批页面用
_spent = {"day": date.today().isoformat(), "cny": 0.0}
_hits: dict[str, deque] = defaultdict(deque)
_lock = threading.Lock()
_slots = asyncio.Semaphore(MAX_CONCURRENT)
_traces: dict[str, str] = {}  # run_id → Loupe JSONL;演示用内存存,重启就丢


def _scenarios() -> dict[str, dict]:
    return {p.stem: json.loads(p.read_text()) for p in sorted((ROOT / "scenarios").glob("S*.json"))}


def _client_ip(req: Request) -> str:
    # 在 Caddy / Cloudflare 后面时真实 IP 在头里;直接暴露在公网时不要信这两个头
    return (req.headers.get("cf-connecting-ip") or req.headers.get("x-forwarded-for", "").split(",")[0].strip()
            or (req.client.host if req.client else "?"))


def _admit(ip: str) -> str | None:
    now = time.time()
    with _lock:
        if _spent["day"] != date.today().isoformat():
            _spent.update(day=date.today().isoformat(), cny=0.0)
        if _spent["cny"] >= DAILY_BUDGET_CNY:
            return "今天的演示额度用完了,明天再来,或者看页面下方录好的回放"
        q = _hits[ip]
        while q and now - q[0] > 3600:
            q.popleft()
        if len(q) >= PER_IP_PER_HOUR:
            return f"每小时最多跑 {PER_IP_PER_HOUR} 次,稍后再试"
        q.append(now)
    return None


def _ui_events(node: str, delta: dict) -> list[dict]:
    """把图的节点更新翻译成前端好用的事件。只挑页面要展示的。"""
    out: list[dict] = []
    if node == "locate":
        out.append({"type": "locate", "candidates": delta.get("candidates", [])})
    elif node == "investigate":
        for c in getattr(delta["messages"][-1], "tool_calls", None) or []:
            if c["name"] != "SubmitFindings":
                out.append({"type": "tool_call", "name": c["name"], "args": c.get("args") or {}})
    elif node == "tools":
        for m in delta.get("messages", []):
            try:
                result = json.loads(m.content)
            except (TypeError, ValueError):
                result = {"error": str(m.content)}
            out.append({"type": "tool_result", "result": result})
    elif node == "conclude":
        out.append({"type": "finding", "finding": delta.get("findings", {}), "escalated": delta.get("escalated")})
    elif node == "write_up":
        r = delta.get("reply") or {}
        out.append({"type": "reply", "customer_message": r.get("customer_message", ""),
                    "internal_note": r.get("internal_note", ""), "fallback": r.get("fallback")})
    elif node == "request_approval":
        out.append({"type": "approval", "approval": delta.get("approval", {})})
    return out


def _work(customer_id: str, question: str, template_db: str, q) -> None:
    """子进程入口。只在这里设环境变量,不影响 web 进程和别的访客。"""
    from langgraph.checkpoint.memory import InMemorySaver

    from billsleuth.graph import build_graph
    from billsleuth.llm import estimate_cost
    from billsleuth.loupe_export import LoupeRecorder
    from billsleuth.mcp_bridge import BillingMCP

    tmp = tempfile.mkdtemp()
    t0 = time.perf_counter()
    try:
        db = Path(tmp) / "billing.db"
        shutil.copy(template_db, db)  # 每个访客一份库,互相看不到对方起草的贷记单
        os.environ["BILLSLEUTH_DB"] = str(db)
        os.environ["BILLSLEUTH_SESSION"] = "demo-" + os.urandom(4).hex()
        g = build_graph(mcp=BillingMCP(in_process=True), checkpointer=InMemorySaver())
        rec = LoupeRecorder(f"billsleuth: {question[:40]}", ["billsleuth", "demo"], os.environ.get("LLM_MODEL"))
        cfg = {"recursion_limit": 60, "configurable": {"thread_id": os.environ["BILLSLEUTH_SESSION"]}}
        for update in g.stream({"customer_id": customer_id, "question": question}, cfg, stream_mode="updates"):
            for node, delta in update.items():
                if node == "__interrupt__":
                    continue
                rec.on_update(node, delta)
                for e in _ui_events(node, delta):
                    q.put(e)
        final = g.get_state(cfg).values
        tin, tout = final.get("tokens") or [0, 0]
        q.put({"type": "done", "run_id": rec.id, "loupe": rec.finish(question, final),
               "evidence": final.get("evidence", []), "cost_cny": round(estimate_cost(tin, tout), 4),
               "seconds": round(time.perf_counter() - t0, 1), "escalated": bool(final.get("escalated"))})
    except Exception as e:  # noqa: BLE001
        q.put({"type": "done", "error": f"服务出错:{type(e).__name__}"})
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _spawn(customer_id: str, question: str):
    """起子进程,返回事件队列。测试里会把它换成一个假的。"""
    ctx = mp.get_context("spawn")
    q = ctx.Queue()
    ctx.Process(target=_work, args=(customer_id, question, os.environ.get("DEMO_TEMPLATE_DB", str(db_path())), q),
                daemon=True).start()
    return q


@app.get("/api/scenarios")
def scenarios():
    # 只给客户看得到的字段;truth(根因、多收金额)永远不下发
    return [{"id": k, "customer_id": v["customer_id"], "question": v["question"]} for k, v in _scenarios().items()]


class Body(BaseModel):
    scenario_id: str
    question: str | None = None  # 允许访客改写客户原话,截到 300 字


@app.post("/api/investigate")
async def investigate(body: Body, req: Request):
    sc = _scenarios().get(body.scenario_id)
    if sc is None:
        raise HTTPException(404, "没有这个场景")
    question = (body.question or sc["question"]).strip()[:300]
    if why := _admit(_client_ip(req)):
        return JSONResponse({"error": why}, status_code=429)

    async def stream():
        async with _slots:
            q = _spawn(sc["customer_id"], question)
            loop = asyncio.get_running_loop()
            deadline = time.monotonic() + RUN_TIMEOUT_S
            while True:
                try:
                    ev = await loop.run_in_executor(None, q.get, True, 1.0)
                except queue.Empty:
                    if time.monotonic() > deadline:
                        ev = {"type": "done", "error": "调查超时"}
                    else:
                        continue
                if ev["type"] == "done":
                    with _lock:
                        _spent["cny"] += ev.get("cost_cny", 0.0)
                    if "loupe" in ev:
                        _traces[ev["run_id"]] = ev.pop("loupe")
                yield {"event": ev["type"], "data": json.dumps(ev, ensure_ascii=False, default=str)}
                if ev["type"] == "done":
                    break

    return EventSourceResponse(stream(), ping=15)


@app.get("/api/runs/{run_id}/loupe.jsonl")
def loupe(run_id: str):
    if run_id not in _traces:
        raise HTTPException(404, "没有这次运行(演示服务重启后会清空)")
    return PlainTextResponse(_traces[run_id], media_type="application/x-ndjson")


@app.get("/")
def index():
    return FileResponse(ROOT / "web" / "index.html")
```

逐段说。

**`_ui_events` 把节点更新翻译成页面事件。** `graph.stream(stream_mode="updates")` 每个节点跑完给一次 `{节点名: 这个节点返回的更新}`。页面不需要全部，挑出几类：`locate` 的候选发票，`investigate` 里模型要调的工具(不含 `SubmitFindings`),`tools` 里每个工具的结果，`conclude` 的结论，`write_up` 的两份解释，`request_approval` 起草的贷记单。图跑到审批节点会暂停，流里会出现一个 `__interrupt__`,跳过就行：演示里没有人审批，访客看到「贷记单草稿，等待人工审批」就结束了。

**`_work` 是子进程入口。** 复制库、设环境变量、建图、跑流，把事件放进队列。`_spawn` 用 spawn 方式起进程(macOS 上默认也是 spawn),测试里会把它换掉。web 进程这边，SSE 生成器用 `run_in_executor` 从多进程队列里取事件，每次最多等一秒，这样既不阻塞事件循环，也能检查总超时。

**`/api/scenarios` 只返回三个字段。** id、客户编号、客户原话。`truth` 整个不下发，测试里会断言列表里搜不到 `truth`、`root_cause`、`overcharge` 这几个词。

**`question` 可以改写，但截到 300 字。** 让访客改写客户原话，演示效果会好很多。但这是不可信输入：可能很长，可能是提示词注入。截断控制成本。注入的风险，看一下 BillSleuth 的设计就知道影响有限：模型只有只读工具，只能查这一个客户的数据(Day 124 的 `execute` 里拦了跨客户和不在列表里的发票号),贷记单由代码按校验过的结论起草，而且起草在访客自己的那份临时库里。最坏的情况是一张不会被批的草稿。

**四道保护，顺序有讲究。** `_admit` 先查每日预算，再查 IP 限流；通过后进入生成器，再用信号量限制同时在跑的调查数。预算放最前面，因为它是全局的；信号量包住整个调查过程，跑完才释放。

**取 IP 的那一行。** 部署在 Caddy 或 Cloudflare 后面时，真实 IP 在 `cf-connecting-ip` 或 `x-forwarded-for` 里。但如果服务直接暴露在公网，这两个头是客户端随便写的，攻击者每次换个值就能绕过限流。只在确定前面有可信代理时才信它们。

**预算怎么算。** 每次调查结束，把估算成本加到当天累计里。成本用的是 Day 124 的 `estimate_cost`,按未命中价格算的上限，而且图里只有 `investigate` 节点记了 token,`intake` 和 `write_up` 的调用没记，所以这个数偏低。演示用它做预算够了；要严格控制，就在 `get_llm` 外面包一层，所有调用都记。这是**事后记账**:预算剩一点点时同时进来几个请求都会放行，`MAX_CONCURRENT` 限制了最多超出几次。

**限流、预算、trace 都在内存里。** 重启就清零，多实例之间也不共享。单机演示够用，要扩到多实例就换 Redis。

**审批接口也挂在这里。** `app.include_router(approval_router)` 挂的是 Day 126 的 `approval_api.py`,给内部审批页面用，靠请求头里的令牌鉴权。演示页面本身不调它。

`ping=15` 让 sse-starlette 每 15 秒发一个注释行，防止中间的代理因为连接空闲把它断掉。DeepSeek 忙的时候一次模型调用就可能等几十秒。

## 导出给 Agent Loupe

作品一 Day 112 定了 Agent Loupe 的 SDK 格式：一行 `run_start`,若干行 `step`,一行 `run_end`,一行一个 JSON。BillSleuth 不用 Loupe 的 SDK 去包函数(调查图里的调用都在 LangChain 和 MCP 桥里，不好包),而是从 `stream` 的节点更新里直接拼出这些行：

```python
# billsleuth/billsleuth/loupe_export.py
"""Day 129 新增:把一次调查写成 Agent Loupe SDK 的 JSONL(作品一 Day 112 的格式):
一行 run_start,若干行 step,一行 run_end。拖进 Agent Loupe 就能回放。

数据来自 graph.stream(stream_mode="updates"):每个节点跑完给一次更新。
节点内部没有更细的时间,所以每一步的开始时间记成上一步的结束时间,是近似值。
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from langchain_core.messages import AIMessage, ToolMessage

NODE_KIND = {"intake": "llm", "investigate": "llm", "write_up": "llm", "locate": "other", "nudge": "other",
             "conclude": "other", "request_approval": "tool", "await_approval": "other"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json(text: str) -> Any:
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return text


class LoupeRecorder:
    def __init__(self, name: str, tags: list[str], model: str | None = None) -> None:
        self.id = uuid.uuid4().hex[:12]
        self.model = model
        self.lines: list[dict] = [{"type": "run_start", "id": self.id, "name": name, "started_at": _now(), "tags": tags}]
        self.root_started = self.lines[0]["started_at"]
        self.last = self.root_started
        self.idx = 1                       # 0 号留给根步骤,最后写
        self.calls: dict[str, dict] = {}   # tool_call_id → {name, args},把工具结果和调用对上
        self.status = "ok"

    def _step(self, kind: str, name: str, input: Any, output: Any, **extra: Any) -> None:
        now = _now()
        self.lines.append({"type": "step", "run_id": self.id, "idx": self.idx, "parent_idx": 0, "kind": kind,
                           "name": name, "started_at": self.last, "ended_at": now, "input": input, "output": output,
                           **{k: v for k, v in extra.items() if v is not None}})
        self.idx += 1
        self.last = now

    def on_update(self, node: str, delta: dict) -> None:
        if node == "tools":
            for m in delta.get("messages", []):
                if isinstance(m, ToolMessage):
                    c = self.calls.get(m.tool_call_id, {"name": "?", "args": {}})
                    out = _json(m.content) if isinstance(m.content, str) else m.content
                    err = out[len("[工具报错] "):] if isinstance(out, str) and out.startswith("[工具报错]") else None
                    self._step("tool", c["name"], c["args"], out, error=err)
            return
        if node == "investigate":
            msg = delta["messages"][-1]
            calls = getattr(msg, "tool_calls", None) or []
            for c in calls:
                self.calls[c["id"]] = {"name": c["name"], "args": c.get("args") or {}}
            tin, tout = (delta.get("tokens") or [None, None])
            out = {"role": "assistant", "content": msg.content if isinstance(msg, AIMessage) else str(msg),
                   "tool_calls": [{"id": c["id"], "type": "function",
                                   "function": {"name": c["name"], "arguments": json.dumps(c.get("args") or {},
                                                                                          ensure_ascii=False)}}
                                  for c in calls]}
            self._step("llm", "investigate", None, out, input_tokens=tin, output_tokens=tout, model=self.model)
            return
        if node == "conclude" and delta.get("escalated"):
            self.status = "error"
        payload = {k: v for k, v in delta.items() if k not in ("messages", "evidence")}
        self._step(NODE_KIND.get(node, "other"), node, None, json.loads(json.dumps(payload, default=str)),
                   model=self.model if NODE_KIND.get(node) == "llm" else None)

    def finish(self, question: str, final: dict) -> str:
        end = _now()
        root = {"type": "step", "run_id": self.id, "idx": 0, "parent_idx": None, "kind": "agent",
                "name": "billsleuth.case", "started_at": self.root_started, "ended_at": end,
                "input": {"question": question}, "output": final.get("findings")}
        self.lines.insert(1, root)
        self.lines.append({"type": "run_end", "id": self.id, "ended_at": end, "status": self.status})
        return "".join(json.dumps(x, ensure_ascii=False, default=str) + "\n" for x in self.lines)
```

映射关系：0 号步骤是 `kind="agent"` 的根，名字 `billsleuth.case`;`intake`、`investigate`、`write_up` 是 `llm` 步；每个工具结果是一个 `tool` 步，名字就是工具名，输入是参数，输出是工具返回的 JSON;`locate`、`conclude` 这类纯代码节点记成 `other`;`request_approval` 记成 `tool`。`investigate` 的输出按 Loupe 期望的 assistant 消息格式写，包括 `tool_calls`,这样 Day 116 的逐步对比能认出每一步调了什么。

有两个近似要说明。一是时间：节点内部没有更细的时间，每一步的开始时间记成上一步的结束时间。二是 token:只有 `investigate` 步有。Loupe 的上下文占用可视化(Day 115)需要每次模型调用完整的输入 messages,我们没记，这一块在这份 trace 上用不了。想要完整效果，就在 `investigate` 节点里把发给模型的 messages 也放进更新里。

我在合并后的仓库里，用 Day 129 的服务跑了一次真实调查，把下载的 JSONL 交给作品一的导入器：

```text
200 {'imported': [{'id': '30cf9a0eb08c', 'name': 'billsleuth: 我的信用卡在 9 月 14 日有两笔 123.60 美元的扣款,是不是扣重了?', 'steps': 13}]}
```

这是用作品一的 `create_app` 起一个测试客户端，把文件 POST 到 `/api/import`,导入器按第一行的 `run_start` 认出是 SDK 格式。导入后 run 的状态是 `ok`,模型是 `deepseek-flash`,13 个步骤依次是：

```text
0 agent  billsleuth.case
1 llm    intake
2 other  locate
3 llm    investigate
4 tool   get_customer
5 tool   list_payments
6 llm    investigate
7 tool   recompute_invoice
8 tool   get_invoice
9 llm    investigate
10 other conclude
11 llm   write_up
12 tool  request_approval
```

两次 `investigate` 之间夹着这一轮调的工具，Loupe 的时间轴上一眼就能看出 Agent 每一轮查了什么。Loupe 还按它自己的价格表(Day 113)给这次运行算了一个美元成本，这正是我们导出时故意不填成本的原因：换算交给 Loupe 那边统一做。

## 调查面板

一个 HTML 文件，原生 JS。演示页的交互很简单，用不着构建工具，招聘方点开时也少加载一个框架。如果你做作品一时已经有了 React 组件，把四个面板换成组件就行，事件处理逻辑不变。

```html
<!-- billsleuth/web/index.html -->
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BillSleuth 演示</title>
<style>
  :root { --ink:#1b1f24; --soft:#57606a; --rule:#d0d7de; --paper:#f7f8fa; --raised:#fff; --mem:#2f5bd3; --compute:#b7791f; --bad:#c0392b; --ok:#1f7a4d; }
  @media (prefers-color-scheme: dark) { :root { --ink:#e6e8eb; --soft:#9aa4af; --rule:#30363d; --paper:#0f1216; --raised:#161b22; --mem:#7aa2ff; --compute:#e0a447; --bad:#ff7b72; --ok:#56d364; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--paper); color:var(--ink); font:15px/1.6 system-ui, "PingFang SC", sans-serif; }
  main { max-width:1100px; margin:0 auto; padding:16px; }
  h1 { font-size:20px; margin:8px 0 4px; }
  .muted { color:var(--soft); font-size:13px; }
  .bar { display:flex; gap:8px; flex-wrap:wrap; margin:12px 0; }
  select, textarea, button { font:inherit; color:inherit; background:var(--raised); border:1px solid var(--rule); border-radius:6px; padding:6px 10px; }
  textarea { width:100%; min-height:56px; }
  button { cursor:pointer; } button:disabled { opacity:.5; cursor:wait; }
  .grid { display:grid; grid-template-columns: 1fr 1fr; gap:12px; }
  @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } }
  section { background:var(--raised); border:1px solid var(--rule); border-radius:8px; padding:12px; min-width:0; }
  section h2 { font-size:14px; margin:0 0 8px; color:var(--soft); }
  ol#steps { margin:0; padding-left:20px; font:13px/1.5 ui-monospace, monospace; }
  ol#steps li { margin-bottom:6px; overflow-wrap:anywhere; }
  .tool { color:var(--compute); } .err { color:var(--bad); }
  table { width:100%; border-collapse:collapse; font:13px ui-monospace, monospace; }
  td, th { border-bottom:1px solid var(--rule); padding:4px 6px; text-align:right; }
  td:first-child, th:first-child { text-align:left; }
  .delta-pos { color:var(--bad); font-weight:600; } .delta-zero { color:var(--ok); }
  #reply { white-space:pre-wrap; }
  .tag { display:inline-block; padding:0 6px; border-radius:4px; border:1px solid var(--mem); color:var(--mem); font-size:12px; margin-right:6px; }
  .scroll { max-height:360px; overflow:auto; }
</style>
</head>
<body>
<main>
  <h1>BillSleuth · 计费争议调查 Agent</h1>
  <div class="muted">数据全部虚构。每次运行用一份独立的数据库副本,贷记单只会生成草稿,不会真的退钱。</div>
  <div class="bar">
    <select id="scenario" aria-label="选择场景"></select>
    <button id="go">开始调查</button>
    <span id="status" class="muted" role="status"></span>
  </div>
  <textarea id="question" aria-label="客户来信,可以改写" maxlength="300"></textarea>
  <div class="grid" style="margin-top:12px">
    <section><h2>调查步骤</h2><div class="scroll"><ol id="steps"></ol></div></section>
    <section><h2>复算对比</h2><div id="recompute" class="muted">还没有复算</div></section>
    <section><h2>结论</h2><div id="finding" class="muted">等待结论</div></section>
    <section><h2>证据链</h2><div class="scroll" id="evidence"></div></section>
  </div>
  <p class="muted" id="footer"></p>
</main>
<script>
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let scenarios = [];

async function load() {
  scenarios = await (await fetch("/api/scenarios")).json();
  $("scenario").innerHTML = scenarios.map((s) => `<option value="${esc(s.id)}">${esc(s.id)} · ${esc(s.question.slice(0, 24))}</option>`).join("");
  $("scenario").onchange = () => { $("question").value = scenarios.find((s) => s.id === $("scenario").value).question; };
  $("scenario").onchange();
}

function addStep(html, cls = "") {
  const li = document.createElement("li");
  li.className = cls;
  li.innerHTML = html;
  $("steps").appendChild(li);
  li.scrollIntoView({ block: "nearest" });
}

function showRecompute(r) {
  const cls = (d) => (Number(d) === 0 ? "delta-zero" : "delta-pos");
  const rows = r.by_kind.map((k) => `<tr><td>${esc(k.kind)}</td><td>${esc(k.actual)}</td><td>${esc(k.expected)}</td><td class="${cls(k.difference)}">${esc(k.difference)}</td></tr>`).join("");
  $("recompute").innerHTML = `<table><tr><th>类别</th><th>账单</th><th>应收</th><th>差额</th></tr>${rows}` +
    `<tr><th>合计 ${esc(r.invoice_id)}</th><th>${esc(r.actual_total)}</th><th>${esc(r.expected_total)}</th><th class="${cls(r.difference)}">${esc(r.difference)}</th></tr></table>` +
    `<p class="muted">实际扣款 ${esc(r.paid_total)}(${esc(r.successful_payments)} 笔)` +
    (r.should_exist ? "" : " · 这个周期本不该开票") +
    (r.other_invoices_same_period.length ? ` · 同周期还有 ${esc(r.other_invoices_same_period.join(", "))}` : "") + `</p>`;
}

function handle(type, ev) {
  if (type === "locate") addStep(`候选发票:${esc(ev.candidates.join(", "))}`);
  if (type === "tool_call") addStep(`<span class="tool">${esc(ev.name)}</span>(${esc(JSON.stringify(ev.args))})`);
  if (type === "tool_result") {
    const r = ev.result;
    if (r && r.error) addStep(`↳ ${esc(r.error)}`, "err");
    else if (r && r.by_kind) showRecompute(r);
  }
  if (type === "finding") {
    const f = ev.finding || {};
    $("finding").innerHTML = ev.escalated ? `<span class="err">没有得出合格结论,转人工</span>`
      : `<div><span class="tag">${esc(f.root_cause)}</span><span class="tag">${esc(f.expected_action)}</span>多收 ${esc(f.overcharge)}</div>`;
  }
  if (type === "reply") {
    $("finding").innerHTML += `<p id="reply">${esc(ev.customer_message)}</p><details><summary>内部备注</summary><p>${esc(ev.internal_note)}</p></details>`;
  }
  if (type === "approval") {
    const a = ev.approval;
    addStep(a.credit_note_id ? `↳ 贷记单草稿 ${esc(a.credit_note_id)}(${esc(a.amount)}),等待人工审批` : `↳ 起草被拦下:${esc(a.error)}`);
  }
  if (type === "done") {
    $("evidence").innerHTML = (ev.evidence || []).length
      ? `<table><tr><th>编号</th><th>事实</th><th>值</th></tr>` + ev.evidence.map((e) => `<tr><td>${esc(e.id)}</td><td>${esc(e.claim)}</td><td>${esc(e.value)}</td></tr>`).join("") + `</table>`
      : `<span class="muted">没有证据</span>`;
    $("footer").innerHTML = ev.error ? `<span class="err">${esc(ev.error)}</span>`
      : `花费上限约 ¥${ev.cost_cny},用时 ${ev.seconds}s · <a href="/api/runs/${esc(ev.run_id)}/loupe.jsonl" download="billsleuth-${esc(ev.run_id)}.jsonl">下载 trace,拖进 Agent Loupe 回放</a>`;
  }
}

async function go() {
  $("go").disabled = true; $("status").textContent = "调查中…";
  $("steps").innerHTML = ""; $("recompute").textContent = "还没有复算"; $("finding").textContent = "等待结论"; $("evidence").innerHTML = ""; $("footer").textContent = "";
  try {
    const resp = await fetch("/api/investigate", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario_id: $("scenario").value, question: $("question").value }) });
    if (!resp.ok) { $("status").textContent = (await resp.json()).error || `出错了 ${resp.status}`; return; }
    // POST 请求用不了 EventSource,自己按 SSE 格式切:事件之间空一行,每行 "event: x" 或 "data: {...}"
    const reader = resp.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value.replace(/\r\n/g, "\n");
      let cut;
      while ((cut = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, cut); buf = buf.slice(cut + 2);
        let type = "message", data = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) type = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (data) handle(type, JSON.parse(data));
      }
    }
    $("status").textContent = "完成";
  } catch (e) {
    $("status").textContent = "连接断了:" + e.message;
  } finally {
    $("go").disabled = false;
  }
}
$("go").onclick = go;
load();
</script>
</body>
</html>
```

几个要点。

**为什么不用 EventSource。** 它只支持 GET,不能带请求体。我们要把场景编号和改写后的客户原话 POST 上去，只能用 `fetch` 读流、自己按 SSE 格式切。注意把 `\r\n` 换成 `\n`:sse-starlette 默认用 `\r\n` 做行尾，我抓下来的原始字节里确实是 `\r\n`,不换的话 `indexOf("\n\n")` 永远找不到分隔。

**所有动态内容都过 `esc()`。** 工具返回里有客户名、行项目描述，结论里有模型写的回复，这些都会被拼进 `innerHTML`。访客能改写客户原话，模型的回复可能引用原话。拼进 HTML 的东西全部转义；只往 `textContent` 里放的可以不转。

**复算对比表是主角。** Day 123 的 `recompute_invoice` 返回 `by_kind`:每一类(订阅费、折算、折扣、税)的应收、实收、差额。表格把它摆出来，差额非零的标红，下面一行写实际扣款合计和笔数，`should_exist` 为假时注明「这个周期本不该开票」,`other_invoices_same_period` 不为空时写出同周期的其他发票。招聘方看不懂一长串工具调用，但这张表一眼就懂。

**手机上也要能看。** 两栏布局在 760 像素以下变一栏，长 JSON 用 `overflow-wrap: anywhere` 断行。

## 测试

演示服务的测试不调模型，也不起子进程，把 `_spawn` 换成一个往普通队列里放三个事件的假函数：

```python
# billsleuth/tests/test_web.py
"""Day 129:演示服务。把起子进程那一步换成假的,不调模型。"""
import importlib
import json
import queue

from fastapi.testclient import TestClient


def fake_spawn(customer_id, question):
    q = queue.Queue()
    for e in [{"type": "tool_call", "name": "recompute_invoice", "args": {"invoice_id": "INV-0001-05"}},
              {"type": "finding", "finding": {"root_cause": "cancel_not_respected"}, "escalated": False},
              {"type": "done", "run_id": "r1", "loupe": '{"type": "run_start"}\n', "evidence": [],
               "cost_cny": 0.01, "seconds": 1.0, "escalated": False}]:
        q.put(e)
    return q


def load(monkeypatch, **env):
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    import billsleuth.web as web
    importlib.reload(web)  # 限流参数和信号量是模块加载时读的
    monkeypatch.setattr(web, "_spawn", fake_spawn)
    return web


def test_truth_not_leaked_and_sse_order(monkeypatch):
    web = load(monkeypatch)
    cl = TestClient(web.app)
    listing = cl.get("/api/scenarios").text
    assert "truth" not in listing and "root_cause" not in listing and "overcharge" not in listing
    with cl.stream("POST", "/api/investigate", json={"scenario_id": "S001"}) as r:
        body = "".join(r.iter_text())
    events = [ln.split(":", 1)[1].strip() for ln in body.splitlines() if ln.startswith("event:")]
    assert events == ["tool_call", "finding", "done"]
    done = json.loads([ln for ln in body.splitlines() if ln.startswith("data:")][-1][5:])
    assert "loupe" not in done  # trace 不随事件下发,单独下载
    assert cl.get("/api/runs/r1/loupe.jsonl").text.startswith('{"type": "run_start"}')


def test_rate_limit_and_budget(monkeypatch):
    web = load(monkeypatch, PER_IP_PER_HOUR="1")
    assert web._admit("1.2.3.4") is None
    assert "每小时" in web._admit("1.2.3.4")
    web._spent["cny"] = 999
    assert "额度" in web._admit("5.6.7.8")
```

第一个测试检查三件事：场景列表里没有标准答案；SSE 事件按顺序到达，以 `done` 结束；trace 不随 `done` 事件下发(它可能很大),要单独下载。第二个测试检查限流和预算，用 `importlib.reload` 重新加载模块，因为限流参数和信号量是模块加载时读的。

导出格式单独测，用 Day 124 的剧本假模型跑一遍完整的图，检查行的类型、每一步的必填字段、父子关系，以及 `recompute_invoice` 那一步的输入输出：

```python
# billsleuth/tests/test_loupe_export.py
"""Day 129:导出的 JSONL 符合 Agent Loupe SDK 的格式(Day 112):run_start、step……、run_end。"""
import json

from langgraph.checkpoint.memory import InMemorySaver

from billsleuth.graph import Intake, build_graph
from billsleuth.loupe_export import LoupeRecorder
from billsleuth.mcp_bridge import BillingMCP
from tests.test_approval import GOOD, SCRIPT
from tests.test_graph import ScriptedLLM

STEP_KEYS = {"type", "run_id", "idx", "parent_idx", "kind", "name", "started_at", "ended_at", "input", "output"}


def test_export_matches_sdk_format(billing_db):
    llm = ScriptedLLM(Intake(complaint="取消后仍扣款", amount="174.90", month=9), list(SCRIPT), explanation=GOOD)
    g = build_graph(llm=llm, mcp=BillingMCP(in_process=True), checkpointer=InMemorySaver())
    cfg = {"recursion_limit": 40, "configurable": {"thread_id": "case-x"}}
    rec = LoupeRecorder("t", ["billsleuth"], "fake")
    for update in g.stream({"customer_id": "C-0001", "question": "9 月还扣了 174.90"}, cfg, stream_mode="updates"):
        for node, delta in update.items():
            if node != "__interrupt__":
                rec.on_update(node, delta)
    lines = [json.loads(x) for x in rec.finish("q", g.get_state(cfg).values).splitlines()]
    assert lines[0]["type"] == "run_start" and lines[-1]["type"] == "run_end"
    steps = [x for x in lines if x["type"] == "step"]
    assert all(STEP_KEYS <= set(s) for s in steps)
    assert steps[0]["kind"] == "agent" and all(s["parent_idx"] == 0 for s in steps[1:])
    names = [s["name"] for s in steps]
    assert "recompute_invoice" in names and "request_approval" in names
    tool = next(s for s in steps if s["name"] == "recompute_invoice")
    assert tool["input"] == {"invoice_id": "INV-0001-05"} and tool["output"]["difference"] == "174.90"
```

`uv run pytest -q`,全部通过。

## 本地跑起来

```bash
uv add fastapi uvicorn sse-starlette
uv run python -m billsleuth.seed
uv run uvicorn billsleuth.web:app --port 8000
```

浏览器打开 `http://localhost:8000`。也可以先用 curl 看原始事件流：

```bash
curl -N -X POST localhost:8000/api/investigate -H 'content-type: application/json' -d '{"scenario_id":"S001"}'
```

我用 DeepSeek 跑 S017(重复扣款),这次调查收到 14 个事件：1 个 `locate`、4 个 `tool_call`、4 个 `tool_result`、1 个 `finding`、1 个 `reply`、1 个 `approval`、1 个 `done`。Agent 调了 `get_customer`、`list_payments`、`recompute_invoice`、`get_invoice` 四个工具；`recompute_invoice` 的结果里，Day 128 加的 `overpaid` 是 `123.60`。结论是 `duplicate_charge`,多收 `123.60`,贷记单草稿 `CN-0001` 开在 `INV-0017-05` 上，幂等键以 `demo-` 开头的会话号打头。整个调查 20.5 秒，`done` 事件里的成本上限是 ¥0.0244,证据链 35 条。

`locate` 事件里的候选发票有四张(`INV-0017-03` 到 `06`),因为客户只说了金额，几张发票的总额都是 123.60。真正的判断是模型在调查循环里做的。

20 秒对演示来说偏长，好在 SSE 让这 20 秒是「看着 Agent 一步步查」,不是盯着转圈的图标。DeepSeek 忙的时候会更久，Day 127 冒烟时就遇到过一次调用排队 15 分钟的情况，`RUN_TIMEOUT_S` 设成 180 秒，超了就给页面一个「调查超时」。

## 部署方式一：云服务器 + Docker Compose + Caddy

和 Day 53 部署 SupportPilot 是同一套。

```dockerfile
# billsleuth/Dockerfile
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.8.17 /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY billsleuth ./billsleuth
COPY web ./web
# 演示用的库和 100 个场景在构建时生成,镜像里是只读模板;每次调查复制到 /tmp
RUN uv run --no-dev python -m billsleuth.seed
ENV DEMO_TEMPLATE_DB=/app/billing.db
EXPOSE 8000
CMD ["uv", "run", "--no-dev", "uvicorn", "billsleuth.web:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
```

```yaml
# billsleuth/docker-compose.yml
services:
  app:
    build: .
    env_file: .env          # LLM_BASE_URL / LLM_API_KEY / LLM_MODEL / DAILY_BUDGET_CNY / APPROVER_TOKENS
    restart: unless-stopped
    read_only: true         # 容器根文件系统只读,只有 /tmp 能写
    tmpfs: [/tmp]
  caddy:
    image: caddy:2
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
    restart: unless-stopped
volumes:
  caddy_data:
```

```text
# billsleuth/Caddyfile
billsleuth.example.com {
	encode gzip
	reverse_proxy app:8000
}
```

演示用的库和场景在**构建镜像时生成**,镜像里是只读模板，每次调查复制到 `/tmp`。容器根文件系统只读，只给 `/tmp` 挂 tmpfs。Caddy 自动申请 HTTPS 证书，把域名换成你的，DNS 指到服务器。Caddy 看到 `text/event-stream` 会立即往下推，SSE 不用额外配置。`.env` 里放 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`、`LLM_EXTRA_BODY`、`LLM_PRICE`,以及 `DAILY_BUDGET_CNY`、`PER_IP_PER_HOUR`、`MAX_CONCURRENT`、`APPROVER_TOKENS`。

然后 `docker compose up -d --build`。我这台机器没装 Docker,镜像构建这一步没有实测；如果 `uv sync --frozen` 报 lockfile 不一致，先在本地 `uv lock` 再提交。服务器在国内的话，域名要备案才能用 80 和 443 端口。

## 部署方式二:Fly.io

```toml
# billsleuth/fly.toml
app = "billsleuth-demo"
primary_region = "sin"

[build]

[env]
  DAILY_BUDGET_CNY = "5"
  PER_IP_PER_HOUR = "6"
  MAX_CONCURRENT = "3"

[http_service]
  internal_port = 8000
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  size = "shared-cpu-1x"
  memory = "1gb"
```

```bash
fly launch --no-deploy
fly secrets set LLM_API_KEY=sk-... LLM_BASE_URL=https://api.deepseek.com LLM_MODEL=deepseek-flash
fly deploy
fly scale count 1               # 限流和预算在内存里，只能跑一台
```

`primary_region = "sin"` 是新加坡，从国内和东南亚访问都还行。`memory = "1gb"` 是因为每次调查一个子进程，每个都要导入 LangChain,512MB 同时跑三个会紧张。`auto_stop_machines` 让没人访问时机器停掉，代价是第一个访客要等冷启动。价格和免费额度变化很快，部署前去定价页确认。

页面和 API 同源，不用配 CORS。如果你想把页面放到个人网站上(比如 Cloudflare Pages)而 API 在另一个域名，要给 FastAPI 加 CORS 中间件，只允许你网站的域名。作品一 Day 119 部署 Agent Loupe 时讲的是同一件事。

## 上线检查清单

| 项 | 怎么确认 |
| --- | --- |
| 标准答案不泄露 | `curl /api/scenarios` 里搜不到 `truth`、`root_cause`、`overcharge` |
| 限流生效 | 同一个 IP 连续发 7 次，第 7 次拿到 429 |
| 预算生效 | 临时把 `DAILY_BUDGET_CNY` 设成 0.001,跑一次后第二次拿到 429 |
| 真实 IP | 从两台不同网络的设备访问，日志里 IP 不同 |
| 访客隔离 | 两个浏览器同时跑同一个场景，都能起草出贷记单 |
| HTTPS | 地址栏有锁,`http://` 自动跳到 `https://` |
| SSE 不被缓冲 | 步骤一条条出现，不是最后一起出现 |
| XSS | 在客户原话里写 `<b>test</b>`,页面上原样显示尖括号 |
| 手机 | 单栏布局，没有横向滚动 |
| 密钥 | `.env` 不在 git 里，`APPROVER_TOKENS` 是长随机串 |
| 额度用完时 | 页面上有一句人话，不是白屏 |
| trace 导出 | 下载的 JSONL 能拖进 Agent Loupe 打开 |

「额度用完时」值得多做一点：录几次好的调查，把导出的 JSONL 存成静态文件，额度用完时前端改成播放录像。这样即使当天被刷爆了，招聘方也能看到完整过程。这个留作练习。

## 动手练习

1. 写 `billsleuth/web.py`、`billsleuth/loupe_export.py`、`web/index.html`。
2. 写 `tests/test_web.py`、`tests/test_loupe_export.py`,`uv run pytest -q` 全过。
3. 本地跑起来，用 curl 看原始事件流，再用浏览器跑三个不同类型的场景(一个重复扣款、一个税率、一个账没错),截图。
4. 两个浏览器同时跑同一个场景，确认都能起草出贷记单。
5. 下载一次调查的 JSONL,在 Agent Loupe 里导入并回放。
6. 按方式一或方式二部署上线，逐项过检查清单。
7. 选做：额度用完时，前端改为播放预先录好的 trace。

**验收标准:**公网链接能打开，手机上也正常；跑一次调查能看到步骤逐条出现、复算对比表、结论和证据链；检查清单全部打勾；trace 能在 Agent Loupe 里打开；标准答案不能从任何接口拿到。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| SSE | 服务器通过一个长连接持续向浏览器推送文本事件的协议 |
| sse-starlette | 给 Starlette/FastAPI 用的 SSE 响应库，处理格式、心跳和断开 |
| stream_mode="updates" | LangGraph 的流模式，每个节点跑完给一次该节点返回的更新 |
| spawn | 起子进程的一种方式，子进程从头导入模块，不继承父进程的内存 |
| 多进程队列 | `multiprocessing.Queue`,进程之间传消息 |
| 信号量 | 限制同时进入某段代码的协程数量 |
| 事后记账 | 先放行、执行完再扣预算，可能小幅超支 |
| XSS | 跨站脚本，把不可信内容当 HTML 插进页面导致脚本执行 |
| tmpfs | 挂载在内存里的临时文件系统 |
| JSONL | 一行一个 JSON 对象的文本格式 |

## 常见误区

**用线程跑调查。** 库路径和会话号是环境变量，两个访客的线程会互相覆盖，A 的 Agent 会去查 B 的库。用子进程。

**所有访客共用一个库。** 第一个访客起草的贷记单会挡住第二个访客。

**场景接口原样返回场景文件。** `truth` 就这么公开了。只返回客户能看到的字段，写测试保证。

**无条件信任 X-Forwarded-For。** 没有可信代理时这个头是客户端随便写的，限流形同虚设。

**限流和预算只做一个。** 只有限流，换 IP 就能刷；只有预算，一个人就能用完全天额度。

**把 trace 塞进 SSE 的最后一个事件。** 它可能很大，前端也不需要实时拿到。单独一个下载接口。

**额度用完就白屏。** 招聘方只会觉得项目是坏的。给一句人话，最好有录像回放。

## 学习资料

### 文档与文章

- [MDN · Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events):SSE 的格式，`event:`、`data:`、空行分隔都在这里，15 分钟。
- [sysid/sse-starlette](https://github.com/sysid/sse-starlette):README 里讲了 ping、断开检测和与 FastAPI 的配合，15 分钟。
- [FastAPI · Custom Response](https://fastapi.tiangolo.com/advanced/custom-response/):StreamingResponse、FileResponse、PlainTextResponse 的用法，10 分钟。
- [Caddy · reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy):反向代理指令，包括流式响应和转发头，15 分钟。
- [Fly.io · Python](https://fly.io/docs/python/):用 Dockerfile 部署 Python 应用、设置 secrets、扩缩容，20 分钟。
- [Docker Compose 文档](https://docs.docker.com/compose/):`read_only`、`tmpfs`、`env_file` 几个字段。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV15F7J6dEdm&autoplay=0&high_quality=1" title="别再只会 HTTP 了，SSE 才是 AI 流式输出的答案" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>懂点AI的H先生 · 别再只会 HTTP 了,SSE 才是 AI 流式输出的答案 · 20 分钟，讲 SSE 协议和它为什么适合 AI 应用，对应今天的事件流设计。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1y2ZiY8Efe&autoplay=0&high_quality=1" title="【Deepseek合集】开发FastAPI实现流式服务的输出" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>蚂蚁学Python · 【Deepseek合集】开发FastAPI实现流式服务的输出 · 11 分钟，用 FastAPI 接 DeepSeek 做流式输出，和今天的技术栈一致。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/4HlNv1qpZFY" title="Server-Sent Events Crash Course" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hussein Nasser · Server-Sent Events Crash Course · 从 HTTP 层面讲 SSE 的原理、优缺点和代理带来的问题，英文。</figcaption>
</figure>

### 书籍

- Bill Lubanovic《FastAPI: Modern Python Web Development》(O'Reilly, 2023):第 4 章讲 async 和并发，第 13 章讲部署，适合补今天进程、线程和事件循环那一段的背景。

### 开源项目与代码

- [fastapi/fastapi](https://github.com/fastapi/fastapi):搜 `run_in_threadpool`,对照我们用 `run_in_executor` 从多进程队列里取事件。
- [caddyserver/caddy](https://github.com/caddyserver/caddy):README 里的自动 HTTPS 说明，5 分钟。

## 自测

1. 为什么演示服务每次调查要起一个子进程，而不是像 Day 49 那样开线程？

<details><summary>答案</summary>

库路径 `BILLSLEUTH_DB` 和审计会话号 `BILLSLEUTH_SESSION` 是环境变量，MCP server 调工具时现读。环境变量整个进程共享，两个访客的线程会互相覆盖，一个访客的 Agent 会去查另一个访客的库副本。子进程各有一份环境变量，顺带也隔离了内存和崩溃。代价是每次一两秒的启动时间。

</details>

2. 演示服务有哪几道保护？各防什么？

<details><summary>答案</summary>

每日预算：防全天花费失控，全局生效；按 IP 限流：防单个访客刷爆额度；并发信号量：防同时跑太多调查压垮机器或触发 503;每次调查一份库副本：防访客之间互相影响。另外还有输入截到 300 字(控制成本)和 truth 不下发(防评测集泄露)。

</details>

3. 访客在客户原话里写了一段提示词注入，最坏会发生什么？为什么？

<details><summary>答案</summary>

影响有限。模型只有只读工具，Day 124 的 execute 拦了跨客户查询和不在列表里的发票号；贷记单由代码按校验过的结论起草，不是模型调用；起草发生在这个访客自己的临时库副本里，调查结束就删掉，而且只有 draft,没人审批。最坏是页面上出现一张不会被批的草稿、一段写得奇怪的回复。

</details>

4. 导出给 Agent Loupe 的 trace 有哪些近似？要补齐需要改哪里？

<details><summary>答案</summary>

时间：节点内部没有更细的时间，每一步的开始时间是上一步的结束时间。token:只有 investigate 步有，intake 和 write_up 没记。上下文：没有记每次模型调用的完整输入 messages,Loupe 的上下文占用可视化用不了。要补齐，可以在 investigate 节点把发给模型的 messages 放进更新里，并在 get_llm 外面包一层记录所有调用的 token 和耗时。

</details>

5. 资深面试题：演示上线后，有人写脚本每分钟换一个 IP 来刷，预算上午就被用完了。你会怎么改？

<details><summary>答案</summary>

先看日志确认模式：IP 是不是来自同一批 ASN 或机房段、User-Agent 是否一致、是否只跑某几个场景。短期：入口加人机验证(比如 Cloudflare Turnstile),通过后发一个短期令牌，按令牌而不是 IP 限流；机房 IP 段配额调低；预算拆成按小时的子预算。中期：额度用完或流量异常时改为播放录好的回放，保证真实访客总能看到东西；降低单次成本(换更便宜的模型、缓存热门场景的结果)。取舍：人机验证会让招聘方多点一下，可以只在流量异常时启用。最后加监控：每小时花费超过阈值就告警。

</details>

6. 前端自己解析 SSE 时有什么坑？

<details><summary>答案</summary>

POST 请求不能用 EventSource,要用 fetch 读流，按空行切事件，每行按 `event:`、`data:` 前缀取值。sse-starlette 默认行尾是 `\r\n`,要先换成 `\n`,否则找不到 `\n\n`,一个事件都解析不出来。一个 chunk 里可能有半个事件，要留在缓冲区里等下一个 chunk。

</details>

## 明天预告

明天(Day 130)是**作品篇结业**:把 BillSleuth 包装成案例页、写好两分钟的演示视频脚本，练习在 FDE 面试里怎么讲这个项目(客户场景、方案、指标、取舍),看看两个作品在简历和个人网站上怎么摆，再用前几天抓的 FDE 和外企岗位数据，聊聊该投哪些岗位。
