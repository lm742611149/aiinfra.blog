---
title: 'Day 144 · 上线后的反馈闭环:点赞、改写、badcase 到测试集的数据飞轮'
description: '测试集是上线前写的,线上的问题它不认识。这一课把客服点踩、草稿被改了多少、转人工、客户追问这些信号收进一张表,每周算一遍健康报表,把可疑回复去重成组交给人审,审过的变成 Day 31 格式的测试用例,知识缺失的起草成帮助中心文章,最后同步到 Langfuse。代码全部可跑,用一周模拟数据实测。'
pubDate: 2026-10-22
regime: none
tags: ['feedback', 'data-flywheel', 'eval', 'observability', 'agent-60']
series: 'agent-60'
day: 144
lang: 'zh'
---

## 今天要解决的问题

**建议在 [Day 52 · 可观测与成本:接 Langfuse、算单工单成本、缓存与模型路由](/blog/agent-60/day-52-capstone-observability-cost/) 之后读。** 这是专题篇的一课,不用按顺序学。你需要有 Day 31 的测试集格式、Day 35 的回归门禁,知道 Day 52 里每次回复都有一个 Langfuse trace。昨天的 Day 143 讲了怎么让程序自动改 prompt,结论之一是测试集要持续从线上补新样本,今天讲的就是这些样本从哪来。

SupportPilot 上线一周后,你会遇到一个很尴尬的情况:评测集分数一直是绿的,CI 门禁每次都过,可客服组长在群里说「Agent 最近答 E4031 那类问题全是错的,我们每条都在手改」。你翻测试集,里面根本没有 E4031,它是上周才出现的新错误码。测试集是上线前你根据帮助中心和自己的想象写的,线上用户问的东西它不认识。

能告诉你哪里出问题的,只有线上的反馈:客服点了踩,客服把草稿几乎全部重写才发出去,工单转了二线,客户第二天又来追问。这些信号单独看都很嘈杂,收集起来、对齐到同一条回复、排序去重、交给人审,再把审过的变成测试用例和知识库文章,下一版上线前用门禁拦住同样的错误,这一圈就是常说的**数据飞轮**。

学完你应该能:

1. 说出显式反馈、隐式反馈、结果反馈各有哪些信号,各自的量、可信度和坑。
2. 设计一张反馈事件表,用 `trace_id` 把信号挂到具体某一次回复上,并保证重复上报不重复计数。
3. 算出「草稿被改写的比例」这种隐式信号,并定一个能区分客套话和真改错的阈值。
4. 写一个每周分诊脚本:健康报表、可疑度打分、去重成组、模型辅助标注疑似原因。
5. 把人审过的 badcase 变成 Day 31 格式的测试用例,知识缺失的起草成帮助中心文章,并同步到 Langfuse。

预计用时 3–4 小时。API 花费不到 1 分钱(只有分诊标注和起草文章两处调模型)。

## 测试集为什么会过期

先把问题想清楚。Day 31 你造测试集的来源有三个:自己写的、合成的、从错误分析里来的。三个来源有一个共同点,都发生在上线以前,都受限于你当时能想到什么。上线以后,至少有三种东西是测试集天然覆盖不到的。

第一种是新出现的东西:新的错误码、新上的功能、刚调整的价格和政策。帮助中心里没有,测试集里也没有,Agent 只能靠猜。第二种是你没想到的问法:客户不会按你的分类说话,「我那个发票的钱怎么不对」到底是发票问题还是计费问题,线上会冒出很多这种两可的说法。第三种是分布变化:月底账单日附近退款工单会暴增,年付续费季会集中出现「怎么又扣了」,测试集里的比例和线上对不上,总分好看不代表线上体验好。

Chip Huyen 在《AI Engineering》第 10 章里把用户反馈称为 AI 应用最重要的数据来源之一,原因就在这里:它是唯一一个来自真实使用、而且会随时间变化的数据源。Airbnb 在 EMNLP 2025 工业论文《Agent-in-the-Loop》里描述了他们客服 LLM 系统的做法,在客服的日常工作流里嵌入四种标注(两个候选回复选哪个更好、是否采用 Agent 的回复及原因、检索到的知识是否相关、缺了什么知识),论文自报重训周期从几个月缩短到几周,试点里检索召回和回复有用性都有提升。我们今天做的是这个思路的小号版本,不训练模型,只补测试集和知识库。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="数据飞轮:上线回复、采集信号、每周分诊、人审、三条出口(测试集、知识库、prompt 或工具修复)、回归门禁,再回到上线">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="30" width="130" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="35" y="52" fill="var(--ink)">① 上线回复</text>
<text x="35" y="70" fill="var(--ink-faint)" font-size="11">每条带 trace_id</text>
<rect x="190" y="30" width="130" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="205" y="52" fill="var(--ink)">② 采集信号</text>
<text x="205" y="70" fill="var(--ink-faint)" font-size="11">点踩/改写/转人工</text>
<rect x="360" y="30" width="130" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="375" y="52" fill="var(--ink)">③ 每周分诊</text>
<text x="375" y="70" fill="var(--ink-faint)" font-size="11">打分、去重成组</text>
<rect x="500" y="110" width="120" height="50" rx="6" fill="none" stroke="var(--ink-soft)"/>
<text x="515" y="132" fill="var(--ink)">④ 人审</text>
<text x="515" y="150" fill="var(--ink-faint)" font-size="11">真错?错在哪?</text>
<rect x="360" y="200" width="130" height="34" rx="6" fill="none" stroke="var(--rule)"/>
<text x="372" y="222" fill="var(--ink)">进测试集</text>
<rect x="360" y="244" width="130" height="34" rx="6" fill="none" stroke="var(--rule)"/>
<text x="372" y="266" fill="var(--ink)">补知识库</text>
<rect x="190" y="222" width="130" height="34" rx="6" fill="none" stroke="var(--rule)"/>
<text x="200" y="244" fill="var(--ink)">改 prompt/工具</text>
<rect x="20" y="150" width="130" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="35" y="172" fill="var(--ink)">⑤ 回归门禁</text>
<text x="35" y="190" fill="var(--ink-faint)" font-size="11">Day 35 的 CI</text>
<line x1="150" y1="55" x2="188" y2="55" stroke="var(--ink-soft)"/>
<line x1="320" y1="55" x2="358" y2="55" stroke="var(--ink-soft)"/>
<line x1="490" y1="65" x2="540" y2="108" stroke="var(--ink-soft)"/>
<line x1="540" y1="160" x2="492" y2="215" stroke="var(--ink-soft)"/>
<line x1="545" y1="160" x2="492" y2="260" stroke="var(--ink-soft)"/>
<line x1="510" y1="160" x2="322" y2="238" stroke="var(--ink-soft)"/>
<line x1="190" y1="238" x2="120" y2="202" stroke="var(--ink-soft)"/>
<line x1="85" y1="150" x2="85" y2="82" stroke="var(--ink-soft)"/>
<text x="20" y="120" fill="var(--ink-faint)" font-size="11">过门禁才上线</text>
</g>
</svg>
<figcaption>一圈大约一周。②③ 全自动,④ 必须是人,⑤ 用的是你在 Day 35 就搭好的门禁。飞轮转起来以后,测试集里来自线上的用例会越来越多。</figcaption>
</figure>

## 能收到哪些信号

SupportPilot 是给客服用的工作台(Day 49),所以反馈有两个来源:用工作台的客服,和收到回复的客户。我把信号分成三类。

**显式反馈**是有人主动表态:客服在草稿旁边点赞点踩,客户在满意度调查里打 1 到 5 分,点踩时顺手勾选一个原因。它的意思最明确,但量很少。大多数人不会去点,点的人又偏向「特别不满意」和「特别满意」的两头。在今天的模拟数据里我设了四分之一的客服会点,真实产品里往往更低,具体比例取决于你把按钮放在哪、点一下要不要多走一步。

**隐式反馈**是从行为里推出来的:客服把草稿改了多少才发出去,工单有没有转人工或者转二线,客户有没有在 24 小时内追问同一件事,客服是不是直接丢掉草稿自己从头写。这类信号每条回复都有,量大,而且不用任何人配合;代价是噪声大,改写多可能是 Agent 错了,也可能只是这个客服习惯加一句「祝您生活愉快」。

**结果反馈**是业务上最终发生了什么:退款申请有没有被主管驳回,客户有没有在一个月内取消订阅,这张工单最后花了多少分钟处理。它最接近你真正关心的东西,但来得慢、归因难,一般用在月度复盘和 A/B 实验(Day 71),不用在每周分诊。

| 信号 | 谁产生 | 量 | 可信度 | 坑 |
| --- | --- | --- | --- | --- |
| 客服点踩 / 点赞 | 客服 | 少 | 高 | 误点;只有情绪特别强时才点 |
| 点踩原因 | 客服 | 更少 | 高 | 选项设计不好会全选「其他」 |
| 客户满意度 | 客户 | 很少 | 中 | 打低分常常是对政策不满,不是 Agent 答错 |
| 草稿改写比例 | 系统推算 | 每条都有 | 中低 | 客套话、换行也算改写,要定阈值 |
| 转人工 / 转二线 | 工单系统 | 中 | 高 | 有些类别本来就规定要转 |
| 客户追问 / 重开 | 工单系统 | 中 | 中 | 追问也可能是新问题 |
| 退款被驳回、取消订阅 | 业务系统 | 少 | 最高 | 慢,难归因到某一条回复 |

按钮怎么设计,有几条我自己踩过的经验。按钮放在客服点「发送」的那个位置旁边,不要藏在三个点的菜单里,否则没人点。别用五星评分,客服不会认真区分三星和四星,点赞点踩加一个可选原因就够了。原因选项从 Day 30 的失败类别里来,「答错了政策」「缺知识」「该查订单没查」「语气不对」,而不是「不准确」「不相关」这种空话,后面分诊时这些选项能直接当标签用。同一个人对同一条回复改主意时要能覆盖,而不是记两次。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1WPnuzPEzD&autoplay=0&high_quality=1" title="为什么AI评估是产品构建者最热门的新技能 | Hamel Husain &amp; Shreya Shankar [附文稿]" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Web3天空之城 · 为什么AI评估是产品构建者最热门的新技能 | Hamel Husain &amp; Shreya Shankar · 106 分钟的访谈搬运,带中文文稿。重点听两人讲「先看线上真实数据、手工记笔记、再归类」那一段,和今天的分诊流程是同一件事。</figcaption>
</figure>

## 一张表存回复,一张表存信号

今天的代码放在 `agent-60-lab/topics/feedback/`,和 Day 143 一样从仓库根目录用 `-m` 运行。先建目录和空的 `__init__.py`(Day 143 建过 `topics/__init__.py` 的话只需要建子目录这个):

```bash
cd agent-60-lab
mkdir -p topics/feedback && touch topics/__init__.py topics/feedback/__init__.py
uv add fastapi langfuse     # 2026-10 实测 fastapi 0.159.1、langfuse 5.0.4;只跑分诊不需要这两个
```

存储用 SQLite,两张表。`replies` 每次 Agent 起草一条回复写一行,主键是 `trace_id`,和 Day 52 里 Langfuse 的 trace 是同一个 id。`events` 每个反馈信号写一行,也挂在 `trace_id` 上。这样设计的好处是信号可以晚到:客户追问可能发生在三天以后,工单系统的 webhook 带着 `trace_id` 过来,插一行就行,不用改回复那一行。

```python
# agent-60-lab/topics/feedback/store.py
"""反馈数据的存储:每次回复一行,每个反馈信号一行。信号挂在 trace_id 上,和 Langfuse 里的 trace 对得上。"""
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
    event_id TEXT PRIMARY KEY,             -- 同一个人对同一条回复的同一种反馈只留一行
    trace_id TEXT NOT NULL REFERENCES replies(trace_id),
    kind     TEXT NOT NULL,                -- thumb / edit_ratio / escalated / reopened / csat
    value    REAL NOT NULL,
    comment  TEXT DEFAULT '',
    source   TEXT DEFAULT '',              -- agent:客服 / customer:客户 / system:系统推断
    ts       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_trace ON events(trace_id);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect(path: Path | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(path or DB)       # 调用时才读 DB,测试里改 store.DB 就能换库
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def add_reply(conn: sqlite3.Connection, **r: str | None) -> None:
    r.setdefault("created_at", now())
    cols = ", ".join(r)
    conn.execute(f"INSERT OR REPLACE INTO replies ({cols}) VALUES ({', '.join('?' * len(r))})", list(r.values()))


def add_event(conn: sqlite3.Connection, trace_id: str, kind: str, value: float,
              comment: str = "", source: str = "system", ts: str | None = None) -> str:
    event_id = f"{trace_id}:{kind}:{source}"
    conn.execute(
        """INSERT INTO events (event_id, trace_id, kind, value, comment, source, ts)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(event_id) DO UPDATE SET value = excluded.value, comment = excluded.comment, ts = excluded.ts""",
        (event_id, trace_id, kind, value, comment, source, ts or now()),
    )
    return event_id
```

<div class="line-notes">

- `DB = Path(__file__).with_name("feedback.db")` 数据库文件和代码放一起,方便练习。生产环境换成 SupportPilot 用的 Postgres,表结构不用改。
- `trace_id       TEXT PRIMARY KEY,` 一次回复一个 trace_id。SupportPilot 里它就是 Day 52 `@observe` 产生的 Langfuse trace id,两边能互相跳转。
- `draft          TEXT NOT NULL,          -- Agent 起草的回复` 草稿和最终发出的版本分开存,这是算改写比例的前提。很多系统只存最终版本,事后就再也算不出 Agent 原本写了什么。
- `prompt_version TEXT,` 记下这条回复是哪个 prompt 版本生成的。之后能按版本看点踩率,Day 143 优化出来的新 prompt 上线后有没有变好,就看这一列。
- `event_id TEXT PRIMARY KEY,             -- 同一个人对同一条回复的同一种反馈只留一行` 幂等的关键。前端网络抖动重发两次、客服先点踩又改成点赞,都只留一行最新的。
- `source   TEXT DEFAULT '',              -- agent:客服 / customer:客户 / system:系统推断` 同一种信号来源不同,可信度不同。客服点踩和客户打低分要分开看。
- `conn = sqlite3.connect(path or DB)       # 调用时才读 DB,测试里改 store.DB 就能换库` 默认参数写成 `None` 再在函数体里取 `DB`,而不是 `path: Path = DB`。后者在定义函数那一刻就把路径定死了,测试里 monkeypatch `store.DB` 不起作用。
- `conn.row_factory = sqlite3.Row` 查询结果可以用 `r["trace_id"]` 按列名取,读代码时不用数第几列。
- `conn.execute(f"INSERT OR REPLACE INTO replies ({cols}) VALUES ({', '.join('?' * len(r))})", list(r.values()))` 列名从关键字参数拼出来,值仍然走 `?` 占位符。列名来自代码而不是用户输入,所以这里拼字符串是安全的;值千万别拼。
- `event_id = f"{trace_id}:{kind}:{source}"` 用「哪条回复、什么信号、谁给的」拼出主键。实测 `tr-0124` 被客服点踩后,事件 id 是 `tr-0124:thumb:agent`。
- `ON CONFLICT(event_id) DO UPDATE SET value = excluded.value, comment = excluded.comment, ts = excluded.ts""",` SQLite 3.24 以后支持的 upsert 写法。`excluded` 指的是这次想插入、但因为主键冲突没插进去的那一行。

</div>

## 收反馈的接口

前端点赞点踩、客服点「发送」、工单系统的 webhook,都打到三个接口上。下面的代码可以直接挂进 Day 49 的 FastAPI 应用,今天先单独跑。

```python
# agent-60-lab/topics/feedback/api.py
"""收反馈的接口。前端点赞点踩、客服点「发送」、工单系统的转人工 webhook 都打到这里。依赖:uv add fastapi uvicorn"""
from __future__ import annotations

from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from topics.feedback.signals import edit_ratio
from topics.feedback.store import add_event, connect

app = FastAPI()


class Thumb(BaseModel):
    trace_id: str
    value: Literal[1, -1]
    comment: str = Field(default="", max_length=500)


class Sent(BaseModel):
    trace_id: str
    text: str = Field(min_length=1)


class TicketEvent(BaseModel):
    trace_id: str
    kind: Literal["escalated", "reopened"]
    comment: str = ""


def must_exist(conn, trace_id: str):
    row = conn.execute("SELECT draft FROM replies WHERE trace_id = ?", (trace_id,)).fetchone()
    if row is None:
        raise HTTPException(404, f"unknown trace_id {trace_id}")
    return row


@app.post("/feedback/thumb")
def thumb(body: Thumb) -> dict:
    with connect() as conn:
        must_exist(conn, body.trace_id)
        eid = add_event(conn, body.trace_id, "thumb", body.value, body.comment, source="agent")
    return {"event_id": eid}


@app.post("/feedback/sent")
def sent(body: Sent) -> dict:
    with connect() as conn:
        draft = must_exist(conn, body.trace_id)["draft"]
        conn.execute("UPDATE replies SET sent = ? WHERE trace_id = ?", (body.text, body.trace_id))
        ratio = edit_ratio(draft, body.text)
        add_event(conn, body.trace_id, "edit_ratio", ratio, source="system")
    return {"edit_ratio": ratio}


@app.post("/feedback/ticket-event")
def ticket_event(body: TicketEvent) -> dict:
    with connect() as conn:
        must_exist(conn, body.trace_id)
        eid = add_event(conn, body.trace_id, body.kind, 1, body.comment, source="ticketing")
    return {"event_id": eid}
```

<div class="line-notes">

- `value: Literal[1, -1]` 只接受 1 和 -1,前端传 0 或者 `"down"` 会直接得到 422。别在后端猜前端的意思。
- `comment: str = Field(default="", max_length=500)` 点踩原因的自由文本。限个长度,免得有人往里贴整段聊天记录,里面全是客户信息。
- `text: str = Field(min_length=1)` 客服最终发出的回复。空字符串不算发送。
- `kind: Literal["escalated", "reopened"]` 工单系统只能报这两种事件,别的类型进不来。新增信号时先改这里,强迫自己想清楚它的含义。
- `raise HTTPException(404, f"unknown trace_id {trace_id}")` 信号挂到不存在的回复上没有意义,直接拒绝。实际系统里最常见的原因是前端拿错了 id,404 比静默吞掉更容易发现。
- `with connect() as conn:` sqlite3 的连接当上下文管理器用时,退出会自动 commit(出异常则 rollback),但不会关闭连接。练习里够用,生产换成连接池。
- `eid = add_event(conn, body.trace_id, "thumb", body.value, body.comment, source="agent")` 客服点的,source 记成 agent。
- `ratio = edit_ratio(draft, body.text)` 客服点「发送」的那一刻,就能算出这条草稿被改了多少,不用等夜里批处理。
- `eid = add_event(conn, body.trace_id, body.kind, 1, body.comment, source="ticketing")` 转人工、追问这类布尔事件,值统一写 1。

</div>

配一个测试,验证幂等和 404:

```python
# agent-60-lab/topics/feedback/test_api.py
from fastapi.testclient import TestClient

from topics.feedback import store
from topics.feedback.api import app


def test_feedback_flow(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB", tmp_path / "fb.db")
    with store.connect() as conn:
        store.add_reply(conn, trace_id="tr-x", ticket_id="TK-1", ticket="E4031 怎么办", draft="请清除浏览器缓存后重试。")
    c = TestClient(app)
    assert c.post("/feedback/thumb", json={"trace_id": "tr-x", "value": -1}).status_code == 200
    assert c.post("/feedback/thumb", json={"trace_id": "tr-x", "value": 1}).status_code == 200   # 改主意
    resp = c.post("/feedback/sent", json={"trace_id": "tr-x", "text": "E4031 表示验证码已过期,请点「重新发送」。"})
    assert resp.json()["edit_ratio"] > 0.5
    assert c.post("/feedback/thumb", json={"trace_id": "nope", "value": 1}).status_code == 404
    with store.connect() as conn:
        rows = conn.execute("SELECT kind, value FROM events ORDER BY kind").fetchall()
    assert [(r["kind"], r["value"]) for r in rows] == [("edit_ratio", resp.json()["edit_ratio"]), ("thumb", 1.0)]
```

<div class="line-notes">

- `monkeypatch.setattr(store, "DB", tmp_path / "fb.db")` 每个测试一个临时库,不污染 `feedback.db`。前面 `connect()` 在调用时才读 `DB`,这一行才管用。
- `assert c.post("/feedback/thumb", json={"trace_id": "tr-x", "value": 1}).status_code == 200   # 改主意` 先点踩再点赞,同一个 `event_id`,最后表里只有一行 thumb,值是 1。
- `assert resp.json()["edit_ratio"] > 0.5` 实测这一对草稿和发出版本的改写比例是 0.833。
- `assert [(r["kind"], r["value"]) for r in rows] == [("edit_ratio", resp.json()["edit_ratio"]), ("thumb", 1.0)]` 一共两行事件,点了两次的 thumb 只剩一行。

</div>

`uv run python -m pytest -q topics/feedback/test_api.py` 实测 `1 passed`。

## 改写比例:最有用也最吵的信号

客服把草稿改了多少,是今天唯一一个每条回复都有的信号,也是最值得花心思的。

```python
# agent-60-lab/topics/feedback/signals.py
"""隐式信号:不用客户点按钮,从行为里推出来的反馈。"""
from __future__ import annotations

import sqlite3
from difflib import SequenceMatcher

from topics.feedback.store import add_event


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

- `from difflib import SequenceMatcher` 标准库就有的序列比较。它按字符比较,对中文也能用,不用分词。
- `return round(1 - SequenceMatcher(None, draft, sent).ratio(), 3)` `ratio()` 是相似度,1 表示完全一样。用 1 减掉就是「改了多少」。实测四组值见下面的表。
- `rows = conn.execute("SELECT trace_id, draft, sent FROM replies WHERE sent IS NOT NULL").fetchall()` 只算真正发出去的。草稿被丢弃、客服从头写的情况,要在前端单独记一个「丢弃草稿」事件,这里算不出来。
- `add_event(conn, r["trace_id"], "edit_ratio", edit_ratio(r["draft"], r["sent"]), source="system")` 批量补算时也走 `add_event`,同一条回复重复跑只会覆盖,不会多出一行。

</div>

阈值怎么定?我拿模拟数据里的几种情况实测了一下:

| 情况 | 改写比例 |
| --- | --- |
| 原样发出 | 0.000 |
| 正常草稿后面加一句「如还有问题随时联系我们。」 | 0.12–0.33(草稿越短,同一句客套话占比越大) |
| 专票资料只答了两项,客服补成四项 | 0.522 |
| 「年付不支持退款」被改成按剩余整月退 273 元 | 0.810 |
| 「请清除浏览器缓存」被改成 E4031 的正确处理方法 | 0.872 |

客套话最高能到 0.33,真改错的最低 0.52,所以我取 0.5 当「重度改写」的门槛。这个数不是通用的,你的客服习惯不同、草稿长度不同,分布就不同。上线第一周先别定阈值,把所有改写比例的分布画出来,抽 30 条不同区间的人工看一遍,再决定从哪里切。

还有两个常见误判要知道。一是**改写少不等于答得好**:如果客服很忙,看都不看就点发送,改写比例全是 0,点踩也没有,这时候这个信号反而会让你以为一切正常。所以除了看信号,每周还要随机抽一批完全没有负面信号的回复人工过一遍。二是**改写多不一定是 Agent 错**:政策刚调整、客服还在用旧口径改 Agent 的正确答案,也会表现为大量重度改写。人审这一步就是为了分清这两种情况。

## 造一周的线上数据

练习环境里没有真实客服,先造一周的数据。200 条回复,大部分是正常的,埋了三类真实会出现的毛病:一个政策理解错(年付退款),一个知识缺失(专票资料,帮助中心 kb-006 本来就只写了抬头和税号),一个新错误码(E4031,帮助中心里还没有这篇)。

```python
# agent-60-lab/topics/feedback/simulate.py
"""造一周的线上数据:200 条回复,其中埋了三类真实会出现的毛病。用法:uv run python -m topics.feedback.simulate"""
from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone

from topics.feedback.signals import derive_edit_events
from topics.feedback.store import DB, add_event, add_reply, connect

# (场景名, 类别, 工单, Agent 草稿, 客服实际发出的版本, 出问题的概率)
SCENARIOS = [
    ("ok_invoice_title", "invoice", "发票抬头写错了,能重开吗?",
     "可以重开。请在「发票管理」里点作废,再按新抬头重新申请,一般 1 个工作日内开出。",
     "可以重开。请在「发票管理」里点作废,再按新抬头重新申请,一般 1 个工作日内开出。", 0.05),
    ("ok_export_bug", "bug", "导出 Excel 一直转圈。",
     "抱歉给您添麻烦了。导出超过 5 万行时会超时,建议按月份分批导出,我们已经记录这个问题。",
     "抱歉给您添麻烦了。导出超过 5 万行时会超时,建议按月份分批导出,我们已经记录这个问题。", 0.08),
    ("ok_price", "billing", "企业版一年多少钱?",
     "企业版年付 1908 元/年,月付 199 元/月,年付相当于打八折。",
     "企业版年付 1908 元/年,月付 199 元/月,年付相当于打八折。", 0.05),
    # 毛病一:把「专业版年付可以按剩余整月退」答成了「年付不退」
    ("bad_annual_refund", "refund", "专业版年付用了 4 个多月,剩下的能退吗?",
     "很抱歉,年付套餐不支持中途退款,取消后可以使用到本期结束。",
     "可以退。专业版年付中途取消按剩余整月退款,已用的 4 个月和当月不退,还剩 7 个月,按每月 39 元退 273 元,主管审批后原路退回。", 0.85),
    # 毛病二:专票资料答漏了一半,客户还得再问(帮助中心 kb-006 本来就只写了抬头和税号)
    ("bad_vat_docs", "invoice", "开增值税专用发票要什么资料?",
     "请提供公司名称和税号即可。",
     "请提供公司名称、税号、注册地址和电话、开户行及账号,四项缺一不可。", 0.6),
    # 毛病三:E4031 是验证码过期(帮助中心里还没有这个错误码),Agent 却让客户清缓存
    ("bad_e4031", "account", "登录提示 E4031,怎么办?",
     "请清除浏览器缓存后重试。",
     "E4031 表示验证码已过期,请点「重新发送」,并在 5 分钟内输入。", 0.7),
]
WEIGHTS = [40, 30, 30, 12, 8, 10]          # 场景出现的相对频率,正常的多,出问题的少


def main() -> None:
    rnd = random.Random(7)
    DB.unlink(missing_ok=True)
    conn = connect()
    start = datetime(2026, 10, 12, tzinfo=timezone.utc)
    for i in range(200):
        name, cat, ticket, draft, fixed, p_bad = rnd.choices(SCENARIOS, weights=WEIGHTS)[0]
        bad = rnd.random() < p_bad
        tid = f"tr-{i:04d}"
        ts = (start + timedelta(minutes=50 * i)).isoformat(timespec="seconds")
        sent = fixed if bad else draft
        if not bad and rnd.random() < 0.3:
            sent = draft + "如还有问题随时联系我们。"          # 正常情况下客服也会顺手加一句客套
        add_reply(conn, trace_id=tid, ticket_id=f"TK-{1000 + i}", customer_id=f"C{rnd.randint(1, 30):03d}",
                  category=cat, ticket=ticket, draft=draft, sent=sent, prompt_version="v3", created_at=ts)
        if rnd.random() < 0.25:                              # 只有四分之一的客服会点赞点踩
            add_event(conn, tid, "thumb", -1 if bad else 1, source="agent", ts=ts)
        if bad and name == "bad_e4031" and rnd.random() < 0.6:
            add_event(conn, tid, "escalated", 1, comment="转二线", ts=ts)
        if bad and name == "bad_vat_docs" and rnd.random() < 0.7:
            add_event(conn, tid, "reopened", 1, comment="客户 24 小时内追问", ts=ts)
        if rnd.random() < 0.1:                               # 一成客户会填满意度
            add_event(conn, tid, "csat", rnd.choice([1, 2]) if bad else rnd.choice([4, 5]), source="customer", ts=ts)
    n = derive_edit_events(conn)
    conn.commit()
    total = conn.execute("SELECT kind, COUNT(*) AS n FROM events GROUP BY kind ORDER BY n DESC").fetchall()
    print(f"写入 {n} 条回复;事件:", {r["kind"]: r["n"] for r in total})


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `SCENARIOS = [` 六个场景,前三个正常,后三个各埋一种毛病。价格、退款政策和帮助中心 kb-001、kb-002 一致:企业版年付 1908 元,专业版年付 468 元折合每月 39 元。
- `"可以重开。请在「发票管理」里点作废,再按新抬头重新申请,一般 1 个工作日内开出。", 0.05),` 正常场景也有 5% 的概率「出问题」。但它的草稿和修正版是同一段话,所以这 5% 会表现成「客服点了踩但一个字没改」,用来模拟误点。
- `"可以退。专业版年付中途取消按剩余整月退款,已用的 4 个月和当月不退,还剩 7 个月,按每月 39 元退 273 元,主管审批后原路退回。", 0.85),` 按 kb-002 的规则算:12 个月减去已用 4 个月再减当月,剩 7 个月,7 × 39 = 273 元。
- `WEIGHTS = [40, 30, 30, 12, 8, 10]` 六个场景的抽样权重,和 `SCENARIOS` 一一对应。正常的占 100/130,约四分之三。
- `rnd = random.Random(7)` 固定种子,每次生成的数据完全一样,你跑出来的数字应该和文中一致。
- `DB.unlink(missing_ok=True)` 每次重新造数前删掉旧库。`missing_ok` 是 Python 3.8 加的,文件不存在也不报错。
- `name, cat, ticket, draft, fixed, p_bad = rnd.choices(SCENARIOS, weights=WEIGHTS)[0]` `choices` 返回列表,取第一个,再解包成六个变量。
- `sent = fixed if bad else draft` 出了问题,客服就发修正版;没问题就原样发。
- `sent = draft + "如还有问题随时联系我们。"          # 正常情况下客服也会顺手加一句客套` 正常回复里有三成会加客套话,用来制造改写比例的噪声。
- `if rnd.random() < 0.25:                              # 只有四分之一的客服会点赞点踩` 显式反馈稀疏。实测 200 条回复里 57 条有点赞点踩。
- `n = derive_edit_events(conn)` 最后统一算一遍改写比例。线上是在 `/feedback/sent` 接口里实时算的,这里是补算。
- `print(f"写入 {n} 条回复;事件:", {r["kind"]: r["n"] for r in total})` 实测输出 `写入 200 条回复;事件: {'edit_ratio': 200, 'thumb': 57, 'csat': 20, 'escalated': 8, 'reopened': 6}`。

</div>

运行 `uv run python -m topics.feedback.simulate`,输出就是最后一条注释里那一行。

## 每周分诊:报表、打分、去重

分诊脚本做三件事。先出一张按类别的健康报表,看哪里在变坏;再给每条回复算一个可疑度分数;最后把可疑的回复按「同一类别、同一份草稿」去重成组,排好序写进队列,交给人审。

```python
# agent-60-lab/topics/feedback/triage.py
"""每周分诊:先出健康报表,再把可疑回复去重成组,排出 badcase 队列给人看。用法:uv run python -m topics.feedback.triage [--llm]"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from topics.feedback.store import connect

OUT = Path(__file__).with_name("triage_queue.jsonl")

REPORT_SQL = """
SELECT r.category,
       COUNT(DISTINCT r.trace_id)                                             AS n,
       AVG(CASE WHEN e.kind = 'edit_ratio' THEN e.value END)                  AS avg_edit,
       AVG(CASE WHEN e.kind = 'edit_ratio' THEN e.value >= 0.5 END)           AS heavy_edit,
       SUM(e.kind = 'thumb' AND e.value = -1)                                 AS downs,
       SUM(e.kind = 'thumb')                                                  AS thumbs,
       SUM(e.kind IN ('escalated', 'reopened'))                               AS esc_reopen
FROM replies r JOIN events e ON e.trace_id = r.trace_id
GROUP BY r.category ORDER BY heavy_edit DESC
"""


def suspicion(sig: dict[str, float]) -> tuple[float, list[str]]:
    """每种信号算几分。显式差评和转人工最可信,改写比例最常见但噪声最大。"""
    score, why = 0.0, []
    if sig.get("thumb") == -1:
        score += 3; why.append("客服点踩")
    if sig.get("escalated"):
        score += 3; why.append("转人工")
    if sig.get("reopened"):
        score += 2; why.append("客户追问")
    if sig.get("csat", 5) <= 2:
        score += 2; why.append(f"满意度 {sig['csat']:.0f}")
    if sig.get("edit_ratio", 0) >= 0.5:
        score += 1 + sig["edit_ratio"]; why.append(f"改写 {sig['edit_ratio']:.0%}")
    return score, why


TAXONOMY = ["政策理解错", "知识缺失或检索没找到", "事实或数字错误", "该调工具没调", "语气或格式", "其他"]
LABEL_PROMPT = """下面是客服 Agent 的草稿和客服最终发出的版本。判断草稿错在哪,只从这些类别里选一个:{taxonomy}
只输出 JSON:{{"label": "...", "note": "一句话说明"}}

工单:{ticket}
草稿:{draft}
最终发出:{sent}"""


def main() -> None:
    conn = connect()
    print(f"{'类别':<9}{'条数':>4}{'平均改写':>8}{'重度改写':>8}{'点踩/打分':>9}{'转人工+追问':>9}")
    for r in conn.execute(REPORT_SQL):
        print(f"{r['category']:<10}{r['n']:>5}{r['avg_edit']:>10.0%}{r['heavy_edit']:>10.0%}"
              f"{r['downs']:>7}/{r['thumbs']:<5}{r['esc_reopen']:>8}")

    signals: dict[str, dict[str, float]] = {}
    for e in conn.execute("SELECT trace_id, kind, value FROM events"):
        signals.setdefault(e["trace_id"], {})[e["kind"]] = e["value"]

    groups: dict[tuple[str, str], dict] = {}          # 同一类别、同一份草稿的可疑回复归成一组
    for tid, sig in signals.items():
        score, why = suspicion(sig)
        if score < 2:
            continue
        r = conn.execute("SELECT * FROM replies WHERE trace_id = ?", (tid,)).fetchone()
        g = groups.setdefault((r["category"], r["draft"]), {
            "category": r["category"], "ticket": r["ticket"], "draft": r["draft"], "sent": r["sent"],
            "customer_id": r["customer_id"], "traces": [], "score": 0.0, "why": set()})
        g["traces"].append(tid)
        g["score"] += score
        g["why"].update(why_.split(" ")[0] for why_ in why)
    queue = sorted(groups.values(), key=lambda g: -g["score"])
    print(f"\n可疑回复 {sum(len(g['traces']) for g in queue)} 条,去重后 {len(queue)} 组")

    client = None
    if "--llm" in sys.argv:
        from common.llm import LLMClient
        client = LLMClient()
    with OUT.open("w", encoding="utf-8") as f:
        for g in queue:
            item = {**g, "why": sorted(g["why"]), "score": round(g["score"], 1), "count": len(g["traces"]),
                    "suspect": None, "accept": None, "expect": {}}
            if client:
                out = client.chat([{"role": "user", "content": LABEL_PROMPT.format(taxonomy="、".join(TAXONOMY), **g)}],
                                  temperature=0, response_format={"type": "json_object"})
                item["suspect"] = json.loads(out.content)
            f.write(json.dumps(item, ensure_ascii=False) + "\n")
            label = (item["suspect"] or {}).get("label", "未标注")
            print(f"  [{item['count']:>2} 条 · {item['score']:>5}] {g['category']:<8}{label:<12}{g['ticket']}")
    if client:
        print(client.ledger)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `COUNT(DISTINCT r.trace_id)                                             AS n,` 一条回复会 JOIN 出好几行事件,不加 DISTINCT 数的是事件数。我第一版就写成了 `COUNT(*)`,invoice 显示 108 条,实际只有 78 条。
- `AVG(CASE WHEN e.kind = 'edit_ratio' THEN e.value >= 0.5 END)           AS heavy_edit,` SQLite 里比较表达式的值是 0 或 1,对它求平均就是比例。CASE 没命中时是 NULL,AVG 会跳过 NULL,所以分母只算 edit_ratio 那些行。
- `SUM(e.kind = 'thumb' AND e.value = -1)                                 AS downs,` 同样利用比较结果是 0/1,SUM 就是计数。Postgres 里要写成 `COUNT(*) FILTER (WHERE ...)`。
- `def suspicion(sig: dict[str, float]) -> tuple[float, list[str]]:` 可疑度打分。分数本身没有意义,只用来排序;权重按「可信度」给,不是按「严重程度」。
- `score += 3; why.append("客服点踩")` 显式差评给 3 分。一行写两个语句用分号,在 Python 里不常见,这里是为了让五条规则对齐、一眼看完。
- `if sig.get("csat", 5) <= 2:` 没有满意度数据时默认 5 分,不加分。
- `score += 1 + sig["edit_ratio"]; why.append(f"改写 {sig['edit_ratio']:.0%}")` 重度改写给 1 到 2 分,改得越多分越高。它单独出现时(1.5 分左右)不够 2 分的门槛,必须配合别的信号才进队列,这是有意的:单凭改写比例误报太多。
- `TAXONOMY = ["政策理解错", "知识缺失或检索没找到", "事实或数字错误", "该调工具没调", "语气或格式", "其他"]` 失败类别。Day 30 你从 trace 里归纳过一份,用你自己的那份替换这里。
- `signals.setdefault(e["trace_id"], {})[e["kind"]] = e["value"]` 把事件表压成「每条回复一个字典」,比如 `{'thumb': -1.0, 'escalated': 1.0, 'edit_ratio': 0.872}`。
- `groups: dict[tuple[str, str], dict] = {}          # 同一类别、同一份草稿的可疑回复归成一组` 去重的 key。模拟数据里同一个场景的草稿一字不差,所以精确匹配就够了。真实数据里草稿每次措辞不同,要换成 embedding 聚类(Day 15)或者按「工单类别 + 检索到的文章」分组。
- `g["why"].update(why_.split(" ")[0] for why_ in why)` 原因去掉后面的数字(「改写 87%」→「改写」),一组里的原因合并成集合。
- `queue = sorted(groups.values(), key=lambda g: -g["score"])` 按组内总分排序。总分 = 条数 × 单条可疑度,影响面大、信号强的排前面。
- `"suspect": None, "accept": None, "expect": {}}` 后三个字段留给人审时填。`suspect` 是模型的猜测,`accept` 和 `expect` 只能由人写。
- `out = client.chat([{"role": "user", "content": LABEL_PROMPT.format(taxonomy="、".join(TAXONOMY), **g)}],` 每组只调一次模型猜原因,不是每条回复一次。实测 5 组 5 次调用,¥0.003。

</div>

运行 `uv run python -m topics.feedback.triage --llm`,实测输出:

```text
类别         条数    平均改写    重度改写    点踩/打分   转人工+追问
account      15       78%       87%      5/5           8
refund       20       67%       80%      8/10          0
invoice      78        7%        8%      3/16          6
bug          48        3%        0%      0/14          0
billing      39        7%        0%      1/12          0

可疑回复 26 条,去重后 5 组
  [10 条 ·  59.7] account 知识缺失或检索没找到  登录提示 E4031,怎么办?
  [ 8 条 ·  40.5] refund  政策理解错       专业版年付用了 4 个多月,剩下的能退吗?
  [ 6 条 ·  29.1] invoice 知识缺失或检索没找到  开增值税专用发票要什么资料?
  [ 1 条 ·   3.0] invoice 其他          发票抬头写错了,能重开吗?
  [ 1 条 ·   3.0] billing 其他          企业版一年多少钱?
5 次调用 | 输入 836 / 输出 165 tokens | 约 ¥0.0030
```

先看报表。account 和 refund 两类的重度改写率在 80% 以上,这是一眼就能看出来的警报;invoice 的平均改写只有 7%,因为专票问题只占 invoice 工单的一小部分,被大量正常的发票抬头问题稀释了,但「转人工+追问」那一列有 6 次,全部来自专票。这说明**光看平均数会漏掉小类别里的问题**,报表至少要按类别切,最好再按「工单 + 草稿」这种更细的粒度看。

再看队列。26 条可疑回复去重后只有 5 组,人审的工作量一下子从 26 条变成 5 条。前三组正是我们埋的三个毛病,模型猜的原因也对。后两组各只有 1 条,原因都只有「客服点踩」,模型说「其他」。打开看会发现草稿和发出的版本一模一样,这就是模拟里的误点。真实系统里这种单条、只有一个显式信号、而且客服什么都没改的组,大概率是误点或者客服对政策本身不满,审的时候可以快速跳过。

## 人审:这一步不能省

分诊队列是 JSONL,一组一行。审的人(一般是你加上一位资深客服)逐行看,决定三件事:这真的是 Agent 的错吗?错在哪?正确的处理应该满足什么?审完把 `accept` 改成 `true` 或 `false`,在 `expect` 里写期望,另存成 `reviewed.jsonl`。第一组审完长这样(为了好读做了换行):

```json
{"category": "account", "ticket": "登录提示 E4031,怎么办?",
 "draft": "请清除浏览器缓存后重试。",
 "sent": "E4031 表示验证码已过期,请点「重新发送」,并在 5 分钟内输入。",
 "customer_id": "C008",
 "traces": ["tr-0033", "tr-0041", "tr-0051", "tr-0089", "tr-0092", "tr-0108", "tr-0124", "tr-0132", "tr-0145", "tr-0154"],
 "score": 59.7, "why": ["客服点踩", "改写", "满意度", "转人工"], "count": 10,
 "suspect": {"label": "知识缺失或检索没找到", "note": "草稿未识别 E4031 是验证码过期，给出了无关的清除缓存建议，属于缺少该错误码知识。"},
 "accept": true,
 "expect": {"must_not_call": ["create_refund_request"], "reply_must_include": ["重新发送"],
            "reply_must_not_include": ["清除浏览器缓存"],
            "facts": ["E4031 表示验证码已过期", "重新发送验证码并在 5 分钟内输入"]},
 "review_note": "帮助中心没有 E4031 这篇"}
```

`expect` 的字段和 Day 31 的 `Expect` 一模一样,所以审完的东西可以直接变成测试用例。这里有几个判断只有人能做。E4031 到底是什么意思,要问产品或者研发,不能信客服的一次改写,更不能信模型的猜测。退款那一组,期望里要写清楚应不应该发起退款申请、退哪张发票、退多少钱,这些都依赖测试库里的具体客户数据。最后两组误点,`accept` 填 `false`,备注写原因,下周同样的情况就能更快跳过。

审的节奏我建议每周固定一次,半小时到一小时,队列太长就只审前 20 组。比起一次审完,固定节奏更重要:飞轮的价值在于每周都转一圈,而不是某次转得特别彻底。

## 审过的变成测试用例

```python
# agent-60-lab/topics/feedback/promote.py
"""把人审过的 badcase 变成 Day 31 格式的测试用例。用法:uv run python -m topics.feedback.promote topics/feedback/reviewed.jsonl"""
from __future__ import annotations

import hashlib
import json
import sys
from datetime import date
from pathlib import Path

GOLDEN = Path("w5/cases/golden.jsonl")                          # Day 31 的测试集,没有就跳过查重
OUT = Path(__file__).with_name("golden_from_feedback.jsonl")


def grams(s: str, n: int = 3) -> set[str]:
    s = "".join(s.split())
    return {s[i:i + n] for i in range(max(len(s) - n + 1, 1))}


def jaccard(a: set[str], b: set[str]) -> float:
    return len(a & b) / len(a | b) if a | b else 0.0


def split_of(case_id: str) -> str:                                # 和 Day 31 validate.py 同一个规则
    h = int(hashlib.md5(case_id.encode()).hexdigest(), 16) % 100
    return "test" if h < 30 else "dev"


def main() -> None:
    reviewed = [json.loads(l) for l in Path(sys.argv[1]).read_text(encoding="utf-8").splitlines() if l.strip()]
    existing = [json.loads(l)["ticket"] for l in GOLDEN.read_text(encoding="utf-8").splitlines() if l.strip()] \
        if GOLDEN.exists() else []
    seen = [grams(t) for t in existing]
    cases, skipped = [], []
    for item in reviewed:
        if item.get("accept") is not True:
            skipped.append((item["traces"][0], "未通过人审"))
            continue
        if item["category"] == "refund" and "refund" not in item["expect"]:
            skipped.append((item["traces"][0], "退款类要先在测试库里挑一个同样情况的客户,填 customer_id 和 refund"))
            continue
        g = grams(item["ticket"])
        if any(jaccard(g, s) > 0.8 for s in seen):
            skipped.append((item["traces"][0], "测试集里已有几乎一样的工单"))
            continue
        cid = f"prod-{item['traces'][0]}"
        cases.append({
            "id": cid,
            "ticket": item["ticket"],
            "customer_id": item["expect"].pop("customer_id", None),  # 线上客户不在测试库里,由审核人指定
            "expect": {"category": item["category"], **item["expect"]},
            "tags": [item["category"], "from-feedback", *(item.get("suspect") or {}).get("label", "").split()],
            "source": "production",
            "split": split_of(cid),
            "added": date.today().isoformat(),
            "note": f"{item['count']} 条线上回复同样出错:{'、'.join(item['why'])};trace {', '.join(item['traces'][:3])}",
        })
        seen.append(g)
    with OUT.open("a", encoding="utf-8") as f:
        for c in cases:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    print(f"新增 {len(cases)} 条用例 → {OUT.name}")
    for c in cases:
        print(f"  {c['id']:<14}{c['split']:<6}{c['expect']}")
    for tid, reason in skipped:
        print(f"  跳过 {tid}:{reason}")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `GOLDEN = Path("w5/cases/golden.jsonl")                          # Day 31 的测试集,没有就跳过查重` 相对路径,所以要在仓库根目录运行。你如果跳过了 W5,这个文件不存在,查重就跳过。
- `OUT = Path(__file__).with_name("golden_from_feedback.jsonl")` 先写到单独的文件,不直接改 golden.jsonl。合进测试集之前再用 Day 31 的 `validate.py` 跑一遍校验。
- `def grams(s: str, n: int = 3) -> set[str]:` 和 Day 31 `validate.py` 里一样的三字组切法,用来判断两条工单是不是几乎一样。
- `def split_of(case_id: str) -> str:                                # 和 Day 31 validate.py 同一个规则` 按 id 的哈希分 dev/test,三成进 test。规则必须和 Day 31 一致,否则同一条用例换个脚本分到的 split 就不一样了。实测今天两条都落在 dev。
- `if item.get("accept") is not True:` 只认明确写了 `true` 的。`None`(还没审)和 `false`(审了不要)都跳过。
- `if item["category"] == "refund" and "refund" not in item["expect"]:` 一道护栏。Day 31 的约定是 `refund` 字段为空表示「不应该产生退款申请」,如果审的人忘了填,这条用例会反过来惩罚正确的退款行为。宁可跳过让人补,也不要写进一条错的期望。
- `if any(jaccard(g, s) > 0.8 for s in seen):` 和已有用例、以及这一批里前面刚加的用例比较,太像就不加。同一个问题在测试集里出现十次,只会让分数对它过度敏感。
- `cid = f"prod-{item['traces'][0]}"` id 带上 `prod-` 前缀和第一个 trace id,之后在报告里看到这条用例挂了,能直接回到 Langfuse 找原始那次回复。
- `"customer_id": item["expect"].pop("customer_id", None),  # 线上客户不在测试库里,由审核人指定` 线上的 C008 在测试库里不存在,或者存在但数据对不上。需要客户数据的用例,由审的人在 expect 里指定一个测试库里的客户。`pop` 顺便把它从 expect 里拿掉,因为 Day 31 的 `Expect` 没有这个字段。
- `"source": "production",` Day 31 的 `source` 字段预留了 `production` 这个值,就是给今天用的。之后可以单独看「来自线上的用例现在过了几条」。
- `"note": f"{item['count']} 条线上回复同样出错:{'、'.join(item['why'])};trace {', '.join(item['traces'][:3])}",` 备注里写清影响面和证据。实测第一条是 `10 条线上回复同样出错:客服点踩、改写、满意度、转人工;trace tr-0033, tr-0041, tr-0051`。
- `with OUT.open("a", encoding="utf-8") as f:` 追加模式。每周跑一次,文件越来越长,这就是飞轮转的痕迹。

</div>

运行 `uv run python -m topics.feedback.promote topics/feedback/reviewed.jsonl`,实测输出:

```text
新增 2 条用例 → golden_from_feedback.jsonl
  prod-tr-0033  dev   {'category': 'account', 'must_not_call': ['create_refund_request'], 'reply_must_include': ['重新发送'], 'reply_must_not_include': ['清除浏览器缓存'], 'facts': ['E4031 表示验证码已过期', '重新发送验证码并在 5 分钟内输入']}
  prod-tr-0001  dev   {'category': 'invoice', 'must_not_call': ['create_refund_request'], 'facts': ['专票需要公司名称、税号、注册地址和电话、开户行及账号四项']}
  跳过 tr-0035:退款类要先在测试库里挑一个同样情况的客户,填 customer_id 和 refund
  跳过 tr-0059:未通过人审
  跳过 tr-0065:未通过人审
```

退款那一组被护栏拦下来了。补法是去 Day 23 的 cloudledger 测试库里找一个专业版年付、已经用了几个月的客户,按 kb-002 的规则算出应退金额,在 `expect` 里加上 `"customer_id"` 和 `"refund": {"invoice_id": ..., "amount_yuan": ...}`,再跑一次 promote。如果测试库里没有这种客户,就在造数脚本里加一个。这一步很烦,但它正好逼你把「线上出现过的情况」也补进测试数据,测试库和线上的差距会一点点缩小。

**线上数据进测试集之前要脱敏。** 工单原文里可能有客户的姓名、手机号、公司名、订单号,而测试集会进 git、会被 CI 打印、会被很多人看到。最少要做的是把手机号、邮箱、身份证号这类模式替换掉(Day 40 写过脱敏函数),公司名换成虚构的。今天模拟的工单里没有这类信息,真实数据一定会有。

## 飞轮的另一半:修根因

补测试集只是让同样的错误下次被门禁拦住,错误本身还得修。三组 badcase 对应三种修法。

E4031 和专票资料都是知识缺失,修法是补帮助中心文章。审的人已经确认了正确答案(就是客服改好的那个版本),让模型照着它起草一篇文章,再由人批准入库,比从头写快得多:

```python
# agent-60-lab/topics/feedback/kb_draft.py
"""飞轮的另一半:知识缺失类的 badcase,用客服改好的回复起草帮助中心文章,等人批准后再入库。"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from common.llm import LLMClient

DRAFTS = Path(__file__).with_name("kb_drafts")
PROMPT = """你是 CloudLedger 帮助中心的编辑。客服在下面这个问题上反复手工改写了 Agent 的回复,说明知识库缺一篇文章。
根据客服最终发出的版本写一篇帮助中心短文:标题一行,正文 3–6 句,只写客服版本里有的事实,不要补充你不确定的内容。
输出 JSON:{{"title": "...", "body": "...", "keywords": ["..."]}}

客户问题:{ticket}
客服最终发出的回复:{sent}"""


def main() -> None:
    client = LLMClient()
    DRAFTS.mkdir(exist_ok=True)
    for line in Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
        item = json.loads(line)
        if item.get("accept") is not True or (item.get("suspect") or {}).get("label") != "知识缺失或检索没找到":
            continue
        r = client.chat([{"role": "user", "content": PROMPT.format(**item)}], temperature=0,
                        response_format={"type": "json_object"})
        art = json.loads(r.content)
        path = DRAFTS / f"draft-{item['traces'][0]}.md"
        path.write_text(f"---\nstatus: draft\nsource_traces: {item['traces'][:5]}\nkeywords: {art['keywords']}\n---\n\n"
                        f"# {art['title']}\n\n{art['body']}\n", encoding="utf-8")
        print(f"{path.name}:{art['title']}")
    print(client.ledger)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `只写客服版本里有的事实,不要补充你不确定的内容。` 这句话是防止模型「顺便」补充它自己知道的专票规定。帮助中心是 RAG 的数据源,一旦写进错误信息,错误会被 Agent 引用无数次。
- `if item.get("accept") is not True or (item.get("suspect") or {}).get("label") != "知识缺失或检索没找到":` 只处理人审通过、而且疑似原因是知识缺失的组。政策理解错的那组不该补文章,帮助中心里本来就有 kb-002。`suspect` 可能是 `None`(没开 `--llm`),`(item.get("suspect") or {})` 兜底成空字典,后面的 `.get` 才不会报错。
- `path.write_text(f"---\nstatus: draft\nsource_traces: {item['traces'][:5]}\nkeywords: {art['keywords']}\n---\n\n"` 文件头和 Day 16 帮助中心文章的格式一样,只是多了 `status: draft` 和来源 trace。批准入库时改成正式的 `id` 和 `category`,再跑一次 Day 17 的 `pg_sync.py` 重建索引。
- `print(f"{path.name}:{art['title']}")` 实测输出两行:`draft-tr-0033.md:登录提示 E4031 验证码已过期怎么办` 和 `draft-tr-0001.md:开具增值税专用发票所需资料`。

</div>

实测起草出来的 E4031 文章正文是「E4031 表示验证码已过期。请点击「重新发送」获取新的验证码。请在 5 分钟内输入验证码。」,没有多编任何东西。两篇一共 2 次调用,约 ¥0.002。

退款那组是政策理解错,帮助中心 kb-002 写得清清楚楚,是 Agent 没读对,或者检索时没把 kb-002 排在前面。这种要回到 Day 18 和 Day 51 的方法查:先看这几条 trace 里检索到了什么文章,如果检索没问题,就是 prompt 或者模型的问题,可以用 Day 143 的优化方法,也可以手改。不管怎么修,修完都要跑 Day 35 的门禁,而门禁里现在多了两条来自线上的用例,它们挂了就不许上线。

## 同步到 Langfuse

如果你按 Day 52 接了 Langfuse,反馈信号最好也进去,这样在 trace 页面上就能看到这次回复挨了几次踩、被改了多少,在 Langfuse 里也能按 score 过滤 trace。

```python
# agent-60-lab/topics/feedback/langfuse_sync.py
"""把本地的反馈事件同步成 Langfuse 的 score,在 trace 页面上就能看到每条回复挨了几次踩、被改了多少。依赖:uv add langfuse"""
from __future__ import annotations

from langfuse import get_client

from topics.feedback.store import connect

DATA_TYPE = {"thumb": "NUMERIC", "edit_ratio": "NUMERIC", "csat": "NUMERIC", "escalated": "BOOLEAN", "reopened": "BOOLEAN"}


def main() -> None:
    lf = get_client()                      # 没配 LANGFUSE_* 环境变量时客户端是禁用状态,调用不报错也不上报
    conn = connect()
    n = 0
    for e in conn.execute("SELECT * FROM events"):
        lf.create_score(
            trace_id=e["trace_id"],        # 必须是 Langfuse 里真实存在的 trace id,Day 52 里 SupportPilot 每次回复都有一个
            name=f"feedback.{e['kind']}",
            value=e["value"],
            data_type=DATA_TYPE[e["kind"]],
            comment=e["comment"] or None,
            score_id=e["event_id"].replace(":", "-"),   # 同一个 id 再发一次是覆盖,不会重复计数
        )
        n += 1
    lf.flush()
    print(f"已提交 {n} 个 score")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from langfuse import get_client` 和 Day 34、Day 52 一样拿单例客户端。2026-10 实测 langfuse 5.0.4。
- `DATA_TYPE = {"thumb": "NUMERIC", "edit_ratio": "NUMERIC", "csat": "NUMERIC", "escalated": "BOOLEAN", "reopened": "BOOLEAN"}` Langfuse 的 score 有数值、布尔、类别、文本几种类型。点踩用 NUMERIC 的 ±1,在 Langfuse 里能直接算平均。
- `lf = get_client()                      # 没配 LANGFUSE_* 环境变量时客户端是禁用状态,调用不报错也不上报` 实测没配 key 时打印一行 `Langfuse client initialized without public_key. Client will be disabled.`,然后照常跑完,输出 `已提交 291 个 score`(其实一个也没发出去)。
- `trace_id=e["trace_id"],        # 必须是 Langfuse 里真实存在的 trace id,Day 52 里 SupportPilot 每次回复都有一个` 模拟数据里的 `tr-0001` 在你的 Langfuse 里不存在,真的配了 key 会产生一堆挂不上的 score。今天只看写法,接到 SupportPilot 以后再真跑。
- `name=f"feedback.{e['kind']}",` 统一加 `feedback.` 前缀,和离线评测的 score(比如 Day 35 的 grader)区分开。
- `score_id=e["event_id"].replace(":", "-"),   # 同一个 id 再发一次是覆盖,不会重复计数` `create_score` 的 `score_id` 参数是幂等键,和本地 `event_id` 一一对应,同步脚本跑多少次都不会重复。
- `lf.flush()` 后台队列立刻发完。脚本马上要退出,不 flush 会丢数据,Day 34 讲过。

</div>

Langfuse 在这件事上走得比我们远。2026 年 1 月它上线了 Corrections 功能:在 trace 上直接写一份「修正后的输出」,界面里和原输出做 diff,底层存成一种特殊的 score。官方文档《From user feedback to evaluation datasets》描述的流程和今天几乎一样:反馈存成 score,按 score 过滤失败的 trace,批量加进 dataset(SDK 是 `create_dataset_item`,可以带 `source_trace_id` 关联原始 trace),修正后的输出当 expected output,跑实验时固定 dataset 版本,让 CI 结果可复现;评审模型和用户反馈不一致的 trace 送进 annotation queue 给专家标。如果你的团队已经在用 Langfuse,这些可以直接用它的界面做,今天的脚本帮你理解每一步在干什么,也适合不想把数据放到第三方平台的场景。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/e2i6JbU2R-s" title="Error Analysis: The Highest ROI Technique In AI Engineering" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hamel Husain · Error Analysis: The Highest ROI Technique In AI Engineering · 讲怎么从线上 trace 里抽样、手写笔记、归类,和今天「分诊 + 人审」那两步对应,看完会更清楚为什么人审这一步省不掉。</figcaption>
</figure>

## 看板和节奏

飞轮能不能一直转,靠的是固定节奏和几个一直盯着的数。我在 SupportPilot 上会这么安排:

每天自动跑报表,只看两个数有没有突变:各类别的重度改写率和点踩率。某个类别一天之内翻倍,通常是上了新版本、改了政策、或者出了新功能,值得当天看一眼。每周一次分诊和人审,产出是新增用例数、补的文章数、修的 bug 数,记在一个简单的周报里。每个 prompt 版本上线一周后,按 `prompt_version` 对比上一个版本的指标,这是 Day 143 优化出来的 prompt 在线上到底有没有用的唯一证据。

除了按信号挑,每周再**随机抽 20 条没有任何负面信号的回复**人工过一遍。原因前面说过:客服忙的时候不改不点,所有信号都是沉默的,而沉默的错误是最危险的。这 20 条里如果发现了问题,说明你的信号覆盖不到这类错误,要考虑加新信号。

最后提防一件事:指标一旦被拿来考核,行为就会变形。如果你跟客服组说「我们要把改写率降下来」,客服最省事的做法是少改,改写率确实降了,回复质量没变,甚至更差。这些指标只用来找问题,不用来考核人,也不直接当 Agent 的优化目标。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/qbvY0dQgSJ4" title="AI Engineering 101 with Chip Huyen (Nvidia, Stanford, Netflix)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Lenny's Podcast · AI Engineering 101 with Chip Huyen · 《AI Engineering》作者的长访谈,讲用户反馈、评测和「先看数据再优化」的部分值得听,可以和书的第 10 章对照。</figcaption>
</figure>

## 动手练习

1. **跑通一圈。** 按顺序运行 `simulate`、`triage --llm`,手工编辑 `triage_queue.jsonl` 生成 `reviewed.jsonl`(前三组 accept,后两组拒绝,expect 照文中写),再运行 `promote` 和 `kb_draft`。
2. **补上退款那一组。** 在 Day 23 的 cloudledger 测试库里找一个专业版年付的客户(没有就在 seed 里加一个),按 kb-002 算出应退金额,填进 `expect` 的 `customer_id` 和 `refund`,让 promote 不再跳过它。
3. **调阈值。** 把 `simulate.py` 里客套话那一句改长(比如加上「祝您工作顺利,有问题随时联系我们,我们 7×24 小时在线。」),重新生成数据,看重度改写率和分诊队列怎么变;再调 `suspicion()` 的阈值,让误报回到原来的水平。
4. **加一个新信号。** 在 `api.py` 里加 `/feedback/discard`(客服丢弃草稿、从头写),在 `suspicion()` 里给它定一个分数,说明你为什么这么定。
5. **按版本对比。** 让 `simulate.py` 前 100 条用 `prompt_version="v3"`、后 100 条用 `"v4"`,v4 里 E4031 场景出问题的概率改成 0.1,在 `triage.py` 的报表里加一个按版本分组的视图,看能不能一眼看出 v4 变好了。

### 验收标准

- `test_api.py` 通过,`simulate` 和 `triage` 的输出和文中一致。
- `golden_from_feedback.jsonl` 里有 3 条用例(包括你补好的退款那一条),用 Day 31 的 `validate.py` 校验通过。
- 练习 3 写一句话说明你最后选的阈值和理由。
- 能说清楚为什么 invoice 的平均改写只有 7%,却有一组需要处理的 badcase。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 数据飞轮 | 上线产生反馈,反馈变成数据和修复,修复让产品更好、带来更多使用和反馈,循环往复。 |
| 显式反馈 | 用户主动表态,如点赞点踩、评分、勾选原因。量少、可信度高、偏向两头。 |
| 隐式反馈 | 从行为推出的信号,如改写比例、转人工、追问。量大、无需配合、噪声大。 |
| 结果反馈 | 业务最终结果,如退款被驳回、取消订阅。最接近真实目标,但慢且难归因。 |
| 改写比例 | 1 减去草稿和最终发出版本的相似度,0 是原样发出,1 是全部重写。 |
| 分诊 | 对可疑回复打分、去重、排序,决定先看哪些。 |
| badcase | 线上确认出错的案例,经人审后进入测试集或触发修复。 |
| 幂等键 | 同一个操作重复提交时用来识别「是同一件事」的 id,保证不重复计数。 |
| score | Langfuse 里挂在 trace 或 observation 上的评价,可以来自用户、模型评审或人工标注。 |
| annotation queue | Langfuse 的人工标注队列,把选中的 trace 分配给标注人按固定标准打分。 |
| 古德哈特定律 | 一个指标一旦成为考核目标,就不再是好的指标。 |

## 常见误区

**只看总分和平均数。** 今天 invoice 的平均改写只有 7%,专票问题被几十条正常的发票抬头问题稀释了。报表至少按类别切,分诊要按更细的组看。

**把点踩当成真相。** 模拟里有两组只有一次点踩、草稿一个字没改,就是误点。显式反馈可信度高,但不是百分之百,人审时要看证据。

**只信信号,不随机抽查。** 客服不改不点的时候所有信号都沉默。每周随机抽一批「看起来没问题」的回复,是发现盲区的唯一办法。

**让模型直接决定什么进测试集。** 模型可以猜原因、起草文章,但「这算不算错」「正确答案是什么」只能人来定。今天 E4031 是什么意思,客服改写的版本和模型的猜测都不能当最终依据,要找产品确认。

**线上原文直接进测试集。** 工单里有客户的个人信息,测试集会进 git、进 CI 日志。先脱敏再入库。

**拿反馈指标考核客服。** 一旦考核改写率,客服就会少改,指标变好看,问题被藏起来。

**只补测试集,不修根因。** 用例进了门禁,下次会拦住同样的错误,但 Agent 还是会错。知识缺失要补文章,政策理解错要查检索和 prompt。

## 学习资料

### 文档与文章

- [Langfuse · From user feedback to evaluation datasets](https://langfuse.com/resources/engineering/user-feedback-to-evaluation-datasets):官方写的完整流程,反馈存 score、过滤、加进 dataset、修正当 expected output、固定版本跑 CI,和今天一一对应,20 分钟。
- [Langfuse · User Feedback](https://langfuse.com/docs/observability/features/user-feedback):浏览器端怎么直接上报点赞点踩,只需要 public key,15 分钟。
- [Langfuse · Corrections](https://langfuse.com/docs/observability/features/corrections):在 trace 上写修正输出的功能说明,10 分钟。
- [Langfuse · Scores 概览](https://langfuse.com/docs/evaluation/scores/overview):score 的几种数据类型和来源,10 分钟。
- [Agent-in-the-Loop(arXiv 2510.06674)](https://arxiv.org/abs/2510.06674):Airbnb 客服 LLM 系统的数据飞轮,看方法部分四种标注怎么嵌进客服工作流,30 分钟。正式版在 [ACL Anthology](https://aclanthology.org/2025.emnlp-industry.135/)。
- [Eugene Yan · Patterns for Building LLM-based Systems & Products](https://eugeneyan.com/writing/llm-patterns/):最后一节「Collect user feedback」讲显式和隐式反馈的设计,和 Copilot、Midjourney 的例子,20 分钟。
- [Hamel Husain · A Field Guide to Rapidly Improving AI Products](https://hamel.dev/blog/posts/field-guide/):讲为什么要建自己的数据查看工具、为什么要让领域专家直接参与,30 分钟。

### B 站视频

- 正文里嵌的 Web3天空之城《为什么AI评估是产品构建者最热门的新技能 | Hamel Husain & Shreya Shankar》,106 分钟,带中文文稿。
- AI老马啊《智能体｜Agent自动化评测体系构建指南》(BV1dtFbzdEqu):18 分钟,国内视角讲评测体系怎么搭,可以和 W5 对照着看,按 BV 号搜索。

### 其他经典视频

- 正文里的 Hamel Husain《Error Analysis: The Highest ROI Technique In AI Engineering》和 Lenny's Podcast《AI Engineering 101 with Chip Huyen》。
- Hamel Husain《How to Automate AI Evals (Correctly)》:YouTube 按标题搜索,讲自动评审和人工标注怎么配合,接在今天之后看。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 10 章「AI Engineering Architecture and User Feedback」后半部分专讲用户反馈,包括从对话里提取反馈、反馈设计和反馈的局限,今天的信号分类就是从这里来的,读 User Feedback 这一节,二十多页。
- Chip Huyen《Designing Machine Learning Systems》(O'Reilly, 2022):第 8 章讲数据分布变化和监控,第 9 章讲持续学习和线上测试,传统机器学习的视角,帮你理解「测试集为什么会过期」。

### 开源项目与代码

- [langfuse/langfuse](https://github.com/langfuse/langfuse):自托管版本,score、dataset、annotation queue 都在里面;Python SDK 的 `create_score` 和 `create_dataset_item` 在 `langfuse/_client/client.py`,读参数说明就知道每个字段干什么。
- 今天的 `topics/feedback/` 七个文件:存储、接口、信号、造数、分诊、入库、起草,外加一个测试,可以直接搬进 SupportPilot。

## 自测

1. 显式反馈、隐式反馈、结果反馈各举两个例子,说出它们在量和可信度上的区别。

<details><summary>答案</summary>

显式:客服点踩、客户满意度评分。量少,可信度高,但偏向两头。隐式:草稿改写比例、转人工或客户追问。每条都有,不用配合,但噪声大。结果:退款被主管驳回、客户一个月内取消订阅。最接近业务目标,但来得慢、很难归因到某一条回复,适合月度复盘和 A/B 实验。

</details>

2. 为什么 `events` 表的主键是 `trace_id:kind:source` 而不是自增 id?

<details><summary>答案</summary>

为了幂等。前端重发、客服改主意、同步脚本重跑,都会对同一条回复提交同一种信号。用业务含义拼出来的主键加上 upsert,重复提交会覆盖而不是新增一行,计数才不会虚高。自增 id 每次插入都不一样,做不到这一点。

</details>

3. 今天的模拟数据里,重度改写的阈值为什么定在 0.5?换一个产品还能用这个数吗?

<details><summary>答案</summary>

实测客套话造成的改写比例最高 0.33,真正改错的最低 0.52,0.5 正好落在两者之间。换产品不能照搬:草稿长度、客服习惯、回复风格都会改变分布。正确做法是上线后先画出改写比例的分布,在不同区间各抽一些人工看,再决定阈值。

</details>

4. 分诊队列里有一组只有 1 条回复,原因只有「客服点踩」,草稿和发出版本完全一样。你会怎么处理?

<details><summary>答案</summary>

大概率是误点,或者客服对政策本身不满而不是 Agent 答错。快速看一眼,确认回复内容没问题就把 accept 填 false,备注原因。如果同样的情况反复出现,考虑改按钮的位置或者加一个确认步骤,而不是去改 Agent。

</details>

5. 退款类的 badcase 为什么不能直接进测试集,要先补 `customer_id` 和 `refund`?

<details><summary>答案</summary>

Day 31 的约定里,`refund` 为空表示「不应该产生退款申请」。如果直接把 expect 写成没有 refund 字段,这条用例会惩罚正确发起退款的 Agent,等于把错误的行为写成了标准答案。而且线上客户在测试库里不存在,退款金额依赖具体的订阅和发票数据,必须在测试库里找到或造一个同样情况的客户,算好应退金额。

</details>

6. **面试题**:面试官问「你的 Agent 上线以后怎么持续改进?」请用 2 分钟回答。

<details><summary>答案</summary>

按飞轮讲。采集:每条回复带 trace_id,收客服点踩、草稿改写比例、转人工、客户追问,事件表用幂等键防重复。分诊:每天自动出按类别的报表盯突变,每周按可疑度排序、按问题去重成组,模型辅助猜原因,外加随机抽查没有负面信号的回复。人审:确认是不是真错、正确答案是什么。三条出口:审过的变成测试用例进回归门禁,知识缺失的起草帮助中心文章,政策或检索问题回到 prompt 和检索去修;修完过门禁才上线,按 prompt 版本对比线上指标验证效果。最后提一句风险控制:线上数据入库先脱敏,指标不用来考核人。能给一个具体例子更好,比如「一个新错误码一周内造成 10 次转人工,补文章加两条用例后下个版本归零」。

</details>

## 明天预告

Day 145 讲 Guardrails 分层防御:输入输出检查、安全分类器与策略引擎。Day 39 讲了 prompt injection 怎么打,明天讲防御怎么落到代码里,包括 Llama Guard、Qwen3Guard 这类安全分类器,以及怎么量误杀率和漏放率。专题篇可以跳着读,不想看可以直接回到主线。
