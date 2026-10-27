---
title: 'Day 589 · MCP 网关(一):2026 规范变化和远程授权流程'
description: '模型出口管住了,接着管工具出口。先读 2026-07-28 版 MCP 规范相对上一版变了什么(无状态、动态注册被废弃、授权响应多了 iss 校验),再在本机用假的授权服务器和假的 MCP server,把远程授权从 401 到拿令牌的七步完整走一遍:受保护资源元数据、Client ID Metadata Document、PKCE、resource 参数、令牌受众;最后故意制造八种出错和攻击,看每一种被哪道检查挡住。'
pubDate: 2026-10-27
regime: none
tags: ['mcp', 'oauth', 'cimd', 'authorization', 'agent-zero']
series: 'agent-zero'
day: 589
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 588](/blog/agent-zero/day-588-gateway-2/) 把透传网关长成了一个带预算、降级、熔断和成本归因的最小网关,模型这一个出口算是管住了:业务方只拿虚拟 key,超预算有人拦,主供应商 429 了自动换备用,月底账能和供应商的对上。但 Agent 不只调模型,还要调工具。从今天起管第二个出口:MCP。

你在 [Day 290](/blog/agent-zero/day-290-mcp-remote/) 给 CloudLedger 的 MCP server 加过一层 Bearer 令牌检查,那时只有一个 server、一个 Agent,令牌是环境变量里的一个字符串。平台化以后,财务团队维护账单 server,CRM 团队维护客户资料 server,IT 维护工单 server,外面还接着 GitHub、飞书这些第三方 server,十几个 Agent 要按不同权限去调这些工具。如果每个 Agent 自己去连每个 server,你会得到一张 N×M 的网:每条连线一份凭证,没人说得清「销售的 Agent 到底能调哪些工具」。这和上周的模型网关是同一个问题,只不过换成了工具。

在写 MCP 网关之前,先得搞清楚网关两侧各自要遵守的规则:一个远程 MCP server 怎么确认「来的是谁」。这件事 MCP 规范没有自己发明,而是整个搬用了 OAuth。今天先把这套规则读透、在本机走通;明天([Day 590](/blog/agent-zero/day-590-mcp-gw-2/))再在这个基础上写网关:为什么网关不能把用户的令牌原样转给下游、怎么登记和钉住工具、怎么授权和审计。

## 今天要解决的问题

学完今天你应该能做到:

1. 说出 2026-07-28 版 MCP 规范相对 2025-11-25 版的主要变化,并指出其中哪几条直接影响网关的设计(无状态、请求头里的方法名、缓存字段、动态客户端注册被废弃)。
2. 默画并解释远程 MCP 授权的七个步骤:401 和受保护资源元数据、授权服务器元数据、客户端注册、PKCE 与 `resource` 参数、`iss` 校验、换令牌、带令牌调用;说清每一步在防什么。
3. 解释 Client ID Metadata Document(CIMD)为什么取代了动态客户端注册(DCR),知道客户端注册三种方式的优先级,以及 CIMD 带来的两个新风险(授权服务器的 SSRF、localhost 回调冒充)。
4. 在本机用假服务把整个流程跑通,并亲眼看到八种错误和攻击(受众不对、令牌过期、`iss` 对不上、元数据 `issuer` 不符、没有 PKCE、重定向地址不在客户端文档里、冒充别人的 `client_id`、权限不足)各自被哪一道检查挡住。

预计用时 3.5 小时。今天概念密,但新概念只有两个:OAuth 授权流程和 CIMD,其余是它们的零件。前置:[Day 290](/blog/agent-zero/day-290-mcp-remote/)(远程 MCP server 和 Bearer 令牌)、[Day 84](/blog/agent-zero/day-084-auth-2/)(JWT 是什么、签名怎么验)、[Day 82](/blog/agent-zero/day-082-auth-1/)(服务端怎么验 API key)、[Day 586](/blog/agent-zero/day-586-gateway-1/)(网关为什么存在)。

今天没有调模型,没有花 API 费用。授权服务器、MCP server、客户端元数据文档的托管服务全是本机 `127.0.0.1` 上的假服务,令牌是用一句伪造的密钥签的 JWT,没有连任何真实的 OAuth 提供方。规范内容我 2026 年 10 月 27 日当天读了 modelcontextprotocol.io 上的 2026-07-28 版(目前的最新版,`/specification/latest` 指向它),下面凡是写「规范要求」的地方,都是照原文的 MUST/SHOULD 写的。

代码放在 `agent-zero-lab/part10/mcpgw/`(新目录)。要装的包:

```bash
cd agent-zero-lab
mkdir -p part10/mcpgw && touch part10/mcpgw/__init__.py
uv add fastapi uvicorn httpx pyjwt python-multipart
uv add --dev pytest
```

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分(`oauth_client.py` 里 `run_flow` 的七步、`mcp_server.py` 里令牌校验那几行);做练习,做不出再展开参考答案,看完关掉重写一遍。

## 2026-07-28 版规范变了什么

MCP 规范的版本号是日期。我 10 月 27 日去看的时候,最新的一版是 2026-07-28,它的更新说明里写着自己相对上一版 2025-11-25 改了什么。下面这张表只挑对平台和网关有影响的:

| 变化 | 规范怎么说 | 对网关意味着什么 |
| --- | --- | --- |
| 协议无状态 | 删掉 `initialize` 握手和 `Mcp-Session-Id` 头;每个请求在 `_meta` 里自带协议版本和客户端能力;新增必须实现的 `server/discover` 让客户端查询服务器支持什么 | 没有会话就不需要「粘性路由」,任何一个网关实例或 MCP server 实例都能处理任何一个请求,横向扩容简单得多 |
| 跨调用状态用句柄 | 需要跨调用记状态的 server,自己发一个句柄,当普通工具参数传来传去;规范专门写了「状态句柄劫持」:不能把「持有句柄」当成已认证,要把句柄在服务端绑到令牌里验出来的用户 | 句柄是新的越权入口,明天讲授权时会用到 |
| 请求头里的方法名 | Streamable HTTP 的 POST 必须带 `Mcp-Method`、`Mcp-Name` 头 | 网关不用解析请求体就能知道这是 `tools/call` 还是 `tools/list`、调的是哪个工具,做路由和限流更便宜 |
| list 结果可缓存 | `tools/list` 等必须带 `ttlMs`(新鲜期,毫秒)和 `cacheScope`(`public` 或 `private`);server 应该按确定的顺序返回工具 | 网关可以缓存 `tools/list`,但 `private` 的不能跨用户共享;确定的顺序也让下游模型的提示词前缀更稳,缓存命中率更高 |
| 服务端主动请求改成「多轮往返」 | 原来的 `sampling/createMessage`、`elicitation/create` 这类服务器主动发给客户端的请求,换成服务器返回 `input_required`、客户端带着回答重试原请求 | 网关不用再替一条长连接维护「谁在等谁的回答」 |
| 追踪上下文 | `_meta` 里约定了 `traceparent`、`tracestate`、`baggage` | 第 85 周的全链路追踪可以一路穿过工具调用(Day 593) |
| 几个功能被废弃 | Roots、Sampling、Logging 标为废弃;老的 HTTP+SSE 传输正式归为废弃;SSE 断线重放(`Last-Event-ID`)被删掉 | 新写的东西别再用这些;流断了就重发一个新请求 |
| 任务搬出核心 | 实验性的 tasks 移到官方扩展 `io.modelcontextprotocol/tasks` | 长任务要走扩展,网关要单独支持 |
| 授权:DCR 废弃 | 动态客户端注册(RFC 7591)标为废弃,保留只是为了兼容;推荐 Client ID Metadata Documents | 今天的重点之一 |
| 授权:`iss` 校验 | 授权服务器 **SHOULD** 在授权响应里带 `iss`;客户端 **MUST** 在拿授权码去换令牌之前,核对**出现了的** `iss` 和自己记下的授权服务器一致 | 防混淆攻击,今天的重点之一 |
| 授权:凭证绑授权服务器 | 客户端存的凭证要按授权服务器的 `issuer` 存,授权服务器换了就必须重新注册,不许把 A 的凭证拿去给 B | 平台里存客户端凭证的地方要按 issuer 分 |

规范还在快速演进,你读到这里时可能又有新版本了。养成习惯:写 MCP 相关的代码之前,先去 [modelcontextprotocol.io 的规范页](https://modelcontextprotocol.io/specification/latest) 看最新的更新说明,再看看有没有标「Deprecated」的东西。

无状态这一条可以直接验证。后面跑通授权以后,我会把同一个令牌、同一个 `tools/list` 请求分别发给两个 MCP server 实例,它们都能答,因为请求里该有的信息都带着了。

## 远程 MCP 的授权:七步

先说清哪里需要授权。stdio 方式运行的本地 MCP server 不需要 OAuth,凭证从环境变量来(规范说得很直接:用 stdio 的实现不应该走这套授权)。需要授权的是**通过 HTTP 访问的远程 server**。规范的设计是完全复用 OAuth 2.1 和几个配套标准,MCP 自己不发明新东西。先认三个角色:

- **MCP server 是资源服务器**(resource server):它只负责验令牌,不负责发令牌。
- **授权服务器**(authorization server):负责和用户交互、发令牌。可以是公司的登录系统(Okta、Keycloak、钉钉或飞书的开放平台),也可以和 MCP server 部署在一起。
- **MCP 客户端是 OAuth 客户端**:代表用户去申请令牌。Claude Desktop、Cursor、你写的 Agent,都是客户端。

整个流程七步,下面这张图对着看一遍,后面每一步都会在代码里再出现:

<figure>
<svg viewBox="0 0 640 400" role="img" aria-label="远程 MCP 授权七步:客户端无令牌请求得到 401 和资源元数据地址;读资源元数据找到授权服务器;读授权服务器元数据并核对 issuer 和 PKCE;用 CIMD 的 URL 作为 client_id 发起带 PKCE 和 resource 的授权请求;用户同意后回调带授权码和 iss;客户端先核对 iss 再换令牌;带令牌调用,MCP server 校验受众">
  <rect x="0" y="0" width="640" height="400" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="20" y="12" width="120" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="80" y="31" text-anchor="middle" fill="var(--ink)">MCP 客户端</text>
    <rect x="260" y="12" width="120" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="320" y="31" text-anchor="middle" fill="var(--ink)">MCP server</text>
    <rect x="500" y="12" width="120" height="30" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)"/><text x="560" y="31" text-anchor="middle" fill="var(--ink)">授权服务器</text>
  </g>
  <g stroke="var(--rule)"><line x1="80" y1="42" x2="80" y2="392"/><line x1="320" y1="42" x2="320" y2="392"/><line x1="560" y1="42" x2="560" y2="392"/></g>
  <g font-family="var(--font-mono)" font-size="11" fill="var(--ink)">
    <line x1="80" y1="68" x2="320" y2="68" stroke="var(--ink-faint)"/><text x="200" y="62" text-anchor="middle">1 不带令牌请求</text>
    <line x1="320" y1="92" x2="80" y2="92" stroke="var(--ink-faint)" stroke-dasharray="4 3"/><text x="200" y="87" text-anchor="middle">401 + resource_metadata 地址</text>
    <line x1="80" y1="120" x2="320" y2="120" stroke="var(--ink-faint)"/><text x="200" y="114" text-anchor="middle">2 读受保护资源元数据 RFC 9728</text>
    <line x1="80" y1="148" x2="560" y2="148" stroke="var(--ink-faint)"/><text x="320" y="142" text-anchor="middle">3 读授权服务器元数据 RFC 8414,核对 issuer 和 PKCE</text>
    <line x1="80" y1="184" x2="560" y2="184" stroke="var(--mem)" stroke-width="1.5"/><text x="320" y="170" text-anchor="middle">4 授权请求:client_id=一个 URL(CIMD)</text><text x="320" y="199" text-anchor="middle" fill="var(--ink-soft)">PKCE code_challenge + resource=MCP server 地址 + 记下期望的 issuer</text>
    <line x1="560" y1="228" x2="80" y2="228" stroke="var(--ink-faint)" stroke-dasharray="4 3"/><text x="320" y="222" text-anchor="middle">5 回调:授权码 + iss + state</text>
    <text x="110" y="252" fill="var(--compute)">6 先核对 iss,再换令牌</text>
    <line x1="80" y1="268" x2="560" y2="268" stroke="var(--ink-faint)"/><text x="320" y="263" text-anchor="middle">code_verifier + resource</text>
    <line x1="560" y1="292" x2="80" y2="292" stroke="var(--ink-faint)" stroke-dasharray="4 3"/><text x="320" y="287" text-anchor="middle">访问令牌(aud = 这个 MCP server)</text>
    <line x1="80" y1="326" x2="320" y2="326" stroke="var(--mem)" stroke-width="1.5"/><text x="200" y="320" text-anchor="middle">7 Authorization: Bearer 令牌</text>
    <text x="320" y="360" text-anchor="middle" fill="var(--ink-soft)">server 校验:签名、没过期、aud 是自己、scope 够不够</text>
    <text x="320" y="378" text-anchor="middle" fill="var(--ink-soft)">不接受、也不转发别人的令牌</text>
  </g>
</svg>
<figcaption>按 2026-07-28 版规范简化的授权流程。客户端从 401 里顺藤摸瓜找到授权服务器,用 PKCE 保护授权码,用 resource 参数让令牌只对这一个 server 有效,换令牌之前先核对 iss。</figcaption>
</figure>

流程看着长,但每一步都在堵一个具体的洞。我们不空讲,直接把三个角色都写成本机的假服务,让它们真的跑起来。

### 资源服务器:假的 MCP server

先写最简单的一个:资源服务器,也就是我们的 CloudLedger MCP server。它在 [Day 290](/blog/agent-zero/day-290-mcp-remote/) 里只有一个「Bearer 令牌对不对」的检查,今天要变成规范里的样子:没带令牌回 401 并告诉客户端去哪里找授权服务器,令牌要验签名、有效期、颁发者、**受众**,权限不够回 403。

在此之前先造一个工具函数,在后台线程里起一个只绑 `127.0.0.1` 的 uvicorn 服务,这样所有假服务可以在一个脚本里一起起、一起停:

```python
# agent-zero-lab/part10/mcpgw/labrun.py
"""实验用的小工具:在后台线程里起一个只绑 127.0.0.1 的 uvicorn 服务,用 with 语句管理起停。
Day 589–590 所有假服务(授权服务器、MCP server、网关)都用它起。
"""
import threading
import time
from types import TracebackType

import uvicorn
from fastapi import FastAPI


class LabServer:
    def __init__(self, app: FastAPI, port: int) -> None:
        self.port = port
        self.server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
        self.thread = threading.Thread(target=self.server.run, daemon=True)

    def __enter__(self) -> "LabServer":
        self.thread.start()
        for _ in range(100):                       # 最多等 5 秒,直到 uvicorn 报告已启动
            if self.server.started:
                return self
            time.sleep(0.05)
        raise RuntimeError(f"server on {self.port} did not start")

    def __exit__(self, exc_type: type[BaseException] | None, exc: BaseException | None, tb: TracebackType | None) -> None:
        self.server.should_exit = True
        self.thread.join(timeout=5)
```

<div class="line-notes">

- `self.server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))` 只绑 `127.0.0.1`,所以局域网里的别的机器连不上。`log_level="error"` 让 uvicorn 别刷访问日志。
- `self.thread = threading.Thread(target=self.server.run, daemon=True)` uvicorn 的 `run` 会一直阻塞,放进后台线程。`daemon=True` 表示主程序结束时线程不会拦着不让退出。
- `def __enter__(self) -> "LabServer":` 实现 `__enter__` 和 `__exit__` 的对象可以用 `with` 语句,相当于 JS 里「用完自动关」的 `try/finally` 的一个简写。进入 `with` 块时起服务,离开时停。
- `if self.server.started:` uvicorn 起好之后会把这个属性设成真。轮询它而不是睡一个固定时间,起得快就快。
- `self.server.should_exit = True` 通知 uvicorn 该退出了,它会在下一轮循环里自己收尾。

</div>

然后是资源服务器本体:

```python
# agent-zero-lab/part10/mcpgw/mcp_server.py
"""假的 CloudLedger MCP server(只绑 127.0.0.1)。它是 OAuth 里的「资源服务器」:只验令牌,不发令牌。
协议部分按 MCP 2026-07-28 的形状简化:无状态(没有 initialize、没有 Mcp-Session-Id),每个请求在 _meta 里带协议版本,
有 server/discover,list 结果带 resultType / ttlMs / cacheScope。只实现今天用到的几个字段,没有用官方 SDK。
用法:由 demo 脚本用 labrun.LabServer 起。
"""
import re
from typing import Any

import jwt
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

from .authz_server import FAKE_SECRET

PROTOCOL_VERSION = "2026-07-28"
META_VERSION = "io.modelcontextprotocol/protocolVersion"

TOOLS: list[dict[str, Any]] = [
    {"name": "get_invoice", "description": "按发票号查询一张发票(只读)",
     "inputSchema": {"type": "object", "properties": {"invoice_id": {"type": "string"}}, "required": ["invoice_id"]}},
    {"name": "create_refund_request", "description": "为一张发票发起退款申请(写操作)",
     "inputSchema": {"type": "object", "properties": {"invoice_id": {"type": "string"}, "amount": {"type": "number"}}, "required": ["invoice_id", "amount"]}},
]
TOOL_SCOPE = {"get_invoice": "invoices:read", "create_refund_request": "refunds:write"}


def make_mcp_app(resource: str, issuer: str, name: str = "cloudledger-fake", check_audience: bool = True) -> FastAPI:
    """resource 是这个 server 的规范地址(如 http://127.0.0.1:9100/mcp),令牌的 aud 必须等于它。
    check_audience=False 只给练习 2 用:演示「不验受众」会怎样,真实代码里不要有这个开关。"""
    app = FastAPI()
    origin = resource.rsplit("/", 1)[0]
    prm_url = f"{origin}/.well-known/oauth-protected-resource/{resource.rsplit('/', 1)[1]}"
    app.state.rejections = []

    @app.get("/.well-known/oauth-protected-resource/mcp")
    async def prm() -> dict[str, Any]:
        return {"resource": resource, "authorization_servers": [issuer], "scopes_supported": ["invoices:read"],
                "bearer_methods_supported": ["header"]}

    def challenge(error: str | None, scope: str, desc: str = "") -> str:
        parts = [f'resource_metadata="{prm_url}"', f'scope="{scope}"']
        if error:
            parts = [f'error="{error}"', *parts]
            if desc:
                parts.append(f'error_description="{desc}"')
        return "Bearer " + ", ".join(parts)

    @app.post("/mcp")
    async def mcp(request: Request) -> Response:
        auth = request.headers.get("authorization", "")
        if not auth.startswith("Bearer "):
            app.state.rejections.append("no token")
            return JSONResponse({"error": "unauthorized"}, status_code=401, headers={"WWW-Authenticate": challenge(None, "invoices:read")})
        try:
            claims = jwt.decode(auth[7:], FAKE_SECRET, algorithms=["HS256"], audience=resource if check_audience else None, issuer=issuer,
                                options={"require": ["exp", "iss"] + (["aud"] if check_audience else []), "verify_aud": check_audience})
        except jwt.InvalidTokenError as e:                       # 过期、签名不对、受众不是我、颁发者不对,统统 401
            app.state.rejections.append(f"{type(e).__name__}: {e}")
            return JSONResponse({"error": "invalid_token", "error_description": str(e)}, status_code=401,
                                headers={"WWW-Authenticate": challenge("invalid_token", "invoices:read", str(e))})
        granted = set(str(claims.get("scope", "")).split())
        body: dict[str, Any] = await request.json()
        rid, method = body.get("id"), body.get("method")
        params: dict[str, Any] = body.get("params") or {}
        if (params.get("_meta") or {}).get(META_VERSION) != PROTOCOL_VERSION:       # 无状态:每个请求自带版本
            return JSONResponse({"jsonrpc": "2.0", "id": rid, "error": {"code": -32602, "message": f"missing or unsupported _meta {META_VERSION}"}})
        server_info = {"io.modelcontextprotocol/serverInfo": {"name": name, "version": "0.1"}}
        if method == "server/discover":
            result: dict[str, Any] = {"supportedVersions": [PROTOCOL_VERSION], "capabilities": {"tools": {}}, "serverInfo": {"name": name}}
        elif method == "tools/list":
            result = {"tools": TOOLS, "resultType": "complete", "ttlMs": 60000, "cacheScope": "private", "_meta": server_info}
        elif method == "tools/call":
            tool = str(params.get("name"))
            need = TOOL_SCOPE.get(tool)
            if need is None:
                return JSONResponse({"jsonrpc": "2.0", "id": rid, "error": {"code": -32602, "message": f"unknown tool {tool}"}})
            if need not in granted:
                app.state.rejections.append(f"insufficient_scope: need {need}, have {sorted(granted)}")
                return JSONResponse({"error": "insufficient_scope"}, status_code=403, headers={"WWW-Authenticate": challenge("insufficient_scope", need)})
            args = params.get("arguments") or {}
            result = {"content": [{"type": "text", "text": f"{tool}({args}) ok, caller={claims['sub']}, client={claims['client_id']}"}],
                      "resultType": "complete", "_meta": server_info}
        else:
            return JSONResponse({"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": f"method {method} not found"}})
        return JSONResponse({"jsonrpc": "2.0", "id": rid, "result": result})

    return app


def parse_challenge(header: str) -> dict[str, str]:
    """解析 WWW-Authenticate: Bearer a="b", c="d" 这种头。"""
    return dict(re.findall(r'(\w+)="([^"]*)"', header))
```

<div class="line-notes">

- `PROTOCOL_VERSION = "2026-07-28"` 这个假 server 说的协议版本。
- `META_VERSION = "io.modelcontextprotocol/protocolVersion"` 无状态协议里,每个请求在 `_meta` 里带上这个键,值是协议版本。键名是规范约定的。
- `TOOLS: list[dict[str, Any]] = [` 两个工具:`get_invoice` 只读,`create_refund_request` 是写操作。
- `TOOL_SCOPE = {"get_invoice": "invoices:read", "create_refund_request": "refunds:write"}` 每个工具需要的 scope(权限范围)。读和写分成两个 scope,后面「权限不足」的演示就靠这个。
- `def make_mcp_app(resource: str, issuer: str, name: str = "cloudledger-fake", check_audience: bool = True) -> FastAPI:` `resource` 是这个 server 的规范地址,令牌的 `aud` 必须等于它;`issuer` 是它信任的授权服务器。`check_audience` 只给练习 2 用,真实代码里不该有这个开关。
- `prm_url = f"{origin}/.well-known/oauth-protected-resource/{resource.rsplit('/', 1)[1]}"` 受保护资源元数据的地址。规范(RFC 9728)的约定:把 `/.well-known/oauth-protected-resource` 插在主机名和路径之间。`resource` 是 `http://127.0.0.1:9100/mcp`,所以这里算出来是 `http://127.0.0.1:9100/.well-known/oauth-protected-resource/mcp`。
- `app.state.rejections = []` 把每次拒绝的原因记下来,演示结束时打印,看每种攻击是被哪条检查挡住的。
- `return {"resource": resource, "authorization_servers": [issuer], "scopes_supported": ["invoices:read"],` 受保护资源元数据的内容。规范要求必须有 `authorization_servers`,告诉客户端信任哪个授权服务器。`scopes_supported` 只列最低限度的 `invoices:read`,写权限不在里面,这是规范里「scope 最小化」的建议。
- `parts = [f'resource_metadata="{prm_url}"', f'scope="{scope}"']` 拼 `WWW-Authenticate` 头。`resource_metadata` 告诉客户端元数据在哪,`scope` 告诉客户端这次操作需要什么权限。
- `if not auth.startswith("Bearer "):` 没带令牌。
- `return JSONResponse({"error": "unauthorized"}, status_code=401, headers={"WWW-Authenticate": challenge(None, "invoices:read")})` 回 401,并在头里放上 `resource_metadata`。客户端从这个头开始整个发现流程。
- `claims = jwt.decode(auth[7:], FAKE_SECRET, algorithms=["HS256"], audience=resource if check_audience else None, issuer=issuer,` 验令牌。`auth[7:]` 去掉前面的 `Bearer `(7 个字符)。`algorithms=["HS256"]` 明确写死允许的算法,不让令牌自己说用什么算法签的。`audience=resource` 是关键:令牌里的 `aud` 必须等于这个 server 自己。`issuer=issuer` 要求颁发者对。
- `options={"require": ["exp", "iss"] + (["aud"] if check_audience else []), "verify_aud": check_audience})` `require` 表示这些声明必须存在,缺了就算无效;没有有效期的令牌是永远有效的令牌,必须拒绝。
- `except jwt.InvalidTokenError as e:                       # 过期、签名不对、受众不是我、颁发者不对,统统 401` PyJWT 里过期、受众不对、颁发者不对、签名不对都是它的子类,一个 `except` 全接住,统一回 401(规范要求:无效或过期的令牌回 401)。
- `granted = set(str(claims.get("scope", "")).split())` 令牌里的 `scope` 是空格分隔的字符串,切开变成集合。
- `if (params.get("_meta") or {}).get(META_VERSION) != PROTOCOL_VERSION:       # 无状态:每个请求自带版本` 没带或者带了不支持的协议版本,返回 JSON-RPC 错误。注意这是令牌验完之后才检查的,先认人,再看请求。
- `if method == "server/discover":` 新规范里必须实现的方法,告诉客户端这个 server 支持哪些协议版本和能力。
- `result = {"tools": TOOLS, "resultType": "complete", "ttlMs": 60000, "cacheScope": "private", "_meta": server_info}` `tools/list` 的结果:`resultType` 是每个结果都要带的字段,`ttlMs` 说这份列表 60 秒内新鲜,`cacheScope: private` 说只有当前用户可以缓存,中间的网关不能把它给别的用户。
- `if need not in granted:` 调写工具之前检查 scope。
- `return JSONResponse({"error": "insufficient_scope"}, status_code=403, headers={"WWW-Authenticate": challenge("insufficient_scope", need)})` 权限不够回 403(不是 401:身份没问题,只是权限不够),头里告诉客户端还需要什么 scope,客户端据此可以发起一次升级授权。
- `def parse_challenge(header: str) -> dict[str, str]:` 把 `Bearer a="b", c="d"` 这种头解析成字典,客户端和测试都会用到。

</div>

### 授权服务器:假的,但流程是真的

授权服务器的活儿最多:发布自己的元数据,处理授权请求,验证客户端身份,处理令牌请求,发令牌。先说它为什么要先看一眼客户端:在 MCP 里,客户端和授权服务器往往互不认识。你今天在 Claude Desktop 里加了一个第三方 server,明天在 Cursor 里再加一次,授权服务器凭什么相信「这个自称叫 Cursor 的客户端」,又凭什么知道它的回调地址是真的?这个问题叫客户端注册,放到后面和 CIMD 一起讲;先看代码,它里面已经实现了 CIMD 那条路。

两个文件放在一起看。第一个是客户端自己托管的「元数据文档」:

```python
# agent-zero-lab/part10/mcpgw/client_doc.py
"""托管「客户端元数据文档」(CIMD)的小服务,只绑 127.0.0.1:9103。
真实世界里这个文档放在客户端自己控制的 HTTPS 域名下;实验里用回环地址的 http 代替。
"""
from typing import Any

from fastapi import FastAPI

CLIENT_ID = "http://127.0.0.1:9103/client.json"
REDIRECT_URI = "http://127.0.0.1:9104/callback"          # 没有真的在 9104 监听,「浏览器」是代码模拟的


def make_client_doc_app() -> FastAPI:
    app = FastAPI()

    @app.get("/client.json")
    async def client_json() -> dict[str, Any]:
        return {"client_id": CLIENT_ID, "client_name": "Lab MCP Client", "redirect_uris": [REDIRECT_URI],
                "grant_types": ["authorization_code"], "response_types": ["code"], "token_endpoint_auth_method": "none"}

    @app.get("/fake.json")
    async def fake_json() -> dict[str, Any]:
        # 文档里写的 client_id 和它所在的 URL 不一样:授权服务器必须拒绝
        return {"client_id": "http://127.0.0.1:9103/someone-else.json", "client_name": "Imposter", "redirect_uris": [REDIRECT_URI]}

    return app
```

<div class="line-notes">

- `CLIENT_ID = "http://127.0.0.1:9103/client.json"` CIMD 的核心想法就在这一行:**`client_id` 本身是一个 URL**,这个 URL 指向的 JSON 文档就是这个客户端的「身份证」。规范要求真实的 `client_id` 是 `https` 且带路径;实验里用回环地址的 `http` 省掉证书。
- `REDIRECT_URI = "http://127.0.0.1:9104/callback"          # 没有真的在 9104 监听,「浏览器」是代码模拟的` 回调地址:授权完成后授权服务器把用户的浏览器重定向到这里,并把授权码放在 URL 参数里。我们的「浏览器」是代码,直接读重定向头,所以没有监听这个端口。
- `return {"client_id": CLIENT_ID, "client_name": "Lab MCP Client", "redirect_uris": [REDIRECT_URI],` 规范要求这份文档至少包含 `client_id`、`client_name`、`redirect_uris` 三项。`redirect_uris` 是白名单:只有写在这里的回调地址才被接受。
- `@app.get("/fake.json")` 故意做一份坏的,攻击 7 要用。
- `return {"client_id": "http://127.0.0.1:9103/someone-else.json", "client_name": "Imposter", "redirect_uris": [REDIRECT_URI]}` 文档里写的 `client_id` 和它自己所在的 URL 不一样,授权服务器必须拒绝。

</div>

然后是授权服务器。第一次跑它的时候你会撞上一个报错:授权服务器的 `/token` 要接收表单(`application/x-www-form-urlencoded`),FastAPI 解析表单需要另外装一个包。没装的话,脚本一启动就会看到:

```text
RuntimeError: Form data requires "python-multipart" to be installed. 
You can install "python-multipart" with: 

pip install python-multipart
```

原因是 FastAPI 自己不带解析表单的代码,`Form(...)` 依赖 `python-multipart`。修法就是上面装依赖那一行里的 `python-multipart`。OAuth 的令牌端点按标准就是用表单收参数,不是 JSON,这点和我们平时写的 JSON API 不一样。

```python
# agent-zero-lab/part10/mcpgw/authz_server.py
"""假授权服务器,只绑 127.0.0.1。实现 MCP 2026-07-28 授权流程里授权服务器这一侧:
元数据发现(RFC 8414)、Client ID Metadata Document(CIMD)、PKCE(S256)、resource 参数、授权响应里的 iss。
令牌是 HS256 的 JWT,密钥是一句伪造的字符串,只在本机演示。真实授权服务器用非对称密钥并发布 JWKS。
用法(单独看):由 demo 脚本用 labrun.LabServer 起,不需要手动起。
uv add fastapi uvicorn httpx pyjwt
"""
import base64
import hashlib
import secrets
import time
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import FastAPI, Form, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response

from .urlguard import UnsafeUrl, check_url_safe

FAKE_SECRET = "lab-only-fake-secret-do-not-reuse"      # 伪造的,不是任何真实系统的密钥
TOKEN_TTL = 300


def make_authz_app(issuer: str, allowed_resources: set[str], *, lie_iss: str | None = None,
                   metadata_issuer: str | None = None, advertise_pkce: bool = True) -> FastAPI:
    app = FastAPI()
    codes: dict[str, dict[str, Any]] = {}
    app.state.token_calls = []             # 每次有人来 /token 换令牌就记一笔,用来证明「没被送到不该去的地方」
    app.state.consent_log = []

    @app.get("/.well-known/oauth-authorization-server")
    async def metadata() -> dict[str, Any]:
        doc: dict[str, Any] = {
            "issuer": metadata_issuer or issuer,
            "authorization_endpoint": f"{issuer}/authorize",
            "token_endpoint": f"{issuer}/token",
            "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code"],
            "token_endpoint_auth_methods_supported": ["none"],
            "client_id_metadata_document_supported": True,
            "authorization_response_iss_parameter_supported": True,
            "scopes_supported": ["invoices:read", "refunds:write"],
        }
        if advertise_pkce:
            doc["code_challenge_methods_supported"] = ["S256"]
        return doc

    @app.get("/authorize")
    async def authorize(request: Request) -> Response:
        q = dict(request.query_params)
        for need in ("response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "resource"):
            if need not in q:
                return JSONResponse({"error": "invalid_request", "error_description": f"missing {need}"}, status_code=400)
        if q["response_type"] != "code" or q["code_challenge_method"] != "S256":
            return JSONResponse({"error": "invalid_request", "error_description": "need response_type=code and S256"}, status_code=400)
        if q["resource"] not in allowed_resources:
            return JSONResponse({"error": "invalid_target", "error_description": "unknown resource"}, status_code=400)
        # CIMD:client_id 本身是一个 URL,授权服务器去取它指向的 JSON
        try:
            check_url_safe(q["client_id"], allow_loopback=True)         # 实验环境允许回环;生产里这里要拒绝内网和回环
            doc = httpx.get(q["client_id"], timeout=5).json()
        except (UnsafeUrl, httpx.HTTPError, ValueError) as e:
            return JSONResponse({"error": "invalid_client", "error_description": f"cannot fetch client metadata: {e}"}, status_code=400)
        if doc.get("client_id") != q["client_id"]:
            return JSONResponse({"error": "invalid_client", "error_description": "client_id in document does not match URL"}, status_code=400)
        if q["redirect_uri"] not in doc.get("redirect_uris", []):        # 精确匹配,不用通配
            return JSONResponse({"error": "invalid_request", "error_description": "redirect_uri not in client metadata"}, status_code=400)
        app.state.consent_log.append(f"{doc.get('client_name')} wants [{q.get('scope', '')}] for {q['resource']}; redirect host {q['redirect_uri'].split('/')[2]}")
        code = secrets.token_urlsafe(16)                                  # 假装用户在这里登录并点了同意,登录的是虚构用户 alice
        codes[code] = {"challenge": q["code_challenge"], "client_id": q["client_id"], "redirect_uri": q["redirect_uri"],
                       "resource": q["resource"], "scope": q.get("scope", ""), "sub": "alice@example.invalid", "exp": time.time() + 60}
        params = {"code": code, "iss": lie_iss or issuer}
        if "state" in q:
            params["state"] = q["state"]
        return RedirectResponse(f"{q['redirect_uri']}?{urlencode(params)}", status_code=302)

    @app.post("/token")
    async def token(grant_type: str = Form(...), code: str = Form(...), code_verifier: str = Form(...),
                    client_id: str = Form(...), redirect_uri: str = Form(...), resource: str = Form(...)) -> JSONResponse:
        app.state.token_calls.append({"client_id": client_id, "resource": resource})
        rec = codes.pop(code, None)                                       # 授权码只能用一次
        if grant_type != "authorization_code" or rec is None or rec["exp"] < time.time():
            return JSONResponse({"error": "invalid_grant"}, status_code=400)
        verifier_hash = base64.urlsafe_b64encode(hashlib.sha256(code_verifier.encode()).digest()).rstrip(b"=").decode()
        if verifier_hash != rec["challenge"] or client_id != rec["client_id"] or redirect_uri != rec["redirect_uri"] or resource != rec["resource"]:
            return JSONResponse({"error": "invalid_grant", "error_description": "PKCE/client/redirect/resource mismatch"}, status_code=400)
        now = int(time.time())
        claims = {"iss": issuer, "sub": rec["sub"], "aud": rec["resource"], "scope": rec["scope"], "client_id": client_id,
                  "iat": now, "exp": now + TOKEN_TTL, "jti": secrets.token_hex(4)}
        return JSONResponse({"access_token": jwt.encode(claims, FAKE_SECRET, algorithm="HS256"), "token_type": "Bearer",
                             "expires_in": TOKEN_TTL, "scope": rec["scope"]})

    return app
```

<div class="line-notes">

- `FAKE_SECRET = "lab-only-fake-secret-do-not-reuse"      # 伪造的,不是任何真实系统的密钥` 签令牌用的密钥,一句伪造的字符串。真实的授权服务器用非对称密钥签名(私钥签、公钥验,公钥通过 JWKS 地址公开),这样资源服务器只拿公钥就能验,不需要持有能签令牌的密钥。今天为了省事用对称的 HS256,所以 MCP server 也 import 了这个密钥。
- `def make_authz_app(issuer: str, allowed_resources: set[str], *, lie_iss: str | None = None,` `issuer` 是这个授权服务器的身份标识(一个 URL);`allowed_resources` 是它愿意给哪些 MCP server 发令牌;`lie_iss`、`metadata_issuer`、`advertise_pkce` 是故意做坏的开关,演示攻击用。
- `app.state.token_calls = []             # 每次有人来 /token 换令牌就记一笔,用来证明「没被送到不该去的地方」` 混淆攻击的演示要证明:授权码根本没有被送到令牌端点。
- `"issuer": metadata_issuer or issuer,` 元数据里自报的 `issuer`。正常情况下和自己的地址一致。
- `"client_id_metadata_document_supported": True,` 声明支持 CIMD。客户端看到这一项才会走 CIMD 这条路。
- `"authorization_response_iss_parameter_supported": True,` 声明「我会在授权响应里带 `iss`」。规范里客户端对 `iss` 缺失的处理要看这一项(后面的四行表)。
- `if advertise_pkce:` 声明支持哪些 PKCE 方法。不写这一项就等于告诉客户端「我不支持 PKCE」。
- `for need in ("response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "resource"):` 授权请求必须带齐的参数,缺哪个就 400。注意 `resource` 也在里面:规范要求客户端在授权请求里就带上它。
- `if q["response_type"] != "code" or q["code_challenge_method"] != "S256":` 只接受授权码流程和 S256 方式的 PKCE。OAuth 2.1 里已经删掉了隐式授权这类不安全的流程。
- `if q["resource"] not in allowed_resources:` 只给认识的 MCP server 发令牌,请求的 `resource` 不认识就拒绝。
- `check_url_safe(q["client_id"], allow_loopback=True)         # 实验环境允许回环;生产里这里要拒绝内网和回环` 授权服务器要去**取** `client_id` 这个 URL。这个 URL 是任意客户端提供的,等于让授权服务器替陌生人发 HTTP 请求,这就是 SSRF(服务器端请求伪造)风险。取之前先过一道闸,后面单讲。
- `doc = httpx.get(q["client_id"], timeout=5).json()` 取客户端元数据文档,5 秒超时。
- `if doc.get("client_id") != q["client_id"]:` 规范要求授权服务器必须验证文档里的 `client_id` 和取文档的 URL **完全一致**,不然任何人都可以把别人的文档地址填进来、在文档里写自己的内容。
- `if q["redirect_uri"] not in doc.get("redirect_uris", []):        # 精确匹配,不用通配` 回调地址必须精确出现在文档的白名单里。这一行挡住「把授权码重定向到攻击者的地址」。
- `app.state.consent_log.append(f"{doc.get('client_name')} wants [{q.get('scope', '')}] for {q['resource']}; redirect host {q['redirect_uri'].split('/')[2]}")` 同意页上必须显示的东西:客户端名字、要什么权限、回调的主机名。规范要求授权服务器必须清楚显示回调地址的主机名,因为 CIMD 证明不了「谁在监听这个 localhost 端口」。
- `code = secrets.token_urlsafe(16)                                  # 假装用户在这里登录并点了同意,登录的是虚构用户 alice` `secrets` 是 Python 里专门生成密码学安全随机数的模块,不要用 `random`。这里省掉了登录和同意页,直接当用户同意了。
- `codes[code] = {"challenge": q["code_challenge"], "client_id": q["client_id"], "redirect_uri": q["redirect_uri"],` 把授权码和这次请求的关键参数绑在一起存下来,换令牌时要逐项核对。
- `"resource": q["resource"], "scope": q.get("scope", ""), "sub": "alice@example.invalid", "exp": time.time() + 60}` 授权码 60 秒有效。授权码是一次性的、短命的,真正值钱的是令牌。
- `params = {"code": code, "iss": lie_iss or issuer}` 授权响应里带上 `iss`。`lie_iss` 是故意说谎的开关。
- `return RedirectResponse(f"{q['redirect_uri']}?{urlencode(params)}", status_code=302)` 302 重定向回客户端的回调地址,授权码和 `iss` 在 URL 参数里。
- `async def token(grant_type: str = Form(...), code: str = Form(...), code_verifier: str = Form(...),` `Form(...)` 表示这些参数从表单里取,`...` 表示必填。
- `app.state.token_calls.append({"client_id": client_id, "resource": resource})` 先记一笔「有人来换令牌了」。
- `rec = codes.pop(code, None)                                       # 授权码只能用一次` `pop` 取出并删除。第二次拿同一个授权码来,取到的是 `None`,换不到令牌。
- `verifier_hash = base64.urlsafe_b64encode(hashlib.sha256(code_verifier.encode()).digest()).rstrip(b"=").decode()` PKCE 的核心:客户端发授权请求时只送了 `code_challenge`(verifier 的 SHA-256 再做 base64url),换令牌时才送原始的 `code_verifier`。服务器把 verifier 重新算一遍哈希,和当时存的 challenge 比。别人偷到了授权码,但没有 verifier,换不到令牌。`rstrip(b"=")` 去掉 base64 末尾的填充等号,PKCE 规定不带。
- `if verifier_hash != rec["challenge"] or client_id != rec["client_id"] or redirect_uri != rec["redirect_uri"] or resource != rec["resource"]:` 换令牌时 PKCE、`client_id`、回调地址、`resource` 四样都要和授权请求时一致。
- `claims = {"iss": issuer, "sub": rec["sub"], "aud": rec["resource"], "scope": rec["scope"], "client_id": client_id,` 令牌里的声明:谁颁发的(`iss`)、给谁的(`sub`,用户)、给哪个服务用的(`aud`,**就是请求里的 `resource`**)、什么权限(`scope`)、哪个客户端拿的。
- `"iat": now, "exp": now + TOKEN_TTL, "jti": secrets.token_hex(4)}` 签发时间、过期时间(5 分钟)、令牌唯一编号。规范建议授权服务器发短命的访问令牌,泄露了的损失就小。
- `return JSONResponse({"access_token": jwt.encode(claims, FAKE_SECRET, algorithm="HS256"), "token_type": "Bearer",` 用密钥签名,返回给客户端。

</div>

### 客户端:把七步串起来

先看最前面那个小闸,它在授权服务器取客户端文档和客户端取元数据时都会用到:

```python
# agent-zero-lab/part10/mcpgw/urlguard.py
"""取别人给你的 URL 之前先过一道闸:只许 http/https,解析出真实 IP,私网/回环/链路本地一律拒绝(实验环境可以放开回环)。
规范的 SSRF 一节明确说:别自己手写 IP 判断。所以这里让系统的 getaddrinfo 去解析(它认得十六进制、八进制这些写法),
再用标准库 ipaddress 判断类别。
用法:uv run python -m part10.mcpgw.urlguard
"""
import ipaddress
import socket
from urllib.parse import urlsplit


class UnsafeUrl(Exception):
    pass


def check_url_safe(url: str, *, allow_loopback: bool = False) -> None:
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise UnsafeUrl(f"scheme {parts.scheme!r} not allowed")
    if not parts.hostname:
        raise UnsafeUrl("no host")
    try:
        infos = socket.getaddrinfo(parts.hostname, parts.port or 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror as e:
        raise UnsafeUrl(f"cannot resolve {parts.hostname}") from e
    for info in infos:
        ip = ipaddress.ip_address(str(info[4][0]))
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
            ip = ip.ipv4_mapped                                     # ::ffff:10.0.0.5 这种写法还原成 IPv4 再判断
        if ip.is_loopback:
            if allow_loopback:
                continue
            raise UnsafeUrl(f"{ip} is loopback")
        if ip.is_private or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            raise UnsafeUrl(f"{ip} is private/link-local/reserved")
    if parts.scheme == "http" and not allow_loopback:
        raise UnsafeUrl("plain http not allowed outside loopback dev")


if __name__ == "__main__":
    samples = ["https://8.8.8.8/client.json", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.5/admin",
               "http://192.168.1.1/", "http://[::ffff:10.0.0.5]/", "http://0x7f.0.0.1:6379/", "javascript:alert(1)",
               "file:///etc/passwd", "http://127.0.0.1:9103/client.json"]
    for url in samples:
        for lab in (False, True):
            try:
                check_url_safe(url, allow_loopback=lab)
                verdict = "放行"
            except UnsafeUrl as e:
                verdict = f"拒绝({e})"
            print(f"{'实验(放开回环)' if lab else '生产          '} {url:<44} {verdict}")
```

<div class="line-notes">

- `parts = urlsplit(url)` 把 URL 拆成协议、主机、端口、路径几部分,标准库就有。
- `if parts.scheme not in ("http", "https"):` 只许 `http` 和 `https`。`javascript:`、`file:` 这类协议要是被跟着打开,轻则 XSS,重则读本机文件(规范里「OAuth 授权 URL 验证」一节专门讲了这一类)。
- `infos = socket.getaddrinfo(parts.hostname, parts.port or 443, proto=socket.IPPROTO_TCP)` 让操作系统把主机名解析成真实 IP。规范特意提醒:别自己手写 IP 判断,攻击者会用八进制、十六进制、IPv4 映射到 IPv6 这些写法绕过手写的解析器。交给系统的解析函数,它认得这些写法。
- `ip = ipaddress.ip_address(str(info[4][0]))` 用标准库的 `ipaddress` 把解析出的字符串变成 IP 对象,它有现成的判断属性。
- `ip = ip.ipv4_mapped                                     # ::ffff:10.0.0.5 这种写法还原成 IPv4 再判断` IPv6 里可以把 IPv4 地址套一层 `::ffff:` 写出来,不还原的话,`10.0.0.5` 这种私网地址会躲过检查。
- `if ip.is_loopback:` 回环地址(`127.0.0.1`),在生产里是必须拒绝的:取到的是服务器自己本机上的服务。实验里为了让假服务互相访问才放开。
- `if ip.is_private or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:` 私网(`10.x`、`192.168.x`)、链路本地(`169.254.x.x`,云厂商的元数据服务就在这里,拿到它可能就拿到云凭证)、保留地址,一律拒绝。
- `"file:///etc/passwd", "http://127.0.0.1:9103/client.json"]` 最后几个样例:`file:` 协议和我们自己的客户端文档。

</div>

```bash
uv run python -m part10.mcpgw.urlguard
```

```text
生产           https://8.8.8.8/client.json                  放行
实验(放开回环) https://8.8.8.8/client.json                  放行
生产           http://169.254.169.254/latest/meta-data/     拒绝(169.254.169.254 is private/link-local/reserved)
实验(放开回环) http://169.254.169.254/latest/meta-data/     拒绝(169.254.169.254 is private/link-local/reserved)
生产           http://10.0.0.5/admin                        拒绝(10.0.0.5 is private/link-local/reserved)
实验(放开回环) http://10.0.0.5/admin                        拒绝(10.0.0.5 is private/link-local/reserved)
生产           http://192.168.1.1/                          拒绝(192.168.1.1 is private/link-local/reserved)
实验(放开回环) http://192.168.1.1/                          拒绝(192.168.1.1 is private/link-local/reserved)
生产           http://[::ffff:10.0.0.5]/                    拒绝(10.0.0.5 is private/link-local/reserved)
实验(放开回环) http://[::ffff:10.0.0.5]/                    拒绝(10.0.0.5 is private/link-local/reserved)
生产           http://0x7f.0.0.1:6379/                      拒绝(127.0.0.1 is loopback)
实验(放开回环) http://0x7f.0.0.1:6379/                      放行
生产           javascript:alert(1)                          拒绝(scheme 'javascript' not allowed)
实验(放开回环) javascript:alert(1)                          拒绝(scheme 'javascript' not allowed)
生产           file:///etc/passwd                           拒绝(scheme 'file' not allowed)
实验(放开回环) file:///etc/passwd                           拒绝(scheme 'file' not allowed)
生产           http://127.0.0.1:9103/client.json            拒绝(127.0.0.1 is loopback)
实验(放开回环) http://127.0.0.1:9103/client.json            放行
```

对着看:`https://8.8.8.8/client.json` 是一个公网 IP,所以两种模式都放行(我只是拿它当「公网地址长什么样」的样例,脚本不会真的连它,`getaddrinfo` 解析一个 IP 字面量不联网)。云元数据地址 `169.254.169.254`、私网 `10.0.0.5` 和 `192.168.1.1`、`::ffff:10.0.0.5` 这个套了壳的私网地址,不管哪种模式都拒绝。`0x7f.0.0.1` 是 `127.0.0.1` 的十六进制写法,系统的解析函数认得它,所以生产模式拒绝、实验模式(放开回环)放行。`javascript:` 和 `file:` 的协议本身就不让。

现在是客户端本体。它按顺序走完上图的七步,每一步用 `say()` 打印一行,方便你对照:

```python
# agent-zero-lab/part10/mcpgw/oauth_client.py
"""MCP 客户端这一侧的授权流程(按 2026-07-28 规范的顺序):
401 → 受保护资源元数据 → 授权服务器元数据 → CIMD 客户端身份 → PKCE + resource → 校验 iss → 换令牌 → 带令牌调用。
「浏览器」用 httpx 模拟(不跟随重定向,直接读 Location),不打开任何真实浏览器。
"""
import base64
import hashlib
import secrets
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx

from .mcp_server import META_VERSION, PROTOCOL_VERSION, parse_challenge
from .urlguard import check_url_safe


class OAuthError(Exception):
    pass


def make_pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(32)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def rpc(method: str, params: dict[str, Any] | None = None, rid: int = 1) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": rid, "method": method, "params": {**(params or {}), "_meta": {META_VERSION: PROTOCOL_VERSION}}}


def as_metadata_urls(issuer: str) -> list[str]:
    """规范要求按这个顺序试;issuer 带路径和不带路径各有一套。"""
    parts = urlsplit(issuer)
    base, path = f"{parts.scheme}://{parts.netloc}", parts.path.rstrip("/")
    if path:
        return [f"{base}/.well-known/oauth-authorization-server{path}", f"{base}/.well-known/openid-configuration{path}",
                f"{base}{path}/.well-known/openid-configuration"]
    return [f"{base}/.well-known/oauth-authorization-server", f"{base}/.well-known/openid-configuration"]


def fetch_as_metadata(issuer: str) -> dict[str, Any]:
    for url in as_metadata_urls(issuer):
        check_url_safe(url, allow_loopback=True)
        r = httpx.get(url, timeout=5)
        if r.status_code != 200:
            continue
        doc: dict[str, Any] = r.json()
        if doc.get("issuer") != issuer:                            # 文档里的 issuer 必须和用来拼 URL 的那个一模一样
            raise OAuthError(f"issuer mismatch: asked {issuer}, document says {doc.get('issuer')}")
        if "code_challenge_methods_supported" not in doc:          # 没有这一项就当对方不支持 PKCE,必须拒绝继续
            raise OAuthError("authorization server does not advertise PKCE (code_challenge_methods_supported)")
        return doc
    raise OAuthError(f"no authorization server metadata found for {issuer}")


def validate_authz_response(params: dict[str, str], recorded_issuer: str, iss_flag: bool) -> None:
    """规范里那张四行表:发令牌请求之前先核对回调里的 iss。"""
    iss = params.get("iss")
    if iss_flag and iss is None:
        raise OAuthError("iss required (server advertises support) but missing: reject")
    if iss is not None and iss != recorded_issuer:                 # 简单字符串比较,不做任何规整化
        raise OAuthError(f"iss mismatch: expected {recorded_issuer}, got {iss}: reject")


def run_flow(mcp_url: str, client_id: str, redirect_uri: str, scopes: str | None = None, say: Any = print) -> str:
    """走完整个流程,返回访问令牌。每一步用 say() 打印。"""
    http = httpx.Client(timeout=5, follow_redirects=False)
    # 1 不带令牌调一次,从 401 的头里拿到受保护资源元数据的地址
    r = http.post(mcp_url, json=rpc("tools/list"))
    ch = parse_challenge(r.headers.get("www-authenticate", ""))
    say(f"1 不带令牌请求 → HTTP {r.status_code},头里给出 resource_metadata={ch.get('resource_metadata')} scope={ch.get('scope')}")
    prm_url = ch["resource_metadata"]
    check_url_safe(prm_url, allow_loopback=True)
    # 2 读受保护资源元数据(RFC 9728)
    prm = http.get(prm_url).json()
    resource, issuer = prm["resource"], prm["authorization_servers"][0]
    say(f"2 受保护资源元数据 → resource={resource} authorization_servers={prm['authorization_servers']}")
    # 3 读授权服务器元数据(RFC 8414),并核对 issuer、PKCE
    meta = fetch_as_metadata(issuer)
    say(f"3 授权服务器元数据 → issuer 一致;PKCE={meta['code_challenge_methods_supported']};"
        f"支持 CIMD={meta.get('client_id_metadata_document_supported')};iss 参数={meta.get('authorization_response_iss_parameter_supported')}")
    if not meta.get("client_id_metadata_document_supported"):
        raise OAuthError("this demo only implements the CIMD path")
    # 4 PKCE、state,并「记下期望的 issuer」(校验 iss 要靠这个值是可信的)
    verifier, challenge = make_pkce()
    state = secrets.token_urlsafe(8)
    recorded_issuer = meta["issuer"]
    scope = scopes if scopes is not None else ch.get("scope", "")
    q = {"response_type": "code", "client_id": client_id, "redirect_uri": redirect_uri, "code_challenge": challenge,
         "code_challenge_method": "S256", "resource": resource, "scope": scope, "state": state}
    say(f"4 授权请求 → client_id={client_id}(它自己就是一个 URL),resource={resource},scope={scope!r},code_challenge={challenge[:10]}…")
    r = http.get(meta["authorization_endpoint"], params=q)
    if r.status_code != 302:
        raise OAuthError(f"authorization endpoint said {r.status_code}: {r.text}")
    cb = {k: v[0] for k, v in parse_qs(urlsplit(r.headers["location"]).query).items()}
    say(f"5 回调(模拟浏览器读 Location)→ code={cb['code'][:6]}… iss={cb.get('iss')} state 一致={cb.get('state') == state}")
    if cb.get("state") != state:
        raise OAuthError("state mismatch")
    validate_authz_response(cb, recorded_issuer, bool(meta.get("authorization_response_iss_parameter_supported")))
    say("6 iss 校验通过,可以把授权码发给令牌端点了")
    r = http.post(meta["token_endpoint"], data={"grant_type": "authorization_code", "code": cb["code"], "code_verifier": verifier,
                                                "client_id": client_id, "redirect_uri": redirect_uri, "resource": resource})
    if r.status_code != 200:
        raise OAuthError(f"token endpoint said {r.status_code}: {r.text}")
    tok: dict[str, Any] = r.json()
    say(f"7 换到令牌 → token_type={tok['token_type']} expires_in={tok['expires_in']} scope={tok['scope']!r}")
    return str(tok["access_token"])


def call_tool(mcp_url: str, token: str, name: str, arguments: dict[str, Any]) -> httpx.Response:
    return httpx.post(mcp_url, json=rpc("tools/call", {"name": name, "arguments": arguments}), headers={"Authorization": f"Bearer {token}"}, timeout=5)
```

<div class="line-notes">

- `def make_pkce() -> tuple[str, str]:` 生成 PKCE 的一对:`verifier`(只有客户端自己知道的随机串)和 `challenge`(它的 SHA-256,可以公开发出去)。
- `verifier = secrets.token_urlsafe(32)` 32 字节的随机数转成 URL 安全的字符串,足够长、不可猜。
- `def rpc(method: str, params: dict[str, Any] | None = None, rid: int = 1) -> dict[str, Any]:` 造一个 JSON-RPC 请求,每个请求都自动在 `_meta` 里带上协议版本。这就是「无状态」在客户端的样子:不握手,每个请求自己带齐。
- `def as_metadata_urls(issuer: str) -> list[str]:` 授权服务器元数据的探测地址。规范要求按固定顺序试:先 OAuth 的 well-known,再 OpenID Connect 的 well-known;`issuer` 带路径和不带路径时拼法不一样。练习 1 要为它写测试。
- `if doc.get("issuer") != issuer:                            # 文档里的 issuer 必须和用来拼 URL 的那个一模一样` 规范要求:取回元数据后,里面的 `issuer` 必须和你用来拼这个 URL 的 issuer 完全相同。不一致就不能用。规范里举的例子:从 `attacker.example` 取到的文档里写着 `"issuer": "https://honest.example"`,必须拒绝,否则攻击者可以冒充别人的授权服务器。攻击 4 就演示这一点。
- `if "code_challenge_methods_supported" not in doc:          # 没有这一项就当对方不支持 PKCE,必须拒绝继续` PKCE 没有标准的发现机制,所以规范规定:元数据里没有 `code_challenge_methods_supported` 就当作对方不支持 PKCE,客户端必须拒绝继续。攻击 5。
- `def validate_authz_response(params: dict[str, str], recorded_issuer: str, iss_flag: bool) -> None:` 规范里那张四行表的实现。参数:回调里的参数、客户端发请求之前记下的 issuer、元数据里 `authorization_response_iss_parameter_supported` 的值。
- `if iss_flag and iss is None:` 服务器声明了会带 `iss`,但回调里没有:拒绝。
- `if iss is not None and iss != recorded_issuer:                 # 简单字符串比较,不做任何规整化` 只要回调里带了 `iss`(不管服务器有没有声明),就必须和记下的一致。比较是逐字符的:规范明说不许做大小写折叠、去末尾斜杠这些规整化,否则攻击者可以靠「看起来一样」混过去。
- `http = httpx.Client(timeout=5, follow_redirects=False)` 不自动跟随重定向。这是「模拟浏览器」的关键:我们要读重定向头里的 `Location`,而不是真去访问回调地址。
- `r = http.post(mcp_url, json=rpc("tools/list"))` 第 1 步:什么都不带直接调,故意吃一个 401。
- `ch = parse_challenge(r.headers.get("www-authenticate", ""))` 从 401 的头里取出 `resource_metadata` 和 `scope`。
- `check_url_safe(prm_url, allow_loopback=True)` 去取这个地址之前先过闸:这个地址是 MCP server 给的,恶意 server 可以填一个内网地址(规范的 SSRF 一节举的第一个例子)。
- `prm = http.get(prm_url).json()` 第 2 步:读受保护资源元数据。
- `resource, issuer = prm["resource"], prm["authorization_servers"][0]` 拿到 MCP server 的规范地址和它信任的授权服务器。元数据可以列多个授权服务器,选哪个是客户端的责任,这里取第一个。
- `meta = fetch_as_metadata(issuer)` 第 3 步:读授权服务器元数据,里面完成 `issuer` 和 PKCE 两项核对。
- `recorded_issuer = meta["issuer"]` 在跳转到浏览器之前,把校验通过的 `issuer` **记下来**,和 PKCE 的 verifier、`state` 放在一起。规范特别强调:这个期望值必须来自已经校验过的元数据,否则后面的 `iss` 比较毫无保护作用。
- `scope = scopes if scopes is not None else ch.get("scope", "")` 请求什么权限:调用方显式指定就用指定的,没指定就用 401 里 `scope` 提示的。这是规范里 scope 选择策略的第一优先级。
- `q = {"response_type": "code", "client_id": client_id, "redirect_uri": redirect_uri, "code_challenge": challenge,` 第 4 步:授权请求的参数。`client_id` 是那个 URL。
- `"code_challenge_method": "S256", "resource": resource, "scope": scope, "state": state}` `resource` 是 MCP server 的规范地址,授权服务器据此把令牌的 `aud` 设成它;`state` 是防 CSRF 的随机串,回调时要原样回来。
- `r = http.get(meta["authorization_endpoint"], params=q)` 真实情况下这一步是打开浏览器让用户登录同意;我们直接发 GET 请求,假授权服务器当用户同意了。
- `cb = {k: v[0] for k, v in parse_qs(urlsplit(r.headers["location"]).query).items()}` 第 5 步:从 302 的 `Location` 里解析出回调参数。`parse_qs` 返回的每个值是列表,`v[0]` 取第一个。
- `if cb.get("state") != state:` `state` 对不上说明这个回调不是我们发起的那次授权的结果,拒绝。
- `validate_authz_response(cb, recorded_issuer, bool(meta.get("authorization_response_iss_parameter_supported")))` 第 6 步:**在把授权码发给任何令牌端点之前**,先核对 `iss`。顺序是关键:先核对,再换令牌。
- `r = http.post(meta["token_endpoint"], data={"grant_type": "authorization_code", "code": cb["code"], "code_verifier": verifier,` 第 7 步前半:换令牌。`data=` 发的是表单,不是 JSON。
- `"client_id": client_id, "redirect_uri": redirect_uri, "resource": resource})` 换令牌请求里也要再带一次 `resource`(规范:授权请求和令牌请求里都必须带)。
- `def call_tool(mcp_url: str, token: str, name: str, arguments: dict[str, Any]) -> httpx.Response:` 带上令牌调工具:`Authorization: Bearer <令牌>`,令牌放请求头,不放 URL 里(规范明确禁止把令牌放进查询字符串)。

</div>

最后是跑通它的脚本。四个假服务一起起(客户端文档、授权服务器、两个 MCP server 实例),走完流程后再验证无状态:

```python
# agent-zero-lab/part10/mcpgw/demo_flow.py
"""走通一遍完整的远程 MCP 授权流程(全部是 127.0.0.1 上的假服务),然后验证「无状态」:
同一个令牌、同一个请求,发给两个不同的 MCP server 实例都能处理。
用法:uv run python -m part10.mcpgw.demo_flow
"""
import json

import httpx
import jwt

from .authz_server import make_authz_app
from .client_doc import CLIENT_ID, REDIRECT_URI, make_client_doc_app
from .labrun import LabServer
from .mcp_server import make_mcp_app
from .oauth_client import call_tool, rpc, run_flow

ISSUER = "http://127.0.0.1:9110"
BILLING = "http://127.0.0.1:9100/mcp"

with (LabServer(make_client_doc_app(), 9103), LabServer(make_authz_app(ISSUER, {BILLING}), 9110),
      LabServer(make_mcp_app(BILLING, ISSUER), 9100), LabServer(make_mcp_app(BILLING, ISSUER), 9102)):
    token = run_flow(BILLING, CLIENT_ID, REDIRECT_URI)
    claims = jwt.decode(token, options={"verify_signature": False})        # 只为了看一眼里面写了什么,不是验证
    print("\n令牌里的声明(假令牌,密钥是伪造的):")
    print(json.dumps(claims, ensure_ascii=False, indent=2))
    auth = {"Authorization": f"Bearer {token}"}

    print("\n带令牌调 server/discover 和 tools/list(请求里没有任何会话 id):")
    d = httpx.post(BILLING, json=rpc("server/discover"), headers=auth).json()["result"]
    print("  server/discover →", d)
    t = httpx.post(BILLING, json=rpc("tools/list"), headers=auth).json()["result"]
    print("  tools/list →", [x["name"] for x in t["tools"]], {k: t[k] for k in ("resultType", "ttlMs", "cacheScope")})
    r = call_tool(BILLING, token, "get_invoice", {"invoice_id": "INV-20007"})
    print("  tools/call get_invoice →", r.json()["result"]["content"][0]["text"])

    print("\n无状态:同一个令牌、同一个 tools/list,发给第二个实例(端口 9102,同一个对外地址):")
    r2 = httpx.post("http://127.0.0.1:9102/mcp", json=rpc("tools/list"), headers=auth).json()["result"]
    print("  实例 B →", [x["name"] for x in r2["tools"]], "(没有握手、没有会话,任何实例都能答)")

    print("\n不带 _meta 里的协议版本:")
    bad = httpx.post(BILLING, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, headers=auth).json()
    print("  →", bad["error"])
```

<div class="line-notes">

- `with (LabServer(make_client_doc_app(), 9103), LabServer(make_authz_app(ISSUER, {BILLING}), 9110),` 括号里写多个 `with` 项是 Python 3.10 以后的写法,一起起、退出时一起停。授权服务器只愿意给 `BILLING` 这一个 MCP server 发令牌。
- `LabServer(make_mcp_app(BILLING, ISSUER), 9100), LabServer(make_mcp_app(BILLING, ISSUER), 9102)):` 同一个对外地址 `BILLING`,起在两个端口上(9100 和 9102),模拟负载均衡后面的两个实例。
- `token = run_flow(BILLING, CLIENT_ID, REDIRECT_URI)` 走完七步中的前六步并换到令牌。
- `claims = jwt.decode(token, options={"verify_signature": False})        # 只为了看一眼里面写了什么,不是验证` JWT 的内容只是 base64 编码,谁都能读(Day 84 讲过),签名只保证没被改。这里关掉验签是为了看内容,不是验证。
- `d = httpx.post(BILLING, json=rpc("server/discover"), headers=auth).json()["result"]` 带令牌调 `server/discover`。注意请求里没有任何会话 ID,也没有先发 `initialize`。
- `r2 = httpx.post("http://127.0.0.1:9102/mcp", json=rpc("tools/list"), headers=auth).json()["result"]` 同一个令牌、同一种请求,发给另一个实例。
- `bad = httpx.post(BILLING, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, headers=auth).json()` 故意不带 `_meta` 里的协议版本。

</div>

```bash
uv run python -m part10.mcpgw.demo_flow
```

输出(`iat`、`exp`、`code`、`jti` 每次跑都不一样,其余是固定的):

```text
1 不带令牌请求 → HTTP 401,头里给出 resource_metadata=http://127.0.0.1:9100/.well-known/oauth-protected-resource/mcp scope=invoices:read
2 受保护资源元数据 → resource=http://127.0.0.1:9100/mcp authorization_servers=['http://127.0.0.1:9110']
3 授权服务器元数据 → issuer 一致;PKCE=['S256'];支持 CIMD=True;iss 参数=True
4 授权请求 → client_id=http://127.0.0.1:9103/client.json(它自己就是一个 URL),resource=http://127.0.0.1:9100/mcp,scope='invoices:read',code_challenge=2M4NtQz7Y-…
5 回调(模拟浏览器读 Location)→ code=y2gfjN… iss=http://127.0.0.1:9110 state 一致=True
6 iss 校验通过,可以把授权码发给令牌端点了
7 换到令牌 → token_type=Bearer expires_in=300 scope='invoices:read'

令牌里的声明(假令牌,密钥是伪造的):
{
  "iss": "http://127.0.0.1:9110",
  "sub": "alice@example.invalid",
  "aud": "http://127.0.0.1:9100/mcp",
  "scope": "invoices:read",
  "client_id": "http://127.0.0.1:9103/client.json",
  "iat": 1793096004,
  "exp": 1793096304,
  "jti": "e3fde124"
}

带令牌调 server/discover 和 tools/list(请求里没有任何会话 id):
  server/discover → {'supportedVersions': ['2026-07-28'], 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'cloudledger-fake'}}
  tools/list → ['get_invoice', 'create_refund_request'] {'resultType': 'complete', 'ttlMs': 60000, 'cacheScope': 'private'}
  tools/call get_invoice → get_invoice({'invoice_id': 'INV-20007'}) ok, caller=alice@example.invalid, client=http://127.0.0.1:9103/client.json

无状态:同一个令牌、同一个 tools/list,发给第二个实例(端口 9102,同一个对外地址):
  实例 B → ['get_invoice', 'create_refund_request'] (没有握手、没有会话,任何实例都能答)

不带 _meta 里的协议版本:
  → {'code': -32602, 'message': 'missing or unsupported _meta io.modelcontextprotocol/protocolVersion'}
```

对着图一步一步看。

第 1 步,不带令牌的请求拿到 401,头里给出了 `resource_metadata` 的地址和 `scope=invoices:read`,这是整个发现链条的起点:客户端事先不需要知道任何配置,只要有一个 MCP server 地址就能走下去。第 2 步读到的元数据里有两样东西,`resource`(这个 server 的规范地址)和 `authorization_servers`(它信任谁来发令牌)。第 3 步去授权服务器取元数据,客户端核对了 `issuer` 一致,并看到它支持 S256 的 PKCE、CIMD、`iss` 参数。

第 4 步的请求里有四样东西值得注意:`client_id` 是一个 URL;`resource` 是 MCP server 的地址;`scope` 照着 401 里的提示请求了最小的 `invoices:read`;`code_challenge` 是只有客户端自己知道的 verifier 的哈希。第 5 步回调里除了授权码还有 `iss` 和 `state`。第 6 步先核对 `iss` 通过,第 7 步才把授权码连同 verifier 发给令牌端点。

令牌里的声明值得多看两眼:`aud` 是 `http://127.0.0.1:9100/mcp`,正是 MCP server 自己的地址,这就是令牌「只对这一个 server 有效」的来源;`exp` 比 `iat` 晚 300 秒,5 分钟有效;`client_id` 里记着是哪个客户端拿的,明天做审计时会用到。

后面带令牌的三次调用都成功了。最有意思的是**无状态**那一段:同一个令牌、同一个 `tools/list`,发给第二个实例也能处理,因为这个请求自己携带了需要的一切:令牌里有身份,`_meta` 里有协议版本,不需要先在实例 A 上握手、再被路由回实例 A。以前的会话模式下,握手之后的请求必须回到同一个实例(或者所有实例共享会话存储),网关的路由就得做「粘性」,新规范把这个负担拿掉了。最后一次故意不带协议版本,被服务器按 JSON-RPC 错误拒绝。

## 为什么要有 CIMD:客户端注册三种方式

走流程时我们跳过了一个问题:授权服务器凭什么相信那个客户端?OAuth 要求每个客户端有一个 `client_id`。MCP 难就难在客户端和服务器往往互不认识。规范里列了三种注册方式,并且给出了客户端的优先级:

1. **预注册**:客户端事先在这个授权服务器上登记过,手里有现成的 `client_id`(有时还有密钥)。企业内部最常见,比如管理员在公司的登录系统里提前给 Agent 平台建好一个应用。优先级最高。
2. **Client ID Metadata Documents(CIMD)**:授权服务器在自己的元数据里声明 `client_id_metadata_document_supported: true`,客户端就可以用自己托管的一个 HTTPS 地址当 `client_id`。授权服务器去取这个地址上的 JSON,里面写着客户端名字、回调地址,授权服务器核对之后就知道「这个 `client_id` 是由控制这个域名的人背书的」。第二优先级。
3. **动态客户端注册(DCR,RFC 7591)**:客户端现场 POST 到授权服务器的注册端点,换一个新的 `client_id`。2026-07-28 版规范把它标成**废弃**,只为兼容还不支持 CIMD 的授权服务器保留。最后的备用。如果三种都用不了,最后一步是让用户手动填。

DCR 为什么被替掉?我归纳了三条原因。第一,授权服务器会积累海量来历不明的客户端记录,每个新客户端、每次重装都要注册一遍,这些记录没法清理也没法审计。第二,DCR 是攻击链里常用的一环:上周讲「混淆代理」的时候会看到,攻击者先注册一个回调指向自己的新客户端,再诱导用户点链接。第三,凭证不可迁移:授权服务器一换,所有注册信息作废,规范专门加了一条要求客户端按授权服务器的 `issuer` 存凭证。CIMD 里没有「注册」这一步,`client_id` 是自描述的 URL,授权服务器要用时才去取,所以同一个 `client_id` 可以拿去任何支持 CIMD 的授权服务器用。

对一个企业平台,我的判断是:**内部的 Agent 平台自己当客户端,走预注册**(管理员在公司的登录系统里建好应用,`client_id` 写进平台配置);**面向公开 MCP server 的通用客户端,走 CIMD**。DCR 只在不得不对接老授权服务器时留着。

CIMD 也不是没有代价,规范专门有一节讲它带来的两个新风险。

第一个是**授权服务器自己的 SSRF**。CIMD 让授权服务器接收一个陌生客户端给的 URL 并去取它,恶意客户端可以填一个内网地址(比如云厂商的元数据服务),让授权服务器替它去访问。所以授权服务器取之前要过闸:只许 https、解析出真实 IP、拒绝私网和链路本地(上面的 `urlguard.py`),最好再加一个只允许出站到公网的出口代理。规范原文说这类防护同样适用于授权服务器取客户端文档。

第二个是 **localhost 回调冒充**。很多桌面客户端的回调地址是 `http://127.0.0.1:某端口/callback`。CIMD 的文档只能证明「谁控制这个域名」,证明不了「谁在监听本机的这个端口」。攻击者可以把一个合法客户端的文档地址填进 `client_id`,自己在本机随便绑一个端口当回调:授权服务器看到的是合法客户端的文档,用户看到的是合法客户端的名字,授权码却被攻击者的本地进程收走了。规范对授权服务器的要求是:对只有 localhost 回调的客户端显示额外的警告,并且**必须**清楚显示回调地址的主机名。我们的假授权服务器记下的「同意页内容」就是在演示这件事(后面攻击输出的末尾能看到)。

## 令牌、受众、scope:三道对令牌的检查

流程跑完,MCP server 手里是一个令牌。它要做的检查,规范里分得很清楚。

**受众(`aud`)必须是自己。** 规范里的原话是:MCP server **必须**验证令牌是专门发给自己的,**必须**只接受给自己用的令牌,**不得**接受或转发任何别的令牌。受众靠客户端申请令牌时带的 `resource` 参数设定,所以 `resource` 参数在授权请求和令牌请求里**都必须**带,而且「不管授权服务器是否支持,客户端都必须发」。这一条防的是令牌被挪用:你给「日历 server」的令牌,不能被拿去调「账单 server」。更严重的是下一条,明天专门讲。

**`iss` 校验。** 这是 2026-07-28 新加的,防混淆攻击(mix-up)。客户端同时连着多个授权服务器时,攻击者控制的那个授权服务器可能诱使客户端把从诚实的授权服务器拿到的授权码,发到攻击者自己的令牌端点。PKCE 在这里**救不了**你,因为客户端会把 `code_verifier` 一起发给攻击者的令牌端点;`resource` 参数也没用,因为攻击者拦在诚实的授权服务器之前。规范的解法是在发授权请求之前记下期望的 `issuer`,收到回调后在把授权码发出去之前核对 `iss`。核对的规则是一张四行表:

| 元数据里 `authorization_response_iss_parameter_supported` | 回调里的 `iss` | 客户端怎么做 |
| --- | --- | --- |
| `true` | 有 | 和记下的 issuer 做字符串比较 |
| `true` | 没有 | 拒绝 |
| `false` 或没写 | 有 | 照样比较 |
| `false` 或没写 | 没有 | 放行 |

第四行是一个必须说明的缺口:如果授权服务器根本不带 `iss`,这套保护对它没有用。规范自己也写了「预计未来的版本会把授权服务器带 `iss` 从 SHOULD 升级为 MUST」,并鼓励实现者现在就发、现在就验。

**scope 和权限升级。** 令牌里带着 `scope`,MCP server 要在执行工具前检查权限够不够。不够时回 **403** 加 `insufficient_scope`(不是 401:身份没问题,只是权限不够),并在 `WWW-Authenticate` 头里带上需要的 scope。客户端据此可以发起一次升级授权(step-up):取「之前申请过的 scope」和「这次挑战里的 scope」的并集重新授权,这样已经有的权限不会弄丢,同时要限制重试次数,避免死循环。这个设计天然支持「默认只给读权限,要写的时候再问用户」:规范的「scope 最小化」一节说的就是这件事,元数据里的 `scopes_supported` 只列低风险的基础 scope,别把所有 scope 一股脑列出去,更别用 `*`、`all` 这种万能 scope。

## 八种错误和攻击,各被谁挡住

规则读起来都对,但真正理解要看它们**被违反**时发生什么。下面这个脚本起了一堆假服务,并故意把其中几个做坏,一种一种验证:

```python
# agent-zero-lab/part10/mcpgw/attacks.py
"""故意制造几种出错和攻击,看每一种被哪一道检查挡住。授权服务器、MCP server 全是 127.0.0.1 上的假服务。
用法:uv run python -m part10.mcpgw.attacks
"""
import httpx
import jwt

from .authz_server import FAKE_SECRET, make_authz_app
from .client_doc import CLIENT_ID, REDIRECT_URI, make_client_doc_app
from .labrun import LabServer
from .mcp_server import make_mcp_app, parse_challenge
from .oauth_client import OAuthError, call_tool, run_flow, validate_authz_response

HONEST = "http://127.0.0.1:9110"
BILLING = "http://127.0.0.1:9100/mcp"
CALENDAR = "http://127.0.0.1:9101/mcp"


def quiet(_: str) -> None:
    return None


def expect_oauth_error(label: str, mcp_url: str) -> None:
    try:
        run_flow(mcp_url, CLIENT_ID, REDIRECT_URI, say=quiet)
        print(f"  {label}:居然走通了,出问题了")
    except OAuthError as e:
        print(f"  {label}:客户端拒绝继续 → {e}")


honest_as = make_authz_app(HONEST, {BILLING, CALENDAR})
evil_iss_as = make_authz_app("http://127.0.0.1:9111", {"http://127.0.0.1:9120/mcp"}, lie_iss="http://127.0.0.1:9199")
bad_meta_as = make_authz_app("http://127.0.0.1:9112", {"http://127.0.0.1:9121/mcp"}, metadata_issuer="http://127.0.0.1:9199")
no_pkce_as = make_authz_app("http://127.0.0.1:9113", {"http://127.0.0.1:9122/mcp"}, advertise_pkce=False)
billing = make_mcp_app(BILLING, HONEST)

with (LabServer(make_client_doc_app(), 9103), LabServer(honest_as, 9110), LabServer(billing, 9100),
      LabServer(make_mcp_app(CALENDAR, HONEST, "calendar-fake"), 9101),
      LabServer(evil_iss_as, 9111), LabServer(make_mcp_app("http://127.0.0.1:9120/mcp", "http://127.0.0.1:9111"), 9120),
      LabServer(bad_meta_as, 9112), LabServer(make_mcp_app("http://127.0.0.1:9121/mcp", "http://127.0.0.1:9112"), 9121),
      LabServer(no_pkce_as, 9113), LabServer(make_mcp_app("http://127.0.0.1:9122/mcp", "http://127.0.0.1:9113"), 9122)):

    print("攻击 1:拿给「日历 server」的令牌去调「账单 server」(受众不对)")
    cal_token = run_flow(CALENDAR, CLIENT_ID, REDIRECT_URI, say=quiet)
    print("  日历令牌的 aud =", jwt.decode(cal_token, options={"verify_signature": False})["aud"])
    r = call_tool(BILLING, cal_token, "get_invoice", {"invoice_id": "INV-20007"})
    print(f"  拿去调账单 server → HTTP {r.status_code} {r.json()['error_description']}")

    print("攻击 2:令牌过期")
    now = 1_700_000_000
    expired = jwt.encode({"iss": HONEST, "sub": "alice@example.invalid", "aud": BILLING, "scope": "invoices:read", "client_id": CLIENT_ID,
                          "iat": now, "exp": now + 300}, FAKE_SECRET, algorithm="HS256")
    r = call_tool(BILLING, expired, "get_invoice", {"invoice_id": "INV-20007"})
    print(f"  → HTTP {r.status_code} {r.json()['error_description']}")

    print("攻击 3:混淆攻击(mix-up)。授权响应里的 iss 指向另一个授权服务器")
    expect_oauth_error("iss 对不上", "http://127.0.0.1:9120/mcp")
    print(f"  这个授权服务器的令牌端点被访问了几次:{len(evil_iss_as.state.token_calls)}(授权码没有被送出去)")

    print("攻击 3b:授权响应校验的四种组合(规范里那张表)")
    for flag, iss, expected in [(True, "http://127.0.0.1:9110", "http://127.0.0.1:9110"), (True, None, "http://127.0.0.1:9110"),
                                (False, "http://127.0.0.1:9199", "http://127.0.0.1:9110"), (False, None, "http://127.0.0.1:9110")]:
        params = {"code": "x"} | ({"iss": iss} if iss else {})
        try:
            validate_authz_response(params, expected, flag)
            verdict = "放行"
        except OAuthError as e:
            verdict = f"拒绝({e})"
        print(f"  服务器声明支持 iss={flag!s:<5} 回调里的 iss={str(iss):<24} → {verdict}")

    print("攻击 4:授权服务器元数据里的 issuer 和用来拼 URL 的不一样")
    expect_oauth_error("元数据 issuer 不符", "http://127.0.0.1:9121/mcp")

    print("攻击 5:授权服务器没声明支持 PKCE")
    expect_oauth_error("没有 code_challenge_methods_supported", "http://127.0.0.1:9122/mcp")

    print("攻击 6:CIMD。授权请求里的 redirect_uri 不在客户端元数据文档里(想把授权码重定向到攻击者那里)")
    base_q = {"response_type": "code", "client_id": CLIENT_ID, "code_challenge": "x" * 43, "code_challenge_method": "S256", "resource": BILLING}
    r = httpx.get(f"{HONEST}/authorize", params={**base_q, "redirect_uri": "http://127.0.0.1:9666/steal"}, follow_redirects=False)
    print(f"  → HTTP {r.status_code} {r.json()}")

    print("攻击 7:CIMD。文档里写的 client_id 和它所在的 URL 不一致(冒充别人)")
    r = httpx.get(f"{HONEST}/authorize", params={**base_q, "client_id": "http://127.0.0.1:9103/fake.json", "redirect_uri": REDIRECT_URI}, follow_redirects=False)
    print(f"  → HTTP {r.status_code} {r.json()}")

    print("场景 8:权限不足时的升级(step-up)")
    tok = run_flow(BILLING, CLIENT_ID, REDIRECT_URI, say=quiet)
    r = call_tool(BILLING, tok, "create_refund_request", {"invoice_id": "INV-20007", "amount": 468})
    ch = parse_challenge(r.headers["www-authenticate"])
    print(f"  只有 invoices:read 的令牌调写工具 → HTTP {r.status_code} error={ch['error']} 需要 scope={ch['scope']}")
    union = "invoices:read refunds:write"                         # 客户端负责取并集,别把已有的权限弄丢
    tok2 = run_flow(BILLING, CLIENT_ID, REDIRECT_URI, scopes=union, say=quiet)
    r = call_tool(BILLING, tok2, "create_refund_request", {"invoice_id": "INV-20007", "amount": 468})
    print(f"  重新授权 scope={union!r} 后 → HTTP {r.status_code} {r.json()['result']['content'][0]['text']}")

    print("\n账单 server 记下的被拒原因:")
    for line in billing.state.rejections:
        print("  -", line[:110])
    print("授权服务器记下的同意页内容(要显示客户端名字和回调主机名):")
    for line in honest_as.state.consent_log[:2]:
        print("  -", line)
```

<div class="line-notes">

- `def expect_oauth_error(label: str, mcp_url: str) -> None:` 辅助函数:走一遍流程,**期望它失败**,失败了打印原因;居然成功了说明检查没生效。
- `evil_iss_as = make_authz_app("http://127.0.0.1:9111", {"http://127.0.0.1:9120/mcp"}, lie_iss="http://127.0.0.1:9199")` 一个授权服务器自己的地址是 9111,但回调里的 `iss` 说谎成 9199,模拟「回调里的颁发者不是客户端记下的那个」。真实的混淆攻击里,说谎的是攻击者的授权服务器。我们没法在本机复现完整的多服务器攻击,但客户端要拦的那一步是同一个:`iss` 和记下的对不上。
- `bad_meta_as = make_authz_app("http://127.0.0.1:9112", {"http://127.0.0.1:9121/mcp"}, metadata_issuer="http://127.0.0.1:9199")` 元数据里自报的 `issuer` 和它被访问的地址对不上。
- `no_pkce_as = make_authz_app("http://127.0.0.1:9113", {"http://127.0.0.1:9122/mcp"}, advertise_pkce=False)` 元数据里不声明 PKCE。
- `cal_token = run_flow(CALENDAR, CLIENT_ID, REDIRECT_URI, say=quiet)` 攻击 1:正规地拿一个发给「日历 server」的令牌。
- `r = call_tool(BILLING, cal_token, "get_invoice", {"invoice_id": "INV-20007"})` 拿它去调账单 server。令牌是真的、签名是对的、没过期,唯一不对的是受众。
- `expired = jwt.encode({"iss": HONEST, "sub": "alice@example.invalid", "aud": BILLING, "scope": "invoices:read", "client_id": CLIENT_ID,` 攻击 2:自己用伪造密钥签一个过期的令牌,`exp` 设在 2023 年。
- `print(f"  这个授权服务器的令牌端点被访问了几次:{len(evil_iss_as.state.token_calls)}(授权码没有被送出去)")` 攻击 3 的关键证据:令牌端点一次都没被访问。授权码被客户端扣下了,没有发出去。
- `for flag, iss, expected in [(True, "http://127.0.0.1:9110", "http://127.0.0.1:9110"), (True, None, "http://127.0.0.1:9110"),` 把规范里那张四行表的四种组合都跑一遍:(声明支持, 回调带 iss) 分别是 (是, 对)、(是, 没带)、(否, 带了但不对)、(否, 没带)。
- `params = {"code": "x"} | ({"iss": iss} if iss else {})` 字典的 `|` 运算符合并两个字典,有 `iss` 就加进去。
- `base_q = {"response_type": "code", "client_id": CLIENT_ID, "code_challenge": "x" * 43, "code_challenge_method": "S256", "resource": BILLING}` 攻击 6、7 直接手工构造授权请求,PKCE 的 challenge 随便填 43 个字符,因为授权服务器在这一步还不验它。
- `r = httpx.get(f"{HONEST}/authorize", params={**base_q, "redirect_uri": "http://127.0.0.1:9666/steal"}, follow_redirects=False)` 攻击 6:回调地址换成攻击者的 9666 端口,不在客户端文档的白名单里。
- `r = httpx.get(f"{HONEST}/authorize", params={**base_q, "client_id": "http://127.0.0.1:9103/fake.json", "redirect_uri": REDIRECT_URI}, follow_redirects=False)` 攻击 7:`client_id` 指向那份「文档里 client_id 和自己 URL 不一致」的坏文档。
- `union = "invoices:read refunds:write"                         # 客户端负责取并集,别把已有的权限弄丢` 升级授权时请求的是旧权限和新权限的并集。
- `for line in billing.state.rejections:` 打印账单 server 内部记下的所有拒绝原因,和上面每种攻击对照。

</div>

```bash
uv run python -m part10.mcpgw.attacks
```

```text
攻击 1:拿给「日历 server」的令牌去调「账单 server」(受众不对)
  日历令牌的 aud = http://127.0.0.1:9101/mcp
  拿去调账单 server → HTTP 401 Audience doesn't match
攻击 2:令牌过期
  → HTTP 401 Signature has expired
攻击 3:混淆攻击(mix-up)。授权响应里的 iss 指向另一个授权服务器
  iss 对不上:客户端拒绝继续 → iss mismatch: expected http://127.0.0.1:9111, got http://127.0.0.1:9199: reject
  这个授权服务器的令牌端点被访问了几次:0(授权码没有被送出去)
攻击 3b:授权响应校验的四种组合(规范里那张表)
  服务器声明支持 iss=True  回调里的 iss=http://127.0.0.1:9110    → 放行
  服务器声明支持 iss=True  回调里的 iss=None                     → 拒绝(iss required (server advertises support) but missing: reject)
  服务器声明支持 iss=False 回调里的 iss=http://127.0.0.1:9199    → 拒绝(iss mismatch: expected http://127.0.0.1:9110, got http://127.0.0.1:9199: reject)
  服务器声明支持 iss=False 回调里的 iss=None                     → 放行
攻击 4:授权服务器元数据里的 issuer 和用来拼 URL 的不一样
  元数据 issuer 不符:客户端拒绝继续 → issuer mismatch: asked http://127.0.0.1:9112, document says http://127.0.0.1:9199
攻击 5:授权服务器没声明支持 PKCE
  没有 code_challenge_methods_supported:客户端拒绝继续 → authorization server does not advertise PKCE (code_challenge_methods_supported)
攻击 6:CIMD。授权请求里的 redirect_uri 不在客户端元数据文档里(想把授权码重定向到攻击者那里)
  → HTTP 400 {'error': 'invalid_request', 'error_description': 'redirect_uri not in client metadata'}
攻击 7:CIMD。文档里写的 client_id 和它所在的 URL 不一致(冒充别人)
  → HTTP 400 {'error': 'invalid_client', 'error_description': 'client_id in document does not match URL'}
场景 8:权限不足时的升级(step-up)
  只有 invoices:read 的令牌调写工具 → HTTP 403 error=insufficient_scope 需要 scope=refunds:write
  重新授权 scope='invoices:read refunds:write' 后 → HTTP 200 create_refund_request({'invoice_id': 'INV-20007', 'amount': 468}) ok, caller=alice@example.invalid, client=http://127.0.0.1:9103/client.json

账单 server 记下的被拒原因:
  - InvalidAudienceError: Audience doesn't match
  - ExpiredSignatureError: Signature has expired
  - no token
  - insufficient_scope: need refunds:write, have ['invoices:read']
  - no token
授权服务器记下的同意页内容(要显示客户端名字和回调主机名):
  - Lab MCP Client wants [invoices:read] for http://127.0.0.1:9101/mcp; redirect host 127.0.0.1:9104
  - Lab MCP Client wants [invoices:read] for http://127.0.0.1:9100/mcp; redirect host 127.0.0.1:9104
```

一种一种过。

**攻击 1(受众不对)。** 日历 server 的令牌签名是对的、没过期、颁发者也对,唯一的问题是 `aud` 是日历 server 的地址。拿去调账单 server,401 加「Audience doesn't match」。这一条检查就是前面说的「令牌只对一个 server 有效」。明天讲网关为什么不能把用户令牌原样转给下游,本质上就是这一条。

**攻击 2(过期)。** 过期的令牌 401。这里还有一个顺带的点:我用 `options={"require": ["exp", ...]}` 要求令牌必须带过期时间,否则一个没写 `exp` 的令牌会被当成永远有效。

**攻击 3(`iss` 对不上)。** 授权响应里的 `iss` 是 9199,客户端记下的是 9111,拒绝继续;证据是令牌端点被访问了 0 次,授权码没有被送出去。再对照 **3b 的四行表**,四种组合各是什么结果,和规范表里的完全一致:声明了支持但没带,拒绝;没声明但带了而且不对,拒绝;没声明也没带,放行(那个缺口)。

**攻击 4(元数据 `issuer` 不符)。** 授权服务器元数据里的 `issuer` 写成了别的,客户端不用这份元数据。如果不做这个检查,攻击者可以在自己的域名下放一份元数据,里面写着别人的 `issuer`,客户端会以为在和那个别人说话。

**攻击 5(没有 PKCE)。** 元数据里没声明 `code_challenge_methods_supported`,客户端按规范必须拒绝继续,不能「那就不用 PKCE 吧」。

**攻击 6 和 7(CIMD 的两个检查)。** 回调地址不在客户端文档的白名单里,400「redirect_uri not in client metadata」;文档里的 `client_id` 和取它的 URL 不一致,400「client_id in document does not match URL」。这两条是授权服务器对 CIMD 的必做检查:没有前者,授权码会被重定向到攻击者手里;没有后者,任何人都能顶着别人的文档地址来。

**场景 8(权限升级)。** 只有 `invoices:read` 的令牌调写工具,403,头里带着 `error=insufficient_scope` 和需要的 `scope=refunds:write`。客户端取并集重新授权,拿到新令牌后写操作成功了。

最后两段是各方的内部记录。账单 server 记下的五条拒绝原因和上面的攻击一一对应(`no token` 出现两次,是因为每次 `run_flow` 的第 1 步都故意不带令牌,吃一个 401);授权服务器记下的「同意页内容」里有客户端名字、要什么权限、回调的主机名 `127.0.0.1:9104`,这就是规范要求同意页**必须**显示的东西。

要老实说明两处和真实世界不一样的地方。一,我们所有服务都跑在 `http://127.0.0.1` 上。规范要求授权服务器的所有端点必须是 HTTPS,重定向地址要么是 localhost 要么是 HTTPS;实验里为了不折腾证书全用回环的 http,生产里不能这么做。二,我们的令牌是 HS256 对称签名,真实系统是授权服务器用私钥签、MCP server 用公钥(JWKS)验,MCP server 不需要持有能签令牌的密钥。

## 动手练习

**练习 1(写测试)**:授权服务器元数据的探测地址,规范要求按固定顺序试。写测试证明:issuer 是 `https://auth.example.com/tenant1` 时,`as_metadata_urls` 返回三个候选地址,顺序是「OAuth 带路径插入、OpenID 带路径插入、OpenID 带路径追加」;issuer 没有路径时返回两个;末尾带斜杠的 issuer 和不带的结果一样。

<details><summary>参考答案</summary>

新建 `part10/mcpgw/test_as_metadata_urls.py`:

```python
# agent-zero-lab/part10/mcpgw/test_as_metadata_urls.py
"""练习 1 参考答案:授权服务器元数据的探测顺序(规范要求的优先级)。纯函数测试,不联网。
用法:uv run pytest -v part10/mcpgw/test_as_metadata_urls.py
"""
from .oauth_client import as_metadata_urls


def test_issuer_with_path_has_three_candidates_in_order() -> None:
    assert as_metadata_urls("https://auth.example.com/tenant1") == [
        "https://auth.example.com/.well-known/oauth-authorization-server/tenant1",
        "https://auth.example.com/.well-known/openid-configuration/tenant1",
        "https://auth.example.com/tenant1/.well-known/openid-configuration",
    ]


def test_issuer_without_path_has_two_candidates() -> None:
    assert as_metadata_urls("https://auth.example.com") == [
        "https://auth.example.com/.well-known/oauth-authorization-server",
        "https://auth.example.com/.well-known/openid-configuration",
    ]


def test_trailing_slash_is_ignored() -> None:
    assert as_metadata_urls("https://auth.example.com/tenant1/") == as_metadata_urls("https://auth.example.com/tenant1")
```

<div class="line-notes">

- `from .oauth_client import as_metadata_urls` 被测的是一个纯函数:给 issuer 字符串,返回候选 URL 列表,不联网。
- `assert as_metadata_urls("https://auth.example.com/tenant1") == [` 列表比较是有顺序的,所以这条测试同时检查了「有哪些」和「什么顺序」。
- `"https://auth.example.com/.well-known/oauth-authorization-server/tenant1",` 第一个:OAuth 元数据,`/.well-known/...` 插在主机和路径之间。
- `"https://auth.example.com/.well-known/openid-configuration/tenant1",` 第二个:OpenID Connect 发现,同样插入。
- `"https://auth.example.com/tenant1/.well-known/openid-configuration",` 第三个:OpenID Connect 的另一种约定,追加在路径后面。
- `assert as_metadata_urls("https://auth.example.com/tenant1/") == as_metadata_urls("https://auth.example.com/tenant1")` 末尾斜杠不改变结果。

</div>

```bash
uv run pytest -v part10/mcpgw/test_as_metadata_urls.py
```

```text
test_as_metadata_urls.py::test_issuer_with_path_has_three_candidates_in_order PASSED
test_as_metadata_urls.py::test_issuer_without_path_has_two_candidates PASSED
test_as_metadata_urls.py::test_trailing_slash_is_ignored PASSED
============================== 3 passed in 0.38s ===============================
```

三个测试通过。为什么要有三套地址:有的授权服务器是纯 OAuth 的,有的是 OpenID Connect 的,issuer 又可能带路径(同一个域名下托管多个租户时很常见),所以规范要求客户端按优先级都试一遍,哪个先返回 200 就用哪个,但取回来之后 `issuer` 必须和拼 URL 用的完全相同。

</details>

**练习 2(观察)**:把 MCP server 的受众校验关掉(`check_audience=False`),再把攻击 1 的「日历令牌」分别发给验受众的账单 server 和不验受众的账单 server,会发生什么?这说明了什么?

<details><summary>参考答案</summary>

新建 `part10/mcpgw/no_audience_check.py`:

```python
# agent-zero-lab/part10/mcpgw/no_audience_check.py
"""练习 2 参考答案:把受众校验关掉会怎样。同一个「日历令牌」去调两个账单 server:一个验受众,一个不验。
用法:uv run python -m part10.mcpgw.no_audience_check
"""
from .authz_server import make_authz_app
from .client_doc import CLIENT_ID, REDIRECT_URI, make_client_doc_app
from .labrun import LabServer
from .mcp_server import make_mcp_app
from .oauth_client import call_tool, run_flow

ISSUER = "http://127.0.0.1:9110"
CALENDAR = "http://127.0.0.1:9101/mcp"
STRICT = "http://127.0.0.1:9100/mcp"
LAX = "http://127.0.0.1:9102/mcp"

with (LabServer(make_client_doc_app(), 9103), LabServer(make_authz_app(ISSUER, {CALENDAR, STRICT, LAX}), 9110),
      LabServer(make_mcp_app(CALENDAR, ISSUER, "calendar-fake"), 9101),
      LabServer(make_mcp_app(STRICT, ISSUER), 9100), LabServer(make_mcp_app(LAX, ISSUER, check_audience=False), 9102)):
    token = run_flow(CALENDAR, CLIENT_ID, REDIRECT_URI, say=lambda _: None)          # 这是发给日历 server 的令牌
    for label, url in (("验受众的账单 server", STRICT), ("不验受众的账单 server", LAX)):
        r = call_tool(url, token, "get_invoice", {"invoice_id": "INV-20007"})
        body = r.json()
        print(f"{label}:HTTP {r.status_code} →", body.get("error_description") or body["result"]["content"][0]["text"])
```

<div class="line-notes">

- `LAX = "http://127.0.0.1:9102/mcp"` 「宽松」的那个账单 server 的地址。
- `LabServer(make_mcp_app(STRICT, ISSUER), 9100), LabServer(make_mcp_app(LAX, ISSUER, check_audience=False), 9102)):` 两个账单 server:一个正常,一个关掉了受众校验。授权服务器愿意给三个资源都发令牌。
- `token = run_flow(CALENDAR, CLIENT_ID, REDIRECT_URI, say=lambda _: None)          # 这是发给日历 server 的令牌` `say=lambda _: None` 是个什么都不做的函数,让 `run_flow` 别打印。
- `for label, url in (("验受众的账单 server", STRICT), ("不验受众的账单 server", LAX)):` 同一个令牌,分别去敲两个 server。
- `print(f"{label}:HTTP {r.status_code} →", body.get("error_description") or body["result"]["content"][0]["text"])` 失败时打印错误描述,成功时打印工具的返回文本。`a or b` 取第一个非空的。

</div>

```bash
uv run python -m part10.mcpgw.no_audience_check
```

```text
验受众的账单 server:HTTP 401 → Audience doesn't match
不验受众的账单 server:HTTP 200 → get_invoice({'invoice_id': 'INV-20007'}) ok, caller=alice@example.invalid, client=http://127.0.0.1:9103/client.json
```

验受众的 server 401;不验的那个 200,工具照常执行,还认为调用者是 `alice@example.invalid`。令牌不是发给它的,它却照单全收。

这说明:**签名对、没过期、颁发者对,都不等于这个令牌是给我的**。没有受众检查,授权服务器发给任何 MCP server 的令牌,在所有「不验受众」的 server 上都能用:一个小 server(比如某个内部测试用的)被攻破,攻击者拿到的令牌可以去调账单 server。规范把它写成 MUST 的原因就在这里。

</details>

**练习 3(观察)**:授权码只能用一次,PKCE 的 verifier 也必须对。手工走授权码流程(不用 `run_flow`),验证:同一个授权码兑换第二次会怎样;用别人猜的 verifier 兑换会怎样。

<details><summary>参考答案</summary>

新建 `part10/mcpgw/replay_code.py`:

```python
# agent-zero-lab/part10/mcpgw/replay_code.py
"""练习 3 参考答案:授权码只能用一次,PKCE 的 verifier 对不上也不行。手工走授权码流程,不经过 run_flow。
用法:uv run python -m part10.mcpgw.replay_code
"""
from urllib.parse import parse_qs, urlsplit

import httpx

from .authz_server import make_authz_app
from .client_doc import CLIENT_ID, REDIRECT_URI, make_client_doc_app
from .labrun import LabServer
from .oauth_client import make_pkce

ISSUER = "http://127.0.0.1:9110"
RESOURCE = "http://127.0.0.1:9100/mcp"


def get_code(challenge: str) -> str:
    q = {"response_type": "code", "client_id": CLIENT_ID, "redirect_uri": REDIRECT_URI, "code_challenge": challenge,
         "code_challenge_method": "S256", "resource": RESOURCE, "scope": "invoices:read"}
    r = httpx.get(f"{ISSUER}/authorize", params=q, follow_redirects=False)
    return parse_qs(urlsplit(r.headers["location"]).query)["code"][0]


def redeem(code: str, verifier: str) -> httpx.Response:
    return httpx.post(f"{ISSUER}/token", data={"grant_type": "authorization_code", "code": code, "code_verifier": verifier,
                                                 "client_id": CLIENT_ID, "redirect_uri": REDIRECT_URI, "resource": RESOURCE})


with LabServer(make_client_doc_app(), 9103), LabServer(make_authz_app(ISSUER, {RESOURCE}), 9110):
    verifier, challenge = make_pkce()
    code = get_code(challenge)
    r1 = redeem(code, verifier)
    print("第一次兑换(verifier 正确)    →", r1.status_code)
    r2 = redeem(code, verifier)
    print("同一个授权码再兑换一次(重放)  →", r2.status_code, r2.json())
    r3 = redeem(get_code(challenge), "someone-guessed-this-verifier")
    print("新授权码,但 verifier 是猜的  →", r3.status_code, r3.json())
```

<div class="line-notes">

- `def get_code(challenge: str) -> str:` 手工模拟「用户同意后回调」,返回授权码。
- `r = httpx.get(f"{ISSUER}/authorize", params=q, follow_redirects=False)` 不跟随重定向,直接读 302 的 `Location`。
- `return parse_qs(urlsplit(r.headers["location"]).query)["code"][0]` 从 `Location` 的查询串里取 `code`。
- `def redeem(code: str, verifier: str) -> httpx.Response:` 拿授权码和 verifier 去令牌端点兑换。
- `r1 = redeem(code, verifier)` 第一次兑换,verifier 是对的。
- `r2 = redeem(code, verifier)` 同一个授权码、同一个 verifier 再兑换一次。
- `r3 = redeem(get_code(challenge), "someone-guessed-this-verifier")` 一个新授权码,但 verifier 是随便编的。

</div>

```bash
uv run python -m part10.mcpgw.replay_code
```

```text
第一次兑换(verifier 正确)    → 200
同一个授权码再兑换一次(重放)  → 400 {'error': 'invalid_grant'}
新授权码,但 verifier 是猜的  → 400 {'error': 'invalid_grant', 'error_description': 'PKCE/client/redirect/resource mismatch'}
```

第一次 200。同一个授权码再兑换,400 `invalid_grant`:授权码被 `pop` 掉了,是一次性的。新授权码配错误的 verifier,400,错误描述里写着「PKCE/client/redirect/resource mismatch」。

这两条一起说明 PKCE 和一次性授权码分别堵什么:攻击者在回调途中截获了授权码(比如同一台机器上别的进程监听了回调端口),但他没有 verifier,所以换不到令牌;就算他想等客户端换完之后重放同一个授权码,第二次也是死的。

</details>

**练习 4(开放题)**:你们的 Agent 平台要接三个 MCP server:①公司自己的账单 server(授权服务器就是公司的登录系统);②一个第三方的 GitHub MCP server(授权服务器是 GitHub 那边的);③一个团队用 Python 自己写的、只在内网用的小 server。分别说:平台这个客户端用哪种注册方式,为什么,你最担心的一件事。

<details><summary>参考答案</summary>

没有标准答案,下面是我的选择:

| server | 注册方式 | 理由 | 最担心 |
| --- | --- | --- | --- |
| ① 公司账单 server | 预注册 | 客户端和授权服务器是同一个公司的,管理员在登录系统里事先给 Agent 平台建一个应用,`client_id` 写进平台配置,最可控,可以审计、可以吊销 | 客户端凭证按授权服务器的 `issuer` 存,以后登录系统迁移了必须重新登记,要有人记得 |
| ② 第三方 GitHub server | 看对方授权服务器支持什么:支持 CIMD 就用 CIMD,不支持再退到预注册或 DCR | 对方不认识我们,用 CIMD 就不用提前找对方登记;平台要托管一份元数据文档,放在公司域名下的 https 地址 | 回调地址:如果平台是服务端程序,回调要用 https 的公司域名,别用 localhost;元数据文档里的 `redirect_uris` 要精确 |
| ③ 内网小 server | 也走预注册(或者直接复用公司登录系统),并要求它的 `resource` 地址进授权服务器的白名单 | 小团队写的 server 最容易漏掉受众校验;统一授权服务器,令牌里的 `aud` 才能约束它 | 它是不是真的验了 `aud`:接入审核时就用练习 2 那样的方法,拿一个别的 server 的令牌打它一次,200 就不让上线 |

评价标准:不是选哪个对,而是理由里有没有说明谁认识谁、凭证放在哪里、谁能审计和吊销,以及担心的是不是一件具体的、能检查的事。

</details>

**验收标准**:`demo_flow.py` 能跑通七步并显示两个实例都能回答同一个 `tools/list`;`attacks.py` 的八种情况输出和文中一致,而你能说出每一种是被哪一行检查挡住的;三个练习的脚本和测试都跑通;能不看文章默写出规范里 `iss` 校验那张四行表,并说出第四行(都没有)是一个缺口;能解释为什么 PKCE 防不住混淆攻击。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 资源服务器(resource server) | OAuth 里持有数据、验令牌的一方;MCP server 就是 |
| 授权服务器(authorization server) | OAuth 里和用户交互、发令牌的一方,可以是公司的登录系统 |
| OAuth 2.1 | 一套「授权服务器发令牌、资源服务器验令牌」的标准协议,把 2.0 里不安全的做法删掉、必须用 PKCE |
| 受保护资源元数据(RFC 9728) | 资源服务器公布「我信任哪个授权服务器」等信息的标准文档,放在 `/.well-known/oauth-protected-resource` |
| 授权服务器元数据(RFC 8414) | 授权服务器公布自己的端点地址、支持的功能的标准文档 |
| `issuer` | 授权服务器的身份标识,一个 URL,令牌里的 `iss` 声明和元数据里的 `issuer` 都是它 |
| CIMD(Client ID Metadata Document) | 客户端用一个自己托管的 https 地址当 `client_id`,地址上的 JSON 写着客户端名字和回调地址,授权服务器要用时去取 |
| DCR(动态客户端注册) | 客户端现场向授权服务器注册换一个 `client_id`,2026-07-28 版规范标为废弃 |
| 预注册 | 客户端事先在授权服务器上登记,手里有现成的 `client_id` |
| PKCE | 授权码流程的防截获机制:发请求时只送 verifier 的哈希,换令牌时才送原始 verifier |
| `code_verifier` / `code_challenge` | PKCE 里客户端自己保管的随机串 / 它的 SHA-256 哈希 |
| `resource` 参数(RFC 8707) | 客户端申请令牌时声明「这个令牌要给哪个 server 用」,授权服务器据此设置令牌的受众 |
| 受众(`aud`) | 令牌里记录它是发给哪个服务的,服务必须拒绝受众不是自己的令牌 |
| 混淆攻击(mix-up) | 客户端连着多个授权服务器时,攻击者诱使它把从诚实服务器拿到的授权码发给攻击者的服务器 |
| `iss` 参数(RFC 9207) | 授权响应里带上「这个响应是谁发的」,客户端据此防混淆攻击 |
| scope | 令牌里记录的权限范围,如 `invoices:read`;权限不够回 403 和 `insufficient_scope` |
| 升级授权(step-up) | 权限不够时,客户端带着旧权限加新权限的并集重新授权 |
| SSRF | 服务器端请求伪造:攻击者给一个 URL,让服务器替他去访问内网或云元数据服务 |
| JWKS | 授权服务器公开自己公钥的地址,资源服务器用它验令牌签名 |

## 常见误区

**以为令牌签名对、没过期就够了。** 还要验受众是不是自己。练习 2 里同一个日历令牌,不验受众的账单 server 照单全收,验的 401。

**以为用了 PKCE 就不怕授权码被骗走。** PKCE 防的是授权码在传输途中被截获。混淆攻击里,客户端是自己把授权码和 verifier 一起发给攻击者的令牌端点的,PKCE 帮不上忙,要靠核对 `iss`。

**`iss` 校验只看有没有。** 规范的规则是一张表:服务器声明了会带但没带,拒绝;带了就必须和记下的一致,不管有没有声明。而且比较是逐字符的,不能做大小写折叠、去斜杠这些规整化。

**期望的 issuer 取自没校验过的地方。** 比如直接用授权响应里的 `iss` 去和授权响应里的别的东西比。记下的值必须来自**已经校验过的授权服务器元数据**,并且在跳到浏览器之前记下。

**用「注册一个新客户端」解决一切。** DCR 已经被标为废弃,它会让授权服务器堆满来历不明的客户端,还是混淆代理攻击链里的一环。

**CIMD 的元数据文档里 `client_id` 随便写。** 它必须和文档所在的 URL 完全一致,否则任何人都可以引用别人的文档地址、在文档里写自己的内容。授权服务器必须验证。

**授权服务器取客户端元数据文档时不设防。** `client_id` 是客户端给的 URL,等于让授权服务器替陌生人发请求。不设防就是 SSRF,可以打到云元数据服务(`169.254.169.254`)。只许 https,解析真实 IP,拒绝私网和链路本地,别自己手写 IP 判断。

**把令牌放进 URL 的查询参数。** 规范明确禁止:URL 会被日志、浏览器历史、Referer 头记录下来。令牌一律放 `Authorization` 头。

**权限不够回 401。** 401 表示身份有问题,403 才是「我知道你是谁,但权限不够」,并且 403 的 `WWW-Authenticate` 头里带着需要的 scope,客户端才知道要升级什么。

**只在实验里看到 http 就以为生产也行。** 规范要求授权服务器所有端点必须是 HTTPS,重定向地址要么是 localhost 要么是 HTTPS。今天全用回环 http 只是为了省证书。

## 学习资料

### 文档与文章

- [MCP 规范 · Authorization(2026-07-28)](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization):今天所有流程的出处。先读 Authorization Flow Steps、Authorization Response Validation、Resource Parameter Implementation 三节,对照今天的七步。
- [MCP 规范 · Client Registration](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration):三种注册方式的优先级、CIMD 的必做项、授权服务器绑定。
- [MCP 规范 · Authorization Server Discovery](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery):受保护资源元数据怎么找、授权服务器元数据的探测顺序,练习 1 的出处。
- [MCP 规范 · Security Considerations](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations):受众绑定、混淆攻击、CIMD 的安全注意事项,今天攻击演示的逐条来源。
- [MCP · Security Best Practices](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices):混淆代理、令牌透传、SSRF、状态句柄劫持这些攻击的图文说明,明天要继续用。
- [MCP 规范 · 更新说明(Key Changes)](https://modelcontextprotocol.io/specification/2026-07-28/changelog):今天开头那张表的出处,以后每次规范更新先看它。
- [RFC 9728 · OAuth 2.0 Protected Resource Metadata](https://datatracker.ietf.org/doc/html/rfc9728):受保护资源元数据的标准。
- [RFC 8707 · Resource Indicators for OAuth 2.0](https://www.rfc-editor.org/rfc/rfc8707.html):`resource` 参数的标准。
- [RFC 9207 · OAuth 2.0 Authorization Server Issuer Identification](https://datatracker.ietf.org/doc/html/rfc9207):`iss` 参数和混淆攻击,第 1 节讲攻击怎么发生。
- [OAuth Client ID Metadata Document(IETF 草案)](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document-00):CIMD 的原始定义,第 6 节是安全注意事项。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1CpgQ6yEQX&autoplay=0&high_quality=1" title="面试官：MCP 协议为什么要接入OAuth 2.1？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>图灵AI大模型 · 面试官:MCP 协议为什么要接入 OAuth 2.1? · 7 分钟。从面试题的角度讲 MCP 为什么不自己造鉴权。视频是 2026-07-28 版规范之前录的,DCR 被废弃、CIMD 和 iss 校验这些新变化以今天的正文为准。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1qgVDzREr2&autoplay=0&high_quality=1" title="B站首发！MCP Server如何实现认证和授权呢？8分钟给你讲明白，清楚的不能再清楚了，看一遍就能吃透！" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>java架构师徐庶 · MCP Server 如何实现认证和授权 · 9 分钟。用 Java 讲的,代码不用看,看他画的角色关系图,对照今天的七步。同样是旧版规范时期录的。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/CWK_mBdMZhQ" title="The State of MCP Auth - Michael Grinich, WorkOS" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Mastra 频道 · The State of MCP Auth(WorkOS 的 Michael Grinich)· 英文。一位做企业登录的人讲 MCP 授权为什么这么设计、实际接入的坑,适合读完规范之后看。</figcaption>
</figure>

### 书籍

- Justin Richer、Antonio Sanso,《OAuth 2 in Action》(Manning,2017):从客户端、授权服务器、资源服务器三个角度各写一遍 OAuth,想把今天的七步彻底吃透就读第 1–4 章。没查到中文版,只写英文原版。
- Neil Madden,《API Security in Action》(Manning,2020):从零给 API 加认证、令牌、限流、审计,OAuth2 和令牌校验几章对应今天的资源服务器那一侧。英文原版。

### 开源项目与代码

- [modelcontextprotocol/python-sdk](https://github.com/modelcontextprotocol/python-sdk):`src/mcp/server/auth/` 是官方 SDK 里的授权支持,对照今天的 `mcp_server.py` 看它多处理了什么。我没有在今天验证 SDK 对 2026-07-28 版的支持程度,用之前先看它的发版说明。
- [modelcontextprotocol/ext-auth](https://github.com/modelcontextprotocol/ext-auth):MCP 授权的官方扩展仓库(规范里提到的授权扩展都列在这里)。
- [jpadilla/pyjwt](https://github.com/jpadilla/pyjwt):今天用的 JWT 库,`jwt.decode` 的 `audience`、`issuer`、`options` 参数就是受众和颁发者校验的开关。

## 自测

1. 2026-07-28 版规范相对上一版,有哪三条变化直接影响网关设计?各怎么影响?

<details><summary>答案</summary>

(任选三条,下面是我的选择)①协议无状态,删掉 `initialize` 和 `Mcp-Session-Id`,每个请求自带协议版本,所以任何网关实例或 server 实例都能处理任何请求,不再需要粘性路由。②Streamable HTTP 的 POST 必须带 `Mcp-Method` 和 `Mcp-Name` 头,网关不解析请求体就能按方法和工具名路由、限流。③list 结果必须带 `ttlMs` 和 `cacheScope`,网关可以缓存 `tools/list`,但 `private` 的不能跨用户共享。④动态客户端注册(DCR)废弃,推荐 CIMD。⑤授权响应里的 `iss` 要核对,防混淆攻击。

</details>

2. 一个 MCP 客户端第一次连一个不认识的远程 MCP server,从发第一个请求到拿到令牌,按顺序有哪几步?

<details><summary>答案</summary>

①不带令牌请求,得到 401,头里有 `resource_metadata` 地址;②读受保护资源元数据(RFC 9728),拿到 `resource` 和 `authorization_servers`;③读授权服务器元数据(RFC 8414 或 OpenID Connect),核对 `issuer` 一致、有 PKCE 支持;④注册(预注册、CIMD、DCR 三选一,按优先级),生成 PKCE 的 verifier 和 challenge,记下期望的 issuer,发带 `resource` 的授权请求;⑤用户在浏览器里同意,回调带授权码、`iss`、`state`;⑥核对 `state` 和 `iss`,再用授权码加 verifier 加 `resource` 去换令牌;⑦带令牌调用,server 校验签名、有效期、受众、scope。

</details>

3. CIMD 比 DCR 好在哪?它又带来了哪两个新风险?

<details><summary>答案</summary>

CIMD 里 `client_id` 本身是客户端托管的 https 地址,授权服务器要用时才去取,不需要事先注册,不会积累来历不明的客户端记录,身份由控制域名的人背书,凭证可以拿到任何支持 CIMD 的授权服务器用。DCR 要每个客户端现场注册,授权服务器堆积大量记录,还是混淆代理攻击链里的一环。两个新风险:一是授权服务器要去取客户端给的 URL,有 SSRF 风险,要过滤私网和链路本地地址;二是 localhost 回调冒充,CIMD 证明不了谁在监听本机端口,授权服务器要对 localhost 回调加警告并清楚显示回调主机名。

</details>

4. PKCE 防什么?为什么它防不住混淆攻击?

<details><summary>答案</summary>

PKCE 防授权码在传输途中被截获、注入:发授权请求时只送 verifier 的哈希,换令牌时才送原始 verifier,偷到授权码但没有 verifier 就换不到令牌。混淆攻击里,是客户端自己被诱导把授权码和 verifier 一起发给攻击者的令牌端点,verifier 就送到了攻击者手里,PKCE 无能为力。防它要靠在发授权请求之前记下期望的 issuer,收到回调后在发授权码之前核对 `iss`。

</details>

5. 一个 MCP server 为什么必须验令牌的受众?不验会怎样?

<details><summary>答案</summary>

令牌的签名对、没过期、颁发者对,都只说明它是授权服务器发的,不说明是发给这个 server 的。不验受众,授权服务器发给日历 server 的令牌就可以拿去调账单 server(练习 2 里 200,而验受众的是 401),任何一个被攻破的小 server 手里的令牌都能去调别的 server。规范写成 MUST:server 必须验证令牌是专门发给自己的,必须只接受给自己用的令牌。

</details>

6. (面试题)你们要做一个企业内部的 MCP 网关,前面是十几个 Agent,后面是十几个 MCP server。授权这一层你会怎么设计,哪些东西必须是标准的、哪些可以自己定?

<details><summary>答案</summary>

必须是标准的:每个 MCP server 当资源服务器,按 RFC 9728 发布受保护资源元数据,401 带 `resource_metadata`;统一用公司的登录系统当授权服务器(RFC 8414 元数据、授权码加 PKCE);令牌的 `aud` 是具体 server 的规范地址,客户端申请令牌时带 `resource`,每个 server 必须验 `aud`、签名、有效期,权限不够回 403 加 `insufficient_scope`;客户端校验授权响应的 `iss`。Agent 平台作为客户端用预注册,面向外部通用 MCP server 用 CIMD。可以自己定的:scope 的命名和粒度(按读、写、危险分级,默认只给读,写操作走升级授权)、令牌有效期(短命)、预注册应用怎么管理和审计、同意页放不放企业策略。我最担心的是某个小 server 没验受众,所以接入审核要用「拿别的 server 的令牌打它一次」来检验。

</details>

## 明天预告

明天是 Day 590 · MCP 网关(二):禁止令牌透传、注册中心、授权模型和审计。今天我们看的是两方的规则:客户端怎么向一个 server 证明自己。明天要处理的是三方:Agent、网关、下游 server。网关收到 Agent 带来的令牌之后,最顺手的做法是把它原样转给下游,这恰恰是规范明令禁止的「令牌透传」,明天会真的造出这个洞、用它绕过网关,再改成正确的做法:网关自己验、自己换新令牌调下游。然后写工具注册中心(用指纹钉住工具定义防 rug pull)、按租户和风险等级的授权规则、一份改一个字就能被发现的哈希链审计日志。
