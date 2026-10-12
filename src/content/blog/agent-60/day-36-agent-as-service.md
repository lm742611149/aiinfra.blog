---
title: 'Day 36 · 把 Agent 做成服务:FastAPI、SSE 流式接口、会话管理'
description: '前五周的工单 Agent 一直活在命令行里。今天给它套上 HTTP 接口:用 FastAPI 原生 SSE 把 token、工具调用和审批请求实时推给前端,用 LangGraph 的 Postgres checkpointer 管会话,再处理好并发、超时和用户中途关掉页面这几件事。'
pubDate: 2026-10-12
regime: none
tags: ['fastapi', 'sse', 'streaming', 'session', 'langgraph', 'agent-60']
series: 'agent-60'
day: 36
lang: 'zh'
---

## 今天要解决的问题

到 Day 35 为止,你手里的工单 Agent 已经能分类、检索、调 MCP 工具、退款前停下来等人审批,还有一套评测集守着。但它只能在终端里跑:`python run.py`,输入一句话,看一堆日志滚过去。没人能用它。

这周的主题是生产化,第一步就是把它变成一个别人能调用的服务。今天结束时你应该能做到这几件事:

1. 说清楚为什么 Agent 接口几乎都用 SSE(Server-Sent Events)而不是普通的 JSON 响应,也说得出它和 WebSocket 的取舍。
2. 用 FastAPI 写出一个流式接口,把模型吐出的 token、工具调用、工具结果、审批请求按事件类型推给前端。
3. 用 LangGraph 的 Postgres checkpointer 保存会话,服务重启以后用户接着聊,上下文不丢。
4. 处理三个线上一定会遇到的情况:同一个会话被连点两次、一轮对话卡住不返回、用户聊到一半关掉了页面。
5. 用一个 60 行的 HTML 页面把流式效果跑出来,亲眼看到工具调用卡片一张张冒出来。

预计用时 4–6 小时。前置是 Day 4(流式输出)、Day 25(checkpoint 和 interrupt)、Day 28 的工单分流 Agent。如果你的 W4 代码组织方式和我的不一样,没关系,今天会写一个适配层,只要改一行导入。

## 先想清楚:Agent 接口和普通接口差在哪

你写过很多年的 REST 接口,大多数是这个节奏:请求进来,查库,拼 JSON,200 返回,整个过程几十毫秒。Agent 接口把这个节奏打破了,原因有三个。

第一是慢。一轮工单处理要调两三次模型、查一两次知识库、可能还要调订单系统,端到端十几秒很常见,复杂的能到一分钟。让用户盯着一个转圈的按钮等 15 秒,体验跟坏了没区别。Day 4 讲过首 token 延迟:模型开始吐字通常只要一两秒,把字一个个推出去,用户感知到的等待就从 15 秒变成了 1.5 秒。

第二是过程本身有价值。客服坐席看到「正在查询订单 #A1024……」「找到 3 篇相关帮助文章」,他会更信任最后的回复,也能在 Agent 走偏的时候提前喊停。这些中间事件如果只在最后一次性返回,就失去了意义。

第三是会中途停下来。我们的 Agent 在退款前会 interrupt,等人审批。审批可能几秒,也可能是第二天早上主管上班才点。所以一轮请求不一定在一次 HTTP 连接里结束,服务端必须把「停在哪」存下来,下一次请求再接着跑。

这三点决定了今天的设计:用流式协议推事件,用持久化的 checkpoint 存会话,用两个接口分别处理「发消息」和「回复审批」。

## SSE 是什么,为什么不用 WebSocket

SSE 说白了就是一个不关闭的 HTTP 响应。服务端把 `Content-Type` 设成 `text/event-stream`,然后隔一会儿往响应体里写一段文本,浏览器收到一段处理一段。每段长这样:

```text
event: token
data: {"text": "您好"}

event: tool_call
data: {"name": "get_invoice", "args": {"invoice_id": "INV-2031"}}

```

每条事件由若干 `字段: 值` 行组成,以一个空行结尾。常用字段只有四个:`event`(事件类型)、`data`(内容)、`id`(编号,断线重连用)、`retry`(建议客户端几毫秒后重连)。还有以冒号开头的注释行,一般拿来做心跳。

你调 DeepSeek 或 OpenAI 的流式接口时,底层就是 SSE。Day 4 写的 `stream=True` 循环,SDK 帮你把这种文本解析成了一个个 chunk。今天我们换到另一边,当发送方。

WebSocket 是双向的,看起来更强大,为什么大家做 LLM 接口反而偏爱 SSE?我做过两种,结论是这样的。SSE 就是普通 HTTP,现有的负载均衡、网关、鉴权中间件、日志、限流全都直接能用;WebSocket 要单独处理握手升级、心跳、连接状态,很多公司的网关配置还得专门开。Agent 场景里客户端到服务端的方向其实很少有实时需求,用户发一句话、点一下审批,用普通 POST 足够。真正需要实时推的只有服务端到客户端这一个方向,这正是 SSE 的强项。

什么时候该用 WebSocket?语音对话这种双向持续传音频的场景,或者协同编辑那种客户端也要高频推送的场景。做文字客服 Agent,SSE 足够,而且省心得多。

有一个坑先说在前面:浏览器原生的 `EventSource` 只支持 GET,不能带请求体,也不能自定义请求头。而我们发消息需要 POST 一段 JSON,还要带鉴权头。所以前端一般不用 `EventSource`,而是用 `fetch` 拿到响应流自己解析。后面的前端代码就是这么写的。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="一次发消息请求的数据流:浏览器 POST 到 FastAPI,FastAPI 驱动 LangGraph 运行,LangGraph 调模型和工具,中间事件经 SSE 推回浏览器,状态写入 Postgres">
<rect x="10" y="110" width="110" height="70" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="65" y="140" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">浏览器</text>
<text x="65" y="160" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">fetch + 读流</text>
<rect x="190" y="110" width="120" height="70" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="250" y="140" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">FastAPI</text>
<text x="250" y="160" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">适配层转事件</text>
<rect x="380" y="110" width="110" height="70" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="435" y="140" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">LangGraph</text>
<text x="435" y="160" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">工单工作流</text>
<rect x="540" y="40" width="90" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="585" y="70" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">LLM API</text>
<rect x="540" y="120" width="90" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="585" y="150" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">MCP 工具</text>
<rect x="540" y="200" width="90" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="585" y="230" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">知识库</text>
<rect x="380" y="235" width="110" height="50" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="435" y="258" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Postgres</text>
<text x="435" y="275" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">checkpoint</text>
<line x1="120" y1="130" x2="190" y2="130" stroke="var(--ink-soft)" stroke-width="1.5"/>
<text x="155" y="122" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">POST</text>
<line x1="190" y1="165" x2="120" y2="165" stroke="var(--mem)" stroke-width="2" stroke-dasharray="5 3"/>
<text x="155" y="185" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">SSE 事件</text>
<line x1="310" y1="145" x2="380" y2="145" stroke="var(--ink-soft)" stroke-width="1.5"/>
<line x1="490" y1="130" x2="540" y2="70" stroke="var(--ink-soft)" stroke-width="1.2"/>
<line x1="490" y1="145" x2="540" y2="145" stroke="var(--ink-soft)" stroke-width="1.2"/>
<line x1="490" y1="160" x2="540" y2="222" stroke="var(--ink-soft)" stroke-width="1.2"/>
<line x1="435" y1="180" x2="435" y2="235" stroke="var(--ink-soft)" stroke-width="1.2"/>
<text x="300" y="30" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">请求只走一次,事件一路往回推</text>
</svg>
<figcaption>一次发消息的完整路径。浏览器只发一个 POST,FastAPI 一边驱动 LangGraph 往下跑,一边把途中发生的事翻译成 SSE 事件推回去;每一步的状态落到 Postgres,服务重启也不丢。</figcaption>
</figure>

## 设计事件协议:前端到底需要知道什么

在动手写代码之前,先把服务端会推哪些事件定下来。这一步很多人跳过,直接把 LangGraph 吐出来的东西原样转给前端,结果前端要理解 LangGraph 的内部结构,后端一换框架前端跟着重写。我的建议是自己定一套小而稳定的事件协议,LangGraph 只是实现细节。

工单 Agent 需要六种事件:

| event | data 内容 | 前端怎么用 |
| --- | --- | --- |
| `token` | `{"text": "..."}` | 追加到当前回复气泡里 |
| `tool_call` | `{"id", "name", "args"}` | 显示一张「正在查询……」的卡片 |
| `tool_result` | `{"id", "name", "ok", "preview"}` | 把对应卡片标成完成,显示摘要 |
| `approval_required` | `{"action", "detail"}` | 弹出审批面板,两个按钮 |
| `done` | `{"usage": {...}, "elapsed_ms"}` | 结束加载状态,显示本轮花费 |
| `error` | `{"code", "message"}` | 显示错误,允许重试 |

`tool_result` 里只放 `preview`,不要把工具返回的完整 JSON 推给浏览器。一是太大,二是里面可能有别的客户的信息(Day 40 会专门讲),三是前端根本用不上。

每个事件都带一个递增的 `id`。浏览器断线重连时会带上 `Last-Event-ID` 头,理论上服务端可以从那之后续推。今天我们先不做续推,只把 id 带上,为以后留口子。

## 搭项目骨架

在 `agent-60-lab` 下新建 `w6` 目录。依赖如下,FastAPI 要 0.135 以上,因为原生 SSE 支持是这个版本加进来的(FastAPI 官方文档的 Server-Sent Events 一节写明了「Added in FastAPI 0.135.0」):

```bash
cd agent-60-lab
uv add "fastapi>=0.135" "uvicorn[standard]" pydantic-settings \
  "langgraph-checkpoint-postgres" "psycopg[binary,pool]"
```

如果你 W4 已经装了 langgraph、langchain-openai 这些,不用重复装。目录结构:

```text
agent-60-lab/w6/
├── app/
│   ├── __init__.py
│   ├── config.py        # 配置
│   ├── events.py        # 事件协议
│   ├── agent_adapter.py # LangGraph → 事件
│   ├── sessions.py      # 会话表和锁
│   └── main.py          # FastAPI 入口
└── static/
    └── index.html       # 测试页面
```

配置用 pydantic-settings,从环境变量和 `.env` 读,和 Day 2 讲的一样:

```python
# agent-60-lab/w6/app/config.py
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://postgres:postgres@localhost:5432/agent"
    llm_base_url: str = "https://api.deepseek.com"
    llm_api_key: str = ""
    llm_model: str = "deepseek-flash"
    turn_timeout_s: float = 120.0      # 一轮对话最长跑多久
    max_message_chars: int = 4000      # 用户单条消息上限


settings = Settings()
```

`deepseek-flash` 是我 2026 年 10 月在 DeepSeek 官方定价页看到的模型名,旧的 `deepseek-chat` 别名已经下线了。你用别家就改 `LLM_MODEL`,代码不用动。

## 事件模型

```python
# agent-60-lab/w6/app/events.py
from typing import Any, Literal

from pydantic import BaseModel

EventType = Literal["token", "tool_call", "tool_result", "approval_required", "done", "error"]


class AgentEvent(BaseModel):
    type: EventType
    data: dict[str, Any]


def preview(value: Any, limit: int = 160) -> str:
    """工具结果只给前端看一个短摘要。"""
    text = value if isinstance(value, str) else repr(value)
    return text if len(text) <= limit else text[:limit] + "…"
```

就这么简单。故意不用继承搞六个子类,事件类型多了以后前端靠 `type` 字段分派就行。

## 适配层:把 LangGraph 的输出翻译成事件

这是今天最关键的一段代码。LangGraph 的 `astream` 支持同时订阅多种流模式,我们要两种:

- `messages`:模型生成时逐 token 吐出 `AIMessageChunk`,同时附带元数据,告诉你是哪个节点在说话。
- `updates`:每个节点跑完后,吐出这个节点对状态做了什么更新。工具节点跑完时,我们从这里拿到 `ToolMessage`;遇到 interrupt 时,这里会出现一个 `__interrupt__` 键。

同时订阅多种模式时,`astream` 每次产出一个 `(mode, chunk)` 二元组。

还有一个细节要处理:工单 Agent 里不止一个节点会调模型。分类节点也调,但它输出的是结构化 JSON,用户不该看到;只有起草回复的节点输出才应该作为 token 推出去。所以要按 `metadata["langgraph_node"]` 过滤。下面代码里的 `DRAFT_NODES` 改成你 W4 图里起草节点的名字。

```python
# agent-60-lab/w6/app/agent_adapter.py
from collections.abc import AsyncIterator
from typing import Any

from langchain_core.messages import AIMessageChunk, ToolMessage
from langgraph.types import Command

from .events import AgentEvent, preview

# 只有这些节点的输出会作为 token 推给用户。按你 W4 的图改名字。
DRAFT_NODES = {"draft_reply", "agent"}


async def _drive(graph, graph_input: Any, config: dict) -> AsyncIterator[AgentEvent]:
    usage = {"input_tokens": 0, "output_tokens": 0}
    async for mode, chunk in graph.astream(
        graph_input, config=config, stream_mode=["messages", "updates"]
    ):
        if mode == "messages":
            msg, meta = chunk
            if not isinstance(msg, AIMessageChunk):
                continue
            if msg.usage_metadata:  # 部分厂商只在最后一个 chunk 带 usage
                usage["input_tokens"] += msg.usage_metadata.get("input_tokens", 0)
                usage["output_tokens"] += msg.usage_metadata.get("output_tokens", 0)
            if meta.get("langgraph_node") in DRAFT_NODES and msg.content:
                yield AgentEvent(type="token", data={"text": msg.content})
            continue

        # mode == "updates": {节点名: 状态更新}
        for node, update in chunk.items():
            if node == "__interrupt__":
                intr = update[0]  # 一个 Interrupt 对象,value 是 W4 里 interrupt() 传进去的东西
                yield AgentEvent(type="approval_required", data=dict(intr.value))
                continue
            if not isinstance(update, dict):
                continue
            for m in update.get("messages", []):
                if getattr(m, "tool_calls", None):
                    for tc in m.tool_calls:
                        yield AgentEvent(
                            type="tool_call",
                            data={"id": tc["id"], "name": tc["name"], "args": tc["args"]},
                        )
                if isinstance(m, ToolMessage):
                    yield AgentEvent(
                        type="tool_result",
                        data={
                            "id": m.tool_call_id,
                            "name": m.name,
                            "ok": m.status != "error",
                            "preview": preview(m.content),
                        },
                    )
    yield AgentEvent(type="done", data={"usage": usage})


def stream_turn(graph, thread_id: str, customer_id: str, text: str) -> AsyncIterator[AgentEvent]:
    config = {"configurable": {"thread_id": thread_id, "customer_id": customer_id}}
    return _drive(graph, {"messages": [("user", text)]}, config)


def stream_resume(graph, thread_id: str, customer_id: str, decision: dict) -> AsyncIterator[AgentEvent]:
    config = {"configurable": {"thread_id": thread_id, "customer_id": customer_id}}
    return _drive(graph, Command(resume=decision), config)
```

有几处值得停下来想一想。

`tool_call` 事件是从 `updates` 里拿的,也就是模型那一步完整生成之后才推。你可能会想,`messages` 模式里也有 `tool_call_chunks`,为什么不用?因为工具参数是一点点生成的,半截的 JSON 推给前端没法显示。等这一步结束再推一次完整的,前端简单得多,延迟也只差几百毫秒。

`customer_id` 放在 `configurable` 里,而不是让模型从对话里猜。这一点 Day 40 会细讲:**客户身份必须来自登录态,不能来自模型**。工具函数通过 config 读它,模型根本没机会改。

`stream_resume` 用的是 `Command(resume=decision)`,这是 Day 25 学过的写法。interrupt 停下的图,用同一个 thread_id 再喂一个 resume 命令,就从停下的那一行接着跑。

## 会话管理:存什么、存在哪

「会话」这个词在 Agent 服务里其实指两样东西,分开想会清楚很多。

一样是对话状态:消息历史、工作流跑到哪个节点、有没有挂起的审批。这部分 LangGraph 的 checkpointer 已经管了,我们只要给它一个 Postgres。每个 thread_id 对应一个会话,每跑完一个节点存一个快照。

另一样是业务元数据:这个会话属于哪个客户、什么时候创建、现在是什么状态(进行中、等审批、已关闭)、标题是什么。这部分 checkpointer 不管,也不该塞进图的状态里,我们自己建一张表。

为什么不全塞进图状态?因为你经常要按客户查会话列表、按状态统计等审批的会话数量,这些查询对着 checkpoint 表做会非常别扭,checkpoint 是序列化后的二进制。业务数据就放业务表,这是后端的老规矩,到了 Agent 这里一样适用。

```sql
-- agent-60-lab/w6/sql/001_sessions.sql
CREATE TABLE IF NOT EXISTS agent_sessions (
    id           TEXT PRIMARY KEY,
    customer_id  TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'active',   -- active | awaiting_approval | closed
    title        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_customer ON agent_sessions (customer_id, updated_at DESC);
```

```python
# agent-60-lab/w6/app/sessions.py
import asyncio
import uuid
from collections import defaultdict

from psycopg_pool import AsyncConnectionPool


class SessionStore:
    def __init__(self, pool: AsyncConnectionPool):
        self.pool = pool
        # 同一个会话同一时间只允许跑一轮。单进程用内存锁就够了,多进程见正文。
        self._locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    async def create(self, customer_id: str) -> str:
        sid = f"s_{uuid.uuid4().hex[:16]}"
        async with self.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO agent_sessions (id, customer_id) VALUES (%s, %s)", (sid, customer_id)
            )
        return sid

    async def get(self, sid: str) -> dict | None:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "SELECT id, customer_id, status, title FROM agent_sessions WHERE id = %s", (sid,)
            )
            row = await cur.fetchone()
        if row is None:
            return None
        return {"id": row[0], "customer_id": row[1], "status": row[2], "title": row[3]}

    async def set_status(self, sid: str, status: str) -> None:
        async with self.pool.connection() as conn:
            await conn.execute(
                "UPDATE agent_sessions SET status = %s, updated_at = now() WHERE id = %s",
                (status, sid),
            )

    def lock(self, sid: str) -> asyncio.Lock:
        return self._locks[sid]
```

那把锁是干什么的?设想用户手快点了两次发送,或者前端在网络抖动时自动重试了一次。两个请求同时拿着同一个 thread_id 驱动同一张图,两轮会交错写 checkpoint,消息历史就乱了:你可能看到两条用户消息挨着,后面跟着一条莫名其妙的回复。我第一次上线类似服务时就遇到过,排查了半天才发现是前端没禁用按钮。后端不能指望前端,所以加锁,第二个请求直接收到一条 `code` 为 `busy` 的错误事件。

内存锁只在一个进程里有效。如果你用 `uvicorn --workers 4` 起了四个进程,请求被分到不同进程,内存锁就管不住了。那时候换成 Postgres 的 advisory lock(`pg_try_advisory_lock(hashtext(sid))`)或者 Redis 的 `SET key NX EX 120`。今天先单进程,Day 37 讲队列时会换掉。

## 主程序

```python
# agent-60-lab/w6/app/main.py
import asyncio
import time
from collections.abc import AsyncIterable
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from fastapi.sse import EventSourceResponse, ServerSentEvent
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg_pool import AsyncConnectionPool
from pydantic import BaseModel, Field

from .agent_adapter import stream_resume, stream_turn
from .config import settings
from .sessions import SessionStore

# 唯一需要按你 W4 代码改的一行:拿到"给我一个 checkpointer,还你一张编译好的图"的函数
from w4.ticket_agent import build_graph  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool = AsyncConnectionPool(settings.database_url, open=False, kwargs={"autocommit": True})
    await pool.open()
    async with AsyncPostgresSaver.from_conn_string(settings.database_url) as saver:
        await saver.setup()  # 第一次运行时建 checkpoint 表,之后是空操作
        app.state.graph = build_graph(checkpointer=saver)
        app.state.sessions = SessionStore(pool)
        yield
    await pool.close()


app = FastAPI(title="SupportPilot API", lifespan=lifespan)


def current_customer(x_demo_customer: Annotated[str | None, Header()] = None) -> str:
    # 演示用:身份从请求头来。真实系统这里是解析 JWT / session cookie。
    if not x_demo_customer:
        raise HTTPException(401, "missing X-Demo-Customer")
    return x_demo_customer


async def owned_session(sid: str, cid: Annotated[str, Depends(current_customer)]) -> dict:
    s = await app.state.sessions.get(sid)
    if s is None or s["customer_id"] != cid:
        # 不是你的会话也返回 404,不告诉对方"这个会话存在但不属于你"
        raise HTTPException(404, "session not found")
    return s


class NewMessage(BaseModel):
    text: str = Field(min_length=1, max_length=settings.max_message_chars)


class Decision(BaseModel):
    approved: bool
    note: str = ""


@app.post("/api/sessions")
async def create_session(cid: Annotated[str, Depends(current_customer)]):
    return {"session_id": await app.state.sessions.create(cid)}


def busy(code: str, message: str) -> ServerSentEvent:
    return ServerSentEvent(data={"code": code, "message": message}, event="error")


async def _pump(sid: str, events, lock: asyncio.Lock) -> AsyncIterable[ServerSentEvent]:
    """把适配层的事件包成 SSE,统一处理超时、异常、锁和状态。调用前锁已经拿到。"""
    started = time.monotonic()
    seq = 0
    status = "active"
    try:
        async with asyncio.timeout(settings.turn_timeout_s):
            async for ev in events:
                seq += 1
                if ev.type == "approval_required":
                    status = "awaiting_approval"
                if ev.type == "done":
                    ev.data["elapsed_ms"] = int((time.monotonic() - started) * 1000)
                yield ServerSentEvent(data=ev.data, event=ev.type, id=str(seq))
    except TimeoutError:
        yield busy("timeout", "这一轮处理太久了,已经停下。可以重试或转人工。")
    except asyncio.CancelledError:
        # 客户端断开时,Starlette 会取消这个生成器。已经跑完的节点都在 checkpoint 里。
        raise
    except Exception as exc:  # noqa: BLE001
        yield busy("internal", type(exc).__name__)
    finally:
        await app.state.sessions.set_status(sid, status)
        lock.release()


@app.post("/api/sessions/{sid}/messages", response_class=EventSourceResponse)
async def send_message(
    sid: str, body: NewMessage, s: Annotated[dict, Depends(owned_session)]
) -> AsyncIterable[ServerSentEvent]:
    if s["status"] == "awaiting_approval":
        yield busy("awaiting_approval", "有一个操作在等审批,先处理审批")
        return
    lock = app.state.sessions.lock(sid)
    if lock.locked():
        yield busy("busy", "上一轮还没结束")
        return
    await lock.acquire()
    async for item in _pump(sid, stream_turn(app.state.graph, sid, s["customer_id"], body.text), lock):
        yield item


@app.post("/api/sessions/{sid}/approval", response_class=EventSourceResponse)
async def answer_approval(
    sid: str, body: Decision, s: Annotated[dict, Depends(owned_session)]
) -> AsyncIterable[ServerSentEvent]:
    if s["status"] != "awaiting_approval":
        yield busy("no_pending_approval", "没有待审批的操作")
        return
    lock = app.state.sessions.lock(sid)
    if lock.locked():
        yield busy("busy", "上一轮还没结束")
        return
    await lock.acquire()
    decision = {"approved": body.approved, "note": body.note}
    async for item in _pump(sid, stream_resume(app.state.graph, sid, s["customer_id"], decision), lock):
        yield item


@app.get("/api/sessions/{sid}/history")
async def history(sid: str, s: Annotated[dict, Depends(owned_session)]):
    snap = await app.state.graph.aget_state({"configurable": {"thread_id": sid}})
    msgs = snap.values.get("messages", []) if snap.values else []
    return [
        {"role": m.type, "content": m.content}
        for m in msgs
        if m.type in ("human", "ai") and m.content
    ]


@app.get("/")
async def index():
    return FileResponse("w6/static/index.html")
```

我把几个容易写错的地方单独拎出来说。

**鉴权和归属检查放在依赖(`Depends`)里,而不是生成器函数体里。** 带 `yield` 的接口函数是一个生成器,函数体要等响应开始发送时才执行。到那时响应头 200 已经发出去了,再 `raise HTTPException(404)` 就来不及变成一个真正的 404。依赖在响应开始之前执行,所以 401、404 这类「请求本身不合法」的错误放在依赖里,前端拿到的是正确的 HTTP 状态码。而「会话正忙」「有审批在等」这种状态冲突发生在流里,用一条 `error` 事件告诉前端,前端按 `code` 字段显示对应提示。

**锁要在生成器的 finally 里释放**。很多人写成 `async with lock:` 包住整个接口函数,看起来没问题。但流式接口的函数体在返回响应头之后还在跑,`async with` 的作用域和生成器的生命周期纠缠在一起,一旦客户端断开,释放时机很难推理。手动 acquire,在 `_pump` 的 finally 里 release,路径是确定的。

`asyncio.timeout` 是 Python 3.11 加的。超时以后我们不是直接断开连接,而是推一个 `error` 事件再正常结束,前端能显示一句人话,而不是一个莫名其妙的网络错误。

`CancelledError` 原样抛出。用户关掉页面时,服务端在下一次写响应时会发现连接断了,Starlette 取消生成器。这时候 LangGraph 正在跑的那个节点会被中断,但之前跑完的节点已经写进 checkpoint。用户回来刷新页面,`/history` 能看到已经完成的部分。被中断的那一步下次发消息时会怎样?取决于它停在哪:如果停在模型调用中间,这次调用的钱白花了,但状态是干净的;如果停在工具调用中间,而且是写操作,就有可能出现「订单系统里退款申请已经建了,checkpoint 里却没记录」的情况。这正是明天要讲的幂等。

**FastAPI 原生 SSE 已经帮你做了三件事**:没有消息时每 15 秒发一次 keep-alive 注释,防止代理把空闲连接掐掉;设置 `Cache-Control: no-cache`;设置 `X-Accel-Buffering: no`,让 Nginx 不缓冲。第三条特别重要,我见过不少人本地流式好好的,部署到 Nginx 后面就变成十几秒后一次性全出来,就是 Nginx 默认缓冲了响应。以前用 `sse-starlette` 这些头要自己加,现在官方实现自带。

## 前端:60 行看到效果

这一页只是为了验证接口,不追求好看。Day 49 毕业项目会用 Streamlit 做正式界面。

```html
<!-- agent-60-lab/w6/static/index.html -->
<!doctype html>
<meta charset="utf-8">
<title>SupportPilot 测试台</title>
<style>
  body { font: 15px/1.6 system-ui; max-width: 720px; margin: 2rem auto; padding: 0 1rem; }
  .card { border: 1px solid #ccc; border-radius: 6px; padding: .4rem .6rem; margin: .3rem 0; font-size: 13px; }
  .reply { white-space: pre-wrap; background: #f6f6f6; padding: .6rem; border-radius: 6px; }
  #approval { display: none; border: 2px solid #c80; padding: .6rem; border-radius: 6px; }
</style>
<p>客户 ID <input id="cid" value="cus_1001"> <button onclick="newSession()">新会话</button> <span id="sid"></span></p>
<div id="log"></div>
<div id="approval"><span id="adetail"></span>
  <button onclick="decide(true)">批准</button> <button onclick="decide(false)">拒绝</button></div>
<p><input id="msg" size="60" placeholder="比如:我上个月被多扣了一次钱"> <button id="send" onclick="send()">发送</button></p>
<script>
let sid = null, reply = null;
const headers = () => ({"Content-Type": "application/json", "X-Demo-Customer": cid.value});
async function newSession() {
  const r = await fetch("/api/sessions", {method: "POST", headers: headers()});
  sid = (await r.json()).session_id; document.getElementById("sid").textContent = sid; log.innerHTML = "";
}
function add(cls, text) { const d = document.createElement("div"); d.className = cls; d.textContent = text; log.append(d); return d; }
async function stream(url, body) {
  document.getElementById("send").disabled = true;
  const r = await fetch(url, {method: "POST", headers: headers(), body: JSON.stringify(body)});
  if (!r.ok) { add("card", "HTTP " + r.status + " " + await r.text()); document.getElementById("send").disabled = false; return; }
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  while (true) {
    const {value, done} = await reader.read(); if (done) break;
    buf += value;
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {        // 一个空行 = 一条事件结束
      const raw = buf.slice(0, i); buf = buf.slice(i + 2);
      let ev = "message", data = "";
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) ev = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (data) handle(ev, JSON.parse(data));
    }
  }
  document.getElementById("send").disabled = false;
}
function handle(ev, d) {
  if (ev === "token") { reply ??= add("reply", ""); reply.textContent += d.text; }
  else if (ev === "tool_call") add("card", "🔧 " + d.name + " " + JSON.stringify(d.args));
  else if (ev === "tool_result") add("card", (d.ok ? "✅ " : "❌ ") + d.name + ":" + d.preview);
  else if (ev === "approval_required") { approval.style.display = "block"; adetail.textContent = JSON.stringify(d) + " "; }
  else if (ev === "done") { add("card", `完成 ${d.elapsed_ms} ms,输入 ${d.usage.input_tokens} / 输出 ${d.usage.output_tokens} tokens`); reply = null; }
  else if (ev === "error") add("card", "⚠️ " + d.message);
}
function send() { add("card", "🙋 " + msg.value); stream(`/api/sessions/${sid}/messages`, {text: msg.value}); msg.value = ""; }
function decide(ok) { approval.style.display = "none"; stream(`/api/sessions/${sid}/approval`, {approved: ok, note: ""}); }
</script>
```

注意那个 `buf`。网络上收到的数据块和 SSE 事件的边界没有任何关系,一个数据块可能包含两条半事件,也可能半条事件被拆成两块。所以必须先攒进缓冲区,按空行切。我见过有人直接 `value.split("data:")`,本地测试一切正常,上线遇到慢网络就开始报 JSON 解析错误。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="一轮退款工单的事件时间线:token 之前是两次工具调用,随后是审批请求,连接结束;审批后第二个连接继续推 token 和 done">
<line x1="40" y1="70" x2="620" y2="70" stroke="var(--rule)" stroke-width="1.5"/>
<text x="40" y="40" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">请求 1 · POST /messages</text>
<rect x="60" y="58" width="80" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="100" y="74" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">tool_call</text>
<rect x="150" y="58" width="80" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="190" y="74" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">tool_result</text>
<rect x="240" y="58" width="80" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="280" y="74" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">tool_call</text>
<rect x="330" y="58" width="80" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="370" y="74" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">tool_result</text>
<rect x="420" y="58" width="130" height="24" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
<text x="485" y="74" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">approval_required</text>
<text x="565" y="74" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">连接结束</text>
<text x="40" y="118" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">…… 主管可能几分钟后才点批准,会话状态 = awaiting_approval ……</text>
<line x1="40" y1="180" x2="620" y2="180" stroke="var(--rule)" stroke-width="1.5"/>
<text x="40" y="150" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">请求 2 · POST /approval</text>
<rect x="60" y="168" width="80" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="100" y="184" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">tool_result</text>
<rect x="150" y="168" width="40" height="24" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="195" y="168" width="40" height="24" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="240" y="168" width="40" height="24" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="285" y="168" width="40" height="24" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="238" y="210" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">token × N</text>
<rect x="340" y="168" width="60" height="24" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
<text x="370" y="184" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">done</text>
</svg>
<figcaption>一张退款工单的事件时间线。第一个连接在 approval_required 后就结束了,图的状态停在 interrupt 处;审批是另一个请求,用 Command(resume=…) 接着跑,退款工具执行完再起草回复。</figcaption>
</figure>

## 跑起来

Postgres 用 W3 起的那个 pgvector 容器就行,同一个库,checkpoint 表和你的知识库表互不干扰。

```bash
# 在 agent-60-lab 目录下
psql "$DATABASE_URL" -f w6/sql/001_sessions.sql
uv run uvicorn w6.app.main:app --reload --port 8000
```

浏览器打开本机 8000 端口(`localhost:8000`),点「新会话」,输入「我 9 月份被扣了两次 99 块,帮我退一笔」。如果 W4 的 Agent 写得没问题,你会看到先出现查客户、查发票的工具卡片,接着弹出审批面板。点批准,退款工具执行,然后回复一个字一个字地出来。

也可以不用浏览器,用 curl 看原始事件流,`-N` 关掉 curl 自己的缓冲:

```bash
SID=$(curl -s -X POST localhost:8000/api/sessions -H 'X-Demo-Customer: cus_1001' | python3 -c 'import json,sys;print(json.load(sys.stdin)["session_id"])')
curl -N -X POST "localhost:8000/api/sessions/$SID/messages" \
  -H 'Content-Type: application/json' -H 'X-Demo-Customer: cus_1001' \
  -d '{"text":"我的发票 INV-2031 金额不对"}'
```

输出大致长这样(具体内容取决于你的数据和模型):

```text
event: tool_call
data: {"id":"call_0","name":"get_invoice","args":{"invoice_id":"INV-2031"}}
id: 1

event: tool_result
data: {"id":"call_0","name":"get_invoice","ok":true,"preview":"{\"id\": \"INV-2031\", \"amount\": 198.0, ..."}
id: 2

event: token
data: {"text":"您好"}
id: 3
...
event: done
data: {"usage":{"input_tokens":2311,"output_tokens":187},"elapsed_ms":6420}
id: 41
```

## 并发:一个进程扛得住多少人

这是面试会追问的地方。FastAPI 跑在 asyncio 上,Agent 服务的耗时几乎全花在等网络:等模型 API、等数据库、等 MCP 工具。等待期间事件循环去处理别的请求,所以一个进程同时挂着几百个流式连接是正常的。

会把事件循环卡住的是两类东西。一类是同步的阻塞调用,比如在 async 函数里用了 `requests.get`,或者同步的数据库驱动。这种代码一跑,整个进程所有连接一起停。排查办法是开 asyncio 的 debug 模式(`PYTHONASYNCIODEBUG=1`),它会打印执行超过 100 毫秒的回调。另一类是 CPU 密集的活,比如本地跑 embedding 模型、解析大 PDF。这些要么扔进 `asyncio.to_thread`,要么干脆拆成独立服务或者放进明天要讲的任务队列。

真正的瓶颈通常不在你的服务,而在上游。模型 API 有并发和速率限制(RPM、TPM),到了上限就是 429。所以生产环境里你要在服务里加一个全局的并发闸门,比如 `asyncio.Semaphore(20)` 包住模型调用,宁可让请求在你这排队,也别让上游大面积 429 再触发一轮重试风暴。

## 动手练习

1. 按上面的代码把服务跑起来。把 `DRAFT_NODES` 改成你 W4 图里实际起草节点的名字;如果你的图里没有 `build_graph(checkpointer=...)` 这样的工厂函数,花十分钟把它重构出来,这对之后部署很有用。
2. 用浏览器跑通一张需要退款审批的工单,截图保存:工具卡片、审批面板、流式回复、done 里的耗时和 token 数。
3. 并发测试。开两个终端,对同一个会话几乎同时发两条消息,确认第二条收到 `busy` 错误事件,而且会话历史里只有第一条消息。
4. 断线测试。发一条消息,在回复出到一半时按 Ctrl+C 掐掉 curl。然后调 `/history`,看看哪些内容已经保存。再发一条新消息,确认会话还能正常继续。
5. 超时测试。把 `TURN_TIMEOUT_S` 设成 3,发一条需要查好几次工具的消息,确认前端收到的是一条可读的 `error` 事件,而不是连接被重置。
6. 越权测试。用 `cus_1001` 建一个会话,再用 `X-Demo-Customer: cus_2002` 去请求这个会话的 `/history`,必须拿到 404。

**验收标准**:六步全部通过;第 4 步能说清楚中断时 checkpoint 里有什么、没有什么;重启 uvicorn 后,用旧会话 id 调 `/history`,历史还在。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| SSE(Server-Sent Events) | 基于普通 HTTP 的单向推送协议,响应类型 `text/event-stream`,事件之间用空行分隔 |
| WebSocket | 全双工长连接协议,需要协议升级,适合双向高频通信 |
| keep-alive 注释 | SSE 里以冒号开头的行,浏览器忽略它,作用是让连接不被代理当成空闲掐断 |
| `Last-Event-ID` | 浏览器断线重连时带上的请求头,值是最后收到的事件 id |
| checkpointer | LangGraph 保存每一步状态快照的组件,按 thread_id 区分会话 |
| thread_id | LangGraph 里一个会话的标识,今天直接用会话 id |
| interrupt / resume | 图在某个节点主动暂停等外部输入,之后用 `Command(resume=...)` 继续 |
| 事件循环阻塞 | 在 async 代码里执行了同步阻塞操作,导致整个进程的所有请求一起停住 |
| advisory lock | Postgres 提供的应用级锁,跨进程有效,常用来做分布式互斥 |

## 常见误区

**把框架内部结构直接推给前端。** LangGraph 的 chunk 里有大量前端用不上的字段,而且版本升级时可能变化。自己定一层事件协议,前后端都轻松,换框架时只改适配层。

**流式接口本地正常,部署后变成一次性输出。** 九成是中间某层做了缓冲:Nginx 的 `proxy_buffering`、某些 CDN、或者开了 gzip 压缩中间件。FastAPI 原生 SSE 已经发了 `X-Accel-Buffering: no`,但 CDN 和压缩还要你自己检查。

**用 `EventSource` 接 POST 接口。** 原生 `EventSource` 只能 GET,也加不了鉴权头。要么用 fetch 读流,要么用社区的 fetch-event-source 这类库。

**以为一个会话的状态全在 checkpoint 里。** checkpoint 存的是对话和工作流状态,业务元数据(属于谁、什么状态、标题)要自己建表。把这些塞进图状态,查询和统计会非常痛苦。

**不加会话锁。** 同一个 thread 被两个请求同时驱动,消息历史会交错。前端禁用按钮挡不住网络重试,后端必须自己拦。

**在 async 接口里用同步库。** `requests`、同步的 `psycopg2`、`time.sleep`,任何一个都会把整个进程卡住。Agent 服务本来就是高并发长连接,这种错误的代价比普通接口大得多。

## 学习资料

### 文档与文章

- [FastAPI · Server-Sent Events 教程](https://fastapi.tiangolo.com/tutorial/server-sent-events/):今天的主文档。重点看 `ServerSentEvent` 的四个字段、`Last-Event-ID` 续推、POST 用法和最后的 Technical Details 一节。20 分钟。
- [MDN · Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events):协议格式的权威说明,有中文版。看「Event stream format」一节,搞清楚空行、多行 data、注释行。15 分钟。
- [LangGraph · Streaming](https://docs.langchain.com/oss/python/langgraph/streaming):各种 `stream_mode` 的区别和多模式同时订阅的写法。适配层看不懂时回来查。30 分钟。
- [langgraph-checkpoint-postgres(PyPI)](https://pypi.org/project/langgraph-checkpoint-postgres/):第一次必须调 `setup()`、自己传连接时要 `autocommit=True` 和 `dict_row`,这两个坑都写在 README 里。10 分钟。
- [Python 文档 · asyncio.timeout](https://docs.python.org/3/library/asyncio-task.html#timeouts):超时的正确写法,以及它和 `wait_for` 的区别。10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV15F7J6dEdm&autoplay=0&high_quality=1" title="别再只会 HTTP 了，SSE 才是 AI 流式输出的答案" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>懂点AI的H先生 · 别再只会 HTTP 了,SSE 才是 AI 流式输出的答案 · 20 分钟,讲清楚 SSE 和轮询、WebSocket 的区别,以及大模型接口为什么都用它。适合先建立直觉。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1if7E64Ex5&autoplay=0&high_quality=1" title="SSE 到底是什么？用 FastAPI 一次讲透流式响应" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>懂点AI的H先生 · SSE 到底是什么?用 FastAPI 一次讲透流式响应 · 5 分钟的短片,直接演示 FastAPI 写流式接口,和上一个是同一作者的配套。</figcaption>
</figure>

如果 FastAPI 本身还不熟,黑马程序员的《FastAPI 从入门到实战》([BV1zV2QBtE39](https://www.bilibili.com/video/BV1zV2QBtE39/))是 B 站播放量最高的系统课,挑路由、依赖注入、异步那几集看,不用全看。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/4HlNv1qpZFY" title="Server-Sent Events Crash Course" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hussein Nasser · Server-Sent Events Crash Course · 30 分钟。后端圈讲协议最细的人之一,会讲到 HTTP/1.1 下浏览器对同域连接数的限制,这是 SSE 一个不太为人知的坑。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/xTTtqwGWemw" title="Streaming LLM Responses with FastAPI" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Irtiza Hafiz · Streaming LLM Responses with FastAPI · 10 分钟,FastAPI 加 LLM 流式的完整演示。视频里用的是旧的 StreamingResponse 写法,对照今天的原生 SSE 看,能体会新写法省了什么。</figcaption>
</figure>

System Design School 的《Server-Sent Events vs WebSockets》([YouTube](https://www.youtube.com/watch?v=X_DdIXrmWOo))只有 6 分钟,面试前看一遍,能把取舍讲得很利索。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025)第 10 章「AI Engineering Architecture and User Feedback」:从最简单的架构开始,一步步加上下文增强、护栏、路由、缓存、Agent 模式和监控。这一章基本就是本周六天的提纲,今天先读开头的架构演进部分。英文原版,1 小时。
- Martin Kleppmann《Designing Data-Intensive Applications》(O'Reilly,第一版 2017)第 8 章「The Trouble with Distributed Systems」:超时、网络不可靠、请求到底有没有执行成功。为明天的幂等打底。中文版《数据密集型应用系统设计》(中国电力出版社)。

### 开源项目与代码

- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph) 仓库里 `libs/checkpoint-postgres` 目录:想知道 checkpoint 表结构长什么样,直接看迁移 SQL。
- [Azure/fetch-event-source](https://github.com/Azure/fetch-event-source):用 fetch 实现的 EventSource 替代品,支持 POST、自定义头、断线重试。正式前端可以用它代替手写解析。

## 自测

1. 为什么前端不能直接用浏览器的 `EventSource` 调我们的 `/messages` 接口?

<details><summary>答案</summary>

`EventSource` 只能发 GET 请求,不能带请求体,也不能自定义请求头。我们发消息需要 POST 一段 JSON,还要带鉴权头(今天是 `X-Demo-Customer`,真实系统是 Authorization)。所以用 fetch 读响应流,自己按空行解析事件。

</details>

2. 适配层里为什么要按 `langgraph_node` 过滤 token?不过滤会发生什么?

<details><summary>答案</summary>

工单 Agent 里不止起草节点会调模型,分类节点、自检节点也会调,它们输出的是 JSON 或内部判断。不过滤的话,用户会在回复气泡里先看到一串 `{"category": "billing", ...}`,然后才是正常回复。

</details>

3. 用户在回复生成到一半时关掉页面。服务端发生了什么?会话状态是否损坏?

<details><summary>答案</summary>

服务端下一次往连接里写数据时发现断开,Starlette 取消生成器,LangGraph 正在执行的节点被中断。之前已完成的节点都写进了 checkpoint,所以状态不会损坏,只是最后那一步没完成。如果最后那一步是模型调用,钱白花了但无副作用;如果是写操作工具,可能出现外部系统已执行、checkpoint 未记录的不一致,这就是需要幂等的原因。finally 里的锁释放和状态更新照常执行。

</details>

4. 你把服务改成 `uvicorn --workers 4` 后,会话锁还有效吗?怎么改?

<details><summary>答案</summary>

无效。`asyncio.Lock` 只在单个进程内有效,四个 worker 各有各的内存。改成跨进程的锁:Postgres `pg_try_advisory_lock(hashtext(session_id))`,或 Redis `SET lock:{sid} 1 NX EX 120`,拿不到就推 `busy` 事件。用 Redis 时过期时间要大于单轮超时,释放时要校验是不是自己加的锁。

</details>

5. (面试题)「你们的 Agent 接口为什么用 SSE 不用 WebSocket?」请用三四句话回答。

<details><summary>答案</summary>

参考答法:Agent 场景的实时需求基本是单向的,服务端往客户端推 token 和工具事件,用户输入用普通 POST 就够。SSE 就是普通 HTTP,现有的网关、鉴权、负载均衡、日志、限流都能直接复用,运维成本低;WebSocket 需要协议升级和单独的连接管理。主流模型 API 本身也用 SSE,整条链路协议一致。如果以后做实时语音这种双向流,再考虑 WebSocket 或 WebRTC。

</details>

6. (面试题)流式接口部署到 Nginx 之后变成了十几秒后一次性返回,你怎么排查?

<details><summary>答案</summary>

先用 `curl -N` 直连应用端口,确认应用本身是流式的;再经过 Nginx 用 `curl -N` 测,如果这一步变成一次性,就是代理缓冲。检查 Nginx 的 `proxy_buffering`(响应头 `X-Accel-Buffering: no` 可以逐请求关掉),检查有没有 gzip 压缩中间件或 CDN 在攒数据,长连接还要调大 `proxy_read_timeout`。最后在浏览器 Network 面板看 EventStream 是不是逐条到达。

</details>

## 明天预告

Day 37 · 长任务与可靠性。今天留下了一个口子:工具调用中途被打断,外部系统已经执行了,checkpoint 却没记下来,用户重试时退款会不会被建两次?明天讲任务队列、重试、幂等键、超时与取消,把「夜间批量处理积压工单」这种跑十几分钟的活从 HTTP 请求里挪出去,并且保证任何一步挂掉都能安全地重来。
