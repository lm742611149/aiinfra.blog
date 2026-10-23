---
title: 'Day 128 · 限速、并发和选厂商'
description: '重试是出事之后的补救,今天学怎么尽量不出事。先分清每分钟请求数、每分钟 token 数、同时在途数三种上限,再用本机假服务器实测「12 个请求一起冲只有 4 个能过」,用 asyncio.Semaphore 把并发压在上限以内,把它和昨天的重试接起来;最后拿真 DeepSeek 和硅基流动各跑 5 个并发问答,比较速度和花费,讲清楚选厂商看哪几项。'
pubDate: 2026-10-23
regime: none
tags: ['api', 'rate-limit', 'asyncio', 'python', 'agent-zero']
series: 'agent-zero'
day: 128
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 127](/blog/agent-zero/day-127-retry-backoff/) 写了 `call_with_retry`:只重试 `classify` 判为可重试的错,等待时间指数翻倍再加随机抖动,服务器给了 `Retry-After` 就听服务器的。还实测了两个坑:SDK 自带的重试和自己写的重试叠在一起,一次失败会变成 9 个请求;一百个客户端同时重试,没有抖动就是一轮一轮的齐射。

重试是「出事之后」的补救。今天换一个角度:能不能让事情尽量别出。429 的意思是「你太快了」,既然是你发得太快,那就是发送这一侧可以控制的。今天学怎么控制发送的节奏,以及在同一件事有好几家厂商可以选的时候,该看哪几项。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说清楚 RPM、TPM、并发三种上限各限制什么,以及 DeepSeek、硅基流动、OpenAI 各自用的是哪一种,并且知道在哪一页查。
2. 用 `asyncio.gather` 同时发 5 个请求,量出和一个接一个发差多少(本机假服务器和真 API 各量一次)。
3. 用 `asyncio.Semaphore` 把同时在途的请求数压在上限以内,实测「不限制」「只靠重试」「限制加重试」三种做法分别让服务器收到多少个请求。
4. 看着自己的需求(多少条任务、每条多慢、花多少钱)和几个维度,说出选哪家厂商的理由,而不是「听说这个好」。

今天的两个新概念:**三种限速口径**(每分钟请求数、每分钟 token 数、同时在途数)和**用信号量控制并发**(`asyncio.Semaphore`)。选厂商是一节讨论加一次实测,不算新概念。

预计用时:2.5 小时左右。实跑花费:本机假服务器上的实验不花钱,真 API 的几次实验一共不到 0.05 元,算式在对应的小节里。前置:[Day 127](/blog/agent-zero/day-127-retry-backoff/) 的 `retry.py`、`fake_llm.py`,[Day 126](/blog/agent-zero/day-126-error-codes/) 的 `classify.py`,[Day 124](/blog/agent-zero/day-124-cost/) 的 `common/cost.py` 和 `LLM_PRICE`,[Day 123](/blog/agent-zero/day-123-openai-compatible/) 的 `.env` / `.env.sf` 两个配置文件,[Day 66](/blog/agent-zero/day-066-async-1/) 到 [Day 68](/blog/agent-zero/day-068-async-3/) 的 `async` / `await` / `asyncio.gather`。

学法提示:先对照文章把每个脚本逐行敲一遍(不要复制粘贴)并跑通;明天合上文章,默写 `acall_with_retry` 和「用 Semaphore 包住一次调用」的写法;然后做动手练习,做不出来再展开参考答案,看完关掉,自己重写一遍。

## 三种上限:每分钟请求数、每分钟 token 数、同时在途数

「限速」这个词在不同厂商那里指的不是同一件事。先把三种常见的口径分开说。

**RPM(requests per minute)**:每分钟最多接收多少个请求。不管每个请求大还是小,一个就算一个。限制的是「敲门的次数」。

**TPM(tokens per minute)**:每分钟最多处理多少个 token。一个塞了 3 万字资料的请求和一个只问「你好」的请求,占的额度差几百倍。限制的是「搬运的货量」。

**并发(concurrency)**:同一时刻最多有多少个请求在「路上」,也就是已经发出、还没收到完整响应。限制的是「同时在场的人数」。

三种上限是三个独立的闸门,任何一个先到,就返回 429。打个比方:一家小餐馆限制「每小时最多接 20 桌」(RPM),「每小时最多出 400 份菜」(TPM),「店里同时最多坐 8 桌」(并发)。你带 8 个人来一起点菜没问题,但你们 8 个人每人又叫了一桌满汉全席,TPM 就先爆了。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="三种限速口径的示意图:RPM 数一分钟内敲门的次数,TPM 数一分钟内搬运的 token 总量,并发数同一时刻还没收到响应的请求个数">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink)">RPM:数一分钟内的请求个数</text>
<rect x="20" y="36" width="12" height="12" fill="var(--mem)"/><rect x="38" y="36" width="12" height="12" fill="var(--mem)"/><rect x="56" y="36" width="12" height="12" fill="var(--mem)"/><rect x="74" y="36" width="12" height="12" fill="var(--mem)"/><rect x="92" y="36" width="12" height="12" fill="var(--mem)"/>
<text x="120" y="47" fill="var(--ink-soft)">5 个小请求 = 5 次</text>
<text x="20" y="76" fill="var(--ink)">TPM:数一分钟内的 token 总量</text>
<rect x="20" y="86" width="12" height="12" fill="var(--compute)"/><rect x="38" y="86" width="180" height="12" fill="var(--compute)"/><rect x="224" y="86" width="40" height="12" fill="var(--compute)"/>
<text x="280" y="97" fill="var(--ink-soft)">3 个请求,大小差 15 倍</text>
<text x="20" y="126" fill="var(--ink)">并发:数同一时刻还在路上的请求</text>
<line x1="20" y1="168" x2="610" y2="168" stroke="var(--rule)"/>
<rect x="30" y="140" width="200" height="10" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="80" y="152" width="260" height="10" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="150" y="140" width="190" height="10" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="260" y="152" width="180" height="10" fill="var(--mem-wash)" stroke="var(--mem)"/>
<line x1="160" y1="132" x2="160" y2="170" stroke="var(--compute)" stroke-dasharray="3 3"/>
<text x="168" y="186" fill="var(--ink-soft)">这一刻在途 4 个(时间轴向右,每条横条是一个请求从发出到收完)</text>
<text x="20" y="214" fill="var(--ink-faint)">三个闸门各管各的,哪个先到上限就先 429</text>
</g>
</svg>
<figcaption>三种口径数的东西不一样:RPM 数请求的个数,TPM 数 token 的总量,并发数「同一时刻有几个请求还没完」。同样 5 个请求,可能一秒发完(RPM 看见 5 个),也可能各自跑 20 秒(并发看见 5 个)。</figcaption>
</figure>

2026 年 10 月我查了三家的官方页面,它们用的口径各不一样:

| 厂商 | 用什么限速 | 具体数字 | 查哪一页 |
| --- | --- | --- | --- |
| DeepSeek | 只有并发 | `deepseek-flash` 2500,`deepseek-v4-pro` 500,按账号算,和有几个 key 无关;超了回 429 | [限速页](https://api-docs.deepseek.com/zh-cn/quick_start/rate_limit) |
| 硅基流动 | RPM、RPH、RPD、TPM、TPD 等七个指标,任一先到就 429 | 按上个月和本月的消费分 L0 到 L5(L0 是消费不到 50 元的新用户);文档给的聊天模型范围是 RPM 1000 到 10000,TPM 5 万到 500 万,具体模型的数要去模型广场看 | [限速与升级](https://api-docs.siliconflow.cn/docs/userguide/faqs/rate-limit-and-upgradation) |
| OpenAI | RPM、RPD、TPM、TPD、IPM(每分钟图片数),按账号累计充值分 Free、Build、Launch、Grow 档 | 每个模型不同,控制台里能看到你的数字 | [Rate limits](https://developers.openai.com/api/docs/guides/rate-limits) |

OpenAI 的页面里有一条很实用:限速是按 `max_tokens` 和「根据请求字符数估出来的 token 数」二者中较大的那个算的。你随手写了 `max_tokens=4000` 而实际回答只有 100 个 token,额度也是按 4000 扣的。所以限速页建议 `max_tokens` 设成接近你预期的回答长度。

还有一条是关于「怎么知道自己离上限多远」。OpenAI 的每个响应都带 `x-ratelimit-remaining-requests`、`x-ratelimit-remaining-tokens` 这样的头,告诉你这一分钟还剩多少。DeepSeek 和硅基流动呢?我写了个小脚本,把响应头的名字都列出来看看。新建 `part02/show_headers.py`:

```python
```python
# agent-zero-lab/part02/show_headers.py
import json
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv(os.environ.get("ENV_FILE", ".env"), override=True)
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"], max_retries=0)
raw = client.chat.completions.with_raw_response.create(
    model=os.environ["LLM_MODEL"],
    messages=[{"role": "user", "content": "hi"}],
    max_tokens=5,
    extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY", "{}")),
)
names = sorted(raw.headers.keys())
limit_names = [n for n in names if "ratelimit" in n or "retry" in n]
print(f"{os.environ['LLM_BASE_URL']}")
print(f"  收到 {len(names)} 个响应头: {', '.join(names)}")
print(f"  名字里带 ratelimit 或 retry 的: {limit_names}")
```
```

<div class="line-notes">

- `from dotenv import load_dotenv` 昨天和前天一直在用的,把 `.env` 文件里的变量读进环境变量。
- `load_dotenv(os.environ.get("ENV_FILE", ".env"), override=True)` 读哪个配置文件由环境变量 `ENV_FILE` 决定,不给就读 `.env`(DeepSeek)。`override=True` 让文件里的值盖过系统里已经有的同名变量,Day 123 讲过为什么要这样。
- `client = OpenAI(..., max_retries=0)` 不要 SDK 偷偷重试,我们要看第一次请求的原样响应。
- `raw = client.chat.completions.with_raw_response.create(` `with_raw_response` 是 SDK 提供的一种调用方式:不把响应解析成对象,而是连同 HTTP 头一起交给你。平时的 `.create()` 把头丢掉了,所以要看头必须这样写。
- `max_tokens=5,` 只要看头,回答越短越省钱。
- `names = sorted(raw.headers.keys())` 把所有响应头的名字排好序。对 DeepSeek 得到 13 个名字,对硅基流动得到 5 个。
- `limit_names = [n for n in names if "ratelimit" in n or "retry" in n]` 列表推导式,是 [Day 23](/blog/agent-zero/day-023-comprehensions/) 学的:挑出名字里带 `ratelimit` 或 `retry` 的。HTTP 头的名字 SDK 已经统一成小写。
- `print(f"  收到 {len(names)} 个响应头: {', '.join(names)}")` 把 13 个名字用逗号连起来打印。

</div>

```bash
cd ~/agent-zero-lab
ENV_FILE=.env uv run python -m part02.show_headers
ENV_FILE=.env.sf uv run python -m part02.show_headers
```

```text
https://api.deepseek.com
  收到 13 个响应头: access-control-allow-credentials, connection, content-encoding, content-type, date, eo-cache-status, eo-log-uuid, server, strict-transport-security, transfer-encoding, vary, x-content-type-options, x-ds-trace-id
  名字里带 ratelimit 或 retry 的: []
https://api.siliconflow.cn/v1
  收到 5 个响应头: connection, content-length, content-type, date, x-siliconcloud-trace-id
  名字里带 ratelimit 或 retry 的: []
```

两家都没有 `x-ratelimit` 这类头,一个都没有。意思是:你没法在响应里读出「这一分钟还剩多少」,只能自己数,或者撞到 429 再处理。这是今天要自己做并发控制最实际的理由。DeepSeek 的响应里有一个 `x-ds-trace-id`,出问题联系客服时把它贴上,和 Day 126 讲的 `request_id` 是一个用途。

## 先看一个接一个和一起发差多少

今天的实验要用到 `AsyncOpenAI`。它是 `OpenAI` 的异步版本,同样的参数,只是 `create` 前面要加 `await`。[Day 67](/blog/agent-zero/day-067-async-2/) 学过:`async def` 定义的函数叫协程,调用它不会立刻执行,要 `await` 它或者交给 `asyncio.run`、`asyncio.gather`。[Day 68](/blog/agent-zero/day-068-async-3/) 学过 `asyncio.gather(*协程列表)`:把一批协程同时放出去,等全部完成,按原来的顺序给你结果,相当于 JS 的 `Promise.all`。

先在本机假服务器上量。昨天的 `fake_llm.py` 有一个 `sleep-N` 模式:收到后睡 N 秒再回答,模拟一个很慢的模型。我要它再多记一样东西:同一时刻最多有几个请求在服务器里。这个数字今天会反复用到,所以先改 `fake_llm.py`。同时再加两个新模式:`cap:N:S`(同时最多处理 N 个,多的直接 429,每个请求处理 S 秒)和 `rate:N:W`(每 W 秒的窗口里最多 N 个,多的 429)。打开 `part02/fake_llm.py`,改成下面这样,昨天那些没动的行,line-notes 还是昨天的意思,这里只讲新增的:

```python
```python
# agent-zero-lab/part02/fake_llm.py
import json
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import cast

OK_BODY = {
    "id": "fake-1",
    "object": "chat.completion",
    "created": 1_790_000_000,
    "model": "fake-model",
    "choices": [{"index": 0, "message": {"role": "assistant", "content": "假服务器说:你好"},
                 "finish_reason": "stop"}],
    "usage": {"prompt_tokens": 5, "completion_tokens": 8, "total_tokens": 13},
}


def error_body(status: str) -> str:
    err = {"error": {"message": f"假的 {status} 错误", "type": "fake_error", "param": None, "code": "fake"}}
    return json.dumps(err)


class FakeServer(ThreadingHTTPServer):
    requests_seen: list[str]
    arrivals: list[float]
    counts: dict[str, int]
    started: float
    lock: threading.Lock
    inflight: int
    peak: int


class Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        server = cast(FakeServer, self.server)
        length = int(self.headers.get("Content-Length", 0))
        model = json.loads(self.rfile.read(length)).get("model", "")
        now = time.monotonic() - server.started
        with server.lock:
            server.requests_seen.append(model)
            server.arrivals.append(now)
            server.inflight += 1
            server.peak = max(server.peak, server.inflight)
            inflight = server.inflight
        try:
            self.route(server, model, now, inflight)
        finally:
            with server.lock:
                server.inflight -= 1

    def route(self, server: FakeServer, model: str, now: float, inflight: int) -> None:
        ok = json.dumps(OK_BODY)
        kind, _, arg = model.partition("-")
        if model.startswith("flaky:"):
            _, status, fails, *rest = model.split(":")
            seen = server.counts.get(model, 0)
            server.counts[model] = seen + 1
            if seen < int(fails):
                headers = {"Retry-After": rest[0]} if rest else {}
                self.reply(int(status), error_body(status), "application/json", headers)
            else:
                self.reply(200, ok, "application/json")
        elif model.startswith("cap:"):
            _, limit, secs = model.split(":")
            if inflight > int(limit):
                self.reply(429, error_body("429"), "application/json")
            else:
                time.sleep(float(secs))
                self.reply(200, ok, "application/json")
        elif model.startswith("rate:"):
            _, limit, window = model.split(":")
            slot = int(now // float(window))
            key = f"{model}@{slot}"
            with server.lock:
                used = server.counts.get(key, 0)
                server.counts[key] = used + 1
            if used >= int(limit):
                self.reply(429, error_body("429"), "application/json")
            else:
                self.reply(200, ok, "application/json")
        elif kind == "down":
            if now < float(arg):
                self.reply(503, error_body("503"), "application/json")
            else:
                self.reply(200, ok, "application/json")
        elif kind == "sleep":
            time.sleep(float(arg))
            self.reply(200, ok, "application/json")
        elif kind == "status":
            self.reply(int(arg), error_body(arg), "application/json")
        elif kind == "quota":
            err = {"error": {"message": "额度用完了", "type": "insufficient_quota", "param": None,
                             "code": "insufficient_quota"}}
            self.reply(429, json.dumps(err), "application/json")
        elif kind == "html":
            self.reply(int(arg), "<html><body>502 Bad Gateway</body></html>", "text/html")
        else:
            self.reply(200, ok, "application/json")

    def reply(self, status: int, body: str, content_type: str, headers: dict[str, str] | None = None) -> None:
        data = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format: str, *args: object) -> None:
        pass


@contextmanager
def fake_server() -> Iterator[tuple[str, FakeServer]]:
    server = FakeServer(("127.0.0.1", 0), Handler)
    server.requests_seen = []
    server.arrivals = []
    server.counts = {}
    server.started = time.monotonic()
    server.lock = threading.Lock()
    server.inflight = 0
    server.peak = 0
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}", server
    finally:
        server.shutdown()
        server.server_close()
```
```

<div class="line-notes">

- `lock: threading.Lock` 新属性:一把锁。`ThreadingHTTPServer` 每收到一个请求就开一个线程处理,好几个线程会同时改 `inflight` 和 `peak`,不加锁的话两个线程同时读到 3、同时写回 4,就少数了一个。锁的意思是:拿到锁的线程做完事再放掉,别的线程排队。
- `inflight: int` 新属性:此刻服务器里有几个请求正在处理。in flight 直译是「在飞行中」,指「发出了还没完成」。
- `peak: int` 新属性:`inflight` 出现过的最大值。实验结束后看这个数,就知道客户端到底有没有把并发压住。
- `with server.lock:` 拿锁。`with` 块结束自动放锁,和 [Day 38](/blog/agent-zero/day-038-files-with/) 的 `with open(...)` 是同一个机制。
- `server.inflight += 1` 来了一个请求,在途数加一。`+=` 是「读出来,加一,写回去」三步,所以才需要锁。
- `server.peak = max(server.peak, server.inflight)` 刷新历史最大值。比如在途数依次是 1、2、3、2,`peak` 就是 3。
- `inflight = server.inflight` 在锁里把此刻的在途数抄一份存成局部变量。之后 `cap:` 模式用的是这份抄本,不会被别的线程改变。
- `self.route(server, model, now, inflight)` 昨天 `do_POST` 里那一长串 `if / elif` 现在挪到了 `route` 方法里,这里调用它。拆开是因为要用 `try / finally` 包住:不管 `route` 里走哪条路、有没有出错,在途数都必须减回去。
- `finally:` 无论 `try` 里发生了什么都会执行的块。
- `server.inflight -= 1` 处理完了(无论成功、429 还是出错),在途数减一。
- `def route(self, server: FakeServer, model: str, now: float, inflight: int) -> None:` 昨天的分发逻辑原样搬过来,多收两个参数。
- `elif model.startswith("cap:"):` 新模式。模型名 `cap:4:0.5` 的意思是「同时最多处理 4 个,每个处理 0.5 秒」。
- `_, limit, secs = model.split(":")` `"cap:4:0.5".split(":")` 得到 `["cap", "4", "0.5"]`,`limit` 是 `"4"`,`secs` 是 `"0.5"`。
- `if inflight > int(limit):` 刚才抄下来的在途数(包含这个请求自己)超过 4,说明这是第 5 个、第 6 个……直接 429,不用睡觉。前 4 个到的请求,看到的在途数是 1、2、3、4,都不超过 4,放行。
- `time.sleep(float(secs))` 放行的请求睡 0.5 秒,假装在推理。睡着期间它一直占着一个名额。
- `elif model.startswith("rate:"):` 新模式。`rate:5:1` 的意思是「每 1 秒的窗口里最多 5 个」。窗口按服务器启动时刻对齐:第 0 到 1 秒是第 0 个窗口,第 1 到 2 秒是第 1 个窗口。
- `slot = int(now // float(window))` `//` 是整除,`now` 是 2.3 秒、窗口 1 秒时,`2.3 // 1.0` 是 `2.0`,取整得 2,这个请求落在第 2 个窗口。
- `key = f"{model}@{slot}"` 给「这个模型名的第几个窗口」起个名字当计数器的键,比如 `rate:5:1@2`。借用昨天的 `counts` 字典存计数。
- `used = server.counts.get(key, 0)` 这个窗口里之前已经放行了几个。
- `if used >= int(limit):` 已经放行了 5 个,这是第 6 个,429。
- `server.lock = threading.Lock()` 启动服务器时创建锁。
- `server.inflight = 0` 刚启动,没有请求在处理。
- `server.peak = 0` 历史最大值从 0 开始。

</div>

跑一下昨天的测试,确认没改坏:

```bash
uv run pytest -q
```

```text
................................                                         [100%]
32 passed in 4.92s
```

现在写第一个实验。`five_fake.py` 对 `sleep-1`(每个请求让服务器睡 1 秒)发 5 个请求,先一个接一个,再用 `asyncio.gather` 一起发:

```python
```python
# agent-zero-lab/part02/five_fake.py
import asyncio
import time

from openai import AsyncOpenAI, OpenAI
from openai.types.chat import ChatCompletionMessageParam

from part02.fake_llm import fake_server

MESSAGES: list[ChatCompletionMessageParam] = [{"role": "user", "content": "hi"}]

with fake_server() as (url, server):
    sync_client = OpenAI(base_url=url, api_key="sk-fake", max_retries=0)
    start = time.monotonic()
    for _ in range(5):
        sync_client.chat.completions.create(model="sleep-1", messages=MESSAGES)
    print(f"一个接一个: {time.monotonic() - start:.2f} 秒, 服务器同时最多 {server.peak} 个在途")

with fake_server() as (url, server):
    async_client = AsyncOpenAI(base_url=url, api_key="sk-fake", max_retries=0)

    async def main() -> None:
        start = time.monotonic()
        await asyncio.gather(*[
            async_client.chat.completions.create(model="sleep-1", messages=MESSAGES)
            for _ in range(5)
        ])
        print(f"5 个一起发: {time.monotonic() - start:.2f} 秒, 服务器同时最多 {server.peak} 个在途")

    asyncio.run(main())
```
```

<div class="line-notes">

- `import asyncio` 事件循环和 `gather` 都在这个模块里。
- `from openai import AsyncOpenAI, OpenAI` 同时用同步和异步两种客户端。
- `from openai.types.chat import ChatCompletionMessageParam` 一个类型名,只用来给下面的 `MESSAGES` 标类型。SDK 的类型检查器要求 `messages` 是它认识的消息类型,直接写 `[{"role": "user", ...}]` 赋给变量会被推断成 `list[dict[str, str]]` 而报红线。
- `MESSAGES: list[ChatCompletionMessageParam] = [{"role": "user", "content": "hi"}]` 5 个请求共用的消息。
- `sync_client = OpenAI(base_url=url, api_key="sk-fake", max_retries=0)` 同步客户端。`url` 是假服务器的地址,`api_key` 随便写,假服务器不检查。
- `for _ in range(5):` 循环 5 次,`_` 表示不关心循环变量。
- `sync_client.chat.completions.create(model="sleep-1", messages=MESSAGES)` 同步调用:发出,等 1 秒收到响应,才会进入下一圈。5 圈就是 5 秒。
- `print(f"一个接一个: ...` 先量时间再看服务器同时最多有几个在途,这一轮是 1 个。
- `async_client = AsyncOpenAI(...)` 异步客户端,换一个服务器实例,`peak` 从 0 重新数。
- `async def main() -> None:` 把实验写成一个协程,因为 `await` 只能写在 `async def` 里。
- `await asyncio.gather(*[` 列表推导式造出 5 个协程对象(这时候还没发请求),`*` 把列表拆开传给 `gather`,和 JS 的展开语法 `...` 一个意思。`gather` 把 5 个协程同时放进事件循环,每个都在 `await` 处让出控制权,所以 5 个请求几乎同时发出。
- `async_client.chat.completions.create(model="sleep-1", messages=MESSAGES)` 异步版的 `create`,返回一个协程。
- `asyncio.run(main())` 启动事件循环,运行 `main` 直到完成。

</div>

```bash
uv run python -m part02.five_fake
```

```text
一个接一个: 5.14 秒, 服务器同时最多 1 个在途
5 个一起发: 1.05 秒, 服务器同时最多 5 个在途
```

5.14 秒对 1.05 秒,服务器同时最多在途的数量是 1 个对 5 个。5 个请求各睡 1 秒,一个接一个就是 5 秒;一起发,总时间约等于最慢那一个(1 秒),多出来的 0.05 是建立连接的零头。真正的模型 API 也是这样:模型在远端推理,你的程序大部分时间只是在等网络,并发等于同时等 5 个。

## 冲撞上限会怎样

并发不是越大越好。把服务器换成 `cap:4:0.5`:同时最多处理 4 个,每个 0.5 秒,第 5 个起直接 429。再同时发 12 个:

```python
```python
# agent-zero-lab/part02/cap_burst.py
import asyncio
import time
from collections import Counter

import openai
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam

from part02.fake_llm import fake_server

MODEL = "cap:4:0.5"
N = 12
MESSAGES: list[ChatCompletionMessageParam] = [{"role": "user", "content": "hi"}]

with fake_server() as (url, server):
    client = AsyncOpenAI(base_url=url, api_key="sk-fake", max_retries=0)

    async def one() -> str:
        try:
            await client.chat.completions.create(model=MODEL, messages=MESSAGES)
            return "成功"
        except openai.RateLimitError:
            return "429"

    async def main() -> None:
        start = time.monotonic()
        results = await asyncio.gather(*[one() for _ in range(N)])
        print(f"同时发 {N} 个, 服务器只允许 4 个同时在途: {dict(Counter(results))}, 用了 {time.monotonic() - start:.2f} 秒")

    asyncio.run(main())
```
```

<div class="line-notes">

- `from collections import Counter` 数数用的字典,`Counter(["成功", "429", "429"])` 得到 `{"成功": 1, "429": 2}`。
- `MODEL = "cap:4:0.5"` 假服务器的模式,上限 4,每个 0.5 秒。
- `N = 12` 一次发 12 个。
- `async def one() -> str:` 一个请求的完整过程,返回「成功」或「429」。
- `except openai.RateLimitError:` 429 在 SDK 里是 `RateLimitError`,Day 126 讲过。别的错不接,让它炸出来,今天的实验里不会有别的错。
- `results = await asyncio.gather(*[one() for _ in range(N)])` 12 个 `one()` 同时放出去,`results` 是 12 个字符串。
- `print(f"同时发 {N} 个, ...` `dict(Counter(results))` 把计数结果变成普通字典打印。

</div>

```bash
uv run python -m part02.cap_burst
```

```text
同时发 12 个, 服务器只允许 4 个同时在途: {'成功': 4, '429': 8}, 用了 0.73 秒
```

12 个里只有 4 个成功,8 个被拒。这就是撞上并发上限的样子:前 4 个先到的占满了名额,后面的全是 429,而且是一瞬间的事。

你会想:SDK 不是会自动重试吗?默认 `max_retries=2`,让它重试不就行了。试一下。`cap_retry_only.py` 不关 SDK 的重试,也不加任何限制,对两种服务器各冲 12 个:一种处理得快(0.5 秒),一种处理得慢(3 秒):

```python
```python
# agent-zero-lab/part02/cap_retry_only.py
import asyncio
import time
from collections import Counter

import openai
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam

from part02.fake_llm import fake_server

N = 12
MESSAGES: list[ChatCompletionMessageParam] = [{"role": "user", "content": "hi"}]

for model in ("cap:4:0.5", "cap:4:3"):
    with fake_server() as (url, server):
        client = AsyncOpenAI(base_url=url, api_key="sk-fake")

        async def one() -> str:
            try:
                await client.chat.completions.create(model=model, messages=MESSAGES)
                return "成功"
            except openai.RateLimitError:
                return "放弃(429)"

        async def main() -> None:
            start = time.monotonic()
            results = await asyncio.gather(*[one() for _ in range(N)])
            print(f"{model}: {dict(Counter(results))}, 服务器共收到 {len(server.requests_seen)} 个请求, 用了 {time.monotonic() - start:.2f} 秒")

        asyncio.run(main())
```
```

<div class="line-notes">

- `for model in ("cap:4:0.5", "cap:4:3"):` 两种服务器:每个请求占名额 0.5 秒的和占 3 秒的,上限都是 4。
- `client = AsyncOpenAI(base_url=url, api_key="sk-fake")` 这次没写 `max_retries`,SDK 用默认值 2:最多重试 2 次,总共 3 次尝试。
- `return "放弃(429)"` 重试 2 次之后仍然 429,SDK 就把错抛出来,被这里接住。
- `len(server.requests_seen)` 服务器一共收到过多少个请求,包括重试的。这是看「放大」的关键数字。

</div>

```bash
uv run python -m part02.cap_retry_only
```

```text
cap:4:0.5: {'成功': 9, '放弃(429)': 3}, 服务器共收到 27 个请求, 用了 2.09 秒
cap:4:3: {'成功': 4, '放弃(429)': 8}, 服务器共收到 28 个请求, 用了 3.04 秒
```

注意第二行:12 个任务,服务器收到 28 个请求,最后只有 4 个成功,8 个放弃。第一行快服务器稍好,9 个成功,但也收到 27 个请求(每次跑的数字略有不同,方向不变)。原因是 SDK 的两次重试只等 0.5 秒和 1 秒左右(Day 127 读过源码),而慢服务器的名额要 3 秒才释放,重试来的时候名额还占着,于是再次 429。每个任务都被「拒绝 → 等一会儿 → 再被拒绝」折腾了三遍,服务器却白白多处理了 16 个注定失败的请求,这些请求在真 API 上还会占你的 RPM 额度。

结论是:重试只管「撞上了怎么办」,它不能让撞上的概率变小。要让概率变小,得在发出去之前就控制「同时在途的数量」。

## 用 Semaphore 把并发压住

先说它是什么。Semaphore 中文叫**信号量**,你可以把它想成一个停车场,里面有固定数量的车位。想停车的(也就是想发请求的任务)到门口:有空车位就进去,没有就在门口排队,等里面有人出来再进。`asyncio.Semaphore(4)` 就是一个只有 4 个车位的停车场。

JS 里没有内置的对应物,但 npm 上的 `p-limit` 做的就是同一件事:`const limit = pLimit(4); limit(() => fetch(...))`。

用法只有一种写法,用 `async with`:

```python
sem = asyncio.Semaphore(4)

async def one():
    async with sem:        # 进停车场(没空位就在这里排队)
        await 发请求()      # 占着车位
                           # 离开 with 块,车位自动还回去
```

`async with` 和 [Day 38](/blog/agent-zero/day-038-files-with/) 学的 `with` 一样,离开块时自动收尾(哪怕里面抛了错也会还车位)。不同的是 `async with` 里「进场」这一步可能要等,所以前面加了 `async`。

把 `cap_burst.py` 改一处,每个请求先拿车位。新建 `part02/cap_limited.py`:

```python
```python
# agent-zero-lab/part02/cap_limited.py
import asyncio
import time
from collections import Counter

import openai
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam

from part02.fake_llm import fake_server

MODEL = "cap:4:0.5"
N = 12
MESSAGES: list[ChatCompletionMessageParam] = [{"role": "user", "content": "hi"}]

with fake_server() as (url, server):
    client = AsyncOpenAI(base_url=url, api_key="sk-fake", max_retries=0)

    async def one(sem: asyncio.Semaphore) -> str:
        async with sem:
            try:
                await client.chat.completions.create(model=MODEL, messages=MESSAGES)
                return "成功"
            except openai.RateLimitError:
                return "429"

    async def main() -> None:
        sem = asyncio.Semaphore(4)
        start = time.monotonic()
        results = await asyncio.gather(*[one(sem) for _ in range(N)])
        print(f"Semaphore(4): {dict(Counter(results))}, 用了 {time.monotonic() - start:.2f} 秒, 服务器同时最多 {server.peak} 个在途")

    asyncio.run(main())
```
```

<div class="line-notes">

- `async def one(sem: asyncio.Semaphore) -> str:` 把信号量作为参数传进来,12 个任务共用同一个。
- `async with sem:` 拿一个车位。前 4 个任务立刻拿到,另外 8 个停在这一行排队。注意是排队不是失败,任务不会报错,只是晚一点开始。
- `await client.chat.completions.create(model=MODEL, messages=MESSAGES)` 在车位里发请求,最多 4 个同时在这一行。
- `sem = asyncio.Semaphore(4)` 在 `main` 里创建,4 个车位,和服务器的上限一样。
- `await asyncio.gather(*[one(sem) for _ in range(N)])` 还是 12 个任务一起放出去,但真正在发请求的任何时刻都不超过 4 个。
- `server.peak` 服务器看到的同时在途最大值,这次应该是 4。

</div>

```bash
uv run python -m part02.cap_limited
```

```text
Semaphore(4): {'成功': 12}, 用了 1.70 秒, 服务器同时最多 4 个在途
```

12 个全部成功,0 个 429,服务器同时最多 4 个在途。耗时 1.70 秒:12 个任务分 3 批(4 + 4 + 4),每批 0.5 秒,共 1.5 秒,再加上建立连接的零头。

对比 `cap_burst.py` 的 0.73 秒:冲撞更快,但 8 个失败了,等于任务没做完。限并发更慢,但全做完了。「慢一点,但全部成功」几乎永远比「快,但丢一半」好,尤其是任务是评测、批量处理这种不能丢的活。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="Semaphore(4) 的示意:12 个任务在门口排队,4 个车位里是正在请求的任务,请求完成后车位还给排队的下一个">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink-soft)">排队的任务(8 个在等)</text>
<g fill="var(--ink-faint)">
<rect x="20" y="40" width="26" height="22" rx="3"/><rect x="52" y="40" width="26" height="22" rx="3"/><rect x="84" y="40" width="26" height="22" rx="3"/><rect x="116" y="40" width="26" height="22" rx="3"/>
<rect x="20" y="68" width="26" height="22" rx="3"/><rect x="52" y="68" width="26" height="22" rx="3"/><rect x="84" y="68" width="26" height="22" rx="3"/><rect x="116" y="68" width="26" height="22" rx="3"/>
</g>
<line x1="170" y1="40" x2="250" y2="100" stroke="var(--rule)"/>
<text x="176" y="34" fill="var(--ink-soft)">async with sem:</text>
<rect x="260" y="40" width="360" height="110" fill="var(--mem-wash)" stroke="var(--mem)" rx="6"/>
<text x="272" y="60" fill="var(--ink)">Semaphore(4):4 个车位</text>
<g fill="var(--mem)">
<rect x="276" y="76" width="68" height="50" rx="4"/><rect x="354" y="76" width="68" height="50" rx="4"/><rect x="432" y="76" width="68" height="50" rx="4"/><rect x="510" y="76" width="68" height="50" rx="4"/>
</g>
<g fill="var(--paper-raised)" text-anchor="middle">
<text x="310" y="106">请求中</text><text x="388" y="106">请求中</text><text x="466" y="106">请求中</text><text x="544" y="106">请求中</text>
</g>
<line x1="620" y1="150" x2="620" y2="200" stroke="var(--compute)"/>
<line x1="620" y1="200" x2="170" y2="200" stroke="var(--compute)" stroke-dasharray="3 3"/>
<text x="260" y="192" fill="var(--compute)">请求完成,离开 with 块,车位还回去</text>
<text x="20" y="232" fill="var(--ink-faint)">任何时刻发给服务器的请求都不超过 4 个;多出来的只是晚一点开始</text>
</g>
</svg>
<figcaption>12 个任务同时被 gather 放出去,但只有拿到车位的 4 个在发请求,另外 8 个停在 async with 那一行,等有人出来再进。车位数就是你允许的最大并发。</figcaption>
</figure>

## 限并发加重试:两层各管一件事

限并发是「预防」,重试是「补救」,两层都要有,各管各的。限并发把平时的撞车概率压下去,重试兜住剩下偶尔的 429 和厂商抖动。

昨天写的 `call_with_retry` 是同步的,里面用 `time.sleep` 等待。在 `async` 的世界里不能用它:`time.sleep` 会把整个事件循环卡住,所有任务一起停。要写一个异步版本,把 `sleep` 换成 `await asyncio.sleep`,其余照搬。好在判断逻辑(`classify`、`server_hint`、`backoff_delay`)都是纯函数,可以直接 import 昨天的,不用复制。新建 `part02/aretry.py`:

```python
```python
# agent-zero-lab/part02/aretry.py
import asyncio
import random
from collections.abc import Awaitable, Callable
from typing import TypeVar

import openai

from part02.classify import classify
from part02.retry import RetryPolicy, backoff_delay, server_hint

T = TypeVar("T")


async def acall_with_retry(
    fn: Callable[[], Awaitable[T]],
    policy: RetryPolicy = RetryPolicy(),
    *,
    rng: random.Random | None = None,
) -> T:
    rng = rng or random.Random()
    for attempt in range(1, policy.max_attempts + 1):
        try:
            return await fn()
        except openai.OpenAIError as e:
            verdict = classify(e)
            if not verdict.retry or attempt == policy.max_attempts:
                raise
            hint = server_hint(e)
            if hint is not None and hint > policy.max_wait:
                raise
            delay = hint if hint is not None else backoff_delay(attempt - 1, policy, rng)
            await asyncio.sleep(delay)
    raise AssertionError("到不了这里:__post_init__ 保证了至少试一次")
```
```

<div class="line-notes">

- `from collections.abc import Awaitable, Callable` `Awaitable[T]` 是「可以被 `await` 的东西,await 之后得到 T」。协程对象就是 Awaitable。
- `from part02.retry import RetryPolicy, backoff_delay, server_hint` 昨天写的三样东西:策略配置、算等待时间的纯函数、读 `Retry-After` 的函数。它们都不睡觉不发请求,所以同步异步都能用。
- `fn: Callable[[], Awaitable[T]],` 被重试的是「不带参数、调用后得到一个可 await 的东西」的函数。写成 `lambda: client.chat.completions.create(...)`:lambda 被调用时返回一个协程对象,`await` 它才真正发请求。每次重试都要调用 `fn()` 拿一个新的协程,因为协程只能 await 一次。
- `async def acall_with_retry(` 开头的 `a` 表示 async。定义成 `async def`,调用它要 `await`。
- `return await fn()` 同步版是 `return fn()`,这里多了 `await`。
- `await asyncio.sleep(delay)` 和同步版唯一实质的差别。`asyncio.sleep` 在等待的这段时间里让出控制权,别的任务可以继续跑;`time.sleep` 则是原地死等,整个事件循环动不了。
- `raise AssertionError(...)` 同昨天,只是让类型检查器放心。

</div>

写个小测试把它钉住。新建 `tests/test_aretry.py`,三个用例:429 重试直到成功、401 一次都不重试(断言服务器只收到 1 个请求)、Semaphore 真的把服务器看到的最大并发压在 3:

```python
```python
# agent-zero-lab/tests/test_aretry.py
import asyncio

import openai
import pytest
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam

from part02.aretry import acall_with_retry
from part02.fake_llm import fake_server
from part02.retry import RetryPolicy

MESSAGES: list[ChatCompletionMessageParam] = [{"role": "user", "content": "hi"}]
FAST = RetryPolicy(max_attempts=4, base=0.01, cap=0.05)


def test_retries_429_until_success() -> None:
    with fake_server() as (url, server):
        client = AsyncOpenAI(base_url=url, api_key="sk-fake", max_retries=0)

        async def go() -> str:
            resp = await acall_with_retry(
                lambda: client.chat.completions.create(model="flaky:429:2", messages=MESSAGES), FAST
            )
            return resp.choices[0].message.content or ""

        assert asyncio.run(go()) == "假服务器说:你好"
        assert len(server.requests_seen) == 3


def test_401_is_not_retried() -> None:
    with fake_server() as (url, server):
        client = AsyncOpenAI(base_url=url, api_key="sk-fake", max_retries=0)

        async def go() -> None:
            await acall_with_retry(lambda: client.chat.completions.create(model="status-401", messages=MESSAGES), FAST)

        with pytest.raises(openai.AuthenticationError):
            asyncio.run(go())
        assert len(server.requests_seen) == 1


def test_semaphore_caps_inflight() -> None:
    with fake_server() as (url, server):
        client = AsyncOpenAI(base_url=url, api_key="sk-fake", max_retries=0)

        async def go() -> None:
            sem = asyncio.Semaphore(3)

            async def one() -> None:
                async with sem:
                    await client.chat.completions.create(model="sleep-0.05", messages=MESSAGES)

            await asyncio.gather(*[one() for _ in range(10)])

        asyncio.run(go())
        assert len(server.requests_seen) == 10
        assert server.peak == 3
```
```

<div class="line-notes">

- `FAST = RetryPolicy(max_attempts=4, base=0.01, cap=0.05)` 测试里用很短的等待(10 毫秒起),真睡一下也不慢。昨天的测试是靠注入假 `sleep` 不睡觉,这里偷个懒,因为 `acall_with_retry` 只有 15 行,而且我们更想验证和真服务器的配合。
- `def test_retries_429_until_success() -> None:` pytest 测试函数,名字以 `test_` 开头。
- `async def go() -> str:` 测试函数本身是同步的(没装 pytest 的异步插件),所以把异步的部分包进一个 `go`,最后用 `asyncio.run(go())` 跑。
- `model="flaky:429:2"` 前 2 次 429,第 3 次成功。
- `assert asyncio.run(go()) == "假服务器说:你好"` 最后拿到了正常的回答。
- `assert len(server.requests_seen) == 3` 服务器一共收到 3 个请求:2 次失败加 1 次成功。昨天讲过,测重试要数请求,不能只看最后的结果。
- `with pytest.raises(openai.AuthenticationError):` 期望里面抛出 401 对应的异常。
- `assert len(server.requests_seen) == 1` 401 不能重试,所以只收到 1 个请求。
- `sem = asyncio.Semaphore(3)` 3 个车位。
- `await asyncio.gather(*[one() for _ in range(10)])` 10 个任务,每个让服务器睡 0.05 秒。
- `assert server.peak == 3` 服务器见过的最大并发刚好是 3:既没有超过,也确实用满了。这个断言是测「限并发真的生效」的关键,`<= 3` 只能说明没超,`== 3` 还能说明没有被谁偷偷限成了 1。

</div>

```bash
uv run pytest tests/test_aretry.py -q
```

```text
...                                                                      [100%]
3 passed in 1.61s
```

现在把两层放在一起实验。`limited_retry.py` 对 `cap:4:0.5`(服务器上限 4)发 20 个任务,每个任务都有重试(最多 5 次尝试,0.2 秒起翻倍,封顶 1 秒),只改 Semaphore 的大小:

```python
```python
# agent-zero-lab/part02/limited_retry.py
import asyncio
import time
from collections import Counter

import openai
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam

from part02.aretry import acall_with_retry
from part02.fake_llm import fake_server
from part02.retry import RetryPolicy

MODEL = "cap:4:0.5"
N = 20
MESSAGES: list[ChatCompletionMessageParam] = [{"role": "user", "content": "hi"}]
POLICY = RetryPolicy(max_attempts=5, base=0.2, cap=1.0)


async def run(limit: int) -> None:
    with fake_server() as (url, server):
        client = AsyncOpenAI(base_url=url, api_key="sk-fake", max_retries=0)
        sem = asyncio.Semaphore(limit)

        async def one() -> str:
            async with sem:
                try:
                    await acall_with_retry(
                        lambda: client.chat.completions.create(model=MODEL, messages=MESSAGES), POLICY
                    )
                    return "成功"
                except openai.OpenAIError:
                    return "失败"

        start = time.monotonic()
        results = await asyncio.gather(*[one() for _ in range(N)])
        took = time.monotonic() - start
        print(f"Semaphore({limit:2d}): {dict(Counter(results))}, 服务器收到 {len(server.requests_seen)} 个请求, {took:.2f} 秒")


for limit in (2, 4, 6, 20):
    asyncio.run(run(limit))
```
```

<div class="line-notes">

- `POLICY = RetryPolicy(max_attempts=5, base=0.2, cap=1.0)` 最多 5 次尝试,比默认的 4 次多一次,等待 0.2、0.4、0.8、1.0 秒(再加完全抖动)。
- `async def run(limit: int) -> None:` 参数是信号量的大小,每个大小单独跑一遍实验。
- `sem = asyncio.Semaphore(limit)` 每次实验建一个新的。
- `async with sem:` 车位把整个「请求加重试」包住:任务在重试等待的时候还占着车位。
- `await acall_with_retry(lambda: client.chat.completions.create(model=MODEL, messages=MESSAGES), POLICY)` 带重试地发一次请求。
- `except openai.OpenAIError:` 重试用光还是失败,算这个任务失败。
- `for limit in (2, 4, 6, 20):` 四种大小:比服务器上限小、等于、略大、远大。
- `asyncio.run(run(limit))` 每个大小开一个新的事件循环,互不影响。

</div>

```bash
uv run python -m part02.limited_retry
```

```text
Semaphore( 2): {'成功': 20}, 服务器收到 20 个请求, 5.25 秒
Semaphore( 4): {'成功': 20}, 服务器收到 20 个请求, 2.64 秒
Semaphore( 6): {'成功': 18, '失败': 2}, 服务器收到 33 个请求, 3.08 秒
Semaphore(20): {'成功': 16, '失败': 4}, 服务器收到 77 个请求, 2.54 秒
```

读这四行:

- **Semaphore(2)**:20 个全成功,服务器恰好收到 20 个请求(一个多余的都没有),但花了 5.25 秒,因为只用了服务器能力的一半。
- **Semaphore(4)**:20 个全成功,20 个请求,2.64 秒。车位数正好等于服务器上限,既没有浪费也没有撞车。
- **Semaphore(6)**:比服务器上限大 2,出现了 33 个请求(13 个是 429 后的重试),还有 2 个任务在 5 次尝试内没成功。
- **Semaphore(20)**:20 个任务全放出去,收到 77 个请求,4 个任务最终失败。

两个数字值得盯:服务器收到的请求数,和失败数。限得合适(2 或 4),请求数等于任务数,失败为 0;限得太松,请求数涨到任务数的 3 到 4 倍,这些多出来的请求全是「注定被拒、被拒后再来」,在按请求数限速的厂商那里,它们还会占掉你的 RPM。

怎么选这个数?有三种情况:

- **厂商写了并发上限**(DeepSeek 的 2500):取它的一半以下就很宽裕了,几乎不可能碰到。你的瓶颈会变成别的:网络、你自己的机器。
- **厂商只写了 RPM**:并发数 ≈ RPM ÷ 60 × 单个请求耗时(秒)。例如 RPM 1000、每个请求平均 3 秒,并发 50 左右刚好用满。留 20% 余量。这个公式的原理在练习 4 里展开。
- **什么都没写**:从 4 开始,看有没有 429,逐步翻倍。这一步用真 API 做,下一节演示。

还有一个细节:车位到底该包住「整个重试」还是「每次尝试」?上面实验是前者:任务在重试等待期间仍占着车位,所以重试不会让在途数变多。这是我推荐的默认写法,练习 2 会让你亲手比较后者。

## 真 API 上:5 个并发,再冲 40 个

假服务器上的数字让人踏实,但我们得在真 API 上确认一次。新建 `part02/questions.py`(五个问题,下面几个脚本共用)和 `part02/five_real.py`:

```python
```python
# agent-zero-lab/part02/questions.py
QUESTIONS = [
    "发票开错了能作废重开吗?一句话回答。",
    "订阅到期没续费,数据会保留多久?一句话回答。",
    "怎么导出上个月的账单?一句话回答。",
    "一个账号最多能加几个成员?一句话回答。",
    "忘记登录密码怎么办?一句话回答。",
]
```
```

```python
```python
# agent-zero-lab/part02/five_real.py
import asyncio
import json
import os
import time

from dotenv import load_dotenv
from openai import AsyncOpenAI

from common.cost import call_cost, parse_price
from part02.questions import QUESTIONS

load_dotenv(os.environ.get("ENV_FILE", ".env"), override=True)
client = AsyncOpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"], max_retries=0, timeout=60)
extra_body = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
price = parse_price(os.environ["LLM_PRICE"])


async def ask(question: str) -> tuple[float, float]:
    start = time.monotonic()
    resp = await client.chat.completions.create(
        model=os.environ["LLM_MODEL"],
        messages=[{"role": "user", "content": question}],
        max_tokens=150,
        extra_body=extra_body,
    )
    assert resp.usage is not None
    return time.monotonic() - start, call_cost(resp.usage, price)


async def main() -> None:
    start = time.monotonic()
    serial = [await ask(q) for q in QUESTIONS]
    print(f"一个接一个: 总共 {time.monotonic() - start:.2f} 秒, 每个 {[round(t, 2) for t, _ in serial]}")

    start = time.monotonic()
    parallel = await asyncio.gather(*[ask(q) for q in QUESTIONS])
    print(f"5 个一起发: 总共 {time.monotonic() - start:.2f} 秒, 每个 {[round(t, 2) for t, _ in parallel]}")

    total = sum(c for _, c in serial) + sum(c for _, c in parallel)
    print(f"两轮共 10 次调用, 花费 {total:.5f} 元")


asyncio.run(main())
```
```

<div class="line-notes">

- `QUESTIONS = [` 五个简短的客服问题,每个都要求「一句话回答」,让每次调用都很短、很便宜。
- `from part02.questions import QUESTIONS` 从上面那个文件拿问题。
- `load_dotenv(os.environ.get("ENV_FILE", ".env"), override=True)` 同 `show_headers.py`,用 `ENV_FILE` 选配置文件。
- `client = AsyncOpenAI(..., max_retries=0, timeout=60)` 异步客户端,不让 SDK 重试,单次超时 60 秒。
- `price = parse_price(os.environ["LLM_PRICE"])` Day 124 的 `common/cost.py`,把 `"0.04,2,8"` 解析成三个单价。
- `async def ask(question: str) -> tuple[float, float]:` 问一个问题,返回(耗时秒数,这次花的钱)。
- `start = time.monotonic()` 记下发请求前的时刻。
- `max_tokens=150,` 回答最多 150 个 token,防止模型话多。
- `assert resp.usage is not None` `usage` 在类型上可能是 `None`,断言一下让类型检查器放心,运行时厂商都会返回它。
- `return time.monotonic() - start, call_cost(resp.usage, price)` 耗时和花费。
- `serial = [await ask(q) for q in QUESTIONS]` 列表推导式里写 `await`:一个接一个地问。这是 Python 3.6 之后允许的写法,在 `async def` 里才行。
- `[round(t, 2) for t, _ in serial]` 取出每次的耗时,保留两位小数。`t, _` 是解包,`_` 丢掉花费。
- `parallel = await asyncio.gather(*[ask(q) for q in QUESTIONS])` 5 个一起问。
- `total = sum(c for _, c in serial) + sum(c for _, c in parallel)` 两轮 10 次调用的总花费。

</div>

```bash
ENV_FILE=.env uv run python -m part02.five_real
ENV_FILE=.env.sf uv run python -m part02.five_real
```

```text
一个接一个: 总共 5.26 秒, 每个 [0.97, 1.39, 0.75, 1.15, 0.99]
5 个一起发: 总共 1.26 秒, 每个 [1.22, 1.02, 1.25, 1.06, 0.92]
两轮共 10 次调用, 花费 0.00252 元
```

```text
一个接一个: 总共 12.53 秒, 每个 [1.22, 1.0, 3.73, 0.73, 5.85]
5 个一起发: 总共 5.15 秒, 每个 [2.9, 5.15, 1.24, 1.3, 1.16]
两轮共 10 次调用, 花费 0.00239 元
```

第一块是 DeepSeek(`.env`),第二块是硅基流动(`.env.sf`,同一个模型 DeepSeek-V4-Flash)。DeepSeek:一个接一个 5.26 秒,一起发 1.26 秒,每个请求的耗时基本不变(1 秒上下),说明并发没有让单个请求变慢。硅基流动:12.53 秒对 5.15 秒,单个请求的耗时波动很大,从 0.73 秒到 5.85 秒,5 个一起发的时候最慢的那个也等了 5 秒。这是它那一刻的状态,没有对错,但提醒你:同样的模型名,不同厂商的速度会差很多,下一节会专门比一次。

费用:DeepSeek 两轮共 10 次调用 0.00252 元,硅基流动 0.00239 元。算式是 Day 124 的 `(命中 × 单价 + 未命中 × 单价 + 输出 × 单价) ÷ 100 万`,每次调用输入十几个 token、输出二三十个 token(我单独打印过两次:17 输入 35 输出,13 输入 20 输出),一次约 0.0003 元,不到一厘钱。

再看看真 API 的上限有多远。`real_burst.py` 一次发 40 个请求,不限并发,看会不会 429:

```python
```python
# agent-zero-lab/part02/real_burst.py
import asyncio
import json
import os
import sys
import time
from collections import Counter

import openai
from dotenv import load_dotenv
from openai import AsyncOpenAI

load_dotenv(os.environ.get("ENV_FILE", ".env"), override=True)
client = AsyncOpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"], max_retries=0, timeout=60)
extra_body = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
N = int(sys.argv[1]) if len(sys.argv) > 1 else 40


async def one(i: int) -> str:
    try:
        await client.chat.completions.create(
            model=os.environ["LLM_MODEL"],
            messages=[{"role": "user", "content": f"只回答数字:{i} 加 1 等于几?"}],
            max_tokens=20,
            extra_body=extra_body,
        )
        return "成功"
    except openai.APIStatusError as e:
        return f"HTTP {e.status_code}"


async def main() -> None:
    start = time.monotonic()
    results = await asyncio.gather(*[one(i) for i in range(N)])
    print(f"{os.environ['LLM_BASE_URL']}: 同时发 {N} 个 -> {dict(Counter(results))}, 用了 {time.monotonic() - start:.2f} 秒")


asyncio.run(main())
```
```

<div class="line-notes">

- `N = int(sys.argv[1]) if len(sys.argv) > 1 else 40` 命令行第一个参数是数量,不给就是 40。`sys.argv` 是 [Day 44](/blog/agent-zero/day-044-notebook-project/) 讲的命令行参数列表。
- `except openai.APIStatusError as e:` 收服务器回了错误响应的所有情况,429 也是。
- `return f"HTTP {e.status_code}"` 把状态码当作结果字符串,方便最后统计。
- `max_tokens=20,` 每个请求只要几个字,总共 40 个才花不到一厘钱。
- `content: f"只回答数字:{i} 加 1 等于几?"` 每个请求内容不同,避免被缓存干扰。

</div>

```bash
ENV_FILE=.env uv run python -m part02.real_burst 40
ENV_FILE=.env.sf uv run python -m part02.real_burst 40
```

```text
https://api.deepseek.com: 同时发 40 个 -> {'成功': 40}, 用了 2.73 秒
```

```text
https://api.siliconflow.cn/v1: 同时发 40 个 -> {'成功': 40}, 用了 9.33 秒
```

40 个全部成功,没有一个 429。DeepSeek 2.73 秒,硅基流动 9.33 秒。这个结果本身就是个结论:**在学习阶段,你很难碰到厂商的上限**,DeepSeek 要同时 2500 个在途才会 429。限并发在这个阶段的作用,更多是保护你自己的机器和账单,以及养成习惯,到了真正需要的场合(评测几千条、批量处理几万条、多个用户同时用)你不会踩坑。

## 选厂商:看哪几项

前面两节已经提供了足够的素材来讨论选厂商。我的做法是先问清楚自己要什么,再看下面几项,不要先问「哪家最好」。

| 维度 | 要问的问题 | 怎么查证 |
| --- | --- | --- |
| 价格 | 每百万输入、输出 token 多少钱?有没有缓存价?高峰和空闲时段价格一样吗? | 官方价格页(Day 124 的 `LLM_PRICE` 就是为此) |
| 速度 | 同样 5 个问题,总时间和最慢一个是多少?首字要多久(流式,Day 133)? | 自己跑一遍,不要信宣传(下面的 `vendor_compare.py`) |
| 上限 | 并发/RPM/TPM 是多少?超了怎么办?能不能申请提高? | 限速页(今天第一节的表) |
| 稳定性 | 过去一个月出过几次事故?有没有状态页?出事时返回什么? | 厂商状态页、社区反馈;自己的日志(Day 126 的分类统计) |
| 数据去向 | 数据出不出境?会不会拿去训练?有没有数据处理协议? | 隐私政策、企业版条款 |
| 合同与发票 | 能不能开发票、对公转账?有没有 SLA? | 商务渠道;对公司项目这条常常是决定性的 |
| 兼容性 | 是不是 OpenAI 兼容?有哪些参数不支持(比如 JSON Schema)? | 文档加实测(DeepSeek 不支持 `json_schema`,Day 148 会讲) |

这七项里,价格和速度你可以自己量,上限和兼容性读文档,其余几项只能靠平时积累。我的建议分三种场景:

**学习阶段**:选国内直连、便宜、文档清楚的。DeepSeek 或通义千问都行,这门课默认 DeepSeek。反复跑才会熟练,不用在价格上纠结。

**做作品给面试官看**:最好同时支持两家,README 里放一张对比表,同一批用例上两家的准确率、单次成本、延迟各是多少,最后选了哪个、为什么。「熟悉多家大模型」这句话没有说服力,这张表有。因为我们用的是 OpenAI 兼容协议(Day 123),切换只改三个环境变量,做起来成本很低。

**真正上生产**:数据能不能出境、SLA、发票合同、峰谷价格、限速额度能不能申请提高,这些才是决定性的。面试时被问到「你们怎么选的大模型厂商」,能说出其中两三条,比说出模型分数加分。

现在量一次「速度和价格」。`vendor_compare.py` 对两个配置文件各跑 3 轮,每轮 5 个并发问答,汇总单次耗时的中位数、最慢一次、每轮的总时间和 15 次调用的总花费:

```python
```python
# agent-zero-lab/part02/vendor_compare.py
import asyncio
import json
import statistics
import time

from dotenv import dotenv_values
from openai import AsyncOpenAI

from common.cost import call_cost, parse_price
from part02.questions import QUESTIONS

ENV_FILES = [".env", ".env.sf"]
ROUNDS = 3


async def bench(env_file: str) -> None:
    env = dotenv_values(env_file)
    client = AsyncOpenAI(base_url=env["LLM_BASE_URL"], api_key=env["LLM_API_KEY"], max_retries=0, timeout=60)
    extra_body = json.loads(env.get("LLM_EXTRA_BODY") or "{}")
    price = parse_price(env["LLM_PRICE"] or "")
    latencies: list[float] = []
    walls: list[float] = []
    cost = 0.0

    async def ask(question: str) -> None:
        nonlocal cost
        start = time.monotonic()
        resp = await client.chat.completions.create(
            model=env["LLM_MODEL"] or "", messages=[{"role": "user", "content": question}],
            max_tokens=150, extra_body=extra_body,
        )
        latencies.append(time.monotonic() - start)
        assert resp.usage is not None
        cost += call_cost(resp.usage, price)

    for _ in range(ROUNDS):
        start = time.monotonic()
        await asyncio.gather(*[ask(q) for q in QUESTIONS])
        walls.append(time.monotonic() - start)
    print(f"{env['LLM_BASE_URL']:<30} 单次中位 {statistics.median(latencies):.2f} 秒, 最慢 {max(latencies):.2f} 秒, "
          f"每轮 5 个并发的总时间 {[round(w, 2) for w in walls]}, {ROUNDS * 5} 次共 {cost:.5f} 元")


async def main() -> None:
    for f in ENV_FILES:
        await bench(f)


asyncio.run(main())
```
```

<div class="line-notes">

- `from dotenv import dotenv_values` 和 `load_dotenv` 不同,它只把文件内容读成一个字典,不动环境变量。我们同时要用两个配置文件,不能让后读的覆盖先读的,所以用它。
- `ENV_FILES = [".env", ".env.sf"]` 要比较的两个厂商。以后加第三家,在这里加一个配置文件名。
- `ROUNDS = 3` 每家跑 3 轮。一轮的数字太容易被偶然因素影响(刚才硅基流动第一轮就慢了一倍),多跑几轮取中位数才可信。
- `env = dotenv_values(env_file)` 得到字典,例如 `env["LLM_BASE_URL"]` 是 `"https://api.deepseek.com"`。
- `extra_body = json.loads(env.get("LLM_EXTRA_BODY") or "{}")` 没写这一项时 `.get` 返回 `None`,`or "{}"` 兜底成空 JSON。两家都关了思考模式,公平比较,没关的话推理模型会慢很多。
- `price = parse_price(env["LLM_PRICE"] or "")` 字典的值类型是 `str | None`,`or ""` 让类型检查器放心,真有这一项就是正常字符串。
- `latencies: list[float] = []` 收集每次调用的耗时,最后取中位数和最大值。
- `async def ask(question: str) -> None:` 一次调用,把耗时和花费记到外面的变量里。
- `nonlocal cost` 声明这里的 `cost` 是外层函数 `bench` 的那个变量,不是新建一个局部的。不写的话 `cost += ...` 会报「赋值前引用」。
- `latencies.append(time.monotonic() - start)` 记录这次耗时。`latencies` 是列表,`append` 不需要 `nonlocal`,只有对变量名重新赋值才需要。
- `for _ in range(ROUNDS):` 三轮。
- `await asyncio.gather(*[ask(q) for q in QUESTIONS])` 每轮 5 个并发。
- `statistics.median(latencies)` 标准库的中位数。15 个耗时排好序,第 8 个就是中位数。
- `print(f"{env['LLM_BASE_URL']:<30} ...` `:<30` 左对齐占 30 格,两行才对得齐。f-string 里面用单引号 `env['LLM_BASE_URL']`,因为外面是双引号。

</div>

```bash
uv run python -m part02.vendor_compare
```

```text
https://api.deepseek.com       单次中位 1.15 秒, 最慢 1.34 秒, 每轮 5 个并发的总时间 [1.47, 1.35, 1.2], 15 次共 0.00377 元
https://api.siliconflow.cn/v1  单次中位 1.94 秒, 最慢 5.05 秒, 每轮 5 个并发的总时间 [5.05, 3.23, 4.34], 15 次共 0.00403 元
```

这一次的结果:DeepSeek 官方,单次中位 1.15 秒,最慢 1.34 秒,每轮总时间都在 1.2 到 1.5 秒之间;硅基流动,单次中位 1.94 秒,最慢 5.05 秒,每轮 3 到 5 秒。花费两边差不多(0.00377 元和 0.00403 元,价格不同,因为硅基流动的 `LLM_PRICE` 填的是 0.3,3,9 而 DeepSeek 是 0.04,2,8,Day 124 讲过缓存价)。

别把这个结果当成「DeepSeek 官方永远更快」的结论。这是我在 2026 年 10 月 23 日这一个时刻、这一台机器、同一个模型名上的 30 次调用,换个时间、换个网络可能反过来。它能告诉你的是**方法**:同一批问题、并发跑、跑几轮、看中位数和最慢的,比看一次的数字可靠得多。你自己跑,数字肯定和我的不一样,这是正常的。

## 拼起来:ask_many.py

最后把今天的零件拼成一个能用的小工具:读一个文本文件里的问题(每行一个),用 Semaphore 控制并发,每个问题都带重试,最后按原来的顺序打印,失败的不影响别的。新建 `data/q_d128.txt`(8 个问题)和 `part02/ask_many.py`:

```text
发票开错了能作废重开吗?
订阅到期没续费,数据会保留多久?
怎么导出上个月的账单?
一个账号最多能加几个成员?
忘记登录密码怎么办?
可以开增值税专用发票吗?
支持哪些支付方式?
怎么把账号转给同事?
```

```python
```python
# agent-zero-lab/part02/ask_many.py
import asyncio
import json
import os
import sys
import time
from pathlib import Path

import openai
from dotenv import load_dotenv
from openai import AsyncOpenAI

from common.cost import call_cost, parse_price
from part02.aretry import acall_with_retry
from part02.classify import classify
from part02.retry import RetryPolicy

load_dotenv(os.environ.get("ENV_FILE", ".env"), override=True)
client = AsyncOpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"], max_retries=0, timeout=60)
extra_body = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
price = parse_price(os.environ["LLM_PRICE"])
POLICY = RetryPolicy(max_attempts=4, base=0.5, cap=4.0)


async def ask(question: str, sem: asyncio.Semaphore) -> tuple[str, float]:
    async with sem:
        resp = await acall_with_retry(
            lambda: client.chat.completions.create(
                model=os.environ["LLM_MODEL"],
                messages=[{"role": "user", "content": question + "一句话回答。"}],
                max_tokens=150,
                extra_body=extra_body,
            ),
            POLICY,
        )
    assert resp.usage is not None
    return (resp.choices[0].message.content or "").strip(), call_cost(resp.usage, price)


async def main(path: str, limit: int) -> int:
    questions = [line for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]
    sem = asyncio.Semaphore(limit)
    start = time.monotonic()
    results = await asyncio.gather(*[ask(q, sem) for q in questions], return_exceptions=True)
    failed = 0
    total = 0.0
    for i, (q, r) in enumerate(zip(questions, results), start=1):
        if isinstance(r, openai.OpenAIError):
            failed += 1
            print(f"{i}. {q}\n   失败 [{classify(r).kind}]: {classify(r).advice}")
        elif isinstance(r, BaseException):
            raise r
        else:
            total += r[1]
            print(f"{i}. {q}\n   {r[0]}")
    print(f"--- {len(questions)} 个问题, 并发上限 {limit}, 成功 {len(questions) - failed}, 失败 {failed}, "
          f"用了 {time.monotonic() - start:.2f} 秒, 花费 {total:.5f} 元")
    return 3 if failed else 0


sys.exit(asyncio.run(main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 3)))
```
```

<div class="line-notes">

- `from pathlib import Path` [Day 37](/blog/agent-zero/day-037-pathlib/) 的 `Path`,读文件用。
- `POLICY = RetryPolicy(max_attempts=4, base=0.5, cap=4.0)` 昨天 `ask_retry.py` 用的同一个策略。
- `async def ask(question: str, sem: asyncio.Semaphore) -> tuple[str, float]:` 问一个问题,返回(回答,花费)。信号量作为参数传进来,所有任务共用一个。
- `async with sem:` 车位包住「请求加重试」整个过程。
- `resp = await acall_with_retry(` 今天写的异步重试,里面的 `lambda` 每次重试都发一个新的请求。
- `"content": question + "一句话回答。"` 在每个问题后面拼上要求,让回答短。
- `return (resp.choices[0].message.content or "").strip(), call_cost(resp.usage, price)` 回答可能是 `None`(比如被截断时),`or ""` 兜底,`.strip()` 去掉首尾空白。
- `async def main(path: str, limit: int) -> int:` 返回退出码,不是 `None`。
- `questions = [line for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]` 读文件、按行切、跳过空行。8 行得到 8 个问题的列表。
- `sem = asyncio.Semaphore(limit)` 在 `main` 里按命令行参数建,默认 3。
- `results = await asyncio.gather(*[ask(q, sem) for q in questions], return_exceptions=True)` 关键是 `return_exceptions=True`:某个任务抛了错,不会让整个 `gather` 失败、也不会取消别的任务,而是把那个错当成一个**结果**放进列表。这是 [Day 68](/blog/agent-zero/day-068-async-3/) 学的,相当于 JS 的 `Promise.allSettled`。结果按问题的原顺序排好。
- `for i, (q, r) in enumerate(zip(questions, results), start=1):` `zip` 把问题和结果一对一配好,`enumerate(..., start=1)` 从 1 开始编号。
- `if isinstance(r, openai.OpenAIError):` 这个结果是个 SDK 的错,说明这一题重试用光仍然失败(或者根本不可重试,比如 401)。
- `print(f"{i}. {q}\n   失败 [{classify(r).kind}]: {classify(r).advice}")` 用昨天的 `classify` 给出分类和建议。
- `elif isinstance(r, BaseException): raise r` 不是 SDK 的错,是我们代码里的 bug,不应该被「失败」二字掩盖,直接抛出去。
- `total += r[1]` 成功的题目累加花费。`r` 是 `(回答, 花费)` 元组,`r[1]` 是花费。
- `return 3 if failed else 0` 有失败就退出码 3,和 Day 126 的约定一致:非 0 让调用它的脚本知道不是全部成功。
- `sys.exit(asyncio.run(main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 3)))` 命令行第一个参数是文件,第二个是并发数。`asyncio.run` 返回 `main` 的返回值,交给 `sys.exit` 当作退出码。

</div>

```bash
uv run python -m part02.ask_many data/q_d128.txt 3
```

```text
1. 发票开错了能作废重开吗?
   可以，但需在开具当月且符合作废条件时作废重开，跨月或不符合条件则需开具红字发票冲销后再重开。
2. 订阅到期没续费,数据会保留多久?
   订阅到期未续费后数据保留时长取决于具体服务商的条款，通常为30天至6个月不等，建议查看该服务的官方政策。
3. 怎么导出上个月的账单?
   在账单页面选择“上月”时间范围后点击“导出”即可。
4. 一个账号最多能加几个成员?
   一个账号最多能加几个成员取决于具体平台，没有统一答案（例如微信个人号最多5000好友、企业微信成员数按版本不同）。
5. 忘记登录密码怎么办?
   点击登录页的“忘记密码”，通过绑定的手机号或邮箱验证后重置即可。
6. 可以开增值税专用发票吗?
   可以，只要您是增值税一般纳税人或符合税务机关代开条件，就能开具增值税专用发票。
7. 支持哪些支付方式?
   支持微信支付、支付宝、银行卡及信用卡等主流支付方式（具体以结算页显示为准）。
8. 怎么把账号转给同事?
   不同平台操作不同，通常需在账号设置的“成员管理/转让”中发起转让并让同事确认接收。
--- 8 个问题, 并发上限 3, 成功 8, 失败 0, 用了 2.87 秒, 花费 0.00183 元
exit=0
```

8 个问题,并发上限 3,全部成功,2.87 秒,花费 0.00183 元(8 个调用,每个输入十几个 token、输出二三十个 token,平均一次约 0.00023 元)。每个问题的回答按文件顺序排好,不是按完成的先后。再看 key 错的情况(`.env.badkey` 是 Day 126 建的故意写错 key 的配置):

```bash
ENV_FILE=.env.badkey uv run python -m part02.ask_many data/q_d128.txt 3
```

```text
1. 发票开错了能作废重开吗?
   失败 [你的账号]: key 不对或已作废:检查配置文件里的 LLM_API_KEY
2. 订阅到期没续费,数据会保留多久?
   失败 [你的账号]: key 不对或已作废:检查配置文件里的 LLM_API_KEY
3. 怎么导出上个月的账单?
   失败 [你的账号]: key 不对或已作废:检查配置文件里的 LLM_API_KEY
4. 一个账号最多能加几个成员?
   失败 [你的账号]: key 不对或已作废:检查配置文件里的 LLM_API_KEY
5. 忘记登录密码怎么办?
   失败 [你的账号]: key 不对或已作废:检查配置文件里的 LLM_API_KEY
6. 可以开增值税专用发票吗?
   失败 [你的账号]: key 不对或已作废:检查配置文件里的 LLM_API_KEY
7. 支持哪些支付方式?
   失败 [你的账号]: key 不对或已作废:检查配置文件里的 LLM_API_KEY
8. 怎么把账号转给同事?
   失败 [你的账号]: key 不对或已作废:检查配置文件里的 LLM_API_KEY
--- 8 个问题, 并发上限 3, 成功 0, 失败 8, 用了 0.49 秒, 花费 0.00000 元
exit=3
```

8 个全失败,0.49 秒就结束了(401 不可重试,每个任务只发了 1 个请求,一次都没重试),退出码 3(上面末尾的 `exit=3`)。再看一个细节:8 个任务各自失败各自的,不是一个 401 就让整个批处理停下。批量任务里「一个错就全停」有时是对的(key 错了,继续发只会浪费),有时是错的(其中一条数据有毛病)。今天的版本选择「每个任务独立」,练习里你可以改成「遇到账号类的错就全部取消」。

### 零件 → 大代码对照

| 零件 | 在 `ask_many.py` 的哪一段 |
| --- | --- |
| `asyncio.gather` 同时放出一批(`five_fake.py`) | `main` 里的 `await asyncio.gather(...)` |
| `Semaphore` 限制并发(`cap_limited.py`) | `ask` 里的 `async with sem:` |
| `acall_with_retry` 异步重试(`aretry.py`) | `ask` 里的 `await acall_with_retry(...)` |
| `return_exceptions=True` | `gather` 的参数,让失败变成结果 |
| `classify`(Day 126) | 打印失败原因 |
| `call_cost`(Day 124) | `ask` 的返回值,`main` 累加 |

## 动手练习

**练习 1:车位开多大。** 写 `part02/sem_sweep.py`:对假服务器 `sleep-0.3`(每个请求 0.3 秒,没有上限),发 24 个任务,Semaphore 依次取 1、2、4、8、24,打印每种的总耗时和服务器见过的最大并发。回答:耗时和车位数是什么关系?

<details><summary>参考答案</summary>

```python
```python
# agent-zero-lab/part02/sem_sweep.py
import asyncio
import time

from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam

from part02.fake_llm import fake_server

N = 24
MESSAGES: list[ChatCompletionMessageParam] = [{"role": "user", "content": "hi"}]


async def run(limit: int) -> None:
    with fake_server() as (url, server):
        client = AsyncOpenAI(base_url=url, api_key="sk-fake", max_retries=0)
        sem = asyncio.Semaphore(limit)

        async def one() -> None:
            async with sem:
                await client.chat.completions.create(model="sleep-0.3", messages=MESSAGES)

        start = time.monotonic()
        await asyncio.gather(*[one() for _ in range(N)])
        print(f"Semaphore({limit:2d}): {time.monotonic() - start:5.2f} 秒, 服务器同时最多 {server.peak:2d} 个在途")


for limit in (1, 2, 4, 8, 24):
    asyncio.run(run(limit))
```
```

<div class="line-notes">

- `N = 24` 24 个任务。
- `async def run(limit: int) -> None:` 每种车位数跑一次。
- `async with sem:` 车位包住一次请求。
- `model="sleep-0.3"` 服务器睡 0.3 秒,没有并发上限,所以不会 429,只量速度。
- `print(f"Semaphore({limit:2d}): {...:5.2f} 秒, ...` `:2d` 是宽度 2 的整数,`:5.2f` 是宽度 5、两位小数的浮点数,这样五行才对得齐。
- `for limit in (1, 2, 4, 8, 24):` 24 刚好等于任务数,相当于不限。

</div>

```bash
uv run python -m part02.sem_sweep
```

```text
Semaphore( 1):  7.58 秒, 服务器同时最多  1 个在途
Semaphore( 2):  3.76 秒, 服务器同时最多  2 个在途
Semaphore( 4):  1.96 秒, 服务器同时最多  4 个在途
Semaphore( 8):  1.04 秒, 服务器同时最多  8 个在途
Semaphore(24):  0.42 秒, 服务器同时最多 24 个在途
```

耗时大致是 `24 × 0.3 ÷ 车位数`:车位 1 是 7.2 秒(实测 7.58),车位 2 是 3.6 秒(3.76),车位 4 是 1.8 秒(1.96),车位 8 是 0.9 秒(1.04),车位 24 是 0.3 秒(实测 0.42)。多出来的零头是建立连接和线程调度的开销。车位数翻倍,耗时减半,一直到「车位数 ≥ 任务数」为止。这是一条很干净的反比关系:并发越大越快,代价只是对服务器的压力,所以才需要一个上限来平衡。

</details>

**练习 2:车位该包住什么。** 上面 `limited_retry.py` 的 Semaphore 包住了「整个请求加重试」。另一种写法是只包住「每一次尝试」:每次重试要重新排队拿车位,等待退避的时候车位是空的。写 `part02/sem_where.py`,服务器 `cap:4:0.5`,Semaphore(6)(比上限大 2),20 个任务,比较两种包法下服务器收到的请求总数。预测一下,哪种更少?

<details><summary>参考答案</summary>

```python
```python
# agent-zero-lab/part02/sem_where.py
import asyncio
import time
from collections import Counter

import openai
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam

from part02.aretry import acall_with_retry
from part02.fake_llm import fake_server
from part02.retry import RetryPolicy

MODEL = "cap:4:0.5"
N = 20
LIMIT = 6
MESSAGES: list[ChatCompletionMessageParam] = [{"role": "user", "content": "hi"}]
POLICY = RetryPolicy(max_attempts=5, base=0.2, cap=1.0)


async def run(where: str) -> None:
    with fake_server() as (url, server):
        client = AsyncOpenAI(base_url=url, api_key="sk-fake", max_retries=0)
        sem = asyncio.Semaphore(LIMIT)

        async def attempt() -> object:
            if where == "每次尝试":
                async with sem:
                    return await client.chat.completions.create(model=MODEL, messages=MESSAGES)
            return await client.chat.completions.create(model=MODEL, messages=MESSAGES)

        async def one() -> str:
            try:
                if where == "整个重试":
                    async with sem:
                        await acall_with_retry(attempt, POLICY)
                else:
                    await acall_with_retry(attempt, POLICY)
                return "成功"
            except openai.OpenAIError:
                return "失败"

        start = time.monotonic()
        results = await asyncio.gather(*[one() for _ in range(N)])
        print(f"Semaphore({LIMIT}) 包住{where}: {dict(Counter(results))}, 服务器收到 {len(server.requests_seen)} 个请求, {time.monotonic() - start:.2f} 秒")


for where in ("整个重试", "每次尝试"):
    asyncio.run(run(where))
```
```

<div class="line-notes">

- `LIMIT = 6` 故意比服务器的 4 大,这样一定会有 429,才能看出两种包法的差别。
- `async def run(where: str) -> None:` `where` 取「整个重试」或「每次尝试」,决定车位包在哪。
- `async def attempt() -> object:` 一次尝试。传给 `acall_with_retry` 的 `fn` 每次重试都会重新调用它。
- `if where == "每次尝试":` 这种包法下,车位在 `attempt` 里面拿:每次尝试开始前拿,尝试结束(不管成败)就还。
- `async with sem:` `return await client.chat.completions.create(...)` 拿了车位才发请求。
- `if where == "整个重试":` 这种包法下,车位在 `one` 里面拿,包住整个 `acall_with_retry`:任务从第一次尝试到最终成败,一直占着车位,包括退避等待的时间。
- `Counter(results)` 统计成功、失败各几个。
- `for where in ("整个重试", "每次尝试"):` 依次跑两种。

</div>

```bash
uv run python -m part02.sem_where
```

```text
Semaphore(6) 包住整个重试: {'成功': 17, '失败': 3}, 服务器收到 35 个请求, 2.92 秒
Semaphore(6) 包住每次尝试: {'成功': 16, '失败': 4}, 服务器收到 76 个请求, 2.52 秒
```

「整个重试」收到 35 个请求,「每次尝试」收到 76 个,多了一倍多。(成败的个数每次跑都会变,但请求数稳定:我另外跑了三次,前者是 33、35、36,后者是 75、76、80。)

原因:包住每次尝试时,一个任务被 429 之后立刻把车位还回去,退避的 0.2 秒里车位空着,排在后面的任务马上补进去,于是同时在发请求的任务又回到了 6 个,比服务器的 4 个多,继续被 429,继续重试。包住整个重试时,被 429 的任务带着车位去睡觉,车位不会空出来,同时在途的数量被硬压在 6 以下,而且重试者会占着位置,新的任务进不来,「撞车」就自然减少。**退避等待也是一种限流,别把它放出车位。**

</details>

**练习 3:每分钟类的限速,并发管不住。** 假服务器 `rate:5:1`:每 1 秒窗口最多 5 个请求,超了 429。发 20 个很快的请求(服务器不睡觉),比较三种做法:什么都不加、只加 `Semaphore(4)`、加一个「每秒最多 5 个」的节拍器。写 `part02/pacer.py`。

<details><summary>参考答案</summary>

```python
```python
# agent-zero-lab/part02/pacer.py
import asyncio
import time
from collections import Counter

import openai
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam

from part02.fake_llm import fake_server

MODEL = "rate:5:1"
N = 20
MESSAGES: list[ChatCompletionMessageParam] = [{"role": "user", "content": "hi"}]


class Pacer:
    """相邻两次放行至少隔 1 / per_second 秒。"""

    def __init__(self, per_second: float) -> None:
        self.interval = 1 / per_second
        self.next_time = 0.0
        self.lock = asyncio.Lock()

    async def wait(self) -> None:
        async with self.lock:
            now = time.monotonic()
            wait = self.next_time - now
            if wait > 0:
                await asyncio.sleep(wait)
            self.next_time = max(now, self.next_time) + self.interval


async def run(label: str, use_sem: bool, use_pacer: bool) -> None:
    with fake_server() as (url, server):
        client = AsyncOpenAI(base_url=url, api_key="sk-fake", max_retries=0)
        pacer = Pacer(per_second=5)
        sem = asyncio.Semaphore(4)

        async def call() -> str:
            if use_pacer:
                await pacer.wait()
            try:
                await client.chat.completions.create(model=MODEL, messages=MESSAGES)
                return "成功"
            except openai.RateLimitError:
                return "429"

        async def one() -> str:
            if use_sem:
                async with sem:
                    return await call()
            return await call()

        start = time.monotonic()
        results = await asyncio.gather(*[one() for _ in range(N)])
        print(f"{label}: {dict(Counter(results))}, 用了 {time.monotonic() - start:.2f} 秒")


asyncio.run(run("什么都不加", use_sem=False, use_pacer=False))
asyncio.run(run("只有 Semaphore(4)", use_sem=True, use_pacer=False))
asyncio.run(run("Pacer(每秒 5 个)", use_sem=False, use_pacer=True))
```
```

<div class="line-notes">

- `class Pacer:` 节拍器。「相邻两次放行至少隔 `1 / per_second` 秒」,每秒 5 个就是每 0.2 秒放一个。
- `self.interval = 1 / per_second` `per_second=5` 时是 0.2 秒。
- `self.next_time = 0.0` 下一个任务最早可以出发的时刻(用 `time.monotonic()` 的钟),一开始是 0,也就是随时可以。
- `self.lock = asyncio.Lock()` 异步锁。同一时刻只让一个任务在里面算「我该等多久」,不然两个任务同时读到同一个 `next_time`,会同时出发。
- `async with self.lock:` 拿锁,和 `Semaphore` 同一种用法,`Lock` 就是只有 1 个车位的信号量。
- `wait = self.next_time - now` 离「下一个可以出发」还差多久。第 3 个任务来时,如果 `next_time` 是 0.4、现在是 0.01,就是 0.39 秒。
- `if wait > 0:` 还没到时间才睡。
- `await asyncio.sleep(wait)` 睡的时候锁还握在手里,后面的任务在锁外排队,于是放行是一个一个按间隔出去的。
- `self.next_time = max(now, self.next_time) + self.interval` 下一个放行时刻往后推 0.2 秒。`max(now, ...)` 处理「很久没有任务来过」的情形:不能让 `next_time` 停在很久以前,否则下一批会一口气全放出去。
- `async def run(label: str, use_sem: bool, use_pacer: bool) -> None:` 三种做法用两个开关组合出来。
- `if use_sem:` `async with sem:` 开了 Semaphore 就在外面包一层车位。
- `if use_pacer:` `await pacer.wait()` 开了节拍器,每个请求发出前先过一遍节拍器。
- `asyncio.run(run("只有 Semaphore(4)", use_sem=True, use_pacer=False))` 第二种,只开车位。

</div>

```bash
uv run python -m part02.pacer
```

```text
什么都不加: {'429': 15, '成功': 5}, 用了 0.39 秒
只有 Semaphore(4): {'成功': 5, '429': 15}, 用了 0.15 秒
Pacer(每秒 5 个): {'成功': 20}, 用了 3.81 秒
```

什么都不加:前 5 个过,15 个 429。只有 Semaphore(4):结果一模一样,前 5 个过,15 个 429,甚至更快(0.15 秒)。为什么?因为服务器是「每秒 5 个」而不是「同时 5 个」,每个请求处理得很快(没有睡觉),车位一腾出来下一个就补上,1 秒之内 20 个请求都发出去了,窗口里装不下。加了 Pacer,20 个请求每隔 0.2 秒放一个,3.81 秒全部成功(20 × 0.2 = 4 秒左右)。

规律:并发上限(同时在场的人数)用 Semaphore;RPM 这类「每分钟多少次」的上限用节拍器,或者现成的库(如 `aiolimiter`)。两个都有的厂商,两个都要。TPM 也一样:每个请求发出前,先估一下它会用多少 token,从桶里扣,桶空了就等。

</details>

**练习 4:算一算要开多大并发。** 评测集 200 条,每条一次调用,平均耗时 3 秒,平均输入 800 token、输出 150 token。写 `part02/capacity.py`,算并发 1、5、20、50 时,总耗时、每分钟请求数、每分钟 token 数各是多少。如果厂商的 TPM 上限是 50 万,并发最多开到多少?

<details><summary>参考答案</summary>

```python
```python
# agent-zero-lab/part02/capacity.py
CASES = 200
AVG_SECONDS = 3.0
IN_TOKENS = 800
OUT_TOKENS = 150

print(f"{'并发':>4} {'总耗时(秒)':>10} {'每分钟请求数':>12} {'每分钟 token':>12}")
for concurrency in (1, 5, 20, 50):
    total_seconds = CASES * AVG_SECONDS / concurrency
    rpm = CASES / total_seconds * 60
    tpm = rpm * (IN_TOKENS + OUT_TOKENS)
    print(f"{concurrency:>4} {total_seconds:>10.0f} {rpm:>12.0f} {tpm:>12,.0f}")
```
```

<div class="line-notes">

- `CASES = 200` 总任务数。
- `AVG_SECONDS = 3.0` 单个调用从发出到收完的平均耗时。
- `IN_TOKENS = 800`、`OUT_TOKENS = 150` 每次调用的 token 数,输入输出加起来 950。TPM 通常按输入加输出一起算(有的厂商只算输入,以文档为准)。
- `print(f"{'并发':>4} {'总耗时(秒)':>10} ...` `:>4` 是右对齐、宽度 4。字符串也可以套格式。中文字符在终端里占两格,所以表头对不太齐,数字列是对齐的。
- `total_seconds = CASES * AVG_SECONDS / concurrency` 并发 20 时:`200 × 3 ÷ 20 = 30` 秒。逻辑是:总工作量是 `200 × 3 = 600` 个「请求·秒」,20 个车位同时干活,每个车位干 30 秒。
- `rpm = CASES / total_seconds * 60` 并发 20 时:`200 ÷ 30 × 60 = 400` 个请求每分钟。
- `tpm = rpm * (IN_TOKENS + OUT_TOKENS)` `400 × 950 = 380,000`。
- `{tpm:>12,.0f}` 千位用逗号分隔,小数 0 位。

</div>

```bash
uv run python -m part02.capacity
```

```text
  并发     总耗时(秒)       每分钟请求数    每分钟 token
   1        600           20       19,000
   5        120          100       95,000
  20         30          400      380,000
  50         12         1000      950,000
```

并发从 1 到 50,总耗时从 600 秒降到 12 秒,每分钟 token 从 1.9 万涨到 95 万。规律是 `每分钟请求数 = 并发 ÷ 单次耗时 × 60`,`每分钟 token = 每分钟请求数 × 每次 token`,这个关系在排队论里叫利特尔法则(Little's law):在途数量 = 吞吐量 × 每个请求在系统里待的时间。你不用记名字,会这个乘法就行。

TPM 上限 50 万:并发 20 时是 38 万,在范围里;并发 50 时是 95 万,超了。每增加 1 个并发,TPM 增加 `19,000`(并发 1 那一行),所以 `500,000 ÷ 19,000 ≈ 26`,并发最多约 26,取 20 到 21 留一点余量。如果你发现自己的瓶颈是 TPM 不是并发,多开并发没有用,要么压缩输入(Day 124 讲的缓存也能省),要么换更高档位。

</details>

**练习 5:分批和信号量的区别。** 很多人的第一反应是「每 4 个一批,批内 `gather`,批和批之间串行」,也能把并发压在 4。写 `part02/batch_vs_sem.py` 比较:12 个任务,模型按「1 秒、0.1 秒、0.1 秒、0.1 秒」重复 3 遍(每 4 个里有一个慢的),分批 vs `Semaphore(4)`,哪个更快,为什么?

<details><summary>参考答案</summary>

```python
```python
# agent-zero-lab/part02/batch_vs_sem.py
import asyncio
import time

from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam

from part02.fake_llm import fake_server

MESSAGES: list[ChatCompletionMessageParam] = [{"role": "user", "content": "hi"}]
MODELS = ["sleep-1", "sleep-0.1", "sleep-0.1", "sleep-0.1"] * 3
LIMIT = 4

with fake_server() as (url, server):
    client = AsyncOpenAI(base_url=url, api_key="sk-fake", max_retries=0)

    async def call(model: str) -> None:
        await client.chat.completions.create(model=model, messages=MESSAGES)

    async def by_batch() -> None:
        for i in range(0, len(MODELS), LIMIT):
            await asyncio.gather(*[call(m) for m in MODELS[i:i + LIMIT]])

    async def by_semaphore() -> None:
        sem = asyncio.Semaphore(LIMIT)

        async def guarded(model: str) -> None:
            async with sem:
                await call(model)

        await asyncio.gather(*[guarded(m) for m in MODELS])

    async def main() -> None:
        for name, fn in (("分批(每 4 个一批)", by_batch), ("Semaphore(4)", by_semaphore)):
            start = time.monotonic()
            await fn()
            print(f"{name}: {time.monotonic() - start:.2f} 秒")

    asyncio.run(main())
```
```

<div class="line-notes">

- `MODELS = ["sleep-1", "sleep-0.1", "sleep-0.1", "sleep-0.1"] * 3` 列表乘 3 是重复 3 遍,得到 12 个模型名,每 4 个里一个睡 1 秒、三个睡 0.1 秒。
- `async def call(model: str) -> None:` 发一次请求,模型名决定睡多久。
- `for i in range(0, len(MODELS), LIMIT):` `range(0, 12, 4)` 得到 0、4、8,每次取一批。
- `MODELS[i:i + LIMIT]` 切片,`i=4` 时是 `MODELS[4:8]`,第 4 到第 7 个。
- `await asyncio.gather(*[call(m) for m in ...])` 一批内同时发,一批全部完成才进入下一批。一批的耗时是批内最慢的那个:1 秒。3 批就是 3 秒。
- `async def guarded(model: str) -> None:` 用车位包住的版本。
- `await asyncio.gather(*[guarded(m) for m in MODELS])` 12 个任务全放出去,谁先完成谁让出车位,下一个马上补进去。快的任务不用等慢的。
- `for name, fn in (("分批(每 4 个一批)", by_batch), ("Semaphore(4)", by_semaphore)):` 元组里放(名字,函数),函数也可以像数据一样放进元组、拿来调用,和 JS 一样。

</div>

```bash
uv run python -m part02.batch_vs_sem
```

```text
分批(每 4 个一批): 3.21 秒
Semaphore(4): 1.25 秒
```

分批 3.21 秒,Semaphore 1.25 秒。分批的问题是「木桶效应」:每一批里 3 个 0.1 秒的任务早早做完了,车位空着,等那个 1 秒的慢任务。Semaphore 没有批的概念,0.1 秒的任务一做完车位立刻有人补上,总时间只取决于总工作量:`(3 × 1 + 9 × 0.1) ÷ 4 ≈ 0.98` 秒,再加零头。真实的大模型调用耗时差异很大(有的回答 20 个 token,有的 2000 个),所以分批会浪费很多。

</details>

**验收标准:** `five_fake.py` 看到 5 秒对 1 秒;`cap_burst.py` 看到 12 个里 8 个 429,`cap_limited.py` 看到 12 个全成功且 `peak=4`;`limited_retry.py` 的四行里请求数从 20 涨到 70 多;`pytest tests/test_aretry.py` 3 个全过;`five_real.py` 在你自己的 key 上跑出一起发比一个接一个快三到五倍;`ask_many.py` 8 个问题全部有回答、`.env.badkey` 退出码为 3;五道练习的输出和文章一致(耗时有几百毫秒的出入是正常的)。

今天的花费:本机假服务器上的实验不花钱。真 API 的部分:`five_real.py` 两家各两次(每次 10 个调用)约 0.01 元;`vendor_compare.py` 两家各 15 个调用、我跑了两次,约 0.016 元;`real_burst.py` 两家各 40 个很短的调用,约 0.003 元;`ask_many.py` 8 个问题我跑了几次,每次约 0.0019 元;还有调试时零星的调用。全天约 0.04 元。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| RPM(requests per minute) | 每分钟最多接收多少个请求。限制「敲门的次数」,不管请求大小 |
| TPM(tokens per minute) | 每分钟最多处理多少个 token。限制「搬运的货量」,大请求占得多 |
| 并发(concurrency) | 同一时刻已发出、还没收到完整响应的请求数。DeepSeek 只限这一项 |
| 在途(in flight) | 请求发出去了,响应还没回来的状态 |
| 限速(rate limit) | 厂商限制你发请求的速度或数量,超了返回 429 |
| 429 | HTTP 状态码,「太多请求」。Day 126 讲过它在 DeepSeek 上是并发超限 |
| `AsyncOpenAI` | openai SDK 的异步客户端,`create` 前要 `await` |
| `asyncio.gather` | 同时放出一批协程,等全部完成,按原顺序给结果,≈ JS 的 `Promise.all` |
| `return_exceptions=True` | `gather` 的参数,某个任务出错不影响别的,错误当作结果放进列表,≈ `Promise.allSettled` |
| 信号量(`asyncio.Semaphore`) | 一个有固定个数「车位」的计数器,任务 `async with sem:` 进去、出来还回。用来限制同时在做某件事的任务数,≈ npm 的 `p-limit` |
| `async with` | 进入和离开时可以等待的 `with`,离开时自动收尾 |
| 节拍器(pacer) | 让相邻两次请求至少隔一定时间的小工具,用来遵守每分钟类的上限。这是本课的叫法,不是通用术语 |
| 木桶效应 | 一批任务的耗时由最慢的那个决定。分批处理会浪费快任务的空闲时间 |
| 利特尔法则(Little's law) | 在途数量 = 吞吐量 × 每个请求在系统里的时间,用来由目标吞吐算该开多大的并发 |
| `with_raw_response` | SDK 的一种调用方式,返回 HTTP 响应头和原始响应,不只是解析后的对象 |
| `nonlocal` | 在内层函数里声明「这个变量是外层函数的」,才能对它重新赋值 |
| 线程锁(`threading.Lock`) | 让多个线程轮流改同一份数据,防止同时读到同一个旧值 |

## 常见误区

**以为并发越大越快。** 实测假服务器上限 4,同时发 12 个,只有 4 个成功,8 个 429;并发开到 20,请求数涨到 77,失败反而更多。并发的好处只到「用满对方的能力」为止,再往上全是浪费。

**只靠 SDK 的自动重试扛限速。** 12 个任务、SDK 默认重试,服务器收到 27 到 28 个请求,慢服务器上 8 个任务仍然失败。重试是撞上之后的补救,不会让撞上的概率变小。

**用 `time.sleep` 写异步程序里的等待。** `time.sleep` 会把整个事件循环卡住,所有任务一起停,并发等于零。异步里必须用 `await asyncio.sleep`。

**分批 `gather` 当作限并发。** 它能把并发压在批大小以内,但一批总是被最慢的那个拖住,实测 3.21 秒对 1.25 秒。用 Semaphore。

**以为 Semaphore 能管 RPM。** 它只管「同时在场」。请求处理得快(没睡觉)时,Semaphore(4) 对「每秒 5 个」的服务器毫无作用,实测 20 个里 15 个 429,和什么都不加一样。每分钟类的上限要用节拍器。

**车位放错地方。** 把车位只包住每次尝试,退避等待时车位空着,别的任务补进来,实测请求数从 35 变成 76。车位包住整个重试,等待期间也占着。

**`max_tokens` 随手设很大。** OpenAI 的限速按 `max_tokens` 和估算输入的较大者算,你设了 4000,回答只有 100 token,额度也按 4000 扣。设成接近真实长度。

**一次测速就下结论。** 硅基流动的 5 个并发,单次最慢一次是 5.85 秒,最快 0.73 秒,换一轮又不一样。比较厂商要多跑几轮,看中位数和最慢的。

**把 key 的用量上限和速度上限混为一谈。** 控制台里设的「月度用量上限」或余额告警是花钱的上限,429 说的是速度的上限,两件事。两个都要留意。每个项目一个 key、名字写清楚用途,哪个泄露了单独作废。

## 学习资料

### 文档与文章

- [DeepSeek · 限速页](https://api-docs.deepseek.com/zh-cn/quick_start/rate_limit):今天的主角。读三节:并发上限(2500 和 500)、`user_id` 隔离(提升过并发配额的账号才有用)、请求保活机制(等待时服务器会持续返回空行或 `: keep-alive`,SDK 已经替你忽略了)。5 分钟。
- [硅基流动 · 速率限制与升级](https://api-docs.siliconflow.cn/docs/userguide/faqs/rate-limit-and-upgradation):七个指标、L0 到 L5 怎么按消费升级。对比 DeepSeek 只有一个指标,体会不同厂商的口径差别。
- [OpenAI · Rate limits](https://developers.openai.com/api/docs/guides/rate-limits):讲 RPM、TPM、`x-ratelimit-*` 响应头和 `max_tokens` 对限额的影响。就算你不用 OpenAI,读它的响应头列表也有用,以后看别家文档有参照。
- [Python 文档 · asyncio 同步原语](https://docs.python.org/zh-cn/3/library/asyncio-sync.html):`Lock`、`Semaphore`、`Event` 的官方说明和例子。读 `Semaphore` 那一节,10 行就够。
- [Python 文档 · 协程与任务](https://docs.python.org/zh-cn/3/library/asyncio-task.html):搜 `gather` 和 `return_exceptions`,今天 `ask_many.py` 用到的行为都在这里。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1T99DBoE9j&autoplay=0&high_quality=1" title="大模型API网关，Token限流与计费怎么设计？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>图灵程序员诸葛 · 大模型 API 网关,Token 限流与计费怎么设计 · 3 分钟,2026 年 4 月。从「网关」一侧讲为什么按 token 限流比按请求数限流更合理,对应今天讲的 TPM。短,先看这个。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1u9KP65Eqa&autoplay=0&high_quality=1" title="高峰期并发暴涨，大模型接口直接崩溃？缓存+限流+负载均衡三招稳住！" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>跟着扶安学 AI · 高峰期并发暴涨,大模型接口直接崩溃?缓存、限流、负载均衡三招 · 14 分钟,2026 年 7 月。讲的是服务端怎么扛并发,和我们站在客户端一侧是镜像:看看对方为什么要限你,今天的 Semaphore 就是你这一侧的配合。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Lo19buebJjM" title="Advanced AsyncIO in Python | Locks, Semaphores & Executors" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>SP Learning Labs · Advanced AsyncIO in Python: Locks, Semaphores & Executors · 英文。按标题是讲 asyncio 里的锁和信号量,我只核对了标题和能打开,没逐段看过。看它怎么讲 Semaphore,对照今天的停车场比喻。</figcaption>
</figure>

### 书籍

- 《Using Asyncio in Python: Understanding Python's Asynchronous Programming Features》(Caleb Hattingh 著,O'Reilly,2020 年;我没查到中文版,这里只写英文原版):讲 asyncio 的来龙去脉,有一章讲常见的「限流」「超时」写法。打开目录找 `Semaphore` 和 `asyncio.gather` 的部分读,不用从头读。

### 开源项目与代码

- [mjpieters/aiolimiter](https://github.com/mjpieters/aiolimiter):asyncio 下的漏桶限速库,`AsyncLimiter(5, 1)` 就是「每 1 秒最多 5 个」,练习 3 手写的 `Pacer` 的生产版。读它的 README 就够。
- [BerriAI/litellm](https://github.com/BerriAI/litellm):一个把几十家厂商统一成 OpenAI 接口的 Python 库,里面有多厂商路由、每个厂商单独限速、失败切换。这是「选厂商」的进阶形态:不选一家,而是都接。先看 [Routing 文档](https://docs.litellm.ai/docs/routing),了解一下,课程后面不依赖它。

## 自测

1. RPM、TPM、并发三种上限分别限制什么?DeepSeek 只有哪一种?

<details><summary>答案</summary>

RPM 限制每分钟的请求个数,TPM 限制每分钟处理的 token 总量,并发限制同一时刻还没完成的请求数。DeepSeek 只限并发,`deepseek-flash` 2500、`deepseek-v4-pro` 500,按账号算。

</details>

2. 假服务器上限 4,同时发 12 个请求,不限制并发也不重试,会怎样?加上 `Semaphore(4)` 呢?

<details><summary>答案</summary>

不限制:前 4 个成功,8 个 429,耗时 0.73 秒。加 `Semaphore(4)`:12 个全部成功,服务器同时最多 4 个在途,耗时 1.70 秒(3 批,每批 0.5 秒)。慢一点,但全做完。

</details>

3. 为什么在异步程序里重试要用 `await asyncio.sleep(delay)`,不能用 `time.sleep(delay)`?

<details><summary>答案</summary>

`time.sleep` 会让当前线程原地不动,事件循环也就停了,其它所有任务都跟着卡住。`await asyncio.sleep` 在等待期间把控制权还给事件循环,别的任务可以继续跑。

</details>

4. 20 个很快的请求(服务器不睡觉)打到「每秒最多 5 个」的服务器,`Semaphore(4)` 能避免 429 吗?为什么?

<details><summary>答案</summary>

不能。Semaphore 限制的是「同时在途」,请求很快,车位一腾出来下一个就补上,一秒内 20 个请求都发出去了。实测和什么都不加一样,5 个成功 15 个 429。每秒最多 5 个是速率上限,要用节拍器让请求之间隔 0.2 秒,实测 20 个全成功,3.81 秒。

</details>

5. 分批(每 4 个一批,批内 `gather`)和 `Semaphore(4)` 都能把并发压在 4,哪个更好,为什么?

<details><summary>答案</summary>

Semaphore。分批的一批要等最慢的那个完成,快任务做完后车位空着。实测任务耗时一个 1 秒、三个 0.1 秒交替,分批 3.21 秒,Semaphore 1.25 秒。

</details>

6. 面试题:「你要对 5000 条数据各调一次大模型 API,怎么设计?」

<details><summary>答案</summary>

先看限速口径:厂商限的是并发、RPM 还是 TPM,查文档,没写就从小并发开始试。用 Semaphore 控制并发,把任务全部放出去但同时只有 N 个在发;每个任务带重试(只重试暂时性错误,指数退避加抖动,重试只放一层,把 SDK 的 `max_retries` 设成 0),车位包住整个重试。厂商有 RPM 或 TPM 上限时再加节拍器或令牌桶。并发数用「目标吞吐 × 单次耗时」估算,留 20% 余量。结果按输入顺序保存,单条失败不能让整批失败(`gather(return_exceptions=True)`),但账号类错误(401、402)要整批停下,继续只会浪费。记录每条的状态、耗时、token 和花费,支持断点续跑:失败和没跑的下次再来,不要重复付钱。最后看总成本和失败率,不对就先小批量(比如 50 条)验证再放量。

</details>

## 明天预告

[Day 129](/blog/agent-zero/day-129-messages/) · messages:模型没有记忆,你的列表就是记忆。前面几天一直在讲「请求怎么发出去、怎么发得稳」,每次都只发一句话。明天回到请求的内容:模型是无状态的,第二次问「我刚才说了什么」它不知道,因为你根本没把上一轮带上。要它「记得」,每次请求都得把前面的对话整个再发一遍,`messages` 这个列表就是模型的全部记忆。会手拼一个多轮对话,也会看到四种角色(system、user、assistant、tool)各自负责什么。
