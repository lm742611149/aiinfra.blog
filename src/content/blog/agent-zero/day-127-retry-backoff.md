---
title: 'Day 127 · 重试和指数退避'
description: '分好类之后,可重试的错(429、5xx、连不上、超时)怎么重试。先用本机假服务器看「立刻重试」一秒发出 428 个请求,翻倍等待只发 4 个;对着装好的 openai SDK 源码读它自带的重试规则(默认 2 次、0.5 秒起翻倍、封顶 8 秒、尊重 Retry-After);再自己写带随机抖动的 call_with_retry,接上昨天的 classify,10 个测试;实测 SDK 重试和自己写的重试叠在一起会让一次失败变成 9 个请求。'
pubDate: 2026-10-23
regime: none
tags: ['api', 'retry', 'backoff', 'python', 'pytest', 'agent-zero']
series: 'agent-zero'
day: 127
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 126](/blog/agent-zero/day-126-error-codes/) 把 API 错误分成五类:你的代码、你的账号、太快了、厂商、网络,写了 `classify(e)` 返回 `Verdict(kind, retry, advice, status)`,用 16 个测试钉住,并做了 `ask_safe.py`:能重试的退出码 3,重试没用的退出码 2。还写了一个本机假服务器 `fake_llm.py`,模型名 `status-503` 就让它回 503。

昨天只回答了「该不该重试」,没有写重试本身。今天写。表面上很简单:失败了再发一次,最多发几次。真正写起来有三个问题:隔多久发、第几次放弃、SDK 自己已经会重试了,两层叠在一起怎么办。

## 今天要解决的问题

学完今天,你应该能做到:

1. 用实测数字说清楚「失败后立刻重试」为什么有害,以及「每次等待翻倍」在 3 秒的故障里发了几个请求。
2. 说出 openai SDK 自带重试的规则:重试哪些错、默认几次、等多久、遇到 `Retry-After` 怎么办,并知道在哪个源码文件里能验证。
3. 写出 `call_with_retry`:只重试 `classify` 判为可重试的错,指数退避加随机抖动,尊重服务器给的 `Retry-After`,用 10 个测试验证,而且测试不真的等待。
4. 解释「SDK 的 `max_retries` 和自己写的重试叠在一起」为什么会把一次失败变成 9 个请求,以及怎么避免。

今天的两个新概念:**指数退避**(每次等待时间翻倍)和**抖动**(在等待时间上加随机,避免大家同时重试)。

预计用时:2.5 小时左右。实跑花费:大部分在本机假服务器上,不花钱;真 API 只有 `ask_retry.py` 的一次正常问答,约 0.0004 元,全天不到 0.005 元。前置:[Day 126](/blog/agent-zero/day-126-error-codes/) 的 `classify.py`、`fake_llm.py`、`tests/test_classify.py`,[Day 49](/blog/agent-zero/day-049-type-hints-4/) 的 TypeVar,[Day 75](/blog/agent-zero/day-075-logging/) 的 logging,[Day 73](/blog/agent-zero/day-073-pytest-3/) 的 fixture 和 parametrize。

学法提示:先对照文章把每个脚本逐行敲一遍(不要复制粘贴)并跑通;明天合上文章,把 `backoff_delay` 和 `call_with_retry` 默写出来;然后做动手练习,做不出来再展开参考答案,看完关掉,自己重写一遍。

## 先看不退避会怎样

假服务器要能模拟「故障了一阵、然后恢复」,今天给它加几个新本领。打开昨天的 `part02/fake_llm.py`,改成下面这样(昨天那些没动的行,line-notes 还是昨天的意思,今天只讲新增和改动的地方):

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


class Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        server = cast(FakeServer, self.server)
        length = int(self.headers.get("Content-Length", 0))
        model = json.loads(self.rfile.read(length)).get("model", "")
        now = time.monotonic() - server.started
        server.requests_seen.append(model)
        server.arrivals.append(now)
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
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}", server
    finally:
        server.shutdown()
        server.server_close()
```

<div class="line-notes">

- `def error_body(status: str) -> str:` 昨天 `status-NNN` 分支里那个错误体,抽成函数,因为今天有三处要用。
- `arrivals: list[float]` 新属性:每个请求**到达的时刻**(从服务器启动算起的秒数)。「等了多久再发」只能从服务器那一侧用到达时刻验证,客户端自己的计时有误差。
- `counts: dict[str, int]` 新属性:每种模型名已经收到过几次,`flaky` 模式要用它。
- `started: float` 新属性:服务器启动时的 `time.monotonic()`,`down-N` 模式要用。
- `server = cast(FakeServer, self.server)` 昨天每处都写 `cast(...)`,今天取一次存成变量。
- `now = time.monotonic() - server.started` 距离服务器启动过了几秒。`time.monotonic()` 是只会往前走的计时器,不受系统改时间影响,算时间差用它。
- `server.arrivals.append(now)` 记下这个请求到达的时刻。
- `ok = json.dumps(OK_BODY)` 成功响应先序列化一次,后面好几个分支都用。
- `if model.startswith("flaky:"):` 新模式:模型名形如 `flaky:429:2` 或 `flaky:429:1:3`,意思是「前 2 次(或前 1 次)返回 429,之后正常」,第四段是 `Retry-After` 的秒数。这是测试重试最需要的:失败几次、然后成功。
- `_, status, fails, *rest = model.split(":")` 按冒号切开:`"flaky:429:2".split(":")` 得到 `["flaky", "429", "2"]`。`_` 丢掉第一段,`status` 是 `"429"`,`fails` 是 `"2"`,`*rest` 收下剩下的所有(可能是空列表,也可能是 `["3"]`)。星号接住剩余项,是 [Day 22](/blog/agent-zero/day-022-tuples-unpack/) 解包的延伸写法。
- `seen = server.counts.get(model, 0)` 这种模型名以前收到过几次,第一次没有记录,默认 0。
- `server.counts[model] = seen + 1` 记下这一次。
- `if seen < int(fails):` 前 `fails` 次失败。注意是「同一个模型名」各自计数,所以 `flaky:429:2` 和 `flaky:503:2` 互不影响。
- `headers = {"Retry-After": rest[0]} if rest else {}` 有第四段就带上 `Retry-After` 头,没有就不带。
- `self.reply(int(status), error_body(status), "application/json", headers)` 回失败响应,带上额外的头。
- `elif kind == "down":` 新模式:模型名 `down-2` 是「服务器启动后头 2 秒一直回 503,之后恢复」,模拟一次短暂的厂商故障。
- `if now < float(arg):` 还没到恢复时间。
- `def reply(self, status: int, body: str, content_type: str, headers: dict[str, str] | None = None) -> None:` 多了一个可选参数,额外的响应头。
- `for name, value in (headers or {}).items():` `headers or {}`:没传(`None`)就当空字典。逐个写出去。
- `server.arrivals = []` 启动时建空列表。
- `server.started = time.monotonic()` 记下启动时刻。
- `kwargs={"poll_interval": 0.05}` 昨天的测试每个收尾都多等了约 0.5 秒:`shutdown()` 要等 `serve_forever` 下一次醒来检查,默认每 0.5 秒醒一次。改成 0.05 秒,测试快了十倍。

</div>

昨天的 16 个测试要保证没被改坏:

```bash
uv run pytest tests/test_classify.py -q
```

```text
................                                                         [100%]
16 passed in 3.09s
```

现在做第一个实验。假服务器的 `down-2` 会在 2 秒内一直回 503,第 2 秒之后恢复。写两个客户端循环,一个失败就立刻再发,一个每次等待翻倍(0.5、1、2……秒),数一数各发了多少请求。新建 `part02/naive_retry.py`:

```python
# agent-zero-lab/part02/naive_retry.py
import time

import openai
from openai import OpenAI

from part02.fake_llm import fake_server

with fake_server() as (url, server):
    client = OpenAI(base_url=url, api_key="sk-fake", max_retries=0)
    start = time.monotonic()
    while True:
        try:
            resp = client.chat.completions.create(model="down-2", messages=[{"role": "user", "content": "hi"}])
            break
        except openai.InternalServerError:
            continue
    took = time.monotonic() - start
    print(f"立刻重试: 服务器恢复用了 {took:.2f} 秒, 这期间发了 {len(server.requests_seen)} 个请求")

with fake_server() as (url, server):
    client = OpenAI(base_url=url, api_key="sk-fake", max_retries=0)
    start = time.monotonic()
    wait = 0.5
    while True:
        try:
            resp = client.chat.completions.create(model="down-2", messages=[{"role": "user", "content": "hi"}])
            break
        except openai.InternalServerError:
            time.sleep(wait)
            wait *= 2
    took = time.monotonic() - start
    print(f"翻倍等待: 服务器恢复用了 {took:.2f} 秒, 这期间发了 {len(server.requests_seen)} 个请求")
    print("每次请求到达的时刻:", [round(t, 2) for t in server.arrivals])
```

<div class="line-notes">

- `import time` 量时间、让程序睡觉。
- `with fake_server() as (url, server):` 第一个实验用一个全新的假服务器。`down-2` 的 2 秒从这里开始计。
- `client = OpenAI(base_url=url, api_key="sk-fake", max_retries=0)` 关掉 SDK 自己的重试,这样每个请求都是我们自己的循环发的,数字才干净。
- `start = time.monotonic()` 开始计时。
- `while True:` 无限循环,直到成功才 `break`。相当于 JS 的 `while (true)`。
- `resp = client.chat.completions.create(model="down-2", messages=[{"role": "user", "content": "hi"}])` 发请求,模型名就是给假服务器的指令。
- `break` 成功了就跳出循环。
- `except openai.InternalServerError:` 只接 500 以上的错,其他的不管。
- `continue` 回到循环开头,**立刻**再发。这就是「立刻重试」。
- `print(f"立刻重试: 服务器恢复用了 {took:.2f} 秒, 这期间发了 {len(server.requests_seen)} 个请求")` 服务器收到的请求数,实跑 428 个。
- `wait = 0.5` 第二个实验:第一次等 0.5 秒。
- `time.sleep(wait)` 让程序停下来等。这一行就是「退避」。
- `wait *= 2` `wait = wait * 2` 的简写,每失败一次等待时间翻倍:0.5、1、2、4……。
- `print("每次请求到达的时刻:", [round(t, 2) for t in server.arrivals])` 服务器这边记的到达时刻,实跑 `[0.01, 0.52, 1.52, 3.53]`:第一次失败后等 0.5 秒,第二次失败后等 1 秒,第三次后等 2 秒,第四个请求在 3.53 秒到达,这时候服务器已经恢复(2 秒时就恢复了)。

</div>

```bash
uv run python -m part02.naive_retry
```

实跑输出:

```text
立刻重试: 服务器恢复用了 1.95 秒, 这期间发了 428 个请求
翻倍等待: 服务器恢复用了 3.53 秒, 这期间发了 4 个请求
每次请求到达的时刻: [0.01, 0.52, 1.52, 3.53]
```

故障只持续 2 秒,「立刻重试」的客户端在这两秒里发了 **428 个**请求(我跑了好几次,在 400 到 700 个之间,取决于这台机器当时多忙),每个都是白费的,只会让本来就在喘气的服务器更难恢复。翻倍等待的客户端只发了 4 个,用时 3.53 秒,比「立刻重试」晚了 1.5 秒才拿到结果。这是**用延迟换负载**的交易,也是退避的核心取舍:服务器恢复得越快越亏,故障持续得越久越赚。

真实世界里放大这个效应的,不是你一个客户端,而是成千上万个客户端在同一时刻失败、同一时刻狂发重试。厂商的服务器本来只是过载,被这一波重试压成彻底宕机,这种事故有名字,叫**重试风暴**(retry storm)。

## 退避:每次等待翻倍

「指数退避」的意思是:第 1 次失败后等 `base` 秒,第 2 次等 2 倍,第 3 次等 4 倍……`base × 2^n`。「指数」是因为等待时间是 2 的 n 次方,涨得快。但不能无限涨下去,所以再加一个**上限**(cap):涨到 8 秒就不再涨。

| 第几次失败 | 0 | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- | --- |
| `base × 2ⁿ`(base = 0.5) | 0.5 | 1 | 2 | 4 | 8 | 16 |
| 封顶 8 秒之后 | 0.5 | 1 | 2 | 4 | 8 | 8 |

为什么用翻倍而不是每次加 1 秒?故障如果很短(几秒),前几次尝试很密,能很快发现服务器好了;故障如果很长(几分钟),后几次尝试变稀,不会一直打扰一台已经倒下的服务器。翻倍两头都照顾到了。

## SDK 自己已经会重试了

好消息:你不一定要自己写。openai SDK 默认就会重试,Day 120 提到过一句。它到底怎么重试,我对着这次装到的版本(2026 年 10 月 23 日装的 `openai==3.37.0`)读了源码:

- 常量在 `openai/_constants.py`:`DEFAULT_MAX_RETRIES = 2`,`INITIAL_RETRY_DELAY = 0.5`,`MAX_RETRY_DELAY = 8.0`,`MAX_RETRY_AFTER_DELAY = 2 * 60`。
- 判断「该不该重试」在 `_base_client.py` 的 `_should_retry`:状态码 408、409、429、500 以上重试;响应头有 `x-should-retry: true/false` 时服从它;`Retry-After` 超过 2 分钟的不重试。连接错误和超时也重试。
- 等多久在 `_calculate_retry_timeout`:有合理的 `Retry-After` 就等那么久,否则等 `min(0.5 × 2ⁿ, 8)` 秒,再**乘一个 0.75 到 1 之间的随机数**(也就是随机减少 0 到 25%)。

对照昨天的分类表,SDK 的规则和我们的几乎一样,但粒度粗一些:它只看状态码和 `x-should-retry` 头,不看错误体里的 `code`,所以厂商要是没带 `x-should-retry`,`insufficient_quota` 那种额度用完的 429 也会被它重试(我没在真 OpenAI 上验证过这一点);它也不区分「你的账号」和「厂商」。验证一下它的实际行为。新建 `part02/sdk_retry.py`:

```python
# agent-zero-lab/part02/sdk_retry.py
import time

import openai
from openai import OpenAI
from openai.types.chat import ChatCompletionMessageParam

from part02.fake_llm import FakeServer, fake_server

MESSAGES: list[ChatCompletionMessageParam] = [{"role": "user", "content": "hi"}]


def gaps(server: FakeServer) -> list[float]:
    t = server.arrivals
    return [round(b - a, 2) for a, b in zip(t, t[1:])]


with fake_server() as (url, server):
    client = OpenAI(base_url=url, api_key="sk-fake")
    print("默认 max_retries =", client.max_retries)
    start = time.monotonic()
    try:
        client.chat.completions.create(model="status-503", messages=MESSAGES)
    except openai.InternalServerError as e:
        print(f"默认设置: 服务器收到 {len(server.requests_seen)} 个请求, 间隔 {gaps(server)}, "
              f"{time.monotonic() - start:.1f} 秒后才抛出 {type(e).__name__}")

with fake_server() as (url, server):
    client = OpenAI(base_url=url, api_key="sk-fake", max_retries=6)
    start = time.monotonic()
    try:
        client.chat.completions.create(model="status-503", messages=MESSAGES)
    except openai.InternalServerError:
        print(f"max_retries=6: 收到 {len(server.requests_seen)} 个请求, 间隔 {gaps(server)}, "
              f"共 {time.monotonic() - start:.1f} 秒")

with fake_server() as (url, server):
    client = OpenAI(base_url=url, api_key="sk-fake")
    for model in ["status-401", "status-400", "status-402", "status-409", "status-429", "status-408"]:
        before = len(server.requests_seen)
        try:
            client.chat.completions.create(model=model, messages=MESSAGES)
        except openai.APIStatusError:
            pass
        print(f"{model}: 这一次调用让服务器收到 {len(server.requests_seen) - before} 个请求")
```

<div class="line-notes">

- `from openai.types.chat import ChatCompletionMessageParam` 给下面 `MESSAGES` 标类型,不然编辑器会对 `messages=MESSAGES` 画红线(Day 121 的坑)。
- `from part02.fake_llm import FakeServer, fake_server` 要用 `FakeServer` 这个类型名标注 `gaps` 的参数。
- `MESSAGES: list[ChatCompletionMessageParam] = [{"role": "user", "content": "hi"}]` 所有实验用同一份消息。
- `def gaps(server: FakeServer) -> list[float]:` 算相邻两个请求到达时刻的间隔。
- `t = server.arrivals` 到达时刻列表。
- `return [round(b - a, 2) for a, b in zip(t, t[1:])]` `zip(t, t[1:])` 把列表错开一位配对:`[0.0, 0.43, 1.33]` 变成 `(0.0, 0.43)`、`(0.43, 1.33)`,每对用后一个减前一个,得到 `[0.43, 0.9]`。
- `client = OpenAI(base_url=url, api_key="sk-fake")` 这次**不写** `max_retries`,用 SDK 的默认值。
- `print("默认 max_retries =", client.max_retries)` 实跑 `2`。
- `client.chat.completions.create(model="status-503", messages=MESSAGES)` 假服务器对 `status-503` 永远回 503,一次也不会好。
- `print(f"默认设置: 服务器收到 {len(server.requests_seen)} 个请求, 间隔 {gaps(server)}, "` 实跑收到 3 个请求(1 个原始 + 2 次重试),间隔 `[0.43, 0.9]`,1.4 秒后才抛出异常。0.43 在 0.375 到 0.5 之间(0.5 乘 0.75 到 1),0.9 在 0.75 到 1.0 之间。
- `client = OpenAI(base_url=url, api_key="sk-fake", max_retries=6)` 把重试次数调到 6,为了看到封顶。
- `print(f"max_retries=6: 收到 {len(server.requests_seen)} 个请求, 间隔 {gaps(server)}, "` 实跑 7 个请求,间隔 `[0.4, 0.98, 1.56, 3.39, 6.88, 7.4]`:前四个差不多翻倍(0.4、0.98、1.56、3.39 对应 0.5、1、2、4 打了折);第五个本来就是 0.5 × 16 = 8 秒再打折,6.88;第六个本来该是 16 秒,被封顶压回 8 秒再打折,7.4。一共 20.6 秒。
- `for model in ["status-401", "status-400", "status-402", "status-409", "status-429", "status-408"]:` 同一个客户端(默认重试 2 次),对六种状态码各发一次。
- `before = len(server.requests_seen)` 发之前服务器已收到几个。
- `print(f"{model}: 这一次调用让服务器收到 {len(server.requests_seen) - before} 个请求")` 前后相减,就是这一次调用实际发出去几个请求。

</div>

```bash
uv run python -m part02.sdk_retry
```

这个脚本会跑 20 多秒(那 6 次重试真的在等)。实跑输出:

```text
默认 max_retries = 2
默认设置: 服务器收到 3 个请求, 间隔 [0.43, 0.9], 1.4 秒后才抛出 InternalServerError
max_retries=6: 收到 7 个请求, 间隔 [0.4, 0.98, 1.56, 3.39, 6.88, 7.4], 共 20.6 秒
status-401: 这一次调用让服务器收到 1 个请求
status-400: 这一次调用让服务器收到 1 个请求
status-402: 这一次调用让服务器收到 1 个请求
status-409: 这一次调用让服务器收到 3 个请求
status-429: 这一次调用让服务器收到 3 个请求
status-408: 这一次调用让服务器收到 3 个请求
```

最后六行就是 SDK 的重试清单,和源码对得上:401、400、402 只发 1 个请求,不重试;409、429、408 发了 3 个请求,重试了 2 次。SDK 还有一个我们之后会感谢的细节:它的随机折扣(0.75 到 1)比较小,所以同一时刻失败的客户端重试时刻仍然比较集中,下面「抖动」一节会讲这个。

想知道 SDK 什么时候在重试,可以打开它的日志。SDK 在 `openai` 这个日志名下,重试时记一条 INFO:

```python
import logging
logging.basicConfig(level=logging.INFO, format="%(name)s: %(message)s")
logging.getLogger("httpx2").setLevel(logging.WARNING)
```

上面第三行是把底层 HTTP 库每个请求的一行日志(`HTTP Request: POST ...`)调低,不然会刷屏。再对假服务器的 `status-503` 发一个请求,看到:

```text
openai._base_client: Retrying request in 0.415734 seconds (retry 1 of 2)
openai._base_client: Retrying request in 0.811265 seconds (retry 2 of 2)
```

平时用 SDK 默认的就够了。那为什么还要自己写?三个理由:SDK 不看错误体,分不出 `insufficient_quota` 这种「看起来能重试其实不能」的 429;你想在每次重试时打日志、记指标、发告警,SDK 只在 INFO 日志里留一行;以后换厂商、换 SDK(比如不是 openai 兼容的),重试逻辑还得是你自己的。

## 抖动:别让大家同时醒来

退避还剩一个问题。假设有 100 个客户端在同一秒失败了(厂商抖了一下),它们都「等 0.5 秒再发」,于是 0.5 秒后 100 个请求同时涌回,服务器又倒一次;大家再同时等 1 秒,再同时涌回……每一轮都是一次齐射。这叫**惊群**(thundering herd)。

解法是给等待时间加**随机**,也叫**抖动**(jitter),让这 100 个客户端在时间轴上散开:

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="三个客户端在无抖动和有抖动时的重试时刻对比:无抖动时三个客户端在同样的时刻(0.5、1.5、3.5 秒)一起重试,有抖动时重试时刻分散开">
<rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="24" fill="var(--ink-soft)">无抖动:三个客户端同时失败,同时重试(0、0.5、1.5、3.5 秒)</text>
<line x1="40" y1="108" x2="610" y2="108" stroke="var(--rule)"/>
<line x1="40" y1="40" x2="40" y2="108" stroke="var(--rule)"/>
<line x1="180" y1="40" x2="180" y2="108" stroke="var(--rule)" stroke-dasharray="3 3"/>
<line x1="320" y1="40" x2="320" y2="108" stroke="var(--rule)" stroke-dasharray="3 3"/>
<line x1="460" y1="40" x2="460" y2="108" stroke="var(--rule)" stroke-dasharray="3 3"/>
<g fill="var(--compute)">
<circle cx="40" cy="52" r="5"/><circle cx="110" cy="52" r="5"/><circle cx="250" cy="52" r="5"/><circle cx="530" cy="52" r="5"/>
<circle cx="40" cy="72" r="5"/><circle cx="110" cy="72" r="5"/><circle cx="250" cy="72" r="5"/><circle cx="530" cy="72" r="5"/>
<circle cx="40" cy="92" r="5"/><circle cx="110" cy="92" r="5"/><circle cx="250" cy="92" r="5"/><circle cx="530" cy="92" r="5"/>
</g>
<text x="12" y="56" fill="var(--ink-faint)">A</text>
<text x="12" y="76" fill="var(--ink-faint)">B</text>
<text x="12" y="96" fill="var(--ink-faint)">C</text>
<text x="20" y="150" fill="var(--ink-soft)">完全抖动:等待时间在 0 到上限之间随机(示意图,具体时刻每次不同)</text>
<line x1="40" y1="234" x2="610" y2="234" stroke="var(--rule)"/>
<line x1="40" y1="166" x2="40" y2="234" stroke="var(--rule)"/>
<g fill="var(--mem)">
<circle cx="40" cy="178" r="5"/><circle cx="62" cy="178" r="5"/><circle cx="168" cy="178" r="5"/><circle cx="355" cy="178" r="5"/>
<circle cx="40" cy="198" r="5"/><circle cx="96" cy="198" r="5"/><circle cx="222" cy="198" r="5"/><circle cx="460" cy="198" r="5"/>
<circle cx="40" cy="218" r="5"/><circle cx="54" cy="218" r="5"/><circle cx="124" cy="218" r="5"/><circle cx="405" cy="218" r="5"/>
</g>
<text x="12" y="182" fill="var(--ink-faint)">A</text>
<text x="12" y="202" fill="var(--ink-faint)">B</text>
<text x="12" y="222" fill="var(--ink-faint)">C</text>
<text x="40" y="256" fill="var(--ink-faint)">0 秒</text>
<text x="170" y="256" fill="var(--ink-faint)">1 秒</text>
<text x="310" y="256" fill="var(--ink-faint)">2 秒</text>
<text x="450" y="256" fill="var(--ink-faint)">3 秒</text>
<text x="590" y="256" fill="var(--ink-faint)">4 秒</text>
</g>
</svg>
<figcaption>上面三行的点一列一列对齐:每一列是一次齐射,服务器在那一瞬间要同时吃下三个请求(现实里是几百几千个)。下面三行的点错开了,服务器每一刻只看到零星几个。横轴 1 秒是 140 像素。</figcaption>
</figure>

抖动有几种做法,AWS 架构博客的《Exponential Backoff And Jitter》比较过三种:

- **完全抖动(full jitter)**:等待时间 = 在 0 到 `min(上限, base × 2ⁿ)` 之间随机取。散得最开,但可能随机到很短的等待。
- **一半抖动(equal jitter)**:一半固定、一半随机,等待时间在 `ceiling/2` 到 `ceiling` 之间,至少等一半。
- **SDK 的做法**:在 `ceiling` 上随机减少 0% 到 25%,散得很少,但保证等得够久。

三种我们今天都实现,用同样的 100 个客户端比一比。先写重试函数。

## 写 retry.py

新建 `part02/retry.py`,它会用到昨天的 `classify`:

```python
# agent-zero-lab/part02/retry.py
import random
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal, TypeVar

import openai

from part02.classify import Verdict, classify

T = TypeVar("T")
Jitter = Literal["none", "full", "equal"]


@dataclass(frozen=True)
class RetryPolicy:
    max_attempts: int = 4
    base: float = 0.5
    cap: float = 8.0
    max_wait: float = 60.0
    jitter: Jitter = "full"

    def __post_init__(self) -> None:
        if self.max_attempts < 1:
            raise ValueError(f"max_attempts 至少是 1(只试一次),你给了 {self.max_attempts}")


def backoff_delay(failures: int, policy: RetryPolicy, rng: random.Random) -> float:
    ceiling = min(policy.cap, policy.base * 2**failures)
    if policy.jitter == "full":
        return rng.uniform(0, ceiling)
    if policy.jitter == "equal":
        return ceiling / 2 + rng.uniform(0, ceiling / 2)
    return ceiling


def server_hint(e: BaseException) -> float | None:
    if not isinstance(e, openai.APIStatusError):
        return None
    raw = e.response.headers.get("retry-after")
    if raw is None:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def call_with_retry(
    fn: Callable[[], T],
    policy: RetryPolicy = RetryPolicy(),
    *,
    sleep: Callable[[float], None] = time.sleep,
    rng: random.Random | None = None,
    on_retry: Callable[[int, float, Verdict], None] | None = None,
) -> T:
    rng = rng or random.Random()
    for attempt in range(1, policy.max_attempts + 1):
        try:
            return fn()
        except openai.OpenAIError as e:
            verdict = classify(e)
            if not verdict.retry or attempt == policy.max_attempts:
                raise
            hint = server_hint(e)
            if hint is not None and hint > policy.max_wait:
                raise
            delay = hint if hint is not None else backoff_delay(attempt - 1, policy, rng)
            if on_retry is not None:
                on_retry(attempt, delay, verdict)
            sleep(delay)
    raise AssertionError("到不了这里:__post_init__ 保证了至少试一次")
```

<div class="line-notes">

- `import random` 用 `random.Random` 对象产生随机数。不用模块级的 `random.uniform`,是因为测试要能固定随机种子,Day 112 讲过用自己的生成器比用全局的好。
- `from collections.abc import Callable` 「可以被调用的东西」的类型,函数、lambda 都是。
- `from typing import Literal, TypeVar` `Literal` 是 Day 47 的字面量类型,`TypeVar` 是 [Day 49](/blog/agent-zero/day-049-type-hints-4/) 的泛型变量。
- `from part02.classify import Verdict, classify` 昨天写的分类函数和判断结果。
- `T = TypeVar("T")` 一个类型占位符。`call_with_retry` 不关心被重试的函数返回什么,只要「它返回什么,我就原样返回什么」,用 `T` 把这个关系告诉类型检查器:传进去的函数返回 `ChatCompletion`,`call_with_retry` 就返回 `ChatCompletion`,编辑器能补全 `.choices`。
- `Jitter = Literal["none", "full", "equal"]` 抖动方式只能是这三个字符串之一,写错了编辑器画红线。
- `@dataclass(frozen=True)` 重试策略是配置,建好不能改。
- `max_attempts: int = 4` **总共**最多试几次,包含第一次。4 次就是第一次加最多 3 次重试。区分「尝试次数」和「重试次数」是常见的搞错点,SDK 的 `max_retries=2` 是重试 2 次,总共 3 次。
- `base: float = 0.5` 第一次等待的上限基数,和 SDK 的 `INITIAL_RETRY_DELAY` 一样。
- `cap: float = 8.0` 等待上限,和 SDK 的 `MAX_RETRY_DELAY` 一样。
- `max_wait: float = 60.0` 服务器要求等多久(`Retry-After`)的上限。厂商让你等 300 秒,你的用户不会等 5 分钟,不如直接放弃。SDK 的上限是 120 秒。
- `jitter: Jitter = "full"` 默认完全抖动。
- `def __post_init__(self) -> None:` dataclass 在创建完对象之后自动调用的钩子,拿来检查参数。`frozen=True` 的类里照样能写,只是不能赋值。
- `if self.max_attempts < 1:` 至少试一次,不然函数一次都不调用。
- `raise ValueError(f"max_attempts 至少是 1(只试一次),你给了 {self.max_attempts}")` 在配置错误的时候立刻报错,不要拖到运行时才发现。
- `def backoff_delay(failures: int, policy: RetryPolicy, rng: random.Random) -> float:` 算「第 `failures` 次失败后该等多久」。`failures` 从 0 开始数:第一次失败后是 0。纯函数,不睡觉、不发请求,所以好测。
- `ceiling = min(policy.cap, policy.base * 2**failures)` `2**failures` 是 2 的 failures 次方。`failures=3` 时 0.5 × 8 = 4;`failures=5` 时 0.5 × 32 = 16,被 `min` 压成 8。
- `if policy.jitter == "full":` 完全抖动。
- `return rng.uniform(0, ceiling)` `uniform(a, b)` 在 a 到 b 之间均匀随机取一个小数。`ceiling` 是 4 时,可能得到 0.7,也可能是 3.9。
- `if policy.jitter == "equal":` 一半抖动。
- `return ceiling / 2 + rng.uniform(0, ceiling / 2)` 固定一半加随机一半,结果在 `[ceiling/2, ceiling]`。`ceiling` 是 4 时在 2 到 4 之间。
- `return ceiling` 不抖动,就是纯指数。
- `def server_hint(e: BaseException) -> float | None:` 看看服务器有没有明说「请等 N 秒」。有就返回秒数,没有返回 `None`。
- `if not isinstance(e, openai.APIStatusError):` 只有「服务器回了响应」的错才有响应头,连不上、超时没有。
- `raw = e.response.headers.get("retry-after")` 响应头的名字不区分大小写,`.get` 在没有时返回 `None`。
- `return float(raw)` `Retry-After` 通常是秒数,如 `"3"`。它还可以是一个 HTTP 日期,今天只处理秒数,练习 3 补日期。
- `except ValueError:` `float("明天再来")` 这种转不了的,当成没有。
- `def call_with_retry(` 核心函数。参数换行写,因为多。
- `fn: Callable[[], T],` 被重试的是一个**不带参数、返回 T 的函数**。调用时写 `lambda: client.chat.completions.create(...)`,把真正的请求包成一个「再来一次」的闭包。
- `policy: RetryPolicy = RetryPolicy(),` 不传就用默认策略。默认值是个冻住的对象,不会被改,所以不像 Day 29 的可变默认值陷阱那样危险。
- `*,` 这个星号之后的参数**只能用名字传**。`sleep=...`、`rng=...` 这些是给测试替换用的,强制写名字更清楚。
- `sleep: Callable[[float], None] = time.sleep,` 「怎么睡觉」也作为参数传进来,默认是真的 `time.sleep`。测试时传 `sleeps.append`,就变成「不睡,只记下该睡多久」,10 个测试跑完不到 2 秒。这个手法叫依赖注入,但名字不重要,重要的是:**把会等待的东西做成参数,测试才不用真的等**。
- `rng: random.Random | None = None,` 随机数生成器也可以传。测试时传 `random.Random(0)`,结果可复现。
- `on_retry: Callable[[int, float, Verdict], None] | None = None,` 每次决定重试时的回调,收到(第几次失败,等多久,判断结果)。拿来打日志、记指标,不用改核心函数。
- `rng = rng or random.Random()` 没传就新建一个。
- `for attempt in range(1, policy.max_attempts + 1):` `attempt` 从 1 数到 `max_attempts`,这样「第 1 次失败」和人说的话对得上。
- `return fn()` 成功就直接返回结果,循环结束。
- `except openai.OpenAIError as e:` 只接 SDK 的错(昨天讲的:别的错是你自己的 bug,不重试,让它炸)。
- `verdict = classify(e)` 昨天的分类函数,决定值不值得重试。
- `if not verdict.retry or attempt == policy.max_attempts:` 两种情况直接把原来的错原样抛出去:判断为不可重试(401、400 这类),或者已经是最后一次尝试。`raise` 不带参数是「把刚才接住的那个异常原样再抛一次」,调用方拿到的还是原来的 `AuthenticationError` 或 `InternalServerError`,可以继续用 `classify`。
- `hint = server_hint(e)` 看服务器有没有明说等多久。
- `if hint is not None and hint > policy.max_wait:` 服务器要求等的时间超过我们愿意等的上限。
- `raise` 同样原样抛出,不重试。
- `delay = hint if hint is not None else backoff_delay(attempt - 1, policy, rng)` 有 `Retry-After` 就听服务器的,没有才用自己算的退避。`attempt - 1` 是因为 `attempt` 从 1 开始、`failures` 从 0 开始。
- `if on_retry is not None:` 给了回调才调用。
- `sleep(delay)` 睡觉。睡醒回到 `for` 开头,再试一次。
- `raise AssertionError("到不了这里:__post_init__ 保证了至少试一次")` 循环里每条路径都 `return` 或 `raise`,理论上走不到这一行。写在这里是让类型检查器放心:函数声明了返回 `T`,每条路都得有交代。

</div>

## 用测试钉住它

写测试时有个麻烦:重试意味着等待,等待意味着测试变慢。上面那个 `sleep` 参数就是为了这个。新建 `tests/test_retry.py`:

```python
# agent-zero-lab/tests/test_retry.py
import random
from collections.abc import Iterator

import openai
import pytest
from openai import OpenAI

from part02.fake_llm import FakeServer, fake_server
from part02.retry import Jitter, RetryPolicy, backoff_delay, call_with_retry


@pytest.fixture
def env() -> Iterator[tuple[OpenAI, FakeServer]]:
    with fake_server() as (url, server):
        yield OpenAI(base_url=url, api_key="sk-fake", max_retries=0), server


def call(client: OpenAI, model: str):
    return lambda: client.chat.completions.create(model=model, messages=[{"role": "user", "content": "hi"}])


def test_success_first_try(env: tuple[OpenAI, FakeServer]):
    client, server = env
    sleeps: list[float] = []
    call_with_retry(call(client, "ok"), sleep=sleeps.append)
    assert len(server.requests_seen) == 1 and sleeps == []


def test_retries_429_then_succeeds(env: tuple[OpenAI, FakeServer]):
    client, server = env
    sleeps: list[float] = []
    resp = call_with_retry(call(client, "flaky:429:2"), sleep=sleeps.append, rng=random.Random(0))
    assert resp.choices[0].message.content
    assert len(server.requests_seen) == 3
    assert len(sleeps) == 2 and sleeps[0] <= 0.5 and sleeps[1] <= 1.0


def test_401_is_not_retried(env: tuple[OpenAI, FakeServer]):
    client, server = env
    sleeps: list[float] = []
    with pytest.raises(openai.AuthenticationError):
        call_with_retry(call(client, "status-401"), sleep=sleeps.append)
    assert len(server.requests_seen) == 1 and sleeps == []


def test_gives_up_after_max_attempts(env: tuple[OpenAI, FakeServer]):
    client, server = env
    sleeps: list[float] = []
    with pytest.raises(openai.InternalServerError):
        call_with_retry(call(client, "status-503"), RetryPolicy(max_attempts=3), sleep=sleeps.append)
    assert len(server.requests_seen) == 3 and len(sleeps) == 2


def test_retry_after_header_wins(env: tuple[OpenAI, FakeServer]):
    client, _ = env
    sleeps: list[float] = []
    call_with_retry(call(client, "flaky:429:1:3"), sleep=sleeps.append)
    assert sleeps == [3.0]


def test_retry_after_too_long_gives_up(env: tuple[OpenAI, FakeServer]):
    client, server = env
    sleeps: list[float] = []
    with pytest.raises(openai.RateLimitError):
        call_with_retry(call(client, "flaky:429:1:300"), sleep=sleeps.append)
    assert len(server.requests_seen) == 1 and sleeps == []


def test_backoff_without_jitter_doubles_then_caps():
    policy = RetryPolicy(jitter="none")
    delays = [backoff_delay(n, policy, random.Random(0)) for n in range(7)]
    assert delays == [0.5, 1.0, 2.0, 4.0, 8.0, 8.0, 8.0]


@pytest.mark.parametrize("mode, low_ratio", [("full", 0.0), ("equal", 0.5)])
def test_jitter_stays_in_range(mode: Jitter, low_ratio: float):
    policy = RetryPolicy(jitter=mode)
    rng = random.Random(42)
    for n in range(6):
        ceiling = min(8.0, 0.5 * 2**n)
        for _ in range(200):
            assert ceiling * low_ratio <= backoff_delay(n, policy, rng) <= ceiling


def test_policy_needs_at_least_one_attempt():
    with pytest.raises(ValueError, match="至少是 1"):
        RetryPolicy(max_attempts=0)
```

<div class="line-notes">

- `from part02.fake_llm import FakeServer, fake_server` 今天改过的假服务器。
- `from part02.retry import Jitter, RetryPolicy, backoff_delay, call_with_retry` 要测的东西。`Jitter` 是类型,给参数化测试的参数标类型用。
- `@pytest.fixture` 这次没写 `scope`,默认是「每个测试一份」。每个测试都要一台干净的假服务器,`requests_seen` 才是这个测试自己的。
- `def env() -> Iterator[tuple[OpenAI, FakeServer]]:` 返回(客户端,服务器)一对。`max_retries=0` 关掉 SDK 自己的重试,我们只测自己的。
- `def call(client: OpenAI, model: str):` 一个辅助函数,返回「再来一次」的闭包,省得每个测试都写一遍 `lambda`。
- `sleeps: list[float] = []` 收集「本来该睡多久」的列表。
- `call_with_retry(call(client, "ok"), sleep=sleeps.append)` `sleeps.append` 是列表的 `append` 方法,当作「睡觉函数」传进去:函数想睡 0.3 秒,实际上是把 0.3 加进列表,不会真的睡。
- `assert len(server.requests_seen) == 1 and sleeps == []` 第一次就成功:服务器收到 1 个请求,没睡过觉。
- `call_with_retry(call(client, "flaky:429:2"), sleep=sleeps.append, rng=random.Random(0))` 前两次 429,第三次成功。种子固定,结果可复现。
- `assert len(sleeps) == 2 and sleeps[0] <= 0.5 and sleeps[1] <= 1.0` 睡了两次;第一次不会超过 0.5(`base`),第二次不会超过 1.0(`base × 2`)。完全抖动下具体值随机,但上界是确定的。
- `with pytest.raises(openai.AuthenticationError):` 401 不重试,原样把 `AuthenticationError` 抛出来。
- `assert len(server.requests_seen) == 1 and sleeps == []` 服务器只收到 1 个请求,没睡过。这条断言是今天最重要的一条:**不该重试的错,一次都不能多发**。
- `RetryPolicy(max_attempts=3)` 总共 3 次。
- `assert len(server.requests_seen) == 3 and len(sleeps) == 2` 3 次尝试之间只有 2 次等待,最后一次失败之后不再睡觉,直接抛出。
- `call_with_retry(call(client, "flaky:429:1:3"), sleep=sleeps.append)` 服务器第一次回 429,带 `Retry-After: 3`。
- `assert sleeps == [3.0]` 只睡了一次,而且正好是服务器要求的 3 秒,不是我们自己算的退避。
- `with pytest.raises(openai.RateLimitError):` 这一条要求直接放弃,把 429 抛出来。
- `call_with_retry(call(client, "flaky:429:1:300"), sleep=sleeps.append)` `Retry-After: 300`,超过了默认的 60 秒上限。
- `policy = RetryPolicy(jitter="none")` 不抖动,结果是确定的。
- `delays = [backoff_delay(n, policy, random.Random(0)) for n in range(7)]` 失败 0 到 6 次后各等多久。
- `assert delays == [0.5, 1.0, 2.0, 4.0, 8.0, 8.0, 8.0]` 翻倍,到 8 封顶,和文章前面那张表一致。
- `@pytest.mark.parametrize("mode, low_ratio", [("full", 0.0), ("equal", 0.5)])` 同一个测试跑两遍:完全抖动的下界是 0 倍上限,一半抖动的下界是 0.5 倍上限。
- `for _ in range(200):` 每个档位随机取 200 次。随机的东西不能只测一次,但种子固定(42),所以每次跑结果还是一样。
- `assert ceiling * low_ratio <= backoff_delay(n, policy, rng) <= ceiling` Python 的连续比较:下界 ≤ 结果 ≤ 上界。
- `with pytest.raises(ValueError, match="至少是 1"):` `max_attempts=0` 创建对象时就报错。

</div>

先犯一个很自然的错。我第一次写 `call_with_retry` 时,以为「`classify` 已经在 `retry` 字段里判过了」,在 `except` 里只写了 `if attempt == policy.max_attempts: raise`,把 `not verdict.retry` 那半句漏了。你可以临时把这一行改成那样,跑测试:

```bash
uv run pytest tests/test_retry.py -q
```

```text
..F.......                                                               [100%]
=================================== FAILURES ===================================
___________________________ test_401_is_not_retried ____________________________

env = (<openai.OpenAI object at 0x1032c4950>, <part02.fake_llm.FakeServer object at 0x1038af830>)

    def test_401_is_not_retried(env: tuple[OpenAI, FakeServer]):
        client, server = env
        sleeps: list[float] = []
        with pytest.raises(openai.AuthenticationError):
            call_with_retry(call(client, "status-401"), sleep=sleeps.append)
>       assert len(server.requests_seen) == 1 and sleeps == []
E       AssertionError: assert (4 == 1)
E        +  where 4 = len(['status-401', 'status-401', 'status-401', 'status-401'])
E        +    where ['status-401', 'status-401', 'status-401', 'status-401'] = <part02.fake_llm.FakeServer object at 0x1038af830>.requests_seen

tests/test_retry.py:44: AssertionError
=========================== short test summary info ============================
FAILED tests/test_retry.py::test_401_is_not_retried - AssertionError: assert ...
1 failed, 9 passed in 5.00s
```

10 个里只挂 1 个,而且最有意思的是:**挂的这一个测试,在没有这条断言时是会通过的**。`pytest.raises(openai.AuthenticationError)` 满足了:4 次之后还是抛出了 `AuthenticationError`。只有「服务器收到几个请求」这条断言才看得出这个 bug,代价是对着一个真实厂商狂发 4 次错误的 key,对有的厂商这还会触发风控。**测重试,断言要写在「发了几个请求」上,而不是只写「最后抛了什么」。** 改回去:

```bash
uv run pytest tests/test_retry.py -v
```

```text
tests/test_retry.py::test_success_first_try PASSED
tests/test_retry.py::test_retries_429_then_succeeds PASSED
tests/test_retry.py::test_401_is_not_retried PASSED
tests/test_retry.py::test_gives_up_after_max_attempts PASSED
tests/test_retry.py::test_retry_after_header_wins PASSED
tests/test_retry.py::test_retry_after_too_long_gives_up PASSED
tests/test_retry.py::test_backoff_without_jitter_doubles_then_caps PASSED
tests/test_retry.py::test_jitter_stays_in_range[full-0.0] PASSED
tests/test_retry.py::test_jitter_stays_in_range[equal-0.5] PASSED
tests/test_retry.py::test_policy_needs_at_least_one_attempt PASSED
============================== 10 passed in 1.54s ==============================
```

10 个全过,总共不到 2 秒:假服务器是本机的,`sleep` 是假的。

## 跑一遍看看日志

用 `on_retry` 回调把每次重试的决定打印出来。新建 `part02/demo_retry.py`,四个模型名四种情形,策略的 `base` 调小(0.2 秒、封顶 1 秒),睡觉用真的,看得见流程:

```python
# agent-zero-lab/part02/demo_retry.py
import random

import openai
from openai import OpenAI

from part02.classify import Verdict
from part02.fake_llm import fake_server
from part02.retry import RetryPolicy, call_with_retry

POLICY = RetryPolicy(max_attempts=4, base=0.2, cap=1.0)


def log(attempt: int, delay: float, v: Verdict) -> None:
    print(f"  第 {attempt} 次失败 [{v.kind} {v.status}],等 {delay:.2f} 秒再试")


def run(model: str) -> None:
    with fake_server() as (url, server):
        client = OpenAI(base_url=url, api_key="sk-fake", max_retries=0)
        print(f"{model}:")
        try:
            resp = call_with_retry(
                lambda: client.chat.completions.create(model=model, messages=[{"role": "user", "content": "hi"}]),
                POLICY, rng=random.Random(7), on_retry=log,
            )
            print(f"  成功: {resp.choices[0].message.content}")
        except openai.OpenAIError as e:
            print(f"  放弃: {type(e).__name__}")
        print(f"  服务器一共收到 {len(server.requests_seen)} 个请求")


for m in ["flaky:429:2", "status-401", "status-503", "flaky:429:1:2"]:
    run(m)
```

<div class="line-notes">

- `POLICY = RetryPolicy(max_attempts=4, base=0.2, cap=1.0)` 最多 4 次,等待基数 0.2 秒、封顶 1 秒。比默认的小,演示不用等太久。
- `def log(attempt: int, delay: float, v: Verdict) -> None:` 符合 `on_retry` 回调的形状:(第几次失败,等多久,判断结果)。
- `print(f"  第 {attempt} 次失败 [{v.kind} {v.status}],等 {delay:.2f} 秒再试")` 把昨天 `Verdict` 里的 `kind` 和 `status` 直接用上了。
- `def run(model: str) -> None:` 对一个模型名走一遍,打印发生了什么。
- `lambda: client.chat.completions.create(model=model, messages=[{"role": "user", "content": "hi"}]),` 把一次请求包成闭包交给 `call_with_retry`。
- `POLICY, rng=random.Random(7), on_retry=log,` 固定随机种子 7,每次运行抖动出来的数一样。
- `print(f"  成功: {resp.choices[0].message.content}")` 假服务器的成功回答是「假服务器说:你好」。
- `except openai.OpenAIError as e:` 重试用光、或不该重试,原来的错抛到这里。
- `print(f"  服务器一共收到 {len(server.requests_seen)} 个请求")` 用服务器那边的计数核对:客户端说试了几次,服务器真收到几个。
- `for m in ["flaky:429:2", "status-401", "status-503", "flaky:429:1:2"]:` 四种情形:前两次 429 然后好、401、永远 503、带 `Retry-After: 2` 的 429。

</div>

```bash
uv run python -m part02.demo_retry
```

```text
flaky:429:2:
  第 1 次失败 [太快了 429],等 0.06 秒再试
  第 2 次失败 [太快了 429],等 0.06 秒再试
  成功: 假服务器说:你好
  服务器一共收到 3 个请求
status-401:
  放弃: AuthenticationError
  服务器一共收到 1 个请求
status-503:
  第 1 次失败 [厂商 503],等 0.06 秒再试
  第 2 次失败 [厂商 503],等 0.06 秒再试
  第 3 次失败 [厂商 503],等 0.52 秒再试
  放弃: InternalServerError
  服务器一共收到 4 个请求
flaky:429:1:2:
  第 1 次失败 [太快了 429],等 2.00 秒再试
  成功: 假服务器说:你好
  服务器一共收到 2 个请求
```

四种情形各一个结论:

- `flaky:429:2` 失败两次、第三次成功,服务器收到 3 个请求。注意两次等待都是 0.06 秒,是完全抖动随机到的小数(上限本来是 0.2 和 0.4),种子 7 恰好这么巧。**完全抖动可能随机出很短的等待,这是它的代价**,下面比较三种抖动时会回到这点。
- `status-401` 一个请求,不重试,直接放弃,和昨天分类一致。
- `status-503` 永远失败:4 次尝试、3 次等待(0.06、0.06、0.52),服务器收到 4 个请求。最后抛出的还是 `InternalServerError`。
- `flaky:429:1:2` 服务器说「等 2 秒」,我们等的就是 2.00 秒,不是自己算的 0.xx 秒。

## 抖动到底有没有用:100 个客户端

回头验证前面画的那张示意图。新建 `part02/herd.py`:100 个客户端同时失败,服务器一直不好,每个客户端各自按策略算重试时刻;统计每 0.1 秒窗口里同时到达的请求数,看四轮重试各自的峰值。

```python
# agent-zero-lab/part02/herd.py
import random
from collections import Counter

from part02.retry import Jitter, RetryPolicy, backoff_delay

CLIENTS = 100
ROUNDS = 4
WINDOW = 0.1


def retry_times(jitter: Jitter, seed: int = 1) -> list[list[float]]:
    rng = random.Random(seed)
    policy = RetryPolicy(max_attempts=99, base=0.5, cap=8.0, jitter=jitter)
    clock = [0.0] * CLIENTS
    rounds: list[list[float]] = []
    for failures in range(ROUNDS):
        for i in range(CLIENTS):
            clock[i] += backoff_delay(failures, policy, rng)
        rounds.append(list(clock))
    return rounds


def peak(times: list[float]) -> int:
    return max(Counter(int(t / WINDOW) for t in times).values())


if __name__ == "__main__":
    for jitter in ("none", "full", "equal"):
        rounds = retry_times(jitter)
        peaks = [peak(r) for r in rounds]
        spans = [f"{min(r):.1f}–{max(r):.1f}" for r in rounds]
        print(f"jitter={jitter:5} 每轮重试时刻范围 {spans}")
        print(f"             每 {WINDOW} 秒窗口里同时来的请求数,最高 {peaks}")
```

<div class="line-notes">

- `from collections import Counter` 数每个窗口里有几个请求。
- `from part02.retry import Jitter, RetryPolicy, backoff_delay` 直接用今天写的 `backoff_delay`,不是另写一套,保证模拟的和真代码是同一个算法。
- `CLIENTS = 100` 一百个客户端。
- `ROUNDS = 4` 模拟四轮重试。
- `WINDOW = 0.1` 把时间切成每 0.1 秒一格,看每格里同时来多少。
- `def retry_times(jitter: Jitter, seed: int = 1) -> list[list[float]]:` 返回四轮重试每个客户端的重试时刻。外层列表是轮次,里层是 100 个客户端。
- `rng = random.Random(seed)` 固定种子,每次运行结果一样。
- `policy = RetryPolicy(max_attempts=99, base=0.5, cap=8.0, jitter=jitter)` 策略是 SDK 同款参数(0.5 起、8 封顶),`max_attempts` 在这里不起作用,随便写个大的。
- `clock = [0.0] * CLIENTS` 每个客户端自己的「现在几点」,都从 0 开始,同时失败。`[0.0] * 100` 是 100 个 0.0 的列表。
- `for failures in range(ROUNDS):` 第 0 轮、第 1 轮、……
- `clock[i] += backoff_delay(failures, policy, rng)` 每个客户端按自己抽到的等待时间往后推。没有抖动时,所有人加同一个数,所以永远同步;有抖动时,每个人加不同的数,慢慢散开。
- `rounds.append(list(clock))` 存下这一轮每个人的重试时刻。`list(clock)` 是复制一份,不然后面继续改的 `clock` 会把存下的也改掉。
- `def peak(times: list[float]) -> int:` 把时刻按 0.1 秒切格子,返回最挤的那格里有几个。
- `Counter(int(t / WINDOW) for t in times).values()` 每个时刻除以 0.1 取整,得到「第几格」;`Counter` 数每格有几个;`.values()` 是各格的个数;外面的 `max` 取最大。
- `if __name__ == "__main__":` 练习 4 要导入这个文件里的函数,加 main guard 导入时才不会先把结果打印一遍。
- `spans = [f"{min(r):.1f}–{max(r):.1f}" for r in rounds]` 每轮重试时刻的范围,最早到最晚。

</div>

```bash
uv run python -m part02.herd
```

```text
jitter=none  每轮重试时刻范围 ['0.5–0.5', '1.5–1.5', '3.5–3.5', '7.5–7.5']
             每 0.1 秒窗口里同时来的请求数,最高 [100, 100, 100, 100]
jitter=full  每轮重试时刻范围 ['0.0–0.5', '0.1–1.3', '0.3–3.2', '1.0–6.5']
             每 0.1 秒窗口里同时来的请求数,最高 [30, 13, 8, 7]
jitter=equal 每轮重试时刻范围 ['0.3–0.5', '0.8–1.4', '1.9–3.4', '4.2–7.0']
             每 0.1 秒窗口里同时来的请求数,最高 [47, 21, 16, 10]
```

结果一看就懂:

- **不抖动**:每一轮 100 个客户端的重试时刻是同一个数(0.5、1.5、3.5、7.5 秒),每 0.1 秒窗口里**同时来 100 个**,四轮都是,服务器每次被齐射。
- **完全抖动**:第一轮重试散在 0 到 0.5 秒,峰值 30;之后每轮越散越开,到第四轮,100 个请求摊在 1.0 到 6.5 秒之间,每 0.1 秒窗口最多 7 个。**服务器看到的是细水长流,不是脉冲。**
- **一半抖动**:介于两者之间(47、21、16、10),但保证每个客户端至少等一半,不会出现「随机到 0.02 秒就又发了」的情况。

三种抖动的代价是什么?再对比一下平均等待时间。这是练习 4,答案里有数字:完全抖动平均等得最短(第一次 0.25 秒),不抖动最长(0.5 秒),一半抖动在中间。**选哪种看场景**:一个客户端调一家厂商的小项目,什么都行;几百个客户端同时打一个服务,完全抖动最好(AWS 博客的结论也是它);一个人用、延迟敏感,SDK 那种小幅度抖动够了。我默认选完全抖动,因为它实现最简单,而且上面的实测证明它散得最开。

## 叠在一起的重试:一次失败变成 9 个请求

最后一个坑,很多人都踩。openai SDK 默认已经重试 2 次,你自己又包了一层 `call_with_retry`(3 次尝试),两层叠在一起会发生什么?我们的 `call_with_retry` 每次调用 `client.chat.completions.create`,而 `create` 里面 SDK 又会重试 2 次:

<figure>
<svg viewBox="0 0 640 190" role="img" aria-label="两层重试叠加:外层自己写的 3 次尝试,每一次内层 SDK 又发 3 个请求,一共 9 个请求">
<rect x="0" y="0" width="640" height="190" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink-soft)">外层:call_with_retry,max_attempts=3</text>
<rect x="20" y="40" width="190" height="86" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="30" y="58" fill="var(--ink)">第 1 次尝试</text>
<rect x="30" y="68" width="50" height="40" rx="3" fill="none" stroke="var(--mem)"/>
<rect x="90" y="68" width="50" height="40" rx="3" fill="none" stroke="var(--mem)"/>
<rect x="150" y="68" width="50" height="40" rx="3" fill="none" stroke="var(--mem)"/>
<text x="55" y="92" text-anchor="middle" fill="var(--ink-soft)">请求</text>
<text x="115" y="92" text-anchor="middle" fill="var(--ink-soft)">重试</text>
<text x="175" y="92" text-anchor="middle" fill="var(--ink-soft)">重试</text>
<rect x="225" y="40" width="190" height="86" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="235" y="58" fill="var(--ink)">第 2 次尝试</text>
<rect x="235" y="68" width="50" height="40" rx="3" fill="none" stroke="var(--mem)"/>
<rect x="295" y="68" width="50" height="40" rx="3" fill="none" stroke="var(--mem)"/>
<rect x="355" y="68" width="50" height="40" rx="3" fill="none" stroke="var(--mem)"/>
<text x="260" y="92" text-anchor="middle" fill="var(--ink-soft)">请求</text>
<text x="320" y="92" text-anchor="middle" fill="var(--ink-soft)">重试</text>
<text x="380" y="92" text-anchor="middle" fill="var(--ink-soft)">重试</text>
<rect x="430" y="40" width="190" height="86" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="440" y="58" fill="var(--ink)">第 3 次尝试</text>
<rect x="440" y="68" width="50" height="40" rx="3" fill="none" stroke="var(--mem)"/>
<rect x="500" y="68" width="50" height="40" rx="3" fill="none" stroke="var(--mem)"/>
<rect x="560" y="68" width="50" height="40" rx="3" fill="none" stroke="var(--mem)"/>
<text x="465" y="92" text-anchor="middle" fill="var(--ink-soft)">请求</text>
<text x="525" y="92" text-anchor="middle" fill="var(--ink-soft)">重试</text>
<text x="585" y="92" text-anchor="middle" fill="var(--ink-soft)">重试</text>
<text x="20" y="150" fill="var(--ink-soft)">内层(蓝框):SDK 默认 max_retries=2,一次 create 最多发 3 个请求</text>
<text x="20" y="172" fill="var(--ink)">3 × 3 = 9 个请求,耗时也是两层等待相加</text>
</g>
</svg>
<figcaption>琥珀色是自己写的外层,蓝框是 SDK 内层的每一个请求。外层以为自己只试了 3 次,服务器实际收到 9 个。</figcaption>
</figure>

新建 `part02/stacked_retry.py` 验证:

```python
# agent-zero-lab/part02/stacked_retry.py
import time

import openai
from openai import OpenAI

from part02.fake_llm import fake_server
from part02.retry import RetryPolicy, call_with_retry

POLICY = RetryPolicy(max_attempts=3, base=0.05, cap=0.2)

for sdk_retries in (2, 0):
    with fake_server() as (url, server):
        client = OpenAI(base_url=url, api_key="sk-fake", max_retries=sdk_retries)
        start = time.monotonic()
        try:
            call_with_retry(
                lambda: client.chat.completions.create(model="status-503", messages=[{"role": "user", "content": "hi"}]),
                POLICY,
            )
        except openai.InternalServerError:
            pass
        print(f"SDK max_retries={sdk_retries}, 自己写的 max_attempts=3: "
              f"服务器收到 {len(server.requests_seen)} 个请求, 用了 {time.monotonic() - start:.1f} 秒")
```

<div class="line-notes">

- `POLICY = RetryPolicy(max_attempts=3, base=0.05, cap=0.2)` 外层策略:3 次尝试,等待很短(0.05 起、0.2 封顶),让外层的等待不盖过内层的。
- `for sdk_retries in (2, 0):` 两种配置:2 是 SDK 默认值,0 是关掉 SDK 重试。
- `client = OpenAI(base_url=url, api_key="sk-fake", max_retries=sdk_retries)` 内层重试次数从循环变量来。
- `call_with_retry(` 外层重试,包住 `create`。
- `lambda: client.chat.completions.create(model="status-503", messages=[{"role": "user", "content": "hi"}]),` 永远 503。
- `except openai.InternalServerError:` 最后抛出来的是 503,吞掉,只关心数字。
- `print(f"SDK max_retries={sdk_retries}, 自己写的 max_attempts=3: "` 实跑第一行 9 个请求、用 4.3 秒,第二行 3 个请求、用 0.1 秒。
- `f"服务器收到 {len(server.requests_seen)} 个请求, 用了 {time.monotonic() - start:.1f} 秒")` 两个维度一起看:请求数和耗时。

</div>

```bash
uv run python -m part02.stacked_retry
```

```text
SDK max_retries=2, 自己写的 max_attempts=3: 服务器收到 9 个请求, 用了 4.3 秒
SDK max_retries=0, 自己写的 max_attempts=3: 服务器收到 3 个请求, 用了 0.1 秒
```

默认配置下,「最多试 3 次」的承诺变成了 9 个请求,耗时 4.3 秒(内层每轮要等 0.4 + 0.9 秒左右,三轮);关掉 SDK 重试后,3 个请求,0.1 秒。9 个请求对「额度」「限速」「账单」都是伤害,**更糟的是,你看日志以为只重试了 3 次**。规则很简单:**重试只放一层**。要么相信 SDK(默认的就行,不写 `call_with_retry`),要么自己写(给 SDK 设 `max_retries=0`)。昨天的 `ask_safe.py` 和今天的 `ask_retry.py` 用的都是后者。

## 接到真 API 上

把重试放进真调用。新建 `part02/ask_retry.py`,是昨天 `ask_safe.py` 的升级版:`max_retries=0`、自己重试,每次重试在标准错误里打一行:

```python
# agent-zero-lab/part02/ask_retry.py
import json
import os
import sys

import openai
from dotenv import load_dotenv
from openai import OpenAI

from part02.classify import Verdict, classify
from part02.retry import RetryPolicy, call_with_retry
from part02.week18_lab import IncompleteAnswer, read_answer

load_dotenv(os.environ.get("ENV_FILE", ".env"), override=True)
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"], max_retries=0, timeout=30)
extra_body = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
question = sys.argv[1] if len(sys.argv) > 1 else "用一句话介绍你自己"


def log(attempt: int, delay: float, v: Verdict) -> None:
    print(f"第 {attempt} 次失败 [{v.kind}],{delay:.2f} 秒后重试", file=sys.stderr)


def ask() -> str:
    resp = call_with_retry(
        lambda: client.chat.completions.create(
            model=os.environ["LLM_MODEL"],
            messages=[{"role": "user", "content": question}],
            max_tokens=300,
            extra_body=extra_body,
        ),
        RetryPolicy(max_attempts=4, base=0.5, cap=4.0),
        on_retry=log,
    )
    return read_answer(resp)


try:
    print(ask())
except IncompleteAnswer as e:
    print(f"模型没说完({e})", file=sys.stderr)
    sys.exit(2)
except openai.OpenAIError as e:
    v = classify(e)
    print(f"放弃了 [{v.kind}]:{v.advice}", file=sys.stderr)
    sys.exit(3 if v.retry else 2)
```

<div class="line-notes">

- `from part02.retry import RetryPolicy, call_with_retry` 今天写的。
- `client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"], max_retries=0, timeout=30)` `max_retries=0` 就是上面「只放一层」的落实,`timeout=30` 是每一次请求最长等 30 秒(昨天讲过默认 600 秒太长)。
- `def log(attempt: int, delay: float, v: Verdict) -> None:` 回调,把每次重试写到标准错误。
- `print(f"第 {attempt} 次失败 [{v.kind}],{delay:.2f} 秒后重试", file=sys.stderr)` 打到 stderr,不混进正常回答。
- `def ask() -> str:` 把「请求 + 检查是否说完」放进一个函数。
- `resp = call_with_retry(` 只重试真正发请求这一步。
- `RetryPolicy(max_attempts=4, base=0.5, cap=4.0),` 总共最多 4 次,等待上限 4 秒。一个交互式的命令行不想让用户等太久,所以 cap 比默认的小。
- `on_retry=log,` 每次重试时调用 `log`。
- `return read_answer(resp)` 请求成功之后再检查 `finish_reason`。**没说完不是网络问题,重试它没有意义**(`max_tokens` 不够,再发还是不够),所以放在重试外面,让 `IncompleteAnswer` 直接往外冒。
- `except IncompleteAnswer as e:` 没说完,退出码 2。
- `except openai.OpenAIError as e:` 重试用光或本来就不可重试的 SDK 错误。
- `sys.exit(3 if v.retry else 2)` 昨天定的退出码:可重试的退出 3(说明已经重试过了仍失败),不可重试的退出 2。

</div>

三种配置各跑一次,`.env.badkey` 和 `.env.nohost` 是昨天建的:

```bash
for f in .env .env.badkey .env.nohost; do
  echo "\$ ENV_FILE=$f uv run python -m part02.ask_retry"
  ENV_FILE=$f uv run python -m part02.ask_retry "发票抬头开错了能改吗?一句话回答。" 2>&1
  echo "exit=$?"
done
```

实跑输出:

```text
$ ENV_FILE=.env uv run python -m part02.ask_retry
可以，但需区分情况：当月且未认证/未跨月可直接作废重开；跨月或已认证需开具红字发票冲销后重开。
exit=0
$ ENV_FILE=.env.badkey uv run python -m part02.ask_retry
放弃了 [你的账号]:key 不对或已作废:检查配置文件里的 LLM_API_KEY
exit=2
$ ENV_FILE=.env.nohost uv run python -m part02.ask_retry
第 1 次失败 [网络],0.21 秒后重试
第 2 次失败 [网络],0.12 秒后重试
第 3 次失败 [网络],0.03 秒后重试
放弃了 [网络]:没连上:检查网络、代理和 LLM_BASE_URL
exit=3
```

三种结局:正常的一次成功,退出 0;假 key 一次都不重试,直接放弃,退出 2;没人监听的地址重试了 3 次(等 0.21、0.12、0.03 秒)然后放弃,退出 3。第三种每次等的时间都很短,因为本机连接被拒绝立刻返回,而且完全抖动随机到了很小的数。对真实网络问题,这几个等待会更长:前面看到的 `0.5 × 2ⁿ` 上限在 `cap=4.0` 之内。

**这段没在真 API 上实跑的部分**:真正的 429 和 503。DeepSeek 的 429 需要你的账号并发超过 2500(`deepseek-flash`)才会触发,503 是厂商的故障,没法按需触发。这两种的行为我是用假服务器验证的,假服务器的响应形状和 DeepSeek 的错误体一致,但真实世界里有没有别的细节(比如有没有 `Retry-After` 头),我没验证过。

### 以后会碰到的:tenacity

Python 社区有个很流行的重试库叫 [tenacity](https://github.com/jd/tenacity),用装饰器写重试:`@retry(stop=stop_after_attempt(4), wait=wait_exponential_jitter(initial=0.5, max=8))`。它做的事和今天我们手写的 `call_with_retry` 一样。[Day 190](/blog/agent-zero/day-190-failures-2/) 会学它。先手写一遍的好处是,你知道那几个参数各自对应什么,别人的项目里写了 `wait_exponential_jitter` 你不会觉得是黑魔法。

### 零件 → 大代码对照

| 零件 | 在哪 | 做什么 |
| --- | --- | --- |
| 假服务器的 `flaky`、`down`、`arrivals` | `fake_llm.py` | 造「失败几次后成功」「故障一阵后恢复」,并记到达时刻 |
| 立刻重试 vs 翻倍等待 | `naive_retry.py` | 428 对 4 个请求 |
| SDK 重试规则 | `sdk_retry.py` + 源码常量 | 2 次、0.5 起翻倍、封顶 8、认 `Retry-After` |
| `RetryPolicy`、`backoff_delay` | `retry.py` | 策略和等待时间算法,纯函数 |
| `call_with_retry` | `retry.py` | 只重试 `classify` 判为可重试的,认 `Retry-After`,抛原错 |
| 10 个测试 | `tests/test_retry.py` | 不真等待,断言「发了几个请求」 |
| 抖动对比 | `herd.py` | 100 个客户端的峰值 |
| 叠加陷阱 | `stacked_retry.py` | 9 对 3 |
| 命令行接入 | `ask_retry.py` | 退出码 0 / 2 / 3 |

## 动手练习

**练习 1:模拟 429 重试。** 写 `part02/sim_429.py`:用假服务器的 `flaky:429:3`(前 3 次 429,第 4 次成功),策略是 `RetryPolicy(max_attempts=5, base=0.3, cap=2.0, jitter="none")`,睡觉用真的。打印服务器收到每个请求的时刻(从第一个算起)和相邻间隔,验证间隔就是 0.3、0.6、1.2。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/sim_429.py
from openai import OpenAI

from part02.fake_llm import fake_server
from part02.retry import RetryPolicy, call_with_retry

POLICY = RetryPolicy(max_attempts=5, base=0.3, cap=2.0, jitter="none")

with fake_server() as (url, server):
    client = OpenAI(base_url=url, api_key="sk-fake", max_retries=0)
    resp = call_with_retry(
        lambda: client.chat.completions.create(model="flaky:429:3", messages=[{"role": "user", "content": "hi"}]),
        POLICY,
    )
    print("最后拿到:", resp.choices[0].message.content)
    first = server.arrivals[0]
    stamps = [round(t - first, 2) for t in server.arrivals]
    print("服务器收到请求的时刻(秒,从第一个算起):", stamps)
    print("相邻间隔:", [round(b - a, 2) for a, b in zip(stamps, stamps[1:])])
```

<div class="line-notes">

- `POLICY = RetryPolicy(max_attempts=5, base=0.3, cap=2.0, jitter="none")` 不抖动,等待时间是确定的 `0.3 × 2ⁿ`。最多 5 次尝试,比需要的 4 次多一次余量。
- `model="flaky:429:3"` 前 3 次 429,第 4 次起正常。
- `first = server.arrivals[0]` 第一个请求到达的时刻。服务器启动后线程要一点时间才开始收请求,所以绝对时刻不是从 0 开始,减去第一个才是「从第一个请求算起」。
- `stamps = [round(t - first, 2) for t in server.arrivals]` 每个请求相对第一个请求的时刻。
- `print("相邻间隔:", [round(b - a, 2) for a, b in zip(stamps, stamps[1:])])` 错开一位配对再相减。

</div>

```bash
uv run python -m part02.sim_429
```

```text
最后拿到: 假服务器说:你好
服务器收到请求的时刻(秒,从第一个算起): [0.0, 0.31, 0.92, 2.12]
相邻间隔: [0.31, 0.61, 1.2]
```

间隔 0.31、0.61、1.2,比 0.3、0.6、1.2 多出的零头是发请求本身的耗时和 `sleep` 的误差。4 个请求,3 次等待,第 4 个成功,服务器的到达时刻和我们算的一致。

</details>

**练习 2:总时限。** 重试次数限制是「最多几次」,但对用户来说更重要的是「最多等几秒」。写 `part02/deadline_retry.py`,函数 `call_with_deadline(fn, policy, deadline, *, sleep, clock, rng)`:和 `call_with_retry` 一样,但如果「已经用掉的时间 + 下一次要等的时间」超过 `deadline`,就不再等,直接抛出最后一个错。对永远 503 的假服务器,`max_attempts=10`、`deadline=3.0`、不抖动、`base=0.5`,看它发几次、几秒后放弃。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/deadline_retry.py
import random
import time
from collections.abc import Callable
from typing import TypeVar

import openai
from openai import OpenAI

from part02.classify import classify
from part02.fake_llm import fake_server
from part02.retry import RetryPolicy, backoff_delay

T = TypeVar("T")


def call_with_deadline(
    fn: Callable[[], T],
    policy: RetryPolicy,
    deadline: float,
    *,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
    rng: random.Random | None = None,
) -> T:
    rng = rng or random.Random()
    start = clock()
    for attempt in range(1, policy.max_attempts + 1):
        try:
            return fn()
        except openai.OpenAIError as e:
            if not classify(e).retry or attempt == policy.max_attempts:
                raise
            delay = backoff_delay(attempt - 1, policy, rng)
            if clock() - start + delay > deadline:
                raise
            sleep(delay)
    raise AssertionError("到不了这里")


if __name__ == "__main__":
    policy = RetryPolicy(max_attempts=10, base=0.5, cap=8.0, jitter="none")
    with fake_server() as (url, server):
        client = OpenAI(base_url=url, api_key="sk-fake", max_retries=0)
        begin = time.monotonic()
        try:
            call_with_deadline(
                lambda: client.chat.completions.create(model="status-503", messages=[{"role": "user", "content": "hi"}]),
                policy, deadline=3.0,
            )
        except openai.InternalServerError:
            took = time.monotonic() - begin
            print(f"最多允许 10 次、总时限 3 秒: 发了 {len(server.requests_seen)} 次,{took:.1f} 秒后放弃")
```

<div class="line-notes">

- `clock: Callable[[], float] = time.monotonic,` 和 `sleep` 一样,把「现在几点」做成参数,测试时可以传一个假钟。
- `start = clock()` 记下开始的时刻。
- `if not classify(e).retry or attempt == policy.max_attempts:` 和 `call_with_retry` 一样的两种放弃条件。
- `delay = backoff_delay(attempt - 1, policy, rng)` 下一次要等多久。
- `if clock() - start + delay > deadline:` 已经用掉的时间加上要睡的时间,会不会超过总时限。**先算再睡**,而不是睡完发现超时了才放弃,那样白白多等一次。
- `raise` 超时限就直接抛最后这个错,不睡了。
- `policy = RetryPolicy(max_attempts=10, base=0.5, cap=8.0, jitter="none")` 允许试 10 次,真正起作用的是总时限。
- `deadline=3.0,` 最多 3 秒。

</div>

```bash
uv run python -m part02.deadline_retry
```

```text
最多允许 10 次、总时限 3 秒: 发了 3 次,1.6 秒后放弃
```

第 1 次失败后等 0.5 秒(累计 0.5),第 2 次失败后等 1 秒(累计 1.5),第 3 次失败后下一个等待是 2 秒,1.5 + 2 = 3.5 超了 3 秒,不睡了,直接放弃。一共发 3 次、1.6 秒后抛出。用户界面上「等了 1.6 秒就告诉我失败」比「等 3.5 秒再告诉我失败」好。生产里两个限制一般一起设:最多几次、最多多久,先到哪个就停。

</details>

**练习 3:`Retry-After` 还可以是日期。** HTTP 规定 `Retry-After` 可以是秒数,也可以是一个 HTTP 日期(如 `Fri, 23 Oct 2026 08:00:30 GMT`)。写 `part02/retry_after_date.py`:函数 `parse_retry_after(raw, now)` 返回要等几秒;秒数照旧;日期转成「日期减 `now`」;日期已经过去或负数返回 0;解析不了返回 `None`。用 6 条样本试。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/retry_after_date.py
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime


def parse_retry_after(raw: str, now: datetime) -> float | None:
    raw = raw.strip()
    try:
        return max(0.0, float(raw))
    except ValueError:
        pass
    try:
        when = parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        return None
    return max(0.0, (when - now).total_seconds())


if __name__ == "__main__":
    now = datetime(2026, 10, 23, 8, 0, 0, tzinfo=timezone.utc)
    for raw in ["3", "1.5", "Fri, 23 Oct 2026 08:00:30 GMT", "Fri, 23 Oct 2026 07:00:00 GMT", "明天再来", "-5"]:
        print(repr(raw), "->", parse_retry_after(raw, now))
```

<div class="line-notes">

- `from email.utils import parsedate_to_datetime` 标准库里解析 HTTP 日期的函数。名字叫 email 是因为 HTTP 的日期格式沿用了邮件的 RFC 标准。
- `def parse_retry_after(raw: str, now: datetime) -> float | None:` 把 `now` 作为参数传进来,不在函数里取当前时间,这样测试可以固定「现在」。
- `raw = raw.strip()` 去掉头尾空白。
- `return max(0.0, float(raw))` 先当秒数试。`max(0.0, ...)` 把负数压成 0。`"-5"` 得到 0.0,`"1.5"` 得到 1.5。
- `except ValueError:` 转不了数字,说明可能是日期。
- `pass` 什么都不做,继续往下走去试日期。
- `when = parsedate_to_datetime(raw)` 把 `Fri, 23 Oct 2026 08:00:30 GMT` 转成带时区的 `datetime`。
- `except (TypeError, ValueError):` 日期也解析不了(比如「明天再来」),两种异常都可能,Python 版本不同抛的不同。
- `return None` 当作没有这个头。
- `return max(0.0, (when - now).total_seconds())` 两个 `datetime` 相减得到时间差,`.total_seconds()` 变成秒数。日期在过去则是负数,压成 0。
- `now = datetime(2026, 10, 23, 8, 0, 0, tzinfo=timezone.utc)` 固定一个「现在」,带 UTC 时区。两个 `datetime` 一个带时区一个不带,相减会报错,所以 `now` 必须带。

</div>

```bash
uv run python -m part02.retry_after_date
```

```text
'3' -> 3.0
'1.5' -> 1.5
'Fri, 23 Oct 2026 08:00:30 GMT' -> 30.0
'Fri, 23 Oct 2026 07:00:00 GMT' -> 0.0
'明天再来' -> None
'-5' -> 0.0
```

`'3'` 和 `'1.5'` 是秒数;第三条日期比 `now` 晚 30 秒,得到 30.0;第四条日期比 `now` 早一小时,得到 0.0(已经过了,不用等);「明天再来」转不了,`None`;`'-5'` 是负数,压成 0.0。把它接进 `server_hint` 只要把里面的 `float(raw)` 换成这个函数。我没有在真实厂商的响应里见到过日期形式的 `Retry-After`,所以今天正文没接,留给你。

</details>

**练习 4:抖动的代价。** 写 `part02/jitter_cost.py`:对 `none`、`full`、`equal` 三种抖动,各抽样 10000 次,算「第 1 到第 4 次重试前的平均等待」,再复用 `herd.py` 的 `retry_times` 和 `peak` 算「100 个客户端第一轮重试的峰值」。用一句话说怎么选。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/jitter_cost.py
import random
import statistics

from part02.herd import peak, retry_times
from part02.retry import Jitter, RetryPolicy, backoff_delay

modes: list[Jitter] = ["none", "full", "equal"]
rng = random.Random(0)
for mode in modes:
    policy = RetryPolicy(jitter=mode)
    waits = [[backoff_delay(n, policy, rng) for _ in range(10_000)] for n in range(4)]
    means = [round(statistics.mean(w), 2) for w in waits]
    first_wave = peak(retry_times(mode)[0])
    print(f"jitter={mode:5} 第 1~4 次重试前平均等 {means} 秒, 100 个客户端第一轮重试的峰值 {first_wave}/0.1 秒")
```

<div class="line-notes">

- `from part02.herd import peak, retry_times` 复用 `herd.py` 里的函数,所以那个文件必须有 main guard,不然导入就先把它的结果打印一遍。
- `modes: list[Jitter] = ["none", "full", "equal"]` 带类型标注的列表,编辑器知道里面每一项都是合法的抖动方式。
- `rng = random.Random(0)` 固定种子,每次运行结果一样。
- `waits = [[backoff_delay(n, policy, rng) for _ in range(10_000)] for n in range(4)]` 嵌套推导式:外层 `n` 取 0 到 3(第几次失败),里层抽样 10000 个等待时间。结果是 4 个长度 10000 的列表。
- `means = [round(statistics.mean(w), 2) for w in waits]` 每个列表求平均,保留两位小数。
- `first_wave = peak(retry_times(mode)[0])` `retry_times(mode)` 是四轮的时刻,`[0]` 取第一轮,`peak` 算每 0.1 秒窗口里最挤的个数。

</div>

```bash
uv run python -m part02.jitter_cost
```

```text
jitter=none  第 1~4 次重试前平均等 [0.5, 1.0, 2.0, 4.0] 秒, 100 个客户端第一轮重试的峰值 100/0.1 秒
jitter=full  第 1~4 次重试前平均等 [0.25, 0.5, 1.0, 1.98] 秒, 100 个客户端第一轮重试的峰值 30/0.1 秒
jitter=equal 第 1~4 次重试前平均等 [0.37, 0.75, 1.5, 3.0] 秒, 100 个客户端第一轮重试的峰值 47/0.1 秒
```

不抖动每次等得最久、峰值最高(100);完全抖动平均只等一半(0.25、0.5、1.0、1.98 秒,恰好是上限的一半),峰值 30;一半抖动平均等 0.75 倍(0.37、0.75、1.5、3.0),峰值 47。**一句话:想让一大批客户端不互相踩,用完全抖动;想保证每个客户端至少让一让,用一半抖动;只有一个客户端时,抖不抖都无所谓。**

</details>

**练习 5:用 logging 记重试。** 把 `demo_retry.py` 里的 `print` 换成 [Day 75](/blog/agent-zero/day-075-logging/) 的 logging:每次重试记一条 WARNING,成功记 INFO,放弃记 ERROR。写 `part02/retry_logging.py`,对 `flaky:503:2`、`status-401`、`status-503` 各跑一遍。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/retry_logging.py
import logging
import random

import openai
from openai import OpenAI

from part02.classify import Verdict, classify
from part02.fake_llm import fake_server
from part02.retry import RetryPolicy, call_with_retry

log = logging.getLogger("llm.retry")
POLICY = RetryPolicy(max_attempts=3, base=0.1, cap=0.4)


def on_retry(attempt: int, delay: float, v: Verdict) -> None:
    log.warning("第 %d 次调用失败,类别=%s 状态码=%s,%.2f 秒后重试", attempt, v.kind, v.status, delay)


def ask(client: OpenAI, model: str) -> None:
    try:
        call_with_retry(
            lambda: client.chat.completions.create(model=model, messages=[{"role": "user", "content": "hi"}]),
            POLICY, rng=random.Random(3), on_retry=on_retry,
        )
        log.info("%s 成功", model)
    except openai.OpenAIError as e:
        v = classify(e)
        log.error("%s 放弃: 类别=%s 可重试=%s 建议=%s", model, v.kind, v.retry, v.advice)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)-7s %(name)s: %(message)s")
    logging.getLogger("httpx2").setLevel(logging.WARNING)
    with fake_server() as (url, _):
        client = OpenAI(base_url=url, api_key="sk-fake", max_retries=0)
        for model in ["flaky:503:2", "status-401", "status-503"]:
            ask(client, model)
```

<div class="line-notes">

- `log = logging.getLogger("llm.retry")` 给这一块起一个日志名,Day 75 讲的 `getLogger`。以后在日志里按这个名字过滤,就能只看重试相关的。
- `POLICY = RetryPolicy(max_attempts=3, base=0.1, cap=0.4)` 演示用的小等待。
- `log.warning("第 %d 次调用失败,类别=%s 状态码=%s,%.2f 秒后重试", attempt, v.kind, v.status, delay)` logging 推荐用 `%s`、`%d` 占位符加参数的写法,不是 f-string:日志级别不够时(比如只开了 ERROR),这条根本不会被格式化,省一点开销。`%d` 整数、`%s` 字符串、`%.2f` 两位小数。
- `log.info("%s 成功", model)` 成功是 INFO。
- `log.error("%s 放弃: 类别=%s 可重试=%s 建议=%s", model, v.kind, v.retry, v.advice)` 放弃是 ERROR,类别和建议一起记下,值班的人一眼知道该找谁。
- `logging.basicConfig(level=logging.INFO, format="%(levelname)-7s %(name)s: %(message)s")` 配置输出:INFO 及以上都显示;格式是级别(占 7 格左对齐)、日志名、消息。
- `logging.getLogger("httpx2").setLevel(logging.WARNING)` 底层 HTTP 库在 INFO 级别每个请求写一行,会刷屏,把它调到 WARNING。

</div>

```bash
uv run python -m part02.retry_logging
```

```text
WARNING llm.retry: 第 1 次调用失败,类别=厂商 状态码=503,0.02 秒后重试
WARNING llm.retry: 第 2 次调用失败,类别=厂商 状态码=503,0.11 秒后重试
INFO    llm.retry: flaky:503:2 成功
ERROR   llm.retry: status-401 放弃: 类别=你的账号 可重试=False 建议=key 不对或已作废:检查配置文件里的 LLM_API_KEY
WARNING llm.retry: 第 1 次调用失败,类别=厂商 状态码=503,0.02 秒后重试
WARNING llm.retry: 第 2 次调用失败,类别=厂商 状态码=503,0.11 秒后重试
ERROR   llm.retry: status-503 放弃: 类别=厂商 可重试=True 建议=厂商那边出故障或过载:等一会儿重试
```

三种情形在日志里一眼就能区分:`flaky:503:2` 两条 WARNING 一条 INFO,最后成功;`status-401` 一条 ERROR,类别「你的账号」,可重试 `False`,没有任何 WARNING,说明连一次重试都没有;`status-503` 两条 WARNING 一条 ERROR,类别「厂商」,可重试 `True`,意思是「这种错值得重试,但重试了几次还是失败」。同样是 ERROR,**「可重试=False」是要人立刻处理,「可重试=True」是要看厂商是不是出大问题了**,两种告警的接收人和紧急程度可以不一样。

</details>

**验收标准:** `naive_retry.py` 能看到几百个请求对 4 个请求的对比;`sdk_retry.py` 的间隔落在 0.375–0.5、0.75–1.0 这些区间里,且 401/400/402 只发 1 个请求;`pytest tests/test_retry.py` 10 个全过,并且能复现「漏了 `not verdict.retry`」挂 1 个;`herd.py` 能解释三种抖动各自的峰值;`stacked_retry.py` 看到 9 对 3;`ask_retry.py` 三种结局退出码 0、2、3;五道练习的输出和文章一致。

今天的花费:全部在本机假服务器上的实验不花钱;真 API 只有 `ask_retry.py` 的一次正常问答,约 0.0004 元(调试时跑了几次)。全天不到 0.005 元。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 重试(retry) | 请求失败后再发一次。只对暂时性的错有意义,不能对 401、400 这类重试 |
| 指数退避(exponential backoff) | 每次失败后等待的时间翻倍:`base × 2ⁿ`,并设一个上限。用「晚一点拿到结果」换「少打扰一台在喘气的服务器」 |
| 抖动(jitter) | 在等待时间上加随机,让大批客户端的重试时刻散开,避免同时涌回 |
| 完全抖动 / 一半抖动 | 等待时间在 `[0, 上限]` 之间随机 / 在 `[上限/2, 上限]` 之间随机 |
| 惊群(thundering herd) | 一大批客户端被同一件事触发,在同一时刻做同样的事,把服务器压垮 |
| 重试风暴(retry storm) | 服务器过载 → 客户端失败 → 立刻重试 → 服务器更过载的恶性循环 |
| `Retry-After` | HTTP 响应头,服务器明确告诉你「请等多少秒(或到什么时间)再来」 |
| 尝试次数 vs 重试次数 | 尝试次数包含第一次,重试次数不包含。`max_attempts=4` 等于 3 次重试;SDK 的 `max_retries=2` 是 3 次尝试 |
| 依赖注入 | 把「会让测试变慢或变随机的东西」(睡觉、时钟、随机数)做成函数参数,测试时换成假的。本课的 `sleep`、`clock`、`rng` |
| `time.monotonic()` | 只会往前走的计时器,不受系统改时间影响,量时间差用它 |
| `*rest`(星号解包) | 解包时用 `*` 接住剩下的所有项,得到一个列表 |
| `__post_init__` | dataclass 在创建完对象后自动调用的方法,常用来检查参数 |
| `raise`(不带参数) | 在 `except` 里把刚接住的异常原样再抛出去,调用方看到的还是原来的错 |

## 常见误区

**失败了就 `while True` 立刻重试。** 实测 2 秒的故障里立刻重试发了 428 个请求,翻倍等待只发了 4 个。更糟的是你不是一个人,几千个客户端一起这样做,厂商的服务器会被你们压垮。

**只写退避不写抖动。** 一百个客户端同时失败,没有抖动,它们的重试时刻完全一样,每一轮都是一次齐射(实测每 0.1 秒同时来 100 个)。加了完全抖动,峰值降到 30,到第四轮只剩 7。

**对 401 也重试。** 漏掉一个 `not verdict.retry`,401 被重试了 4 次。只测「最后抛了 `AuthenticationError`」发现不了,要断言「服务器收到几个请求」。

**把 `max_attempts` 和 `max_retries` 搞混。** `max_attempts=3` 是总共试 3 次;`max_retries=3` 是重试 3 次、总共 4 次。我自己第一次写就算错了,日志里「第 3 次失败」后还有一次请求,以为是 bug。

**两层重试叠在一起。** 自己写 3 次、SDK 默认 2 次,一次失败发出 9 个请求,耗时也是两层相加(实测 4.3 秒对 0.1 秒)。只放一层:自己写就给 SDK 设 `max_retries=0`。

**没有总时限。** 「最多 4 次」听着有限,但 `cap=8` 时一次完整的重试等待可以超过 20 秒(实测 SDK `max_retries=6` 共 20.6 秒)。交互式的场景要加总时限,宁可早点告诉用户失败。

**重试没说完的回答。** `finish_reason=length` 是 `max_tokens` 给少了,重试多少次还是被截断,而且每次都按输出收钱。`IncompleteAnswer` 放在重试外面,让它直接往外冒。

**对有副作用的调用盲目重试。** 聊天问答重试一次最多多花几厘钱;如果被重试的是「创建订单」「发邮件」,超时的那次请求可能已经被处理了,重试会重复执行。第三部分讲工具调用时会专门讲怎么做幂等。

## 学习资料

### 文档与文章

- [AWS 架构博客 · Exponential Backoff And Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/):抖动方面最经典的一篇,Marc Brooker 2015 年写的。作者做了模拟,比较了无抖动、完全抖动、一半抖动、去相关抖动,结论是完全抖动胜出,图表一看就懂。读 10 分钟。
- [openai-python README · Retries 和 Timeouts](https://github.com/openai/openai-python#retries):官方对默认重试规则的说明(搜「Retries」那一节),和我们读源码得到的一致。
- [openai-python 的 `_base_client.py`](https://github.com/openai/openai-python/blob/main/src/openai/_base_client.py):搜 `_should_retry` 和 `_calculate_retry_timeout` 两个函数,各三十来行,今天正文里讲的规则全在这里。
- [MDN · Retry-After](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Headers/Retry-After):这个响应头的两种写法(秒数和日期),练习 3 用到。
- [Google SRE 手册 · 解决连锁故障](https://sre.google/sre-book/addressing-cascading-failures/):讲「重试放大」怎么把一个小故障放大成大故障,里面的「每个请求最多重试三次」「用随机化的指数退避」就是今天的结论。属于进阶读物,读「Retries」和「Retry amplification」的小节即可,英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1izHd6zEF2&autoplay=0&high_quality=1" title="第26讲:LLM重试机制设计——指数退避与抖动" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Mooxesther · 第 26 讲:LLM 重试机制设计,指数退避与抖动 · 21 分钟,2026 年 10 月。Day 121 推荐过同一个系列的参数讲解。今天的整个主题,看完把他的重试代码和 `call_with_retry` 对一下,看看他漏了什么、多了什么。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1dvYU6EEZJ&autoplay=0&high_quality=1" title="Claude、OpenAI与Gemini API限流详解：HTTP 429、指数退避与全抖动" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>快乐的天才程序员 · Claude、OpenAI 与 Gemini API 限流详解:HTTP 429、指数退避与全抖动 · 13 分钟,2026 年 9 月。昨天推荐过同一个 UP 主的短版,这一个把三家各自的限流和重试规则放在一起比。看完你会发现各家的 `Retry-After` 习惯并不一样。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/NByH-cau97A" title="Retry Strategies: Exponential Backoff & Jitter Explained" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>CodeLucky · Retry Strategies: Exponential Backoff & Jitter Explained · 英文。按标题是讲退避和抖动,我只核对了标题和能打开,没逐段看过;看之前先想想今天 `herd.py` 的三行结果,再看他怎么讲「为什么要抖动」。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/1fTUlTqm_Vk" title="How API Retries Cause Outages (Backoff & Jitter Explained)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>CodeAnimated · How API Retries Cause Outages (Backoff & Jitter Explained) · 英文,动画。同样只核对了标题和能打开;标题说的「重试怎么引发故障」就是今天说的重试风暴。</figcaption>
</figure>

### 书籍

- 《数据密集型应用系统设计》(Martin Kleppmann 著,赵军平、李三平、吕云松、耿煜译,机械工业出版社,2018 年;英文原书《Designing Data-Intensive Applications》,O'Reilly,2017 年):第 8 章「分布式系统的麻烦」里讲超时和不可靠的网络,超时到底意味着什么、为什么「没收到回答」不等于「没处理」,正好是今天「超时的请求可能已经被处理了」那句话的出处。读超时那一节,20 页左右。

### 开源项目与代码

- [jd/tenacity](https://github.com/jd/tenacity):Python 最常用的重试库。今天先不用,打开 README 找 `wait_exponential_jitter`、`stop_after_attempt`、`retry_if_exception`,看它的参数怎么和我们的 `RetryPolicy` 一一对应,Day 190 会正式学。

## 自测

1. 故障持续 2 秒时,「立刻重试」发了 428 个请求,翻倍等待发了 4 个。翻倍等待有什么代价?

<details><summary>答案</summary>

拿到结果更晚:实测翻倍等待在 3.53 秒才成功,而服务器 2 秒就恢复了,「立刻重试」1.95 秒就拿到了。退避是用延迟换负载,故障越长越划算,故障越短越亏。所以要设上限和总时限,别让等待无限变长。

</details>

2. SDK 默认重试 2 次,等待是 `min(0.5 × 2ⁿ, 8)` 乘 0.75 到 1 之间的随机数。第二次重试前最多等多久?最少多久?

<details><summary>答案</summary>

第二次重试前是 `n=1`:`0.5 × 2¹ = 1` 秒,乘 0.75 到 1,所以最少 0.75 秒、最多 1.0 秒。实测 `sdk_retry.py` 默认配置的第二个间隔是 0.9 秒,落在这个区间里。

</details>

3. 为什么测试 `test_401_is_not_retried` 必须断言 `len(server.requests_seen) == 1`,光写 `pytest.raises(openai.AuthenticationError)` 不够?

<details><summary>答案</summary>

因为即使 401 被重试了 4 次,最后还是会抛 `AuthenticationError`,`pytest.raises` 照样通过。「不该重试的错一次都不能多发」这个性质只有数服务器收到的请求数才能验证。测重试要看过程(发了几次、睡了几次),不能只看最终抛什么。

</details>

4. 自己写了 `call_with_retry(max_attempts=3)`,又没给 SDK 设 `max_retries`。一个永远 503 的服务,服务器收到几个请求?怎么改?

<details><summary>答案</summary>

9 个(外层 3 次尝试,每次内层 SDK 默认重试 2 次,共 3 次请求,3 × 3 = 9)。把客户端建成 `OpenAI(..., max_retries=0)`,让重试只在你自己写的这一层发生,实测变成 3 个请求。

</details>

5. 面试题:「你们的 Agent 调用大模型 API,高峰期偶尔失败。请设计一个重试方案。」

<details><summary>答案</summary>

先分类:只重试暂时性的错(429、5xx、连不上、超时),401、402、403、400、422 这些重试没用的立刻报错或告警;429 要看错误码,额度用完不重试。再设计等待:指数退避(0.5 秒起翻倍,封顶 8 秒左右)加随机抖动(完全抖动最能避免多客户端同时重试),服务器给了 `Retry-After` 就以它为准(设一个上限,比如 60 秒,超过就放弃)。限制:最多几次加总时限,交互式场景总时限更重要。重试只放一层,自己写就把 SDK 的 `max_retries` 设成 0,不然 3 × 3 = 9 倍放大。可观测:每次重试记日志和指标,区分「重试后成功」和「重试用光」,后者告警。副作用:被重试的调用如果不是纯读(比如工具会下单、发消息),要保证幂等,或者不重试超时。测试:把睡觉和随机做成参数,断言发了几个请求、睡了几次,不真的等。

</details>

## 明天预告

[Day 128](/blog/agent-zero/day-128-rate-limit/) · 限速、并发和选厂商。今天讲了「失败了怎么办」,明天讲「怎么避免被限速」:RPM、TPM、并发三种上限各是什么、DeepSeek 的 429 其实是并发超限(昨天读过限速页)、一次发 5 个请求要怎么控制同时在途的数量(Day 68 学过的 `asyncio.Semaphore` 正好用上),最后讲选厂商要看哪几个维度。今天的重试是出事之后的补救,明天的并发控制是尽量不出事。
