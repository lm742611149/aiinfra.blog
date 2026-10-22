---
title: 'Day 82 · 鉴权(一):API key 和 session/cookie,这回从服务端看'
description: '以前你是带着 API key 去调别人的接口,今天换到服务端:用一个 FastAPI 依赖检查 X-API-Key,没带、带错、服务端没配三种情况分别怎么回;再写一个登录接口,用 session 加 HttpOnly cookie 记住浏览器是谁,用 curl 和无头 Chrome 看清楚 cookie 怎么下发、怎么带回、怎么作废。'
pubDate: 2026-10-22
regime: none
tags: ['fastapi', 'auth', 'backend', 'python', 'agent-zero']
series: 'agent-zero'
day: 82
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 81](/blog/agent-zero/day-081-fastapi-3/) 把工单服务的错误统一成了 `{"error": {"code", "message", "details", "request_id"}}`,4 个异常处理器分别接住业务错误、422、框架的 404/405 和 bug 引起的 500;用 `Depends(find_ticket)` 去掉了重复的找工单代码;写了一个中间件给每个响应加 `X-Request-ID`。还特意强调了一句:接管错误处理时,别弄丢原来响应里该有的头。

现在这个服务谁都能用。任何能访问到 8000 端口的人,都能 POST 一张工单、把别人的工单改成已关闭。今天给它加上门禁。你在 [Day 63](/blog/agent-zero/day-063-rest-api/) 请求 DeepSeek 余额接口时,在 `Authorization` 头里带过 API key,那是**调用方**的视角;今天站到**服务端**,看看收到这个头以后要做什么。

## 今天要解决的问题

学完今天,你应该能做到:

1. 写一个 API key 校验依赖,挂到写操作上:没带回 401、带错回 401、服务端忘了配 key 时拒绝所有请求(而不是放行所有请求),并说清楚 401 和 403 的区别。
2. 说出 API key 的三个常见坑:key 放进 URL、用 `==` 比较、服务端没配 key 时意外放行,并在代码里避开。
3. 写一个基于 session 的登录:`/login` 下发 HttpOnly cookie、`/me` 读 cookie 认人、`/logout` 让它作废;用 curl 的 cookie 文件和浏览器分别验证。
4. 判断什么场景用 API key、什么场景用 session/cookie。

今天两个新概念:**API key 校验**和 **session/cookie**。

预计用时:3 小时。花费 ¥0,不调模型。

前置:[Day 81](/blog/agent-zero/day-081-fastapi-3/) 的完整 `tickets_api.py`(`ApiError`、四个异常处理器、中间件、`find_ticket`)和 `tests/`;[Day 60](/blog/agent-zero/day-060-http-2/) 的状态码和 header;[Day 63](/blog/agent-zero/day-063-rest-api/) 的 `Authorization` 头;[Day 53](/blog/agent-zero/day-053-env-secrets/) 的环境变量和「密钥不进仓库」;[Day 74](/blog/agent-zero/day-074-pytest-4/) 的 monkeypatch。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `require_api_key` 和 `session_demo.py` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先分清两个词和两个状态码

「鉴权」这个词在中文里常常混着指两件事:

- **认证**(authentication):你是谁?服务端要确认请求是谁发的。API key、登录、cookie 都是在回答这个问题。
- **授权**(authorization):你能做什么?确认了你是谁以后,再看你有没有权限做这件事,比如普通客服能不能删工单。

今天只做认证。两个对应的状态码很容易用反:

| 状态码 | 意思 | 例子 |
| --- | --- | --- |
| 401 Unauthorized | 我不知道你是谁:没带凭证,或者凭证不对 | 没带 API key、key 写错、cookie 过期 |
| 403 Forbidden | 我知道你是谁,但你不能做这件事 | 只读账号想改工单 |

401 的英文名字叫 Unauthorized(未授权),其实表达的是「未认证」,这是 HTTP 历史上留下的一个用词问题,记住按上面这张表用就行。HTTP 规范还要求 401 的响应带一个 `WWW-Authenticate` 头,告诉客户端「我接受什么方式的凭证」。昨天在 `handle_http_error` 里保留 `exc.headers`,就是为这个准备的。

## 第 1 步:一个检查 API key 的依赖

API key 说白了就是一串很长的随机字符,服务端和调用方各存一份,调用方每次请求都带上,服务端比对一下是不是那串。先生成一个:

```bash
uv run python -c "import secrets; print(secrets.token_urlsafe(24))"
```

<div class="line-notes">

- `uv run python -c "import secrets; print(secrets.token_urlsafe(24))"` `secrets` 是标准库里专门生成密码学安全随机数的模块,`token_urlsafe(24)` 生成 24 字节的随机数,编码成只含字母、数字、`-`、`_` 的字符串(放进 URL、头、cookie 里都安全)。不要用 `random` 模块生成密钥,它的随机数是可以被推算的。

</div>

实跑输出(你的一定不一样):

```text
wrOJsE4hmfBCaSSG2rYmUyhlicbwJT6x
```

这就是服务端要认的 key。按 Day 53 的规矩,它不能写在代码里,要从环境变量读。

改 `part01/tickets_api.py`。先改文件开头的 import:

```python
# agent-zero-lab/part01/tickets_api.py(改过的 import)
import logging
import os
import secrets
import time
import uuid
from typing import Annotated, Any, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
```

<div class="line-notes">

- `import os` 读环境变量要用 `os.environ`(Day 53)。
- `import secrets` 下面要用它的 `compare_digest`。
- `from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request` 多了一个 `Header`,用来声明「这个参数来自请求头」。

</div>

再让 `ApiError` 能带响应头,401 要用:

```python
# agent-zero-lab/part01/tickets_api.py(改过的 ApiError 和 handle_api_error)
class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, headers: dict[str, str] | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.headers = headers


@app.exception_handler(ApiError)
def handle_api_error(request: Request, exc: ApiError):
    return JSONResponse(status_code=exc.status, content=error_body(request, exc.code, exc.message), headers=exc.headers)
```

<div class="line-notes">

- `def __init__(self, status: int, code: str, message: str, headers: dict[str, str] | None = None):` 加一个可选参数,不传就是 `None`,以前所有 `raise ApiError(404, ...)` 都不用改。
- `self.headers = headers` 存起来。
- `headers=exc.headers)` 交给 `JSONResponse`。`headers=None` 等于不加任何头。

</div>

然后在 `TicketDep = ...` 那一行下面加依赖:

```python
# agent-zero-lab/part01/tickets_api.py(新增,放在 TicketDep 下面)
def require_api_key(x_api_key: Annotated[str | None, Header()] = None) -> None:
    expected = os.environ.get("TICKETS_API_KEY", "")
    if not expected:
        raise ApiError(500, "server_misconfigured", "服务端没有配置 API key")
    if x_api_key is None:
        raise ApiError(401, "missing_api_key", "缺少 X-API-Key 请求头", {"WWW-Authenticate": "ApiKey"})
    if not secrets.compare_digest(x_api_key.encode(), expected.encode()):
        raise ApiError(401, "invalid_api_key", "API key 不对", {"WWW-Authenticate": "ApiKey"})
```

<div class="line-notes">

- `def require_api_key(x_api_key: Annotated[str | None, Header()] = None) -> None:` 参数 `x_api_key`,附加信息是 `Header()`:**值从请求头里取**。FastAPI 会把参数名里的下划线换成横线去找头,并且不区分大小写,所以 `x_api_key` 对应的是请求头 `X-API-Key`(写成 `x-api-key` 也一样)。`| None = None` 表示头可以不带,不带就是 `None`,由我们自己决定回什么。返回值是 `None`:这个依赖只负责「不对就拦下」,不给处理函数提供任何值。
- `expected = os.environ.get("TICKETS_API_KEY", "")` 每次请求时读一次环境变量。放在函数里读而不是模块开头读,测试时用 monkeypatch 改环境变量才会生效(下面的测试要用)。
- `if not expected:` 服务端**自己没配 key**。这时必须拒绝所有请求,而不是跳过检查。为什么要专门写这一行,第 2 步有实测。
- `raise ApiError(500, "server_misconfigured", "服务端没有配置 API key")` 这是服务端的问题,不是调用方的问题,所以是 5 开头。
- `raise ApiError(401, "missing_api_key", "缺少 X-API-Key 请求头", {"WWW-Authenticate": "ApiKey"})` 没带。第四个参数是要加的响应头。`ApiKey` 不是一个标准规定的方案名,是我们自己声明的,意思是「请用 API key」;标准方案有 `Basic`、`Bearer` 等。
- `if not secrets.compare_digest(x_api_key.encode(), expected.encode()):` 比对。不用 `==`,原因见第 2 步。`.encode()` 把字符串转成 bytes(Day 16),因为 `compare_digest` 碰到含中文等非 ASCII 字符的字符串会直接报 `TypeError: comparing strings with non-ASCII characters is not supported`,转成 bytes 就没这个问题。

</div>

最后把它挂到两个写操作上:

```python
# agent-zero-lab/part01/tickets_api.py(改过的两个装饰器,函数体不变)
@app.post("/tickets", status_code=201, dependencies=[Depends(require_api_key)])
@app.patch("/tickets/{ticket_id}", dependencies=[Depends(require_api_key)])
```

<div class="line-notes">

- `@app.post("/tickets", status_code=201, dependencies=[Depends(require_api_key)])` 昨天的依赖是写在参数上的,因为要用它的返回值;这个依赖没有返回值,就写在装饰器的 `dependencies` 列表里,意思是「调用这个接口之前先跑一遍它」。这两行不是连在一起的代码,是分别替换文件里原来那两个装饰器。

</div>

GET 接口不挂,读工单不需要 key。这是一个取舍:真实系统里工单内容也是隐私,读也该校验;这里为了看清楚区别,先只保护写操作。

启动服务。key 用环境变量传进去,写在命令前面,只对这一条命令生效(Day 53):

```bash
TICKETS_API_KEY=wrOJsE4hmfBCaSSG2rYmUyhlicbwJT6x uv run uvicorn part01.tickets_api:app --port 8000 --reload
```

第二个窗口,先把 key 存进一个 shell 变量,再请求:

```bash
KEY=wrOJsE4hmfBCaSSG2rYmUyhlicbwJT6x
B=http://127.0.0.1:8000
curl -sS -i -X POST $B/tickets -H "Content-Type: application/json" -d '{"title":"退款什么时候到账"}'
curl -sS -X POST $B/tickets -H "Content-Type: application/json" -H "X-API-Key: guess123" -d '{"title":"退款什么时候到账"}' -w "  [%{http_code}]\n"
curl -sS -X POST $B/tickets -H "Content-Type: application/json" -H "X-API-Key: $KEY" -d '{"title":"退款什么时候到账"}' -w "  [%{http_code}]\n"
curl -sS $B/tickets/1004 -w "  [%{http_code}]\n"
```

<div class="line-notes">

- `curl -sS -i -X POST $B/tickets -H` 第一条不带 key,`-i` 看响应头。
- `-H "X-API-Key: guess123"` 第二条带一个错的。
- `-H "X-API-Key: $KEY"` 第三条带对的。`$KEY` 在双引号里会被 shell 换成变量的值。
- `curl -sS $B/tickets/1004 -w "  [%{http_code}]\n"` 第四条读刚建的工单,不带 key。

</div>

实跑输出(第一条只留了状态行、`www-authenticate` 和 body):

```text
HTTP/1.1 401 Unauthorized
www-authenticate: ApiKey
{"error":{"code":"missing_api_key","message":"缺少 X-API-Key 请求头","details":[],"request_id":"fb2c1435"}}
{"error":{"code":"invalid_api_key","message":"API key 不对","details":[],"request_id":"2f26b026"}}  [401]
{"id":1004,"title":"退款什么时候到账","status":"open","priority":"normal"}  [201]
{"id":1004,"title":"退款什么时候到账","status":"open","priority":"normal"}  [200]
```

没带和带错都是 401,`code` 不同,401 带着 `www-authenticate` 头;带对了 201;读不需要 key。错误格式是昨天统一的那一套,不用另外处理。

再试两种头的写法:

```bash
curl -sS -X POST $B/tickets -H "Content-Type: application/json" -H "x-api-key: $KEY" -d '{"title":"小写头名"}' -w "  [%{http_code}]\n"
curl -sS -X POST $B/tickets -H "Content-Type: application/json" -H "X_API_KEY: $KEY" -d '{"title":"下划线头名"}' -w "  [%{http_code}]\n"
```

实跑输出:

```text
{"id":1005,"title":"小写头名","status":"open","priority":"normal"}  [201]
{"error":{"code":"missing_api_key","message":"缺少 X-API-Key 请求头","details":[],"request_id":"6e8feb53"}}  [401]
```

全小写可以,HTTP 头名不区分大小写(Day 79 见过,uvicorn 回的头都是小写)。但写成下划线 `X_API_KEY` 就找不到了:FastAPI 找的是横线版的 `x-api-key`,下划线版被当成了另一个头。Python 参数名不能有横线,所以 FastAPI 才做了「下划线换横线」这个转换,调用方那边要写横线。

## 第 2 步:三个坑,一个比一个隐蔽

### 坑一:服务端没配 key,结果谁都能进

为什么要专门写 `if not expected`?我先写一个「看起来没问题」的版本,新建 `part01/naive_key.py`,模拟一个创建退款单的接口:

```python
# agent-zero-lab/part01/naive_key.py(反面教材)
import os
import secrets
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException

app = FastAPI()


def require_api_key(x_api_key: Annotated[str, Header()] = "") -> None:
    expected = os.environ.get("TICKETS_API_KEY", "")
    if not secrets.compare_digest(x_api_key.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="API key 不对")


@app.post("/refunds", dependencies=[Depends(require_api_key)])
def create_refund():
    return {"ok": True, "message": "退款单已创建"}
```

<div class="line-notes">

- `def require_api_key(x_api_key: Annotated[str, Header()] = "") -> None:` 没带头时默认是空字符串。
- `expected = os.environ.get("TICKETS_API_KEY", "")` 没配环境变量时也是空字符串。
- `if not secrets.compare_digest(x_api_key.encode(), expected.encode()):` 只做了一件事:比对。看起来很严谨,还用了 `compare_digest`。

</div>

启动时**忘了**传环境变量(部署时漏配、`.env` 没加载、变量名拼错,都会这样):

```bash
uv run uvicorn part01.naive_key:app --port 8000
```

另一个窗口,什么都不带:

```bash
curl -sS -X POST http://127.0.0.1:8000/refunds -w "  [%{http_code}]\n"
curl -sS -X POST http://127.0.0.1:8000/refunds -H "X-API-Key: guess" -w "  [%{http_code}]\n"
```

实跑输出:

```text
{"ok":true,"message":"退款单已创建"}  [200]
{"detail":"API key 不对"}  [401]
```

第一条是重点:**不带任何凭证,退款单建成功了**。空字符串和空字符串比较,当然相等。随便带一个错的 key 反而被拦住,所以只测「带错 key 会不会被拦」的话,这个漏洞完全发现不了。

这种问题叫**失败时放行**(fail open):配置出了问题,系统的反应是「不检查了」。安全相关的检查必须反过来,**失败时关门**(fail closed):配置有问题就拒绝一切,宁可服务不可用,也不能让人随便进。`tickets_api.py` 里 `if not expected: raise ApiError(500, ...)` 就是这一道。不传环境变量启动 `tickets_api`,带任意 key 请求,实跑得到:

```text
{"error":{"code":"server_misconfigured","message":"服务端没有配置 API key","details":[],"request_id":"e216afd6"}}  [500]
```

试完把 `naive_key.py` 删掉,别留在仓库里。

### 坑二:key 放在 URL 里

有些接口让你把 key 写成查询参数,比如 `?api_key=...`。看看服务器窗口的访问日志就知道为什么不好。我请求了一次 `POST /tickets?api_key=$KEY`(我们的服务不认查询参数里的 key,回了 401),日志里是:

```text
INFO:     127.0.0.1:62259 - "POST /tickets?api_key=wrOJsE4hmfBCaSSG2rYmUyhlicbwJT6x HTTP/1.1" 401 Unauthorized
```

完整的 key 被写进了日志。URL 会出现在服务器访问日志、反向代理日志、浏览器历史、`Referer` 头、各种监控工具里,这些地方都不是为保存密钥设计的。而 uvicorn 的访问日志默认**不打印请求头**,放在头里就不会这样泄露。所以 key 一律放头里:要么自定义的 `X-API-Key`,要么标准的 `Authorization: Bearer ...`(Day 63 DeepSeek 用的就是后者,练习 2 让你两种都支持)。

### 坑三:用 `==` 比较密钥

`x_api_key == expected` 在功能上完全正确,问题出在**耗时**。字符串的 `==` 一般是从头逐个字符比,遇到第一个不同的字符就立刻返回 False。于是「第一个字符就错」和「前 20 个字符都对」所花的时间有极细微的差别。攻击者理论上可以逐个字符试,通过统计响应时间一点点猜出 key,这叫**时序攻击**(timing attack)。

`secrets.compare_digest` 不管在哪里出现不同,都把整串比完,耗时只和长度有关。Python 官方文档对它的说明就是「降低时序攻击的风险」。这种差别是纳秒级的,隔着网络我测不出来,也没去测;但写法上只是换个函数,没有理由不用。

### 依赖的执行顺序:先认人,再说别的

还有一个现象值得留意。不带 key,分别发一个内容不合格的 POST 和一个改不存在工单的 PATCH:

```bash
curl -sS -X POST $B/tickets -H "Content-Type: application/json" -d '{"title":""}' -w "  [%{http_code}]\n"
curl -sS -X PATCH $B/tickets/9999 -H "Content-Type: application/json" -d '{"status":"closed"}' -w "  [%{http_code}]\n"
```

实跑输出:

```text
{"error":{"code":"missing_api_key","message":"缺少 X-API-Key 请求头","details":[],"request_id":"d4467d0e"}}  [401]
{"error":{"code":"missing_api_key","message":"缺少 X-API-Key 请求头","details":[],"request_id":"289037df"}}  [401]
```

都是 401,而不是 422 或 404。装饰器上 `dependencies` 里的依赖先执行,它一抛异常,后面的请求体校验和 `find_ticket` 都不会进行。这是好事:没认证的人不应该从 422 里看到你的字段规则,也不应该从 404 和 200 的区别里推断出「9999 号工单不存在,1001 号存在」。依赖写在参数上时,顺序是按参数从左往右,练习 3 会碰到这个问题。

### 测试也要跟着改

现在跑昨天的测试:

```bash
uv run pytest tests/test_tickets_api.py tests/test_ex79.py tests/test_create_ticket.py tests/test_errors.py -q
```

实跑输出(只留了汇总):

```text
FAILED tests/test_create_ticket.py::test_create_ok - assert 500 == 201
FAILED tests/test_create_ticket.py::test_create_missing_title - assert 500 ==...
FAILED tests/test_create_ticket.py::test_create_rejects_status - assert 500 =...
3 failed, 11 passed in 1.34s
```

三个 POST 测试都拿到了 500:测试进程里没有 `TICKETS_API_KEY`,fail closed 生效了。改 `tests/test_create_ticket.py` 的开头:

```python
# agent-zero-lab/tests/test_create_ticket.py(开头改成这样,三个测试函数不变)
import pytest
from fastapi.testclient import TestClient

from part01 import tickets_api
from part01.tickets_api import app

client = TestClient(app, headers={"X-API-Key": "test-key"})


@pytest.fixture(autouse=True)
def fresh_tickets(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(tickets_api, "TICKETS", list(tickets_api.TICKETS))
    monkeypatch.setenv("TICKETS_API_KEY", "test-key")
```

<div class="line-notes">

- `client = TestClient(app, headers={"X-API-Key": "test-key"})` 给这个客户端设默认头,它发的每个请求都自动带上。
- `monkeypatch.setenv("TICKETS_API_KEY", "test-key")` Day 74 的 monkeypatch 也能改环境变量,测试结束自动还原。测试用一个假 key,和真 key 没关系。因为 `require_api_key` 是在每次请求时才读环境变量,这里改了马上生效。

</div>

再新建一个专门测鉴权的文件:

```python
# agent-zero-lab/tests/test_auth.py
import pytest
from fastapi.testclient import TestClient

from part01 import tickets_api
from part01.tickets_api import app

client = TestClient(app)
NEW = {"title": "鉴权测试"}


@pytest.fixture(autouse=True)
def setup(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(tickets_api, "TICKETS", list(tickets_api.TICKETS))
    monkeypatch.setenv("TICKETS_API_KEY", "test-key")


def test_missing_key_is_401():
    resp = client.post("/tickets", json=NEW)
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "missing_api_key"
    assert resp.headers["WWW-Authenticate"] == "ApiKey"


def test_wrong_key_is_401():
    resp = client.post("/tickets", json=NEW, headers={"X-API-Key": "guess"})
    assert resp.json()["error"]["code"] == "invalid_api_key"


def test_right_key_creates():
    resp = client.post("/tickets", json=NEW, headers={"X-API-Key": "test-key"})
    assert resp.status_code == 201


def test_read_needs_no_key():
    assert client.get("/tickets/1001").status_code == 200


def test_no_server_key_fails_closed(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("TICKETS_API_KEY")
    resp = client.post("/tickets", json=NEW, headers={"X-API-Key": ""})
    assert resp.status_code == 500
    assert resp.json()["error"]["code"] == "server_misconfigured"
```

<div class="line-notes">

- `client = TestClient(app)` 这里不设默认头,每个测试自己决定带什么。
- `assert resp.headers["WWW-Authenticate"] == "ApiKey"` 钉住 401 必须带的头。
- `def test_no_server_key_fails_closed(monkeypatch: pytest.MonkeyPatch):` 测试函数也可以直接要 monkeypatch。autouse 的 fixture 先设了环境变量,这里再删掉。
- `monkeypatch.delenv("TICKETS_API_KEY")` 模拟「服务端忘了配」。
- `resp = client.post("/tickets", json=NEW, headers={"X-API-Key": ""})` 带一个空 key,正好是坑一里能骗过反面教材的那个情况。

</div>

实跑 `uv run pytest tests/test_tickets_api.py tests/test_ex79.py tests/test_create_ticket.py tests/test_errors.py tests/test_auth.py -q`:

```text
...................                                                      [100%]
19 passed in 1.29s
```

basedpyright 检查 `part01/` 和这两个测试文件,`0 errors, 0 warnings, 0 notes`。

## 第 3 步:session 和 cookie,服务端怎么记住一个浏览器

API key 适合**程序调程序**:你的 Agent 服务调工单服务,配置里写一个 key,每次带上。可客服是**人**,在浏览器里用工作台。你不会让客服每次点按钮前把一串 32 位的 key 粘进去。人的做法是:登录一次,之后浏览器自动证明「我还是刚才那个人」。

作为前端,你见过这个过程的表面:登录接口返回后,DevTools 的 Application → Cookies 里多了一条;之后每个请求的请求头里都自动带着 `Cookie: ...`。今天看它在服务端是怎么做的。

思路分三步:

1. 登录时,服务端验证用户名密码,生成一个随机的**session ID**(会话编号),在服务端记下「这个编号 → alice」,然后通过响应头 `Set-Cookie` 让浏览器把编号存起来。
2. 之后浏览器每次请求同一个站点,自动在 `Cookie` 头里带上这个编号。服务端拿编号去查表,查到了就知道是 alice。
3. 退出时,服务端把表里这一条删掉,并让浏览器删掉 cookie。

**cookie** 是浏览器替网站保存的一小段数据,服务端用 `Set-Cookie` 头写,浏览器在之后的请求里用 `Cookie` 头自动带回去。**session** 是服务端那张「编号 → 用户」的表。两者合起来,cookie 只装一个没有意义的随机编号,真正的信息都在服务端。

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="session 加 cookie 登录的时序:登录下发编号,之后每次自动带回,退出时作废">
<rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="60" y="28" fill="var(--ink)">浏览器</text>
<text x="440" y="28" fill="var(--ink)">服务端</text>
<line x1="80" y1="38" x2="80" y2="315" stroke="var(--rule)"/>
<line x1="460" y1="38" x2="460" y2="315" stroke="var(--rule)"/>
<rect x="480" y="40" width="150" height="58" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="488" y="58" fill="var(--ink)">SESSIONS 表</text>
<text x="488" y="76" fill="var(--ink-soft)">09Gz...yg → alice</text>
<text x="488" y="92" fill="var(--ink-faint)">(登录后才有)</text>
<line x1="80" y1="70" x2="460" y2="70" stroke="var(--mem)"/>
<text x="95" y="64" fill="var(--ink)">① POST /login 用户名+密码</text>
<line x1="460" y1="110" x2="80" y2="110" stroke="var(--mem)"/>
<text x="95" y="104" fill="var(--ink)">② 200 + Set-Cookie: sid=09Gz...yg; HttpOnly</text>
<rect x="10" y="122" width="140" height="40" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
<text x="18" y="138" fill="var(--ink)">浏览器存 cookie</text>
<text x="18" y="154" fill="var(--ink-soft)">JS 读不到</text>
<line x1="80" y1="190" x2="460" y2="190" stroke="var(--mem)"/>
<text x="95" y="184" fill="var(--ink)">③ GET /me  Cookie: sid=09Gz...yg(自动带)</text>
<line x1="460" y1="222" x2="80" y2="222" stroke="var(--mem)"/>
<text x="95" y="216" fill="var(--ink)">④ 查表 → alice,200</text>
<line x1="80" y1="262" x2="460" y2="262" stroke="var(--mem)"/>
<text x="95" y="256" fill="var(--ink)">⑤ POST /logout</text>
<line x1="460" y1="296" x2="80" y2="296" stroke="var(--mem)"/>
<text x="95" y="290" fill="var(--ink)">⑥ 删表里那条 + Set-Cookie: sid=""; Max-Age=0</text>
</g>
</svg>
<figcaption>蓝线是 HTTP 请求和响应,琥珀色是服务端的 session 表。cookie 里只有一个随机编号,「它是谁」的信息只存在服务端,所以服务端随时可以让它作废(第 ⑥ 步)。</figcaption>
</figure>

单独写一个小应用来演示,不和工单服务混在一起。新建 `part01/session_demo.py`:

```python
# agent-zero-lab/part01/session_demo.py
import secrets
from typing import Annotated, Any

from fastapi import Cookie, FastAPI, HTTPException, Response
from pydantic import BaseModel

app = FastAPI(title="CloudLedger 客服工作台(登录演示)")

USERS = {"alice": "wonderland-2026"}
SESSIONS: dict[str, dict[str, Any]] = {}


class LoginIn(BaseModel):
    username: str
    password: str


@app.post("/login")
def login(body: LoginIn, response: Response):
    real = USERS.get(body.username)
    if real is None or not secrets.compare_digest(body.password.encode(), real.encode()):
        raise HTTPException(status_code=401, detail="用户名或密码不对")
    sid = secrets.token_urlsafe(16)
    SESSIONS[sid] = {"user": body.username}
    response.set_cookie("sid", sid, max_age=3600, httponly=True, samesite="lax")
    return {"ok": True, "user": body.username}


def current_user(sid: str | None) -> str:
    session = SESSIONS.get(sid or "")
    if session is None:
        raise HTTPException(status_code=401, detail="没登录或登录已过期")
    return session["user"]


@app.get("/me")
def me(sid: Annotated[str | None, Cookie()] = None):
    return {"user": current_user(sid), "sessions_on_server": len(SESSIONS)}


@app.post("/logout")
def logout(response: Response, sid: Annotated[str | None, Cookie()] = None):
    SESSIONS.pop(sid or "", None)
    response.delete_cookie("sid")
    return {"ok": True}
```

<div class="line-notes">

- `from fastapi import Cookie, FastAPI, HTTPException, Response` `Cookie` 和昨天的 `Header`、`Query` 是一类东西,声明「这个参数从 cookie 里取」;`Response` 用来在返回之前改响应(设 cookie)。
- `USERS = {"alice": "wonderland-2026"}` 演示用的用户表,**密码明文存着,真实系统绝对不能这样**。真实系统存的是密码的哈希值(用专门的慢哈希算法),数据库泄露了也拿不到原密码;后面讲数据库和安全时会做。今天的重点是 session,不是密码存储。
- `SESSIONS: dict[str, dict[str, Any]] = {}` 服务端的 session 表:键是 session ID,值是这个会话的信息。和 `TICKETS` 一样只在内存里,重启就没了,所有人都要重新登录;生产环境一般放在 Redis 或数据库里。
- `def login(body: LoginIn, response: Response):` `response: Response` 是一个特殊参数:FastAPI 看到这个类型,会传进来一个「临时响应对象」,你在上面设的 cookie 和头,会合并到最终的响应里。函数照样 `return` 字典作为 body。
- `real = USERS.get(body.username)` 用户不存在时得到 `None`(Day 24 的 `get`)。
- `if real is None or not secrets.compare_digest(body.password.encode(), real.encode()):` 用户不存在和密码错,回的是**同一句话**。如果分别回「用户不存在」和「密码错误」,别人就能用这个接口试出哪些用户名是真的。
- `sid = secrets.token_urlsafe(16)` session ID 必须是不可猜的随机串。用自增数字(1、2、3)的话,别人把 cookie 改成 2 就成了另一个人。
- `SESSIONS[sid] = {"user": body.username}` 在服务端记下这个编号是谁。
- `response.set_cookie("sid", sid, max_age=3600, httponly=True, samesite="lax")` 生成 `Set-Cookie` 头。`max_age=3600`:浏览器保存 3600 秒后自动删除。`httponly=True`:**页面里的 JavaScript 读不到这个 cookie**,`document.cookie` 里看不见它,这样即使页面被注入了恶意脚本,也偷不走登录态(下面用浏览器实测)。`samesite="lax"`:从别的网站发起的跨站请求(比如别人页面里一个自动提交的表单)默认不带这个 cookie,用来防跨站请求伪造。<br>还有一个 `secure=True` 今天没加:它表示「只在 HTTPS 连接里发送」。我们在本机用 http 测试,加了浏览器就不会带回来;**上线时必须加**。
- `def current_user(sid: str | None) -> str:` 普通函数,查表认人。
- `session = SESSIONS.get(sid or "")` 没带 cookie 时 `sid` 是 `None`,`None or ""` 得到空字符串,查不到。
- `def me(sid: Annotated[str | None, Cookie()] = None):` 参数名 `sid` 就是 cookie 的名字,FastAPI 从请求的 `Cookie` 头里把它取出来。
- `return {"user": current_user(sid), "sessions_on_server": len(SESSIONS)}` 顺便返回服务端现在有几个 session,方便观察。
- `SESSIONS.pop(sid or "", None)` 退出时**先删服务端的记录**。`pop` 的第二个参数是「没有这个键时返回什么」,不传的话键不存在会报 `KeyError`。
- `response.delete_cookie("sid")` 让浏览器删 cookie,原理是发一个立刻过期的 `Set-Cookie`。

</div>

basedpyright 检查 0 错误。启动(先 Ctrl+C 停掉工单服务):

```bash
uv run uvicorn part01.session_demo:app --port 8000
```

另一个窗口,用 curl 走一遍登录流程。curl 不会自动保存 cookie,要用 `-c` 把收到的 cookie 写进一个文件,用 `-b` 从文件里读出来带上,这个文件叫 cookie jar(饼干罐):

```bash
B=http://127.0.0.1:8000
cd /Users/你/agent-zero-lab
curl -sS $B/me -w "  [%{http_code}]\n"
curl -sS -X POST $B/login -H "Content-Type: application/json" -d '{"username":"alice","password":"guess"}' -w "  [%{http_code}]\n"
curl -sS -i -c jar.txt -X POST $B/login -H "Content-Type: application/json" -d '{"username":"alice","password":"wonderland-2026"}'
```

<div class="line-notes">

- `curl -sS $B/me -w "  [%{http_code}]\n"` 还没登录就访问 /me。
- `"password":"guess"}'` 密码错。
- `curl -sS -i -c jar.txt -X POST $B/login` `-c jar.txt`:把响应里的 cookie 存进 `jar.txt`。`-i` 看响应头。

</div>

实跑输出:

```text
{"detail":"没登录或登录已过期"}  [401]
{"detail":"用户名或密码不对"}  [401]
HTTP/1.1 200 OK
date: Thu, 22 Oct 2026 11:02:53 GMT
server: uvicorn
content-length: 26
content-type: application/json
set-cookie: sid=09GzvjGIYaSH-40uUCSAyg; HttpOnly; Max-Age=3600; Path=/; SameSite=lax

{"ok":true,"user":"alice"}
```

`set-cookie` 那一行就是 `response.set_cookie(...)` 生成的:编号 `09GzvjGIYaSH-40uUCSAyg`(16 字节随机数编码后是 22 个字符),后面是各项属性。`Path=/` 是默认加的,表示整个站点的所有路径都带这个 cookie。看看 jar 文件里存了什么:

```bash
cat jar.txt
```

实跑输出:

```text
# Netscape HTTP Cookie File
# https://curl.se/docs/http-cookies.html
# This file was generated by libcurl! Edit at your own risk.

#HttpOnly_127.0.0.1	FALSE	/	FALSE	1792670573	sid	09GzvjGIYaSH-40uUCSAyg
```

最后一行用制表符分成 7 列:域名(前缀 `#HttpOnly_` 表示这是个 HttpOnly cookie)、是否包含子域名、路径、是否只走 HTTPS、过期时间(Unix 时间戳,登录时刻加 3600 秒)、名字、值。浏览器 DevTools 的 Application → Cookies 表格里也是这几样。

带上 cookie 访问 /me,并用 `-v` 看 curl 实际发出去的请求头:

```bash
curl -sS -b jar.txt $B/me -w "  [%{http_code}]\n"
curl -sS -v -b jar.txt $B/me 2>&1 | grep -E "^> (GET|Cookie)"
curl -sS -H "Cookie: sid=abc123" $B/me -w "  [%{http_code}]\n"
```

<div class="line-notes">

- `curl -sS -b jar.txt $B/me -w "  [%{http_code}]\n"` `-b jar.txt`:从文件里读 cookie,按规则带上。
- `curl -sS -v -b jar.txt $B/me 2>&1 | grep -E "^> (GET|Cookie)"` `-v` 的详细信息打在标准错误上,`2>&1` 把它并进标准输出才能用 grep 过滤(Day 5)。`>` 开头的行是 curl 发出去的。
- `curl -sS -H "Cookie: sid=abc123" $B/me` 手写一个伪造的编号。

</div>

实跑输出:

```text
{"user":"alice","sessions_on_server":1}  [200]
> GET /me HTTP/1.1
> Cookie: sid=09GzvjGIYaSH-40uUCSAyg
{"detail":"没登录或登录已过期"}  [401]
```

服务端认出了 alice。中间两行就是浏览器每次替你做的事:在请求头里加一行 `Cookie: sid=...`。伪造的编号在表里查不到,401。编号是 16 字节的随机数,可能的取值有 2 的 128 次方种,靠猜是猜不中的。

最后退出:

```bash
cp jar.txt jar_old.txt
curl -sS -i -b jar.txt -c jar.txt -X POST $B/logout
curl -sS -b jar_old.txt $B/me -w "  [%{http_code}]\n"
cat jar.txt
```

<div class="line-notes">

- `cp jar.txt jar_old.txt` 退出前先把旧 cookie 备份一份,模拟「有人提前偷到了这个 cookie」。
- `curl -sS -i -b jar.txt -c jar.txt -X POST $B/logout` 同时用 `-b` 带上 cookie、用 `-c` 接收服务端对 cookie 的修改。
- `curl -sS -b jar_old.txt $B/me` 用偷来的旧 cookie 再访问。

</div>

实跑输出(第一条只留了关键的几行):

```text
HTTP/1.1 200 OK
set-cookie: sid=""; expires=Thu, 22 Oct 2026 11:02:53 GMT; Max-Age=0; Path=/; SameSite=lax
{"ok":true}
{"detail":"没登录或登录已过期"}  [401]
# Netscape HTTP Cookie File
# https://curl.se/docs/http-cookies.html
# This file was generated by libcurl! Edit at your own risk.
```

`delete_cookie` 发的是一个值为空、`Max-Age=0`、过期时间就是现在的 cookie,浏览器(和 curl)收到就把它删了,jar 文件里那一行没了。更重要的是第二条:**备份的旧 cookie 也失效了**,因为服务端表里那一条已经删掉。这是 session 方案的一个大优点,服务端说作废就作废。如果退出只删 cookie、不删服务端的记录会怎样,是练习 1。

### 从浏览器里看 HttpOnly

curl 证明不了「JavaScript 读不到」。我写了一个小页面,让浏览器用 `fetch` 登录、访问 /me,再打印 `document.cookie`。新建 `part01/cookie_page.py`:

```python
# agent-zero-lab/part01/cookie_page.py
from fastapi.responses import HTMLResponse

from part01.session_demo import app

PAGE = """<!doctype html><meta charset="utf-8"><pre id="out">running</pre><script>
(async () => {
  const r1 = await fetch('/login', {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({username: 'alice', password: 'wonderland-2026'})});
  const r2 = await fetch('/me');
  document.cookie = 'theme=dark';
  document.getElementById('out').textContent =
    'login ' + r1.status + '\\nme ' + r2.status + ' ' + JSON.stringify(await r2.json()) + '\\ndocument.cookie = ' + JSON.stringify(document.cookie);
})();
</script>"""


@app.get("/page", response_class=HTMLResponse)
def page():
    return PAGE
```

<div class="line-notes">

- `from part01.session_demo import app` 直接拿 `session_demo` 的 app,往上再挂一个页面路由,这样页面和接口同源(同一个协议、域名、端口),`fetch` 不涉及跨域。
- `const r2 = await fetch('/me');` 同源请求,`fetch` 默认会带上 cookie,这一行不用写任何和 cookie 有关的代码。跨域时要加 `credentials: 'include'`,服务端还得配 CORS,这里不涉及。
- `document.cookie = 'theme=dark';` 页面自己用 JS 写一个普通 cookie,作为对照。
- `'\\ndocument.cookie = ' + JSON.stringify(document.cookie)` 把 JS 能看到的 cookie 打出来。Python 字符串里 `\\n` 写两个反斜杠,到了网页里才是 JS 的 `\n`。
- `@app.get("/page", response_class=HTMLResponse)` 返回 HTML 而不是 JSON。

</div>

启动 `uv run uvicorn part01.cookie_page:app --port 8000`,浏览器打开 `http://127.0.0.1:8000/page`。我是用 Chrome 的无头模式(没有窗口,`--dump-dom` 把 JS 执行后的页面内容打印出来)跑的,打印出的 `<pre>` 里是:

```text
login 200
me 200 {"user":"alice","sessions_on_server":1}
document.cookie = "theme=dark"
```

三行合起来就是 HttpOnly 的意义:`/me` 成功了,说明浏览器确实带着 `sid`;但 `document.cookie` 里只有 JS 自己写的 `theme=dark`,`sid` 不在里面。你用普通的 Chrome 窗口打开这个页面,再打开 DevTools → Application → Cookies,能看到 `sid` 那一行的 HttpOnly 列打着勾;在 Console 里输入 `document.cookie`,同样看不到它。

试完把 `cookie_page.py` 和两个 jar 文件删掉。

## 第 4 步:API key 和 session 怎么选

| | API key | session + cookie |
| --- | --- | --- |
| 谁在用 | 程序:后端服务、脚本、Agent | 人:在浏览器里登录 |
| 凭证怎么来 | 管理员生成后配置给调用方 | 登录时服务端生成 |
| 怎么带 | 调用方每次自己放进 `X-API-Key` 或 `Authorization` 头 | 浏览器自动放进 `Cookie` 头 |
| 服务端存什么 | 有效的 key 列表 | 「编号 → 用户」的 session 表 |
| 怎么作废 | 从列表里删掉这个 key | 删 session 记录 |
| 主要风险 | key 泄露(进日志、进代码仓库) | cookie 被偷、跨站请求伪造 |

放到 Agent 的场景里:你的 Agent 服务要调工单服务的接口(查工单、建退款单),用 API key,每个调用方一个 key,方便单独作废和追查是谁干的(练习 3);客服在工作台里看 Agent 的处理结果、点审批,用登录加 session cookie。反过来也要注意:**永远不要把 API key 写进前端代码**,浏览器里的任何东西用户都能在 DevTools 里看到。前端要调需要 key 的接口,应该让请求先到你自己的后端,由后端带上 key 转发,这也是后面 Agent 工作台的基本结构。

还有一种常见方案是 JWT,它把「你是谁」直接签名后放进令牌里,服务端不用查表。它和 session 各有取舍,Day 84 讲。

## 动手练习

**练习 1(观察题):只删 cookie 的退出。** 把 `session_demo.py` 的 `logout` 里 `SESSIONS.pop(...)` 那一行注释掉,只保留 `response.delete_cookie("sid")`。登录、记下 sid、退出,然后用 jar 文件访问 /me,再用记下的 sid 手动访问 /me,观察并解释。做完改回来。

<details><summary>参考答案</summary>

```bash
curl -sS -c jar.txt -X POST $B/login -H "Content-Type: application/json" -d '{"username":"alice","password":"wonderland-2026"}'; echo
SID=$(awk '$6=="sid"{print $7}' jar.txt); echo "SID=$SID"
curl -sS -b jar.txt -c jar.txt -X POST $B/logout; echo
curl -sS -b jar.txt $B/me -w "  [%{http_code}]\n"
curl -sS -H "Cookie: sid=$SID" $B/me -w "  [%{http_code}]\n"
```

<div class="line-notes">

- `SID=$(awk '$6=="sid"{print $7}' jar.txt); echo "SID=$SID"` `awk` 按空白切列,第 6 列是 `sid` 的那一行,打印第 7 列(值)。`$(...)` 把命令的输出存进变量(Day 5)。
- `curl -sS -b jar.txt $B/me` 用退出后的 jar,里面已经没有 sid 了。
- `curl -sS -H "Cookie: sid=$SID" $B/me` 用退出前记下的 sid。

</div>

实跑输出:

```text
{"ok":true,"user":"alice"}
SID=0U-wt0UhqIO1jl74nV-Q8w
{"ok":true}
{"detail":"没登录或登录已过期"}  [401]
{"user":"alice","sessions_on_server":1}  [200]
```

用 jar 访问是 401,看起来退出成功了;但拿着旧 sid 的人依然是 alice,服务端还有 1 个 session。`delete_cookie` 只是**请**浏览器删,对已经被复制走的 cookie 毫无作用。客服在网吧退出了工作台,以为安全了,其实谁拿到那个 cookie 谁就还能用一个小时。退出必须删服务端的记录。

</details>

**练习 2:同时支持 `Authorization: Bearer`。** 很多调用方(包括 OpenAI 兼容的 SDK)习惯用 `Authorization: Bearer <key>` 带凭证。改 `require_api_key`,`X-API-Key` 没带时,再看 `Authorization` 头是不是 `Bearer xxx` 的格式,是就把 `xxx` 当 key 用。验证 `Bearer 对的key`、`bearer 对的key`、`Bearer 错的key`、`Basic 对的key`、只有 `Bearer` 没有值,以及原来的 `X-API-Key`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/tickets_api.py(改过的 require_api_key)
def require_api_key(
    x_api_key: Annotated[str | None, Header()] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    expected = os.environ.get("TICKETS_API_KEY", "")
    if not expected:
        raise ApiError(500, "server_misconfigured", "服务端没有配置 API key")
    if x_api_key is None and authorization is not None:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() == "bearer" and token:
            x_api_key = token
    if x_api_key is None:
        raise ApiError(401, "missing_api_key", "缺少 X-API-Key 请求头", {"WWW-Authenticate": "ApiKey"})
    if not secrets.compare_digest(x_api_key.encode(), expected.encode()):
        raise ApiError(401, "invalid_api_key", "API key 不对", {"WWW-Authenticate": "ApiKey"})
```

<div class="line-notes">

- `authorization: Annotated[str | None, Header()] = None,` 再声明一个头参数,对应 `Authorization`。
- `if x_api_key is None and authorization is not None:` `X-API-Key` 优先,没有才看 `Authorization`。
- `scheme, _, token = authorization.partition(" ")` `partition` 在第一个空格处切成三段:前面、空格本身、后面。`"Bearer k123"` 得到 `("Bearer", " ", "k123")`;没有空格的 `"Bearer"` 得到 `("Bearer", "", "")`。`_` 是「这个值我不要」的习惯写法。用 `partition` 比 `split` 好,不会因为没有空格而解包出错。
- `if scheme.lower() == "bearer" and token:` 方案名不区分大小写;token 不能是空的。
- `x_api_key = token` 后面的检查照旧。

</div>

用 TestClient 验证(环境变量 `TICKETS_API_KEY=k123`),实跑输出:

```text
{'Authorization': 'Bearer k123'} 201 created
{'Authorization': 'bearer k123'} 201 created
{'Authorization': 'Bearer wrong'} 401 invalid_api_key
{'Authorization': 'Basic k123'} 401 missing_api_key
{'Authorization': 'Bearer'} 401 missing_api_key
{'X-API-Key': 'k123'} 201 created
```

`Basic` 是另一种方案(用户名密码的 base64),我们不认,当作没带。`tests/test_auth.py` 原来的 5 个测试照样全过。

</details>

**练习 3:每个调用方一个 key,并记录是谁建的单。** 环境变量改成 `TICKETS_API_KEYS="agent-bot:kA1x9,web-console:kW7q2"`(名字:key,逗号分隔)。写一个依赖 `require_client`,认出 key 属于谁并**返回名字**;`create_ticket` 把名字记到工单的 `created_by` 字段,`update_status` 记到 `updated_by`。然后检查:不带 key 去 PATCH 一个不存在的 9999,回的是 401 还是 404?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/tickets_api.py(替换 require_api_key)
def load_keys() -> dict[str, str]:
    keys: dict[str, str] = {}
    for pair in os.environ.get("TICKETS_API_KEYS", "").split(","):
        name, _, key = pair.strip().partition(":")
        if name and key:
            keys[key] = name
    return keys


def require_client(x_api_key: Annotated[str | None, Header()] = None) -> str:
    keys = load_keys()
    if not keys:
        raise ApiError(500, "server_misconfigured", "服务端没有配置 API key")
    if x_api_key is None:
        raise ApiError(401, "missing_api_key", "缺少 X-API-Key 请求头", {"WWW-Authenticate": "ApiKey"})
    for key, name in keys.items():
        if secrets.compare_digest(x_api_key.encode(), key.encode()):
            return name
    raise ApiError(401, "invalid_api_key", "API key 不对", {"WWW-Authenticate": "ApiKey"})


ClientDep = Annotated[str, Depends(require_client)]
```

<div class="line-notes">

- `def load_keys() -> dict[str, str]:` 把环境变量解析成「key → 名字」的字典。键是 key、值是名字,方便按 key 找人。
- `for pair in os.environ.get("TICKETS_API_KEYS", "").split(","):` 按逗号切成几段,`"agent-bot:kA1x9,web-console:kW7q2"` 切成两段。
- `name, _, key = pair.strip().partition(":")` 每段去空格,在第一个冒号处切开。
- `if name and key:` 空段或格式不对的段跳过。
- `def require_client(x_api_key: Annotated[str | None, Header()] = None) -> str:` 和 `require_api_key` 的区别是**有返回值**:返回调用方的名字。
- `for key, name in keys.items():` 逐个用 `compare_digest` 比。不用 `keys.get(x_api_key)` 直接查字典,是为了每次比较都走恒定耗时的函数。
- `ClientDep = Annotated[str, Depends(require_client)]` 和 `TicketDep` 一样的写法。

</div>

两个接口去掉装饰器上的 `dependencies`,改成参数:

```python
# agent-zero-lab/part01/tickets_api.py(改过的 create_ticket 和 update_status)
@app.post("/tickets", status_code=201)
def create_ticket(client: ClientDep, ticket: TicketCreate):
    """新建一张工单。id 和 status 由服务端决定,客户端不能传。"""
    new_id = max(t["id"] for t in TICKETS) + 1
    row = {"id": new_id, "title": ticket.title, "status": "open", "priority": ticket.priority, "created_by": client}
    TICKETS.append(row)
    return row


@app.patch("/tickets/{ticket_id}")
def update_status(client: ClientDep, ticket: TicketDep, body: StatusUpdate):
    ticket["status"] = body.status
    ticket["updated_by"] = client
    return ticket
```

<div class="line-notes">

- `def create_ticket(client: ClientDep, ticket: TicketCreate):` 依赖有返回值了,所以写在参数上,`client` 拿到的是 `"agent-bot"` 这样的名字。
- `"created_by": client` 记下是谁建的。出了问题能查到是 Agent 建的还是人建的,想停掉某个调用方,只要从环境变量里删掉它那一项。
- `def update_status(client: ClientDep, ticket: TicketDep, body: StatusUpdate):` **`client` 一定要放在 `ticket` 前面**,原因看下面的实测。

</div>

用 TestClient 验证,实跑输出:

```text
{'id': 1004, 'title': 'Agent 自动建的单', 'status': 'open', 'priority': 'normal', 'created_by': 'agent-bot'}
{'id': 1005, 'title': '客服在网页上建的单', 'status': 'open', 'priority': 'normal', 'created_by': 'web-console'}
{'id': 1004, 'title': 'Agent 自动建的单', 'status': 'closed', 'priority': 'normal', 'created_by': 'agent-bot', 'updated_by': 'web-console'}
invalid_api_key
```

再回答最后那个问题。我第一版写的是 `def update_status(ticket: TicketDep, body: StatusUpdate, client: ClientDep)`,把 `client` 放在最后。不带 key 去 PATCH 9999,实跑得到的是:

```text
404 ticket_not_found
```

**没认证的人收到了 404**。FastAPI 按参数从左往右解析依赖,`find_ticket` 先跑,抛了 404,根本没轮到检查 key。别人就能用「不带 key 的 PATCH」逐个试编号,404 的是不存在、401 的是存在。把 `client: ClientDep` 挪到第一个参数以后,同样的请求实跑得到 `401 missing_api_key`。正文里用装饰器 `dependencies=[...]` 时没有这个问题,因为装饰器上的依赖总是先于参数里的依赖执行。basedpyright 0 错误。

</details>

**练习 4:服务端也要管过期。** `max_age=3600` 只是让**浏览器**一小时后删 cookie。如果有人把 cookie 复制走了,他手里那份不会自己消失。给 `SESSIONS` 里的每条记录加一个 `expires_at`,`current_user` 发现过期就删掉记录并回 401。为了能很快看到效果,把有效期做成模块级常量 `SESSION_TTL`,测试时改成 2 秒。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/session_demo.py(改过的部分)
import secrets
import time

SESSION_TTL = 3600


@app.post("/login")
def login(body: LoginIn, response: Response):
    real = USERS.get(body.username)
    if real is None or not secrets.compare_digest(body.password.encode(), real.encode()):
        raise HTTPException(status_code=401, detail="用户名或密码不对")
    sid = secrets.token_urlsafe(16)
    SESSIONS[sid] = {"user": body.username, "expires_at": time.time() + SESSION_TTL}
    response.set_cookie("sid", sid, max_age=SESSION_TTL, httponly=True, samesite="lax")
    return {"ok": True, "user": body.username}


def current_user(sid: str | None) -> str:
    session = SESSIONS.get(sid or "")
    if session is None or session["expires_at"] < time.time():
        SESSIONS.pop(sid or "", None)
        raise HTTPException(status_code=401, detail="没登录或登录已过期")
    return session["user"]
```

<div class="line-notes">

- `import time` `time.time()` 是当前的 Unix 时间戳(秒,浮点数),≈JS 的 `Date.now() / 1000`。
- `SESSION_TTL = 3600` TTL 是 time to live,存活时间。cookie 和服务端用同一个值。`SESSION_TTL = 3600` 这一行放在 `SESSIONS = {}` 下面。
- `SESSIONS[sid] = {"user": body.username, "expires_at": time.time() + SESSION_TTL}` 服务端记下过期时刻。
- `response.set_cookie("sid", sid, max_age=SESSION_TTL, httponly=True, samesite="lax")` cookie 的有效期也用常量。
- `if session is None or session["expires_at"] < time.time():` 查不到,或者查到了但已过期。`or` 短路(Day 17):`session is None` 为真时不会去执行后半句,所以不会对 `None` 取下标。
- `SESSIONS.pop(sid or "", None)` 过期的顺手删掉,表不会越来越大。

</div>

验证脚本 `part01/expiry_check.py`:

```python
# agent-zero-lab/part01/expiry_check.py
import time

from fastapi.testclient import TestClient

from part01 import session_demo

session_demo.SESSION_TTL = 2
c = TestClient(session_demo.app)
r = c.post("/login", json={"username": "alice", "password": "wonderland-2026"})
sid = r.cookies["sid"]
print("set-cookie:", r.headers["set-cookie"])
print("立刻:", c.get("/me", cookies={"sid": sid}).json())
time.sleep(2.5)
r = c.get("/me", cookies={"sid": sid})
print("2.5 秒后(手动带旧 sid):", r.status_code, r.json())
print("服务端剩余 session 数:", len(session_demo.SESSIONS))
```

<div class="line-notes">

- `session_demo.SESSION_TTL = 2` 直接改模块上的常量。`login` 每次调用时才读它,所以改了马上生效(和 Day 80 换 `TICKETS` 是同一个道理)。
- `sid = r.cookies["sid"]` 从登录响应里拿到 sid,模拟「被复制走的 cookie」。
- `print("立刻:", c.get("/me", cookies={"sid": sid}).json())` 手动带着 sid 访问。
- `time.sleep(2.5)` 等过期。
- `r = c.get("/me", cookies={"sid": sid})` 过期后还拿着那个 sid,这一次是服务端的检查在起作用,和浏览器删没删 cookie 无关。

</div>

`uv run python -m part01.expiry_check` 实跑输出:

```text
set-cookie: sid=3jXfZVSffHG1CWPHa_8acg; HttpOnly; Max-Age=2; Path=/; SameSite=lax
立刻: {'user': 'alice', 'sessions_on_server': 1}
2.5 秒后(手动带旧 sid): 401 {'detail': '没登录或登录已过期'}
服务端剩余 session 数: 0
```

过期以后,手里拿着 sid 也没用了,服务端的记录也清掉了。规律和练习 1 一样:**真正说了算的是服务端**,cookie 上的任何属性都只是对浏览器的请求。

</details>

**验收标准:** 工单服务用 `TICKETS_API_KEY=... uv run uvicorn ...` 启动后,POST/PATCH 不带 key、带错 key 都是 401 且有 `www-authenticate` 头,带对是 201/200,GET 不需要 key;不配环境变量启动时写操作一律 500 `server_misconfigured`;`uv run pytest -q` 全绿;`session_demo` 能用 curl 走完「401 → 登录 → 200 → 退出 → 旧 cookie 401」;能不看文章说出 401 和 403 的区别、HttpOnly 防的是什么、为什么退出要删服务端记录。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 认证(authentication) | 确认请求是谁发的,今天的 API key 和登录都是认证 |
| 授权(authorization) | 确认了身份以后,判断能不能做这件事 |
| 401 Unauthorized | 没带凭证或凭证不对(其实是「未认证」),要带 `WWW-Authenticate` 头 |
| 403 Forbidden | 认出你了,但你没有这个权限 |
| `WWW-Authenticate` | 401 响应里的头,告诉客户端服务端接受哪种凭证 |
| API key | 一串随机字符,服务端和调用方各存一份,每次请求放在头里带上;用于程序调程序 |
| `Header()` | 声明参数来自请求头;参数名的下划线换成横线去找,不区分大小写 |
| `dependencies=[...]` | 写在路由装饰器上的依赖,只执行、不提供参数值,总在参数依赖之前执行 |
| `secrets` | 标准库里生成安全随机数、做安全比较的模块,`token_urlsafe`、`compare_digest` |
| 时序攻击(timing attack) | 通过测量响应时间的细微差别推测密钥,用恒定耗时的比较函数防御 |
| fail open / fail closed | 出故障时放行 / 出故障时拒绝;安全检查必须 fail closed |
| Bearer | `Authorization: Bearer <token>`,最常见的「带令牌」写法 |
| cookie | 浏览器替网站保存的小段数据,服务端用 `Set-Cookie` 写,浏览器用 `Cookie` 头自动带回 |
| session | 服务端保存的「会话编号 → 用户信息」记录 |
| session ID | 放在 cookie 里的随机编号,必须不可猜 |
| HttpOnly | cookie 属性:页面 JS 读不到,`document.cookie` 里看不见 |
| SameSite | cookie 属性:跨站请求时带不带它,`lax` 是常用的折中 |
| Secure | cookie 属性:只在 HTTPS 下发送,上线必须加 |
| Max-Age | cookie 属性:浏览器保存多少秒;服务端要另外管过期 |
| cookie jar | curl 保存 cookie 的文件,`-c` 写、`-b` 读 |
| `Response` 参数 | 处理函数声明 `response: Response`,就能在返回前往响应上设 cookie 和头 |
| TTL | time to live,存活时间 |

## 常见误区

**服务端没配 key 时等于没锁。** 实测反面教材:不带任何凭证,退款单建成功了。配置缺失必须直接拒绝(fail closed),并写一个测试钉住。

**把 key 放在 URL 查询参数里。** 实测 uvicorn 访问日志把完整 key 记了下来。放在请求头里。

**用 `==` 比较密钥。** 功能没错,但给时序攻击留了口子。用 `secrets.compare_digest`,并先 `.encode()`,否则含中文的字符串会报 `TypeError`。

**头名写成下划线。** 服务端参数叫 `x_api_key`,调用方要发 `X-API-Key`。发 `X_API_KEY` 实测是 401 `missing_api_key`。

**401 和 403 用反。** 没登录、key 不对是 401;登录了但没权限才是 403。前端通常据此决定「跳到登录页」还是「提示没权限」,用反了前端会做错事。

**依赖顺序让 404 先于 401。** 参数里的依赖按从左往右执行,把找资源的依赖写在鉴权前面,没认证的人就能通过 404/401 的区别探测数据。鉴权依赖放第一个参数,或者写在装饰器的 `dependencies` 里。

**退出只删 cookie。** 实测被复制走的旧 cookie 依然有效。退出要删服务端的 session 记录。

**以为 `Max-Age` 能管住过期。** 它只约束浏览器。服务端要自己记过期时间并检查。

**用自增数字或可猜的值当 session ID。** 别人改个数字就成了另一个人。用 `secrets.token_urlsafe`。

**登录接口分别提示「用户不存在」和「密码错误」。** 这会泄露哪些用户名是真的,两种情况回同一句话。

**把 API key 写进前端代码。** 浏览器里的一切都能在 DevTools 里看到。需要 key 的调用放到后端去做。

**本机测试加了 `secure=True`,然后登录「不生效」。** Secure cookie 只在 HTTPS 下发送,`http://127.0.0.1` 上浏览器不会带回来。本机测试不加,上线必须加。

## 学习资料

### 文档与文章

- [FastAPI 中文文档 · Header 参数](https://fastapi.tiangolo.com/zh/tutorial/header-params/):`Header()` 的用法和下划线自动转横线的规则。
- [FastAPI 中文文档 · Cookie 参数](https://fastapi.tiangolo.com/zh/tutorial/cookie-params/):`Cookie()` 读 cookie。
- [FastAPI 中文文档 · 响应 - 设置 Cookies](https://fastapi.tiangolo.com/zh/advanced/response-cookies/):`response.set_cookie` 和 `Response` 参数。
- [FastAPI 中文文档 · 安全性](https://fastapi.tiangolo.com/zh/tutorial/security/):FastAPI 自带的安全工具(`APIKeyHeader`、OAuth2 等)的总览。今天我们手写依赖是为了看清原理,这些现成工具的好处是会自动出现在 `/docs` 里,有个 Authorize 按钮。
- [MDN · 使用 HTTP Cookie](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Guides/Cookies):从浏览器角度把 cookie 讲全了,包括 HttpOnly、Secure、SameSite 的作用。
- [MDN · Set-Cookie](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Reference/Headers/Set-Cookie):每个属性的精确定义。
- [MDN · 401 Unauthorized](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Reference/Status/401)、[MDN · 403 Forbidden](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Reference/Status/403)、[MDN · WWW-Authenticate](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Reference/Headers/WWW-Authenticate):三个概念的标准解释。
- [Python 文档 · secrets 模块](https://docs.python.org/zh-cn/3.12/library/secrets.html):`token_urlsafe` 和 `compare_digest`,还写了生成令牌该用多长。
- [OWASP · Session Management Cheat Sheet(英文)](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html):session 安全的权威清单。今天的 ID 要随机、退出要删服务端记录、服务端要管过期、cookie 加 HttpOnly/Secure/SameSite,这里都有,还有更多。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ob4y1Y7Ep&autoplay=0&high_quality=1" title="Cookie、Session、Token究竟区别在哪?如何进行身份认证,保持用户登录状态?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>技术蛋老师 · Cookie、Session、Token 究竟区别在哪?如何进行身份认证,保持用户登录状态? · 14 分钟,播放 40 多万。动画讲清楚三者的关系,第 3 步的流程和 Day 84 的 JWT 都能在里面找到。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1sDn368E32&autoplay=0&high_quality=1" title="这台电脑认你,那台不认:Cookie 与 Session 一次讲清" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>简单-编程 · 这台电脑认你,那台不认:Cookie 与 Session 一次讲清 · 16 分钟,2026 年的新视频。从「为什么换台电脑就要重新登录」讲起,适合当今天的预习。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/UBUNrFtufWo" title="Session vs Token Authentication in 100 Seconds" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Fireship · Session vs Token Authentication in 100 Seconds · 英文,不到两分钟。session 和令牌两种方案的一句话对比,看完今天、预习 Day 84 时各看一次。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/sovAIX4doOE" title="HTTP Cookies Crash Course" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hussein Nasser · HTTP Cookies Crash Course · 英文,偏长。一个后端工程师把 cookie 的每个属性(作用域、过期、HttpOnly、SameSite、Secure)逐个演示,第 3 步讲到的属性在这里都有实例。</figcaption>
</figure>

### 书籍

- Neil Madden,《API Security in Action》,Manning,2020(英文)。从零开始给一个 API 加认证、限流、审计日志,第一部分讲的就是 API key、session cookie 这些基础方案和它们的攻击方式。例子是 Java 写的,但讲的道理和语言无关,Day 84 的令牌和以后的 OAuth 也在这本书里。

### 开源项目与代码

- [fastapi/fastapi 的 fastapi/security/api_key.py](https://github.com/fastapi/fastapi/blob/master/fastapi/security/api_key.py):FastAPI 自带的 `APIKeyHeader`、`APIKeyQuery`、`APIKeyCookie`。读一读会发现它做的事和我们的 `require_api_key` 前半段差不多(取头、没带就 401),比对 key 的那一步还是要你自己写。
- [fastapi/full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template):`backend/app/api/deps.py` 里的 `get_current_user` 是一个「从请求里取凭证、认出用户」的依赖,和今天的 `require_client` 是同一个形状,只是它用的是 JWT。
- [RFC 6265](https://datatracker.ietf.org/doc/html/rfc6265):cookie 的规范原文,`Set-Cookie` 每个属性的权威定义,遇到浏览器行为说不清时查。

## 自测

1. 客户端不带 key 请求,服务端该回 401 还是 403?登录了的只读用户去改工单呢?

<details><summary>答案</summary>

不带 key 是「不知道你是谁」,401,并带 `WWW-Authenticate` 头。只读用户改工单是「知道你是谁,但你没权限」,403。

</details>

2. 下面这个检查有什么问题?`expected = os.environ.get("KEY", ""); if x_api_key != expected: raise 401`(没带头时 `x_api_key` 默认是 `""`)

<details><summary>答案</summary>

两个问题。主要的是 fail open:服务端忘了配 `KEY` 时,`expected` 是空字符串,不带头的请求 `"" != ""` 为假,直接放行,谁都能进,今天实测了。要先判断 `expected` 为空就拒绝一切。次要的是用 `!=` 比较,应该用 `secrets.compare_digest`。

</details>

3. session 方案里,cookie 里存的是什么?「这个人是 alice」这件事存在哪?这样设计有什么好处?

<details><summary>答案</summary>

cookie 里只存一个随机的 session ID,本身没有任何含义。「编号对应 alice」存在服务端的 session 表里。好处是服务端完全掌控:退出、过期、强制下线时删掉记录,即使 cookie 被人复制走也立刻失效;cookie 里没有用户信息,泄露了也看不出什么。代价是每个请求都要查一次表,多台服务器时这张表要放在共享的存储里。

</details>

4. HttpOnly 防的是什么?它能防住跨站请求伪造吗?

<details><summary>答案</summary>

HttpOnly 让页面里的 JavaScript 读不到这个 cookie,防的是页面被注入恶意脚本(XSS)后,脚本把登录 cookie 读出来发给攻击者。它防不住跨站请求伪造:那种攻击不需要读 cookie,只需要让浏览器在用户不知情时带着 cookie 发出请求。防跨站请求伪造靠 `SameSite`,以及 Day 80 提到的「不是 JSON 头就不解析」这类服务端检查。

</details>

5. 面试题:你在做一个客服 Agent 平台。Agent 后端要调用内部的工单服务和退款服务,客服通过网页工作台查看和审批 Agent 的操作。你会怎么设计这两条链路的认证?

<details><summary>答案</summary>

Agent 后端调内部服务是程序调程序,用 API key(或者更进一步用短期令牌):每个调用方一个独立的 key,放在服务端的密钥管理或环境变量里,不进代码仓库;请求放在头里,服务端用恒定耗时比较,配置缺失时拒绝;按 key 记录调用方,写操作留下 `created_by` 方便审计,出事可以单独吊销。权限上给 Agent 的 key 最小权限,比如只能建退款申请、不能直接执行退款,执行要经人审批。客服用网页工作台,走登录加 session:HttpOnly、Secure、SameSite 的 cookie,服务端管过期,退出删记录;API key 绝不出现在前端代码里,前端的请求都先到工作台自己的后端,由后端去调内部服务。两条链路的审计日志都带请求编号和身份,能把「哪个客服审批了 Agent 的哪一步」串起来。

</details>

## 明天预告

Day 83 · 第 12 周复习:编程地基(Day 77–82)。这一周从「进程和端口」开始,手写了一个 http.server,换成 FastAPI,加上请求体、统一错误、依赖、中间件和鉴权。明天把这一周画成一张图,默写最核心的那几段(路由、请求体模型、异常处理器、依赖、API key 校验),再把这周踩过的坑过一遍。复习完的 Day 84 接着讲另一种认证方式 JWT:它为什么不需要服务端那张 session 表,又为什么因此很难作废。
