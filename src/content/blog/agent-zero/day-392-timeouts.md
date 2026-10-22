---
title: 'Day 392 · 超时:每一层都要有,而且要比上一层短'
description: '模型请求、工具调用、一轮对话、一个队列任务,每层都要有超时,而且内层要比外层短。用 asyncio.timeout、httpx、openai SDK 和 arq 逐层实跑,再证明一件反直觉的事:超时只是你不等了,对方可能已经做完。'
pubDate: 2026-10-22
regime: none
tags: ['timeout', 'asyncio', 'arq', 'reliability', 'agent-zero']
series: 'agent-zero'
day: 392
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 391](/blog/agent-zero/day-391-week56-review/) 把上一周的东西拼成了一个退款 worker:job id 挡住 webhook 重发,`is_retryable` 决定要不要重试,幂等键保证重试时退款只建一条。那个 worker 里,通知客户那一步是「立刻失败」的,抛一个 `ConnectError` 就完事。现实里更常见、也更难缠的是「一直不回」:订单系统卡住了不报错,模型 API 半天吐不出一个字。重试和幂等都建立在「你已经知道它失败了」这个前提上,而让你知道它失败了的,就是超时。今天给每一层都装上超时,并且搞清楚为什么顺序必须是内短外长。

## 今天要解决的问题

今天结束时你应该能:

1. 用 `asyncio.timeout` 给任意一段异步代码设上限,并且知道它对同步阻塞代码无效。
2. 说清楚 httpx 的 `timeout=1.0` 管的是「每一次等待」而不是「整个请求」,openai SDK 的 `timeout` 和 `max_retries` 乘起来才是最坏耗时,arq 的 `job_timeout` 到了会直接判任务失败。
3. 用一个检查函数验证一组超时配置是不是「内层连同重试也比外层短」,并且让内层超时根据外层剩下的时间自动缩短。
4. 用实验说明「超时不等于没执行」,以及为什么超时和幂等要一起设计。

预计用时 2.5–3 小时。前置:[Day 65](/blog/agent-zero/day-065-httpx-2/) 的 httpx 超时、[Day 66](/blog/agent-zero/day-066-async-1/) 到 [Day 68](/blog/agent-zero/day-068-async-3/) 的 async、[Day 388](/blog/agent-zero/day-388-arq/) 的 arq、[Day 389](/blog/agent-zero/day-389-retry-errors/) 的重试、[Day 390](/blog/agent-zero/day-390-idempotency/) 的幂等键。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先从前端看:你其实早就踩过超时

在浏览器里 `fetch` 一个接口,默认是没有超时的。服务端不回,Network 面板里那一行就一直挂着 `(pending)`,页面上的 loading 转圈转到天荒地老。所以前端项目里经常能看到这种写法:

```js
// 前端里常见的写法,只是拿来对照,不用跑
const res = await fetch("/api/tickets", { signal: AbortSignal.timeout(5000) });
```

<div class="line-notes">

- `AbortSignal.timeout(5000)` 5 秒后这个 signal 自动触发 abort,`fetch` 抛出 `TimeoutError`。等不到就放弃,把控制权拿回来,至少能给用户显示一句「服务繁忙,请重试」。

</div>

服务端也是一样的道理,只不过层数多得多。一张工单在我们的系统里要穿过好几层:队列任务里跑一轮 Agent,一轮 Agent 里调几次模型、几次工具,每次模型调用底下是一个 HTTP 请求。每一层都可能卡住,每一层都需要自己的「等到什么时候为止」。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="超时分层示意图:最外层是队列任务 300 秒,里面是一轮对话 120 秒,再里面是模型请求 30 秒乘 3 次和工具调用 20 秒,每层都比外层短">
<rect x="20" y="20" width="600" height="260" rx="8" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="36" y="44" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">队列任务 · arq job_timeout = 300s</text>
<rect x="50" y="64" width="540" height="196" rx="6" fill="var(--paper-raised)" stroke="var(--ink-faint)"/>
<text x="66" y="88" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">一轮对话 · asyncio.timeout(120)</text>
<rect x="80" y="108" width="230" height="130" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="96" y="132" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">模型请求</text>
<text x="96" y="156" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">SDK timeout = 30s</text>
<text x="96" y="176" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">max_retries = 2</text>
<text x="96" y="200" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">最坏 30 x 3 = 90s</text>
<text x="96" y="222" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">超时 → SDK 自己重试</text>
<rect x="340" y="108" width="230" height="130" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="356" y="132" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">工具调用</text>
<text x="356" y="156" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">asyncio.timeout(20)</text>
<text x="356" y="176" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">不重试</text>
<text x="356" y="200" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">最坏 20s</text>
<text x="356" y="222" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">超时 → 告诉模型</text>
</svg>
<figcaption>今天的目标配置。每个方框都比包住它的那个短,而且要连同重试一起算:模型请求 30 秒、最多试 3 次,最坏 90 秒,仍然小于一轮的 120 秒。</figcaption>
</figure>

图里的数字先记个大概,后面每一层都会实跑一次。

## 第一步:asyncio.timeout,给一段代码设上限

Python 3.11 起,标准库有 `asyncio.timeout(秒数)`。它是一个异步上下文管理器(`async with`,[Day 67](/blog/agent-zero/day-067-async-2/) 用过),块里面的代码超过时限没跑完,就会被取消,块的出口抛 `TimeoutError`。你可以把它理解成 Python 版的 `AbortSignal.timeout`,只是不用把 signal 一层层往下传,块里任何一个 `await` 都会被它管到。

在 `agent-zero-lab` 目录下新建 `part07/timeout_basics.py`(`part07/` 是这一部分的目录,Day 391 已经建好,里面有 `__init__.py`):

```python
# agent-zero-lab/part07/timeout_basics.py
import asyncio
import time


async def slow_tool(seconds: float) -> str:
    await asyncio.sleep(seconds)
    return f"睡了 {seconds} 秒"


async def main():
    t0 = time.perf_counter()
    async with asyncio.timeout(1.0):
        print(await slow_tool(0.3))
    print(f"快的那次:{time.perf_counter() - t0:.2f}s")

    t0 = time.perf_counter()
    try:
        async with asyncio.timeout(1.0):
            print(await slow_tool(3))
    except TimeoutError as exc:
        print(f"慢的那次:{type(exc).__name__},等了 {time.perf_counter() - t0:.2f}s")


asyncio.run(main())
```

<div class="line-notes">

- `async def slow_tool(seconds: float) -> str:` 一个假装很慢的工具。真实场景里这是查订单系统、发邮件这类网络调用。
- `await asyncio.sleep(seconds)` 异步地睡,睡的时候事件循环可以去干别的,超时也能打断它。相当于 JS 里 `await new Promise(r => setTimeout(r, ms))`。
- `t0 = time.perf_counter()` 记下开始时间。`perf_counter` 是专门用来测耗时的高精度时钟,类似 JS 的 `performance.now()`,只是单位是秒。
- `async with asyncio.timeout(1.0):` 给块里的代码 1 秒。这次工具只睡 0.3 秒,不会超时。
- `print(await slow_tool(0.3))` 实测打印 `睡了 0.3 秒`。
- `print(f"快的那次:{time.perf_counter() - t0:.2f}s")` `:.2f` 保留两位小数。实测 `0.30s`。
- `async with asyncio.timeout(1.0):` 第二次还是 1 秒,但工具要睡 3 秒。
- `print(await slow_tool(3))` 这一行永远打印不出来:到 1 秒时 `asyncio.sleep` 被取消,`slow_tool` 后面的 `return` 不会执行。
- `except TimeoutError as exc:` 注意是内置的 `TimeoutError`,不用 import。Python 3.11 以后 `asyncio.TimeoutError` 就是它的别名。
- `print(f"慢的那次:{type(exc).__name__},等了 {time.perf_counter() - t0:.2f}s")` 实测 `TimeoutError,等了 1.00s`,一点没多等。

</div>

```bash
cd agent-zero-lab
uv run python -m part07.timeout_basics
```

实跑输出:

```text
睡了 0.3 秒
快的那次:0.30s
慢的那次:TimeoutError,等了 1.00s
```

这就是超时最基本的样子:等到点了,不管里面在干嘛,都给我停下。

### 先踩一个坑:同步阻塞的代码,超时管不了

`asyncio.timeout` 能打断的是 `await`。如果块里的代码根本不 `await`,而是用同步的方式卡住整个线程,它就无能为力。最常见的就是在 `async def` 里写了 `time.sleep`,或者用了 `requests` 这种同步 HTTP 库。故意写一次:

```python
# agent-zero-lab/part07/blocking_timeout.py
import asyncio
import time


async def bad_tool() -> str:
    time.sleep(3)  # 同步的 sleep:整个事件循环被卡住
    return "bad_tool 返回了"


async def main():
    t0 = time.perf_counter()
    try:
        async with asyncio.timeout(1.0):
            print(await bad_tool())
    except TimeoutError:
        print("TimeoutError")
    print(f"用时 {time.perf_counter() - t0:.2f}s")


asyncio.run(main())
```

<div class="line-notes">

- `time.sleep(3)  # 同步的 sleep:整个事件循环被卡住` 和上面唯一的区别:`asyncio.sleep` 换成了 `time.sleep`。这 3 秒里线程一直在这一行,事件循环没机会运行,1 秒时该触发的取消也就没人去执行。JS 里的类比是在 `async` 函数里写一个 `while (Date.now() < end) {}` 死循环,`setTimeout` 的回调同样排不上队。
- `async with asyncio.timeout(1.0):` 时限还是 1 秒。
- `print(await bad_tool())` 实测这一行照常打印了 `bad_tool 返回了`。
- `except TimeoutError:` 实测这个分支一次都没进。
- `print(f"用时 {time.perf_counter() - t0:.2f}s")` 实测 `3.00s`。

</div>

```bash
uv run python -m part07.blocking_timeout
```

```text
bad_tool 返回了
用时 3.00s
```

没有报错,也没有超时,就是安安静静地多等了 2 秒。这比报错更危险,因为你会以为超时设好了。所以 Agent 服务里的工具函数必须是真正的异步实现:HTTP 用 httpx 的 `AsyncClient`,数据库用 psycopg 的异步连接,实在只有同步库的,用 `await asyncio.to_thread(同步函数, 参数)` 把它丢到线程里跑,这样事件循环才不会被卡住。

## 第二步:内层要比外层短

现在有两层:一轮对话,里面调一次工具。两层各有一个超时,谁长谁短有讲究吗?做个对比。

```python
# agent-zero-lab/part07/timeout_order.py
import asyncio


async def get_invoice() -> dict:
    await asyncio.sleep(5)  # 订单系统卡住了
    return {"id": "INV-0123"}


async def call_tool(timeout_s: float) -> dict:
    try:
        async with asyncio.timeout(timeout_s):
            return await get_invoice()
    except TimeoutError:
        return {"ok": False, "error": f"get_invoice 在 {timeout_s:g} 秒内没有返回"}


async def run_turn(turn_s: float, tool_s: float) -> None:
    try:
        async with asyncio.timeout(turn_s):
            result = await call_tool(tool_s)
            print(f"一轮 {turn_s:g}s / 工具 {tool_s:g}s -> 工具结果: {result}")
    except TimeoutError:
        print(f"一轮 {turn_s:g}s / 工具 {tool_s:g}s -> 整轮 TimeoutError,不知道卡在哪")


async def main():
    await run_turn(turn_s=1, tool_s=3)    # 外层比内层短
    await run_turn(turn_s=3, tool_s=1)    # 内层比外层短


asyncio.run(main())
```

<div class="line-notes">

- `await asyncio.sleep(5)  # 订单系统卡住了` 查发票要 5 秒,比两种配置里的任何一个超时都长,所以一定会超时。问题只是「谁先超时」。
- `async def call_tool(timeout_s: float) -> dict:` 工具层的外壳。它自己有一个超时,超时以后不抛异常,而是返回一条模型能看懂的错误结果。
- `return {"ok": False, "error": f"get_invoice 在 {timeout_s:g} 秒内没有返回"}` `:g` 是「去掉多余的零」的数字格式,1.0 显示成 `1`。这条结果会作为工具消息交还给模型,模型可以决定换个方式、跟用户说明,或者转人工。
- `async def run_turn(turn_s: float, tool_s: float) -> None:` 一轮对话的外壳,也有一个超时。真实的一轮里会调好几次模型和工具,这里只放一次工具调用。
- `print(f"一轮 {turn_s:g}s / 工具 {tool_s:g}s -> 整轮 TimeoutError,不知道卡在哪")` 外层超时只知道「这一轮太久了」,不知道是哪一步慢。
- `await run_turn(turn_s=1, tool_s=3)    # 外层比内层短` 一轮 1 秒,工具 3 秒。1 秒时外层先到点,工具层自己那个 3 秒的超时根本没机会触发。
- `await run_turn(turn_s=3, tool_s=1)    # 内层比外层短` 反过来,工具 1 秒先到点,工具层把超时变成一条结果,外层的 3 秒还剩 2 秒,可以拿这条结果接着跑。

</div>

```bash
uv run python -m part07.timeout_order
```

```text
一轮 1s / 工具 3s -> 整轮 TimeoutError,不知道卡在哪
一轮 3s / 工具 1s -> 工具结果: {'ok': False, 'error': 'get_invoice 在 1 秒内没有返回'}
```

第一种配置下,用户只会看到一句「这轮超时了」,日志里也只有一个光秃秃的 `TimeoutError`,你得去猜是模型慢还是哪个工具慢。第二种配置下,工具超时被工具层接住,变成了一条有名字、有时长的错误,模型还有机会说一句「订单系统暂时查不到,我先帮你登记,稍后有人跟进」。

这就是标题那句话的意思:**内层比外层短,内层的超时才有机会被内层自己处理掉**。外层超时是最后的保险,它触发的时候,说明内层的超时没设对,或者内层太多了加起来超了。

## 第三步:httpx 的 timeout 管的是「每一次等待」

工具底下通常是一个 HTTP 请求。[Day 65](/blog/agent-zero/day-065-httpx-2/) 讲过 httpx 有超时,`httpx.AsyncClient(timeout=1.0)` 看上去像是「这个请求最多 1 秒」。其实不是。httpx 的超时分四种:连接(connect)、读(read)、写(write)、从连接池拿连接(pool),`timeout=1.0` 是把这四种都设成 1 秒。其中 read 的意思是「**两次收到数据之间**最多等多久」,不是整个响应最多等多久。

大模型的流式响应恰好就是「一小块一小块往外挤」的。只要每块之间不超过 1 秒,一个响应可以持续好几分钟,read 超时永远不会触发。

要看到这个现象,我们自己写一个「挤牙膏」的服务。它用标准库 `asyncio.start_server` 起一个最小的 HTTP 服务,每隔 0.5 秒吐一小块,一共 8 块:

```python
# agent-zero-lab/part07/drip_server.py
import asyncio
import sys

INTERVAL = float(sys.argv[1]) if len(sys.argv) > 1 else 0.5  # 每块之间隔几秒


async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    await reader.readuntil(b"\r\n\r\n")  # 读完请求头,内容不管
    writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\n\r\n")
    for i in range(8):  # 默认每 0.5 秒挤出一小块,一共 4 秒
        await asyncio.sleep(INTERVAL)
        data = f"token{i} ".encode()
        writer.write(f"{len(data):x}\r\n".encode() + data + b"\r\n")
        await writer.drain()
    writer.write(b"0\r\n\r\n")
    await writer.drain()
    writer.close()


async def main():
    server = await asyncio.start_server(handle, "127.0.0.1", 8765)
    print(f"drip server on 127.0.0.1:8765, interval={INTERVAL}s")
    async with server:
        await server.serve_forever()


asyncio.run(main())
```

<div class="line-notes">

- `INTERVAL = float(sys.argv[1]) if len(sys.argv) > 1 else 0.5  # 每块之间隔几秒` `sys.argv` 是命令行参数列表,相当于 Node 的 `process.argv`。不带参数就是 0.5 秒,练习 3 会传 1.5。
- `async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:` 每来一个连接,asyncio 就调一次这个函数。`reader` 读客户端发来的字节,`writer` 往回写。
- `await reader.readuntil(b"\r\n\r\n")  # 读完请求头,内容不管` HTTP 请求头以一个空行结束,也就是连续两个 `\r\n`。读到这里就够了,我们不关心请求的路径。
- `writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\n\r\n")` 手写响应头。`Transfer-Encoding: chunked` 表示响应体分块发,事先不告诉总长度,流式响应就是这么传的。DevTools 里看一个 SSE 请求,响应头里通常也能看到它。
- `for i in range(8):  # 默认每 0.5 秒挤出一小块,一共 4 秒` 8 块,每块之间 0.5 秒,一共 4 秒。
- `writer.write(f"{len(data):x}\r\n".encode() + data + b"\r\n")` chunked 格式:先写这块的字节数(十六进制,`:x` 就是转十六进制),换行,再写内容,再换行。`token0 ` 是 7 个字节,所以写的是 `7`。
- `await writer.drain()` 等数据真的发出去,相当于把缓冲区冲掉。
- `writer.write(b"0\r\n\r\n")` 长度为 0 的块表示响应结束。
- `server = await asyncio.start_server(handle, "127.0.0.1", 8765)` 在本机 8765 端口监听。
- `await server.serve_forever()` 一直跑,直到你按 Ctrl+C。

</div>

开一个终端,在 `agent-zero-lab` 目录下起服务:

```bash
uv run python -m part07.drip_server
```

```text
drip server on 127.0.0.1:8765, interval=0.5s
```

再开一个终端,用 curl 看看它长什么样(`-N` 让 curl 收到一块就显示一块,不攒):

```bash
curl -N http://127.0.0.1:8765/
```

```text
token0 token1 token2 token3 token4 token5 token6 token7 
```

你会看到这 8 个词一个一个冒出来,4 秒左右出完。现在用 httpx 去读它,一次只设 `timeout=1.0`,一次在外面再套一个 2 秒的总时长:

```python
# agent-zero-lab/part07/read_timeout.py
import asyncio
import time

import httpx


async def fetch(total_s: float | None) -> None:
    t0 = time.perf_counter()
    chunks = 0
    try:
        async with httpx.AsyncClient(timeout=1.0) as client:
            if total_s is None:
                async with client.stream("GET", "http://127.0.0.1:8765/") as resp:
                    async for _ in resp.aiter_bytes():
                        chunks += 1
            else:
                async with asyncio.timeout(total_s):
                    async with client.stream("GET", "http://127.0.0.1:8765/") as resp:
                        async for _ in resp.aiter_bytes():
                            chunks += 1
        print(f"total={total_s}: 正常读完 {chunks} 块,用时 {time.perf_counter() - t0:.2f}s")
    except TimeoutError:
        print(f"total={total_s}: 总时长超时,读到 {chunks} 块,用时 {time.perf_counter() - t0:.2f}s")


async def main():
    await fetch(total_s=None)  # 只有 httpx 的 timeout=1.0
    await fetch(total_s=2.0)   # 外面再套一个总时长


asyncio.run(main())
```

<div class="line-notes">

- `async def fetch(total_s: float | None) -> None:` `float | None` 表示「数字或者 None」,相当于 TS 的 `number | null`。传 None 表示不加总时长。
- `async with httpx.AsyncClient(timeout=1.0) as client:` connect、read、write、pool 四种超时都是 1 秒。
- `async with client.stream("GET", "http://127.0.0.1:8765/") as resp:` 用流式的方式发请求,不等整个响应收完就开始读,和 JS 里读 `res.body.getReader()` 是一回事。
- `async for _ in resp.aiter_bytes():` 每收到一块就循环一次。`_` 表示我们不关心内容,只数块数。
- `async with asyncio.timeout(total_s):` 第二次在外面再套一层总时长 2 秒,它管的是从发请求到读完的整段时间。
- `print(f"total={total_s}: 正常读完 {chunks} 块,用时 {time.perf_counter() - t0:.2f}s")` 实测第一次走到这里:`正常读完 8 块,用时 4.18s`。timeout 写的是 1 秒,实际等了 4 秒多。
- `except TimeoutError:` 总时长超时抛的是内置 `TimeoutError`。注意 httpx 自己的超时抛的是 `httpx.ReadTimeout` 这类异常,它们不是 `TimeoutError` 的子类,这里接不住,练习 3 会看到。
- `print(f"total={total_s}: 总时长超时,读到 {chunks} 块,用时 {time.perf_counter() - t0:.2f}s")` 实测第二次:`读到 3 块,用时 2.04s`。

</div>

```bash
uv run python -m part07.read_timeout
```

```text
total=None: 正常读完 8 块,用时 4.18s
total=2.0: 总时长超时,读到 3 块,用时 2.04s
```

第一行就是今天最容易被忽视的事:**你写了 `timeout=1.0`,请求却跑了 4 秒**,而且一点错都没有。换成一个每 0.9 秒吐一个 token、吐上 10 分钟的上游,它就能把你的 worker 占 10 分钟。httpx 的超时是用来发现「连不上」「突然没动静了」的;「整件事最多多久」要靠外面那层 `asyncio.timeout`。

做完把第一个终端的服务 Ctrl+C 停掉。

## 第四步:openai SDK 的 timeout 和 max_retries

调模型用的是 openai SDK(走 OpenAI 兼容协议连 DeepSeek)。它也有两个参数:`timeout` 是单次 HTTP 请求的超时,`max_retries` 是失败后 SDK 自己再试几次。我在本机装的 openai 3.36.1 里查了默认值:

```bash
uv run python -c "import openai._constants as c; print(c.DEFAULT_TIMEOUT, c.DEFAULT_MAX_RETRIES)"
```

```text
Timeout(connect=5.0, read=600, write=600, pool=600) 2
```

read 默认 600 秒,也就是 10 分钟;默认重试 2 次。不改的话,一次调用最坏能卡半个小时。这显然不是我们要的。

下面这个脚本用三个配置各调一次模型,同时数一数 SDK 实际发了几次 HTTP 请求。前两次故意把超时设成 0.05 秒,一定超时;第三次用正常值。`.env` 是 Day 391 那份(`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`,外加一个关闭思考模式的 `LLM_EXTRA_BODY={"thinking": {"type": "disabled"}}`),还要装 `python-dotenv`:

```bash
uv add python-dotenv
```

```python
# agent-zero-lab/part07/sdk_timeout.py
import asyncio
import json
import os
import time

import httpx2
import openai
from dotenv import load_dotenv

load_dotenv()
attempts = 0


async def count_request(request: httpx2.Request) -> None:
    global attempts
    attempts += 1


def make_client(timeout: float, max_retries: int) -> openai.AsyncOpenAI:
    return openai.AsyncOpenAI(
        base_url=os.environ["LLM_BASE_URL"],
        api_key=os.environ["LLM_API_KEY"],
        timeout=timeout,
        max_retries=max_retries,
        http_client=openai.DefaultAsyncHttpxClient(event_hooks={"request": [count_request]}),
    )


async def ask(client: openai.AsyncOpenAI) -> None:
    global attempts
    attempts, t0 = 0, time.perf_counter()
    try:
        resp = await client.chat.completions.create(
            model=os.environ["LLM_MODEL"],
            messages=[{"role": "user", "content": "用一句话说说什么是超时"}],
            max_tokens=40,
            extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY", "{}")),
        )
        u = resp.usage
        print(f"成功:{resp.choices[0].message.content!r} 输入 {u and u.prompt_tokens} 输出 {u and u.completion_tokens}")
    except openai.APITimeoutError as exc:
        print(f"{type(exc).__name__}: {exc}")
    print(f"  timeout={client.timeout} max_retries={client.max_retries} 发了 {attempts} 次请求,用时 {time.perf_counter() - t0:.2f}s")


async def main():
    await ask(make_client(timeout=0.05, max_retries=0))
    await ask(make_client(timeout=0.05, max_retries=2))
    await ask(make_client(timeout=30, max_retries=2))


asyncio.run(main())
```

<div class="line-notes">

- `import httpx2` Day 391 说过,openai 3.36.1 底层用的是 httpx2,事件钩子收到的是 `httpx2.Request`,类型标注要写它。
- `load_dotenv()` 把 `.env` 里的变量读进 `os.environ`,相当于 Node 里的 `dotenv.config()`。
- `attempts = 0` 一个模块级的计数器,记录实际发出了几次 HTTP 请求。
- `async def count_request(request: httpx2.Request) -> None:` 请求钩子:每发一次请求(包括 SDK 自动重试的那几次)调用一次。
- `global attempts` 函数里要给模块级变量重新赋值,得先声明 `global`,不然 Python 会把它当成局部变量。JS 里没有这个限制。
- `def make_client(timeout: float, max_retries: int) -> openai.AsyncOpenAI:` 按给定的超时和重试次数造一个客户端。
- `timeout=timeout,` 传一个数字,就是 connect/read/write/pool 都用这个值。
- `max_retries=max_retries,` SDK 遇到超时、连接错误、429、5xx 会自动重试,这里控制次数。
- `http_client=openai.DefaultAsyncHttpxClient(event_hooks={"request": [count_request]}),` 换一个带钩子的底层 HTTP 客户端,用 SDK 提供的 `DefaultAsyncHttpxClient` 可以保留 SDK 的默认设置。
- `attempts, t0 = 0, time.perf_counter()` 每次调用前清零计数、记下时间。
- `max_tokens=40,` 只要一句话,限制输出长度省钱。
- `extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY", "{}")),` 把 `.env` 里那段 JSON 原样塞进请求体,关掉 DeepSeek 的思考模式,回答更快更便宜。
- `print(f"成功:{resp.choices[0].message.content!r} 输入 {u and u.prompt_tokens} 输出 {u and u.completion_tokens}")` `!r` 是用 `repr` 打印,字符串会带引号。实测第三次:输入 10 个 token、输出 30 个。
- `except openai.APITimeoutError as exc:` SDK 把底层的超时包成了 `APITimeoutError`,Day 389 的 `is_retryable` 把它判成可重试。
- `print(f"  timeout={client.timeout} max_retries={client.max_retries} 发了 {attempts} 次请求,用时 {time.perf_counter() - t0:.2f}s")` 实测三次分别是 1 次、3 次、1 次请求。
- `await ask(make_client(timeout=0.05, max_retries=0))` 0.05 秒连 TLS 握手都做不完,必然超时;不重试。
- `await ask(make_client(timeout=0.05, max_retries=2))` 同样必然超时,但 SDK 会再试 2 次。

</div>

```bash
uv run python -m part07.sdk_timeout
```

实跑输出:

```text
APITimeoutError: Request timed out.
  timeout=0.05 max_retries=0 发了 1 次请求,用时 0.75s
APITimeoutError: Request timed out.
  timeout=0.05 max_retries=2 发了 3 次请求,用时 1.65s
成功:'超时是指规定的时间已过而事情仍未完成，系统或规则随即采取相应措施（如中止、失效或判定失败）的状态。' 输入 10 输出 30
  timeout=30 max_retries=2 发了 1 次请求,用时 1.16s
```

对比前两行:同样的 0.05 秒超时,`max_retries=2` 时请求发了 3 次,用时多了将近 1 秒,多出来的是 3 次尝试本身加上两次重试之间的等待(这个版本 SDK 的 `INITIAL_RETRY_DELAY` 是 0.5 秒,之后翻倍,封顶 8 秒,我在 `openai/_constants.py` 里查到的)。所以算一层的最坏耗时,要用 `timeout × (max_retries + 1)` 再加上退避等待。第一行设的是 0.05 秒却用了 0.75 秒,我没有逐项拆这 0.7 秒花在哪,大概率是第一次建连接前的准备工作(比如 DNS 解析),这部分不完全受这个超时管。这也提醒你别把超时设得太接近正常耗时。

第三次正常成功,用了 1.16 秒。真实配置建议给模型请求 30 秒左右:非流式、几百个 token 的回复,正常几秒就回来了,30 秒没回基本就是出问题了。如果你的场景要生成很长的内容,改用流式,或者按需要调大。

花费:第三次输入 10、输出 30 个 token。2026 年 10 月在 [DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) 查到 `deepseek-flash` 高峰时段缓存未命中输入 2 元/百万 token、输出 8 元/百万 token,10 × 2/1e6 + 30 × 8/1e6 ≈ 0.00026 元。超时的那几次有没有被计费我没法确认(请求有可能已经到了服务端),就算按同样的量算也不到 0.002 元。

### 只给某一次调用换个超时

同一个客户端,不同的调用可能要不同的超时。工单分类只回一个词,应该很快,宁可超时走默认分类也不想让用户等;起草回复要长一些。SDK 提供 `with_options`,复制出一个只改了几个参数的新客户端,原来的不受影响:

```python
# agent-zero-lab/part07/per_request_timeout.py
import asyncio
import json
import os
import time

import openai
from dotenv import load_dotenv

load_dotenv()
client = openai.AsyncOpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"], timeout=30, max_retries=2)


async def classify(text: str) -> str:
    fast = client.with_options(timeout=0.05, max_retries=0)  # 分类要快,宁可失败走默认分类
    try:
        resp = await fast.chat.completions.create(
            model=os.environ["LLM_MODEL"],
            messages=[{"role": "user", "content": f"只回 billing/tech/other 之一:{text}"}],
            max_tokens=5,
            extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY", "{}")),
        )
        return resp.choices[0].message.content or "other"
    except openai.APITimeoutError:
        return "other(超时兜底)"


async def main():
    t0 = time.perf_counter()
    print(await classify("我被扣了两次款"), f"{time.perf_counter() - t0:.2f}s")
    print("原 client 没被改:", client.timeout, client.max_retries)


asyncio.run(main())
```

<div class="line-notes">

- `client = openai.AsyncOpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"], timeout=30, max_retries=2)` 全局客户端用今天推荐的配置:30 秒、重试 2 次。
- `fast = client.with_options(timeout=0.05, max_retries=0)  # 分类要快,宁可失败走默认分类` 复制一份只改超时和重试的客户端。0.05 秒是为了演示一定超时,真实值可以给 3 到 5 秒。
- `return resp.choices[0].message.content or "other"` `or` 在左边是空字符串或 None 时取右边,相当于 JS 的 `||`。
- `except openai.APITimeoutError:` 分类超时不算大事,给一个默认分类,后面的流程照走。
- `return "other(超时兜底)"` 实测走的就是这条。
- `print("原 client 没被改:", client.timeout, client.max_retries)` 实测打印 `30 2`,说明 `with_options` 没有改动原客户端。

</div>

```bash
uv run python -m part07.per_request_timeout
```

```text
other(超时兜底) 0.30s
原 client 没被改: 30 2
```

## 第五步:队列任务的 job_timeout

最外层是 arq 的任务。[Day 388](/blog/agent-zero/day-388-arq/) 起 worker 时没设过超时,用的是默认值。我查了本机 arq 0.28.0 的 `Worker` 默认参数:`job_timeout=300`(秒),`max_tries=5`。一个任务跑过 300 秒,arq 会把它取消,并把这次执行判为失败。

改小一点看效果:

```python
# agent-zero-lab/part07/job_timeout.py
import asyncio
import sys

from arq import create_pool
from arq.connections import RedisSettings
from arq.jobs import Job


async def draft_reply(ctx, ticket_id: str, seconds: float) -> str:
    print(f"[{ticket_id}] try {ctx['job_try']} 开始,要跑 {seconds}s", flush=True)
    await asyncio.sleep(seconds)
    return f"{ticket_id} 草稿好了"


class WorkerSettings:
    functions = [draft_reply]
    redis_settings = RedisSettings()
    job_timeout = 2      # 单个任务最多 2 秒
    max_tries = 3


async def main(run: str):
    redis = await create_pool(RedisSettings())
    if sys.argv[2] == "enqueue":
        await redis.enqueue_job("draft_reply", "T1041", 0.5, _job_id=f"{run}-fast")
        await redis.enqueue_job("draft_reply", "T1042", 5, _job_id=f"{run}-slow")
    else:
        for jid in (f"{run}-fast", f"{run}-slow"):
            info = await Job(jid, redis).result_info()
            if info:
                print(jid, "success" if info.success else "failed", f"job_try={info.job_try}", repr(info.result))
    await redis.aclose()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
```

<div class="line-notes">

- `async def draft_reply(ctx, ticket_id: str, seconds: float) -> str:` 假装起草回复,要跑多久由参数决定。
- `await asyncio.sleep(seconds)` 慢的那个要睡 5 秒,超过下面的 `job_timeout`。
- `job_timeout = 2      # 单个任务最多 2 秒` 真实系统用默认的 300 秒或者按任务调,这里为了快。
- `max_tries = 3` 最多执行 3 次。下面会看到,超时并不会用掉这个次数去重试。
- `if sys.argv[2] == "enqueue":` 同一个脚本两种用法:第二个参数是 `enqueue` 就入队,否则就查结果。
- `await redis.enqueue_job("draft_reply", "T1042", 5, _job_id=f"{run}-slow")` 一个 0.5 秒的快任务,一个 5 秒的慢任务。
- `info = await Job(jid, redis).result_info()` Day 391 练习 2 用过:按 job id 查结果详情。
- `print(jid, "success" if info.success else "failed", f"job_try={info.job_try}", repr(info.result))` 实测慢任务是 `failed job_try=1 TimeoutError()`。

</div>

确认 Redis 在跑(`redis-cli ping` 回 `PONG`),然后:

```bash
uv run python -m part07.job_timeout jt2 enqueue
uv run arq --burst part07.job_timeout.WorkerSettings
uv run python -m part07.job_timeout jt2 show
```

worker 的输出(traceback 中间删掉了一段文件路径,只留关键行):

```text
12:49:44: Starting worker for 1 functions: draft_reply
12:49:44: redis_version=7.4.6 mem_usage=1.65M clients_connected=1 db_keys=29
12:49:44:   0.74s → jt2-fast:draft_reply('T1041', 0.5)
[T1041] try 1 开始,要跑 0.5s
12:49:44:   0.73s → jt2-slow:draft_reply('T1042', 5)
[T1042] try 1 开始,要跑 5s
12:49:45:   0.50s ← jt2-fast:draft_reply ● 'T1041 草稿好了'
12:49:46:   2.00s ! jt2-slow:draft_reply failed, TimeoutError: 
Traceback (most recent call last):
  ...
asyncio.exceptions.CancelledError

The above exception was the direct cause of the following exception:

Traceback (most recent call last):
  File ".../arq/worker.py", line 599, in run_job
    result = await asyncio.wait_for(task, timeout_s)
  ...
TimeoutError
```

查结果:

```text
jt2-fast success job_try=1 'T1041 草稿好了'
jt2-slow failed job_try=1 TimeoutError()
```

两件事值得记住。第一,arq 的任务超时底下也是 asyncio 的取消机制(traceback 里能看到 `asyncio.wait_for` 和 `CancelledError`),所以上面那个「同步阻塞代码超时管不了」的坑,在这一层一样存在。第二,`job_try=1` 就结束了,`max_tries = 3` 没起作用。arq 只在你抛 `Retry` 的时候安排重试(Day 388、389),任务超时属于普通异常,直接判失败。

这个行为其实挺合理:最外层超时说明这个任务整体就太慢了,盲目重来很可能再卡 300 秒。如果你确实希望「卡住了就过一会儿重来」,应该在任务里面用一个比 `job_timeout` 短的 `asyncio.timeout` 自己接住,再抛 `Retry`,这是练习 2。

## 第六步:超时不等于没执行

到这里每一层都有了超时。还剩一个反直觉的问题,我觉得是今天最重要的一点:**超时只说明你不等了,不说明对方没做**。

你调支付网关建退款,等了 1 秒没回,放弃了。可请求早就发出去了,网关那边可能在第 1.5 秒把退款建好了。你这边记的是「失败」,准备重试;对方那边已经「成功」了。这时候重试,如果没有幂等键,就是第二笔退款。

用一个假的网关把它演出来:

```python
# agent-zero-lab/part07/timeout_not_cancel.py
import asyncio

orders: dict[str, str] = {}  # 假装这是支付网关那边的数据库


async def gateway_refund(key: str, amount: int) -> str:
    """支付网关:收到请求后要 1.5 秒才处理完,不管调用方还在不在等。"""
    await asyncio.sleep(1.5)
    if key in orders:
        return orders[key]
    orders[key] = f"P-{len(orders) + 1:03d}"
    print(f"  [网关] 建了退款 {orders[key]},金额 {amount}")
    return orders[key]


async def call_gateway(key: str, amount: int, timeout_s: float) -> str | None:
    task = asyncio.create_task(gateway_refund(key, amount))  # 请求已经发出去了
    try:
        async with asyncio.timeout(timeout_s):
            return await asyncio.shield(task)  # 我们放弃等,不代表对方停手
    except TimeoutError:
        print(f"  [调用方] {timeout_s}s 没等到,放弃")
        return None


async def main():
    print("第 1 次,key=K1")
    print("  结果:", await call_gateway("K1", 2392, timeout_s=1.0))
    await asyncio.sleep(1)  # 网关在这 1 秒里把活干完了
    print("第 2 次重试,同一个 key=K1")
    print("  结果:", await call_gateway("K1", 2392, timeout_s=3.0))
    print("第 3 次重试,换了个随机 key=K2")
    print("  结果:", await call_gateway("K2", 2392, timeout_s=3.0))
    print("网关里一共:", orders)


asyncio.run(main())
```

<div class="line-notes">

- `orders: dict[str, str] = {}  # 假装这是支付网关那边的数据库` 键是幂等键,值是网关的退款单号。
- `async def gateway_refund(key: str, amount: int) -> str:` 网关的处理逻辑:先花 1.5 秒,再按幂等键查重,没有就新建。
- `if key in orders:` 网关认幂等键:同一个 key 第二次来,直接返回已有单号。这就是 Day 391 学习资料里 Stripe 那篇文档讲的做法。
- `orders[key] = f"P-{len(orders) + 1:03d}"` `:03d` 是补零到 3 位,第一单是 `P-001`。
- `task = asyncio.create_task(gateway_refund(key, amount))  # 请求已经发出去了` 把网关的处理放进一个独立的任务里跑。它模拟的是「请求已经到了对方服务器」,对方在自己的进程里干活,不受我们控制。
- `return await asyncio.shield(task)  # 我们放弃等,不代表对方停手` `shield` 的意思是:外面的超时取消的是「我们的等待」,不会取消 `task` 本身。真实的网络请求就是这样,你这边断开了,对方服务器上的处理不会跟着回滚。
- `print(f"  [调用方] {timeout_s}s 没等到,放弃")` 实测第 1 次打印 `1.0s 没等到,放弃`。
- `await asyncio.sleep(1)  # 网关在这 1 秒里把活干完了` 调用方准备重试前隔了一会儿,这期间网关那边把 K1 的退款建好了。
- `print("  结果:", await call_gateway("K1", 2392, timeout_s=3.0))` 用同一个 key 重试,网关查到已有记录,返回 `P-001`,没有新建。
- `print("  结果:", await call_gateway("K2", 2392, timeout_s=3.0))` 如果重试时换了一个新 key(比如每次都 `uuid4()`),网关就会当成一笔新退款。
- `print("网关里一共:", orders)` 实测最后有两笔,`P-002` 就是那笔多退的钱。

</div>

```bash
uv run python -m part07.timeout_not_cancel
```

```text
第 1 次,key=K1
  [调用方] 1.0s 没等到,放弃
  结果: None
  [网关] 建了退款 P-001,金额 2392
第 2 次重试,同一个 key=K1
  结果: P-001
第 3 次重试,换了个随机 key=K2
  [网关] 建了退款 P-002,金额 2392
  结果: P-002
网关里一共: {'K1': 'P-001', 'K2': 'P-002'}
```

看第 3、4 行的顺序:调用方先宣布放弃,网关随后才打出「建了退款 P-001」。对调用方来说这笔请求「超时失败」,对网关来说它「成功」了。第 2 次用同一个 key 重试,拿回 `P-001`,一切正常。第 3 次换了 key,网关多建了一笔 `P-002`。

所以 Day 390 的幂等键有两个用处:防队列重复投递,也防超时之后的重试。只要一个写操作有可能超时,它就必须带幂等键,而且重试时要用同一个键。工具层可以把「超时」翻译成一句给模型看的「订单系统暂时没回应,不确定是否已提交」,不要说成「提交失败」,否则模型可能会主动再提交一次。

模型调用也是一样:客户端超时放弃了,服务端可能照样把这次生成跑完并计费。这件事我没法从客户端验证,但设计时要按「可能已经计费」来估成本。

## 第七步:把整条链检查一遍,让内层看着外层的剩余时间

最后两件事:一是写个小函数,自动检查一组配置是不是满足「内层连同重试也比外层短」;二是解决一个配置检查查不出来的问题。

```python
# agent-zero-lab/part07/timeout_chain.py
import asyncio
import time

# 每一层:(超时秒数, 失败后最多再试几次, 外面包着它的是哪一层)
Layer = tuple[float, int, str | None]
GOOD: dict[str, Layer] = {
    "model_request": (30, 2, "turn"),   # SDK:timeout=30, max_retries=2
    "tool_call": (20, 0, "turn"),
    "turn": (120, 0, "job"),
    "job": (300, 2, None),              # arq:job_timeout=300, max_tries=3
}
BAD: dict[str, Layer] = {**GOOD, "model_request": (60, 2, "turn")}


def check_chain(layers: dict[str, Layer]) -> list[str]:
    problems = []
    for name, (timeout_s, retries, parent) in layers.items():
        if parent is None:
            continue
        worst = timeout_s * (retries + 1)  # 连同重试,最坏要等多久
        if worst >= layers[parent][0]:
            problems.append(f"{name} 最坏 {timeout_s:g}s x {retries + 1} 次 = {worst:g}s,不比 {parent}={layers[parent][0]:g}s 短")
    return problems


async def slow_tool(i: int) -> str:
    await asyncio.sleep(0.8)
    return f"tool{i} ok"


async def run_turn(turn_s: float, tool_s: float, deadline_aware: bool) -> None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + turn_s
    t0 = time.perf_counter()
    results = []
    try:
        async with asyncio.timeout_at(deadline):
            for i in range(3):
                budget = tool_s
                if deadline_aware:
                    budget = min(tool_s, deadline - loop.time() - 0.1)  # 给外层留 0.1s 收尾
                try:
                    async with asyncio.timeout(budget):
                        results.append(await slow_tool(i))
                except TimeoutError:
                    results.append(f"tool{i} 超时(只给了 {budget:.2f}s)")
                    break
        print(f"deadline_aware={deadline_aware}: {results},{time.perf_counter() - t0:.2f}s")
    except TimeoutError:
        print(f"deadline_aware={deadline_aware}: 整轮超时,已有结果 {results},{time.perf_counter() - t0:.2f}s")


async def main():
    print("GOOD:", check_chain(GOOD) or "OK")
    print("BAD:", check_chain(BAD) or "OK")
    await run_turn(turn_s=2.0, tool_s=1.0, deadline_aware=False)
    await run_turn(turn_s=2.0, tool_s=1.0, deadline_aware=True)


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `Layer = tuple[float, int, str | None]` 类型别名,相当于 TS 的 `type Layer = [number, number, string | null]`。三个位置分别是超时、重试次数、父层名字。
- `"model_request": (30, 2, "turn"),   # SDK:timeout=30, max_retries=2` 模型请求 30 秒,再试 2 次,包在一轮对话里。
- `"job": (300, 2, None),              # arq:job_timeout=300, max_tries=3` 最外层没有父层,写 None。
- `BAD: dict[str, Layer] = {**GOOD, "model_request": (60, 2, "turn")}` `**GOOD` 把字典展开,相当于 JS 的 `{...GOOD, model_request: [...]}`,只改模型请求那一项。
- `for name, (timeout_s, retries, parent) in layers.items():` `.items()` 同时拿到键和值,值是元组,直接在循环里拆开,类似 JS 的 `for (const [name, [t, r, p]] of Object.entries(layers))`。
- `worst = timeout_s * (retries + 1)  # 连同重试,最坏要等多久` 这里没算退避等待,算的是下限,真实最坏只会更长。
- `if worst >= layers[parent][0]:` 最坏耗时大于等于父层超时,就有可能被父层抢先打断。
- `deadline = loop.time() + turn_s` 截止时刻。`loop.time()` 是事件循环自己的单调时钟,`asyncio.timeout_at` 要的就是这个时钟上的一个时刻。
- `async with asyncio.timeout_at(deadline):` 和 `asyncio.timeout` 一样,只是参数是「到哪个时刻为止」而不是「再等几秒」。
- `for i in range(3):` 一轮里连调 3 次工具,每次 0.8 秒,总共 2.4 秒,超过一轮的 2 秒。
- `budget = min(tool_s, deadline - loop.time() - 0.1)  # 给外层留 0.1s 收尾` 关键一行:工具的超时取「自己的配置」和「外层剩下的时间减 0.1 秒」里小的那个。实测第 3 次工具开始时外层只剩 0.4 秒,`budget` 被压到 0.30 秒。
- `results.append(f"tool{i} 超时(只给了 {budget:.2f}s)")` 内层自己接住超时,留下一条有用的记录。
- `print(f"deadline_aware={deadline_aware}: 整轮超时,已有结果 {results},{time.perf_counter() - t0:.2f}s")` 不看剩余时间时会走到这里。

</div>

```bash
uv run python -m part07.timeout_chain
```

```text
GOOD: OK
BAD: ['model_request 最坏 60s x 3 次 = 180s,不比 turn=120s 短']
deadline_aware=False: 整轮超时,已有结果 ['tool0 ok', 'tool1 ok'],2.00s
deadline_aware=True: ['tool0 ok', 'tool1 ok', 'tool2 超时(只给了 0.30s)'],1.90s
```

前两行是配置检查。给模型请求设 60 秒是很常见的写法,单看没毛病,可它默认还会重试 2 次,最坏 180 秒,一轮 120 秒早就到了。所以今天把它改成了 30 秒。

后两行说明了单看配置查不出来的问题。每个工具的超时(1 秒)都比一轮(2 秒)短,配置检查会说 OK;但一轮里调了 3 次,前两次用掉 1.6 秒,第 3 次再给它完整的 1 秒,就超出外层了。不看剩余时间的版本,最后被外层的 `TimeoutError` 一刀切断,第 3 次工具发生了什么没留下任何记录。看剩余时间的版本,第 3 次只给了 0.30 秒,超时被工具层接住,1.90 秒时整轮正常结束,还给外层留了点时间去组织回复。

这个做法有个名字,叫截止时间传递(deadline propagation):外层把「最晚什么时候必须结束」往下传,每一层用「自己的上限」和「剩下的时间」里小的那个。gRPC 的 deadline 就是这么设计的,学习资料里有链接。

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="截止时间传递时间轴:一轮总共 2 秒,前两次工具各用 0.8 秒,第三次工具如果给满 1 秒会超出外层,看剩余时间后只给 0.3 秒,在 1.9 秒结束">
<text x="20" y="22" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">一轮 2.0s 的时间轴</text>
<line x1="40" y1="50" x2="600" y2="50" stroke="var(--rule)" stroke-width="1"/>
<text x="40" y="44" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">0s</text>
<text x="590" y="44" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">2.0s</text>
<line x1="600" y1="40" x2="600" y2="190" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
<text x="20" y="84" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">不看剩余</text>
<rect x="100" y="70" width="216" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="110" y="85" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">tool0 0.8s</text>
<rect x="320" y="70" width="216" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="330" y="85" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">tool1 0.8s</text>
<rect x="540" y="70" width="60" height="22" fill="var(--paper-raised)" stroke="var(--ink-faint)"/>
<text x="470" y="112" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">tool2 被外层砍断,无记录</text>
<text x="20" y="150" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">看剩余</text>
<rect x="100" y="136" width="216" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="110" y="151" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">tool0 0.8s</text>
<rect x="320" y="136" width="216" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="330" y="151" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">tool1 0.8s</text>
<rect x="540" y="136" width="32" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="420" y="180" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">tool2 只给 0.3s,自己记下超时</text>
</svg>
<figcaption>同样一轮 2 秒、每个工具上限 1 秒。上面一行第三次工具给满 1 秒,被外层截断;下面一行按剩余时间只给 0.3 秒,在 1.9 秒时正常收尾。</figcaption>
</figure>

### 零件和完整配置的对照

| 今天的零件 | 在真实服务里放在哪 |
| --- | --- |
| `asyncio.timeout(20)` 包工具调用 | 工具统一外壳,超时返回 `{"ok": False, "error": ...}` 给模型 |
| httpx `timeout=` | 工具内部的 HTTP 客户端,管「连不上」「没动静」 |
| SDK `timeout=30, max_retries=2` | 全局 `AsyncOpenAI` 客户端;个别调用用 `with_options` |
| 一轮 `asyncio.timeout(120)` | Day 382 适配层里跑一轮图的地方,超时推 `error` 事件 |
| arq `job_timeout=300` | `WorkerSettings`,任务里要重试就自己接住再抛 `Retry` |
| `check_chain` | 改配置时跑一遍,也可以写成测试 |
| 剩余时间 `budget` | 一轮里循环调工具的地方 |

## 动手练习

### 练习 1:工具内部还有一层 HTTP 请求

查发票的工具内部用 httpx 请求订单系统,配置是 `timeout=8`、自带重试 2 次。把这一层加进 `GOOD`(父层是 `tool_call`),用 `check_chain` 检查,不通过就改到通过。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part07/my_chain.py
from part07.timeout_chain import GOOD, Layer, check_chain

mine: dict[str, Layer] = {
    **GOOD,
    "tool_http": (8, 2, "tool_call"),  # 工具内部的 httpx 请求:8 秒,自带 2 次重试
}
print("tool_http 8s x 3:", check_chain(mine) or "OK")
mine["tool_http"] = (5, 2, "tool_call")
print("tool_http 5s x 3:", check_chain(mine) or "OK")
```

<div class="line-notes">

- `from part07.timeout_chain import GOOD, Layer, check_chain` 复用正文的配置和检查函数。`timeout_chain.py` 最后写了 `if __name__ == "__main__":`,所以 import 它不会把正文的实验再跑一遍。
- `"tool_http": (8, 2, "tool_call"),  # 工具内部的 httpx 请求:8 秒,自带 2 次重试` 最坏 8 × 3 = 24 秒,而工具调用只有 20 秒。
- `mine["tool_http"] = (5, 2, "tool_call")` 改成 5 秒,最坏 15 秒,留出 5 秒余量给退避等待。

</div>

```bash
uv run python -m part07.my_chain
```

```text
tool_http 8s x 3: ['tool_http 最坏 8s x 3 次 = 24s,不比 tool_call=20s 短']
tool_http 5s x 3: OK
```

另一种改法是把重试次数降到 1(8 × 2 = 16 秒)。哪个好取决于订单系统的特点:偶尔慢但大多能回,就保留超时砍重试;经常瞬断但一重连就好,就缩短超时保留重试。

</details>

### 练习 2:任务卡住了也能过一会儿重来

正文看到,arq 的 `job_timeout` 到了直接判失败,不会重试。改写 `draft_reply`:第一次执行模拟上游卡住 5 秒,第二次恢复正常只要 0.5 秒;要求第一次在 `job_timeout` 之前自己接住超时,1 秒后重试,第二次成功。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part07/job_timeout_retry.py
import asyncio
import sys

from arq import Retry, create_pool
from arq.connections import RedisSettings


async def draft_reply(ctx, ticket_id: str) -> str:
    seconds = 5 if ctx["job_try"] == 1 else 0.5  # 第一次上游卡住,第二次恢复
    print(f"[{ticket_id}] try {ctx['job_try']} 要跑 {seconds}s", flush=True)
    try:
        async with asyncio.timeout(1.5):  # 比 job_timeout=2 短
            await asyncio.sleep(seconds)
    except TimeoutError as exc:
        raise Retry(defer=1) from exc
    return f"{ticket_id} 草稿好了"


class WorkerSettings:
    functions = [draft_reply]
    redis_settings = RedisSettings()
    job_timeout = 2
    max_tries = 3


async def main(run: str):
    redis = await create_pool(RedisSettings())
    await redis.enqueue_job("draft_reply", "T1042", _job_id=f"{run}-slow")
    await redis.aclose()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
```

<div class="line-notes">

- `seconds = 5 if ctx["job_try"] == 1 else 0.5  # 第一次上游卡住,第二次恢复` Day 391 的老办法,用 `job_try` 让实验结果稳定。
- `async with asyncio.timeout(1.5):  # 比 job_timeout=2 短` 任务内部的超时必须比 `job_timeout` 短,不然 arq 先到点,你的 `except` 根本没机会执行。
- `raise Retry(defer=1) from exc` 自己接住的超时转成 arq 认识的重试。真实代码里这里应该先过一遍 `is_retryable` 和次数判断(Day 391 小项目的写法),这里为了聚焦只写了最短的版本。
- `job_timeout = 2` 外层保险还在,任务内部要是有同步阻塞代码,还是会被它判失败。

</div>

```bash
uv run python -m part07.job_timeout_retry jr1
uv run arq --burst part07.job_timeout_retry.WorkerSettings
```

```text
12:50:05: Starting worker for 1 functions: draft_reply
12:50:05: redis_version=7.4.6 mem_usage=1.65M clients_connected=1 db_keys=30
12:50:05:   0.82s → jr1-slow:draft_reply('T1042')
[T1042] try 1 要跑 5s
12:50:07:   1.50s ↻ jr1-slow:draft_reply retrying job in 1.00s
12:50:08:   3.82s → jr1-slow:draft_reply('T1042') try=2
[T1042] try 2 要跑 0.5s
12:50:09:   0.50s ← jr1-slow:draft_reply ● 'T1042 草稿好了'
```

第一次在 1.50 秒时被自己的超时接住,arq 打出 `retrying job in 1.00s`;第二次 0.5 秒完成。用 `Job("jr1-slow", redis).result_info()` 查,实测是 `success=True`、`job_try=2`。

</details>

### 练习 3:上游每块之间隔得比 read 超时还长

把挤牙膏服务改成每 1.5 秒一块(`uv run python -m part07.drip_server 1.5`),不改 `read_timeout.py`,再跑一遍。预测会发生什么,再看实际结果。

<details><summary>参考答案</summary>

预测:每块之间 1.5 秒,超过 httpx 的 read 超时 1 秒,第一块都等不到就会触发 httpx 自己的超时。

```bash
# 终端 1
uv run python -m part07.drip_server 1.5
# 终端 2
uv run python -m part07.read_timeout
```

实跑结果,程序直接崩了,traceback 最后几行:

```text
  File ".../httpx/_transports/default.py", line 118, in map_httpcore_exceptions
    raise mapped_exc(message) from exc
httpx.ReadTimeout
```

预测对了一半:超时确实触发了,但 `read_timeout.py` 里的 `except TimeoutError` 没接住它,因为 `httpx.ReadTimeout` 是 httpx 自己的异常类,继承自 `httpx.TimeoutException`,和内置的 `TimeoutError` 没有关系。要两种都接,写成 `except (TimeoutError, httpx.TimeoutException):`。Day 389 的 `is_retryable` 里认的正是 `httpx.TimeoutException`,所以这类超时在重试逻辑里会被当成可重试。

</details>

**验收标准**:`timeout_basics` 和 `blocking_timeout` 的用时和文中一致,能解释为什么后者超时没生效;`read_timeout` 第一行用时明显超过 1 秒并能说清原因;`sdk_timeout` 能数出 1、3、1 次请求;`job_timeout` 慢任务 `job_try=1` 就失败;能复述 `timeout_not_cancel` 里 P-002 是怎么来的;`check_chain` 对 `BAD` 报错。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 超时(timeout) | 等一件事的最长时间,到点不管结果如何都放弃等待,把控制权拿回来 |
| `asyncio.timeout` | Python 3.11 起的异步上下文管理器,块内超时就取消里面的 `await`,出口抛 `TimeoutError` |
| `asyncio.timeout_at` | 同上,参数是事件循环时钟上的截止时刻,而不是秒数 |
| 同步阻塞 | 代码卡住整个线程不让出控制权,如 `time.sleep`、`requests.get`;事件循环停摆,asyncio 的超时失效 |
| read 超时 | httpx 里两次收到数据之间最多等多久,不是整个响应的总时长 |
| chunked 传输 | HTTP 响应分块发送、事先不告知总长度的方式,流式响应用它 |
| `with_options` | openai SDK 客户端的方法,复制出一个只改部分参数(如超时)的新客户端 |
| `job_timeout` | arq 单个任务的最长执行时间,默认 300 秒,超时直接判失败 |
| 截止时间传递 | 外层把「最晚何时结束」往下传,每层取自己的上限和剩余时间中较小的那个 |
| `asyncio.shield` | 保护一个任务不被外层的取消波及;今天用它模拟「对方服务器上的处理不受我们放弃的影响」 |

## 常见误区

**以为 `timeout=1.0` 就是「请求最多 1 秒」。** httpx 和 openai SDK 的超时都是分阶段的,read 管的是两次收到数据的间隔。正文的挤牙膏实验里 `timeout=1.0` 读了 4.18 秒。要限制总时长,在外面套 `asyncio.timeout`。

**算最坏耗时忘了乘重试次数。** SDK 默认 `max_retries=2`,一次调用最多发 3 次请求,中间还有退避等待。模型请求设 60 秒、一轮设 120 秒,看起来内短外长,实际最坏 180 秒。

**在 async 函数里调同步库。** `time.sleep`、`requests`、同步的数据库驱动都会卡住事件循环,`asyncio.timeout` 和 arq 的 `job_timeout` 一起失效,而且不报任何错。正文实测设了 1 秒、等了 3 秒。

**外层超时比内层短。** 内层的超时永远没机会触发,内层准备好的「把超时变成一条给模型看的结果」也就白写了,日志里只剩一个不知道卡在哪的 `TimeoutError`。

**把超时当成失败,换个新请求重来。** 超时只说明你没等到,对方可能已经做完。写操作重试必须带同一个幂等键,工具层给模型的提示也要说「不确定是否已提交」。

**以为 arq 任务超时会自动重试。** 实测 `job_timeout` 到了 `job_try=1` 就判失败,`max_tries` 不起作用。要重试就在任务内部用更短的超时接住,再抛 `Retry`。

## 学习资料

### 文档与文章

- [Python 文档 · Coroutines and Tasks](https://docs.python.org/3/library/asyncio-task.html):看 Timeouts 一节,`asyncio.timeout`、`timeout_at` 和 `wait_for` 的区别都在这里,还有 Shielding From Cancellation 一节讲 `shield`。英文,20 分钟。
- [HTTPX · Timeouts](https://www.python-httpx.org/advanced/timeouts/):httpx 四种超时各管什么,怎么单独设置。10 分钟。
- [openai-python README](https://github.com/openai/openai-python):搜 Timeouts 和 Retries 两节,看默认值和 `with_options` 的写法。10 分钟。
- [AWS Builders' Library · Timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/):AWS 工程师写的,讲超时值怎么定(从延迟分布里挑一个百分位)、重试怎么避免放大故障。英文,30 分钟,今天最值得读的一篇。
- [Google SRE Book · Addressing Cascading Failures](https://sre.google/sre-book/addressing-cascading-failures/):看讲 deadline 和 deadline propagation 的段落,和正文第七步是同一个思路。英文,30 分钟。
- [gRPC · Deadlines](https://grpc.io/docs/guides/deadlines/):gRPC 把截止时间做成了协议的一部分,短文,看它怎么描述服务端收到截止时间后该做什么。10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV12M411s7k9&autoplay=0&high_quality=1" title="懵逼了，好好的API接口为什么会超时呢?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>苏三说技术 · 懵逼了，好好的API接口为什么会超时呢? · 约 10 分钟,Java 后端视角。看的时候对照今天的分层,想想它说的每种原因会在哪一层的超时上暴露出来。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1vG4y147wN&autoplay=0&high_quality=1" title="超时超时又超时，Kubernetes 网络请求超时504 GatewayTimeout咋个办？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>ponerinemy · 超时超时又超时，Kubernetes 网络请求超时504 GatewayTimeout咋个办? · 约 4 分钟。504 就是「外层网关先超时了」,正好对应正文第二步外层比内层短的那种情况。Kubernetes 先不用懂,只看 504 是怎么来的。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/hMqbI_XBTcc" title="Distributed Systems: Timeouts, Retries and Why Not Add More Machines | DDIA Explained L5" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>The Modern SDE · Distributed Systems: Timeouts, Retries and Why Not Add More Machines · 英文,按《Designing Data-Intensive Applications》的思路讲超时和重试,可以配合 Day 391 书单里的 DDIA 一起看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/3149nz254mo" title="Retries, Timeouts and Fallbacks for LLM Calls" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>doodle-monster · Retries, Timeouts and Fallbacks for LLM Calls · 英文,专门讲大模型调用的超时、重试和兜底,和第四步、第五步的场景一致。</figcaption>
</figure>

### 书籍

- Michael T. Nygard《Release It! Design and Deploy Production-Ready Software》(第二版,Pragmatic Bookshelf,2018):稳定性模式那一章第一个就是 Timeouts,讲为什么每个跨网络的调用都要有超时,还有和它配套的断路器。读 Timeouts 一节,30 分钟。
- Betsy Beyer 等《Site Reliability Engineering》(O'Reilly,2016,中文版《SRE:Google 运维解密》,电子工业出版社):第 22 章 Addressing Cascading Failures,就是上面文档里那篇的完整版,讲截止时间传递。

### 开源项目与代码

- [python-arq/arq](https://github.com/python-arq/arq):打开 `arq/worker.py` 搜 `wait_for`,能看到正文 traceback 里那行 `result = await asyncio.wait_for(task, timeout_s)`,任务超时就是靠它实现的。
- [openai/openai-python](https://github.com/openai/openai-python):`src/openai/_constants.py` 里是正文查到的那几个默认值,`_base_client.py` 里搜 `retry` 能看到 SDK 怎么算退避时间。

## 自测

1. 一轮对话设了 `asyncio.timeout(120)`,模型客户端 `timeout=50, max_retries=2`。这个配置有什么问题?

<details><summary>答案</summary>

模型请求最坏 50 × 3 = 150 秒,还没算重试之间的退避等待,超过了一轮的 120 秒。一旦上游变慢,一轮会先超时,SDK 的重试来不及完成,日志里只有外层的 `TimeoutError`。改法是把单次超时降到 30 秒左右(最坏 90 秒),或者减少重试次数。

</details>

2. 一个工具函数里写了 `requests.get(url, timeout=5)`,外面包着 `asyncio.timeout(2)`。订单系统卡住时,这一步实际要等多久?为什么?

<details><summary>答案</summary>

大约 5 秒,由 requests 自己的超时决定。`requests` 是同步库,调用期间事件循环被卡住,`asyncio.timeout(2)` 的取消没法执行,和正文 `blocking_timeout.py` 设 1 秒等 3 秒是同一个原因。这期间同一个进程里其他所有协程也都停着。应该换成 httpx 的 `AsyncClient`,或者用 `asyncio.to_thread` 包起来。

</details>

3. `httpx.AsyncClient(timeout=10)` 去读一个流式接口,上游每 3 秒吐一个 token,一共吐 5 分钟。会触发超时吗?

<details><summary>答案</summary>

不会。read 超时管的是两次收到数据的间隔,3 秒小于 10 秒,这个请求会一直读满 5 分钟。要限制总时长,在外面套 `asyncio.timeout`。

</details>

4. arq 的 `job_timeout=300`、`max_tries=3`,某个任务跑到第 300 秒被取消。它会被重试吗?

<details><summary>答案</summary>

不会。正文实测,任务超时后 `job_try=1` 就判失败,结果是 `TimeoutError()`。arq 只在任务抛 `Retry` 时安排重试。要重试就在任务内部用比 300 秒短的超时接住,再抛 `Retry`。

</details>

5. (面试题)Agent 调支付网关创建退款,你设了 10 秒超时。10 秒没返回,你会怎么处理?

<details><summary>答案</summary>

参考答法:先认定状态是「未知」而不是「失败」,因为请求可能已经到达网关并被处理。处理分三步:一是重试时带同一个幂等键,网关如果已经建好会返回原来那笔,不会重复;二是给模型的工具结果写成「支付网关暂时没有回应,不确定是否已提交,系统会自动确认」,避免模型自作主张再提交一次;三是重试次数用完仍不确定,就按幂等键去网关查询状态或者转人工核对,而不是直接告诉客户失败。另外,超时值要比外层(一轮对话、队列任务)的超时短,连同重试一起算,这样超时才能被工具层自己接住。

</details>

## 明天预告

Day 393 · 断点续跑:让崩在半路的任务接着跑。今天的超时解决的是「卡住」,明天解决的是「死掉」:worker 跑到一半进程被 kill,任务重新投递以后,前面已经花钱调过的模型要不要再调一遍?答案是用 LangGraph 的 checkpoint 从断点接着跑,但里面有几个坑,比如输入传错了会把整个流程从头再走一遍。
