---
title: 'Day 79 · FastAPI(一):路由、路径参数和查询参数'
description: '把昨天 60 行手写的工单服务换成 FastAPI:一行 @app.get 登记路由,路径参数和查询参数写成函数参数,加上类型标注它就自动转换和校验,不对就回 422。用 uvicorn 运行,对照 Express 理解,再踩一遍路由顺序、末尾斜杠和 URL 里中文的坑。'
pubDate: 2026-10-22
regime: none
tags: ['fastapi', 'backend', 'python', 'agent-zero']
series: 'agent-zero'
day: 79
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 78](/blog/agent-zero/day-078-server-2/) 用标准库 `http.server` 手写了一个工单服务 `part01/mini_server.py`:请求进来,`route` 函数按方法和路径查路由表,交给 `index`、`list_tickets`、`get_ticket` 这些处理函数算出 `(状态码, 数据)`,最后 `reply` 依次写状态行、头、空行、体。路上踩了三个坑:`wfile` 只收 bytes、`Content-Length` 按字节算、处理函数抛异常时客户端只收到 Empty reply。

写完你大概也感觉到了,这些活大部分是重复的:每个服务都要拆 URL、查路由、把 `"1002"` 转成整数、检查 `"abc"` 不是数字、拼 JSON、算长度。练习 4 还发现 `/tickets/{id}` 这种模板放不进路由表。**框架**就是把这些重复的活一次写好给大家用的东西。Python 写 Agent 服务最常用的框架是 FastAPI,这门课后面的 Agent 接口、SupportPilot 毕业项目都用它。今天把昨天的工单服务用 FastAPI 重写一遍。

## 今天要解决的问题

学完今天,你应该能做到:

1. 装好 FastAPI 和 uvicorn,写一个最小的应用,用 `uvicorn 模块:app` 跑起来,说清楚 FastAPI 和 uvicorn 各管什么。
2. 用 `@app.get("/tickets/{ticket_id}")` 加 `ticket_id: int` 定义**路径参数**,知道传 `abc` 时为什么是 422、422 的报错 JSON 怎么读。
3. 用函数参数的默认值定义**查询参数**,会写可选参数、带默认值的参数和只允许几个取值的参数(`Literal`)。
4. 认出三个坑:固定路径写在 `{ticket_id}` 后面会被吞掉;`/tickets/` 末尾的斜杠会被 307 重定向;命令行里中文查询参数要编码。

今天两个新概念:**路径参数**和**查询参数**,都是从「函数参数 + 类型标注」里来的。路由的概念昨天已经学过,今天只是换了写法。

预计用时:2.5 小时。花费 ¥0。

前置:[Day 78](/blog/agent-zero/day-078-server-2/) 的 `mini_server.py` 和路由、处理函数;[Day 77](/blog/agent-zero/day-077-server-1/) 的端口和 `lsof`;[Day 45](/blog/agent-zero/day-045-type-hints-1/)、[Day 46](/blog/agent-zero/day-046-type-hints-2/)、[Day 47](/blog/agent-zero/day-047-type-hints-3/) 的类型标注、`X | None` 和 `Literal`;[Day 51](/blog/agent-zero/day-051-pydantic-1/) 的 pydantic 和 ValidationError;[Day 74](/blog/agent-zero/day-074-pytest-4/) 的测试思路。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `part01/tickets_api.py` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## FastAPI 和 uvicorn 是什么关系

先对一下昨天的代码。`mini_server.py` 里其实是两样东西拼在一起的:

- `HTTPServer(("127.0.0.1", 8000), Handler).serve_forever()`:占住端口、接住连接、把字节读进来写出去,这是**服务器**。
- `route`、`ROUTES`、处理函数、`reply` 里拼 JSON:决定「这个请求该怎么回」,这是**应用**。

Python 这边把这两样拆成了两个包:

| 昨天手写的 | 今天用的包 | Node 里对应的 |
| --- | --- | --- |
| `HTTPServer` + `serve_forever` | **uvicorn**,一个服务器程序 | Node 内置的 `http.createServer` + `listen` |
| `route` + 处理函数 + `reply` | **FastAPI**,一个 Web 框架 | Express |

Express 里你写 `app.listen(3000)`,服务器和框架看起来是一体的。Python 这边分开:你用 FastAPI 写一个 `app` 对象,然后告诉 uvicorn「去跑这个 app」。两者之间按一个叫 **ASGI** 的约定交接:uvicorn 把收到的请求整理成约定好的格式交给 app,app 返回响应,uvicorn 再发出去。现在只要知道:**进程和端口是 uvicorn 的事(Day 77 的内容),路由和处理函数是 FastAPI 的事(Day 78 的内容)**。

装上两个包。在仓库根目录 `/Users/你/agent-zero-lab`:

```bash
uv add fastapi uvicorn
```

我 2026 年 10 月 22 日装到的是 `fastapi==0.159.1`(前一天刚发布)和 `uvicorn==0.54.0`,uv 顺带装了 starlette、pydantic 等依赖。FastAPI 底层用 starlette 处理 HTTP、用 pydantic 做校验,pydantic 你 Day 51 已经用过了。你装的时候版本号可能更新,这两个包更新很勤,不影响今天的内容。

FastAPI 官方文档里更常见的装法是 `uv add "fastapi[standard]"`,它会多装一个 `fastapi` 命令行工具和一些可选依赖,可以用 `fastapi dev` 启动。我这里只装最少的两个包,直接用 uvicorn 启动,这样每个参数是干什么的都看得见。

## 第 1 步:最小的 FastAPI 应用

新建 `part01/hello_api.py`:

```python
# agent-zero-lab/part01/hello_api.py
from fastapi import FastAPI

app = FastAPI()


@app.get("/")
def index():
    return {"service": "cloudledger-tickets", "message": "你好,这是 FastAPI"}
```

<div class="line-notes">

- `from fastapi import FastAPI` 导入框架的核心类。
- `app = FastAPI()` 建一个应用对象,相当于 Express 的 `const app = express()`。名字随意,但大家都叫 `app`,下面启动命令里要用到这个名字。
- `@app.get("/")` 登记一条路由:GET 方法、路径 `/`,交给下面紧挨着的那个函数处理。`@` 开头的这一行叫**装饰器**,它到底怎么工作要到 Day 96 才拆开讲,现在把它读成「把下面这个函数登记到路由表里」就够了。它做的事和昨天 `ROUTES = {"/": index}` 那一行一样,只是写在了函数头上。
- `def index():` 处理函数。用普通的 `def` 就行,FastAPI 也支持 `async def`(Day 67 学的),函数里没有要 `await` 的东西时两种都可以,今天全用 `def`。
- `return {"service": "cloudledger-tickets", "message": "你好,这是 FastAPI"}` 直接返回一个字典。FastAPI 会帮你做昨天 `reply` 里的全部工作:`json.dumps`、encode、算 `Content-Length`、设 `Content-Type`、写状态行(默认 200)。

</div>

启动(第一个窗口):

```bash
uv run uvicorn part01.hello_api:app --port 8000
```

<div class="line-notes">

- `uv run uvicorn` uvicorn 装好以后带了一个同名命令,`uv run` 在虚拟环境里运行它。<br>`part01.hello_api:app`:冒号前面是模块路径,和 `-m part01.hello_api` 的写法一样,从仓库根目录算;冒号后面是模块里那个应用对象的变量名。意思是「导入 `part01.hello_api`,找到里面叫 `app` 的东西,跑它」。<br>`--port 8000`:监听的端口。不写默认也是 8000。

</div>

实跑输出:

```text
INFO:     Started server process [47708]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
```

`Started server process [47708]`:47708 是 PID,Day 77 的进程。`Uvicorn running on http://127.0.0.1:8000`:注意它**默认绑的是 127.0.0.1**,不像 `python -m http.server` 默认绑所有接口。我用 `lsof -nP -iTCP:8000 -sTCP:LISTEN` 确认了一下,NAME 列是 `TCP 127.0.0.1:8000 (LISTEN)`。uvicorn 替你选了安全的那个,真要给别的机器访问时才加 `--host 0.0.0.0`。

第二个窗口:

```bash
curl -v http://127.0.0.1:8000/
```

实跑输出(去掉了 `*` 开头的连接信息):

```text
> GET / HTTP/1.1
> Host: 127.0.0.1:8000
> User-Agent: curl/8.1.2
> Accept: */*
>
< HTTP/1.1 200 OK
< date: Thu, 22 Oct 2026 05:28:17 GMT
< server: uvicorn
< content-length: 67
< content-type: application/json
<
{"service":"cloudledger-tickets","message":"你好,这是 FastAPI"}
```

和昨天 `mini_server.py` 的响应比一下:状态行、`content-length`(67,按字节算的,对的)、`content-type: application/json` 都有了,这些都是我们没写的。还有两个小差别:头的名字是小写(HTTP 规定头名不区分大小写,所以 `Content-Type` 和 `content-type` 是一回事);JSON 是紧凑格式,冒号和逗号后面没有空格,比 `json.dumps` 默认的输出短一点。

再试两个我们没写的情况:

```bash
curl -s -w "  [%{http_code}]\n" http://127.0.0.1:8000/nope
curl -s -X POST -w "  [%{http_code}]\n" http://127.0.0.1:8000/
```

实跑输出:

```text
{"detail":"Not Found"}  [404]
{"detail":"Method Not Allowed"}  [405]
```

路径不存在,自动 404;路径存在但方法不对,自动 405。昨天这两条我们是在 `route` 里手写的,练习 4 为了区分 404 和 405 还专门遍历了一遍路由表。FastAPI 的错误格式统一是 `{"detail": ...}`,后面你会一直看到这个 `detail`。

服务器窗口的访问日志:

```text
INFO:     127.0.0.1:63975 - "GET / HTTP/1.1" 200 OK
INFO:     127.0.0.1:63978 - "GET /nope HTTP/1.1" 404 Not Found
INFO:     127.0.0.1:63979 - "POST / HTTP/1.1" 405 Method Not Allowed
```

格式变了,内容还是那几样:谁(带着客户端的临时端口)、什么请求、什么状态码。另外,浏览器打开 `http://127.0.0.1:8000/docs` 会看到一个自动生成的接口文档页面,这个明天细讲。

试完 Ctrl+C 停掉。

## 第 2 步:路径参数,`/tickets/{ticket_id}`

把昨天的工单服务搬过来。新建 `part01/tickets_api.py`,先写列表和单张两个接口:

```python
# agent-zero-lab/part01/tickets_api.py
from typing import Any

from fastapi import FastAPI, HTTPException

app = FastAPI(title="CloudLedger 工单服务")

TICKETS: list[dict[str, Any]] = [
    {"id": 1001, "title": "发票抬头开错了", "status": "open"},
    {"id": 1002, "title": "同一个月被扣了两次款", "status": "open"},
    {"id": 1003, "title": "想从基础版升级到专业版", "status": "closed"},
]


@app.get("/")
def index():
    return {"service": "cloudledger-tickets", "routes": ["/tickets", "/tickets/{ticket_id}"]}


@app.get("/tickets")
def list_tickets():
    return {"count": len(TICKETS), "items": TICKETS}


@app.get("/tickets/{ticket_id}")
def get_ticket(ticket_id: int):
    for t in TICKETS:
        if t["id"] == ticket_id:
            return t
    raise HTTPException(status_code=404, detail=f"没有这张工单: {ticket_id}")
```

<div class="line-notes">

- `from fastapi import FastAPI, HTTPException` `HTTPException` 是用来「回一个错误状态码」的异常,下面用到。
- `app = FastAPI(title="CloudLedger 工单服务")` `title` 会显示在明天的自动文档页面上,不影响行为。
- `TICKETS: list[dict[str, Any]] = [` 和昨天一模一样的三张工单。
- `@app.get("/tickets")` 列表接口,先不带查询参数,第 3 步加。
- `@app.get("/tickets/{ticket_id}")` 路径里用花括号挖一个洞,名字叫 `ticket_id`。昨天练习 4 想写却写不进路由表的就是这种模板,Express 里写作 `/tickets/:ticketId`。
- `def get_ticket(ticket_id: int):` 关键在这里:**函数参数的名字和花括号里的名字一样**,FastAPI 就把路径里那一截的值传进来;**类型标注写 `int`**,它就先把字符串 `"1002"` 转成整数 `1002` 再传给你,转不了就直接回 422,根本不会调用你的函数。昨天 `get_ticket` 里的 `isdigit()` 检查和 `int(raw_id)`,这里一行都不用写。
- `if t["id"] == ticket_id:` `ticket_id` 已经是 int,可以直接和工单的 `id`(也是 int)比较。
- `return t` 找到了,返回这张工单的字典,FastAPI 转成 JSON。
- `raise HTTPException(status_code=404, detail=f"没有这张工单: {ticket_id}")` 找不到时**抛**一个异常,FastAPI 接住它,回 404,body 是 `{"detail": "没有这张工单: 9999"}`。用 `raise` 而不是 `return`,是因为 return 的东西会被当成 200 的正常数据。错误处理的更多写法在 Day 81 讲。

</div>

这次启动加一个 `--reload`:

```bash
uv run uvicorn part01.tickets_api:app --port 8000 --reload
```

<div class="line-notes">

- `--reload` 盯着代码文件,一保存就自动重启服务,相当于 Vite 的热更新(虽然没那么快,它是整个进程重启)。开发时一定要加,不然每改一次都得 Ctrl+C 再启动。部署到线上时不要加。

</div>

实跑输出的前几行:

```text
INFO:     Will watch for changes in these directories: ['/Users/你/agent-zero-lab']
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
INFO:     Started reloader process [47937] using StatReload
INFO:     Started server process [47939]
```

两个 PID:47937 是**监工**进程,负责盯着文件变化;47939 是真正处理请求的**干活**进程,监工发现文件改了就把它停掉再起一个新的。Day 77 的父子进程又出现了。

第二个窗口请求三种工单号:

```bash
for p in /tickets/1002 /tickets/9999 /tickets/abc; do
  echo "== GET $p"
  curl -sS -w "  [%{http_code}]\n" "http://127.0.0.1:8000$p"
done
```

实跑输出:

```text
== GET /tickets/1002
{"id":1002,"title":"同一个月被扣了两次款","status":"open"}  [200]
== GET /tickets/9999
{"detail":"没有这张工单: 9999"}  [404]
== GET /tickets/abc
{"detail":[{"type":"int_parsing","loc":["path","ticket_id"],"msg":"Input should be a valid integer, unable to parse string as an integer","input":"abc"}]}  [422]
```

前两条和昨天一样。第三条不一样:昨天我们手写的是 400,FastAPI 回的是 **422**,body 也长得完全不同。

### 读懂 422

422 Unprocessable Entity(或者叫 Unprocessable Content),意思是「请求的格式没毛病,但里面的数据不符合要求」。FastAPI 的约定是:**参数校验没通过,一律 422**。body 里 `detail` 是一个列表,每个元素是一处错误,把那一行展开看:

```json
{
  "type": "int_parsing",
  "loc": ["path", "ticket_id"],
  "msg": "Input should be a valid integer, unable to parse string as an integer",
  "input": "abc"
}
```

<div class="line-notes">

- `"type": "int_parsing",` 错误的种类:解析整数失败。程序要判断是哪种错误时看它。
- `"loc": ["path", "ticket_id"],` 出错的位置(location):在**路径**里,叫 `ticket_id` 的那个参数。第一个元素会是 `path`、`query`、`body` 之一,一眼就知道是哪部分出的问题。
- `"msg": "Input should be a valid integer, unable to parse string as an integer",` 给人看的说明。
- `"input": "abc"` 实际收到的值。

</div>

这个格式你见过。Day 51 用 pydantic 校验工单表单,`ValidationError` 里也是 type、loc、msg、input 这几样,因为 FastAPI 背后用的就是 pydantic。你写的类型标注被 FastAPI 交给 pydantic 去校验,校验失败的报告原样变成了 422 的 body。

对前端来说这是好事:一个统一的格式,`loc` 告诉你是哪个字段,表单可以直接把错误标在对应的输入框下面。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="同一个请求在昨天的手写服务和 FastAPI 里分别由谁处理">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink)">GET /tickets/abc</text>
<text x="200" y="28" fill="var(--ink-soft)">Day 78 手写</text>
<text x="430" y="28" fill="var(--ink-soft)">Day 79 FastAPI</text>
<text x="20" y="66" fill="var(--ink-soft)">占端口、收发字节</text>
<rect x="190" y="48" width="200" height="28" fill="var(--paper-raised)" stroke="var(--rule)" rx="4"/>
<text x="200" y="67" fill="var(--ink)">HTTPServer</text>
<rect x="420" y="48" width="200" height="28" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="430" y="67" fill="var(--ink)">uvicorn</text>
<text x="20" y="108" fill="var(--ink-soft)">按路径找函数</text>
<rect x="190" y="90" width="200" height="28" fill="var(--paper-raised)" stroke="var(--rule)" rx="4"/>
<text x="200" y="109" fill="var(--ink)">ROUTES + startswith</text>
<rect x="420" y="90" width="200" height="28" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="430" y="109" fill="var(--ink)">@app.get 模板匹配</text>
<text x="20" y="150" fill="var(--ink-soft)">取参数、转类型、校验</text>
<rect x="190" y="132" width="200" height="28" fill="var(--paper-raised)" stroke="var(--rule)" rx="4"/>
<text x="200" y="151" fill="var(--ink)">isdigit + int() → 400</text>
<rect x="420" y="132" width="200" height="28" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="430" y="151" fill="var(--ink)">ticket_id: int → 422</text>
<text x="20" y="192" fill="var(--ink-soft)">业务逻辑</text>
<rect x="190" y="174" width="200" height="28" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
<text x="200" y="193" fill="var(--ink)">for t in TICKETS ...</text>
<rect x="420" y="174" width="200" height="28" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
<text x="430" y="193" fill="var(--ink)">for t in TICKETS ...</text>
<text x="20" y="234" fill="var(--ink-soft)">拼 JSON 响应</text>
<rect x="190" y="216" width="200" height="28" fill="var(--paper-raised)" stroke="var(--rule)" rx="4"/>
<text x="200" y="235" fill="var(--ink)">reply() 四步</text>
<rect x="420" y="216" width="200" height="28" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="430" y="235" fill="var(--ink)">return 字典</text>
</g>
</svg>
<figcaption>一次请求经过的五层。右边琥珀色的四层都由 uvicorn 和 FastAPI 接手了,你写的只剩蓝色那一层业务逻辑,它和昨天几乎一字不差。</figcaption>
</figure>

## 第 3 步:查询参数,写成带默认值的函数参数

给列表接口加两个查询参数:`status` 按状态筛选,`limit` 最多返回几条。改 `list_tickets`,同时把第一行的 import 改成 `from typing import Any, Literal`:

```python
# agent-zero-lab/part01/tickets_api.py(改过的 import 和 list_tickets)
from typing import Any, Literal


@app.get("/tickets")
def list_tickets(status: Literal["open", "closed"] | None = None, limit: int = 10):
    items = [t for t in TICKETS if status is None or t["status"] == status]
    return {"count": len(items[:limit]), "items": items[:limit]}
```

<div class="line-notes">

- `from typing import Any, Literal` Day 47 学的 `Literal`:值只能是列出来的那几个。
- `def list_tickets(status: Literal["open", "closed"] | None = None, limit: int = 10):` FastAPI 的规则很简单:**不在路径花括号里的参数,就是查询参数**。`status` 只能是 `"open"` 或 `"closed"`,`| None = None` 表示可以不传,不传就是 `None`。`limit` 是整数,不传默认 10。查询参数从 URL 里拿到时都是字符串(昨天的 `parse_qs` 实验),这里同样按类型标注转换和校验。
- `items = [t for t in TICKETS if status is None or t["status"] == status]` 和昨天的 `list_tickets` 一模一样,只是 `status` 不用再从 `query.get("status", [None])[0]` 里抠出来了。
- `return {"count": len(items[:limit]), "items": items[:limit]}` `items[:limit]` 是切片(Day 15),取前 `limit` 个。

</div>

保存。因为开着 `--reload`,服务器窗口会自动重启,不用你动手(我实跑时看到 `WARNING:  StatReload detected changes in 'part01/tickets_api.py'. Reloading...`)。第二个窗口:

```bash
for p in "/tickets?status=closed" "/tickets?limit=1" "/tickets?status=pending" "/tickets?limit=abc" "/tickets?Status=closed"; do
  echo "== GET $p"
  curl -sS -w "  [%{http_code}]\n" "http://127.0.0.1:8000$p"
done
```

实跑输出:

```text
== GET /tickets?status=closed
{"count":1,"items":[{"id":1003,"title":"想从基础版升级到专业版","status":"closed"}]}  [200]
== GET /tickets?limit=1
{"count":1,"items":[{"id":1001,"title":"发票抬头开错了","status":"open"}]}  [200]
== GET /tickets?status=pending
{"detail":[{"type":"literal_error","loc":["query","status"],"msg":"Input should be 'open' or 'closed'","input":"pending","ctx":{"expected":"'open' or 'closed'"}}]}  [422]
== GET /tickets?limit=abc
{"detail":[{"type":"int_parsing","loc":["query","limit"],"msg":"Input should be a valid integer, unable to parse string as an integer","input":"abc"}]}  [422]
== GET /tickets?Status=closed
{"count":3,"items":[{"id":1001,"title":"发票抬头开错了","status":"open"},{"id":1002,"title":"同一个月被扣了两次款","status":"open"},{"id":1003,"title":"想从基础版升级到专业版","status":"closed"}]}  [200]
```

前两条正常。`status=pending` 不在 `Literal` 允许的两个值里,422,`loc` 是 `["query", "status"]`,告诉你是查询参数 `status` 有问题,`ctx` 里还给了期望值。`limit=abc` 不是整数,422。昨天的 `mini_server.py` 碰到 `status=pending` 会怎样?它根本不检查,会返回 200 和一个空列表,前端以为「没有待处理的工单」,其实是传错了。能在入口就把错误挡住,是类型标注带来的实在好处。

最后一条值得多看一眼:我把 `status` 写成了大写开头的 `Status`,返回了全部 3 张,状态码 200。**查询参数的名字区分大小写**,`Status` 和 `status` 是两个不同的参数;FastAPI 不认识 `Status`,就当它不存在(和昨天练习 2 里多余的 `verbose=1` 一样被忽略),而 `status` 没传,于是不筛选。这种错误不会有任何报错,只能靠你自己细心。

### 路径参数和查询参数怎么选

两种参数都能把一个值传给服务器,用哪个有个通行的习惯:

| | 路径参数 | 查询参数 |
| --- | --- | --- |
| 样子 | `/tickets/1002` | `/tickets?status=open&limit=2` |
| 表示 | **哪一个**资源,定位用 | **怎么看**一组资源:筛选、排序、分页 |
| 能不能省 | 不能,省了就是另一个路径 | 通常可以,有默认值 |
| FastAPI 里 | 名字出现在路径的 `{}` 里 | 其余的简单类型参数 |

像 `/tickets?id=1002` 这样用查询参数定位一张工单也能跑,但不符合 REST 的习惯(Day 63 讲过),别人读你的接口会觉得别扭。

## 第 4 步:路由的顺序

加一个统计接口 `GET /tickets/stats`,返回总数和未处理的数量。我先把它加在文件**最后面**,也就是 `get_ticket` 的下面:

```python
# agent-zero-lab/part01/tickets_api.py(先加在文件末尾,马上会发现有问题)
@app.get("/tickets/stats")
def ticket_stats():
    open_count = sum(1 for t in TICKETS if t["status"] == "open")
    return {"total": len(TICKETS), "open": open_count}
```

<div class="line-notes">

- `@app.get("/tickets/stats")` 一个固定的路径,里面没有花括号。
- `open_count = sum(1 for t in TICKETS if t["status"] == "open")` 每张未处理的工单记一个 1,加起来。这是生成器表达式(Day 99 细讲),先当成「不带方括号的列表推导式」读。
- `return {"total": len(TICKETS), "open": open_count}` 总数 3,未处理 2。

</div>

保存,自动重载后请求:

```bash
curl -sS -w "  [%{http_code}]\n" http://127.0.0.1:8000/tickets/stats
```

实跑输出:

```text
{"detail":[{"type":"int_parsing","loc":["path","ticket_id"],"msg":"Input should be a valid integer, unable to parse string as an integer","input":"stats"}]}  [422]
```

请求根本没进 `ticket_stats`。看 `loc`:`["path", "ticket_id"]`,`input` 是 `"stats"`,它进了 `get_ticket`。原因是 **FastAPI 按登记的先后顺序一条条匹配路由,用第一条匹配上的**。`/tickets/{ticket_id}` 写在前面,它的模板能匹配任何 `/tickets/xxx`,`stats` 就被当成了一个工单号,然后在转 int 时失败。

修法:**固定路径写在带参数的路径前面**。把 `ticket_stats` 挪到 `get_ticket` 上面。现在整个文件是这样:

```python
# agent-zero-lab/part01/tickets_api.py
from typing import Any, Literal

from fastapi import FastAPI, HTTPException

app = FastAPI(title="CloudLedger 工单服务")

TICKETS: list[dict[str, Any]] = [
    {"id": 1001, "title": "发票抬头开错了", "status": "open"},
    {"id": 1002, "title": "同一个月被扣了两次款", "status": "open"},
    {"id": 1003, "title": "想从基础版升级到专业版", "status": "closed"},
]


@app.get("/")
def index():
    return {"service": "cloudledger-tickets", "routes": ["/tickets", "/tickets/stats", "/tickets/{ticket_id}"]}


@app.get("/tickets")
def list_tickets(status: Literal["open", "closed"] | None = None, limit: int = 10):
    items = [t for t in TICKETS if status is None or t["status"] == status]
    return {"count": len(items[:limit]), "items": items[:limit]}


@app.get("/tickets/stats")
def ticket_stats():
    open_count = sum(1 for t in TICKETS if t["status"] == "open")
    return {"total": len(TICKETS), "open": open_count}


@app.get("/tickets/{ticket_id}")
def get_ticket(ticket_id: int):
    for t in TICKETS:
        if t["id"] == ticket_id:
            return t
    raise HTTPException(status_code=404, detail=f"没有这张工单: {ticket_id}")
```

<div class="line-notes">

- `return {"service": "cloudledger-tickets", "routes": ["/tickets", "/tickets/stats", "/tickets/{ticket_id}"]}` 首页的路由清单也加上新接口。
- `@app.get("/tickets/stats")` 固定路径,在前面。
- `@app.get("/tickets/{ticket_id}")` 带参数的「兜底」路径,在后面。

</div>

保存后再请求:

```bash
curl -sS -w "  [%{http_code}]\n" http://127.0.0.1:8000/tickets/stats
curl -sS -w "  [%{http_code}]\n" http://127.0.0.1:8000/tickets/1001
```

实跑输出:

```text
{"total":3,"open":2}  [200]
{"id":1001,"title":"发票抬头开错了","status":"open"}  [200]
```

都对了。这个坑在 Express 里一模一样,`app.get('/tickets/:id')` 写在 `app.get('/tickets/stats')` 前面也会吞掉它。我用 basedpyright(standard 档)检查这个文件是 `0 errors, 0 warnings, 0 notes`。

## 第 5 步:两个不是你代码引起的现象

### 末尾斜杠:307 重定向

昨天手写的服务器里,`/tickets/` 是 404。FastAPI 呢?

```bash
curl -sI http://127.0.0.1:8000/tickets/
```

<div class="line-notes">

- `curl -sI` `-I` 只要响应头,不要 body。

</div>

实跑输出的两行:

```text
HTTP/1.1 307 Temporary Redirect
location: http://127.0.0.1:8000/tickets
```

FastAPI(准确说是它底下的 starlette)发现你多写了一个斜杠,而 `/tickets` 是存在的,就回一个 307 **重定向**,`location` 头告诉你「去这个地址」。浏览器和 `fetch` 会自动跟着跳过去,所以平时你察觉不到;但 curl 默认不跟,所以 `curl -s .../tickets/` 只会打印一个空 body。加 `-L` 让 curl 跟随重定向就能拿到列表。有时候这个重定向会带来麻烦(比如重定向的地址用了内网地址,或者 POST 请求被重定向),所以前端调用时最好直接写对路径,别依赖它。

### URL 里的中文:uvicorn 直接拒收

昨天练习 3 发现 `http.server` 收到没编码的中文会变成乱码。uvicorn 严格得多。服务器开着时直接把中文写进 URL:

```bash
curl -s -w " [%{http_code}]\n" "http://127.0.0.1:8000/tickets?status=开"
```

实跑输出:

```text
Invalid HTTP request received. [400]
```

服务器窗口里是 `WARNING:  Invalid HTTP request received.`。请求行里出现了非 ASCII 的字节,uvicorn 认为这根本不是合法的 HTTP 请求,还没交给 FastAPI 就直接回了 400。这比昨天「200 加空列表」好,至少你知道请求坏了。正确做法还是昨天的 `curl -G --data-urlencode "status=开" ...`,浏览器和 `fetch` 会自动编码,不用操心。

试完 Ctrl+C 停掉服务器。

## 零件和成品的对照

| 昨天 `mini_server.py` 里的 | 今天 `tickets_api.py` 里的 | 谁在做 |
| --- | --- | --- |
| `HTTPServer(("127.0.0.1", 8000), Handler).serve_forever()` | `uvicorn part01.tickets_api:app --port 8000` | uvicorn |
| `ROUTES = {"/": index, ...}` + `route()` | 每个函数头上的 `@app.get(路径)` | FastAPI |
| `parts.path.startswith("/tickets/")` + `removeprefix` | `"/tickets/{ticket_id}"` 路径模板 | FastAPI |
| `isdigit()` 检查 + `int(raw_id)` + 回 400 | `ticket_id: int`,不合法回 422 | FastAPI + pydantic |
| `query.get("status", [None])[0]` | `status: Literal["open", "closed"] \| None = None` | FastAPI + pydantic |
| `if method != "GET": return 405` + 都不匹配回 404 | 自动 405、自动 404 | FastAPI |
| `reply()`:`json.dumps`、encode、`Content-Length`、四个调用 | `return 字典` | FastAPI |
| `get_ticket` 里的 `for t in TICKETS` | `get_ticket` 里的 `for t in TICKETS` | **你** |

最后一行是重点:框架接走的是每个服务都一样的那部分,业务逻辑还得你写。昨天把 `route` 和处理函数从网络代码里分出来,今天换框架时处理函数的主体几乎没动。

## 动手练习

**练习 1:用 TestClient 写测试。** 昨天测 `route` 用的是「字符串进、元组出」。FastAPI 自带一个 `TestClient`,能在不启动 uvicorn、不占端口的情况下,把请求直接交给 `app` 处理。新建 `tests/test_tickets_api.py`,测五件事:`/tickets/1002` 返回正确标题;`/tickets/9999` 是 404 且 body 是 `{"detail": "没有这张工单: 9999"}`;`/tickets/abc` 是 422 且 `loc` 指向路径里的 `ticket_id`;`status=open&limit=1` 只返回 1001;`/tickets/stats` 没有被 `{ticket_id}` 吞掉。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/tests/test_tickets_api.py
from fastapi.testclient import TestClient

from part01.tickets_api import app

client = TestClient(app)


def test_get_ticket_ok():
    resp = client.get("/tickets/1002")
    assert resp.status_code == 200
    assert resp.json()["title"] == "同一个月被扣了两次款"


def test_get_ticket_not_found():
    resp = client.get("/tickets/9999")
    assert resp.status_code == 404
    assert resp.json() == {"detail": "没有这张工单: 9999"}


def test_ticket_id_must_be_int():
    resp = client.get("/tickets/abc")
    assert resp.status_code == 422
    print(resp.json())
    assert resp.json()["detail"][0]["loc"] == ["path", "ticket_id"]


def test_filter_and_limit():
    resp = client.get("/tickets", params={"status": "open", "limit": 1})
    assert resp.json() == {"count": 1, "items": [{"id": 1001, "title": "发票抬头开错了", "status": "open"}]}


def test_stats_not_swallowed_by_ticket_id():
    assert client.get("/tickets/stats").json() == {"total": 3, "open": 2}
```

<div class="line-notes">

- `from fastapi.testclient import TestClient` FastAPI 自带的测试客户端,用法和 Day 64 的 httpx 几乎一样(`.get`、`.status_code`、`.json()`)。
- `from part01.tickets_api import app` 导入应用对象。和昨天一样,导入时不会启动服务器,因为启动是 uvicorn 的事。
- `client = TestClient(app)` 包一层。之后 `client.get(...)` 发出的请求不走网络,直接在内存里交给 `app`。
- `resp = client.get("/tickets/1002")` 路径从 `/` 开始写,不用写域名和端口。
- `assert resp.json() == {"detail": "没有这张工单: 9999"}` `HTTPException` 的 `detail` 原样出现在 body 里。
- `print(resp.json())` 配合 `-s` 看看完整的 422 长什么样。
- `assert resp.json()["detail"][0]["loc"] == ["path", "ticket_id"]` 只断言最稳定的 `loc`,不断言英文 `msg` 原文,因为 pydantic 升级时提示文字可能会微调,测试不该因为这个红。
- `resp = client.get("/tickets", params={"status": "open", "limit": 1})` 查询参数用 `params` 传字典,TestClient 负责拼成 `?status=open&limit=1` 并做好编码,中文也不用担心。
- `assert client.get("/tickets/stats").json() == {"total": 3, "open": 2}` 把第 4 步的顺序坑钉成一个测试,以后谁把路由顺序改错了,测试会红。

</div>

第一次跑 `uv run pytest tests/test_tickets_api.py -v -s`,5 个全过,但末尾多了一段警告(路径我缩短了):

```text
=============================== warnings summary ===============================
.venv/lib/python3.12/site-packages/fastapi/testclient.py:1
  .../fastapi/testclient.py:1: StarletteDeprecationWarning: Using `httpx` with `starlette.testclient` is deprecated; install `httpx2` instead.
    from starlette.testclient import TestClient as TestClient  # noqa
```

这是 2026 年的新情况:据 starlette 的发布说明,1.2.0(2026 年 5 月)开始 TestClient 支持一个新包 `httpx2`(仓库在 GitHub 的 pydantic 组织下,PyPI 上自称「下一代 HTTP 客户端」),我在 `.venv` 里的 `starlette/testclient.py` 看到它现在是先找 `httpx2`,找不到才退回 `httpx` 并给出这个弃用警告。测试照样能跑,但按它说的装上就干净了:

```bash
uv add --dev httpx2
uv run pytest tests/test_tickets_api.py -v
```

<div class="line-notes">

- `uv add --dev httpx2` 只有测试用到,装成开发依赖(Day 71 的 `--dev`)。我装到的是 `httpx2==2.16.0`。我们的天气工具 `weather_cli.py` 用的还是 `httpx`,两个包互不影响。

</div>

实跑输出(行尾百分比删了):

```text
tests/test_tickets_api.py::test_get_ticket_ok PASSED
tests/test_tickets_api.py::test_get_ticket_not_found PASSED
tests/test_tickets_api.py::test_ticket_id_must_be_int PASSED
tests/test_tickets_api.py::test_filter_and_limit PASSED
tests/test_tickets_api.py::test_stats_not_swallowed_by_ticket_id PASSED
============================== 5 passed in 0.47s ===============================
```

警告没了。`-s` 时打印出来的那个 422 是:

```text
{'detail': [{'type': 'int_parsing', 'loc': ['path', 'ticket_id'], 'msg': 'Input should be a valid integer, unable to parse string as an integer', 'input': 'abc'}]}
```

</details>

**练习 2:必填的查询参数和路由顺序。** 加一个搜索接口 `GET /tickets/search?q=关键词`,返回标题里包含关键词的工单,`q` 必须传。写完用 TestClient 验证:搜「发票」只返回 1001;不传 `q` 是 422,`type` 是 `missing`。想一想这个路由应该写在文件的什么位置。

<details><summary>参考答案</summary>

写在 `ticket_stats` 和 `get_ticket` 之间,也就是**一定要在 `/tickets/{ticket_id}` 前面**,原因和第 4 步一样:

```python
# agent-zero-lab/part01/tickets_api.py(新增,放在 get_ticket 前面)
@app.get("/tickets/search")
def search_tickets(q: str):
    hits = [t for t in TICKETS if q in t["title"]]
    return {"q": q, "count": len(hits), "items": hits}
```

<div class="line-notes">

- `@app.get("/tickets/search")` 固定路径,放在带参数的路径之前。
- `def search_tickets(q: str):` **没有默认值的查询参数就是必填的**。对比 `limit: int = 10` 有默认值,所以可选。规则和普通 Python 函数一样:有默认值的参数调用时可以不传。
- `hits = [t for t in TICKETS if q in t["title"]]` `in` 判断子串(Day 16),「发票」在「发票抬头开错了」里。

</div>

测试追加到新文件 `tests/test_ex79.py`:

```python
# agent-zero-lab/tests/test_ex79.py
from fastapi.testclient import TestClient

from part01.tickets_api import app

client = TestClient(app)


def test_search_hits():
    resp = client.get("/tickets/search", params={"q": "发票"})
    assert resp.status_code == 200
    assert [t["id"] for t in resp.json()["items"]] == [1001]


def test_search_requires_q():
    resp = client.get("/tickets/search")
    assert resp.status_code == 422
    assert resp.json()["detail"][0]["type"] == "missing"
```

<div class="line-notes">

- `resp = client.get("/tickets/search", params={"q": "发票"})` 中文通过 `params` 传,TestClient 会编码,不会碰到第 5 步的 400。
- `assert [t["id"] for t in resp.json()["items"]] == [1001]` 只看 id 列表。
- `resp = client.get("/tickets/search")` 故意不传 q。
- `assert resp.json()["detail"][0]["type"] == "missing"` 缺必填参数时的错误种类。

</div>

`uv run pytest tests/test_ex79.py -q` 实跑两条都过。不传 `q` 时完整的 422 body 是 `{'detail': [{'type': 'missing', 'loc': ['query', 'q'], 'msg': 'Field required', 'input': None}]}`。用 curl 手动验证时,记得 `curl -s -G --data-urlencode "q=发票" http://127.0.0.1:8000/tickets/search`,实跑返回 `{"q":"发票","count":1,"items":[{"id":1001,"title":"发票抬头开错了","status":"open"}]}`。

如果你把它写在了 `get_ticket` 后面,`/tickets/search` 会和第 4 步一样被当成工单号,得到一个 `input` 为 `"search"` 的 422。

</details>

**练习 3:limit 的 bug。** 请求 `/tickets?limit=-1`,看看返回几张工单,解释原因;然后限制 `limit` 只能是 1 到 50,超出范围回 422。提示:FastAPI 的 `Query` 能给查询参数加约束,和 Day 52 的 pydantic `Field` 是一个路子。

<details><summary>参考答案</summary>

先看 bug。服务器开着时实跑 `curl -s "http://127.0.0.1:8000/tickets?limit=-1"`:

```text
{"count":2,"items":[{"id":1001,"title":"发票抬头开错了","status":"open"},{"id":1002,"title":"同一个月被扣了两次款","status":"open"}]}
```

要「最多 -1 条」,结果返回了 2 条。因为 `-1` 是个合法的整数,类型校验放行了;`items[:-1]` 在 Python 里的意思是「去掉最后一个」(Day 15 的负数切片),3 张变 2 张。`limit=0` 返回空列表,倒是符合字面意思。类型对不代表值合理,范围要另外约束。

改 `list_tickets`,import 一并改:

```python
# agent-zero-lab/part01/tickets_api.py(改过的 import 和 list_tickets)
from typing import Annotated, Any, Literal

from fastapi import FastAPI, HTTPException, Query


@app.get("/tickets")
def list_tickets(status: Literal["open", "closed"] | None = None, limit: Annotated[int, Query(ge=1, le=50)] = 10):
    items = [t for t in TICKETS if status is None or t["status"] == status]
    return {"count": len(items[:limit]), "items": items[:limit]}
```

<div class="line-notes">

- `from typing import Annotated, Any, Literal` `Annotated` 是标准库 typing 里的一个工具:给类型「附加一点额外信息」。写法是 `Annotated[类型, 附加信息]`,对类型检查器来说它就是前面那个类型。
- `from fastapi import FastAPI, HTTPException, Query` 导入 `Query`。
- `limit: Annotated[int, Query(ge=1, le=50)] = 10` 类型还是 `int`,附加的信息是 `Query(ge=1, le=50)`:它是一个查询参数,并且大于等于 1(ge,greater than or equal)、小于等于 50(le)。默认值 10 照旧写在等号后面。这是 FastAPI 文档目前推荐的写法;老教程里常见 `limit: int = Query(10, ge=1, le=50)`,也能用,看到别慌。

</div>

我在练习 2 的 `tests/test_ex79.py` 里追加了一个测试:

```python
# agent-zero-lab/tests/test_ex79.py(追加)
def test_limit_must_be_positive():
    resp = client.get("/tickets", params={"limit": -1})
    assert resp.status_code == 422
    print(resp.json()["detail"][0]["msg"])
```

<div class="line-notes">

- `resp = client.get("/tickets", params={"limit": -1})` 传 -1。
- `print(resp.json()["detail"][0]["msg"])` 看看提示文字。

</div>

`uv run pytest tests/test_ex79.py -q -s` 实跑 3 个全过,打印的是 `Input should be greater than or equal to 1`。用 curl 请求 `limit=51` 得到 `"type":"less_than_equal"` 的 422,`limit=50` 正常返回 3 张。

为什么要限上限?以后接口背后是数据库,有人传 `limit=1000000`,服务就会一次查出一百万行。对 Agent 服务更是这样,工具接口返回太多数据会直接撑爆模型的上下文。所有分页参数都应该有上限。

</details>

**练习 4(观察题):类型标注写错了会怎样。** 把 `get_ticket` 的参数改成 `ticket_id: str`,其他不动,请求 `/tickets/1001` 和 `/tickets/abc`,观察并解释。看完改回 `int`。

<details><summary>参考答案</summary>

实跑输出:

```text
{"detail":"没有这张工单: 1001"}  [404]
{"detail":"没有这张工单: abc"}  [404]
```

1001 明明存在,却是 404。标注成 `str`,FastAPI 就把 `"1001"` 原样作为字符串传进来;工单数据里的 `id` 是整数 `1001`,`"1001" == 1001` 在 Python 里是 `False`(和 JS 的 `"1001" === 1001` 一样,而且 Python 没有 `==` 的隐式转换),于是一张都匹配不上。`abc` 也不再是 422,而是 404,因为任何字符串都是合法的 `str`。

更麻烦的是,basedpyright 在 standard 档下对这个文件报 `0 errors`,类型检查器也没拦住,因为比较一个 `str` 和一个 `Any` 是允许的(`TICKETS` 里的值标的是 `Any`)。这说明在 FastAPI 里,**类型标注不只是给编辑器看的提示,它直接决定了运行时的转换和校验**。标错了,行为就错了。这也是练习 1 要把「1002 能查到」写成测试的原因。

</details>

**验收标准:** `uv run uvicorn part01.tickets_api:app --port 8000 --reload` 起来以后,`/tickets/1002` 是 200,`/tickets/9999` 是 404,`/tickets/abc` 是 422,`/tickets/stats` 是 200,`/tickets?status=pending` 是 422,`/tickets/search` 不带 q 是 422;`uv run pytest -q` 全绿且没有弃用警告;能不看文章说出 FastAPI 怎么区分路径参数和查询参数,以及为什么固定路径要写在 `{ticket_id}` 前面。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 框架(framework) | 把每个服务都要做的重复工作(路由、解析、校验、拼响应)写好的库,你只填业务逻辑。FastAPI ≈ Express |
| FastAPI | Python 的 Web 框架,用函数参数和类型标注定义接口,底层用 starlette 和 pydantic |
| uvicorn | 运行 FastAPI 应用的服务器程序,负责进程、端口、收发字节 |
| ASGI | Python 里服务器和框架之间的交接约定,uvicorn 和 FastAPI 按它配合 |
| `app` | `FastAPI()` 建出的应用对象,uvicorn 启动时用 `模块:app` 找到它 |
| `@app.get(路径)` | 装饰器,把下面的函数登记为这个 GET 路径的处理函数(原理 Day 96 讲) |
| 路径参数 | 路径模板 `{ticket_id}` 里的变量,函数里同名参数接收,按类型标注转换 |
| 查询参数 | 不在路径模板里的简单类型参数,来自 `?` 后面;有默认值就可选,没有就必填 |
| 422 Unprocessable Entity | 参数校验失败。FastAPI 的 body 是 `{"detail": [{type, loc, msg, input}]}` |
| `loc` | 422 里出错的位置,第一项是 `path`、`query` 或 `body`,第二项是参数名 |
| `HTTPException` | 抛出它让 FastAPI 回指定的状态码和 `{"detail": ...}` |
| `--reload` | uvicorn 开发模式,代码一改就重启进程 |
| 307 Temporary Redirect | 临时重定向,`location` 头给出新地址;多写末尾斜杠时会遇到 |
| `TestClient` | FastAPI 自带的测试客户端,不起服务器、不占端口,直接把请求交给 app |
| httpx2 | starlette 1.2 以后 TestClient 优先使用的 HTTP 客户端包,仓库在 pydantic 组织下 |
| `Annotated` / `Query` | 给参数类型附加约束的写法,如 `Annotated[int, Query(ge=1, le=50)]` |

## 常见误区

**固定路径写在带参数的路径后面。** FastAPI 按登记顺序匹配,`/tickets/{ticket_id}` 在前会吞掉 `/tickets/stats`,表现为一个 `input` 是 `"stats"` 的 422。固定路径放前面,并用一个测试钉住。

**以为 422 是服务器出错。** 422 是客户端传的参数不合格,4 开头就是客户端的问题。看 `detail` 里的 `loc` 和 `input` 就知道哪个参数传错了,别去翻服务端代码找 bug。

**把类型标注当成可有可无的注释。** 在 FastAPI 里,`ticket_id: int` 决定了转换和校验;写成 `str` 或者干脆不写(不写时按字符串处理),`1001` 就查不到了,练习 4 实测。

**查询参数名大小写写错。** `?Status=closed` 不会报错,只会被忽略,返回未筛选的全部数据。名字区分大小写。

**类型对了就以为值合理。** `limit=-1` 是合法的 int,却让切片去掉了最后一条。范围用 `Query(ge=..., le=...)` 约束,分页参数一定要有上限。

**用 `return` 返回错误。** `return {"detail": "没有这张工单"}` 的状态码是 200,前端会当成成功。错误要 `raise HTTPException(status_code=404, ...)`。

**`uvicorn` 启动时模块路径写错。** 要在仓库根目录运行,写 `part01.tickets_api:app`,冒号后面是变量名。写成 `part01/tickets_api.py:app`,实跑报 `ModuleNotFoundError: No module named 'part01/tickets_api'`;在 `part01/` 目录里运行,实跑报 `ModuleNotFoundError: No module named 'part01'`。

**线上也开着 `--reload`。** 它要额外起一个监工进程不停地检查文件,只适合开发。

**以为 curl 拿到空内容就是接口坏了。** 多写一个末尾斜杠时 FastAPI 回的是 307,curl 默认不跟随重定向,body 是空的。用 `curl -sI` 看状态码,或者加 `-L`。

## 学习资料

### 文档与文章

- [FastAPI 中文文档 · 第一步](https://fastapi.tiangolo.com/zh/tutorial/first-steps/):今天第 1 步对应的官方教程,讲了 `app`、路径操作装饰器和返回值。
- [FastAPI 中文文档 · 路径参数](https://fastapi.tiangolo.com/zh/tutorial/path-params/):类型转换、数据校验、路由顺序(「顺序很重要」那一节就是第 4 步的坑)、用枚举限定取值。
- [FastAPI 中文文档 · 查询参数](https://fastapi.tiangolo.com/zh/tutorial/query-params/):默认值、可选参数、必填参数,和第 3 步、练习 2 对应。
- [FastAPI 中文文档 · 查询参数和字符串校验](https://fastapi.tiangolo.com/zh/tutorial/query-params-str-validations/):`Annotated` 加 `Query` 的写法和各种约束,练习 3 用的就是这里的方法。
- [FastAPI 中文文档 · 测试](https://fastapi.tiangolo.com/zh/tutorial/testing/):`TestClient` 的用法,练习 1。
- [Uvicorn 文档 · Settings(英文)](https://uvicorn.dev/settings/):`--host`、`--port`、`--reload` 等全部启动参数。
- [MDN · 422 Unprocessable Content](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Reference/Status/422):422 状态码的标准含义。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1zV2QBtE39&autoplay=0&high_quality=1" title="黑马程序员PythonWeb开发:FastAPI从入门到实战视频教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>黑马程序员 · FastAPI 从入门到实战视频教程 · 共 68 P,2025 年底发布,播放量很高。今天看第 3 P「第一个 FastAPI 程序」、第 4 P「路由」、第 5–7 P「路径参数」和「查询参数和 Query 类型注解」,每 P 十分钟左右。第 8 P 起是明天的请求体。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV135ahe2E9X&autoplay=0&high_quality=1" title="06. 运行状态检查:FastAPI的路径与查询参数" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>玩代码的预测师 · 06. 运行状态检查:FastAPI的路径与查询参数 · 18 分钟。用一个小例子同时演示路径参数和查询参数,和第 2、3 步一一对应。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/7AMjmCTumuo" title="Python FastAPI Tutorial (Part 1): Getting Started - Web App + REST API" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python FastAPI Tutorial (Part 1): Getting Started · 英文。Day 75 推荐过他的 logging 课,这是他的 FastAPI 系列第一集,讲安装、第一个路由、路径参数和 HTTPException,节奏稳,适合学完今天再看一遍。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/RnRyM2tOlvk" title="Python HTTP Servers || Built-in http.server, Flask & FastAPI" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Socratica · Python HTTP Servers || Built-in http.server, Flask & FastAPI · 英文。昨天推荐它看 http.server 的部分,今天看后面 FastAPI 那段,正好是「从手写到框架」的同一条路。</figcaption>
</figure>

### 书籍

- Bill Lubanovic,《FastAPI: Modern Python Web Development》,O'Reilly,2023(英文)。作者也是《Python 语言及其应用》的作者,这本书从 Web 基础讲到 FastAPI 的分层设计,第 3 章「FastAPI Tour」对应今天。O'Reilly 网站上能查到它的中文版条目,出版社和书名我没有核实,这里只推荐英文原版。

### 开源项目与代码

- [fastapi/fastapi](https://github.com/fastapi/fastapi):FastAPI 本身。README 里的第一个例子就是 `@app.get("/items/{item_id}")` 带一个查询参数,和今天的 `tickets_api.py` 几乎一样,读完今天应该每行都看得懂。
- [Kludex/starlette 的 starlette/routing.py](https://github.com/Kludex/starlette/blob/main/starlette/routing.py):FastAPI 底层的路由实现。搜 `def compile_path`,能看到 `/tickets/{ticket_id}` 是怎么被编译成一个正则表达式的;搜 `redirect_slashes`,就是第 5 步那个 307 的出处。不用全看懂,知道「昨天写不进路由表的模板」是这么实现的就行。
- [pydantic/httpx2](https://github.com/pydantic/httpx2):练习 1 装的那个 httpx2,README 写了它和 httpx 的关系。

## 自测

1. FastAPI 和 uvicorn 各负责什么?启动命令 `uvicorn part01.tickets_api:app` 的冒号前后分别是什么?

<details><summary>答案</summary>

uvicorn 是服务器,负责进程、端口、接收和发送字节;FastAPI 是框架,负责路由、参数解析校验、调用处理函数、把返回值变成 JSON 响应。冒号前是模块路径(从仓库根目录算,用点分隔),冒号后是模块里应用对象的变量名。

</details>

2. 函数 `def f(ticket_id: int, q: str, status: str | None = None)` 挂在 `@app.get("/tickets/{ticket_id}")` 上,三个参数分别是什么参数?哪些必填?

<details><summary>答案</summary>

`ticket_id` 出现在路径模板里,是路径参数,必填(没有它路径都匹配不上);`status` 和 `q` 不在模板里,是查询参数;`status` 有默认值,可选;`q` 没有默认值,必填,不传回 422,`type` 是 `missing`。顺便注意参数顺序:Python 规定没有默认值的参数要写在有默认值的前面,所以 `q` 排在 `status` 前面。

</details>

3. 请求 `/tickets/abc` 得到 422,body 里的 `loc` 是 `["path", "ticket_id"]`。这说明了什么?你的处理函数被调用了吗?

<details><summary>答案</summary>

说明路径参数 `ticket_id` 的值 `abc` 没通过 int 校验。处理函数没有被调用,FastAPI 在调用之前就用 pydantic 校验参数,失败直接回 422。

</details>

4. 为什么 `/tickets/stats` 要写在 `/tickets/{ticket_id}` 前面?写反了会看到什么?

<details><summary>答案</summary>

FastAPI 按登记顺序匹配,第一个匹配上的生效。`/tickets/{ticket_id}` 能匹配任何 `/tickets/xxx`,写在前面时 `stats` 会被当作工单号,int 转换失败,返回 `loc` 为 `["path", "ticket_id"]`、`input` 为 `"stats"` 的 422。

</details>

5. 面试题:你给 Agent 提供了一个工具接口 `GET /invoices?customer_id=...&limit=...`,上线后发现模型偶尔会传 `limit=100000`,导致响应特别慢、上下文也爆了。你在接口层会怎么改?

<details><summary>答案</summary>

在接口层给 `limit` 加范围约束,比如 `Annotated[int, Query(ge=1, le=50)] = 20`,超范围直接回 422,让模型从错误信息里知道合法范围(422 的 `msg` 和 `ctx` 写得很清楚,模型能据此自己修正后重试);同时考虑返回分页信息(总数、下一页游标),让模型需要更多时分页取,而不是一次要全部。`customer_id` 也该校验类型和格式。再加上测试覆盖边界值(0、1、50、51、负数),防止以后有人删掉约束。

</details>

## 明天预告

Day 80 · FastAPI(二):请求体、pydantic 校验和自动文档。今天的三个接口都是 GET,只读不写。明天加 `POST /tickets` 新建工单:前端发来一段 JSON,FastAPI 用你 Day 51 学过的 pydantic 模型来接收和校验,字段缺了、类型错了照样是 422;再打开今天提过一句的 `/docs`,看 FastAPI 怎么根据你的类型标注自动生成一份能直接点着试的接口文档。
