---
title: 'Day 286 · 第 41 周复习:MCP 与编排(Day 280–285)'
description: '这一周从造一份 CloudLedger 业务库开始,写出了一个带四个工具、一个 resource、一个 prompt 的 MCP server,并学会用 Inspector 调试它。今天画一张知识地图,每天一句话回顾,默写一个最小 server,找一段代码里的四个错误,再只用本周知识做一个「报价 server」小项目,用 Inspector CLI 写的验收脚本九条全过。'
pubDate: 2026-10-22
regime: none
tags: ['review', 'mcp', 'mcp-server', 'cloudledger', 'agent-zero']
series: 'agent-zero'
day: 286
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 285](/blog/agent-zero/day-285-mcp-inspector/) 用固定版本的 MCP Inspector 2.10.1 调试了 CloudLedger server:界面里调工具、读 resource、取 prompt,学会出错时分三处看(Results 是模型看到的,Protocol 是 JSON-RPC 这一层,Console 是 server 的 stderr);再用 `--cli` 模式把点击变成命令,靠退出码 0、1、5 写出了一个七条检查的冒烟脚本。

这是第 41 周的最后一天。这六天其实只做了一件事:把一个 SQLite 业务库,包装成任何 MCP host 都能接的 server。今天把六天串起来,补一遍容易忘的细节,再用一个新的小 server 检验自己是不是真会了。

## 今天要解决的问题

1. 能对着一张图说出本周六天各加了 server 的哪一块,以及每一块出错时走哪条路。
2. 合上文章默写一个最小 server(一个带约束的工具、一个 resource、一个 prompt),用 Inspector CLI 验证通过。
3. 能在一段代码里指出本周讲过的四类错误,并说出每一类的真实报错长什么样。
4. 完成一个只用本周知识的小项目 `part05/review41_quote_server.py`,验收脚本九条全部 PASS。

预计用时 3.5 小时。不调模型,花费 ¥0。

前置:本周的 [Day 280](/blog/agent-zero/day-280-mcp-seed/) 到 [Day 285](/blog/agent-zero/day-285-mcp-inspector/)。要用到 Day 280 的 `cloudledger/seed.py` 和它生成的 `cloudledger/cloudledger.db`,Day 284 的 `cloudledger/server.py`,Day 285 的 `part05/smoke_cloudledger.sh` 的写法。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。复习日的默写最要紧,练习 1 请真的合上文章写。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 320" role="img" aria-label="第 41 周知识地图:中间是 cloudledger/server.py,周围是六天各自加上的部分:280 造数据,281 第一个工具,282 错误信息,283 读写分开,284 resource 和 prompt,285 Inspector 调试">
<rect x="0" y="0" width="640" height="320" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="225" y="130" width="190" height="62" rx="8" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="156" fill="var(--ink)" text-anchor="middle">cloudledger/server.py</text>
<text x="320" y="176" fill="var(--ink-soft)" text-anchor="middle" font-size="11">4 tools · 1 resource · 1 prompt</text>
<rect x="20" y="20" width="180" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="110" y="42" fill="var(--ink)" text-anchor="middle">280 造业务库</text>
<text x="110" y="62" fill="var(--ink-soft)" text-anchor="middle" font-size="11">seed.py;金额存分</text>
<rect x="230" y="20" width="180" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="42" fill="var(--ink)" text-anchor="middle">281 第一个工具</text>
<text x="320" y="62" fill="var(--ink-soft)" text-anchor="middle" font-size="11">@mcp.tool;Field 约束</text>
<rect x="440" y="20" width="180" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="530" y="42" fill="var(--ink)" text-anchor="middle">282 错误给模型看</text>
<text x="530" y="62" fill="var(--ink-soft)" text-anchor="middle" font-size="11">ToolError;说下一步</text>
<rect x="20" y="246" width="180" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="110" y="268" fill="var(--ink)" text-anchor="middle">283 读写分开</text>
<text x="110" y="288" fill="var(--ink-soft)" text-anchor="middle" font-size="11">只提申请;annotations</text>
<rect x="230" y="246" width="180" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="268" fill="var(--ink)" text-anchor="middle">284 resource/prompt</text>
<text x="320" y="288" fill="var(--ink-soft)" text-anchor="middle" font-size="11">URI;模板;MCPError</text>
<rect x="440" y="246" width="180" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="530" y="268" fill="var(--ink)" text-anchor="middle">285 Inspector</text>
<text x="530" y="288" fill="var(--ink-soft)" text-anchor="middle" font-size="11">三面板;CLI 退出码</text>
<line x1="110" y1="76" x2="250" y2="130" stroke="var(--ink-soft)"/>
<line x1="320" y1="76" x2="320" y2="130" stroke="var(--ink-soft)"/>
<line x1="530" y1="76" x2="390" y2="130" stroke="var(--ink-soft)"/>
<line x1="110" y1="246" x2="250" y2="192" stroke="var(--ink-soft)"/>
<line x1="320" y1="246" x2="320" y2="192" stroke="var(--ink-soft)"/>
<line x1="530" y1="246" x2="390" y2="192" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
<text x="560" y="214" fill="var(--ink-faint)" text-anchor="middle" font-size="11">从外面测</text>
</g>
</svg>
<figcaption>五条实线是往 server.py 里加东西,虚线那条是从外面看它。下周 Day 287 起换成在进程里测、自己写 client、接进 host。</figcaption>
</figure>

再用一张表把三种原语这周学到的所有差别放在一起。复习时最容易混的就是「哪种出错走哪条路」:

| | tool | resource | prompt |
| --- | --- | --- | --- |
| 谁决定用 | 模型 | 应用或用户 | 用户 |
| 装饰器 | `@mcp.tool()` | `@mcp.resource("uri")`,地址必写 | `@mcp.prompt()` |
| 参数类型 | 任意(str、int、Literal……),有 schema 校验 | 只能来自 URI 里的 `{占位}` | 只能是字符串 |
| 列表方法 | `tools/list` | `resources/list`,模板在 `resources/templates/list` | `prompts/list` |
| 出错时客户端看到 | `isError: true` 的正常结果 | JSON-RPC 错误(`MCPError`) | JSON-RPC 错误(`MCPError`) |
| 想让错误文字到达对面 | `raise ToolError(...)` | `raise MCPError(code=INVALID_PARAMS, ...)` | 同左 |
| 抛了意外异常 | 只剩 `Error executing tool xxx` | `Internal server error` | `Internal server error` |
| Inspector CLI 退出码 | 成功 0,`isError` 5 | 成功 0,错误 1 | 成功 0,错误 1 |

## 本周每天一句话

- [Day 280](/blog/agent-zero/day-280-mcp-seed/):用 `seed.py` 造出云簿 CloudLedger 的五张表,金额一律存成「分」的整数,随机种子固定所以每次数据一样,C007 故意多一张重复扣款的发票。
- [Day 281](/blog/agent-zero/day-281-mcp-first-tool/):一个普通函数加 `@mcp.tool`,函数名变工具名、docstring 变描述、类型标注变 inputSchema,`pattern`、`Literal`、`ge`/`le` 在函数执行前就拦住坏参数。
- [Day 282](/blog/agent-zero/day-282-mcp-errors/):模型传错了能改的情况一律 `raise ToolError`,消息里写清下一步;return 一个错误字符串最坑,`isError` 是 false,模型会当成正常数据。
- [Day 283](/blog/agent-zero/day-283-mcp-read-write/):唯一的写工具只「提交退款申请」,状态在 SQL 里写死成 `pending_approval`;`ToolAnnotations` 只是给 host 的提示,真正的权限边界在代码里。
- [Day 284](/blog/agent-zero/day-284-mcp-resource-prompt/):退款政策挂成 resource,工单处理指令做成 prompt;这两样出错走 JSON-RPC 错误,要把文字带给客户端得抛 `MCPError`。
- [Day 285](/blog/agent-zero/day-285-mcp-inspector/):Inspector 2.10.1 里调试,Results、Protocol、Console 三处各看各的;`--cli` 加退出码能写成冒烟脚本。

## 本周小项目:报价 server

云簿的销售经常被客户问「我现在是基础版 3 个人,升到专业版一年多少钱」。我们做一个独立的小 server 专门回答这类问题,而且只用本周学过的东西:

- 价目表做成 resource `cloudledger://plans`(Day 284);
- 算价做成只读工具 `quote_price`,套餐用 `Literal`、席位数用 `ge`/`le` 约束,企业版至少 2 席这条业务规则用 `ToolError` 告诉模型怎么改(Day 281、282);
- 升级申请做成写工具 `create_upgrade_request`,只插一条 `pending_review` 状态的记录,不能降级、不能重复提交(Day 283);
- 给销售用的回复模板做成 prompt `quote_reply`,套餐名写错时用 `MCPError` 报清楚(Day 284);
- 最后用 Inspector CLI 写验收脚本(Day 285)。

数据还是 Day 280 那个库。升级申请需要一张新表 `upgrade_requests`,server 在拿连接时用 `CREATE TABLE IF NOT EXISTS` 顺手建上,不用改 seed.py。

```python
# agent-zero-lab/part05/review41_quote_server.py
"""第 41 周小项目:云簿报价 server。价目表是 resource,算价是只读工具,升级申请是写工具,回复模板是 prompt。"""
import logging
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Annotated, Literal, TypedDict

from pydantic import Field

from mcp import MCPError
from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import INVALID_PARAMS, ToolAnnotations

DB_PATH = Path(__file__).resolve().parent.parent / "cloudledger" / "cloudledger.db"
PLANS = {"基础版": 4900, "专业版": 9900, "企业版": 29900}  # 每席位每月,单位分
log = logging.getLogger("quote")

mcp = MCPServer("cloudledger-quote", instructions="云簿报价工具。金额对外用元,年付按 12 个月计。")

Plan = Literal["基础版", "专业版", "企业版"]


class Quote(TypedDict):
    plan: str
    seats: int
    billing_cycle: str
    amount_yuan: str


def db() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise ToolError("业务库不存在,请先运行 cloudledger/seed.py。")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute(
        "CREATE TABLE IF NOT EXISTS upgrade_requests ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT NOT NULL, "
        "to_plan TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL)"
    )
    return conn


@mcp.resource("cloudledger://plans", mime_type="text/markdown")
def plan_prices() -> str:
    """三档套餐每席位每月的价格。"""
    rows = [f"| {p} | {c / 100:.2f} 元 |" for p, c in PLANS.items()]
    return "\n".join(["| 套餐 | 每席位每月 |", "| --- | --- |", *rows])


@mcp.tool(annotations=ToolAnnotations(read_only_hint=True, open_world_hint=False))
def quote_price(
    plan: Plan,
    seats: Annotated[int, Field(ge=1, le=500, description="席位数")],
    billing_cycle: Literal["monthly", "yearly"] = "monthly",
) -> Quote:
    """按套餐、席位数和计费周期算一期的价格。企业版至少 2 个席位。"""
    if plan == "企业版" and seats < 2:
        raise ToolError("企业版至少 2 个席位。1 个人用的话可以报专业版,或者把 seats 改成 2。")
    months = 12 if billing_cycle == "yearly" else 1
    cents = PLANS[plan] * seats * months
    return Quote(plan=plan, seats=seats, billing_cycle=billing_cycle, amount_yuan=f"{cents / 100:.2f}")


@mcp.tool(annotations=ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=False))
def create_upgrade_request(
    customer_id: Annotated[str, Field(pattern=r"^C\d{3}$", description="客户编号,如 C007")],
    to_plan: Plan,
) -> dict:
    """提交一条升级申请,状态 pending_review,由销售确认后才生效。只能往更贵的套餐升。"""
    with db() as conn:
        sub = conn.execute("SELECT plan FROM subscriptions WHERE customer_id = ?", (customer_id,)).fetchone()
        if sub is None:
            raise ToolError(f"客户 {customer_id} 没有订阅记录。")
        if PLANS[to_plan] <= PLANS[sub["plan"]]:
            raise ToolError(f"客户当前是{sub['plan']},{to_plan}不比它贵,这不是升级。")
        pending = conn.execute(
            "SELECT id FROM upgrade_requests WHERE customer_id = ? AND status = 'pending_review'",
            (customer_id,),
        ).fetchone()
        if pending is not None:
            raise ToolError(f"客户 {customer_id} 已有待处理的升级申请 #{pending['id']},不要重复提交。")
        cur = conn.execute(
            "INSERT INTO upgrade_requests (customer_id, to_plan, status, created_at) "
            "VALUES (?, ?, 'pending_review', ?)",
            (customer_id, to_plan, datetime.now().isoformat(timespec="seconds")),
        )
        log.info("upgrade request %s: %s -> %s", cur.lastrowid, customer_id, to_plan)
    return {"upgrade_request_id": cur.lastrowid, "from_plan": sub["plan"], "to_plan": to_plan, "status": "pending_review"}


@mcp.prompt()
def quote_reply(customer_id: str, to_plan: str) -> str:
    """给想升级的客户起草一段报价回复。"""
    if to_plan not in PLANS:
        raise MCPError(code=INVALID_PARAMS, message=f"没有「{to_plan}」这个套餐,可选:{'、'.join(PLANS)}")
    return (
        f"客户 {customer_id.upper()} 想升级到{to_plan}。先用 cloudledger server 的 get_subscription 看他现在的套餐和席位,"
        f"再用 quote_price 算新套餐月付和年付两个价格,参考 cloudledger://plans,"
        "最后起草回复。不要承诺折扣,升级申请用 create_upgrade_request 提交。"
    )


if __name__ == "__main__":
    mcp.run()
```

<div class="line-notes">

- `"""第 41 周小项目:云簿报价 server。` docstring 把四个部件各是什么原语先说清楚,和 Day 283 把权限边界写在最前面是同一个习惯。
- `from mcp import MCPError` prompt 里报错要用它(Day 284)。
- `from mcp.server.mcpserver.exceptions import ToolError` 工具里报错用它(Day 282)。
- `from mcp.types import INVALID_PARAMS, ToolAnnotations` 错误码 -32602,以及读写提示(Day 283)。
- `DB_PATH = Path(__file__).resolve().parent.parent / "cloudledger" / "cloudledger.db"` 从 `part05/review41_quote_server.py` 往上两级到 `agent-zero-lab/`,再进 `cloudledger/`。代入我的路径,得到 `.../agent-zero-lab/cloudledger/cloudledger.db`。用绝对路径的好处是不管 Inspector 在哪个目录拉起它都找得到库(当然 `uv run` 本身还是要在项目目录里跑,Day 285 讲过)。
- `PLANS = {"基础版": 4900` 和 seed.py 一样的价格表,单位分。
- `log = logging.getLogger("quote")` 日志走 stderr,不碰 stdout。
- `mcp = MCPServer("cloudledger-quote", instructions=` server 名和 Day 284 的 `cloudledger` 不同,两个可以同时接进一个 host。instructions 提醒模型年付按 12 个月算。
- `Plan = Literal["基础版", "专业版", "企业版"]` 把套餐枚举存成一个**类型别名**,三个地方共用,改一处全改。相当于 TS 的 `type Plan = "基础版" | "专业版" | "企业版"`。
- `class Quote(TypedDict):` 返回结构写成 TypedDict,SDK 才会生成 outputSchema 并给出 `structuredContent`。
- `amount_yuan: str` 金额用字符串,`"28704.00"` 的两位小数不会丢。
- `def db() -> sqlite3.Connection:` 所有用库的地方都经过它。
- `if not DB_PATH.exists():` 不检查的话 `sqlite3.connect` 会悄悄新建一个空库(Day 281 讲过)。
- `conn.execute(` 每次拿连接都执行一次建表语句。
- `"CREATE TABLE IF NOT EXISTS upgrade_requests ("` `IF NOT EXISTS`:表已存在就什么都不做,所以调多少次都安全。seed.py 每次删库重建,这张表会跟着消失,下次第一次拿连接时又建上。
- `"id INTEGER PRIMARY KEY AUTOINCREMENT` 自增 id,第一条是 1。几段字符串挨着写会自动拼成一条 SQL。
- `@mcp.resource("cloudledger://plans", mime_type="text/markdown")` 价目表 resource。地址必写,装饰器必须带括号。
- `rows = [f"| {p} | {c / 100:.2f} 元 |" for p, c in PLANS.items()]` 列表推导式,每个套餐一行。代入专业版:`9900 / 100` → `99.00`。
- `return "\n".join(["| 套餐 | 每席位每月 |", "| --- | --- |", *rows])` `*rows` 把列表展开塞进另一个列表,相当于 JS 的 `[...header, ...rows]`。实测读出来是 `| 套餐 | 每席位每月 |\n| --- | --- |\n| 基础版 | 49.00 元 |\n...`。
- `@mcp.tool(annotations=ToolAnnotations(read_only_hint=True, open_world_hint=False))` 算价不碰数据库,只读。
- `plan: Plan,` 用上面那个别名,schema 里是三个值的 enum。实测传 `旗舰版`,函数没执行就被拦:`Input should be '基础版', '专业版' or '企业版'`。
- `seats: Annotated[int, Field(ge=1, le=500` 1 到 500 席。
- `billing_cycle: Literal["monthly", "yearly"] = "monthly",` 有默认值,所以是可选参数。
- `if plan == "企业版" and seats < 2:` 这是 schema 表达不了的**跨字段规则**(席位下限取决于套餐),只能写在函数里。
- `raise ToolError("企业版至少 2 个席位。` 消息里给出两条出路,模型读到可以自己改参数重试。实测 `plan=企业版 seats=1` 得到 `isError: true`,文字就是这句。
- `months = 12 if billing_cycle == "yearly" else 1` 年付按 12 个月,和 seed.py 生成年付发票的算法一致。
- `cents = PLANS[plan] * seats * months` 代入企业版 8 席年付:`29900 × 8 × 12 = 2870400` 分。全程整数,没有浮点误差。
- `return Quote(plan=plan` `2870400 / 100` → `"28704.00"`。实测 `structuredContent` 是 `{"plan": "企业版", "seats": 8, "billing_cycle": "yearly", "amount_yuan": "28704.00"}`。
- `@mcp.tool(annotations=ToolAnnotations(read_only_hint=False` 写工具:会写库、不删不改、不幂等,三个提示和 Day 283 的退款工具一样。
- `customer_id: Annotated[str, Field(pattern=r"^C\d{3}$"` 编号格式校验。
- `to_plan: Plan,` 目标套餐,同样是三选一。
- `"""提交一条升级申请,状态 pending_review` docstring 把「不会立即生效」「只能升不能降」先告诉模型。
- `sub = conn.execute("SELECT plan FROM subscriptions` 查客户当前套餐。代入 C009:`基础版`;C007:`企业版`。
- `if PLANS[to_plan] <= PLANS[sub["plan"]]:` 用价格比较判断是不是升级。C007 是企业版(29900),申请专业版(9900),`9900 <= 29900` 为真,拦下。实测报 `客户当前是企业版,专业版不比它贵,这不是升级。`
- `pending = conn.execute(` 查这个客户有没有还没处理的申请。
- `if pending is not None:` `idempotent_hint=False` 只是提醒,真正防重复的是这几行。实测同样的参数调第二次,报 `客户 C009 已有待处理的升级申请 #1,不要重复提交。`
- `"VALUES (?, ?, 'pending_review', ?)",` 状态写死在 SQL 里,模型改不了,和 Day 283 的 `pending_approval` 一样。
- `log.info("upgrade request %s: %s -> %s"` 实测 stderr 打出 `upgrade request 1: C009 -> 专业版`。
- `return {"upgrade_request_id": cur.lastrowid` 返回类型写的是 `dict`,没有 TypedDict,所以这个工具**没有** outputSchema,结果只在 `content` 文本里。练习 3 的观察题会让你对比。实测 C009 第一次得到 `{"upgrade_request_id": 1, "from_plan": "基础版", "to_plan": "专业版", "status": "pending_review"}`。
- `@mcp.prompt()` 回复模板。
- `def quote_reply(customer_id: str, to_plan: str) -> str:` prompt 参数只能是字符串,所以这里不能用 `Plan` 这个 Literal 做校验,只能在函数里自己查。
- `if to_plan not in PLANS:` `in` 判断字典里有没有这个键,相当于 JS 的 `to_plan in PLANS`。
- `raise MCPError(code=INVALID_PARAMS` `'、'.join(PLANS)` 把字典的键用顿号拼起来,得到 `基础版、专业版、企业版`。实测 CLI 输出 `{"error":{"code":"error","message":"没有「旗舰版」这个套餐,可选:基础版、专业版、企业版"}}`,退出码 1。
- `f"客户 {customer_id.upper()} 想升级到{to_plan}。先用 cloudledger server 的 get_subscription` 这个 server 自己没有 `get_subscription`,它在 Day 284 的 cloudledger server 里。prompt 可以引用别的 server 的工具,前提是 host 同时接了两个 server。我拿这个 server 单独去调 `get_subscription`,Inspector CLI 报的是 `Tool 'get_subscription' not found on server.`,说明它确实不在这里。
- `"最后起草回复。不要承诺折扣` 把业务红线写进模板,比指望每个销售都记得要稳。

</div>

验收脚本照 Day 285 的冒烟脚本改。新建 `part05/review41_smoke.sh`:

```bash
#!/usr/bin/env bash
# agent-zero-lab/part05/review41_smoke.sh
# 第 41 周小项目的验收脚本。在 agent-zero-lab 根目录跑:bash part05/review41_smoke.sh
set -u
INSPECTOR="${INSPECTOR:-npx -y @modelcontextprotocol/inspector@2.10.1}"
SERVER="uv run python part05/review41_quote_server.py"
fail=0

check() {
  local want="$1" name="$2"; shift 2
  $INSPECTOR --cli $SERVER "$@" > /dev/null 2>&1
  local got=$?
  if [ "$got" -eq "$want" ]; then echo "PASS $name (exit $got)"; else echo "FAIL $name (想要 $want,实际 $got)"; fail=1; fi
}

uv run python cloudledger/seed.py > /dev/null
check 0 "读价目表"           --method resources/read --uri cloudledger://plans
check 0 "企业版 8 席年付"     --method tools/call --tool-name quote_price --tool-arg plan=企业版 seats=8 billing_cycle=yearly
check 5 "企业版 1 席被拦"     --method tools/call --tool-name quote_price --tool-arg plan=企业版 seats=1
check 5 "不存在的套餐被拦"   --method tools/call --tool-name quote_price --tool-arg plan=旗舰版 seats=3
check 5 "降级被拦"           --method tools/call --tool-name create_upgrade_request --tool-arg customer_id=C007 to_plan=专业版
check 0 "C009 升专业版"       --method tools/call --tool-name create_upgrade_request --tool-arg customer_id=C009 to_plan=专业版
check 5 "重复申请被拦"       --method tools/call --tool-name create_upgrade_request --tool-arg customer_id=C009 to_plan=专业版
check 0 "取回复模板"         --method prompts/get --prompt-name quote_reply --prompt-args customer_id=c009 to_plan=专业版
check 1 "模板里套餐写错"     --method prompts/get --prompt-name quote_reply --prompt-args customer_id=c009 to_plan=旗舰版
exit $fail
```

<div class="line-notes">

- `INSPECTOR="${INSPECTOR:-npx -y @modelcontextprotocol/inspector@2.10.1}"` 没设环境变量就用固定版本的 npx,和 Day 285 一样。
- `SERVER="uv run python part05/review41_quote_server.py"` 只有这一行和 Day 285 的脚本不同。
- `check() {` 函数原样搬过来:期望退出码、名字、剩下的参数交给 Inspector。
- `$INSPECTOR --cli $SERVER "$@" > /dev/null 2>&1` 两个变量故意不加引号,让 bash 按空格拆开。
- `uv run python cloudledger/seed.py > /dev/null` 先重置库。不重置的话,上一次跑留下的 C009 申请会让「C009 升专业版」这一条变成 5(重复申请被拦),第一次跑通、第二次就挂。我第一次写这个脚本时就漏了这行。
- `check 0 "企业版 8 席年付"` `seats=8` 被 CLI 当 JSON 解析成数字 8,正好是 schema 要的 int。
- `check 5 "不存在的套餐被拦"` Literal 校验失败也算工具错误,退出码 5。
- `check 5 "降级被拦"` C007 是企业版。
- `check 0 "C009 升专业版"` C009 是基础版 3 席年付,升专业版合法。
- `check 5 "重复申请被拦"` 同样的参数紧接着再来一次。这一条依赖上一条先成功,顺序不能换。
- `check 1 "模板里套餐写错"` prompt 抛 `MCPError`,不是工具错误,所以是 1。

</div>

```bash
cd agent-zero-lab
bash part05/review41_smoke.sh
echo "script exit $?"
```

输出(2026-10-22 实跑,我用本地装好的同版本 Inspector,九条共 35 秒):

```text
PASS 读价目表 (exit 0)
PASS 企业版 8 席年付 (exit 0)
PASS 企业版 1 席被拦 (exit 5)
PASS 不存在的套餐被拦 (exit 5)
PASS 降级被拦 (exit 5)
PASS C009 升专业版 (exit 0)
PASS 重复申请被拦 (exit 5)
PASS 取回复模板 (exit 0)
PASS 模板里套餐写错 (exit 1)
script exit 0
```

最后确认一下库里真的只有一条申请:

```bash
sqlite3 cloudledger/cloudledger.db "SELECT * FROM upgrade_requests;"
```

```text
1|C009|专业版|pending_review|2026-10-22T13:04:24
```

(时间是你跑的时刻。)

零件和这个小项目的对照:

| 本周零件 | 在小项目里的哪一段 |
| --- | --- |
| Day 280 金额存分、整数运算 | `PLANS` 和 `cents = PLANS[plan] * seats * months` |
| Day 281 `@mcp.tool` + `Literal`/`Field` | `quote_price` 的三个参数、`create_upgrade_request` 的 `pattern` |
| Day 282 `ToolError` 写出路 | 企业版 1 席、降级、重复申请三处 |
| Day 283 写操作收窄 + annotations | `'pending_review'` 写死在 SQL、防重复查询、两组 `ToolAnnotations` |
| Day 284 resource、prompt、`MCPError` | `plan_prices`、`quote_reply` |
| Day 285 Inspector CLI 退出码 | `review41_smoke.sh` |

## 本周错题与坑清单

我这周写和跑的时候真实撞到的,按出现频率排:

| 坑 | 真实报错或现象 | 怎么改 |
| --- | --- | --- |
| 工具里 return 错误字符串 | `isError: false`,`structuredContent` 里是 `"错误:发票不存在"` | `raise ToolError(...)` |
| 工具里抛了意外异常 | 模型只看到 `Error executing tool list_invoices` | 去 Inspector 的 Console 或终端 stderr 看 traceback |
| prompt 里抛 `ValueError`/`ToolError` | 客户端只有 `Internal server error`(-32603) | `raise MCPError(code=INVALID_PARAMS, message=...)` |
| `@mcp.resource` 没写地址 | `TypeError: The @resource decorator was used incorrectly` | `@mcp.resource("cloudledger://...")` |
| 静态地址配了带参函数 | `ValueError: ... has no URI template variables, but the handler declares parameters` | 地址写成 `.../{参数名}` |
| 单元素元组漏逗号 `(invoice_id)` | `ProgrammingError: Incorrect number of bindings supplied. The current statement uses 1, and there are 13 supplied.` | `(invoice_id,)` |
| 照老教程 `from mcp.server.fastmcp import FastMCP` | `ModuleNotFoundError: No module named 'mcp.server.fastmcp'. This is mcp 2.x, ...` | `from mcp.server import MCPServer` |
| stdio server 里 `print` | Python 客户端报 `Failed to parse JSONRPC message from server`,Inspector 不吭声 | 用 `logging` |
| Inspector CLI `--tool-arg customer_id=7` | `Input should be a valid string ... input_type=int` | `'customer_id="7"'` 或 `--tool-args-json` |
| 在子目录里启动 Inspector | `can't open file '.../cloudledger/cloudledger/server.py'`,`Connection closed` | 在 `agent-zero-lab/` 根目录启动 |
| 第二个 Inspector 起不来 | `MCP Inspector PORT IS IN USE at http://127.0.0.1:6274` | 回到第一个的终端按 Ctrl+C |
| 调完写工具不重置库 | 第二次跑「同样的操作」结果变了 | 前后跑 `uv run python cloudledger/seed.py` |

## 动手练习

**练习 1(默写):最小 server。** 合上文章,在 `part05/review41_dictation.py` 里写一个 server,包含:一个只读工具 `get_ticket(ticket_id)`,工单号必须匹配 `^T\d{4}$`,查不到时用 `ToolError` 告诉模型工单号范围;一个 resource `cloudledger://policy/refund`;一个 prompt `reply_ticket(ticket_id)`,查不到时用 `MCPError` 报错,工单号大小写都能用。写完用 Inspector CLI 各调一次。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/review41_dictation.py
"""练习 1 默写:一个工具、一个 resource、一个 prompt 的最小 server。"""
import sqlite3
from pathlib import Path
from typing import Annotated

from pydantic import Field

from mcp import MCPError
from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import INVALID_PARAMS, ToolAnnotations

DB_PATH = Path(__file__).resolve().parent.parent / "cloudledger" / "cloudledger.db"
mcp = MCPServer("dictation")


def find_ticket(ticket_id: str) -> sqlite3.Row | None:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT id, customer_id, subject, status FROM tickets WHERE id = ?", (ticket_id,)).fetchone()
    conn.close()
    return row


@mcp.tool(annotations=ToolAnnotations(read_only_hint=True))
def get_ticket(ticket_id: Annotated[str, Field(pattern=r"^T\d{4}$", description="工单号,如 T1041")]) -> dict:
    """按工单号查工单的客户、标题和状态。"""
    row = find_ticket(ticket_id)
    if row is None:
        raise ToolError(f"工单 {ticket_id} 不存在,现有工单号在 T1001 到 T1041 之间。")
    return dict(row)


@mcp.resource("cloudledger://policy/refund", mime_type="text/plain")
def refund_policy() -> str:
    """退款政策。"""
    return "1. 重复扣款:全额退还重复的那一笔。\n2. 月付不支持中途退款。\n3. 所有退款需主管审批。"


@mcp.prompt()
def reply_ticket(ticket_id: str) -> str:
    """处理一张工单的标准指令。"""
    row = find_ticket(ticket_id.upper())
    if row is None:
        raise MCPError(code=INVALID_PARAMS, message=f"工单 {ticket_id} 不存在")
    return f"请处理工单 {row['id']}(客户 {row['customer_id']},标题:{row['subject']})。先核实,再回复。"


if __name__ == "__main__":
    mcp.run()
```

<div class="line-notes">

- `from mcp import MCPError` 六个 import 是默写时最容易漏的地方,建议按「pydantic 一行、mcp 四行」记。
- `def find_ticket(ticket_id: str) -> sqlite3.Row | None:` 工具和 prompt 都要查工单,抽成一个普通函数。它不带装饰器,所以不会变成工具。
- `(ticket_id,)).fetchone()` 逗号不能省,下一题就是这个坑。
- `conn.close()` 没用 `with`,自己关。
- `@mcp.tool(annotations=ToolAnnotations(read_only_hint=True))` 只读提示。
- `def get_ticket(ticket_id: Annotated[str, Field(pattern=r"^T\d{4}$"` 大写 T 加四位数字。工具这边不做 `.upper()`,让 schema 去拦小写,模型读到错误会自己改。
- `raise ToolError(f"工单 {ticket_id} 不存在` 实测 T9999 得到 `Error executing tool get_ticket: 工单 T9999 不存在,现有工单号在 T1001 到 T1041 之间。`
- `return dict(row)` 返回类型写 `dict`,所以结果只在 `content` 里,没有 `structuredContent`。
- `@mcp.resource("cloudledger://policy/refund", mime_type="text/plain")` 地址、括号都要有。
- `row = find_ticket(ticket_id.upper())` prompt 是用户手敲的,宽容一点,大小写都认。
- `raise MCPError(code=INVALID_PARAMS` 让错误文字到达客户端。

</div>

```bash
npx -y @modelcontextprotocol/inspector@2.10.1 --cli uv run python part05/review41_dictation.py --method tools/call --tool-name get_ticket --tool-arg ticket_id=T1041
```

```text
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"id\": \"T1041\",\n  \"customer_id\": \"C007\",\n  \"subject\": \"重复扣款\",\n  \"status\": \"open\"\n}"
    }
  ],
  "isError": false
}
```

另外三条我也跑了:`ticket_id=T9999` 得到上面那句 ToolError,退出码 5;`prompts/get ... ticket_id=t1041` 得到 `请处理工单 T1041(客户 C007,标题:重复扣款)。先核实,再回复。`;`resources/read` 读出三条政策。basedpyright 0 报错。

</details>

**练习 2(找错):四个错误。** 下面这个 server 里藏了本周讲过的四类错误。先只用眼睛找,写下你认为的四处和各自会出现什么现象;然后真跑一遍验证,改好。

```python
# agent-zero-lab/part05/review41_buggy.py
"""练习 2:这个 server 里藏了四个本周讲过的错误,找出来。"""
import sqlite3
from pathlib import Path

from mcp.server import MCPServer

DB_PATH = Path(__file__).resolve().parent.parent / "cloudledger" / "cloudledger.db"
mcp = MCPServer("buggy")


@mcp.tool()
def get_invoice(invoice_id: str) -> dict | str:
    """按发票号查一张发票。"""
    print("looking up", invoice_id)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM invoices WHERE id = ?", (invoice_id)).fetchone()
    if row is None:
        return "错误:发票不存在"
    return dict(row)


@mcp.resource
def refund_policy() -> str:
    """退款政策。"""
    return "重复扣款全额退还重复的那一笔。"


if __name__ == "__main__":
    mcp.run()
```

<div class="line-notes">

- `def get_invoice(invoice_id: str) -> dict | str:` 返回类型里有 `str`,这本身就是个信号:这个函数打算用返回字符串的方式报错。
- `print("looking up", invoice_id)` stdio server 里的 print。
- `row = conn.execute("SELECT * FROM invoices WHERE id = ?", (invoice_id)).fetchone()` 看括号里那个参数。
- `return "错误:发票不存在"` 看它怎么报「找不到」。
- `@mcp.resource` 看装饰器。

</div>

<details><summary>参考答案</summary>

按真跑时暴露的顺序:

**错误一:`@mcp.resource` 没写地址。** 它在 import 时就炸,所以最先出现。用 Inspector CLI 跑 `--method tools/list`,stderr 是:

```text
TypeError: The @resource decorator was used incorrectly. Did you forget to call it? Use @resource('uri') instead of @resource
{"error":{"code":"error","message":"Connection closed"}}
```

改成 `@mcp.resource("cloudledger://policy/refund")`。

**错误二:`(invoice_id)` 不是元组。** 只修了错误一之后,调 `get_invoice` 查 `INV-2026-0123`,结果是:

```text
Error executing tool get_invoice
```

Results 里看不出原因(意外异常被 SDK 隐藏了),stderr 里是:

```text
ProgrammingError: Incorrect number of bindings supplied. The current statement uses 1, and there are 13 supplied.
```

`(invoice_id)` 只是加了括号的字符串,sqlite3 把它当成一串参数,`"INV-2026-0123"` 有 13 个字符,就是 13 个参数。有意思的是,我拿 `invoice_id=X` 试时这个 bug 没暴露:`"X"` 只有一个字符,碰巧凑够了 1 个参数。所以测试数据要用真实长度的值。改成 `(invoice_id,)`。

**错误三:用 return 字符串报「找不到」。** 还是那个 `invoice_id=X` 的调用,结果是:

```json
{
  "content": [{"type": "text", "text": "错误:发票不存在"}],
  "structuredContent": {"result": "错误:发票不存在"},
  "isError": false
}
```

`isError: false`,模型会以为调用成功,拿这句话当数据。改成 `raise ToolError(...)`,并在消息里写出下一步。

**错误四:stdio server 里 `print`。** 前三个都修好之后调用能成功,但 stdout 上多了一行 `looking up INV-2026-0123`。Day 285 练习 3 实测过,Python 客户端会报 `Failed to parse JSONRPC message from server`,Inspector 不吭声。改成 `logging`。

改好的版本:

```python
# agent-zero-lab/part05/review41_fixed.py
"""练习 2 参考答案:四处错误都改掉之后的 server。"""
import logging
import sqlite3
from pathlib import Path

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

DB_PATH = Path(__file__).resolve().parent.parent / "cloudledger" / "cloudledger.db"
log = logging.getLogger("fixed")
mcp = MCPServer("fixed")


@mcp.tool()
def get_invoice(invoice_id: str) -> dict:
    """按发票号查一张发票。"""
    log.info("looking up %s", invoice_id)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM invoices WHERE id = ?", (invoice_id,)).fetchone()
    if row is None:
        raise ToolError(f"发票 {invoice_id} 不存在。发票号形如 INV-2026-0123,可以先用 list_invoices 查。")
    return dict(row)


@mcp.resource("cloudledger://policy/refund")
def refund_policy() -> str:
    """退款政策。"""
    return "重复扣款全额退还重复的那一笔。"


if __name__ == "__main__":
    mcp.run()
```

<div class="line-notes">

- `import logging` 换掉 print。
- `from mcp.server.mcpserver.exceptions import ToolError` 新增的 import。
- `def get_invoice(invoice_id: str) -> dict:` 返回类型去掉了 `str`,错误不再走返回值。
- `log.info("looking up %s", invoice_id)` 写到 stderr。
- `(invoice_id,)).fetchone()` 补上逗号。
- `raise ToolError(f"发票 {invoice_id} 不存在。` 实测 `invoice_id=X` 得到 `isError: true`,文字 `Error executing tool get_invoice: 发票 X 不存在。发票号形如 INV-2026-0123,可以先用 list_invoices 查。`,退出码 5。
- `@mcp.resource("cloudledger://policy/refund")` 补上地址。没写 `mime_type`,实测 `resources/list` 里自动是 `text/plain`。

</div>

查 `INV-2026-0123` 的实测结果是 `isError: false`,内容 `{"id": "INV-2026-0123", "customer_id": "C007", "subscription_id": "S007", "amount_cents": 239200, "status": "paid", "issued_at": "2026-10-08", "paid_at": "2026-10-08"}`。

</details>

**练习 3(观察会发生什么):有没有 structuredContent。** 用 Inspector CLI 分别调小项目的 `quote_price`(返回 `Quote` TypedDict)和 `create_upgrade_request`(返回 `dict`),对比两个结果里有没有 `structuredContent`,再用 `--method tools/list` 看两个工具哪个有 `outputSchema`。解释原因。

<details><summary>参考答案</summary>

```bash
uv run python cloudledger/seed.py
npx -y @modelcontextprotocol/inspector@2.10.1 --cli uv run python part05/review41_quote_server.py --method tools/call --tool-name quote_price --tool-arg plan=企业版 seats=8 billing_cycle=yearly
npx -y @modelcontextprotocol/inspector@2.10.1 --cli uv run python part05/review41_quote_server.py --method tools/call --tool-name create_upgrade_request --tool-arg customer_id=C009 to_plan=专业版
```

<div class="line-notes">

- `uv run python cloudledger/seed.py` 先重置,否则 C009 那条可能因为上次的申请被拦。
- `--tool-name quote_price` 返回 TypedDict 的工具。
- `--tool-name create_upgrade_request` 返回裸 `dict` 的工具。

</div>

`quote_price` 的结果:

```json
{
  "content": [{"type": "text", "text": "{\n  \"plan\": \"企业版\",\n  \"seats\": 8,\n  \"billing_cycle\": \"yearly\",\n  \"amount_yuan\": \"28704.00\"\n}"}],
  "structuredContent": {"plan": "企业版", "seats": 8, "billing_cycle": "yearly", "amount_yuan": "28704.00"},
  "isError": false
}
```

`create_upgrade_request` 的结果只有 `content`,文本是 `{"upgrade_request_id": 1, "from_plan": "基础版", "to_plan": "专业版", "status": "pending_review"}`,没有 `structuredContent`。`tools/list` 里也一样,`quote_price` 有 `outputSchema`(四个字段和类型),`create_upgrade_request` 没有。

原因是 SDK 根据返回类型标注生成 outputSchema:`Quote` 是 TypedDict,字段和类型都知道;裸 `dict` 什么都不知道,SDK 就不声明结构,结果只当文本给。练习 1 里的 `get_ticket` 也是这样。要让程序(而不是模型)可靠地读结果,比如后面做评测时断言 `status == "pending_review"`,就该给返回值写 TypedDict。改法是加一个 `class UpgradeRequest(TypedDict)`,把 `-> dict` 换成 `-> UpgradeRequest`。

</details>

**练习 4(开放题):给你自己的坑加一条检查。** 从「本周错题与坑清单」里挑一条你自己真踩过的,给 Day 285 的 `part05/smoke_cloudledger.sh` 加一条能抓住它的检查。

<details><summary>参考答案</summary>

示范:我挑「CLI 里 `customer_id=7` 被当成数字」这条。它不是 server 的 bug,但它提醒我:要测「编号格式不对」这条规则,必须确保传进去的真是字符串,否则测到的是类型校验,不是正则。加一行:

```bash
check 5 "字符串 7 被正则拦"  --method tools/call --tool-name get_subscription --tool-arg 'customer_id="7"'
```

<div class="line-notes">

- `--tool-arg 'customer_id="7"'` 外层单引号给 shell,里面的双引号让 CLI 把值解析成 JSON 字符串 `"7"`。

</div>

我实跑这条调用,stdout 里的错误是 `String should match pattern '^C\d{3}$' [type=string_pattern_mismatch, input_value='7', input_type=str]`,退出码 5,所以这条检查 PASS。改之前用 `customer_id=7`,报的是 `Input should be a valid string ... input_type=int`,退出码同样是 5,检查也会 PASS,但测的根本不是同一件事。这就是只看退出码的局限:退出码对了不代表原因对了。要更精确,得把 stdout 存下来再判断里面有没有 `string_pattern_mismatch`,那是 Day 287 用 pytest 写断言时更顺手的事。

</details>

验收标准:练习 1 合上文章写完能跑通;`bash part05/review41_smoke.sh` 九条全 PASS;能不看表说出三种原语出错时各走哪条路、Inspector CLI 各返回什么退出码。

## 名词解释

本周第一次出现的术语都在各天的表里,这里只收复习时最容易混的几个,和今天新出现的。

| 名词 | 意思 |
| --- | --- |
| `ToolError` | 工具里抛的「可改正」错误,变成 `isError: true` 的正常结果,文字给模型看(Day 282) |
| `MCPError` | 带 JSON-RPC 错误码的异常,resource 和 prompt 里用它把错误文字交给客户端(Day 284) |
| `isError` | 工具结果里的布尔字段,true 表示工具失败但请求本身成功(Day 282) |
| `ToolAnnotations` | 工具上的读写行为提示:只读、破坏性、幂等、是否访问外部,只是提示不是权限(Day 283) |
| outputSchema / structuredContent | 返回类型写成 TypedDict 时 SDK 生成的输出结构,以及按它给出的结构化结果(Day 281) |
| resource template | 地址里带 `{占位}` 的 resource,单独在 `resources/templates/list` 里(Day 284) |
| 类型别名 | 给一个类型起名字复用,`Plan = Literal[...]`,相当于 TS 的 `type Plan = ...` |
| `CREATE TABLE IF NOT EXISTS` | 表不存在才建,存在就跳过,可以安全地重复执行 |
| 跨字段规则 | 一个参数是否合法取决于另一个参数,比如「企业版至少 2 席」,schema 表达不了,写在函数里 |
| 冒烟测试 / 验收脚本 | 只测关键路径通不通的快速检查,今天用 Inspector CLI 的退出码写成(Day 285) |

## 常见误区

**以为复习日可以只看不写。** 这周的代码看着都眼熟,合上文章写时最容易漏的是那几行 import(`MCPError`、`INVALID_PARAMS` 各在哪个模块),以及地址的写法。我专门试了一下把地址写成 `cloudledger:/policy/refund`(少一个斜杠),SDK 照样注册成功,不报任何错,只是这个地址和你以为的那个对不上,客户端按两个斜杠读就是 `Unknown resource`。练习 1 一定要动手。

**在 prompt 的参数上用 `Literal` 做校验。** prompt 参数只能是字符串,类型标注写成 `Plan` 也没有 schema 校验的效果。小项目里 `quote_reply` 是在函数体里自己 `if to_plan not in PLANS` 检查的。

**`annotations` 标了 `idempotent_hint=False` 就以为不会重复。** 那只是告诉 host「重复调用会产生重复记录」。小项目里真正防重复的是查 `pending_review` 的那几行。

**只看退出码判断测试对不对。** 练习 4 实测,`customer_id=7` 和 `customer_id="7"` 退出码都是 5,原因完全不同。

**测试数据太短。** 练习 2 里 `(invoice_id)` 少逗号的 bug,用 `invoice_id=X` 测不出来,因为单个字符碰巧凑够 1 个参数。用真实长度的发票号才暴露。

**验收脚本不重置库。** 小项目里「C009 升专业版」第一次 PASS,第二次跑就因为上次留下的申请变成退出码 5。脚本开头先跑 seed.py。

## 学习资料

### 文档与文章

- [MCP 规范 2026-07-28 · Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools):复习 `isError`、outputSchema、structuredContent 的原始定义,和练习 3 对照着看。
- [MCP 规范 2026-07-28 · Resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources) 和 [Prompts](https://modelcontextprotocol.io/specification/2026-07-28/server/prompts):重点看两页的 Error Handling 部分,和本周那张「出错走哪条路」的表一一对上。
- [MCP 官方 · Build an MCP server](https://modelcontextprotocol.io/docs/develop/build-server):官方的完整入门教程(天气 server),用它当一次「换个例子从头写一遍」的练习。
- [JSON-RPC 2.0 规范](https://www.jsonrpc.org/specification):-32602、-32603 这些错误码的出处,第 5.1 节那张表。
- [Inspector · Smoke-testing an MCP server](https://github.com/modelcontextprotocol/inspector/blob/main/docs/cli-smoke-testing.md):写验收脚本时的参考,里面还有用 `jq` 检查输出内容的写法,能解决练习 4 说的「只看退出码」的局限。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1uronYREWR&autoplay=0&high_quality=1" title="MCP终极指南 - 从原理到实战,带你深入掌握MCP(基础篇)" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>马克的技术工作坊 · MCP 终极指南(基础篇)· 27 分钟,播放量 30 万。复习日适合从头到尾看一遍,用别人的讲法再过一次 host、client、server 和工具调用的全过程。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1RNTtzMENj&autoplay=0&high_quality=1" title="从零编写MCP并发布上线,超简单!手把手教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>技术爬爬虾 · 从零编写 MCP 并发布上线 · 16 分钟,2025 年 6 月。标题是从零编写到发布上线,今天看写 server 的部分;发布上线那部分对应 Day 290 的远程 server,到时候再回来看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/cGuyrANVi4A" title="How Model Context Protocol (MCP) actually works" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Google Cloud Tech · How Model Context Protocol (MCP) actually works · 英文。讲 MCP 线上到底发生了什么,复习完这周再看,能对上 Inspector Protocol 面板里那些消息。</figcaption>
</figure>

### 书籍

- Christoffer Noring,《Learn Model Context Protocol with Python》,Packt,2025。复习时翻 server 端那几章,对照它的例子检查自己对三种原语的理解;书基于 1.x SDK,类名按迁移指南换。

### 开源项目与代码

- [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers):官方参考 server 合集。挑一个(比如 `src/everything`),只看它怎么命名工具、怎么写描述和错误信息,和本周的写法对比。
- [modelcontextprotocol/python-sdk](https://github.com/modelcontextprotocol/python-sdk):`tests/` 目录里有大量 server 的测试写法,是 Day 287 内存客户端测试的预习材料。

## 自测

1. 下面三种写法,模型分别会看到什么?`return "客户不存在"`、`raise ToolError("客户不存在,换成邮箱再试")`、`raise KeyError("C099")`。

<details><summary>答案</summary>

第一种:`isError: false`,内容是「客户不存在」,模型当成正常数据,可能顺着编答案。第二种:`isError: true`,内容是 `Error executing tool xxx: 客户不存在,换成邮箱再试`,模型知道失败了也知道怎么改。第三种:`isError: true`,内容只有 `Error executing tool xxx`,`KeyError` 的细节只在 server 的 stderr 里。

</details>

2. 小项目的 `quote_price` 里,「企业版至少 2 席」为什么不写进 `Field(ge=2)`?

<details><summary>答案</summary>

因为下限取决于另一个参数 `plan`:基础版和专业版 1 席就行,只有企业版要 2 席。`Field` 的约束只作用于单个参数,表达不了这种跨字段规则,只能在函数体里判断,再用 `ToolError` 把出路告诉模型。

</details>

3. 同一个 server 里,一个 prompt 引用了另一个 server 才有的工具 `get_subscription`。这能工作吗?

<details><summary>答案</summary>

能,只要 host 同时接了两个 server。prompt 只是一段文字,server 不检查里面提到的工具在不在;模型拿到这段指令后,会在 host 汇总的全部工具里找 `get_subscription`。但如果用户只接了报价 server,模型就找不到这个工具。实测单独对报价 server 调它,Inspector CLI 报 `Tool 'get_subscription' not found on server.`

</details>

4. `(invoice_id)` 少了逗号,为什么用 `INV-2026-0123` 测会报错,用 `X` 测却正常?

<details><summary>答案</summary>

`(invoice_id)` 就是字符串本身,sqlite3 把字符串当成一个序列,每个字符算一个参数。`INV-2026-0123` 有 13 个字符,SQL 只有 1 个 `?`,所以报 `Incorrect number of bindings supplied. The current statement uses 1, and there are 13 supplied.`;`X` 只有 1 个字符,碰巧数量对上,查询能执行。

</details>

5. 面试题:你要给公司的计费系统写一个 MCP server 给客服 Agent 用。说说你会怎么设计工具的权限边界和错误信息,以及上线前怎么验证。

<details><summary>答案</summary>

权限边界:读操作做成只读工具,参数用 schema 约束格式和范围(编号正则、枚举、数量上限);写操作只开「提交申请」这一种,状态在 SQL 里写死成待审批,金额做额度校验和防重复,真正执行留给人审批;`ToolAnnotations` 标清读写和幂等性,但不把它当安全机制。错误信息:可改正的错误用 `ToolError` 写清原因和下一步(比如「最多还能申请 0.00 元」),意外异常不把内部细节给模型,只写进日志;resource 和 prompt 的错误用带错误码的 JSON-RPC 错误。验证:先在 Inspector 里手动走一遍每个工具的正常和异常路径,看 Console 有没有 traceback;再把关键路径写成冒烟脚本(CLI 退出码)放进 CI;更细的用例用内存客户端加 pytest 写断言;最后接进真实 host 用自然语言跑几个典型工单。

</details>

## 明天预告

Day 287 · 写 MCP server(七):用内存客户端写测试。这周的验收都是从外面测:Inspector 拉起子进程,每条检查十几秒到几十秒不等,而且只能看退出码,练习 4 已经看到它分不清两种不同原因的失败。明天把 server 对象直接交给 `Client`,两者在同一个进程里通信,不起子进程、不开端口,用 pytest 写能断言具体字段和文字的测试,省掉每条检查都重启 server 的时间。
