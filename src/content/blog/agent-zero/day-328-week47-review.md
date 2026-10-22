---
title: 'Day 328 · 第 47 周复习:MCP 与编排(Day 322–327)'
description: '这一周前半段把 LangGraph 的时间旅行、三种 stream_mode、子图学完,后半段用它们搭了一个由事件驱动、停在收件箱等人的后台 Agent。今天用一张知识地图把六天串起来,默写原子领取和 webhook 验签两段核心代码,再只用本周的东西从零写一个不调模型的后台版「发票抬头修改」,最后把这周的坑过一遍。'
pubDate: 2026-10-22
regime: none
tags: ['langgraph', 'ambient-agent', 'review', 'agent-zero']
series: 'agent-zero'
day: 328
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 327](/blog/agent-zero/day-327-ambient-3/) 把收件箱做了出来:review 节点支持 accept、edit、response、ignore 四种处理,`inbox.py` 按条目自己的 config 放行或拒绝;定时任务扫出的超期工单变成了只能 ignore 的「通知」;最后一份日报盯着队列深度、最长等待和死信。练习 3 还用时间旅行把一条旧版本的待办刷新成了新规则。

这一周的六天,前三天是 LangGraph 的三个独立工具,后三天是一个完整的系统。两半之间的联系不太显眼,今天停一天,把它们放到同一张图上,再自己从零写一遍。

## 今天要解决的问题

学完今天,你应该能做到:

1. 合上文章,说出时间旅行、三种 stream_mode、子图各解决什么问题,以及后台 Agent 链路上每一段(事件表、worker、处理图、收件箱、outbox)用到了其中哪些。
2. 默写原子领取 `claim()` 和 webhook 验签 `verify()`,并跑出「三个线程抢 5 个事件、每个只被领一次」和「四种请求四种结果」。
3. 只用本周的知识写出 `title_bot.py`:事件去重入队、worker 原子领取并用 `stream_mode="updates"` 打进度、图停在收件箱、主管 accept 或 edit 后写业务表,重复事件和第二来源都被挡住。
4. 说出这一周至少六个坑,每个都能讲出真实报错或真实现象。

预计用时 3.5 小时:地图和回顾 30 分钟,两段默写各 30 分钟,小项目 1.5 小时,剩下做练习和自测。前置:[Day 322](/blog/agent-zero/day-322-lg-time-travel/) 到 [Day 327](/blog/agent-zero/day-327-ambient-3/) 全部。今天所有脚本都不调模型,一分钱不花。

学法和平时一样:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章把两段默写代码再写一遍;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="第 47 周知识地图:上半部分是 LangGraph 的三个工具,时间旅行、stream_mode、子图;下半部分是后台 Agent 链路,触发源到事件表到 worker 到处理图到收件箱到 outbox。虚线标出三个工具在链路里用到的位置">
  <rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12">
    <rect x="16" y="16" width="190" height="78" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="26" y="36" fill="var(--ink)">Day 322 时间旅行</text>
    <text x="26" y="56" font-size="11" fill="var(--ink-soft)">旧快照 invoke(None)=重放</text>
    <text x="26" y="72" font-size="11" fill="var(--ink-soft)">update_state=分叉</text>
    <text x="26" y="88" font-size="10" fill="var(--ink-faint)">收不回写过的库</text>
    <rect x="225" y="16" width="190" height="78" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="235" y="36" fill="var(--ink)">Day 323 stream_mode</text>
    <text x="235" y="56" font-size="11" fill="var(--ink-soft)">updates / values / messages</text>
    <text x="235" y="72" font-size="11" fill="var(--ink-soft)">多种一起开用 v2</text>
    <text x="235" y="88" font-size="10" fill="var(--ink-faint)">不会让图更快</text>
    <rect x="434" y="16" width="190" height="78" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="444" y="36" fill="var(--ink)">Day 324 子图</text>
    <text x="444" y="56" font-size="11" fill="var(--ink-soft)">同名字段直接加</text>
    <text x="444" y="72" font-size="11" fill="var(--ink-soft)">不同名包一层函数</text>
    <text x="444" y="88" font-size="10" fill="var(--ink-faint)">checkpointer None/True/False</text>
  </g>
  <rect x="16" y="140" width="608" height="120" rx="6" fill="none" stroke="var(--ink-soft)"/>
  <text x="26" y="160" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Day 325–327 后台 Agent</text>
  <g font-family="var(--font-mono)" font-size="11" text-anchor="middle">
    <rect x="26" y="180" width="82" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="67" y="198" fill="var(--ink)">触发源</text><text x="67" y="214" font-size="10" fill="var(--ink-soft)">325</text>
    <rect x="124" y="180" width="82" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
    <text x="165" y="198" fill="var(--ink)">事件表</text><text x="165" y="214" font-size="10" fill="var(--ink-soft)">①主键去重</text>
    <rect x="222" y="180" width="82" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
    <text x="263" y="198" fill="var(--ink)">worker</text><text x="263" y="214" font-size="10" fill="var(--ink-soft)">原子领取</text>
    <rect x="320" y="180" width="96" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="368" y="198" fill="var(--ink)">处理图</text><text x="368" y="214" font-size="10" fill="var(--ink-soft)">②thread=工单</text>
    <rect x="432" y="180" width="86" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--ink)"/>
    <text x="475" y="198" fill="var(--ink)">收件箱</text><text x="475" y="214" font-size="10" fill="var(--ink-soft)">327</text>
    <rect x="534" y="180" width="80" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="574" y="198" fill="var(--ink)">outbox</text><text x="574" y="214" font-size="10" fill="var(--ink-soft)">③UNIQUE</text>
  </g>
  <g stroke="var(--ink-soft)" fill="none">
    <line x1="108" y1="202" x2="124" y2="202"/><line x1="206" y1="202" x2="222" y2="202"/><line x1="304" y1="202" x2="320" y2="202"/>
    <line x1="416" y1="202" x2="432" y2="202"/><line x1="518" y1="202" x2="534" y2="202"/>
  </g>
  <g stroke="var(--mem)" stroke-dasharray="3 3" fill="none">
    <line x1="111" y1="94" x2="475" y2="180"/>
    <line x1="320" y1="94" x2="263" y2="180"/>
    <line x1="529" y1="94" x2="368" y2="180"/>
  </g>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">
    <text x="26" y="250">琥珀 = 外部系统 · 蓝 = LangGraph · 圆圈数字 = 三处去重</text>
    <text x="16" y="282">时间旅行 → 刷新收件箱旧条目(327 练习 3)、续跑崩了的 thread 用的也是 invoke(None)</text>
    <text x="16" y="300">stream_mode → worker 打进度(今天的小项目)</text>
    <text x="16" y="318">子图 → 把处理图装进路由图(324),后台 Agent 按 kind 分派是同一个思路</text>
  </g>
</svg>
<figcaption>上面是三个工具,下面是一条链路。虚线是工具落在链路上的位置:时间旅行管收件箱,stream 管 worker 的进度,子图的路由思路就是 worker 的 dispatch。</figcaption>
</figure>

用一句话把这周的后半段说清楚:**事件先落表,worker 原子地领,图按工单号存状态,停在收件箱等人,有后果的动作写一张带唯一约束的表。** 每一个「先」「原子」「按工单号」「唯一约束」都对应一处重复。

## 本周每天一句话

- [Day 322 · 时间旅行](/blog/agent-zero/day-322-lg-time-travel/):从旧快照 `invoke(None, 旧config)` 是重放,快照之后的节点真的重跑;先 `update_state` 再跑是分叉,原来的结局还在历史里。它只倒回 checkpoint,写进业务库的退款收不回来。
- [Day 323 · 三种 stream_mode](/blog/agent-zero/day-323-lg-stream-modes/):updates 每个节点跑完吐一次改动,values 每步吐完整状态(先把输入吐一遍),messages 吐模型的片段;多种一起开写 `version="v2"` 按 `part["type"]` 分。
- [Day 324 · 子图](/blog/agent-zero/day-324-lg-subgraph/):编译好的图可以当节点;父子状态没有同名字段时子图安静地收到 `{}`;带审批的子图别用 `checkpointer=False`,否则恢复时从头重跑多调一次模型。
- [Day 325 · 三种触发源和事件表](/blog/agent-zero/day-325-ambient-1/):webhook、邮件、定时任务都会重复;所有来源先变成事件表的一行,去重键做主键,`INSERT OR IGNORE` 加 `rowcount` 判断新旧。
- [Day 326 · webhook 入口、处理图和 worker](/blog/agent-zero/day-326-ambient-2/):入口只验签、落库、回 202;worker 一条 `UPDATE ... RETURNING` 原子领取,三次失败进死信;看 `interrupts` 分清停下等人和跑到一半崩了。
- [Day 327 · 收件箱式审批](/blog/agent-zero/day-327-ambient-3/):HumanInterrupt 三件套(action_request、config、description)加四种处理;条目的 config 是生成时定的,改代码改不到;日报盯最长等待和死信。

## 默写 1:事件表和原子领取

不看前面几天,写一个文件:建一张最小的事件表,入队时去重,再用三个线程同时领。要求每个事件恰好被领一次。

先自己写,写不出来再往下看。

```python
# agent-zero-lab/part05/review47/recall_claim.py
"""默写 1:事件表 + 去重入队 + 原子领取。三个线程抢 5 个事件,每个只能被领一次。"""
import sqlite3
import threading
from pathlib import Path

DB = Path(__file__).with_name("recall.db")


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def add_event(event_id: str) -> bool:
    with connect() as conn:
        cur = conn.execute("INSERT OR IGNORE INTO events (event_id, status, received_at) VALUES (?, 'pending', ?)",
                           (event_id, event_id[-1]))
        return cur.rowcount == 1


def claim() -> str | None:
    with connect() as conn:
        row = conn.execute(
            "UPDATE events SET status = 'processing' "
            "WHERE event_id = (SELECT event_id FROM events WHERE status = 'pending' ORDER BY received_at LIMIT 1) "
            "RETURNING event_id"
        ).fetchone()
    return row["event_id"] if row else None


def worker(name: str, got: list[str]) -> None:
    while (ev := claim()) is not None:
        got.append(ev)
        print(name, "领到", ev)


if __name__ == "__main__":
    DB.unlink(missing_ok=True)
    with connect() as conn:
        conn.execute("CREATE TABLE events (event_id TEXT PRIMARY KEY, status TEXT NOT NULL, received_at TEXT NOT NULL)")
    print("入队:", [add_event(f"evt_{i}") for i in (1, 2, 3, 4, 5, 3, 5)])
    got: list[str] = []
    threads = [threading.Thread(target=worker, args=(f"w{i}", got)) for i in (1, 2, 3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    print("一共领到", len(got), "次,不重复的", len(set(got)), "个")
```

<div class="line-notes">

- `conn = sqlite3.connect(DB, timeout=10)` 三个线程同时写一个库,SQLite 同一时刻只让一个写,其他的排队等锁,`timeout=10` 是最多等 10 秒(Day 325)。
- `cur = conn.execute("INSERT OR IGNORE INTO events (event_id, status, received_at) VALUES (?, 'pending', ?)",` 去重的全部机制:主键加 `OR IGNORE`。
- `(event_id, event_id[-1]))` 为了让顺序确定,收到时间直接用 id 的最后一个字符 `'1'` 到 `'5'`,省得在同一秒里排不出先后。真代码用 `now()`。
- `return cur.rowcount == 1` 插进去是 1,被忽略是 0(Day 325)。
- `"UPDATE events SET status = 'processing' "` 挑和改在一条语句里(Day 326)。
- `"RETURNING event_id"` 改完顺便告诉我改了谁。
- `while (ev := claim()) is not None:` 海象运算符:领一个,领到了就处理,领不到(None)就退出循环。
- `got.append(ev)` 三个线程往同一个列表里追加。Python 的 `list.append` 单次调用是线程安全的,这里够用。
- `print("入队:", [add_event(f"evt_{i}") for i in (1, 2, 3, 4, 5, 3, 5)])` 7 次投递,其中 evt_3 和 evt_5 各重复一次。
- `print("一共领到", len(got), "次,不重复的", len(set(got)), "个")` 两个数相等,说明没有任何事件被领两次。`set()` 去重,相当于 JS 的 `new Set(got).size`。

</div>

```bash
cd agent-zero-lab/part05
mkdir -p review47 && cd review47
uv run python recall_claim.py
```

```text
入队: [True, True, True, True, True, False, False]
w1 领到 evt_1
w3 领到 evt_2
w3 领到 evt_3
w1 领到 evt_4
w3 领到 evt_5
一共领到 5 次,不重复的 5 个
```

哪个线程领到哪个,每次跑都不一样(这次 w2 一个都没抢到),但最后一行永远是 5 和 5。把 `claim()` 换成 Day 326 `claim_race.py` 里那个先 SELECT 再 UPDATE、中间睡 0.1 秒的版本,第一个数就会大于第二个。

## 默写 2:webhook 验签

不起服务,把 `verify()` 写成一个返回状态码字符串的普通函数,用四种请求各试一次:正常、缺 `v1`、一小时前的时间戳、内容被改。

```python
# agent-zero-lab/part05/review47/recall_verify.py
"""默写 2:webhook 验签。不起服务,直接调 verify(),四种请求各试一次。"""
import hashlib
import hmac
import time

SECRET = b"dev-secret-change-me"
TOLERANCE_S = 300


def sign(ts: int, raw: bytes) -> str:
    return hmac.new(SECRET, f"{ts}.".encode() + raw, hashlib.sha256).hexdigest()


def verify(raw: bytes, header: str) -> str:
    try:
        parts = dict(p.split("=", 1) for p in header.split(","))
        ts, sig = int(parts["t"]), parts["v1"]
    except (KeyError, ValueError):
        return "400 bad signature header"
    if abs(time.time() - ts) > TOLERANCE_S:
        return "400 timestamp too old"
    if not hmac.compare_digest(sign(ts, raw), sig):
        return "401 bad signature"
    return "202 accepted"


if __name__ == "__main__":
    body = b'{"id": "evt_T1029_created", "type": "ticket.created"}'
    now = int(time.time())
    cases = {
        "正常": (body, f"t={now},v1={sign(now, body)}"),
        "缺 v1": (body, f"t={now}"),
        "一小时前": (body, f"t={now - 3600},v1={sign(now - 3600, body)}"),
        "内容被改": (body.replace(b"T1029", b"T1030"), f"t={now},v1={sign(now, body)}"),
    }
    for name, (raw, header) in cases.items():
        print(f"{name:<6}", verify(raw, header))
```

<div class="line-notes">

- `SECRET = b"dev-secret-change-me"` 默写时直接写死。正式代码从环境变量 `WEBHOOK_SECRET` 读(Day 326)。
- `return hmac.new(SECRET, f"{ts}.".encode() + raw, hashlib.sha256).hexdigest()` 签的是「时间戳 + 点 + 原始字节」。时间戳签进去,改时间戳签名就对不上。
- `parts = dict(p.split("=", 1) for p in header.split(","))` `t=...,v1=...` 拆成字典。缺 `v1` 时这一行不报错,下一行取 `parts["v1"]` 才抛 `KeyError`。
- `except (KeyError, ValueError):` 两种格式错误都回 400,不让异常变成 500。
- `if abs(time.time() - ts) > TOLERANCE_S:` 防重放:差 5 分钟以上就拒。
- `if not hmac.compare_digest(sign(ts, raw), sig):` 常数时间比较,不用 `==`。
- `"一小时前": (body, f"t={now - 3600},v1={sign(now - 3600, body)}"),` 签名本身是对的(用的是同一个旧时间戳),只是太旧。这就是重放的样子。
- `"内容被改": (body.replace(b"T1029", b"T1030"), f"t={now},v1={sign(now, body)}"),` 签名按原内容算,发出去的内容被改了一个字节。
- `for name, (raw, header) in cases.items():` 一边遍历一边把元组拆开,相当于 JS 的 `for (const [name, [raw, header]] of Object.entries(cases))`。
- `print(f"{name:<6}", verify(raw, header))` `:<6` 按 6 个字符宽左对齐。中文一个字在终端里占两格,所以下面的输出看着没对齐,这不是 bug。

</div>

```bash
uv run python recall_verify.py
```

```text
正常     202 accepted
缺 v1   400 bad signature header
一小时前   400 timestamp too old
内容被改   401 bad signature
```

## 小项目:后台版「发票抬头修改」

Day 321 的小项目是一个手动启动的发票抬头审批。这次把它改成后台的:工单进来是事件,worker 自己去领,停在收件箱等人,批了才写业务表。只用本周学的东西,不调模型(新抬头用正则从工单正文里抠出来),所以一分钱不花。

要求:

1. `ingest` 模拟 webhook 投递,同一个事件投两次只进一行。
2. `work` 是 worker:原子领取,先 `get_state` 看这张工单是否已在收件箱或已处理;用 `stream_mode="updates", version="v2"` 打出每个节点的进度;失败三次进死信,崩了的 thread 用 `invoke(None)` 那一套续跑。
3. 图是 load → review → apply。review 交出一个 HumanInterrupt,只开 accept、edit、ignore;正则没认出新抬头时不许 accept。
4. `list`、`accept`、`edit`、`ignore` 是收件箱,按条目自己的 config 判断。
5. `apply` 写 `title_changes` 表,工单号是主键,重复执行只写一次。

工单数据是 CloudLedger 里五张「发票抬头修改」:T1008、T1019、T1029、T1037、T1039,正文都长这样:「上个月的发票抬头写错了,应该是「知行咨询有限公司」,能重开吗?」。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/review47/title_bot.py
"""第 47 周小项目:后台版「发票抬头修改」。不调模型,只用本周学的东西。
  uv run python title_bot.py ingest T1029 T1037 T1029     # 模拟 webhook 投递(故意重复一次)
  uv run python title_bot.py work                         # worker:领事件、跑图、流式打进度
  uv run python title_bot.py list                         # 收件箱
  uv run python title_bot.py accept T1029
  uv run python title_bot.py edit   T1037 "星河餐饮管理有限公司"
  uv run python title_bot.py ignore T1037
"""
import re
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Command, interrupt

HERE = Path(__file__).parent
EVENTS_DB = HERE / "title_bot.db"
CKPT_DB = HERE / "title_bot_ckpt.db"
BIZ_DB = HERE.parents[1] / "cloudledger" / "cloudledger.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    event_id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, received_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS title_changes (
    ticket_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, new_title TEXT NOT NULL, changed_at TEXT NOT NULL
);
"""


def now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def db(path: Path = EVENTS_DB) -> sqlite3.Connection:
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


class TitleState(TypedDict):
    ticket_id: str
    customer_id: str
    new_title: str
    outcome: str


class TitleInput(TypedDict):
    ticket_id: str


def load(state: TitleState) -> dict:
    with db(BIZ_DB) as conn:
        t = conn.execute("SELECT customer_id, body FROM tickets WHERE id = ?", (state["ticket_id"],)).fetchone()
    if t is None:
        raise ValueError(f"工单 {state['ticket_id']} 不存在")
    m = re.search(r"「(.+?)」", t["body"])
    return {"customer_id": t["customer_id"], "new_title": m.group(1) if m else ""}


def review(state: TitleState) -> dict:
    answer = interrupt({
        "action_request": {"action": "change_title", "args": {"ticket_id": state["ticket_id"], "new_title": state["new_title"]}},
        "config": {"allow_accept": bool(state["new_title"]), "allow_edit": True, "allow_respond": False, "allow_ignore": True},
        "description": f"{state['customer_id']} 申请把发票抬头改成「{state['new_title'] or '(没认出来)'}」",
    })
    if answer["type"] == "accept":
        return {"outcome": "apply"}
    if answer["type"] == "edit":
        return {"outcome": "apply", "new_title": answer["args"]["args"]["new_title"]}
    return {"outcome": "ignored"}


def apply(state: TitleState) -> dict:
    with db() as conn:
        cur = conn.execute(
            "INSERT OR IGNORE INTO title_changes VALUES (?, ?, ?, ?)",
            (state["ticket_id"], state["customer_id"], state["new_title"], now()),
        )
    return {"outcome": "changed" if cur.rowcount == 1 else "already_changed"}


builder = StateGraph(TitleState, input_schema=TitleInput)
builder.add_node("load", load)
builder.add_node("review", review)
builder.add_node("apply", apply)
builder.add_edge(START, "load")
builder.add_edge("load", "review")
builder.add_conditional_edges("review", lambda s: "apply" if s["outcome"] == "apply" else END, ["apply", END])
builder.add_edge("apply", END)


def thread_of(ticket_id: str) -> RunnableConfig:
    return {"configurable": {"thread_id": f"title-{ticket_id}"}}


def ingest(ticket_ids: list[str]) -> None:
    with db() as conn:
        for tid in ticket_ids:
            cur = conn.execute(
                "INSERT OR IGNORE INTO events (event_id, ticket_id, received_at, updated_at) VALUES (?, ?, ?, ?)",
                (f"webhook:evt_{tid}_created", tid, now(), now()),
            )
            print(tid, "新事件" if cur.rowcount == 1 else "重复,忽略")


def claim() -> sqlite3.Row | None:
    with db() as conn:
        return conn.execute(
            "UPDATE events SET status = 'processing', attempts = attempts + 1, updated_at = ? "
            "WHERE event_id = (SELECT event_id FROM events WHERE status = 'pending' ORDER BY received_at LIMIT 1) "
            "RETURNING event_id, ticket_id, attempts",
            (now(),),
        ).fetchone()


def set_status(event_id: str, status: str, error: str | None = None) -> None:
    with db() as conn:
        conn.execute("UPDATE events SET status = ?, last_error = ?, updated_at = ? WHERE event_id = ?",
                     (status, error, now(), event_id))


def work(graph: CompiledStateGraph) -> None:
    while (ev := claim()) is not None:
        config = thread_of(ev["ticket_id"])
        snap = graph.get_state(config)
        if snap.interrupts or snap.values.get("outcome"):
            set_status(ev["event_id"], "done")
            print(ev["ticket_id"], "已在收件箱或已处理,跳过")
            continue
        try:
            waiting = False
            for part in graph.stream(None if snap.next else {"ticket_id": ev["ticket_id"]}, config,
                                     stream_mode="updates", version="v2"):
                for node in part["data"]:
                    print(f"  {ev['ticket_id']} · {node} 完成" if node != "__interrupt__" else f"  {ev['ticket_id']} · 进收件箱")
                    waiting = waiting or node == "__interrupt__"
            set_status(ev["event_id"], "waiting_human" if waiting else "done")
        except Exception as e:
            status = "dead" if ev["attempts"] >= 3 else "pending"
            set_status(ev["event_id"], status, f"{type(e).__name__}: {e}")
            print(ev["ticket_id"], f"第 {ev['attempts']} 次失败 → {status}:", e)


def inbox(graph: CompiledStateGraph, cmd: str, args: list[str]) -> None:
    with db() as conn:
        rows = conn.execute("SELECT event_id, ticket_id FROM events WHERE status = 'waiting_human' ORDER BY updated_at").fetchall()
    if cmd == "list":
        for r in rows:
            item = graph.get_state(thread_of(r["ticket_id"])).interrupts[0].value
            ok = [k for k in ("accept", "edit", "ignore") if item["config"][f"allow_{k}"]]
            print(f"{r['ticket_id']}  {item['description']}  可用:{'/'.join(ok)}")
        return
    row = next((r for r in rows if r["ticket_id"] == args[0]), None)
    if row is None:
        print(args[0], "不在收件箱里")
        return
    config = thread_of(row["ticket_id"])
    item = graph.get_state(config).interrupts[0].value
    if not item["config"][f"allow_{cmd}"]:
        print(args[0], "不允许", cmd)
        return
    answer = {"type": cmd, "args": None}
    if cmd == "edit":
        answer["args"] = {"action": "change_title", "args": {"ticket_id": row["ticket_id"], "new_title": args[1]}}
    result = graph.invoke(Command(resume=answer), config)
    set_status(row["event_id"], "done")
    print(row["ticket_id"], "→", result["outcome"])


def main() -> None:
    cmd, args = sys.argv[1], sys.argv[2:]
    with db() as conn:
        conn.executescript(SCHEMA)
    if cmd == "ingest":
        ingest(args)
        return
    with sqlite3.connect(CKPT_DB, check_same_thread=False) as ckpt:
        graph = builder.compile(checkpointer=SqliteSaver(ckpt))
        if cmd == "work":
            work(graph)
        else:
            inbox(graph, cmd, args)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `EVENTS_DB = HERE / "title_bot.db"` 事件表和 `title_changes` 放一个库。为了不碰 Day 326 的 `ambient.db`,今天全用新文件。
- `CKPT_DB = HERE / "title_bot_ckpt.db"` checkpoint 单独一个库(Day 318)。
- `BIZ_DB = HERE.parents[1] / "cloudledger" / "cloudledger.db"` 业务库只读。`HERE` 是 `review47`,`parents[1]` 是 `agent-zero-lab`。
- `attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, received_at TEXT NOT NULL, updated_at TEXT NOT NULL` 和 Day 326 的事件表比少了 source/kind/payload,今天只有一种来源,工单号直接放一列。
- `ticket_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, new_title TEXT NOT NULL, changed_at TEXT NOT NULL` 「业务表」:改了谁的抬头。工单号是主键,这是动作层的去重。真实系统里改抬头是调开票系统的接口,同样要带幂等键。
- `class TitleInput(TypedDict):` 图的输入只要工单号。
- `m = re.search(r"「(.+?)」", t["body"])` 正则 Day 1 就见过:`「` 和 `」` 之间至少一个字符,`?` 让它尽量少匹配,碰到第一个 `」` 就停。实跑 T1029 抠出 `知行咨询有限公司`。
- `return {"customer_id": t["customer_id"], "new_title": m.group(1) if m else ""}` 没匹配上就给空字符串,review 会据此关掉 accept。
- `"config": {"allow_accept": bool(state["new_title"]), "allow_edit": True, "allow_respond": False, "allow_ignore": True},` 空字符串转布尔是 False。没认出来就只能 edit(人手写抬头)或 ignore。respond 不开,因为没有模型可以「带着意见重写」。
- `"description": f"{state['customer_id']} 申请把发票抬头改成「{state['new_title'] or '(没认出来)'}」",` `a or b`:a 是空字符串时取 b,和 JS 的 `||` 一样。
- `return {"outcome": "apply", "new_title": answer["args"]["args"]["new_title"]}` edit 送回完整的 ActionRequest,新抬头在两层 args 下面(Day 327)。
- `"INSERT OR IGNORE INTO title_changes VALUES (?, ?, ?, ?)",` 重复执行只写一次。
- `builder.add_conditional_edges("review", lambda s: "apply" if s["outcome"] == "apply" else END, ["apply", END])` 路由函数短到一行就用 lambda(Day 30)。
- `return {"configurable": {"thread_id": f"title-{ticket_id}"}}` thread 按工单号,业务层去重的基础。
- `(f"webhook:evt_{tid}_created", tid, now(), now()),` 去重键 `webhook:` + 事件 id,和 Day 325、326 一样。
- `def claim() -> sqlite3.Row | None:` 和默写 1 一样,多了次数加一和更新时间。直接返回 Row,调用处按列名取。
- `snap = graph.get_state(config)` 跑之前先看一眼(Day 326)。
- `if snap.interrupts or snap.values.get("outcome"):` 在收件箱里,或者已经有结果(changed、ignored 等),都不再跑。
- `for part in graph.stream(None if snap.next else {"ticket_id": ev["ticket_id"]}, config,` 把 Day 326 的 `invoke` 换成 Day 323 的 `stream`。输入的选法不变:`next` 不为空(上次崩了)传 None 续跑,否则从头。走到这里时 `interrupts` 一定是空的,所以 `next` 不为空只可能是崩了。
- `stream_mode="updates", version="v2"):` v2 格式下每一项是字典,`part["data"]` 是「节点名 → 这个节点的改动」。
- `for node in part["data"]:` 遍历字典的键,也就是这一步跑完的节点名。停在 interrupt 时会出现一个特殊的键 `__interrupt__`。
- `waiting = waiting or node == "__interrupt__"` 只要见过一次 `__interrupt__`,就说明停在了收件箱。stream 没有 invoke 那样的返回值,只能边看边记。
- `status = "dead" if ev["attempts"] >= 3 else "pending"` 和 Day 326 一样的重试规则。
- `rows = conn.execute("SELECT event_id, ticket_id FROM events WHERE status = 'waiting_human' ORDER BY updated_at").fetchall()` 收件箱的目录来自事件表(Day 327)。
- `ok = [k for k in ("accept", "edit", "ignore") if item["config"][f"allow_{k}"]]` 拼出字段名 `allow_accept` 等去查。
- `if not item["config"][f"allow_{cmd}"]:` 按条目自己的 config 判断。
- `answer = {"type": cmd, "args": None}` 子命令名就是 HumanResponse 的 type。这里没有 respond,所以不需要 Day 327 那张 `respond → response` 的对照表。
- `result = graph.invoke(Command(resume=answer), config)` 恢复。review 从头跑,interrupt 返回 answer。
- `with sqlite3.connect(CKPT_DB, check_same_thread=False) as ckpt:` `ingest` 不需要图,所以图在这之后才编译。

</div>

从零跑一遍,T1029 故意投两次,再混进一张不存在的 T9999:

```bash
uv run python title_bot.py ingest T1029 T1037 T1029 T9999
uv run python title_bot.py work
uv run python title_bot.py list
```

```text
T1029 新事件
T1037 新事件
T1029 重复,忽略
T9999 新事件
  T1029 · load 完成
  T1029 · 进收件箱
  T1037 · load 完成
  T1037 · 进收件箱
T9999 第 1 次失败 → pending: 工单 T9999 不存在
T9999 第 2 次失败 → pending: 工单 T9999 不存在
T9999 第 3 次失败 → dead: 工单 T9999 不存在
T1029  C011 申请把发票抬头改成「知行咨询有限公司」  可用:accept/edit/ignore
T1037  C001 申请把发票抬头改成「星河餐饮有限公司」  可用:accept/edit/ignore
```

主管批 T1029,把 T1037 改成全称再批,再重复批一次 T1029;然后插一个 CRM 推来的第二个 T1029 事件(事件 id 不同),再跑 worker:

```bash
uv run python title_bot.py accept T1029
uv run python title_bot.py edit T1037 "星河餐饮管理有限公司"
uv run python title_bot.py accept T1029
sqlite3 title_bot.db "insert into events (event_id,ticket_id,received_at,updated_at) values ('webhook:evt_T1029_from_crm','T1029','2026-10-22T20:00:00','2026-10-22T20:00:00')"
uv run python title_bot.py work
sqlite3 title_bot.db "select * from title_changes"
sqlite3 title_bot.db "select event_id, status, attempts from events"
```

```text
T1029 → changed
T1037 → changed
T1029 不在收件箱里
T1029 已在收件箱或已处理,跳过
T1029|C011|知行咨询有限公司|2026-10-22T19:27:03
T1037|C001|星河餐饮管理有限公司|2026-10-22T19:27:05
webhook:evt_T1029_created|done|1
webhook:evt_T1037_created|done|1
webhook:evt_T9999_created|dead|3
webhook:evt_T1029_from_crm|done|1
```

三处去重都在:重复投递被事件主键挡住(`重复,忽略`),第二来源被 thread 状态挡住(`已在收件箱或已处理,跳过`),`title_changes` 每张工单一行。

「零件 → 小项目哪一段」对照:

| 零件 | 哪天学的 | 在 `title_bot.py` 哪里 |
| --- | --- | --- |
| 事件表 + `INSERT OR IGNORE` + `rowcount` | Day 325 | `SCHEMA` 的 events、`ingest()` |
| 原子领取 `UPDATE ... RETURNING` | Day 326 | `claim()` |
| 重试三次进死信 | Day 326 | `work()` 的 `except` |
| `get_state` 分清在等人、崩了、从没跑过 | Day 317、326 | `work()` 开头那个 if 和 `None if snap.next` |
| `stream_mode="updates"` + `version="v2"` | Day 323 | `work()` 的 for 循环 |
| interrupt + `Command(resume=...)` | Day 319 | `review()`、`inbox()` |
| HumanInterrupt 结构、按条目 config 判断 | Day 327 | `review()` 交出的字典、`inbox()` 的 `allow_` 检查 |
| 动作层 UNIQUE | Day 326 | `title_changes` 主键、`apply()` |

</details>

## 本周错题与坑清单

| 坑 | 真实现象 | 哪天 | 怎么避 |
| --- | --- | --- | --- |
| 以为时间旅行能撤销写过的库 | 批准后 fork 改金额再批,同一张发票退了两次,共 3588 元 | 322 | 写库节点自己做幂等检查 |
| 按「从新到旧第一张」找回退点 | 分叉过一次后选中的是分叉线上的快照 | 322 | 按 checkpoint_id 精确指定 |
| messages 模式下打印 `token.content` | 结构化输出时 81 项片段全是空字符串 | 323 | 去 `tool_call_chunks[i]["args"]` 拿 |
| 开多种模式还按一种拆包 | `AttributeError: 'str' object has no attribute 'content'` | 323 | `version="v2"`,按 `part["type"]` 分 |
| 父子状态没有同名字段直接加子图 | 子图收到 `{}`,不报错 | 324 | 包一层函数自己转换 |
| 带审批的子图 `checkpointer=False` | approve 时子图从头重跑,多调一次模型 | 324 | 用默认的 None |
| 普通 INSERT 接重复投递 | `IntegrityError: UNIQUE constraint failed: events.event_id`,入口回 500,上游越试越多 | 325 | `INSERT OR IGNORE` + `rowcount` |
| 定时任务去重键用 UTC 日期 | 北京 7:30 算成前一天,9:00 补跑没被挡 | 325 | 用业务上「一天」的时区 |
| `CREATE TABLE IF NOT EXISTS` 不补列 | `no such column: last_error` | 326 | 运行数据删库;业务数据 `ALTER TABLE` |
| 先 SELECT 再 UPDATE 领任务 | 两个 worker 都领到 `evt_A` | 326 | 一条 `UPDATE ... RETURNING` |
| 只看 `snap.next` 判断在处理 | 失败一次的 T9999 第二次被标成 done | 326 | 看 `interrupts` |
| 时间字符串格式不一致比大小 | `'…T07:00:00' < '… 18:48:01'` 结果是 0 | 326 | 全库一种格式,截止时间在 Python 里算 |
| 拿解析后的 JSON 验签 | 只是空格不同,`401 bad signature` | 326 | `await request.body()` 拿原始字节 |
| 以为改了代码老待办也跟着变 | 昨天的五条只有 accept/ignore | 327 | 按条目 config 判断;要刷新就时间旅行 |
| 同一条规则写在两处 | 收件箱 `KeyError: 'data'` | 327 | 抽成一个函数两边共用 |

## 动手练习

**练习 1:同一个客户,两张一样的申请。** T1008 和 T1039 都是 C005 申请改成「启明科技有限公司」,两张工单、两个事件、两个 thread,三处去重都挡不住。给 `apply` 加一道业务检查:同一个客户已经有一张工单改成了同一个抬头,就不再写,`outcome` 写成 `duplicate_of_工单号`。顺便看看 T1012(登录不了)混进来会怎样。

<details><summary>参考答案</summary>

`apply` 开头加一次查询:

```python
def apply(state: TitleState) -> dict:
    with db() as conn:
        same = conn.execute(
            "SELECT ticket_id FROM title_changes WHERE customer_id = ? AND new_title = ? AND ticket_id != ?",
            (state["customer_id"], state["new_title"], state["ticket_id"]),
        ).fetchone()
        if same:
            return {"outcome": f"duplicate_of_{same['ticket_id']}"}
        cur = conn.execute(
            "INSERT OR IGNORE INTO title_changes VALUES (?, ?, ?, ?)",
            (state["ticket_id"], state["customer_id"], state["new_title"], now()),
        )
    return {"outcome": "changed" if cur.rowcount == 1 else "already_changed"}
```

<div class="line-notes">

- `"SELECT ticket_id FROM title_changes WHERE customer_id = ? AND new_title = ? AND ticket_id != ?",` 同一个客户、同一个新抬头、别的工单。`!=` 排除自己,否则自己重复执行时会被当成「和自己重复」。
- `return {"outcome": f"duplicate_of_{same['ticket_id']}"}` 告诉人是和哪张重复了,方便回复客户「已经在 T1008 里处理过了」。
- `cur = conn.execute(` 查和插在同一个 `with` 里,同一个连接、同一个事务。这里是「先查再写」,Day 325 说过并发时有缝;好在 worker 是串行的,收件箱又是人一条条点,今天够用。要真正挡住并发,就在 `(customer_id, new_title)` 上建唯一索引,让数据库来挡(Day 325 练习 4)。

</div>

```bash
uv run python title_bot.py ingest T1008 T1039 T1012
uv run python title_bot.py work
uv run python title_bot.py list
uv run python title_bot.py accept T1008
uv run python title_bot.py accept T1039
uv run python title_bot.py accept T1012
sqlite3 title_bot.db "select * from title_changes"
```

```text
T1008 新事件
T1039 新事件
T1012 新事件
  T1008 · load 完成
  T1008 · 进收件箱
  T1039 · load 完成
  T1039 · 进收件箱
  T1012 · load 完成
  T1012 · 进收件箱
T1008  C005 申请把发票抬头改成「启明科技有限公司」  可用:accept/edit/ignore
T1039  C005 申请把发票抬头改成「启明科技有限公司」  可用:accept/edit/ignore
T1012  C015 申请把发票抬头改成「(没认出来)」  可用:edit/ignore
T1008 → changed
T1039 → duplicate_of_T1008
T1012 不允许 accept
T1029|C011|知行咨询有限公司|2026-10-22T19:27:03
T1037|C001|星河餐饮管理有限公司|2026-10-22T19:27:05
T1008|C005|启明科技有限公司|2026-10-22T19:27:30
```

T1039 被识别成 T1008 的重复,表里没多一行。T1012 是一张「登录不了」,正则抠不出抬头,所以不许 accept,只能 ignore(我随后 `ignore T1012` 了)。它本来就不该进这个流程:真实系统里 webhook 入口或 worker 要按工单类型分派(Day 327 的 `dispatch`),发票抬头的图只接发票抬头的工单。

这一层叫「业务去重」:事件不同、thread 不同,但在业务上是同一件事。什么算「同一件事」只有业务能定义,框架和数据库帮不了你。

</details>

**练习 2:观察会发生什么。主管改主意了。** T1037 已经按 edit 改成了「星河餐饮管理有限公司」。主管说:「还是按客户原来写的吧。」用 Day 322 的时间旅行把 T1037 倒回 review 之前,这次 accept 原来那个抬头。业务表里的抬头会变回去吗?State 里呢?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/review47/ex_rewind.py
"""练习 2:主管改主意了。把 T1037 倒回审批前,这次 accept 原来那个抬头。业务表会跟着变回去吗?"""
import sqlite3

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.types import Command

from title_bot import CKPT_DB, builder, db, thread_of

with sqlite3.connect(CKPT_DB, check_same_thread=False) as ckpt:
    graph = builder.compile(checkpointer=SqliteSaver(ckpt))
    config = thread_of("T1037")
    target = next(s for s in graph.get_state_history(config) if s.next == ("review",))
    graph.invoke(None, target.config)
    print("重新停在:", graph.get_state(config).next)
    result = graph.invoke(Command(resume={"type": "accept", "args": None}), config)
    print("这次的结果:", result["outcome"], "| State 里的抬头:", result["new_title"])
with db() as conn:
    print("业务表里的抬头:", conn.execute("SELECT new_title FROM title_changes WHERE ticket_id = 'T1037'").fetchone()[0])
```

<div class="line-notes">

- `from title_bot import CKPT_DB, builder, db, thread_of` 直接复用小项目的图和路径。`title_bot.py` 有 main guard,导入时不会执行命令。
- `target = next(s for s in graph.get_state_history(config) if s.next == ("review",))` 找到 load 刚做完、还没审的那张快照(Day 322)。
- `graph.invoke(None, target.config)` 从那里重跑,review 用旧快照里的 State(抬头还是客户原文)生成条目,又停下。
- `result = graph.invoke(Command(resume={"type": "accept", "args": None}), config)` 对最新的这张(分叉线上)accept。
- `print("这次的结果:", result["outcome"], "| State 里的抬头:", result["new_title"])` 看图这边的结果。
- `print("业务表里的抬头:", conn.execute("SELECT new_title FROM title_changes WHERE ticket_id = 'T1037'").fetchone()[0])` 再看业务表。

</div>

```bash
uv run python ex_rewind.py
```

```text
重新停在: ('review',)
这次的结果: already_changed | State 里的抬头: 星河餐饮有限公司
业务表里的抬头: 星河餐饮管理有限公司
```

State 说抬头是「星河餐饮有限公司」,业务表里还是「星河餐饮管理有限公司」,两边对不上了。时间旅行倒回的只是 checkpoint;`apply` 第一次已经写了业务表,第二次被主键挡住,返回 `already_changed`。这正是 Day 322 那个坑的另一面:Day 322 是重复写(退了两次钱),今天因为有幂等保护没重复写,但「改主意」也没生效。

想让改主意真正生效,得写一个明确的「更正」动作(`UPDATE title_changes ...` 或调开票系统的更正接口),作为新的一步走审批,而不是指望回到过去。有副作用的系统里,「撤销」也是一个要审批、要记录的新动作。

</details>

**练习 3:两个 worker 一起跑。** 把默写 1 的思路用到小项目上:清空两个库,入队 T1008、T1019、T1029、T1037、T1039 五张,用两个线程同时跑 `work(graph)`,验证每张工单只进收件箱一次。提示:两个线程各自开 checkpoint 连接、各自编译图。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/review47/ex_two_workers.py
"""练习 3:两个 worker 线程同时跑小项目的 work(),每张工单只能进收件箱一次。"""
import sqlite3
import threading

from langgraph.checkpoint.sqlite import SqliteSaver

import title_bot


def run(name: str) -> None:
    with sqlite3.connect(title_bot.CKPT_DB, check_same_thread=False) as ckpt:
        graph = title_bot.builder.compile(checkpointer=SqliteSaver(ckpt))
        print(name, "开工")
        title_bot.work(graph)


title_bot.EVENTS_DB.unlink(missing_ok=True)
title_bot.CKPT_DB.unlink(missing_ok=True)
with title_bot.db() as conn:
    conn.executescript(title_bot.SCHEMA)
title_bot.ingest(["T1008", "T1019", "T1029", "T1037", "T1039"])
threads = [threading.Thread(target=run, args=(f"worker-{i}",)) for i in (1, 2)]
for t in threads:
    t.start()
for t in threads:
    t.join()
with title_bot.db() as conn:
    print(conn.execute("SELECT status, COUNT(*) FROM events GROUP BY status").fetchall())
```

<div class="line-notes">

- `with sqlite3.connect(title_bot.CKPT_DB, check_same_thread=False) as ckpt:` 每个线程自己的 checkpoint 连接。两个线程共用一个 SQLite 连接在 Python 里会出事,各开各的最省心。
- `title_bot.work(graph)` 直接调小项目里的 worker 循环,队列空了就返回。
- `title_bot.EVENTS_DB.unlink(missing_ok=True)` 清空重来,别影响前面的练习数据(做完这题,前面练习的数据就没了,要再看的话按正文重新跑一遍)。
- `title_bot.ingest(["T1008", "T1019", "T1029", "T1037", "T1039"])` 五张发票抬头工单入队。
- `print(conn.execute("SELECT status, COUNT(*) FROM events GROUP BY status").fetchall())` 最后统计:应该是 5 条 waiting_human。

</div>

```bash
uv run python ex_two_workers.py
```

```text
T1008 新事件
T1019 新事件
T1029 新事件
T1037 新事件
T1039 新事件
worker-1 开工
worker-2 开工
  T1019 · load 完成
  T1008 · load 完成
  T1008 · 进收件箱
  T1019 · 进收件箱
  T1029 · load 完成
  T1029 · 进收件箱
  T1037 · load 完成
  T1037 · 进收件箱
  T1039 · load 完成
  T1039 · 进收件箱
[<sqlite3.Row object at 0x110c868c0>]
```

最后一行打印的是 Row 对象,不是我想要的数。`row_factory = sqlite3.Row` 以后,`fetchall()` 返回的每一行是 Row,直接 print 只显示对象地址。改成 `[tuple(r) for r in ...]`:

```python
    print([tuple(r) for r in conn.execute("SELECT status, COUNT(*) FROM events GROUP BY status")])
```

```text
[('waiting_human', 5)]
```

五张各进收件箱一次,没有一张被处理两遍。开头 T1019 比 T1008 先打出 `load 完成`,说明两个线程确实在同时跑,一个领了 T1008、一个领了 T1019。(两次运行的交错顺序会不一样,最后的统计不变。)

</details>

**验收标准**:合上文章能默写 `claim()` 和 `verify()` 并跑出和文中一样的最后一行;`title_bot.py` 从零跑通,重复投递、第二来源、重复 accept 三种重复都被挡住;能用练习 2 的输出解释「时间旅行收不回副作用」;坑清单里至少说出六条,每条带一个真实现象。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 业务去重 | 事件 id 不同、thread 不同,但在业务上是同一件事(同一个客户同一个申请),要按业务规则判断。练习 1 |
| 零件对照表 | 把小项目每一段对应到它是哪天学的零件,复习时按表回去查 |
| 更正动作 | 有副作用的系统里,「撤销」不能靠时间旅行,要作为一个新的、要审批的动作执行。练习 2 |

本周其他术语都在各天的名词解释里:时间旅行、重放、分叉(Day 322),updates/values/messages、v2 格式(Day 323),子图、子图持久化策略(Day 324),后台 Agent、触发源、去重键(Day 325),幂等、原子领取、死信、HMAC 签名(Day 326),HumanInterrupt、四种处理、通知类待办(Day 327)。

## 常见误区

**默写时只写出「能跑」,没写出「挡重复」。** 默写 1 的 `add_event` 不写 `OR IGNORE` 也能跑,只是第二次 evt_3 会 `IntegrityError`。复习时对照坑清单,每一处去重都要能说出它挡的是什么。

**以为三处去重就够了。** 练习 1 实测,T1008 和 T1039 同一个客户同一个申请,三处全挡不住,要业务规则判断。

**以为时间旅行能让「改主意」生效。** 练习 2 实测,State 回去了,业务表没回去,两边对不上。撤销要写成一个新的动作。

**stream 时找不到「停在了 interrupt」的信号。** `stream` 没有 `invoke` 那样的返回值,`__interrupt__` 出现在 `part["data"]` 的键里,要边遍历边记下来。

**两个线程共用一个 checkpoint 连接。** 练习 3 里每个线程各开各的。SQLite 连接跨线程要 `check_same_thread=False`,多个线程同时用一个连接还会互相打断事务。

**直接 print 一个 `sqlite3.Row`。** 练习 3 实测打出 `<sqlite3.Row object at 0x...>`。要看值就 `tuple(r)` 或 `dict(r)`。

**不是这个流程的工单也进来了。** 练习 1 里 T1012(登录不了)进了发票抬头的收件箱。分派要在入口或 worker 里按类型做。

## 学习资料

### 文档与文章

- [LangGraph · Time travel](https://docs.langchain.com/oss/python/langgraph/use-time-travel):复习 Day 322 和练习 2,看清 replay 和 fork 的区别,10 分钟。
- [LangGraph · Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts):本周用得最多的一页,重点再读「恢复时节点重新执行」,15 分钟。
- [langchain-ai/agent-inbox](https://github.com/langchain-ai/agent-inbox):README 的数据结构定义,默写一遍 HumanInterrupt 和 HumanResponse,5 分钟。
- [Stripe · 签名校验](https://docs.stripe.com/webhooks/signature):对照默写 2 检查有没有漏掉时间戳那一步,10 分钟。
- [SQLite · RETURNING](https://www.sqlite.org/lang_returning.html):对照默写 1,5 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV17UKd6zEgH&autoplay=0&high_quality=1" title="Agent实践——2.9.2 langgraph框架checkpoint，人机协作，时间旅行等问题探究" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>不如语冰 · Agent实践——2.9.2 langgraph框架checkpoint,人机协作,时间旅行等问题探究 · 23 分钟,checkpoint、人机协作、时间旅行放在一起讲,正好把本周前半段和收件箱串起来复习。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV193hyzrEuE&autoplay=0&high_quality=1" title="怎么保证消息的幂等性？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员回家养猪 · 怎么保证消息的幂等性? · 2 分多钟,看完对照坑清单,说出本周三处去重各对应视频里的哪种做法。</figcaption>
</figure>

- 尚硅谷《LangGraph 教程》合集(B 站 BV1z3NY66EY1,132 集):Day 323 推荐过第 107–109 集的流式执行,复习时可以把这几集再快进过一遍。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/egSh4TxS5go" title="Ambient Agents and the New Agent Inbox ft. Harrison Chase" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Sequoia Capital · Ambient Agents and the New Agent Inbox ft. Harrison Chase · 三天的后台 Agent 学完再看一遍,这次留意他讲的每个设计决定在你的代码里落在哪一行。</figcaption>
</figure>

### 书籍

- Gregor Hohpe、Bobby Woolf《Enterprise Integration Patterns》(Addison-Wesley,2003):本周用到的「Idempotent Receiver」「Competing Consumers」「Dead Letter Channel」「Content-Based Router」四个模式,复习日可以把这四节一次读完。英文原版。

### 开源项目与代码

- [langchain-ai/agents-from-scratch](https://github.com/langchain-ai/agents-from-scratch):官方的邮件助手后台 Agent。做完今天的小项目再去读它,看它在哪些地方和你的选择不同。

## 自测

1. 时间旅行在本周后台 Agent 里用到了哪两处?

<details><summary>答案</summary>

一处是 Day 327 练习 3:用 `get_state_history` 找到「下一步是 review」的快照,`invoke(None, 旧config)` 重跑 review,把旧版本代码生成的待办刷新成新规则。另一处是 worker 续跑崩了的 thread:`invoke(None, config)` 从 checkpoint 停的地方接着跑,和重放是同一个机制,只是从最新快照开始。

</details>

2. 小项目的 worker 为什么能用 `stream` 代替 `invoke`?换了以后要多处理什么?

<details><summary>答案</summary>

`stream` 和 `invoke` 执行的是同样的图,只是边跑边吐每一步的结果,不会让图更快也不会改变行为(Day 323)。换了以后没有一个最终返回值可以查 `"__interrupt__" in result`,要在遍历 `part["data"]` 时自己记下有没有见过 `__interrupt__` 这个键。

</details>

3. 默写 1 的 `claim()` 写成先 `SELECT` 再 `UPDATE` 会怎样?Postgres 上对应的写法是什么?

<details><summary>答案</summary>

两个 worker 可能同时查到同一行,各自改状态再各自处理,同一个事件处理两遍(Day 326 `claim_race.py` 实测两个都领到 `evt_A`)。一条 `UPDATE ... WHERE event_id = (SELECT ... LIMIT 1) RETURNING` 让挑和改在一条语句里完成。Postgres 上用 `SELECT ... FOR UPDATE SKIP LOCKED`。

</details>

4. 练习 2 里为什么 State 和业务表对不上?怎样才能让「改主意」真正生效?

<details><summary>答案</summary>

时间旅行只倒回 checkpoint 里的状态。`apply` 第一次已经把「星河餐饮管理有限公司」写进了业务表,第二次执行被主键挡住(`already_changed`),所以 State 里是客户原文,业务表里还是改过的版本。要生效,得把「更正」写成一个新的动作(更新业务表或调更正接口),也走审批、也记日志。

</details>

5. **面试题**:「你做的后台 Agent,同一张工单有没有可能被处理两次?从入口到发送,逐层说说。」

<details><summary>答案</summary>

参考要点:入口层,上游重试同一事件,事件 id 做主键 `INSERT OR IGNORE`,重复回 2xx 不入队;领取层,多个 worker 或重叠的 cron,原子领取(`UPDATE ... RETURNING` / `FOR UPDATE SKIP LOCKED`);业务层,不同来源不同事件 id 指向同一工单,thread_id 用工单号,处理前 `get_state` 看是否已在收件箱或已完成;动作层,发送或改数据在「做了但没来得及标完成」时崩溃,outbox 或业务表的唯一约束、调第三方时带幂等键。再往上还有业务去重:不同工单、同一个客户同一个诉求,只能按业务规则判断。最后补一句:至少投递一次 + 每层幂等 = 效果上恰好一次;时间旅行和重放不能当撤销用,撤销是新的动作。

</details>

6. Day 324 的子图和 Day 327 worker 里的 `dispatch` 有什么相同的思路?

<details><summary>答案</summary>

都是「先判断类型,再交给专门的一段流程」。Day 324 的路由图按工单标题分类,退款类进退款子图,其他转人工;`dispatch` 按事件的 `kind` 把 `ticket.created` 交给工单图、`digest.stale_tickets` 交给通知图,没有处理器的直接死信。区别是子图在一张图里、共用一个 thread,`dispatch` 是在图外面挑图,每张图有自己的 thread。

</details>

## 明天预告

下周从 [Day 329 · 多 Agent(一):两篇吵架的文章,多 Agent 带来什么](/blog/agent-zero/day-329-multi-agent-1/) 开始。这一周我们的系统里只有一个 Agent,按事件一件件处理;下周要问的是另一件事:一个任务交给好几个 Agent 分工,到底是变强了还是变乱了。先从业界两篇观点相反的文章读起,再动手搭主管派活和专员交接两种拓扑。
