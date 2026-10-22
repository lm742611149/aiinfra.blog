---
title: 'Day 288 · 写 MCP server(八):不接模型,先写一个最小 client'
description: '昨天的测试把 server 对象直接 import 进来,「把 server 当子进程拉起来」这一步从没被测过。今天写一个不调模型的最小 client:先 20 行连上 CloudLedger 调一次工具,再把 Client 拆成 stdio_client 和 ClientSession 两层看握手,最后做成一个能逛任意 stdio server 的 probe,拿它看别人的 server,抓出内存测试测不到的 stdout 污染。'
pubDate: 2026-10-22
regime: none
tags: ['mcp', 'mcp-client', 'cloudledger', 'agent-zero']
series: 'agent-zero'
day: 288
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 287](/blog/agent-zero/day-287-mcp-test/) 把 server 对象直接交给 `Client`,在同一个进程里用内存管道说 MCP,配上 anyio 插件和「每个测试一份临时库」的 fixture,13 条合同测试 0.44 秒跑完;改坏一个列名,pytest 的 `Captured log call` 里能直接看到 `no such column: issue_at`。

可内存测试有一个盲区:它跳过了「用一条命令把 server 拉起来」这一步。Claude Code、Cursor、你明天要写的 Agent,全都是走这一步连 server 的。今天就补这一块:写一个独立运行的最小 client,不接模型,只管连上、看清楚、手动调一下。

## 今天要解决的问题

学完今天,你要能做到:

1. 用 `Client` 加 `StdioServerParameters` 写一个 20 行的 client,把 CloudLedger server 当子进程拉起来,列工具、调一次工具。
2. 说清楚 `Client` 里面的两层:`stdio_client` 负责传输(两条流),`ClientSession` 负责会话(握手、收发请求),并亲眼看到「不握手直接发请求」会被拒。
3. 写出 `part05/mcp_probe.py`:给它任意一条启动命令,它把 server 的名字、协议版本、instructions、工具(含读写注解)、resource、prompt 都列出来;用它逛一个别人写的 server。
4. 用 probe 抓出一个内存测试测不到的问题:server 往 stdout 打了一行字。

预计用时 2 小时。今天不调模型,花费 ¥0。

前置:[Day 273](/blog/agent-zero/day-273-mcp-roles/)(host、client、server 三个角色)、[Day 275](/blog/agent-zero/day-275-json-rpc/)(JSON-RPC 请求和错误码)、[Day 276](/blog/agent-zero/day-276-mcp-transports/)(stdio 传输,stdout 是通信线路)、[Day 277](/blog/agent-zero/day-277-mcp-spec-2026/)(2026-07-28 版规范去掉了 `initialize` 握手)、[Day 284](/blog/agent-zero/day-284-mcp-resource-prompt/)(完整的 `cloudledger/server.py` 和 `peek_server.py`)、[Day 287](/blog/agent-zero/day-287-mcp-test/)(内存连接)。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

所有命令都在 `agent-zero-lab/` 根目录跑(我的是 `/Users/你/agent-zero-lab`),依赖还是 `mcp[cli]==2.3.0`。今天第三步要用 `uvx` 临时下载一个别人的 server,`uvx` 是装 uv 时自带的命令,相当于 Python 版的 `npx`。

## 为什么还要一个独立的 client

你可能会问:Day 284 不是写过 `cloudledger/peek_server.py` 吗?它也是起子进程连 server。区别在于用途。peek 脚本是写 server 时顺手「偷看一眼」,路径写死,只认我们自己的 server。今天要的是一个**工具**,给它任何一条启动命令都能用,有三个用处:

一是确认 server 在「别人的进程里」能正常启动。host 拉起 server 时用的命令、工作目录、环境变量都可能和你终端里不一样,内存测试完全测不到这些。

二是排查问题时的第一步。Agent 连 MCP 出了错,可能是模型乱调、可能是 host 配置写错、也可能是 server 本身起不来。probe 没有模型、没有随机性,它跑不通,问题就一定在 server 或启动命令上。我自己的排查顺序是:先 probe,再 Inspector,最后才去看 Agent 的轨迹。

三是接第三方 server 之前先看一眼。别人的 server 会以你的身份在你电脑上跑,它暴露了哪些工具、哪些会写数据、instructions 里塞了什么话进你的系统提示词,接进 host 之前应该心里有数。这一点到第七部分讲安全时还会再说。

## 第一步:20 行的第一个 client

先写最小的版本:起子进程,列工具,调一次 `find_customer`。

```python
# agent-zero-lab/part05/first_client.py
"""第一个独立的 MCP client:起一个子进程跑 server,列工具,手动调一次。"""
import sys

import anyio
from mcp import Client, StdioServerParameters

params = StdioServerParameters(command=sys.executable, args=["cloudledger/server.py"])


async def main() -> None:
    async with Client(params) as client:
        info = client.server_info
        print("连上了:", info.name if info else "?", "| 协议版本", client.protocol_version)
        tools = await client.list_tools()
        print("工具:", [t.name for t in tools.tools])
        r = await client.call_tool("find_customer", {"query": "user007@example.com"})
        print("is_error =", r.is_error)
        print(r.structured_content)


if __name__ == "__main__":
    anyio.run(main)
```

<div class="line-notes">

- `import sys` 要用 `sys.executable`,也就是当前正在跑这个脚本的 Python 解释器的完整路径,我这里是 `/Users/你/agent-zero-lab/.venv/bin/python`。
- `import anyio` 和 Day 284 一样,用 `anyio.run(main)` 启动异步的 `main`。
- `from mcp import Client, StdioServerParameters` 两个都从 `mcp` 顶层导入。`StdioServerParameters` 是一个「怎么启动 server」的说明书,本身不启动任何东西。
- `params = StdioServerParameters(command=sys.executable, args=["cloudledger/server.py"])` 拼起来就是命令 `/Users/你/agent-zero-lab/.venv/bin/python cloudledger/server.py`。用虚拟环境里的 Python,子进程才找得到 mcp 和 pydantic;`args` 是相对路径,所以必须在 `agent-zero-lab/` 根目录跑这个脚本。相当于 Node 里 `spawn(process.execPath, ["server.js"])`。
- `async with Client(params) as client:` 这一行做了三件事:启动子进程、接上它的 stdin 和 stdout、和 server 谈好协议版本。离开 `with` 时反过来,关掉连接、结束子进程。Day 287 传的是 server 对象,这里传 `params`,类还是同一个。
- `info = client.server_info` server 自报的名字等信息。类型上它可能是 `None`(连上之前没有),所以下一行先判断一下,basedpyright 才不会画红线。
- `print("连上了:", info.name if info else "?"` `A if 条件 else B` 是 Python 的三元表达式,相当于 JS 的 `info ? info.name : "?"`。实测打印 `连上了: cloudledger | 协议版本 2026-07-28`。
- `tools = await client.list_tools()` 发 `tools/list`。
- `print("工具:", [t.name for t in tools.tools])` 实测四个名字。
- `r = await client.call_tool("find_customer", {"query": "user007@example.com"})` 手动调工具。模型调工具时走的也是这一行,只不过参数是模型生成的,明天就会看到。
- `print("is_error =", r.is_error)` 实测 `False`。
- `print(r.structured_content)` 实测 `{'result': [{'id': 'C007', 'name': '刘静', 'email': 'user007@example.com', 'company': '半岛咖啡'}]}`。

</div>

```bash
uv run python part05/first_client.py
```

输出(2026-10-22 实跑):

```text
连上了: cloudledger | 协议版本 2026-07-28
工具: ['find_customer', 'get_subscription', 'list_invoices', 'create_refund_request']
is_error = False
{'result': [{'id': 'C007', 'name': '刘静', 'email': 'user007@example.com', 'company': '半岛咖啡'}]}
```

这个脚本我用 `time` 量了一下,总共 7.7 秒,和昨天 stdio 那一行的几秒是一个量级,几乎全花在启动子进程上。

这个脚本不用 `-m` 跑,因为它没有 import `cloudledger` 包,server 是作为另一个进程启动的。这正是它和昨天测试最大的不同:client 和 server 之间只剩一条命令,client 不知道、也不关心 server 是用什么语言写的。你把 `params` 换成 `StdioServerParameters(command="npx", args=["-y", "某个 Node 写的 server"])`,剩下的代码一行不用改。

## 第二步:拆开 Client,看看里面的两层

`Client` 用起来很省事,可它把好几件事藏起来了。SDK 里还有一组更底层的零件,`Client` 就是用它们拼出来的。拆开看一次,以后读别人的代码、或者 `Client` 不够用时,你知道该往哪层找。

两层分别是:

- **传输层** `stdio_client(params)`:负责启动子进程,把它的 stdout 包装成一条「读流」,stdin 包装成一条「写流」,一行一个 JSON 地收发。它只管搬运,不懂 MCP。
- **会话层** `ClientSession(read, write)`:拿着这两条流,负责 MCP 的事:给每个请求编号、等对应编号的响应、把 JSON 变成 Python 对象,还有最开始的握手。

拿前端打个比方:传输层像 `WebSocket` 对象,只管收发字符串;会话层像你在它上面封装的「请求-响应」小库,发消息时带个 id,收到回复按 id 找到对应的 Promise 去 resolve。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="Client 由两层组成:外层是 Client,里面先是 ClientSession 会话层负责握手、编号和解析,再往下是 stdio_client 传输层负责启动子进程和两条流,最右边是 server 子进程">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12" fill="var(--ink)">
    <rect x="20" y="20" width="400" height="210" fill="none" stroke="var(--mem)" stroke-dasharray="5 4"/>
    <text x="36" y="42">Client(params)</text>
    <text x="300" y="42" font-size="11" fill="var(--ink-faint)">替你做好握手</text>
    <rect x="40" y="60" width="360" height="66" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="56" y="84">会话层 ClientSession(read, write)</text>
    <text x="56" y="106" font-size="11" fill="var(--ink-soft)">握手 / 请求编号 / 等响应 / 解析成对象</text>
    <rect x="40" y="142" width="360" height="66" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="56" y="166">传输层 stdio_client(params)</text>
    <text x="56" y="188" font-size="11" fill="var(--ink-soft)">启动子进程 / 两条流 / 一行一个 JSON</text>
    <rect x="480" y="142" width="140" height="66" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="550" y="170" text-anchor="middle">server</text>
    <text x="550" y="190" text-anchor="middle" font-size="11" fill="var(--ink-soft)">子进程</text>
    <line x1="400" y1="164" x2="480" y2="164" stroke="var(--rule)" stroke-width="1.5"/>
    <line x1="480" y1="188" x2="400" y2="188" stroke="var(--rule)" stroke-width="1.5" stroke-dasharray="4 3"/>
    <text x="440" y="158" text-anchor="middle" font-size="11" fill="var(--ink-faint)">stdin</text>
    <text x="440" y="204" text-anchor="middle" font-size="11" fill="var(--ink-faint)">stdout</text>
    <line x1="220" y1="126" x2="220" y2="142" stroke="var(--rule)" stroke-width="1.5"/>
  </g>
</svg>
<figcaption>`Client` 是外面那个虚线框。今天第二步把它拆开,自己把会话层套在传输层上,再自己发握手。</figcaption>
</figure>

```python
# agent-zero-lab/part05/raw_session.py
"""不用 Client,自己把两层拼起来:stdio_client 给两条流,ClientSession 在流上收发 JSON-RPC。"""
import sys

import anyio
from mcp import ClientSession, StdioServerParameters, stdio_client

params = StdioServerParameters(command=sys.executable, args=["cloudledger/server.py"])


async def main() -> None:
    async with stdio_client(params) as (read, write):
        print("第 1 层 传输:", type(read).__name__, "/", type(write).__name__)
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            print("第 2 层 会话: protocolVersion =", init.protocol_version)
            print("serverInfo =", init.server_info.name)
            print("instructions =", init.instructions)
            print("capabilities =", init.capabilities.model_dump(exclude_none=True))
            tools = await session.list_tools()
            print("tools =", [t.name for t in tools.tools])


if __name__ == "__main__":
    anyio.run(main)
```

<div class="line-notes">

- `from mcp import ClientSession, StdioServerParameters, stdio_client` 三个零件都能从 `mcp` 顶层导入。`stdio_client` 是小写开头的,它是一个函数,不是类。
- `async with stdio_client(params) as (read, write):` 第 1 层。进入时启动子进程,交给你两条流;`as (read, write)` 是解包(Day 22),和 JS 的 `const [read, write] = ...` 一个意思。离开时结束子进程。
- `print("第 1 层 传输:", type(read).__name__` 看看这两条流是什么类型。实测是 `MemoryObjectReceiveStream / MemoryObjectSendStream`:SDK 在后台开了任务,把子进程 stdout 读到的每一行解析好,放进一条内存里的流交给你,写也是同理。昨天的内存连接用的就是同一种流,只是另一头直接接着 server 对象。
- `async with ClientSession(read, write) as session:` 第 2 层。会话套在两条流上。进入 `with` 时只是启动了收消息的后台任务,**还没握手**。
- `init = await session.initialize()` 自己发握手。这是 2025-11-25 及更早版本规范的做法:client 发 `initialize` 请求,带上自己支持的协议版本和能力,server 回自己的。Day 277 讲过新版规范去掉了它。
- `print("第 2 层 会话: protocolVersion =", init.protocol_version)` 实测 `2025-11-25`。注意和第一步 `Client` 谈出来的 `2026-07-28` 不一样:你手动调了老的握手,server 就按老版本跟你说话。我们的 server(mcp 2.3.0)两种都认。
- `print("serverInfo =", init.server_info.name)` 实测 `cloudledger`。
- `print("instructions =", init.instructions)` 实测是 Day 281 写的那句「云簿 CloudLedger 的客户、订阅、发票查询工具。金额对外一律用「元」,内部存「分」。」,host 通常会把它放进系统提示词。
- `print("capabilities =", init.capabilities.model_dump(exclude_none=True))` server 声明自己有哪几样原语。`model_dump` 是 pydantic 对象转字典([Day 52](/blog/agent-zero/day-052-pydantic-2/) 学的),`exclude_none=True` 去掉没填的字段。实测有 prompts、resources、tools 三样。
- `tools = await session.list_tools()` 握手之后才能发正常请求。

</div>

```bash
uv run python part05/raw_session.py
```

输出:

```text
第 1 层 传输: MemoryObjectReceiveStream / MemoryObjectSendStream
第 2 层 会话: protocolVersion = 2025-11-25
serverInfo = cloudledger
instructions = 云簿 CloudLedger 的客户、订阅、发票查询工具。金额对外一律用「元」,内部存「分」。
capabilities = {'prompts': {'list_changed': False}, 'resources': {'subscribe': False, 'list_changed': False}, 'tools': {'list_changed': False}}
tools = ['find_customer', 'get_subscription', 'list_invoices', 'create_refund_request']
```

不握手会怎样?把 `initialize()` 那行去掉、直接 `list_tools`,我单独写了一个文件试:

```python
# agent-zero-lab/part05/raw_no_handshake.py
"""故意不握手:ClientSession 建好后直接 list_tools,看 server 怎么回。"""
import sys

import anyio
from mcp import ClientSession, MCPError, StdioServerParameters, stdio_client

params = StdioServerParameters(command=sys.executable, args=["cloudledger/server.py"])


async def main() -> None:
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            try:
                await session.list_tools()
            except MCPError as e:
                print("没握手就 list_tools ->", type(e).__name__, e.error.code, e.error.message)


if __name__ == "__main__":
    anyio.run(main)
```

<div class="line-notes">

- `async with ClientSession(read, write) as session:` 和上一个脚本一样建会话,但接下来不握手。
- `await session.list_tools()` 直接发请求。会话层不知道该用哪个协议版本,server 也不知道你是谁。
- `except MCPError as e:` server 回了一个 JSON-RPC 错误,客户端把它还原成 `MCPError` 抛出来,和 Day 284 prompt 报错是同一种异常。
- `print("没握手就 list_tools ->"` 打印类名、错误码和文字。

</div>

```bash
uv run python part05/raw_no_handshake.py
```

输出:

```text
没握手就 list_tools -> MCPError -32602 Invalid request parameters
```

-32602 是 Day 275 那张表里的 Invalid params。server 收到一个没有协议版本信息的请求,不知道按哪套规则处理,直接拒了。`Client` 帮你省掉的就是这一步:它进入 `with` 时会先按新版规范发 `server/discover` 问 server 支持哪些版本,对方不认识这个方法就自动退回老的 `initialize`。练习 3 让你自己调一次 `discover()` 看看新版的握手长什么样,第三步马上会看到「自动退回」真的发生。

什么时候需要用这两层而不是 `Client`?大多数时候不需要。我遇到过的情况是:想在一个已经有的传输上跑 MCP(比如别人给了你两条流),或者要精确控制用哪个协议版本做兼容性测试。知道有这一层,看 SDK 源码和报错调用栈时不会迷路就够了。

## 第三步:做成能逛任意 server 的 probe

第一步的 client 只会调 `find_customer`。现在把它改成一个通用工具:启动命令从命令行拿,把 server 暴露的东西全列出来,不调任何工具(调哪个、传什么参数,看完再决定)。

比第一步多出来的东西有四样,我先说清楚再看代码:

- **从命令行拿启动命令**。用 [Day 44](/blog/agent-zero/day-044-notebook-project/) 学过的 `sys.argv`,第一个参数之后的全部当成启动命令。
- **只看 server 声明了的能力**。握手时 server 会告诉你它有没有 tools、resources、prompts(上面输出里的 capabilities),没声明的就别去请求,有的 server 会对没实现的方法报错。
- **翻页**。规范允许 server 把很长的工具列表分页返回,每页带一个 `next_cursor`,拿着它再请求下一页,直到没有。这和前端调分页接口时拿 `nextCursor` 循环请求完全一样。我们的 server 只有 4 个工具,一页就完了,但 probe 是要拿去逛别人的 server 的。
- **把读写注解翻译成人话**。Day 283 给工具贴的 `ToolAnnotations`,probe 把它显示成「只读」「会写」「会写,可能删改」。接第三方 server 时,这一列是我最先看的。

```python
# agent-zero-lab/part05/mcp_probe.py
"""最小 MCP client:不接模型,把任意一个 stdio server 暴露的东西逛一遍。

用法(在 agent-zero-lab 根目录):uv run python part05/mcp_probe.py 启动server的命令 参数...
"""
import sys

import anyio
from mcp import Client, StdioServerParameters
from mcp.types import Tool


def tool_flags(t: Tool) -> str:
    a = t.annotations
    if a is None:
        return "无注解"
    if a.read_only_hint:
        return "只读"
    return "会写" + (",可能删改" if a.destructive_hint is not False else "")


async def all_tools(client: Client) -> list[Tool]:
    tools: list[Tool] = []
    cursor: str | None = None
    while True:
        page = await client.list_tools(cursor=cursor)
        tools += page.tools
        cursor = page.next_cursor
        if not cursor:
            return tools


async def probe(command: list[str]) -> None:
    params = StdioServerParameters(command=command[0], args=command[1:])
    async with Client(params) as c:
        info = c.server_info
        print(f"server: {info.name if info else '(没报名字)'} | 协议: {c.protocol_version}")
        text = c.instructions or ""
        print(f"instructions: {len(text)} 字 | {text.strip().splitlines()[0][:60] if text else '(无)'}")

        caps = c.server_capabilities
        if caps.tools:
            for t in await all_tools(c):
                required = t.input_schema.get("required", [])
                first = (t.description or "").strip().splitlines()[0][:60] if t.description else ""
                print(f"[tool] {t.name} ({tool_flags(t)}) 必填 {required} | {first}")
        if caps.resources:
            res = await c.list_resources()
            more = " (还有下一页)" if res.next_cursor else ""
            print(f"[resource] {len(res.resources)} 个{more}:", [str(r.uri) for r in res.resources[:3]])
        if caps.prompts:
            print("[prompt]", [p.name for p in (await c.list_prompts()).prompts])
        print("没声明的能力:", [k for k in ("tools", "resources", "prompts") if getattr(caps, k) is None])


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("用法: uv run python part05/mcp_probe.py 启动server的命令 参数...")
    anyio.run(probe, sys.argv[1:])
```

<div class="line-notes">

- `用法(在 agent-zero-lab 根目录)` 模块 docstring 里写清楚怎么用,半年后的你会感谢现在的你。
- `from mcp.types import Tool` 工具对象的类型,下面两个函数的标注要用。
- `def tool_flags(t: Tool) -> str:` 把注解翻成一个短标签。
- `a = t.annotations` 没贴注解的工具这里是 `None`。
- `if a.read_only_hint:` Day 283 给三个查询工具贴了 `read_only_hint=True`,它们会显示「只读」。
- `return "会写" + (",可能删改" if a.destructive_hint is not False else "")` 规范里 `destructive_hint` 默认按 `true` 理解:没说「不删改」就当它可能删改。所以这里判断的是 `is not False`,`None`(没写)也算可能删改。`create_refund_request` 写了 `destructive_hint=False`,显示「会写」。宁可多吓自己一下,这是安全上的取舍。
- `async def all_tools(client: Client) -> list[Tool]:` 把分页的工具列表拼成一个完整列表。
- `cursor: str | None = None` 第一页不带 cursor。
- `while True:` 一直翻,直到最后一页才 `return`。相当于 JS 里 `do { ... } while (cursor)`。
- `page = await client.list_tools(cursor=cursor)` 把上一页给的 cursor 原样带回去。cursor 是一个不透明的字符串,client 不该去解析它。
- `tools += page.tools` 列表拼接,相当于 `tools.push(...page.tools)`。
- `cursor = page.next_cursor` 没有下一页时是 `None`,实测我们的 server 一页就完。
- `params = StdioServerParameters(command=command[0], args=command[1:])` 命令行拿到的是一串词,第一个是程序名,剩下的是参数。`command[1:]` 是切片(Day 21),从第 2 个取到最后,相当于 JS 的 `command.slice(1)`。
- `print(f"server: {info.name if info else '(没报名字)'}` f-string 里外层用了双引号,里面的字符串就用单引号。
- `text = c.instructions or ""` 没有 instructions 时是 `None`,`or ""` 变成空字符串,相当于 `?? ""`。
- `print(f"instructions: {len(text)} 字 |` 只打长度和第一行前 60 个字。第三方 server 的 instructions 可能很长,而且会进你的系统提示词,长度本身就值得注意。
- `caps = c.server_capabilities` 握手时 server 声明的能力。
- `if caps.tools:` server 声明了有工具才去列。
- `required = t.input_schema.get("required", [])` `input_schema` 是一个 JSON Schema 字典,`required` 列出必填参数。`.get(键, 默认值)` 取不到就用 `[]`(Day 24)。
- `first = (t.description or "").strip().splitlines()[0][:60] if t.description else ""` 描述只取第一行前 60 个字,不然多行 docstring 会刷屏。
- `print(f"[tool] {t.name} ({tool_flags(t)}) 必填 {required} | {first}")` 一个工具一行:名字、读写、必填参数、描述。
- `res = await c.list_resources()` resource 也可能分页,这里只取第一页,有下一页就标出来,不全翻。
- `print(f"[resource] {len(res.resources)} 个{more}:", [str(r.uri) for r in res.resources[:3]])` 只显示前 3 个地址。有的 server 把每个文件都挂成一个 resource,可能有几千个。
- `print("[prompt]"` prompt 一般不多,全列。
- `print("没声明的能力:", [k for k in ("tools", "resources", "prompts") if getattr(caps, k) is None])` `getattr(对象, "名字")` 按字符串取属性,相当于 JS 的 `caps[k]`。
- `if len(sys.argv) < 2:` 没给启动命令就退出。`sys.argv[0]` 是脚本自己的路径,所以至少要有 2 个。
- `sys.exit("用法:` 传字符串给 `sys.exit` 会把它打到 stderr 并以退出码 1 结束(Day 44)。
- `anyio.run(probe, sys.argv[1:])` `anyio.run` 的第二个参数起是传给 `probe` 的参数。

</div>

先拿我们自己的 server 试。启动命令写在 probe 后面,和你以后写进 Claude Code 配置里的那条是同一条:

```bash
uv run python part05/mcp_probe.py uv run python cloudledger/server.py
```

输出:

```text
server: cloudledger | 协议: 2026-07-28
instructions: 47 字 | 云簿 CloudLedger 的客户、订阅、发票查询工具。金额对外一律用「元」,内部存「分」。
[tool] find_customer (只读) 必填 ['query'] | 按邮箱/姓名/公司/编号查找客户,返回最多 5 条。查订阅和发票前先用它拿到 customer_id。
[tool] get_subscription (只读) 必填 ['customer_id'] | 查询客户当前订阅:套餐、计费周期、席位数、状态、开始日期、本期结束日。
[tool] list_invoices (只读) 必填 ['customer_id'] | 列出客户最近的发票(按开票日期倒序),金额单位为元。可按状态过滤。
[tool] create_refund_request (会写) 必填 ['invoice_id', 'amount_yuan', 'reason'] | 提交一条退款申请,状态为 pending_approval,不会立刻退钱,需要客服主管审批。
[resource] 1 个: ['cloudledger://policy/refund']
[prompt] ['reply_ticket']
没声明的能力: []
```

命令里出现了两次 `uv run`:第一次是跑 probe,第二次是 probe 用来启动 server 的命令。这个嵌套看着奇怪,但很有用,它和 host 的做法一模一样。

再逛一个别人写的 server。MCP 官方仓库里有一个时间 server `mcp-server-time`,发布在 PyPI 上。2026 年 10 月查到最新版是 10 月 19 日发的 2026.10.19,我固定用两个月前的 2026.8.18。版本号写死的理由和 Day 285 固定 Inspector 版本一样;另外这个旧版本依赖的是 mcp 1.x(`mcp<2,>=1.29.0`),正好拿来看新 client 连老 server 会怎样。

```bash
uv run python part05/mcp_probe.py uvx mcp-server-time@2026.8.18
```

终端里先会刷出一大段 `WARNING`,开头是这样的:

```text
WARNING:root:Failed to validate request: 31 validation errors for ClientRequest
PingRequest.method
  Input should be 'ping' [type=literal_error, input_value='server/discover', input_type=str]
```

然后才是 probe 的输出:

```text
server: mcp-time | 协议: 2025-11-25
instructions: 0 字 | (无)
[tool] get_current_time (只读) 必填 ['timezone'] | Get current time in a specific timezone
[tool] convert_time (只读) 必填 ['source_timezone', 'time', 'target_timezone'] | Convert time between timezones
没声明的能力: ['resources', 'prompts']
```

这段 WARNING 不是我们的错,它是老 server 写到 stderr 的日志。我们的 `Client` 先按 2026-07-28 版规范发了一个 `server/discover`,mcp 1.x 的 server 不认识这个方法,把它挨个和自己认识的 31 种请求比了一遍都对不上,于是打出这段日志并回了错误。`Client` 收到错误就退回老的 `initialize` 握手,所以最后的协议版本是 `2025-11-25`。第二步讲的「自动退回」,这里实实在在发生了一次。

再看内容:两个工具都是只读,必填参数一目了然;没有 resource 和 prompt;没有 instructions。这样的 server 接进 host 我是放心的。如果哪天你 probe 一个「天气 server」,看到它有一个 `run_command (会写,可能删改)`,或者 instructions 有两千字,就该停下来先读它的源码。

## 用 probe 抓一个内存测试测不到的问题

昨天说过,内存测试测不到 stdout 污染。现在实跑给你看。写一个故意犯错的小 server:import 时 `print` 了一句欢迎语。

```python
# agent-zero-lab/part05/noisy_server.py
"""反面教材:启动时往 stdout 打了一行欢迎语。"""
from mcp.server import MCPServer

mcp = MCPServer("noisy")
print("noisy server 启动啦")


@mcp.tool()
def ping() -> str:
    """回一个 pong。"""
    return "pong"


if __name__ == "__main__":
    mcp.run()
```

<div class="line-notes">

- `mcp = MCPServer("noisy")` 一个最小的 server。
- `print("noisy server 启动啦")` 罪魁祸首。它在模块顶层,不管是被 import 还是直接运行都会执行。很多人写 server 时顺手加一句这种提示,或者某个依赖库启动时自己往 stdout 打一行版本信息,效果一样。
- `def ping() -> str:` 只有一个工具,返回 `"pong"`。
- `mcp.run()` 默认 stdio。

</div>

先用 Day 287 的方式在内存里连它,调一次 `ping`(这几行我放在一个临时脚本里跑,`from part05.noisy_server import mcp` 然后 `Client(mcp)` 调 `ping`,和昨天的测试写法一样):

```text
noisy server 启动啦
内存: {'result': 'pong'}
```

欢迎语打在了终端上,调用完全正常。内存连接根本不经过 stdout,这一行字对它毫无影响,测试会是绿的。

再用 probe 从外面连:

```bash
uv run python part05/mcp_probe.py uv run python part05/noisy_server.py
```

输出(删掉了中间的调用栈):

```text
Failed to parse JSONRPC message from server
Traceback (most recent call last):
  File ".../site-packages/mcp/client/stdio.py", line 222, in _parse_line
    message = types.jsonrpc_message_adapter.validate_json(line, by_name=False)
  ...
pydantic_core._pydantic_core.ValidationError: 1 validation error for union[JSONRPCRequest,JSONRPCNotification,JSONRPCResponse,JSONRPCError]
  Invalid JSON: expected ident at line 1 column 2 [type=json_invalid, input_value='noisy server 启动啦', input_type=str]
server: noisy | 协议: 2026-07-28
instructions: 0 字 | (无)
[tool] ping (无注解) 必填 [] | 回一个 pong。
[resource] 0 个: []
[prompt] []
没声明的能力: []
```

第一行 `Failed to parse JSONRPC message from server`,`input_value='noisy server 启动啦'`:client 从 stdout 读到的第一行根本不是 JSON。Python SDK 的 client 选择打一条错误日志、跳过这一行、继续工作,所以后面还是连上了。但别被「还是连上了」骗了:不同 host 的容忍度不一样,有的会直接断开,有的会把后面的消息也读错位;如果 print 的那段文字恰好是一行合法 JSON,事情会更诡异。Day 285 说过 Inspector 会默默跳过非 JSON 行,连那条错误日志都没有,所以它正常也不能排除这个问题。

修法就是 Day 276 那条铁律:stdio server 里所有给人看的输出都走 logging 写 stderr,stdout 只留给协议。

这一节顺便回答了昨天练习 4 的问题:probe 和内存测试是两层,谁也替代不了谁。

## 零件 → probe 对照表

| 零件 | 哪天学的 | 在 `part05/mcp_probe.py` 的哪一段 |
| --- | --- | --- |
| `StdioServerParameters` + `Client` 起子进程 | 今天第一步 | `probe()` 的前两行 |
| 握手(discover 或 initialize)| 今天第二步、Day 277 | 藏在 `async with Client(params)` 里 |
| `server_info`、`instructions`、`server_capabilities` | 今天第二步 | `probe()` 里打印 server 信息和 `caps` 的几行 |
| 分页 `cursor` / `next_cursor` | 今天第三步 | `all_tools()` |
| `ToolAnnotations` 读写提示 | Day 283 | `tool_flags()` |
| `sys.argv`、`sys.exit` | Day 44 | 文件末尾 `if __name__ == "__main__":` |

## 动手练习

**练习 1:调一次别人的工具。** 照第一步 `first_client.py` 的写法,写 `part05/ex288_time.py`:连 `uvx mcp-server-time@2026.8.18`,调 `get_current_time` 查 `Asia/Shanghai` 的时间;再故意传一个错误时区 `Beijing`,看工具怎么报错。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/ex288_time.py
"""练习 1:用第一个 client 的写法连别人的 server,调它的 get_current_time。"""
import anyio
from mcp import Client, StdioServerParameters
from mcp.types import TextContent

params = StdioServerParameters(command="uvx", args=["mcp-server-time@2026.8.18"])


async def main() -> None:
    async with Client(params) as client:
        print("协议版本:", client.protocol_version)
        r = await client.call_tool("get_current_time", {"timezone": "Asia/Shanghai"})
        print("is_error =", r.is_error)
        block = r.content[0]
        if isinstance(block, TextContent):
            print(block.text)
        r = await client.call_tool("get_current_time", {"timezone": "Beijing"})
        print("is_error =", r.is_error, "|", getattr(r.content[0], "text", ""))


if __name__ == "__main__":
    anyio.run(main)
```

<div class="line-notes">

- `params = StdioServerParameters(command="uvx", args=["mcp-server-time@2026.8.18"])` 启动命令换成 `uvx`,其余代码和第一步一样。这就是「client 不关心 server 怎么写的」。
- `print("协议版本:", client.protocol_version)` 实测 `2025-11-25`,老 server 走了退回路线。
- `r = await client.call_tool("get_current_time", {"timezone": "Asia/Shanghai"})` 参数名和必填项来自 probe 的输出 `必填 ['timezone']`。先 probe 再调,就是这么用的。
- `block = r.content[0]` 这个老 server 没有 `structured_content`,结果是一段文字。
- `if isinstance(block, TextContent):` 先确认是文字块再取 `.text`。
- `print(block.text)` 实测是一段 JSON 文字,`"datetime": "2026-10-22T19:14:05+08:00"`。
- `r = await client.call_tool("get_current_time", {"timezone": "Beijing"})` 时区名要用 IANA 写法(`Asia/Shanghai`),`Beijing` 不是合法名字。
- `getattr(r.content[0], "text", "")` 取不到 `text` 属性就给空字符串,一行写完,类型检查也不报错。

</div>

```bash
uv run python part05/ex288_time.py
```

输出(stderr 的 WARNING 省略):

```text
协议版本: 2025-11-25
is_error = False
{
  "timezone": "Asia/Shanghai",
  "datetime": "2026-10-22T19:14:05+08:00",
  "day_of_week": "Thursday",
  "is_dst": false
}
is_error = True | Error processing mcp-server-time query: Invalid timezone: 'No time zone found with key Beijing'
```

错误时区返回的是 `is_error=True` 的正常结果,和我们 Day 282 的 `ToolError` 同一种。不过对比一下文字:它只说了「找不到」,没说该填什么样的名字。模型看到这句大概率会再猜一个,Day 282 的写法会直接告诉它「用 IANA 时区名,如 Asia/Shanghai」。

</details>

**练习 2:server 子进程能看到哪些环境变量?** 写一个只有一个工具的小 server `part05/env_server.py`,工具返回它所在进程的环境变量**名字**(不要返回值)。再写 `part05/probe_env.py`,先 `load_dotenv()` 把 `.env` 读进来,然后用两种方式启动这个 server 各调一次:`StdioServerParameters` 不传 `env`;传 `env={**os.environ}`。比较两次看到的变量个数,以及有没有 `LLM_API_KEY`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/env_server.py
"""练习用的小 server:只有一个工具,告诉你它这个子进程能看到哪些环境变量名(只给名字,不给值)。"""
import os

from mcp.server import MCPServer

mcp = MCPServer("env-peek")


@mcp.tool()
def env_names() -> list[str]:
    """列出 server 进程里所有环境变量的名字。"""
    return sorted(os.environ)


if __name__ == "__main__":
    mcp.run()
```

<div class="line-notes">

- `import os` `os.environ` 是当前进程的环境变量,像一个字典,相当于 Node 的 `process.env`。
- `def env_names() -> list[str]:` 返回列表,SDK 会包成 `{"result": [...]}`。
- `return sorted(os.environ)` 对字典排序得到的是键的列表,只有名字。故意不返回值:值里可能有密钥,而工具结果是要发给模型厂商的。

</div>

```python
# agent-zero-lab/part05/probe_env.py
"""练习 2:同一个 server,默认启动和「把整个 os.environ 传过去」时,它分别能看到哪些环境变量。"""
import os
import sys

import anyio
from dotenv import load_dotenv
from mcp import Client, StdioServerParameters

load_dotenv()  # 把 .env 里的 LLM_API_KEY 等读进本进程的 os.environ


async def names_seen(env: dict[str, str] | None) -> list[str]:
    params = StdioServerParameters(command=sys.executable, args=["part05/env_server.py"], env=env)
    async with Client(params) as c:
        r = await c.call_tool("env_names", {})
    assert r.structured_content is not None
    return r.structured_content["result"]


async def main() -> None:
    print("本进程有 LLM_API_KEY 吗:", "LLM_API_KEY" in os.environ, "| 本进程变量数:", len(os.environ))
    for label, env in [("默认", None), ("全部传过去", {**os.environ})]:
        names = await names_seen(env)
        print(f"{label}: server 看到 {len(names)} 个 | 有 LLM_API_KEY 吗: {'LLM_API_KEY' in names}")
        if env is None:
            print("   ", names)


if __name__ == "__main__":
    anyio.run(main)
```

<div class="line-notes">

- `from dotenv import load_dotenv` python-dotenv([Day 53](/blog/agent-zero/day-053-env-secrets/) 学的),把 `.env` 文件里的键值读进 `os.environ`。
- `load_dotenv()` 执行完,本进程就有了 `LLM_API_KEY`。
- `params = StdioServerParameters(command=sys.executable, args=["part05/env_server.py"], env=env)` `env=None` 是默认值,表示让 SDK 自己决定传什么;传一个字典就是「子进程只能看到这些」。
- `assert r.structured_content is not None` 先排除 None,下一行取值才安全。
- `("全部传过去", {**os.environ})` `{**字典}` 是复制一份,相当于 JS 的 `{...process.env}`。
- `if env is None:` 只把默认那次的名字全打出来,全部传过去的有 74 个,太长。

</div>

```bash
uv run python part05/probe_env.py
```

输出:

```text
本进程有 LLM_API_KEY 吗: True | 本进程变量数: 74
默认: server 看到 8 个 | 有 LLM_API_KEY 吗: False
    ['HOME', 'LC_CTYPE', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'USER', '__CF_USER_TEXT_ENCODING']
全部传过去: server 看到 74 个 | 有 LLM_API_KEY 吗: True
```

不传 `env` 时,SDK 只给子进程留了 `HOME`、`PATH`、`SHELL`、`USER` 这类安全的变量,后两个 `LC_CTYPE` 和 `__CF_USER_TEXT_ENCODING` 是 macOS 系统自己加的。你的 `LLM_API_KEY` 没有传过去,这是好事:一个第三方 server 没理由拿到你的模型密钥。反过来说,如果你的 server 确实要读某个环境变量(比如 CloudLedger 的 `CLOUDLEDGER_DB`),就得在 `env` 里显式给它,只给它需要的那几个,别图省事把整个 `os.environ` 塞过去。明天接 Claude Code 时,配置里的 `env` 字段就是干这个的。

</details>

**练习 3:新版握手长什么样。** 照第二步 `raw_session.py` 的结构,把 `session.initialize()` 换成 `session.discover()`,打印 server 支持的版本、会话最后用的版本、serverInfo 和能力。和 `initialize` 的结果比一比。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/ex288_discover.py
"""练习 3:同样手动拼两层,这次用新版协议的 discover() 代替 initialize()。"""
import sys

import anyio
from mcp import ClientSession, StdioServerParameters, stdio_client

params = StdioServerParameters(command=sys.executable, args=["cloudledger/server.py"])


async def main() -> None:
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            found = await session.discover()
            print("server 支持的版本:", found.supported_versions)
            print("会话用的版本:", session.protocol_version)
            print("serverInfo:", session.server_info)
            print("capabilities:", found.capabilities.model_dump(exclude_none=True))
            tools = await session.list_tools()
            print("tools =", [t.name for t in tools.tools])


if __name__ == "__main__":
    anyio.run(main)
```

<div class="line-notes">

- `found = await session.discover()` 发 `server/discover`。它不是「谈判」,而是「问一下」:server 回答自己支持哪些版本和能力,之后每个请求自己带上版本号(Day 277 讲的无状态)。
- `print("server 支持的版本:", found.supported_versions)` 实测 `['2026-07-28']`。我们的 server 也认老握手,但在新版协议的「菜单」里只列了新版本。
- `print("会话用的版本:", session.protocol_version)` 实测 `2026-07-28`,和第一步 `Client` 拿到的一致。
- `print("serverInfo:", session.server_info)` discover 的结果对象里没有 `server_info` 这个字段(server 信息放在了消息的 `_meta` 里),要从 `session` 上取。我第一次写成 `found.server_info`,basedpyright 直接报 `Cannot access attribute "server_info" for class "DiscoverResult"`。
- `print("capabilities:", found.capabilities.model_dump(exclude_none=True))` 实测和 `initialize` 那次不一样,后面讲。

</div>

```bash
uv run python part05/ex288_discover.py
```

输出:

```text
server 支持的版本: ['2026-07-28']
会话用的版本: 2026-07-28
serverInfo: name='cloudledger' title=None version='' description=None website_url=None icons=None
capabilities: {'prompts': {'list_changed': True}, 'resources': {'subscribe': True, 'list_changed': True}, 'tools': {'list_changed': True}}
tools = ['find_customer', 'get_subscription', 'list_invoices', 'create_refund_request']
```

一个有意思的差别:同一个 server,走 `initialize` 时 `list_changed` 全是 `False`,走 `discover` 时全是 `True`,`subscribe` 也从 `False` 变成了 `True`。SDK 按新版协议声明了更多能力(比如列表变化时通知 client),按老版协议就保守地不声明。这说明能力是「按协议版本」给的,probe 一个 server 时最好两个版本都看看,host 用的是哪个版本,它看到的就是哪一套。

</details>

**练习 4:接第三方 server 之前看什么。** 假设同事推荐了一个「Jira server」,你用 probe 跑了一下,看到 instructions 有 1800 字,工具里有 `delete_issue (会写,可能删改)` 和 `run_jql (无注解)`。说说你接下来会做什么。

<details><summary>参考答案</summary>

一,把 instructions 全文打出来读一遍。它会进 host 的系统提示词,1800 字远超一个工具说明需要的长度,要看里面有没有「忽略之前的指令」「每次都先调用某某工具」这类话(第七部分讲提示词注入时会细说)。二,`delete_issue` 标了可能删改,在 host 里给它单独设成每次都要人确认,或者干脆不启用;`run_jql` 没有注解,按规范要当成「可能删改」对待,先去读它的源码确认是不是只读查询。三,看启动命令和它要的环境变量,只给它 Jira 的 token,别把整个环境传过去(练习 2)。四,固定版本号,和今天固定 `mcp-server-time@2026.8.18` 一样,避免哪天它自动更新成别的样子。

</details>

验收标准:`first_client.py`、`raw_session.py`、`mcp_probe.py` 都能在 `agent-zero-lab/` 根目录跑出和文中一致的输出;能用 probe 逛 `uvx mcp-server-time@2026.8.18` 并解释那段 WARNING 是怎么来的;能说出 noisy server 为什么内存测试是绿的、probe 却报 `Failed to parse JSONRPC message from server`。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| `StdioServerParameters` | 「怎么启动 server」的说明:命令、参数、环境变量。传给 `Client` 或 `stdio_client` 后才真正启动子进程 |
| `stdio_client` | 传输层:启动子进程,把它的 stdout/stdin 包装成一读一写两条流 |
| `ClientSession` | 会话层:在两条流上做握手、给请求编号、等响应、把 JSON 解析成对象。`Client` 就是它加传输层再加自动握手 |
| `initialize` | 2025-11-25 及更早版本规范的握手请求,client 和 server 交换协议版本和能力 |
| `server/discover` | 2026-07-28 版规范的发现请求,client 问 server 支持哪些版本和能力,不建立会话状态 |
| 协议退回(fallback) | 新 client 发 `server/discover` 被老 server 拒绝后,自动改用 `initialize` 连接 |
| capabilities | server 在握手时声明的能力,比如有没有 tools、resources、prompts,列表变化时会不会通知 |
| cursor 分页 | 列表接口每页返回一个 `next_cursor`,拿着它请求下一页,没有就是最后一页 |
| probe | 这里指一个不接模型、只用来连上 server 看它暴露了什么的小工具 |
| `uvx` | uv 自带的「临时下载一个 Python 包并运行它的命令行」的命令,相当于 `npx` |

## 常见误区

**`args` 里写相对路径,换个目录就跑不了。** `StdioServerParameters(command=sys.executable, args=["cloudledger/server.py"])` 只在 `agent-zero-lab/` 根目录下有效,我换到另一个目录实跑,子进程先报 `can't open file '/当前目录/cloudledger/server.py': [Errno 2] No such file or directory` 然后退出,client 这边收到的是 `MCPError: Connection closed`。自己在终端跑没问题,交给 host 时一定要写绝对路径,明天会实测这个坑。

**`command` 写成 `python` 而不是虚拟环境的 Python。** 系统里的 `python` 可能是 3.10,也没装 mcp,子进程一启动就会因为 import 不到 mcp 而退出,client 这边和上一条一样只看到 `Connection closed`,真正的原因在子进程的 stderr 里(这一条我没有单独实跑,原理和上一条相同)。用 `sys.executable` 或者 `uv run --directory 项目目录 python ...`。

**看到一大段 WARNING 就以为自己的 client 写错了。** 连老 server 时那段 `Failed to validate request ... server/discover` 是对方 server 写到 stderr 的日志,是新旧协议「问路」的正常过程,最后协议版本是 `2025-11-25` 就说明退回成功了。

**拿 `ClientSession` 不握手就发请求。** 实测 `MCPError -32602 Invalid request parameters`。用底层零件时,先 `initialize()` 或 `discover()`;不需要控制这些细节就直接用 `Client`。

**以为 client 能连上就说明 stdout 干净。** Python SDK 的 client 遇到非 JSON 行只打一条错误日志然后继续,Inspector 连日志都没有。要看 probe 输出最前面有没有 `Failed to parse JSONRPC message from server`。

**图省事把整个 `os.environ` 传给第三方 server。** 练习 2 实测,这样它就能看到你的 `LLM_API_KEY`。默认不传时 SDK 只给 8 个安全变量,需要什么就在 `env` 里只加什么。

## 学习资料

### 文档与文章

- [MCP Python SDK v2 · Client](https://py.sdk.modelcontextprotocol.io/v2/client/):`Client` 能接受的几种 server 参数(对象、`StdioServerParameters`、URL)和常用方法,今天第一步的官方版本。
- [MCP Python SDK v2 · Transports](https://py.sdk.modelcontextprotocol.io/v2/client/transports/):`stdio_client` 和 HTTP 传输的说明,第二步「传输层」那一半的出处。
- [MCP 官方 · Build an MCP client](https://modelcontextprotocol.io/docs/develop/build-client):官方的 client 教程,后半段把 client 接上模型,正好是明天的内容,可以先扫一眼。
- [MCP 规范 2026-07-28 · Lifecycle](https://modelcontextprotocol.io/specification/2026-07-28/basic/lifecycle):新版的发现流程和对老版本 `initialize` 的兼容要求,对照第二步和练习 3 看。
- [MCP Python SDK v2 · 迁移指南](https://py.sdk.modelcontextprotocol.io/v2/migration/):网上 1.x 时代的 client 教程大多是 `ClientSession` 加 `initialize()` 的写法,和第二步一样;2.x 推荐直接用 `Client`,这里有对照。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1keLoznEx7&autoplay=0&high_quality=1" title="【全新揭秘】MCP Client大揭秘,带你实现MCP客户端并详解原理|DeepSeek接入MCP生态|了解JSON-RPC|对比FunctionCalling" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>小全栈 · MCP Client 大揭秘,带你实现 MCP 客户端并详解原理 · 前半段讲 client 怎么启动 server、怎么握手,和第二步对照;视频是 2025 年 4 月的,用的是 1.x 的 `ClientSession` 加 `initialize` 写法,后半段接 DeepSeek 是明天的内容。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/mhdGVbJBswA" title="Create an MCP Client in Python - FastAPI Tutorial" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Alejandro AO · Create an MCP Client in Python · 从零写一个 Python client,看他怎么组织「连接、列工具、调工具」三步;SDK 版本较老,类名以迁移指南为准。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/RhTiAOGwbYE" title="MCP Tutorial: Build Your First MCP Server and Client from Scratch (Free Labs)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>KodeKloud · MCP Tutorial: Build Your First MCP Server and Client from Scratch · server 和 client 一起从头写,适合把本周两头串起来复习。</figcaption>
</figure>

### 书籍

- Christoffer Noring,《Learn Model Context Protocol with Python》,Packt,2025。有专门讲写 client 的章节,书写于 1.x 时代,用的是 `ClientSession` 那一套,读的时候对照今天第二步。中文版暂未查到。

### 开源项目与代码

- [modelcontextprotocol/servers · time](https://github.com/modelcontextprotocol/servers/tree/main/src/time):今天逛的时间 server 的源码,一百多行,对照 probe 的输出看它的两个工具是怎么定义的。
- [mcp-server-time 的 PyPI 页面](https://pypi.org/project/mcp-server-time/):Release history 里能看到每个版本的发布日期,选版本号时来这里看。
- [modelcontextprotocol/python-sdk](https://github.com/modelcontextprotocol/python-sdk):`src/mcp/client/stdio.py` 里能找到 `Failed to parse JSONRPC message from server` 这句日志,看它遇到非 JSON 行时是怎么处理的。

## 自测

1. `Client(params)` 进入 `async with` 时做了哪几件事?

<details><summary>答案</summary>

按 `params` 里的命令启动 server 子进程;把子进程的 stdout 和 stdin 包装成读写两条流(传输层);在流上建会话(会话层);先发 `server/discover` 问支持的版本,对方不认识就退回 `initialize` 握手。离开 `with` 时关闭会话、结束子进程。

</details>

2. 同一个 CloudLedger server,第一步 `Client` 拿到的协议版本是 2026-07-28,第二步 `raw_session.py` 拿到的是 2025-11-25,为什么?

<details><summary>答案</summary>

第二步手动调了 `session.initialize()`,这是老版本规范的握手,server 就按老版本回应。`Client` 默认先走新版的 `server/discover`,我们的 server(mcp 2.3.0)认识它,所以用了新版本。练习 3 改成 `discover()` 后,手动拼的会话也是 2026-07-28。

</details>

3. noisy server 在内存测试里是绿的,用 probe 连却报 `Failed to parse JSONRPC message from server`,为什么?

<details><summary>答案</summary>

stdio 传输里 server 的 stdout 就是发给 client 的消息通道,client 期望每一行都是一条 JSON-RPC 消息。`print` 的那行欢迎语混进了这条通道,client 解析失败。内存连接不经过 stdout,print 的内容只是打在终端上,对通信没有影响,所以测不出来。修法是 server 里所有日志都走 logging 写 stderr。

</details>

4. probe 为什么要按 `server_capabilities` 判断要不要列 resources 和 prompts,而不是全都请求一遍?

<details><summary>答案</summary>

server 没声明的能力,它可能根本没实现对应的方法,请求了会收到「方法不存在」的 JSON-RPC 错误,probe 就中断了。按 capabilities 来,对只提供工具的 server(比如 mcp-server-time)也能干净地跑完,并且「没声明的能力」这一行本身就是有用的信息。

</details>

5. 面试题:线上 Agent 报「MCP 工具调用失败」,你怎么定位问题在模型、host 还是 server?

<details><summary>答案</summary>

从最确定的一层往上排。先用一个不接模型的最小 client(probe),拿 host 配置里**一模一样**的启动命令和环境变量把 server 拉起来,列工具、手动调一次出问题的工具:这一步失败,问题就在 server 或启动配置(路径、依赖、环境变量、stdout 污染),和模型无关。这一步成功,再用 Inspector 或 host 的 MCP 日志看 host 发出的真实请求,对比参数和协议版本,看是不是 host 配置或版本兼容问题。前两步都正常,才去看 Agent 的轨迹,检查模型传的参数是不是不合 schema、是不是在错误信息之后没改正,这时候要改的是工具描述和错误提示。probe 没有随机性,所以它放在最前面。

</details>

## 明天预告

Day 289 · 写 MCP server(九):接进现成 host,自己当 host。今天的 probe 是一个「不带脑子」的 client,工具调哪个、传什么都是我们写死的。明天给它接上脑子,分两条路:一条是把 CloudLedger server 配进 Claude Code(以及 Claude Desktop 的配置写法),看现成的 host 怎么列工具、怎么在调写工具前要你点头;另一条是自己当 host,把 Day 170 的 Agent 循环和今天的 `Client` 接起来,工具清单从 server 拿,模型的调用转发给 server。
