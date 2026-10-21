---
title: 'Day 22 · MCP 是什么:为什么大家都在接 MCP,协议里有什么'
description: 'MCP 把「给 AI 应用接工具」这件事标准化了。今天把 host、client、server 三个角色,tools、resources、prompts 三种能力,JSON-RPC 消息和两种传输方式一次讲清,顺便说明它和 function calling 到底是什么关系。'
pubDate: 2026-10-12
regime: none
tags: ['mcp', 'tool-use', 'protocol', 'agent-60']
series: 'agent-60'
day: 22
lang: 'zh'
---

## 今天要解决的问题

W2 你手写过 Agent 循环,W3 给它接了 RAG。到现在为止,所有工具都是你自己在 Python 里定义、自己拼 JSON Schema、自己在循环里执行的。这个办法对一个项目没问题,麻烦出在「第二个项目」:同一个「查订单」工具,换个 Agent 框架要重写一遍,想在 Cursor 或 Claude Code 里用,又得按它们的插件格式再包一遍。MCP(Model Context Protocol,模型上下文协议)就是来解决这件事的。

今天学完,你应该能做到这几件事:

1. 用自己的话讲清 MCP 解决的是什么问题,为什么说它把 M×N 变成了 M+N。
2. 分清 host、client、server 三个角色,知道你写的代码属于哪一个。
3. 说出 server 能暴露的三种东西(tools、resources、prompts)分别由谁决定调用。
4. 看懂一次 `tools/list` 和 `tools/call` 的 JSON-RPC 原文,知道 stdio 和 Streamable HTTP 两种传输各用在哪。
5. 回答面试官那句常见追问:「有了 function calling 为什么还要 MCP?」

预计用时 3–4 小时:概念 1.5 小时,视频 1 小时,动手练习 1 小时。前置是 Day 8(function calling)和 Day 9(手写 Agent 循环),那两天的东西没吃透的话,今天会觉得 MCP 很玄。其实它一点都不玄。

## 先说痛点:每个应用都在重复接线

假设你们公司有三个 AI 应用:一个客服 Agent、一个内部知识库问答、一个给运营用的数据助手。它们都想查订单、查客户、查工单。再假设公司有五个内部系统要接:订单库、CRM、工单系统、Confluence、GitLab。

没有统一协议的时候,每个应用都要给每个系统写一套适配代码。三个应用乘五个系统,就是十五份「工具定义 + 调用代码 + 鉴权处理」。更糟的是这十五份代码由不同的人在不同的时间写,字段名叫法都不一样,订单库改了一个字段,得挨个去找哪些应用受影响。

这就是 M×N 问题。M 个应用,N 个外部系统,两两接线。

MCP 的做法和 USB、LSP(Language Server Protocol,VS Code 用来接各种语言插件的那个协议)是一个思路:定一个中间协议。每个外部系统只需要写一个 MCP server,每个 AI 应用只需要会说 MCP 协议,然后谁都能接谁。接线数量从 M×N 降到 M+N。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="左边是三个应用直连五个系统共十五条线,右边是三个应用和五个系统都只连到中间的 MCP 协议层">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <text x="150" y="24" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">没有 MCP:3 × 5 = 15 套适配</text>
  <text x="490" y="24" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">有 MCP:3 + 5 = 8 个实现</text>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="20" y="60" width="70" height="26" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="55" y="77" text-anchor="middle" fill="var(--ink)">客服Agent</text>
    <rect x="20" y="135" width="70" height="26" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="55" y="152" text-anchor="middle" fill="var(--ink)">知识库问答</text>
    <rect x="20" y="210" width="70" height="26" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="55" y="227" text-anchor="middle" fill="var(--ink)">数据助手</text>
    <rect x="210" y="45" width="70" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="245" y="61" text-anchor="middle" fill="var(--ink)">订单库</text>
    <rect x="210" y="95" width="70" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="245" y="111" text-anchor="middle" fill="var(--ink)">CRM</text>
    <rect x="210" y="145" width="70" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="245" y="161" text-anchor="middle" fill="var(--ink)">工单系统</text>
    <rect x="210" y="195" width="70" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="245" y="211" text-anchor="middle" fill="var(--ink)">Wiki</text>
    <rect x="210" y="245" width="70" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="245" y="261" text-anchor="middle" fill="var(--ink)">GitLab</text>
  </g>
  <g stroke="var(--rule)" stroke-width="1">
    <line x1="90" y1="73" x2="210" y2="57"/><line x1="90" y1="73" x2="210" y2="107"/><line x1="90" y1="73" x2="210" y2="157"/><line x1="90" y1="73" x2="210" y2="207"/><line x1="90" y1="73" x2="210" y2="257"/>
    <line x1="90" y1="148" x2="210" y2="57"/><line x1="90" y1="148" x2="210" y2="107"/><line x1="90" y1="148" x2="210" y2="157"/><line x1="90" y1="148" x2="210" y2="207"/><line x1="90" y1="148" x2="210" y2="257"/>
    <line x1="90" y1="223" x2="210" y2="57"/><line x1="90" y1="223" x2="210" y2="107"/><line x1="90" y1="223" x2="210" y2="157"/><line x1="90" y1="223" x2="210" y2="207"/><line x1="90" y1="223" x2="210" y2="257"/>
  </g>
  <line x1="320" y1="40" x2="320" y2="285" stroke="var(--rule)" stroke-dasharray="4 4"/>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="345" y="60" width="70" height="26" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="380" y="77" text-anchor="middle" fill="var(--ink)">客服Agent</text>
    <rect x="345" y="135" width="70" height="26" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="380" y="152" text-anchor="middle" fill="var(--ink)">知识库问答</text>
    <rect x="345" y="210" width="70" height="26" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="380" y="227" text-anchor="middle" fill="var(--ink)">数据助手</text>
    <rect x="450" y="45" width="28" height="224" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
    <text x="464" y="160" text-anchor="middle" fill="var(--ink)" transform="rotate(-90 464 160)">MCP</text>
    <rect x="550" y="45" width="70" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="585" y="61" text-anchor="middle" fill="var(--ink)">订单库</text>
    <rect x="550" y="95" width="70" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="585" y="111" text-anchor="middle" fill="var(--ink)">CRM</text>
    <rect x="550" y="145" width="70" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="585" y="161" text-anchor="middle" fill="var(--ink)">工单系统</text>
    <rect x="550" y="195" width="70" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="585" y="211" text-anchor="middle" fill="var(--ink)">Wiki</text>
    <rect x="550" y="245" width="70" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="585" y="261" text-anchor="middle" fill="var(--ink)">GitLab</text>
  </g>
  <g stroke="var(--mem)" stroke-width="1.2">
    <line x1="415" y1="73" x2="450" y2="73"/><line x1="415" y1="148" x2="450" y2="148"/><line x1="415" y1="223" x2="450" y2="223"/>
  </g>
  <g stroke="var(--compute)" stroke-width="1.2">
    <line x1="478" y1="57" x2="550" y2="57"/><line x1="478" y1="107" x2="550" y2="107"/><line x1="478" y1="157" x2="550" y2="157"/><line x1="478" y1="207" x2="550" y2="207"/><line x1="478" y1="257" x2="550" y2="257"/>
  </g>
</svg>
<figcaption>左边每加一个系统,所有应用都要改;右边每个系统只写一次 MCP server,每个应用只实现一次 MCP client。</figcaption>
</figure>

这个类比有个容易被忽略的地方:USB 的价值不在于 USB 插头设计得多好,而在于大家都用它。MCP 也一样。2024 年 11 月 Anthropic 发布它的时候,外界的态度是「又一个自家标准」。真正让它站住的是后来 OpenAI、Google、微软、各家 IDE 都接了,2025 年 12 月它又被捐给 Linux 基金会下面新成立的 Agentic AI Foundation 管理。到 2026 年,你在 Cursor、Claude Code、VS Code、ChatGPT 里配一个 MCP server,基本都能用。招聘 JD 上写「熟悉 MCP」也是这么来的:它已经是事实标准,不会也得会。

## 三个角色:host、client、server

MCP 里有三个词,后面每天都会出现,先把它们钉死。

**Host** 是用户直接打交道的那个 AI 应用。Claude Desktop、Cursor、Claude Code、你自己写的客服 Agent,都是 host。Host 负责跟大模型对话、决定把哪些上下文塞给模型、在模型要调用工具时真正去执行。

**Client** 住在 host 里面,是 host 里专门「说 MCP」的那部分代码。一个 host 连几个 server,里面就有几个 client,一对一。你在 Claude Code 里配了 GitHub 和 Postgres 两个 MCP server,它内部就跑着两个 client。

**Server** 是你最常写的东西。它把某个外部系统的能力包装成 MCP 格式暴露出去。注意一点:server 不直接和大模型说话,它只和 client 说话。模型根本不知道 MCP 的存在,它看到的仍然是 function calling 那套 tools 列表。这句话很关键,后面讲「MCP 和 function calling 的关系」时还会回来。

拿后端的经验来对照会好理解很多。你可以把 server 想成一个微服务,client 是调用这个微服务的 SDK,host 是业务系统。区别是这个「微服务」的接口格式是统一规定好的,任何会说 MCP 的 host 都能直接用,不用读你的接口文档。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="Host 内部有大模型和两个 MCP client,分别连到两个 MCP server,server 再连到数据库和外部 API">
  <rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)"/>
  <rect x="20" y="30" width="300" height="220" rx="6" fill="none" stroke="var(--ink-soft)"/>
  <text x="34" y="52" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">Host(Claude Code / 你的 Agent)</text>
  <rect x="40" y="75" width="110" height="60" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="95" y="100" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">大模型</text>
  <text x="95" y="118" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">只认 tools 列表</text>
  <rect x="190" y="75" width="110" height="40" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
  <text x="245" y="99" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">MCP client A</text>
  <rect x="190" y="160" width="110" height="40" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
  <text x="245" y="184" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">MCP client B</text>
  <line x1="150" y1="105" x2="190" y2="95" stroke="var(--rule)"/>
  <line x1="150" y1="105" x2="190" y2="180" stroke="var(--rule)"/>
  <rect x="380" y="70" width="120" height="50" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="440" y="92" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">server:订单</text>
  <text x="440" y="109" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">stdio 子进程</text>
  <rect x="380" y="155" width="120" height="50" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="440" y="177" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">server:GitHub</text>
  <text x="440" y="194" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">Streamable HTTP</text>
  <line x1="300" y1="95" x2="380" y2="95" stroke="var(--compute)" stroke-width="1.5"/>
  <line x1="300" y1="180" x2="380" y2="180" stroke="var(--compute)" stroke-width="1.5"/>
  <text x="340" y="88" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">JSON-RPC</text>
  <text x="340" y="173" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">JSON-RPC</text>
  <rect x="540" y="75" width="80" height="40" rx="4" fill="none" stroke="var(--rule)"/>
  <text x="580" y="99" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">SQLite</text>
  <rect x="540" y="160" width="80" height="40" rx="4" fill="none" stroke="var(--rule)"/>
  <text x="580" y="184" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">GitHub API</text>
  <line x1="500" y1="95" x2="540" y2="95" stroke="var(--rule)"/>
  <line x1="500" y1="180" x2="540" y2="180" stroke="var(--rule)"/>
</svg>
<figcaption>一个 host 里有几个 client 就连几个 server。大模型只看到 host 汇总后的 tools 列表,不知道背后是 MCP。</figcaption>
</figure>

## server 能给的三样东西

一个 MCP server 能暴露三种东西。规范里区分它们的标准很有意思,不是按数据类型分,而是按「谁决定用它」分。

**Tools(工具)由模型决定调用。** 这就是你熟悉的 function calling 里的那种工具:查订单、发邮件、建工单。模型读了工具描述,自己判断什么时候调、传什么参数。工具可以有副作用。

**Resources(资源)由应用决定加载。** 资源是只读的数据,用一个 URI 标识,比如 `file:///home/me/notes.md` 或者 `cloudledger://policy/refund`。host 程序(不是模型)决定什么时候把哪个资源塞进上下文。在 Claude Desktop 里,你点那个回形针图标手动附加一个资源,就是这个机制。

**Prompts(提示词模板)由用户决定使用。** server 可以提供一些写好的提示词模板,带参数。用户在 host 里像选斜杠命令一样选它,比如 `/reply_ticket T1041`,host 把模板渲染成消息发给模型。

用后端的话说:resource 像一个 GET 接口,只取数据不改东西;tool 像 POST,干活、可能有副作用;prompt 没有对应物,更像一个「保存好的查询」。

这三样里你 90% 的时间会在写 tools。resources 和 prompts 的支持程度在各个 host 里差别很大:有的 host 完全不展示 resources,有的不支持 prompts。所以我的建议是,核心能力一律做成 tool,resources 和 prompts 当锦上添花。面试时被问到三者区别,答出「控制方不同」这一点就够加分了,大部分候选人只会说「tools 是函数,resources 是数据」。

除了这三样,协议里还有几种「反方向」的能力,是 server 向 client 要东西:sampling(server 请 host 帮它调一次大模型)、elicitation(server 在执行中途向用户提问,比如「确认要删除吗?」)、roots(client 告诉 server 它能访问哪些目录)。这些现在知道名字就行,写客服 Agent 用不到。2026 年 7 月的新版规范把这类「server 主动发请求」的机制改成了多轮往返的形式,细节等你真用到再查。

## 线上传的是什么:JSON-RPC

MCP 的消息格式是 JSON-RPC 2.0。如果你写过以太坊节点调用或者 LSP 插件,会很眼熟;没写过也没关系,它非常简单:一个请求有 `jsonrpc`、`id`、`method`、`params` 四个字段,响应带着同一个 `id` 回来,里面是 `result` 或 `error`。

客户端想知道 server 有哪些工具,发一个 `tools/list`:

```json
{"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}
```

server 回:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "list_invoices",
        "description": "列出客户最近的发票(按开票日期倒序),金额单位为元。可按状态过滤。",
        "inputSchema": {
          "type": "object",
          "properties": {
            "customer_id": {"type": "string", "pattern": "^C\\d{3}$", "description": "客户编号,如 C007"},
            "status": {"anyOf": [{"enum": ["paid", "open", "void", "refunded"], "type": "string"}, {"type": "null"}], "default": null},
            "limit": {"type": "integer", "minimum": 1, "maximum": 20, "default": 6}
          },
          "required": ["customer_id"]
        },
        "annotations": {"readOnlyHint": true, "openWorldHint": false}
      }
    ]
  }
}
```

看到 `inputSchema` 了吗?它就是 Day 8 你在 function calling 里手写过的 JSON Schema,一模一样的东西。这就是为什么 host 能把 MCP 工具直接转成模型的 tools 参数:格式本来就是对齐的。

模型决定调用后,client 发 `tools/call`:

```json
{"jsonrpc": "2.0", "id": 3, "method": "tools/call",
 "params": {"name": "list_invoices", "arguments": {"customer_id": "C007", "limit": 3}}}
```

server 回:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {"type": "text", "text": "{\"id\": \"INV-2026-0123\", \"amount_yuan\": \"2392.00\", \"status\": \"paid\", ...}"},
      {"type": "text", "text": "{\"id\": \"INV-2026-0026\", \"amount_yuan\": \"2392.00\", \"status\": \"paid\", ...}"}
    ],
    "structuredContent": {"result": [{"id": "INV-2026-0123", "amount_yuan": "2392.00", "status": "paid"}, {"id": "INV-2026-0026", "amount_yuan": "2392.00", "status": "paid"}]},
    "isError": false
  }
}
```

`content` 是给模型看的(文本、图片、音频都行),`structuredContent` 是给程序看的结构化结果,`isError` 标记这次调用是否失败。这里有个设计值得记住:**工具执行失败不是协议错误**。查不到客户、参数不合法,server 返回的是一个正常的 result,只是 `isError: true`,错误信息放在 content 里给模型读,模型读了之后可以换个参数重试。只有「方法不存在」「请求格式坏了」这种协议层面的问题才走 JSON-RPC 的 `error`。Day 12 讲过「报错信息要能指导模型自我纠正」,MCP 把这件事写进了协议。

在 `tools/list` 之前,传统的流程还有一次握手:client 发 `initialize`,双方交换协议版本和各自支持的能力(capabilities),然后 client 发一个 `notifications/initialized` 通知。这个握手在 2025 年的规范里一直存在。2026-07-28 版规范做了一次大改:去掉了握手和会话,每个请求自己在 `_meta` 里带上协议版本和客户端信息,能力发现改用一个普通的 `server/discover` 请求。好处是服务端变成无状态的,放在负载均衡后面随便扩容,不需要会话粘滞。官方 Python SDK 2.x 两种都支持,会先探测 server 支持哪种。你写代码时几乎感觉不到区别,但面试被问到「MCP 怎么横向扩展」,能说出这一点会很加分。

## 两种传输:stdio 和 Streamable HTTP

JSON-RPC 只规定了消息长什么样,消息怎么从 client 到 server,由传输层决定。MCP 现在主要用两种。

**stdio**:host 把 server 当成一个子进程启动,往它的标准输入写请求,从标准输出读响应。你在 Claude Desktop 配置文件里写的 `"command": "uv", "args": [...]`,就是在告诉 host 怎么启动这个子进程。它的好处是零网络配置、天然隔离、适合本机工具(读本地文件、操作本地 git)。代价是只能本机用,而且有一个新手必踩的坑:**stdout 就是通信线路**。你在 server 代码里随手 `print("debug")`,这行字会混进 JSON-RPC 消息流,host 解析失败直接断开。日志要写到 stderr,用 `logging` 模块就行。新版 Python SDK 会在运行期间把误写到 stdout 的内容转到 stderr,但启动前的 print 还是会出事,别赌。

**Streamable HTTP**:server 是一个普通的 HTTP 服务,监听一个端点(一般是 `/mcp`)。client 用 POST 发请求,server 可以直接回 JSON,也可以回一个 SSE 流(Day 4 讲流式输出时见过 SSE)来推送进度和通知。要部署给别人用、要放在网关后面、要做鉴权,都走这个。

你可能还会在老教程里看到「SSE 传输」,那是 2024 年的方案,2025-03-26 版规范起被 Streamable HTTP 取代。新东西不要再用它。

怎么选?一句话:**给自己或给装了你代码的人用,stdio;给一群人用、要部署,Streamable HTTP**。CloudLedger 的 server 在 Day 23 先用 stdio 跑通,Day 28 和 W6 部署时再换成 HTTP。好在 SDK 里切换只是 `mcp.run()` 改一个参数。

## MCP 和 function calling 是什么关系

这是面试最爱问的一题,也是最多人答错的一题。常见的错误答案是「MCP 取代了 function calling」或者「MCP 是更高级的 function calling」。

正确的理解是:**它们在不同的层**。function calling 是模型和 host 之间的约定:host 把工具列表发给模型,模型回一段「我要调用 X,参数是 Y」的 JSON。MCP 是 host 和外部工具之间的约定:工具从哪来、怎么列出、怎么执行。

一次完整的调用串起来是这样的:

1. Host 启动时,通过 MCP client 对每个 server 发 `tools/list`,拿到所有工具。
2. Host 把这些工具转成模型认识的格式(OpenAI 的 `tools` 参数、Anthropic 的 `tools` 参数),连同用户问题一起发给模型。这一步是 function calling。
3. 模型回复说要调用 `list_invoices`。这一步还是 function calling。
4. Host 找到这个工具属于哪个 server,让对应的 client 发 `tools/call`。这一步是 MCP。
5. Server 执行完返回结果,host 把结果作为 tool 消息塞回给模型。又回到 function calling。

所以没有 function calling,模型就不会「想调用工具」;没有 MCP,工具就得写死在 host 里。两者是配合关系。明天你会亲手写这个桥接代码,大概 30 行,写完就再也不会搞混了。

还有一个经常被一起问的东西:A2A(Agent2Agent)协议。它是 Google 2025 年 4 月发起、后来也交给 Linux 基金会的协议,解决的是「Agent 和 Agent 之间怎么协作」。MCP 管 Agent 和工具,A2A 管 Agent 和 Agent。目前工程实践里 MCP 用得远比 A2A 多,A2A 知道定位、能说出区别就够了,Day 26 讲多 Agent 时会再提一句。

## 2026 年的生态,以及什么时候不值得写 MCP

现在找现成的 MCP server,第一站是官方的 [MCP Registry](https://registry.modelcontextprotocol.io),各家公司也都在发自己的官方 server(GitHub、Stripe、Notion、各种数据库)。官方 GitHub 仓库 `modelcontextprotocol/servers` 里只保留了几个参考实现(Everything、Fetch、Filesystem、Git、Memory、Sequential Thinking、Time),定位是教学示例,不是给你上生产用的。

SDK 方面,官方有 Python、TypeScript、Java、Kotlin、Go、C#、Rust 等十来种语言。Python SDK 在 2026 年发了 2.x,这次改动挺大:1.x 里大家熟悉的 `FastMCP` 类改名叫 `MCPServer`,导入路径从 `mcp.server.fastmcp` 改成了 `mcp.server`;客户端也从「transport + ClientSession + 手动 initialize」三层嵌套简化成一个 `Client` 类。你在 B 站和网上看到的大量 2025 年教程用的还是 `FastMCP` 写法,照抄到 2.x 会直接报 `ImportError`。这门课统一用 2.x 写法,遇到老教程,心里做个替换就行。另外还有一个同名的第三方库 `fastmcp`(gofastmcp.com),功能更多,LangChain 的 MCP 适配器就是基于它做的,别和官方 SDK 搞混。

说完好处,也得说说什么时候**不该**写 MCP server。一个常见的反模式是为了显得「架构先进」把所有东西都包成 MCP,结果多了一层进程、一层序列化、一堆调试成本,什么也没换来。判断标准很简单:

- 工具只给你自己这一个 Agent 用,而且和 Agent 跑在同一个进程里,直接写成函数就行,Day 9 那种工具注册表足够了。
- 工具需要被多个应用复用,或者你希望它能在 Cursor、Claude Code 这类现成 host 里直接用,写成 MCP server。
- 工具属于另一个团队维护的系统,让那个团队出一个 MCP server,你们按协议对接,这是 MCP 最大的价值所在。

CloudLedger 的业务库属于第二种情况:客服 Agent 要用,W5 的评测脚本要用,运营同学可能还想在 Claude Desktop 里直接查。所以明天我们把它包成 MCP server。

安全方面先打个预防针:MCP server 本质上是你允许 AI 执行的代码。接一个第三方 server 等于在你的机器上装一个插件,它能读你的文件、拿你的环境变量。2025 年出过好几起恶意或被投毒的 MCP server 事件,工具描述里藏注入指令的手法也有了专门的名字(tool poisoning)。所以第三方 server 只装来源可信的,用之前看一眼它的工具列表和权限。Day 39、40 讲安全时会专门展开。

## 动手练习

今天的练习不写 server,目标是**亲眼看到协议**。看过一次真实的 JSON-RPC 往返,明天写代码会顺很多。

**第一步:用 MCP Inspector 看一个现成 server。** Inspector 是官方的调试工具,一个网页界面,能连任何 MCP server、列出工具、手动调用、看原始消息。它是 Node.js 写的,需要本机有 Node 18 以上(`node -v` 看一下)和 uv。

```bash
# 本机终端。启动 Inspector,让它用 uvx 拉起官方的 Time server(stdio)
npx @modelcontextprotocol/inspector uvx mcp-server-time
```

命令会打印一个本地网址(通常带一个 token 参数),浏览器打开,点 Connect。然后按顺序做:

1. 打开 Tools 标签,点 List Tools,看 `get_current_time` 和 `convert_time` 两个工具的 inputSchema。
2. 调用 `get_current_time`,参数 `timezone` 填 `Asia/Shanghai`,看返回。
3. 故意填一个不存在的时区 `Mars/Olympus`,看返回的是 `isError: true` 还是协议错误。
4. 找到界面上的历史记录或消息面板,把一次 `tools/call` 的请求和响应原文复制到你的笔记里。

**第二步:用 Python 自己当一回 client。** 不靠任何界面,用官方 SDK 连同一个 server,打印工具列表并调用一次。

```bash
# 在 agent-60-lab 根目录下,后面的命令也都在根目录跑
mkdir -p w4
uv add "mcp[cli]"
```

```python
# agent-60-lab/w4/peek_time_server.py
import anyio
from mcp import Client, StdioServerParameters
from mcp.types import CallToolResult, TextContent

server = StdioServerParameters(command="uvx", args=["mcp-server-time"])


def first_text(result: CallToolResult) -> str:
    """取结果里第一条文本。content 可能是文本、图片、音频等几种类型,先确认是文本再读 .text。"""
    block = result.content[0]
    return block.text if isinstance(block, TextContent) else f"<{block.type}>"


async def main() -> None:
    async with Client(server) as client:
        print("协议版本:", client.protocol_version)
        listing = await client.list_tools()
        for tool in listing.tools:
            print(f"- {tool.name}: {(tool.description or '')[:60]}")
            print("  参数:", list(tool.input_schema.get("properties", {}).keys()))

        ok = await client.call_tool("get_current_time", {"timezone": "Asia/Shanghai"})
        print("正常调用 is_error =", ok.is_error, "|", first_text(ok)[:120])

        bad = await client.call_tool("get_current_time", {"timezone": "Mars/Olympus"})
        print("错误调用 is_error =", bad.is_error, "|", first_text(bad)[:120])


if __name__ == "__main__":
    anyio.run(main)
```

`first_text` 这个小函数不能省。`content` 里每一项可能是文本、图片、音频、资源链接等好几种类型,直接写 `ok.content[0].text` 能跑,但编辑器会报 8 条「`ImageContent` 没有 `text` 属性」的红线。先用 `isinstance` 确认是 `TextContent` 再读,和 TS 里用类型守卫收窄联合类型是一回事。`tool.description` 也可能是 `None`,所以写成 `(tool.description or '')[:60]`。

```bash
uv run python w4/peek_time_server.py
```

第一次跑会慢几秒,`uvx` 要先下载 `mcp-server-time`。

我在 2026-10-21 跑的输出(时间以你实际为准):

```text
协议版本: 2026-07-28
- get_current_time: Get current time in a specific timezone
  参数: ['timezone']
- convert_time: Convert time between timezones
  参数: ['source_timezone', 'time', 'target_timezone']
正常调用 is_error = False | {
  "timezone": "Asia/Shanghai",
  "datetime": "2026-10-21T17:50:52+08:00",
  "day_of_week": "Wednesday",
  "is_dst": fa
错误调用 is_error = True | Error executing tool get_current_time: Invalid timezone: 'No time zone found with key Mars/Olympus'
```

`"is_dst": fa` 被截断是因为代码里 `[:120]` 只取了前 120 个字符,不是出错。stderr 里还会多一行 `Tool 'get_current_time' failed: ...`,那是 server 自己打的日志,stdio 模式下 server 的 stderr 会直接显示在你的终端里,stdout 才是协议通道。

协议版本:官方 Time server 已经升级到 2.x SDK,所以双方直接谈成了最新的 `2026-07-28`。如果你碰到还在 1.x SDK 上的老 server,会看到版本退回 `2025-11-25`,终端里还会刷一大段 `WARNING:root:Failed to validate request ... server/discover`:你的 2.x Client 先发新式的 `server/discover`,老 server 不认识,于是自动退回老的 initialize 握手。这段警告不影响使用,新旧版本混用在 2026 年下半年很常见,知道它是怎么来的能省一次排查。

**`peek_time_server.py` 逐行讲解。** 下面的值都是 2026-10-21 实际打印出来的。

**导入**

```python
import anyio
```
异步运行库。它在 asyncio 之上包了一层统一接口,MCP 的 Python SDK 内部就是用它写的,所以这里也用它来启动。用法上你可以把 `anyio.run(main)` 当成 `asyncio.run(main())`。

```python
from mcp import Client, StdioServerParameters
```
`Client` 是 MCP 客户端,负责握手、发请求、收响应。`StdioServerParameters` 描述「怎么启动一个 stdio 模式的 server」。

```python
from mcp.types import CallToolResult, TextContent
```
两个类型:`CallToolResult` 是 `tools/call` 的返回结果;`TextContent` 是结果里「文本」那一种内容块。导入它们是为了下面做类型标注和类型收窄。

**描述 server 怎么启动**

```python
server = StdioServerParameters(command="uvx", args=["mcp-server-time"])
```
这一行**还没有启动任何东西**,只是一份启动说明。打印出来是:

```text
command='uvx' args=['mcp-server-time'] env=None cwd=None encoding='utf-8' ...
```

意思是:等会儿用子进程执行 `uvx mcp-server-time`,环境变量和工作目录都沿用当前的。stdio 模式下,client 往子进程的 stdin 写 JSON-RPC 请求,从它的 stdout 读响应,每条消息一行。

**`first_text`**

```python
def first_text(result: CallToolResult) -> str:
    block = result.content[0]
```
`content` 是一个列表,每一项是一个内容块。时间工具只返回一块,所以取 `[0]`。真实数据里 `block` 是一个 `TextContent`,它的 `type` 是 `"text"`。

```python
    return block.text if isinstance(block, TextContent) else f"<{block.type}>"
```
`A if 条件 else B` 是 Python 的条件表达式,相当于 TS 的 `条件 ? A : B`。是文本块就返回 `.text`;是别的类型(图片、音频……)就返回 `<image>` 这样的占位。`isinstance` 之后,编辑器就知道这个分支里的 `block` 一定是 `TextContent`,所以 `.text` 不报红,和 TS 里 `if (block.type === "text")` 收窄联合类型一样。

**`main`**

```python
async def main() -> None:
    async with Client(server) as client:
```
`async with` 是异步版的上下文管理器,进入和退出时各做一件事:

- 进入时:按 `server` 的说明启动子进程 `uvx mcp-server-time`,然后完成握手(双方交换协议版本和各自支持的能力)。
- 退出时(包括中途报错):关闭连接,结束子进程。

相当于 TS 里的 `await using client = ...`,或者手写 `try { ... } finally { await client.close() }`。不用担心子进程留在后台。

```python
        print("协议版本:", client.protocol_version)
```
握手时双方谈好的协议版本,打印 `协议版本: 2026-07-28`。

```python
        listing = await client.list_tools()
```
发一个 JSON-RPC 请求,`method` 是 `"tools/list"`。返回 `ListToolsResult`,它的 `.tools` 是 2 个 `Tool` 对象的列表。

```python
        for tool in listing.tools:
            print(f"- {tool.name}: {(tool.description or '')[:60]}")
```
第一圈:`tool.name` 是 `"get_current_time"`,`tool.description` 是 `"Get current time in a specific timezone"`。协议里 description 是可选的,可能是 `None`,所以先用 `or ''` 换成空串,再用 `[:60]` 截前 60 个字符。打印 `- get_current_time: Get current time in a specific timezone`。

```python
            print("  参数:", list(tool.input_schema.get("properties", {}).keys()))
```
`input_schema` 就是工具参数的 JSON Schema,和 Day 8 给 OpenAI 写的 `parameters` 是同一种东西。真实值:

```python
{"type": "object",
 "properties": {"timezone": {"type": "string", "title": "Timezone",
                             "description": "IANA timezone name (e.g., 'America/New_York', ...)"}},
 "required": ["timezone"],
 "title": "get_current_timeArguments"}
```

`.get("properties", {})` 取出 `properties` 这个 dict(没有就给空 dict);`.keys()` 得到 `dict_keys(['timezone'])`;`list(...)` 转成普通列表 `['timezone']`。第二圈的 `convert_time` 同理,打印 `['source_timezone', 'time', 'target_timezone']`。

```python
        ok = await client.call_tool("get_current_time", {"timezone": "Asia/Shanghai"})
```
发一个 `tools/call` 请求。线上实际传的 JSON 是:

```json
{"jsonrpc": "2.0", "id": 2, "method": "tools/call",
 "params": {"name": "get_current_time", "arguments": {"timezone": "Asia/Shanghai"}}}
```

`id` 是请求编号,每发一个请求递增一次,你在 Inspector 里看到的数字可能不一样,响应会带着同一个 `id` 回来,client 靠它把响应和请求对上。

返回的 `ok` 是 `CallToolResult`,三个字段的真实值:

| 字段 | 值 |
| --- | --- |
| `ok.content` | 1 个 `TextContent`,`text` 是 `'{\n  "timezone": "Asia/Shanghai",\n  "datetime": "2026-10-21T19:16:22+08:00", ...}'`(一段 JSON **字符串**) |
| `ok.structured_content` | `{'timezone': 'Asia/Shanghai', 'datetime': '2026-10-21T19:16:22+08:00', 'day_of_week': 'Wednesday', 'is_dst': False}`(已经是 **dict**) |
| `ok.is_error` | `False` |

同一份数据给了两种形式:`content` 是给模型看的文本,`structured_content` 是给程序直接用的结构化数据。协议里的字段名是驼峰的 `structuredContent`、`isError`,Python SDK 转成了蛇形的 `structured_content`、`is_error`。

```python
        print("正常调用 is_error =", ok.is_error, "|", first_text(ok)[:120])
```
`first_text(ok)` 取出那段 JSON 文本,`[:120]` 只要前 120 个字符,所以输出最后停在 `"is_dst": fa`。

```python
        bad = await client.call_tool("get_current_time", {"timezone": "Mars/Olympus"})
        print("错误调用 is_error =", bad.is_error, "|", first_text(bad)[:120])
```
火星时区不存在。真实值:`bad.is_error` 是 `True`,`bad.structured_content` 是 `None`,`content` 里有 1 个文本块:`Error executing tool get_current_time: Invalid timezone: ...`。

注意这里**没有抛异常**,`call_tool` 正常返回了。原因是:请求本身没毛病(方法名对、工具存在、参数格式对),工具也确实执行了,只是业务上失败了。这种错误用 `isError: true` 放在正常结果里,模型能读到错误信息,下一轮自己换个时区重试。只有协议层面的问题(方法名不存在、请求格式不对)才返回 JSON-RPC error,SDK 会把它变成异常抛出来。

**入口**

```python
if __name__ == "__main__":
    anyio.run(main)
```
注意传的是 `main`(函数本身),不是 `main()`:`anyio.run` 要的是一个函数,它自己去调用。写成 `asyncio.run` 的话则要传 `main()`,两者的习惯不一样。

另外注意 content 和 structured_content 的区别:返回一个列表的工具,content 里是每个元素一条文本,structured_content 是整个列表包在 `result` 键下面。明天写桥接代码时会用到这个细节。

**第三步:把同一个 server 接进一个现成 host。** 如果你装了 Claude Code:

```bash
claude mcp add time -- uvx mcp-server-time
```

练完不想留着可以 `claude mcp remove time`。

进入 Claude Code 后输入 `/mcp`,能看到 time 已连接。然后直接问它「东京现在几点」,观察它调用了哪个工具。用 Cursor 的同学,在项目根目录建 `.cursor/mcp.json`,写 `{"mcpServers": {"time": {"command": "uvx", "args": ["mcp-server-time"]}}}`,重启后在设置里能看到。

**验收标准**:你的笔记里有一段完整的 `tools/call` 请求和响应 JSON,能指着它说出 `content`、`structuredContent`、`isError` 各是干什么的;Python 脚本跑通,打印出两种调用结果;能用一句话向别人解释为什么错误时区返回的是 `isError` 而不是 JSON-RPC error。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| MCP(Model Context Protocol) | 模型上下文协议。规定 AI 应用如何发现和调用外部工具、读取外部数据的开放标准,2024 年 11 月由 Anthropic 发布,2025 年 12 月交给 Linux 基金会旗下的 Agentic AI Foundation |
| Host | 用户直接使用的 AI 应用,如 Claude Desktop、Cursor、你自己的 Agent |
| Client | host 内部负责和某一个 server 通信的组件,与 server 一对一 |
| Server | 把外部系统能力按 MCP 格式暴露出来的程序,不直接和模型对话 |
| Tools | 由模型决定调用的函数,可以有副作用 |
| Resources | 由应用决定加载的只读数据,用 URI 标识 |
| Prompts | 由用户选择使用的提示词模板 |
| JSON-RPC 2.0 | MCP 使用的消息格式,请求含 method/params/id,响应含 result 或 error |
| stdio 传输 | host 把 server 作为子进程启动,通过标准输入输出交换消息 |
| Streamable HTTP | 基于 HTTP POST + 可选 SSE 流的传输方式,用于远程部署 |
| capabilities | 双方声明自己支持哪些功能,client 只请求 server 声明过的能力 |
| isError | 工具执行失败的标记,失败信息作为正常结果返回给模型 |
| MCP Inspector | 官方调试工具,可视化地连接 server、列工具、调用、看原始消息 |
| A2A | Agent2Agent 协议,解决 Agent 之间的协作,和 MCP 是互补关系 |

## 常见误区

**MCP 取代了 function calling。** 不对。模型仍然通过 function calling 表达「我要调用工具」,MCP 只负责 host 和工具之间的那一段。没有 function calling 能力的模型,接了 MCP 也不会用工具。

**写 MCP server 要自己处理 JSON-RPC。** 用官方 SDK 的话,你写的就是普通 Python 函数加一个装饰器,协议、握手、Schema 生成全由 SDK 做。只有极少数场景(比如写网关、代理)才需要碰底层。

**在 stdio server 里用 print 调试。** stdout 是通信线路,print 的内容会被当成协议消息,host 解析失败就断开连接,而且报错信息往往莫名其妙,比如 Claude Desktop 只显示「server disconnected」。调试信息一律用 `logging` 写到 stderr。

**照着 2025 年的教程写 `from mcp.server.fastmcp import FastMCP`。** 这在 Python SDK 2.x 里已经删掉了,会直接 ImportError。2.x 的写法是 `from mcp.server import MCPServer`。看教程先看日期和 SDK 版本。

**工具失败时 return 一个错误字符串。** 这样 `isError` 是 false,模型和 host 都以为调用成功了,会把错误信息当成正常结果来用。失败要 raise(SDK 里用 `ToolError`),让协议层面标记失败。

**什么都包成 MCP 才显得专业。** 只给一个 Agent 用、同进程的工具,直接写函数更简单、更快、更好调试。MCP 的价值在跨应用复用和跨团队对接。

## 学习资料

### 文档与文章

- [MCP 官方文档 · Introduction](https://modelcontextprotocol.io/docs/getting-started/intro):从这里进,架构概念那几页(Architecture、Server concepts、Client concepts)今天全部读完,大约 40 分钟。
- [MCP 规范 2026-07-28 版](https://modelcontextprotocol.io/specification/2026-07-28):不用通读,看目录知道有哪些部分,重点扫一眼 Base Protocol 和 Server Features 下 Tools 那一节。和上一版 [2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25) 对照着看变化。
- [Anthropic · Introducing the Model Context Protocol](https://www.anthropic.com/news/model-context-protocol):2024 年 11 月的发布文,5 分钟,知道它最初想解决什么。
- [MCP Python SDK 文档 · What's new in v2](https://py.sdk.modelcontextprotocol.io/whats-new/):SDK 2.x 的改动总览,看完你就知道老教程哪些写法不能抄了,20 分钟。
- [MCP Registry](https://registry.modelcontextprotocol.io):官方的 server 注册表,随便翻翻,看看大家都在给什么系统写 server。
- [A2A 协议官网](https://a2a-protocol.org/latest/):只看首页的定位说明,知道它和 MCP 的分工。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1uronYREWR&autoplay=0&high_quality=1" title="MCP终极指南 - 从原理到实战,带你深入掌握MCP(基础篇)" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>马克的技术工作坊 · MCP终极指南 - 从原理到实战,带你深入掌握MCP(基础篇) · 27 分钟,全看。他用抓包的方式把 host、server、模型之间的消息一条条摆出来,和今天讲的 JSON-RPC 部分正好对上。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1eK5DzHEWu&autoplay=0&high_quality=1" title="MCP实战指南,mcp视频教程,2小时学透mcp" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>尚硅谷 · MCP实战指南,mcp视频教程,2小时学透mcp · 21 集,今天看前面讲概念的几集即可,写 server 的部分留到明天。注意它录于 2025 年,代码是 SDK 1.x 的 FastMCP 写法。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/CQywdSdi5iA" title="The Model Context Protocol (MCP)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Anthropic · The Model Context Protocol (MCP) · 约 20 分钟,协议作者团队自己讲设计动机,重点听他们为什么把 tools、resources、prompts 按「谁控制」来划分。</figcaption>
</figure>

- KodeKloud《Model Context Protocol (MCP) Explained for Beginners》(YouTube,24 分钟):用订机票的例子讲一遍完整流程,英文入门讲得最清楚的之一,按标题搜索。
- DeepLearning.AI 短课 [MCP: Build Rich-Context AI Apps with Anthropic](https://www.deeplearning.ai/short-courses/mcp-build-rich-context-ai-apps-with-anthropic/):免费,约 1.5 小时,今天先看前两节概念课,写代码的部分明天配合着看。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025)第 6 章「RAG and Agents」的 Agents 部分:书里没有专门讲 MCP(写作时 MCP 刚出),但它对「工具让模型能做什么、工具多了会出什么问题」的分析是理解 MCP 价值的背景,1 小时。
- 黄佳《大模型应用开发 动手做AI Agent》(人民邮电出版社·异步图书, 2024):讲 function calling 和 Agent 工具调用的章节可以作为中文对照,但它出版早于 MCP 普及,今天这组只算补充。

### 开源项目与代码

- [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers):官方参考 server。今天打开 `src/time` 读一遍源码,不到 200 行,能看到一个真实 server 的完整结构。
- [modelcontextprotocol/inspector](https://github.com/modelcontextprotocol/inspector):Inspector 的仓库,README 里有命令行模式的用法,可以不开浏览器直接调工具。
- [modelcontextprotocol/python-sdk](https://github.com/modelcontextprotocol/python-sdk):明天要用的 SDK,先 star,看一眼 README 的 quickstart。

## 自测

1. 你在 Claude Code 里配了 3 个 MCP server。这时 host、client、server 各有几个?

<details><summary>答案</summary>

host 1 个(Claude Code 本身),client 3 个(每个 server 对应一个),server 3 个。client 和 server 是一对一的。

</details>

2. 一个 server 同时提供了「查询发票」工具和「退款政策」资源。模型在回答「年付能退吗」时,政策文本是怎么进入上下文的?和发票数据进入上下文的方式有什么不同?

<details><summary>答案</summary>

资源由应用控制:host 根据自己的逻辑(或者用户手动附加)读取 `cloudledger://policy/refund`,把文本放进上下文,模型并没有「决定」去读它。发票数据走工具:模型看了工具描述后自己决定调用 `list_invoices`,host 执行后把结果作为 tool 消息回传。一个是应用塞给模型,一个是模型主动要。如果你希望模型能自己决定要不要看政策,就把政策也做成一个工具。

</details>

3. 下面这段 server 代码在 Claude Desktop 里一连上就断开,日志里只有「Server disconnected」。最可能是什么原因?

```python
print("CloudLedger server starting...")
mcp = MCPServer("cloudledger")
```

<details><summary>答案</summary>

stdio 传输下 stdout 就是 JSON-RPC 通信线路。启动时 print 的这行文字被 host 当成协议消息解析,解析失败,连接断开。改成 `logging.info(...)`,默认输出到 stderr。

</details>

4. 工具 `get_current_time` 收到一个不存在的时区。server 应该返回 JSON-RPC 的 `error`,还是返回 `isError: true` 的 result?为什么?

<details><summary>答案</summary>

返回 `isError: true` 的 result,错误描述放在 content 里。参数是模型选的,错误信息应该让模型读到,它才能换个合法时区重试。JSON-RPC error 是给 host 程序看的,模型读不到,适合「方法不存在」「请求格式错误」这类协议层面的问题。

</details>

5. 你要把 CloudLedger 的查询工具同时提供给公司内 20 个运营同学在 Claude Desktop 里用,以及部署在服务器上的客服 Agent 用。分别选什么传输?

<details><summary>答案</summary>

部署在服务器上给多人和远程 Agent 用,选 Streamable HTTP,一个服务大家连,方便做鉴权、日志和统一升级。如果让 20 个人每人本机跑一份 stdio server,就要每人装依赖、配数据库连接,还要分发数据库凭证,既麻烦又不安全。stdio 适合开发调试和个人本机工具。

</details>

6. **面试题**:「既然模型已经支持 function calling 了,为什么还需要 MCP?」请用一分钟回答。

<details><summary>答案</summary>

参考要点:function calling 解决的是模型怎么表达「我要调用某个工具」,是模型和应用之间的约定;MCP 解决的是应用怎么发现、连接、执行外部工具,是应用和工具之间的约定。没有 MCP 时,每个应用都要为每个系统写一套工具定义和执行代码,M 个应用 N 个系统就是 M×N 份;有了 MCP,每个系统写一个 server,每个应用实现一个 client,变成 M+N,而且同一个 server 能直接用在 Claude Code、Cursor 这类现成工具里。两者是配合关系:host 用 MCP 拿到工具列表,转成 function calling 的 tools 参数给模型,模型选中后 host 再用 MCP 去执行。最后可以补一句取舍:只给单个 Agent 用的同进程工具,不必上 MCP。

</details>

## 明天预告

Day 23 · 动手写 MCP server:把 CloudLedger 业务库包成工具。我们会先用一个造数脚本生成云簿的客户、订阅、发票、工单四张表,然后用 Python SDK 2.x 写出带参数校验、错误提示和权限标注的 server,在 Inspector 里调通,接进 Claude Code,最后写一段 30 行左右的桥接代码,把 MCP 工具接到你 Day 9 的 Agent 循环里。今天在 Inspector 里看到的每一条消息,明天都会从你自己的代码里发出去。
