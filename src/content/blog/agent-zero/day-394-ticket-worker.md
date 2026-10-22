---
title: 'Day 394 · 工单处理 worker,上线和扩容'
description: '把队列、错误分类重试、幂等键、超时、断点续跑这几天的零件拼成一个真正能用的工单处理 worker:读工单、跑 Agent 图、写回工单表、失败转人工。然后实测开几个 worker、每个跑几个任务,以及发版重启时怎么不把手上的活扔掉。'
pubDate: 2026-10-22
regime: none
tags: ['arq', 'langgraph', 'worker', 'reliability', 'agent-zero']
series: 'agent-zero'
day: 394
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 393](/blog/agent-zero/day-393-resume/) 用固定的 `thread_id` 加 Postgres checkpointer,让 kill 在半路的图从断点接着跑,还实测了 worker 死掉以后要等 `job_timeout + 10` 秒任务才会被别人接手。那一课的图是假的:查发票是 `sleep(1)`,起草回复是拼一个字符串。再往前,[Day 389](/blog/agent-zero/day-389-retry-errors/) 的错误分类、[Day 390](/blog/agent-zero/day-390-idempotency/) 的幂等键、[Day 392](/blog/agent-zero/day-392-timeouts/) 的超时分层,也都是各自单独跑的小实验。今天把这些零件装到一个真正干活的 worker 里,然后回答 Day 393 面试题最后那半句:worker 怎么部署、开几个、发版重启时怎么不丢任务。

## 今天要解决的问题

今天结束时你应该能:

1. 写出一个完整的工单处理 worker:从工单表读正文,跑一张会调模型、查发票、建退款的图,把结果和状态写回工单表;能重试的错误交给 arq 重试,不能重试的转人工。
2. 用三组实验(进程崩溃、模型连不上、发票不存在)证明这个 worker 的每条失败路径都有着落,工单不会卡在「处理中」。
3. 用实测数据说清 `max_jobs` 和 worker 进程数怎么定,并用一个小函数算「清完 600 张积压要几个 worker、会给模型厂商多大并发」。
4. 实测 worker 收到 SIGTERM 时默认会怎样、配了 `job_completion_wait` 又会怎样,知道发版时容器的优雅退出时间该怎么设。

预计用时 3 小时。前置:[Day 388](/blog/agent-zero/day-388-arq/) 的 arq、[Day 389](/blog/agent-zero/day-389-retry-errors/) 的 `is_retryable`、[Day 390](/blog/agent-zero/day-390-idempotency/) 的幂等键、[Day 391](/blog/agent-zero/day-391-week56-review/) 的 `refunds.sql` 和 `tools_refund.py`、[Day 392](/blog/agent-zero/day-392-timeouts/) 的超时分层、[Day 393](/blog/agent-zero/day-393-resume/) 的 `ticket_graph.py` 和断点续跑。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先从前端看:worker 是一个没有页面的「后台标签页」

前端里你可能用过 Web Worker:主线程把一个耗时的活(压缩图片、解析大 JSON)`postMessage` 给它,自己继续响应用户点击,worker 算完了再 `postMessage` 回来。主线程不会因为这个活卡住。

服务端的 worker 是同一个想法,只是拆得更彻底:接 webhook 的 API 进程和真正干活的 worker 进程是两个完全独立的程序,中间隔着 Redis 里的队列。API 收到「客户提交了一张工单」,把工单号塞进队列,立刻回 202;worker 从队列里拿工单号,慢慢跑 Agent,跑完把结果写回数据库。坐席打开工单系统,看到的就是 worker 写回去的那几个字段。

这几天我们做的事情,其实就是在给这个后台进程买保险:

| 哪天 | 解决什么 | 今天在 worker 里对应哪一段 |
| --- | --- | --- |
| Day 388 | 有个进程专门从队列拿活 | `WorkerSettings`、`process_ticket` |
| Day 389 | 失败了要不要重试 | `should_retry` + `raise Retry(...)` |
| Day 390 | 重试时别建两笔退款 | `create_refund_request` 的幂等键 |
| Day 392 | 卡住了要能拿回控制权 | SDK `timeout=30`、工具 `asyncio.timeout`、`job_timeout` |
| Day 393 | 崩在半路要能接着跑 | `aget_state` + 输入传 None + `durability="sync"` |

今天新加的只有两样:把结果写回工单表(包括失败时写 `needs_human`),以及「上线和扩容」这层运维上的东西。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="工单处理 worker 的整体结构:工单系统把工单写进 tickets 表并把工单号推进 Redis 队列;多个 worker 进程从队列取任务,每个任务跑一张 LangGraph 图,图里调模型、查发票、建退款;checkpoint、退款、工单状态都写在 Postgres">
<rect x="20" y="40" width="120" height="60" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="80" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">ticket_intake</text>
<text x="80" y="86" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">(代替 webhook)</text>
<rect x="190" y="40" width="120" height="60" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="250" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Redis</text>
<text x="250" y="86" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">arq:queue</text>
<line x1="140" y1="70" x2="190" y2="70" stroke="var(--ink-soft)" stroke-width="1.5"/>
<rect x="360" y="20" width="260" height="44" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="490" y="47" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">worker 进程 1 · max_jobs=4</text>
<rect x="360" y="76" width="260" height="44" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="490" y="103" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">worker 进程 2 · max_jobs=4</text>
<line x1="310" y1="60" x2="360" y2="42" stroke="var(--ink-soft)" stroke-width="1.5"/>
<line x1="310" y1="80" x2="360" y2="98" stroke="var(--ink-soft)" stroke-width="1.5"/>
<text x="490" y="150" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">每个任务:classify → lookup_invoice → submit_refund → draft</text>
<rect x="20" y="190" width="600" height="90" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="36" y="214" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Postgres(agentzero_w56)</text>
<text x="36" y="240" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">tickets:正文 + agent_status / agent_note / agent_draft</text>
<text x="36" y="260" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">invoices · refund_requests(幂等键) · checkpoints(断点续跑)</text>
<line x1="80" y1="100" x2="80" y2="190" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
<line x1="490" y1="120" x2="490" y2="190" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
</svg>
<figcaption>今天搭的整体结构。入队脚本先把工单写进 tickets 表,再把工单号推进队列;worker 只拿到一个工单号,正文自己去表里读,处理完把状态写回同一张表。</figcaption>
</figure>

## 准备环境

还是 `agent-zero-lab` 目录,还是 Day 391 建的 `agentzero_w56` 库,Redis 要在跑(`redis-cli ping` 回 `PONG`)。今天不装新包,Day 391 和 Day 393 装过的 arq、psycopg、langgraph、langgraph-checkpoint-postgres、openai、python-dotenv 都够用。我实跑的版本:arq 0.28.0、langgraph 1.2.16、langgraph-checkpoint-postgres 3.2.0、openai 3.36.1,都是 2026 年 10 月在 PyPI 查到的最新版。`.env` 还是 Day 392 那份,`LLM_MODEL=deepseek-flash`,`LLM_EXTRA_BODY={"thinking": {"type": "disabled"}}`(关掉思考模式,分类这种一个词的活不需要它)。

今天要用到前几天的这几个文件,先确认它们都在:

```bash
cd agent-zero-lab
ls part07/retry.py part07/tools_refund.py part07/ticket_graph.py part07/sql/refunds.sql
```

`retry.py` 是 Day 391 默写的 `is_retryable` 和 `PermanentError`;`tools_refund.py` 是 Day 391 的 `create_refund_request`(幂等键由工单号和发票号算出来);`ticket_graph.py` 是 Day 393 的那张三步图,今天只借用它的 `maybe_crash` 自毁开关。

## 第一步:工单表和发票表

worker 要有地方读工单、写结果。真实公司里工单表在工单系统那边(Zendesk 或者自研系统),Agent 只能读正文、回写几个专属字段。练习时我们在同一个 Postgres 里建一张最小的,再建一张发票表,让「查发票」变成真的数据库查询:

```sql
-- agent-zero-lab/part07/sql/tickets.sql
CREATE TABLE IF NOT EXISTS invoices (
    id            TEXT PRIMARY KEY,
    customer_id   TEXT NOT NULL,
    amount_cents  INTEGER NOT NULL,
    status        TEXT NOT NULL DEFAULT 'paid'
);

CREATE TABLE IF NOT EXISTS tickets (
    id            TEXT PRIMARY KEY,
    customer_id   TEXT NOT NULL,
    text          TEXT NOT NULL,
    agent_status  TEXT NOT NULL DEFAULT 'queued',
    agent_note    TEXT NOT NULL DEFAULT '',
    agent_draft   TEXT NOT NULL DEFAULT '',
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO invoices (id, customer_id, amount_cents) VALUES
    ('INV-0123', 'C007', 239200),
    ('INV-0456', 'C012', 9900),
    ('INV-0789', 'C031', 500)
ON CONFLICT (id) DO NOTHING;
```

<div class="line-notes">

- `CREATE TABLE IF NOT EXISTS invoices (` 发票表,三张发票。和 Day 391 的退款表一样用 `IF NOT EXISTS`,脚本可以反复跑。
- `amount_cents  INTEGER NOT NULL,` 金额用「分」存整数。`239200` 分就是 2392.00 元,下面 worker 写的回复里会看到这个数字。
- `CREATE TABLE IF NOT EXISTS tickets (` 工单表。前三列是工单系统那边的数据,后面四列是 Agent 专属的回写字段。
- `agent_status  TEXT NOT NULL DEFAULT 'queued',` 状态只有四种:`queued`(刚入队)、`processing`(worker 正在跑)、`draft_ready`(草稿写好了,等坐席确认发出)、`needs_human`(Agent 处理不了,转人工)。
- `agent_note    TEXT NOT NULL DEFAULT '',` 给坐席看的备注:成功时写退款单号,失败时写失败原因。
- `agent_draft   TEXT NOT NULL DEFAULT '',` 模型起草的回复。注意是草稿,不是直接发给客户,发不发由坐席决定。
- `updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()` 每次回写都刷新。后面扩容实验就靠它算「一批工单从第一张开始到最后一张结束花了几秒」。
- `INSERT INTO invoices (id, customer_id, amount_cents) VALUES` 三张发票。故意没有 `INV-9999`,用来制造「发票不存在」。
- `ON CONFLICT (id) DO NOTHING;` 主键冲突就跳过,重复跑脚本不会报错。

</div>

```bash
psql -d agentzero_w56 -f part07/sql/tickets.sql
```

```text
CREATE TABLE
CREATE TABLE
INSERT 0 3
```

## 第二步:一张真正干活的工单图

Day 393 的图三步都是假的。今天这张图有四个节点,两个调模型、两个碰数据库:

- `classify`:调模型把工单分成 billing / tech / other。
- `lookup_invoice`:从正文里找发票号,去 `invoices` 表查。只有 billing 才走这一步。
- `submit_refund`:调 Day 391 的 `create_refund_request` 建退款申请,带幂等键。
- `draft`:把前面查到的事实交给模型,让它起草一段回复。

```python
# agent-zero-lab/part07/ticket_agent.py
import asyncio
import json
import operator
import os
import re
from typing import Annotated, Literal, NotRequired, TypedDict

from dotenv import load_dotenv
from langgraph.graph import END, START, StateGraph
from openai import AsyncOpenAI
from psycopg_pool import AsyncConnectionPool

from part07.retry import PermanentError
from part07.ticket_graph import maybe_crash
from part07.tools_refund import create_refund_request

load_dotenv()
llm = AsyncOpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"], timeout=30, max_retries=2)
MODEL = os.environ["LLM_MODEL"]
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
TOOL_TIMEOUT = float(os.getenv("TOOL_TIMEOUT", "20"))
TOOL_DELAY = float(os.getenv("TOOL_DELAY", "0"))  # 假装订单系统很慢,做实验用


class TicketState(TypedDict):
    ticket_id: str
    text: str
    steps: Annotated[list[str], operator.add]
    category: NotRequired[str]
    invoice: NotRequired[dict]
    refund: NotRequired[dict]
    draft: NotRequired[str]


async def ask(prompt: str, max_tokens: int) -> str:
    resp = await llm.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=max_tokens,
        extra_body=EXTRA,
    )
    return (resp.choices[0].message.content or "").strip()


def facts_for_model(state: TicketState) -> dict[str, str]:
    facts = {"分类": state.get("category", "other")}
    if "invoice" in state:
        inv = state["invoice"]
        facts["发票"] = f"{inv['id']},金额 {inv['amount_cents'] / 100:.2f} 元"
    if "refund" in state:
        facts["退款申请"] = f"已提交,单号 {state['refund']['refund_id']},等主管审批,批准前不会到账"
    return facts


def build_graph(pool: AsyncConnectionPool, checkpointer=None):
    async def classify(state: TicketState) -> dict:
        word = await ask(f"把工单分成 billing/tech/other 之一,只回一个词:{state['text']}", 5)
        category = word if word in ("billing", "tech", "other") else "other"
        return {"category": category, "steps": ["classify"]}

    async def lookup_invoice(state: TicketState) -> dict:
        m = re.search(r"INV-\d+", state["text"])
        if m is None:
            raise PermanentError("工单里没写发票号")
        async with asyncio.timeout(TOOL_TIMEOUT):
            await asyncio.sleep(TOOL_DELAY)
            async with pool.connection() as conn:
                cur = await conn.execute("SELECT id, amount_cents FROM invoices WHERE id = %s", (m.group(),))
                row = await cur.fetchone()
        if row is None:
            raise PermanentError(f"发票 {m.group()} 不存在")
        maybe_crash("lookup_invoice")
        return {"invoice": {"id": row[0], "amount_cents": row[1]}, "steps": ["lookup_invoice"]}

    async def submit_refund(state: TicketState) -> dict:
        inv = state.get("invoice")
        if inv is None:
            raise PermanentError("走到退款这一步却没有发票信息")
        async with asyncio.timeout(TOOL_TIMEOUT):
            r = await create_refund_request(
                pool, ticket_id=state["ticket_id"], invoice_id=inv["id"], amount_cents=inv["amount_cents"]
            )
        return {"refund": r, "steps": ["submit_refund"]}

    async def draft(state: TicketState) -> dict:
        facts = facts_for_model(state)
        text = await ask(
            "你是云簿 CloudLedger 的客服。根据事实写一段不超过 80 字的中文回复,"
            f"事实里没有的不要承诺。\n工单:{state['text']}\n事实:{json.dumps(facts, ensure_ascii=False)}",
            200,
        )
        return {"draft": text, "steps": ["draft"]}

    def route(state: TicketState) -> Literal["lookup_invoice", "draft"]:
        return "lookup_invoice" if state.get("category") == "billing" else "draft"

    g = StateGraph(TicketState)
    g.add_node("classify", classify)
    g.add_node("lookup_invoice", lookup_invoice)
    g.add_node("submit_refund", submit_refund)
    g.add_node("draft", draft)
    g.add_edge(START, "classify")
    g.add_conditional_edges("classify", route)
    g.add_edge("lookup_invoice", "submit_refund")
    g.add_edge("submit_refund", "draft")
    g.add_edge("draft", END)
    return g.compile(checkpointer=checkpointer)
```

<div class="line-notes">

- `import re` 正则模块,相当于 JS 里的 `RegExp`。下面用它从正文里找 `INV-0123` 这种发票号。
- `from typing import Annotated, Literal, NotRequired, TypedDict` `Literal` 是 [Day 47](/blog/agent-zero/day-047-type-hints-3/) 学的字面量类型,相当于 TS 的 `"a" | "b"`。
- `from psycopg_pool import AsyncConnectionPool` 连接池,Day 391 用过。图里的两个数据库节点共用 worker 启动时建好的那一个池子。
- `from part07.retry import PermanentError` Day 391 定义的「重试也没用」的错误。发票不存在就抛它。
- `from part07.ticket_graph import maybe_crash` Day 393 的自毁开关:环境变量 `CRASH_AT` 等于节点名时,进程在那里 `os._exit(1)`。
- `llm = AsyncOpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"], timeout=30, max_retries=2)` Day 392 定下的模型层超时:每次 30 秒,SDK 自己最多再试 2 次,最坏 90 秒。
- `EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))` 从 `.env` 读额外参数,这里是关掉 DeepSeek 的思考模式。`json.loads` 相当于 `JSON.parse`。
- `TOOL_TIMEOUT = float(os.getenv("TOOL_TIMEOUT", "20"))` 工具层超时 20 秒,也是 Day 392 的数字。做成环境变量,实验时可以改。
- `TOOL_DELAY = float(os.getenv("TOOL_DELAY", "0"))  # 假装订单系统很慢,做实验用` 默认 0。第六步的优雅退出实验会设成 5,让任务跑得够久,来得及在半路发信号。
- `class TicketState(TypedDict):` 图的状态。和 Day 393 的 `TicketState` 同名但不是同一个,它在另一个文件里,互不影响。
- `ticket_id: str` 多了工单号,建退款要用它算幂等键。
- `steps: Annotated[list[str], operator.add]` 和 Day 393 一样,每个节点往里追加自己的名字,用来看走了哪些节点。
- `refund: NotRequired[dict]` 退款结果 `{"refund_id": ..., "deduplicated": ...}`,只有 billing 工单才有。
- `async def ask(prompt: str, max_tokens: int) -> str:` 调一次模型、拿回文本。两个调模型的节点都用它,以后要换模型、加日志只改这一处。
- `return (resp.choices[0].message.content or "").strip()` `content` 可能是 None,`or ""` 兜底,相当于 JS 的 `?? ""`。`.strip()` 去掉首尾空白,相当于 `.trim()`。
- `def facts_for_model(state: TicketState) -> dict[str, str]:` 把状态里查到的东西整理成给模型看的「事实」。只给事实,不给整个 state,模型就没机会看到内部字段名。
- `facts["发票"] = f"{inv['id']},金额 {inv['amount_cents'] / 100:.2f} 元"` `/ 100` 把分换成元,`:.2f` 保留两位小数,相当于 JS 的 `.toFixed(2)`。实测是 `INV-0123,金额 2392.00 元`。
- `facts["退款申请"] = f"已提交,单号 {state['refund']['refund_id']},等主管审批,批准前不会到账"` 「批准前不会到账」这句话写进事实里,模型才不会自己发挥成「三个工作日内到账」。
- `def build_graph(pool: AsyncConnectionPool, checkpointer=None):` 节点要用连接池,所以和 Day 393 的 `resume_refund.py` 一样,把节点函数定义在建图函数里面,用闭包拿到 `pool`。
- `category = word if word in ("billing", "tech", "other") else "other"` 模型回的不在三个词里(比如回了 `Billing.`),就当 other。永远别直接信模型的输出去做路由。
- `m = re.search(r"INV-\d+", state["text"])` 在正文里找第一个形如 `INV-数字` 的片段,相当于 JS 的 `text.match(/INV-\d+/)`。`r"..."` 是原始字符串,反斜杠不用写两遍。
- `raise PermanentError("工单里没写发票号")` 没写发票号,重试一百次也不会有,直接判永久错误。
- `async with asyncio.timeout(TOOL_TIMEOUT):` Day 392 的工具层超时,包住整个查询。
- `await asyncio.sleep(TOOL_DELAY)` 实验用的人工延迟,默认 0 秒等于没有。
- `cur = await conn.execute("SELECT id, amount_cents FROM invoices WHERE id = %s", (m.group(),))` `m.group()` 是匹配到的整段文字,比如 `INV-0123`。`%s` 是 psycopg 的参数占位符,值通过后面的元组传进去,不要自己拼字符串(拼了就是 SQL 注入)。`(x,)` 是只有一个元素的元组,逗号不能少。
- `raise PermanentError(f"发票 {m.group()} 不存在")` 客户写了一张不存在的发票。实测 `INV-9999` 走到这里。
- `maybe_crash("lookup_invoice")` 崩溃实验的埋点,放在「查完了、还没返回」的位置。
- `inv = state.get("invoice")` 按图的结构,走到这里一定有发票;但类型上它是 `NotRequired`,用 `.get` 再判断一次,basedpyright 才不会标红。
- `r = await create_refund_request(` Day 391 的幂等写库函数,同一张工单同一张发票永远只有一条退款。
- `text = await ask(` 第二次调模型。提示词里明确写「事实里没有的不要承诺」,下面实跑会看到它并不总是听话。
- `def route(state: TicketState) -> Literal["lookup_invoice", "draft"]:` 条件边的路由函数,[Day 306](/blog/agent-zero/day-306-lg-conditional/) 学过。返回值就是下一个节点的名字。
- `g.add_conditional_edges("classify", route)` classify 之后走哪条路由 `route` 决定:billing 去查发票,其他直接起草。
- `return g.compile(checkpointer=checkpointer)` 传了 checkpointer 才能断点续跑。

</div>

这个文件只定义图。先看一眼图的结构对不对:

```bash
uv run python -c "from part07.ticket_agent import build_graph; print(list(build_graph(None).get_graph().nodes))"
```

```text
['__start__', 'classify', 'lookup_invoice', 'submit_refund', 'draft', '__end__']
```

`build_graph(None)` 只是为了看结构,没有真的连数据库,所以传 None 也能编译。

## 第三步:worker 本体

worker 要做的事按顺序是:先看这张工单的 thread 有没有进度;没有就从工单表读正文,作为输入;把状态改成 `processing`;跑图;成功就写回草稿和备注;失败了分两种,能重试的抛 `Retry` 交给 arq,不能重试的写 `needs_human`。

```python
# agent-zero-lab/part07/ticket_worker.py
import os

from arq import Retry
from arq.connections import RedisSettings
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

from part07.retry import is_retryable
from part07.ticket_agent import TicketState, build_graph

DSN = os.getenv("PG_DSN", "postgresql://localhost/agentzero_w56")
REDIS = RedisSettings.from_dsn(os.getenv("REDIS_URL", "redis://localhost:6379"))
MAX_TRIES = 3


async def startup(ctx):
    ctx["pool"] = AsyncConnectionPool(DSN, connection_class=AsyncConnection, open=False, kwargs={"autocommit": True})
    await ctx["pool"].open()
    ctx["saver_cm"] = AsyncPostgresSaver.from_conn_string(DSN)
    saver = await ctx["saver_cm"].__aenter__()
    await saver.setup()
    ctx["graph"] = build_graph(ctx["pool"], checkpointer=saver)


async def shutdown(ctx):
    await ctx["saver_cm"].__aexit__(None, None, None)
    await ctx["pool"].close()


async def set_ticket(pool: AsyncConnectionPool, ticket_id: str, status: str, note: str = "", draft: str = "") -> None:
    async with pool.connection() as conn:
        cur = await conn.execute(
            "UPDATE tickets SET agent_status = %s, agent_note = %s, agent_draft = %s, updated_at = now() WHERE id = %s",
            (status, note, draft, ticket_id),
        )
    if cur.rowcount == 0:
        print(f"[{ticket_id}] 工单表里没有这一行,状态 {status} 没写进去", flush=True)


def should_retry(exc: BaseException) -> bool:
    return is_retryable(exc) or isinstance(exc, TimeoutError)


async def process_ticket(ctx, ticket_id: str) -> str:
    pool, graph = ctx["pool"], ctx["graph"]
    config: RunnableConfig = {"configurable": {"thread_id": f"ticket-{ticket_id}"}}
    try:
        snap = await graph.aget_state(config)
        if snap.values and not snap.next:
            return "already_done"
        graph_input: TicketState | None = None
        if not snap.next:
            async with pool.connection() as conn:
                cur = await conn.execute("SELECT text FROM tickets WHERE id = %s", (ticket_id,))
                row = await cur.fetchone()
            if row is None:
                return "ticket_not_found"
            graph_input = {"ticket_id": ticket_id, "text": row[0], "steps": []}
        print(f"[{ticket_id}] try {ctx['job_try']} resume={graph_input is None}", flush=True)
        await set_ticket(pool, ticket_id, "processing")
        result = await graph.ainvoke(graph_input, config=config, durability="sync")
        note = f"退款 {result['refund']['refund_id']} 待审批" if "refund" in result else ""
        await set_ticket(pool, ticket_id, "draft_ready", note, result["draft"])
        return "draft_ready"
    except Exception as exc:
        if should_retry(exc) and ctx["job_try"] < MAX_TRIES:
            print(f"[{ticket_id}] try {ctx['job_try']} {type(exc).__name__} -> 重试", flush=True)
            raise Retry(defer=2 * ctx["job_try"] ** 2) from exc
        print(f"[{ticket_id}] try {ctx['job_try']} {type(exc).__name__}: {exc} -> 转人工", flush=True)
        await set_ticket(pool, ticket_id, "needs_human", f"{type(exc).__name__}: {exc}"[:500])
        return "needs_human"


class WorkerSettings:
    functions = [process_ticket]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = REDIS
    max_jobs = int(os.getenv("MAX_JOBS", "4"))
    job_timeout = int(os.getenv("JOB_TIMEOUT", "300"))
    max_tries = MAX_TRIES
    job_completion_wait = int(os.getenv("DRAIN_SECONDS", "0"))
```

<div class="line-notes">

- `from arq import Retry` 在任务里 `raise Retry(defer=秒数)`,arq 就在那么多秒后重新执行这个任务,`job_try` 加 1。Day 389 用过。
- `from part07.retry import is_retryable` Day 391 默写的错误分类。
- `DSN = os.getenv("PG_DSN", "postgresql://localhost/agentzero_w56")` 数据库地址先读环境变量,没设就用默认值。上线以后数据库肯定不在 localhost,这一行就是给那时候留的口子。
- `REDIS = RedisSettings.from_dsn(os.getenv("REDIS_URL", "redis://localhost:6379"))` 同理,Redis 地址也从环境变量读。`from_dsn` 是把一个 URL 解析成 arq 的连接配置。
- `MAX_TRIES = 3` 下面 `except` 里的判断和 `WorkerSettings.max_tries` 用同一个数,不会两处写得不一样。
- `ctx["pool"] = AsyncConnectionPool(DSN, connection_class=AsyncConnection, open=False, kwargs={"autocommit": True})` `open=False` 表示先建对象、不连库,下一行在异步环境里再 `await open()`。psycopg-pool 3.3 在构造函数里直接打开异步池会给一个弃用警告,这么写最干净。
- `ctx["saver_cm"] = AsyncPostgresSaver.from_conn_string(DSN)` Day 393 讲过:`from_conn_string` 返回的是异步上下文管理器,worker 的启动和关闭在两个函数里,只能手动调 `__aenter__` / `__aexit__`。
- `ctx["graph"] = build_graph(ctx["pool"], checkpointer=saver)` 图在 worker 启动时编译一次,之后所有任务共用。
- `async def set_ticket(pool: AsyncConnectionPool, ticket_id: str, status: str, note: str = "", draft: str = "") -> None:` 回写工单表的唯一入口。参数带默认值,相当于 JS 的 `function setTicket(id, status, note = "", draft = "")`。
- `"UPDATE tickets SET agent_status = %s, agent_note = %s, agent_draft = %s, updated_at = now() WHERE id = %s",` 每次都把三个字段一起覆盖。所以从 `needs_human` 重新跑成功时,旧的失败原因也会被清掉。
- `if cur.rowcount == 0:` `UPDATE` 一行都没改到时数据库不报错。`rowcount` 是这条语句影响的行数,等于 0 就说明工单号写错了或者工单被删了,打一行日志,不然结果会悄悄丢掉。
- `def should_retry(exc: BaseException) -> bool:` 在 Day 391 的 `is_retryable` 外面再包一层。
- `return is_retryable(exc) or isinstance(exc, TimeoutError)` `asyncio.timeout` 到点抛的是内置的 `TimeoutError`,它不是 openai 或 httpx 的异常,`is_retryable` 不认识它,会返回 False。工具超时大多是对方临时慢,值得再试,所以这里补上。
- `async def process_ticket(ctx, ticket_id: str) -> str:` 和 Day 393 不同,任务参数只有工单号。正文在工单表里,不塞进队列:Redis 里存的东西越少越好,而且客户改了工单正文,重试时读到的是最新的。
- `config: RunnableConfig = {"configurable": {"thread_id": f"ticket-{ticket_id}"}}` thread_id 由工单号唯一决定,Day 393 练习 2 讲过为什么不能混随机数。
- `snap = await graph.aget_state(config)` 先看这张工单的进度,再决定怎么跑。
- `if snap.values and not snap.next:` 有数据、而且没有下一步,说明这张工单已经完整跑过了。
- `return "already_done"` 同一张工单被重复投递(比如有人手动又推了一次)时直接返回,不会再调一遍模型、再起草一遍。下面第四步会实测。
- `graph_input: TicketState | None = None` 默认是 None,也就是「续跑」。
- `if not snap.next:` 没有半路的进度,才去读正文、从头跑。注意这里**不再看 `job_try`**。Day 393 是 `job_try > 1` 才查进度,今天改成每次都查:因为重复投递不一定是 arq 的重试,也可能是人手动重推,那时 `job_try` 是 1,但进度是在的。
- `cur = await conn.execute("SELECT text FROM tickets WHERE id = %s", (ticket_id,))` 读正文。
- `return "ticket_not_found"` 工单不存在,没什么可处理,也没地方写 `needs_human`,直接结束。
- `graph_input = {"ticket_id": ticket_id, "text": row[0], "steps": []}` `row[0]` 是这一行的第一列,也就是 `text`。
- `print(f"[{ticket_id}] try {ctx['job_try']} resume={graph_input is None}", flush=True)` 每次执行打一行,实验里靠它看是不是续跑。
- `await set_ticket(pool, ticket_id, "processing")` 先把状态改成「处理中」,坐席能看到 Agent 已经接手了。
- `result = await graph.ainvoke(graph_input, config=config, durability="sync")` Day 393 的结论:队列任务用 sync,每步写完 checkpoint 再走下一步。
- `note = f"退款 {result['refund']['refund_id']} 待审批" if "refund" in result else ""` 只有走了退款那条路的工单才有 `refund`。实测是 `退款 R-5bdfb7fb 待审批`。
- `await set_ticket(pool, ticket_id, "draft_ready", note, result["draft"])` 成功的出口。
- `except Exception as exc:` 图里任何节点抛出的异常都会从 `ainvoke` 冒出来,到这里分类。
- `if should_retry(exc) and ctx["job_try"] < MAX_TRIES:` 能重试、而且还没到最后一次,才交给 arq。
- `raise Retry(defer=2 * ctx["job_try"] ** 2) from exc` `**` 是乘方,第 1 次失败等 2 秒,第 2 次等 8 秒。Day 389 用的是 10 秒、40 秒,今天为了实验不用干等,系数改成了 2;上线时按 Day 389 的数字来。
- `await set_ticket(pool, ticket_id, "needs_human", f"{type(exc).__name__}: {exc}"[:500])` 失败的出口:状态改成转人工,原因写进备注。`type(exc).__name__` 是异常的类名,比如 `PermanentError`。`[:500]` 截断,有的异常消息很长。
- `return "needs_human"` 注意这里是 `return` 而不是 `raise`。对 arq 来说任务是「成功完成」的,业务上的失败靠返回值和工单表表达。不这样做的话,arq 会把它记成失败任务,还可能按自己的规则再跑。
- `max_jobs = int(os.getenv("MAX_JOBS", "4"))` 一个 worker 进程同时跑几个任务,第五步专门做实验。
- `job_timeout = int(os.getenv("JOB_TIMEOUT", "300"))` Day 392 的最外层超时。Day 393 说过它也决定了 worker 死后多久任务能被接手,实验时会调小。
- `job_completion_wait = int(os.getenv("DRAIN_SECONDS", "0"))` 收到停止信号后,最多等手上的任务多少秒再退出。默认 0 就是不等,第六步专门讲。

</div>

最后写一个入队脚本,代替真实系统里的 webhook。它先往工单表插一行,再把工单号推进队列:

```python
# agent-zero-lab/part07/ticket_intake.py
import asyncio
import sys

from arq import create_pool
from psycopg import AsyncConnection

from part07.ticket_worker import DSN, REDIS

SAMPLES = [
    ("C007", "10 月 8 号被扣了两次款,INV-0123 那笔麻烦退给我"),
    ("C012", "INV-0456 是重复扣费,申请退款"),
    ("C044", "导出 PDF 发票的时候页面一直转圈"),
    ("C031", "INV-9999 这张发票我没买过东西,请退款"),
]


async def main(prefix: str, n: int):
    redis = await create_pool(REDIS)
    async with await AsyncConnection.connect(DSN, autocommit=True) as conn:
        for i in range(n):
            customer_id, text = SAMPLES[i % len(SAMPLES)]
            tid = f"{prefix}-{i + 1:02d}"
            await conn.execute(
                "INSERT INTO tickets (id, customer_id, text) VALUES (%s, %s, %s) ON CONFLICT (id) DO NOTHING",
                (tid, customer_id, text),
            )
            job = await redis.enqueue_job("process_ticket", tid, _job_id=f"ticket-{tid}")
            print(tid, "入队" if job else "重复,跳过")
    await redis.aclose()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 4))
```

<div class="line-notes">

- `from part07.ticket_worker import DSN, REDIS` 地址和 worker 用同一份,不会一个连 A 库一个连 B 库。
- `SAMPLES = [` 四种样本:两张能退的、一张技术问题、一张发票不存在。每种都对应 worker 的一条路径。
- `async with await AsyncConnection.connect(DSN, autocommit=True) as conn:` 只用一个连接,不需要连接池。`await` 先建连接,`async with` 保证用完关掉。
- `customer_id, text = SAMPLES[i % len(SAMPLES)]` `%` 取余,第 5 张又从第 1 种开始,所以 12 张就是四种各 3 张。`a, b = 元组` 是解构,相当于 JS 的 `const [a, b] = arr`。
- `tid = f"{prefix}-{i + 1:02d}"` `:02d` 补零到两位,得到 `W-01`、`W-02`。前缀由命令行给,每做一组实验换一个前缀,数据不会混在一起。
- `"INSERT INTO tickets (id, customer_id, text) VALUES (%s, %s, %s) ON CONFLICT (id) DO NOTHING",` 工单已经存在就不插,重复跑脚本不会报错。
- `job = await redis.enqueue_job("process_ticket", tid, _job_id=f"ticket-{tid}")` job id 用工单号拼,Day 391 讲过:同一个 job id 已经在队列里或者结果还没过期,`enqueue_job` 返回 None,这就是 webhook 重发的去重。
- `print(tid, "入队" if job else "重复,跳过")` 实测同一个前缀再跑一次,打印的是 `重复,跳过`。

</div>

## 第四步:先让它正常跑一批

入队 4 张,再起一个 `--burst` 模式的 worker(Day 388 讲过,队列清空就自动退出):

```bash
uv run python -m part07.ticket_intake W 4
uv run arq --burst part07.ticket_worker.WorkerSettings
```

```text
W-01 入队
W-02 入队
W-03 入队
W-04 入队
18:56:59: Starting worker for 1 functions: process_ticket
18:56:59: redis_version=7.4.6 mem_usage=1.61M clients_connected=1 db_keys=54
18:57:00:   6.40s → ticket-W-01:process_ticket('W-01') delayed=6.40s
18:57:00:   6.40s → ticket-W-02:process_ticket('W-02') delayed=6.40s
[W-01] try 1 resume=False
18:57:00:   6.40s → ticket-W-03:process_ticket('W-03') delayed=6.40s
[W-02] try 1 resume=False
[W-03] try 1 resume=False
18:57:00:   6.48s → ticket-W-04:process_ticket('W-04') delayed=6.48s
[W-04] try 1 resume=False
[W-04] try 1 PermanentError: 发票 INV-9999 不存在 -> 转人工
18:57:01:   1.75s ← ticket-W-04:process_ticket ● 'needs_human'
18:57:02:   2.04s ← ticket-W-01:process_ticket ● 'draft_ready'
18:57:02:   2.14s ← ticket-W-03:process_ticket ● 'draft_ready'
18:57:02:   2.36s ← ticket-W-02:process_ticket ● 'draft_ready'
```

四张工单几乎同时开始(`max_jobs` 默认 4),W-04 最先结束,因为它在查发票时就失败了,少调了一次模型。另外三张都在 2 秒左右。`delayed=6.40s` 是入队到开始执行的间隔,大头是 worker 启动时导入 langgraph 那些包,这台 2019 年的 Intel MacBook 要好几秒。

坐席那边看到的是工单表:

```bash
psql -d agentzero_w56 -c "select id, agent_status, agent_note, agent_draft from tickets where id like 'W-%' order by id"
```

```text
  id  | agent_status |              agent_note              |                                                         agent_draft
------+--------------+--------------------------------------+------------------------------------------------------------------------------------------------------------------------------
 W-01 | draft_ready  | 退款 R-5bdfb7fb 待审批               | 您好，INV-0123（2392.00元）的退款申请已提交，单号R-5bdfb7fb，目前等待主管审批，批准前不会到账，请耐心等待。
 W-02 | draft_ready  | 退款 R-7dbd5a8b 待审批               | 您好，关于发票 INV-0456（99.00 元）的重复扣费退款申请已提交，单号 R-7dbd5a8b，目前等待主管审批，批准前不会到账，请耐心等待。
 W-03 | draft_ready  |                                      | 您好，您反馈的导出PDF发票页面一直转圈的问题已记录为技术类问题。建议您先刷新页面或更换浏览器重试，我们会尽快排查处理。
 W-04 | needs_human  | PermanentError: 发票 INV-9999 不存在 |
(4 rows)
```

三条路径都对上了:两张 billing 建了退款、草稿里引用了真实金额和单号;技术问题没走退款;发票不存在的转了人工,原因写得清清楚楚。

再仔细看 W-03 的草稿:「建议您先刷新页面或更换浏览器重试,我们会尽快排查处理」。事实里只有「分类:tech」,这两句都是模型自己加的。「刷新重试」还算无害;另一次实跑它写的是「已为您记录并转交技术团队处理」,可我们的图根本没有转交这一步。这就是为什么 `agent_draft` 是草稿、由坐席确认后才发出去。提示词里写「事实里没有的不要承诺」能降低这种情况,但挡不干净,第六部分的评测就是用来量化这件事的。

再验证一下「已经跑完的工单被重复投递」。`reenqueue.py` 模拟有人在后台手动点了「重新处理」,它用了一个不同的 job id,所以不会被 arq 的去重挡住:

```python
# agent-zero-lab/part07/reenqueue.py
import asyncio
import sys

from arq import create_pool

from part07.ticket_worker import REDIS


async def main(ticket_id: str):
    redis = await create_pool(REDIS)
    job = await redis.enqueue_job("process_ticket", ticket_id, _job_id=f"manual-{ticket_id}")
    print("入队" if job else "重复,跳过")
    await redis.aclose()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
```

<div class="line-notes">

- `job = await redis.enqueue_job("process_ticket", ticket_id, _job_id=f"manual-{ticket_id}")` job id 换了前缀,arq 认为这是一个新任务。同一张工单可能在队列里出现两个不同的任务,只能靠任务内部判断。

</div>

```bash
uv run python -m part07.reenqueue T-01
uv run python -m part07.reenqueue T-01
uv run arq --burst part07.ticket_worker.WorkerSettings
```

```text
入队
重复,跳过
...
18:53:17:  12.19s → manual-T-01:process_ticket('T-01') delayed=12.19s
18:53:17:   0.01s ← manual-T-01:process_ticket ● 'already_done'
```

(T-01 是我第一次跑时用的前缀,和 W-01 是同一种工单。)第二次推送被 arq 的 job id 去重挡住;第一次推送的任务执行了,0.01 秒就返回 `already_done`,没调模型。这就是 worker 里 `if snap.values and not snap.next` 那一行的作用:**arq 的 job id 挡的是「同一个任务推两次」,checkpoint 挡的是「同一张工单换个任务又来一次」**,两层各管一件事。

## 第五步:三条失败路径各走一遍

正常路径跑通只说明一半。worker 的价值在于失败的时候工单有着落。上面已经看到了「永久错误转人工」,再造两种:进程崩溃和模型连不上。

**进程崩溃。** 用 Day 393 的办法,让 worker 在查完发票后自杀,再起一个 worker 接手。`JOB_TIMEOUT=10` 让接手快一点(Day 393 说过,要等 `job_timeout + 10` 秒):

```bash
uv run python -m part07.ticket_intake K2 1
export JOB_TIMEOUT=10
CRASH_AT=lookup_invoice uv run arq --burst part07.ticket_worker.WorkerSettings
CRASH_AT=lookup_invoice uv run arq --burst part07.ticket_worker.WorkerSettings
rm .crash_flag
```

```text
K2-01 入队
18:57:11: Starting worker for 1 functions: process_ticket
18:57:11: redis_version=7.4.6 mem_usage=1.61M clients_connected=1 db_keys=55
18:57:11:   4.04s → ticket-K2-01:process_ticket('K2-01') delayed=4.04s
[K2-01] try 1 resume=False
  !! 在 lookup_invoice 节点模拟进程被 kill
18:57:17: Starting worker for 1 functions: process_ticket
18:57:17: redis_version=7.4.6 mem_usage=1.61M clients_connected=1 db_keys=58
18:57:31:  24.20s → ticket-K2-01:process_ticket('K2-01') try=2 delayed=24.20s
[K2-01] try 2 resume=True
18:57:32:   1.29s ← ticket-K2-01:process_ticket ● 'draft_ready'
```

第一个 worker 18:57:11 开始执行,第二个 18:57:31 接手,正好 20 秒(10 + 10)。接手后 `resume=True`,classify 没有重调模型。查一下结果:

```bash
psql -d agentzero_w56 -Atc "select id, agent_status, agent_note from tickets where id='K2-01'"
psql -d agentzero_w56 -Atc "select count(*) from refund_requests where ticket_id='K2-01'"
```

```text
K2-01|draft_ready|退款 R-aea66a39 待审批
1
```

在第二个 worker 接手之前的那 20 秒里,工单表里这张单是 `processing`。这个状态很重要:坐席看得到「Agent 正在处理」,不会以为它被漏掉了;如果某张单在 `processing` 停留得远远超过 `job_timeout`,就说明真的出事了,这是一个值得做成告警的信号(第六部分的可观测会用到)。

**模型连不上。** 把模型地址指到本机一个没人监听的端口(9 号端口),模拟模型厂商故障:

```bash
uv run python -m part07.ticket_intake R 1
LLM_BASE_URL=http://127.0.0.1:9 uv run arq --burst part07.ticket_worker.WorkerSettings
psql -d agentzero_w56 -Atc "select id, agent_status, agent_note from tickets where id='R-01'"
```

```text
R-01 入队
18:52:35: Starting worker for 1 functions: process_ticket
18:52:35: redis_version=7.4.6 mem_usage=1.60M clients_connected=1 db_keys=7
18:52:35:   8.05s → ticket-R-01:process_ticket('R-01') delayed=8.05s
[R-01] try 1 resume=False
[R-01] try 1 APIConnectionError -> 重试
18:52:37:   1.74s ↻ ticket-R-01:process_ticket retrying job in 2.00s
18:52:39:  12.01s → ticket-R-01:process_ticket('R-01') try=2
[R-01] try 2 resume=True
[R-01] try 2 APIConnectionError -> 重试
18:52:40:   1.22s ↻ ticket-R-01:process_ticket retrying job in 8.00s
18:52:48:  21.52s → ticket-R-01:process_ticket('R-01') try=3
[R-01] try 3 resume=True
[R-01] try 3 APIConnectionError: Connection error. -> 转人工
18:52:50:   1.43s ← ticket-R-01:process_ticket ● 'needs_human'
R-01|needs_human|APIConnectionError: Connection error.
```

`APIConnectionError` 被 `is_retryable` 判成可重试,arq 分别隔 2 秒、8 秒重试,第 3 次还失败就转人工。每次 1 秒多才失败,是因为 openai SDK 自己先重试了 2 次(Day 392 讲过的 `max_retries=2`),连接被拒绝很快,所以三次加起来也就 1 秒多。

这里有个细节值得停一下:第 2 次执行打印的是 `resume=True`。classify 一次都没成功,哪来的进度?答案在 Day 393 看过的 checkpoint 表里:图一开始收到输入时就存了 step -1 和 step 0 两个 checkpoint,这时 `next` 是 `('classify',)`。所以第二次执行找到了「做到一半」的进度(其实是刚开头),输入传 None,从 classify 接着跑。结果和从头跑完全一样,还省了一次读工单表。

三条失败路径都有了着落,汇总一下:

| 出了什么事 | worker 怎么处理 | 工单最后的状态 | 实测 |
| --- | --- | --- | --- |
| 发票不存在(`PermanentError`) | 不重试,直接转人工 | `needs_human`,备注写原因 | W-04 |
| 模型连不上(`APIConnectionError`) | arq 重试 2 次,还不行转人工 | `needs_human` | R-01 |
| 进程被 kill | 等 `job_timeout + 10` 秒别的 worker 接手,续跑 | `draft_ready` | K2-01 |
| 同一张工单被手动重推 | `already_done`,不重跑 | 不变 | T-01 |

这张表就是面试时被问「你的 worker 失败了怎么办」的标准答案骨架。

## 第六步:开几个 worker、每个跑几个任务

worker 能跑了,下一个问题是开多大。有两个旋钮:`max_jobs` 决定一个进程同时跑几个任务;进程数决定开几个这样的进程。

先做实验:同样 12 张工单(四种各 3 张),分别用三种配置跑,用工单表的 `updated_at` 算这一批从第一张开始到最后一张结束花了多久。

```bash
uv run python -m part07.ticket_intake A 12
MAX_JOBS=1 uv run arq --burst part07.ticket_worker.WorkerSettings
uv run python -m part07.ticket_intake B 12
MAX_JOBS=4 uv run arq --burst part07.ticket_worker.WorkerSettings
uv run python -m part07.ticket_intake C 12
MAX_JOBS=2 uv run arq --burst part07.ticket_worker.WorkerSettings &
MAX_JOBS=2 uv run arq --burst part07.ticket_worker.WorkerSettings
```

最后两行是同时起两个 worker:第一行末尾的 `&` 让它在后台跑(终端不用等它结束,马上可以敲下一行),第二行在前台跑。等两个都退出后:

```bash
psql -d agentzero_w56 -c "select left(id,1) batch, count(*), round(extract(epoch from max(updated_at)-min(updated_at))::numeric,1) seconds, count(*) filter (where agent_status='draft_ready') ok from tickets where id ~ '^[ABC]-' group by 1 order by 1"
```

```text
 batch | count | seconds | ok
-------+-------+---------+----
 A     |    12 |    18.2 |  9
 B     |    12 |     4.4 |  9
 C     |    12 |     4.1 |  9
(3 rows)
```

这条 SQL 有几个新写法:`left(id,1)` 取工单号第一个字母当批次名;`max(updated_at)-min(updated_at)` 是这一批最晚和最早的回写时间之差,`extract(epoch from ...)` 把它换成秒数;`count(*) filter (where ...)` 只数满足条件的行;`id ~ '^[ABC]-'` 是 Postgres 的正则匹配,相当于 JS 的 `/^[ABC]-/.test(id)`。

| 配置 | 同时在跑的任务数 | 12 张用时 |
| --- | --- | --- |
| 1 个 worker,`max_jobs=1` | 1 | 18.2 秒 |
| 1 个 worker,`max_jobs=4` | 4 | 4.4 秒 |
| 2 个 worker,各 `max_jobs=2` | 4 | 4.1 秒 |

从 1 到 4,快了 4 倍多一点,几乎是线性的。原因是这个任务 95% 的时间都在**等**:等模型回、等数据库回。等的时候 CPU 是空的,asyncio 就去跑别的任务([Day 66](/blog/agent-zero/day-066-async-1/) 讲过的事件循环)。这种活叫 I/O 密集型,加并发几乎白赚。

后两行几乎一样:两个进程各跑 2 个,和一个进程跑 4 个,效果差不多。两个 worker 的日志里分别处理了 7 张和 5 张,谁闲着谁去拿,不用你分配。那为什么还要开多个进程?三个理由:

1. **一个进程只能用一个 CPU 核。** 任务里有算得重的部分(解析大 PDF、本地跑 embedding),一个进程开再多 `max_jobs` 也只有一个核在干活。
2. **一个进程挂了,其他还在。** 上面 K2-01 的实验里,如果只有一个 worker,它死了以后就没人干活了。
3. **能跨机器。** 一台机器开不下了,另一台机器上起几个连同一个 Redis 就行,这就是「水平扩容」。

那 `max_jobs` 能不能开到 100?技术上可以,但有两个上限会先撞到。一个是数据库连接:每个任务要用连接池里的连接,psycopg-pool 默认最多 4 个连接(`max_size` 默认等于 `min_size`,而 `min_size` 默认 4),任务多了会排队等连接。另一个是模型厂商的限流。我查了 DeepSeek 的限流文档(2026 年 10 月):它不按每分钟请求数限,而是按**账号并发**限,`deepseek-flash` 是 2500 个同时在途的请求,`deepseek-v4-pro` 是 500,超了返回 429;OpenAI 这类厂商则是按每分钟请求数(RPM)和每分钟 token 数(TPM)限。所以要算两个数:同时有多少个模型请求在途、每分钟打出去多少个。

```python
# agent-zero-lab/part07/how_many_workers.py
import math


def workers_needed(queued: int, seconds_per_job: float, max_jobs: int, drain_within_s: float, calls_per_job: int) -> dict:
    slots = math.ceil(queued * seconds_per_job / drain_within_s)  # 要多少个并发槽位才能按时清完
    workers = math.ceil(slots / max_jobs)  # 每个 worker 进程提供 max_jobs 个槽位
    rpm = slots * calls_per_job * 60 / seconds_per_job  # 这么多槽位每分钟会打出去多少次模型请求
    return {"slots": slots, "workers": workers, "max_model_concurrency": slots, "model_rpm": round(rpm)}


if __name__ == "__main__":
    print(workers_needed(queued=600, seconds_per_job=2.1, max_jobs=4, drain_within_s=120, calls_per_job=2))
    print(workers_needed(queued=600, seconds_per_job=2.1, max_jobs=4, drain_within_s=30, calls_per_job=2))
    print(workers_needed(queued=60000, seconds_per_job=2.1, max_jobs=4, drain_within_s=30, calls_per_job=2))
```

<div class="line-notes">

- `import math` 下面用 `math.ceil` 向上取整,相当于 JS 的 `Math.ceil`。槽位和进程都不能有半个。
- `def workers_needed(queued: int, seconds_per_job: float, max_jobs: int, drain_within_s: float, calls_per_job: int) -> dict:` 输入:积压了几张、每张要几秒、每个进程几个槽、希望多少秒内清完、每张调几次模型。
- `slots = math.ceil(queued * seconds_per_job / drain_within_s)  # 要多少个并发槽位才能按时清完` 总工作量是 600 × 2.1 = 1260「槽位秒」,要在 120 秒里做完,就要 1260 / 120 = 10.5,向上取整 11 个槽位同时干。
- `workers = math.ceil(slots / max_jobs)  # 每个 worker 进程提供 max_jobs 个槽位` 11 / 4 = 2.75,要 3 个进程。
- `rpm = slots * calls_per_job * 60 / seconds_per_job  # 这么多槽位每分钟会打出去多少次模型请求` 每个槽位每 2.1 秒处理完一张、调 2 次模型,一分钟就是 2 × 60 / 2.1 ≈ 57 次;11 个槽位约 629 次。
- `return {"slots": slots, "workers": workers, "max_model_concurrency": slots, "model_rpm": round(rpm)}` 同时在途的模型请求最多等于槽位数,因为一个任务同一时刻最多在等一个模型请求(我们的图是串行的)。
- `print(workers_needed(queued=600, seconds_per_job=2.1, max_jobs=4, drain_within_s=120, calls_per_job=2))` 2.1 秒取自上面的实测(正常工单 1.5 到 2.4 秒),2 次模型调用是 classify 加 draft。

</div>

```bash
uv run python -m part07.how_many_workers
```

```text
{'slots': 11, 'workers': 3, 'max_model_concurrency': 11, 'model_rpm': 629}
{'slots': 42, 'workers': 11, 'max_model_concurrency': 42, 'model_rpm': 2400}
{'slots': 4200, 'workers': 1050, 'max_model_concurrency': 4200, 'model_rpm': 240000}
```

第一行:积压 600 张、两分钟内清完,3 个 worker 就够,同时在途 11 个模型请求,离 DeepSeek 的 2500 很远。第二行:想在 30 秒内清完,要 11 个 worker,每分钟 2400 次请求,如果换成一个 RPM 上限 1000 的厂商,就会开始大面积 429,然后在重试里打转,反而更慢。第三行:积压 6 万张(比如月初批量出账单后的咨询高峰)还要 30 秒清完,同时在途 4200,超过 DeepSeek flash 的 2500,一定会被限流。

所以扩容不是「越多越好」,上限往往不在你自己的机器,而在模型厂商。真实做法是先定一个「最多同时多少个模型请求」的预算,`max_jobs × 进程数` 不超过它,宁可排队慢一点。DeepSeek 文档里写了可以提工单申请提高并发,而且不加钱。

**按队列长度自动扩缩容。** 在公司里,worker 通常跑在 Kubernetes 上,常见做法是用 KEDA 这类组件盯着队列长度,积压多了自动加副本,半夜没活缩到 1 个。这里有个我实际查出来的坑:KEDA 自带的 Redis 触发器是按**列表(list)长度**扩的,而 arq 的队列在 Redis 里不是列表:

```bash
uv run python -m part07.ticket_intake Z 3
redis-cli type arq:queue
redis-cli zcard arq:queue
redis-cli llen arq:queue
```

```text
Z-01 入队
Z-02 入队
Z-03 入队
zset
3
(error) WRONGTYPE Operation against a key holding the wrong kind of value
```

`arq:queue` 是一个有序集合(zset),分数是「这个任务应该什么时候执行」的时间戳,这样 `Retry(defer=8)` 才能让任务 8 秒后才被取出来。拿列表的命令 `LLEN` 去读它直接报 `WRONGTYPE`。所以用 arq 时不能直接套 KEDA 的 Redis 列表触发器,要自己把 `ZCARD arq:queue` 的结果暴露成一个监控指标,再让扩缩容组件去读这个指标(第六部分讲 Prometheus 指标)。这一段我只在本机验证了 Redis 里的类型,没有实跑 Kubernetes 和 KEDA,本机没有 Docker 和 K8s。

## 第七步:发版重启时别把手上的活扔掉

发版就是用新代码的 worker 换掉旧的。在 Kubernetes 和 Docker 里,停一个容器的标准流程是:先给进程发 SIGTERM 信号(「请你退出」),等一段宽限期(Kubernetes 默认 30 秒,Docker 的 `docker stop` 默认 10 秒),还不退就发 SIGKILL 强杀。SIGKILL 就是 Day 393 用 `os._exit` 模拟的那种死法,进程没有任何机会收尾。

所以要搞清楚:arq 收到 SIGTERM 时,手上正在跑的任务会怎样?实验办法是让任务跑得久一点(`TOOL_DELAY=5`,查发票前睡 5 秒),在任务开始 1 秒后给 worker 发 SIGTERM。

开两个终端,都 `cd agent-zero-lab`。终端 A 先入队,再起一个**非 burst** 的 worker(不加 `--burst`,它会一直等新任务,像线上那样):

```bash
uv run python -m part07.ticket_intake D 2
TOOL_DELAY=5 uv run arq part07.ticket_worker.WorkerSettings
```

看到两行 `try 1 resume=False` 以后,在终端 B 发信号:

```bash
pkill -TERM -f "arq part07.ticket_worker"
```

`pkill -f` 按完整命令行匹配进程并发信号,`-TERM` 就是 SIGTERM。终端 A 的输出:

```text
18:55:02: Starting worker for 1 functions: process_ticket
18:55:02: redis_version=7.4.6 mem_usage=1.61M clients_connected=1 db_keys=46
18:55:02:   8.31s → ticket-D-01:process_ticket('D-01') delayed=8.31s
18:55:02:   8.31s → ticket-D-02:process_ticket('D-02') delayed=8.31s
[D-01] try 1 resume=False
[D-02] try 1 resume=False
18:55:03: shutdown on SIGTERM ◆ 0 jobs complete ◆ 0 failed ◆ 0 retries ◆ 2 ongoing to cancel
18:55:03:   1.16s ↻ ticket-D-02:process_ticket cancelled, will be run again
18:55:03:   1.16s ↻ ticket-D-01:process_ticket cancelled, will be run again
```

默认行为是**立刻取消**手上的任务,打出 `cancelled, will be run again`,然后退出。好消息是它会把任务放回队列,而且是正常收尾,不需要等 in-progress 标记过期。坏消息是做了一半的活白做了,工单表里两张单停在 `processing`。马上再起一个 worker,它们会被接手:

```bash
uv run arq --burst part07.ticket_worker.WorkerSettings
```

```text
18:55:18: Starting worker for 1 functions: process_ticket
18:55:18: redis_version=7.4.6 mem_usage=1.61M clients_connected=1 db_keys=48
18:55:18:  24.27s → ticket-D-01:process_ticket('D-01') try=2 delayed=24.27s
18:55:18:  24.27s → ticket-D-02:process_ticket('D-02') try=2 delayed=24.27s
[D-01] try 2 resume=True
[D-02] try 2 resume=True
18:55:19:   1.01s ← ticket-D-02:process_ticket ● 'draft_ready'
18:55:20:   2.11s ← ticket-D-01:process_ticket ● 'draft_ready'
```

`try=2 resume=True`,classify 没有重调,断点续跑在这里又帮了一次忙。但「被取消」这件事本身还是有代价:取消发生在 lookup_invoice 中间,这一步要重做;如果取消发生在 draft 模型调用中间,那次调用的钱就白花了。

更好的做法是让 worker 收到信号后**不再领新任务,等手上的做完再走**。arq 0.28 有这个开关,就是 `WorkerSettings` 里的 `job_completion_wait`。我翻了 arq 的 `worker.py`:这个值非 0 时,SIGINT 和 SIGTERM 的处理函数会换成 `handle_sig_wait_for_completion`,它先把 `allow_pick_jobs` 设成 False,然后最多等这么多秒,时间到了还没做完的才取消。设成 15 秒再做一次:

```bash
uv run python -m part07.ticket_intake F 2
TOOL_DELAY=5 DRAIN_SECONDS=15 uv run arq part07.ticket_worker.WorkerSettings
# 看到两行 try 1 后,在另一个终端:pkill -TERM -f "arq part07.ticket_worker"
```

```text
18:55:38: Starting worker for 1 functions: process_ticket
18:55:38: redis_version=7.4.6 mem_usage=1.61M clients_connected=1 db_keys=48
18:55:38:   5.37s → ticket-F-01:process_ticket('F-01') delayed=5.37s
18:55:38:   5.36s → ticket-F-02:process_ticket('F-02') delayed=5.36s
[F-01] try 1 resume=False
[F-02] try 1 resume=False
18:55:39: Setting allow_pick_jobs to `False`
18:55:39: shutdown on SIGTERM ◆ 0 jobs complete ◆ 0 failed ◆ 0 retries ◆ 2 to be completed
18:55:45:   6.79s ← ticket-F-02:process_ticket ● 'draft_ready'
18:55:45:   7.01s ← ticket-F-01:process_ticket ● 'draft_ready'
18:55:45: shutdown on SIGTERM, wait complete ◆ 2 jobs complete ◆ 0 failed ◆ 0 retries ◆ 0 ongoing to cancel
```

18:55:39 收到信号,打出 `Setting allow_pick_jobs to False`(不再领新活)和 `2 to be completed`;6 秒后两张都做完了,最后一行 `0 ongoing to cancel`,一个都没扔。

再看等的时间不够会怎样,`DRAIN_SECONDS=2`,比任务还短:

```text
18:55:58:   6.35s → ticket-P-01:process_ticket('P-01') delayed=6.35s
18:55:58:   6.34s → ticket-P-02:process_ticket('P-02') delayed=6.34s
[P-01] try 1 resume=False
[P-02] try 1 resume=False
18:55:59: Setting allow_pick_jobs to `False`
18:55:59: shutdown on SIGTERM ◆ 0 jobs complete ◆ 0 failed ◆ 0 retries ◆ 2 to be completed
18:56:01: shutdown on SIGTERM, wait complete ◆ 0 jobs complete ◆ 0 failed ◆ 0 retries ◆ 2 ongoing to cancel
18:56:01:   3.07s ↻ ticket-P-01:process_ticket cancelled, will be run again
18:56:01:   3.07s ↻ ticket-P-02:process_ticket cancelled, will be run again
```

等满 2 秒,还没做完,照样取消、放回队列。下一个 worker 来了会接着跑(我实跑确认两张都在下一个 worker 里 `draft_ready` 了)。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="发版时三个时间的关系:worker 收到 SIGTERM 后,arq 最多等 job_completion_wait 秒让手上的任务做完;容器平台的宽限期必须比它长,否则平台先发 SIGKILL;而 job_completion_wait 应该覆盖大多数任务的耗时">
<line x1="40" y1="60" x2="600" y2="60" stroke="var(--rule)"/>
<text x="40" y="44" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">SIGTERM</text>
<line x1="40" y1="52" x2="40" y2="200" stroke="var(--ink-soft)"/>
<rect x="40" y="76" width="200" height="26" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="50" y="94" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">典型任务耗时(P95)</text>
<rect x="40" y="116" width="320" height="26" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="50" y="134" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">job_completion_wait(arq 等多久)</text>
<rect x="40" y="156" width="440" height="26" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)"/>
<text x="50" y="174" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">宽限期(K8s 默认 30s,docker stop 默认 10s)</text>
<text x="490" y="174" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">→ SIGKILL</text>
<text x="40" y="218" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">要求:任务耗时 &lt; job_completion_wait &lt; 宽限期,和超时分层一样内短外长</text>
</svg>
<figcaption>发版时的三个时间。和 Day 392 的超时分层是同一个原则:arq 自己的等待要比平台的宽限期短,不然还没来得及取消、放回队列,就被 SIGKILL 了,任务只能等 in-progress 标记过期才有人接手。</figcaption>
</figure>

把三种情况放在一起:

| 配置 | 收到 SIGTERM 后 | 手上的任务 | 下一个 worker |
| --- | --- | --- | --- |
| `job_completion_wait=0`(默认) | 立刻取消 | 放回队列,做了一半的白做 | 马上接手,续跑 |
| `job_completion_wait=15`,任务 6 秒 | 不领新活,等 | 做完 | 不需要接手 |
| `job_completion_wait=2`,任务 6 秒 | 等 2 秒后取消 | 放回队列 | 马上接手,续跑 |
| 被 SIGKILL(宽限期太短) | 什么都来不及 | 留在 in-progress | 等 `job_timeout + 10` 秒 |

我的配置原则:`job_completion_wait` 设成任务耗时的 P95 左右(P95 叫第 95 百分位数:把所有任务的耗时从小到大排好,排在 95% 位置的那个值,也就是 95% 的任务比它快),平台宽限期再比它多 10 秒以上。我们的 Agent 任务一般几秒到几十秒,`job_completion_wait=60`、Kubernetes 的 `terminationGracePeriodSeconds=90` 是合理的起点。比这个还长的任务(几分钟以上),就不要指望「等它做完」了,要靠断点续跑和幂等,让它被取消也没关系。

**worker 上线的形态。** 最后说清楚 worker 在服务器上长什么样。它就是一个一直运行的命令 `arq part07.ticket_worker.WorkerSettings`,和 API 服务是**两个独立的进程**,部署时分开:API 按请求量扩,worker 按队列积压扩;API 重启不影响正在跑的工单,worker 重启不影响接 webhook。第七部分后面讲 Docker Compose 的那几天,会在 compose 文件里给它单独写一个服务,镜像和 API 共用,只是启动命令不同。上面的 `PG_DSN`、`REDIS_URL`、`MAX_JOBS`、`JOB_TIMEOUT`、`DRAIN_SECONDS` 全做成了环境变量,就是为了到那时候不用改代码。

## 零件和完整 worker 的对照

| 前几天的零件 | 在 `ticket_worker.py` / `ticket_agent.py` 里的哪一段 |
| --- | --- |
| Day 388 arq worker | `WorkerSettings`、`process_ticket`、`ticket_intake.py` |
| Day 389 `is_retryable` | `should_retry` 里调用,外加 `TimeoutError` |
| Day 389 退避重试 | `raise Retry(defer=2 * ctx["job_try"] ** 2)` |
| Day 390 幂等键 | `submit_refund` 节点里的 `create_refund_request` |
| Day 391 job id 去重 | `_job_id=f"ticket-{tid}"` |
| Day 392 超时分层 | SDK `timeout=30, max_retries=2`、工具 `asyncio.timeout(TOOL_TIMEOUT)`、`job_timeout` |
| Day 393 断点续跑 | `aget_state` + `graph_input = None` + `durability="sync"` |
| 今天新加 | `set_ticket` 回写、`needs_human`、`already_done`、`max_jobs`、`job_completion_wait` |

## 动手练习

### 练习 1:工单里没写发票号

入队一张正文是「我上个月被多扣了一笔钱,麻烦查一下」的工单(工单号 `N-01`,客户 `C007`),先预测它会走哪条路、最后是什么状态,再跑一遍验证。

<details><summary>参考答案</summary>

预测:模型大概率把它分成 billing,于是走到 lookup_invoice,正则找不到 `INV-数字`,抛 `PermanentError("工单里没写发票号")`,不重试,转人工。

```bash
psql -d agentzero_w56 -c "INSERT INTO tickets (id, customer_id, text) VALUES ('N-01', 'C007', '我上个月被多扣了一笔钱,麻烦查一下')"
uv run python -m part07.reenqueue N-01
uv run arq --burst part07.ticket_worker.WorkerSettings
psql -d agentzero_w56 -Atc "select agent_status, agent_note from tickets where id='N-01'"
```

第二行借用 `reenqueue.py` 把一张已经在表里的工单推进队列,省得再写一个脚本。

```text
INSERT 0 1
入队
...
[N-01] try 1 resume=False
[N-01] try 1 PermanentError: 工单里没写发票号 -> 转人工
19:17:42:   1.04s ← manual-N-01:process_ticket ● 'needs_human'
needs_human|PermanentError: 工单里没写发票号
```

这道题我实跑的结果和预测一致。真实系统里这种工单其实可以做得更好:不转人工,而是让 draft 节点起草一句「请提供发票号」。那就要在 route 里加一条路(没发票号 → draft),练习 3 会用到这个思路。

</details>

### 练习 2:看一眼队列里排了多少

写一个 `part07/queue_depth.py`,打印 arq 队列里正在排队的任务数。入队 5 张后运行它,再起 worker 清空后运行一次。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part07/queue_depth.py
import asyncio

from arq import create_pool

from part07.ticket_worker import REDIS


async def main():
    redis = await create_pool(REDIS)
    queued = await redis.zcard("arq:queue")  # arq 的队列是一个有序集合,按「什么时候该执行」排序
    print(f"排队中 {queued} 个任务")
    await redis.aclose()


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `redis = await create_pool(REDIS)` arq 的 `create_pool` 返回的对象就是一个 Redis 客户端,可以直接调 Redis 命令。
- `queued = await redis.zcard("arq:queue")  # arq 的队列是一个有序集合,按「什么时候该执行」排序` `ZCARD` 返回有序集合里的元素个数。正文第六步实测 `arq:queue` 的类型是 `zset`,用 `LLEN` 会报 `WRONGTYPE`。
- `await redis.aclose()` 用完关掉连接。

</div>

```bash
uv run python -m part07.queue_depth
uv run python -m part07.ticket_intake Q 5
uv run python -m part07.queue_depth
uv run arq --burst part07.ticket_worker.WorkerSettings
uv run python -m part07.queue_depth
```

```text
排队中 0 个任务
Q-01 入队
Q-02 入队
Q-03 入队
Q-04 入队
Q-05 入队
排队中 5 个任务
...
排队中 0 个任务
```

注意它数的是「排队中」的,包括 `Retry(defer=8)` 那种「8 秒后才执行」的任务(它们也在这个有序集合里,只是分数在未来),不包括正在执行的。要做扩缩容指标的话,这个数就是你要暴露出去的东西。

</details>

### 练习 3:没写发票号的工单不转人工,改成追问

把练习 1 那种工单改成:不转人工,直接起草一句请客户补充发票号的回复。要求只改 `ticket_agent.py`,改完用一张新工单验证。

<details><summary>参考答案</summary>

思路是在 classify 之后的路由里多看一眼正文:billing 但没有发票号,就跳过查发票和退款,直接去 draft;draft 看到「缺发票号」这条事实,就会去追问。改两处:

```python
# agent-zero-lab/part07/ticket_agent.py(只列出改动的两个函数)
def facts_for_model(state: TicketState) -> dict[str, str]:
    facts = {"分类": state.get("category", "other")}
    if state.get("category") == "billing" and "invoice" not in state:
        facts["缺少信息"] = "工单里没有发票号,请客户提供 INV- 开头的发票号"
    if "invoice" in state:
        inv = state["invoice"]
        facts["发票"] = f"{inv['id']},金额 {inv['amount_cents'] / 100:.2f} 元"
    if "refund" in state:
        facts["退款申请"] = f"已提交,单号 {state['refund']['refund_id']},等主管审批,批准前不会到账"
    return facts


    def route(state: TicketState) -> Literal["lookup_invoice", "draft"]:
        has_invoice_no = re.search(r"INV-\d+", state["text"]) is not None
        return "lookup_invoice" if state.get("category") == "billing" and has_invoice_no else "draft"
```

<div class="line-notes">

- `if state.get("category") == "billing" and "invoice" not in state:` billing 工单走到 draft 却没有发票,只可能是路由跳过了查发票。
- `facts["缺少信息"] = "工单里没有发票号,请客户提供 INV- 开头的发票号"` 告诉模型缺什么,让它去追问,而不是让它猜。
- `has_invoice_no = re.search(r"INV-\d+", state["text"]) is not None` 和 lookup_invoice 里同一个正则。`is not None` 把匹配结果变成布尔值。
- `return "lookup_invoice" if state.get("category") == "billing" and has_invoice_no else "draft"` 两个条件都满足才去查发票。

</div>

`route` 在 `build_graph` 里面,所以有缩进。改完用新工单验证(旧的 N-01 已经有一份失败的进度,换个工单号最干净):

```bash
psql -d agentzero_w56 -c "INSERT INTO tickets (id, customer_id, text) VALUES ('N-02', 'C007', '我上个月被多扣了一笔钱,麻烦查一下')"
uv run python -m part07.reenqueue N-02
uv run arq --burst part07.ticket_worker.WorkerSettings
psql -d agentzero_w56 -Atc "select agent_status, agent_draft from tickets where id='N-02'"
```

```text
入队
[N-02] try 1 resume=False
19:18:09:   1.81s ← manual-N-02:process_ticket ● 'draft_ready'
draft_ready|您好，关于多扣款的问题，需要您提供以 INV- 开头的发票号，以便我们核查。请补充后回复，谢谢。
```

这次是 `draft_ready`,草稿在追问发票号,一共只调了两次模型、没碰发票表。如果你看到的还是 `needs_human`,检查一下是不是还在用旧的 worker 进程(改了代码要重启 worker 才生效,这也是发版要重启的原因)。做完这题记得把 `ticket_agent.py` 改回正文的版本,Day 396 会在正文版本上继续改。

</details>

### 练习 4:算一算你的配置

你的服务平时每小时进 300 张工单,但每月 1 号上午会在 10 分钟内涌进 3000 张。每张约 2.1 秒、调 2 次模型,每个 worker `max_jobs=4`。用 `workers_needed` 算:平时要几个 worker?月初想在 10 分钟内清完要几个?模型并发会不会超 DeepSeek flash 的 2500?

<details><summary>参考答案</summary>

```bash
uv run python -c "from part07.how_many_workers import workers_needed as w; print(w(300, 2.1, 4, 3600, 2)); print(w(3000, 2.1, 4, 600, 2))"
```

```text
{'slots': 1, 'workers': 1, 'max_model_concurrency': 1, 'model_rpm': 57}
{'slots': 11, 'workers': 3, 'max_model_concurrency': 11, 'model_rpm': 629}
```

平时 1 个 worker 就够(但为了「一个挂了还有别的」,线上至少开 2 个);月初 3 个,并发 11,离 2500 很远。结论是这个规模根本不用担心厂商限流,真正要担心的是数据库连接池和成本。`python -c` 后面直接跟一段代码执行,适合这种一次性的计算,`import ... as w` 是给函数起个短名字。

</details>

**验收标准**:能跑出 W 批次四张工单的三种结果(两张 `draft_ready` 带退款单号、一张技术问题 `draft_ready`、一张 `needs_human`);能复现进程崩溃后 `job_timeout + 10` 秒被接手且 `resume=True`;能复现模型连不上时重试两次后转人工;能说清 `already_done` 和 job id 去重各挡什么;能复现默认 SIGTERM 取消任务、`job_completion_wait` 足够时任务做完再退出。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| worker | 专门从队列取任务来执行的独立进程,和接请求的 API 进程分开部署 |
| `max_jobs` | arq 配置:一个 worker 进程同时执行几个任务。I/O 密集的任务调大几乎线性变快 |
| 水平扩容 | 加更多同样的进程或机器来分担工作,而不是换一台更强的机器(那叫垂直扩容) |
| I/O 密集型 | 大部分时间在等网络、磁盘、数据库返回,CPU 闲着的任务。Agent 任务基本都是 |
| `needs_human` | 我们定的工单状态:Agent 处理不了,转给人工。是死信队列的业务版本 |
| SIGTERM / SIGKILL | 操作系统发给进程的两种信号。SIGTERM 是「请退出」,进程可以收尾;SIGKILL 是强杀,进程什么都来不及做 |
| 宽限期 | 容器平台发出 SIGTERM 后等进程自己退出的时间,超时就发 SIGKILL。Kubernetes 默认 30 秒 |
| 优雅退出 | 收到退出信号后先停止领新活,把手上的做完或安全放回,再退出 |
| `job_completion_wait` | arq 配置:收到 SIGTERM/SIGINT 后最多等多少秒让手上的任务做完,默认 0(立刻取消) |
| KEDA | 一个让 Kubernetes 按外部指标(队列长度等)自动增减副本数的开源组件 |
| 有序集合(zset) | Redis 的一种数据结构,每个元素带一个分数并按分数排序。arq 用它存队列,分数是计划执行时间 |
| 并发限制 | 厂商限制同一账号同时在途的请求数。DeepSeek flash 是 2500,超了返回 429 |

## 常见误区

**以为任务 `return "needs_human"` 和 `raise` 一个异常是一回事。** `raise` 普通异常,arq 会把任务记成失败(`max_tries` 没用完时它还会按自己的规则再执行);`raise Retry` 是明确要求重试;`return` 是任务成功完成。业务失败(转人工)用 `return`,并且在工单表里写清楚原因,否则工单会卡在 `processing`,永远没人知道它失败了。

**只靠 arq 的 job id 去重。** job id 只挡「同一个任务推两次」。有人在后台点「重新处理」、或者换了个 job id 前缀重推,arq 会认为是新任务。正文第四步实测 `manual-T-01` 照样被执行了,是 worker 里的 `already_done` 判断才没让它重调模型。

**把工单正文塞进队列参数。** Redis 里每个任务都要存一份参数,正文长、积压多的时候很占内存;而且客户改了正文,重试时还是用的旧的。只传工单号,正文在任务里现读。

**`max_jobs` 开到几百。** 先撞上的是连接池(psycopg-pool 默认最多 4 个连接)和厂商限流,不是你的 CPU。扩容前先算「同时多少个模型请求在途」,用正文的 `workers_needed` 算一遍。

**用 KEDA 的 Redis 列表触发器给 arq 扩容。** arq 的 `arq:queue` 是有序集合,实测 `LLEN` 报 `WRONGTYPE`。要自己用 `ZCARD` 暴露指标。

**默认配置就上线。** arq 默认 `job_completion_wait=0`,每次发版都会把手上的任务取消掉重来;平台宽限期比任务短的话,任务还会卡到 `job_timeout + 10` 秒后才被接手。按「任务 P95 < `job_completion_wait` < 宽限期」来配。

**改了代码不重启 worker。** worker 是常驻进程,代码在启动时就加载好了。改完 `ticket_agent.py` 不重启,跑的还是旧逻辑。我做练习 3 时第一反应就是「怎么没生效」。

**相信模型会严格遵守「事实里没有的不要承诺」。** 正文 W-03 的草稿里出现了事实里没有的「建议刷新重试」,另一次实跑还写了「已转交技术团队」。回复要当草稿,由人确认后再发,或者用第六部分的评测去量化它出错的比例。

## 学习资料

### 文档与文章

- [arq 官方文档](https://arq-docs.helpmanual.io/):看 Worker 和 `job_completion_wait` 相关的参数说明,对照今天第七步的实验。英文,20 分钟。
- [Kubernetes 文档 · Pod 的终止](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination):讲清楚 SIGTERM、宽限期、SIGKILL 的顺序和默认 30 秒。页面有中文版(右上角切语言)。15 分钟。
- [KEDA · Redis Lists 触发器](https://keda.sh/docs/latest/scalers/redis-lists/):看它的配置项是 `listName`,就明白为什么不能直接给 arq 用。10 分钟。
- [DeepSeek API 文档 · 限速](https://api-docs.deepseek.com/zh-cn/quick_start/rate_limit):按账号并发限流的规则,flash 2500、pro 500,超了 429。中文,5 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1jg4y13718&autoplay=0&high_quality=1" title="快速搞定---异步框架celery" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>武沛齐讲技术 · 快速搞定---异步框架celery · 7 个分 P 共约 2 小时。Celery 是 Python 最常用的任务队列,概念(broker、worker、并发数、重试)和 arq 一一对应。先看前两 P,把「生产者、队列、worker」这套结构再过一遍。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1dV4y1V798&autoplay=0&high_quality=1" title="【CNCF 项目介绍】KEDA - Kubernetes 事件驱动的自动水平扩缩" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>成富_Alex · 【CNCF 项目介绍】KEDA - Kubernetes 事件驱动的自动水平扩缩 · 不到 5 分钟。知道 KEDA 是干什么的、为什么能按队列长度扩缩就够了。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/tD5qMeCeWVM" title="Scheduling and scaling long running tasks in Kubernetes with KEDA" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Robusta · Scheduling and scaling long running tasks in Kubernetes with KEDA · 英文。专门讲长任务的扩缩容,缩容时怎么不杀掉正在跑的任务,正好接今天第七步。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Au1vv9r8UlU" title="Kubernetes Pod Lifecycle: How To Actually Enable Graceful Shutdown" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>TheCodeAlchemist · Kubernetes Pod Lifecycle: How To Actually Enable Graceful Shutdown · 英文。把 SIGTERM、宽限期、SIGKILL 的时间线讲得很直观,看完再回头看第七步那张图。</figcaption>
</figure>

### 书籍

- 《Release It! Design and Deploy Production-Ready Software》第二版,Michael T. Nygard,Pragmatic Bookshelf,2018。讲生产系统怎么死、怎么扛,超时、断路器、隔舱这些模式的出处。英文原版,我没查到确定的简体中文版信息。今天先翻「Stability Patterns」那部分。

### 开源项目与代码

- [python-arq/arq](https://github.com/python-arq/arq):`arq/worker.py` 里搜 `handle_sig_wait_for_completion`,就是第七步那几行日志的来源;搜 `allow_pick_jobs` 看它怎么停止领新任务。
- [kedacore/keda](https://github.com/kedacore/keda):KEDA 源码,`pkg/scalers/` 目录下每种触发器一个文件,看看有哪些现成的。

## 自测

1. worker 在 `submit_refund` 节点里建完退款、还没返回时被 kill。下一个 worker 接手后,退款会不会建两条?模型会被调几次?

<details><summary>答案</summary>

退款不会建两条:submit_refund 会整个重跑,`create_refund_request` 被调第二次,但幂等键(工单号 + 发票号)一样,数据库唯一约束挡住,返回原来那条(Day 393 第五步实测过 `deduplicated: True`)。模型:classify 已经完整跑完、checkpoint 里有结果,不重调;接手后还要跑 draft,调 1 次。所以整张工单总共调了 2 次模型,和没崩一样。

</details>

2. 为什么 `process_ticket` 失败转人工时用 `return "needs_human"`,而不是 `raise`?

<details><summary>答案</summary>

`raise` 普通异常会让 arq 把任务记成失败,还可能在 `max_tries` 内重新执行;转人工是业务上的结论,不需要 arq 再做任何事。`return` 让任务正常结束,失败原因通过工单表的 `agent_status` 和 `agent_note` 表达,坐席能看到。

</details>

3. 正文模型连不上的实验里,第 2 次执行打印了 `resume=True`,可 classify 一次都没成功。为什么?

<details><summary>答案</summary>

图收到输入时就写了 step -1 和 step 0 两个 checkpoint,此时 `next=('classify',)`。所以第二次执行 `aget_state` 看到「有进度、有下一步」,输入传 None 续跑,从 classify 开始,和从头跑结果一样。

</details>

4. 一个 worker 进程 `max_jobs=4` 和两个进程各 `max_jobs=2`,实测速度差不多。那什么时候应该选多进程?

<details><summary>答案</summary>

三种情况:任务里有吃 CPU 的部分(一个进程只能用一个核);要容错(一个进程挂了其他还在干活);一台机器不够,要跨机器扩容。我们的任务是 I/O 密集型,单进程开并发就够快,但线上至少开 2 个进程做容错。

</details>

5. (面试题)你们的 Agent worker 跑在 Kubernetes 上,每张工单平均 20 秒、P95 45 秒,每天发版两次。怎么保证发版不丢任务、不重复执行副作用,也不浪费太多模型调用?

<details><summary>答案</summary>

参考答法:三层。第一层是优雅退出:arq 设 `job_completion_wait=60`(盖住 P95 的 45 秒),Pod 的 `terminationGracePeriodSeconds` 设 90,比它长,保证 arq 有时间等完或主动取消放回队列,不会被 SIGKILL;滚动发布时新 Pod 先起来再停旧的。第二层是断点续跑:图用 Postgres checkpointer、`durability="sync"`、thread_id 由工单号决定,被取消或被杀的任务重新执行时 `aget_state` 有进度就传 None,已经完成的模型调用不重做。第三层是幂等:崩在中间的那个节点一定会重跑,所以每个写操作(建退款、发邮件)带业务幂等键,数据库唯一约束去重。另外要监控 `processing` 状态停留超过 `job_timeout` 的工单数,那是 worker 被强杀、任务等着过期的信号。超过几分钟的长任务不要靠等它跑完,靠续跑和幂等让「被取消」变得无所谓。

</details>

## 明天预告

Day 395 · Temporal 和持久化执行。今天的 worker 用 arq、LangGraph checkpoint、幂等键三样东西拼出了「崩了能接着跑」,每一样都要自己配、自己测。Temporal 把这件事做成了一个平台:你写普通的代码,它记下每一步的结果,进程崩了换个 worker 重放历史接着跑。明天在本机起一个 Temporal 开发服务器,把今天的工单流程改写成 Temporal workflow,用同样的崩溃实验对比两种做法。
