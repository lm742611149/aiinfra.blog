---
title: 'Day 287 · 写 MCP server(七):用内存客户端写测试'
description: 'Inspector 从外面测,每条检查都要重启一次 server。今天把 server 对象直接交给 Client,两者在同一个进程里说 MCP,不起子进程、不开端口;再用 pytest、anyio 插件和临时库 fixture,把 CloudLedger server 该有的表现写成 13 条测试,不到一秒跑完,改坏一个列名就能抓出来。'
pubDate: 2026-10-22
regime: none
tags: ['mcp', 'mcp-server', 'pytest', 'cloudledger', 'agent-zero']
series: 'agent-zero'
day: 287
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 286](/blog/agent-zero/day-286-week41-review/) 复习了第 41 周:从 `cloudledger/seed.py` 造数据,到 `cloudledger/server.py` 里的四个工具、一个 resource、一个 prompt,再到用 Inspector 调试。复习日的小项目用 Inspector CLI 写了九条检查的验收脚本,[Day 285](/blog/agent-zero/day-285-mcp-inspector/) 的 `part05/smoke_cloudledger.sh` 是七条。

这两个脚本都是「从外面」测:每一条检查都要拉起一个新的 server 子进程,七条跑了 17 秒,而且只能看退出码,Day 286 的练习 4 已经撞上了它分不清两种失败原因。今天换一种测法:不起进程,把 server 对象直接交给客户端,用 pytest 断言具体的字段和文字。

## 今天要解决的问题

学完今天,你要能做到:

1. 说清楚「内存连接」和 stdio 连接差在哪里,并用一个小脚本量出两者的耗时差。
2. 用 `@pytest.mark.anyio` 写异步测试,在测试里用 `Client(server对象)` 调工具、读 resource、取 prompt。
3. 用 `tmp_path` 加 `monkeypatch` 写一个 fixture,让每个测试拿到一份新造的业务库,测试之间互不影响。
4. 把 CloudLedger server 的表现写成 `tests/test_cloudledger_server.py`,13 条全过;故意改坏 server 时,能从 pytest 的输出里找到真正的报错。

预计用时 2.5 小时。今天不调模型,花费 ¥0。

前置:[Day 67](/blog/agent-zero/day-067-async-2/)(`async def` 和 `await`)、[Day 71](/blog/agent-zero/day-071-pytest-1/) 到 [Day 74](/blog/agent-zero/day-074-pytest-4/)(pytest、`tests/` 目录和 `pythonpath`、fixture 与 `yield`、`tmp_path`、`conftest.py`、`parametrize`、`monkeypatch.setattr`)、[Day 280](/blog/agent-zero/day-280-mcp-seed/)(`cloudledger/seed.py`)、[Day 282](/blog/agent-zero/day-282-mcp-errors/)(`ToolError`)、[Day 284](/blog/agent-zero/day-284-mcp-resource-prompt/)(完整的 `cloudledger/server.py`)。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

今天所有命令都在 `agent-zero-lab/` 根目录下跑(我的是 `/Users/你/agent-zero-lab`)。先确认依赖和配置都在:

```bash
cd /Users/你/agent-zero-lab
uv add "mcp[cli]==2.3.0"
uv add --dev pytest
cat pyproject.toml
```

`pyproject.toml` 里要有 Day 72 写的这一段,没有就补上:

```toml
[tool.pytest]
pythonpath = ["."]
testpaths = ["tests"]
```

`pythonpath = ["."]` 让测试文件能 `from cloudledger import server`,和 Day 72 修 `ModuleNotFoundError` 是同一个道理。我这里 pytest 是 9.1.1,mcp 是 2.3.0(2026 年 10 月查 PyPI,mcp 2.3.0 是 10 月 2 日发的最新版)。

## 两种连法:子进程和同一个进程

先回忆 [Day 276](/blog/agent-zero/day-276-mcp-transports/) 的 stdio:host 用一条命令把 server 当子进程拉起来,两边通过子进程的标准输入和标准输出一行一行地传 JSON。Inspector、Claude Code 都是这么连的。好处是真实,坏处是慢:每次都要启动一个新的 Python 进程、import 一遍 mcp 和 pydantic,我这台 2019 年的 Intel Mac 上光这一步就要几秒。

MCP Python SDK 的 `Client` 还认另一种参数:直接传 server 对象,也就是 `server.py` 里那个 `mcp = MCPServer("cloudledger", ...)`。这时它不起子进程,而是在同一个 Python 进程里建两条「内存管道」,一头接客户端,一头接 server。消息照样是 JSON-RPC,照样走一遍参数校验和错误处理,只是不经过操作系统的进程和管道。

拿前端打个比方:stdio 像是真开一个浏览器去访问你的接口,内存连接像是在 vitest 里直接调用你的请求处理函数,但调用时传进去的仍是一个完整的 `Request` 对象,中间件一个不少。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="上半部分:测试进程通过 stdin 和 stdout 两条管道连接另一个 server 子进程;下半部分:测试和 server 在同一个进程里,通过两条内存管道连接">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12" fill="var(--ink)">
    <text x="20" y="28">stdio:两个进程</text>
    <rect x="40" y="42" width="200" height="70" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="140" y="72" text-anchor="middle">测试进程</text>
    <text x="140" y="92" text-anchor="middle" font-size="11" fill="var(--ink-soft)">Client(StdioServerParameters)</text>
    <rect x="400" y="42" width="200" height="70" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="500" y="72" text-anchor="middle">server 子进程</text>
    <text x="500" y="92" text-anchor="middle" font-size="11" fill="var(--ink-soft)">python cloudledger/server.py</text>
    <line x1="240" y1="62" x2="400" y2="62" stroke="var(--rule)" stroke-width="1.5"/>
    <text x="320" y="56" text-anchor="middle" font-size="11" fill="var(--ink-soft)">stdin(请求)</text>
    <line x1="400" y1="94" x2="240" y2="94" stroke="var(--rule)" stroke-width="1.5" stroke-dasharray="4 3"/>
    <text x="320" y="110" text-anchor="middle" font-size="11" fill="var(--ink-soft)">stdout(响应)</text>
    <text x="20" y="150">内存:一个进程</text>
    <rect x="40" y="162" width="560" height="80" fill="none" stroke="var(--rule)"/>
    <rect x="60" y="176" width="180" height="52" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="150" y="207" text-anchor="middle">Client(mcp)</text>
    <rect x="400" y="176" width="180" height="52" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="490" y="207" text-anchor="middle">mcp = MCPServer(...)</text>
    <line x1="240" y1="192" x2="400" y2="192" stroke="var(--rule)" stroke-width="1.5"/>
    <line x1="400" y1="214" x2="240" y2="214" stroke="var(--rule)" stroke-width="1.5" stroke-dasharray="4 3"/>
    <text x="320" y="186" text-anchor="middle" font-size="11" fill="var(--ink-soft)">内存管道</text>
    <text x="320" y="236" text-anchor="middle" font-size="11" fill="var(--ink-faint)">同样的 JSON-RPC,不启动进程</text>
  </g>
</svg>
<figcaption>上面是 Inspector 和 Claude Code 的连法,下面是今天测试用的连法。两种连法里,server 收到的请求、做的校验、返回的结果完全一样。</figcaption>
</figure>

光说不算,量一下。下面这个脚本把同一次 `find_customer` 调用两种连法各跑一遍,打印耗时和结果。

```python
# agent-zero-lab/part05/inmem_vs_stdio.py
"""同一次 find_customer 调用,分别走 stdio(起子进程)和内存(同一个进程)各跑一遍,比耗时和结果。"""
import sys
import time

import anyio
from mcp import Client, StdioServerParameters
from mcp.server import MCPServer

from cloudledger.server import mcp

STDIO = StdioServerParameters(command=sys.executable, args=["cloudledger/server.py"])


async def one_call(target: StdioServerParameters | MCPServer, label: str) -> None:
    start = time.perf_counter()
    async with Client(target) as client:
        version = client.protocol_version
        r = await client.call_tool("find_customer", {"query": "user007@example.com"})
    ms = (time.perf_counter() - start) * 1000
    print(f"{label} | {ms:7.1f} ms | 协议 {version} | {r.structured_content}")


async def main() -> None:
    await one_call(STDIO, "stdio")
    await one_call(mcp, "内存 ")


if __name__ == "__main__":
    anyio.run(main)
```

<div class="line-notes">

- `import time` 用它的 `perf_counter()` 计时,相当于浏览器里的 `performance.now()`,不过单位是秒。
- `import anyio` 跑异步函数用的库,[Day 284](/blog/agent-zero/day-284-mcp-resource-prompt/) 的 peek 脚本里用过。MCP SDK 内部就建在它上面。
- `from mcp.server import MCPServer` 只为了下面的类型标注,告诉编辑器 `target` 可能是一个 server 对象。
- `from cloudledger.server import mcp` 今天的关键:把 Day 284 写的 server **对象**导进来。`server.py` 末尾的 `mcp.run()` 在 `if __name__ == "__main__":` 里面,被 import 时不会执行,所以这一行只是拿到对象,不会启动 server。
- `STDIO = StdioServerParameters(command=sys.executable, args=["cloudledger/server.py"])` 和 Day 284 的 `peek_server.py` 一样:用当前虚拟环境的 Python 去跑 `server.py`。路径是相对的,所以要在 `agent-zero-lab/` 根目录跑。
- `async def one_call(target: StdioServerParameters | MCPServer, label: str) -> None:` `target` 两种都收。`A | B` 是「A 或 B」的类型写法,和 TS 一样。
- `start = time.perf_counter()` 计时从「准备连接」之前开始,所以 stdio 那一行会把启动子进程的时间算进去。
- `async with Client(target) as client:` 同一个 `Client` 类,传参数对象就起子进程,传 server 对象就走内存。进入 `with` 时两边谈好协议,离开时断开(stdio 那边还会把子进程关掉)。
- `version = client.protocol_version` 记下谈出来的协议版本,两种连法实测都是 `2026-07-28`。
- `r = await client.call_tool("find_customer", {"query": "user007@example.com"})` 调一次工具,参数和 Day 281 一样。
- `ms = (time.perf_counter() - start) * 1000` 秒换成毫秒。
- `print(f"{label} | {ms:7.1f} ms` `:7.1f` 表示占 7 个字符宽、保留 1 位小数,两行对齐好比较。
- `await one_call(STDIO, "stdio")` 先 stdio。
- `await one_call(mcp, "内存 ")` 再内存。`"内存 "` 后面多一个空格只是为了和 `stdio` 对齐。

</div>

这个脚本 import 了 `cloudledger` 包,要用 `-m` 的方式跑(Day 33 讲过,`-m` 会把当前目录放进 import 路径):

```bash
uv run python cloudledger/seed.py
uv run python -m part05.inmem_vs_stdio
```

我连跑了三次,输出(2026-10-22 实跑,第一行是 seed 的):

```text
已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}
stdio |  2671.9 ms | 协议 2026-07-28 | {'result': [{'id': 'C007', 'name': '刘静', 'email': 'user007@example.com', 'company': '半岛咖啡'}]}
内存  |    15.1 ms | 协议 2026-07-28 | {'result': [{'id': 'C007', 'name': '刘静', 'email': 'user007@example.com', 'company': '半岛咖啡'}]}
stdio |  4524.2 ms | 协议 2026-07-28 | {'result': [{'id': 'C007', 'name': '刘静', 'email': 'user007@example.com', 'company': '半岛咖啡'}]}
内存  |    12.2 ms | 协议 2026-07-28 | {'result': [{'id': 'C007', 'name': '刘静', 'email': 'user007@example.com', 'company': '半岛咖啡'}]}
stdio |  4847.8 ms | 协议 2026-07-28 | {'result': [{'id': 'C007', 'name': '刘静', 'email': 'user007@example.com', 'company': '半岛咖啡'}]}
内存  |    14.2 ms | 协议 2026-07-28 | {'result': [{'id': 'C007', 'name': '刘静', 'email': 'user007@example.com', 'company': '半岛咖啡'}]}
```

结果一字不差,耗时差了两三百倍。stdio 那几秒几乎全花在启动子进程上(我跑的时候机器上还开着别的东西,所以三次波动挺大),内存连接十几毫秒,大头是 SQLite 查询本身。一个测试文件十几条用例,每条都起一次子进程就是一分钟;走内存,一秒以内。

这里先说清楚内存连接**测不到**什么:server 启动命令写错、子进程找不到依赖、往 stdout 打了不该打的东西,这些只有真起一个子进程才会暴露。所以 Day 285 的冒烟脚本不用扔,它和今天的测试是两层:内存测试管「server 的逻辑对不对」,冒烟脚本管「server 能不能被别人拉起来」。明天的最小 client 会专门演示一个内存测试测不出来、stdio 一连就露馅的例子。

## 第一步:第一个异步测试

`Client` 的方法都是 `async` 的,所以测试函数也得是 `async def`。[Day 74](/blog/agent-zero/day-074-pytest-4/) 演示过,pytest 本身不会跑协程,直接写 `async def test_...` 会失败。当时我们绕开了,用 `asyncio.run(...)` 包一层。今天正式解决它。

好消息是不用装新东西。`anyio` 这个库自带一个 pytest 插件,装 mcp 时 anyio 已经作为依赖装上了。在测试上贴一个 `@pytest.mark.anyio`,插件就会负责启动事件循环、把协程跑完。相当于 Jest 里你直接写 `test("...", async () => {...})` 就行,只不过 Python 这边要多贴一个标记,告诉 pytest「这个交给 anyio」。

先写最小的一条:内存里连上 server,断言工具列表。

```python
# agent-zero-lab/tests/test_mcp_first.py
"""第一个 MCP 测试:内存里连上 server,断言工具列表。"""
import pytest
from mcp import Client

from cloudledger.server import mcp


@pytest.mark.anyio
async def test_lists_four_tools() -> None:
    async with Client(mcp) as client:
        result = await client.list_tools()
    names = {t.name for t in result.tools}
    assert names == {"find_customer", "get_subscription", "list_invoices", "create_refund_request"}
```

<div class="line-notes">

- `import pytest` 要用它的 `mark`。
- `from mcp import Client` 和 Day 284 `peek_server.py` 里是同一个类。
- `from cloudledger.server import mcp` 拿到 server 对象。能这样 import,靠的是 `pyproject.toml` 里的 `pythonpath = ["."]`。
- `@pytest.mark.anyio` 今天的新东西之一。贴上这个标记,anyio 插件接管这个测试:建一个事件循环,把下面的协程跑完。不贴就是 Day 74 那个报错,下面马上再演示一次。
- `async def test_lists_four_tools() -> None:` 名字照样以 `test_` 开头,pytest 才会收集它。
- `async with Client(mcp) as client:` 传的是 server 对象,所以走内存。离开 `with` 时连接关掉,不留后台任务。
- `result = await client.list_tools()` 发 `tools/list`,返回的对象上 `.tools` 是 Tool 列表。
- `names = {t.name for t in result.tools}` 集合推导式:[Day 23](/blog/agent-zero/day-023-comprehensions/) 的列表推导式把方括号换成花括号,得到的是 [Day 25](/blog/agent-zero/day-025-sets/) 的 set,实测是四个名字。
- `assert names == {` 用集合比较,不管顺序。工具的返回顺序是注册顺序,但测试不该依赖这种细节。

</div>

```bash
uv run pytest -v tests/test_mcp_first.py
```

输出:

```text
collected 1 item

tests/test_mcp_first.py::test_lists_four_tools[asyncio] PASSED           [100%]

============================== 1 passed in 0.04s ==============================
```

注意测试名后面多了一个 `[asyncio]`。anyio 能在两种事件循环上跑测试(Python 自带的 asyncio,和另一个叫 trio 的库),默认只用 asyncio,所以每条异步测试都会带上这个后缀。看到它说明插件真的接管了。

现在把 `@pytest.mark.anyio` 那一行删掉再跑一次,报错原文:

```text
F                                                                        [100%]
=================================== FAILURES ===================================
____________________________ test_lists_four_tools _____________________________
async def functions are not natively supported.
You need to install a suitable plugin for your async framework, for example:
  - anyio
  - pytest-asyncio
  - pytest-tornasync
  - pytest-trio
  - pytest-twisted
=========================== short test summary info ============================
FAILED tests/test_mcp_first.py::test_lists_four_tools - Failed: async def fu...
1 failed in 0.03s
```

和 Day 74 一模一样。列表第一个就是 anyio:插件明明装着,只是你没告诉 pytest 这条测试归它管。加回标记就好。

一个文件里测试多了,每条都贴标记很烦。可以在文件顶部写一行 `pytestmark = pytest.mark.anyio`,整个文件的测试都生效,下面的正式测试文件就这么写。

## 第二步:每个测试一份新库

工具列表这种「只读、不碰数据」的测试怎么写都行。可 CloudLedger 有一个写工具 `create_refund_request`,它会往 `refund_requests` 表里插一行。测试直接用真实的 `cloudledger/cloudledger.db` 会怎样?写一个反面教材试试:

```python
# agent-zero-lab/tests/test_naive_refund.py  (反面教材:直接用真实的 cloudledger.db)
import pytest
from mcp import Client

from cloudledger.server import mcp


@pytest.mark.anyio
async def test_refund_request_is_pending() -> None:
    async with Client(mcp) as client:
        r = await client.call_tool(
            "create_refund_request",
            {"invoice_id": "INV-2026-0123", "amount_yuan": 2392, "reason": "10 月 8 日重复扣款"},
        )
    assert not r.is_error, r.content
    assert r.structured_content == {"refund_request_id": 1, "status": "pending_approval", "amount_yuan": "2392.00"}
```

<div class="line-notes">

- `async with Client(mcp) as client:` 没有任何准备工作,server 用的是默认库 `cloudledger/cloudledger.db`。
- `"create_refund_request",` 对 C007 那张重复的发票申请全额退款,Day 283 的例子。
- `assert not r.is_error, r.content` `assert 条件, 说明` 的第二部分是失败时打印的内容。这里让它失败时把 server 返回的文字打出来,不然只能看到 `assert not True`。
- `assert r.structured_content == {"refund_request_id": 1,` 申请编号应该是 1,因为 seed 刚造的库里还没有任何退款申请。

</div>

先 seed,再连跑两次:

```bash
uv run python cloudledger/seed.py
uv run pytest -q tests/test_naive_refund.py
uv run pytest -q tests/test_naive_refund.py
```

第一次 `1 passed`。第二次:

```text
E       AssertionError: [TextContent(type='text', text='Error executing tool create_refund_request: 最多还能申请 0.00 元(发票 2392.00 元,已申请 2392.00 元)。', annotations=None, meta=None)]
E       assert not True
1 failed in 0.26s
```

server 没坏,是第一次运行留下的那条申请还在库里,第二次再申请就超额了。这就是测试之间「互相污染」:同一份测试,跑一遍过、跑两遍挂,顺序一换结果也可能变。前端写过依赖 `localStorage` 的测试应该见过同样的事,上一条测试写进去的东西,下一条读到了。

修法是 Day 73 和 Day 74 的两件老工具拼起来:`tmp_path` 给每个测试一个新的临时目录;`monkeypatch.setattr` 把 `seed` 和 `server` 模块里的 `DB_PATH` 临时指到这个目录,再调一次 `seed.main()` 在那里造一份新库。测试结束,monkeypatch 把 `DB_PATH` 还原,临时目录 pytest 自己会清理。真实的 `cloudledger.db` 一个字节都不碰。

演示完先把反面教材删掉:`rm tests/test_naive_refund.py`,再 `uv run python cloudledger/seed.py` 把真实库恢复干净。

两个 fixture 放进 `tests/conftest.py`,所有测试文件都能用(Day 73 讲过 conftest 的作用)。

```python
# agent-zero-lab/tests/conftest.py
"""MCP 测试共用的 fixture:每个测试一份新造的临时业务库,再给一个内存里连好的 client。"""
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from mcp import Client

from cloudledger import seed, server


@pytest.fixture
def db_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "cloudledger.db"
    monkeypatch.setattr(seed, "DB_PATH", path)
    monkeypatch.setattr(server, "DB_PATH", path)
    seed.main()
    return path


@pytest.fixture
async def client(db_path: Path) -> AsyncIterator[Client]:
    async with Client(server.mcp, raise_exceptions=True) as c:
        yield c
```

<div class="line-notes">

- `from collections.abc import AsyncIterator` 下面 `client` fixture 的返回类型。普通 fixture 用 `yield` 时标 `Iterator`,异步的就标 `AsyncIterator`,相当于 TS 里的 `AsyncGenerator<Client>`。
- `from cloudledger import seed, server` 导入的是两个**模块**,不是模块里的东西。下面要改模块上的 `DB_PATH` 属性,必须拿着模块本身。
- `def db_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:` 参数名写 `tmp_path` 和 `monkeypatch`,pytest 按名字把这两个内置 fixture 注入进来,Day 73、Day 74 的老朋友。
- `path = tmp_path / "cloudledger.db"` 每个测试的 `tmp_path` 都不一样,形如 `/private/var/folders/.../pytest-12/test_find_customer_by_email_asy0/cloudledger.db`。
- `monkeypatch.setattr(seed, "DB_PATH", path)` 让 seed 往临时目录里造库。seed.py 第 10 行是 `DB_PATH = Path(os.environ.get("CLOUDLEDGER_DB", ...))`,`main()` 里用的就是这个模块级变量。
- `monkeypatch.setattr(server, "DB_PATH", path)` 让 server 从同一个地方读。server 里的 `db()` 每次调用时才去读 `DB_PATH`,所以改了立刻生效。如果 server 在 import 时就把连接建好了,这招就不灵,这也是 Day 281 让每个工具自己 `with db()` 的好处之一。
- `seed.main()` 实测打印 `已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}`,pytest 默认把它收起来,测试失败时才在「Captured stdout setup」里显示。
- `return path` 把路径交出去,测试想直接查库验证写操作时会用到。
- `async def client(db_path: Path) -> AsyncIterator[Client]:` 异步 fixture。它依赖 `db_path`,所以每次先造库再连接。anyio 插件也负责跑异步 fixture,只要用它的测试贴了 anyio 标记。
- `async with Client(server.mcp, raise_exceptions=True) as c:` 官方测试文档推荐测试里打开 `raise_exceptions=True`。它管的是**工具函数体之外**的失败,比如 prompt 渲染时崩了:不开时客户端只看到 `Internal server error`,开了能看到 `Error rendering prompt reply_ticket` 这种带名字的信息(练习 2 会亲眼看到)。工具里抛的异常不受它影响,不管开不开,都是 `is_error=True` 的正常结果。
- `yield c` `yield` 之前是准备,之后是清理(Day 73)。这里的清理就是离开 `async with`,断开连接。

</div>

## 第三步:把 server 的合同写成测试

有了 `client` fixture,测试本身就短了。每条测试只做一件事:调一个东西,断言它的表现。我把这个文件叫「合同」,因为它写下的是 server 对外承诺的行为:模型会依赖的字段名、错误文字里给模型的下一步提示、写操作的状态。以后谁改 server,只要合同还过,用它的 Agent 就不会被悄悄改坏。

```python
# agent-zero-lab/tests/test_cloudledger_server.py
"""CloudLedger MCP server 的合同:四个工具、一个 resource、一个 prompt 各自该怎么表现。"""
import sqlite3
from pathlib import Path

import pytest
from mcp import Client, MCPError
from mcp.types import INVALID_PARAMS, TextContent, TextResourceContents

pytestmark = pytest.mark.anyio


def text_of(result) -> str:
    block = result.content[0]
    assert isinstance(block, TextContent)
    return block.text


async def test_lists_everything(client: Client) -> None:
    tools = {t.name for t in (await client.list_tools()).tools}
    resources = [str(r.uri) for r in (await client.list_resources()).resources]
    prompts = [p.name for p in (await client.list_prompts()).prompts]
    assert tools == {"find_customer", "get_subscription", "list_invoices", "create_refund_request"}
    assert resources == ["cloudledger://policy/refund"]
    assert prompts == ["reply_ticket"]


async def test_find_customer_by_email(client: Client) -> None:
    r = await client.call_tool("find_customer", {"query": "user007@example.com"})
    assert not r.is_error
    assert r.structured_content == {
        "result": [{"id": "C007", "name": "刘静", "email": "user007@example.com", "company": "半岛咖啡"}]
    }


async def test_unknown_customer_tells_model_what_to_do(client: Client) -> None:
    r = await client.call_tool("find_customer", {"query": "nobody@nowhere"})
    assert r.is_error
    assert "换成邮箱或客户编号" in text_of(r)


@pytest.mark.parametrize("bad_id", ["7", "c007", "C07", "C0007"])
async def test_bad_customer_id_rejected_by_schema(client: Client, bad_id: str) -> None:
    r = await client.call_tool("get_subscription", {"customer_id": bad_id})
    assert r.is_error
    assert "should match pattern" in text_of(r)


async def test_duplicate_invoices_visible(client: Client) -> None:
    r = await client.call_tool("list_invoices", {"customer_id": "C007", "limit": 2})
    assert r.structured_content is not None
    rows = r.structured_content["result"]
    assert [x["id"] for x in rows] == ["INV-2026-0123", "INV-2026-0026"]
    assert rows[0]["amount_yuan"] == rows[1]["amount_yuan"] == "2392.00"


async def test_refund_request_is_pending_and_written(client: Client, db_path: Path) -> None:
    r = await client.call_tool(
        "create_refund_request",
        {"invoice_id": "INV-2026-0123", "amount_yuan": 2392, "reason": "10 月 8 日重复扣款"},
    )
    assert not r.is_error
    assert r.structured_content == {"refund_request_id": 1, "status": "pending_approval", "amount_yuan": "2392.00"}
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute("SELECT invoice_id, amount_cents, status FROM refund_requests").fetchall()
    assert rows == [("INV-2026-0123", 239200, "pending_approval")]


async def test_second_refund_is_blocked(client: Client) -> None:
    args = {"invoice_id": "INV-2026-0123", "amount_yuan": 2392, "reason": "10 月 8 日重复扣款"}
    first = await client.call_tool("create_refund_request", args)
    second = await client.call_tool("create_refund_request", args)
    assert not first.is_error
    assert second.is_error
    assert "最多还能申请 0.00 元" in text_of(second)


async def test_refund_policy_resource(client: Client) -> None:
    got = await client.read_resource("cloudledger://policy/refund")
    block = got.contents[0]
    assert isinstance(block, TextResourceContents)
    assert block.text.startswith("1. 重复扣款")
    assert "客服主管审批" in block.text


async def test_reply_ticket_prompt(client: Client) -> None:
    got = await client.get_prompt("reply_ticket", {"ticket_id": "t1041"})
    msg = got.messages[0]
    assert msg.role == "user"
    assert isinstance(msg.content, TextContent)
    assert "工单 T1041(客户 C007)" in msg.content.text


async def test_unknown_ticket_is_invalid_params(client: Client) -> None:
    with pytest.raises(MCPError) as exc:
        await client.get_prompt("reply_ticket", {"ticket_id": "T9999"})
    assert exc.value.error.code == INVALID_PARAMS
    assert "T9999 不存在" in exc.value.error.message
```

<div class="line-notes">

- `import sqlite3` 有一条测试要绕过 server,直接查库,确认写操作真的落了盘。
- `from mcp import Client, MCPError` `MCPError` 用来接 prompt 抛出的 JSON-RPC 错误,Day 284 讲过。
- `from mcp.types import INVALID_PARAMS, TextContent, TextResourceContents` `INVALID_PARAMS` 就是 -32602;后两个是返回内容块的类型,下面用 `isinstance` 判断。
- `pytestmark = pytest.mark.anyio` 模块级变量,名字必须一字不差是 `pytestmark`。整个文件的测试都贴上 anyio 标记,不用每条写一遍。
- `def text_of(result) -> str:` 小工具函数:取结果里第一个内容块的文字。好几条测试都要用。
- `assert isinstance(block, TextContent)` `content` 里的块可能是文字、图片或别的类型,先断言是文字,类型检查器也就知道下一行 `.text` 存在,Zed 里不会画红线。
- `async def test_lists_everything(client: Client) -> None:` 参数写 `client`,pytest 去 conftest 里找到同名 fixture,先造库再连接,把连好的 `Client` 交进来。和 Day 73 的 fixture 注入一样,只是这个 fixture 是异步的。
- `resources = [str(r.uri) for r in` `uri` 字段是一个 URL 类型对象,转成字符串才好和列表比较。
- `assert resources == ["cloudledger://policy/refund"]` 实测就这一条。
- `r = await client.call_tool("find_customer", {"query": "user007@example.com"})` 和 `inmem_vs_stdio.py` 里同一个调用。
- `assert r.structured_content == {` 整个结构一起比。实测 `{'result': [{'id': 'C007', 'name': '刘静', 'email': 'user007@example.com', 'company': '半岛咖啡'}]}`。工具返回 `list`,SDK 会包一层 `{"result": ...}`(Day 281 讲过)。断言写死整个结构,是因为这正是模型读到的东西,少一个字段、改一个键名,用它的 Agent 都可能出错。
- `r = await client.call_tool("find_customer", {"query": "nobody@nowhere"})` 查一个不存在的客户。
- `assert r.is_error` Day 282 的 `ToolError` 到了客户端是 `is_error=True` 的正常结果,不是异常,所以用 `assert` 而不是 `pytest.raises`。
- `assert "换成邮箱或客户编号" in text_of(r)` 实测全文是 `Error executing tool find_customer: 没有找到匹配「nobody@nowhere」的客户。可以换成邮箱或客户编号再试。`。前面那串英文是 SDK 加的前缀,我们只断言自己写的那半句。为什么要测这么细?因为这半句是写给模型的「下一步怎么办」,Day 282 专门花了一天打磨它,有人把它改成「出错了」,测试应该红。
- `@pytest.mark.parametrize("bad_id", ["7", "c007", "C07", "C0007"])` Day 73 的参数化,一个函数展开成 4 条用例。四个值分别是:没有 C、小写 c、位数少、位数多。
- `async def test_bad_customer_id_rejected_by_schema(client: Client, bad_id: str) -> None:` 参数化和 fixture 可以一起用,pytest 分别注入。
- `assert "should match pattern" in text_of(r)` 代入 `"7"`,实测全文是 `Error executing tool get_subscription: 1 validation error for get_subscriptionArguments` 加换行 `customer_id` 加 `String should match pattern '^C\d{3}$' [type=string_pattern_mismatch, input_value='7', input_type=str]`。这是 pydantic 在函数执行前拦下的(Day 281 的 `pattern`),证明格式不对的编号根本到不了 SQL。
- `r = await client.call_tool("list_invoices", {"customer_id": "C007", "limit": 2})` 只要最近两张。
- `assert r.structured_content is not None` 先排除 None,下一行取 `["result"]` 才安全,类型检查器也满意。
- `assert [x["id"] for x in rows] == ["INV-2026-0123", "INV-2026-0026"]` 两张都是 10 月 8 日开的,按 `issued_at DESC, id DESC` 排,0123 在前。这条同时锁住了「排序稳定」这个细节:Day 284 那句 `ORDER BY` 里的 `id DESC` 要是被删了,两张同日发票的顺序就不保证了。
- `assert rows[0]["amount_yuan"] == rows[1]["amount_yuan"] == "2392.00"` Python 的连等比较,相当于 `a == b and b == c`。金额是字符串 `"2392.00"`,Day 281 的 `yuan()` 转的。
- `async def test_refund_request_is_pending_and_written(client: Client, db_path: Path) -> None:` 同时要 `client` 和 `db_path`。两个 fixture 都依赖同一个测试的 `tmp_path`,pytest 保证它们拿到的是同一个目录,所以这里的 `db_path` 正是 server 正在用的那份库。
- `assert r.structured_content == {"refund_request_id": 1,` 每个测试都是新库,编号总是 1。这就是第二步那个反面教材跑两遍会挂、这里跑多少遍都过的原因。
- `with sqlite3.connect(db_path) as conn:` 不经过 server,直接打开临时库看。工具说「提交成功」不等于真写进去了,这一步是验证副作用。
- `assert rows == [("INV-2026-0123", 239200, "pending_approval")]` 库里存的是分,239200 分就是 2392.00 元;状态是 Day 283 写死在 SQL 里的 `pending_approval`。
- `args = {"invoice_id": "INV-2026-0123"` 同一组参数提交两次,模拟模型重复调用。
- `assert "最多还能申请 0.00 元" in text_of(second)` 第二次被 Day 283 的超额检查拦下,实测文字 `最多还能申请 0.00 元(发票 2392.00 元,已申请 2392.00 元)。`,和第二步反面教材第二次运行看到的是同一句。
- `got = await client.read_resource("cloudledger://policy/refund")` 读 Day 284 的 resource。
- `assert block.text.startswith("1. 重复扣款")` 政策第一条的开头。
- `got = await client.get_prompt("reply_ticket", {"ticket_id": "t1041"})` 故意传小写,锁住 Day 284 里那个 `.upper()`。
- `assert "工单 T1041(客户 C007)" in msg.content.text` 模板填好后的第一行是 `你是云簿的客服。请处理工单 T1041(客户 C007):`。
- `with pytest.raises(MCPError) as exc:` prompt 出错是 JSON-RPC 错误,客户端会抛异常,所以这里用 `pytest.raises`,和上面工具出错的写法正好相反。`pytest.raises` 相当于 Jest 的 `await expect(promise).rejects.toThrow()`。
- `assert exc.value.error.code == INVALID_PARAMS` `exc.value` 是抓到的异常对象,`.error` 里有错误码和文字。实测码是 -32602。
- `assert "T9999 不存在" in exc.value.error.message` 实测全文 `工单 T9999 不存在,工单号形如 T1041。`。

</div>

跑一下,加 `-v` 看每一条:

```bash
uv run pytest -v tests/test_cloudledger_server.py
```

输出(2026-10-22 实跑):

```text
plugins: anyio-4.15.1
collecting ... collected 13 items

tests/test_cloudledger_server.py::test_lists_everything[asyncio] PASSED  [  7%]
tests/test_cloudledger_server.py::test_find_customer_by_email[asyncio] PASSED [ 15%]
tests/test_cloudledger_server.py::test_unknown_customer_tells_model_what_to_do[asyncio] PASSED [ 23%]
tests/test_cloudledger_server.py::test_bad_customer_id_rejected_by_schema[asyncio-7] PASSED [ 30%]
tests/test_cloudledger_server.py::test_bad_customer_id_rejected_by_schema[asyncio-c007] PASSED [ 38%]
tests/test_cloudledger_server.py::test_bad_customer_id_rejected_by_schema[asyncio-C07] PASSED [ 46%]
tests/test_cloudledger_server.py::test_bad_customer_id_rejected_by_schema[asyncio-C0007] PASSED [ 53%]
tests/test_cloudledger_server.py::test_duplicate_invoices_visible[asyncio] PASSED [ 61%]
tests/test_cloudledger_server.py::test_refund_request_is_pending_and_written[asyncio] PASSED [ 69%]
tests/test_cloudledger_server.py::test_second_refund_is_blocked[asyncio] PASSED [ 76%]
tests/test_cloudledger_server.py::test_refund_policy_resource[asyncio] PASSED [ 84%]
tests/test_cloudledger_server.py::test_reply_ticket_prompt[asyncio] PASSED [ 92%]
tests/test_cloudledger_server.py::test_unknown_ticket_is_invalid_params[asyncio] PASSED [100%]

============================== 13 passed in 0.44s ==============================
```

`plugins: anyio-4.15.1` 那一行说明插件是跟着 anyio 来的。13 条,0.44 秒,每条都造了一份新库。对比 Day 285 的冒烟脚本七条 17 秒,而且这里每条都能告诉你具体哪个字段不对。参数化那条展开成了 4 条,方括号里是 `asyncio-7` 这样「事件循环加参数值」的组合。

再做一次类型检查,保证 Zed 里没有红线:

```bash
uv run basedpyright tests
```

最后一行是 `0 errors, 0 warnings, 0 notes`。

## 测试真的能抓住 bug 吗

测试全绿不说明什么,得看它在 server 坏掉时会不会红。我在 `list_invoices` 里制造一个最常见的手误:把排序列 `issued_at` 打成 `issue_at`。

```python
    sql += " ORDER BY issue_at DESC, id DESC LIMIT ?"
```

<div class="line-notes">

- `sql += " ORDER BY issue_at DESC` 少了一个 `d`。Python 不会报任何错,这只是一个字符串,要等 SQLite 真执行时才发现没有这一列。

</div>

再跑测试:

```bash
uv run pytest -q tests/test_cloudledger_server.py
```

输出(删掉了中间一大段 SDK 内部的调用栈):

```text
.......F.....                                                            [100%]
=================================== FAILURES ===================================
___________________ test_duplicate_invoices_visible[asyncio] ___________________

    async def test_duplicate_invoices_visible(client: Client) -> None:
        r = await client.call_tool("list_invoices", {"customer_id": "C007", "limit": 2})
>       assert r.structured_content is not None
E       AssertionError: assert None is not None
E        +  where None = CallToolResult(meta={'io.modelcontextprotocol/serverInfo': {'name': 'cloudledger', 'version': ''}}, content=[TextConte...ing tool list_invoices', annotations=None, meta=None)], structured_content=None, is_error=True, result_type='complete').structured_content

tests/test_cloudledger_server.py:51: AssertionError
---------------------------- Captured stdout setup -----------------------------
已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}
------------------------------ Captured log call -------------------------------
ERROR    mcp.server.mcpserver.server:server.py:455 Tool 'list_invoices' raised an unexpected exception
Traceback (most recent call last):
  ...
  File ".../agent-zero-lab/cloudledger/server.py", line 111, in list_invoices
    rows = conn.execute(sql, args).fetchall()
           ^^^^^^^^^^^^^^^^^^^^^^^
sqlite3.OperationalError: no such column: issue_at

The above exception was the direct cause of the following exception:
  ...
mcp.server.mcpserver.exceptions.UnexpectedToolError: Error executing tool list_invoices
=========================== short test summary info ============================
FAILED tests/test_cloudledger_server.py::test_duplicate_invoices_visible[asyncio]
1 failed, 12 passed in 2.12s
```

这段输出有三层,从上往下读:

第一层是断言失败:`structured_content` 是 `None`,`is_error=True`。客户端,也就是模型那一侧,只拿到一句 `Error executing tool list_invoices`,没有任何原因。这是 SDK 故意的:工具里冒出来的「意外异常」(不是你主动抛的 `ToolError`)可能带着表名、文件路径之类的内部信息,所以不发给客户端。

第二层是 `Captured stdout setup`,fixture 里 seed 打印的那一行,说明库造好了,问题不在数据。

第三层 `Captured log call` 才是根因:`no such column: issue_at`,还指到了 `server.py` 第 111 行。server 用 logging 把完整的调用栈写到了 stderr(Day 276 讲过 stdio server 的日志只能走 stderr),内存连接下它和测试在同一个进程,pytest 就把这些日志一起抓了下来。这一点比 Day 285 的 Inspector 方便:Inspector 要切到 Console 面板去翻,这里失败时直接摆在你面前。

还有一个细节:13 条里只红了 1 条。`test_lists_everything` 列工具不执行 SQL,所以照样过。合同要覆盖到每个工具的每条主要路径,这个手误才会被抓到,这也是为什么第三步每个工具至少写一条「正常调用」的测试。

改回 `issued_at`,再跑一遍确认全绿。

## 零件 → 测试文件对照表

| 零件 | 哪天学的 | 在今天的哪个文件、哪一段 |
| --- | --- | --- |
| `Client(server对象)` 内存连接 | 今天 | `inmem_vs_stdio.py` 的 `one_call(mcp, ...)`、`conftest.py` 的 `client` fixture |
| `@pytest.mark.anyio` / `pytestmark` | 今天 | `test_mcp_first.py` 的装饰器、`test_cloudledger_server.py` 顶部 |
| fixture、`yield`、`conftest.py` | Day 73 | `conftest.py` 两个 fixture |
| `tmp_path` | Day 73 | `db_path` fixture 第一行 |
| `monkeypatch.setattr` | Day 74 | `db_path` fixture 里改 `seed.DB_PATH` 和 `server.DB_PATH` |
| `parametrize` | Day 73 | `test_bad_customer_id_rejected_by_schema` |
| `ToolError` → `is_error` | Day 282 | 用 `assert r.is_error` 的四条测试 |
| `MCPError(INVALID_PARAMS)` | Day 284 | `test_unknown_ticket_is_invalid_params` 里的 `pytest.raises` |
| 写操作只提申请 | Day 283 | `test_refund_request_is_pending_and_written`、`test_second_refund_is_blocked` |

## 动手练习

**练习 1:再补三条合同。** 新建 `tests/test_ex287_more.py`,写三条测试:① C007 的订阅是企业版、月付、8 席、active;② C003 只按 `status="open"` 过滤时,只有一张发票 INV-2026-0009,并且每一张返回的状态都是 open;③ 用 `"example.com"` 模糊搜客户,最多只返回 5 条。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/tests/test_ex287_more.py
"""练习 1:再补三条合同:订阅详情、按状态过滤发票、模糊搜索最多 5 条。"""
import pytest
from mcp import Client

pytestmark = pytest.mark.anyio


async def test_subscription_of_c007(client: Client) -> None:
    r = await client.call_tool("get_subscription", {"customer_id": "C007"})
    assert not r.is_error
    sub = r.structured_content
    assert sub is not None
    assert (sub["plan"], sub["billing_cycle"], sub["seats"], sub["status"]) == ("企业版", "monthly", 8, "active")


async def test_list_open_invoices_only(client: Client) -> None:
    r = await client.call_tool("list_invoices", {"customer_id": "C003", "status": "open"})
    assert r.structured_content is not None
    rows = r.structured_content["result"]
    assert [x["id"] for x in rows] == ["INV-2026-0009"]
    assert all(x["status"] == "open" for x in rows)


async def test_fuzzy_search_capped_at_five(client: Client) -> None:
    r = await client.call_tool("find_customer", {"query": "example.com"})
    assert r.structured_content is not None
    assert len(r.structured_content["result"]) == 5
```

<div class="line-notes">

- `pytestmark = pytest.mark.anyio` 新文件也要写,标记只对本文件生效。`client` fixture 不用 import,conftest 里的 fixture 对整个 `tests/` 目录可见。
- `sub = r.structured_content` `get_subscription` 返回的是 TypedDict,不是列表,所以 SDK 不包 `result`,字段直接在顶层(Day 281 讲过两种情况的区别)。
- `assert (sub["plan"], sub["billing_cycle"], sub["seats"], sub["status"]) == ("企业版", "monthly", 8, "active")` 四个字段拼成元组一次比完。实测 C007 的订阅是 `{'id': 'S007', 'customer_id': 'C007', 'plan': '企业版', 'billing_cycle': 'monthly', 'seats': 8, 'status': 'active', 'started_at': '2026-03-15', 'current_period_end': '2026-11-08'}`。
- `{"customer_id": "C003", "status": "open"}` `status` 是 Day 281 用 `Literal` 定的四选一。
- `assert [x["id"] for x in rows] == ["INV-2026-0009"]` seed 里 C003 只有这一张未付,实测一致。
- `assert all(x["status"] == "open" for x in rows)` `all(...)` 相当于 JS 的 `rows.every(x => x.status === "open")`。只有一张时看起来多余,但它锁住的是「过滤条件真的生效了」:哪天有人把 `AND status = ?` 删了,上一行可能还碰巧对,这一行一定红。
- `assert len(r.structured_content["result"]) == 5` 30 个客户的邮箱都是 `userNNN@example.com`,全匹配,`LIMIT 5` 截到 5 条。

</div>

```bash
uv run pytest -q tests/test_ex287_more.py
```

输出 `3 passed`。

</details>

**练习 2:库文件不存在时会怎样。** 写一条测试,把 `server.DB_PATH` 指到临时目录里一个**不存在**的文件,然后:① 调 `find_customer`,断言是 `is_error`,文字里有「请先运行 seed.py」;② 取 `reply_ticket` prompt,断言抛 `MCPError`,看看错误文字是什么。这条测试不要用 conftest 的 `client` fixture(它会先造库),自己在测试里建 `Client`,不传 `raise_exceptions`。做完再想:换成 `raise_exceptions=True`,②的错误文字会变成什么?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/tests/test_ex287_missing_db.py
"""练习 2:库文件不存在时,工具要返回模型看得懂的 isError,而不是崩掉。"""
from pathlib import Path

import pytest
from mcp import Client, MCPError
from mcp.types import TextContent

from cloudledger import server

pytestmark = pytest.mark.anyio


async def test_tool_reports_missing_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(server, "DB_PATH", tmp_path / "nope.db")
    async with Client(server.mcp) as c:
        r = await c.call_tool("find_customer", {"query": "C007"})
        with pytest.raises(MCPError) as exc:
            await c.get_prompt("reply_ticket", {"ticket_id": "T1041"})
    assert r.is_error
    block = r.content[0]
    assert isinstance(block, TextContent)
    assert "请先运行 seed.py" in block.text
    assert exc.value.error.message == "Internal server error"
```

<div class="line-notes">

- `monkeypatch.setattr(server, "DB_PATH", tmp_path / "nope.db")` 只改 server,不调 seed,所以这个文件不存在。
- `async with Client(server.mcp) as c:` 自己建连接,默认 `raise_exceptions=False`,和真实 host 的行为一致。
- `r = await c.call_tool("find_customer", {"query": "C007"})` `db()` 发现库不在,抛 Day 284 写的 `ToolError("业务库不存在,请先运行 seed.py 生成 cloudledger.db。")`。
- `with pytest.raises(MCPError) as exc:` prompt 里调 `db()` 抛的也是那个 `ToolError`,可 Day 284 说过,`ToolError` 只有在工具里才会被翻译成 `is_error`,在 prompt 里它就是一个普通异常。
- `assert "请先运行 seed.py" in block.text` 实测全文 `Error executing tool find_customer: 业务库不存在,请先运行 seed.py 生成 cloudledger.db。`。
- `assert exc.value.error.message == "Internal server error"` 实测就是这一句,具体原因被藏起来了,只在 server 的日志里。

</div>

```bash
uv run pytest -q tests/test_ex287_missing_db.py
```

输出 `1 passed`。

换成 `Client(server.mcp, raise_exceptions=True)` 后我实测②的文字变成 `Error rendering prompt reply_ticket`。还是没有「库不存在」这个根因,但至少告诉你是哪个 prompt 在渲染时崩了,这就是 conftest 里打开它的理由。要让 prompt 也把「请先运行 seed.py」交给客户端,得在 `reply_ticket` 里把 `db()` 抛的 `ToolError` 接住,换成 `MCPError` 重新抛,这个改动留给你自己试。①不管开不开都一样,工具的错误本来就是正常结果。

</details>

**练习 3:让一条合同红起来。** 把 `server.py` 里 `find_customer` 的报错改成「没有找到匹配「…」的客户。请重试。」,跑全部测试,看哪一条红、红在哪一行。改回去之后,用 `-k` 只跑名字里带 `refund` 的测试(Day 72 学的)。

<details><summary>参考答案</summary>

改完跑 `uv run pytest -q`,实测:

```text
E       AssertionError: assert '换成邮箱或客户编号' in 'Error executing tool find_customer: 没有找到匹配「nobody@nowhere」的客户。请重试。'
FAILED tests/test_cloudledger_server.py::test_unknown_customer_tells_model_what_to_do[asyncio]
1 failed, 17 passed in 4.08s
```

18 条是因为现在 `tests/` 下有四个文件:`test_mcp_first.py` 1 条、`test_cloudledger_server.py` 13 条、练习 1 的 3 条、练习 2 的 1 条。红的正是给模型「下一步提示」的那条。这就是写这条测试的意义:「请重试」对模型没用,它会拿同一个词再查一遍,Day 282 讲过这种死循环。

改回原文后只跑退款相关的:

```bash
uv run pytest -q -k refund
```

输出 `3 passed, 15 deselected in 0.30s`。三条分别是 `test_refund_request_is_pending_and_written`、`test_second_refund_is_blocked`,还有 `test_refund_policy_resource`(名字里也有 refund)。`-k` 按名字子串匹配,起名时把被测的东西写进去,以后筛起来方便。

</details>

**练习 4:想一想。** 有同学说:「既然内存测试又快又准,Day 285 的冒烟脚本可以删了。」你同意吗?举一个只有冒烟脚本能抓到的问题。

<details><summary>参考答案</summary>

不同意。内存测试直接 import 了 server 对象,跳过了「用一条命令把它拉起来」这一步,所以这一步上的问题它都看不见:启动命令写错路径、子进程里缺依赖、server 启动时往 stdout 打了一行字把 JSON-RPC 搞乱。最后这个我会在明天的课里实跑给你看:一个 import 时 `print` 了一句欢迎语的 server,内存测试照样通过,一用 stdio 连,客户端就报 `Failed to parse JSONRPC message from server`。两层都留着:内存测试每次改代码都跑,冒烟脚本在提交前、或者改了启动方式之后跑。

</details>

验收标准:`uv run pytest -q` 全部通过(做完四道练习是 18 条);`uv run basedpyright tests` 0 报错;能说出 `structured_content is None` 加上 `is_error=True` 时,要去 pytest 输出的哪一段找真正的原因。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 内存连接(in-memory transport) | 把 server 对象直接传给 `Client`,两者在同一个进程里通过内存管道说 MCP,不起子进程、不开端口 |
| anyio pytest 插件 | anyio 库自带的 pytest 插件,贴了 `@pytest.mark.anyio` 的异步测试和异步 fixture 由它启动事件循环来跑 |
| `pytestmark` | 测试文件里的模块级变量,给本文件所有测试统一贴标记 |
| 异步 fixture | 用 `async def` 加 `yield` 写的 fixture,可以在准备阶段 `await`,比如建立 MCP 连接 |
| 测试污染 | 一个测试改了共享的数据(库、文件、全局变量),影响了另一个测试或下一次运行的结果 |
| 合同测试(contract test) | 把一个组件对外承诺的行为(字段名、错误文字、状态)写成测试,改实现时用它确认没破坏承诺 |
| `raise_exceptions` | `Client` 的参数,打开后工具函数体之外的意外失败会带上具体名字,而不是一句笼统的 `Internal server error`;只在测试里用 |
| `UnexpectedToolError` | 工具里冒出来的非 `ToolError` 异常,SDK 把它换成一句 `Error executing tool xxx` 发给客户端,原因只写进 server 日志 |

## 常见误区

**异步测试忘了贴 anyio 标记。** 报 `async def functions are not natively supported`,下面那张插件清单里第一个就是 anyio,很多人以为要再装什么。不用装,贴上 `@pytest.mark.anyio` 或在文件顶部写 `pytestmark = pytest.mark.anyio`。`pytestmark` 拼错(比如写成 `pytest_mark`)不会报错,只是不生效,又回到这个报错。

**测试直接用真实的 `cloudledger.db`。** 只读测试看不出问题,一有写操作就会「第一次过、第二次挂」,第二步实测过。每个测试用 `tmp_path` 加 `monkeypatch` 造一份新库。

**只 monkeypatch 了 `server.DB_PATH`,忘了 `seed.DB_PATH`。** 这样 `seed.main()` 会把你真实的 `cloudledger/cloudledger.db` 删掉重建(seed 第一件事是 `DB_PATH.unlink`),server 却去读一个空目录,所有查询都报「业务库不存在」。两个模块各有自己的 `DB_PATH`,要一起改。

**用 `from cloudledger.server import DB_PATH` 再去改它。** 这样改的是你自己文件里的一个同名变量,server 模块里那个纹丝不动。`monkeypatch.setattr` 要改的是**模块对象上的属性**,所以 conftest 里 import 的是模块 `server`,不是变量。

**工具报错用 `pytest.raises` 去接。** 工具里的 `ToolError` 到客户端是 `is_error=True` 的正常结果,不会抛异常,`pytest.raises` 会报 `DID NOT RAISE`。反过来,prompt 和 resource 的错误是 JSON-RPC 错误,客户端会抛 `MCPError`,这时才用 `pytest.raises`。

**以为 `raise_exceptions=True` 会把工具里的真实异常抛到测试里。** 旧教程(包括 1.x 时代的写法)有这个说法,在 mcp 2.3.0 里我实测不是这样:工具里的 `no such column` 开不开这个参数,客户端都只看到 `Error executing tool list_invoices`。根因在 pytest 的 `Captured log call` 那一段。

**内存测试全绿就以为 host 一定能连上。** 内存连接跳过了启动子进程这一步,启动命令、依赖、stdout 污染的问题它都测不到,这些交给冒烟脚本和明天的 probe。

## 学习资料

### 文档与文章

- [MCP Python SDK v2 · Testing](https://py.sdk.modelcontextprotocol.io/v2/get-started/testing/):官方的测试写法,就是今天的 `Client(mcp)` 加 anyio 标记;`raise_exceptions` 只管工具之外的失败这一点也写在这里。它还用了 `inline-snapshot` 做快照断言,感兴趣可以对照 Jest 的 `toMatchSnapshot`。
- [AnyIO · Testing with AnyIO](https://anyio.readthedocs.io/en/stable/testing.html):anyio pytest 插件的说明,`pytestmark`、`anyio_backend` fixture、异步 fixture 都在这页。
- [pytest · How to use temporary directories and files](https://docs.pytest.org/en/stable/how-to/tmp_path.html):`tmp_path` 的位置和清理规则。
- [pytest · How to monkeypatch/mock modules and environments](https://docs.pytest.org/en/stable/how-to/monkeypatch.html):`monkeypatch.setattr` 和 `setenv`,练习 2 之后可以想想用 `setenv("CLOUDLEDGER_DB", ...)` 行不行(提示:`DB_PATH` 是 import 时算好的)。
- [pytest · How to use fixtures](https://docs.pytest.org/en/stable/how-to/fixtures.html):fixture 之间互相依赖、同一个测试里共享同一个 `tmp_path` 的规则,看「Fixtures can request other fixtures」一节。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1wuDGBYE6t&autoplay=0&high_quality=1" title="pytest的fixture夹具用法" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Yoyo本慢 · pytest的fixture夹具用法 · 4 分钟复习 fixture,今天的 conftest 就是两个 fixture 串起来。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV17LUTBKECk&autoplay=0&high_quality=1" title="MCP工具的封装与测试" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>马卡拉卡大表弟 · MCP工具的封装与测试 · 看别人怎么验证一个 MCP 工具,和今天「从里面测」的做法对比。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/_SculpkcFVI" title="How to Test an MCP Server: 5 Layers From Contract Tests to Production Evals" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Slav Kurochkin · How to Test an MCP Server: 5 Layers From Contract Tests to Production Evals · 把 MCP 测试分成五层,今天做的是最底下的合同测试,后面第六部分做评测时再回来看上面几层。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/d_VGHhw3fWE" title="Test an MCP Server With pytest: In-Memory Client and Inspector CLI" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AISLabs AI · Test an MCP Server With pytest: In-Memory Client and Inspector CLI · 内存客户端加 Inspector CLI 两层一起讲,和本周的安排一样;视频里的 SDK 版本可能和我们的 2.3.0 不同,类名以迁移指南为准。</figcaption>
</figure>

### 书籍

- Brian Okken,《Python Testing with pytest》第二版,Pragmatic Bookshelf,2022。fixture、参数化、插件讲得最系统的一本,书里的 pytest 是 7.x,和我们的 9.x 主体一致。没查到简体中文版。

### 开源项目与代码

- [modelcontextprotocol/python-sdk](https://github.com/modelcontextprotocol/python-sdk):仓库的 `tests/` 目录里大量用 `Client(server)` 内存连接测 SDK 自己,想看更多断言写法就去翻;`src/mcp/server/mcpserver/tools/base.py` 里能找到 `Error executing tool` 这句话是在哪里拼出来的。
- [modelcontextprotocol/servers · time](https://github.com/modelcontextprotocol/servers/tree/main/src/time):官方的时间 server,它的 `test/` 目录是一个小而完整的 server 测试样板,明天我们还会用 probe 去逛它。

## 自测

1. `Client(mcp)` 和 `Client(StdioServerParameters(...))` 有什么相同、有什么不同?

<details><summary>答案</summary>

相同:同一个 `Client` 类,发的都是 JSON-RPC 消息,server 那边一样做参数校验、一样把 `ToolError` 变成 `is_error` 结果,协议版本实测都是 2026-07-28。不同:前者在同一个进程里用内存管道连,不启动子进程,实测十几毫秒;后者用命令拉起一个 server 子进程,通过 stdin/stdout 连,实测两三秒到四五秒。前者测不到启动命令、依赖和 stdout 污染这类问题。

</details>

2. 下面这条测试为什么第一次过、第二次挂?怎么改?

```python
@pytest.mark.anyio
async def test_refund():
    async with Client(mcp) as c:
        r = await c.call_tool("create_refund_request", {"invoice_id": "INV-2026-0123", "amount_yuan": 2392, "reason": "重复扣款"})
    assert not r.is_error
```

<details><summary>答案</summary>

它用的是真实的 `cloudledger.db`。第一次运行插入了一条 2392 元的申请,第二次再申请同一张发票就超过了「发票金额减已申请金额」,server 返回 `最多还能申请 0.00 元`。改法:用 conftest 里的 `client` fixture(它依赖 `db_path`,每个测试在 `tmp_path` 里新造一份库,并用 `monkeypatch` 把 `seed.DB_PATH` 和 `server.DB_PATH` 都指过去)。

</details>

3. 工具报错和 prompt 报错,在测试里分别怎么断言?为什么不一样?

<details><summary>答案</summary>

工具报错用 `assert r.is_error` 加检查 `r.content[0].text`;prompt 报错用 `with pytest.raises(MCPError) as exc:`,再查 `exc.value.error.code` 和 `.message`。因为 MCP 规定工具的失败是「正常返回的结果,只是打了 isError 标记」,好让模型读到并改正;prompt 和 resource 的失败是 JSON-RPC 错误,客户端收到后抛异常。

</details>

4. 测试里 `structured_content` 是 `None`、`is_error=True`、文字只有 `Error executing tool list_invoices`,下一步看哪里?

<details><summary>答案</summary>

看 pytest 失败输出里的 `Captured log call`(或 `Captured stderr call`)。工具里冒出来的意外异常,SDK 只给客户端一句笼统的话,完整调用栈写进 server 的日志;内存连接下 server 和测试同一个进程,pytest 把日志抓下来了,里面有真正的原因,比如 `sqlite3.OperationalError: no such column: issue_at` 和行号。

</details>

5. 面试题:你写了一个给 Agent 用的 MCP server,怎么测?说说你会分几层、每层测什么。

<details><summary>答案</summary>

我会分三层。第一层是内存客户端的合同测试,每次改代码都跑:把 server 对象交给 SDK 的 `Client`,每个测试一份临时数据,断言每个工具的正常结果(字段名和结构)、给模型看的错误文字、参数校验能拦住坏输入、写操作的副作用真的落库且状态正确;一个 13 条的测试文件不到一秒。第二层是从外面的冒烟测试,提交前或改了启动方式后跑:用和真实 host 一样的启动命令通过 stdio 拉起来,比如用 Inspector CLI 或一个最小 client 列一遍工具、调一两个,抓启动命令、依赖、stdout 污染的问题。第三层才接模型,用评测集看 Agent 拿着这些工具能不能把任务做对,这一层慢而且花钱,失败时先回头看前两层,很多 Agent 的失败其实是工具本身的 bug。

</details>

## 明天预告

Day 288 · 写 MCP server(八):不接模型,先写一个最小 client。今天的测试把 server 对象直接 import 进来,所以「把 server 当子进程拉起来」这一步一直没被测过。明天写一个独立的 `part05/mcp_probe.py`,用一条命令启动任意 server,把它暴露的工具、resource、prompt 逛一遍;再往下拆一层,看 `Client` 里面的 `ClientSession` 到底做了什么,顺便拿它去逛一个别人写的 server,演示那个内存测试测不出来的 stdout 污染。
