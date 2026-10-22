---
title: 'Day 37 · 长任务与可靠性:队列、重试、幂等、超时、断点续跑'
description: '把跑十几分钟的批量工单处理从 HTTP 请求里挪到任务队列,用 arq 做异步 worker;分清哪些错误该重试、重试几层;用幂等键保证退款不会因为重试建两次;再用 LangGraph 的 checkpoint 让崩在半路的任务从断点接着跑。'
pubDate: 2026-10-12
regime: none
tags: ['queue', 'arq', 'retry', 'idempotency', 'timeout', 'durable-execution', 'agent-60']
series: 'agent-60'
day: 37
lang: 'zh'
---

## 今天要解决的问题

昨天的服务能接住一个用户的一轮对话。但 SupportPilot 真上线以后,还会遇到另一类活:

- 周一早上工单系统里积压了 300 张周末进来的工单,运营想让 Agent 先过一遍,把分类、优先级和回复草稿都填好,坐席上班直接审。
- 工单系统通过 webhook 推新工单过来,对方要求 5 秒内返回 200,否则判定失败并重发。
- 一个退款审批,主管周五晚上没点,周一早上才点。

这些都不是「用户发一句、服务回一句」的节奏。今天结束时你应该能:

1. 说清楚什么样的活必须挪出 HTTP 请求,放进任务队列;知道 Celery、RQ、arq、Dramatiq 的取舍,并且用 arq 写出一个能跑的 worker。
2. 把错误分成「该重试」和「不该重试」两类,知道重试应该放在哪一层,避免三层重试叠成三十次请求。
3. 理解「至少执行一次」(at-least-once)意味着什么,用幂等键保证退款、发邮件这类写操作重复执行也只生效一次。
4. 给模型调用、工具调用、单轮、单个任务分别设超时,知道超时以后发生了什么。
5. 让一个在第 4 个节点崩掉的 LangGraph 任务,重启后从第 4 个节点接着跑,而不是从头再来。

预计用时 5–6 小时。前置:Day 12(失败模式)、Day 25(checkpoint)、Day 36(服务化)。需要本机有 Redis,Docker 一行就能起。

## 什么样的活要进队列

判断标准其实很朴素:**调用方能不能、愿不愿意等它做完**。

用户在聊天框里发消息,他愿意等,而且我们有流式输出让等待不难受,所以昨天的同步流式接口是对的。但下面几种情况调用方等不了:

webhook 回调。工单系统推新工单给你,它只关心你收没收到,不关心你处理完没有。如果你在 webhook 处理函数里直接跑 Agent,十几秒才返回,对方早就超时重发了,于是同一张工单被处理两遍。正确的做法是 webhook 只做两件事:校验签名、把工单 id 塞进队列,然后立刻返回 200。

批量任务。300 张工单,每张平均 15 秒,串行要 75 分钟。没有哪个 HTTP 请求能挂 75 分钟,中间任何一次部署、网络抖动都会让它前功尽弃。

定时任务。每天凌晨汇总前一天的工单质量报告、清理过期会话。

慢的副作用。Agent 回复完以后要发邮件通知客户、同步到 CRM。这些不影响用户看到回复,没必要让用户等。

进了队列以后,接口的样子就变了:提交任务返回 `202 Accepted` 和一个任务 id,调用方之后凭 id 查状态,或者订阅进度推送。你写 Java 时用过 RabbitMQ 或 Kafka 消费者的话,这个模式很熟悉,只是现在消费者里跑的是 Agent。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="任务队列架构:API 进程把任务放进 Redis,多个 worker 进程取任务执行 Agent,结果写回 Postgres,API 通过任务 id 查询状态">
<rect x="20" y="40" width="130" height="60" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="85" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">webhook / 批量</text>
<text x="85" y="84" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">API 进程</text>
<rect x="230" y="40" width="130" height="60" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="295" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Redis 队列</text>
<text x="295" y="84" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">job_id 去重</text>
<rect x="440" y="20" width="170" height="40" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="525" y="45" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">worker 1 · Agent</text>
<rect x="440" y="70" width="170" height="40" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="525" y="95" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">worker 2 · Agent</text>
<rect x="440" y="120" width="170" height="40" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="525" y="145" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">worker N · Agent</text>
<rect x="230" y="180" width="130" height="60" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="295" y="206" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Postgres</text>
<text x="295" y="224" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">checkpoint · 业务表</text>
<line x1="150" y1="70" x2="230" y2="70" stroke="var(--ink-soft)" stroke-width="1.5"/>
<text x="190" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">入队</text>
<line x1="360" y1="60" x2="440" y2="40" stroke="var(--ink-soft)" stroke-width="1.2"/>
<line x1="360" y1="70" x2="440" y2="90" stroke="var(--ink-soft)" stroke-width="1.2"/>
<line x1="360" y1="80" x2="440" y2="140" stroke="var(--ink-soft)" stroke-width="1.2"/>
<line x1="525" y1="160" x2="360" y2="210" stroke="var(--ink-soft)" stroke-width="1.2"/>
<line x1="85" y1="100" x2="230" y2="210" stroke="var(--ink-soft)" stroke-width="1.2" stroke-dasharray="4 3"/>
<text x="120" y="170" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">凭 id 查状态</text>
<text x="20" y="250" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">API 立刻返回 202;worker 数量 = 你愿意同时打给模型 API 的并发数</text>
</svg>
<figcaption>任务队列的基本形状。API 只管入队和查状态,真正跑 Agent 的是独立的 worker 进程。worker 崩了重启,任务还在队列和 checkpoint 里。</figcaption>
</figure>

## 选哪个队列

Python 世界里常见的四个:

Celery 资格最老、用户最多,国内公司的 Python 后端十家有七家在用。功能最全,支持多种 broker、定时任务、工作流编排。代价是重,配置项多,而且它的执行模型是同步的,在 Celery 任务里跑 async 代码要自己包一层事件循环,不太顺手。

RQ(Redis Queue)是简化版,概念少,上手快,同样是同步执行模型。

Dramatiq 设计上比 Celery 干净,默认行为更合理(比如默认会重试、默认确认消息的时机更安全),也是同步模型为主。

arq 是 pydantic 作者 Samuel Colvin 写的,从一开始就基于 asyncio。我们整个 Agent 栈都是 async 的(OpenAI SDK 的异步客户端、LangGraph 的 `ainvoke`、psycopg 的异步连接池),用 arq 最省事:任务函数就是普通的 `async def`。它的功能比 Celery 少很多,但 Agent 场景用到的(异步任务、自定义 job id 去重、重试、超时、定时任务)都有。

我的建议:学习和小项目用 arq;去一家已经在用 Celery 的公司,就老老实实用 Celery,面试时能讲清楚两者差别就够了。今天用 arq 写。

如果任务要跑几个小时甚至几天,中间有大量等待和人工步骤,单纯的任务队列就不够了,那是 Temporal 这类「持久化执行」(durable execution)引擎的地盘。文章后面会单独说。

## arq 快速上手

先起 Redis,装依赖:

```bash
docker run -d --name redis -p 6379:6379 redis:7
cd agent-60-lab
uv add arq
```

arq 的模型很简单。你定义一个 `WorkerSettings` 类,里面列出任务函数和 Redis 地址;用 `arq` 命令启动 worker;在别处通过 `create_pool` 拿到连接,用 `enqueue_job` 入队。每个任务函数的第一个参数是 `ctx`,一个字典,里面有 `job_id`、`job_try`(第几次尝试)之类的信息,也可以在 `startup` 钩子里往里放共享资源,比如数据库连接池和编译好的图。

先写一个最小例子感受一下:

```python
# agent-60-lab/w6/demo_arq.py
import asyncio

from arq import create_pool
from arq.connections import RedisSettings


async def slow_add(ctx, a: int, b: int) -> int:
    print(f"job {ctx['job_id']} try {ctx['job_try']}")
    await asyncio.sleep(2)
    return a + b


class WorkerSettings:
    functions = [slow_add]
    redis_settings = RedisSettings()


async def main():
    redis = await create_pool(RedisSettings())
    job = await redis.enqueue_job("slow_add", 1, 2, _job_id="add-1-2")
    print("enqueued:", job)
    dup = await redis.enqueue_job("slow_add", 1, 2, _job_id="add-1-2")
    print("same id again:", dup)          # None,同一个 id 不会入队两次
    print("result:", await job.result(timeout=10))


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `from arq import create_pool` `create_pool` 连上 Redis,返回一个能入队的连接(`ArqRedis`)。
- `async def slow_add(ctx, a: int, b: int) -> int:` 任务函数必须是 `async def`,第一个参数固定是 `ctx`,后面才是你入队时传的参数。
- `print(f"job {ctx['job_id']} try {ctx['job_try']}")` 实测 worker 终端打印 `job add-1-2 try 1`:`job_id` 是入队时指定的 `add-1-2`,`job_try` 是第几次执行,第一次是 1。这行 `print` 输出在 **worker** 那个终端,不在入队的终端。
- `await asyncio.sleep(2)` 假装干了 2 秒活。实测 worker 日志是 `2.00s ← add-1-2:slow_add ● 3`,意思是执行了 2.00 秒、返回 3。
- `class WorkerSettings:` arq 的约定:命令行 `arq 模块.WorkerSettings` 会读这个类的属性来启动 worker。
- `functions = [slow_add]` 这个 worker 能执行哪些任务。实测启动日志第一行是 `Starting worker for 1 functions: slow_add`。
- `redis_settings = RedisSettings()` 不传参数就是 `localhost:6379`、第 0 号库。
- `job = await redis.enqueue_job("slow_add", 1, 2, _job_id="add-1-2")` 按**名字**入队,不是传函数对象,因为入队的进程和执行的进程可以不在一台机器上。实测返回 `<arq job add-1-2>`。
- `dup = await redis.enqueue_job("slow_add", 1, 2, _job_id="add-1-2")` 同一个 id 再入队一次。
- `print("same id again:", dup)` 实测打印 `same id again: None`。还有一个实测细节:结果默认在 Redis 里保留 1 小时(`arq:result:add-1-2` 这个键的 TTL 是 3599 秒),这一小时内再用 `add-1-2` 入队都返回 None。我第一次跑时 worker 没起来,任务留在了 Redis 里,重跑脚本时连第一次入队都返回了 None,紧接着 `job.result` 报 `'NoneType' object has no attribute 'result'`。想反复练习,就每次换个 id,或者清空 Redis。
- `print("result:", await job.result(timeout=10))` 等 worker 执行完拿结果,最多等 10 秒。实测打印 `result: 3`,整个脚本用了 2.76 秒。

</div>

开两个终端:

```bash
uv run arq w6.demo_arq.WorkerSettings     # 终端 1:worker
uv run python -m w6.demo_arq              # 终端 2:入队并等结果
```

终端 2 的输出大致是 `enqueued: <arq job add-1-2 ...>`、`same id again: None`、`result: 3`。

`_job_id` 这个参数今天要重点用。arq 文档说得很清楚:同一个 id 的任务在执行完、结果被清理之前不能再次入队,重复入队直接返回 `None`。这就是我们对付 webhook 重发的第一道防线:用工单 id 当 job id,工单系统重发十次,队列里也只有一个任务。

## 重试:先分清哪些错误值得重试

Day 12 讲过 Agent 的失败模式,今天从基础设施的角度再看一遍。一个工单任务可能遇到的错误:

| 错误 | 例子 | 该重试吗 |
| --- | --- | --- |
| 速率限制 | 模型 API 返回 429 | 该,按 `Retry-After` 或指数退避等一会儿 |
| 上游临时故障 | 500、502、503、连接被重置、读超时 | 该,有限次数 |
| 请求本身有问题 | 400、参数校验失败、上下文超长 | 不该,重试一万次也是同样的错 |
| 鉴权失败 | 401、403、余额不足 | 不该,要报警让人处理 |
| 业务拒绝 | 发票不存在、退款超过可退金额 | 不该,这是正常的业务结果,Agent 应该据此回复 |
| 进程崩溃 | worker 被 OOM kill、机器重启 | 该,由队列重新投递 |

把这张表落成代码,就是一个判断函数:

```python
# agent-60-lab/w6/app/retry.py
import httpx
import openai


class PermanentError(Exception):
    """重试没用的错误:直接失败,进人工处理队列。"""


def is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, (openai.RateLimitError, openai.APITimeoutError, openai.APIConnectionError)):
        return True
    if isinstance(exc, openai.InternalServerError):
        return True
    if isinstance(exc, openai.APIStatusError):
        return False  # 400 / 401 / 403 / 404 / 422 ...
    if isinstance(exc, (httpx.TimeoutException, httpx.ConnectError, httpx.RemoteProtocolError)):
        return True   # MCP 工具、内部 HTTP 服务
    if isinstance(exc, PermanentError):
        return False
    return False      # 不认识的错误默认不重试,宁可让人看一眼
```

<div class="line-notes">

- `class PermanentError(Exception):` 自己定义一个异常类型,业务代码确定「重试也没用」时抛它。
- `def is_retryable(exc: BaseException) -> bool:` 输入一个异常,输出要不要重试。下面每个分支我都造了真实的异常对象喂进去,结果列在对应行。
- `if isinstance(exc, (openai.RateLimitError, openai.APITimeoutError, openai.APIConnectionError)):` `isinstance` 的第二个参数可以是元组,命中任意一个就算。实测 429 的 `RateLimitError`、`APITimeoutError`、`APIConnectionError` 都返回 True。顺序很重要:`APITimeoutError` 是 `APIConnectionError` 的子类,`RateLimitError` 是 `APIStatusError` 的子类,所以要先判断它们,再判断下面那个笼统的 `APIStatusError`。
- `if isinstance(exc, openai.InternalServerError):` 5xx 都是 `InternalServerError`。实测 503 返回 True。
- `if isinstance(exc, openai.APIStatusError):` 走到这里的是剩下的 4xx。实测 400 的 `BadRequestError`、401 的 `AuthenticationError` 都返回 False。我还拿一个错误的 key 真调了一次 DeepSeek,拿到的是 `AuthenticationError`,状态码 401,结果也是 False。
- `if isinstance(exc, (httpx.TimeoutException, httpx.ConnectError, httpx.RemoteProtocolError)):` 不经过 OpenAI SDK 的 HTTP 调用(比如 MCP 工具)抛的是 httpx 的异常。实测 `httpx.ReadTimeout`(`TimeoutException` 的子类)和 `httpx.ConnectError` 都返回 True。
- `if isinstance(exc, PermanentError):` 实测返回 False。
- `return False      # 不认识的错误默认不重试,宁可让人看一眼` 实测 `KeyError` 返回 False。另外注意一点:LangChain 包装过的模型调用抛的是 `langchain_openai` 的 `OpenAIConnectionError`,它继承自 `openai.APIConnectionError`,所以照样能被第一个分支认出来。下面 `jobs.py` 的实测就是这么走的。

</div>

最后一行我想多说一句。很多人的默认是「不认识的错误也重试几次,万一好了呢」。对只读操作这么干问题不大,对 Agent 这种会调写操作工具的系统,不认识的错误意味着你不知道副作用有没有发生,盲目重试比停下来更危险。

### 重试放在哪一层

这是我见过最多人踩的坑。一次模型调用,可能被三层重试包着:

- OpenAI Python SDK 自带重试,默认 `max_retries=2`,遇到 429、5xx、连接错误会自动退避重试。
- 你在 Day 12 写的 `call_with_retry`,可能又包了 3 次。
- 任务队列 arq 默认 `max_tries=5`,任务失败会整个重来。

最坏情况下,一次模型调用会变成 3 × 4 × 5 = 60 次请求。如果上游是因为过载返回 503,你这一下就是在帮它雪崩。

我的做法是每一层只管自己那一类问题。SDK 层负责网络级的瞬时抖动,保留默认的 2 次就好,同时把 `timeout` 从默认的 600 秒改小。应用层不再包重试,只做错误分类。任务层负责「整个任务没做完」这件事,包括进程崩溃,次数设 3 次,间隔拉长。

```python
# agent-60-lab/w6/app/llm.py
from openai import AsyncOpenAI

from .config import settings

# timeout 是单次 HTTP 请求的上限;流式请求时它约束的是两个 chunk 之间的间隔和连接建立
llm = AsyncOpenAI(
    base_url=settings.llm_base_url,
    api_key=settings.llm_api_key,
    timeout=60.0,
    max_retries=2,
)
```

<div class="line-notes">

- `from openai import AsyncOpenAI` 异步版客户端,在 FastAPI 和 arq 的事件循环里用,调用时 `await`。
- `base_url=settings.llm_base_url,` 配置都从 Day 36 的 `settings` 来。实测 `llm.base_url` 是 `https://api.deepseek.com`。
- `timeout=60.0,` 单次 HTTP 请求最多等 60 秒。SDK 默认是 600 秒,一个卡住的请求能把一个 worker 槽位占 10 分钟。
- `max_retries=2,` 实测 `llm.max_retries` 是 2,也就是一次调用最多发 3 个请求,这是网络抖动那一层的重试。应用层和任务层的重试另算,所以三层乘起来要心里有数。

</div>

退避间隔要加随机抖动(jitter)。300 个任务同时撞上 429,如果都是「等 2 秒再试」,2 秒后它们会再整齐地撞一次。`等待 = 基数 × 2^尝试次数 × random(0.5, 1.5)` 这种写法能把它们打散。

## 至少执行一次,和幂等

任务队列几乎都提供「至少执行一次」的保证,而不是「恰好执行一次」。原因是 worker 执行完任务和告诉队列「我做完了」是两个动作,中间崩掉的话,队列只能假设没做完,把任务交给别人再做一遍。

对只读任务,这无所谓。对 Agent 就要命了。想象这个时间线:

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="至少执行一次导致重复退款的时间线:第一次执行建了退款申请后 worker 崩溃,第二次执行又建了一次;有幂等键时第二次返回已有记录">
<text x="20" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">没有幂等键</text>
<line x1="20" y1="50" x2="620" y2="50" stroke="var(--rule)"/>
<rect x="30" y="38" width="90" height="24" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="75" y="54" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">查发票</text>
<rect x="130" y="38" width="120" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="190" y="54" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">建退款 R-01</text>
<text x="275" y="54" font-family="var(--font-mono)" font-size="13" fill="var(--compute)">✕ 崩溃</text>
<line x1="20" y1="100" x2="620" y2="100" stroke="var(--rule)"/>
<text x="20" y="88" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">队列重新投递 →</text>
<rect x="130" y="88" width="90" height="24" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="175" y="104" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">查发票</text>
<rect x="230" y="88" width="120" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="290" y="104" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">建退款 R-02</text>
<text x="370" y="104" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">客户被退了两次钱</text>
<text x="20" y="158" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">有幂等键 key = hash(工单, 发票, refund)</text>
<line x1="20" y1="200" x2="620" y2="200" stroke="var(--rule)"/>
<rect x="130" y="188" width="90" height="24" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="175" y="204" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">查发票</text>
<rect x="230" y="188" width="160" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="310" y="204" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">key 已存在 → 返回 R-01</text>
<text x="410" y="204" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">只退一次</text>
<text x="20" y="238" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">幂等键必须由工具层按业务含义算出来,不能让模型生成,也不能每次随机</text>
</svg>
<figcaption>重复执行本身无法避免,能做的是让写操作重复执行也只生效一次。关键在于两次执行算出同一个幂等键。</figcaption>
</figure>

幂等(idempotent)的意思是:同一个操作执行一次和执行多次,结果一样。查询天然幂等;「把状态设为已关闭」也幂等;「新建一条退款申请」不幂等,每执行一次多一条。

让它变幂等的标准做法是幂等键。支付行业用得最成熟,Stripe 的 API 每个写请求都可以带一个 `Idempotency-Key` 头,同一个 key 在 24 小时内重复请求,直接返回第一次的结果。我们照抄这个思路。

难点在于 key 怎么来。新手最常见的写法是 `idempotency_key = uuid4()`,每次调用生成一个新的。这完全没用,重试时会生成另一个 uuid。还有人让模型在工具参数里填一个 key,这也不行,模型第二次跑可能填不一样的值,甚至被注入攻击操纵。

正确的做法:**key 由工具层根据业务含义确定性地算出来**。对「为工单 T-881 的发票 INV-2031 发起退款」这个动作,key 就是 `sha256("T-881:INV-2031:refund")`。不管重试多少次,算出来都一样。

```sql
-- agent-60-lab/w6/sql/002_refunds.sql
CREATE TABLE IF NOT EXISTS refund_requests (
    id               TEXT PRIMARY KEY,
    idempotency_key  TEXT NOT NULL UNIQUE,
    ticket_id        TEXT NOT NULL,
    invoice_id       TEXT NOT NULL,
    customer_id      TEXT NOT NULL,
    amount_cents     INTEGER NOT NULL CHECK (amount_cents > 0),
    status           TEXT NOT NULL DEFAULT 'pending_approval',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

<div class="line-notes">

- `id               TEXT PRIMARY KEY,` 退款单号,`tools_refund.py` 生成,形如 `R-86a4ae58`。
- `idempotency_key  TEXT NOT NULL UNIQUE,` 整个幂等方案就靠这个 `UNIQUE`:同一个 key 只能有一行,第二次插入会冲突,而这个判断是数据库原子地做的。
- `amount_cents     INTEGER NOT NULL CHECK (amount_cents > 0),` `CHECK` 约束让金额必须大于 0。实测传 `amount_cents=0`,数据库报 `CheckViolation`(违反 `refund_requests_amount_cents_check`)。
- `status           TEXT NOT NULL DEFAULT 'pending_approval',` 和 Day 23 一样,新建的退款都是待审批。

</div>

```python
# agent-60-lab/w6/app/tools_refund.py
import hashlib
import uuid

from psycopg_pool import AsyncConnectionPool


def refund_key(ticket_id: str, invoice_id: str) -> str:
    return hashlib.sha256(f"{ticket_id}:{invoice_id}:refund".encode()).hexdigest()


async def create_refund_request(
    pool: AsyncConnectionPool, *, ticket_id: str, invoice_id: str, customer_id: str, amount_cents: int
) -> dict:
    key = refund_key(ticket_id, invoice_id)
    rid = f"R-{uuid.uuid4().hex[:8]}"
    async with pool.connection() as conn:
        # ON CONFLICT DO NOTHING + 再查一次:并发的两次执行只有一次能插入成功
        await conn.execute(
            """
            INSERT INTO refund_requests (id, idempotency_key, ticket_id, invoice_id, customer_id, amount_cents)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (idempotency_key) DO NOTHING
            """,
            (rid, key, ticket_id, invoice_id, customer_id, amount_cents),
        )
        cur = await conn.execute(
            "SELECT id, status, amount_cents FROM refund_requests WHERE idempotency_key = %s", (key,)
        )
        row = await cur.fetchone()
    return {"refund_id": row[0], "status": row[1], "amount_cents": row[2], "deduplicated": row[0] != rid}
```

<div class="line-notes">

- `def refund_key(ticket_id: str, invoice_id: str) -> str:` 幂等键只由「哪张工单、哪张发票、做退款」决定,和时间、随机数、模型输出都无关。
- `return hashlib.sha256(f"{ticket_id}:{invoice_id}:refund".encode()).hexdigest()` `.encode()` 把字符串变成字节,`sha256` 只收字节;`hexdigest()` 输出 64 位十六进制字符串。实测 `refund_key("T1041", "INV-2026-0123")` 是 `1ddad6b78e21f056…`,算多少次都一样;换成 `INV-2026-0026` 就变成 `cb0a014923676a6f…`。
- `pool: AsyncConnectionPool, *, ticket_id: str, invoice_id: str, customer_id: str, amount_cents: int` 参数列表里单独的 `*` 表示后面的参数**只能按名字传**。写成 `create_refund_request(pool, ticket_id="T1041", invoice_id=…)` 可以,按位置传会报错。四个字符串挨着,按位置传很容易把发票号和客户号传反,这样写就不会。
- `key = refund_key(ticket_id, invoice_id)` 每次调用都现算一遍 key,重试时算出来还是同一个。
- `rid = f"R-{uuid.uuid4().hex[:8]}"` 退款单号每次随机生成。这个随机号只在真正插入成功时才会用上。
- `ON CONFLICT (idempotency_key) DO NOTHING` key 已经存在就什么也不做,不报错。
- `"SELECT id, status, amount_cents FROM refund_requests WHERE idempotency_key = %s", (key,)` 不管刚才插没插进去,都按 key 再查一次,拿到的一定是表里那唯一的一行。
- `row = await cur.fetchone()` 实测第一次调用拿到 `('R-86a4ae58', 'pending_approval', 239200)`。
- `return {"refund_id": row[0], "status": row[1], "amount_cents": row[2], "deduplicated": row[0] != rid}` 判断是不是命中了已有记录:查回来的 id 不等于这次新生成的 `rid`,说明这次没插进去。实测同样的参数调两次:第一次 `{'refund_id': 'R-86a4ae58', …, 'deduplicated': False}`,第二次 `refund_id` 还是 `R-86a4ae58`,`deduplicated` 变成 True。再用 `asyncio.gather` 对另一张发票同时并发调 5 次,5 个结果的 `refund_id` 全是 `R-7d67cdd6`,其中正好 1 个 `deduplicated` 是 False。表里最后只有 2 行。

</div>

`ON CONFLICT DO NOTHING` 之后再查一次,而不是先查再插。先查再插在并发下有窗口期:两个 worker 同时查,都发现没有,然后都插入。唯一约束加冲突处理把这个判断交给了数据库,它是原子的。

`deduplicated` 字段告诉调用方这次是不是命中了已有记录。返回给模型时可以带上,模型看到「这笔退款之前已经申请过」会写出更合适的回复。

如果退款最终要调外部支付系统,外部那一步也要带幂等键。大部分支付网关都支持,用同一个 key 传过去就行。不支持的话,就要在本地记录「已经调用过」并在调用前检查,但这依然有崩溃窗口,只能靠对账兜底。分布式系统里没有魔法,幂等键能把问题缩小到极少数,对账负责剩下的。

## 超时:每一层都要有,而且要比上一层短

超时也是分层的,规则是**内层比外层短**,否则外层先超时,内层的错误信息就丢了。

| 层 | 建议值 | 超时后 |
| --- | --- | --- |
| 单次模型 HTTP 请求 | 60 s | SDK 抛 `APITimeoutError`,SDK 层重试 |
| 单次工具调用 | 10–30 s | 返回一条工具错误给模型,让它决定换个方式或放弃 |
| 一轮对话(Day 36) | 120 s | 推 `error` 事件,用户可以重试 |
| 一个队列任务 | 300 s(arq 默认值) | 任务被取消,按重试策略重新投递 |

工具超时那一行值得注意。超时以后不是直接抛异常让整个任务失败,而是把「查询订单系统超时」作为工具结果交还给模型。模型可能会说「订单系统暂时查不到,我先根据你提供的信息……」,或者决定转人工。这比整个任务崩掉要好。

```python
# agent-60-lab/w6/app/tool_guard.py
import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from .retry import is_retryable


async def guarded(name: str, fn: Callable[..., Awaitable[Any]], timeout_s: float = 20.0, **kwargs) -> dict:
    """工具调用统一外壳:超时和临时故障变成模型能读懂的结果,而不是异常。"""
    try:
        async with asyncio.timeout(timeout_s):
            return {"ok": True, "result": await fn(**kwargs)}
    except TimeoutError:
        return {"ok": False, "error": f"{name} 在 {timeout_s:g} 秒内没有返回,可以稍后重试或转人工"}
    except Exception as exc:
        if not is_retryable(exc):
            raise  # 参数错、权限错这类不是「临时」的,照常抛出去
        return {"ok": False, "error": f"{name} 暂时不可用({type(exc).__name__}),可以稍后重试或转人工"}
```

<div class="line-notes">

- `from collections.abc import Awaitable, Callable` `Callable[..., Awaitable[Any]]` 读作「一个参数随意、调用后返回可以 await 的东西的函数」,也就是任意 `async def` 函数。
- `from .retry import is_retryable` 复用上面写好的错误分类,哪些算「临时故障」只在 `retry.py` 一处定义。
- `async def guarded(name: str, fn: Callable[..., Awaitable[Any]], timeout_s: float = 20.0, **kwargs) -> dict:` `**kwargs` 把剩下的关键字参数原样收进一个字典,下面再原样传给 `fn`。所以调用方写 `guarded("get_invoice", get_invoice, invoice_id="INV-2026-0123")`。
- `async with asyncio.timeout(timeout_s):` 超过 `timeout_s` 秒,里面的 `await` 会被取消,并在块的出口抛 `TimeoutError`。
- `return {"ok": True, "result": await fn(**kwargs)}` 实测一个正常返回的工具:`{'ok': True, 'result': {'id': 'INV-2026-0123', 'amount_cents': 239200}}`。
- `except TimeoutError:` 超时单独处理,提示语里带上等了多久。
- `return {"ok": False, "error": f"{name} 在 {timeout_s:g} 秒内没有返回,可以稍后重试或转人工"}` `:g` 是「去掉多余零」的数字格式:20.0 显示成 `20`,0.5 显示成 `0.5`。实测一个要睡 3 秒的工具配 `timeout_s=0.5`,返回 `{'ok': False, 'error': 'get_invoice 在 0.5 秒内没有返回,可以稍后重试或转人工'}`。最初我写的是 `:.0f`,0.5 就被四舍五入成了「0 秒」。
- `except Exception as exc:` 其他异常先接住,再看是不是临时故障。
- `if not is_retryable(exc):` 不是临时故障,比如参数格式不对、权限不够,说明调用本身有问题,包成「稍后重试」反而会误导模型。
- `raise  # 参数错、权限错这类不是「临时」的,照常抛出去` 单独一个 `raise` 表示把正在处理的这个异常原样重新抛出。实测一个抛 `ValueError("invoice_id 格式不对")` 的工具,`guarded` 没有吞掉,`ValueError` 照样冒出来。
- `return {"ok": False, "error": f"{name} 暂时不可用({type(exc).__name__}),可以稍后重试或转人工"}` 连接失败、5xx 这类临时故障变成一条模型读得懂的结果。实测:手动抛 `httpx.ConnectError` 和 503 的 `openai.InternalServerError`,分别返回 `get_invoice 暂时不可用(ConnectError)` 和 `get_invoice 暂时不可用(InternalServerError)`;真去连一个没人监听的端口(127.0.0.1:9),也是 `ConnectError` 这条。

</div>

超时还有一个容易忽略的问题:**超时不等于没执行**。你等订单系统 20 秒没等到响应,放弃了,但订单系统可能在第 21 秒把退款建好了。这又回到了幂等:只要写操作有幂等键,下一次重试拿到的就是已经建好的那条。所以超时和幂等总是要一起设计的。

## 断点续跑:让崩在半路的任务接着跑

一张复杂工单,Agent 可能要走 6 个节点:分类、检索、查客户、查发票、起草、自检。worker 在第 4 步被 OOM kill 了,任务重新投递以后,前 3 步要不要重做?

重做的代价是钱和时间:前面几次模型调用白花了。更麻烦的是,模型每次的输出不完全一样,重做可能走出一条不同的路。

LangGraph 的 checkpoint 天然就能解决这个问题。只要用 Postgres checkpointer,并且 thread_id 固定(我们用 `ticket-{工单id}`),每跑完一步状态就存下来。任务重跑时,输入传 `None`,LangGraph 会从这个 thread 最新的 checkpoint 继续执行,而不是从头开始。

这里有一个参数要知道:`durability`,控制 checkpoint 什么时候写。LangGraph 文档里有三档:`"exit"` 只在整个运行结束时(成功、出错或者 interrupt)写一次,性能最好,但进程崩溃时中间进度全丢;`"async"` 在执行下一步的同时异步写上一步,快,但崩溃瞬间可能丢最后一步;`"sync"` 每一步写完才开始下一步,最稳,稍慢。批量处理工单这种场景,我选 `"sync"`。每步多几毫秒的数据库写入,和一次模型调用的几秒钟比起来可以忽略。

## 把它们拼起来:工单处理 worker

worker 处理完要把结果写回工单表,让坐席在工单系统里看得到。真实公司里这张表在工单系统那边(Zendesk、自研工单系统都有类似字段),练习时我们在同一个 Postgres 里建一张最小的:

```sql
-- agent-60-lab/w6/sql/003_tickets.sql
-- 工单系统那边的工单表(演示用最小版本)。worker 只回写 agent_status / agent_note 两列
CREATE TABLE IF NOT EXISTS tickets (
    id            TEXT PRIMARY KEY,
    customer_id   TEXT NOT NULL,
    text          TEXT NOT NULL,
    agent_status  TEXT NOT NULL DEFAULT 'queued',  -- queued | awaiting_approval | draft_ready | needs_human
    agent_note    TEXT NOT NULL DEFAULT '',
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

<div class="line-notes">

- `CREATE TABLE IF NOT EXISTS tickets (` 演示用的最小工单表。下面 `jobs.py` 的 `_set_ticket` 会 `UPDATE tickets`,不先建这张表,worker 第一次回写就会报 `relation "tickets" does not exist`。
- `agent_status  TEXT NOT NULL DEFAULT 'queued',` 四个取值和 `jobs.py` 里 `_set_ticket` 写的一一对应。实测 T1041 依次经过 `queued` → `awaiting_approval` → `draft_ready`。
- `agent_note    TEXT NOT NULL DEFAULT '',` 失败原因写在这里,坐席打开工单就能看到。
- `updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()` worker 每次回写都刷新它,按它排序就知道哪些工单最近有动静。

</div>

```bash
psql "$DATABASE_URL" -f w6/sql/002_refunds.sql -f w6/sql/003_tickets.sql
psql "$DATABASE_URL" -c "INSERT INTO tickets (id, customer_id, text) VALUES ('T1041', 'C007', '你好,10 月 8 号我被扣了两次款,INV-2026-0026 和 INV-2026-0123 金额一模一样,麻烦把多扣的那笔退给我。')"
```

```python
# agent-60-lab/w6/app/jobs.py
import logging

from arq import Retry
from arq.connections import RedisSettings
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.types import Command
from psycopg_pool import AsyncConnectionPool

from w4.ticket_agent import build_graph

from .config import settings
from .retry import is_retryable

log = logging.getLogger("jobs")
# arq 只给自己的 logger 配了输出,jobs 这个 logger 要自己配一个,worker 终端里才看得到
if not log.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(asctime)s: [jobs] %(message)s", "%H:%M:%S"))
    log.addHandler(_h)
    log.setLevel(logging.INFO)


async def startup(ctx):
    ctx["pool"] = AsyncConnectionPool(settings.database_url, open=False, kwargs={"autocommit": True})
    await ctx["pool"].open()
    ctx["saver_cm"] = AsyncPostgresSaver.from_conn_string(settings.database_url)
    saver = await ctx["saver_cm"].__aenter__()
    await saver.setup()
    ctx["graph"] = build_graph(checkpointer=saver)


async def shutdown(ctx):
    await ctx["saver_cm"].__aexit__(None, None, None)
    await ctx["pool"].close()


async def _thread_has_progress(graph, config) -> bool:
    snap = await graph.aget_state(config)
    return bool(snap.values) and bool(snap.next)   # 有状态且还有没跑的节点


async def _set_ticket(pool, ticket_id: str, status: str, note: str = "") -> None:
    async with pool.connection() as conn:
        cur = await conn.execute(
            "UPDATE tickets SET agent_status = %s, agent_note = %s, updated_at = now() WHERE id = %s",
            (status, note, ticket_id),
        )
    if cur.rowcount == 0:  # 工单表里没有这一行,UPDATE 不报错,结果会悄悄丢掉
        log.warning("ticket %s not found in tickets, status %s not saved", ticket_id, status)


async def process_ticket(ctx, ticket_id: str, customer_id: str, text: str) -> str:
    graph, pool = ctx["graph"], ctx["pool"]
    config = {"configurable": {"thread_id": f"ticket-{ticket_id}", "customer_id": customer_id}}
    try:
        # 第一次跑:正常输入。重试时:如果已经有中间进度,传 None 从断点继续。
        resume = ctx["job_try"] > 1 and await _thread_has_progress(graph, config)
        graph_input = None if resume else {"ticket": text, "customer_id": customer_id, "messages": [("user", text)]}
        log.info("ticket %s try %s resume=%s", ticket_id, ctx["job_try"], resume)

        result = await graph.ainvoke(graph_input, config=config, durability="sync")

        if "__interrupt__" in result:
            await _set_ticket(pool, ticket_id, "awaiting_approval")
            return "awaiting_approval"
        await _set_ticket(pool, ticket_id, "draft_ready")
        return "draft_ready"
    except Exception as exc:
        if is_retryable(exc) and ctx["job_try"] < 3:
            # 退避:10s、40s;arq 会在 defer 秒后重新执行这个任务
            raise Retry(defer=10 * ctx["job_try"] ** 2) from exc
        log.exception("ticket %s failed permanently", ticket_id)
        await _set_ticket(pool, ticket_id, "needs_human", f"{type(exc).__name__}: {exc}"[:500])
        return "needs_human"


async def resume_after_approval(ctx, ticket_id: str, customer_id: str, approved: bool, note: str) -> str:
    graph, pool = ctx["graph"], ctx["pool"]
    config = {"configurable": {"thread_id": f"ticket-{ticket_id}", "customer_id": customer_id}}
    await graph.ainvoke(Command(resume={"approved": approved, "note": note}), config=config, durability="sync")
    await _set_ticket(pool, ticket_id, "draft_ready")
    return "draft_ready"


class WorkerSettings:
    functions = [process_ticket, resume_after_approval]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn("redis://localhost:6379")
    max_jobs = 8          # 同时跑的任务数 = 打给模型 API 的最大并发
    job_timeout = 300
    max_tries = 3
```

<div class="line-notes">

- `from arq import Retry` 在任务里 `raise Retry(defer=秒数)`,arq 就会在指定的秒数后重新执行这个任务,`job_try` 加 1。
- `from w4.ticket_agent import build_graph` 和 Day 36 用的是同一张 W4 的图。
- `log = logging.getLogger("jobs")` 按名字拿一个 logger,同名的在整个进程里是同一个对象。
- `if not log.handlers:` 已经有 handler 就不重复加。模块被 import 两次时(比如测试里)不会每行日志打两遍。
- `_h = logging.StreamHandler()` StreamHandler 默认写到 stderr,worker 终端里能看到。arq 启动时只给名叫 `arq` 的 logger 配了这样一个 handler,`jobs` 不配的话,下面的 `log.info` 一行都不会显示。
- `_h.setFormatter(logging.Formatter("%(asctime)s: [jobs] %(message)s", "%H:%M:%S"))` 时间格式和 arq 自己的日志一样,加一个 `[jobs]` 前缀方便区分。
- `log.setLevel(logging.INFO)` logger 默认级别是 WARNING,不改的话 `info` 会被丢掉。
- `async def startup(ctx):` worker 进程启动时执行一次,把共享资源放进 `ctx`,之后每个任务的 `ctx` 里都能拿到。
- `ctx["saver_cm"] = AsyncPostgresSaver.from_conn_string(settings.database_url)` `from_conn_string` 返回的是一个异步上下文管理器,不是 saver 本身。worker 的生命周期分成 startup 和 shutdown 两个函数,没法用一个 `async with` 包住,所以手动调 `__aenter__`,再在 shutdown 里调 `__aexit__`。
- `saver = await ctx["saver_cm"].__aenter__()` 这一步才真正连上数据库,拿到 saver。
- `ctx["graph"] = build_graph(checkpointer=saver)` 实测 worker 启动日志:`Starting worker for 2 functions: process_ticket, resume_after_approval`。
- `async def shutdown(ctx):` 进程退出时关掉 checkpointer 的连接和连接池。
- `async def _thread_has_progress(graph, config) -> bool:` 判断这个 thread 是不是「跑了一半」。
- `return bool(snap.values) and bool(snap.next)   # 有状态且还有没跑的节点` `snap.next` 是接下来要跑的节点。实测我在第 4 秒取消一次运行来模拟 worker 崩溃,这时 `snap.next` 是 `('tools',)`,状态里已经有 `category`、`kb_hits`、`messages` 等字段,函数返回 True。正常跑完的 thread,`next` 是空元组,返回 False。
- `async def _set_ticket(pool, ticket_id: str, status: str, note: str = "") -> None:` 把 Agent 的处理结果回写到工单表,表结构见上面的 `003_tickets.sql`。
- `cur = await conn.execute(` 留着 `cur`,下面要看这条 UPDATE 改了几行。
- `"UPDATE tickets SET agent_status = %s, agent_note = %s, updated_at = now() WHERE id = %s",` 工单 id 在表里不存在时,`UPDATE` 改了 0 行,数据库并不报错。
- `if cur.rowcount == 0:  # 工单表里没有这一行,UPDATE 不报错,结果会悄悄丢掉` `rowcount` 是这条语句影响的行数。这里不抛异常,因为 `_set_ticket` 经常在 `except` 分支里被调用,再抛一个只会把原来的错误盖掉;记一条 warning,让它在终端和日志系统里显眼。
- `log.warning("ticket %s not found in tickets, status %s not saved", ticket_id, status)` 实测往 webhook 推一张表里没有的 `T3001`,worker 终端打出 `08:09:35: [jobs] ticket T3001 not found in tickets, status awaiting_approval not saved`。改之前这一步是完全没声音的。
- `async def process_ticket(ctx, ticket_id: str, customer_id: str, text: str) -> str:` 处理一张工单的主任务,返回值会存进 arq 的结果里,`/api/jobs/{id}` 查得到。
- `config = {"configurable": {"thread_id": f"ticket-{ticket_id}", "customer_id": customer_id}}` thread_id 固定成 `ticket-T1041` 这种形式,重试时才能找回同一条 checkpoint。实测处理完 T1041 后,`checkpoints` 表里 `ticket-T1041` 这个 thread 有 9 行。
- `resume = ctx["job_try"] > 1 and await _thread_has_progress(graph, config)` `and` 是短路求值:第一次执行时 `job_try` 是 1,前半句为 False,后面那个查数据库的 `await` 根本不会执行。
- `graph_input = None if resume else {"ticket": text, "customer_id": customer_id, "messages": [("user", text)]}` 第一次给完整输入。这里要和 Day 36 一样传 `ticket` 和 `customer_id`,只传 `messages` 的话 W4 的图报 `KeyError: 'ticket'`。续跑时传 `None`,LangGraph 就从最新的 checkpoint 接着跑。实测模拟崩溃后第 2 次执行只用了 4.1 秒就到 `draft_ready`,跑完后 `llm_calls` 是 3,消息里只有 1 条 human,说明前面跑过的节点没有重跑。
- `log.info("ticket %s try %s resume=%s", ticket_id, ctx["job_try"], resume)` 实测 worker 终端里是 `08:09:27: [jobs] ticket T1041 try 1 resume=False`,和 arq 自己的日志交错在一起,能看出两张工单是同时开跑的。
- `result = await graph.ainvoke(graph_input, config=config, durability="sync")` `durability="sync"` 让每一步都写完 checkpoint 再往下走,上面的断点续跑就是靠它。实测 T1041 这次运行 9.45 秒结束。
- `if "__interrupt__" in result:` 图停在审批处时,`ainvoke` 的返回值里会带 `__interrupt__` 键。
- `await _set_ticket(pool, ticket_id, "awaiting_approval")` 实测 T1041 第一次跑完,任务结果是 `'awaiting_approval'`,`/api/jobs/ticket-T1041` 返回 `{"status": "complete", "result": "awaiting_approval"}`,工单表里也是 `awaiting_approval`。注意 arq 的任务状态是 `complete`,业务上的「等审批」是靠返回值和工单表表达的。
- `except Exception as exc:` 任何异常都先到这里分类。
- `if is_retryable(exc) and ctx["job_try"] < 3:` 能重试的错误、而且还没到第 3 次,就交给 arq 重试。
- `raise Retry(defer=10 * ctx["job_try"] ** 2) from exc` `**` 比 `*` 先算:第 1 次失败等 10×1=10 秒,第 2 次失败等 10×4=40 秒。`from exc` 把原始异常挂在 `__cause__` 上,日志里看得到根因。实测把模型地址指向一个连不上的端口,第 1 次执行抛出 `Retry`,`defer_score` 是 10000(毫秒),`__cause__` 是 `OpenAIConnectionError`。
- `log.exception("ticket %s failed permanently", ticket_id)` `log.exception` 会把当前异常的堆栈一起打出来,只能在 `except` 块里用。
- `await _set_ticket(pool, ticket_id, "needs_human", f"{type(exc).__name__}: {exc}"[:500])` 实测同样的连接错误到第 3 次(`job_try=3`),不再重试,任务返回 `needs_human`。`[:500]` 截断是因为有些异常的消息很长,工单备注里放不下。
- `async def resume_after_approval(ctx, ticket_id: str, customer_id: str, approved: bool, note: str) -> str:` 主管审批后由 API 入队这个任务。
- `await graph.ainvoke(Command(resume={"approved": approved, "note": note}), config=config, durability="sync")` 实测入队 `approve-T1041`,2.74 秒跑完,返回 `draft_ready`;`cloudledger.db` 里多了 1 条 `pending_approval` 的退款申请,图的最终状态里 `citations` 是 `['kb-002#2', 'kb-002#3', 'kb-002#4']`。同一个 job id 再入队一次返回 None,主管手抖点两下也只执行一次。
- `functions = [process_ticket, resume_after_approval]` 这个 worker 能执行的两种任务。
- `redis_settings = RedisSettings.from_dsn("redis://localhost:6379")` 用 URL 的形式写 Redis 地址,方便以后改成从环境变量读。
- `max_jobs = 8          # 同时跑的任务数 = 打给模型 API 的最大并发` 一个 worker 进程最多同时跑 8 个任务。
- `job_timeout = 300` 单个任务超过 300 秒就被取消。实测一张退款工单一次 9 秒多,离这个上限很远。
- `max_tries = 3` arq 最多执行 3 次,和上面 `job_try < 3` 的判断配套。

</div>

这段代码里藏着几个刻意的决定。

`max_jobs = 8` 不是随便写的。它决定了一个 worker 进程同时处理几张工单,也就间接决定了你对模型 API 的并发压力。DeepSeek、OpenAI 这些平台都有按账户的速率限制,超过就是 429。批量处理 300 张工单时,宁可慢一点稳稳跑完,也别开 50 个并发然后一半任务在 429 和重试之间打转。

`needs_human` 是死信的业务版本。重试耗尽或者遇到永久错误,任务不是悄悄消失,而是把工单标记成需要人工,原因写进 `agent_note`。坐席打开工单系统能看到「Agent 没处理成功,原因是上游超时」,该人工处理就人工处理。很多人忘了这一步,结果是一部分工单永远卡在「处理中」。

审批恢复是另一个任务 `resume_after_approval`。主管在后台点批准,API 往队列里塞一个恢复任务,job id 用 `approve-{ticket_id}`,点两次也只执行一次。

API 这边加两个接口:

```python
# agent-60-lab/w6/app/main.py(在 Day 36 的基础上追加)
from arq import create_pool
from arq.connections import RedisSettings
from arq.jobs import Job

# 连接 Redis 的那一行要放进 Day 36 的 lifespan 里,紧挨着 `yield` 前面,`yield` 后面关掉:
#         app.state.arq = await create_pool(RedisSettings.from_dsn("redis://localhost:6379"))
#         yield
#         await app.state.arq.aclose()


class WebhookTicket(BaseModel):
    ticket_id: str
    customer_id: str
    text: str = Field(max_length=settings.max_message_chars)


@app.post("/webhooks/tickets", status_code=202)
async def ticket_webhook(t: WebhookTicket):
    # 真实系统先校验签名(HMAC),这里省略
    job = await app.state.arq.enqueue_job(
        "process_ticket", t.ticket_id, t.customer_id, t.text, _job_id=f"ticket-{t.ticket_id}"
    )
    return {"accepted": True, "duplicate": job is None}


@app.get("/api/jobs/{job_id}")
async def job_status(job_id: str):
    job = Job(job_id, app.state.arq)
    status = await job.status()
    info = await job.result_info()
    return {"job_id": job_id, "status": status.value, "result": info.result if info else None}
```

<div class="line-notes">

- `from arq.jobs import Job` 用 job id 构造一个 `Job` 对象,就能查这个任务的状态和结果。
- `#         app.state.arq = await create_pool(RedisSettings.from_dsn("redis://localhost:6379"))` 这一行写在 Day 36 的 `lifespan` 里,`yield` 之前。实测改成这样以后,webhook 正常返回 202。
- `class WebhookTicket(BaseModel):` 工单系统推过来的请求体。
- `@app.post("/webhooks/tickets", status_code=202)` 202 的意思是「收到了,还没处理完」。webhook 接口只负责入队,要马上返回,工单系统那边通常几秒没收到响应就会重发。
- `job = await app.state.arq.enqueue_job(` 按任务名入队,参数依次是工单 id、客户 id、正文。
- `"process_ticket", t.ticket_id, t.customer_id, t.text, _job_id=f"ticket-{t.ticket_id}"` job id 用工单 id 拼出来。
- `return {"accepted": True, "duplicate": job is None}` 实测同一张 T1041 连发两次,第一次返回 `{"accepted":true,"duplicate":false}`,第二次 `{"accepted":true,"duplicate":true}`,两次都是 202。
- `@app.get("/api/jobs/{job_id}")` 查任务进度。
- `status = await job.status()` 返回一个枚举,`.value` 是字符串。实测刚入队、worker 还没取走时是 `queued`,跑完是 `complete`,随便写一个不存在的 id 是 `not_found`。
- `info = await job.result_info()` 任务还没跑完时是 None。
- `return {"job_id": job_id, "status": status.value, "result": info.result if info else None}` 实测跑完以后返回 `{"job_id":"ticket-T1041","status":"complete","result":"awaiting_approval"}`。

</div>

为什么不另写一个 `@app.on_event("startup")` 钩子?因为 Day 36 已经用了 `lifespan`,两种写法不能混用:有了 `lifespan`,`on_event("startup")` 注册的函数根本不会执行。我一开始就是这么写的,结果第一个 webhook 请求直接 500,日志里是 `KeyError: 'arq'`,`app.state` 上压根没有这个属性。所以连接 Redis 这一行老老实实放进 `lifespan`,关闭时顺手 `aclose()`。

## worker 怎么上线和扩容

worker 是一个独立的进程,部署时和 API 分开:API 进程按请求量扩,worker 进程按队列积压扩。用 Docker Compose 时就是多写一个 service,命令换成 `arq w6.app.jobs.WorkerSettings`(Day 41 会写完整的 compose 文件)。到了公司里,这一层通常跑在 Kubernetes 上,常见做法是用 KEDA 这类组件按 Redis 队列长度自动增减 worker 的副本数,积压多了自动加,半夜没活缩到一个。

这不是课程的重点,但你要知道它在 JD 里有多常见。站长整理的 305 条 AI Agent 岗位 JD 里,提到部署、Docker、K8s 或云的,国内占 41%,海外 53%;有一条偏平台方向的岗位直接把 Linux、Docker、K8s、CI/CD、IaC 列成硬门槛。所以面试时被问「你的 worker 怎么扩容、怎么发版不丢任务」,至少要答得出:按队列长度扩缩容;发版时先停止取新任务、尽量让手上的任务做完再退出(arq 收到 SIGTERM 时具体怎么处理正在跑的任务,去读它 `worker.py` 里的信号处理代码确认,再把容器的优雅退出时间配得比单个任务的典型耗时长);没做完的任务依靠「至少一次」加幂等重新跑。

## Temporal 和持久化执行

如果你在面试里聊到长任务,对方很可能问:「你知道 Temporal 吗?」

Temporal 的思路比任务队列更进一步。你写一段普通的代码(叫 workflow),里面调用各种可能失败的操作(叫 activity),Temporal 把每一步的输入输出都记成事件历史。进程崩了,换一台机器重放历史,代码就像从没崩过一样继续往下走。它可以 `sleep` 三天等审批,也可以在第 47 步失败时只重试第 47 步。Temporal 官方做过和 OpenAI Agents SDK 的集成演示,AI Engineer 大会上也有专场讲用它跑 Agent。道理不难懂:Agent 天然就是「长时间、多步、会失败、要等人」的工作流。

你会发现这和 LangGraph checkpoint 做的事情很像。区别在粒度和通用性:LangGraph 的 checkpoint 只管图内部的状态,Temporal 管任意代码的执行,包括跨服务的调用和定时器。对我们这个规模的项目,arq 加 LangGraph checkpoint 加幂等键已经够了。如果你去的公司 Agent 任务动辄跑几小时、要协调多个系统,Temporal 值得认真学。面试时能讲清楚这一层区别,就已经超过大多数候选人。

## 动手练习

1. 起 Redis,跑通 `demo_arq.py`,确认重复的 `_job_id` 返回 `None`。
2. 建 `refund_requests` 表,写一个测试:用 `asyncio.gather` 并发调用 10 次 `create_refund_request`,参数完全相同,断言表里只有 1 条记录,而且 10 次返回的 `refund_id` 都一样。
3. 把 `create_refund_request` 接进你 W4 的退款工具里,替换原来的实现。
4. 启动 worker,用 curl 往 `/webhooks/tickets` 推同一张工单 3 次,确认只处理了一次。
5. 崩溃续跑实验。在 W4 图里起草节点之前的某个节点里临时加一行 `if os.getenv("CRASH_ONCE") and not Path("/tmp/crashed").exists(): Path("/tmp/crashed").touch(); os._exit(1)`。设 `CRASH_ONCE=1` 跑一张工单,worker 会死掉;重启 worker 后,arq 会重新投递这个任务(取决于 arq 的重投时机,可能要等任务超时)。观察日志里 `resume=True`,并且用 Langfuse 或日志确认崩溃前的节点没有再调一次模型。
6. 批量实验。造 30 张工单一次性入队,`max_jobs` 分别设 2 和 8,记录总耗时和有没有出现 429。

**验收标准**:第 2 步并发测试通过;第 4 步只处理一次;第 5 步能用日志证明是从断点续跑而不是从头再来;能说清楚第 6 步里 `max_jobs` 和速率限制的关系。

| 实验 | max_jobs | 总耗时 | 429 次数 | 备注 |
| --- | --- | --- | --- | --- |
| 30 张工单 | 2 | | | |
| 30 张工单 | 8 | | | |

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 任务队列 | 把要做的活先存起来,由独立的 worker 进程异步取出执行的系统 |
| worker | 从队列取任务并执行的进程 |
| at-least-once | 至少执行一次:保证不丢,但可能重复执行 |
| 幂等 / 幂等键 | 执行多次与执行一次结果相同;幂等键是用来识别「同一个操作」的唯一标识 |
| 指数退避 + 抖动 | 重试间隔按指数增长,再乘一个随机系数,避免大量请求同时重试 |
| 死信 | 重试耗尽仍失败的任务,要单独存放并通知人处理 |
| `durability` | LangGraph 控制 checkpoint 写入时机的参数:exit / async / sync |
| durable execution | 持久化执行:记录执行历史,进程崩溃后能从中断处继续,代表是 Temporal |
| `Retry-After` | 服务端在 429/503 响应里告诉你多久后再试的响应头 |

## 常见误区

**在 webhook 处理函数里直接跑 Agent。** 对方超时会重发,你会处理两遍。webhook 只验签、入队、返回。

**每一层都加重试。** SDK、应用、队列三层叠加,一次失败放大成几十次请求。每层只负责自己那类错误,次数要能乘出一个你能接受的上限。

**用随机 uuid 当幂等键。** 重试时会生成新的 uuid,等于没有。幂等键要由业务含义确定性地算出来,而且由工具层生成,不让模型参与。

**先查再插来防重复。** 并发下两个请求同时查到「不存在」,然后都插入。用唯一约束让数据库做判断。

**把超时当成「没执行」。** 你放弃等待,对方可能还在执行。写操作超时以后的重试,必须依靠幂等键才安全。

**重试耗尽以后任务就消失了。** 一定要有死信处理:标记状态、记录原因、通知人。最糟的情况不是任务失败,而是没人知道它失败了。

## 学习资料

### 文档与文章

- [arq 官方文档](https://arq-docs.helpmanual.io/):一页就能读完。重点看 Job uniqueness(`_job_id`)、Retrying jobs(`Retry` 异常和 `job_try`)、`Worker` 的参数说明(`max_jobs`、`job_timeout`、`max_tries`)。40 分钟。
- [LangGraph · Durable execution](https://docs.langchain.com/oss/python/langgraph/durable-execution):`durability` 三种模式的原文说明,以及为什么要把有副作用的操作放进 task。30 分钟。
- [Stripe · Idempotent requests](https://docs.stripe.com/api/idempotent_requests):行业里幂等键设计的标杆,两页纸说清楚规则:key 怎么生成、保留多久、参数不一致时怎么处理。15 分钟。
- [Celery 官方文档](https://docs.celeryq.dev/en/stable/):不用全读,看 First Steps 和 Tasks 里关于 `acks_late`、重试的部分,了解它的「至少一次」是怎么配出来的。面试可能问。30 分钟。
- [Temporal 官网](https://temporal.io/):看首页和「What is Temporal」的介绍,建立 workflow / activity 的概念就够了。20 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1jg4y13718&autoplay=0&high_quality=1" title="快速搞定---异步框架celery" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>武沛齐讲技术 · 快速搞定:异步框架 celery · 7 集约 2 小时,B 站讲 Celery 播放量最高的一套。我们用的是 arq,但 broker、worker、结果存储、重试这些概念是通用的,而且国内公司 Celery 用得最多,看前 4 集建立概念即可。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/PCZghg9ySrY" title="What is Temporal? Durable Execution Explained" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>The Data and AI Guy · What is Temporal? Durable Execution Explained · 14 分钟,用一个下单流程讲清楚 workflow、activity 和重放。看完再回来读文中 Temporal 那一节。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/w4spcXq5uCw" title="Why Every AI Agent Needs Durable Execution | Temporal, Samar Abbas" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Lightspeed Venture Partners · Why Every AI Agent Needs Durable Execution · 46 分钟,Temporal 联合创始人 Samar Abbas 的访谈。前 20 分钟讲为什么 Agent 让持久化执行重新变得重要,有不少真实客户的故障场景,适合当行业背景听。</figcaption>
</figure>

### 书籍

- Martin Kleppmann《Designing Data-Intensive Applications》(O'Reilly,第一版 2017)第 8 章「The Trouble with Distributed Systems」和第 11 章「Stream Processing」里讲「恰好一次」与幂等的部分。中文版《数据密集型应用系统设计》(中国电力出版社)。今天最值得读的一本,2 小时。
- Chip Huyen《AI Engineering》(O'Reilly, 2025)第 10 章里关于 gateway 和可靠性的小节,30 分钟。

### 开源项目与代码

- [python-arq/arq](https://github.com/python-arq/arq):源码不长,`worker.py` 里能看到 `job_try`、重试和超时是怎么实现的。读一遍对理解「至少一次」很有帮助。
- [Dramatiq](https://dramatiq.io/) 和 [RQ](https://python-rq.org/):两个替代方案的首页,各花 5 分钟看看它们的 API 长什么样,面试能说出取舍。

## 自测

1. 工单系统的 webhook 要求 5 秒内返回。你的处理函数应该做什么、不做什么?

<details><summary>答案</summary>

只做三件事:校验签名、用工单 id 作为 job id 入队、返回 202。不在里面调模型、不查知识库、不调业务工具。用工单 id 做 job id,对方重发时队列会去重。

</details>

2. 为什么说「至少执行一次」对 Agent 比对普通后端任务更危险?

<details><summary>答案</summary>

普通任务很多是纯计算或只读,重复执行没有副作用。Agent 会调用写操作工具(退款、发邮件、改状态),重复执行会产生重复的副作用。另外 Agent 每次执行路径可能不同,重跑时模型可能做出不一样的决定,比如第二次换了一张发票退款,这比简单的重复更难排查。

</details>

3. 你的同事把幂等键写成了 `f"{ticket_id}:{uuid4()}"`,哪里有问题?应该怎么写?

<details><summary>答案</summary>

uuid4 每次都不一样,重试时 key 也不一样,唯一约束拦不住重复。应该用只由业务含义决定的字段拼接后哈希,比如 `sha256(f"{ticket_id}:{invoice_id}:refund")`,同一个工单对同一张发票的退款,无论执行几次都得到同一个 key。

</details>

4. 一次模型调用,SDK `max_retries=2`,应用层包了 3 次重试,arq `max_tries=5`。最坏情况下会发出多少次请求?你会怎么调整?

<details><summary>答案</summary>

(2+1) × 3 × 5 = 45 次。调整:SDK 保留默认 2 次处理网络抖动并把 timeout 调小;应用层不再重试,只做错误分类;队列层 max_tries 改成 3,间隔拉长到几十秒。这样最坏 3 × 3 = 9 次,而且间隔足够长,不会加剧上游过载。

</details>

5. (面试题)worker 在 Agent 跑到第 4 个节点时被 kill,你的系统怎么恢复?会不会重复退款?

<details><summary>答案</summary>

参考答法:任务没有 ack,队列在超时后重新投递。thread_id 固定为工单 id,LangGraph 用 Postgres checkpointer、`durability="sync"`,每步状态都已落库。重试时检测到这个 thread 有未完成的进度,用 `None` 作为输入从最新 checkpoint 继续,前 3 个节点不会重跑。至于重复退款:退款工具用业务字段算幂等键,数据库唯一约束保证只建一条;外部支付调用也带同一个幂等键。如果崩溃发生在外部调用成功但本地未记录之间,靠每日对账兜底。

</details>

6. (面试题)什么时候你会选 Temporal 而不是 Celery/arq 加 checkpoint?

<details><summary>答案</summary>

当任务跨很长时间(小时到天)、中间有大量等待(人工审批、定时器)、需要协调多个外部服务、并且要求任何一步失败都能精确地只重试那一步时。Temporal 记录完整执行历史并能重放,定时器和等待是一等公民。小规模、单个服务内、任务几分钟级别的场景,队列加 LangGraph checkpoint 加幂等键更简单,运维成本也低得多。

</details>

## 明天预告

Day 38 · 成本与延迟。今天的批量实验会让你第一次看到一个让人心疼的数字:300 张工单跑下来花了多少钱。明天把一张工单的成本拆开算,用 prompt caching 把重复的 system prompt 和工具定义变便宜,让小模型做分类、大模型只做起草,再用并行工具调用和流式输出把延迟压下来。
