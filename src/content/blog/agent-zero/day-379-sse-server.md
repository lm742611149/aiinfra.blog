---
title: 'Day 379 · SSE 服务端怎么写,为什么不用 WebSocket'
description: '用 FastAPI 的 StreamingResponse 写最小的 SSE 服务,再用浏览器同款的 EventSource 去连:少一个空行事件永远不触发,忘了 Content-Type 连接立刻被关,服务端一结束浏览器 3 秒后自动重连、把整个 Agent 再跑一遍。还实测了客户端走了以后同步生成器的 finally 不执行、默认 40 个线程挡住第 41 个连接,以及 WebSocket 握手不走 HTTP 中间件。'
pubDate: 2026-10-27
regime: none
tags: ['fastapi', 'sse', 'websocket', 'streaming', 'agent-zero']
series: 'agent-zero'
day: 379
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 378](/blog/agent-zero/day-378-agent-api/) 把同一个 Agent 放在四种接口后面量:阻塞的 POST 让用户盯着空白等 10.8 秒,客户端 5 秒超时后服务端照样跑完 11.44 秒白花钱,`async def` 里直接跑同步 Agent 会让 `/health` 等 9.6 秒,任务加轮询的滞后等于轮询间隔。流式响应第一个事件 1.3 秒就到,但那一天只用了最朴素的「一行一个 JSON」,没有讲格式,也没有讲浏览器怎么接。

今天补上服务端这一半:SSE 到底怎么写,写错了会怎样,服务端怎么知道客户端走了,以及老问题:同样是「服务端往外推」,为什么 Agent 接口几乎都选 SSE,不选看起来更强的 WebSocket。

## 今天要解决的问题

学完今天,你应该能:

1. 用 `StreamingResponse` 写出一个最小的 SSE 服务,说出它必须满足的两个条件(响应头和事件末尾的空行),并故意写错两次,说出各自的现象。
2. 用浏览器同款的 `EventSource` 去连它,解释「服务端一结束,浏览器自动重连」这件事,会用 `id` 和 `Last-Event-ID` 让重连接着发。
3. 说清楚客户端走了以后,服务端的生成器会发生什么:`async` 的会被及时取消,同步的不会。
4. 用实测的数据说出 SSE 和 WebSocket 的差别,并认识 FastAPI 自带的 `EventSourceResponse`。

今天两个新概念:**用 `StreamingResponse` 写 SSE**,和 **SSE 与 WebSocket 的取舍**。SSE 的格式本身[Day 133](/blog/agent-zero/day-133-sse-principle/)讲过,今天不重讲。

预计用时 3 小时。前置:[Day 79](/blog/agent-zero/day-079-fastapi-1/) 到 [Day 81](/blog/agent-zero/day-081-fastapi-3/)(FastAPI、中间件),[Day 99](/blog/agent-zero/day-099-generators/)(生成器),[Day 66](/blog/agent-zero/day-066-async-1/) 到 [Day 68](/blog/agent-zero/day-068-async-3/)(async),[Day 133](/blog/agent-zero/day-133-sse-principle/) 建的 `part02/sse_parse.py`(练习 3 用),[Day 378](/blog/agent-zero/day-378-agent-api/)(阻塞、超时、线程池)。今天**没有调模型**,事件是造的假数据,所以一个 token 都没有花。需要装:`uv add fastapi uvicorn httpx websockets`,练习 3 的测试还要 `uv add --dev pytest`。前端那一半要用 Node 24 自带的 `EventSource`(Node 里要加 `--experimental-eventsource`),你本来就有 Node,不用另装。

学法和平时一样:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章默写核心部分;做练习时先自己写,做不出再展开参考答案,看完关掉重写一遍。

## 第一步:最小的 SSE 服务

SSE 的格式 [Day 133](/blog/agent-zero/day-133-sse-principle/) 手写过:响应头 `Content-Type: text/event-stream`,正文是一个个事件,每个事件几行 `字段: 值`,**空行**收尾。现在换成 FastAPI。需要的零件只有两个:一个会 `yield` 文本的生成器,和 `StreamingResponse`,后者一边从生成器里取、一边往连接里写。

下面是今天的服务文件。四种用途的接口都在里面,但先只看前面这几个:

```python
# agent-zero-lab/part07/sse_min.py
"""Day 379:用 FastAPI 写 SSE 服务端。不调模型,事件是假的,只量服务端的行为。端口 18379,只监听本机。
启动: uv run uvicorn part07.sse_min:app --host 127.0.0.1 --port 18379"""
from __future__ import annotations

import asyncio
import json
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from typing import Annotated, Any

from fastapi import FastAPI, Header, Request, WebSocket
from fastapi.responses import Response, StreamingResponse

app = FastAPI()

EVENTS: list[dict[str, Any]] = [
    {"type": "token", "text": "已"},
    {"type": "token", "text": "核实"},
    {"type": "tool_call", "name": "get_invoice"},
    {"type": "tool_result", "name": "get_invoice", "ok": True},
    {"type": "done"},
]
LOG: list[str] = []


@app.middleware("http")
async def stamp_request_id(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    """Day 81 学的:给每个 HTTP 响应盖一个 X-Request-ID。"""
    response = await call_next(request)
    response.headers["X-Request-ID"] = uuid.uuid4().hex[:8]
    return response


def sse(data: dict[str, Any], event: str | None = None, id: str | None = None) -> str:
    """把一个事件拼成 SSE 文本。最后那个空行(多一个 \\n)是事件的结束标记。"""
    head = (f"id: {id}\n" if id else "") + (f"event: {event}\n" if event else "")
    return f"{head}data: {json.dumps(data, ensure_ascii=False)}\n\n"


def fake_agent(delay: float = 0.5) -> Iterator[dict[str, Any]]:
    for e in EVENTS:
        time.sleep(delay)
        yield e


@app.get("/s1")
def s1() -> StreamingResponse:
    def gen() -> Iterator[str]:
        for e in fake_agent():
            yield sse(e)
    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/s1-async")
async def s1_async() -> StreamingResponse:
    """同样的内容,换成 async 生成器:等待的时候不占线程。"""
    async def gen() -> AsyncIterator[str]:
        for e in EVENTS:
            await asyncio.sleep(0.5)
            yield sse(e)
    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/s1-plain")
def s1_plain() -> StreamingResponse:
    """故意写错:忘了 media_type,默认是 text/plain。"""
    def gen() -> Iterator[str]:
        for e in fake_agent():
            yield sse(e)
    return StreamingResponse(gen())


@app.get("/s1-noblank")
def s1_noblank() -> StreamingResponse:
    """故意写错:每个事件只有一个 \\n,少了结尾的空行。"""
    def gen() -> Iterator[str]:
        for e in fake_agent():
            yield f"data: {json.dumps(e, ensure_ascii=False)}\n"
    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/s1-retry")
def s1_retry() -> StreamingResponse:
    """第一行告诉浏览器:断线后 1000 毫秒就重连(默认是几秒,各浏览器不一样)。"""
    def gen() -> Iterator[str]:
        yield "retry: 1000\n\n"
        for e in fake_agent():
            yield sse(e)
    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/s2")
def s2(last_event_id: Annotated[str | None, Header()] = None) -> StreamingResponse:
    """带 id 和 event 名;重连时浏览器自动带 Last-Event-ID,从下一条接着发。"""
    start = int(last_event_id) + 1 if last_event_id is not None else 0

    def gen() -> Iterator[str]:
        for i, e in enumerate(EVENTS):
            if i < start:
                continue
            yield sse(e, event=e["type"], id=str(i))
    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/gone-sync")
def gone_sync() -> StreamingResponse:
    def gen() -> Iterator[str]:
        try:
            for i in range(20):
                time.sleep(0.5)
                LOG.append(f"sync 发出第 {i} 条")
                yield sse({"n": i})
        finally:
            LOG.append("sync 生成器结束")
    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/gone-async")
async def gone_async() -> StreamingResponse:
    async def gen() -> AsyncIterator[str]:
        try:
            for i in range(20):
                await asyncio.sleep(0.5)
                LOG.append(f"async 发出第 {i} 条")
                yield sse({"n": i})
        finally:
            LOG.append("async 生成器结束")
    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/log")
def log() -> list[str]:
    return LOG


@app.websocket("/ws")
async def ws(websocket: WebSocket) -> None:
    await websocket.accept()
    for e in EVENTS:
        await asyncio.sleep(0.5)
        await websocket.send_json(e)
    await websocket.close()
```

<div class="line-notes">

- `EVENTS: list[dict[str, Any]] = [` 五个假事件,和 Day 378 的事件类似:两个 `token`,一次工具调用,一次工具结果,一个 `done`。没有调模型,所以事件之间的间隔是下面 `fake_agent` 里睡出来的。
- `LOG: list[str] = []` 后面「客户端走了」那一节往里写日志,再用 `/log` 取出来看。
- `@app.middleware("http")` [Day 81](/blog/agent-zero/day-081-fastapi-3/) 学的中间件:每个 HTTP 请求都会经过它。今天用它来证明 WebSocket 不走这条路。
- `response.headers["X-Request-ID"]` 给响应盖一个随机编号。后面对比 SSE 和 WebSocket 的握手响应时,看这个头在不在。
- `def sse(data` 把一个事件拼成 SSE 文本的小函数。`event`、`id` 是可选的。
- `head = (f"id: {id}` 有 `id` 就加一行 `id: 3`,有 `event` 就加一行 `event: tool_result`。没传就是空字符串,这样没有名字的事件会走浏览器的 `message`。
- `return f"{head}data: {json.dumps(` `data:` 那一行放 JSON。末尾的 `\n\n` 里,第一个 `\n` 结束 `data:` 这一行,第二个 `\n` 就是那个**空行**,事件到这里才算结束。后面的故意写错就是少了这一个。
- `def fake_agent(` 假的 Agent:每隔 `delay` 秒产出一个事件。它是生成器,和 `toy_agent.iter_agent` 的形状一样。
- `time.sleep(delay)` 同步睡眠,模拟「模型在想、工具在查」。注意是同步的,会占着线程。
- `@app.get("/s1")` 最小的 SSE。为什么是 GET:后面的 `EventSource` 只会发 GET。第四步再看 POST。
- `def gen() -> Iterator[str]:` 内层生成器,每次取一个事件。放在函数里面,是因为它要用外面的参数。
- `yield sse(e)` 取一个事件,拼成文本,交出去。`StreamingResponse` 每收到一段就立刻写进连接。
- `return StreamingResponse(gen(), media_type="text/event-stream")` 两件事:把生成器交出去;`media_type` 决定响应头里的 `Content-Type`。这个参数不写,默认是 `text/plain`,第三步会看到后果。
- `async def gen() -> AsyncIterator[str]:` `/s1-async` 里的 `async` 生成器版本:`await asyncio.sleep` 的时候不占线程。第五、六步用它做对比。
- `await asyncio.sleep(0.5)` 异步睡眠,等待期间事件循环可以去处理别的请求。
- `return StreamingResponse(gen())` `/s1-plain`:故意漏掉 `media_type`。
- `yield f"data: {json.dumps(e, ensure_ascii=False)}\n"` `/s1-noblank`:故意只写一个 `\n`,少了结尾的空行。
- `yield "retry: 1000\n\n"` `/s1-retry`:单独发一个只有 `retry` 的事件,告诉浏览器「断线后等 1000 毫秒再重连」。练习 2 会用。
- `start = int(last_event_id) + 1` `/s2`:浏览器重连时会自动带 `Last-Event-ID` 头,值是它收到的最后一个 `id`。从下一个编号开始发,就是「断点续传」。FastAPI 会把名叫 `last_event_id` 的参数对应到 `Last-Event-ID` 这个头(下划线变连字符)。
- `if i < start:` 已经发过的跳过。
- `yield sse(e, event=e["type"], id=str(i))` 每个事件带上编号和名字。`id` 必须是字符串。
- `LOG.append("sync 生成器结束")` `/gone-sync` 里 `finally` 块写的日志:生成器无论怎么结束,都应该走到这里。
- `LOG.append("async 生成器结束")` 同样的写法,`async` 版本。
- `await websocket.accept()` `/ws`:WebSocket 要先 `accept` 才算握手完成。第七步用。
- `await websocket.send_json(e)` 发一个 JSON 消息。和 SSE 不一样,这里没有「格式」的概念,消息一条就是一条。

</div>

启动(端口 18379,只监听本机):

```bash
uv run uvicorn part07.sse_min:app --host 127.0.0.1 --port 18379
```

用 `curl -N`(`-N` 关掉 curl 自己的缓冲,Day 133 讲过)连上去,同时用一个小脚本给每一行打时间戳。这个 `stamp.py` 不属于课程仓库,放在哪都行:

```python
# stamp.py
import sys, time
t = time.time()
for line in sys.stdin:
    print(f"{time.time() - t:5.2f}s {line.rstrip()!r}", flush=True)
```

```bash
curl -sN -i http://127.0.0.1:18379/s1 | python3 stamp.py
```

```text
 0.51s 'HTTP/1.1 200 OK'
 0.51s 'date: Tue, 27 Oct 2026 12:12:14 GMT'
 0.51s 'server: uvicorn'
 0.51s 'content-type: text/event-stream; charset=utf-8'
 0.51s 'x-request-id: a9134686'
 0.51s 'Transfer-Encoding: chunked'
 0.51s ''
 0.51s 'data: {"type": "token", "text": "已"}'
 0.51s ''
 1.02s 'data: {"type": "token", "text": "核实"}'
 1.02s ''
 1.52s 'data: {"type": "tool_call", "name": "get_invoice"}'
 1.52s ''
 2.03s 'data: {"type": "tool_result", "name": "get_invoice", "ok": true}'
 2.03s ''
 2.53s 'data: {"type": "done"}'
 2.53s ''
```

几个现象。这次 curl 打印出响应头的时刻和第一个事件是同一刻(0.51 秒);Day 378 里 httpx 记到的响应头 0.06 秒就到了。两种工具记的时刻不一样,我没有深究,下面只看事件之间的间隔。之后每个事件按 0.5 秒的间隔到,每个事件后面跟一个空行,这就是 `\n\n` 里第二个 `\n`。`Transfer-Encoding: chunked` 说明服务端不知道总长度,一块一块送,这是流式响应在 HTTP/1.1 里的实现办法。还要注意:响应头里**没有** `cache-control` 和 `x-accel-buffering`,这一点第六步回头看。

## 第二步:用浏览器同款的 EventSource 去连

curl 看到的是原始文本。真正的客户端是浏览器里的 `EventSource`。你做前端,多半见过或用过它,它有三个特点:只能发 GET;收到的事件会自动按 SSE 格式解析;**断线会自动重连**。第三个特点是今天最大的坑,所以必须用它自己来看一遍。Node 24 带了同样的实现(要加一个实验开关)。脚本如下,浏览器里把 `console.log` 换成界面更新就是真的前端代码:

```javascript
// agent-zero-lab/part07/web/es.mjs
// 用浏览器同款的 EventSource 连一个地址,打印收到的每个事件。Node 24 里要加 --experimental-eventsource。
// 用法: node --experimental-eventsource part07/web/es.mjs http://127.0.0.1:18379/s1 [秒数]
const url = process.argv[2];
const seconds = Number(process.argv[3] ?? 4);
const t0 = Date.now();
const stamp = () => ((Date.now() - t0) / 1000).toFixed(2) + "s";
const es = new EventSource(url);
es.onopen = () => console.log(stamp(), "open");
es.onmessage = (e) => console.log(stamp(), "message", e.data, "lastEventId=" + JSON.stringify(e.lastEventId));
for (const name of ["token", "tool_call", "tool_result", "done"]) {
  es.addEventListener(name, (e) => console.log(stamp(), name, e.data, "lastEventId=" + JSON.stringify(e.lastEventId)));
}
es.onerror = (e) => console.log(stamp(), "error", e.message ?? "", "readyState=" + es.readyState);
setTimeout(() => { es.close(); console.log(stamp(), "手动 close"); }, seconds * 1000);
```

<div class="line-notes">

- `const es = new EventSource(url);` 创建连接,构造函数只有两个参数:地址和一个 `withCredentials`。**没有请求头、没有请求体、没有方法**,这是它的硬限制。
- `es.onopen` 连接建立的回调。
- `es.onmessage` 没有 `event:` 名字的事件走这里,`e.data` 是 `data:` 行(多行会用换行拼起来),`e.lastEventId` 是最近一个 `id`。
- `for (const name of` 有名字的事件不会走 `onmessage`,要按名字 `addEventListener`。名字得提前知道,漏写一个就收不到那一种。
- `es.addEventListener(name` 给每个名字挂同一个处理函数。
- `es.onerror` 出错或者连接断开都会走这里。`readyState` 是 0(正在连/重连)、1(已连接)、2(已关闭)。
- `setTimeout(() => { es.close()` 到时间主动关。**`close()` 是唯一能让它不再重连的办法。**

</div>

```bash
node --experimental-eventsource part07/web/es.mjs http://127.0.0.1:18379/s1 9
```

```text
0.06s open
0.56s message {"type": "token", "text": "已"} lastEventId=""
1.06s message {"type": "token", "text": "核实"} lastEventId=""
1.57s message {"type": "tool_call", "name": "get_invoice"} lastEventId=""
2.07s message {"type": "tool_result", "name": "get_invoice", "ok": true} lastEventId=""
2.58s message {"type": "done"} lastEventId=""
2.58s error  readyState=0
5.58s open
6.09s message {"type": "token", "text": "已"} lastEventId=""
6.59s message {"type": "token", "text": "核实"} lastEventId=""
7.09s message {"type": "tool_call", "name": "get_invoice"} lastEventId=""
7.59s message {"type": "tool_result", "name": "get_invoice", "ok": true} lastEventId=""
8.10s message {"type": "done"} lastEventId=""
8.10s error  readyState=0
9.05s 手动 close
```

看 2.58 秒那一行:服务端发完 `done`、正常结束了响应,浏览器却报了一个 `error`,`readyState=0`,意思是「连接断了,我在重连」。3 秒后(5.58 秒)它真的重连了,**把整个事件流又收了一遍**。如果这是一个 Agent 接口,一次用户提问就变成了两次、三次,每次都花钱,每次都可能触发工具里的写操作。

原因是 SSE 把「服务端关闭连接」一律当成「断线」,浏览器不区分「正常结束」和「网络出问题」。解法在客户端:收到 `done` 事件(或者 `[DONE]`)就自己调用 `es.close()`。这也是为什么第一步的事件里有一个明确的 `done`:协议要自己带一个结束标记,不能指望连接关闭来表达。

这里有个小细节:重连等了约 3 秒,这是 Node 的默认值。浏览器之间不一样,规范只说「几秒」。要自己定,服务端可以在流里发一个 `retry: 毫秒数` 字段,练习 2 会量。

## 第三步:故意写错两次

[Day 133](/blog/agent-zero/day-133-sse-principle/) 讲过格式的规则,这里看违反规则的后果。服务文件里有两个故意写错的接口,用 `EventSource` 各连一次。

先是 `/s1-plain`,忘了写 `media_type`,响应头里 `Content-Type` 变成了 `text/plain`:

```bash
node --experimental-eventsource part07/web/es.mjs http://127.0.0.1:18379/s1-plain 4
```

```text
0.06s error  readyState=2
4.04s 手动 close
```

连 `open` 都没触发,直接 `error`,而且 `readyState=2`(已关闭,不会重连)。`EventSource` 对响应头很严格:不是 `text/event-stream` 就当作失败。如果你只用 curl 测,会发现 `/s1-plain` 的数据一行不少地出来了,看不出问题,上了浏览器才炸。**测 SSE 接口,至少要用一次真的 `EventSource`。**

再是 `/s1-noblank`,响应头对了,但每个事件只写了一个 `\n`,没有结尾的空行:

```bash
node --experimental-eventsource part07/web/es.mjs http://127.0.0.1:18379/s1-noblank 4
```

```text
0.07s open
2.58s error  readyState=0
4.05s 手动 close
```

`open` 触发了,连接也在,但**一个 `message` 都没有**。浏览器在等那个空行,有空行才会把前面攒的几行当作一个完整事件派发出去。服务端发了 5 个「半个事件」,到 2.58 秒响应结束,浏览器丢掉没收完的,报 `error`,开始重连。这个错特别难查:网络面板里能看到数据一行行进来,但 `onmessage` 就是不响,你会怀疑自己是不是 JSON 解析错了。

## 第四步:id 和 Last-Event-ID,重连接着发

重连不可避免:手机切网络、电梯里信号丢了、网关隔几分钟就换一次连接。既然 `EventSource` 一定会重连,服务端就要让重连时「接着发」,而不是「从头发」。办法是给每个事件一个 `id`,浏览器会记住收到的最后一个 `id`,重连时放进请求头 `Last-Event-ID`。

`/s2` 就是这样写的。先用 curl 手动带这个头,看看服务端怎么接:

```bash
curl -sN -H "Last-Event-ID: 2" http://127.0.0.1:18379/s2
```

```text
id: 3
event: tool_result
data: {"type": "tool_result", "name": "get_invoice", "ok": true}

id: 4
event: done
data: {"type": "done"}

```

声称「我收到了 2 号」,服务端就从 3 号开始发。再用 `EventSource` 连一次(没有带头,是第一次连接):

```bash
node --experimental-eventsource part07/web/es.mjs http://127.0.0.1:18379/s2 6
```

```text
0.05s open
0.06s token {"type": "token", "text": "已"} lastEventId="0"
0.06s token {"type": "token", "text": "核实"} lastEventId="1"
0.06s tool_call {"type": "tool_call", "name": "get_invoice"} lastEventId="2"
0.06s tool_result {"type": "tool_result", "name": "get_invoice", "ok": true} lastEventId="3"
0.06s done {"type": "done"} lastEventId="4"
0.06s error  readyState=0
3.06s open
3.06s error  readyState=0
6.04s 手动 close
```

有名字的事件走自己的处理函数(第一列写的 `token`、`tool_call`),`lastEventId` 一个一个涨到 4。0.06 秒就全发完了,因为 `/s2` 没睡觉。同样在 0.06 秒的 `error` 之后,3.06 秒重连,这次浏览器带了 `Last-Event-ID: 4`,服务端发现没有更多可发,响应是空的,于是又 `error`、又重连,下一次还是 3 秒后……这就是一个没人调用 `close()` 的 `EventSource` 的下场:每 3 秒重连一次,永远不停。

这个机制能用的前提是,服务端**能从断点接着发**。一个纯展示用的 `EVENTS` 列表当然可以,Agent 的运行就不一样了:服务端要把已经发出去的事件存下来(存在哪,[Day 385](/blog/agent-zero/day-385-session-mgmt/) 讲),重连时再从存的地方读。如果存不下来,更诚实的办法是让客户端知道「这次中断了,重新问吧」,别假装能续。

还有一点:`EventSource` 只能发 GET,没有请求体,也没法加 `Authorization` 头。Agent 接口要带一段问题、要带令牌,所以前端实际用的是 `fetch` 加手写解析(或者一个封装库),这样能用 POST、能加头。代价是你得自己处理重连和 `Last-Event-ID`,浏览器不会帮你了。

## 第五步:客户端走了,服务端能停下来吗

Day 378 的坑一:客户端走了,服务端白跑。流式响应有机会解决它,因为服务端在往连接里写,写不出去就应该能发现。`/gone-sync` 和 `/gone-async` 是两个会发 20 个事件(每 0.5 秒一个)的接口,`finally` 块里会往日志写一行。各用 `curl -m 2` 连 2 秒就断开,然后等几秒看日志:

```bash
for k in sync async; do curl -sN -m 2 http://127.0.0.1:18379/gone-$k > /dev/null; done
sleep 12
curl -s http://127.0.0.1:18379/log
```

```text
sync 发出第 0 条
sync 发出第 1 条
sync 发出第 2 条
sync 发出第 3 条
async 发出第 0 条
async 发出第 1 条
async 发出第 2 条
async 生成器结束
```

(日志是一个 JSON 数组,我把它一行一行列出来了。)

两个接口各被连了 2 秒。`async` 的:发了 3 条(0.5、1.0、1.5 秒),连接断开,**`finally` 马上执行**,日志里有「async 生成器结束」。同步的:发了 4 条,然后不再发了,但 12 秒后日志里**没有**「sync 生成器结束」。我又多等了 5 秒,再重复了一次,还是没有。至少在我这次实测的 17 秒里,同步生成器里的 `finally` 没有被执行。

这很要命。你在 `finally` 里想做的事,比如取消还在跑的 Agent、释放一个锁、把状态标成「用户已离开」,在同步版本里不会及时发生。原因我只有推测,没有读源码确认:`async` 生成器可以被直接取消,而同步生成器是被放在线程池里一步一步迭代的,客户端断开时外面的任务被取消了,但那个挂起的生成器可能没有人去关它,`finally` 要等它被回收才会执行。实测现象是确定的,机制以你读到的 Starlette 源码为准。

所以今天的结论是:**SSE 接口用 `async` 生成器。** 但 Agent 的核心代码(调 SDK、调工具)往往是同步的,怎么办?把同步的部分放到线程里跑,外面套一层 `async` 生成器,让断开能被感知。练习 1 就是写这样一个包装,顺便加上心跳。

## 第六步:线程池只有 40 个

Day 378 说过,FastAPI 的同步接口跑在线程池里。同步的 SSE 生成器每个连接占一个线程,直到连接结束。线程池默认上限是多少?量一下:同时连 N 个客户端,每个记「第一个事件多久到」,`/s1` 里第一个事件要睡 0.5 秒才发。

```python
# agent-zero-lab/part07/load379.py
"""Day 379:同时连 N 个客户端,看每个人多久收到第一个事件。先启动 sse_min。
用法: uv run python -m part07.load379 /s1 45"""
from __future__ import annotations

import asyncio
import statistics
import sys
import time

import httpx


async def one(client: httpx.AsyncClient, url: str) -> float:
    t = time.perf_counter()
    first = -1.0
    async with client.stream("GET", url, timeout=60) as r:
        async for _ in r.aiter_lines():
            if first < 0:
                first = time.perf_counter() - t      # 第一行到的时刻;后面的行继续读完,不记时间
    return first


async def main(path: str, n: int) -> None:
    limits = httpx.Limits(max_connections=n)
    async with httpx.AsyncClient(base_url="http://127.0.0.1:18379", limits=limits) as c:
        firsts = sorted(await asyncio.gather(*[one(c, path) for _ in range(n)]))
    print(f"{path} 同时 {n} 个:首个事件 最快 {firsts[0]:.2f}s 中位 {statistics.median(firsts):.2f}s 最慢 {firsts[-1]:.2f}s")
    print("  超过 1 秒才收到的有", sum(f > 1 for f in firsts), "个")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], int(sys.argv[2])))
```

<div class="line-notes">

- `first = time.perf_counter() - t` 第一行到的时刻。`first < 0` 时才记,之后的行只读不记。
- `limits = httpx.Limits(max_connections=n)` 客户端默认最多同时开 100 个连接,这里改成 N,免得客户端自己先卡住,量到的是客户端的限制。
- `firsts = sorted(await asyncio.gather(` [Day 68](/blog/agent-zero/day-068-async-3/) 的 `gather`:N 个请求同时发,等全部结束,每个返回自己的首事件耗时,再排序。

</div>

```bash
uv run python -m part07.load379 /s1 20
uv run python -m part07.load379 /s1 45
uv run python -m part07.load379 /s1-async 45
uv run python -m part07.load379 /s1 100
uv run python -m part07.load379 /s1-async 100
```

```text
/s1 同时 20 个:首个事件 最快 0.54s 中位 0.54s 最慢 0.56s
  超过 1 秒才收到的有 0 个
/s1 同时 45 个:首个事件 最快 0.57s 中位 0.58s 最慢 1.07s
  超过 1 秒才收到的有 5 个
/s1-async 同时 45 个:首个事件 最快 0.54s 中位 0.56s 最慢 0.56s
  超过 1 秒才收到的有 0 个
/s1 同时 100 个:首个事件 最快 0.62s 中位 1.18s 最慢 1.68s
  超过 1 秒才收到的有 60 个
/s1-async 同时 100 个:首个事件 最快 0.58s 中位 0.62s 最慢 0.62s
  超过 1 秒才收到的有 0 个
```

20 个同步连接没有问题。45 个时,有 5 个要多等约 0.5 秒:线程池只有 40 个线程,前 40 个连接各占一个线程,第 41 到第 45 个只能排队,等前面有人结束、线程还回来才轮到。100 个时,60 个排了队,中位数翻倍。`async` 版本即使 100 个也没有排队,因为等待的时候不占线程。

排队的间隔只有半秒,是因为我的假 Agent 每个连接只占 2.5 秒。真的 Agent 一个连接占 10 秒到几十秒,排在第 41 位的人要等的就是几十秒。这和 Day 378 练习 3 的算术是一回事:同时占着的连接数 = 到达速度 × 每个占用的时长,同步写法的上限是 40。我没有改过线程池设置;40 是 FastAPI 同步接口所用的线程限制器的默认值(我没有读源码确认,实测的结果和它吻合)。可以调大,但每个线程是真实的开销,调大只是推迟问题。

## 第七步:FastAPI 自带的 SSE

上面几步,事件的拼接、响应头、心跳、编号都是你自己写的。FastAPI 从 0.135.0 起自带了 SSE 支持(2026 年 10 月查官方文档);今天装的版本是 0.162.0,PyPI 上标的上传时间是 2026-10-23。用法是把路由的 `response_class` 设成 `EventSourceResponse`,函数里直接 `yield`。

```python
# agent-zero-lab/part07/sse_builtin.py
"""Day 379:FastAPI 0.135+ 自带的 SSE 写法。端口 18380,只监听本机。
启动: uv run uvicorn part07.sse_builtin:app --host 127.0.0.1 --port 18380"""
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterable
from typing import Annotated, Any

from fastapi import FastAPI, Header
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel

from part07.sse_min import EVENTS

app = FastAPI()


class Ask(BaseModel):
    question: str


@app.post("/chat", response_class=EventSourceResponse)
async def chat(body: Ask) -> AsyncIterable[ServerSentEvent]:
    for i, e in enumerate(EVENTS):
        await asyncio.sleep(0.3)
        yield ServerSentEvent(data=e, event=e["type"], id=str(i))
    yield ServerSentEvent(raw_data="[DONE]", event="end")


@app.get("/quiet", response_class=EventSourceResponse)
async def quiet() -> AsyncIterable[dict[str, Any]]:
    """中间安静 17 秒,看自带的心跳。"""
    yield {"n": 1}
    await asyncio.sleep(17)
    yield {"n": 2}


@app.get("/resume", response_class=EventSourceResponse)
async def resume(last_event_id: Annotated[int | None, Header()] = None) -> AsyncIterable[ServerSentEvent]:
    start = last_event_id + 1 if last_event_id is not None else 0
    for i, e in enumerate(EVENTS):
        if i >= start:
            yield ServerSentEvent(data=e, event=e["type"], id=str(i))
```

<div class="line-notes">

- `from fastapi.sse import EventSourceResponse, ServerSentEvent` 两个类,自带,不用装别的库。
- `@app.post("/chat", response_class=EventSourceResponse)` **POST 也行**。浏览器的 `EventSource` 用不了 POST,但 `fetch` 能;MCP 的传输就是 POST 加 SSE。
- `-> AsyncIterable[ServerSentEvent]:` 返回类型标成「异步可迭代的事件」。函数里有 `yield`,所以它是异步生成器,不需要自己包 `StreamingResponse`。
- `yield ServerSentEvent(data=e` 事件体、`event` 名、`id` 都是参数,不用自己拼 `\n\n`。
- `yield ServerSentEvent(raw_data="[DONE]"` `raw_data` 是「原样发,不做 JSON 编码」,用来发 OpenAI 风格的 `[DONE]` 结束标记。`data` 和 `raw_data` 只能二选一。
- `yield {"n": 1}` 直接 yield 一个字典也可以,会被当作 JSON 放进 `data:`。
- `await asyncio.sleep(17)` 故意安静 17 秒,看自带的心跳。
- `last_event_id: Annotated[int | None, Header()] = None` `Last-Event-ID` 头的接法,和手写版本一样,类型标成 `int | None`,FastAPI 会帮你转。
- `start = last_event_id + 1` 同样从下一条开始发。

</div>

启动在另一个端口(18380),看线上的字节:

```bash
uv run uvicorn part07.sse_builtin:app --host 127.0.0.1 --port 18380
curl -sN -i -X POST http://127.0.0.1:18380/chat -H 'content-type: application/json' -d '{"question":"x"}' | python3 stamp.py
```

```text
 0.30s 'HTTP/1.1 200 OK'
 0.30s 'date: Tue, 27 Oct 2026 12:14:18 GMT'
 0.30s 'server: uvicorn'
 0.30s 'content-type: text/event-stream; charset=utf-8'
 0.30s 'cache-control: no-cache'
 0.30s 'x-accel-buffering: no'
 0.30s 'Transfer-Encoding: chunked'
 0.30s ''
 0.30s 'event: token'
 0.30s 'data: {"type": "token", "text": "\\u5df2"}'
 0.30s 'id: 0'
 0.30s ''
 0.60s 'event: token'
 0.60s 'data: {"type": "token", "text": "\\u6838\\u5b9e"}'
 0.60s 'id: 1'
 0.60s ''
 ……
 1.51s 'event: done'
 1.51s 'data: {"type": "done"}'
 1.51s 'id: 4'
 1.51s ''
 1.51s 'event: end'
 1.51s 'data: [DONE]'
 1.51s ''
```

(中间两个事件我用省略号略去了。)和手写的相比,有三处不同。第一,响应头自带 `cache-control: no-cache` 和 `x-accel-buffering: no`,第一步手写的版本没有。后一个头是告诉 nginx 别缓冲这个响应:Day 378 查到 nginx 的 `proxy_buffering` 默认是开的,开着的时候 nginx 会把响应先攒着,你的事件一个都到不了浏览器,直到攒够或结束。手写版本想在 nginx 后面工作,就得自己补这个头。第二,`data:` 里的中文被转成了 `已` 这样的转义,这是合法的 JSON,浏览器 `JSON.parse` 会还原,但用 curl 看不出原文;想看原文,可以自己传字符串用 `raw_data`,或者继续手写。第三,字段顺序是 `event`、`data`、`id`,顺序无所谓,浏览器按字段名解析。

再看心跳:`/quiet` 先发一个事件,隔 17 秒再发一个。

```bash
curl -sN http://127.0.0.1:18380/quiet | python3 stamp.py
```

```text
 0.00s 'data: {"n":1}'
 0.00s ''
14.99s ': ping'
14.99s ''
16.99s 'data: {"n":2}'
16.99s ''
```

14.99 秒时自动插了一行 `: ping`,以冒号开头是注释,浏览器会忽略,作用是让中间的网关知道连接还活着。这和 Day 378 查到的网关超时是一回事:很多网关是「一段时间没有数据」才掐,每 15 秒来一个注释就不会被掐。这个 15 秒是官方文档写的默认值,我实测也吻合。

最后用 `Last-Event-ID` 试一下续传:

```bash
curl -sN -H "Last-Event-ID: 3" http://127.0.0.1:18380/resume
```

```text
event: done
data: {"type": "done"}
id: 4

```

和手写版本一致。那今天为什么还手写?因为你得知道字节是什么样的:有一天自带的版本行为和你预期不一致,你得有能力对着线上的字节判断,而不是只会调用。真写项目时我会用自带的,它把「空行」「注释心跳」「响应头」这三件最容易漏的事都做了。

## 第八步:为什么不用 WebSocket

最后回答标题里的问题。WebSocket 看起来更强:双向,低延迟,谁都能随时发。同一串假事件,换成 WebSocket 发一遍,并把握手响应和 SSE 的响应头对比一下:

```python
# agent-zero-lab/part07/ws_probe.py
"""Day 379:同一串假事件,用 WebSocket 收一遍,并和 SSE 对比握手响应头。先启动 sse_min。
用法: uv run python -m part07.ws_probe"""
from __future__ import annotations

import time

import httpx
from websockets.sync.client import connect

BASE = "127.0.0.1:18379"


def main() -> None:
    t0 = time.perf_counter()
    with connect(f"ws://{BASE}/ws") as ws:
        resp = ws.response
        assert resp is not None
        print(f"WebSocket 握手:{resp.status_code} {resp.reason_phrase}")
        for k in ("upgrade", "connection", "x-request-id"):
            print(f"  {k}: {resp.headers.get(k)}")
        for msg in ws:
            print(f"  {time.perf_counter() - t0:4.2f}s 收到 {msg}")
    r = httpx.get(f"http://{BASE}/ws")
    print("用普通 GET 去访问 /ws:", r.status_code, r.text[:60])
    with httpx.stream("GET", f"http://{BASE}/s1") as r2:
        print("SSE 响应:", r2.status_code, "x-request-id:", r2.headers.get("x-request-id"), "content-type:", r2.headers.get("content-type"))


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `with connect(` `websockets` 库的同步客户端。`connect` 建立连接并完成握手。
- `assert resp is not None` 握手的响应放在 `ws.response` 里,类型是「可能为空」,先断言一下,下面才能放心取属性。
- `for msg in ws:` 一直读,直到服务端关闭连接。每次拿到的是一条完整的消息,不是「一行」。
- `r = httpx.get(f"http://{BASE}/ws")` 用普通的 HTTP GET 去访问一个 WebSocket 路由,看看会发生什么。
- `with httpx.stream("GET"` 同时看一下 SSE 接口的响应头,和上面的握手响应并排。

</div>

```bash
uv run python -m part07.ws_probe
```

```text
WebSocket 握手:101 Switching Protocols
  upgrade: websocket
  connection: Upgrade
  x-request-id: None
  0.50s 收到 {"type":"token","text":"已"}
  1.01s 收到 {"type":"token","text":"核实"}
  1.51s 收到 {"type":"tool_call","name":"get_invoice"}
  2.01s 收到 {"type":"tool_result","name":"get_invoice","ok":true}
  2.51s 收到 {"type":"done"}
用普通 GET 去访问 /ws: 404 {"detail":"Not Found"}
SSE 响应: 200 x-request-id: 36b4e590 content-type: text/event-stream; charset=utf-8
```

三个发现。**一,WebSocket 握手不走 HTTP 中间件。** 服务文件里的 `X-Request-ID` 中间件给 SSE 响应盖上了编号 `36b4e590`,WebSocket 的握手响应里是 `None`。你在 [Day 81](/blog/agent-zero/day-081-fastapi-3/) 写的日志编号、后面几周要写的鉴权中间件、限流中间件,都是挂在 HTTP 请求上的,WebSocket 不经过它们,你得为它单独再写一遍。**二,WebSocket 是另一种协议。** 握手响应是 `101 Switching Protocols`,握手之后连接就不再是 HTTP 了;用普通 GET 访问同一个路径只会得到 404。现成的负载均衡、网关、日志、限流,凡是只认 HTTP 的东西,到了这里都得专门配置。SSE 从头到尾是一次普通的 HTTP 响应,所以什么都不用改。**三,事件收到的内容一样。** 五个事件、同样的间隔,SSE 能做到的,在「服务端往客户端推」这个方向上,WebSocket 没有多做一点什么。

再补三条从规范和文档里来的事实,没有单独实测:`EventSource` 内置自动重连和 `Last-Event-ID`,浏览器原生的 `WebSocket` 没有,断线要自己写重连、自己记收到哪了;`WebSocket` 构造函数只能带地址和子协议,不能设请求头,所以带 `Authorization` 头做鉴权这件事,SSE 加 `fetch` 反而比 WebSocket 容易;WebSocket 的优势是客户端也能高频地往上发。

结论放在一张表里:

| | SSE | WebSocket |
| --- | --- | --- |
| 方向 | 服务端到客户端 | 双向 |
| 协议 | 普通 HTTP 响应 | 握手后换成 WebSocket 协议 |
| 走 HTTP 中间件、网关、鉴权 | 直接能用 | 要单独处理(实测中间件不走) |
| 断线重连、断点续传 | `EventSource` 内置 | 自己写 |
| 能 POST、加请求头 | `fetch` 读流可以;`EventSource` 不行 | 握手阶段不能加头 |
| 适合 | 文字对话 Agent:用户发一次,服务端推很多 | 语音、协同编辑这类双向持续传数据 |

Agent 接口里,用户一句话、一次审批点击,都是「客户端发一次」,用一个普通的 POST 就够了;需要实时推的只有服务端到客户端这一个方向。这是 SSE 够用而且省心的原因。DeepSeek 的流式接口就是 SSE([Day 133](/blog/agent-zero/day-133-sse-principle/) 用 `curl -N` 看过)。如果你做的是语音对话,要一边传音频一边收音频,才轮到 WebSocket。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="SSE 和 WebSocket 的区别:SSE 是一次 HTTP 请求加一个不关的响应,走中间件和网关;WebSocket 握手 101 后换协议,双向,HTTP 中间件不再经过">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink)">SSE</text>
<rect x="60" y="38" width="90" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="105" y="60" fill="var(--ink)" text-anchor="middle">浏览器</text>
<rect x="230" y="38" width="150" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="305" y="60" fill="var(--ink)" text-anchor="middle">HTTP 中间件/网关</text>
<rect x="460" y="38" width="120" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="520" y="60" fill="var(--ink)" text-anchor="middle">Agent 服务</text>
<line x1="150" y1="50" x2="230" y2="50" stroke="var(--ink-soft)"/>
<text x="190" y="44" fill="var(--ink-soft)" text-anchor="middle" font-size="11">POST 一次</text>
<line x1="380" y1="50" x2="460" y2="50" stroke="var(--ink-soft)"/>
<line x1="460" y1="64" x2="150" y2="64" stroke="var(--mem)" stroke-dasharray="6 3" stroke-width="2"/>
<text x="330" y="88" fill="var(--mem)" text-anchor="middle" font-size="11">同一条响应里,事件一个接一个推回来(经过中间件)</text>
<text x="20" y="146" fill="var(--ink)">WebSocket</text>
<rect x="60" y="158" width="90" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="105" y="180" fill="var(--ink)" text-anchor="middle">浏览器</text>
<rect x="230" y="158" width="150" height="34" rx="4" fill="none" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
<text x="305" y="180" fill="var(--ink-faint)" text-anchor="middle">HTTP 中间件(不经过)</text>
<rect x="460" y="158" width="120" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="520" y="180" fill="var(--ink)" text-anchor="middle">Agent 服务</text>
<path d="M150 170 L230 170 M380 170 L460 170" stroke="var(--ink-soft)" fill="none"/>
<text x="305" y="214" fill="var(--ink-soft)" text-anchor="middle" font-size="11">握手 101 之后换协议,两个方向都能随时发</text>
<path d="M150 184 Q305 232 460 184" stroke="var(--compute)" fill="none" stroke-width="2"/>
</g>
</svg>
<figcaption>SSE 是一次普通的 HTTP 请求加一个不关的响应,所有只认 HTTP 的东西都能用;WebSocket 握手以后换了协议,中间件、鉴权、限流要单独再配一遍。实测依据是第八步里 `x-request-id` 的有和无。</figcaption>
</figure>

## 零件和结论

| 今天的零件 | 它解决什么 | 不写会怎样 |
| --- | --- | --- |
| `media_type="text/event-stream"` | 浏览器认它是事件流 | `EventSource` 立刻 `error`,`readyState=2` |
| 事件末尾的空行 | 事件在哪结束 | `open` 了但一个 `message` 都没有 |
| 明确的 `done` 事件 + 客户端 `close()` | 区分「做完了」和「断线」 | 服务端结束后浏览器每 3 秒重连,Agent 反复重跑 |
| `id` + `Last-Event-ID` | 重连后接着发 | 重连后从头再来 |
| `async` 生成器 | 客户端走了能及时清理 | 同步版 `finally` 不执行 |
| `: ping` 心跳 | 让网关别因为「没数据」掐连接 | 慢 Agent 被网关超时掐断 |
| `x-accel-buffering: no` | nginx 别缓冲响应 | 事件被攒着,用户看不到流式 |

## 动手练习

练习一:Agent 的核心是同步的生成器,每个事件要 3 秒。写一个 `async` 的包装,取事件的时候在线程里跑,等的时候每秒补一行心跳 `: ping`,客户端走了要能清理(`finally` 里写日志)。

<details><summary>参考答案</summary>

```python
```python
# agent-zero-lab/part07/ex379_heartbeat.py
"""练习 1:源头很慢(每个事件 3 秒)时,每秒补一行心跳注释。端口 18381,只监听本机。
启动: uv run uvicorn part07.ex379_heartbeat:app --host 127.0.0.1 --port 18381"""
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Iterator
from typing import Any

from fastapi import FastAPI
from fastapi.responses import StreamingResponse

from part07.sse_min import fake_agent, sse

app = FastAPI()
LOG: list[str] = []


async def with_heartbeat(source: Iterator[dict[str, Any]], every: float) -> AsyncIterator[str]:
    """从同步的 source 里取事件;等的时候每 every 秒产出一行 SSE 注释 ": ping"。"""
    sentinel: dict[str, Any] = {"end": True}
    task = asyncio.ensure_future(asyncio.to_thread(next, source, sentinel))
    try:
        while True:
            finished, _ = await asyncio.wait({task}, timeout=every)
            if not finished:
                yield ": ping\n\n"
                continue
            item = task.result()
            if item is sentinel:
                return
            yield sse(item)
            task = asyncio.ensure_future(asyncio.to_thread(next, source, sentinel))
    finally:
        LOG.append("with_heartbeat 结束")


@app.get("/slow")
async def slow() -> StreamingResponse:
    return StreamingResponse(with_heartbeat(fake_agent(delay=3.0), every=1.0), media_type="text/event-stream")


@app.get("/log")
def log() -> list[str]:
    return LOG
```
```

<div class="line-notes">

- `async def with_heartbeat(source` 输入是同步生成器,输出是 `async` 生成器,事件之间的空隙里插心跳。
- `task = asyncio.ensure_future(asyncio.to_thread(next, source, sentinel))` `asyncio.to_thread` 把「取下一个事件」这个会阻塞的调用丢进线程里,返回一个可等待的对象;`next(source, sentinel)` 的第二个参数是「取光了就返回这个」,不用 `try/except StopIteration`。
- `finished, _ = await asyncio.wait({task}, timeout=every)` 最多等 `every` 秒。`finished` 是已完成的任务集合,超时了就是空集合。用 `wait` 而不用 `wait_for`,因为 `wait_for` 超时会取消任务,而线程里的 `next` 取消不了,事件会丢。
- `yield ": ping\n\n"` 超时没有事件就发一行注释。以冒号开头,浏览器忽略。
- `if item is sentinel:` 用 `is` 比较身份:取光了的标记是同一个对象。
- `finally:` 无论是正常取光,还是客户端走了任务被取消,都会走到这里。
- `fake_agent(delay=3.0)` 把每个事件的间隔拉到 3 秒。

</div>

启动(端口 18381),连一次,等它发完:

```bash
uv run uvicorn part07.ex379_heartbeat:app --host 127.0.0.1 --port 18381
curl -sN http://127.0.0.1:18381/slow | python3 stamp.py | grep -v "''"
```

```text
 1.01s ': ping'
 2.01s ': ping'
 3.01s ': ping'
 3.01s 'data: {"type": "token", "text": "已"}'
 4.02s ': ping'
 5.02s ': ping'
 6.02s ': ping'
 6.02s 'data: {"type": "token", "text": "核实"}'
 ……
15.03s 'data: {"type": "done"}'
```

(`grep -v "''"` 去掉了空行,中间的重复部分我省略了。)每个事件前面有两行心跳,事件本身 3 秒一个。再测断开:连 4 秒就走,再等几秒看日志:

```bash
curl -sN -m 4 http://127.0.0.1:18381/slow > /dev/null; sleep 4; curl -s http://127.0.0.1:18381/log
```

```text
["with_heartbeat 结束","with_heartbeat 结束"]
```

两条日志,一条来自上面连满 15 秒的那次(正常结束),另一条来自连 4 秒就走的那次(被取消),`finally` 都执行了。对比第五步里的同步生成器,这就是包一层 `async` 的好处。要说清一个局限:线程里那一次 `next` 还在睡,它自己睡醒才结束,线程取消不了,所以这个办法保证的是「通知得到」,不是「立刻停掉里面的活」。真正要停掉 Agent,还要让 Agent 自己有「取消」的检查点,这是 Day 392 之后的内容。

</details>

练习二(观察):给 `/s1-retry` 发了一个 `retry: 1000`,用 `EventSource` 连一次,和第二步 `/s1` 的重连间隔(约 3 秒)对比。

<details><summary>参考答案</summary>

```bash
node --experimental-eventsource part07/web/es.mjs http://127.0.0.1:18379/s1-retry 5
```

```text
0.06s open
0.56s message {"type": "token", "text": "已"} lastEventId=""
1.06s message {"type": "token", "text": "核实"} lastEventId=""
1.56s message {"type": "tool_call", "name": "get_invoice"} lastEventId=""
2.07s message {"type": "tool_result", "name": "get_invoice", "ok": true} lastEventId=""
2.57s message {"type": "done"} lastEventId=""
2.57s error  readyState=0
3.58s open
4.08s message {"type": "token", "text": "已"} lastEventId=""
4.58s message {"type": "token", "text": "核实"} lastEventId=""
5.04s 手动 close
```

2.57 秒断,3.58 秒重连,间隔约 1 秒,不再是 `/s1` 里的 3 秒。服务端用 `retry:` 字段可以调节浏览器重连的节奏。线上典型的用法:服务端过载时发一个大的 `retry`(比如 30000)让客户端们晚点再来,别一起冲上来。

</details>

练习三:往 SSE 里直接放文本(不是 JSON),文本里有换行会怎样?写一个能正确处理换行的 `sse_text`,用 Day 133 的 `parse_sse` 做往返测试。

<details><summary>参考答案</summary>

```python
```python
# agent-zero-lab/part07/ex379_sse_text.py
"""练习 3:往 SSE 里直接放文本(不是 JSON)时,换行会把事件拆坏。"""
from __future__ import annotations


def sse_text_naive(text: str) -> str:
    return f"data: {text}\n\n"


def sse_text(text: str) -> str:
    """文本里每一个换行都要变成新的一行 data:,解析的一方会用换行再拼回来。"""
    return "".join(f"data: {line}\n" for line in text.split("\n")) + "\n"
```
```

<div class="line-notes">

- `def sse_text_naive(text: str) -> str:` 最直接的写法:整段文本放在一行 `data:` 后面。
- `return f"data: {text}\n\n"` 文本里如果有 `\n`,就把一个事件拆成了几行,而后面的行没有 `data:` 前缀。
- `def sse_text(text: str) -> str:` 正确写法。
- `return "".join(f"data: {line}\n" for line in text.split("\n")) + "\n"` 按换行拆成多行,每行都加 `data: `;最后单独补一个 `\n` 作为空行。解析的一方把多个 `data:` 行用换行再拼回去。代入 `"第一行\n第二行"`:`data: 第一行\ndata: 第二行\n\n`。

</div>

```python
```python
# agent-zero-lab/part07/test_ex379_sse_text.py
from __future__ import annotations

import pytest

from part02.sse_parse import parse_sse
from part07 import ex379_sse_text as m

TEXTS = ["一行", "第一行\n第二行", "末尾带换行\n", "\n开头是换行", "冒号:在里面", "  前面有空格"]


@pytest.mark.parametrize("text", TEXTS)
def test_roundtrip(text: str) -> None:
    wire = m.sse_text(text)
    events = list(parse_sse(wire.splitlines(keepends=True)))
    assert [e.data for e in events] == [text]


@pytest.mark.parametrize("text", TEXTS)
def test_naive_roundtrip(text: str) -> None:
    wire = m.sse_text_naive(text)
    events = list(parse_sse(wire.splitlines(keepends=True)))
    assert [e.data for e in events] == [text]
```
```

<div class="line-notes">

- `TEXTS = [` 六条文本:单行、中间有换行、末尾有换行、开头有换行、带冒号、开头有空格。后四条是边界。
- `@pytest.mark.parametrize("text", TEXTS)` 同一个测试函数对每条文本各跑一次。
- `events = list(parse_sse(` Day 133 的解析器,输入是一行一行带换行符的文本。`splitlines(keepends=True)` 保留换行符。
- `assert [e.data for e in events] == [text]` 往返以后应该只有一个事件,内容和原文一模一样。

</div>

```bash
uv run pytest part07/test_ex379_sse_text.py -q --tb=no
```

```text
.......FFF..                                                             [100%]
=========================== short test summary info ============================
FAILED part07/test_ex379_sse_text.py::test_naive_roundtrip[第一行\n第二行]
FAILED part07/test_ex379_sse_text.py::test_naive_roundtrip[末尾带换行\n]
FAILED part07/test_ex379_sse_text.py::test_naive_roundtrip[\n开头是换行]
3 failed, 9 passed in 0.03s
```

六条里,`sse_text` 全部通过(前面六个点),`sse_text_naive` 在三条含换行的文本上失败(三个 `F`),失败的原因我用 `--tb` 看了:`'第一行\n第二行'` 解析回来只剩 `'第一行'`,第二行因为没有冒号被当成「未知字段」丢掉了;`'末尾带换行\n'` 丢了末尾的换行;`'\n开头是换行'` 解析成了空字符串。数据没有报错,只是悄悄少了东西,和今天第三步少一个空行是同一类问题。如果你发的一直是 JSON(`json.dumps` 会把换行转成 `\n` 两个字符),不会遇到;发原始文本,尤其是模型输出的段落,就会遇到。

</details>

验收标准:不看文章,能写出 `sse()` 函数和一个 `StreamingResponse` 的 SSE 接口;能说出 `/s1-plain` 和 `/s1-noblank` 各自在 `EventSource` 里的现象;能解释为什么 `EventSource` 要收到 `done` 后自己 `close()`;能用 `async` 生成器写出「客户端走了能收到通知」的版本。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| `StreamingResponse` | Starlette/FastAPI 里「一边生成、一边发送」的响应类,参数是一个(异步)生成器 |
| `EventSource` | 浏览器里读 SSE 的内置接口,只能 GET,自动按事件格式解析,断线自动重连 |
| `media_type` | 响应的 `Content-Type`。SSE 必须是 `text/event-stream` |
| 分块传输(chunked) | 服务端不知道总长度时,一块一块送出去的 HTTP 方式,流式响应靠它 |
| `Last-Event-ID` | 浏览器重连时放进请求头的值,是它收到的最后一个事件的 `id`,服务端据此续传 |
| `retry` 字段 | 服务端告诉浏览器「断线后等多少毫秒再重连」 |
| 心跳 | 没有业务数据时定期发的占位内容(SSE 里是以冒号开头的注释行),让中间的网关知道连接还活着 |
| 缓冲(buffering) | 网关把响应攒着、攒够了再转发。对流式是坏事,`x-accel-buffering: no` 可以让 nginx 不缓冲 |
| WebSocket | 握手(`101 Switching Protocols`)后把 HTTP 连接换成另一种双向协议。只认 HTTP 的中间件和网关不再适用 |
| `ServerSentEvent` | FastAPI 自带的类,描述一个 SSE 事件,有 `data`、`raw_data`、`event`、`id`、`retry`、`comment` 几个字段 |
| `EventSourceResponse` | FastAPI 0.135 起自带的响应类,设成路由的 `response_class`,函数里直接 `yield` 即可 |

## 常见误区

**只用 curl 测 SSE。** `/s1-plain` 用 curl 看一切正常,用 `EventSource` 连直接失败。curl 不检查 `Content-Type`,浏览器检查。

**事件末尾少一个空行。** 实测 `open` 触发了,数据一行行进来,`onmessage` 一次都不响。排查的时候先看网络面板里原始字节,数一数有没有空行。

**服务端结束了响应,就以为流结束了。** `EventSource` 把任何关闭都当断线,3 秒后自动重连,整个 Agent 重新跑。协议里要自带一个 `done`,客户端收到就 `close()`。

**用同步生成器写 SSE,还在 `finally` 里做清理。** 实测客户端断开后,同步版的 `finally` 在 17 秒内没有执行,`async` 版立刻执行。清理逻辑要靠 `async` 生成器。

**以为线程池是无限的。** 实测 45 个同时连接的同步 SSE 里,有 5 个要排队。每个同步 SSE 连接占一个线程到结束。

**把 `EventSource` 当成万能的前端接口。** 它只能 GET,不能带请求体,不能加请求头。要 POST 一段问题、带令牌,实际要用 `fetch` 读流,重连和 `Last-Event-ID` 都要自己处理。

**以为 WebSocket 就是「更高级的 SSE」。** 它不走 HTTP 中间件(实测握手响应里没有 `X-Request-ID`),日志、鉴权、限流都要再写一遍;重连也要自己写。只有真的需要双向高频传输的场景才值得。

**往 SSE 里直接放带换行的文本。** `sse_text_naive` 解析回来悄悄少了内容,没有报错。每个换行都要变成新的一行 `data:`。

## 学习资料

### 文档与文章

- [MDN:使用服务器发送事件](https://developer.mozilla.org/zh-CN/docs/Web/API/Server-sent_events/Using_server-sent_events)。中文,讲 `EventSource` 的用法、事件格式、`retry` 和 `id`。今天第二到四步对着看一遍。
- [WHATWG 规范:Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html)。英文,规范原文,`Last-Event-ID`、重连、解析规则都是在这里定的,遇到争议以它为准。
- [FastAPI 官方文档:Server-Sent Events](https://fastapi.tiangolo.com/tutorial/server-sent-events/)。第七步的来源,有 `ServerSentEvent`、心跳和 `Last-Event-ID` 的写法。
- [Starlette 文档:StreamingResponse](https://starlette.dev/responses/#streamingresponse)。第一步用的那个类,短。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV14ae2z2EmV&autoplay=0&high_quality=1" title="服务器推送事件(Server-sent Events,SSE)" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>成富_Alex · 服务器推送事件(Server-sent Events,SSE) · 8 分半,按顺序看事件格式、`EventSource` 和重连,对应今天的第二到四步。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1xoTY6ZE1i&autoplay=0&high_quality=1" title="大模型流式输出前端怎么接?他答“EventSource” 我:断线了怎么办?输出一半呢?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>前端面试攻城狮 · 大模型流式输出前端怎么接?他答“EventSource” 我:断线了怎么办?输出一半呢? · 5 分钟,从前端面试官的角度讲为什么 `EventSource` 不够用,和今天第四步的结尾对得上。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/1BfCnjr_Vjg" title="WebSockets in 100 Seconds & Beyond with Socket.io" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Fireship · WebSockets in 100 Seconds &amp; Beyond with Socket.io · 英文,100 秒讲清 WebSocket 是什么,看完再回头看第八步。</figcaption>
</figure>

### 书籍

- Ilya Grigorik,《High Performance Browser Networking》(O'Reilly,2013)。网上有免费的完整版 [hpbn.co](https://hpbn.co/),里面有专门讲 SSE 和 WebSocket 的两章,都从「底下 TCP 和 HTTP 到底在做什么」讲起。书出版得早,浏览器的细节要以 MDN 为准。英文原版;我没有确认有无中译本。

### 开源项目与代码

- [fastapi/fastapi](https://github.com/fastapi/fastapi):`fastapi/sse.py` 就是第七步用的 `EventSourceResponse` 和 `ServerSentEvent`,几百行,能读懂。
- [sysid/sse-starlette](https://github.com/sysid/sse-starlette):FastAPI 自带 SSE 之前,大家都用这个库。读它的 `EventSourceResponse` 能看到心跳和断开检测怎么做。

## 自测

1. 一个 SSE 事件由什么结束?少了它,浏览器会怎样?

<details><summary>答案</summary>

由一个空行结束(一个事件的最后一个 `\n` 之后再来一个 `\n`)。少了它,浏览器一直在攒,不派发 `message`:实测 `open` 触发了,数据进来了,`onmessage` 一次都没有响。

</details>

2. 服务端把 Agent 的事件发完,正常结束了响应。为什么浏览器 3 秒后又发了一个请求?怎么避免?

<details><summary>答案</summary>

`EventSource` 把连接关闭当作断线,自动重连。避免的办法是流里带一个明确的结束事件(`done`),客户端收到就调用 `es.close()`。

</details>

3. 客户端断开后,同步生成器和 `async` 生成器里的 `finally` 分别会怎样?

<details><summary>答案</summary>

`async` 生成器的 `finally` 马上执行。同步生成器是放在线程池里被迭代的,断开后没有人去关它,实测 17 秒内 `finally` 没有执行。要在断开时做清理,用 `async` 生成器。

</details>

4. 同步的 SSE 接口,同时 45 个连接会发生什么?为什么?

<details><summary>答案</summary>

有 5 个连接要排队(首个事件晚到约半秒)。同步接口跑在线程池里,默认最多 40 个线程,每个连接占一个到结束,第 41 个起要等线程还回来。`async` 版本不占线程,100 个连接也不排队。

</details>

5. (面试题)你的 Agent 服务前面有 nginx,开发环境流式正常,上线后前端说「要等很久才一下子全出来」。你怀疑什么?

<details><summary>答案</summary>

nginx 的缓冲。`proxy_buffering` 默认是开的,nginx 把后端的响应攒着再转发,流式就退化成了「一次性出来」。解法是响应头加 `X-Accel-Buffering: no`(FastAPI 自带的 `EventSourceResponse` 会加,手写要自己加),或者在 nginx 配置里对这个路径关掉 `proxy_buffering`。验证:直接请求后端端口看是不是流式,再请求经过 nginx 的地址对比。

</details>

6. (面试题)为什么文字客服 Agent 一般选 SSE,不选 WebSocket?

<details><summary>答案</summary>

交互是「客户端发一次、服务端推很多」,只需要一个方向的实时推送。SSE 是普通 HTTP 响应,现有的中间件、网关、鉴权、日志、限流直接可用,`EventSource` 还内置重连和断点续传。WebSocket 要换协议,实测它不走 HTTP 中间件,这些都得重做一遍;它的优势(双向高频)在文字对话里用不上。语音这类双向持续传数据的场景才该选 WebSocket。

</details>

## 明天预告

[Day 380](/blog/agent-zero/day-380-event-protocol/) · 设计事件协议:前端到底需要知道什么。今天事件里放的是随手写的 `{"type": "token", "text": "已"}`。真要给前端用,事件有哪几种、字段叫什么、哪些要带编号、审批请求怎么表示、哪些内容不能推给浏览器,都得想清楚,因为协议一旦被前端用上就很难改。明天先把「事件协议」定下来,再往下搭服务骨架。
