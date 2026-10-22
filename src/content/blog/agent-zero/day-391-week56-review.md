---
title: 'Day 391 · 第 56 周复习:生产化与安全(Day 385–390)'
description: '把这一周的会话锁、并发闸门、任务队列、arq、错误分类重试和幂等键串成一个能跑的退款 worker:同一张工单推两遍只处理一次,网络抖动自动重试,重试也只建一条退款,发票不存在直接转人工。'
pubDate: 2026-10-22
regime: none
tags: ['queue', 'arq', 'retry', 'idempotency', 'review', 'agent-zero']
series: 'agent-zero'
day: 391
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 390](/blog/agent-zero/day-390-idempotency/) 讲的是「至少执行一次」和幂等键:队列只保证任务不丢,不保证只跑一次,所以退款这种写操作要带一个由业务含义算出来的 key,再让数据库的 `UNIQUE` 约束去拦重复。到这里,这一周从「会话存哪」一路讲到「重复执行怎么办」,六天的东西其实是同一条链上的六个环节。今天不加新概念,把它们按真实的先后顺序拼成一个小 worker 跑一遍,再把本周最容易写错的几段代码默写出来。

## 今天要解决的问题

复习日不学新东西,目标是确认这一周的东西真的长在你手上了。今天结束时你应该能:

1. 不看文章,画出「webhook → 队列 → worker → 重试 → 幂等写库」这条链,说出每一环是哪一天讲的、防的是什么问题。
2. 默写 `is_retryable` 和 `create_refund_request` 两段核心代码,并用两个检查脚本证明它们是对的。
3. 跑通本周小项目 `part07/review56.py`:同一张工单推两遍只入队一次;第一次通知客户失败会自动重试;重试时退款不会建第二条;发票不存在的工单直接转人工、不重试。
4. 能解释两个故意写错的版本为什么错:幂等键用 uuid、重试不设上限。

预计用时 3–4 小时(复习日比平时长一点,大头在默写和练习)。前置:[Day 383](/blog/agent-zero/day-383-redis-basics/) 的 Redis、[Day 385](/blog/agent-zero/day-385-session-mgmt/) 到 [Day 390](/blog/agent-zero/day-390-idempotency/) 全部。

学法和平时一样:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 本周知识地图

先看全貌。这一周的六天,按一张工单从进来到处理完的顺序排,是下面这个样子:

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="本周知识地图:左边是 API 进程,负责会话锁和并发闸门;中间是 Redis 队列,用 job id 去重;右边是 worker,里面先做错误分类决定重试,再用幂等键写 Postgres">
<text x="20" y="24" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">一张工单在系统里走的路</text>
<rect x="20" y="44" width="170" height="120" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="105" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">API 进程</text>
<text x="32" y="92" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">会话存哪 · 385</text>
<text x="32" y="112" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">会话锁 busy · 385</text>
<text x="32" y="132" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">并发闸门 · 386</text>
<text x="32" y="152" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">返回 202 + job id</text>
<rect x="235" y="64" width="150" height="80" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="310" y="88" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Redis 队列</text>
<text x="310" y="110" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">什么活要进 · 387</text>
<text x="310" y="128" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">_job_id 去重 · 388</text>
<rect x="430" y="44" width="190" height="120" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="525" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">arq worker · 388</text>
<text x="442" y="92" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">ctx: job_id / job_try</text>
<text x="442" y="112" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">is_retryable · 389</text>
<text x="442" y="132" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">raise Retry(defer)</text>
<text x="442" y="152" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">次数用完 → 转人工</text>
<line x1="190" y1="104" x2="235" y2="104" stroke="var(--ink-soft)" stroke-width="1.5"/>
<line x1="385" y1="104" x2="430" y2="104" stroke="var(--ink-soft)" stroke-width="1.5"/>
<rect x="430" y="214" width="190" height="80" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="525" y="238" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Postgres · 390</text>
<text x="525" y="260" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">idempotency_key UNIQUE</text>
<text x="525" y="278" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">ON CONFLICT DO NOTHING</text>
<line x1="525" y1="164" x2="525" y2="214" stroke="var(--ink-soft)" stroke-width="1.5"/>
<path d="M 600 164 C 640 190, 640 120, 620 110" fill="none" stroke="var(--ink-faint)" stroke-width="1.2" stroke-dasharray="4 3"/>
<text x="20" y="214" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">每一环防的事:</text>
<text x="20" y="236" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">锁 → 同一会话两轮交错</text>
<text x="20" y="256" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">闸门 → 打爆上游变 429</text>
<text x="20" y="276" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">job id → webhook 重发</text>
<text x="230" y="236" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">分类 → 白重试 400</text>
<text x="230" y="256" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">幂等键 → 重试建两条</text>
<text x="230" y="276" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">转人工 → 失败没人知道</text>
</svg>
<figcaption>本周六天在一张工单处理链上的位置。蓝色是跑 Agent 的 worker,琥珀色是外部存储。虚线表示 worker 自己抛 Retry,任务回到队列里过一会儿再跑。</figcaption>
</figure>

图里有一点我想强调:这六个环节每个都只防一种事故,而且彼此替代不了。job id 去重拦得住 webhook 重发,拦不住 worker 崩了以后队列重新投递;幂等键拦得住重复写库,拦不住你对着一个 400 错误白白重试五次。面试时被问「你怎么保证不重复退款」,只答一个「加了幂等键」是不够的,要能把这条链从头讲到尾。

## 本周每天一句话

[Day 385 · 会话管理](/blog/agent-zero/day-385-session-mgmt/):「会话」其实是两样东西,对话状态交给 LangGraph 的 checkpointer,业务元数据(属于谁、什么状态)放自己建的表;同一个会话同一时间只允许跑一轮,用锁挡住用户手快点两次发送。

[Day 386 · 并发](/blog/agent-zero/day-386-concurrency/):Agent 服务的时间几乎都花在等网络,一个 asyncio 进程能挂很多连接;真正的瓶颈在上游模型 API 的速率限制,所以要用 `asyncio.Semaphore` 做一个全局闸门,宁可在自己这里排队。

[Day 387 · 队列是什么](/blog/agent-zero/day-387-queue-basics/):判断标准就一句,调用方能不能、愿不愿意等它做完。webhook、批量、定时、慢副作用都等不了,进队列,接口返回 202 和任务 id。

[Day 388 · arq 快速上手](/blog/agent-zero/day-388-arq/):`WorkerSettings` 列出任务函数,`enqueue_job` 按名字入队,任务函数第一个参数是 `ctx`;同一个 `_job_id` 在结果过期前再入队会返回 `None`。

[Day 389 · 重试](/blog/agent-zero/day-389-retry-errors/):先分类再重试。429、5xx、超时、连不上值得重试;400、401、业务拒绝重试一万次也一样;不认识的错误默认不重试。每一层只管自己那类错误,别三层叠成几十次。

[Day 390 · 至少执行一次和幂等](/blog/agent-zero/day-390-idempotency/):队列只能保证至少执行一次;写操作的幂等键由工具层按业务字段确定性地算出来,交给数据库唯一约束去判断,不先查再插。

如果哪一句你读着觉得「好像是这样,但说不清为什么」,先回那一天把对应小节重看一遍再往下走。复习日的意义就在这里。

## 准备环境

今天的代码都放在 `agent-zero-lab/part07/` 下,和本周前几天在同一个目录。开始前确认两样东西在跑。

Redis 用 Day 383 装好的那个。在任意目录执行:

```bash
redis-cli ping
```

回 `PONG` 就行。没回的话,按 Day 383 的方式把它起起来(用 Docker 的是 `docker start redis`)。

Postgres 今天新建一个库专门做复习,免得和前几天的表搅在一起。在 `agent-zero-lab` 目录下:

```bash
cd agent-zero-lab
psql -d postgres -c "CREATE DATABASE agentzero_w56"
uv add arq psycopg[binary] psycopg-pool openai httpx
```

最后一行如果前几天已经装过,uv 会直接告诉你没有变化。我实跑时的版本是 arq 0.28.0、psycopg 3.3.6、psycopg-pool 3.3.3、openai 3.36.1(2026 年 10 月在 PyPI 查到的最新版)。

建表用的还是 Day 390 那份 SQL,今天的版本把 `customer_id` 去掉了,小项目用不着:

```sql
-- agent-zero-lab/part07/sql/refunds.sql
CREATE TABLE IF NOT EXISTS refund_requests (
    id               TEXT PRIMARY KEY,
    idempotency_key  TEXT NOT NULL UNIQUE,
    ticket_id        TEXT NOT NULL,
    invoice_id       TEXT NOT NULL,
    amount_cents     INTEGER NOT NULL CHECK (amount_cents > 0),
    status           TEXT NOT NULL DEFAULT 'pending_approval',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

<div class="line-notes">

- `CREATE TABLE IF NOT EXISTS refund_requests (` 表已经在就什么也不做,所以这份脚本可以放心重复跑。
- `id               TEXT PRIMARY KEY,` 退款单号,由 Python 那边生成,形如 `R-de35a8ce`。
- `idempotency_key  TEXT NOT NULL UNIQUE,` 整个幂等方案的地基。同一个 key 只能有一行,第二次插入会冲突,这个判断由数据库原子地完成,两个 worker 同时插也只会成功一个。
- `amount_cents     INTEGER NOT NULL CHECK (amount_cents > 0),` 金额用「分」存整数,不用小数,避免 0.1 + 0.2 那种浮点误差(JS 里你见过 `0.30000000000000004`)。
- `status           TEXT NOT NULL DEFAULT 'pending_approval',` 新建的退款都是待审批,今天实跑出来的两行都是这个值。
- `created_at       TIMESTAMPTZ NOT NULL DEFAULT now()` 带时区的时间,不传就用数据库当前时间。

</div>

```bash
psql -d agentzero_w56 -f part07/sql/refunds.sql
```

没有任何输出就是成功了(加了 `-q` 会更安静)。

## 默写一:错误分类 `is_retryable`

这是 Day 389 的核心。合上文章,在 `part07/retry.py` 里把它写出来,写完再和下面对照。默写时最容易错的是分支顺序,下面 line-notes 里会说为什么顺序要紧。

```python
# agent-zero-lab/part07/retry.py
import httpx
import openai


class PermanentError(Exception):
    """重试没用的错误:直接失败,转人工。"""


def is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, (openai.RateLimitError, openai.APITimeoutError, openai.APIConnectionError)):
        return True
    if isinstance(exc, openai.InternalServerError):
        return True
    if isinstance(exc, openai.APIStatusError):
        return False
    if isinstance(exc, (httpx.TimeoutException, httpx.ConnectError, httpx.RemoteProtocolError)):
        return True
    return False
```

<div class="line-notes">

- `import httpx` 我们自己的工具(查订单、发通知)用 httpx 发请求,它们抛的是 httpx 的异常,所以要单独认。
- `class PermanentError(Exception):` 业务代码确定「重试也没用」时抛它,比如发票不存在。它不需要单独的分支,因为会一路落到最后的 `return False`。
- `def is_retryable(exc: BaseException) -> bool:` 输入一个异常对象,输出要不要重试。相当于 JS 里写一个 `(err: unknown) => boolean`,在 `catch` 里调用。
- `if isinstance(exc, (openai.RateLimitError, openai.APITimeoutError, openai.APIConnectionError)):` `isinstance` 第二个参数给元组,命中任意一个就算,类似 JS 的 `err instanceof A || err instanceof B`。这一行必须放在 `APIStatusError` 前面:`RateLimitError` 是 `APIStatusError` 的子类,顺序反了 429 会先被下面那个笼统分支判成 False。下面检查脚本里 429 实测返回 True。
- `if isinstance(exc, openai.InternalServerError):` 所有 5xx 都是这个类型。实测 503 返回 True。
- `if isinstance(exc, openai.APIStatusError):` 走到这里的只剩 4xx 了。实测 400 的 `BadRequestError`、401 的 `AuthenticationError` 都返回 False。
- `if isinstance(exc, (httpx.TimeoutException, httpx.ConnectError, httpx.RemoteProtocolError)):` 自己的 HTTP 工具连不上、读超时,算临时故障。实测 `httpx.ConnectError("refused")` 返回 True。
- `return False` 不认识的错误一律不重试。实测 `KeyError` 和 `PermanentError` 都落在这里,返回 False。

</div>

光看着对不算数,要用真实的异常对象喂进去。新建一个检查脚本:

```python
# agent-zero-lab/part07/check_retry.py
import httpx
import httpx2
import openai

from part07.retry import PermanentError, is_retryable

req = httpx2.Request("POST", "https://api.deepseek.com/chat/completions")


def status_error(cls, code: int):
    return cls(f"HTTP {code}", response=httpx2.Response(code, request=req), body=None)


cases = {
    "429 限流": status_error(openai.RateLimitError, 429),
    "503 上游挂了": status_error(openai.InternalServerError, 503),
    "400 参数错": status_error(openai.BadRequestError, 400),
    "401 key 错": status_error(openai.AuthenticationError, 401),
    "SDK 超时": openai.APITimeoutError(request=req),
    "httpx 连不上": httpx.ConnectError("refused"),
    "业务:发票不存在": PermanentError("INV-404"),
    "没见过的 KeyError": KeyError("ticket"),
}
for name, exc in cases.items():
    print(f"{name:<14} {type(exc).__name__:<22} retry={is_retryable(exc)}")
```

<div class="line-notes">

- `import httpx2` 这是今天踩到的一个新坑:openai SDK 到 3.x 以后底层换成了 HTTPX2(pydantic 团队维护的 httpx 分支),装 openai 时它会被自动装上,不用单独 `uv add`。SDK 的异常要求传 `httpx2.Request`,传 `httpx.Request` 运行时不报错,但 basedpyright 会标红:`"httpx._models.Request" is not assignable to "httpx2._models.Request"`。
- `req = httpx2.Request("POST", "https://api.deepseek.com/chat/completions")` 造异常需要一个请求对象,随便填一个地址就行,不会真的发出去。
- `def status_error(cls, code: int):` 一个小工厂函数,给定异常类和状态码,造出一个和真实 HTTP 错误长得一样的异常对象。
- `return cls(f"HTTP {code}", response=httpx2.Response(code, request=req), body=None)` openai 的状态码异常构造时要三样东西:消息、响应对象、响应体。
- `cases = {` 一个字典,键是给人看的说明,值是异常对象。Python 3.7 以后字典保持插入顺序,和 JS 对象的字符串键一样。
- `"SDK 超时": openai.APITimeoutError(request=req),` 超时异常只需要请求对象,因为根本没拿到响应。
- `print(f"{name:<14} {type(exc).__name__:<22} retry={is_retryable(exc)}")` `:<14` 是「左对齐、占 14 格」,类似 JS 的 `padEnd(14)`。中文字符占两格宽,所以终端里对得不是很齐,不影响。

</div>

```bash
uv run python -m part07.check_retry
```

我实跑的输出:

```text
429 限流         RateLimitError         retry=True
503 上游挂了       InternalServerError    retry=True
400 参数错        BadRequestError        retry=False
401 key 错      AuthenticationError    retry=False
SDK 超时         APITimeoutError        retry=True
httpx 连不上      ConnectError           retry=True
业务:发票不存在       PermanentError         retry=False
没见过的 KeyError  KeyError               retry=False
```

八行里四个 True、四个 False,和 Day 389 那张表一一对得上。你默写的版本如果哪一行不一样,别急着改代码,先想清楚是你的分支顺序问题,还是你对那类错误的判断变了。

## 默写二:幂等写库 `create_refund_request`

Day 390 的核心。同样先默写,再对照。

```python
# agent-zero-lab/part07/tools_refund.py
import hashlib
import uuid

from psycopg_pool import AsyncConnectionPool


def refund_key(ticket_id: str, invoice_id: str) -> str:
    return hashlib.sha256(f"{ticket_id}:{invoice_id}:refund".encode()).hexdigest()


async def create_refund_request(
    pool: AsyncConnectionPool, *, ticket_id: str, invoice_id: str, amount_cents: int
) -> dict:
    key = refund_key(ticket_id, invoice_id)
    rid = f"R-{uuid.uuid4().hex[:8]}"
    async with pool.connection() as conn:
        await conn.execute(
            """
            INSERT INTO refund_requests (id, idempotency_key, ticket_id, invoice_id, amount_cents)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (idempotency_key) DO NOTHING
            """,
            (rid, key, ticket_id, invoice_id, amount_cents),
        )
        cur = await conn.execute("SELECT id FROM refund_requests WHERE idempotency_key = %s", (key,))
        row = await cur.fetchone()
    assert row is not None
    return {"refund_id": row[0], "deduplicated": row[0] != rid}
```

<div class="line-notes">

- `def refund_key(ticket_id: str, invoice_id: str) -> str:` key 只由「哪张工单、哪张发票、做退款」三件事决定,和时间、随机数、模型输出都没关系。
- `return hashlib.sha256(f"{ticket_id}:{invoice_id}:refund".encode()).hexdigest()` `.encode()` 把字符串变成字节(相当于 JS 的 `new TextEncoder().encode(s)`),`hexdigest()` 输出 64 位十六进制字符串。同样的输入算多少次都一样,这是幂等键能用的前提。
- `pool: AsyncConnectionPool, *, ticket_id: str, invoice_id: str, amount_cents: int` 中间那个单独的 `*` 表示后面的参数只能按名字传。三个字符串挨着,按位置传很容易把工单号和发票号传反,这样写调用方必须写 `ticket_id=...`。
- `rid = f"R-{uuid.uuid4().hex[:8]}"` 退款单号每次随机生成,但它只在真正插入成功时才会用上。随机的是单号,不是 key,这两个别搞混。
- `async with pool.connection() as conn:` 从连接池借一个连接,块结束自动还回去。池是 `autocommit=True` 建的,每条语句执行完就生效。
- `ON CONFLICT (idempotency_key) DO NOTHING` key 已经存在就什么也不做,也不报错。
- `cur = await conn.execute("SELECT id FROM refund_requests WHERE idempotency_key = %s", (key,))` 不管刚才插没插进去,都按 key 再查一次。`(key,)` 是只有一个元素的元组,逗号不能省,省了就成了普通括号。
- `assert row is not None` 刚插过或者本来就有,这里一定查得到。写这一行主要是让类型检查器知道下面 `row[0]` 不会是 None。
- `return {"refund_id": row[0], "deduplicated": row[0] != rid}` 查回来的 id 不是这次生成的 `rid`,说明这次没插进去,命中了已有记录。

</div>

检查它对不对,最狠的办法是并发打它。10 个协程同时用同样的参数调,表里应该只有 1 行:

```python
# agent-zero-lab/part07/check_idem.py
import asyncio

from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

from part07.tools_refund import create_refund_request

DSN = "postgresql://localhost/agentzero_w56"


async def main():
    async with AsyncConnectionPool(DSN, connection_class=AsyncConnection, kwargs={"autocommit": True}) as pool:
        results = await asyncio.gather(
            *[create_refund_request(pool, ticket_id="T2001", invoice_id="INV-0789", amount_cents=500) for _ in range(10)]
        )
        ids = {r["refund_id"] for r in results}
        fresh = sum(not r["deduplicated"] for r in results)
        async with pool.connection() as conn:
            cur = await conn.execute("SELECT count(*) FROM refund_requests WHERE ticket_id = 'T2001'")
            row = await cur.fetchone()
        print("不同的 refund_id:", ids)
        print("真正插入的次数:", fresh)
        print("表里 T2001 的行数:", row[0] if row else None)


asyncio.run(main())
```

<div class="line-notes">

- `DSN = "postgresql://localhost/agentzero_w56"` 连接串,本机 Postgres、今天新建的库。本机用户没设密码,所以不用写用户名密码。
- `async with AsyncConnectionPool(DSN, connection_class=AsyncConnection, kwargs={"autocommit": True}) as pool:` `connection_class=AsyncConnection` 运行时可以不写(默认就是它),写上是为了让 basedpyright 推断出池的具体类型,不然传给 `create_refund_request` 时会报类型不匹配。
- `results = await asyncio.gather(` `gather` 同时跑一组协程,全部完成后按顺序返回结果列表,相当于 JS 的 `Promise.all`。
- `*[create_refund_request(pool, ticket_id="T2001", invoice_id="INV-0789", amount_cents=500) for _ in range(10)]` 列表推导式造出 10 个协程对象,前面的 `*` 把列表摊开成 10 个参数,类似 JS 的展开运算符 `...`。
- `ids = {r["refund_id"] for r in results}` 花括号推导式造的是集合,自动去重。如果幂等生效,这里只剩一个元素。
- `fresh = sum(not r["deduplicated"] for r in results)` `True` 在求和时当 1 算,所以这一行数的是「真正插入成功的次数」。
- `cur = await conn.execute("SELECT count(*) FROM refund_requests WHERE ticket_id = 'T2001'")` 最后直接问数据库,不信 Python 这边的统计。
- `print("表里 T2001 的行数:", row[0] if row else None)` `fetchone()` 理论上可能是 None,这里做个兜底。

</div>

```bash
uv run python -m part07.check_idem
```

实跑输出:

```text
不同的 refund_id: {'R-dd294590'}
真正插入的次数: 1
表里 T2001 的行数: 1
```

10 次并发调用,只有 1 次真插进去,另外 9 次都拿到了同一个 `R-dd294590`。如果你写成「先 SELECT 看有没有,没有再 INSERT」,这个脚本有机会跑出 2 行甚至更多,这正是 Day 390 说的窗口期。

## 本周小项目:一个会重试、不会重复退款的 worker

两段核心代码都过了检查,现在把它们装进 arq worker。场景是这样的:工单系统推来三张退款工单,而且因为对方没及时收到响应,每张都推了两遍。

- T1041 要退 INV-0123,2392 元。
- T1042 要退 INV-0456,99 元。
- T1043 要退 INV-404,这张发票根本不存在。

worker 处理每张工单分两步:先建退款申请,再给客户发一封通知。为了模拟真实世界的网络抖动,通知这一步在第一次执行时一定失败,抛 `httpx.ConnectError`。这个设计是故意的:**退款已经写进库了,后面一步才失败**,任务重试时会把整个函数再跑一遍,退款这一步会被重复执行。这正是 Day 390 讲的「至少执行一次」最典型的样子。

```python
# agent-zero-lab/part07/review56.py
import asyncio
import sys

import httpx
from arq import Retry, create_pool
from arq.connections import RedisSettings
from psycopg_pool import AsyncConnectionPool

from part07.retry import PermanentError, is_retryable
from part07.tools_refund import create_refund_request

DSN = "postgresql://localhost/agentzero_w56"
INVOICES = {"INV-0123": 239200, "INV-0456": 9900}  # 假装这是发票表


async def notify_customer(ctx, ticket_id: str) -> None:
    if ctx["job_try"] == 1:  # 第一次一定「网络抖动」
        raise httpx.ConnectError("mail server connection reset")


async def refund_job(ctx, ticket_id: str, invoice_id: str) -> str:
    try:
        if invoice_id not in INVOICES:
            raise PermanentError(f"发票 {invoice_id} 不存在")
        r = await create_refund_request(
            ctx["pool"], ticket_id=ticket_id, invoice_id=invoice_id, amount_cents=INVOICES[invoice_id]
        )
        print(f"[{ticket_id}] try {ctx['job_try']} refund {r}", flush=True)
        await notify_customer(ctx, ticket_id)
        return f"done {r['refund_id']}"
    except Exception as exc:
        if is_retryable(exc) and ctx["job_try"] < 3:
            print(f"[{ticket_id}] try {ctx['job_try']} {type(exc).__name__} -> 重试", flush=True)
            raise Retry(defer=1) from exc
        print(f"[{ticket_id}] try {ctx['job_try']} {type(exc).__name__}: {exc} -> 转人工", flush=True)
        return "needs_human"


async def startup(ctx):
    ctx["pool"] = AsyncConnectionPool(DSN, open=False, kwargs={"autocommit": True})
    await ctx["pool"].open()


async def shutdown(ctx):
    await ctx["pool"].close()


class WorkerSettings:
    functions = [refund_job]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings()
    max_tries = 3


async def main(run: str):
    redis = await create_pool(RedisSettings())
    for _ in range(2):  # 每张工单故意推两遍,模拟 webhook 重发
        for tid, inv in [("T1041", "INV-0123"), ("T1042", "INV-0456"), ("T1043", "INV-404")]:
            job = await redis.enqueue_job("refund_job", tid, inv, _job_id=f"{run}-{tid}")
            print(tid, "入队" if job else "重复,跳过")
    await redis.aclose()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
```

<div class="line-notes">

- `from arq import Retry, create_pool` `Retry` 是 arq 认得的一种特殊异常,任务里抛它,arq 就会过一会儿重新执行这个任务(Day 388)。
- `from part07.retry import PermanentError, is_retryable` 上面默写的错误分类,哪些算临时故障只在 `retry.py` 一个地方定义。
- `INVOICES = {"INV-0123": 239200, "INV-0456": 9900}  # 假装这是发票表` 金额单位是分,239200 分就是 2392 元。今天的重点不在查发票,用字典代替数据库。
- `async def notify_customer(ctx, ticket_id: str) -> None:` 假装发邮件通知客户。
- `if ctx["job_try"] == 1:  # 第一次一定「网络抖动」` `job_try` 是 arq 放进 `ctx` 的「这是第几次执行」,第一次是 1。用它控制「第一次失败、第二次成功」,实验结果就稳定可复现。
- `raise httpx.ConnectError("mail server connection reset")` 抛一个 `is_retryable` 会判成 True 的异常。
- `async def refund_job(ctx, ticket_id: str, invoice_id: str) -> str:` 任务函数,第一个参数固定是 `ctx`,后面是入队时传的参数。
- `raise PermanentError(f"发票 {invoice_id} 不存在")` 业务上确定重试没用,直接抛永久错误。实测 T1043 走的就是这条。
- `r = await create_refund_request(` 先写库。这一步在每次执行里都会跑,靠幂等键保证只生效一次。
- `print(f"[{ticket_id}] try {ctx['job_try']} refund {r}", flush=True)` `flush=True` 让输出立刻写出去,不然 worker 的输出被重定向时会攒着,和 arq 自己的日志顺序对不上。我第一次没加,三张工单的 print 全挤在日志最后面。
- `await notify_customer(ctx, ticket_id)` 写库之后的一步。它失败时退款已经建好了,这是今天实验的关键。
- `except Exception as exc:` 所有异常先到这里分类。
- `if is_retryable(exc) and ctx["job_try"] < 3:` 两个条件都满足才重试:错误是临时的,而且还没到第 3 次。第二个条件很要紧,练习 2 会演示去掉它的后果。
- `raise Retry(defer=1) from exc` 1 秒后重跑。`from exc` 把原始异常挂在 `__cause__` 上,排查时看得到根因。真实系统里间隔要长得多(Day 389 用的是 10 秒、40 秒),这里为了演示快一点。
- `return "needs_human"` 不能重试或者次数用完,就把结果标成需要人工。任务正常结束,不抛异常,失败原因在上一行打印出来了。
- `ctx["pool"] = AsyncConnectionPool(DSN, open=False, kwargs={"autocommit": True})` worker 启动时建一次连接池,放进 `ctx`,之后每个任务都能拿到。`open=False` 再手动 `await open()`,是 psycopg-pool 推荐的异步写法。
- `max_tries = 3` arq 最多执行 3 次,和上面 `job_try < 3` 的判断配套。
- `for _ in range(2):  # 每张工单故意推两遍,模拟 webhook 重发` 外层循环两遍,内层三张工单,一共 6 次入队。
- `job = await redis.enqueue_job("refund_job", tid, inv, _job_id=f"{run}-{tid}")` job id 用「批次号-工单号」拼出来。真实系统直接用工单号,这里加一个 `run` 前缀是为了能反复做实验:arq 的结果默认在 Redis 里留 1 小时,这一小时内同一个 id 再入队都会被当成重复。
- `print(tid, "入队" if job else "重复,跳过")` 重复的 job id 入队返回 None。

</div>

开两个终端,都在 `agent-zero-lab` 目录下。先入队,再起 worker。这里给 worker 加了 `--burst`,意思是把队列里的活干完就自己退出,做实验方便;平时上线不加这个参数。

```bash
uv run python -m part07.review56 r3
uv run arq --burst part07.review56.WorkerSettings
psql -d agentzero_w56 -c "SELECT id, ticket_id, invoice_id, amount_cents, status FROM refund_requests ORDER BY ticket_id"
```

我实跑的完整输出(批次号用的 `r3`,前两次实验的表我清掉了):

```text
T1041 入队
T1042 入队
T1043 入队
T1041 重复,跳过
T1042 重复,跳过
T1043 重复,跳过
12:01:58: Starting worker for 1 functions: refund_job
12:01:58: redis_version=7.4.6 mem_usage=1.58M clients_connected=1 db_keys=10
12:01:58:   2.67s → r3-T1041:refund_job('T1041', 'INV-0123') delayed=2.67s
12:01:58:   2.67s → r3-T1042:refund_job('T1042', 'INV-0456') delayed=2.67s
12:01:58:   2.67s → r3-T1043:refund_job('T1043', 'INV-404') delayed=2.67s
[T1043] try 1 PermanentError: 发票 INV-404 不存在 -> 转人工
12:01:58:   0.00s ← r3-T1043:refund_job ● 'needs_human'
[T1041] try 1 refund {'refund_id': 'R-de35a8ce', 'deduplicated': False}
[T1041] try 1 ConnectError -> 重试
12:01:58:   0.04s ↻ r3-T1041:refund_job retrying job in 1.00s
[T1042] try 1 refund {'refund_id': 'R-fb58a6dd', 'deduplicated': False}
[T1042] try 1 ConnectError -> 重试
12:01:58:   0.04s ↻ r3-T1042:refund_job retrying job in 1.00s
12:02:00:   4.15s → r3-T1041:refund_job('T1041', 'INV-0123') try=2
12:02:00:   4.15s → r3-T1042:refund_job('T1042', 'INV-0456') try=2
[T1042] try 2 refund {'refund_id': 'R-fb58a6dd', 'deduplicated': True}
12:02:00:   0.00s ← r3-T1042:refund_job ● 'done R-fb58a6dd'
[T1041] try 2 refund {'refund_id': 'R-de35a8ce', 'deduplicated': True}
12:02:00:   0.01s ← r3-T1041:refund_job ● 'done R-de35a8ce'
     id     | ticket_id | invoice_id | amount_cents |      status
------------+-----------+------------+--------------+------------------
 R-de35a8ce | T1041     | INV-0123   |       239200 | pending_approval
 R-fb58a6dd | T1042     | INV-0456   |         9900 | pending_approval
(2 rows)
```

一行一行对着本周的知识点看。

前六行是 Day 388 的 `_job_id` 去重:6 次入队,只有前 3 次进了队列,后 3 次返回 None。webhook 重发在这一层就被挡掉了。

arq 日志里 `→` 是开始执行,`←` 是执行完,`↻` 是要重试。`delayed=2.67s` 是因为我先入队、隔了两三秒才起 worker,任务在队列里等了这么久。

T1043 第一次执行就抛 `PermanentError`,`is_retryable` 判 False,直接 `needs_human`,没有任何重试。这是 Day 389 的分类在起作用:发票不存在,重试一万次也不存在。

T1041 和 T1042 的第一次执行,退款都建成功了(`deduplicated: False`),然后通知失败,`ConnectError` 被判成可重试,抛 `Retry`,arq 打出 `retrying job in 1.00s`。

第二次执行(`try=2`)把整个函数重跑了一遍,所以 `create_refund_request` 又被调用了一次。这一次 `refund_id` 还是第一次那个 `R-de35a8ce`,`deduplicated` 变成 True。最后表里只有 2 行。至少执行一次 + 幂等键,结果就是恰好生效一次。

这张表就是本周的答卷。

### 零件和大代码的对照

| 本周学的零件 | 在 `review56.py` 里是哪一段 |
| --- | --- |
| Day 387 什么活要进队列 | 整个文件的形状:`main` 只入队就走,真正干活的是 worker |
| Day 388 `_job_id` 去重 | `enqueue_job(..., _job_id=f"{run}-{tid}")` 和「重复,跳过」 |
| Day 388 `ctx` 和 `job_try` | `notify_customer` 里用 `job_try` 制造故障,`except` 里用它限次数 |
| Day 388 `startup` 放共享资源 | `ctx["pool"] = AsyncConnectionPool(...)` |
| Day 389 错误分类 | `is_retryable(exc)` 和 `PermanentError` |
| Day 389 任务层重试 | `raise Retry(defer=1) from exc` 和 `max_tries = 3` |
| Day 389 死信的业务版本 | `return "needs_human"` |
| Day 390 幂等键 | `create_refund_request` 里的 `refund_key` 和 `ON CONFLICT` |

Day 385 的会话锁和 Day 386 的并发闸门在 API 进程那一侧,这个 worker 里没用上,练习 3 单独复习它们。

## 本周错题与坑清单

下面这些是这一周(加上今天复习时)真正踩过的,按出现的频率排。

**同一个 job id 一小时内入队返回 None,后面接着 `job.result` 就炸。** Day 388 的 `demo_arq.py` 第一次跑时如果 worker 没起来,任务留在 Redis 里;重跑脚本时连第一次入队都返回 None,紧接着报 `'NoneType' object has no attribute 'result'`。原因是 arq 默认把结果保留 3600 秒,这期间同一个 id 再入队都算重复。做实验就每次换 id(今天的 `run` 前缀就是这么来的),或者用 `redis-cli flushdb` 清空练习用的库。

**重试次数用完以后,任务「完成」了,但没人知道它失败了。** 练习 2 会实跑出来:不写 `job_try < 3` 这个判断,第 3 次执行时 arq 打出 `max retries 3 exceeded`,任务结束,数据库里没有任何「转人工」的记录。更迷惑的是,事后用 `Job(...).status()` 查,状态是 `complete`,要看 `result_info()` 的 `success` 才知道是 False。

**幂等键写成随机数。** 练习 1 实跑:表里从 2 行变成 4 行,每张工单退了两次钱。

**以为 openai SDK 底层还是 httpx。** 今天写检查脚本时踩的。openai 3.x 换成了 HTTPX2,SDK 异常要 `httpx2.Request`。运行时传错类型也能跑,但编辑器里一片红。我们自己写的工具照样用 httpx,`is_retryable` 里认的 `httpx.ConnectError` 不受影响,因为 SDK 的网络错误早就被包成 `openai.APIConnectionError` 了。

**print 和日志顺序对不上。** worker 的标准输出被重定向(比如 `| grep` 或者写进文件)时,Python 会攒一批再输出,arq 的日志走 stderr 不攒,两者就错位了。`print(..., flush=True)` 或者干脆用 `logging`。

**`ON CONFLICT DO NOTHING` 以后忘了再查一次。** 插入冲突时 `INSERT` 什么也不返回,你手里只有这次新生成的 `rid`,而它根本没进库。把它当退款单号返回给模型,后面审批流就找不到这张单了。

## 动手练习

### 练习 1:把幂等键换成随机数,看会发生什么

把 `tools_refund.py` 里 `refund_key` 的返回值临时改成 `uuid.uuid4().hex`,清空表,用一个新批次号跑一遍小项目,看表里有几行。做完记得改回来。

<details><summary>参考答案</summary>

改动只有一行:

```python
# agent-zero-lab/part07/tools_refund.py(错误示范,做完改回去)
def refund_key(ticket_id: str, invoice_id: str) -> str:
    return uuid.uuid4().hex  # 错误示范
```

<div class="line-notes">

- `def refund_key(ticket_id: str, invoice_id: str) -> str:` 函数签名不变,调用方完全察觉不到 key 的含义变了。这种 bug 最难查。
- `return uuid.uuid4().hex  # 错误示范` 每次调用都生成一个新的随机串。重试时算出来的 key 和第一次不同,`UNIQUE` 约束看到的是两个不同的值,就放行了。

</div>

```bash
psql -d agentzero_w56 -c "TRUNCATE refund_requests"
uv run python -m part07.review56 bad1
uv run arq --burst part07.review56.WorkerSettings
psql -d agentzero_w56 -c "SELECT id, ticket_id FROM refund_requests ORDER BY created_at"
```

实跑时 worker 打出来的 print(只摘了工单那几行):

```text
[T1043] try 1 PermanentError: 发票 INV-404 不存在 -> 转人工
[T1041] try 1 refund {'refund_id': 'R-f313106d', 'deduplicated': False}
[T1041] try 1 ConnectError -> 重试
[T1042] try 1 refund {'refund_id': 'R-da501511', 'deduplicated': False}
[T1042] try 1 ConnectError -> 重试
[T1042] try 2 refund {'refund_id': 'R-6324f636', 'deduplicated': False}
[T1041] try 2 refund {'refund_id': 'R-193cd81a', 'deduplicated': False}
```

```text
     id     | ticket_id
------------+-----------
 R-f313106d | T1041
 R-da501511 | T1042
 R-193cd81a | T1041
 R-6324f636 | T1042
(4 rows)
```

第二次执行的 `deduplicated` 也是 False,表里 4 行,T1041 和 T1042 各退了两次。job id 去重一点问题没有(还是只入队了 3 次),出问题的是任务内部的重试。这说明两层去重防的是不同的事,少了哪层都不行。

</details>

### 练习 2:去掉重试次数的判断

把 `except` 里的 `and ctx["job_try"] < 3` 删掉,同时让 `notify_customer` 每次都失败(把 `if ctx["job_try"] == 1:` 改成 `if True:`),跑一遍。观察 T1041 最后的结局,再用 `Job` 查它的结果。

<details><summary>参考答案</summary>

我把改过的版本另存成 `part07/review56_noguard.py`(两处改动就是题目说的那两行,其余不变),然后:

```bash
uv run python -m part07.review56_noguard ng1
uv run arq --burst part07.review56_noguard.WorkerSettings
```

实跑日志的后半段:

```text
12:02:39:   4.82s → ng1-T1041:refund_job('T1041', 'INV-0123') try=3
[T1041] try 3 refund {'refund_id': 'R-952568d8', 'deduplicated': True}
[T1041] try 3 ConnectError -> 重试
12:02:39:   0.00s ↻ ng1-T1041:refund_job retrying job in 1.00s
12:02:40:   6.32s ! ng1-T1041:refund_job max retries 3 exceeded
```

第 3 次执行还在说「重试」,arq 照样把它放回队列;1 秒后 arq 准备第 4 次执行时发现超过了 `max_tries`,直接打一行 `max retries 3 exceeded` 结束。我们的 `needs_human` 分支一次也没走到。再查结果:

```python
# 在 agent-zero-lab 目录下 uv run python 里执行
import asyncio
from arq import create_pool
from arq.connections import RedisSettings
from arq.jobs import Job


async def show():
    redis = await create_pool(RedisSettings())
    for jid in ["ng1-T1041", "r3-T1041"]:
        job = Job(jid, redis)
        info = await job.result_info()
        print(jid, (await job.status()).value, info and info.success, info and info.job_try, repr(info and info.result))


asyncio.run(show())
```

<div class="line-notes">

- `job = Job(jid, redis)` 用 job id 构造一个 `Job` 对象,不用当初入队时的那个返回值也能查。
- `info = await job.result_info()` 拿结果详情,里面有 `success`、`job_try`、`result`。任务没跑完时是 None,所以下面每处都写了 `info and ...`。
- `print(jid, (await job.status()).value, info and info.success, info and info.job_try, repr(info and info.result))` `status()` 返回枚举,`.value` 是字符串。

</div>

实跑输出:

```text
ng1-T1041 complete False 4 JobExecutionFailed('max 3 retries exceeded')
r3-T1041 complete True 2 'done R-de35a8ce'
```

两个任务的状态都是 `complete`。只看状态,你会以为失败的那个也做完了。真正的区别在 `success`:一个 False 一个 True。`job_try` 是 4,是因为 arq 在第 4 次「准备执行」时才发现超限。

所以「次数用完」这件事要在自己的代码里接住(`job_try < 3` 加 `needs_human`),把结果写到工单表或者告警里,不能指望从队列状态上看出来。

</details>

### 练习 3:复习会话锁和并发闸门

不看 Day 385、386,写一个脚本:同一个会话同时来两轮请求,第二轮立刻返回 busy;另外 7 次模拟的模型调用被一个容量为 3 的闸门限流。打印每次调用的开始时间和总耗时。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part07/check_lock_sem.py
import asyncio
import time
from collections import defaultdict

locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
gate = asyncio.Semaphore(3)


async def run_turn(sid: str, text: str) -> str:
    lock = locks[sid]
    if lock.locked():
        return f"{text}: busy"
    async with lock:
        await asyncio.sleep(0.3)  # 假装 Agent 在跑一轮
        return f"{text}: ok"


async def call_model(i: int, t0: float) -> None:
    async with gate:
        print(f"call {i} 开始 {time.perf_counter() - t0:.1f}s")
        await asyncio.sleep(0.5)


async def main():
    print(await asyncio.gather(run_turn("s_1", "第一次点发送"), run_turn("s_1", "手快又点一次"), run_turn("s_2", "别的会话")))
    t0 = time.perf_counter()
    await asyncio.gather(*[call_model(i, t0) for i in range(7)])
    print(f"7 次调用总耗时 {time.perf_counter() - t0:.2f}s")


asyncio.run(main())
```

<div class="line-notes">

- `locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)` 第一次访问某个会话 id 时自动新建一把锁,以后再取还是同一把。锁只活在这个进程的内存里。
- `gate = asyncio.Semaphore(3)` 信号量,最多允许 3 个协程同时进入 `async with gate` 里面。
- `if lock.locked():` 锁已经被占了就不排队,直接回 busy。Day 385 的服务就是这样处理用户手快点两次的。
- `return f"{text}: busy"` 实测「手快又点一次」拿到的就是这一句。
- `async with lock:` 拿到锁,块结束自动释放。相当于 JS 里自己维护一个 `running` 标志,只是这里由 asyncio 保证正确。
- `async with gate:` 进不去的协程在这里等,前面有人出来才轮到它。
- `print(f"call {i} 开始 {time.perf_counter() - t0:.1f}s")` 打印的是进入闸门的时刻,不是调用 `call_model` 的时刻。
- `print(await asyncio.gather(run_turn("s_1", "第一次点发送"), run_turn("s_1", "手快又点一次"), run_turn("s_2", "别的会话")))` 三轮同时发起,前两轮是同一个会话。

</div>

```bash
uv run python -m part07.check_lock_sem
```

实跑输出:

```text
['第一次点发送: ok', '手快又点一次: busy', '别的会话: ok']
call 0 开始 0.0s
call 1 开始 0.0s
call 2 开始 0.0s
call 3 开始 0.5s
call 4 开始 0.5s
call 5 开始 0.5s
call 6 开始 1.0s
7 次调用总耗时 1.50s
```

同一个会话的第二轮被挡,别的会话不受影响。7 次调用分成 3、3、1 三批,每批 0.5 秒,总共 1.5 秒。如果没有闸门,7 次会同时打出去,总耗时 0.5 秒左右,但真实的模型 API 很可能在第 N 个并发时开始回 429。

别忘了这把锁和闸门都只在一个进程里有效,`uvicorn --workers 4` 起四个进程就各管各的了。Day 385 提过,多进程要换成 Redis 的 `SET key NX EX` 或 Postgres 的 advisory lock。

</details>

### 练习 4:换个批次号重跑,退款会不会再建一遍

表里已经有 T1041、T1042 的退款,不清表,用新批次号 `r4` 再跑一遍小项目。job id 变了,队列不会去重,那退款呢?先预测,再跑。

<details><summary>参考答案</summary>

预测:job id 是新的,三张工单都会入队并执行;但幂等键只看工单号和发票号,和 job id 无关,所以退款不会新建。

我在实验过程中真的这么跑过一次(当时批次号是 `r2`,表里已经有 `r1` 留下的两行),worker 的输出里关键的几行:

```text
[T1041] try 1 refund {'refund_id': 'R-d7e2add3', 'deduplicated': True}
[T1041] try 1 ConnectError -> 重试
[T1042] try 1 refund {'refund_id': 'R-3b663bd6', 'deduplicated': True}
[T1041] try 2 refund {'refund_id': 'R-d7e2add3', 'deduplicated': True}
```

第一次执行就已经是 `deduplicated: True`,拿到的是上一批留下的单号;表里还是 2 行。

这个实验说明了一件事:job id 去重有时效(结果过期就失效),也和批次绑在一起;幂等键是业务层面的,永久有效。真实场景里,运营第二天手动「重新处理」一批工单,靠的就是后者。

</details>

**验收标准**:`check_retry` 八行结果和文中一致;`check_idem` 只插入 1 次;小项目跑完表里只有 2 行;练习 1 能复现 4 行并解释原因;练习 2 能说清楚为什么 `complete` 不等于成功;不看文章能把本周知识地图画出来。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 复习日 | 每 6 个内容日之后的一天,不学新概念,画知识地图、默写核心代码、做一个只用本周知识的小项目 |
| `--burst` | arq 命令行参数,worker 把队列里的任务做完就退出,适合做实验,上线不用 |
| `result_info()` | arq `Job` 对象的方法,返回任务结果详情:`success`、`job_try`、`result` 等,没跑完是 None |
| `JobExecutionFailed` | arq 在重试次数超限时放进结果里的异常,消息是 `max 3 retries exceeded` |
| HTTPX2 | pydantic 团队维护的 httpx 分支,openai Python SDK 3.x 的默认 HTTP 客户端 |
| `flush=True` | `print` 的参数,立刻把输出写出去,不在缓冲区里攒着 |
| 两层去重 | 队列层的 job id 去重(防重复入队)加业务层的幂等键(防重复生效),各防一类重复 |

## 常见误区

**以为 job id 去重就等于幂等。** job id 只保证同一个任务不会同时在队列里出现两份。任务内部因为重试被执行两遍、或者结果过期后被重新入队,它都管不了。练习 1 里 job id 一切正常,退款照样建了两次。

**看到任务状态 `complete` 就以为成功了。** arq 的 `complete` 只表示「这个任务不会再跑了」,包括重试耗尽的失败。要看 `success`,更好的办法是在自己的代码里把失败写进业务表。

**重试只看错误类型,不看次数。** `is_retryable` 回答的是「这类错误值不值得重试」,不回答「已经试了几次」。两者要一起判断,并且次数用完时要有一个明确的去处(`needs_human`)。

**把会话锁和并发闸门混为一谈。** 锁是「同一个会话同一时间只跑一轮」,粒度是一个会话;闸门是「全进程同时最多打 N 个模型请求」,粒度是整个服务。一个防消息历史错乱,一个防上游 429。

**复习日只看不写。** 读一遍觉得都懂,合上文章写 `is_retryable` 时才发现分支顺序记不清。默写这一步跳不得:把 `APIStatusError` 那个分支写在 `RateLimitError` 前面,429 就会被判成不可重试,而代码看上去完全没毛病,只有拿 `check_retry.py` 一跑才露馅。

## 学习资料

### 文档与文章

- [arq 官方文档](https://arq-docs.helpmanual.io/):今天重点看 Job uniqueness、Retrying jobs 和 Worker 参数三节,对照着检查本周写的代码有没有和文档冲突的地方。30 分钟。
- [Stripe · Idempotent requests](https://docs.stripe.com/api/idempotent_requests):幂等键设计的标杆。复习时注意它对「同一个 key 但参数不同」的处理,那是我们的 `create_refund_request` 没处理的情况。15 分钟。
- [Brandur · Implementing Stripe-like Idempotency Keys in Postgres](https://brandur.org/idempotency-keys):前 Stripe 工程师写的长文,用 Postgres 实现完整的幂等键,包括「请求执行到一半崩了」怎么恢复。比我们今天的版本复杂得多,适合复习完想往深处走的时候读。1 小时。
- [AWS Builders' Library · Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/):AWS 自己的工程文章,讲重试和幂等为什么必须一起设计,和本周后两天的内容几乎一一对应。英文,30 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV193hyzrEuE&autoplay=0&high_quality=1" title="怎么保证消息的幂等性?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员回家养猪 · 怎么保证消息的幂等性? · 2 分多钟,2025 年的视频。用 Java 后端的面试语境讲消费幂等,和我们的「至少执行一次 + 幂等键」是同一个道理,适合当复习的快速串讲。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1CXarehE8k&autoplay=0&high_quality=1" title="跪求兄弟们了,写接口一定要支持幂等呀!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员知正 · 跪求兄弟们了,写接口一定要支持幂等呀! · 约 12 分钟。从一个前端重复提交的场景讲起,前端出身看这个特别有共鸣,后半段讲的唯一约束方案就是我们用的那个。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/XAccGbtl3Z8" title="Idempotency - What it is and How to Implement it" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Alex Hyett · Idempotency - What it is and How to Implement it · 英文,画图讲 HTTP 方法的幂等性和幂等键的实现,和 Day 390 的内容互相印证。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/1fTUlTqm_Vk" title="How API Retries Cause Outages (Backoff & Jitter Explained)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>CodeAnimated · How API Retries Cause Outages (Backoff & Jitter Explained) · 英文动画,讲重试怎么把上游打挂、退避和抖动怎么救场,复习 Day 389 正合适。</figcaption>
</figure>

### 书籍

- Martin Kleppmann《Designing Data-Intensive Applications》(O'Reilly,第一版 2017,中文版《数据密集型应用系统设计》,中国电力出版社)第 11 章讲「恰好一次」和幂等的部分。第二版(与 Chris Riccomini 合著)2026 年初已出英文版,有条件可以直接读新版对应章节。今天读 1 小时。

### 开源项目与代码

- [python-arq/arq](https://github.com/python-arq/arq):打开 `arq/worker.py`,搜 `max retries`,能看到练习 2 那行日志是在哪里打出来的,以及为什么 `job_try` 会是 4。

## 自测

1. 小项目里,T1041 第二次执行时 `create_refund_request` 被调用了,为什么表里没有多出一行?

<details><summary>答案</summary>

第二次执行算出来的幂等键和第一次一样(只由工单号和发票号决定),`INSERT ... ON CONFLICT (idempotency_key) DO NOTHING` 遇到冲突什么也不做,随后按 key 查回来的是第一次插入的那行,所以 `refund_id` 还是 `R-de35a8ce`,`deduplicated` 是 True。

</details>

2. 同样是失败,T1043 为什么一次都没重试?

<details><summary>答案</summary>

T1043 抛的是 `PermanentError`(发票不存在),`is_retryable` 对它返回 False,代码直接走 `needs_human`。这类错误是业务结果,重试多少次发票也不会凭空出现。

</details>

3. 如果 webhook 第二次推送 T1041 时,第一次的任务已经执行完而且结果在 Redis 里过期了,会发生什么?退款会重复吗?

<details><summary>答案</summary>

job id 去重失效,T1041 会被再次入队、再次执行。但退款不会重复,因为幂等键还在数据库里,`create_refund_request` 会返回已有的记录。通知客户那一步会再发一次,如果不想重复发邮件,通知也要有自己的幂等记录。

</details>

4. 一个同事说:「我们给 SDK 设了 `max_retries=2`,arq 设了 `max_tries=3`,任务里又包了一个最多 3 次的循环。」最坏情况一次模型调用会变成多少次请求?

<details><summary>答案</summary>

(2+1) × 3 × 3 = 27 次。Day 389 的建议是每层只管自己那类错误:SDK 管网络抖动,应用层只分类不重试,任务层管整个任务重来,这样最坏是 3 × 3 = 9 次,而且任务层的间隔要拉长。

</details>

5. (面试题)你的 Agent worker 处理退款工单,请从工单进来讲到退款落库,说说你在哪些环节防了重复,各防的是什么。

<details><summary>答案</summary>

参考答法:入口 webhook 只验签、入队、返回 202,用工单 id 当 job id,防工单系统超时重发;worker 里先对异常分类,临时故障才重试、有次数上限,永久错误和次数用完转人工,防白重试和失败无人知晓;队列是至少执行一次,任务重跑时写操作工具用工单号加发票号算幂等键,数据库唯一约束加 `ON CONFLICT` 保证只生效一次,防重复退款;外部支付调用也带同一个 key。job id 去重有时效,幂等键是永久的,两层缺一不可。

</details>

## 明天预告

Day 392 · 超时:每一层都要有,而且要比上一层短。今天的小项目里,通知客户那一步是「立刻失败」的,现实中更常见的是「一直不回」:订单系统卡住 30 秒,模型 API 卡住 10 分钟。重试、幂等都建立在「你知道它失败了」的前提上,而超时就是让你知道它失败了的那个机制。明天给模型请求、工具调用、一轮对话、一个任务各设一个超时,并且用实验证明顺序为什么要内短外长。
