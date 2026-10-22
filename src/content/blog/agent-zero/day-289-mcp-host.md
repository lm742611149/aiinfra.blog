---
title: 'Day 289 · 写 MCP server(九):接进现成 host,自己当 host'
description: 'CloudLedger server 写完、测完、probe 过了,今天让模型真正用上它。先接进 Claude Code(一条 claude mcp add,绝对路径是关键),看它怎么列工具、怎么在调写工具前停下来要授权,再看 Claude Desktop 的配置写法;然后自己当 host:把 Day 170 的 Agent 循环和 MCP Client 接起来,工具清单从 server 拿,调用转发给 server,写工具没授权就拦下。'
pubDate: 2026-10-22
regime: none
tags: ['mcp', 'mcp-host', 'claude-code', 'agent-loop', 'cloudledger', 'agent-zero']
series: 'agent-zero'
day: 289
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 288](/blog/agent-zero/day-288-mcp-client/) 写了一个不接模型的最小 client:`first_client.py` 20 行连上 CloudLedger 调一次工具;`raw_session.py` 把 `Client` 拆成 `stdio_client`(传输)和 `ClientSession`(会话)两层,看到不握手会被 -32602 拒绝;`mcp_probe.py` 能逛任意 stdio server,我们拿它看了 `mcp-server-time`,还抓出一个往 stdout 打字的 server。

probe 是一个「没有脑子」的 client,调哪个工具、传什么参数都是我们写死的。今天给它接上脑子。有两条路:用别人做好的 host(Claude Code、Claude Desktop),或者自己写 host。做产品时你多半要走第二条,但先走一遍第一条,看清楚一个成熟的 host 替你做了哪些事,自己写的时候才知道不能漏什么。

## 今天要解决的问题

学完今天,你要能做到:

1. 用 `claude mcp add` 把 CloudLedger server 接进 Claude Code,用 `claude mcp list` 确认连上;说清楚为什么启动命令里的路径必须是绝对路径,并亲眼看到相对路径怎么失败。
2. 知道 Claude Desktop 的配置文件在哪、长什么样,改完为什么要完全退出再打开,连不上去哪看日志。
3. 写出 `part05/mcp_agent.py`:把 [Day 170](/blog/agent-zero/day-170-agent-full/) 的 Agent 循环接到 MCP server 上,做好两个转换(MCP 工具 → OpenAI 的 `tools` 参数,`CallToolResult` → `role=tool` 消息),并让 host 在没授权时拦下写工具。
4. 跑通「客户说 10 月被扣了两次款」这个任务,对比拦截写工具和放行写工具两种结果。

预计用时 3 小时。实跑花费约 ¥0.07(算式在文末「花了多少钱」一节)。

前置:[Day 170](/blog/agent-zero/day-170-agent-full/)(`part03/agent_loop.py` 的 `run_agent`)、[Day 135](/blog/agent-zero/day-135-llm-client-1/) 到 [Day 137](/blog/agent-zero/day-137-llm-client-3/)(`common/llm.py` 的 `LLMClient`)、[Day 159](/blog/agent-zero/day-159-tool-roundtrip/)(`tool_call_id` 和 `role=tool` 消息)、[Day 283](/blog/agent-zero/day-283-mcp-read-write/)(`ToolAnnotations`)、[Day 284](/blog/agent-zero/day-284-mcp-resource-prompt/)(完整 server,以及 Claude Code 里 `@` 和 `/` 怎么用 resource 和 prompt)、[Day 288](/blog/agent-zero/day-288-mcp-client/)(`Client`、probe、环境变量那道练习)。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

命令都在 `agent-zero-lab/` 根目录跑(我的是 `/Users/你/agent-zero-lab`)。`.env` 里要有 [Day 120](/blog/agent-zero/day-120-api-register/) 配好的模型变量,`LLMClient` 从这里读:

```bash
# agent-zero-lab/.env(只列今天用到的几行)
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=sk-你的key
LLM_MODEL=deepseek-flash
LLM_EXTRA_BODY={"thinking": {"type": "disabled"}}
LLM_PRICE=0.04,2,8
```

`LLM_PRICE` 是缓存命中、缓存未命中、输出三档价格,单位元每百万 token。2026 年 10 月查 [DeepSeek 中文定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing),`deepseek-flash` 高峰时段(北京时间工作日 9–12 点、14–18 点)就是 0.04、2、8,其余时间减半。`LLMClient` 按高峰价算,宁可算多。

## 接进 Claude Code

### 先在终端确认启动命令能跑

host 启动 server 时,工作目录不是你的项目目录,环境变量也不是你终端里那一套。所以接进任何 host 之前,先把要写进配置的那条命令在终端里跑一遍,用 Day 288 的 probe 跑最省事:

```bash
uv run python part05/mcp_probe.py uv run --directory /Users/你/agent-zero-lab python cloudledger/server.py
```

`uv run --directory 某目录` 的意思是「先切到这个目录、用这个目录的虚拟环境,再执行后面的命令」,相当于 `cd 某目录 && uv run ...`,但不改变你当前所在的目录。有了它,`cloudledger/server.py` 这个相对路径就总是相对于项目根目录,从哪里启动都一样。probe 能列出四个工具,这条命令就能用。

### 一条命令加进去

```bash
cd /Users/你/agent-zero-lab
claude mcp add cloudledger -- uv run --directory /Users/你/agent-zero-lab python cloudledger/server.py
```

`--` 前面是 Claude Code 自己的选项,后面原样当成启动 server 的命令。[官方文档](https://code.claude.com/docs/en/mcp)原话是 everything after `--` is passed to the server untouched。`cloudledger` 是你给这个 server 起的名字,之后它的工具在 Claude Code 里会叫 `mcp__cloudledger__find_customer` 这种格式。

我实跑的输出:

```text
Added stdio MCP server cloudledger with command: uv run --directory /Users/你/agent-zero-lab python cloudledger/server.py to local config
File modified: /Users/你/.claude.json [project: /Users/你/agent-zero-lab]
```

先说一下我是怎么实跑的。为了不动我电脑上真实的 Claude Code 配置,我把 `HOME` 环境变量临时指到了 scratchpad 里一个空目录再执行,所以 Claude Code 把配置写进了那个假的 `~/.claude.json`。输出里的路径我替换成了 `/Users/你`。你自己学的时候不用这么做,直接在自己电脑上跑就行。

输出最后一句 `to local config` 对应 `--scope` 选项的默认值 `local`:只在当前项目(也就是你执行命令时所在的目录)里对你自己生效,存在 `~/.claude.json` 里这个项目的条目下。另外两个选项是 `project`(写进项目根目录的 `.mcp.json`,提交到仓库里给团队共用)和 `user`(你所有项目都能用)。CloudLedger 只和这个练习仓库有关,用默认的 `local` 正好。

### 确认连上了

```bash
claude mcp list
```

```text
Checking MCP server health…

cloudledger: uv run --directory /Users/你/agent-zero-lab python cloudledger/server.py - ✔ Connected
```

`claude mcp list` 会真的把每个 server 拉起来试一次,显示 `✔ Connected` 才算数。进了 Claude Code 的交互界面,输入 `/mcp` 能看到同样的状态,以及每个 server 有几个工具。

### 故意写一次相对路径

为什么非要绝对路径?实测一次就明白了。我用 `--scope user`(所有目录都生效)加了一个用相对路径的版本:

```bash
claude mcp add --scope user cl-relative -- uv run python cloudledger/server.py
```

然后换到另一个目录执行 `claude mcp list`:

```text
cl-relative: uv run python cloudledger/server.py - ✘ Failed to connect — CONNECTION_CLOSED: Connection closed
```

回到 `agent-zero-lab/` 再执行一次,它又变成了 `✔ Connected`。原因很简单:host 在**它自己当前所在的目录**里执行这条命令,`cloudledger/server.py` 只在项目根目录下存在。你在终端里测的时候刚好就在项目根目录,所以永远测不出来,换个目录打开 Claude Code 就挂。错误信息只有一句 `Connection closed`,不告诉你是找不到文件,这也是为什么新手接 MCP 时卡在这里的人最多。试完删掉:`claude mcp remove cl-relative -s user`。

### 让模型用一次

在 `agent-zero-lab/` 里打开 Claude Code,问它:

```text
客户 user007@example.com 说 10 月被扣了两次款,帮我核实一下,确实重复的话提交退款申请。
```

你会看到它第一次调 `find_customer` 时就弹出授权提示,问你允不允许用这个工具。这一点和很多人想的不一样:Day 283 给三个查询工具贴了 `read_only_hint=True`,Claude Code 并不因此就自动放行。注解只是提示,要不要信、怎么用,由 host 决定,Claude Code 的选择是 MCP 工具默认都问你。

我实跑用的是非交互模式 `claude -p`(把问题作为参数传进去,跑完打印结果,不进界面),这样能把每一步记录成 JSON 存下来。模型没有用 Claude,而是通过 DeepSeek 的 [Anthropic 兼容接口](https://api-docs.deepseek.com/zh-cn/guides/anthropic_api)接的 `deepseek-flash`,做法是设置 `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic` 和 `ANTHROPIC_API_KEY`(填 DeepSeek 的 key),再加 `--model deepseek-flash`。同时我加了 `--tools ""`,把 Claude Code 自带的读文件、执行命令等工具全部关掉,只留 MCP 工具,它在我的机器上什么文件都碰不到。这些是我为了省钱和安全做的,你用自己的 Claude 订阅交互使用,结果是一样的流程。

非交互模式里没人点「允许」,所以第一次实跑,模型两次调 `find_customer` 都被拒,最后它写了一段话请我去授权。Claude Code 输出的记录里有一项 `permission_denials`,列出了被拒的两次调用。

第二次我用 `--allowedTools` 只放行三个查询工具:

```bash
claude -p --tools "" \
  --allowedTools "mcp__cloudledger__find_customer,mcp__cloudledger__get_subscription,mcp__cloudledger__list_invoices" \
  --model deepseek-flash --output-format stream-json --verbose \
  "客户 user007@example.com 说 10 月被扣了两次款,帮我核实一下,确实重复的话提交退款申请。"
```

这次它依次调了三个工具,结果和 Day 288 手动调的一模一样:

```text
TOOL_USE mcp__cloudledger__find_customer {"query": "user007@example.com"}
RESULT {"result":[{"id":"C007","name":"刘静","email":"user007@example.com","company":"半岛咖啡"}]}
TOOL_USE mcp__cloudledger__get_subscription {"customer_id": "C007"}
RESULT {"id":"S007","customer_id":"C007","plan":"企业版","billing_cycle":"monthly","seats":8,"status":"active","started_at":"2026-03-15","current_period_end":"2026-11-08"}
TOOL_USE mcp__cloudledger__list_invoices {"customer_id": "C007", "limit": 20}
RESULT {"result":[{"id":"INV-2026-0123","amount_cents":239200,"status":"paid","issued_at":"2026-10-08", ...
TOOL_USE mcp__cloudledger__create_refund_request {"invoice_id": "INV-2026-0123", "amount_yuan": 2392, "reason": "重复扣款:2026-10-08 同日就企业版月付套餐(8 席位)扣款两次,INV-2026-0123 与 INV-2026-0026 金额均为 2392.00 元;..."}
RESULT Claude requested permissions to use mcp__cloudledger__create_refund_request, but you haven't granted it yet.
```

(上面是我用一个小脚本从 `stream-json` 记录里摘出来的工具调用和结果,`...` 是我截短的。)

它的最终回答第一句是「核实完成,重复扣款成立。退款申请我这边已经填好,但提交时**未获得工具授权**(`create_refund_request` 权限未开启),所以申请还没有真正创建」,然后把待提交的发票号、金额、原因列给我,请我确认。我去查了库,`refund_requests` 表还是 0 行。

这正是我们想要的效果:查询放行,写操作要人点头。放行规则也可以写进配置文件,不用每次在命令行写:在项目的 `.claude/settings.json` 里的 `permissions.allow` 列表加上 `"mcp__cloudledger__find_customer"` 这样的条目。[权限文档](https://code.claude.com/docs/en/permissions)写了几种写法:`mcp__cloudledger__*` 匹配这个 server 的所有工具,`mcp__cloudledger__get_*` 匹配名字以 `get_` 开头的。我不推荐对有写工具的 server 用 `*`。

两个我踩到的小问题。一,非交互模式下我有两次拿到的 server 状态是 `pending`(还没连上),工具列表是空的,模型居然编了一段假的 `Bash` 调用文字出来;交互模式里没遇到。我加了环境变量 `MCP_CONNECTION_NONBLOCKING=0` 让它等 server 连上再开始,之后就正常了。这个变量我在官方文档里没查到,是从程序里搜出来的,当作个人经验看,不保证以后的版本还有效。二,DeepSeek 的模型名 Claude Code 不认识,会在 stderr 打一行 `[claude-code:unrecognized_model]`,不影响使用,但它显示的花费是按它自己的价格表估的,不准,我的花费按 token 数自己算。

Day 284 讲过的 resource 和 prompt,在 Claude Code 里也都能用:输入框打 `@` 能选到 `cloudledger:cloudledger://policy/refund`,打 `/` 能看到 `/mcp__cloudledger__reply_ticket`。我实跑的初始化记录里 `slash_commands` 列表确实出现了 `mcp__cloudledger__reply_ticket`。

## Claude Desktop 的写法

Claude Desktop 没有 `claude mcp add` 这样的命令,要改一个 JSON 配置文件。[官方教程](https://modelcontextprotocol.io/docs/develop/connect-local-servers)写的位置是:

- macOS:`~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows:`%APPDATA%\Claude\claude_desktop_config.json`

在 Claude Desktop 里点菜单栏的 Claude → Settings → Developer → Edit Config 会帮你打开它。内容的结构和 Day 288 练习里那个 `StdioServerParameters` 几乎一一对应:

```json
{
  "mcpServers": {
    "cloudledger": {
      "command": "/Users/你/.local/bin/uv",
      "args": ["run", "--directory", "/Users/你/agent-zero-lab", "python", "cloudledger/server.py"],
      "env": {}
    }
  }
}
```

<div class="line-notes">

- `"mcpServers": {` 所有 server 都放在这个对象里,键是名字。Claude Code 的 `.mcp.json`、Cursor 的 `.cursor/mcp.json` 也是这个结构,学一次三处通用。
- `"command": "/Users/你/.local/bin/uv",` 连 `uv` 本身都写了绝对路径(用 `which uv` 查到的)。原因是从程序坞点开的桌面应用,拿不到你在 `~/.zshrc` 里配的 `PATH`,只写 `"uv"` 它可能找不到这个命令。终端里启动的 Claude Code 没有这个问题,因为它继承了终端的环境。
- `"args": ["run", "--directory", "/Users/你/agent-zero-lab", "python", "cloudledger/server.py"],` 和上面 `claude mcp add` 里 `--` 后面那一串完全一样,只是拆成了数组。
- `"env": {}` 要给 server 传的环境变量。Day 288 练习 2 实测过,SDK 默认只给子进程 8 个安全变量,Claude Desktop 也是类似的做法。CloudLedger 想换数据库位置,就在这里写 `"CLOUDLEDGER_DB": "/Users/你/某处/cloudledger.db"`,只写它需要的。

</div>

改完要**完全退出** Claude Desktop(Cmd+Q,或者菜单里 Quit)再打开,只关窗口不算,它启动时才读这个文件。连不上时看 `~/Library/Logs/Claude/` 目录:`mcp.log` 是总的连接日志,`mcp-server-cloudledger.log` 是你的 server 写到 stderr 的全部内容,Day 285 学的「去 Console 看根因」在这里就是看这个文件。

mcp 的命令行工具还能帮你自动写这个文件:`uv run mcp install cloudledger/server.py --name cloudledger`。这一节**我没有在真实的 Claude Desktop 上实跑**,我电脑上不能动用户的真实配置。我看了 SDK 的源码,它找配置目录用的是 `Path.home()`,所以我把 `HOME` 指到 scratchpad 里一个假目录、先建好里面的 `Library/Application Support/Claude/` 文件夹,再执行这条命令,它写出来的是:

```json
{
  "mcpServers": {
    "cloudledger": {
      "command": "/Users/你/.local/bin/uv",
      "args": [
        "run",
        "--frozen",
        "--with",
        "mcp[cli]==2.3.0",
        "mcp",
        "run",
        "/Users/你/agent-zero-lab/cloudledger/server.py"
      ]
    }
  }
}
```

<div class="line-notes">

- `"command": "/Users/你/.local/bin/uv",` 它自动把 `uv` 换成了绝对路径,正好印证上面说的 PATH 问题。
- `"--with",` 加上下一行 `"mcp[cli]==2.3.0"`,意思是「临时建一个只装了 mcp 2.3.0 的环境来跑」,不用你项目的虚拟环境。我们的 server 只依赖 mcp 和它自带的 pydantic,所以够用;如果你的 server 还 import 了别的库(比如 httpx),这种写法就会缺包,要用 `--with-editable 项目目录` 或者回到手写的 `--directory` 写法。
- `"mcp",` 加上下一行 `"run"`,用 mcp 自带的 `mcp run` 命令启动 server,而不是直接 `python server.py`。
- `"/Users/你/agent-zero-lab/cloudledger/server.py"` server 文件也转成了绝对路径。

</div>

文件写出来了,但我没有真的打开 Claude Desktop 去连。为了确认这条命令本身能跑,我在另一个目录下用 probe 执行了一遍完全相同的命令,四个工具、一个 resource、一个 prompt 都列出来了。这又是 Day 288 那个 probe 的用法:任何 host 配置,先拿 probe 跑一下里面的命令。

## 自己当 host:先做两个转换

现成的 host 好用,可它的循环、权限、展示方式都是别人定的。做产品时 host 是你自己写的。核心只有两个转换,外加 Day 170 的循环。

第一个转换:MCP 的 `Tool` → OpenAI 兼容接口的 `tools` 参数。两边描述参数用的都是 JSON Schema([Day 157](/blog/agent-zero/day-157-tool-schema/) 讲过 `tools` 参数的格式),所以基本是把字段换个位置:`tool.input_schema` 放进 `function.parameters`。先写一个小脚本,看转换出来的东西长什么样:

```python
# agent-zero-lab/part05/tools_to_openai.py
"""第一步:把 MCP server 的工具清单转成 OpenAI 兼容的 tools 参数,先看一眼长什么样。"""
import json
import sys

import anyio
from mcp import Client, StdioServerParameters

params = StdioServerParameters(command=sys.executable, args=["cloudledger/server.py"])


async def main() -> None:
    async with Client(params) as client:
        listing = await client.list_tools()
    tools = [
        {"type": "function", "function": {"name": t.name, "description": t.description or "", "parameters": t.input_schema}}
        for t in listing.tools
    ]
    print(len(tools), "个工具,第 2 个转换后是:")
    print(json.dumps(tools[1], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    anyio.run(main)
```

<div class="line-notes">

- `listing = await client.list_tools()` 和 Day 288 一样拿工具清单。拿到之后就离开 `with`、关掉 server,转换不需要连接。
- `{"type": "function", "function": {"name": t.name,` OpenAI 兼容格式要求外面套一层 `type: function`,里面是名字、描述、参数。`t.description or ""` 是因为描述可能是 `None`,接口要字符串。最关键的是 `"parameters": t.input_schema`:`input_schema` 是 SDK 从 Day 281 的函数签名和 `Annotated`/`Field` 生成的 JSON Schema,原封不动交给模型。
- `for t in listing.tools` 四个工具各转一次。
- `print(json.dumps(tools[1], ensure_ascii=False, indent=2))` 打印第 2 个(`get_subscription`),`indent=2` 是缩进两格,相当于 `JSON.stringify(x, null, 2)`。

</div>

```bash
uv run python part05/tools_to_openai.py
```

```text
4 个工具,第 2 个转换后是:
{
  "type": "function",
  "function": {
    "name": "get_subscription",
    "description": "查询客户当前订阅:套餐、计费周期、席位数、状态、开始日期、本期结束日。",
    "parameters": {
      "type": "object",
      "properties": {
        "customer_id": {
          "description": "客户编号,如 C007",
          "pattern": "^C\\d{3}$",
          "title": "Customer Id",
          "type": "string"
        }
      },
      "required": [
        "customer_id"
      ],
      "title": "get_subscriptionArguments"
    }
  }
}
```

Day 281 写的 `Field(description=..., pattern=...)` 全在里面,模型看到的就是这些。`title` 是 pydantic 自动加的,不影响使用。

第二个转换:MCP 的 `CallToolResult` → 一条 `role=tool` 消息的 `content` 字符串。有 `structured_content` 就把它序列化成 JSON;没有(比如 Day 288 的时间 server)就把文字块拼起来;`is_error=True` 时在前面加 `[工具报错]`,让模型明确知道这次失败了,该读错误信息、改参数重试,而不是当成正常数据。

## 自己当 host:接到 Agent 循环上

循环本身就是 Day 170 的 `run_agent`,一行一行对照着看。区别有四处:工具清单从 server 拿,工具调用转发给 server,外面要包一层 `async with Client(...)` 保持连接,以及多了一道 host 自己的权限检查。

为什么要权限检查?刚才 Claude Code 演示了:模型核实完就直接去调 `create_refund_request`,是 host 拦下了它。我们自己写 host,这道闸就得自己做。判断依据就用 Day 283 的注解:`read_only_hint` 不是 `True` 的工具都当作「会写」,默认不放行,要在命令行显式加 `--allow-writes` 才执行。被拦下时不报异常,而是给模型回一条说明,让它把要提交的内容告诉用户。

<figure>
<svg viewBox="0 0 640 310" role="img" aria-label="手写 host 的时序:启动时向 MCP server 要工具清单,之后把消息和工具发给模型,模型返回工具调用,host 先检查是不是写工具,是就拦下回一条说明,不是就转发给 server,server 查 SQLite 后返回结果,结果作为 tool 消息回到模型">
  <rect x="0" y="0" width="640" height="310" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">
    <text x="80" y="26">大模型</text>
    <text x="260" y="26">mcp_agent.py(host)</text>
    <text x="440" y="26">MCP server</text>
    <text x="580" y="26">SQLite</text>
  </g>
  <g stroke="var(--rule)">
    <line x1="80" y1="36" x2="80" y2="300"/>
    <line x1="260" y1="36" x2="260" y2="300"/>
    <line x1="440" y1="36" x2="440" y2="300"/>
    <line x1="580" y1="36" x2="580" y2="300"/>
  </g>
  <g font-family="var(--font-mono)" font-size="11">
    <line x1="260" y1="55" x2="440" y2="55" stroke="var(--compute)" stroke-width="1.5"/>
    <text x="350" y="50" text-anchor="middle" fill="var(--ink-soft)">① tools/list</text>
    <line x1="440" y1="72" x2="260" y2="72" stroke="var(--compute)" stroke-dasharray="4 3"/>
    <text x="350" y="86" text-anchor="middle" fill="var(--ink-faint)">4 个工具 → tools 参数</text>
    <line x1="260" y1="110" x2="80" y2="110" stroke="var(--mem)" stroke-width="1.5"/>
    <text x="170" y="105" text-anchor="middle" fill="var(--ink-soft)">② messages + tools</text>
    <line x1="80" y1="130" x2="260" y2="130" stroke="var(--mem)" stroke-dasharray="4 3"/>
    <text x="170" y="145" text-anchor="middle" fill="var(--ink-faint)">tool_calls</text>
    <rect x="200" y="155" width="120" height="26" fill="var(--paper-raised)" stroke="var(--ink-faint)"/>
    <text x="260" y="172" text-anchor="middle" fill="var(--ink-soft)">写工具?拦下</text>
    <line x1="260" y1="200" x2="440" y2="200" stroke="var(--compute)" stroke-width="1.5"/>
    <text x="350" y="195" text-anchor="middle" fill="var(--ink-soft)">③ tools/call</text>
    <line x1="440" y1="212" x2="580" y2="212" stroke="var(--rule)"/>
    <text x="510" y="207" text-anchor="middle" fill="var(--ink-faint)">SELECT</text>
    <line x1="440" y1="232" x2="260" y2="232" stroke="var(--compute)" stroke-dasharray="4 3"/>
    <text x="350" y="246" text-anchor="middle" fill="var(--ink-faint)">CallToolResult</text>
    <line x1="260" y1="270" x2="80" y2="270" stroke="var(--mem)" stroke-width="1.5"/>
    <text x="170" y="265" text-anchor="middle" fill="var(--ink-soft)">④ role=tool 消息</text>
    <text x="170" y="292" text-anchor="middle" fill="var(--ink-faint)">循环,直到不再调用工具</text>
  </g>
</svg>
<figcaption>蓝色是 function calling(模型和 host 之间),琥珀色是 MCP(host 和 server 之间)。Day 278 说「两者在不同层」,这张图里一目了然;中间那个小框是 host 自己加的权限闸。</figcaption>
</figure>

```python
# agent-zero-lab/part05/mcp_agent.py
"""自己当 host:Day 170 的 Agent 循环,工具清单从 MCP server 拿,工具调用转发给 MCP server。"""
import json
import sys
from pathlib import Path
from typing import Any

import anyio
from mcp import Client, StdioServerParameters
from mcp.types import CallToolResult, TextContent, Tool

from common.llm import LLMClient

SERVER = Path(__file__).resolve().parent.parent / "cloudledger" / "server.py"
SYSTEM = "你是云簿 CloudLedger 的客服助手。先用工具查事实再回答,不要编造金额和单号。"


def mcp_tool_to_openai(tool: Tool) -> dict[str, Any]:
    """MCP 的 Tool → OpenAI 兼容的 tools 参数里的一项。两边都是 JSON Schema,基本是换个位置。"""
    return {
        "type": "function",
        "function": {"name": tool.name, "description": tool.description or "", "parameters": tool.input_schema},
    }


def result_to_text(result: CallToolResult) -> str:
    """CallToolResult → role=tool 消息的 content。出错时加前缀,让模型明确知道这次失败了。"""
    if result.structured_content is not None:
        body = json.dumps(result.structured_content, ensure_ascii=False)
    else:
        body = "\n".join(b.text for b in result.content if isinstance(b, TextContent))
    return f"[工具报错] {body}" if result.is_error else body


async def run_agent_mcp(
    user: str, system: str = SYSTEM, allow_writes: bool = False, max_steps: int = 8
) -> tuple[str, LLMClient]:
    llm = LLMClient()
    params = StdioServerParameters(command=sys.executable, args=[str(SERVER)])
    async with Client(params) as mcp:
        listing = await mcp.list_tools()
        tools = [mcp_tool_to_openai(t) for t in listing.tools]
        writes = {t.name for t in listing.tools if not (t.annotations and t.annotations.read_only_hint)}
        print(f"[mcp] 拿到 {len(tools)} 个工具,会写数据的: {sorted(writes)}")

        messages: list[dict[str, Any]] = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        for step in range(1, max_steps + 1):
            r = llm.chat(messages, tools=tools)
            messages.append(r.message)
            calls = r.message.get("tool_calls") or []
            print(f"[step {step}] 输入 {r.prompt_tokens} tok | 输出 {r.completion_tokens} tok")
            if not calls:
                return r.content, llm
            for tc in calls:
                name, args = tc["function"]["name"], json.loads(tc["function"]["arguments"] or "{}")
                if name in writes and not allow_writes:
                    out = f"[已拦截] {name} 会写数据,本次运行没有授权。请把要提交的内容告诉用户,由人来确认。"
                else:
                    out = result_to_text(await mcp.call_tool(name, args))
                print(f"    {name}({json.dumps(args, ensure_ascii=False)}) -> {out[:90]}")
                messages.append({"role": "tool", "tool_call_id": tc["id"], "content": out})
    return f"到了最大步数 {max_steps} 还没做完", llm


if __name__ == "__main__":
    question = "客户 user007@example.com 说 10 月被扣了两次款,帮我核实一下,确实重复的话提交退款申请。"
    allow = "--allow-writes" in sys.argv
    answer, llm = anyio.run(run_agent_mcp, question, SYSTEM, allow)
    print("== 回答\n" + answer)
    print("== 账单", llm.ledger)
```

<div class="line-notes">

- `from mcp.types import CallToolResult, TextContent, Tool` 三个类型都只用来做标注和 `isinstance` 判断。
- `from common.llm import LLMClient` Day 135–137 封装的客户端,`chat()` 返回 `ChatResult`,`ledger` 记账。这一行要求从项目根目录用 `-m` 运行。
- `SERVER = Path(__file__).resolve().parent.parent / "cloudledger" / "server.py"` `__file__` 是本文件路径,`.resolve()` 变成绝对路径,往上两层是 `agent-zero-lab/`,再拼上 server 的位置。得到 `/Users/你/agent-zero-lab/cloudledger/server.py`。刚才在 Claude Code 那里吃过相对路径的亏,自己写 host 也用绝对路径。
- `SYSTEM = "你是云簿 CloudLedger 的客服助手。` 系统提示词就一句:先查再答,别编数字。
- `def mcp_tool_to_openai(tool: Tool) -> dict[str, Any]:` 第一个转换,和 `tools_to_openai.py` 里那段推导式一样,只是抽成了函数。
- `def result_to_text(result: CallToolResult) -> str:` 第二个转换。
- `if result.structured_content is not None:` CloudLedger 的工具都有结构化结果,走这一支。
- `body = json.dumps(result.structured_content, ensure_ascii=False)` 实测 `find_customer` 得到 `{"result": [{"id": "C007", "name": "刘静", ...}]}`。`ensure_ascii=False` 让中文原样保留,省 token 也好读。
- `body = "\n".join(b.text for b in result.content if isinstance(b, TextContent))` 没有结构化结果时,把所有文字块拼起来。工具出错时也走这一支,因为 `ToolError` 只有文字。
- `return f"[工具报错] {body}" if result.is_error else body` 出错加前缀。代入 Day 282 的例子,模型会看到 `[工具报错] Error executing tool find_customer: 没有找到匹配「nobody@nowhere」的客户。可以换成邮箱或客户编号再试。`。
- `async def run_agent_mcp(` 对照 Day 170 的 `run_agent(registry, system, user, max_steps)`:参数里没了 `registry`(工具从 server 拿),多了 `allow_writes`;变成了 `async def`,因为 MCP 的调用是异步的。
- `llm = LLMClient()` 每次任务一个新客户端,账本从 0 开始。
- `params = StdioServerParameters(command=sys.executable, args=[str(SERVER)])` 没传 `env`,server 只拿到 8 个安全变量(Day 288 练习 2),它不需要 `LLM_API_KEY`,也就不该给它。
- `async with Client(params) as mcp:` 整个循环都在这个 `with` 里,server 子进程在任务期间一直活着,每次调用不用重新启动。
- `tools = [mcp_tool_to_openai(t) for t in listing.tools]` 第一个转换用在这里。
- `writes = {t.name for t in listing.tools if not (t.annotations and t.annotations.read_only_hint)}` 找出「会写」的工具。没有注解(`annotations` 是 `None`)的也算会写,和 Day 288 probe 里的判断方向一致:没说只读就当它会写。实测只有 `create_refund_request`。
- `messages: list[dict[str, Any]] = [` 和 Day 170 一样,系统消息加用户消息。
- `r = llm.chat(messages, tools=tools)` 和 Day 170 的唯一区别是 `tools` 的来源。`llm.chat` 是同步的,在异步函数里直接调会让事件循环等它返回,我们这里同一时间只做一件事,没有影响。
- `messages.append(r.message)` 把模型的完整回复(含 `tool_calls`)放回历史,Day 170 讲过不能只放 `content`。
- `calls = r.message.get("tool_calls") or []` 没有工具调用时是空列表。
- `print(f"[step {step}] 输入 {r.prompt_tokens} tok` 每一步打印 token,Day 180 加的习惯。
- `if not calls:` 模型不再调工具,这一轮的文字就是最终回答。
- `name, args = tc["function"]["name"], json.loads(tc["function"]["arguments"] or "{}")` 模型给的参数是一个 JSON **字符串**,要先 `json.loads` 变成字典,`call_tool` 要的是字典。Day 170 里是把字符串交给 `registry.call` 自己去解析。
- `if name in writes and not allow_writes:` host 的权限闸。
- `out = f"[已拦截] {name} 会写数据,本次运行没有授权。` 不抛异常,而是像工具结果一样回给模型,告诉它为什么没执行、接下来该怎么做。这和 Day 282 设计错误信息是同一个思路。
- `out = result_to_text(await mcp.call_tool(name, args))` 放行时转发给 server,把结果转成字符串。
- `print(f"    {name}({json.dumps(args, ensure_ascii=False)}) -> {out[:90]}")` 每次调用打印参数和结果前 90 个字符。
- `messages.append({"role": "tool", "tool_call_id": tc["id"], "content": out})` `tool_call_id` 必须对上这次调用(Day 159),拦截的那次也要回,不然下一轮接口会报错,因为每个 `tool_calls` 都要有对应的 tool 消息。
- `return f"到了最大步数 {max_steps} 还没做完", llm` 步数上限,Day 170 的安全阀。
- `allow = "--allow-writes" in sys.argv` 命令行里有这个词就放行写工具。
- `answer, llm = anyio.run(run_agent_mcp, question, SYSTEM, allow)` `anyio.run` 会把 `run_agent_mcp` 的返回值原样交回来。
- `print("== 账单", llm.ledger)` `Ledger` 的 `__str__` 打印调用次数、token 和花费。

</div>

先 seed 一份干净的库,再跑默认的「不放行写工具」版本:

```bash
uv run python cloudledger/seed.py
uv run python -m part05.mcp_agent
```

我跑了两次,第一次模型自己就没去调写工具:

```text
[mcp] 拿到 4 个工具,会写数据的: ['create_refund_request']
[step 1] 输入 877 tok | 输出 51 tok
    find_customer({"query": "user007@example.com"}) -> {"result": [{"id": "C007", "name": "刘静", "email": "user007@example.com", "company": "半岛咖啡"
[step 2] 输入 976 tok | 输出 87 tok
    list_invoices({"customer_id": "C007", "limit": 20}) -> {"result": [{"id": "INV-2026-0123", "amount_cents": 239200, "status": "paid", "issued_at":
    get_subscription({"customer_id": "C007"}) -> {"id": "S007", "customer_id": "C007", "plan": "企业版", "billing_cycle": "monthly", "seats": 
[step 3] 输入 1475 tok | 输出 293 tok
== 回答
确实存在重复扣款。核实结果：
……(中间是一张两行的发票表,INV-2026-0123 和 INV-2026-0026,都是 2026-10-08、2392.00 元、已支付)……
请问退款金额按哪一张处理？我建议全额退一张 **2392.00 元**(两张视为同一期账单,退掉其中一笔即可)。您确认后我就提交；如果只想退部分金额,也请告知具体数字。
== 账单 3 次调用 | 输入 3328 / 输出 431 tokens | 约 ¥0.0053
```

第 2 步模型在一轮里同时要了两个工具(`list_invoices` 和 `get_subscription`),我们的循环逐个执行,两条结果都放回历史。它最后选择先问人再提交,这是模型自己的判断,不是我们拦的。

第二次(同样的命令,重新 seed 过)模型直接去调了写工具,被拦下了:

```text
[mcp] 拿到 4 个工具,会写数据的: ['create_refund_request']
[step 1] 输入 877 tok | 输出 47 tok
[step 2] 输入 972 tok | 输出 87 tok
[step 3] 输入 1471 tok | 输出 168 tok
    create_refund_request({"invoice_id": "INV-2026-0123", "amount_yuan": 2392.0, "reason": "重复扣款:该客户为月付订阅(企业版8席位),本期应只收一次。INV-2026-0026 与 INV-2026-0123 均为2026-10-08开票并于同日全额扣款2392.00元,属重复扣费,申请退还多收的一笔。"}) -> [已拦截] create_refund_request 会写数据,本次运行没有授权。请把要提交的内容告诉用户,由人来确认。
[step 4] 输入 1679 tok | 输出 420 tok
== 账单 4 次调用 | 输入 4999 / 输出 722 tokens | 约 ¥0.0080
```

(这次我只用 `grep` 摘了步骤和账单两类行,所以前两步的工具调用没显示。)同一个问题,两次走法不同,Day 112 讲过的不确定性。所以权限不能指望模型自觉,要 host 来兜底:模型第一次「自觉」了,第二次没有,而第二次库里照样一行都没写。

再放行写工具跑一次:

```bash
uv run python cloudledger/seed.py
uv run python -m part05.mcp_agent --allow-writes
```

```text
[mcp] 拿到 4 个工具,会写数据的: ['create_refund_request']
[step 1] 输入 877 tok | 输出 54 tok
    find_customer({"query": "user007@example.com"}) -> {"result": [{"id": "C007", "name": "刘静", "email": "user007@example.com", "company": "半岛咖啡"
[step 2] 输入 979 tok | 输出 87 tok
    get_subscription({"customer_id": "C007"}) -> {"id": "S007", "customer_id": "C007", "plan": "企业版", "billing_cycle": "monthly", "seats": 
    list_invoices({"customer_id": "C007", "limit": 20}) -> {"result": [{"id": "INV-2026-0123", "amount_cents": 239200, "status": "paid", "issued_at":
[step 3] 输入 1478 tok | 输出 361 tok
    create_refund_request({"invoice_id": "INV-2026-0123", "amount_yuan": 2392.0, "reason": "2026-10-08 同一客户同月重复扣款：INV-2026-0123 与 INV-2026-0026 同日开票并支付，各 2392.00 元。订阅为月度计费（每月 2392 元），10 月应仅扣一笔，申请全额退还其中一笔。"}) -> {"refund_request_id": 1, "status": "pending_approval", "amount_yuan": "2392.00"}
[step 4] 输入 1880 tok | 输出 212 tok
== 回答
已提交退款申请，等待客服主管审批：

- 退款申请号：1
- 发票号：INV-2026-0123
- 金额：2392.00 元（全额）
- 状态：pending_approval（待审批，尚未实际退款）
……(后面还有三条说明和下一步建议)……
== 账单 4 次调用 | 输入 5214 / 输出 714 tokens | 约 ¥0.0084
```

这次申请真的提交了,`refund_requests` 表里多了一行状态 `pending_approval` 的记录。注意即使放行了,模型也写不出「已退款」:Day 283 把状态写死在了 SQL 里,host 放行的只是「提交申请」这一步。两道闸,一道在 host(要不要让模型碰写工具),一道在 server(写工具最多能做到哪一步),哪一道都不该省。

输入 token 每一步都在涨(877 → 979 → 1478 → 1880),因为每一轮都把完整历史和 4 个工具的定义发过去,工具结果越大涨得越快。Day 180 讲工具设计时说的「返回值要省着给」,在这里一样适用。

## 零件 → 大代码对照表

| 零件 | 哪天学的 | 在 `part05/mcp_agent.py` 的哪一段 |
| --- | --- | --- |
| Agent 循环、步数上限、`tool_call_id` | Day 159、Day 170 | `for step in range(...)` 整段 |
| `LLMClient`、`ledger` | Day 135–137 | `llm = LLMClient()`、`llm.chat(...)`、最后的账单 |
| `Client` + `StdioServerParameters` | Day 288 | `async with Client(params) as mcp:` |
| MCP 工具 → `tools` 参数 | 今天 | `mcp_tool_to_openai()` |
| `CallToolResult` → tool 消息 | 今天 | `result_to_text()` |
| `ToolAnnotations` 只读提示 | Day 283 | `writes = {...}` 和 `if name in writes and not allow_writes:` |
| 绝对路径 | 今天(Claude Code 那一节) | `SERVER = Path(__file__).resolve()...` |

## 花了多少钱

今天所有调模型的实跑按 `deepseek-flash` 高峰价算(缓存命中 0.04、未命中 2、输出 8,元每百万 token):

- 手写 host 三次:`LLMClient` 账本上分别是 ¥0.0053、¥0.0080、¥0.0084,合计 ¥0.0217。
- 两道练习:练习 1 是 ¥0.0076,练习 2 是 ¥0.0021。
- Claude Code 四次非交互运行(两次被拒、两次 pending 空跑算在里面):未缓存输入合计 2848 + 1589 + 1589 + 3323 = 9349 token,缓存命中 4992 + 9088 = 14080 token,输出 435 + 123 + 182 + 1635 = 2375 token,算下来 9349 × 2 ÷ 100 万 + 14080 × 0.04 ÷ 100 万 + 2375 × 8 ÷ 100 万 ≈ 0.0187 + 0.0006 + 0.0190 ≈ ¥0.038。

总共约 ¥0.07。你照着跑一遍主线(三次 host 加一次 Claude Code)大约 ¥0.04。

## 动手练习

**练习 1:host 自己决定挂 resource。** Day 284 说 resource 由应用决定要不要放进上下文。写 `part05/ex289_policy.py`:先用 `Client` 读出 `cloudledger://policy/refund`,把政策原文拼进 system prompt,再调 `run_agent_mcp` 跑同一个问题(放行写工具)。看回答里有没有引用政策。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/ex289_policy.py
"""练习 1:host 自己决定把退款政策这个 resource 挂进 system prompt,再跑同一个问题。"""
import sys

import anyio
from mcp import Client, StdioServerParameters
from mcp.types import TextResourceContents

from part05.mcp_agent import SERVER, SYSTEM, run_agent_mcp

QUESTION = "客户 user007@example.com 说 10 月被扣了两次款,帮我核实一下,确实重复的话提交退款申请。"


async def main() -> None:
    async with Client(StdioServerParameters(command=sys.executable, args=[str(SERVER)])) as c:
        got = await c.read_resource("cloudledger://policy/refund")
    block = got.contents[0]
    policy = block.text if isinstance(block, TextResourceContents) else ""
    system = f"{SYSTEM}\n\n以下是云簿退款政策原文,回答涉及退款时以它为准:\n{policy}"
    answer, llm = await run_agent_mcp(QUESTION, system=system, allow_writes=True)
    print("== 回答\n" + answer)
    print("== 账单", llm.ledger)


if __name__ == "__main__":
    anyio.run(main)
```

<div class="line-notes">

- `from part05.mcp_agent import SERVER, SYSTEM, run_agent_mcp` 直接复用正文的 host,只改 system prompt。`mcp_agent.py` 里的 `if __name__ == "__main__":` 保证 import 时不会跑它的主程序。
- `async with Client(StdioServerParameters(command=sys.executable, args=[str(SERVER)])) as c:` 先单独连一次,只为读政策,读完就关。也可以改 `run_agent_mcp` 让它在同一个连接里读,这里图简单。
- `got = await c.read_resource("cloudledger://policy/refund")` 和 Day 284 的 `peek_server.py` 一样。
- `policy = block.text if isinstance(block, TextResourceContents) else ""` 确认是文字再取。
- `system = f"{SYSTEM}\n\n以下是云簿退款政策原文` 政策拼在原来的系统提示词后面。这就是「host 决定把 resource 放进上下文」最朴素的实现。
- `answer, llm = await run_agent_mcp(QUESTION, system=system, allow_writes=True)` 在异步函数里直接 `await`,不用再 `anyio.run`。

</div>

```bash
uv run python cloudledger/seed.py
uv run python -m part05.ex289_policy
```

输出(工具调用和前面放行那次一样,略去中间几行):

```text
[step 1] 输入 987 tok | 输出 48 tok
……
    create_refund_request({"invoice_id": "INV-2026-0123", "amount_yuan": 2392.0, "reason": "10月重复扣款:客户为月付企业版(2392元/月),2026-10-08 有两张发票 INV-2026-0123 与 INV-2026-0026 同日各扣 2392 元并均已支付成功,属重复扣款。按退款政策第1条,全额退还重复的一笔 2392.00 元,原路退回。待客服主管审批。"}) -> {"refund_request_id": 1, "status": "pending_approval", "amount_yuan": "2392.00"}
[step 4] 输入 1993 tok | 输出 137 tok
== 回答
已提交退款申请，现在是**待审批**状态（不会立即退钱）：
……
- 依据：退款政策第 1 条，重复扣款核实后全额退还重复那一笔，3 个工作日内原路退回
……
== 账单 4 次调用 | 输入 5645 / 输出 642 tokens | 约 ¥0.0076
```

对比没挂政策的那次:退款原因里多了「按退款政策第1条」,回答里多了「3 个工作日内原路退回」这句,这是政策原文里才有的承诺。代价是第一步的输入从 877 涨到 987 token,每一步都多这 110 个。政策短,常驻没问题;要是一份几万字的手册,就该改成工具(模型需要时再查)或者 RAG,这是 Day 284 自测题讨论过的取舍。

</details>

**练习 2:不改 Day 170 的代码也能接 MCP。** `run_agent` 只认 `ToolRegistry` 的两样东西:`schemas` 属性和 `call(name, arguments)` 方法,而且它是同步的。写一个 `MCPRegistry(ToolRegistry)`,`schemas` 从 MCP server 拿,`call` 转发给 MCP server,原封不动塞给 `run_agent`,问它「客户 C003 有没有没付的发票?金额多少?」。难点是:`run_agent` 是同步函数,`Client` 的方法是异步的。提示:anyio 有一个叫 blocking portal 的东西,能让同步代码去调异步函数。

<details><summary>参考答案</summary>

blocking portal 先用一句话解释:它在后台另开一个线程,在那里跑一个事件循环;同步代码调 `portal.call(某个异步函数, 参数)`,就会把这个函数交给后台的事件循环去跑,然后等着拿结果。相当于在同步代码里有了一个「帮我 await 一下」的按钮。

```python
# agent-zero-lab/part05/ex289_registry.py
"""练习 2:不改 Day 170 的 run_agent,做一个「长得像 ToolRegistry」的 MCP 适配器塞给它。"""
import json
import sys
from pathlib import Path

from anyio.from_thread import BlockingPortal, start_blocking_portal
from mcp import Client, StdioServerParameters

from part03.agent_loop import ToolRegistry, run_agent
from part05.mcp_agent import SERVER, SYSTEM, mcp_tool_to_openai, result_to_text


class MCPRegistry(ToolRegistry):
    """schemas 从 MCP server 拿,call 转发给 MCP server。run_agent 看不出区别。"""

    def __init__(self, portal: BlockingPortal, client: Client) -> None:
        super().__init__()
        self.portal, self.client = portal, client
        listing = portal.call(client.list_tools)
        self.schemas = [mcp_tool_to_openai(t) for t in listing.tools]

    def call(self, name: str, arguments: str) -> str:
        args = json.loads(arguments or "{}")
        result = self.portal.call(self.client.call_tool, name, args)
        return result_to_text(result)


def main() -> None:
    params = StdioServerParameters(command=sys.executable, args=[str(SERVER)])
    with start_blocking_portal() as portal:
        with portal.wrap_async_context_manager(Client(params)) as client:
            registry = MCPRegistry(portal, client)
            print("拿到工具:", [s["function"]["name"] for s in registry.schemas])
            answer, llm = run_agent(registry, SYSTEM, "客户 C003 有没有没付的发票?金额多少?", max_steps=6)
    print("== 回答\n" + answer)
    print("== 账单", llm.ledger)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from anyio.from_thread import BlockingPortal, start_blocking_portal` 「从线程里调异步」的两个工具,前者是类型,后者用来创建。
- `from part03.agent_loop import ToolRegistry, run_agent` Day 170 的代码,一个字不改。
- `class MCPRegistry(ToolRegistry):` 继承只为让类型检查认它是注册表,和 Day 183 的 `Counted` 是同一个套路。
- `super().__init__()` 父类会建空的 `funcs` 和 `schemas`,我们马上覆盖 `schemas`。
- `listing = portal.call(client.list_tools)` 在同步的 `__init__` 里调异步方法。传的是方法本身,不加括号,portal 替你调用并 await。
- `self.schemas = [mcp_tool_to_openai(t) for t in listing.tools]` 复用正文的第一个转换。`run_agent` 里 `tools=registry.schemas` 拿到的就是它。
- `def call(self, name: str, arguments: str) -> str:` 签名和父类一样:参数是模型给的 JSON 字符串,返回字符串。
- `result = self.portal.call(self.client.call_tool, name, args)` 后面的 `name, args` 会作为参数传给 `call_tool`。
- `return result_to_text(result)` 复用第二个转换。
- `with start_blocking_portal() as portal:` 启动后台线程和事件循环,离开时关掉。
- `with portal.wrap_async_context_manager(Client(params)) as client:` `Client` 是 `async with` 用的,在同步代码里不能直接 `async with`,这个方法把它包成普通的 `with`。server 子进程在这一层里活着。
- `answer, llm = run_agent(registry, SYSTEM, "客户 C003 有没有没付的发票?金额多少?", max_steps=6)` 原样调用 Day 170 的循环。问的是只读的问题,这个适配器没有加写工具的闸,想加的话在 `call` 里照正文的写法判断一下即可。

</div>

```bash
uv run python -m part05.ex289_registry
```

```text
拿到工具: ['find_customer', 'get_subscription', 'list_invoices', 'create_refund_request']
[step 1] 输入 861 tok | 输出 64 tok
    调用 list_invoices({"customer_id": "C003", "status": "open"}) -> 返回 149 字符
[step 2] 输入 999 tok | 输出 83 tok
== 回答
客户 C003 目前有 1 张未付发票：

- **发票号**：INV-2026-0009
- **金额**：2,392.00 元
- **状态**：未付(open)
- **开票日期**：2026-10-10
……
== 账单 2 次调用 | 输入 1860 / 输出 147 tokens | 约 ¥0.0021
```

`调用 list_invoices(...) -> 返回 149 字符` 这一行是 Day 180 在 `run_agent` 里加的打印,说明走的确实是原来的循环。模型直接用了 `status: "open"` 过滤,一步就查到了,和 Day 287 练习 1 测试里断言的 INV-2026-0009 一致。

正文的 async 版本和这个适配器版本,我更推荐前者:多一个后台线程就多一层要理解的东西,出错时调用栈也更长。适配器的价值在于,你手里已经有一个同步的 Agent 框架、不想改它的时候,MCP 也能接进去。很多框架的 MCP 适配器干的就是这件事。

</details>

**练习 3:给 Claude Desktop 写一份带环境变量的配置。** 假设你想让 Claude Desktop 里的 CloudLedger 用另一份库 `/Users/你/agent-zero-lab/cloudledger/demo.db`,写出 `claude_desktop_config.json` 里这一项,并说出怎么在不打开 Claude Desktop 的情况下验证这条命令能跑。

<details><summary>参考答案</summary>

```json
{
  "mcpServers": {
    "cloudledger-demo": {
      "command": "/Users/你/.local/bin/uv",
      "args": ["run", "--directory", "/Users/你/agent-zero-lab", "python", "cloudledger/server.py"],
      "env": {"CLOUDLEDGER_DB": "/Users/你/agent-zero-lab/cloudledger/demo.db"}
    }
  }
}
```

<div class="line-notes">

- `"cloudledger-demo": {` 换个名字,和原来那个可以同时存在,工具名会变成 `mcp__cloudledger-demo__...` 这样的前缀(在 Claude Desktop 里显示成两个 connector)。
- `"env": {"CLOUDLEDGER_DB": "/Users/你/agent-zero-lab/cloudledger/demo.db"}` 只传 server 需要的这一个变量。server.py 的 `DB_PATH` 会读它(Day 284)。路径同样写绝对路径。

</div>

验证:先造这份库 `CLOUDLEDGER_DB=/Users/你/agent-zero-lab/cloudledger/demo.db uv run python cloudledger/seed.py`(seed 也读同一个变量),然后在**任意一个别的目录**里用 probe 跑 `command` 加 `args` 拼成的那条命令,环境变量写在前面:`CLOUDLEDGER_DB=/Users/你/agent-zero-lab/cloudledger/demo.db /Users/你/agent-zero-lab/.venv/bin/python /Users/你/agent-zero-lab/part05/mcp_probe.py /Users/你/.local/bin/uv run --directory /Users/你/agent-zero-lab python cloudledger/server.py`。能列出四个工具就说明命令和路径没问题。这里有一个细节:probe 启动 server 时没传 `env`,SDK 默认不会把 `CLOUDLEDGER_DB` 传过去(Day 288 练习 2),所以这样只能验证「命令能起来」,要验证「用的是 demo.db」,得在 probe 里给 `StdioServerParameters` 加上 `env`,或者在 Claude Desktop 里实际问一个只有 demo.db 里才有的数据。这一题我只在另一个目录实跑了 probe 那一步(不带 env,四个工具都列出来了),没在 Claude Desktop 上验证。

</details>

**练习 4:想一想。** 正文的 host 用 `read_only_hint` 决定放不放行。如果你接的是一个别人写的 server,它把一个会删数据的工具也标成了 `read_only_hint=True`,会发生什么?host 还能怎么做?

<details><summary>参考答案</summary>

我们的闸会直接放行它,模型调用时数据就被删了。注解是 server 自己说的,规范里也写明 client 不应该把来自不可信 server 的注解当成安全依据。host 能做的:一,对第三方 server 不看注解,改成白名单,只放行你读过源码、确认是只读的工具名(Claude Code 的 `permissions.allow` 就是这种做法,默认全部都问);二,接之前先用 Day 288 的 probe 看清楚它有哪些工具,读源码;三,给 server 的权限做减法,比如数据库账号只给只读权限,这样即使工具想删也删不掉。注解适合给你自己写的、可信的 server 用来省掉无谓的确认,不能当成安全边界。

</details>

验收标准:`claude mcp list` 里 cloudledger 显示 `✔ Connected`,在 Claude Code 里能问出 C007 的重复扣款;`uv run python -m part05.mcp_agent` 不带参数时库里不会多出退款申请(`sqlite3 cloudledger/cloudledger.db "select count(*) from refund_requests"` 为 0),带 `--allow-writes` 时多一条 `pending_approval`;能对着时序图说出蓝线和琥珀线各是什么协议。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| `claude mcp add` | Claude Code 添加 MCP server 的命令,`--` 后面是启动 server 的原样命令 |
| scope(local / project / user) | Claude Code 里 server 配置的生效范围:只在当前项目对自己、写进 `.mcp.json` 给团队、所有项目 |
| `claude_desktop_config.json` | Claude Desktop 的 MCP 配置文件,macOS 在 `~/Library/Application Support/Claude/` |
| `mcp__服务名__工具名` | Claude Code 里 MCP 工具的全名,权限规则和 `--allowedTools` 都用这个名字 |
| `permission_denials` | Claude Code 非交互模式输出里的一项,列出因为没授权被拒的工具调用 |
| `uv run --directory` | 在指定目录、用那个目录的虚拟环境执行命令,不改变你当前所在的目录 |
| host 权限闸 | host 在把模型的工具调用转发给 server 之前做的检查,决定执行、拦下还是问人 |
| blocking portal | anyio 提供的机制:后台线程里跑一个事件循环,让同步代码可以调用异步函数并等待结果 |
| 适配器(adapter) | 一个「长得像 A、内部用 B」的包装对象,让只认 A 的代码也能用 B |

## 常见误区

**配置里写相对路径。** 正文实测:同一条 `uv run python cloudledger/server.py`,在项目目录里 `✔ Connected`,换个目录就 `✘ Failed to connect — CONNECTION_CLOSED`,错误信息不提文件找不到。`--directory` 后面和 server 文件都写绝对路径。

**Claude Desktop 里 `command` 只写 `uv`。** 从程序坞打开的桌面应用拿不到终端里配的 `PATH`,可能找不到 `uv`。用 `which uv` 查出完整路径写进去,`uv run mcp install` 自动生成的配置也是这么做的。

**改完 Claude Desktop 配置只关了窗口。** 应用还在后台,不会重新读配置。要 Cmd+Q 完全退出再打开。

**以为贴了 `read_only_hint` 就不用授权。** Claude Code 实测,只读工具第一次调用照样要你点头,非交互模式下没放行就直接被拒。要预先放行,用 `--allowedTools` 或 `permissions.allow` 写具体的工具名。

**手写 host 时把模型给的 `arguments` 字符串直接传给 `call_tool`。** `call_tool` 要的是字典,模型给的是 JSON 字符串,要先 `json.loads`。类型检查会提示,但在没开类型检查的项目里这是最常见的低级错误之一。

**拦截写工具时直接 `continue`,不回 tool 消息。** 模型的每个 `tool_calls` 都要有一条对应 `tool_call_id` 的 tool 消息,少一条,下一轮请求会被接口拒绝。拦截也要回一条说明。

**为了省事把整个 `os.environ` 传给 server 子进程。** 老课和网上不少示例这么写,这样 server 能看到你的 `LLM_API_KEY`。我们的 server 不需要它,正文里干脆不传 `env`;需要 `CLOUDLEDGER_DB` 时只传这一个。

## 学习资料

### 文档与文章

- [Claude Code 文档 · Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp):`claude mcp add` 的完整用法、三种 scope 存在哪、`.mcp.json` 的格式、`MCP_TIMEOUT` 等环境变量。
- [Claude Code 文档 · Configure permissions](https://code.claude.com/docs/en/permissions):MCP 工具权限规则的写法,搜「mcp__」能找到 `mcp__server__*` 和 `mcp__server__get_*` 的例子。
- [MCP 官方 · Connect to local MCP servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers):Claude Desktop 配置文件位置、重启要求、日志位置和排错清单,今天 Desktop 那一节的出处。
- [MCP 官方 · Build an MCP client](https://modelcontextprotocol.io/docs/develop/build-client):官方的「client 接模型」教程,和正文 `mcp_agent.py` 做的是同一件事,用的是 Anthropic 的接口格式,可以对比两种 `tools` 参数的差别。
- [DeepSeek · Anthropic API 兼容](https://api-docs.deepseek.com/zh-cn/guides/anthropic_api):我用 DeepSeek 驱动 Claude Code 实跑时参考的文档,想省钱练手可以看。
- [AnyIO · Working with threads](https://anyio.readthedocs.io/en/stable/threads.html):练习 2 的 blocking portal,看「Calling asynchronous code from an external thread」一节。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV13tuqzwEm9&autoplay=0&high_quality=1" title="一个视频彻底掌握ClaudeCode使用MCP" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>创哥的AI实验室 · 一个视频彻底掌握ClaudeCode使用MCP · 交互模式下添加、查看、授权 MCP server 的完整操作,正好补上我用非交互模式实跑看不到的界面。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1RNTtzMENj&autoplay=0&high_quality=1" title="从零编写MCP并发布上线,超简单!手把手教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>技术爬爬虾 · 从零编写MCP并发布上线,超简单!手把手教程 · 后半段把写好的 server 配进客户端,看配置 JSON 的那一段,和今天 Desktop 的写法对照。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/DfWHX7kszQI" title="Claude Code MCP: How to Add MCP Servers (Complete Guide)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Leon van Zyl · Claude Code MCP: How to Add MCP Servers (Complete Guide) · 讲 local、project、user 三种 scope 的区别和 `.mcp.json` 怎么提交给团队。</figcaption>
</figure>

### 书籍

- Chip Huyen,《AI Engineering》,O'Reilly,2025。第 6 章讲 Agent 的工具和规划,其中关于「工具要不要人确认、写操作的风险」的讨论,对应今天 host 权限闸的设计。没查到中文版,只写英文原版。

### 开源项目与代码

- [modelcontextprotocol/python-sdk](https://github.com/modelcontextprotocol/python-sdk):`src/mcp/cli/claude.py` 是 `mcp install` 的实现,能看到它怎么找 Claude Desktop 的配置目录、怎么拼出那串 `uv run --with` 命令。
- [openai/openai-agents-python](https://github.com/openai/openai-agents-python):OpenAI Agents SDK 内置 MCP 支持,`src/agents/mcp/` 目录里就是正文两个转换的工业版,有空可以对照着读。

## 自测

1. `claude mcp add cloudledger -- uv run python cloudledger/server.py` 在项目目录里 `claude mcp list` 显示连上了,为什么换个目录打开 Claude Code 就连不上?怎么改?

<details><summary>答案</summary>

host 在自己当前所在的目录执行启动命令,`cloudledger/server.py` 是相对路径,只在项目根目录下存在,换个目录就找不到文件,子进程立刻退出,host 只看到 `Connection closed`。改成 `uv run --directory /Users/你/agent-zero-lab python cloudledger/server.py`,或者把 server 文件也写成绝对路径。

</details>

2. 手写 host 里两个转换分别是什么?为什么第一个几乎只是「换个位置」?

<details><summary>答案</summary>

一是 MCP 的 `Tool` 转成 OpenAI 兼容的 `tools` 参数项:`{"type": "function", "function": {"name", "description", "parameters": tool.input_schema}}`;二是 `CallToolResult` 转成 `role=tool` 消息的 content 字符串:有 `structured_content` 就 JSON 序列化,否则拼文字块,出错加 `[工具报错]` 前缀。第一个简单,是因为 MCP 和 function calling 描述参数都用 JSON Schema,`input_schema` 可以原封不动当 `parameters` 用。

</details>

3. 正文第二次跑默认版本时,模型调了 `create_refund_request`,为什么库里没有多出记录?如果这时只是删掉 `if name in writes and not allow_writes:` 这个判断,最坏会发生什么?

<details><summary>答案</summary>

host 的权限闸发现它在「会写」的集合里且没有 `--allow-writes`,没有转发给 server,只回了一条 `[已拦截]` 说明。删掉判断后,模型会直接提交退款申请;不过最坏也只是多一条 `pending_approval` 的申请,不会真的退钱,因为 server 那一层(Day 283)把状态写死了,真正退款要主管审批。这就是两道闸各管一层的意义。

</details>

4. 拦截写工具时,为什么不能直接跳过、不往 messages 里加 tool 消息?

<details><summary>答案</summary>

模型上一条回复里的每个 `tool_calls` 都必须有一条 `tool_call_id` 对应的 `role=tool` 消息,接口才接受下一轮请求,少一条会报错。而且回一条说明还能告诉模型为什么没执行、接下来该做什么(把内容告诉用户),它才不会反复尝试同一个调用。

</details>

5. 面试题:你在产品里要接用户自己配置的第三方 MCP server,host 侧要做哪些事来保证安全?

<details><summary>答案</summary>

至少这几层。启动:用绝对路径和固定版本号启动,只传 server 需要的环境变量,不把整个环境(尤其是模型密钥)传给它;能放进沙箱或容器就放进去。发现:连上后先像 probe 一样把工具清单、注解、instructions 列给用户看,instructions 不直接无条件拼进系统提示词,长度和内容要审。调用:不信任第三方的注解,默认每个工具都要用户确认,用户可以把确认过的只读工具加进白名单;写工具和删改工具默认拦截,执行前展示参数。结果:工具结果也是不可信输入,可能带提示词注入,要和用户指令区分开,大的结果截断。审计:每次调用记日志(哪个 server、哪个工具、参数、结果摘要、谁批准的)。这些在 Claude Code 里都能看到对应的设计:默认询问、`permissions.allow` 白名单、`--tools` 限制内置工具。

</details>

## 明天预告

Day 290 · 写 MCP server(十):远程 server、鉴权和 Gradio 公网演示。今天的 server 都是 stdio,只能在你自己的电脑上被拉起来。明天把 CloudLedger 换成 Day 276 讲过的 Streamable HTTP,让别人通过一个网址连它;一旦能从网上访问,就必须加鉴权,不然谁都能来查你的客户、提退款申请;最后用 Gradio 做一个简单的网页演示版,不装 Claude Code 也能试。
