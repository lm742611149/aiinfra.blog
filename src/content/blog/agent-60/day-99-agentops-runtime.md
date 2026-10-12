---
title: 'Day 99 · AgentOps(三):持久化运行时与长任务'
description: '一张要等主管审批的退款工单,可能挂起两个小时;一个 worker 进程,可能在第五步的时候被重新部署杀掉。今天写一个最小的持久化运行时:每一步按幂等键落库,重放时已完成的步骤直接取结果;租约机制让死掉的 worker 的任务被别人接手;遇到审批就挂起,批准后从断点继续。'
pubDate: 2026-10-12
regime: none
tags: ['agentops', 'durable-execution', 'idempotency', 'lease', 'long-running', 'agent-60']
series: 'agent-60'
day: 99
lang: 'zh'
---

## 今天要解决的问题

SupportPilot 处理一张退款工单,中间要停下来等主管批准。基础篇里我们用 LangGraph 的 checkpointer 和 interrupt 解决了这件事(Day 25、47)。但放到平台上,问题变大了:十个租户的 Agent 同时在跑,有的等审批等两个小时,有的是跑二十分钟的数据核对任务;平台每天要部署两三次,每次部署都会杀掉正在跑的 worker 进程。如果任务状态只在进程内存里,每次部署都会丢一批任务,更糟的是,有些任务已经执行了一半的写操作。

今天做 AgentOps 的第三个子系统:持久化运行时。Day 65 讲过持久化执行的概念和 Temporal、Restate、DBOS 这些框架,今天用大约 300 行代码自己实现一个最小版本,目的是把原理吃透,面试时能讲清楚每一个保证是怎么来的、代价是什么。学完以后你应该能:

1. 解释「步骤日志加重放」这种持久化执行模型,以及它对 Agent 代码提出的确定性要求。
2. 实现按幂等键记录的步骤:已完成的步骤重放时直接返回结果,不重复调模型、不重复调工具。
3. 用租约实现 worker 故障接管,并说清楚租约机制的漏洞和补救办法。
4. 把 Day 98 的审批接进来:遇到需要审批的工具就挂起任务,批准后从断点继续。
5. 区分「至少一次」和「恰好一次」,知道哪一段还需要上游配合。

预计用时 6 到 7 小时。前置:Day 25 的 interrupt 和 checkpoint;Day 37 的队列、幂等、超时;Day 65 的持久化执行概念;Day 98 的工具中心和审批。

## 持久化执行到底在持久化什么

先把核心想法说清楚,后面的代码都是它的展开。

一个 Agent 任务可以看成一段普通的程序:调模型、根据结果调工具、再调模型。这段程序的问题在于,它中间有很多「外部调用」,每一次都可能慢、可能失败、可能花钱、可能有副作用。如果程序跑到一半进程死了,最朴素的办法是从头再跑一遍,但从头跑意味着模型被重新问一遍(又花一次钱,而且可能给出不同的答案),工具被重新调一遍(退款可能被执行两次)。

持久化执行的思路是:把每一次外部调用的结果记下来,形成一份步骤日志。进程死了,新进程从头执行同一段程序,但每次走到一个外部调用,先查日志:这一步做过了,就直接拿日志里的结果,不再真的调用;没做过,才真正调用并记录结果。这样程序会「快进」到上次停下的地方,然后继续往下走。

<figure>
<svg viewBox="0 0 640 280" role="img" aria-label="重放示意:第一次执行到第三步时进程死掉,第二次执行时前两步从日志读取,第三步开始真正执行">
  <g font-family="var(--font-mono)" font-size="12">
    <text x="10" y="30" fill="var(--ink)">第 1 次执行(attempt 1)</text>
    <rect x="10" y="42" width="110" height="36" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="65" y="65" text-anchor="middle" font-size="11" fill="var(--ink)">llm:classify</text>
    <rect x="130" y="42" width="130" height="36" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="195" y="65" text-anchor="middle" font-size="11" fill="var(--ink)">tool:list_invoices</text>
    <rect x="270" y="42" width="110" height="36" rx="4" fill="var(--paper-raised)" stroke="var(--rule)" stroke-dasharray="4 3"/>
    <text x="325" y="65" text-anchor="middle" font-size="11" fill="var(--ink-faint)">tool:refund</text>
    <text x="400" y="65" font-size="11" fill="var(--compute)">进程被杀</text>
    <text x="10" y="120" fill="var(--ink)">步骤日志(steps 表)</text>
    <rect x="10" y="132" width="250" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="22" y="150" font-size="11" fill="var(--ink-soft)">classify   done  {category: refund}</text>
    <text x="22" y="168" font-size="11" fill="var(--ink-soft)">list_invoices  done  {INV-2290, INV-2291}</text>
    <text x="10" y="216" fill="var(--ink)">第 2 次执行(attempt 2,可能在另一台机器)</text>
    <rect x="10" y="228" width="110" height="36" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
    <text x="65" y="251" text-anchor="middle" font-size="11" fill="var(--ink-faint)">读日志</text>
    <rect x="130" y="228" width="130" height="36" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
    <text x="195" y="251" text-anchor="middle" font-size="11" fill="var(--ink-faint)">读日志</text>
    <rect x="270" y="228" width="110" height="36" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="325" y="251" text-anchor="middle" font-size="11" fill="var(--ink)">tool:refund</text>
    <rect x="390" y="228" width="110" height="36" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="445" y="251" text-anchor="middle" font-size="11" fill="var(--ink)">llm:draft</text>
    <line x1="135" y1="176" x2="135" y2="228" stroke="var(--rule)" stroke-dasharray="3 3"/>
  </g>
</svg>
<figcaption>第二次执行同一段代码,前两步命中日志直接返回(灰色),不花钱、不产生副作用,从第三步开始才真正调用外部系统。</figcaption>
</figure>

这个模型有一个前提,也是使用它的人最容易踩的坑:**程序必须是确定性的**。给定同样的步骤结果,程序每次都要走同样的路径、生成同样的步骤 key。如果你在两个步骤之间写了 `if random.random() > 0.5` 或者 `if datetime.now().hour > 18`,第二次执行可能走另一条分支,日志就对不上了。Temporal 文档里有整整一章讲 workflow 代码的确定性约束,原因就在这里。我们的规则是:所有不确定的东西(模型输出、工具结果、当前时间、随机数)都必须通过 `ctx` 的某个步骤方法拿到,这样它们的值就被记进了日志。

## 数据层:任务和步骤

表在 Day 96 已经定义好了(`runs` 和 `steps`)。存储层的代码:

```python
# agentops/src/agentops/runtime/store.py
"""运行时的全部状态都在数据库里:runs 是任务,steps 是每一步的记录。进程是无状态的,随时可以杀。"""
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, insert, or_, select, update
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from agentops.db import runs, steps


def _now() -> datetime:
    return datetime.now(UTC)


class RunStore:
    def __init__(self, engine: Engine, clock=_now):
        self.engine = engine
        self.clock = clock

    # ---- 任务 ----
    def create(self, tenant_id: str, agent: str, payload: dict) -> str:
        rid = "r_" + secrets.token_hex(8)
        with self.engine.begin() as c:
            c.execute(insert(runs).values(id=rid, tenant_id=tenant_id, agent=agent, status="queued", input=payload,
                                          attempts=0, updated_at=self.clock()))
        return rid

    def get(self, run_id: str, tenant_id: str | None = None) -> dict | None:
        q = select(runs).where(runs.c.id == run_id)
        if tenant_id is not None:                       # API 层永远带租户查,防跨租户读
            q = q.where(runs.c.tenant_id == tenant_id)
        with self.engine.connect() as c:
            row = c.execute(q).mappings().first()
        return dict(row) if row else None

    def claim(self, worker: str, lease_s: int = 60) -> dict | None:
        """领一个任务:排队中的,或者租约过期的 running(上一个 worker 死了)。乐观并发,抢不到就换下一个。"""
        now = self.clock()
        with self.engine.connect() as c:
            candidates = c.execute(
                select(runs.c.id).where(or_(runs.c.status == "queued",
                                            and_(runs.c.status == "running", runs.c.lease_until < now)))
                .order_by(runs.c.created_at).limit(10)).scalars().all()
        for rid in candidates:
            with self.engine.begin() as c:
                n = c.execute(update(runs).where(
                    runs.c.id == rid,
                    or_(runs.c.status == "queued", and_(runs.c.status == "running", runs.c.lease_until < now)),
                ).values(status="running", lease_owner=worker, lease_until=now + timedelta(seconds=lease_s),
                         attempts=runs.c.attempts + 1, updated_at=now)).rowcount
            if n == 1:
                return self.get(rid)
        return None

    def heartbeat(self, run_id: str, worker: str, lease_s: int = 60) -> bool:
        """续租。返回 False 说明租约已经被别人抢走,当前 worker 必须停手。"""
        now = self.clock()
        with self.engine.begin() as c:
            return c.execute(update(runs).where(runs.c.id == run_id, runs.c.lease_owner == worker,
                                                runs.c.status == "running")
                             .values(lease_until=now + timedelta(seconds=lease_s), updated_at=now)).rowcount == 1

    def set_status(self, run_id: str, status: str, *, worker: str | None = None, output: dict | None = None,
                   error: str | None = None) -> bool:
        cond = [runs.c.id == run_id]
        if worker is not None:                          # 只有持有租约的 worker 能改终态
            cond.append(runs.c.lease_owner == worker)
        with self.engine.begin() as c:
            return c.execute(update(runs).where(*cond).values(status=status, output=output, error=error,
                                                             lease_owner=None, lease_until=None,
                                                             updated_at=self.clock())).rowcount == 1

    # ---- 步骤 ----
    def get_step(self, run_id: str, key: str) -> dict | None:
        with self.engine.connect() as c:
            row = c.execute(select(steps).where(steps.c.run_id == run_id, steps.c.key == key)).mappings().first()
        return dict(row) if row else None

    def put_step(self, run_id: str, key: str, kind: str, request: dict, result, status: str) -> None:
        with self.engine.begin() as c:
            existing = c.execute(select(steps.c.seq).where(steps.c.run_id == run_id, steps.c.key == key)).scalar()
            if existing is not None:
                c.execute(update(steps).where(steps.c.run_id == run_id, steps.c.key == key)
                          .values(request=request, result=result, status=status))
                return
            seq = (c.execute(select(steps.c.seq).where(steps.c.run_id == run_id).order_by(steps.c.seq.desc())
                             .limit(1)).scalar() or 0) + 1
            try:
                c.execute(insert(steps).values(run_id=run_id, seq=seq, kind=kind, key=key, request=request,
                                               result=result, status=status))
            except IntegrityError:
                # (run_id, key) 唯一约束:两个 worker 同时写同一步,后到的放弃。数据库是最后一道幂等保险
                raise StepConflict(key) from None

    def list_steps(self, run_id: str) -> list[dict]:
        with self.engine.connect() as c:
            return [dict(r) for r in c.execute(select(steps).where(steps.c.run_id == run_id)
                                               .order_by(steps.c.seq)).mappings()]


class StepConflict(Exception):
    pass
```

逐个看关键的方法。

**`claim`:领任务。** 能领的任务有两种:排队中的,以及状态是 running 但租约已经过期的。后者就是「上一个 worker 死了」的情况。领取用的是乐观并发:先查出候选,再用带条件的 UPDATE 抢,条件里重复写一遍「状态和租约仍然满足」,`rowcount == 1` 才算抢到。两个 worker 同时抢同一个任务,数据库保证只有一个 UPDATE 生效。生产上用 Postgres 时可以换成 `SELECT ... FOR UPDATE SKIP LOCKED`,效率更高,我们这里为了 SQLite 测试能跑,用了更通用的写法。

**`heartbeat`:续租。** worker 在执行期间每隔租约的三分之一时间续一次。续租同样是带条件的 UPDATE:只有租约仍然属于自己才能续。返回 False 就说明自己已经被判定为死亡、任务被别人接手了,应该立即停手。

**`set_status` 的 worker 参数。** 改终态时要求租约属于自己。这防住了一个经典场景:worker A 因为长时间 GC 停顿或者网络分区卡了两分钟,租约过期,worker B 接手并完成了任务;A 醒来后接着跑,想把状态改成 succeeded 或 failed,这时条件不满足,改不动。

**`put_step` 和唯一约束。** `(run_id, key)` 的唯一约束是幂等的最后一道保险。正常流程下同一个 key 只会写一次,但如果真出现两个 worker 同时执行同一步,后到的插入会失败,抛出 `StepConflict`,worker 收到后放弃这个任务。

## 租约的漏洞

这里必须诚实地讲一个问题,面试时讲出来是加分项:租约机制不能完全防止两个 worker 同时执行。

worker A 卡住、租约过期、B 接手,这时 A 还没意识到自己已经失去租约(它的下一次心跳还没到),A 和 B 会在一小段时间里同时执行同一个任务。我们的 `set_status` 挡住了 A 修改终态,唯一约束挡住了 A 和 B 写同一个 key 的步骤,但挡不住 A 已经发出去的外部调用,比如 A 和 B 都调用了一次工具。

Martin Kleppmann 在一篇关于分布式锁的文章里讲过这个问题,解决办法叫 fencing token:每次领取租约时分配一个单调递增的编号,外部系统只接受编号不小于它见过的最大编号的请求。这要求下游配合。在我们的系统里,更实用的补救是让写操作本身幂等(下一节),这样即使被调用两次,效果也只有一次。

## 运行时的核心:RunContext

Agent 代码不直接调模型、不直接调工具,而是通过 `RunContext` 的方法:

```python
# agentops/src/agentops/runtime/harness.py
"""Agent 代码通过 RunContext 做所有有副作用的事。每一步按 key 记账:做过的直接返回结果,不再执行。"""
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from agentops.mcphub.audit import args_hash
from agentops.runtime.store import RunStore


class Suspend(Exception):
    """要等人。运行时捕获它,把任务置为 waiting_human。"""
    def __init__(self, key: str, reason: str):
        super().__init__(reason)
        self.key, self.reason = key, reason


LlmFn = Callable[[list[dict], str], Awaitable[dict]]                  # (messages, route) -> 响应 JSON
ToolFn = Callable[[str, str, dict, str | None], Awaitable[dict]]      # (server, tool, args, approval_id) -> 结果


@dataclass
class RunContext:
    store: RunStore
    run_id: str
    tenant_id: str
    llm_fn: LlmFn
    tool_fn: ToolFn

    async def llm(self, key: str, messages: list[dict], route: str = "fast") -> dict:
        prev = self.store.get_step(self.run_id, key)
        if prev and prev["status"] == "done":
            return prev["result"]                       # 重放:模型不会被再问一次,也不会再花一次钱
        resp = await self.llm_fn(messages, route)
        self.store.put_step(self.run_id, key, "llm", {"route": route, "n_messages": len(messages)}, resp, "done")
        return resp

    async def tool(self, key: str, server: str, name: str, arguments: dict) -> dict:
        prev = self.store.get_step(self.run_id, key)
        if prev and prev["status"] == "done":
            return prev["result"]
        approval_id = (prev or {}).get("request", {}).get("approval_id") if prev else None
        if prev and prev["status"] == "waiting" and not approval_id:
            raise Suspend(key, "still waiting for approval")
        result = await self.tool_fn(server, name, arguments, approval_id)
        if (result.get("structured_content") or {}).get("approval_required"):
            self.store.put_step(self.run_id, key, "tool",
                                {"server": server, "tool": name, "args_hash": args_hash(arguments)}, None, "waiting")
            raise Suspend(key, f"{server}/{name} needs approval")
        self.store.put_step(self.run_id, key, "tool", {"server": server, "tool": name,
                                                       "args_hash": args_hash(arguments),
                                                       "approval_id": approval_id}, result, "done")
        return result

    async def once(self, key: str, fn: Callable[[], Awaitable[Any]]) -> Any:
        """任意有副作用的操作(发邮件、写外部系统),包一层就只会执行一次。"""
        prev = self.store.get_step(self.run_id, key)
        if prev and prev["status"] == "done":
            return prev["result"]
        result = await fn()
        self.store.put_step(self.run_id, key, "note", {}, result, "done")
        return result


AgentFn = Callable[[RunContext, dict], Awaitable[dict]]
AGENTS: dict[str, AgentFn] = {}


def agent(name: str):
    def deco(fn: AgentFn) -> AgentFn:
        AGENTS[name] = fn
        return fn
    return deco
```

三个步骤方法的模式完全一样:先查日志,做过就返回;没做过才真正执行,执行完记下来。`tool` 方法多了审批的处理:

- 工具中心返回 `approval_required`,就把这一步记成 `waiting`,把参数哈希存进 `request`,然后抛出 `Suspend`。
- worker 捕获 `Suspend`,把任务状态改成 `waiting_human`。任务从此不在任何 worker 手里,不占资源,等多久都行。
- 主管批准时,审批接口在工具中心生成批准号,写进这一步的 `request.approval_id`,把任务放回队列。
- 某个 worker 领到任务后从头重放,走到这一步时发现有批准号,带着它再调一次工具。工具中心校验批准号和参数哈希,执行,运行时把这一步记成 `done`。

`once` 方法是给其他有副作用的操作用的,比如发邮件、调用不在工具中心里的外部 API。原则是:任何有副作用或者结果不确定的操作,都要包在某个步骤方法里。

`key` 的选择是使用者的责任。在一个循环里调用模型,key 要带上循环序号(`f"llm:turn:{i}"`);同一个工具在不同语义下被调用,key 要能区分(`"list_invoices"` 和 `"list_invoices:after_refund"`)。key 写错的后果是重放时拿到了错误步骤的结果,这种 bug 很难查,所以 key 最好在代码里显式写出来,不要自动生成。

## worker

```python
# agentops/src/agentops/runtime/worker.py
"""worker:领任务 → 跑 agent → 根据结果改状态。挂了没关系,租约过期后别的 worker 会接手。"""
import asyncio
import logging
import socket
import traceback

from agentops.runtime.harness import AGENTS, LlmFn, RunContext, Suspend, ToolFn
from agentops.runtime.store import RunStore, StepConflict

log = logging.getLogger("agentops.worker")
MAX_ATTEMPTS = 3


class Worker:
    def __init__(self, store: RunStore, llm_fn: LlmFn, tool_fn: ToolFn, name: str | None = None,
                 lease_s: int = 60):
        self.store, self.llm_fn, self.tool_fn = store, llm_fn, tool_fn
        self.name = name or f"{socket.gethostname()}-{id(self) % 10000}"
        self.lease_s = lease_s

    async def run_once(self) -> str | None:
        run = self.store.claim(self.name, self.lease_s)
        if run is None:
            return None
        rid = run["id"]
        fn = AGENTS.get(run["agent"])
        if fn is None:
            self.store.set_status(rid, "failed", worker=self.name, error=f"unknown agent {run['agent']}")
            return rid
        ctx = RunContext(self.store, rid, run["tenant_id"], self.llm_fn, self.tool_fn)
        beat = asyncio.create_task(self._heartbeat(rid))
        try:
            output = await fn(ctx, run["input"])
            self.store.set_status(rid, "succeeded", worker=self.name, output=output)
        except Suspend as s:
            self.store.set_status(rid, "waiting_human", worker=self.name, error=s.reason)
        except StepConflict:
            log.warning("run %s: another worker owns it now, backing off", rid)
        except Exception:  # noqa: BLE001
            err = traceback.format_exc(limit=3)
            if run["attempts"] >= MAX_ATTEMPTS:
                self.store.set_status(rid, "failed", worker=self.name, error=err)
            else:
                self.store.set_status(rid, "queued", worker=self.name, error=err)   # 下次从断点继续
        finally:
            beat.cancel()
        return rid

    async def _heartbeat(self, rid: str) -> None:
        while True:
            await asyncio.sleep(self.lease_s / 3)
            if not self.store.heartbeat(rid, self.name, self.lease_s):
                log.warning("lost lease on %s", rid)
                return

    async def serve(self, idle_sleep: float = 1.0) -> None:
        while True:
            if await self.run_once() is None:
                await asyncio.sleep(idle_sleep)
```

异常处理的四个分支对应四种结局:正常返回是成功;`Suspend` 是等人;`StepConflict` 说明任务已经被别人接手,直接放手;其他异常按重试次数决定是放回队列还是标记失败。放回队列时不清空步骤日志,下次从断点继续,这就是「断点续跑」。

心跳在单独的协程里跑,和 Agent 代码并发。如果 Agent 代码里有长时间阻塞事件循环的同步调用(比如一个 30 秒的同步 HTTP 请求),心跳也会被阻塞,租约就可能过期。所以 Agent 代码里的 I/O 必须是异步的,这一条写进运行时的使用文档。

## 任务 API

```python
# agentops/src/agentops/runtime/app.py
"""任务 API:提交、查询、审批。真正执行在 worker 进程里。"""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from agentops.deps import tenant
from agentops.mcphub.hub import ToolHub
from agentops.mcphub.policy import effective_role
from agentops.runtime.harness import AGENTS
from agentops.runtime.store import RunStore
from agentops.tenancy.keys import TenantContext

router = APIRouter()


class CreateRun(BaseModel):
    agent: str
    input: dict


@router.post("/runs", status_code=201)
def create_run(body: CreateRun, request: Request, ctx: TenantContext = Depends(tenant("runs"))) -> dict:
    if body.agent not in AGENTS:
        raise HTTPException(400, f"unknown agent {body.agent}")
    rid = RunStore(request.app.state.engine).create(ctx.tenant_id, body.agent, body.input)
    return {"id": rid, "status": "queued"}


@router.get("/runs/{run_id}")
def get_run(run_id: str, request: Request, ctx: TenantContext = Depends(tenant("runs"))) -> dict:
    store = RunStore(request.app.state.engine)
    run = store.get(run_id, ctx.tenant_id)
    if run is None:
        raise HTTPException(404, "run not found")          # 别人的 run 也是 404,不是 403
    return run | {"steps": [{k: s[k] for k in ("seq", "kind", "key", "status")} for s in store.list_steps(run_id)]}


@router.post("/runs/{run_id}/approve")
def approve(run_id: str, request: Request, ctx: TenantContext = Depends(tenant("runs"))) -> dict:
    try:
        effective_role(ctx, "supervisor")
    except PermissionError as e:
        raise HTTPException(403, str(e)) from e
    engine = request.app.state.engine
    store = RunStore(engine)
    run = store.get(run_id, ctx.tenant_id)
    if run is None or run["status"] != "waiting_human":
        raise HTTPException(409, "run is not waiting for approval")
    waiting = [s for s in store.list_steps(run_id) if s["status"] == "waiting"]
    for s in waiting:
        r = s["request"]
        aid = ToolHub(engine).grant_approval(ctx, f"key:{ctx.key_id}", r["server"], r["tool"], r["args_hash"])
        store.put_step(run_id, s["key"], s["kind"], r | {"approval_id": aid}, None, "waiting")
    store.set_status(run_id, "queued")                     # 回到队列,worker 会从断点继续
    return {"id": run_id, "approved_steps": [s["key"] for s in waiting]}
```

提交任务只是往表里插一行,立即返回任务 ID,真正执行在 worker 进程里。查询接口永远带租户条件查,别的租户的任务返回 404 而不是 403,原因和 Day 98 一样:不确认资源存在。审批接口要求 key 带 `role:supervisor`,它对所有等待中的步骤生成批准号,然后把任务放回队列。

在 `main.py` 里挂上:

```python
    from agentops.runtime.app import router as runs_router   # Day 99
    app.include_router(runs_router)
```

## 把 SupportPilot 接进来

```python
# agentops/apps/supportpilot_adapter/agent.py
"""把 SupportPilot 的工单流程注册成运行时里的 agent。

这里是精简版:分类 → 查发票 → (退款)提交退款申请 → 起草回复。完整版把 Day 47 的 LangGraph 节点
逐个换成 ctx.llm / ctx.tool 调用,结构和这里一样。key 必须稳定:同一张工单重放时生成同样的 key。
"""
import json

from agentops.runtime.harness import RunContext, agent


@agent("supportpilot.ticket")
async def handle_ticket(ctx: RunContext, inp: dict) -> dict:
    ticket = inp["ticket"]
    cls = await ctx.llm("classify", [
        {"role": "system", "content": "把工单分类为 refund / billing / other,只输出 JSON:{\"category\": ...}"},
        {"role": "user", "content": ticket},
    ])
    category = json.loads(cls["choices"][0]["message"]["content"])["category"]

    invoices = await ctx.tool("list_invoices", "billing", "list_invoices", {"customer_id": inp["customer_id"]})
    refund = None
    if category == "refund":
        # 示例里退最后一张;真实流程由模型从 invoices 里挑,挑选结果也是一个 llm 步骤
        target = json.loads(invoices["content"][0]["text"])["invoices"][-1]["id"]
        refund = await ctx.tool("refund", "billing", "create_refund_request",
                                {"invoice_id": target, "reason": "重复扣款"})

    reply = await ctx.llm("draft", [
        {"role": "system", "content": "根据工具结果给客户写一段简短回复。"},
        {"role": "user", "content": json.dumps({"ticket": ticket, "refund": refund is not None}, ensure_ascii=False)},
    ], route="smart")
    return {"category": category, "reply": reply["choices"][0]["message"]["content"]}
```

这是精简版的工单流程。你可能会问:SupportPilot 用的是 LangGraph,LangGraph 自己就有 checkpointer,为什么还要接运行时?

这是一个真实的架构选择,有两种做法:

**做法一:整个图作为一个任务。** 运行时只负责「这个任务在哪个 worker 上跑、死了谁接手、审批完放回队列」,图内部的断点续跑仍然交给 LangGraph 的 Postgres checkpointer。好处是 SupportPilot 几乎不用改;坏处是有两套状态存储,审批要在两边同步(LangGraph 的 interrupt 和运行时的 waiting_human)。

**做法二:节点内的外部调用改成 ctx 方法。** 图的结构不变,但每个节点里的模型调用和工具调用都通过 `ctx.llm`、`ctx.tool` 走,LangGraph 只负责控制流,不再需要它的 checkpointer。好处是只有一套状态,审批、重放、审计全部统一;坏处是要改 SupportPilot 的节点代码,而且要遵守确定性约束。

平台的建议是新写的 Agent 用做法二,存量 Agent 先用做法一接入,再逐步迁移。这个建议本身值得写一份 ADR。

## 测试

```python
# agentops/tests/test_runtime.py
import json
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

import supportpilot_adapter.agent  # noqa: F401  注册 supportpilot.ticket
from agentops.config import Settings
from agentops.main import create_app
from agentops.mcphub.hub import ToolHub
from agentops.mcphub.policy import set_rule
from agentops.mcphub.registry import Upstream
from agentops.runtime.store import RunStore
from agentops.runtime.worker import Worker
from agentops.tenancy.keys import issue_key, resolve
from tests import fake_billing
from tests.conftest import PEPPER


class Calls:
    def __init__(self):
        self.llm = 0
        self.tools: list[str] = []
        self.crash_after_tools: int | None = None


@pytest.fixture
def setup(engine):
    set_rule(engine, "t_cloudledger", "billing", "list_invoices", "read", ["agent", "supervisor"])
    set_rule(engine, "t_cloudledger", "billing", "create_refund_request", "write", ["agent", "supervisor"],
             needs_approval=True)
    fake_billing.REFUNDS.clear()
    with engine.begin() as c:
        agent_key = issue_key(c, "t_cloudledger", "sp-worker", ["runs", "mcp"], PEPPER)
        boss_key = issue_key(c, "t_cloudledger", "alice", ["runs", "mcp", "role:supervisor"], PEPPER)
    with engine.connect() as c:
        agent_ctx = resolve(c, agent_key, PEPPER)
    calls = Calls()
    hub, up = ToolHub(engine), Upstream("billing", fake_billing.billing)

    async def llm_fn(messages, route):
        calls.llm += 1
        content = json.dumps({"category": "refund"}) if "分类" in messages[0]["content"] else "已为您提交退款。"
        return {"choices": [{"message": {"content": content}}]}

    async def tool_fn(server, name, args, approval_id):
        calls.tools.append(name)
        r = await hub.call_tool(agent_ctx, "agent", up, name, args, approval_id=approval_id)
        if calls.crash_after_tools is not None and len(calls.tools) >= calls.crash_after_tools:
            calls.crash_after_tools = None
            raise RuntimeError("simulated crash after tool call")      # 工具已经执行,进程才挂
        return r.model_dump(mode="json")

    return dict(agent_key=agent_key, boss_key=boss_key, calls=calls, llm_fn=llm_fn, tool_fn=tool_fn)


async def test_refund_waits_for_human_then_resumes_without_redoing_steps(engine, setup):
    store = RunStore(engine)
    rid = store.create("t_cloudledger", "supportpilot.ticket",
                       {"ticket": "上个月年付扣了两次,退一笔", "customer_id": "C007"})
    w = Worker(store, setup["llm_fn"], setup["tool_fn"], name="w1")
    await w.run_once()
    assert store.get(rid)["status"] == "waiting_human"
    assert fake_billing.REFUNDS == [] and setup["calls"].llm == 1

    app = create_app(Settings(key_pepper=PEPPER), engine=engine)
    c = TestClient(app)
    assert c.post(f"/runs/{rid}/approve", headers={"Authorization": f"Bearer {setup['agent_key']}"}).status_code == 403
    r = c.post(f"/runs/{rid}/approve", headers={"Authorization": f"Bearer {setup['boss_key']}"})
    assert r.json()["approved_steps"] == ["refund"]

    await w.run_once()
    run = store.get(rid)
    assert run["status"] == "succeeded" and run["output"]["category"] == "refund"
    assert len(fake_billing.REFUNDS) == 1
    assert setup["calls"].llm == 2                                     # classify 没有被重问,只多了 draft
    assert setup["calls"].tools == ["list_invoices", "create_refund_request", "create_refund_request"]
    # 第一次 create_refund_request 被中心拦在审批,第二次带着批准号执行;list_invoices 只调了一次


async def test_crash_resumes_from_checkpoint(engine, setup):
    store = RunStore(engine)
    rid = store.create("t_cloudledger", "supportpilot.ticket", {"ticket": "发票开错了", "customer_id": "C001"})
    setup["calls"].crash_after_tools = 1          # list_invoices 成功之后、写 step 之前挂掉
    w = Worker(store, setup["llm_fn"], setup["tool_fn"], name="w1")
    await w.run_once()
    run = store.get(rid)
    assert run["status"] == "queued" and run["attempts"] == 1 and "simulated crash" in run["error"]
    await w.run_once()
    assert store.get(rid)["status"] == "waiting_human"
    # 挂掉那次 list_invoices 的结果没来得及落库,所以重放时会再调一次:这就是「至少一次」
    assert setup["calls"].tools.count("list_invoices") == 2
    assert setup["calls"].llm == 1                                     # classify 已落库,不重复


async def test_expired_lease_is_taken_over_and_old_worker_cannot_finish(engine, setup):
    now = [datetime(2026, 10, 12, tzinfo=UTC)]
    store = RunStore(engine, clock=lambda: now[0])
    rid = store.create("t_cloudledger", "supportpilot.ticket", {"ticket": "x", "customer_id": "C001"})
    assert store.claim("w1", lease_s=60)["id"] == rid                 # w1 领了,然后「卡住」
    assert store.claim("w2", lease_s=60) is None                      # 租约内别人领不到
    now[0] += timedelta(seconds=61)
    assert store.claim("w2", lease_s=60)["id"] == rid                 # 过期,w2 接手
    assert store.set_status(rid, "succeeded", worker="w1") is False   # w1 醒来也改不了终态
    assert store.heartbeat(rid, "w1") is False


def test_other_tenant_gets_404(engine, setup, keys):
    store = RunStore(engine)
    rid = store.create("t_cloudledger", "supportpilot.ticket", {"ticket": "x", "customer_id": "C001"})
    with engine.begin() as conn:
        acme = issue_key(conn, "t_acme", "x", ["runs"], PEPPER)
    c = TestClient(create_app(Settings(key_pepper=PEPPER), engine=engine))
    assert c.get(f"/runs/{rid}", headers={"Authorization": f"Bearer {acme}"}).status_code == 404
    assert c.get(f"/runs/{rid}", headers={"Authorization": f"Bearer {setup['agent_key']}"}).status_code == 200
```

四个测试分别证明:

**审批挂起再恢复。** 第一次执行到退款就挂起,上游一次都没被调用;agent 角色的 key 不能批准(403);主管批准后,worker 从断点继续,classify 没有被重新问(模型调用总数是 2 而不是 3),list_invoices 只调了一次。工具调用记录里 create_refund_request 出现两次:第一次被工具中心拦在审批,第二次带批准号执行,这和上游实际只执行了一次退款(`REFUNDS` 长度为 1)并不矛盾。

**崩溃后从断点继续。** 模拟 list_invoices 成功返回之后、结果落库之前进程挂掉。重试时 classify 从日志读取,但 list_invoices 会被再调一次。这个测试故意把「至少一次」的语义暴露出来:在「外部调用成功」和「结果落库」之间崩溃,这一步就会被重做。只读工具重做无所谓;写操作工具重做,就需要下一节的办法。

**租约过期接管。** 用可控的时钟模拟时间流逝:租约内别人领不到,过期后 w2 接手,原来的 w1 既不能续租也不能改终态。

**跨租户。** 别的租户查我的任务,404。

我本机跑全部测试的输出是 `22 passed`。

## 至少一次和恰好一次

上面的崩溃测试说明,我们的运行时对每一步提供的是「至少一次」执行:一步要么被执行一次,要么在特定的崩溃时机下被执行两次。要让写操作在效果上「恰好一次」,需要上游配合,有两种常见做法:

**幂等键传给上游。** 运行时把步骤的唯一标识(`run_id` 加 `key`)作为幂等键传给工具,上游记录处理过的幂等键,重复的请求直接返回第一次的结果。Stripe 的 API 就是这么做的,Brandur Leach 那篇讲幂等键的文章是这个主题最好的参考。在我们的系统里,可以由工具中心在转发写操作时自动附加 `idempotency_key` 参数。

**先查后写。** 写操作之前先查一下目标状态,比如「这张发票已经有退款申请了吗」,有就不再创建。这要求上游有可查询的状态,而且查和写之间有竞争窗口,可靠性不如幂等键。

我们的审批批准号其实已经提供了一层保护:批准号是一次性的,所以就算重做,第二次带同一个批准号调用会被工具中心拒绝。但这种保护只对需要审批的工具有效,所以在设计文档里我把「写操作工具必须支持幂等键」列为接入工具中心的硬性要求。

## 为什么不直接用 Temporal

这是评审时一定会被问的问题。Temporal 是这个领域最成熟的方案,它提供的东西比我们的运行时多得多:确定性检查、定时器、信号、子工作流、版本管理、可视化界面,还有经过大规模验证的可靠性。

第一期不用的理由:第一,Temporal 需要单独部署和运维一套集群(或者用云服务),对一个只有三五个租户的内部平台来说,运维成本比收益高;第二,我们的需求集中在「步骤记账、断点续跑、等审批」三件事上,用 Postgres 已经能做,而且和平台其他数据在同一个库里,备份、审计、跨表查询都简单;第三,自己写一遍能让团队真正理解持久化执行的约束,将来迁移到 Temporal 时,Agent 代码的写法(确定性、显式步骤)已经是对的,迁移成本低。

什么时候换:任务量上到每天几十万步、需要定时器和复杂的工作流编排、或者团队里没有人愿意维护这块代码时。这个判断写进 ADR,和 Day 97 网关对 LiteLLM 的判断是同一种思路。

## 动手练习

**步骤 1:** 写 `runtime/` 下的四个文件和 `apps/supportpilot_adapter/agent.py`,在 `pyproject.toml` 的 pytest 配置里加 `pythonpath = [".", "apps"]`,挂载 router,写 `tests/test_runtime.py`,跑通全部测试。

**步骤 2:真的杀一次进程。** 写一个脚本起 worker(`Worker(...).serve()`),llm_fn 接 Day 97 的网关,tool_fn 接 Day 98 的工具中心。提交一个任务,在 worker 执行到一半时 `kill -9` 它,再起一个新 worker,观察任务是否从断点继续,对照 `steps` 表看哪些步骤被重做了。

**步骤 3:给写工具加幂等键。** 修改 `RunContext.tool`,把 `f"{run_id}:{key}"` 作为 `idempotency_key` 放进参数;修改假的账单 server,让 `create_refund_request` 记住处理过的幂等键,重复时返回第一次的结果。写一个测试:在退款执行成功、结果落库前崩溃,重试后 `REFUNDS` 仍然只有一条。

**步骤 4:写 ADR。** 记录「SupportPilot 用做法一还是做法二接入运行时」的决定。

**验收标准:** 19 个测试全绿;步骤 2 的 kill 实验有记录(哪些步骤重做了、为什么);步骤 3 的幂等测试通过。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 持久化执行(durable execution) | 把每次外部调用的结果记下来,进程失败后重放程序、跳过已完成的步骤 |
| 步骤日志 / 重放 | 记录每步结果的表 / 重新执行程序,遇到已记录的步骤直接取结果 |
| 确定性 | 给定同样的步骤结果,程序走同样的路径、生成同样的 key |
| 租约(lease) | 有过期时间的占有权,持有者要定期续期 |
| 心跳 | 定期续租的动作 |
| fencing token | 单调递增的租约编号,下游据此拒绝过期持有者的请求 |
| 至少一次 / 恰好一次 | 一个操作可能被执行多次 / 效果上只发生一次 |
| 幂等键 | 让重复请求只产生一次效果的唯一标识 |
| 乐观并发 | 不加锁,写的时候带条件,冲突了就重试或放弃 |
| SKIP LOCKED | Postgres 的行锁选项,跳过被别人锁住的行,常用于实现任务队列 |

## 常见误区

**在 Agent 代码里直接用当前时间或随机数。** 重放时值会变,程序可能走另一条分支。要通过 `ctx.once` 之类的步骤方法拿。

**步骤 key 自动生成。** 用调用顺序或者参数哈希自动生成 key,代码稍微一改,旧任务重放时 key 就对不上了。key 要显式、稳定、有语义。

**以为租约能保证只有一个执行者。** 租约只能保证「最终只有一个人能提交结果」,过期瞬间可能有两个执行者,需要下游幂等或 fencing token 兜底。

**写操作没有幂等保护。** 运行时提供的是至少一次,写操作重复执行的后果要靠幂等键消除。

**用同步阻塞 I/O 写 Agent。** 心跳会被饿死,租约过期,任务被别人接手,然后出现两个执行者。

**等审批时让 worker 一直等着。** 一个等两小时审批的任务占着一个 worker,十个这样的任务就把 worker 池占满了。挂起、释放、批准后重新排队。

## 学习资料

### 文档与文章

- [What is Durable Execution?](https://temporal.io/blog/what-is-durable-execution):Temporal 官方对持久化执行的解释,20 分钟。
- [Understanding Temporal](https://docs.temporal.io/evaluate/understanding-temporal):看 workflow 和 activity 的区分,对应我们的 Agent 函数和步骤方法。
- [LangGraph:Durable execution](https://docs.langchain.com/oss/python/langgraph/durable-execution):LangGraph 官方对持久化执行的说明,对照理解做法一和做法二。
- [Restate 文档](https://docs.restate.dev/) 和 [DBOS 文档](https://docs.dbos.dev/):两个更轻量的持久化执行方案,DBOS 和我们一样基于 Postgres,值得比较它的实现。
- [Implementing Stripe-like Idempotency Keys in Postgres](https://brandur.org/idempotency-keys):幂等键最好的实战文章,1 小时,步骤 3 的必读。
- [How to do distributed locking](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html):Martin Kleppmann 讲租约和 fencing token,40 分钟。
- [Saga 模式](https://microservices.io/patterns/data/saga.html):多个写操作需要整体回滚时的补偿模式,长任务里迟早会用到。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1JNkFBMEFH&autoplay=0&high_quality=1" title="用Temporal构建持久化AI智能体 | AI Engineer" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>7k的每日搬运 · 用Temporal构建持久化AI智能体 | AI Engineer · 78 分钟的工作坊搬运,看前 30 分钟理解 workflow 和 activity 的分工,和本篇的设计对照。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1fU3F6fEe3&autoplay=0&high_quality=1" title="面试官问:Agent如何支持长任务的暂停、恢复和续跑?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Agent开发实战 · 面试官问:Agent如何支持长任务的暂停、恢复和续跑? · 4 分钟,看完后试着用本篇的内容给出更完整的回答。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/w4spcXq5uCw" title="Why Every AI Agent Needs Durable Execution | Temporal, Samar Abbas" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Lightspeed Venture Partners · Why Every AI Agent Needs Durable Execution | Temporal, Samar Abbas · Temporal 联合创始人讲为什么 Agent 需要持久化执行。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/k8cnVCMYmNc" title="OpenAI + Temporal: Building Durable, Production Ready Agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · OpenAI + Temporalio: Building Durable, Production Ready Agents · 看 OpenAI Agents SDK 和 Temporal 的集成方式,对应本篇的做法二。</figcaption>
</figure>

### 书籍

- **Designing Data-Intensive Applications(第 2 版)**,Martin Kleppmann、Chris Riccomini,O'Reilly,2026(第 1 版有中译本《数据密集型应用系统设计》)。读讲事务的章节和「分布式系统的麻烦」那一章,租约、fencing、至少一次都在里面。
- **Microservices Patterns**,Chris Richardson,Manning,2018(中译本《微服务架构设计模式》,机械工业出版社)。读第 4 章 Saga,长任务里多个写操作的补偿。

### 开源项目与代码

- [DBOS Transact(Python)](https://github.com/dbos-inc/dbos-transact-py):基于 Postgres 的持久化执行库,看它的步骤记录表结构和我们的 `steps` 表有什么异同。
- [Temporal](https://github.com/temporalio/temporal):不用读源码,看 README 和样例仓库,了解成熟方案提供了哪些我们没有的能力。

## 自测

1. 持久化执行为什么要求 Agent 代码是确定性的?举一个违反的例子和改法。

<details><summary>答案</summary>

重放时程序从头执行,依赖日志里的步骤结果「快进」。如果程序在两个步骤之间依赖了日志之外的不确定值,重放时可能走另一条分支,生成不同的步骤 key,日志就对不上了。例子:`if datetime.now().hour >= 18: 转人工`,第一次执行在 17:59,第二次重放在 18:01,分支不同。改法:把当前时间作为一个步骤取得,`now = await ctx.once("now", get_now)`,重放时拿到的是第一次的时间。

</details>

2. worker A 卡住,租约过期,B 接手。A 醒来后可能造成什么问题?我们的实现挡住了哪些,挡不住哪些?

<details><summary>答案</summary>

挡住的:A 不能续租(heartbeat 返回 False),不能修改任务终态(set_status 带 worker 条件);A 和 B 同时写同一个步骤 key 时,唯一约束让后到的失败。挡不住的:A 在发现失去租约之前已经发出的外部调用,比如又调用了一次工具。补救需要下游配合:写操作幂等(幂等键),或者用 fencing token 让下游拒绝旧租约持有者的请求。

</details>

3. 崩溃测试里 list_invoices 被调用了两次,为什么?这对写操作意味着什么?

<details><summary>答案</summary>

崩溃发生在工具调用成功之后、结果写入步骤日志之前,日志里没有这一步,重放时只能重新执行。这说明运行时提供的是至少一次语义。只读工具重做没有影响;写操作重做可能产生两次副作用(比如两次退款),所以写操作必须靠幂等键或先查后写来做到效果上的恰好一次。

</details>

4. 等审批的任务为什么要释放 worker,而不是让 worker 等着?

<details><summary>答案</summary>

审批可能要几分钟到几小时,让 worker 等着会占用一个执行槽位,几十个等审批的任务就能把 worker 池占满,其他任务全部排队。挂起后任务只是数据库里的一行,不占计算资源;批准后重新入队,任何 worker 都能接手。这也让部署更安全,等审批的任务不受进程重启影响。

</details>

5. 资深面试题:你的团队用自研的运行时跑了半年,现在有人提议迁到 Temporal。你怎么评估?

<details><summary>答案</summary>

先列清楚自研方案现在的痛点和数据:每天多少任务、多少步、出过哪些事故(重复执行、卡住的任务、key 冲突),维护花了多少人力。再列 Temporal 能解决哪些痛点(定时器、版本管理、可视化排查、确定性检查)和带来的新成本(集群运维或云服务费用、团队学习、Agent 代码迁移、和现有审计及计费体系的集成)。然后做一个小范围试点:挑一个新的 Agent 直接用 Temporal 写,跑两到四周,对比开发效率和运维负担。迁移的前提条件是 Agent 代码已经遵守确定性和显式步骤的约束,这样迁移主要是换底层实现。最后给出带条件的结论,比如「任务量超过某个阈值、或者需要复杂编排时迁移,否则维持现状」,而不是凭感觉说「Temporal 更专业」。

</details>

6. 资深面试题:一个 Agent 任务要依次给客户发邮件、在 CRM 里创建跟进记录、扣减额度。第二步失败且重试三次都失败了,你怎么处理?

<details><summary>答案</summary>

这是长事务的部分失败问题。先区分:已经完成的第一步(发邮件)无法撤回,只能补偿(再发一封更正邮件,或者在 CRM 恢复后补记录);还没执行的第三步不应该执行。具体做法是 Saga:每个写步骤定义对应的补偿动作,失败时按逆序执行已完成步骤的补偿,补偿本身也要幂等、也要记进步骤日志。同时任务状态置为失败并转人工,附上已执行的步骤和补偿结果。设计上更好的做法是调整顺序,把最难补偿的操作(发邮件)放在最后,先做容易回滚的操作。面试时要讲出「不是所有操作都能回滚,所以要设计顺序和补偿」这个思路。

</details>

## 明天预告

Day 100 · AgentOps(四):评测平台与线上实验。把 W5 和 W11 的评测能力做成平台服务:评测结果按用例落库,两个版本比较时给出配对统计检验和置信区间,而不是只比平均分;再加一个按客户稳定分流的 A/B 实验,让新 prompt 先在一小部分流量上跑。
