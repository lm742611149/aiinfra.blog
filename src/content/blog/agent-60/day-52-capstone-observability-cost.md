---
title: 'Day 52 · 可观测与成本:接 Langfuse、算单工单成本、缓存与模型路由'
description: '给 SupportPilot 装上眼睛和账本:每张工单在 Langfuse 里是一棵能点开的 trace,每次模型调用都记一笔精确到分的账。然后用两招把单工单成本压下来:让 prompt 前缀稳定以吃到缓存命中价,让小模型干分类、大模型只管起草。'
pubDate: 2026-10-12
regime: none
tags: ['langfuse', 'observability', 'cost', 'prompt-caching', 'model-routing', 'capstone', 'agent-60']
series: 'agent-60'
day: 52
lang: 'zh'
---

## 今天要解决的问题

Day 51 你按错误分析把分数往上提了一轮。提分的过程中你大概已经有过这种体验:某张工单答错了,你想知道是检索没捞到、工具参数传错了,还是起草时模型没看检索结果,于是你在终端里翻几百行日志。翻得很累,而且一换机器日志就没了。

今天要把这件事彻底解决,顺带把钱算清楚。结束时你应该能做到:

1. SupportPilot 处理的每一张工单,在 Langfuse 里都是一棵 trace 树,分类、检索、工具调用、起草、自检每一步的输入输出、耗时、token 都能点开看。
2. 自己维护一本「模型调用账本」,能回答「上周平均一张工单花了多少钱、P95 是多少、钱花在哪个节点」。
3. 把 prompt 的结构改成「稳定前缀在前,变化内容在后」,在账本里看到缓存命中率从接近 0 涨上去。
4. 实现一个简单的模型路由:分类和自检交给便宜的 `deepseek-flash`,起草交给 `deepseek-v4-pro`,并且能说出这样分的理由。
5. 跑一遍 Day 50 的评测集,填出优化前后的对比表:分数、P95 延迟、单工单成本三列都要有。
6. 算一张「Agent vs 人工」的单工单 ROI 表,说得出 ROI 对哪个参数最敏感。

预计用时 5–7 小时,其中自托管 Langfuse 如果你的电脑比较老,光拉镜像就可能占半小时。前置是 Day 34(tracing 概念)、Day 38(成本与延迟的基本手段)、Day 47(主工作流)、Day 50(评测集)。

### 今天动哪些文件

目录结构沿用 Day 43 定下的那份(`src/supportpilot/` 下分 `kb/`、`tools/`、`agent/`、`memory/`、`api/`、`obs/`、`security/`)。今天新增和改动的是这些:

```text
supportpilot/
├── src/supportpilot/
│   ├── llm.py              # 改:换 Langfuse 版 OpenAI 客户端,每次调用记账
│   ├── obs/
│   │   ├── pricing.py      # 新:按高峰/空闲、缓存命中计价
│   │   ├── ledger.py       # 新:模型调用账本(SQLite)
│   │   └── tracing.py      # 新:工单级 trace、节点级 span
│   ├── agent/
│   │   ├── graph.py        # 改:add_node 时给每个节点套上 span
│   │   └── routing.py      # 新:质检节点按类别选大小模型
│   └── api/app.py          # 改:SSE 生成器保持同一个上下文
└── scripts/cost_report.py  # 新:成本报表
```

## 为什么光有日志不够

Day 34 讲过 trace、span、generation 这三个词,这里换个角度说一遍,用你现在手里真实的项目。

一张工单进来,SupportPilot 内部大概要走这么几步:分类节点调一次小模型;检索节点去 pgvector 和 BM25 各查一次,再 rerank;执行节点可能调一两个 MCP 工具(查发票、查订阅);起草节点调一次大模型;自检节点再调一次小模型,不通过就回到起草。顺利的话 4 次模型调用,不顺利能到 7、8 次。

如果只靠 `print` 或 `logging`,这些调用在日志里是平铺的,中间还夹着别的请求的日志,因为 FastAPI 是并发处理的。你要找「工单 T-1042 的起草节点看到的检索结果是什么」,得先 grep 工单号,再一行一行拼。trace 做的事情很简单:给同一张工单的所有步骤打上同一个 trace id,并且记住父子关系,于是它们在界面上自动长成一棵树。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="一张工单的 trace 树与时间轴">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">trace: handle_ticket  T-1042   session=C-2087</text>
  <line x1="200" y1="40" x2="200" y2="285" stroke="var(--rule)"/>
  <line x1="620" y1="40" x2="620" y2="285" stroke="var(--rule)"/>
  <text x="200" y="295" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">0 s</text>
  <text x="588" y="295" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">~9 s</text>
  <text x="20" y="62" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">handle_ticket</text>
  <rect x="200" y="50" width="420" height="16" fill="var(--rule)" opacity="0.5"/>
  <text x="36" y="94" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">classify · flash</text>
  <rect x="200" y="82" width="40" height="16" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="36" y="126" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">retrieve</text>
  <rect x="242" y="114" width="36" height="16" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="36" y="158" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">tool: get_invoice</text>
  <rect x="280" y="146" width="22" height="16" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="36" y="190" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">draft · v4-pro</text>
  <rect x="304" y="178" width="250" height="16" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="36" y="222" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">check · flash</text>
  <rect x="556" y="210" width="56" height="16" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="304" y="252" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">起草占了大半时间和大半成本</text>
  <line x1="420" y1="242" x2="420" y2="196" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
</svg>
<figcaption>一张工单在 Langfuse 里的样子(示意,时长是按经验画的,不是实测)。蓝色是模型调用,琥珀色是检索和外部工具。点开任何一格都能看到输入输出和 token 数。</figcaption>
</figure>

除了排查单张工单,trace 还解决两个更大的问题。一是聚合:上周 3000 张工单,起草节点的平均延迟是多少,哪天突然变慢了。二是回放:线上一张工单答错了,你把它的 trace 原样加进评测集,这是 Day 31 说的「测试集要跟着产品长」最省事的来源。

## Langfuse:云版还是自托管

Langfuse 是开源的,有两种用法。云版注册就能用,有免费额度,SDK 指向 `https://cloud.langfuse.com`(欧洲区)或 `https://us.cloud.langfuse.com`(美国区)。自托管用官方仓库里的 `docker-compose.yml`,`docker compose up` 之后两三分钟,浏览器打开 `localhost:3000` 自己注册第一个账号。官方文档写得很直白,compose 方式没有高可用和备份,适合试用和小规模。

我的建议:开发阶段用云版,省掉自己维护 Postgres、ClickHouse、Redis、对象存储这一整套。等到 Day 53 部署上线、并且你的 demo 会处理别人的真实输入时,再考虑数据放哪。如果你在国内且访问海外服务不稳定,就在本机或那台云服务器上自托管,但要给它留够内存,ClickHouse 不是省油的灯。我在一台 8 GB 内存的老 Mac 上同时跑 SupportPilot、pgvector 和自托管 Langfuse,风扇就没停过。

不管哪种,拿到三个值写进 `.env`:

```bash
# supportpilot/.env(只放本机,不进 git)
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com   # 自托管就改成你自己的 Langfuse 地址,本机默认是 3000 端口
```

```bash
cd supportpilot
uv add langfuse
```

## 接入:改一行导入,再给节点套上 observe

Langfuse 对 OpenAI SDK 做了一个替身,把 `from openai import OpenAI` 换成 `from langfuse.openai import OpenAI`,之后每一次 `chat.completions.create` 都会自动变成一个 generation,带上 prompt、输出、token 和耗时。DeepSeek 走的是 OpenAI 兼容协议,所以同样适用。

光这样还不够,每次调用会各自成为一棵单独的 trace,散在界面里。要让它们挂到同一张工单下面,得在最外层开一个 span,用 `propagate_attributes` 把 session、user、tags 传下去;还要让每次模型调用知道自己属于哪张工单、哪个节点,才能分节点记账。

先改 Day 47 的 `LLMClient`。改动只有三处:换导入、所有请求走一个 `_create`、入账时顺便记一笔细账。

```python
# supportpilot/src/supportpilot/llm.py(在 Day 47 的版本上改,只列改动的部分)
import time
from contextvars import ContextVar
from typing import Any

from langfuse.openai import OpenAI  # ① 原来是 from openai import OpenAI,__init__ 里的 OpenAI(...) 不用动

from .obs.ledger import record_call

# 当前在处理哪张工单、哪个节点。用 contextvars 而不是全局变量,
# 因为 FastAPI 会并发处理多张工单,每个请求有自己的上下文。
current_ticket: ContextVar[str] = ContextVar("current_ticket", default="-")
current_node: ContextVar[str] = ContextVar("current_node", default="-")


class LLMClient:
    def _create(self, **kwargs):
        """② chat() 和 stream() 里原来的 self.client.chat.completions.create(...) 都改成 self._create(...)。"""
        kwargs.setdefault("name", current_node.get())  # Langfuse 里这个 generation 显示的名字
        kwargs.setdefault("metadata", {"ticket_id": current_ticket.get()})
        return self.client.chat.completions.create(**kwargs)

    def _usage(self, u: Any, model: str | None = None, t0: float | None = None) -> "Usage":
        """③ 原来的累计逻辑不变,多记一笔带节点、模型、缓存命中、耗时的细账。"""
        got = Usage(prompt_tokens=getattr(u, "prompt_tokens", 0) or 0,
                    completion_tokens=getattr(u, "completion_tokens", 0) or 0, calls=1)
        self.ledger.add(got)
        if u is not None:
            record_call(ticket_id=current_ticket.get(), node=current_node.get(),
                        model=model or self.model, usage=u,
                        latency_ms=int((time.perf_counter() - t0) * 1000) if t0 else 0)
        return got
```

<div class="line-notes">

- `import time` 下面用 `time.perf_counter()` 量每次调用的耗时,写进账本的 `latency_ms`。
- `from contextvars import ContextVar` 上下文变量:看上去像全局变量,但每个线程、每个 asyncio 任务都有自己的一份值。
- `from langfuse.openai import OpenAI` 全文唯一要改的导入。Langfuse 的替身类继承了原版 OpenAI 客户端,每次 `chat.completions.create` 都会顺手上报一个 generation。实测装的是 langfuse 5.0.4,没配 `LANGFUSE_PUBLIC_KEY` 时只打一行 `Langfuse client initialized without public_key. Client will be disabled.`,调用照常返回、不上报,所以本地没有 Langfuse 也能跑。
- `from .obs.ledger import record_call` 每次调用记一笔细账,下面 `_usage` 里调用。
- `current_ticket: ContextVar[str] = ContextVar("current_ticket", default="-")` 当前在处理哪张工单,没人设置时是 `"-"`。实测在 `ticket_trace` 外面直接调模型,账本里这一行的 `ticket_id` 和 `node` 都是 `-`。
- `current_node: ContextVar[str] = ContextVar("current_node", default="-")` 当前在哪个节点。由 `obs/tracing.py` 的 `traced` 在节点开始时设置、结束时还原。
- `def _create(self, **kwargs):` 所有模型请求都从这里出去,`name` 和 `metadata` 只需要加在这一处。
- `kwargs.setdefault("name", current_node.get())` `setdefault`:调用方没传 `name` 才填。实测 classify 节点里发出的请求,`name` 就是 `"classify"`。
- `kwargs.setdefault("metadata", {"ticket_id": current_ticket.get()})` 在 Langfuse 里按工单号搜 generation 用的。
- `return self.client.chat.completions.create(**kwargs)` `name`/`metadata` 是 Langfuse 替身才认识的参数,它会先把这两个拿走再发给 DeepSeek。要是还用原版 OpenAI SDK,这两个参数会让请求直接报错。
- `def _usage(self, u: Any, model: str | None = None, t0: float | None = None) -> "Usage":` 多了两个可选参数,没传也能用,旧的调用点不会坏。
- `self.ledger.add(got)` 原来的累计不动。节点里用 `deps.spent()` 算的 `cost_cny` 还是按 `.env` 里的单一价格估。
- `if u is not None:` 流式调用万一没拿到 usage(有的厂商不支持 `include_usage`),就不记账,免得写一行全是 0 的假数据。
- `record_call(ticket_id=current_ticket.get(), node=current_node.get(),` 这里能读到工单号和节点名,靠的就是 contextvars:调用链上任何一层都不用把它们当参数传下来。
- `latency_ms=int((time.perf_counter() - t0) * 1000) if t0 else 0)` 秒换成毫秒取整。实测一张退款工单里,classify 用了 1031 ms,draft 用了 11950 ms。流式调用量的是从发请求到最后一块数据收完的总时长。

</div>

`chat()` 和 `stream()` 各自在请求前加一行 `t0 = time.perf_counter()`,入账那行改成 `self._usage(resp.usage, kwargs["model"], t0)`(`stream()` 里是 `self._usage(last_usage, model or self.model, t0)`)。`structured()` 内部调的是 `chat()`,不用改。`name` 和 `metadata` 这两个参数是 Langfuse 替身额外认识的,原版 OpenAI SDK 不收,所以只有换了导入才能这么写。Day 47 的 `Usage.cost_cny()` 还留着,节点里算 `cost_cny` 的逻辑也不动,它按单一价格估算,今天的账本负责按真实价目精确记。

然后是工单级的 trace 和节点级的 span,放在 `obs/tracing.py`:

```python
# supportpilot/src/supportpilot/obs/tracing.py
from collections.abc import Callable
from contextlib import contextmanager
from functools import wraps

from langfuse import get_client, propagate_attributes

from ..llm import current_node, current_ticket


@contextmanager
def ticket_trace(ticket_id: str, customer_email: str, channel: str = "web"):
    """一张工单从进来到回复的所有调用,都挂在这一个 span 下面。"""
    token = current_ticket.set(ticket_id)
    try:
        with get_client().start_as_current_observation(as_type="span", name="handle_ticket"):
            with propagate_attributes(session_id=customer_email,  # 同一客户的多张工单归到一个 session
                                      user_id=customer_email, tags=["supportpilot", channel]):
                yield
    finally:
        current_ticket.reset(token)


def traced(name: str, fn: Callable[[dict], dict]) -> Callable[[dict], dict]:
    """把一个 LangGraph 节点函数包成 span,并告诉 LLMClient 现在是哪个节点在花钱。"""
    @wraps(fn)
    def wrapper(state: dict) -> dict:
        token = current_node.set(name)
        try:
            with get_client().start_as_current_observation(as_type="span", name=name):
                return fn(state)
        finally:
            current_node.reset(token)
    return wrapper
```

<div class="line-notes">

- `from contextlib import contextmanager` 把一个带 `yield` 的生成器函数变成可以写在 `with` 后面的上下文管理器。`yield` 之前的代码是进入,之后(这里是 `finally`)是退出。
- `from functools import wraps` 包装函数时保留原函数的名字和 docstring,LangGraph 报错时显示的才是 `classify` 而不是 `wrapper`。
- `from langfuse import get_client, propagate_attributes` langfuse 5.0.4 里这两个都在,实测能直接导入。
- `def ticket_trace(ticket_id: str, customer_email: str, channel: str = "web"):` 包住一整张工单的处理过程。
- `token = current_ticket.set(ticket_id)` `set` 返回一个 token,用来把变量恢复成设置之前的值。
- `with get_client().start_as_current_observation(as_type="span", name="handle_ticket"):` 开一个名为 `handle_ticket` 的根 span,里面的 span 和 generation 自动挂在它下面。
- `with propagate_attributes(session_id=customer_email,  # 同一客户的多张工单归到一个 session` 把 session、user、tags 传给里面所有的观测点。Langfuse 里按客户邮箱点开 session,能看到他的全部工单。
- `yield` `with ticket_trace(...):` 里面的代码就在这里执行。
- `current_ticket.reset(token)` 放在 `finally` 里,里面就算抛异常也会还原。实测驱动脚本在 `with` 里打印 `current_ticket.get()` 是 `T810000`,出了 `with` 又变回 `-`。
- `def traced(name: str, fn: Callable[[dict], dict]) -> Callable[[dict], dict]:` 装饰器工厂,传入节点名和节点函数,返回包好的新函数。
- `token = current_node.set(name)` 节点开始时记下「现在是 draft 在花钱」。
- `with get_client().start_as_current_observation(as_type="span", name=name):` 每个节点一个 span,挂在 `handle_ticket` 下面,trace 树就是这么长出来的。
- `return fn(state)` 原样调用节点函数、原样返回结果,LangGraph 察觉不到它被包了一层。
- `current_node.reset(token)` 节点结束后还原。实测账本里每一行的 `node` 都是对的:同一张退款工单依次是 `load_customer`、`classify`、`act` ×4、`draft`、`check`、`draft`、`check`(第一版草稿被质检退回了一次)。

</div>

Day 47 的节点是在 `make_nodes(deps)` 里用闭包定义的,所以不用一个个加装饰器,在 `build_graph` 注册节点的地方统一包一层就行:

```python
# supportpilot/src/supportpilot/agent/graph.py(build_graph 里改一行)
from ..obs.tracing import traced

# build_graph() 里注册节点的循环
for name, fn in n.items():
    g.add_node(name, traced(name, fn))  # 原来是 g.add_node(name, fn)
```

<div class="line-notes">

- `from ..obs.tracing import traced` 两个点表示上一级包,`agent/` 的上一级是 `supportpilot/`。
- `for name, fn in n.items():` `n` 是 `make_nodes(deps)` 返回的 `{节点名: 函数}` 字典,Day 48 之后一共 10 个节点。
- `g.add_node(name, traced(name, fn))  # 原来是 g.add_node(name, fn)` 在注册节点的地方统一包一层,不用一个个去改节点函数。实测改完后 Day 47–50 的 27 个单元测试照样全过:没配 Langfuse 时 `traced` 只多做了 contextvars 的设置和还原。

</div>

调用方用 `ticket_trace` 把整次运行包起来。命令行脚本(`scripts/run_tickets.py`、评测脚本)里是这样:

```python
with ticket_trace(ticket["id"], ticket["customer_email"]):
    graph.invoke({"ticket": ticket}, config)
```

Day 49 的 SSE 接口有个坑,我在这里卡了一个小时:`_events` 是同步生成器,Day 49 用 `iterate_in_threadpool` 在线程池里一步步推进它,而线程池每推进一步都会**复制一份新的上下文**,上一步里 `current_ticket.set()` 和 Langfuse 打开的 span 到下一步就不见了。表现是 trace 树断成好几截,账本里一半调用的 ticket_id 是 `-`。修法是让所有步骤在同一个 `Context` 对象里执行:

```python
# supportpilot/src/supportpilot/api/app.py(替换 Day 49 的 _sse,并在 _events 开头包一层 trace)
import contextvars

from starlette.concurrency import run_in_threadpool

_DONE = object()


def _sse(gen) -> EventSourceResponse:
    ctx = contextvars.copy_context()  # 整个生成器共用这一个上下文
    it = iter(gen)

    async def agen():
        while (item := await run_in_threadpool(ctx.run, next, it, _DONE)) is not _DONE:
            yield item
    return EventSourceResponse(agen())


def _events(graph, payload, ticket_id: str):
    email = _ticket_email(ticket_id)  # 查 biz.tickets 拿客户邮箱,一行 SQL,这里省略
    with ticket_trace(ticket_id, email):
        ...  # Day 49 原来的循环体整体缩进进来,一行不改
```

<div class="line-notes">

- `import contextvars` 下面要用 `copy_context()` 和 `Context.run()`。
- `from starlette.concurrency import run_in_threadpool` 把一个同步函数丢进线程池执行,`await` 等它的返回值。
- `_DONE = object()` 哨兵对象:一个独一无二的空对象,用 `is` 判断。生成器真的产出 `None` 也不会被误认成结束。
- `ctx = contextvars.copy_context()  # 整个生成器共用这一个上下文` 只复制一次,后面每一步都在这同一个 `ctx` 里执行。
- `it = iter(gen)` 拿到迭代器,下面一步步手动 `next`。
- `while (item := await run_in_threadpool(ctx.run, next, it, _DONE)) is not _DONE:` 从里往外读:`ctx.run(next, it, _DONE)` 在 `ctx` 这个上下文里执行 `next(it, _DONE)`,生成器结束时返回 `_DONE` 而不是抛 `StopIteration`;`run_in_threadpool` 把这件事放进线程池;`:=` 海象运算符把结果同时赋给 `item` 并拿来比较。<br>我用一个三步的小生成器实测了这个坑:第一步 `cur.set("T810000")`,后两步读 `cur`。Day 49 的 `iterate_in_threadpool` 得到 `['step1 cur=T810000', 'step2 cur=-', 'step3 cur=-']`,第二步就丢了;换成这里的写法,得到 `['step1 cur=T810000', 'step2 cur=T810000', 'step3 cur=T810000']`。
- `yield item` 异步生成器,`EventSourceResponse` 每拿到一个 `item` 就推给浏览器一条 SSE 事件。
- `def _events(graph, payload, ticket_id: str):` Day 49 的事件生成器,只在外面多包一层 trace。
- `email = _ticket_email(ticket_id)  # 查 biz.tickets 拿客户邮箱,一行 SQL,这里省略` 这个函数正文没给,需要自己补:`SELECT customer_email FROM biz.tickets WHERE id = %s`。
- `with ticket_trace(ticket_id, email):` 生成器里的 `with` 会一直保持打开,直到生成器跑完。所以前面必须保证每一步都在同一个 `ctx` 里,否则 `with` 进入时设置的 `current_ticket`,下一步就读不到了。

</div>

一个 `Context` 同一时刻只能被一个线程进入,这里每一步是顺序执行的,不会冲突。

如果你的工作流里用了 LangChain 的模型对象(比如 `ChatOpenAI`)而不是直接调 SDK,换一种接法:`from langfuse.langchain import CallbackHandler`,在 `graph.invoke(..., config={"callbacks": [CallbackHandler()]})` 里传进去,LangGraph 每个节点会自动成为 span。两种接法别混用,不然同一次调用会出现两遍。

还有一个坑:命令行脚本(比如评测脚本)跑完就退出,Langfuse SDK 是后台批量上报的,进程退出时队列里的事件可能还没发出去。脚本结尾加一句 `get_client().flush()`。FastAPI 这种常驻进程不用管。

## 账本:为什么不直接用 Langfuse 的成本数字

Langfuse 会根据模型名和 token 数推算成本,OpenAI、Anthropic、Google 的价格它内置了,DeepSeek 要你自己在 Project Settings 的 Models 里加一条定义。问题在于 DeepSeek 2026 年 10 月的价目表分高峰和空闲两档,空闲价是高峰价的一半,Langfuse 的模型定义表达不了「按时段变价」。你可以在 Langfuse 里按高峰价配置,把它当作成本上限看趋势;精确的账自己记。

自己记账还有一个好处:评测脚本跑完能直接出成本报告,不依赖任何外部服务,CI 里也能用。

先把价格写清楚。下面是我 2026 年 10 月 12 日在 [DeepSeek 中文价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) 查到的数字(元 / 百万 token),高峰时段是北京时间工作日 9:00–12:00 和 14:00–18:00:

| 模型 | 时段 | 输入·缓存命中 | 输入·缓存未命中 | 输出 |
| --- | --- | --- | --- | --- |
| deepseek-flash | 高峰 | 0.04 | 2 | 8 |
| deepseek-flash | 空闲 | 0.02 | 1 | 4 |
| deepseek-v4-pro | 高峰 | 0.30 | 9 | 27 |
| deepseek-v4-pro | 空闲 | 0.15 | 4.5 | 13.5 |

注意缓存命中价和未命中价差了 50 倍(flash)和 30 倍(pro)。这就是后面优化的突破口。价格以后一定会变,表格只是让你知道量级,代码里的价格放配置。

```python
# supportpilot/src/supportpilot/obs/pricing.py
"""模型计价。价格来自 DeepSeek 官方价格页(2026-10-12 查),单位:元 / 百万 token。"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

CST = timezone(timedelta(hours=8))


@dataclass(frozen=True)
class Price:
    hit: float   # 输入,缓存命中
    miss: float  # 输入,缓存未命中
    out: float   # 输出


# 高峰价;空闲时段打五折
PEAK_PRICES: dict[str, Price] = {
    "deepseek-flash": Price(hit=0.04, miss=2.0, out=8.0),
    "deepseek-v4-pro": Price(hit=0.30, miss=9.0, out=27.0),
}


def is_peak(ts: datetime | None = None) -> bool:
    t = (ts or datetime.now(CST)).astimezone(CST)
    if t.weekday() >= 5:  # 周末;法定节假日没处理,账会略微偏高,可以接受
        return False
    return 9 <= t.hour < 12 or 14 <= t.hour < 18


def split_prompt_tokens(usage) -> tuple[int, int]:
    """返回 (命中, 未命中)。DeepSeek 直接给两个字段;OpenAI 系把命中数放在 prompt_tokens_details 里。"""
    total = usage.prompt_tokens
    hit = getattr(usage, "prompt_cache_hit_tokens", None)
    if hit is None:
        details = getattr(usage, "prompt_tokens_details", None)
        hit = (getattr(details, "cached_tokens", 0) or 0) if details else 0
    return hit, total - hit


def cost_yuan(model: str, usage, ts: datetime | None = None) -> float:
    price = PEAK_PRICES.get(model)
    if price is None:
        return 0.0  # 未知模型不瞎算,报表里会显示为 0,提醒你补价格
    factor = 1.0 if is_peak(ts) else 0.5
    hit, miss = split_prompt_tokens(usage)
    out = usage.completion_tokens
    return factor * (hit * price.hit + miss * price.miss + out * price.out) / 1_000_000
```

<div class="line-notes">

- `CST = timezone(timedelta(hours=8))` 北京时间 UTC+8。DeepSeek 的高峰时段是按北京时间算的,服务器在别的时区也不会算错。
- `@dataclass(frozen=True)` `frozen=True` 生成的对象不可修改,价格表不会在运行中被谁误改。
- `hit: float   # 输入,缓存命中` 三个价格单位都是「元 / 百万 token」。
- `"deepseek-flash": Price(hit=0.04, miss=2.0, out=8.0),` 命中价是未命中价的 1/50,缓存是成本优化的大头。
- `def is_peak(ts: datetime | None = None) -> bool:` 不传时间就用现在,传了就用传入的,方便测试。
- `t = (ts or datetime.now(CST)).astimezone(CST)` `astimezone` 把任意时区的时间换算成北京时间。
- `if t.weekday() >= 5:  # 周末;法定节假日没处理,账会略微偏高,可以接受` `weekday()` 周一是 0,周六是 5、周日是 6。实测 `2026-10-24 10:00`(周六)返回 `False`。
- `return 9 <= t.hour < 12 or 14 <= t.hour < 18` 链式比较,等价于 `9 <= t.hour and t.hour < 12`。实测周四(10-22)`07:59` 是 `False`,`10:30` 是 `True`,`12:30` 午休是 `False`。我实跑那 6 张工单是 07:59–08:02,全按空闲价记账。
- `def split_prompt_tokens(usage) -> tuple[int, int]:` 把输入 token 拆成命中和未命中两部分,不同厂商的字段名不一样,统一在这里处理。
- `hit = getattr(usage, "prompt_cache_hit_tokens", None)` DeepSeek 直接给 `prompt_cache_hit_tokens`。实测 classify 那次调用:`prompt_tokens=791`,命中 256,拆出来是 `(256, 535)`。命中数总是 128 的倍数,DeepSeek 按 128 token 一块做缓存。
- `hit = (getattr(details, "cached_tokens", 0) or 0) if details else 0` OpenAI 系把命中数放在 `prompt_tokens_details.cached_tokens` 里。实测 `prompt_tokens=100, cached_tokens=64` 拆出来是 `(64, 36)`。`or 0` 兜住字段存在但值是 `None` 的情况。
- `price = PEAK_PRICES.get(model)` 用 `.get` 而不是 `[]`:模型名不在表里时返回 `None`,不抛 `KeyError`。
- `return 0.0  # 未知模型不瞎算,报表里会显示为 0,提醒你补价格` 实测 `cost_yuan("gpt-x", ...)` 返回 `0.0`。
- `factor = 1.0 if is_peak(ts) else 0.5` 空闲时段五折。
- `return factor * (hit * price.hit + miss * price.miss + out * price.out) / 1_000_000` 代入 classify 那次:`(256×0.04 + 535×2 + 142×8) / 1,000,000 = 0.00221624` 元,空闲时段乘 0.5,得 `0.00110812`,和账本里那一行的 0.00111 对得上。`1_000_000` 里的下划线只是方便读数字,Python 会忽略。

</div>

账本用 SQLite 就够了,一张表:

```python
# supportpilot/src/supportpilot/obs/ledger.py
import sqlite3
import threading
from datetime import datetime
from pathlib import Path

from .pricing import CST, cost_yuan, split_prompt_tokens

# 从本文件往上数三层就是项目根(obs → supportpilot → src → 根),在哪个目录启动都写到同一个文件
_DB = Path(__file__).resolve().parents[3] / "data" / "ledger.sqlite3"
_lock = threading.Lock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS llm_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    ticket_id TEXT NOT NULL,
    node TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL,
    hit_tokens INTEGER NOT NULL,
    completion_tokens INTEGER NOT NULL,
    cost_yuan REAL NOT NULL,
    latency_ms INTEGER NOT NULL
)
"""


def _conn() -> sqlite3.Connection:
    _DB.parent.mkdir(exist_ok=True)
    conn = sqlite3.connect(_DB, check_same_thread=False)
    conn.execute(_SCHEMA)
    return conn


def record_call(*, ticket_id: str, node: str, model: str, usage, latency_ms: int) -> None:
    now = datetime.now(CST)
    hit, _miss = split_prompt_tokens(usage)
    row = (
        now.isoformat(), ticket_id, node, model,
        usage.prompt_tokens, hit, usage.completion_tokens,
        cost_yuan(model, usage, now), latency_ms,
    )
    with _lock, _conn() as conn:
        conn.execute(
            "INSERT INTO llm_calls (ts, ticket_id, node, model, prompt_tokens, hit_tokens,"
            " completion_tokens, cost_yuan, latency_ms) VALUES (?,?,?,?,?,?,?,?,?)",
            row,
        )
```

<div class="line-notes">

- `import threading` FastAPI 会在多个线程里同时处理工单,写 SQLite 要加锁。
- `_DB = Path(__file__).resolve().parents[3] / "data" / "ledger.sqlite3"` `parents[0]` 是 `obs/`,`[1]` 是 `supportpilot/`,`[2]` 是 `src/`,`[3]` 就是项目根。最早写的是相对路径 `"data/ledger.sqlite3"`,结果在别的目录启动会报 `unable to open database file`。改成这样以后,我在 `/tmp` 下运行写账,文件照样写到了 `<项目根>/data/ledger.sqlite3`。
- `_lock = threading.Lock()` 模块级的一把锁,所有线程共用。
- `CREATE TABLE IF NOT EXISTS llm_calls (` `IF NOT EXISTS` 让每次连接都可以放心执行建表语句,第一次建表,之后什么都不做。
- `hit_tokens INTEGER NOT NULL,` 只存命中数,未命中数用 `prompt_tokens - hit_tokens` 算得出来。
- `cost_yuan REAL NOT NULL,` 记账那一刻就按当时的价格算好存下来。以后价格变了,旧账也不会被重算。
- `_DB.parent.mkdir(exist_ok=True)` 第一次运行时 `data/` 可能还不存在,先建上。实测把 `data/` 删掉再写账,目录和库文件都自动建出来了。
- `conn = sqlite3.connect(_DB, check_same_thread=False)` SQLite 连接默认只允许在创建它的线程里用,`check_same_thread=False` 关掉这个检查,并发安全由上面的锁来保证。
- `def record_call(*, ticket_id: str, node: str, model: str, usage, latency_ms: int) -> None:` `*` 后面全部要按名字传,五个参数不会传错位置。
- `now = datetime.now(CST)` 同一个 `now` 既写进 `ts`,也用来判断高峰还是空闲,两者不会对不上。
- `hit, _miss = split_prompt_tokens(usage)` 变量名以下划线开头,表示「拿到了但不用」,ruff 不会报未使用变量。
- `now.isoformat(), ticket_id, node, model,` 实测写进去的 `ts` 形如 `2026-10-22T07:59:49.123456+08:00`。
- `with _lock, _conn() as conn:` 一个 `with` 同时进入两个上下文:先拿锁,再开连接。sqlite3 连接的 `with` 结束时自动 commit,但不会关闭连接。
- `"INSERT INTO llm_calls (ts, ticket_id, node, model, prompt_tokens, hit_tokens,"` 实测 3 张工单跑两遍,一共写了 30 行。比如第一遍退款工单的 classify:`T810000|classify|deepseek-flash|791|256|142|0.00111|1031`。

</div>

每次调用都开一个连接看上去浪费,但对一个 demo 级服务完全够用,SQLite 写入是毫秒级的。如果你已经在用 Postgres 存会话,把这张表搬过去也行,SQL 几乎不用改。

报表脚本回答三个问题:每张工单花多少(平均、P50、P95),钱花在哪个节点,缓存命中率多少。

```python
# supportpilot/scripts/cost_report.py
"""用法:uv run python scripts/cost_report.py [--since 2026-10-12]"""
import argparse
import sqlite3
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]  # scripts/ 的上一层就是项目根


def pct(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    values = sorted(values)
    k = max(0, min(len(values) - 1, round(p / 100 * (len(values) - 1))))
    return values[k]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="1970-01-01")
    ap.add_argument("--db", default=str(ROOT / "data" / "ledger.sqlite3"))
    args = ap.parse_args()
    conn = sqlite3.connect(args.db)

    per_ticket = [
        r[0] for r in conn.execute(
            "SELECT SUM(cost_yuan) FROM llm_calls WHERE ts >= ? GROUP BY ticket_id", (args.since,)
        )
    ]
    print(f"工单数 {len(per_ticket)}")
    if per_ticket:
        print(
            f"单工单成本(元) 平均 {statistics.mean(per_ticket):.4f}"
            f"  P50 {pct(per_ticket, 50):.4f}  P95 {pct(per_ticket, 95):.4f}"
        )

    print("\n按节点:")
    rows = conn.execute(
        "SELECT node, model, COUNT(*), SUM(cost_yuan), AVG(latency_ms),"
        " SUM(hit_tokens) * 1.0 / MAX(SUM(prompt_tokens), 1)"
        " FROM llm_calls WHERE ts >= ? GROUP BY node, model ORDER BY SUM(cost_yuan) DESC",
        (args.since,),
    )
    print(f"{'node':<15}{'model':<18}{'calls':>6}{'cost':>10}{'avg_ms':>8}{'hit%':>7}")
    for node, model, n, cost, ms, hit in rows:
        print(f"{node:<15}{model:<18}{n:>6}{cost:>10.4f}{ms:>8.0f}{hit * 100:>6.1f}%")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `ROOT = Path(__file__).resolve().parents[1]  # scripts/ 的上一层就是项目根` 和 `ledger.py` 一样按文件位置推项目根,在哪个目录运行都行。
- `def pct(values: list[float], p: float) -> float:` 自己写一个分位数,不为这点事引入 numpy。
- `values = sorted(values)` 排序得到的是新列表,不会改动调用方传进来的那个。
- `k = max(0, min(len(values) - 1, round(p / 100 * (len(values) - 1))))` 下标按 `p% × (n-1)` 取最近的整数,再夹在 `[0, n-1]` 之间。实测 6 张工单的单张成本排好序是 `[0.013, 0.0135, 0.0175, 0.0206, 0.0479, 0.0936]`:P50 的下标是 `round(2.5)`,Python 的 `round` 遇到 .5 取最近的偶数,得 2,结果 0.0175;P95 的下标是 `round(4.75) = 5`,结果 0.0936。
- `ap.add_argument("--since", default="1970-01-01")` 默认从 1970 年算起,等于全部。
- `ap.add_argument("--db", default=str(ROOT / "data" / "ledger.sqlite3"))` 默认路径从项目根算,和 `ledger.py` 写的是同一个文件。实测在根目录 `/` 下运行 `python <项目根>/scripts/cost_report.py`,照样读到那 6 张工单。
- `r[0] for r in conn.execute(` 每行只有一列,取 `r[0]`。
- `"SELECT SUM(cost_yuan) FROM llm_calls WHERE ts >= ? GROUP BY ticket_id", (args.since,)` 按工单汇总花费。`ts` 是 ISO 字符串,和 `"2026-10-12"` 做字符串比较,刚好等于按时间比较。实测 6 张工单的单张成本是 0.0936、0.0206、0.0135、0.0479、0.0175、0.013 元。
- `print(f"工单数 {len(per_ticket)}")` 实测输出 `工单数 6`。
- `f"单工单成本(元) 平均 {statistics.mean(per_ticket):.4f}"` 实测 `平均 0.0344  P50 0.0175  P95 0.0936`。P95 正好是第一遍的退款工单:调了 4 次工具,草稿还被质检退回重写了一次,一张花了 0.0936 元。
- `"SELECT node, model, COUNT(*), SUM(cost_yuan), AVG(latency_ms),"` 按「节点 + 模型」分组。同一个节点可能用不同的模型,比如 check 按类别路由。
- `" SUM(hit_tokens) * 1.0 / MAX(SUM(prompt_tokens), 1)"` `* 1.0` 强制做浮点除法(SQLite 里整数除以整数会取整);两个参数的 `MAX(..., 1)` 防止除以 0。
- `print(f"{'node':<15}{'model':<18}{'calls':>6}{'cost':>10}{'avg_ms':>8}{'hit%':>7}")` `:<15` 左对齐占 15 格,`:>6` 右对齐占 6 格。节点列原来是 12 格,实跑时 13 个字符的 `load_customer` 和后面的模型名粘成了 `load_customerdeepseek-flash`,所以改成了 15。
- `for node, model, n, cost, ms, hit in rows:` 实测按花费从高到低:`draft deepseek-v4-pro 7 次 0.0928 元 平均 10757 ms 命中 38.7%`,`check deepseek-v4-pro 5 次 0.0739 元 12.2%`,`act deepseek-v4-pro 8 次 0.0287 元 80.8%`,`check deepseek-flash 2 次 0.0053 元`,`classify deepseek-flash 6 次 0.0040 元 56.4%`,`load_customer deepseek-flash 2 次 0.0015 元 0.0%`。<br>几个看点:起草和质检占了大头;act 多轮调用的前缀一样,命中率最高;用 `--since 2026-10-22T08:01:24` 只看第二遍,classify 的命中率从 56.4% 涨到 80.5%,同样的请求跑第二遍,前缀就进了缓存。

</div>

## 先用算式估一下,心里有数

动手优化之前,先拿算式估一张「典型工单」的钱,免得优化完不知道省得多不多。假设一张工单这样走(数字是按 SupportPilot 的 prompt 长度粗估的,你自己的可以从账本里取真实均值替换):

- classify:输入 1,500 token,输出 60 token。
- draft:输入 6,000 token(系统提示 + 政策摘要 + 检索到的 5 段文档 + 工具结果 + 对话历史),输出 400 token。
- check:输入 3,000 token,输出 80 token。

先按「全部用 v4-pro、完全不命中缓存、高峰时段」算:

- 输入合计 1,500 + 6,000 + 3,000 = 10,500 token,10,500 × 9 / 1,000,000 ≈ 0.0945 元。
- 输出合计 60 + 400 + 80 = 540 token,540 × 27 / 1,000,000 ≈ 0.0146 元。
- 一张约 0.109 元。一天 3,000 张就是 327 元,一个月接近一万。

这个数对一家小公司的客服团队来说不算夸张,但面试官会追问你「怎么降」。接下来两招。

## 第一招:让 prompt 前缀稳定,吃缓存命中价

DeepSeek、OpenAI 的缓存都是自动的,原理一样:如果这次请求的开头一段和最近某次请求一模一样,那一段就按命中价算。Anthropic 的 Claude 需要你在请求里显式标出缓存断点,写入时还要多付一点,读取很便宜,细节看它的 prompt caching 文档。三家的共同点是**只认前缀**,从第一个 token 开始逐个比对,中间哪怕差一个字符,后面的全部算未命中。

所以问题变成:你的 messages 里,哪些部分每张工单都一样,哪些每次都变?

- 每次都一样:系统提示(角色、语气、输出格式)、工具定义、退款政策等固定规则、few-shot 示例。
- 每张工单都变:客户信息、检索结果、工具返回、工单正文、对话历史。

很多人第一版的系统提示长这样,我自己就这么写过:

```python
# 反例:每次请求的第一行都不一样,后面几千 token 全部白白按未命中计费
system = f"""你是云簿 CloudLedger 的客服助手。现在是 {datetime.now():%Y-%m-%d %H:%M}。
当前客户:{customer['name']}(套餐 {customer['plan']})。
{POLICY_TEXT}
{FEW_SHOTS}
"""
```

<div class="line-notes">

- `system = f"""你是云簿 CloudLedger 的客服助手。现在是 {datetime.now():%Y-%m-%d %H:%M}。` f-string 里的 `:%Y-%m-%d %H:%M` 是 datetime 的格式说明,每分钟都不一样。它排在第一行,缓存从第一个 token 开始比对,第二十几个 token 就对不上了,后面全按未命中计费。
- `当前客户:{customer['name']}(套餐 {customer['plan']})。` 客户名也是每张工单都不同,同样毁掉前缀。
- `{POLICY_TEXT}` 真正长、真正值得缓存的政策和示例被压在变量后面,永远命中不了。改法是把它们挪到最前面,时间和客户信息放进 user 消息。

</div>

时间戳和客户名放在了最前面,于是后面 3,000 token 的政策和示例永远命中不了。规则就一条:固定内容在前、变量在后。

好消息是 Day 47 的节点本来就是这个结构:system 消息是 `prompts.DRAFT`、`prompts.CHECK` 这些模块级常量,工单、检索资料、调查结论都拼在后面的 user 消息里。你要做的是检查一遍 `prompts.py`,确认这些常量里没有偷偷用 f-string 塞进日期、客户名这类会变的东西;有的话挪到 user 消息里,比如在 draft 节点的 `parts` 列表最前面加一段「当前时间」。

```python
# supportpilot/src/supportpilot/agent/prompts.py(检查要点)
# 模块加载时就定死的字符串,每次请求逐字相同,才能命中缓存
DRAFT = """你是云簿 CloudLedger 的客服助手……"""   # 不要出现 {datetime.now()}、{customer} 这类变量
CHECK = """你是客服回复的质检员……"""
```

还有三个容易破坏前缀的细节,都是我在账本里看到命中率上不去才发现的:

- **工具定义的顺序要固定。** 如果你从字典或集合里生成 tools 列表,Python 字典顺序是插入顺序,一般稳定,但有人会按「本次可用工具」动态过滤,过滤后列表变了,前缀就断了。宁可把全部工具都给,用权限层拒绝不该调的。
- **JSON 序列化要稳定。** 工具 schema 或 few-shot 里如果有 `json.dumps`,加上 `sort_keys=True, ensure_ascii=False`。
- **对话历史放在固定部分之后。** 多轮对话时,历史本身也是前缀的一部分:第 3 轮的请求开头和第 2 轮的请求开头一致,所以多轮场景天然命中率高,前提是你没有每轮重写历史(比如每轮都重新摘要一遍)。

改完怎么验证?不用猜,看账本。同一组评测工单跑两遍,`hit%` 那一列应该从个位数涨到几十。

改完再算一次。假设 draft 的 6,000 输入里有 3,500 是固定前缀并且命中,classify 的 1,500 里有 1,200 命中,check 的 3,000 里有 2,000 命中(这几个比例是假设,真实值以账本为准):

- 命中 6,700 token × 0.30 / 1,000,000 ≈ 0.0020 元。
- 未命中 3,800 token × 9 / 1,000,000 ≈ 0.0342 元。
- 输出不变 0.0146 元。
- 合计约 0.051 元,比 0.109 元省了一半多,一行业务逻辑都没改。

## 第二招:模型路由,小模型干简单活

第二招更直观:不是每一步都需要最强的模型。分类是从 8 个固定类别里挑一个,质检是判断「这份草稿有没有引用、有没有承诺政策外的东西」,这些是封闭式判断,便宜模型通常够用。起草要读懂检索结果、结合账单数据、写出客户能看懂的话,这一步才值得上大模型。

Day 47 其实已经把位置留好了:`Deps` 里有 `llm`(起草用)和 `small_llm`(分类、质检用),只是 Day 44 的 `.env` 里 `LLM_SMALL_MODEL` 留空,两个用的是同一个模型。第一步就是把它填上:

```bash
# supportpilot/.env
LLM_MODEL=deepseek-v4-pro
LLM_SMALL_MODEL=deepseek-flash
```

第二步是给质检加一条例外。退款和账单类工单出错的代价大,质检宁可用贵一点的模型:

```python
# supportpilot/src/supportpilot/agent/routing.py
from .deps import Deps

# 涉及钱的类别(取值见 Day 47 的 Category),质检用大模型
HIGH_STAKES = {"refund", "billing", "invoice"}


def check_client(deps: Deps, state: dict):
    """质检默认走小模型,高风险类别升级到起草用的大模型。"""
    return deps.llm if state["triage"]["category"] in HIGH_STAKES else deps.small_llm
```

<div class="line-notes">

- `HIGH_STAKES = {"refund", "billing", "invoice"}` 集合字面量,`in` 判断是 O(1)。涉及钱的三类工单,质检用大模型。
- `def check_client(deps: Deps, state: dict):` 只决定质检用哪个模型,起草本来就固定用 `deps.llm`。
- `return deps.llm if state["triage"]["category"] in HIGH_STAKES else deps.small_llm` 实测 `.env` 设成 `LLM_MODEL=deepseek-v4-pro`、`LLM_SMALL_MODEL=deepseek-flash` 跑 3 张工单:退款和发票工单的 check 走了 `deepseek-v4-pro`,导入报错(technical)的 check 走了 `deepseek-flash`。<br>账本里差别很明显:v4-pro 的 check 平均 10965 ms、5 次花 0.0739 元;flash 的 check 平均 3142 ms、2 次只花 0.0053 元。

</div>

`check` 节点里把 `deps.small_llm.structured(...)` 换成 `check_client(deps, state).structured(...)` 就完成了。起草节点本来就用 `deps.llm`,不用动。

路由能不能用,最终还是看评测分数,不是看我的直觉。一个常见结果是:分类换成小模型后,准确率掉了一两个点,集中在「既像退款又像账单争议」的模糊工单上。这时候有两个选择,要么给分类 prompt 加几个这类边界的 few-shot,要么接受这点损失,因为分类错了后面的自检和转人工还能兜住。这种取舍正是面试里想听的,把你的数据和决定写进 Day 54 的 README。

按路由再算一次(在第一招的基础上):classify 和 check 改走 flash,flash 高峰价命中 0.04、未命中 2、输出 8。

- classify:1,200 × 0.04 + 300 × 2 + 60 × 8 = 48 + 600 + 480,即 1,128 / 1,000,000 ≈ 0.0011 元。
- check:2,000 × 0.04 + 1,000 × 2 + 80 × 8 = 80 + 2,000 + 640,即 2,720 / 1,000,000 ≈ 0.0027 元。
- draft 还是 pro:3,500 × 0.30 + 2,500 × 9 + 400 × 27 = 1,050 + 22,500 + 10,800,即 34,350 / 1,000,000 ≈ 0.0344 元。
- 合计约 0.038 元。再把批量任务(比如夜里重跑评测)放到空闲时段,还能再打五折。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="三种配置下单工单成本估算对比">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">单工单成本估算(元,高峰价,按文中算式)</text>
  <text x="20" y="72" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">A 全 pro·无缓存</text>
  <rect x="180" y="58" width="380" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="566" y="74" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">0.109</text>
  <text x="20" y="122" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">B + 稳定前缀</text>
  <rect x="180" y="108" width="178" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="364" y="124" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">0.051</text>
  <text x="20" y="172" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">C + 模型路由</text>
  <rect x="180" y="158" width="132" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="318" y="174" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">0.038</text>
  <text x="20" y="212" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">假设的 token 数和命中率,换成你账本里的真实均值再算一遍</text>
</svg>
<figcaption>同一张「典型工单」在三种配置下的估算成本。数字全部来自上文算式,不是实测;实测值填到下面的记录表里。</figcaption>
</figure>

## 账算完了,值不值:Agent 和人工的单工单 ROI

省到 0.04 元一张,听起来很便宜。但招聘方真正关心的问题不是「模型花了多少钱」,而是「上了这个 Agent,一张工单的总成本比纯人工低多少」。今天的 JD 调研里有一家大型游戏公司把「Agent 经济学:成本建模、ROI、Agent vs 人工」直接写进了加分项,海外 JD 里提成本、延迟、ROI 的比例也接近四成。这一节给你一个能套用的算账模板。

先算人工处理一张工单的成本:

- 时薪 = 月薪 × 用工成本系数 ÷ 每月工作小时。用工成本系数把社保、公积金、工位、管理成本都算进去,国内常用 1.3 到 1.6 之间的经验值。
- 单工单人工成本 = 时薪 × 平均处理时长。

再算 Agent 参与后的单工单成本,它不是只有模型费用:

- 模型费用:就是账本里的平均值。
- 基础设施摊销:服务器、数据库、Langfuse 等每月费用 ÷ 每月工单量。
- 人工复核:如果每份草稿都要客服看一眼再发,复核比例 × 复核时长 × 时薪。
- 转人工:Agent 处理不了、转给人从头处理的比例 × 人工全流程成本。
- 出错代价:Agent 答错、客户二次来问或投诉的比例 × 每次出错的处理成本。

拿一组假设数字走一遍(全部是假设,目的是看清哪一项最重要):客服月薪 8,000 元,系数 1.4,每月 174 小时,时薪约 64 元;人工处理一张工单平均 8 分钟,成本约 8.6 元。Agent 这边:模型 0.04 元;服务器每月 300 元、每月 3 万张工单,摊下来 0.01 元;所有草稿人工复核,平均 1.5 分钟,约 1.6 元;转人工率 25%,即 0.25 × 8.6 ≈ 2.15 元;出错率 3%、每次出错额外花 15 分钟处理,即 0.03 × 16 ≈ 0.48 元。合计约 4.3 元,比纯人工的 8.6 元省一半。

这个算式最有意思的地方是:模型费用 0.04 元在 4.3 元里几乎可以忽略。真正决定 ROI 的是转人工率、复核时长和出错率,也就是 Agent 的**质量**。把转人工率从 25% 降到 15%,省下的钱(约 0.86 元一张)是你把模型费用降到零也省不出来的。这就是为什么前面花了整整一周做评测:评测分数直接决定 ROI,token 优化只是锦上添花。面试时被问到「这个 Agent 值不值」,按这个结构答,并且主动指出 ROI 对哪个参数最敏感,会比只报一个 token 成本强得多。

| 项目 | 假设值 | 你的项目(填真实或调研值) |
| --- | --- | --- |
| 人工时薪 | 64 元 | |
| 人工平均处理时长 | 8 分钟 | |
| 模型费用 / 单 | 0.04 元 | |
| 基础设施摊销 / 单 | 0.01 元 | |
| 人工复核比例 × 时长 | 100% × 1.5 分钟 | |
| 转人工率 | 25% | |
| 出错率 × 出错处理时长 | 3% × 15 分钟 | |
| Agent 单工单总成本 | 约 4.3 元 | |
| 相对纯人工节省 | 约 50% | |

转人工率和出错率可以直接从 Day 50 的评测结果里取(评测集里判为「应转人工」和「答错」的比例),这样你的 ROI 表就和评测数据连起来了。

## 别为了省钱把延迟和分数搞坏

优化有三个指标在互相拉扯:分数、延迟、成本。今天两招对延迟的影响方向不同。缓存命中通常让首 token 更快,因为前缀不用重新算。路由到小模型一般也更快。但「自检不过就用大模型重写」会让少数工单多一轮大模型调用,P95 延迟可能反而变长。所以评测时三列一起看,不要只盯着成本那列。

还有一类常见的「省钱」做法我不建议在毕业项目里做:语义缓存,也就是「问题相似就直接返回上次的答案」。客服工单里两个客户问「为什么多扣了我一笔钱」,字面几乎一样,答案却取决于各自的账单。缓存错一次就是把 A 客户的账单信息说给 B 听。Day 38 讲过它适用的场景,这里不适用。

## 动手练习

**步骤**

1. 注册 Langfuse 云版(或按官方文档自托管),把三个环境变量写进 `.env`,运行 `uv run python -c "from langfuse import get_client; print(get_client().auth_check())"`,打印 `True` 再往下走。
2. 按上文改 `llm.py`,加 `obs/pricing.py`、`obs/ledger.py`、`obs/tracing.py`,在 `build_graph` 里给节点套上 `traced`,脚本和 SSE 接口用 `ticket_trace` 包住整次运行,别忘了替换 `_sse`。
3. 用当前版本(还没做两招优化)跑一遍 Day 50 的评测集,跑完 `get_client().flush()`。在 Langfuse 里随便点开三张工单,确认树的结构是「handle_ticket 下面挂着各节点,节点下面挂着 generation」。
4. 跑 `uv run python scripts/cost_report.py --since <今天日期>`,把结果填进下表的「基线」行。
5. 做第一招(稳定前缀),再跑一遍评测和报表,填「+ 稳定前缀」行。
6. 做第二招(模型路由),再跑一遍,填「+ 路由」行。
7. 在 Langfuse 里找出成本最高的 3 张工单,点开看它们为什么贵(通常是自检反复失败,或者检索结果太长),写两三句结论。

**记录表(留空,填你自己跑出来的值)**

| 配置 | 评测分数 | P50 延迟 | P95 延迟 | 单工单成本 平均 / P95 | 缓存命中率 |
| --- | --- | --- | --- | --- | --- |
| 基线 | | | | | |
| + 稳定前缀 | | | | | |
| + 路由 | | | | | |

**验收标准**

- Langfuse 里每张评测工单是一棵完整的树,没有散落的孤立 generation。
- 账本里所有调用的 `cost_yuan` 都大于 0(等于 0 说明有模型没配价格)。
- 稳定前缀之后,draft 节点的缓存命中率明显高于基线(具体多少取决于你的 prompt 结构,能说清楚为什么是这个数就行)。
- 路由之后评测分数下降不超过你在 Day 43 定的容忍线,如果超了,写下你是加 few-shot 还是回退了哪个节点。
- 能用一分钟向别人讲清楚:钱主要花在哪个节点,你做了什么,省了多少,代价是什么。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| trace | 一次完整请求的全过程记录,这里就是一张工单从进来到回复的所有步骤 |
| span | trace 里的一个步骤,可以嵌套,比如一个 LangGraph 节点 |
| generation | Langfuse 里专指一次模型调用的 span,额外记录 prompt、输出、token、成本 |
| session | 把多条 trace 归成一组,这里按客户 ID 归,能看到同一客户的历次工单 |
| flush | 把 SDK 后台队列里还没上报的事件立即发出去,短命脚本退出前要调 |
| prompt caching | 服务商对重复的 prompt 前缀不再重新计算,按更低的命中价计费 |
| 缓存命中率 | 命中缓存的输入 token 占全部输入 token 的比例 |
| 模型路由 | 按任务难度、风险把请求分给不同价位的模型 |
| P95 | 把所有值从小到大排,第 95% 位置上的值,用来看「慢的那一小撮」有多慢 |
| contextvars | Python 标准库,给每个并发请求保存各自的上下文变量,不互相串 |

## 常见误区

**只看平均成本。** 平均 0.04 元很好看,但如果 5% 的工单因为自检循环花了 0.5 元,这些工单往往也是答得最差的。P95 和最贵的几张要单独看。

**把时间戳放在系统提示第一行。** 这是缓存命中率为零的头号原因。任何每次都变的东西都往后放。

**以为换了 Langfuse 导入就万事大吉。** 不包外层 span、不传 session,得到的是一堆互不相关的单次调用,排查时比日志好不了多少。

**用 Langfuse 推算的成本当账单。** 它不知道 DeepSeek 的高峰空闲价,也不知道你哪些 token 命中了缓存(取决于集成有没有上报这部分)。自己记的账本才是准的,Langfuse 的数字用来看趋势。

**路由规则凭感觉定。** 「分类用小模型肯定够」这句话需要评测分数背书。先跑基线,再改一处,再跑,一次只动一个变量。

**在客服场景用语义缓存省钱。** 相似问题不代表相同答案,账单类问题尤其如此,错一次就是数据泄露。

## 学习资料

### 文档与文章

- [Langfuse · OpenAI (Python) 集成](https://langfuse.com/integrations/model-providers/openai-py):替换导入、设置 session 和 tags、flush 的官方写法,今天的代码基本照着它来,15 分钟。
- [Langfuse · LangChain / LangGraph 集成](https://langfuse.com/integrations/frameworks/langchain):如果你的节点用了 LangChain 模型对象,看 CallbackHandler 那一节。
- [Langfuse · Docker Compose 自托管](https://langfuse.com/self-hosting/deployment/docker-compose):自托管步骤和限制说明,决定云版还是自托管前读一遍。
- [Langfuse · Token 与成本追踪](https://langfuse.com/docs/observability/features/token-and-cost-tracking):成本是怎么推算的,怎么加自定义模型价格。
- [DeepSeek 模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):高峰空闲两档价格,写代码前再查一次。
- [DeepSeek 上下文硬盘缓存](https://api-docs.deepseek.com/zh-cn/guides/kv_cache):缓存怎么判定命中、usage 里的两个字段,10 分钟。
- [Anthropic · Prompt caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching):显式缓存断点的做法,和 DeepSeek 的自动缓存对照着读,面试常问区别。
- [OpenAI · Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching):OpenAI 的自动缓存规则和 `cached_tokens` 字段。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1tUpDzwEr3&autoplay=0&high_quality=1" title="【Langfuse】开源LLM监控平台" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>胖虎遛二狗 · 【Langfuse】开源LLM监控平台 · 约 26 分钟,重点看容器部署和接入后界面上 trace 怎么看,它所在合集还有 prompt 版本管理和评估实验,可以挑着看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV19Z4Q6BExr&autoplay=0&high_quality=1" title="国产大模型API价格比拼:DeepSeek、Qwen、GLM、MiMo、MiniMax、Kimi" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>FutureAI实验室 · 国产大模型API价格比拼:DeepSeek、Qwen、GLM、MiMo、MiniMax、Kimi · 不到 3 分钟,2026 年 8 月的横向对比,帮你选「小模型」那一档的候选。价格以各家官网为准。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/THfB4p2xCFY" title="Langfuse Walkthrough - Full Demo of Agent Tracing, Evals, Experiments and Prompt Management" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Langfuse · Langfuse Walkthrough - Full Demo of Agent Tracing, Evals, Experiments and Prompt Management · 官方完整演示,看 agent tracing 和 sessions 两段,对照你自己的 trace 结构。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/SkM4k4SKvCM" title="Prompt Caching Explained: Stop Overpaying for AI Agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hugging Face · Prompt Caching Explained: Stop Overpaying for AI Agents · 讲为什么 Agent 场景特别适合缓存,以及前缀被破坏的几种方式。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 9 章 Inference Optimization 里讲 prompt caching 的部分,第 10 章 AI Engineering Architecture and User Feedback 讲监控与可观测,合计 1.5 小时。
- Michael Albada《Building Applications with AI Agents》(O'Reilly, 2025):第 10 章 Monitoring in Production,讲 Agent 上线后看什么指标。

### 开源项目与代码

- [langfuse/langfuse](https://github.com/langfuse/langfuse):Langfuse 本体,自托管用的 `docker-compose.yml` 就在根目录。
- [BerriAI/litellm](https://github.com/BerriAI/litellm):统一多家模型接口的代理,自带路由、重试和成本统计,看它的 [routing 文档](https://docs.litellm.ai/docs/routing) 了解生产里路由一般做到什么程度。
- [lm-sys/RouteLLM](https://github.com/lm-sys/RouteLLM):用学出来的路由器在强弱模型之间分流的研究项目,读 README 就够,知道「路由也能训练」这件事,面试时可以提。

## 自测

1. SupportPilot 每张工单都打出了 trace,但在 Langfuse 里看到的是一堆互不相关的 generation,原因最可能是什么?

<details><summary>答案</summary>

只换了 `langfuse.openai` 的导入,没有在入口用 `@observe` 开外层 span(或者节点没有套 span),于是每次模型调用都各自成为一条 trace。解决办法是入口函数加 `@observe(name="handle_ticket")`,节点函数也加,让调用在同一个上下文里嵌套。

</details>

2. 你的 draft 节点每次输入 6,000 token,其中系统提示 3,000 token 每次都一样,但账本显示命中率只有 2%。列出两个最可能的原因。

<details><summary>答案</summary>

一是系统提示的开头放了会变的内容,比如当前时间、客户名、工单号,导致前缀从第一个字就不同。二是工具定义或 few-shot 每次生成的顺序或序列化结果不一样(比如按本次可用工具动态过滤、`json.dumps` 没固定 key 顺序)。另外还可能是两次请求间隔太久,缓存已经被清掉了。

</details>

3. 按文中 DeepSeek 高峰价,一次 v4-pro 调用输入 8,000 token(其中 5,000 命中)、输出 500 token,花多少钱?同样的调用放在空闲时段呢?

<details><summary>答案</summary>

高峰:5,000 × 0.30 + 3,000 × 9 + 500 × 27 = 1,500 + 27,000 + 13,500 = 42,000,除以一百万得 0.042 元。空闲时段打五折,0.021 元。

</details>

4. (面试题)「你的 Agent 一张工单成本多少?怎么降下来的?」请用你的项目回答,控制在一分钟。

<details><summary>答案</summary>

答题结构:先给基线数字和口径(比如「按 DeepSeek 高峰价,基线平均 X 元、P95 Y 元,钱主要花在起草节点,占 Z%」),再讲两招:稳定前缀让缓存命中率从 A 到 B,模型路由让分类和自检走小模型;然后给结果(成本降到多少,评测分数变化多少,P95 延迟变化多少);最后讲取舍,比如高风险类别仍然用大模型、没有做语义缓存的原因。所有数字必须来自你自己的记录表,面试官很可能追问「这个数怎么测的」。

</details>

5. (面试题)「这个 Agent 上线后能给公司省多少钱?」你会怎么算?哪个参数对结果影响最大?

<details><summary>答案</summary>

按「人工单工单成本」对比「Agent 单工单总成本」算。后者包括模型费用、基础设施摊销、人工复核、转人工(转人工率 × 人工全流程成本)和出错代价。通常模型费用占比极小,影响最大的是转人工率、复核时长和出错率,也就是 Agent 的质量,所以提升评测分数比压 token 成本更能改善 ROI。回答时给出你的假设值和来源,并说明哪些是估计。

</details>

6. 有人建议对「常见问题」做语义缓存,问题向量相似度超过 0.95 就直接返回历史答案。在 SupportPilot 里你会怎么回应?

<details><summary>答案</summary>

不在工单回复上用。客服工单的答案往往依赖客户自己的账单、订阅状态,字面相似的两个问题答案可以完全不同,缓存命中等于把 A 客户的信息给了 B,是数据泄露。如果要用,只能用在完全不含个人数据的环节,比如对知识库 FAQ 的检索结果做缓存,而不是对最终回复做缓存。

</details>

## 明天预告

Day 53 · 安全加固与上线:注入测试、权限、Docker 部署。SupportPilot 要第一次放到公网上让别人用,在这之前要先当一回攻击者:往工单正文和知识库文章里埋指令,看它会不会把别的客户的账单说出来、会不会绕过审批直接退款。然后用 Docker Compose 把服务、数据库、前端一起部署到云服务器,加上限流和每日额度,防止 demo 被人刷爆你的 API 账户。
