---
title: 'Day 290 · 写 MCP server(十):远程 server、鉴权和 Gradio 公网演示'
description: '到昨天为止 CloudLedger 都是 stdio,只能被本机的 host 拉起来。今天把它换成 Streamable HTTP,让别的程序用一个网址连它;亲手用一条 curl、不带任何凭证提交一笔退款申请,看清楚「没鉴权」有多危险;再用 Starlette 中间件加上 Bearer token,没带、带错一律 401;最后用 Gradio 做一个只读的网页演示版,同一个函数既是表单又是 MCP 工具。'
pubDate: 2026-10-23
regime: none
tags: ['mcp', 'streamable-http', 'auth', 'bearer-token', 'gradio', 'cloudledger', 'agent-zero']
series: 'agent-zero'
day: 290
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 289](/blog/agent-zero/day-289-mcp-host/) 让模型真正用上了 CloudLedger:先用 `claude mcp add` 接进 Claude Code,吃了一次相对路径的亏;再自己当 host,写了 `part05/mcp_agent.py`,把 MCP 的工具清单转成 OpenAI 的 `tools` 参数,把 `CallToolResult` 转成 `role=tool` 消息,还在 host 这一层拦下了没授权的写工具。

这些连接有一个共同点:server 是 host 用 `uv run python cloudledger/server.py` **在本机拉起来的子进程**,两边靠标准输入输出说话(stdio)。所以只有你自己电脑上的程序能用它。客服团队想在自己的电脑上用、部署在服务器上的客服 Agent 想调它,都做不到。今天把这个限制拆掉。

## 今天要解决的问题

学完今天,你要能做到:

1. 不改一行工具代码,把 CloudLedger 换成 Streamable HTTP 跑在 `http://127.0.0.1:8765/mcp`,用 `Client("网址")` 连上去调工具;说得出 stdio 和 HTTP 两种方式里,server 的进程分别是谁启动的。
2. 用一条 curl,不带任何凭证,往没鉴权的 server 上提交一笔退款申请,亲眼看到库里多出一条记录。
3. 写出 `cloudledger/server_auth.py`:用 Starlette 中间件检查 `Authorization: Bearer <token>`,没带、带错都回 401;client 端用 `httpx2.AsyncClient(headers=...)` 带上 token。说得出 MCP 规范里正式的鉴权方案(OAuth 2.1)比今天这一版多了什么。
4. 用 Gradio 的 `launch(mcp_server=True)` 做一个只读的演示版,用 lab 里的 client 连上去,看懂它协商出来的协议版本为什么是 `2025-11-25`。

预计用时 2.5 小时。实跑花费约 ¥0.003,只有练习 3 调了一次模型。

前置:[Day 276](/blog/agent-zero/day-276-mcp-transports/)(stdio 和 Streamable HTTP 两种传输)、[Day 82](/blog/agent-zero/day-082-auth-1/)(服务端怎么验 API key、`secrets.compare_digest`)、[Day 81](/blog/agent-zero/day-081-fastapi-3/)(中间件和 `call_next`)、[Day 63](/blog/agent-zero/day-063-rest-api/)(`Authorization` 头)、[Day 283](/blog/agent-zero/day-283-mcp-read-write/)(`create_refund_request` 只写 `pending_approval`)、[Day 288](/blog/agent-zero/day-288-mcp-client/)(`Client`)和 [Day 289](/blog/agent-zero/day-289-mcp-host/)(`mcp_agent.py`)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `server_auth.py` 和 `http_client_auth.py` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

### 准备

所有命令都在 `agent-zero-lab/` 根目录跑(我的是 `/Users/你/agent-zero-lab`)。今天要开两个终端窗口:**终端 A** 跑 server,**终端 B** 跑 client 和 curl。server 一直占着终端 A,停它就在终端 A 按 Ctrl+C。

先把业务库重置成干净状态,今天会往里写退款申请,重置一下方便对数:

```bash
uv run python cloudledger/seed.py
```

<div class="line-notes">

- `uv run python cloudledger/seed.py` [Day 280](/blog/agent-zero/day-280-mcp-seed/) 写的造数脚本,每次删库重建,随机种子固定。我跑出来是 `已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}`,`refund_requests` 表是空的。

</div>

今天用到的包 lab 里都有:`mcp[cli]==2.3.0` 自带了 `uvicorn`(0.54.0)、`starlette`(1.9.0)和 `httpx2`,不用再 `uv add`。Gradio 例外,它要单独放一个目录,原因到那一节再说。

## stdio 和 HTTP:server 是谁启动的

[Day 276](/blog/agent-zero/day-276-mcp-transports/) 讲过两种传输,今天从「谁启动 server 进程」这个角度再看一遍,因为它直接决定了要不要鉴权。

stdio 方式下,host 自己执行一条命令把 server 拉起来,server 是 host 的子进程,只认它的父进程,别人根本插不进来。你可以把它想成前端里 `new Worker("worker.js")`:Worker 是页面自己创建的,只能通过 `postMessage` 和这个页面说话,别的页面够不着。

HTTP 方式下,server 是一个**一直开着、监听端口的独立进程**,和你 `npm run dev` 起的那个 3000 端口一样([Day 77](/blog/agent-zero/day-077-server-1/))。谁知道地址、网络能通,谁就能发请求过来。它可以跑在一台服务器上,同时服务很多个 client。好处是共享,代价是门得自己看。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="左边 stdio:host 拉起 server 子进程,通过管道通信,只有一个 client;右边 HTTP:server 独立监听 8765 端口,多个 client 通过网络发请求,中间要有鉴权">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="150" y="24" fill="var(--ink)" text-anchor="middle">stdio(Day 281–289)</text>
<rect x="30" y="50" width="110" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="85" y="76" fill="var(--ink)" text-anchor="middle">host</text>
<rect x="170" y="50" width="110" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="225" y="70" fill="var(--ink)" text-anchor="middle">server</text><text x="225" y="86" fill="var(--ink-faint)" text-anchor="middle" font-size="11">子进程</text>
<line x1="140" y1="72" x2="170" y2="72" stroke="var(--ink-soft)"/>
<text x="155" y="118" fill="var(--ink-faint)" text-anchor="middle" font-size="11">host 拉起它,管道通信</text>
<text x="155" y="136" fill="var(--ink-faint)" text-anchor="middle" font-size="11">别人插不进来</text>
<line x1="320" y1="20" x2="320" y2="230" stroke="var(--rule)"/>
<text x="480" y="24" fill="var(--ink)" text-anchor="middle">Streamable HTTP(今天)</text>
<rect x="350" y="44" width="100" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="400" y="64" fill="var(--ink)" text-anchor="middle">客服 Agent</text>
<rect x="350" y="86" width="100" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="400" y="106" fill="var(--ink)" text-anchor="middle">Claude Code</text>
<rect x="350" y="128" width="100" height="30" rx="4" fill="none" stroke="var(--ink-soft)" stroke-dasharray="4 3"/><text x="400" y="148" fill="var(--ink-soft)" text-anchor="middle">陌生人 curl</text>
<rect x="480" y="74" width="40" height="54" rx="4" fill="var(--paper-raised)" stroke="var(--ink)"/><text x="500" y="98" fill="var(--ink)" text-anchor="middle" font-size="11">鉴</text><text x="500" y="114" fill="var(--ink)" text-anchor="middle" font-size="11">权</text>
<line x1="450" y1="59" x2="480" y2="90" stroke="var(--ink-soft)"/>
<line x1="450" y1="101" x2="480" y2="101" stroke="var(--ink-soft)"/>
<line x1="450" y1="143" x2="480" y2="115" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
<rect x="540" y="74" width="85" height="54" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="582" y="96" fill="var(--ink)" text-anchor="middle">server</text><text x="582" y="114" fill="var(--ink-faint)" text-anchor="middle" font-size="11">:8765/mcp</text>
<line x1="520" y1="101" x2="540" y2="101" stroke="var(--ink-soft)"/>
<text x="480" y="190" fill="var(--ink-faint)" text-anchor="middle" font-size="11">server 自己一直开着,谁知道地址谁就能来</text>
<text x="480" y="208" fill="var(--ink-faint)" text-anchor="middle" font-size="11">所以门口要有一道检查</text>
</g>
</svg>
<figcaption>左边的 server 只认自己的父进程;右边的 server 对所有能连上它的人敞开,鉴权是它唯一的门。</figcaption>
</figure>

## 第 1 步:同一个 server,换成 HTTP 跑

不用改 `server.py`。新建一个四行的文件,导入 Day 284 写完的那个 `mcp` 对象,换一种方式启动:

```python
# agent-zero-lab/cloudledger/server_http.py
"""同一个 CloudLedger server,换成 Streamable HTTP 传输,别的程序通过网址连它。"""
from cloudledger.server import mcp

if __name__ == "__main__":
    mcp.run(transport="streamable-http", host="127.0.0.1", port=8765)
```

<div class="line-notes">

- `from cloudledger.server import mcp` 从 `cloudledger/server.py` 里拿到那个已经登记好四个工具、一个 resource、一个 prompt 的 `MCPServer` 对象。能这么导入,是因为 `cloudledger/` 里有 `__init__.py`(Day 287 写测试时加的),它是一个包。导入时 `server.py` 最下面的 `if __name__ == "__main__":` 不会执行,所以不会顺手起一个 stdio server。
- `mcp.run(transport="streamable-http", host="127.0.0.1", port=8765)` 昨天以前一直是 `mcp.run()`,默认 `transport="stdio"`。换成 `"streamable-http"` 后,SDK 会用 uvicorn(一个 Python 的 HTTP 服务器,相当于 Node 里 `http.createServer` 那一层)起一个 Web 服务。`host="127.0.0.1"` 表示只接受本机连接,`port` 默认是 8000,我换成 8765 免得和 Day 79 的 FastAPI 撞端口。路径默认是 `/mcp`。

</div>

终端 A 启动:

```bash
uv run python -m cloudledger.server_http
```

<div class="line-notes">

- `uv run python -m cloudledger.server_http` 用 `-m` 按模块方式运行([Day 33](/blog/agent-zero/day-033-packages/)),这样 `from cloudledger.server import mcp` 才找得到包。直接写 `python cloudledger/server_http.py` 会报 `ModuleNotFoundError: No module named 'cloudledger'`,因为那样 Python 只把 `cloudledger/` 目录本身放进搜索路径。

</div>

我这里的输出:

```text
INFO:     Started server process [34791]
INFO:     Waiting for application startup.
[10/22/26 23:45:16] INFO     StreamableHTTP       streamable_http_manager.py:162
                             session manager
                             started
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:8765 (Press CTRL+C to quit)
```

它停在这里不动了,这是对的。和 stdio 不同,这个进程不等任何人拉它,自己开着门等请求。在终端 B 用 `lsof -iTCP:8765 -sTCP:LISTEN` 能看到一个 python 进程占着这个端口。

## 第 2 步:client 用网址连

[Day 288](/blog/agent-zero/day-288-mcp-client/) 的 `Client` 构造时传的是 `StdioServerParameters`(告诉它用什么命令拉起 server)。换成 HTTP,只要传一个网址字符串:

```python
# agent-zero-lab/part05/http_client.py
"""用网址连 CloudLedger,不再自己拉起子进程。"""
import anyio
from mcp import Client

URL = "http://127.0.0.1:8765/mcp"


async def main() -> None:
    async with Client(URL) as client:
        print("协议版本:", client.protocol_version)
        listing = await client.list_tools()
        print("工具:", [t.name for t in listing.tools])
        result = await client.call_tool("find_customer", {"query": "C007"})
        print("is_error:", result.is_error)
        print("结果:", result.structured_content)


if __name__ == "__main__":
    anyio.run(main)
```

<div class="line-notes">

- `URL = "http://127.0.0.1:8765/mcp"` 末尾的 `/mcp` 不能省,server 只在这个路径上收 MCP 请求,`http://127.0.0.1:8765/` 本身是 404。
- `async with Client(URL) as client:` `Client` 看到参数是字符串,就当成网址,内部用 `streamable_http_client` 这个传输去连。和 stdio 版相比,这里没有任何子进程,`async with` 退出时也不会去关 server,server 还在终端 A 开着。
- `print("协议版本:", client.protocol_version)` 打印协商出来的协议版本。我这里是 `2026-07-28`,也就是 [Day 277](/blog/agent-zero/day-277-mcp-spec-2026/) 讲的新版规范。后面连 Gradio 时它会变,先记住这个值。
- `listing = await client.list_tools()` 和 stdio 时完全一样的调用。传输换了,上面的协议没变,这正是 MCP 把「传输层」和「消息层」分开的好处。
- `result = await client.call_tool("find_customer", {"query": "C007"})` 查 C007。
- `print("结果:", result.structured_content)` 实跑得到 `{'result': [{'id': 'C007', 'name': '刘静', 'email': 'user007@example.com', 'company': '半岛咖啡'}]}`。外面套的 `result` 是因为工具返回的是列表,SDK 把列表包进一个对象里当结构化结果(Day 281)。

</div>

终端 B 运行 `uv run python -m part05.http_client`:

```text
协议版本: 2026-07-28
工具: ['find_customer', 'get_subscription', 'list_invoices', 'create_refund_request']
is_error: False
结果: {'result': [{'id': 'C007', 'name': '刘静', 'email': 'user007@example.com', 'company': '半岛咖啡'}]}
```

回头看终端 A,多了三行:

```text
INFO:     127.0.0.1:55029 - "POST /mcp HTTP/1.1" 200 OK
INFO:     127.0.0.1:55029 - "POST /mcp HTTP/1.1" 200 OK
INFO:     127.0.0.1:55029 - "POST /mcp HTTP/1.1" 200 OK
```

三次 POST 分别是什么?我给 httpx2 挂了个钩子把请求头打出来看,三次的 `Mcp-Method` 头依次是 `server/discover`、`tools/list`、`tools/call`(第三次还带 `Mcp-Name: find_customer`)。第一次是 2026-07-28 版协议的「先问问你是谁、支持什么」,后两次就是我们代码里那两个调用。每次 MCP 调用就是一次普通的 HTTP POST,和你在 DevTools 的 Network 面板里看到的 `fetch('/api/xxx', {method: 'POST'})` 没有本质区别。

**这一步的小结**:工具代码一行没动,只换了启动方式和连接方式。HTTP 版的 server 是独立进程,client 用网址连。

## 第 3 步:一条 curl 就能提交退款

既然每次调用都是普通的 HTTP POST,那就不需要 SDK,也不需要 Claude Code,用 curl 就能调。我们来扮演一个「路过的陌生人」。

新版协议要求请求里带几个头,还要在 `params._meta` 里带上协议版本和客户端能力。这些是我照着 server 的报错一条条补出来的:第一次只发 JSON,回 `-32602 params._meta must be an object carrying the required 'io.modelcontextprotocol/protocolVersion' and 'io.modelcontextprotocol/clientCapabilities' envelope keys`;补上以后,又依次提示 `mcp-method header does not match the request body's method`、`mcp-name header does not match the request body's 'name' parameter`。全补齐是这样:

```bash
# agent-zero-lab/part05/no_auth_attack.sh
# 不用任何 SDK、不带任何凭证,一条 curl 就能提交退款申请
curl -sS -X POST http://127.0.0.1:8765/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2026-07-28" \
  -H "Mcp-Method: tools/call" \
  -H "Mcp-Name: create_refund_request" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_refund_request","arguments":{"invoice_id":"INV-2026-0026","amount_yuan":2392,"reason":"路过的陌生人随手提的"},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'
echo
```

<div class="line-notes">

- `curl -sS -X POST http://127.0.0.1:8765/mcp \` `-sS` 是安静模式但出错时仍然打印错误,`-X POST` 指定方法。行尾的 `\` 表示命令没完、下一行接着写。
- `-H "Accept: application/json, text/event-stream" \` 告诉 server 两种响应格式都能收:普通 JSON,或者 SSE 流([Day 133](/blog/agent-zero/day-133-sse-principle/))。这个 server 对简单调用直接回 JSON。
- `-H "MCP-Protocol-Version: 2026-07-28" \` 协议版本放在头里,server 不用解析 body 就知道该按哪版规则处理。
- `-H "Mcp-Method: tools/call" \` 新版协议要求把方法名也放进头里,方便网关、负载均衡这些不懂 JSON-RPC 的中间设备按方法做路由和限流。server 会核对它和 body 里的 `method` 是否一致。
- `-H "Mcp-Name: create_refund_request" \` 同理,调哪个工具也放一份在头里。第 4 步的中间件和练习 1 都会用到这两个头。
- `-d '{"jsonrpc":"2.0","id":1,"method":"tools/call"` body 是 JSON-RPC 格式([Day 275](/blog/agent-zero/day-275-json-rpc/)),`arguments` 里是退款的三个参数:发票 `INV-2026-0026`(C007 的 10 月发票之一)、2392 元、一个随手编的理由。末尾的 `_meta` 里带着协议版本和客户端能力:新版协议是无会话的,每个请求都要自报家门,不再靠先 `initialize` 握手建立会话。
- `echo` server 的响应没有换行结尾,补一个换行让终端提示符另起一行。

</div>

终端 B 跑 `bash part05/no_auth_attack.sh`:

```text
{"jsonrpc":"2.0","id":1,"result":{"content":[{"text":"{\n  \"refund_request_id\": 1,\n  \"status\": \"pending_approval\",\n  \"amount_yuan\": \"2392.00\"\n}","type":"text"}],"isError":false,"resultType":"complete","structuredContent":{"refund_request_id":1,"status":"pending_approval","amount_yuan":"2392.00"},"_meta":{"io.modelcontextprotocol/serverInfo":{"name":"cloudledger","version":""}}}}
```

查一下库:

```bash
sqlite3 cloudledger/cloudledger.db "select id, invoice_id, amount_cents, reason, status from refund_requests"
```

```text
1|INV-2026-0026|239200|路过的陌生人随手提的|pending_approval
```

终端 A 的日志里也老老实实记了一笔 `refund request 1 created for INV-2026-0026`。

一个陌生人,不知道任何密码,往客户的发票上挂了一笔 2392 元的退款申请。好在 [Day 283](/blog/agent-zero/day-283-mcp-read-write/) 把写工具设计成只写 `pending_approval`,真正退钱还要主管点头,这是第二道防线在起作用。但查客户邮箱、查每张发票金额这些只读工具,陌生人同样随便调,这些就没有第二道防线了,数据一旦被读走就收不回来。

现在 server 只绑在 `127.0.0.1`,陌生人至少得先进到你的电脑。如果为了「让同事也能用」改成 `host="0.0.0.0"`(监听所有网卡),同一个 Wi-Fi 下的任何人都能做刚才这件事;部署到公网就是全世界。

**这一步的小结**:HTTP 版的 MCP server 就是一个普通的 Web 接口。没有鉴权,任何能发 HTTP 请求的东西都能调它的每一个工具,包括写工具。在终端 A 按 Ctrl+C 停掉它。

## 第 4 步:加上 Bearer token

### 先想清楚要做什么

[Day 82](/blog/agent-zero/day-082-auth-1/) 给 FastAPI 加过 API key:每个请求带 `X-API-Key` 头,服务端拿去比对。今天做的是同一件事,换一个更标准的头:`Authorization: Bearer <token>`。

**Bearer token**(持有者令牌)的意思是「谁拿着这串字符,谁就被当成它代表的那个身份」,像一张不记名的门禁卡。[Day 63](/blog/agent-zero/day-063-rest-api/) 调 DeepSeek 时你带的 `Authorization: Bearer sk-...` 就是它,当时你是调用方,今天你是被调用方。MCP 规范在 HTTP 传输上就是要求 client 把令牌放在这个头里,而且**每个请求都要带**,不能放在网址的查询参数里(网址会进日志、进浏览器历史)。

放在哪一层检查?工具函数里不行,四个工具每个都要写一遍,漏一个就是漏洞;而且 `tools/list` 这种请求根本不经过工具函数。要在所有请求进门之前统一拦,也就是 [Day 81](/blog/agent-zero/day-081-fastapi-3/) 学的**中间件**。FastAPI 的中间件其实就是 Starlette 的中间件(FastAPI 建在 Starlette 上面),MCP SDK 的 HTTP 服务也建在 Starlette 上面,所以写法几乎一样。

### 代码

```python
# agent-zero-lab/cloudledger/server_auth.py
"""带鉴权的 HTTP 版:每个请求都要带 Authorization: Bearer <token>,否则 401。"""
import os
import secrets

import uvicorn
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from cloudledger.server import mcp

TOKENS = {  # token → 调用方是谁。真实系统里这张表在数据库或授权服务器里
    os.environ["CLOUDLEDGER_TOKEN_SUPPORT"]: "support-bot",
}


def who_is(token: str) -> str | None:
    for known, client_id in TOKENS.items():
        if secrets.compare_digest(token.encode(), known.encode()):
            return client_id
    return None


class BearerAuth(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        header = request.headers.get("authorization", "")
        scheme, _, token = header.partition(" ")
        client_id = who_is(token) if scheme.lower() == "bearer" and token else None
        if client_id is None:
            return JSONResponse(
                {"error": "unauthorized", "message": "缺少或错误的 Bearer token"},
                status_code=401,
                headers={"WWW-Authenticate": "Bearer"},
            )
        print(f"[auth] {client_id} -> {request.headers.get('mcp-method')} {request.headers.get('mcp-name') or ''}", flush=True)
        return await call_next(request)


app = mcp.streamable_http_app()
app.add_middleware(BearerAuth)

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="warning")
```

<div class="line-notes">

- `import secrets` 标准库里做密码学安全操作的模块,下面用它的 `compare_digest`。Day 82 生成密钥用的也是它。
- `import uvicorn` 第 1 步里 `mcp.run(...)` 在内部替我们调了 uvicorn,这次要先给应用套一层中间件,所以自己调。
- `from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint` `BaseHTTPMiddleware` 是 Starlette 提供的中间件基类,继承它、写一个 `dispatch` 方法就行。`RequestResponseEndpoint` 只是 `call_next` 的类型名,给类型检查用。
- `from cloudledger.server import mcp` 还是同一个 server 对象,工具代码照旧一行不改。
- `TOKENS = {  # token → 调用方是谁` 一张「令牌 → 身份」的表。现在只有一条:客服机器人。
- `os.environ["CLOUDLEDGER_TOKEN_SUPPORT"]: "support-bot",` 令牌从环境变量读,不写进代码,更不进 git([Day 53](/blog/agent-zero/day-053-env-secrets/))。这里故意用 `os.environ[...]` 而不是 `.get(...)`:没设置就直接 `KeyError` 起不来,比「没设置就变成空字符串、谁都能进」安全得多。
- `def who_is(token: str) -> str | None:` 给一个令牌,返回它代表谁;不认识返回 `None`。
- `if secrets.compare_digest(token.encode(), known.encode()):` 不用 `==` 比较。`==` 从第一个字符开始比,一发现不同就立刻返回,攻击者可以通过测量响应时间一位一位猜出令牌;`compare_digest` 不管哪里不同都花一样的时间。`.encode()` 转成 bytes,原因 Day 82 讲过:它碰到非 ASCII 的字符串会直接报 `TypeError`。
- `class BearerAuth(BaseHTTPMiddleware):` 我们的中间件。相当于 Express 里 `app.use(async (req, res, next) => {...})`。
- `async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:` 每个请求进来都会先到这里。`call_next(request)` 表示「放行,交给后面的 MCP 处理」,它返回 MCP 那边生成的响应。
- `header = request.headers.get("authorization", "")` 取 `Authorization` 头。Starlette 的 headers 不区分大小写,写小写就行;没带就是空字符串。
- `scheme, _, token = header.partition(" ")` `partition` 在第一个空格处切成三段:空格前、空格本身、空格后。`"Bearer abc123"` 切成 `("Bearer", " ", "abc123")`;空字符串切成 `("", "", "")`。中间那段用 `_` 接住表示不要。
- `client_id = who_is(token) if scheme.lower() == "bearer" and token else None` 方案名必须是 Bearer(规范说不区分大小写,所以先 `.lower()`),而且令牌不能是空的,才去查表。条件表达式 `A if 条件 else B` 相当于 JS 的 `条件 ? A : B`。
- `return JSONResponse(` 没通过就**直接返回响应,不调用 `call_next`**,请求根本到不了 MCP 那边,工具函数一个都不会执行。
- `status_code=401,` 401 的意思是「你是谁我不知道」。如果是「知道你是谁,但你没这个权限」应该回 403,练习 1 会用到。
- `headers={"WWW-Authenticate": "Bearer"},` HTTP 规定 401 响应要带这个头,告诉对方「请用 Bearer 方案来认证」。正式的 MCP 鉴权会在这里多带一个 `resource_metadata` 地址,client 顺着它去找授权服务器,后面讲。
- `print(f"[auth] {client_id} -> {request.headers.get('mcp-method')}` 通过的请求打一行日志:谁、调了什么方法、哪个工具。这就是第 3 步那两个头的用处,中间件不用解析 JSON body 就知道请求在干什么。`flush=True` 让它立刻输出,不然输出被重定向到文件时会攒在缓冲区里看不到。
- `return await call_next(request)` 放行。
- `app = mcp.streamable_http_app()` 让 SDK 把 MCP server 包成一个 Starlette 应用对象,但先不启动。第 1 步的 `mcp.run(transport="streamable-http")` 内部做的就是这一步加上 uvicorn 启动。
- `app.add_middleware(BearerAuth)` 给应用套上中间件。所有请求都会先经过 `BearerAuth.dispatch`。
- `uvicorn.run(app, host="127.0.0.1", port=8765, log_level="warning")` 自己启动。`log_level="warning"` 把每个请求一行的访问日志关掉,只看我们自己打的 `[auth]` 那行。

</div>

### 生成令牌,启动

终端 A:

```bash
export CLOUDLEDGER_TOKEN_SUPPORT=$(uv run python -c "import secrets; print(secrets.token_urlsafe(24))")
echo $CLOUDLEDGER_TOKEN_SUPPORT
uv run python -m cloudledger.server_auth
```

<div class="line-notes">

- `export CLOUDLEDGER_TOKEN_SUPPORT=$(uv run python -c "import secrets; print(secrets.token_urlsafe(24))")` `$(...)` 先执行括号里的命令,把输出当成值。`token_urlsafe(24)` 生成 24 字节随机数,编码成 32 个字符左右、只含字母数字和 `-_` 的字符串。`export` 让后面在这个终端里启动的程序都能读到这个变量。
- `echo $CLOUDLEDGER_TOKEN_SUPPORT` 打出来,一会儿要复制到终端 B。真实环境里这串东西就是密码,别贴到聊天群、别截图发出去。
- `uv run python -m cloudledger.server_auth` 启动。只会看到 SDK 那几行 `StreamableHTTP session manager started`,之后安静等待。

</div>

忘了 `export` 直接启动,会看到:

```text
  File "<frozen os>", line 714, in __getitem__
KeyError: 'CLOUDLEDGER_TOKEN_SUPPORT'
```

这是我们想要的结果:不设令牌就不让开门。

### 再当一次陌生人

终端 B 重跑第 3 步的攻击脚本,再试一个乱猜的令牌:

```bash
bash part05/no_auth_attack.sh
curl -sS -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:8765/mcp -H "Authorization: Bearer guess123" -d '{}'
```

```text
{"error":"unauthorized","message":"缺少或错误的 Bearer token"}
401
```

没带令牌、带错令牌都被挡在门外。库里 `refund_requests` 是 0 条(开始前重新 seed 过),工具一次都没被执行。

再用第 2 步的 `http_client.py` 去连(它没带令牌):

```text
      | mcp.shared.exceptions.MCPError: Server returned an error response
      +------------------------------------
```

前面还有几十行 traceback。注意这条报错**一个字都没提 401 或鉴权**,只说「server 返回了错误」。这是我实际排查时最容易卡住的地方:看到这句先别怀疑代码,用 curl 打一下同一个地址,看看状态码是不是 401。

### client 带上令牌

```python
# agent-zero-lab/part05/http_client_auth.py
"""带上 Bearer token 再连。token 从环境变量读,不写进代码。"""
import os

import anyio
import httpx2
from mcp import Client
from mcp.client.streamable_http import streamable_http_client

URL = "http://127.0.0.1:8765/mcp"


async def main() -> None:
    token = os.environ["CLOUDLEDGER_TOKEN"]
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx2.AsyncClient(headers=headers) as http:
        async with Client(streamable_http_client(URL, http_client=http)) as client:
            listing = await client.list_tools()
            print("工具:", [t.name for t in listing.tools])
            result = await client.call_tool("get_subscription", {"customer_id": "C007"})
            print("结果:", result.structured_content)


if __name__ == "__main__":
    anyio.run(main)
```

<div class="line-notes">

- `import httpx2` MCP SDK 2.x 用的 HTTP 客户端库,随 `mcp` 一起装好了。用法和你可能见过的 `httpx`、前端的 `axios` 很像。
- `from mcp.client.streamable_http import streamable_http_client` 第 2 步里 `Client(URL)` 在内部替我们调的就是它。要定制 HTTP 请求(加头、改超时),就得自己调。
- `token = os.environ["CLOUDLEDGER_TOKEN"]` client 这边的变量名和 server 不一样,是故意的:server 存的是「所有合法令牌」,client 拿的是「我自己这一张」。真实场景里它们本来就在两台机器上。
- `headers = {"Authorization": f"Bearer {token}"}` 拼出标准的头。`Bearer` 和令牌之间是一个空格。
- `async with httpx2.AsyncClient(headers=headers) as http:` 建一个默认带这个头的 HTTP 客户端,之后它发出的**每一个**请求都会带上,正好满足规范「每个请求都要带」的要求。相当于 axios 的 `axios.create({ headers: {...} })`。
- `async with Client(streamable_http_client(URL, http_client=http)) as client:` 把这个 HTTP 客户端交给 MCP 的传输层。早期的 SDK 1.x 教程里常见 `streamablehttp_client(url, headers=...)` 的写法,2.x 里已经没有 `headers=` 参数了,照抄会报 `unexpected keyword argument`。
- `result = await client.call_tool("get_subscription", {"customer_id": "C007"})` 这次换个工具,查 C007 的订阅。

</div>

终端 B,先把终端 A 打印的令牌设进来,然后跑:

```bash
export CLOUDLEDGER_TOKEN=粘贴终端A里echo出来的那串
uv run python -m part05.http_client_auth
```

```text
工具: ['find_customer', 'get_subscription', 'list_invoices', 'create_refund_request']
结果: {'id': 'S007', 'customer_id': 'C007', 'plan': '企业版', 'billing_cycle': 'monthly', 'seats': 8, 'status': 'active', 'started_at': '2026-03-15', 'current_period_end': '2026-11-08'}
```

终端 A 打出了三行审计日志:

```text
[auth] support-bot -> server/discover
[auth] support-bot -> tools/list
[auth] support-bot -> tools/call get_subscription
```

把 `CLOUDLEDGER_TOKEN` 改成 `guess123` 再跑,又回到那句 `Server returned an error response`。

### 让 Claude Code 连远程 server(这段没实跑)

Claude Code 连 HTTP server 不用写启动命令,给网址和头就行。按 [Claude Code 的 MCP 文档](https://code.claude.com/docs/en/mcp)(2026 年 10 月查到),写法是:

```bash
claude mcp add --transport http cloudledger-http http://127.0.0.1:8765/mcp \
  --header "Authorization: Bearer 你的令牌"
```

<div class="line-notes">

- `--transport http` 告诉它这是 HTTP server,后面跟的是网址,不是命令。Day 289 吃过亏的「相对路径」问题在这里不存在了,因为 Claude Code 不需要启动任何进程。
- `--header "Authorization: Bearer 你的令牌"` 每个请求都会带上这个头。也可以写进项目的 `.mcp.json`,文档里给的写法是 `"headers": {"Authorization": "Bearer ${API_KEY}"}`,用 `${变量名}` 引用环境变量,令牌就不用进仓库。

</div>

这一段我没实跑:它会改动用户级的 Claude Code 配置,我只在自己的 scratchpad 里做实验。你在自己电脑上跑完记得 `claude mcp remove cloudledger-http`。

**这一步的小结**:鉴权放在中间件里,所有请求进门前统一检查,不通过直接 401,工具一个都执行不到。client 用一个带默认头的 `httpx2.AsyncClient` 把令牌带上。

## 正式的做法:OAuth 2.1 比今天多了什么

今天的「一张令牌表」能挡住陌生人,但它有几个明显的问题:令牌是你手动生成、手动发给同事的;一张令牌永久有效,泄露了只能改表重启;所有人都直接拿「最终的钥匙」,没有用户本人点头同意这一步。

[MCP 规范的 Authorization 一节](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)(2026-07-28 版)规定的正式方案是 OAuth 2.1。先说清楚它在 MCP 里是**可选的**:规范原话是 Authorization is OPTIONAL;用 HTTP 传输时如果要做鉴权,应当按这一节来;用 stdio 时不要用它,凭证从环境变量拿(Day 288 练习里传 `CLOUDLEDGER_DB` 就是这个思路)。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="OAuth 流程简图:client 不带令牌请求 MCP server 得到 401 和资源元数据地址;client 去授权服务器,用户在浏览器里同意;授权服务器发令牌;client 带令牌访问 MCP server">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="90" width="120" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="80" y="110" fill="var(--ink)" text-anchor="middle">MCP client</text><text x="80" y="126" fill="var(--ink-faint)" text-anchor="middle" font-size="11">Claude Code 等</text>
<rect x="470" y="30" width="150" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="545" y="50" fill="var(--ink)" text-anchor="middle">MCP server</text><text x="545" y="66" fill="var(--ink-faint)" text-anchor="middle" font-size="11">资源服务器</text>
<rect x="470" y="150" width="150" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--ink)"/><text x="545" y="170" fill="var(--ink)" text-anchor="middle">授权服务器</text><text x="545" y="186" fill="var(--ink-faint)" text-anchor="middle" font-size="11">登录、同意、发令牌</text>
<line x1="140" y1="100" x2="470" y2="45" stroke="var(--ink-soft)"/>
<text x="240" y="58" fill="var(--ink-soft)" font-size="11">① 不带令牌 → 401 + 去哪拿令牌</text>
<line x1="140" y1="124" x2="470" y2="172" stroke="var(--ink-soft)"/>
<text x="200" y="175" fill="var(--ink-soft)" font-size="11">② 浏览器里登录、点同意</text>
<text x="200" y="192" fill="var(--ink-soft)" font-size="11">③ 拿到只给这个 server 用的短期令牌</text>
<line x1="140" y1="112" x2="470" y2="60" stroke="var(--compute)" stroke-dasharray="4 3"/>
<text x="250" y="102" fill="var(--compute)" font-size="11">④ 每个请求带 Bearer 令牌</text>
<text x="20" y="218" fill="var(--ink-faint)" font-size="11">今天的版本只做了 ④:令牌是我们手动发的,①②③ 都省掉了</text>
</g>
</svg>
<figcaption>OAuth 把「发令牌」交给一个专门的授权服务器,MCP server 只负责验令牌。今天的手写版相当于只实现了最后一步。</figcaption>
</figure>

几个和今天直接相关的点,都是规范原文的要求:

- MCP server 的角色是 OAuth 里的**资源服务器**(resource server),只负责验令牌;发令牌的是单独的**授权服务器**(authorization server),它可以和 MCP server 部署在一起,也可以是公司现成的登录系统。
- 401 响应的 `WWW-Authenticate` 头要带上 `resource_metadata="https://.../.well-known/oauth-protected-resource"`,client 顺着这个地址找到授权服务器在哪。这样用户只需要填一个 MCP 网址,剩下的 Claude Code 会自己弹浏览器让你登录。
- 令牌必须是**发给这个 MCP server 的**,server 要核对令牌的受众(audience);拿别的服务的令牌来,必须拒绝。server 也不能把收到的令牌转手拿去调别的服务(规范叫 token passthrough,明令禁止)。
- 权限不够时回 403,并在 `WWW-Authenticate` 里写 `error="insufficient_scope"` 和需要的 `scope`。练习 1 做的就是一个简化版。

Python SDK 里对应的接口是 `MCPServer(token_verifier=..., auth=AuthSettings(...))`:你实现一个 `verify_token(token)` 方法去问授权服务器「这个令牌有效吗、是谁的、有哪些权限」,SDK 替你返回带 `resource_metadata` 的 401、挂上 `/.well-known/oauth-protected-resource` 路由。我们的 `server.py` 在 Day 281 构造 `MCPServer` 时没传这些参数,所以今天用中间件从外面包一层,效果对「挡住陌生人」是一样的。完整的 OAuth 接入放到第七部分讲权限和凭证的时候([Day 413](/blog/agent-zero/day-413-least-privilege/) 前后)。

还有两件上公网前必须做的事,今天只提一句:一是 **HTTPS**,`http://` 上的 Bearer 令牌是明文,同一个网络里的人抓包就能看到,公网必须套 HTTPS(一般由前面的反向代理或云平台负责);二是 **DNS rebinding 防护**,恶意网页可以想办法让你的浏览器去访问 `127.0.0.1:8765`,SDK 的 `streamable_http_app(transport_security=TransportSecuritySettings(...))` 可以只接受指定的 `Host` 和 `Origin` 头。

## 第 5 步:用 Gradio 放一个能点的演示版

写简历、发帖子时你会想让别人点一个链接就能试试。让面试官先装 Claude Code、再配令牌,没人会这么做。**Gradio** 是一个 Python 库,写一个普通函数,它就自动生成一个网页表单;`launch(mcp_server=True)` 还能让同一个函数同时成为 MCP 工具。机器学习圈用它做 demo 很多,Hugging Face 的 Spaces 能免费托管它。

### 先撞一个依赖冲突

2026 年 10 月 PyPI 上最新的是 gradio 6.30.0,它的 `mcp` 可选依赖写的是 `mcp<2.0.0,>=1.21.0`(`curl -s https://pypi.org/pypi/gradio/json` 能查到),和我们 lab 锁定的 `mcp[cli]==2.3.0` 冲突,不可能装进同一个项目。所以演示版**单独放一个目录**,依赖分开。这也正好是演示版该有的样子:它和正式 server 是两个东西,只拷一份造的数据、只放只读工具。

```bash
mkdir -p ~/cloudledger-demo
cp ~/agent-zero-lab/cloudledger/cloudledger.db ~/cloudledger-demo/
```

<div class="line-notes">

- `mkdir -p ~/cloudledger-demo` 和 `agent-zero-lab` 平级,不放在 lab 里面,免得 uv 把它当成 lab 的一部分。
- `cp ~/agent-zero-lab/cloudledger/cloudledger.db ~/cloudledger-demo/` 复制一份造出来的假数据。演示站谁都能访问,**绝不能放真实客户数据**。

</div>

```python
# cloudledger-demo/app.py
"""Gradio 演示版:网页上能点,同时是一个 MCP server。只放只读工具和造的数据。"""
import json
import sqlite3
from pathlib import Path

import gradio as gr

DB = Path(__file__).parent / "cloudledger.db"


def find_customer(query: str) -> str:
    """按邮箱、姓名、公司或编号查找 CloudLedger 客户,最多返回 5 条。

    Args:
        query: 邮箱、姓名、公司名或客户编号,如 user007@example.com 或 C007
    """
    like = f"%{query.strip()}%"
    with sqlite3.connect(f"file:{DB}?mode=ro", uri=True) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT id, name, email, company FROM customers "
            "WHERE id = ? OR email LIKE ? OR name LIKE ? OR company LIKE ? LIMIT 5",
            (query.strip().upper(), like, like, like),
        ).fetchall()
    if not rows:
        return f"没有找到和「{query}」匹配的客户,换邮箱或客户编号再试。"
    return json.dumps([dict(r) for r in rows], ensure_ascii=False)


demo = gr.Interface(
    fn=find_customer,
    inputs=gr.Textbox(label="邮箱 / 姓名 / 公司 / 编号"),
    outputs=gr.Textbox(label="结果"),
    title="CloudLedger 客户查询(演示数据)",
    api_name="find_customer",
)

if __name__ == "__main__":
    demo.launch(mcp_server=True)
```

<div class="line-notes">

- `import gradio as gr` 惯例简写成 `gr`,像 `import React from 'react'` 一样大家都这么写。
- `DB = Path(__file__).parent / "cloudledger.db"` 用 `app.py` 所在目录下那份副本。
- `def find_customer(query: str) -> str:` Gradio 用**函数名当工具名**,用**类型标注生成参数 schema**。返回 `str` 是因为下面的输出组件是文本框。
- `"""按邮箱、姓名、公司或编号查找` docstring 第一段变成工具描述。Gradio 官方指南说它从 docstring 和类型标注生成工具描述。
- `query: 邮箱、姓名、公司名或客户编号` `Args:` 下面这一行变成参数 `query` 的描述。下面实测能看到它原样出现在 `input_schema` 里。
- `with sqlite3.connect(f"file:{DB}?mode=ro", uri=True) as conn:` 以只读方式打开 SQLite。参数都用 `?` 占位([Day 92](/blog/agent-zero/day-092-python-sqlite-1/))本来就防住了 SQL 注入,只读再多一层保险:就算哪天有人在这里加了个拼字符串的新功能,数据库本身也不让写。Day 292 会专门讲只读连接挡得住什么、挡不住什么。
- `(query.strip().upper(), like, like, like),` 查 `C007` 时第一个参数是 `"C007"`,`like` 是 `"%C007%"`,`id = ?` 那个条件命中。这段查询和 `server.py` 里的 `find_customer` 一样。
- `return f"没有找到和「{query}」匹配的客户` 查不到时返回一句能指导模型改参数的话。Gradio 这里没有 `ToolError`,只能用普通文字表达失败,client 拿到的 `is_error` 是 `False`,下面实测验证。这是它比我们自己的 server 粗糙的地方。
- `return json.dumps([dict(r) for r in rows], ensure_ascii=False)` `ensure_ascii=False` 让中文原样输出,不变成 `刘` 这种转义。
- `demo = gr.Interface(` `Interface` 是 Gradio 最简单的界面:一个函数、一组输入组件、一组输出组件。
- `api_name="find_customer",` 固定接口名。不写的话 Gradio 默认叫 `predict`,工具名就没意义了。
- `demo.launch(mcp_server=True)` 同时启动网页(默认 7860 端口)和 MCP 端点。也可以不改代码,设环境变量 `GRADIO_MCP_SERVER=True`。

</div>

运行(终端 A,先 Ctrl+C 停掉 `server_auth`):

```bash
cd ~/cloudledger-demo
uv run --no-project --python 3.12 --with "gradio[mcp]==6.30.0" python app.py
```

<div class="line-notes">

- `uv run --no-project --python 3.12 --with "gradio[mcp]==6.30.0" python app.py` `--no-project` 表示不找、不碰任何 `pyproject.toml`;`--with` 临时建一个环境装上 gradio 再运行,用完不污染任何项目。类比前端的 `npx`。我这里第一次装了 67 个包,用了 23 秒;它自带的 mcp 是 1.30.0。

</div>

```text
* Running on local URL:  http://127.0.0.1:7860
* To create a public link, set `share=True` in `launch()`.

🔨 Launching MCP server:
* Streamable HTTP URL: http://127.0.0.1:7860/gradio_api/mcp/
```

浏览器打开 `http://127.0.0.1:7860`,能看到一个输入框和一个结果框,输入 `C007` 点 Submit 就有结果。这是给人点的那一面。给模型用的那一面,用 lab 里的 2.x client 连上去看看(终端 B,回到 `agent-zero-lab/`):

```python
# agent-zero-lab/part05/gradio_probe.py
"""用 lab 里的 2.x client 连 Gradio 演示版,看协议版本、工具描述和一次调用。"""
import json

import anyio
from mcp import Client
from mcp.types import TextContent

URL = "http://127.0.0.1:7860/gradio_api/mcp/"


async def main() -> None:
    async with Client(URL) as client:
        print("协议版本:", client.protocol_version)
        tool = (await client.list_tools()).tools[0]
        print("工具名:", tool.name)
        print("描述:", tool.description)
        print("参数:", json.dumps(tool.input_schema, ensure_ascii=False))
        result = await client.call_tool(tool.name, {"query": "C007"})
        print("is_error:", result.is_error)
        texts = [b.text for b in result.content if isinstance(b, TextContent)]
        print("结果:", texts[0] if texts else None)
        miss = await client.call_tool(tool.name, {"query": "不存在的人"})
        print("查不到时 is_error:", miss.is_error)


if __name__ == "__main__":
    anyio.run(main)
```

<div class="line-notes">

- `URL = "http://127.0.0.1:7860/gradio_api/mcp/"` Gradio 的 MCP 端点路径是固定的 `/gradio_api/mcp/`,末尾斜杠也照着它打印的写。
- `tool = (await client.list_tools()).tools[0]` 只有一个工具,直接取第一个。
- `print("参数:", json.dumps(tool.input_schema, ensure_ascii=False))` 看 Gradio 从类型标注和 docstring 生成的 JSON Schema。
- `texts = [b.text for b in result.content if isinstance(b, TextContent)]` `content` 里可能有文字、图片、音频等好几种块,只有文字块有 `.text`。不先用 `isinstance` 筛一下,basedpyright 会报 `Cannot access attribute "text" for class "ImageContent"`,我第一版就是这么被它标红的。
- `miss = await client.call_tool(tool.name, {"query": "不存在的人"})` 故意查一个不存在的,看失败时 `is_error` 是什么。

</div>

`uv run python -m part05.gradio_probe`:

```text
协议版本: 2025-11-25
工具名: find_customer
描述: 按邮箱、姓名、公司或编号查找 CloudLedger 客户,最多返回 5 条。
参数: {"type": "object", "properties": {"query": {"type": "string", "description": "邮箱、姓名、公司名或客户编号,如 user007@example.com 或 C007"}}, "required": ["query"]}
is_error: False
结果: [{"id": "C007", "name": "刘静", "email": "user007@example.com", "company": "半岛咖啡"}]
查不到时 is_error: False
```

三处值得看。第一,协议版本是 `2025-11-25`,不是第 2 步看到的 `2026-07-28`:Gradio 内部用的是 mcp 1.30.0,只会老版协议,我们的 2.x client 发现对方不认新版,自动退回老版,代码里什么都不用做。第二,docstring 和 `Args:` 原样变成了描述和参数说明,所以 docstring 写得好不好,直接决定模型会不会用它,这和 Day 281 写工具描述是一个道理。第三,查不到时 `is_error` 也是 `False`,模型只能靠读那句中文判断失败了。

### 放到公网(这段没实跑)

有两条路。**临时链接**:`demo.launch(mcp_server=True, share=True)`,Gradio 会通过它的转发服务器给你一个 `https://xxxx.gradio.live` 的公网地址,只要你本机的进程开着就能访问,过一段时间自动失效(启动时会打印有效期)。**长期托管**:在 huggingface.co 新建一个 Space,SDK 选 Gradio,硬件选免费的 CPU,上传 `app.py`、`cloudledger.db` 和一个写着 `gradio[mcp]` 的 `requirements.txt`。启动后 MCP 地址是 `https://用户名-space名.hf.space/gradio_api/mcp/`,步骤以 [Spaces 的 Gradio 文档](https://huggingface.co/docs/hub/spaces-sdks-gradio)为准。

两条我都没实跑:`share=True` 会把我本机的端口通过第三方服务器暴露到公网,发布 Space 要注册账号上传文件,这些都超出了「只在 scratchpad 里实验」的范围。你自己做的时候守住这几条边界:只放只读工具,只放造的数据;Space 默认公开,谁都能调;免费 CPU 会休眠,第一次访问要等它醒;想加门禁,Gradio 指南里的办法是给函数加一个 `gr.Header` 类型的参数读请求头里的令牌,私有 Space 则要求调用方带 Hugging Face 的令牌。演示版就是演示版,给团队用的正式 server 还是按第 4 步的 HTTP 加鉴权来。

## 零件 → 大代码对照表

| 今天的零件 | 落在哪个文件 | 作用 |
| --- | --- | --- |
| `mcp.run(transport="streamable-http")` | `cloudledger/server_http.py` | 同一个 server 换成 HTTP |
| `Client("http://...")` | `part05/http_client.py` | 用网址连 |
| 带 `Mcp-Method`、`_meta` 的 curl | `part05/no_auth_attack.sh` | 证明没鉴权时谁都能调写工具 |
| `BearerAuth` 中间件 + `compare_digest` | `cloudledger/server_auth.py` | 进门前统一验令牌,401 |
| `httpx2.AsyncClient(headers=...)` | `part05/http_client_auth.py` | client 每个请求都带令牌 |
| `launch(mcp_server=True)` | `cloudledger-demo/app.py` | 一个函数既是表单又是 MCP 工具 |

## 花了多少钱

正文没有调模型。只有练习 3 的远程 Agent 跑了一次:`LLMClient` 账本是 `2 次调用 | 输入 1968 / 输出 207 tokens | 约 ¥0.0026`。按 deepseek-flash 高峰价(缓存命中 0.04、未命中 2、输出 8,元每百万 token,[DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) 2026 年 10 月查到)全部按未命中算的上限是 1968 × 2 ÷ 100 万 + 207 × 8 ÷ 100 万 ≈ 0.0039 + 0.0017 = ¥0.0056;第二次调用的前缀命中了缓存,账本按实际命中计价,记的是 ¥0.0026。合计约 ¥0.003。

## 动手练习

**练习 1:按令牌分权限。** 现在只要令牌对,写工具也能调。给 `server_auth.py` 做一个变体 `cloudledger/ex290_scoped.py`:两张令牌,客服机器人(`CLOUDLEDGER_TOKEN_SUPPORT`)能读能写,看板(`CLOUDLEDGER_TOKEN_READONLY`)只能读;只读令牌调 `create_refund_request` 时回 403。再写一个脚本分别用两张令牌各发一次查询和一次退款,看状态码。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/cloudledger/ex290_scoped.py
"""练习 1:两种 token,只读 token 调写工具时回 403。"""
import os
import secrets

import uvicorn
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from cloudledger.server import mcp

TOKENS = {  # token → (调用方, 能不能写)
    os.environ["CLOUDLEDGER_TOKEN_SUPPORT"]: ("support-bot", True),
    os.environ["CLOUDLEDGER_TOKEN_READONLY"]: ("dashboard", False),
}
WRITE_TOOLS = {"create_refund_request"}


def lookup(token: str) -> tuple[str, bool] | None:
    for known, who in TOKENS.items():
        if secrets.compare_digest(token.encode(), known.encode()):
            return who
    return None


class ScopedBearerAuth(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        scheme, _, token = request.headers.get("authorization", "").partition(" ")
        who = lookup(token) if scheme.lower() == "bearer" and token else None
        if who is None:
            return JSONResponse({"error": "unauthorized"}, status_code=401, headers={"WWW-Authenticate": "Bearer"})
        client_id, can_write = who
        tool = request.headers.get("mcp-name")
        if request.headers.get("mcp-method") == "tools/call" and tool in WRITE_TOOLS and not can_write:
            print(f"[auth] {client_id} 想调 {tool},没有写权限,拒绝", flush=True)
            return JSONResponse({"error": "forbidden", "message": f"{client_id} 没有调用 {tool} 的权限"}, status_code=403)
        return await call_next(request)


app = mcp.streamable_http_app()
app.add_middleware(ScopedBearerAuth)

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="warning")
```

<div class="line-notes">

- `TOKENS = {  # token → (调用方, 能不能写)` 表里的值从一个名字变成元组 `(名字, 能不能写)`。真实系统里这一列叫 scope(权限范围),比如 `cloudledger:read`、`cloudledger:write`。
- `WRITE_TOOLS = {"create_refund_request"}` 会写数据的工具。也可以像 Day 289 的 host 那样从 `annotations.read_only_hint` 自动算出来,这里写死更直观。
- `client_id, can_write = who` 元组解包,相当于 JS 的 `const [clientId, canWrite] = who`。
- `tool = request.headers.get("mcp-name")` 用第 3 步见过的 `Mcp-Name` 头判断调的是哪个工具,不用解析 body。能信它,是因为 server 会核对头和 body 是否一致,不一致直接回 `-32020`(第 3 步实测过)。
- `if request.headers.get("mcp-method") == "tools/call" and tool in WRITE_TOOLS and not can_write:` 三个条件同时成立才拦:是工具调用、是写工具、这张令牌没写权限。`tools/list` 不拦,只读令牌也能看到写工具的存在,只是调不了。
- `status_code=403)` 403 表示「我知道你是谁,但你没这个权限」,和 401 区分开。MCP 规范对权限不足的要求就是 403。

</div>

```python
# agent-zero-lab/part05/ex290_scoped_check.py
"""练习 1 的验证:同一个写请求,分别用两种 token 发,看状态码。"""
import os

import httpx2

URL = "http://127.0.0.1:8765/mcp"
META = {"io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {}}


def call(token: str, name: str, arguments: dict) -> httpx2.Response:
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments, "_meta": META}}
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/call",
        "Mcp-Name": name,
    }
    return httpx2.post(URL, json=body, headers=headers)


refund = {"invoice_id": "INV-2026-0026", "amount_yuan": 2392, "reason": "练习 1 权限测试"}
for label, env in [("只读 token", "CLOUDLEDGER_TOKEN_READONLY"), ("客服 token", "CLOUDLEDGER_TOKEN_SUPPORT")]:
    token = os.environ[env]
    r1 = call(token, "find_customer", {"query": "C007"})
    r2 = call(token, "create_refund_request", refund)
    print(f"{label}: find_customer → {r1.status_code}, create_refund_request → {r2.status_code} {r2.text[:60]}")
```

<div class="line-notes">

- `def call(token: str, name: str, arguments: dict) -> httpx2.Response:` 把第 3 步那条 curl 改写成 Python 函数,这样不用 SDK 也能精确控制每个头。
- `return httpx2.post(URL, json=body, headers=headers)` `json=` 会把字典序列化成 JSON 并自动加上 `Content-Type: application/json`。
- `for label, env in [("只读 token", "CLOUDLEDGER_TOKEN_READONLY"), ("客服 token", "CLOUDLEDGER_TOKEN_SUPPORT")]:` 先用只读令牌、再用客服令牌,各发一读一写。

</div>

运行步骤:终端 A 先 `uv run python cloudledger/seed.py` 重置库,再 `export` 两个令牌(第二个也用 `secrets.token_urlsafe(24)` 生成),`uv run python -m cloudledger.ex290_scoped`;终端 B 设好同样两个环境变量,`uv run python -m part05.ex290_scoped_check`:

```text
只读 token: find_customer → 200, create_refund_request → 403 {"error":"forbidden","message":"dashboard 没有调用 create_refund
客服 token: find_customer → 200, create_refund_request → 200 {"jsonrpc":"2.0","id":1,"result":{"content":[{"text":"{\n  \
```

终端 A 打出 `[auth] dashboard 想调 create_refund_request,没有写权限,拒绝`。库里 `refund_requests` 只有客服令牌提交的那一条。

</details>

**练习 2:演示版加第二个只读工具。** 给 Gradio 演示版加一个 `list_invoices(customer_id)`,列出客户最近 6 张发票(金额换成元),网页上两个页签,MCP 那边两个工具。用 client 确认能列出两个工具并查到 C007 的发票。

<details><summary>参考答案</summary>

```python
# cloudledger-demo/app2.py
"""练习 2:演示版加第二个只读工具 list_invoices,两个页签,两个 MCP 工具。"""
import json
import sqlite3

import gradio as gr

from app import DB, find_customer


def list_invoices(customer_id: str) -> str:
    """列出某个客户最近 6 张发票(按开票日期倒序),金额单位为元。

    Args:
        customer_id: 客户编号,如 C007。不知道编号时先用 find_customer 查
    """
    with sqlite3.connect(f"file:{DB}?mode=ro", uri=True) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT id, amount_cents, status, issued_at FROM invoices "
            "WHERE customer_id = ? ORDER BY issued_at DESC, id DESC LIMIT 6",
            (customer_id.strip().upper(),),
        ).fetchall()
    if not rows:
        return f"客户 {customer_id} 没有发票,确认编号是否来自 find_customer。"
    out = [{"id": r["id"], "amount_yuan": f"{r['amount_cents'] / 100:.2f}", "status": r["status"], "issued_at": r["issued_at"]} for r in rows]
    return json.dumps(out, ensure_ascii=False)


tab1 = gr.Interface(fn=find_customer, inputs=gr.Textbox(label="邮箱 / 姓名 / 公司 / 编号"), outputs=gr.Textbox(label="结果"), api_name="find_customer")
tab2 = gr.Interface(fn=list_invoices, inputs=gr.Textbox(label="客户编号"), outputs=gr.Textbox(label="发票"), api_name="list_invoices")
demo = gr.TabbedInterface([tab1, tab2], ["查客户", "查发票"], title="CloudLedger 演示(造的数据)")

if __name__ == "__main__":
    demo.launch(mcp_server=True)
```

<div class="line-notes">

- `from app import DB, find_customer` 复用 `app.py` 里的路径和第一个函数。能这么导入,是因为运行 `python app2.py` 时当前目录会被放进搜索路径;`app.py` 底部有 `if __name__ == "__main__":`,导入时不会启动它。
- `customer_id: 客户编号,如 C007。不知道编号时先用 find_customer 查` 参数描述里顺手写上「先查谁」,模型拿到工具列表就知道调用顺序。
- `(customer_id.strip().upper(),),` 只有一个参数时元组要写成 `(x,)`,少了逗号就不是元组了([Day 22](/blog/agent-zero/day-022-tuples-unpack/))。
- `"amount_yuan": f"{r['amount_cents'] / 100:.2f}"` 分换成元,保留两位。演示站的人和模型都不该看到「分」。
- `demo = gr.TabbedInterface([tab1, tab2]` 把两个 `Interface` 放进两个页签。每个 `Interface` 的 `api_name` 就是一个 MCP 工具名。

</div>

终端 A:`cd ~/cloudledger-demo && uv run --no-project --python 3.12 --with "gradio[mcp]==6.30.0" python app2.py`。终端 B 在 `agent-zero-lab/` 里:

```bash
uv run python -c "
import anyio
from mcp import Client
async def main():
    async with Client('http://127.0.0.1:7860/gradio_api/mcp/') as c:
        print([t.name for t in (await c.list_tools()).tools])
        r = await c.call_tool('list_invoices', {'customer_id': 'C007'})
        print(r.content[0].text[:160])
anyio.run(main)
"
```

```text
['find_customer', 'list_invoices']
[{"id": "INV-2026-0123", "amount_yuan": "2392.00", "status": "paid", "issued_at": "2026-10-08"}, {"id": "INV-2026-0026", "amount_yuan": "2392.00", "status": "pa
```

C007 在 10 月 8 日有两张 2392 元的已付发票,就是 Day 289 那个「被扣了两次款」的例子。

</details>

**练习 3:让 Day 289 的 host 连远程 server。** 把 `mcp_agent.py` 的 Agent 循环改成连 `http://127.0.0.1:8765/mcp`(带令牌),写工具一律拦截,问「C012 是什么套餐、多少席位?最近有没有没付的发票?」。尽量复用 Day 289 写好的两个转换函数。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/ex290_http_agent.py
"""练习 3:Day 289 的 host 改连远程 server。循环和两个转换原样复用,只换连接方式。"""
import json
import os
from typing import Any

import anyio
import httpx2
from mcp import Client
from mcp.client.streamable_http import streamable_http_client

from common.llm import LLMClient
from part05.mcp_agent import SYSTEM, mcp_tool_to_openai, result_to_text

URL = "http://127.0.0.1:8765/mcp"


async def run_remote(user: str, max_steps: int = 8) -> tuple[str, LLMClient]:
    llm = LLMClient()
    headers = {"Authorization": f"Bearer {os.environ['CLOUDLEDGER_TOKEN']}"}
    async with httpx2.AsyncClient(headers=headers) as http:
        async with Client(streamable_http_client(URL, http_client=http)) as mcp:
            listing = await mcp.list_tools()
            tools = [mcp_tool_to_openai(t) for t in listing.tools]
            writes = {t.name for t in listing.tools if not (t.annotations and t.annotations.read_only_hint)}
            messages: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]
            for step in range(1, max_steps + 1):
                r = llm.chat(messages, tools=tools)
                messages.append(r.message)
                calls = r.message.get("tool_calls") or []
                if not calls:
                    return r.content, llm
                for tc in calls:
                    name, args = tc["function"]["name"], json.loads(tc["function"]["arguments"] or "{}")
                    if name in writes:
                        out = f"[已拦截] {name} 会写数据,本次运行没有授权。"
                    else:
                        out = result_to_text(await mcp.call_tool(name, args))
                    print(f"[step {step}] {name}({json.dumps(args, ensure_ascii=False)}) -> {out[:70]}")
                    messages.append({"role": "tool", "tool_call_id": tc["id"], "content": out})
    return f"到了最大步数 {max_steps} 还没做完", llm


if __name__ == "__main__":
    answer, llm = anyio.run(run_remote, "C012 是什么套餐、多少席位?最近有没有没付的发票?")
    print("== 回答\n" + answer)
    print("== 账单", llm.ledger)
```

<div class="line-notes">

- `from part05.mcp_agent import SYSTEM, mcp_tool_to_openai, result_to_text` 直接导入 Day 289 的系统提示词和两个转换函数。传输换了,工具的格式和结果的格式都没变,所以它们一行不用改。
- `headers = {"Authorization": f"Bearer {os.environ['CLOUDLEDGER_TOKEN']}"}` f-string 里面要用字典下标时,里外引号得不一样(外双内单),不然 Python 3.12 以前会报语法错误。
- `async with Client(streamable_http_client(URL, http_client=http)) as mcp:` 和 Day 289 唯一的实质区别就在这一行:那边是 `Client(StdioServerParameters(...))`,这边是带令牌的 HTTP 传输。
- `if name in writes:` 远程版直接一律拦截写工具,不提供 `--allow-writes`。远程 server 通常是多人共用的,写操作更该谨慎。
- `print(f"[step {step}] {name}(` 每次工具调用打一行,方便和 server 那边的 `[auth]` 日志对照。

</div>

终端 A 跑 `server_auth`(先 seed 一次),终端 B 设好 `CLOUDLEDGER_TOKEN` 后 `uv run python -m part05.ex290_http_agent`:

```text
[step 1] get_subscription({"customer_id": "C012"}) -> {"id": "S012", "customer_id": "C012", "plan": "基础版", "billing_cycle": 
[step 1] list_invoices({"customer_id": "C012", "status": "open"}) -> {"result": [{"id": "INV-2026-0045", "amount_cents": 58800, "status": "
== 回答
C012 的情况如下：

**订阅**
- 套餐：基础版
- 计费周期：月付（monthly）
- 席位数：12 个
- 状态：生效中（active）
- 开始日期：2025-03-22，本期结束日：2026-11-08

**未付发票**
- INV-2026-0045，金额 588.00 元，状态 open，开票日期 2026-10-08，尚未付款

如需，我可以继续查询历史发票或协助申请退款。
== 账单 2 次调用 | 输入 1968 / 输出 207 tokens | 约 ¥0.0026
```

模型第一步就并行调了两个工具,而且自己想到给 `list_invoices` 传 `status: "open"`。终端 A 的日志:

```text
[auth] support-bot -> server/discover
[auth] support-bot -> tools/list
[auth] support-bot -> tools/call get_subscription
[auth] support-bot -> tools/call list_invoices
```

588 元 = 基础版 49 元 × 12 席位,和订阅对得上。

</details>

**验收标准**:`bash part05/no_auth_attack.sh` 在 `server_http` 上能提交成功、在 `server_auth` 上回 401;`http_client_auth.py` 带对令牌能查到 C007 的订阅,带错令牌失败;Gradio 演示版能在浏览器里查到 C007,`gradio_probe.py` 显示协议版本 `2025-11-25`;三道练习的输出和上面一致(模型的措辞可以不同)。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| Streamable HTTP | MCP 的 HTTP 传输方式:server 是独立的 Web 服务,client 每次调用发一个 POST,响应可以是 JSON 或 SSE 流 |
| `streamable_http_app()` | SDK 把 MCP server 包成 Starlette 应用对象但不启动,方便你先套中间件再自己用 uvicorn 跑 |
| uvicorn | Python 的 HTTP 服务器程序,负责监听端口、收发 HTTP,相当于 Node 里 `http.createServer` 那一层 |
| Starlette | Python 的轻量 Web 框架,FastAPI 和 MCP SDK 的 HTTP 服务都建在它上面 |
| `Mcp-Method` / `Mcp-Name` 头 | 2026-07-28 版协议要求的请求头,把 JSON-RPC 的方法名和工具名复制一份到头里,方便网关和中间件不解析 body 就能判断 |
| Bearer token | 持有者令牌:谁拿着这串字符,谁就被当成它代表的身份;放在 `Authorization: Bearer xxx` 头里 |
| 401 / 403 | 401:不知道你是谁(没带或带错令牌);403:知道你是谁,但你没这个权限 |
| `WWW-Authenticate` | 401 响应必带的头,告诉对方用什么方案认证;MCP 正式鉴权会在里面附上 `resource_metadata` 地址 |
| OAuth 2.1 | 一套「由授权服务器发令牌、资源服务器只验令牌」的标准协议,MCP 规范对 HTTP 传输的正式鉴权方案 |
| 资源服务器 / 授权服务器 | OAuth 里的两个角色:前者持有数据、验令牌(我们的 MCP server),后者负责登录、同意和发令牌 |
| scope | 令牌的权限范围,比如只读、可写;权限不够时回 403 并写明需要的 scope |
| token passthrough | MCP server 把收到的令牌转手去调别的服务,规范明令禁止 |
| DNS rebinding | 恶意网页让浏览器访问你本机端口的一种攻击,用 Host/Origin 白名单防 |
| Gradio | Python 库,把一个函数自动变成网页表单;`launch(mcp_server=True)` 同时把它变成 MCP 工具 |
| Hugging Face Spaces | Hugging Face 提供的应用托管,能免费跑 Gradio 应用 |
| `uv run --no-project --with` | 不碰任何项目,临时建环境装指定的包再运行,类似 `npx` |

## 常见误区

**「server 只绑了 127.0.0.1,先不加鉴权也没事。」** 开发时可以,但「为了让同事也能用」把 `host` 改成 `0.0.0.0` 往往就是一行的事,改的人很少会同时想起来加鉴权。第 3 步实测,一条 curl 就提交了 2392 元的退款申请。上 HTTP 的第一天就把鉴权加上。

**令牌没设置时退化成空字符串。** 写成 `os.environ.get("CLOUDLEDGER_TOKEN_SUPPORT", "")` 看着更「健壮」,实际是把门打开了:表里多了一个空字符串令牌,而我们的中间件虽然会拒绝空令牌,但换一个写法稍不注意就漏了。用 `os.environ[...]`,没设置就让它 `KeyError` 起不来。

**看到 `Server returned an error response` 就去翻代码。** 正文实测,401 在 client 那边只表现为这一句,完全不提鉴权。先用 curl 打同一个地址看状态码。

**照着 1.x 教程写 `streamablehttp_client(url, headers={...})`。** 2.x 的 `streamable_http_client` 没有 `headers=` 参数,函数名也少了一个下划线。要带头就自己建 `httpx2.AsyncClient(headers=...)` 传进 `http_client=`。

**把令牌放在网址里,`.../mcp?token=xxx`。** 规范明确禁止:网址会出现在服务器访问日志、代理日志、浏览器历史里。令牌只放 `Authorization` 头。

**鉴权写在工具函数里。** 四个工具每个写一遍,漏一个就是漏洞;`tools/list`、`server/discover` 这些请求根本不进工具函数。放在中间件,所有请求一处检查。

**把 Gradio 装进 lab。** gradio 6.30.0 要求 `mcp<2.0.0`,和 lab 的 `mcp==2.3.0` 冲突,`uv add gradio[mcp]` 会解析失败。演示版单独一个目录,用 `uv run --no-project --with` 跑。

**演示站直接用正式库。** 公网演示谁都能访问。只拷一份造的数据,只放只读工具,连接也用 `mode=ro` 打开。

## 学习资料

### 文档与文章

- [MCP 规范 · Authorization(2026-07-28)](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization):今天「OAuth 2.1 比今天多了什么」一节的出处。先读 Introduction、Roles、Access Token Usage、Error Handling 四小节,30 分钟,流程图那段看个大概即可。
- [MCP 规范 · Transports(2026-07-28)](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports):Streamable HTTP 的请求头、`Mcp-Method`/`Mcp-Name` 的规定和安全警告都在这里,对照第 3 步那条 curl 读。
- [MCP 官方 · Security Best Practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices):token passthrough、confused deputy 等攻击的解释,第七部分讲安全时还会再读。
- [Claude Code 文档 · Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp):`--transport http`、`--header` 和 `.mcp.json` 里 `${变量}` 展开的写法。
- [Gradio · Building an MCP Server with Gradio](https://www.gradio.app/guides/building-mcp-server-with-gradio):`mcp_server=True` 的官方说明,docstring 怎么变成工具描述、`gr.Header` 怎么读令牌、怎么放到 Spaces。
- [Hugging Face · Gradio Spaces](https://huggingface.co/docs/hub/spaces-sdks-gradio):想把演示版发出去时照着它做。
- [Starlette · Middleware](https://starlette.dev/middleware/):`BaseHTTPMiddleware` 的用法和它的限制。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV19pEKziEUY&autoplay=0&high_quality=1" title="Python SDK开发Streamable HTTP MCP Server,抓包详解工作机制" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>五里墩茶社 · Python SDK开发Streamable HTTP MCP Server,抓包详解工作机制 · 12 分钟。看他抓包展示每次调用的 HTTP 请求长什么样,和第 3 步的 curl 对照。视频是 2025 年的老版协议,头和握手方式和今天的 2026-07-28 版不同,看机制即可。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1qgVDzREr2&autoplay=0&high_quality=1" title="B站首发!MCP Server如何实现认证和授权呢?8分钟给你讲明白" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>java架构师徐庶 · B站首发!MCP Server如何实现认证和授权呢?8分钟给你讲明白 · 9 分钟。用 Java 讲的,代码不用看,看他画的 OAuth 角色关系图,对照今天的第二张图理解资源服务器和授权服务器的分工。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/XEMZniYKuaY" title="How to Build a Remote MCP Server (with Auth)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Shaw Talebi · How to Build a Remote MCP Server (with Auth) · 从本地 server 改成远程、再加鉴权,正好是今天的路线。英文,开自动字幕。</figcaption>
</figure>

### 书籍

- Justin Richer、Antonio Sanso,《OAuth 2 in Action》,Manning,2017。从客户端、授权服务器、资源服务器三个角度各写一遍 OAuth,想彻底搞懂今天第二张图就读它的第 1–4 章。没查到中文版,只写英文原版。

### 开源项目与代码

- [modelcontextprotocol/python-sdk](https://github.com/modelcontextprotocol/python-sdk):`src/mcp/server/auth/` 是 SDK 自带的 OAuth 支持,`middleware/bearer_auth.py` 就是工业版的 `BearerAuth`,可以和今天的 30 行对照着读,看它多处理了 scope 和 `resource_metadata`。
- [gradio-app/gradio](https://github.com/gradio-app/gradio):`gradio/mcp.py` 是 `mcp_server=True` 的实现,能看到它怎么从 docstring 里解析 `Args:`。

## 自测

1. stdio 方式下为什么不需要鉴权,换成 Streamable HTTP 为什么就必须加?

<details><summary>答案</summary>

stdio 时 server 是 host 自己拉起的子进程,只通过管道和父进程通信,别的程序插不进来,能启动它的人本来就在你的电脑上。HTTP 时 server 是独立监听端口的进程,任何能连上这个地址的程序都能发请求,第 3 步实测一条 curl 就调了写工具。所以 MCP 规范也说,鉴权规范是给 HTTP 传输的,stdio 的凭证从环境变量拿。

</details>

2. 为什么比较令牌用 `secrets.compare_digest` 而不是 `==`?

<details><summary>答案</summary>

`==` 比较字符串时,遇到第一个不同的字符就返回,前面相同的字符越多花的时间越长。攻击者反复请求、测量响应时间,就能一位一位猜出正确的令牌(计时攻击)。`compare_digest` 不管哪里不同都花相同的时间。

</details>

3. 鉴权为什么写在中间件里,而不是每个工具函数开头?

<details><summary>答案</summary>

一是所有请求一处检查,不会因为某个工具忘了写而漏掉;二是 `server/discover`、`tools/list` 这些请求根本不经过工具函数,写在工具里挡不住陌生人列出你的工具清单;三是中间件在请求进入 MCP 处理之前就返回 401,工具代码一行都不会执行。

</details>

4. 401 和 403 分别在什么时候回?练习 1 里只读令牌调 `create_refund_request`,为什么回 403 而不是 401?

<details><summary>答案</summary>

401 是「不知道你是谁」:没带令牌、令牌不认识、令牌过期。403 是「知道你是谁,但你没这个权限」。练习 1 的只读令牌是合法的,server 认出它是 `dashboard`,只是这个身份没有写权限,所以是 403。MCP 规范对权限不足也规定回 403,并在 `WWW-Authenticate` 里写 `insufficient_scope`。

</details>

5. 用 2.x client 连 Gradio 演示版,协商出来的协议版本是 `2025-11-25`,连我们自己的 server 是 `2026-07-28`。为什么?你需要改代码吗?

<details><summary>答案</summary>

Gradio 6.30.0 内部用的是 mcp 1.30.0,只支持老版协议。2.x 的 client 两种都会,发现对方不支持新版就退回老版。不用改代码,协商是 SDK 自动完成的。

</details>

6. 面试题:你要把公司内部的计费 MCP server 开放给客服团队的 Claude Code 用,说说从「本机 stdio」到「团队可用的远程服务」要做哪些事。

<details><summary>答案</summary>

传输:换成 Streamable HTTP,部署到内网服务器,前面套 HTTPS(令牌在明文 HTTP 上会被抓包),开启 Host/Origin 白名单防 DNS rebinding。鉴权:接公司现有的登录系统做 OAuth 2.1,MCP server 只当资源服务器,实现令牌校验并核对令牌受众是不是自己;401 时返回 `resource_metadata` 让 Claude Code 能自动弹登录;不接受、也不转发别的服务的令牌。授权:按 scope 区分只读和写,客服默认只读,写工具单独授权,权限不够回 403;写工具本身仍保持「只提交申请、人审批」的设计。运维:每个请求记审计日志(谁、哪个工具、参数摘要),按身份限流;令牌短期有效,能吊销。最后用 Claude Code 的 `.mcp.json` 把地址发给团队,令牌通过环境变量或登录流程获取,不进仓库。

</details>

## 明天预告

Day 291 · 问数 Agent(一):给模型一份库说明书。今天的 server 只有四个写死的工具,想知道「企业版有几个订阅」「现在的 MRR 是多少」,就得再加工具。另一条路是让模型自己写 SQL 查库,也就是「问数」。明天先解决它最大的难点:模型不知道你们公司的表里存的是什么、口径是怎么定的。我们会看到只给列名时 6 道题错 5 道,然后一层层把说明书补厚。
