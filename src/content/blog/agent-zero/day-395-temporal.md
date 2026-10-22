---
title: 'Day 395 · Temporal 和持久化执行'
description: '在本机起一个 Temporal 开发服务器,把昨天的工单流程改写成 workflow 加 activity,用同样的崩溃实验看它怎么靠事件历史重放接着跑;再亲手撞一次它最出名的两条规矩:workflow 里不能读系统时间,改了代码顺序旧的执行就重放不过去。最后和 arq + LangGraph checkpoint 那套做法对比,说清什么时候值得换。'
pubDate: 2026-10-22
regime: none
tags: ['temporal', 'durable-execution', 'reliability', 'agent-zero']
series: 'agent-zero'
day: 395
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 394](/blog/agent-zero/day-394-ticket-worker/) 把一周的零件拼成了一个完整的工单 worker:arq 负责排队和重试,LangGraph 的 Postgres checkpoint 负责断点续跑,幂等键负责「崩在中间的那一步重跑也不出事」,再加上 `needs_human`、`already_done`、优雅退出。它能用,但你也看到了,每一样都要自己配、自己测、自己记住坑:输入要传 None、thread_id 不能混随机数、`job_timeout + 10` 秒才接手、SIGTERM 默认取消任务。今天看另一条路:Temporal 把「崩了能接着跑」做成了平台本身的能力,你写普通的异步代码就行。面试里聊到长任务,「你知道 Temporal 吗」几乎是必问题。

## 今天要解决的问题

今天结束时你应该能:

1. 说清 Temporal 的 workflow、activity、事件历史、重放这四个词各是什么,和昨天 arq + checkpoint 的哪一块对应。
2. 在本机起 Temporal 开发服务器,把工单流程写成一个 workflow 加三个 activity 并跑通,用 `temporal workflow show` 读懂它的事件历史。
3. 用崩溃实验证明:worker 被 kill 后,已经完成的 activity(包括调模型那一步)不会重跑,崩在中间的那个 activity 会重试,所以 activity 也要幂等。
4. 亲手触发两种「确定性」错误:workflow 里读系统时间被沙箱拦下;改了 activity 顺序后重放旧历史报 `NondeterminismError`。知道为什么有这条规矩。

预计用时 3 小时。前置:[Day 389](/blog/agent-zero/day-389-retry-errors/) 的错误分类、[Day 390](/blog/agent-zero/day-390-idempotency/) 的幂等、[Day 393](/blog/agent-zero/day-393-resume/) 的断点续跑、[Day 394](/blog/agent-zero/day-394-ticket-worker/) 的 `ticket_agent.py`、`tickets.sql` 和工单 worker。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先从前端看:Redux DevTools 的「重放」

用过 Redux DevTools 的话,你见过这个功能:左边是一串 action(`ADD_TODO`、`TOGGLE_TODO`……),你可以拖动时间轴,页面状态就跳回到某一步。它为什么能做到?因为 Redux 的状态本来就是「初始状态 + 按顺序把所有 action 喂给 reducer」算出来的。只要 action 列表在,状态随时能重新算出来,不用把状态本身存下来。

这个前提是 reducer 必须是**纯函数**:同样的状态加同样的 action,永远得到同样的结果。你要是在 reducer 里写了 `Date.now()` 或者 `Math.random()`,重放一次结果就变了,时间旅行就不准了。Redux 官方文档里「reducer 不能有副作用」那条规矩,说的就是这个。

Temporal 是把同一个思路用在了服务端的长流程上:

- 你的流程代码叫 **workflow**,相当于 reducer,必须是确定的;
- 流程里会碰外部世界的每一步(调模型、查库、建退款)叫 **activity**,它的结果会被记下来,相当于 action;
- Temporal 服务器给每个 workflow 存一份**事件历史**:「第 5 号事件:调度了 classify;第 7 号事件:classify 完成,结果是 billing」;
- worker 崩了,换一个 worker 拿到这份历史,从头把 workflow 代码再跑一遍,这叫**重放**。重放时遇到 `classify` 这一步,不真的去调模型,而是直接从历史里取出上次的结果 `billing`;一直重放到历史的末尾,再往下才是真的执行。

这就是 **durable execution(持久化执行)**:代码看起来是一段普通的、从上往下执行的函数,但它的每一步进度都在服务器上,进程死了换一个接着走,对代码来说就像从没死过。

<figure>
<svg viewBox="0 0 640 290" role="img" aria-label="Temporal 的结构:Temporal 服务器保存每个 workflow 的事件历史和任务队列;worker 进程里跑 workflow 代码和 activity 代码;workflow 代码只做编排,通过服务器调度 activity;activity 才去碰模型和数据库;worker 崩了以后,新 worker 拿到事件历史重放 workflow 代码">
<rect x="20" y="20" width="250" height="250" rx="8" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="36" y="44" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Temporal 服务器</text>
<rect x="36" y="60" width="218" height="130" rx="5" fill="var(--paper-raised)" stroke="var(--ink-faint)"/>
<text x="48" y="80" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">事件历史 ticket-T6002</text>
<text x="48" y="102" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">1  WorkflowExecutionStarted</text>
<text x="48" y="120" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">5  ActivityScheduled classify</text>
<text x="48" y="138" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">7  ActivityCompleted "billing"</text>
<text x="48" y="156" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">11 ActivityScheduled lookup</text>
<text x="48" y="174" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">…</text>
<rect x="36" y="204" width="218" height="50" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="48" y="226" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">任务队列 "tickets"</text>
<text x="48" y="244" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">workflow 任务 / activity 任务</text>
<rect x="330" y="20" width="290" height="250" rx="8" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="346" y="44" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">worker 进程(你的代码)</text>
<rect x="346" y="60" width="258" height="80" rx="5" fill="var(--paper-raised)" stroke="var(--mem)"/>
<text x="358" y="82" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">TicketWorkflow.run</text>
<text x="358" y="102" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">只编排:先 A 再 B,if/else</text>
<text x="358" y="122" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">必须确定,可被重放</text>
<rect x="346" y="160" width="258" height="94" rx="5" fill="var(--paper-raised)" stroke="var(--compute)"/>
<text x="358" y="182" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">activities</text>
<text x="358" y="202" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">classify → 调模型</text>
<text x="358" y="220" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">lookup_invoice → 查库</text>
<text x="358" y="238" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">submit_refund → 写库(要幂等)</text>
<line x1="270" y1="229" x2="330" y2="229" stroke="var(--ink-soft)" stroke-width="1.5"/>
<line x1="270" y1="100" x2="346" y2="100" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
</svg>
<figcaption>Temporal 里有两种代码。workflow 只管编排,每次被唤醒都可能是从头重放;activity 才真正碰外部世界,结果会写进服务器的事件历史。worker 只是来领任务的打工进程,死了换一个,进度都在服务器那边。</figcaption>
</figure>

和昨天的做法放在一起看:

| 昨天的 arq + LangGraph | Temporal | 说明 |
| --- | --- | --- |
| Redis 队列 | Temporal 服务器的任务队列 | 都是「worker 来领活」 |
| LangGraph 节点 | activity | 一个会碰外部世界的步骤 |
| 图的边、`route` | workflow 代码里的 `await`、`if` | 编排逻辑 |
| checkpoint 表(存整个 State 的快照) | 事件历史(存每一步的输入输出) | 进度存在哪 |
| 续跑:`aget_state` + 输入传 None | 重放:自动的,你什么都不用写 | 怎么接着跑 |
| `Retry(defer=...)`、`max_tries` | activity 的 `RetryPolicy` | 重试策略 |
| `job_timeout` | activity 的 `start_to_close_timeout` | 一步最多跑多久 |
| 幂等键 | 幂等键(还是要) | 崩在中间的那一步会重做 |

最后一行是今天要亲手验证的:Temporal 再厉害,也替你解决不了「activity 做到一半崩了」这件事。

## 准备环境

**装 Temporal CLI。** 它是一个单独的命令行程序,里面带了一个开发用的 Temporal 服务器。macOS 上用 Homebrew 最省事:

```bash
brew install temporal
temporal --version
```

```text
temporal version 1.9.1 (Server 1.32.0, UI 2.54.1)
```

我实跑的是 1.9.1,2026 年 10 月在 GitHub 的 temporalio/cli 发布页查到的最新版,Homebrew 上也是这个版本。不想用 Homebrew 的话,官方提供了直接下载的压缩包(macOS Intel 芯片的地址是 `https://temporal.download/cli/archive/latest?platform=darwin&arch=amd64`,M 系列芯片把 `amd64` 换成 `arm64`),解压出来一个 `temporal` 文件,放到 PATH 里就行。我写这一课时就是这么装在练习目录里的,没有往系统里装。

**起开发服务器。** 新开一个终端(终端 A),在 `agent-zero-lab` 目录下:

```bash
cd agent-zero-lab
temporal server start-dev --db-filename temporal.db
```

```text
Temporal CLI 1.9.1 (Server 1.32.0, UI 2.54.1)

Temporal Server:      localhost:7394
Temporal Persistence: temporal.db
Temporal UI:          http://localhost:8394
Temporal Metrics:     http://localhost:60456/metrics
```

(这是我实跑的原样输出。本机上同时还有别的实验占着默认端口,所以我多加了 `--port 7394 --ui-port 8394`。你不加这两个参数,看到的就是默认的 `localhost:7233` 和 `http://localhost:8233`。)

`start-dev` 是一个「全家桶」开发服务器:服务器、Web 界面、一个 SQLite 数据库都在一个进程里。`--db-filename temporal.db` 让数据存在文件里,不加的话关掉服务器历史就全没了。7233 是 worker 和客户端连的端口,8233 是 Web 界面,浏览器打开就能看到所有 workflow 和每一条的事件历史。这个终端就让它一直开着。

(后面的输出里不再出现端口号,用哪个都不影响。另外本机开了代理时 Temporal CLI 连 `localhost` 偶尔会超时,换成 `127.0.0.1:7233` 就好了,下面的脚本都支持用环境变量 `TEMPORAL_ADDRESS` 改地址。)

**装 Python SDK。** 回到原来的终端(终端 B):

```bash
cd agent-zero-lab
uv add temporalio
```

我装到的是 temporalio 1.34.0(2026 年 10 月 PyPI 最新)。数据库和昨天一样用 `agentzero_w56`,发票表、退款表、Day 394 的 `ticket_agent.py` 都要在。

## 第一步:activity,碰外部世界的那几步

先写 activity。它们就是昨天图里的三个节点,只是换了个装法:用 `@activity.defn` 标记,输入输出都要能转成 JSON(Temporal 要把它们存进事件历史)。

```python
# agent-zero-lab/part07/temporal_acts.py
import re

from psycopg_pool import AsyncConnectionPool
from temporalio import activity
from temporalio.exceptions import ApplicationError

from part07.ticket_agent import ask
from part07.ticket_graph import maybe_crash
from part07.tools_refund import create_refund_request


class TicketActivities:
    def __init__(self, pool: AsyncConnectionPool):
        self.pool = pool

    @activity.defn
    async def classify(self, text: str) -> str:
        info = activity.info()
        print(f"  classify 第 {info.attempt} 次,调模型", flush=True)
        word = await ask(f"把工单分成 billing/tech/other 之一,只回一个词:{text}", 5)
        return word if word in ("billing", "tech", "other") else "other"

    @activity.defn
    async def lookup_invoice(self, text: str) -> dict[str, int | str]:
        print(f"  lookup_invoice 第 {activity.info().attempt} 次", flush=True)
        m = re.search(r"INV-\d+", text)
        if m is None:
            raise ApplicationError("工单里没写发票号", type="PermanentError")
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT id, amount_cents FROM invoices WHERE id = %s", (m.group(),))
            row = await cur.fetchone()
        if row is None:
            raise ApplicationError(f"发票 {m.group()} 不存在", type="PermanentError")
        maybe_crash("lookup_invoice")
        return {"id": row[0], "amount_cents": row[1]}

    @activity.defn
    async def submit_refund(self, ticket_id: str, invoice_id: str, amount_cents: int) -> str:
        r = await create_refund_request(self.pool, ticket_id=ticket_id, invoice_id=invoice_id, amount_cents=amount_cents)
        print(f"  submit_refund 第 {activity.info().attempt} 次 -> {r}", flush=True)
        maybe_crash("submit_refund")
        return r["refund_id"]
```

<div class="line-notes">

- `from temporalio import activity` activity 相关的装饰器和工具函数都在这里。
- `from temporalio.exceptions import ApplicationError` 业务错误要用这个类抛,`type=` 参数给它起个类型名,重试策略按这个名字决定重不重试。
- `from part07.ticket_agent import ask` 直接复用 Day 394 调模型的函数,模型层的超时(30 秒乘 3 次)也跟着来了。
- `from part07.ticket_graph import maybe_crash` 还是 Day 393 的自毁开关,今天用它做同样的崩溃实验。
- `class TicketActivities:` activity 写成一个类的方法,是为了共享一个数据库连接池。也可以写成普通函数,但那样每个函数都要自己找连接池。
- `def __init__(self, pool: AsyncConnectionPool):` 构造函数,相当于 JS class 的 `constructor`。`self` 相当于 `this`,Python 要显式写出来。
- `@activity.defn` 告诉 Temporal「这是一个 activity」,它的名字默认就是方法名 `classify`。事件历史里记的就是这个名字。
- `info = activity.info()` 当前这次执行的信息,在 activity 里随时能拿到。
- `print(f"  classify 第 {info.attempt} 次,调模型", flush=True)` `attempt` 是第几次尝试,从 1 开始。数这一行出现几次,就知道模型被调了几次。
- `return word if word in ("billing", "tech", "other") else "other"` 和 Day 394 一样,模型输出不在白名单里就当 other。
- `async def lookup_invoice(self, text: str) -> dict[str, int | str]:` 返回发票的 id 和金额。返回值会被转成 JSON 存进事件历史,所以只能是字典、列表、字符串、数字这些。
- `raise ApplicationError("工单里没写发票号", type="PermanentError")` 对应 Day 394 的 `PermanentError`。下面 workflow 的重试策略里会写「类型是 PermanentError 的不重试」。
- `raise ApplicationError(f"发票 {m.group()} 不存在", type="PermanentError")` 同上,发票不存在重试也没用。
- `maybe_crash("lookup_invoice")` 崩溃实验的埋点:查完了、还没返回。
- `async def submit_refund(self, ticket_id: str, invoice_id: str, amount_cents: int) -> str:` 有三个参数,调度它时要用 `args=[...]` 按顺序传。
- `r = await create_refund_request(self.pool, ticket_id=ticket_id, invoice_id=invoice_id, amount_cents=amount_cents)` Day 391 的幂等写库函数。第四步会看到它为什么在 Temporal 里也少不了。
- `maybe_crash("submit_refund")` 第二个埋点:退款已经写进库、activity 还没返回,最难处理的时机。

</div>

## 第二步:workflow,只管编排

workflow 是流程本身:先分类,不是 billing 就结束;是 billing 就查发票、建退款。注意它**一行都不碰外部世界**,所有外部操作都通过 `execute_activity_method` 交给服务器去调度。

```python
# agent-zero-lab/part07/temporal_ticket.py
from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from part07.temporal_acts import TicketActivities

TIMEOUT = timedelta(seconds=10)
RETRY = RetryPolicy(maximum_attempts=3, non_retryable_error_types=["PermanentError"])


@workflow.defn
class TicketWorkflow:
    @workflow.run
    async def run(self, ticket_id: str, text: str) -> str:
        category = await workflow.execute_activity_method(
            TicketActivities.classify, text, start_to_close_timeout=TIMEOUT, retry_policy=RETRY
        )
        if category != "billing":
            return f"{ticket_id}: {category},转给对应的组"
        invoice = await workflow.execute_activity_method(
            TicketActivities.lookup_invoice, text, start_to_close_timeout=TIMEOUT, retry_policy=RETRY
        )
        refund_id = await workflow.execute_activity_method(
            TicketActivities.submit_refund,
            args=[ticket_id, invoice["id"], invoice["amount_cents"]],
            start_to_close_timeout=TIMEOUT,
            retry_policy=RETRY,
        )
        return f"{ticket_id}: 退款 {refund_id} 待审批"
```

<div class="line-notes">

- `from datetime import timedelta` 表示一段时长,`timedelta(seconds=10)` 就是 10 秒。Temporal 的超时参数都要这个类型。
- `from temporalio.common import RetryPolicy` 重试策略,相当于把 Day 389 和 Day 394 里手写的重试逻辑变成了一个配置对象。
- `with workflow.unsafe.imports_passed_through():` Temporal 的 Python SDK 会把 workflow 代码放在一个沙箱里跑,沙箱会重新导入 workflow 用到的模块,以便拦截不确定的操作。这一行的意思是「这些导入不用沙箱重新导入,直接用外面那份」。activity 的模块里有 openai、psycopg 这些很重的库,不放行的话沙箱会去重新导入它们,又慢又容易出问题。名字里带 `unsafe` 是在提醒你:放行进来的东西,你自己保证在 workflow 里不会用它做不确定的事。
- `TIMEOUT = timedelta(seconds=10)` 每个 activity 单次尝试最多 10 秒。第三步会看到,worker 崩了以后,Temporal 就是靠这个超时发现「这次尝试没下文了」。
- `RETRY = RetryPolicy(maximum_attempts=3, non_retryable_error_types=["PermanentError"])` 最多试 3 次;`type` 是 `PermanentError` 的 `ApplicationError` 不重试。没写的参数用默认值:第一次重试等 1 秒,之后每次翻倍。
- `@workflow.defn` 标记这是一个 workflow 类。
- `@workflow.run` 标记入口方法,一个 workflow 类只能有一个。它的参数就是启动 workflow 时传的参数。
- `category = await workflow.execute_activity_method(` 调度一个 activity 并等它的结果。注意它不是直接调用 `classify`:这一行做的事是请服务器「安排一次 classify」,然后等服务器通知结果。重放时,这一行会直接从历史里拿到上次的结果。
- `TicketActivities.classify, text, start_to_close_timeout=TIMEOUT, retry_policy=RETRY` 第一个参数是方法本身(用类名点出来,不需要对象),第二个是唯一的参数。`start_to_close_timeout` 必须给,不给会报错。
- `if category != "billing":` workflow 里可以有普通的 `if`、`for`。只要分支条件来自 activity 的结果或者 workflow 的参数,重放时走的路就一样。
- `return f"{ticket_id}: {category},转给对应的组"` 非 billing 直接结束。今天为了聚焦 Temporal 本身,没有把 draft 那一步搬过来,练习 3 会补上。
- `args=[ticket_id, invoice["id"], invoice["amount_cents"]],` 多个参数用 `args` 列表按顺序传。

</div>

## 第三步:worker 和启动脚本,跑通一张工单

worker 进程负责连上服务器,声明「我能跑 TicketWorkflow 和这三个 activity」,然后去 `tickets` 这个任务队列领活:

```python
# agent-zero-lab/part07/temporal_worker.py
import asyncio
import os

from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool
from temporalio.client import Client
from temporalio.worker import Worker

from part07.temporal_acts import TicketActivities
from part07.temporal_ticket import TicketWorkflow

ADDRESS = os.getenv("TEMPORAL_ADDRESS", "localhost:7233")
DSN = os.getenv("PG_DSN", "postgresql://localhost/agentzero_w56")


async def main():
    client = await Client.connect(ADDRESS)
    async with AsyncConnectionPool(DSN, connection_class=AsyncConnection, kwargs={"autocommit": True}) as pool:
        acts = TicketActivities(pool)
        worker = Worker(
            client,
            task_queue="tickets",
            workflows=[TicketWorkflow],
            activities=[acts.classify, acts.lookup_invoice, acts.submit_refund],
        )
        print("worker 启动,等活", flush=True)
        await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `from temporalio.client import Client` 客户端,worker 和启动脚本都用它连服务器。
- `from temporalio.worker import Worker` worker 类,相当于 arq 的 `WorkerSettings` 加上 `arq` 命令。
- `ADDRESS = os.getenv("TEMPORAL_ADDRESS", "localhost:7233")` 服务器地址,默认就是 `start-dev` 打印的那个端口。
- `client = await Client.connect(ADDRESS)` 连上服务器。服务器没起的话这一行会报连接错误。
- `async with AsyncConnectionPool(DSN, connection_class=AsyncConnection, kwargs={"autocommit": True}) as pool:` 用 `async with` 打开连接池,worker 退出时自动关。
- `acts = TicketActivities(pool)` 建一个 activity 对象,三个 activity 共用这个池子。
- `task_queue="tickets",` 去哪个任务队列领活。启动 workflow 时指定的队列名必须和这里一样,否则 workflow 会一直等,没有 worker 来领。
- `workflows=[TicketWorkflow],` 这个 worker 能跑哪些 workflow。传的是类。
- `activities=[acts.classify, acts.lookup_invoice, acts.submit_refund],` 能跑哪些 activity。传的是绑定在 `acts` 对象上的方法,这样调用时 `self.pool` 才有值。
- `await worker.run()` 一直运行,直到进程被停掉。

</div>

启动脚本相当于 Day 394 的 `ticket_intake.py`,它只是请服务器「开一个 workflow」,然后等结果:

```python
# agent-zero-lab/part07/temporal_start.py
import asyncio
import os
import sys

from temporalio.client import Client

from part07.temporal_ticket import TicketWorkflow

ADDRESS = os.getenv("TEMPORAL_ADDRESS", "localhost:7233")


async def main(ticket_id: str, text: str):
    client = await Client.connect(ADDRESS)
    handle = await client.start_workflow(
        TicketWorkflow.run, args=[ticket_id, text], id=f"ticket-{ticket_id}", task_queue="tickets"
    )
    print(f"已启动 workflow {handle.id},等结果……", flush=True)
    print(await handle.result())


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], sys.argv[2]))
```

<div class="line-notes">

- `handle = await client.start_workflow(` 请服务器开一个 workflow,马上返回一个句柄(handle),不等它跑完。
- `TicketWorkflow.run, args=[ticket_id, text], id=f"ticket-{ticket_id}", task_queue="tickets"` `id` 是 workflow id,由工单号决定,和 Day 394 的 job id、thread_id 是同一个思路。练习 2 会看到同一个 id 再启动一次会怎样。
- `print(await handle.result())` 等 workflow 结束,拿到 `run` 方法的返回值。workflow 失败的话这一行会抛 `WorkflowFailureError`。

</div>

开第三个终端(终端 C)起 worker,在终端 B 启动一张工单:

```bash
# 终端 C
uv run python -m part07.temporal_worker
```

```bash
# 终端 B
uv run python -m part07.temporal_start T6001 "10 月 8 号被扣了两次款,INV-0123 那笔麻烦退给我"
```

终端 B:

```text
已启动 workflow ticket-T6001,等结果……
T6001: 退款 R-8c4c5d2e 待审批
```

终端 C:

```text
worker 启动,等活
  classify 第 1 次,调模型
  lookup_invoice 第 1 次
  submit_refund 第 1 次 -> {'refund_id': 'R-8c4c5d2e', 'deduplicated': False}
```

跑通了。现在看服务器给这个 workflow 记了什么:

```bash
temporal workflow show -w ticket-T6001
```

```text
Progress:
  ID           Time                     Type
    1  2026-10-22T11:01:11Z  WorkflowExecutionStarted
    2  2026-10-22T11:01:11Z  WorkflowTaskScheduled
    3  2026-10-22T11:01:11Z  WorkflowTaskStarted
    4  2026-10-22T11:01:11Z  WorkflowTaskCompleted
    5  2026-10-22T11:01:11Z  ActivityTaskScheduled
    6  2026-10-22T11:01:11Z  ActivityTaskStarted
    7  2026-10-22T11:01:12Z  ActivityTaskCompleted
    8  2026-10-22T11:01:12Z  WorkflowTaskScheduled
    9  2026-10-22T11:01:12Z  WorkflowTaskStarted
   10  2026-10-22T11:01:12Z  WorkflowTaskCompleted
   11  2026-10-22T11:01:12Z  ActivityTaskScheduled
   12  2026-10-22T11:01:12Z  ActivityTaskStarted
   13  2026-10-22T11:01:12Z  ActivityTaskCompleted
   14  2026-10-22T11:01:12Z  WorkflowTaskScheduled
   15  2026-10-22T11:01:12Z  WorkflowTaskStarted
   16  2026-10-22T11:01:12Z  WorkflowTaskCompleted
   17  2026-10-22T11:01:12Z  ActivityTaskScheduled
   18  2026-10-22T11:01:12Z  ActivityTaskStarted
   19  2026-10-22T11:01:12Z  ActivityTaskCompleted
   20  2026-10-22T11:01:12Z  WorkflowTaskScheduled
   21  2026-10-22T11:01:12Z  WorkflowTaskStarted
   22  2026-10-22T11:01:12Z  WorkflowTaskCompleted
   23  2026-10-22T11:01:12Z  WorkflowExecutionCompleted

Results:
  Status          COMPLETED
  Result          "T6001: 退款 R-8c4c5d2e 待审批"
  ResultEncoding  json/plain
```

23 个事件,有规律:每四行一组。读法是这样的:

- **Workflow Task**(2–4、8–10、14–16、20–22):服务器叫 worker「把 workflow 代码往下跑,跑到下一个 `await` 停住,告诉我你要干什么」。worker 跑完一段,回报「我要调度 classify」,这就是第 4 号事件 `WorkflowTaskCompleted`,紧接着第 5 号 `ActivityTaskScheduled`。
- **Activity Task**(5–7、11–13、17–19):服务器把「执行 classify」放进任务队列,某个 worker 领走(`Started`),执行完回报结果(`Completed`,结果就存在这个事件里)。
- 三次 activity 对应 classify、lookup_invoice、submit_refund;最后一次 workflow task 发现 `run` 返回了,于是 `WorkflowExecutionCompleted`。

所以 workflow 代码不是一口气跑完的,而是**跑一段、停一下、等服务器叫醒、再跑一段**,一共被唤醒了 4 次。每次被唤醒,worker 并不需要记得上一次跑到哪:最极端的情况下它会从 `run` 的第一行开始重放,遇到已经有结果的 activity 就直接取结果,一路快进到最新的位置。这也是为什么 worker 可以随时死、随时换。

打开 `http://localhost:8233`,点进 `ticket-T6001`,能看到同样的历史,点开第 7 号事件,里面的 `result` 就是 `"billing"`。

## 第四步:崩在 lookup_invoice,换个 worker 接着跑

和 Day 393、394 一样的实验:让 worker 在 lookup_invoice 查完、还没返回时自杀。先在终端 C 按 Ctrl+C 停掉刚才的 worker,带上崩溃开关重新起:

```bash
# 终端 C
CRASH_AT=lookup_invoice uv run python -m part07.temporal_worker
```

```bash
# 终端 B
uv run python -m part07.temporal_start T6002 "INV-0456 是重复扣费,申请退款"
```

终端 C 的 worker 很快就死了:

```text
worker 启动,等活
  classify 第 1 次,调模型
  lookup_invoice 第 1 次
  !! 在 lookup_invoice 节点模拟进程被 kill
```

终端 B 还在 `等结果……`,它并不知道 worker 死了,也不需要知道。在终端 C 立刻起一个正常的 worker(`.crash_flag` 已经在了,不会再崩;我在每行前面加了时间):

```bash
# 终端 C
uv run python -m part07.temporal_worker
```

```text
19:02:01 worker 启动,等活
19:02:05   lookup_invoice 第 2 次
19:02:05   submit_refund 第 1 次 -> {'refund_id': 'R-8ee98e9e', 'deduplicated': False}
```

终端 B 随即打出结果:

```text
已启动 workflow ticket-T6002,等结果……
T6002: 退款 R-8ee98e9e 待审批
```

新 worker 上来以后,**没有打 `classify 第 N 次`**,模型没被再调;lookup_invoice 是「第 2 次」。最后用 `rm .crash_flag` 删掉标记文件。看一眼这次的事件历史,我用 `-o json` 把它导出来,只挑 activity 相关的行:

```bash
temporal workflow show -w ticket-T6002 -o json | python3 -c "
import json, sys
for e in json.load(sys.stdin)['events']:
    t = e['eventType'].replace('EVENT_TYPE_', '')
    if 'ACTIVITY' in t:
        name = e.get('activityTaskScheduledEventAttributes', {}).get('activityType', {}).get('name', '')
        attempt = e.get('activityTaskStartedEventAttributes', {}).get('attempt', '')
        print(e['eventId'], e['eventTime'][11:19], t, name, attempt)
"
```

```text
5 11:01:53 ACTIVITY_TASK_SCHEDULED classify
6 11:01:53 ACTIVITY_TASK_STARTED  1
7 11:01:54 ACTIVITY_TASK_COMPLETED
11 11:01:54 ACTIVITY_TASK_SCHEDULED lookup_invoice
12 11:02:05 ACTIVITY_TASK_STARTED  2
13 11:02:05 ACTIVITY_TASK_COMPLETED
17 11:02:05 ACTIVITY_TASK_SCHEDULED submit_refund
18 11:02:05 ACTIVITY_TASK_STARTED  1
19 11:02:05 ACTIVITY_TASK_COMPLETED
```

(那段 `python3 -c "..."` 是一小段临时脚本:把 JSON 读进来,只打印 activity 事件的编号、时间、类型、名字和第几次。`-o json` 让 `temporal` 输出 JSON 而不是表格。时间是 UTC,比北京时间少 8 小时。)

几件事从这里能读出来:

1. **classify 只有一组 Scheduled/Started/Completed**,结果 `billing` 存在第 7 号事件里。新 worker 重放 workflow 时,`execute_activity_method(classify)` 这一行直接拿到了 `billing`,所以没调模型。这和 Day 393 checkpoint 让 classify 不重跑是一样的效果,区别是你一行续跑代码都没写。
2. **lookup_invoice 在 11:01:54 调度,11:02:05 才以第 2 次开始**,中间 11 秒左右。为什么不是新 worker 一上来(19:02:01,也就是 11:02:01)就接手?因为服务器不知道旧 worker 死了,它只知道「这次尝试已经开始,结果还没回来」。直到 `start_to_close_timeout` 的 10 秒到期,服务器才判这次尝试超时,按重试策略安排第 2 次。这和 Day 393 里 arq 的 `job_timeout + 10` 是同一个问题,只是这里的粒度是**一个 activity**,而不是整个任务。
3. **历史里看不到第 1 次失败的 Started 事件**,第 12 号事件直接是 `attempt 2`。Temporal 对正在重试的 activity 不会每次都写一条 Started,只记最后成功(或最终失败)的那一次,避免一个反复重试的 activity 把历史撑得很长。想看每一次尝试,要看 worker 的日志,或者在 Web 界面看「Pending Activities」。

10 秒是我为了实验设得很短。真实的 activity 如果要跑很久(比如一次长时间的模型生成),`start_to_close_timeout` 就得设长,那崩溃后要等很久才能被发现。Temporal 的解法是**心跳**:activity 在执行时定期调 `activity.heartbeat()`,同时设一个短的 `heartbeat_timeout`(比如 10 秒),服务器 10 秒没收到心跳就判它死了,不用等完整个 `start_to_close_timeout`。这一段我没有实跑,练习 4 会讲怎么定这几个时间。

## 第五步:崩在 submit_refund,activity 也要幂等

换一个更难的位置:退款已经写进库,activity 还没返回时崩。

```bash
# 终端 C
CRASH_AT=submit_refund uv run python -m part07.temporal_worker
```

```bash
# 终端 B
uv run python -m part07.temporal_start T6005 "10 月 8 号被扣了两次款,INV-0123 那笔麻烦退给我"
```

```text
worker 启动,等活
  classify 第 1 次,调模型
  lookup_invoice 第 1 次
  submit_refund 第 1 次 -> {'refund_id': 'R-818e3653', 'deduplicated': False}
  !! 在 submit_refund 节点模拟进程被 kill
```

再起正常的 worker:

```text
worker 启动,等活
  submit_refund 第 2 次 -> {'refund_id': 'R-818e3653', 'deduplicated': True}
```

```text
已启动 workflow ticket-T6005,等结果……
T6005: 退款 R-818e3653 待审批
```

```bash
rm .crash_flag
psql -d agentzero_w56 -Atc "select id from refund_requests where ticket_id='T6005'"
```

```text
R-818e3653
```

submit_refund 执行了两次。Temporal 只知道「第 1 次没有回音」,它没法知道退款其实已经建好了,所以按重试策略又执行了一次。好在 `create_refund_request` 的幂等键挡住了,`deduplicated: True`,拿回原来那条,表里只有 1 行。

这是今天最重要的一个结论,我单独写出来:**Temporal 保证的是 activity「至少执行一次」,不是「恰好一次」**。和 Day 390 讲的队列语义一模一样。它能保证已经完成的 activity 不重做,但对「正在做的那一个」无能为力。所以 Temporal 官方文档里反复强调 activity 要写成幂等的,原因就在这。把 `create_refund_request` 换成 Day 391 练习 1 那个随机 key 的版本,这里就会多出一笔退款。

## 第六步:永久错误不重试

发票不存在的工单:

```bash
# 终端 C 用正常的 worker
# 终端 B
uv run python -m part07.temporal_start T6004 "INV-9999 这张发票我没买过东西,请退款"
```

终端 B 最后几行:

```text
  File ".../temporalio/client/_workflow.py", line 259, in result
    raise WorkflowFailureError(
temporalio.client._exceptions.WorkflowFailureError: Workflow execution failed
```

终端 C 的 worker 打印了 activity 失败的完整堆栈,关键行是:

```text
  classify 第 1 次,调模型
  lookup_invoice 第 1 次
Completing activity as failed ({'activity_id': '2', 'activity_type': 'lookup_invoice', 'attempt': 1, 'namespace': 'default', 'task_queue': 'tickets', 'workflow_id': 'ticket-T6004', ...})
temporalio.exceptions.ApplicationError: PermanentError: 发票 INV-9999 不存在
```

`attempt: 1`,只试了一次。因为抛的是 `type="PermanentError"` 的 `ApplicationError`,命中了 `non_retryable_error_types`。activity 失败后异常传回 workflow,workflow 里没有 `try/except`,于是整个 workflow 失败:

```bash
temporal workflow describe -w ticket-T6004
```

输出里的相关几行:

```text
  Status   FAILED
  Failure
    Message: Activity task failed
        Message: 发票 INV-9999 不存在
```

真实系统里,你会在 workflow 里 `try/except` 住 `ActivityError`,把工单标成 `needs_human`(调一个写工单表的 activity),而不是让整个 workflow 失败。这里为了看清楚默认行为,先让它失败。

## 第七步:为什么 workflow 里不能读系统时间

开头 Redux 的类比里说过,reducer 里写 `Date.now()` 会让重放不准。Temporal 的 workflow 也一样:重放时代码要走出和第一次一模一样的路,不然历史就对不上了。哪些东西会让同样的代码走出不同的路?系统时间、随机数、读文件、发网络请求、读环境变量,凡是「每次运行结果可能不同」的都算。

Python SDK 默认把 workflow 放在一个沙箱里跑,碰到这些就直接拦下来。故意写一个违规的:

```python
# agent-zero-lab/part07/temporal_bad.py
import asyncio
import os
import sys
from datetime import datetime

from temporalio import workflow
from temporalio.client import Client
from temporalio.worker import Worker

with workflow.unsafe.imports_passed_through():
    from part07.ticket_agent import ask

ADDRESS = os.getenv("TEMPORAL_ADDRESS", "localhost:7233")


@workflow.defn
class BadClock:
    @workflow.run
    async def run(self) -> str:
        return f"现在是 {datetime.now():%H:%M:%S}"


@workflow.defn
class BadLLM:
    @workflow.run
    async def run(self, text: str) -> str:
        return await ask(f"把工单分成 billing/tech/other 之一,只回一个词:{text}", 5)


async def main(which: str):
    client = await Client.connect(ADDRESS)
    async with Worker(client, task_queue="bad", workflows=[BadClock, BadLLM]):
        if which == "clock":
            handle = await client.start_workflow(BadClock.run, id="bad-clock", task_queue="bad")
        else:
            handle = await client.start_workflow(BadLLM.run, "INV-0123 重复扣款", id="bad-llm", task_queue="bad")
        try:
            print(await asyncio.wait_for(handle.result(), timeout=15))
        except TimeoutError:
            print("15 秒还没结果,workflow 卡住了")
        await handle.terminate("实验结束")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
```

<div class="line-notes">

- `from datetime import datetime` 标准库的日期时间类,`datetime.now()` 是当前时间,相当于 JS 的 `new Date()`。
- `from part07.ticket_agent import ask` 第二个错误示范要用:在 workflow 里直接调模型。
- `return f"现在是 {datetime.now():%H:%M:%S}"` 违规:workflow 里读系统时间。`:%H:%M:%S` 是格式化成「时:分:秒」。
- `return await ask(f"把工单分成 billing/tech/other 之一,只回一个词:{text}", 5)` 违规:workflow 里直接发网络请求,而不是通过 activity。这个留给练习 1。
- `async with Worker(client, task_queue="bad", workflows=[BadClock, BadLLM]):` worker 也可以用 `async with` 写在同一个脚本里:块里面 worker 在后台跑,块结束自动停。做实验很方便。
- `print(await asyncio.wait_for(handle.result(), timeout=15))` 最多等 15 秒。`asyncio.wait_for` 是 Day 392 `asyncio.timeout` 的另一种写法,给一个 await 加上限。
- `await handle.terminate("实验结束")` 强行终止这个 workflow,不然它会一直留在服务器上重试。

</div>

```bash
uv run python -m part07.temporal_bad clock
```

输出很长,同一段错误重复了三遍,去掉堆栈后是:

```text
Failed activation on workflow BadClock with ID bad-clock and run ID 01a16347-a021-74d6-9ad0-543c4e9eebd0
temporalio.worker.workflow_sandbox._restrictions.RestrictedWorkflowAccessError: Cannot access datetime.datetime.now.__call__ from inside a workflow. If this is code from a module not used in a workflow or known to only be used deterministically from a workflow, mark the import as pass through.
...(同样的错误又出现两次)
15 秒还没结果,workflow 卡住了
```

沙箱拦下了 `datetime.now()`,抛 `RestrictedWorkflowAccessError`。注意后果:workflow **没有失败,而是卡住了**。Temporal 认为 workflow task 出错是代码 bug,不是业务失败,所以它会一直重试这个 workflow task(15 秒里试了三次),等你修好代码、重新部署 worker。这和 activity 失败的处理完全不同:activity 失败按重试策略来,重试完了就把错误交给 workflow。

想要时间怎么办?用 `workflow.now()`。它返回的不是系统时间,而是「这个 workflow task 开始的时间」,这个时间记在历史里,重放时拿到的是同一个值。练习 2 会实跑。

## 第八步:改了代码,旧的执行就重放不过去

确定性还有第二层含义,更容易踩:**代码改了,正在跑的 workflow 用新代码重放旧历史,也必须走出同样的路**。

想象 T6001 这个 workflow 跑到一半(比如正在等主管审批,一等三天),你发了一版新代码,把「先分类再查发票」改成了「直接查发票」。新 worker 拿到旧历史重放,历史里第 5 号事件说「调度了 classify」,可新代码的第一步是调度 lookup_invoice,对不上了。

Temporal SDK 提供了一个 `Replayer`,可以不连服务器、只拿一份历史在本地重放,专门用来在发版前检查这种问题:

```python
# agent-zero-lab/part07/temporal_replay.py
import asyncio
import os
import sys
from datetime import timedelta

from temporalio import workflow
from temporalio.client import Client
from temporalio.worker import Replayer

with workflow.unsafe.imports_passed_through():
    from part07.temporal_acts import TicketActivities
    from part07.temporal_ticket import RETRY, TicketWorkflow

ADDRESS = os.getenv("TEMPORAL_ADDRESS", "localhost:7233")


@workflow.defn(name="TicketWorkflow")
class TicketWorkflowV2:
    @workflow.run
    async def run(self, ticket_id: str, text: str) -> str:
        invoice = await workflow.execute_activity_method(
            TicketActivities.lookup_invoice, text, start_to_close_timeout=timedelta(seconds=10), retry_policy=RETRY
        )
        return f"{ticket_id}: {invoice}"


async def main(workflow_id: str):
    client = await Client.connect(ADDRESS)
    history = await client.get_workflow_handle(workflow_id).fetch_history()
    print("事件数:", len(history.events))
    for name, wf in [("原版代码", TicketWorkflow), ("改过顺序的代码", TicketWorkflowV2)]:
        try:
            await Replayer(workflows=[wf]).replay_workflow(history)
            print(f"{name}:重放通过")
        except Exception as exc:
            msg = str(exc)
            start = max(msg.find("[TMPRL"), 0)
            print(f"{name}:{type(exc).__name__}: {msg[start:start + 130]}")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
```

<div class="line-notes">

- `from temporalio.worker import Replayer` 本地重放器,只跑 workflow 代码,不需要真的 activity。
- `from part07.temporal_ticket import RETRY, TicketWorkflow` 原版 workflow 和它的重试策略。
- `@workflow.defn(name="TicketWorkflow")` 新版代码的类名不同,但用 `name=` 告诉 Temporal 它和原版是同一个 workflow 类型。真实发版时你不会改类名,这里只是为了让两个版本能在同一个文件里对比。
- `invoice = await workflow.execute_activity_method(` 新版跳过了分类,第一步就查发票。
- `history = await client.get_workflow_handle(workflow_id).fetch_history()` 从服务器取一份已经跑完的历史。生产上可以把一批真实历史导出成文件,在 CI 里重放(第七部分讲 CI 的那天可以加上)。
- `await Replayer(workflows=[wf]).replay_workflow(history)` 用指定的代码重放这份历史。走出的路和历史不一样就抛异常。
- `start = max(msg.find("[TMPRL"), 0)` 错误消息很长,找到 Temporal 错误码 `[TMPRL` 开始的位置,只打印后面一段。`find` 找不到返回 -1,`max(..., 0)` 保证不会从负数位置切。

</div>

```bash
uv run python -m part07.temporal_replay ticket-T6001
```

```text
事件数: 23
原版代码:重放通过
改过顺序的代码:NondeterminismError: [TMPRL1100] Nondeterminism error: Activity type of scheduled event 'classify' does not match activity type of activity command 'lo
```

(前面还有一行 SDK 打的 WARN 日志,内容是同一个错误。)原版代码重放 T6001 的 23 个事件,一路对得上;改过顺序的版本在第一个 activity 就对不上:历史里调度的是 `classify`,新代码要调度的是 `lookup_invoice`,报 `TMPRL1100` 不确定性错误。线上遇到这个,那个 workflow 会卡住,就像第七步那样。

那 Temporal 的 workflow 就永远不能改了吗?能改,有两种正规做法。一种是**版本标记**:新代码里用 `workflow.patched("跳过分类")` 判断「这个 workflow 是在新代码上线后才开始的吗」,是就走新逻辑,不是就走旧逻辑,等旧的都跑完了再删掉旧分支。另一种是 Worker Versioning:让旧 workflow 继续在旧版本 worker 上跑完,新 workflow 才分到新版本 worker。这两种都要多维护一段时间的旧代码,这是 Temporal 的真实成本之一。这一段我只实跑了「改了会报错」,版本标记没有实跑。

LangGraph 的 checkpoint 有没有这个问题?有,但表现不一样。checkpoint 存的是「State 快照 + 下一步是哪个节点」,你把图改了,只要那个节点名还在,续跑时就从那个节点往下按**新图**走;节点名没了,续跑就会出错。它不会像 Temporal 那样严格检查「之前走过的路对不对得上」,所以不容易报错,但也更容易悄悄走出一条奇怪的路。

## 第九步:什么时候值得换成 Temporal

把这两天的两套方案放在一起:

| | arq + LangGraph checkpoint + 幂等键 | Temporal |
| --- | --- | --- |
| 要跑的基础设施 | Redis + Postgres(你本来就有) | Temporal 服务(自建要它自己的几个服务加一个数据库,或者买 Temporal Cloud) |
| 续跑 | 自己写:`aget_state`、输入传 None | 自动重放 |
| 崩溃后多久接手 | `job_timeout + 10` 秒(整个任务) | activity 的超时或心跳超时(单个步骤) |
| 等三天 | 要自己做定时任务把它叫醒 | `await workflow.sleep(timedelta(days=3))`,持久化定时器 |
| 等人审批 | LangGraph `interrupt` + 另一个任务恢复 | signal(往运行中的 workflow 里发消息)+ `wait_condition` |
| 代码约束 | 节点里随便写 | workflow 必须确定,改代码要考虑版本 |
| 「正在跑的那一步」重做 | 要幂等 | 要幂等 |
| 学习成本 | 这几天你已经学完了 | 新的概念和一整套规矩 |

我的取舍是:**Agent 任务几秒到几分钟、步骤在一个服务内部、偶尔需要人审批的,用 arq + LangGraph checkpoint 就够了**,我们的工单系统就是这样,后面的毕业项目也这么做。下面几种情况认真考虑 Temporal:任务要跑几小时甚至几天(比如「每天跟进一次,直到客户回复」);一个流程要跨好几个服务、好几个团队;有大量定时、等待、人工介入;出了问题需要非常清楚的审计记录(每一步的输入输出都在历史里)。

还有一点是 2026 年的新变化:Temporal 的 Python SDK 里已经有了官方的 AI 集成。我在装好的 temporalio 1.34.0 里看到 `temporalio/contrib/` 下面有 `openai_agents`、`langgraph`、`google_adk_agents` 等目录。其中 `langgraph` 插件的 README 写的是把 LangGraph 的每个节点作为 Temporal activity 执行,标注为实验阶段,而且说用了它就不需要 Postgres 那类 checkpointer 了,持久化交给 Temporal。也就是说,你不一定要在两者之间二选一,可以保留 LangGraph 写图,让 Temporal 管执行。这两个集成我只读了 README,没有实跑。

面试时被问到 Temporal,能讲清这四句话就够了:它把流程代码的每一步结果记成事件历史,崩溃后靠重放恢复;workflow 必须确定,外部操作都放进 activity;activity 是至少执行一次,所以要幂等;和队列加 checkpoint 相比,它的优势在长时间等待、跨服务编排和可审计,代价是基础设施和代码约束。

## 动手练习

### 练习 1:在 workflow 里直接调模型

运行 `uv run python -m part07.temporal_bad llm`,预测会发生什么,再看实际结果。为什么就算沙箱没拦下来,这么写也是错的?

<details><summary>参考答案</summary>

```bash
uv run python -m part07.temporal_bad llm
```

去掉大量的 `UserWarning: Module httpx2... was imported after initial workflow load` 警告和堆栈后,关键几行是:

```text
Failed activation on workflow BadLLM with ID bad-llm and run ID 01a16348-0867-769f-97a1-3425b463013f
temporalio.worker.workflow_sandbox._restrictions.RestrictedWorkflowAccessError: Cannot access urllib.request.Request.__mro_entries__ from inside a workflow. If this is code from a module not used in a workflow or known to only be used deterministically from a workflow, mark the import as pass through.
...(同样的错误又出现两次)
15 秒还没结果,workflow 卡住了
```

和 BadClock 一样被沙箱拦下、卡住。但注意错误信息说的不是「不许发网络请求」,而是 `urllib.request.Request` 不让访问。我查了一下原因:openai SDK 底层的 HTTP 库(httpx2)在第一次发请求时才去导入一些模块,其中碰到了 `urllib.request`,被沙箱拦了。这次被拦是「碰巧」,换一个 HTTP 库可能就不会被拦,请求就真发出去了。

就算请求发出去了也是错的:模型的回答每次可能不一样(Day 112 实测过 `temperature=0` 五次五种回答),重放时 workflow 会拿到一个不同的分类结果,走出不同的分支,和历史对不上。更糟的是,每次重放都会真的再调一次模型,花钱。所以规矩不是「沙箱拦什么就不写什么」,而是**凡是碰外部世界的,一律放进 activity**。activity 的结果写进历史,重放时直接取,不再执行。

</details>

### 练习 2:workflow 里的「正确的时间」

写一个 `GoodClock` workflow:记下开始时间,睡 2 秒,再记一次时间,返回两个时间。要求用 Temporal 认可的方式。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part07/temporal_clock_ok.py
import asyncio
import os
from datetime import timedelta, timezone

from temporalio import workflow
from temporalio.client import Client
from temporalio.worker import Worker

ADDRESS = os.getenv("TEMPORAL_ADDRESS", "localhost:7233")
BEIJING = timezone(timedelta(hours=8))


@workflow.defn
class GoodClock:
    @workflow.run
    async def run(self) -> str:
        start = workflow.now()
        await workflow.sleep(2)  # 持久化的定时器:worker 重启也不会丢
        end = workflow.now()
        return f"开始 {start.astimezone(BEIJING):%H:%M:%S},睡完 {end.astimezone(BEIJING):%H:%M:%S}"


async def main():
    client = await Client.connect(ADDRESS)
    async with Worker(client, task_queue="clock", workflows=[GoodClock]):
        print(await client.execute_workflow(GoodClock.run, id="good-clock", task_queue="clock"))


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `BEIJING = timezone(timedelta(hours=8))` 东八区。`workflow.now()` 返回的是 UTC 时间,打印前换成北京时间好读。
- `start = workflow.now()` 不是系统时间,而是这个 workflow task 开始的时间,记在历史里,重放时拿到同一个值。
- `await workflow.sleep(2)  # 持久化的定时器:worker 重启也不会丢` 不能用 `asyncio.sleep`吗?在 Python SDK 里 `asyncio.sleep` 其实也会被转成 Temporal 定时器,但用 `workflow.sleep` 意图更清楚。这个定时器是服务器在计时,不是 worker 进程,睡三天中间 worker 重启十次都没关系。
- `end = workflow.now()` 定时器到了以后,服务器发起一次新的 workflow task,这一行拿到的是新 task 的开始时间。
- `print(await client.execute_workflow(GoodClock.run, id="good-clock", task_queue="clock"))` `execute_workflow` 等于 `start_workflow` 加 `await handle.result()`。

</div>

```bash
uv run python -m part07.temporal_clock_ok
```

```text
开始 19:19:19,睡完 19:19:21
```

两个时间差 2 秒,没有被沙箱拦。

</details>

### 练习 3:同一张工单启动两次

T6001 已经跑完了。再执行一次 `uv run python -m part07.temporal_start T6001 "INV-0123 被重复扣款"`(先别起 worker),会发生什么?起了 worker 以后呢?怎么让它变成「同一张工单只处理一次」?

<details><summary>参考答案</summary>

我实跑时先没起 worker,启动脚本打印 `已启动 workflow ticket-T6001,等结果……` 之后就一直等着,没有报错。用 `temporal workflow list` 看:

```bash
temporal workflow list -q "WorkflowId='ticket-T6001'"
```

```text
   Status     WorkflowId        Type         StartTime
  Running    ticket-T6001  TicketWorkflow  2 minutes ago
  Completed  ticket-T6001  TicketWorkflow  20 minutes ago
```

同一个 workflow id 有两条执行:20 分钟前那条已完成,新的一条正在等 worker。Temporal 默认的 id 复用策略是:同一个 id **正在运行**时不能再启动,**已经结束**的可以再开一次。起了 worker 以后,新的那条从头跑了一遍:

```text
worker 启动,等活
  classify 第 2 次,调模型
  lookup_invoice 第 1 次
  submit_refund 第 1 次 -> {'refund_id': 'R-8c4c5d2e', 'deduplicated': True}
```

(classify 显示「第 2 次」,是因为我中途误停过一次 worker,这次的第 1 次尝试超时了。)模型被重新调了,退款靠幂等键才没重复。这和 Day 394 `manual-T-01` 被重新执行是同一类问题:**不同的执行,不会共享事件历史**。

改法是启动时指定 id 复用策略为「拒绝重复」:

```python
# agent-zero-lab/part07/temporal_start_once.py
import asyncio
import os
import sys

from temporalio.client import Client
from temporalio.common import WorkflowIDReusePolicy
from temporalio.exceptions import WorkflowAlreadyStartedError

from part07.temporal_ticket import TicketWorkflow

ADDRESS = os.getenv("TEMPORAL_ADDRESS", "localhost:7233")


async def main(ticket_id: str, text: str):
    client = await Client.connect(ADDRESS)
    try:
        handle = await client.start_workflow(
            TicketWorkflow.run,
            args=[ticket_id, text],
            id=f"ticket-{ticket_id}",
            task_queue="tickets",
            id_reuse_policy=WorkflowIDReusePolicy.REJECT_DUPLICATE,
        )
    except WorkflowAlreadyStartedError:
        print(f"ticket-{ticket_id} 已经有过一次执行,不再启动")
        return
    print(f"已启动 workflow {handle.id},等结果……", flush=True)
    print(await handle.result())


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], sys.argv[2]))
```

<div class="line-notes">

- `from temporalio.common import WorkflowIDReusePolicy` id 复用策略的枚举。
- `from temporalio.exceptions import WorkflowAlreadyStartedError` 策略不允许时 `start_workflow` 抛这个异常。
- `id_reuse_policy=WorkflowIDReusePolicy.REJECT_DUPLICATE,` 只要这个 id 有过任何一次执行(不管结果),就不许再开。
- `except WorkflowAlreadyStartedError:` 接住它,打一行提示就返回,相当于 Day 394 的 `already_done`。

</div>

```bash
uv run python -m part07.temporal_start_once T6001 "INV-0123 被重复扣款"
```

```text
ticket-T6001 已经有过一次执行,不再启动
```

要注意 `REJECT_DUPLICATE` 是连失败的那次也算的。如果你希望「失败了可以重新处理,成功了不行」,用 `ALLOW_DUPLICATE_FAILED_ONLY`。

</details>

### 练习 4:给调模型的 activity 定超时

正文用了 10 秒的 `start_to_close_timeout`。假设起草回复这个 activity 用的是一个慢模型,正常 5 到 40 秒,偶尔 90 秒。不用跑,回答:`start_to_close_timeout` 设多少?要不要心跳?worker 崩了以后多久能被发现?

<details><summary>参考答案</summary>

`start_to_close_timeout` 要盖住偶尔的 90 秒,再留余量,比如 120 秒;同时它要比模型 SDK 自己的超时乘重试次数长(Day 392 的内短外长原则:SDK `timeout=30`、`max_retries=2` 最坏 90 秒,和这里的 120 秒是一致的)。

只设这个的话,worker 崩了以后最坏要等 120 秒才会被发现、重试。想更快,就用心跳:设 `heartbeat_timeout=15` 秒,activity 里另起一个小任务每 5 秒调一次 `activity.heartbeat()`,worker 一死心跳就断,15 秒内被发现。但要注意,流式调模型的时候才好心跳(每收到一段就心跳一次);非流式的一次请求,你等着它返回的那几十秒里,要靠一个并行的定时任务去心跳。

这道题我没有实跑,心跳的写法看 Temporal 文档的 failure-detection 页(学习资料里有链接)。

</details>

**验收标准**:能起开发服务器并跑通 T6001,在 `temporal workflow show` 里指出三个 activity 各自的 Scheduled/Started/Completed;能复现 lookup_invoice 崩溃后新 worker 不调 classify、lookup_invoice 以第 2 次执行;能复现 submit_refund 崩溃后执行两次但退款只有一条;能复现 `BadClock` 卡住和 `TMPRL1100` 不确定性错误,并说清各自的原因。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| Temporal | 一个开源的持久化执行平台:服务器保存每个流程的事件历史,worker 崩溃后靠重放恢复 |
| durable execution(持久化执行) | 代码像普通函数一样从上往下写,但每一步进度都持久化,进程死了能在别处接着跑 |
| workflow | Temporal 里的流程代码,只做编排,必须是确定的,会被重放 |
| activity | Temporal 里碰外部世界的一个步骤(调模型、查库、写库),结果记进历史,至少执行一次 |
| 事件历史(event history) | 服务器给每个 workflow 执行记的事件列表,比如「调度了 classify」「classify 完成,结果是 billing」 |
| 重放(replay) | 用同一份事件历史从头再跑一遍 workflow 代码,已完成的 activity 直接取结果,快进到最新进度 |
| 确定性(determinism) | 同样的输入和历史,代码每次都走出同样的路。系统时间、随机数、网络请求会破坏它 |
| workflow task / activity task | 服务器发给 worker 的两种任务:「把 workflow 往下推进一段」和「执行一个 activity」 |
| `start_to_close_timeout` | activity 单次尝试最多多久。worker 崩溃后,服务器靠它到期才发现这次尝试没了 |
| 心跳(heartbeat) | 长 activity 定期向服务器报告「我还活着」,配合 `heartbeat_timeout` 更快发现 worker 死亡 |
| `RetryPolicy` | activity 的重试配置:最多几次、间隔多少、哪些错误类型不重试 |
| `NondeterminismError` | 重放时代码走出的路和历史对不上,常见于改了 workflow 代码的顺序 |
| workflow id 复用策略 | 同一个 workflow id 结束后能不能再开一次,默认可以,`REJECT_DUPLICATE` 不可以 |

## 常见误区

**以为用了 Temporal,activity 就只执行一次。** 只保证已完成的不重做。正在执行的那个 activity 在 worker 崩溃后会重试,第五步实测 submit_refund 执行了两次,靠幂等键才只有一条退款。

**在 workflow 里调模型、查库、读时间。** 这些都要放进 activity(时间用 `workflow.now()`)。第七步实测 `datetime.now()` 被沙箱拦下,workflow 卡住不动;练习 1 里调模型也被拦下,但那是碰巧,不要依赖沙箱帮你兜底。

**以为 workflow 代码出错会让 workflow 失败。** 不会,它会卡住并不断重试 workflow task,等你修代码重新部署。只有 activity 的错误重试耗尽、传回 workflow 又没被接住时,workflow 才会失败。线上要监控「卡住的 workflow task」。

**直接改正在运行的 workflow 的代码。** 改了 activity 的顺序或个数,旧的执行重放时报 `TMPRL1100`。要用 `workflow.patched` 做版本分支,发版前用 `Replayer` 拿真实历史重放一遍。

**以为 worker 一死,activity 马上被重试。** 服务器不知道 worker 死了,要等 `start_to_close_timeout` 到期(第四步实测约 11 秒),或者用心跳缩短发现时间。和 arq 的 `job_timeout + 10` 是同一个问题。

**启动 workflow 时 task_queue 写错。** workflow 会一直等,没有 worker 来领,也不报错。练习 3 里我没起 worker 时看到的就是这个样子:启动脚本一直停在「等结果」。

**用同一个 workflow id 就以为不会重复处理。** 默认策略允许已结束的 id 再开一次,新的执行会从头跑。要「只处理一次」就用 `REJECT_DUPLICATE`。

**为了「更可靠」把所有东西都换成 Temporal。** 它多了一整套基础设施和代码约束。几秒到几分钟、单服务内的 Agent 任务,队列加 checkpoint 加幂等已经够了。

## 学习资料

### 文档与文章

- [Temporal · What is durable execution?](https://temporal.io/blog/what-is-durable-execution):官方博客讲持久化执行的概念,Day 393 推荐过,今天学完再读一遍会清楚很多。英文,20 分钟。
- [Temporal 文档 · Event History](https://docs.temporal.io/encyclopedia/event-history):事件历史和重放的正式说明,对照第三步那 23 个事件读。英文,20 分钟。
- [Temporal Python SDK · 沙箱](https://docs.temporal.io/develop/python/python-sdk-sandbox):沙箱拦什么、为什么要 `imports_passed_through`,第七步的错误在这里有解释。英文,15 分钟。
- [Temporal 文档 · Retry Policies](https://docs.temporal.io/encyclopedia/retry-policies):重试策略的默认值(初始间隔 1 秒、倍数 2 等)和 `non_retryable_error_types`。英文,10 分钟。
- [Temporal Python SDK · 故障检测](https://docs.temporal.io/develop/python/failure-detection):各种超时和心跳怎么配,练习 4 的参考。英文,20 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1JNkFBMEFH&autoplay=0&high_quality=1" title="用Temporal构建持久化AI智能体 | AI Engineer" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>7k的每日搬运 · 用Temporal构建持久化AI智能体 | AI Engineer · 约 78 分钟,搬运自 AI Engineer 大会的英文讲座。Day 393 让你先看了前 15 分钟,今天看完剩下的,重点看讲者怎么把 Agent 的循环拆成 workflow 和 activity。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV15T4y1i7bQ&autoplay=0&high_quality=1" title="花17分钟学习下 Temporal API | Learn Temporal API In 17 Minutes" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>afalsemidnight · 花17分钟学习下 Temporal API · 约 17 分钟,2022 年的搬运。版本比较老,但 workflow、activity、worker 三者的关系讲得很直白,适合把今天的概念再串一遍。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1b7PXzxEVg&autoplay=0&high_quality=1" title="OpenAI + Temporal 强强联手:AI Agent 生产化终极方案" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>你是我的谁00 · OpenAI + Temporal 强强联手:AI Agent 生产化终极方案 · 约 78 分钟,2026 年 3 月。讲 OpenAI Agents SDK 和 Temporal 的官方集成,对应第九步提到的 `contrib/openai_agents`。选看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/tZRtLbKXtqg" title="Temporal 101: Build Your First Durable Application" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Temporal 官方 · Temporal 101: Build Your First Durable Application · 英文。官方入门课的视频版,和今天的第一到第三步一一对应。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/w4spcXq5uCw" title="Why Every AI Agent Needs Durable Execution | Temporal, Samar Abbas" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Lightspeed Venture Partners · Why Every AI Agent Needs Durable Execution · 英文,Temporal 联合创始人 Samar Abbas 讲 Agent 为什么需要持久化执行。听他的论点,再对照第九步的取舍表想想你同不同意。</figcaption>
</figure>

### 书籍

今天这组不需要。Temporal 没有一本绕不开的书,官方文档和 [learn.temporal.io](https://learn.temporal.io/courses/temporal_101/python/) 的免费课程就是最好的材料。想补「事件历史 + 重放」背后的理论,Day 391 书单里的《Designing Data-Intensive Applications》讲事件溯源(event sourcing)的那一节是同一个思想。

### 开源项目与代码

- [temporalio/sdk-python](https://github.com/temporalio/sdk-python):Python SDK 源码。`temporalio/contrib/langgraph/README.md` 和 `temporalio/contrib/openai_agents/README.md` 就是第九步提到的两个 AI 集成。
- [temporalio/samples-python](https://github.com/temporalio/samples-python):官方示例仓库,`openai_agents` 目录下有 Agent 的完整例子,`patching` 目录是第八步说的版本标记写法。

## 自测

1. worker 在 lookup_invoice 里崩溃,新 worker 接手后,classify 这个 activity 会不会再执行?workflow 代码里 `execute_activity_method(classify)` 那一行会不会再执行?

<details><summary>答案</summary>

classify 这个 activity 不会再执行(第四步实测没有打 `classify 第 N 次`)。但 workflow 代码里那一行**会**再执行:新 worker 重放 workflow 时从 `run` 的第一行开始跑,走到这一行时,SDK 发现历史里已经有 classify 的完成事件,就直接返回历史里的结果 `billing`,不去调度新的 activity。「代码行重跑」和「activity 重跑」是两回事,这正是重放的含义。

</details>

2. 为什么 lookup_invoice 崩溃后,新 worker 上线 4 秒就起来了,却要等到大约 11 秒后才执行第 2 次?

<details><summary>答案</summary>

服务器不知道旧 worker 死了,只知道这次尝试开始了、没回音。它要等 `start_to_close_timeout`(10 秒)到期才判这次尝试超时,再按重试策略(第一次重试间隔 1 秒)安排第 2 次。想更快发现,要用心跳超时。

</details>

3. 在 workflow 里写 `if random.random() < 0.5:` 决定走哪个分支,会出什么问题?

<details><summary>答案</summary>

重放时随机数可能不同,走到另一个分支,调度的 activity 和历史对不上,报不确定性错误,workflow 卡住。Python SDK 的沙箱会拦下标准的 `random`,要用 `workflow.random()`,它的种子记在历史里,重放时得到同样的序列。更好的做法是把「随机决定」放进 activity,结果记进历史。

</details>

4. 同样是「崩了接着跑」,LangGraph checkpoint 存的是什么,Temporal 存的是什么?各自的续跑方式有什么不同?

<details><summary>答案</summary>

LangGraph checkpoint 存的是每一步之后整个 State 的快照,加上「下一步是哪个节点」;续跑时读最新快照,从那个节点往下跑,需要你在入口处判断有进度就传 None。Temporal 存的是事件历史,也就是每个 activity 的调度和结果;续跑时用历史重放整个 workflow 代码,是自动的。前者对改代码更宽松(只要节点名在就能续跑),后者更严格(路线必须对得上),但审计信息更完整。

</details>

5. (面试题)你的 Agent 要做「给客户发一封催付邮件,等 3 天,没付款就再发一封,最多三次,付了就停」。你会用队列 + checkpoint 还是 Temporal?说说理由和关键设计。

<details><summary>答案</summary>

参考答法:这是 Temporal 的典型场景,我会选它。理由是流程要跨好几天,中间大部分时间在等;用队列做的话要自己写定时任务每天扫一遍「到期该发第二封的」,还要处理扫描任务本身的崩溃和重复。Temporal 里就是一段普通代码:`for i in range(3)` 里先调度「发邮件」activity,再 `await workflow.wait_condition(lambda: self.paid, timeout=timedelta(days=3))`,付款系统收到付款时往这个 workflow 发一个 signal 把 `self.paid` 置为 True。关键设计有四点:workflow id 用账单号,配 `REJECT_DUPLICATE` 防止重复启动;发邮件的 activity 带幂等键(账单号 + 第几次),崩溃重试不会发两封;等待用持久化定时器,worker 重启、发版都不影响;改流程(比如把 3 天改成 2 天)时用 `workflow.patched` 做版本分支,发版前用 Replayer 重放真实历史验证。如果团队没有 Temporal 的运维能力、流程也就这一个,退一步用 Postgres 存「下次发送时间」加一个定时扫描任务也能做,但要自己处理扫描的幂等和并发。

</details>

## 明天预告

Day 396 · 成本(一):一张工单花多少钱。这三天一直在让 worker「崩了也不白干」,背后其实一直有一笔账:崩一次重调一次模型,就是多花一次钱。明天把这笔账算清楚:从 DeepSeek 的响应里读出每次调用的 token 数,按 2026 年 10 月的峰谷价格算出每张工单花了几分钱、钱花在输入还是输出,再用今天和昨天的崩溃实验验证一件事:只看图的状态记账,会漏掉崩溃时那次白调的模型。
