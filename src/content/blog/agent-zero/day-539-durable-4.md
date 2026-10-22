---
title: 'Day 539 · 持久化执行(四):四个现成方案'
description: '自己写的 durable_runner.py 离生产还差租约、调度、归档和长时间等待。今天把同一个退款流程分别放到 Temporal、Restate、DBOS 和 LangGraph checkpoint 上,在本机真跑,在「退款成功、结果没记下」的那一刻杀掉进程再恢复,看每家只退一笔是怎么做到的;再看它们分别怎么补上那四个缺口,最后给出什么时候值得引入的判断标准。'
pubDate: 2026-10-22
regime: none
tags: ['durable-execution', 'temporal', 'restate', 'dbos', 'langgraph', 'agent-zero']
series: 'agent-zero'
day: 539
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 538](/blog/agent-zero/day-538-week77-review/) 是复习日,把记忆和持久化执行两条线拼成了一个小项目:退款流程跑在 [Day 537](/blog/agent-zero/day-537-durable-3/) 的 `durable_runner.py` 上,开始读客户记忆、结束写回记忆,在六个步骤各杀一次,退款和记忆都只有一份。顺手还抓到一个坑:工具函数自己打开的数据库要自己 commit,运行器只管自己的日志。

Day 537 最后列了这个七十几行的运行器离生产还差的四样东西:两个进程同时恢复同一次运行怎么办(租约);进程挂了谁去发现、谁去恢复(调度);日志越积越多怎么办(归档);等主管审批一天怎么办(长时间等待和外部唤醒)。这些正是 Temporal、Restate、DBOS 这类系统花好几年做的事。今天不再自己造,把同一个退款流程放到四个现成方案上各跑一遍。

## 今天要解决的问题

学完今天你应该能做到:

1. 说清楚持久化执行方案的两种形态:**独立服务型**(Temporal、Restate,要多跑一个服务端进程,你的代码作为 worker 或被调用的服务)和**库型**(DBOS、LangGraph checkpoint,只是一个 Python 包,日志写进你自己的数据库)。这是今天的两个新概念。
2. 在本机把同一个四步退款流程分别用四个方案跑起来,在「退款已成功、结果还没记下」的那一刻 `kill -9`,恢复后支付系统里只有一笔退款,并且能从各家的日志(Temporal 的事件历史、Restate 的 journal 表、DBOS 的 `operation_outputs` 表、LangGraph 的 checkpoint)里指出这一步是怎么被记下或者没被记下的。
3. 对着 Day 537 的四个缺口,说出每个方案分别怎么补,哪些它也不管。
4. 给一个具体场景判断要不要引入这些系统、引入哪一个,并说出理由。

预计用时 3 小时(装东西大约占半小时)。前置:[Day 535](/blog/agent-zero/day-535-durable-1/) 到 [Day 537](/blog/agent-zero/day-537-durable-3/) 全部;[Day 67](/blog/agent-zero/day-067-async-2/)(`async def` 和 `asyncio.run`);[Day 96](/blog/agent-zero/day-096-decorators/)(装饰器);[Day 318](/blog/agent-zero/day-318-lg-sqlite-saver/)(LangGraph 的 SqliteSaver)和 [Day 319](/blog/agent-zero/day-319-lg-interrupt/)(interrupt)。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 Temporal 版的 workflow 和 activity 两段,以及那张「四个缺口」对照表;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先把对照物摆出来

四个方案做的是同一件事,就是 Day 535 那句话:每一步的结果写进持久化日志,崩溃后重新运行代码,日志里有的步骤直接拿结果。区别在于**日志放在哪、谁来驱动重放**。

先看我们自己的运行器。日志是 `part10/journal.db`,一个 SQLite 文件;驱动重放的是「你手动再敲一次命令,带上同一个 `run_id`」。这就是为什么它缺调度:没人替你敲这个命令。

现成方案按这两个问题分成两类。

**独立服务型**:Temporal 和 Restate。你要多启动一个服务端进程,日志存在它那里。你的业务代码是另一个进程,Temporal 叫它 worker(工人进程,主动去服务端领活干),Restate 叫它 service(服务,被服务端用 HTTP 调用)。你的代码挂了,服务端知道,会把活重新派给活着的进程。前端可以这么类比:服务端像一个任务调度中心,你的进程像连上来的客户端,客户端掉线了,调度中心把没做完的任务交给别的客户端。

**库型**:DBOS 和 LangGraph checkpoint。只是 `uv add` 一个包,没有额外的服务。日志写进你指定的数据库(DBOS 推荐 Postgres,开发时也能用 SQLite;LangGraph 可以用 SQLite 或 Postgres)。重放由你自己的进程在启动时做。少一套服务要运维,代价是「谁来发现挂掉的进程」要你自己想办法,或者买它们的商业控制台。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="两种形态:独立服务型有一个单独的服务端进程保存日志并派活,业务进程是 worker;库型没有服务端,业务进程直接把日志写进自己的数据库">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12" text-anchor="middle">
    <text x="160" y="24" fill="var(--ink)">独立服务型:Temporal / Restate</text>
    <rect x="70" y="44" width="180" height="56" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="160" y="68" fill="var(--ink)">服务端进程</text>
    <text x="160" y="86" fill="var(--ink-soft)" font-size="11">存事件日志、派活、计时</text>
    <rect x="30" y="160" width="120" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="90" y="182" fill="var(--ink)">你的进程 A</text>
    <text x="90" y="199" fill="var(--ink-soft)" font-size="11">worker</text>
    <rect x="170" y="160" width="120" height="50" rx="6" fill="var(--paper)" stroke="var(--rule)" stroke-dasharray="4 3"/>
    <text x="230" y="182" fill="var(--ink-soft)">你的进程 B</text>
    <text x="230" y="199" fill="var(--ink-faint)" font-size="11">A 挂了,活派给 B</text>
    <line x1="120" y1="100" x2="95" y2="160" stroke="var(--ink-faint)"/>
    <line x1="200" y1="100" x2="225" y2="160" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
    <text x="160" y="240" fill="var(--ink-faint)" font-size="11">多运维一个服务,换来自动恢复</text>
    <text x="480" y="24" fill="var(--ink)">库型:DBOS / LangGraph</text>
    <rect x="400" y="60" width="160" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="480" y="84" fill="var(--ink)">你的进程</text>
    <text x="480" y="102" fill="var(--ink-soft)" font-size="11">import dbos / langgraph</text>
    <rect x="400" y="160" width="160" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="480" y="182" fill="var(--ink)">你的数据库</text>
    <text x="480" y="199" fill="var(--ink-soft)" font-size="11">Postgres / SQLite</text>
    <line x1="480" y1="116" x2="480" y2="160" stroke="var(--ink-faint)"/>
    <text x="480" y="240" fill="var(--ink-faint)" font-size="11">少一套服务,谁来恢复要自己管</text>
  </g>
  <line x1="320" y1="14" x2="320" y2="250" stroke="var(--rule)"/>
</svg>
<figcaption>两种形态。琥珀色是存日志的地方,蓝色是你写的代码。独立服务型把「发现挂掉、重新派活」做进了服务端;库型把日志放进你已有的数据库,恢复靠进程启动时自己扫。</figcaption>
</figure>

为了好比较,四个方案跑的都是同一个流程,也是 Day 537 `refund_flow.py` 的缩小版:查发票 → 对后一张发票退款。支付系统还是 Day 536 的 `part10/payments.py`,一行没改,它认幂等键,同一个键第二次来就把上次的结果原样还回去。每个脚本都留一个 `CRASH=1` 开关:退款函数执行完、结果还没交回框架时给自己发 `kill -9`。这是 Day 537 说的最坏时刻。

## 准备环境

在 `agent-zero-lab` 根目录装四个 Python 包。`hypercorn` 是一个 ASGI 服务器,作用和 uvicorn 一样,Restate 的 Python SDK 文档用的是它:

```bash
cd agent-zero-lab
uv add temporalio dbos restate-sdk hypercorn langgraph langgraph-checkpoint-sqlite
```

我在 2026 年 10 月装到的版本:`temporalio` 1.34.0、`dbos` 3.3.0、`restate-sdk` 1.1.0、`hypercorn` 0.18.0、`langgraph` 1.2.16、`langgraph-checkpoint-sqlite` 3.1.2。这几个库更新很快,版本号对不上时先看各自的更新日志。

两个独立服务型方案还要装服务端:

```bash
brew install temporal                       # Temporal CLI,自带一个开发用的服务端,我用的是 1.9.1
npx -y @restatedev/restate-server@1.8.1     # Restate 服务端,npm 上就有,第一次会下载,不用全局安装
```

Temporal 的开发服务端是 Temporal CLI 里的 `temporal server start-dev`,一个命令起一整套,数据可以存进一个 SQLite 文件,适合在本机学。生产上的 Temporal 要么自己部署一套集群(依赖 Cassandra、MySQL 或 Postgres),要么用 Temporal Cloud。Restate 服务端是一个用 Rust 写的单独二进制,npm 包只是帮你下载它,和 esbuild 的分发方式一样。

本机是 2019 款 Intel Mac,两个服务端都能跑,不需要 Docker。

## Temporal:日志在服务端,你的代码是 worker

### 三个词:workflow、activity、worker

Temporal 把代码分成两种,正好对应我们运行器里的两样东西。

**workflow**(工作流)是那段「编排」代码,相当于我们的 `workflow(run)` 函数。它会被重放很多次,所以必须是确定性的:同样的事件历史,每次走出同样的路。

**activity**(活动)是被包起来的那一步,相当于我们传给 `run.step` 的函数:查发票、退款、调模型。它的结果会被记进服务端的**事件历史**(event history),重放时直接取,不再执行。

**worker** 是你启动的那个 Python 进程。它连上服务端,从一个叫 **task queue**(任务队列)的地方领活:有时领到「推进一下某个 workflow」,有时领到「执行一个 activity」。干完把结果报回服务端。

Day 536 讲过非确定性:工作流里直接读时钟或取随机数,重放时会走出不同的路。我们的运行器靠自觉,文章里一再叮嘱「一律 `run.now()`」。Temporal 不靠自觉,它的 Python SDK 把 workflow 代码放进一个**沙箱**里跑,直接调用 `datetime.now()` 或 `random.random()` 会当场报错。先看一眼这个,再写退款流程。

新建 `part10/ex539_sandbox.py`:

```python
# agent-zero-lab/part10/ex539_sandbox.py
import asyncio
import datetime
import random
import sys

from temporalio import workflow
from temporalio.client import Client
from temporalio.worker import Worker


@workflow.defn
class BadClock:
    @workflow.run
    async def run(self, how: str) -> str:
        if how == "now":
            return str(datetime.datetime.now())  # 工作流里直接读时钟
        if how == "random":
            return str(random.random())  # 工作流里直接取随机数
        return str(workflow.now())  # Temporal 提供的确定性时间


async def main(how: str) -> None:
    client = await Client.connect("localhost:7233")
    async with Worker(client, task_queue="sandbox", workflows=[BadClock]):
        handle = await client.start_workflow(BadClock.run, how, id=f"clock-{how}", task_queue="sandbox")
        try:
            print(how, "->", await asyncio.wait_for(handle.result(), timeout=5))
        except TimeoutError:
            print(how, "-> 5 秒没结果,工作流卡住了")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
```

<div class="line-notes">

- `from temporalio import workflow` Temporal 的 Python SDK 叫 `temporalio`。`workflow` 模块里是写工作流用的装饰器和工具函数。
- `@workflow.defn` 把一个类登记成工作流定义。Temporal 的 Python 工作流写成类,因为后面要往里放「信号」这种会被外部调用的方法(练习 1 会用到)。装饰器的原理见 [Day 96](/blog/agent-zero/day-096-decorators/)。
- `@workflow.run` 标出工作流的入口方法,必须是 `async def`。一个工作流类只有一个入口。
- `return str(datetime.datetime.now())  # 工作流里直接读时钟` 故意犯 Day 536 的错。
- `return str(workflow.now())  # Temporal 提供的确定性时间` 正确写法。`workflow.now()` 返回的是「这个工作流任务开始的时间」,这个时间记在事件历史里,重放时拿到的是同一个值,作用和我们的 `run.now()` 一样。
- `client = await Client.connect("localhost:7233")` 连上服务端。7233 是 Temporal 开发服务端的默认端口,走的是 gRPC(一种基于 HTTP/2 的二进制协议),不是浏览器里那种 JSON 接口。
- `async with Worker(client, task_queue="sandbox", workflows=[BadClock]):` 在这个 `with` 块里起一个 worker,块结束时关掉。`task_queue` 是一个名字,发起工作流时写同一个名字,活才会派到这个 worker。`async with` 就是 [Day 98](/blog/agent-zero/day-098-context-managers/) 的上下文管理器的异步版。
- `handle = await client.start_workflow(BadClock.run, how, id=f"clock-{how}", task_queue="sandbox")` 发起一次工作流。`id` 是工作流 id,相当于我们的 `run_id`,同一时间同一个 id 只能有一个在跑。返回的 `handle` 是这次运行的把手,后面用它取结果。
- `print(how, "->", await asyncio.wait_for(handle.result(), timeout=5))` 最多等 5 秒。为什么要设超时?看了输出就知道。

</div>

开两个终端。终端 A 起服务端,数据存进一个文件,以后重启服务端历史还在:

```bash
cd agent-zero-lab
temporal server start-dev --db-filename part10/temporal.db --headless
```

终端 B 依次跑三种:

```bash
cd agent-zero-lab
uv run python part10/ex539_sandbox.py now
uv run python part10/ex539_sandbox.py random
uv run python part10/ex539_sandbox.py wf
```

`now` 那次输出很长,我截了关键几行(`File ...` 那些调用栈行省略了):

```text
temporalio.worker.workflow_sandbox._restrictions.RestrictedWorkflowAccessError: Cannot access datetime.datetime.now.__call__ from inside a workflow. If this is code from a module not used in a workflow or known to only be used deterministically from a workflow, mark the import as pass through.
now -> 5 秒没结果,工作流卡住了
```

`random` 那次报的是 `Cannot access random.random.__call__ from inside a workflow`,最后也是「5 秒没结果」。`wf` 那次正常:

```text
wf -> 2026-10-22 10:52:49.080449+00:00
```

注意两件事。第一,沙箱是在**你的代码第一次执行时**就拦住了,不用等到重放出错才发现,这比我们靠自觉强得多。第二,出错的工作流没有「失败」,而是卡住:Temporal 认为这是代码 bug,它会一直重试这个工作流任务,等你修好代码、重启 worker 后接着跑。这就是为什么要 `wait_for` 设 5 秒超时,不然这个脚本会一直等下去。用 `temporal workflow list` 看,`clock-now` 和 `clock-random` 两个一直是 `Running`。学完可以用 `temporal workflow terminate --workflow-id clock-now` 把它们结束掉。

### 退款流程

新建 `part10/temporal_refund.py`。这个文件既是 worker,也是发起工作流的客户端,用命令行参数区分:

```python
# agent-zero-lab/part10/temporal_refund.py
import asyncio
import os
import signal
import sqlite3
import sys
from datetime import timedelta

from temporalio import activity, workflow
from temporalio.client import Client
from temporalio.common import RetryPolicy
from temporalio.worker import Worker

with workflow.unsafe.imports_passed_through():
    import payments

payments.db = sqlite3.connect(os.environ.get("PAYMENTS_DB", "part10/payments.db"), check_same_thread=False)


@activity.defn
def list_invoices(customer_id: str) -> list[dict]:
    print("  [activity] list_invoices 真正执行", flush=True)
    return [{"id": "INV-2290", "amount": 468}, {"id": "INV-2291", "amount": 468}]


@activity.defn
def refund(invoice_id: str, amount: int) -> dict:
    info = activity.info()
    key = f"{info.workflow_id}-{info.activity_id}"
    print(f"  [activity] refund 第 {info.attempt} 次尝试,幂等键 {key}", flush=True)
    r = payments.create_refund(invoice_id, amount, key)
    if os.environ.get("CRASH") == "1":
        os.kill(os.getpid(), signal.SIGKILL)  # 退款成功了,结果还没报回 Temporal
    return r


@workflow.defn
class RefundWorkflow:
    @workflow.run
    async def run(self, customer_id: str) -> str:
        timeout, retry = timedelta(seconds=5), RetryPolicy(maximum_attempts=3)
        invoices = await workflow.execute_activity(list_invoices, customer_id,
                                                   start_to_close_timeout=timeout, retry_policy=retry)
        dup = invoices[-1]
        r = await workflow.execute_activity(refund, args=[dup["id"], dup["amount"]],
                                            start_to_close_timeout=timeout, retry_policy=retry)
        return f"已退 {r['amount']} 元,单号 {r['refund_id']}"


async def main(cmd: str) -> None:
    client = await Client.connect("localhost:7233")
    if cmd == "worker":
        from concurrent.futures import ThreadPoolExecutor
        worker = Worker(client, task_queue="refunds", workflows=[RefundWorkflow],
                        activities=[list_invoices, refund], activity_executor=ThreadPoolExecutor(4))
        print("worker 已启动,pid", os.getpid(), flush=True)
        await worker.run()
    else:
        result = await client.execute_workflow(RefundWorkflow.run, "C007", id="refund-C007", task_queue="refunds")
        print("结果:", result)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
```

<div class="line-notes">

- `with workflow.unsafe.imports_passed_through():` 沙箱会把 workflow 文件里的 import 重新隔离一遍。`payments` 只在 activity 里用,用这个 `with` 告诉沙箱「这个模块直接放行,不用隔离」。名字里带 `unsafe` 是提醒你:放行的模块如果被 workflow 代码用来做不确定的事,沙箱就拦不住了。
- `payments.db = sqlite3.connect(os.environ.get("PAYMENTS_DB", "part10/payments.db"), check_same_thread=False)` 把 `payments.py` 里那个模块级的连接换掉。原因是下面的 activity 在线程池里执行,而 sqlite3 的连接默认只许创建它的线程用,换成 `check_same_thread=False` 的连接才不报错。`payments.create_refund` 读的是模块级变量 `db`,所以从外面赋值能生效。
- `@activity.defn` 把普通函数登记成 activity。这里写的是普通 `def`,不是 `async def`,所以 worker 要配一个线程池来跑它(看下面 `activity_executor`)。
- `info = activity.info()` 取当前这次 activity 执行的信息:属于哪个工作流、编号是多少、第几次尝试。
- `key = f"{info.workflow_id}-{info.activity_id}"` 幂等键。`activity_id` 是 Temporal 按顺序给 activity 编的号,第一个是 `"1"`,第二个是 `"2"`,重试时不变。所以这个键就是我们 `idempotency_key()` 的「运行 id + 步骤序号」,只是序号由 Temporal 给。实跑出来是 `refund-C007-2`。
- `print(f"  [activity] refund 第 {info.attempt} 次尝试,幂等键 {key}", flush=True)` `attempt` 从 1 开始,重试一次加一。
- `os.kill(os.getpid(), signal.SIGKILL)  # 退款成功了,结果还没报回 Temporal` 和 Day 537 的崩溃注入一样,在最坏的时刻自杀。
- `timeout, retry = timedelta(seconds=5), RetryPolicy(maximum_attempts=3)` `start_to_close_timeout` 是一次 activity 从开始到结束最多给多久,超过了服务端就当它失败,按重试策略再派一次。这个超时是 Temporal 发现「worker 死了」的办法:它看不见你的进程,只看得见 5 秒过去了还没有结果。最多尝试 3 次。
- `invoices = await workflow.execute_activity(list_invoices, customer_id,` 在 workflow 里执行一个 activity 并等它的结果。这一行对应我们的 `run.step("tool.list_invoices", list_invoices, "C007")`。第一次执行时,服务端把活派给某个 worker;重放时,结果直接从事件历史里取。
- `r = await workflow.execute_activity(refund, args=[dup["id"], dup["amount"]],` 多个参数要放进 `args` 列表。
- `from concurrent.futures import ThreadPoolExecutor` 线程池,[Day 191](/blog/agent-zero/day-191-failures-3/) 用它给工具加过超时。
- `activities=[list_invoices, refund], activity_executor=ThreadPoolExecutor(4))` 普通函数的 activity 放进 4 个线程的线程池里跑,不会卡住 worker 的事件循环。
- `await worker.run()` 一直运行,不断去任务队列领活,直到进程被杀。
- `result = await client.execute_workflow(RefundWorkflow.run, "C007", id="refund-C007", task_queue="refunds")` `execute_workflow` 是「发起并一直等到结束」,等价于 `start_workflow` 再 `await handle.result()`。等的过程中 worker 死了也没关系,这个客户端只是在等服务端告诉它结果。

</div>

这次要三个终端。终端 A 的服务端如果还开着就不用动。终端 B 带着崩溃开关起 worker,终端 C 发起工作流:

```bash
# 终端 B
rm -f part10/payments.db
CRASH=1 uv run python part10/temporal_refund.py worker; echo "exit=$?"
# 终端 C
uv run python part10/temporal_refund.py start
```

终端 B:

```text
worker 已启动,pid 76031
  [activity] list_invoices 真正执行
  [activity] refund 第 1 次尝试,幂等键 refund-C007-2
exit=137
```

worker 在退款之后死了,终端 C 没有报错,还在等。在终端 B 不带开关重新起一个 worker:

```bash
uv run python part10/temporal_refund.py worker
```

```text
worker 已启动,pid 76227
  [activity] refund 第 2 次尝试,幂等键 refund-C007-2
```

过了几秒,终端 C 打出:

```text
结果: 已退 468 元,单号 RF-1
```

查支付系统:

```bash
sqlite3 part10/payments.db "SELECT * FROM refunds"
```

```text
RF-1|INV-2291|468|refund-C007-2
```

新 worker 没有再查发票(第 1 步的结果在服务端的历史里),退款是第 2 次尝试,键还是 `refund-C007-2`,支付系统认出这个键,把 RF-1 原样还回来。整个过程里我们没有敲任何「恢复」命令,只是重新起了一个 worker。这就是 Day 537 缺的「调度」:谁来发现、谁来恢复,Temporal 服务端替你做了。

### 看一眼事件历史

服务端存的「日志」长什么样?用 CLI 看:

```bash
temporal workflow show --workflow-id refund-C007 --address 127.0.0.1:7233
```

```text
Progress:
  ID           Time                     Type
    1  2026-10-22T10:51:09Z  WorkflowExecutionStarted
    2  2026-10-22T10:51:09Z  WorkflowTaskScheduled
    3  2026-10-22T10:51:09Z  WorkflowTaskStarted
    4  2026-10-22T10:51:09Z  WorkflowTaskCompleted
    5  2026-10-22T10:51:09Z  ActivityTaskScheduled
    6  2026-10-22T10:51:09Z  ActivityTaskStarted
    7  2026-10-22T10:51:09Z  ActivityTaskCompleted
    8  2026-10-22T10:51:09Z  WorkflowTaskScheduled
    9  2026-10-22T10:51:09Z  WorkflowTaskStarted
   10  2026-10-22T10:51:09Z  WorkflowTaskCompleted
   11  2026-10-22T10:51:09Z  ActivityTaskScheduled
   12  2026-10-22T10:51:15Z  ActivityTaskStarted
   13  2026-10-22T10:51:15Z  ActivityTaskCompleted
   14  2026-10-22T10:51:15Z  WorkflowTaskScheduled
   15  2026-10-22T10:51:25Z  WorkflowTaskTimedOut
   16  2026-10-22T10:51:25Z  WorkflowTaskScheduled
   17  2026-10-22T10:51:25Z  WorkflowTaskStarted
   18  2026-10-22T10:51:25Z  WorkflowTaskCompleted
   19  2026-10-22T10:51:25Z  WorkflowExecutionCompleted

Results:
  Status          COMPLETED
  Result          "已退 468 元,单号 RF-1"
  ResultEncoding  json/plain
```

这 19 行就是 Temporal 版的 `journal.db`。对着读:

- 第 5–7 行是查发票这个 activity:派出、开始、完成。完成那一行里存着发票列表。
- 第 11 行派出退款,10:51:09。第一个 worker 执行完、还没报告就死了,所以历史里没有对应的「完成」。
- 第 12 行 10:51:15,正好是 5 秒的 `start_to_close_timeout` 过后,服务端重新派出,被新 worker 领到并完成。重试中途失败的那次不单独记一行,只记最后一次。
- 第 14–15 行有个 10 秒的空档,然后 `WorkflowTaskTimedOut`。这是因为服务端第一次把「推进工作流」的活优先派给了上次处理它的 worker(Temporal 叫 sticky 缓存,老 worker 内存里有这个工作流的状态,接着跑最快),可那个 worker 已经死了。等 10 秒没人理,服务端改派到普通队列,新 worker 领到后从第 1 行开始重放:查发票的结果从第 7 行取,退款的结果从第 13 行取,然后返回。

`--address 127.0.0.1:7233` 是我踩出来的:不写这个参数时,CLI 去连 `localhost`,在我的机器上报 `failed connecting to Temporal server at localhost:7233: context deadline exceeded`。原因是 `localhost` 先解析成了 IPv6 的 `::1`,而开发服务端只监听 IPv4。Python 客户端没这个问题,CLI 遇到了就换成 127.0.0.1。

Temporal 的事件历史有上限。官方文档写的是一个工作流的历史最多 51,200 个事件或 50 MB,到 10,240 个事件或 10 MB 会开始警告。一个 Agent 跑几百步工具调用,每步至少三个事件,很快会碰到警告线。解决办法叫 Continue-As-New:把当前状态作为输入,开一个新的工作流运行接着干,旧历史就封存了。这就是 Day 537 说的「日志越积越多」在 Temporal 里的答案,也和 Day 535 提过的快照是一个意思。

## Restate:服务端推着你的函数走

Restate 也是独立服务型,但形状和 Temporal 反过来。Temporal 的 worker 主动去服务端领活;Restate 的服务端主动用 HTTP 调用你的服务。你的代码就是一个普通的 HTTP 服务(和 FastAPI 写的接口差不多),Restate 服务端站在它前面,所有请求都先进服务端,由服务端记日志、调用你、在你挂掉时重新调用。

新建 `part10/restate_refund.py`:

```python
# agent-zero-lab/part10/restate_refund.py
import asyncio
import os
import signal
import sqlite3

import hypercorn.asyncio
import restate
from hypercorn import Config

import payments

payments.db = sqlite3.connect(os.environ.get("PAYMENTS_DB", "part10/payments.db"), check_same_thread=False)
wf = restate.Workflow("RefundWorkflow")


def list_invoices(customer_id: str) -> list[dict]:
    print("  [run] list_invoices 真正执行", flush=True)
    return [{"id": "INV-2290", "amount": 468}, {"id": "INV-2291", "amount": 468}]


def refund(invoice_id: str, amount: int, key: str) -> dict:
    print("  [run] refund 真正执行,幂等键", key, flush=True)
    r = payments.create_refund(invoice_id, amount, key)
    if os.environ.get("CRASH") == "1":
        os.kill(os.getpid(), signal.SIGKILL)  # 退款成功了,结果还没写进 Restate 的日志
    return r


@wf.main()
async def run(ctx: restate.WorkflowContext, customer_id: str) -> str:
    invoices = await ctx.run_typed("list_invoices", list_invoices, customer_id=customer_id)
    dup = invoices[-1]
    key = f"{ctx.key()}-refund"
    r = await ctx.run_typed("refund", refund, invoice_id=dup["id"], amount=dup["amount"], key=key)
    return f"已退 {r['amount']} 元,单号 {r['refund_id']}"


app = restate.app(services=[wf])

if __name__ == "__main__":
    conf = Config()
    conf.bind = ["localhost:9080"]
    print("服务已启动,pid", os.getpid(), flush=True)
    asyncio.run(hypercorn.asyncio.serve(app, conf))  # type: ignore[arg-type]
```

<div class="line-notes">

- `import restate` Restate 的 Python SDK,包名 `restate-sdk`,导入名 `restate`。
- `wf = restate.Workflow("RefundWorkflow")` 声明一个工作流服务,名字会出现在 URL 里。Restate 的「工作流」每个 key 只能跑一次,很适合「每张工单一次退款流程」这种场景。
- `def list_invoices(customer_id: str) -> list[dict]:` 和 Temporal 不同,这里的步骤函数不用加装饰器,就是普通函数,在工作流里用 `ctx.run_typed` 包一下就行。
- `@wf.main()` 标出工作流的入口。
- `async def run(ctx: restate.WorkflowContext, customer_id: str) -> str:` 第一个参数是 Restate 给你的上下文对象 `ctx`,所有需要被记录的事都通过它做。它的角色就是我们的 `run`(`DurableRun` 对象)。
- `invoices = await ctx.run_typed("list_invoices", list_invoices, customer_id=customer_id)` 等价于我们的 `run.step("list_invoices", list_invoices, "C007")`:执行函数、把结果写进 Restate 的日志,重放时直接取。参数要用关键字传。
- `key = f"{ctx.key()}-refund"` `ctx.key()` 是这次工作流的 key,从调用的 URL 里来,这里是 `C007`。所以幂等键是 `C007-refund`。工作流里每个 key 只有一次运行,用「key + 步骤名」就够唯一了。
- `app = restate.app(services=[wf])` 把服务包成一个 ASGI 应用。ASGI 是 Python 异步 Web 服务的接口标准,FastAPI 也是 ASGI 应用。
- `conf.bind = ["localhost:9080"]` 9080 是 Restate 文档里服务的惯用端口。
- `asyncio.run(hypercorn.asyncio.serve(app, conf))  # type: ignore[arg-type]` 用 hypercorn 把服务跑起来。末尾的注释是让类型检查器别管这一行:Restate 的 app 类型和 hypercorn 声明的类型对不上,运行时没问题。

</div>

还是三个终端。终端 A 起 Restate 服务端(它会在当前目录建一个 `restate-data/`,所以先换到一个单独的目录);如果 Temporal 服务端还开着,先 Ctrl+C 关掉它省点内存:

```bash
mkdir -p restate-run && cd restate-run
npx -y @restatedev/restate-server@1.8.1
```

终端 B 带开关起服务:

```bash
cd agent-zero-lab
rm -f part10/payments.db
CRASH=1 uv run python part10/restate_refund.py; echo "exit=$?"
```

终端 C 先告诉 Restate 服务在哪(9070 是它的管理端口),再发起一次工作流(8080 是它接收请求的端口):

```bash
curl localhost:9070/deployments -H 'content-type: application/json' -d '{"uri":"http://localhost:9080"}'
curl localhost:8080/RefundWorkflow/C007/run/send -H 'content-type: application/json' -d '"C007"'
```

第一行注册成功会返回一大段 JSON,里面列出了 `RefundWorkflow` 和它的 `run` 方法。第二行返回:

```text
{"invocationId":"inv_1ijqxeRsAljG1o7tjgfDFA5XVpDg0F3638","status":"Accepted"}
```

URL 里的 `C007` 就是 `ctx.key()`,末尾的 `/send` 表示「交给你,我不等结果」。终端 B:

```text
服务已启动,pid 80486
  [run] list_invoices 真正执行
  [run] refund 真正执行,幂等键 C007-refund
exit=137
```

(hypercorn 自己还会打两行启动日志,这里省略了。)不带开关重启终端 B 的服务,什么都不用做,十几秒内就看到:

```text
服务已启动,pid 81055
  [run] refund 真正执行,幂等键 C007-refund
```

Restate 服务端一直在重试调用 9080,服务一回来就接上了。查发票没有重跑,退款带着同一个键重跑,支付系统返回原来的结果。取工作流的结果:

```bash
curl localhost:8080/restate/workflow/RefundWorkflow/C007/output
sqlite3 part10/payments.db "SELECT * FROM refunds"
```

```text
"已退 468 元,单号 RF-1"
RF-1|INV-2291|468|C007-refund
```

第一行是 JSON 字符串,中文被转成了 `\u` 转义,用 `JSON.parse` 或者 `python3 -c 'import json,sys;print(json.load(sys.stdin))'` 解出来就是「已退 468 元,单号 RF-1」。

Restate 的日志可以直接用 SQL 查,它的管理端口提供了一个 `/query` 接口:

```bash
curl localhost:9070/query -H 'content-type: application/json' -H 'accept: application/json' \
  -d '{"query":"SELECT index, entry_type, name FROM sys_journal WHERE id = '"'"'inv_1ijqxeRsAljG1o7tjgfDFA5XVpDg0F3638'"'"' ORDER BY index"}'
```

```text
{"rows":[{"index":0,"entry_type":"Command: Input","name":""},{"index":1,"entry_type":"Command: Run","name":"list_invoices"},{"index":2,"entry_type":"Notification: Run"},{"index":3,"entry_type":"Command: Run","name":"refund"},{"index":4,"entry_type":"Notification: Run"},{"index":5,"entry_type":"Command: Output","name":""}]}
```

六条:输入、查发票(发起和结果各一条)、退款(各一条)、输出。比 Temporal 的 19 行简洁,和我们自己的 `steps` 表最像。中间那一串 `'"'"'` 是 shell 里在单引号字符串中塞一个单引号的写法,把 id 换成你自己那次的 `invocationId`。

一个坑:如果你的终端开了代理(`echo $http_proxy` 有输出),curl 访问 localhost 可能也走代理,表现是一直卡住或者返回代理的错误页。加 `--noproxy '*'` 参数,或者先 `unset http_proxy https_proxy`。

## DBOS:只是一个库,日志放进你的数据库

DBOS 是库型。没有服务端,`import dbos`,给函数加两种装饰器:`@DBOS.workflow()` 和 `@DBOS.step()`。日志写进一个叫「系统数据库」的地方,生产上是 Postgres,开发时可以是一个 SQLite 文件。

新建 `part10/dbos_refund.py`:

```python
# agent-zero-lab/part10/dbos_refund.py
import os
import signal
import sqlite3
import sys

from dbos import DBOS, DBOSConfig, SetWorkflowID

import payments
from payments import create_refund

# DBOS 恢复时在后台线程里跑工作流,payments.py 那个连接默认只许创建它的线程用
payments.db = sqlite3.connect(os.environ.get("PAYMENTS_DB", "part10/payments.db"), check_same_thread=False)

config: DBOSConfig = {"name": "refund-demo", "system_database_url": "sqlite:///part10/dbos_sys.sqlite",
                      "log_level": "WARNING"}
DBOS(config=config)


@DBOS.step()
def list_invoices(customer_id: str) -> list[dict]:
    print("  [step] list_invoices 真正执行", flush=True)
    return [{"id": "INV-2290", "amount": 468}, {"id": "INV-2291", "amount": 468}]


@DBOS.step()
def refund(invoice_id: str, amount: int) -> dict:
    key = f"{DBOS.workflow_id}-{DBOS.step_id}"
    print("  [step] refund 真正执行,幂等键", key, flush=True)
    r = create_refund(invoice_id, amount, key)
    if os.environ.get("CRASH") == "1":
        os.kill(os.getpid(), signal.SIGKILL)  # 退款已成功,DBOS 还没记下这一步
    return r


@DBOS.workflow()
def refund_workflow(customer_id: str) -> str:
    invoices = list_invoices(customer_id)
    r = refund(invoices[-1]["id"], invoices[-1]["amount"])
    return f"已退 {r['amount']} 元,单号 {r['refund_id']}"


if __name__ == "__main__":
    DBOS.launch()
    if sys.argv[1] == "start":
        with SetWorkflowID("refund-C007"):
            print("结果:", refund_workflow("C007"))
    else:
        handle = DBOS.retrieve_workflow("refund-C007")
        print("结果:", handle.get_result())
    DBOS.destroy()
```

<div class="line-notes">

- `from dbos import DBOS, DBOSConfig, SetWorkflowID` `DBOS` 是主类,装饰器和工具函数都挂在它上面;`DBOSConfig` 是配置的类型;`SetWorkflowID` 用来指定工作流 id。
- `payments.db = sqlite3.connect(os.environ.get("PAYMENTS_DB", "part10/payments.db"), check_same_thread=False)` 和 Temporal 版一样的原因:DBOS 恢复工作流时是在后台线程里跑的。我第一次没加这行,恢复时报 `sqlite3.ProgrammingError: SQLite objects created in a thread can only be used in that same thread`。
- `config: DBOSConfig = {"name": "refund-demo", "system_database_url": "sqlite:///part10/dbos_sys.sqlite",` 配置是一个 dict。`system_database_url` 是日志存放的位置,`sqlite:///` 后面跟相对路径。换成 `postgresql://...` 就是生产用法。
- `"log_level": "WARNING"}` 只打警告以上的日志,不然启动信息会刷屏。
- `DBOS(config=config)` 创建全局唯一的 DBOS 实例。要在定义工作流之前调用。
- `@DBOS.step()` 等价于我们的 `run.step`,只不过写在函数定义上,调用这个函数时自动「先查日志、没有再执行并记录」。
- `key = f"{DBOS.workflow_id}-{DBOS.step_id}"` 在 step 里能读到当前工作流 id 和这一步的序号。实跑出来是 `refund-C007-2`:查发票是第 1 步,退款是第 2 步。和我们的「运行 id + 序号」完全一样。
- `@DBOS.workflow()` 工作流函数。和 Temporal 一样,它要确定性,因为会被重放;不一样的是 DBOS 没有沙箱,靠你自觉。
- `invoices = list_invoices(customer_id)` 看起来就是普通的函数调用,装饰器在背后完成了记录和重放。这是库型方案最大的卖点:代码几乎不用改形状。
- `DBOS.launch()` 启动 DBOS。**这一行会扫描系统数据库里还没完成的工作流,在后台把它们恢复。**恢复就发生在这里。
- `with SetWorkflowID("refund-C007"):` 在这个 `with` 块里发起的工作流用这个 id。不指定的话 DBOS 会生成一个随机 id。
- `handle = DBOS.retrieve_workflow("refund-C007")` 恢复模式下,`launch()` 已经在后台把它跑起来了,这里只是拿到把手。
- `print("结果:", handle.get_result())` 等它跑完,取结果。
- `DBOS.destroy()` 退出前关掉后台线程和数据库连接。

</div>

```bash
rm -f part10/payments.db part10/dbos_sys.sqlite
CRASH=1 uv run python part10/dbos_refund.py start; echo "exit=$?"
uv run python part10/dbos_refund.py resume; echo "exit=$?"
sqlite3 part10/payments.db "SELECT * FROM refunds"
```

```text
  [step] list_invoices 真正执行
  [step] refund 真正执行,幂等键 refund-C007-2
exit=137
  [step] refund 真正执行,幂等键 refund-C007-2
结果: 已退 468 元,单号 RF-1
exit=0
RF-1|INV-2291|468|refund-C007-2
```

和前两家一样的结果。DBOS 的日志就在那个 SQLite 文件里,打开看:

```bash
sqlite3 -header part10/dbos_sys.sqlite "SELECT workflow_uuid, function_id, function_name, substr(output,1,24) FROM operation_outputs"
sqlite3 -header part10/dbos_sys.sqlite "SELECT workflow_uuid, status, name, recovery_attempts FROM workflow_status"
```

```text
workflow_uuid|function_id|function_name|substr(output,1,24)
refund-C007|1|list_invoices|gASVOwAAAAAAAABdlCh9lCiM
refund-C007|2|refund|gASVSAAAAAAAAAB9lCiMCXJl
workflow_uuid|status|name|recovery_attempts
refund-C007|SUCCESS|refund_workflow|2
```

`operation_outputs` 这张表几乎就是我们的 `steps` 表:工作流 id、步骤序号、步骤名、结果。结果那一列是 `gASV` 开头的一串,这是 Python 的 pickle(把任意 Python 对象序列化成字节的标准库格式)再做 base64 编码,不是我们用的 JSON。`workflow_status` 表记着每个工作流的状态,`recovery_attempts` 是 2,说明这个工作流被执行过两次:第一次被杀,第二次在 `launch()` 里被恢复。

DBOS 恢复的规则写在它的架构文档里:单机部署时,进程启动时扫描所有 `PENDING` 状态的工作流并重新执行;多机部署时,需要它的商业控制台 Conductor 去协调,在某台机器断开一段时间后,让另一台去恢复它的工作流,或者你自己调接口来做。也就是说,「谁来恢复」这个问题 DBOS 在单机上帮你解决了,多机上要么买,要么自己写。

## LangGraph checkpoint:粒度是节点

LangGraph 也是库型,而且你已经在 [Day 318](/blog/agent-zero/day-318-lg-sqlite-saver/) 用过它的 SqliteSaver:每个节点跑完存一次状态,进程重启后用同一个 `thread_id` 接着跑。今天要看清楚的是它和前三家在**粒度**上的差别。

Temporal、Restate、DBOS 记录的是一个个「步骤」,一次工具调用就是一步。LangGraph 记录的是一个个「节点」,一个节点里可以做好几件事。节点做到一半死了,恢复时整个节点重跑。

新建 `part10/lg_refund.py`,故意把退款和写回复放在同一个节点里:

```python
# agent-zero-lab/part10/lg_refund.py
import os
import signal
import sqlite3
import sys
from typing import TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph

from payments import create_refund


class In(TypedDict):  # 启动时只给这一项
    customer_id: str


class S(In):  # 完整的状态:继承 In,再加三项
    invoices: list[dict]
    refund: dict
    reply: str


def lookup(state: S) -> dict:
    print("  [node] lookup 真正执行", flush=True)
    return {"invoices": [{"id": "INV-2290", "amount": 468}, {"id": "INV-2291", "amount": 468}]}


def refund_and_reply(state: S) -> dict:  # 一个节点里先退款、再写回复
    dup = state["invoices"][-1]
    key = f"{THREAD}-refund"
    print("  [node] refund_and_reply 真正执行,幂等键", key, flush=True)
    r = create_refund(dup["id"], dup["amount"], key)
    if os.environ.get("CRASH") == "1":
        os.kill(os.getpid(), signal.SIGKILL)  # 节点做到一半:退款成功,回复还没写
    return {"refund": r, "reply": f"多扣的 468 元已退回,单号 {r['refund_id']}"}


g = StateGraph(S, input_schema=In)
g.add_node("lookup", lookup)
g.add_node("refund_and_reply", refund_and_reply)
g.add_edge(START, "lookup")
g.add_edge("lookup", "refund_and_reply")
g.add_edge("refund_and_reply", END)

THREAD = sys.argv[2]
conn = sqlite3.connect("part10/lg_checkpoints.db", check_same_thread=False)
app = g.compile(checkpointer=SqliteSaver(conn))
config: RunnableConfig = {"configurable": {"thread_id": THREAD}}

if __name__ == "__main__":
    if sys.argv[1] == "start":
        out = app.invoke({"customer_id": "C007"}, config)
    else:
        print("  恢复前停在:", app.get_state(config).next, flush=True)
        out = app.invoke(None, config)
    print("回复:", out["reply"])
```

<div class="line-notes">

- `class In(TypedDict):  # 启动时只给这一项` 图的输入只有客户 id。单独定义输入类型,是为了 `invoke({"customer_id": "C007"})` 时类型检查器不报「缺了 invoices」。
- `class S(In):  # 完整的状态:继承 In,再加三项` TypedDict 可以继承,`S` 有四个键。
- `def refund_and_reply(state: S) -> dict:  # 一个节点里先退款、再写回复` 今天的重点。这个节点里有一个副作用(退款)和一个普通计算(写回复)。
- `key = f"{THREAD}-refund"` 用 `thread_id` 加步骤名做幂等键。`THREAD` 是下面定义的模块级变量,函数被调用时它已经有值了。
- `os.kill(os.getpid(), signal.SIGKILL)  # 节点做到一半:退款成功,回复还没写` 死在节点中间。
- `g = StateGraph(S, input_schema=In)` 建图,完整状态是 `S`,输入只要 `In`。
- `THREAD = sys.argv[2]` 第二个命令行参数是线程 id,每次实验换一个就不会互相影响。
- `app = g.compile(checkpointer=SqliteSaver(conn))` 编译时挂上 checkpointer,每个节点跑完会存一次状态。
- `print("  恢复前停在:", app.get_state(config).next, flush=True)` 恢复前先看看 checkpoint 里记着「下一个要跑的节点」是谁。
- `out = app.invoke(None, config)` 输入传 `None`,意思是「不是新开始,从这个线程上次停下的地方接着跑」([Day 318](/blog/agent-zero/day-318-lg-sqlite-saver/) 讲过)。

</div>

```bash
rm -f part10/payments.db part10/lg_checkpoints.db
CRASH=1 uv run python part10/lg_refund.py start t1; echo "exit=$?"
uv run python part10/lg_refund.py resume t1
sqlite3 part10/payments.db "SELECT * FROM refunds"
```

```text
  [node] lookup 真正执行
  [node] refund_and_reply 真正执行,幂等键 t1-refund
exit=137
  恢复前停在: ('refund_and_reply',)
  [node] refund_and_reply 真正执行,幂等键 t1-refund
回复: 多扣的 468 元已退回,单号 RF-1
RF-1|INV-2291|468|t1-refund
```

`lookup` 的结果被 checkpoint 存下了,没有重跑;`refund_and_reply` 整个重跑,退款又调了一次。这次只有一笔,全靠幂等键。练习 3 会去掉键,你会看到两笔。

所以用 LangGraph 时有一条规矩:**有副作用的操作单独成一个节点,并且照样带幂等键**。把它拆开,新建 `part10/lg_split.py`,三个节点:查发票、只退款、只写回复,这次死在写回复里:

```python
# agent-zero-lab/part10/lg_split.py
import os
import signal
import sqlite3
import sys
from typing import Literal, TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph

from payments import create_refund


class In(TypedDict):
    customer_id: str


class S(In):
    invoices: list[dict]
    refund: dict
    reply: str


def lookup(state: S) -> dict:
    return {"invoices": [{"id": "INV-2290", "amount": 468}, {"id": "INV-2291", "amount": 468}]}


def do_refund(state: S) -> dict:  # 只做退款这一件有副作用的事
    dup = state["invoices"][-1]
    print("  [node] do_refund 真正执行", flush=True)
    return {"refund": create_refund(dup["id"], dup["amount"], f"{THREAD}-refund")}


def write_reply(state: S) -> dict:
    print("  [node] write_reply 真正执行", flush=True)
    if os.environ.get("CRASH") == "1":
        os.kill(os.getpid(), signal.SIGKILL)  # 这次死在写回复里,退款那个节点已经做完
    return {"reply": f"多扣的 468 元已退回,单号 {state['refund']['refund_id']}"}


g = StateGraph(S, input_schema=In)
g.add_node("lookup", lookup)
g.add_node("do_refund", do_refund)
g.add_node("write_reply", write_reply)
g.add_edge(START, "lookup")
g.add_edge("lookup", "do_refund")
g.add_edge("do_refund", "write_reply")
g.add_edge("write_reply", END)

THREAD = sys.argv[2]
DURABILITY: Literal["sync", "async"] = "sync" if os.environ.get("SYNC") == "1" else "async"
app = g.compile(checkpointer=SqliteSaver(sqlite3.connect("part10/lg_checkpoints.db", check_same_thread=False)))
config: RunnableConfig = {"configurable": {"thread_id": THREAD}}

if __name__ == "__main__":
    out = app.invoke({"customer_id": "C007"} if sys.argv[1] == "start" else None, config, durability=DURABILITY)
    print("回复:", out["reply"])
```

<div class="line-notes">

- `def do_refund(state: S) -> dict:  # 只做退款这一件有副作用的事` 退款单独成节点。节点跑完 checkpoint 一存,以后就不会再执行。
- `os.kill(os.getpid(), signal.SIGKILL)  # 这次死在写回复里,退款那个节点已经做完` 按理说,恢复时应该只重跑 `write_reply`。先别急,看输出。
- `DURABILITY: Literal["sync", "async"] = "sync" if os.environ.get("SYNC") == "1" else "async"` 这是今天在 LangGraph 里发现的一个关键参数。`Literal["sync", "async"]` 是类型标注,意思是这个变量只能是这两个字符串之一。默认用 `"async"`,设了环境变量 `SYNC=1` 就用 `"sync"`。
- `out = app.invoke({"customer_id": "C007"} if sys.argv[1] == "start" else None, config, durability=DURABILITY)` `durability` 参数控制 checkpoint 什么时候写进数据库。

</div>

先用默认的 `async` 跑,再用 `sync` 跑:

```bash
rm -f part10/payments.db part10/lg_checkpoints.db
CRASH=1 uv run python part10/lg_split.py start t3; echo "exit=$?"
uv run python part10/lg_split.py resume t3

rm -f part10/payments.db part10/lg_checkpoints.db
SYNC=1 CRASH=1 uv run python part10/lg_split.py start t3; echo "exit=$?"
SYNC=1 uv run python part10/lg_split.py resume t3
```

默认 `async`:

```text
  [node] do_refund 真正执行
  [node] write_reply 真正执行
exit=137
  [node] do_refund 真正执行
  [node] write_reply 真正执行
回复: 多扣的 468 元已退回,单号 RF-1
```

`sync`:

```text
  [node] do_refund 真正执行
  [node] write_reply 真正执行
exit=137
  [node] write_reply 真正执行
回复: 多扣的 468 元已退回,单号 RF-1
```

这个结果我第一次看到也愣了一下。拆了节点,默认设置下恢复时 `do_refund` 居然还是重跑了。去 LangGraph 源码里查 `durability` 的说明(`langgraph/types.py`),三种取值写得很清楚:`"sync"` 是在下一步开始前同步写完 checkpoint;`"async"` 是一边跑下一步一边在后台写;`"exit"` 是只在图退出时写。`invoke` 不传这个参数时默认是 `"async"`(`langgraph/pregel/main.py` 里写着 defaults to `"async"`)。

也就是说,`do_refund` 的 checkpoint 还在后台排队,`write_reply` 已经开始跑,这时进程被杀,那个 checkpoint 就丢了。两种情况下支付系统里都只有 RF-1 一笔,还是幂等键兜住的。结论有两条:有副作用的节点要么带幂等键(一定要带),要么在关键流程上用 `durability="sync"`,多付一点写库的延迟换确定性。我们自己的运行器在 `put` 里每步都同步 commit,相当于一直是 `sync`。

LangGraph 的定位和前三家不一样:它是画 Agent 图的框架,checkpoint 是附带的持久化,没有服务端,不会自动发现死掉的进程,也没有跨进程的租约。它的 `interrupt()` 能让图停下来等人审批([Day 319](/blog/agent-zero/day-319-lg-interrupt/)),停的时候不占进程,状态在 checkpoint 里,恢复靠你自己的代码用 `Command(resume=...)` 把它叫起来。

## 四个缺口,四家怎么补

回到 Day 537 的清单。下面这张表是我根据今天的实跑和各家文档整理的,「实跑」两个字表示今天亲眼看到了,其余来自文档:

| 缺口 | 我们的 `durable_runner.py` | Temporal | Restate | DBOS | LangGraph checkpoint |
| --- | --- | --- | --- | --- | --- |
| 谁来发现挂掉并恢复(调度) | 没人,手动重敲命令 | 服务端靠 activity 超时发现,派给活着的 worker(实跑) | 服务端不断重试调用你的服务(实跑) | 单机:进程启动 `launch()` 时扫 PENDING 并恢复(实跑);多机:Conductor 或自己调接口 | 没有,自己调 `invoke(None, config)` |
| 两个进程同时恢复同一次运行(租约) | 没有,Day 537 练习 2 自己加了租约表 | 服务端统一派活,同一个工作流 id 同时只能有一个在跑 | 服务端统一调用,同一个 key 的工作流只跑一次 | 工作流按 id 去重,每个工作流记着属于哪个执行者 | 没有,要自己保证同一个 thread 不被两处同时 invoke |
| 日志越积越多(归档) | 没有 | 历史上限 51,200 事件或 50 MB,用 Continue-As-New 开新运行;命名空间有保留期 | 日志存在服务端,有保留期配置 | 日志在你的 Postgres,清理策略要配 | checkpoint 一直累积,要自己清 |
| 等人、等几天(长时间等待) | 没有,只能 `sleep` | signal + `wait_condition`,等待时不占 worker(练习 1 实跑);持久化定时器 | `ctx.sleep`、awakeable(外部回调唤醒)、工作流的 durable promise | `DBOS.sleep`(练习 2 实跑)、`DBOS.recv` / `DBOS.send` 收发消息 | `interrupt()` 加 `Command(resume=...)` |
| 非确定性 | 指纹检测,对不上就抛异常 | 沙箱当场拦截(实跑),重放时还会比对 | 日志按顺序比对 | 靠自觉 | 节点粒度,节点内部靠自觉 |
| 副作用去重 | 幂等键 = 运行 id + 序号 | 一样要自己带幂等键,`workflow_id + activity_id` 是现成的(实跑) | 一样要自己带,`ctx.key()` + 步骤名(实跑) | 一样要自己带,`workflow_id + step_id`(实跑) | 一样要自己带,而且节点会整个重跑(实跑) |

最后一行要特别记住:**四家没有一家能替你保证外部系统不重复执行**。它们都只是保证「至少执行一次,并且结果记下来以后不再执行」,和我们 Day 536 推出来的结论一模一样。窗口还是那个窗口,幂等键还是你的事。

## 什么时候值得引入,引入哪个

先说要不要。我的判断标准是三条,满足任意两条就值得认真考虑:

1. 任务会跨越发版窗口。你们每天下午发版,而一个任务要跑半小时以上,那一定有任务会被发版打断。
2. 任务里有不可逆的副作用:动钱、对外发消息、改客户的订阅。
3. 要等人:审批、等客户补充资料、等第三方回调。

只满足一条的话,[Day 393](/blog/agent-zero/day-393-resume/) 的任务队列加断点续跑,再加上幂等键,通常就够了。SupportPilot 的退款流程三条全中:等主管审批可能跨夜,退款动钱,而且一定会碰上发版。

再说选哪个。我会这样想:

**已经在用 LangGraph,只是想要进程重启后接着跑**:先用它自带的 checkpoint,把副作用拆成单独节点、带幂等键、关键图用 `durability="sync"`。它不管调度和租约,所以要么只跑一个实例,要么自己在外面加一层。

**团队小,已经有 Postgres,不想多运维一套服务**:DBOS。代码改动最小,加两种装饰器;日志就在自己的库里,用 SQL 能查,备份跟着数据库走。代价是多机恢复要买它的 Conductor 或者自己写。

**流程是跨团队的核心业务,要长期、高可靠地跑,而且有人能负责运维**:Temporal。它最成熟、功能最全(信号、定时器、版本化、可视化界面),2026 年 9 月拿了 5.5 亿美元的 E 轮融资(估值 125.5 亿美元,这是公司公告和媒体报道的数字),很多 Agent 平台在用它。代价是要运维一套服务(或者付钱用 Temporal Cloud),以及团队要学会它的确定性约束。

**想要独立服务型的自动恢复,但不想背 Temporal 的运维**:Restate。一个二进制就能跑,你的代码就是普通的 HTTP 服务,也能部署在 Lambda 这种按调用计费的平台上,等待的时候不花钱。它比 Temporal 年轻,社区和案例少一些。

有一个成本很容易被忽略:引入这些系统,花的力气主要不在代码,而在**团队要学会它的约束**。今天 Temporal 沙箱拦住 `datetime.now()` 的那一下,如果团队里只有你懂为什么,它很快会变成一个没人敢动的黑盒。所以我建议在设计文档里写清楚三件事:为什么要它(对应上面三条里的哪几条);团队里谁负责;什么情况下退回更简单的方案。[Day 542](/blog/agent-zero/day-542-design-doc-1/) 开始写设计文档时会用上。

## 动手练习

**练习 1:等主管审批,等的时候 worker 可以死。** 用 Temporal 写一个工作流:启动后停下来等一个叫 `approve` 的信号(signal,从外部发给运行中工作流的消息),收到 `True` 才退款。验证三件事:等待期间把 worker 杀掉,工作流不受影响;没有任何 worker 在跑的时候也能发信号;重新起 worker 后流程走完。

<details><summary>参考答案</summary>

新建 `part10/ex539_approval.py`:

```python
# agent-zero-lab/part10/ex539_approval.py
import asyncio
import os
import sys
from datetime import timedelta

from temporalio import activity, workflow
from temporalio.client import Client
from temporalio.worker import Worker


@activity.defn
def refund(invoice_id: str, amount: int) -> str:
    print(f"  [activity] 退款 {invoice_id} {amount} 元", flush=True)
    return f"已退 {amount} 元"


@workflow.defn
class ApprovalWorkflow:
    def __init__(self) -> None:
        self.approved: bool | None = None

    @workflow.signal
    def approve(self, ok: bool) -> None:
        self.approved = ok

    @workflow.run
    async def run(self, invoice_id: str) -> str:
        workflow.logger.info("等主管审批")
        await workflow.wait_condition(lambda: self.approved is not None)
        if not self.approved:
            return "主管拒绝,转人工"
        return await workflow.execute_activity(refund, args=[invoice_id, 468],
                                               start_to_close_timeout=timedelta(seconds=10))


async def main(cmd: str) -> None:
    client = await Client.connect("localhost:7233")
    if cmd == "worker":
        from concurrent.futures import ThreadPoolExecutor
        print("worker 已启动,pid", os.getpid(), flush=True)
        await Worker(client, task_queue="approvals", workflows=[ApprovalWorkflow],
                     activities=[refund], activity_executor=ThreadPoolExecutor(2)).run()
    elif cmd == "start":
        h = await client.start_workflow(ApprovalWorkflow.run, "INV-2291", id="approve-C007", task_queue="approvals")
        print("已提交,工作流 id:", h.id)
    elif cmd == "approve":
        await client.get_workflow_handle("approve-C007").signal(ApprovalWorkflow.approve, True)
        print("已发送审批信号")
    else:
        print("结果:", await client.get_workflow_handle("approve-C007").result())


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
```

<div class="line-notes">

- `self.approved: bool | None = None` 工作流对象上的一个字段,三种状态:还没审批(None)、同意(True)、拒绝(False)。
- `@workflow.signal` 把这个方法登记成信号处理函数。外部发来 `approve` 信号时,Temporal 先把「收到信号」写进事件历史,再调用这个方法。重放时,信号也会按历史里的顺序再送一次,所以 `self.approved` 能被重建出来。
- `workflow.logger.info("等主管审批")` 工作流里打日志要用 `workflow.logger`,它在重放时不会重复打印。
- `await workflow.wait_condition(lambda: self.approved is not None)` 停在这里,直到条件为真。**停着的时候不占任何进程**:worker 把这个工作流交还给服务端,服务端记着它在等。
- `h = await client.start_workflow(ApprovalWorkflow.run, "INV-2291", id="approve-C007", task_queue="approvals")` `start_workflow` 只发起不等结果,马上返回。
- `await client.get_workflow_handle("approve-C007").signal(ApprovalWorkflow.approve, True)` 按工作流 id 拿到把手,发信号。这一步只和服务端打交道,和有没有 worker 无关。在真实系统里,这一行放在主管点「同意」按钮的那个接口里。

</div>

```bash
uv run python part10/ex539_approval.py worker > ap1.out 2>&1 & sleep 5
uv run python part10/ex539_approval.py start; sleep 2
pkill -9 -f "ex539_approval.py worker"; sleep 1
echo "worker 已被杀: $(pgrep -f 'ex539_approval.py worker' | wc -l) 个在跑"
uv run python part10/ex539_approval.py approve
uv run python part10/ex539_approval.py worker > ap2.out 2>&1 & sleep 20
uv run python part10/ex539_approval.py result
cat ap2.out
```

```text
已提交,工作流 id: approve-C007
worker 已被杀:        0 个在跑
已发送审批信号
结果: 已退 468 元
worker 已启动,pid 83844
  [activity] 退款 INV-2291 468 元
```

`pkill -f` 按命令行匹配进程并发信号,`-9` 就是 SIGKILL。我用它而不是 `kill $!`,原因在「常见误区」第一条。发审批信号时一个 worker 都没有,信号照样被服务端收下了。事件历史里能看到它:

```text
    1  2026-10-22T10:57:07Z  WorkflowExecutionStarted
    2  2026-10-22T10:57:07Z  WorkflowTaskScheduled
    3  2026-10-22T10:57:07Z  WorkflowTaskStarted
    4  2026-10-22T10:57:07Z  WorkflowTaskCompleted
    5  2026-10-22T10:57:12Z  WorkflowExecutionSignaled
    6  2026-10-22T10:57:12Z  WorkflowTaskScheduled
    7  2026-10-22T10:57:22Z  WorkflowTaskTimedOut
    8  2026-10-22T10:57:22Z  WorkflowTaskScheduled
   ...
   17  2026-10-22T10:57:22Z  WorkflowExecutionCompleted
```

第 4 行之后工作流就在等,第 5 行信号到了。第 7 行又是 sticky 那 10 秒(老 worker 已死)。新 worker 领到后从头重放:走到 `wait_condition`,历史里有信号,`self.approved` 是 True,直接往下退款。这里把 20 秒的等待换成两天,机制完全一样,这正是 Day 537 缺的「长时间等待和外部唤醒」。

</details>

**练习 2:DBOS 版的「能被杀的定时器」。** Day 537 练习 1 自己写了 `durable_sleep`。用 DBOS 的 `DBOS.sleep` 写同一个流程:发催款邮件,睡 6 秒,返回「醒了」。睡到一半杀掉,重启后看它还睡多久,再去系统数据库里找它把「几点醒」记在了哪里。

<details><summary>参考答案</summary>

新建 `part10/ex539_dbos_sleep.py`:

```python
# agent-zero-lab/part10/ex539_dbos_sleep.py
import time

from dbos import DBOS, DBOSConfig, SetWorkflowID

config: DBOSConfig = {"name": "sleep-demo", "system_database_url": "sqlite:///part10/dbos_sleep.sqlite",
                      "log_level": "WARNING"}
DBOS(config=config)
T0 = time.time()


@DBOS.step()
def send_email() -> str:
    print("  [step] 发催款邮件", flush=True)
    return "已发催款邮件"


@DBOS.workflow()
def remind() -> str:
    send_email()
    DBOS.sleep(6)  # 持久化的睡眠:醒来时间记在系统库里
    return "醒了"


if __name__ == "__main__":
    DBOS.launch()
    if DBOS.get_workflow_status("remind-C007") is None:
        with SetWorkflowID("remind-C007"):
            r = remind()
    else:  # 上次没跑完:launch() 已经在后台把它恢复了,这里只等结果
        r = DBOS.retrieve_workflow("remind-C007").get_result()
    print("结果:", r, "| 本进程用时", round(time.time() - T0, 1), "秒")
    DBOS.destroy()
```

<div class="line-notes">

- `T0 = time.time()` 记下进程开始的时间(在 import 之后),最后打印本进程花了多久。这里在工作流外面,直接读时钟没问题。
- `DBOS.sleep(6)  # 持久化的睡眠:醒来时间记在系统库里` 和我们的 `durable_sleep` 一个思路:第一次执行时把「几点醒」写进日志,恢复后只睡剩下的。它本身就是一个被记录的步骤。
- `if DBOS.get_workflow_status("remind-C007") is None:` 查这个 id 的工作流存不存在。不存在才新发起;存在说明是上次没跑完的,`launch()` 已经把它恢复了。同一个脚本两种情况都能跑。
- `r = DBOS.retrieve_workflow("remind-C007").get_result()` 等后台恢复的那个跑完。

</div>

```bash
rm -f part10/dbos_sleep.sqlite
uv run python part10/ex539_dbos_sleep.py & sleep 6; pkill -9 -f "python part10/ex539_dbos_sleep.py"; wait; echo "killed at $(date +%T)"
uv run python part10/ex539_dbos_sleep.py; date +%T
sqlite3 -header part10/dbos_sleep.sqlite "SELECT function_id, function_name, started_at_epoch_ms, completed_at_epoch_ms FROM operation_outputs"
```

```text
  [step] 发催款邮件
killed at 18:53:50
结果: 醒了 | 本进程用时 1.1 秒
18:53:54
function_id|function_name|started_at_epoch_ms|completed_at_epoch_ms
1|send_email|1792666425990|1792666425992
2|DBOS.sleep|1792666425996|1792666431997
```

第二次运行邮件没有再发,只睡了 1.1 秒。`DBOS.sleep` 在 `operation_outputs` 里是第 2 步,`completed_at_epoch_ms` 减 `started_at_epoch_ms` 正好是 6001 毫秒:它在开始睡的时候就把「醒来的时刻」算好记进去了,和我们 `durable_sleep` 记 `wake_at` 是同一个做法。邮件在 18:53:45.99 发出(把毫秒时间戳换算成北京时间),18:53:50 被杀,睡了约 4 秒;恢复进程的 import 和启动又花了两三秒,剩下的 1.1 秒在 `T0` 之后睡完。

</details>

**练习 3:LangGraph 节点里不带幂等键。** 把 `lg_refund.py` 里的 `key` 改成 `None`(另存为 `part10/ex539_lg_nokey.py`),同样在节点中间杀掉再恢复,支付系统里有几笔退款?

<details><summary>参考答案</summary>

只改一行:

```python
    key = None  # 去掉幂等键
```

<div class="line-notes">

- `key = None  # 去掉幂等键` `payments.create_refund` 收到 `None` 时跳过「这个键见过没有」的检查,直接新建一笔。

</div>

```bash
rm -f part10/payments.db part10/lg_checkpoints.db
CRASH=1 uv run python part10/ex539_lg_nokey.py start t2; echo "exit=$?"
uv run python part10/ex539_lg_nokey.py resume t2
sqlite3 part10/payments.db "SELECT * FROM refunds"
```

```text
  [node] lookup 真正执行
  [node] refund_and_reply 真正执行,幂等键 None
exit=137
  恢复前停在: ('refund_and_reply',)
  [node] refund_and_reply 真正执行,幂等键 None
回复: 多扣的 468 元已退回,单号 RF-2
RF-1|INV-2291|468|
RF-2|INV-2291|468|
```

两笔,客户多拿了 468 元。回复里的单号是 RF-2,第一次那笔 RF-1 在任何日志里都看不到,只有去支付系统查才知道。checkpoint 让流程「看起来」正确地走完了,这正是最危险的地方。

</details>

**练习 4(开放题):给一个场景选型。** CloudLedger 的财务团队想要一个「月底对账 Agent」:每月 1 号凌晨对 3000 个客户逐个核对上月账单,发现多扣的就自动发起退款(每笔退款要财务主管在后台点同意),整个过程大概跑 6 小时。团队 4 个人,已经有 Postgres,没有人运维过 Temporal,Agent 本身是用 LangGraph 写的。你会选哪个方案?写半页理由,要对上「三条标准」和「四个缺口」。

<details><summary>参考答案</summary>

一个示范答案(不唯一):

三条标准全中:跑 6 小时一定会碰上发版或机器回收;退款动钱;每笔要等主管同意。所以值得引入持久化执行,不能只靠 LangGraph 的 checkpoint。

我会选 DBOS。理由:团队只有 4 个人,已经有 Postgres,多运维一套 Temporal 集群对这个团队太重;DBOS 只是一个库,日志进现有的 Postgres,出了问题能直接用 SQL 查 `operation_outputs`。形状上,把「3000 个客户」做成 3000 个子工作流,每个客户一个工作流 id(比如 `recon-2026-10-C007`),天然按 id 去重,同一个客户不会被处理两次;每个工作流里核对、发起退款申请是 step,退款带 `workflow_id + step_id` 的幂等键;等主管审批用 `DBOS.recv`,后台点同意时用 `DBOS.send` 把消息发给对应工作流。LangGraph 的图可以留在每个客户的核对步骤里面用,外层编排交给 DBOS。

四个缺口逐条对:调度,单机部署时进程重启 `launch()` 会恢复所有 PENDING 的工作流,先只跑一个实例,规模上去了再评估 Conductor;租约,工作流 id 去重;归档,每月 3000 个工作流,要配清理策略,保留三个月够审计;长等待,`DBOS.recv` 加超时,超过 48 小时没人批就转人工。

什么时候推翻:如果对账要扩到多个团队共用、或者要跑在多台机器上而又不想买 Conductor,换 Temporal 重新评估。

用实跑验证这个选型,最少做一件事:拿 10 个假客户跑一遍,在第 5 个客户的退款步骤里 `kill -9`,恢复后查支付表只有一笔、10 个工作流全部 SUCCESS。今天的 `dbos_refund.py` 就是这个实验的一个客户版。

</details>

**验收标准**:四个方案的退款流程都在本机跑过「杀掉再恢复」,每个都能说出它的日志存在哪、怎么看;练习 1 的工作流在没有 worker 时收到了信号并最终退款;练习 3 亲眼看到两笔退款;能不看表格说出四个缺口在四家分别怎么补,以及「哪一家都不替你做幂等」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 独立服务型 | 持久化执行要多跑一个服务端进程保存日志、派活,你的代码连上去干活。Temporal、Restate 属于这类 |
| 库型 | 只是一个 Python 包,日志写进你自己的数据库,恢复由你的进程启动时完成。DBOS、LangGraph checkpoint 属于这类 |
| workflow(Temporal) | 编排步骤的那段代码,会被重放,必须确定性 |
| activity(Temporal) | 被记录的一步(调接口、调模型),结果进事件历史,重放时直接取 |
| worker | 你启动的进程,连上 Temporal 服务端,从任务队列领活执行 |
| task queue | Temporal 里派活用的队列名字,发起方和 worker 写同一个名字才能对上 |
| 事件历史 event history | Temporal 服务端为每个工作流存的事件列表,相当于我们的 `steps` 表 |
| 沙箱 sandbox(Temporal) | Temporal Python SDK 运行 workflow 代码的隔离环境,直接读时钟、取随机数会被拦下 |
| `start_to_close_timeout` | 一次 activity 最多执行多久,超时服务端就当它失败并重试,也是发现 worker 死掉的办法 |
| sticky 缓存 | Temporal 优先把同一个工作流的活派给上次处理它的 worker,那个 worker 死了要等超时改派 |
| Continue-As-New | Temporal 里把当前状态带过去开一个新运行,用来避免历史超过上限 |
| signal 信号 | 从外部发给运行中的 Temporal 工作流的消息,常用来实现审批 |
| journal(Restate) | Restate 服务端为每次调用存的日志,可以用 `/query` 接口查 `sys_journal` 表 |
| `ctx.run_typed` | Restate 里把一个函数作为被记录的步骤执行,相当于 `run.step` |
| `@DBOS.step()` / `@DBOS.workflow()` | DBOS 的两个装饰器,分别对应「被记录的一步」和「编排代码」 |
| 系统数据库 | DBOS 存工作流状态和步骤结果的数据库,表 `workflow_status`、`operation_outputs` |
| pickle | Python 标准库的对象序列化格式,DBOS 用它存步骤结果 |
| durability(LangGraph) | checkpoint 什么时候写进数据库:`sync` 同步写完再走、`async` 后台写(默认)、`exit` 退出时才写 |
| ASGI | Python 异步 Web 应用的接口标准,FastAPI、Restate 的 app 都是 ASGI 应用,由 uvicorn、hypercorn 这类服务器跑起来 |

## 常见误区

**用 `kill $!` 杀 `uv run` 起的后台进程,以为杀掉了。** 我做练习 2 时第一次写的是 `uv run python ... & P=$!; kill -9 $P`。`$!` 拿到的是 `uv` 这个进程的 pid,杀掉的是 `uv`,真正跑 Python 的子进程还活着,而且继续睡完了 6 秒。结果 DBOS 日志里打出 `Workflow remind-C007 outcome was not recorded: the workflow is no longer owned by this execution. Waiting for the recorded outcome`,两个进程在跑同一个工作流。要杀就按命令行匹配杀 Python 进程:`pkill -9 -f "python part10/xxx.py"`,或者像今天大部分实验那样在代码里 `os.kill(os.getpid(), ...)` 自杀。

**以为用了 Temporal 就不用幂等键。** Temporal 保证的是 activity 结果记下来以后不再执行,但「执行完、没报告就死了」这个窗口还在,今天的第 2 次尝试就是在这个窗口之后发生的。四家都一样。

**在 Temporal 工作流里直接用 `datetime.now()`、`random`、`uuid4()`。** 沙箱会拦下来,而且工作流不会失败,而是一直卡在 Running 重试。要用 `workflow.now()`、`workflow.random()`、`workflow.uuid4()`,或者把这些放进 activity。

**以为 LangGraph 拆了节点就不会重跑副作用。** 默认 `durability="async"` 下,上一个节点的 checkpoint 可能还没写进去进程就死了,今天实跑里 `do_refund` 就重跑了。带幂等键;关键流程用 `durability="sync"`。

**Temporal CLI 连 `localhost:7233` 报 `context deadline exceeded`。** 在我的机器上是 `localhost` 先解析到 IPv6 的 `::1`,开发服务端只听 IPv4。命令加 `--address 127.0.0.1:7233`。

**上一次的服务没关干净,新服务起不来。** 起 Restate 服务时报 `OSError: [Errno 48] Address already in use`,是上一次的进程还占着 9080 端口。用 `lsof -iTCP:9080 -sTCP:LISTEN` 找到 pid 关掉([Day 77](/blog/agent-zero/day-077-server-1/) 讲过端口)。

**以为 DBOS 的 SQLite 模式可以直接上生产。** 文档里的架构是围绕 Postgres 讲的,SQLite 适合在本机学和写测试。多个进程同时初始化同一个 SQLite 系统库时,我遇到过 `table workflow_status already exists` 的迁移报错。

**只因为「Temporal 很火」就引入。** 先过三条标准,再看团队里有没有人能负责它。引入的成本主要是团队学习它的约束,不是那几十行代码。

## 学习资料

### 文档与文章

- [Temporal CLI 文档](https://docs.temporal.io/cli):`temporal server start-dev`、`workflow show`、`workflow terminate` 的用法。10 分钟。
- [Temporal Python SDK:沙箱](https://docs.temporal.io/develop/python/python-sdk-sandbox):沙箱拦什么、`imports_passed_through` 什么时候用。今天 `ex539_sandbox.py` 那个报错的来龙去脉。20 分钟。
- [Temporal Python SDK:消息传递](https://docs.temporal.io/develop/python/message-passing):signal、query、update 三种和运行中工作流打交道的方式,练习 1 用的是 signal。
- [Temporal:工作流执行的限制](https://docs.temporal.io/workflow-execution/limits):51,200 事件和 50 MB 两个上限的出处。
- [Restate:持久化执行的概念](https://docs.restate.dev/concepts/durable_execution):journal、重放、服务挂了以后怎么在另一个实例上重试。15 分钟。
- [Restate Python SDK 概览](https://docs.restate.dev/develop/python/overview):`ctx.run_typed`、`ctx.sleep`、awakeable 的写法。
- [DBOS 架构](https://docs.dbos.dev/architecture):单机和多机两种恢复方式,以及 Conductor 的作用。15 分钟。
- [DBOS 工作流教程](https://docs.dbos.dev/python/tutorials/workflow-tutorial):工作流 id、`SetWorkflowID`、`retrieve_workflow` 的完整说明。
- [LangGraph 持久化执行](https://docs.langchain.com/oss/python/langgraph/durable-execution):官方对「checkpoint 让图能恢复」的说明。`durability` 三种模式的定义我是在源码 `langgraph/types.py` 里读到的,文档里写得不全。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1PLeE6yEAo&autoplay=0&high_quality=1" title="Agent等待审批一个月也不崩溃?Restate持久化执行架构揭秘 | AI Engineer" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>量子菠萝_ · Agent 等待审批一个月也不崩溃?Restate 持久化执行架构揭秘 | AI Engineer · 21 分钟,Restate 创始人在 AI Engineer 大会的演讲搬运,讲事件日志、暂停不占算力和取消。播放量很低,但内容是第一手的,和今天的 Restate 一节、练习 1 的「等审批」正好对上。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1JNkFBMEFH&autoplay=0&high_quality=1" title="用Temporal构建持久化AI智能体 | AI Engineer" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>7k的每日搬运 · 用 Temporal 构建持久化 AI 智能体 | AI Engineer · 78 分钟的官方工作坊搬运,讲 Temporal 和 OpenAI Agents SDK 怎么结合。前 20 分钟讲 workflow、activity、worker 三个词,和今天的 Temporal 一节对着看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/YNds0IhKvgE" title="Building Durable Python Backends that Scale" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>DBOS-Inc · Building Durable Python Backends that Scale · DBOS 官方频道,演示装饰器怎么把普通 Python 函数变成可恢复的工作流,英文。看完对照今天的 `dbos_refund.py`。</figcaption>
</figure>

### 书籍

- Martin Kleppmann《Designing Data-Intensive Applications》(O'Reilly,2017),中文版《数据密集型应用系统设计》(中国电力出版社):第 11 章讲事件日志和流处理,Temporal 的事件历史、Restate 的 journal 背后都是这一章的思想。
- Michael T. Nygard《Release It!》(第 2 版,Pragmatic Bookshelf,2018):超时、重试、断路器这些稳定性模式,读完会明白为什么 Temporal 要你给每个 activity 配 `start_to_close_timeout`。

### 开源项目与代码

- [temporalio/samples-python](https://github.com/temporalio/samples-python):官方示例集,看 `hello` 目录里的 `hello_signal.py`(练习 1 的官方版)和 `sleep_for_days`(能睡好几天的工作流)。
- [restatedev/sdk-python](https://github.com/restatedev/sdk-python):Restate Python SDK 的源码和例子,`ctx.run_typed` 的实现可以和我们的 `step` 对照读。
- [dbos-inc/dbos-transact-py](https://github.com/dbos-inc/dbos-transact-py):DBOS 的 Python 实现。在 `dbos/_sys_db.py` 里搜 `operation_outputs`,能看到它「先查日志、没有再执行」的那段逻辑,和 Day 535 的 `step` 几乎一样。

## 自测

1. 独立服务型和库型持久化执行方案最本质的区别是什么?各举两个例子。

<details><summary>答案</summary>

区别在日志放在哪、谁来驱动恢复。独立服务型多一个服务端进程,日志在服务端,服务端发现你的进程挂了会把活派给活着的进程(Temporal、Restate);库型只是一个包,日志写进你自己的数据库,恢复由你的进程启动时自己做(DBOS、LangGraph checkpoint)。前者多运维一套服务换来自动调度,后者少一套服务但多机恢复要自己解决。

</details>

2. 今天 Temporal 那次实跑,worker 在退款后被杀,服务端是怎么知道要重试的?为什么新 worker 没有再查一次发票?

<details><summary>答案</summary>

服务端看不见 worker 进程,它只知道退款这个 activity 派出去 5 秒(`start_to_close_timeout`)了还没有结果,就当它失败,按重试策略重新派出,被新 worker 领到,这是第 2 次尝试。查发票的结果在第一次就已经作为 `ActivityTaskCompleted` 事件写进了事件历史,新 worker 重放工作流时直接从历史里取,不再执行。

</details>

3. 四个方案里,哪个能替你保证外部支付系统不会重复退款?

<details><summary>答案</summary>

一个都不能。它们都只保证「至少执行一次,结果记下来以后不再执行」。「外部已执行、结果没记下」的窗口一直存在,今天四个实验里恢复后都真的又调了一次退款接口,是支付系统认出幂等键才没有退第二笔。幂等键用各家现成的编号拼:Temporal 是 `workflow_id + activity_id`,DBOS 是 `workflow_id + step_id`,Restate 是 `ctx.key()` 加步骤名。

</details>

4. 用 LangGraph 时,把退款单独拆成一个节点,是否就保证恢复时不会重跑退款?

<details><summary>答案</summary>

不保证。今天实跑:默认 `durability="async"` 时,`do_refund` 的 checkpoint 在后台写,下一个节点已经开始跑,这时进程被杀,checkpoint 丢了,恢复时 `do_refund` 又执行了一次。改成 `durability="sync"` 后只重跑了 `write_reply`。所以拆节点要配合幂等键,关键流程用 `sync`。

</details>

5. 面试题:「你们的退款 Agent 要等主管审批,有时要等两天。你会怎么实现这个等待?不能接受的做法有哪些?」

<details><summary>答案</summary>

要点:等待必须不占进程、并且可被外部唤醒。跑在持久化执行系统上,用它的等待原语:Temporal 用 signal 加 `wait_condition`,DBOS 用 `recv`/`send`,Restate 用 awakeable 或工作流的 promise,LangGraph 用 `interrupt` 加 `Command(resume=...)`;主管点同意的接口里发信号;等待加超时,超时转人工。不能接受的做法:进程里 `sleep` 轮询两天(发版就丢);用内存变量记「在等谁」;把审批结果只写在前端。加分项:说出等待期间 worker 可以随便重启(今天练习 1 实测没有 worker 时也能收到信号),以及代码在等待期间发了新版本要考虑版本化。

</details>

6. 什么情况下你会建议**不**引入 Temporal 这类系统?

<details><summary>答案</summary>

三条标准(跨越发版窗口、有不可逆副作用、要等人)只满足一条或者都不满足时,任务队列加断点续跑再加幂等键就够了。另外,团队里没有人能负责它的运维和确定性约束时,即使满足条件,也应该先选更轻的方案(DBOS,或者已经在用的 LangGraph checkpoint),否则它会变成没人敢动的黑盒。

</details>

## 明天预告

Day 540 · 编排取舍(一):三篇文章三种立场,四种架构。这一周讲的 harness、上下文、记忆、持久化执行,都是一个 Agent 内部的零件。明天回到一个更大的问题:一个任务该用单 Agent、写死的工作流、多 Agent 还是混合?先把 Cognition、Anthropic、LangChain 2025 年那三篇吵架的文章和它们 2026 年的新说法摆在一起,再把四种架构用同一个退款任务各写一遍,看清楚每一种里「谁决定下一步」。
