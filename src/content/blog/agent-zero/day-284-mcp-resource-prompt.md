---
title: 'Day 284 · 写 MCP server(五):resource 和 prompt,完整的 server'
description: '前三天 CloudLedger server 只有工具。今天补上另外两种原语:把退款政策挂成一个 resource,把「处理一张工单」做成一个 prompt,先各用 20 行的小 server 跑通,再拼进完整的 cloudledger/server.py,用 stdio 客户端把三种原语各看一眼。'
pubDate: 2026-10-22
regime: none
tags: ['mcp', 'mcp-server', 'cloudledger', 'agent-zero']
series: 'agent-zero'
day: 284
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 283](/blog/agent-zero/day-283-mcp-read-write/) 写了 CloudLedger server 里唯一的写工具 `create_refund_request`:它只往 `refund_requests` 表插一条 `pending_approval` 的申请,状态在 SQL 里写死,模型没办法直接写出「已批准」;再加上 `ToolAnnotations` 告诉 host 它会写库、不幂等。到这里,`cloudledger/server.py` 里已经有四个工具了:`find_customer`、`get_subscription`、`list_invoices`、`create_refund_request`。

可 [Day 274](/blog/agent-zero/day-274-mcp-primitives/) 讲过,server 能给出去的东西有三样,tools 只是其中一样。今天把另外两样 resources 和 prompts 各写一个,然后把这五天的零件拼成一个完整的 server。

## 今天要解决的问题

学完今天,你要能做到:

1. 用 `@mcp.resource("cloudledger://...")` 挂出一份只读资料,并用客户端列出来、读出来。
2. 用 `@mcp.prompt()` 写一个带参数的提示词模板,并用客户端填参数取出来。
3. 说清楚 tool、resource、prompt 三者分别由谁决定用不用,以及它们出错时的返回方式有什么不同(工具出错是 `isError: true` 的正常结果,另外两样出错是 JSON-RPC 错误)。
4. 拿到一份完整的 `cloudledger/server.py`,四个工具加一个 resource 加一个 prompt,用 stdio 客户端跑通。

预计用时 2.5 小时。今天不调模型,花费 ¥0。

前置:[Day 274](/blog/agent-zero/day-274-mcp-primitives/)(三种原语的概念)、[Day 275](/blog/agent-zero/day-275-json-rpc/)(JSON-RPC 的请求、响应、错误码,以及用 `Client` 拉起 server 偷看的 `peek_time_server.py`)、[Day 280](/blog/agent-zero/day-280-mcp-seed/) 到 [Day 283](/blog/agent-zero/day-283-mcp-read-write/)(`cloudledger/seed.py` 和 `cloudledger/server.py` 里的四个工具)。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

今天所有命令都在 `agent-zero-lab/` 根目录下跑。依赖前几天已经装过了,没装的话补一行:

```bash
cd agent-zero-lab
uv add "mcp[cli]==2.3.0"
uv run python cloudledger/seed.py
```

`mcp` 2.3.0 是 2026 年 10 月查到的 PyPI 最新版(10 月 2 日发布)。seed 跑完会打印 `已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}`,数字和 Day 280 一样就对了。

## 工具之外的两样东西:谁来决定用它

先回忆一下 Day 274 那张表。三种原语的差别不在「能放什么内容」,内容全是文字也行,差别在**谁按下开关**:

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="MCP 三种原语由谁决定使用:tool 由模型决定调用,resource 由应用或用户决定挂进上下文,prompt 由用户主动选用">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="20" width="180" height="70" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="110" y="48" fill="var(--ink)" text-anchor="middle">tool</text>
<text x="110" y="70" fill="var(--ink-soft)" text-anchor="middle" font-size="11">模型决定调不调</text>
<rect x="230" y="20" width="180" height="70" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="48" fill="var(--ink)" text-anchor="middle">resource</text>
<text x="320" y="70" fill="var(--ink-soft)" text-anchor="middle" font-size="11">应用/用户决定挂不挂</text>
<rect x="440" y="20" width="180" height="70" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="530" y="48" fill="var(--ink)" text-anchor="middle">prompt</text>
<text x="530" y="70" fill="var(--ink-soft)" text-anchor="middle" font-size="11">用户主动选用</text>
<text x="110" y="122" fill="var(--ink-soft)" text-anchor="middle" font-size="11">tools/call</text>
<text x="320" y="122" fill="var(--ink-soft)" text-anchor="middle" font-size="11">resources/read</text>
<text x="530" y="122" fill="var(--ink-soft)" text-anchor="middle" font-size="11">prompts/get</text>
<text x="110" y="150" fill="var(--ink)" text-anchor="middle" font-size="11">find_customer</text>
<text x="110" y="168" fill="var(--ink)" text-anchor="middle" font-size="11">list_invoices ...</text>
<text x="320" y="150" fill="var(--ink)" text-anchor="middle" font-size="11">cloudledger://</text>
<text x="320" y="168" fill="var(--ink)" text-anchor="middle" font-size="11">policy/refund</text>
<text x="530" y="150" fill="var(--ink)" text-anchor="middle" font-size="11">reply_ticket</text>
<text x="530" y="168" fill="var(--ink)" text-anchor="middle" font-size="11">(ticket_id)</text>
<line x1="20" y1="190" x2="620" y2="190" stroke="var(--rule)"/>
<text x="110" y="216" fill="var(--ink-soft)" text-anchor="middle" font-size="11">Claude Code:模型自己调</text>
<text x="320" y="216" fill="var(--ink-soft)" text-anchor="middle" font-size="11">Claude Code:输入 @ 选</text>
<text x="530" y="216" fill="var(--ink-soft)" text-anchor="middle" font-size="11">Claude Code:输入 / 选</text>
<text x="110" y="240" fill="var(--ink-faint)" text-anchor="middle" font-size="11">出错:isError 结果</text>
<text x="320" y="240" fill="var(--ink-faint)" text-anchor="middle" font-size="11">出错:JSON-RPC 错误</text>
<text x="530" y="240" fill="var(--ink-faint)" text-anchor="middle" font-size="11">出错:JSON-RPC 错误</text>
</g>
</svg>
<figcaption>同样是「给 Agent 一段文字」,tool 的开关在模型手里,resource 在应用手里,prompt 在用户手里。最后一行是今天会实际撞到的区别。</figcaption>
</figure>

拿前端打个比方。你写一个 React 页面,数据有三种来路:组件自己在 `useEffect` 里决定要不要 `fetch`,这像 tool,调用时机由「组件的逻辑」也就是模型决定;页面加载时框架帮你预取好的数据(比如 Next.js 的 loader),这像 resource,由应用决定放进来;用户点一个「快捷回复」按钮,把一段预设的文字填进输入框,这像 prompt,由用户决定。

**resource** 用一句大白话说,就是 server 挂出来的一份「可以读的资料」,每份有一个 URI(资源地址,写法和网址一样,比如 `cloudledger://policy/refund`),客户端按地址读。例子:云簿的退款政策原文、价目表、某个客户的档案。

**prompt** 是 server 提供的一个「提示词模板」,带名字和参数,用户在 host 里选中它、填上参数,host 就拿到一段写好的消息塞进对话。例子:`reply_ticket(ticket_id="T1041")` 生成一段「请处理工单 T1041,先核实再回复」的指令。

这两样为什么值得写?退款政策是客服 Agent 最常要看的东西。做成 tool 当然也行(写一个 `get_refund_policy()` 工具),但那样模型得先「想到」去调它;做成 resource,host 可以在对话一开始就把它挂进上下文,或者让用户用 `@` 点名引用。prompt 解决的是另一个问题:同一套「处理工单」的指令,每个客服都要手敲一遍,还敲得不一样,不如由 server 统一提供,改一处所有人生效。

## 第一步:最小的 resource

先不碰数据库,写一个只挂一份退款政策的小 server。新建 `part05/mini_resource.py`:

```python
# agent-zero-lab/part05/mini_resource.py
"""最小的 resource 演示:一个 server,只挂一份退款政策原文。"""
from mcp.server import MCPServer

mcp = MCPServer("mini-resource")


@mcp.resource("cloudledger://policy/refund", mime_type="text/plain")
def refund_policy() -> str:
    """云簿退款政策原文。"""
    return (
        "1. 重复扣款:核实后全额退还重复的那一笔,3 个工作日内原路退回。\n"
        "2. 年付(专业版和企业版)中途取消:按剩余整月数退款,已使用月份和当月不退;"
        "基础版年付不退,取消后当期结束不再续费。\n"
        "3. 月付:不支持中途退款,取消后当期结束不再续费。\n"
        "4. 所有退款需客服主管审批后执行。"
    )


if __name__ == "__main__":
    mcp.run()
```

<div class="line-notes">

- `from mcp.server import MCPServer` 和 Day 281 写工具时用的是同一个类。三种原语都挂在同一个 `mcp` 对象上,不用另装东西。
- `mcp = MCPServer("mini-resource")` server 名叫 `mini-resource`,客户端连上后在 `serverInfo` 里看到的就是它。
- `@mcp.resource("cloudledger://policy/refund", mime_type="text/plain")` 装饰器,第一个参数是这份资料的地址。`cloudledger://` 这个 scheme(地址开头冒号前那段)是我们自己起的,和 `https://` 地位一样,只是没有浏览器认识它。`mime_type` 告诉客户端内容是什么格式,和 HTTP 响应头里的 `Content-Type` 一回事。注意装饰器后面**有括号**,下一节会故意漏掉它。
- `def refund_policy() -> str:` 函数名 `refund_policy` 会变成这份资料的 `name`。**没有参数**:地址里没有 `{...}` 占位,函数就不能有参数,这条规则下一节也会演示一次。返回 `str`,SDK 把它包成一段文本内容。
- `"""云簿退款政策原文。"""` docstring 变成 `description`。和工具不同,这段描述主要写给人和 host 看(决定要不要挂),不是写给模型决定调用的。
- `"1. 重复扣款` 四条政策和 Day 283 写退款工具时依据的规则一致。几个挨着的字符串字面量 Python 会自动拼成一个,`\n` 是换行,和 JS 里 `'a' + 'b'` 拼出来的效果一样,只是不用写加号。
- `"基础版年付不退` 这一行前面那行没有 `\n`,所以第 2 条是一整行,读出来时 `splitlines()` 只会切成四行。
- `mcp.run()` 默认走 stdio,和 [Day 276](/blog/agent-zero/day-276-mcp-transports/) 讲的一样:这个进程的 stdin/stdout 就是通信线路。

</div>

光有 server 看不到效果,还要一个客户端去读它。[Day 275](/blog/agent-zero/day-275-json-rpc/) 的 `peek_time_server.py` 用 `Client` 拉起官方 Time server 偷看过工具列表,今天照着那个写法,换成列 resources。新建 `part05/peek_resources.py`:

```python
# agent-zero-lab/part05/peek_resources.py
"""用 stdio 拉起一个 server,列出它的 resources,再把每一份读出来。"""
import sys

import anyio
from mcp import Client, StdioServerParameters
from mcp.types import TextResourceContents

server = StdioServerParameters(command=sys.executable, args=[sys.argv[1]])


async def main() -> None:
    async with Client(server) as client:
        listing = await client.list_resources()
        for res in listing.resources:
            print(f"- {res.uri} | name={res.name} | mime={res.mime_type}")
            print("  description:", res.description)

            result = await client.read_resource(str(res.uri))
            block = result.contents[0]
            if isinstance(block, TextResourceContents):
                print("  第一行:", block.text.splitlines()[0])
                print("  总字数:", len(block.text))


if __name__ == "__main__":
    anyio.run(main)
```

<div class="line-notes">

- `import sys` 要用两个东西:`sys.executable` 和 `sys.argv`。
- `import anyio` 跑异步函数用的库,MCP SDK 内部就基于它。`anyio.run(main)` 相当于 JS 里在顶层 `await main()`。
- `from mcp import Client, StdioServerParameters` `Client` 是 2.x SDK 的客户端,`StdioServerParameters` 描述「怎么把 server 当子进程拉起来」。
- `from mcp.types import TextResourceContents` resource 内容有两种:文本(`TextResourceContents`,有 `.text`)和二进制(`BlobResourceContents`,有 `.blob`)。先 import 文本那种,后面用 `isinstance` 区分。
- `server = StdioServerParameters(command=sys.executable, args=[sys.argv[1]])` `sys.executable` 是当前正在跑的 Python 解释器的完整路径,实测是 `.../agent-zero-lab/.venv/bin/python`,用它启动 server 就保证和客户端用的是同一个 `.venv`,不会出现「server 那边找不到 mcp 包」。`sys.argv[1]` 是命令行第一个参数,运行 `python part05/peek_resources.py part05/mini_resource.py` 时就是 `"part05/mini_resource.py"`,相当于 Node 里的 `process.argv[2]`。
- `async with Client(server) as client:` 进入时拉起子进程、完成握手,退出时关掉子进程。`async with` 相当于「先 await 打开,块结束一定 await 关闭」,和 JS 里 `try { ... } finally { await close() }` 一个意思。
- `listing = await client.list_resources()` 发一个 `resources/list` 请求。返回的 `listing.resources` 是一个列表,这里只有一项。
- `print(f"- {res.uri}` 实测打印 `- cloudledger://policy/refund | name=refund_policy | mime=text/plain`。`name` 正是函数名,`mime` 正是装饰器里写的 `text/plain`。
- `print("  description:", res.description)` 打印 `云簿退款政策原文。`,就是 docstring。
- `result = await client.read_resource(str(res.uri))` 发 `resources/read` 请求,按地址把内容要过来。`res.uri` 的类型是 pydantic 的 URL 对象,不是字符串,所以外面套一个 `str(...)`。
- `block = result.contents[0]` 一次读可能返回多段内容(比如一个目录下的几个文件),这里只有一段。
- `if isinstance(block, TextResourceContents):` 类型收窄,和 TS 里 `if ('text' in block)` 的类型守卫一个作用。不写这一行直接 `block.text`,能跑,但 basedpyright 会报「`BlobResourceContents` 没有 `text` 属性」。
- `print("  第一行:", block.text.splitlines()[0])` `splitlines()` 按换行切成列表,取第 0 项,打印 `1. 重复扣款:核实后全额退还重复的那一笔,3 个工作日内原路退回。`
- `print("  总字数:", len(block.text))` 实测是 140。`len` 数的是字符数,中文一个字算 1,和 JS 的 `str.length` 对中文的结果一样。

</div>

跑:

```bash
uv run python part05/peek_resources.py part05/mini_resource.py
```

我在 2026-10-22 跑出来的输出:

```text
- cloudledger://policy/refund | name=refund_policy | mime=text/plain
  description: 云簿退款政策原文。
  第一行: 1. 重复扣款:核实后全额退还重复的那一笔,3 个工作日内原路退回。
  总字数: 140
```

线上到底传了什么?把 `read_resource` 的返回值原样转成 JSON 看一眼(我用 `result.model_dump_json(by_alias=True, exclude_none=True)` 打印的):

```json
{"_meta":{"io.modelcontextprotocol/serverInfo":{"name":"mini-resource","version":""}},"ttlMs":0,"cacheScope":"private","contents":[{"uri":"cloudledger://policy/refund","mimeType":"text/plain","text":"1. 重复扣款:核实后全额退还重复的那一笔,3 个工作日内原路退回。\n2. 年付(专业版和企业版)中途取消:..."}],"resultType":"complete"}
```

`contents` 里每一段都带着自己的 `uri` 和 `mimeType`,正文在 `text` 里。`ttlMs` 和 `cacheScope` 是 [Day 277](/blog/agent-zero/day-277-mcp-spec-2026/) 讲过的 2026-07-28 版规范新加的缓存提示:`ttlMs: 0` 表示「别缓存,每次都来读」。退款政策其实一年才改一次,真要优化可以给一个较长的 ttl,这门课先不碰。

## resource 写错了会怎样

照「报错先演示一次」的规矩,故意犯三个新手最容易犯的错。

第一个,装饰器漏了括号和地址。把 `@mcp.resource("cloudledger://policy/refund", ...)` 写成 `@mcp.resource`,一 import 就炸:

```text
TypeError: The @resource decorator was used incorrectly. Did you forget to call it? Use @resource('uri') instead of @resource
```

工具的装饰器 `@mcp.tool()` 括号里可以空着,resource 不行,它必须知道地址。这个报错是 SDK 专门写的,说得很直白。

第二个,地址里没有占位符,函数却声明了参数。比如想「按套餐读政策」,写成 `def refund_policy(plan: str) -> str:`,地址还是 `cloudledger://policy/refund`:

```text
ValueError: Resource 'cloudledger://policy/refund' has no URI template variables, but the handler declares parameters {'plan'}. Add matching {...} variables to the URI or remove the parameters.
```

意思是:参数只能从地址里来。想要参数,就得把地址写成 `cloudledger://policy/{plan}` 这种带花括号的模板,这叫 resource template,动手练习第 2 题会写一个。

第三个,客户端读一个不存在的地址,比如手滑多打一个 s,读 `cloudledger://policy/refunds`。客户端这一侧不是拿到一个「失败的结果」,而是 `await` 直接抛异常:

```text
MCPError | Unknown resource: cloudledger://policy/refunds
```

这和工具很不一样。[Day 282](/blog/agent-zero/day-282-mcp-errors/) 讲过,工具出错时 server 返回的是一个**正常的结果**,只是里面 `isError: true`,模型能读到错误文字再自己改。resource 出错走的是 JSON-RPC 层的错误(Day 275 讲的 `error` 字段,带错误码),客户端代码要用 `try/except MCPError` 接,相当于 JS 里 `fetch` 拿到 404 和 `fetch` 直接 reject 的区别。原因也好理解:resource 是应用去读的,读不到是应用的 bug,不需要让模型「看懂并重试」。

## 第二步:最小的 prompt

prompt 也先写一个 20 行的。新建 `part05/mini_prompt.py`:

```python
# agent-zero-lab/part05/mini_prompt.py
"""最小的 prompt 演示:一个带参数的提示词模板。"""
from mcp.server import MCPServer

mcp = MCPServer("mini-prompt")


@mcp.prompt()
def reply_ticket(ticket_id: str) -> str:
    """生成「处理一张工单」的标准指令,用户在 host 里像斜杠命令一样选用。"""
    return (
        f"你是云簿的客服。请处理工单 {ticket_id}。\n"
        "先用工具核实事实,再起草回复。涉及退款只提交申请,告诉客户需要审批。"
    )


if __name__ == "__main__":
    mcp.run()
```

<div class="line-notes">

- `@mcp.prompt()` 注册一个 prompt,括号里可以空着,名字默认取函数名。和 resource 相反,这里括号必须有、参数可以没有;写成 `@mcp.prompt` 不带括号会报和上面类似的 `TypeError`。
- `def reply_ticket(ticket_id: str) -> str:` 函数参数就是 prompt 的参数。`ticket_id` 没有默认值,所以是必填(`required: true`)。返回一个 `str`,SDK 会把它包成**一条 `role: "user"` 的消息**。
- `"""生成「处理一张工单」` docstring 变成 prompt 的 `description`,host 在斜杠命令菜单里显示的说明就是它。
- `f"你是云簿的客服。请处理工单 {ticket_id}。\n"` f-string 把参数填进模板,相当于 JS 的模板字符串 `` `请处理工单 ${ticketId}` ``。代入 `"T1041"` 得到 `你是云簿的客服。请处理工单 T1041。`
- `"先用工具核实事实` 第二行是固定的工作要求,和 Day 283 的设计呼应:涉及退款只提交申请。

</div>

客户端 `part05/peek_prompts.py`,结构和刚才那个一样,只是换成 `list_prompts` 和 `get_prompt`:

```python
# agent-zero-lab/part05/peek_prompts.py
"""用 stdio 拉起一个 server,列出它的 prompts,再填参数取一个出来。"""
import sys

import anyio
from mcp import Client, StdioServerParameters
from mcp.types import TextContent

server = StdioServerParameters(command=sys.executable, args=[sys.argv[1]])


async def main() -> None:
    async with Client(server) as client:
        listing = await client.list_prompts()
        for p in listing.prompts:
            args = [(a.name, a.required) for a in (p.arguments or [])]
            print(f"- {p.name} | 参数 {args}")
            print("  description:", p.description)

        result = await client.get_prompt("reply_ticket", {"ticket_id": "T1041"})
        for msg in result.messages:
            text = msg.content.text if isinstance(msg.content, TextContent) else f"<{msg.content.type}>"
            print(f"[{msg.role}] {text}")


if __name__ == "__main__":
    anyio.run(main)
```

<div class="line-notes">

- `from mcp.types import TextContent` prompt 返回的是消息,每条消息的 `content` 可能是文本、图片、音频或嵌入的 resource,文本那种是 `TextContent`。
- `listing = await client.list_prompts()` 发 `prompts/list`。
- `args = [(a.name, a.required) for a in (p.arguments or [])]` 列表推导式,把每个参数变成 `(名字, 是否必填)` 的元组。`p.arguments` 在 prompt 没参数时是 `None`,`or []` 让它退化成空列表,和 JS 的 `p.arguments ?? []` 一样。实测得到 `[('ticket_id', True)]`。
- `print(f"- {p.name} | 参数 {args}")` 打印 `- reply_ticket | 参数 [('ticket_id', True)]`。
- `result = await client.get_prompt("reply_ticket", {"ticket_id": "T1041"})` 发 `prompts/get`,第二个参数是参数字典。**值必须是字符串**,协议规定 prompt 参数全是 string,下一节会故意传个数字。
- `for msg in result.messages:` 返回的是消息列表,这里只有一条。
- `text = msg.content.text if isinstance` Python 的三元写法是 `A if 条件 else B`,相当于 JS 的 `条件 ? A : B`。是文本就取 `.text`,否则打印类型名。
- `print(f"[{msg.role}] {text}")` 打印角色和正文。角色是 `user`,因为函数返回的是普通字符串。

</div>

```bash
uv run python part05/peek_prompts.py part05/mini_prompt.py
```

输出:

```text
- reply_ticket | 参数 [('ticket_id', True)]
  description: 生成「处理一张工单」的标准指令,用户在 host 里像斜杠命令一样选用。
[user] 你是云簿的客服。请处理工单 T1041。
先用工具核实事实,再起草回复。涉及退款只提交申请,告诉客户需要审批。
```

注意 prompt 拿到的只是**一段消息**,不是模型的回答。server 不调模型,它只负责把模板填好交给 host,host 把这条消息放进对话,再由 host 去调模型。很多人第一次写 prompt 以为 server 会「执行」它,其实不会。

## prompt 的参数只能是字符串

再犯两个错。我写了一个小脚本,对 `reply_ticket` 分别传空参数 `{}` 和数字参数 `{"ticket_id": 1041}`,实测:

```text
MCPError | Internal server error
ValidationError | 1 validation error for GetPromptRequestParams
arguments.ticket_id
```

第一个是漏了必填参数。客户端只收到一句含糊的 `Internal server error`(JSON-RPC 错误码 -32603),真正原因在 server 的 stderr 里:

```text
ValueError: Missing required arguments: {'ticket_id'}
```

stdio 模式下 server 的 stderr 会直接打在你的终端上,所以报错时**先往上翻终端**,别只盯着客户端那一行。明天的 Inspector 有专门的面板显示它。

第二个更早就被拦了:错误类型是 `ValidationError`,来自客户端本地的 pydantic 校验,请求根本没发出去。协议里 prompt 参数定义成 `{[key: string]: string}`,传数字在客户端就不合法。这和工具很不一样,工具参数可以是 int、float、枚举,prompt 只有字符串。所以如果模板需要一个数字(比如「最近 N 张发票」),参数照样声明成 `str`,在函数里自己 `int()` 转。

## 第三步:拼成完整的 server

两个零件都跑通了,现在把它们放进 Day 281 到 Day 283 写好的 `cloudledger/server.py`。这一次的 prompt 比小 demo 多做一件事:按工单号去库里查出工单的标题和内容,填进模板。查不到怎么办,是今天最后一个要想清楚的点。

先试最直觉的写法:在 prompt 里 `raise ValueError(f"工单 {ticket_id} 不存在")`。我拿 T9999 试了一下,客户端收到的是:

```text
T9999 -> MCPError Internal server error
```

和漏参数一样,只有一句「服务器内部错误」。改成 Day 282 用过的 `ToolError` 呢?我也试了,结果完全一样,还是 `Internal server error`,错误码 -32603。`ToolError` 是专门给工具用的,SDK 只在工具调用里把它翻译成 `isError` 结果,在 prompt 里它就是一个普通异常。

能把错误文字原样带给客户端的写法是直接抛 `MCPError`,并给一个错误码。错误码用 JSON-RPC 规定的 `-32602`,意思是 Invalid params(参数不对),[Day 275](/blog/agent-zero/day-275-json-rpc/) 那张错误码表里有它;SDK 里有个常量 `INVALID_PARAMS` 就是这个数。改完再试,客户端收到:

```text
T9999 -> MCPError 工单 T9999 不存在,工单号形如 T1041。
```

完整的 server 如下。四个工具的部分和 Day 283 结束时一样,只有一处小改动(`request_id = cur.lastrowid or 0`,下面讲);新增的是开头两个 import、`REFUND_POLICY` 常量、最后的 resource 和 prompt。

```python
# agent-zero-lab/cloudledger/server.py
"""CloudLedger 业务库的 MCP server。只读工具随便调,写操作只能「提交退款申请」,真正退款要人审批。"""
import logging
import os
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Annotated, Literal, TypedDict

from pydantic import Field

from mcp import MCPError
from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import INVALID_PARAMS, ToolAnnotations

DB_PATH = Path(os.environ.get("CLOUDLEDGER_DB", Path(__file__).with_name("cloudledger.db")))
log = logging.getLogger("cloudledger")

mcp = MCPServer(
    "cloudledger",
    instructions="云簿 CloudLedger 的客户、订阅、发票查询工具。金额对外一律用「元」,内部存「分」。",
)

READ_ONLY = ToolAnnotations(read_only_hint=True, open_world_hint=False)

REFUND_POLICY = (
    "1. 重复扣款:核实后全额退还重复的那一笔,3 个工作日内原路退回。\n"
    "2. 年付(专业版和企业版)中途取消:按剩余整月数退款,已使用月份和当月不退;"
    "基础版年付不退,取消后当期结束不再续费。\n"
    "3. 月付:不支持中途退款,取消后当期结束不再续费。\n"
    "4. 所有退款需客服主管审批后执行。"
)


class Subscription(TypedDict):
    id: str
    customer_id: str
    plan: str
    billing_cycle: str
    seats: int
    status: str
    started_at: str
    current_period_end: str


class RefundRequest(TypedDict):
    refund_request_id: int
    status: str
    amount_yuan: str


def db() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise ToolError("业务库不存在,请先运行 seed.py 生成 cloudledger.db。")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def yuan(cents: int) -> str:
    return f"{cents / 100:.2f}"


# ---------- tools:模型自己决定什么时候调(Day 281–283) ----------

@mcp.tool(annotations=READ_ONLY)
def find_customer(
    query: Annotated[str, Field(description="客户邮箱、姓名、公司名或客户编号(如 C007),支持部分匹配")],
) -> list[dict]:
    """按邮箱/姓名/公司/编号查找客户,返回最多 5 条。查订阅和发票前先用它拿到 customer_id。"""
    like = f"%{query.strip()}%"
    with db() as conn:
        rows = conn.execute(
            "SELECT id, name, email, company FROM customers "
            "WHERE id = ? OR email LIKE ? OR name LIKE ? OR company LIKE ? LIMIT 5",
            (query.strip().upper(), like, like, like),
        ).fetchall()
    if not rows:
        raise ToolError(f"没有找到匹配「{query}」的客户。可以换成邮箱或客户编号再试。")
    return [dict(r) for r in rows]


@mcp.tool(annotations=READ_ONLY)
def get_subscription(
    customer_id: Annotated[str, Field(description="客户编号,如 C007", pattern=r"^C\d{3}$")],
) -> Subscription:
    """查询客户当前订阅:套餐、计费周期、席位数、状态、开始日期、本期结束日。"""
    with db() as conn:
        row = conn.execute("SELECT * FROM subscriptions WHERE customer_id = ?", (customer_id,)).fetchone()
    if row is None:
        raise ToolError(f"客户 {customer_id} 没有订阅记录。确认编号是否来自 find_customer 的结果。")
    return Subscription(**dict(row))


@mcp.tool(annotations=READ_ONLY)
def list_invoices(
    customer_id: Annotated[str, Field(description="客户编号,如 C007", pattern=r"^C\d{3}$")],
    status: Literal["paid", "open", "void", "refunded"] | None = None,
    limit: Annotated[int, Field(ge=1, le=20)] = 6,
) -> list[dict]:
    """列出客户最近的发票(按开票日期倒序),金额单位为元。可按状态过滤。"""
    sql = "SELECT id, amount_cents, status, issued_at, paid_at FROM invoices WHERE customer_id = ?"
    args: list = [customer_id]
    if status:
        sql += " AND status = ?"
        args.append(status)
    sql += " ORDER BY issued_at DESC, id DESC LIMIT ?"
    args.append(limit)
    with db() as conn:
        rows = conn.execute(sql, args).fetchall()
    return [{**dict(r), "amount_yuan": yuan(r["amount_cents"])} for r in rows]


@mcp.tool(annotations=ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=False))
def create_refund_request(
    invoice_id: Annotated[str, Field(description="要退款的发票号,如 INV-2026-0123")],
    amount_yuan: Annotated[float, Field(gt=0, description="退款金额,单位元")],
    reason: Annotated[str, Field(min_length=4, max_length=200, description="退款原因,写清楚依据")],
) -> RefundRequest:
    """提交一条退款申请,状态为 pending_approval,不会立刻退钱,需要客服主管审批。
    只能对 paid 状态的发票申请,金额不能超过发票金额减去已申请金额。"""
    with db() as conn:
        inv = conn.execute("SELECT * FROM invoices WHERE id = ?", (invoice_id,)).fetchone()
        if inv is None:
            raise ToolError(f"发票 {invoice_id} 不存在。先用 list_invoices 查到正确的发票号。")
        if inv["status"] != "paid":
            raise ToolError(f"发票 {invoice_id} 状态是 {inv['status']},只有 paid 的发票能退款。")
        already = conn.execute(
            "SELECT COALESCE(SUM(amount_cents), 0) FROM refund_requests "
            "WHERE invoice_id = ? AND status != 'rejected'",
            (invoice_id,),
        ).fetchone()[0]
        cents = round(amount_yuan * 100)
        left = inv["amount_cents"] - already
        if cents > left:
            raise ToolError(f"最多还能申请 {yuan(left)} 元(发票 {yuan(inv['amount_cents'])} 元,已申请 {yuan(already)} 元)。")
        cur = conn.execute(
            "INSERT INTO refund_requests (invoice_id, amount_cents, reason, status, created_at) "
            "VALUES (?, ?, ?, 'pending_approval', ?)",
            (invoice_id, cents, reason, datetime.now().isoformat(timespec="seconds")),
        )
        request_id = cur.lastrowid or 0
        log.info("refund request %s created for %s", request_id, invoice_id)
    return RefundRequest(refund_request_id=request_id, status="pending_approval", amount_yuan=yuan(cents))


# ---------- resource:应用或用户决定挂不挂进上下文(Day 284) ----------

@mcp.resource("cloudledger://policy/refund", mime_type="text/plain")
def refund_policy() -> str:
    """云簿退款政策原文。"""
    return REFUND_POLICY


# ---------- prompt:用户主动选用的模板(Day 284) ----------

@mcp.prompt()
def reply_ticket(ticket_id: str) -> str:
    """生成「处理一张工单」的标准指令,用户在 host 里像斜杠命令一样选用。"""
    with db() as conn:
        t = conn.execute(
            "SELECT id, customer_id, subject, body FROM tickets WHERE id = ?",
            (ticket_id.strip().upper(),),
        ).fetchone()
    if t is None:
        raise MCPError(code=INVALID_PARAMS, message=f"工单 {ticket_id} 不存在,工单号形如 T1041。")
    return (
        f"你是云簿的客服。请处理工单 {t['id']}(客户 {t['customer_id']}):\n"
        f"标题:{t['subject']}\n内容:{t['body']}\n\n"
        "先用工具核实事实,再起草回复。涉及退款只提交申请,告诉客户需要审批。"
    )


if __name__ == "__main__":
    mcp.run()  # 默认 stdio
```

<div class="line-notes">

- `"""CloudLedger 业务库的 MCP server。` 模块 docstring,把这个 server 的权限边界写在最前面:读随便调,写只有提申请一个口子。
- `import logging` stdio 模式下不能 `print`,日志用 logging 写到 stderr(Day 276 讲过 stdout 是通信线路)。
- `from typing import Annotated, Literal, TypedDict` 三个类型工具 Day 281 都讲过:`Annotated` 给参数贴说明和约束,`Literal` 变枚举,`TypedDict` 声明返回结构。
- `from mcp import MCPError` **今天新加**。prompt 和 resource 里要把错误原样交给客户端,就抛它。
- `from mcp.server.mcpserver.exceptions import ToolError` 工具里「模型传错了、可以改正」的情况抛它,Day 282 的主角。
- `from mcp.types import INVALID_PARAMS, ToolAnnotations` `INVALID_PARAMS` **今天新加**,值是 `-32602`;`ToolAnnotations` 是 Day 283 用的读写提示。
- `DB_PATH = Path(os.environ.get(` 默认用同目录的 `cloudledger.db`,设了环境变量 `CLOUDLEDGER_DB` 就用那个,和 `seed.py` 是同一个约定。动手练习第 4 题会把它指到一个不存在的路径。
- `log = logging.getLogger("cloudledger")` 名为 cloudledger 的 logger。
- `mcp = MCPServer(` server 名是 `cloudledger`。
- `instructions=` 握手时发给 host,很多 host 会放进系统提示词,提醒模型金额要按元说。
- `READ_ONLY = ToolAnnotations(` 三个只读工具共用的注解,只是提示,不是权限。
- `REFUND_POLICY = (` **今天新加**。政策原文抽成模块级常量,resource 直接返回它。抽出来的好处是以后别处(比如练习里的另一个 prompt)也能引用同一份文字,政策只有一个版本。
- `class Subscription(TypedDict):` `get_subscription` 的返回结构,SDK 据此生成 `outputSchema`。
- `class RefundRequest(TypedDict):` 退款工具的返回结构。
- `def db() -> sqlite3.Connection:` 每个工具和 prompt 都从这里拿连接。
- `raise ToolError("业务库不存在` 库文件不在就报错。注意它抛的是 `ToolError`:在工具里被调用时会变成 `isError` 结果;在 prompt 里被调用时只会变成 `Internal server error`,练习第 4 题会亲眼看到。
- `conn.row_factory = sqlite3.Row` 让查询结果能用 `row["name"]` 按列名取。
- `return f"{cents / 100:.2f}"` 分转元,`yuan(239200)` 得到 `"2392.00"`。
- `@mcp.tool(annotations=READ_ONLY)` 第一个工具,Day 281 写的。
- `query: Annotated[str` 参数说明写给模型看,告诉它可以填什么。
- `"""按邮箱/姓名/公司/编号查找客户` 后半句在给模型安排调用顺序。
- `like = f"%{query.strip()}%"` 拼 LIKE 的通配符,值本身还是走 `?` 占位。
- `"WHERE id = ? OR email LIKE ?` 四个 `?` 依次对应下一行元组里的四个值,防 SQL 注入。
- `raise ToolError(f"没有找到匹配` 找不到就告诉模型换个词再试。
- `return [dict(r) for r in rows]` 把每行转成普通 dict。
- `customer_id: Annotated[str, Field(description="客户编号,如 C007", pattern=` 正则 `^C\d{3}$` 在函数执行前就拦住格式不对的编号。
- `return Subscription(**dict(row))` 字典解包成关键字参数。
- `status: Literal[` 状态只能是四个值之一。
- `limit: Annotated[int, Field(ge=1, le=20)] = 6` 1 到 20,默认 6。
- `sql += " ORDER BY issued_at DESC, id DESC LIMIT ?"` 同一天两张发票时按 id 倒序,结果顺序稳定。
- `return [{**dict(r), "amount_yuan"` 每行多加一个元为单位的金额。
- `@mcp.tool(annotations=ToolAnnotations(read_only_hint=False` 唯一的写工具,Day 283 写的:会写库、不删改、不幂等。
- `reason: Annotated[str, Field(min_length=4` 退款原因至少 4 个字。
- `if inv["status"] != "paid":` 只有已付的发票能退。
- `already = conn.execute(` 统计已经申请过的金额,被驳回的不算。
- `cents = round(amount_yuan * 100)` 用 `round` 不用 `int`,避免 `19.99 * 100` 截成 1998。
- `if cents > left:` 超额就拒,顺便挡住重复提交。
- `"VALUES (?, ?, ?, 'pending_approval', ?)"` 状态写死在 SQL 里,「人审批」这个设计落在这一行。
- `request_id = cur.lastrowid or 0` 和 Day 283 相比唯一的改动。`cur.lastrowid` 的类型标注是 `int | None`(没插入时是 None),直接塞进要求 `int` 的 `RefundRequest` 会让 basedpyright 报一条红线。刚 INSERT 完它一定有值(实测第一次是 1),`or 0` 只是让类型检查满意,和 JS 的 `?? 0` 一个意思。
- `log.info("refund request %s created for %s"` 写到 stderr,实测打出 `refund request 1 created for INV-2026-0123`。
- `@mcp.resource("cloudledger://policy/refund", mime_type="text/plain")` **今天新加**,和第一步的小 demo 一模一样,只是函数体换成返回常量。
- `return REFUND_POLICY` 返回 140 个字符的政策原文。
- `@mcp.prompt()` **今天新加**。
- `def reply_ticket(ticket_id: str) -> str:` 参数只能是字符串,前面演示过。
- `with db() as conn:` prompt 里也能查库,和工具用同一个 `db()`。
- `"SELECT id, customer_id, subject, body FROM tickets WHERE id = ?",` 把要用的列一个个写出来,而不是 `SELECT *`,以后表里加列不会影响这里。
- `(ticket_id.strip().upper(),),` 先去空格再转大写,所以用户在 host 里敲 `t1041` 也能查到。末尾的逗号不能省,单元素元组必须带逗号。
- `if t is None:` 代入 `"T9999"`:库里工单只有 T1001 到 T1041,查不到。
- `raise MCPError(code=INVALID_PARAMS, message=` 错误码 -32602 加一句人话,客户端收到的就是 `工单 T9999 不存在,工单号形如 T1041。`。换成 `ValueError` 或 `ToolError`,客户端只会看到 `Internal server error`,前面实测过。
- `f"你是云簿的客服。请处理工单 {t['id']}(客户 {t['customer_id']}):\n"` 代入 T1041,得到 `你是云簿的客服。请处理工单 T1041(客户 C007):`。f-string 里取字典用单引号 `t['id']`,因为外层已经是双引号。
- `f"标题:{t['subject']}\n内容:{t['body']}\n\n"` 标题是「重复扣款」,内容是 seed.py 给 C007 补的那张工单原文。
- `"先用工具核实事实` 固定指令。模型拿到这段之后的理想路径是:`list_invoices` 核实两笔 → 读政策第 1 条 → `create_refund_request` 提申请 → 告诉客户需要审批。
- `mcp.run()  # 默认 stdio` 直接运行文件时启动;被别的文件 import 时不启动。

</div>

改完先做一次类型检查(Zed 里看到的红线就是它报的):

```bash
uv run basedpyright cloudledger/server.py
```

输出最后一行是 `0 errors, 0 warnings, 0 notes`。

## 跑一遍:三种原语各看一眼

最后写一个专门看这个 server 的客户端 `cloudledger/peek_server.py`。它和前面两个 peek 脚本的区别是:server 路径写死成同目录的 `server.py`,三种原语一次看完,再故意取一个不存在的工单。

```python
# agent-zero-lab/cloudledger/peek_server.py
"""把完整的 CloudLedger server 拉起来,三种原语各看一眼。"""
import sys
from pathlib import Path

import anyio
from mcp import Client, MCPError, StdioServerParameters
from mcp.types import TextContent, TextResourceContents

SERVER = Path(__file__).with_name("server.py")
params = StdioServerParameters(command=sys.executable, args=[str(SERVER)])


async def main() -> None:
    async with Client(params) as client:
        tools = await client.list_tools()
        resources = await client.list_resources()
        prompts = await client.list_prompts()
        print("tools:", [t.name for t in tools.tools])
        print("resources:", [str(r.uri) for r in resources.resources])
        print("prompts:", [p.name for p in prompts.prompts])

        policy = await client.read_resource("cloudledger://policy/refund")
        block = policy.contents[0]
        if isinstance(block, TextResourceContents):
            print("\n政策第 1 条:", block.text.splitlines()[0])

        got = await client.get_prompt("reply_ticket", {"ticket_id": "t1041"})
        msg = got.messages[0]
        if isinstance(msg.content, TextContent):
            print(f"\n[{msg.role}]\n{msg.content.text}")

        try:
            await client.get_prompt("reply_ticket", {"ticket_id": "T9999"})
        except MCPError as e:
            print("\nT9999 ->", type(e).__name__, e)


if __name__ == "__main__":
    anyio.run(main)
```

<div class="line-notes">

- `from pathlib import Path` 用来算 server.py 的绝对路径。
- `from mcp import Client, MCPError, StdioServerParameters` 这次多 import 一个 `MCPError`,下面要接住它。
- `SERVER = Path(__file__).with_name("server.py")` `__file__` 是 peek_server.py 自己的路径,`.with_name` 换成同目录的 `server.py`。好处是不管你在哪个目录跑这个脚本,都能找到 server,不像前面的 peek 脚本依赖命令行里写对相对路径。
- `params = StdioServerParameters(command=sys.executable, args=[str(SERVER)])` `args` 要的是字符串列表,`Path` 对象要 `str()` 一下。
- `tools = await client.list_tools()` 三个 list 请求挨个发,分别对应 `tools/list`、`resources/list`、`prompts/list`。
- `print("tools:", [t.name for t in tools.tools])` 打印四个工具名。
- `print("resources:", [str(r.uri) for r in resources.resources])` 打印 `['cloudledger://policy/refund']`。
- `print("prompts:", [p.name for p in prompts.prompts])` 打印 `['reply_ticket']`。
- `policy = await client.read_resource("cloudledger://policy/refund")` 按地址读政策。
- `print("\n政策第 1 条:"` 开头的 `\n` 只是多空一行,输出好看。
- `got = await client.get_prompt("reply_ticket", {"ticket_id": "t1041"})` 故意传小写 `t1041`,验证 server 里那个 `.upper()`。
- `print(f"\n[{msg.role}]\n{msg.content.text}")` 打印角色和填好的整段模板。
- `await client.get_prompt("reply_ticket", {"ticket_id": "T9999"})` 不存在的工单,server 抛 `MCPError`,经过 JSON-RPC 错误传回来,客户端这一侧又被还原成 `MCPError` 抛出。
- `print("\nT9999 ->", type(e).__name__, e)` `type(e).__name__` 是异常的类名字符串,相当于 JS 的 `e.constructor.name`。

</div>

```bash
uv run python cloudledger/seed.py
uv run python cloudledger/peek_server.py
```

输出(2026-10-22 实跑):

```text
已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}
tools: ['find_customer', 'get_subscription', 'list_invoices', 'create_refund_request']
resources: ['cloudledger://policy/refund']
prompts: ['reply_ticket']

政策第 1 条: 1. 重复扣款:核实后全额退还重复的那一笔,3 个工作日内原路退回。

[user]
你是云簿的客服。请处理工单 T1041(客户 C007):
标题:重复扣款
内容:你好,10 月 8 号我被扣了两次款,INV-2026-0026 和 INV-2026-0123 金额一模一样,麻烦把多扣的那笔退给我。

先用工具核实事实,再起草回复。涉及退款只提交申请,告诉客户需要审批。

T9999 -> MCPError 工单 T9999 不存在,工单号形如 T1041。
```

小写的 `t1041` 查到了 T1041,T9999 的错误文字原样到了客户端。到这里 CloudLedger server 就完整了。

## 零件 → 完整 server 对照表

| 零件 | 哪天学的 | 在 `cloudledger/server.py` 的哪一段 |
| --- | --- | --- |
| `MCPServer("cloudledger", instructions=...)` | Day 281 | 文件开头 `mcp = MCPServer(` |
| `@mcp.tool` + `Annotated`/`Field` 约束 | Day 281 | `find_customer`、`get_subscription`、`list_invoices` |
| `ToolError` 写成「告诉模型下一步」 | Day 282 | 每个工具里的 `raise ToolError(...)` |
| 写操作收窄 + `ToolAnnotations` | Day 283 | `create_refund_request` 和 `READ_ONLY` |
| `@mcp.resource(uri, mime_type=...)` | 今天第一步 | `refund_policy` 和常量 `REFUND_POLICY` |
| `@mcp.prompt()` | 今天第二步 | `reply_ticket` |
| prompt 里报错用 `MCPError(INVALID_PARAMS)` | 今天第三步 | `reply_ticket` 里的 `raise MCPError` |

## host 里它们长什么样

server 写完了,最终用户是在 host 里碰到它们的。以 Claude Code 为例(2026 年 10 月查的[官方文档](https://code.claude.com/docs/en/mcp)):resource 在输入框里打 `@` 就会出现在补全列表里,和文件放在一起,完整写法是 `@server名:地址`,接上我们的 server 就是 `@cloudledger:cloudledger://policy/refund`,选中后 Claude Code 会把政策原文作为附件放进这一轮对话。prompt 在输入框里打 `/` 能看到,显示成 `/cloudledger:reply_ticket (MCP)`,也可以直接敲 `/mcp__cloudledger__reply_ticket T1041`,参数用空格隔开,拿到的那段消息直接注入对话。

这一节没实跑:把 server 接进 Claude Code 是 [Day 289](/blog/agent-zero/day-289-mcp-host/) 的内容,今天只把文档里的写法记下来。也要知道并不是每个 host 都支持这两样,很多 host 至今只认 tools。这也是 Day 274 说「核心能力还是做成 tool」的原因:退款政策这种模型经常要查的东西,毕业项目里会放进知识库,通过检索工具给模型,不依赖 host 支不支持 resource。

## 动手练习

**练习 1:再挂一个价目表 resource。** 新建 `part05/ex284_plans.py`,挂一个地址为 `cloudledger://plans`、格式为 Markdown 表格的 resource,列出三档套餐每席位每月和每年的价格(价格和 `seed.py` 里的 `PLANS` 一致)。用今天的 `peek_resources.py` 验证。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/ex284_plans.py
"""练习 1:再挂一份静态 resource,价目表。"""
from mcp.server import MCPServer

mcp = MCPServer("ex284-plans")

PLANS = {"基础版": 4900, "专业版": 9900, "企业版": 29900}  # 每席位每月,单位分,和 seed.py 一致


@mcp.resource("cloudledger://plans", mime_type="text/markdown")
def plan_prices() -> str:
    """云簿三档套餐的价目表(每席位每月)。"""
    lines = ["| 套餐 | 每席位每月 | 每席位一年 |", "| --- | --- | --- |"]
    for plan, cents in PLANS.items():
        lines.append(f"| {plan} | {cents / 100:.2f} 元 | {cents * 12 / 100:.2f} 元 |")
    return "\n".join(lines)


if __name__ == "__main__":
    mcp.run()
```

<div class="line-notes">

- `PLANS = {"基础版": 4900` 直接抄 seed.py 里的字典,单位是分。真实项目里应该从同一个地方 import,不要抄两份,这里为了让练习文件独立。
- `@mcp.resource("cloudledger://plans", mime_type="text/markdown")` 内容是 Markdown 表格,mime 就写 `text/markdown`,支持渲染的 host 能显示成表格。
- `lines = ["| 套餐 | 每席位每月 | 每席位一年 |", "| --- | --- | --- |"]` 表头和分隔行。
- `for plan, cents in PLANS.items():` `.items()` 同时拿键和值,相当于 JS 的 `Object.entries(PLANS)`。
- `lines.append(f"| {plan} | {cents / 100:.2f} 元 | {cents * 12 / 100:.2f} 元 |")` 代入企业版:`29900 / 100 = 299.00`,`29900 * 12 / 100 = 3588.00`。
- `return "\n".join(lines)` 用换行把列表拼成一个字符串,相当于 JS 的 `lines.join("\n")`,只是 Python 把分隔符写在前面。

</div>

```bash
uv run python part05/peek_resources.py part05/ex284_plans.py
```

```text
- cloudledger://plans | name=plan_prices | mime=text/markdown
  description: 云簿三档套餐的价目表(每席位每月)。
  第一行: | 套餐 | 每席位每月 | 每席位一年 |
  总字数: 132
```

全文读出来是:

```text
| 套餐 | 每席位每月 | 每席位一年 |
| --- | --- | --- |
| 基础版 | 49.00 元 | 588.00 元 |
| 专业版 | 99.00 元 | 1188.00 元 |
| 企业版 | 299.00 元 | 3588.00 元 |
```

</details>

**练习 2:带参数的 resource。** 前面「resource 写错了会怎样」的第二个报错提示过,地址里写 `{占位符}` 就能带参数。新建 `part05/ex284_template.py`,挂一个 `cloudledger://customers/{customer_id}/profile`,返回客户的姓名、公司和当前订阅(JSON)。写一个验证脚本 `part05/peek_template.py`,看看它出现在 `resources/list` 还是别的列表里,并分别读 C007 和 C099。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/ex284_template.py
"""练习 2:带参数的 resource(resource template),一个客户一份档案。"""
import sqlite3
from pathlib import Path

from mcp import MCPError
from mcp.server import MCPServer
from mcp.types import INVALID_PARAMS

DB_PATH = Path(__file__).resolve().parent.parent / "cloudledger" / "cloudledger.db"
mcp = MCPServer("ex284-template")


@mcp.resource("cloudledger://customers/{customer_id}/profile", mime_type="application/json")
def customer_profile(customer_id: str) -> dict:
    """一个客户的基本信息加当前订阅。"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT c.id, c.name, c.company, s.plan, s.billing_cycle, s.seats, s.status "
        "FROM customers c JOIN subscriptions s ON s.customer_id = c.id WHERE c.id = ?",
        (customer_id.upper(),),
    ).fetchone()
    conn.close()
    if row is None:
        raise MCPError(code=INVALID_PARAMS, message=f"客户 {customer_id} 不存在")
    return dict(row)


if __name__ == "__main__":
    mcp.run()
```

<div class="line-notes">

- `DB_PATH = Path(__file__).resolve().parent.parent / "cloudledger" / "cloudledger.db"` 从 `part05/ex284_template.py` 往上两级到 `agent-zero-lab/`,再进 `cloudledger/`。`/` 是 pathlib 拼路径的写法,相当于 Node 的 `path.join`。
- `@mcp.resource("cloudledger://customers/{customer_id}/profile"` 地址里有 `{customer_id}`,SDK 就把它注册成 **resource template**(资源模板),不是普通 resource。
- `def customer_profile(customer_id: str) -> dict:` 参数名必须和花括号里的名字一模一样,否则装饰时就报 `Mismatch between URI parameters`。返回 dict,SDK 会自动转成 JSON 文本。
- `"FROM customers c JOIN subscriptions s ON s.customer_id = c.id WHERE c.id = ?"` 两张表按客户编号连起来查,JOIN 是第一部分 SQL 那几天学过的。
- `conn.close()` 这里没用 `with`,所以自己关连接。
- `raise MCPError(code=INVALID_PARAMS` 查不到就抛带错误码的错误,和完整 server 里 prompt 的写法一样。

</div>

```python
# agent-zero-lab/part05/peek_template.py
"""练习 2 的验证脚本:列出模板,再用两个具体 URI 去读。"""
import sys

import anyio
from mcp import Client, MCPError, StdioServerParameters
from mcp.types import TextResourceContents

server = StdioServerParameters(command=sys.executable, args=["part05/ex284_template.py"])


async def main() -> None:
    async with Client(server) as client:
        fixed = await client.list_resources()
        templates = await client.list_resource_templates()
        print("resources/list:", [str(r.uri) for r in fixed.resources])
        print("templates/list:", [t.uri_template for t in templates.resource_templates])

        for uri in ["cloudledger://customers/C007/profile", "cloudledger://customers/C099/profile"]:
            try:
                got = await client.read_resource(uri)
                block = got.contents[0]
                if isinstance(block, TextResourceContents):
                    print(uri, "->", block.mime_type, block.text.replace("\n", " "))
            except MCPError as e:
                print(uri, "-> MCPError", e.error.code, e.error.message)


if __name__ == "__main__":
    anyio.run(main)
```

<div class="line-notes">

- `server = StdioServerParameters(command=sys.executable, args=["part05/ex284_template.py"])` 相对路径,所以要在 `agent-zero-lab/` 根目录跑。
- `fixed = await client.list_resources()` 普通 resource 列表。
- `templates = await client.list_resource_templates()` 模板有自己单独的列表,请求方法是 `resources/templates/list`。
- `print("templates/list:", [t.uri_template for t in templates.resource_templates])` 模板的字段叫 `uri_template`,不是 `uri`。
- `for uri in [` 一个存在的客户,一个不存在的。
- `print(uri, "->", block.mime_type, block.text.replace("\n", " "))` 把 JSON 里的换行换成空格,打印成一行好看。
- `print(uri, "-> MCPError", e.error.code, e.error.message)` `e.error` 里有错误码和文字。

</div>

```bash
uv run python part05/peek_template.py
```

```text
resources/list: []
templates/list: ['cloudledger://customers/{customer_id}/profile']
cloudledger://customers/C007/profile -> application/json {   "id": "C007",   "name": "刘静",   "company": "半岛咖啡",   "plan": "企业版",   "billing_cycle": "monthly",   "seats": 8,   "status": "active" }
cloudledger://customers/C099/profile -> MCPError -32602 客户 C099 不存在
```

答案是它不在 `resources/list` 里(那里是空的),而是在 `resources/templates/list` 里。这一点很多人第一次会困惑:host 列 resource 时如果只调了前一个,模板就「看不见」。客户端得先拿到模板,再把占位符填成具体值去读。

</details>

**练习 3:带可选参数、返回两条消息的 prompt。** 新建 `part05/ex284_prompt.py`,写一个 `refund_review(invoice_id, tone="正式")`:第一条消息是 user,让模型核实发票再按政策给结论,语气用 tone;第二条是 assistant,内容是「好的,我先核实发票 X。」。用一个验证脚本看参数列表里 tone 是否必填,再分别带和不带 tone 各取一次。提示:`from mcp.server.mcpserver.prompts.base import AssistantMessage, Message, UserMessage`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/ex284_prompt.py
"""练习 3:一个带可选参数、返回两条消息的 prompt。"""
from mcp.server import MCPServer
from mcp.server.mcpserver.prompts.base import AssistantMessage, Message, UserMessage

mcp = MCPServer("ex284-prompt")


@mcp.prompt()
def refund_review(invoice_id: str, tone: str = "正式") -> list[Message]:
    """审核一笔退款:先核实发票,再按政策给结论。tone 可选「正式」或「亲切」。"""
    return [
        UserMessage(
            f"请审核发票 {invoice_id} 的退款诉求。先用 list_invoices 核实状态和金额,"
            f"再读退款政策 cloudledger://policy/refund,最后用{tone}的语气给出结论。"
        ),
        AssistantMessage(f"好的,我先核实发票 {invoice_id}。"),
    ]


if __name__ == "__main__":
    mcp.run()
```

<div class="line-notes">

- `from mcp.server.mcpserver.prompts.base import AssistantMessage, Message, UserMessage` SDK 提供的两种消息类,`Message` 是它们的父类,拿来写返回类型。
- `def refund_review(invoice_id: str, tone: str = "正式") -> list[Message]:` 有默认值的参数在 `prompts/list` 里会显示成非必填。返回一个消息列表,不再是单个字符串。
- `UserMessage(` 第一条,角色是 user。传字符串,SDK 自动包成 `TextContent`。
- `f"再读退款政策 cloudledger://policy/refund` 在 prompt 里提到 resource 的地址,让模型知道政策在哪。
- `AssistantMessage(f"好的,我先核实发票 {invoice_id}。")` 第二条,角色是 assistant。在对话里预先放一句模型的开头,叫 prefill(预填),能把模型的第一步引向「先核实」。

</div>

```python
# agent-zero-lab/part05/peek_prompt_ex.py
"""练习 3 的验证脚本:看参数列表,再分别带和不带 tone 取一次。"""
import sys

import anyio
from mcp import Client, StdioServerParameters
from mcp.types import TextContent

server = StdioServerParameters(command=sys.executable, args=["part05/ex284_prompt.py"])


async def main() -> None:
    async with Client(server) as client:
        p = (await client.list_prompts()).prompts[0]
        print(p.name, [(a.name, a.required) for a in (p.arguments or [])])
        for args in ({"invoice_id": "INV-2026-0123"}, {"invoice_id": "INV-2026-0123", "tone": "亲切"}):
            got = await client.get_prompt("refund_review", args)
            print("---", args)
            for m in got.messages:
                if isinstance(m.content, TextContent):
                    print(f"[{m.role}] {m.content.text}")


if __name__ == "__main__":
    anyio.run(main)
```

<div class="line-notes">

- `p = (await client.list_prompts()).prompts[0]` 先 await 拿到结果,再取 `.prompts[0]`。括号不能省,否则 Python 会先算 `.prompts` 再 await。
- `print(p.name, [(a.name, a.required) for a in (p.arguments or [])])` 打印每个参数是否必填。
- `for args in ({"invoice_id": "INV-2026-0123"}, {"invoice_id": "INV-2026-0123", "tone": "亲切"}):` 两组参数,一组不带 tone。
- `print(f"[{m.role}] {m.content.text}")` 两条消息分别打印角色。

</div>

```bash
uv run python part05/peek_prompt_ex.py
```

```text
refund_review [('invoice_id', True), ('tone', False)]
--- {'invoice_id': 'INV-2026-0123'}
[user] 请审核发票 INV-2026-0123 的退款诉求。先用 list_invoices 核实状态和金额,再读退款政策 cloudledger://policy/refund,最后用正式的语气给出结论。
[assistant] 好的,我先核实发票 INV-2026-0123。
--- {'invoice_id': 'INV-2026-0123', 'tone': '亲切'}
[user] 请审核发票 INV-2026-0123 的退款诉求。先用 list_invoices 核实状态和金额,再读退款政策 cloudledger://policy/refund,最后用亲切的语气给出结论。
[assistant] 好的,我先核实发票 INV-2026-0123。
```

`tone` 显示 `False`,不传时用默认的「正式」。

</details>

**练习 4(观察会发生什么):库文件不见了。** 写一个脚本,启动 server 时把环境变量 `CLOUDLEDGER_DB` 指到 `/nonexistent/cloudledger.db`,然后分别调一次 `find_customer`、读一次退款政策、取一次 `reply_ticket`。先猜三种原语各返回什么,再跑。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/peek_missing_db.py
"""把 CLOUDLEDGER_DB 指到一个不存在的文件,看 tool、resource、prompt 三种原语各自怎么报错。"""
import os
import sys
from pathlib import Path

import anyio
from mcp import Client, MCPError, StdioServerParameters
from mcp.types import TextContent

LAB = Path(__file__).resolve().parent.parent
params = StdioServerParameters(
    command=sys.executable,
    args=[str(LAB / "cloudledger" / "server.py")],
    env={**os.environ, "CLOUDLEDGER_DB": "/nonexistent/cloudledger.db"},
)


async def main() -> None:
    async with Client(params) as client:
        r = await client.call_tool("find_customer", {"query": "C007"})
        block = r.content[0]
        print("tool     -> is_error =", r.is_error, "|", block.text if isinstance(block, TextContent) else block.type)

        res = await client.read_resource("cloudledger://policy/refund")
        print("resource -> 正常读到", len(res.contents), "段内容")

        try:
            await client.get_prompt("reply_ticket", {"ticket_id": "T1041"})
        except MCPError as e:
            print("prompt   -> MCPError", e.error.code, "|", e.error.message)


if __name__ == "__main__":
    anyio.run(main)
```

<div class="line-notes">

- `LAB = Path(__file__).resolve().parent.parent` 练习仓库根目录的绝对路径。
- `env={**os.environ, "CLOUDLEDGER_DB": "/nonexistent/cloudledger.db"},` 子进程的环境变量:先复制当前所有环境变量(`**` 展开,相当于 JS 的 `{...process.env}`),再覆盖一个。只写 `{"CLOUDLEDGER_DB": ...}` 的话子进程会丢掉 PATH 等变量。
- `r = await client.call_tool("find_customer", {"query": "C007"})` 工具调用,`db()` 发现库不在,抛 `ToolError`。
- `res = await client.read_resource("cloudledger://policy/refund")` 政策是常量,根本不碰数据库。
- `await client.get_prompt("reply_ticket", {"ticket_id": "T1041"})` prompt 里也调了 `db()`,同样抛 `ToolError`。

</div>

```bash
uv run python part05/peek_missing_db.py
```

```text
tool     -> is_error = True | Error executing tool find_customer: 业务库不存在,请先运行 seed.py 生成 cloudledger.db。
resource -> 正常读到 1 段内容
prompt   -> MCPError -32603 | Internal server error
```

同一个 `ToolError`,在工具里变成模型看得懂的 `isError` 结果(SDK 2.3.0 会在前面加上 `Error executing tool find_customer: `);在 prompt 里只剩一句 `Internal server error`。resource 不受影响,因为它不读库。想让 prompt 也报清楚,可以在 `reply_ticket` 里先自己检查 `DB_PATH.exists()`,不存在就抛 `MCPError`,做法和工单不存在那一段一样。

</details>

验收标准:`uv run python cloudledger/peek_server.py` 的输出和上面「跑一遍」那一节一致;`uv run basedpyright cloudledger part05` 报 `0 errors`;能不看文章说出 tool、resource、prompt 各由谁决定使用,出错时各走哪条路。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| resource | server 挂出来的一份只读资料,有自己的 URI,由应用或用户决定要不要放进上下文。例:`cloudledger://policy/refund` |
| URI | 资源地址,写法和网址一样,`scheme://路径`。scheme 可以自己起,比如 `cloudledger://` |
| scheme | 地址开头冒号前那段,`https`、`file`、`cloudledger` 都是 |
| mime type | 内容格式的标签,`text/plain`、`text/markdown`、`application/json`,和 HTTP 的 Content-Type 同一套 |
| `resources/list` / `resources/read` | 列出所有 resource、按地址读一份的两个 JSON-RPC 方法 |
| resource template | 地址里带 `{占位符}` 的 resource,例 `cloudledger://customers/{customer_id}/profile`,单独出现在 `resources/templates/list` 里 |
| prompt | server 提供的提示词模板,有名字和字符串参数,由用户在 host 里主动选用,拿到的是填好的消息 |
| `prompts/list` / `prompts/get` | 列出所有 prompt、填参数取一个的两个 JSON-RPC 方法 |
| `MCPError` | MCP SDK 的异常类,带 JSON-RPC 错误码和文字;server 抛出它,客户端收到的就是这段文字 |
| `INVALID_PARAMS` (-32602) | JSON-RPC 规定的「参数不对」错误码 |
| Internal error (-32603) | JSON-RPC 规定的「服务器内部错误」,server 里抛了没被翻译的普通异常时客户端看到的就是它 |
| prefill(预填) | 在发给模型的消息末尾预先放一句 assistant 的话,引导模型从这里接着说 |
| `ttlMs` / `cacheScope` | 2026-07-28 版规范里结果上的缓存提示:多少毫秒内可以复用、缓存给谁用 |

## 常见误区

**以为 prompt 会在 server 上「执行」。** server 只把模板填好返回一段消息,不调模型。调模型的是 host。所以 prompt 函数里不需要、也不应该放 API key。

**在 prompt 和 resource 里抛 `ToolError` 或 `ValueError` 想告诉用户哪里错了。** 实测客户端只收到 `Internal server error`(-32603),原因只在 server 的 stderr 里。要让文字到达客户端,抛 `MCPError(code=INVALID_PARAMS, message=...)`。工具里则继续用 `ToolError`,两者别混。

**`@mcp.resource` 漏了括号和地址。** 一 import 就是 `TypeError: The @resource decorator was used incorrectly`。工具装饰器括号可以空,resource 必须写地址。

**静态地址配了带参数的函数。** `ValueError: Resource 'cloudledger://policy/refund' has no URI template variables, but the handler declares parameters {'plan'}`。要参数就把地址改成带 `{plan}` 的模板,而且花括号里的名字要和参数名一字不差。

**找不到 resource template。** 它不在 `resources/list` 里,在 `resources/templates/list` 里。练习 2 实测前者是空列表。

**给 prompt 传数字参数。** 协议规定 prompt 参数全是字符串,传 `{"ticket_id": 1041}` 在客户端就被 pydantic 拦下,报 `ValidationError ... arguments.ticket_id`。需要数字就声明成 `str`,函数里自己转。

**只看客户端那一行报错。** 漏传必填参数时客户端只有 `Internal server error`,真正的 `ValueError: Missing required arguments: {'ticket_id'}` 在终端上方 server 打的 stderr 里。stdio 模式下两者混在同一个终端,往上翻就能看到。

**把模型常用的资料只做成 resource。** 很多 host 只支持 tools,resource 在那里等于不存在。模型自己需要随时查的东西,至少要有一个 tool 能拿到它。

## 学习资料

### 文档与文章

- [MCP 规范 2026-07-28 · Resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources):resource、template、`resources/list`、`resources/read` 的原始定义,看「User Interaction Model」一节,里面写明 resource 是 application-driven;「Error Handling」一节规定资源不存在要返回 -32602,和练习 2 的写法一致。
- [MCP 规范 2026-07-28 · Prompts](https://modelcontextprotocol.io/specification/2026-07-28/server/prompts):prompt 的定义和消息格式,注意参数类型那段。
- [MCP 官方 · Understanding MCP servers](https://modelcontextprotocol.io/docs/learn/server-concepts):三种原语的入门对比,和 Day 274 那张表对照着看。
- [Claude Code 文档 · MCP](https://code.claude.com/docs/en/mcp):搜「Use MCP resources」和「Use MCP prompts as commands」两节,看 `@` 和 `/` 的具体写法。
- [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk):README 里 Resources 和 Prompts 两节有更多例子;从 1.x 迁过来的看[迁移指南](https://py.sdk.modelcontextprotocol.io/v2/migration/)。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1dR51zVEd7&autoplay=0&high_quality=1" title="MCP Hello World:MCP 的资源、提示词和工具示例服务" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>沧海九粟 · MCP Hello World:MCP 的资源、提示词和工具示例服务 · 24 分钟,一个 server 把三种原语各写一个,正好和今天对照。这是 2025 年 4 月的视频,那时 Python SDK 还是 1.x,视频里如果出现 `FastMCP`,心里换成今天的 `MCPServer`。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1qhJX6hEdi&autoplay=0&high_quality=1" title="MCP 开发入门,区分三大核心原语:资源读取、工具调用、提示词模板" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI智能体原理 · MCP 开发入门,区分三大核心原语 · 6 分钟,2026 年 10 月的短视频,只讲三者分工,适合学完今天回头巩固。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/CBKlaQIZzGk" title="MCP Tools vs Resources vs Prompts: What's the Actual Difference?" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Akshat Paul · MCP Tools vs Resources vs Prompts: What's the Actual Difference? · 英文,重点看他讲「谁控制」的那段,和今天开头那张图是一回事。</figcaption>
</figure>

### 书籍

- Christoffer Noring,《Learn Model Context Protocol with Python》,Packt,2025。第一部分讲 server 端的 tools、resources、prompts,例子用 Python SDK(书写于 1.x 时代,类名按迁移指南换)。中文版暂未查到。
- Christoffer Noring,《Learn Model Context Protocol with TypeScript》,Packt,2025。同一作者的 TS 版,前端读者可以拿来对照同一个概念在 TS SDK 里怎么写。

### 开源项目与代码

- [modelcontextprotocol/servers · everything](https://github.com/modelcontextprotocol/servers/tree/main/src/everything):官方的「全功能演示」server,tools、resources、resource templates、prompts 都有,看它怎么给每种原语起名和写描述。
- [modelcontextprotocol/python-sdk](https://github.com/modelcontextprotocol/python-sdk):今天用的 `@mcp.resource`、`@mcp.prompt` 的源码在 `src/mcp/server/mcpserver/server.py`,文中引用的那几条报错文字都能在里面搜到。

## 自测

1. 云簿想让客服在任何对话里都能一键插入「本月促销规则」这段文字,模型自己不用去查。做成 tool、resource 还是 prompt?为什么?

<details><summary>答案</summary>

做成 resource 最合适。它是一份资料,由用户或 host 决定挂进来(Claude Code 里用 `@` 引用),不需要模型判断什么时候调。如果目标是「一键生成一段带指令的开场消息」,那更像 prompt;如果希望模型在对话中途自己想起来去查,那就得有一个 tool。

</details>

2. `reply_ticket` 里查不到工单时,写 `raise ValueError(...)`、`raise ToolError(...)`、`raise MCPError(code=INVALID_PARAMS, ...)`,客户端分别看到什么?

<details><summary>答案</summary>

前两种客户端都只看到 `Internal server error`(错误码 -32603),具体原因只在 server 的 stderr;第三种客户端收到错误码 -32602 和你写的那句话。`ToolError` 只在工具调用里才会被翻译成 `isError` 结果。

</details>

3. 下面这段为什么一 import 就报错?怎么改?

```python
@mcp.resource("cloudledger://invoices")
def invoice_detail(invoice_id: str) -> str:
    ...
```

<details><summary>答案</summary>

地址里没有 `{...}` 占位符,SDK 把它当静态 resource,但函数有参数 `invoice_id`,于是报 `has no URI template variables, but the handler declares parameters {'invoice_id'}`。改成 `@mcp.resource("cloudledger://invoices/{invoice_id}")`,它就变成 resource template,出现在 `resources/templates/list` 里。

</details>

4. 用客户端调 `get_prompt("reply_ticket", {"ticket_id": 1041})` 为什么请求根本没发出去?

<details><summary>答案</summary>

MCP 规定 prompt 的参数是字符串到字符串的映射。客户端在发请求前用 pydantic 校验参数,数字 1041 不是字符串,直接抛 `ValidationError`。要传 `"T1041"` 这样的字符串。

</details>

5. 面试题:你的 MCP server 同时提供了一个 `get_refund_policy` 工具和一个 `cloudledger://policy/refund` resource,内容一样。面试官问「这不是重复吗?为什么两个都要?」你怎么答?

<details><summary>答案</summary>

控制方不同,覆盖的 host 也不同。tool 由模型决定调用,模型在推理中途发现需要政策时能自己拿到;resource 由应用或用户决定挂载,适合对话一开始就放进上下文或让用户点名引用,不消耗模型的一次工具调用。另外不少 host 只支持 tools,只做 resource 在那些 host 里模型就拿不到政策。实现上两者应该返回同一个常量(比如 `REFUND_POLICY`),保证只有一个版本,避免模型看到两套说法。

</details>

## 明天预告

Day 285 · 写 MCP server(六):在 Inspector 里调试。今天我们写了三个 peek 脚本来看 server 的反应,每换一个参数都要改代码再跑。明天换成官方的 MCP Inspector:浏览器里点一下就能调工具、读 resource、取 prompt,右边实时显示每一条 JSON-RPC 消息,server 的 stderr 也有专门的面板。今天那几个「客户端只看到 Internal server error」的坑,明天在 Inspector 里一眼就能找到原因。
