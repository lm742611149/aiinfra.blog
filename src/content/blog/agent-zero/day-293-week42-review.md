---
title: 'Day 293 · 第 42 周复习:MCP 与编排(Day 287–292)'
description: '这一周先给 MCP server 写测试、写 client、接进 host、搬上 HTTP 加鉴权,再转头做问数 Agent 的说明书和三道闸。今天画一张知识地图,每天一句话回顾,把问数的 safe_db 包成一个 MCP server 当小项目(11 条测试加一份 stdio 冒烟检查全过),再默写一段本周核心代码、找一个 server 里的四个错误。'
pubDate: 2026-10-23
regime: none
tags: ['review', 'mcp', 'text-to-sql', 'pytest', 'agent-zero']
series: 'agent-zero'
day: 293
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 292](/blog/agent-zero/day-292-text-to-sql-2/) 给问数 Agent 装上了三道闸:先让模型照着「帮我把这张发票删掉」写出 `DELETE`,看清提示词管不住它;再用 sqlglot 解析检查只放行单条 SELECT、用 `mode=ro` 打开只读连接、用授权回调把 `ATTACH` 和 PRAGMA 挡在引擎层,另加 3 秒超时,拼成 `part05/text2sql/safe_db.py`。最后四个坏问题交给模型写 SQL,执行层一条都没放过,`invoices` 还是 123 行。

这是第 42 周的最后一天。回头看这六天:前四天在讲「一个 MCP server 怎么被测、被连、被接进模型、被放到网上」,后两天换了个题目,讲「让模型写的 SQL 安全地跑起来」。两件事看着不相干,其实可以接上:问数能力要是想给别的 Agent 用,最顺手的包装就是一个 MCP server。今天就把 `safe_db.py` 包成 server,把这周的东西全用一遍。

## 今天要解决的问题

1. 能对着一张图说出本周六天各解决了什么,并分清内存、stdio、HTTP 三种连法各自测得到什么、测不到什么。
2. 做出小项目 `part05/review42_sql_server.py`:一个只读问数 MCP server,配 11 条 pytest 测试和一份 stdio 冒烟检查,全部通过;再用 `claude mcp list` 确认 host 能连上它。
3. 合上文章默写出「只读、限时、限行数地执行一条模型写的 SQL」,六条用例各在该停的地方停下。
4. 能在一个 server 里找出本周讲过的四类错误,并说出每一类的真实现象。

预计用时 3.5 小时。不调模型,花费 ¥0。

前置:本周的 [Day 287](/blog/agent-zero/day-287-mcp-test/) 到 [Day 292](/blog/agent-zero/day-292-text-to-sql-2/)。要用到 `part05/text2sql/` 里的 `bare_schema.py`、`schema.py`、`safe_db.py`,Day 280 的 `cloudledger/seed.py`,以及 Day 287 的 `pyproject.toml` 里 `[tool.pytest]` 那一段。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。复习日的默写最要紧,练习 1 请真的合上文章写。

所有命令在 `agent-zero-lab/` 根目录跑(我的是 `/Users/你/agent-zero-lab`)。开始前先重置一下业务库,免得上周的实验留下的数据让数字对不上:

```bash
cd /Users/你/agent-zero-lab
uv run python cloudledger/seed.py
```

<div class="line-notes">

- `uv run python cloudledger/seed.py` 删库重建,随机种子固定,所以每次都是同样的 30 个客户、123 张发票。输出 `已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}`。

</div>

## 本周知识地图

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="第 42 周知识地图:上排是 MCP 的四天,287 内存测试,288 独立 client,289 接进 host,290 HTTP 加鉴权;下排是问数的两天,291 库说明书,292 三道闸;中间是今天的小项目,把 safe_db 包成 MCP server">
<rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="22" fill="var(--ink-soft)">MCP:server 怎么被用</text>
<rect x="20" y="32" width="140" height="52" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="90" y="54" fill="var(--ink)" text-anchor="middle">287 内存测试</text>
<text x="90" y="72" fill="var(--ink-soft)" text-anchor="middle" font-size="11">Client(server对象)</text>
<rect x="175" y="32" width="140" height="52" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="245" y="54" fill="var(--ink)" text-anchor="middle">288 独立 client</text>
<text x="245" y="72" fill="var(--ink-soft)" text-anchor="middle" font-size="11">stdio 子进程;probe</text>
<rect x="330" y="32" width="140" height="52" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="400" y="54" fill="var(--ink)" text-anchor="middle">289 接进 host</text>
<text x="400" y="72" fill="var(--ink-soft)" text-anchor="middle" font-size="11">claude mcp add</text>
<rect x="485" y="32" width="135" height="52" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="552" y="54" fill="var(--ink)" text-anchor="middle">290 HTTP+令牌</text>
<text x="552" y="72" fill="var(--ink-soft)" text-anchor="middle" font-size="11">Bearer 中间件</text>
<rect x="150" y="128" width="340" height="74" rx="8" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="154" fill="var(--ink)" text-anchor="middle">今天的小项目</text>
<text x="320" y="174" fill="var(--ink)" text-anchor="middle">review42_sql_server.py</text>
<text x="320" y="192" fill="var(--ink-soft)" text-anchor="middle" font-size="11">1 个只读工具 · 1 个 resource · 1 个 prompt</text>
<text x="20" y="250" fill="var(--ink-soft)">问数:模型写的 SQL 怎么安全地跑</text>
<rect x="150" y="260" width="160" height="52" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="230" y="282" fill="var(--ink)" text-anchor="middle">291 库说明书</text>
<text x="230" y="300" fill="var(--ink-soft)" text-anchor="middle" font-size="11">DDL + 取值 + 术语表</text>
<rect x="330" y="260" width="160" height="52" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="410" y="282" fill="var(--ink)" text-anchor="middle">292 三道闸 + 超时</text>
<text x="410" y="300" fill="var(--ink-soft)" text-anchor="middle" font-size="11">safe_db.run_sql</text>
<line x1="90" y1="84" x2="230" y2="128" stroke="var(--ink-soft)"/>
<line x1="245" y1="84" x2="290" y2="128" stroke="var(--ink-soft)"/>
<line x1="400" y1="84" x2="350" y2="128" stroke="var(--ink-soft)"/>
<line x1="552" y1="84" x2="430" y2="128" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
<line x1="230" y1="260" x2="290" y2="202" stroke="var(--ink-soft)"/>
<line x1="410" y1="260" x2="350" y2="202" stroke="var(--ink-soft)"/>
<text x="590" y="110" fill="var(--ink-faint)" text-anchor="middle" font-size="11">练习 4</text>
</g>
</svg>
<figcaption>上排四天是「怎么测、怎么连、怎么接、怎么上网」,下排两天是「说明书和闸」。小项目把下排包成 server,再用上排的办法逐个验证。虚线那条(HTTP 加令牌)放在练习 4。</figcaption>
</figure>

「连」这件事这周出现了三种,复习时最容易混,放一张表。每一格都是前几天实测过的,最后一行是今天这个小项目的实测:

| | 内存连接 | stdio 连接 | HTTP 连接 |
| --- | --- | --- | --- |
| `Client(...)` 里传什么 | server 对象 `mcp` | `StdioServerParameters(command, args, cwd)` | `streamable_http_client(url, http_client=...)` |
| server 是谁启动的 | 同一个进程,不用启动 | client 拉起子进程 | 你自己先起好,client 只管连 |
| 测得到 | 工具返回值、错误文字、schema 校验 | 启动命令对不对、cwd、stdout 有没有被污染 | 鉴权、令牌、端口 |
| 测不到 | 启动命令、stdout 污染、cwd | 鉴权 | 子进程的环境问题 |
| 出错时 client 看到什么 | 和另外两种一样 | 子进程起不来是 `Connection closed` | 401 是 `Server returned an error response` |
| 今天小项目的耗时 | 11 条测试 5.2 秒(3 秒是超时那条) | 七项冒烟检查 2.0 秒 | 练习 4 |

第二张表是问数的两块积木,各管什么:

| | 解决什么 | 能从库里自动生成吗 | 漏了会怎样 |
| --- | --- | --- | --- |
| 建表语句(带注释) | 有哪些表和列、怎么 JOIN、金额单位 | 能,`sqlite_master.sql` | 模型猜列名 |
| 枚举列真实取值 | `企业版` 不是 `enterprise` | 能,`SELECT DISTINCT` | WHERE 匹配不上,返回 0 不报错 |
| 业务术语表 | 「今天」是哪天、MRR 怎么算 | 不能,只能人写 | 数字能跑出来但口径是模型编的 |
| sqlglot 检查 | 只放行单条 SELECT,补 LIMIT | 代码 | 写操作进得来 |
| `mode=ro` | 原库文件写不进去 | 一个参数 | 解析器出 bug 时没第二层 |
| 授权回调 | `ATTACH`、PRAGMA 在引擎层被拒 | 代码,白名单 | `ATTACH` 能把客户表复制走 |
| 进度回调超时 | 跑不完的合法查询 3 秒后中断 | 代码 | 一条 SQL 占住一个进程 |

## 本周每天一句话

- [Day 287](/blog/agent-zero/day-287-mcp-test/):把 server 对象直接交给 `Client`,在同一个进程里用内存管道说 MCP;配上 anyio 标记和「每个测试一份临时库」的 fixture,13 条合同测试 0.44 秒跑完。
- [Day 288](/blog/agent-zero/day-288-mcp-client/):`Client` 里面是 `stdio_client`(传输)加 `ClientSession`(会话)两层,不握手就发请求会被 -32602 拒绝;`mcp_probe.py` 能逛任意 stdio server,还抓出了往 stdout 打字的 server。
- [Day 289](/blog/agent-zero/day-289-mcp-host/):`claude mcp add` 接进 Claude Code,配置里写相对路径换个目录就 `Connection closed`;自己当 host 要做两个转换(工具清单转 `tools` 参数、`CallToolResult` 转 tool 消息),写工具在 host 层拦下。
- [Day 290](/blog/agent-zero/day-290-mcp-remote/):stdio 是 host 拉起子进程,HTTP 是 server 自己开着门;没鉴权时一条 curl 就提交了 2392 元的退款申请,加上 Bearer 中间件后陌生人得 401;Gradio 和 `mcp==2.3.0` 版本冲突,演示版单独一个目录。
- [Day 291](/blog/agent-zero/day-291-text-to-sql-1/):只给列名时 6 道题对 1 道且从不报错,加上三层说明书(建表注释、真实取值、术语表)后 6/6,「不知道值」靠前两层,「不知道口径」只能靠术语表。
- [Day 292](/blog/agent-zero/day-292-text-to-sql-2/):提示词管不住模型写 `DELETE`,`mode=ro` 管不住 `ATTACH`;sqlglot、只读连接、授权回调三道闸各有漏洞,叠起来加 3 秒超时才是 `safe_db.py`。

## 本周小项目:问数 MCP server

Day 294 的问数循环要反复调「执行 SQL」。如果这个能力只是循环里的一个函数,别的 Agent 就用不上;做成 MCP server,Claude Code、自己写的 host、别的团队的 Agent 都能接。今天先把这个 server 做出来,用本周的办法逐个验证,明天的循环就可以放心地调它。

只用这周学过的东西:

- 执行 SQL 做成一个只读工具 `run_query`,内部直接调 Day 292 的 `run_sql`,被拒绝时把原因用 `ToolError` 交给模型(Day 292,另有 Day 282 的 `ToolError`);
- 库说明书做成 resource `cloudledger://schema`,内容就是 Day 291 的 `schema_text()`;
- 提问模板做成 prompt `ask_data`,告诉模型先读说明书再写 SQL;
- 用内存客户端写 pytest 合同(Day 287),再用 stdio 的 `Client` 写一份冒烟检查(Day 288),最后用 `claude mcp add` 接进 host 确认连得上(Day 289)。

```python
# agent-zero-lab/part05/review42_sql_server.py
"""第 42 周小项目:问数 MCP server。只有一个只读工具 run_query,库说明书做成 resource,提问模板做成 prompt。"""
import logging
import sys
from typing import Annotated, TypedDict

from pydantic import Field

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

from part05.text2sql.safe_db import SQLRejected, run_sql
from part05.text2sql.schema import schema_text

logging.basicConfig(stream=sys.stderr, level=logging.INFO, format="[sql-server] %(message)s")
log = logging.getLogger("sql-server")

mcp = MCPServer(
    "cloudledger-sql",
    instructions="云簿 CloudLedger 的只读问数工具。先读 cloudledger://schema 了解表和口径,再用 run_query 执行一条 SELECT。",
)


class QueryResult(TypedDict):
    columns: list[str]
    rows: list[list[str | int | float | None]]
    row_count: int


@mcp.resource("cloudledger://schema", mime_type="text/plain")
def schema_resource() -> str:
    """库说明书:带注释的建表语句、枚举列的真实取值、业务术语表。"""
    return schema_text()


@mcp.tool(annotations=ToolAnnotations(read_only_hint=True, open_world_hint=False))
def run_query(sql: Annotated[str, Field(min_length=6, max_length=2000, description="一条 SQLite 的 SELECT 语句")]) -> QueryResult:
    """在云簿业务库上只读地执行一条 SELECT,最多返回 200 行,3 秒超时。被拒绝时错误信息里写着原因,按提示改写 SQL 再试。"""
    log.info("run_query: %s", sql[:80])
    try:
        cols, rows = run_sql(sql)
    except SQLRejected as e:
        raise ToolError(str(e)) from e
    return QueryResult(columns=cols, rows=[list(r) for r in rows], row_count=len(rows))


@mcp.prompt()
def ask_data(question: str) -> str:
    """把一个业务问题变成「先看说明书、再写 SQL、再回答」的指令。"""
    return (
        f"用户的问题:{question}\n"
        "先读 cloudledger://schema 看表结构和业务口径,再写一条 SELECT 调用 run_query。"
        "金额回答成元,口径按说明书里的术语表,不要自己发明。如果被拒绝,按错误信息改写后重试。"
    )


if __name__ == "__main__":
    mcp.run()
```

<div class="line-notes">

- `import logging` 这是个 stdio server,所有给人看的输出都得走 stderr,stdout 留给协议([Day 288](/blog/agent-zero/day-288-mcp-client/) 实测过往 stdout 打一行字会让 client 报 `Failed to parse JSONRPC message from server`)。
- `from typing import Annotated, TypedDict` `Annotated` 给参数挂约束,`TypedDict` 描述返回结构,Day 281 的用法。
- `from pydantic import Field` 约束写在 `Field(...)` 里。
- `from mcp.server import MCPServer` 2.x 的 server 类,老教程里的 `FastMCP` 在这个版本已经不存在。
- `from mcp.server.mcpserver.exceptions import ToolError` 工具里抛可改正的错误用它,到客户端是 `is_error=True` 的正常结果。
- `from mcp.types import ToolAnnotations` 给工具贴读写提示。
- `from part05.text2sql.safe_db import SQLRejected, run_sql` Day 292 拼好的执行器。`SQLRejected` 是它对外唯一的异常。
- `from part05.text2sql.schema import schema_text` Day 291 的说明书生成器。
- `logging.basicConfig(stream=sys.stderr, level=logging.INFO, format="[sql-server] %(message)s")` 日志写到 stderr,每行加个 `[sql-server]` 前缀,在终端里一眼分得出哪行是 server 的。
- `mcp = MCPServer(` 创建 server,名字 `cloudledger-sql`,握手时 client 的 `server_info.name` 看到的就是它。
- `instructions="云簿 CloudLedger 的只读问数工具。` 握手时交给 host 的使用说明,会进模型的系统提示词,所以要短而有用:告诉它先读 resource 再调工具。
- `class QueryResult(TypedDict):` 返回结构写成 TypedDict,SDK 才会生成 `outputSchema` 并给出 `structuredContent`(Day 281)。
- `rows: list[list[str | int | float | None]]` SQLite 的值只会是这四种(文字、整数、小数、NULL),写清楚,schema 里就是 `anyOf` 四选一。用 `list[list]` 更省事,但那样 `outputSchema` 里的 `rows` 元素没有类型。
- `@mcp.resource("cloudledger://schema", mime_type="text/plain")` 地址必写(Day 284),`cloudledger://` 是我们自己起的 scheme。
- `return schema_text()` 每次读取时现生成,实测约 2577 个字符。库里加了列、加了新取值,下一次读就是新的,不用改 server。
- `@mcp.tool(annotations=ToolAnnotations(read_only_hint=True, open_world_hint=False))` 只读、不碰外部世界。host 靠它决定要不要弹确认(Day 289),但它只是提示,真正只读靠 `safe_db` 里的三道闸。
- `def run_query(sql: Annotated[str, Field(min_length=6, max_length=2000` 长度下限 6 挡掉空串和乱码(`SELECT` 本身就 6 个字符),上限 2000 挡掉把整本书塞进来的调用。校验在函数执行前由 pydantic 做,实测传 `"x"` 得到 `String should have at least 6 characters`。
- `log.info("run_query: %s", sql[:80])` 只记前 80 个字符。日志里存完整 SQL 可能带出敏感字符串,截断是个习惯。
- `cols, rows = run_sql(sql)` 三道闸和超时都在里面,这个 server 自己一行安全逻辑都不用写。
- `except SQLRejected as e:` Day 292 的设计:被拒绝、列名写错、超时,统一是这一种异常。
- `raise ToolError(str(e)) from e` 把原因原样交给模型。`str(e)` 是「只允许 SELECT,收到的是 DELETE」这类写给模型看的话。
- `return QueryResult(columns=cols, rows=[list(r) for r in rows], row_count=len(rows))` `run_sql` 返回的行是元组,转成列表是因为 JSON 里没有元组。`row_count` 单独给一个,模型数行数容易数错。
- `@mcp.prompt()` prompt 的参数只能是字符串。
- `f"用户的问题:{question}\n"` 把问题放进模板的第一行。
- `"先读 cloudledger://schema 看表结构和业务口径,再写一条 SELECT 调用 run_query。"` prompt 可以指挥模型去读同一个 server 的 resource,这是 resource 由 host 决定放不放进上下文的变通:用 prompt 提醒一句。
- `if __name__ == "__main__":` 直接运行时才启动,被 import(比如测试里)不会启动。
- `mcp.run()` 默认 stdio。

</div>

先不写测试,用 Day 287 的办法在内存里连一次,看看这个 server 对外长什么样。下面这段是临时脚本,看完就删:

```bash
uv run python - <<'PY'
import anyio
from mcp import Client
from part05.review42_sql_server import mcp

async def main() -> None:
    async with Client(mcp) as c:
        tool = (await c.list_tools()).tools[0]
        print(tool.name, "| 只读" if tool.annotations and tool.annotations.read_only_hint else "")
        print("输入:", tool.input_schema["properties"]["sql"])
        r = await c.call_tool("run_query", {"sql": "SELECT plan, COUNT(*) AS n FROM subscriptions GROUP BY plan"})
        print(r.is_error, r.structured_content)

anyio.run(main)
PY
```

<div class="line-notes">

- `uv run python - <<'PY'` 从标准输入读脚本,`<<'PY'` 到 `PY` 之间的内容当成程序,免得为一次性的探索专门建文件。
- `async with Client(mcp) as c:` 传 server 对象,走内存(Day 287)。
- `tool = (await c.list_tools()).tools[0]` 取第一个工具,一共只有一个。
- `print("输入:", tool.input_schema["properties"]["sql"])` 看 pydantic 根据 `Annotated`/`Field` 生成的 JSON Schema。

</div>

```text
[sql-server] run_query: SELECT plan, COUNT(*) AS n FROM subscriptions GROUP BY plan
run_query | 只读
输入: {'description': '一条 SQLite 的 SELECT 语句', 'maxLength': 2000, 'minLength': 6, 'title': 'Sql', 'type': 'string'}
False {'columns': ['plan', 'n'], 'rows': [['专业版', 10], ['企业版', 8], ['基础版', 12]], 'row_count': 3}
```

最上面那行 `[sql-server] run_query: ...` 是 server 的日志,走的是 stderr,所以和程序的输出混在终端里,但不会混进协议。

`description`、`minLength`、`maxLength` 都进了工具的输入 schema,模型看工具清单时就能读到「一条 SQLite 的 SELECT 语句」和长度限制。三个套餐 10、8、12,和 Day 292 里 `safe_db` 自测的输出一模一样,说明包装没改变执行结果。

### 把它写成合同

和 Day 287 一样,每条测试只做一件事。这个 server 不写库,不需要每个测试一份新库;但会碰到五个不同的失败原因,每一个都值得单独锁住:

```python
# agent-zero-lab/tests/test_review42_sql_server.py
"""第 42 周小项目的合同:问数 server 的一个工具、一个 resource、一个 prompt 各自该怎么表现。"""
from collections.abc import AsyncIterator

import pytest
from mcp import Client
from mcp.types import TextContent, TextResourceContents

from part05.review42_sql_server import mcp

pytestmark = pytest.mark.anyio


@pytest.fixture
async def sql_client() -> AsyncIterator[Client]:
    async with Client(mcp, raise_exceptions=True) as c:
        yield c


def text_of(result) -> str:
    block = result.content[0]
    assert isinstance(block, TextContent)
    return block.text


async def test_lists_everything(sql_client: Client) -> None:
    tools = (await sql_client.list_tools()).tools
    assert [t.name for t in tools] == ["run_query"]
    assert tools[0].annotations is not None
    assert tools[0].annotations.read_only_hint is True
    assert [str(r.uri) for r in (await sql_client.list_resources()).resources] == ["cloudledger://schema"]
    assert [p.name for p in (await sql_client.list_prompts()).prompts] == ["ask_data"]


async def test_group_by_plan(sql_client: Client) -> None:
    r = await sql_client.call_tool("run_query", {"sql": "SELECT plan, COUNT(*) AS n FROM subscriptions GROUP BY plan"})
    assert not r.is_error
    assert r.structured_content == {
        "columns": ["plan", "n"],
        "rows": [["专业版", 10], ["企业版", 8], ["基础版", 12]],
        "row_count": 3,
    }


@pytest.mark.parametrize(
    ("sql", "hint"),
    [
        ("DELETE FROM invoices", "只允许 SELECT"),
        ("SELECT 1; DROP TABLE invoices", "一次只能执行一条"),
        ("SELECT * FROM pragma_table_info('customers')", "not authorized"),
        ("SELECT nme FROM customers", "no such column"),
    ],
)
async def test_rejected_sql_is_tool_error_with_reason(sql_client: Client, sql: str, hint: str) -> None:
    r = await sql_client.call_tool("run_query", {"sql": sql})
    assert r.is_error
    assert hint in text_of(r)


async def test_limit_is_added(sql_client: Client) -> None:
    r = await sql_client.call_tool("run_query", {"sql": "SELECT a.id FROM invoices a, invoices b"})
    assert r.structured_content is not None
    assert r.structured_content["row_count"] == 200


async def test_timeout_is_reported(sql_client: Client) -> None:
    r = await sql_client.call_tool("run_query", {"sql": "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n) SELECT COUNT(*) FROM n"})
    assert r.is_error
    assert "被中断" in text_of(r)


async def test_too_short_sql_rejected_by_schema(sql_client: Client) -> None:
    r = await sql_client.call_tool("run_query", {"sql": "x"})
    assert r.is_error
    assert "at least 6 characters" in text_of(r)


async def test_schema_resource(sql_client: Client) -> None:
    got = await sql_client.read_resource("cloudledger://schema")
    block = got.contents[0]
    assert isinstance(block, TextResourceContents)
    assert "CREATE TABLE invoices" in block.text
    assert "实际取值" in block.text
    assert "业务术语" in block.text


async def test_ask_data_prompt(sql_client: Client) -> None:
    got = await sql_client.get_prompt("ask_data", {"question": "现在的 MRR 是多少元?"})
    msg = got.messages[0]
    assert isinstance(msg.content, TextContent)
    assert "现在的 MRR 是多少元?" in msg.content.text
    assert "run_query" in msg.content.text
```

<div class="line-notes">

- `from collections.abc import AsyncIterator` 异步 fixture 的返回类型,Day 287 讲过。
- `from mcp.types import TextContent, TextResourceContents` 结果里内容块的两个类型,下面用 `isinstance` 收窄,类型检查才认 `.text`。
- `from part05.review42_sql_server import mcp` 拿到 server 对象。`pyproject.toml` 里的 `pythonpath = ["."]` 让 `part05` 能被找到。
- `pytestmark = pytest.mark.anyio` 整个文件的测试都交给 anyio 跑。拼错成别的名字不报错、只是不生效(Day 287 的坑)。
- `async def sql_client() -> AsyncIterator[Client]:` 起名叫 `sql_client` 而不是 `client`,因为 Day 287 的 `conftest.py` 里已经有一个叫 `client` 的 fixture,它连的是 CloudLedger 业务 server。同名的话,测试文件里的会盖住 conftest 的,看着没事,换个文件就连错了 server。
- `async with Client(mcp, raise_exceptions=True) as c:` 内存连接。`raise_exceptions=True` 管的是工具函数体之外的失败(Day 287)。
- `def text_of(result) -> str:` 取第一个内容块的文字。
- `assert tools[0].annotations.read_only_hint is True` 锁住「这是只读工具」这个承诺。有人哪天把它改成写工具、忘了改注解,这里会红。
- `== ["cloudledger://schema"]` `uri` 是 URL 对象,转字符串才能和列表比。
- `assert r.structured_content == {` 整个结构一起断言,字段名和值都是模型会读到的东西。代入实测:`columns` 是 `['plan', 'n']`,三行是 10、8、12 个订阅,`row_count` 3。
- `@pytest.mark.parametrize(` 四种该被拒的 SQL 展开成四条测试(Day 73)。
- `("DELETE FROM invoices", "只允许 SELECT"),` 第一道闸拦。
- `("SELECT 1; DROP TABLE invoices", "一次只能执行一条"),` 分号注入,同样第一道闸。
- `("SELECT * FROM pragma_table_info('customers')", "not authorized"),` 只有第三道闸(授权回调)拦得住的那一条。
- `("SELECT nme FROM customers", "no such column"),` 执行期的错误,不是安全问题,但它是模型最常犯的错,报错信息得原样给它看。
- `assert r.is_error` 工具里的 `ToolError` 到客户端是 `is_error=True` 的普通结果,不是异常,所以不用 `pytest.raises`(Day 287)。
- `assert hint in text_of(r)` 实测全文是 `Error executing tool run_query: 只允许 SELECT,收到的是 DELETE`,前缀是 SDK 加的,我们只断言自己写的那一半。
- `{"sql": "SELECT a.id FROM invoices a, invoices b"}` 没写 LIMIT 的两表笛卡尔积。123 × 123 = 15129 行,被自动补的 `LIMIT 200` 截成 200。这条测的是第一道闸的补 LIMIT 在整条链路里真的生效。
- `assert r.structured_content["row_count"] == 200` 先有上一行的 `is not None` 才能下标取值,类型检查器也要求这样。
- `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n) SELECT COUNT(*) FROM n` 没有终止条件的递归,一直数下去,用它测超时。我第一版用的是 Day 292 那条四表笛卡尔积,结果它在这台电脑上没被中断,老老实实返回了 2.3 亿,测试变红。Day 292 里同一条要跑 10.5 秒,这次我单独量是 4.8 秒,机器忙闲不同,差好几倍。**测超时要用「永远跑不完」的查询,别用「看机器快慢」的。**
- `assert "被中断" in text_of(r)` `safe_db` 超时时的文案是「查询超过 3.0 秒被中断,换一种写法」。
- `{"sql": "x"}` 只有一个字符,过不了 `min_length=6`。
- `assert "at least 6 characters" in text_of(r)` 这是 pydantic 在函数执行前拦下的,`run_sql` 根本没被调用。
- `assert "CREATE TABLE invoices" in block.text` 说明书里有建表语句,第一层。
- `assert "实际取值" in block.text` 第二层,枚举列的真实取值。
- `assert "业务术语" in block.text` 第三层,术语表。三层缺一层,这个测试就红。
- `got = await sql_client.get_prompt("ask_data", {"question": "现在的 MRR 是多少元?"})` prompt 的参数全是字符串。
- `assert "run_query" in msg.content.text` 模板里要点名工具,不然模型不知道该调谁。

</div>

```bash
uv run pytest -q tests/test_review42_sql_server.py
```

```text
...........                                                              [100%]
11 passed in 5.21s
```

十一条里只有超时那一条慢,占了 3 秒,用 `--durations=3` 能看到:

```text
============================= slowest 3 durations ==============================
3.01s call     tests/test_review42_sql_server.py::test_timeout_is_reported[asyncio]
3.00s call     tests/test_safe_db.py::test_timeout
0.21s call     tests/test_review42_sql_server.py::test_group_by_plan[asyncio]
21 passed in 8.04s
```

`test_safe_db.py` 是 Day 292 练习 1 的那 10 条,`pytest` 不带文件名时一起跑,21 条全过。

### 这些测试真的能抓住 bug 吗

有测试不等于测试有用。故意把 `safe_db.py` 里的授权回调那一行注释掉,看谁会红:

```bash
sed -i '' 's/^    conn.set_authorizer(_authorizer)/    # conn.set_authorizer(_authorizer)/' part05/text2sql/safe_db.py
uv run pytest -q
```

<div class="line-notes">

- `sed -i '' 's/^    conn.set_authorizer(_authorizer)/    # conn.set_authorizer(_authorizer)/' part05/text2sql/safe_db.py` 把行首四个空格加 `conn.set_authorizer(_authorizer)` 的那一行,前面加上 `# `。`-i ''` 是 macOS 的 sed 就地修改写法,Linux 上是 `-i`。四个空格是为了只匹配 `run_sql` 里缩进的那一行。

</div>

```text
FAILED tests/test_review42_sql_server.py::test_rejected_sql_is_tool_error_with_reason[asyncio-SELECT * FROM pragma_table_info('customers')-not authorized]
FAILED tests/test_safe_db.py::test_rejected[SELECT * FROM pragma_table_info('customers')-not authorized]
2 failed, 19 passed in 8.24s
```

恰好两条红,都是读表结构那一条。其余 19 条照样过:DELETE 和分号注入是第一道闸拦的,拿掉授权回调也拦得住。这和 Day 292 那张「三道闸各挡住了什么」的表对得上:PRAGMA 那一行只有第三道闸管。改回来(把行首的 `# ` 删掉),再跑一次,21 条全绿。

这个实验有个副产品:包装层的测试(`test_review42_sql_server.py`)和执行层的测试(`test_safe_db.py`)同时红了,说明执行层的问题会传到 server 外面,模型真的会读到那条 PRAGMA 的结果。两层各有一份测试,谁漏了谁都不会悄悄放过。

### stdio 冒烟:从外面拉起来走一遍

内存测试跳过了「用一条命令把 server 拉起来」这一步(Day 287、288)。像 host 一样用 stdio 连一次,七项检查,任何一项失败就以退出码 1 结束:

```python
# agent-zero-lab/part05/review42_smoke.py
"""第 42 周小项目的冒烟检查:像 host 一样用 stdio 拉起 server,从外面走一遍。在 agent-zero-lab 根目录或别处都能跑。"""
import sys
import time
from pathlib import Path

import anyio
from mcp import Client, StdioServerParameters
from mcp.types import TextContent

ROOT = Path(__file__).resolve().parents[1]
PARAMS = StdioServerParameters(command=sys.executable, args=["-m", "part05.review42_sql_server"], cwd=str(ROOT))
failed: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'} {name} {detail}")
    if not ok:
        failed.append(name)


async def main() -> None:
    start = time.perf_counter()
    async with Client(PARAMS) as c:
        info = c.server_info
        check("握手", info is not None and info.name == "cloudledger-sql", f"| {info.name if info else '?'} | 协议 {c.protocol_version}")
        check("instructions", "cloudledger://schema" in (c.instructions or ""))

        tools = (await c.list_tools()).tools
        check("工具只有 run_query", [t.name for t in tools] == ["run_query"])

        ok = await c.call_tool("run_query", {"sql": "SELECT COUNT(*) AS n FROM invoices WHERE status = 'open'"})
        check("正常查询", not ok.is_error and ok.structured_content is not None and ok.structured_content["rows"] == [[10]], f"| {ok.structured_content}")

        bad = await c.call_tool("run_query", {"sql": "DELETE FROM invoices"})
        block = bad.content[0]
        check("DELETE 被拒", bad.is_error and isinstance(block, TextContent) and "只允许 SELECT" in block.text)

        schema = await c.read_resource("cloudledger://schema")
        check("说明书可读", len(schema.contents) == 1)

        prompt = await c.get_prompt("ask_data", {"question": "有多少企业版客户?"})
        check("提问模板", len(prompt.messages) == 1)
    print(f"共 {time.perf_counter() - start:.1f} 秒,{len(failed)} 项失败")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    anyio.run(main)
```

<div class="line-notes">

- `ROOT = Path(__file__).resolve().parents[1]` 这个文件是 `agent-zero-lab/part05/review42_smoke.py`,`parents[0]` 是 `part05/`,`parents[1]` 就是 `agent-zero-lab/`。
- `PARAMS = StdioServerParameters(command=sys.executable, args=["-m", "part05.review42_sql_server"], cwd=str(ROOT))` 用当前解释器、按模块方式启动 server(`-m` 才能 import 到 `part05` 包),关键是 `cwd`:让子进程的工作目录固定在项目根目录,从哪儿启动这个冒烟脚本都一样。练习 3 会拿掉它看后果。
- `failed: list[str] = []` 失败项的名字,最后用来决定退出码。
- `def check(name: str, ok: bool, detail: str = "") -> None:` 打一行 PASS 或 FAIL,失败的记下来。比 Day 286 的 bash 版多的好处是 `detail` 能把实际拿到的内容打出来,失败时不用再手动重现。
- `async with Client(PARAMS) as c:` 传 `PARAMS`,所以这次是 stdio:拉起子进程、握手(Day 288)。
- `info = c.server_info` 类型上可能是 `None`,所以下一行先判断。
- `check("握手", info is not None and info.name == "cloudledger-sql"` 实测 `cloudledger-sql | 协议 2026-07-28`。
- `check("instructions", "cloudledger://schema" in (c.instructions or ""))` `c.instructions` 没有时是 `None`,`or ""` 兜住。
- `ok = await c.call_tool("run_query", {"sql": "SELECT COUNT(*) AS n FROM invoices WHERE status = 'open'"})` 数未付发票。
- `ok.structured_content["rows"] == [[10]]` 这个 10 不是凭印象写的:我第一版写成了 13,冒烟检查的 FAIL 行里打出 `{'columns': ['n'], 'rows': [[10]], 'row_count': 1}`,再用 `sqlite3 cloudledger/cloudledger.db "select status, count(*) from invoices group by 1"` 对了一遍,`open|10`、`paid|113`。
- `bad = await c.call_tool("run_query", {"sql": "DELETE FROM invoices"})` 从外面试一次写操作。
- `check("DELETE 被拒"` 三个条件都满足才算过。
- `schema = await c.read_resource("cloudledger://schema")` 读 resource,返回的 `contents` 是一个列表,一份文字一项。
- `prompt = await c.get_prompt("ask_data", {"question": "有多少企业版客户?"})` 取 prompt,参数都是字符串。
- `print(f"共 {time.perf_counter() - start:.1f} 秒,{len(failed)} 项失败")` 实测 2.0 秒。
- `sys.exit(1)` 有失败就退出码 1,放进 CI 或 `&&` 链里能直接用。

</div>

特意换到根目录以外的地方跑,验证 `cwd` 真的管用:

```bash
cd /
/Users/你/agent-zero-lab/.venv/bin/python /Users/你/agent-zero-lab/part05/review42_smoke.py
```

```text
[sql-server] run_query: SELECT COUNT(*) AS n FROM invoices WHERE status = 'open'
[sql-server] run_query: DELETE FROM invoices
[sql-server] Tool 'run_query' failed: 'Error executing tool run_query: 只允许 SELECT,收到的是 DELETE'
PASS 握手 | cloudledger-sql | 协议 2026-07-28
PASS instructions 
PASS 工具只有 run_query 
PASS 正常查询 | {'columns': ['n'], 'rows': [[10]], 'row_count': 1}
PASS DELETE 被拒 
PASS 说明书可读 
PASS 提问模板 
共 2.0 秒,0 项失败
```

前三行是 server 子进程写到 stderr 的日志,client 没有吞掉它,直接显示在终端里。内存测试里这三行同样会出现,只是 pytest 默认把它们收起来(失败时才在 `Captured log call` 里显示)。

### 接进 Claude Code

最后一步,用 Day 289 的办法接进 host。我不想动自己真实的 Claude Code 配置,所以和 Day 289 一样,把 `HOME` 临时指到一个空目录再执行,你自己做的时候不用这么麻烦,直接敲命令就行:

```bash
cd /Users/你/agent-zero-lab
claude mcp add cloudledger-sql -- uv run --directory /Users/你/agent-zero-lab python -m part05.review42_sql_server
claude mcp list
```

<div class="line-notes">

- `claude mcp add cloudledger-sql -- uv run --directory /Users/你/agent-zero-lab python -m part05.review42_sql_server` `--` 之后原样当成启动命令。两个绝对路径(`--directory` 后面)是 Day 289 的教训:host 在它自己的当前目录执行这条命令,相对路径换个目录就 `Connection closed`。这次用 `-m` 按模块启动,所以 `--directory` 更是必须的:`part05` 包只在项目根目录下找得到。
- `claude mcp list` 会真的把每个 server 拉起来试一次。

</div>

```text
Added stdio MCP server cloudledger-sql with command: uv run --directory /Users/你/agent-zero-lab python -m part05.review42_sql_server to local config
File modified: /Users/你/.claude.json [project: /Users/你/agent-zero-lab]
Checking MCP server health…

cloudledger-sql: uv run --directory /Users/你/agent-zero-lab python -m part05.review42_sql_server - ✔ Connected
```

`✔ Connected`。让模型真的用它回答「现在有多少企业版订阅」需要登录 Claude Code 并产生模型调用,这一步我没有实跑;你自己跑的时候,在 Claude Code 里先输入 `/mcp` 确认 `cloudledger-sql` 有 1 个工具,然后提问,它应该会先读 `cloudledger://schema`(或者你在 prompt 菜单里选 `ask_data`),再调 `run_query`。第一次调用时 host 仍会按它自己的规则询问你是否允许(Day 289 实测过只读工具也要点头)。试完删掉:`claude mcp remove cloudledger-sql`。

零件和这个小项目的对照:

| 本周零件 | 在小项目里的哪一段 |
| --- | --- |
| Day 287 内存客户端 + anyio + fixture | `tests/test_review42_sql_server.py` 整个文件 |
| Day 288 `StdioServerParameters`、`Client` | `review42_smoke.py` 的 `PARAMS` 和 `check` |
| Day 289 `claude mcp add`、绝对路径 | 「接进 Claude Code」那两条命令 |
| Day 290 HTTP + Bearer 令牌 | 练习 4 的 `review42_http.py` |
| Day 291 `schema_text()` | `schema_resource()` 和 `test_schema_resource` |
| Day 292 `run_sql`、`SQLRejected` | `run_query` 的 try/except,四条拒绝测试 |

## 本周错题与坑清单

这周写和跑的时候真实撞到的,按出现频率排。前面几天各自的「常见误区」里都有,这里只收最容易再犯的:

| 坑 | 真实报错或现象 | 怎么改 |
| --- | --- | --- |
| 配置里写相对路径 | `claude mcp list` 报 `✘ Failed to connect — CONNECTION_CLOSED: Connection closed`,不提文件找不到 | `--directory` 和文件都写绝对路径;Python 里 `StdioServerParameters` 传 `cwd=` |
| 子进程起不来,client 只看到一句话 | `MCPError: Connection closed`,真正的原因在子进程 stderr:`No module named 'part05'` | 先在终端手动跑一遍启动命令;看 stderr |
| stdio server 里 print | client 日志 `Failed to parse JSONRPC message from server`,内存测试全绿 | 用 `logging` 写 stderr,冒烟检查里加 stdio 连接 |
| 异步测试没贴 anyio 标记 | `async def functions are not natively supported` | `pytestmark = pytest.mark.anyio` |
| 工具里的错误当异常去接 | `pytest.raises` 报 `DID NOT RAISE`,工具错误是 `is_error=True` 的正常结果 | `assert r.is_error` |
| 没鉴权的 HTTP server | 一条 curl 就提交了 2392 元的退款申请 | 中间件检查 `Authorization: Bearer`,令牌用 `os.environ[...]` 读 |
| 401 在 client 里只有一句 | `Server returned an error response`,完全不提鉴权 | 先用 curl 打同一个地址看状态码 |
| 照 1.x 教程写 `streamablehttp_client(url, headers=...)` | 函数名和参数都不存在 | `httpx2.AsyncClient(headers=...)` 传给 `streamable_http_client(url, http_client=...)` |
| `uv add gradio[mcp]` | gradio 6.30.0 要求 `mcp<2`,和 `mcp==2.3.0` 解析冲突 | 演示版单独目录,`uv run --no-project --with` |
| 说明书只给列名 | `plan = 'enterprise'` 匹配不到,`COUNT` 返回 0 不报错 | 加枚举列真实取值、业务术语表 |
| 用 `startswith("SELECT")` 判断 SQL 类型 | 合法的 `WITH ... SELECT` 被拒,分号注入的判断也不靠谱 | sqlglot 解析成语法树再判断 |
| 只接 `sqlite3.OperationalError` | 授权回调拒绝抛的是父类 `DatabaseError`,漏接,模型只看到 `Error executing tool run_query` | 接 `sqlite3.DatabaseError` |
| 授权回调用黑名单、或白名单漏 `SQLITE_RECURSIVE` | 漏了危险操作没有任何提示;漏了合法操作所有递归 CTE 都 `not authorized` | 白名单,发现误伤再补 |
| 用「看机器快慢」的查询测超时 | 慢机器上通过,快机器上 `assert r.is_error` 变红 | 用永远跑不完的递归 CTE |
| fixture 同名 | 测试文件里的 `client` 盖住 conftest 的 `client`,连错 server | 新 fixture 起不同的名字 |

## 动手练习

**练习 1(默写):只读执行器。** 合上文章,在 `part05/review42_dictation.py` 里写一个 `run(sql, limit=200, timeout=3.0)`:解析后只放行单条 SELECT 或 UNION,没写 LIMIT 的自动补;用只读连接;用白名单授权回调;超时用进度回调;所有失败统一抛 `Rejected`。再写六条用例:正常计数、两表笛卡尔积被截成 200 行、DELETE、分号注入、PRAGMA、无限递归。写完对照参考答案看有没有漏掉的坑。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/review42_dictation.py
"""练习 1(默写):合上文章,把「只读、限时、限行数地执行一条模型写的 SQL」写出来。"""
import sqlite3
import time

import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError

from part05.text2sql.bare_schema import DB_PATH

OK_ACTIONS = {sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_FUNCTION, sqlite3.SQLITE_RECURSIVE}


class Rejected(Exception):
    pass


def run(sql: str, limit: int = 200, timeout: float = 3.0) -> list[tuple]:
    try:
        trees = sqlglot.parse(sql, read="sqlite")
    except ParseError as e:
        raise Rejected(f"语法错误:{e}") from e
    if len(trees) != 1 or not isinstance(trees[0], (exp.Select, exp.Union)):
        raise Rejected("只允许一条 SELECT")
    tree = trees[0]
    if tree.args.get("limit") is None:
        tree = tree.limit(limit)

    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.set_authorizer(lambda action, *_: sqlite3.SQLITE_OK if action in OK_ACTIONS else sqlite3.SQLITE_DENY)
    deadline = time.monotonic() + timeout
    conn.set_progress_handler(lambda: int(time.monotonic() > deadline), 10_000)
    try:
        return conn.execute(tree.sql(dialect="sqlite")).fetchall()
    except sqlite3.DatabaseError as e:
        raise Rejected(f"执行出错:{e}") from e
    finally:
        conn.close()


if __name__ == "__main__":
    for s in [
        "SELECT COUNT(*) FROM customers",
        "SELECT a.id FROM invoices a, invoices b",
        "DELETE FROM invoices",
        "SELECT 1; DROP TABLE invoices",
        "SELECT * FROM pragma_table_info('customers')",
        "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n) SELECT COUNT(*) FROM n",
    ]:
        start = time.monotonic()
        try:
            rows = run(s)
            print(f"OK   {s[:44]:<46} {len(rows)} 行 {rows[0]}")
        except Rejected as e:
            print(f"拒绝 {s[:44]:<46} {str(e)[:30]} ({time.monotonic() - start:.1f}s)")
```

<div class="line-notes">

- `OK_ACTIONS = {sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_FUNCTION, sqlite3.SQLITE_RECURSIVE}` 白名单四项,和 Day 292 的 `ALLOWED` 一样。默写时最容易漏的是最后一项 `SQLITE_RECURSIVE`,漏了所有递归 CTE 都 `not authorized`。
- `class Rejected(Exception):` 空类体,只要有个名字让调用方能 `except`。写 `pass` 就够。
- `def run(sql: str, limit: int = 200, timeout: float = 3.0) -> list[tuple]:` 行数上限和超时做成参数,有默认值。和 `safe_db` 把它们写成模块常量不同,这样测试时能传一个很小的 `timeout`。
- `trees = sqlglot.parse(sql, read="sqlite")` 用 `parse` 不用 `parse_one`,为的是能数出有几条语句。
- `raise Rejected(f"语法错误:{e}") from e` 解析失败也走同一种异常。
- `if len(trees) != 1 or not isinstance(trees[0], (exp.Select, exp.Union)):` 两个条件并成一个:不是恰好一条,或者那一条不是查询。`or` 短路,`len` 不对时不会去取 `trees[0]`。这里把 `trees[0] is None`(空语句)交给 `isinstance` 处理:`None` 不是 `Select`,同样被拒。
- `tree = trees[0]` 为了让下面几行读起来短。
- `if tree.args.get("limit") is None:` 没写 LIMIT。
- `tree = tree.limit(limit)` 补上,返回一棵新树。
- `conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)` 第二道闸。路径来自 Day 291 的 `bare_schema.DB_PATH`,不再自己拼一份。
- `conn.set_authorizer(lambda action, *_:` 授权回调回调签名有五个参数,这里只用第一个,`*_` 把其余四个收进一个不用的元组,写法比定义五个形参短。三元表达式:在白名单里返回 `SQLITE_OK`,否则 `SQLITE_DENY`。
- `deadline = time.monotonic() + timeout` 单调时钟,不受系统改时间影响。
- `conn.set_progress_handler(lambda: int(time.monotonic() > deadline), 10_000)` `True` 转成 1、`False` 转成 0,每一万条虚拟机指令检查一次,返回非 0 就中断。
- `return conn.execute(tree.sql(dialect="sqlite")).fetchall()` 执行的是重新生成的 SQL,不是原文,所以补的 LIMIT 才生效。`finally` 里的 `close` 在 `return` 之后照样会执行。
- `except sqlite3.DatabaseError as e:` 接父类,授权拒绝和超时中断都在里面。
- `finally:` 不管成功还是失败,连接都关。
- `print(f"OK   {s[:44]:<46} {len(rows)} 行 {rows[0]}")` 取每条语句前 44 个字符,`:<46` 左对齐补空格到 46 宽,输出才对得齐。

</div>

`uv run python -m part05.review42_dictation`:

```text
OK   SELECT COUNT(*) FROM customers                 1 行 (30,)
OK   SELECT a.id FROM invoices a, invoices b        200 行 ('INV-2026-0001',)
拒绝 DELETE FROM invoices                           只允许一条 SELECT (0.0s)
拒绝 SELECT 1; DROP TABLE invoices                  只允许一条 SELECT (0.0s)
拒绝 SELECT * FROM pragma_table_info('customers')   执行出错:not authorized (0.0s)
拒绝 WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL S   执行出错:interrupted (3.0s)
```

六条各在该停的地方停下:前两条放行(第二条两表笛卡尔积被截成 200 行),DELETE 和分号注入在解析层被拒,PRAGMA 在授权回调被拒,无限递归 3.0 秒后被进度回调中断。

默写完别忘了对照检查三个最容易漏的点:`SQLITE_RECURSIVE` 在不在白名单里;`except` 接的是 `DatabaseError` 不是 `OperationalError`;补了 LIMIT 之后执行的是**重新生成的 SQL** 而不是原文。三个里漏哪个,最后一条或前两条的输出就会不一样。

</details>

**练习 2(找错):四个错误。** 下面这个 server 里藏了本周讲过的四类错误。先只用眼睛找,写下你认为的四处和各自会出现什么现象;然后把 `review42_buggy_check.py` 跑一遍验证,改好。

```python
# agent-zero-lab/part05/review42_buggy_server.py
"""练习 2:这个问数 server 里藏了本周讲过的四类错误。先用眼睛找,再跑 review42_buggy_check.py 验证。"""
import sqlite3
import time

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from part05.text2sql.bare_schema import DB_PATH

mcp = MCPServer("buggy-sql")
print("buggy-sql server 启动,库文件:", DB_PATH.name, flush=True)


def check_sql(sql: str) -> str:
    if not sql.strip().upper().startswith("SELECT"):
        raise ToolError("只允许 SELECT")
    return sql


@mcp.tool()
def run_query(sql: str) -> list[list]:
    """只读执行一条 SELECT。"""
    safe = check_sql(sql)
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.set_authorizer(
        lambda action, a1, a2, db, src: sqlite3.SQLITE_OK
        if action in {sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_FUNCTION}
        else sqlite3.SQLITE_DENY
    )
    try:
        return [list(r) for r in conn.execute(safe).fetchall()]
    except sqlite3.OperationalError as e:
        raise ToolError(f"执行出错:{e}") from e
    finally:
        conn.close()


if __name__ == "__main__":
    mcp.run()
```

<div class="line-notes">

- `print("buggy-sql server 启动,库文件:", DB_PATH.name, flush=True)` 模块顶层的 print。
- `if not sql.strip().upper().startswith("SELECT"):` 看它怎么判断「是不是查询」。
- `conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)` 只读,这一行没问题。
- `conn.set_authorizer(` 看白名单里有几项。
- `return [list(r) for r in conn.execute(safe).fetchall()]` 看有没有哪里限制了跑多久。
- `except sqlite3.OperationalError as e:` 看它接的是哪个异常。

</div>

<details><summary>参考答案</summary>

`review42_buggy_check.py` 用 stdio 连上这个 server,四种情形各调一次,每次最多等 5 秒。`uv run python -m part05.review42_buggy_check`(stdout 的部分):

```text
A 普通查询: is_error=False | '30'
B 带 CTE 的合法查询: is_error=True | 'Error executing tool run_query: 只允许 SELECT'
C 读表结构: is_error=True | 'Error executing tool run_query'
D 五表笛卡尔积: 5 秒没有回应
```

stderr 的最前面还有一段:

```text
[client 日志] ERROR Failed to parse JSONRPC message from server
Traceback (most recent call last):
  ...
pydantic_core._pydantic_core.ValidationError: 1 validation error for union[JSONRPCRequest,JSONRPCNotification,JSONRPCResponse,JSONRPCError]
  Invalid JSON: expected value at line 1 column 1 [type=json_invalid, input_value='buggy-sql server 启动,...文件: cloudledger.db', input_type=str]
```

**错误一:模块顶层 `print`(Day 288)。** client 读到的第一行不是 JSON,打了 `Failed to parse JSONRPC message from server`,然后跳过继续工作,所以 A、B、C 的结果还是对的。内存测试完全测不到这个。改成 `logging` 写 stderr。我最初把 print 写在工具函数里,发现 mcp 2.3.0 的 stdio server 一启动就把 stdout 转到了 stderr,工具里的 print 不会污染协议;只有 import 时(启动前)的 print 才会。所以我才把它挪到模块顶层,还加了 `flush=True`:不加的话这行字留在缓冲区里,client 一次都读不到,看起来像没问题。

**错误二:`startswith("SELECT")` 判断语句类型(Day 292)。** B 那条带 CTE 的合法查询被拒:`只允许 SELECT`。字符串检查会误伤以 `WITH` 开头的查询,也防不住真正的注入。换成 sqlglot 解析成语法树再判断。

**错误三:只接 `OperationalError`(Day 292)。** C 那条读表结构被授权回调拒绝,抛的是它的父类 `DatabaseError`,没人接,意外异常到了 SDK 那一层,模型只看到 `Error executing tool run_query`,一个字的原因都没有。server 的 stderr 里能看到 `DatabaseError: not authorized`。改成接 `sqlite3.DatabaseError`。

**错误四:没有超时(Day 292)。** D 那条五表笛卡尔积 123⁵ ≈ 281 亿行,一直算下去,client 等了 5 秒没有任何回应(我用 `anyio.fail_after(5)` 限制的,没有它这个调用会一直等)。server 那一边的进程还在占着 CPU,直到 client 断开才被终止。用 `set_progress_handler` 做超时。

顺带说一个没算作错误的小问题:白名单里没有 `SQLITE_RECURSIVE`,所以就算把错误二改对了,递归 CTE 也会报 `not authorized`。

改好的版本直接用测过的 `safe_db.run_sql`,不再自己拼:

```python
# agent-zero-lab/part05/review42_fixed_server.py
"""练习 2 的参考答案:四处都改掉,执行交给测过的 safe_db。"""
import logging
import sys

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from part05.text2sql.safe_db import SQLRejected, run_sql

logging.basicConfig(stream=sys.stderr, level=logging.INFO)
log = logging.getLogger("fixed-sql")
mcp = MCPServer("fixed-sql")
log.info("fixed-sql server 启动")


@mcp.tool()
def run_query(sql: str) -> list[list]:
    """只读执行一条 SELECT。"""
    try:
        _, rows = run_sql(sql)
    except SQLRejected as e:
        raise ToolError(str(e)) from e
    return [list(r) for r in rows]


if __name__ == "__main__":
    mcp.run()
```

<div class="line-notes">

- `from part05.text2sql.safe_db import SQLRejected, run_sql` 错误二、三、四一起解决:sqlglot 解析、`DatabaseError`、超时都在 `run_sql` 里。
- `logging.basicConfig(stream=sys.stderr, level=logging.INFO)` 错误一的改法:日志只写 stderr。
- `log.info("fixed-sql server 启动")` 同样的一句话,现在走 stderr,不会进协议。
- `_, rows = run_sql(sql)` 列名这里用不上,丢掉。
- `raise ToolError(str(e)) from e` 原因交给模型,实测 C 那条变成 `执行出错:not authorized`。

</div>

`uv run python -m part05.review42_buggy_check part05.review42_fixed_server`(同一个检查脚本,传入新的模块名):

```text
A 普通查询: is_error=False | '30'
B 带 CTE 的合法查询: is_error=False | '123'
C 读表结构: is_error=True | 'Error executing tool run_query: 执行出错:not authorized'
D 五表笛卡尔积: is_error=True | 'Error executing tool run_query: 查询超过 3.0 秒被中断,换一种写法'
```

四种情形都变了:B 通过(CTE 里的 `invoices` 有 123 行),C 有了原因,D 3 秒后被中断而不是一直挂着;这次 stderr 里也没有 `Failed to parse JSONRPC message`。

</details>

**练习 3(观察会发生什么):拿掉 `cwd`。** `review42_smoke.py` 里的 `StdioServerParameters` 有一个 `cwd=str(ROOT)`。新建 `part05/review42_nocwd.py`,把它拿掉,先在 `agent-zero-lab/` 根目录里跑,再 `cd /` 以后跑,看区别。记下 client 看到的报错和子进程 stderr 里的原话,解释为什么。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/review42_nocwd.py
"""练习 3:和 review42_smoke.py 一样的连接,但没有 cwd。从不同目录各跑一次,看会怎样。"""
import sys

import anyio
from mcp import Client, StdioServerParameters

PARAMS = StdioServerParameters(command=sys.executable, args=["-m", "part05.review42_sql_server"])


async def main() -> None:
    async with Client(PARAMS) as c:
        tools = await c.list_tools()
        print("连上了,工具:", [t.name for t in tools.tools])


if __name__ == "__main__":
    anyio.run(main)
```

<div class="line-notes">

- `PARAMS = StdioServerParameters(command=sys.executable, args=["-m", "part05.review42_sql_server"])` 没有 `cwd`,子进程继承 client 当前所在的目录。
- `print("连上了,工具:", [t.name for t in tools.tools])` 连上了才会打印。

</div>

在 `agent-zero-lab/` 根目录:

```bash
uv run python part05/review42_nocwd.py
```

```text
连上了,工具: ['run_query']
```

换到 `/`,用虚拟环境里的解释器直接跑:

```bash
cd /
/Users/你/agent-zero-lab/.venv/bin/python /Users/你/agent-zero-lab/part05/review42_nocwd.py
```

```text
/Users/你/agent-zero-lab/.venv/bin/python: Error while finding module specification for 'part05.review42_sql_server' (ModuleNotFoundError: No module named 'part05')
  ...
mcp.shared.exceptions.MCPError: Connection closed
```

第一行是子进程自己的 stderr,最后一行才是 client 看到的结果:只有一句 `Connection closed`。

原因和 Day 288、289 实测过的是同一件事:`-m part05.review42_sql_server` 要在「当前目录里能找到 `part05/`」的地方才跑得起来。根目录里能找到,所以第一次连上了;`/` 里找不到,子进程一启动就退出,client 这一端看不到任何原因,只知道对面把连接关了。这也是练习仓库里 `review42_smoke.py` 要显式写 `cwd=str(ROOT)` 的原因。

排查这类问题的固定顺序:先把 `command` 和 `args` 拼成一条命令,在同样的目录里手动敲一遍,看终端里的报错;client 报 `Connection closed`、host 报 `CONNECTION_CLOSED`,都说明子进程没起来,答案在它的 stderr 里。

</details>

**练习 4(开放题):给问数 server 加上 HTTP 和令牌。** 照 Day 290 的做法,新建 `part05/review42_http.py`,把 `review42_sql_server` 里的 `mcp` 放到 `127.0.0.1:8766` 上,每个请求都要带 `Authorization: Bearer <token>`,令牌从环境变量 `SQL_SERVER_TOKEN` 读。再写一个 client:不带令牌打一次(期望 401),带令牌连上调一次 `run_query`,再试一次 `UPDATE`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/review42_http.py
"""练习 4:把问数 server 放到 HTTP 上,每个请求都要带 Authorization: Bearer <token>。"""
import os
import secrets

import uvicorn
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from part05.review42_sql_server import mcp

TOKEN = os.environ["SQL_SERVER_TOKEN"]  # 没设置就 KeyError 起不来,不退化成空字符串


class BearerAuth(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        scheme, _, token = request.headers.get("authorization", "").partition(" ")
        if scheme.lower() != "bearer" or not token or not secrets.compare_digest(token.encode(), TOKEN.encode()):
            return JSONResponse({"error": "unauthorized"}, status_code=401, headers={"WWW-Authenticate": "Bearer"})
        return await call_next(request)


app = mcp.streamable_http_app()
app.add_middleware(BearerAuth)

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8766, log_level="warning")
```

<div class="line-notes">

- `from part05.review42_sql_server import mcp` 工具、resource、prompt 一行不改,换的只是传输方式(Day 290)。
- `TOKEN = os.environ["SQL_SERVER_TOKEN"]` 用方括号不用 `.get`,没设置就启动失败。
- `scheme, _, token = request.headers.get("authorization", "").partition(" ")` 在第一个空格处切成三段,`"Bearer abc"` 得到 `("Bearer", " ", "abc")`,没带头得到三个空串。
- `if scheme.lower() != "bearer" or not token` 三种情况都拒绝:方案不对、令牌为空、令牌不匹配。`compare_digest` 不用 `==`,防止通过响应时间猜令牌;两边都 `.encode()` 是它要求 bytes。
- `return JSONResponse({"error": "unauthorized"}, status_code=401, headers={"WWW-Authenticate": "Bearer"})` 没通过就直接返回,请求到不了 MCP 那一层,工具函数一个都不执行。
- `app = mcp.streamable_http_app()` 拿到 Starlette 应用对象但先不启动。
- `app.add_middleware(BearerAuth)` 所有请求先过它。
- `uvicorn.run(app, host="127.0.0.1", port=8766, log_level="warning")` 只绑本机。8766 是为了不和 Day 290 的 8765 撞。

</div>

```python
# agent-zero-lab/part05/review42_http_client.py
"""练习 4 的 client:先不带令牌打一下,再带上令牌连,调一次 run_query。"""
import os

import anyio
import httpx2
from mcp import Client
from mcp.client.streamable_http import streamable_http_client

URL = "http://127.0.0.1:8766/mcp"


async def main() -> None:
    async with httpx2.AsyncClient() as http:
        r = await http.post(URL, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
        print("不带令牌:", r.status_code, r.json())

    headers = {"Authorization": f"Bearer {os.environ['SQL_SERVER_TOKEN']}"}
    async with httpx2.AsyncClient(headers=headers) as http:
        async with Client(streamable_http_client(URL, http_client=http)) as client:
            result = await client.call_tool("run_query", {"sql": "SELECT plan, COUNT(*) AS n FROM subscriptions GROUP BY plan"})
            print("带令牌:", result.structured_content)
            bad = await client.call_tool("run_query", {"sql": "UPDATE invoices SET status = 'paid'"})
            print("写操作:", bad.is_error)


if __name__ == "__main__":
    anyio.run(main)
```

<div class="line-notes">

- `r = await http.post(URL, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})` 用裸 HTTP 请求打一下,看陌生人会得到什么。
- `print("不带令牌:", r.status_code, r.json())` 实测 `401 {'error': 'unauthorized'}`。
- `headers = {"Authorization": f"Bearer {os.environ['SQL_SERVER_TOKEN']}"}` 这个例子里 client 和 server 在同一台电脑,所以用同一个环境变量名;真实场景里它们在两台机器上,变量名可以不同。
- `async with httpx2.AsyncClient(headers=headers) as http:` 2.x 的 `streamable_http_client` 没有 `headers=` 参数,要自己建一个带头的 HTTP 客户端传进去(Day 290)。
- `Client(streamable_http_client(URL, http_client=http))` 传 HTTP 传输对象,握手之后的用法和内存、stdio 完全一样。
- `bad = await client.call_tool("run_query", {"sql": "UPDATE invoices SET status = 'paid'"})` 令牌对了,不等于什么都能做:写操作照样在第一道闸被拒。
- `print("写操作:", bad.is_error)` 实测 `True`。

</div>

终端 A 启动 server(令牌随机生成,只存在这个终端的环境变量里):

```bash
export SQL_SERVER_TOKEN=$(python3 -c "import secrets;print(secrets.token_urlsafe(24))")
uv run python -m part05.review42_http
```

终端 B 用同一个环境变量跑 client:

```bash
uv run python -m part05.review42_http_client
```

```text
不带令牌: 401 {'error': 'unauthorized'}
带令牌: {'columns': ['plan', 'n'], 'rows': [['专业版', 10], ['企业版', 8], ['基础版', 12]], 'row_count': 3}
写操作: True
```

终端 A 里能看到 server 的日志(`log_level="warning"` 只管 uvicorn 的访问日志,我们自己的 `[sql-server]` 日志不受影响):

```text
[sql-server] StreamableHTTP session manager started
[sql-server] run_query: SELECT plan, COUNT(*) AS n FROM subscriptions GROUP BY plan
[sql-server] run_query: UPDATE invoices SET status = 'paid'
[sql-server] Tool 'run_query' failed: 'Error executing tool run_query: 只允许 SELECT,收到的是 UPDATE'
```

三层各管各的:令牌决定「谁能连」,sqlglot 和只读连接决定「连上之后能做什么」,工具的 `ToolError` 把原因交给模型。陌生人连 `run_query` 都碰不到,拿到令牌的调用方想改库也改不了。

</details>

**验收标准**:`pytest -q` 21 条全绿;`review42_smoke.py` 七项 PASS;`claude mcp list` 显示 `✔ Connected`;练习 1 默写出来的 `run` 六条用例输出和参考答案一致;练习 2 的四个错误你在看参考答案之前至少找出两个;你能不看文章,画出内存、stdio、HTTP 三种连法各自「测得到什么、测不到什么」。

## 名词解释

本周第一次出现的术语都在各天的表里,这里只收复习时最容易混的几个,和今天新出现的。

| 名词 | 意思 |
| --- | --- |
| 内存连接 | `Client(server对象)`,client 和 server 在同一个进程里用内存管道说 MCP,不起子进程也不开端口(Day 287) |
| stdio 传输 | client 拉起 server 子进程,靠标准输入输出说话;只有本机程序能用(Day 288) |
| Streamable HTTP | server 自己开着门,client 用网址连;可以跨机器,也因此必须有鉴权(Day 290) |
| 冒烟检查 | 只走关键路径、速度快的验收脚本,看「能不能连上、主要功能通不通」,不追求覆盖面 |
| `cwd` | 子进程的工作目录;不传就继承父进程当前所在的目录,相对路径和 `-m` 都依赖它 |
| fixture 同名覆盖 | 测试文件里的 fixture 和 conftest 里的同名时,离测试近的那个生效,换个文件可能就连错对象 |
| 合同测试 | 把 server 对外承诺的行为(字段名、错误文字、写入状态)写成断言,谁改了谁就红(Day 287) |
| 突变实验 | 故意改坏被测代码,看测试会不会变红;不红说明那条逻辑没有被测试守住 |
| `outputSchema` | 工具返回 TypedDict 时 SDK 生成的输出结构,模型和 host 可据此理解返回值(Day 281) |
| 包装层 / 执行层 | 小项目里 server 是包装层(协议、错误转换),`safe_db` 是执行层(安全、超时);各有各的测试 |

## 常见误区

**以为复习日可以只看不写。** 这周的代码看着都眼熟,合上文章默写时最容易漏的是 `SQLITE_RECURSIVE` 和 `except` 该接哪个异常,这两处不动手根本想不起来。练习 1 一定要真写。

**冒烟检查里的期望值凭印象写。** 我第一版把未付发票数写成了 13,检查脚本直接 FAIL,打出来的实际值是 10。期望值要从库里用 `sqlite3` 查出来,不要凭记忆。FAIL 里把实际值打出来是个好习惯,第一次失败就能看出是代码错还是期望错。

**用「看机器快慢」的查询测超时。** 四表笛卡尔积在 Day 292 那台机器上要 10.5 秒,在我今天这台上单独量是 4.8 秒,而且测试里它没被中断就返回了。要测超时,用永远不会结束的递归 CTE。

**测试写完就以为守住了。** 突变实验:注释掉授权回调,19 条测试照样绿,只有 PRAGMA 那 2 条红。如果当初没写那一条用例,拿掉整个第三道闸,测试一条都不红。测试守住的只是你写下了断言的那些行为。

**把包装层和执行层的测试混成一份。** `test_safe_db.py` 测 `run_sql` 本身,`test_review42_sql_server.py` 测 server 包装:错误有没有变成 `is_error=True`、字段名对不对、schema 校验。以后换了传输方式或工具名,只改后一份;换了数据库,只改前一份。

**fixture 起名和 conftest 撞了。** 在测试文件里再定义一个叫 `client` 的 fixture,会盖住 conftest 里的同名那个,连的 server 变了也不报错。小项目里我起名叫 `sql_client` 就是为了避开。

**`cwd` 不传,换个目录就连不上。** 练习 3 实测,client 只看到 `Connection closed`,原因只在子进程的 stderr 里。冒烟脚本、host 配置都要把工作目录或绝对路径写死。

**令牌对了就当什么都能做。** 练习 4 里带令牌的 client 照样被第一道闸拒绝了 `UPDATE`。认证(你是谁)和授权(你能做什么)是两件事,这个 server 的授权在 `safe_db` 里,不在 HTTP 中间件里。

## 学习资料

### 文档与文章

- [MCP Python SDK(GitHub)](https://github.com/modelcontextprotocol/python-sdk):本周所有写法的出处。想知道 `Client`、`MCPServer`、`ToolError` 还能怎么用,看它的 README 和 `examples/`。
- [AnyIO · Testing with AnyIO](https://anyio.readthedocs.io/en/stable/testing.html):`@pytest.mark.anyio` 的官方说明,Day 287 的异步测试靠它,里面讲了 fixture 怎么写成异步。
- [pytest · How to use fixtures](https://docs.pytest.org/en/stable/how-to/fixtures.html):想弄清 fixture 同名覆盖的规则,看「Overriding fixtures on various levels」那一节。
- [sqlglot(GitHub)](https://github.com/tobymao/sqlglot):本周问数的第一道闸,README 里的 Parser 和 AST 两节。
- [Python 文档 · sqlite3](https://docs.python.org/3/library/sqlite3.html):搜 `set_authorizer` 和 `set_progress_handler`,默写练习用到的两个回调。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1AnQNYxEsy&autoplay=0&high_quality=1" title="MCP是啥?技术原理是什么?一个视频搞懂MCP的一切。Windows系统配置MCP,Cursor Cline使用MCP" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>技术爬爬虾 · MCP是啥?技术原理是什么?一个视频搞懂MCP的一切 · 15 分钟。2025 年 3 月的视频,里面的 Windows、Cursor 配置界面已经有变化,只看前半部分的原理:client、server、host 三者怎么分工,对照这周 Day 288 和 Day 289。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1SytL6vE29&autoplay=0&high_quality=1" title="pytest为什么要用fixture?看完你就懂了" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Yoyo本慢 · pytest为什么要用fixture?看完你就懂了 · 6 分钟。短,讲 fixture 解决的是什么问题,对照 Day 287 的 `conftest.py` 和今天 `sql_client` 的写法。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/CQywdSdi5iA" title="The Model Context Protocol (MCP)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Anthropic · The Model Context Protocol (MCP) · 19 分钟,官方出的介绍,英文,开自动字幕。讲 MCP 为什么存在、三种原语怎么分工,回头看本周的 server、client、host 会更清楚。</figcaption>
</figure>

### 书籍

- Brian Okken,《Python Testing with pytest》(第 2 版),Pragmatic Bookshelf,2022。第 3、4 章讲 fixture 和 conftest 的细节,和本周的合同测试对得上。中文版出版信息我没能核实,这里只写英文原版。

### 开源项目与代码

- [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers):官方的参考 server 集合。想看别人的 server 怎么拆工具、怎么写测试,挑一个小的(比如 `time`)读它的 `tests/`。
- [simonw/datasette](https://github.com/simonw/datasette):把 SQLite 发布成网页、允许任意只读 SQL 的工具。它的 `set_authorizer` 和超时用法和 `safe_db` 一个思路,可以对照读。

## 自测

1. 同一个 server,内存连接测得到、stdio 连接才测得到、HTTP 连接才测得到的,各举一个例子。

<details><summary>答案</summary>

内存连接测工具逻辑和错误文字,比如 `DELETE` 被拒时文字里有「只允许 SELECT」。stdio 才测得到启动命令和 stdout:今天练习 2 里模块顶层的 `print` 在内存测试里完全看不出,用 stdio 的 client 才报 `Failed to parse JSONRPC message from server`;练习 3 的 `cwd` 也只有 stdio 才暴露。HTTP 才测得到鉴权:练习 4 里不带令牌得 401。

</details>

2. 小项目里 `run_query` 的 `ToolError(str(e))` 为什么比让 `SQLRejected` 直接抛出去好?

<details><summary>答案</summary>

意外异常到了 SDK 那一层,模型只会看到 `Error executing tool run_query`,没有原因(练习 2 的错误三实测过)。`ToolError` 是「可改正的错误」,文字原样交给模型,它看到「只允许 SELECT,收到的是 DELETE」或「no such column: nme」就知道该怎么改,而不是原样重试。

</details>

3. 拿掉授权回调以后,为什么 21 条测试里只有 2 条变红?

<details><summary>答案</summary>

因为只有读表结构(PRAGMA)那一种 SQL 是靠第三道闸拦下的。DELETE、UPDATE、ATTACH、分号注入在第一道闸(sqlglot)就被拒了,列名写错是执行期的普通错误,都和授权回调无关。测试只守住写下了断言的行为,所以红的恰好是 `test_safe_db.py` 和 `test_review42_sql_server.py` 里各一条 PRAGMA 的用例。这也说明三道闸之间有重叠,但不是完全重叠,每一道都有只有它管得住的东西。

</details>

4. 练习 4 里为什么「令牌对了」之后 `UPDATE` 仍然被拒?它们分别由谁负责?

<details><summary>答案</summary>

令牌属于认证:证明「你是谁」,由 HTTP 中间件检查。`UPDATE` 属于授权:「你能做什么」,由 sqlglot 第一道闸和只读连接负责。这个 server 的所有调用方权限一样,所以 SQL 不会因为令牌不同而不同;如果要区分「看板只能读、客服机器人能提退款」,就得像 Day 290 练习 1 那样给不同的令牌配不同的权限。

</details>

5. 面试题:你负责一个「自然语言查数据库」的内部 Agent,准备把「执行 SQL」这一环暴露成 MCP server 给公司里好几个 Agent 共用。你会怎么设计,怎么保证上线以后某天有人改了代码,安全防护没有悄悄松掉?

<details><summary>答案</summary>

设计:只暴露一个只读工具,参数用 schema 限长度;执行层(解析检查、只读连接或只读账号、授权或最小权限、超时、行数上限)和协议包装层分开,各自测试;库说明书做成 resource,提问模板做成 prompt;错误统一变成 `ToolError`,把原因交给模型,意外异常不泄漏内部细节;HTTP 上线必须加鉴权,不同调用方用不同令牌对应不同权限,并记审计日志。防回退:把每一道闸各自能拦的攻击写成测试用例(DELETE、分号注入、PRAGMA、ATTACH、超时),每次改动 CI 都跑;定期做突变实验,故意拿掉一道闸,确认至少有一条测试会红;新增能力(新表、新方言)时先补用例再改代码;再把冒烟检查加进部署流水线,确认从外面拉起来能连、写操作被拒。

</details>

## 明天预告

Day 294 · 问数 Agent(三):问数循环和 10 道题评测。今天的 server 只是个能安全执行 SQL 的出口。明天把说明书、`safe_db` 和模型接成完整的循环:模型写 SQL,被拒绝或报错就带着原因重写,结果出来再自检一次,最后用人话回答。然后建一份 10 道题的评测集,用「执行准确率」打分,看第一版为什么不是 10/10,以及评测器自己出错时该怎么发现。
