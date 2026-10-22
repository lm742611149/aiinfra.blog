---
title: 'Day 467 · 界面(一):并发成本 bug、接口设计和 SSE 事件协议'
description: '把 SupportPilot 包成 HTTP 服务前,先用假模型复现一个只在服务端出现的 bug:两张工单同时跑,共用一本 LLM 账本,成本串到别人头上;修好后又顺着它找出 Day 466 画像那行 partial 漏记的钱。然后用 FastAPI 0.135 起自带的 SSE 写六个接口,约定七种事件,用真模型和 curl 把「跑到审批 → 审批 → 追问」走一遍,再用 TestClient 加假模型写不花钱的接口测试。'
pubDate: 2026-10-22
regime: none
tags: ['fastapi', 'sse', 'concurrency', 'langgraph', 'supportpilot', 'agent-zero']
series: 'agent-zero'
day: 467
lang: 'zh'
draft: true
---

## 上一课回顾

昨天([Day 466](/blog/agent-zero/day-466-memory-profile/))给 SupportPilot 加了第三种记忆:客户画像。`get_or_build_profile` 把客户档案、订阅和已解决的工单压成一段 100 字左右的话,存在 `biz.customer_profiles`,只在历史工单数变了时才花钱重写;`forget_customer` 在客户要求删除时把快照和画像删干净。三天下来,工作流有了完整的记忆。

但到现在为止,它只能在终端里用 `scripts/chat_ticket.py` 跑,一次一张工单。前端要用它,客服要在网页上点「通过」,都需要一组 HTTP 接口,而且处理过程要一边跑一边推给浏览器。今天做这一层。昨天明天预告里说过,动手之前要先修一个 bug,它只在「多个请求同时进来」时才出现。

## 今天要解决的问题

学完今天你应该能做到:

1. 用一个不花钱的脚本复现「两张工单同时跑,成本互相串」,说清楚为什么串;用 `fresh()` 修好,再找出 Day 466 那行 `partial` 留下的第二个漏洞。
2. 用 FastAPI 自带的 SSE(`EventSourceResponse` + `ServerSentEvent`)写出六个接口:建工单、跑工单、追问、查状态、列待审批、审批,其中三个是流式的;工单不存在、不在等审批这类检查放进依赖里,在流开始之前就返回 404 或 409。
3. 背得出前后端约定的七种事件(node、step、tool、token、interrupt、error、done),知道每种从哪来、前端拿它做什么。
4. 用真模型和 curl 把一张退款工单从建单走到审批完成,再用 TestClient 加假模型写 3 个接口测试,全部通过。

预计用时 3 小时。前置:[Day 81](/blog/agent-zero/day-081-fastapi-3/)(HTTPException 和 Depends)、[Day 133](/blog/agent-zero/day-133-sse-principle/)(SSE 原理)、[Day 323](/blog/agent-zero/day-323-lg-stream-modes/)(stream_mode)、[Day 379](/blog/agent-zero/day-379-sse-server/)–[382](/blog/agent-zero/day-382-langgraph-adapter/)(SSE 服务端、事件协议、把 LangGraph 输出翻译成事件)、[Day 459](/blog/agent-zero/day-459-flow-di/)(Deps)、[Day 466](/blog/agent-zero/day-466-memory-profile/)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `Deps.fresh`、`_events` 和七种事件的表默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先修一个 bug:并发时成本算错

### 这个 bug 是怎么来的

回忆一下 Day 460 的节点是怎么记成本的。每个调模型的节点开头写 `before = deps.spent()`,结尾返回 `deps.spent() - before`:开始时看一眼账本读数,结束时再看一眼,差值就是这个节点花的钱。昨天的 load_customer 也加了这一行。

在终端里一张一张跑,这个办法没问题。放进 Web 服务就不一样了。服务启动时建一份 `Deps`,所有请求共用它,也就共用同一个 `LLMClient` 和它肚子里那本账。FastAPI 处理普通 `def` 写的接口时,会把它放进一个线程池里跑(Day 386 讲并发时细说),两个请求同时进来,就有两个线程在同时跑两张工单。

打个前端的比方:两个组件共用一个全局计数器,各自「开始时读一次、结束时读一次、相减」。只要两个组件的时间段有重叠,中间对方加上去的数,就被你算成了自己的。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="两张工单共用一本账时,差值法把对方的花费算进来">
<g font-family="var(--font-mono)" font-size="11">
<text x="10" y="20" fill="var(--ink)" font-size="12">共用一本账(时间从左往右)</text>
<line x1="60" y1="120" x2="620" y2="120" stroke="var(--rule)"/>
<text x="10" y="124" fill="var(--ink-soft)">账本</text>
<rect x="80" y="40" width="330" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="245" y="61" text-anchor="middle" fill="var(--mem)">T1 的 draft:before → after</text>
<rect x="250" y="160" width="120" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="310" y="179" text-anchor="middle" fill="var(--compute)">T2 的 classify</text>
<line x1="80" y1="74" x2="80" y2="116" stroke="var(--mem)" stroke-dasharray="3 2"/>
<line x1="410" y1="74" x2="410" y2="116" stroke="var(--mem)" stroke-dasharray="3 2"/>
<line x1="310" y1="160" x2="310" y2="124" stroke="var(--compute)" stroke-dasharray="3 2"/>
<text x="80" y="140" text-anchor="middle" fill="var(--ink-soft)">读一次</text>
<text x="410" y="140" text-anchor="middle" fill="var(--ink-soft)">再读一次</text>
<text x="310" y="210" text-anchor="middle" fill="var(--ink-faint)">T2 记的这一笔落在 T1 的两次读数之间</text>
<text x="500" y="61" fill="var(--ink)">T1 多算了 T2 的钱</text>
</g>
</svg>
<figcaption>差值法本身没错,错在「账本被别人同时写」。修法是每个请求一本自己的账。</figcaption>
</figure>

### 先用假模型复现

这种 bug 不报错、不崩,只是数字悄悄不对,所以一定要先复现出来。用 Day 463 的假零件,不花钱。为了让两张工单的调用交错起来,给假模型的起草加 0.2 秒延时,模拟真模型逐字输出要花时间:

```python
# supportpilot/scratch/d467/race.py
"""复现并发成本 bug:两张工单同时跑,共用一个 Deps(也就共用一个 LLM 账本)。假模型,不花钱。"""

import sys
import time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, "tests")

from fakes import FakeLLM, FakeTools, make_deps
from test_memory import DRAFT, TICKET, TRIAGE

from supportpilot.agent.graph import build_graph


class SlowLLM(FakeLLM):
    """起草时睡 0.2 秒,模拟真模型逐字输出要花时间,让两张工单的调用交错起来。"""

    def stream(self, messages, on_token=None, **kw):
        time.sleep(0.2)
        return super().stream(messages, on_token, **kw)


def run_one(deps, tid: str) -> float:
    graph = build_graph(deps)
    out = graph.invoke({"ticket": {**TICKET, "id": tid}})
    return out["cost_cny"]


if __name__ == "__main__":
    alone = run_one(make_deps(SlowLLM(TRIAGE, [], DRAFT), FakeTools(customer={"id": "C0010"})), "T1")
    print(f"单独跑一张: ¥{alone:.5f}")

    shared = make_deps(SlowLLM(TRIAGE, [], DRAFT), FakeTools(customer={"id": "C0010"}))
    with ThreadPoolExecutor(max_workers=2) as pool:
        costs = list(pool.map(lambda tid: run_one(shared, tid), ["T1", "T2"]))
    print("共用 deps 同时跑两张:", [f"¥{c:.5f}" for c in costs], f"合计 ¥{sum(costs):.5f}")
    print(f"账本里实际花了: ¥{shared.spent():.5f}")
```

<div class="line-notes">

- `from concurrent.futures import ThreadPoolExecutor` 标准库的线程池。一个线程就是同一个进程里的一条「执行线」,几条线可以同时往前走。这里用它模拟「两个 HTTP 请求同时进来」,FastAPI 内部做的也是类似的事。
- `sys.path.insert(0, "tests")` 在 supportpilot 根目录运行,把 tests 放进搜索路径,才能 import Day 463 的 fakes(Day 465 练习 1 用过)。
- `from test_memory import DRAFT, TICKET, TRIAGE` 复用 Day 464 测试里吴刚那张工单和剧本,TRIAGE 是不需要查账的分诊结果,所以图会走 classify → retrieve → draft → check → finalize。
- `class SlowLLM(FakeLLM):` 继承假模型,只覆盖 `stream`,其他照旧。
- `time.sleep(0.2)` 线程睡 0.2 秒,这段时间里另一个线程会接着跑。没有这一行,假模型太快,两张工单几乎不会重叠,bug 就不出现。
- `def run_one(deps, tid: str) -> float:` 用给定的 deps 跑一张工单,返回状态里累计的 `cost_cny`,也就是各节点「差值」加起来的总数。
- `out = graph.invoke({"ticket": {**TICKET, "id": tid}})` `{**TICKET, "id": tid}` 复制一份工单只改编号,相当于 JS 的 `{...TICKET, id: tid}`。
- `alone = run_one(make_deps(SlowLLM(TRIAGE, [], DRAFT), FakeTools(customer={"id": "C0010"})), "T1")` 先单独跑一张,得到「正确答案」:实测 0.00352 元。算一下:分诊和质检各一次 structured(100 输入、20 输出),起草一次 stream(800、150),按 `.env` 里每百万 token 输入 2 元、输出 8 元,是 0.00036 × 2 + 0.0028 = 0.00352。
- `shared = make_deps(SlowLLM(TRIAGE, [], DRAFT), FakeTools(customer={"id": "C0010"}))` 一份 deps,两张工单共用,和服务端的情况一样。
- `with ThreadPoolExecutor(max_workers=2) as pool:` 开一个两条线的池子,`with` 结束时等所有任务跑完再往下走。
- `costs = list(pool.map(lambda tid: run_one(shared, tid), ["T1", "T2"]))` `pool.map` 把两个工单号分给两条线同时跑,按输入顺序收回结果。有点像 JS 的 `await Promise.all(["T1","T2"].map(runOne))`,区别是这里是真的两条线在同时跑 Python 代码,而不是一条线轮流处理回调。
- `print(f"账本里实际花了: ¥{shared.spent():.5f}")` 共用账本记下的才是真实总花费。

</div>

在 supportpilot 根目录跑:

```bash
mkdir -p scratch/d467
uv run python scratch/d467/race.py
```

真实输出:

```text
单独跑一张: ¥0.00352
共用 deps 同时跑两张: ['¥0.00388', '¥0.00668'] 合计 ¥0.01056
账本里实际花了: ¥0.00704
```

两张一模一样的工单,一张算出 0.00388,一张算出 0.00668,都不是正确的 0.00352。拆开看:T1 多了 0.00036,正好是 T2 的一次分诊或质检;T2 多了 0.00316,是 T1 的一次起草(0.0028)加一次结构化调用(0.00036)。两张加起来 0.01056,比账本里真实的 0.00704 多出整整一张工单的钱,重叠区间里的花费被两边各算了一遍。

我连跑了几次,数字都一样,因为假模型的延时是固定的。真模型下每次都不一样,更难查。等你在 Day 485 的成本看板上看到「draft 节点平均成本比上周涨了 30%」,很可能会花一下午去查提示词是不是变长了。

### 修法:每个请求一本新账本

思路很简单:每个请求用一份新的 LLM 客户端,账本从 0 开始,各记各的;检索器(内存里有 BM25 索引)、数据库连接这些建一次很贵的东西照样共用。

先给 `LLMClient` 加一个方法。打开 Day 457 的 `src/supportpilot/llm.py`,文件开头的导入里加 `import copy`,类里 `__init__` 后面加:

```python
# supportpilot/src/supportpilot/llm.py(LLMClient 里新增的方法)
    def fresh(self) -> "LLMClient":
        """Day 467:同样的配置和 HTTP 客户端,一本新账本。每个 HTTP 请求用一份,各记各的账。"""
        c = copy.copy(self)
        c.ledger = Usage()
        return c
```

<div class="line-notes">

- `def fresh(self) -> "LLMClient":` 返回类型写成字符串,因为在类自己的定义体里,`LLMClient` 这个名字还没定义完,这叫前向引用。
- `c = copy.copy(self)` 浅拷贝:新对象的每个属性都指向原来那个值,相当于 JS 的 `Object.assign(Object.create(Object.getPrototypeOf(this)), this)`。所以 `c.client`(openai 的 HTTP 客户端,内部有连接池)、`c.s`(配置)、`c.model` 都和原来共用,不会每个请求重新建连接。
- `c.ledger = Usage()` 只把账本换成新的。注意是「换」,不是改原来那个对象:要是写成 `c.ledger.prompt_tokens = 0`,改的是两边共用的同一本账。

</div>

然后是 `agent/deps.py`。导入那行改成 `from dataclasses import dataclass, replace`,在 `from_conn` 后面加:

```python
# supportpilot/src/supportpilot/agent/deps.py(Deps 里新增的方法)
    def fresh(self) -> "Deps":
        """Day 467:每个请求一份新的 LLM 客户端(各自的账本),检索器、数据库这些重的东西共用。"""
        llm = self.llm.fresh()
        small = llm if self.small_llm is self.llm else self.small_llm.fresh()
        return replace(self, llm=llm, small_llm=small)
```

<div class="line-notes">

- `llm = self.llm.fresh()` 主模型换一本新账。
- `small = llm if self.small_llm is self.llm else self.small_llm.fresh()` 没配小模型时,`from_conn` 里 `small_llm` 和 `llm` 是同一个对象(Day 459)。新的这份也要保持「是同一个对象」,否则 `spent()` 里 `if self.small_llm is not self.llm` 这个判断就失效了,同一笔花费会加两遍。`is` 比的是「是不是同一个对象」,相当于 JS 的 `===` 比对象引用。
- `return replace(self, llm=llm, small_llm=small)` `dataclasses.replace` 复制一个 dataclass,只换掉指定的字段,其余字段还指向原来的对象,相当于 JS 的 `{...deps, llm, small_llm}`。retriever、call_tool 这些都没复制。

</div>

假模型也要有这个方法,否则测试里一调 `fresh()` 就报 AttributeError。`tests/fakes.py` 开头加 `import copy`,`FakeLLM.__init__` 后面加一段一模一样的:

```python
# supportpilot/tests/fakes.py(FakeLLM 里新增的方法)
    def fresh(self) -> "FakeLLM":
        """Day 467:和 LLMClient.fresh 一样,新账本,剧本和记录照旧共用。"""
        c = copy.copy(self)
        c.ledger = Usage()
        return c
```

<div class="line-notes">

- `c = copy.copy(self)` 剧本(分诊结果、act 的调用序列、草稿)和 Day 465 加的 `summary_inputs` 记录都共用,只有账本是新的。

</div>

### 修完再测,顺着找到第二个漏洞

修好以后再跑一遍,而且顺手想一想:Deps 里还有没有别的地方「偷偷拿着」旧的客户端?有。昨天的 `from_conn` 里写的是 `profile_for=partial(get_or_build_profile, conn, small)`,`partial` 在服务启动时就把那个 `small` 固定进去了。`fresh()` 换掉了 `deps.small_llm`,可 `profile_for` 里抓着的还是启动时那一个,画像重写的钱会记到共用账本上,当前工单的 `cost_cny` 里没有它。

这就是昨天明天预告里说的「load_customer 新加的那行 `before = deps.spent()` 也会被这个 bug 影响」。写个脚本对比一下:

```python
# supportpilot/scratch/d467/race_fixed.py
"""修好以后:每张工单用 deps.fresh(),各记各的账。再看画像的钱有没有记对地方。"""

from concurrent.futures import ThreadPoolExecutor

from race import TICKET, SlowLLM, run_one
from fakes import FakeTools, make_deps
from test_memory import DRAFT, TRIAGE

from supportpilot.memory.profile import PROFILE_PROMPT

shared = make_deps(SlowLLM(TRIAGE, [], DRAFT), FakeTools(customer={"id": "C0010"}))
with ThreadPoolExecutor(max_workers=2) as pool:
    costs = list(pool.map(lambda tid: run_one(shared.fresh(), tid), ["T1", "T2"]))
print("每张一份 fresh():", [f"¥{c:.5f}" for c in costs])

ASK = [{"role": "system", "content": PROFILE_PROMPT}, {"role": "user", "content": "{}"}]
for name, fn in [("闭包里抓的模型", lambda llm, cid, tid: shared.small_llm.chat(ASK).content),
                 ("调用时传进来的", lambda llm, cid, tid: llm.chat(ASK).content)]:
    shared.profile_for = fn
    print(f"画像用{name}: ¥{run_one(shared.fresh(), 'T3'):.5f}")
```

<div class="line-notes">

- `from race import TICKET, SlowLLM, run_one` 同目录的 race.py 当模块导入。race.py 的主程序放在 `if __name__ == "__main__":` 下面,所以导入时不会把上一个实验再跑一遍(Day 32)。race.py 里已经把 tests 加进了搜索路径,下一行的 `from fakes import` 才找得到。
- `costs = list(pool.map(lambda tid: run_one(shared.fresh(), tid), ["T1", "T2"]))` 和上一个脚本唯一的区别:每张工单拿 `shared.fresh()`,不再直接用 `shared`。
- `ASK = [{"role": "system", "content": PROFILE_PROMPT}, {"role": "user", "content": "{}"}]` 一个假的画像请求。FakeLLM 看到 PROFILE_PROMPT 会走 Day 466 加的分支,用 chat 记一笔 300/50 的账,也就是 0.001 元。
- `for name, fn in [("闭包里抓的模型", lambda llm, cid, tid: shared.small_llm.chat(ASK).content),` 第一种模拟昨天的写法:函数里用的是外面固定住的那个客户端,不管调用方传什么。这种「函数记住了外面的变量」就叫闭包,`partial` 固定参数本质上也是这样。
- `("调用时传进来的", lambda llm, cid, tid: llm.chat(ASK).content)]:` 第二种:用调用方传进来的 `llm`,也就是当前请求 fresh 出来的那个。
- `shared.profile_for = fn` 换上要试的那种。`shared.fresh()` 用 `replace` 复制,会把这个字段原样带过去。

</div>

```bash
uv run python scratch/d467/race_fixed.py
```

真实输出:

```text
每张一份 fresh(): ['¥0.00352', '¥0.00352']
画像用闭包里抓的模型: ¥0.00352
画像用调用时传进来的: ¥0.00452
```

第一行:两张都是正确的 0.00352。后两行才是重点:同样调了一次画像,闭包版的工单成本还是 0.00352,那 0.001 元记到共用账本上去了,哪张工单都不认领;传参版是 0.00452,画像的钱进了当前工单。

所以 `profile_for` 的签名要改:不在启动时固定模型,而是每次调用时由节点把自己手上的 `deps.small_llm` 传进去。三处改动:

```python
# supportpilot/src/supportpilot/agent/deps.py(两处改动)
    # Day 466:客户画像。Day 467 改成调用时把模型传进来:(llm, customer_id, 当前工单号) -> 画像文本
    profile_for: Callable[[LLMClient, str, str | None], str] = lambda llm, customer_id, ticket_id: ""

                   profile_for=partial(get_or_build_profile, conn))
```

<div class="line-notes">

- `profile_for: Callable[[LLMClient, str, str | None], str] = lambda llm, customer_id, ticket_id: ""` 参数多了第一个 `llm`。`get_or_build_profile(conn, llm, customer_id, exclude_ticket)` 的参数顺序正好是这样,所以 partial 只固定 conn 就行。
- `profile_for=partial(get_or_build_profile, conn))` `from_conn` 末尾,把昨天的 `, small` 删掉。

</div>

```python
# supportpilot/src/supportpilot/agent/nodes.py(load_customer 里改一行)
        profile = deps.profile_for(deps.small_llm, customer["id"], tid) if customer else ""   # Day 466/467
```

<div class="line-notes">

- `profile = deps.profile_for(deps.small_llm, customer["id"], tid) if customer else ""   # Day 466/467` 此时的 `deps` 是请求自己的那份,`deps.small_llm` 就是 fresh 出来的客户端。

</div>

最后是 Day 466 的 `tests/test_profile.py`,里面两个 lambda 要多接一个参数:`lambda cid, tid:` 改成 `lambda llm, cid, tid:`,共两处。不改的话跑测试会报 `TypeError: <lambda>() takes 2 positional arguments but 3 were given`。

我写 Day 466 时完全没想到这一层,是写今天的接口、开始想「多个请求同时跑会怎样」才发现的。服务化的时候,把每个全局共享的对象过一遍「并发时会不会串」,再把每个 `partial` 和闭包过一遍「它抓住的是不是那个共享对象」,这个习惯很值钱。

## 第二步:FastAPI 自带的 SSE

Day 379 写 SSE 服务端时,用的是最底层的办法:`StreamingResponse` 加自己拼 `event: …\ndata: …\n\n` 字符串。FastAPI 从 0.135.0 开始自带了 SSE 支持(官方文档写着「Added in FastAPI 0.135.0」),我 2026 年 10 月装的是 0.159.1。它帮你做三件事:按 SSE 格式编码、设好防缓存的响应头、15 秒没事件就自动发一个心跳。今天直接用它,不再装第三方的 sse-starlette。

先用一个最小脚本看清楚它的用法和线上格式,不起服务:

```python
# supportpilot/scratch/d467/sse_hello.py
"""FastAPI 自带的 SSE:一个接口 yield 三个事件,看线上格式。不调模型,不起服务。"""

from collections.abc import Iterator
from datetime import datetime

from fastapi import FastAPI
from fastapi.sse import EventSourceResponse, ServerSentEvent
from fastapi.testclient import TestClient

app = FastAPI()
payload = {"text": "您好", "at": datetime(2026, 10, 22, 9, 0)}


@app.post("/hello", response_class=EventSourceResponse)
def hello() -> Iterator[ServerSentEvent]:
    yield ServerSentEvent(event="token", data=payload)
    yield ServerSentEvent(event="token", raw_data='{"text": "您好"}')
    yield ServerSentEvent(event="note", raw_data="第一行\n第二行")


r = TestClient(app).post("/hello")
print(r.headers["content-type"], r.headers["cache-control"], r.headers["x-accel-buffering"])
print(r.text)
```

<div class="line-notes">

- `from fastapi.sse import EventSourceResponse, ServerSentEvent` 两个名字:前者是响应类型,告诉 FastAPI「这个接口返回事件流」;后者表示一条事件,有 event、data、raw_data、id、retry、comment 几个字段。
- `from fastapi.testclient import TestClient` Day 79 练习里用过,不启动服务就能发请求。
- `@app.post("/hello", response_class=EventSourceResponse)` 关键是 `response_class`。SSE 不限 GET,POST 也行,今天的接口要带请求体,都用 POST。
- `def hello() -> Iterator[ServerSentEvent]:` 函数体里有 `yield`,它就是一个生成器([Day 99](/blog/agent-zero/day-099-generators/)):每 `yield` 一次,FastAPI 就把这一条编码好发出去,不用等函数结束。返回类型写 `Iterator[ServerSentEvent]`,意思是「会一个个产出事件」。
- `yield ServerSentEvent(event="token", data=payload)` `data` 会被 FastAPI 自动转成 JSON,datetime 也能转。代价看下面的输出:中文被转成了 `您好`。
- `yield ServerSentEvent(event="token", raw_data='{"text": "您好"}')` `raw_data` 原样发出,不做 JSON 编码。我们自己用 `json.dumps(..., ensure_ascii=False)` 序列化好再传进来,中文就是中文。两个字段只能二选一,同时给会报错。
- `yield ServerSentEvent(event="note", raw_data="第一行\n第二行")` 故意放一个带换行的字符串,看它怎么编码。
- `print(r.headers["content-type"], r.headers["cache-control"], r.headers["x-accel-buffering"])` 看 FastAPI 自动设的三个响应头。

</div>

```bash
uv run python scratch/d467/sse_hello.py
```

真实输出:

```text
text/event-stream; charset=utf-8 no-cache no
event: token
data: {"text": "您好", "at": "2026-10-22T09:00:00"}

event: token
data: {"text": "您好"}

event: note
data: 第一行
data: 第二行

```

几处要看清楚。`no-cache` 让浏览器和代理别缓存这个流;`x-accel-buffering: no` 是写给 nginx 的,让它收到一点就转发一点,不要攒够了再发,否则打字机效果会变成一顿一顿的。

用 `data` 时中文变成了 `\u` 转义。浏览器 `JSON.parse` 照样能还原,功能上没问题,但一个汉字从 3 个字节变成 6 个字节,在 curl 和 DevTools 里也没法读。一次工单要推几十上百个 token 事件,我选 `raw_data` 加自己序列化。

带换行的字符串被拆成了两行 `data:`,前端按 SSE 规范会把它们用换行拼回来。我们的 data 都是不带缩进的 JSON,永远只有一行,不用操心这个。

## 第三步:接口设计

六个接口,对应一张工单的一生:

| 方法 | 路径 | 作用 | 返回 |
| --- | --- | --- | --- |
| POST | `/tickets` | 建工单,写进 biz.tickets | `{"ticket_id"}` |
| POST | `/tickets/{id}/run` | 第一次处理这张工单 | SSE 流 |
| POST | `/tickets/{id}/messages` | 客户追问 | SSE 流 |
| GET | `/tickets/{id}` | 当前状态:结果、成本、是否在等审批 | JSON |
| GET | `/approvals` | 所有待审批的退款 | JSON 列表 |
| POST | `/approvals/{id}` | 审批,恢复工作流 | SSE 流 |

几个设计上的决定,先说清楚再看代码。

**建工单和跑工单分开。** 合成一个接口也能做,但分开以后,建工单可以来自任何渠道(网页表单、邮件网关、企业微信机器人),跑工单可以是用户在页面上触发,也可以以后改成后台队列触发(Day 387 讲过什么活要进队列)。前端先拿到 ticket_id 再去连流,断线重连时也知道自己在跑哪一张。

**能提前判断的错误,在流开始之前就返回。** 工单不存在是 404,工单还停在审批节点时追问是 409(Conflict,「和资源当前的状态冲突」),审批一个不在等审批的工单也是 409。这些检查都写成依赖(`Depends`,Day 81),FastAPI 会在调用接口函数之前先跑依赖,依赖里抛 HTTPException 就直接返回对应的状态码。为什么非得放进依赖,不能在接口函数里判断,后面「故意犯错」会实测。

**追问时工单在等审批,返回 409 而不是默默排队。** 排队的话,用户发了一句话却迟迟没有反应。409 让前端明确地告诉用户「审批完成后才能继续」。

**审批接口也是流式的。** 审批后工作流要从 approval 节点接着跑 finalize,前端要看到最终回复。

**每个请求现编译一张图。** 用 `deps.fresh()` 拿一份新账本,checkpointer 共用,它本来就是靠 thread_id(工单号)区分不同工单的。编译一张十个节点的图是毫秒级的事。

`uv add fastapi uvicorn`(我装到的是 fastapi 0.159.1、uvicorn 0.54.0),然后新建 `src/supportpilot/api/__init__.py`(空文件)和 `api/app.py`:

```python
# supportpilot/src/supportpilot/api/app.py
"""SupportPilot 的 HTTP 接口。启动:uv run uvicorn supportpilot.api.app:app --port 8000

  POST /tickets                  建工单,返回 ticket_id
  POST /tickets/{id}/run         第一轮处理,SSE 推过程
  POST /tickets/{id}/messages    客户追问,SSE 推过程
  GET  /tickets/{id}             当前状态
  GET  /approvals                待审批的退款
  POST /approvals/{id}           审批,SSE 推恢复后的过程
"""

import json
import logging
import os
from collections.abc import Iterator
from contextlib import asynccontextmanager
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.sse import EventSourceResponse, ServerSentEvent
from langchain_core.runnables import RunnableConfig
from langgraph.types import Command
from pydantic import BaseModel, Field

from ..agent.deps import Deps
from ..agent.graph import build_graph
from ..db import connect
from ..memory.checkpoint import make_checkpointer
from ..tools import business as biz

log = logging.getLogger("supportpilot.api")
R: dict[str, Any] = {}  # 进程级资源:数据库连接、checkpointer、基础 deps。测试里直接往这里塞假的


@asynccontextmanager
async def lifespan(app: FastAPI):
    R["conn"] = connect()
    R["saver"] = make_checkpointer()
    R["deps"] = Deps.from_conn(R["conn"])
    yield
    R["conn"].close()


app = FastAPI(title="SupportPilot", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,  # 前端开在别的端口,浏览器会先发预检。只放行自己的前端地址,别写 "*"
    allow_origins=os.getenv("SUPPORTPILOT_WEB_ORIGINS", "http://localhost:3000").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["content-type", "accept"],
)


class NewTicket(BaseModel):
    customer_email: str = Field(max_length=200)
    subject: str = Field(max_length=200)
    body: str = Field(max_length=4000)


class Message(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


class Decision(BaseModel):
    approved: bool
    approver: str
    note: str = ""


def _cfg(ticket_id: str) -> RunnableConfig:
    return {"configurable": {"thread_id": ticket_id}}


def get_graph():
    """每个请求现编译一张图:deps 用 fresh() 拿新账本,checkpointer 共用。"""
    return build_graph(R["deps"].fresh(), checkpointer=R["saver"])


Graph = Annotated[Any, Depends(get_graph)]


def ticket_row(ticket_id: str) -> dict:
    row = R["conn"].execute("SELECT id, customer_email, subject, body FROM biz.tickets WHERE id = %s",
                            (ticket_id,)).fetchone()
    if not row:
        raise HTTPException(404, "工单不存在")
    return dict(row)


def idle_thread(ticket_id: str, graph: Graph) -> str:
    snap = graph.get_state(_cfg(ticket_id))
    if not snap.values:
        raise HTTPException(404, "工单还没有处理过,先调 /run")
    if snap.next:
        raise HTTPException(409, "工单还在等待审批,审批完成后才能继续对话")
    return ticket_id


def waiting_approval(ticket_id: str, graph: Graph) -> str:
    snap = graph.get_state(_cfg(ticket_id))
    if not snap.values:
        raise HTTPException(404, "工单不存在或还没有处理过")
    if "approval" not in snap.next:
        raise HTTPException(409, "这个工单不在等待审批")
    return ticket_id


def _summary(graph, ticket_id: str) -> dict:
    snap = graph.get_state(_cfg(ticket_id))
    v = snap.values
    return {"ticket_id": ticket_id, "outcome": v.get("outcome") or ("waiting_approval" if snap.next else None),
            "category": v.get("triage", {}).get("category"), "reply": v.get("reply"),
            "turns": len(v.get("turns", [])), "cost_cny": round(v.get("cost_cny", 0.0), 5),
            "waiting_on": list(snap.next)}


def _sse(event: str, data: Any) -> ServerSentEvent:
    """自己序列化:中文原样输出,datetime 之类转字符串。JSON 不带缩进,保证只有一行。"""
    return ServerSentEvent(event=event, raw_data=json.dumps(data, ensure_ascii=False, default=str))


def _events(graph, payload: Any, ticket_id: str) -> Iterator[ServerSentEvent]:
    """把 LangGraph 的流翻译成前端认识的七种事件。同步生成器,FastAPI 会放进线程池里跑。"""
    try:
        for mode, chunk in graph.stream(payload, _cfg(ticket_id), stream_mode=["updates", "custom"]):
            if mode == "custom":
                yield _sse(chunk["type"], chunk)
                continue
            for node, update in chunk.items():
                if node == "__interrupt__":
                    yield _sse("interrupt", update[0].value)
                else:
                    yield _sse("node", {"node": node})
    except Exception:
        log.exception("ticket %s failed", ticket_id)  # 细节写服务端日志,不推给浏览器
        yield _sse("error", {"message": "处理出错了,已经记录,请稍后重试"})
        return
    yield _sse("done", _summary(graph, ticket_id))


@app.post("/tickets")
def create_ticket(t: NewTicket) -> dict:
    return {"ticket_id": biz.create_ticket(R["conn"], t.customer_email, t.subject, t.body)}


@app.post("/tickets/{ticket_id}/run", response_class=EventSourceResponse)
def run_ticket(ticket: Annotated[dict, Depends(ticket_row)], graph: Graph) -> Iterator[ServerSentEvent]:
    yield from _events(graph, {"ticket": ticket}, ticket["id"])


@app.post("/tickets/{ticket_id}/messages", response_class=EventSourceResponse)
def follow_up(m: Message, ticket_id: Annotated[str, Depends(idle_thread)],
              graph: Graph) -> Iterator[ServerSentEvent]:
    yield from _events(graph, {"turns": [{"role": "customer", "content": m.content}]}, ticket_id)


@app.get("/tickets/{ticket_id}")
def get_ticket(ticket_id: str, graph: Graph) -> dict:
    if not graph.get_state(_cfg(ticket_id)).values:
        raise HTTPException(404, "工单还没有处理过")
    return _summary(graph, ticket_id)


@app.get("/approvals")
def list_approvals() -> list[dict]:
    rows = R["conn"].execute(
        "SELECT r.id, r.ticket_id, r.amount_cny, r.rule, r.reason, r.created_at, c.name AS customer_name "
        "FROM biz.refund_requests r JOIN biz.customers c ON c.id = r.customer_id "
        "WHERE r.status = 'pending' ORDER BY r.created_at").fetchall()
    return [biz._jsonable(r) | {"created_at": str(r["created_at"])} for r in rows]


@app.post("/approvals/{ticket_id}", response_class=EventSourceResponse)
def decide(d: Decision, ticket_id: Annotated[str, Depends(waiting_approval)],
           graph: Graph) -> Iterator[ServerSentEvent]:
    yield from _events(graph, Command(resume=d.model_dump()), ticket_id)
```

<div class="line-notes">

- `"""SupportPilot 的 HTTP 接口。启动:` 文件开头把六个接口列一遍,打开文件就知道这个服务能干什么。Day 446 的 Makefile 里 `make api` 跑的就是这一条(多了 `--reload`,改了代码自动重启)。
- `from fastapi.sse import EventSourceResponse, ServerSentEvent` 第二步刚试过的两个名字。
- `from langgraph.types import Command` 审批恢复用 `Command(resume=...)`,把审批结果作为 approval 节点里 `interrupt()` 的返回值送回去(Day 320)。
- `log = logging.getLogger("supportpilot.api")` 按模块名取 logger(Day 75),出错时把完整堆栈写进服务端日志。
- `R: dict[str, Any] = {}  # 进程级资源` 一个模块级字典当「资源袋」:lifespan 往里放,接口从里面取,测试可以直接往里塞假零件,不用写 `global`。
- `@asynccontextmanager` lifespan 的写法:`yield` 之前的代码在服务启动时跑一次,之后的在服务关闭时跑一次。相当于 Node 里 `server.listen` 之前做初始化、`process.on("SIGTERM")` 里收尾。
- `R["conn"] = connect()` 一条 psycopg 连接全进程共用。psycopg 3 的连接可以跨线程用,但同一时刻只执行一条语句,并发高了会排队。演示够用,Day 490 部署前要换成连接池。
- `R["saver"] = make_checkpointer()` Day 464 的 PostgresSaver。工单停在审批时,状态就存在 checkpoint 表里,服务重启了审批照样能接上。
- `R["deps"] = Deps.from_conn(R["conn"])` 基础 deps 只建一次,BM25 索引建一次就够。各请求用的是它 `fresh()` 出来的副本。
- `R["conn"].close()` 服务关闭时把连接关掉。
- `CORSMiddleware,  # 前端开在别的端口` 前端开发服务器在 3000 端口、接口在 8000,端口不同就是不同源,浏览器会先发一个 OPTIONS 预检请求问「允不允许」。这个中间件负责回答。
- `allow_origins=os.getenv("SUPPORTPILOT_WEB_ORIGINS", "http://localhost:3000").split(","),` 允许的前端地址从环境变量读,逗号分隔,默认只放行本机 3000。别图省事写 `["*"]`,那等于任何网站都能在用户的浏览器里调你的审批接口。
- `allow_headers=["content-type", "accept"],` 前端的 fetch 只会带这两个请求头,放行多了没用。
- `customer_email: str = Field(max_length=200)` 请求体模型(Day 80)。超长的请求在进函数之前就被 pydantic 拦下,返回 422,不会写进数据库,也不会把一万字塞给模型。
- `content: str = Field(min_length=1, max_length=4000)` 追问内容不能是空字符串。空消息进图里,模型会对着空气写回复。
- `class Decision(BaseModel):` 审批的请求体。`approver` 没有默认值,必须传:每一笔退款都要记下是谁批的,`decide_refund` 会把它写进审计日志。
- `def _cfg(ticket_id: str) -> RunnableConfig:` thread_id 就是工单号。返回类型标成 `RunnableConfig`,传给 `graph.stream` 时 basedpyright 才不报错。
- `def get_graph():` 一个依赖函数,每个请求调一次:`fresh()` 出新账本,编译一张图,checkpointer 共用。
- `Graph = Annotated[Any, Depends(get_graph)]` 给「依赖注入一张图」起个别名,下面的接口和依赖函数写 `graph: Graph` 就行,省得每处都写一长串。`Annotated[类型, 附加信息]` 是 Day 81 用过的写法。FastAPI 对同一个请求里的同一个依赖只调一次:我实测审批一个不存在的工单,`waiting_approval` 和 `decide` 都要 Graph,`build_graph` 只被调了 1 次。
- `def ticket_row(ticket_id: str) -> dict:` 依赖函数的参数名 `ticket_id` 和路径里的 `{ticket_id}` 同名,FastAPI 会自动把路径参数传进来。
- `raise HTTPException(404, "工单不存在")` 依赖里抛异常,接口函数根本不会被调用,客户端收到的是一个普通的 404 JSON。
- `return dict(row)` psycopg 的行对象转成普通字典,才能放进图的状态。
- `def idle_thread(ticket_id: str, graph: Graph) -> str:` 追问前的检查。名字的意思是「这个 thread 现在空闲,没有卡在某个节点上」。
- `snap = graph.get_state(_cfg(ticket_id))` 从 checkpointer 读这张工单的最新快照(Day 464)。
- `if not snap.values:` 没跑过的工单,checkpointer 里没有状态,`values` 是空字典。
- `if snap.next:` `next` 是「接下来要跑的节点」。图跑完了它是空元组,停在审批时是 `('approval',)`。
- `if "approval" not in snap.next:` 审批前的检查:只有真的停在 approval 节点才能批。
- `def _summary(graph, ticket_id: str) -> dict:` 从快照里挑前端需要的几个字段,done 事件和 GET 接口共用。
- `"outcome": v.get("outcome") or ("waiting_approval" if snap.next else None),` outcome 只有 finalize 和 handoff 才写。停在审批时还没写,就用 `snap.next` 不为空推断成 waiting_approval。
- `"turns": len(v.get("turns", [])), "cost_cny": round(v.get("cost_cny", 0.0), 5),` 只给对话条数,不给全文;成本保留 5 位小数。`cost_cny` 是各节点差值累加出来的,修了并发 bug 以后它才可信。
- `"waiting_on": list(snap.next)}` 元组转成列表,JSON 才认。
- `return ServerSentEvent(event=event, raw_data=json.dumps(data, ensure_ascii=False, default=str))` 第二步讲过为什么用 raw_data。`default=str`:遇到 json 不认识的类型(datetime、Decimal)一律转字符串。
- `def _events(graph, payload: Any, ticket_id: str) -> Iterator[ServerSentEvent]:` 整个接口层的核心,把 LangGraph 的流翻译成前端认识的事件。三个流式接口都用它,区别只在 payload。
- `for mode, chunk in graph.stream(payload, _cfg(ticket_id), stream_mode=["updates", "custom"]):` 两种模式一起开,每个元素是 `(模式, 数据)` 二元组(Day 323 讲过这种写法)。updates 是每个节点跑完后的状态更新;custom 是节点里 `_emit()` 主动推的字典(Day 460)。
- `if mode == "custom":` custom 的数据自带 `type` 字段,是 step、tool、token 三种之一。
- `yield _sse(chunk["type"], chunk)` 直接拿 `type` 当事件名,数据原样推。
- `for node, update in chunk.items():` updates 的数据是 `{节点名: 这个节点返回的更新}`,一次一个节点。
- `if node == "__interrupt__":` 图停在 `interrupt()` 时,LangGraph 用这个特殊的键报告。
- `yield _sse("interrupt", update[0].value)` `update` 是 Interrupt 对象组成的元组,`.value` 就是 approval 节点传给 `interrupt()` 的那个字典。
- `yield _sse("node", {"node": node})` 别的节点只推名字,不推整份更新。更新里有整段草稿、工具结果、客户档案,太大,而且有些不该给客户看。
- `except Exception:` 图里任何节点抛异常,都在这里接住。不接的话生成器直接中断,客户端看到连接断了,不知道发生了什么。
- `log.exception("ticket %s failed", ticket_id)  # 细节写服务端日志,不推给浏览器` `log.exception` 会把完整堆栈一起写进日志。异常信息里可能有 SQL、内部编号,甚至别的客户的数据,只写日志,不推给前端。
- `yield _sse("error", {"message": "处理出错了,已经记录,请稍后重试"})` 给前端一条固定的、能直接显示给用户看的话。
- `return` 出错了就不再推 done。前端约定:一个流以 done 或 error 结束,二者只有一个。
- `yield _sse("done", _summary(graph, ticket_id))` 正常跑完,或者停在了 interrupt,都推一条 done。
- `def create_ticket(t: NewTicket) -> dict:` 普通 JSON 接口。`biz.create_ticket` 是 Day 452 的业务函数,按邮箱找客户、生成下一个工单号。
- `@app.post("/tickets/{ticket_id}/run", response_class=EventSourceResponse)` 流式接口三件套:`response_class`、函数里 `yield`、返回类型 `Iterator[ServerSentEvent]`。
- `def run_ticket(ticket: Annotated[dict, Depends(ticket_row)], graph: Graph) -> Iterator[ServerSentEvent]:` 参数 `ticket` 由依赖 `ticket_row` 提供,能走到函数体里,说明工单一定存在。
- `yield from _events(graph, {"ticket": ticket}, ticket["id"])` `yield from` 把另一个生成器产出的东西一个个转手产出,相当于 JS 生成器里的 `yield*`。第一轮的输入只有 ticket 这一个字段。
- `def follow_up(m: Message, ticket_id: Annotated[str, Depends(idle_thread)],` 追问:请求体 `m`,工单号由 `idle_thread` 检查过再给。
- `yield from _events(graph, {"turns": [{"role": "customer", "content": m.content}]}, ticket_id)` 只追加一条 turns。turns 在 Day 464 的 state 里用 `operator.add` 累加,给一条就是加一条,不是覆盖。
- `if not graph.get_state(_cfg(ticket_id)).values:` GET 接口不是流式的,直接在函数里判断、抛 404 就行。
- `"SELECT r.id, r.ticket_id, r.amount_cny, r.rule, r.reason, r.created_at, c.name AS customer_name "` 待审批列表只取审批要看的列,JOIN 出客户姓名。
- `return [biz._jsonable(r) | {"created_at": str(r["created_at"])} for r in rows]` `_jsonable` 是 Day 452 的辅助函数,把 Decimal 这类类型转成 JSON 认识的;`|` 合并两个字典,相当于 JS 的 `{...a, ...b}`。
- `yield from _events(graph, Command(resume=d.model_dump()), ticket_id)` `model_dump()` 把 Decision 转成字典,它就是 approval 节点里 `interrupt()` 的返回值。

</div>

### 同步的图,异步的服务

FastAPI 是异步框架,我们的图是同步的:`graph.stream` 是普通生成器,里面的 openai 调用会阻塞等待。如果在 `async def` 的接口里直接跑它,一张工单十几秒的处理时间里,整个服务的事件循环都被卡住,别的请求全部排队。打个前端的比方,就像在浏览器主线程里写了一个跑十秒的 `while` 循环,页面整个冻住。

所以接口都写成普通 `def`。FastAPI 看到同步的生成器接口,会用线程池一步一步地取(我在 `.venv` 里 `fastapi/routing.py` 看到它用的是 starlette 的 `iterate_in_threadpool`),事件循环只负责把取到的事件发出去,不会被卡住。

另一种做法是整条链路改成异步:LLMClient 用 `AsyncOpenAI`、节点写成 `async def`、用 `graph.astream`、psycopg 换异步连接。性能更好,但要改的地方很多。演示项目用线程池足够了,面试时被问到,说清楚这个取舍就行。也正因为用了线程池,并发成本那个 bug 才真的会发生:几个线程同时在跑不同的工单。

### 故意犯错:在生成器里抛 404

为什么「工单存不存在」一定要放进依赖?直接在流式接口的函数体里判断不行吗?试一下:

```python
# supportpilot/scratch/d467/raise_inside.py
"""故意犯错:在 SSE 生成器里面判断工单存不存在、抛 404,而不是放进依赖。看客户端收到什么。"""

from collections.abc import Iterator

from fastapi import FastAPI, HTTPException
from fastapi.sse import EventSourceResponse, ServerSentEvent
from fastapi.testclient import TestClient

app = FastAPI()


@app.post("/inside/{tid}", response_class=EventSourceResponse)
def inside(tid: str) -> Iterator[ServerSentEvent]:
    if tid != "T1":
        raise HTTPException(404, "工单不存在")
    yield ServerSentEvent(event="done", data={"ok": True})


client = TestClient(app, raise_server_exceptions=False)
r = client.post("/inside/T999")
print(r.status_code, r.headers.get("content-type"), repr(r.text[:80]))
```

<div class="line-notes">

- `def inside(tid: str) -> Iterator[ServerSentEvent]:` 函数体里有 `yield`,整个函数就是生成器。调用它不会执行任何一行,只是拿到一个生成器对象,第一次取值时才从头开始跑。
- `raise HTTPException(404, "工单不存在")` 看起来和普通接口一模一样的 404 写法。
- `client = TestClient(app, raise_server_exceptions=False)` 默认 TestClient 会把服务端异常直接抛到测试里;关掉它,看真实客户端会收到什么。

</div>

```bash
uv run python scratch/d467/raise_inside.py
```

真实输出:

```text
200 text/event-stream; charset=utf-8 ''
```

客户端收到的是 **200**,内容类型是事件流,body 是空的。原因就在生成器的执行时机:FastAPI 拿到生成器、发出 200 和响应头,然后才开始取第一个事件,这时 `raise` 才执行。状态码已经发出去了,改不回来,连接只能直接断掉。前端看到 200 会以为成功了,开始等事件,结果什么都没有。

依赖不一样,它在接口函数被调用之前就跑完了,那时候响应还没开始。所以规则是:**能在开始推流之前判断的错误,都放进依赖;推流过程中才发生的错误,用 error 事件通知。**

## 第四步:SSE 事件协议

前后端约定七种事件:

| event | data 里有什么 | 从哪来 | 前端拿它做什么 |
| --- | --- | --- | --- |
| `node` | `{"node": "classify"}` | updates | 某个节点跑完,进度条打一个勾 |
| `step` | 节点推的细节:分类结果、检索到的文章、质检结论 | custom | 显示细节;质检不通过时提示正在重写 |
| `tool` | 工具名、参数、是否出错 | custom | 显示一张工具调用卡片 |
| `token` | 一小段文字 | custom | 打字机效果 |
| `interrupt` | 退款申请详情和草稿 | updates 里的 `__interrupt__` | 提示「已提交审批」 |
| `error` | 一句给用户看的话 | `_events` 的 except | 显示出错,允许重试 |
| `done` | 最终状态摘要 | 流结束后查一次快照 | 显示最终回复和成本 |

前五种和 Day 380 设计事件协议时的思路一样:前端需要知道的是「进行到哪了」「Agent 做了什么」「说了什么」「要不要人介入」,而不是 LangGraph 内部的状态长什么样。后两种是收尾:**一个流必须以 done 或 error 结束,而且只有一个。** 前端靠它判断这次请求结束了,可以把输入框重新打开。

<figure>
<svg viewBox="0 0 640 320" role="img" aria-label="一张退款工单两次请求的 SSE 事件流时序">
<g font-family="var(--font-mono)" font-size="11">
<text x="80" y="22" text-anchor="middle" fill="var(--ink)">浏览器</text>
<text x="320" y="22" text-anchor="middle" fill="var(--ink)">FastAPI</text>
<text x="540" y="22" text-anchor="middle" fill="var(--mem)">LangGraph(线程池)</text>
</g>
<g stroke="var(--rule)" stroke-dasharray="3 3"><line x1="80" y1="30" x2="80" y2="310"/><line x1="320" y1="30" x2="320" y2="310"/><line x1="540" y1="30" x2="540" y2="310"/></g>
<g font-family="var(--font-mono)" font-size="10.5" fill="var(--ink-soft)">
<line x1="80" y1="50" x2="316" y2="50" stroke="var(--ink-faint)"/><text x="200" y="45" text-anchor="middle">POST /tickets/T000153/run</text>
<line x1="320" y1="65" x2="536" y2="65" stroke="var(--ink-faint)"/><text x="430" y="60" text-anchor="middle">graph.stream(updates+custom)</text>
<line x1="540" y1="90" x2="84" y2="90" stroke="var(--mem)" stroke-dasharray="4 2"/><text x="310" y="85" text-anchor="middle">step / node × 4(load_customer … retrieve)</text>
<line x1="540" y1="115" x2="84" y2="115" stroke="var(--compute)" stroke-dasharray="4 2"/><text x="310" y="110" text-anchor="middle">tool × 4(list_invoices … create_refund_request)</text>
<line x1="540" y1="140" x2="84" y2="140" stroke="var(--mem)" stroke-dasharray="4 2"/><text x="310" y="135" text-anchor="middle">token × 54(打字机)</text>
<line x1="540" y1="165" x2="84" y2="165" stroke="var(--ink-faint)" stroke-dasharray="4 2"/><text x="310" y="160" text-anchor="middle">step(check) / interrupt(等审批)</text>
<line x1="320" y1="190" x2="84" y2="190" stroke="var(--ink-faint)" stroke-dasharray="4 2"/><text x="200" y="185" text-anchor="middle">done(waiting_approval)</text>
<line x1="80" y1="235" x2="316" y2="235" stroke="var(--ink-faint)"/><text x="200" y="230" text-anchor="middle">POST /approvals/T000153 {approved}</text>
<line x1="320" y1="250" x2="536" y2="250" stroke="var(--ink-faint)"/><text x="430" y="245" text-anchor="middle">Command(resume=…)</text>
<line x1="540" y1="275" x2="84" y2="275" stroke="var(--mem)" stroke-dasharray="4 2"/><text x="310" y="270" text-anchor="middle">node approval / node finalize</text>
<line x1="320" y1="298" x2="84" y2="298" stroke="var(--ink-faint)" stroke-dasharray="4 2"/><text x="200" y="293" text-anchor="middle">done(resolved)</text>
</g>
</svg>
<figcaption>一张退款工单是两次请求。第一次在 interrupt 处结束,工单状态存在 Postgres 的 checkpoint 里;审批是另一次请求,用同一个 thread_id 恢复。图里的数字来自下面的真实运行。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1if7E64Ex5&autoplay=0&high_quality=1" title="SSE 到底是什么？用 FastAPI 一次讲透流式响应" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>懂点AI的H先生 · SSE 到底是什么?用 FastAPI 一次讲透流式响应 · 5 分钟,复习 SSE 的格式和 FastAPI 里的写法。它用的是 StreamingResponse 手拼格式,对照着看今天的 EventSourceResponse 省掉了哪些活。</figcaption>
</figure>

## 第五步:真模型跑一遍

起服务之前先重新造数、清快照(Day 464 讲过工单号会重用的坑):

```bash
uv run python scripts/seed_db.py
uv run python -m supportpilot.memory.checkpoint
uv run uvicorn supportpilot.api.app:app --port 8467
```

我实跑用的是 8467 端口,你用 8000 也一样,下面的命令把端口换掉就行。uvicorn 会占住这个终端,再开一个终端窗口,同样 cd 到 supportpilot 目录发请求。

李娜(C0002)上周买了专业版年付,想退款。先建工单:

```bash
curl -s -X POST localhost:8467/tickets -H 'content-type: application/json' \
  -d '{"customer_email":"lina@example.com","subject":"想退款","body":"上周买的专业版年付,用不上,请帮我退款。"}'
```

真实输出 `{"ticket_id":"T000153"}`,种子数据里有 152 张工单。然后跑它。`-N` 让 curl 收到一点就打印一点,不缓冲;`-D h467.txt` 把响应头存进文件:

```bash
curl -s -N -D h467.txt -X POST localhost:8467/tickets/T000153/run > run467.sse
cat h467.txt
head -30 run467.sse
```

响应头(真实输出):

```text
HTTP/1.1 200 OK
date: Thu, 22 Oct 2026 10:53:02 GMT
server: uvicorn
content-type: text/event-stream; charset=utf-8
cache-control: no-cache
x-accel-buffering: no
vary: Origin
Transfer-Encoding: chunked
```

`Transfer-Encoding: chunked` 表示响应体分块发,没有事先声明总长度,这正是流式响应的样子。事件流的开头(真实输出,前 30 行):

```text
event: step
data: {"type": "step", "node": "load_customer", "found": true, "profile": true}

event: node
data: {"node": "load_customer"}

event: step
data: {"type": "step", "node": "prepare_context", "summarized_upto": 0}

event: node
data: {"node": "prepare_context"}

event: step
data: {"type": "step", "node": "classify", "category": "refund"}

event: node
data: {"node": "classify"}

event: step
data: {"type": "step", "node": "retrieve", "docs": ["KB-refund-001", "KB-refund-003", "KB-refund-001", "KB-plans-002", "KB-refund-001"]}

event: node
data: {"node": "retrieve"}

event: tool
data: {"type": "tool", "name": "list_subscriptions", "args": "{\"customer_id\": \"C0002\"}", "error": false}

event: tool
data: {"type": "tool", "name": "list_invoices", "args": "{\"customer_id\": \"C0002\", \"limit\": 10}", "error": false}
```

注意每个节点都是先 step 后 node:节点在执行过程中推 custom,执行完 LangGraph 才发 updates。`"profile": true` 是昨天加的,只推「有画像」,不推画像全文。`args` 里的 `\"` 不是中文转义,是工具参数本身就是一段 JSON 字符串,套在外面这层 JSON 里要转义引号。

用 `grep` 和 `uniq -c` 数一下整个流里各种事件的顺序和个数(连续相同的会合并计数):

```bash
grep "^event:" run467.sse | awk '{print $2}' | uniq -c
```

真实输出:

```text
   1 step
   1 node
   1 step
   1 node
   1 step
   1 node
   1 step
   1 node
   4 tool
   1 node
  54 token
   1 node
   1 step
   1 node
   1 interrupt
   1 done
```

一共 72 个事件,用时 11.7 秒。7 个 node 依次是 load_customer、prepare_context、classify、retrieve、act、draft、check,这一次质检一遍就过了。4 个 tool 是 list_subscriptions、list_invoices、check_refund_eligibility、create_refund_request。interrupt 的 data(真实输出,较长,只摘关键字段):`"type": "refund_approval"`、`"id": "RF-T000153-INV-202609-0002"`、`"amount_cny": 950.0`、`"rule": "annual_first_14_days"`、`"status": "pending"`、`"needs_finance_review": false`(950 没过 1000 的复核线)。最后一条:

```text
event: done
data: {"ticket_id": "T000153", "outcome": "waiting_approval", "category": "refund", "reply": null, "turns": 1, "cost_cny": 0.026, "waiting_on": ["approval"]}
```

`reply` 是 null,因为还没定稿;`cost_cny` 0.026 元,这是这一张工单自己的钱。

接着把其余几个接口挨个打一遍:

```bash
H='content-type: application/json'
curl -s localhost:8467/tickets/T000153; echo
curl -s localhost:8467/approvals; echo
curl -s -w ' %{http_code}' -X POST localhost:8467/tickets/T000153/messages -H "$H" -d '{"content":"多久能到账?"}'; echo
curl -s -w ' %{http_code}' -X POST localhost:8467/approvals/T000153 -H "$H" -d '{"approved":true}'; echo
```

`-w ' %{http_code}'` 让 curl 在输出末尾加上状态码。真实输出:

```text
{"ticket_id":"T000153","outcome":"waiting_approval","category":"refund","reply":null,"turns":1,"cost_cny":0.026,"waiting_on":["approval"]}
[{"id":"RF-T000153-INV-202609-0002","ticket_id":"T000153","amount_cny":950.0,"rule":"annual_first_14_days","reason":"年付首购第 7 天,客户表示用不上,申请全额退款 950 元","created_at":"2026-10-22 18:53:11.525218+08:00","customer_name":"李娜"}]
{"detail":"工单还在等待审批,审批完成后才能继续对话"} 409
{"detail":[{"type":"missing","loc":["body","approver"],"msg":"Field required","input":{"approved":true}}]} 422
```

停在审批时追问得到 409;审批时漏了 approver,pydantic 返回 422,`loc` 指出缺的是请求体里的 approver。现在正式审批:

```bash
curl -s -N -X POST localhost:8467/approvals/T000153 -H "$H" \
  -d '{"approved":true,"approver":"finance-amy","note":"首购7天,符合规则"}'
```

真实输出:

```text
event: node
data: {"node": "approval"}

event: node
data: {"node": "finalize"}

event: done
data: {"ticket_id": "T000153", "outcome": "resolved", "category": "refund", "reply": "您好，您的Pro年付属于首次购买，在14天内可无理由申请全额退款 [1]。我们已为您提交退款申请（金额950元），审核通过后会原路退回。退款尚在审批中，请耐心等待。\n\n参考文章:\n[1] 退款政策总览 https://help.cloudledger.example/help/refund/001\n\n补充:您的退款申请已审核通过,950.00 元将原路退回,到账时间以支付渠道为准。", "turns": 2, "cost_cny": 0.026, "waiting_on": []}
```

审批这次只有三条事件:approval 和 finalize 两个节点都不调模型,所以没有 token。`cost_cny` 还是 0.026,一分没多,也没混进别的请求的钱。回复正文是审批前写好的草稿,末尾的「补充」是 approval 节点按审批结果加的(Day 460)。

再审批一次、审批一个不存在的工单、跑一个不存在的工单:

```text
{"detail":"这个工单不在等待审批"} 409
{"detail":"工单不存在或还没有处理过"} 404
{"detail":"工单不存在"} 404
```

最后追问一句,看多轮对话在接口上也是通的:

```bash
curl -s -N -X POST localhost:8467/tickets/T000153/messages -H "$H" -d '{"content":"好的,大概几天能到账?"}' > msg467.sse
tail -2 msg467.sse
```

真实输出(done 那一条):

```text
data: {"ticket_id": "T000153", "outcome": "resolved", "category": "refund", "reply": "您好，您的退款申请已审核通过，950.00 元将原路退回，到账时间以支付渠道为准。退款审核通过后原路返回：微信支付、支付宝 1–3 个工作日，银行卡 3–7 个工作日，对公转账 5–10 个工作日 [1]。另外提醒您，该订阅目前仍为有效状态且已开启自动续费，如不再使用，建议您关闭自动续费，以免下个周期产生扣款。\n\n参考文章:\n[1] 退款多久到账 https://help.cloudledger.example/help/refund/005", "turns": 4, "cost_cny": 0.04717, "waiting_on": []}
```

turns 从 2 变成 4(追问和这次的回复),`cost_cny` 累计到 0.04717,这一轮花了 0.02117 元。回复接上了「已审核通过」,说明 Day 464 的对话记忆在接口上也生效了。它还顺手提醒客户关自动续费,这句话有没有依据、该不该说,是 Day 476 评测要管的事,先记下。

### 一次真实的 error 事件

写今天的代码时,我在工单停在审批的时候顺手跑了一遍 `uv run pytest`,再去点审批,收到了 error。复现一下:重新造数、清快照,建一张同样的工单跑到审批,然后跑 Day 452 的工具测试,再审批:

```bash
uv run python -m supportpilot.memory.checkpoint
uv run python scripts/seed_db.py
# 建工单、/run 跑到 waiting_approval,同上
uv run pytest tests/test_tools.py -q
curl -s localhost:8467/approvals; echo
curl -s -N -X POST localhost:8467/approvals/T000153 -H "$H" -d '{"approved":true,"approver":"finance-amy"}'
```

真实输出:

```text
14 passed in 2.95s
[]
event: node
data: {"node": "approval"}

event: error
data: {"message": "处理出错了,已经记录,请稍后重试"}
```

测试一跑,待审批列表就空了。uvicorn 那个终端里的日志写着原因:

```text
ticket T000153 failed
...
supportpilot.tools.business.ToolError: 退款申请 RF-T000153-INV-202609-0002 不存在
```

`tests/test_tools.py` 的 fixture 在测试前后都执行 `DELETE FROM biz.refund_requests`,它和开发服务连的是同一个库,把正在等审批的那条申请删了。这不是接口的 bug,是「测试和开发共用一个库」的坑。我的做法是测试只删自己造的数据(下面 test_api.py 的 fixture 就是这么写的),更稳的是给测试单独建一个库。

这次实测也说明 error 事件的设计是对的:浏览器只拿到一句能给用户看的话,堆栈和「退款申请编号」留在服务端日志里。还有一个细节值得注意:error 前面有一条 `node approval`,可 approval 节点明明没跑完。练习 3 会查清楚它是怎么来的。所以前端判断成败只看 done 和 error,不要看 node。

这一步的真模型花费:第一次跑工单 0.026、追问 0.02117、复现 error 时又跑了一次 0.0259,合计约 0.073 元。

## 第六步:不花钱的接口测试

每改一次接口都用 curl 加真模型走一遍,又慢又花钱。用 TestClient 加假模型,把「跑到审批 → 审批 → 完成」和几种出错情况写成测试。新建 `tests/test_api.py`:

```python
# supportpilot/tests/test_api.py
"""HTTP 接口:假模型 + 内存存档 + 真业务库(只用来建工单)。走一遍「跑到审批 → 审批 → 完成」和几种出错情况。"""

import json

import pytest
from fakes import FakeLLM, FakeTools, make_deps
from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import InMemorySaver
from test_graph_smoke import ACT, DRAFT, LINA, REFUND_TRIAGE

from supportpilot.api import app as api
from supportpilot.db import connect


def parse_sse(text: str) -> list[tuple[str, dict]]:
    """把 SSE 响应体拆成 [(事件名, data 字典)]。"""
    out = []
    for block in text.strip().split("\n\n"):
        fields = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line)
        if "event" in fields:
            out.append((fields["event"], json.loads(fields["data"])))
    return out


@pytest.fixture
def client():
    conn = connect()
    api.R.update(conn=conn, saver=InMemorySaver(),
                 deps=make_deps(FakeLLM(REFUND_TRIAGE, ACT, DRAFT), FakeTools(customer=LINA)))
    yield TestClient(api.app)                       # 不用 with:不触发 lifespan,R 里的假零件不会被换掉
    conn.execute("DELETE FROM biz.tickets WHERE subject = 'api-test'")
    conn.close()


@pytest.mark.db
def test_refund_flow_over_http(client):
    tid = client.post("/tickets", json={"customer_email": "lina@example.com", "subject": "api-test",
                                        "body": "上周买的专业版年付,用不上,请帮我退款。"}).json()["ticket_id"]
    r = client.post(f"/tickets/{tid}/run")
    assert r.headers["content-type"].startswith("text/event-stream")
    ev = parse_sse(r.text)
    names = [e for e, _ in ev]
    assert names.count("tool") == 3 and "interrupt" in names and names[-1] == "done"
    assert ev[-1][1]["outcome"] == "waiting_approval"

    assert client.post(f"/tickets/{tid}/messages", json={"content": "多久到账?"}).status_code == 409
    assert client.post(f"/approvals/{tid}", json={"approved": True}).status_code == 422          # 漏了 approver
    ev = parse_sse(client.post(f"/approvals/{tid}", json={"approved": True, "approver": "amy"}).text)
    assert [e for e, _ in ev] == ["node", "node", "done"] and ev[-1][1]["outcome"] == "resolved"
    assert client.post(f"/approvals/{tid}", json={"approved": True, "approver": "amy"}).status_code == 409


@pytest.mark.db
def test_errors_before_stream(client):
    assert client.post("/tickets/T999999/run").status_code == 404
    assert client.post("/approvals/T999999", json={"approved": True, "approver": "amy"}).status_code == 404
    assert client.post("/approvals/T999999", json={"approved": True}).status_code == 404   # 依赖先于请求体校验


@pytest.mark.db
def test_failure_becomes_error_event(client):
    class Broken(FakeLLM):
        def structured(self, *a, **kw):
            raise RuntimeError("模型接口 502")

    api.R["deps"] = make_deps(Broken(REFUND_TRIAGE, ACT, DRAFT), FakeTools(customer=LINA))
    tid = client.post("/tickets", json={"customer_email": "lina@example.com", "subject": "api-test",
                                        "body": "退款"}).json()["ticket_id"]
    ev = parse_sse(client.post(f"/tickets/{tid}/run").text)
    assert ev[-1] == ("error", {"message": "处理出错了,已经记录,请稍后重试"})
    assert "done" not in [e for e, _ in ev]
```

<div class="line-notes">

- `from test_graph_smoke import ACT, DRAFT, LINA, REFUND_TRIAGE` 复用 Day 463 冒烟测试里李娜退款那套剧本:分诊判退款、act 依次调三个工具、草稿一段。
- `from supportpilot.api import app as api` 导入模块而不是里面的 `app`,下面才能改 `api.R` 这个模块级字典。
- `def parse_sse(text: str) -> list[tuple[str, dict]]:` 一个最小的 SSE 解析器,把响应体拆成 `(事件名, 数据)` 列表,前端 Day 469 要写的读流逻辑本质上也是这几行。
- `for block in text.strip().split("\n\n"):` SSE 用空行分隔事件。
- `fields = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line)` 每行按第一个 `": "` 切成两半,`split(": ", 1)` 的 1 表示最多切一刀,data 里的冒号不受影响。我们的 data 永远只有一行,所以可以这么偷懒;通用的解析器要把多行 data 拼起来。
- `api.R.update(conn=conn, saver=InMemorySaver(),` 直接往资源袋里塞:真的数据库连接(建工单要写 biz.tickets)、内存存档、假零件组成的 deps。
- `yield TestClient(api.app)                       # 不用 with:不触发 lifespan` 写成 `with TestClient(app) as c:` 会跑 lifespan,lifespan 会用真的 Deps 和 PostgresSaver 把我们塞的假零件覆盖掉。不用 with 就不跑。
- `conn.execute("DELETE FROM biz.tickets WHERE subject = 'api-test'")` 收尾只删自己建的工单,主题都是 api-test。上一步刚吃过「测试乱删开发数据」的亏,这里只删自己的。
- `@pytest.mark.db` 连真库的测试打这个标记,`make test` 会跳过(Day 446)。
- `r = client.post(f"/tickets/{tid}/run")` TestClient 会把流读完再返回,`r.text` 就是整个事件流。
- `assert names.count("tool") == 3 and "interrupt" in names and names[-1] == "done"` 三次工具调用、停在审批、以 done 收尾。
- `assert ev[-1][1]["outcome"] == "waiting_approval"` 最后一个事件的 data 里,outcome 是推断出来的 waiting_approval。
- `assert client.post(f"/approvals/{tid}", json={"approved": True}).status_code == 422` 漏了 approver,和刚才 curl 的结果一致。
- `assert [e for e, _ in ev] == ["node", "node", "done"] and ev[-1][1]["outcome"] == "resolved"` 审批这次只有两个节点加 done,和真模型那次的事件序列完全一样。
- `assert client.post("/approvals/T999999", json={"approved": True}).status_code == 404   # 依赖先于请求体校验` 工单不存在、请求体又缺字段,结果是 404 而不是 422。这是实测出来的:依赖里的 HTTPException 先抛出来了。对用户来说,「工单不存在」也比「缺字段」更有用。
- `class Broken(FakeLLM):` 分诊一调模型就抛异常,模拟模型接口挂了。
- `api.R["deps"] = make_deps(Broken(REFUND_TRIAGE, ACT, DRAFT), FakeTools(customer=LINA))` 换掉资源袋里的 deps,后面的请求用的就是坏掉的模型。
- `assert ev[-1] == ("error", {"message": "处理出错了,已经记录,请稍后重试"})` 最后一个事件是 error,内容是那句固定的话,没有「502」这种内部细节。
- `assert "done" not in [e for e, _ in ev]` error 和 done 只有一个。

</div>

```bash
uv run pytest tests/test_api.py -v
```

真实输出:

```text
tests/test_api.py::test_refund_flow_over_http PASSED                     [ 33%]
tests/test_api.py::test_errors_before_stream PASSED                      [ 66%]
tests/test_api.py::test_failure_becomes_error_event PASSED               [100%]

============================== 3 passed in 3.09s ===============================
```

再跑全部 `uv run pytest -q`,实测 `53 passed`:昨天的 50 个加今天这 3 个。改了 `profile_for` 签名后如果忘了改 test_profile.py 里那两个 lambda,这里会有 2 个 TypeError。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/4HlNv1qpZFY" title="Server-Sent Events Crash Course" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hussein Nasser · Server-Sent Events Crash Course · 从 HTTP 层面讲 SSE 怎么工作、和长轮询及 WebSocket 比优缺点在哪,讲到了代理缓冲和连接数限制。英文,开字幕看。</figcaption>
</figure>

## 零件和大代码的对照

| 零件 | 改了哪个文件 | 作用 |
| --- | --- | --- |
| `LLMClient.fresh` | `llm.py` | 同配置同 HTTP 客户端,新账本 |
| `Deps.fresh` | `agent/deps.py` | 每个请求一份,重资源共用,保持 llm/small_llm 同一对象 |
| `profile_for` 多一个 llm 参数 | `agent/deps.py`、`agent/nodes.py`、`tests/test_profile.py` | 画像的钱记到当前请求 |
| `FakeLLM.fresh` | `tests/fakes.py` | 假模型也能 fresh |
| `race.py`、`race_fixed.py` | `scratch/d467/` | 复现和验证并发成本 bug |
| `lifespan` + `R` | `api/app.py`(新) | 进程级资源,测试能换成假的 |
| `ticket_row`、`idle_thread`、`waiting_approval` | `api/app.py` | 流开始前返回 404/409 |
| `_events` + `_sse` | `api/app.py` | LangGraph 流 → 七种事件,出错推 error |
| 六个接口 | `api/app.py` | 工单生命周期 |
| `test_api.py` | `tests/`(新) | 3 个接口测试 |

## 动手练习

**练习 1:给 GET /tickets/{id} 写测试。** 断言两件事:工单建了但还没跑时是 404;跑到审批后返回的 outcome 是 waiting_approval、waiting_on 是 `["approval"]`、reply 是 None。复用 test_api.py 的 client fixture。

<details><summary>参考答案</summary>

```python
# supportpilot/tests/test_api_more.py(练习 1 的部分;练习 3 往同一个文件里加)
"""练习 1、3:GET /tickets/{id} 的两种状态;审批时出错,事件流长什么样。"""

import pytest
from fakes import FakeLLM, FakeTools, make_deps
from test_api import client, parse_sse  # noqa: F401  client 是 fixture,导入进来本文件才能用
from test_graph_smoke import ACT, DRAFT, LINA, REFUND_TRIAGE

from supportpilot.api import app as api

BODY = {"customer_email": "lina@example.com", "subject": "api-test", "body": "上周买的专业版年付,用不上,请帮我退款。"}


@pytest.mark.db
def test_get_ticket_states(client):
    tid = client.post("/tickets", json=BODY).json()["ticket_id"]
    assert client.get(f"/tickets/{tid}").status_code == 404          # 建了但还没跑
    client.post(f"/tickets/{tid}/run")
    s = client.get(f"/tickets/{tid}").json()
    assert s["outcome"] == "waiting_approval" and s["waiting_on"] == ["approval"] and s["reply"] is None
```

<div class="line-notes">

- `from fakes import FakeLLM, FakeTools, make_deps` 练习 3 才用到,先一起导入。
- `from test_api import client, parse_sse  # noqa: F401` pytest 只认当前文件和 conftest.py 里的 fixture,别的测试文件里定义的要导入进来才能用。导入了却「没用」,Ruff 会报 F401(导入未使用),`# noqa: F401` 告诉它这是故意的。更规范的做法是把 client 挪进 `tests/conftest.py`。
- `subject` 是 api-test,client fixture 收尾时会删掉。
- `assert client.get(f"/tickets/{tid}").status_code == 404` 业务库里有这张工单,但 checkpointer 里还没有它的状态。
- `s = client.get(f"/tickets/{tid}").json()` 跑完 /run 以后再查。

</div>

```bash
uv run pytest tests/test_api_more.py -q -k get_ticket
```

实测 `1 passed`。

</details>

**练习 2:把并发 bug 钉成一个测试。** 照着 race.py 写一个 pytest 测试:先单独跑一张得到正确成本,再用 `shared.fresh()` 两张并发,断言两张的成本都等于单独跑的,而且基础 deps 的账本一笔没记。然后把 `shared.fresh()` 改回 `shared`,看测试怎么失败。

<details><summary>参考答案</summary>

```python
# supportpilot/tests/test_concurrency.py
"""练习 2:把并发成本 bug 钉成一个测试。两张工单同时跑,各自的 cost_cny 要和单独跑一样。"""

import time
from concurrent.futures import ThreadPoolExecutor

from fakes import FakeLLM, FakeTools, make_deps
from test_memory import DRAFT, TICKET, TRIAGE

from supportpilot.agent.graph import build_graph


class SlowLLM(FakeLLM):
    def stream(self, messages, on_token=None, **kw):
        time.sleep(0.2)                                   # 让两张工单的调用交错
        return super().stream(messages, on_token, **kw)


def cost_of(deps, tid: str) -> float:
    return build_graph(deps).invoke({"ticket": {**TICKET, "id": tid}})["cost_cny"]


def test_fresh_deps_keep_costs_apart():
    shared = make_deps(SlowLLM(TRIAGE, [], DRAFT), FakeTools(customer={"id": "C0010"}))
    alone = cost_of(shared.fresh(), "T1")
    with ThreadPoolExecutor(max_workers=2) as pool:
        costs = list(pool.map(lambda tid: cost_of(shared.fresh(), tid), ["T1", "T2"]))
    assert costs == [alone, alone]
    assert shared.spent() == 0                            # 基础 deps 的账本一笔都没记
```

<div class="line-notes">

- `class SlowLLM(FakeLLM):` 和 race.py 一样。测试文件不该 import scratch 里的脚本,所以抄一份。
- `alone = cost_of(shared.fresh(), "T1")` 单独跑也用 fresh,这样基础账本从头到尾都是 0。
- `assert costs == [alone, alone]` 浮点数用 `==` 比较一般有风险,这里两边是同样的整数 token 乘同样的单价算出来的,结果完全相同,可以直接比。
- `assert shared.spent() == 0` 证明所有花费都记在了各自的副本上。这一行同时也能抓住「某个闭包还抓着基础客户端」那类漏洞。

</div>

```bash
uv run pytest tests/test_concurrency.py -q
```

实测 `1 passed`。把 `cost_of(shared.fresh(), tid)` 改成 `cost_of(shared, tid)` 再跑:

```text
E       assert [0.00388, 0.00668] == [0.00352, 0.00352]
E         
E         At index 0 diff: 0.00388 != 0.00352
```

和 race.py 的数字一模一样。以后谁把 fresh 去掉,这个测试就会红。

</details>

**练习 3:error 前面那条 node 是哪来的。** 第五步复现 error 时,事件是 `node approval` 然后 `error`。用假零件复现:让 `deps.decide_refund` 抛异常,跑到审批后审批一次,打印事件名列表;再在 `_events` 里加个 print 看看 updates 里收到的是什么,然后修掉它,让失败时只有一条 error。

<details><summary>参考答案</summary>

先在 test_api_more.py 里加一个测试,断言「失败时只有 error」:

```python
# supportpilot/tests/test_api_more.py(练习 3,接在练习 1 后面)
@pytest.mark.db
def test_approval_failure_events(client):
    tools = FakeTools(customer=LINA)

    def gone(*_):
        raise RuntimeError("退款申请不存在")

    deps = make_deps(FakeLLM(REFUND_TRIAGE, ACT, DRAFT), tools)
    deps.decide_refund = gone
    api.R["deps"] = deps
    tid = client.post("/tickets", json=BODY).json()["ticket_id"]
    client.post(f"/tickets/{tid}/run")
    ev = parse_sse(client.post(f"/approvals/{tid}", json={"approved": True, "approver": "amy"}).text)
    assert [e for e, _ in ev] == ["error"]
```

<div class="line-notes">

- `def gone(*_):` 接收任意个位置参数、一个都不用,直接抛异常,模拟「申请在库里被删了」。
- `deps.decide_refund = gone` Deps 是普通 dataclass,字段可以直接换。
- `assert [e for e, _ in ev] == ["error"]` 期望的样子:失败时只推一条 error。

</div>

```bash
uv run pytest tests/test_api_more.py -q -k failure
```

先跑,失败:

```text
E       AssertionError: assert ['node', 'error'] == ['error']
```

在 `_events` 的 `for node, update in chunk.items():` 下面临时加一行 `print(node, update)` 再看(我用一个不起服务的小脚本直接 `graph.stream` 看的,结果一样),失败时恢复的第一条 updates 是:

```text
updates {'approval': None}
```

成功恢复时,第一条是 `{'approval': {'approval': {...}, 'followup': '...'}}`,带着节点真正返回的更新。失败时 LangGraph 在恢复之初先给被打断的 approval 报了一个 `None`,然后节点才真正执行、抛异常。我们把所有 updates 都翻译成 node 事件,就多出了一条「approval 完成」。

修法:更新是 None 的跳过,我们的节点永远返回字典,不会误伤:

```python
# supportpilot/src/supportpilot/api/app.py(_events 里改一处)
                if node == "__interrupt__":
                    yield _sse("interrupt", update[0].value)
                elif update is None:  # 练习 3:恢复时 LangGraph 先给被打断的节点报一个空更新,它还没跑完
                    continue
                else:
                    yield _sse("node", {"node": node})
```

<div class="line-notes">

- `elif update is None:  # 练习 3` 判断 None 用 `is`,不用 `==`。
- `continue` 跳过这一条,不推事件。

</div>

改完再跑 `uv run pytest -q`,四道练习都做完的话实测 `56 passed`:正文的 53 个,加练习 1、3 各 1 个、练习 2 的 1 个。test_api.py 里成功审批的序列还是 `["node", "node", "done"]`,没被影响。以后各天的 app.py 以加了这两行的版本为准。

</details>

**练习 4(观察题):心跳。** 写一个接口,先推一个事件,然后 `time.sleep(20)`,再推 done。用 uvicorn 起起来,用 curl 接收,每行前面打上时间,看空档里发生了什么。想一想为什么需要它。

<details><summary>参考答案</summary>

```python
# supportpilot/scratch/d467/ping_demo.py
"""练习 4:一个 20 秒才出第二个事件的接口,看 FastAPI 在空档里自动发什么。不调模型。
启动:uv run uvicorn --app-dir scratch/d467 ping_demo:app --port 8468"""

import time
from collections.abc import Iterator

from fastapi import FastAPI
from fastapi.sse import EventSourceResponse, ServerSentEvent

app = FastAPI()


@app.post("/slow", response_class=EventSourceResponse)
def slow() -> Iterator[ServerSentEvent]:
    yield ServerSentEvent(event="node", raw_data='{"node": "classify"}')
    time.sleep(20)                                       # 模拟 act 节点查了 20 秒数据库
    yield ServerSentEvent(event="done", raw_data='{"ok": true}')
```

<div class="line-notes">

- `启动:uv run uvicorn --app-dir scratch/d467 ping_demo:app --port 8468"""` `--app-dir` 告诉 uvicorn 去哪个目录找 `ping_demo` 模块。换个端口,不和正在跑的服务冲突。
- `time.sleep(20)` 普通 def 接口,在线程池里睡,不会卡住事件循环。

</div>

一个终端起服务,另一个终端接收,`while read` 循环给每行加上时间:

```bash
uv run uvicorn --app-dir scratch/d467 ping_demo:app --port 8468
curl -s -N -X POST localhost:8468/slow | while IFS= read -r line; do printf '%s  %q\n' "$(date +%T)" "$line"; done
```

真实输出:

```text
18:59:00  event:\ node
18:59:00  data:\ \{\"node\":\ \"classify\"\}
18:59:00  ''
18:59:15  :\ ping
18:59:15  ''
18:59:20  event:\ done
18:59:20  data:\ \{\"ok\":\ true\}
18:59:20  ''
```

`%q` 把空格、引号都加了反斜杠,空行显示成 `''`,所以看起来有点乱。关键是第 15 秒那一行 `: ping`:冒号开头的行在 SSE 里是注释,浏览器会忽略它。FastAPI 在 15 秒没有任何事件时自动发一条,作用是让中间的代理和负载均衡器知道这个连接还活着。很多代理对「一段时间没有数据」的连接会直接断开,Agent 查数据库、等模型首个 token 时,出现十几秒的空档很正常。Day 379 手写 StreamingResponse 时,这件事得自己做。

</details>

验收标准:`uv run pytest` 全部通过(含 test_api.py 3 个);你亲手跑过 race.py,看到过两张工单成本互相串的数字,也看到修好后都是 0.00352;能说出 `profile_for` 为什么要改签名;用 curl 走通过「建工单 → 跑到审批 → 409 → 422 → 审批 → 追问」;今天真模型花费在 0.15 元以内。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 并发 | 多件事的执行时间有重叠。例:两张工单同时在两个线程里跑。 |
| 线程 / 线程池 | 线程是同一个进程里的一条执行线;线程池是事先准备好、反复使用的一组线程。例:`ThreadPoolExecutor(max_workers=2)`。 |
| 共享状态 | 多个并发任务读写同一个对象。例:所有请求共用一个 `LLMClient.ledger`。 |
| 浅拷贝 | 复制对象本身,属性还指向原来的值。例:`copy.copy(llm)` 和原对象共用 HTTP 客户端。 |
| `dataclasses.replace` | 复制一个 dataclass 并替换指定字段,相当于 `{...obj, a: 1}`。 |
| 闭包 | 函数记住了定义时外面的变量。例:`partial(get_or_build_profile, conn, small)` 记住了启动时的 small。 |
| lifespan | FastAPI 服务启动和关闭时各执行一次的代码。 |
| EventSourceResponse | FastAPI 0.135 起自带的事件流响应类型,配合 `yield` 用。 |
| ServerSentEvent | 一条 SSE 事件,字段有 event、data、raw_data、id、retry、comment。 |
| raw_data | 不做 JSON 编码、原样发出的 data。例:自己 `json.dumps(..., ensure_ascii=False)` 后传入。 |
| 心跳(keep-alive ping) | 空闲时发的注释行 `: ping`,防止代理断开连接。FastAPI 默认 15 秒一次。 |
| 409 Conflict | 请求和资源当前状态冲突。例:工单在等审批时追问。 |
| CORS 预检 | 跨源请求前浏览器先发的 OPTIONS 请求,问服务端允不允许。 |
| 事件协议 | 前后端约定的事件名和数据格式。今天是七种:node、step、tool、token、interrupt、error、done。 |

## 常见误区

**以为差值法记成本在服务端也没问题。** race.py 实测:共用账本时两张一样的工单算出 0.00388 和 0.00668,合计比真实花费多一倍。每个请求要用 `fresh()` 出来的客户端。

**只换了 deps 里的客户端,忘了闭包。** `partial` 在启动时固定住的旧客户端不会跟着换。race_fixed.py 实测:闭包版画像的 0.001 元没进工单成本。所有 partial 和闭包都要过一遍。

**fresh 时把 small_llm 也单独复制。** 没配小模型时 llm 和 small_llm 是同一个对象,分开复制后 `spent()` 会把同一笔钱加两遍。要保持「是同一个对象」。

**在流式接口的函数体里抛 HTTPException。** raise_inside.py 实测:客户端收到 200 加一个空 body。能提前判断的错误放进依赖。

**流里出了异常不管。** 不接住的话连接直接断,前端不知道发生了什么,也没有 done。接住,写日志,推一条 error。

**把异常信息原样推给前端。** 实测那次的异常里有退款申请编号,别的场景可能有 SQL 和客户数据。前端只拿一句固定的话。

**前端看到 node 就当这个节点成功了。** 练习 3 实测:审批失败时也先来了一条 `node approval`。成败只看 done 和 error。

**用 `data=` 推中文。** 功能没问题,但每个汉字变成 `\uXXXX`,体积翻倍、DevTools 里没法读。用 `raw_data` 加 `ensure_ascii=False`。

**在 async def 里跑同步的图。** 一张工单十几秒,整个服务的事件循环都被卡住。接口写成普通 def,让 FastAPI 放进线程池。

**测试和开发服务连同一个库。** 实测:跑一遍 test_tools.py,正在等审批的申请被它的 fixture 删了,审批时收到 error。测试只删自己造的数据,或者用单独的库。

**CORS 写 `allow_origins=["*"]`。** 等于任何网站都能在用户浏览器里调你的审批接口。只放行自己的前端地址。

## 学习资料

### 文档与文章

- [FastAPI · Server-Sent Events](https://fastapi.tiangolo.com/tutorial/server-sent-events/):今天用的 EventSourceResponse 和 ServerSentEvent 的官方教程,写明了 0.135.0 加入、15 秒心跳、no-cache 和 X-Accel-Buffering 两个响应头、raw_data 的用法,20 分钟。
- [FastAPI · Dependencies](https://fastapi.tiangolo.com/tutorial/dependencies/):依赖注入的官方教程,复习 Depends 和 Annotated 别名的写法。
- [FastAPI · Testing](https://fastapi.tiangolo.com/tutorial/testing/):TestClient 的用法。
- [MDN · 使用服务器发送事件](https://developer.mozilla.org/zh-CN/docs/Web/API/Server-sent_events/Using_server-sent_events):中文,从浏览器这一侧讲 SSE 的格式、注释行和重连,看「事件流格式」一节。
- [HTML Living Standard · Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html):SSE 的规范原文,想知道多行 data 怎么拼、冒号开头的行为什么被忽略,查这里。
- [LangGraph · Streaming](https://docs.langchain.com/oss/python/langgraph/streaming):updates、custom 等流模式的官方说明。
- [Python · dataclasses](https://docs.python.org/zh-cn/3.12/library/dataclasses.html)、[copy](https://docs.python.org/zh-cn/3.12/library/copy.html)、[concurrent.futures](https://docs.python.org/zh-cn/3.12/library/concurrent.futures.html):`replace`、浅拷贝和线程池的中文文档。
- [MDN · 409 Conflict](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Reference/Status/409):409 的含义和典型场景。

### B 站视频

- 懂点AI的H先生《SSE 到底是什么?用 FastAPI 一次讲透流式响应》:上面嵌入的那个,5 分钟。
- 懂点AI的H先生《别再只会 HTTP 了,SSE 才是 AI 流式输出的答案》:20 分钟,BV15F7J6dEdm,讲为什么大模型应用普遍用 SSE 而不是 WebSocket,和 Day 379 对照着看。

### 其他经典视频

- Hussein Nasser《Server-Sent Events Crash Course》:上面嵌入的那个。

### 书籍

- Bill Lubanovic《FastAPI: Modern Python Web Development》(O'Reilly, 2023):FastAPI 的系统讲解,依赖注入和测试两章和今天最相关。书里没有讲 0.135 以后的自带 SSE,这部分看官方文档。

### 开源项目与代码

- [fastapi/fastapi](https://github.com/fastapi/fastapi):想看自带 SSE 是怎么实现的,读 `fastapi/sse.py`(事件模型和编码)和 `fastapi/routing.py` 里处理 EventSourceResponse 的那一段,心跳和线程池都在里面。
- [sysid/sse-starlette](https://github.com/sysid/sse-starlette):FastAPI 自带 SSE 之前最常用的第三方库,很多老项目和教程还在用它,看到 `from sse_starlette import EventSourceResponse` 认得出来就行。

## 自测

1. 两张工单共用一个 LLMClient 时,为什么用差值法算出来的成本会错?合计为什么还会比真实花费多?

<details><summary>答案</summary>

差值法是「开始读一次账本、结束读一次、相减」,如果这段时间里别的工单也往同一本账里记了钱,就被算成了自己的。两张工单的时间段有重叠,重叠部分的花费两边都算了一遍,所以合计偏多。race.py 实测:单张 0.00352,共用时算出 0.00388 和 0.00668,合计 0.01056,真实只有 0.00704。

</details>

2. `Deps.fresh()` 里为什么要写 `small = llm if self.small_llm is self.llm else ...`?

<details><summary>答案</summary>

没配小模型时 llm 和 small_llm 是同一个对象,`spent()` 靠 `is not` 判断只算一次。如果 fresh 时分别复制,就变成两个不同的对象、两本账,同一笔花费只记在其中一本,但 `spent()` 会把两本都加上,判断逻辑被打乱。保持同一个对象才和原来的语义一致。

</details>

3. 为什么「工单不存在」要放进依赖,而不是在流式接口的函数体里判断?

<details><summary>答案</summary>

流式接口的函数体是生成器,FastAPI 先发出 200 和响应头,才开始执行它。函数体里抛 HTTPException 时状态码已经发出去了,客户端收到 200 加一个空 body(raise_inside.py 实测)。依赖在接口函数之前执行,那时响应还没开始,能正常返回 404。

</details>

4. 七种事件里,哪两种是「收尾」?前端为什么只能靠它们判断成败?

<details><summary>答案</summary>

done 和 error,一个流以其中之一结束,而且只有一个。node 只表示 LangGraph 报了一次更新,练习 3 实测审批失败时也会先来一条 `node approval`,所以不能拿它当成功的依据。

</details>

5. 面试题:你的 Agent 是怎么把处理过程实时推给前端的?为什么选 SSE?遇到过什么坑?

<details><summary>答案</summary>

示范回答:后端是 FastAPI,工作流是 LangGraph。我用 `graph.stream` 同时开 updates 和 custom 两种模式,在一个适配函数里翻译成七种事件:node 表示节点完成,step、tool、token 是节点主动推的细节、工具调用和逐字输出,interrupt 表示停在了人工审批,最后以 done 或 error 收尾。传输用 SSE,因为这是服务端单向推、基于普通 HTTP,代理和鉴权都不用特殊处理,FastAPI 0.135 起自带支持,帮我设好了防缓存的响应头和 15 秒心跳;客户端发消息另走 POST,不需要 WebSocket 的双向通道。一张退款工单实测 11.7 秒推了 72 个事件。踩过的坑有三个:一是所有请求共用 LLM 客户端,成本差值互相串,改成每个请求 fresh 一本新账本,还顺带发现一个 partial 抓住了旧客户端;二是在生成器里抛 404,客户端收到的是 200 加空响应,所以前置检查都放进依赖;三是审批失败时 LangGraph 恢复会先报一个空更新,被我翻译成了「节点完成」,后来跳过了 None。另外图是同步的,接口写成普通 def 让 FastAPI 放线程池,没有改成全异步,这是对演示项目的取舍。

</details>

6. 第五步审批完成那次,done 里的 `cost_cny` 为什么和审批前一样是 0.026?

<details><summary>答案</summary>

审批这次只跑了 approval 和 finalize 两个节点,都不调模型,花费是 0。而且这个请求用的是自己 fresh 出来的账本,没有混进别的请求的钱。0.026 是从 checkpoint 里读出来的、第一次处理时累计的值。

</details>

## 明天预告

明天是 [Day 468](/blog/agent-zero/day-468-week67-review/),第 67 周复习:毕业项目(Day 462–467)。这一周 SupportPilot 从一张编译好的图,到不花钱的端到端测试,再到三种记忆和今天的 HTTP 接口,走完了后端的最后一段。复习日把这六天画成一张知识地图,整理这周踩过的坑(工单号复用、切点拆开一问一答、画像算进当前工单、共用账本),再默写一遍 `_events`,为 Day 469 开始写前端读流做准备。
