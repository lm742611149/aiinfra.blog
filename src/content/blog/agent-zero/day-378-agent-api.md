---
title: 'Day 378 · 把 Agent 做成服务:Agent 接口和普通接口差在哪'
description: '普通接口 1.4 毫秒,同一个 Agent 放在普通 POST 后面要让用户盯着空白等 10.8 秒。今天把它做成四种接口来量:阻塞、客户端 5 秒超时(服务端照样跑完,白花钱)、async def 里直接跑同步 Agent(别的请求等了 9.6 秒)、任务加轮询,最后预告流式,首个事件 1.3 秒到。'
pubDate: 2026-10-27
regime: none
tags: ['fastapi', 'production', 'streaming', 'agent-zero']
series: 'agent-zero'
day: 378
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 377](/blog/agent-zero/day-377-week54-review/) 是第 54 周的复习日,把评测那一周的三段核心代码默写了一遍:回归门禁函数、手册的整理者、改写比例。门禁函数那段用 3000 组随机输入和原版对拍,抓到了大部分改错的地方,但「小于号写成小于等于号」这种边界错误 3000 组里只抓到 4 组,要靠一条手写的边界用例。

评测系统到此告一段落。从今天起进入第七部分:生产化与安全。前面六周的工单 Agent 一直活在终端里,只有你自己能用。今天只回答一个问题:把它放到一个 HTTP 接口后面,和你写了很多年的普通接口比,到底哪里不一样,不一样的地方会在线上怎么出事。

## 今天要解决的问题

学完今天,你应该能:

1. 用实测的数字说出 Agent 接口和普通接口的差别:一次请求要占服务端十几秒,而不是几毫秒。
2. 复现并解释两个线上必踩的坑:客户端超时以后服务端还在白跑,以及在 `async def` 里直接跑同步的 Agent 会让整个服务卡住。
3. 写出两种应对办法的最小版本:任务加轮询、流式响应,并说清各自的代价。
4. 给一个「平均耗时 × 请求量」的数,估出服务端要同时撑住多少个请求。

今天的两个新概念:**长任务**(一次请求要占服务端很久,会撞上超时和并发上限)和**流式响应**(连接不关,边做边往外送)。流式只做预告,怎么写、怎么读放在 [Day 379](/blog/agent-zero/day-379-sse-server/)。

预计用时 2.5 小时。前置:[Day 79](/blog/agent-zero/day-079-fastapi-1/) 到 [Day 81](/blog/agent-zero/day-081-fastapi-3/) 的 FastAPI,[Day 65](/blog/agent-zero/day-065-httpx-2/) 的 httpx 超时,[Day 66](/blog/agent-zero/day-066-async-1/) 的事件循环,[Day 99](/blog/agent-zero/day-099-generators/) 的生成器,[Day 133](/blog/agent-zero/day-133-sse-principle/) 的 SSE 原理,[Day 135](/blog/agent-zero/day-135-llm-client-1/) 到 [Day 137](/blog/agent-zero/day-137-llm-client-3/) 的 `common/llm.py`。今天用了真实的 DeepSeek 调用,一共跑了 12 次 Agent,每次约 0.0027 元,合计约 0.03 元(算式在最后)。需要先装:`uv add fastapi uvicorn httpx`(前面几天大概率已经装过,重复装没有坏处)。

学法和平时一样:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章默写核心部分;做练习时先自己写,做不出再展开参考答案,看完关掉重写一遍。

## 普通接口是什么节奏

先量一个基准。[Day 79](/blog/agent-zero/day-079-fastapi-1/) 写过的那种接口,按编号查一张工单,返回一小段 JSON。把它放进今天的服务文件里(完整文件在后面,先看这一个函数):

```python
@app.get("/tickets/{ticket_id}")
def get_ticket(ticket_id: int) -> dict[str, Any]:
    return {"id": ticket_id, "title": "发票抬头写错了", "status": "open"}
```

用 httpx 连着请求 20 次,每次记时。启动服务后在另一个终端运行客户端脚本的 `normal` 子命令:

```bash
uv run python -m part07.probe378 normal
```

```text
普通接口 20 次:中位 1.4 毫秒,最慢 19.3 毫秒
```

1.4 毫秒。这个数字要记住,因为后面所有的差别都从它开始。一个请求占用服务端 1.4 毫秒,一个线程每秒能处理几百个,你几乎不用想「同时有多少人在用」这件事。

## 一个 Agent 的一次运行,时间花在哪

Agent 的一次运行是这样的:先问模型一次,模型说「我要查发票」;服务端去查发票;把结果还给模型,再问一次,模型说「我要查退款政策」;再查;再问一次,这回模型给出最后的回答。三次模型调用,两次工具调用。

下面这个 `toy_agent.py` 就是这个流程,只有两个工具,数据是虚构的云簿 CloudLedger 发票。它用的是 [Day 135](/blog/agent-zero/day-135-llm-client-1/) 到 [Day 137](/blog/agent-zero/day-137-llm-client-3/) 建的 `common/llm.py`。注意它不是一个普通函数,而是一个**生成器**([Day 99](/blog/agent-zero/day-099-generators/)):每走完一步就 `yield` 一个事件出来,最后 `yield` 一个 `done`。为什么这样写,下面讲到流式的时候就清楚了。

```python
# agent-zero-lab/part07/toy_agent.py
"""Day 378:一个只有两个工具的小 Agent,专门用来量「Agent 接口为什么慢」。
工具数据是虚构的(云簿 CloudLedger)。用法: uv run python -m part07.toy_agent"""
from __future__ import annotations

import json
import os
import time
from collections.abc import Callable, Iterator
from typing import Any

from common.llm import LLMClient

INVOICES = {
    "INV-2031": {"invoice_id": "INV-2031", "customer": "C007", "plan": "专业版年付", "amount": 468.0,
                 "status": "paid", "charges": 2},
}
POLICY = {"专业版年付": "年付中途取消按剩余整月退款;重复扣款无条件退回多扣的那一笔,主管审批后原路退回。"}

TOOLS: list[dict[str, Any]] = [
    {"type": "function", "function": {
        "name": "get_invoice", "description": "按发票号查发票:套餐、金额、状态、实际扣款次数 charges",
        "parameters": {"type": "object", "properties": {"invoice_id": {"type": "string"}}, "required": ["invoice_id"]}}},
    {"type": "function", "function": {
        "name": "get_refund_policy", "description": "按套餐名查退款政策",
        "parameters": {"type": "object", "properties": {"plan": {"type": "string"}}, "required": ["plan"]}}},
]


TOOL_DELAY = float(os.environ.get("TOOL_DELAY", "0.4"))   # 每次工具调用假装花几秒,环境变量能改


def call_tool(name: str, args: dict[str, Any]) -> dict[str, Any]:
    time.sleep(TOOL_DELAY)                # 假装查库要这么久;真实的工具往往更慢
    if name == "get_invoice":
        return INVOICES.get(args.get("invoice_id", ""), {"error": "没有这张发票"})
    if name == "get_refund_policy":
        return {"policy": POLICY.get(args.get("plan", ""), "没有这个套餐")}
    return {"error": f"没有工具 {name}"}


SYSTEM = "你是云簿 CloudLedger 的客服助手。需要事实时先调用工具,不要猜。回答用中文,三句话以内。"
Step = Callable[[dict[str, Any]], None]


def iter_agent(question: str, client: LLMClient | None = None) -> Iterator[dict[str, Any]]:
    """跑一轮 Agent,每到一个阶段(模型想完、工具跑完)就 yield 一个事件,最后 yield 一个 done。"""
    client = client or LLMClient()
    t0 = time.perf_counter()
    messages: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": question}]
    reply = "(步数用完)"
    for _ in range(5):
        r = client.chat(messages, tools=TOOLS, temperature=0)
        messages.append(r.message)
        yield {"type": "model", "at": round(time.perf_counter() - t0, 2)}
        calls = r.message.get("tool_calls") or []
        if not calls:
            reply = r.content
            break
        for c in calls:
            args = json.loads(c["function"]["arguments"])
            out = call_tool(c["function"]["name"], args)
            yield {"type": "tool", "name": c["function"]["name"], "args": args, "at": round(time.perf_counter() - t0, 2)}
            messages.append({"role": "tool", "tool_call_id": c["id"], "content": json.dumps(out, ensure_ascii=False)})
    yield {"type": "done", "reply": reply, "seconds": round(time.perf_counter() - t0, 2),
           "cost": round(client.ledger.cost, 4), "calls": client.ledger.calls}


def run_agent(question: str, on_step: Step | None = None, client: LLMClient | None = None) -> dict[str, Any]:
    """一口气跑完,返回最后的 done 事件。on_step 给每个中间事件调用一次。"""
    last: dict[str, Any] = {}
    for event in iter_agent(question, client):
        if event["type"] != "done" and on_step:
            on_step(event)
        last = event
    return last


QUESTION = "发票 INV-2031 好像被扣了两次款,帮我核实一下,能退吗?"

if __name__ == "__main__":
    out = run_agent(QUESTION, on_step=print)
    print(out)
```

<div class="line-notes">

- `from common.llm import LLMClient` [Day 135](/blog/agent-zero/day-135-llm-client-1/) 起建的封装,`chat(messages, **kw)` 返回 `ChatResult`,`kw` 里的 `tools` 原样传给 openai SDK。
- `INVOICES = {` 一张虚构的发票:客户 C007,专业版年付 468 元,`charges: 2` 表示被扣了两次款。Agent 要自己发现这个数。
- `TOOLS: list[dict[str, Any]] = [` 两个工具的 JSON Schema,和 [Day 157](/blog/agent-zero/day-157-tool-schema/) 写的格式一样。
- `TOOL_DELAY = float(` 从环境变量读「每次工具调用假装花几秒」,默认 0.4。真实的工具(查库、调第三方接口)往往不止这个数,后面用 `TOOL_DELAY=4` 模拟慢一点的情况。
- `time.sleep(TOOL_DELAY)` 假装查库要这么久。这是同步的睡眠,会占着当前线程,这一点在后面很重要。
- `SYSTEM = ` 系统提示词,只有一句话,要求先查工具再回答。
- `def iter_agent(` 返回类型是 `Iterator[dict]`,函数体里有 `yield`,所以它是生成器:调用它不会立刻跑,每次 `next()` 才往下跑一步。
- `client = client or LLMClient()` 没传客户端就自己建一个。测试时可以传一个假的进来。
- `t0 = time.perf_counter()` 记开始时刻,事件里的 `at` 是「从开始到现在过了几秒」。
- `for _ in range(5):` 最多 5 轮,防止模型一直要工具停不下来。这次实测只用了 3 轮。
- `r = client.chat(messages, tools=TOOLS, temperature=0)` 一次模型调用。这一行是整个 Agent 里最慢、也最花钱的一行,实测每次 0.7 到 1.3 秒。
- `messages.append(r.message)` 把模型这一轮的回复(可能带 `tool_calls`)追加进历史,下一轮要带上。
- `yield {"type": "model"` 模型想完了,往外报一个事件。第一次到这一行时 `at` 是 1.31。
- `calls = r.message.get("tool_calls") or []` 模型要调哪些工具。没有就是 `[]`。
- `reply = r.content` 没有工具要调,说明这一轮的文字就是最终回答,存起来,下面 `break` 出循环。
- `for c in calls:` 逐个执行。DeepSeek 有时一次要两个工具,这里按顺序跑。
- `args = json.loads(` 工具参数是模型生成的 JSON 字符串,要先解析。
- `yield {"type": "tool"` 工具跑完了,报一个事件。`args` 也带上,前端想显示「正在查 INV-2031」就靠它。
- `messages.append({"role": "tool"` 把工具结果以 `tool` 角色追加进历史,`tool_call_id` 对上模型发出的那个调用。
- `yield {"type": "done"` 最后一个事件,带回答、总耗时、花费、模型调用次数。
- `def run_agent(` 一口气跑完版本:把生成器全部消费掉,返回最后一个 `done` 事件。普通的阻塞接口用它。
- `if event["type"] != "done" and on_step:` 中间事件交给回调,`done` 不交,因为它就是返回值。

</div>

先在命令行里跑一遍,默认的工具延迟 0.4 秒:

```bash
uv run python -m part07.toy_agent
```

```text
{'type': 'model', 'at': 0.72}
{'type': 'tool', 'name': 'get_invoice', 'args': {'invoice_id': 'INV-2031'}, 'at': 1.13}
{'type': 'model', 'at': 2.26}
{'type': 'tool', 'name': 'get_refund_policy', 'args': {'plan': '专业版年付'}, 'at': 2.67}
{'type': 'model', 'at': 3.42}
{'type': 'done', 'reply': '已核实：INV-2031（专业版年付，468 元）状态为已支付，但确实扣款 2 次，属于重复扣款。按政策，重复扣款可无条件退回多扣的那一笔，需主管审批后原路退回。我这边可以帮您提交退款申请，需要吗？', 'seconds': 3.42, 'cost': 0.0026, 'calls': 3}
```

前五行是 `on_step=print` 在每个阶段打印的中间事件,最后一行是 `run_agent` 的返回值(也就是 `done` 事件)。

3.42 秒,三次模型调用加起来约 2.6 秒,两次工具各 0.4 秒。花了 0.0026 元。这是一个很轻的 Agent:两个工具,每个都瞬间返回。真实的客服 Agent 会查订单、查知识库、调支付系统,一个工具 2 秒很平常。设 `TOOL_DELAY=4` 模拟慢一点的:

```bash
TOOL_DELAY=4 uv run python -m part07.toy_agent
```

```text
{'type': 'model', 'at': 0.73}
{'type': 'tool', 'name': 'get_invoice', 'args': {'invoice_id': 'INV-2031'}, 'at': 4.74}
{'type': 'model', 'at': 5.78}
{'type': 'tool', 'name': 'get_refund_policy', 'args': {'plan': '专业版年付'}, 'at': 9.78}
{'type': 'model', 'at': 10.72}
{'type': 'done', 'reply': '已核实：INV-2031（专业版年付，468 元）状态为已支付，但确实扣款 2 次，属于重复扣款。按政策，重复扣款可无条件退回多扣的那一笔，需主管审批后原路退回。我这边可以帮您提交退款申请，需要吗？', 'seconds': 10.72, 'cost': 0.0026, 'calls': 3}
```

10.72 秒。从普通接口的 1.4 毫秒到 10.72 秒,差了大约 7600 倍。今天剩下的内容都是这个数字带来的后果。

## 做法一:一个普通的 POST,跑完再返回

最直觉的做法就是你写了很多年的那种:POST 进来,跑完,把结果当 JSON 返回。下面是今天的服务文件,先看全貌,四种做法都在里面,后面一种一种用:

```python
# agent-zero-lab/part07/agent_service.py
"""Day 378:同一个 Agent,放在四种接口后面比较。端口 18378,只监听本机。
启动: uv run uvicorn part07.agent_service:app --host 127.0.0.1 --port 18378"""
from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import Iterator
from typing import Any

from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from part07.toy_agent import iter_agent, run_agent

app = FastAPI()
FINISHED: list[dict[str, Any]] = []        # 服务端自己记:每次 Agent 跑完时有没有人还在等


class Ask(BaseModel):
    question: str


@app.get("/health")
def health() -> dict[str, str]:
    return {"ok": "yes"}


@app.get("/tickets/{ticket_id}")
def get_ticket(ticket_id: int) -> dict[str, Any]:
    """普通接口:查一行数据,几毫秒。"""
    return {"id": ticket_id, "title": "发票抬头写错了", "status": "open"}


@app.post("/chat/blocking")
def chat_blocking(body: Ask) -> dict[str, Any]:
    """做法一:一个普通的 POST,跑完整个 Agent 再一次性返回。"""
    out = run_agent(body.question)
    FINISHED.append({"how": "blocking", "seconds": out["seconds"], "cost": out["cost"]})
    return out


@app.post("/chat/blocking-async")
async def chat_blocking_async(body: Ask) -> dict[str, Any]:
    """反面教材:async def 里直接跑同步的 Agent,整个事件循环被占住。"""
    return run_agent(body.question)


@app.get("/finished")
def finished() -> list[dict[str, Any]]:
    return FINISHED


JOBS: dict[str, dict[str, Any]] = {}


async def run_job(job_id: str, question: str) -> None:
    def work() -> None:
        for event in iter_agent(question):
            JOBS[job_id]["events"].append(event)
            if event["type"] == "done":
                JOBS[job_id].update(status="done", reply=event["reply"])
    await run_in_threadpool(work)


@app.post("/jobs", status_code=202)
async def create_job(body: Ask) -> dict[str, str]:
    """做法二:立刻返回一个编号,Agent 在后台跑,前端隔几秒来问一次。"""
    job_id = uuid.uuid4().hex[:8]
    JOBS[job_id] = {"status": "running", "events": [], "reply": None}
    asyncio.create_task(run_job(job_id, body.question))
    return {"job_id": job_id}


@app.get("/jobs/{job_id}")
async def get_job(job_id: str) -> dict[str, Any]:
    return JOBS[job_id]


@app.post("/chat/lines")
def chat_lines(body: Ask) -> StreamingResponse:
    """做法三(预告,明天细讲):Agent 每走一步就把一行 JSON 写出去,连接一直开着直到结束。"""
    def gen() -> Iterator[str]:
        for event in iter_agent(body.question):
            yield json.dumps(event, ensure_ascii=False) + "\n"
    return StreamingResponse(gen(), media_type="text/plain; charset=utf-8")
```

<div class="line-notes">

- `FINISHED: list[dict[str, Any]] = []` 服务端自己记一本账:每次 Agent 跑完了,有没有人还在等,后面「超时」那一节要用。放在模块级,只是为了演示。
- `@app.get("/tickets/{ticket_id}")` 上一节量过的普通接口。
- `def chat_blocking(body: Ask)` 做法一。注意是 `def` 不是 `async def`:FastAPI 会把 `def` 接口丢进线程池里跑([Day 66](/blog/agent-zero/day-066-async-1/) 讲过的事件循环不会被它堵住),`run_agent` 里全是同步调用,放在线程里才对。
- `out = run_agent(body.question)` 跑完整个 Agent,10 秒。这一行期间,这个请求的 HTTP 连接一直开着,但一个字节都没往外送。
- `async def chat_blocking_async` 反面教材。同样的内容写成 `async def`,里面直接调同步的 `run_agent`。
- `JOBS: dict[str, dict[str, Any]] = {}` 做法二用的任务表:任务编号 → 状态、已发生的事件、最终回复。放在内存里,服务一重启就没了,这是今天的最小版。
- `async def run_job(` 后台任务的入口。
- `def work() -> None:` 把「消费生成器」的整段逻辑放进一个普通函数,因为它是同步阻塞的。
- `JOBS[job_id]["events"].append(event)` 每来一个事件就存进任务表,前端来问的时候就能看到。
- `await run_in_threadpool(work)` 把 `work` 丢进线程池执行,等它结束。这样事件循环不会被同步代码占住。
- `@app.post("/jobs", status_code=202)` 202 的意思是「收到了,正在处理,还没完」。
- `job_id = uuid.uuid4().hex[:8]` 随机生成一个 8 位任务编号。演示够用,线上要用更长的,而且不能被人猜到。
- `asyncio.create_task(` 在后台开一个任务,不等它,马上往下走去返回 202。
- `def gen() -> Iterator[str]:` 做法三的核心:一个生成器,每拿到 Agent 的一个事件就产出一行文本。
- `yield json.dumps(event` 一个事件变成一行 JSON,末尾加换行。
- `return StreamingResponse(gen()` 把生成器交给 FastAPI,它会一边从生成器取、一边往连接里写,不会等生成器跑完。

</div>

启动服务(端口用 18378,只监听本机,工具延迟设成 4 秒):

```bash
TOOL_DELAY=4 uv run uvicorn part07.agent_service:app --host 127.0.0.1 --port 18378
```

再写一个客户端脚本来量。里面有六个子命令,今天一个个用:

```python
# agent-zero-lab/part07/probe378.py
"""Day 378:从客户端这一侧量四种接口。先启动 agent_service(TOOL_DELAY=4),再运行:
uv run python -m part07.probe378 normal|blocking|timeout|async|lines|polling [间隔秒数]"""
from __future__ import annotations

import json
import statistics
import sys
import threading
import time

import httpx

BASE = "http://127.0.0.1:18378"
Q = "发票 INV-2031 好像被扣了两次款,帮我核实一下,能退吗?"


def normal() -> None:
    times = []
    with httpx.Client() as c:
        for _ in range(20):
            t = time.perf_counter()
            c.get(f"{BASE}/tickets/7")
            times.append((time.perf_counter() - t) * 1000)
    print(f"普通接口 20 次:中位 {statistics.median(times):.1f} 毫秒,最慢 {max(times):.1f} 毫秒")


def blocking() -> None:
    t = time.perf_counter()
    r = httpx.post(f"{BASE}/chat/blocking", json={"question": Q}, timeout=60)
    print(f"阻塞接口:等了 {time.perf_counter() - t:.1f} 秒才拿到第一个字节,状态 {r.status_code}")
    print("  回复:", r.json()["reply"])


def timeout() -> None:
    t = time.perf_counter()
    try:
        httpx.post(f"{BASE}/chat/blocking", json={"question": Q}, timeout=5)
    except httpx.ReadTimeout as e:
        print(f"客户端 5 秒超时:{time.perf_counter() - t:.1f} 秒后抛出 {type(e).__name__}:{e!r}")
    print("  现在服务端记了几次完成?", httpx.get(f"{BASE}/finished").json())
    time.sleep(9)
    print("  再过 9 秒:", httpx.get(f"{BASE}/finished").json())


def async_block() -> None:
    def slow() -> None:
        httpx.post(f"{BASE}/chat/blocking-async", json={"question": Q}, timeout=60)
    th = threading.Thread(target=slow)
    th.start()
    time.sleep(1)
    t = time.perf_counter()
    httpx.get(f"{BASE}/health", timeout=60)
    print(f"Agent 在跑的时候请求 /health:等了 {time.perf_counter() - t:.1f} 秒")
    th.join()
    t = time.perf_counter()
    httpx.get(f"{BASE}/health")
    print(f"Agent 跑完以后请求 /health:{(time.perf_counter() - t) * 1000:.0f} 毫秒")


def polling(interval: float = 3.0) -> None:
    t0 = time.perf_counter()
    job = httpx.post(f"{BASE}/jobs", json={"question": Q}).json()["job_id"]
    print(f"{time.perf_counter() - t0:5.2f}s POST /jobs → 202 {job}")
    seen = 0
    while True:
        time.sleep(interval)
        j = httpx.get(f"{BASE}/jobs/{job}").json()
        new = j["events"][seen:]
        seen = len(j["events"])
        names = [e["type"] + (":" + e["name"] if "name" in e else "") for e in new]
        print(f"{time.perf_counter() - t0:5.2f}s GET  status={j['status']:<7} 新事件 {names}")
        if j["status"] == "done":
            break


def lines() -> None:
    t0 = time.perf_counter()
    with httpx.stream("POST", f"{BASE}/chat/lines", json={"question": Q}, timeout=60) as r:
        print(f"{time.perf_counter() - t0:5.2f}s 响应头到了 {r.status_code}")
        for line in r.iter_lines():
            e = json.loads(line)
            print(f"{time.perf_counter() - t0:5.2f}s {e['type']}" + (f":{e['name']}" if "name" in e else ""))


if __name__ == "__main__":
    which = sys.argv[1]
    if which == "polling":
        polling(float(sys.argv[2]) if len(sys.argv) > 2 else 3.0)
    else:
        {"normal": normal, "blocking": blocking, "timeout": timeout, "async": async_block, "lines": lines}[which]()
```

<div class="line-notes">

- `BASE = ` 服务地址。
- `def normal() -> None:` 上面量过的普通接口。
- `times.append(` 每次请求的耗时,乘 1000 换成毫秒。
- `r = httpx.post(f"{BASE}/chat/blocking"` 阻塞版:一个普通 POST,`timeout=60` 是为了这次不要超时。
- `except httpx.ReadTimeout as e:` [Day 65](/blog/agent-zero/day-065-httpx-2/) 学过:服务端 5 秒内没有任何字节回来,httpx 就抛这个异常。
- `th = threading.Thread` 在另一个线程里发那个慢请求,主线程才能同时去请求 `/health`。
- `job = httpx.post(` 创建任务,拿到编号。
- `time.sleep(interval)` 轮询的间隔,默认 3 秒。
- `new = j["events"][seen:]` 只看这次比上次多出来的事件。`seen` 记着已经看过几个。
- `with httpx.stream(` 流式读:不等响应读完,拿到响应头就进入 `with` 块。
- `for line in r.iter_lines():` 一行一行读,读到一行就处理一行,每行前面的时间戳就是它到的时刻。

</div>

先量阻塞版:

```bash
uv run python -m part07.probe378 blocking
```

```text
阻塞接口:等了 10.8 秒才拿到第一个字节,状态 200
  回复: 已核实：INV-2031（专业版年付，468 元）状态为已支付，确实扣款 2 次，属于重复扣款。按政策重复扣款可无条件退回多扣的那一笔，需主管审批后原路退回。我这边可以帮您提交退款申请，需要吗？
```

10.8 秒,用户面前是一个转圈的按钮,没有任何信息。你在前端做过 loading 态,知道用户盯着转圈超过 3 秒是什么感受。Day 133 量过流式的价值:总时长差不多,但第一个字 0.48 秒就出现,体感完全不同。Agent 比单纯的模型调用更要紧,因为它不止慢,过程里还发生了很多用户本来想看的事:查了哪张发票、读了哪条政策。

这个做法还有两个线上必踩的坑,下面一个个复现。

### 坑一:客户端放弃了,服务端还在白跑

浏览器、手机 App、网关,都会在某个时刻放弃等待。先模拟最简单的一种:客户端只肯等 5 秒。

```bash
uv run python -m part07.probe378 timeout
```

```text
客户端 5 秒超时:5.1 秒后抛出 ReadTimeout:ReadTimeout('timed out')
  现在服务端记了几次完成? []
  再过 9 秒: [{'how': 'blocking', 'seconds': 11.44, 'cost': 0.0026}]
```

客户端在 5.1 秒时已经报错走人了,服务端那边什么都不知道:Agent 继续把三次模型调用、两次工具调用全部跑完,一共 11.44 秒,花了 0.0026 元,结果送给了一个已经关掉的连接。一次浪费 0.0026 元看着不多,但用户看到超时的第一反应是**再点一次**,于是同一个问题被问了两遍、三遍,每一遍都在服务端完整跑一次。这还只是花钱。如果 Agent 里有「创建退款」这样的写操作,用户重试就可能真的退两次款,这个问题 Day 392 以后会专门处理。

线上的超时不光来自客户端。中间还有网关。我查了两个最常见的默认值(2026 年 10 月查到):nginx 的 `proxy_read_timeout` 默认 60 秒,而且按文档,它指的是「两次读取之间的间隔」,不是整个响应的总时长,也就是说,只要连接上隔不到 60 秒就有数据,它不会掐;Cloudflare 的默认值是 125 秒,超过就返回 524 错误。所以一个 Agent 如果有时跑到 70 秒,在 nginx 后面会被掐掉,在 Cloudflare 后面能撑到 125 秒,具体掐不掐取决于你前面站了几层。两个网关都是有数据在流就不算超时,这也是流式的一个附带好处。

### 坑二:async def 里直接跑同步的 Agent

[Day 66](/blog/agent-zero/day-066-async-1/) 讲过:`async def` 的函数跑在事件循环那一个线程上,里面如果有一个会卡住的同步调用,整个循环就被占住,谁也动不了。`run_agent` 里全是同步的网络调用和 `time.sleep`。如果把它放进 `async def`,会发生什么?

```bash
uv run python -m part07.probe378 async
```

```text
Agent 在跑的时候请求 /health:等了 9.6 秒
Agent 跑完以后请求 /health:29 毫秒
```

一个只返回 `{"ok": "yes"}` 的健康检查接口,在 Agent 运行期间等了 9.6 秒,等 Agent 跑完才响应。线上的负载均衡会每隔几秒请求一次 `/health`,连续几次没响应,它就判定这个实例挂了,把它摘掉,然后重启。一个用户的一次提问,让整个服务下线。

`chat_blocking`(`def`)没有这个问题,因为 FastAPI 把 `def` 接口放到线程池里跑,卡的是线程,不是事件循环。所以今天服务文件里的原则是:Agent 的同步代码放在 `def` 里或线程池里,不要放进 `async def`。如果整条链路全是异步的(用 `AsyncOpenAI`),才可以写 `async def`,那是后面几周的事。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="三种接口做法在 13 秒里的反馈时刻:阻塞接口 10.8 秒才有第一个字节;轮询每 3 秒问一次,第一次看到进展在 3.1 秒;流式响应头 0.06 秒到,第一个事件 1.3 秒">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="12" y="30" fill="var(--ink)">阻塞 POST</text>
<line x1="120" y1="26" x2="620" y2="26" stroke="var(--rule)"/>
<rect x="120" y="20" width="415" height="12" fill="var(--paper-raised)" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
<circle cx="535" cy="26" r="6" fill="var(--compute)"/>
<text x="400" y="52" fill="var(--ink-soft)" text-anchor="middle" font-size="11">空白 10.8 秒,到了才有字</text>
<text x="12" y="100" fill="var(--ink)">任务+轮询</text>
<line x1="120" y1="96" x2="620" y2="96" stroke="var(--rule)"/>
<circle cx="240" cy="96" r="5" fill="var(--mem)"/>
<circle cx="356" cy="96" r="5" fill="var(--mem)"/>
<circle cx="474" cy="96" r="5" fill="var(--mem)"/>
<circle cx="590" cy="96" r="5" fill="var(--mem)"/>
<text x="240" y="120" fill="var(--ink-soft)" text-anchor="middle" font-size="11">3.1</text>
<text x="356" y="120" fill="var(--ink-soft)" text-anchor="middle" font-size="11">6.2</text>
<text x="474" y="120" fill="var(--ink-soft)" text-anchor="middle" font-size="11">9.2</text>
<text x="590" y="120" fill="var(--ink-soft)" text-anchor="middle" font-size="11">12.2</text>
<text x="12" y="170" fill="var(--ink)">流式响应</text>
<line x1="120" y1="166" x2="620" y2="166" stroke="var(--rule)"/>
<circle cx="122" cy="166" r="4" fill="var(--ink-faint)"/>
<circle cx="170" cy="166" r="5" fill="var(--mem)"/>
<circle cx="324" cy="166" r="5" fill="var(--compute)"/>
<circle cx="362" cy="166" r="5" fill="var(--mem)"/>
<circle cx="516" cy="166" r="5" fill="var(--compute)"/>
<circle cx="553" cy="166" r="5" fill="var(--mem)"/>
<text x="170" y="190" fill="var(--ink-soft)" text-anchor="middle" font-size="11">1.3</text>
<text x="324" y="190" fill="var(--ink-soft)" text-anchor="middle" font-size="11">5.3</text>
<text x="516" y="190" fill="var(--ink-soft)" text-anchor="middle" font-size="11">10.3</text>
<line x1="120" y1="212" x2="620" y2="212" stroke="var(--ink-faint)"/>
<text x="120" y="230" fill="var(--ink-faint)" font-size="11">0 秒</text>
<text x="580" y="230" fill="var(--ink-faint)" font-size="11">13 秒</text>
<text x="300" y="230" fill="var(--ink-soft)" font-size="11">蓝点:模型想完 · 琥珀点:工具跑完</text>
</g>
</svg>
<figcaption>同一次 Agent 运行(每个工具 4 秒)在三种接口下,用户在什么时刻能看到东西。阻塞版在 10.8 秒才有第一个字节;轮询版的点只是「问到的时刻」,事件早就发生了;流式版每个事件一发生就到。数据来自下面三节的实测。</figcaption>
</figure>

## 做法二:先给个编号,让前端隔一会儿来问

既然一次 HTTP 请求撑不住 10 秒,那就把它拆成两件事:POST 马上返回「我收到了,编号是 xxx」(状态码 202),Agent 在后台慢慢跑;前端每隔几秒用编号去问一次「做到哪了」。这叫**轮询**(polling)。

服务文件里的 `create_job`、`get_job` 就是这个做法。用 3 秒的间隔量一次:

```bash
uv run python -m part07.probe378 polling
```

```text
 0.08s POST /jobs → 202 04345243
 3.12s GET  status=running 新事件 ['model']
 6.15s GET  status=running 新事件 ['tool:get_invoice', 'model']
 9.19s GET  status=running 新事件 []
12.22s GET  status=done    新事件 ['tool:get_refund_policy', 'model', 'done']
```

POST 0.08 秒就返回了,不会超时,不会被网关掐,前端关了页面再开,拿着编号还能接着问,这些都是好处。但是仔细看每一行:第 3.12 秒的一次问到了 `model`(它在 1.3 秒就发生了),第 9.19 秒问到的是空的,用户看着「没有任何进展」的时间长达 3 秒,而事件其实发生在两次提问之间。**用户看到的永远是过去的状态,滞后的长度等于轮询间隔。**

轮询间隔缩短会不会好一点?练习 1 就是让你量:1 秒间隔和 10 秒间隔各跑一次。简单说结论:间隔越短,滞后越小,但请求量越大,一个用户 10 秒内发 10 次请求,100 个用户就是每秒 100 次,而且绝大部分是白问的。

轮询还有两个小问题。一是「回答」只能在最后一次取到,打字机效果做不出来,因为回答是模型一个字一个字吐出来的,轮询拿到的只是一堆事件,没有字。二是 `JOBS` 放在内存里:服务一重启任务表就没了,两个实例的话,POST 落在 A 实例,轮询落在 B 实例,B 根本没有这个编号。真要用就得把任务表放到数据库或 Redis 里,那是 [Day 383](/blog/agent-zero/day-383-redis-basics/) 以后的事。

有一个细节:`run_job` 里的 `run_in_threadpool` 还是占了一个线程,轮询省下的是**那条 HTTP 连接**,没有省下**那个干活的线程**。对「同时能撑多少个 Agent」这件事,两种做法没有区别。

## 做法三(预告):连接不关,边做边送

第三种办法:POST 进来以后,服务端不等 Agent 跑完,每有一个事件就立刻写一行出去,连接一直开着,直到 Agent 结束才关。这叫**流式响应**。服务文件里的 `chat_lines` 就是最小版:一个生成器,`StreamingResponse` 一边从它取、一边往连接里写。这里只用最朴素的格式,一个事件一行 JSON,今天只用它来量时间,格式(SSE)和写法放到明天细讲。

```bash
uv run python -m part07.probe378 lines
```

```text
 0.06s 响应头到了 200
 1.30s model
 5.31s tool:get_invoice
 6.29s model
10.30s tool:get_refund_policy
11.25s model
11.25s done
```

第一个事件 1.30 秒就到了,之后每个事件都是发生的那一刻就到。总时长和阻塞版一样(11.25 秒,是模型和工具本身要的时间),但用户从第 1.3 秒起就看到「模型想完了」,第 5.3 秒看到「查完发票了」,他知道事情在往前走。前端可以显示「正在查询发票 INV-2031」「正在查阅退款政策」,Agent 走偏的时候客服能提前喊停。

注意第一行:响应头 0.06 秒就到了,但里面没有任何有用的东西。这个现象在 [Day 133](/blog/agent-zero/day-133-sse-principle/) 里也见过:头到了不等于内容到了。

代价是什么?连接一直开着,服务端要为每个正在跑的 Agent 保持一条连接加一个线程。这个代价和阻塞版一样,没有变多,只是以前这些时间里连接是「沉默的」,现在是「有话说的」。另一个代价在前端:读流比读 JSON 麻烦,断线了怎么办也要自己想。这是明天和 [Day 380](/blog/agent-zero/day-380-event-protocol/) 的内容。

## 三种做法放在一起

| | 阻塞 POST | 任务 + 轮询 | 流式响应 |
| --- | --- | --- | --- |
| 用户第一次看到东西 | 10.8 秒 | 3.1 秒(取决于间隔) | 1.3 秒 |
| 会被网关超时掐掉吗 | 会,Agent 越慢越危险 | 不会,每次请求都很短 | 一般不会,有数据在流 |
| 客户端走了,服务端知道吗 | 不知道,白跑 | 不知道,任务照跑 | 能知道(明天看怎么检测) |
| 能做打字机效果吗 | 不能 | 不能 | 能 |
| 服务端额外要存什么 | 无 | 任务表(要放共享存储) | 无 |
| 前端复杂度 | 最低 | 中,要写定时器 | 最高,要读流 |

没有哪一种永远对。Agent 本来就很快、几秒内结束的内部工具,阻塞 POST 加一个转圈完全够用(练习 2 会量)。后台跑很久、用户不在页面上等的任务(生成一份月度报告),任务加轮询甚至推送通知更合适。用户盯着屏幕等的对话场景,流式几乎是唯一的选择。

## 还有一件事:Agent 会中途停下来

前面都是「一次请求一次回答」。工单 Agent 在退款前会停下来等审批,审批可能几秒,也可能是第二天早上主管上班才点。所以一次对话不一定在一次 HTTP 连接里结束:连接可能在等审批的时候就关了,第二天主管点了通过,服务端要从「停在哪」继续往下跑。这件事决定了会话状态必须存在服务端,而且是存在重启也不丢的地方。这是 [Day 385](/blog/agent-zero/day-385-session-mgmt/) 的内容,今天只要记住:只要 Agent 里有等人的步骤,「阻塞 POST 跑到底」这个模型就一定不够用。

## 估一下要撑多少并发

最后一个不调模型的小估算,也是练习 3 的内容。服务端同时「占着」的请求数 = 每秒到达几个 × 每个占多久(这叫利特尔法则,排队论里最好记的一条)。普通接口每个占 0.02 秒,每分钟 100 次,同时占着不到 0.1 个,线程永远用不完。同样每分钟 100 次,Agent 每次占 12 秒,同时占着 20 个。FastAPI 同步接口默认的线程池上限是 40(明天会实测),每分钟 300 次就是 60 个,不够了。

**这就是 Agent 接口和普通接口最根本的差别:不是慢,是占着不放。** 同样的访问量,需要的并发能力差了几百倍。

## 动手练习

练习一(观察):把轮询间隔换成 1 秒和 10 秒,各跑一次,记下用户「看到最后一个事件」比事件真正发生晚了多久。

<details><summary>参考答案</summary>

先启动 `TOOL_DELAY=4` 的服务,再运行客户端:

```bash
uv run python -m part07.probe378 polling 1
uv run python -m part07.probe378 polling 10
```

间隔 1 秒的实测输出(事件列表为空的行表示这一秒没有新事件):

```text
 0.09s POST /jobs → 202 c6279f41
 1.13s GET  status=running 新事件 ['model']
 2.17s GET  status=running 新事件 []
 3.20s GET  status=running 新事件 []
 4.24s GET  status=running 新事件 []
 5.27s GET  status=running 新事件 ['tool:get_invoice']
 6.31s GET  status=running 新事件 ['model']
 7.35s GET  status=running 新事件 []
 8.39s GET  status=running 新事件 []
 9.42s GET  status=running 新事件 []
10.46s GET  status=running 新事件 ['tool:get_refund_policy']
11.49s GET  status=done    新事件 ['model', 'done']
```

间隔 10 秒的实测输出:

```text
 0.08s POST /jobs → 202 f217c917
10.21s GET  status=running 新事件 ['model', 'tool:get_invoice', 'model', 'tool:get_refund_policy']
20.30s GET  status=done    新事件 ['model', 'done']
```

怎么读。1 秒间隔:11 次提问,每个事件最多晚 1 秒看到(比如 `tool:get_invoice` 在 5.27 秒这次才问到,它实际发生在 4.24 到 5.27 秒之间),最终答案在 11.49 秒这次拿到,真实结束的时刻落在 10.46 到 11.49 秒之间,晚不了 1 秒;代价是 11 个请求,其中 6 个是空的。10 秒间隔:只问了 2 次,头 10 秒用户什么都看不到,最终答案是 20.30 秒才到,而 Agent 在 11 秒左右就做完了,白白晚了 9 秒。间隔选大选小,是在「请求量」和「滞后」之间换。

</details>

练习二(观察):不设 `TOOL_DELAY`(默认 0.4 秒,Agent 本来就很快),重新量一次阻塞版和流式版。阻塞版还难受吗?

<details><summary>参考答案</summary>

重启服务,这次不带 `TOOL_DELAY`:

```bash
uv run uvicorn part07.agent_service:app --host 127.0.0.1 --port 18378
uv run python -m part07.probe378 blocking
uv run python -m part07.probe378 lines
```

实测输出:

```text
阻塞接口:等了 3.9 秒才拿到第一个字节,状态 200
  回复: 已核实：INV-2031（专业版年付，468 元）状态为已支付，确实扣款 2 次，属于重复扣款。……(后面和上面一样)

 0.06s 响应头到了 200
 1.10s model
 1.50s tool:get_invoice
 2.14s model
 2.54s tool:get_refund_policy
 3.53s model
 3.53s done
```

阻塞版 3.9 秒,流式版第一个事件 1.1 秒,总时长 3.53 秒。3.9 秒的转圈,用户能忍,不会撞上任何网关超时。流式在这里的价值是把「第一次看到东西」从 3.9 秒缩到 1.1 秒,是体验上的提升,不是救命的。**接口该不该做流式,看的是 Agent 最慢的那些情况,不是平均情况。** 你要关心的是 P95 和最差的那几条([Day 367](/blog/agent-zero/day-367-tracing-views/) 看过的「最慢」视图)。

</details>

练习三(开放题):一个客服 Agent 平均每次占 12 秒,高峰每分钟 300 次请求。服务端是一台机器、40 个线程。写一个脚本,算出不同请求量和耗时下「同时占着」多少个,并给出三条能降下来的办法。

<details><summary>参考答案</summary>

```python
```python
# agent-zero-lab/part07/ex378_capacity.py
"""练习 3:同时有多少个请求在服务端「占着」?并发数 = 每秒到达几个 × 每个占多久。不调模型。
用法: uv run python -m part07.ex378_capacity"""
from __future__ import annotations

THREADS = 40            # Day 379 会量:FastAPI 的同步接口默认最多 40 个线程同时跑


def concurrent(per_minute: float, seconds_each: float) -> float:
    return per_minute / 60 * seconds_each


if __name__ == "__main__":
    print(f"{'每分钟请求':>10} {'每个占用(秒)':>12} {'同时占着':>8}  线程够吗(40)")
    for per_min, secs in [(100, 0.02), (100, 12), (300, 12), (300, 40), (1000, 12)]:
        n = concurrent(per_min, secs)
        print(f"{per_min:>10} {secs:>12} {n:>8.1f}  {'够' if n < THREADS * 0.7 else '紧张' if n < THREADS else '不够'}")
```
```

<div class="line-notes">

- `THREADS = 40` FastAPI 同步接口用的线程池默认上限(Day 379 会用实测确认)。
- `def concurrent(per_minute: float, seconds_each: float) -> float:` 并发数 = 每秒到达数 × 每个占用时长。
- `return per_minute / 60 * seconds_each` 代入 `(300, 12)`:300 / 60 = 每秒 5 个,5 × 12 = 60 个同时占着。
- `for per_min, secs in [` 五组数:普通接口、中等 Agent、高峰 Agent、很慢的 Agent、高流量 Agent。
- `{'够' if n < THREADS * 0.7 else '紧张' if n < THREADS else '不够'}` 链式的三元表达式,相当于 JS 里两层 `a ? b : c ? d : e`。留 30% 的余量,因为请求不会匀速到达。

</div>

```text
     每分钟请求      每个占用(秒)     同时占着  线程够吗(40)
       100         0.02      0.0  够
       100           12     20.0  够
       300           12     60.0  不够
       300           40    200.0  不够
      1000           12    200.0  不够
```

三条办法:一、让每个请求占得更短(并行调用互不相关的工具、给工具设超时、小模型做简单步骤),把 12 秒降到 8 秒,60 个变成 40 个;二、把等待的部分改成不占线程(全链路异步,等模型和等工具的时候线程是空闲的),这时限制不再是 40 个线程,而是连接数和内存;三、水平扩容,多开几个实例,同时占着的总数分摊,但前提是会话状态不在内存里(上面说过的 `JOBS`)。三条是组合关系,不是三选一。

</details>

验收标准:你能自己复述「阻塞 POST → 超时白跑 → 任务+轮询 → 流式」这条线,每一步说出一个具体的数字;能写出 `iter_agent` 的生成器结构;能在 `async def` 和 `def` 之间说出选哪个的理由。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 长任务 | 一次请求要占服务端很久(几秒到几分钟)的任务。Agent 接口都是长任务,普通接口通常不是 |
| 阻塞接口 | 请求进来,跑完全部,再一次性返回结果的接口。连接在跑的时候是「沉默」的 |
| 超时(timeout) | 等待超过某个时间就放弃。客户端、网关、服务端各有各的超时,哪一层先到谁说了算 |
| 网关 / 反向代理 | 站在服务前面转发请求的程序,比如 nginx、Cloudflare。它有自己的超时,不管你的代码怎么写 |
| 202 状态码 | 「已接受,还在处理」。创建后台任务时返回,告诉客户端稍后再来看结果 |
| 轮询(polling) | 客户端隔一段时间问一次「好了没有」。简单,但看到的永远是过去的状态 |
| 任务编号(job id) | 后台任务的身份证,客户端拿着它来问进度。要放在共享存储里,不能放某个实例的内存 |
| 流式响应 | 响应不一次性给完,服务端边做边送,连接保持到结束。今天只做预告 |
| 线程池 | 一组事先开好的线程,同步代码从里面借一个来跑。FastAPI 的 `def` 接口就是这样跑的 |
| 事件循环 | `async def` 函数共用的那一个线程上的调度器([Day 66](/blog/agent-zero/day-066-async-1/)),被同步代码占住时所有 `async` 接口一起卡住 |
| 利特尔法则 | 同时占着的数量 = 到达速度 × 每个占用的时间。估并发的最简方法 |

## 常见误区

**以为 Agent 慢只是体验问题。** 慢带来的是三个会出事的后果:网关超时掐连接、客户端走了服务端白跑、同时占着的请求把线程池占满。体验是三个里最轻的。

**在 `async def` 里直接调同步的 SDK。** 实测一个 Agent 运行期间,健康检查等了 9.6 秒。健康检查连续没响应,负载均衡会把实例摘掉。同步代码放 `def` 或线程池里。

**超时了就让用户重试,不管服务端。** 实测客户端 5 秒超时后,服务端还跑完了 11.44 秒。用户的重试等于让它再来一遍。重试要么能识别「这个请求已经在跑」,要么写操作有幂等保护。

**以为轮询比阻塞「实时」。** 轮询的滞后等于间隔。实测 10 秒间隔时,Agent 11 秒左右做完,用户 20.30 秒才看到。

**`asyncio.create_task` 创建的任务不保存引用。** 今天的最小版里 `create_job` 里直接调用了它,没有把返回值存起来。Python 文档明确提醒:事件循环只保留对任务的弱引用,任务可能在跑到一半时被垃圾回收。线上写法要把任务放进一个集合里,结束后再移除。

**把 `JOBS` 放内存里就上线。** 重启丢任务,多个实例互相看不到。今天只是演示。

**只按平均耗时估容量。** 平均 12 秒,但有 20% 的请求跑 40 秒,它们占的并发远比平均数大。用分位数,不用平均数。

## 学习资料

### 文档与文章

- [FastAPI 官方文档:Server-Sent Events](https://fastapi.tiangolo.com/tutorial/server-sent-events/)。0.135.0 起自带 SSE 支持,明天用到。今天不需要读完,看一眼目录。
- [nginx 文档:ngx_http_proxy_module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)。搜 `proxy_read_timeout` 和 `proxy_buffering`,各看一段。
- [Cloudflare 文档:Error 524](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/)。短,讲清楚默认的 125 秒。
- [Python 文档:asyncio.create_task](https://docs.python.org/zh-cn/3/library/asyncio-task.html#asyncio.create_task)。里面有关于保存引用的提醒。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV12uHk6XE2a&autoplay=0&high_quality=1" title="AI 串流为什么用 SSE 而不是 WebSocket" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>CodingStartup起码课 · AI 串流为什么用 SSE 而不是 WebSocket｜Server-Sent Events 教学｜真实封包拆解 · 8 分半,先看前半段「为什么 AI 回答是一段一段来的」,后半段留到明天。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/IIhXKoomoNY" title="Polling vs Server-Sent Events (SSE) vs WebSockets" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Mayank Joshi · Polling vs Server-Sent Events (SSE) vs WebSockets | System Design with Microsoft SWE · 英文,三种方式放在一起比,和今天的表格是同一条线。</figcaption>
</figure>

### 书籍

- Michael T. Nygard,《Release It!》第二版(Pragmatic Bookshelf,2018)。讲超时、断路器、舱壁这些「服务怎么在别人出问题时不跟着死」的模式。今天的「客户端走了服务端白跑」就是书里反复出现的主题。英文原版;我没有确认有无中译本。

### 开源项目与代码

- [fastapi/fastapi](https://github.com/fastapi/fastapi):看 `fastapi/sse.py`(今天装的 0.162.0 里有),几百行,明天会读它的一部分。
- [encode/starlette](https://github.com/encode/starlette):`starlette/responses.py` 里的 `StreamingResponse`,今天的 `chat_lines` 就是它。

## 自测

1. 一个普通接口耗时 1.4 毫秒,一个 Agent 接口耗时 11 秒。同样的访问量下,哪一个更容易把线程池占满?为什么?

<details><summary>答案</summary>

Agent 接口。同时占着的请求数 = 每秒到达数 × 每个请求占用的时间。时间差了约 7000 倍,同样的访问量,同时占着的请求数也差约 7000 倍。普通接口几乎永远不会占满线程池,Agent 接口每分钟几百次就可能占满。

</details>

2. 客户端设了 5 秒超时,Agent 要跑 11 秒。5 秒时发生了什么?11 秒时又发生了什么?

<details><summary>答案</summary>

5 秒时客户端抛出 `ReadTimeout` 并放弃连接。服务端对此一无所知,Agent 继续往下跑。11 秒时 Agent 跑完,把结果写给一个已经关掉的连接,没人收到,但三次模型调用的钱已经花了。用户通常会重试,于是同样的事再来一遍。

</details>

3. 为什么 `chat_blocking` 写成 `def`,而反面教材 `chat_blocking_async` 写成 `async def` 会出事?

<details><summary>答案</summary>

`def` 接口由 FastAPI 放进线程池里跑,同步阻塞的代码只卡住那一个线程。`async def` 接口直接跑在事件循环那一个线程上,里面的同步调用(`time.sleep`、同步的 HTTP 请求)会占住事件循环,所有其他请求都得等。实测 Agent 运行期间 `/health` 等了 9.6 秒。

</details>

4. 轮询间隔是 10 秒,Agent 在第 11 秒左右做完。用户最早什么时候能看到答案?

<details><summary>答案</summary>

20 秒左右。提问发生在第 10 秒、第 20 秒,第 10 秒那次 Agent 还没做完,下一次是第 20 秒。实测是 20.30 秒。滞后最长可以接近一个轮询间隔。

</details>

5. (面试题)你们的 Agent 接口偶尔 60 秒以上,前面有 nginx。线上用户反馈「经常报 504」,你先怀疑什么、怎么验证?

<details><summary>答案</summary>

先怀疑 nginx 的 `proxy_read_timeout`,默认 60 秒。验证:看 nginx 的错误日志里有没有 `upstream timed out`,对比 504 出现的请求耗时是不是集中在 60 秒附近。再看 Agent 的 trace([Day 364](/blog/agent-zero/day-364-tracing-concepts/) 学的),确认服务端其实还在跑。治本的办法是流式(有数据在流,nginx 的读超时就不会触发,前提是 `proxy_buffering` 对这个路径已经关掉,否则 nginx 会攒着不给客户端),或者改成任务加轮询。单纯调大超时只是把问题推后。

</details>

## 明天预告

[Day 379](/blog/agent-zero/day-379-sse-server/) · SSE 服务端怎么写,为什么不用 WebSocket。今天只是用最朴素的「一行一个 JSON」量了流式的好处,真要给浏览器用,得按 SSE 的格式写,还得处理断线、重连、客户端走了以后服务端怎么停。明天用 FastAPI 的 `StreamingResponse` 写一个最小的 SSE 服务,用浏览器同款的 `EventSource` 去连它,再把 WebSocket 并排放一次,看它和 SSE 到底差在哪。
