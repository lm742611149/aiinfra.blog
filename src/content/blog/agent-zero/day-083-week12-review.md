---
title: 'Day 83 · 第 12 周复习:编程地基(Day 77–82)'
description: '这一周从「npm run dev 起了个端口」一路走到给接口加门禁。今天把一次请求在服务端经过的每一站画成一张图,每天一句话回顾,然后合上文章,从零写一个带校验、统一错误、请求编号和 API key 的退款申请服务,连测试一起跑通。'
pubDate: 2026-10-23
regime: none
tags: ['review', 'fastapi', 'backend', 'python', 'agent-zero']
series: 'agent-zero'
day: 83
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 82](/blog/agent-zero/day-082-auth-1/) 给工单服务加了门禁:`require_api_key` 依赖从 `X-API-Key` 头里取 key,用 `secrets.compare_digest` 比对,没带、带错回 401 并带上 `WWW-Authenticate`,服务端自己没配 key 时回 500 拒绝一切(fail closed)。后半天写了一个 session 登录演示,`/login` 下发 HttpOnly cookie,`/logout` 删掉服务端那条记录,旧 cookie 立刻失效。

这是第 12 周的最后一天。这一周你第一次站到了服务端:先搞清楚「服务」到底是个什么东西(进程和端口),再用标准库手写一个,然后换成 FastAPI,一天加一层。今天不学新东西,把这六天串成一条线,再从空文件开始写一个完整的小服务,检验自己是真会了还是只是看懂了。

## 今天要解决的问题

1. 对着一张图说出一次请求从 curl 发出到收到响应,在服务端依次经过了哪几站,每一站是哪一天学的、出了问题会看到什么。
2. 合上文章默写并跑通两段核心代码:Day 82 的 `require_api_key` 加它的测试,Day 78 的 `route` 和 `reply`。
3. 完成本周小项目 `part01/refunds_api.py`:一个退款申请服务,有请求体校验、统一错误格式、请求编号、API key,配一套 TestClient 测试,并在练习里给它加一个审批接口。

预计用时 3.5 小时。花费 ¥0,不调模型,不联网。

前置:本周的 [Day 77](/blog/agent-zero/day-077-server-1/) 到 [Day 82](/blog/agent-zero/day-082-auth-1/)。仓库里应该已经有 Day 79 装好的 `fastapi`、`uvicorn` 和开发依赖 `httpx2`,`pyproject.toml` 里有 Day 72 写的 `[tool.pytest]`(`pythonpath = ["."]`、`testpaths = ["tests"]`)。先在 `~/agent-zero-lab` 里跑一次 `uv run pytest -q`,确认是全绿的再开始。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。复习日的默写最要紧:练习 1 和练习 2 请真的把文章关掉写,写完再展开答案对。

## 本周知识地图

前端视角下,一次请求的故事到 DevTools 的 Network 面板就结束了:一行请求,一个状态码,一段 JSON。这一周补的是面板「背后」那一半。下面这张图把它摊开,每个格子标了是哪一天学的。

<figure>
<svg viewBox="0 0 640 360" role="img" aria-label="第 12 周知识地图:一次请求从 curl 出发,经过端口、uvicorn 进程、中间件、路由、依赖、请求体校验、处理函数,出错时走异常处理器,最后回到客户端">
<rect x="0" y="0" width="640" height="360" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="20" width="120" height="50" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="76" y="41" fill="var(--ink)" text-anchor="middle">curl / 浏览器</text>
<text x="76" y="59" fill="var(--ink-soft)" text-anchor="middle" font-size="11">发请求</text>
<rect x="166" y="20" width="140" height="50" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="236" y="41" fill="var(--ink)" text-anchor="middle">127.0.0.1:8000</text>
<text x="236" y="59" fill="var(--ink-soft)" text-anchor="middle" font-size="11">Day 77 端口 lsof</text>
<rect x="336" y="20" width="130" height="50" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="401" y="41" fill="var(--ink)" text-anchor="middle">uvicorn 进程</text>
<text x="401" y="59" fill="var(--ink-soft)" text-anchor="middle" font-size="11">Day 77/79 PID</text>
<rect x="496" y="20" width="128" height="50" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="560" y="41" fill="var(--ink)" text-anchor="middle">中间件</text>
<text x="560" y="59" fill="var(--ink-soft)" text-anchor="middle" font-size="11">Day 81 请求编号</text>
<line x1="136" y1="45" x2="166" y2="45" stroke="var(--rule)" stroke-width="2"/>
<line x1="306" y1="45" x2="336" y2="45" stroke="var(--rule)" stroke-width="2"/>
<line x1="466" y1="45" x2="496" y2="45" stroke="var(--rule)" stroke-width="2"/>
<line x1="560" y1="70" x2="560" y2="110" stroke="var(--rule)" stroke-width="2"/>
<rect x="496" y="110" width="128" height="50" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="560" y="131" fill="var(--ink)" text-anchor="middle">路由匹配</text>
<text x="560" y="149" fill="var(--ink-soft)" text-anchor="middle" font-size="11">Day 78/79</text>
<rect x="336" y="110" width="130" height="50" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="401" y="131" fill="var(--ink)" text-anchor="middle">鉴权依赖</text>
<text x="401" y="149" fill="var(--ink-soft)" text-anchor="middle" font-size="11">Day 82 API key</text>
<rect x="166" y="110" width="140" height="50" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="236" y="131" fill="var(--ink)" text-anchor="middle">参数和请求体</text>
<text x="236" y="149" fill="var(--ink-soft)" text-anchor="middle" font-size="11">Day 79/80 → 422</text>
<rect x="16" y="110" width="120" height="50" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="76" y="131" fill="var(--ink)" text-anchor="middle">资源依赖</text>
<text x="76" y="149" fill="var(--ink-soft)" text-anchor="middle" font-size="11">Day 81 → 404</text>
<line x1="496" y1="135" x2="466" y2="135" stroke="var(--rule)" stroke-width="2"/>
<line x1="336" y1="135" x2="306" y2="135" stroke="var(--rule)" stroke-width="2"/>
<line x1="166" y1="135" x2="136" y2="135" stroke="var(--rule)" stroke-width="2"/>
<line x1="76" y1="160" x2="76" y2="200" stroke="var(--rule)" stroke-width="2"/>
<rect x="16" y="200" width="200" height="50" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="116" y="221" fill="var(--ink)" text-anchor="middle">处理函数</text>
<text x="116" y="239" fill="var(--ink-soft)" text-anchor="middle" font-size="11">Day 78 算出状态码和数据</text>
<rect x="290" y="200" width="334" height="50" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="457" y="221" fill="var(--ink)" text-anchor="middle">异常处理器 → 统一错误 JSON</text>
<text x="457" y="239" fill="var(--ink-soft)" text-anchor="middle" font-size="11">Day 81:任何一站 raise 都落到这里</text>
<line x1="216" y1="225" x2="290" y2="225" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="222" y="216" fill="var(--ink-faint)" font-size="11">raise</text>
<rect x="16" y="290" width="608" height="50" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="320" y="311" fill="var(--ink)" text-anchor="middle">响应:状态行 + 头(X-Request-ID、WWW-Authenticate)+ 空行 + JSON 体</text>
<text x="320" y="329" fill="var(--ink-soft)" text-anchor="middle" font-size="11">Day 78 reply 手写过一遍,FastAPI 里由 JSONResponse 拼好,原路回到 curl</text>
<line x1="116" y1="250" x2="116" y2="290" stroke="var(--rule)" stroke-width="2"/>
<line x1="457" y1="250" x2="457" y2="290" stroke="var(--rule)" stroke-width="2"/>
</g>
</svg>
<figcaption>琥珀色是请求进门后依次经过的关卡,蓝色是真正干活和兜底的两个地方。注意鉴权依赖排在请求体校验和资源依赖前面:没认证的人看不到 422 的字段规则,也看不到 404 和 200 的区别。</figcaption>
</figure>

这张图里有两条线值得再说一遍。

第一条是**顺序**。Day 82 实测过:装饰器上的 `dependencies=[Depends(require_api_key)]` 先跑,一抛 401,后面的请求体校验和 `find_ticket` 都不会执行。参数里的依赖则按从左到右的顺序跑,所以练习 3 里把 `client: ClientDep` 放在 `ticket: TicketDep` 后面时,没带 key 的人反而收到了 404。图上从右到左的那一排,就是你写接口时要守住的先后顺序。

第二条是**任何一站出错都落到同一个地方**。端口被占是进程起不来,那是启动阶段的事;进程起来以后,不管是路由找不到(404/405)、参数不对(422)、key 不对(401)、业务上找不到(404),还是代码里除了个零(500),最后都由 Day 81 的四个异常处理器变成同一种形状:

```json
{"error": {"code": "...", "message": "...", "details": [...], "request_id": "..."}}
```

前端只需要写一套解析逻辑,后端排查问题只需要拿 `request_id` 去日志里搜。

下面这张表把这一周手写过的东西和 FastAPI 里对应的写法放在一起。Day 78 用 `http.server` 自己写的每一样,FastAPI 都替你做了,但做的事情没变:

| 要做的事 | Day 78 手写 `mini_server.py` | Day 79–82 FastAPI `tickets_api.py` |
| --- | --- | --- |
| 监听端口 | `HTTPServer(("127.0.0.1", 8000), Handler)` | `uv run uvicorn part01.tickets_api:app --port 8000` |
| 路由 | `ROUTES` 字典 + `route()` 里的 if | `@app.get("/tickets/{ticket_id}")` |
| 路径参数 | `removeprefix` 截出来,`isdigit()` 自己检查 | `ticket_id: int`,不是数字自动 422 |
| 查询参数 | `parse_qs(...)`,拿到的全是字符串列表 | 函数参数 `status: Literal[...] \| None = None` |
| 请求体 | 没做 | pydantic 模型 `TicketCreate` |
| 拼响应 | `reply()`:状态行、头、空行、bytes 体 | 返回 dict,FastAPI 转 JSON |
| 错误 | 处理函数返回 `(404, {...})`,格式自己约定 | `raise ApiError(...)` + 异常处理器 |
| 每个请求都要做的事 | 没做 | `@app.middleware("http")` |
| 鉴权 | 没做 | `Depends(require_api_key)` |

## 本周每天一句话

- [Day 77](/blog/agent-zero/day-077-server-1/) 进程、端口和 localhost:一个服务就是一个一直不退出的进程,它占着一个端口等请求;`lsof -nP -iTCP:8000 -sTCP:LISTEN` 查谁占着,开发时绑 127.0.0.1。
- [Day 78](/blog/agent-zero/day-078-server-2/) 一次请求在服务端走过的路:用 `BaseHTTPRequestHandler` 手写路由表和处理函数,先算完 `(状态码, 数据)` 再一口气发;`wfile` 只收 bytes,`Content-Length` 按字节算。
- [Day 79](/blog/agent-zero/day-079-fastapi-1/) FastAPI 的路由、路径参数和查询参数:类型标注就是校验规则,`/tickets/abc` 得到 422;固定路径要写在 `{ticket_id}` 前面。
- [Day 80](/blog/agent-zero/day-080-fastapi-2/) 请求体和自动文档:pydantic 模型接 JSON,`Field` 限长度,`extra="forbid"` 不许多传;发 JSON 一定带 `Content-Type: application/json`;`/docs` 从类型标注自动生成。
- [Day 81](/blog/agent-zero/day-081-fastapi-3/) 错误处理、依赖注入和中间件:四个异常处理器统一错误格式,`Depends(find_ticket)` 去掉重复代码,中间件给每个响应盖 `X-Request-ID`。
- [Day 82](/blog/agent-zero/day-082-auth-1/) API key 和 session/cookie:服务端没配 key 要拒绝一切,比较用 `compare_digest`,key 放头里不放 URL;session 的 cookie 里只有随机编号,作废靠删服务端记录。

## 本周小项目:退款申请服务

Agent 课的主角之一是退款:客户在工单里说「同一个月被扣了两次款」,Agent 查完账单,要替客户**提一个退款申请**,再由人审批。今天先把「退款申请」这个服务本身写出来,它只用本周学过的东西。需求是这样的:

- `GET /refunds`:列出申请,可以用 `?status=pending` 筛选,`limit` 在 1 到 50 之间,默认 10。
- `GET /refunds/{refund_id}`:查一条,不存在回 404。
- `POST /refunds`:新建一条,**必须带 API key**。请求体三个字段:`ticket_id`(整数,工单号从 1000 开始)、`amount_cents`(退款金额,单位是分,大于 0,不超过 500000 也就是 5000 元)、`reason`(2 到 200 个字)。`id` 和 `status` 由服务端决定,客户端多传字段要报错。新建的申请状态一律是 `pending`(待审批)。
- 所有错误都是 Day 81 那种统一格式,所有响应都带 `X-Request-ID`。
- key 从环境变量 `REFUNDS_API_KEY` 读,没配就拒绝一切写操作。

金额为什么用「分」存整数而不是 `99.0` 这样的小数,Day 12 你见过 `0.1 + 0.2` 不等于 `0.3`;钱的计算一律用整数的分,显示的时候再除以 100。这是计费系统的老规矩,后面的 BillSleuth 作品也会遵守。

**先别往下看。** 新建一个空文件 `part01/refunds_api.py`,对着上面的需求自己写,能写多少写多少,卡住的地方再看下面的参考写法。写完和参考对一遍,重点看你漏了哪几样。我自己重写这类服务时最常漏的是两样:`handle_http_error` 里的 `headers=exc.headers`,和中间件里的 `await`。

### 完整代码

```python
# agent-zero-lab/part01/refunds_api.py
import logging
import os
import secrets
import time
import uuid
from typing import Annotated, Any, Literal

from fastapi import Depends, FastAPI, Header, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)

app = FastAPI(title="CloudLedger 退款申请服务")

REFUNDS: list[dict[str, Any]] = [
    {"id": 1, "ticket_id": 1002, "amount_cents": 9900, "reason": "同一个月被扣了两次款", "status": "pending"},
    {"id": 2, "ticket_id": 1003, "amount_cents": 4900, "reason": "升级后旧套餐没退差价", "status": "approved"},
]


class RefundCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ticket_id: int = Field(ge=1000)
    amount_cents: int = Field(gt=0, le=500000, description="退款金额,单位:分")
    reason: str = Field(min_length=2, max_length=200)


# ---------- 统一错误格式 ----------
class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, headers: dict[str, str] | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.headers = headers


def error_body(request: Request, code: str, message: str, details: list[Any] | None = None) -> dict[str, Any]:
    request_id = getattr(request.state, "request_id", "-")
    return {"error": {"code": code, "message": message, "details": details or [], "request_id": request_id}}


@app.exception_handler(ApiError)
def handle_api_error(request: Request, exc: ApiError):
    return JSONResponse(status_code=exc.status, content=error_body(request, exc.code, exc.message), headers=exc.headers)


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
def require_api_key(x_api_key: Annotated[str | None, Header()] = None) -> None:
    expected = os.environ.get("REFUNDS_API_KEY", "")
    if not expected:
        raise ApiError(500, "server_misconfigured", "服务端没有配置 API key")
    if x_api_key is None:
        raise ApiError(401, "missing_api_key", "缺少 X-API-Key 请求头", {"WWW-Authenticate": "ApiKey"})
    if not secrets.compare_digest(x_api_key.encode(), expected.encode()):
        raise ApiError(401, "invalid_api_key", "API key 不对", {"WWW-Authenticate": "ApiKey"})


def find_refund(refund_id: int) -> dict[str, Any]:
    for r in REFUNDS:
        if r["id"] == refund_id:
            return r
    raise ApiError(404, "refund_not_found", f"没有这个退款申请: {refund_id}")


RefundDep = Annotated[dict[str, Any], Depends(find_refund)]


# ---------- 路由 ----------
@app.get("/refunds")
def list_refunds(
    status: Literal["pending", "approved", "rejected"] | None = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
):
    items = [r for r in REFUNDS if status is None or r["status"] == status]
    return {"count": len(items[:limit]), "items": items[:limit]}


@app.post("/refunds", status_code=201, dependencies=[Depends(require_api_key)])
def create_refund(body: RefundCreate):
    new_id = max(r["id"] for r in REFUNDS) + 1
    row = {
        "id": new_id,
        "ticket_id": body.ticket_id,
        "amount_cents": body.amount_cents,
        "reason": body.reason,
        "status": "pending",
    }
    REFUNDS.append(row)
    return row


@app.get("/refunds/{refund_id}")
def get_refund(refund: RefundDep):
    return refund
```

<div class="line-notes">

- `from fastapi import Depends, FastAPI, Header, Query, Request` 本周用到的 FastAPI 零件都在这一行:`Depends`(Day 81)、`Header`(Day 82)、`Query`(Day 79)、`Request`(Day 81)。和 `tickets_api.py` 比少了 `HTTPException`,这个服务里所有错误都用自己的 `ApiError`。
- `from starlette.exceptions import HTTPException as StarletteHTTPException` 登记 starlette 的这个父类,路由层自己抛的 404/405 才接得住(Day 81 的坑:登记成 FastAPI 的那个只能接住你自己抛的)。`as` 是起别名,免得和 FastAPI 的同名类混在一起。
- `REFUNDS: list[dict[str, Any]] = [` 两条假数据放在内存里,一条待审批、一条已通过,方便测筛选。和 `TICKETS` 一样,重启就回到这两条;存进数据库要等 Day 85 开始的 SQL。
- `{"id": 1, "ticket_id": 1002, "amount_cents": 9900,` 9900 分就是 99 元,对应工单服务里 1002 号「同一个月被扣了两次款」。
- `model_config = ConfigDict(extra="forbid")` 客户端传 `"status": "approved"` 想自己把申请批了,会得到 422 `extra_forbidden`,下面实测。
- `ticket_id: int = Field(ge=1000)` `ge` 是 greater than or equal,大于等于。工单号从 1001 开始,1000 以下肯定是填错了。
- `amount_cents: int = Field(gt=0, le=500000, description="退款金额,单位:分")` `gt` 是严格大于,所以 0 不行;`le` 是小于等于。`description` 会出现在 `/docs` 里(Day 80)。
- `reason: str = Field(min_length=2, max_length=200)` 原因至少两个字,一个「退」字说明不了问题。
- `def __init__(self, status: int, code: str, message: str, headers: dict[str, str] | None = None):` Day 82 改过的版本,能带响应头,401 要靠它带 `WWW-Authenticate`。
- `request_id = getattr(request.state, "request_id", "-")` 中间件存进 `request.state` 的编号。`getattr` 的第三个参数是「取不到时用什么」,中间件没跑到的极端情况下是 `-`,不会再抛一个异常。
- `return JSONResponse(status_code=exc.status, content=error_body(request, exc.code, exc.message), headers=exc.headers)` 自己的业务错误。`headers=None` 等于不加头。
- `details = [{"loc": e["loc"], "msg": e["msg"], "type": e["type"]} for e in exc.errors()]` 只挑三个字段,故意去掉 pydantic 默认带的 `input`:客户端发来的原值没必要原样回显,里面可能有不该进日志的东西。
- `return JSONResponse(status_code=exc.status_code, content=body, headers=exc.headers)` **`headers=exc.headers` 别丢**。405 的 `allow` 头靠它保留。
- `@app.exception_handler(Exception)` 兜底:代码 bug 引起的 500。给前端一句通用的话加请求编号,真正的 traceback 只进服务端日志。
- `logger.error("未处理的异常 request_id=%s %s %s", rid, request.method, request.url.path, exc_info=exc)` 用 `logger.error(..., exc_info=exc)` 而不是 `logger.exception`,Day 81 实测过普通 `def` 处理器里 `logger.exception` 拿不到 traceback。
- `return JSONResponse(status_code=500, content=body, headers={"X-Request-ID": rid})` 未处理的异常会直接穿过中间件,中间件那句加头不会执行,所以这里自己补上。
- `async def add_request_id(request: Request, call_next):` 中间件必须是 `async def`。
- `request_id = uuid.uuid4().hex[:8]` 随机编号取前 8 位,够在日志里搜了。
- `response = await call_next(request)` 放行,让请求继续往里走,等它回来。**忘了 `await` 拿到的是协程对象**,Day 81 实测报 `AttributeError: 'coroutine' object has no attribute 'headers'`。
- `response.headers["X-Process-Time-Ms"] = f"{(time.perf_counter() - start) * 1000:.1f}"` 处理耗时,毫秒,保留一位小数。
- `expected = os.environ.get("REFUNDS_API_KEY", "")` 每次请求现读环境变量,测试里用 monkeypatch 改了才生效。环境变量名换成了这个服务自己的,和工单服务的 key 分开:一个泄露了,另一个不受影响。
- `if not expected:` fail closed。漏了这一行,没配环境变量时不带 key 也能建申请(Day 82 坑一)。
- `if not secrets.compare_digest(x_api_key.encode(), expected.encode()):` 恒定耗时比较,先 `.encode()` 成 bytes。
- `def find_refund(refund_id: int) -> dict[str, Any]:` 参数名 `refund_id` 和路由模板 `{refund_id}` 同名,FastAPI 就知道从路径里取它,并且按 `int` 校验。
- `RefundDep = Annotated[dict[str, Any], Depends(find_refund)]` 起个别名,处理函数的参数写 `refund: RefundDep` 就行。
- `status: Literal["pending", "approved", "rejected"] | None = None,` 只允许三个值或不传。`?status=done` 会是 422。
- `limit: Annotated[int, Query(ge=1, le=50)] = 10,` 分页参数一定要有上限(Day 79 的坑:`limit=-1` 是合法 int,却让切片少了最后一条)。
- `@app.post("/refunds", status_code=201, dependencies=[Depends(require_api_key)])` 鉴权写在装饰器上,保证它在请求体校验之前执行。`status_code=201` 是 Created。
- `new_id = max(r["id"] for r in REFUNDS) + 1` 现在最大的 id 是 2,新建的就是 3。只在内存里、单进程时这样写没问题,多个请求同时进来就可能撞号,数据库的自增主键会解决它(Day 91)。
- `"status": "pending",` 状态由服务端定,客户端想传也传不进来(上面的 `extra="forbid"`)。
- `def get_refund(refund: RefundDep):` 找不到的情况 `find_refund` 已经抛了 404,这里只剩「找到了就返回」。

</div>

整个文件 130 多行,没有一行是新东西,但它把六天的内容都用上了。basedpyright(standard 档)检查 `part01/refunds_api.py`:`0 errors, 0 warnings, 0 notes`。

### 跑起来,用 curl 走一遍

在 `~/agent-zero-lab` 里启动,这次用 8001 端口,免得和你可能还开着的工单服务(8000)撞上:

```bash
cd /Users/你/agent-zero-lab
REFUNDS_API_KEY=k-review-83 uv run uvicorn part01.refunds_api:app --port 8001
```

<div class="line-notes">

- `REFUNDS_API_KEY=k-review-83 uv run uvicorn part01.refunds_api:app --port 8001` 环境变量写在命令前面,只对这一条命令生效(Day 53)。模块路径用点号 `part01.refunds_api`,冒号后面是变量名 `app`。没加 `--reload`,今天不改代码,用不着它多起一个监工进程。

</div>

开第二个终端窗口,先确认是谁在监听 8001:

```bash
lsof -nP -iTCP:8001 -sTCP:LISTEN
```

实跑输出:

```text
COMMAND     PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
python3.1 36729 minliu    6u  IPv4 0x56394943ffd042cf      0t0  TCP 127.0.0.1:8001 (LISTEN)
```

`COMMAND` 列被截成了 9 个字符,完整是 `python3.12`;最后一列是 `127.0.0.1:8001`,说明 uvicorn 默认只绑本机,和 Day 77 说的一样。记下 PID 36729,等会儿用来停它。

然后按需求逐条试:

```bash
B=http://127.0.0.1:8001
curl -sS $B/refunds -w "  [%{http_code}]\n"
curl -sS -X POST $B/refunds -H "Content-Type: application/json" -d '{"ticket_id":1001,"amount_cents":2000,"reason":"发票抬头开错了"}' -w "  [%{http_code}]\n"
curl -sS -X POST $B/refunds -H "Content-Type: application/json" -H "X-API-Key: k-review-83" -d '{"ticket_id":1001,"amount_cents":2000,"reason":"发票抬头开错了"}' -w "  [%{http_code}]\n"
curl -sS -X POST $B/refunds -H "Content-Type: application/json" -H "X-API-Key: k-review-83" -d '{"ticket_id":1001,"amount_cents":-5,"reason":"x","status":"approved"}' -w "  [%{http_code}]\n"
curl -sS -i $B/refunds/99
curl -sS "$B/refunds?status=pending&limit=1" -w "  [%{http_code}]\n"
```

<div class="line-notes">

- `B=http://127.0.0.1:8001` 把地址存进 shell 变量,后面少打字。
- `curl -sS $B/refunds -w "  [%{http_code}]\n"` 列表,不需要 key。`-w` 在 body 后面追加状态码(Day 59)。
- `-d '{"ticket_id":1001,"amount_cents":2000,"reason":"发票抬头开错了"}' -w` 第二条不带 key,应该 401。
- `-H "X-API-Key: k-review-83" -d '{"ticket_id":1001,"amount_cents":2000,` 第三条带对的 key,应该 201。
- `"amount_cents":-5,"reason":"x","status":"approved"}'` 第四条一次犯三个错:金额负数、原因只有一个字、多传了 `status`。
- `curl -sS -i $B/refunds/99` 不存在的申请,`-i` 看响应头。
- `curl -sS "$B/refunds?status=pending&limit=1"` URL 里有 `?` 和 `&`,**加双引号**,不然 zsh 报 `no matches found`(Day 78 的坑)。

</div>

实跑输出:

```text
{"count":2,"items":[{"id":1,"ticket_id":1002,"amount_cents":9900,"reason":"同一个月被扣了两次款","status":"pending"},{"id":2,"ticket_id":1003,"amount_cents":4900,"reason":"升级后旧套餐没退差价","status":"approved"}]}  [200]
{"error":{"code":"missing_api_key","message":"缺少 X-API-Key 请求头","details":[],"request_id":"593ee945"}}  [401]
{"id":3,"ticket_id":1001,"amount_cents":2000,"reason":"发票抬头开错了","status":"pending"}  [201]
{"error":{"code":"validation_error","message":"请求参数不合法","details":[{"loc":["body","amount_cents"],"msg":"Input should be greater than 0","type":"greater_than"},{"loc":["body","reason"],"msg":"String should have at least 2 characters","type":"string_too_short"},{"loc":["body","status"],"msg":"Extra inputs are not permitted","type":"extra_forbidden"}],"request_id":"1901649c"}}  [422]
HTTP/1.1 404 Not Found
date: Thu, 22 Oct 2026 15:47:20 GMT
server: uvicorn
content-length: 115
content-type: application/json
x-request-id: 3f0f1256
x-process-time-ms: 2.7

{"error":{"code":"refund_not_found","message":"没有这个退款申请: 99","details":[],"request_id":"3f0f1256"}}
{"count":1,"items":[{"id":1,"ticket_id":1002,"amount_cents":9900,"reason":"同一个月被扣了两次款","status":"pending"}]}  [200]
```

逐条对一下需求。第四条值得多看一眼:三个错误**一次全报出来了**,每条的 `loc` 都指向具体字段,`type` 分别是 `greater_than`、`string_too_short`、`extra_forbidden`。前端拿到这个就能在表单上三个地方同时标红,不用让用户改一个提交一次。第五条的响应头里有 `x-request-id: 3f0f1256`,和 body 里的 `request_id` 是同一个值,这正是 Day 81 中间件和 `error_body` 配合的结果。

第三条建成了 3 号申请,第六条筛 `pending` 并且 `limit=1`,只返回了 1 号。3 号也是 pending,被 `limit` 截掉了。

服务器窗口的访问日志:

```text
INFO:     127.0.0.1:56436 - "GET /refunds HTTP/1.1" 200 OK
INFO:     127.0.0.1:56442 - "POST /refunds HTTP/1.1" 401 Unauthorized
INFO:     127.0.0.1:56444 - "POST /refunds HTTP/1.1" 201 Created
INFO:     127.0.0.1:56445 - "POST /refunds HTTP/1.1" 422 Unprocessable Entity
INFO:     127.0.0.1:56446 - "GET /refunds/99 HTTP/1.1" 404 Not Found
INFO:     127.0.0.1:56447 - "GET /refunds?status=pending&limit=1 HTTP/1.1" 200 OK
```

每一行最前面那个 `127.0.0.1:56436` 是**客户端**的地址和端口。curl 每发一次请求,系统就给它临时分配一个端口(56436、56442……),这就是 Day 77 说的「端口是进程的门牌号」的另一面:客户端也有门牌号,只是临时的,用完就还。

试完在服务器窗口按 Ctrl+C,或者在第二个窗口 `kill 36729`。再跑一次 `lsof -nP -iTCP:8001 -sTCP:LISTEN`,什么都不输出,说明端口已经放出来了。

### 测试

新建 `tests/test_refunds_api.py`:

```python
# agent-zero-lab/tests/test_refunds_api.py
import pytest
from fastapi.testclient import TestClient

from part01 import refunds_api
from part01.refunds_api import app

client = TestClient(app)
KEY = {"X-API-Key": "test-key"}
NEW = {"ticket_id": 1001, "amount_cents": 2000, "reason": "发票抬头开错了,客户要求退回重开"}


@pytest.fixture(autouse=True)
def setup(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(refunds_api, "REFUNDS", list(refunds_api.REFUNDS))
    monkeypatch.setenv("REFUNDS_API_KEY", "test-key")


def test_create_ok():
    resp = client.post("/refunds", json=NEW, headers=KEY)
    assert resp.status_code == 201
    assert resp.json()["id"] == 3
    assert resp.json()["status"] == "pending"


def test_create_needs_key():
    resp = client.post("/refunds", json=NEW)
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "missing_api_key"


def test_amount_must_be_positive():
    resp = client.post("/refunds", json={"ticket_id": 1001, "amount_cents": 0, "reason": "金额写成了 0"}, headers=KEY)
    assert resp.status_code == 422
    assert resp.json()["error"]["details"][0]["loc"] == ["body", "amount_cents"]


def test_not_found_uses_error_format():
    resp = client.get("/refunds/99")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "refund_not_found"
    assert resp.json()["error"]["request_id"] == resp.headers["X-Request-ID"]


def test_list_filter():
    resp = client.get("/refunds", params={"status": "approved"})
    assert [r["id"] for r in resp.json()["items"]] == [2]
```

<div class="line-notes">

- `from part01 import refunds_api` 导入模块本身,下面 monkeypatch 要改它上面的 `REFUNDS`。
- `KEY = {"X-API-Key": "test-key"}` 测试用的假 key,和你启动时用的 `k-review-83` 没关系。
- `monkeypatch.setattr(refunds_api, "REFUNDS", list(refunds_api.REFUNDS))` 每个测试换一份副本,测试结束自动换回来。不这样做的话,`test_create_ok` 建的 3 号会留到下一个测试里(Day 80 的坑:单独跑都过、一起跑才挂)。`list(...)` 复制的是外层列表,里面的字典还是同一批,练习 3 会撞上这件事。
- `monkeypatch.setenv("REFUNDS_API_KEY", "test-key")` 测试进程里没有这个环境变量,不设的话所有 POST 都是 500(fail closed 在起作用)。
- `assert resp.json()["id"] == 3` 因为每个测试都从那两条初始数据开始,新建的一定是 3。
- `json={"ticket_id": 1001, "amount_cents": 0, "reason": "金额写成了 0"}` 金额 0,边界值。`gt=0` 不包含 0,所以应该 422。边界值是最容易写错的地方,`gt` 和 `ge` 弄反了这个测试就会红。
- `assert resp.json()["error"]["details"][0]["loc"] == ["body", "amount_cents"]` `loc` 在 JSON 里是数组,Python 里拿到的是 list。
- `assert resp.json()["error"]["request_id"] == resp.headers["X-Request-ID"]` 钉住「body 里的编号和响应头里的编号是同一个」。哪天有人改中间件时把这两处弄得不一致了,这个测试会红。
- `resp = client.get("/refunds", params={"status": "approved"})` `params=` 让 TestClient 帮你拼查询参数,不用自己处理编码。
- `assert [r["id"] for r in resp.json()["items"]] == [2]` 用推导式把 id 抽出来比,比逐个字段比省事,也一眼能看出期望。

</div>

```bash
uv run pytest tests/test_refunds_api.py -q
```

实跑输出:

```text
.....                                                                    [100%]
5 passed in 1.02s
```

再跑一次全部测试 `uv run pytest -q`,前几天的测试也应该全绿。basedpyright 检查 `tests/test_refunds_api.py`,0 错误。

### 小项目用到了本周哪一天

| 小项目里的东西 | 来自 |
| --- | --- |
| `--port 8001`、`lsof`、`kill PID`、只绑 127.0.0.1 | Day 77 |
| 先算完再发、状态码和处理函数分开 | Day 78(FastAPI 替你做了 `reply` 那部分) |
| `{refund_id}` 路径参数、`status`/`limit` 查询参数、`Query(ge, le)` | Day 79 |
| `RefundCreate`、`Field`、`extra="forbid"`、201 | Day 80 |
| `ApiError`、四个异常处理器、`find_refund` 依赖、中间件 | Day 81 |
| `require_api_key`、fail closed、`compare_digest`、装饰器上的 `dependencies` | Day 82 |
| fixture + monkeypatch 隔离数据和环境变量 | Day 73–74,Day 80 用到 FastAPI 上 |

## 本周错题与坑清单

这一周踩过的坑,按「看到什么现象 → 真正的原因 → 怎么改」排在一起。下次看到左边那一列,直接对到右边。

| 看到的现象 | 真正的原因 | 怎么改 | 哪天 |
| --- | --- | --- | --- |
| `Address already in use`(uvicorn 里是 `[Errno 48] ... address already in use`) | 上一个服务没关,或者 Ctrl+Z 挂到了后台 | `lsof -nP -iTCP:端口 -sTCP:LISTEN` 看清 PID 再 `kill` | 77 |
| curl 一直等,不返回 | 服务进程被 Ctrl+Z 暂停了 | `fg` 拉回前台再 Ctrl+C | 77 |
| `127.0.0.1` 能访问,`localhost` 不行 | 服务只绑了 IPv4,客户端先试了 `::1` | 统一用 127.0.0.1 | 77 |
| 客户端收到 `Empty reply from server` | 处理函数抛了异常,`http.server` 直接断开连接 | 看服务器窗口的 traceback | 78 |
| 中文响应最后一个字变成 `�` | `Content-Length` 按字符数算了 | 对 encode 后的 bytes 求 `len` | 78 |
| zsh: `no matches found` | URL 里的 `?` 没加引号 | URL 一律加双引号 | 78 |
| `/tickets/stats` 得到 422,`input` 是 `"stats"` | 固定路径写在 `{ticket_id}` 后面,被吞了 | 固定路径往前放 | 79 |
| `curl /tickets/` 拿到空 body | 末尾斜杠被 307 重定向,curl 默认不跟 | 去掉斜杠,或加 `-L` | 79 |
| 422,`type` 是 `model_attributes_type` | 发 JSON 没写 `Content-Type: application/json` | 加上这个头 | 80 |
| 传了 `status` 返回 200,状态却没变 | pydantic 默认忽略多余字段 | `extra="forbid"` | 80 |
| `field_validator` 之后字段变成 `None` | 校验器忘了 `return` | 返回处理后的值 | 80 |
| 405 响应没有 `allow` 头 | 接管 HTTPException 时丢了 `headers` | `headers=exc.headers` | 81 |
| `'coroutine' object has no attribute 'headers'` | 中间件里 `call_next` 没 `await` | 加 `await`,函数写 `async def` | 81 |
| 模块一导入就 `TypeError: ... missing 1 required positional argument` | `Depends(find_ticket())` 多写了括号 | 传函数本身 `Depends(find_ticket)` | 81 |
| 不带任何凭证,写操作成功了 | 服务端没配 key,空字符串等于空字符串 | `if not expected: raise 500` | 82 |
| 带了 `X_API_KEY` 头还是 401 | 下划线头名对不上,FastAPI 找的是 `x-api-key` | 调用方写横线 | 82 |
| 不带 key 的 PATCH 回了 404 而不是 401 | 参数依赖按从左到右执行,`find_ticket` 先跑了 | 鉴权放第一个参数或装饰器 `dependencies` | 82 |
| 退出后,复制走的旧 cookie 还能用 | 只删了浏览器的 cookie,没删服务端 session | `SESSIONS.pop(sid)` | 82 |

这张表里有一半的坑,共同点是「**没报错,但结果不对**」:多余字段被静默忽略、`field_validator` 忘了 return、fail open、下划线头名被当成没带。报错的坑反而好办,traceback 会告诉你哪一行。没报错的坑只能靠测试钉住,这也是本周每个功能都配了测试的原因。

还有一个我这周反复看到的现象:**出了问题先看客户端,而不是先看服务器窗口**。客户端只能看到状态码和一句话,真正的原因(哪个文件哪一行抛了什么)只在服务端日志里。Day 81 加请求编号,就是为了让你能拿着客户端看到的 `request_id` 去服务端日志里精确找到那一条。

## 动手练习

**练习 1(默写):`require_api_key` 和它的测试。** 合上文章,在 `part01/tickets_api.py` 里把 `require_api_key` 删掉重写,要满足三条:服务端没配 `TICKETS_API_KEY` 回 500 `server_misconfigured`;没带头回 401 `missing_api_key`;带错回 401 `invalid_api_key`;两个 401 都带 `WWW-Authenticate: ApiKey`。然后同样合上文章重写 `tests/test_auth.py` 的五个测试,跑通。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/tickets_api.py(require_api_key,放在 TicketDep 下面)
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

- `def require_api_key(x_api_key: Annotated[str | None, Header()] = None) -> None:` 默写时最容易错的是**参数名**。它必须叫 `x_api_key`,FastAPI 把下划线换成横线去找 `x-api-key` 头。下面有实测。
- `expected = os.environ.get("TICKETS_API_KEY", "")` 放在函数里读,不放在模块开头,测试里的 `monkeypatch.setenv` 才能生效。
- `if not expected:` 这一行最容易被默写漏掉,漏了就是 fail open。
- `if x_api_key is None:` 用 `is None` 判断「没带」。写成 `if not x_api_key:` 的话,带一个空头 `X-API-Key: ` 也会被当成没带,报 `missing_api_key`;功能上也算拦住了,但两种情况的 code 就混在一起了。
- `if not secrets.compare_digest(x_api_key.encode(), expected.encode()):` 两边都 `.encode()`。

</div>

我故意把参数名写成 `api_key` 试了一下,用一个最小的应用(`scratch/wrongname.py`,试完删掉):

```python
# agent-zero-lab/scratch/wrongname.py(演示完删掉)
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.testclient import TestClient

app = FastAPI()


def require_api_key(api_key: Annotated[str | None, Header()] = None) -> None:
    if api_key != "k":
        raise HTTPException(status_code=401, detail=f"收到的 api_key 是 {api_key!r}")


@app.post("/refunds", dependencies=[Depends(require_api_key)])
def create():
    return {"ok": True}


c = TestClient(app)
print(c.post("/refunds", headers={"X-API-Key": "k"}).json())
print(c.post("/refunds", headers={"Api-Key": "k"}).json())
```

<div class="line-notes">

- `def require_api_key(api_key: Annotated[str | None, Header()] = None) -> None:` 参数名少了 `x_`,FastAPI 会去找 `api-key` 头。
- `raise HTTPException(status_code=401, detail=f"收到的 api_key 是 {api_key!r}")` `!r` 在 f-string 里表示用 `repr` 显示,`None` 就显示成 `None`,字符串会带引号,方便看清到底收到了什么。
- `print(c.post("/refunds", headers={"X-API-Key": "k"}).json())` 调用方按约定发 `X-API-Key`。
- `print(c.post("/refunds", headers={"Api-Key": "k"}).json())` 换成 `Api-Key` 头再试。

</div>

`uv run python -m scratch.wrongname` 实跑输出:

```text
{'detail': '收到的 api_key 是 None'}
{'ok': True}
```

调用方明明带了 `X-API-Key`,服务端却说没收到;反而发 `Api-Key` 才通过。参数名就是头名,一个字母都不能差。

测试照 Day 82 写,这里不再重复贴(`tests/test_auth.py` 那五个测试)。`uv run pytest tests/test_auth.py -v` 实跑输出:

```text
tests/test_auth.py::test_missing_key_is_401 PASSED                       [ 20%]
tests/test_auth.py::test_wrong_key_is_401 PASSED                         [ 40%]
tests/test_auth.py::test_right_key_creates PASSED                        [ 60%]
tests/test_auth.py::test_read_needs_no_key PASSED                        [ 80%]
tests/test_auth.py::test_no_server_key_fails_closed PASSED               [100%]
============================== 5 passed in 0.58s ===============================
```

自己对的时候重点看三处:`autouse` 的 fixture 里有没有同时换 `TICKETS` 和设环境变量;`test_no_server_key_fails_closed` 里有没有先 `delenv`;401 的测试有没有检查 `WWW-Authenticate` 头。

</details>

**练习 2(默写):不用框架的路由。** 合上文章,写出 Day 78 `part01/mini_server.py` 里的 `route` 函数和 `Handler` 类(`do_GET`、`do_POST`、`reply`)。处理函数 `index`、`list_tickets`、`get_ticket` 和 `ROUTES` 可以先看一眼抄过来。写完启动,用 curl 验证六种情况:`/`、`/tickets?status=closed`、`/tickets/1002`、`/tickets/abc`、`/nope`、`POST /tickets`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/mini_server.py(route 和 Handler)
def route(method: str, raw_path: str) -> Reply:
    parts = urlsplit(raw_path)
    if method != "GET":
        return 405, {"error": f"不支持的方法: {method}"}
    handler = ROUTES.get(parts.path)
    if handler is not None:
        return handler(parse_qs(parts.query))
    if parts.path.startswith("/tickets/"):
        return get_ticket(parts.path.removeprefix("/tickets/"))
    return 404, {"error": f"没有这个路径: {parts.path}"}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.reply(*route("GET", self.path))

    def do_POST(self):
        self.reply(*route("POST", self.path))

    def reply(self, status: int, data: dict[str, Any]) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
```

<div class="line-notes">

- `parts = urlsplit(raw_path)` `self.path` 是 `/tickets?status=closed` 这样带查询串的原始路径,先拆成 `path` 和 `query` 两部分。
- `if method != "GET":` 这个服务只有读接口,不是 GET 一律 405。FastAPI 里这件事是框架按路由表自动判断的。
- `handler = ROUTES.get(parts.path)` 查路由表。固定路径用字典查,查不到是 `None`。
- `return handler(parse_qs(parts.query))` 查询串交给 `parse_qs` 变成 `{"status": ["closed"]}`,注意值是列表。
- `if parts.path.startswith("/tickets/"):` 带工单号的路径放不进字典,单独判断。这就是 Day 79 说的「路径模板」的手写版。
- `return get_ticket(parts.path.removeprefix("/tickets/"))` 截掉前缀,剩下的 `"1002"` 是字符串,由 `get_ticket` 自己检查是不是数字。
- `self.reply(*route("GET", self.path))` `*` 把 `(200, {...})` 这个元组拆成两个参数传给 `reply`,≈JS 里调用函数时的展开 `reply(...arr)`。
- `body = json.dumps(data, ensure_ascii=False).encode("utf-8")` **先**把 body 算好,并且变成 bytes。`ensure_ascii=False` 让中文原样输出而不是 `工`。
- `self.send_header("Content-Length", str(len(body)))` 对 bytes 求长度,中文一个字 3 个字节。
- `self.end_headers()` 发出头和体之间那个空行。
- `self.wfile.write(body)` 最后才写体。

</div>

`uv run python -m part01.mini_server` 启动,另一个窗口:

```bash
for p in / "/tickets?status=closed" /tickets/1002 /tickets/abc /nope; do curl -sS "http://127.0.0.1:8000$p" -w "  [%{http_code}]\n"; done
curl -sS -X POST http://127.0.0.1:8000/tickets -w "  [%{http_code}]\n"
```

<div class="line-notes">

- `for p in / "/tickets?status=closed" /tickets/1002 /tickets/abc /nope; do` shell 的 for 循环,`p` 依次取这五个路径,`do` 和 `done` 之间是每次要执行的命令。带 `?` 的那个单独加了引号。
- `curl -sS -X POST http://127.0.0.1:8000/tickets` 换成 POST,看 405。

</div>

实跑输出:

```text
{"service": "cloudledger-tickets", "routes": ["/tickets", "/tickets/{id}"]}  [200]
{"count": 1, "items": [{"id": 1003, "title": "想从基础版升级到专业版", "status": "closed"}]}  [200]
{"id": 1002, "title": "同一个月被扣了两次款", "status": "open"}  [200]
{"error": "工单号必须是数字: abc"}  [400]
{"error": "没有这个路径: /nope"}  [404]
{"error": "不支持的方法: POST"}  [405]
```

和 FastAPI 版对比一下:`/tickets/abc` 在这里是我们自己判断回的 400,FastAPI 里是框架自动回的 422;错误格式也是我们随手约定的 `{"error": "..."}`,没有 code、没有请求编号。框架省掉的不只是代码量,还有这些「每个人随手约定一种」的不一致。

</details>

**练习 3:给退款申请加审批接口。** 加一个 `PATCH /refunds/{refund_id}`,请求体 `{"status": "approved"}` 或 `{"status": "rejected"}`,必须带 API key。只有 `pending` 的申请能审批,已经审批过的再改要回 **409 Conflict**,code 是 `refund_already_decided`。不许把状态改回 `pending`。再补四个测试:审批成功、重复审批 409、不带 key 审批一个不存在的申请应该是 401 而不是 404、改回 pending 是 422。

<details><summary>参考答案</summary>

409 Conflict 的意思是「请求本身没毛病,但和资源当前的状态冲突」。参数格式错了是 422,资源不存在是 404,而「这个申请已经批过了」两样都不是,用 409。

```python
# agent-zero-lab/part01/refunds_api.py(追加在文件末尾)
class Decision(BaseModel):
    status: Literal["approved", "rejected"]


@app.patch("/refunds/{refund_id}", dependencies=[Depends(require_api_key)])
def decide_refund(refund: RefundDep, body: Decision):
    if refund["status"] != "pending":
        raise ApiError(409, "refund_already_decided", f"这个申请已经是 {refund['status']},不能再改")
    refund["status"] = body.status
    return refund
```

<div class="line-notes">

- `status: Literal["approved", "rejected"]` 只允许这两个值,`pending` 不在里面,所以「改回待审批」直接被 pydantic 挡成 422,不用写 if。
- `@app.patch("/refunds/{refund_id}", dependencies=[Depends(require_api_key)])` 鉴权放装饰器上,保证它先于 `find_refund` 执行。
- `def decide_refund(refund: RefundDep, body: Decision):` `refund` 由依赖查好,`body` 是请求体。
- `if refund["status"] != "pending":` 业务规则:只有待审批的能审。
- `raise ApiError(409, "refund_already_decided", f"这个申请已经是 {refund['status']},不能再改")` f-string 里面要用单引号的 `'status'`,因为外面已经是双引号了。
- `refund["status"] = body.status` 直接改字典。`refund` 就是 `REFUNDS` 列表里的那个字典本身,不是副本,所以改了它,列表里也变了。

</div>

```python
# agent-zero-lab/tests/test_refunds_api.py(追加)
def test_decide_pending():
    resp = client.patch("/refunds/1", json={"status": "approved"}, headers=KEY)
    assert resp.status_code == 200
    assert resp.json()["status"] == "approved"


def test_decide_twice_is_409():
    resp = client.patch("/refunds/2", json={"status": "rejected"}, headers=KEY)
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "refund_already_decided"


def test_decide_needs_key_before_404():
    resp = client.patch("/refunds/99", json={"status": "approved"})
    assert resp.status_code == 401


def test_cannot_set_back_to_pending():
    resp = client.patch("/refunds/1", json={"status": "pending"}, headers=KEY)
    assert resp.status_code == 422
```

<div class="line-notes">

- `resp = client.patch("/refunds/2", json={"status": "rejected"}, headers=KEY)` 2 号初始就是 approved,不用先审一次。
- `resp = client.patch("/refunds/99", json={"status": "approved"})` 不存在 + 不带 key,钉住「先认人」的顺序。
- `resp = client.patch("/refunds/1", json={"status": "pending"}, headers=KEY)` 想改回待审批。

</div>

`uv run pytest tests/test_refunds_api.py -q` 实跑输出:

```text
.........                                                                [100%]
9 passed in 0.77s
```

这里藏着一个 fixture 的坑,我写的时候差点踩上。`monkeypatch.setattr(refunds_api, "REFUNDS", list(refunds_api.REFUNDS))` 复制的只是**外层列表**,里面的两个字典还是原来那两个。`test_decide_pending` 把 1 号字典的 `status` 改成了 approved,这个改动不会随测试结束被还原。下面这个脚本在同一个进程里连续审批,能看得很清楚:

```python
# agent-zero-lab/scratch/ex3.py(演示完删掉)
import os

from fastapi.testclient import TestClient

from part01.refunds_api import app

os.environ["REFUNDS_API_KEY"] = "k"
c = TestClient(app, headers={"X-API-Key": "k"})
for rid, st in [(1, "approved"), (1, "rejected"), (2, "rejected"), (99, "approved")]:
    r = c.patch(f"/refunds/{rid}", json={"status": st})
    print(rid, st, r.status_code, r.json())
```

<div class="line-notes">

- `os.environ["REFUNDS_API_KEY"] = "k"` 脚本里直接设环境变量,只影响这个进程。
- `for rid, st in [(1, "approved"), (1, "rejected"), (2, "rejected"), (99, "approved")]:` 四次审批,每个元组拆成两个变量(Day 22 的解包)。

</div>

实跑输出:

```text
1 approved 200 {'id': 1, 'ticket_id': 1002, 'amount_cents': 9900, 'reason': '同一个月被扣了两次款', 'status': 'approved'}
1 rejected 409 {'error': {'code': 'refund_already_decided', 'message': '这个申请已经是 approved,不能再改', 'details': [], 'request_id': '94febe55'}}
2 rejected 409 {'error': {'code': 'refund_already_decided', 'message': '这个申请已经是 approved,不能再改', 'details': [], 'request_id': '09c044c4'}}
99 approved 404 {'error': {'code': 'refund_not_found', 'message': '没有这个退款申请: 99', 'details': [], 'request_id': 'f31f00a2'}}
```

第一次审批 1 号成功,第二次 409,规则生效。在 pytest 里,我们的四个测试碰巧没有依赖「1 号一定是 pending」之后的状态,所以全绿;但如果你再加一个测试先审 1 号、另一个测试也假设 1 号是 pending,两个测试按顺序跑就会挂一个。真正的修法是在 fixture 里连字典也复制一份:`[dict(r) for r in refunds_api.REFUNDS]`。改成这样以后同样是 9 passed。这类「共享了可变对象」的问题,等数据进了数据库、每个测试用一个新库,就自然没了。

</details>

**练习 4(观察题):两种启动失败。** ① 不设 `REFUNDS_API_KEY` 启动退款服务,带任意 key POST 一次,看状态码和 code。② 退款服务开着的时候,在另一个窗口再启动一次同样端口的服务,读报错,然后用 `lsof` 找到第一个进程并停掉它。

<details><summary>参考答案</summary>

① 不设环境变量:

```bash
uv run uvicorn part01.refunds_api:app --port 8001
curl -sS -X POST http://127.0.0.1:8001/refunds -H "Content-Type: application/json" -H "X-API-Key: anything" -d '{"ticket_id":1001,"amount_cents":2000,"reason":"测试"}' -w "  [%{http_code}]\n"
```

得到的是 `{"error":{"code":"server_misconfigured","message":"服务端没有配置 API key",...}}  [500]`(和 Day 82 工单服务的实测一样)。服务能启动、读接口照常能用,只有写操作被拒绝。这是 fail closed 的样子:配置错了,宁可写不进去,也不能谁都能写。

② 端口冲突。第一个服务开在 8001,另一个窗口再执行一次 `REFUNDS_API_KEY=k uv run uvicorn part01.refunds_api:app --port 8001`,实跑输出:

```text
ERROR:    [Errno 48] error while attempting to bind on address ('127.0.0.1', 8001): [errno 48] address already in use
INFO:     Waiting for application shutdown.
INFO:     Application shutdown complete.
```

`Errno 48` 是 macOS 上「地址已被占用」的错误号(Linux 上是 98),`bind` 就是 Day 77 说的「绑定端口」那一步。第二个进程起不来,自己退出了,第一个进程完全不受影响。接下来:

```bash
lsof -nP -iTCP:8001 -sTCP:LISTEN
kill 36729
lsof -nP -iTCP:8001 -sTCP:LISTEN; echo "exit=$?"
```

<div class="line-notes">

- `kill 36729` 用 lsof 输出里的 PID。普通 `kill` 发的是让进程体面退出的信号,uvicorn 会打印 `Shutting down` 再退出;不行再用 `kill -9`。
- `lsof -nP -iTCP:8001 -sTCP:LISTEN; echo "exit=$?"` `$?` 是上一条命令的退出码,0 表示成功,非 0 表示失败或没找到。lsof 什么都没找到时退出码是 1。

</div>

实跑输出(第一条 lsof 的结果前面贴过):

```text
exit=1
```

没有输出、退出码 1,端口空出来了。

</details>

**验收标准:** `part01/refunds_api.py` 能用 `REFUNDS_API_KEY=... uv run uvicorn part01.refunds_api:app --port 8001` 启动,curl 走完「列表 200 → 不带 key 401 → 带 key 201 → 坏数据 422(三个错一次报全)→ 不存在 404 且有 `x-request-id`」;`uv run pytest -q` 全绿,其中 `test_refunds_api.py` 9 个;不看文章写得出 `require_api_key` 和四个异常处理器的结构;能看着知识地图讲出一次请求经过的每一站,以及鉴权为什么要排在请求体校验前面。

## 名词解释

复习日没有新概念,这里只收今天第一次出现的几个词,以及本周最容易混的几个。

| 名词 | 意思 |
| --- | --- |
| 409 Conflict | 请求格式没问题,但和资源当前状态冲突,比如审批一个已经审批过的申请 |
| 边界值 | 规则的临界点,如 `gt=0` 时的 0、`le=500000` 时的 500000,测试最该覆盖的地方 |
| 分(cents) | 金额用最小货币单位的整数存,99 元存成 9900,避免小数误差 |
| `Errno 48` | macOS 上「地址已被占用」的错误号,端口被别的进程占着 |
| 临时端口 | 客户端每次连接时系统临时分配的端口,访问日志里 `127.0.0.1:56436` 的后半截 |
| 浅复制 | `list(xs)` 只复制外层列表,里面的字典还是同一批;要连里面一起复制写 `[dict(r) for r in xs]` |
| 401 / 403 / 404 / 409 / 422 | 不认识你 / 认识但不许 / 没这个东西 / 和现状冲突 / 参数不合格,本周全部用过 |
| fail closed | 出故障时拒绝而不是放行,安全检查的默认姿势(Day 82) |

## 常见误区

**以为看懂了就是会了。** 我这周重写退款服务时,第一遍漏了 `headers=exc.headers` 和 `if not expected`,两处都不会报错,只有测试或者 405 响应少了个头才看得出来。复习日的默写不能省。

**鉴权写在参数的最后一个。** 参数依赖从左到右执行,写在后面就会让 404、422 先于 401 出现,没认证的人能借此探测数据和字段规则。写在装饰器的 `dependencies` 里,或者放第一个参数。

**钱用浮点数存。** `amount: float` 看起来省事,`0.1 + 0.2` 的问题迟早会以「对账差一分钱」的形式出现。用整数的分。

**`list(...)` 当成完整复制。** 它是浅复制,里面的字典被改了不会随 monkeypatch 还原。测试里要改字典内容时,连字典一起复制。

**两个服务抢同一个端口。** 一个项目里有工单服务又有退款服务,各用各的端口(8000、8001),或者以后学了怎么把它们挂在同一个应用下。看到 `Errno 48` 先 `lsof`。

**以为客户端看到的就是全部。** 客户端只有状态码和一句 message,原因在服务端日志里。学会拿 `request_id` 去日志里搜。

## 学习资料

### 文档与文章

- [FastAPI 中文文档 · 教程 - 用户指南](https://fastapi.tiangolo.com/zh/tutorial/):本周 Day 79–82 的内容都在前半部分,复习时按目录对照着扫一遍,看哪一节你还说不清。
- [FastAPI 中文文档 · 处理错误](https://fastapi.tiangolo.com/zh/tutorial/handling-errors/):异常处理器和 `RequestValidationError` 的官方写法。
- [FastAPI 中文文档 · 依赖项](https://fastapi.tiangolo.com/zh/tutorial/dependencies/):`Depends` 的官方讲解,后面几节讲子依赖和装饰器上的依赖。
- [FastAPI 中文文档 · 测试](https://fastapi.tiangolo.com/zh/tutorial/testing/):`TestClient` 的用法。
- [FastAPI 中文文档 · 更大的应用 - 多个文件](https://fastapi.tiangolo.com/zh/tutorial/bigger-applications/):`tickets_api.py` 和 `refunds_api.py` 里那一大段错误处理是重复的,这一节讲怎么拆文件、共用代码。现在看个大概就行,后面做 SupportPilot 时会用上。
- [MDN · HTTP 概述](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Guides/Overview):从协议角度再看一遍请求和响应的结构,对照 Day 78 手写的 `reply`。
- [uvicorn 文档 · Settings(英文)](https://uvicorn.dev/settings/):`--host`、`--port`、`--reload` 等启动参数的完整列表。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1UV411h7Mv&autoplay=0&high_quality=1" title="一节课彻底搞懂前端后端的关系,到底什么是接口?概念与实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>耕耕技术宅 · 一节课彻底搞懂前端后端的关系,到底什么是接口?概念与实战 · 约 31 分钟,播放 27 万多。从前端的角度讲接口是什么,正好用来检验这周的知识地图:他讲到的每一步,你都应该能指出在 refunds_api.py 的哪一段。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV18F4m1K7N3&autoplay=0&high_quality=1" title="【程序员科科】1小时精通Python的FastAPI框架的所有知识点" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员科科 · 1 小时精通 Python 的 FastAPI 框架的所有知识点 · 约 68 分钟。把路由、参数、请求体、依赖、中间件串着讲了一遍,适合复习日开 1.5 倍速过一遍,看到哪里卡住就回到对应那一天。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/8TMQcRcBnW8" title="FastAPI Crash Course - Modern Python API Development" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Traversy Media · FastAPI Crash Course - Modern Python API Development · 英文。另一位讲师从零搭一个 FastAPI 项目,看看别人的写法和你这周的写法哪里不一样。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/iYM2zFP3Zn0" title="HTTP Crash Course &amp; Exploration" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Traversy Media · HTTP Crash Course &amp; Exploration · 英文。请求、响应、状态码、头的总复习,对照知识地图最底下那一格看。</figcaption>
</figure>

### 书籍

- Bill Lubanovic,《FastAPI: Modern Python Web Development》,O'Reilly,2023(英文)。作者也写过《Python 语言及其应用》。这本书从 Web 基础讲到 FastAPI 的分层写法(Web 层、服务层、数据层),本周学的东西在前几章,后面的分层正是我们以后拆 `tickets_api.py` 的方向。

### 开源项目与代码

- [fastapi/full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template):FastAPI 官方的全栈模板。打开 `backend/app/api/` 看看一个真实项目怎么把路由、依赖(`deps.py`)拆到不同文件里,和你这周一个文件写到底的版本对比。

## 自测

1. 一个不带 API key 的 `POST /refunds`,请求体里金额是负数。服务端回 401 还是 422?为什么?

<details><summary>答案</summary>

401。`require_api_key` 写在装饰器的 `dependencies` 上,它在请求体校验之前执行,一抛 401 后面就不再进行了。这是故意的:没认证的人不该从 422 里看到字段规则。

</details>

2. 下面三个错误分别会得到什么状态码:`GET /refunds/abc`、`GET /refunds?limit=100`、`PATCH /refunds/2` 把已通过的申请改成 rejected(带对的 key)?

<details><summary>答案</summary>

422(`refund_id` 要求 int)、422(`limit` 上限 50)、409(和当前状态冲突,练习 3 的规则)。前两个是参数不合格,第三个参数没毛病但业务上不允许。

</details>

3. 退款服务里,`X-Request-ID` 是在哪里加上的?为什么 `handle_unexpected` 里还要再加一次?

<details><summary>答案</summary>

中间件 `add_request_id` 在 `await call_next(request)` 返回后给响应加头。但代码 bug 引起的未处理异常会直接穿过中间件,`call_next` 后面那几行不会执行,500 的响应就没有这个头。所以兜底的 `Exception` 处理器里自己从 `error_body` 拿编号补上(Day 81)。

</details>

4. `uvicorn` 启动报 `[Errno 48] ... address already in use`,你的排查步骤是什么?

<details><summary>答案</summary>

`lsof -nP -iTCP:8001 -sTCP:LISTEN` 看是哪个进程(PID 和命令名)占着。多半是自己上次没关的服务(也可能被 Ctrl+Z 挂在了后台,用 `fg` 拉回来再 Ctrl+C);确认是可以停的,先 `kill PID`,不行再 `kill -9`。如果占着的是数据库之类你需要的东西,就换个端口启动自己的服务。

</details>

5. 面试题:你写了一个给 Agent 调用的内部接口「创建退款申请」。说说你会在接口层面做哪几道防护,按请求进来的顺序讲。

<details><summary>答案</summary>

按顺序:先认证,每个调用方一个 API key,放在头里,恒定耗时比较,服务端缺配置时拒绝一切,不认识的调用方直接 401,不让它看到后面的任何信息;再校验参数,请求体用模型定死字段、类型和范围(金额大于 0、有上限,单位用分),多传字段报错,让 Agent 不能自己把状态写成「已批准」;然后查资源和业务规则,工单存不存在、申请是不是还在待审批,冲突用 409;Agent 只能创建申请,批准走另一个接口,要人来调用。全程每个请求带编号,错误统一格式,4xx 让调用方(包括 Agent)能根据 code 决定是改参数重试还是放弃,500 不漏内部细节,细节只进日志。最后用测试钉住顺序:不带 key 访问不存在的资源必须是 401。

</details>

## 明天预告

Day 84 · 鉴权(二):JWT 是什么,签名怎么验。Day 82 的 session 方案要在服务端存一张「编号 → 用户」的表,每个请求都去查;JWT 换了个思路,把「你是谁、什么角色、几点过期」直接写进令牌,再用只有服务端知道的密钥签个名,服务端拿到令牌验一下签名就行,不用查表。明天会先手工拼一个 JWT,用 base64url 和 HMAC 把三段都算出来,再用 pyjwt 验证你拼的是对的;最后在 FastAPI 里用它做登录,亲眼看到它的代价:退出登录以后,旧令牌照样能用。
