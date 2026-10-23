---
title: 'Day 162 · 并行工具调用'
description: '模型有时在一条回复里一口气提好几个请求(北京、上海、广州各一个),它的意思是这几件事互不依赖。今天把它们并发执行:asyncio.gather 加 asyncio.to_thread,三个城市串行 8.5 秒、并发 2.9 秒;同步函数直接塞进 async 函数为什么没变快(实测 1.50 秒对 0.50 秒);有副作用的工具并发会读到旧数据(count 是 0 不是 1);有依赖的请求模型自己会拆成三次请求;DeepSeek 上 parallel_tool_calls=False 和提示词都管不住它,所以执行端要自己兜底;最后写一个带并发上限和超时、保证每个请求都回一条的执行器。'
pubDate: 2026-10-23
regime: none
tags: ['function-calling', 'tool-use', 'asyncio', 'agent-zero']
series: 'agent-zero'
day: 162
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 161](/blog/agent-zero/day-161-missing-result/) 实测了「每个请求必须有一条 tool 消息回应」:三个请求漏哪一个都是 400,顺序可以乱,重复 id 不行;写了 `answer_all` 保证每个请求都回,写了 `close_dangling` 给已经漏了的历史补齐。那天有一个小结论没有展开:六种顺序全是 200。

今天正面处理那个前提:**模型一次提了好几个请求,我们怎么执行**。前几天的 `two_rounds` 是一个一个执行的(`for call in calls:`),三个城市要等 8 秒多。请求之间既然互不依赖,为什么不同时去查?但「同时」在 Python 里有一个坑,同步的函数放进 `async` 里,并不会变成并发。今天会实测这个坑,再接上模型,最后看哪些情况不该并发。

## 今天要解决的问题

学完今天你应该能做到:

1. 说出「模型一条回复里有几个 `tool_calls`」代表什么(它认为这几件事互不依赖,不是它在并行执行),并写出把它们并发执行、按 `tool_call_id` 一一放回的代码。
2. 解释为什么同步函数(比如 `time.sleep`、`httpx.get`)放进 `async def` 里再 `gather` 没有变快,用 `asyncio.to_thread` 怎么解决,并用实测的秒数证明。
3. 判断什么时候不该并发(有副作用、有先后依赖),说出在 DeepSeek 上哪些办法管不住模型的并行,以及执行端该怎么兜底。

今天有两个新概念:**并行工具调用**(一条回复里多个 `tool_calls`)和 **`asyncio.to_thread`**(把同步函数交给线程去跑)。`gather`、`Semaphore` 是 [Day 68](/blog/agent-zero/day-068-async-3/) 学过的。

预计用时:2.5 小时,实跑花费约 ¥0.03(算式在文末)。前置:[Day 161](/blog/agent-zero/day-161-missing-result/)(`answer_all`、`how_it_goes_missing.py` 里的假数据)、[Day 160](/blog/agent-zero/day-160-week23-review/)(`review160_check.py` 里的 `call_of`)、[Day 159](/blog/agent-zero/day-159-tool-roundtrip/)(`check_messages`)、[Day 158](/blog/agent-zero/day-158-fc-first-run/)(`execute_call`)、[Day 66](/blog/agent-zero/day-066-async-1/) 到 [Day 68](/blog/agent-zero/day-068-async-3/)(`async`、`await`、`gather`、`Semaphore`)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `parallel_min.py` 里 `main()` 中间那一段(`gather` 加 `to_thread`,再按顺序放回 tool 消息);再做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

今天的实验和前几天一样的边界:天气函数只查 Open-Meteo,工单和发票都是内存里的假数据,不读写任何文件,不执行任何模型给的字符串。

## 先看时间线

模型一次提三个请求,有两种执行方式:

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="时间线对比:串行执行北京、上海、广州三个天气请求共 8.49 秒,每个约 2.8 秒首尾相接;并发执行三个同时开始,共 2.86 秒">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink)">串行:for call in calls  实测 8.49s</text>
<rect x="60" y="40" width="190" height="30" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="70" y="60" fill="var(--ink)">北京</text>
<rect x="250" y="40" width="190" height="30" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="260" y="60" fill="var(--ink)">上海</text>
<rect x="440" y="40" width="190" height="30" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="450" y="60" fill="var(--ink)">广州</text>
<text x="20" y="108" fill="var(--ink)">并发:gather + to_thread  实测 2.86s</text>
<rect x="60" y="120" width="190" height="30" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="70" y="140" fill="var(--ink)">北京</text>
<rect x="60" y="156" width="190" height="30" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="70" y="176" fill="var(--ink)">上海</text>
<rect x="60" y="192" width="190" height="30" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="70" y="212" fill="var(--ink)">广州</text>
<line x1="60" y1="244" x2="630" y2="244" stroke="var(--rule)"/>
<line x1="60" y1="240" x2="60" y2="248" stroke="var(--ink-faint)"/>
<line x1="261" y1="240" x2="261" y2="248" stroke="var(--ink-faint)"/>
<line x1="462" y1="240" x2="462" y2="248" stroke="var(--ink-faint)"/>
<line x1="630" y1="240" x2="630" y2="248" stroke="var(--ink-faint)"/>
<text x="54" y="264" fill="var(--ink-faint)" font-size="11">0</text>
<text x="251" y="264" fill="var(--ink-faint)" font-size="11">3s</text>
<text x="452" y="264" fill="var(--ink-faint)" font-size="11">6s</text>
<text x="612" y="264" fill="var(--ink-faint)" font-size="11">8.5s</text>
<text x="20" y="288" fill="var(--ink-faint)" font-size="11">每个请求要先查城市再查天气,两次网络往返,约 2.8 秒;并发时总时间约等于最慢的那一个</text>
</g>
</svg>
<figcaption>三个请求互不依赖,串行是首尾相接,并发是同时开始。工具在等网络的时候本来就没有在用 CPU,所以并发几乎是白捡的。</figcaption>
</figure>

先澄清一个容易想歪的地方:**「并行工具调用」是模型的说法,不是模型在并行执行。**模型只是在一条回复里写了三个请求,意思是「这三件事我认为互不依赖,你可以按任意顺序做、同时做」。真正执行的还是我们的代码,所以并发不并发是我们的决定。Anthropic 的文档说得很清楚:API 不规定执行顺序,你可以并发、可以按顺序、也可以混着来,只要每个请求都回一条结果。

## 第一步:同步函数放进 async,为什么没变快

前端同学对「并发」的第一直觉是 `Promise.all`。Python 的 `asyncio.gather` 是它的近亲,但有一个差别会坑人。先不联网,用 `sleep` 假装等网络,量一下四种写法。新建 `part03/thread_demo.py`:

```python
# agent-zero-lab/part03/thread_demo.py
import asyncio
import time


def slow_sync(n: int) -> int:
    time.sleep(0.5)  # 假装在等网络:同步地干等 0.5 秒
    return n


async def slow_async(n: int) -> int:
    await asyncio.sleep(0.5)  # 异步地等 0.5 秒:等的时候把控制权还给事件循环
    return n


async def blocking_inside_async(n: int) -> int:
    return slow_sync(n)  # async def 里直接调同步的 sleep:没有 await,事件循环被卡住


async def main() -> None:
    t = time.perf_counter()
    for i in range(3):
        slow_sync(i)
    print(f"1. 普通 for 循环串行:                {time.perf_counter() - t:.2f}s")

    t = time.perf_counter()
    await asyncio.gather(*(slow_async(i) for i in range(3)))
    print(f"2. gather + 真正的异步函数:          {time.perf_counter() - t:.2f}s")

    t = time.perf_counter()
    await asyncio.gather(*(blocking_inside_async(i) for i in range(3)))
    print(f"3. gather + async 里调了同步函数:    {time.perf_counter() - t:.2f}s")

    t = time.perf_counter()
    out = await asyncio.gather(*(asyncio.to_thread(slow_sync, i) for i in range(3)))
    print(f"4. gather + to_thread(同步函数):     {time.perf_counter() - t:.2f}s,结果 {out}")


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `import asyncio` 异步库,Day 66 到 68 学过。
- `import time` 用 `time.sleep` 模拟同步地等,用 `time.perf_counter` 计时。
- `def slow_sync(n: int) -> int:` 一个普通函数(同步)。
- `time.sleep(0.5)  # 假装在等网络:同步地干等 0.5 秒` 同步的 `sleep`:当前线程停在这里 0.5 秒,什么别的也干不了。
- `return n` 返回传进来的数,方便看顺序。
- `async def slow_async(n: int) -> int:` 一个协程函数(异步)。
- `await asyncio.sleep(0.5)  # 异步地等 0.5 秒:等的时候把控制权还给事件循环` 异步的 `sleep`:等的这 0.5 秒里,事件循环可以去跑别的协程。相当于 JS 里 `await new Promise(r => setTimeout(r, 500))`。
- `async def blocking_inside_async(n: int) -> int:` 一个「看起来是异步」的函数。
- `return slow_sync(n)  # async def 里直接调同步的 sleep:没有 await,事件循环被卡住` 它虽然写着 `async def`,里面却直接调了同步的 `time.sleep`。没有 `await` 就没有让出控制权的机会。
- `async def main() -> None:` 主流程是协程,因为里面要 `await gather`。
- `t = time.perf_counter()` 记起点,每个实验前重新记。
- `for i in range(3):` 实验 1:普通 for 循环调三次 `slow_sync`。
- `print(f"1. 普通 for 循环串行:                {time.perf_counter() - t:.2f}s")` 实测 1.51 秒,三个 0.5 秒首尾相接。
- `await asyncio.gather(*(slow_async(i) for i in range(3)))` 实验 2:三个真正的协程一起 `gather`。`*(...)` 把生成器展开成三个参数。
- `print(f"2. gather + 真正的异步函数:          {time.perf_counter() - t:.2f}s")` 实测 0.50 秒,三个 0.5 秒重叠在一起。这是 `Promise.all` 的效果。
- `await asyncio.gather(*(blocking_inside_async(i) for i in range(3)))` 实验 3:三个「看起来异步」的函数一起 `gather`。
- `print(f"3. gather + async 里调了同步函数:    {time.perf_counter() - t:.2f}s")` 实测 1.50 秒,和串行一样。`gather` 开了三个协程,但第一个协程跑起来就被同步的 `sleep` 卡住 0.5 秒,第二个要等它跑完才有机会,所以还是一个接一个。
- `out = await asyncio.gather(*(asyncio.to_thread(slow_sync, i) for i in range(3)))` 实验 4:把同步函数交给 `asyncio.to_thread`。注意写法是 `to_thread(函数, 参数)`,不是 `to_thread(函数(参数))`,后者会先在当前线程同步地执行完再传结果。
- `print(f"4. gather + to_thread(同步函数):     {time.perf_counter() - t:.2f}s,结果 {out}")` 实测 0.50 秒,结果 `[0, 1, 2]`,`gather` 按传入顺序返回。
- `asyncio.run(main())` 启动事件循环,跑到 `main()` 结束。

</div>

```bash
uv run python -m part03.thread_demo
```

```text
1. 普通 for 循环串行:                1.51s
2. gather + 真正的异步函数:          0.50s
3. gather + async 里调了同步函数:    1.50s
4. gather + to_thread(同步函数):     0.50s,结果 [0, 1, 2]
```

第 3 行是今天的第一个坑,**它没有报错、没有警告,只是慢**。原因要从事件循环说起:asyncio 的「并发」是**一个线程里轮流跑**,协程在 `await` 的地方主动把控制权交出去,事件循环趁这个空档去跑别的协程。同步函数里没有 `await`,不会交出控制权,整条线程被占住。JS 里是同一个道理:如果你在 `Promise.all` 的回调里写一个同步的死循环,其他 Promise 一样动不了。区别在于 JS 里常见的 I/O(`fetch`、`fs.promises`)本来就是异步的,而 Python 里我们的 `get_weather` 用的是 `httpx.get`,是同步的。

`asyncio.to_thread` 是最省事的解法:它把同步函数放到一个线程池里的另一个线程去跑,当前协程 `await` 它的结果,线程池里的几个线程同时在等网络,事件循环那边也不会被卡。等网络的时候线程只是在睡觉,并不占 CPU,所以这样做几乎没有代价。(Python 里「同时算」的 CPU 密集型工作是另一回事,有 GIL 的限制,工具调用基本都是等网络,今天用不到。)

## 第二步:接上模型,并发执行三个城市

新建 `part03/parallel_min.py`,先量时间再放回 tool 消息:

```python
# agent-zero-lab/part03/parallel_min.py
import asyncio
import time
from typing import Any

from common.llm import LLMClient
from part03.tool_runner import execute_call
from part03.weather_tool import WEATHER_TOOL

TOOLS = [WEATHER_TOOL]


async def main() -> None:
    client = LLMClient()
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": "你是云簿 CloudLedger 的客服助手。回答简短。"},
        {"role": "user", "content": "北京、上海、广州现在各多少度?哪个最热?"},
    ]
    first = client.chat(messages, tools=TOOLS, temperature=0, max_tokens=300)
    calls = first.message.get("tool_calls") or []
    print(f"模型一次提了 {len(calls)} 个请求:", [(c["id"][:10] + "…", c["function"]["arguments"]) for c in calls])

    t = time.perf_counter()
    for call in calls:
        execute_call(call, TOOLS)
    serial = time.perf_counter() - t

    t = time.perf_counter()
    results = await asyncio.gather(*(asyncio.to_thread(execute_call, call, TOOLS) for call in calls))
    parallel = time.perf_counter() - t
    print(f"串行执行 {serial:.2f}s,并发执行 {parallel:.2f}s")

    messages.append(first.message)
    for call, result in zip(calls, results):
        messages.append({"role": "tool", "tool_call_id": call["id"], "content": result})
    print("tool 消息的 id 顺序:", [m["tool_call_id"][:10] + "…" for m in messages if m["role"] == "tool"])

    second = client.chat(messages, tools=TOOLS, temperature=0, max_tokens=300)
    print("回答:", second.content.replace("\n", " "))
    print(client.ledger)


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `import asyncio` 事件循环和 `gather`。
- `import time` 计时。
- `async def main() -> None:` 整个脚本写成协程,因为中间要 `await gather`。
- `client = LLMClient()` Day 135 的客户端。请求模型这一步仍然是同步调用,它只有一次,不需要并发。
- `{"role": "user", "content": "北京、上海、广州现在各多少度?哪个最热?"}` 三件互不依赖的事,模型会一口气提三个请求。
- `first = client.chat(messages, tools=TOOLS, temperature=0, max_tokens=300)` 请求 1。
- `calls = first.message.get("tool_calls") or []` 取出请求。
- `print(f"模型一次提了 {len(calls)} 个请求:", [(c["id"][:10] + "…", c["function"]["arguments"]) for c in calls])` 实测 3 个,id 是 `call_00_`、`call_01_`、`call_02_` 开头,参数分别是北京、上海、广州。
- `t = time.perf_counter()` 先量串行的。
- `for call in calls:` 对照组:一个一个执行。
- `execute_call(call, TOOLS)` 结果丢掉,只量时间。
- `serial = time.perf_counter() - t` 串行总用时。
- `results = await asyncio.gather(*(asyncio.to_thread(execute_call, call, TOOLS) for call in calls))` 并发执行。生成器里每个请求造一个 `to_thread(execute_call, call, TOOLS)`(注意是函数加参数,不是调用结果),`gather` 同时 `await` 它们,返回按传入顺序排好的结果列表。
- `parallel = time.perf_counter() - t` 并发总用时。
- `print(f"串行执行 {serial:.2f}s,并发执行 {parallel:.2f}s")` 实测 8.53 秒对 3.48 秒(网络有波动,另一次是 8.70 对 2.96)。
- `messages.append(first.message)` 放回 assistant 消息。
- `for call, result in zip(calls, results):` `zip` 把请求和结果并排拼起来。`gather` 保证 `results[i]` 对应 `calls[i]`,所以这样配对不会错。
- `messages.append({"role": "tool", "tool_call_id": call["id"], "content": result})` 每个请求一条 tool 消息,id 抄请求的。
- `print("tool 消息的 id 顺序:", [m["tool_call_id"][:10] + "…" for m in messages if m["role"] == "tool"])` 实测 `call_00_`、`call_01_`、`call_02_`,和请求顺序一致。
- `second = client.chat(messages, tools=TOOLS, temperature=0, max_tokens=300)` 请求 2。
- `print("回答:", second.content.replace("\n", " "))` 实测说出三个城市的温度并指出广州最热。
- `asyncio.run(main())` 启动。

</div>

```bash
uv run python -m part03.parallel_min
```

```text
模型一次提了 3 个请求: [('call_00_lB…', '{"city": "北京"}'), ('call_01_AR…', '{"city": "上海"}'), ('call_02_6L…', '{"city": "广州"}')]
串行执行 8.53s,并发执行 3.48s
tool 消息的 id 顺序: ['call_00_lB…', 'call_01_AR…', 'call_02_6L…']
回答: 当前气温：  - 北京：13.6°C，晴 - 上海：22.0°C，小毛毛雨 - 广州：28.9°C，晴  最热的是广州（28.9°C）。
2 次调用 | 输入 1045 / 输出 148 tokens | 约 ¥0.0018
```

串行 8.53 秒、并发 3.48 秒。并发的总时间约等于最慢的那一个请求(Open-Meteo 查一个城市要两次网络往返,约 2.8 到 3 秒),不是三个相加。模型的回答也对了:13.6、22.0、28.9 这三个数是从三条 tool 消息里读出来的,它指出广州最热。

这里有两个细节值得停一下。第一,**`gather` 返回的顺序是传入顺序,不是完成顺序**。如果广州先跑完,`results[2]` 也还是广州的结果。所以 `zip(calls, results)` 是安全的,id 不会错位。(Day 161 实测过:即使放回的顺序和请求不一样,服务端也接受。所以这一步其实是「双保险」,不是硬要求。)第二,请求 1 和请求 2 仍然是同步的、一个接一个,因为请求 2 要等工具结果。**并发的只有「执行工具」这一段。**

## 第三步:什么时候别并发

并发是个优化,优化有前提:请求之间**互不影响**。有两种情况不成立。

### 有副作用,而且顺序有意义

假设有两个工具:`create_ticket`(新建工单,有副作用)和 `count_tickets`(数工单,只读)。如果模型提了「先建一张,再数一下」两个请求,我们并发执行会怎样?不联网,用内存里的假工单表,新建要写 0.2 秒,数一下立刻返回。新建 `part03/parallel_race.py`:

```python
# agent-zero-lab/part03/parallel_race.py
"""有副作用的工具并发执行会怎样。全部不联网:内存里一张假的工单表。"""
import asyncio
import json
import time
from collections.abc import Callable
from typing import Any

from part03.review160_check import call_of
from part03.tool_runner import execute_call

TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "create_ticket",
            "description": "新建一张工单,有副作用。",
            "parameters": {"type": "object", "properties": {"title": {"type": "string"}}, "required": ["title"]},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "count_tickets",
            "description": "返回现在一共有几张工单,只读。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]

# 假模型一口气提了两个请求:先建工单,再数工单(它「想」按这个顺序执行)
CALLS = [
    call_of('{"title": "打印机坏了"}', name="create_ticket", cid="c1"),
    call_of("{}", name="count_tickets", cid="c2"),
]


def make_funcs() -> dict[str, Callable[..., Any]]:
    tickets: list[str] = []  # 每次实验一张新表

    def create_ticket(title: str) -> dict[str, Any]:
        time.sleep(0.2)  # 写库要一点时间
        tickets.append(title)
        return {"created": title}

    def count_tickets() -> dict[str, Any]:
        return {"count": len(tickets)}  # 读一下,立刻返回

    return {"create_ticket": create_ticket, "count_tickets": count_tickets}


def serial() -> list[str]:
    funcs = make_funcs()
    return [execute_call(c, TOOLS, funcs) for c in CALLS]


async def parallel() -> list[str]:
    funcs = make_funcs()
    return list(await asyncio.gather(*(asyncio.to_thread(execute_call, c, TOOLS, funcs) for c in CALLS)))


if __name__ == "__main__":
    print("按请求的顺序一个一个执行:", [json.loads(r) for r in serial()])
    print("并发执行:                 ", [json.loads(r) for r in asyncio.run(parallel())])
```

<div class="line-notes">

- `import json` 把结果字符串解析回字典好打印。
- `import time` 模拟写库的耗时。
- `from part03.review160_check import call_of` Day 160 里造请求的小函数。
- `TOOLS: list[dict[str, Any]] = [` 两个工具的定义。
- `"description": "新建一张工单,有副作用。",` 描述里直接写明有副作用,这是给人和模型看的信息。
- `"description": "返回现在一共有几张工单,只读。",` 只读。
- `CALLS = [` 假模型一口气提的两个请求。
- `call_of('{"title": "打印机坏了"}', name="create_ticket", cid="c1"),` 先建工单。
- `call_of("{}", name="count_tickets", cid="c2"),` 再数。两个都是模型这一条回复里的请求,它「想」按这个顺序执行。
- `def make_funcs() -> dict[str, Callable[..., Any]]:` 每次实验造一套新的函数和一张新表,串行和并发两次实验互不干扰。
- `tickets: list[str] = []  # 每次实验一张新表` 内存里的工单表,函数里的闭包变量。
- `def create_ticket(title: str) -> dict[str, Any]:` 新建。
- `time.sleep(0.2)  # 写库要一点时间` 假装写库需要 0.2 秒。
- `tickets.append(title)` 睡完才真的写进去。
- `return {"created": title}` 返回新建的标题。
- `def count_tickets() -> dict[str, Any]:` 数一下。
- `return {"count": len(tickets)}  # 读一下,立刻返回` 没有 `sleep`,调用的瞬间表里有几张就是几张。
- `return {"create_ticket": create_ticket, "count_tickets": count_tickets}` 白名单字典。
- `def serial() -> list[str]:` 串行版。
- `return [execute_call(c, TOOLS, funcs) for c in CALLS]` 按请求顺序一个一个来。
- `async def parallel() -> list[str]:` 并发版。
- `return list(await asyncio.gather(*(asyncio.to_thread(execute_call, c, TOOLS, funcs) for c in CALLS)))` 两个同时丢进线程。`create_ticket` 的线程睡 0.2 秒,`count_tickets` 的线程几乎立刻就读表。
- `print("按请求的顺序一个一个执行:", [json.loads(r) for r in serial()])` 串行结果。
- `print("并发执行:                 ", [json.loads(r) for r in asyncio.run(parallel())])` 并发结果。

</div>

```bash
uv run python -m part03.parallel_race
```

```text
按请求的顺序一个一个执行: [{'created': '打印机坏了'}, {'count': 1}]
并发执行:                  [{'created': '打印机坏了'}, {'count': 0}]
```

串行时 `count` 是 1,并发时是 **0**。工单明明建了(第一项 `created` 都返回了),但数工单那个线程在它写进去之前就读完了。这个结果没有报错,模型拿到「当前有 0 张工单」去回答用户,用户看到的是「已创建,当前共 0 张」。这就是读到旧数据的竞态(race condition):两个操作的先后顺序不确定,结果取决于谁快。

**所以规矩是:有副作用的工具,按请求的顺序一个一个执行。**更保守的判断是「只要这批请求里有一个不是只读的,整批都按顺序」。练习 2 会写这个。Anthropic 的文档也是这个意思:无副作用、只读的操作通常可以并发,有副作用、共享状态或者有顺序要求的更适合顺序执行。

### 有先后依赖

另一种情况:第二个请求的参数要用第一个请求的结果。比如问「INV-2026-0042 那个客户一共有几张发票?」,要先 `get_invoice` 查出客户名,才能 `list_invoices_by_customer(客户名)`。这种情况模型**根本不会一次提两个**,它会先提一个,看了结果再提下一个。新建 `part03/dependent_calls.py`,手写三步(Day 166 会把它收成 `while` 循环):

```python
# agent-zero-lab/part03/dependent_calls.py
from typing import Any

from common.llm import LLMClient
from part03.invoice_data import INVOICE_TOOL, get_invoice
from part03.tool_runner import execute_call

LIST_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "list_invoices_by_customer",
        "description": "按客户名称列出这个客户所有发票的编号和金额。需要先知道客户名称。",
        "parameters": {
            "type": "object",
            "properties": {"customer": {"type": "string", "description": "客户名称,例如 星河科技"}},
            "required": ["customer"],
        },
    },
}
TOOLS = [INVOICE_TOOL, LIST_TOOL]
FAKE_LIST = '{"customer": "星河科技", "invoices": [{"id": "INV-2026-0042", "amount": 1280.0}, {"id": "INV-2026-0031", "amount": 800.0}]}'

client = LLMClient()
messages: list[dict[str, Any]] = [
    {"role": "system", "content": "你是云簿 CloudLedger 的客服助手。回答简短。"},
    {"role": "user", "content": "INV-2026-0042 那个客户一共有几张发票?"},
]
for step in range(1, 4):  # 手写三步,Day 166 会把它收成 while 循环
    r = client.chat(messages, tools=TOOLS, temperature=0, max_tokens=300)
    calls = r.message.get("tool_calls") or []
    print(f"第 {step} 次请求 finish_reason={r.finish_reason:10}", [(c["function"]["name"], c["function"]["arguments"]) for c in calls], r.content[:40].replace("\n", " "))
    if not calls:
        break
    messages.append(r.message)
    for c in calls:
        if c["function"]["name"] == "get_invoice":
            result = execute_call(c, TOOLS, {"get_invoice": get_invoice})
        else:
            result = FAKE_LIST  # 假数据:这个工具今天没有真的实现
        messages.append({"role": "tool", "tool_call_id": c["id"], "content": result})
print(client.ledger)
```

<div class="line-notes">

- `from part03.invoice_data import INVOICE_TOOL, get_invoice` Day 160 小项目的发票工具和函数。
- `LIST_TOOL: dict[str, Any] = {` 第二个工具的定义:按客户名称列出发票。
- `"description": "按客户名称列出这个客户所有发票的编号和金额。需要先知道客户名称。",` 描述里的最后一句「需要先知道客户名称」是给模型的依赖提示。
- `"properties": {"customer": {"type": "string", "description": "客户名称,例如 星河科技"}},` 参数是客户名称,不是发票编号,所以要先查发票才能知道。
- `TOOLS = [INVOICE_TOOL, LIST_TOOL]` 发给模型两个工具。
- `FAKE_LIST = '{"customer": "星河科技", "invoices": [{"id": "INV-2026-0042", "amount": 1280.0}, {"id": "INV-2026-0031", "amount": 800.0}]}'` 第二个工具今天没有真的实现,返回一份写死的假数据:星河科技共 2 张发票。
- `for step in range(1, 4):  # 手写三步,Day 166 会把它收成 while 循环` 最多三次请求,从 1 数到 3。
- `r = client.chat(messages, tools=TOOLS, temperature=0, max_tokens=300)` 每一步都带着完整历史请求。
- `calls = r.message.get("tool_calls") or []` 这一步有没有请求。
- `print(f"第 {step} 次请求 finish_reason={r.finish_reason:10}"` 打印这一步的结束原因、请求的函数名和参数、回答的前 40 个字。
- `if not calls:` 没有请求了,说明模型给出了最终回答。
- `break` 退出。
- `messages.append(r.message)` 放回 assistant 消息。
- `if c["function"]["name"] == "get_invoice":` 按名字分流。
- `result = execute_call(c, TOOLS, {"get_invoice": get_invoice})` 发票工具真的执行。
- `result = FAKE_LIST  # 假数据:这个工具今天没有真的实现` 另一个工具回假数据。
- `messages.append({"role": "tool", "tool_call_id": c["id"], "content": result})` 放回 tool 消息。

</div>

```bash
uv run python -m part03.dependent_calls
```

```text
第 1 次请求 finish_reason=tool_calls [('get_invoice', '{"invoice_id": "INV-2026-0042"}')] 
第 2 次请求 finish_reason=tool_calls [('list_invoices_by_customer', '{"customer": "星河科技"}')] 
第 3 次请求 finish_reason=stop       [] INV-2026-0042 的客户是星河科技，该客户共有 2 张发票：  - I
3 次调用 | 输入 1868 / 输出 140 tokens | 约 ¥0.0031
```

三次请求,每次一个:第 1 次提 `get_invoice`,第 2 次(看到客户是「星河科技」之后)提 `list_invoices_by_customer`,第 3 次才回答。**模型自己识别出了先后依赖,把它们拆在了不同的回合。**这是令人放心的一面。我另外用「先建一张工单再数一下」「先数一下、再建一张、最后再数一次」这两句话各试了三次(脚本没放进文章),每次也都只提了一个请求。模型对有顺序的事情比较保守。

但**别因此就不防**。第一,这是 DeepSeek 在温度 0 下的表现,换模型、换提示词、请求写得含糊,它都可能一口气提出有依赖的请求。第二,即使模型没提错,执行端也不知道「这批请求安全不安全」,只有按工具的性质来判断才可靠。

### 想让模型别并行,行不行

既然并行有风险,能不能直接关掉?各家的做法不一样:

- OpenAI:请求参数 `parallel_tool_calls: false`,文档说这样「恰好零个或一个工具被调用」。
- Anthropic:放在 `tool_choice` 里,`{"type": "auto", "disable_parallel_tool_use": true}`,不是顶层参数。
- DeepSeek:我查了聊天补全的接口说明,请求参数里没有 `parallel_tool_calls`。实测一下它怎么反应。新建 `part03/parallel_flags.py`:

```python
# agent-zero-lab/part03/parallel_flags.py
from typing import Any

from common.llm import LLMClient
from part03.weather_tool import WEATHER_TOOL

TOOLS = [WEATHER_TOOL]
client = LLMClient(max_retries=0)
PLAIN = "你是云簿 CloudLedger 的客服助手。回答简短。"
STRICT = PLAIN + "每次回复最多只调用一个工具,等拿到结果再决定下一步。"

variants: list[tuple[str, str, dict[str, Any]]] = [
    ("什么都不加", PLAIN, {}),
    ("parallel_tool_calls=False", PLAIN, {"parallel_tool_calls": False}),
    ("system 里要求一次一个", STRICT, {}),
]
for label, system, kw in variants:
    counts = []
    for _ in range(3):
        msgs = [{"role": "system", "content": system}, {"role": "user", "content": "北京、上海、广州现在各多少度?"}]
        r = client.chat(msgs, tools=TOOLS, temperature=0, max_tokens=300, **kw)
        counts.append(len(r.message.get("tool_calls") or []))
    print(f"{label:28} 三次的请求个数:{counts}")
print(client.ledger)
```

<div class="line-notes">

- `client = LLMClient(max_retries=0)` 不重试,有报错立刻看到。
- `PLAIN = "你是云簿 CloudLedger 的客服助手。回答简短。"` 普通的 system 提示词。
- `STRICT = PLAIN + "每次回复最多只调用一个工具,等拿到结果再决定下一步。"` 在后面加一句要求:一次最多一个。
- `variants: list[tuple[str, str, dict[str, Any]]] = [` 三种做法:什么都不加、传参数、提示词要求。每项是「标签、system、额外参数」。
- `("parallel_tool_calls=False", PLAIN, {"parallel_tool_calls": False}),` 第二种:OpenAI 风格的参数。
- `("system 里要求一次一个", STRICT, {}),` 第三种:用提示词要求。
- `for label, system, kw in variants:` 逐种试。
- `for _ in range(3):` 每种问三次。
- `r = client.chat(msgs, tools=TOOLS, temperature=0, max_tokens=300, **kw)` `**kw` 把额外参数展开传进去,空字典展开就是什么都不传。
- `counts.append(len(r.message.get("tool_calls") or []))` 记下这一次提了几个请求。
- `print(f"{label:28} 三次的请求个数:{counts}")` 每种做法三次的个数。
- `print(client.ledger)` 九次调用的合计。

</div>

```bash
uv run python -m part03.parallel_flags
```

```text
什么都不加                        三次的请求个数:[3, 3, 3]
parallel_tool_calls=False    三次的请求个数:[3, 3, 3]
system 里要求一次一个               三次的请求个数:[3, 3, 3]
9 次调用 | 输入 3564 / 输出 864 tokens | 约 ¥0.0100
```

三种做法,九次,每次都是 3 个请求。**DeepSeek 没有报错,也没有任何提示,悄悄忽略了 `parallel_tool_calls`,提示词里的要求也没起作用。**(温度是 0,所以三次几乎一样,别把它当成统计。)这又是一个静默失败:你以为关掉了,其实没有。

所以要写的代码得**假定模型一定会并行**,在执行端做决定:只读的并发,有副作用的按顺序。再下一层才是「请求端的参数」。换厂商时先查文档、再实测一次,别想当然。

## 第四步:做成一个靠谱的并发执行器

`parallel_min.py` 能用,但还不够靠谱:一个卡住的工具会让整批等下去;请求很多时(比如模型一口气提 20 个)会同时开 20 个线程、20 个连接,可能被对方限流;而 Day 161 说过,失败的请求也必须回一条。把这些加在一起,新建 `part03/async_runner.py`:

```python
# agent-zero-lab/part03/async_runner.py
import asyncio
from collections.abc import Callable
from typing import Any

from part03.tool_runner import FUNCS, execute_call


async def run_one(
    call: dict[str, Any],
    tools: list[dict[str, Any]],
    funcs: dict[str, Callable[..., Any]],
    sem: asyncio.Semaphore,
    timeout: float,
    run: Callable[..., str] = execute_call,
) -> dict[str, Any]:
    """执行一个请求,一定返回一条 tool 消息:成功、失败、超时、意外,都有一条。"""
    async with sem:  # 最多同时跑 limit 个
        try:
            content = await asyncio.wait_for(asyncio.to_thread(run, call, tools, funcs), timeout)
        except TimeoutError:
            content = f"错误:工具执行超过 {timeout:g} 秒,没有拿到结果"
        except Exception as e:  # noqa: BLE001
            content = f"错误:执行时出了意外({type(e).__name__})"
    return {"role": "tool", "tool_call_id": call["id"], "content": content or "(工具没有返回内容)"}


async def run_all(
    calls: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    funcs: dict[str, Callable[..., Any]] = FUNCS,
    limit: int = 4,
    timeout: float = 15.0,
    run: Callable[..., str] = execute_call,
) -> list[dict[str, Any]]:
    """并发执行所有请求,结果顺序和 calls 一致。"""
    sem = asyncio.Semaphore(limit)
    return list(await asyncio.gather(*(run_one(c, tools, funcs, sem, timeout, run) for c in calls)))
```

<div class="line-notes">

- `import asyncio` 事件循环、`wait_for`、`Semaphore`、`gather`。
- `from part03.tool_runner import FUNCS, execute_call` 默认白名单和默认执行函数。
- `async def run_one(` 执行**一个**请求,返回一条 tool 消息。
- `sem: asyncio.Semaphore,` 信号量,控制同时跑几个,Day 68 学过。
- `timeout: float,` 一个请求最多等多少秒。
- `run: Callable[..., str] = execute_call,` 执行函数做成参数,默认是 `execute_call`,测试里换成假的。
- `async with sem:  # 最多同时跑 limit 个` 进来之前先拿一个「名额」,名额用完的请求在这里排队,离开 `with` 时归还。
- `try:` 包住执行。
- `content = await asyncio.wait_for(asyncio.to_thread(run, call, tools, funcs), timeout)` 把同步的 `run` 交给线程,最多等 `timeout` 秒。超时了抛 `TimeoutError`。
- `except TimeoutError:` 超时。Python 3.11 起 `asyncio.TimeoutError` 就是内置的 `TimeoutError`。
- `content = f"错误:工具执行超过 {timeout:g} 秒,没有拿到结果"` `:g` 把 `0.1` 显示成 `0.1`、把 `20.0` 显示成 `20`。超时也回一条,Day 161 的规矩。
- `except Exception as e:  # noqa: BLE001` 执行函数自己出了意外。
- `content = f"错误:执行时出了意外({type(e).__name__})"` 只给类型名。
- `return {"role": "tool", "tool_call_id": call["id"], "content": content or "(工具没有返回内容)"}` 不管走哪条路都到这里,返回一条 tool 消息,内容兜底不空。
- `async def run_all(` 执行**所有**请求。
- `limit: int = 4,` 默认最多同时跑 4 个。
- `timeout: float = 15.0,` 默认每个最多 15 秒。
- `sem = asyncio.Semaphore(limit)` 所有请求共用一个信号量。
- `return list(await asyncio.gather(*(run_one(c, tools, funcs, sem, timeout, run) for c in calls)))` 并发跑所有的,返回列表,顺序和 `calls` 一致。因为 `run_one` 自己吃掉了所有异常,`gather` 不会因为某个失败而整体抛出。

</div>

测试(不联网,用 `sleep` 模拟不同的耗时):

```python
# agent-zero-lab/tests/test_async_runner.py
import asyncio
import time
from typing import Any

from part03.async_runner import run_all
from part03.check_messages import check_messages
from part03.how_it_goes_missing import ASSISTANT, CALLS, FUNCS, START, TOOLS


def sleeper(delays: dict[str, float]) -> Any:
    """造一个假执行函数:按请求 id 睡不同的时间,返回「<id> 完成」。"""

    def run(call: dict[str, Any], tools: list[dict[str, Any]], funcs: Any) -> str:
        time.sleep(delays[call["id"]])
        return f"{call['id']} 完成"

    return run


def test_results_follow_request_order_not_finish_order() -> None:
    run = sleeper({"c1": 0.3, "c2": 0.0, "c3": 0.1})  # c2 最先跑完,c1 最后
    msgs = asyncio.run(run_all(CALLS, TOOLS, FUNCS, run=run))
    assert [m["tool_call_id"] for m in msgs] == ["c1", "c2", "c3"]
    assert [m["content"] for m in msgs] == ["c1 完成", "c2 完成", "c3 完成"]
    assert check_messages([*START, ASSISTANT, *msgs]) == []


def test_runs_concurrently() -> None:
    run = sleeper({"c1": 0.3, "c2": 0.3, "c3": 0.3})
    t = time.perf_counter()
    asyncio.run(run_all(CALLS, TOOLS, FUNCS, run=run))
    assert time.perf_counter() - t < 0.6  # 串行要 0.9 秒


def test_limit_caps_concurrency() -> None:
    run = sleeper({"c1": 0.3, "c2": 0.3, "c3": 0.3})
    t = time.perf_counter()
    asyncio.run(run_all(CALLS, TOOLS, FUNCS, limit=1, run=run))
    assert time.perf_counter() - t >= 0.9  # limit=1 等于串行


def test_timeout_still_answers() -> None:
    run = sleeper({"c1": 0.0, "c2": 0.5, "c3": 0.0})
    msgs = asyncio.run(run_all(CALLS, TOOLS, FUNCS, timeout=0.1, run=run))
    assert msgs[0]["content"] == "c1 完成"
    assert msgs[1]["content"].startswith("错误:工具执行超过 0.1 秒")
    assert msgs[2]["content"] == "c3 完成"
    assert check_messages([*START, ASSISTANT, *msgs]) == []


def test_runner_bug_still_answers() -> None:
    def broken(*_: Any, **__: Any) -> str:
        raise ZeroDivisionError

    msgs = asyncio.run(run_all(CALLS, TOOLS, FUNCS, run=broken))
    assert all(m["content"] == "错误:执行时出了意外(ZeroDivisionError)" for m in msgs)


def test_one_failure_does_not_cancel_the_others() -> None:
    def run(call: dict[str, Any], tools: Any, funcs: Any) -> str:
        if call["id"] == "c2":
            raise RuntimeError("x")
        return "ok"

    msgs = asyncio.run(run_all(CALLS, TOOLS, FUNCS, run=run))
    assert [m["content"] for m in msgs] == ["ok", "错误:执行时出了意外(RuntimeError)", "ok"]
```

<div class="line-notes">

- `import asyncio` 测试里用 `asyncio.run(...)` 跑协程,所以不需要额外的异步测试插件。
- `import time` 计时。
- `from part03.how_it_goes_missing import ASSISTANT, CALLS, FUNCS, START, TOOLS` Day 161 的三请求假数据:c1、c2、c3。
- `def sleeper(delays: dict[str, float]) -> Any:` 造一个假执行函数的工厂:按请求 id 睡不同的时间。
- `def run(call: dict[str, Any], tools: list[dict[str, Any]], funcs: Any) -> str:` 内部函数,签名和 `execute_call` 一样。
- `time.sleep(delays[call["id"]])` 按 id 查表睡觉:`{"c1": 0.3, ...}`。
- `return f"{call['id']} 完成"` 返回「c1 完成」这样的字符串,看得出是谁。
- `run = sleeper({"c1": 0.3, "c2": 0.0, "c3": 0.1})  # c2 最先跑完,c1 最后` c2 立刻完成,c3 其次,c1 最慢,完成顺序是 c2、c3、c1。
- `assert [m["tool_call_id"] for m in msgs] == ["c1", "c2", "c3"]` 返回的消息顺序仍然是请求顺序,不是完成顺序。
- `assert check_messages([*START, ASSISTANT, *msgs]) == []` 拼成完整历史能通过 Day 159 的检查。
- `assert time.perf_counter() - t < 0.6  # 串行要 0.9 秒` 三个各 0.3 秒,并发应该只要 0.3 秒左右,放宽到 0.6 秒防止机器忙时误报。
- `asyncio.run(run_all(CALLS, TOOLS, FUNCS, limit=1, run=run))` `limit=1`:一次只许一个,等于串行。
- `assert time.perf_counter() - t >= 0.9  # limit=1 等于串行` 至少 0.9 秒。
- `run = sleeper({"c1": 0.0, "c2": 0.5, "c3": 0.0})` c2 要 0.5 秒,但超时只给 0.1 秒。
- `msgs = asyncio.run(run_all(CALLS, TOOLS, FUNCS, timeout=0.1, run=run))` 超时设成 0.1。
- `assert msgs[1]["content"].startswith("错误:工具执行超过 0.1 秒")` 超时的那个有回应,内容是错误说明。
- `assert msgs[2]["content"] == "c3 完成"` 别的请求不受影响。
- `def broken(*_: Any, **__: Any) -> str:` 一个一调用就抛异常的假执行函数。
- `raise ZeroDivisionError` 随便一个异常。
- `assert all(m["content"] == "错误:执行时出了意外(ZeroDivisionError)" for m in msgs)` 三个请求都回了一句话。
- `if call["id"] == "c2":` 只让 c2 失败。
- `assert [m["content"] for m in msgs] == ["ok", "错误:执行时出了意外(RuntimeError)", "ok"]` 一个失败不影响其他两个,更不会取消它们。

</div>

```bash
uv run pytest -q tests/test_async_runner.py
```

```text
......                                                                   [100%]
6 passed in 2.17s
```

六个通过。再用真的模型走一遍,故意让其中一个城市是不存在的「火星城」,并发上限设成 2。新建 `part03/parallel_full.py`:

```python
# agent-zero-lab/part03/parallel_full.py
import asyncio
import time
from typing import Any

from common.llm import LLMClient
from part03.async_runner import run_all
from part03.check_messages import check_messages
from part03.weather_tool import WEATHER_TOOL

TOOLS = [WEATHER_TOOL]


async def main() -> None:
    client = LLMClient()
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": "你是云簿 CloudLedger 的客服助手。回答简短。"},
        {"role": "user", "content": "北京、上海、火星城、广州现在各多少度?"},
    ]
    first = client.chat(messages, tools=TOOLS, temperature=0, max_tokens=300)
    calls = first.message.get("tool_calls") or []
    print(f"模型一次提了 {len(calls)} 个请求")

    t = time.perf_counter()
    tool_msgs = await run_all(calls, TOOLS, limit=2, timeout=20)
    print(f"limit=2 并发执行,用时 {time.perf_counter() - t:.2f}s")
    for call, m in zip(calls, tool_msgs):
        print(f"  {call['function']['arguments']:18} -> {m['content'][:56]}")

    messages.extend([first.message, *tool_msgs])
    print("发第二次请求之前的本地检查:", check_messages(messages) or "没发现问题")
    second = client.chat(messages, tools=TOOLS, temperature=0, max_tokens=300)
    print("回答:", second.content.replace("\n", " "))
    print(client.ledger)


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `from part03.async_runner import run_all` 刚写的执行器。
- `{"role": "user", "content": "北京、上海、火星城、广州现在各多少度?"}` 四个城市,其中一个不存在。
- `print(f"模型一次提了 {len(calls)} 个请求")` 实测 4 个。
- `tool_msgs = await run_all(calls, TOOLS, limit=2, timeout=20)` 最多同时跑 2 个,每个最多 20 秒。4 个请求分两批,总时间大约是两个单次请求的时间。
- `print(f"limit=2 并发执行,用时 {time.perf_counter() - t:.2f}s")` 实测 5.87 秒,约等于 2 批各 2.9 秒。
- `for call, m in zip(calls, tool_msgs):` 请求和回应一一对应。
- `print(f"  {call['function']['arguments']:18} -> {m['content'][:56]}")` 参数左对齐占 18 位,后面是回应的前 56 个字。
- `messages.extend([first.message, *tool_msgs])` 一次性放回 assistant 消息和四条 tool 消息。
- `print("发第二次请求之前的本地检查:", check_messages(messages) or "没发现问题")` 请求 2 之前的最后一道关。
- `print("回答:", second.content.replace("\n", " "))` 实测火星城那一项说「查不到这个城市,请确认名称是否正确」,其余三个照常报温度。

</div>

```bash
uv run python -m part03.parallel_full
```

```text
模型一次提了 4 个请求
limit=2 并发执行,用时 5.87s
  {"city": "北京"}     -> {"city": "北京", "country": "中国", "temperature": 13.6, "un
  {"city": "上海"}     -> {"city": "上海", "country": "中国", "temperature": 22.0, "un
  {"city": "火星城"}    -> 错误:找不到叫 '火星城' 的城市,请换个写法
  {"city": "广州"}     -> {"city": "广州", "country": "中国", "temperature": 28.9, "un
发第二次请求之前的本地检查: 没发现问题
回答: 当前气温：  - 北京：13.6°C，晴 - 上海：22.0°C，小毛毛雨（出门带伞） - 广州：28.9°C，晴 - 火星城：查不到这个城市，请确认名称是否正确
2 次调用 | 输入 1095 / 输出 185 tokens | 约 ¥0.0024
```

四个请求都得到了回应:三个有数据,火星城是「错误:找不到叫 '火星城' 的城市,请换个写法」(Day 158 里的那句人话)。顺序和请求一致,本地检查通过。回答里三个城市照实报,火星城如实说查不到。`limit=2` 让总时间变成约 5.9 秒(两批各 2.9 秒),如果不限制就是约 3 秒,是拿时间换对第三方服务的礼貌。限多少看对方的限流规则,Open-Meteo 对免费用户没有这么严,这里设 2 只是为了让你看到效果。

### 零件对照

| 概念 | 今天的文件 | 以后哪天用 |
| --- | --- | --- |
| 一条回复里多个请求 | `parallel_min.py` 的 `calls` | [Day 166](/blog/agent-zero/day-166-agent-min/) 循环的每一圈 |
| 同步函数交给线程 | `thread_demo.py`、`asyncio.to_thread` | 所有同步的工具函数(数据库、HTTP) |
| 每个请求必回 + 超时 + 限并发 | `async_runner.py` 的 `run_all` | [Day 168](/blog/agent-zero/day-168-tool-registry-1/) 的工具注册表 |
| 有副作用按顺序 | `parallel_race.py`、练习 2 | 第七部分的幂等和审批 |
| 依赖的请求模型自己拆 | `dependent_calls.py` | Day 166 的多步循环 |

## 动手练习

三道题。练习 1 联网查天气(不调模型,不花钱),练习 2、3 不联网。

**练习 1:快多少?** 不调模型,直接造 1、3、5 个城市的请求,各量一次串行和并发的用时。`gather` 开 5 个线程,会快 5 倍吗?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex162_scale.py
import asyncio
import time
from typing import Any

from part03.review160_check import call_of
from part03.tool_runner import execute_call
from part03.weather_tool import WEATHER_TOOL

TOOLS = [WEATHER_TOOL]
CITIES = ["北京", "上海", "广州", "深圳", "成都"]


def calls_for(n: int) -> list[dict[str, Any]]:
    return [call_of(f'{{"city": "{c}"}}', name="get_weather", cid=f"c{i}") for i, c in enumerate(CITIES[:n], start=1)]


async def parallel(calls: list[dict[str, Any]]) -> None:
    await asyncio.gather(*(asyncio.to_thread(execute_call, c, TOOLS) for c in calls))


for n in (1, 3, 5):
    calls = calls_for(n)
    t = time.perf_counter()
    for c in calls:
        execute_call(c, TOOLS)
    serial = time.perf_counter() - t
    t = time.perf_counter()
    asyncio.run(parallel(calls))
    par = time.perf_counter() - t
    print(f"{n} 个城市:串行 {serial:5.2f}s  并发 {par:5.2f}s  快了 {serial / par:.1f} 倍")
```

<div class="line-notes">

- `import asyncio` 并发。
- `from part03.review160_check import call_of` 造请求的小函数。
- `CITIES = ["北京", "上海", "广州", "深圳", "成都"]` 五个城市。
- `def calls_for(n: int) -> list[dict[str, Any]]:` 造前 n 个城市的请求。
- `return [call_of(f'{{"city": "{c}"}}', name="get_weather", cid=f"c{i}") for i, c in enumerate(CITIES[:n], start=1)]` `f'{{"city": "{c}"}}'` 里的 `{{` 输出一个字面的 `{`,拼出 `{"city": "北京"}`。`enumerate(..., start=1)` 让 id 从 `c1` 开始。
- `async def parallel(calls: list[dict[str, Any]]) -> None:` 并发版,不要返回值,只量时间。
- `await asyncio.gather(*(asyncio.to_thread(execute_call, c, TOOLS) for c in calls))` 同第二步。
- `for n in (1, 3, 5):` 三种规模。
- `for c in calls:` 先串行。
- `execute_call(c, TOOLS)` 结果丢掉。
- `serial = time.perf_counter() - t` 串行用时。
- `asyncio.run(parallel(calls))` 每次新开一个事件循环跑并发版。
- `print(f"{n} 个城市:串行 {serial:5.2f}s  并发 {par:5.2f}s  快了 {serial / par:.1f} 倍")` `:5.2f` 总宽 5 位、两位小数,对齐用。

</div>

```bash
uv run python -m part03.ex162_scale
```

```text
1 个城市:串行  2.83s  并发  2.83s  快了 1.0 倍
3 个城市:串行  8.45s  并发  2.86s  快了 3.0 倍
5 个城市:串行 14.04s  并发  2.92s  快了 4.8 倍
```

1 个城市没有区别(1.0 倍,没有可重叠的东西)。3 个城市 3.0 倍,5 个城市 4.8 倍:不是正好 5 倍,因为总时间等于最慢的那一个,而五个请求里总有一个稍慢。我第一次运行时 5 个城市只快了 1.8 倍,那次是网络慢了一阵,重跑两次都是 4.8 到 5.0 倍。所以**别拿一次测量下结论**,网络类的耗时波动很大。

</details>

**练习 2:有副作用按顺序,只读才并发。** 写 `run_safely(calls, tools, funcs, read_only)`:所有请求都在 `read_only` 名单里就并发执行;只要有一个不在,整批按请求顺序一个一个执行。注意名单里没有的名字(包括模型编造的)一律当作有副作用。用 `parallel_race.py` 里的假工单表写四个测试。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex162_mixed.py
import asyncio
from collections.abc import Callable
from typing import Any

from part03.tool_runner import execute_call

READ_ONLY = {"get_weather", "get_invoice", "count_tickets"}  # 只读的工具名;其余一律当有副作用


async def run_safely(
    calls: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    funcs: dict[str, Callable[..., Any]],
    read_only: set[str] = READ_ONLY,
) -> list[dict[str, Any]]:
    """全是只读的就并发;只要有一个可能有副作用,整批按请求的顺序一个一个执行。"""
    if all(c["function"]["name"] in read_only for c in calls):
        contents = await asyncio.gather(*(asyncio.to_thread(execute_call, c, tools, funcs) for c in calls))
    else:
        contents = [execute_call(c, tools, funcs) for c in calls]
    return [{"role": "tool", "tool_call_id": c["id"], "content": s} for c, s in zip(calls, contents)]
```

<div class="line-notes">

- `READ_ONLY = {"get_weather", "get_invoice", "count_tickets"}  # 只读的工具名;其余一律当有副作用` 一个集合,写的是「确认只读」的名字。反过来写(列出有副作用的)会漏掉新加的工具,默认当有副作用更安全。
- `read_only: set[str] = READ_ONLY,` 参数,测试里可以换成别的名单。
- `if all(c["function"]["name"] in read_only for c in calls):` 每个请求的函数名都在只读名单里,才并发。`all` 遇到第一个 `False` 就停。
- `contents = await asyncio.gather(*(asyncio.to_thread(execute_call, c, tools, funcs) for c in calls))` 并发分支。
- `contents = [execute_call(c, tools, funcs) for c in calls]` 否则按请求顺序一个一个来。这里没有 `await`,同步地执行,在 `async def` 里会卡住事件循环,但这个函数本来就是「这一批只能一个一个来」,卡住没关系。
- `return [{"role": "tool", "tool_call_id": c["id"], "content": s} for c, s in zip(calls, contents)]` 两个分支都得到按请求顺序排好的结果字符串列表,统一拼成 tool 消息。

</div>

测试:

```python
# agent-zero-lab/tests/test_ex162_mixed.py
import asyncio
import json
import time
from typing import Any

from part03.ex162_mixed import run_safely
from part03.parallel_race import CALLS, TOOLS, make_funcs
from part03.review160_check import call_of


def counts(msgs: list[dict[str, Any]]) -> dict[str, Any]:
    return json.loads(msgs[-1]["content"])


def test_create_then_count_is_sequential() -> None:
    msgs = asyncio.run(run_safely(CALLS, TOOLS, make_funcs()))
    assert counts(msgs) == {"count": 1}  # 并发执行时这里是 0
    assert [m["tool_call_id"] for m in msgs] == ["c1", "c2"]


def test_all_read_only_still_runs_concurrently() -> None:
    funcs = make_funcs()
    calls = [call_of("{}", name="count_tickets", cid=f"r{i}") for i in range(3)]
    t = time.perf_counter()
    msgs = asyncio.run(run_safely(calls, TOOLS, funcs))
    assert len(msgs) == 3
    assert time.perf_counter() - t < 0.5


def test_unknown_name_counts_as_unsafe() -> None:
    funcs = make_funcs()
    msgs = asyncio.run(run_safely([call_of("{}", name="mystery", cid="m1")], TOOLS, funcs))
    assert msgs[0]["content"].startswith("错误:没有叫 'mystery'")


def test_write_after_read_keeps_the_order() -> None:
    funcs = make_funcs()
    calls = [call_of("{}", name="count_tickets", cid="a"), CALLS[0], call_of("{}", name="count_tickets", cid="b")]
    msgs = asyncio.run(run_safely(calls, TOOLS, funcs))
    assert [json.loads(m["content"]) for m in msgs] == [{"count": 0}, {"created": "打印机坏了"}, {"count": 1}]
```

<div class="line-notes">

- `from part03.ex162_mixed import run_safely` 被测对象。
- `from part03.parallel_race import CALLS, TOOLS, make_funcs` 复用上面的两个工具和假工单表。`CALLS[0]` 是建工单,`CALLS[1]` 是数工单。
- `def counts(msgs: list[dict[str, Any]]) -> dict[str, Any]:` 取最后一条消息的内容并解析成字典。
- `assert counts(msgs) == {"count": 1}  # 并发执行时这里是 0` 建了再数,必须数到 1。
- `assert [m["tool_call_id"] for m in msgs] == ["c1", "c2"]` 回应的顺序和请求一致。
- `calls = [call_of("{}", name="count_tickets", cid=f"r{i}") for i in range(3)]` 三个都是只读请求,id 是 r0、r1、r2。
- `assert time.perf_counter() - t < 0.5` 只读的并发(这里的 count 本来就很快,主要是确认走通了)。
- `msgs = asyncio.run(run_safely([call_of("{}", name="mystery", cid="m1")], TOOLS, funcs))` 一个不在名单里的名字。
- `assert msgs[0]["content"].startswith("错误:没有叫 'mystery'")` 走顺序分支,`execute_call` 第一道关拒绝,仍然回了一条。
- `calls = [call_of("{}", name="count_tickets", cid="a"), CALLS[0], call_of("{}", name="count_tickets", cid="b")]` 读、写、读三个请求。
- `assert [json.loads(m["content"]) for m in msgs] == [{"count": 0}, {"created": "打印机坏了"}, {"count": 1}]` 按顺序执行:第一次数是 0,然后建,第二次数是 1。

</div>

```bash
uv run pytest -q tests/test_ex162_mixed.py
```

```text
....                                                                     [100%]
4 passed in 0.53s
```

四个通过。最后一个测试说明了为什么是「整批顺序」而不是「写的顺序、读的并发」:读-写-读三个请求里,两个读的结果**不一样**(0 和 1),如果把读都提到前面并发,第二个读就变成 0 了,和模型「想」的顺序不符。更精细的做法(分析哪些读和哪些写有冲突)收益不大、风险不小,先用保守的。

</details>

**练习 3:超时了,线程还在跑。** 用 `async_runner.run_all` 跑一个卡住 2 秒的工具,超时设成 0.2 秒。量两个时间:`run_all` 多久返回?整个 `asyncio.run` 多久退出?结果会让你意外。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex162_timeout.py
import asyncio
import time
from typing import Any

from part03.async_runner import run_all
from part03.how_it_goes_missing import CALLS, FUNCS, TOOLS


def stuck(call: dict[str, Any], tools: Any, funcs: Any) -> str:
    time.sleep(2.0)  # 一个卡住的工具:同步地睡 2 秒
    return "终于完成了"


async def main(t0: float) -> None:
    msgs = await run_all(CALLS[:1], TOOLS, FUNCS, timeout=0.2, run=stuck)
    print(f"run_all 返回了,用时 {time.perf_counter() - t0:.2f}s,回应:{msgs[0]['content']}")


t0 = time.perf_counter()
asyncio.run(main(t0))
print(f"asyncio.run 退出,用时 {time.perf_counter() - t0:.2f}s")
```

<div class="line-notes">

- `def stuck(call: dict[str, Any], tools: Any, funcs: Any) -> str:` 一个卡住的假工具。
- `time.sleep(2.0)  # 一个卡住的工具:同步地睡 2 秒` 模拟一个网络卡死的函数。
- `return "终于完成了"` 睡完才返回,但这个返回值没人会要了。
- `async def main(t0: float) -> None:` 接收全局起点,好在里面打印自启动起的时间。
- `msgs = await run_all(CALLS[:1], TOOLS, FUNCS, timeout=0.2, run=stuck)` 只跑一个请求,超时 0.2 秒。
- `print(f"run_all 返回了,用时 {time.perf_counter() - t0:.2f}s,回应:{msgs[0]['content']}")` 实测 0.20 秒,回应是「错误:工具执行超过 0.2 秒,没有拿到结果」。从 `run_all` 的角度看,事情在 0.2 秒时就办完了。
- `asyncio.run(main(t0))` 跑 `main`。
- `print(f"asyncio.run 退出,用时 {time.perf_counter() - t0:.2f}s")` 实测 **2.01 秒**。

</div>

```bash
uv run python -m part03.ex162_timeout
```

```text
run_all 返回了,用时 0.20s,回应:错误:工具执行超过 0.2 秒,没有拿到结果
asyncio.run 退出,用时 2.01s
```

`run_all` 0.2 秒就返回了,可是整个程序到 2.01 秒才退出。原因:`wait_for` 超时只是「不再等」,它**没办法杀掉那个线程**。Python 的线程不能从外面强行终止,线程会一直把 `time.sleep(2.0)` 睡完,而 `asyncio.run` 退出时要等默认的线程池收工,于是多等了 1.8 秒。

这件事的教训有两层。第一,对话这一边不受影响:用户在 0.2 秒时已经拿到「超时」的回应,模型可以继续,卡住的线程在后台自己结束。长期运行的服务里这没问题,但**每一次超时都在后台留下一个还在跑的线程**,如果工具永远卡住(比如没有设超时的网络请求),线程会越攒越多,默认线程池满了以后连正常的请求也会排队。第二,真正的超时要**设在工具内部**:`get_weather` 里的 `timeout=10.0` 就是 `httpx` 自己在 10 秒时放弃并抛异常,线程才会真的结束。外面这一层 `wait_for` 是最后的保险,不是主要手段。要能强行终止的隔离(比如执行不可信的代码),要用子进程,那是第七部分「沙箱」的内容。

</details>

**验收标准:** 能不看文章画出串行和并发的时间线,并说出「并发的总时间约等于最慢的那个」;能说出 `thread_demo.py` 四种写法各自的用时和原因;能解释为什么有副作用的请求不该并发,并写出判断规则;知道 DeepSeek 上关不掉并行,以及换厂商时的两种写法;`tests/test_async_runner.py`(6 个)和 `tests/test_ex162_mixed.py`(4 个)全部通过。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 并行工具调用(parallel tool calls) | 模型在一条回复里写出多个 `tool_calls`,表示这些请求互不依赖。是模型的「建议」,执行是我们的事 |
| 并发(concurrency) | 多件事在时间上重叠地进行。工具调用主要是等网络,重叠起来总时间约等于最慢的那一个 |
| 事件循环(event loop) | asyncio 的调度器:一个线程里轮流跑协程,协程在 `await` 的地方让出控制权 |
| 阻塞(blocking) | 一个函数占住线程不放,期间其他协程都动不了。`async def` 里调同步的 `time.sleep`、`httpx.get` 就是 |
| `asyncio.to_thread` | 把同步函数交给线程池里的另一个线程去跑,协程 `await` 它的结果。写法是 `to_thread(函数, 参数)` |
| 线程池 | 一批提前开好的线程,任务来了领一个去做。`to_thread` 用的是 asyncio 的默认线程池 |
| `asyncio.wait_for` | 给一个 `await` 加上限时,超时抛 `TimeoutError`。它只是不再等,**不会终止**线程里的函数 |
| 竞态(race condition) | 两个操作的先后顺序不确定,结果取决于谁快。并发执行「建工单」和「数工单」读到 0 张就是 |
| 副作用(side effect) | 函数除了返回值还改变了外部世界:写库、发邮件、扣款。只读的函数没有副作用 |
| 限并发 | 用 `Semaphore` 限制同时进行的个数,避免一次打开几十个连接被对方限流 |

## 常见误区

**以为 `async def` 里什么都能并发。** 里面调同步函数(`time.sleep`、`httpx.get`、`requests.get`、读文件)会卡住整条事件循环,实测 1.50 秒和串行一样。同步函数要用 `to_thread`,或者换成真正的异步库(`httpx.AsyncClient`)。

**写成 `to_thread(get_weather(city))`。** 这是先在当前线程执行完,再把结果当函数传给 `to_thread`,既没有并发,还会报错。正确写法是函数和参数分开传:`to_thread(get_weather, city)`。

**以为 `gather` 按完成顺序返回。** 它按传入顺序返回,和谁先跑完无关。所以 `zip(calls, results)` 对号是安全的。

**不管有没有副作用都并发。** 建工单和数工单并发执行,读到 0 张。有副作用的请求按顺序执行,默认当有副作用,确认只读才并发。

**以为请求「互不依赖」是模型保证的。** 它只是模型的判断。实测它对有依赖的情形比较保守(拆成三次请求),但这不是承诺,别的模型、别的写法可能一口气提出有依赖的请求。

**以为 `parallel_tool_calls=False` 在所有厂商都有效。** OpenAI 有这个参数;Anthropic 是 `tool_choice` 里的 `disable_parallel_tool_use`;DeepSeek 的接口说明里没有它,实测传了不报错,也不起作用,提示词里要求「一次只调一个」同样没用。静默失败,换厂商要实测。

**只靠 `wait_for` 做超时。** 它只是不再等,线程还在后台跑到结束(实测 0.2 秒返回,2.01 秒才退出)。真正的超时要设在工具内部,比如 `httpx` 的 `timeout=`。

**不限并发。** 模型一口气提 20 个请求,不加限制就同时开 20 个线程、打 20 个连接。用 `Semaphore` 限制,数值看对方的限流规则。

**超时或失败的请求不回应。** Day 161 的规矩在并发里一样成立:每个请求都要有一条回应,超时也是,内容写「错误:…超过 N 秒」。`run_one` 里所有路径都 `return` 一条消息。

## 学习资料

### 文档与文章

- [Anthropic 文档:Parallel tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/parallel-tool-use):英文,专门讲一次多个工具调用:怎么执行(并发、顺序都行)、怎么回传、怎么关掉(`disable_parallel_tool_use`)。里面有一句和 Day 161 呼应:选择不运行某个调用时,仍要为它返回结果并标记错误。
- [OpenAI 文档:Function calling](https://developers.openai.com/api/docs/guides/function-calling):英文,找「Parallel function calls」那一节,有 `parallel_tool_calls` 参数的说明和限制。文档建议代码里「假设会有多个调用」。
- [DeepSeek 文档:Tool Calls](https://api-docs.deepseek.com/zh-cn/guides/tool_calls):中文,今天实验的服务端。接口说明里没有 `parallel_tool_calls`。
- [Python 文档:协程与任务](https://docs.python.org/zh-cn/3.12/library/asyncio-task.html):中文,页面很长,搜 `gather`、`to_thread`、`wait_for` 三个标题,各看开头的说明。
- [Python 文档:同步原语](https://docs.python.org/zh-cn/3.12/library/asyncio-sync.html):中文,搜 `Semaphore`。
- [MDN:Promise.all](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Promise/all) 和 [Promise.allSettled](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled):中文,前端熟悉的对照物。`gather` 默认像 `all`(一个失败整体失败),加 `return_exceptions=True` 像 `allSettled`。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1G3ERzuEpe&autoplay=0&high_quality=1" title="3.Function Calling并行调用与强制调用" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>码农野蛮生长 · 3.Function Calling并行调用与强制调用 · 10 分 59 秒,2025 年 5 月。标题里的前半是今天,后半是明天的 `tool_choice`。我只核对了标题和时长,没有逐帧看,看的时候对照今天的时间线图。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1sZKf6FErp&autoplay=0&high_quality=1" title="大厂一面 当一个 Agent 同时需要调用几十个 Tool 时,如何设计 Parallel Tool Calling 并行工具调用系统?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>龙哥搞算法 · 大厂一面:当一个 Agent 同时需要调用几十个 Tool 时,如何设计 Parallel Tool Calling 并行工具调用系统? · 1 分 43 秒,2026 年 7 月。面试口径的短视频,看它有没有讲到限并发、超时、有依赖的情况,对照今天的执行器。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Qb9s3UiMSTA" title="Asyncio in Python - Full Tutorial" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Tech With Tim · Asyncio in Python - Full Tutorial · 英文。复习 Day 66 到 68 的 asyncio,尤其是「为什么 async 里不能有阻塞调用」。按标题选的,我没有逐帧看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/dg_v2IGKiM8" title="Python asyncio Explained: Event Loop, Coroutines, await and Tasks" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Zero 2 Concept · Python asyncio Explained: Event Loop, Coroutines, await and Tasks · 英文,带图示讲事件循环怎么在协程之间切换,帮你理解今天第 3 种写法为什么没变快。按标题选的,我没有逐帧看。</figcaption>
</figure>

### 书籍

今天这组不需要。

### 开源项目与代码

- [anthropics/anthropic-sdk-python](https://github.com/anthropics/anthropic-sdk-python):Claude 的 Python SDK,它的 Tool Runner 里能看到官方是怎么处理一次多个请求的。
- [openai/openai-python](https://github.com/openai/openai-python):我们用的 SDK,仓库里有异步客户端 `AsyncOpenAI` 的例子,后面做服务时会用。

## 自测

1. 「并行工具调用」是模型在并行执行吗?

<details><summary>答案</summary>

不是。模型只是在一条回复里写了多个请求,表示它认为这些请求互不依赖。执行是我们的代码做的,并发还是顺序是我们的决定。

</details>

2. 在 `async def` 里调同步的 `time.sleep(0.5)`,三个一起 `gather`,为什么是 1.5 秒而不是 0.5 秒?怎么改?

<details><summary>答案</summary>

事件循环是单线程轮流跑协程,协程只有在 `await` 的地方才会让出控制权。同步的 `time.sleep` 没有 `await`,第一个协程占住线程睡 0.5 秒,其他的要等它跑完才有机会,所以一个接一个。改成 `await asyncio.to_thread(slow_sync, i)`,把同步函数交给线程池,或者换成真正的异步函数。

</details>

3. `to_thread(f(x))` 和 `to_thread(f, x)` 有什么区别?

<details><summary>答案</summary>

前者先在当前线程把 `f(x)` 同步执行完,再把结果(通常不是函数)传给 `to_thread`,既不并发,还会报错;后者把函数和参数分开传,由线程池里的线程去调用。

</details>

4. 模型一次提了「建工单」和「数工单」两个请求,并发执行为什么可能出错?规则是什么?

<details><summary>答案</summary>

数工单可能在建工单写完之前就读完了,返回旧数据(实测 0 而不是 1),结果没有报错但是错的,叫竞态。规则:有副作用的工具按请求顺序执行,只有确认只读的才并发;名单里没有的名字一律当有副作用。更保守的是「只要这批里有一个有副作用,整批按顺序」。

</details>

5. 面试题:「Agent 一次要调很多工具,怎么设计并发执行?要考虑哪些问题?」

<details><summary>答案</summary>

用线程池或异步并发执行互不依赖的只读调用,总时间约等于最慢的一个;按 `tool_call_id` 对号返回,不依赖完成顺序;有副作用或有依赖的按顺序执行,默认当有副作用,确认只读才并发;限并发(信号量)避免打爆下游和被限流;每个调用设超时,并且超时设在工具内部,外层的 `wait_for` 只是兜底,因为线程杀不掉;每个请求无论成功、失败、超时都必须回一条 tool 消息,否则下一次请求就是 400;模型的并行不一定能关掉(DeepSeek 实测忽略 `parallel_tool_calls`),所以控制放在执行端。

</details>

6. 面试题:「你在 OpenAI 上用 `parallel_tool_calls=false` 关掉了并行,换到另一个模型厂商后行为变了,怎么排查?」

<details><summary>答案</summary>

先查新厂商的接口文档有没有这个参数、叫什么名字、放在哪(Anthropic 放在 `tool_choice` 里),再实测:记录同一个问题下每次回复的 `tool_calls` 个数。DeepSeek 的例子是传了不报错但完全不起作用,提示词里要求也不起作用。所以不要依赖请求端的开关,在执行端按工具的性质(只读、有副作用、有依赖)决定怎么执行,换模型也不会出事。

</details>

## 明天预告

Day 163 · tool_choice 和思考模式的坑。今天我们看到:想让模型「别并行」,DeepSeek 上没有现成的开关。明天看另一个控制模型用不用工具的参数:`tool_choice`,它有 `auto`(默认,让模型自己决定)、`none`(这一轮不许调)、`required`(必须调一个),还可以指定一个具体的函数。我们会逐个实测,特别是 DeepSeek 开着思考模式时强制调用会返回 400 的那个坑,以及 `tool_choice` 能不能当「结构化输出」用。
