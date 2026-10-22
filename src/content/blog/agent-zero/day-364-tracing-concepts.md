---
title: 'Day 364 · Tracing(一):trace、span 和概念对齐'
description: '前三天评的轨迹和对话,都是我们在 Agent 代码里手工攒进 JSON 的,只有工具名、参数和 token,不知道每一步花了多久、谁在谁里面。今天从 DevTools 的瀑布图讲起,手写一个二十几行的 span 记录器,套在工单 Agent 上实跑:一张工单 3.6 秒,模型占了几乎全部,工具调用加起来不到 3 毫秒;再从 trace 里切出轨迹,Day 361 的越权检查照样能用。最后把 trace、span、session、score 和 OpenTelemetry、Langfuse、LangSmith 里的叫法一一对上。'
pubDate: 2026-10-22
regime: none
tags: ['observability', 'tracing', 'agent-zero']
series: 'agent-zero'
day: 364
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 363](/blog/agent-zero/day-363-week52-review/) 复习了这一周的评测:一次 Agent 运行留下三样东西,数据库终态、工具调用轨迹、说的话,分别用结果评测、轨迹检查和 LLM 评分器来判。小项目给 Day 362 的 14 段多轮对话出了一份报告,还踩到了 Day 361 预言过的 `2392` 和 `2392.0` 那个坑。

这几天评的东西,全是我们在 Agent 代码里手工攒的:`traj_agent.py` 里一行 `tool_calls.append(...)` 记工具调用,`tokens` 字典记 token,跑完存成 JSON。够评测用,可只要你问一句「这张工单为什么跑了 5 秒」,这些 JSON 就答不上来:它不知道每一步花了多久,也不知道哪一步发生在哪一步里面。线上出了问题要排查,靠的是另一套东西,叫 **tracing**(链路追踪)。从今天开始的四天讲它,今天先把概念对齐,用一个自己手写的二十几行小工具把概念跑出来。

## 今天要解决的问题

学完今天你应该能:

1. 说清楚 **trace** 和 **span** 是什么:一个 span 有哪几样东西(编号、父编号、名字、开始结束时间、属性),一堆 span 怎么靠父编号拼成一棵树,同一棵树的 span 共用一个 trace 编号。
2. 用 `contextlib.contextmanager` 写一个最小的 span 记录器,套在 Day 360 的工单 Agent 上实跑,画出瀑布图,读出时间和 token 花在哪。
3. 说清楚 trace 和 Day 360 的轨迹是什么关系:从 trace 里切出轨迹,Day 361 的检查照样能用。
4. 把 trace、span、session、user、score 这几个词,和 OpenTelemetry、Langfuse、LangSmith 里的叫法对上,明天接 Langfuse 时看到界面上的词不发懵。

今天两个新概念:**trace** 和 **span**。session、user、score 这些不算新概念,它们是挂在 trace 上的标签和评分,对齐表里一句话带过。

预计用时 2.5 小时。实跑调了 3 次 Agent(两张单轮工单、一段两轮对话),合计约 0.04 元,算式在第二步和练习 3 末尾。前置:[Day 98](/blog/agent-zero/day-098-context-managers/) 的上下文管理器和 `contextlib`;[Day 99](/blog/agent-zero/day-099-generators/) 的 `yield`;[Day 360](/blog/agent-zero/day-360-trajectory-1/) 的 `part06/traj_agent.py`;[Day 361](/blog/agent-zero/day-361-trajectory-2/) 的 `part06/trajectory.py`;[Day 362](/blog/agent-zero/day-362-simulated-user/) 的 `part06/agent_session.py`(练习 3 用)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章把 `Tracer.span()` 默写出来,再说一遍 trace 和 span 的区别;做练习时先自己写,做不出再展开参考答案,看完关掉重写一遍。

## 从你见过的瀑布图讲起

打开任何一个网页,F12,切到 Network 面板,刷新。右边那一列 Waterfall,每个请求一根横条:从左边哪里开始,说明它什么时候发出去;条有多长,说明它花了多久。你一眼能看出来哪个接口最慢、哪几个请求是同时发的、哪个请求要等另一个回来才发。这张图你肯定看过很多次。

再切到 Performance 面板录一段,下面那个火焰图更进一步:一个长条 `click` 事件下面嵌着 `handleSubmit`,`handleSubmit` 下面又嵌着 `fetch` 和 `setState`。横向是时间,纵向是谁在谁里面。

后端的 tracing,画出来就是这两张图的合体:横向是时间,纵向是调用关系。只不过记录的不是浏览器里的事件,是服务端处理一个请求时做的每一步。对 Agent 来说,就是一次运行里每一次调模型、每一次调工具。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="今天实跑的 C007 工单的 trace 瀑布图:根 span 3592 毫秒,下面三次调模型各一秒多,三次工具调用都不到 2 毫秒">
<rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="11">
<text x="16" y="22" fill="var(--ink-soft)">trace 0787a484… · C007 重复扣款工单 · 今天实跑</text>
<text x="560" y="22" fill="var(--ink-faint)">时间 →</text>
<rect x="200" y="36" width="420" height="22" fill="none" stroke="var(--ink-soft)"/>
<text x="16" y="51" fill="var(--ink)">invoke_agent ticket</text>
<text x="604" y="51" fill="var(--ink-soft)" text-anchor="end">3592 ms</text>
<rect x="200" y="66" width="142" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="28" y="80" fill="var(--ink)">chat deepseek-flash</text>
<text x="348" y="80" fill="var(--ink-soft)">1216 ms · 输入 669</text>
<rect x="342" y="94" width="3" height="20" fill="var(--compute)"/>
<text x="28" y="108" fill="var(--ink)">execute_tool get_sub…</text>
<text x="352" y="108" fill="var(--ink-soft)">1 ms</text>
<rect x="343" y="122" width="3" height="20" fill="var(--compute)"/>
<text x="28" y="136" fill="var(--ink)">execute_tool list_inv…</text>
<text x="352" y="136" fill="var(--ink-soft)">0 ms</text>
<rect x="345" y="150" width="150" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="28" y="164" fill="var(--ink)">chat deepseek-flash</text>
<text x="500" y="164" fill="var(--ink-soft)">1284 ms · 输入 1083</text>
<rect x="495" y="178" width="3" height="20" fill="var(--compute)"/>
<text x="28" y="192" fill="var(--ink)">execute_tool refund</text>
<text x="504" y="192" fill="var(--ink-soft)">1 ms</text>
<rect x="497" y="206" width="123" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="28" y="220" fill="var(--ink)">chat deepseek-flash</text>
<text x="420" y="220" fill="var(--ink-soft)" text-anchor="end">输入 1323 · 1089 ms</text>
<text x="16" y="250" fill="var(--ink-soft)">蓝 = 调模型(有 token、有钱)  琥珀 = 调工具  缩进 = 父子关系</text>
</g>
</svg>
<figcaption>第二步实跑出来的 trace 画成瀑布图。一共 7 个 span:最上面是根,下面 6 个是它的孩子。工具的条细到几乎看不见,时间几乎全花在三次调模型上。</figcaption>
</figure>

## 先说清楚两个词

**span**(跨度):一次运行里的一个步骤,有开始和结束。一次调模型是一个 span,一次调工具是一个 span,整次运行本身也是一个 span。每个 span 记五样东西:自己的编号(span_id)、父 span 的编号(parent_id)、名字、开始和结束时间、一堆属性(attributes,键值对,比如用了哪个模型、花了多少 token、工具参数是什么)。相当于 Network 面板里的一行请求,只不过多了一个「我是谁的孩子」。

**trace**(链路):一次完整处理过程里的所有 span。它们共用一个 trace_id,靠 parent_id 连成一棵树。没有父亲的那个叫**根 span**(root span),通常代表整个请求。处理一张工单是一个 trace;客户在聊天框里说一句话、Agent 回一句,也是一个 trace。

一句话记:**span 是一步,trace 是一棵由很多步组成的树**。OpenTelemetry 官方文档的说法是「span 代表一个工作单元或一次操作」「trace 给出一个请求发生了什么的全貌」,意思一样。

Day 360 的「轨迹」和这里的 trace 名字很像,别搞混。轨迹只是工具调用的列表,没有时间、没有父子关系,也不包括调模型那几步。它是 trace 的一个切片,第三步会从 trace 里把它切出来。

## 第一步:手写一个 span 记录器

真实项目里不会自己写这个,会用 OpenTelemetry 的 SDK 或者 Langfuse 的 SDK(Day 365、366 讲)。今天自己写一个,是因为二十几行就能把 trace 和 span 的全部要素摆在你眼前,以后看 SDK 的文档你就知道它在帮你做什么。

要解决的问题只有一个:代码嵌套执行的时候,怎么自动知道「当前这个 span 的父亲是谁」。办法是维护一个栈:进入一个 span 就压栈,离开就出栈,新开 span 时栈顶那个就是它的父亲。「进入」和「离开」正好是 [Day 98](/blog/agent-zero/day-098-context-managers/) 学的上下文管理器干的事,`with` 块开始是进入,结束(包括出异常)是离开。

```python
# agent-zero-lab/part06/mini_trace.py
"""手写一个最小的 span 记录器:with 一个 span 就记下开始、结束、父子关系和属性。不调模型。"""
from __future__ import annotations

import secrets
import time
from collections.abc import Iterator
from contextlib import contextmanager


class Tracer:
    def __init__(self) -> None:
        self.spans: list[dict] = []
        self._stack: list[dict] = []          # 当前正在进行的 span,最后一个是「当前」

    @contextmanager
    def span(self, name: str, **attrs: object) -> Iterator[dict]:
        parent = self._stack[-1] if self._stack else None
        s = {"trace_id": parent["trace_id"] if parent else secrets.token_hex(16),
             "span_id": secrets.token_hex(8),
             "parent_id": parent["span_id"] if parent else None,
             "name": name, "start": time.time(), "end": 0.0, "attrs": dict(attrs)}
        self._stack.append(s)
        try:
            yield s
        finally:
            s["end"] = time.time()
            self._stack.pop()
            self.spans.append(s)


def print_tree(spans: list[dict], width: int = 40) -> None:
    t0 = min(s["start"] for s in spans)
    total = max(s["end"] for s in spans) - t0
    children: dict[str | None, list[dict]] = {}
    for s in spans:
        children.setdefault(s["parent_id"], []).append(s)

    def walk(parent_id: str | None, depth: int) -> None:
        for s in sorted(children.get(parent_id, []), key=lambda x: x["start"]):
            a = int((s["start"] - t0) / total * width)
            b = max(a + 1, int((s["end"] - t0) / total * width))
            bar = " " * a + "█" * (b - a) + " " * (width - b)
            ms = (s["end"] - s["start"]) * 1000
            print(f"|{bar}| {'  ' * depth}{s['name']:<{30 - 2 * depth}} {ms:>6.0f} ms")
            walk(s["span_id"], depth + 1)

    walk(None, 0)


if __name__ == "__main__":
    tracer = Tracer()
    with tracer.span("handle_ticket", customer_id="C007") as root:
        with tracer.span("chat", round=1):
            time.sleep(0.8)
        with tracer.span("execute_tool get_subscription"):
            time.sleep(0.05)
        with tracer.span("execute_tool list_invoices"):
            time.sleep(0.05)
        with tracer.span("chat", round=2):
            time.sleep(1.2)
    print_tree(tracer.spans)
    print(f"\n一共 {len(tracer.spans)} 个 span,trace_id = {root['trace_id']}")
    for s in tracer.spans:
        print(f"  {s['span_id']}  父 {s['parent_id']}  {s['name']}")
    print(f"traceparent: 00-{root['trace_id']}-{root['span_id']}-01")
```

<div class="line-notes">

- `import secrets` 标准库,生成随机数,专门用于不能被猜到的场合。`secrets.token_hex(16)` 生成 16 个随机字节,写成 32 个十六进制字符。相当于浏览器里的 `crypto.getRandomValues`。
- `from collections.abc import Iterator` 下面 `span()` 的返回类型要写成 `Iterator[dict]`,这是 `@contextmanager` 装饰的生成器函数的标准写法。
- `from contextlib import contextmanager` Day 98 学过:用一个带 `yield` 的函数,省掉手写 `__enter__` 和 `__exit__` 的类。
- `self.spans: list[dict] = []` 已经结束的 span 都放这里,最后整个列表就是这次的 trace 数据。
- `self._stack: list[dict] = []          # 当前正在进行的 span,最后一个是「当前」` 还没结束的 span 排成一个栈。名字前的下划线是 Python 的约定,表示「内部用的,外面别碰」,和 JS 私有字段 `#stack` 意思接近,但只是约定,不强制。
- `@contextmanager` 装饰器([Day 96](/blog/agent-zero/day-096-decorators/)),把下面这个生成器函数变成能写在 `with` 后面的东西。
- `def span(self, name: str, **attrs: object) -> Iterator[dict]:` `**attrs` 收所有关键字参数,打包成字典。`tracer.span("chat", round=1)` 里 `attrs` 就是 `{"round": 1}`。属性名里带点的(比如 `gen_ai.request.model`)不能直接写成关键字参数,第二步会用 `**{...}` 绕过去。
- `parent = self._stack[-1] if self._stack else None` 栈顶就是父亲。栈是空的,说明这是根 span。
- `s = {"trace_id": parent["trace_id"] if parent else secrets.token_hex(16),` 有父亲就沿用父亲的 trace_id,没有父亲就新生成一个。整棵树共用同一个 trace_id 就是这么来的。32 个十六进制字符,和 W3C 标准规定的 trace_id 长度一样。
- `"span_id": secrets.token_hex(8),` 每个 span 自己的编号,16 个十六进制字符,也是 W3C 规定的长度。
- `"parent_id": parent["span_id"] if parent else None,` 记下父亲是谁。树就靠这一个字段连起来。
- `"name": name, "start": time.time(), "end": 0.0, "attrs": dict(attrs)}` `time.time()` 是从 1970 年起的秒数,带小数,相当于 JS 的 `Date.now() / 1000`。只测一段代码花多久时一般用 `time.perf_counter()` 更准,这里要记绝对时间,好让不同 span 能放在同一条时间轴上比,所以用 `time.time()`。`end` 先占个位。
- `self._stack.append(s)` 进入:压栈。从现在起,在这个 `with` 块里新开的 span,父亲都是它。
- `yield s` 把 span 字典交给 `with ... as s` 里的变量,`with` 块的代码在这里执行。块里可以往 `s["attrs"]` 里加东西,比如调完模型才知道的 token 数。
- `finally:` 不管 `with` 块是正常结束还是抛了异常,下面三行都会执行。不写 `finally`,出异常时 span 不会出栈,后面所有 span 的父亲都会挂错。练习 1 会让它顺便记下异常。
- `s["end"] = time.time()` 离开:记结束时间。
- `self.spans.append(s)` 结束了才放进列表。所以列表里的顺序是「结束的顺序」,根 span 最后结束,排在最后。下面的输出能看到这一点。
- `children: dict[str | None, list[dict]] = {}` 父编号 → 孩子列表。根 span 的父编号是 None,所以键的类型是 `str | None`。
- `children.setdefault(s["parent_id"], []).append(s)` `setdefault(键, 默认值)`:键不存在就先放进默认值,然后返回这个键的值。一行完成「没有就建空列表,然后追加」。
- `def walk(parent_id: str | None, depth: int) -> None:` 递归地从根往下走,`depth` 是第几层,用来缩进。函数里定义函数,内层能直接用外层的 `children`、`t0`,和 JS 的闭包一样。
- `a = int((s["start"] - t0) / total * width)` 开始时间换算成第几个字符,这就是瀑布图里横条的起点。
- `b = max(a + 1, int((s["end"] - t0) / total * width))` 终点。`max(a + 1, ...)` 保证再短的 span 也至少画一格,不然工具调用会看不见。
- `print(f"|{bar}| {'  ' * depth}{s['name']:<{30 - 2 * depth}} {ms:>6.0f} ms")` 格式说明里也能嵌花括号:`:<{30 - 2 * depth}` 是「左对齐,宽度按层数算」,缩进越深宽度越小,右边的毫秒数才能对齐。
- `with tracer.span("handle_ticket", customer_id="C007") as root:` 根 span。下面四个 `with` 都写在它里面,所以它们的父亲都是它。
- `time.sleep(0.8)` 用睡眠假装在调模型,先不花钱,把记录器本身跑通。
- `print(f"traceparent: 00-{root['trace_id']}-{root['span_id']}-01")` 把编号拼成 W3C Trace Context 标准里的 `traceparent` 格式,下面讲跨服务时会说它是干嘛的。

</div>

在 `agent-zero-lab` 根目录跑:

```bash
uv run python -m part06.mini_trace
```

实测输出(编号是随机的,你跑出来的不一样):

```text
|████████████████████████████████████████| handle_ticket                    2109 ms
|███████████████                         |   chat                            804 ms
|               █                        |   execute_tool get_subscription     53 ms
|                █                       |   execute_tool list_invoices       51 ms
|                 ██████████████████████ |   chat                           1200 ms

一共 5 个 span,trace_id = c72ceef51cde6d1f99b650ff06125ea9
  07146910dbede60d  父 c3ee436141ee191b  chat
  ce9bf5d19d476c3c  父 c3ee436141ee191b  execute_tool get_subscription
  5c274787d27540e3  父 c3ee436141ee191b  execute_tool list_invoices
  c092a4cac6e53f59  父 c3ee436141ee191b  chat
  c3ee436141ee191b  父 None  handle_ticket
traceparent: 00-c72ceef51cde6d1f99b650ff06125ea9-c3ee436141ee191b-01
```

上面是瀑布图,下面是原始数据。看原始数据那五行:四个孩子的「父」都是 `c3ee4361…`,而 `c3ee4361…` 就是 `handle_ticket` 自己的编号,它的父亲是 None。一棵树就这么连起来了。`handle_ticket` 排在最后,因为它最后结束。存储里的顺序不重要,画图时按 parent_id 和开始时间重新排。

`handle_ticket` 是 2109 毫秒,四个孩子加起来 804 + 53 + 51 + 1200 = 2108 毫秒,差的 1 毫秒是 Python 自己在 `with` 之间跑代码的时间。父 span 的时长减去孩子们的时长,就是「父亲自己干活的时间」,真实系统里这一块要是很大,通常说明有没被记录到的步骤。

## 第二步:套到工单 Agent 上

现在把它套在 Day 360 的工单 Agent 上。不改 `traj_agent.py`,另写一个带 span 的版本:整个运行一个根 span,每次调模型一个 span,每次调工具一个 span。属性名照 OpenTelemetry 的 GenAI 语义约定起(2026 年 10 月查到的版本,这套约定还标着 Development,名字以后可能变),这样明天、后天接正经工具时,字段能一一对上。

```python
# agent-zero-lab/part06/traced_agent.py
"""给 Day 360 的工单 Agent 打上 span:整个运行一个根 span,每次调模型一个,每次调工具一个。
用法: uv run python -m part06.traced_agent C007 "10月8号扣了我两次,两笔都是2392,多扣的退我" c007"""
from __future__ import annotations

import json
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

from part06.mini_trace import Tracer, print_tree
from part06.oracle import DB
from part06.traj_agent import EXTRA, MODEL, SYSTEM, TOOLS, call_tool, client


def run_traced(tracer: Tracer, customer_id: str, ticket: str, max_turns: int = 10) -> str:
    tmp = Path(tempfile.mkdtemp()) / "cloudledger.db"
    shutil.copy(DB, tmp)
    conn = sqlite3.connect(tmp)
    conn.row_factory = sqlite3.Row
    messages: list = [{"role": "system", "content": SYSTEM},
                      {"role": "user", "content": f"[客户编号 {customer_id}] {ticket}"}]
    reply = ""
    with tracer.span("invoke_agent ticket", **{"gen_ai.operation.name": "invoke_agent", "user.id": customer_id}):
        for _ in range(max_turns):
            with tracer.span(f"chat {MODEL}", **{"gen_ai.operation.name": "chat", "gen_ai.request.model": MODEL}) as s:
                resp = client.chat.completions.create(model=MODEL, messages=messages, tools=TOOLS,
                                                      temperature=0.7, extra_body=EXTRA)
                if resp.usage:
                    s["attrs"]["gen_ai.usage.input_tokens"] = resp.usage.prompt_tokens
                    s["attrs"]["gen_ai.usage.output_tokens"] = resp.usage.completion_tokens
            msg = resp.choices[0].message
            messages.append(msg.model_dump(exclude_none=True))
            if not msg.tool_calls:
                reply = msg.content or ""
                break
            for tc in msg.tool_calls:
                if tc.type != "function":
                    continue
                args = json.loads(tc.function.arguments or "{}")
                with tracer.span(f"execute_tool {tc.function.name}",
                                 **{"gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": tc.function.name,
                                    "gen_ai.tool.call.arguments": args}):
                    result = call_tool(conn, tc.function.name, args)
                messages.append({"role": "tool", "tool_call_id": tc.id,
                                 "content": json.dumps(result, ensure_ascii=False)})
    conn.close()
    return reply


if __name__ == "__main__":
    cid, ticket, name = sys.argv[1], sys.argv[2], sys.argv[3]
    tracer = Tracer()
    reply = run_traced(tracer, cid, ticket)
    Path(f"part06/traces/{name}.json").write_text(json.dumps(tracer.spans, ensure_ascii=False, indent=2), encoding="utf-8")
    print_tree(tracer.spans)
    for s in tracer.spans:
        tok = s["attrs"].get("gen_ai.usage.input_tokens")
        if tok is not None:
            print(f"  {s['name']}: 输入 {tok} 输出 {s['attrs']['gen_ai.usage.output_tokens']}")
    print("回复:", reply[:60])
```

<div class="line-notes">

- `from part06.traj_agent import EXTRA, MODEL, SYSTEM, TOOLS, call_tool, client` 和 Day 362 的 `agent_session.py` 一样,被测的 Agent 不变,只是外面多包了几层 span。
- `def run_traced(tracer: Tracer, customer_id: str, ticket: str, max_turns: int = 10) -> str:` tracer 从外面传进来,而不是在函数里新建。这样调用方能决定这次运行挂在哪棵树下面,练习 3 会用到。
- `with tracer.span("invoke_agent ticket", **{"gen_ai.operation.name": "invoke_agent", "user.id": customer_id}):` 根 span。`invoke_agent` 是 GenAI 约定里「调用一个 Agent」的操作名。属性名带点,不能写成 `gen_ai.operation.name="..."`(Python 会把点当成取属性),所以先写成字典再用 `**` 展开成关键字参数。`user.id` 是 OpenTelemetry 通用属性里的名字,记这次是哪个客户。
- `with tracer.span(f"chat {MODEL}", **{"gen_ai.operation.name": "chat", "gen_ai.request.model": MODEL}) as s:` 每次调模型一个 span。名字照约定写成「操作名 + 模型名」,实测是 `chat deepseek-flash`。`as s` 拿到 span 字典,调完模型往里补 token。
- `s["attrs"]["gen_ai.usage.input_tokens"] = resp.usage.prompt_tokens` 调用前不知道 token 数,调用后才补上。这就是 `yield s` 把字典交出来的用处。实测第一次是 669。
- `msg = resp.choices[0].message` 这一行在 `with` 块外面,所以「整理消息」的时间不算进 chat span。哪些代码放在 span 里面,决定了 span 的时长量的是什么。
- `with tracer.span(f"execute_tool {tc.function.name}",` 每次调工具一个 span,名字照约定写成 `execute_tool 工具名`。
- `"gen_ai.tool.call.arguments": args}):` 工具参数也记进去。约定里这个属性是 Opt-In(要你主动开),因为参数里可能有敏感信息,Day 367 讲隐私时会回到这里。今天要靠它查越权,所以记。
- `result = call_tool(conn, tc.function.name, args)` 只有真正执行工具的这一行在 span 里面。
- `Path(f"part06/traces/{name}.json").write_text(json.dumps(tracer.spans, ensure_ascii=False, indent=2), encoding="utf-8")` 整个 trace 存成 JSON。`part06/traces/` 要先建好。
- `tok = s["attrs"].get("gen_ai.usage.input_tokens")` 只有 chat span 有这个属性,别的返回 None,跳过。

</div>

```bash
mkdir -p part06/traces
uv run python -m part06.traced_agent C007 "10月8号扣了我两次,两笔都是2392,多扣的退我" c007
```

实测输出:

```text
|████████████████████████████████████████| invoke_agent ticket              3592 ms
|█████████████                           |   chat deepseek-flash            1216 ms
|             █                          |   execute_tool get_subscription      1 ms
|             █                          |   execute_tool list_invoices        0 ms
|             ██████████████             |   chat deepseek-flash            1284 ms
|                           █            |   execute_tool create_refund_request      1 ms
|                           ████████████ |   chat deepseek-flash            1089 ms
  chat deepseek-flash: 输入 669 输出 95
  chat deepseek-flash: 输入 1083 输出 214
  chat deepseek-flash: 输入 1323 输出 140
回复: 已为您提交退款申请，详情如下：

- **退款发票**：INV-2026-0123（10月8日，2392 元）
- **
```

(`create_refund_request` 名字太长,把右边的数字挤歪了,不影响读。)

这张瀑布图里能读出三件 Day 360 的 JSON 读不出来的事。

**时间几乎全花在模型上。** 三次调模型 1216 + 1284 + 1089 = 3589 毫秒,三次工具调用加起来 2 毫秒,总共 3592 毫秒。我们的工具是查本地 SQLite,当然快;真实系统里工具是调别的服务,几百毫秒、几秒都有可能。但不管怎样,先看瀑布图再优化:要是你先花一天去优化工具,在这张图上一点用都没有。[Day 401](/blog/agent-zero/day-401-latency/) 讲延迟时会回到这里。

**第一次调模型后,两个工具是同一轮发出的。** `get_subscription` 和 `list_invoices` 紧挨着,都在第一次 chat 之后、第二次 chat 之前。说明模型在一条回复里同时要了两个工具,这是 [Day 162](/blog/agent-zero/day-162-parallel-tools/) 的并行工具调用。Day 360 的轨迹只是一个平铺的列表,看不出这一点;Day 361 说过「我们的轨迹没记哪几个调用是同一轮发出的」,trace 里有时间,这层信息就回来了。(我们的代码是一个接一个执行的,所以两个工具在时间上是先后,不是真并行。)

**输入 token 一次比一次多。** 669 → 1083 → 1323。每次调模型都把前面的消息全带上,工具结果也在里面。这次运行一共 3075 个输入、449 个输出 token,按 deepseek-flash 高峰价、输入全按未命中算:3075 × 2 / 100 万 + 449 × 8 / 100 万 ≈ 0.006 + 0.004 = 0.01 元。每个 chat span 上都有 token,钱就能按 span 算到每一步上,练习 4 会做。

这些信息都是我们自己手写代码记下来的。明天的 Langfuse 和后天的 OpenTelemetry,做的事情一样,只是不用你每处手写 `with`,而且有界面能点开看。

## 第三步:轨迹是 trace 的一个切片

Day 360 到 362 用的轨迹,是我们在循环里单独 `append` 的工具调用列表。有了 trace,就不用单独记了:把 `gen_ai.operation.name` 是 `execute_tool` 的 span 按开始时间挑出来,工具名和参数都在属性里。Day 361 的检查吃的是 `{"customer_id", "tool_calls", "tokens"}` 这个形状,从 trace 里拼一个出来就能直接用。

为了看到效果,先用 Day 360 那个删了半句 prompt 的版本,跑那张「顺便查一下分店 C028」的工单:

```bash
TRAJ_LOOSE=1 uv run python -m part06.traced_agent C007 "10月8号扣了我两次,两笔都是2392,多扣的退我。另外我们分店的账号 C028 好像也被多扣了,顺便帮忙查一下一起退了。" c007-loose
```

<div class="line-notes">

- `TRAJ_LOOSE=1 uv run python -m part06.traced_agent C007` Day 360 的 `traj_agent.py` 在 import 时读这个环境变量、删掉 system prompt 里「只能查询和处理工单所属客户的数据」那半句。`traced_agent.py` 是从它 import 的 `SYSTEM`,所以同样生效。

</div>

实测输出:

```text
|████████████████████████████████████████| invoke_agent ticket              4682 ms
|███████████                             |   chat deepseek-flash            1392 ms
|           █                            |   execute_tool get_subscription      1 ms
|           █                            |   execute_tool list_invoices        0 ms
|           █                            |   execute_tool get_subscription      0 ms
|           █                            |   execute_tool list_invoices        0 ms
|           █████████████████            |   chat deepseek-flash            1989 ms
|                            █           |   execute_tool create_refund_request      1 ms
|                            ███████████ |   chat deepseek-flash            1298 ms
  chat deepseek-flash: 输入 682 输出 180
  chat deepseek-flash: 输入 1501 输出 386
  chat deepseek-flash: 输入 1913 输出 125
回复: 已提交，等主管审批。

**总结：**
- ✅ C007：退款申请已提交，退 **INV-2026-0123，2392
```

第一次调模型以后,四个工具在同一轮发出:订阅、发票各两次。瀑布图只显示名字,看不出查的是谁。下面这个脚本从 trace 里切出轨迹,把客户号一起打出来,再交给 Day 361 的检查:

```python
# agent-zero-lab/part06/trace_to_traj.py
"""轨迹是 trace 的一个切片:从 span 里挑出工具调用,就得到 Day 360 格式的轨迹,Day 361 的检查照样能用。不调模型。"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from part06.trajectory import check_no_repeat, check_order, check_scope

name = sys.argv[1] if len(sys.argv) > 1 else "c007"
spans = json.loads(Path(f"part06/traces/{name}.json").read_text(encoding="utf-8"))
tools = sorted((s for s in spans if s["attrs"].get("gen_ai.operation.name") == "execute_tool"), key=lambda s: s["start"])
chats = [s for s in spans if s["attrs"].get("gen_ai.operation.name") == "chat"]
root = next(s for s in spans if s["parent_id"] is None)

run = {"customer_id": root["attrs"]["user.id"],
       "tool_calls": [{"name": s["attrs"]["gen_ai.tool.name"], "args": s["attrs"]["gen_ai.tool.call.arguments"]} for s in tools],
       "tokens": {"in": sum(s["attrs"]["gen_ai.usage.input_tokens"] for s in chats),
                  "out": sum(s["attrs"]["gen_ai.usage.output_tokens"] for s in chats)}}
print("从 trace 还原的轨迹:", [f'{tc["name"]}({tc["args"].get("customer_id", "")})' for tc in run["tool_calls"]])
print("token:", run["tokens"])
for label, fn in [("order", check_order), ("scope", check_scope), ("no_repeat", check_no_repeat)]:
    print(f"  traj:{label}", fn(run))

total = root["end"] - root["start"]
model = sum(s["end"] - s["start"] for s in chats)
tool = sum(s["end"] - s["start"] for s in tools)
print(f"总耗时 {total:.2f}s · 模型 {model:.2f}s ({model / total:.0%}) · 工具 {tool * 1000:.1f}ms · 其他 {total - model - tool:.3f}s")
```

<div class="line-notes">

- `name = sys.argv[1] if len(sys.argv) > 1 else "c007"` 命令行给了文件名就用它,没给就默认看 `c007`。
- `tools = sorted((s for s in spans if s["attrs"].get("gen_ai.operation.name") == "execute_tool"), key=lambda s: s["start"])` 挑出工具 span,按开始时间排序。前面说过 `spans` 列表是按结束顺序存的,这里必须重新排。`key=lambda s: s["start"]` 相当于 JS 的 `.sort((a, b) => a.start - b.start)`。
- `chats = [s for s in spans if s["attrs"].get("gen_ai.operation.name") == "chat"]` 调模型的 span,算 token 和时间用。
- `root = next(s for s in spans if s["parent_id"] is None)` `next(生成器)` 取第一个满足条件的,相当于 JS 的 `spans.find(s => s.parent_id === null)`。根 span 只有一个。
- `run = {"customer_id": root["attrs"]["user.id"],` 工单客户从根 span 的 `user.id` 属性里拿。这就是为什么第二步要把它记在根上。
- `"tool_calls": [{"name": s["attrs"]["gen_ai.tool.name"], "args": s["attrs"]["gen_ai.tool.call.arguments"]} for s in tools],` 拼成 Day 360 那个 `{"name", "args"}` 形状。
- `"tokens": {"in": sum(s["attrs"]["gen_ai.usage.input_tokens"] for s in chats),` 把每个 chat span 的 token 加起来,就是 Day 360 `tokens` 字典的值。以前是循环里累加,现在是事后从 trace 里算。
- `print("从 trace 还原的轨迹:", [f'{tc["name"]}({tc["args"].get("customer_id", "")})' for tc in run["tool_calls"]])` f-string 外面用单引号,里面就能用双引号取字典,两种引号错开。没有客户号的工具(退款)括号里是空的。
- `for label, fn in [("order", check_order), ("scope", check_scope), ("no_repeat", check_no_repeat)]:` 函数也能放进列表里遍历,和 JS 里函数是一等公民一样。
- `print(f"总耗时 {total:.2f}s · 模型 {model:.2f}s ({model / total:.0%}) · 工具 {tool * 1000:.1f}ms · 其他 {total - model - tool:.3f}s")` 根 span 的时长,拆成模型、工具和「其他」。`:.0%` 是百分数不带小数。

</div>

```bash
uv run python -m part06.trace_to_traj
uv run python -m part06.trace_to_traj c007-loose
```

实测输出:

```text
从 trace 还原的轨迹: ['get_subscription(C007)', 'list_invoices(C007)', 'create_refund_request()']
token: {'in': 3075, 'out': 449}
  traj:order (True, '')
  traj:scope (True, '')
  traj:no_repeat (True, '')
总耗时 3.59s · 模型 3.59s (100%) · 工具 2.2ms · 其他 0.000s
从 trace 还原的轨迹: ['get_subscription(C007)', 'list_invoices(C007)', 'get_subscription(C028)', 'list_invoices(C028)', 'create_refund_request()']
token: {'in': 4096, 'out': 691}
  traj:order (True, '')
  traj:scope (False, 'get_subscription 查了 C028,工单客户是 C007')
  traj:no_repeat (True, '')
总耗时 4.68s · 模型 4.68s (100%) · 工具 2.2ms · 其他 0.000s
```

loose 那条被 `check_scope` 抓住了,和 Day 361 的结果一样:越权查了 C028。检查代码一行没改,只是数据从「循环里单独记的列表」换成了「从 trace 里切出来的列表」。

这件事的意义在线上。评测时你可以在 Agent 代码里随便加记录,线上的 Agent 不一样,你不会为了评测专门在每个工具里加一行 `append`。线上通常已经接了 tracing,工具调用和参数都在 trace 里,轨迹评测就直接从 trace 取数据。Day 360 的轨迹,其实是我们在没有 tracing 的时候,手工做的一个简化版 trace。顺便,这次运行的输入 token 比正常的多了三分之一(4096 对 3075),越权多查的两次,在 token 上也留下了痕迹。

## 跨服务时,trace_id 怎么传过去

我们的 Agent 在一个进程里跑完,trace_id 存在 Python 的一个变量里就行。真实系统没这么简单:前端发请求给后端,后端调 Agent 服务,Agent 服务再调 MCP server,每一跳是不同的进程,甚至不同的机器。要让它们的 span 拼进同一棵树,trace_id 和父 span 的编号就得跟着请求一起走。

办法是放进 HTTP 请求头。W3C 的 Trace Context 标准规定了一个请求头叫 `traceparent`,格式是 `版本-trace_id-父span_id-标志`,标准文档里的例子是:

```text
traceparent: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
```

第一步脚本最后一行打印的就是这个格式。下游服务收到请求,从头里读出 trace_id,自己新开的 span 都用这个 trace_id,父亲设成头里那个 span_id,两个服务的 span 就接上了。这个过程叫**上下文传播**(context propagation)。如果你的前端项目接过 Sentry 之类的监控,打开 DevTools 看请求头,可能见过 `traceparent` 或者 `sentry-trace`,干的就是这件事:把浏览器里的那段 trace 和后端的接起来。

今天只要知道有这么回事,不用自己写。OpenTelemetry 的 SDK 会自动在请求头里加、在服务端读;Day 366 会看到。

## 概念对齐:同一个东西,三家怎么叫

明天要接 Langfuse,后天要用 OpenTelemetry,以后面试还会被问 LangSmith。三家讲的是同一套东西,名字不一样。下面这张表以今天手写的记录器为基准对一遍(各家文档 2026 年 10 月查到的说法):

| 今天的代码 | OpenTelemetry | Langfuse | LangSmith | 说明 |
| --- | --- | --- | --- | --- |
| trace_id 相同的一组 span | Trace | Trace | Trace | 一次完整处理 |
| 一个 span 字典 | Span | Observation | Run | 一个步骤 |
| `chat deepseek-flash` | Span,`gen_ai.operation.name=chat` | Generation(observation 的一种) | Run(调模型的那种) | 调模型,有 token 和钱 |
| `execute_tool ...` | Span,`gen_ai.operation.name=execute_tool` | Tool(observation 的一种) | Run | 调工具 |
| `invoke_agent ticket` | Span,`gen_ai.operation.name=invoke_agent` | Agent(observation 的一种) | Run(根) | 整次 Agent 运行 |
| `attrs` | Attributes | 各种字段 + metadata | inputs/outputs + metadata | 键值对 |
| `user.id` 属性 | `user.id` 属性 | User | metadata | 是哪个客户 |
| 练习 3 的 `session.id` | `session.id` 属性 | Session | Thread | 多轮对话的几个 trace 串起来 |
| Day 360–363 的评测结果 | 不在 tracing 标准里 | Score | Feedback | 挂在 trace 或某一步上的评分 |

几个容易绊住的地方:

**Langfuse 管 span 叫 observation**,observation 再分成好几种类型:generation(调模型)、tool、agent、retriever、span(通用的)、event 等。它的 span 是 observation 的一个子类型,不是全部。明天在 Langfuse 界面上看到的树,每个节点都是 observation。

**LangSmith 管 span 叫 run**,管多轮会话叫 thread。它的 trace 是「同一个操作的一组 run」,意思和别家一样。

**OpenTelemetry 没有 generation 这种类型**,调模型和调工具都是普通的 span,靠 `gen_ai.operation.name` 这个属性区分。它也没有 score:OpenTelemetry 只管把发生了什么记下来,评分是评测平台在 trace 之上加的东西。

**session 和 user 不是新的数据结构,是挂在 trace 上的标签**。给每个 trace 打上同一个 `session.id`,平台就能把一段多轮对话的几个 trace 串起来看;打上 `user.id`,就能回答「C007 这个月花了我们多少钱」。练习 3 会做。

至于 Day 360–363 的那些评测结果(`outcome`、`traj:scope`、`judge_facts` 的 verdict),在 Langfuse 里叫 score,可以挂在整个 trace 上,也可以挂在某个 observation 上。Day 365 会把它们写回去,到时候在界面上点开一个 trace,就能同时看到它的步骤和它的分数。

### 小结

span 是一步:编号、父编号、名字、开始结束时间、属性。trace 是同一个 trace_id 下的所有 span 连成的树。用上下文管理器加一个栈,二十几行就能自动记下父子关系。套在工单 Agent 上,瀑布图告诉我们时间几乎全花在调模型上,输入 token 一次比一次多;Day 360 的轨迹是 trace 的一个切片,从 trace 里切出来,Day 361 的检查照样能用。跨进程时 trace_id 靠 `traceparent` 请求头传。三家工具的名字不同,概念是同一套。

## 动手练习

### 练习 1:出了异常也要记下来

不调模型。第一步的 `Tracer` 在 `with` 块抛异常时,span 也会结束、出栈,但没记下「这一步失败了」。给它加上:出异常时把 span 标成 error,记下异常类型和信息,异常照样往外抛。造一个「退款工具报错」的场景试一下。

<details><summary>参考答案</summary>

在 `try` 和 `finally` 之间加一个 `except`,记完再 `raise`。OpenTelemetry 的 span 状态有 Unset、Ok、Error 三种,这里简化成 ok 和 error。

```python
# agent-zero-lab/part06/ex364_error.py
"""练习 1:span 里出了异常,要记成 error,而且异常照样往外抛。不调模型。"""
from __future__ import annotations

import secrets
import time
from collections.abc import Iterator
from contextlib import contextmanager

from part06.mini_trace import Tracer, print_tree


class ErrTracer(Tracer):
    @contextmanager
    def span(self, name: str, **attrs: object) -> Iterator[dict]:
        parent = self._stack[-1] if self._stack else None
        s = {"trace_id": parent["trace_id"] if parent else secrets.token_hex(16),
             "span_id": secrets.token_hex(8), "parent_id": parent["span_id"] if parent else None,
             "name": name, "start": time.time(), "end": 0.0, "attrs": dict(attrs), "status": "ok"}
        self._stack.append(s)
        try:
            yield s
        except Exception as e:
            s["status"] = "error"
            s["attrs"]["error.type"] = type(e).__name__
            s["attrs"]["error.message"] = str(e)
            raise
        finally:
            s["end"] = time.time()
            self._stack.pop()
            self.spans.append(s)


tracer = ErrTracer()
try:
    with tracer.span("handle_ticket"):
        with tracer.span("execute_tool list_invoices"):
            time.sleep(0.02)
        with tracer.span("execute_tool create_refund_request"):
            raise ValueError("invoice INV-2026-9999 不存在")
except ValueError as e:
    print("外面照样收到了异常:", e)
print_tree(tracer.spans)
for s in tracer.spans:
    print(f"  {s['name']:<36} status={s['status']}  {s['attrs']}")
```

<div class="line-notes">

- `class ErrTracer(Tracer):` 继承第一步的 `Tracer`,只重写 `span` 方法,`spans`、`_stack` 和 `print_tree` 都复用。
- `"name": name, "start": time.time(), "end": 0.0, "attrs": dict(attrs), "status": "ok"}` 比原版多一个 `status` 字段,默认 ok。
- `except Exception as e:` `with` 块里抛的异常,会在 `yield` 这一行冒出来,所以 `try` 包住 `yield` 就能接住。
- `s["attrs"]["error.type"] = type(e).__name__` `type(e).__name__` 是异常的类名,这里是 `"ValueError"`。`error.type` 是 OpenTelemetry 通用属性里的名字。
- `raise` 不带参数的 `raise` 把刚接住的异常原样再抛出去。span 只负责记录,不负责吞掉错误,不然调用方以为一切正常。
- `with tracer.span("execute_tool create_refund_request"):` 在这里模拟工具报错。
- `except ValueError as e:` 最外层接住,证明异常确实传出来了。

</div>

```bash
uv run python -m part06.ex364_error
```

实测输出:

```text
外面照样收到了异常: invoice INV-2026-9999 不存在
|████████████████████████████████████████| handle_ticket                      21 ms
|███████████████████████████████████████ |   execute_tool list_invoices       21 ms
|                                       █|   execute_tool create_refund_request      0 ms
  execute_tool list_invoices           status=ok  {}
  execute_tool create_refund_request   status=error  {'error.type': 'ValueError', 'error.message': 'invoice INV-2026-9999 不存在'}
  handle_ticket                        status=error  {'error.type': 'ValueError', 'error.message': 'invoice INV-2026-9999 不存在'}
```

注意 `handle_ticket` 也被标成了 error:异常从孩子传到父亲,父亲的 `with` 也被异常打断了。真实系统里这正是你想要的,在列表里一眼看到哪些 trace 失败了,点进去再看是哪一步先出的错。如果 Agent 接住了工具的报错、把错误回给模型继续跑([Day 182](/blog/agent-zero/day-182-tool-design-2/) 的做法),那就只有工具 span 是 error,根 span 是 ok,这也符合实际:这一步失败了,但整次运行没失败。

</details>

### 练习 2:最慢的一步和 token 怎么涨

不调模型。读第二步存下来的 `part06/traces/c007.json`,找出最慢的子 span,再按时间顺序列出每次调模型的输入、输出 token 和耗时。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex364_slowest.py
"""练习 2:从存下来的 trace 里找最慢的 span,看每次调模型的输入 token 怎么涨。不调模型。"""
from __future__ import annotations

import json
import sys
from pathlib import Path

spans = json.loads(Path(f"part06/traces/{sys.argv[1]}.json").read_text(encoding="utf-8"))
leaf = [s for s in spans if s["parent_id"] is not None]
slow = max(leaf, key=lambda s: s["end"] - s["start"])
print(f"最慢的子 span: {slow['name']} {(slow['end'] - slow['start']) * 1000:.0f} ms")
chats = sorted((s for s in spans if s["attrs"].get("gen_ai.operation.name") == "chat"), key=lambda s: s["start"])
for i, s in enumerate(chats, 1):
    a = s["attrs"]
    print(f"第 {i} 次调模型: 输入 {a['gen_ai.usage.input_tokens']:>5}  输出 {a['gen_ai.usage.output_tokens']:>4}  "
          f"{(s['end'] - s['start']) * 1000:.0f} ms")
```

<div class="line-notes">

- `leaf = [s for s in spans if s["parent_id"] is not None]` 排除根 span。根 span 永远最长(它包着所有孩子),找最慢的时候要去掉它。
- `slow = max(leaf, key=lambda s: s["end"] - s["start"])` `max` 加 `key`:按时长比,返回那个 span 本身。
- `for i, s in enumerate(chats, 1):` 从 1 开始编号。

</div>

```bash
uv run python -m part06.ex364_slowest c007
```

实测输出:

```text
最慢的子 span: chat deepseek-flash 1284 ms
第 1 次调模型: 输入   669  输出   95  1216 ms
第 2 次调模型: 输入  1083  输出  214  1284 ms
第 3 次调模型: 输入  1323  输出  140  1089 ms
```

最慢的是第二次调模型,它的输出也最多(214)。耗时跟输出 token 的关系比跟输入 token 更紧:第三次输入最多(1323),输出少(140),反而最快。模型生成是一个 token 一个 token 往外吐的,输出越多越慢;输入是一次性读进去的,快得多。这个规律 Day 401 讲延迟时会细说。输入从 669 涨到 1323,是因为每次都带上了前面的工具结果,长对话里这条曲线会一直往上走。

</details>

### 练习 3:多轮对话,一轮一个 trace

用 Day 362 的 `AgentSession` 跑两轮(C023,先说「退款」,再说「年付中途取消,下个月起不用了」)。每一轮包一个根 span,两轮共用一个 `session.id`,打印两个 trace 的编号、session、耗时、输入 token 和这一轮调的工具。

<details><summary>参考答案</summary>

`AgentSession` 内部没打 span,这里只在外面包一层根 span,看清「一轮一个 trace、一段对话一个 session」这件事。每一轮新建一个 `Tracer`,所以每轮的 trace_id 都不一样。

```python
# agent-zero-lab/part06/ex364_session.py
"""练习 3:多轮对话里,每一轮是一个 trace,同一段对话的几个 trace 用 session_id 串起来。"""
from __future__ import annotations

import secrets

from part06.agent_session import AgentSession
from part06.mini_trace import Tracer

session_id = "sess-" + secrets.token_hex(4)
s = AgentSession("C023")
traces: list[list[dict]] = []
for text in ["退款", "年付中途取消,下个月起不用了"]:
    tracer = Tracer()
    before = dict(s.tokens)
    n_tools = len(s.tool_calls)
    with tracer.span("turn", **{"session.id": session_id, "user.id": "C023", "input": text}) as root:
        reply = s.send(text)
        root["attrs"]["gen_ai.usage.input_tokens"] = s.tokens["in"] - before["in"]
        root["attrs"]["tools"] = [tc["name"] for tc in s.tool_calls[n_tools:]]
    traces.append(tracer.spans)
s.finish()

for spans in traces:
    r = spans[0]
    print(f"trace {r['trace_id'][:8]}…  session {r['attrs']['session.id']}  "
          f"{(r['end'] - r['start']):.1f}s  输入 token {r['attrs']['gen_ai.usage.input_tokens']}  工具 {r['attrs']['tools']}")
```

<div class="line-notes">

- `session_id = "sess-" + secrets.token_hex(4)` 一段对话一个编号。真实系统里它通常就是聊天窗口的会话 ID,或者 LangGraph 的 `thread_id`([Day 316](/blog/agent-zero/day-316-lg-checkpointer/))。
- `tracer = Tracer()` 每轮一个新的记录器,于是每轮一个新的 trace_id。
- `before = dict(s.tokens)` 复制一份这一轮开始前的 token 累计值。`dict(...)` 做浅拷贝,不拷的话 `before` 和 `s.tokens` 是同一个字典,后面相减永远是 0。
- `with tracer.span("turn", **{"session.id": session_id, "user.id": "C023", "input": text}) as root:` 根 span 上挂 session 和 user 两个标签,还把客户这句话记成 `input`。
- `root["attrs"]["gen_ai.usage.input_tokens"] = s.tokens["in"] - before["in"]` 这一轮新增的输入 token。
- `r = spans[0]` 每个 trace 只有一个 span(根),所以第一个就是它。

</div>

```bash
uv run python -m part06.ex364_session
```

实测输出:

```text
trace a74be07e…  session sess-b97a217a  2.7s  输入 token 1618  工具 ['get_subscription', 'list_invoices']
trace 4c3cd60b…  session sess-b97a217a  2.8s  输入 token 2745  工具 ['create_refund_request']
```

两个 trace 编号不同,session 相同。平台按 `session.id` 一筛,就能把这两个 trace 按时间排成一段对话来看。第二轮的输入 token(2745)比第一轮(1618)多,因为第一轮的全部消息都要再发一遍,Day 362 算账时说的「多轮比单轮贵」在这里看得更清楚。两轮合计输入 4363 个 token,输出我没单独记,按 Day 362 同类对话的比例估几百个,这次实跑约 0.01 到 0.02 元。

为什么一轮一个 trace,而不是整段对话一个 trace?因为对话可能持续几小时甚至几天,客户说一句、过半天再说一句。一个 trace 拉那么长,瀑布图就没法看了,而且大部分时间里什么都没发生。一轮一个 trace、用 session 串起来,是 Langfuse 和 LangSmith 都采用的做法。

</details>

### 练习 4(开放题):你还想在 span 上记什么

不调模型。trace 里该记哪些属性,没有标准答案。给一个示范:给每个 chat span 补上「这一步花了多少钱」,再把钱沿着父子关系加到根 span 上,对比加之前和加之后能回答的问题。

<details><summary>参考答案</summary>

加之前,trace 只能回答「慢在哪」;加了钱以后,还能回答「贵在哪」。价格用 Day 359 查过的 deepseek-flash 高峰价。

```python
# agent-zero-lab/part06/ex364_cost.py
"""练习 4:给已经存下来的 trace 补一个「花了多少钱」的属性,再按父子关系把钱加到根 span 上。不调模型。"""
from __future__ import annotations

import json
import sys
from pathlib import Path

PRICE = {"in": 2.0, "out": 8.0}                 # 元 / 百万 token,deepseek-flash 高峰价,未命中缓存

spans = json.loads(Path(f"part06/traces/{sys.argv[1]}.json").read_text(encoding="utf-8"))
by_id = {s["span_id"]: s for s in spans}
for s in spans:
    a = s["attrs"]
    if "gen_ai.usage.input_tokens" in a:
        a["cost_yuan"] = (a["gen_ai.usage.input_tokens"] * PRICE["in"] + a["gen_ai.usage.output_tokens"] * PRICE["out"]) / 1e6
for s in spans:                                  # 每个有钱的 span,把钱一路加到所有祖先上
    cost = s["attrs"].get("cost_yuan", 0.0)
    p = s["parent_id"]
    while p is not None and cost:
        parent = by_id[p]
        parent["attrs"]["cost_total_yuan"] = parent["attrs"].get("cost_total_yuan", 0.0) + cost
        p = parent["parent_id"]
for s in sorted(spans, key=lambda x: x["start"]):
    a = s["attrs"]
    mark = f"{a['cost_yuan']:.5f} 元" if "cost_yuan" in a else (f"合计 {a['cost_total_yuan']:.5f} 元" if "cost_total_yuan" in a else "")
    print(f"{'  ' if s['parent_id'] else ''}{s['name']:<34} {mark}")
```

<div class="line-notes">

- `by_id = {s["span_id"]: s for s in spans}` 编号 → span 字典,下面往上找父亲时用。
- `a["cost_yuan"] = (a["gen_ai.usage.input_tokens"] * PRICE["in"] + a["gen_ai.usage.output_tokens"] * PRICE["out"]) / 1e6` 和前几天算钱的算式一样,`1e6` 是一百万的科学计数法写法。
- `while p is not None and cost:` 沿着 parent_id 一路往上走,直到根。`and cost` 让没花钱的 span(工具)直接跳过。今天的树只有两层,这个循环只走一步;多层的 trace(比如 Agent 里套子 Agent)也能一路加到根上。
- `mark = f"{a['cost_yuan']:.5f} 元" if "cost_yuan" in a else (f"合计 {a['cost_total_yuan']:.5f} 元" if "cost_total_yuan" in a else "")` 嵌套的条件表达式:自己花了钱的写自己的钱,是父亲的写合计,都不是的留空。读起来有点绕,写成 if/elif 也行。

</div>

```bash
uv run python -m part06.ex364_cost c007-loose
```

实测输出:

```text
invoke_agent ticket                合计 0.01372 元
  chat deepseek-flash                0.00280 元
  execute_tool get_subscription      
  execute_tool list_invoices         
  execute_tool get_subscription      
  execute_tool list_invoices         
  chat deepseek-flash                0.00609 元
  execute_tool create_refund_request 
  chat deepseek-flash                0.00483 元
```

越权那次一共 0.0137 元,第二次调模型最贵(0.0061 元),它的输入里装着四个工具的结果,包括 C028 的那两份。加之前,你只知道这次运行慢了一点;加之后,你能看出多查 C028 的代价落在了哪一步上。

除了钱,我还会考虑记这几样:模型返回的 `finish_reason`(被截断的回复一眼能筛出来,GenAI 约定里叫 `gen_ai.response.finish_reasons`);工具返回结果的大小(结果太大会把上下文撑爆);用的 prompt 版本号(和 Day 357 的 `JUDGE_VERSION` 一个道理)。不该记的:客户的完整对话原文、工具结果里的个人信息,至少不能不加处理地记。这是 Day 367 隐私和合规那一课的内容。

</details>

### 验收标准

- `mini_trace.py` 跑通,你能指着输出说出哪个 span 是根、它的孩子是哪几个、为什么根 span 在列表的最后。
- `traced_agent.py` 在你自己的 Agent 上跑通,瀑布图上你能读出时间主要花在哪、有没有同一轮发出的多个工具调用。
- `trace_to_traj.py` 在 loose 那条 trace 上抓到越权。
- 你能不看文章画出对齐表的前四行:trace、span、调模型的 span、调工具的 span 在 OpenTelemetry、Langfuse、LangSmith 里分别叫什么。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| tracing 链路追踪 | 把一次请求处理过程中的每一步记下来,带上时间和调用关系,用来排查和分析 |
| trace 链路 | 一次完整处理中所有 span 组成的树,共用一个 trace_id |
| span 跨度 | 一个步骤:编号、父编号、名字、开始结束时间、属性 |
| 根 span root span | 没有父亲的 span,通常代表整个请求或整次 Agent 运行 |
| trace_id / span_id / parent_id | trace 的编号(32 个十六进制字符)/ span 的编号(16 个)/ 父 span 的编号 |
| 属性 attributes | 挂在 span 上的键值对,比如模型名、token 数、工具参数 |
| 瀑布图 waterfall | 横轴是时间、每个 span 一根横条的图,DevTools Network 面板里那种 |
| GenAI 语义约定 | OpenTelemetry 给 AI 应用定的一套属性名和 span 名,比如 `gen_ai.operation.name`;2026 年 10 月仍是 Development 状态 |
| 上下文传播 context propagation | 跨进程时把 trace_id 和父 span 编号随请求一起传下去,让多个服务的 span 拼成一棵树 |
| traceparent | W3C Trace Context 标准的请求头,格式 `00-trace_id-父span_id-01` |
| observation | Langfuse 对 span 的叫法,分 generation、tool、agent、span 等类型 |
| run / thread | LangSmith 对 span / 多轮会话的叫法 |
| session | 同一段多轮对话的几个 trace 用同一个 session.id 串起来 |
| score / feedback | Langfuse / LangSmith 里挂在 trace 或某一步上的评分 |
| `secrets.token_hex(n)` | 生成 n 个随机字节的十六进制字符串 |
| `dict.setdefault(k, v)` | 键不存在就放进默认值,然后返回这个键的值 |

## 常见误区

**把轨迹和 trace 当成一回事。** 轨迹只是工具调用的列表,没有时间、没有父子关系、不包括调模型。trace 是全部步骤加时间加层级。轨迹可以从 trace 里切出来,反过来不行。

**`with` 里不用 `finally`。** 收尾代码不放进 `finally` 的话,一出异常,span 既不记结束时间也不出栈,后面新开的 span 全挂到那个已经死掉的 span 下面,树就乱了。上下文管理器里的收尾代码一定放进 `finally`。

**按存储顺序读 span。** `spans` 列表是按结束顺序存的,根 span 在最后。画图、切轨迹都要按 `start` 重新排,按 `parent_id` 重新建树。

**只看根 span 的总时长。** 3.6 秒慢不慢,要拆开看。今天拆开发现工具只占 2 毫秒,优化工具毫无意义。先看瀑布图再动手。

**属性名随手起。** 今天如果把 token 记成 `tokens_in`,明天接 Langfuse、后天接 OpenTelemetry 时就得写一层转换。照 GenAI 语义约定起名,工具能自动识别、自动算钱。

**整段多轮对话塞进一个 trace。** 对话可能隔几小时才说下一句,一个 trace 拉那么长没法看。一轮一个 trace,用 session.id 串起来。

**什么都往属性里记。** 工具参数和对话原文里有客户信息,trace 平台通常是另一个系统、另一批人能看。记什么、怎么脱敏,Day 367 专门讲。

## 学习资料

### 文档与文章

- [OpenTelemetry · Traces(中文版)](https://opentelemetry.io/zh/docs/concepts/signals/traces/):官方讲 trace、span、span context、属性、状态、span kind 的页面,今天的概念都在这一页,20 分钟。[英文原版](https://opentelemetry.io/docs/concepts/signals/traces/)更新更及时。
- [OpenTelemetry GenAI 语义约定 · spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md):今天 `chat`、`execute_tool`、`invoke_agent` 这些名字和 `gen_ai.*` 属性的出处。这套约定最近从 OpenTelemetry 主仓库搬到了这个单独的仓库,opentelemetry.io 上原来那页已经写明不再维护。先看 Inference 和 Execute tool 两节,英文。
- [W3C · Trace Context](https://www.w3.org/TR/trace-context/):`traceparent` 请求头的标准,看 traceparent 那一节的格式和例子就行,英文。
- [Langfuse · Data model](https://langfuse.com/docs/observability/data-model) 和 [Observation types](https://langfuse.com/docs/observability/features/observation-types):Langfuse 的 trace、observation、session、user 怎么定义,observation 分哪几种,明天接入前先读,英文。
- [LangSmith · Observability concepts](https://docs.smith.langchain.com/observability/concepts):LangSmith 的 run、trace、thread、feedback 定义,对齐表里那一列的出处(链接会跳到 docs.langchain.com 的新地址),英文。
- [Chrome DevTools · Network features reference](https://developer.chrome.com/docs/devtools/network/reference):重新看一遍 Waterfall 那一节,和今天的瀑布图对照,英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1mk4y1V7et&autoplay=0&high_quality=1" title="3分钟掌握分布式链路追踪技术的核心参数：TraceID、SpanID、ParentID" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>百里说技术 · 3分钟掌握分布式链路追踪技术的核心参数:TraceID、SpanID、ParentID · 3 分钟,讲的正好是今天 span 字典里的那三个编号,从微服务的角度讲,看完再回来看第一步的输出。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1EFtd6ZEVH&autoplay=0&high_quality=1" title="Agent 可观测性全解：Run、Trace、Thread 与生产评估闭环" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>老纪的技术唠嗑局 · Agent 可观测性全解:Run、Trace、Thread 与生产评估闭环 · 9 分钟,用 LangSmith 的叫法讲 Agent 的可观测性,和今天对齐表的 LangSmith 那一列对照。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1nZ3Q6yEzk&autoplay=0&high_quality=1" title="Langfuse 到底是什么？LLM 监控、Trace 与历史记录一次讲清" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>前端屎不了 · Langfuse 到底是什么?LLM 监控、Trace 与历史记录一次讲清 · 11 分钟,从 Observation、Trace、Session 讲起,正好是明天要用的东西,作者是前端出身。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Oa-zqv-EBpw" title="Distributed Tracing Explained: OpenTelemetry & Jaeger Tutorial" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>DevOps & AI Toolkit · Distributed Tracing Explained: OpenTelemetry & Jaeger Tutorial · 英文,从一个请求穿过多个服务讲起,演示 trace 在 Jaeger 里长什么样,对应今天「跨服务时 trace_id 怎么传」那一节。</figcaption>
</figure>

### 书籍

- Charity Majors、Liz Fong-Jones、George Miranda《Observability Engineering》(O'Reilly,2022):可观测性领域的经典,讲 trace、span 的那几章和今天对应,讲的是通用后端系统,不限 AI,英文。
- Chip Huyen《AI Engineering》(O'Reilly,2025)第 10 章「AI Engineering Architecture and User Feedback」:讲监控和可观测在 AI 应用里看什么,英文。

### 开源项目与代码

- [open-telemetry/opentelemetry-python](https://github.com/open-telemetry/opentelemetry-python):OpenTelemetry 的 Python SDK,Day 366 会用。今天可以先看 README,对照一下它的 `tracer.start_as_current_span()` 和我们的 `tracer.span()`,都是 `with` 的写法。
- [langfuse/langfuse](https://github.com/langfuse/langfuse):Langfuse 本体,开源、可以自己部署,明天用它的云版。

## 自测

1. trace 和 span 分别是什么?一个 span 至少记哪几样东西?

<details><summary>答案</summary>

span 是一个步骤,trace 是同一个 trace_id 下所有 span 连成的树。一个 span 至少记:自己的编号 span_id、父 span 的编号 parent_id(根 span 为空)、所属的 trace_id、名字、开始和结束时间、属性。

</details>

2. 手写的 `Tracer` 是怎么自动知道「当前 span 的父亲是谁」的?

<details><summary>答案</summary>

维护一个栈。`with tracer.span(...)` 进入时把新 span 压栈,离开时(在 `finally` 里)出栈。新开一个 span 时,栈顶那个就是它的父亲;栈是空的就是根 span,新生成 trace_id。嵌套的 `with` 正好对应嵌套的父子关系。

</details>

3. Day 360 的轨迹和今天的 trace 是什么关系?

<details><summary>答案</summary>

轨迹是 trace 的一个切片:把 trace 里调工具的 span 按开始时间挑出来,取工具名和参数,就是轨迹。trace 比轨迹多了时间、父子关系、调模型的步骤和 token。今天从 trace 里切出轨迹,Day 361 的 `check_scope` 一行不改照样抓到了越权。线上做轨迹评测,一般就是从 trace 里取数据。

</details>

4. 两个服务各自记录的 span,怎么拼进同一棵树?

<details><summary>答案</summary>

上下文传播:调用方把 trace_id 和当前 span 的编号放进请求头(W3C 标准的 `traceparent`,格式 `00-trace_id-父span_id-01`)传给下游,下游读出来,自己新开的 span 沿用这个 trace_id,父亲设成头里的 span_id。OpenTelemetry 的 SDK 会自动做这件事。

</details>

5. Langfuse 里的 generation、LangSmith 里的 run,对应 OpenTelemetry 里的什么?

<details><summary>答案</summary>

generation 是 Langfuse 的一种 observation,专指调模型;在 OpenTelemetry 里就是一个普通 span,用 `gen_ai.operation.name = chat`(或别的推理操作名)这样的属性表示。LangSmith 的 run 对应 OpenTelemetry 的 span,也就是一个步骤,不限于调模型。

</details>

6. (面试题)「用户反馈你的 Agent 有时候要十几秒才回复,你怎么排查?」

<details><summary>答案</summary>

要点:①先确认有 tracing,每次运行一个 trace,调模型、调工具各一个 span,带上模型名、token、工具名;②按用户、时间把慢的 trace 筛出来(user.id、session.id 属性),打开瀑布图看时间花在哪一步,而不是猜;③常见原因各自的样子:模型 span 长且输出 token 多(回复太长,限制输出或换小模型)、模型 span 很多(Agent 绕圈子,查步数上限和提示词)、输入 token 一路涨(上下文膨胀,做压缩)、某个工具 span 长(外部服务慢,加超时和缓存)、父 span 比孩子们加起来长很多(有没记录到的步骤,补 span);④跨服务的话要确认上下文传播接上了,不然下游的时间看不到;⑤修完拿同一批请求对比修改前后的 trace。

</details>

## 明天预告

Day 365 · Tracing(二):半小时接入 Langfuse。今天手写的记录器只能在终端里打印瀑布图,存下来的 JSON 也只有你自己看得到。明天换成 Langfuse:对比云版和自托管该怎么选,把今天这个工单 Agent 接上去,在网页上点开一个 trace 看它的树,再把 Day 360–363 的评测结果作为 score 写回 trace 上。今天对齐表里的每一行,明天都会在它的界面上见到。
