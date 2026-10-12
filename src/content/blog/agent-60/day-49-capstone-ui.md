---
title: 'Day 49 · 界面与流式体验:Streamlit 前端、展示工具调用与审批'
description: '用 FastAPI 把工作流包成 HTTP 接口,用 SSE 把每个步骤、每次工具调用、每个字推给前端;Streamlit 做两个页面:客户视角看着 Agent 干活并追问,客服工作台一键审批退款,审批后工作流自动跑完。顺带修一个并发下成本算错的隐蔽 bug。'
pubDate: 2026-10-12
regime: none
tags: ['capstone', 'fastapi', 'sse', 'streamlit', 'streaming', 'ux', 'supportpilot', 'agent-60']
series: 'agent-60'
day: 49
lang: 'zh'
---

## 今天要解决的问题

到目前为止 SupportPilot 只能在终端里跑。面试官不会 clone 你的仓库、配 API key、起数据库来看效果,他们要的是一个打开就能用的页面,或者一段两分钟的演示视频。今天把界面做出来。

但今天的重点不是"做个界面",而是**让人看得见 Agent 在干什么**。一张工单处理下来要十几秒,如果页面上只有一个转圈的图标,用户会以为卡死了;如果能看到"正在查客户档案 → 正在查账单 → 调用了退款资格检查 → 正在写回复……",等待就变得可以忍受,而且用户能判断 Agent 有没有走偏。客服和财务更需要看到过程:Agent 查了哪些数据、依据哪条规则,才敢点"通过"。

今天结束时你应该做到:

1. 一组 HTTP 接口:建工单、跑工单、追问、查状态、列待审批、审批。
2. 跑工单和审批是 SSE 流式接口,推送节点完成、步骤细节、工具调用、逐字输出、审批暂停、完成六类事件。
3. Streamlit 两个页面:客户视角(提交工单、看过程、追问)和客服工作台(看待审批、一键审批)。
4. 修掉一个并发下成本统计出错的 bug。
5. 用 FastAPI 的测试客户端加假 LLM 测通"跑到审批 → 审批 → 完成"整条链路。

预计用时 4–5 小时。前置:Day 4(流式输出)、Day 36(FastAPI + SSE)、Day 47–48。

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
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
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
<text x="80" y="22" text-anchor="middle" fill="var(--ink)">Streamlit</text>
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

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1zV2QBtE39&autoplay=0&high_quality=1" title="黑马程序员PythonWeb开发:FastAPI从入门到实战视频教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>黑马程序员 · FastAPI 从入门到实战(合集)· 如果 Day 36 的 FastAPI 还不熟,挑路由、依赖注入、异步编程那几集补,不用全看。</figcaption>
</figure>

## Streamlit 界面

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

Streamlit 的模型是"每次交互,整个脚本从头跑一遍"。点一下按钮,脚本重跑,按钮那一行返回 True。理解了这一点,上面的代码就好读了。

**SSE 怎么读。** Streamlit 本身没有 SSE 客户端,用 httpx 的流式请求自己解析:逐行读,`event:` 开头的行记下事件名,`data:` 开头的行解析 JSON。二十行代码,比引一个库简单。

**`render_run` 把事件画成三样东西。** 一个 `st.status` 折叠框,里面逐行写"✓ 分诊""✓ 检索帮助中心",工具调用用代码块显示调用的函数和参数;一个 `st.empty` 占位符,收到 token 就把累积的文字写进去,末尾加一个光标符号,就是打字机效果;最后用 `done` 事件里渲染好的最终回复(带引用链接)替换打字机里的草稿。

质检不通过时,打字机的内容要清空,因为 draft 节点会重写。如果不清空,用户会看到两版草稿接在一起。

**客服工作台。** 列出所有待审批退款,每条显示申请号、客户、金额、命中的规则、原因;金额超过 1,000 元标红提示财务复核。点"通过"或"驳回"就调审批接口,并且用同一个 `render_run` 显示工作流恢复后的过程。

这个界面是演示用的,有几个刻意的简化:客户视角每次只显示最近一轮,不显示完整对话历史(Streamlit 重跑脚本后之前的输出会消失,要保留得把历史存进 `st.session_state`);没有登录,任何人打开工作台都能审批。Day 53 部署时会加演示账号和访问控制。这些简化在 README 里要写清楚,面试官看到"任何人都能审批"会问的,你提前写了就是"知道并且有计划",没写就是"没想到"。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1T5CJY7ECQ&autoplay=0&high_quality=1" title="入门即可搭建AI应用的框架Streamlit" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>技术蛋老师 · 入门即可搭建 AI 应用的框架 Streamlit · 9 分钟,讲清楚 Streamlit 的"脚本重跑"模型和常用组件,今天的界面代码看不懂的地方先看这个。</figcaption>
</figure>

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

## 动手练习

**步骤 1:放文件。** `agent/deps.py` 加上 `fresh()` 方法(顶部 import 改成 `from dataclasses import dataclass, replace`),新增 `api/app.py`、`ui/streamlit_app.py`、`tests/test_api.py`。

**步骤 2:跑测试。** `make test`。

**步骤 3:起服务。** 开两个终端:

```bash
make api      # uvicorn,http://localhost:8000/docs 能看到自动生成的接口文档
make ui       # streamlit,浏览器自动打开 http://localhost:8501
```

**步骤 4:先用 curl 看原始事件。** 在看界面之前,先用 curl 看一眼 SSE 流长什么样,出问题时能分清是后端还是前端:

```bash
curl -s -X POST localhost:8000/tickets -H 'content-type: application/json' \
  -d '{"customer_email":"liuyang@example.com","subject":"扣了两次","body":"9月12号被扣了两次39元,请退一笔"}'
# {"ticket_id":"T000153"}
curl -N -X POST localhost:8000/tickets/T000153/run
```

`-N` 关掉 curl 的缓冲,你会看到 `event: node`、`event: tool`、一串 `event: token` 一条条冒出来。

**步骤 5:界面上走一遍完整流程。** 客户视角选 `lina@example.com` 提交退款工单,看着它停在审批;切到客服工作台,看到这条申请,点通过;回到客户视角追问"大概几天到账?"。再用 `chenjing@example.com` 提交"这个月的钱退给我",确认不会出现在待审批里。

**步骤 6:录一段 2 分钟的屏。** 用系统自带的录屏工具录下步骤 5,存起来。Day 54 做演示视频时这是素材,录得不好也没关系,先有。

**步骤 7(选做):失败也要好看。** 在 `_events` 外面包一层 try/except:出异常时推一个 `event: error`,并调用 `escalate_to_human` 把工单转人工;前端收到 error 事件时显示"处理遇到问题,已转给人工客服"。验证方法:把 `.env` 里的 `LLM_API_KEY` 故意改错,提交一张工单,页面上应该看到友好的提示,数据库里这张工单的状态是 escalated,而不是一个半截的报错页面。

**验收标准:** 测试全绿;`/docs` 能看到六个接口;curl 能看到流式事件;界面上能完成"提交 → 看过程 → 审批 → 看到补充说明 → 追问"全流程;并发提交两张工单,两张的成本都在合理范围(各几分钱以内,不会一张特别高一张特别低)。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| SSE | Server-Sent Events,服务器单向推送事件的 HTTP 协议,浏览器原生支持 |
| 事件协议 | 前后端约定的事件名和数据格式 |
| lifespan | FastAPI 应用启动和关闭时执行的代码,用来建立和释放连接 |
| iterate_in_threadpool | 把同步生成器放进线程池迭代,避免阻塞事件循环 |
| 409 Conflict | HTTP 状态码,表示请求和资源当前状态冲突 |
| 脚本重跑模型 | Streamlit 每次交互都从头执行整个脚本 |
| st.session_state | Streamlit 在重跑之间保存数据的地方 |
| TestClient | FastAPI 提供的测试客户端,不用真起服务器就能调接口 |
| monkeypatch | pytest 的工具,测试期间临时替换某个对象 |

## 常见误区

**只显示一个转圈。** Agent 处理一张工单要十几秒,看不到过程的用户会焦虑、会重复提交。把过程推出来,既是体验也是可信度。

**在 async 接口里直接跑同步阻塞代码。** 一个请求卡住整个服务。要么放线程池,要么整条链路异步。

**共享对象不考虑并发。** 成本账本只是一个例子。缓存、计数器、连接,所有跨请求共享的可变状态都要过一遍"两个请求同时用会怎样"。

**把 SSE 当 WebSocket 用。** SSE 是单向的,服务器推、客户端收。客户端要发东西(追问、审批)就发一个普通 HTTP 请求。大部分 Agent 应用用 SSE 足够,不需要 WebSocket 的复杂度。

**演示界面不写限制。** 没登录、任何人能审批、不保存历史,这些简化本身没问题,不写出来才是问题。

## 学习资料

### 文档与文章

- [FastAPI 自定义响应](https://fastapi.tiangolo.com/advanced/custom-response/):StreamingResponse 和各种响应类型,20 分钟。
- [sse-starlette](https://github.com/sysid/sse-starlette):README 里的用法和心跳、断线检测配置,15 分钟。
- [MDN · Server-sent events](https://developer.mozilla.org/zh-CN/docs/Web/API/Server-sent_events):SSE 协议本身,中文版,20 分钟。
- [Streamlit · 构建对话应用](https://docs.streamlit.io/develop/tutorials/chat-and-llm-apps/build-conversational-apps)、[st.status](https://docs.streamlit.io/develop/api-reference/status/st.status) 和 [聊天组件](https://docs.streamlit.io/develop/api-reference/chat):今天用到的组件,30 分钟。
- [LangGraph Streaming](https://docs.langchain.com/oss/python/langgraph/streaming):`updates` 和 `custom` 两种模式的输出格式,复习 15 分钟。

### B 站视频

- 上面嵌的黑马程序员《FastAPI 从入门到实战》和技术蛋老师《入门即可搭建 AI 应用的框架 Streamlit》。
- GPT中英字幕课程资源《吴恩达 · 用 Streamlit 快速原型开发生成式 AI 应用》(BV1QmYrzMEu1,45 集合集):DeepLearning.AI 的 Streamlit 课程中字版,里面有聊天机器人和部署的几集,按需挑。

### 其他经典视频

- Alejandro AO《Stream LLMs with LangChain + Streamlit | Tutorial》(YouTube,zKGeRWjJlTU):Streamlit 里做流式输出的另一种写法,对比我们自己解析 SSE 的做法,下面嵌了。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/zKGeRWjJlTU" title="Stream LLMs with LangChain + Streamlit | Tutorial" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Alejandro AO · Stream LLMs with LangChain + Streamlit · 看他怎么在 Streamlit 里处理流式输出和会话历史,会话历史那部分正好是我们界面里简化掉的。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》第 10 章 AI Engineering Architecture and User Feedback:后半部分讲怎么在界面上收集用户反馈(显式的点赞点踩、隐式的重新生成和修改),这是我们界面下一步该加的东西,约 1 小时。

### 开源项目与代码

- [sysid/sse-starlette](https://github.com/sysid/sse-starlette):examples 目录。
- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):搜一下 `stream_mode` 的实现,理解 updates 和 custom 是怎么合并成一个流的。

## 自测

**1. 所有请求共用一个 LLMClient 时,节点的成本为什么会算错?`fresh()` 怎么解决?**

<details><summary>答案</summary>

节点用"结束时账本读数减开始时读数"算成本。共享客户端时,两个请求的调用都记在同一个账本上,A 节点执行期间 B 的花费也会被算进 A。`fresh()` 给每个请求新建 LLMClient(各自独立的账本),检索器、数据库连接等重对象仍然共享。

</details>

**2. 为什么接口函数里不能直接遍历 `graph.stream(...)`?**

<details><summary>答案</summary>

`graph.stream` 是同步生成器,内部的模型调用会阻塞几秒。在 async 上下文里直接迭代会阻塞事件循环,其他请求全部被卡住。用 `iterate_in_threadpool` 把每一步迭代放到线程池执行,事件循环保持空闲。

</details>

**3. 前端收到 `step` 事件,内容是质检不通过,为什么要清空打字机里的文字?**

<details><summary>答案</summary>

质检不通过会回到 draft 节点重新生成,新的 token 会从头推送。不清空的话,第二版草稿会接在第一版后面显示,用户看到两段重复又矛盾的文字。

</details>

**4. 工单停在审批节点时客户追问,接口返回 409,为什么不直接接受追问?**

<details><summary>答案</summary>

工单图此时处于 interrupt 暂停状态,等待的是审批决定。如果这时把追问作为新输入执行,会和待恢复的审批冲突,状态可能错乱。返回 409 让前端明确提示"等审批完成",比悄悄排队或者丢弃更清楚。

</details>

**5. 「面试题」你的 Agent 服务怎么做流式输出?为什么用 SSE 不用 WebSocket?**

<details><summary>答案</summary>

LangGraph 用 `stream_mode=["updates","custom"]` 同时拿到节点完成事件和节点内部主动推送的事件(工具调用、逐字 token、质检结果),在 FastAPI 里翻译成约定好的 SSE 事件(node/step/tool/token/interrupt/done),同步的图通过线程池迭代避免阻塞。用 SSE 是因为通信本质是单向的:服务器推过程,客户端的追问和审批都是独立的普通 HTTP 请求;SSE 基于普通 HTTP,穿透代理和负载均衡更容易,浏览器原生支持,断线重连简单。需要双向实时通信(比如语音)时才考虑 WebSocket。

</details>

**6. 「面试题」演示 Agent 时,为什么要把中间过程展示给用户?**

<details><summary>答案</summary>

三个原因:一是体验,处理要十几秒,看到进展用户不会以为卡死、不会重复提交;二是信任,客服和财务能看到 Agent 查了什么数据、依据哪条规则,才敢批准它的建议;三是调试,用户(和开发者)一眼能看出 Agent 在哪一步走偏了,比如检索到了错误的文章、调错了工具。

</details>

## 明天预告

Day 50 · 评测体系:100 条测试集、LLM-judge、轨迹评测,跑出第一份分数。按 Day 43 的验收指标设计评测集:36 个场景、100 种客户说法,按场景拆 dev/test;三层评测:规则检查(分类、工具、退款闸门、引用、事实、禁语)、LLM 评审(有没有依据、有没有解决问题)、轨迹和成本;跑出第一份基线报告。
