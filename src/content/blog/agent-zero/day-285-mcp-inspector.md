---
title: 'Day 285 · 写 MCP server(六):在 Inspector 里调试'
description: '用官方 MCP Inspector 2.10.1 调试 CloudLedger server:浏览器界面里调工具、读 resource、取 prompt,右边看每一条 JSON-RPC 消息和 server 的 stderr;再用它的 CLI 模式把这些点击变成命令和退出码,写一个冒烟测试脚本。'
pubDate: 2026-10-22
regime: none
tags: ['mcp', 'mcp-inspector', 'debugging', 'cloudledger', 'agent-zero']
series: 'agent-zero'
day: 285
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 284](/blog/agent-zero/day-284-mcp-resource-prompt/) 给 CloudLedger server 补上了 resource(`cloudledger://policy/refund` 退款政策)和 prompt(`reply_ticket` 工单模板),拼出了完整的 `cloudledger/server.py`:四个工具、一个 resource、一个 prompt。为了看 server 的反应,我们写了三四个 peek 脚本,每换一个参数就要改代码重跑;还撞到好几次客户端只显示 `Internal server error`、真正原因藏在终端上方 stderr 里的情况。

今天换一个专门干这事的工具:MCP Inspector。它对 MCP server 的作用,相当于 DevTools 的 Network 面板加 Postman 对 HTTP 接口的作用。

## 今天要解决的问题

学完今天,你要能做到:

1. 用固定版本的 Inspector 拉起 CloudLedger server,在浏览器里调工具、读 resource、取 prompt。
2. 出错时知道去哪看:Results 里是模型能看到的,Protocol 面板是线上传的 JSON-RPC 消息,Console 面板是 server 的 stderr。
3. 用 Inspector 的 CLI 模式把一次点击写成一条命令,看懂它的退出码,写一个能反复跑的冒烟测试脚本。

预计用时 2 小时。不调模型,花费 ¥0。

前置:[Day 284](/blog/agent-zero/day-284-mcp-resource-prompt/) 的 `cloudledger/server.py`、[Day 280](/blog/agent-zero/day-280-mcp-seed/) 的 `cloudledger/seed.py`;[Day 275](/blog/agent-zero/day-275-json-rpc/) 的 JSON-RPC 请求、响应和错误;[Day 276](/blog/agent-zero/day-276-mcp-transports/) 的 stdio(stdout 是通信线路,stderr 是日志);[Day 277](/blog/agent-zero/day-277-mcp-spec-2026/) 讲的 2026-07-28 版规范去掉握手、改用 `server/discover`。另外需要 Node.js,你做前端肯定装了。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

## Inspector 是什么

Inspector 是 MCP 官方出的调试工具,本身就是一个 MCP **client**(Day 273 讲的三个角色里的那个 client),只是背后没有模型,按钮由你来点。它把 server 当子进程拉起来,你点「调用工具」,它就发一条 `tools/call`;server 回什么,它原样摆给你看。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="MCP Inspector 的结构:浏览器里的界面连到本机 6274 端口的 Inspector 后端,后端用 stdio 拉起 server 子进程,stdout 走 JSON-RPC,stderr 进 Console 面板">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="40" width="170" height="150" rx="6" fill="none" stroke="var(--rule)"/>
<text x="105" y="62" fill="var(--ink)" text-anchor="middle">浏览器</text>
<text x="105" y="86" fill="var(--ink-soft)" text-anchor="middle" font-size="11">Tools / Prompts /</text>
<text x="105" y="102" fill="var(--ink-soft)" text-anchor="middle" font-size="11">Resources 标签</text>
<text x="105" y="130" fill="var(--ink-soft)" text-anchor="middle" font-size="11">Protocol 面板</text>
<text x="105" y="152" fill="var(--ink-soft)" text-anchor="middle" font-size="11">Console 面板</text>
<rect x="235" y="40" width="170" height="150" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="62" fill="var(--ink)" text-anchor="middle">Inspector 后端</text>
<text x="320" y="86" fill="var(--ink-soft)" text-anchor="middle" font-size="11">Node 进程</text>
<text x="320" y="102" fill="var(--ink-soft)" text-anchor="middle" font-size="11">127.0.0.1:6274</text>
<text x="320" y="130" fill="var(--ink-soft)" text-anchor="middle" font-size="11">= MCP client</text>
<text x="320" y="152" fill="var(--ink-soft)" text-anchor="middle" font-size="11">带一次性 token</text>
<rect x="450" y="40" width="170" height="150" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="535" y="62" fill="var(--ink)" text-anchor="middle">你的 server</text>
<text x="535" y="86" fill="var(--ink-soft)" text-anchor="middle" font-size="11">uv run python</text>
<text x="535" y="102" fill="var(--ink-soft)" text-anchor="middle" font-size="11">cloudledger/server.py</text>
<text x="535" y="130" fill="var(--ink-soft)" text-anchor="middle" font-size="11">子进程</text>
<line x1="190" y1="115" x2="235" y2="115" stroke="var(--ink-soft)"/>
<text x="212" y="108" fill="var(--ink-faint)" text-anchor="middle" font-size="11">HTTP</text>
<line x1="405" y1="95" x2="450" y2="95" stroke="var(--mem)"/>
<text x="428" y="88" fill="var(--ink-faint)" text-anchor="middle" font-size="11">stdin</text>
<line x1="405" y1="125" x2="450" y2="125" stroke="var(--mem)"/>
<text x="428" y="142" fill="var(--ink-faint)" text-anchor="middle" font-size="11">stdout</text>
<line x1="535" y1="190" x2="535" y2="222" stroke="var(--compute)"/>
<line x1="535" y1="222" x2="105" y2="222" stroke="var(--compute)" stroke-dasharray="4 3"/>
<line x1="105" y1="222" x2="105" y2="190" stroke="var(--compute)" stroke-dasharray="4 3"/>
<text x="320" y="240" fill="var(--ink-soft)" text-anchor="middle" font-size="11">stderr(日志、traceback)→ Console 面板</text>
</g>
</svg>
<figcaption>server 还是那个 stdio server,一行没改。Inspector 后端替你当 client,stdout 上的 JSON-RPC 显示在 Protocol 面板,stderr 显示在 Console 面板。</figcaption>
</figure>

为什么不继续写 peek 脚本?peek 脚本适合固定的检查,Inspector 适合「我也不知道哪儿错了,先点点看」的阶段。两样都要会,今天后半段的 CLI 模式就是把点点看的结果固化成脚本。

## 版本先说清楚

2026 年 10 月查 npm,Inspector 最新是 2.12.0(10 月 21 日发布),这门课固定用 **2.10.1**(10 月 8 日发布,已经发布满两周)。2.x 是 2026 年 7 月 28 日跟着新版规范一起发的大版本,界面和命令行参数和 1.x、0.x 都不一样。B 站和网上 2025 年的 Inspector 教程大多是 0.x 的界面,左边一列连接设置、中间一排标签,和你今天看到的不一样,别对着找按钮。

2.x 要求 Node **22.19.0 或更高**。先查一下:

```bash
node -v
```

我这台机器是 `v24.22.0`。低于 22.19 的话,用 nvm 装一个 `nvm install 22`。

还有一个省事的入口是 Python SDK 自带的 `uv run mcp dev cloudledger/server.py`,它内部就是调 `npx @modelcontextprotocol/inspector`,但**不带版本号**,每次都拉最新版,而且会换成 `mcp run` 的方式启动 server。今天直接用 npx 并写死版本,看到的界面和下文一致。

## 第一步:把 Inspector 开起来

在 `agent-zero-lab/` 根目录跑。先重置一下业务库,因为待会儿要在 Inspector 里提交退款申请:

```bash
cd agent-zero-lab
uv run python cloudledger/seed.py
npx -y @modelcontextprotocol/inspector@2.10.1 \
  uv run python cloudledger/server.py
```

<div class="line-notes">

- `uv run python cloudledger/seed.py` 删库重建,随机种子固定,每次数据一样。Inspector 里调写工具会真的写这个库,调试前后都建议重置一次。
- `npx -y @modelcontextprotocol/inspector@2.10.1` `npx` 是 npm 自带的「临时下载一个包并运行它的命令」,和你跑 `npx create-vite` 是同一个东西;`-y` 跳过「要不要安装」的确认。包名后面的 `@2.10.1` 是版本号,不写就是 latest,哪天官方发了新版,你的界面就变了。行尾的 `\` 表示命令没完、下一行接着写,和写在一行效果一样。
- `uv run python cloudledger/server.py` 包名后面的所有参数,Inspector 原样当成「启动 server 的命令」。它会在**当前目录**执行这条命令,所以必须站在 `agent-zero-lab/` 里,`uv run` 才找得到项目和 `.venv`,相对路径 `cloudledger/server.py` 才对得上。

</div>

第一次运行要先下载,我这里花了 1 分钟出头。启动后终端打印(token 每次不一样):

```text
Starting MCP inspector...

MCP Inspector Web is up and running at:
   http://127.0.0.1:6274?MCP_INSPECTOR_API_TOKEN=f1aefcf72fe51b085b533e51d13abb309cffac250e30f99ced09df7e230cbca5

   Sandbox (MCP Apps): http://127.0.0.1:6275/sandbox

   Auth token: f1aefcf72fe51b085b533e51d13abb309cffac250e30f99ced09df7e230cbca5

   Secrets: OS keychain
```

浏览器一般会自动打开;没打开就复制第一行那个**带 token 的完整网址**。这个 token 是一次性的访问口令,防止本机别的网页偷偷调用你的 Inspector 后端(它能启动任意命令,被滥用很危险),所以只输 `http://127.0.0.1:6274` 是进不去的。`Sandbox (MCP Apps)` 是给 MCP Apps(server 自带交互界面)用的,今天用不到。`Secrets: OS keychain` 表示 OAuth 令牌之类的东西存在 macOS 钥匙串里,今天也用不到。

## 第二步:界面走一遍

页面打开先是 **Servers** 页,顶部一块灰底提示「Read-only session」:因为我们是在命令行里直接给了 server 命令(官方叫 ad-hoc,临时指定),这份服务器列表不会被保存。下面一张卡片,标题是 `uv`(取的是命令名),写着 `STDIO`、`Disconnected` 和一个开关。

点那个开关。变绿、显示 `Connected`,卡片右边出现 `MCP 2025-11-25`;页面顶部多出 **Tools、Prompts、Resources** 三个标签,右边栏出现 **Protocol / Console** 两个面板。整体布局画出来是这样:

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="Inspector 2.10.1 界面布局:顶部四个标签 Servers Tools Prompts Resources;左栏是工具列表,中栏是参数表单和 Results,右栏是 Protocol 消息历史和 Console 面板">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="11">
<rect x="10" y="10" width="620" height="34" rx="4" fill="none" stroke="var(--rule)"/>
<text x="24" y="32" fill="var(--ink)">cloudledger</text>
<rect x="200" y="17" width="250" height="20" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="325" y="31" fill="var(--ink)" text-anchor="middle">Servers  Tools  Prompts  Resources</text>
<text x="560" y="32" fill="var(--ink-soft)">● 已连接</text>
<rect x="10" y="54" width="150" height="236" rx="4" fill="none" stroke="var(--rule)"/>
<text x="22" y="74" fill="var(--ink)">Tools</text>
<text x="22" y="98" fill="var(--ink-soft)">find_customer</text>
<text x="22" y="118" fill="var(--ink-soft)">get_subscription</text>
<rect x="16" y="126" width="138" height="20" rx="3" fill="var(--mem-wash)"/>
<text x="22" y="140" fill="var(--ink)">list_invoices</text>
<text x="22" y="162" fill="var(--ink-soft)">create_refund_req…</text>
<rect x="170" y="54" width="250" height="236" rx="4" fill="none" stroke="var(--rule)"/>
<text x="182" y="74" fill="var(--ink)">list_invoices  [READ-ONLY]</text>
<text x="182" y="94" fill="var(--ink-faint)">description(docstring)</text>
<text x="182" y="118" fill="var(--ink-soft)">Customer Id *  [C007    ]</text>
<text x="182" y="140" fill="var(--ink-soft)">Status         [▾       ]</text>
<text x="182" y="162" fill="var(--ink-soft)">Limit          [6       ]</text>
<rect x="182" y="174" width="90" height="22" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="227" y="189" fill="var(--ink)" text-anchor="middle">Execute Tool</text>
<text x="182" y="220" fill="var(--ink)">点了之后表单换成 Results:</text>
<text x="182" y="240" fill="var(--ink-soft)">content / Structured Output</text>
<text x="182" y="260" fill="var(--ink-soft)">或红色 Tool Error</text>
<rect x="430" y="54" width="200" height="236" rx="4" fill="none" stroke="var(--rule)"/>
<text x="442" y="74" fill="var(--ink)">Protocol | Console</text>
<text x="442" y="98" fill="var(--ink-soft)">TOOLS/CALL   OK 66ms</text>
<text x="442" y="118" fill="var(--ink-soft)">RESOURCES/TEMPLATES/LIST</text>
<text x="442" y="138" fill="var(--ink-soft)">PROMPTS/LIST</text>
<text x="442" y="158" fill="var(--ink-soft)">TOOLS/LIST</text>
<text x="442" y="178" fill="var(--ink-soft)">RESOURCES/LIST</text>
<text x="442" y="198" fill="var(--ink-soft)">NOTIFICATIONS/INITIALIZED</text>
<text x="442" y="218" fill="var(--ink-soft)">INITIALIZE</text>
<text x="442" y="250" fill="var(--ink-faint)">每条可展开看请求/响应</text>
<text x="442" y="268" fill="var(--ink-faint)">可 Replay / Edit and replay</text>
</g>
</svg>
<figcaption>照着 2.10.1 实际界面画的示意图。左边选,中间填参数和看结果,右边看线上传了什么。消息历史默认最新的在最上面。</figcaption>
</figure>

先看右边的 **Protocol** 面板,一连上就有六条消息(最新的在上,我按时间顺序重排一下):

```text
INITIALIZE                  1402ms  OK
NOTIFICATIONS/INITIALIZED
RESOURCES/LIST               193ms  OK
TOOLS/LIST                   250ms  OK
PROMPTS/LIST                 344ms  OK
RESOURCES/TEMPLATES/LIST     403ms  OK
```

面板标题旁有个 `LEGACY` 标记,卡片上写着 `MCP 2025-11-25`。Day 277 讲过,2026-07-28 版规范去掉了 `initialize` 握手,可这里明明有握手。原因是 2.10.1 对命令行临时指定的 server **默认用老的协议版本**(它的帮助里写着 `--protocol-era ... default legacy`),这样连老 server 也不会出问题。练习 4 会让你切到新版本看区别。

每条消息都能展开,看到完整的请求参数和响应 JSON。`TOOLS/LIST` 的响应有 244 行,就是四个工具的 name、description、inputSchema、outputSchema、annotations,Day 281 讲的「函数名变工具名、docstring 变描述、类型标注变 schema」在这里能一条条核对。

**调一个只读工具。** 点顶部 **Tools**,左栏列出四个工具。点 `list_invoices`,中栏出现绿色的 `READ-ONLY` 标签(来自 `read_only_hint=True`)、docstring,以及三个表单项:`Customer Id *`(星号表示必填,下面小字是参数的 description「客户编号,如 C007」)、`Status`(下拉框,选项就是 `Literal` 的四个值)、`Limit`(默认填好了 6)。表单是 Inspector 根据 inputSchema 自动生成的,你写的约束一样不少。右上角还有个 `Edit as JSON` 开关,打开就能直接写参数 JSON。

`Customer Id` 填 `C007`,点 **Execute Tool**。中栏换成 **Results**,上面是 `content` 里的五段文本,下面是 **Structured Output**:

```json
{
  "result": [
    {"id": "INV-2026-0123", "amount_cents": 239200, "status": "paid", "issued_at": "2026-10-08", "paid_at": "2026-10-08", "amount_yuan": "2392.00"},
    {"id": "INV-2026-0026", "amount_cents": 239200, "status": "paid", "issued_at": "2026-10-08", "paid_at": "2026-10-08", "amount_yuan": "2392.00"},
    {"id": "INV-2026-0027", "amount_cents": 239200, "status": "paid", "issued_at": "2026-09-07", "paid_at": "2026-09-07", "amount_yuan": "2392.00"},
    {"id": "INV-2026-0028", "amount_cents": 239200, "status": "paid", "issued_at": "2026-08-08", "paid_at": "2026-08-10", "amount_yuan": "2392.00"},
    {"id": "INV-2026-0029", "amount_cents": 239200, "status": "paid", "issued_at": "2026-07-09", "paid_at": "2026-07-11", "amount_yuan": "2392.00"}
  ]
}
```

(界面里是展开的多行,我压成每张发票一行。)C007 一共 5 张发票,`limit` 是 6,所以全出来了;10 月 8 日两张 2392 元,就是 seed.py 故意造的重复扣款。同时 Protocol 面板最上面多了一条 `TOOLS/CALL list_inv… 66ms OK`。

**故意传错参数。** 点 `get_subscription`,`Customer Id` 填 `7`,执行。Results 变成红底的 **Tool Error**:

```text
Error executing tool get_subscription: 1 validation error for get_subscriptionArguments customer_id String should match pattern '^C\d{3}$' [type=string_pattern_mismatch, input_value='7', input_type=str] For further information visit https://errors.pydantic.dev/2.14/v/string_pattern_mismatch
```

注意看 Protocol 面板:这条 `TOOLS/CALL` 后面写的是 **OK**。这不是 Inspector 的 bug,正是 [Day 282](/blog/agent-zero/day-282-mcp-errors/) 讲的那件事:工具出错时,JSON-RPC 层面这次请求是成功的,server 正常回了一个结果,只是结果里 `isError: true`。模型就是靠读这段错误文字自我纠正的。Protocol 面板管的是「信封有没有送到」,Results 管的是「信里写了什么」。

**提交退款申请两次。** 点 `create_refund_request`,填 `Invoice Id` 为 `INV-2026-0123`、`Amount Yuan` 为 `2392`、`Reason` 为 `同日重复扣款,与 INV-2026-0026 重复`,执行。第一次返回:

```json
{
  "refund_request_id": 1,
  "status": "pending_approval",
  "amount_yuan": "2392.00"
}
```

点结果面板左上角的 ✕(Close results)关掉结果,表单会回来,刚填的值还在。参数不变再执行一次,这次是 Tool Error:

```text
Error executing tool create_refund_request: 最多还能申请 0.00 元(发票 2392.00 元,已申请 2392.00 元)。
```

Day 283 设计的额度校验挡住了重复提交。Protocol 面板里每条历史消息右边有 **Replay** 和 **Edit and replay** 两个按钮,前者原样重发,后者先让你改参数再发,反复试同一个调用时比回去填表快。

**读 resource,取 prompt。** 点 **Resources**,左栏分成 `URIs (1)` 和 `Templates (0)` 两组,和 Day 284 练习 2 发现的「模板单独一个列表」对得上。点 `refund_policy`,右边显示地址 `cloudledger://policy/refund`、四条政策原文、`text/plain` 和一个 **Refresh** 按钮。点 **Prompts**,选 `reply_ticket`,`Arguments` 下面有个必填的 `ticket_id *`,填 `T1041`,点 **Get Prompt**,得到:

```text
Messages
[0] role: user
你是云簿的客服。请处理工单 T1041(客户 C007): 标题:重复扣款 内容:你好,10 月 8 号我被扣了两次款,INV-2026-0026 和 INV-2026-0123 金额一模一样,麻烦把多扣的那笔退给我。
先用工具核实事实,再起草回复。涉及退款只提交申请,告诉客户需要审批。
```

到这里 Day 284 那三个 peek 脚本做的事,全在界面里点了一遍。

## 第三步:报错时去哪看

Inspector 真正值钱的地方是 server 出 bug 的时候。我们故意造两个 bug。

**bug 一:SQL 里一个列名写错。** 把 server 复制一份,把 `list_invoices` 里排序用的 `issued_at` 改成 `issue_at`(少一个 d):

```bash
sed 's/ORDER BY issued_at DESC, id DESC LIMIT ?/ORDER BY issue_at DESC, id DESC LIMIT ?/' cloudledger/server.py > cloudledger/server_bug2.py
grep -n "issue_at" cloudledger/server_bug2.py
```

<div class="line-notes">

- `sed 's/ORDER BY issued_at` 格式是 `sed 's/旧/新/' 文件 > 新文件`。`sed` 是命令行里的查找替换,`s/A/B/` 把每行第一个 A 换成 B,结果写到新文件,原文件不动。相当于在编辑器里做一次「查找替换」再另存为。
- `grep -n "issue_at"` 在新文件里找这个词,`-n` 带行号。输出 `108:    sql += " ORDER BY issue_at DESC, id DESC LIMIT ?"`,确认只改了这一处。

</div>

用 Inspector 打开 `server_bug2.py`(先在终端按 Ctrl+C 关掉上一个 Inspector,原因见「常见误区」里的端口占用),连上,调 `list_invoices`,`Customer Id` 填 `C007`。Results 里只有一句:

```text
Tool Error
Error executing tool list_invoices
```

光看这句完全不知道错在哪。这是 SDK 故意的:工具里抛出的**不是** `ToolError` 的意外异常(这里是 sqlite 报错),SDK 不把细节给模型,避免把表名、文件路径这类内部信息泄露出去。可你是开发者,你需要细节。切到右边栏的 **Console**(全称 Server Console),里面是 server 子进程的 stderr:

```text
[10/22/26 12:57:31] ERROR    Tool 'list_invoices' raised an        server.py:455
                             unexpected exception
                             ╭─ Traceback (most recent call last─╮
                             │ ... mcp/server/mcpserver/tools/   │
                             │ base.py:179 in run                │
                             ...
                             OperationalError: no such column:
                             issue_at
```

(中间几十行 traceback 我省略了。)最后一行 `OperationalError: no such column: issue_at` 就是根因。traceback 被排成很窄的框,是因为 SDK 用 rich 库打日志,默认按 80 列排版;往下找带 `Error:` 的那一行就行。

**bug 二:server 根本起不来。** 很多人照着 2025 年的教程写 server,第一行是 `from mcp.server.fastmcp import FastMCP`。在 2.x 的 SDK 上,这个 import 直接失败。造一份:

```bash
sed 's/^from mcp.server import MCPServer$/from mcp.server.fastmcp import FastMCP as MCPServer/' cloudledger/server.py > cloudledger/server_v1.py
```

用 Inspector 打开 `server_v1.py`,点连接开关。连不上,页面弹出提示:

```text
Failed to connect to "uv"
Connection closed
```

「Connection closed」的意思是子进程还没完成握手就退出了。去 Console 看:

```text
Traceback (most recent call last):
  File ".../agent-zero-lab/cloudledger/server_v1.py", line 13, in <module>
    from mcp.server.fastmcp import FastMCP as MCPServer
  File ".../site-packages/mcp/server/fastmcp.py", line 16, in <module>
    raise ModuleNotFoundError(_MESSAGE, name=__name__)
ModuleNotFoundError: No module named 'mcp.server.fastmcp'. This is mcp 2.x, where FastMCP was renamed to MCPServer (from mcp.server.mcpserver import MCPServer) and other APIs changed; see the migration guide at https://py.sdk.modelcontextprotocol.io/v2/migration/#fastmcp-renamed-to-mcpserver or pin 'mcp<2' to keep running v1 code.
```

SDK 团队专门留了一个空壳模块,import 它就报一段指路的错误,告诉你 `FastMCP` 改名叫 `MCPServer` 了。所以「连不上」的第一反应永远是:**先看 Console**,server 自己多半已经把原因打出来了。

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="出错时三个地方各看什么:Results 是模型看到的,Protocol 是 JSON-RPC 层成功还是失败,Console 是 server 的 stderr,根因通常在这里">
<rect x="0" y="0" width="640" height="200" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="20" width="190" height="160" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="115" y="44" fill="var(--ink)" text-anchor="middle">Results</text>
<text x="115" y="70" fill="var(--ink-soft)" text-anchor="middle" font-size="11">模型会看到的内容</text>
<text x="115" y="100" fill="var(--ink-faint)" text-anchor="middle" font-size="11">bug 一:</text>
<text x="115" y="118" fill="var(--ink-faint)" text-anchor="middle" font-size="11">Error executing</text>
<text x="115" y="136" fill="var(--ink-faint)" text-anchor="middle" font-size="11">tool list_invoices</text>
<rect x="225" y="20" width="190" height="160" rx="6" fill="none" stroke="var(--rule)"/>
<text x="320" y="44" fill="var(--ink)" text-anchor="middle">Protocol</text>
<text x="320" y="70" fill="var(--ink-soft)" text-anchor="middle" font-size="11">信封送到没有</text>
<text x="320" y="100" fill="var(--ink-faint)" text-anchor="middle" font-size="11">工具出错也是 OK</text>
<text x="320" y="118" fill="var(--ink-faint)" text-anchor="middle" font-size="11">(isError 在结果里)</text>
<text x="320" y="136" fill="var(--ink-faint)" text-anchor="middle" font-size="11">prompt/resource 出错</text>
<text x="320" y="154" fill="var(--ink-faint)" text-anchor="middle" font-size="11">才是 JSON-RPC error</text>
<rect x="430" y="20" width="190" height="160" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="525" y="44" fill="var(--ink)" text-anchor="middle">Console</text>
<text x="525" y="70" fill="var(--ink-soft)" text-anchor="middle" font-size="11">server 的 stderr</text>
<text x="525" y="100" fill="var(--ink-faint)" text-anchor="middle" font-size="11">no such column:</text>
<text x="525" y="118" fill="var(--ink-faint)" text-anchor="middle" font-size="11">issue_at</text>
<text x="525" y="146" fill="var(--ink-faint)" text-anchor="middle" font-size="11">根因通常在这里</text>
</g>
</svg>
<figcaption>同一个 bug 在三个面板里的样子。Results 故意不给细节,Protocol 只管 JSON-RPC 这一层,Console 才有 traceback。</figcaption>
</figure>

## 第四步:CLI 模式,把点击变成命令

界面适合探索,但每次改完代码都去点一遍,很快就烦了。Inspector 2.x 自带一个 CLI 模式:在包名后面加 `--cli`,再用 `--method` 说要发哪种请求,它连上、发一次、打印结果、退出。

```bash
npx -y @modelcontextprotocol/inspector@2.10.1 --cli \
  uv run python cloudledger/server.py \
  --method tools/call \
  --tool-name find_customer \
  --tool-arg query=user007
echo "exit $?"
```

<div class="line-notes">

- `--cli` 模式开关,必须紧跟在包名后面、所有其他参数之前(它的帮助里写着「Mode flags must appear before app options」)。
- `uv run python cloudledger/server.py` 启动 server 的命令,和界面模式一样。
- `--method tools/call` 要发的 JSON-RPC 方法名,就是 Protocol 面板里那些大写名字的小写版。
- `--tool-name find_customer` 调哪个工具。
- `--tool-arg query=user007` 参数,`key=value` 形式,多个参数空格隔开写在同一个 `--tool-arg` 后面。
- `echo "exit $?"` `$?` 是上一条命令的退出码,0 表示成功。脚本靠它判断成没成。

</div>

输出:

```text
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"id\": \"C007\",\n  \"name\": \"刘静\",\n  \"email\": \"user007@example.com\",\n  \"company\": \"半岛咖啡\"\n}"
    }
  ],
  "structuredContent": {
    "result": [
      {
        "id": "C007",
        "name": "刘静",
        "email": "user007@example.com",
        "company": "半岛咖啡"
      }
    ]
  },
  "isError": false
}
exit 0
```

这就是 `tools/call` 响应里 `result` 的原样,`content` 是给模型看的文本,`structuredContent` 是按 outputSchema 给程序用的结构化数据,两者内容一样。

其他几种请求的写法,每条我都跑过:

```bash
# 读 resource
npx -y @modelcontextprotocol/inspector@2.10.1 --cli uv run python cloudledger/server.py --method resources/read --uri cloudledger://policy/refund
# 列 prompt / 取 prompt
npx -y @modelcontextprotocol/inspector@2.10.1 --cli uv run python cloudledger/server.py --method prompts/list
npx -y @modelcontextprotocol/inspector@2.10.1 --cli uv run python cloudledger/server.py --method prompts/get --prompt-name reply_ticket --prompt-args ticket_id=T1041
```

<div class="line-notes">

- `--method resources/read --uri cloudledger://policy/refund` 读一份 resource 要给地址。输出里 `contents[0].text` 就是四条政策,`mimeType` 是 `text/plain`。
- `--method prompts/list` 输出 `reply_ticket` 和它的参数 `{"name": "ticket_id", "required": true}`。
- `--prompt-name reply_ticket --prompt-args ticket_id=T1041` 注意 prompt 的参数旗标叫 `--prompt-args`,工具的叫 `--tool-arg`,一个有 s 一个没有,我第一次就写错了。

</div>

**退出码是 CLI 模式最有用的东西。** 我把几种情况都跑了一遍:

| 情况 | 命令要点 | 退出码 |
| --- | --- | --- |
| 正常调用 | `find_customer query=user007` | 0 |
| 工具返回 `isError: true` | `get_subscription customer_id=c007` | 5 |
| 超额退款被拦 | `create_refund_request ... amount_yuan=999999` | 5 |
| prompt 抛 `MCPError` | `reply_ticket ticket_id=T9999` | 1 |
| server 起不来 | 打开 `server_v1.py` | 1 |

官方文档([CLI smoke testing](https://github.com/modelcontextprotocol/inspector/blob/main/docs/cli-smoke-testing.md))里的完整对照是:0 成功,1 用法错误或其他意外错误,2 工具没有 MCP App 界面,3 server 要求鉴权,4 连不上 server,5 工具错误(`isError: true` 或工具不存在),6 `--strict` 查出 schema 兼容问题。工具错误单独给一个 5,好处是你能区分「server 挂了」和「server 好好的,只是正确地拒绝了一个坏请求」,后者在测试里往往是**期望的结果**。

工具出错时,stdout 照样打印结果 JSON,stderr 多一行:

```text
{"error":{"code":"tool_is_error","message":"Tool 'get_subscription' returned isError:true."}}
```

**一个容易踩的坑:`--tool-arg` 会把值当 JSON 解析。** 我一开始想复现界面里「Customer Id 填 7」那个例子,写了 `--tool-arg customer_id=7`,结果报的不是正则不匹配,而是:

```text
Error executing tool get_subscription: 1 validation error for get_subscriptionArguments
customer_id
  Input should be a valid string [type=string_type, input_value=7, input_type=int]
```

`input_type=int`:CLI 把 `7` 解析成了数字。文档里写得很清楚,`key=value` 的 value 能当 JSON 解析就当 JSON,所以 `7`、`true`、`null` 都不再是字符串。想传字符串 `"7"`,要写成 `--tool-arg 'customer_id="7"'`(外面单引号给 shell,里面双引号给 JSON),这次报的才是 `String should match pattern '^C\d{3}$'`。客户编号、订单号、邮编这种「长得像数字的字符串」都会中招,而模型调用时是按 schema 传字符串的,所以 CLI 里看到的错误不一定是模型会遇到的错误。

## 动手练习

**练习 1:写一个冒烟测试脚本。** 新建 `part05/smoke_cloudledger.sh`,用 Inspector CLI 依次检查:列出工具成功、按邮箱找客户成功、小写编号被正则拦下、超额退款被拦、读退款政策成功、取 T1041 的 prompt 成功、取 T9999 失败。每条按退出码判断 PASS/FAIL,全部通过脚本退出 0。

<details><summary>参考答案</summary>

```bash
#!/usr/bin/env bash
# agent-zero-lab/part05/smoke_cloudledger.sh
# 用 Inspector CLI 给 CloudLedger server 做冒烟测试。在 agent-zero-lab 根目录跑:bash part05/smoke_cloudledger.sh
set -u
INSPECTOR="${INSPECTOR:-npx -y @modelcontextprotocol/inspector@2.10.1}"
SERVER="uv run python cloudledger/server.py"
fail=0

check() {
  local want="$1" name="$2"; shift 2
  $INSPECTOR --cli $SERVER "$@" > /dev/null 2>&1
  local got=$?
  if [ "$got" -eq "$want" ]; then echo "PASS $name (exit $got)"; else echo "FAIL $name (想要 $want,实际 $got)"; fail=1; fi
}

uv run python cloudledger/seed.py > /dev/null
check 0 "列出工具"           --method tools/list
check 0 "按邮箱找客户"       --method tools/call --tool-name find_customer --tool-arg query=user007
check 5 "编号格式不对被拦"   --method tools/call --tool-name get_subscription --tool-arg customer_id=c007
check 5 "超额退款被拦"       --method tools/call --tool-name create_refund_request --tool-arg invoice_id=INV-2026-0123 amount_yuan=999999 reason=测试超额退款
check 0 "读退款政策"         --method resources/read --uri cloudledger://policy/refund
check 0 "取工单提示词"       --method prompts/get --prompt-name reply_ticket --prompt-args ticket_id=T1041
check 1 "不存在的工单"       --method prompts/get --prompt-name reply_ticket --prompt-args ticket_id=T9999
exit $fail
```

<div class="line-notes">

- `#!/usr/bin/env bash` 第一行叫 shebang,告诉系统用 bash 解释这个文件。我们用 `bash 文件名` 运行时它不起作用,但留着是好习惯。
- `set -u` 用到没定义的变量就报错退出,防止变量名拼错时悄悄变成空字符串。
- `INSPECTOR="${INSPECTOR:-npx -y @modelcontextprotocol/inspector@2.10.1}"` `${变量:-默认值}`:外面设了环境变量 `INSPECTOR` 就用它,没设就用 npx 那一串。相当于 JS 的 `process.env.INSPECTOR ?? "npx ..."`。我自己跑时把它指向本地装好的同版本,省掉每次 npx 的检查。
- `SERVER="uv run python cloudledger/server.py"` 启动命令存成变量。
- `fail=0` 记录有没有失败,最后当退出码。
- `check() {` 定义一个 bash 函数。第一个参数是期望的退出码,第二个是名字,剩下的原样交给 Inspector。
- `local want="$1" name="$2"; shift 2` `local` 是函数内的局部变量;`shift 2` 把前两个参数移走,之后 `"$@"` 就只剩 `--method ...` 那些。
- `$INSPECTOR --cli $SERVER "$@" > /dev/null 2>&1` 这里 `$INSPECTOR` 和 `$SERVER` **故意不加引号**,让 bash 按空格拆成多个词;加了引号它会把整串当成一个命令名,报 `ENOENT`。`> /dev/null 2>&1` 把 stdout 和 stderr 都丢掉,只看退出码。
- `local got=$?` 取 Inspector 的退出码。
- `if [ "$got" -eq "$want" ]` `-eq` 是 bash 里的整数相等比较。
- `uv run python cloudledger/seed.py > /dev/null` 先重置库,否则上一次跑留下的退款申请会让「超额」那条的提示金额变化(退出码还是 5,但养成习惯)。
- `check 5 "编号格式不对被拦"` 用小写 `c007` 而不是 `7`,因为 `7` 会被 CLI 当成数字,前面讲过。
- `check 1 "不存在的工单"` prompt 抛 `MCPError` 是 JSON-RPC 错误,不属于「工具错误」,所以是 1 不是 5。
- `exit $fail` 有任何一条失败,脚本退出 1,放进 CI 就会标红。

</div>

```bash
bash part05/smoke_cloudledger.sh
echo "script exit $?"
```

```text
PASS 列出工具 (exit 0)
PASS 按邮箱找客户 (exit 0)
PASS 编号格式不对被拦 (exit 5)
PASS 超额退款被拦 (exit 5)
PASS 读退款政策 (exit 0)
PASS 取工单提示词 (exit 0)
PASS 不存在的工单 (exit 1)
script exit 0
```

每条都要重新拉起一次 server。我用本地装好的同一版本跑(`INSPECTOR=本地路径 bash part05/smoke_cloudledger.sh`),七条共 17 秒;走 npx 每条还要多一次包检查,会再慢一些。更快、更细的测试是 [Day 287](/blog/agent-zero/day-287-mcp-test/) 的内存客户端 + pytest,这个脚本的价值是它从「外面」测,和真实 host 走的是同一条 stdio 路。

</details>

**练习 2:用 Inspector 找 bug 并修好。** 照第三步造出 `cloudledger/server_bug2.py`,假装你不知道改了哪里:只用 Inspector(界面或 CLI 都行)找出 `list_invoices` 失败的原因,说出你是在哪个面板、哪一行看到的,然后修好它并验证。

<details><summary>参考答案</summary>

界面里:Results 只有 `Error executing tool list_invoices`,信息不够;Protocol 面板这条 `TOOLS/CALL` 是 OK,说明 JSON-RPC 层没问题,是工具内部出错;切到 Console,traceback 末尾是 `OperationalError: no such column: issue_at`。`OperationalError` 是 sqlite3 的「SQL 执行出错」,`no such column` 说明某条 SQL 用了表里没有的列名。在文件里搜 `issue_at`:

```bash
grep -n "issue_at" cloudledger/server_bug2.py
```

```text
108:    sql += " ORDER BY issue_at DESC, id DESC LIMIT ?"
```

表里的列叫 `issued_at`(Day 280 的 seed.py 建表语句里写的),改回来:

```bash
sed -i '' 's/ORDER BY issue_at DESC/ORDER BY issued_at DESC/' cloudledger/server_bug2.py
npx -y @modelcontextprotocol/inspector@2.10.1 --cli uv run python cloudledger/server_bug2.py --method tools/call --tool-name list_invoices --tool-arg customer_id=C007 limit=2
echo "exit $?"
```

<div class="line-notes">

- `sed -i '' 's/ORDER BY issue_at DESC/ORDER BY issued_at DESC/'` `-i` 表示直接改原文件;macOS 自带的 sed 要求 `-i` 后面跟一个备份后缀,`''` 表示不备份。Linux 上写 `sed -i 's/.../.../'`,不要那对引号。
- `--tool-arg customer_id=C007 limit=2` 两个参数写在同一个 `--tool-arg` 后面。`limit=2` 会被解析成数字 2,正好是 schema 要的整数。

</div>

修好后 `structuredContent.result` 是 INV-2026-0123 和 INV-2026-0026 两张,退出码 0。不用界面的话,CLI 模式下 traceback 打在 stderr 上,同样能看到 `no such column: issue_at`:

```text
[10/22/26 12:32:52] ERROR    Tool 'list_invoices' raised an        server.py:455
                             unexpected exception
                             OperationalError: no such column:
                             issue_at
```

</details>

**练习 3(观察会发生什么):在工具里 `print`。** Day 276 说过 stdio 模式下不能 `print`,因为 stdout 是通信线路。造一份 `cloudledger/server_bug.py`,在 `find_customer` 的第一行加 `print("debug: query =", query)`,然后分别用 Inspector CLI 和 Day 284 那种 Python `Client` 各调一次 `find_customer`。先猜:调用会失败吗?两边看到的一样吗?

<details><summary>参考答案</summary>

造文件:

```bash
sed 's/    like = f"%{query.strip()}%"/    print("debug: query =", query)\n    like = f"%{query.strip()}%"/' cloudledger/server.py > cloudledger/server_bug.py
grep -n "debug" cloudledger/server_bug.py
```

<div class="line-notes">

- `print("debug: query =", query)` 把 `like = ...` 那一行替换成「先一行 print,再原来那行」。`\n` 在替换部分里表示换行,macOS 的 sed 也支持。
- `grep -n "debug"` 输出 `72:    print("debug: query =", query)`,确认插进去了。

</div>

Inspector CLI:

```bash
npx -y @modelcontextprotocol/inspector@2.10.1 --cli uv run python cloudledger/server_bug.py --method tools/call --tool-name find_customer --tool-arg query=user007
```

结果和正常 server **完全一样**,返回 C007,`isError: false`,退出码 0,终端里也没有任何警告。我又在界面里试了一次,Console 面板显示 `No console output`。

Python Client:写一个十来行的小脚本,照 Day 284 `peek_server.py` 的写法拉起 `server_bug.py`,调一次 `find_customer` 再打印 `is_error`,输出:

```text
Failed to parse JSONRPC message from server
Traceback (most recent call last):
  ...
pydantic_core._pydantic_core.ValidationError: 1 validation error for union[JSONRPCRequest,JSONRPCNotification,JSONRPCResponse,JSONRPCError]
  Invalid JSON: expected value at line 1 column 1 [type=json_invalid, input_value='debug: query = user007', input_type=str]
is_error: False
```

调用本身也成功了,但 Python 客户端抓到 stdout 上冒出一行不是 JSON 的 `debug: query = user007`,打了一大段警告。Inspector 的 TS 客户端则默默把这行丢了。

结论有两条。第一,`print` 不一定让调用失败,两个客户端都很宽容地跳过了坏行;但不是每个 host 都这么宽容,而且如果 print 的内容恰好像半截 JSON,或者在消息中间插进去,就可能把真正的响应弄坏。第二,**Inspector 里一切正常,不代表 server 没问题**。它这里选择了不吭声,所以排查 stdio 问题时,用两种不同的客户端各试一次是值得的。日志一律用 `logging` 写 stderr。

</details>

**练习 4:新旧两种协议版本。** 用 `--protocol-era modern` 启动 Inspector 界面,连上后对比 Protocol 面板里的消息和默认(legacy)时有什么不同,卡片上显示的协议版本是多少。

<details><summary>参考答案</summary>

```bash
npx -y @modelcontextprotocol/inspector@2.10.1 \
  --web --protocol-era modern \
  uv run python cloudledger/server.py
```

<div class="line-notes">

- `--web --protocol-era modern` `--web` 是界面模式的开关,不写也是界面模式,但后面要跟别的 Inspector 选项时,模式开关得写在最前面。`--protocol-era modern` 用 2026-07-28 版协议去连。可选值 `legacy`、`auto`、`modern`,命令行临时指定 server 时默认 `legacy`。

</div>

连上后卡片显示 `MCP 2026-07-28`,Protocol 面板旁边的标记从 `LEGACY` 变成 `MODERN`。按时间顺序排,消息是:

```text
SERVER/DISCOVER
SUBSCRIPTIONS/LISTEN
RESOURCES/LIST
TOOLS/LIST
PROMPTS/LIST
RESOURCES/TEMPLATES/LIST
```

对比 legacy 的 `INITIALIZE` + `NOTIFICATIONS/INITIALIZED`,开头两条换成了 `SERVER/DISCOVER`(问 server 支持什么,一问一答,不建立会话)和 `SUBSCRIPTIONS/LISTEN`(新版规范里订阅资源变化的方式)。这就是 Day 277 讲的「去掉握手」在线上的样子。我们的 server 用的是 SDK 2.3.0,两种都支持,所以两种模式都能连上,工具、resource、prompt 的调用结果完全一样。

</details>

验收标准:能用固定版本的 Inspector 打开 CloudLedger server 并完成第二步的每个操作;`bash part05/smoke_cloudledger.sh` 七条全 PASS;遇到「Results 里只有一句 Error executing tool」时,知道去 Console 找根因。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| MCP Inspector | MCP 官方的调试工具,本身是一个没有模型的 MCP client,有网页、命令行、终端界面三种用法 |
| npx | npm 自带的「下载一个包并直接运行」的命令,`npx -y 包名@版本` |
| ad-hoc server | 在命令行里临时指定的 server,Inspector 不保存它,界面上显示 Read-only session |
| Protocol 面板 | Inspector 右栏,按时间列出每一条 JSON-RPC 消息,可展开、重放 |
| Console 面板(Server Console) | Inspector 右栏,显示 server 子进程的 stderr,traceback 在这里 |
| Results | 调工具后中栏显示的结果,就是模型会看到的 `content` 和 `structuredContent`,出错时是红色 Tool Error |
| Replay / Edit and replay | Protocol 历史里每条消息旁的按钮:原样重发、改参数后重发 |
| CLI 模式 | `--cli` 加 `--method`,发一次请求就退出,打印结果和退出码,适合写脚本 |
| 退出码(exit code) | 程序结束时返回给 shell 的数字,0 表示成功,`$?` 能取到 |
| 冒烟测试 | 只检查最关键的几条路径通不通的快速测试,名字来自硬件上电看冒不冒烟 |
| protocol era | Inspector 连接时用哪代协议:legacy(带 initialize 握手)、modern(2026-07-28,用 server/discover) |
| `server/discover` | 2026-07-28 版规范里替代握手的请求,问 server 支持哪些能力 |
| traceback | Python 报错时打印的调用栈,最后一行是异常类型和原因 |

## 常见误区

**照着 2025 年的教程找按钮。** 0.x 和 1.x 的 Inspector 界面、参数和 2.x 都不一样。命令里写死 `@2.10.1`,对着本文找。

**不写版本号直接 `npx @modelcontextprotocol/inspector`。** 每次拉最新版,今天能跑的命令下个月可能参数变了。官方 CLI 文档也提醒 CI 里必须写精确版本,`@2` 这种范围不算固定。

**只打开 `http://127.0.0.1:6274`。** 少了 `?MCP_INSPECTOR_API_TOKEN=...` 那一段进不去。复制终端打印的完整网址。

**开第二个 Inspector 时报端口占用。** 我第一次关浏览器没关终端,再启动时打印了 `MCP Inspector PORT IS IN USE at http://127.0.0.1:6274`。关浏览器不会停掉 Inspector,要回到启动它的终端按 Ctrl+C。找不到那个终端的话,`lsof -tiTCP:6274 -sTCP:LISTEN | xargs kill` 能按端口杀掉它。

**在错的目录里启动。** Inspector 在当前目录执行你给的命令。我在 `cloudledger/` 子目录里跑 `... uv run python cloudledger/server.py`,结果 `can't open file '.../cloudledger/cloudledger/server.py'`,紧接着 `Connection closed`。换成绝对路径也不一定行:我从 `/` 下跑,`uv run` 找不到项目,用的是没装依赖的 Python,报 `ModuleNotFoundError: No module named 'pydantic'`。最省事的办法就是在 `agent-zero-lab/` 根目录启动。

**看到 Protocol 里是 OK 就以为工具成功了。** 工具出错走的是正常结果里的 `isError: true`,JSON-RPC 层照样 OK。看 Results 是不是红色的 Tool Error。

**Results 只有 `Error executing tool xxx` 就开始瞎猜。** 那是 SDK 故意隐藏了意外异常的细节,根因在 Console 里。

**CLI 里 `--tool-arg customer_id=7` 报类型错误。** value 会被当 JSON 解析,`7` 成了数字。要字符串就写 `'customer_id="7"'`,或者用 `--tool-args-json '{"customer_id":"7"}'` 一次传整个 JSON。

**把 `--prompt-args` 写成 `--prompt-arg`。** 工具是 `--tool-arg`,prompt 是 `--prompt-args`。

**在 Inspector 里调写工具后忘了重置库。** Inspector 是真调用,`create_refund_request` 真的往 `cloudledger.db` 里写了申请。下一次「同样的操作」结果就不一样了。调试前后跑一次 `uv run python cloudledger/seed.py`。

**Inspector 里正常就以为 stdio 没问题。** 练习 3 实测,工具里 `print` 了一行,Inspector 一声不吭,Python 客户端却报了 `Failed to parse JSONRPC message from server`。

## 学习资料

### 文档与文章

- [MCP 官方文档 · Inspector](https://modelcontextprotocol.io/docs/tools/inspector):官方介绍页,了解它能干什么;具体参数以仓库 README 为准。
- [modelcontextprotocol/inspector 仓库](https://github.com/modelcontextprotocol/inspector):README 开头写了 web、CLI、TUI 三种用法和 Node 版本要求。
- [Inspector · Smoke-testing an MCP server](https://github.com/modelcontextprotocol/inspector/blob/main/docs/cli-smoke-testing.md):CLI 模式的完整用法,退出码表、`--tool-arg` 的 JSON 解析规则都在这里,写练习 1 之前读一遍。
- [Inspector · v1 → v2 migration guide](https://github.com/modelcontextprotocol/inspector/blob/main/docs/v1-to-v2-migration.md):看到老教程的命令跑不通时来这里对照新写法。
- [MCP Python SDK 迁移指南](https://py.sdk.modelcontextprotocol.io/v2/migration/):`FastMCP` 改名 `MCPServer` 等 1.x → 2.x 的变化,第三步 bug 二报错里给的就是这个链接。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1DgZZYeE4Y&autoplay=0&high_quality=1" title="MCP模型上下文协议 MCP Inspector调试MCP Servers的使用方法" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>唐国梁Tommy · MCP Inspector 调试 MCP Servers 的使用方法 · 10 分钟。2025 年 4 月录的,那时 Inspector 还是 0.x,界面和今天的 2.10.1 不一样,按钮位置别对照,看「连上 → 列工具 → 调用 → 看报错」这个流程。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1v7nz6dEue&autoplay=0&high_quality=1" title="【从零开发 Python MCP Server】2.创建第一个 Python MCP Server服务,并用MCP Inspector" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>大熊课堂 · 从零开发 Python MCP Server(2):创建第一个 server 并用 Inspector 调试 · 21 分钟,2026 年 10 月的新视频,适合对照着从头走一遍「写 server → Inspector 里点」。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/kkZ45K8ztRE" title="MCP Inspector Tutorial: Debugging AI Tools (stdio, SSE, Streamable HTTP)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>TheTerribleTutor · MCP Inspector Tutorial: Debugging AI Tools · 英文,标题里写了 stdio、SSE、Streamable HTTP 三种传输,今天看 stdio 那段;Day 290 做远程 server 时可以回来看 HTTP 那段。</figcaption>
</figure>

### 书籍

今天这组不需要。Inspector 更新太快(2026 年平均每周一个版本),书上的截图和命令基本都过时了,以官方仓库的文档为准。

### 开源项目与代码

- [modelcontextprotocol/inspector](https://github.com/modelcontextprotocol/inspector):`clients/web` 是界面,`clients/cli` 是 CLI 模式;`test-servers/` 里有官方拿来测 Inspector 自己的各种 server,想看「每个功能长什么样」可以连上去点。
- [modelcontextprotocol/servers · everything](https://github.com/modelcontextprotocol/servers/tree/main/src/everything):官方全功能演示 server,用 Inspector 连上它,能看到我们还没用到的功能(进度通知、采样、补全)在界面上的样子。

## 自测

1. 你在 Inspector 里调 `list_invoices`,Results 显示红色的 `Error executing tool list_invoices`,Protocol 面板这一条却是 OK。这两个信息分别说明什么?下一步看哪里?

<details><summary>答案</summary>

Protocol 是 OK,说明 JSON-RPC 请求和响应都正常,server 没崩、也没走 JSON-RPC 错误;Results 是 Tool Error,说明工具返回了 `isError: true`。错误文字只有一句通用的,说明工具里抛了一个不是 `ToolError` 的意外异常,SDK 隐藏了细节。下一步看 Console 面板的 traceback,最后一行就是根因。

</details>

2. 为什么 Inspector 启动时打印的网址要带一长串 `MCP_INSPECTOR_API_TOKEN`?

<details><summary>答案</summary>

Inspector 后端能按你的要求启动任意命令(它要拉起 server 子进程),如果本机任何网页都能访问 6274 端口,一个恶意网页就可能借它在你电脑上执行命令。token 是一次性的口令,只有拿到终端打印的那个网址才能用。

</details>

3. 下面这条命令会不会因为 `007` 被当成数字而报类型错误?先想,再看答案。

```bash
npx -y @modelcontextprotocol/inspector@2.10.1 --cli uv run python cloudledger/server.py --method tools/call --tool-name find_customer --tool-arg query=007
```

<details><summary>答案</summary>

不会。`--tool-arg` 的值能解析成 JSON 才当 JSON,`007` 有前导零,不是合法的 JSON 数字,所以按字符串 `"007"` 发出去。我实跑的结果是 `isError: false`,email 里的 `user007` 匹配到了 C007。会出类型错误的是 `query=7` 这种合法 JSON 数字。要稳妥地传字符串,写 `--tool-arg 'query="7"'` 或用 `--tool-args-json`。

</details>

4. 冒烟脚本里「不存在的工单」那条为什么期望退出码 1 而不是 5?

<details><summary>答案</summary>

5 专指工具错误(`tools/call` 结果里 `isError: true`,或工具不存在)。`reply_ticket` 是 prompt,查不到工单时 server 抛 `MCPError`,走的是 JSON-RPC 错误,CLI 把它归为一般错误,退出码 1。

</details>

5. 面试题:你写的 MCP server 在 Inspector 里一切正常,接进公司内部的 host 之后,工具调用偶尔返回解析错误。你会怎么排查?

<details><summary>答案</summary>

先怀疑 stdout 被污染:server 代码或它依赖的库是不是往 stdout 打了东西(`print`、某些库启动时的提示、进度条)。Inspector 的客户端会默默跳过非 JSON 行,所以它正常不能排除这个问题;换一个更严格的客户端(比如 Python SDK 的 `Client`)跑同样的调用,看有没有 `Failed to parse JSONRPC message`。确认后把所有输出改成 logging 写 stderr。其次对比两边的协议版本(Inspector 默认 legacy,host 可能是 modern),以及 host 启动 server 时的工作目录和环境变量是否和你本地一致。

</details>

## 明天预告

Day 286 · 第 41 周复习:MCP 与编排(Day 280–285)。这一周从造数据开始,一路写到完整的 server 和调试工具:seed.py、第一个工具、错误信息、读写分离、resource 和 prompt、Inspector。明天把六天串成一张图,合上文章默写一个最小的 server,再用只学过的东西做一个新的小 server,用今天的冒烟脚本思路验收。
