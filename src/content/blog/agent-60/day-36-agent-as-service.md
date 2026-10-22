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

<div class="line-notes">

- `from pydantic_settings import BaseSettings` `BaseSettings` 是 pydantic 的一个子类:字段的值不是你手动传进来的,而是自动从环境变量和 `.env` 文件里找。它在单独的包 `pydantic-settings` 里,所以前面 `uv add` 装了它。
- `class Settings(BaseSettings):` 每个字段对应一个环境变量,**名字不区分大小写**:字段 `llm_api_key` 会去找 `LLM_API_KEY`。所以练习仓 `.env` 里 Day 3 起就有的 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL` 不用改名,直接能用。
- `model_config = SettingsConfigDict(env_file=".env", extra="ignore")` `env_file=".env"` 是相对**当前工作目录**的路径,所以要在 `agent-60-lab/` 根目录启动 uvicorn,它才找得到 `.env`。`extra="ignore"`:`.env` 里还有 `PG_DSN`、`EMB_MODEL` 这些本类没声明的变量,不加这个会直接报错。实测去掉 `extra="ignore"`,练习仓的 `.env` 一口气报了 11 个 `Extra inputs are not permitted`。
- `database_url: str = "postgresql://postgres:postgres@localhost:5432/agent"` 默认值是给 Docker 版 Postgres 准备的。实测练习仓 `.env` 里没有 `DATABASE_URL`,所以这里拿到的就是这个默认值;用 Postgres.app 的话要在 `.env` 里加一行 `DATABASE_URL=postgresql://你的用户名@localhost:5432/库名`。实测设了环境变量以后 `Settings().database_url` 变成 `postgresql://minliu@localhost:5432/notes_d36`。
- `llm_api_key: str = ""` 默认空串,真正的值从 `.env` 的 `LLM_API_KEY` 来。实测打印 `settings` 时这一项是 `***c778`(我把它遮掉了),说明 `.env` 确实被读到了。
- `turn_timeout_s: float = 120.0` 一轮对话最长跑 120 秒,下面 `main.py` 的 `asyncio.timeout(settings.turn_timeout_s)` 用的就是它。实测一张退款工单第一轮 7.7 秒就到审批,离上限很远。
- `max_message_chars: int = 4000` 用户单条消息上限,给 `NewMessage` 的 `max_length` 用,防止有人贴一整本说明书进来烧 token。
- `settings = Settings()` 模块被 import 时就实例化一次,读一次环境变量。其他文件 `from .config import settings` 拿到的都是这同一个对象。实测完整内容是 `{'database_url': 'postgresql://postgres:postgres@localhost:5432/agent', 'llm_base_url': 'https://api.deepseek.com', 'llm_api_key': '***c778', 'llm_model': 'deepseek-flash', 'turn_timeout_s': 120.0, 'max_message_chars': 4000}`。

</div>

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

<div class="line-notes">

- `EventType = Literal["token", "tool_call", "tool_result", "approval_required", "done", "error"]` 事件类型只能是这六个字符串之一。写错一个字母,pydantic 当场报错,不会悄悄推一个前端不认识的事件出去。实测 `AgentEvent(type="tok", data={})` 抛 `ValidationError`,报错里列出了六个合法值。
- `class AgentEvent(BaseModel):` 所有事件都长一个样:`type` 说是什么事件,`data` 放具体内容。实测 `AgentEvent(type="token", data={"text": "您好"}).model_dump()` 得到 `{'type': 'token', 'data': {'text': '您好'}}`,`main.py` 会把 `type` 当 SSE 的 `event:` 行、`data` 当 `data:` 行发出去。
- `data: dict[str, Any]` `data` 的结构随事件类型变化(见上面的事件表),所以这里不细定义,用 `dict[str, Any]` 兜住。
- `def preview(value: Any, limit: int = 160) -> str:` 工具结果只给前端看前 160 个字符。
- `text = value if isinstance(value, str) else repr(value)` 不是字符串就先 `repr` 成字符串。实测 `preview({"a": 1})` 返回 `"{'a': 1}"`。W4 里的工具结果本来就是字符串(MCP 返回的 JSON 文本),所以一般走前半句。
- `return text if len(text) <= limit else text[:limit] + "…"` 没超过就原样返回,超了就截前 160 个字再加省略号。实测 `preview("x" * 200)` 返回 161 个字符(160 个 x 加一个「…」);`preview('{"id": "INV-2026-0123", "amount_cents": 239200}')` 只有 47 个字符,原样返回。真实跑工单时,`list_invoices` 的结果有好几百字,前端卡片上只显示到 `"paid_at": "2026-1` 就截断了。

</div>

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
    # W4 的图从 ticket 读工单正文、从 customer_id 做越权检查;messages 也带上,多轮时历史接得上
    graph_input = {"ticket": text, "customer_id": customer_id, "messages": [("user", text)]}
    return _drive(graph, graph_input, config)


def stream_resume(graph, thread_id: str, customer_id: str, decision: dict) -> AsyncIterator[AgentEvent]:
    config = {"configurable": {"thread_id": thread_id, "customer_id": customer_id}}
    return _drive(graph, Command(resume=decision), config)
```

<div class="line-notes">

- `from langchain_core.messages import AIMessageChunk, ToolMessage` 两种要认的消息:`AIMessageChunk` 是模型流式吐出来的一小段,`ToolMessage` 是工具执行完的结果。
- `from langgraph.types import Command` 审批恢复时用 `Command(resume=...)` 把主管的决定喂回图里,见最后的 `stream_resume`。
- `DRAFT_NODES = {"draft_reply", "agent"}` 只有这些节点的 token 推给用户。Day 28 的图里会说话的节点是 `classify` 和 `agent`,`classify` 吐的是分类 JSON,不在名单里就被滤掉了。实测一张退款工单第一轮推了 70 个 token,全部来自 `agent` 节点;`draft_reply` 是给你自己的图留的名字,Day 28 的图里没有这个节点,写着也无妨。
- `async def _drive(graph, graph_input: Any, config: dict) -> AsyncIterator[AgentEvent]:` 带 `yield` 的 `async def` 是**异步生成器**:调用它不会马上执行,而是返回一个可以 `async for` 的对象,每 `yield` 一次,外面就拿到一个事件。新会话和审批恢复的区别只在 `graph_input`,所以共用这一个函数。
- `usage = {"input_tokens": 0, "output_tokens": 0}` 一轮里所有模型调用的 token 累加到这里,最后放进 `done` 事件。
- `async for mode, chunk in graph.astream(` 同时订阅两种流时,每次拿到的是 `(模式名, 内容)` 二元组,这里直接解包成 `mode` 和 `chunk`。
- `graph_input, config=config, stream_mode=["messages", "updates"]` `messages` 模式按 token 推模型输出,`updates` 模式在每个节点跑完后推这个节点改了哪些状态。
- `if mode == "messages":` 这一分支处理逐 token 的输出。
- `msg, meta = chunk` `messages` 模式的 chunk 是 `(消息块, 元数据)`。实测 `meta["langgraph_node"]` 的取值有 `classify` 和 `agent` 两种。
- `if not isinstance(msg, AIMessageChunk):` 只要模型生成的块,别的消息类型跳过。
- `if msg.usage_metadata:` 不是每个块都带用量,带的时候才累加。
- `usage["input_tokens"] += msg.usage_metadata.get("input_tokens", 0)` 实测第一轮(分类 1 次加 agent 3 次,一共 4 次模型调用)累加出 `input_tokens: 6030, output_tokens: 468`。分类节点的 token 虽然不推给用户,用量照样算进来,因为钱照样花了。
- `if meta.get("langgraph_node") in DRAFT_NODES and msg.content:` 节点在名单里、而且这块有文字才推。模型决定调工具的那一步 `content` 常常是空的,这时就不推。
- `yield AgentEvent(type="token", data={"text": msg.content})` 实测前几个 token 是 `我先`、`核实`、`一下`,第一个 token 在请求发出 2.84 秒后到,前面这段时间花在分类、检索和 agent 第一步上。
- `continue` 处理完 `messages` 模式就跳回循环开头,下面的代码只处理 `updates`。
- `for node, update in chunk.items():` `updates` 模式的 chunk 是 `{节点名: 这个节点返回的状态更新}`,一般只有一个键。实测依次出现 `classify`、`retrieve`、`agent`、`tools`、`agent`……
- `if node == "__interrupt__":` 图跑到 `interrupt()` 停下时,`updates` 里会出现这个特殊的键。
- `intr = update[0]` `update` 是一个装 Interrupt 对象的元组,一次只停一个,取第 0 个。
- `yield AgentEvent(type="approval_required", data=dict(intr.value))` `intr.value` 就是 Day 28 `approval` 节点里传给 `interrupt()` 的字典。实测是 `{"type": "refund_approval", "customer_id": "C007", "ticket": "你好,10 月 8 号我被扣了两次款……", "requests": [{"invoice_id": "INV-2026-0123", "amount_yuan": 2392.0, "reason": "重复扣款:……"}]}`。
- `if not isinstance(update, dict):` 有的节点什么也不返回(`None`),跳过。
- `for m in update.get("messages", []):` 只关心节点新加的消息。比如 `classify` 返回的是 `{"category": ..., "summary": ...}`,没有 `messages`,这里就是空列表。
- `if getattr(m, "tool_calls", None):` `agent` 节点决定调工具时,新消息上带 `tool_calls`。`getattr(..., None)` 是因为 ToolMessage 没有这个属性,直接写 `m.tool_calls` 会报错。
- `for tc in m.tool_calls:` 模型一次可能调好几个工具。实测一次第一步调了 `find_customer` 和 `list_invoices` 两个,另一次(下面 curl 那次)同时调了 `find_customer`、`get_subscription`、`list_invoices` 三个,模型每次的选择不完全一样。
- `data={"id": tc["id"], "name": tc["name"], "args": tc["args"]},` curl 那次实测第一条是 `{"id": "call_00_Hf6Zb…", "name": "find_customer", "args": {"query": "C007"}}`。`args` 已经是解析好的字典,不是 JSON 字符串。
- `if isinstance(m, ToolMessage):` `tools` 和 `approval` 节点返回的是工具结果。
- `"id": m.tool_call_id,` 用这个 id 和前面的 `tool_call` 事件对上,前端就知道该把哪张卡片标成完成。
- `"name": m.name,` 工具名,前端卡片上显示它。实测是 `find_customer`、`list_invoices`、`get_subscription`、`search_kb` 这些。它来自 Day 28 构造 `ToolMessage` 时传的 `name=c["name"]`,构造时不传的话,这里就是 `null`。
- `"ok": m.status != "error",` Day 28 遇到 `[工具报错]`、`[拒绝]`、`[主管驳回]` 开头的结果时,会把 `ToolMessage` 的 `status` 设成 `"error"`,这里就变成 `false`。实测正常查询全是 `true`;主管驳回退款时,那条结果是 `{"name": "create_refund_request", "ok": false, "preview": "[主管驳回] 金额待财务复核。请告诉客户退款申请未通过,会有人工客服跟进。"}`,前端就会显示红叉。
- `"preview": preview(m.content),` 只推摘要,规则见 `events.py`。实测 `find_customer` 的预览是 `{"result": [{"id": "C007", "name": "刘静", "email": "user007@example.com", "company": "半岛咖啡"}]}`。
- `yield AgentEvent(type="done", data={"usage": usage})` 流跑完(包括停在审批处)推一个 `done`。实测第一轮的事件统计是 `token` 70 个、`tool_call` 5 个、`tool_result` 4 个、`approval_required` 1 个、`done` 1 个:5 个调用里最后一个是 `create_refund_request`,它进了审批,所以这一轮还没有结果。
- `def stream_turn(graph, thread_id: str, customer_id: str, text: str)` 用户发一条新消息时用。注意它不是 `async def`,它只是把参数准备好,返回 `_drive(...)` 生成的异步生成器。
- `config = {"configurable": {"thread_id": thread_id, "customer_id": customer_id}}` `thread_id` 决定 checkpoint 存到哪一条对话下,我们直接用会话 id,比如 `s_eabcdbbd8ea34539`。
- `graph_input = {"ticket": text, "customer_id": customer_id, "messages": [("user", text)]}` 三样都要传,原因见下面正文。`("user", text)` 是 LangChain 的简写,`add_messages` 会把它转成一条 `HumanMessage`。实测跑完一轮后状态里的消息类型序列是 `human, ai, tool, tool, ai, tool, tool, ai, tool, ai`,只有开头一条 human。
- `def stream_resume(graph, thread_id: str, customer_id: str, decision: dict)` 主管点了批准或拒绝以后调用。
- `return _drive(graph, Command(resume=decision), config)` 用同一个 `thread_id` 把决定喂回去,图从 `approval` 节点停下的地方接着跑。实测 `decision={"approved": True, "note": ""}`,恢复后推了 1 个 `tool_result`(`{"refund_request_id": 1, "status": "pending_approval", "amount_yuan": "2392.00"}`)、325 个 token 和 1 个 `done`,首个 token 在 1.86 秒时到。

</div>

有几处值得停下来想一想。

`tool_call` 事件是从 `updates` 里拿的,也就是模型那一步完整生成之后才推。你可能会想,`messages` 模式里也有 `tool_call_chunks`,为什么不用?因为工具参数是一点点生成的,半截的 JSON 推给前端没法显示。等这一步结束再推一次完整的,前端简单得多,延迟也只差几百毫秒。

`stream_turn` 的输入要和 W4 那张图对上。Day 28 的图从 `ticket` 读工单正文,从状态里的 `customer_id` 做越权检查,只传 `messages` 的话,分类节点第一行就报 `KeyError: 'ticket'`,我第一次接的时候就是这么挂的。所以三样都传:`ticket` 给分类和检索用,`customer_id` 给越权检查用,`messages` 让第二轮、第三轮的历史接得上。

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

<div class="line-notes">

- `CREATE TABLE IF NOT EXISTS agent_sessions (` `IF NOT EXISTS` 让这个脚本可以重复跑,表已经在就什么也不做。
- `id           TEXT PRIMARY KEY,` 会话 id 由 `sessions.py` 生成,形如 `s_eabcdbbd8ea34539`,同时也是 LangGraph 的 `thread_id`。
- `customer_id  TEXT NOT NULL,` 会话属于哪个客户。每个接口都要比对它,别人的会话一律当不存在。
- `status       TEXT NOT NULL DEFAULT 'active',` 三个状态:`active` 进行中、`awaiting_approval` 等审批、`closed` 已关闭。实测一张退款工单的会话,第一轮结束后是 `awaiting_approval`,审批流跑完又变回 `active`。
- `created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),` `TIMESTAMPTZ` 是带时区的时间,插入时不传就用当前时间。
- `CREATE INDEX IF NOT EXISTS idx_sessions_customer ON agent_sessions (customer_id, updated_at DESC);` 为「按客户列出会话、最近的在前」这种查询建的联合索引。实测 `\d agent_sessions` 能看到 `agent_sessions_pkey` 和 `idx_sessions_customer` 两个索引。

</div>

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

<div class="line-notes">

- `from collections import defaultdict` `defaultdict(工厂函数)` 是取不存在的键时自动用工厂函数造一个默认值的字典,下面用它给每个会话按需造一把锁。
- `from psycopg_pool import AsyncConnectionPool` psycopg 3 的异步连接池,`main.py` 启动时建好再传进来。
- `def __init__(self, pool: AsyncConnectionPool):` 连接池由外面传进来,这个类自己不管建池和关池。
- `self._locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)` 第一次访问 `self._locks["s_abc"]` 时自动新建一把 `asyncio.Lock()`,以后再取还是同一把。锁只存在内存里,进程重启就没了,这正是正文说的「单进程才有效」。
- `async def create(self, customer_id: str) -> str:` 建一个新会话,返回会话 id。
- `sid = f"s_{uuid.uuid4().hex[:16]}"` `uuid4().hex` 是 32 位十六进制字符串,取前 16 位加上前缀 `s_`。实测生成过 `s_eabcdbbd8ea34539`、`s_9e4bae1ce7104554`。
- `async with self.pool.connection() as conn:` 从池里借一个连接,`async with` 结束时自动还回去。池是用 `autocommit=True` 建的,所以每条语句执行完就生效,不用手动 commit。
- `"INSERT INTO agent_sessions (id, customer_id) VALUES (%s, %s)", (sid, customer_id)` psycopg 的占位符是 `%s`,不是 sqlite3 的 `?`,但道理一样:值单独传,防注入。`status` 不传,用表上的默认值 `active`。
- `async def get(self, sid: str) -> dict | None:` 查一个会话,查不到返回 None。
- `row = await cur.fetchone()` 拿到的是一个元组,比如 `('s_eabcdbbd8ea34539', 'C007', 'active', None)`。`title` 一直没人写,所以是 None。
- `return {"id": row[0], "customer_id": row[1], "status": row[2], "title": row[3]}` 元组转成字典,调用方按名字取,不用记第几列。
- `async def set_status(self, sid: str, status: str) -> None:` 改状态时顺手把 `updated_at` 刷成 `now()`。
- `def lock(self, sid: str) -> asyncio.Lock:` 拿这个会话的锁。注意它不是 `async`,拿锁对象本身不用等,真正等的是 `await lock.acquire()`。

</div>

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

<div class="line-notes">

- `from collections.abc import AsyncIterable` 接口函数的返回类型写成 `AsyncIterable[ServerSentEvent]`,FastAPI 看到它就知道这是一个流式接口。
- `from contextlib import asynccontextmanager` 用来写 `lifespan`:`yield` 之前是启动时做的事,之后是关闭时做的事。
- `from fastapi.sse import EventSourceResponse, ServerSentEvent` FastAPI 0.135 起自带的 SSE 支持。`ServerSentEvent` 是一条事件,`EventSourceResponse` 负责把它们按 SSE 格式写出去。实测装的是 FastAPI 0.159.1。
- `from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver` 异步版的 Postgres checkpointer,图的每一步状态存进 Postgres。
- `from w4.ticket_agent import build_graph  # noqa: E402` 从 W4 拿图。这一行要求从 `agent-60-lab/` 根目录启动,`w4`、`w6` 才能当包导入。
- `async def lifespan(app: FastAPI):` 应用启动时执行到 `yield`,停止时执行 `yield` 后面的部分。连接池、checkpointer、图都在这里建一次,所有请求共用。
- `pool = AsyncConnectionPool(settings.database_url, open=False, kwargs={"autocommit": True})` `open=False` 是先建对象、等下面在事件循环里再 `await pool.open()`,新版 psycopg_pool 推荐这么写。`autocommit=True` 让每条 SQL 立即生效。
- `async with AsyncPostgresSaver.from_conn_string(settings.database_url) as saver:` checkpointer 自己管一个连接,`async with` 保证应用关闭时连接被关掉。
- `await saver.setup()  # 第一次运行时建 checkpoint 表,之后是空操作` 实测第一次启动后库里多了 `checkpoints` 等几张表。跑完三个会话,`checkpoints` 表里按 thread 分别有 12、10、9 行,每跑完一个节点存一行。
- `app.state.graph = build_graph(checkpointer=saver)` 把编译好的图挂在 `app.state` 上,接口里用 `app.state.graph` 取。实测整个启动过程(连库、建表、编译图)花了 10 秒左右,`Application startup complete` 之前请求是连不上的。
- `yield` 应用在这里「运行中」,直到收到停止信号。
- `app = FastAPI(title="SupportPilot API", lifespan=lifespan)` 把 lifespan 交给 FastAPI。注意:用了 `lifespan` 以后,`@app.on_event("startup")` 写的钩子**不会再执行**,Day 37 会踩到这一点。
- `def current_customer(x_demo_customer: Annotated[str | None, Header()] = None) -> str:` `Header()` 表示这个参数从请求头读。FastAPI 会把参数名里的下划线换成连字符,所以 `x_demo_customer` 对应的是请求头 `X-Demo-Customer`。
- `raise HTTPException(401, "missing X-Demo-Customer")` 实测不带这个头请求 `/api/sessions`,返回 `{"detail":"missing X-Demo-Customer"}`,状态码 401。
- `async def owned_session(sid: str, cid: Annotated[str, Depends(current_customer)]) -> dict:` 依赖套依赖:先跑 `current_customer` 拿到客户 id,再查会话、比对归属。`sid` 和路径参数 `{sid}` 同名,FastAPI 自动从 URL 里取。
- `if s is None or s["customer_id"] != cid:` 会话不存在,或者不是你的,走同一个分支。
- `raise HTTPException(404, "session not found")` 实测用 `C012` 的身份访问 `C007` 的会话,返回 `{"detail":"session not found"}`,状态码 404,和会话真不存在时一模一样。
- `text: str = Field(min_length=1, max_length=settings.max_message_chars)` 实测发空字符串返回 422,报错是 `String should have at least 1 character`。这个检查发生在请求体解析阶段,同样在流开始之前。
- `class Decision(BaseModel):` 审批接口的请求体:`approved` 必填,`note` 可选。
- `@app.post("/api/sessions")` 建会话。实测 `curl -X POST /api/sessions -H 'X-Demo-Customer: C007'` 返回 `{"session_id": "s_eabcdbbd8ea34539"}`。
- `def busy(code: str, message: str) -> ServerSentEvent:` 造一条 `error` 事件,`code` 给前端程序判断,`message` 给人看。
- `return ServerSentEvent(data={"code": code, "message": message}, event="error")` 实测线上的原始文本是 `event: error` 加 `data: {"code": "busy", "message": "上一轮还没结束"}`。中文被转成了 `\u` 转义,这是 JSON 编码的默认行为,前端 `JSON.parse` 以后就是「上一轮还没结束」,不影响使用。
- `async def _pump(sid: str, events, lock: asyncio.Lock) -> AsyncIterable[ServerSentEvent]:` 把适配层的事件包成 SSE,超时、异常、解锁、更新状态都集中在这里,两个流式接口共用。
- `started = time.monotonic()` `monotonic` 是只增不减的时钟,算耗时比 `time.time()` 可靠,系统改时间也不受影响。
- `seq = 0` 事件序号,每推一条加 1,作为 SSE 的 `id:`。
- `status = "active"` 默认这一轮跑完会话回到进行中,遇到审批请求再改成等审批。
- `async with asyncio.timeout(settings.turn_timeout_s):` Python 3.11 的超时写法,块里的代码超过 120 秒就在当前的 `await` 处抛 `TimeoutError`。
- `async for ev in events:` 一个个取出适配层产生的事件。
- `status = "awaiting_approval"` 看到 `approval_required` 就记下来,最后在 `finally` 里写进表。
- `ev.data["elapsed_ms"] = int((time.monotonic() - started) * 1000)` 给 `done` 补上耗时。实测退款工单第一轮的 `done` 是 `{"usage": {"input_tokens": 3828, "output_tokens": 552}, "elapsed_ms": 7682}`。
- `yield ServerSentEvent(data=ev.data, event=ev.type, id=str(seq))` 实测这一轮一共推了 220 条事件,其中 211 条是 token,最后一条 `done` 的 `id` 是 220。
- `except TimeoutError:` 超时不直接断开,推一条带 `code` 的错误事件,再正常结束这个流。
- `except asyncio.CancelledError:` 客户端断开时生成器会被取消。
- `raise` 取消必须原样抛出去,吞掉它的话 Starlette 不知道该停,任务会挂在那里。
- `except Exception as exc:  # noqa: BLE001` 其他异常变成 `internal` 错误事件,只给异常类名,不把堆栈和内部信息推给浏览器。
- `finally:` 正常结束、超时、出错、被取消,四条路都会走到这里。
- `await app.state.sessions.set_status(sid, status)` 实测第一轮结束后表里的状态是 `awaiting_approval`,审批流结束后是 `active`。
- `lock.release()` 锁在这里释放,和上面的 `acquire` 一一对应,路径是确定的。
- `@app.post("/api/sessions/{sid}/messages", response_class=EventSourceResponse)` `response_class=EventSourceResponse` 告诉 FastAPI 把这个函数 `yield` 出来的东西按 SSE 写出去。
- `sid: str, body: NewMessage, s: Annotated[dict, Depends(owned_session)]` 三个参数分别来自 URL 路径、请求体 JSON 和依赖。`s` 进到函数体时,鉴权和归属都已经检查完了。
- `if s["status"] == "awaiting_approval":` 实测审批还没处理时再发「怎么样了」,收到的是 `{'code': 'awaiting_approval', 'message': '有一个操作在等审批,先处理审批'}`。
- `if lock.locked():` 实测第一条消息还在跑(发出后 1.5 秒),紧接着再发一条「在吗」,立刻收到 `busy` 错误事件,第一条流不受影响。
- `await lock.acquire()` 先检查 `locked()` 再 `acquire()`,中间没有 `await`,在单线程的事件循环里不会被别的请求插队,所以这样写是安全的。
- `async for item in _pump(sid, stream_turn(app.state.graph, sid, s["customer_id"], body.text), lock):` `customer_id` 取自会话表(也就是登录态),不取自请求体。
- `if s["status"] != "awaiting_approval":` 实测会话刚建、还没发消息就调审批接口,收到 `no_pending_approval`。
- `decision = {"approved": body.approved, "note": body.note}` 实测批准时是 `{"approved": True, "note": ""}`。
- `async for item in _pump(sid, stream_resume(` 恢复流同样走 `_pump`,同样有超时、锁和状态更新。实测(在一个干净的库上)批准后 2.5 秒内回复完成,`cloudledger.db` 里多了一条 `pending_approval` 的退款申请。
- `snap = await app.state.graph.aget_state({"configurable": {"thread_id": sid}})` 读这个 thread 最新的 checkpoint。
- `msgs = snap.values.get("messages", []) if snap.values else []` 会话建了还没发过消息时,`snap.values` 是空字典。
- `if m.type in ("human", "ai") and m.content` 只返回人说的和模型说的、而且有文字的消息,工具消息和只调了工具没说话的 ai 消息都过滤掉。实测一轮退款工单返回 5 条:1 条 human、4 条 ai。
- `return FileResponse("w6/static/index.html")` 相对路径是相对当前工作目录的,所以 uvicorn 要从 `agent-60-lab/` 根目录启动,否则首页 404。

</div>

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
<p>客户 ID <input id="cid" value="C007"> <button onclick="newSession()">新会话</button> <span id="sid"></span></p>
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

<div class="line-notes">

- `#approval { display: none;` 审批面板默认藏起来,收到 `approval_required` 才显示。
- `<p>客户 ID <input id="cid" value="C007">` 这个输入框里的值会作为 `X-Demo-Customer` 头发出去。默认填 `C007`,是 Day 23 种子数据里刘静的客户号,她名下正好有那两张重复扣款的发票。换成种子里不存在的号,建会话没问题,但 Agent 会被越权检查挡住,什么也查不到。
- `let sid = null, reply = null;` `sid` 是当前会话 id;`reply` 指向正在往里追加文字的那个回复气泡,一轮结束时清空。
- `const headers = () => ({"Content-Type": "application/json", "X-Demo-Customer": cid.value});` 写成函数,每次请求时现读输入框,改了客户 id 马上生效。`cid` 能直接用,是因为浏览器会把带 `id` 的元素挂成同名的全局变量,演示页图省事,正式代码别这么写。
- `sid = (await r.json()).session_id;` 实测拿到 `s_9e4bae1ce7104554`,显示在按钮旁边。
- `function add(cls, text) {` 往日志区加一个 div,返回这个 div,`token` 事件靠这个返回值往同一个气泡里追加文字。用 `textContent` 而不是 `innerHTML`,模型输出里就算有 `<script>` 也只会当成文字显示。
- `document.getElementById("send").disabled = true;` 流开始就禁用发送按钮,防止手快连点。实测点击发送后按钮立即变成禁用。后端还有锁兜底,这里只是让用户别点。
- `if (!r.ok) {` 401、404、422 这些错误在流开始之前就返回了,`r.ok` 是 false,直接把状态码和响应体显示出来。
- `const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();` `r.body` 是字节流,`TextDecoderStream` 把它解码成 UTF-8 文本流,`getReader()` 拿到一个可以一块块 `read()` 的读取器。浏览器原生的 `EventSource` 只能发 GET 请求,我们要 POST 一个 JSON 请求体,所以自己读流。
- `const {value, done} = await reader.read(); if (done) break;` 每次读到一块文本,`done` 为 true 表示服务端已经关闭连接。
- `buf += value;` 收到的文本先攒进缓冲区。
- `while ((i = buf.indexOf("\n\n")) >= 0) {` 每找到一个空行,就切出一条完整的事件。一块数据里可能有好几条,所以用 `while`。
- `const raw = buf.slice(0, i); buf = buf.slice(i + 2);` 切出一条事件,剩下的(可能是半条)留在缓冲区等下一块。
- `if (line.startsWith("event:")) ev = line.slice(6).trim();` `event: token` 去掉前 6 个字符 `event:` 再 trim,得到 `token`。
- `else if (line.startsWith("data:")) data += line.slice(5).trim();` 同理拿到 JSON 文本。SSE 规定一条事件可以有多行 `data:`,所以用 `+=` 拼起来。`id:` 行和 keep-alive 注释行(以 `:` 开头)这里不处理,直接忽略。
- `if (data) handle(ev, JSON.parse(data));` 实测第一条是 `handle("token", {text: "我先"})`。
- `if (ev === "token") { reply ??= add("reply", ""); reply.textContent += d.text; }` `??=` 的意思是「`reply` 为 null 时才赋值」:第一个 token 来时新建气泡,后面的都追加进这个气泡。实测因为气泡在第一个 token 时就建好了,所以它排在工具卡片的上面。
- `else if (ev === "tool_call") add("card", "🔧 " + d.name + " " + JSON.stringify(d.args));` 实测显示 `🔧 find_customer {"query":"C007"}`、`🔧 get_subscription {"customer_id":"C007"}`、`🔧 list_invoices {"customer_id":"C007","limit":20}`。
- `else if (ev === "tool_result") add("card", (d.ok ? "✅ " : "❌ ") + d.name + ":" + d.preview);` 实测显示 `✅ find_customer:{"result": [{"id": "C007", "name": "刘静", …`、`✅ search_kb:[{"id": "kb-002#3", "title": "退款政策", …`。主管驳回时 `d.ok` 是 false,显示成 `❌ create_refund_request:[主管驳回] ……`。
- `else if (ev === "approval_required") { approval.style.display = "block";` 实测点发送后 6.9 秒弹出审批面板,面板里是 `{"type":"refund_approval","customer_id":"C007",…}`。
- `else if (ev === "done")` 实测第一轮显示「完成 6333 ms,输入 3828 / 输出 560 tokens」,批准后的第二轮显示「完成 2481 ms,输入 2393 / 输出 269 tokens」。同一行末尾的 `reply = null` 把气泡指针清掉,下一轮的 token 进新气泡。
- `function decide(ok) { approval.style.display = "none";` 实测点「批准」后 2.9 秒内先出现 `✅ create_refund_request:{"refund_request_id": 1, "status": "pending_approval", "amount_yuan": "2392.00"}`,接着是「刘静您好,已为您核实并提交退款申请……」的回复,最后一张卡片是「完成 2913 ms,输入 2516 / 输出 293 tokens」。

</div>

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

浏览器打开本机 8000 端口(`localhost:8000`),点「新会话」,输入 Day 23 那张 T1041 工单的原话:「你好,10 月 8 号我被扣了两次款,INV-2026-0026 和 INV-2026-0123 金额一模一样,麻烦把多扣的那笔退给我。」。如果 W4 的 Agent 写得没问题,你会看到先出现查客户、查发票的工具卡片,接着弹出审批面板。点批准,退款工具执行,然后回复一个字一个字地出来。

也可以不用浏览器,用 curl 看原始事件流,`-N` 关掉 curl 自己的缓冲:

```bash
SID=$(curl -s -X POST localhost:8000/api/sessions -H 'X-Demo-Customer: C007' | python3 -c 'import json,sys;print(json.load(sys.stdin)["session_id"])')
curl -N -X POST "localhost:8000/api/sessions/$SID/messages" \
  -H 'Content-Type: application/json' -H 'X-Demo-Customer: C007' \
  -d '{"text":"你好,10 月 8 号我被扣了两次款,INV-2026-0026 和 INV-2026-0123 金额一模一样,麻烦把多扣的那笔退给我。"}'
```

我实跑的一次输出如下(模型每次措辞和调用顺序会有出入)。线上传的 JSON 里中文是 `\u6211\u5148` 这样的转义,这里为了好读还原成了中文,中间省略了大部分 token:

```text
event: token
data: {"text": "我先"}
id: 1

event: token
data: {"text": "核实"}
id: 2
...
event: tool_call
data: {"id": "call_00_flsgtE1cEcAKzHvVQ7FX6782", "name": "find_customer", "args": {"query": "C007"}}
id: 11
...
event: tool_result
data: {"id": "call_00_flsgtE1cEcAKzHvVQ7FX6782", "name": "find_customer", "ok": true, "preview": "{\"result\": [{\"id\": \"C007\", \"name\": \"刘静\", \"email\": \"user007@example.com\", \"company\": \"半岛咖啡\"}]}"}
id: 13
...
event: approval_required
data: {"type": "refund_approval", "customer_id": "C007", "ticket": "你好,10 月 8 号我被扣了两次款,……", "requests": [{"invoice_id": "INV-2026-0123", "amount_yuan": 2392.0, "reason": "……"}]}
id: 134

event: done
data: {"usage": {"input_tokens": 6026, "output_tokens": 494}, "elapsed_ms": 7992}
id: 135
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
6. 越权测试。用 `C007` 建一个会话,再用 `X-Demo-Customer: C012` 去请求这个会话的 `/history`,必须拿到 404。

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
