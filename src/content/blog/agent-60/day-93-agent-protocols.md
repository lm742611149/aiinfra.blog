---
title: 'Day 93 · Agent 互联:A2A、MCP 与 Agent 间协作的协议之争'
description: '你的研究员如果是别的团队、别的公司做的 Agent,怎么发现它、调用它、信任它?今天读 A2A 1.0 规范:Agent Card、任务状态机、三种传输绑定、版本协商和鉴权;理清它和 MCP、ACP 的分工;再手写一个最小的 A2A 服务端,把 SupportPilot 包成一个能被别的 Agent 调用的 Agent,并聊聊哪些会成为标准。'
pubDate: 2026-10-12
regime: none
tags: ['a2a', 'mcp', 'protocol', 'interoperability', 'agent-card', 'auth', 'agent-60']
series: 'agent-60'
day: 93
lang: 'zh'
---

## 今天要解决的问题

到目前为止,你写的多 Agent 系统里,每个 Agent 都是你自己的代码,跑在同一个进程或者同一个集群里,互相调用就是函数调用。现实中的情况会越来越多地变成这样:财务团队有一个对账 Agent,法务团队有一个合同审查 Agent,供应商提供了一个物流查询 Agent。你的 SupportPilot 要处理一个「发票金额不对、要求按合同赔偿」的工单,得请这几个 Agent 帮忙。它们用不同框架写的,部署在不同地方,你看不到它们的提示词和工具。

这时候问题就从「怎么编排」变成了「怎么互联」:怎么知道有哪些 Agent、各自能干什么,怎么给它派一个可能要跑十分钟的任务,它中途需要补充信息时怎么问回来,凭什么相信它,它返回的东西能不能信。A2A(Agent2Agent)协议就是为回答这些问题设计的。

学完今天你应该能:

1. 说清 MCP、A2A、ACP 三个协议分别解决哪一层的问题,什么时候该用哪个。
2. 读懂 A2A 1.0 的核心对象:Agent Card、Task、Message、Artifact、Part,以及任务的状态机。
3. 知道 A2A 的三种传输绑定、版本协商和鉴权方式,能读规范、能发现规范里的小矛盾。
4. 手写一个最小的 A2A 服务端和客户端,跑通多轮交互、终态拒绝、版本和鉴权检查。
5. 对「哪些协议会成为标准」形成自己的判断,并能在技术选型里讲清楚。

预计用时 4 小时。前置:Day 22、23(MCP)、Day 26(多 Agent)、Day 84(MCP 网关与鉴权)。

## 三层协议,各管一段

先把几个经常被混在一起的协议放在一张图里:

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="MCP、A2A、ACP 分别连接的对象">
  <rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)"/>
  <rect x="230" y="96" width="180" height="70" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="320" y="124" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">你的 Agent</text>
  <text x="320" y="144" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">SupportPilot</text>
  <rect x="20" y="20" width="150" height="50" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="95" y="42" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">编辑器 / 控制台</text>
  <text x="95" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">Zed、Agent Canvas</text>
  <line x1="170" y1="52" x2="240" y2="100" stroke="var(--rule)"/>
  <text x="150" y="98" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">ACP</text>
  <rect x="20" y="196" width="170" height="54" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="105" y="218" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">工具和数据</text>
  <text x="105" y="236" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">账单库、知识库、工单系统</text>
  <line x1="190" y1="220" x2="250" y2="166" stroke="var(--rule)"/>
  <text x="168" y="186" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">MCP</text>
  <rect x="460" y="20" width="160" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="540" y="42" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">财务对账 Agent</text>
  <text x="540" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">别的团队</text>
  <rect x="460" y="196" width="160" height="54" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="540" y="218" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">物流查询 Agent</text>
  <text x="540" y="236" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">别的公司</text>
  <line x1="410" y1="110" x2="470" y2="70" stroke="var(--rule)"/>
  <line x1="410" y1="152" x2="470" y2="200" stroke="var(--rule)"/>
  <text x="440" y="100" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">A2A</text>
  <text x="440" y="176" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">A2A</text>
</svg>
<figcaption>MCP 连工具和数据,A2A 连别的 Agent,ACP 连人用的编辑器或控制台。三者不是竞争关系,一个 Agent 可以同时说这三种「语言」。</figcaption>
</figure>

**MCP** 管的是 Agent 和工具、数据之间的连接。工具是透明的:你知道它的参数、能预期它的行为,调用一次通常很快就返回。Day 22、23 已经讲透了。MCP 规范在持续更新,写这篇时官网上最新的版本是 2026-07-28。

**A2A** 管的是 Agent 和 Agent 之间。关键区别是对方是不透明的(opaque):你看不到它内部用什么模型、什么工具、什么提示词,只知道它声明的能力。任务可能要跑很久,中途可能需要你补充信息,产出可能是文件、结构化数据。规范在「1.2 指导原则」里专门列了一条「Opaque Execution」:Agent 之间基于声明的能力和交换的信息协作,不需要共享内部的思考、计划和工具实现。

**ACP**(Agent Client Protocol)是另一回事,管的是编辑器或控制台这类「人用的客户端」和 Coding Agent 之间的连接。Day 89 提过,OpenHands 的 Agent Canvas 就是通过 ACP 去跑 Claude Code、Codex 这些第三方 Agent 的。注意别和 IBM 早年的 Agent Communication Protocol 混淆,那个也简称 ACP,已经在 2025 年 8 月并入了 A2A。

一个简单的判断方法:对方是「能力确定的函数」,用 MCP;对方是「有自己判断力、可能要和你来回商量的同事」,用 A2A。

## A2A 走到了哪一步

时间线大致是:Google 在 2025 年 4 月发布 A2A,6 月捐给 Linux 基金会,7 月发了 0.3 版。2026 年 3 月 12 日发布 1.0,这是第一个稳定版,而且相对 0.3 有不兼容的改动;5 月 28 日发了 1.0.1。2026 年 8 月,A2A 加入 Linux 基金会旗下的 Agentic AI Foundation(AAIF)。AAIF 的公告里把自己的项目按层次列了一遍:AGENTS.md 管给 Agent 的说明和约定,goose 是 Agent 运行时,MCP 管 Agent 到工具,agentgateway 管流量和策略,A2A 管 Agent 到 Agent。这张分层图和上面那张图的意思是一样的。

Python 这边,官方 SDK 是 PyPI 上的 `a2a-sdk`,写这篇时版本是 1.2.2,基于 protobuf 定义生成类型。今天的练习故意不用 SDK、手写一个最小实现,目的是看清楚线上到底传的是什么;生产项目建议用官方 SDK,省得自己处理所有边界情况。

## 读规范:五个核心对象

规范在 a2a-protocol.org,仓库里的 `docs/specification.md` 是同一份内容,`specification/a2a.proto` 是权威的数据定义。一开始读不用全读,抓住这五个对象:

**Agent Card**:Agent 的名片,一个 JSON 文档,默认放在 Agent 所在域名下的 `/.well-known/agent-card.json`。里面有名字、描述、版本、提供方,`supportedInterfaces`(在哪个 URL、用哪种传输绑定、哪个协议版本可以访问它),`capabilities`(支不支持流式、推送通知),`securitySchemes`(怎么鉴权),以及最重要的 `skills`(能干什么,每个技能带描述和示例)。另外还有需要鉴权才能拿到的「扩展名片」,可以给已认证的客户端看更多信息;1.0 还加了名片签名,用来证明这张名片确实是这个提供方发的。

**Task**:一次协作的单位,有 id、contextId(把相关的多个任务归到同一个会话里)、状态、产出和历史。

**Message**:一来一回的一条消息,role 是 `ROLE_USER` 或 `ROLE_AGENT`,内容是若干个 Part。

**Artifact**:任务的产出物,比如一份报告、一个 JSON 结果。和 Message 的区别是,Message 是沟通过程,Artifact 是交付结果。

**Part**:内容的最小单位,可以是文本、结构化数据、文件(内联或 URL)。

任务的状态机是理解 A2A 的关键:

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="A2A 任务状态机">
  <rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)"/>
  <rect x="20" y="90" width="100" height="36" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="70" y="113" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">SUBMITTED</text>
  <rect x="160" y="90" width="100" height="36" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="210" y="113" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">WORKING</text>
  <rect x="300" y="20" width="140" height="36" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="370" y="43" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">INPUT_REQUIRED</text>
  <rect x="300" y="160" width="140" height="36" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="370" y="183" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">AUTH_REQUIRED</text>
  <rect x="490" y="20" width="130" height="30" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="555" y="40" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">COMPLETED</text>
  <rect x="490" y="64" width="130" height="30" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="555" y="84" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">FAILED</text>
  <rect x="490" y="108" width="130" height="30" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="555" y="128" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">CANCELED</text>
  <rect x="490" y="152" width="130" height="30" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="555" y="172" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">REJECTED</text>
  <line x1="120" y1="108" x2="160" y2="108" stroke="var(--rule)"/>
  <line x1="260" y1="100" x2="300" y2="44" stroke="var(--rule)"/>
  <line x1="300" y1="50" x2="262" y2="96" stroke="var(--compute)" stroke-dasharray="4 3"/>
  <line x1="260" y1="118" x2="300" y2="176" stroke="var(--rule)"/>
  <line x1="260" y1="108" x2="490" y2="35" stroke="var(--rule)"/>
  <line x1="260" y1="108" x2="490" y2="79" stroke="var(--rule)"/>
  <line x1="260" y1="108" x2="490" y2="123" stroke="var(--rule)"/>
  <text x="490" y="208" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">右侧四个是终态</text>
  <text x="20" y="160" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">虚线:用户补充信息后</text>
  <text x="20" y="176" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">回到 WORKING</text>
</svg>
<figcaption>状态名在 1.0 里都带 TASK_STATE_ 前缀。终态的任务不再接受新消息,往终态任务发消息会得到 UnsupportedOperationError。</figcaption>
</figure>

`INPUT_REQUIRED` 就是「我需要你补充信息」,客户端带着同一个 taskId 再发一条消息,任务继续。`AUTH_REQUIRED` 是任务进行中发现需要额外授权(比如要代表用户访问他的邮箱),规范第 7.6 节专门讲了这种任务内授权。右边四个是终态:完成、失败、取消、被拒绝。

## 三种传输绑定和版本协商

同一套语义,A2A 1.0 定义了三种传输绑定:JSON-RPC、gRPC、HTTP+JSON(REST 风格)。规范第 5.3 节有一张方法对照表,比如「发消息」在 JSON-RPC 里叫 `SendMessage`,在 REST 里是 `POST /message:send`;「查任务」是 `GetTask` 和 `GET /tasks/{id}`。Agent 在名片的 `supportedInterfaces` 里声明自己支持哪些,客户端挑一个自己也支持的。

版本协商靠一个请求头:客户端每次请求都带 `A2A-Version: 1.0`(只写主次版本号,不写补丁号)。服务端不支持这个版本就返回 VersionNotSupportedError。有个细节很容易忽略:**没带这个头,服务端要按 0.3 处理**。这是为了兼容老客户端,但也意味着你的新客户端忘了带头,就会莫名其妙地被当成老版本。

错误怎么表示,每种绑定各有规定。HTTP+JSON 绑定用 google.rpc.Status 的 JSON 格式,`details` 里必须放一个 ErrorInfo,`reason` 字段写错误类型(比如 `TASK_NOT_FOUND`),`domain` 写 `a2a-protocol.org`。因为好几种错误都映射到 HTTP 400,只看状态码分不清,必须看 reason。

读规范时我发现了一个小矛盾:第 6.4 节「版本协商错误」的示例响应用的是 `application/problem+json` 格式,而第 11.6 节规定 HTTP 错误用 google.rpc.Status 格式。遇到这种情况,以规定性的章节(11.6 节)为准,示例只是示例。把这类发现提给规范仓库,也是 Day 109 讲的「开源影响力」的一种很好的起点。

## 身份、授权和信任

跨团队、跨公司调用 Agent,难的不是协议,是信任。

**鉴权**:Agent Card 的 `securitySchemes` 支持 API Key、HTTP(Bearer 等)、OAuth 2.0、OpenID Connect、双向 TLS。凭证不在 A2A 消息里传,而是走 HTTP 层,和普通 API 一样。生产环境里,公司内部用 OAuth 2.0 的 client credentials 或者服务网格的 mTLS,跨公司用 OAuth 2.0 加签名名片。

**代表谁在调用**:这是最容易出事的地方。SupportPilot 代表某个客户去调用财务 Agent 查账,财务 Agent 看到的身份是「SupportPilot 服务」还是「这个客户」?如果是前者,财务 Agent 就有可能把别的客户的数据返回给 SupportPilot,这就是经典的「困惑的代理人」(confused deputy)问题。设计时要把最终用户的身份和权限范围一起传下去,由被调用方按用户维度做授权,而不是信任调用方说什么就做什么。Day 84 讲 MCP 网关鉴权时是同一个问题。

**对方的输出能不能信**:另一个 Agent 返回的文本和 Artifact,对你来说就是不可信的外部内容,和网页一样可能带注入。不要把它直接拼进你的系统提示词,不要让它触发你这边的写操作。结构化的 data part 比自由文本更安全,能用就用,并且在你这边做校验。

**商务和责任**:跨公司调用还牵涉 SLA、计费、数据处理协议、出错时谁负责。这些不在协议里,但会决定一个跨公司的 Agent 协作能不能真的上线。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1XFhPzoEBx&autoplay=0&high_quality=1" title="Function Calling、MCP和A2A的核心原理与区别" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>技术蛋老师 · Function Calling、MCP和A2A的核心原理与区别 · 22 分钟,动画讲三者的关系,适合快速建立整体图景;注意视频录于 1.0 发布之前,具体字段以规范为准。</figcaption>
</figure>

## 哪些会成为标准

这部分是我的判断,不是事实,你可以不同意,但面试时要能讲出自己的判断和依据。

**MCP 在工具层已经赢了。** 主流模型厂商、IDE、框架都支持,企业内部的工具接入基本默认用它。剩下的问题是治理(远程 MCP 的鉴权、工具注册、审计),这是 Day 84 的内容。

**A2A 有了标准的形态,但用法还在早期。** 有中立治理、有 1.0 稳定版、有主要云厂商和企业软件厂商参与,这些都是成为标准的必要条件。但真实的用法里,大量「多 Agent」需求在同一个团队、同一个进程里就能解决,用子 Agent 或者工作流比跨网络调用简单得多。我看到的 A2A 落地,主要在两种场景:大企业里跨部门的 Agent 平台(各团队把 Agent 注册到同一个目录里),以及 SaaS 厂商把自己的 Agent 能力开放给客户的 Agent 调用。

**我的建议**:公司内部同一个团队的 Agent 之间,用函数调用、子 Agent 或者内部 API,别为了用协议而用协议;跨团队、需要长时间任务和多轮交互、调用方和被调用方独立演进时,用 A2A;把你的 Agent 开放给外部时,同时提供 MCP(把它当工具用)和 A2A(把它当 Agent 用)两种接口,让调用方选。另外留意 Agent 目录和注册中心的发展,发现机制目前还是协议里最不成熟的部分。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Fbr_Solax1w" title="Introduction to Agent2Agent (A2A) Protocol" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Google Cloud Tech · Introduction to Agent2Agent (A2A) Protocol · 8 分钟,官方介绍 Agent Card、任务和多轮交互的基本概念。</figcaption>
</figure>

## 动手练习

**目标**:手写一个最小的 A2A 1.0 服务端(HTTP+JSON 绑定),把 SupportPilot 包成可被调用的 Agent;写一个客户端,跑通发现、多轮交互、终态拒绝、版本协商和鉴权。

**第 1 步:装依赖。**

```bash
mkdir -p agentops/a2a && cd agentops/a2a
uv init --python 3.12
uv add fastapi uvicorn httpx && uv add --dev pytest
```

**第 2 步:写服务端。** `handle()` 是 SupportPilot 的替身:没给发票号就进入 INPUT_REQUIRED 要信息,给了就完成并返回一个结构化的 Artifact。

```python
# agentops/a2a/a2a_server.py
"""把 SupportPilot 包成一个 A2A 1.0 Agent(HTTP+JSON 绑定的最小子集)。
实现了:Agent Card 发现、SendMessage、GetTask、多轮(INPUT_REQUIRED)、版本协商、Bearer 鉴权、标准错误格式。
没实现:流式、推送通知、取消、Agent Card 签名。生产里建议直接用官方 SDK(a2a-sdk),这里手写是为了看清协议。"""
from __future__ import annotations

import re
import uuid

from fastapi import FastAPI, Header, Request
from fastapi.responses import JSONResponse

BASE = "/a2a/v1"
SUPPORTED = {"1.0"}
TOKENS = {"demo-token": "partner-billing-agent"}          # 生产里换成 OAuth 2.0 / OIDC
TERMINAL = {"TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_REJECTED"}
CT = "application/a2a+json"

app = FastAPI()
TASKS: dict[str, dict] = {}

CARD = {
    "name": "CloudLedger SupportPilot",
    "description": "CloudLedger 的客服工单 Agent:查询账单、解释退款政策、为重复扣款发起退款申请(需人工审批)。",
    "supportedInterfaces": [
        {"url": f"http://localhost:8000{BASE}", "protocolBinding": "HTTP+JSON", "protocolVersion": "1.0"}
    ],
    "provider": {"organization": "CloudLedger", "url": "https://cloudledger.example"},
    "version": "0.3.0",
    "capabilities": {"streaming": False, "pushNotifications": False, "extendedAgentCard": False},
    "securitySchemes": {"bearer": {"httpAuthSecurityScheme": {"scheme": "Bearer"}}},
    "securityRequirements": [{"schemes": {"bearer": {"list": []}}}],
    "defaultInputModes": ["text/plain"],
    "defaultOutputModes": ["text/plain", "application/json"],
    "skills": [
        {
            "id": "refund-request",
            "name": "退款申请",
            "description": "根据订单号核实是否重复扣款,符合政策的提交退款申请,返回申请编号。",
            "tags": ["billing", "refund"],
            "examples": ["订单 INV-2291 被扣了两次,帮我退一笔"],
        }
    ],
}


def error(http: int, status: str, reason: str, message: str, **meta) -> JSONResponse:
    """HTTP+JSON 绑定的错误格式:google.rpc.Status,details 里放 ErrorInfo。"""
    body = {"error": {"code": http, "status": status, "message": message, "details": [{
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        "reason": reason, "domain": "a2a-protocol.org", "metadata": meta,
    }]}}
    return JSONResponse(body, status_code=http, media_type=CT)


def check(version: str | None, auth: str | None) -> JSONResponse | None:
    if (version or "0.3") not in SUPPORTED:      # 规范:没带版本头按 0.3 处理
        return error(400, "FAILED_PRECONDITION", "VERSION_NOT_SUPPORTED",
                     f"A2A version {version or '(empty, treated as 0.3)'} is not supported", supported="1.0")
    token = (auth or "").removeprefix("Bearer ").strip()
    if token not in TOKENS:
        return JSONResponse({"error": {"code": 401, "status": "UNAUTHENTICATED", "message": "missing or invalid token"}},
                            status_code=401, media_type=CT)
    return None


def text_of(message: dict) -> str:
    return " ".join(p.get("text", "") for p in message.get("parts", []))


def agent_msg(text: str, task: dict) -> dict:
    return {"role": "ROLE_AGENT", "messageId": str(uuid.uuid4()), "taskId": task["id"],
            "contextId": task["contextId"], "parts": [{"text": text}]}


def handle(task: dict, user_text: str) -> None:
    """SupportPilot 的替身:真实系统里这里调用 Day 47 的 LangGraph 工作流。"""
    order = re.search(r"INV-\d+", user_text)
    if not order:
        task["status"] = {"state": "TASK_STATE_INPUT_REQUIRED",
                          "message": agent_msg("请提供被重复扣款的发票号(形如 INV-1234)。", task)}
        return
    task["status"] = {"state": "TASK_STATE_COMPLETED"}
    task["artifacts"] = [{
        "artifactId": str(uuid.uuid4()), "name": "退款申请回执",
        "parts": [{"data": {"invoice": order.group(0), "refundRequestId": "RF-" + uuid.uuid4().hex[:8],
                            "state": "pending_supervisor_approval"}}],
    }]


@app.get("/.well-known/agent-card.json")
def agent_card():
    return JSONResponse(CARD, media_type=CT)


@app.post(BASE + "/message:send")
async def send_message(request: Request, a2a_version: str | None = Header(None),
                       authorization: str | None = Header(None)):
    if (bad := check(a2a_version, authorization)) is not None:
        return bad
    msg = (await request.json()).get("message", {})
    if not msg.get("parts"):
        return error(400, "INVALID_ARGUMENT", "INVALID_ARGUMENT", "message.parts is required")
    task_id = msg.get("taskId")
    if task_id:                                          # 多轮:继续已有任务
        task = TASKS.get(task_id)
        if task is None:
            return error(404, "NOT_FOUND", "TASK_NOT_FOUND", "task not found", taskId=task_id)
        if task["status"]["state"] in TERMINAL:
            return error(400, "FAILED_PRECONDITION", "UNSUPPORTED_OPERATION",
                         "task is in a terminal state and cannot accept messages", taskId=task_id)
    else:
        task = {"id": str(uuid.uuid4()), "contextId": msg.get("contextId") or str(uuid.uuid4()),
                "status": {"state": "TASK_STATE_SUBMITTED"}, "history": []}
        TASKS[task["id"]] = task
    task["history"].append(msg)
    handle(task, text_of(msg))
    return JSONResponse({"task": task}, media_type=CT)


@app.get(BASE + "/tasks/{task_id}")
def get_task(task_id: str, a2a_version: str | None = Header(None), authorization: str | None = Header(None)):
    if (bad := check(a2a_version, authorization)) is not None:
        return bad
    task = TASKS.get(task_id)
    if task is None:
        return error(404, "NOT_FOUND", "TASK_NOT_FOUND", "task not found", taskId=task_id)
    return JSONResponse(task, media_type=CT)
```

**第 3 步:写客户端。** 客户端只认 Agent Card 的地址,其余信息都从名片里读。

```python
# agentops/a2a/a2a_client.py
"""一个最小的 A2A 客户端:先读 Agent Card,挑一个自己支持的接口,再发消息;遇到 INPUT_REQUIRED 就补充信息继续。"""
from __future__ import annotations

import uuid

import httpx


class A2AClient:
    def __init__(self, http: httpx.Client, card_url: str, token: str):
        self.http = http
        card = http.get(card_url).json()
        iface = next(i for i in card["supportedInterfaces"]
                     if i["protocolBinding"] == "HTTP+JSON" and i["protocolVersion"] == "1.0")
        self.base = iface["url"]
        self.card = card
        self.headers = {"A2A-Version": "1.0", "Authorization": f"Bearer {token}",
                        "Content-Type": "application/a2a+json"}

    def send(self, text: str, task_id: str | None = None) -> dict:
        msg = {"role": "ROLE_USER", "messageId": str(uuid.uuid4()), "parts": [{"text": text}]}
        if task_id:
            msg["taskId"] = task_id
        r = self.http.post(f"{self.base}/message:send", json={"message": msg}, headers=self.headers)
        r.raise_for_status()
        return r.json()["task"]
```

**第 4 步:写测试。** 用 FastAPI 的 TestClient,不用真起服务。

```python
# agentops/a2a/test_a2a.py
from fastapi.testclient import TestClient
from a2a_server import app, BASE
from a2a_client import A2AClient

H = {"A2A-Version": "1.0", "Authorization": "Bearer demo-token"}


def client():
    c = TestClient(app, base_url="http://localhost:8000")
    return c, A2AClient(c, "http://localhost:8000/.well-known/agent-card.json", "demo-token")


def test_card_discovery():
    _, a = client()
    assert a.base == "http://localhost:8000/a2a/v1"
    assert a.card["skills"][0]["id"] == "refund-request"


def test_multi_turn_input_required():
    _, a = client()
    t = a.send("我上个月被扣了两次钱")
    assert t["status"]["state"] == "TASK_STATE_INPUT_REQUIRED"
    t2 = a.send("发票号是 INV-2291", task_id=t["id"])
    assert t2["id"] == t["id"] and t2["status"]["state"] == "TASK_STATE_COMPLETED"
    assert t2["artifacts"][0]["parts"][0]["data"]["invoice"] == "INV-2291"


def test_terminal_task_rejects_message():
    c, a = client()
    t = a.send("INV-1 重复扣款")
    r = c.post(f"{BASE}/message:send", headers=H,
               json={"message": {"role": "ROLE_USER", "messageId": "m", "taskId": t["id"], "parts": [{"text": "再来"}]}})
    assert r.status_code == 400
    assert r.json()["error"]["details"][0]["reason"] == "UNSUPPORTED_OPERATION"


def test_version_and_auth():
    c, _ = client()
    body = {"message": {"role": "ROLE_USER", "messageId": "m", "parts": [{"text": "hi"}]}}
    r = c.post(f"{BASE}/message:send", json=body, headers={"Authorization": "Bearer demo-token"})
    assert r.json()["error"]["details"][0]["reason"] == "VERSION_NOT_SUPPORTED"
    r = c.post(f"{BASE}/message:send", json=body, headers={"A2A-Version": "1.0"})
    assert r.status_code == 401


def test_get_task_not_found():
    c, _ = client()
    r = c.get(f"{BASE}/tasks/nope", headers=H)
    assert r.status_code == 404 and r.json()["error"]["details"][0]["reason"] == "TASK_NOT_FOUND"
```

```bash
uv run pytest -q
```

输出大致长这样:`5 passed`。

**第 5 步:用 curl 看线上到底传什么。** 起服务:`uv run uvicorn a2a_server:app --port 8000`,然后:

```bash
curl -s localhost:8000/.well-known/agent-card.json | python3 -m json.tool | head -20
curl -s -X POST localhost:8000/a2a/v1/message:send \
  -H 'A2A-Version: 1.0' -H 'Authorization: Bearer demo-token' -H 'Content-Type: application/a2a+json' \
  -d '{"message":{"role":"ROLE_USER","messageId":"m1","parts":[{"text":"我被扣了两次钱"}]}}'
```

第二个请求返回的任务状态应该是 `TASK_STATE_INPUT_REQUIRED`,状态里带着一条问发票号的 Agent 消息。把返回的 task id 填进下一条请求的 `taskId`,补上发票号,看任务变成 COMPLETED。

**第 6 步:接上真 Agent。** 把 `handle()` 换成调用 Day 47 的 LangGraph 工作流:工作流里遇到「需要用户补充信息」的节点时,把任务置为 INPUT_REQUIRED 并把问题放进状态消息;退款需要主管审批时,任务保持 WORKING 并在 Artifact 里返回申请编号。思考一个问题:主管审批要等几小时,客户端应该一直轮询 GetTask,还是用推送通知?把你的选择和理由写下来。

**第 7 步(选做):换成官方 SDK。** 用 `a2a-sdk` 重写服务端,对比手写版本少了多少代码、多了哪些你没处理的边界情况。

**验收标准**:5 个测试通过;第 5 步的 curl 能完整走一遍多轮交互;第 6 步写出轮询和推送的取舍理由;写一段话说明你的服务端如何处理「代表哪个最终用户」的问题(目前的实现没有处理,你要设计怎么补)。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| A2A(Agent2Agent) | Agent 之间发现、通信、委派任务的开放协议,2026 年 3 月发布 1.0 |
| MCP | Agent 连接工具和数据源的协议 |
| ACP(Agent Client Protocol) | 编辑器、控制台和 Coding Agent 之间的协议 |
| AAIF | Agentic AI Foundation,Linux 基金会旗下托管 MCP、A2A、AGENTS.md 等项目的组织 |
| Agent Card | Agent 的名片,声明能力、接口、鉴权方式,默认在 /.well-known/agent-card.json |
| 不透明 Agent(opaque agent) | 调用方看不到内部实现,只通过声明的能力和协议交互的 Agent |
| Task / Message / Artifact / Part | A2A 的核心对象:任务、沟通消息、交付产出、内容单元 |
| INPUT_REQUIRED / AUTH_REQUIRED | 任务需要补充信息 / 需要额外授权时的状态 |
| 传输绑定(protocol binding) | 同一套语义在 JSON-RPC、gRPC、HTTP+JSON 上的具体表示 |
| A2A-Version | 客户端声明协议版本的请求头,不带时按 0.3 处理 |
| 困惑的代理人(confused deputy) | 有权限的服务被调用方利用,替调用方做了它本不该做的事 |

## 常见误区

**把 A2A 当成「另一种 MCP」。** MCP 连的是行为确定的工具,A2A 连的是有自主判断、可能长时间运行、需要多轮交互的 Agent。拿 A2A 去调一个查询接口是过度设计。

**同一个团队内部也上 A2A。** 进程内的子 Agent、工作流就能解决的事,引入网络协议只会增加延迟和故障点。协议的价值在跨边界。

**客户端忘了带 A2A-Version。** 服务端会按 0.3 处理,出现各种看不懂的字段错误。

**只用调用方身份做授权。** 下游不知道最终用户是谁,就无法按用户维度控制数据访问,容易出现越权。

**信任对方 Agent 的返回内容。** 它就是外部输入,可能有注入、可能有错误,要校验,不能直接触发写操作。

## 学习资料

### 文档与文章

- [A2A 规范(最新版)](https://a2a-protocol.org/latest/specification/):重点读第 3 节操作、第 4 节数据模型、第 5.3 节方法对照、第 7 节鉴权、第 8 节 Agent Card,2 小时。
- [A2A 官方:A2A and MCP](https://a2a-protocol.org/latest/topics/a2a-and-mcp/):官方对两者分工的说明,15 分钟。
- [AAIF:A2A joins AAIF's open agentic stack](https://aaif.io/blog/a2a-joins-aaif):2026 年 8 月的公告,里面的协议分层很清楚,10 分钟。
- [A2A v1.0.0 发布说明](https://github.com/a2aproject/A2A/releases/tag/v1.0.0):1.0 相对 0.3 的变化,升级老代码时必看,20 分钟。
- [MCP 规范 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28):对比着看两个协议的设计取向,挑「Architecture」部分读,30 分钟。
- [Agent Client Protocol](https://agentclientprotocol.com/):了解 ACP 管的是哪一层,10 分钟。

### B 站视频

- 技术蛋老师《Function Calling、MCP和A2A的核心原理与区别》:已嵌入正文。
- react__《Google Agent2Agent(A2A)vs MCP AI多智能体通信协议与代码实践》:10 P 共 81 分钟,有代码实践,看第 1 到 4 P 的协议讲解;录于 1.0 之前,字段名和状态名以 1.0 规范为准。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1wnLtzqEvd&autoplay=0&high_quality=1" title="Google Agent2Agent（A2A）vs MCP AI多智能体通信协议与代码实践" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>react__ · Google Agent2Agent(A2A)vs MCP AI多智能体通信协议与代码实践 · 10 P,先看前 4 P。</figcaption>
</figure>

### 其他经典视频

- Google Cloud Tech《Introduction to Agent2Agent (A2A) Protocol》:已嵌入正文。
- IBM Technology《A2A Protocol (Agent2Agent) Explained: How AI Agents Collaborate》:9 分钟,用白板讲 A2A 和 MCP 怎么配合。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Tud9HLTk8hg" title="A2A Protocol (Agent2Agent) Explained: How AI Agents Collaborate" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>IBM Technology · A2A Protocol (Agent2Agent) Explained · 9 分钟,白板讲解,适合对照今天第一张图。</figcaption>
</figure>

### 书籍

- Martin Kleppmann《Designing Data-Intensive Applications》(O'Reilly, 2017;中文版《数据密集型应用系统设计》,中国电力出版社,2018):第 4 章「Encoding and Evolution」,讲数据格式和接口的向前向后兼容、版本演进,A2A 从 0.3 到 1.0 的不兼容升级、版本头的设计,背后都是这一章的问题,1.5 小时。

### 开源项目与代码

- [a2aproject/A2A](https://github.com/a2aproject/A2A):规范仓库,`specification/a2a.proto` 是权威定义,`docs/specification.md` 是正文。
- [a2aproject/a2a-python](https://github.com/a2aproject/a2a-python):官方 Python SDK 源码,看 `a2a/client/card_resolver.py` 怎么发现名片。
- [a2aproject/a2a-samples](https://github.com/a2aproject/a2a-samples):各种框架实现 A2A 的示例,挑一个你熟悉的框架看。

## 自测

**1. 什么情况下用 MCP,什么情况下用 A2A?各举一个 SupportPilot 里的例子。**

<details><summary>答案</summary>

对方是行为确定、调用后很快返回的工具或数据源,用 MCP,比如 SupportPilot 查账单库、查知识库。对方是有自主判断、可能长时间运行、需要多轮交互、内部实现你看不到的 Agent,用 A2A,比如请财务团队的对账 Agent 核实一笔有争议的扣款,它可能需要几分钟、可能会反过来问你要合同编号。

</details>

**2. 客户端没带 A2A-Version 头,服务端会怎么处理?为什么这样设计?**

<details><summary>答案</summary>

按 0.3 版本处理。这是为了兼容 1.0 之前的老客户端,它们不知道要带这个头。副作用是新客户端如果忘了带,会被当成老版本,出现字段不兼容的错误,所以客户端 SDK 应该默认带上版本头。

</details>

**3. 任务处于 TASK_STATE_COMPLETED,客户端又往这个任务发了一条消息,会发生什么?如果业务上确实要追问,应该怎么做?**

<details><summary>答案</summary>

服务端返回 UnsupportedOperationError,终态任务不接受新消息。要追问的话,开一个新任务,用同一个 contextId 把它和之前的任务关联到同一个会话里,必要时在消息里引用前一个任务的 id。

</details>

**4. 什么是 confused deputy 问题?在 A2A 场景里怎么防?**

<details><summary>答案</summary>

有权限的服务被调用方利用,替调用方做了它本不该做的事。比如 SupportPilot 用自己的服务身份调用财务 Agent,财务 Agent 只认服务身份,就可能把其他客户的数据返回给它。防法是把最终用户的身份和授权范围随请求一起传递(比如用 OAuth 的代表用户授权或令牌交换),被调用方按最终用户维度做授权和审计,而不是只看调用方是谁。

</details>

**5. 资深面试题:公司有 20 个团队各自做了 Agent,CTO 希望它们能互相调用。你会怎么设计这套互联方案?要不要上 A2A?**

<details><summary>答案</summary>

先分类:团队内部的 Agent 协作用子 Agent 和工作流,不走协议;跨团队调用才需要统一方案。跨团队部分我会上 A2A,原因是各团队技术栈不同、需要独立演进、有长任务和多轮交互,A2A 的不透明 Agent 模型和任务状态机正好匹配,而且有中立治理和官方 SDK,不用自造协议。

设计上要有几块:一是 Agent 目录,各团队注册 Agent Card,支持按技能搜索,目录本身做访问控制;二是统一鉴权,内部用 OAuth 2.0 client credentials 加代表用户的令牌交换,确保下游能按最终用户授权;三是网关,统一做限流、审计、计费归因和可观测(OTel 贯穿调用链);四是规范,规定 Agent Card 必须写清技能和示例、错误码、SLA,返回内容视为不可信、写操作必须在被调用方做确认;五是版本治理,协议版本和各 Agent 自身版本都要有升级和废弃流程。落地顺序上先挑两三个真实有跨团队需求的场景试点,验证收益后再推广,而不是一开始就要求 20 个团队都改造。

</details>

## 明天预告

Day 94 讲 Agent 的产品与交互:人在回路里的体验设计。协议解决了 Agent 和 Agent 怎么说话,明天回到 Agent 和人:自主程度分几级、什么时候该让 Agent 自己做、什么时候必须停下来问人;怎么展示计划和步骤让用户敢信任它;出错时怎么让用户能中断和撤销。我们会用一篇关于自主程度分级的论文做框架,给 SupportPilot 的每个动作定一个自主级别,并实现一个带撤销窗口的动作策略引擎。
