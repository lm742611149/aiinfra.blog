---
title: 'Day 621 · 生成式 UI:MCP Apps、A2UI、AG-UI 三条路线和安全(不讲前端框架)'
description: '主管要批一笔退款,Agent 只能回文字的话,金额和发票号藏在一堆字里,手一滑就批错。今天讲清让 Agent 在对话里拿出界面的三条路线各管哪一层,然后给 CloudLedger 写一个退款审批的 MCP App,用本地测试 host 点一遍,再亲手撞一次 CSP 和沙箱。'
pubDate: 2026-10-27
regime: none
tags: ['generative-ui', 'mcp-apps', 'a2ui', 'ag-ui', 'security', 'python', 'agent-zero']
series: 'agent-zero'
day: 621
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 619](/blog/agent-zero/day-619-agent-ux-1/) 给每个动作定了级,退款这类撤不回的动作钉在第三级「执行前确认」。[Day 620](/blog/agent-zero/day-620-agent-ux-2/) 做了撤销窗口、出错提示和放权梯子。两天一直没回答的一个问题是:「执行前确认」在界面上到底长什么样。

如果 Agent 只能回文字,审批就只能是「请回复 1 批准,回复 2 驳回」。主管要在一段话里找客户、发票号、金额、原因四样东西,回错一个数字,钱就退出去了。今天讲 2026 年让 Agent 在对话里拿出一块界面的三条路线,并给退款审批做一张真的能点的卡片。你是前端出身,界面本身不教,只讲跟 Agent 有关的部分:谁来写界面、界面怎么和模型说话、怎么保证它不会伤到你。

## 今天要解决的问题

学完今天你应该能:

1. 说清 MCP Apps、A2UI、AG-UI 各管哪一层,画出它们能怎么组合,知道遇到一个需求先选哪条路。
2. 读懂 MCP Apps 的几个约定:`ui://` 资源、`text/html;profile=mcp-app` 这个 MIME、工具上的 `_meta.ui.resourceUri`、只给界面调用的 `visibility: ["app"]`。
3. 写一个 MCP App 服务端和一个界面,用官方测试 host 点通「展示申请、主管批准、写库、回告诉模型」这条链路。
4. 亲手验证三层防护各挡住什么,并说出还剩什么没挡住(服务端授权、界面注入、数据一致)。

预计用时 3 到 3.5 小时,其中装测试 host 大概半小时。前置:Day 280 建的 `cloudledger/seed.py` 和 `cloudledger.db`(`refund_requests` 表在里面);写 MCP server 的那几天用的 Python MCP SDK(我用 2.3.0,2026 年 10 月查到的 PyPI 最新版,`from mcp.server import MCPServer`);本机要有 Node 18 以上(我用的是 24)。**安全约定:今天所有数据都是 CloudLedger 的假订单、假金额,服务只绑在 `127.0.0.1`,不连任何真实支付或真实系统。**

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 为什么 Agent 需要界面,谁来写

纯文字别扭的场景很多:退款审批要同时看四样东西再决定,选航班要比十几个选项,改发票抬头要让客户填五个字段。传统做法是前端提前写好页面,Agent 在合适的时候「跳转」过去,但 Agent 的对话是开放的,你没法预先知道它什么时候需要哪个界面。生成式 UI 要做的是:**让 Agent 在对话中按需拿出一块界面,用户在界面上操作,结果再回到 Agent**。

三条路线的差别,都来自两个分歧。第一个是界面谁来写:可以是 server 的开发者提前写好一个 HTML 页面,Agent 只决定什么时候打开、往里填什么数据(MCP Apps);也可以是 Agent 每次现场「描述」一个界面,客户端用自己的组件库画出来(A2UI)。第二个是信任:一段 HTML 加 JavaScript 是能执行的代码,第三方 server 的代码在你的应用里跑,必须关进沙箱;一份声明式的 JSON 只是数据,客户端只渲染自己白名单里的组件,天然安全得多,代价是表达力受组件目录限制。

## 三条路线各管什么

我 2026 年 10 月 27 日查到的现状:MCP Apps 是 MCP 的官方扩展,规范文件在 `ext-apps` 仓库的 `specification/2026-01-26/` 目录下,npm 上的 `@modelcontextprotocol/ext-apps` 最新是 2.0.3(2026-09-25 发布);官方文档列出的支持方包括 Claude、Claude Desktop、VS Code GitHub Copilot、Microsoft 365 Copilot、Goose、Postman、MCPJam 等。A2UI 是 Google 开源的声明式 UI 格式,仓库 README 写稳定版是 v0.9.1,v1.0 是候选版,发布了 Lit、Angular、React 渲染器。AG-UI 是事件协议,npm 上 `@ag-ui/core` 最新是 1.0.3(2026-10-16)。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="MCP Apps、A2UI、AG-UI 的分层关系">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12">
    <rect x="20" y="20" width="160" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="100" y="45" text-anchor="middle" fill="var(--ink)">Agent 后端</text>
    <rect x="460" y="20" width="160" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="540" y="45" text-anchor="middle" fill="var(--ink)">前端 / host</text>
    <line x1="180" y1="40" x2="460" y2="40" stroke="var(--ink-soft)"/>
    <text x="320" y="32" text-anchor="middle" fill="var(--ink)">AG-UI:事件传输层</text>
    <text x="320" y="54" text-anchor="middle" fill="var(--ink-faint)" font-size="11">文本流 / 工具调用 / 状态同步</text>

    <rect x="20" y="100" width="290" height="170" rx="4" fill="none" stroke="var(--rule)"/>
    <text x="165" y="122" text-anchor="middle" fill="var(--ink)">MCP Apps:server 写好的页面</text>
    <rect x="40" y="136" width="250" height="28" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="165" y="155" text-anchor="middle" fill="var(--ink)">工具 _meta.ui.resourceUri</text>
    <rect x="40" y="172" width="250" height="28" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="165" y="191" text-anchor="middle" fill="var(--ink)">ui:// 资源 = 一段 HTML</text>
    <rect x="40" y="208" width="250" height="28" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="165" y="227" text-anchor="middle" fill="var(--ink)">沙箱 iframe + postMessage</text>
    <text x="165" y="256" text-anchor="middle" fill="var(--ink-soft)" font-size="11">表达力强,靠隔离保安全</text>

    <rect x="330" y="100" width="290" height="170" rx="4" fill="none" stroke="var(--rule)"/>
    <text x="475" y="122" text-anchor="middle" fill="var(--ink)">A2UI:Agent 描述的界面</text>
    <rect x="350" y="136" width="250" height="28" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="475" y="155" text-anchor="middle" fill="var(--ink)">createSurface / updateComponents</text>
    <rect x="350" y="172" width="250" height="28" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="475" y="191" text-anchor="middle" fill="var(--ink)">updateDataModel(JSON 数据)</text>
    <rect x="350" y="208" width="250" height="28" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="475" y="227" text-anchor="middle" fill="var(--ink)">客户端组件目录渲染</text>
    <text x="475" y="256" text-anchor="middle" fill="var(--ink-soft)" font-size="11">只是数据,受限于组件目录</text>
  </g>
</svg>
<figcaption>AG-UI 是 Agent 和前端之间的「线」,MCP Apps 和 A2UI 是线上可能传的两种「界面内容」。三者不是三选一。</figcaption>
</figure>

**MCP Apps** 的思路很直接:一个工具在定义里声明「我的结果可以用这个界面展示」,界面本身是 server 上一个 `ui://` 开头的资源,内容是一段 HTML。host 调用这个工具时,把那段 HTML 读出来放进沙箱 iframe,再把工具结果推给它。界面里的 JavaScript 通过 `postMessage` 和 host 说话,格式是 JSON-RPC,能做的包括接收工具结果、调 server 上别的工具、更新模型能看到的上下文、给对话发消息。不支持的 host 会忽略这些元数据,把它当普通工具,只显示文字结果。官方文档里的说法是,它让 server 可以返回交互式界面,并且「应用跑在沙箱 iframe 里,不能访问父页面、偷 cookie 或逃出容器」。

**A2UI** 走另一条路:Agent 不发代码,发几种 JSON 消息描述界面。spec 页写的是,每条消息带一个版本字段,并且四种消息类型里恰好有一种:`createSurface` 开一块界面区域并指定组件目录,`updateComponents` 给出组件列表(平铺的列表,靠 id 互相引用,方便模型流式一点点生成),`updateDataModel` 往界面绑数据,`deleteSurface` 关掉。基础目录有 Text、Row、Column、Card、Button、TextField 等十几种组件。Button 上的 `action.event` 是点击后发回 Agent 的事件。我今天没有跑官方渲染器,但下面写一个几十行的迷你渲染器,足够看清「声明式加白名单」为什么安全。

**AG-UI** 不描述界面长什么样。它定义 Agent 后端和前端之间流动的事件:一次运行的开始和结束,流式文本,工具调用,前后端共享状态。官方文档把它放在三层协议里的一层:MCP 管 Agent 和工具,A2A 管 Agent 和 Agent,AG-UI 管 Agent 和用户界面。文档还明确说它和 A2UI 配合使用,并且把 MCP Apps 列为支持的生成式 UI 集成之一。

所以一种常见组合是:后端框架通过 AG-UI 把事件推给前端;前端遇到 A2UI 消息用自己的渲染器画,遇到带 MCP Apps 界面的工具结果就开一个沙箱 iframe。

### 怎么选

| 你的情况 | 选 |
| --- | --- |
| 写一个给 Claude、ChatGPT 这类通用 host 用的工具,想让结果有界面 | MCP Apps。主流 host 支持最广 |
| 自己控制前端,界面要和产品设计系统一致,还要上移动端 | A2UI。组件用你自己的,Agent 只描述结构 |
| 界面很复杂(图表、地图、编辑器),组件目录表达不了 | MCP Apps |
| 远程第三方 Agent 要往你的界面里塞内容,你不想执行别人的代码 | A2UI |
| 把任意后端框架接到自己的前端,流式显示文本、工具调用、状态 | AG-UI,上面再挑 A2UI 或 MCP Apps |

你是前端出身,这里是优势:MCP Apps 的界面就是一个普通网页,React、打包、CSP、跨域全用得上;A2UI 的渲染器本质上是「把一棵 JSON 树映射成组件」,写过表单引擎或低代码平台的人一看就懂。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ETfABHE7b&autoplay=0&high_quality=1" title="【Web杂谈18】一次性搞懂 Gen UI、A2UI 和 AG-UI" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>捣鼓键盘的小麦 · 【Web杂谈18】一次性搞懂 Gen UI、A2UI 和 AG-UI · 5 分钟,从前端视角分清三个概念,建议先看。</figcaption>
</figure>

## 安全:沙箱挡住什么,挡不住什么

先把结论放前面:三层防护(沙箱 iframe、CSP、工具可见性)挡的是「第三方代码伤害 host」和「模型自己越权」。有三样它们挡不住:服务端授权、界面本身变成注入通道、界面上显示的数据和真正写库的数据不一致。

- **沙箱 iframe**:官方文档说 host 把界面放进沙箱 iframe,界面碰不到 host 的 DOM、cookie 和 localStorage。网页 host 的做法是不同源的沙箱代理页面里再嵌一层。下面练习里你会亲眼看到三层 frame。
- **CSP(内容安全策略)**:浏览器的一个机制,规定一个页面能从哪些域名加载脚本、图片、发请求。MCP Apps 的资源可以在 `_meta.ui.csp` 里声明要访问的域名,不声明就用严格默认值,一个外部域名都不让。
- **工具可见性**:工具可以标 `visibility: ["app"]`,意思是只给界面调用,不出现在模型的工具列表里。

三样没挡住的:

- **服务端授权**。可见性是 host 来执行的约定,一个不守规矩的 client 完全可以直接调 `decide_refund_request`。真正的授权必须在 server 端做。
- **界面也是注入通道**。界面可以往模型上下文里写东西、可以给对话发消息。一个恶意的 MCP App 可以在这里写「忽略之前的指令」。这和 Day 618 里商品描述里的那句假话是同一类问题,只是换了入口。接第三方 MCP App 之前要像审依赖一样审它。
- **界面上显示的数据**。用户看到「批准 98 元」就点了,如果界面上的数据和 server 真正写库的参数不一致,用户看不出来。所以写库的工具必须按 id 重新查库,不要信界面传回来的金额。

## 动手练习

**目标**:给 CloudLedger 做一个退款审批的 MCP App。模型调 `review_refund_request`,对话里出现一张卡片,显示客户、发票、金额、原因,下面有「批准」「驳回」两个按钮;主管点按钮,卡片调一个只对界面开放的工具写库,再把结果告诉模型。

**第 1 步:建目录和装依赖。** 在 `agent-zero-lab` 根目录:

```bash
cd ~/agent-zero-lab
mkdir -p part10/genui && touch part10/genui/__init__.py
uv add "mcp==2.3.0" uvicorn
```

`mcp==2.3.0` 这样写是钉死版本,`uvicorn` 是跑 Python Web 服务的服务器,相当于 Node 里把 express 跑起来的那个进程。界面这边用官方的 `@modelcontextprotocol/ext-apps`,我用 2.0.3,从 jsDelivr 直接引打包好的单文件,所以不用建前端工程。假数据库里的退款申请表要先清空并造两条假申请,一条 98 元,一条 980 元:

```bash
uv run python cloudledger/seed.py
sqlite3 cloudledger/cloudledger.db "INSERT INTO refund_requests (invoice_id, amount_cents, reason, status, created_at) VALUES ('INV-2026-0002', 9800, '9 月重复扣款', 'pending_approval', '2026-10-27T10:00:00'); INSERT INTO refund_requests (invoice_id, amount_cents, reason, status, created_at) VALUES ('INV-2026-0002', 98000, '全额退 10 个月', 'pending_approval', '2026-10-27T10:05:00'); SELECT id, amount_cents FROM refund_requests"
```

`seed.py` 每次运行会删掉重建数据库,所以这条命令之后表里只有这两条。输出 `1|9800` 和 `2|98000`。

**第 2 步:写服务端。**

```python
# agent-zero-lab/part10/genui/refund_app.py
"""退款审批的 MCP App:模型调 review_refund_request,host 在对话里渲染一张审批卡片,
主管在卡片上点「批准 / 驳回」,卡片再调一个只对界面开放的工具把决定写进库。"""
import os
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Annotated, Literal, TypedDict

from pydantic import Field

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

ROOT = Path(__file__).resolve().parents[2]
DB_PATH = Path(os.environ.get("CLOUDLEDGER_DB", ROOT / "cloudledger/cloudledger.db"))
UI_URI = "ui://cloudledger/refund-review.html"
MCP_APP_MIME = "text/html;profile=mcp-app"  # MCP Apps 规定的 MIME,写错 host 就不当界面渲染
HTML = Path(__file__).with_name("refund_review.html")
CSP_DOMAINS = ["https://cdn.jsdelivr.net"]  # 界面要从哪些外部域名加载脚本/样式,不写就一个都不让
SELF_APPROVE_LIMIT_CENTS = 50_000  # 卡片上最多批 500 元;再大的必须走别的流程(服务端规则,不靠界面)

mcp = MCPServer("cloudledger-refund-app", instructions="云簿退款审批。模型只能查看和展示退款申请,批准或驳回必须由人在审批卡片上点。")


class RefundView(TypedDict):
    refund_request_id: int
    invoice_id: str
    customer: str
    invoice_yuan: str
    amount_yuan: str
    reason: str
    status: str
    created_at: str


class Decision(TypedDict):
    refund_request_id: int
    status: str
    decided_at: str


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def load(conn: sqlite3.Connection, rid: int) -> sqlite3.Row:
    row = conn.execute(
        "SELECT r.*, i.amount_cents AS invoice_cents, c.name, c.company "
        "FROM refund_requests r JOIN invoices i ON i.id = r.invoice_id "
        "JOIN customers c ON c.id = i.customer_id WHERE r.id = ?",
        (rid,),
    ).fetchone()
    if row is None:
        raise ToolError(f"退款申请 {rid} 不存在。")
    return row


@mcp.tool(
    annotations=ToolAnnotations(read_only_hint=True, open_world_hint=False),
    meta={"ui": {"resourceUri": UI_URI}},
)
def review_refund_request(
    refund_request_id: Annotated[int, Field(ge=1, description="退款申请编号,来自 create_refund_request 的返回值")],
) -> RefundView:
    """展示一条退款申请给客服主管审批。支持 MCP Apps 的客户端会渲染成带「批准/驳回」按钮的卡片;
    不支持的客户端只看到文字。这个工具不改任何数据。"""
    with db() as conn:
        r = load(conn, refund_request_id)
    return RefundView(
        refund_request_id=r["id"],
        invoice_id=r["invoice_id"],
        customer=f"{r['name']}({r['company']})",
        invoice_yuan=f"{r['invoice_cents'] / 100:.2f}",
        amount_yuan=f"{r['amount_cents'] / 100:.2f}",
        reason=r["reason"],
        status=r["status"],
        created_at=r["created_at"],
    )


@mcp.tool(
    annotations=ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=True),
    meta={"ui": {"resourceUri": UI_URI, "visibility": ["app"]}},
)
def decide_refund_request(
    refund_request_id: Annotated[int, Field(ge=1)],
    decision: Literal["approved", "rejected"],
    note: Annotated[str, Field(max_length=200)] = "",
) -> Decision:
    """只给审批卡片调用:把待审批的退款申请改成 approved 或 rejected。"""
    now = datetime.now().isoformat(timespec="seconds")
    with db() as conn:
        r = load(conn, refund_request_id)
        if decision == "approved" and r["amount_cents"] > SELF_APPROVE_LIMIT_CENTS:
            raise ToolError(f"申请 {refund_request_id} 金额 {r['amount_cents'] / 100:.2f} 元超过卡片审批上限,需要二级审批。")
        if r["status"] != "pending_approval":
            if r["status"] == decision:  # 重复点击按钮:返回原结果,不报错
                return Decision(refund_request_id=r["id"], status=r["status"], decided_at=r["decided_at"])
            raise ToolError(f"申请 {refund_request_id} 已经是 {r['status']},不能再改成 {decision}。")
        conn.execute(
            "UPDATE refund_requests SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?",
            (decision, now, f"mcp-app{':' + note if note else ''}", refund_request_id),
        )
    return Decision(refund_request_id=refund_request_id, status=decision, decided_at=now)


@mcp.resource(
    UI_URI,
    name="refund-review",
    mime_type=MCP_APP_MIME,
    meta={"ui": {"csp": {"resourceDomains": CSP_DOMAINS}, "prefersBorder": True}},
)
def refund_review_ui() -> str:
    """退款审批卡片的 HTML。"""
    return HTML.read_text(encoding="utf-8")


if __name__ == "__main__":
    import uvicorn
    from starlette.middleware.cors import CORSMiddleware

    # 浏览器里的 host(比如 basic-host)跨域访问 server,必须开 CORS,并把会话 id 头暴露出去
    app = CORSMiddleware(
        mcp.streamable_http_app(),
        allow_origins=["http://localhost:8080"],
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["*"],
        expose_headers=["Mcp-Session-Id"],
    )
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "3001")))
```

<div class="line-notes">

- `"""退款审批的 MCP App:模型调 review_refund_request,` 这个文件在 mcp 2.3.0 下实跑过,内存客户端、pytest、真实测试 host 都通过了,输出见后面;basedpyright 0 错误。
- `import sqlite3` 标准库里的 SQLite 驱动,假数据库就是一个文件。
- `from typing import Annotated, Literal, TypedDict` `Annotated` 给类型加附加说明,`Literal` 限制只能取几个固定字符串,`TypedDict` 声明字典的字段。后两个相当于 TS 的字面量联合类型和 `interface`。
- `from pydantic import Field` 前面学过的 pydantic。这里用它给工具参数加约束,比如编号必须大于等于 1。
- `from mcp.server import MCPServer` MCP Python SDK 2.x 里 server 的类。
- `from mcp.server.mcpserver.exceptions import ToolError` 在工具里抛出 `ToolError`,SDK 会把它变成一条「工具失败」的结果返回给调用方,而不是让整个服务崩掉。
- `ROOT = Path(__file__).resolve().parents[2]` 这个文件在 `agent-zero-lab/part10/genui/` 下,往上两级就是仓库根。
- `DB_PATH = Path(os.environ.get("CLOUDLEDGER_DB", ROOT / "cloudledger/cloudledger.db"))` 默认用仓库里那份假数据库;想不弄脏它,设环境变量 `CLOUDLEDGER_DB` 指到一份副本。
- `UI_URI = "ui://cloudledger/refund-review.html"` `ui://` 这个前缀告诉 host「这是一个 MCP App 界面」,后面的路径随你起。
- `MCP_APP_MIME = "text/html;profile=mcp-app"` 规范要求界面资源用这个 MIME,写成普通的 `text/html`,host 不会把它当 MCP App 渲染。
- `HTML = Path(__file__).with_name("refund_review.html")` 界面单独放一个文件,编辑器能高亮。
- `CSP_DOMAINS = ["https://cdn.jsdelivr.net"]` 界面要从哪些外部域名加载东西。单独拎成常量,练习 2 的检查脚本要用它。
- `SELF_APPROVE_LIMIT_CENTS = 50_000` 卡片上最多批 500 元,单位是分。Python 允许数字里用下划线分隔,`50_000` 就是 50000。**这条规则放在服务端,不靠界面**,后面实验会撞一次。
- `mcp = MCPServer("cloudledger-refund-app", instructions=` server 的说明会给模型看,把权限边界写清楚:模型只能看,不能批。
- `class RefundView(TypedDict):` 返回值用 TypedDict 声明,SDK 才会生成 outputSchema,并把结果放进 `structuredContent`。**界面要读的就是这个字段**;只返回普通 `dict` 的话界面拿不到结构化数据。
- `class Decision(TypedDict):` 决定写库之后的返回值:申请编号、新状态、决定时间。
- `conn.row_factory = sqlite3.Row` 让查询结果能按列名取值(`r["name"]`),相当于每行是个对象而不是数组。
- `def load(conn: sqlite3.Connection, rid: int) -> sqlite3.Row:` 两个工具共用的查询,一次 join 出申请、发票金额、客户名。
- `"SELECT r.*, i.amount_cents AS invoice_cents, c.name, c.company "` `JOIN` 把三张表拼成一行:申请表、发票表、客户表,`AS invoice_cents` 给发票金额起别名,免得和申请金额重名。
- `raise ToolError(f"退款申请 {rid} 不存在。")` 查不到就失败。实测查一个不存在的编号,返回的是 `is_error=True`。
- `meta={"ui": {"resourceUri": UI_URI}},` **MCP Apps 在工具这一侧只有这一行**:在工具的 `_meta` 里放 `ui.resourceUri`,指向界面资源。
- `def review_refund_request(` 模型能调的工具,只读。
- `refund_request_id: Annotated[int, Field(ge=1, description="退款申请编号,来自 create_refund_request 的返回值")],` `ge=1` 是「大于等于 1」。
- `"""展示一条退款申请给客服主管审批。` 描述里写明不支持界面的客户端只看到文字。规范要求带界面的工具也要返回有意义的文字内容,做到优雅降级。
- `with db() as conn:` 用完自动关。
- `invoice_yuan=f"{r['invoice_cents'] / 100:.2f}",` 库里金额是分,这里转成元并保留两位小数。实跑 INV-2026-0002 输出 `98.00`。
- `meta={"ui": {"resourceUri": UI_URI, "visibility": ["app"]}},` **关键一行**:`visibility: ["app"]` 表示这个工具只给界面调用,host 不应该把它放进模型的工具列表。
- `def decide_refund_request(` 写库的工具:只收编号、决定、备注,**不收金额**。
- `decision: Literal["approved", "rejected"],` 只能是这两个字符串之一,传 `"paid"` 会被校验拦下。
- `now = datetime.now().isoformat(timespec="seconds")` 当前时间,精确到秒,格式如 `2026-10-27T13:04:23`。
- `if decision == "approved" and r["amount_cents"] > SELF_APPROVE_LIMIT_CENTS:` 批准大额的,服务端直接拒绝,不管是谁在调。驳回不受限制。
- `raise ToolError(f"申请 {refund_request_id} 金额 {r['amount_cents'] / 100:.2f} 元超过卡片审批上限,需要二级审批。")` 实跑 980 元那条,返回 `Error executing tool decide_refund_request: 申请 3 金额 980.00 元超过卡片审批上限,需要二级审批。`(编号取决于你库里当时的自增值)。
- `if r["status"] != "pending_approval":` 已经处理过的申请。
- `if r["status"] == decision:  # 重复点击按钮:返回原结果,不报错` 幂等:同样的决定重复提交,原样返回,不出错也不改第二次。
- `raise ToolError(f"申请 {refund_request_id} 已经是 {r['status']},不能再改成 {decision}。")` 先批准再驳回,拒绝。
- `(decision, now, f"mcp-app{':' + note if note else ''}", refund_request_id),` `decided_by` 记成 `mcp-app:备注`。这只是练习的简化:生产里这里应该是从登录令牌里解出来的审批人身份。
- `@mcp.resource(` 注册界面资源。
- `meta={"ui": {"csp": {"resourceDomains": CSP_DOMAINS}, "prefersBorder": True}},` 声明界面要从哪些域名加载脚本。`prefersBorder` 是请 host 给卡片画个边框,host 可以不理。
- `return HTML.read_text(encoding="utf-8")` 每次读文件,改了 HTML 不用重启 server。
- `import uvicorn` 不用 `mcp.run(...)`,因为要在外面包一层 CORS 中间件。
- `app = CORSMiddleware(` 测试 host 是跑在 `localhost:8080` 的网页,它用浏览器 fetch 去连 3001 端口,这是跨域请求,没有 CORS 头浏览器会拦。
- `allow_origins=["http://localhost:8080"],` 只放行测试 host 这一个来源,不写 `*`。
- `expose_headers=["Mcp-Session-Id"],` 会话 id 放在这个响应头里,浏览器默认不让脚本读自定义响应头,不暴露 host 就拿不到会话。
- `uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "3001")))` **只绑 127.0.0.1**,同一个局域网里的别的机器连不进来。端口 3001。

</div>

**第 3 步:写界面。** 一个普通 HTML 文件,唯一特别的是用官方的 `App` 类和 host 通信。你是前端,这段你读起来不会费劲,我只标出 Agent 相关的几行。

```html
<!-- agent-zero-lab/part10/genui/refund_review.html -->
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  body { font: 14px/1.6 var(--font-sans, system-ui, sans-serif); margin: 0; padding: 12px;
         color: var(--color-text-primary, #1f2328); background: var(--color-background-primary, transparent); }
  .row { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; border-bottom: 1px solid #8884; }
  .row span:first-child { color: #888; }
  textarea { width: 100%; box-sizing: border-box; margin: 8px 0; min-height: 48px; }
  button { padding: 6px 14px; margin-right: 8px; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  #status { margin-top: 8px; font-weight: 600; }
</style>
</head>
<body>
<div id="card">等待工具结果...</div>
<textarea id="note" placeholder="审批备注(可选)"></textarea>
<button id="approve" disabled>批准</button>
<button id="reject" disabled>驳回</button>
<div id="status"></div>

<script type="module">
import { App } from "https://cdn.jsdelivr.net/npm/@modelcontextprotocol/ext-apps@2.0.3/dist/src/app-with-deps.js";

const app = new App({ name: "CloudLedger Refund Review", version: "1.0.0" });
let view = null;

function render(v) {
  const rows = [["申请编号", v.refund_request_id], ["客户", v.customer], ["发票", `${v.invoice_id}(${v.invoice_yuan} 元)`],
                ["申请退款", `${v.amount_yuan} 元`], ["原因", v.reason], ["状态", v.status]];
  const card = document.getElementById("card");
  card.replaceChildren(...rows.map(([k, val]) => {
    const div = document.createElement("div");
    div.className = "row";
    div.append(Object.assign(document.createElement("span"), { textContent: k }),
               Object.assign(document.createElement("span"), { textContent: String(val) }));
    return div;
  }));
  const pending = v.status === "pending_approval";
  document.getElementById("approve").disabled = !pending;
  document.getElementById("reject").disabled = !pending;
}

app.ontoolresult = (result) => {
  view = result.structuredContent;
  if (view) render(view);
  else document.getElementById("card").textContent = result.content?.[0]?.text ?? "没有拿到数据";
};

async function decide(decision) {
  const note = document.getElementById("note").value.trim();
  document.getElementById("approve").disabled = true;
  document.getElementById("reject").disabled = true;
  const res = await app.callServerTool({
    name: "decide_refund_request",
    arguments: { refund_request_id: view.refund_request_id, decision, note },
  });
  const status = document.getElementById("status");
  if (res.isError) {
    status.textContent = "失败:" + (res.content?.[0]?.text ?? "未知错误");
    return;
  }
  view = { ...view, status: res.structuredContent.status };
  render(view);
  status.textContent = decision === "approved" ? "已批准" : "已驳回";
  await app.updateModelContext({
    content: [{ type: "text", text: `主管在审批卡片上${status.textContent}退款申请 ${view.refund_request_id}。备注:${note || "无"}` }],
  });
}

document.getElementById("approve").onclick = () => decide("approved");
document.getElementById("reject").onclick = () => decide("rejected");
await app.connect();
</script>
</body>
</html>
```

<div class="line-notes">

- `<!DOCTYPE html>` 一个普通网页的开头。
- `<style>` 样式里用了 `var(--color-text-primary, #1f2328)` 这种写法:host 会通过 CSS 变量把自己的主题色传进来,没有就用后面的默认值,这样卡片在亮色、暗色 host 里都不突兀。
- `<div id="card">等待工具结果...</div>` 初始状态。如果 host 一直没把工具结果推进来(比如脚本被 CSP 拦了),界面会一直停在这句话上。
- `<textarea id="note" placeholder="审批备注(可选)"></textarea>` 备注框,内容会随决定一起提交。
- `<button id="approve" disabled>批准</button>` 两个按钮一开始都是禁用,收到数据确认状态是待审批才打开。
- `<script type="module">` 用 ES module,下一行才能 `import`。
- `import { App } from "https://cdn.jsdelivr.net/npm/@modelcontextprotocol/ext-apps@2.0.3/dist/src/app-with-deps.js";` 从 jsDelivr 加载官方的 `App` 类。**这个域名必须出现在服务端的 `CSP_DOMAINS` 里**,否则沙箱的 CSP 会拦。版本钉在 2.0.3。
- `const app = new App({ name: "CloudLedger Refund Review", version: "1.0.0" });` 创建 App 对象,名字和版本在握手时报给 host。
- `let view = null;` 保存最近一次拿到的申请数据。
- `function render(v) {` 把一条申请画出来。
- `const rows = [["申请编号", v.refund_request_id], ["客户", v.customer],` 六行「标签、值」。
- `card.replaceChildren(...rows.map(([k, val]) => {` 每次重画先清空再放新内容。
- `Object.assign(document.createElement("span"), { textContent: k }),` 用 `textContent` 而不是 `innerHTML` 放文字。**退款原因这类字段可能来自客户输入**,用 `innerHTML` 就等于把别人的字符串当 HTML 执行。沙箱能限制破坏范围,但不该靠沙箱兜这种低级错误。
- `const pending = v.status === "pending_approval";` 只有待审批的申请才允许点按钮。
- `app.ontoolresult = (result) => {` host 把工具结果推过来时调用。
- `view = result.structuredContent;` 读的就是服务端 `RefundView` 那几个字段。
- `else document.getElementById("card").textContent = result.content?.[0]?.text ?? "没有拿到数据";` 没有结构化数据时(比如工具报错),把文字内容直接显示出来。后面空参数那次实测就走了这条分支。
- `async function decide(decision) {` 点按钮时调用。
- `document.getElementById("approve").disabled = true;` 点了先禁用两个按钮,防止连点两次。
- `const res = await app.callServerTool({` 界面通过 host 调 server 上的工具。这就是 `visibility: ["app"]` 那个工具被调用的路径。
- `arguments: { refund_request_id: view.refund_request_id, decision, note },` 只传编号、决定、备注,没有金额。
- `if (res.isError) {` 服务端拒绝时(比如超过 500 元上限),把原因显示出来。
- `view = { ...view, status: res.structuredContent.status };` 用服务端返回的新状态更新本地数据。
- `await app.updateModelContext({` 告诉模型「主管做了什么决定」。这是界面往模型上下文写东西的入口,也是前面说的「界面也是注入通道」的入口,这里写的是固定格式的一句话。
- `document.getElementById("approve").onclick = () => decide("approved");` 按钮绑定。
- `await app.connect();` 和 host 握手。`<script type="module">` 里允许顶层 `await`。

</div>

**第 4 步:先不开 host,用内存客户端验一遍。** 内存客户端不开端口,但走完整协议:

```python
# agent-zero-lab/part10/genui/probe.py
"""不开 host,用内存客户端看 server 对外暴露了什么,顺便把审批流程走一遍。全是假订单。"""
import asyncio
import sqlite3

from mcp import Client
from mcp.types import TextContent, TextResourceContents

from part10.genui.refund_app import DB_PATH, UI_URI, mcp


def new_request(invoice_id: str, cents: int, reason: str) -> int:
    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.execute(
            "INSERT INTO refund_requests (invoice_id, amount_cents, reason, status, created_at) "
            "VALUES (?, ?, ?, 'pending_approval', '2026-10-27T10:00:00')",
            (invoice_id, cents, reason),
        )
        return int(cur.lastrowid or 0)


async def main() -> None:
    small = new_request("INV-2026-0002", 9800, "9 月重复扣款")
    big = new_request("INV-2026-0002", 98000, "全额退 10 个月")
    async with Client(mcp) as c:
        for t in (await c.list_tools()).tools:
            print("tool:", t.name, t.meta)
        page = (await c.read_resource(UI_URI)).contents[0]
        assert isinstance(page, TextResourceContents)
        print("resource:", page.mime_type, page.meta, len(page.text), "chars")
        r = await c.call_tool("review_refund_request", {"refund_request_id": small})
        print("review:", r.structured_content)
        r = await c.call_tool("decide_refund_request", {"refund_request_id": small, "decision": "approved"})
        print("decide:", r.structured_content)
        r = await c.call_tool("decide_refund_request", {"refund_request_id": small, "decision": "rejected"})
        assert isinstance(r.content[0], TextContent)
        print("decide again:", r.is_error, r.content[0].text)
        r = await c.call_tool("decide_refund_request", {"refund_request_id": big, "decision": "approved"})
        assert isinstance(r.content[0], TextContent)
        print("big approve:", r.is_error, r.content[0].text)


asyncio.run(main())
```

<div class="line-notes">

- `"""不开 host,用内存客户端看 server 对外暴露了什么,顺便把审批流程走一遍。全是假订单。"""` 会往假数据库里插两条申请并批准一条。想保持库干净,先复制一份再用 `CLOUDLEDGER_DB` 指过去。
- `from mcp import Client` 官方的客户端类,`Client(mcp)` 直接连一个 server 对象,不走网络。
- `from mcp.types import TextContent, TextResourceContents` 下面用 `isinstance` 收窄类型。工具结果的内容块有文字、图片、音频好几种,不收窄编辑器会报 `Cannot access attribute "text"`。
- `from part10.genui.refund_app import DB_PATH, UI_URI, mcp` 复用服务端文件里的变量。
- `def new_request(invoice_id: str, cents: int, reason: str) -> int:` 造一条待审批申请并返回它的编号。
- `"VALUES (?, ?, ?, 'pending_approval', '2026-10-27T10:00:00')",` 占位符传值,不拼字符串。
- `return int(cur.lastrowid or 0)` `lastrowid` 理论上可能是 `None`,`or 0` 让类型检查通过。
- `small = new_request("INV-2026-0002", 9800, "9 月重复扣款")` 98 元那条。
- `big = new_request("INV-2026-0002", 98000, "全额退 10 个月")` 980 元那条。
- `async with Client(mcp) as c:` 异步上下文管理器,进来时连上,出去时断开。
- `print("tool:", t.name, t.meta)` 每个工具和它的 `_meta`。
- `page = (await c.read_resource(UI_URI)).contents[0]` 读界面资源。
- `print("resource:", page.mime_type, page.meta, len(page.text), "chars")` 输出 MIME、CSP 声明和 HTML 的字符数。
- `r = await c.call_tool("review_refund_request", {"refund_request_id": small})` 模型会走的路径。
- `r = await c.call_tool("decide_refund_request", {"refund_request_id": small, "decision": "approved"})` 批准 98 元那条。
- `print("decide again:", r.is_error, r.content[0].text)` 再驳回一次。
- `print("big approve:", r.is_error, r.content[0].text)` 批准 980 元那条,服务端应该拒绝。
- `asyncio.run(main())` 启动异步函数。

</div>

```bash
uv run python -m part10.genui.probe
```

我把库重置后跑的输出(申请编号 2、3 是因为我之前已经建了 1 号,你的编号取决于你库里的自增值;开头两行是 SDK 在标准错误里打的日志,也是预期内的失败):

```text
Tool 'decide_refund_request' failed: 'Error executing tool decide_refund_request: 申请 2 已经是 approved,不能再改成 rejected。'
Tool 'decide_refund_request' failed: 'Error executing tool decide_refund_request: 申请 3 金额 980.00 元超过卡片审批上限,需要二级审批。'
tool: review_refund_request {'ui': {'resourceUri': 'ui://cloudledger/refund-review.html'}}
tool: decide_refund_request {'ui': {'resourceUri': 'ui://cloudledger/refund-review.html', 'visibility': ['app']}}
resource: text/html;profile=mcp-app {'ui': {'csp': {'resourceDomains': ['https://cdn.jsdelivr.net']}, 'prefersBorder': True}} 3159 chars
review: {'refund_request_id': 2, 'invoice_id': 'INV-2026-0002', 'customer': '刘伟(星河餐饮)', 'invoice_yuan': '98.00', 'amount_yuan': '98.00', 'reason': '9 月重复扣款', 'status': 'pending_approval', 'created_at': '2026-10-27T10:00:00'}
decide: {'refund_request_id': 2, 'status': 'approved', 'decided_at': '2026-10-27T13:04:23'}
decide again: True Error executing tool decide_refund_request: 申请 2 已经是 approved,不能再改成 rejected。
big approve: True Error executing tool decide_refund_request: 申请 3 金额 980.00 元超过卡片审批上限,需要二级审批。
```

注意第二行 `tool: decide_refund_request` 也被列出来了,带着 `visibility: ['app']`。**内存客户端不懂 MCP Apps,可见性过滤是 host 的责任,server 不会替你藏。** 这就是为什么 server 自己必须拦住大额批准:`probe.py` 里最后一次调用相当于一个不守规矩的 client 直接调写库工具,拦住它的是服务端代码,不是可见性标记。

**第 5 步:装测试 host 并点一遍。** 官方仓库带了一个测试 host,叫 basic-host。以下命令在 `~` 下执行(我放在了自己的临时目录里,你的放哪都行):

```bash
git clone --depth 1 https://github.com/modelcontextprotocol/ext-apps.git ~/ext-apps
cd ~/ext-apps/examples/basic-host
npm install
node node_modules/esbuild/install.js
NODE_ENV=development INPUT=index.html npx vite build
NODE_ENV=development INPUT=sandbox.html npx vite build
SERVERS='["http://127.0.0.1:3001/mcp"]' node serve.ts
```

这几条我踩过的点:README 写的是 `npm run start`,但它的 `serve` 脚本调用 `bun`,本机没装就起不来;Node 23.6 以上可以直接 `node serve.ts`(我是 24)。`npm run build` 里有一步 `tsc --noEmit`,在仓库外单独装时我没试,直接用上面两次 `vite build` 就够。新版 npm 默认不跑依赖的安装脚本(`npm install` 末尾会提示 `esbuild@0.27.2 (postinstall: node install.js)` 被跳过),所以手动跑一次 esbuild 的 `install.js`;我这条命令的输出尾部只有一行 Node 版本信息,没有影响后面的构建,两次 `vite build` 都显示 `✓ built`。`serve.ts` 起来后打印 `Host server: http://localhost:8080` 和 `Sandbox server: http://localhost:8081`。

另开一个终端起服务端:

```bash
cd ~/agent-zero-lab
uv run python -m part10.genui.refund_app
```

浏览器打开 `http://localhost:8080`。我是用一段无头 Chrome 的脚本替代手点的(脚本放在我自己的临时目录里,不属于课程仓库),你手动点,看到的应该一样:

- Server 下拉框显示 `cloudledger-refund-app`,Tool 下拉框里**只有** `review_refund_request` 一项,`decide_refund_request` 被 host 藏起来了。host 控制台那行 `Server tools: [review_refund_request, decide_refund_request]` 说明 host 其实看得到两个,只是不给模型和下拉框。
- Input 里填 `{"refund_request_id": 1}`,点 Call Tool。卡片出现,内容是:申请编号 1,客户 刘伟(星河餐饮),发票 INV-2026-0002(98.00 元),申请退款 98.00 元,原因 9 月重复扣款,状态 pending_approval,下面是备注框和两个按钮。
- 在备注框里写「核实为重复扣款」,点批准。卡片状态变成 approved,下面显示「已批准」;host 页面的 Model Context 面板出现「主管在审批卡片上已批准退款申请 1。备注:核实为重复扣款」。
- 查库:

```bash
sqlite3 cloudledger/cloudledger.db "SELECT id, status, decided_at, decided_by FROM refund_requests"
```

```text
1|approved|2026-10-27T13:06:51|mcp-app:核实为重复扣款
2|pending_approval||
```

一个我撞上的坑:我第一次脚本是在页面刚打开时就填输入框,结果 host 用 `{}` 调了工具,界面上显示的是 `Error executing tool review_refund_request: 1 validation error ... Field required`。这是 host 在服务器列表加载完之后会把输入框重置成默认值,我填早了。这个报错本身是个有用的演示:界面的 `ontoolresult` 没拿到结构化数据,走了「把文字内容直接显示出来」那一支,所以用户看到的是错误文字,按钮也保持禁用。等页面稳定(我等了 2 秒)再填就正常了。

host 的浏览器控制台里,整个握手过程会打印出来,值得读一遍:`Reading UI resource`、`Loading sandbox proxy... (CSP: {"resourceDomains":["https://cdn.jsdelivr.net"]})`、`MCP App initialized`、`Sending tool call input to MCP App`、`Sending tool call result to MCP App`,点按钮之后是 `Model context update from MCP App`。另外控制台开头有一条 `Failed to load resource: the server responded with a status of 404`,出现在 `Connected via Streamable HTTP transport` 之前,我没追它的来源,不影响连接。

### 实验:亲手撞一次三层防护

**实验一:服务端拒绝大额。** 在 host 里调 `{"refund_request_id": 2}`(980 元那条),点批准。卡片没有变,状态行显示:

```text
失败:Error executing tool decide_refund_request: 申请 2 金额 980.00 元超过卡片审批上限,需要二级审批。
```

库里 2 号仍是 `pending_approval`。这是服务端规则在起作用,界面上的「批准」按钮是亮的,它不知道金额超没超限。

**实验二:删掉 CSP 声明。** 把服务端里 `meta={"ui": {"csp": {"resourceDomains": CSP_DOMAINS}, "prefersBorder": True}}` 改成 `meta={"ui": {"prefersBorder": True}}`,重启服务端,再调一次。卡片一直停在「等待工具结果...」,浏览器控制台报:

```text
Loading the script 'https://cdn.jsdelivr.net/npm/@modelcontextprotocol/ext-apps@2.0.3/dist/src/app-with-deps.js' violates the following Content Security Policy directive: "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data:".
```

默认拒绝的 CSP 在起作用:没声明的外部域名一律不让加载。我做完实验就把这一行恢复了,你也记得改回来。

**实验三:看沙箱结构。** 打开开发者工具看 frame 列表,有三层:`localhost:8080/...`(host)、`localhost:8081/sandbox.html?csp=...`(端口不同,所以不同源)、`about:blank`(用 `srcdoc` 塞进去的界面)。我在最里层执行了这几个表达式:

```text
window.parent.document.title        => MCP-UI Proxy
window.parent.parent.document.title => SecurityError: Failed to read a named property 'document' from 'Window': Blocked a frame with origin "http://localhost:8081" from accessing a cross-origin frame.
document.cookie                     => (空字符串)
localStorage.length                 => 0
```

能读到上一层沙箱代理页面的标题,再往上一层(host 页面)就被浏览器的同源策略挡住了,cookie 和 localStorage 是空的。这里有个我没预料的细节:最里层界面能读到它的直接父页面(沙箱代理),这是设计里就有的,真正的墙是代理页和 host 之间的跨源。

**实验四(不做,只说明):接进 Claude。** 想在 Claude 里试,要把本地服务暴露到公网,那就不再是「只绑 127.0.0.1」了,而且我没做,所以这里不给结果。如果你做,把 CORS 的 `allow_origins`、隧道地址的安全性想清楚,用完关掉。

### 第 6 步:A2UI 的另一条路,写个迷你渲染器

MCP Apps 的界面是一段代码。A2UI 的界面是一份数据。下面这个迷你渲染器只认五种组件,把一组 A2UI 风格的消息渲染成文字,并且拒绝任何不在目录里的东西。**它不是官方渲染器,消息格式我对照的是 A2UI spec 页 v0.9 的 `updateComponents` 示例(页面上例子写的 `"version": "v0.9"`;仓库 README 把当前稳定版叫 v0.9.1)。** 按钮上的 `child` 引用另一个 Text 组件的写法,spec 页里示例流用 `child`,单独的例子用 `text`,页面没说哪个是标准,我用 `child`。

```python
# agent-zero-lab/part10/genui/a2ui_mini.py
"""手写的迷你 A2UI 渲染器:只认白名单组件,输出文字版界面。不是官方渲染器,只演示「声明式 + 白名单」为什么安全。"""
import json
import sqlite3
from typing import Any

from part10.genui.refund_app import DB_PATH

CATALOG = {"Card", "Column", "Row", "Text", "Button"}  # 客户端自己决定认哪些组件


def pointer(model: dict[str, Any], path: str) -> Any:
    """JSON Pointer 的最简版:/refund/amount -> model["refund"]["amount"]"""
    cur: Any = model
    for part in path.strip("/").split("/"):
        cur = cur[part]
    return cur


def value(model: dict[str, Any], v: Any) -> str:
    return str(pointer(model, v["path"])) if isinstance(v, dict) and "path" in v else str(v)


def render(components: list[dict[str, Any]], model: dict[str, Any]) -> list[str]:
    by_id = {c["id"]: c for c in components}
    if "root" not in by_id:
        raise ValueError("缺少 id 为 root 的组件")
    lines: list[str] = []

    def walk(cid: str, depth: int, seen: frozenset[str]) -> None:
        if cid in seen:
            raise ValueError(f"组件 {cid} 形成了环")
        c = by_id[cid]
        kind = c["component"]
        if kind not in CATALOG:
            raise ValueError(f"组件 {kind} 不在目录里,拒绝渲染")
        pad = "  " * depth
        if kind == "Text":
            lines.append(f"{pad}{value(model, c['text'])}")
        elif kind == "Button":
            label = value(model, by_id[c["child"]]["text"])
            lines.append(f"{pad}[ {label} ] -> 事件 {c['action']['event']['name']}")
        else:
            lines.append(f"{pad}<{kind}>")
            for child in c.get("children", [c["child"]] if "child" in c else []):
                walk(child, depth + 1, seen | {cid})

    walk("root", 0, frozenset())
    return lines


def update_components(surface: str) -> dict[str, Any]:
    return {"version": "v0.9", "updateComponents": {"surfaceId": surface, "components": [
        {"id": "root", "component": "Card", "child": "col"},
        {"id": "col", "component": "Column", "children": ["who", "amount", "buttons"]},
        {"id": "who", "component": "Text", "text": {"path": "/refund/customer"}},
        {"id": "amount", "component": "Text", "text": {"path": "/refund/amount"}},
        {"id": "buttons", "component": "Row", "children": ["approve", "reject"]},
        {"id": "approve_label", "component": "Text", "text": "批准"},
        {"id": "approve", "component": "Button", "child": "approve_label",
         "action": {"event": {"name": "approve_refund", "context": {"id": {"path": "/refund/id"}}}}},
        {"id": "reject_label", "component": "Text", "text": "驳回"},
        {"id": "reject", "component": "Button", "child": "reject_label",
         "action": {"event": {"name": "reject_refund", "context": {"id": {"path": "/refund/id"}}}}},
    ]}}


def on_action(event: dict[str, Any]) -> str:
    """Agent 后端收到按钮事件。注意:金额不从事件里取,按 id 重新查库。"""
    rid = event["context"]["id"]
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute("SELECT amount_cents, status FROM refund_requests WHERE id = ?", (rid,)).fetchone()
    if row is None:
        return f"{event['name']}: 申请 {rid} 不存在,忽略"
    return f"{event['name']}: 申请 {rid},库里金额 {row[0] / 100:.2f} 元,状态 {row[1]},事件里带的金额被忽略"


if __name__ == "__main__":
    model = {"refund": {"id": 1, "customer": "刘伟(星河餐饮)", "amount": "98.00 元"}}
    msg = update_components("refund_card")
    print(json.dumps(msg)[:90], "...")
    print("\n".join(render(msg["updateComponents"]["components"], model)))
    model["refund"]["amount"] = "9800.00 元"  # updateDataModel:只改数据,组件不用重发
    print("--- updateDataModel 之后 ---")
    print("\n".join(render(msg["updateComponents"]["components"], model)[:4]))
    print("--- 恶意消息 ---")
    bad = [{"id": "root", "component": "Iframe", "src": "http://evil.example/"}]
    try:
        render(bad, model)
    except ValueError as e:
        print("拒绝:", e)
    try:
        render([{"id": "root", "component": "Card", "child": "root"}], model)
    except ValueError as e:
        print("拒绝:", e)
    print(on_action({"name": "approve_refund", "context": {"id": 1, "amount": 1}}))
    print(on_action({"name": "approve_refund", "context": {"id": 99}}))
```

<div class="line-notes">

- `"""手写的迷你 A2UI 渲染器:只认白名单组件,输出文字版界面。不是官方渲染器,只演示「声明式 + 白名单」为什么安全。"""` 先把话说清楚,免得你把它当成官方实现。
- `from part10.genui.refund_app import DB_PATH` 借用上面服务端文件里的数据库路径,最后一个演示要查库。
- `CATALOG = {"Card", "Column", "Row", "Text", "Button"}  # 客户端自己决定认哪些组件` 花括号加逗号是 Python 的集合(set),相当于 JS 的 `new Set([...])`。**白名单在客户端手里**,Agent 发来什么都得过这一关。
- `def pointer(model: dict[str, Any], path: str) -> Any:` JSON Pointer 的最简版:`/refund/amount` 取出 `model["refund"]["amount"]`。
- `for part in path.strip("/").split("/"):` 把路径按斜杠拆开,一层一层往下取。
- `def value(model: dict[str, Any], v: Any) -> str:` 一个值可以是写死的字符串,也可以是 `{"path": "..."}` 这样的数据绑定。
- `return str(pointer(model, v["path"])) if isinstance(v, dict) and "path" in v else str(v)` 是绑定就去数据里取,否则直接用。
- `def render(components: list[dict[str, Any]], model: dict[str, Any]) -> list[str]:` 输入组件列表和数据,输出文字行。
- `by_id = {c["id"]: c for c in components}` 组件是平铺的列表,靠 id 互相引用,先建一个按 id 查的字典。
- `if "root" not in by_id:` A2UI 要求必须有一个 id 为 `root` 的组件作为树根。
- `def walk(cid: str, depth: int, seen: frozenset[str]) -> None:` 递归地从根往下走;`seen` 记录当前这条路径上走过的 id。
- `if cid in seen:` 走回了自己的祖先:消息里有环。没这个检查,恶意消息能让渲染器死循环。
- `if kind not in CATALOG:` **这就是白名单**。Agent 发来一个 `Iframe` 或 `Script`,直接拒绝。
- `lines.append(f"{pad}[ {label} ] -> 事件 {c['action']['event']['name']}")` 按钮显示它点击后会发出的事件名。
- `for child in c.get("children", [c["child"]] if "child" in c else []):` 容器组件可能有 `children`(多个子)或 `child`(一个子),统一处理。
- `def update_components(surface: str) -> dict[str, Any]:` 生成一条 `updateComponents` 消息:一个卡片,里面是客户、金额、两个按钮。
- `{"id": "who", "component": "Text", "text": {"path": "/refund/customer"}},` 文本绑定到数据模型的路径,不写死。以后改数据只发 `updateDataModel`,组件不用重发。
- `"action": {"event": {"name": "approve_refund", "context": {"id": {"path": "/refund/id"}}}}},` 点击后发回 Agent 的事件,带上申请编号。
- `def on_action(event: dict[str, Any]) -> str:` Agent 后端收到按钮事件时的处理。
- `rid = event["context"]["id"]` 只从事件里取编号。
- `if row is None:` 编号不存在时返回一句提示。我第一版没有这个判断,演示用的编号写错了,直接抛了 `TypeError: 'NoneType' object is not subscriptable`,这是真实踩到的。
- `return f"{event['name']}: 申请 {rid},库里金额 {row[0] / 100:.2f} 元,状态 {row[1]},事件里带的金额被忽略"` **金额按编号重新查库**,事件里带什么金额都不信。和 MCP App 里「写库工具不收金额」是同一个原则。
- `model = {"refund": {"id": 1, "customer": "刘伟(星河餐饮)", "amount": "98.00 元"}}` 演示用的数据模型。
- `model["refund"]["amount"] = "9800.00 元"  # updateDataModel:只改数据,组件不用重发` 模拟 `updateDataModel`:只改数据,渲染结果跟着变。
- `bad = [{"id": "root", "component": "Iframe", "src": "http://evil.example/"}]` 一条恶意消息:想让客户端嵌一个外站页面。
- `render([{"id": "root", "component": "Card", "child": "root"}], model)` 另一条恶意消息:自己指向自己。
- `print(on_action({"name": "approve_refund", "context": {"id": 1, "amount": 1}}))` 事件里夹带一个 `amount: 1`,看它会不会被信。
- `print(on_action({"name": "approve_refund", "context": {"id": 99}}))` 一个不存在的编号。

</div>

```bash
uv run python -m part10.genui.a2ui_mini
```

```text
{"version": "v0.9", "updateComponents": {"surfaceId": "refund_card", "components": [{"id": ...
<Card>
  <Column>
    刘伟(星河餐饮)
    98.00 元
    <Row>
      [ 批准 ] -> 事件 approve_refund
      [ 驳回 ] -> 事件 reject_refund
--- updateDataModel 之后 ---
<Card>
  <Column>
    刘伟(星河餐饮)
    9800.00 元
--- 恶意消息 ---
拒绝: 组件 Iframe 不在目录里,拒绝渲染
拒绝: 组件 root 形成了环
approve_refund: 申请 1,库里金额 98.00 元,状态 approved,事件里带的金额被忽略
approve_refund: 申请 99 不存在,忽略
```

(状态 approved 是因为前面在 host 里批过 1 号。)和 MCP Apps 对比:这里没有任何代码被执行,最坏的情况是拒绝渲染。代价也看得到:这个目录里没有图表,你要什么都得先进目录。

### 第 7 步:AG-UI 事件流长什么样

AG-UI 只管「线」。下面的脚本把一次「查退款申请再汇报一句」的运行,按 AG-UI 文档里的事件名吐成 SSE 文本(SSE 是前面做流式输出时见过的服务端推送格式,每行 `data: {...}`)。事件名和字段对照的是 AG-UI 事件文档:`RUN_STARTED`(`threadId`、`runId`)、`TOOL_CALL_START/ARGS/END/RESULT`、`TEXT_MESSAGE_START/CONTENT/END`、`RUN_FINISHED`。文档页的事件名是驼峰写法(如 `RunStarted`),大写加下划线是我按惯例的转换。这是只演示事件形状的小脚本,**不是官方 SDK**。

```python
# agent-zero-lab/part10/genui/agui_events.py
"""把一次「查退款申请并用一句话汇报」的运行,按 AG-UI 的事件名吐成 SSE 文本。只演示事件形状,不是官方 SDK。"""
import asyncio
import json
import uuid
from collections.abc import Iterator

from mcp import Client

from common.llm import LLMClient
from part10.genui.refund_app import mcp


def sse(event: dict[str, object]) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n"


async def run() -> Iterator[str]:
    llm = LLMClient()
    thread, run_id, msg_id, call_id = "t1", f"run-{uuid.uuid4().hex[:6]}", "m1", "c1"
    out: list[str] = [sse({"type": "RUN_STARTED", "threadId": thread, "runId": run_id})]
    args = {"refund_request_id": 1}
    out += [sse({"type": "TOOL_CALL_START", "toolCallId": call_id, "toolCallName": "review_refund_request"}),
            sse({"type": "TOOL_CALL_ARGS", "toolCallId": call_id, "delta": json.dumps(args)}),
            sse({"type": "TOOL_CALL_END", "toolCallId": call_id})]
    async with Client(mcp) as c:
        res = await c.call_tool("review_refund_request", args)
    out.append(sse({"type": "TOOL_CALL_RESULT", "messageId": "m0", "toolCallId": call_id, "content": json.dumps(res.structured_content, ensure_ascii=False)}))
    out.append(sse({"type": "TEXT_MESSAGE_START", "messageId": msg_id, "role": "assistant"}))
    prompt = f"用一句话向客服主管汇报这条退款申请,不要加多余的话:{json.dumps(res.structured_content, ensure_ascii=False)}"
    for piece in llm.stream([{"role": "user", "content": prompt}]):
        out.append(sse({"type": "TEXT_MESSAGE_CONTENT", "messageId": msg_id, "delta": piece}))
    out.append(sse({"type": "TEXT_MESSAGE_END", "messageId": msg_id}))
    out.append(sse({"type": "RUN_FINISHED", "threadId": thread, "runId": run_id}))
    print(llm.ledger)
    return iter(out)


if __name__ == "__main__":
    events = asyncio.run(run())
    for line in events:
        print(line, end="")
```

<div class="line-notes">

- `"""把一次「查退款申请并用一句话汇报」的运行,按 AG-UI 的事件名吐成 SSE 文本。` 说明文字里写明用途和边界。
- `from common.llm import LLMClient` 用 Day 135 起建的 LLMClient 流式调模型。
- `def sse(event: dict[str, object]) -> str:` SSE 的一条消息就是 `data: ` 加 JSON,再加换行。
- `return f"data: {json.dumps(event, ensure_ascii=False)}\n"` `ensure_ascii=False` 让中文原样输出而不是 `\uXXXX`。
- `async def run() -> Iterator[str]:` 异步函数,因为要用异步的 MCP 客户端。
- `thread, run_id, msg_id, call_id = "t1", f"run-{uuid.uuid4().hex[:6]}", "m1", "c1"` 一行同时给四个变量赋值:线程 id、运行 id(随机取 6 位)、消息 id、工具调用 id。
- `out: list[str] = [sse({"type": "RUN_STARTED", "threadId": thread, "runId": run_id})]` 一次运行以 `RUN_STARTED` 开头。
- `out += [sse({"type": "TOOL_CALL_START", "toolCallId": call_id, "toolCallName": "review_refund_request"}),` 工具调用分三段事件:开始、参数、结束。
- `sse({"type": "TOOL_CALL_ARGS", "toolCallId": call_id, "delta": json.dumps(args)}),` 参数以 `delta` 增量的形式给出,这里一次给完。
- `async with Client(mcp) as c:` 用同一个内存客户端真的去调工具,不是编的数据。
- `out.append(sse({"type": "TOOL_CALL_RESULT", "messageId": "m0", "toolCallId": call_id, "content": json.dumps(res.structured_content, ensure_ascii=False)}))` 工具结果,`content` 是字符串,所以结构化数据要先转成 JSON 字符串。
- `out.append(sse({"type": "TEXT_MESSAGE_START", "messageId": msg_id, "role": "assistant"}))` 开始一条助手消息。
- `for piece in llm.stream([{"role": "user", "content": prompt}]):` 模型流式输出,每一小段文字对应一个事件。
- `out.append(sse({"type": "TEXT_MESSAGE_CONTENT", "messageId": msg_id, "delta": piece}))` 一段文字一条 `TEXT_MESSAGE_CONTENT`。实跑模型把一句话拆成了 30 多段,每段只有一两个字。
- `out.append(sse({"type": "RUN_FINISHED", "threadId": thread, "runId": run_id}))` 以 `RUN_FINISHED` 收尾。
- `print(llm.ledger)` 打印这一次的花费。

</div>

```bash
uv run python -m part10.genui.agui_events
```

输出(开头两行是日志,`TOOL_CALL_RESULT` 和中间大量 `TEXT_MESSAGE_CONTENT` 我截短了,`runId` 每次不同):

```text
1 次调用 | 输入 107 / 输出 35 tokens | 约 ¥0.0005
data: {"type": "RUN_STARTED", "threadId": "t1", "runId": "run-dda026"}
data: {"type": "TOOL_CALL_START", "toolCallId": "c1", "toolCallName": "review_refund_request"}
data: {"type": "TOOL_CALL_ARGS", "toolCallId": "c1", "delta": "{\"refund_request_id\": 1}"}
data: {"type": "TOOL_CALL_END", "toolCallId": "c1"}
data: {"type": "TOOL_CALL_RESULT", "messageId": "m0", "toolCallId": "c1", "content": "{\"refund_request_id\": 1, ...
data: {"type": "TEXT_MESSAGE_START", "messageId": "m1", "role": "assistant"}
data: {"type": "TEXT_MESSAGE_CONTENT", "messageId": "m1", "delta": "退款"}
data: {"type": "TEXT_MESSAGE_CONTENT", "messageId": "m1", "delta": "申请"}
...
data: {"type": "TEXT_MESSAGE_END", "messageId": "m1"}
data: {"type": "RUN_FINISHED", "threadId": "t1", "runId": "run-dda026"}
```

前端只要能解析这些事件,就能边收边显示文字、边显示「正在调用 review_refund_request」。你前面做流式输出时自己写过的那套 SSE 事件,AG-UI 就是它的标准化版本。(对照的是官方文档的事件名,我没有跑官方 SDK。)

## 其余练习

**练习 1:把服务端行为写成 pytest。** 把今天手点的几件事固定成测试,以后改代码不怕改坏:98 元能批、980 元批准被拒、980 元可以驳回、传非法决定被拒。测试要用一份副本库,不碰原库。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/genui/test_refund_app.py
import asyncio
import shutil
import sqlite3
from pathlib import Path

import pytest
from mcp import Client
from mcp.types import TextContent

from part10.genui import refund_app

SRC = Path(__file__).resolve().parents[2] / "cloudledger/cloudledger.db"


@pytest.fixture
def db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "cl.db"
    shutil.copy(SRC, path)
    with sqlite3.connect(path) as conn:
        conn.execute("DELETE FROM refund_requests")
        conn.execute("DELETE FROM sqlite_sequence WHERE name = 'refund_requests'")
        conn.execute("INSERT INTO refund_requests (invoice_id, amount_cents, reason, status, created_at) VALUES ('INV-2026-0002', 9800, 'a', 'pending_approval', 'x')")
        conn.execute("INSERT INTO refund_requests (invoice_id, amount_cents, reason, status, created_at) VALUES ('INV-2026-0002', 98000, 'b', 'pending_approval', 'x')")
    monkeypatch.setattr(refund_app, "DB_PATH", path)
    return path


async def call(name: str, args: dict[str, object]) -> tuple[bool, str]:
    async with Client(refund_app.mcp) as c:
        r = await c.call_tool(name, args)
    first = r.content[0]
    assert isinstance(first, TextContent)
    return bool(r.is_error), first.text


def status(db: Path, rid: int) -> str:
    with sqlite3.connect(db) as conn:
        return conn.execute("SELECT status FROM refund_requests WHERE id = ?", (rid,)).fetchone()[0]


def test_small_refund_can_be_approved(db: Path):
    err, _ = asyncio.run(call("decide_refund_request", {"refund_request_id": 1, "decision": "approved"}))
    assert not err and status(db, 1) == "approved"


def test_big_refund_is_refused_by_server(db: Path):
    err, text = asyncio.run(call("decide_refund_request", {"refund_request_id": 2, "decision": "approved"}))
    assert err and "二级审批" in text
    assert status(db, 2) == "pending_approval"


def test_big_refund_can_still_be_rejected(db: Path):
    err, _ = asyncio.run(call("decide_refund_request", {"refund_request_id": 2, "decision": "rejected"}))
    assert not err and status(db, 2) == "rejected"


def test_unknown_decision_is_refused(db: Path):
    err, _ = asyncio.run(call("decide_refund_request", {"refund_request_id": 1, "decision": "paid"}))
    assert err and status(db, 1) == "pending_approval"
```

<div class="line-notes">

- `import pytest` 测试框架本身。
- `from part10.genui import refund_app` 导入模块对象(而不是里面的名字),因为后面要替换它里面的 `DB_PATH`。
- `SRC = Path(__file__).resolve().parents[2] / "cloudledger/cloudledger.db"` 原库,只读,测试里复制一份用。
- `@pytest.fixture` 一个装饰器(前面学过装饰器):把下面的函数变成「测试夹具」,测试函数把它的名字写成参数,pytest 就自动先执行它并把返回值传进去。相当于 jest 的 `beforeEach`,但能把东西传给测试。
- `def db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:` `tmp_path` 和 `monkeypatch` 是 pytest 自带的夹具:前者给一个每条测试独占的临时目录,后者能临时替换某个对象的属性,测试结束自动还原。
- `shutil.copy(SRC, path)` 复制假数据库到临时目录,所有写入都发生在副本里。
- `conn.execute("DELETE FROM sqlite_sequence WHERE name = 'refund_requests'")` 把自增计数器也清掉,这样每条测试里新造的申请编号都从 1 开始。
- `monkeypatch.setattr(refund_app, "DB_PATH", path)` 把服务端模块里的 `DB_PATH` 换成副本路径。这能生效,是因为 `db()` 函数每次调用时才去读模块级的 `DB_PATH`。
- `async def call(name: str, args: dict[str, object]) -> tuple[bool, str]:` 一个小帮手:调工具,返回「是否出错、第一段文字」。
- `assert isinstance(first, TextContent)` 收窄类型,同上面 `probe.py`。
- `def test_small_refund_can_be_approved(db: Path):` 参数名 `db` 和夹具同名,pytest 自动注入。
- `err, _ = asyncio.run(call("decide_refund_request", {"refund_request_id": 1, "decision": "approved"}))` 测试函数本身是同步的,用 `asyncio.run` 跑异步调用,省得再装 pytest 的异步插件。
- `assert not err and status(db, 1) == "approved"` 不出错,而且库里真的变了。**只断言返回值不够,要查库**。
- `assert err and "二级审批" in text` 980 元批准被拒,并且提示里带「二级审批」。
- `assert status(db, 2) == "pending_approval"` 被拒之后库里状态没变,这是最要紧的一条。
- `def test_big_refund_can_still_be_rejected(db: Path):` 驳回大额不受上限限制。
- `"decision": "paid"` 一个不在 `Literal` 里的值,参数校验应该直接拦下。

</div>

```bash
uv run pytest part10/genui -q
```

```text
4 passed in 1.13s
```

</details>

**练习 2:写一个 HTML 外部域名检查脚本。** 扫一份 MCP App 的 HTML 里引用了哪些外部域名,和服务端声明的 `CSP_DOMAINS` 对比,报告「没声明就用」(会被 CSP 拦)和「声明了却没用」(白开的口子)。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/genui/lint_app_html.py
"""练习 2:扫一份 MCP App 的 HTML 里引用了哪些外部域名,和服务端声明的 CSP 白名单对比。"""
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

from part10.genui.refund_app import CSP_DOMAINS


def external_origins(html: str) -> set[str]:
    urls = re.findall(r"""(?:src|href|from|import\s*\(?)\s*=?\s*["'](https?://[^"']+)["']""", html)
    return {f"{urlparse(u).scheme}://{urlparse(u).netloc}" for u in urls}


if __name__ == "__main__":
    html = Path(sys.argv[1]).read_text(encoding="utf-8")
    declared = set(CSP_DOMAINS)
    used = external_origins(html)
    print("HTML 用到:", sorted(used))
    print("声明了:  ", sorted(declared))
    missing = used - declared
    extra = declared - used
    print("没声明就用(会被 CSP 拦):", sorted(missing) or "无")
    print("声明了却没用(多开的口子):", sorted(extra) or "无")
```

<div class="line-notes">

- `from urllib.parse import urlparse` 标准库的 URL 解析,把 `https://cdn.jsdelivr.net/npm/...` 拆成协议、域名、路径。
- `from part10.genui.refund_app import CSP_DOMAINS` 这就是上面第 2 步把它拎成常量的原因:检查脚本和服务端读同一份声明。
- `def external_origins(html: str) -> set[str]:` 返回 HTML 里用到的所有外部「来源」(协议加域名)。
- `urls = re.findall(r"""(?:src|href|from|import\s*\(?)\s*=?\s*["'](https?://[^"']+)["']""", html)` 一个正则:找 `src=`、`href=`、`from `、`import ` 后面跟着的 `http(s)://` 开头的引号字符串。三重引号字符串让里面可以直接放单引号和双引号。这个正则不完美,抓不到动态拼出来的地址,是一个够用的粗检查。
- `return {f"{urlparse(u).scheme}://{urlparse(u).netloc}" for u in urls}` 集合推导式,把每个地址缩成「来源」并自动去重。
- `html = Path(sys.argv[1]).read_text(encoding="utf-8")` 命令行第一个参数是要检查的文件。
- `missing = used - declared` 集合相减:用到了但没声明。
- `extra = declared - used` 声明了但没用到。
- `print("没声明就用(会被 CSP 拦):", sorted(missing) or "无")` `sorted(...) or "无"`:空列表在 Python 里是假值,所以会打印「无」。

</div>

```bash
uv run python -m part10.genui.lint_app_html part10/genui/refund_review.html
```

```text
HTML 用到: ['https://cdn.jsdelivr.net']
声明了:   ['https://cdn.jsdelivr.net']
没声明就用(会被 CSP 拦): 无
声明了却没用(多开的口子): 无
```

再造一份被动过手脚的 HTML(在原文件末尾塞一个外站图片,图片地址是 `.example.net` 的假域名),看它能不能抓出来:

```bash
sed 's#</body>#<img src="https://tracker.example.net/p.gif"></body>#' part10/genui/refund_review.html > /tmp/bad.html
uv run python -m part10.genui.lint_app_html /tmp/bad.html
```

```text
HTML 用到: ['https://cdn.jsdelivr.net', 'https://tracker.example.net']
声明了:   ['https://cdn.jsdelivr.net']
没声明就用(会被 CSP 拦): ['https://tracker.example.net']
声明了却没用(多开的口子): 无
```

这个检查适合放进 CI:每次改了界面,自动对一遍域名。

</details>

**练习 3(不写代码):选路线。** 对下面三个需求,各选 MCP Apps、A2UI、AG-UI 中的一条或组合,写两句理由:(a)给 Claude 和 ChatGPT 都能用的「发票对比」工具,要交互式表格;(b)自家 SaaS 的客服工作台,Agent 要在对话里弹出「确认退款」小卡片,卡片样式必须和产品设计系统一致,以后还要出手机端;(c)用 LangGraph 写的后端,想在自家 React 前端里流式显示 token 和工具调用进度。

<details><summary>参考答案</summary>

(a) MCP Apps。目标是通用 host,MCP Apps 是主流 host 支持最广的;交互式表格表达力要求高,一个 HTML 页面比组件目录好办。沙箱和 CSP 由 host 兜。

(b) A2UI。前端和设计系统在自己手里,卡片用自己的组件渲染才能保证一致;以后上手机端,声明式 JSON 可以由不同平台的渲染器各自画。「确认退款」只要几个标准组件,目录够用。点击事件发回后端,金额仍然按编号重新查库。

(c) AG-UI。这是「传事件」的需求,不是「画界面」的需求:后端框架把 token、工具调用开始和结束这些事件推给前端。以后如果要在对话里嵌复杂界面,再在 AG-UI 之上叠 A2UI 或 MCP Apps。

三个答案里没有一个是「只选一个就够」的绝对结论,第 (b) 题如果团队愿意维护一个 iframe 沙箱,MCP Apps 也能做;我选 A2UI 是因为设计系统一致和多端这两个条件。

</details>

**验收标准:**

1. `probe.py` 输出两个工具、正确的 MIME、批准成功、重复驳回被拒、大额批准被拒。
2. 在 basic-host 里看到审批卡片,点批准后库里状态变成 approved,Model Context 面板有那句话。
3. 能说清楚为什么 `decide_refund_request` 在 basic-host 下拉框里看不到,却在 `probe.py` 里看得到,并且能说出服务端为什么必须自己拦大额。
4. 做完实验二,能解释那条 CSP 报错。
5. `uv run pytest part10/genui -q` 全绿。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 生成式 UI | 让 Agent 在对话中按需拿出界面,用户操作后结果回到 Agent |
| MCP Apps | MCP 的官方扩展:工具声明一个 `ui://` 界面,host 在沙箱 iframe 里渲染 |
| A2UI | Google 开源的声明式界面格式:Agent 发 JSON 描述界面,客户端用自己的组件渲染 |
| AG-UI | Agent 和前端之间的事件协议,承载文本流、工具调用、状态同步 |
| `ui://` 资源 | MCP server 上以 `ui://` 开头的资源,内容是界面的 HTML |
| MIME 类型 | 告诉接收方「这份内容是什么格式」的标签;界面资源必须是 `text/html;profile=mcp-app` |
| 沙箱 iframe | 带限制的 iframe,里面的页面碰不到外层页面的 DOM、cookie、存储 |
| CSP(内容安全策略) | 浏览器的机制,规定页面能从哪些域名加载脚本、图片、发请求,没声明的一律不让 |
| 工具可见性(visibility) | 标 `["app"]` 的工具只给界面调用,host 不应把它给模型 |
| CORS | 浏览器对跨域请求的限制,服务端要用响应头明确允许哪些来源 |
| 声明式 UI | 只描述「界面是什么」(数据),不含可执行代码,由客户端按白名单渲染 |
| 幂等 | 同一个操作重复做多次,效果和做一次一样 |

## 常见误区

**以为三条路线三选一。** AG-UI 是线,MCP Apps 和 A2UI 是线上跑的界面内容,常常组合用。

**以为可见性标记就是权限控制。** `visibility: ["app"]` 是 host 去执行的约定,不守规矩的 client 能直接调。授权必须在服务端做,今天的 980 元那一次就是例子。

**写库工具接收界面传回来的金额。** 用户看到「批准 98 元」,界面传回的却可以是任意数字。写库的工具只收编号和决定,金额按编号重新查库。

**用 `innerHTML` 往卡片里塞来自数据库的文字。** 退款原因这类字段可能来自客户输入。用 `textContent`。

**CSP 声明写得太宽。** 为了省事把一堆域名都加进 `resourceDomains`,等于白开口子。声明了却没用到的域名,练习 2 的检查脚本能抓出来。

**忽略界面也是注入通道。** 界面能写模型上下文、能给对话发消息。接第三方 MCP App 之前要审它。

**把测试 host 暴露到公网试。** 今天所有服务都只绑 127.0.0.1,假数据也不连任何真实系统;要接进真实 host 时,先想清楚暴露的是什么。

## 学习资料

### 文档与文章

- [MCP Apps 发布博客](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/):为什么做、支持哪些 host、安全模型,15 分钟。
- [Build an MCP App](https://modelcontextprotocol.io/extensions/apps/build):官方 TypeScript 教程,和今天的 Python 写法对照着看,30 分钟。
- [MCP Apps 规范(2026-01-26)](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx):重点读资源格式、工具可见性、沙箱代理那几节,今天代码里每个约定都能在这里找到出处,1 小时。
- [MCP 2026-07-28 规范发布说明](https://blog.modelcontextprotocol.io/posts/2026-07-28/):看扩展机制那部分,理解 MCP Apps 在新规范里的位置,15 分钟。
- [MCP Apps compatibility in ChatGPT](https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt):OpenAI 怎么看 MCP Apps 和自家 Apps SDK 的关系,15 分钟。
- [A2UI 仓库](https://github.com/google/A2UI)和它的 [v0.9 规范页](https://a2ui.org/specification/v0.9-a2ui/):先读 README 的设计理念,再读规范页里四种消息和基础组件目录,1 小时。
- [A2UI v0.9 发布博客](https://developers.googleblog.com/a2ui-v0-9-generative-ui/):Google 开发者博客,讲 v0.9 改了什么,15 分钟。
- [AG-UI 介绍](https://docs.ag-ui.com/introduction)和[事件文档](https://docs.ag-ui.com/concepts/events):看三层协议的位置和事件清单,对照第 7 步的输出,30 分钟。
- [MDN:Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)和 [MDN:iframe](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe):前端出身可以快速过一遍 `sandbox` 属性和 CSP 指令,和今天的实验对照。

### B 站视频

已在正文嵌入捣鼓键盘的小麦《一次性搞懂 Gen UI、A2UI 和 AG-UI》。再加一个:

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1sVqpBYEZm&autoplay=0&high_quality=1" title="MCP Apps，MCP 服务器提供交互式的用户界面" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>成富_Alex · MCP Apps,MCP 服务器提供交互式的用户界面 · 看工具、资源和界面三者怎么连起来。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Wiun7ZGu-Ks" title="What are MCP Apps? Building Apps that Run on Claude &amp; ChatGPT" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AWS Developers · What are MCP Apps? Building Apps that Run on Claude &amp; ChatGPT · 一个 App 同时跑在 Claude 和 ChatGPT 里的演示。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Z4aSGCs_O5A" title="Generative UI: Specs, Patterns, and the Protocols Behind Them" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>CopilotKit · Generative UI: Specs, Patterns, and the Protocols Behind Them (MCP Apps, A2UI, AG-UI) · AG-UI 发起方讲三者怎么组合。</figcaption>
</figure>

### 书籍

- Louise Macfadyen《Designing AI Interfaces》(O'Reilly, 2026):讲 AI 交互的设计模式,包括可中断性、自主与控制的平衡。O'Reilly 页面写 2026 年 3 月出版,别的书店写 5 月,出版社站点对脚本访问有限制,我只看到简介,没读正文。英文原版。
- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 10 章后半部分讲用户反馈。审批卡片上的「批准、驳回、备注」本身就是很好的反馈数据。英文原版。

### 开源项目与代码

- [modelcontextprotocol/ext-apps](https://github.com/modelcontextprotocol/ext-apps):官方 SDK 和示例,`examples/basic-host` 是今天用的测试 host,`examples` 下还有 React、Vue 等起步模板。
- [google/A2UI](https://github.com/google/A2UI):看 `samples` 里的示例 Agent 和各个渲染器。
- [ag-ui-protocol/ag-ui](https://github.com/ag-ui-protocol/ag-ui):看事件清单,对照第 7 步。

## 自测

**1. MCP Apps、A2UI、AG-UI 各管哪一层?**

<details><summary>答案</summary>

MCP Apps:工具声明一个 server 写好的 HTML 界面,host 放进沙箱 iframe 渲染。A2UI:Agent 发声明式 JSON 描述界面,客户端用自己的组件目录渲染。AG-UI:Agent 后端和前端之间的事件传输(文本流、工具调用、状态)。前两个是「界面内容」,第三个是「传输线」,可以组合。

</details>

**2. MCP Apps 的 `decide_refund_request` 标了 `visibility: ["app"]`,为什么服务端还要拦大额?**

<details><summary>答案</summary>

可见性是 host 来执行的约定,server 不会替你藏,不守规矩的 client 可以直接调这个工具(`probe.py` 里就看得到它)。授权必须在服务端自己做,所以 980 元的批准被服务端直接拒绝,不管调用者是谁。

</details>

**3. 删掉 `csp` 声明之后,卡片为什么一直停在「等待工具结果...」?**

<details><summary>答案</summary>

界面要从 jsDelivr 加载 `App` 类的脚本。没声明时沙箱用默认的严格 CSP(`script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data:`),外部域名的脚本被浏览器拦下,`App` 没加载出来,就收不到工具结果,界面停在初始状态。

</details>

**4. 为什么写库的工具不接收金额参数?**

<details><summary>答案</summary>

用户在界面上看到的数据和界面传回来的数据是两回事,界面可以被篡改。写库工具只收编号和决定,金额由服务端按编号重新查库,这样用户批准的就是库里真实的那一笔。A2UI 迷你渲染器里的 `on_action` 也是同样的原则。

</details>

**5. 声明式的 A2UI 为什么比 MCP Apps 更好审?代价是什么?**

<details><summary>答案</summary>

A2UI 的消息只是数据,客户端只渲染白名单里的组件,拒绝未知组件和环状结构,没有代码被执行。MCP Apps 的界面是可执行的 HTML 和 JavaScript,只能靠沙箱、CSP 隔离。代价是 A2UI 的表达力受限于组件目录,图表、地图这类复杂界面要么注册自定义组件,要么用 MCP Apps。

</details>

**6. 面试题:产品要在对话里让用户确认一笔退款。你会用什么方案?安全上要注意什么?**

<details><summary>答案</summary>

先看约束:如果要在 Claude、ChatGPT 这类通用 host 里用,选 MCP Apps;如果自己控制前端、要和设计系统一致并且上多端,选 A2UI,事件传输可以用 AG-UI。安全上分三层:沙箱 iframe 和 CSP 隔离第三方代码;写库的工具用 `visibility: ["app"]` 对模型隐藏;最关键的是服务端授权:审批人身份从登录令牌取,大额(比如超过 500 元)服务端直接拒绝需要二级审批,写库工具只收编号和决定、金额按编号重新查库,重复提交要幂等。再提醒界面是注入通道,接第三方界面要审;往卡片里放文字用 `textContent`;所有这些规则写成测试(比如 980 元批准被拒、库里状态不变),并且记录谁在什么时候批了什么。

</details>

## 明天预告

[Day 622](/blog/agent-zero/day-622-week89-review/) 是第 89 周的复习日:把 Day 616 到 621(A2A、Agent 支付、Agent 产品、生成式 UI)串成一张知识地图,汇总本周的错题和坑,并默写一段本周的核心代码。今天的撤销窗口、放权梯子和 MCP App 里,哪些写法最值得默写,明天一起挑。
