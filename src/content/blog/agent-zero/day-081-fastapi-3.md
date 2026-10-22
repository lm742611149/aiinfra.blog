---
title: 'Day 81 · FastAPI(三):错误处理、依赖注入和中间件'
description: '把工单服务里长相各异的错误(字符串 detail、列表 detail、纯文本 500)统一成一种 JSON 格式;用 Depends 把复制了两遍的「找工单,找不到就 404」抽成一个依赖;再写一个中间件给每个响应盖上请求编号。顺带看清一个请求在中间件和异常处理器之间是怎么一层层穿过去的。'
pubDate: 2026-10-22
regime: none
tags: ['fastapi', 'backend', 'python', 'agent-zero']
series: 'agent-zero'
day: 81
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 80](/blog/agent-zero/day-080-fastapi-2/) 给工单服务加上了 `POST /tickets`:请求体交给 pydantic 模型 `TicketCreate` 校验,`Field` 限长度,`extra="forbid"` 不许多传字段,成功回 201;`/docs` 和 `/openapi.json` 从同一份类型标注里自动生成。练习 1 给 title 加了去空格的 `field_validator`,练习 4 加了 `PATCH /tickets/{ticket_id}` 改状态。

做练习 4 时你应该注意到了两件不太舒服的事。一是「循环找工单,找不到就 404」这段代码在 `get_ticket` 和 `update_status` 里各写了一遍。二是这个服务回出去的错误长得五花八门:404 的 `detail` 是一个字符串,422 的 `detail` 是一个列表。前端要写两套解析逻辑,这还没算服务端自己出 bug 的情况。今天把这两件事收拾干净,再加一样生产服务几乎都有的东西:请求编号。

## 今天要解决的问题

学完今天,你应该能做到:

1. 定义自己的异常类和**异常处理器**,把业务错误、参数校验错误、框架的 404/405、以及代码 bug 引起的 500,统一成同一种 JSON 格式,并且 500 不把内部细节漏给前端。
2. 用 **`Depends`**(依赖注入)把重复的「找工单」逻辑抽成一个函数,让多个接口共用,并说清楚依赖函数的参数从哪来。
3. 写一个 **HTTP 中间件**,给每个响应加 `X-Request-ID` 和处理耗时,并解释为什么 500 的响应一开始拿不到这个头。

严格说今天有三个新东西。前两个是重点;中间件只讲最常用的一种写法,够你看懂和写一个计时、加头的小中间件就行。

预计用时:3 小时。花费 ¥0,不调模型。

前置:[Day 80](/blog/agent-zero/day-080-fastapi-2/) 的 `tickets_api.py`(带练习 1 的 `strip_title` 和练习 4 的 `update_status`)和 `tests/test_create_ticket.py`;[Day 79](/blog/agent-zero/day-079-fastapi-1/) 的 `tests/test_tickets_api.py`、`tests/test_ex79.py`;[Day 36](/blog/agent-zero/day-036-exceptions-2/) 的 `raise` 和自定义异常;[Day 67](/blog/agent-zero/day-067-async-2/) 的 `async def` 和 `await`;[Day 75](/blog/agent-zero/day-075-logging/) 的 `logging.getLogger(__name__)`。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把四个异常处理器、`find_ticket` 依赖和 `add_request_id` 中间件默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 第 0 步:现在的错误都长什么样

先给服务加一个故意出 bug 的接口,模拟「代码里有个没想到的错误」。在 `part01/tickets_api.py` 文件末尾加:

```python
# agent-zero-lab/part01/tickets_api.py(末尾追加,演示用)
@app.get("/debug/boom")
def boom():
    return {"ratio": 1 / 0}
```

<div class="line-notes">

- `return {"ratio": 1 / 0}` 除以零,Python 会抛 `ZeroDivisionError`(Day 35)。真实项目里这类 bug 可能是某个字段是 `None`、某个字典少了键,效果一样:处理函数里抛了一个你没接住的异常。

</div>

启动服务(第一个窗口,仓库根目录 `/Users/你/agent-zero-lab`):

```bash
uv run uvicorn part01.tickets_api:app --port 8000 --reload
```

第二个窗口,请求四种出错的情况:

```bash
B=http://127.0.0.1:8000
curl -sS -i $B/debug/boom
curl -sS $B/tickets/9999; echo
curl -sS $B/tickets/abc; echo
curl -sS $B/nope; echo
```

<div class="line-notes">

- `curl -sS -i $B/debug/boom` `-i` 把响应头也打印出来,要看 500 的 `content-type`。
- `curl -sS $B/tickets/9999; echo` 后面的 `echo` 只是补一个换行,让输出一行一条。

</div>

实跑输出:

```text
HTTP/1.1 500 Internal Server Error
date: Thu, 22 Oct 2026 10:56:04 GMT
server: uvicorn
content-length: 21
content-type: text/plain; charset=utf-8

Internal Server Error
{"detail":"没有这张工单: 9999"}
{"detail":[{"type":"int_parsing","loc":["path","ticket_id"],"msg":"Input should be a valid integer, unable to parse string as an integer","input":"abc"}]}
{"detail":"Not Found"}
```

服务器窗口里,500 那一条后面跟了一大段 traceback(Day 35 学过怎么读,从下往上看),最后一行是:

```text
ZeroDivisionError: division by zero
```

站在前端的角度数一下,你要应付三种形状:

- 500 根本不是 JSON,是 `text/plain` 的一句 `Internal Server Error`。前端 `await res.json()` 会直接抛 `SyntaxError`,错误处理代码自己先崩了。
- 404 的 `detail` 是字符串。
- 422 的 `detail` 是数组,每一项还是个对象。

于是前端的错误处理大概会写成这样:

```js
const text = await res.text();
let msg;
try {
  const data = JSON.parse(text);
  msg = typeof data.detail === "string" ? data.detail : data.detail.map((e) => e.msg).join("; ");
} catch {
  msg = text;
}
```

<div class="line-notes">

- `const text = await res.text();` 不敢直接 `res.json()`,因为 500 不是 JSON。
- `msg = typeof data.detail === "string" ? data.detail : data.detail.map((e) => e.msg).join("; ");` 按 `detail` 的类型分两种情况处理。以后后端再多一种形状,这里就再加一个分支。
- `} catch {` JSON 解析失败,就把原文当错误信息。

</div>

这种代码每个调用这个服务的地方都得有一份。更好的办法是让服务端承诺:**不管出什么错,响应体永远是同一个形状**。我们定成这样:

```json
{"error": {"code": "ticket_not_found", "message": "没有这张工单: 9999", "details": []}}
```

`code` 是给程序判断用的稳定短字符串,前端可以 `switch (err.code)`;`message` 是给人看的说明;`details` 放 422 那种逐字段的错误,其他时候是空列表。

## 第 1 步:自己的异常类和第一个异常处理器

先处理我们自己的业务错误。文件顶部的 import 先改一下,多导入 `Request` 和 `JSONResponse`:

```python
# agent-zero-lab/part01/tickets_api.py(改过的 import)
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
```

然后在 `StatusUpdate` 模型下面加一段:

```python
# agent-zero-lab/part01/tickets_api.py(新增,放在 StatusUpdate 后面)
class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def error_body(code: str, message: str, details: list[Any] | None = None) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "details": details or []}}


@app.exception_handler(ApiError)
def handle_api_error(request: Request, exc: ApiError):
    return JSONResponse(status_code=exc.status, content=error_body(exc.code, exc.message))
```

<div class="line-notes">

- `class ApiError(Exception):` Day 36 学的自定义异常:继承 `Exception`。和 `HTTPException` 不同,它是**我们自己的**,里面装什么由我们定。
- `def __init__(self, status: int, code: str, message: str):` 三样东西:HTTP 状态码、给程序看的 code、给人看的 message。
- `super().__init__(message)` 调用父类 `Exception` 的初始化,这样 `str(exc)` 能得到 message,打日志时有用。Day 42 讲过 `super()`。
- `def error_body(code: str, message: str, details: list[Any] | None = None) -> dict[str, Any]:` 统一格式只在这一个函数里定义,后面所有处理器都调它,格式要改只改这里。
- `"details": details or []` `None` 是假值(Day 14),`None or []` 得到 `[]`。
- `@app.exception_handler(ApiError)` 登记一个**异常处理器**:以后任何处理函数里抛出 `ApiError`,FastAPI 不再回默认的 500,而是调用下面这个函数,用它的返回值作为响应。相当于给整个应用包了一层 `try { ... } catch (e) { if (e instanceof ApiError) ... }`,不用在每个接口里自己写。
- `def handle_api_error(request: Request, exc: ApiError):` 处理器固定接收两个参数:当前请求和被抛出的异常对象。`Request` 是 FastAPI(底层是 starlette)的请求对象,今天第 4 步会用到它。
- `return JSONResponse(status_code=exc.status, content=error_body(exc.code, exc.message))` 平时返回字典,FastAPI 帮你变成 200 的 JSON 响应;这里要指定状态码,就自己造一个 `JSONResponse`。

</div>

然后把 `get_ticket` 和 `update_status` 里的 `raise HTTPException(status_code=404, ...)` 都换成:

```python
    raise ApiError(404, "ticket_not_found", f"没有这张工单: {ticket_id}")
```

保存,再请求 9999:

```bash
curl -sS $B/tickets/9999 -w "  [%{http_code}]\n"
```

实跑输出:

```text
{"error":{"code":"ticket_not_found","message":"没有这张工单: 9999","details":[]}}  [404]
```

自己的错误统一了。另外三种还是老样子,因为那些不是我们抛的。

## 第 2 步:接管框架自己的错误

剩下三类错误各有来处:

| 错误 | 谁抛的 | 异常类 |
| --- | --- | --- |
| 422 参数校验失败 | FastAPI 在调用处理函数之前 | `RequestValidationError` |
| 404 路径不存在、405 方法不对 | 底层 starlette 的路由 | starlette 的 `HTTPException` |
| 500 代码 bug | 你的代码,但你没想到 | 任何 `Exception` |

给每一类都登记一个处理器。先把文件开头的 import 补全,并建一个 logger(Day 75 的写法):

```python
# agent-zero-lab/part01/tickets_api.py(文件开头)
import logging
from typing import Annotated, Any, Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)
```

`from starlette.exceptions import HTTPException as StarletteHTTPException` 里的 `as` 是起别名(Day 32),因为它和 FastAPI 的 `HTTPException` 重名。然后接着第 1 步的代码往下写:

```python
# agent-zero-lab/part01/tickets_api.py(接着 handle_api_error 往下加)
@app.exception_handler(RequestValidationError)
def handle_validation_error(request: Request, exc: RequestValidationError):
    details = [{"loc": e["loc"], "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
    return JSONResponse(status_code=422, content=error_body("validation_error", "请求参数不合法", details))


@app.exception_handler(StarletteHTTPException)
def handle_http_error(request: Request, exc: StarletteHTTPException):
    body = error_body(f"http_{exc.status_code}", str(exc.detail))
    return JSONResponse(status_code=exc.status_code, content=body, headers=exc.headers)


@app.exception_handler(Exception)
def handle_unexpected(request: Request, exc: Exception):
    logger.error("未处理的异常 %s %s", request.method, request.url.path, exc_info=exc)
    return JSONResponse(status_code=500, content=error_body("internal_error", "服务器出错了,请稍后再试"))
```

<div class="line-notes">

- `@app.exception_handler(RequestValidationError)` 接管 422。FastAPI 校验失败时抛的就是这个异常。
- `details = [{"loc": e["loc"], "msg": e["msg"], "type": e["type"]} for e in exc.errors()]` `exc.errors()` 返回的列表就是原来 `detail` 里的那些对象。我只挑了 `loc`、`msg`、`type` 三项,**故意去掉了 `input`**:用户提交的原值可能很长,也可能是密码,原样回显不是好习惯。列表推导式是 Day 23 的。
- `return JSONResponse(status_code=422, content=error_body("validation_error", "请求参数不合法", details))` 状态码保持 422,格式换成我们的。
- `@app.exception_handler(StarletteHTTPException)` 注意导入的是 **starlette 的** `HTTPException`,不是 FastAPI 的。路径不存在时抛 404 的是 starlette 的路由,它抛的是 starlette 版本;FastAPI 的 `HTTPException` 是它的子类。登记父类,两种都能接住。登记成子类会漏掉什么,练习 3 实测。
- `body = error_body(f"http_{exc.status_code}", str(exc.detail))` code 用状态码拼出来,比如 `http_404`、`http_405`。
- `return JSONResponse(status_code=exc.status_code, content=body, headers=exc.headers)` **`headers=exc.headers` 不能漏**,下面马上演示漏了会怎样。
- `@app.exception_handler(Exception)` 接管所有没被前面接住的异常,也就是 bug。
- `logger.error("未处理的异常 %s %s", request.method, request.url.path, exc_info=exc)` 给**自己**留完整的记录:`exc_info=exc` 让日志带上这个异常的 traceback。Day 75 学的 `%s` 占位写法。
- `return JSONResponse(status_code=500, content=error_body("internal_error", "服务器出错了,请稍后再试"))` 给**前端**的只有一句客气话,不带异常类型、不带文件路径。traceback 里有你的目录结构和代码,回给浏览器等于把内部情况公开了。

</div>

保存,重跑第 0 步那组请求:

```bash
curl -sS -i $B/debug/boom
curl -sS $B/tickets/abc; echo
curl -sS $B/nope; echo
curl -sS -X DELETE $B/tickets/1001; echo
```

实跑输出(第一条只留了状态行、content-type 和 body):

```text
HTTP/1.1 500 Internal Server Error
content-type: application/json

{"error":{"code":"internal_error","message":"服务器出错了,请稍后再试","details":[]}}
{"error":{"code":"validation_error","message":"请求参数不合法","details":[{"loc":["path","ticket_id"],"msg":"Input should be a valid integer, unable to parse string as an integer","type":"int_parsing"}]}}
{"error":{"code":"http_404","message":"Not Found","details":[]}}
{"error":{"code":"http_405","message":"Method Not Allowed","details":[]}}
```

全都是 `{"error": {...}}` 了,500 也变成了 JSON。前端那段 `try/typeof` 可以简化成一行 `const { error } = await res.json()`。

### 那个差点漏掉的 `headers`

我第一版写 `handle_http_error` 时没写 `headers=exc.headers`。格式统一了,测试也过了,但对比一下 405 的响应头。用 TestClient 分别对我的服务发 `DELETE /tickets`,和对一个只有一条 GET 路由、什么处理器都没加的最小 FastAPI 应用发 DELETE,打印状态码和响应头:

```text
我的服务:     405 {'content-length': '97', 'content-type': 'application/json', 'x-request-id': '55c2857f', 'x-process-time-ms': '2.1'}
最小应用:     405 {'allow': 'GET', 'content-length': '31', 'content-type': 'application/json'}
```

(第一行里的 `x-request-id` 是第 4 步才加的中间件,这里先忽略。)

默认的 405 带着一个 `allow` 头,告诉客户端这个路径允许哪些方法,这是 HTTP 规范要求 405 必须带的;我的版本把它弄丢了。starlette 抛 `HTTPException` 时会把这类头放在 `exc.headers` 里,你接管了处理,就要负责把它带上。加上 `headers=exc.headers` 以后,`curl -i -X DELETE $B/tickets/1001` 的响应头里又有 `allow: GET` 了。(你可能奇怪 `/tickets/{ticket_id}` 明明还有 PATCH,为什么只写了 GET:starlette 在报 405 时只看第一条路径匹配上的路由,GET 和 PATCH 是两条路由,它报的是第一条的方法。这是它的实现细节,知道就行。)

明天写鉴权时,401 必须带的 `WWW-Authenticate` 头也是同样的道理。**接管错误处理时,先想想原来的响应里有没有该保留的头。**

### 改了格式,老测试全红

统一错误格式是一个**破坏性改动**:所有依赖老格式的调用方都会坏。最先发现的是我们自己的测试:

```bash
uv run pytest tests/test_tickets_api.py tests/test_ex79.py tests/test_create_ticket.py -q
```

实跑输出(只留了最后的汇总):

```text
FAILED tests/test_tickets_api.py::test_get_ticket_not_found - AssertionError:...
FAILED tests/test_tickets_api.py::test_ticket_id_must_be_int - KeyError: 'det...
FAILED tests/test_ex79.py::test_search_requires_q - KeyError: 'detail'
FAILED tests/test_ex79.py::test_limit_must_be_positive - KeyError: 'detail'
FAILED tests/test_create_ticket.py::test_create_missing_title - KeyError: 'de...
FAILED tests/test_create_ticket.py::test_create_rejects_status - KeyError: 'd...
6 failed, 5 passed in 1.58s
```

6 个红,都是在找 `detail` 键。这正说明测试在干它该干的活:接口的形状变了,它拦住了你。真实项目里这一步之前要先和前端约好,一起改。我们这里自己改测试:

- 三个文件里的 `resp.json()["detail"][0]` 全部换成 `resp.json()["error"]["details"][0]`;
- `tests/test_tickets_api.py` 里 `assert resp.json() == {"detail": "没有这张工单: 9999"}` 换成 `assert resp.json()["error"]["code"] == "ticket_not_found"`。

改完再跑,`11 passed`。注意 404 那条我改成了断言 `code` 而不是 `message`:`code` 是和前端约定的稳定值,`message` 是给人看的文案,以后可能改措辞。

## 第 3 步:依赖注入,把「找工单」抽出来

现在 `get_ticket` 和 `update_status` 里还各有一段一模一样的循环。Express 里你会怎么做?大概是写一个只挂在这两个路由上的中间件:

```js
function loadTicket(req, res, next) {
  const t = TICKETS.find((t) => t.id === Number(req.params.ticketId));
  if (!t) return res.status(404).json({ error: { code: "ticket_not_found" } });
  req.ticket = t;
  next();
}
app.get("/tickets/:ticketId", loadTicket, (req, res) => res.json(req.ticket));
```

<div class="line-notes">

- `req.ticket = t;` 找到的工单挂在 `req` 上,后面的处理函数从 `req.ticket` 取。问题是 `req.ticket` 是什么类型、有没有被设置,编辑器都不知道。
- `app.get("/tickets/:ticketId", loadTicket, (req, res) => res.json(req.ticket));` 在路由上串起来。

</div>

FastAPI 的做法叫**依赖注入**(dependency injection):你写一个普通函数负责「准备好某样东西」,然后在处理函数的参数上声明「我需要这个函数的结果」,FastAPI 会在调用处理函数之前先调用它,把结果**注入**到参数里。说白了就是「参数的值不是从请求里直接读的,是另一个函数算出来的」。

在异常处理器后面、路由前面加:

```python
# agent-zero-lab/part01/tickets_api.py(新增,放在路由前面)
def find_ticket(ticket_id: int) -> dict[str, Any]:
    for t in TICKETS:
        if t["id"] == ticket_id:
            return t
    raise ApiError(404, "ticket_not_found", f"没有这张工单: {ticket_id}")


TicketDep = Annotated[dict[str, Any], Depends(find_ticket)]
```

<div class="line-notes">

- `def find_ticket(ticket_id: int) -> dict[str, Any]:` 一个**依赖**,就是一个普通函数。有意思的是它的参数:`ticket_id: int`。FastAPI 对依赖函数的参数用的是**和处理函数完全一样的规则**,名字在路径模板里,就是路径参数,照样转 int、照样校验。
- `raise ApiError(404, "ticket_not_found", f"没有这张工单: {ticket_id}")` 依赖里抛异常,处理函数就不会被调用,异常照常交给第 1 步的处理器。
- `TicketDep = Annotated[dict[str, Any], Depends(find_ticket)]` Day 79 练习 3 见过 `Annotated[类型, 附加信息]`。这里附加的信息是 `Depends(find_ticket)`:「这个参数的值由 `find_ticket` 提供」。把它存成一个变量 `TicketDep`(这叫类型别名),哪个接口要用就写 `ticket: TicketDep`。注意 `Depends(find_ticket)` 里传的是**函数本身**,没有括号,不是调用它。

</div>

import 那一行加上 `Depends`:`from fastapi import Depends, FastAPI, HTTPException, Query, Request`。然后两个处理函数改成:

```python
# agent-zero-lab/part01/tickets_api.py(改过的 get_ticket 和 update_status)
@app.get("/tickets/{ticket_id}")
def get_ticket(ticket: TicketDep):
    return ticket


@app.patch("/tickets/{ticket_id}")
def update_status(ticket: TicketDep, body: StatusUpdate):
    ticket["status"] = body.status
    return ticket
```

<div class="line-notes">

- `def get_ticket(ticket: TicketDep):` FastAPI 看到这个参数,会先调用 `find_ticket(ticket_id=路径里的值)`,把返回的字典作为 `ticket` 传进来。函数体只剩一行。
- `def update_status(ticket: TicketDep, body: StatusUpdate):` 一个依赖,一个请求体,混着用。

</div>

跑一下:

```bash
curl -sS $B/tickets/1002 -w "  [%{http_code}]\n"
curl -sS $B/tickets/9999 -w "  [%{http_code}]\n"
curl -sS -X PATCH $B/tickets/1001 -H "Content-Type: application/json" -d '{"status":"closed"}' -w "  [%{http_code}]\n"
curl -sS -X PATCH $B/tickets/abc -H "Content-Type: application/json" -d '{"status":"done"}' -w "  [%{http_code}]\n"
```

实跑输出:

```text
{"id":1002,"title":"同一个月被扣了两次款","status":"open"}  [200]
{"error":{"code":"ticket_not_found","message":"没有这张工单: 9999","details":[]}}  [404]
{"id":1001,"title":"发票抬头开错了","status":"closed"}  [200]
{"error":{"code":"validation_error","message":"请求参数不合法","details":[{"loc":["path","ticket_id"],"msg":"Input should be a valid integer, unable to parse string as an integer","type":"int_parsing"},{"loc":["body","status"],"msg":"Input should be 'open' or 'closed'","type":"literal_error"}]}}  [422]
```

行为和以前一模一样,最后一条连依赖里的路径参数错误和请求体错误都合在一起报了。文档也没变,我用 TestClient 取 `/openapi.json` 里 `/tickets/{ticket_id}` 的参数,还是 `[{"name": "ticket_id", "in": "path", "required": true, "schema": {"type": "integer", "title": "Ticket Id"}}]`,FastAPI 会把依赖需要的参数也算进接口的参数列表里。

和 Express 的写法比,好处有两个。一是**类型清楚**:`ticket` 的类型写在参数上,编辑器知道它是 `dict[str, Any]`,不像 `req.ticket` 是个谁也说不准的东西。二是**可以替换**:测试时可以把 `find_ticket` 整个换成一个假函数(`app.dependency_overrides`,Day 74 假对象的思路),不用真的准备数据。后面接数据库时,「拿一个数据库连接」、「解析当前登录用户」也都会写成依赖,明天的 API key 校验就是第一个例子。

依赖还能有依赖(依赖函数的参数本身也可以是 `Depends(...)`),FastAPI 会一层层解析,同一个请求里同一个依赖只算一次。另外有一种用 `yield` 写的依赖,适合「先打开,用完再关」的资源,要等 Day 99 学了生成器再讲。

## 第 4 步:中间件,给每个响应盖一个编号

客服在工作台上点了个按钮,报错了,截图发给你:「服务器出错了,请稍后再试」。你去翻日志,当时同时有几百个请求,哪一条是他的?

常见做法是给每个请求生成一个**请求编号**(request ID),放在响应头里,前端出错时把它显示出来或者上报;服务端打日志时也带上它。拿着编号一搜,就是那一条。

这件事每个接口都要做,写在处理函数里显然不对。**中间件**(middleware)就是包在所有请求外面的一层:请求进来先经过它,它把请求交给后面(路由、处理函数),拿到响应后还能再改一改,然后才发出去。和 Express 的 `app.use((req, res, next) => ...)` 是一个概念。

先在文件开头加两个 import:`import time` 和 `import uuid`。然后在异常处理器和依赖之间加:

```python
# agent-zero-lab/part01/tickets_api.py(新增)
@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request_id = uuid.uuid4().hex[:8]
    request.state.request_id = request_id
    start = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Process-Time-Ms"] = f"{(time.perf_counter() - start) * 1000:.1f}"
    return response
```

<div class="line-notes">

- `@app.middleware("http")` 登记一个 HTTP 中间件。参数 `"http"` 目前是唯一支持的值。
- `async def add_request_id(request: Request, call_next):` **必须是 `async def`**。`call_next` 是 FastAPI 传进来的一个函数,代表「后面的所有东西」,相当于 Express 的 `next`,区别是它会**返回响应**。我没给 `call_next` 写类型标注,它的完整类型比较长,对理解没帮助。
- `request_id = uuid.uuid4().hex[:8]` `uuid4()` 生成一个随机的唯一编号(≈浏览器里的 `crypto.randomUUID()`),`.hex` 是去掉横线的 32 位十六进制字符串,`[:8]` 截前 8 位,演示时好读。生产环境一般用完整的。
- `request.state.request_id = request_id` `request.state` 是挂在这个请求上的一个「随便放东西」的地方,和 Express 里往 `req` 上挂属性类似。放在这里,后面的异常处理器也能读到(下面会用)。
- `start = time.perf_counter()` 记下开始时间。`perf_counter` 是专门用来计时的时钟(Day 67 计时用过)。
- `response = await call_next(request)` 把请求交给后面,**等**它处理完返回响应。忘了 `await` 会怎样,常见误区里有实测。
- `response.headers["X-Request-ID"] = request_id` 往响应上加头。`X-` 开头是自定义头的老习惯。
- `response.headers["X-Process-Time-Ms"] = f"{(time.perf_counter() - start) * 1000:.1f}"` 处理耗时,毫秒,保留一位小数。头的值必须是字符串。
- `return response` 把(加了头的)响应交出去。

</div>

保存,请求一个正常的和一个 404:

```bash
curl -sS -D - -o /dev/null $B/tickets/1002
curl -sS -D - -o /dev/null $B/tickets/9999
```

<div class="line-notes">

- `curl -sS -D - -o /dev/null $B/tickets/1002` `-D -` 把响应头打到屏幕(`-` 表示标准输出),`-o /dev/null` 把 body 扔掉,只看头。

</div>

实跑输出(每条只留了状态行和两个新头):

```text
HTTP/1.1 200 OK
x-request-id: 7fe09d2c
x-process-time-ms: 27.6
HTTP/1.1 404 Not Found
x-request-id: f80df829
x-process-time-ms: 5.6
```

每个响应都有编号了,每次请求都不一样。第一条 27.6 毫秒比后面的慢,是服务刚重启后的第一个请求,有些东西要首次加载,之后的请求一般是个位数毫秒。

### 把编号放进错误体,以及 500 的那个洞

光在头里还不够方便,前端出错时最好直接在 JSON 里就能拿到。改 `error_body`,让它从 `request.state` 里读编号:

```python
# agent-zero-lab/part01/tickets_api.py(改过的 error_body)
def error_body(request: Request, code: str, message: str, details: list[Any] | None = None) -> dict[str, Any]:
    request_id = getattr(request.state, "request_id", "-")
    return {"error": {"code": code, "message": message, "details": details or [], "request_id": request_id}}
```

<div class="line-notes">

- `def error_body(request: Request, code: str,` 多了第一个参数 `request`。四个处理器里调用它的地方都要改成 `error_body(request, ...)`,处理器本来就有 `request` 参数,传进来就行。
- `request_id = getattr(request.state, "request_id", "-")` `getattr(对象, 属性名, 默认值)`:有这个属性就取,没有就用 `"-"`。以防万一有请求没经过中间件。

</div>

然后请求那个会出 bug 的接口:

```bash
curl -sS -D - $B/debug/boom
```

实跑输出:

```text
HTTP/1.1 500 Internal Server Error
content-type: application/json
...
{"error":{"code":"internal_error","message":"服务器出错了,请稍后再试","details":[],"request_id":"0b764fb8"}}
```

body 里有 `request_id` 了,但我把完整的头翻了一遍:**500 的响应头里没有 `x-request-id`,也没有 `x-process-time-ms`**。404 和 422 都有,偏偏最需要编号的 500 没有。

原因在于这几层的嵌套顺序。我去看了 starlette 的源码(`starlette/applications.py` 里的 `build_middleware_stack`),它是这样一层层包起来的,最外面在最上:

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="请求穿过 FastAPI 各层的顺序,以及 500 为什么拿不到中间件加的头">
<rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="20" width="600" height="290" fill="var(--compute-wash)" stroke="var(--compute)" rx="6"/>
<text x="32" y="40" fill="var(--ink)">ServerErrorMiddleware:兜底,调 @exception_handler(Exception)</text>
<rect x="45" y="55" width="550" height="235" fill="var(--paper-raised)" stroke="var(--rule)" rx="6"/>
<text x="57" y="75" fill="var(--ink)">你的 @app.middleware("http"):add_request_id</text>
<rect x="70" y="90" width="500" height="180" fill="var(--compute-wash)" stroke="var(--compute)" rx="6"/>
<text x="82" y="110" fill="var(--ink)">ExceptionMiddleware:调 ApiError / 422 / HTTPException 的处理器</text>
<rect x="95" y="125" width="450" height="125" fill="var(--mem-wash)" stroke="var(--mem)" rx="6"/>
<text x="107" y="145" fill="var(--ink)">路由 → 依赖 find_ticket → 处理函数</text>
<text x="107" y="175" fill="var(--ink-soft)">raise ApiError(404) → 被内层接住,变成响应</text>
<text x="107" y="193" fill="var(--ink-soft)">  → 响应往外走,经过 add_request_id,加上头 ✓</text>
<text x="107" y="221" fill="var(--ink-soft)">1 / 0 → 内层不管,异常穿过 add_request_id</text>
<text x="107" y="239" fill="var(--ink-soft)">  → call_next 之后的代码没执行,最外层才造 500 ✗</text>
</g>
</svg>
<figcaption>琥珀色是 starlette 的两层异常处理,白色是你的中间件,蓝色是业务代码。已知的错误在你的中间件里面就变成了响应;未知的 bug 一路冲到最外层,你的中间件「拿到响应以后」那半段根本没机会执行。</figcaption>
</figure>

`ApiError`、422、404/405 的处理器挂在**内层**的 `ExceptionMiddleware` 上,异常在你的中间件里面就被转成了正常的响应,`call_next` 正常返回,加头的代码照常执行。`Exception` 的处理器挂在**最外层**的 `ServerErrorMiddleware` 上,bug 抛出的异常从处理函数一路往外冲,冲过你的中间件时,`await call_next(request)` 这一行直接抛异常,下面加头的两行没执行。

修法是让 500 处理器自己把头补上。好在编号在进中间件的第一步就存进了 `request.state`,处理器读得到:

```python
# agent-zero-lab/part01/tickets_api.py(改过的 handle_unexpected)
@app.exception_handler(Exception)
def handle_unexpected(request: Request, exc: Exception):
    body = error_body(request, "internal_error", "服务器出错了,请稍后再试")
    rid = body["error"]["request_id"]
    logger.error("未处理的异常 request_id=%s %s %s", rid, request.method, request.url.path, exc_info=exc)
    return JSONResponse(status_code=500, content=body, headers={"X-Request-ID": rid})
```

<div class="line-notes">

- `rid = body["error"]["request_id"]` 从刚拼好的错误体里取出编号,省得再写一遍 `getattr`。
- `logger.error("未处理的异常 request_id=%s %s %s", rid, request.method, request.url.path, exc_info=exc)` 日志里也带上编号,这样前端报来的号和日志能对上。
- `return JSONResponse(status_code=500, content=body, headers={"X-Request-ID": rid})` 自己把头加上。耗时头就不补了,意义不大。

</div>

再请求一次 `/debug/boom`:

```text
HTTP/1.1 500 Internal Server Error
x-request-id: 0b764fb8
{"error":{"code":"internal_error","message":"服务器出错了,请稍后再试","details":[],"request_id":"0b764fb8"}}
```

服务器窗口里:

```text
未处理的异常 request_id=0b764fb8 GET /debug/boom
Traceback (most recent call last):
  ...
ZeroDivisionError: division by zero
INFO:     127.0.0.1:57745 - "GET /debug/boom HTTP/1.1" 500 Internal Server Error
ERROR:    Exception in ASGI application
Traceback (most recent call last):
  ...
ZeroDivisionError: division by zero
```

前端看到的编号 `0b764fb8` 和日志第一行对上了。你会发现 traceback 打了两遍:第一遍是我们的 `logger.error`,第二遍是 uvicorn 打的。starlette 的 `ServerErrorMiddleware` 在调用完你的 500 处理器之后,**还会把异常再抛一次**,源码里的注释写的是「让服务器能记录这个错误,也让测试客户端可以选择在测试里抛出它」。所以 uvicorn 照样会记一份。嫌重复的话可以去掉我们那条的 `exc_info=exc`,只留一行带编号的摘要;我倾向于留着,因为换了别的服务器程序不一定会帮你记。这个「再抛一次」在练习 1 写测试时还会碰到。

## 完整文件

现在的 `part01/tickets_api.py`:

```python
# agent-zero-lab/part01/tickets_api.py
import logging
import time
import uuid
from typing import Annotated, Any, Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)

app = FastAPI(title="CloudLedger 工单服务")

TICKETS: list[dict[str, Any]] = [
    {"id": 1001, "title": "发票抬头开错了", "status": "open"},
    {"id": 1002, "title": "同一个月被扣了两次款", "status": "open"},
    {"id": 1003, "title": "想从基础版升级到专业版", "status": "closed"},
]


class TicketCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=100, description="一句话说清客户遇到的问题")
    priority: Literal["low", "normal", "high"] = "normal"

    @field_validator("title")
    @classmethod
    def strip_title(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("标题不能只有空格")
        return v


class StatusUpdate(BaseModel):
    status: Literal["open", "closed"]


# ---------- 统一错误格式 ----------
class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def error_body(request: Request, code: str, message: str, details: list[Any] | None = None) -> dict[str, Any]:
    request_id = getattr(request.state, "request_id", "-")
    return {"error": {"code": code, "message": message, "details": details or [], "request_id": request_id}}


@app.exception_handler(ApiError)
def handle_api_error(request: Request, exc: ApiError):
    return JSONResponse(status_code=exc.status, content=error_body(request, exc.code, exc.message))


@app.exception_handler(RequestValidationError)
def handle_validation_error(request: Request, exc: RequestValidationError):
    details = [{"loc": e["loc"], "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
    return JSONResponse(status_code=422, content=error_body(request, "validation_error", "请求参数不合法", details))


@app.exception_handler(StarletteHTTPException)
def handle_http_error(request: Request, exc: StarletteHTTPException):
    body = error_body(request, f"http_{exc.status_code}", str(exc.detail))
    return JSONResponse(status_code=exc.status_code, content=body, headers=exc.headers)


@app.exception_handler(Exception)
def handle_unexpected(request: Request, exc: Exception):
    body = error_body(request, "internal_error", "服务器出错了,请稍后再试")
    rid = body["error"]["request_id"]
    logger.error("未处理的异常 request_id=%s %s %s", rid, request.method, request.url.path, exc_info=exc)
    return JSONResponse(status_code=500, content=body, headers={"X-Request-ID": rid})


# ---------- 中间件 ----------
@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request_id = uuid.uuid4().hex[:8]
    request.state.request_id = request_id
    start = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Process-Time-Ms"] = f"{(time.perf_counter() - start) * 1000:.1f}"
    return response


# ---------- 依赖 ----------
def find_ticket(ticket_id: int) -> dict[str, Any]:
    for t in TICKETS:
        if t["id"] == ticket_id:
            return t
    raise ApiError(404, "ticket_not_found", f"没有这张工单: {ticket_id}")


TicketDep = Annotated[dict[str, Any], Depends(find_ticket)]


# ---------- 路由 ----------
@app.get("/")
def index():
    return {"service": "cloudledger-tickets", "routes": ["/tickets", "/tickets/stats", "/tickets/{ticket_id}"]}


@app.get("/tickets")
def list_tickets(status: Literal["open", "closed"] | None = None, limit: Annotated[int, Query(ge=1, le=50)] = 10):
    items = [t for t in TICKETS if status is None or t["status"] == status]
    return {"count": len(items[:limit]), "items": items[:limit]}


@app.post("/tickets", status_code=201)
def create_ticket(ticket: TicketCreate):
    """新建一张工单。id 和 status 由服务端决定,客户端不能传。"""
    new_id = max(t["id"] for t in TICKETS) + 1
    row = {"id": new_id, "title": ticket.title, "status": "open", "priority": ticket.priority}
    TICKETS.append(row)
    return row


@app.get("/tickets/stats")
def ticket_stats():
    open_count = sum(1 for t in TICKETS if t["status"] == "open")
    return {"total": len(TICKETS), "open": open_count}


@app.get("/tickets/search")
def search_tickets(q: str):
    hits = [t for t in TICKETS if q in t["title"]]
    return {"q": q, "count": len(hits), "items": hits}


@app.get("/tickets/{ticket_id}")
def get_ticket(ticket: TicketDep):
    return ticket


@app.patch("/tickets/{ticket_id}")
def update_status(ticket: TicketDep, body: StatusUpdate):
    ticket["status"] = body.status
    return ticket


@app.get("/debug/boom")
def boom():
    return {"ratio": 1 / 0}
```

<div class="line-notes">

- `from fastapi import Depends, FastAPI, HTTPException, Query, Request` `HTTPException` 现在其实没用到了(全换成了 `ApiError`),留着是因为以后偶尔还会直接用;编辑器可能把它标灰,不影响运行。
- `# ---------- 统一错误格式 ----------` 用注释把文件分成几块。一个文件快 150 行了,下一部分会学怎么拆成多个文件。
- `@app.get("/debug/boom")` 演示用的接口,真实项目里不要留。

</div>

basedpyright(standard 档)检查这个文件:`0 errors, 0 warnings, 0 notes`。改完测试以后 `uv run pytest tests/test_tickets_api.py tests/test_ex79.py tests/test_create_ticket.py -q` 是 `11 passed`。

## 零件和成品的对照

| 零件 | 在完整文件的哪一段 | 解决什么 |
| --- | --- | --- |
| `class ApiError(Exception)` | 统一错误格式 | 业务错误带 code |
| `error_body(...)` | 统一错误格式 | 错误的形状只定义一次 |
| `@app.exception_handler(ApiError)` | 统一错误格式 | 自己的错误 |
| `@app.exception_handler(RequestValidationError)` | 统一错误格式 | 422,并去掉 `input` |
| `@app.exception_handler(StarletteHTTPException)` | 统一错误格式 | 框架的 404/405,保留 `headers` |
| `@app.exception_handler(Exception)` | 统一错误格式 | bug 引起的 500,不漏细节,补编号 |
| `@app.middleware("http")` | 中间件 | 每个响应加编号和耗时 |
| `request.state.request_id` | 中间件 → `error_body` | 让内外层都拿到同一个编号 |
| `find_ticket` + `TicketDep` | 依赖 | 去掉重复的找工单代码 |

## 动手练习

**练习 1:给统一错误格式写测试。** 新建 `tests/test_errors.py`,测三件事:9999 是 404,`code` 是 `ticket_not_found`,并且 body 里的 `request_id` 和响应头 `X-Request-ID` 一致;`/nope` 的 `code` 是 `http_404`;`/debug/boom` 是 500,`code` 是 `internal_error`,body 里**不包含** `ZeroDivisionError` 字样。先按最直接的方式写,跑一次看看。

<details><summary>参考答案</summary>

最直接的写法,前两个测试没问题,第三个这样写:

```python
def test_500_is_unified():
    resp = client.get("/debug/boom")
    assert resp.status_code == 500
```

<div class="line-notes">

- `resp = client.get("/debug/boom")` 用和前两个测试同一个 `client`。

</div>

`uv run pytest tests/test_errors.py -q` 实跑,结果是 `1 failed, 2 passed`,失败原因不是断言没过,而是测试里直接抛出了异常:

```text
ZeroDivisionError: division by zero
=========================== short test summary info ============================
FAILED tests/test_errors.py::test_500_is_unified - ZeroDivisionError: divisio...
```

这就是第 4 步说的「再抛一次」:`TestClient` 默认 `raise_server_exceptions=True`,服务端有未处理的异常时,它会在测试里把异常原样抛出来,方便你看到真正的 bug。要测「500 的响应长什么样」,就得关掉它。完整文件:

```python
# agent-zero-lab/tests/test_errors.py
from fastapi.testclient import TestClient

from part01.tickets_api import app

client = TestClient(app)


def test_not_found_has_unified_shape():
    resp = client.get("/tickets/9999")
    assert resp.status_code == 404
    err = resp.json()["error"]
    assert err["code"] == "ticket_not_found"
    assert err["request_id"] == resp.headers["X-Request-ID"]


def test_unknown_path_is_unified_too():
    resp = client.get("/nope")
    assert resp.json()["error"]["code"] == "http_404"


def test_500_is_unified():
    quiet = TestClient(app, raise_server_exceptions=False)
    resp = quiet.get("/debug/boom")
    assert resp.status_code == 500
    assert resp.json()["error"]["code"] == "internal_error"
    assert "ZeroDivisionError" not in resp.text
```

<div class="line-notes">

- `assert err["request_id"] == resp.headers["X-Request-ID"]` 头和 body 里的编号必须是同一个。`resp.headers` 取头时不分大小写。
- `quiet = TestClient(app, raise_server_exceptions=False)` 单独建一个不抛异常的客户端,只给这个测试用。前两个测试用的 `client` 保持默认,其他测试里真出了 bug 还是能直接看到。
- `assert "ZeroDivisionError" not in resp.text` `resp.text` 是响应体的原文。确认内部异常名没有漏出去。

</div>

实跑 `uv run pytest tests/test_errors.py -q`:

```text
...                                                                      [100%]
3 passed in 0.91s
```

</details>

**练习 2:分页依赖。** `list_tickets` 有 `limit`,`search_tickets` 没有,而且两个都没有 `offset`(跳过前几条)。写一个 `pagination` 依赖,接收 `limit`(1 到 50,默认 10)和 `offset`(大于等于 0,默认 0),返回一个 `Page` 模型;两个接口都用它,返回值里加上 `total`(筛选后的总数)。验证 `/tickets?limit=2&offset=1`、`offset=-1`、`/tickets/search?q=了&limit=1&offset=1`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/tickets_api.py(新增,放在 TicketDep 下面)
class Page(BaseModel):
    limit: int
    offset: int


def pagination(
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page:
    return Page(limit=limit, offset=offset)


PageDep = Annotated[Page, Depends(pagination)]
```

<div class="line-notes">

- `class Page(BaseModel):` 用一个小模型装两个值,比返回元组清楚,`page.limit` 一看就懂。
- `def pagination(` 依赖函数的参数**不在路径模板里**,所以按规则是查询参数,`Query(ge=...)` 的约束照样生效。
- `PageDep = Annotated[Page, Depends(pagination)]` 和 `TicketDep` 一样的写法。

</div>

两个接口改成:

```python
# agent-zero-lab/part01/tickets_api.py(改过的 list_tickets 和 search_tickets)
@app.get("/tickets")
def list_tickets(page: PageDep, status: Literal["open", "closed"] | None = None):
    items = [t for t in TICKETS if status is None or t["status"] == status]
    picked = items[page.offset : page.offset + page.limit]
    return {"total": len(items), "count": len(picked), "items": picked}


@app.get("/tickets/search")
def search_tickets(q: str, page: PageDep):
    hits = [t for t in TICKETS if q in t["title"]]
    picked = hits[page.offset : page.offset + page.limit]
    return {"q": q, "total": len(hits), "count": len(picked), "items": picked}
```

<div class="line-notes">

- `def list_tickets(page: PageDep, status: Literal["open", "closed"] | None = None):` `page` 放在前面,因为 Python 规定没有默认值的参数要写在有默认值的前面,而 `PageDep` 这种参数没有默认值。
- `picked = items[page.offset : page.offset + page.limit]` 切片(Day 15),从 offset 开始取 limit 个。冒号两边的空格是格式化工具的习惯写法,不影响结果。

</div>

用 TestClient 验证,实跑输出:

```text
/tickets {'limit': 2, 'offset': 1} 200 {'total': 3, 'count': 2, 'items': [{'id': 1002, 'title': '同一个月被扣了两次款', 'status': 'open'}, {'id': 1003, 'title': '想从基础版升级到专业版', 'status': 'closed'}]}
/tickets {'offset': -1} 422 {'error': {'code': 'validation_error', 'message': '请求参数不合法', 'details': [{'loc': ['query', 'offset'], 'msg': 'Input should be greater than or equal to 0', 'type': 'greater_than_equal'}], 'request_id': 'c06b1648'}}
{'q': '了', 'limit': 1} 200 {'q': '了', 'total': 2, 'count': 1, 'items': [{'id': 1001, 'title': '发票抬头开错了', 'status': 'open'}]}
{'q': '了', 'limit': 1, 'offset': 1} 200 {'q': '了', 'total': 2, 'count': 1, 'items': [{'id': 1002, 'title': '同一个月被扣了两次款', 'status': 'open'}]}
```

`offset=-1` 的 `loc` 是 `["query", "offset"]`,依赖里的查询参数和处理函数里的没有区别。「了」字在 1001 和 1002 的标题里都有,`total` 是 2,翻到第二页拿到 1002。分页规则以后要改(比如上限从 50 改成 100),只改 `pagination` 一处。basedpyright 0 错误。

注意这个改动让 `list_tickets` 的返回值多了 `total`,Day 79 的 `test_filter_and_limit` 断言的是整个字典,会红,要把期望值里加上 `"total": 2`。做完这题,Day 82 不依赖它,保留不保留都行。

</details>

**练习 3(观察题):登记错了 HTTPException。** 把 `handle_http_error` 上的 `@app.exception_handler(StarletteHTTPException)` 改成 `@app.exception_handler(HTTPException)`(FastAPI 的那个),参数类型也改成 `HTTPException`。请求 `/nope` 和 `DELETE /tickets`,看看错误格式。看完改回来。

<details><summary>参考答案</summary>

实跑输出(用 TestClient):

```text
404 {'detail': 'Not Found'}
{'detail': 'Method Not Allowed'}
```

又变回老格式了。路径不存在、方法不对时,抛异常的是 starlette 的路由,它抛的是 starlette 的 `HTTPException`。FastAPI 的 `HTTPException` 是它的**子类**:异常处理器按「抛出的异常是不是登记的那个类(或它的子类)」来匹配,starlette 抛的父类对象不是子类的实例,所以接不住。反过来登记父类,父类和子类都能接住。

这类问题测试很容易漏,因为你写测试时多半只想到自己抛的 404。练习 1 里的 `test_unknown_path_is_unified_too` 就是专门钉住它的。

</details>

**练习 4:慢请求告警。** 在中间件里加一条规则:处理耗时超过 500 毫秒,就用 `logger.warning` 打一行「慢请求」日志,带上编号、方法、路径和耗时。加一个 `/debug/slow` 接口(`time.sleep(0.6)` 再返回)验证。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/tickets_api.py(改过的中间件部分,外加一个演示接口)
SLOW_MS = 500


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request_id = uuid.uuid4().hex[:8]
    request.state.request_id = request_id
    start = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    elapsed_ms = (time.perf_counter() - start) * 1000
    response.headers["X-Process-Time-Ms"] = f"{elapsed_ms:.1f}"
    if elapsed_ms > SLOW_MS:
        logger.warning("慢请求 request_id=%s %s %s %.0fms", request_id, request.method, request.url.path, elapsed_ms)
    return response


@app.get("/debug/slow")
def slow():
    time.sleep(0.6)
    return {"ok": True}
```

<div class="line-notes">

- `SLOW_MS = 500` 阈值放成模块级常量,不要把 500 写死在 if 里。
- `elapsed_ms = (time.perf_counter() - start) * 1000` 先算出来存个变量,头和日志都用它。
- `if elapsed_ms > SLOW_MS:` 只有慢的才打,正常请求不刷屏。
- `logger.warning("慢请求 request_id=%s %s %s %.0fms",` `%.0f` 是保留 0 位小数的浮点数。
- `time.sleep(0.6)` 让处理函数停 0.6 秒,模拟一个慢查询。这里用的是普通 `def`,FastAPI 会把它放到线程里跑,不会卡住别的请求;如果写成 `async def` 里调 `time.sleep`,就会卡住整个服务(Day 67 讲过 async 里不能用阻塞调用)。

</div>

实跑 `curl -sS -D - $B/debug/slow`:

```text
HTTP/1.1 200 OK
x-request-id: b6aa7113
x-process-time-ms: 606.5
{"ok":true}
```

服务器窗口:

```text
慢请求 request_id=b6aa7113 GET /debug/slow 607ms
INFO:     127.0.0.1:59601 - "GET /debug/slow HTTP/1.1" 200 OK
INFO:     127.0.0.1:59610 - "GET /tickets HTTP/1.1" 200 OK
```

`/tickets` 很快,没有告警。以后 Agent 服务里一次模型调用动辄几秒,这种按耗时告警的中间件很常用,阈值会设得更高。

</details>

**验收标准:** `/tickets/9999`、`/tickets/abc`、`/nope`、`DELETE /tickets/1001`、`/debug/boom` 五种错误都返回 `{"error": {"code", "message", "details", "request_id"}}`;405 的响应头里有 `allow`;所有响应(包括 500)都有 `X-Request-ID`,且和 body 里的编号一致;500 的 body 里没有异常名;`get_ticket` 和 `update_status` 都只剩一两行;`uv run pytest -q` 全绿;能不看文章画出「ServerErrorMiddleware → 你的中间件 → ExceptionMiddleware → 路由」这几层,并说出 500 为什么一开始没有编号头。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 统一错误格式 | 服务承诺所有错误响应都是同一个 JSON 形状,前端只写一套处理逻辑 |
| 错误码(code) | 给程序判断用的稳定短字符串,如 `ticket_not_found`,不随文案改动 |
| 异常处理器 | `@app.exception_handler(某异常类)` 登记的函数,该类异常抛出时由它生成响应 |
| `JSONResponse` | 手动构造的 JSON 响应,可以指定状态码和头 |
| `RequestValidationError` | FastAPI 参数校验失败时抛的异常,默认变成 422 |
| starlette 的 `HTTPException` | 路由层抛 404/405 用的异常;FastAPI 的 `HTTPException` 是它的子类 |
| `exc.headers` | HTTP 异常里附带的响应头,如 405 的 `Allow`,接管处理时要原样带上 |
| 破坏性改动 | 改了接口的输入或输出形状,老的调用方会坏 |
| 依赖注入 | 参数的值不是直接从请求读,而是由另一个函数(依赖)算好传进来;FastAPI 里写 `Depends(函数)` |
| 依赖(dependency) | 被 `Depends` 引用的普通函数,参数规则和处理函数一样 |
| 类型别名 | 把一个长类型存成变量,如 `TicketDep = Annotated[..., Depends(...)]` |
| 中间件(middleware) | 包在所有请求外面的一层,请求进来先经过它,响应出去也经过它;≈Express 的 `app.use` |
| `call_next` | 中间件里代表「后面所有处理」的函数,`await` 它得到响应 |
| 请求编号(request ID) | 每个请求一个唯一编号,放响应头和日志里,用来对上「哪一条请求出了问题」 |
| `request.state` | 挂在单个请求上的存储,中间件放进去的东西后面的处理器能读到 |
| `ServerErrorMiddleware` | starlette 最外层的兜底,调用 `Exception` 的处理器,之后会把异常再抛一次 |
| `raise_server_exceptions` | `TestClient` 的参数,默认 True,服务端未处理的异常会在测试里抛出 |

## 常见误区

**500 直接回 traceback 或异常信息。** 这等于把代码路径、依赖版本、甚至数据片段告诉了所有人。给前端一句通用说明加请求编号,细节只进日志。

**接管 HTTPException 时丢了响应头。** 实测我第一版的 405 没有 `allow` 头。处理器里写 `headers=exc.headers`。明天 401 的 `WWW-Authenticate` 也靠它。

**登记成 FastAPI 的 `HTTPException`。** 只能接住你自己抛的,路由层抛的 404/405 还是老格式。登记 starlette 的那个父类。

**中间件忘了 `await call_next(request)`。** 实测报的是 `AttributeError: 'coroutine' object has no attribute 'headers'`,外加一条 `RuntimeWarning: coroutine ... was never awaited`。不加 await,拿到的是一个还没开始执行的协程对象,不是响应(Day 67)。

**中间件写成普通 `def`。** `@app.middleware("http")` 要求 `async def`。写成 `def` 时 `call_next(...)` 同样只返回协程,我实测得到的是和上一条一样的 `AttributeError`。

**在普通 `def` 的异常处理器里用 `logger.exception`。** 我第一版这么写,日志里 traceback 的位置只打出来一行 `NoneType: None`。原因是普通函数的处理器会被放到另一个线程里执行,`logger.exception` 靠「当前正在处理的异常」找 traceback,换了线程就找不到了。改成 `logger.error(..., exc_info=exc)`,把异常对象明确传进去。

**以为中间件能接住所有情况。** 未处理的异常会直接穿过你的中间件,`call_next` 后面的代码不执行。要给 500 加的东西,在 `Exception` 处理器里加。

**改错误格式不通知调用方。** 今天改完老测试红了 6 个,这就是前端会遇到的事。错误格式是接口的一部分,改它和改字段名一样要提前约好。

**`Depends(find_ticket())` 多写了括号。** 那是把函数**调用的结果**传给了 Depends,模块一导入就报错,实测是 `TypeError: find_ticket() missing 1 required positional argument: 'ticket_id'`。传函数本身:`Depends(find_ticket)`。

## 学习资料

### 文档与文章

- [FastAPI 中文文档 · 处理错误](https://fastapi.tiangolo.com/zh/tutorial/handling-errors/):`HTTPException`、自定义异常处理器、覆盖 `RequestValidationError`,还专门解释了为什么要登记 starlette 的 `HTTPException`。
- [FastAPI 中文文档 · 依赖项](https://fastapi.tiangolo.com/zh/tutorial/dependencies/):依赖注入的官方入门,用的就是分页参数的例子,和练习 2 对应。
- [FastAPI 中文文档 · 路径操作装饰器依赖项](https://fastapi.tiangolo.com/zh/tutorial/dependencies/dependencies-in-path-operation-decorators/):不需要返回值的依赖写在装饰器上,明天的 API key 校验会用。
- [FastAPI 中文文档 · 中间件](https://fastapi.tiangolo.com/zh/tutorial/middleware/):官方的例子就是加 `X-Process-Time` 头,和第 4 步几乎一样。
- [FastAPI 中文文档 · 测试依赖项](https://fastapi.tiangolo.com/zh/advanced/testing-dependencies/):`app.dependency_overrides` 怎么在测试里换掉一个依赖。
- [Starlette 文档 · Exceptions(英文)](https://www.starlette.dev/exceptions/):`ServerErrorMiddleware` 和 `ExceptionMiddleware` 的分工,解释了第 4 步那张图。
- [Starlette 文档 · Middleware(英文)](https://www.starlette.dev/middleware/):中间件的完整说明,包括比 `@app.middleware` 更底层的写法。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1zV2QBtE39&autoplay=0&high_quality=1" title="黑马程序员PythonWeb开发:FastAPI从入门到实战视频教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>黑马程序员 · FastAPI 从入门到实战视频教程 · 今天看第 14 P「异常响应处理」(7 分钟)、第 15 P「中间件」(13 分钟)、第 16 P「依赖注入」(13 分钟),正好是今天的三块。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1oZ4y1J7MJ&autoplay=0&high_quality=1" title="FastAPI教程 - 11.依赖注入" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>跟峰哥学编程 · FastAPI教程 - 11.依赖注入 · 33 分钟。比黑马那一 P 讲得细,有依赖套依赖和类作为依赖。同一个系列的第 10 集「状态码与异常处理」(BV1zk4y1D7NM)可以配着看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1epiCYCEzH&autoplay=0&high_quality=1" title="18. FastAPI 中间件:实现获取请求处理时间,增加模拟日志,访问速率限制,跨域资源共享" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>玩代码的预测师 · 18. FastAPI 中间件 · 15 分钟。Day 79 推荐过这位 UP 的路径参数那集。这集用中间件做了计时、日志、限流和跨域,前半段对应第 4 步,后面的限流和 CORS 先有个印象。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/WRjXIA5pMtk" title="Python FastAPI Tutorial (Part 3): Path Parameters - Validation and Error Handling" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python FastAPI Tutorial (Part 3): Path Parameters - Validation and Error Handling · 英文。后半集讲 HTTPException 和自定义异常处理器,还演示了 API 和网页两种请求返回不同格式的错误,比今天多走了一步。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Xhzn1eAxoXk" title="Stop Hardcoding Everything: Use Dependency Injection" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>ArjanCodes · Stop Hardcoding Everything: Use Dependency Injection · 英文。不讲 FastAPI,讲依赖注入这个思路本身在 Python 里为什么好用,帮你理解 `Depends` 背后的想法。</figcaption>
</figure>

### 书籍

- Bill Lubanovic,《FastAPI: Modern Python Web Development》,O'Reilly,2023(英文)。书里有专门一章讲 FastAPI 的依赖(Dependencies),从「为什么不在函数里自己去拿」讲起。
- Arnaud Lauret,《The Design of Web APIs》第二版,Manning,2025(英文)。昨天推荐过,里面讲错误设计的部分(错误码要稳定、给调用方可操作的信息)正好是今天统一格式背后的道理。

### 开源项目与代码

- [fastapi/fastapi 的 fastapi/exception_handlers.py](https://github.com/fastapi/fastapi/blob/master/fastapi/exception_handlers.py):FastAPI 默认的三个异常处理器,一共二三十行。看完你就知道 `{"detail": ...}` 是在哪里拼出来的,也能看到默认处理器是怎么带上 `exc.headers` 的。
- [Kludex/starlette 的 starlette/middleware/errors.py](https://github.com/Kludex/starlette/blob/main/starlette/middleware/errors.py):`ServerErrorMiddleware`,搜 `We always continue to raise the exception` 就是第 4 步说的「再抛一次」。
- [fastapi/full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template):`backend/app/api/deps.py` 里放的全是依赖(数据库会话、当前用户),是依赖注入在真实项目里的样子。

## 自测

1. 列出今天四个异常处理器分别处理哪类错误,以及哪一个挂在最外层。

<details><summary>答案</summary>

`ApiError` 处理我们自己抛的业务错误;`RequestValidationError` 处理参数校验失败的 422;starlette 的 `HTTPException` 处理路由层的 404/405(以及 FastAPI 的 `HTTPException`);`Exception` 处理所有没被接住的 bug,变成 500。`Exception` 那个挂在最外层的 `ServerErrorMiddleware` 上,其余三个在内层的 `ExceptionMiddleware` 上。

</details>

2. 为什么 422 的统一格式里我们去掉了 `input`,500 里不放异常信息?

<details><summary>答案</summary>

`input` 是用户提交的原值,可能很长,也可能是密码之类的敏感内容,原样回显没有必要。500 的异常信息和 traceback 会暴露代码路径、内部结构甚至数据片段;前端拿到也做不了什么,给一句通用说明加请求编号就够了,细节去日志里查。

</details>

3. `def find_ticket(ticket_id: int)` 作为依赖时,`ticket_id` 的值是从哪来的?传 `abc` 会怎样?

<details><summary>答案</summary>

依赖函数的参数和处理函数用同一套规则:`ticket_id` 出现在路径模板 `/tickets/{ticket_id}` 里,所以取的是路径里那一段,并按 `int` 转换校验。传 `abc` 转换失败,422,`loc` 是 `["path", "ticket_id"]`,`find_ticket` 和处理函数都不会被调用。

</details>

4. 中间件里在 `await call_next(request)` 之后加的响应头,为什么 404 有、500 一开始没有?你是怎么修的?

<details><summary>答案</summary>

404 是 `ApiError` 或路由层的 `HTTPException`,在内层的 `ExceptionMiddleware` 里就被转成了正常响应,`call_next` 正常返回,后面加头的代码会执行。500 是没被接住的异常,它穿过我们的中间件冲到最外层,`await call_next(...)` 这一行直接抛异常,加头的代码没执行。修法是中间件一开始就把编号存进 `request.state`,`Exception` 处理器读出来,自己在 `JSONResponse` 里加上 `X-Request-ID`。

</details>

5. 面试题:你负责一个给 Agent 调用的工具服务,模型调用失败时会把错误响应原样读回去再决定下一步。你会怎么设计错误响应?和给人看的前端相比有什么不同?

<details><summary>答案</summary>

格式统一、可预测:一个稳定的 `code` 让调用方(包括 Agent 框架里的重试逻辑)能区分「参数错了可以改了重试」「资源不存在别再试」「服务端故障稍后重试」;`message` 用模型能读懂的一句话说清哪里错了、怎么改,比如「limit 必须在 1 到 50 之间」;422 的 `details` 保留字段位置,模型能据此修正参数。和给人看的相比,要更具体、更面向「下一步该怎么做」,但同样不能泄露内部细节,因为模型读到的内容可能被记录、转述,甚至被提示注入利用。每个错误带请求编号,方便把 Agent 的轨迹和服务端日志对上。状态码也要准确:4xx 和 5xx 决定了框架要不要自动重试。

</details>

## 明天预告

Day 82 · 鉴权(一):API key 和 session/cookie,这回从服务端看。现在任何人都能往你的服务里 POST 工单、改状态。Day 63 你作为调用方带过 API key 去请求 DeepSeek,明天换到服务端:写一个依赖检查 `X-API-Key` 头,没带或者带错回 401(今天保留下来的 `headers` 正好用上);再写一个登录接口,用 session 和 cookie 记住「这个浏览器是谁」,从服务端看清楚 cookie 是怎么设置、怎么带回来、怎么作废的。
