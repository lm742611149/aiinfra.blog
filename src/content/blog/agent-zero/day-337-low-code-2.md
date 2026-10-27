---
title: 'Day 337 · 低代码平台(二):接自有系统、跑评测,什么时候改成写代码'
description: '昨天的分流流程还是个孤岛。今天写一个只读的 HTTP 接口把 CloudLedger 的发票接给 n8n,撞一次 localhost 连不上、一次一张工单跑出六次模型调用;再用同一份 12 条用例给代码版和 n8n 版打分,看评测怎么抓出画布上全绿的错;最后给一张带今天证据的「什么时候该改成写代码」判断表。'
pubDate: 2026-10-27
regime: none
tags: ['low-code', 'n8n', 'evaluation', 'python', 'agent-zero']
series: 'agent-zero'
day: 337
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 336](/blog/agent-zero/day-336-low-code-1/) 把 Dify、扣子、百炼、n8n 在 2026 年 10 月的状态查了一遍,又把同一个工单分流流程写成 31 行 Python、画成 n8n 的 10 个节点。两边花的钱一样(输出 token 都是开着思考的 252),差别在别处:n8n 的 DeepSeek 节点没有关思考的开关;画布上所有节点全绿,类别却全错成了 `other`;重新导入工作流会让它变成未发布。

昨天那个流程还是个孤岛:它回复客户时看不到客户的真实发票。今天先把自己的数据接给平台,再用评测集给两边打分,最后回答最常被问的那个问题:什么时候该从平台改成写代码。

## 今天要解决的问题

学完今天,你要能做到:

1. 写一个只读的 HTTP 接口,把 CloudLedger 的工单和发票接给 n8n 的 HTTP Request 节点,令牌放凭据里、不放节点里。
2. 亲手撞出并修好两个接入的坑:`localhost` 在 n8n 里连不上自己的接口;接口返回一个数组,后面的模型节点被跑了好几遍。
3. 用同一份 12 条用例给代码版和 n8n 版打分,并说清楚评测怎么抓住「画布上全绿但是错了」和「有人把提示词改坏了」。
4. 用一张判断表回答「这件事该放在平台上还是写代码」,并说出迁移的四步。

预计用时 3.5 小时。前置:[Day 336](/blog/agent-zero/day-336-low-code-1/) 的全部(`triage_code.py`、`time_compare.py`、n8n 里的工作流),[Day 280](/blog/agent-zero/day-280-mcp-seed/) 的 `cloudledger.db`,[Day 326](/blog/agent-zero/day-326-ambient-2/) 的 webhook 和幂等的概念。今天调模型的实跑:评测一遍 12 条,代码版关思考约 0.0125 元、开思考约 0.0345 元,n8n 版按未命中价算上限约 0.036 元;我为了抓错又跑了两个故意改坏的版本,每个约 0.036 元,整份跑下来约 0.15 元。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `fetch_invoices()` 和评测脚本里的三个检查默写出来;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 平台怎么读到你的数据

平台搭的流程迟早要读你们自己的数据。常见的有两条路:给平台一个 HTTP 接口,或者给它一个 MCP server。

HTTP 接口是最通用的:Dify、扣子、百炼、n8n 都有「HTTP 请求」节点。FastAPI 还会自动生成 OpenAPI 文档(`/openapi.json`),旧课里的说法是 Dify 和扣子能直接导入这样的文档生成自定义工具,这一点我这次没有核对。MCP 的好处是同一套工具不只给一个平台用,Claude Code、你自己的 Agent 也能接,n8n 有 MCP Client Tool 和 MCP Server Trigger 两个节点(我在装好的包里看到了这两个目录),Dify 从 1.6 版起支持双向 MCP,[官方博客](https://dify.ai/blog/v1-6-0-built-in-two-way-mcp-support)的标题就叫 built-in two-way MCP support。这两句我都没有实跑,今天只走 HTTP 这条路,MCP 版本放在文末的判断表里。

先写接口。它只做两件事:按工单号查工单,按客户号查最近的发票。全部只读。

```python
# agent-zero-lab/part05/lowcode/cloudledger_api.py
"""给低代码平台的「HTTP 请求」节点调用的只读接口:查工单、查客户最近的发票。
运行(在 agent-zero-lab 根目录):PLATFORM_TOKEN=dev-token-123 uv run uvicorn part05.lowcode.cloudledger_api:app --port 8140
"""
import os
import sqlite3
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException

DB = Path(__file__).parents[2] / "cloudledger" / "cloudledger.db"
TOKEN = os.environ.get("PLATFORM_TOKEN", "")

app = FastAPI(title="CloudLedger read-only API")


def auth(authorization: str = Header(default="")) -> None:
    if not TOKEN or authorization != f"Bearer {TOKEN}":
        raise HTTPException(401, "bad token")


def query(sql: str, *args: object) -> list[dict]:
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)  # 只读打开:平台那边的 SQL 写错了也改不了库
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute(sql, args).fetchall()]
    finally:
        conn.close()


@app.get("/tickets/{ticket_id}", dependencies=[Depends(auth)])
def get_ticket(ticket_id: str) -> dict:
    rows = query("SELECT id, customer_id, subject, body, status FROM tickets WHERE id = ?", ticket_id)
    if not rows:
        raise HTTPException(404, "ticket not found")
    return rows[0]


@app.get("/customers/{customer_id}/invoices", dependencies=[Depends(auth)])
def list_invoices(customer_id: str, limit: int = 5) -> list[dict]:
    return query(
        "SELECT id, amount_cents, status, issued_at FROM invoices WHERE customer_id = ? "
        "ORDER BY issued_at DESC, id DESC LIMIT ?",
        customer_id, max(1, min(limit, 20)),
    )
```

<div class="line-notes">

- `DB = Path(__file__).parents[2] / "cloudledger" / "cloudledger.db"` 从 `part05/lowcode/cloudledger_api.py` 往上数两层是仓库根目录,再进 `cloudledger/` 找 Day 280 造出来的库。
- `TOKEN = os.environ.get("PLATFORM_TOKEN", "")` 令牌从环境变量读,代码里不写默认值。没设就是空字符串,下一个函数会因此拒绝所有请求。
- `app = FastAPI(title="CloudLedger read-only API")` 一个 FastAPI 应用,相当于 Express 里的 `const app = express()`。
- `def auth(authorization: str = Header(default="")) -> None:` 从请求头取 `Authorization` 的值。FastAPI 把参数名里的下划线对应到请求头的连字符,所以 `authorization` 就是 `Authorization` 头。
- `if not TOKEN or authorization != f"Bearer {TOKEN}":` 服务端没设令牌,或者客户端带的不是 `Bearer ` 加令牌,都拒绝。令牌是 `dev-token-123` 时,合法的头是 `Authorization: Bearer dev-token-123`。
- `raise HTTPException(401, "bad token")` 返回 401 和 `{"detail":"bad token"}`。
- `def query(sql: str, *args: object) -> list[dict]:` 一个小工具:执行查询,把每一行变成字典。`*args` 是 SQL 里 `?` 占位符对应的值,用占位符而不是字符串拼接,避免 SQL 注入。
- `conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)` **只读打开**。就算平台那头的人把提示词或请求写坏了,最多读错数据,改不了库。
- `conn.row_factory = sqlite3.Row` 让每一行能按列名取值,下一行的 `dict(r)` 才能转成字典。
- `return [dict(r) for r in conn.execute(sql, args).fetchall()]` 执行、取全部行、转成字典列表。
- `conn.close()` 放在 `finally` 里,不管查询成功还是抛异常都关连接。
- `@app.get("/tickets/{ticket_id}", dependencies=[Depends(auth)])` 路由:`GET /tickets/T1008`,并且先过 `auth`。`dependencies=` 让这个检查在函数体之前运行,每个路由都要写,忘了写的那个就是敞开的。
- `rows = query("SELECT id, customer_id, subject, body, status FROM tickets WHERE id = ?", ticket_id)` 只选这几列,不是 `SELECT *`:不想暴露的字段(比如以后加的内部备注)不会被带出去。
- `raise HTTPException(404, "ticket not found")` 工单不存在返回 404,调用方能区分「没有」和「出错」。
- `def list_invoices(customer_id: str, limit: int = 5) -> list[dict]:` `limit` 是查询参数,`?limit=2` 取最近两张。
- `"ORDER BY issued_at DESC, id DESC LIMIT ?",` 按开票日从新到旧,同一天的按发票号倒序。C007 在 10 月 8 日有两张 2392 元的发票,所以 `INV-2026-0123` 排在 `INV-2026-0026` 前面。
- `customer_id, max(1, min(limit, 20)),` 不管调用方传多大的 `limit`,最多返回 20 行,最少 1 行。这是服务端自己的上限,不靠平台那边的提示词遵守。

</div>

在练习仓库根目录起服务,另开一个终端试:

```bash
cd ~/agent-zero-lab
uv add fastapi uvicorn httpx
PLATFORM_TOKEN=dev-token-123 uv run uvicorn part05.lowcode.cloudledger_api:app --port 8140
```

```bash
curl -s localhost:8140/tickets/T1008
curl -s -H "Authorization: Bearer dev-token-123" localhost:8140/tickets/T1008
curl -s -H "Authorization: Bearer dev-token-123" "localhost:8140/customers/C007/invoices?limit=2"
curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer dev-token-123" localhost:8140/tickets/T9999
```

```text
$ curl -s localhost:8140/tickets/T1008
{"detail":"bad token"}
$ curl -s -H "Authorization: Bearer dev-token-123" localhost:8140/tickets/T1008
{"id":"T1008","customer_id":"C005","subject":"发票抬头修改","body":"上个月的发票抬头写错了,应该是「启明科技有限公司」,能重开吗?","status":"open"}
$ curl -s -H "Authorization: Bearer dev-token-123" "localhost:8140/customers/C007/invoices?limit=2"
[{"id":"INV-2026-0123","amount_cents":239200,"status":"paid","issued_at":"2026-10-08"},{"id":"INV-2026-0026","amount_cents":239200,"status":"paid","issued_at":"2026-10-08"}]
$ curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer dev-token-123" localhost:8140/tickets/T9999
404
```

没带令牌被拒,带了令牌拿到工单,发票是 C007 刘静那两张重复的,不存在的工单返回 404。再验证「只读」是真的:

```bash
uv run python - <<'PY'
import sqlite3
conn = sqlite3.connect("file:cloudledger/cloudledger.db?mode=ro", uri=True)
conn.execute("UPDATE invoices SET status='void' WHERE id='INV-2026-0123'")
PY
```

```text
sqlite3.OperationalError: attempt to write a readonly database
```

**写操作不要直接开给平台。** 退款、改订阅这类有后果的动作,要么根本不暴露,要么只允许「创建一条待审批的申请」,真正执行那一步留在你自己的系统里、由人批。原因很实际:平台上的提示词谁都能改,你没法对它做 code review。

## 接进 n8n:两个新节点,两个坑

流程要加两个节点:在 `Finance?` 的「是」那一侧,先用 **HTTP Request** 节点去查客户最近的发票,再用 **Aggregate** 节点把结果合成一条,最后才交给 `Reply (finance)`。

| 节点 | 类型 | 关键设置 |
| --- | --- | --- |
| Invoices | HTTP Request | GET,地址 `http://127.0.0.1:8140/customers/{{ $('Webhook').item.json.body.customer_id }}/invoices`,查询参数 `limit=5`,认证选「Generic Credential Type」里的 Header Auth |
| Aggregate | Aggregate | 模式选「所有条目数据合并成一个字段」,字段名 `invoices` |
| Reply (finance) | Basic LLM Chain | System 换成带发票的 `FINANCE_PROMPT_V2`;用户消息是 `{{ ticket_text + '\n\n最近发票:' + JSON.stringify($json.invoices) }}` |

令牌放在 n8n 的凭据里:新建一个 Header Auth 凭据,名字 `Authorization`,值 `Bearer dev-token-123`。节点里只引用这个凭据的名字。Webhook 的请求体多了一个字段 `customer_id`,路径也换成 `triage2`,免得和昨天的 `triage` 冲突。

我同样是用脚本生成导入文件再用命令行导入的,没有在界面里点,这一点和昨天一样。上面那个地址里写的是 `127.0.0.1`,不是 `localhost`,原因就是第一个坑。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="n8n 工作流里 Invoices、Aggregate、Reply 三个节点,Invoices 通过 GET 加令牌访问只读接口,接口只读打开 SQLite 库;接口返回的 5 张发票在 n8n 里被拆成 5 个 item,Aggregate 合成 1 个">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
  <text x="14" y="22" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">n8n(平台)</text>
  <text x="396" y="22" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">你自己的系统</text>
  <g font-family="var(--font-mono)" font-size="11" text-anchor="middle">
    <rect x="14" y="34" width="92" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="60" y="55" fill="var(--ink)">Invoices</text>
    <rect x="134" y="34" width="92" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
    <text x="180" y="55" fill="var(--ink)">Aggregate</text>
    <rect x="254" y="34" width="100" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="304" y="55" fill="var(--ink)">Reply (finance)</text>
    <rect x="396" y="34" width="120" height="60" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="456" y="54" fill="var(--ink)">cloudledger_api</text>
    <text x="456" y="70" font-size="10" fill="var(--ink-soft)">验令牌</text>
    <text x="456" y="84" font-size="10" fill="var(--ink-soft)">只读 SQL</text>
    <rect x="540" y="34" width="86" height="60" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
    <text x="583" y="58" fill="var(--ink)">cloudledger</text>
    <text x="583" y="74" font-size="10" fill="var(--ink-soft)">.db  mode=ro</text>
  </g>
  <g stroke="var(--ink-soft)" fill="none">
    <line x1="106" y1="51" x2="134" y2="51"/><line x1="226" y1="51" x2="254" y2="51"/>
    <line x1="516" y1="64" x2="540" y2="64"/>
    <polyline points="60,34 60,14 456,14 456,34"/>
  </g>
  <text x="170" y="11" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">GET http://127.0.0.1:8140/customers/C007/invoices   Authorization: Bearer 令牌(存在凭据里)</text>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">
    <rect x="22" y="112" width="14" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <rect x="40" y="112" width="14" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <rect x="58" y="112" width="14" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <rect x="76" y="112" width="14" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <rect x="94" y="112" width="14" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="64" y="152">5 条 item(一张发票一条)</text>
    <rect x="172" y="112" width="48" height="22" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
    <text x="196" y="152">1 条 item(invoices 数组)</text>
  </g>
  <g stroke="var(--ink-faint)" stroke-dasharray="3 3" fill="none">
    <line x1="60" y1="68" x2="64" y2="112"/><line x1="180" y1="68" x2="196" y2="112"/>
  </g>
  <text x="14" y="184" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">没有 Aggregate:Reply 对 5 条 item 各跑一次,共 6 次模型调用,每次只看见一张发票</text>
  <text x="14" y="204" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">有 Aggregate:Reply 只跑一次,共 2 次模型调用,两张重复的发票都看得见</text>
  <text x="14" y="232" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">琥珀 = 外部入口和你的系统,蓝 = 调模型</text>
</svg>
<figcaption>上面一排是调用链:令牌在 n8n 的凭据里,接口只读打开数据库。下面是第二个坑:数组在 n8n 里被拆成多条 item,要用 Aggregate 合回一条。</figcaption>
</figure>

### 坑一:curl 能通,n8n 说连接被拒

我最初写的地址是 `http://localhost:8140/...`。接口明明在跑、`curl` 也通,第一次发请求时 n8n 返回的却是 `{"message":"Error in workflow"}`。点进执行记录,出错的是 `Invoices` 节点:

```text
Webhook              success 
DeepSeek (classify)  success 
Classify             success 
Parse category       success 
Finance?             success 
Invoices             error | The service refused the connection - perhaps it is offline | undefined | http://localhost:8140/customers/C007/invoices
```

`The service refused the connection - perhaps it is offline`,连接被拒绝,地址是 `localhost:8140`。服务没挂,那是谁拒绝的?我查了两件事:

```text
$ node -e "require('dns').lookup('localhost',{all:true},(e,a)=>console.log(JSON.stringify(a)))"
[{"address":"::1","family":6},{"address":"127.0.0.1","family":4}]
$ lsof -nP -iTCP:8140 -sTCP:LISTEN
COMMAND     PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
python3.1 24285 minliu    6u  IPv4 0xcab627a691e2d9e9      0t0  TCP 127.0.0.1:8140 (LISTEN)
```

`localhost` 解析出两个地址,**先是 `::1`(IPv6),后才是 `127.0.0.1`(IPv4)**。uvicorn 默认只监听 `127.0.0.1`,不监听 `::1`。`curl` 会在 `::1` 失败后自动换 IPv4 重试,所以它能通;n8n 的 HTTP 请求节点拿到第一个地址就去连,被拒绝就报错。我把 URL 里的 `localhost` 换成 `127.0.0.1` 以后,同一个请求立刻通了。这是我从「换地址就好」和上面两条输出推断的原因,没有去读 n8n 的源码确认它的解析逻辑。

两个相关的提醒,我都没有实跑。第一,如果 n8n 在 Docker 容器里,容器里的 `localhost` 指的是容器自己,要访问宿主机上的接口,Docker Desktop 用的主机名是 `host.docker.internal`。第二,如果用的是平台的云版(Dify 云、扣子、n8n 云),它们跑在公网上,根本访问不到你电脑上的 `localhost`。学习时可以用 Cloudflare 的 Quick Tunnel 临时开一个公网地址指向本机端口,但这个地址是公开的,令牌一定要换成强的;真正上线是把接口部署到公网或内网,平台到接口之间走 HTTPS 加令牌,能加 IP 白名单更好。

### 坑二:一张工单,模型被调了六次

修好地址以后,我最初画的是 `Invoices` 后面直接接 `Reply (finance)`,没有 Aggregate。发同一张退款工单,回复是:

```text
好的，我这边先为您登记。您提到的 **INV-2026-0123**（金额 2392 元，状态为已支付）在我们系统里可以查到；另一笔发票**不在**我手上的清单中，我会一并请财务核实，确认是否真的存在重复扣款。……
```

不对:`INV-2026-0026` 明明在库里。去看这次执行每个节点跑了几次、出了几条数据:

```text
== 执行 8
Webhook                runs 1 items 1
DeepSeek (classify)    runs 1 items 0
Classify               runs 1 items 1
Parse category         runs 1 items 1
Finance?               runs 1 items 1
Invoices               runs 1 items 5
DeepSeek (finance)     runs 5 items 0,0,0,0,0
Reply (finance)        runs 1 items 5
Respond                runs 1 items 5
LLM calls 6 prompt 982 completion 1484
== 执行 9
Webhook                runs 1 items 1
DeepSeek (classify)    runs 1 items 0
Classify               runs 1 items 1
Parse category         runs 1 items 1
Finance?               runs 1 items 1
Invoices               runs 1 items 5
Aggregate              runs 1 items 1
DeepSeek (finance)     runs 1 items 0
Reply (finance)        runs 1 items 1
Respond                runs 1 items 1
LLM calls 2 prompt 475 completion 426
```

上半是没有 Aggregate 的那次(执行 8)。接口返回的是一个有 5 张发票的**数组**,n8n 的数据模型是「一条条 item」,HTTP 节点把数组拆成了 5 个 item,后面的模型节点对**每个 item 各跑一遍**:`DeepSeek (finance)` 跑了 5 次,加上分类那次一共 6 次模型调用,输出 1484 个 token。而且每次它只看得到一张发票,所以才会说「另一笔发票不在我手上的清单中」。下半是加了 Aggregate 的那次(执行 9):5 个 item 合成 1 个,模型只跑 1 次,总共 2 次调用、输出 426 个 token,回复里两张发票号都对:

```text
您反馈的 10 月 8 日两笔扣款我已记录，涉及发票 INV-2026-0026 和 INV-2026-0123。我会请财务核对这两张发票对应的实际扣款记录，确认是否属于重复扣款。核实结果和处理方案出来后会第一时间同步给您。
```

这个坑是画布的特有现象:同样的数据,代码里是 `invoices = r.json()` 一个列表,整个交给模型;画布里「数组」会悄悄变成「多条数据」,后面每个节点都要跑多遍。你得知道平台的数据模型是什么,不然账单和回复会一起出问题。

### 代码版怎么写

对照一下,代码版是在昨天的 `triage_code.py` 上加一个新文件,复用 `classify()` 和 `OTHER_PROMPT`,只多了查发票这一步:

```python
# agent-zero-lab/part05/lowcode/triage_code2.py
"""Day 337:在 Day 336 的 triage_code.py 上加一步,财务类工单先去只读接口查客户最近的发票,再起草回复。
先在另一个终端起接口:PLATFORM_TOKEN=dev-token-123 uv run uvicorn part05.lowcode.cloudledger_api:app --port 8140
运行:PLATFORM_TOKEN=dev-token-123 uv run python -m part05.lowcode.triage_code2 C007 "10 月 8 号被扣了两次款,把多扣的退给我"
"""
import json
import os
import sys

import httpx

from common.llm import LLMClient
from part05.lowcode.triage_code import OTHER_PROMPT, classify

API = os.environ.get("CLOUDLEDGER_API", "http://localhost:8140")
TOKEN = os.environ.get("PLATFORM_TOKEN", "")  # 令牌只从环境变量读,代码里不留默认值
FINANCE_PROMPT_V2 = (
    "你是云簿客服。这是财务类工单,下面附了该客户最近的发票(JSON)。用两三句话回复客户:"
    "说明你会请财务核对;提到发票时,发票号必须来自这份列表;不要承诺具体金额和到账时间。"
)


def fetch_invoices(customer_id: str, limit: int = 5) -> list[dict]:
    if not TOKEN:
        raise RuntimeError("先设置环境变量 PLATFORM_TOKEN(和起接口时用的是同一个值)")
    r = httpx.get(
        f"{API}/customers/{customer_id}/invoices",
        params={"limit": limit},
        headers={"Authorization": f"Bearer {TOKEN}"},
        timeout=10,
    )
    r.raise_for_status()  # 401、404 直接抛出来,别让模型对着空数据编
    return r.json()


def triage2(client: LLMClient, text: str, customer_id: str) -> dict[str, str]:
    category = classify(client, text)
    if category in ("refund", "billing", "invoice"):
        invoices = fetch_invoices(customer_id)
        user = f"{text}\n\n最近发票:{json.dumps(invoices, ensure_ascii=False)}"
        system = FINANCE_PROMPT_V2
    else:
        user, system = text, OTHER_PROMPT
    r = client.chat([{"role": "system", "content": system}, {"role": "user", "content": user}], temperature=0.3)
    return {"category": category, "reply": r.content}


if __name__ == "__main__":
    llm = LLMClient()
    print(json.dumps(triage2(llm, sys.argv[2], sys.argv[1]), ensure_ascii=False, indent=2))
    print(llm.ledger)
```

<div class="line-notes">

- `API = os.environ.get("CLOUDLEDGER_API", "http://localhost:8140")` 接口地址。这里用 `localhost` 没事,因为 Python 的 `httpx` 会在两个地址之间重试。换了 Docker 或者云,改环境变量就行。
- `TOKEN = os.environ.get("PLATFORM_TOKEN", "")` 令牌只从环境变量读。和 n8n 凭据里存的是同一个值。
- `FINANCE_PROMPT_V2 = (` 昨天财务提示词的升级版:多了「下面附了该客户最近的发票」和「发票号必须来自这份列表」。
- `def fetch_invoices(customer_id: str, limit: int = 5) -> list[dict]:` 对应 n8n 里的 `Invoices` 节点。
- `if not TOKEN:` 没设令牌就直接报错并说明怎么办。我第一版没有这两行,令牌为空时 `httpx` 报的是 `Illegal header value b'Bearer '`,看不出该怎么办。
- `r = httpx.get(` 发 GET 请求。
- `params={"limit": limit},` 变成 URL 里的 `?limit=5`。
- `headers={"Authorization": f"Bearer {TOKEN}"},` 和 `curl -H` 一样的请求头。
- `timeout=10,` 10 秒超时。没有超时的 HTTP 调用会把整个流程卡住,每个外部调用都该有这一行。
- `r.raise_for_status()` 401、404、500 都当场抛异常,不让模型对着空数据编回复。
- `return r.json()` 解析成列表。注意这里拿到的是一个列表,整体交给下一步,和 n8n 那里「拆成 5 条」相反。
- `def triage2(client: LLMClient, text: str, customer_id: str) -> dict[str, str]:` 比 `triage` 多一个 `customer_id` 参数。
- `category = classify(client, text)` 直接复用昨天的分类。
- `if category in ("refund", "billing", "invoice"):` 钱相关才去查发票,其他类别不用。
- `invoices = fetch_invoices(customer_id)` C007 会拿到 5 张。
- `user = f"{text}\n\n最近发票:{json.dumps(invoices, ensure_ascii=False)}"` 把发票 JSON 拼进用户消息。`ensure_ascii=False` 让中文不被转成 `\u` 转义,省 token。
- `system = FINANCE_PROMPT_V2` 财务类换用新提示词。
- `user, system = text, OTHER_PROMPT` 其他类别不变。
- `r = client.chat(` 第二次调模型,起草回复。
- `return {"category": category, "reply": r.content}` 返回形状和昨天一样,评测脚本不用改。
- `print(json.dumps(triage2(llm, sys.argv[2], sys.argv[1]), ensure_ascii=False, indent=2))` 命令行两个参数:先客户号,后工单正文。

</div>

```bash
PLATFORM_TOKEN=dev-token-123 uv run python -m part05.lowcode.triage_code2 C007 "10 月 8 号被扣了两次款,INV-2026-0026 和 INV-2026-0123 金额一样,把多扣的退给我"
```

```text
{
  "category": "refund",
  "reply": "您好，您反馈的重复扣款问题我已记录，会请财务核对 INV-2026-0026 和 INV-2026-0123 这两笔款项。核对结果出来后会有专人跟进处理，感谢您的耐心等待。"
}
2 次调用 | 输入 460 / 输出 57 tokens | 约 ¥0.0011
```

故意制造两次失败,看报错够不够清楚:

```bash
uv run python -m part05.lowcode.triage_code2 C007 "10 月 8 号被扣了两次款"
PLATFORM_TOKEN=wrong-token uv run python -m part05.lowcode.triage_code2 C007 "10 月 8 号被扣了两次款"
```

```text
    raise RuntimeError("先设置环境变量 PLATFORM_TOKEN(和起接口时用的是同一个值)")
RuntimeError: 先设置环境变量 PLATFORM_TOKEN(和起接口时用的是同一个值)
```

```text
    raise HTTPStatusError(message, request=request, response=self)
httpx.HTTPStatusError: Client error '401 Unauthorized' for url 'http://localhost:8140/customers/C007/invoices?limit=5'
For more information check: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/401
```

第一次没设令牌,直接说该设什么;第二次令牌错了,401 带着完整 URL 抛出来。对比 n8n:同样的失败,我在界面上看到的是 `Error in workflow` 和一个要点进去才能看的执行记录。

## 密钥放哪

n8n 里我把令牌放在凭据里。工作流文件和凭据文件是两个东西,看看导出来分别长什么样:

```text
$ n8n export:credentials --id=hdr-cred-1
"name": "CloudLedger token (scratch)", "type": "httpHeaderAuth",
"data": "U2FsdGVkX19pigJ8YgsW+BJaqkAKVC3tPZT/O8Ri+S1QLW7lk0yQD7g/rnXqfyvMfZP6+hF0kcvlMroDQEoZ5dWzN39LULTyzLW6AGeDI5I="

$ n8n export:credentials --id=hdr-cred-1 --decrypted
"name": "CloudLedger token (scratch)", "type": "httpHeaderAuth",
"data": {"name": "Authorization", "value": "Bearer dev-token-123"}
```

默认导出的 `data` 是一长串加密后的字符串(以 `U2FsdGVkX1` 开头,是 CryptoJS 的加盐格式);加 `--decrypted` 才会输出明文。所以凭据文件千万不能进 git。再看工作流文件里有没有令牌:

```bash
grep -c "Bearer" export/v2.json
```

```text
export/v2.json:0
```

工作流文件里只有凭据的 `id` 和 `name`,没有令牌。但如果你图省事,直接在 HTTP 节点的「Headers」里写 `Authorization: Bearer ...`,令牌就进了工作流文件。我造了一个这样的版本(`triage-v2-hard`),导出来:

```bash
grep -n "Bearer" export/hard.json
```

```text
138:                "value": "Bearer dev-token-123"
```

这一行会跟着工作流文件一起进 git、进评审、进别人的剪贴板。Dify 的 HTTP 请求节点同理:官方文档说密钥类型的环境变量在运行日志和节点请求日志里会被遮住,所以令牌要放在环境变量里,别写在节点的 Header 栏里。

## 给平台上的应用跑评测

[Day 336](/blog/agent-zero/day-336-low-code-1/) 说过画布上全绿也可能是错的。今天把这句话变成能每天跑的东西:一份带标准答案的用例,统一的打分脚本,代码版和每个平台各写一个「调一次」的函数。第六部分会系统讲评测,今天只做最小的一版。

评测集放在你自己的仓库里,不放在平台上。OpenAI 的 Evals 平台 10 月 31 日起只读、11 月 30 日关停,迁移指南指向开源的 Promptfoo(Day 336 查过弃用页):用平台自带的评测功能,平台一收,数据和习惯都得搬家。

12 条用例,每类至少一条,每条带客户号和期望类别:

```text
{"id": "c01", "customer_id": "C007", "text": "10 月 8 号被扣了两次款,INV-2026-0026 和 INV-2026-0123 金额一样,把多扣的退给我", "category": "refund"}
{"id": "c02", "customer_id": "C029", "text": "我们公司下个月起不再使用了,年付还剩几个月,能退剩下的钱吗?", "category": "refund"}
{"id": "c03", "customer_id": "C023", "text": "这个月账单怎么比上个月多了 300 块,我们没加席位啊", "category": "billing"}
{"id": "c04", "customer_id": "C014", "text": "想从基础版升级到企业版,中途升级怎么计费?", "category": "billing"}
{"id": "c05", "customer_id": "C005", "text": "上个月的发票抬头写错了,应该是「启明科技有限公司」,能重开吗?", "category": "invoice"}
{"id": "c06", "customer_id": "C011", "text": "发票上没有我们的税号,麻烦补上:91110105MA00XXXX", "category": "invoice"}
{"id": "c07", "customer_id": "C015", "text": "导出年度报表一直转圈,最后提示 ERR_EXPORT_TIMEOUT", "category": "bug"}
{"id": "c08", "customer_id": "C008", "text": "手机 App 一打开账单页就闪退,iOS 18", "category": "bug"}
{"id": "c09", "customer_id": "C015", "text": "收到的验证码一直提示过期,试了五六次登不上去,急!", "category": "account"}
{"id": "c10", "customer_id": "C003", "text": "离职同事是主账号,怎么把主账号转给我?", "category": "account"}
{"id": "c11", "customer_id": "C021", "text": "你们支持和金蝶对接吗?", "category": "other"}
{"id": "c12", "customer_id": "C025", "text": "请帮我取消订阅,不要再自动续费了", "category": "billing"}
```

脚本一共做三个检查:**分类对不对**(和期望类别比);**有没有编造发票号**(回复里出现的 `INV-xxxx-xxxx` 必须是这个客户名下真有的);**有没有承诺时限**(回复里出现「3 个工作日」「5 天」这类数字加时间,财务提示词明确禁止过)。

```python
# agent-zero-lab/part05/lowcode/triage_eval.py
"""同一份 12 条用例,给「代码版」和各个平台版打分。
  uv run python -m part05.lowcode.triage_eval code
  uv run python -m part05.lowcode.triage_eval n8n       # 需要 n8n 里 triage2 工作流已发布
  uv run python -m part05.lowcode.triage_eval dify      # 需要 DIFY_BASE_URL、DIFY_API_KEY(没实跑)
  uv run python -m part05.lowcode.triage_eval coze      # 需要 COZE_API_TOKEN、COZE_WORKFLOW_ID(没实跑)
  uv run python -m part05.lowcode.triage_eval bailian   # 需要 DASHSCOPE_API_KEY、BAILIAN_APP_ID(没实跑)
"""
import json
import os
import re
import sqlite3
import sys
import time
from pathlib import Path
from typing import Callable

import httpx

from common.llm import LLMClient
from part05.lowcode.triage_code2 import triage2

HERE = Path(__file__).parent
DB = HERE.parents[1] / "cloudledger" / "cloudledger.db"
Case = dict[str, str]
Backend = Callable[[str, str], dict[str, str]]  # (工单正文, 客户号) -> {"category": ..., "reply": ...}


LLM = LLMClient() if sys.argv[1] == "code" else None  # 只有跑代码版才需要 key


def run_code(text: str, customer_id: str) -> dict[str, str]:
    assert LLM is not None
    return triage2(LLM, text, customer_id)


def run_n8n(text: str, customer_id: str) -> dict[str, str]:
    r = httpx.post(f"{os.environ.get('N8N_URL', 'http://localhost:5678')}/webhook/{os.environ.get('N8N_PATH', 'triage2')}",
                   json={"ticket_text": text, "customer_id": customer_id}, timeout=120)
    r.raise_for_status()
    return r.json()


def run_dify(text: str, customer_id: str) -> dict[str, str]:
    r = httpx.post(f"{os.environ['DIFY_BASE_URL']}/workflows/run",
                   headers={"Authorization": f"Bearer {os.environ['DIFY_API_KEY']}"},
                   json={"inputs": {"ticket_text": text, "customer_id": customer_id},
                         "response_mode": "blocking", "user": "eval-bot"}, timeout=100)
    r.raise_for_status()
    data = r.json()["data"]
    if data["status"] != "succeeded":
        raise RuntimeError(data["error"])
    return data["outputs"]


def run_coze(text: str, customer_id: str) -> dict[str, str]:
    r = httpx.post("https://api.coze.cn/v1/workflow/run",
                   headers={"Authorization": f"Bearer {os.environ['COZE_API_TOKEN']}"},
                   json={"workflow_id": os.environ["COZE_WORKFLOW_ID"],
                         "parameters": json.dumps({"ticket_text": text, "customer_id": customer_id})}, timeout=90)
    body = r.json()
    if body["code"] != 0:
        raise RuntimeError(f"{body['code']} {body['msg']}")
    return json.loads(body["data"])  # data 是 JSON 字符串,要再解析一次


def run_bailian(text: str, customer_id: str) -> dict[str, str]:
    r = httpx.post(f"https://dashscope.aliyuncs.com/api/v1/apps/{os.environ['BAILIAN_APP_ID']}/completion",
                   headers={"Authorization": f"Bearer {os.environ['DASHSCOPE_API_KEY']}"},
                   json={"input": {"prompt": text, "biz_params": {"customer_id": customer_id}}, "parameters": {}, "debug": {}},
                   timeout=90)
    r.raise_for_status()
    return json.loads(r.json()["output"]["text"])  # 结束节点要输出成一段 JSON 字符串


def real_invoice_ids(customer_id: str) -> set[str]:
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    try:
        return {row[0] for row in conn.execute("SELECT id FROM invoices WHERE customer_id = ?", (customer_id,))}
    finally:
        conn.close()


def main() -> None:
    name = sys.argv[1]
    backends: dict[str, Backend] = {"code": run_code, "n8n": run_n8n, "dify": run_dify, "coze": run_coze, "bailian": run_bailian}
    run = backends[name]
    cases: list[Case] = [json.loads(line) for line in (HERE / "cases.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    right = fake = promised = 0
    seconds: list[float] = []
    for c in cases:
        t0 = time.perf_counter()
        try:
            out = run(c["text"], c["customer_id"])
        except Exception as e:  # noqa: BLE001
            out = {"category": f"ERROR {type(e).__name__}", "reply": ""}
        seconds.append(time.perf_counter() - t0)
        if out["category"] != c["category"]:
            print(f"✗ {c['id']} 期望 {c['category']},得到 {out['category']}:{c['text']}")
        right += out["category"] == c["category"]
        mentioned = set(re.findall(r"INV-\d{4}-\d{4}", out["reply"]))
        bad = mentioned - real_invoice_ids(c["customer_id"])
        if bad:
            fake += 1
            print(f"✗ {c['id']} 回复里的发票号不在 {c['customer_id']} 名下:{sorted(bad)}")
        if re.search(r"\d+\s*(个)?(工作日|天)", out["reply"]):
            promised += 1
            print(f"✗ {c['id']} 回复里承诺了时限:{out['reply'][:60]}")
    print(f"{name}: 分类 {right}/{len(cases)} 正确,编造发票号 {fake} 条,承诺时限 {promised} 条,平均 {sum(seconds) / len(seconds):.2f} 秒/条")
    if LLM is not None:
        print(LLM.ledger)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `Backend = Callable[[str, str], dict[str, str]]` 每个后端都是一个函数:收工单正文和客户号,返回 `{"category": ..., "reply": ...}`。后面加任何新平台,只要多写一个这样的函数。
- `LLM = LLMClient() if sys.argv[1] == "code" else None` 只有跑代码版才创建模型客户端,跑平台版时不需要本地的模型密钥。
- `return triage2(LLM, text, customer_id)` 代码版后端就是调今天的 `triage2`。`assert LLM is not None` 是给类型检查器看的。
- `def run_n8n(text: str, customer_id: str) -> dict[str, str]:` n8n 后端:往 webhook 发 POST,请求体是工作流里约定好的两个字段。
- `{os.environ.get('N8N_PATH', 'triage2')}` webhook 路径可以用环境变量换,等一下用它去跑两个故意改坏的版本。
- `timeout=120` 一张工单两次模型调用加一次 HTTP,通常 3 到 4 秒,给 120 秒是留足余量。
- `def run_dify(text: str, customer_id: str) -> dict[str, str]:` Dify 后端:`POST /workflows/run`,请求体有 `inputs`、`response_mode`、`user` 三项。官方文档说 `inputs` 的键要和开始节点的变量名一致,`user` 是终端用户标识,必填。**这一段没实跑**,没有账号。
- `"response_mode": "blocking", "user": "eval-bot"` 阻塞模式一次拿到完整结果。官方文档提醒阻塞调用有 Cloudflare 的 100 秒超时。
- `if data["status"] != "succeeded":` 按旧课 Day 140 的写法,返回里 `data.status` 不是 `succeeded` 就当失败,把 `data.error` 抛出来。这几个字段名我这次没有在官方页面上核到完整的字段表,只确认了请求体和阻塞模式,上手时以官方文档为准。
- `return data["outputs"]` 工作流结束节点的输出变量,需要有 `category` 和 `reply`。
- `def run_coze(text: str, customer_id: str) -> dict[str, str]:` 扣子后端。**没实跑。** 请求体里 `parameters` 是**序列化成字符串的 JSON**,所以用了 `json.dumps`。
- `if body["code"] != 0:` 扣子的业务错误靠返回里的 `code` 判断,不是 HTTP 状态码。
- `return json.loads(body["data"])  # data 是 JSON 字符串,要再解析一次` 返回的 `data` 也是字符串,要再解析一次。同步调用 90 秒收不到响应就断开,官方建议工作流控制在 5 分钟以内。
- `def run_bailian(text: str, customer_id: str) -> dict[str, str]:` 百炼后端。**没实跑。**
- `json={"input": {"prompt": text, "biz_params": {"customer_id": customer_id}}, "parameters": {}, "debug": {}},` 用户那句话放 `input.prompt`,工作流的自定义参数放 `input.biz_params`。
- `return json.loads(r.json()["output"]["text"])  # 结束节点要输出成一段 JSON 字符串` 回答在 `output.text`。工作流应用的结束节点输出会放进 `text`,我假设你把它输出成 `{"category": ..., "reply": ...}` 这样一段 JSON 字符串,这是我的约定,官方文档没规定。
- `def real_invoice_ids(customer_id: str) -> set[str]:` 查这个客户名下真正存在的发票号集合,用来判断回复里有没有编造。
- `conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)` 评测脚本也只读打开库,不会改数据。
- `backends: dict[str, Backend] = {` 五个后端放进一张表,命令行第一个参数选一个。
- `right = fake = promised = 0` 三个计数:分类对的、编造发票号的、承诺时限的。
- `out = {"category": f"ERROR {type(e).__name__}", "reply": ""}` 后端出任何异常都记成一次失败并继续,不让一条用例中断整份评测。
- `mentioned = set(re.findall(r"INV-\d{4}-\d{4}", out["reply"]))` 用正则从回复里抠出所有发票号。
- `bad = mentioned - real_invoice_ids(c["customer_id"])` 集合相减:回复里提到、但这个客户名下没有的,就是编造的。
- `if re.search(r"\d+\s*(个)?(工作日|天)", out["reply"]):` 数字后面跟「工作日」或「天」(中间允许「个」和空格),就算承诺了时限。`3 个工作日` 和 `5 天` 都会命中。
- `print(f"{name}: 分类 {right}/{len(cases)} 正确,` 最后一行汇总,五个数字一眼看完。
- `print(LLM.ledger)` 代码版额外打印记账本。

</div>

先跑代码版,关思考和开思考各一遍:

```bash
PLATFORM_TOKEN=dev-token-123 uv run python -m part05.lowcode.triage_eval code
PLATFORM_TOKEN=dev-token-123 LLM_EXTRA_BODY='{}' uv run python -m part05.lowcode.triage_eval code
```

```text
code: 分类 12/12 正确,编造发票号 0 条,承诺时限 0 条,平均 1.57 秒/条
24 次调用 | 输入 3371 / 输出 745 tokens | 约 ¥0.0125
```

```text
code: 分类 12/12 正确,编造发票号 0 条,承诺时限 0 条,平均 3.08 秒/条
24 次调用 | 输入 3971 / 输出 3387 tokens | 约 ¥0.0345
```

再跑 n8n 版(`triage2` 工作流要先发布):

```bash
uv run python -m part05.lowcode.triage_eval n8n
```

```text
n8n: 分类 12/12 正确,编造发票号 0 条,承诺时限 0 条,平均 3.29 秒/条
```

把 12 次执行里两个模型节点的 token 加起来(用的是昨天练习 3 说的内部接口):

```text
executions 12
success 12 LLM calls 24 prompt 3803 completion 3529 cost 元 0.0358 (未命中价上限,n8n 日志里没有缓存命中数)
```

放在一张表里:

| | 分类 | 编造发票号 | 承诺时限 | 平均耗时 | 24 次调用的 token(入/出) | 钱 |
| --- | --- | --- | --- | --- | --- | --- |
| 代码版,关思考 | 12/12 | 0 | 0 | 1.57 秒 | 3371 / 745 | 约 ¥0.0125(含缓存命中) |
| 代码版,开思考 | 12/12 | 0 | 0 | 3.08 秒 | 3971 / 3387 | 约 ¥0.0345 |
| n8n | 12/12 | 0 | 0 | 3.29 秒 | 3803 / 3529 | 按未命中价 ≤ ¥0.0358 |

三行都是满分,零编造,零承诺。n8n 和开思考的代码版几乎一样,只比它多 0.2 秒,那是 n8n 多出来的一次 HTTP 往返和自己的开销。

**满分不说明什么。** 12 条用例太少,全对只能说明「没有明显坏掉」。评测的价值在有人改坏的时候能报警。我故意造了两个坏版本,用同一份评测去抓。

**坏版本一:解析写错。** 把 `Parse category` 换回昨天第一版的写法(从 `json.text` 里取字符串),其他不变,发布成另一个路径,用环境变量切过去:

```bash
N8N_PATH=triage2pbug uv run python -m part05.lowcode.triage_eval n8n
```

```text
✗ c01 期望 refund,得到 other:10 月 8 号被扣了两次款,INV-2026-0026 和 INV-2026-0123 金额一样,把多扣的退给我
✗ c02 期望 refund,得到 other:我们公司下个月起不再使用了,年付还剩几个月,能退剩下的钱吗?
✗ c03 期望 billing,得到 other:这个月账单怎么比上个月多了 300 块,我们没加席位啊
✗ c04 期望 billing,得到 other:想从基础版升级到企业版,中途升级怎么计费?
✗ c05 期望 invoice,得到 other:上个月的发票抬头写错了,应该是「启明科技有限公司」,能重开吗?
✗ c06 期望 invoice,得到 other:发票上没有我们的税号,麻烦补上:91110105MA00XXXX
✗ c07 期望 bug,得到 other:导出年度报表一直转圈,最后提示 ERR_EXPORT_TIMEOUT
✗ c08 期望 bug,得到 other:手机 App 一打开账单页就闪退,iOS 18
✗ c09 期望 account,得到 other:收到的验证码一直提示过期,试了五六次登不上去,急!
✗ c10 期望 account,得到 other:离职同事是主账号,怎么把主账号转给我?
✗ c12 期望 billing,得到 other:请帮我取消订阅,不要再自动续费了
n8n: 分类 1/12 正确,编造发票号 0 条,承诺时限 0 条,平均 3.33 秒/条
```

12 条里只对了 1 条(`c11` 本来就是 `other`)。11 条的类别全落成了 `other`,每一条都在命令行里被点名。昨天在画布上全绿、要点进去才能发现的错,今天评测跑一遍就出来了。

**坏版本二:提示词被改坏。** 把财务提示词那句「不要承诺具体金额和到账时间」换成「告诉客户我们会在 3 个工作日内原路退回多扣的款项」,模拟「运营同学在平台上顺手改了一句话」,同样发布到另一个路径:

```bash
N8N_PATH=triage2bad uv run python -m part05.lowcode.triage_eval n8n
```

```text
✗ c01 回复里承诺了时限:您好，已核对到 10 月 8 日 INV-2026-0026 与 INV-2026-0123 两笔金额均为 ¥2,392
✗ c02 回复里承诺了时限:您好，我们核对了您近期的账单：2026年8月13日、9月7日、10月9日各扣198元，显示为**按月扣费**，账户里并没
✗ c03 回复里承诺了时限:已收到您的反馈。不过我们这边查到您账户下最近三张发票的金额都是 **7,176.00 元**（2024、2025、202
✗ c04 回复里承诺了时限:升级费用会按企业版与基础版的差价、结合您当前计费周期的剩余天数折算收取。另经核对，您发票中存在多扣款项，我们会在 3 个
✗ c05 回复里承诺了时限:您提供的正确抬头「启明科技有限公司」我们已记录，会为您核实并办理发票重开，一般 3 个工作日内完成，重开后会同步发送给您
✗ c06 回复里承诺了时限:您好,您补充的税号 91110105MA00XXXX 我们已收到并记录。关于多扣的款项,我们会在 3 个工作日内按原支付
✗ c12 回复里承诺了时限:已收到您的取消订阅申请，我们会为您关闭自动续费，后续不会再产生新的扣款。关于多扣的款项，我们会在 3 个工作日内按原支付
n8n: 分类 12/12 正确,编造发票号 0 条,承诺时限 7 条,平均 4.25 秒/条
```

分类还是 12/12,**承诺时限 7 条**,正好是 12 条里 7 条财务类用例(c01 到 c06 加 c12)。如果只看分类准确率,这个坏版本是满分;三个检查里的第三个才抓住了它。顺带一提,最后两条回复里还出现了发票上没有的陈述(比如 c02 说「各扣 198 元、按月扣费」),因为坏提示词没有再要求「只引用列表里的发票」,这一类编造我的检查没覆盖,需要你自己加。

两件事要记住。第一,评测脚本和用例在你自己的仓库里,平台上改了提示词,你不用登录平台就能知道有没有改坏;把它放进 CI,每次有人改了平台上的工作流(或者每天定时)就跑一次。第二,检查要覆盖你真正怕的事:这里怕的是类别错、编造发票号、乱承诺,于是写了三个检查,换了业务,怕的事不一样,检查也要换。

Dify、扣子、百炼三个后端我没有账号,上面三个函数是对着官方 API 文档写的,没有分数可以给你。你搭好平台版以后跑 `triage_eval dify`,如果分数明显低于代码版,先检查两边的提示词是不是同一个、模型是不是同一个、温度是不是 0,很多「平台不如代码」的结论,比的根本不是同一个东西。

## 什么时候该改成写代码

最后是最常被问的问题。下面是我的判断表,「今天的证据」一栏是这两天实测里碰到的:

| 信号 | 继续用平台 | 该改成代码了 | 这两天的证据 |
| --- | --- | --- | --- |
| 谁在维护 | 业务同学、运营 | 工程团队,而且已经有人在画布里写大段代码节点 | `Parse category` 就是一个代码节点,里面的 try/catch 把错吞了 |
| 流程复杂度 | 十几个节点以内,分支清楚 | 节点上百、嵌套循环、多处共享逻辑要复制粘贴 | 一个三步流程就有 12 个节点、437 行导出文件 |
| 出错的代价 | 内部工具,错了重来 | 面向客户、涉及钱、要审计 | 全绿但分类全错;数组被拆成 5 个 item,调了 6 次模型 |
| 测试和发布 | 手点几次能确认 | 需要单元测试、灰度、回滚到某个版本 | 重新导入会变成未发布,线上 webhook 当场失效 |
| 参数控制 | 平台暴露的参数够用 | 要的开关平台没留(思考开关、`extra_body`、重试策略) | n8n 的 DeepSeek 节点没有关思考的选项,输出 token 差 5 倍 |
| 性能 | 每天几百次调用 | 每秒几十次以上,或者对延迟敏感 | n8n 单次比同条件代码版慢约 0.2 秒,一次 webhook 往返多一层 |
| 调试 | 看节点输入输出就够 | 要打断点、看完整 trace、复现某一次线上请求 | 排查两个坑都是去翻执行记录,没法下断点 |
| 依赖和网络 | 平台自带的模型和工具够用 | 要接公司内部的鉴权、消息队列、数据权限体系 | `localhost` 在 n8n 里连不上自己的接口 |
| 平台风险和运维 | 能接受,有导出 | 平台的协议、价格、存续对业务有实质影响;自部署升级成本吃不消 | Flowise 已归档、OpenAI Agent Builder 11 月 30 日关停、Dify 1.18.0 要求全部组件一起升 |

不需要所有信号都满足。我的经验是,出现两三个「该改成代码」的信号,就该开始规划迁移了。

迁移不必一次到位,可以分四步,每一步今天都碰过:

**第一步,先导出进版本库。** n8n 用 `export:workflow --pretty`,Dify 用导出 DSL(1.18 起还有 `.ifpkg` 整包)。没有这一步,出了问题说不清是谁、什么时候改坏的。

**第二步,把最复杂、最关键的节点抽成自己的接口。** 今天的 `cloudledger_api.py` 就是这种形态:平台只负责编排,数据和规则在你自己手里。

**第三步,评测先行。** `triage_eval.py code` 和 `triage_eval.py n8n` 用的是同一份用例,迁移前后分数可以一直对着看,确认没有让效果变差。

**第四步,等编排本身也成了瓶颈,再把整个流程换成代码。** 用 LangGraph 或者纯代码接过来,平台只剩一个 webhook 入口,最后连这个也可以拆掉。

反过来也成立:你用代码写好的能力可以发布给平台用。n8n 的 MCP Client Tool 能调你的 MCP server,Dify 能把外部 MCP server 加成工具,业务同学在平台上拼自己的小流程,不用每次都来找工程师。这两条我没有实跑,是官方文档和包里节点目录显示的能力。

我自己的结论是:**平台适合出原型、给业务同学自助、做内部小工具;进了「客户在用、涉及钱、要复现」这三个条件之一,就把核心逻辑放回自己的代码里,平台留作入口或原型。** 昨天说了不选边站,今天的证据支持这个立场:两边花的钱一样、速度一样,真正拉开差距的是出错以后你能不能看见、能不能改、能不能测。

## 动手练习

**练习 1:补上另外三个后端。** `triage_eval.py` 里 `run_dify`、`run_coze`、`run_bailian` 我没有账号实跑。选一个你能注册的平台(Dify 云版 Sandbox 套餐免费),搭出和 `triage2` 等价的流程,设好环境变量,跑 `triage_eval`。写出你需要的环境变量和你碰到的第一个报错。

<details><summary>参考答案</summary>

这一题我没有实跑,下面是对照官方文档整理的检查清单,不是实操记录。

Dify:环境变量 `DIFY_BASE_URL`(云版是 `https://api.dify.ai/v1`,自部署是你的域名加 `/v1`)和 `DIFY_API_KEY`(应用发布后在「访问 API」里生成,官方文档说应用密钥只作用于这一个应用)。开始节点要有 `ticket_text` 和 `customer_id` 两个变量,结束节点输出 `category` 和 `reply`。官方文档说接口要求应用已发布,并且 `user` 必填。第一个可能的报错:返回 401,说明密钥不对或复制时带了空格;返回成功但 `outputs` 里没有 `category`,说明结束节点的变量名和脚本读的不一致。自部署的 Dify 如果要让 HTTP 节点访问你本机的接口,要考虑容器内的网络,和坑一同理。

扣子:`COZE_API_TOKEN` 要有 run 权限,`COZE_WORKFLOW_ID` 必须是已发布的工作流,否则官方文档说返回错误码 4200。脚本里 `parameters` 要 `json.dumps` 成字符串,返回的 `data` 也要 `json.loads` 一次。

百炼:`DASHSCOPE_API_KEY` 和 `BAILIAN_APP_ID`,接口地址按官方文档只适用于华北 2(北京)地域。工作流自定义参数放 `input.biz_params`,开始节点里要有 `customer_id`;结束节点输出什么放进 `output.text`,要自己约定成 JSON 字符串。

三个平台的通用自检:提示词和代码版是同一份、温度是 0、模型是同一个。

</details>

**练习 2:让评测抓住坏提示词。** 在你的平台(或者用 n8n)上把财务提示词改成会承诺时限的版本,不改任何别的东西,跑 `triage_eval`。记下三个数字的变化。然后想一个我的三个检查没覆盖的坏法,写出该加什么检查。

<details><summary>参考答案</summary>

我在 n8n 上改了,实跑结果在上一节:分类 12/12 不变,编造发票号 0 不变,**承诺时限从 0 变成 7**,平均耗时从 3.29 秒变成 4.25 秒(回复写得更长)。三个数字里只有一个动了,说明只看分类准确率会漏掉这一类退化。

没覆盖的坏法,我在输出里就看到一个:回复里写了发票上没有的陈述(「各扣 198 元、按月扣费」)。要抓它,加第四个检查:回复里出现的金额(`\d+(\.\d+)?\s*元`)必须在这个客户的发票金额里。做法是把 `real_invoice_ids` 旁边再写一个 `real_amounts(customer_id)`,返回名下发票金额(`amount_cents / 100`)的集合,和回复里抠出来的数字比。这个检查要小心千分位和「2,392.00」「2392」这几种写法,先统一格式再比较。另一种没覆盖的坏法是「回复里出现了客户没问的敏感信息」,那需要换成模型打分或人工抽查,不是几行正则能做的,第六部分会讲。

</details>

**练习 3:令牌会不会泄漏。** 把你自己平台上的 HTTP 节点令牌换成两种写法(凭据里 vs 节点 Header 里),导出工作流文件,分别 `grep` 令牌的值。再想一想,令牌除了工作流文件,还可能出现在哪里。

<details><summary>参考答案</summary>

我在 n8n 上做了:令牌放凭据时,`grep -c "Bearer" export/v2.json` 输出 0;令牌写在 HTTP 节点的 Headers 里时,`grep -n "Bearer" export/hard.json` 输出 `138:                "value": "Bearer dev-token-123"`,明文进了文件。

令牌还可能出现在这些地方:凭据单独导出时加了 `--decrypted`;执行记录里(n8n 的执行数据默认会保存节点的输入输出,请求头在出错信息里被替换成了 `**hidden**`,我在 `Invoices` 报错的数据里看到 `"headers":{"**hidden**":"**hidden**"}`,但这是我看到的现象,不同节点和版本的行为可能不同);截图和录屏;你在 Slack 里贴的 `curl` 命令。令牌一旦进了这些地方,就当作已经泄漏,换一个新的,并且让接口那头只认新的。

</details>

**练习 4:该不该迁。** 一个公司用 Dify 搭了客服机器人,已经面向客户上线半年,有 40 个节点,三个人都在改提示词,上周有人改了一句话导致「退款」类工单全部转人工,花了两天才查出来。用判断表说出你的建议,并写出迁移的第一周要做什么。

<details><summary>参考答案</summary>

按判断表,至少命中四条:出错的代价(面向客户、涉及退款)、测试和发布(三个人改,没有回滚到某个版本的办法)、复杂度(40 个节点)、调试(两天才查出来)。建议开始迁移,但不是推倒重来。

第一周只做三件事:把现有的 Dify 应用导出 DSL 进 git,以后每次改动都要导出并提交,这样「谁改了哪句话」能查;建一份评测集,把上周出事的那类工单放进去(「退款」类至少 10 条,带标准答案和「必须转人工/不能转人工」的期望),写成像 `triage_eval.py dify` 这样的脚本,每次改提示词先跑;把改提示词的权限收一收,至少要求改动前跑评测。等这三件事稳了,再决定把最复杂的节点抽成接口,是下一周的事。这题没有唯一答案,理由比结论重要。

</details>

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 只读接口 | 只提供查询、不提供修改的接口。平台那一头再怎么出错,也改不了你的数据。今天的 `cloudledger_api.py` |
| 承载令牌(Bearer token) | 放在请求头 `Authorization: Bearer xxx` 里的一串密钥,谁拿着谁就能调用。要放在凭据或环境变量里 |
| localhost 与 `::1` | `localhost` 可能先解析成 IPv6 地址 `::1`,而你的服务只监听 IPv4 的 `127.0.0.1`,有的客户端不会自动换地址重试 |
| item(n8n 的数据单位) | n8n 里数据按「一条条 item」流动,一个数组会被拆成多条 item,后面的节点对每条各跑一次 |
| Aggregate | n8n 里把多条 item 合并成一条的节点,今天用它把 5 张发票合成一个 `invoices` 数组 |
| 评测集 | 一份带标准答案的用例,每次改动后批量跑一遍打分。今天的 `cases.jsonl` 有 12 条 |
| 回归 | 以前对的东西被改坏了。评测集最主要的用处就是抓回归 |
| 隧道(tunnel) | 把你本机的某个端口临时暴露到公网的一个地址,云版平台才访问得到你电脑上的接口。地址是公开的,令牌要强 |

## 常见误区

**以为接口在跑、curl 通,别的客户端就一定通。** `localhost` 的解析顺序和重试策略各个客户端不一样,今天 n8n 就是例子。配平台时优先用 `127.0.0.1` 或真实域名。

**以为 HTTP 节点返回数组,后面拿到的就是数组。** 在 n8n 里,数组会变成多条 item,后面的节点跑多遍,钱和回复都会错。看执行记录里每个节点跑了几次、出了几条。

**只在节点的 Headers 里写令牌图省事。** 令牌会进工作流文件、进 git。放凭据,导出凭据时别加 `--decrypted`。

**把评测集放在平台上。** OpenAI 的 Evals 平台 11 月 30 日关停,是今年的例子。评测集和打分脚本放自己的仓库。

**只看分类准确率。** 坏版本二分类依然 12/12,只有「承诺时限」那个检查报了 7 条。检查要覆盖你真正怕的事,不只是最容易量的那一个。

**平台上的评测数据拿来和代码版的直接比,不看提示词和模型是不是一样。** 很多「平台不如代码」的结论,比的根本不是同一个东西。

**用 12 条用例就宣布「平台和代码一样好」。** 样本太小。今天的评测只能证明没有明显坏掉,不能证明两边有多接近。

## 学习资料

### 文档与文章

- [Dify · HTTP 请求节点](https://docs.dify.ai/en/self-host/use-dify/nodes/http-request):认证类型、变量引用、重试和失败分支、密钥类型环境变量会被遮住,10 分钟。
- [Dify · Run Workflow API](https://docs.dify.ai/en/api-reference/workflow-runs/run-workflow):`inputs`、`response_mode`、`user` 三项和阻塞模式的 100 秒超时,10 分钟。
- [n8n · 服务端命令行](https://docs.n8n.io/hosting/cli-commands/):`export:credentials` 的 `--decrypted` 那条警告,5 分钟。
- [Coze · 工作流执行 API](https://docs.coze.cn/developer_guides/workflow_run):`parameters` 是字符串、同步 90 秒、`is_async` 限付费,10 分钟。
- [阿里云百炼 · 调用工作流应用](https://help.aliyun.com/zh/model-studio/invoke-workflow-application/):`input.biz_params` 怎么传自定义参数,10 分钟。
- [Cloudflare · Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/):学习时把本机端口临时暴露给云版平台,今天没实跑,10 分钟。
- [Promptfoo](https://www.promptfoo.dev/):OpenAI 迁移指南指向的开源评测工具,先看首页的概念,10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1UBp2zpEps&autoplay=0&high_quality=1" title="Dify智能体开发—工作流节点编排:执行HTTP工具获取外部数据" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI未来搭子 · Dify智能体开发—工作流节点编排:执行HTTP工具获取外部数据 · 7 分钟,看 Dify 的 HTTP 请求节点怎么填地址、认证和变量,对照今天 n8n 的 Invoices 节点。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1E2846DEYQ&autoplay=0&high_quality=1" title="面试官:说一下Al大模型LangChain、Dify、n8n、Coze框架的区别?程序员ai大模型面试必看!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI大模型大课堂 · 面试官:说一下Al大模型LangChain、Dify、n8n、Coze框架的区别? · 10 分钟,面试向,看完用今天的判断表把它的回答补上证据。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/LP5OCa20Zpg" title="Tips for building AI agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Anthropic · Tips for building AI agents · 英文,几位工程师聊什么时候该用 Agent、从简单做起、什么时候该升级,和今天「先平台出原型,信号出现再迁」是一个思路。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):评测相关的章节,第六部分会重读,今天先翻目录,英文原版。
- Michael Albada《Building Applications with AI Agents》(O'Reilly,2025):选读讲框架与平台取舍的章节,英文原版。

### 开源项目与代码

- [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo):开源评测工具,看它的配置文件怎么描述「用例加断言」,和今天的 `cases.jsonl` 加三个检查对照。
- [n8n-io/n8n](https://github.com/n8n-io/n8n):在 `packages/@n8n/nodes-langchain/nodes/mcp` 下能看到 MCP Client Tool 和 MCP Server Trigger 的源码。
- [langgenius/dify](https://github.com/langgenius/dify):官方 Releases 页的 1.18.0 说明里有 `difyctl` 和 `.ifpkg` 的介绍。

## 自测

1. 令牌放在 n8n 的凭据里和写在 HTTP 节点的 Headers 里,导出的工作流文件有什么区别?

<details><summary>答案</summary>

放凭据时,工作流文件里只有凭据的 `id` 和 `name`,`grep Bearer` 是 0 行;写在 Headers 里,明文 `"value": "Bearer dev-token-123"` 会出现在工作流文件里,跟着 git 走。凭据单独导出时默认是加密串,加 `--decrypted` 才是明文,所以凭据文件也不能进 git。

</details>

2. 为什么 `curl localhost:8140` 通,n8n 里的 `localhost:8140` 却报 `The service refused the connection`?

<details><summary>答案</summary>

`localhost` 先解析成 IPv6 的 `::1`,再是 IPv4 的 `127.0.0.1`,而 uvicorn 默认只监听 `127.0.0.1`。`curl` 在 `::1` 失败后会自动换 IPv4 重试,n8n 的 HTTP 请求节点没有,所以被拒绝。把地址换成 `127.0.0.1` 就通了。这是我根据现象和 `dns.lookup`、`lsof` 的输出推断的,没有读 n8n 源码确认。

</details>

3. 为什么没有 Aggregate 节点时,一张工单会触发 6 次模型调用,并且回复说少了一张发票?

<details><summary>答案</summary>

接口返回 5 张发票的数组,n8n 把它拆成 5 条 item,后面的模型节点对每条 item 各跑一遍:5 次回复加 1 次分类共 6 次,输出 1484 个 token。每次模型只看到一张发票,所以回复会说另一张不在清单里。加了 Aggregate 把 5 条合成 1 条(字段 `invoices`),只调 1 次,总共 2 次调用、输出 426 token,回复里两张发票号都对。

</details>

4. 评测里「承诺时限」那个检查在什么情况下才派上用场?只看分类准确率会漏掉什么?

<details><summary>答案</summary>

有人改了财务回复的提示词、让它承诺「3 个工作日内原路退回」时。我实跑的坏版本分类 12/12、编造发票号 0,只有「承诺时限」报了 7 条,正好是 7 条财务类用例。只看分类准确率,这个坏版本和正常版本一样是满分。

</details>

5. 举出判断表里你认为最重的两个「该改成代码」的信号,并各配一个今天的证据。

<details><summary>答案</summary>

开放题,示范。「出错的代价」:面向客户、涉及钱的流程,画布上全绿而类别全错(昨天),数组被拆成 5 个 item 调了 6 次模型(今天)。「测试和发布」:重新导入会把工作流变成未发布,线上 webhook 当场失效,而且没有内建的评测,今天的评测是我在平台外面自己写的。别的组合也可以,要点是每条信号都配得上一个真实现象。

</details>

6. **面试题**:「你们的 Dify 客服机器人上线半年了,现在有人提出要改成写代码,你怎么评估,怎么迁移?」

<details><summary>答案</summary>

参考要点:先别急着迁,先用信号判断,看出错代价、测试发布、调试、复杂度、平台风险五类;有两三条命中再开始规划。迁移分四步:一、把应用导出 DSL(或 `.ifpkg`)进版本库;二、把最复杂、最关键的节点抽成自己的接口(HTTP 或 MCP),平台只做编排,并且接口一律只读或只创建待审批申请,令牌放凭据;三、评测先行,评测集和打分脚本放自己仓库,代码版和平台版跑同一份用例,迁移前后分数对着看;四、等编排本身成了瓶颈,再把整个流程换成 LangGraph 或纯代码,平台留作入口。同时要补上平台特有的坑:HTTP 节点的数据模型(数组变多条)、导入会变成未发布、思考等参数没开关、自部署升级要读说明。最后说平台风险:Flowise 归档、OpenAI Agent Builder 关停是今年的例子,所以导出和评测都不依赖平台。

</details>

## 明天预告

明天是 [Day 338 · 小项目(一):工单分流 Agent 设计和 MCP 工具](/blog/agent-zero/day-338-router-project-1/)。第五部分的最后一个小项目,把这一部分学的东西拼起来:前三十多天做的 CloudLedger MCP server、LangGraph、多 Agent 的取舍,都要用上。低代码这两天是旁支,但判断表和评测集的思路会在小项目里再次用到。
