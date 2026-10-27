---
title: 'Day 372 · 反馈闭环(一):显式和隐式反馈怎么采'
description: '测试集是上线前写的,线上的问题它不认识。今天先把「线上到底哪里错了」的原始信号收进来:客服点踩、草稿被改了多少、转人工、客户追问。建一张回复表和一张反馈事件表,写三个收反馈的接口,算改写比例,再造一周虚构数据,实测只有三成回复有人点,重度改写的 39 条里只有 8 条被点踩。'
pubDate: 2026-10-27
regime: none
tags: ['feedback', 'sqlite', 'fastapi', 'agent-zero']
series: 'agent-zero'
day: 372
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 371](/blog/agent-zero/day-371-prompt-opt-3/) 写了 ACE 的最小版和一道手册门禁。两件事留了尾巴:手册里每条规则的「帮/害」计数只在训练集上记过,上线以后没有数据来更新;门禁里的「关键用例」是我凭 Day 368 的记忆挑的,真实系统里它该来自线上出过的事故。这两个尾巴都指向同一个问题:线上的对错,是谁告诉你的?

接下来两天回答它。今天只做一件事,把原始信号收进来;明天拿这些信号分诊、聚类、变成测试用例。

## 今天要解决的问题

学完今天你应该能:

1. 说出显式反馈、隐式反馈、结果反馈各有哪些信号,它们各自的量、可信度和坑。
2. 设计一张反馈事件表,用 `trace_id` 把信号挂到具体某一次回复上,并让重复上报不重复计数。
3. 写出三个收反馈的 FastAPI 接口和对应的 pytest 测试,并看到参数不合法时的真实报错。
4. 算出「草稿被改写的比例」,用实测数据说明阈值为什么不能拍脑袋。

今天两个新概念:**三类反馈信号**,和**幂等的反馈事件表**(同一个信号上报几次都只留一行)。

预计用时 2.5 小时。实跑花费:0 元,今天全是本地代码,不调模型。前置:[Day 79–81](/blog/agent-zero/day-079-fastapi-1/) 的 FastAPI 和 pydantic;[Day 92–93](/blog/agent-zero/day-092-python-sqlite-1/) 的 `sqlite3`;[Day 71](/blog/agent-zero/day-071-pytest-1/) 起的 pytest;[Day 364](/blog/agent-zero/day-364-tracing-concepts/) 和 [Day 366](/blog/agent-zero/day-366-otel-spans/) 讲的 `trace_id`(今天的每条回复都挂一个)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章,把 `add_event()` 里那条 SQL 默写出来;做练习时先自己写,做不出再展开参考答案,看完关掉重写一遍。

## 第一步:有哪些信号

先把场景摆清楚。CloudLedger 的客服工作台上,Agent 先起草一份回复,客服看一眼、改一改、点发送。这个过程里有两类人会留下痕迹:客服,和收到回复的客户。留下的痕迹分三类。

**显式反馈**:有人主动表态。客服在草稿旁边点赞或点踩,点踩时顺手勾一个原因;客户在满意度调查里打 1 到 5 分。意思最明确,但量很少:大多数人根本不点,点的人又偏向特别满意和特别不满意的两头。

**隐式反馈**:从行为里推出来,没人需要为此多做一步。客服把草稿改了多少再发,工单有没有转二线,客户 24 小时内有没有追问同一件事。每条回复都有,量大;代价是噪声大,改写多可能是 Agent 错了,也可能只是这个客服习惯在结尾加一句「祝您生活愉快」。

**结果反馈**:业务上最终发生了什么。退款申请被主管驳回,客户一个月内取消订阅,这张工单最后花了多少分钟。最接近你真正关心的东西,但来得慢、归因难,一般用在月度复盘和 A/B 实验,不用在每周的分诊里。

| 信号 | 谁产生 | 量 | 可信度 | 坑 |
| --- | --- | --- | --- | --- |
| 客服点赞/点踩 | 客服 | 少 | 高 | 误点;只有情绪强时才点 |
| 点踩原因 | 客服 | 更少 | 高 | 选项设计不好会全选「其他」 |
| 客户满意度 | 客户 | 很少 | 中 | 低分常常是对政策不满,不是 Agent 答错 |
| 草稿改写比例 | 系统推算 | 每条都有 | 中低 | 客套话、换行也算改写 |
| 转人工/转二线 | 工单系统 | 中 | 高 | 有些类别本来规定就要转 |
| 客户追问/重开 | 工单系统 | 中 | 中 | 追问也可能是新问题 |
| 退款被驳回、取消订阅 | 业务系统 | 少 | 最高 | 慢,难归因到某一条回复 |

从前端的角度看,点赞点踩没有什么神秘的:一个按钮,点一下发一个 `POST` 请求,带着「哪条回复」和「赞还是踩」。今天后端要做的就是接住这个请求,存好,别存重。

按钮怎么设计,有几条踩过的经验。按钮要放在客服点「发送」的那个位置旁边,别藏进三个点的菜单,否则没人点。别用五星评分,客服不会认真区分三星和四星,点赞点踩加一个可选原因就够。原因的选项不要写「不准确」「不相关」这种空话,要从你在 [Day 347](/blog/agent-zero/day-347-error-analysis-3/) 归纳出来的失败类别里来:答错了政策、缺知识、该查订单没查、语气不对。这样明天分诊时,这些选项能直接当标签用。同一个人对同一条回复改主意时要能覆盖,而不是记两次。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="三个来源把反馈写进 events 表:工作台按钮和发送动作来自客服,webhook 来自工单系统,改写比例由系统在发送时算出;events 用 trace_id 指向 replies">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="20" width="150" height="46" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="32" y="40" fill="var(--ink)">工作台按钮</text>
<text x="32" y="57" fill="var(--ink-faint)" font-size="11">点赞/踩 + 原因</text>
<rect x="20" y="95" width="150" height="46" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="32" y="115" fill="var(--ink)">客服点「发送」</text>
<text x="32" y="132" fill="var(--ink-faint)" font-size="11">带最终文本</text>
<rect x="20" y="170" width="150" height="46" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="32" y="190" fill="var(--ink)">工单系统 webhook</text>
<text x="32" y="207" fill="var(--ink-faint)" font-size="11">转人工/追问</text>
<rect x="240" y="20" width="160" height="196" rx="6" fill="none" stroke="var(--ink-soft)"/>
<text x="252" y="42" fill="var(--ink)">三个接口</text>
<text x="252" y="62" fill="var(--ink-faint)" font-size="11">/feedback/thumb</text>
<text x="252" y="80" fill="var(--ink-faint)" font-size="11">/feedback/sent</text>
<text x="252" y="98" fill="var(--ink-faint)" font-size="11">/feedback/ticket-event</text>
<text x="252" y="140" fill="var(--ink-faint)" font-size="11">sent 时系统算</text>
<text x="252" y="158" fill="var(--ink-faint)" font-size="11">edit_ratio 并写入</text>
<rect x="470" y="20" width="150" height="80" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="482" y="42" fill="var(--ink)">events</text>
<text x="482" y="62" fill="var(--ink-faint)" font-size="11">event_id 是主键</text>
<text x="482" y="80" fill="var(--ink-faint)" font-size="11">一个信号一行</text>
<rect x="470" y="136" width="150" height="80" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="482" y="158" fill="var(--ink)">replies</text>
<text x="482" y="178" fill="var(--ink-faint)" font-size="11">trace_id 是主键</text>
<text x="482" y="196" fill="var(--ink-faint)" font-size="11">草稿 + 最终发出</text>
<line x1="170" y1="43" x2="238" y2="55" stroke="var(--ink-soft)"/>
<line x1="170" y1="118" x2="238" y2="110" stroke="var(--ink-soft)"/>
<line x1="170" y1="193" x2="238" y2="150" stroke="var(--ink-soft)"/>
<line x1="400" y1="70" x2="468" y2="60" stroke="var(--ink-soft)"/>
<line x1="545" y1="100" x2="545" y2="134" stroke="var(--ink-soft)"/>
<text x="552" y="122" fill="var(--ink-faint)" font-size="11">trace_id</text>
</g>
</svg>
<figcaption>信号可以晚到:客户三天后追问,工单系统的 webhook 带着 trace_id 过来,往 events 里插一行就行,不用改回复那一行。</figcaption>
</figure>

## 第二步:两张表

存储用 SQLite,Day 92 学过。两张表:`replies` 每次 Agent 起草一条回复写一行,主键是 `trace_id`;`events` 每个反馈信号写一行,也挂在 `trace_id` 上。把它们分成两张表,而不是在回复那行加一堆「是否点踩」「是否转人工」的列,是因为信号会晚到、会增加新种类,一张宽表要不停改结构。

在 `agent-zero-lab` 根目录安装依赖(Day 79 已经装过 FastAPI 的话只需补 `httpx`,FastAPI 的测试客户端要用它):

```bash
uv add fastapi httpx pytest
```

2026 年 10 月我实测装下来是 fastapi 0.162.0、httpx 0.28.1、pytest 9.1.1。新建 `part06/fb_store.py`:

```python
# agent-zero-lab/part06/fb_store.py
"""Day 372:反馈数据的存储。replies 每次回复一行,events 每个反馈信号一行,信号挂在 trace_id 上。"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

DB = Path(__file__).with_name("feedback.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS replies (
    trace_id       TEXT PRIMARY KEY,
    ticket_id      TEXT NOT NULL,
    customer_id    TEXT,
    category       TEXT,
    ticket         TEXT NOT NULL,
    draft          TEXT NOT NULL,          -- Agent 起草的回复
    sent           TEXT,                   -- 客服最终发出去的回复,没发就是 NULL
    prompt_version TEXT,
    created_at     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
    event_id TEXT PRIMARY KEY,             -- 同一个来源对同一条回复的同一种信号只留一行
    trace_id TEXT NOT NULL REFERENCES replies(trace_id),
    kind     TEXT NOT NULL,                -- thumb / edit_ratio / escalated / reopened / csat
    value    REAL NOT NULL,
    reason   TEXT DEFAULT '',              -- 点踩时勾的原因
    comment  TEXT DEFAULT '',
    source   TEXT DEFAULT '',              -- agent:客服 / customer:客户 / system:系统推断 / ticketing:工单系统
    ts       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_trace ON events(trace_id);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect(path: Path | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(path or DB)       # 调用时才读 DB,测试里改 fb_store.DB 就能换库
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def add_reply(conn: sqlite3.Connection, **r: str | None) -> None:
    r.setdefault("created_at", now())
    cols = ", ".join(r)
    marks = ", ".join("?" * len(r))
    conn.execute(f"INSERT OR REPLACE INTO replies ({cols}) VALUES ({marks})", list(r.values()))


def add_event(conn: sqlite3.Connection, trace_id: str, kind: str, value: float,
              reason: str = "", comment: str = "", source: str = "system", ts: str | None = None) -> str:
    event_id = f"{trace_id}:{kind}:{source}"
    conn.execute(
        """INSERT INTO events (event_id, trace_id, kind, value, reason, comment, source, ts)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(event_id) DO UPDATE SET
             value = excluded.value, reason = excluded.reason, comment = excluded.comment, ts = excluded.ts""",
        (event_id, trace_id, kind, value, reason, comment, source, ts or now()),
    )
    return event_id
```

<div class="line-notes">

- `DB = Path(__file__).with_name("feedback.db")` 数据库文件和代码放一起,方便练习。生产里换成 Postgres,表结构基本不用改。
- `trace_id       TEXT PRIMARY KEY,` 每次回复一个 `trace_id`。接了 Langfuse 或 OpenTelemetry 的项目里,它就是那次调用的 trace id,两边能互相跳转。今天的虚构数据里写成 `tr-0001` 这样的短 id。
- `draft          TEXT NOT NULL,          -- Agent 起草的回复` 草稿和最终发出的版本分开存,这是算改写比例的前提。很多系统只存最终版本,事后就再也算不出 Agent 原本写了什么。
- `prompt_version TEXT,` 这条回复是哪个版本的提示词(或者 Day 371 的哪份手册)生成的。后面按版本对比线上指标,就靠这一列。
- `event_id TEXT PRIMARY KEY,             -- 同一个来源对同一条回复的同一种信号只留一行` 幂等的关键。前端网络抖动重发两次、客服先点踩又改成点赞,都只留一行最新的。
- `REFERENCES replies(trace_id),` 外键:信号必须挂在一条存在的回复上。SQLite 默认不强制外键,所以接口里还要再查一次。
- `reason   TEXT DEFAULT '',              -- 点踩时勾的原因` 点踩原因单独一列,不混进 `comment`,以后能直接 `GROUP BY reason`。
- `source   TEXT DEFAULT '',` 同一种信号来源不同,可信度不同:客服点踩和客户打低分要分开看。
- `CREATE INDEX IF NOT EXISTS idx_events_trace ON events(trace_id);` 给 `trace_id` 建索引,按回复查它的所有信号时不用扫整张表。
- `conn = sqlite3.connect(path or DB)       # 调用时才读 DB,测试里改 fb_store.DB 就能换库` 默认参数写成 `None` 再在函数体里取 `DB`,而不是 `path: Path = DB`。后者在定义函数那一刻就把路径定死了,测试里替换 `fb_store.DB` 就不起作用。
- `conn.row_factory = sqlite3.Row` 查询结果可以用 `r["trace_id"]` 按列名取,不用数第几列。
- `conn.execute(f"INSERT OR REPLACE INTO replies ({cols}) VALUES ({marks})", list(r.values()))` 列名从关键字参数拼出来,值仍然走 `?` 占位符。列名来自代码而不是用户输入,所以这里拼字符串是安全的;值千万别拼,Day 93 讲过 SQL 注入。
- `event_id = f"{trace_id}:{kind}:{source}"` 用「哪条回复、什么信号、谁给的」拼出主键。实测 `tr-0001` 被客服点踩后,事件 id 是 `tr-0001:thumb:agent`。
- `ON CONFLICT(event_id) DO UPDATE SET` SQLite 3.24 以后支持的 upsert:有这个主键就更新,没有就插入。`excluded` 指的是这次想插入、但因为主键冲突没插进去的那一行。本机 uv 带的 SQLite 是 3.53.1,没问题。

</div>

这里有一个 JS 对照。`INSERT ... ON CONFLICT DO UPDATE` 相当于对一个以 `event_id` 为键的 `Map` 做 `map.set(eventId, {...})`:键有就覆盖,没有就新增。

## 第三步:收反馈的三个接口

前端点赞点踩、客服点「发送」、工单系统的 webhook,分别打到三个接口上。

```python
# agent-zero-lab/part06/fb_api.py
"""Day 372:收反馈的三个接口。前端点赞点踩、客服点「发送」、工单系统的 webhook 都打到这里。"""
from __future__ import annotations

import sqlite3
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from part06.fb_signals import edit_ratio
from part06.fb_store import add_event, connect

app = FastAPI()

Reason = Literal["wrong_policy", "missing_knowledge", "missed_tool", "tone", "other"]


class Thumb(BaseModel):
    trace_id: str
    value: Literal[1, -1]
    reason: Reason | None = None
    comment: str = Field(default="", max_length=500)


class Sent(BaseModel):
    trace_id: str
    text: str = Field(min_length=1)


class TicketEvent(BaseModel):
    trace_id: str
    kind: Literal["escalated", "reopened"]
    comment: str = ""


def draft_of(conn: sqlite3.Connection, trace_id: str) -> str:
    row = conn.execute("SELECT draft FROM replies WHERE trace_id = ?", (trace_id,)).fetchone()
    if row is None:
        raise HTTPException(404, f"unknown trace_id {trace_id}")
    return str(row["draft"])


@app.post("/feedback/thumb")
def thumb(body: Thumb) -> dict[str, str]:
    with connect() as conn:
        draft_of(conn, body.trace_id)
        eid = add_event(conn, body.trace_id, "thumb", body.value, reason=body.reason or "",
                        comment=body.comment, source="agent")
    return {"event_id": eid}


@app.post("/feedback/sent")
def sent(body: Sent) -> dict[str, float]:
    with connect() as conn:
        draft = draft_of(conn, body.trace_id)
        conn.execute("UPDATE replies SET sent = ? WHERE trace_id = ?", (body.text, body.trace_id))
        ratio = edit_ratio(draft, body.text)
        add_event(conn, body.trace_id, "edit_ratio", ratio, source="system")
    return {"edit_ratio": ratio}


@app.post("/feedback/ticket-event")
def ticket_event(body: TicketEvent) -> dict[str, str]:
    with connect() as conn:
        draft_of(conn, body.trace_id)
        eid = add_event(conn, body.trace_id, body.kind, 1, comment=body.comment, source="ticketing")
    return {"event_id": eid}
```

<div class="line-notes">

- `app = FastAPI()` Day 79 的最小应用。今天不起服务器,下面用测试客户端直接打。
- `Reason = Literal["wrong_policy", "missing_knowledge", "missed_tool", "tone", "other"]` 点踩原因只能是这五个。相当于 TS 里的字符串联合类型。
- `value: Literal[1, -1]` 只接受 1 和 -1,前端传 0 或者 `"down"` 会直接得到 422。别在后端猜前端的意思。
- `reason: Reason | None = None` 原因可选:客服不想勾就不勾,点踩比「必须说明原因」更重要。
- `comment: str = Field(default="", max_length=500)` 自由文本限个长度,免得有人往里贴整段聊天记录,里面全是客户信息。
- `text: str = Field(min_length=1)` 客服最终发出的回复,空字符串不算发送。
- `kind: Literal["escalated", "reopened"]` 工单系统只能报这两种事件。新增信号时先改这里,逼自己想清楚它的含义。
- `raise HTTPException(404, f"unknown trace_id {trace_id}")` 信号挂到不存在的回复上没有意义,直接拒绝。最常见的原因是前端拿错了 id,404 比静默吞掉容易发现。
- `eid = add_event(conn, body.trace_id, "thumb", body.value, reason=body.reason or "",` 客服点的,`source` 记成 `agent`。`body.reason or ""` 把 `None` 换成空字符串,因为表里这一列的默认值是空串。
- `with connect() as conn:` `sqlite3` 的连接当上下文管理器用时,退出会自动提交(出异常则回滚),但不会关闭连接。练习里够用,生产换连接池。
- `ratio = edit_ratio(draft, body.text)` 客服点「发送」的那一刻就算出这条草稿被改了多少,不用等夜里批处理。`edit_ratio` 在下一步写。
- `eid = add_event(conn, body.trace_id, body.kind, 1, comment=body.comment, source="ticketing")` 转人工、追问这类「发生过」的事件,值统一写 1。

</div>

`from part06.fb_signals import edit_ratio` 那一行指向下一步才写的文件,所以现在先别运行。先把下一步的 `fb_signals.py` 敲好。

## 第四步:改写比例

客服把草稿改了多少,是今天唯一一个每条回复都有的信号,也是最值得花心思的。

```python
# agent-zero-lab/part06/fb_signals.py
"""Day 372:隐式信号。不用任何人点按钮,从行为里推出来。"""
from __future__ import annotations

import sqlite3
from difflib import SequenceMatcher

from part06.fb_store import add_event


def edit_ratio(draft: str, sent: str) -> float:
    """客服把草稿改了多少:0 = 原样发出,1 = 全部重写。"""
    return round(1 - SequenceMatcher(None, draft, sent).ratio(), 3)


def derive_edit_events(conn: sqlite3.Connection) -> int:
    rows = conn.execute("SELECT trace_id, draft, sent FROM replies WHERE sent IS NOT NULL").fetchall()
    for r in rows:
        add_event(conn, r["trace_id"], "edit_ratio", edit_ratio(r["draft"], r["sent"]), source="system")
    return len(rows)
```

<div class="line-notes">

- `from difflib import SequenceMatcher` 标准库就有的序列比较(Day 371 的 `curate` 里用过同一个类)。它按字符比较,对中文也能用,不用分词。
- `return round(1 - SequenceMatcher(None, draft, sent).ratio(), 3)` `ratio()` 是相似度,1 表示完全一样。用 1 减掉就是「改了多少」。第一个参数 `None` 是「不忽略任何字符」。
- `rows = conn.execute("SELECT trace_id, draft, sent FROM replies WHERE sent IS NOT NULL").fetchall()` 只算真正发出去的。草稿被丢弃、客服从头写的情况要在前端单独记一个「丢弃草稿」事件,这里算不出来,练习 1 会补。
- `add_event(conn, r["trace_id"], "edit_ratio", edit_ratio(r["draft"], r["sent"]), source="system")` 批量补算也走 `add_event`,同一条回复重复跑只会覆盖,不会多出一行。练习 3 会验证这一点。

</div>

阈值怎么定?我拿六种典型改法实测了一遍:

```python
# agent-zero-lab/part06/fb_ratio_cases.py
"""Day 372:五种典型改法,各自的改写比例是多少。"""
from __future__ import annotations

from part06.fb_signals import edit_ratio

CASES = [
    ("原样发出",
     "可以重开。请在「发票管理」里点作废,再按新抬头重新申请,一般 1 个工作日内开出。",
     "可以重开。请在「发票管理」里点作废,再按新抬头重新申请,一般 1 个工作日内开出。"),
    ("长草稿加一句客套",
     "可以重开。请在「发票管理」里点作废,再按新抬头重新申请,一般 1 个工作日内开出。",
     "可以重开。请在「发票管理」里点作废,再按新抬头重新申请,一般 1 个工作日内开出。如还有问题随时联系我们。"),
    ("短草稿加同一句客套",
     "企业版年付 1908 元/年。",
     "企业版年付 1908 元/年。如还有问题随时联系我们。"),
    ("专票资料补全",
     "请提供公司名称和税号即可。",
     "请提供公司名称、税号、注册地址和电话、开户行及账号,四项缺一不可。"),
    ("政策答反了",
     "很抱歉,年付套餐不支持中途退款,取消后可以使用到本期结束。",
     "可以退。专业版年付中途取消按剩余整月退款,已用的 4 个月和当月不退,还剩 7 个月,按每月 39 元退 273 元,主管审批后原路退回。"),
    ("错误码答错",
     "请清除浏览器缓存后重试。",
     "E4031 表示验证码已过期,请点「重新发送」,并在 5 分钟内输入。"),
]

for name, draft, sent in CASES:
    print(f"{name:<10}{edit_ratio(draft, sent):.3f}")
```

<div class="line-notes">

- `CASES = [` 每一项是 `(名字, 草稿, 客服发出的版本)`。前三条是客套话,后三条是真改错。
- `("长草稿加一句客套",` 同一句「如还有问题随时联系我们。」,加在 41 个字的草稿后面,改写比例是 0.128。
- `("短草稿加同一句客套",` 加在 15 个字的短草稿后面,同一句客套话就变成 0.286。草稿越短,同一句客套占的比例越大,这是改写比例最坑的地方。
- `for name, draft, sent in CASES:` 解包成三个变量,逐条打印。`{name:<10}` 是左对齐占 10 格。

</div>

在仓库根目录运行 `uv run python -m part06.fb_ratio_cases`,实测输出:

```text
原样发出      0.000
长草稿加一句客套  0.128
短草稿加同一句客套 0.286
专票资料补全    0.522
政策答反了     0.816
错误码答错     0.872
```

客套话最高 0.286,真改错的最低 0.522,我取 0.5 当「重度改写」的门槛。**这个数不是通用的。** 你的客服习惯不同、草稿长短不同,分布就不同。上线第一周先别定阈值,把所有改写比例的分布画出来,抽 30 条不同区间的回复人工看一遍,再决定从哪里切。

还有两个常见误判要记住。一是**改写少不等于答得好**:客服很忙、看都不看就点发送,改写比例全是 0,点踩也没有,这时候这个信号反而让你以为一切正常。所以除了看信号,每周还要随机抽一批完全没有负面信号的回复人工过一遍。二是**改写多不一定是 Agent 错**:政策刚调整、客服还在用旧口径改 Agent 的正确答案,也会表现为大量重度改写。明天的人审就是为了分清这两种情况。

## 第五步:跑一遍,看真实响应

不起服务器,用测试客户端把三个接口各打一遍。注意故意包含两个会出错的请求:

```python
# agent-zero-lab/part06/fb_try.py
"""Day 372:不起服务器,用 TestClient 把三个接口各打一遍,看真实响应和报错。"""
from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

from part06 import fb_store
from part06.fb_api import app

fb_store.DB = Path(tempfile.mkdtemp()) / "try.db"
with fb_store.connect() as conn:
    fb_store.add_reply(conn, trace_id="tr-0001", ticket_id="TK-1001", ticket="登录提示 E4031,怎么办?",
                       draft="请清除浏览器缓存后重试。")
c = TestClient(app)
for path, body in [
    ("/feedback/thumb", {"trace_id": "tr-0001", "value": -1, "reason": "missing_knowledge"}),
    ("/feedback/thumb", {"trace_id": "tr-0001", "value": 0}),
    ("/feedback/thumb", {"trace_id": "tr-9999", "value": 1}),
    ("/feedback/sent", {"trace_id": "tr-0001", "text": "E4031 表示验证码已过期,请点「重新发送」,并在 5 分钟内输入。"}),
    ("/feedback/ticket-event", {"trace_id": "tr-0001", "kind": "escalated", "comment": "转二线"}),
]:
    r = c.post(path, json=body)
    print(r.status_code, path, r.json())
with fb_store.connect() as conn:
    for e in conn.execute("SELECT event_id, kind, value, reason, source FROM events ORDER BY kind"):
        print(dict(e))
```

<div class="line-notes">

- `fb_store.DB = Path(tempfile.mkdtemp()) / "try.db"` 把数据库换成一个临时目录里的新文件,不动真正的 `feedback.db`。`tempfile.mkdtemp()` 每次返回一个新建的空目录路径。这一行必须在第一次 `connect()` 之前执行。
- `fb_store.add_reply(conn, trace_id="tr-0001", ticket_id="TK-1001", ticket="登录提示 E4031,怎么办?",` 先插一条回复,接口才有东西可以挂信号。
- `c = TestClient(app)` 测试客户端:不开端口,直接在进程里把请求交给 `app`,相当于前端测试里的 `supertest`。
- `("/feedback/thumb", {"trace_id": "tr-0001", "value": 0}),` 故意传 0,看 422。
- `("/feedback/thumb", {"trace_id": "tr-9999", "value": 1}),` 故意传一个不存在的 id,看 404。
- `print(r.status_code, path, r.json())` 打印状态码、路径、响应体。
- `for e in conn.execute("SELECT event_id, kind, value, reason, source FROM events ORDER BY kind"):` 最后直接查表,看到底存了什么。`dict(e)` 把 `Row` 转成字典好打印。

</div>

`uv run python -m part06.fb_try`,实测输出:

```text
200 /feedback/thumb {'event_id': 'tr-0001:thumb:agent'}
422 /feedback/thumb {'detail': [{'type': 'literal_error', 'loc': ['body', 'value'], 'msg': 'Input should be 1 or -1', 'input': 0, 'ctx': {'expected': '1 or -1'}}]}
404 /feedback/thumb {'detail': 'unknown trace_id tr-9999'}
200 /feedback/sent {'edit_ratio': 0.872}
200 /feedback/ticket-event {'event_id': 'tr-0001:escalated:ticketing'}
{'event_id': 'tr-0001:edit_ratio:system', 'kind': 'edit_ratio', 'value': 0.872, 'reason': '', 'source': 'system'}
{'event_id': 'tr-0001:escalated:ticketing', 'kind': 'escalated', 'value': 1.0, 'reason': '', 'source': 'ticketing'}
{'event_id': 'tr-0001:thumb:agent', 'kind': 'thumb', 'value': -1.0, 'reason': 'missing_knowledge', 'source': 'agent'}
```

怎么读:五个请求里,合法的三个都存进去了,表里一共三行,每行的 `event_id` 都由「回复 id + 信号类型 + 来源」拼成。`value=0` 被 pydantic 的 `Literal` 挡在 422,错误信息写得很清楚:`Input should be 1 or -1`,还指出了出错的位置 `['body', 'value']`。不存在的 id 得到 404。这两个报错都发生在写库之前,库里没有脏数据。`/feedback/sent` 返回的改写比例 0.872,和上一步表里「错误码答错」那行一样,因为用的是同一对文字。

再写测试,让这些行为固定下来:

```python
# agent-zero-lab/part06/test_fb_api.py
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from part06 import fb_store
from part06.fb_api import app


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(fb_store, "DB", tmp_path / "fb.db")
    with fb_store.connect() as conn:
        fb_store.add_reply(conn, trace_id="tr-x", ticket_id="TK-1", ticket="登录提示 E4031,怎么办?",
                           draft="请清除浏览器缓存后重试。")
    return TestClient(app)


def test_thumb_is_idempotent_and_overwritable(client: TestClient):
    assert client.post("/feedback/thumb", json={"trace_id": "tr-x", "value": -1, "reason": "missing_knowledge"}).status_code == 200
    assert client.post("/feedback/thumb", json={"trace_id": "tr-x", "value": 1}).status_code == 200   # 改主意
    with fb_store.connect() as conn:
        rows = conn.execute("SELECT value, reason FROM events WHERE kind = 'thumb'").fetchall()
    assert [(r["value"], r["reason"]) for r in rows] == [(1.0, "")]


def test_sent_computes_edit_ratio(client: TestClient):
    resp = client.post("/feedback/sent", json={"trace_id": "tr-x", "text": "E4031 表示验证码已过期,请点「重新发送」。"})
    assert resp.json()["edit_ratio"] > 0.5


def test_rejects_bad_input(client: TestClient):
    assert client.post("/feedback/thumb", json={"trace_id": "nope", "value": 1}).status_code == 404
    assert client.post("/feedback/thumb", json={"trace_id": "tr-x", "value": 0}).status_code == 422
    assert client.post("/feedback/ticket-event", json={"trace_id": "tr-x", "kind": "refunded"}).status_code == 422
```

<div class="line-notes">

- `@pytest.fixture` fixture 是 pytest 的「准备工作」:测试函数的参数里写了 `client`,pytest 就先运行这个函数,把返回值传进来。Day 72 讲过。
- `def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:` `tmp_path` 是 pytest 提供的每个测试一个的临时目录,`monkeypatch` 能临时替换变量,测试结束自动还原。
- `monkeypatch.setattr(fb_store, "DB", tmp_path / "fb.db")` 每个测试一个临时库,不污染 `feedback.db`。前面 `connect()` 在调用时才读 `DB`,这一行才管用。
- `assert client.post("/feedback/thumb", json={"trace_id": "tr-x", "value": 1}).status_code == 200   # 改主意` 先点踩(带原因)再点赞,是同一个 `event_id`。
- `assert [(r["value"], r["reason"]) for r in rows] == [(1.0, "")]` 表里只有一行 thumb,值是 1,原因被覆盖成空串。注意:改主意时如果不带原因,旧的原因也会被清掉,这是有意的,新的表态替换旧的。
- `assert resp.json()["edit_ratio"] > 0.5` 这对草稿和发出版本的改写比例是 0.872。
- `assert client.post("/feedback/thumb", json={"trace_id": "tr-x", "value": 0}).status_code == 422` 参数不合法一律 422。

</div>

`uv run python -m pytest -q part06/test_fb_api.py`,实测 `3 passed in 1.13s`。

## 第六步:造一周的虚构数据

练习环境里没有真实客服,先造一周的数据。**所有数据都是虚构的**:200 条回复,大部分正常,埋了三类真实世界里会出现的毛病:一个政策理解错(年付退款),一个知识缺失(专票资料),一个新错误码(E4031,帮助中心里还没有这篇)。为了明天的聚类有东西可聚,同一个问题的客户问法和 Agent 草稿措辞都有几种变体。造数据时我还另存了一份答案(哪条回复真的有毛病、属于哪个场景),明天用来检验聚类准不准。

```python
# agent-zero-lab/part06/fb_simulate.py
"""Day 372:造一周的线上数据(全是虚构的):200 条回复,埋了三类毛病。
用法: uv run python -m part06.fb_simulate"""
from __future__ import annotations

import json
import random
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from part06.fb_signals import derive_edit_events
from part06.fb_store import DB, add_event, add_reply, connect


@dataclass
class Scenario:
    name: str
    category: str
    tickets: list[str]          # 同一个问题,客户的几种问法
    drafts: list[str]           # Agent 起草的几种措辞
    fixed: str                  # 客服实际发出的正确版本
    p_bad: float                # 这类工单里,Agent 草稿出问题的概率
    reason: str | None = None   # 客服点踩时多半会勾的原因


SCENARIOS = [
    Scenario("ok_invoice_title", "invoice",
             ["发票抬头写错了,能重开吗?", "开出来的发票公司名少了两个字,可以重新开吗?", "发票抬头有误,需要作废重开"],
             ["可以重开。请在「发票管理」里点作废,再按新抬头重新申请,一般 1 个工作日内开出。"],
             "可以重开。请在「发票管理」里点作废,再按新抬头重新申请,一般 1 个工作日内开出。", 0.05),
    Scenario("ok_export_bug", "bug",
             ["导出 Excel 一直转圈。", "点导出以后页面卡住,一直在加载"],
             ["抱歉给您添麻烦了。导出超过 5 万行时会超时,建议按月份分批导出,我们已经记录这个问题。"],
             "抱歉给您添麻烦了。导出超过 5 万行时会超时,建议按月份分批导出,我们已经记录这个问题。", 0.08),
    Scenario("ok_price", "billing",
             ["企业版一年多少钱?", "想问下企业版年付的价格"],
             ["企业版年付 1908 元/年,月付 199 元/月,年付相当于打八折。"],
             "企业版年付 1908 元/年,月付 199 元/月,年付相当于打八折。", 0.05),
    # 毛病一:政策理解错
    Scenario("bad_annual_refund", "refund",
             ["专业版年付用了 4 个多月,剩下的能退吗?", "年付买了快半年,现在不想用了,没用完的部分能不能退钱", "年付专业版中途取消,剩余的费用退不退?"],
             ["很抱歉,年付套餐不支持中途退款,取消后可以使用到本期结束。",
              "年付套餐一经购买不可退款,您可以继续使用到到期日。"],
             "可以退。专业版年付中途取消按剩余整月退款,已用的 4 个月和当月不退,还剩 7 个月,按每月 39 元退 273 元,主管审批后原路退回。",
             0.85, "wrong_policy"),
    # 毛病二:知识缺失,专票资料答漏
    Scenario("bad_vat_docs", "invoice",
             ["开增值税专用发票要什么资料?", "我们要专票,需要准备哪些信息", "想开专用发票,要提供什么?"],
             ["请提供公司名称和税号即可。", "专票需要您提供公司名称和纳税人识别号。"],
             "请提供公司名称、税号、注册地址和电话、开户行及账号,四项缺一不可。", 0.6, "missing_knowledge"),
    # 毛病三:新错误码,帮助中心里还没有
    Scenario("bad_e4031", "account",
             ["登录提示 E4031,怎么办?", "一登录就报 E4031 是什么意思", "错误码 E4031,登不上去"],
             ["请清除浏览器缓存后重试。", "建议您更换浏览器,并清除缓存后再次登录。"],
             "E4031 表示验证码已过期,请点「重新发送」,并在 5 分钟内输入。", 0.7, "missing_knowledge"),
]
WEIGHTS = [40, 30, 30, 12, 8, 10]          # 场景出现的相对频率,正常的多,出问题的少


def main() -> None:
    rnd = random.Random(7)
    DB.unlink(missing_ok=True)
    conn = connect()
    start = datetime(2026, 10, 12, tzinfo=timezone.utc)
    truth: dict[str, str] = {}                               # 答案:每条回复真实属于哪个场景、是否出了毛病。只给后面验证聚类用,线上没有
    for i in range(200):
        sc = rnd.choices(SCENARIOS, weights=WEIGHTS)[0]
        bad = rnd.random() < sc.p_bad
        draft = rnd.choice(sc.drafts)
        ticket = rnd.choice(sc.tickets)
        tid = f"tr-{i:04d}"
        ts = (start + timedelta(minutes=50 * i)).isoformat(timespec="seconds")
        sent = sc.fixed if bad else draft
        truth[tid] = sc.name if sent != draft else "fine"
        if not bad and rnd.random() < 0.3:
            sent = draft + "如还有问题随时联系我们。"          # 正常情况下客服也会顺手加一句客套
        add_reply(conn, trace_id=tid, ticket_id=f"TK-{1000 + i}", customer_id=f"C{rnd.randint(1, 30):03d}",
                  category=sc.category, ticket=ticket, draft=draft, sent=sent, prompt_version="pb-v1", created_at=ts)
        if rnd.random() < 0.25:                              # 只有四分之一的回复会被点赞点踩
            reason = sc.reason if bad and rnd.random() < 0.6 else None
            add_event(conn, tid, "thumb", -1 if bad else 1, reason=reason or "", source="agent", ts=ts)
        if bad and sc.name == "bad_e4031" and rnd.random() < 0.6:
            add_event(conn, tid, "escalated", 1, comment="转二线", source="ticketing", ts=ts)
        if bad and sc.name == "bad_vat_docs" and rnd.random() < 0.7:
            add_event(conn, tid, "reopened", 1, comment="客户 24 小时内追问", source="ticketing", ts=ts)
        if rnd.random() < 0.1:                               # 一成客户会填满意度
            add_event(conn, tid, "csat", rnd.choice([1, 2]) if bad else rnd.choice([4, 5]), source="customer", ts=ts)
    Path(__file__).with_name("fb_truth.json").write_text(json.dumps(truth, ensure_ascii=False), encoding="utf-8")
    n = derive_edit_events(conn)
    conn.commit()
    total = conn.execute("SELECT kind, COUNT(*) AS n FROM events GROUP BY kind ORDER BY n DESC").fetchall()
    print(f"写入 {n} 条回复;事件:", {r["kind"]: r["n"] for r in total})


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `class Scenario:` 一个场景,用 `dataclass` 装(Day 371 讲过)。`tickets` 是同一个问题的几种问法,`drafts` 是 Agent 起草的几种措辞,`fixed` 是客服实际发出的正确版本,`p_bad` 是这类工单里草稿出问题的概率。
- `reason: str | None = None   # 客服点踩时多半会勾的原因` 有默认值的字段必须放在没有默认值的后面,这是 `dataclass` 的规则。
- `Scenario("ok_invoice_title", "invoice",` 前三个场景正常,`p_bad` 只有 5% 到 8%。这些「出问题」的回复,草稿和修正版是同一段话,所以会表现成「点了踩但一个字没改」,用来模拟误点。
- `# 毛病一:政策理解错` 年付退款。`fixed` 里的算式按虚构政策来:12 个月减去已用 4 个月再减当月,剩 7 个月,7 × 39 = 273 元。
- `0.85, "wrong_policy"),` 这类工单里 85% 的草稿是错的,客服点踩时多半勾「答错政策」。
- `# 毛病三:新错误码,帮助中心里还没有` E4031 是验证码过期。草稿让客户清缓存,和真正原因无关。
- `WEIGHTS = [40, 30, 30, 12, 8, 10]` 六个场景的抽样权重,和 `SCENARIOS` 一一对应。正常的占 100/130,约四分之三。
- `rnd = random.Random(7)` 固定种子,每次生成的数据完全一样,你跑出来的数字应该和文中一致。
- `DB.unlink(missing_ok=True)` 每次重新造数前删掉旧库。`missing_ok` 让文件不存在时也不报错。
- `truth: dict[str, str] = {}` 造数据的人知道每条回复「真实上」有没有毛病、属于哪个场景,存成一份答案 `fb_truth.json`,只在明天验证聚类准不准时用。线上当然没有这份答案,这是造数据才有的好处。
- `sc = rnd.choices(SCENARIOS, weights=WEIGHTS)[0]` `choices` 按权重抽样,返回列表,取第一个。
- `sent = sc.fixed if bad else draft` 出了问题,客服就发修正版;没问题就原样发。
- `truth[tid] = sc.name if sent != draft else "fine"` 发出的版本和草稿不一样,才算这条回复真的有毛病(正常场景里被「误点」的那些草稿和发出版本一样,算 fine)。这一行放在加客套话之前,客套话不算毛病。
- `sent = draft + "如还有问题随时联系我们。"          # 正常情况下客服也会顺手加一句客套` 正常回复里有三成会加客套话,用来制造改写比例的噪声。
- `if rnd.random() < 0.25:                              # 只有四分之一的回复会被点赞点踩` 显式反馈稀疏。实测 200 条里 60 条有点赞点踩(30%,抽样会有波动)。
- `reason = sc.reason if bad and rnd.random() < 0.6 else None` 点踩的人里六成会勾原因。
- `if bad and sc.name == "bad_e4031" and rnd.random() < 0.6:` E4031 出错的回复里六成会被转二线。
- `Path(__file__).with_name("fb_truth.json").write_text(json.dumps(truth, ensure_ascii=False), encoding="utf-8")` 把答案写到文件。`ensure_ascii=False` 让中文原样存,不变成 `\u` 转义。
- `n = derive_edit_events(conn)` 最后统一算一遍改写比例。线上是在 `/feedback/sent` 里实时算的,这里是补算。
- `print(f"写入 {n} 条回复;事件:", {r["kind"]: r["n"] for r in total})` 字典推导式,把查询结果变成 `{信号类型: 条数}`。

</div>

`uv run python -m part06.fb_simulate`,实测输出:

```text
写入 200 条回复;事件: {'edit_ratio': 200, 'thumb': 60, 'csat': 26, 'escalated': 6, 'reopened': 3}
```

再写一个小脚本,从几个角度看看这堆信号:

```python
# agent-zero-lab/part06/fb_peek.py
"""Day 372:看一眼表里的信号:有多少回复有显式反馈,改写比例怎么分布,几种信号重叠多少。"""
from __future__ import annotations

from part06.fb_store import connect

conn = connect()
n = conn.execute("SELECT COUNT(*) FROM replies").fetchone()[0]
print("回复总数:", n)

for kind in ["thumb", "csat", "escalated", "reopened"]:
    k = conn.execute("SELECT COUNT(DISTINCT trace_id) FROM events WHERE kind = ?", (kind,)).fetchone()[0]
    print(f"有 {kind:<9}的回复: {k:>3} 条({k / n:.0%})")

print("\n改写比例分布:")
for label, lo, hi in [("原样发出 = 0", 0, 0.0001), ("轻改 (0, 0.5)", 0.0001, 0.5), ("重改 >= 0.5", 0.5, 1.01)]:
    k = conn.execute("SELECT COUNT(*) FROM events WHERE kind = 'edit_ratio' AND value >= ? AND value < ?", (lo, hi)).fetchone()[0]
    print(f"  {label:<14}{k:>4} 条")

heavy = conn.execute("SELECT trace_id FROM events WHERE kind = 'edit_ratio' AND value >= 0.5").fetchall()
ids = [r["trace_id"] for r in heavy]
marks = ",".join("?" * len(ids))
down = conn.execute(f"SELECT COUNT(DISTINCT trace_id) FROM events WHERE kind = 'thumb' AND value = -1 AND trace_id IN ({marks})", ids).fetchone()[0]
print(f"\n重改的 {len(ids)} 条里,有人点踩的只有 {down} 条")
print("点踩勾的原因:", {r["reason"] or "(没勾)": r["n"] for r in conn.execute(
    "SELECT reason, COUNT(*) AS n FROM events WHERE kind = 'thumb' AND value = -1 GROUP BY reason ORDER BY n DESC")})
```

<div class="line-notes">

- `n = conn.execute("SELECT COUNT(*) FROM replies").fetchone()[0]` `COUNT(*)` 只返回一行一列,`fetchone()[0]` 取出那个数。
- `k = conn.execute("SELECT COUNT(DISTINCT trace_id) FROM events WHERE kind = ?", (kind,)).fetchone()[0]` 数「有这种信号的回复有几条」。用 `DISTINCT`,因为同一条回复可能有多行事件。
- `for label, lo, hi in [("原样发出 = 0", 0, 0.0001), ("轻改 (0, 0.5)", 0.0001, 0.5), ("重改 >= 0.5", 0.5, 1.01)]:` 三个区间:`lo <= v < hi`。第一个区间用 0.0001 当上界,是因为浮点数比较 `== 0` 不稳妥,写成一个小区间更保险。
- `marks = ",".join("?" * len(ids))` 重改有 39 条,就拼出 39 个 `?` 用逗号隔开,放进 `IN (...)`。值仍然走占位符。
- `down = conn.execute(f"SELECT COUNT(DISTINCT trace_id) FROM events WHERE kind = 'thumb' AND value = -1 AND trace_id IN ({marks})", ids).fetchone()[0]` 在重度改写的回复里,有多少条同时被点踩。
- `print("点踩勾的原因:"` 空字符串在 Python 里是假值,所以 `r["reason"] or "(没勾)"` 把没勾的显示成「(没勾)」。

</div>

`uv run python -m part06.fb_peek`,实测输出:

```text
回复总数: 200
有 thumb    的回复:  60 条(30%)
有 csat     的回复:  26 条(13%)
有 escalated的回复:   6 条(3%)
有 reopened 的回复:   3 条(2%)

改写比例分布:
  原样发出 = 0       120 条
  轻改 (0, 0.5)     41 条
  重改 >= 0.5       39 条

重改的 39 条里,有人点踩的只有 8 条
点踩勾的原因: {'(没勾)': 5, 'missing_knowledge': 3, 'wrong_policy': 2}
```

三个观察。第一,**显式反馈是稀的**:200 条回复里只有 60 条有人点,点踩的只有 10 条,而且 10 条里有 5 条没勾原因。第二,**隐式反馈把盲区补上了**:重度改写有 39 条,其中被点踩的只有 8 条,只看点踩的话,你会漏掉将近八成的问题。第三,**点踩也不是真相**:10 条点踩里有 2 条的改写比例低于 0.5,在这份造出来的数据里它们是误点,客服点了踩、一个字没改。

这份数据里信号比真实世界干净得多。画一下改写比例的直方图(练习 2),你会看到几乎只有两个山头,一个在 0.1 到 0.3(客套话),一个在 0.8 到 0.9(真重写),中间很空。真实数据里这个分布会糊得多,阈值也就更难切。造数据的意义是让你有一个已知答案的环境来写代码,而不是证明阈值总能这么轻松地切开。

## 动手练习

1. **多一个信号:丢弃草稿。** 客服不满意直接丢掉草稿、从头写,这是比「改得多」更强的信号。在 `fb_api.py` 的基础上加一个 `/feedback/discard` 接口,写入 `discarded` 事件,并把改写比例记成 1.0。
2. **画改写比例的分布。** 用 `fb_simulate` 造好的库,按 0.1 一档打印直方图,找出阈值该切在哪。
3. **补算是幂等的吗?** 删掉所有 `edit_ratio` 事件,用 `derive_edit_events` 补算,再补算一次,看行数。
4. **设计点踩原因的选项。** 假设你的产品是一个会议纪要生成器(不是客服),给点踩设计 4 到 5 个原因选项,说明为什么这样分。

### 参考答案

**练习 1**

```python
# agent-zero-lab/part06/ex372_discard.py
"""Day 372 练习 1:客服丢弃草稿、自己从头写,也是一个信号。给 fb_api 加 /feedback/discard,用 TestClient 验证。"""
from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi.testclient import TestClient
from pydantic import BaseModel

from part06 import fb_store
from part06.fb_api import app, draft_of
from part06.fb_store import add_event, connect


class Discard(BaseModel):
    trace_id: str
    text: str                 # 客服从头写的那份


@app.post("/feedback/discard")
def discard(body: Discard) -> dict[str, float]:
    with connect() as conn:
        draft_of(conn, body.trace_id)
        conn.execute("UPDATE replies SET sent = ? WHERE trace_id = ?", (body.text, body.trace_id))
        add_event(conn, body.trace_id, "discarded", 1, source="agent")
        add_event(conn, body.trace_id, "edit_ratio", 1.0, source="system")     # 丢弃等于全部重写
    return {"edit_ratio": 1.0}


if __name__ == "__main__":
    fb_store.DB = Path(tempfile.mkdtemp()) / "ex1.db"
    with connect() as conn:
        fb_store.add_reply(conn, trace_id="tr-1", ticket_id="TK-1", ticket="登录提示 E4031", draft="请清除浏览器缓存。")
    c = TestClient(app)
    print(c.post("/feedback/discard", json={"trace_id": "tr-1", "text": "E4031 是验证码过期,请重新发送。"}).json())
    print(c.post("/feedback/discard", json={"trace_id": "tr-1", "text": "E4031 是验证码过期,请重新发送。"}).json())
    with connect() as conn:
        print([tuple(r) for r in conn.execute("SELECT kind, value, source FROM events ORDER BY kind")])
```

<div class="line-notes">

- `from part06.fb_api import app, draft_of` 直接复用已有的 `app` 和「查草稿并在不存在时 404」的函数,不重复写。
- `class Discard(BaseModel):` 请求体:哪条回复、客服从头写的文本是什么。
- `@app.post("/feedback/discard")` 在已有的 `app` 上再挂一个路由。练习里这样写够用,真正加功能时应该直接改 `fb_api.py`。
- `add_event(conn, body.trace_id, "discarded", 1, source="agent")` 丢弃是客服的动作,来源 `agent`。
- `add_event(conn, body.trace_id, "edit_ratio", 1.0, source="system")     # 丢弃等于全部重写` 同时把改写比例记成 1.0。这样明天的分诊不用额外处理「丢弃」,它在改写比例里已经是最重的一档。
- `print(c.post("/feedback/discard"` 同一个请求发两次。

</div>

实测输出:

```text
{'edit_ratio': 1.0}
{'edit_ratio': 1.0}
[('discarded', 1.0, 'agent'), ('edit_ratio', 1.0, 'system')]
```

接口发了两次,表里只有两行:`event_id` 一样,第二次是覆盖。

**练习 2**

```python
# agent-zero-lab/part06/ex372_hist.py
"""Day 372 练习 2:画改写比例的分布,找阈值该切在哪。"""
from __future__ import annotations

from part06.fb_store import connect

conn = connect()
values = [r["value"] for r in conn.execute("SELECT value FROM events WHERE kind = 'edit_ratio' AND value > 0")]
print(f"改过的回复 {len(values)} 条")
for lo in [i / 10 for i in range(10)]:
    k = sum(lo <= v < lo + 0.1 for v in values)
    print(f"{lo:.1f}-{lo + 0.1:.1f} {'#' * k} {k}")
```

<div class="line-notes">

- `values = [r["value"] for r in conn.execute("SELECT value FROM events WHERE kind = 'edit_ratio' AND value > 0")]` 只取改过的(大于 0),原样发出的 120 条不进直方图。
- `for lo in [i / 10 for i in range(10)]:` 生成 0.0、0.1、……、0.9 十个起点。
- `k = sum(lo <= v < lo + 0.1 for v in values)` 落在这一档的个数。浮点数相加有误差,边界上的值可能被分到相邻的档,画直方图够用。
- `print(f"{lo:.1f}-{lo + 0.1:.1f} {'#' * k} {k}")` 用 `#` 画条形,字符串乘整数就是重复。

</div>

实测输出:

```text
改过的回复 80 条
0.0-0.1  0
0.1-0.2 ###################################### 38
0.2-0.3 ## 2
0.3-0.4 # 1
0.4-0.5  0
0.5-0.6 ## 2
0.6-0.7 # 1
0.7-0.8  0
0.8-0.9 #################################### 36
0.9-1.0  0
```

两个山头:0.1 到 0.2 有 38 条(客套话),0.8 到 0.9 有 36 条(真重写),中间 0.3 到 0.7 一共只有 6 条。阈值切在 0.4 到 0.5 之间都行。如果真实数据在中间很满,就不要硬切一刀,可以分三档:轻改、中改、重改,只对重改自动进队列,中改留给抽样。

**练习 3**

```python
# agent-zero-lab/part06/ex372_rebuild.py
"""Day 372 练习 3:删掉所有 edit_ratio 事件,用 derive_edit_events 补算,再补算第二次,行数都应该是 200。"""
from __future__ import annotations

from part06.fb_signals import derive_edit_events
from part06.fb_store import connect

conn = connect()


def count() -> int:
    return int(conn.execute("SELECT COUNT(*) FROM events WHERE kind = 'edit_ratio'").fetchone()[0])


print("原来:", count())
conn.execute("DELETE FROM events WHERE kind = 'edit_ratio'")
print("删掉后:", count())
derive_edit_events(conn)
print("补算一次:", count())
derive_edit_events(conn)
print("再补算一次:", count())
conn.commit()
```

<div class="line-notes">

- `def count() -> int:` 数现在有几行 `edit_ratio` 事件。`int(...)` 把 `fetchone()[0]` 转成整数,类型检查器才满意。
- `conn.execute("DELETE FROM events WHERE kind = 'edit_ratio'")` 全删。
- `derive_edit_events(conn)` 补算。它对每条已发出的回复调用 `add_event`,键是 `回复:edit_ratio:system`。
- `conn.commit()` 最后提交,让删除和补算真正落库。

</div>

实测输出:

```text
原来: 200
删掉后: 0
补算一次: 200
再补算一次: 200
```

补算两次,行数不变,因为 `event_id` 一样,第二次全是覆盖。这就是幂等:操作重复执行,结果不变。

**练习 4**(开放题,给一个示范)

会议纪要生成器的点踩原因:「漏了重要决议」「把话安到了错的人头上」「出现了会上没说过的内容」「待办事项不对」「格式或语气不对」,外加一个「其他」。分法的依据:每个选项对应一种不同的修法。漏决议和待办不对,是提取的问题;安错人是说话人识别的问题;出现没说过的内容是幻觉。如果选项是「不准确」「不好」,点踩之后你还是要一条条打开看。选项数量控制在五六个,再多客服就不愿意选了。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 显式反馈 | 用户主动表态,如点赞点踩、评分、勾选原因。量少、可信度高、偏向两头 |
| 隐式反馈 | 从行为里推出的信号,如改写比例、转人工、追问。每条都有、无需配合、噪声大 |
| 结果反馈 | 业务最终结果,如退款被驳回、取消订阅。最接近真实目标,但慢且难归因 |
| 改写比例 | 1 减去草稿和最终发出版本的相似度,0 是原样发出,1 是全部重写 |
| 幂等 | 同一个操作重复执行,结果和执行一次一样 |
| upsert | 有就更新、没有就插入。SQLite 里写成 `INSERT ... ON CONFLICT DO UPDATE` |
| 外键 | 一列的值必须是另一张表主键里已有的值,如 `events.trace_id` 指向 `replies.trace_id` |
| fixture | pytest 里为测试准备环境的函数,测试函数的参数名匹配它,pytest 就自动先运行它 |
| monkeypatch | pytest 提供的临时替换工具,测试结束自动还原 |
| webhook | 对方系统发生事件时,主动向你的接口发一个 HTTP 请求。工单系统的「转人工」就是这样通知的 |

## 常见误区

**以为点赞点踩够用了。** 实测 200 条回复只有 60 条有人点,重度改写的 39 条里只有 8 条被点踩。只看显式反馈会漏掉大部分问题。

**把点踩当成真相。** 10 条点踩里有 2 条草稿一个字没改,是误点。显式反馈可信度高,但不是百分之百。

**用自增 id 当事件主键。** 前端重发、客服改主意都会对同一条回复提交同一种信号。自增 id 每次都不一样,计数就会虚高。用「回复 + 类型 + 来源」拼主键再 upsert。

**只存最终发出的版本。** 没有草稿就算不出改写比例,事后补不回来。草稿和最终版本要分开存。

**阈值照抄别人的。** 同一句客套话,加在长草稿后是 0.128,加在短草稿后是 0.286。阈值要用自己的数据画分布、抽样看了再定。

**信号沉默就当没问题。** 客服忙的时候不改不点,所有信号都是 0。每周还要随机抽一批没有任何负面信号的回复人工看。

**默认参数里引用模块变量。** 写成 `def connect(path=DB)` 会在定义函数时就把路径定死,测试里替换 `DB` 没有用。默认写 `None`,函数体里再取。

## 学习资料

### 文档与文章

- [Langfuse · From user feedback to evaluation datasets](https://langfuse.com/resources/engineering/user-feedback-to-evaluation-datasets):官方写的完整流程,反馈存成 score、过滤、加进数据集,和今天、明天的内容一一对应,20 分钟。
- [Langfuse · User Feedback](https://langfuse.com/docs/observability/features/user-feedback):浏览器端怎么直接上报点赞点踩,15 分钟。
- [Langfuse · Corrections](https://langfuse.com/docs/observability/features/corrections):在 trace 上写一份修正后的输出,和「改写」是同一类信号,10 分钟。
- [Agent-in-the-Loop(arXiv 2510.06674)](https://arxiv.org/abs/2510.06674):Airbnb 客服 LLM 系统在日常工作流里嵌入四种标注,论文自报重训周期从几个月缩短到几周,正式版在 [ACL Anthology](https://aclanthology.org/2025.emnlp-industry.135/),30 分钟。
- [Eugene Yan · Patterns for Building LLM-based Systems & Products](https://eugeneyan.com/writing/llm-patterns/):最后一节「Collect user feedback」讲显式和隐式反馈的设计,20 分钟。
- [Hamel Husain · A Field Guide to Rapidly Improving AI Products](https://hamel.dev/blog/posts/field-guide/):为什么要看数据、让领域专家直接参与,30 分钟。
- [Python 文档 · sqlite3](https://docs.python.org/zh-cn/3.12/library/sqlite3.html) 和 [SQLite · UPSERT](https://sqlite.org/lang_upsert.html):`ON CONFLICT DO UPDATE` 的官方说明。
- [FastAPI · 测试](https://fastapi.tiangolo.com/tutorial/testing/):`TestClient` 的用法。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1WPnuzPEzD&autoplay=0&high_quality=1" title="为什么AI评估是产品构建者最热门的新技能 | Hamel Husain &amp; Shreya Shankar [附文稿]" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Web3天空之城 · 为什么AI评估是产品构建者最热门的新技能 | Hamel Husain &amp; Shreya Shankar · 106 分钟的访谈搬运,带中文文稿。重点听两人讲「先看线上真实数据、手工记笔记、再归类」那一段,和今天的信号、明天的分诊是同一件事。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/e2i6JbU2R-s" title="Error Analysis: The Highest ROI Technique In AI Engineering" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hamel Husain · Error Analysis: The Highest ROI Technique In AI Engineering · 英文,讲怎么从线上 trace 里抽样、手写笔记、归类。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):第 10 章后半部分专讲用户反馈,包括从对话里提取反馈、反馈设计和反馈的局限。今天的信号分类参考了它,英文。
- Chip Huyen《Designing Machine Learning Systems》(O'Reilly,2022):第 8 章讲数据分布变化和监控,帮你理解「测试集为什么会过期」,英文。

### 开源项目与代码

- [langfuse/langfuse](https://github.com/langfuse/langfuse):自托管版本,score、dataset、annotation queue 都在里面,看它怎么设计「反馈」这个数据结构。
- 今天的 `part06/fb_store.py`、`fb_signals.py`、`fb_api.py` 三个文件加一个测试,约 150 行,可以直接搬进后面的项目。

## 自测

1. 显式反馈、隐式反馈、结果反馈各举两个例子,它们在量和可信度上有什么区别?

<details><summary>答案</summary>

显式:客服点踩、客户满意度评分,量少、可信度高、偏向两头。隐式:草稿改写比例、转人工或客户追问,每条都有、不用配合,但噪声大。结果:退款被主管驳回、客户一个月内取消订阅,最接近业务目标,但来得慢、很难归因到某一条回复,适合月度复盘和 A/B 实验。

</details>

2. `events` 表的主键为什么是 `trace_id:kind:source`,不用自增 id?

<details><summary>答案</summary>

为了幂等。前端重发、客服改主意、补算脚本重跑,都会对同一条回复提交同一种信号。用业务含义拼出主键加 upsert,重复提交只会覆盖而不是新增一行,计数才不会虚高。自增 id 每次插入都不同,做不到。

</details>

3. 同一句客套话「如还有问题随时联系我们。」,为什么在不同草稿后面的改写比例不一样?这对阈值意味着什么?

<details><summary>答案</summary>

改写比例按相对长度算。实测加在 41 字的草稿后面是 0.128,加在 15 字的短草稿后面是 0.286。所以阈值取决于草稿长度的分布,不能照抄别人的数。上线后先画出自己的分布,抽样看过再切。

</details>

4. 实测里重度改写 39 条,只有 8 条被点踩。这说明什么?

<details><summary>答案</summary>

显式反馈覆盖率低,只看点踩会漏掉将近八成的问题。隐式信号每条回复都有,能补盲区。但隐式信号噪声也大,所以后面还要分诊和人审,不能让任何一种信号单独决定什么算错。

</details>

5. 为什么 `/feedback/thumb` 在写库前要先查回复是否存在,返回 404?

<details><summary>答案</summary>

信号挂在不存在的回复上没有意义,而且 SQLite 默认不强制外键,不查就会写进孤儿数据。最常见的原因是前端拿错了 id,404 比悄悄存进去更容易发现。

</details>

6. **面试题**:你的 Agent 上线了,怎么知道它在线上答得好不好?

<details><summary>答案</summary>

分三类信号来讲。显式:客服点赞点踩加原因选项,客户满意度,量少但可信。隐式:草稿被改写的比例、丢弃草稿、转人工、客户追问,每条都有但噪声大,阈值要用自己的分布定。结果:退款驳回、取消订阅,慢,用在月度复盘。存储上每次回复一个 trace_id,草稿和最终版本分开存,信号写事件表并用幂等主键防重。还要讲局限:信号沉默不等于没问题,要随机抽查没有负面信号的回复;改写多也可能是政策变了而不是 Agent 错。能带一个数字更好,比如「我造的一周数据里,重度改写的 39 条只有 8 条被点踩」。

</details>

## 明天预告

Day 373 · 反馈闭环(二):badcase 分诊、聚类、进测试集。今天收进来的 200 条回复里有 39 条重度改写,但客户问法和草稿措辞都不一样,怎么知道它们其实是同三个问题?明天用 embedding 把相似的聚成组,按可疑度排队,人审以后变成测试用例,再接回 Day 371 的手册门禁。
