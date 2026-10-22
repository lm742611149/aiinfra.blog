---
title: 'Day 80 · FastAPI(二):请求体、pydantic 校验和自动文档'
description: '给工单服务加上 POST /tickets:前端发来的 JSON 交给一个 pydantic 模型接收,字段缺了、类型错了、多传了不该传的字段,都在进函数之前被 422 挡住。再打开 /docs 和 /openapi.json,看 FastAPI 怎么从同一份类型标注生成一份能点着试的接口文档。'
pubDate: 2026-10-22
regime: none
tags: ['fastapi', 'pydantic', 'backend', 'python', 'agent-zero']
series: 'agent-zero'
day: 80
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 79](/blog/agent-zero/day-079-fastapi-1/) 用 FastAPI 重写了工单服务 `part01/tickets_api.py`:`@app.get` 登记路由,路径参数 `ticket_id: int` 和查询参数 `status`、`limit` 都写成函数参数,FastAPI 按类型标注帮你转换和校验,不合格就回 422,body 里的 `loc` 告诉你是 `path` 还是 `query` 出了问题。练习里又加了 `/tickets/search` 和 `limit` 的 1 到 50 范围约束,并且用 `TestClient` 写了测试。

那几个接口有个共同点:全是 GET,只能读,不能写。客服在工作台上点「新建工单」,浏览器要把一整张表单的内容发给服务端,这些内容放不进 URL,要放在**请求体**里。今天就做这件事。

## 今天要解决的问题

学完今天,你应该能做到:

1. 写一个 `POST /tickets` 接口,用一个 pydantic 模型接收前端发来的 JSON,成功时回 201 和新建的工单。
2. 读懂请求体校验失败时的 422:`loc` 第一项变成了 `body`;能说出「缺字段」「类型错」「多传字段」「没写 Content-Type」「JSON 写坏了」分别长什么样。
3. 用 `Field` 和 `extra="forbid"` 把规则写进模型,让「id 和状态由服务端决定」这种约定真正被执行。
4. 打开 `/docs` 用 Swagger UI 调一次接口,打开 `/openapi.json` 看懂这份机器可读的接口说明是从哪来的。

今天两个新概念:**请求体模型**(用 pydantic 类接收 JSON)和**自动文档**(OpenAPI 和 Swagger UI)。pydantic 本身你 Day 51、Day 52 已经学过,今天是把它接到 HTTP 上。

预计用时:2.5 小时。花费 ¥0,不调模型。

前置:[Day 79](/blog/agent-zero/day-079-fastapi-1/) 的 `tickets_api.py`(包括练习 2 的 `/tickets/search` 和练习 3 的 `Query(ge=1, le=50)`)和 `tests/test_tickets_api.py`;[Day 61](/blog/agent-zero/day-061-http-3/) 的请求体和 `Content-Type`;[Day 51](/blog/agent-zero/day-051-pydantic-1/)、[Day 52](/blog/agent-zero/day-052-pydantic-2/) 的 `BaseModel`、`Field`、`field_validator`;[Day 73](/blog/agent-zero/day-073-pytest-3/) 的 fixture 和 [Day 74](/blog/agent-zero/day-074-pytest-4/) 的 monkeypatch。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `TicketCreate` 和 `create_ticket` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 请求体放在哪,前端怎么发

先从你熟悉的一边看。前端新建一张工单,大概是这么写的:

```js
await fetch("/tickets", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ title: "退款什么时候到账", priority: "high" }),
});
```

<div class="line-notes">

- `method: "POST",` 方法换成 POST。按 REST 的习惯(Day 63),对一个集合 `/tickets` 发 POST,意思是「在这个集合里新建一个」。
- `headers: { "Content-Type": "application/json" },` 告诉服务端「我发的这段字节是 JSON」。Day 61 用 curl 时写的是 `-H "Content-Type: application/json"`,一回事。
- `body: JSON.stringify({ title: "退款什么时候到账", priority: "high" }),` 请求体:一段 JSON 文本,跟在请求头和空行后面发出去。

</div>

在 DevTools 的 Network 面板里点开这条请求,Payload 标签页看到的就是请求体。Day 78 手写服务器时你已经知道,服务端收到的只是一串字节:要先看 `Content-Type` 决定怎么解析,再按 `Content-Length` 读够字节,`json.loads` 变成字典,再一个字段一个字段检查有没有、类型对不对。FastAPI 把这几步全包了,你只需要告诉它「我期望的 JSON 长什么样」,方式就是写一个 pydantic 模型。

## 第 1 步:最小的 POST /tickets

打开 Day 79 的 `part01/tickets_api.py`,做三处改动:import 里加一行 pydantic;在 `TICKETS` 下面加一个模型类;在 `list_tickets` 后面加一个新的处理函数。改完的完整文件:

```python
# agent-zero-lab/part01/tickets_api.py
from typing import Annotated, Any, Literal

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel

app = FastAPI(title="CloudLedger 工单服务")

TICKETS: list[dict[str, Any]] = [
    {"id": 1001, "title": "发票抬头开错了", "status": "open"},
    {"id": 1002, "title": "同一个月被扣了两次款", "status": "open"},
    {"id": 1003, "title": "想从基础版升级到专业版", "status": "closed"},
]


class TicketCreate(BaseModel):
    title: str
    priority: Literal["low", "normal", "high"] = "normal"


@app.get("/")
def index():
    return {"service": "cloudledger-tickets", "routes": ["/tickets", "/tickets/stats", "/tickets/{ticket_id}"]}


@app.get("/tickets")
def list_tickets(status: Literal["open", "closed"] | None = None, limit: Annotated[int, Query(ge=1, le=50)] = 10):
    items = [t for t in TICKETS if status is None or t["status"] == status]
    return {"count": len(items[:limit]), "items": items[:limit]}


@app.post("/tickets")
def create_ticket(ticket: TicketCreate):
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
def get_ticket(ticket_id: int):
    for t in TICKETS:
        if t["id"] == ticket_id:
            return t
    raise HTTPException(status_code=404, detail=f"没有这张工单: {ticket_id}")
```

<div class="line-notes">

- `from pydantic import BaseModel` Day 51 学的 `BaseModel`。FastAPI 装的时候已经把 pydantic 一起装上了(Day 79 装到的是 `pydantic==2.14.1`),不用再 `uv add`。
- `class TicketCreate(BaseModel):` 描述「新建工单时,前端要发来的 JSON 长什么样」。名字里带 `Create`,是因为它只管「新建」这一个场景,和存在 `TICKETS` 里的完整工单不是一回事:完整工单有 `id` 和 `status`,新建时这两个由服务端决定。<br>对照 TS,它相当于 `interface TicketCreate { title: string; priority?: "low" \| "normal" \| "high" }`,区别是 TS 的 interface 编译完就没了,pydantic 模型在运行时真的会去检查数据。如果你用过 zod,它更像 `z.object({...})`。
- `title: str` 必填,字符串。没有默认值就是必填,规则和 Day 79 的查询参数一样。
- `priority: Literal["low", "normal", "high"] = "normal"` 可选,只能是这三个值之一,不传就是 `"normal"`。
- `@app.post("/tickets")` 登记一条 POST 路由。路径和 `list_tickets` 一样是 `/tickets`,方法不同,所以是两条路由,互不干扰(Day 78 讲过,路由由「方法 + 路径」一起决定)。
- `def create_ticket(ticket: TicketCreate):` 关键在这一行。Day 79 说过「不在路径花括号里的简单类型参数是查询参数」;这里参数的类型是一个 pydantic 模型,不是简单类型,FastAPI 就认定它来自**请求体**:读出 body,按 JSON 解析,交给 `TicketCreate` 校验,通过了才把一个 `TicketCreate` 对象传进来。参数名 `ticket` 随便起,不影响 JSON 的样子。
- `new_id = max(t["id"] for t in TICKETS) + 1` 现有最大的 id 是 1003,新的就是 1004。生成器表达式 Day 79 见过一次,Day 99 细讲。这只是演示用的写法,两个请求同时进来可能算出同一个 id,真实系统交给数据库的自增主键(Day 91)。
- `row = {"id": new_id, "title": ticket.title, "status": "open", "priority": ticket.priority}` 用**点号**取字段:`ticket.title`,不是 `ticket["title"]`,因为 `ticket` 是模型对象,不是字典。id 和 status 是服务端定的。
- `TICKETS.append(row)` 存进内存里的列表(Day 21)。
- `return row` 返回新工单,FastAPI 照样转成 JSON。

</div>

注意 `create_ticket` 放在了 `ticket_stats` 和 `get_ticket` **前面**。Day 79 的路由顺序坑只影响「同一个方法下,模板会吞掉固定路径」的情况,POST 和 GET 不会互相吞,放哪都行;我放在 `list_tickets` 旁边,是因为它们管的是同一个集合,读代码时挨着看方便。

启动(第一个窗口,在 `/Users/你/agent-zero-lab`):

```bash
uv run uvicorn part01.tickets_api:app --port 8000 --reload
```

第二个窗口,发两个合法的请求:

```bash
curl -sS -X POST http://127.0.0.1:8000/tickets \
  -H "Content-Type: application/json" \
  -d '{"title": "退款什么时候到账"}' -w "  [%{http_code}]\n"
curl -sS -X POST http://127.0.0.1:8000/tickets \
  -H "Content-Type: application/json" \
  -d '{"title": "换绑手机号", "priority": "high"}' -w "  [%{http_code}]\n"
```

<div class="line-notes">

- `curl -sS -X POST http://127.0.0.1:8000/tickets \` `-X POST` 指定方法。行尾的反斜杠表示「命令没完,下一行接着写」(Day 4)。
- `-H "Content-Type: application/json" \` 和 `fetch` 里的 headers 一样。
- `-d '{"title": "退款什么时候到账"}' -w "  [%{http_code}]\n"` `-d` 后面是请求体。外面用单引号,里面的 JSON 用双引号,shell 才不会去动它。

</div>

实跑输出:

```text
{"id":1004,"title":"退款什么时候到账","status":"open","priority":"normal"}  [200]
{"id":1005,"title":"换绑手机号","status":"open","priority":"high"}  [200]
```

第一张没传 `priority`,用了默认的 `normal`;第二张传了 `high`。再看列表,两张新工单都在:

```bash
curl -sS http://127.0.0.1:8000/tickets
```

实跑输出(第 4 张以后):

```text
...,{"id":1004,"title":"退款什么时候到账","status":"open","priority":"normal"},{"id":1005,"title":"换绑手机号","status":"open","priority":"high"}]}
```

能用了。不过状态码是 200,新建资源按 HTTP 的约定应该回 **201 Created**,这个第 4 步修。

## 第 2 步:看 FastAPI 怎么挡住坏数据

把前端可能发来的各种不合格数据挨个发一遍。服务器还开着:

```bash
B=http://127.0.0.1:8000
curl -sS -X POST $B/tickets -H "Content-Type: application/json" -d '{"priority": "high"}' -w "  [%{http_code}]\n"
curl -sS -X POST $B/tickets -H "Content-Type: application/json" -d '{"title": "x", "priority": "urgent"}' -w "  [%{http_code}]\n"
curl -sS -X POST $B/tickets -H "Content-Type: application/json" -d '{"title": 123}' -w "  [%{http_code}]\n"
```

<div class="line-notes">

- `B=http://127.0.0.1:8000` 先存一个 shell 变量(Day 5),下面用 `$B` 代替,命令短一点。
- `-d '{"priority": "high"}'` 故意不传必填的 title。
- `-d '{"title": "x", "priority": "urgent"}'` priority 给一个不在三个选项里的值。
- `-d '{"title": 123}'` title 给一个数字。

</div>

实跑输出:

```text
{"detail":[{"type":"missing","loc":["body","title"],"msg":"Field required","input":{"priority":"high"}}]}  [422]
{"detail":[{"type":"literal_error","loc":["body","priority"],"msg":"Input should be 'low', 'normal' or 'high'","input":"urgent","ctx":{"expected":"'low', 'normal' or 'high'"}}]}  [422]
{"detail":[{"type":"string_type","loc":["body","title"],"msg":"Input should be a valid string","input":123}]}  [422]
```

还是 Day 79 那个熟悉的 422 格式,`loc` 的第一项现在是 **`body`**,第二项是模型里的字段名。三条分别是:缺字段(`missing`,`input` 是收到的整个对象)、值不在选项里(`literal_error`)、类型不对(`string_type`)。

第三条值得多看一眼。数字 `123` 明明可以转成字符串 `"123"`,pydantic 却拒绝了。这是 pydantic 2 的规矩:**它会把字符串 `"123"` 转成整数 123,反过来却不会把数字转成字符串**。前端表单里 `<input>` 的值都是字符串,所以 int 字段收到 `"5"` 能过;但有人在 JS 里写了 `title: someNumber`,服务端不会替你圆过去。

如果一次请求有好几处错呢?

```bash
curl -sS -X POST $B/tickets -H "Content-Type: application/json" -d '{"priority": "urgent"}' -w "  [%{http_code}]\n"
```

实跑输出:

```text
{"detail":[{"type":"missing","loc":["body","title"],"msg":"Field required","input":{"priority":"urgent"}},{"type":"literal_error","loc":["body","priority"],"msg":"Input should be 'low', 'normal' or 'high'","input":"urgent","ctx":{"expected":"'low', 'normal' or 'high'"}}]}  [422]
```

`detail` 列表里有两项,**一次把所有问题都报出来**,不是遇到第一个就停。这对前端很友好:表单提交一次,所有出错的输入框都能同时标红。

最后看一下服务器窗口,这几次请求的日志都是 `422 Unprocessable Entity`。你的 `create_ticket` 一次都没被调用,`TICKETS` 里也没有多出坏数据。这就是 Day 51 说的「守大门」:脏数据在门口就被拦下了,函数里可以放心地用 `ticket.title`,不用再写一堆 `if "title" not in data`。

## 第 3 步:不是数据错,是「发法」错了

上面三条是 JSON 内容不合格。下面这几种更隐蔽,数据看着没问题,是请求本身发得不对。前端联调时我最常见的就是这几种。

**忘了写 Content-Type**:

```bash
curl -sS -v -X POST $B/tickets -d '{"title": "没写 Content-Type"}'
```

实跑输出(只留了请求头和响应体):

```text
> POST /tickets HTTP/1.1
> Host: 127.0.0.1:8000
> User-Agent: curl/8.1.2
> Accept: */*
> Content-Length: 32
> Content-Type: application/x-www-form-urlencoded
>
{"detail":[{"type":"model_attributes_type","loc":["body"],"msg":"Input should be a valid dictionary or object to extract fields from","input":"{\"title\": \"没写 Content-Type\"}"}]}
```

`curl -d` 不写 `-H` 时,默认的 `Content-Type` 是 `application/x-www-form-urlencoded`,也就是 HTML 表单的格式。FastAPI 看到不是 JSON,就不按 JSON 解析,整个 body 被当成一个字符串交给 pydantic,而 pydantic 要的是一个对象,于是报 `model_attributes_type`:「需要一个字典或对象」。`input` 那里你能看到原样的字符串。

这个行为是故意的。FastAPI 的源码里 `strict_content_type` 默认是 `True`,注释写的理由是防一种跨站攻击:浏览器可以在不触发 CORS 预检的情况下发出不带 JSON 头的请求,如果服务端不管头是什么都按 JSON 解析,别的网站就能借用户的浏览器往你的本地服务发数据。所以记住一条:**发 JSON 一定带 `Content-Type: application/json`**。`fetch` 不会帮你自动加,axios 会。

**JSON 写坏了**:

```bash
curl -sS -X POST $B/tickets -H "Content-Type: application/json" -d '{"title": "少了右括号"' -w "  [%{http_code}]\n"
curl -sS -X POST $B/tickets -H "Content-Type: application/json" -w "  [%{http_code}]\n"
```

实跑输出:

```text
{"detail":[{"type":"json_invalid","loc":["body",17],"msg":"JSON decode error","input":{},"ctx":{"error":"Expecting ',' delimiter"}}]}  [422]
{"detail":[{"type":"missing","loc":["body"],"msg":"Field required","input":null}]}  [422]
```

第一条是 JSON 语法错,`type` 是 `json_invalid`,`loc` 里的 `17` 是出错的字符位置,`ctx.error` 是 Python 的 `json` 模块给的原因。第二条完全没有 body,`loc` 就是 `["body"]`,意思是「整个请求体都缺了」。

到这里可以总结一个读 422 的顺序:先看 `type`,`json_invalid` 和 `model_attributes_type` 说明是**发法**的问题(格式、头),去查前端的 `fetch`;`missing`、`string_type`、`literal_error` 这些说明是**内容**的问题,去查表单的值。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="POST 请求体在 FastAPI 里经过的四道关">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="30" fill="var(--ink)">POST /tickets 的请求体,从左往右过关</text>
<rect x="20" y="50" width="130" height="56" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="30" y="72" fill="var(--ink)">① 看头</text>
<text x="30" y="92" fill="var(--ink-soft)">Content-Type</text>
<rect x="170" y="50" width="130" height="56" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="180" y="72" fill="var(--ink)">② 解析</text>
<text x="180" y="92" fill="var(--ink-soft)">字节 → JSON</text>
<rect x="320" y="50" width="130" height="56" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
<text x="330" y="72" fill="var(--ink)">③ 校验</text>
<text x="330" y="92" fill="var(--ink-soft)">TicketCreate</text>
<rect x="470" y="50" width="150" height="56" fill="var(--paper-raised)" stroke="var(--rule)" rx="4"/>
<text x="480" y="72" fill="var(--ink)">④ 你的函数</text>
<text x="480" y="92" fill="var(--ink-soft)">create_ticket</text>
<line x1="150" y1="78" x2="170" y2="78" stroke="var(--rule)"/>
<line x1="300" y1="78" x2="320" y2="78" stroke="var(--rule)"/>
<line x1="450" y1="78" x2="470" y2="78" stroke="var(--rule)"/>
<line x1="85" y1="106" x2="85" y2="140" stroke="var(--rule)"/>
<line x1="235" y1="106" x2="235" y2="140" stroke="var(--rule)"/>
<line x1="385" y1="106" x2="385" y2="140" stroke="var(--rule)"/>
<text x="20" y="160" fill="var(--ink-soft)">不是 JSON 头</text>
<text x="20" y="178" fill="var(--ink-faint)">model_attributes_type</text>
<text x="175" y="160" fill="var(--ink-soft)">语法错 / 空</text>
<text x="175" y="178" fill="var(--ink-faint)">json_invalid</text>
<text x="175" y="196" fill="var(--ink-faint)">missing (loc=body)</text>
<text x="330" y="160" fill="var(--ink-soft)">内容不合格</text>
<text x="330" y="178" fill="var(--ink-faint)">missing / string_type</text>
<text x="330" y="196" fill="var(--ink-faint)">literal_error</text>
<text x="330" y="214" fill="var(--ink-faint)">extra_forbidden(第 4 步)</text>
<text x="480" y="160" fill="var(--ink-soft)">只有全过了</text>
<text x="480" y="178" fill="var(--ink-soft)">才会被调用</text>
<text x="20" y="262" fill="var(--ink)">①②③ 任何一关没过 → 422,函数不执行,TICKETS 不变</text>
</g>
</svg>
<figcaption>琥珀色两关检查的是「发法」,蓝色那关检查的是「内容」。`type` 字段告诉你卡在了哪一关。</figcaption>
</figure>

## 第 4 步:把规则写进模型

第 1 步的模型太宽松了。实测三个漏洞:

```bash
curl -sS -X POST $B/tickets -H "Content-Type: application/json" -d '{"title": "我要把状态设成已关闭", "status": "closed", "id": 1}' -w "  [%{http_code}]\n"
curl -sS -X POST $B/tickets -H "Content-Type: application/json" -d '{"title": ""}' -w "  [%{http_code}]\n"
```

实跑输出(接着前面的服务跑的,前面已经建了 1004 和 1005,中间还有几次 422 不占 id):

```text
{"id":1006,"title":"我要把状态设成已关闭","status":"open","priority":"normal"}  [200]
{"id":1007,"title":"","status":"open","priority":"normal"}  [200]
```

第二条:空标题也能建,工单列表里多了一张什么都没写的单子。第一条更值得警惕:前端传了 `"status": "closed"` 和 `"id": 1`,服务端**一声不吭地忽略了**,返回 200。pydantic 默认对模型里没写的字段就是忽略。数据没被改坏,看着无害,问题是调用方以为自己把状态设成了关闭,其实没有,而且没有任何报错告诉他。以后这个接口给 Agent 当工具用,模型很可能自作主张多传几个字段,静默忽略会让它误以为成功了。

另外还有一个:状态码一直是 200,应该是 201。

改模型和装饰器:

```python
# agent-zero-lab/part01/tickets_api.py(改过的 import、TicketCreate 和 create_ticket)
from pydantic import BaseModel, ConfigDict, Field


class TicketCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=100, description="一句话说清客户遇到的问题")
    priority: Literal["low", "normal", "high"] = "normal"


@app.post("/tickets", status_code=201)
def create_ticket(ticket: TicketCreate):
    """新建一张工单。id 和 status 由服务端决定,客户端不能传。"""
    new_id = max(t["id"] for t in TICKETS) + 1
    row = {"id": new_id, "title": ticket.title, "status": "open", "priority": ticket.priority}
    TICKETS.append(row)
    return row
```

<div class="line-notes">

- `from pydantic import BaseModel, ConfigDict, Field` 多导入两个:`ConfigDict` 用来写模型级别的配置,`Field` 用来给单个字段加约束(Day 52)。
- `model_config = ConfigDict(extra="forbid")` 模型级别的配置,写成一个叫 `model_config` 的类属性。`extra` 管「JSON 里多出来的字段怎么办」,有三个取值:`"ignore"`(默认,丢掉)、`"allow"`(收下)、`"forbid"`(报错)。我们要的是报错。
- `title: str = Field(min_length=1, max_length=100, description="一句话说清客户遇到的问题")` 等号右边从默认值换成了 `Field(...)`。注意这里**没写默认值**,所以 title 仍然是必填。`min_length=1` 不许空字符串,`max_length=100` 防止有人塞进一整篇文章。`description` 不影响校验,会出现在第 5 步的文档里。
- `@app.post("/tickets", status_code=201)` 成功时的状态码改成 201。只影响成功的情况,422 和 404 照旧。
- `"""新建一张工单。id 和 status 由服务端决定,客户端不能传。"""` 函数第一行的三引号字符串叫 **docstring**(文档字符串),相当于 JS 里写在函数上面的 JSDoc 注释,不过它是函数对象的一部分,程序能读到。FastAPI 会把它放进文档,第 5 步就能看到。

</div>

保存,`--reload` 自动重启(内存里的 `TICKETS` 也回到了 3 张,原因见第 7 步)。重新发一遍:

```bash
curl -sS -X POST $B/tickets -H "Content-Type: application/json" -d '{"title": "退款什么时候到账"}' -w "  [%{http_code}]\n"
curl -sS -X POST $B/tickets -H "Content-Type: application/json" -d '{"title": "我要把状态设成已关闭", "status": "closed"}' -w "  [%{http_code}]\n"
curl -sS -X POST $B/tickets -H "Content-Type: application/json" -d '{"title": ""}' -w "  [%{http_code}]\n"
```

实跑输出:

```text
{"id":1004,"title":"退款什么时候到账","status":"open","priority":"normal"}  [201]
{"detail":[{"type":"extra_forbidden","loc":["body","status"],"msg":"Extra inputs are not permitted","input":"closed"}]}  [422]
{"detail":[{"type":"string_too_short","loc":["body","title"],"msg":"String should have at least 1 character","input":"","ctx":{"min_length":1}}]}  [422]
```

201 有了;多传 `status` 变成 `extra_forbidden`,`loc` 精确指到 `status`;空标题是 `string_too_short`,`ctx` 里给出了限制值 1。我还试了 101 个字的标题,得到 `string_too_long`,`ctx` 是 `{"max_length":100}`。

但有一个洞还在:标题是三个空格 `"   "` 时,长度是 3,大于 1,实测照样 201 建成功了。这个要用 Day 52 的 `field_validator` 来补,留给练习 1。

## 第 5 步:自动文档,/docs 和 /openapi.json

浏览器打开 `http://127.0.0.1:8000/docs`。我用 Chrome 打开看到的是这样一个页面:最上面是标题「CloudLedger 工单服务」,旁边两个小标签 `0.1.0` 和 `OAS 3.1`,下面一个 `/openapi.json` 的链接;中间一个叫 `default` 的分组,列着六个接口,每行左边一个彩色的方法标签(GET 蓝色、POST 绿色),中间是路径,右边是一个英文名,比如 `/tickets/{ticket_id}  Get Ticket`;最下面一个 `Schemas` 区,列着 `HTTPValidationError`、`TicketCreate`、`ValidationError` 三个数据结构。

这个页面叫 **Swagger UI**,你一行代码都没写。点开 `POST /tickets` 那一行,展开后能看到:

- 第一行是 docstring:「新建一张工单。id 和 status 由服务端决定,客户端不能传。」
- `Request body` 旁边一个红色的 `required`,右边下拉框是 `application/json`。
- `Example Value` 里是一个示例 JSON:`{"title": "string", "priority": "normal"}`。title 没有默认值,就填了个占位的 `"string"`;priority 有默认值,就填了 `"normal"`。
- `Responses` 里列着 `201 Successful Response` 和 `422 Validation Error`,422 下面还画出了 `detail` 里 `loc`、`msg`、`type`、`input`、`ctx` 的结构。

右上角有个 `Try it out` 按钮。点它,示例 JSON 变成可编辑的,改成 `{"title": "发票重复了", "priority": "high"}`,再点下面的 `Execute`,Swagger UI 就会用浏览器的 `fetch` 向你的服务发一个真实的 POST,把等价的 curl 命令、请求 URL、返回的状态码和 body 显示在下方,服务器窗口里也会多一行 POST 的访问日志。(上面描述的页面布局,是我在无头 Chrome 里打开 `/docs` 截图核对过的;`Execute` 这一步没有截图,你点一次自己对照。)

对前端来说,这个页面最大的用处是**联调不用等后端写文档,也不用自己拼 curl**。后端改了一个字段,刷新一下页面就是最新的。

### 文档是从哪来的

页面上所有内容都来自同一个地方:那个 `/openapi.json` 链接。直接请求它:

```bash
curl -s $B/openapi.json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps(d["components"]["schemas"]["TicketCreate"], ensure_ascii=False, indent=2))'
```

<div class="line-notes">

- `curl -s $B/openapi.json |` 把整份 JSON 交给管道后面的 Python(Day 5 的管道)。<br>`python3 -c` 的 `-c` 是「直接运行引号里的这段代码」,这里只是临时用来从一大份 JSON 里挑一块出来,格式化打印。<br>`d["components"]["schemas"]["TicketCreate"]` 嵌套字典取值(Day 26),OpenAPI 把所有数据结构放在 `components.schemas` 下面。<br>`ensure_ascii=False` 让中文原样输出,不变成 `一` 这样的转义(Day 39)。

</div>

实跑输出:

```json
{
  "properties": {
    "title": {
      "type": "string",
      "maxLength": 100,
      "minLength": 1,
      "title": "Title",
      "description": "一句话说清客户遇到的问题"
    },
    "priority": {
      "type": "string",
      "enum": [
        "low",
        "normal",
        "high"
      ],
      "title": "Priority",
      "default": "normal"
    }
  },
  "additionalProperties": false,
  "type": "object",
  "required": [
    "title"
  ],
  "title": "TicketCreate"
}
```

<div class="line-notes">

- `"type": "string",` 来自 `title: str`。
- `"maxLength": 100,` 来自 `Field(max_length=100)`,下一行的 `minLength` 同理。
- `"description": "一句话说清客户遇到的问题"` 来自 `Field(description=...)`。
- `"enum": [` 来自 `Literal["low", "normal", "high"]`,允许的取值列表。
- `"default": "normal"` 默认值。
- `"additionalProperties": false,` 来自 `extra="forbid"`:不允许有额外字段。
- `"required": [` 必填字段列表,只有 title。

</div>

你在 Python 里写的每一条类型和约束,都被翻译成了这份 JSON 里的一行。这种格式叫 **JSON Schema**,一种「用 JSON 描述 JSON 应该长什么样」的标准;外面包着的整份文档叫 **OpenAPI**(这里是 3.1.0 版),一种「用 JSON 描述一整套 HTTP 接口」的标准:有哪些路径、每个路径支持什么方法、参数在哪、请求体和响应长什么样。Swagger UI 只是一个读 OpenAPI 文件、把它画成网页的前端程序。

所以 FastAPI 里其实只有一份真相,就是你的类型标注。它同时用来校验请求(第 2 步)、生成 OpenAPI(这里)、渲染文档页(上面),三者不会对不上。手写文档的团队最常见的问题就是代码改了文档没改,这里不会发生。

这件事和 Agent 的关系很直接。第三部分讲工具调用时,你要给模型描述「这个工具接收哪些参数」,用的就是 JSON Schema,格式和上面这段几乎一样(`type`、`properties`、`required`、`enum`、`description`)。`description` 写得好不好,直接影响模型会不会用对这个工具。今天先记住:**`Field(description=...)` 不只是写给人看的**。

### 两个你会碰到的小状况

一是 `/docs` 打开是白屏。查看网页源代码会发现,Swagger UI 的 JS 和 CSS 不在你的服务里,而是从 `https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/...` 加载的。我在本机 curl 这个 JS 文件是 200,用了 2.5 秒。如果你的网络访问 jsdelivr 不稳定,页面就会空白。打开 DevTools 的 Network 面板,看 `swagger-ui-bundle.js` 是不是红的就知道了。FastAPI 文档里有一篇「Custom Docs UI Static Assets」讲怎么把这些文件放到自己服务里,真遇到再看;`/openapi.json` 本身不受影响。

二是 `201` 下面的 `Example Value` 只写了一个 `"string"`。因为我们没告诉 FastAPI 返回值长什么样(函数返回的是一个普通字典),它只能写个占位。用 `response_model` 告诉它,是练习 2。

另外还有一个 `/redoc`,是另一种风格的文档页(ReDoc),只能看不能试,内容同样来自 `/openapi.json`。

## 第 6 步:用 TestClient 测 POST

Day 79 练习 1 写过 GET 的测试。POST 只多一个参数:`json=`。新建 `tests/test_create_ticket.py`:

```python
# agent-zero-lab/tests/test_create_ticket.py
from fastapi.testclient import TestClient

from part01.tickets_api import app

client = TestClient(app)


def test_create_ok():
    resp = client.post("/tickets", json={"title": "退款什么时候到账"})
    assert resp.status_code == 201
    assert resp.json() == {"id": 1004, "title": "退款什么时候到账", "status": "open", "priority": "normal"}


def test_create_missing_title():
    resp = client.post("/tickets", json={"priority": "high"})
    assert resp.status_code == 422
    assert resp.json()["detail"][0]["loc"] == ["body", "title"]


def test_create_rejects_status():
    resp = client.post("/tickets", json={"title": "我要把状态设成已关闭", "status": "closed"})
    assert resp.status_code == 422
    assert resp.json()["detail"][0]["type"] == "extra_forbidden"
```

<div class="line-notes">

- `resp = client.post("/tickets", json={"title": "退款什么时候到账"})` `json=` 收一个字典,TestClient 负责 `json.dumps`、编码,并且**自动加上 `Content-Type: application/json`**。相当于 axios 的 `axios.post(url, data)`,比 `fetch` 省心。
- `assert resp.json() == {"id": 1004,` 断言整个返回值。id 是 1004,因为测试开始时 `TICKETS` 里是 3 张。
- `assert resp.json()["detail"][0]["loc"] == ["body", "title"]` 和 Day 79 一样,只断言稳定的 `loc`,不断言英文 `msg`。
- `assert resp.json()["detail"][0]["type"] == "extra_forbidden"` 把第 4 步的「不许传 status」钉成测试。

</div>

单独跑这个文件,3 个都过。然后我把它和 Day 79 的测试放在一起跑,而且故意让它先跑:

```bash
uv run pytest tests/test_create_ticket.py tests/test_tickets_api.py -q
```

<div class="line-notes">

- `uv run pytest tests/test_create_ticket.py tests/test_tickets_api.py -q` 命令行里列了两个文件,pytest 就按写的顺序跑。不写文件名时按字母顺序,`test_create_ticket` 也排在 `test_tickets_api` 前面。

</div>

实跑输出(删了几行):

```text
=================================== FAILURES ===================================
____________________ test_stats_not_swallowed_by_ticket_id _____________________

    def test_stats_not_swallowed_by_ticket_id():
>       assert client.get("/tickets/stats").json() == {"total": 3, "open": 2}
E       AssertionError: assert {'total': 4, 'open': 3} == {'total': 3, 'open': 2}

tests/test_tickets_api.py:34: AssertionError
=========================== short test summary info ============================
FAILED tests/test_tickets_api.py::test_stats_not_swallowed_by_ticket_id - Ass...
1 failed, 7 passed in 2.15s
```

挂的是 **Day 79 的测试**,而且它自己的代码一个字没动。原因是:`TICKETS` 是模块里的一个全局列表,两个测试文件 `import` 的是同一个模块,用的是同一个列表。`test_create_ok` 往里加了一张,总数变成 4,后面的统计测试还以为是 3。单独跑哪个文件都过,放一起、换个顺序就挂,这种测试叫「互相依赖」,是最让人头疼的一类 bug,因为它在你的电脑上可能一直是绿的。

修法是让每个测试开始时都拿到一份干净的 `TICKETS`,用完还原。Day 74 学的 `monkeypatch` 正好干这个:

```python
# agent-zero-lab/tests/test_create_ticket.py(开头改成这样,三个测试函数不变)
import pytest
from fastapi.testclient import TestClient

from part01 import tickets_api
from part01.tickets_api import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def fresh_tickets(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(tickets_api, "TICKETS", list(tickets_api.TICKETS))
```

<div class="line-notes">

- `from part01 import tickets_api` 把模块本身导进来,下面要替换的是「模块上的属性」。
- `@pytest.fixture(autouse=True)` Day 73 的 fixture。`autouse=True` 表示这个文件里**每个**测试都自动用它,不用在参数里写名字。
- `def fresh_tickets(monkeypatch: pytest.MonkeyPatch):` 要用 monkeypatch,就在参数里声明它,pytest 会传进来。
- `monkeypatch.setattr(tickets_api, "TICKETS", list(tickets_api.TICKETS))` 把模块上的 `TICKETS` 换成一个**副本**:`list(...)` 复制出一个新列表,内容是原来那 3 张。测试里 POST 加的工单进了副本,原列表不受影响。测试结束,monkeypatch 自动把 `TICKETS` 换回原列表。<br>为什么换模块属性就管用?`create_ticket` 里写的 `TICKETS`,Python 是在**每次调用时**去模块里按名字找的,所以换掉以后,函数下次看到的就是副本。

</div>

再跑三个文件:

```bash
uv run pytest tests/test_create_ticket.py tests/test_tickets_api.py tests/test_ex79.py -q
```

实跑输出:

```text
...........                                                              [100%]
11 passed in 1.40s
```

我用 basedpyright(standard 档)检查 `part01/tickets_api.py` 和这个测试文件,都是 `0 errors, 0 warnings, 0 notes`。

## 第 7 步:重启以后,新工单没了

最后一个现象,你在第 4 步保存代码时可能已经注意到了。先建一张单,查得到;然后 Ctrl+C 停掉服务器,重新启动,再查:

```bash
curl -sS $B/tickets/1004 -w "  [%{http_code}]\n"
# (这时去第一个窗口 Ctrl+C,再启动 uvicorn)
curl -sS $B/tickets/1004 -w "  [%{http_code}]\n"
```

实跑输出:

```text
{"id":1004,"title":"退款什么时候到账","status":"open","priority":"normal"}  [200]
{"detail":"没有这张工单: 1004"}  [404]
```

`TICKETS` 只是进程内存里的一个列表(Day 77:进程退出,内存就没了)。`--reload` 每次重启进程,也会清空。所以现在这个服务只能当玩具,真正要存下来得用数据库,Day 85 开始学 SQL,Day 92 用 Python 操作 SQLite。在那之前,你只要知道「接口写对了」和「数据存住了」是两件事。

## 零件和成品的对照

| 今天的零件 | 在 `tickets_api.py` 的哪一段 | 解决什么 |
| --- | --- | --- |
| `class TicketCreate(BaseModel)` | 模型定义 | 描述前端该发来什么 |
| `def create_ticket(ticket: TicketCreate)` | POST 处理函数的参数 | 参数是模型 → 来自请求体 |
| `Field(min_length=1, max_length=100)` | `title` 字段 | 值的范围,不只是类型 |
| `ConfigDict(extra="forbid")` | `model_config` | 不许偷偷多传字段 |
| `status_code=201` | `@app.post(...)` | 新建成功回 201 |
| docstring、`description` | 函数第一行、`Field` | 进文档,给人和模型看 |
| `/docs`、`/openapi.json` | 不用写 | 同一份类型标注生成的文档 |
| `monkeypatch.setattr(..., "TICKETS", ...)` | `tests/test_create_ticket.py` | 测试之间不串数据 |

## 动手练习

**练习 1:挡住只有空格的标题。** 第 4 步留下的洞:`{"title": "   "}` 能建成功。给 `TicketCreate` 加一个 `field_validator`,先去掉首尾空格,去完是空的就报错;不是空的,就把去掉空格后的值存下来。用 TestClient 验证 `"   "` 是 422、`"  发票重复了  "` 建出来的标题是 `"发票重复了"`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/tickets_api.py(改过的 import 和 TicketCreate)
from pydantic import BaseModel, ConfigDict, Field, field_validator


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
```

<div class="line-notes">

- `from pydantic import BaseModel, ConfigDict, Field, field_validator` 多导入 `field_validator`(Day 52)。
- `@field_validator("title")` 告诉 pydantic:下面这个方法负责校验 `title` 字段。默认在类型检查和 `Field` 约束**之后**运行,所以进来的 `v` 一定已经是长度 1 到 100 的字符串。
- `@classmethod` pydantic 要求校验方法是类方法(Day 43),第一个参数是类本身 `cls`。两个装饰器的顺序不能反。
- `v = v.strip()` 去掉首尾空白(Day 16)。`"   "` 变成 `""`,`"  发票重复了  "` 变成 `"发票重复了"`。
- `raise ValueError("标题不能只有空格")` 在校验器里抛 `ValueError`,pydantic 会把它变成一条校验错误,FastAPI 再变成 422。
- `return v` **一定要 return**。校验器的返回值就是这个字段最终的值,这里返回的是去掉空格后的版本。忘了写 return,字段会变成 `None`。

</div>

验证(服务器不用开):

```bash
uv run python -c '
from fastapi.testclient import TestClient
from part01.tickets_api import app
c = TestClient(app)
for body in [{"title": "   "}, {"title": "  发票重复了  "}]:
    r = c.post("/tickets", json=body)
    print(r.status_code, r.json())
'
```

实跑输出:

```text
422 {'detail': [{'type': 'value_error', 'loc': ['body', 'title'], 'msg': 'Value error, 标题不能只有空格', 'input': '   ', 'ctx': {'error': {}}}]}
201 {'id': 1004, 'title': '发票重复了', 'status': 'open', 'priority': 'normal'}
```

`type` 是 `value_error`,`msg` 前面 pydantic 自动加了 `Value error, `。第二条存进去的标题已经没有空格了。basedpyright 检查 0 错误。明天的 Day 81 从带着这个校验器的版本继续。

</details>

**练习 2:让文档显示返回格式。** 第 5 步看到 201 的示例只有一个 `"string"`。定义一个 `TicketOut` 模型(`id`、`title`、`status`、`priority` 四个字段),用 `@app.post(..., response_model=TicketOut)` 告诉 FastAPI 返回值的形状。然后做个实验:在 `row` 里加一个内部字段 `"internal_note": "客户上周投诉过两次"`,看看响应里有没有它。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/tickets_api.py(新增 TicketOut,改 create_ticket)
class TicketOut(BaseModel):
    id: int
    title: str
    status: Literal["open", "closed"]
    priority: Literal["low", "normal", "high"]


@app.post("/tickets", status_code=201, response_model=TicketOut)
def create_ticket(ticket: TicketCreate):
    """新建一张工单。id 和 status 由服务端决定,客户端不能传。"""
    new_id = max(t["id"] for t in TICKETS) + 1
    row = {"id": new_id, "title": ticket.title, "status": "open", "priority": ticket.priority, "internal_note": "客户上周投诉过两次"}
    TICKETS.append(row)
    return row
```

<div class="line-notes">

- `class TicketOut(BaseModel):` 描述「返回给前端的工单长什么样」。和 `TicketCreate` 分开:进来的和出去的往往不一样,出去的多了 `id` 和 `status`。
- `@app.post("/tickets", status_code=201, response_model=TicketOut)` `response_model` 做两件事:写进 OpenAPI,文档里 201 的示例变成真实结构;返回前用 `TicketOut` **过滤**一遍,模型里没有的字段不发出去。
- `"internal_note": "客户上周投诉过两次"}` 模拟一个只该内部看的字段。

</div>

验证:

```bash
uv run python -c '
from fastapi.testclient import TestClient
from part01.tickets_api import app, TICKETS
c = TestClient(app)
r = c.post("/tickets", json={"title": "退款什么时候到账"})
print(r.status_code, r.json())
print(TICKETS[-1])
print(c.get("/openapi.json").json()["paths"]["/tickets"]["post"]["responses"]["201"])
'
```

实跑输出:

```text
201 {'id': 1004, 'title': '退款什么时候到账', 'status': 'open', 'priority': 'normal'}
{'id': 1004, 'title': '退款什么时候到账', 'status': 'open', 'priority': 'normal', 'internal_note': '客户上周投诉过两次'}
{'description': 'Successful Response', 'content': {'application/json': {'schema': {'$ref': '#/components/schemas/TicketOut'}}}}
```

`TICKETS` 里存着 `internal_note`,响应里没有,被 `response_model` 过滤掉了。文档里 201 的 schema 从空的 `{}` 变成了指向 `TicketOut`,刷新 `/docs` 就能看到四个字段的示例。这是防止内部字段(比如以后从数据库读出来的密码哈希、成本价)意外泄露给前端的一道保险。

做完这题把 `internal_note` 删掉,`response_model` 可以留着。

</details>

**练习 3(观察题):前端序列化的两个经典错误。** 先猜结果,再实跑。①前端忘了 `JSON.stringify`,直接 `body: {title: "x"}`,浏览器会把对象转成字符串 `"[object Object]"` 发出去;②前端对一个已经是 JSON 字符串的值又 `JSON.stringify` 了一次。用 curl 模拟这两种 body(都带正确的 Content-Type),看 422 的 `type` 分别是什么。

<details><summary>参考答案</summary>

```bash
curl -sS -X POST $B/tickets -H "Content-Type: application/json" -d '[object Object]' -w "  [%{http_code}]\n"
curl -sS -X POST $B/tickets -H "Content-Type: application/json" -d '"{\"title\": \"多序列化了一次\"}"' -w "  [%{http_code}]\n"
```

<div class="line-notes">

- `-d '[object Object]'` 浏览器把对象当 body 时实际发出去的就是这 15 个字符。
- `-d '"{\"title\": \"多序列化了一次\"}"'` 多 stringify 一次的结果:外层多了一对引号,里面的引号被转义,整个 body 是一个 JSON **字符串**,不是对象。

</div>

实跑输出:

```text
{"detail":[{"type":"json_invalid","loc":["body",1],"msg":"JSON decode error","input":{},"ctx":{"error":"Expecting value"}}]}  [422]
{"detail":[{"type":"model_attributes_type","loc":["body"],"msg":"Input should be a valid dictionary or object to extract fields from","input":"{\"title\": \"多序列化了一次\"}"}]}  [422]
```

第一种 `json_invalid`:`[object Object]` 开头的 `[` 让解析器以为是个数组,第 1 个字符 `o` 不是合法的值,所以 `loc` 里是 `1`。第二种 JSON 语法完全合法,解析出来是一个字符串,pydantic 要的是对象,所以 `model_attributes_type`,和第 3 步「没写 Content-Type」是同一种错误。看到这两个 type,先去检查前端怎么序列化的。

</details>

**练习 4:路径参数 + 请求体一起用。** 加一个 `PATCH /tickets/{ticket_id}`,body 是 `{"status": "open"}` 或 `{"status": "closed"}`,用来改工单状态;工单不存在回 404。用 curl 验证:关闭 1001 成功、改 9999 是 404、`/tickets/abc` 加上 `{"status": "done"}` 会同时报两处错。

<details><summary>参考答案</summary>

在 `list_tickets` 上面加模型,在文件末尾加处理函数:

```python
# agent-zero-lab/part01/tickets_api.py(新增)
class StatusUpdate(BaseModel):
    status: Literal["open", "closed"]


@app.patch("/tickets/{ticket_id}")
def update_status(ticket_id: int, body: StatusUpdate):
    for t in TICKETS:
        if t["id"] == ticket_id:
            t["status"] = body.status
            return t
    raise HTTPException(status_code=404, detail=f"没有这张工单: {ticket_id}")
```

<div class="line-notes">

- `class StatusUpdate(BaseModel):` 只有一个字段的模型也要写成类,FastAPI 才知道它来自请求体。
- `@app.patch("/tickets/{ticket_id}")` PATCH 表示「改一部分」,和 PUT「整个替换」相对(Day 59)。只改状态,用 PATCH。
- `def update_status(ticket_id: int, body: StatusUpdate):` FastAPI 按三条规则分配参数:名字在路径模板里 → 路径参数;类型是 pydantic 模型 → 请求体;其余简单类型 → 查询参数。
- `t["status"] = body.status` 直接改列表里的那个字典。

</div>

```bash
curl -sS -X PATCH $B/tickets/1001 -H "Content-Type: application/json" -d '{"status": "closed"}' -w "  [%{http_code}]\n"
curl -sS -X PATCH $B/tickets/9999 -H "Content-Type: application/json" -d '{"status": "closed"}' -w "  [%{http_code}]\n"
curl -sS -X PATCH $B/tickets/abc -H "Content-Type: application/json" -d '{"status": "done"}' -w "  [%{http_code}]\n"
curl -sS $B/tickets/stats
```

实跑输出:

```text
{"id":1001,"title":"发票抬头开错了","status":"closed"}  [200]
{"detail":"没有这张工单: 9999"}  [404]
{"detail":[{"type":"int_parsing","loc":["path","ticket_id"],"msg":"Input should be a valid integer, unable to parse string as an integer","input":"abc"},{"type":"literal_error","loc":["body","status"],"msg":"Input should be 'open' or 'closed'","input":"done","ctx":{"expected":"'open' or 'closed'"}}]}  [422]
{"total":3,"open":1}
```

第三条一次报了两处,一处 `loc` 以 `path` 开头,一处以 `body` 开头,不同位置的参数也会合在一起报。统计里未处理的从 2 变成 1。

你会发现 `update_status` 和 `get_ticket` 里那段「循环找工单,找不到抛 404」一模一样,复制了两遍。明天的依赖注入就是来消掉这种重复的。Day 81 从「正文 + 练习 1 + 练习 4」的版本开始。

</details>

**验收标准:** 服务起来以后,合法的 POST 回 201;缺 title、priority 写错、多传 status、空标题、只有空格的标题都回 422 且 `loc` 指到正确的字段;不带 `Content-Type` 发 JSON 得到 `model_attributes_type`;`/docs` 能用 `Try it out` 建一张单;`uv run pytest -q` 全绿,并且换文件顺序也全绿;能不看文章说出 FastAPI 怎么判断一个参数来自路径、查询还是请求体。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 请求体(request body) | 请求头后面的那段数据,POST/PATCH 用它传表单或 JSON;`fetch` 里的 `body` |
| 请求体模型 | 一个 pydantic 类,作为处理函数的参数类型时,FastAPI 就从请求体里读 JSON 交给它校验 |
| 201 Created | 新建资源成功。比 200 更准确地告诉调用方「东西建好了」 |
| `Field(...)` | 给单个字段加约束和说明,如 `min_length`、`max_length`、`description` |
| `model_config` / `ConfigDict` | pydantic 模型级别的配置,写成类属性 |
| `extra="forbid"` | JSON 里出现模型没有的字段就报 `extra_forbidden`,默认是静默忽略 |
| docstring | 函数第一行的三引号字符串,≈JSDoc,FastAPI 会放进文档 |
| `model_attributes_type` | 422 的一种:要对象却收到了别的(字符串、数组),常见于没写 Content-Type 或多序列化一次 |
| `json_invalid` | 422 的一种:请求体不是合法 JSON |
| OpenAPI | 用一份 JSON 描述整套 HTTP 接口的标准,FastAPI 在 `/openapi.json` 自动生成 |
| JSON Schema | 用 JSON 描述「一段 JSON 应该长什么样」的标准,OpenAPI 用它描述参数和请求体,工具调用也用它 |
| Swagger UI | 读 OpenAPI、画成可交互网页的前端程序,在 `/docs`;`Try it out` 能直接发请求 |
| ReDoc | 另一种只读的文档页,在 `/redoc` |
| `strict_content_type` | FastAPI 的默认行为:请求不声明 JSON 就不按 JSON 解析,防跨站请求 |
| `response_model` | 声明返回值的模型:写进文档,并过滤掉模型里没有的字段 |

## 常见误区

**发 JSON 不写 Content-Type。** `curl -d` 默认是 `application/x-www-form-urlencoded`,`fetch` 默认是 `text/plain`,FastAPI 都不会按 JSON 解析,报的是 `model_attributes_type`,`input` 是原样的字符串。看到这个 type 先查请求头。

**以为没报错就是生效了。** pydantic 默认静默忽略多余字段,`{"status": "closed"}` 会得到 200,状态却没变。不该由客户端决定的字段,用 `extra="forbid"` 让它明确报错。

**用 `ticket["title"]` 取模型的字段。** 参数是模型对象,要用 `ticket.title`。用方括号会报 `TypeError: 'TicketCreate' object is not subscriptable`。

**`field_validator` 忘了 return。** 校验器的返回值就是字段的最终值,不写 return 字段会变成 `None`,而且不会报错。

**测试之间共享全局数据。** 一个测试 POST 了一张单,另一个测试的计数就错了,单独跑都过、一起跑才挂。用 fixture 加 monkeypatch 给每个测试一份副本。

**以为数字会被转成字符串。** pydantic 2 会把 `"5"` 转成 int 5,但不会把 `123` 转成 `"123"`,`title: 123` 是 `string_type` 错误。

**`/docs` 白屏就以为服务挂了。** Swagger UI 的 JS 从 jsdelivr CDN 加载,网络不通就空白。`curl /openapi.json` 能拿到内容,服务就没问题。

**以为重启后数据还在。** `TICKETS` 在进程内存里,`--reload` 每改一次代码就重启一次,新建的工单全部消失。要持久化得等数据库。

## 学习资料

### 文档与文章

- [FastAPI 中文文档 · 请求体](https://fastapi.tiangolo.com/zh/tutorial/body/):今天第 1 步对应的官方教程,包括「参数是模型就来自请求体」的规则和路径参数、请求体混用。
- [FastAPI 中文文档 · 请求体 - 字段](https://fastapi.tiangolo.com/zh/tutorial/body-fields/):`Field` 的用法,第 4 步。
- [FastAPI 中文文档 · 响应状态码](https://fastapi.tiangolo.com/zh/tutorial/response-status-code/):`status_code=201` 和各类状态码的含义。
- [FastAPI 中文文档 · 响应模型](https://fastapi.tiangolo.com/zh/tutorial/response-model/):`response_model` 的过滤作用,练习 2。
- [FastAPI 中文文档 · 元数据和文档 URL](https://fastapi.tiangolo.com/zh/tutorial/metadata/):`title`、`description`、改 `/docs` 地址或关掉文档。
- [FastAPI 文档 · Strict Content-Type(英文)](https://fastapi.tiangolo.com/advanced/strict-content-type/):第 3 步「不写 Content-Type 不解析」的官方说明和关闭方法。
- [FastAPI 文档 · Custom Docs UI Static Assets(英文)](https://fastapi.tiangolo.com/how-to/custom-docs-ui-assets/):`/docs` 白屏时把 Swagger UI 文件放到本地。
- [pydantic 文档 · Validation Errors(英文)](https://docs.pydantic.dev/latest/errors/validation_errors/):今天见到的 `missing`、`string_type`、`extra_forbidden`、`json_invalid` 等每种 `type` 的说明和例子,查 422 时当字典用。
- [MDN · 201 Created](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Reference/Status/201)、[MDN · Content-Type](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Reference/Headers/Content-Type):两个 HTTP 概念的标准解释。
- [Swagger 文档 · What Is OpenAPI?(英文)](https://swagger.io/docs/specification/v3_0/about/):OpenAPI 是什么、一份文件里有哪些部分。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1zV2QBtE39&autoplay=0&high_quality=1" title="黑马程序员PythonWeb开发:FastAPI从入门到实战视频教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>黑马程序员 · FastAPI 从入门到实战视频教程 · Day 79 推荐过的合集。今天看第 8 P「请求体参数」和第 9 P「请求体参数_Field类型注解」,各 7 分钟左右;第 3 P 里演示过 /docs 页面,忘了可以回看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Yt4y1o7rS&autoplay=0&high_quality=1" title="FastAPI教程 - 4.请求体" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>跟峰哥学编程 · FastAPI教程 - 4.请求体 · 21 分钟。一节专讲请求体,在 /docs 里边点边讲,能看清 Swagger UI 每个区域是干什么的,和第 5 步对着看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/9GHxnttXxrA" title="Python FastAPI Tutorial (Part 4): Pydantic Schemas - Request and Response Validation" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python FastAPI Tutorial (Part 4): Pydantic Schemas - Request and Response Validation · 英文。Day 79 推荐的系列的第 4 集,讲的正好是今天的请求模型和练习 2 的响应模型,他也是把「进来的」和「出去的」分成两个 schema。</figcaption>
</figure>

### 书籍

- Bill Lubanovic,《FastAPI: Modern Python Web Development》,O'Reilly,2023(英文)。Day 79 推荐过,第二部分(FastAPI 之旅)里讲 pydantic、类型提示和模型的那一章,和今天对应。
- Arnaud Lauret,《The Design of Web APIs》第二版,Manning,2025(英文)。讲接口怎么设计、怎么用 OpenAPI 和 JSON Schema 写清楚,适合学完第一部分再系统看一遍;今天只需要知道 OpenAPI 是它的主线。

### 开源项目与代码

- [swagger-api/swagger-ui](https://github.com/swagger-api/swagger-ui):`/docs` 页面背后的前端项目,本身是一个 JS 应用,你完全看得懂它的构建方式。
- [fastapi/full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template):FastAPI 官方的全栈模板(后端 FastAPI + 前端 React)。现在看 `backend/app/models.py` 里同一个实体的 `ItemCreate`、`ItemUpdate`、`ItemPublic` 几个模型分开定义(它用的 SQLModel 是建在 pydantic 上的),就是今天 `TicketCreate` 和 `TicketOut` 的同一个思路。
- [OpenAPI 3.1.0 规范](https://spec.openapis.org/oas/v3.1.0):`/openapi.json` 每个字段的权威定义,遇到看不懂的键时查。

## 自测

1. FastAPI 怎么判断一个函数参数来自路径、查询还是请求体?

<details><summary>答案</summary>

名字出现在路径模板 `{}` 里的,是路径参数;类型是 pydantic 模型的,是请求体;其余的 int、str、Literal 这类简单类型,是查询参数。

</details>

2. 前端提交后收到 422,`detail[0]` 是 `{"type": "model_attributes_type", "loc": ["body"], ...}`,`input` 是一段看着像 JSON 的字符串。最可能是什么原因?

<details><summary>答案</summary>

请求没带 `Content-Type: application/json`,或者 body 被 `JSON.stringify` 了两次。两种情况下 FastAPI 拿到的都是一个字符串,而模型要的是对象。先在 DevTools 的 Network 面板看请求头和 Payload。

</details>

3. 不加 `extra="forbid"` 时,前端发 `{"title": "x", "status": "closed"}` 会发生什么?为什么说这比报错更危险?

<details><summary>答案</summary>

`status` 被静默丢掉,工单照样建成 `open`,返回 201(或第 1 步时的 200)。调用方以为自己设了状态,其实没有,而且没有任何提示,问题要很久以后才被发现。报错至少让调用方当场知道这个字段不能传。

</details>

4. `/docs` 页面上的接口列表、参数说明、示例 JSON,和你代码里的哪些东西有关?改了 `Field(description=...)` 要不要去改文档?

<details><summary>答案</summary>

全部来自 `/openapi.json`,而它是 FastAPI 根据路由装饰器、函数参数的类型标注、pydantic 模型、`Field` 约束、docstring 自动生成的。改了 description 刷新页面就是新的,不用另外改文档。

</details>

5. 为什么测试文件里要用 fixture 把 `TICKETS` 换成副本?不换会出现什么现象?

<details><summary>答案</summary>

`TICKETS` 是模块级的全局列表,所有测试共用同一个。一个测试 POST 加了工单,后面的测试看到的数量就变了。现象是单独跑每个文件都过,一起跑或换顺序时某个毫不相干的测试挂掉,今天实测是 `{'total': 4, 'open': 3} == {'total': 3, 'open': 2}`。

</details>

6. 面试题:你要把一个「新建退款申请」的 HTTP 接口包装成工具给 Agent 调用。在请求体模型上,你会做哪些设计来减少模型乱传参数造成的问题?

<details><summary>答案</summary>

字段用最窄的类型:金额用数字并加 `gt=0` 和合理上限,原因类用 `Literal` 列出几个可选值,不给自由文本;客户编号、工单号这类加格式约束。`extra="forbid"`,让模型多编的字段直接报 422,而不是被忽略后误以为成功。每个字段写清楚 `description`,因为它会进 JSON Schema,模型读的就是它。服务端决定的字段(状态、创建时间、审批人)不放进请求模型。422 的 `loc` 和 `msg` 原样回给模型,让它据此自己修正重试。再加上覆盖这些边界的测试。

</details>

## 明天预告

Day 81 · FastAPI(三):错误处理、依赖注入和中间件。今天你已经见到三种不同长相的错误:404 的 `detail` 是字符串,422 的 `detail` 是列表,还有练习 4 里复制了两遍的「找不到就 404」。明天先把所有错误统一成一种格式,包括服务端自己出 bug 时的 500;再用 `Depends` 把重复的「找工单」逻辑抽出来;最后写一个中间件,给每个响应盖上一个请求编号,出了问题前端能报给你一个号。
