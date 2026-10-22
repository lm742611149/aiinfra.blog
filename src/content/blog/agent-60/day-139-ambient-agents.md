---
title: 'Day 139 · 后台 Agent:webhook、邮件与定时任务触发,收件箱式审批'
description: '不是所有 Agent 都长在聊天框里。新工单的 webhook、客服邮箱里的新邮件、每天早上的定时扫描都能把 Agent 叫起来;它在后台起草好回复,停下来进收件箱,等人批准、改写、提意见或忽略。今天把验签、去重、领任务、断点续跑、收件箱和死信一层层搭出来,全部实跑。'
pubDate: 2026-10-22
regime: none
tags: ['ambient-agent', 'webhook', 'human-in-the-loop', 'idempotency', 'agent-60']
series: 'agent-60'
day: 139
lang: 'zh'
---

## 今天要解决的问题

这是专题篇的一课,**建议在 [Day 25 · LangGraph 进阶:checkpoint、人工审批](/blog/agent-60/day-25-langgraph-hitl/) 之后读**。专题篇不按顺序学,哪篇和你手上的事有关就先看哪篇。

到 Day 25 为止,我们的 Agent 都是「有人在对面敲字」才动:你在命令行里输入一句话,它跑一圈,回你一句。真实的客服系统不是这样的。客户发了邮件、工单系统里新建了一张单、某张单已经挂了三周没人回,这些事情发生的时候,没有人坐在 Agent 对面。我们希望 Agent 自己醒过来,把能做的先做了(读工单、分类、起草回复),然后把需要人拍板的那一步放进一个收件箱,等客服有空的时候一条条处理。

LangChain 在 2025 年 1 月给这类东西起了个名字,叫 ambient agent(环境智能体,也有人翻成「后台智能体」):由环境里的事件触发,在后台持续运行,只在需要人的时候才打扰人。名字是新的,里面的工程问题却都很老:webhook 怎么验签、重复投递怎么去重、两个 worker 怎么不抢同一个任务、进程崩了怎么续上、失败三次的任务放哪。今天就是把这些老问题和 Day 25 学过的 interrupt 拼在一起。

学完今天,你要能做到:

1. 说清 webhook、邮件轮询、定时任务三种触发源各自的特点,以及为什么它们都应该先写进一张事件表,而不是收到就直接跑 Agent。
2. 写出一个带签名校验和防重放的 webhook 入口,能挡住伪造请求,能识别上游的重复投递。
3. 用 SQLite 实现「原子领任务、失败重试、超过次数进死信、卡住的任务放回队列」,并说出它和 Day 37 的任务队列是什么关系。
4. 用 LangGraph 的 interrupt 做一个收件箱:每条待办支持批准、修改后发送、提意见让 Agent 重写、忽略四种处理。
5. 让一个跑到一半崩掉的工单从失败的那个节点接着跑,而不是从头再来。

预计用时 4–5 小时。前置:Day 23 的 `cloudledger.db`(41 张工单、30 个客户),Day 24 的 `llm.py`,Day 25 的 checkpointer、thread_id、interrupt。Day 37 讲过的队列、重试、幂等如果看过会更顺,没看过也不影响。

## 聊天窗口之外的 Agent

先把「后台 Agent」和我们之前做的东西区分清楚。区别不在模型,也不在图怎么画,而在**谁来启动一次运行、结果交给谁**。

聊天式 Agent 是同步的:人发起,人等着,结果直接回给这个人。一次运行通常几秒到几十秒,中间出错了,人会看到报错然后重试。后台 Agent 是异步的:启动它的是一个事件(一条 webhook、一封邮件、一个时间点),没人在等它;它的产出也不一定直接给最终用户,更多时候是给内部的人一条待办。

LangChain 那篇介绍文章里把后台 Agent 找人的方式分成三种,我觉得这个分法很实用:

- **通知**(notify):告诉人发生了一件事,但 Agent 自己不处理。比如「这张工单提到了律师函,我没动它,你看一下」。
- **提问**(question):Agent 卡住了,需要人给一个它自己查不到的信息。比如「客户说的『上次那张发票』是哪张,系统里有三张候选」。
- **审核**(review):Agent 准备做一件有后果的事(发邮件给客户、建退款申请),先给人看一眼,人可以批准、修改或者否掉。

今天的 CloudLedger 场景主要是第三种:新工单进来,Agent 起草一封回复,客服在收件箱里过一遍再发。第一种和第二种在练习里做。

为什么不直接让 Agent 把回复发出去?因为你还没有足够的数据证明它可靠。Day 29 到 Day 35 一直在讲,Agent 上线前要有评测集和回归门禁;即使评测分数不错,对外发出去的每一个字都代表公司。收件箱是一个过渡形态:先让人审,同时把人的每一次修改都记下来(这就是 Day 144 要讲的反馈闭环),等某一类工单连续几百条都被原样批准,再考虑让这一类自动发出。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="后台 Agent 整体链路:webhook、邮件、定时任务三个触发源写入事件表,worker 领事件运行 LangGraph 图,图在 review 节点暂停进入收件箱,客服处理后结果写入 outbox">
  <rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12">
    <rect x="16" y="30" width="110" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="71" y="51" text-anchor="middle" fill="var(--ink)">webhook</text>
    <rect x="16" y="80" width="110" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="71" y="101" text-anchor="middle" fill="var(--ink)">邮件轮询</text>
    <rect x="16" y="130" width="110" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="71" y="151" text-anchor="middle" fill="var(--ink)">定时任务</text>
    <rect x="166" y="70" width="110" height="54" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
    <text x="221" y="93" text-anchor="middle" fill="var(--ink)">events 表</text>
    <text x="221" y="111" text-anchor="middle" font-size="10" fill="var(--ink-soft)">去重 · 状态 · 重试</text>
    <rect x="316" y="70" width="90" height="54" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
    <text x="361" y="93" text-anchor="middle" fill="var(--ink)">worker</text>
    <text x="361" y="111" text-anchor="middle" font-size="10" fill="var(--ink-soft)">领一个跑一个</text>
    <rect x="446" y="40" width="178" height="114" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="535" y="60" text-anchor="middle" fill="var(--ink)">LangGraph 图</text>
    <text x="535" y="82" text-anchor="middle" font-size="11" fill="var(--ink-soft)">load → draft → review</text>
    <text x="535" y="102" text-anchor="middle" font-size="11" fill="var(--ink-soft)">review 处 interrupt 暂停</text>
    <text x="535" y="122" text-anchor="middle" font-size="11" fill="var(--ink-soft)">状态存 checkpoints.db</text>
    <text x="535" y="142" text-anchor="middle" font-size="11" fill="var(--ink-soft)">thread = ticket-T1012</text>
    <rect x="446" y="196" width="80" height="40" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
    <text x="486" y="221" text-anchor="middle" fill="var(--ink)">收件箱</text>
    <rect x="556" y="196" width="68" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="590" y="221" text-anchor="middle" fill="var(--ink)">outbox</text>
  </g>
  <g stroke="var(--ink-soft)" fill="none">
    <line x1="126" y1="47" x2="166" y2="85"/><line x1="126" y1="97" x2="166" y2="97"/><line x1="126" y1="147" x2="166" y2="110"/>
    <line x1="276" y1="97" x2="316" y2="97"/><line x1="406" y1="97" x2="446" y2="97"/>
    <line x1="486" y1="154" x2="486" y2="196"/><line x1="526" y1="216" x2="556" y2="216"/>
  </g>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">
    <text x="146" y="190">先落库,立刻回 202</text>
    <text x="320" y="190">客服:批准 / 修改 / 提意见 / 忽略</text>
    <text x="16" y="256">琥珀色 = 外部系统,蓝色 = 调模型的部分</text>
  </g>
</svg>
<figcaption>三个触发源只负责往事件表里写一行,所有后续处理都由 worker 统一来做。人只出现在收件箱这一处。</figcaption>
</figure>

## 三种触发源

**webhook** 是对方系统推给你:工单系统新建了一张单,它往你配置好的 URL 发一个 POST 请求,正文是一段 JSON。优点是实时,缺点是你得有一个公网能访问的地址,还得面对这几个事实:对方不知道你处理得多慢,一般几秒到几十秒没收到 2xx 就算失败,然后重试;重试意味着同一个事件可能到你这里两次、三次;任何人知道了你的 URL 都可以往里发假数据。Stripe、GitHub、飞书、企业微信的 webhook 文档,翻来覆去讲的就是这三件事:快速返回、去重、验签。

**邮件** 一般是你去拉:每分钟连一次客服邮箱,用 IMAP 把未读邮件取下来。好处是不需要公网地址,邮箱本身就是一个持久化的队列;坏处是有延迟,而且邮件格式五花八门(HTML、附件、转发链、编码)。如果邮件量大,也可以用 Postmark、Cloudflare Email Workers 这类服务把收到的邮件转成 webhook,这样就和第一种合并了。

**定时任务** 是你给自己定的闹钟:每天早上 9 点扫一遍「超过 20 天还开着的工单」,每周一生成上周的处理报告。它没有外部输入,但同样要考虑重复:定时器有时会因为机器重启补跑一次,你手动又跑了一次,结果同一张工单被提醒了两遍。

这三种来源差别很大,但我建议**所有来源都先变成事件表里的一行**,然后由同一个 worker 处理。理由有三个。第一,webhook 入口只做验签和落库,几毫秒就能回 202,不会因为模型慢而让上游超时重试。第二,去重、重试、失败记录只需要写一遍。第三,出了问题你只需要看一张表:哪些事件还没处理、哪些在等人、哪些失败了。这其实就是 Day 37 讲的任务队列,只是今天为了少装东西,直接用 SQLite 当队列。量上来以后换成 Redis、RabbitMQ 或者云厂商的队列服务,结构不用变。

## 准备目录和依赖

今天的代码放在练习仓的 `topics/ambient-agents/` 下面,和 `w4/` 平级。业务库直接用 Day 23 造的那份 `w4/cloudledger/cloudledger.db`。

```bash
cd agent-60-lab
uv add langgraph langchain-openai langgraph-checkpoint-sqlite fastapi uvicorn
mkdir -p topics/ambient-agents
cd topics/ambient-agents
```

我实测用的版本是 langgraph 1.2.16、langgraph-checkpoint-sqlite 3.1.2、langchain-openai 1.7.2、fastapi 0.159.1、uvicorn 0.54.0,和 Day 25 一致。模型还是 `.env` 里的 DeepSeek `deepseek-flash`。

`llm.py` 直接从 Day 24 复制一份过来,内容一字不改,这样这个目录里的脚本都能按文件路径直接跑,不用处理跨目录导入:

```python
# agent-60-lab/topics/ambient-agents/llm.py
"""和 Day 24 的 w4/lgdemo/llm.py 一模一样,复制一份过来,省得跨目录导入。"""
import json
import os

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

load_dotenv()


def get_llm(temperature: float = 0) -> ChatOpenAI:
    return ChatOpenAI(
        model=os.environ["LLM_MODEL"],
        base_url=os.environ["LLM_BASE_URL"],
        api_key=os.environ["LLM_API_KEY"],
        temperature=temperature,
        extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY", "{}")),
    )
```

<div class="line-notes">

- `load_dotenv()` 从当前目录往上找 `.env`。在 `topics/ambient-agents` 下运行时,会一路找到练习仓根目录的 `.env`。它**不会覆盖已经存在的环境变量**,后面模拟「API key 写错」时就靠这一点:命令行前面临时写 `LLM_API_KEY=sk-wrong`,`.env` 里的正确值不会把它盖掉。
- `extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY", "{}")),` 关掉 DeepSeek 的思考模式。下面起草回复用的是 `with_structured_output(method="function_calling")`,会强制调用工具,不关会报 400,原因 Day 24 讲过。

</div>

## 第一层:事件表

先建两张表。`events` 是队列,每个外部事件一行;`outbox` 是「已经发给客户的回复」,今天不真的发邮件,写进这张表就算发出去了。

```python
# agent-60-lab/topics/ambient-agents/store.py
"""事件表:所有触发源(webhook、邮件、定时任务)进来的东西先落到这里,再由 worker 慢慢处理。"""
import sqlite3
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).parent
EVENTS_DB = HERE / "ambient.db"
BIZ_DB = HERE.parents[1] / "w4" / "cloudledger" / "cloudledger.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    event_id     TEXT PRIMARY KEY,          -- 上游给的唯一 id,去重全靠它
    source       TEXT NOT NULL,             -- webhook / email / cron
    kind         TEXT NOT NULL,             -- ticket.created / digest.daily ...
    payload      TEXT NOT NULL,             -- 原始 JSON
    status       TEXT NOT NULL DEFAULT 'pending',  -- pending / processing / waiting_human / done / ignored / dead
    attempts     INTEGER NOT NULL DEFAULT 0,
    last_error   TEXT,
    received_at  TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id   TEXT NOT NULL UNIQUE,       -- 一张工单只发一次回复,UNIQUE 挡住重复发送
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
    """返回 True 表示新事件,False 表示重复投递(已经收过)。"""
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

- `HERE = Path(__file__).parent` 这个文件所在的目录,也就是 `topics/ambient-agents`。下面的数据库路径都从它算,所以不管你在哪个目录运行,路径都不会错。
- `EVENTS_DB = HERE / "ambient.db"` 事件库和业务库分开放。业务库是 CloudLedger 自己的数据,事件库是我们这个 Agent 服务的运行数据,两者生命周期不一样:事件库可以随时删掉重来,业务库不行。
- `BIZ_DB = HERE.parents[1] / "w4" / "cloudledger" / "cloudledger.db"` `parents[0]` 是 `topics`,`parents[1]` 是练习仓根目录,拼起来就是 Day 23 那份库。
- `event_id     TEXT PRIMARY KEY,` 主键就是上游给的事件 id。去重的全部机制就是这一行:同一个 id 插第二次会冲突。
- `status       TEXT NOT NULL DEFAULT 'pending',` 六种状态。`waiting_human` 是今天新加的,表示 Agent 已经干完自己那部分,在等收件箱里的人;`dead` 是死信,重试够次数还失败的。
- `attempts     INTEGER NOT NULL DEFAULT 0,` 领一次加一。worker 靠它判断该重试还是该放进死信。
- `ticket_id   TEXT NOT NULL UNIQUE,` 第二道保险。就算事件去重漏了,同一张工单也只能往 outbox 里写一次。实测把同一张工单的 send 节点跑两遍,第二次 `rowcount` 是 0,节点返回 `already_sent`。
- `return datetime.now().isoformat(timespec="seconds")` 实测返回 `2026-10-22T11:10:34` 这种格式,中间是字母 T。这个细节后面会坑我们一次。
- `conn = sqlite3.connect(path, timeout=10)` webhook 进程和 worker 进程会同时写这个库。SQLite 同一时刻只允许一个写者,另一个会等锁,`timeout=10` 让它最多等 10 秒,默认是 5 秒。
- `conn.executescript(SCHEMA)` 一次执行多条 SQL。`IF NOT EXISTS` 让它可以反复调用。
- `"INSERT OR IGNORE INTO events (event_id, source, kind, payload, received_at, updated_at) "` 主键冲突时不报错,直接跳过。重复投递在这里被吃掉。
- `return cur.rowcount == 1` 插进去了 `rowcount` 是 1,被忽略了是 0。webhook 入口把它告诉上游,方便排查。
- `def set_status(event_id: str, status: str, error: str | None = None) -> None:` 每次改状态都刷新 `updated_at`。卡死检测靠的就是「多久没动静」。

</div>

## 第二层:webhook 入口

webhook 入口只做三件事:验签、落库、回 202。不调模型,不查业务库。

签名方案我照着 Stripe 的格式写:上游用双方共享的密钥,对「时间戳 + 点 + 原始请求体」算 HMAC-SHA256,放在请求头 `X-CloudLedger-Signature: t=1729580000,v1=<十六进制>` 里。时间戳的作用是防重放:有人截获了一个合法请求,一小时后原样再发一次,签名是对的,但时间戳太旧,会被拒绝。

业界还有一个叫 [Standard Webhooks](https://standardwebhooks.com/) 的规范,把这件事标准化成三个请求头 `webhook-id`、`webhook-timestamp`、`webhook-signature`,签名内容是 `id.timestamp.payload`。它的官网上列出的兼容实现里有 OpenAI、Anthropic、Twilio、PagerDuty 等。如果你在设计自己公司对外的 webhook,直接按它来,省得自己发明格式。

```python
# agent-60-lab/topics/ambient-agents/webhook.py
"""接收「新工单」webhook:验签、去重、落库,立刻回 202。真正的处理交给 worker。

运行:uv run uvicorn webhook:app --port 8139
"""
import hashlib
import hmac
import json
import os
import time

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request

import store

load_dotenv()
SECRET = os.environ.get("WEBHOOK_SECRET", "dev-secret-change-me").encode()
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
    expected = hmac.new(SECRET, f"{ts}.".encode() + raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        raise HTTPException(401, "bad signature")


@app.post("/hooks/cloudledger", status_code=202)
async def receive(request: Request, x_cloudledger_signature: str = Header()):
    raw = await request.body()
    verify(raw, x_cloudledger_signature)
    event = json.loads(raw)
    if event["type"] != "ticket.created":
        return {"accepted": False, "reason": "ignored type"}
    is_new = store.add_event(event["id"], "webhook", event["type"], raw.decode())
    return {"accepted": True, "duplicate": not is_new}
```

<div class="line-notes">

- `SECRET = os.environ.get("WEBHOOK_SECRET", "dev-secret-change-me").encode()` 密钥从环境变量读,本地没配就用一个开发用的默认值。上线前在 `.env` 里加 `WEBHOOK_SECRET=` 一串随机字符(`python -c "import secrets;print(secrets.token_hex(32))"` 生成),并且和上游系统配置成同一个。`hmac` 要的是 bytes,所以 `.encode()`。
- `TOLERANCE_S = 300` 允许 5 分钟的时钟误差,和 Stripe 官方库的默认容忍度一样。设得太小,两台机器时钟差几十秒就会误杀。
- `store.init()` 模块加载时建表。注意它只在**进程启动时**执行一次:我中途删掉 `ambient.db` 重来,没重启 uvicorn,结果后面每个请求都返回 500(表不存在)。改完库结构或者删库以后,记得重启这个进程。
- `parts = dict(p.split("=", 1) for p in header.split(","))` 把 `t=1761102634,v1=ab12…` 拆成 `{'t': '1761102634', 'v1': 'ab12…'}`。`split("=", 1)` 只切第一个等号,防止值里本身带等号。
- `except (KeyError, ValueError):` 头格式不对(缺 t、t 不是数字)统一回 400,不要让异常变成 500。实测发一个 `t=abc` 的头,返回 `{"detail":"bad signature header"}`。
- `if abs(time.time() - ts) > TOLERANCE_S:` 实测用 `t=1` 发请求(1970 年),返回 `400 {"detail":"timestamp too old"}`。取绝对值是因为未来的时间戳也不该接受。
- `expected = hmac.new(SECRET, f"{ts}.".encode() + raw, hashlib.sha256).hexdigest()` 签名算在**原始字节**上,不是解析后的 JSON。如果先 `json.loads` 再 `json.dumps`,空格和键顺序一变,签名就对不上了。这也是下面要用 `request.body()` 而不是让 FastAPI 帮你解析成 pydantic 模型的原因。
- `if not hmac.compare_digest(expected, sig):` 用常数时间比较,防止攻击者通过响应时间一位一位猜出签名。实测用当前时间戳配一个错误签名 `v1=abc`,返回 `401 {"detail":"bad signature"}`。
- `@app.post("/hooks/cloudledger", status_code=202)` 202 Accepted 的意思是「收到了,还没处理完」,比 200 更准确。上游只要看到 2xx 就不会重试。
- `async def receive(request: Request, x_cloudledger_signature: str = Header()):` FastAPI 会把参数名里的下划线换成连字符,去请求头里找 `x-cloudledger-signature`。缺这个头时 FastAPI 自动回 422。
- `if event["type"] != "ticket.created":` 上游通常会把各种事件都推到同一个地址(新建、更新、关闭)。今天只处理新建,其他的回 2xx 但不入队,否则上游会以为你挂了而不停重试。
- `is_new = store.add_event(event["id"], "webhook", event["type"], raw.decode())` 原始 JSON 整个存下来,以后排查「上游到底发了什么」时有据可查。
- `return {"accepted": True, "duplicate": not is_new}` 实测把同一个 T1012 事件连发两次,第一次 `{'accepted': True, 'duplicate': False}`,第二次 `{'accepted': True, 'duplicate': True}`,事件表里只有一行。

</div>

再写一个模拟上游的小脚本,用来发测试请求。它故意支持「同一个事件发 N 次」,模拟上游超时重试:

```python
# agent-60-lab/topics/ambient-agents/send_webhook.py
"""模拟上游系统发 webhook。用法:uv run python send_webhook.py T1012 [重复次数]"""
import hashlib
import hmac
import json
import os
import sys
import time

import httpx
from dotenv import load_dotenv

load_dotenv()
SECRET = os.environ.get("WEBHOOK_SECRET", "dev-secret-change-me").encode()

ticket_id = sys.argv[1]
times = int(sys.argv[2]) if len(sys.argv) > 2 else 1
body = json.dumps({"id": f"evt_{ticket_id}_created", "type": "ticket.created", "data": {"ticket_id": ticket_id}}).encode()

for _ in range(times):  # 上游超时重试时,同一个事件会原样再发一次
    ts = int(time.time())
    sig = hmac.new(SECRET, f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    r = httpx.post(
        "http://127.0.0.1:8139/hooks/cloudledger",
        content=body,
        headers={"content-type": "application/json", "x-cloudledger-signature": f"t={ts},v1={sig}"},
    )
    print(r.status_code, r.json())
```

<div class="line-notes">

- `body = json.dumps({"id": f"evt_{ticket_id}_created", "type": "ticket.created", "data": {"ticket_id": ticket_id}}).encode()` 事件 id 由工单号拼出来,所以同一张工单每次发都是同一个 id,正好用来演示去重。真实系统里事件 id 通常是一个随机串(Stripe 是 `evt_` 开头的随机 id),每个事件唯一,重试时不变。
- `for _ in range(times):` 每次循环重新算时间戳和签名。签名不一样,事件 id 一样,这才是真实重试的样子。
- `content=body,` 用 `content` 发原始字节,和签名用的完全是同一串。如果改成 `json=…`,httpx 会自己重新序列化一遍,虽然这里碰巧结果相同,但养成习惯很重要。

</div>

开两个终端。第一个起服务:

```bash
cd agent-60-lab/topics/ambient-agents
uv run uvicorn webhook:app --port 8139
```

第二个发四张工单,其中 T1012 连发两次,T9999 是一个业务库里不存在的工单(故意的,后面用来演示死信):

```bash
uv run python send_webhook.py T1012 2
uv run python send_webhook.py T1041
uv run python send_webhook.py T1003
uv run python send_webhook.py T9999
sqlite3 ambient.db "select event_id, status, attempts from events"
```

我实跑的输出:

```text
202 {'accepted': True, 'duplicate': False}
202 {'accepted': True, 'duplicate': True}
202 {'accepted': True, 'duplicate': False}
202 {'accepted': True, 'duplicate': False}
202 {'accepted': True, 'duplicate': False}
evt_T1012_created|pending|0
evt_T1041_created|pending|0
evt_T1003_created|pending|0
evt_T9999_created|pending|0
```

webhook 入口对 T9999 也回了 202。它不知道也不应该知道这张工单存不存在,查业务库是 worker 的事。入口越笨越好:它是整个系统里唯一必须一直在线、必须快速响应的部分。

## 第三层:处理一张工单的图

图和 Day 25 的退款审批是同一个套路,换了个场景:读工单 → 模型起草回复 → 停下来等人 → 按人的决定发送、重写或者结束。

收件箱条目的格式,我参考了 LangChain 开源的 Agent Inbox 定义的 `HumanInterrupt` 结构:每条待办包含 `action_request`(Agent 想做什么动作、参数是什么)、`config`(允许人做哪几种处理)、`description`(给人看的一句话说明)。人的回复是 `HumanResponse`,`type` 取 `accept`、`edit`、`response`、`ignore` 四种之一。好处是格式通用:你今天写的命令行收件箱,将来换成网页,数据结构不用改。

需要说明一下现状:2026 年 10 月我去看的时候,[langchain-ai/agent-inbox](https://github.com/langchain-ai/agent-inbox) 这个仓库已经是只读的归档状态,LangChain 官方现在更推荐的是 LangChain 1.x 里的 `HumanInTheLoopMiddleware`,它给工具调用加审批,决定类型叫 `approve`、`edit`、`reject`、`respond`。名字不同,意思差不多。我们这里没有用 `create_agent`,是自己画的图,所以借用 Agent Inbox 那套结构自己实现。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="review 节点的四种处理:accept 和 edit 走向 send,response 回到 draft 重写后再次进入 review,ignore 直接结束">
  <rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12" text-anchor="middle">
    <rect x="20" y="88" width="70" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/><text x="55" y="109" fill="var(--ink)">load</text>
    <rect x="130" y="88" width="80" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="170" y="109" fill="var(--ink)">draft</text>
    <rect x="260" y="88" width="100" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="310" y="109" fill="var(--ink)">review ⏸</text>
    <rect x="470" y="40" width="80" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="510" y="61" fill="var(--ink)">send</text>
    <rect x="470" y="146" width="80" height="34" rx="13" fill="none" stroke="var(--ink-soft)"/><text x="510" y="167" fill="var(--ink-soft)">END</text>
  </g>
  <g stroke="var(--ink-soft)" fill="none">
    <line x1="90" y1="105" x2="130" y2="105"/><line x1="210" y1="105" x2="260" y2="105"/>
    <line x1="360" y1="98" x2="470" y2="57"/><line x1="360" y1="114" x2="470" y2="163"/>
    <line x1="550" y1="57" x2="600" y2="57"/><line x1="600" y1="57" x2="600" y2="163"/><line x1="600" y1="163" x2="550" y2="163"/>
  </g>
  <path d="M310 122 Q240 200 170 122" stroke="var(--mem)" stroke-dasharray="4 3" fill="none"/>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">
    <text x="372" y="60">accept / edit</text>
    <text x="392" y="160">ignore</text>
    <text x="180" y="190">response:带着意见重写,再进一次 review</text>
  </g>
</svg>
<figcaption>四种处理里只有 response 会再调一次模型。edit 是人直接改好了,不需要模型参与。</figcaption>
</figure>

```python
# agent-60-lab/topics/ambient-agents/agent.py
"""后台处理一张工单:读工单 → 起草回复 → 停下来进收件箱等人 → 按人的处理结果发送、重写或忽略。"""
import sqlite3
from typing import Literal

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt
from pydantic import BaseModel, Field
from typing_extensions import TypedDict

import store
from llm import get_llm

CKPT_DB = store.HERE / "checkpoints.db"


class Draft(BaseModel):
    category: Literal["refund", "billing", "invoice", "bug", "account", "other"]  # 和 Day 28 同一套类别
    summary: str = Field(description="一句话概括客户的问题")
    reply: str = Field(description="给客户的回复草稿,中文,不超过 150 字,不承诺具体退款金额")


class TicketState(TypedDict, total=False):
    ticket_id: str
    ticket_text: str
    draft: dict
    feedback: list[str]
    outcome: str


def load(state: TicketState) -> dict:
    with store.connect(store.BIZ_DB) as conn:
        t = conn.execute("SELECT subject, body FROM tickets WHERE id = ?", (state["ticket_id"],)).fetchone()
    return {"ticket_text": f"{t['subject']}:{t['body']}", "feedback": []}


def draft(state: TicketState) -> dict:
    llm = get_llm().with_structured_output(Draft, method="function_calling")
    notes = "\n".join(f"- {f}" for f in state.get("feedback", []))
    prompt = (
        "你是云簿 CloudLedger 的客服。给下面的工单分类并起草回复。\n\n"
        f"工单 {state['ticket_id']}:{state['ticket_text']}\n"
    )
    if notes:
        prompt += f"\n客服主管对上一版草稿的意见,必须照改:\n{notes}\n"
    return {"draft": llm.invoke(prompt).model_dump()}


def review(state: TicketState) -> dict:
    d = state["draft"]
    # 收件箱条目:要做什么动作(action_request)、允许人怎么处理(config)、给人看的说明(description)
    answer = interrupt(
        {
            "action_request": {"action": "send_reply", "args": {"ticket_id": state["ticket_id"], "reply": d["reply"]}},
            "config": {"allow_accept": True, "allow_edit": True, "allow_respond": True, "allow_ignore": True},
            "description": f"[{d['category']}] {d['summary']}",
        }
    )
    kind = answer["type"]
    if kind == "accept":
        return {"outcome": "send", "draft": d}
    if kind == "edit":
        return {"outcome": "send", "draft": {**d, "reply": answer["args"]["args"]["reply"]}}
    if kind == "response":
        return {"outcome": "redraft", "feedback": state.get("feedback", []) + [answer["args"]]}
    return {"outcome": "ignored"}


def after_review(state: TicketState) -> str:
    return {"send": "send", "redraft": "draft"}.get(state["outcome"], END)


def send(state: TicketState) -> dict:
    with store.connect() as conn:
        cur = conn.execute(
            "INSERT OR IGNORE INTO outbox (ticket_id, body, sent_by, sent_at) VALUES (?, ?, 'agent+reviewer', ?)",
            (state["ticket_id"], state["draft"]["reply"], store.now()),
        )
    return {"outcome": "sent" if cur.rowcount == 1 else "already_sent"}


builder = StateGraph(TicketState)
builder.add_node("load", load)
builder.add_node("draft", draft)
builder.add_node("review", review)
builder.add_node("send", send)
builder.add_edge(START, "load")
builder.add_edge("load", "draft")
builder.add_edge("draft", "review")
builder.add_conditional_edges("review", after_review, ["send", "draft", END])
builder.add_edge("send", END)


def open_graph():
    """返回 (graph, conn)。调用方用完要 conn.close()。"""
    conn = sqlite3.connect(CKPT_DB, check_same_thread=False)
    return builder.compile(checkpointer=SqliteSaver(conn)), conn


def thread_of(ticket_id: str) -> dict:
    return {"configurable": {"thread_id": f"ticket-{ticket_id}"}}
```

<div class="line-notes">

- `CKPT_DB = store.HERE / "checkpoints.db"` 第三个库:LangGraph 的执行状态。到今天结束时实测这个文件 94 KB,`checkpoints` 表里 25 行,分属 5 个 thread。
- `category: Literal["refund", "billing", "invoice", "bug", "account", "other"]  # 和 Day 28 同一套类别` 用 Day 28 的六个类别,以后这条链路和工单分流 Agent 的评测集可以共用。
- `reply: str = Field(description="给客户的回复草稿,中文,不超过 150 字,不承诺具体退款金额")` 「不承诺具体金额」写进字段描述。实测 T1041(重复扣款)第一版草稿写的是「我们正在核对是否为重复扣款,核实后会有专员跟进处理退款事宜」,确实没写金额。
- `feedback: list[str]` 客服的每一条修改意见都追加进来。重写时全部带上,防止改了第二条忘了第一条。
- `t = conn.execute("SELECT subject, body FROM tickets WHERE id = ?", (state["ticket_id"],)).fetchone()` 工单不存在时 `t` 是 `None`,下一行 `t['subject']` 抛 `TypeError: 'NoneType' object is not subscriptable`。这里故意没处理,用来演示 worker 的重试和死信。练习 2 会让你把它改成正确的做法。
- `return {"ticket_text": f"{t['subject']}:{t['body']}", "feedback": []}` 实测 T1012 拼出来是 `登录不了:收到的验证码一直提示过期,已经试了五六次了,急!`。
- `llm = get_llm().with_structured_output(Draft, method="function_calling")` 和 Day 25 的 `draft_proposal` 同一个写法。实测一次调用输入 386 token(其中 252 命中缓存)、输出 156 token。按 `.env` 里 deepseek-flash 的价格(每百万 token 命中 0.04 元、未命中 2 元、输出 8 元)算:252×0.04 + 134×2 + 156×8 ≈ 1526,再除以一百万,一次约 0.0015 元。一天一千张工单约 1.5 元。
- `if notes:` 只有被提过意见才加这一段。第一次起草时提示词里不出现「主管意见」字样,免得模型以为有人不满意。
- `return {"draft": llm.invoke(prompt).model_dump()}` 转成字典再进 State,原因 Day 25 讲过:checkpoint 反序列化自定义类会有警告,将来版本会拒绝。
- `answer = interrupt(` 第一次执行到这里,图暂停,花括号里的字典成为收件箱条目。恢复时 `Command(resume=…)` 的值变成 `answer`,然后**这个节点从第一行重新执行一遍**,所以 interrupt 前面不能放有副作用的代码。
- `"action_request": {"action": "send_reply", "args": {"ticket_id": state["ticket_id"], "reply": d["reply"]}},` 实测 `inbox.py list` 打印出的 T1012 条目里,`args.reply` 是一段 140 来字的回复,开头是「您好,非常抱歉给您带来不便。验证码过期通常与手机时间不同步、短信延迟或多次重复获取有关」。
- `"config": {"allow_accept": True, "allow_edit": True, "allow_respond": True, "allow_ignore": True},` 四种处理全开。真实系统里可以按类别收紧,比如退款类不允许 accept,必须 edit(逼着人至少看一眼金额)。
- `"description": f"[{d['category']}] {d['summary']}",` 实测三张工单的说明分别是 `[account] 客户登录时验证码反复提示过期,多次尝试仍无法登录,情况紧急。`、`[refund] 客户反映10月8日被重复扣款,INV-2026-0026与INV-2026-0123金额相同,要求退还多扣的一笔。`、`[account] 客户要求取消订阅并停止自动续费。` 最后一条按 Day 28 的口径应该是 billing,模型分成了 account。收件箱里一眼就能看到这种分类错误,这也是让人审的价值之一。
- `return {"outcome": "send", "draft": {**d, "reply": answer["args"]["args"]["reply"]}}` edit 时人送回来的是一个完整的 `action_request`,回复正文在 `args.args.reply` 两层下面。`{**d, "reply": …}` 保留类别和摘要,只换正文。
- `return {"outcome": "redraft", "feedback": state.get("feedback", []) + [answer["args"]]}` response 时 `args` 就是人写的那句话。用 `+` 生成新列表,不要 `.append()` 原地改 State 里的列表。
- `return {"outcome": "ignored"}` ignore:不发任何东西,图直接结束。工单本身还开着,由人线下处理。
- `return {"send": "send", "redraft": "draft"}.get(state["outcome"], END)` 用字典查表代替三个 if。查不到(也就是 ignored)就去 END。
- `"INSERT OR IGNORE INTO outbox (ticket_id, body, sent_by, sent_at) VALUES (?, ?, 'agent+reviewer', ?)",` 「发送」这一步的幂等性靠 outbox 的 UNIQUE。真实系统里这里是调邮件服务的 API,要带一个幂等键(比如 `reply-T1012`),让邮件服务帮你挡重复,道理一样。
- `builder.add_conditional_edges("review", after_review, ["send", "draft", END])` 第三个参数列出所有可能的去向,LangGraph 画图和校验时会用到。`draft` 在里面,所以图里有一个 review → draft 的环。
- `conn = sqlite3.connect(CKPT_DB, check_same_thread=False)` 和 Day 25 一样,LangGraph 可能在别的线程写 checkpoint。
- `return {"configurable": {"thread_id": f"ticket-{ticket_id}"}}` **thread_id 用业务主键(工单号),不用事件 id**。同一张工单不管被哪个事件触发、触发几次,都落在同一个 thread 上。下面 worker 的第二层去重就靠这一点。

</div>

## 第四层:worker

worker 是一个死循环:从事件表里领一个 pending 事件,跑图,根据结果改状态。看着简单,这里集中了今天大部分的坑。

```python
# agent-60-lab/topics/ambient-agents/worker.py
"""从 events 表领事件、跑 Agent。用法:uv run python worker.py [--once]"""
import json
import sys
import time
from datetime import datetime, timedelta

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
    # 截止时间也在 Python 里算,格式和 store.now() 一致,字符串比较才成立
    cutoff = (datetime.now() - timedelta(minutes=STALE_MINUTES)).isoformat(timespec="seconds")
    with store.connect() as conn:
        cur = conn.execute(
            "UPDATE events SET status = 'pending', updated_at = ? WHERE status = 'processing' AND updated_at < ?",
            (store.now(), cutoff),
        )
    return cur.rowcount


def handle(graph, ev: dict) -> str:
    ticket_id = json.loads(ev["payload"])["data"]["ticket_id"]
    config = thread_of(ticket_id)
    snap = graph.get_state(config)
    if snap.interrupts or snap.values.get("outcome") in ("sent", "already_sent", "ignored"):
        # 这张工单已经在收件箱里,或者已经处理完了(上游换了个 event_id 又发了一次)
        return "done"
    if snap.next:
        # 上次跑到一半抛了异常,checkpoint 停在失败的节点前面:不给新输入,从那里接着跑
        result = graph.invoke(None, config)
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
            except Exception as e:  # noqa: BLE001
                status = "dead" if ev["attempts"] >= MAX_ATTEMPTS else "pending"
                store.set_status(ev["event_id"], status, f"{type(e).__name__}: {e}")
                print(ev["event_id"], f"第 {ev['attempts']} 次失败 → {status}:", e)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `MAX_ATTEMPTS = 3` 最多跑三次。第三次还失败就进死信,不再自动重试,等人看。
- `STALE_MINUTES = 10` 一个事件在 processing 状态停留超过 10 分钟,就认为领它的 worker 已经死了。这个值要比你最慢的一次正常处理时间长得多,否则正在跑的任务会被别人再领一次。
- `"UPDATE events SET status = 'processing', attempts = attempts + 1, updated_at = ? "` 领任务和改状态在**同一条 UPDATE 里**完成。如果先 SELECT 再 UPDATE,两个 worker 可能同时 SELECT 到同一行,然后都去处理。
- `"WHERE event_id = (SELECT event_id FROM events WHERE status = 'pending' ORDER BY received_at LIMIT 1) "` 子查询挑最早到的那个 pending 事件。SQLite 一条语句内部是串行的,不会被另一个写者插进来。换成 Postgres 时,标准写法是 `SELECT … FOR UPDATE SKIP LOCKED`,并发 worker 各领各的,互不等待。
- `"RETURNING event_id, kind, payload, attempts",` SQLite 3.35 起支持 RETURNING,本机 Python 3.12 自带的是 3.53.1。返回的 `attempts` 已经是加 1 之后的值,第一次领到时是 1。
- `cutoff = (datetime.now() - timedelta(minutes=STALE_MINUTES)).isoformat(timespec="seconds")` 这是我踩的坑。第一版我在 SQL 里写 `updated_at < datetime('now', 'localtime', '-10 minutes')`,看着没问题,但卡死的事件永远放不回来。原因:SQLite 的 `datetime()` 返回 `2026-10-22 10:52:05`(中间是空格),我们存的是 `2026-10-22T10:52:05`(中间是字母 T)。两个字符串比大小时,同一天的值比到第 11 个字符,`T` 的编码 0x54 比空格 0x20 大,所以存的值永远「更大」,条件永远不成立。改成在 Python 里算截止时间,格式和 `store.now()` 完全一致,问题就没了。实测手工插一条 `updated_at` 为当天 07:00 的 processing 事件,11:10 跑 worker,打印 `放回队列 1 个卡住的事件`,随后正常处理成 waiting_human,`attempts` 变成 2。
- `ticket_id = json.loads(ev["payload"])["data"]["ticket_id"]` 从原始 JSON 里取工单号。webhook、邮件、定时任务三种来源的 payload 都按这个结构写,worker 就不用区分来源。
- `snap = graph.get_state(config)` 跑之前先看看这张工单的 thread 现在是什么状态。这是第二层去重:事件 id 不同,但工单是同一张。
- `if snap.interrupts or snap.values.get("outcome") in ("sent", "already_sent", "ignored"):` 有待处理的中断,说明已经在收件箱里;outcome 是这三个之一,说明已经处理完了。两种情况都直接标 done,不再跑一遍模型。实测手工插入一个 `evt_T1007_retry_from_crm`(另一个上游系统给同一张 T1007 发的事件),worker 输出 `evt_T1007_retry_from_crm → done`,没有产生第二条收件箱条目。
- `if snap.next:` 这一段是我第二次修 bug 后加的。第一版的判断是「只要 `snap.next` 不为空就跳过」,本意是跳过已经在收件箱里的工单。结果 T9999 第一次失败后,第二次被直接标成了 done:失败的那次运行已经在 checkpoint 里留下了 `next = ('load',)`,我的代码以为它「正在处理中」。中断和崩溃在 `next` 上看起来一样,要靠 `interrupts` 区分。
- `result = graph.invoke(None, config)` 输入传 `None`,表示不给新输入,从 checkpoint 停的地方接着跑。实测:用 `LLM_API_KEY=sk-wrong` 跑 T1033,draft 节点报 `401 Authentication Fails`;这时 `get_state` 看到 `next = ('draft',)`,State 里已经有 `ticket_id`、`ticket_text`、`feedback` 三个键,说明 load 那一步的成果已经保存。换回正确的 key 再跑,直接从 draft 开始,load 没有重跑。
- `result = graph.invoke({"ticket_id": ticket_id}, config)` 全新的工单才从 START 开始。
- `return "waiting_human" if "__interrupt__" in result else "done"` 跑到 review 停下,返回值里会有 `__interrupt__`。
- `if n := requeue_stale():` 海象运算符:赋值的同时判断。每领一个任务之前先清理一次卡死的事件,简单粗暴但够用。
- `if once:` `--once` 模式下队列空了就退出,方便测试和放进 crontab 定时跑。不带参数时睡 2 秒再看,这就是最简单的轮询。
- `status = "dead" if ev["attempts"] >= MAX_ATTEMPTS else "pending"` 失败了就放回 pending 等下次再领。实测 T9999:`第 1 次失败 → pending`、`第 2 次失败 → pending`、`第 3 次失败 → dead`,三次都是 `'NoneType' object is not subscriptable`。这里的重试是「立刻再来」,没有退避;对 429 限流这类暂时性错误,立刻重试大概率还是失败,练习 3 会让你加上退避。
- `store.set_status(ev["event_id"], status, f"{type(e).__name__}: {e}")` 错误类型和信息存进 `last_error`,死信日报里会用到。
- `conn.close()` 放在 finally 里,Ctrl+C 退出时也能把 checkpoint 库的连接关掉。

</div>

跑一次:

```bash
uv run python worker.py --once
```

```text
evt_T1012_created → waiting_human
evt_T1041_created → waiting_human
evt_T1003_created → waiting_human
evt_T9999_created 第 1 次失败 → pending: 'NoneType' object is not subscriptable
evt_T9999_created 第 2 次失败 → pending: 'NoneType' object is not subscriptable
evt_T9999_created 第 3 次失败 → dead: 'NoneType' object is not subscriptable
```

三张正常的工单各调用一次模型,一共 8 秒左右。T9999 三次失败后进了死信,不会无限循环。

## 第五层:收件箱

收件箱就是「列出所有 waiting_human 的事件,对其中一条给出处理结果」。今天用命令行做,原理和网页版一样:网页版只是把 `list` 换成一个列表页,把四个子命令换成四个按钮。

```python
# agent-60-lab/topics/ambient-agents/inbox.py
"""命令行收件箱。
  uv run python inbox.py list
  uv run python inbox.py accept  T1012
  uv run python inbox.py edit    T1012 "改过的回复全文"
  uv run python inbox.py respond T1012 "语气再软一点,先道歉"
  uv run python inbox.py ignore  T1012
"""
import json
import sys

from langgraph.types import Command

import store
from agent import open_graph, thread_of


def waiting() -> list[tuple[str, str]]:
    with store.connect() as conn:
        rows = conn.execute(
            "SELECT event_id, payload FROM events WHERE status = 'waiting_human' ORDER BY received_at"
        ).fetchall()
    return [(r["event_id"], json.loads(r["payload"])["data"]["ticket_id"]) for r in rows]


def main() -> None:
    cmd = sys.argv[1]
    graph, conn = open_graph()
    try:
        if cmd == "list":
            for event_id, ticket_id in waiting():
                item = graph.get_state(thread_of(ticket_id)).interrupts[0].value
                print(f"{ticket_id}  {item['description']}")
                print(f"        草稿:{item['action_request']['args']['reply']}")
            return

        ticket_id = sys.argv[2]
        text = sys.argv[3] if len(sys.argv) > 3 else ""
        event_id = next((e for e, t in waiting() if t == ticket_id), None)
        if event_id is None:
            print(ticket_id, "不在收件箱里(已经处理过,或者还没轮到 worker)")
            return
        if cmd == "accept":
            answer = {"type": "accept", "args": None}
        elif cmd == "edit":
            answer = {"type": "edit", "args": {"action": "send_reply", "args": {"ticket_id": ticket_id, "reply": text}}}
        elif cmd == "respond":
            answer = {"type": "response", "args": text}
        else:
            answer = {"type": "ignore", "args": None}

        result = graph.invoke(Command(resume=answer), thread_of(ticket_id))
        if "__interrupt__" in result:
            print("已按意见重写,新草稿:", result["__interrupt__"][0].value["action_request"]["args"]["reply"])
            return
        store.set_status(event_id, "ignored" if result["outcome"] == "ignored" else "done")
        print(ticket_id, "→", result["outcome"])
    finally:
        conn.close()


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `"SELECT event_id, payload FROM events WHERE status = 'waiting_human' ORDER BY received_at"` 收件箱的数据源是事件表,不是 checkpoint 库。checkpoint 库只回答「这个 thread 停在哪」,不擅长回答「现在有哪些 thread 在等人」。真实系统里通常会单独建一张 inbox 表,带上指派给谁、优先级、截止时间。
- `item = graph.get_state(thread_of(ticket_id)).interrupts[0].value` `interrupts` 是这个 thread 上待处理的中断列表,`.value` 就是 review 节点里传给 `interrupt()` 的那个字典。
- `print(f"{ticket_id}  {item['description']}")` 实测输出三条,第一条是 `T1012  [account] 客户登录时验证码反复提示过期,多次尝试仍无法登录,情况紧急。`,下一行是草稿全文。
- `event_id = next((e for e, t in waiting() if t == ticket_id), None)` 第二个参数 `None` 是找不到时的默认值。第一版我没写它,对一张已经处理完的工单再 accept 一次,直接抛了 `StopIteration`。实测加上以后,对 T1012 重复 accept 打印 `T1012 不在收件箱里(已经处理过,或者还没轮到 worker)`。
- `answer = {"type": "edit", "args": {"action": "send_reply", "args": {"ticket_id": ticket_id, "reply": text}}}` edit 送回一个完整的 action_request,结构和收件箱条目里的那份一样,只是 reply 换成人写的。
- `answer = {"type": "response", "args": text}` response 只送一句话。
- `result = graph.invoke(Command(resume=answer), thread_of(ticket_id))` 带着人的决定恢复。review 节点从头执行,这次 `interrupt()` 直接返回 `answer`。
- `if "__interrupt__" in result:` 只有 response 会走到这里:重写完又停在了 review。事件状态保持 waiting_human 不变。实测对 T1041 respond「这张已确认是重复扣款,直接告诉客户退款申请已提交、原路退回,别写金额」,新草稿是「您好,非常抱歉给您带来困扰。经核实,您10月8日的两笔扣款确认为重复扣款,我们已为您提交退款申请,多扣的款项将按原支付路径退回……」,也确实没写金额。
- `store.set_status(event_id, "ignored" if result["outcome"] == "ignored" else "done")` 图跑完了,事件也收尾。实测 accept T1012 打印 `T1012 → sent`,ignore T1003 打印 `T1003 → ignored`。

</div>

把四种处理都走一遍:

```bash
uv run python inbox.py list
uv run python inbox.py accept T1012
uv run python inbox.py respond T1041 "这张已确认是重复扣款,直接告诉客户退款申请已提交、原路退回,别写金额"
uv run python inbox.py edit T1041 "您好,已确认 10 月 8 日的 INV-2026-0123 是重复扣款,退款申请已提交,会原路退回,到账时间以支付渠道为准。给您添麻烦了。"
uv run python inbox.py ignore T1003
sqlite3 ambient.db "select event_id, status, attempts from events"
```

最后一条查询的实跑结果:

```text
evt_T1012_created|done|1
evt_T1041_created|done|1
evt_T1003_created|ignored|1
evt_T9999_created|dead|3
```

outbox 里有两行:T1012 是模型原稿,T1041 是人改过的版本。T1041 先 respond 再 edit,说明一条待办可以来回多轮,直到人满意为止。

有一个细节值得停下来想:T1041 的模型重写版其实已经可以用了,我为什么还要 edit?因为我想在回复里写明具体是哪一张发票(INV-2026-0123)。这种修改每天都会发生,它们是最有价值的数据:人改了什么、为什么改,下一版提示词或者下一次微调就从这里来。把 outbox 里「模型原稿」和「最终发出版」都存下来,是练习 4 的内容。

## 邮件和定时任务也走同一条队列

webhook 跑通以后,另外两种触发源只需要做一件事:把自己的输入变成事件表里的一行。

先看邮件。下面这个脚本每次运行收一遍客服邮箱的未读邮件,能对上已知客户的,在业务库里建一张工单,再写一个事件:

```python
# agent-60-lab/topics/ambient-agents/email_poller.py
"""每分钟收一次客服邮箱,把新邮件变成工单 + 事件。
环境变量:IMAP_HOST、IMAP_USER、IMAP_PASSWORD(邮箱的授权码,不是登录密码)
crontab:* * * * * cd ~/agent-60-lab/topics/ambient-agents && uv run python email_poller.py
"""
import email
import hashlib
import imaplib
import json
import os
from email.header import decode_header, make_header
from email.message import Message
from email.utils import parseaddr

from dotenv import load_dotenv

import store

load_dotenv()


def text_of(msg: Message) -> str:
    part = next((p for p in msg.walk() if p.get_content_type() == "text/plain"), None)
    if part is None:
        return ""
    raw = part.get_payload(decode=True) or b""
    return raw.decode(part.get_content_charset() or "utf-8", errors="replace").strip()


def parse(raw: bytes) -> dict:
    msg = email.message_from_bytes(raw)
    return {
        "message_id": msg["Message-ID"].strip(),
        "from": parseaddr(msg["From"])[1].lower(),
        "subject": str(make_header(decode_header(msg["Subject"] or ""))),
        "body": text_of(msg)[:2000],
    }


def to_event(mail: dict) -> str:
    with store.connect(store.BIZ_DB) as biz:
        c = biz.execute("SELECT id FROM customers WHERE email = ?", (mail["from"],)).fetchone()
        if c is None:
            return "skip: 不是已知客户"
        ticket_id = "M" + hashlib.sha1(mail["message_id"].encode()).hexdigest()[:6]
        biz.execute(
            "INSERT OR IGNORE INTO tickets VALUES (?, ?, ?, ?, 'open', ?)",
            (ticket_id, c["id"], mail["subject"], mail["body"], store.now()[:10]),
        )
    payload = json.dumps({"id": mail["message_id"], "type": "ticket.created", "data": {"ticket_id": ticket_id}})
    return ticket_id if store.add_event(mail["message_id"], "email", "ticket.created", payload) else "duplicate"


def main() -> None:
    store.init()
    with imaplib.IMAP4_SSL(os.environ["IMAP_HOST"]) as imap:
        imap.login(os.environ["IMAP_USER"], os.environ["IMAP_PASSWORD"])
        imap.select("INBOX")
        _, data = imap.search(None, "UNSEEN")
        for num in data[0].split():
            _, parts = imap.fetch(num, "(RFC822)")  # fetch 会顺手把邮件标成已读
            print(to_event(parse(parts[0][1])))


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `环境变量:IMAP_HOST、IMAP_USER、IMAP_PASSWORD(邮箱的授权码,不是登录密码)` QQ 邮箱、163、企业微信邮箱这类国内邮箱开 IMAP 后会给一个单独的「授权码」,登录要用它。Gmail 要用应用专用密码。我没有用真实邮箱跑 `main()`,下面几条的数据都来自离线测试:用 Python 自带的 `EmailMessage` 拼了两封假邮件,直接喂给 `parse` 和 `to_event`。
- `part = next((p for p in msg.walk() if p.get_content_type() == "text/plain"), None)` `walk()` 遍历邮件的所有部分(正文、HTML 版、附件)。只取第一个纯文本部分。只有 HTML 的邮件这里会返回空字符串,真用的话要加一段 HTML 转文本。
- `raw = part.get_payload(decode=True) or b""` `decode=True` 会解开 base64 或 quoted-printable 编码,拿到原始字节。
- `return raw.decode(part.get_content_charset() or "utf-8", errors="replace").strip()` 按邮件声明的字符集解码。老的国内邮件客户端常用 gb2312 或 gbk,`errors="replace"` 保证遇到坏字节不会整封崩掉。
- `"message_id": msg["Message-ID"].strip(),` Message-ID 是每封邮件全球唯一的标识,天然就是事件 id。实测假邮件解析出 `<a1b2@mail.example.com>`。
- `"from": parseaddr(msg["From"])[1].lower(),` 实测 `张三 <User003@example.com>` 解析成 `user003@example.com`。转小写是因为业务库里存的是小写,大小写不一致会查不到客户。
- `"subject": str(make_header(decode_header(msg["Subject"] or ""))),` 中文标题在邮件头里是 `=?UTF-8?B?…?=` 这种编码形式,这一串函数把它还原成 `发票抬头写错了`。
- `"body": text_of(msg)[:2000],` 截断到 2000 字。转发链和签名档可能很长,全塞给模型既费钱又干扰判断。
- `if c is None:` 陌生发件人不建工单。实测 `x@spam.com` 发来的邮件返回 `skip: 不是已知客户`。这是最粗的一道过滤,真实客服邮箱里还会有自动回复、退信、营销邮件,要按发件人和标题再筛一遍。
- `ticket_id = "M" + hashlib.sha1(mail["message_id"].encode()).hexdigest()[:6]` 工单号由 Message-ID 算出来,同一封邮件不管处理几次都是同一个工单号。实测得到 `Ma97f81`。
- `"INSERT OR IGNORE INTO tickets VALUES (?, ?, ?, ?, 'open', ?)",` 这里是在模拟「工单系统收到邮件后建单」。真实环境里通常是工单系统自己做这一步,再用 webhook 通知你,那就又回到第一种触发源了。
- `return ticket_id if store.add_event(mail["message_id"], "email", "ticket.created", payload) else "duplicate"` 实测同一封邮件调两次 `to_event`,第一次返回 `Ma97f81`,第二次返回 `duplicate`。随后 worker 把它处理成 waiting_human,收件箱里的说明是 `[invoice] 客户上个月发票抬头误写为旧公司名，申请改为「北京云杉科技有限公司」。`,这张分对了。
- `_, data = imap.search(None, "UNSEEN")` 只取未读邮件。
- `_, parts = imap.fetch(num, "(RFC822)")  # fetch 会顺手把邮件标成已读` 取完整邮件。这一步会把邮件标成已读,所以如果后面 `to_event` 失败了,这封邮件下次就不会再被取到。更稳的做法是用 `BODY.PEEK[]` 取(不改已读状态),等事件入库成功后再手动标已读。

</div>

再看定时任务。两个子命令:`scan` 把超过 20 天还开着、也没回复过的工单当成事件塞进队列;`report` 出一份日报,有 Slack webhook 地址就顺便发过去。

```python
# agent-60-lab/topics/ambient-agents/cron_jobs.py
"""两个定时任务,交给 crontab 每天跑:
  uv run python cron_jobs.py scan     # 把超过 N 天没回复的工单当成事件塞进队列
  uv run python cron_jobs.py report   # 收件箱和死信的日报,有 SLACK_WEBHOOK_URL 就发过去
"""
import json
import os
import sys
from datetime import date, datetime, timedelta

import httpx
from dotenv import load_dotenv

import store

load_dotenv()
STALE_DAYS = 20


def scan(limit: int = 5) -> None:
    cutoff = (date.today() - timedelta(days=STALE_DAYS)).isoformat()
    with store.connect(store.BIZ_DB) as biz:
        rows = biz.execute(
            "SELECT id FROM tickets WHERE status = 'open' AND created_at <= ? ORDER BY created_at, id",
            (cutoff,),
        ).fetchall()
    with store.connect() as conn:
        sent = {r["ticket_id"] for r in conn.execute("SELECT ticket_id FROM outbox")}
    todo = [r["id"] for r in rows if r["id"] not in sent]
    new = 0
    for ticket_id in todo[:limit]:
        # event_id 由「任务名 + 工单 + 日期」拼出来:同一天重复跑 scan,不会重复入队
        event_id = f"cron:stale:{ticket_id}:{date.today().isoformat()}"
        payload = json.dumps({"id": event_id, "type": "ticket.stale", "data": {"ticket_id": ticket_id}})
        new += store.add_event(event_id, "cron", "ticket.stale", payload)
    print(f"超过 {STALE_DAYS} 天还开着的工单 {len(rows)} 张,其中没回复过的 {len(todo)} 张,本次入队 {new} 个")


def report() -> None:
    with store.connect() as conn:
        counts = dict(conn.execute("SELECT status, COUNT(*) FROM events GROUP BY status").fetchall())
        oldest = conn.execute(
            "SELECT event_id, updated_at FROM events WHERE status = 'waiting_human' ORDER BY updated_at LIMIT 1"
        ).fetchone()
        dead = conn.execute("SELECT event_id, last_error FROM events WHERE status = 'dead'").fetchall()
    lines = [f"事件状态:{counts}"]
    if oldest:
        hours = (datetime.now() - datetime.fromisoformat(oldest["updated_at"])).total_seconds() / 3600
        lines.append(f"收件箱里等得最久的:{oldest['event_id']},已等 {hours:.1f} 小时")
    for d in dead:
        lines.append(f"死信:{d['event_id']}  {d['last_error'][:80]}")
    text = "\n".join(lines)
    print(text)
    if url := os.environ.get("SLACK_WEBHOOK_URL"):
        httpx.post(url, json={"text": text}, timeout=10)


if __name__ == "__main__":
    {"scan": scan, "report": report}[sys.argv[1]]()
```

<div class="line-notes">

- `STALE_DAYS = 20` 种子库里的工单日期在 09-28 到 10-12 之间,今天是 10-22,用 20 天做阈值,能筛出一部分而不是全部。
- `cutoff = (date.today() - timedelta(days=STALE_DAYS)).isoformat()` 实测得到 `2026-10-02`。业务库的 `created_at` 存的是 `2026-09-30` 这种纯日期,和 `isoformat()` 的格式一致,所以可以直接比字符串。上面 worker 那个坑就是格式不一致造成的。
- `sent = {r["ticket_id"] for r in conn.execute("SELECT ticket_id FROM outbox")}` 已经回复过的工单不再提醒。集合推导式,查成员是 O(1)。
- `for ticket_id in todo[:limit]:` 每次最多入队 5 个。一个定时任务突然塞进来几千个事件,模型账单和收件箱都会被打爆,限流要从源头做。
- `event_id = f"cron:stale:{ticket_id}:{date.today().isoformat()}"` 这一行是定时任务去重的关键:事件 id 由任务名、工单号、日期组成,**是算出来的,不是随机的**。实测同一天跑两次 scan,第一次打印 `超过 20 天还开着的工单 12 张,其中没回复过的 12 张,本次入队 5 个`,第二次是 `本次入队 0 个`。明天再跑,日期变了,还没处理的工单会再被提醒一次,这正是我们要的。
- `new += store.add_event(event_id, "cron", "ticket.stale", payload)` `add_event` 返回 bool,True 加 1、False 加 0,Python 里 bool 是 int 的子类。
- `counts = dict(conn.execute("SELECT status, COUNT(*) FROM events GROUP BY status").fetchall())` 实测(在 scan 入队之后跑):`{'dead': 1, 'done': 2, 'ignored': 1, 'pending': 5, 'waiting_human': 1}`。
- `"SELECT event_id, updated_at FROM events WHERE status = 'waiting_human' ORDER BY updated_at LIMIT 1"` 收件箱里等得最久的那条。这个数字比收件箱条数更值得告警:十条都是刚进来的不要紧,一条等了三天说明流程断了。
- `lines.append(f"死信:{d['event_id']}  {d['last_error'][:80]}")` 实测输出 `死信:evt_T9999_created  TypeError: 'NoneType' object is not subscriptable`。
- `if url := os.environ.get("SLACK_WEBHOOK_URL"):` 没配就只打印。飞书、钉钉、企业微信的群机器人也都是一个 webhook 地址加一段 JSON,改一下请求体格式就能用。

</div>

crontab 这样配(`crontab -e` 打开编辑,路径换成你自己的):

```text
# 每分钟收一次邮件、处理一批事件
* * * * * cd ~/agent-60-lab/topics/ambient-agents && ~/.local/bin/uv run python email_poller.py >> cron.log 2>&1
* * * * * cd ~/agent-60-lab/topics/ambient-agents && ~/.local/bin/uv run python worker.py --once >> cron.log 2>&1
# 每天 9:00 扫描久未回复的工单,9:05 出日报
0 9 * * * cd ~/agent-60-lab/topics/ambient-agents && ~/.local/bin/uv run python cron_jobs.py scan >> cron.log 2>&1
5 9 * * * cd ~/agent-60-lab/topics/ambient-agents && ~/.local/bin/uv run python cron_jobs.py report >> cron.log 2>&1
```

crontab 里的环境变量和你的终端不一样,`uv` 很可能不在 PATH 里,所以写绝对路径(`which uv` 查)。每条都把输出追加到日志文件,否则出错了你什么都看不到。`worker.py --once` 每分钟跑一次时,如果上一次还没跑完,下一次又启动了,两个 worker 会同时工作;好在 `claim()` 是原子的,它们不会领到同一个事件。

用 [crontab.guru](https://crontab.guru/) 可以检查表达式。如果你用的是 LangGraph 的托管部署(现在叫 LangSmith Deployment),它自带 cron 功能,`client.crons.create(...)` 一行就能建,但官方文档特别提醒**所有时间都按 UTC 解释**,北京时间早上 9 点要写成 `0 1 * * *`。

## 上线以后盯什么

后台 Agent 最大的风险是安静地坏掉:没有人在对面等结果,所以也没有人会立刻发现它不工作了。我会盯这几个数:

- **队列深度**:pending 的事件数。持续上涨说明 worker 处理不过来,或者已经挂了。
- **收件箱最长等待时间**:上面日报里那一行。超过一个工作日就该提醒值班的人。
- **死信数**:任何一条死信都值得看。今天的 T9999 是工单不存在,真实环境里更常见的是模型服务欠费、API key 过期、上游改了 payload 格式。
- **每类工单的处理结果分布**:accept、edit、response、ignore 各占多少。某一类的 accept 率很高,说明可以考虑让它自动发;某一类 edit 率突然升高,说明模型或提示词出了问题,或者业务规则变了。
- **单事件成本**:按上面的算法,一次起草约 0.0015 元。response 会多调一次模型,如果某类工单平均要 respond 两三轮,成本和人的耐心都会出问题。

这些数从 `events` 表、`outbox` 表和 Day 34 的 Langfuse trace 里都能算出来。Day 34 讲 tracing 时 trace 是按「一次对话」组织的,后台 Agent 要改成按「一个事件」组织,trace 的 session id 用工单号,这样一张工单来回几轮的所有调用能串在一起看。

## 动手练习

1. **把全流程跑通。** 按正文顺序起 webhook 服务,发 T1012(两次)、T1041、T1003、T9999,跑 worker,用收件箱把四种处理都走一遍。验收:`events` 表最终状态和正文的四行结果一致(你的模型草稿内容会不同,状态应该一样);`outbox` 里恰好两行。

2. **把「工单不存在」改成正确的失败方式。** 现在 T9999 要重试三次才进死信,但「工单不存在」重试一百次也不会变好。修改 `load` 节点:查不到时抛一个自定义的 `PermanentError`;修改 worker:捕获到 `PermanentError` 直接标 dead,不重试。验收:T9999 只失败一次就进死信,`attempts` 是 1,`last_error` 里能看出是「工单不存在」。

3. **加退避。** 给 `events` 表加一列 `not_before TEXT`,失败时设成「现在 + 2 的 attempts 次方 分钟」,`claim()` 只领 `not_before` 为空或已经过去的事件。用 `LLM_API_KEY=sk-wrong` 制造失败来测。验收:同一个失败事件的三次尝试之间,间隔分别约 2 分钟和 4 分钟,而不是一口气连试三次。

4. **把人的修改存下来。** 在 `send` 节点里,除了写 outbox,再往一张新表 `review_log` 里写一行:工单号、类别、模型原稿、最终发出的文本、处理类型(accept 还是 edit)、所有 feedback。验收:跑完正文流程,`review_log` 里 T1012 的处理类型是 accept、原稿和终稿相同;T1041 是 edit、原稿和终稿不同、feedback 里有一条意见。这张表是 Day 144 讲反馈闭环时的原料。

5. **加一种「通知」类待办。** 修改 `draft` 节点:如果工单正文里出现「律师」「起诉」「投诉到」这类词,不起草回复,而是产生一条 `action` 为 `notify_supervisor` 的收件箱条目,`config` 里只允许 ignore(看过即可)。用邮件离线测试的方法造一封含「我要投诉到消费者协会」的邮件。验收:这封邮件进收件箱后显示的说明里标明了是通知,`accept` 和 `edit` 会被拒绝。

6. **(选做)换成 Postgres。** 把事件表搬到 Day 17 的 Postgres 里,`claim()` 改用 `FOR UPDATE SKIP LOCKED`,checkpointer 换成 `langgraph-checkpoint-postgres`。同时开三个 worker 处理 20 个事件。验收:每个事件只被处理一次,三个 worker 的输出里没有重复的 event_id。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| Ambient agent(后台 Agent) | 由外部事件(webhook、邮件、定时任务)触发、在后台运行、只在需要时找人的 Agent。LangChain 2025 年 1 月提出的叫法 |
| Agent Inbox | 后台 Agent 找人的集中入口。LangChain 开源过一个同名的界面,定义了 `HumanInterrupt` 和 `HumanResponse` 两个数据结构,仓库现已归档 |
| Webhook | 对方系统在某件事发生时,主动向你预先登记的 URL 发一个 HTTP 请求 |
| HMAC 签名 | 用双方共享的密钥对请求内容算出的摘要。接收方重算一遍对得上,才说明请求确实来自持有密钥的一方且内容没被改 |
| 重放攻击 | 截获一个合法请求后原样再发。签名挡不住,要靠时间戳容忍窗口和事件 id 去重 |
| 至少一次投递(at-least-once) | 大多数 webhook 和消息队列的保证:不会丢,但可能重复。接收方必须自己去重 |
| 幂等 | 同一个操作做一次和做多次结果一样。今天靠事件 id 主键、thread_id 用业务主键、outbox 的 UNIQUE 三处实现 |
| 死信(dead letter) | 重试够次数仍然失败、不再自动处理、等人排查的任务 |
| 原子领取 | 「挑一个任务」和「标记为我在处理」在一个不可分割的操作里完成,防止两个 worker 领到同一个 |
| 轮询(polling) | 定期主动去问「有没有新东西」,今天的邮件收取和 worker 都是 |
| crontab | Unix 系统自带的定时任务表,五个字段依次是分、时、日、月、星期 |

## 常见误区

**在 webhook 处理函数里直接跑 Agent。** 模型调用动辄几秒到几十秒,上游等不到 2xx 就会重试,你会同时跑好几份同一个任务。入口只做验签和落库,处理交给后台。

**拿解析后的 JSON 去验签。** 签名算的是原始字节。`json.loads` 再 `json.dumps` 之后,空格、键顺序、中文转义都可能变,签名就对不上了,而且这种 bug 只在特定 payload 上出现,很难查。

**只靠事件 id 去重。** 同一张工单可能被不同的上游、以不同的事件 id 通知好几次。还要在业务层面去重:thread_id 用工单号,发送动作本身要幂等。

**把「中断」和「崩溃」当成一回事。** 两者在 checkpoint 里都表现为 `next` 不为空。等人的 thread 要跳过,崩溃的 thread 要续跑,区分它们要看 `interrupts`。

**用格式不同的时间字符串比大小。** SQLite 没有真正的时间类型,时间都是字符串。`2026-10-22T10:00:00` 和 `2026-10-22 10:00:00` 比较的结果和直觉不一样。全库统一一种格式,或者统一存 Unix 时间戳。

**所有失败都重试。** 网络抖动、限流值得重试;工单不存在、参数格式错这类永久性错误,重试只会浪费钱和时间。先分清是哪一种。

**收件箱只看条数。** 十条刚进来的不要紧,一条等了三天的才是问题。告警要盯最长等待时间。

## 学习资料

### 文档与文章

- [LangChain · Introducing ambient agents](https://blog.langchain.com/introducing-ambient-agents):提出这个概念的原文,通知、提问、审核三种找人方式就出自这里,15 分钟。
- [langchain-ai/agent-inbox](https://github.com/langchain-ai/agent-inbox):README 里的 `HumanInterrupt` 和 `HumanResponse` 定义是今天收件箱格式的来源。仓库已归档,只看数据结构那一节,10 分钟。
- [LangChain · Human-in-the-loop](https://docs.langchain.com/oss/python/langchain/human-in-the-loop):`HumanInTheLoopMiddleware` 的官方文档,如果你用 `create_agent` 而不是自己画图,审批走这一套,20 分钟。
- [LangGraph · Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts):interrupt 的完整语义,特别是「恢复时节点重新执行」那一段,20 分钟。
- [LangSmith · Cron jobs](https://docs.langchain.com/langsmith/cron-jobs):托管部署上的定时任务,注意 UTC,10 分钟。
- [Stripe · Webhooks](https://docs.stripe.com/webhooks) 与 [签名校验](https://docs.stripe.com/webhooks/signature):业界写得最好的 webhook 接收指南,快速返回、去重、验签、防重放全都讲了,30 分钟。
- [GitHub · Validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries):另一种签名头格式,对比着看,10 分钟。
- [Standard Webhooks](https://standardwebhooks.com/) 与 [规范原文](https://github.com/standard-webhooks/standard-webhooks):如果你要设计自己的 webhook,照着它来,20 分钟。
- [Brandur · Implementing Stripe-like Idempotency Keys in Postgres](https://brandur.org/idempotency-keys):幂等键的经典长文,做练习 6 之前读,40 分钟。
- [SQLite · RETURNING](https://www.sqlite.org/lang_returning.html):`claim()` 用到的语法,5 分钟。
- [Python · imaplib](https://docs.python.org/3/library/imaplib.html):邮件收取的标准库文档,查 `search` 和 `fetch` 的参数。
- [Cloudflare · Email Workers](https://developers.cloudflare.com/email-routing/email-workers/) 和 [Postmark · Inbound webhook](https://postmarkapp.com/developer/webhooks/inbound-webhook):把收到的邮件转成 webhook 的两种现成服务,邮件量大时考虑。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1fykHY6EAF&autoplay=0&high_quality=1" title="LangGraph Interrupt:Human-In-The-Loop 人机交互手到擒来!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>沧海九粟 · LangGraph Interrupt:Human-In-The-Loop 人机交互手到擒来! · 22 分钟,把 interrupt、Command(resume) 和 checkpoint 的配合讲得很细,复习 Day 25 再接今天正好。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1n34y1M7yL&autoplay=0&high_quality=1" title="什么是 WebHook?如何实现?适用什么场景?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序猿DD · 什么是 WebHook?如何实现?适用什么场景? · 8 分钟,没接触过 webhook 的先看这个,讲清推和拉的区别。</figcaption>
</figure>

- 是的iamrio《03.让Agent可审批、可恢复、可重放,LangGraph进阶》(B 站 BV1Yt376TEUC,12 分钟):2026 年 7 月的视频,审批、恢复、重放三件事放在一起讲,和今天的 worker 续跑那一节对应。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/egSh4TxS5go" title="Ambient Agents and the New Agent Inbox ft. Harrison Chase" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Sequoia Capital · Ambient Agents and the New Agent Inbox ft. Harrison Chase · LangChain 创始人在红杉 AI Ascent 2025 上讲为什么聊天界面不适合后台 Agent,以及收件箱这种交互是怎么想出来的。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/gF341XMN8cY" title="Open Source Agent Inbox for LangGraph" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Open Source Agent Inbox for LangGraph · 官方演示 Agent Inbox 怎么接 LangGraph,看它的界面怎么呈现 accept、edit、respond、ignore 四个按钮,做网页版收件箱时可以参考。</figcaption>
</figure>

- ByteByteGo《Top 3 Things You Should Know About Webhooks!》(YouTube,按标题搜索):几分钟的动画,讲 webhook 的重试、幂等和安全,和今天的第二层对应。
- LangChain Academy《Project: Ambient Agents with LangGraph》([课程页](https://academy.langchain.com/courses/ambient-agents)):免费,28 节约 2.5 小时,做一个邮件助手,包含评测、人工审核、记忆和部署。想看完整版就学这门。

### 书籍

- Martin Kleppmann、Chris Riccomini《Designing Data-Intensive Applications》第二版(O'Reilly, 2026)第 13 章「A Philosophy of Streaming Systems」:事件日志、至少一次投递、幂等消费这些概念的源头。第一版(2017,中译本《数据密集型应用系统设计》)对应的是第 11 章「流处理」。
- Gregor Hohpe、Bobby Woolf《Enterprise Integration Patterns》(Addison-Wesley, 2003):老书,但「Idempotent Receiver」「Dead Letter Channel」「Polling Consumer」这几个模式的名字就出自这里,今天的 worker 几乎就是它们的组合。翻目录挑这三节看。
- Chip Huyen《AI Engineering》(O'Reilly, 2025)第 6 章「Agents」:讲 Agent 的失败模式和评测,补充「为什么要让人先审」的理由。

### 开源项目与代码

- [langchain-ai/agents-from-scratch](https://github.com/langchain-ai/agents-from-scratch):LangChain Academy 那门课的配套代码,一个完整的邮件助手 ambient agent,看它的 HITL 那一步怎么写。
- [langchain-ai/agent-inbox](https://github.com/langchain-ai/agent-inbox):收件箱前端的参考实现(已归档,只读)。
- [standard-webhooks/standard-webhooks](https://github.com/standard-webhooks/standard-webhooks):各种语言的签名和校验库,自己写验签之前先看看有没有现成的。

## 自测

1. 为什么 webhook 入口要先把事件写进数据库再返回 202,而不是收到就直接调 Agent 处理?至少说出两个理由。

<details><summary>答案</summary>

第一,模型调用慢,上游等不到 2xx 会超时重试,结果同一个任务被跑好几次。第二,入口进程挂了或者重启时,正在处理的任务会丢;先落库就有了持久化的记录,worker 重启后接着处理。第三,去重、重试、死信、监控都只需要在 worker 一处实现,三种触发源共用。

</details>

2. 签名校验已经能证明请求来自持有密钥的一方,为什么还要检查时间戳?

<details><summary>答案</summary>

签名证明的是「这个请求是合法方发的、内容没被改」,但挡不住重放:攻击者截获一个合法请求后原样再发,签名依然正确。检查时间戳在容忍窗口(比如 5 分钟)内,可以让旧请求失效;窗口之内的重放,再靠事件 id 去重挡掉。

</details>

3. worker 里 `if snap.next:` 那一段解决了什么问题?如果只判断 `snap.next` 不为空就跳过,会发生什么?

<details><summary>答案</summary>

它让跑到一半崩掉的工单从失败的节点接着跑,而不是被当成「已经在处理中」跳过。等人的 thread 和崩溃的 thread 在 checkpoint 里 `next` 都不为空,区别是前者 `interrupts` 里有待处理的中断。只看 `next` 的话,第一次失败的事件在重试时会被直接标成 done,这张工单就再也不会被处理了,正文里 T9999 就是这样被我第一版代码漏掉的。

</details>

4. 定时任务的事件 id 为什么用 `cron:stale:T1023:2026-10-22` 这种拼出来的值,而不是随机生成?

<details><summary>答案</summary>

拼出来的 id 是确定的:同一天无论 scan 跑几次(补跑、手动跑、两台机器都配了 crontab),同一张工单得到的都是同一个 id,主键冲突自动去重。随机 id 每次都不同,重复跑就会重复入队。带上日期是有意的:明天还没处理的工单应该再被提醒一次。

</details>

5. **面试题**:你要给一家 SaaS 公司设计一个后台客服 Agent,新工单通过 webhook 进来,Agent 起草回复后由人审核再发出。请说出你会在哪几个地方处理「重复」,每个地方防的是什么。

<details><summary>答案</summary>

至少三处。一是事件层:事件 id 做主键,`INSERT OR IGNORE`,防上游重试造成的重复投递。二是业务层:执行状态按工单号组织(thread_id 用工单号),同一张工单被不同来源、不同事件 id 触发时,发现已经在收件箱或已处理就跳过,防多个上游重复通知。三是动作层:发送回复本身幂等(outbox 的唯一约束,或调用邮件服务时带幂等键),防 worker 在「已发送」和「已标记完成」之间崩溃后重跑造成重复发送。加分项:领任务要原子(UPDATE…RETURNING 或 FOR UPDATE SKIP LOCKED),防两个 worker 处理同一个事件;定时任务的事件 id 用确定性的拼接值。

</details>

6. 收件箱里有四种处理:accept、edit、response、ignore。哪一种会让 Agent 再调一次模型?如果某一类工单的 edit 比例连续一周从 10% 涨到 40%,你会先查什么?

<details><summary>答案</summary>

只有 response 会再调模型(带着意见重写)。edit 比例突然上涨,先看最近有没有改动:提示词、模型版本、`.env` 里的模型名、知识库内容;再看业务有没有变化:价格、退款政策、新功能上线后客户问的问题变了。然后抽二三十条 edit 记录,对比原稿和终稿,看人到底在改什么,这就是 Day 30 错误分析的做法。

</details>

## 明天预告

专题篇可以跳着读。下一篇是 Day 140 · 低代码 Agent 平台实操:Dify、扣子、百炼、n8n 现在各是什么状态,同一个工单分流流程放到平台上和写成代码各是什么样,平台搭的应用怎么跑你自己的评测集,以及什么时候该从平台改成写代码。
