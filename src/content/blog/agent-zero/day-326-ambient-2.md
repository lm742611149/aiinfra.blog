---
title: 'Day 326 · 后台 Agent(二):webhook 入口、处理图和 worker'
description: '昨天的事件表里躺着几行 pending,今天让它们动起来:用 FastAPI 写一个只验签、只落库、立刻回 202 的 webhook 入口;画一张「读工单 → 起草回复 → 停下等人」的处理图;再写一个 worker,原子地领事件、跑图、失败重试、三次进死信。重复这件事在三个地方各挡一次。'
pubDate: 2026-10-22
regime: none
tags: ['ambient-agent', 'webhook', 'langgraph', 'fastapi', 'agent-zero']
series: 'agent-zero'
day: 326
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 325](/blog/agent-zero/day-325-ambient-1/) 讲了后台 Agent 的三种触发源:webhook 是别人推给你,邮件是你去拉,定时任务是你给自己定的闹钟。三种都会重复,所以我们建了一张 `events` 表,用去重键做主键,`INSERT OR IGNORE` 加 `rowcount` 判断「这是不是新事件」。三种来源跑两遍,表里还是 4 行。

昨天的三种来源都是 Python 函数模拟的,表里那几行 pending 也没人处理。今天把中间这一段补上:一个真的 HTTP 入口接 webhook,一个 worker 从表里领事件,交给一张 LangGraph 图去读工单、起草回复,然后停下来等人。

## 今天要解决的问题

学完今天,你要能做到:

1. 用 FastAPI 写一个 webhook 入口:验签(HMAC 加时间戳)、写事件表、立刻回 202,并能用 curl 复现 400、401、422 三种拒绝。
2. 写一张处理工单的图 `agent.py`,thread_id 用工单号,停在 `review` 节点等人;`send` 节点靠 outbox 表的 UNIQUE 做到发两次也只发一次。
3. 写一个 worker:用一条 `UPDATE ... RETURNING` 原子地领事件,失败重试三次进死信,能分清「停下等人」和「跑到一半崩了」两种 thread。
4. 说出这条链路在哪三个地方挡重复,各挡的是什么。

预计用时 3 小时(内容多,可以分两次:前半到「第 2 步」,后半从「第 3 步」开始)。前置:[Day 80](/blog/agent-zero/day-080-fastapi-2/) 和 [Day 81](/blog/agent-zero/day-081-fastapi-3/) 的 FastAPI 和 `HTTPException`,[Day 84](/blog/agent-zero/day-084-auth-2/) 的 HMAC 签名,[Day 317](/blog/agent-zero/day-317-lg-state-history/) 到 [Day 320](/blog/agent-zero/day-320-lg-refund-approval/) 的 `get_state`、SqliteSaver、interrupt 和退款审批图,昨天的 `store.py`。实跑花费约 0.014 元。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `verify()`、`claim()` 和 `handle()` 三个函数默写出来;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 今天的全貌

先看今天要搭起来的东西。昨天只有左边那张表,今天从入口一直接到「停下等人」:

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="今天的链路:上游工单系统 POST 到 webhook 入口,入口验签后写 events 表并回 202;worker 从 events 表原子领事件,交给处理图;处理图读业务库、调模型起草,停在 review 节点;send 节点写 outbox。三处去重分别标在 events 主键、thread_id、outbox UNIQUE 上">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12" text-anchor="middle">
    <rect x="12" y="40" width="96" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="60" y="58" fill="var(--ink)">工单系统</text>
    <text x="60" y="73" font-size="10" fill="var(--ink-soft)">上游</text>
    <rect x="140" y="40" width="110" height="40" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
    <text x="195" y="58" fill="var(--ink)">webhook.py</text>
    <text x="195" y="73" font-size="10" fill="var(--ink-soft)">验签 · 落库 · 202</text>
    <rect x="282" y="40" width="100" height="40" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
    <text x="332" y="58" fill="var(--ink)">events 表</text>
    <text x="332" y="73" font-size="10" fill="var(--ink-soft)">① 主键去重</text>
    <rect x="282" y="130" width="100" height="40" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
    <text x="332" y="148" fill="var(--ink)">worker.py</text>
    <text x="332" y="163" font-size="10" fill="var(--ink-soft)">原子领取 · 重试</text>
    <rect x="414" y="110" width="214" height="80" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="521" y="128" fill="var(--ink)">agent.py 处理图</text>
    <text x="521" y="148" font-size="11" fill="var(--ink-soft)">load → draft → review ⏸</text>
    <text x="521" y="166" font-size="10" fill="var(--ink-soft)">② thread_id = 工单号</text>
    <text x="521" y="182" font-size="10" fill="var(--ink-faint)">checkpoints.db</text>
    <rect x="414" y="214" width="120" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="474" y="235" fill="var(--ink)">outbox ③UNIQUE</text>
    <rect x="550" y="214" width="78" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)"/>
    <text x="589" y="235" fill="var(--ink-soft)">收件箱</text>
  </g>
  <g stroke="var(--ink-soft)" fill="none">
    <line x1="108" y1="60" x2="140" y2="60"/><line x1="250" y1="60" x2="282" y2="60"/>
    <line x1="332" y1="80" x2="332" y2="130"/><line x1="382" y1="150" x2="414" y2="150"/>
    <line x1="474" y1="190" x2="474" y2="214"/><line x1="589" y1="190" x2="589" y2="214"/>
  </g>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">
    <text x="112" y="34">POST</text>
    <text x="340" y="110">领一个</text>
    <text x="560" y="206">Day 327</text>
    <text x="12" y="120">蓝 = 调模型的部分</text>
    <text x="12" y="136">琥珀 = 外部系统</text>
  </g>
</svg>
<figcaption>今天的链路。入口只做三件事,最快返回;所有慢活在 worker 里做。圆圈数字是三处去重:事件层、业务层、动作层。</figcaption>
</figure>

今天的两个新概念:

- **幂等**:同一件事做一次和做多次,结果一样。昨天的事件表只是第一处,今天会在 thread_id 和 outbox 上再加两处。
- **worker 和它的状态机**:一个死循环,领事件、跑图、根据结果改状态。图本身是 Day 320 学过的那一套,今天只是换了个场景。

webhook 验签用的 HMAC 是 [Day 84](/blog/agent-zero/day-084-auth-2/) 讲 JWT 时学过的,今天只是换个地方用。

## 准备:改 store.py,装依赖

今天的文件都放在昨天建的 `agent-zero-lab/part05/ambient/` 里。先装三个新依赖。FastAPI 和 uvicorn 是 Day 79 用过的,httpx 用来写模拟上游的发送脚本:

```bash
cd agent-zero-lab
uv add fastapi uvicorn httpx
uv run python cloudledger/seed.py
cd part05/ambient
```

2026 年 10 月我查 PyPI 的最新版,也是我实跑用的:fastapi 0.159.1、uvicorn 0.54.0、httpx 0.28.1、langgraph 1.2.16、langgraph-checkpoint-sqlite 3.1.2、langchain-openai 1.7.2,Python 3.12.13。`seed.py` 是 Day 280 的造数脚本,保证工单数据是原样的。

处理图要调模型,`llm.py` 从 Day 320 的 `part05/lgdemo/` 复制一份过来,内容一字不改(只有第一行路径注释换了),这样这个目录里的脚本按文件名就能导入它:

```bash
cp ../lgdemo/llm.py llm.py
```

然后改昨天的 `store.py`。worker 失败时要记下原因,所以 `events` 加一列 `last_error`;发送回复要有地方写,所以加一张 `outbox` 表;再加一个 `set_status()`。完整新版如下,和昨天相比多的部分我在 line-notes 里标了「新」:

```python
# agent-zero-lab/part05/ambient/store.py
"""事件表:webhook、邮件、定时任务进来的东西都先落到这里,再由 worker 慢慢处理。
Day 326 在 Day 325 的基础上加了:last_error 列、outbox 表、set_status()、BIZ_DB。"""
import sqlite3
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).parent
EVENTS_DB = HERE / "ambient.db"
BIZ_DB = HERE.parents[1] / "cloudledger" / "cloudledger.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    event_id     TEXT PRIMARY KEY,                 -- 去重键,同一件事永远是同一个值
    source       TEXT NOT NULL,                    -- webhook / email / cron
    kind         TEXT NOT NULL,                    -- ticket.created / email.received / digest.stale_tickets
    payload      TEXT NOT NULL,                    -- 原始内容,JSON 字符串
    status       TEXT NOT NULL DEFAULT 'pending',  -- pending / processing / waiting_human / done / dead
    attempts     INTEGER NOT NULL DEFAULT 0,       -- 被领过几次,领一次加一
    last_error   TEXT,                             -- 最近一次失败的原因,Day 326 新加
    received_at  TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id   TEXT NOT NULL UNIQUE,              -- 一张工单只发一次回复
    body        TEXT NOT NULL,
    sent_by     TEXT NOT NULL,
    sent_at     TEXT NOT NULL
);
"""


def now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def connect(path: Path = EVENTS_DB) -> sqlite3.Connection:
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)


def add_event(event_id: str, source: str, kind: str, payload: str) -> bool:
    """新事件返回 True;已经收过(重复投递)返回 False。"""
    with connect() as conn:
        cur = conn.execute(
            "INSERT OR IGNORE INTO events (event_id, source, kind, payload, received_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (event_id, source, kind, payload, now(), now()),
        )
        return cur.rowcount == 1


def set_status(event_id: str, status: str, error: str | None = None) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE events SET status = ?, last_error = ?, updated_at = ? WHERE event_id = ?",
            (status, error, now(), event_id),
        )
```

<div class="line-notes">

- `HERE = Path(__file__).parent` 新。这个文件所在的目录 `part05/ambient`。下面几个路径都从它算,不管你在哪个目录运行都不会错。
- `EVENTS_DB = HERE / "ambient.db"` 和昨天是同一个文件,只是换了个写法。
- `BIZ_DB = HERE.parents[1] / "cloudledger" / "cloudledger.db"` 新。`HERE.parents[0]` 是 `part05`,`parents[1]` 是 `agent-zero-lab`,拼起来就是 CloudLedger 业务库。昨天 `ingest.py` 里自己写了一个 `BIZ_DB`(从 `__file__` 算的 `parents[2]`),指向同一个文件;放进 `store.py` 以后,处理图和 worker 都从这里拿。
- `last_error   TEXT,                             -- 最近一次失败的原因,Day 326 新加` 新。允许为空,成功时就是 NULL。
- `CREATE TABLE IF NOT EXISTS outbox (` 新。「已经发给客户的回复」。今天不真的发邮件,写进这张表就算发出去了。
- `id          INTEGER PRIMARY KEY AUTOINCREMENT,` 自增主键,插入时不写这一列,SQLite 自动给 1、2、3……
- `ticket_id   TEXT NOT NULL UNIQUE,              -- 一张工单只发一次回复` 动作层的去重全靠这个 `UNIQUE`。后面 `send` 节点用 `INSERT OR IGNORE` 写它。
- `def connect(path: Path = EVENTS_DB) -> sqlite3.Connection:` 改。多了一个参数,默认连事件库,传 `store.BIZ_DB` 就连业务库,两个库共用一套 `row_factory` 设置。
- `def set_status(event_id: str, status: str, error: str | None = None) -> None:` 新。改状态时顺便刷新 `updated_at`,并记下错误。`str | None` 是「字符串或 None」,Day 46 讲过,相当于 TS 的 `string | null`。不传 error 就写进 NULL,这样一个事件重试成功后,上一次的错误会被清掉。

</div>

改完先别急着跑。昨天的 `ambient.db` 还在,我们来看会发生什么:

```bash
uv run python -c "import store; store.init(); store.set_status('webhook:evt_8f2c41', 'done')"
```

```text
Traceback (most recent call last):
  File "<string>", line 1, in <module>
  File ".../part05/ambient/store.py", line 62, in set_status
    conn.execute(
sqlite3.OperationalError: no such column: last_error
```

`init()` 没报错,`outbox` 表也建出来了,可 `events` 表还是昨天那个没有 `last_error` 的版本。原因在 `CREATE TABLE IF NOT EXISTS`:表已经存在,整条语句直接跳过,**它不会帮你补列**。这是用「建表脚本」管表结构时最常见的坑。事件库是运行数据,删了重来就行:

```bash
rm -f ambient.db
```

业务库可不能这么干。生产上改表结构要写 `ALTER TABLE` 迁移,练习 2 会用到一次,第七部分讲部署时再系统讲。

## 第 1 步:webhook 入口

### 签名:先单独算一遍

webhook 的 URL 谁都能 POST。上游和我们事先约定一个密钥,上游对每个请求体算一个 HMAC 签名放在请求头里,我们用同一个密钥再算一遍,对得上才收。这和 Day 84 验 JWT 第三段是同一个东西:HMAC-SHA256,密钥加内容,得到一串固定长度的十六进制,内容差一个字节结果就完全不同。

签名格式我照着 Stripe 的写:对「时间戳 + 点 + 原始请求体」算 HMAC-SHA256,请求头写成 `X-CloudLedger-Signature: t=时间戳,v1=签名`。把签名函数单独放一个文件,入口和模拟上游的脚本都用它:

```python
# agent-zero-lab/part05/ambient/sign.py
"""webhook 签名:上游和我们共用一个密钥,对「时间戳.原始请求体」算 HMAC-SHA256。"""
import hashlib
import hmac
import os

from dotenv import load_dotenv

load_dotenv()
SECRET = os.environ.get("WEBHOOK_SECRET", "dev-secret-change-me").encode()


def sign(ts: int, raw: bytes) -> str:
    return hmac.new(SECRET, f"{ts}.".encode() + raw, hashlib.sha256).hexdigest()


if __name__ == "__main__":
    body = b'{"id": "evt_T1012_created", "type": "ticket.created"}'
    print("原文签名:  ", sign(1792641600, body))
    print("再算一次:  ", sign(1792641600, body))
    print("改一个字节:", sign(1792641600, body.replace(b"T1012", b"T1013")))
    print("换时间戳:  ", sign(1792641601, body))
```

<div class="line-notes">

- `import hmac` 标准库的 HMAC 模块。浏览器里对应的是 `crypto.subtle.sign('HMAC', key, data)`。
- `load_dotenv()` 从当前目录往上找 `agent-zero-lab/.env`。
- `SECRET = os.environ.get("WEBHOOK_SECRET", "dev-secret-change-me").encode()` 密钥从环境变量读,没配就用一个开发用的默认值。上线时在 `.env` 里加 `WEBHOOK_SECRET=` 一串随机字符(`python -c "import secrets;print(secrets.token_hex(32))"` 能生成),并且把同一串配到上游系统里。`hmac` 要的是 bytes,所以 `.encode()`。
- `def sign(ts: int, raw: bytes) -> str:` 参数是时间戳和**原始字节**。为什么非得是原始字节,练习 3 会让你亲眼看到。
- `return hmac.new(SECRET, f"{ts}.".encode() + raw, hashlib.sha256).hexdigest()` 三个参数:密钥、要签的内容、哈希算法。内容是 `1792641600.` 这样的前缀拼上请求体。`hexdigest()` 输出 64 个十六进制字符。
- `body = b'{"id": "evt_T1012_created", "type": "ticket.created"}'` 字符串前面的 `b` 表示这是字节串(bytes),不是文本。网络上传的都是字节。
- `print("原文签名:  ", sign(1792641600, body))` `1792641600` 是 Unix 时间戳(从 1970 年起的秒数),对应北京时间 2026-10-22 12:00:00。和 JS 的 `Date.now()` 不同,这里是秒不是毫秒。
- `print("改一个字节:", sign(1792641600, body.replace(b"T1012", b"T1013")))` 只把工单号最后一位从 2 改成 3。
- `print("换时间戳:  ", sign(1792641601, body))` 内容不变,时间戳加 1 秒。

</div>

```bash
uv run python sign.py
```

```text
原文签名:   64a52046171ee92aa15d542eb790b29526fed399dae4d3247e93d39fb987df2b
再算一次:   64a52046171ee92aa15d542eb790b29526fed399dae4d3247e93d39fb987df2b
改一个字节: 11653ff31f8a87912353ef4eef212668fd0b36480fd2bd0658b1d7d887fb69bc
换时间戳:   f8ea270ec965564a4d25076b58a81bae1c78842a54b6c7b63dbfc181eacd523d
```

同样的输入两次结果一样,差一个字节或者差一秒结果全变。所以攻击者改了请求体里的工单号,签名就对不上;想伪造签名,他得先拿到密钥。

时间戳为什么要签进去?防**重放**:有人截获了一个合法请求,一小时后原样再发一次,签名是对的。把时间戳签进去,再规定「时间戳离现在超过 5 分钟就拒收」,旧请求就失效了。5 分钟之内的重放,靠昨天的事件 id 去重挡掉。

### 入口本身

入口只做三件事:验签、落库、回 202。不调模型,不查业务库。

```python
# agent-zero-lab/part05/ambient/webhook.py
"""接收「新工单」webhook:验签、去重、落库,立刻回 202。真正的处理交给 worker。

运行(在 part05/ambient 目录下):uv run uvicorn webhook:app --port 8326
"""
import hmac
import json
import time

from fastapi import FastAPI, Header, HTTPException, Request

import store
from sign import sign

TOLERANCE_S = 300

app = FastAPI()
store.init()


def verify(raw: bytes, header: str) -> None:
    try:
        parts = dict(p.split("=", 1) for p in header.split(","))
        ts, sig = int(parts["t"]), parts["v1"]
    except (KeyError, ValueError):
        raise HTTPException(400, "bad signature header")
    if abs(time.time() - ts) > TOLERANCE_S:
        raise HTTPException(400, "timestamp too old")
    if not hmac.compare_digest(sign(ts, raw), sig):
        raise HTTPException(401, "bad signature")


@app.post("/hooks/cloudledger", status_code=202)
async def receive(request: Request, x_cloudledger_signature: str = Header()) -> dict:
    raw = await request.body()
    verify(raw, x_cloudledger_signature)
    event = json.loads(raw)
    if event["type"] != "ticket.created":
        return {"accepted": False, "reason": "ignored type"}
    is_new = store.add_event(f"webhook:{event['id']}", "webhook", event["type"], raw.decode())
    return {"accepted": True, "duplicate": not is_new}
```

<div class="line-notes">

- `from fastapi import FastAPI, Header, HTTPException, Request` `Header` 从请求头取参数,`HTTPException` 是 Day 81 学的「抛出去就变成一个错误响应」,`Request` 是原始请求对象。
- `import store` 昨天写、今天改过的事件表模块。
- `TOLERANCE_S = 300` 时间戳最多允许差 5 分钟。Stripe 官方库默认的容忍度也是 5 分钟。设太小,两台机器时钟差几十秒就会误杀正常请求。
- `store.init()` 模块加载时建表。注意它只在**进程启动时**执行一次,后面「常见误区」里有我踩的坑。
- `parts = dict(p.split("=", 1) for p in header.split(","))` 把 `t=1792641600,v1=64a5…` 拆成 `{'t': '1792641600', 'v1': '64a5…'}`。先按逗号切成两段,每段按第一个等号切成键和值。`split("=", 1)` 只切第一个,防止值里本身带等号。
- `ts, sig = int(parts["t"]), parts["v1"]` 时间戳转成整数。缺 `t` 会抛 `KeyError`,`t=abc` 会抛 `ValueError`。
- `except (KeyError, ValueError):` 两种都归为「头格式不对」,回 400。不接住的话,异常会变成 500,上游看到 500 会以为我们挂了,开始重试。
- `if abs(time.time() - ts) > TOLERANCE_S:` `time.time()` 是当前时间戳(秒,带小数)。取绝对值,未来的时间戳也不接受。
- `if not hmac.compare_digest(sign(ts, raw), sig):` 自己算一遍签名,和请求头里的比。`compare_digest` 是「常数时间比较」:不管第几位不同,花的时间都一样。普通的 `==` 在第一位不同时就返回,攻击者可以靠测响应时间一位一位猜出签名。
- `raise HTTPException(401, "bad signature")` 401 表示「你没证明自己是谁」。
- `@app.post("/hooks/cloudledger", status_code=202)` 202 Accepted 的意思是「收到了,还没处理完」,比 200 更准确。上游只要看到 2xx 就不会重试。
- `async def receive(request: Request, x_cloudledger_signature: str = Header()) -> dict:` FastAPI 会把参数名的下划线换成连字符,去请求头里找 `x-cloudledger-signature`(请求头不区分大小写)。缺这个头时 FastAPI 自动回 422,Day 80 见过。
- `raw = await request.body()` 拿请求体的**原始字节**,不让 FastAPI 帮我们解析成 pydantic 模型。签名是对原始字节算的,解析再序列化回去,空格、键顺序都可能变。`await` 是因为读请求体要等网络,和 JS 里 `await req.arrayBuffer()` 一样。
- `verify(raw, x_cloudledger_signature)` 验不过就在里面抛 `HTTPException`,后面的代码不会执行。
- `event = json.loads(raw)` 验签通过才解析。`json.loads` 也收 bytes。
- `if event["type"] != "ticket.created":` 上游通常会把新建、更新、关闭各种事件都推到同一个地址。今天只处理新建,其他类型也回 2xx,只是不入队,否则上游会以为你挂了。
- `is_new = store.add_event(f"webhook:{event['id']}", "webhook", event["type"], raw.decode())` 和昨天 `ingest.py` 的 `from_webhook` 同一个去重键格式 `webhook:` + 事件 id。原始 JSON 整个存下来,以后排查「上游到底发了什么」有据可查。
- `return {"accepted": True, "duplicate": not is_new}` 重复的也回 202,只是在响应里说一句,方便上游排查。

</div>

### 模拟上游

再写一个模拟上游的脚本发测试请求。它支持「同一个事件发 N 次」,模拟上游超时重试:

```python
# agent-zero-lab/part05/ambient/send_webhook.py
"""模拟上游工单系统发 webhook。用法:uv run python send_webhook.py T1012 [重复次数]"""
import json
import sys
import time

import httpx

from sign import sign

ticket_id = sys.argv[1]
times = int(sys.argv[2]) if len(sys.argv) > 2 else 1
body = json.dumps(
    {"id": f"evt_{ticket_id}_created", "type": "ticket.created", "data": {"ticket_id": ticket_id}}
).encode()

for _ in range(times):  # 上游超时重试时,同一个事件会原样再发一次
    ts = int(time.time())
    r = httpx.post(
        "http://127.0.0.1:8326/hooks/cloudledger",
        content=body,
        headers={"content-type": "application/json", "x-cloudledger-signature": f"t={ts},v1={sign(ts, body)}"},
    )
    print(r.status_code, r.json())
```

<div class="line-notes">

- `import httpx` Python 的 HTTP 客户端,用法和 `fetch` 很像。Day 64 用过。
- `times = int(sys.argv[2]) if len(sys.argv) > 2 else 1` 第二个命令行参数是重复次数,不写就发一次。
- `{"id": f"evt_{ticket_id}_created", "type": "ticket.created", "data": {"ticket_id": ticket_id}}` 事件 id 由工单号拼出来,同一张工单每次发都是同一个 id,正好用来演示去重。昨天 `sources.py` 里的 `evt_8f2c41` 是随机串,真实系统(比如 Stripe)也是随机串,只是重试时不变。`data` 的结构和昨天一样,worker 从 `data.ticket_id` 取工单号。
- `for _ in range(times):  # 上游超时重试时,同一个事件会原样再发一次` `_` 表示「这个循环变量我用不到」。
- `ts = int(time.time())` 每次重发都重新取时间戳、重新签名。签名不一样,事件 id 一样,这才是真实重试的样子。
- `content=body,` 用 `content` 发原始字节,和签名用的是同一串。如果写成 `json=...`,httpx 会自己再序列化一遍,碰巧结果相同也不要依赖这一点。
- `print(r.status_code, r.json())` 打出状态码和响应体。

</div>

开两个终端。第一个终端起服务,保持它开着:

```bash
cd agent-zero-lab/part05/ambient
uv run uvicorn webhook:app --port 8326
```

```text
INFO:     Started server process [78432]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:8326 (Press CTRL+C to quit)
```

第二个终端(同一个目录)发四张工单,T1012 连发两次,T9999 是业务库里不存在的工单,故意的,后面用来看死信:

```bash
uv run python send_webhook.py T1012 2
uv run python send_webhook.py T1041
uv run python send_webhook.py T1003
uv run python send_webhook.py T9999
sqlite3 ambient.db "select event_id, status, attempts from events"
```

```text
202 {'accepted': True, 'duplicate': False}
202 {'accepted': True, 'duplicate': True}
202 {'accepted': True, 'duplicate': False}
202 {'accepted': True, 'duplicate': False}
202 {'accepted': True, 'duplicate': False}
webhook:evt_T1012_created|pending|0
webhook:evt_T1041_created|pending|0
webhook:evt_T1003_created|pending|0
webhook:evt_T9999_created|pending|0
```

T1012 第二次是 `duplicate: True`,表里只有一行。入口对 T9999 也回了 202,它不知道也不该知道这张工单存不存在,查业务库是 worker 的事。入口越笨越好,它是整个系统里唯一必须一直在线、必须快速响应的部分。

再用 curl 把几种拒绝都试一遍。`B` 是一个随便写的请求体:

```bash
B='{"id":"evt_x","type":"ticket.created","data":{"ticket_id":"T1012"}}'
curl -s -X POST localhost:8326/hooks/cloudledger -H "content-type: application/json" -H "x-cloudledger-signature: t=abc,v1=1" -d "$B" -w " %{http_code}\n"
curl -s -X POST localhost:8326/hooks/cloudledger -H "content-type: application/json" -H "x-cloudledger-signature: t=1,v1=1" -d "$B" -w " %{http_code}\n"
curl -s -X POST localhost:8326/hooks/cloudledger -H "content-type: application/json" -H "x-cloudledger-signature: t=$(date +%s),v1=abc" -d "$B" -w " %{http_code}\n"
curl -s -X POST localhost:8326/hooks/cloudledger -H "content-type: application/json" -d "$B" -w " %{http_code}\n"
```

```text
{"detail":"bad signature header"} 400
{"detail":"timestamp too old"} 400
{"detail":"bad signature"} 401
{"detail":[{"type":"missing","loc":["header","x-cloudledger-signature"],"msg":"Field required","input":null}]} 422
```

四行依次是:`t=abc` 不是数字;`t=1` 是 1970 年;时间戳对但签名乱写;干脆没带签名头,FastAPI 自己回了 422。`-w " %{http_code}\n"` 让 curl 在响应体后面打出状态码,`$(date +%s)` 是终端里取当前时间戳的写法。

还有一种类型过滤:发一个 `ticket.updated`(脚本 `send_other_type.py` 和 `send_webhook.py` 一样,只是 type 换了,这里不贴),回的是 `202 {'accepted': False, 'reason': 'ignored type'}`,表里不多一行。

业界有一个 [Standard Webhooks](https://standardwebhooks.com/) 规范,把签名标准化成 `webhook-id`、`webhook-timestamp`、`webhook-signature` 三个请求头,签名内容是 `id.timestamp.payload`。如果哪天你要设计自己公司对外的 webhook,照它来,别自己发明格式。今天的写法和它是一个思路。

## 第 2 步:处理一张工单的图

图和 Day 320 的退款审批是同一个套路,换个场景:读工单,模型起草回复,停下来等人,人同意就发送,人说算了就结束。

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="处理图:START 到 load,load 到 draft,draft 到 review。review 是 interrupt 暂停点,accept 走到 send 再到 END,ignore 直接到 END">
  <rect x="0" y="0" width="640" height="200" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12" text-anchor="middle">
    <rect x="20" y="80" width="70" height="34" rx="13" fill="none" stroke="var(--ink-soft)"/><text x="55" y="101" fill="var(--ink-soft)">START</text>
    <rect x="120" y="80" width="80" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="160" y="101" fill="var(--ink)">load</text>
    <rect x="230" y="80" width="80" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="270" y="101" fill="var(--ink)">draft</text>
    <rect x="340" y="80" width="100" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--ink)"/><text x="390" y="101" fill="var(--ink)">review ⏸</text>
    <rect x="490" y="30" width="80" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="530" y="51" fill="var(--ink)">send</text>
    <rect x="490" y="130" width="80" height="34" rx="13" fill="none" stroke="var(--ink-soft)"/><text x="530" y="151" fill="var(--ink-soft)">END</text>
  </g>
  <g stroke="var(--ink-soft)" fill="none">
    <line x1="90" y1="97" x2="120" y2="97"/><line x1="200" y1="97" x2="230" y2="97"/><line x1="310" y1="97" x2="340" y2="97"/>
    <line x1="440" y1="90" x2="490" y2="50"/><line x1="440" y1="104" x2="490" y2="145"/>
    <line x1="570" y1="47" x2="605" y2="47"/><line x1="605" y1="47" x2="605" y2="147"/><line x1="605" y1="147" x2="570" y2="147"/>
  </g>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">
    <text x="448" y="62">accept</text>
    <text x="448" y="140">ignore</text>
    <text x="120" y="140">读业务库</text>
    <text x="230" y="140">调一次模型</text>
    <text x="330" y="140">interrupt,进收件箱</text>
    <text x="490" y="20">写 outbox</text>
  </g>
</svg>
<figcaption>今天的处理图只有两种处理:accept 发送,ignore 结束。Day 327 会在 review 上再加 edit(人直接改)和 response(带着意见让模型重写)。</figcaption>
</figure>

收件箱条目的格式,我借用了 LangChain 开源过的 Agent Inbox 定义的 `HumanInterrupt` 结构:每条待办包含 `action_request`(Agent 想做什么动作、参数是什么)、`config`(允许人做哪几种处理)、`description`(给人看的一句话)。格式通用的好处是,明天的命令行收件箱换成网页,数据结构不用改。这个结构明天细讲,今天先照着写。

```python
# agent-zero-lab/part05/ambient/agent.py
"""后台处理一张工单:读工单 → 起草回复 → 停下来等人 → 人同意就发送,忽略就结束。
Day 327 会给 review 再加两种处理(edit、response)。"""
import sqlite3
from typing import Literal, TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import interrupt
from pydantic import BaseModel, Field

import store
from llm import get_llm

CKPT_DB = store.HERE / "checkpoints.db"


class Draft(BaseModel):
    category: Literal["refund", "billing", "invoice", "bug", "account", "other"]
    summary: str = Field(description="一句话概括客户的问题")
    reply: str = Field(description="给客户的回复草稿,中文,不超过 150 字,不承诺具体退款金额")


class TicketState(TypedDict):
    ticket_id: str
    ticket_text: str
    draft: dict  # Draft.model_dump()
    outcome: str


class TicketInput(TypedDict):
    ticket_id: str


def load(state: TicketState) -> dict:
    with store.connect(store.BIZ_DB) as conn:
        t = conn.execute("SELECT subject, body FROM tickets WHERE id = ?", (state["ticket_id"],)).fetchone()
    if t is None:
        raise ValueError(f"工单 {state['ticket_id']} 不存在")
    return {"ticket_text": f"{t['subject']}:{t['body']}"}


def draft(state: TicketState) -> dict:
    llm = get_llm().with_structured_output(Draft, method="function_calling")
    d = llm.invoke(
        "你是云簿 CloudLedger 的客服。给下面的工单分类并起草回复。\n\n"
        f"工单 {state['ticket_id']}:{state['ticket_text']}"
    )
    assert isinstance(d, Draft)
    return {"draft": d.model_dump()}


def review(state: TicketState) -> dict:
    d = state["draft"]
    # 收件箱条目:要做什么动作(action_request)、允许人怎么处理(config)、给人看的说明(description)
    answer = interrupt({
        "action_request": {"action": "send_reply", "args": {"ticket_id": state["ticket_id"], "reply": d["reply"]}},
        "config": {"allow_accept": True, "allow_edit": False, "allow_respond": False, "allow_ignore": True},
        "description": f"[{d['category']}] {d['summary']}",
    })
    if answer["type"] == "accept":
        return {"outcome": "send"}
    return {"outcome": "ignored"}


def after_review(state: TicketState) -> str:
    return "send" if state["outcome"] == "send" else END


def send(state: TicketState) -> dict:
    with store.connect() as conn:
        cur = conn.execute(
            "INSERT OR IGNORE INTO outbox (ticket_id, body, sent_by, sent_at) VALUES (?, ?, 'agent+reviewer', ?)",
            (state["ticket_id"], state["draft"]["reply"], store.now()),
        )
    return {"outcome": "sent" if cur.rowcount == 1 else "already_sent"}


builder = StateGraph(TicketState, input_schema=TicketInput)
builder.add_node("load", load)
builder.add_node("draft", draft)
builder.add_node("review", review)
builder.add_node("send", send)
builder.add_edge(START, "load")
builder.add_edge("load", "draft")
builder.add_edge("draft", "review")
builder.add_conditional_edges("review", after_review, ["send", END])
builder.add_edge("send", END)


def open_graph() -> tuple[CompiledStateGraph, sqlite3.Connection]:
    """返回 (graph, conn)。调用方用完要 conn.close()。"""
    conn = sqlite3.connect(CKPT_DB, check_same_thread=False)
    return builder.compile(checkpointer=SqliteSaver(conn)), conn


def thread_of(ticket_id: str) -> RunnableConfig:
    return {"configurable": {"thread_id": f"ticket-{ticket_id}"}}


if __name__ == "__main__":
    import sys

    graph, conn = open_graph()
    try:
        result = graph.invoke({"ticket_id": sys.argv[1]}, thread_of(sys.argv[1]))
        print(result["__interrupt__"][0].value)
    finally:
        conn.close()
```

<div class="line-notes">

- `from langgraph.graph.state import CompiledStateGraph` 编译好的图的类型,只用来写类型标注,让 worker 那边的参数不标红。
- `CKPT_DB = store.HERE / "checkpoints.db"` 第三个库:LangGraph 的执行状态,Day 318 的 SqliteSaver 往这里写。业务库、事件库、checkpoint 库三个分开,各管各的。
- `category: Literal["refund", "billing", "invoice", "bug", "account", "other"]` 六个类别,`Literal` 限定只能是这几个字符串之一,相当于 TS 的 `'refund' | 'billing' | ...`。
- `reply: str = Field(description="给客户的回复草稿,中文,不超过 150 字,不承诺具体退款金额")` 「不承诺具体金额」写进字段描述,模型会当作要求。钱的事交给人拍板,这是 Day 320 定下的规矩。
- `class TicketState(TypedDict):` 和 Day 320 一样不写 `total=False`,所有字段标成必填,节点里写 `state["draft"]` 才不标红。
- `draft: dict  # Draft.model_dump()` State 里只放能直接序列化的字典,不放 pydantic 对象,原因 Day 320 讲过。
- `class TicketInput(TypedDict):` 图的输入格式:调用方只给工单号。
- `with store.connect(store.BIZ_DB) as conn:` 用今天改过的 `connect`,传业务库路径。只读。
- `t = conn.execute("SELECT subject, body FROM tickets WHERE id = ?", (state["ticket_id"],)).fetchone()` 查不到时 `fetchone()` 返回 None。
- `raise ValueError(f"工单 {state['ticket_id']} 不存在")` 立刻抛一个看得懂的错。T9999 会走到这里,worker 怎么对待它,第 3 步见。
- `return {"ticket_text": f"{t['subject']}:{t['body']}"}` 实跑 T1012 拼出来是 `登录不了:收到的验证码一直提示过期,已经试了五六次了,急!`。
- `llm = get_llm().with_structured_output(Draft, method="function_calling")` 和 Day 320 的 `draft_proposal` 同一个写法。`.env` 里的 `LLM_EXTRA_BODY` 关掉了思考模式,不关会报 400,Day 312 踩过。
- `f"工单 {state['ticket_id']}:{state['ticket_text']}"` 提示词只有两行,今天重点不在提示词。我单独量了一次(把 `include_raw=True` 打开看 `usage_metadata`):输入 386 token,其中 252 命中缓存,输出 177 token。按 DeepSeek `deepseek-flash` 高峰价(2026 年 10 月查的[定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):缓存命中 0.04 元、未命中 2 元、输出 8 元,每百万 token)算:252×0.04 + 134×2 + 177×8 = 1694,除以一百万约 0.0017 元一次。一天一千张工单约 1.7 元。
- `assert isinstance(d, Draft)` 告诉类型检查器这里一定是 `Draft`,Day 320 讲过。
- `d = state["draft"]` interrupt 前面只读字典,没有副作用。恢复时这个节点会从第一行重新执行,Day 319 讲过,所以 interrupt 前面不能放写库、发请求这种代码。
- `answer = interrupt({` 图在这里暂停,花括号里的字典就是收件箱条目。恢复时 `Command(resume=...)` 的值会变成 `answer`。
- `"action_request": {"action": "send_reply", "args": {"ticket_id": state["ticket_id"], "reply": d["reply"]}},` Agent 想做的动作是 `send_reply`,参数是工单号和回复正文。
- `"config": {"allow_accept": True, "allow_edit": False, "allow_respond": False, "allow_ignore": True},` 今天只开两种处理。edit 和 respond 先关着,明天打开。
- `"description": f"[{d['category']}] {d['summary']}",` 给人扫一眼用的一句话。实跑 T1012 是 `[account] 客户登录时验证码反复提示过期,已尝试五六次,急需解决。`
- `if answer["type"] == "accept":` 人同意了就去发送。其他一律当 ignore。
- `def after_review(state: TicketState) -> str:` 条件边的路由函数,[Day 306](/blog/agent-zero/day-306-lg-conditional/) 讲过。
- `"INSERT OR IGNORE INTO outbox (ticket_id, body, sent_by, sent_at) VALUES (?, ?, 'agent+reviewer', ?)",` 「发送」这一步的幂等性靠 outbox 上 `ticket_id` 的 UNIQUE。真实系统里这里是调邮件服务的 API,一般要带一个幂等键(比如 `reply-T1012`),让邮件服务帮你挡重复,道理一样。
- `return {"outcome": "sent" if cur.rowcount == 1 else "already_sent"}` 第二次发同一张工单,`rowcount` 是 0,节点返回 `already_sent`,不报错。
- `builder = StateGraph(TicketState, input_schema=TicketInput)` 和 Day 320 一样声明输入格式。
- `builder.add_conditional_edges("review", after_review, ["send", END])` 第三个参数列出所有可能的去向。
- `conn = sqlite3.connect(CKPT_DB, check_same_thread=False)` Day 318 讲过,LangGraph 可能在别的线程里写 checkpoint,不加这个参数会偶发 `ProgrammingError`。
- `return builder.compile(checkpointer=SqliteSaver(conn)), conn` 把连接也返回,调用方负责关。
- `return {"configurable": {"thread_id": f"ticket-{ticket_id}"}}` **thread_id 用工单号,不用事件 id**。同一张工单不管被哪个事件触发、触发几次,都落在同一个 thread 上。这是第二处去重的基础,第 3 步马上用到。
- `result = graph.invoke({"ticket_id": sys.argv[1]}, thread_of(sys.argv[1]))` 直接运行这个文件时,跑一张工单到 review 停下,方便单独调图。
- `print(result["__interrupt__"][0].value)` 打出收件箱条目。

</div>

先不经过 worker,单独跑一张,确认图本身没问题:

```bash
uv run python agent.py T1012
```

```text
{'action_request': {'action': 'send_reply', 'args': {'ticket_id': 'T1012', 'reply': '您好,很抱歉给您带来不便。验证码提示过期通常与手机时间不同步、短信延迟或多次重复获取有关。建议您:1) 确认手机系统时间为自动同步;2) 只点击一次获取,等最新一条验证码到达后立即输入;3) 清除浏览器缓存或换用无痕窗口重试。若仍无法登录,请回复您的账号邮箱和大致尝试时间,我们为您核查验证码下发记录并协助处理。'}}, 'config': {'allow_accept': True, 'allow_edit': False, 'allow_respond': False, 'allow_ignore': True}, 'description': '[account] 客户登录时验证码反复提示过期,已尝试五六次,急需解决。'}
```

图停在了 review,收件箱条目长这样。你的回复内容会不一样,结构应该完全一致。这次调用是为了单独看图,它在 `checkpoints.db` 里留下了 `ticket-T1012` 这个 thread;接下来要让 worker 从零处理 T1012,所以先把 checkpoint 库删掉:

```bash
rm -f checkpoints.db
```

再顺手验证一下 `send` 的幂等。节点就是普通函数,直接调两次,模拟「回复发出去了,还没来得及把事件标成 done,worker 就崩了,重跑时又发一次」:

```python
# agent-zero-lab/part05/ambient/try_send.py
"""send 节点就是个普通函数:直接调两次,模拟「发完还没来得及标 done,worker 就崩了,重跑又发一次」。"""
import store
from agent import TicketState, send

state: TicketState = {
    "ticket_id": "T1012",
    "ticket_text": "登录不了:……",
    "draft": {"category": "account", "summary": "验证码过期", "reply": "您好,……(测试回复)"},
    "outcome": "send",
}
print("第 1 次:", send(state))
print("第 2 次:", send(state))
with store.connect() as conn:
    print("outbox 行数:", conn.execute("SELECT COUNT(*) FROM outbox WHERE ticket_id = 'T1012'").fetchone()[0])
    conn.execute("DELETE FROM outbox WHERE ticket_id = 'T1012'")  # 清掉测试数据,明天收件箱要真发
```

<div class="line-notes">

- `state: TicketState = {` 手工造一份 State。标上类型,写错字段名 Zed 会标红。
- `print("第 1 次:", send(state))` 直接调节点函数,不经过图。
- `print("第 2 次:", send(state))` 同一张工单再发一次。
- `print("outbox 行数:", conn.execute("SELECT COUNT(*) FROM outbox WHERE ticket_id = 'T1012'").fetchone()[0])` 数一下 T1012 在 outbox 里有几行。
- `conn.execute("DELETE FROM outbox WHERE ticket_id = 'T1012'")  # 清掉测试数据,明天收件箱要真发` 不清的话,明天真的 accept T1012 时会得到 `already_sent`。

</div>

```bash
uv run python try_send.py
```

```text
第 1 次: {'outcome': 'sent'}
第 2 次: {'outcome': 'already_sent'}
outbox 行数: 1
```

## 第 3 步:worker

worker 是一个死循环:从事件表里领一个 pending 事件,跑图,根据结果改状态。看着简单,今天大部分的坑集中在这里。先解决「领」这一个动作。

### 领任务:先 SELECT 再 UPDATE 会出什么事

最直觉的写法是两步:先查出最早的一个 pending,再把它改成 processing。只有一个 worker 时没问题。可后台服务为了扛量,常常同时跑好几个 worker;或者你用 crontab 每分钟起一个 `worker.py --once`,上一个还没跑完下一个就起来了。两个 worker 同时查,会查到同一行。

用两个线程模拟两个 worker,在一个临时库里试一下:

```python
# agent-zero-lab/part05/ambient/claim_race.py
"""两个 worker 同时领任务:先 SELECT 再 UPDATE 会不会领到同一个?用一个临时库 race.db 演示,不动 ambient.db。"""
import sqlite3
import sys
import threading
import time
from collections.abc import Callable
from pathlib import Path

DB = Path(__file__).with_name("race.db")


def setup() -> None:
    DB.unlink(missing_ok=True)
    with sqlite3.connect(DB) as conn:
        conn.execute("CREATE TABLE events (event_id TEXT PRIMARY KEY, status TEXT, received_at TEXT)")
        conn.executemany("INSERT INTO events VALUES (?, 'pending', ?)", [("evt_A", "10:00"), ("evt_B", "10:01")])


def claim_naive(conn: sqlite3.Connection) -> str | None:
    row = conn.execute("SELECT event_id FROM events WHERE status = 'pending' ORDER BY received_at LIMIT 1").fetchone()
    if row is None:
        return None
    time.sleep(0.1)  # 模拟两次查询之间的那一点点时间
    conn.execute("UPDATE events SET status = 'processing' WHERE event_id = ?", (row[0],))
    conn.commit()
    return row[0]


def claim_atomic(conn: sqlite3.Connection) -> str | None:
    row = conn.execute(
        "UPDATE events SET status = 'processing' "
        "WHERE event_id = (SELECT event_id FROM events WHERE status = 'pending' ORDER BY received_at LIMIT 1) "
        "RETURNING event_id"
    ).fetchone()
    conn.commit()
    return row[0] if row else None


def worker(name: str, claim: Callable[[sqlite3.Connection], str | None]) -> None:
    conn = sqlite3.connect(DB, timeout=10)
    print(name, "领到", claim(conn))
    conn.close()


if __name__ == "__main__":
    claim = claim_naive if sys.argv[1] == "naive" else claim_atomic
    setup()
    threads = [threading.Thread(target=worker, args=(f"worker-{i}", claim)) for i in (1, 2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
```

<div class="line-notes">

- `import threading` 标准库的线程。两个线程在同一个进程里同时跑,用来模拟两个 worker 进程;效果一样,写起来简单。
- `from collections.abc import Callable` 「函数」的类型。`Callable[[sqlite3.Connection], str | None]` 读作「收一个连接、返回字符串或 None 的函数」,相当于 TS 的 `(conn: Connection) => string | null`。
- `DB.unlink(missing_ok=True)` 删掉上次留下的 `race.db`,文件不存在也不报错。相当于终端里的 `rm -f`。
- `conn.executemany("INSERT INTO events VALUES (?, 'pending', ?)", [("evt_A", "10:00"), ("evt_B", "10:01")])` 一次插两行,`evt_A` 更早。
- `row = conn.execute("SELECT event_id FROM events WHERE status = 'pending' ORDER BY received_at LIMIT 1").fetchone()` 第一步:查最早的 pending。
- `time.sleep(0.1)  # 模拟两次查询之间的那一点点时间` 真实环境里这个间隔可能只有零点几毫秒,但只要有,就会撞上。这里放大到 100 毫秒,让它每次都撞。
- `conn.execute("UPDATE events SET status = 'processing' WHERE event_id = ?", (row[0],))` 第二步:改状态。这时另一个线程可能已经查到了同一行。
- `"UPDATE events SET status = 'processing' "` 原子版:挑和改写在一条语句里。
- `"WHERE event_id = (SELECT event_id FROM events WHERE status = 'pending' ORDER BY received_at LIMIT 1) "` 子查询挑出最早的 pending。SQLite 同一时刻只允许一个写者,一条写语句从头到尾不会被别的写者插进来,所以第二个 worker 进来时,`evt_A` 已经不是 pending 了。
- `"RETURNING event_id"` `RETURNING` 让 UPDATE 把改到的那一行返回来,相当于「改完顺便告诉我改了谁」。SQLite 3.35 起支持,我这台机器上 Python 3.12 自带的 SQLite 是 3.53.1(`sqlite3.sqlite_version` 能查)。
- `claim = claim_naive if sys.argv[1] == "naive" else claim_atomic` 命令行选用哪个版本。函数本身可以当值传来传去,和 JS 一样。
- `threads = [threading.Thread(target=worker, args=(f"worker-{i}", claim)) for i in (1, 2)]` 建两个线程,`target` 是线程要跑的函数,`args` 是传给它的参数。
- `t.start()` 启动。两个线程几乎同时开始跑。
- `t.join()` 等线程跑完,相当于 `await Promise.all(...)`。

</div>

```bash
uv run python claim_race.py naive
uv run python claim_race.py atomic
rm -f race.db
```

```text
worker-1 领到 evt_A
worker-2 领到 evt_A
worker-1 领到 evt_A
worker-2 领到 evt_B
```

前两行是朴素版:两个 worker 都领到了 `evt_A`,同一张工单会被处理两遍,模型调两次,收件箱里出现两条。后两行是原子版,各领各的。这和昨天「先 SELECT 再 INSERT 去重会漏」是同一个道理:**查和改之间有缝,就会被并发钻进来**,把它们塞进一条语句,交给数据库保证。

换成 Postgres 时,标准写法是 `SELECT ... FOR UPDATE SKIP LOCKED`:锁住自己挑中的行,别的 worker 跳过被锁的行去挑下一行,互不等待。第七部分 [Day 387](/blog/agent-zero/day-387-queue-basics/) 讲队列时会用到。

### worker 全文

worker 的状态变化先画出来,对着图读代码会轻松很多:

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="事件状态机:pending 被 claim 变成 processing;processing 跑到 interrupt 变 waiting_human,跑完变 done,失败且次数不到 3 回到 pending,失败第 3 次变 dead;processing 超过 10 分钟没动静被 requeue_stale 放回 pending">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12" text-anchor="middle">
    <rect x="20" y="90" width="90" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/><text x="65" y="111" fill="var(--ink)">pending</text>
    <rect x="200" y="90" width="110" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="255" y="111" fill="var(--ink)">processing</text>
    <rect x="430" y="20" width="130" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="495" y="41" fill="var(--ink)">waiting_human</text>
    <rect x="430" y="90" width="130" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/><text x="495" y="111" fill="var(--ink)">done</text>
    <rect x="430" y="160" width="130" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--ink)"/><text x="495" y="181" fill="var(--ink)">dead</text>
  </g>
  <g stroke="var(--ink-soft)" fill="none">
    <line x1="110" y1="100" x2="200" y2="100"/>
    <line x1="310" y1="100" x2="430" y2="40"/><line x1="310" y1="107" x2="430" y2="107"/><line x1="310" y1="115" x2="430" y2="175"/>
    <path d="M255 124 Q160 200 65 124" stroke-dasharray="4 3"/>
  </g>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">
    <text x="122" y="92">claim()</text>
    <text x="330" y="56">停在 interrupt</text>
    <text x="350" y="102">跑完</text>
    <text x="322" y="168">第 3 次失败</text>
    <text x="70" y="200">失败不到 3 次 / 卡住超 10 分钟</text>
    <text x="430" y="218">Day 327:人处理后 waiting_human → done</text>
  </g>
</svg>
<figcaption>一个事件的一生。虚线是「回到队列」的两条路:失败了等下次重试,或者领它的 worker 死了被放回来。</figcaption>
</figure>

```python
# agent-zero-lab/part05/ambient/worker.py
"""从 events 表领事件、跑处理图。用法:uv run python worker.py [--once]"""
import json
import sys
import time
from datetime import datetime, timedelta

from langgraph.graph.state import CompiledStateGraph

import store
from agent import open_graph, thread_of

MAX_ATTEMPTS = 3
STALE_MINUTES = 10


def claim() -> dict | None:
    """原子地领一个 pending 事件。两个 worker 同时跑也不会领到同一个。"""
    with store.connect() as conn:
        row = conn.execute(
            "UPDATE events SET status = 'processing', attempts = attempts + 1, updated_at = ? "
            "WHERE event_id = (SELECT event_id FROM events WHERE status = 'pending' ORDER BY received_at LIMIT 1) "
            "RETURNING event_id, kind, payload, attempts",
            (store.now(),),
        ).fetchone()
    return dict(row) if row else None


def requeue_stale() -> int:
    """worker 进程中途被杀,事件会一直卡在 processing。超过 10 分钟没动静的放回队列。"""
    cutoff = (datetime.now() - timedelta(minutes=STALE_MINUTES)).isoformat(timespec="seconds")
    with store.connect() as conn:
        cur = conn.execute(
            "UPDATE events SET status = 'pending', updated_at = ? WHERE status = 'processing' AND updated_at < ?",
            (store.now(), cutoff),
        )
    return cur.rowcount


def handle(graph: CompiledStateGraph, ev: dict) -> str:
    ticket_id = json.loads(ev["payload"])["data"]["ticket_id"]
    config = thread_of(ticket_id)
    snap = graph.get_state(config)
    if snap.interrupts or snap.values.get("outcome") in ("sent", "already_sent", "ignored"):
        return "done"  # 这张工单已经在收件箱里,或者已经处理完了
    if snap.next:
        result = graph.invoke(None, config)  # 上次跑到一半崩了:不给新输入,从停下的节点接着跑
    else:
        result = graph.invoke({"ticket_id": ticket_id}, config)
    return "waiting_human" if "__interrupt__" in result else "done"


def main() -> None:
    once = "--once" in sys.argv
    store.init()
    graph, conn = open_graph()
    try:
        while True:
            if n := requeue_stale():
                print(f"放回队列 {n} 个卡住的事件")
            ev = claim()
            if ev is None:
                if once:
                    break
                time.sleep(2)
                continue
            try:
                status = handle(graph, ev)
                store.set_status(ev["event_id"], status)
                print(ev["event_id"], "→", status)
            except Exception as e:
                status = "dead" if ev["attempts"] >= MAX_ATTEMPTS else "pending"
                store.set_status(ev["event_id"], status, f"{type(e).__name__}: {e}")
                print(ev["event_id"], f"第 {ev['attempts']} 次失败 → {status}:", e)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `MAX_ATTEMPTS = 3` 最多领三次。第三次还失败就进死信,不再自动重试,等人看。
- `STALE_MINUTES = 10` 一个事件在 processing 停留超过 10 分钟,就认为领它的 worker 已经死了。这个值要比最慢的一次正常处理长得多,不然正在跑的任务会被别人再领一次。今天一张工单 2 到 3 秒,10 分钟足够宽。
- `"UPDATE events SET status = 'processing', attempts = attempts + 1, updated_at = ? "` 和 `claim_race.py` 的原子版一样,只多了两件事:次数加一、刷新更新时间。
- `"RETURNING event_id, kind, payload, attempts",` 返回的 `attempts` 是加一之后的值,第一次领到时是 1。
- `return dict(row) if row else None` 没有 pending 时 `fetchone()` 是 None。
- `cutoff = (datetime.now() - timedelta(minutes=STALE_MINUTES)).isoformat(timespec="seconds")` 截止时间在 Python 里算,格式和 `store.now()` 完全一样,字符串比大小才成立。为什么不在 SQL 里算,下面「我第一版写错的两个地方」会讲,是个很隐蔽的坑。
- `"UPDATE events SET status = 'pending', updated_at = ? WHERE status = 'processing' AND updated_at < ?",` 卡在 processing、而且最后一次动静在 10 分钟前的,放回 pending。`attempts` 不清零,所以一个反复把 worker 搞崩的事件,最终也会进死信。
- `ticket_id = json.loads(ev["payload"])["data"]["ticket_id"]` 从原始 JSON 里取工单号。今天只有 webhook 事件;明天邮件和定时任务进来时,payload 结构不同,会在这里加一层按 `kind` 分派。
- `snap = graph.get_state(config)` 跑之前先看这张工单的 thread 现在什么状态,Day 317 学的。不花钱,不调模型。
- `if snap.interrupts or snap.values.get("outcome") in ("sent", "already_sent", "ignored"):` **第二处去重**。`interrupts` 不为空,说明已经停在收件箱里;`outcome` 是这三个之一,说明已经处理完了。两种情况都不再跑一遍模型,直接把这个事件标 done。事件 id 不同但工单相同的重复,就是在这里挡住的。
- `if snap.next:` `next` 不为空、又没有中断,说明上次跑到一半抛了异常,checkpoint 停在失败的那个节点前面。
- `result = graph.invoke(None, config)  # 上次跑到一半崩了:不给新输入,从停下的节点接着跑` 输入传 `None` 是 LangGraph 的约定:不给新输入,从 checkpoint 停的地方继续。前面成功的节点不会重跑,Day 318 演示过。
- `result = graph.invoke({"ticket_id": ticket_id}, config)` 全新的工单才从 START 开始。
- `return "waiting_human" if "__interrupt__" in result else "done"` 跑到 review 停下时,返回值里有 `__interrupt__` 这个键。
- `once = "--once" in sys.argv` `--once` 模式下队列空了就退出,方便测试,也方便放进 crontab 每分钟跑一次。
- `if n := requeue_stale():` `:=` 叫海象运算符,赋值的同时拿值做判断,相当于先 `n = requeue_stale()` 再 `if n:`。每领一个任务前清理一次卡住的事件,简单粗暴但够用。
- `time.sleep(2)` 不带 `--once` 时,队列空了睡 2 秒再看。这就是最简单的轮询。
- `except Exception as e:` 图里任何节点抛的异常都会冒到这里。worker 本身不能因为一个坏事件就整个崩掉。
- `status = "dead" if ev["attempts"] >= MAX_ATTEMPTS else "pending"` 没到三次就放回 pending,下一轮再领;到了就进死信。这里的重试是「立刻再来」,没有等待,练习 2 会加上退避。
- `store.set_status(ev["event_id"], status, f"{type(e).__name__}: {e}")` 错误类型和信息写进 `last_error`,排查时一眼能看到。`type(e).__name__` 是异常的类名,比如 `ValueError`。
- `conn.close()` 放在 `finally` 里,Ctrl+C 退出时也能把 checkpoint 库的连接关掉。

</div>

跑一次(这时 `ambient.db` 里是第 1 步留下的 4 个 pending,`checkpoints.db` 已经删了):

```bash
time uv run python worker.py --once
sqlite3 ambient.db "select event_id, status, attempts, last_error from events"
```

```text
webhook:evt_T1012_created → waiting_human
webhook:evt_T1041_created → waiting_human
webhook:evt_T1003_created → waiting_human
webhook:evt_T9999_created 第 1 次失败 → pending: 工单 T9999 不存在
webhook:evt_T9999_created 第 2 次失败 → pending: 工单 T9999 不存在
webhook:evt_T9999_created 第 3 次失败 → dead: 工单 T9999 不存在
uv run python worker.py --once  2.92s user 0.63s system 31% cpu 11.143 total
webhook:evt_T1012_created|waiting_human|1|
webhook:evt_T1041_created|waiting_human|1|
webhook:evt_T1003_created|waiting_human|1|
webhook:evt_T9999_created|dead|3|ValueError: 工单 T9999 不存在
```

三张正常工单各调一次模型,停在收件箱里;T9999 连试三次进了死信,不会无限循环。整个过程 11 秒,大部分时间在等模型。`time` 加在命令前面会在最后打出耗时。

「工单不存在」重试一百次也不会变好,连试三次纯属浪费,练习 1 会把它改成「一次就进死信」。

### 挡住第二个来源

上游有时会给同一张工单发两个不同 id 的事件,比如 CRM 系统也推了一次。事件 id 不同,第一处去重挡不住。手工插一个 `evt_T1012_from_crm` 试试:

```bash
sqlite3 ambient.db "insert into events (event_id,source,kind,payload,received_at,updated_at) values ('webhook:evt_T1012_from_crm','webhook','ticket.created','{\"id\":\"evt_T1012_from_crm\",\"type\":\"ticket.created\",\"data\":{\"ticket_id\":\"T1012\"}}','2026-10-22T15:00:00','2026-10-22T15:00:00')"
uv run python worker.py --once
```

```text
webhook:evt_T1012_from_crm → done
```

它被领到了,`get_state` 发现 `ticket-T1012` 已经停在收件箱里,直接标 done,没有调模型,收件箱里也没有第二条 T1012。这就是 thread_id 用工单号的意义。

### 跑到一半崩了,接着跑

让模型调用失败一次:命令行前面临时写一个错的 key。`load_dotenv()` 不会覆盖已经存在的环境变量,所以 `.env` 里的正确值不会把它盖掉。先发一张新工单 T1033(第一个终端的 uvicorn 要开着):

```bash
uv run python send_webhook.py T1033
LLM_API_KEY=sk-wrong uv run python worker.py --once
```

```text
202 {'accepted': True, 'duplicate': False}
webhook:evt_T1033_created 第 1 次失败 → pending: Error code: 401 - {'error': {'message': 'Authentication Fails, Your api key: ****rong is invalid (request_id: e87d4aef-8277-4ec1-931d-0037476d293d)', 'type': 'authentication_error', 'param': None, 'code': 'invalid_request_error'}}
webhook:evt_T1033_created 第 2 次失败 → pending: Error code: 401 - {'error': {'message': 'Authentication Fails, Your api key: ****rong is invalid (request_id: 88587f39-babe-4daa-be41-27d3a6e30dcf)', 'type': 'authentication_error', 'param': None, 'code': 'invalid_request_error'}}
webhook:evt_T1033_created 第 3 次失败 → dead: Error code: 401 - {'error': {'message': 'Authentication Fails, Your api key: ****rong is invalid (request_id: 660c380b-1975-4f71-a019-7ee29f02e70f)', 'type': 'authentication_error', 'param': None, 'code': 'invalid_request_error'}}
```

一口气连试三次就死了。这正是「立刻重试」的毛病:key 错了、服务欠费了,一秒内重试三次没有任何意义。看看这张工单的 thread 停在哪,写个小脚本:

```python
# agent-zero-lab/part05/ambient/peek.py
"""看一张工单的 thread 停在哪。用法:uv run python peek.py T1012"""
import sys

from agent import open_graph, thread_of

graph, conn = open_graph()
try:
    snap = graph.get_state(thread_of(sys.argv[1]))
    print("next:", snap.next)
    print("interrupts:", len(snap.interrupts))
    print("state 里的键:", sorted(snap.values))
finally:
    conn.close()
```

<div class="line-notes">

- `snap = graph.get_state(thread_of(sys.argv[1]))` 读这张工单最新的快照,不执行任何节点。
- `print("next:", snap.next)` 下一步要执行哪个节点,是一个元组。
- `print("interrupts:", len(snap.interrupts))` 有几个待处理的中断。
- `print("state 里的键:", sorted(snap.values))` 对字典 `sorted` 得到排好序的键列表,看 State 里已经有哪些字段。

</div>

```bash
uv run python peek.py T1033
uv run python peek.py T1012
uv run python peek.py T5555
```

```text
next: ('draft',)
interrupts: 0
state 里的键: ['ticket_id', 'ticket_text']
next: ('review',)
interrupts: 1
state 里的键: ['draft', 'ticket_id', 'ticket_text']
next: ()
interrupts: 0
state 里的键: []
```

三种 thread 一次看全了:

| | next | interrupts | worker 怎么办 |
| --- | --- | --- | --- |
| T1033 跑到一半崩了 | `('draft',)` | 0 | `invoke(None)` 接着跑 |
| T1012 停在收件箱 | `('review',)` | 1 | 不动,标 done |
| T5555 从没跑过 | `()` | 0 | 从 START 开始 |

T1033 的 `load` 已经做完(State 里有 `ticket_text`),停在 `draft` 前面。key 修好以后,把死信手动放回队列(这就是「重放死信」,真实系统里会做成一个管理命令),再跑 worker:

```bash
sqlite3 ambient.db "update events set status='pending', attempts=0, last_error=null where event_id='webhook:evt_T1033_created'"
uv run python worker.py --once
```

```text
webhook:evt_T1033_created → waiting_human
```

`load` 到底重跑了没有?用 Day 317 的 `get_state_history` 看看这条 thread 的快照历史:

```python
# agent-zero-lab/part05/ambient/history.py
"""按时间顺序列出一张工单的快照,看哪些节点真的执行过。用法:uv run python history.py T1033"""
import sys

from agent import open_graph, thread_of

graph, conn = open_graph()
try:
    for snap in reversed(list(graph.get_state_history(thread_of(sys.argv[1])))):
        step = (snap.metadata or {}).get("step")
        print(step, (snap.created_at or "")[11:19], "下一步", snap.next)
finally:
    conn.close()
```

<div class="line-notes">

- `for snap in reversed(list(graph.get_state_history(thread_of(sys.argv[1])))):` `get_state_history` 从新到旧给出快照,`reversed` 翻过来按时间顺序看。它返回的是生成器([Day 99](/blog/agent-zero/day-099-generators/)),要先 `list()` 才能 `reversed`。
- `step = (snap.metadata or {}).get("step")` `metadata` 类型上可能是 None,`or {}` 兜底,再用 `.get` 取 `step`,两处都不会让 basedpyright 标红。
- `print(step, (snap.created_at or "")[11:19], "下一步", snap.next)` `created_at` 是 ISO 时间字符串,`[11:19]` 截出时分秒。LangGraph 记的是 UTC,Day 320 见过。

</div>

```bash
uv run python history.py T1033
```

```text
-1 10:56:35 下一步 ('__start__',)
0 10:56:35 下一步 ('load',)
1 10:56:35 下一步 ('draft',)
2 10:56:56 下一步 ('review',)
```

`load` 只在 10:56:35 跑过一次(那是第一次失败前),21 秒后放回队列重跑时直接从 `draft` 开始。三次失败一共只调用了 0 次成功的模型(401 不计费),恢复后调了 1 次。

### 卡住的事件放回队列

最后试一下 `requeue_stale`。手工造一个「被某个 worker 领走以后那个 worker 死了」的事件:状态 processing,最后更新时间是今天早上 7 点。

```bash
date "+%FT%T"
sqlite3 ambient.db "insert into events (event_id,source,kind,payload,status,attempts,received_at,updated_at) values ('webhook:evt_T1007_created','webhook','ticket.created','{\"id\":\"evt_T1007_created\",\"type\":\"ticket.created\",\"data\":{\"ticket_id\":\"T1007\"}}','processing',1,'2026-10-22T07:00:00','2026-10-22T07:00:00')"
uv run python worker.py --once
sqlite3 ambient.db "select event_id, status, attempts from events"
```

```text
2026-10-22T18:58:01
放回队列 1 个卡住的事件
webhook:evt_T1007_created → waiting_human
webhook:evt_T1012_created|waiting_human|1
webhook:evt_T1041_created|waiting_human|1
webhook:evt_T1003_created|waiting_human|1
webhook:evt_T9999_created|dead|3
webhook:evt_T1012_from_crm|done|1
webhook:evt_T1033_created|waiting_human|1
webhook:evt_T1007_created|waiting_human|2
```

T1007 被放回队列、重新领到(`attempts` 从 1 变成 2)、正常处理进了收件箱。

### 我第一版写错的两个地方

**第一处:用 SQLite 的 `datetime()` 算截止时间。** 第一版 `requeue_stale` 我写的是 `updated_at < datetime('now', 'localtime', '-10 minutes')`,看着没毛病,卡住的事件却永远放不回来。拿刚才那个时间直接比一下:

```bash
sqlite3 ambient.db "select datetime('now','localtime','-10 minutes'), '2026-10-22T07:00:00' < datetime('now','localtime','-10 minutes')"
```

```text
2026-10-22 18:48:01|0
```

早上 7 点明明早于晚上 18:48,比较结果却是 0(假)。SQLite 的 `datetime()` 返回 `2026-10-22 18:48:01`,中间是**空格**;我们存的是 `2026-10-22T07:00:00`,中间是字母 **T**。SQLite 没有真正的时间类型,时间都是字符串,同一天的两个值比到第 11 个字符,`T` 的编码 0x54 比空格 0x20 大,所以存的值永远「更大」。改成在 Python 里按同一种格式算截止时间,问题就没了。全库统一一种时间格式,这条规矩值得记住。

**第二处:只看 `snap.next` 判断「已经在处理」。** 第一版的 `handle` 是这样的:

```python
    if snap.next:
        return "done"  # 第一版:next 不为空就当它「已经在收件箱里」
    result = graph.invoke({"ticket_id": ticket_id}, config)
```

本意是跳过已经停在收件箱里的工单。我用这一版在一个全新的库里只放 T9999 跑了一次:

```text
webhook:evt_T9999_created 第 1 次失败 → pending: 工单 T9999 不存在
webhook:evt_T9999_created → done
webhook:evt_T9999_created|done|2|
```

第一次失败后,checkpoint 里留下了 `next = ('load',)`;第二次领到时,我的代码以为它「正在收件箱里」,直接标了 done。一张失败的工单就这样被当成处理完了,没有报错,没有死信,谁也不会发现。换成 T1033 那种跑到一半的工单也一样会被吞掉。上面的表格已经说清了:**中断和崩溃在 `next` 上看起来一样,要靠 `interrupts` 区分**。

### 入口进程的一个坑

worker 跑着、uvicorn 也开着的时候,如果你为了重来把 `ambient.db` 删了,而没重启 uvicorn,下一个 webhook 会这样:

```bash
rm ambient.db
uv run python send_webhook.py T1012
```

```text
json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)
```

发送脚本这边报的是 JSON 解析错误,因为服务端回的是纯文本 `Internal Server Error`,不是 JSON。去第一个终端看 uvicorn 的日志才看到真正的原因:

```text
INFO:     127.0.0.1:64722 - "POST /hooks/cloudledger HTTP/1.1" 500 Internal Server Error
...
sqlite3.OperationalError: no such table: events
```

`store.init()` 只在 uvicorn 启动加载 `webhook.py` 时执行一次。库删了,新的空库文件被 `connect` 自动建出来,里面没有表。改了库结构或者删了库,记得重启入口进程。上游看到 500 会不停重试,所以这个坑在生产上会把错误放大。

(我演示完把库恢复了。你如果也删了,`Ctrl+C` 停掉 uvicorn 重启一次,再从第 1 步把 4 个事件发一遍、跑一遍 worker 就回到同样的状态。)

## 三处去重,放在一起看

今天的链路在三个地方挡重复,各防一种情况:

| 层 | 靠什么 | 防什么 | 今天哪里演示的 |
| --- | --- | --- | --- |
| ① 事件层 | `events.event_id` 主键 + `INSERT OR IGNORE` | 上游超时重试,同一个事件来好几次 | T1012 连发两次,第二次 `duplicate: True` |
| ② 业务层 | thread_id 用工单号 + 跑之前 `get_state` | 不同来源、不同事件 id 指向同一张工单 | `evt_T1012_from_crm → done` |
| ③ 动作层 | `outbox.ticket_id` UNIQUE | 发完还没标 done 就崩了,重跑又发 | `try_send.py` 第二次 `already_sent` |

再加上原子领取防两个 worker 抢同一个事件,这条链路就做到了「每件事效果上只处理一次」。这句话的专业说法是:**至少投递一次 + 幂等消费 = 效果上恰好一次**。没有哪个系统能真正保证「只投递一次」,能做的是让重复无害。这个话题 [Day 390](/blog/agent-zero/day-390-idempotency/) 会从队列和数据库的角度再讲一遍。

## 动手练习

**练习 1:永久错误不重试。** 「工单不存在」重试多少次都不会变好。在 `agent.py` 里定义一个 `PermanentError`,`load` 查不到工单时抛它;`worker.py` 捕获到 `PermanentError` 直接进死信。把 T9999 放回队列验证:只失败一次,`attempts` 是 1。改完的 `agent.py` 和 `worker.py` 明天接着用。

<details><summary>参考答案</summary>

`agent.py` 改两处。在 `CKPT_DB` 下面加一个异常类,`load` 里把 `ValueError` 换成它:

```python
class PermanentError(Exception):
    """重试多少次都不会好的错误(工单不存在、数据格式不对),worker 见到它直接进死信。"""


def load(state: TicketState) -> dict:
    with store.connect(store.BIZ_DB) as conn:
        t = conn.execute("SELECT subject, body FROM tickets WHERE id = ?", (state["ticket_id"],)).fetchone()
    if t is None:
        raise PermanentError(f"工单 {state['ticket_id']} 不存在")
    return {"ticket_text": f"{t['subject']}:{t['body']}"}
```

<div class="line-notes">

- `class PermanentError(Exception):` 自定义异常,继承 `Exception`,Day 36 学过。类体里只写 docstring 就够了,不需要别的东西。
- `raise PermanentError(f"工单 {state['ticket_id']} 不存在")` 节点里抛的异常,LangGraph 会原样往外抛,worker 能按类型接住。

</div>

`worker.py` 改两处:导入它,在通用的 `except Exception` **前面**加一个专门的分支:

```python
from agent import PermanentError, open_graph, thread_of
```

```python
            try:
                status = handle(graph, ev)
                store.set_status(ev["event_id"], status)
                print(ev["event_id"], "→", status)
            except PermanentError as e:
                store.set_status(ev["event_id"], "dead", f"PermanentError: {e}")
                print(ev["event_id"], "永久失败 → dead:", e)
            except Exception as e:
                status = "dead" if ev["attempts"] >= MAX_ATTEMPTS else "pending"
                store.set_status(ev["event_id"], status, f"{type(e).__name__}: {e}")
                print(ev["event_id"], f"第 {ev['attempts']} 次失败 → {status}:", e)
```

<div class="line-notes">

- `except PermanentError as e:` 多个 `except` 从上往下匹配,第一个对上的生效。`PermanentError` 也是 `Exception`,所以必须写在前面,写在后面永远轮不到它。
- `store.set_status(ev["event_id"], "dead", f"PermanentError: {e}")` 不管第几次,直接死信。
- `except Exception as e:` 其他错误(网络、限流、key 错)还按原来的重试三次。

</div>

```bash
sqlite3 ambient.db "update events set status='pending', attempts=0, last_error=null where event_id='webhook:evt_T9999_created'"
uv run python worker.py --once
sqlite3 ambient.db "select event_id, status, attempts, last_error from events where event_id like '%T9999%'"
```

```text
webhook:evt_T9999_created 永久失败 → dead: 工单 T9999 不存在
webhook:evt_T9999_created|dead|1|PermanentError: 工单 T9999 不存在
```

一次就进了死信。分清「暂时的错」和「永久的错」是重试的第一课,[Day 389](/blog/agent-zero/day-389-retry-errors/) 会专门讲哪些错误值得重试。

</details>

**练习 2:失败后等一会儿再领。** 现在失败了立刻再来,T1033 一秒内死了三次。给 `events` 加一列 `not_before`,失败时设成「现在 + 2 的 attempts 次方个单位」,`claim()` 只领 `not_before` 为空或已经过去的事件。单位默认 60 秒,从环境变量 `BACKOFF_UNIT_S` 读,测试时设成 2 秒。写成新文件 `worker_backoff.py`,别改 `worker.py`。用错的 key 和一张新工单 T1020 测。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/ambient/worker_backoff.py
"""练习 2:失败后等一会儿再领。第 n 次失败后等 2 的 n 次方个单位(默认 1 单位 = 60 秒)。
用法:uv run python worker_backoff.py [--once]"""
import os
import sqlite3
import sys
import time
from datetime import datetime, timedelta

import store
import worker
from agent import PermanentError, open_graph

UNIT_S = int(os.environ.get("BACKOFF_UNIT_S", "60"))


def add_column() -> None:
    with store.connect() as conn:
        try:
            conn.execute("ALTER TABLE events ADD COLUMN not_before TEXT")
        except sqlite3.OperationalError as e:
            if "duplicate column" not in str(e):
                raise


def claim() -> dict | None:
    with store.connect() as conn:
        row = conn.execute(
            "UPDATE events SET status = 'processing', attempts = attempts + 1, updated_at = ? "
            "WHERE event_id = (SELECT event_id FROM events WHERE status = 'pending' "
            "  AND (not_before IS NULL OR not_before <= ?) ORDER BY received_at LIMIT 1) "
            "RETURNING event_id, kind, payload, attempts",
            (store.now(), store.now()),
        ).fetchone()
    return dict(row) if row else None


def retry_later(event_id: str, attempts: int, error: str) -> str:
    wait = timedelta(seconds=UNIT_S * 2**attempts)
    not_before = (datetime.now() + wait).isoformat(timespec="seconds")
    with store.connect() as conn:
        conn.execute(
            "UPDATE events SET status = 'pending', last_error = ?, not_before = ?, updated_at = ? WHERE event_id = ?",
            (error, not_before, store.now(), event_id),
        )
    return not_before


def main() -> None:
    once = "--once" in sys.argv
    store.init()
    add_column()
    graph, conn = open_graph()
    try:
        while True:
            ev = claim()
            if ev is None:
                if once:
                    break
                time.sleep(2)
                continue
            try:
                status = worker.handle(graph, ev)
                store.set_status(ev["event_id"], status)
                print(store.now()[11:], ev["event_id"], "→", status)
            except PermanentError as e:
                store.set_status(ev["event_id"], "dead", f"PermanentError: {e}")
                print(store.now()[11:], ev["event_id"], "永久失败 → dead")
            except Exception as e:
                err = f"{type(e).__name__}: {e}"[:120]
                if ev["attempts"] >= worker.MAX_ATTEMPTS:
                    store.set_status(ev["event_id"], "dead", err)
                    print(store.now()[11:], ev["event_id"], f"第 {ev['attempts']} 次失败 → dead")
                else:
                    nb = retry_later(ev["event_id"], ev["attempts"], err)
                    print(store.now()[11:], ev["event_id"], f"第 {ev['attempts']} 次失败,{nb[11:]} 之前不再领")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `import worker` 复用 `worker.py` 里的 `handle` 和 `MAX_ATTEMPTS`。`worker.py` 有 main guard,导入时不会启动循环。
- `UNIT_S = int(os.environ.get("BACKOFF_UNIT_S", "60"))` 环境变量读出来都是字符串,要 `int()`。
- `conn.execute("ALTER TABLE events ADD COLUMN not_before TEXT")` 给已有的表加一列,已有的行这一列是 NULL。这是「准备」一节说的正经改表结构方式,不用删库。
- `if "duplicate column" not in str(e):` 列已经加过时 SQLite 报 `duplicate column name: not_before`,这种情况吞掉;其他错误照样抛出去。这样脚本可以反复跑。
- `"  AND (not_before IS NULL OR not_before <= ?) ORDER BY received_at LIMIT 1) "` 只领没设过等待时间、或等待时间已经过去的。时间格式和 `store.now()` 一致,字符串比较成立。
- `(store.now(), store.now()),` 两个 `?` 都是当前时间。
- `wait = timedelta(seconds=UNIT_S * 2**attempts)` `**` 是乘方。第 1 次失败等 2 个单位,第 2 次等 4 个单位。这叫指数退避,失败越多等得越久,给对方恢复的时间。
- `return not_before` 返回下次最早什么时候能领,打印用。
- `err = f"{type(e).__name__}: {e}"[:120]` 错误信息截到 120 个字符,401 那串太长了。
- `nb = retry_later(ev["event_id"], ev["attempts"], err)` 没到上限就设等待时间放回去。

</div>

```bash
uv run python send_webhook.py T1020
for i in 1 2 3 4 5 6 7 8 9 10; do LLM_API_KEY=sk-wrong BACKOFF_UNIT_S=2 uv run python worker_backoff.py --once; sleep 1.5; done
sqlite3 ambient.db "select event_id, status, attempts, not_before from events where event_id like '%T1020%'"
```

```text
202 {'accepted': True, 'duplicate': False}
18:59:27 webhook:evt_T1020_created 第 1 次失败,18:59:31 之前不再领
18:59:33 webhook:evt_T1020_created 第 2 次失败,18:59:41 之前不再领
18:59:44 webhook:evt_T1020_created 第 3 次失败 → dead
webhook:evt_T1020_created|dead|3|2026-10-22T18:59:41
```

终端里每 1.5 秒起一次 worker(每次启动本身要两秒左右),一共起了十次,只有三次真的领到了事件:第一次失败后等 4 秒,第二次失败后等 8 秒,中间几次起来发现「还没到时间」,什么都没做就退出了。单位换成默认的 60 秒,就是 2 分钟、4 分钟。真实系统里还会加一点随机抖动,防止一大批失败的事件在同一秒一起醒来。

</details>

**练习 3:观察会发生什么。** 签名为什么必须算在原始字节上?写 `ex_resign.py`:上游对 `json.dumps(data)` 签名,但实际发出去的是 `json.dumps(data, separators=(",", ":"))`(去掉了空格,比如中间某个代理重新序列化过)。内容解析出来完全一样,入口会怎么回?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/ambient/ex_resign.py
"""练习 3:签名算在「原始字节」上。内容一样、只是空格不同的 JSON,签名还对得上吗?"""
import json
import time

import httpx

from sign import sign

data = {"id": "evt_T1025_created", "type": "ticket.created", "data": {"ticket_id": "T1025"}}
signed = json.dumps(data).encode()                          # 上游签名时用的那串
sent = json.dumps(data, separators=(",", ":")).encode()     # 中间某一层把空格去掉了
print("签名用的:", signed)
print("实际发的:", sent)
print("解析后一样吗?", json.loads(signed) == json.loads(sent))

ts = int(time.time())
r = httpx.post(
    "http://127.0.0.1:8326/hooks/cloudledger",
    content=sent,
    headers={"content-type": "application/json", "x-cloudledger-signature": f"t={ts},v1={sign(ts, signed)}"},
)
print(r.status_code, r.json())
```

<div class="line-notes">

- `signed = json.dumps(data).encode()                          # 上游签名时用的那串` Python 默认在逗号和冒号后面加空格。
- `sent = json.dumps(data, separators=(",", ":")).encode()     # 中间某一层把空格去掉了` `separators` 指定分隔符,不带空格,相当于 JS 的 `JSON.stringify(data)` 的输出风格。
- `print("解析后一样吗?", json.loads(signed) == json.loads(sent))` 两个字典比较的是内容。
- `headers={"content-type": "application/json", "x-cloudledger-signature": f"t={ts},v1={sign(ts, signed)}"},` 签名用 `signed` 算,请求体发的却是 `sent`。

</div>

```bash
uv run python ex_resign.py
```

```text
签名用的: b'{"id": "evt_T1025_created", "type": "ticket.created", "data": {"ticket_id": "T1025"}}'
实际发的: b'{"id":"evt_T1025_created","type":"ticket.created","data":{"ticket_id":"T1025"}}'
解析后一样吗? True
401 {'detail': 'bad signature'}
```

内容一样,签名对不上。HMAC 只认字节,不认「意思」。反过来想:如果入口先 `json.loads` 再 `json.dumps` 回去验签,就会把上游发来的合法请求全部拒掉。所以入口必须用 `await request.body()` 拿原始字节,而不是让 FastAPI 先解析成 pydantic 模型。JS 写的上游默认输出没有空格,Python 默认有空格,两边各自重新序列化一次,这种 bug 就出来了。

</details>

**练习 4(开放题):看看收件箱里有什么。** 明天要做收件箱。先写一个只读的 `list_waiting.py`:列出事件表里所有 `waiting_human` 的事件,去图里取出各自的收件箱条目,打印工单号、等了多久(用 `updated_at`)和说明。想一想:如果事件表说在等人,图里却没有中断,该怎么提示?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/ambient/list_waiting.py
"""练习 4:列出所有在等人的工单,和图里停着的收件箱条目对一下。"""
import json

import store
from agent import open_graph, thread_of

with store.connect() as conn:
    rows = conn.execute(
        "SELECT event_id, payload, updated_at FROM events WHERE status = 'waiting_human' ORDER BY updated_at"
    ).fetchall()

graph, ckpt = open_graph()
try:
    for r in rows:
        ticket_id = json.loads(r["payload"])["data"]["ticket_id"]
        snap = graph.get_state(thread_of(ticket_id))
        if not snap.interrupts:
            print(f"{ticket_id}  事件表说在等人,图里却没有中断:{r['event_id']}")
            continue
        item = snap.interrupts[0].value
        print(f"{ticket_id}  {r['updated_at'][11:16]}  {item['description']}")
finally:
    ckpt.close()
```

<div class="line-notes">

- `"SELECT event_id, payload, updated_at FROM events WHERE status = 'waiting_human' ORDER BY updated_at"` 收件箱的「目录」从事件表来。checkpoint 库擅长回答「这个 thread 停在哪」,不擅长回答「现在有哪些 thread 在等人」。按 `updated_at` 排,等得最久的排最前面。
- `graph, ckpt = open_graph()` 连接变量叫 `ckpt`,避免和上面的 `conn` 混。
- `if not snap.interrupts:` 两边对不上,说明数据坏了(比如有人删过 checkpoint 库)。不要假装没事,打一行出来让人看。
- `item = snap.interrupts[0].value` 就是 `review` 节点里传给 `interrupt()` 的那个字典。
- `print(f"{ticket_id}  {r['updated_at'][11:16]}  {item['description']}")` `[11:16]` 截出时和分。

</div>

```bash
uv run python list_waiting.py
```

```text
T1012  18:55  [account] 客户登录时验证码反复提示过期,已尝试五六次,急需登录。
T1041  18:55  [refund] 客户反映10月8日被重复扣款,INV-2026-0026与INV-2026-0123金额相同,要求退还多扣的一笔。
T1003  18:55  [account] 客户要求取消订阅并停止自动续费。
T1033  18:56  [refund] 客户公司下月起停用云簿,年付订阅尚余数月,询问能否退还未使用部分费用(发票号 INV-2026-0107)。
T1007  18:58  [refund] 客户公司下月起停用云簿,年付订阅尚余数月,询问能否退还未使用部分费用(发票号 INV-2026-0116)。
```

五条待办都对得上。注意 T1003「取消订阅、停止自动续费」被分成了 account,按业务口径它更像 billing。模型分错类别的时候,让人在收件箱里过一眼的价值就体现出来了。等了多久这件事,真正有用的不是「几点进来的」,而是「已经等了几个小时」,明天的日报会算这个数。

</details>

**验收标准**:`webhook.py` 起得来,同一个事件发两次第二次 `duplicate: True`,curl 能复现 400、401、422;`worker.py --once` 跑完 T1012、T1041、T1003 进 `waiting_human`,T9999 进 `dead`;`evt_T1012_from_crm` 被标 done 而不调模型;能用 `peek.py` 的输出说清「停下等人」和「跑到一半崩了」的区别;能说出三处去重各防什么。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 幂等 | 同一个操作做一次和做多次结果一样。今天靠事件主键、thread_id 用工单号、outbox 的 UNIQUE 三处实现 |
| worker | 后台进程,循环从队列(这里是事件表)领任务来处理。和处理 HTTP 请求的进程分开 |
| HMAC 签名 | 用双方共享的密钥对内容算出的摘要。重算一遍对得上,说明请求确实来自持有密钥的一方,内容也没被改。Day 84 的 JWT 用的是同一个东西 |
| 重放攻击 | 截获一个合法请求后原样再发。签名挡不住,要靠时间戳容忍窗口加事件 id 去重 |
| 常数时间比较 | `hmac.compare_digest`:不管哪一位不同,比较花的时间都一样,防止靠测响应时间猜签名 |
| 202 Accepted | HTTP 状态码,表示「收到了,还没处理完」 |
| 原子领取 | 「挑一个任务」和「标记为我在处理」在一条语句里完成,防两个 worker 领到同一个 |
| RETURNING | 让 UPDATE/INSERT/DELETE 顺便返回改到的行。SQLite 3.35 起支持,Postgres 早就有 |
| 死信(dead letter) | 重试够次数仍然失败,不再自动处理,等人排查的任务 |
| 永久错误 / 暂时错误 | 永久的(工单不存在)重试也不会好,直接死信;暂时的(网络抖动、限流)值得等一会儿再试 |
| 指数退避 | 第 n 次失败后等 2 的 n 次方个单位再试,失败越多等得越久 |
| outbox | 「要发出去的东西」先写进的一张表,带唯一约束,保证同一个动作只做一次 |
| ALTER TABLE | 给已有的表加列、改名的 SQL 语句。`CREATE TABLE IF NOT EXISTS` 不会改已有的表 |

## 常见误区

**在 webhook 处理函数里直接跑 Agent。** 模型一次两三秒,慢的时候几十秒,上游等不到 2xx 就重试,你会同时跑好几份同一个任务。入口只验签、落库、回 202,今天实测一个请求几毫秒就回了。

**拿解析后的 JSON 去验签。** 练习 3 实测,只是空格不同,`401 bad signature`。签名算的是原始字节,入口要用 `await request.body()`。

**以为 `CREATE TABLE IF NOT EXISTS` 会补列。** 实测旧库上加了 `last_error` 列定义,`set_status` 报 `sqlite3.OperationalError: no such column: last_error`。表已存在时整条语句跳过。运行数据可以删库,业务数据要 `ALTER TABLE`。

**先 SELECT 再 UPDATE 领任务。** `claim_race.py` 实测两个 worker 都领到 `evt_A`。挑和改写进一条 `UPDATE ... RETURNING`。

**只靠事件 id 去重。** 同一张工单可能被不同上游、以不同事件 id 通知。thread_id 用工单号,跑之前 `get_state` 看一眼;发送动作本身也要幂等。

**把「中断」和「崩溃」当成一回事。** 两者 `next` 都不为空。我第一版只看 `next`,T9999 第一次失败后第二次被直接标成了 done。要看 `interrupts`。

**用格式不同的时间字符串比大小。** `'2026-10-22T07:00:00' < '2026-10-22 18:48:01'` 实测结果是 0。全库统一一种格式,截止时间在 Python 里用同一个函数算。

**所有失败都立刻重试。** 实测 key 错时一秒内连死三次。永久错误直接死信,暂时错误加退避。

**删了库不重启入口进程。** `store.init()` 只在启动时跑一次,之后每个请求都是 `no such table: events`,回 500,上游越重试越多。

## 学习资料

### 文档与文章

- [Stripe · 签名校验](https://docs.stripe.com/webhooks/signature):今天签名格式 `t=...,v1=...` 的出处,讲了时间戳容忍度和为什么要用原始请求体,20 分钟。
- [GitHub · Validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries):另一种签名头格式,也强调了常数时间比较,对比着看,10 分钟。
- [Standard Webhooks](https://standardwebhooks.com/):把 webhook 签名标准化的规范,设计自己的 webhook 时照它来,15 分钟。
- [Python · hmac 文档(中文)](https://docs.python.org/zh-cn/3/library/hmac.html):查 `hmac.new` 和 `compare_digest`,5 分钟。
- [FastAPI · 直接使用 Request(中文)](https://fastapi.tiangolo.com/zh/advanced/using-request-directly/):什么时候绕开 pydantic 直接拿原始请求,5 分钟。
- [SQLite · RETURNING](https://www.sqlite.org/lang_returning.html):`claim()` 用到的语法,5 分钟。
- [SQLite · 日期时间函数](https://www.sqlite.org/lang_datefunc.html):看 `datetime()` 返回的格式,理解今天那个空格和 T 的坑,10 分钟。
- [SQLite · ALTER TABLE](https://www.sqlite.org/lang_altertable.html):练习 2 加列用的,5 分钟。
- [LangGraph · Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts):复习「恢复时节点从头重新执行」那一段,今天 review 节点前面只读不写就是因为它,15 分钟。
- [Brandur · Implementing Stripe-like Idempotency Keys in Postgres](https://brandur.org/idempotency-keys):幂等键的经典长文,英文,今天先读前三节,40 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1CXarehE8k&autoplay=0&high_quality=1" title="跪求兄弟们了，写接口一定要支持幂等呀！" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员知正 · 跪求兄弟们了,写接口一定要支持幂等呀! · 12 分钟,讲接口重复调用的几种来源和常见做法(唯一索引、token、状态机),和今天三处去重对着看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV193hyzrEuE&autoplay=0&high_quality=1" title="怎么保证消息的幂等性？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员回家养猪 · 怎么保证消息的幂等性? · 2 分多钟,从消息队列的角度讲「重复投递必然发生,消费方要自己挡」,正好是 worker 的视角。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1zm4y1q7Jp&autoplay=0&high_quality=1" title="阿里一面——说说RabbitMQ死信队列、延时队列" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Java阿赫 · 阿里一面——说说RabbitMQ死信队列、延时队列 · 7 分钟,面试向。讲 RabbitMQ 里的死信和延时队列,对应今天的 dead 状态和练习 2 的退避,看概念,不用管 Java 代码。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/XAccGbtl3Z8" title="Idempotency - What it is and How to Implement it" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Alex Hyett · Idempotency - What it is and How to Implement it · 英文,讲幂等是什么、为什么 POST 不天然幂等、幂等键怎么用,配图清楚。</figcaption>
</figure>

### 书籍

- Gregor Hohpe、Bobby Woolf《Enterprise Integration Patterns》(Addison-Wesley,2003):「Idempotent Receiver」「Dead Letter Channel」「Competing Consumers」三个模式就是今天的事件去重、死信和多个 worker 抢任务。翻目录挑这三节看,英文原版。
- Martin Kleppmann《数据密集型应用系统设计》(原书 *Designing Data-Intensive Applications*,O'Reilly 2017;中译本中国电力出版社 2018)第 11 章「流处理」里讲容错和幂等的部分,讲清了「恰好一次」为什么只能靠幂等做出效果。

### 开源项目与代码

- [standard-webhooks/standard-webhooks](https://github.com/standard-webhooks/standard-webhooks):各种语言的签名和校验库,自己写验签之前先看看有没有现成的。
- [langchain-ai/agents-from-scratch](https://github.com/langchain-ai/agents-from-scratch):LangChain 官方的邮件助手后台 Agent,看它的图里人工审核那一步怎么写,和今天的 review 节点对照。

## 自测

1. 为什么 webhook 入口要先写表再回 202,而不是收到就直接跑图?说两个理由。

<details><summary>答案</summary>

一是模型调用慢,上游等不到 2xx 会超时重试,同一个任务被跑好几次。二是入口进程重启时,正在处理的任务会丢;先落库就有了持久的记录,worker 重启后接着处理。另外,去重、重试、死信只需要在 worker 一处实现,邮件和定时任务也能共用。

</details>

2. 签名已经能证明请求来自持有密钥的一方,为什么还要把时间戳签进去并检查它?

<details><summary>答案</summary>

签名挡不住重放:截获的合法请求原样再发,签名依然正确。把时间戳签进去(改了时间戳签名就对不上),再拒收离现在超过 5 分钟的请求,旧请求就失效了;5 分钟以内的重放靠事件 id 去重挡掉。

</details>

3. `claim()` 为什么要写成一条 `UPDATE ... WHERE event_id = (SELECT ...) RETURNING`?

<details><summary>答案</summary>

让「挑哪个」和「标记为我在处理」在一条语句里完成。拆成先 SELECT 再 UPDATE,两个 worker 可能同时查到同一行再各自处理,`claim_race.py` 实测两个都领到了 `evt_A`。SQLite 一条写语句执行期间不会被别的写者插进来;Postgres 上的对应写法是 `FOR UPDATE SKIP LOCKED`。

</details>

4. worker 拿到一个事件,`get_state` 看到 `next = ('draft',)`、`interrupts` 为空,这是什么情况,该怎么做?如果 `next = ('review',)`、`interrupts` 有一个呢?

<details><summary>答案</summary>

第一种是上次跑到一半崩了(比如 draft 调模型时 401),load 已经做完,checkpoint 停在 draft 前面,应该 `graph.invoke(None, config)` 从 draft 接着跑,不重跑 load。第二种是停在收件箱里等人,什么都不做,把这个事件标 done。只看 `next` 分不清这两种,我第一版就是这样把失败的 T9999 标成了 done。

</details>

5. **面试题**:「你们的后台 Agent 由 webhook 触发,起草客服回复后人工审核再发。说说你在哪几个地方处理重复,各防什么。」

<details><summary>答案</summary>

参考要点:三层。事件层:上游事件 id 做主键,`INSERT OR IGNORE`(Postgres 用 `ON CONFLICT DO NOTHING`),防上游超时重试的重复投递,重复的照样回 2xx。业务层:执行状态按业务主键组织(LangGraph 的 thread_id 用工单号),处理前先看这张工单是否已在收件箱或已处理,防不同来源、不同事件 id 指向同一张工单。动作层:发送本身幂等(outbox 唯一约束,或调邮件服务时带幂等键),防「已发送但没来得及标完成就崩了」后重跑造成重复发送。加分:领任务原子化,防两个 worker 抢同一个;能说出「至少投递一次 + 幂等消费 = 效果上恰好一次」;区分永久错误和暂时错误,暂时错误指数退避,永久错误直接死信。

</details>

6. 同一张工单连续失败,`attempts` 到 3 进了死信。修好原因以后怎么让它重新被处理?会不会从头再调一次模型?

<details><summary>答案</summary>

把事件改回 `status='pending'`、`attempts=0`、清空 `last_error`(今天用 sqlite3 命令手动做,真实系统里做成一个「重放死信」的管理命令)。worker 再领到时,`get_state` 看到 thread 停在失败的节点前面,用 `invoke(None)` 从那里接着跑,已经成功的节点不会重跑。实测 T1033 恢复后 `history.py` 显示 load 只在第一次跑过。

</details>

## 明天预告

明天是 [Day 327 · 后台 Agent(三):收件箱式审批](/blog/agent-zero/day-327-ambient-3/)。今天 5 张工单停在了 review,只能 accept 或 ignore,而且还没有一个给人用的入口。明天把收件箱做出来:讲清 Agent Inbox 的四种处理(accept、edit、response、ignore)和它现在在 LangChain 里的样子,给 review 节点补上 edit 和 response,写一个命令行收件箱把四种都走一遍;再让 Day 325 的定时任务也进收件箱,做一份「等得最久的是哪条、死信有几个」的日报。
