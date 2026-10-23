---
title: 'Day 126 · 错误码:401、429、5xx 谁的问题'
description: '把调用大模型 API 时会遇到的错分成「你的代码、你的账号、太快了、厂商、网络」五类,每类对应 SDK 里哪个异常、该不该重试。先在 DeepSeek 上故意造出 12 种真错(假 key 的 401、n=2 的 400、max_tokens=-5 的 422、连不上、超时),再用一个本机假服务器造出 402、429、503 和「200 但内容是网页」,最后写 classify 函数和 16 个测试,做成一个按错误类型给退出码的命令行脚本。'
pubDate: 2026-10-23
regime: none
tags: ['api', 'errors', 'python', 'pytest', 'agent-zero']
series: 'agent-zero'
day: 126
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 125](/blog/agent-zero/day-125-week18-review/) 是第 18 周的复习日。我们把「一次调用从 `.env` 到账单」画成了一张图,写了 `week18_lab.py` 给 DeepSeek 和硅基流动各做一次体检:正常问答、截断、假 key、缓存。其中有两个探针已经碰到了错误:假 key 得到 401,`max_tokens=30` 得到状态码 200 却没说完。那时候我们只是看到「有错」,没有认真问过:这个错是谁造成的?要不要再试一次?

今天专门回答这两个问题。它决定了你的 Agent 出错时是悄悄再试一次,还是马上报警让人去充值,还是连续重试一百次把账号拖进限速。

## 今天要解决的问题

学完今天,你应该能做到:

1. 看到一个 API 错误,从**状态码、响应体、SDK 异常类**三条线索里读出它是什么错,知道 `e.status_code`、`e.message`、`e.body`、`e.code` 各是什么。
2. 默画 SDK 异常类的继承关系,说出 `APIStatusError`、`APIConnectionError`、`APITimeoutError` 谁是谁的子类,以及为什么 `except` 的顺序不能乱。
3. 把常见错误分成「你的代码、你的账号、太快了、厂商、网络」五类,并说出每一类该不该重试、该找谁。
4. 写出 `classify(e)`,用 16 个测试验证它,做成一个按错误类型返回不同退出码的命令行脚本 `ask_safe.py`。

今天的两个新概念:**错误分类**(谁的问题)和 **SDK 的异常类层级**。「重试怎么写、等多久」是明天 Day 127 的内容,今天的 `classify` 只回答「该不该重试」。

预计用时:2.5 小时左右。实跑花费:DeepSeek 上的调用大部分是故意发错的、被服务器挡在门口的请求,只有几次正常问答,硅基流动同理,全天合计不到 0.01 元(文末有算式)。假服务器那一半完全在你的电脑里,不花钱。前置:[Day 60](/blog/agent-zero/day-060-http-2/) 的状态码、[Day 35](/blog/agent-zero/day-035-exceptions-1/)–[Day 36](/blog/agent-zero/day-036-exceptions-2/) 的异常、[Day 73](/blog/agent-zero/day-073-pytest-3/) 的 fixture 和 parametrize、[Day 120](/blog/agent-zero/day-120-api-register/) 的五种报错、[Day 122](/blog/agent-zero/day-122-api-response/) 的 `finish_reason`、[Day 125](/blog/agent-zero/day-125-week18-review/) 的 `week18_lab.py`。

学法提示:先对照文章把每个脚本逐行敲一遍(不要复制粘贴)并跑通;明天合上文章,把 `classify` 默写出来;然后做动手练习,做不出来再展开参考答案,看完关掉,自己重写一遍。

## 先造一次真的 401

Day 120 时我们看到过 401,那次是 key 写错了,只关心「报错了」。今天故意再造一次,把这个错误对象里能拿到的东西全部打印出来。这个脚本用一个假 key(`sk-` 加 32 个 0)去调 DeepSeek,请求会在门口被挡下,不花钱。

新建 `part02/err_401.py`:

```python
# agent-zero-lab/part02/err_401.py
import os

import openai
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key="sk-" + "0" * 32, max_retries=0)

try:
    client.chat.completions.create(
        model=os.environ["LLM_MODEL"],
        messages=[{"role": "user", "content": "hi"}],
        max_tokens=5,
    )
except openai.APIStatusError as e:
    print("异常类:", type(e).__name__)
    print("继承链:", [c.__name__ for c in type(e).__mro__[:5]])
    print("状态码:", e.status_code)
    print("message:", e.message)
    print("body:", e.body)
    print("code / type / param:", e.code, e.type, e.param)
    print("请求:", e.request.method, e.request.url)
    print("content-type:", e.response.headers["content-type"])
    print("x-ds-trace-id:", e.response.headers.get("x-ds-trace-id"))
```

<div class="line-notes">

- `import openai` 这次要用 `openai.APIStatusError` 这个异常类,所以导入整个包。
- `load_dotenv()` 读 `.env`,拿 `LLM_BASE_URL` 和 `LLM_MODEL`,key 我们故意不用里面的。
- `client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key="sk-" + "0" * 32, max_retries=0)` 地址是真的,key 是假的:`"0" * 32` 是把字符串 `"0"` 重复 32 次。`max_retries=0` 让 SDK 别自动重试。401 本来就不会被重试,写上是为了今天所有实验的行为一致,SDK 怎么重试是明天的事。
- `messages=[{"role": "user", "content": "hi"}],` 最短的合法请求。请求本身没毛病,毛病只在 key。
- `max_tokens=5,` 万一 key 居然通了,也只花几厘钱。
- `except openai.APIStatusError as e:` 「服务器回了一个非 2xx 状态码」这一大类错误的父类。先用它接,再看具体是哪个子类。
- `print("异常类:", type(e).__name__)` `type(e)` 是这个对象真正的类,`__name__` 是类名字符串。实跑得到 `AuthenticationError`,说明 SDK 看到 401 后,抛出的是专门为 401 准备的子类。
- `print("继承链:", [c.__name__ for c in type(e).__mro__[:5]])` `__mro__` 是这个类从自己往上数的继承链,`[:5]` 取前五个,列表推导式取每个类的名字。实跑是 `['AuthenticationError', 'APIStatusError', 'APIError', 'OpenAIError', 'Exception']`。这一行是今天最重要的线索:`AuthenticationError` 是 `APIStatusError` 的子类,所以 `except openai.APIStatusError` 能接住它。
- `print("状态码:", e.status_code)` 实跑 `401`。只有 `APIStatusError` 这一支有 `status_code`,连不上和超时没有状态码,因为根本没拿到响应。
- `print("message:", e.message)` SDK 拼的说明:`Error code: 401 -` 后面跟整个响应体。
- `print("body:", e.body)` 响应体解析成的字典,实跑是 `{'message': 'Authentication Fails, Your api key: ****0000 is invalid (request_id: ...)', 'type': 'authentication_error', 'param': None, 'code': 'invalid_request_error'}`。SDK 已经把外面一层 `{"error": ...}` 剥掉了。
- `print("code / type / param:", e.code, e.type, e.param)` 从 `body` 里取出的三个字段。DeepSeek 这里 `code` 是 `invalid_request_error`,`type` 才是 `authentication_error`,和你的直觉可能相反。别家的 `code` 可能是一串数字,下面会看到。
- `print("请求:", e.request.method, e.request.url)` 出错的那个请求本身也带在异常对象里,实跑是 `POST https://api.deepseek.com/chat/completions`。排查「到底发去了哪」时有用(Day 123 的串味就是这种)。
- `print("content-type:", e.response.headers["content-type"])` 响应头。`e.response` 是完整的 HTTP 响应。实跑 `application/json`,说明厂商回的是 JSON。
- `print("x-ds-trace-id:", e.response.headers.get("x-ds-trace-id"))` DeepSeek 在每个响应头里放一个追踪 ID。找厂商客服时,把它连同 `request_id` 一起给对方,比一句「我调用失败了」有用得多。用 `.get` 是因为别家没有这个头,不能用方括号。

</div>

```bash
uv run python -m part02.err_401
```

实跑输出:

```text
异常类: AuthenticationError
继承链: ['AuthenticationError', 'APIStatusError', 'APIError', 'OpenAIError', 'Exception']
状态码: 401
message: Error code: 401 - {'error': {'message': 'Authentication Fails, Your api key: ****0000 is invalid (request_id: ff5c2f40-cef3-4ae7-8f55-60b3f859c7dc)', 'type': 'authentication_error', 'param': None, 'code': 'invalid_request_error'}}
body: {'message': 'Authentication Fails, Your api key: ****0000 is invalid (request_id: ff5c2f40-cef3-4ae7-8f55-60b3f859c7dc)', 'type': 'authentication_error', 'param': None, 'code': 'invalid_request_error'}
code / type / param: invalid_request_error authentication_error None
请求: POST https://api.deepseek.com/chat/completions
content-type: application/json
x-ds-trace-id: 4f173637017c0447c79382ca58b23272
```

三条线索都在:状态码 401、异常类 `AuthenticationError`、响应体里的文字。有一个细节要留意:message 里写着 `Your api key: ****0000 is invalid`,**DeepSeek 把你传的 key 的末 4 位回显出来了**。我传的是 32 个 0,所以显示 `0000`。真 key 填错时,这里会显示你填的那串的末 4 位。末 4 位本身不危险,但养成习惯:错误信息贴到群里、贴进 issue 之前先扫一遍有没有 key。练习 2 会写一个脱敏函数。

## SDK 的异常类层级

`err_401.py` 里的继承链,画全了是这样一棵树:

<figure>
<svg viewBox="0 0 640 340" role="img" aria-label="openai SDK 的异常类继承树:OpenAIError 下面是 APIError,再分成有状态码的 APIStatusError 和没有状态码的 APIConnectionError;APIStatusError 下面是 400、401、403、404、409、422、429、500 以上八个子类;APIConnectionError 下面是 APITimeoutError">
<rect x="0" y="0" width="640" height="340" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="11">
<rect x="250" y="12" width="140" height="26" rx="4" fill="none" stroke="var(--rule)"/>
<text x="320" y="29" text-anchor="middle" fill="var(--ink)">OpenAIError</text>
<line x1="320" y1="38" x2="320" y2="52" stroke="var(--ink-soft)"/>
<rect x="250" y="52" width="140" height="26" rx="4" fill="none" stroke="var(--rule)"/>
<text x="320" y="69" text-anchor="middle" fill="var(--ink)">APIError</text>
<line x1="320" y1="78" x2="320" y2="92" stroke="var(--ink-soft)"/>
<line x1="170" y1="92" x2="500" y2="92" stroke="var(--ink-soft)"/>
<line x1="170" y1="92" x2="170" y2="106" stroke="var(--ink-soft)"/>
<line x1="500" y1="92" x2="500" y2="106" stroke="var(--ink-soft)"/>
<rect x="80" y="106" width="180" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="170" y="123" text-anchor="middle" fill="var(--ink)">APIStatusError</text>
<text x="170" y="138" text-anchor="middle" fill="var(--ink-faint)">服务器回了状态码</text>
<rect x="410" y="106" width="180" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="500" y="123" text-anchor="middle" fill="var(--ink)">APIConnectionError</text>
<text x="500" y="138" text-anchor="middle" fill="var(--ink-faint)">没拿到响应,没有状态码</text>
<line x1="500" y1="146" x2="500" y2="196" stroke="var(--ink-soft)"/>
<rect x="410" y="196" width="180" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="500" y="215" text-anchor="middle" fill="var(--ink)">APITimeoutError</text>
<text x="500" y="244" text-anchor="middle" fill="var(--ink-faint)">超时是连不上的一种</text>
<line x1="170" y1="146" x2="170" y2="160" stroke="var(--ink-soft)"/>
<line x1="95" y1="160" x2="245" y2="160" stroke="var(--ink-soft)"/>
<line x1="95" y1="160" x2="95" y2="170" stroke="var(--ink-soft)"/>
<line x1="245" y1="160" x2="245" y2="170" stroke="var(--ink-soft)"/>
<rect x="10" y="170" width="170" height="26" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="95" y="187" text-anchor="middle" fill="var(--ink)">400 BadRequest</text>
<rect x="10" y="202" width="170" height="26" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="95" y="219" text-anchor="middle" fill="var(--ink)">401 Authentication</text>
<rect x="10" y="234" width="170" height="26" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="95" y="251" text-anchor="middle" fill="var(--ink)">403 PermissionDenied</text>
<rect x="10" y="266" width="170" height="26" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="95" y="283" text-anchor="middle" fill="var(--ink)">404 NotFound</text>
<rect x="190" y="170" width="170" height="26" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="275" y="187" text-anchor="middle" fill="var(--ink)">422 UnprocessableEntity</text>
<rect x="190" y="202" width="170" height="26" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="275" y="219" text-anchor="middle" fill="var(--ink)">429 RateLimit</text>
<rect x="190" y="234" width="170" height="26" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="275" y="251" text-anchor="middle" fill="var(--ink)">409 Conflict</text>
<rect x="190" y="266" width="170" height="26" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="275" y="283" text-anchor="middle" fill="var(--ink)">500 以上 InternalServer</text>
<text x="10" y="316" fill="var(--ink-faint)">琥珀色:改了才会好,原样重试没用。蓝色:等一等可能自己好。类名后面都带 Error,图里省略</text>
<text x="400" y="272" fill="var(--ink-soft)">402 没有专属类:</text>
<text x="400" y="290" fill="var(--ink-soft)">就是 APIStatusError 本身</text>
</g>
</svg>
<figcaption>SDK 3.37 里的异常类(我对着装好的包里 `_exceptions.py` 核过)。左边一支是「服务器回了状态码」,右边一支是「连响应都没有」。今天后面所有的 `except` 顺序都由这棵树决定。</figcaption>
</figure>

读这棵树有三个要点。第一,`APIStatusError` 的八个子类按状态码一一对应,但**402 没有**:它没有专属类,抛出来的就是 `APIStatusError` 本身,只能靠 `e.status_code == 402` 判断,后面的 `classify` 里会看到。第二,`APITimeoutError` 是 `APIConnectionError` 的子类,所以「超时」也会被 `except openai.APIConnectionError` 接住,想区分的话要把子类写在前面。第三,所有这些都是 `openai.OpenAIError` 的后代,所以最外层想「SDK 的错一律接住」,写 `except openai.OpenAIError` 就够了,别用裸的 `except Exception`,那会把你自己代码里的 bug 也吞掉。

## 真实 API 上能造出哪些错

别的错呢?我们在 DeepSeek 上把能安全造出来的错造一遍。下面这个脚本一次发 12 个故意有毛病的请求,每个打印一行:现象、异常类、状态码、厂商说的话。它们要么被鉴权挡下、要么被参数检查挡下、要么根本没连上服务器,都不会让模型真的开始计算,不花钱。

新建 `part02/err_real.py`,它读 `ENV_FILE` 选厂商,所以同一份代码后面还能拿去测硅基流动:

```python
# agent-zero-lab/part02/err_real.py
import json
import os
from dataclasses import dataclass, field
from typing import Any

import openai
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv(os.environ.get("ENV_FILE", ".env"), override=True)
BASE, KEY, MODEL = os.environ["LLM_BASE_URL"], os.environ["LLM_API_KEY"], os.environ["LLM_MODEL"]
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))


def make_client(**kw: Any) -> OpenAI:
    opts: dict[str, Any] = {"base_url": BASE, "api_key": KEY, "max_retries": 0}
    opts.update(kw)
    return OpenAI(**opts)


@dataclass
class Case:
    name: str
    client: OpenAI = field(default_factory=make_client)
    args: dict[str, Any] = field(default_factory=dict)


CASES = [
    Case("key 是假的", make_client(api_key="sk-" + "0" * 32)),
    Case("模型名写错", args={"model": "nope"}),
    Case("temperature=5", args={"temperature": 5}),
    Case("max_tokens=0", args={"max_tokens": 0}),
    Case("max_tokens=-5", args={"max_tokens": -5}),
    Case("max_tokens=1 千万", args={"max_tokens": 10_000_000}),
    Case("messages 为空", args={"messages": []}),
    Case("role 写成 boss", args={"messages": [{"role": "boss", "content": "hi"}]}),
    Case("n=2", args={"n": 2}),
    Case("地址多写 /v2", make_client(base_url=BASE + "/v2")),
    Case("端口没人监听", make_client(base_url="http://127.0.0.1:9")),
    Case("超时 0.05 秒", make_client(timeout=0.05)),
]


def core_message(e: openai.APIStatusError) -> str:
    body = e.body
    text = str(body.get("message", "")) if isinstance(body, dict) else str(body)
    return text.split(" (request_id")[0][:58]


for case in CASES:
    args: dict[str, Any] = {"model": MODEL, "messages": [{"role": "user", "content": "hi"}],
                            "max_tokens": 5, "extra_body": EXTRA}
    args.update(case.args)
    try:
        case.client.chat.completions.create(**args)
        print(f"{case.name} | 没报错")
    except openai.APIStatusError as e:
        print(f"{case.name} | {type(e).__name__} | {e.status_code} | {core_message(e)}")
    except openai.APIError as e:
        print(f"{case.name} | {type(e).__name__} | -- | {e.message} 原因 {type(e.__cause__).__name__}")
```

<div class="line-notes">

- `from dataclasses import dataclass, field` `field` 用来给数据类的字段指定「默认值怎么生成」,下面要用。
- `from typing import Any` `Any` 表示「什么类型都行」。`**kw` 和请求参数字典里什么都有,没法写得更具体,这里是 [Day 46](/blog/agent-zero/day-046-type-hints-2/) 说的 `Any` 的合理用法。
- `load_dotenv(os.environ.get("ENV_FILE", ".env"), override=True)` Day 123 的选厂商写法。
- `BASE, KEY, MODEL = os.environ["LLM_BASE_URL"], os.environ["LLM_API_KEY"], os.environ["LLM_MODEL"]` 一行读三个变量,元组打包再解包。实跑 DeepSeek:`https://api.deepseek.com`、真 key、`deepseek-flash`。
- `EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))` 配置里的扩展参数,实跑是 `{'thinking': {'type': 'disabled'}}`。
- `def make_client(**kw: Any) -> OpenAI:` 造一个客户端,默认用上面三个变量,`**kw` 收下想覆盖的参数。`**kw` 是 [Day 30](/blog/agent-zero/day-030-functions-3/) 学的:调用时写 `make_client(timeout=0.05)`,函数里 `kw` 就是 `{"timeout": 0.05}`。
- `opts: dict[str, Any] = {"base_url": BASE, "api_key": KEY, "max_retries": 0}` 默认三项。`max_retries` 写 0,每个实验「一个请求、一个结果」。
- `opts.update(kw)` 用传进来的覆盖默认值。`make_client(api_key="sk-000...")` 得到的客户端 `base_url` 还是真的、`api_key` 是假的。
- `return OpenAI(**opts)` `**opts` 把字典拆成关键字参数,相当于 JS 的 `new OpenAI({...opts})`。
- `@dataclass` 又一个装数据的类。
- `client: OpenAI = field(default_factory=make_client)` 这个字段没传时,**调用** `make_client()` 得到一个新客户端当默认值。不能直接写 `= make_client()`:那样所有 `Case` 会共用同一个对象,而且 dataclass 对可变默认值直接报错(Day 29 讲过的可变默认值陷阱的同类)。
- `args: dict[str, Any] = field(default_factory=dict)` 没传时默认是空字典,同样要用 `default_factory`。
- `Case("key 是假的", make_client(api_key="sk-" + "0" * 32)),` 第一个案例:第二个位置参数是客户端。
- `Case("模型名写错", args={"model": "nope"}),` 只想改请求里的一项,就只传 `args`,客户端用默认的。
- `Case("temperature=5", args={"temperature": 5}),` 取值超出范围。DeepSeek 实测的合法范围是 0 到 2。
- `Case("max_tokens=-5", args={"max_tokens": -5}),` 类型都对不上的值(负数当不了「最多多少个」)。
- `Case("messages 为空", args={"messages": []}),` 没有任何消息。
- `Case("role 写成 boss", args={"messages": [{"role": "boss", "content": "hi"}]}),` 角色名拼成了不存在的。
- `Case("n=2", args={"n": 2}),` Day 121 见过的,DeepSeek 只允许 `n=1`。
- `Case("地址多写 /v2", make_client(base_url=BASE + "/v2")),` 地址路径不对,发到一个不存在的路径。
- `Case("端口没人监听", make_client(base_url="http://127.0.0.1:9")),` 本机 9 号端口(discard 端口)平时没有任何程序在听,连接会被直接拒绝,模拟「服务器不在」。
- `Case("超时 0.05 秒", make_client(timeout=0.05)),` 给一个不可能做到的超时,模拟「等太久」。
- `def core_message(e: openai.APIStatusError) -> str:` 把一长串错误信息缩成一行好读的。
- `text = str(body.get("message", "")) if isinstance(body, dict) else str(body)` `e.body` 有时是字典(JSON 响应),有时是字符串或空(404 时是空字符串),所以先判断类型。这一行里的三元表达式顺序是「值 if 条件 else 另一个值」。
- `return text.split(" (request_id")[0][:58]` 把括号里那串每次都不同的 `request_id` 去掉,再截前 58 个字符,不然每次输出都对不齐。
- `args: dict[str, Any] = {"model": MODEL, "messages": [{"role": "user", "content": "hi"}],` 每个案例先用一份「正常」的请求参数。
- `args.update(case.args)` 再用案例里的覆盖。这样每个案例只写和正常不同的那一项。
- `case.client.chat.completions.create(**args)` 发请求。`**args` 把字典拆成关键字参数。
- `print(f"{case.name} | 没报错")` 这一条是给「厂商居然接受了」准备的。硅基流动上会看到好几次。
- `except openai.APIStatusError as e:` 有状态码的错。必须写在下一个 `except` 前面,因为它是 `APIError` 的子类。
- `print(f"{case.name} | {type(e).__name__} | {e.status_code} | {core_message(e)}")` 现象、异常类名、状态码、厂商说的话。这里表格对齐用竖线分隔,不用 `:16` 这种宽度:中文字符在终端里占两格,宽度对不齐(Day 119 踩过)。
- `except openai.APIError as e:` 剩下的:没有状态码的(连不上、超时)。
- `{type(e.__cause__).__name__}` `__cause__` 是「这个错是由哪个更底层的错引起的」,SDK 把底层的 httpx 错误包进来了。连接被拒是 `ConnectError`,超时是 `ReadTimeout` 或 `ConnectTimeout`。

</div>

```bash
uv run python -m part02.err_real
```

实跑输出(DeepSeek,2026 年 10 月 23 日):

```text
key 是假的 | AuthenticationError | 401 | Authentication Fails, Your api key: ****0000 is invalid
模型名写错 | BadRequestError | 400 | The supported API model names are deepseek-flash, deepseek
temperature=5 | BadRequestError | 400 | Invalid temperature value, the valid range of temperature 
max_tokens=0 | BadRequestError | 400 | Invalid max_tokens value, the valid range of max_tokens is
max_tokens=-5 | UnprocessableEntityError | 422 | Failed to deserialize the JSON body into the target type: 
max_tokens=1 千万 | BadRequestError | 400 | Invalid max_tokens value, the valid range of max_tokens is
messages 为空 | BadRequestError | 400 | Empty input messages
role 写成 boss | UnprocessableEntityError | 422 | Failed to deserialize the JSON body into the target type: 
n=2 | BadRequestError | 400 | Invalid n value (currently only n = 1 is supported)
地址多写 /v2 | NotFoundError | 404 | 
端口没人监听 | APIConnectionError | -- | Connection error. 原因 ConnectError
超时 0.05 秒 | APITimeoutError | -- | Request timed out. 原因 ReadTimeout
```

逐条看,有几件事值得记下来。

**400 和 422 的边界。** DeepSeek 文档说 400 是「请求体格式错误」,422 是「请求体参数错误」,听着像一回事。实测的分界是:值能解析、但超出合法范围或者逻辑不对,是 400(`temperature=5` 说合法范围是 [0, 2],`max_tokens=0` 说范围是 [1, 393216],`messages` 为空,`n=2`);值连类型都对不上、在反序列化那一步就失败,是 422(`max_tokens=-5` 报 `expected u32`,角色名 `boss` 报 `unknown variant`)。网上不少资料把 `temperature=5` 写成 422,我实测是 400。好在这个区别对你几乎不重要:**都是你的请求有问题,都别重试,都去读 `message`**。分类时把两个归一类就行。

**404 的 message 是空的。** 多写了 `/v2`,服务器回 404,响应体是空字符串,`message` 只剩 `Error code: 404`。没有任何文字告诉你错在哪,看到 404 第一反应是检查 `base_url` 的路径,Day 123 说过 DeepSeek 不带 `/v1`、硅基流动要带。

**连不上和超时没有状态码。** 最后两行的 `--` 就是这个意思。`ConnectError` 是本机连不上对方(没人监听、被防火墙拒、域名解析不了),`ReadTimeout` 是连上了、等回答等太久。这一次 0.05 秒的超时落在了「读」这一步,有时候会落在「连」这一步变成 `ConnectTimeout`,取决于哪一步先超时。

**「max_tokens=1 千万」被挡下来了。** 一千万个输出 token 根本不是个合法的请求,DeepSeek 在门口就拒绝,说上限是 393216。这一点别家可能不一样,看下面。

### 同样的错,换一家

用 Day 123 的 `ENV_FILE` 把同一份脚本换成硅基流动,不改代码:

```bash
ENV_FILE=.env.sf uv run python -m part02.err_real
```

```text
key 是假的 | AuthenticationError | 401 | Token is invalid.
模型名写错 | BadRequestError | 400 | Model does not exist. Please check it carefully.
temperature=5 | 没报错
max_tokens=0 | 没报错
max_tokens=-5 | BadRequestError | 400 | Input should be greater than or equal to 0
max_tokens=1 千万 | 没报错
messages 为空 | BadRequestError | 400 | Message field is required.
role 写成 boss | BadRequestError | 400 | Input tag 'boss' found using 'role' does not match any of 
n=2 | BadRequestError | 400 | n must be 1
地址多写 /v2 | NotFoundError | 404 | Not Found
端口没人监听 | APIConnectionError | -- | Connection error. 原因 ConnectError
超时 0.05 秒 | APITimeoutError | -- | Request timed out. 原因 ConnectTimeout
```

同一个模型 `DeepSeek-V4-Flash`,两家的表现有四处不同:

- `temperature=5`、`max_tokens=0`、`max_tokens=1 千万` 硅基流动**都放行了**,没报错。DeepSeek 官方是 400。「兼容」又一次只是格式一样,参数检查严不严是各家自己的事。
- **没有 422。** `max_tokens=-5` 和 `role=boss` 在硅基流动上都是 400。
- **响应体长得不一样。** DeepSeek 是 OpenAI 风格的 `{"error": {"message", "type", "param", "code"}}`,`e.code` 是 `invalid_request_error`。硅基流动是 `{"code": 30014, "message": "Token is invalid.", "data": null}`,没有 `error` 外层,`e.code` 是 `'30014'`(SDK 把数字转成了字符串),`e.type` 是 `None`。
- **404 的 message 一个是空的、一个是 `Not Found`。**

结论只有一条:**分类要靠状态码和异常类,不要靠解析 `message` 的文字**。文字每家不同、每个版本可能变;状态码是 HTTP 规定的,最稳。`message` 留给人看,不留给代码判断。

## 造不出来的错:自己写一个假服务器

有些错你没法安全地在真厂商上造:402 要先把余额花光;429 要冲到并发上限(DeepSeek 的上限在文档里写的是 `deepseek-flash` 同时 2500 个请求,你的账号很难碰到);500 和 503 是厂商故障,更没法按需触发。但我们必须测试「遇到这些错时代码的反应对不对」。办法是在自己电脑上起一个假的服务器,让它按我们的要求返回任意状态码。

Day 77、78 讲过服务端是什么:一个一直开着的程序,收到请求,按请求内容产生响应。Python 标准库自带一个最小的 HTTP 服务器模块,不用装任何东西,相当于 Node 的 `http.createServer`。新建 `part02/fake_llm.py`:

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


class FakeServer(ThreadingHTTPServer):
    requests_seen: list[str]


class Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", 0))
        model = json.loads(self.rfile.read(length)).get("model", "")
        cast(FakeServer, self.server).requests_seen.append(model)
        kind, _, arg = model.partition("-")
        if kind == "sleep":
            time.sleep(float(arg))
            self.reply(200, json.dumps(OK_BODY), "application/json")
        elif kind == "status":
            err = {"error": {"message": f"假的 {arg} 错误", "type": "fake_error", "param": None, "code": "fake"}}
            self.reply(int(arg), json.dumps(err), "application/json")
        elif kind == "quota":
            err = {"error": {"message": "额度用完了", "type": "insufficient_quota", "param": None,
                             "code": "insufficient_quota"}}
            self.reply(429, json.dumps(err), "application/json")
        elif kind == "html":
            self.reply(int(arg), "<html><body>502 Bad Gateway</body></html>", "text/html")
        else:
            self.reply(200, json.dumps(OK_BODY), "application/json")

    def reply(self, status: int, body: str, content_type: str) -> None:
        data = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format: str, *args: object) -> None:
        pass


@contextmanager
def fake_server() -> Iterator[tuple[str, FakeServer]]:
    server = FakeServer(("127.0.0.1", 0), Handler)
    server.requests_seen = []
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}", server
    finally:
        server.shutdown()
        server.server_close()
```

<div class="line-notes">

- `import threading` 服务器要一直等请求,放在主线程里会卡住后面的代码,所以把它放进一个单独的线程里跑。线程可以理解成「同一个程序里并排跑的另一条流水线」。
- `from collections.abc import Iterator` 给下面 `fake_server` 的返回类型用。
- `from contextlib import contextmanager` 让一个函数变成能放进 `with` 的东西,[Day 98](/blog/agent-zero/day-098-context-managers/) 讲过 `with` 背后的原理。
- `from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer` 标准库里的两个类:`BaseHTTPRequestHandler` 是「处理一个请求」的基类,`ThreadingHTTPServer` 是「监听端口、每来一个请求开一个线程去处理」的服务器。
- `from typing import cast` 告诉编辑器「相信我,这个对象就是这个类型」,运行时什么都不做。
- `OK_BODY = {` 一个最小的、SDK 认得的成功响应:有 `id`、`object`、`created`、`model`、`choices` 和 `usage`。字段缺了 SDK 会报校验错误。`content` 写了「假服务器说:你好」,一看就知道不是真模型。
- `"created": 1_790_000_000,` 时间戳(秒)。数字里的下划线只是为了好读。
- `class FakeServer(ThreadingHTTPServer):` 继承标准库的服务器,只多加一个属性。
- `requests_seen: list[str]` 记录服务器一共收到了哪些请求(记模型名)。「收到了几次请求」是测试重试时最重要的证据,Day 127 要用。
- `class Handler(BaseHTTPRequestHandler):` 一个请求来了,标准库会为它建一个 `Handler` 对象,并按请求方法调用对应的方法:POST 请求调 `do_POST`。
- `length = int(self.headers.get("Content-Length", 0))` 请求头里的 `Content-Length` 说明请求体有多少字节([Day 61](/blog/agent-zero/day-061-http-3/) 讲过请求体)。头里的值是字符串,要 `int()`。
- `model = json.loads(self.rfile.read(length)).get("model", "")` `self.rfile` 是请求体的字节流,读 `length` 个字节,`json.loads` 变成字典,取出 `model`。**我们用请求里的模型名来指挥假服务器怎么回**,不用另外开接口。
- `cast(FakeServer, self.server).requests_seen.append(model)` `self.server` 是启动这个处理器的服务器对象,把模型名记进去。
- `kind, _, arg = model.partition("-")` `"status-429".partition("-")` 得到三元组 `("status", "-", "429")`,中间的分隔符不要,用 `_` 接住。所以模型名 `status-429` 的意思是「返回 429」。
- `if kind == "sleep":` 模型名 `sleep-3`:先睡 3 秒再返回正常响应,模拟「厂商很慢」。
- `time.sleep(float(arg))` 让这个线程睡 `arg` 秒。别的请求不受影响,因为每个请求一个线程。
- `self.reply(200, json.dumps(OK_BODY), "application/json")` 睡醒之后返回成功响应。
- `elif kind == "status":` 模型名 `status-429`、`status-503`:返回对应的状态码和一个 OpenAI 风格的错误体。
- `err = {"error": {"message": f"假的 {arg} 错误", "type": "fake_error", "param": None, "code": "fake"}}` 错误体的形状和 DeepSeek 的一样,SDK 会照这个形状解析出 `e.body`。
- `self.reply(int(arg), json.dumps(err), "application/json")` `int("429")` 变成数字 429。
- `elif kind == "quota":` 模型名 `quota-429`:返回 429,但错误体里的 `code` 是 `insufficient_quota`。这是 OpenAI 官方 API 的一个真实习惯:额度用完了也回 429。后面 `classify` 要认出它。
- `elif kind == "html":` 模型名 `html-502`、`html-200`:返回一段 HTML 网页,不是 JSON。真实世界里,公司网络的代理、CDN 和网关出故障时,会回一个这样的页面。
- `else:` 别的模型名一律返回成功。
- `def reply(self, status: int, body: str, content_type: str) -> None:` 把「发一个响应」收成一个方法,四个模式都用它。
- `data = body.encode("utf-8")` 字符串变字节。后面 `Content-Length` 要写字节数,中文一个字占 3 个字节,所以必须先编码再数。
- `self.send_response(status)` 写状态行,如 `HTTP/1.0 429 Too Many Requests`。
- `self.send_header("Content-Length", str(len(data)))` 告诉客户端响应体有多长。头的值必须是字符串。
- `self.end_headers()` 头写完了,空一行,后面是响应体。
- `self.wfile.write(data)` 把响应体写出去。
- `def log_message(self, format: str, *args: object) -> None:` 标准库默认每个请求都往终端打一行日志。重写成什么都不做,输出才干净。
- `@contextmanager` 把下面这个「生成器函数」变成能放进 `with` 的东西。`yield` 之前是进入 `with` 时做的事,`yield` 之后是退出时做的事。这里用到了 [Day 99](/blog/agent-zero/day-099-generators/) 的生成器。
- `server = FakeServer(("127.0.0.1", 0), Handler)` 监听本机的一个端口。端口写 0 的意思是「让操作系统随便给我一个空的」,这样不会和别的程序抢端口,测试可以反复跑。
- `server.requests_seen = []` 给记录列表赋一个空列表。
- `thread = threading.Thread(target=server.serve_forever, daemon=True)` 开一条线程去跑 `serve_forever`(一直等请求)。`daemon=True` 表示主程序结束时这条线程自动跟着结束,不会卡住退出。
- `yield f"http://127.0.0.1:{server.server_address[1]}", server` 把「地址」和「服务器对象」交给 `with ... as (url, server)` 的两个变量。`server_address[1]` 是操作系统分到的端口号。
- `server.shutdown()` 离开 `with` 时让 `serve_forever` 停下来。写在 `finally` 里,即使 `with` 里面的代码抛了异常也会执行。
- `server.server_close()` 释放端口。

</div>

这个文件在后面两天都会用到。先用它把前面那张表补全,新建 `part02/errors_table.py`:

```python
# agent-zero-lab/part02/errors_table.py
import openai
from openai import OpenAI

from part02.fake_llm import fake_server

MODELS = ["status-400", "status-401", "status-402", "status-403", "status-404", "status-409", "status-422",
          "status-429", "status-500", "status-503", "html-502", "html-200", "sleep-3"]

with fake_server() as (url, server):
    client = OpenAI(base_url=url, api_key="sk-fake", max_retries=0, timeout=1)
    for model in MODELS:
        try:
            resp = client.chat.completions.create(model=model, messages=[{"role": "user", "content": "hi"}])
            print(f"{model} | 拿到 {type(resp).__name__}")
        except openai.APIStatusError as e:
            print(f"{model} | {type(e).__name__} | {e.status_code} | 直接父类 {type(e).__mro__[1].__name__}")
        except openai.APIError as e:
            print(f"{model} | {type(e).__name__} | -- | {e.message}")
    print("服务器一共收到", len(server.requests_seen), "个请求")
```

<div class="line-notes">

- `from part02.fake_llm import fake_server` 刚写的假服务器。从 `part02` 包里导入,所以要用 `-m` 方式运行。
- `MODELS = ["status-400",` 每个名字让假服务器回一种响应:前面一串是状态码,`html-502` 是 502 加网页,`html-200` 是 **200 加网页**,`sleep-3` 是睡 3 秒。
- `with fake_server() as (url, server):` 进入时启动服务器,拿到地址和服务器对象;缩进里的代码跑完,自动关掉。
- `client = OpenAI(base_url=url, api_key="sk-fake", max_retries=0, timeout=1)` 客户端指向假服务器。key 随便写,假服务器不检查。`timeout=1` 是 1 秒:`sleep-3` 要睡 3 秒,一定超时。
- `resp = client.chat.completions.create(model=model, messages=[{"role": "user", "content": "hi"}])` 这里的 `model` 就是给假服务器的指令。
- `print(f"{model} | 拿到 {type(resp).__name__}")` 没抛异常就打印拿到的是什么类型。正常应该是 `ChatCompletion`,下面会看到 `html-200` 是个意外。
- `print(f"{model} | {type(e).__name__} | {e.status_code} | 直接父类 {type(e).__mro__[1].__name__}")` `__mro__[1]` 是继承链的第二项,也就是直接父类。这样能一眼看出哪个状态码没有专属类。
- `print(f"{model} | {type(e).__name__} | -- | {e.message}")` 超时没有状态码。
- `print("服务器一共收到", len(server.requests_seen), "个请求")` 13 个模型各发一次,服务器应该收到 13 个。`max_retries=0` 保证没有偷偷多发的。

</div>

```bash
uv run python -m part02.errors_table
```

实跑输出:

```text
status-400 | BadRequestError | 400 | 直接父类 APIStatusError
status-401 | AuthenticationError | 401 | 直接父类 APIStatusError
status-402 | APIStatusError | 402 | 直接父类 APIError
status-403 | PermissionDeniedError | 403 | 直接父类 APIStatusError
status-404 | NotFoundError | 404 | 直接父类 APIStatusError
status-409 | ConflictError | 409 | 直接父类 APIStatusError
status-422 | UnprocessableEntityError | 422 | 直接父类 APIStatusError
status-429 | RateLimitError | 429 | 直接父类 APIStatusError
status-500 | InternalServerError | 500 | 直接父类 APIStatusError
status-503 | InternalServerError | 503 | 直接父类 APIStatusError
html-502 | InternalServerError | 502 | 直接父类 APIStatusError
html-200 | 拿到 str
sleep-3 | APITimeoutError | -- | Request timed out.
服务器一共收到 13 个请求
```

对照前面那棵树,每一行都能解释:402 的直接父类是 `APIError`,说明它就是 `APIStatusError` 本身;409 是 `ConflictError`,500 和 503 都落在 `InternalServerError`(所以它的名字是「500 以上」),`html-502` 也是,SDK 对响应体不是 JSON 的情况也能处理,`e.body` 就是那段网页字符串;`sleep-3` 在 1 秒的超时下得到 `APITimeoutError`。服务器收到 13 个请求,和发出的数量一致,说明 `max_retries=0` 真的生效了。

### 最危险的一行:`html-200 | 拿到 str`

倒数第二行是整张表里唯一没报错的失败。假服务器对 `html-200` 回了 **HTTP 200**,响应体是一段 HTML 网页。SDK 看到 2xx 就认为请求成功,想把响应体解析成 JSON,解析不了,于是**把原始字符串当结果直接返回**。你拿到的 `resp` 是一个 `str`,不是 `ChatCompletion`。下一行你写 `resp.choices[0]` 时才会炸:

```text
AttributeError: 'str' object has no attribute 'choices'
```

报错位置在你自己的代码里,看着像「SDK 返回类型不对」,实际是路上某个设备(公司代理、校园网认证页、CDN)在你和厂商之间插了一个网页进来。这种情况在公司内网和某些酒店 Wi-Fi 上真的会碰到。编辑器帮不了你,因为 SDK 的类型标注说返回的是 `ChatCompletion`。遇到「`'str' object has no attribute`」类的错,第一反应是 `print(type(resp), resp[:200])`,看看拿到的是什么。练习 3 会写一个根治的检查。

## 谁的问题,要不要重试

12 种真错加 13 种假错,可以归成五类。这一张表是今天的核心,也是 Day 3 旧课那张「错误码表」的完整版:

| 类别 | 典型状态码 / 异常 | 说明 | 要不要重试 | 该找谁 |
| --- | --- | --- | --- | --- |
| 你的代码 | 400、404、422 | 请求本身有毛病:参数越界、字段类型不对、地址路径错 | 不要,原样发一百遍还是同一个错 | 开发者:读 `message`,改代码或配置 |
| 你的账号 | 401、402、403,以及 429 里 `code=insufficient_quota` | key 无效、余额不足、没有权限、额度用完 | 不要,不充值不换 key 永远不会好 | 账号负责人:查控制台、充值、换 key |
| 太快了 | 429 | 请求速率或并发超过上限 | 要,但要等,并且要降低发送速度 | 开发者:限并发,下一课 |
| 厂商 | 500、502、503、504、409 | 服务器故障、过载、网关错误 | 要,等一会儿再试,多试几次还不行就换厂商或报警 | 厂商,你只能等和切换 |
| 网络 | `APIConnectionError`、`APITimeoutError`、408 | 没连上、等太久 | 要,但要想想这次请求是不是可能已经被处理了 | 网络环境:代理、DNS、超时设置 |

几处容易想当然的地方:

- **429 不一定是「太快了」。** DeepSeek 的 [限速页](https://api-docs.deepseek.com/zh-cn/quick_start/rate_limit)写的 429 是「并发超限」:每个账号同时在途的请求数,`deepseek-flash` 是 2500、`deepseek-v4-pro` 是 500,请求从发出到模型响应完成都算一个并发,和有几个 key 无关。OpenAI 官方 API 还有另一种 429:额度用完了,错误体里 `code` 是 `insufficient_quota`。同样是 429,前者等一等就好,后者重试一万次也没用。所以分类 429 时要多看一眼 `e.code`。这一条我在假服务器上验证了逻辑,没在真 OpenAI 上跑过(我没有它的 key)。
- **402 没有专属异常类**,只能看 `e.status_code`。
- **超时的请求可能已经被处理了。** 你的请求发出去,厂商开始算了,只是回答来得太慢,你这边放弃了。再试一次,等于让厂商算了两遍。对「问一个问题」来说无所谓(多花几厘钱),对「调用一个会扣款、发邮件、写库的工具」就是灾难。这一条先记着,第三部分讲工具调用时会回来。
- **DeepSeek 的超时比你想的宽。** 默认读超时是 600 秒(`Timeout(connect=5.0, read=600, ...)`)。限速页还写了「请求保活机制」:请求发出后如果还在排队,服务器会持续返回空行把连接撑住,10 分钟之后仍没开始推理才关连接。所以 DeepSeek 慢的时候你看到的是「卡住很久」而不是报错,生产代码要自己设一个合理的超时(练习 5)。

## 写 classify

现在把这张表翻译成代码。新建 `part02/classify.py`:

```python
# agent-zero-lab/part02/classify.py
from dataclasses import dataclass
from typing import Literal

import openai

Kind = Literal["你的代码", "你的账号", "太快了", "厂商", "网络", "没见过"]


@dataclass(frozen=True)
class Verdict:
    kind: Kind
    retry: bool
    advice: str
    status: int | None = None


def classify(e: BaseException) -> Verdict:
    if isinstance(e, openai.APITimeoutError):
        return Verdict("网络", True, "等太久了:检查 timeout 设得对不对、厂商是不是在变慢")
    if isinstance(e, openai.APIConnectionError):
        return Verdict("网络", True, "没连上:检查网络、代理和 LLM_BASE_URL")
    if isinstance(e, openai.RateLimitError):
        if e.code == "insufficient_quota":
            return Verdict("你的账号", False, "额度用完了:去充值,重试没用", 429)
        return Verdict("太快了", True, "请求太密:等一会儿再试,并降低并发", 429)
    if isinstance(e, openai.AuthenticationError):
        return Verdict("你的账号", False, "key 不对或已作废:检查配置文件里的 LLM_API_KEY", 401)
    if isinstance(e, openai.PermissionDeniedError):
        return Verdict("你的账号", False, "没有权限(模型没开通、地区受限):查控制台", 403)
    if isinstance(e, openai.NotFoundError):
        return Verdict("你的代码", False, "地址或模型不存在:检查 LLM_BASE_URL 的路径", 404)
    if isinstance(e, (openai.BadRequestError, openai.UnprocessableEntityError)):
        return Verdict("你的代码", False, "请求本身有问题:读 e.message,改参数", e.status_code)
    if isinstance(e, openai.ConflictError):
        return Verdict("厂商", True, "冲突或锁超时:稍后重试", 409)
    if isinstance(e, openai.InternalServerError):
        return Verdict("厂商", True, "厂商那边出故障或过载:等一会儿重试", e.status_code)
    if isinstance(e, openai.APIStatusError):
        if e.status_code == 402:
            return Verdict("你的账号", False, "余额不足:去充值,重试没用", 402)
        if e.status_code == 408:
            return Verdict("网络", True, "请求超时:稍后重试", 408)
        return Verdict("没见过", False, f"没见过的状态码 {e.status_code}:先读 e.body", e.status_code)
    return Verdict("你的代码", False, f"不是 SDK 的错误({type(e).__name__}):先查自己的代码")
```

<div class="line-notes">

- `from typing import Literal` Day 47 学的字面量类型,让变量只能取几个指定的值。
- `import openai` 要用里面的异常类。
- `Kind = Literal["你的代码", "你的账号", "太快了", "厂商", "网络", "没见过"]` 一个类型别名:六个字符串之一。写错一个字,编辑器会画红线,比到处写裸字符串可靠。「没见过」留给将来出现的、表里没有的状态码。
- `@dataclass(frozen=True)` 和 Day 124 的 `Price` 一样,建好不能改。判断结果是一个事实,不该被后面的代码偷偷改掉。
- `class Verdict:` 一次判断的结果。
- `kind: Kind` 属于哪一类。
- `retry: bool` 要不要重试。今天只给判断,不执行重试。
- `advice: str` 一句话建议,给人看。
- `status: int | None = None` 状态码,连不上和超时没有,所以可以是 `None`;有默认值 `None`,构造时可以不传。
- `def classify(e: BaseException) -> Verdict:` 收任何异常,返回判断。参数写成 `BaseException` 而不是 `OpenAIError`,因为我们要处理「不是 SDK 的错」。
- `if isinstance(e, openai.APITimeoutError):` `isinstance(e, 某个类)` 判断 `e` 是不是这个类的对象,**子类的对象也算**。所以子类必须先判断:`APITimeoutError` 是 `APIConnectionError` 的子类,顺序反过来,超时就会被当成「没连上」。
- `return Verdict("网络", True, "等太久了:检查 timeout 设得对不对、厂商是不是在变慢")` 前三个参数按位置传:类别、能重试、建议。状态码没传,用默认的 `None`。
- `if isinstance(e, openai.APIConnectionError):` 到这里已经排除了超时,剩下的就是没连上。
- `if isinstance(e, openai.RateLimitError):` 429。
- `if e.code == "insufficient_quota":` 同样是 429,看 `e.code`:这是 OpenAI 官方 API 的「额度用完」。
- `return Verdict("你的账号", False, "额度用完了:去充值,重试没用", 429)` 归到「你的账号」,不重试。
- `return Verdict("太快了", True, "请求太密:等一会儿再试,并降低并发", 429)` 其余的 429 才是真的太快。
- `if isinstance(e, openai.AuthenticationError):` 401。
- `if isinstance(e, openai.PermissionDeniedError):` 403,典型原因是模型没开通或地区限制。
- `if isinstance(e, openai.NotFoundError):` 404,多半是 `base_url` 的路径不对。模型名写错时,DeepSeek 返回 400,据我所知 OpenAI 官方 API 返回的是 404,各家不一样,所以这里的建议只写「检查地址」。
- `if isinstance(e, (openai.BadRequestError, openai.UnprocessableEntityError)):` `isinstance` 的第二个参数可以是一个元组,表示「是其中任何一个」。400 和 422 对你来说没区别,合并成一类。
- `return Verdict("你的代码", False, "请求本身有问题:读 e.message,改参数", e.status_code)` 这里 `e.status_code` 能写,是因为类型检查器已经从 `isinstance` 知道 `e` 是 `APIStatusError` 的子类了。
- `if isinstance(e, openai.ConflictError):` 409,SDK 自己也会重试它,按「厂商」处理。
- `if isinstance(e, openai.InternalServerError):` 500 及以上。
- `if isinstance(e, openai.APIStatusError):` **兜底**放在所有具体子类的后面。402 没有专属类,走到这里。
- `if e.status_code == 402:` 402,余额不足,在这里单独认出来。
- `if e.status_code == 408:` 408 是服务器说「你的请求发得太慢,我等不及了」,按网络类处理。
- `return Verdict("没见过", False, f"没见过的状态码 {e.status_code}:先读 e.body", e.status_code)` 表里没有的状态码(比如测试里的 418),宁可保守地不重试,把原因交给人看。
- `return Verdict("你的代码", False, f"不是 SDK 的错误({type(e).__name__}):先查自己的代码")` 最后一道:根本不是 SDK 抛的(`KeyError`、`AttributeError`……),那就是自己的 bug,重试没用。

</div>

## 用测试把这张表钉住

分类函数的每一行都对应一个现实场景,写错一行就会在半夜出事,所以必须有测试。用假服务器造出每种错,断言 `classify` 的结果。新建 `tests/test_classify.py`:

```python
# agent-zero-lab/tests/test_classify.py
from collections.abc import Iterator

import openai
import pytest
from openai import OpenAI

from part02.classify import Verdict, classify
from part02.fake_llm import fake_server


@pytest.fixture(scope="module")
def client() -> Iterator[OpenAI]:
    with fake_server() as (url, _):
        yield OpenAI(base_url=url, api_key="sk-fake", max_retries=0, timeout=1)


def verdict_for(client: OpenAI, model: str) -> Verdict:
    with pytest.raises(openai.OpenAIError) as info:
        client.chat.completions.create(model=model, messages=[{"role": "user", "content": "hi"}])
    return classify(info.value)


CASES = [
    ("status-400", "你的代码", False),
    ("status-401", "你的账号", False),
    ("status-402", "你的账号", False),
    ("status-403", "你的账号", False),
    ("status-404", "你的代码", False),
    ("status-422", "你的代码", False),
    ("status-429", "太快了", True),
    ("quota-429", "你的账号", False),
    ("status-409", "厂商", True),
    ("status-500", "厂商", True),
    ("status-503", "厂商", True),
    ("html-502", "厂商", True),
    ("status-418", "没见过", False),
    ("sleep-3", "网络", True),
]


@pytest.mark.parametrize("model, kind, retry", CASES, ids=[c[0] for c in CASES])
def test_classify(client: OpenAI, model: str, kind: str, retry: bool):
    v = verdict_for(client, model)
    assert (v.kind, v.retry) == (kind, retry)


def test_connection_refused():
    bad = OpenAI(base_url="http://127.0.0.1:9", api_key="sk-fake", max_retries=0)
    with pytest.raises(openai.APIConnectionError) as info:
        bad.chat.completions.create(model="x", messages=[{"role": "user", "content": "hi"}])
    assert classify(info.value) == Verdict("网络", True, "没连上:检查网络、代理和 LLM_BASE_URL")


def test_not_sdk_error():
    v = classify(KeyError("LLM_API_KEY"))
    assert v.kind == "你的代码" and not v.retry
```

<div class="line-notes">

- `from collections.abc import Iterator` 给 fixture 的返回类型用。
- `import pytest` Day 71–73 的测试框架。
- `from part02.classify import Verdict, classify` 要测的函数。能这样导入,靠的是 [Day 72](/blog/agent-zero/day-072-pytest-2/) 配好的 `pythonpath = ["."]`。
- `@pytest.fixture(scope="module")` Day 73 的 fixture:给测试准备东西。`scope="module"` 表示这个文件里所有测试共用一个,不是每个测试都启动一次假服务器。
- `def client() -> Iterator[OpenAI]:` 函数里用了 `yield`,所以它是个生成器,类型写成 `Iterator[OpenAI]`。`yield` 之前是准备,之后是收尾,和 `@contextmanager` 一个道理。
- `with fake_server() as (url, _):` 启动假服务器。地址要用,服务器对象不要,用 `_` 接住。
- `yield OpenAI(base_url=url, api_key="sk-fake", max_retries=0, timeout=1)` 把客户端交给测试用。这一行在 `with` 里面,所以所有用到这个客户端的测试结束以前,假服务器一直开着。
- `def verdict_for(client: OpenAI, model: str) -> Verdict:` 一个辅助函数:向假服务器发一个会出错的请求,返回 `classify` 的判断。不带 `test_` 开头,pytest 不会把它当测试。
- `with pytest.raises(openai.OpenAIError) as info:` Day 73 的 `pytest.raises`:断言里面一定抛 `OpenAIError`,并把异常对象放进 `info`。
- `return classify(info.value)` `info.value` 是被接住的那个异常对象。
- `CASES = [` 一张「模型名、期望类别、期望要不要重试」的表,和上面那张文字表一一对应。
- `("quota-429", "你的账号", False),` 同样是 429,额度用完的要被分到「你的账号」,不重试。
- `("status-418", "没见过", False),` 418 是个愚人节彩蛋状态码(「我是茶壶」),表里没有,验证兜底。
- `@pytest.mark.parametrize("model, kind, retry", CASES, ids=[c[0] for c in CASES])` 一份测试代码跑 14 次,每个用例一组参数。`ids` 给每个用例起名字,不加的话中文会被转义成一串 `你` 很难读。
- `assert (v.kind, v.retry) == (kind, retry)` 同时断言类别和是否重试。元组可以直接比较。
- `def test_connection_refused():` 连接被拒绝不用假服务器,指向本机 9 号端口就行。
- `assert classify(info.value) == Verdict("网络", True, "没连上:检查网络、代理和 LLM_BASE_URL")` dataclass 自动生成了 `==`,所有字段相同才相等。这条把整个对象(包括 advice 文字)都钉住了。
- `def test_not_sdk_error():` 传一个不是 SDK 的 `KeyError`,验证最后一道兜底。
- `assert v.kind == "你的代码" and not v.retry` 自己的 bug,不重试。

</div>

先别急着看通过。我第一次写 `classify` 时,把「`isinstance(e, openai.APIStatusError)` 兜底」那一段写在了函数最前面,脑子里想的是「先挡住所有 HTTP 错误,再细分」。你可以把那一段临时剪下来贴到 `def classify` 下面第一行,跑测试看看:

```bash
uv run pytest tests/test_classify.py -q
```

```text
FAILED tests/test_classify.py::test_classify[status-400] - AssertionError: as...
FAILED tests/test_classify.py::test_classify[status-401] - AssertionError: as...
FAILED tests/test_classify.py::test_classify[status-403] - AssertionError: as...
FAILED tests/test_classify.py::test_classify[status-404] - AssertionError: as...
FAILED tests/test_classify.py::test_classify[status-422] - AssertionError: as...
FAILED tests/test_classify.py::test_classify[status-429] - AssertionError: as...
FAILED tests/test_classify.py::test_classify[quota-429] - AssertionError: ass...
FAILED tests/test_classify.py::test_classify[status-409] - AssertionError: as...
FAILED tests/test_classify.py::test_classify[status-500] - AssertionError: as...
FAILED tests/test_classify.py::test_classify[status-503] - AssertionError: as...
FAILED tests/test_classify.py::test_classify[html-502] - AssertionError: asse...
11 failed, 5 passed in 3.70s
```

16 个测试挂了 11 个。前面看到的 `AssertionError` 是 `('没见过', False) == ('厂商', True)` 这类:所有状态码错误都被最前面那个兜底的 `if` 接走,走进了「没见过」,下面八个具体的分支永远走不到。活下来的 5 个是 402、418(本来就该是「没见过」/402 分支)、`sleep-3`、连接被拒和 KeyError。这就是前面说的 `except` 和 `isinstance` 顺序:**具体的在前,通用的兜底在最后**。把那一段放回原位,再跑:

```bash
uv run pytest tests/test_classify.py -v
```

```text
tests/test_classify.py::test_classify[status-400] PASSED
tests/test_classify.py::test_classify[status-401] PASSED
tests/test_classify.py::test_classify[status-402] PASSED
tests/test_classify.py::test_classify[status-403] PASSED
tests/test_classify.py::test_classify[status-404] PASSED
tests/test_classify.py::test_classify[status-422] PASSED
tests/test_classify.py::test_classify[status-429] PASSED
tests/test_classify.py::test_classify[quota-429] PASSED
tests/test_classify.py::test_classify[status-409] PASSED
tests/test_classify.py::test_classify[status-500] PASSED
tests/test_classify.py::test_classify[status-503] PASSED
tests/test_classify.py::test_classify[html-502] PASSED
tests/test_classify.py::test_classify[status-418] PASSED
tests/test_classify.py::test_classify[sleep-3] PASSED
tests/test_classify.py::test_connection_refused PASSED
tests/test_classify.py::test_not_sdk_error PASSED
============================== 16 passed in 2.88s ==============================
```

16 个全过。注意 `status-402` 也在里面:SDK 没有 402 的专属类,是我们自己在兜底分支里认出来的,这一条不写测试,哪天有人把兜底分支删了都不会发现。

## 拼起来:按错误类型给退出码的 ask_safe.py

最后把它放进一个真的会用到的脚本里。Day 122 的 `ask2.py` 在「没说完」时 `sys.exit(1)`;今天换成更细的退出码,让调用它的脚本或 CI 能分辨「重试有用」和「重试没用」:0 成功,2 重试没用(改代码、改配置、充值),3 重试有用(网络、限速、厂商故障)。新建 `part02/ask_safe.py`:

```python
# agent-zero-lab/part02/ask_safe.py
import json
import os
import sys

import openai
from dotenv import load_dotenv
from openai import OpenAI

from part02.classify import classify
from part02.week18_lab import IncompleteAnswer, read_answer

load_dotenv(os.environ.get("ENV_FILE", ".env"), override=True)
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"], max_retries=0, timeout=30)
extra_body = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
question = sys.argv[1] if len(sys.argv) > 1 else "用一句话介绍你自己"

try:
    resp = client.chat.completions.create(
        model=os.environ["LLM_MODEL"],
        messages=[{"role": "user", "content": question}],
        max_tokens=int(os.environ.get("MAX_TOKENS", "300")),
        extra_body=extra_body,
    )
    print(read_answer(resp))
except IncompleteAnswer as e:
    print(f"模型没说完({e}):把环境变量 MAX_TOKENS 调大再试", file=sys.stderr)
    sys.exit(2)
except openai.OpenAIError as e:
    v = classify(e)
    print(f"出错了 [{v.kind}] 状态码 {v.status}:{v.advice}", file=sys.stderr)
    print(f"可以重试: {v.retry}", file=sys.stderr)
    sys.exit(3 if v.retry else 2)
```

<div class="line-notes">

- `from part02.classify import classify` 今天写的分类函数。
- `from part02.week18_lab import IncompleteAnswer, read_answer` Day 125 小项目里的两样东西:自定义的「没说完」异常和检查 `finish_reason` 的函数。能直接导入,是因为那个文件的体检放在 `if __name__ == "__main__":` 下面,导入不会触发调用。
- `load_dotenv(os.environ.get("ENV_FILE", ".env"), override=True)` 选厂商的老写法。
- `client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"], max_retries=0, timeout=30)` `max_retries=0` 是因为重试交给明天的代码来写;`timeout=30` 是整个请求最长等 30 秒,比默认的 600 秒合理得多。
- `question = sys.argv[1] if len(sys.argv) > 1 else "用一句话介绍你自己"` 命令行给问题就用,没给用默认。
- `max_tokens=int(os.environ.get("MAX_TOKENS", "300")),` 用环境变量控制,方便演示截断。环境变量都是字符串,要 `int(...)`。
- `print(read_answer(resp))` 先查 `finish_reason` 再打印回答。没说完时 `read_answer` 抛 `IncompleteAnswer`。
- `except IncompleteAnswer as e:` 「没说完」不是 SDK 的错,单独接。要写在 `except openai.OpenAIError` 前面或后面都行,它们没有继承关系。
- `print(f"模型没说完({e}):把环境变量 MAX_TOKENS 调大再试", file=sys.stderr)` 错误信息打到标准错误(stderr),和正常回答分开,脚本被别的程序调用时,正常输出不会混进报错。
- `sys.exit(2)` 退出码 2:重试没用,要改参数。
- `except openai.OpenAIError as e:` SDK 的所有错误。
- `v = classify(e)` 交给今天写的函数判断。
- `print(f"出错了 [{v.kind}] 状态码 {v.status}:{v.advice}", file=sys.stderr)` 把类别、状态码和建议打给人看。连不上时状态码是 `None`,照样能打印。
- `sys.exit(3 if v.retry else 2)` 能重试退出 3,不能重试退出 2。

</div>

用三份配置各跑一次:`.env` 是正常的;`.env.badkey` 是把 `.env` 里的 key 换成 `sk-` 加 32 个 0;`.env.nohost` 是把地址换成 `http://127.0.0.1:9`。这两份是临时的试验文件,Day 120 的 `.gitignore` 里 `.env.*` 规则已经把它们挡在 git 外面。再用 `MAX_TOKENS=10` 造一次截断:

```bash
cp .env .env.badkey && sed -i '' 's/^LLM_API_KEY=.*/LLM_API_KEY=sk-00000000000000000000000000000000/' .env.badkey
cp .env .env.nohost && sed -i '' 's#^LLM_BASE_URL=.*#LLM_BASE_URL=http://127.0.0.1:9#' .env.nohost
ENV_FILE=.env.badkey uv run python -m part02.ask_safe; echo "exit=$?"
```

(`sed -i ''` 是 macOS 的写法;Linux 上去掉那对空引号。)一次跑完四种情况,输出:

```text
$ ENV_FILE=.env uv run python -m part02.ask_safe
能改，但需区分是当月开具还是跨月：当月通常可直接作废重开，跨月一般需开具红字发票冲销后重开。
exit=0
$ ENV_FILE=.env.badkey uv run python -m part02.ask_safe
出错了 [你的账号] 状态码 401:key 不对或已作废:检查配置文件里的 LLM_API_KEY
可以重试: False
exit=2
$ ENV_FILE=.env.nohost uv run python -m part02.ask_safe
出错了 [网络] 状态码 None:没连上:检查网络、代理和 LLM_BASE_URL
可以重试: True
exit=3
$ MAX_TOKENS=10 uv run python -m part02.ask_safe
模型没说完(finish_reason=length):把环境变量 MAX_TOKENS 调大再试
exit=2
```

四种情况四个结局:正常回答退出 0;假 key 判成「你的账号」、不重试、退出 2;没人监听判成「网络」、能重试、退出 3;截断是我们自己抛的 `IncompleteAnswer`,退出 2。**同样是失败,处理方式完全不同**,这就是分类的价值。明天 Day 127 会把「能重试」这半边接上真正的重试循环。

### 零件 → 大代码对照

| 零件 | 在哪 | 做什么 |
| --- | --- | --- |
| 三条线索 | `err_401.py` | 状态码、响应体、异常类,外加 `request_id` 和 `x-ds-trace-id` |
| 异常类树 | 上面那张图,`errors_table.py` 的「直接父类」 | 决定 `except`/`isinstance` 的顺序 |
| 12 种真错 | `err_real.py` | 在 DeepSeek 和硅基流动上造,对比差异 |
| 假服务器 | `fake_llm.py` | 造 402、429、5xx、200 网页、慢响应,并记下收到几个请求 |
| 分类 | `classify.py` | `Verdict(kind, retry, advice, status)` |
| 16 个测试 | `tests/test_classify.py` | 钉住分类表,抓住顺序错误 |
| 按类退出 | `ask_safe.py` | 0 成功,2 重试没用,3 重试有用 |

## 动手练习

**练习 1:同样的错,换一家。** 把 `err_real.py` 切到 `.env.sf` 再跑一遍(正文已经演示了),然后回答:哪几个案例两家结果不同?如果你的代码里写了「遇到 422 就打印参数错误」,换成硅基流动会发生什么?

<details><summary>参考答案</summary>

不用写新代码:

```bash
ENV_FILE=.env.sf uv run python -m part02.err_real
```

输出就是正文那张硅基流动的表。对比 DeepSeek:

- 结果不同的有 6 个:`temperature=5`、`max_tokens=0`、`max_tokens=1 千万` 硅基流动放行(DeepSeek 都是 400);`max_tokens=-5` 和 `role=boss` 硅基流动是 400(DeepSeek 是 422);`地址多写 /v2` 两家都是 404,但 message 一个空、一个是 `Not Found`。
- 「遇到 422 就打印参数错误」换到硅基流动后**永远不会触发**,它把这类错都归在 400。更糟的是,`temperature=5` 这种在 DeepSeek 上被拦下的请求,在硅基流动上被放行,模型会按 5 的温度生成一堆乱码,**没有任何报错**,你会误以为参数是合法的。

所以分类要把 400 和 422 合并(`classify` 就是这么做的),并且换厂商前要自己把参数范围检查一遍,不能指望服务器替你拦。

</details>

**练习 2:错误信息里别带 key。** 写 `part02/redact.py`,函数 `redact(text, key="")`:把文字里完整出现的 `key` 换成 `***`,再把所有形如 `sk-` 后面跟 8 个以上字母数字的串换成 `sk-***`。用四条样本试:DeepSeek 的 401 原文、一个把完整 key 回显的假想错误、硅基流动的 401 原文、一个自定义 key 被回显的句子。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/redact.py
import re

KEY_LIKE = re.compile(r"sk-[A-Za-z0-9_-]{8,}")


def redact(text: str, key: str = "") -> str:
    if len(key) >= 8:
        text = text.replace(key, "***")
    return KEY_LIKE.sub("sk-***", text)


if __name__ == "__main__":
    fake_key = "sk-test1234567890abcdef"
    samples = [
        "Authentication Fails, Your api key: ****0000 is invalid",
        f"Incorrect API key provided: {fake_key}",
        "Token is invalid.",
        "key=mykey-abcdefgh12345678 被回显了",
    ]
    for s in samples:
        print("原文:", s)
        print("脱敏:", redact(s, "mykey-abcdefgh12345678"))
```

<div class="line-notes">

- `import re` 正则表达式模块。正则表达式是用一小串符号描述「一类字符串长什么样」,前端的 `/sk-[A-Za-z0-9_-]{8,}/` 和这里的写法几乎一样。
- `KEY_LIKE = re.compile(r"sk-[A-Za-z0-9_-]{8,}")` 先编译一次、反复使用。`sk-` 是字面量,`[A-Za-z0-9_-]` 是字母、数字、下划线和连字符中的任何一个,`{8,}` 表示至少 8 个。这个规则会把 `sk-test1234567890abcdef` 整串匹配上。
- `def redact(text: str, key: str = "") -> str:` `key` 默认空字符串,不传就只做第二步。
- `if len(key) >= 8:` 太短的 key 不替换:`key` 要是只有 1 个字符,`text.replace` 会把文字里所有这个字符都换掉,字面意思上全毁了。
- `text = text.replace(key, "***")` 完整的 key 出现多少次换多少次。
- `return KEY_LIKE.sub("sk-***", text)` `sub` 是「把所有匹配到的换成指定内容」。
- `fake_key = "sk-test1234567890abcdef"` 样本里的假 key,不是真的。
- `"Authentication Fails, Your api key: ****0000 is invalid",` 第一条是正文里 DeepSeek 401 的原文,只含末 4 位和星号,没有 `sk-`,所以不变。
- `f"Incorrect API key provided: {fake_key}",` 第二条模拟把整个 key 回显的厂商:被规则一(`sk-` 开头)替换。
- `"key=mykey-abcdefgh12345678 被回显了",` 第四条模拟自定义格式的 key,`sk-` 规则匹配不到,靠 `redact` 的第二个参数(完整 key)替换。
- `print("脱敏:", redact(s, "mykey-abcdefgh12345678"))` 第二个参数传的是「当前使用的 key」。真实代码里它就是 `os.environ["LLM_API_KEY"]`。

</div>

```bash
uv run python -m part02.redact
```

```text
原文: Authentication Fails, Your api key: ****0000 is invalid
脱敏: Authentication Fails, Your api key: ****0000 is invalid
原文: Incorrect API key provided: sk-test1234567890abcdef
脱敏: Incorrect API key provided: sk-***
原文: Token is invalid.
脱敏: Token is invalid.
原文: key=mykey-abcdefgh12345678 被回显了
脱敏: key=*** 被回显了
```

第一条和第三条本来就没有 key,原样输出;第二条被规则一替换,第四条被规则二替换。这个函数的作用是**最后一道保险**:把错误信息写进日志、发给监控系统、贴给同事之前,先过一遍 `redact`。它不能保证安全(厂商可以用你想不到的格式回显),所以原则还是第一条:key 只放配置文件,别拼进字符串。

</details>

**练习 3:200 但内容是网页。** 写 `part02/gateway_page.py`:用假服务器的 `html-200` 复现正文里「拿到 `str`」的情况,然后写 `checked_create(client, model)`,用 `with_raw_response` 先看响应头的 `content-type`,不是 `application/json` 就抛一个自己的异常 `NotJson`,异常里带一个 `Verdict`(厂商、可重试)。对 `ok` 和 `html-200` 各调一次。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/gateway_page.py
import openai
from openai import OpenAI
from openai.types.chat import ChatCompletion

from part02.classify import Verdict
from part02.fake_llm import fake_server


class NotJson(Exception):
    def __init__(self, status: int, content_type: str):
        super().__init__(f"HTTP {status} 但 content-type 是 {content_type!r},不是 JSON")
        self.verdict = Verdict("厂商", True, "拿到的是网关或代理的页面:稍后重试,持续出现就查代理", status)


def checked_create(client: OpenAI, model: str) -> ChatCompletion:
    raw = client.chat.completions.with_raw_response.create(model=model, messages=[{"role": "user", "content": "hi"}])
    content_type = raw.headers.get("content-type", "")
    if not content_type.startswith("application/json"):
        raise NotJson(raw.status_code, content_type)
    return raw.parse()


with fake_server() as (url, _):
    client = OpenAI(base_url=url, api_key="sk-fake", max_retries=0)
    for model in ["ok", "html-200"]:
        try:
            resp = checked_create(client, model)
            print(model, "->", resp.choices[0].message.content)
        except NotJson as e:
            print(model, "->", e, "|", e.verdict.kind, e.verdict.retry)
        except openai.APIStatusError as e:
            print(model, "->", e.status_code)
```

<div class="line-notes">

- `from openai.types.chat import ChatCompletion` 函数返回值的类型标注用。
- `from part02.classify import Verdict` 复用今天的判断结果类型。
- `class NotJson(Exception):` 自己的异常,表示「状态码说成功,内容却不是 JSON」。
- `def __init__(self, status: int, content_type: str):` 异常构造时收两个信息。
- `super().__init__(f"HTTP {status} 但 content-type 是 {content_type!r},不是 JSON")` 先调用父类 `Exception` 的构造函数,把说明文字存进去,`str(e)` 就是这句。`!r` 让 `content_type` 带上引号显示。
- `self.verdict = Verdict("厂商", True, "拿到的是网关或代理的页面:稍后重试,持续出现就查代理", status)` 异常对象自己带着判断,调用方不用再 `classify` 一次(`classify` 只认 SDK 的异常)。归到「厂商」:网页是链路上的设备吐出来的,可以重试;如果天天出现,是你这边的代理有问题。
- `raw = client.chat.completions.with_raw_response.create(model=model, messages=[{"role": "user", "content": "hi"}])` `with_raw_response` 是 SDK 提供的另一个入口,调用方式一样,但返回的是「原始响应」,先不解析。Day 122 提到过。
- `content_type = raw.headers.get("content-type", "")` 原始响应的头。没有 `content-type` 时得到空字符串。
- `if not content_type.startswith("application/json"):` 用 `startswith` 而不是 `==`,因为真实的头常常是 `application/json; charset=utf-8`。
- `raise NotJson(raw.status_code, content_type)` 实跑 `html-200` 时是 `HTTP 200 但 content-type 是 'text/html'`。
- `return raw.parse()` 确认是 JSON 之后,再让 SDK 把原始响应解析成 `ChatCompletion`。
- `with fake_server() as (url, _):` 假服务器随起随用。
- `except NotJson as e:` 先接自己的异常;`e.verdict.kind` 和 `e.verdict.retry` 取出判断。
- `except openai.APIStatusError as e:` SDK 的状态码错误照常接,这里只打印状态码。

</div>

```bash
uv run python -m part02.gateway_page
```

```text
ok -> 假服务器说:你好
html-200 -> HTTP 200 但 content-type 是 'text/html',不是 JSON | 厂商 True
```

没改检查之前,`html-200` 会得到一个 `str` 然后在别处炸;现在在**离源头最近的地方**用一句人话报错。`with_raw_response` 多一步,所以不是每次调用都要用:放进你自己的「调用厂商」那一个函数里就行,Day 135 封装 `LLMClient` 时会再碰到这个位置。

</details>

**练习 4:今天的错误日报。** 假设一天的日志里一共出现了这些状态码:`[401, 429, 503, 400, 503, 402, 500, 429, 429, 503, 404, 500]`。写 `part02/error_report.py`:用假服务器把每个状态码重放一遍,用 `classify` 判断,按类别统计个数,并算出「重试也没用、要人去处理」的有几个。不调真 API。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/error_report.py
from collections import Counter

import openai
from openai import OpenAI

from part02.classify import classify
from part02.fake_llm import fake_server

DAY_LOG = [401, 429, 503, 400, 503, 402, 500, 429, 429, 503, 404, 500]

by_kind: Counter[str] = Counter()
need_human = 0
with fake_server() as (url, _):
    client = OpenAI(base_url=url, api_key="sk-fake", max_retries=0)
    for status in DAY_LOG:
        try:
            client.chat.completions.create(model=f"status-{status}", messages=[{"role": "user", "content": "hi"}])
        except openai.OpenAIError as e:
            v = classify(e)
            by_kind[v.kind] += 1
            need_human += not v.retry

print("按类别:", dict(by_kind))
print(f"共 {len(DAY_LOG)} 个错误,其中 {need_human} 个重试也没用,要人去改;{len(DAY_LOG) - need_human} 个等一等可能自己好")
```

<div class="line-notes">

- `from collections import Counter` 标准库的计数器([Day 118](/blog/agent-zero/day-118-week17-review/) 用过 `Counter[str]()`),数每个键出现了几次,`by_kind["厂商"] += 1` 不用先初始化。
- `DAY_LOG = [401, 429, 503, 400, 503, 402, 500, 429, 429, 503, 404, 500]` 12 个状态码,401 一个、402 一个、429 三个、503 三个、500 两个、400 和 404 各一个。
- `by_kind: Counter[str] = Counter()` 带类型标注的空计数器。
- `need_human = 0` 计「重试也没用」的个数。
- `client.chat.completions.create(model=f"status-{status}",` 用 f-string 拼出假服务器认识的模型名,`status-401` 让服务器回 401。
- `except openai.OpenAIError as e:` 所有 SDK 的错一起接。
- `v = classify(e)` 用今天的函数判断。
- `by_kind[v.kind] += 1` 按类别累加。
- `need_human += not v.retry` `not v.retry` 是布尔值,`True` 当 1、`False` 当 0 加进去。
- `print("按类别:", dict(by_kind))` `Counter` 转成普通字典打印。
- `print(f"共 {len(DAY_LOG)} 个错误,其中 {need_human} 个重试也没用,要人去改;{len(DAY_LOG) - need_human} 个等一等可能自己好")` 12 - 4 = 8。

</div>

```bash
uv run python -m part02.error_report
```

```text
按类别: {'你的账号': 2, '太快了': 3, '厂商': 5, '你的代码': 2}
共 12 个错误,其中 4 个重试也没用,要人去改;8 个等一等可能自己好
```

12 个错里,账号类 2 个(401、402)、代码类 2 个(400、404)共 4 个必须人去处理;太快了 3 个、厂商 5 个共 8 个等一等可能自己好。同一份日志,从「错误数 12」变成了「4 个要人跟进」,值班的人只需要看这 4 个。真实系统的监控告警就是这样设计的:可重试的错先自动重试,重试几次还不行才升级成告警;不可重试的错立刻告警。

</details>

**练习 5:超时和连不上,不是一回事。** 写 `part02/timeout_vs_connect.py`:打印 SDK 默认的超时配置;分别对一个「慢服务器」(假服务器的 `sleep-3`,客户端超时 1 秒)和一个「没人监听」的地址发请求,打印异常类名、它是不是 `APITimeoutError`、`__cause__` 是什么;最后用 `openai.Timeout(10, connect=1)` 给慢服务器一个更耐心的配置再试一次。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/timeout_vs_connect.py
import openai
from openai import OpenAI

from part02.fake_llm import fake_server

print("默认超时:", OpenAI(base_url="http://x", api_key="k").timeout)


def what_happened(client: OpenAI, model: str) -> str:
    try:
        client.chat.completions.create(model=model, messages=[{"role": "user", "content": "hi"}])
    except openai.APIConnectionError as e:
        return f"{type(e).__name__}, 是 APITimeoutError: {isinstance(e, openai.APITimeoutError)}, 原因 {type(e.__cause__).__name__}"
    return "成功"


with fake_server() as (url, _):
    slow = OpenAI(base_url=url, api_key="sk-fake", max_retries=0, timeout=1)
    print("慢服务器 :", what_happened(slow, "sleep-3"))
    nobody = OpenAI(base_url="http://127.0.0.1:9", api_key="sk-fake", max_retries=0, timeout=1)
    print("没人监听 :", what_happened(nobody, "x"))
    patient = OpenAI(base_url=url, api_key="sk-fake", max_retries=0, timeout=openai.Timeout(10, connect=1))
    print("耐心一点 :", what_happened(patient, "sleep-3"))
```

<div class="line-notes">

- `print("默认超时:", OpenAI(base_url="http://x", api_key="k").timeout)` 建一个不会真的发请求的客户端,看它的 `.timeout` 属性。地址和 key 随便写。
- `def what_happened(client: OpenAI, model: str) -> str:` 发一个请求,返回一句话描述发生了什么。
- `except openai.APIConnectionError as e:` 只接「没有状态码」这一支。`APITimeoutError` 是它的子类,所以超时也在这里。
- `return f"{type(e).__name__}, 是 APITimeoutError: {isinstance(e, openai.APITimeoutError)}, 原因 {type(e.__cause__).__name__}"` 一句话里放三样:类名、是不是超时、底层原因。
- `return "成功"` 没抛异常就是成功。
- `slow = OpenAI(base_url=url, api_key="sk-fake", max_retries=0, timeout=1)` 客户端等 1 秒,假服务器要睡 3 秒,一定超时。
- `nobody = OpenAI(base_url="http://127.0.0.1:9",` 没人监听的地址。
- `timeout=openai.Timeout(10, connect=1)` `Timeout` 的第一个参数是「其他阶段的默认秒数」,`connect=1` 单独给「建立连接」这一步 1 秒。正常的网络建连很快,1 秒还连不上基本就是不通,没必要等;而读回答可以等 10 秒。

</div>

```bash
uv run python -m part02.timeout_vs_connect
```

```text
默认超时: Timeout(connect=5.0, read=600, write=600, pool=600)
慢服务器 : APITimeoutError, 是 APITimeoutError: True, 原因 ReadTimeout
没人监听 : APIConnectionError, 是 APITimeoutError: False, 原因 ConnectError
耐心一点 : 成功
```

第一行是 SDK 默认的超时:连接最多等 5 秒,读写和池子都是 600 秒,也就是 10 分钟。第二行慢服务器:`APITimeoutError`,原因是 `ReadTimeout`(连上了,等回答等不到)。第三行没人监听:`APIConnectionError`,不是 `APITimeoutError`,原因是 `ConnectError`(连都连不上,立刻就失败,不用等满超时)。第四行把读超时放宽到 10 秒,3 秒的慢响应就等到了。

这里有个生产上的取舍:读超时设太短,正常的长回答(特别是开思考时)会被误杀;设太长,厂商真的卡住时你的程序也跟着卡。**没有通用答案**,要按你的任务设:一问一答的客服场景 30 秒合理,写长文章或开思考可能要 120 秒以上,流式输出([Day 133](/blog/agent-zero/day-133-sse-principle/)–[134](/blog/agent-zero/day-134-streaming-code/) 会讲)又是另一种算法。

</details>

**验收标准:** `err_401.py` 能打印出三条线索并说出 `AuthenticationError` 的继承链;`err_real.py` 在 DeepSeek 上得到和文章一致的 12 行(`ReadTimeout` 和 `ConnectTimeout` 两种原因都可能出现),在硅基流动上能说出 6 处不同;`errors_table.py` 服务器收到 13 个请求;`uv run pytest tests/test_classify.py` 16 个全过,并且能复现「兜底写在最前面」挂 11 个;`ask_safe.py` 四种情况退出码是 0、2、3、2;五道练习的输出和文章一致。

今天的花费:`err_401.py` 和 `err_real.py` 在 DeepSeek 上共 13 个故意有毛病的请求(1 个假 key + 12 种真错),全部在鉴权或参数检查就被拒,不计费(`max_tokens=0` 那一条也被 400 拒了);硅基流动上有 3 个被放行的请求(`temperature=5`、`max_tokens=0`、`max_tokens=1 千万`),每个只生成几个 token,合计不到 0.001 元;`ask_safe.py` 一次正常问答约 0.0004 元,调试过程中跑过几次。全天不到 0.01 元。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| HTTP 状态码分类 | 2xx 成功、4xx 是客户端(你)的问题、5xx 是服务端(厂商)的问题。Day 60 学过,今天用它来判断该不该重试 |
| `APIStatusError` | openai SDK 里「服务器回了非 2xx 状态码」这一类异常的父类,有 `status_code`、`response`、`body` |
| `APIConnectionError` | 没拿到任何响应的异常:连不上、超时。没有状态码 |
| `APITimeoutError` | 超时,是 `APIConnectionError` 的子类 |
| `e.body` / `e.code` / `e.type` | 响应体解析出的字典,和从中取出的 `code`、`type` 字段。各家格式不同 |
| `__cause__` | Python 异常对象上的属性,指向「引起它的更底层的异常」,SDK 把 httpx 的错误放在这里 |
| `__mro__` | 一个类的继承链(方法解析顺序),从自己一路往上列到 `object` |
| `isinstance(x, 类)` | 判断对象是不是某个类(包括它的子类)的实例,第二个参数可以是类的元组 |
| 兜底分支 | 排在所有具体情况后面、接住「没人认领」的那一支。位置必须在最后 |
| 假服务器(fake server) | 自己在本机起的、按需返回任意状态码的小服务器,用来测试「遇到某种错时代码对不对」 |
| `request_id` / `x-ds-trace-id` | 厂商给每次请求的唯一编号,找客服排查时要提供 |
| 退出码(exit code) | 程序结束时返回给 shell 的数字,0 表示成功,其他表示失败。Day 44 讲过 |
| `with_raw_response` | SDK 的另一个调用入口,返回未解析的原始 HTTP 响应,能看头和状态码,再用 `.parse()` 得到对象 |

## 常见误区

**用 `message` 的文字判断错误类型。** `if "invalid" in e.message` 在 DeepSeek 上也许能用,换到硅基流动(`Token is invalid.`)、换一个版本就悄悄失效。用状态码和异常类判断,`message` 留给人看。

**以为 `temperature=5` 是 422。** 不少旧资料这么写,我在 DeepSeek 上实测是 400,理由是「范围 [0, 2]」。422 是 JSON 类型都对不上的情况(`max_tokens=-5` 报 `expected u32`)。好在对分类来说两个一样,都别重试。

**把所有 `except` 都写成 `except Exception`。** 这会把 `KeyError`、拼写错误引发的 `AttributeError` 也当成「API 出错了」,然后重试,于是一个 bug 被重试三次、日志里一片「厂商不稳定」。只接 `openai.OpenAIError`,别的让它炸出来。

**`except openai.APIStatusError` 写在 `except openai.AuthenticationError` 前面。** 父类在前,子类永远走不到,代码看着分了类,实际只有一个分支。`isinstance` 链同理,具体的在前,兜底在最后,今天的测试里 16 挂 11 就是这个坑。

**把 429 一律当成「等一会儿」。** OpenAI 官方 API 额度用完也是 429,`code` 是 `insufficient_quota`,一直重试会一直失败。分类时看 `e.code`。

**以为拿到 200 就是成功。** `html-200` 让 `resp` 变成一个 `str`,SDK 不报错,报错在你自己的下一行。遇到 `'str' object has no attribute 'choices'`,先 `print(type(resp))`。

**把错误信息原样贴出去。** DeepSeek 的 401 会回显你填的 key 的末 4 位,有的厂商可能回显更多。日志、群聊、issue 里贴之前,先过一遍 `redact`。

**重试一个会扣钱的请求,却不知道它已经成功了。** 超时只说明你没等到,不说明厂商没处理。聊天问答重复一次只是多花几厘,调用付款、发邮件这类工具就会真的重复执行,第三部分讲工具调用时会专门处理。

## 学习资料

### 文档与文章

- [DeepSeek API 错误码](https://api-docs.deepseek.com/zh-cn/quick_start/error_codes):官方对 400、401、402、422、429、500、503 的原因和解决方法,一页就看完。今天的分类表直接对着它核对过。
- [DeepSeek 限速与隔离](https://api-docs.deepseek.com/zh-cn/quick_start/rate_limit):讲清楚 429 在 DeepSeek 上是「并发超限」,以及请求保活机制和 10 分钟超时。Day 128 会细读,今天先看「并发限速」和「请求保活机制」两节。
- [MDN · HTTP 响应状态码](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Status):前端同学最熟的状态码手册,今天重点看 400、401、403、404、408、409、422、429、500、502、503、504 这几条的「成因」,正好和我们的分类表对一遍。
- [openai-python 的 README](https://github.com/openai/openai-python#handling-errors):搜「Handling errors」那一节,里面有官方的异常类和状态码对照表,和我们在装好的包里核对的一致。
- [OpenAI · Error codes](https://platform.openai.com/docs/guides/error-codes):OpenAI 自己的错误码说明,里面能看到 429 的两种情况(请求太快、额度用完)。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1JPpm6xEEX&autoplay=0&high_quality=1" title="API 实用课 19｜API 报错 401、402、429 怎么办？还有三个最贵的错误" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>薛志荣被注册了 · API 实用课 19:API 报错 401、402、429 怎么办?还有三个最贵的错误 · 1 分半钟,2026 年 10 月。很短,看完把他列的三个「最贵的错误」和今天的 `classify` 对一下:哪些是你的代码、哪些是账号。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1nabx6EEeH&autoplay=0&high_quality=1" title="LLM API 速率限制详解：HTTP 429、RPM、TPM 与指数退避" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>快乐的天才程序员 · LLM API 速率限制详解:HTTP 429、RPM、TPM 与指数退避 · 6 分钟,2026 年 9 月。今天只看前半段讲 429 是什么;后半段的指数退避是明天的内容,可以先留着。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/nb0xQUcxVj4" title="Every HTTP Status Code Explained in 8 Minutes!" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Codist · Every HTTP Status Code Explained in 8 Minutes! · 英文。按标题是 8 分钟过一遍全部状态码,我只核对了标题和能打开,没有逐段看过;你已经学过 Day 60,用它巩固 4xx 和 5xx 两大段就够了。</figcaption>
</figure>

### 书籍

- 《图解 HTTP》(上野宣 著,于均良 译,人民邮电出版社,2014 年):日本人写的 HTTP 入门图解,有专门讲状态码的一章,每个码配一张小图,读完你会觉得 4xx、5xx 不再是死记硬背。读到状态码那一章就够,大约 20 页。

### 开源项目与代码

- [openai/openai-python 的 `_exceptions.py`](https://github.com/openai/openai-python/blob/main/src/openai/_exceptions.py):今天画的那棵树的源码,一百来行,读一遍 `APIStatusError` 和它的八个子类怎么定义的。再看 `_client.py` 里的 `_make_status_error`,就是「状态码 → 异常类」那张对照表,和我们的分类表对着看。

## 自测

1. `except openai.APIConnectionError` 能接住 `APITimeoutError` 吗?为什么 `classify` 里要先判断 `APITimeoutError`?

<details><summary>答案</summary>

能。`APITimeoutError` 是 `APIConnectionError` 的子类,`isinstance` 和 `except` 都按「是不是这个类或它的子类」判断。先判断子类,才能把「超时」和「没连上」分成两句不同的建议;顺序反了,超时也会被当成没连上。

</details>

2. DeepSeek 的 `temperature=5` 返回几?`max_tokens=-5` 返回几?为什么这个区别对 `classify` 不重要?

<details><summary>答案</summary>

`temperature=5` 是 400(值超出 [0, 2] 的合法范围),`max_tokens=-5` 是 422(JSON 反序列化失败,期望无符号整数)。两个都是你的请求有问题,原样重试结果不变,所以 `classify` 把它们合成一类「你的代码」、不重试。

</details>

3. 为什么说「分类要靠状态码和异常类,不要靠解析 `message`」?拿今天的哪个实验证明?

<details><summary>答案</summary>

`message` 的文字各家不同,同一家换版本也会变。今天 DeepSeek 的 401 是 `Authentication Fails, ...`,硅基流动的是 `Token is invalid.`,`e.code` 一个是 `invalid_request_error`、一个是 `'30014'`,`e.type` 一个有值一个是 `None`;连 404 的 message 也一个是空的一个是 `Not Found`。状态码是 HTTP 规定的,两家一致。

</details>

4. SDK 返回了 HTTP 200,但你在下一行得到 `AttributeError: 'str' object has no attribute 'choices'`。可能是什么原因?怎么查、怎么防?

<details><summary>答案</summary>

链路上有设备(公司代理、校园网认证页、CDN)用 HTTP 200 回了一个 HTML 网页,SDK 解析不了 JSON,把原始字符串当结果返回。先 `print(type(resp), resp[:200])` 看内容。防的办法是用 `with_raw_response` 先检查响应头 `content-type` 是不是 `application/json`,不是就当「厂商/网关」类错误处理(练习 3)。

</details>

5. 面试题:「你的 Agent 调用大模型 API,线上出现了一批失败。你怎么判断该自动重试还是该报警?」

<details><summary>答案</summary>

先按状态码和异常类分类,不靠错误文字。401、402、403 是账号问题(key、余额、权限),400、404、422 是自己的请求有毛病,这两类重试没用,应该立刻告警让人处理,并附上 `request_id`。429、5xx、连不上、超时是暂时性的,可以自动重试,但要等待并限制次数(明天讲退避);重试几次仍失败再升级成告警或切到备用厂商。429 要多看一眼错误码,额度用完(`insufficient_quota`)是账号问题不是限速。还要注意超时的请求可能已经被厂商处理,有副作用的操作不能盲目重试。最后日志里要脱敏,避免把 key 的片段打出来。

</details>

## 明天预告

[Day 127](/blog/agent-zero/day-127-retry-backoff/) · 重试和指数退避。今天的 `classify` 只回答「该不该重试」,明天回答「怎么重试」:为什么不能一失败就立刻再发(假服务器上能看到把对方压垮的过程)、SDK 自带的重试到底做了什么(我会对着装好的包里的源码讲,它的退避参数是 0.5 秒起步、翻倍、封顶 8 秒)、自己写一个带随机抖动的指数退避,并且要和今天的 `classify` 接起来:401 只发 1 次,429 等一等再发。
