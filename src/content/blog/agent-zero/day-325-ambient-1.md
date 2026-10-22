---
title: 'Day 325 · 后台 Agent(一):聊天窗口之外,三种触发源,事件表'
description: '到昨天为止,Agent 都是有人敲命令才动。真实的客服系统里,新工单的 webhook、客服邮箱的新邮件、每天早上的定时扫描都该把 Agent 叫起来,这就是后台 Agent。今天先不碰模型,只做两件事:看清 webhook、邮件、定时任务三种触发源各自的脾气,然后建一张事件表,让三种来源都先落成一行,用主键加 INSERT OR IGNORE 挡住重复投递。'
pubDate: 2026-10-22
regime: none
tags: ['ambient-agent', 'webhook', 'sqlite', 'agent-zero']
series: 'agent-zero'
day: 325
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 324](/blog/agent-zero/day-324-lg-subgraph/) 把 Day 320 的退款审批装进了一个先分类再路由的主图 `router.py`,退款类进子图,其他转人工。最后那节「放到真实系统里」画了一张图:工单进来就调图,停在审批点写一行待审批表,主管点按钮再恢复。练习 4 还用 `UPDATE ... WHERE status='pending'` 挡住了两个主管同时批。

那张图里有个问题我们一直绕着走:**工单是怎么进来的?** 到目前为止都是你在终端里敲 `start T1041`。可真实的客服系统里,没有人坐在 Agent 对面替它敲命令。客户在网页上提交了工单,工单系统要通知我们;客户直接往客服邮箱发了一封信,我们得自己去收;还有一类事根本没人触发,比如「每天早上看看哪些工单开了二十多天还没人管」。今天开始的三天,就是让 Agent 被这些事件叫醒。

## 今天要解决的问题

学完今天,你要能做到:

1. 说清「后台 Agent」和聊天式 Agent 的区别,以及后台 Agent 找人的三种方式(通知、提问、审核)。
2. 说出 webhook、邮件轮询、定时任务三种触发源各自的特点,尤其是它们**为什么都会重复**,以及各自该拿什么当去重键。
3. 建一张事件表 `events`,用主键加 `INSERT OR IGNORE` 让同一件事投递多少次都只留一行,并能解释 `rowcount` 为什么能告诉你「这是不是新事件」。

预计用时 2 小时。前置:[Day 61](/blog/agent-zero/day-061-http-3/) 的请求体和 JSON,[Day 85](/blog/agent-zero/day-085-sql-1/) 起的 SQL,特别是 [Day 91](/blog/agent-zero/day-091-sql-6/) 的主键和约束、[Day 93](/blog/agent-zero/day-093-python-sqlite-2/) 的 `row_factory` 和 `with`;CloudLedger 的 `cloudledger.db`(Day 280 建的)。今天一行模型都不调,花费 0 元。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `store.py` 的建表语句和 `add_event` 默写出来;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 聊天窗口之外的 Agent

先把「后台 Agent」和我们之前做的东西分清楚。区别不在模型,也不在图怎么画,而在**谁启动一次运行、结果交给谁**。

聊天式 Agent 是同步的:人发起,人等着,结果直接回给这个人。一次运行几秒到几十秒,出错了人看到报错会自己重试。Day 323 做的流式输出,就是为了让这个「等着的人」不那么难受。

后台 Agent 是异步的:启动它的是一个事件,一条 webhook、一封邮件、一个时间点;没有人在等它。它的产出也不一定直接给客户,更多时候是给内部的人一条待办。LangChain 在 2025 年 1 月给这类东西起了个名字,叫 ambient agent(可以翻成「后台智能体」或「环境智能体」):由环境里的事件触发,在后台持续运行,只在需要人的时候才打扰人。

前端同学可以这么对照:聊天式 Agent 像一个按钮的 `onClick`,用户点了,你处理,你返回;后台 Agent 像 Service Worker 收到的 `push` 事件,页面可能都没打开,事情照样要处理,处理完弹个通知。

后台 Agent 什么时候需要人?LangChain 那篇介绍文章分了三种,我觉得很实用:

- **通知**:告诉人发生了一件事,Agent 自己不处理。比如「这张工单里提到了律师函,我没动它,你看一下」。
- **提问**:Agent 卡住了,要一个它自己查不到的信息。比如「客户说的『上次那张发票』是哪张?系统里有三张候选」。
- **审核**:Agent 准备做一件有后果的事,先给人看。Day 320 的退款审批就是这一种。

为什么不让 Agent 把事情直接做完?因为你还没有足够的证据证明它可靠。第六部分会讲评测,即使评测分数不错,对客户发出去的每一个字、退出去的每一分钱都代表公司。所以后台 Agent 常见的形态是:事件来了,Agent 把能做的先做了(读工单、查发票、起草方案),停在需要人拍板的那一步,等人有空时一条条处理。Day 327 会把这些待办做成一个「收件箱」。

<figure>
<svg viewBox="0 0 640 240" role="img" aria-label="后台 Agent 整体链路:webhook、邮件轮询、定时任务三个触发源都写进 events 表;之后由 worker 领事件运行 LangGraph 图,图停在审批点进入收件箱。今天只做左半边">
  <rect x="0" y="0" width="640" height="240" fill="var(--paper-raised)"/>
  <rect x="8" y="14" width="290" height="176" rx="6" fill="none" stroke="var(--compute)" stroke-dasharray="4 3"/>
  <g font-family="var(--font-mono)" font-size="12" text-anchor="middle">
    <rect x="20" y="34" width="110" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="75" y="55" fill="var(--ink)">webhook</text>
    <rect x="20" y="84" width="110" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="75" y="105" fill="var(--ink)">邮件轮询</text>
    <rect x="20" y="134" width="110" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="75" y="155" fill="var(--ink)">定时任务</text>
    <rect x="170" y="74" width="114" height="54" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
    <text x="227" y="97" fill="var(--ink)">events 表</text>
    <text x="227" y="115" font-size="10" fill="var(--ink-soft)">主键去重 · 状态</text>
    <rect x="330" y="74" width="90" height="54" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)"/>
    <text x="375" y="97" fill="var(--ink-soft)">worker</text>
    <text x="375" y="115" font-size="10" fill="var(--ink-faint)">Day 326</text>
    <rect x="452" y="66" width="172" height="70" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="538" y="90" fill="var(--ink)">LangGraph 图</text>
    <text x="538" y="110" font-size="11" fill="var(--ink-soft)">停在审批点</text>
    <text x="538" y="126" font-size="10" fill="var(--ink-faint)">Day 326</text>
    <rect x="490" y="166" width="96" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)"/>
    <text x="538" y="187" fill="var(--ink-soft)">收件箱</text>
  </g>
  <g stroke="var(--ink-soft)" fill="none">
    <line x1="130" y1="51" x2="170" y2="88"/><line x1="130" y1="101" x2="170" y2="101"/><line x1="130" y1="151" x2="170" y2="114"/>
    <line x1="284" y1="101" x2="330" y2="101"/><line x1="420" y1="101" x2="452" y2="101"/><line x1="538" y1="136" x2="538" y2="166"/>
  </g>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">
    <text x="20" y="208">虚线框里是今天的范围:三种来源 → 一张表</text>
    <text x="440" y="222">Day 327:人在这里处理</text>
    <text x="20" y="228">琥珀色 = 外部系统,蓝色 = 调模型的部分</text>
  </g>
</svg>
<figcaption>后台 Agent 的整条链路分三天做。今天只做左边:三种触发源都只负责往事件表里写一行,后面的处理统一交给 worker。</figcaption>
</figure>

今天的两个新概念就在这张图的左半边:

- **触发源**:把 Agent 叫醒的东西。今天讲三种,webhook、邮件轮询、定时任务。
- **事件表和去重**:所有触发源都先变成 `events` 表里的一行,用一个去重键做主键,同一件事来几次都只留一行。

## 三种触发源

先用一个不连任何真系统的小脚本,看看三种来源送来的东西各长什么样。数据都是模拟的。

```python
# agent-zero-lab/part05/ambient/sources.py
"""三种触发源各自送来的东西长什么样。这里全是模拟数据,不连真的工单系统和邮箱。"""
import json
from datetime import date


def webhook_body() -> str:
    """工单系统 POST 过来的请求体(原始字符串)。"""
    return json.dumps({
        "id": "evt_8f2c41",
        "type": "ticket.created",
        "created": "2026-10-12T09:15:03+08:00",
        "data": {"ticket_id": "T1041", "customer_id": "C007", "subject": "重复扣款"},
    }, ensure_ascii=False)


def poll_mailbox() -> list[dict]:
    """每分钟连一次客服邮箱,取回的未读邮件。"""
    return [
        {"message_id": "<CAF7x2@mail.example.com>", "from": "c012@example.com",
         "subject": "发票抬头写错了", "body": "麻烦把抬头改成 XX 科技有限公司"},
        {"message_id": "<CAF9k1@mail.example.com>", "from": "c019@example.com",
         "subject": "登录不了", "body": "一直提示密码错误"},
    ]


def cron_tick(today: date) -> dict:
    """每天 9 点的定时任务:扫一遍超过 20 天还没关的工单。"""
    return {"job": "stale_tickets", "run_date": today.isoformat(), "older_than_days": 20}


if __name__ == "__main__":
    body = webhook_body()
    print("webhook:", body)
    print("  事件 id:", json.loads(body)["id"])
    for mail in poll_mailbox():
        print("email:", mail["message_id"], mail["subject"])
    print("cron:", cron_tick(date(2026, 10, 22)))
```

<div class="line-notes">

- `def webhook_body() -> str:` webhook 送来的是一个 HTTP 请求,今天先只看它的请求体,返回的是**原始字符串**而不是字典。Day 326 写验签时你会知道为什么原始字符串很重要。
- `"id": "evt_8f2c41",` 上游给每个事件的唯一 id。Stripe、GitHub 这类系统的 webhook 都带这样一个 id,同一个事件重发多少次,id 都不变。这是 webhook 天然的去重键。
- `"type": "ticket.created",` 事件类型,一个 URL 往往会收到好几种事件。
- `"created": "2026-10-12T09:15:03+08:00",` 事件发生的时间,带时区。
- `"data": {"ticket_id": "T1041", "customer_id": "C007", "subject": "重复扣款"},` 业务数据。这里用了 CloudLedger 里真实存在的 T1041,就是 Day 320 那张重复扣款的工单。
- `}, ensure_ascii=False)` 中文原样输出,不转成 `\u` 转义,Day 39 讲过。
- `def poll_mailbox() -> list[dict]:` 邮件是我们自己去拉的,每次拉回一批。真实代码会用标准库 `imaplib` 连邮箱,今天用写死的列表代替。
- `{"message_id": "<CAF7x2@mail.example.com>", "from": "c012@example.com",` `message_id` 是每封邮件头里的 `Message-ID`,由发信方的邮件系统生成,全球唯一。这是邮件的去重键。
- `def cron_tick(today: date) -> dict:` 定时任务没有外部输入,只有「现在几点」。`date` 是 Python 的日期类型,相当于只有年月日的 `Date`。
- `return {"job": "stale_tickets", "run_date": today.isoformat(), "older_than_days": 20}` 告诉后面要干什么、是哪一天的这一次。`isoformat()` 把日期变成 `"2026-10-22"`。
- `print("  事件 id:", json.loads(body)["id"])` 收到原始字符串,`json.loads` 解析成字典再取 id,相当于 `JSON.parse(body).id`。
- `print("cron:", cron_tick(date(2026, 10, 22)))` 写死今天的日期,方便你和文章对输出。

</div>

```bash
cd agent-zero-lab/part05
mkdir -p ambient && cd ambient
uv run python sources.py
```

```text
webhook: {"id": "evt_8f2c41", "type": "ticket.created", "created": "2026-10-12T09:15:03+08:00", "data": {"ticket_id": "T1041", "customer_id": "C007", "subject": "重复扣款"}}
  事件 id: evt_8f2c41
email: <CAF7x2@mail.example.com> 发票抬头写错了
email: <CAF9k1@mail.example.com> 登录不了
cron: {'job': 'stale_tickets', 'run_date': '2026-10-22', 'older_than_days': 20}
```

三样东西形状完全不同。下面一种种说它们的脾气。

### webhook:别人推给你

**webhook** 是对方系统主动推给你:工单系统新建了一张单,就往你事先配置好的 URL 发一个 POST 请求,请求体是一段 JSON。说白了就是「反过来的 fetch」:平时是你的前端 `fetch` 别人的接口,webhook 是别人的服务器 `fetch` 你的接口。

好处是实时。坏处有三条,几乎所有 webhook 文档(Stripe、GitHub、飞书、企业微信)翻来覆去讲的都是这三条:

1. **对方不会等你太久**。一般几秒到几十秒没收到 2xx 就算失败。如果你收到请求后先调模型、查库、起草方案,十几秒才返回,对方早就判你超时了。
2. **超时或失败就重试**。重试意味着同一个事件会到你这里两次、三次。更麻烦的是,有时你其实处理成功了,只是回复在网络上丢了,对方照样会重发。
3. **谁都能往你的 URL 发请求**。URL 泄露了,别人就能伪造一个「新工单」事件。所以要验签,Day 326 做。

第 2 条是今天的重点:**webhook 天生会重复**,这不是对方的 bug,是这类协议的设计。专业的说法叫「至少投递一次」(at-least-once):保证你至少收到一次,不保证只收到一次。[Day 390](/blog/agent-zero/day-390-idempotency/) 会把这件事讲透,今天先记住结论:收的一方必须自己去重,去重靠上游给的事件 id。

### 邮件:你去拉

**邮件** 一般是你主动去拉:每分钟连一次客服邮箱,用 IMAP 协议把未读邮件取回来。好处是不需要一个公网能访问的地址,邮箱本身就是一个不会丢东西的队列;坏处是有延迟(最多一个轮询间隔),而且邮件格式五花八门,HTML、附件、转发链、各种编码。

拉取也会重复。最常见的情况:你拉到了邮件,还没来得及把它标成已读,程序崩了;重启后再拉一次,同一批邮件又回来了。所以邮件也要去重,去重键是每封邮件头里的 `Message-ID`。

邮件量大的话,也可以用 Postmark、Cloudflare Email Workers 这类服务把收到的邮件转成 webhook 推给你,这样邮件就和第一种合并了。

### 定时任务:你给自己定的闹钟

**定时任务**(常叫 cron,来自 Linux 里那个按时间表执行命令的老工具)是你给自己定的闹钟:每天早上 9 点扫一遍超过 20 天还开着的工单,每周一生成上周的处理报告。前端类比是 `setInterval`,区别是它跑在服务器上,进程重启了闹钟也还在。

它没有外部输入,但同样会重复:机器重启后调度器补跑了一次;你上线新代码时手动跑了一次验证;部署了两台机器,两台都定了 9 点。结果同一张超期工单被提醒了两遍。定时任务没有上游给的 id,去重键得自己造。最自然的是「任务名 + 这是哪一天的那一次」,比如 `stale_tickets:2026-10-22`。同一天跑几次,键都一样。

### 为什么要先写进一张表

三种来源差别很大,但我建议**所有来源都先变成事件表里的一行**,再由同一个 worker 统一处理。理由有三个:

第一,webhook 入口只要做验签和写表,几毫秒就能回复对方,不会因为模型慢让上游超时重试。

第二,去重、重试、失败记录这些逻辑只写一遍,不用三种来源各写一套。

第三,出了问题只看一张表:哪些事件还没处理,哪些在等人,哪些失败了。

这其实就是一个任务队列,第七部分 [Day 387](/blog/agent-zero/day-387-queue-basics/) 会专门讲队列。今天为了不多装东西,直接用 SQLite 当队列。量上来以后换成 Redis、RabbitMQ 或者云厂商的队列服务,结构不用变。

## 第 1 步:先建表,看重复投递怎么炸

先写最朴素的版本:建一张 `events` 表,`event_id` 做主键,然后模拟 webhook 投递同一个事件两次。

```python
# agent-zero-lab/part05/ambient/store_v1.py
import sqlite3
from pathlib import Path

EVENTS_DB = Path(__file__).with_name("ambient.db")

conn = sqlite3.connect(EVENTS_DB)
conn.execute(
    "CREATE TABLE IF NOT EXISTS events ("
    " event_id TEXT PRIMARY KEY, source TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL)"
)
for attempt in (1, 2):
    print("第", attempt, "次投递")
    conn.execute(
        "INSERT INTO events (event_id, source, kind, payload) VALUES (?, ?, ?, ?)",
        ("evt_8f2c41", "webhook", "ticket.created", "{...}"),
    )
    conn.commit()
```

<div class="line-notes">

- `EVENTS_DB = Path(__file__).with_name("ambient.db")` 事件库放在脚本旁边。它和 CloudLedger 的业务库分开:业务库是公司的数据,事件库是我们这个 Agent 服务的运行数据,事件库删了重来不心疼,业务库不行。
- `conn = sqlite3.connect(EVENTS_DB)` 打开(没有就新建)这个库文件。
- `" event_id TEXT PRIMARY KEY, source TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL)"` 四列。`event_id` 是主键,Day 91 讲过,主键的值不能重复,数据库会替你守着。两个字符串挨着写,Python 会自动拼成一个,相当于 JS 里用 `+` 连起来。
- `for attempt in (1, 2):` 模拟同一个事件投递两次,比如第一次我们回复慢了,对方重试。
- `"INSERT INTO events (event_id, source, kind, payload) VALUES (?, ?, ?, ?)",` 普通的 INSERT,Day 86 的写法,参数用 `?` 占位。
- `("evt_8f2c41", "webhook", "ticket.created", "{...}"),` 两次都是同一个事件 id。payload 先随便写。
- `conn.commit()` 提交。不 commit 的话关掉连接写进去的东西就没了,Day 93 讲过。

</div>

```bash
rm -f ambient.db
uv run python store_v1.py
```

```text
第 1 次投递
第 2 次投递
Traceback (most recent call last):
  File ".../part05/ambient/store_v1.py", line 14, in <module>
    conn.execute(
    ~~~~~~~~~~~~^
        "INSERT INTO events (event_id, source, kind, payload) VALUES (?, ?, ?, ?)",
    ...
sqlite3.IntegrityError: UNIQUE constraint failed: events.event_id
```

(路径前面那串我删了;我这台机器上 uv 装的是 Python 3.14,报错下面那排 `~~~^` 是新版本 Python 指出出错位置的方式。)

第二次插入时主键冲突,数据库拒绝了,报 `IntegrityError: UNIQUE constraint failed: events.event_id`。数据库**确实**替我们挡住了重复,这是好事,表里只有一行。问题在于程序炸了。如果这是 webhook 入口,炸了就会给对方回一个 500;对方看到 500,认为你没收到,**再重试**;下一次又是 500……一个重复事件变成了无穷无尽的重试。

我们要的效果是:重复的事件安静地跳过,并且告诉调用方「这个我收过了」,入口照常返回成功。

## 第 2 步:INSERT OR IGNORE 和 rowcount

SQLite 有一个写法专门干这个:`INSERT OR IGNORE`。插入时如果违反了唯一约束(包括主键),就当这条语句什么都没做,不报错。怎么知道它到底插进去没有?看 `cursor.rowcount`:这条语句改了几行,插进去了是 1,被忽略了是 0。

把它整理成一个正式的模块 `store.py`,后两天的 webhook 入口和 worker 都会导入它。表也补全成 Day 326 要用的样子。

```python
# agent-zero-lab/part05/ambient/store.py
"""事件表:webhook、邮件、定时任务进来的东西都先落到这里,再由 worker 慢慢处理(worker 是 Day 326 的事)。"""
import sqlite3
from datetime import datetime
from pathlib import Path

EVENTS_DB = Path(__file__).with_name("ambient.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    event_id     TEXT PRIMARY KEY,                 -- 去重键,同一件事永远是同一个值
    source       TEXT NOT NULL,                    -- webhook / email / cron
    kind         TEXT NOT NULL,                    -- ticket.created / email.received / digest.stale_tickets
    payload      TEXT NOT NULL,                    -- 原始内容,JSON 字符串
    status       TEXT NOT NULL DEFAULT 'pending',  -- pending / processing / waiting_human / done / dead
    attempts     INTEGER NOT NULL DEFAULT 0,       -- 被处理过几次,Day 326 的 worker 用
    received_at  TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
"""


def now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(EVENTS_DB, timeout=10)
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


if __name__ == "__main__":
    init()
    for attempt in (1, 2, 3):
        print("第", attempt, "次投递 evt_8f2c41 →", add_event("evt_8f2c41", "webhook", "ticket.created", "{...}"))
    with connect() as conn:
        for row in conn.execute("SELECT event_id, source, status, attempts, received_at FROM events"):
            print(dict(row))
```

<div class="line-notes">

- `SCHEMA = """` 三个引号的字符串可以跨多行,相当于 JS 的模板字符串(反引号),只是不能插值。建表语句放成模块级常量,一眼能看全。
- `event_id     TEXT PRIMARY KEY,                 -- 去重键,同一件事永远是同一个值` 去重的全部机制就是这一行。`--` 是 SQL 的注释,相当于 JS 的 `//`。
- `source       TEXT NOT NULL,                    -- webhook / email / cron` 从哪来的。出问题时按来源统计很有用。
- `kind         TEXT NOT NULL,                    -- ticket.created / email.received / digest.stale_tickets` 是什么事。worker 按它决定交给哪张图。
- `payload      TEXT NOT NULL,                    -- 原始内容,JSON 字符串` 原样存下来。SQLite 没有专门的 JSON 列类型,存文本就行,需要时用 `json_extract` 查。
- `status       TEXT NOT NULL DEFAULT 'pending',  -- pending / processing / waiting_human / done / dead` 处理到哪了。`DEFAULT 'pending'` 表示插入时不写这一列就是 pending。五个状态今天只用到 pending,剩下的 Day 326、327 一个个用上。
- `attempts     INTEGER NOT NULL DEFAULT 0,       -- 被处理过几次,Day 326 的 worker 用` 先占个位置,明天的 worker 失败重试要用。
- `received_at  TEXT NOT NULL,` 收到的时间。SQLite 也没有日期类型,存 ISO 格式的字符串,按字符串排序刚好就是按时间排序。
- `return datetime.now().isoformat(timespec="seconds")` 本地时间,精确到秒,实跑是 `2026-10-22T13:43:47` 这种格式。和 Day 320 写退款记录用的是同一种写法。
- `conn = sqlite3.connect(EVENTS_DB, timeout=10)` 明天 webhook 入口和 worker 是两个进程,会同时写这个库。SQLite 同一时刻只允许一个写者,另一个要排队等锁,`timeout=10` 让它最多等 10 秒(默认 5 秒),等不到才报 `database is locked`。
- `conn.row_factory = sqlite3.Row` 让查出来的每一行能用列名取值,`dict(row)` 还能直接转成字典,Day 93 学过。
- `conn.executescript(SCHEMA)` 一次执行一整段 SQL(可以有多条语句)。`IF NOT EXISTS` 让它可以反复调用,每个脚本开头 `init()` 一下也没关系。
- `with connect() as conn:` sqlite3 的连接用在 `with` 里,块正常结束会自动 commit,出异常会自动 rollback。注意它**不会**自动关闭连接,这个小脚本不在乎,Day 93 讲过区别。
- `"INSERT OR IGNORE INTO events (event_id, source, kind, payload, received_at, updated_at) "` 只比第 1 步多了 `OR IGNORE` 两个词。违反主键约束时不报错,这条语句直接作废。`status` 和 `attempts` 没写,用默认值。
- `(event_id, source, kind, payload, now(), now()),` 六个 `?` 对六个值。收到时间和更新时间一开始相同。
- `return cur.rowcount == 1` `rowcount` 是这条语句影响的行数,插进去了是 1,被忽略了是 0。返回布尔值,调用方一看就知道是不是新事件。
- `for attempt in (1, 2, 3):` 同一个事件投递三次。
- `print("第", attempt, "次投递 evt_8f2c41 →", add_event("evt_8f2c41", "webhook", "ticket.created", "{...}"))` 打出每次是不是新事件。
- `for row in conn.execute("SELECT event_id, source, status, attempts, received_at FROM events"):` 看看表里最后有几行。`conn.execute` 返回的游标可以直接 for 遍历。
- `print(dict(row))` 每行转成字典打印。

</div>

```bash
rm -f ambient.db
uv run python store.py
```

```text
第 1 次投递 evt_8f2c41 → True
第 2 次投递 evt_8f2c41 → False
第 3 次投递 evt_8f2c41 → False
{'event_id': 'evt_8f2c41', 'source': 'webhook', 'status': 'pending', 'attempts': 0, 'received_at': '2026-10-22T13:43:47'}
```

第一次 True,后两次 False,不报错,表里只有一行,`status` 和 `attempts` 用了默认值。明天的 webhook 入口拿到 False 时,照样给对方回 200,顺便在响应里说一句「duplicate」,方便对方排查;它绝不能回错误码,否则对方会继续重试。

为什么不是「先 SELECT 查一下有没有,没有再 INSERT」?两个原因。一是多一次查询;二是 Day 322 练习 2 末尾说过的那个问题:两个请求同时到,都先查到「没有」,然后都插入,重复就漏过去了。`INSERT OR IGNORE` 是一条语句,查和插在数据库内部一次完成,中间没有缝。去重这件事交给主键约束,比自己在代码里判断可靠得多。

还有一个细节:`OR IGNORE` 忽略的是**所有**唯一约束和 NOT NULL 之类的冲突,不只是主键。所以表上的约束要想清楚再加,不然别的约束冲突也会被它悄悄吞掉,你还以为是重复事件。这张表只有主键一个唯一约束,没问题。SQLite 还有一个更精确的写法 `INSERT ... ON CONFLICT(event_id) DO NOTHING`,只针对指定的列,效果在这里一样,写 Postgres 时用的也是这种写法。

## 第 3 步:三种来源,同一张表

现在把三种来源都接到事件表上。关键是给每种来源造去重键:

| 来源 | 去重键怎么造 | 例子 |
| --- | --- | --- |
| webhook | `webhook:` + 上游给的事件 id | `webhook:evt_8f2c41` |
| 邮件 | `email:` + 邮件头的 Message-ID | `email:<CAF7x2@mail.example.com>` |
| 定时任务 | `cron:` + 任务名 + 运行日期 | `cron:stale_tickets:2026-10-22` |

前面加来源前缀,是为了万一两种来源的 id 碰巧一样也不会互相吞掉。定时任务的 payload 里顺便把超期工单的编号查出来带上,worker 拿到就能直接用。

```python
# agent-zero-lab/part05/ambient/ingest.py
"""把三种触发源都变成事件表里的一行。跑两遍模拟「上游重试、邮箱又拉一次、定时任务补跑」。"""
import json
import sqlite3
import sys
from datetime import date, timedelta
from pathlib import Path

from sources import cron_tick, poll_mailbox, webhook_body
from store import add_event, connect, init

BIZ_DB = Path(__file__).parents[2] / "cloudledger" / "cloudledger.db"


def from_webhook(body: str) -> bool:
    event = json.loads(body)
    return add_event(f"webhook:{event['id']}", "webhook", event["type"], body)


def from_email(mail: dict) -> bool:
    return add_event(f"email:{mail['message_id']}", "email", "email.received", json.dumps(mail, ensure_ascii=False))


def from_cron(today: date) -> bool:
    tick = cron_tick(today)
    cutoff = (today - timedelta(days=tick["older_than_days"])).isoformat()
    with sqlite3.connect(BIZ_DB) as conn:
        ids = [r[0] for r in conn.execute(
            "SELECT id FROM tickets WHERE status = 'open' AND created_at <= ? ORDER BY created_at, id", (cutoff,)
        )]
    payload = json.dumps({**tick, "ticket_ids": ids}, ensure_ascii=False)
    return add_event(f"cron:{tick['job']}:{tick['run_date']}", "cron", "digest.stale_tickets", payload)


if __name__ == "__main__":
    init()
    today = date.fromisoformat(sys.argv[1])
    print("webhook 新事件?", from_webhook(webhook_body()))
    for mail in poll_mailbox():
        print("email 新事件?", from_email(mail))
    print("cron 新事件?", from_cron(today))
    with connect() as conn:
        rows = conn.execute("SELECT source, status, COUNT(*) AS n FROM events GROUP BY source, status").fetchall()
        print("事件表:", [dict(r) for r in rows])
```

<div class="line-notes">

- `from sources import cron_tick, poll_mailbox, webhook_body` 上面写的三个模拟来源。
- `from store import add_event, connect, init` 第 2 步的事件表模块。
- `BIZ_DB = Path(__file__).parents[2] / "cloudledger" / "cloudledger.db"` `parents[0]` 是 `ambient` 目录,`parents[1]` 是 `part05`,`parents[2]` 是 `agent-zero-lab`,拼起来就是 CloudLedger 的业务库。和 Day 320 的 `BIZ_DB` 指向同一个文件。
- `event = json.loads(body)` webhook 的原始字符串解析成字典,只为了取 id 和 type;存进表的还是原始字符串 `body`。
- `return add_event(f"webhook:{event['id']}", "webhook", event["type"], body)` 去重键 `webhook:evt_8f2c41`。kind 直接用上游的事件类型。
- `return add_event(f"email:{mail['message_id']}", "email", "email.received", json.dumps(mail, ensure_ascii=False))` 邮件的去重键用 Message-ID。邮件本身是字典,转成 JSON 字符串再存。
- `tick = cron_tick(today)` 拿到这一次定时任务的描述。
- `cutoff = (today - timedelta(days=tick["older_than_days"])).isoformat()` `timedelta` 是一段时间长度,日期减 20 天得到截止日期。今天 10-22,截止是 `2026-10-02`。JS 里要自己算毫秒,Python 直接相减。
- `with sqlite3.connect(BIZ_DB) as conn:` 定时任务要查业务库,这里只读。
- `ids = [r[0] for r in conn.execute(` 列表推导式,把查出来每行的第一列(工单号)收进列表。没设 `row_factory`,每行是元组,`r[0]` 取第一个元素。
- `"SELECT id FROM tickets WHERE status = 'open' AND created_at <= ? ORDER BY created_at, id", (cutoff,)` 开着的、创建日期在截止日期之前的工单。日期是 `YYYY-MM-DD` 字符串,直接比大小就是比先后。
- `payload = json.dumps({**tick, "ticket_ids": ids}, ensure_ascii=False)` 把任务描述和查到的工单号合成一个字典再转 JSON。`{**tick, ...}` 就是 JS 的 `{...tick, ticket_ids: ids}`。
- `return add_event(f"cron:{tick['job']}:{tick['run_date']}", "cron", "digest.stale_tickets", payload)` 去重键 `cron:stale_tickets:2026-10-22`。同一天再跑,键一样,被忽略。
- `today = date.fromisoformat(sys.argv[1])` 日期从命令行传进来,方便模拟「同一天再跑」和「第二天跑」。`fromisoformat` 把 `"2026-10-22"` 变成日期对象。
- `rows = conn.execute("SELECT source, status, COUNT(*) AS n FROM events GROUP BY source, status").fetchall()` 按来源和状态统计,Day 88 的 GROUP BY。这条查询以后天天要用,它就是这个后台服务的「仪表盘」。
- `print("事件表:", [dict(r) for r in rows])` 每行转成字典打出来。

</div>

先 seed 一下业务库(保证工单数据是原样的),然后同一天跑两次,再换到第二天跑一次:

```bash
cd agent-zero-lab && uv run python cloudledger/seed.py && cd part05/ambient
rm -f ambient.db
uv run python ingest.py 2026-10-22
uv run python ingest.py 2026-10-22
uv run python ingest.py 2026-10-23
```

```text
已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}
webhook 新事件? True
email 新事件? True
email 新事件? True
cron 新事件? True
事件表: [{'source': 'cron', 'status': 'pending', 'n': 1}, {'source': 'email', 'status': 'pending', 'n': 2}, {'source': 'webhook', 'status': 'pending', 'n': 1}]
webhook 新事件? False
email 新事件? False
email 新事件? False
cron 新事件? False
事件表: [{'source': 'cron', 'status': 'pending', 'n': 1}, {'source': 'email', 'status': 'pending', 'n': 2}, {'source': 'webhook', 'status': 'pending', 'n': 1}]
webhook 新事件? False
email 新事件? False
email 新事件? False
cron 新事件? True
事件表: [{'source': 'cron', 'status': 'pending', 'n': 2}, {'source': 'email', 'status': 'pending', 'n': 2}, {'source': 'webhook', 'status': 'pending', 'n': 1}]
```

第一次 4 个事件全是新的。第二次同一天再跑,模拟上游重试、邮箱又拉了一遍、定时任务补跑,4 个全被识别成重复,表里还是 4 行。第三次换到 10-23,webhook 和邮件还是那几个(在真系统里,第二天当然不会再收到同一封邮件,这里只是为了演示键不变就一定被挡),定时任务的键变成了 `cron:stale_tickets:2026-10-23`,是新事件。

再看两次定时任务各扫到多少张工单:

```bash
sqlite3 ambient.db "select event_id, json_array_length(json_extract(payload, '$.ticket_ids')) from events where source = 'cron'"
```

```text
cron:stale_tickets:2026-10-22|12
cron:stale_tickets:2026-10-23|14
```

`json_extract` 从 JSON 文本里取出 `ticket_ids` 这个数组,`json_array_length` 数它的长度,SQLite 内置了这些 JSON 函数。10-22 扫到 12 张(创建于 10-02 及以前),10-23 截止日期往后挪一天,多出 2 张,14 张。注意这两天的列表里有 12 张是重复的:定时任务每天都会把还没关的老工单再报一遍。这是业务上想要的(每天提醒一次),还是该「同一张工单只提醒一次」?那是另一层的去重,要按工单号去重而不是按事件去重,练习 4 会碰到这个区别。

到这里,今天的两个目标都做到了:三种来源,一张表,重复的进不来。表里这 5 行 pending 事件,明天交给 worker 去处理。

## 动手练习

**练习 1:给事件改状态,做一个最小的「仪表盘」。** 写 `ex_status.py`:一个 `set_status(event_id, status)` 函数,改状态时顺便刷新 `updated_at`,返回有没有改到;然后按状态统计事件数,并找出最老的一条 pending。用第 3 步跑完的 `ambient.db`,把 webhook 那条改成 done;再故意改一个不存在的 id。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/ambient/ex_status.py
import sys

from store import connect, now


def set_status(event_id: str, status: str) -> bool:
    with connect() as conn:
        cur = conn.execute(
            "UPDATE events SET status = ?, updated_at = ? WHERE event_id = ?",
            (status, now(), event_id),
        )
        return cur.rowcount == 1


if __name__ == "__main__":
    print("改状态:", set_status(sys.argv[1], sys.argv[2]))
    with connect() as conn:
        for r in conn.execute("SELECT status, COUNT(*) AS n FROM events GROUP BY status ORDER BY status"):
            print(f"  {r['status']:<10} {r['n']}")
        oldest = conn.execute(
            "SELECT event_id, received_at FROM events WHERE status = 'pending' ORDER BY received_at, event_id LIMIT 1"
        ).fetchone()
        print("最老的 pending:", dict(oldest) if oldest else None)
```

<div class="line-notes">

- `"UPDATE events SET status = ?, updated_at = ? WHERE event_id = ?",` 改状态的同时刷新更新时间。明天 worker 判断「某个事件卡在 processing 太久」就靠 `updated_at`。
- `return cur.rowcount == 1` 和 `add_event` 一样用 `rowcount` 判断改到没有。id 写错时是 0,调用方能发现。
- `print("改状态:", set_status(sys.argv[1], sys.argv[2]))` 命令行传事件 id 和新状态。
- `for r in conn.execute("SELECT status, COUNT(*) AS n FROM events GROUP BY status ORDER BY status"):` 按状态统计。
- `print(f"  {r['status']:<10} {r['n']}")` `:<10` 是左对齐、占 10 个字符宽,让数字对齐,相当于 JS 的 `padEnd(10)`。
- `"SELECT event_id, received_at FROM events WHERE status = 'pending' ORDER BY received_at, event_id LIMIT 1"` 最早收到的一条 pending。`received_at` 一样时再按 `event_id` 排,结果才稳定。
- `print("最老的 pending:", dict(oldest) if oldest else None)` 查不到时 `fetchone()` 返回 None,先判断再转字典。

</div>

```bash
uv run python ex_status.py "webhook:evt_8f2c41" done
uv run python ex_status.py "webhook:evt_nope" done
```

```text
改状态: True
  done       1
  pending    4
最老的 pending: {'event_id': 'cron:stale_tickets:2026-10-22', 'received_at': '2026-10-22T13:44:09'}
改状态: False
  done       1
  pending    4
最老的 pending: {'event_id': 'cron:stale_tickets:2026-10-22', 'received_at': '2026-10-22T13:44:09'}
```

第二次 id 写错,`rowcount` 是 0,返回 False,表没变。「最老的 pending」值得放在仪表盘最显眼的地方:如果它的 `received_at` 是一个小时前,说明 worker 要么挂了、要么处理不过来。我这次 5 个事件是同一秒收到的,所以按 `event_id` 排出来是 cron 那条。

</details>

**练习 2:邮件没有 Message-ID 怎么办?** 有些转发工具、有些手写的发信脚本会丢掉 Message-ID。写 `ex_hash.py`:没有 Message-ID 时,用「发件人 + 主题 + 正文」算一个 SHA-256 哈希当去重键。试三封:一封、和它一模一样的一封、正文多一个句号的一封。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/ambient/ex_hash.py
import hashlib
import json

from store import add_event, init


def mail_key(mail: dict) -> str:
    if mail.get("message_id"):
        return f"email:{mail['message_id']}"
    raw = f"{mail['from']}\n{mail['subject']}\n{mail['body']}"
    return "email-hash:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


init()
a = {"message_id": "", "from": "c021@example.com", "subject": "还是登录不了", "body": "试了重置密码也不行"}
b = dict(a)
c = {**a, "body": "试了重置密码也不行。"}
for name, mail in (("a", a), ("b(和 a 一模一样)", b), ("c(多一个句号)", c)):
    key = mail_key(mail)
    print(name, key, "新事件?", add_event(key, "email", "email.received", json.dumps(mail, ensure_ascii=False)))
```

<div class="line-notes">

- `import hashlib` 标准库的哈希模块。哈希就是把任意长的内容变成一串固定长度的「指纹」,内容一样指纹一定一样,内容差一个字指纹就完全不同。浏览器里对应的是 `crypto.subtle.digest('SHA-256', ...)`。
- `if mail.get("message_id"):` 有 Message-ID(而且不是空字符串)就优先用它,上游给的 id 永远比自己算的可靠。
- `raw = f"{mail['from']}\n{mail['subject']}\n{mail['body']}"` 用换行把三段连起来。中间要有分隔符,不然「主题 ab + 正文 c」和「主题 a + 正文 bc」会拼成同一个字符串。
- `return "email-hash:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]` 哈希要的是字节,先 `encode("utf-8")`;`hexdigest()` 得到 64 个十六进制字符,取前 16 个当键就够了。前缀写成 `email-hash:`,和真正的 Message-ID 键区分开。
- `b = dict(a)` 复制一份一模一样的。`dict(a)` 是浅拷贝,相当于 JS 的 `{...a}`。
- `c = {**a, "body": "试了重置密码也不行。"}` 只在正文末尾多一个中文句号。
- `for name, mail in (("a", a), ("b(和 a 一模一样)", b), ("c(多一个句号)", c)):` 三封依次入库,看哪封被当成重复。

</div>

```bash
uv run python ex_hash.py
```

```text
a email-hash:0e72e4d23295fa86 新事件? True
b(和 a 一模一样) email-hash:0e72e4d23295fa86 新事件? False
c(多一个句号) email-hash:5cf362d16b0c2d02 新事件? True
```

一模一样的那封被挡住了,多一个句号的那封算新事件。内容哈希能用,但两头都有毛病:客户真的连发了两封一模一样的邮件(比如以为第一封没发出去),会被当成重复吞掉一封;同一封邮件被转发工具加了一行签名,又会被当成新的。所以它只能当后备方案。能拿到上游 id 就用上游 id,这是去重的第一原则。

</details>

**练习 3:定时任务的日期用 UTC 还是本地时间?** 服务器上很多东西默认是 UTC(Day 320、Day 322 都见过 LangGraph 记的快照时间是 UTC)。假设定时任务北京时间早上 7:30 跑了一次,9:00 你又手动补跑了一次。写 `ex_tz.py`,分别用「UTC 日期」和「北京日期」造去重键,看哪种能挡住补跑。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/ambient/ex_tz.py
from datetime import datetime, timedelta, timezone

from store import add_event, init

BEIJING = timezone(timedelta(hours=8))
init()

for local in ("2026-10-22T07:30:00", "2026-10-22T09:00:00"):
    t = datetime.fromisoformat(local).replace(tzinfo=BEIJING)
    utc_day = t.astimezone(timezone.utc).date().isoformat()
    local_day = t.date().isoformat()
    print("北京时间", local[11:16], "| UTC 日期", utc_day, "| 本地日期", local_day)
    print("   按 UTC 日期做键,新事件?", add_event(f"cron-utc:stale_tickets:{utc_day}", "cron", "digest.stale_tickets", "{}"))
    print("   按本地日期做键,新事件?", add_event(f"cron-local:stale_tickets:{local_day}", "cron", "digest.stale_tickets", "{}"))
```

<div class="line-notes">

- `BEIJING = timezone(timedelta(hours=8))` 一个固定的 UTC+8 时区对象。北京没有夏令时,这样写够用。
- `for local in ("2026-10-22T07:30:00", "2026-10-22T09:00:00"):` 同一个北京日期里的两次运行。
- `t = datetime.fromisoformat(local).replace(tzinfo=BEIJING)` 解析字符串,再声明「这是北京时间」。不带时区的 datetime 叫「naive」,它不知道自己是哪个时区的,比较和转换都会出错。
- `utc_day = t.astimezone(timezone.utc).date().isoformat()` 换算成 UTC 再取日期。北京 7:30 是 UTC 前一天的 23:30。
- `local_day = t.date().isoformat()` 直接取北京日期。
- `print("   按 UTC 日期做键,新事件?", add_event(f"cron-utc:stale_tickets:{utc_day}", "cron", "digest.stale_tickets", "{}"))` 用 UTC 日期造键。前缀和第 3 步的 `cron:` 不同,不会和那边的数据撞。
- `print("   按本地日期做键,新事件?", add_event(f"cron-local:stale_tickets:{local_day}", "cron", "digest.stale_tickets", "{}"))` 用北京日期造键。

</div>

```bash
uv run python ex_tz.py
```

```text
北京时间 07:30 | UTC 日期 2026-10-21 | 本地日期 2026-10-22
   按 UTC 日期做键,新事件? True
   按本地日期做键,新事件? True
北京时间 09:00 | UTC 日期 2026-10-22 | 本地日期 2026-10-22
   按 UTC 日期做键,新事件? True
   按本地日期做键,新事件? False
```

按 UTC 日期做键,北京 7:30 那次算成了 10-21,9:00 那次算成了 10-22,两个键不同,补跑没被挡住,同一个北京工作日的超期提醒发了两遍。按北京日期做键,第二次被识别成重复。规则是:**去重键里的日期,要和业务上「一天」的定义用同一个时区**。客服团队按北京时间上班,「每天一次」就该按北京日期算。全球团队的话,可以按 UTC 定死,但所有人都要知道「一天」是从北京时间早上 8 点开始的。

</details>

**练习 4(开放题):同一张工单,两个不同的事件。** 工单系统偶尔会给同一张工单发两个不同 id 的 `ticket.created`(比如它自己的 bug,或者客户刷新页面提交了两次被它当成两张)。按事件 id 去重挡不住,因为 id 不同。给表加一个 `ticket_id` 列,在 `(kind, ticket_id)` 上建唯一索引,做「业务去重」。想一想:邮件事件没有工单号,`ticket_id` 是 NULL,会不会被这个索引误挡?

<details><summary>参考答案</summary>

示范解法:用一个内存库单独试,不动 `ambient.db`。

```python
# agent-zero-lab/part05/ambient/ex_bizkey.py
import sqlite3

conn = sqlite3.connect(":memory:")
conn.execute("CREATE TABLE events (event_id TEXT PRIMARY KEY, kind TEXT NOT NULL, ticket_id TEXT)")
conn.execute("CREATE UNIQUE INDEX uq_kind_ticket ON events (kind, ticket_id)")

rows = [
    ("webhook:evt_8f2c41", "ticket.created", "T1041"),
    ("webhook:evt_90aa17", "ticket.created", "T1041"),
    ("email:<CAF7x2@mail.example.com>", "email.received", None),
    ("email:<CAF9k1@mail.example.com>", "email.received", None),
]
for event_id, kind, ticket_id in rows:
    cur = conn.execute("INSERT OR IGNORE INTO events VALUES (?, ?, ?)", (event_id, kind, ticket_id))
    print(f"{event_id:<34} ticket={ticket_id!s:<6} 插入了 {cur.rowcount} 行")
print("表里一共", conn.execute("SELECT COUNT(*) FROM events").fetchone()[0], "行")
```

<div class="line-notes">

- `conn = sqlite3.connect(":memory:")` 特殊的文件名 `:memory:` 表示在内存里建一个临时库,程序结束就没了,做实验很方便。
- `conn.execute("CREATE TABLE events (event_id TEXT PRIMARY KEY, kind TEXT NOT NULL, ticket_id TEXT)")` 只留三列,`ticket_id` 允许为空。
- `conn.execute("CREATE UNIQUE INDEX uq_kind_ticket ON events (kind, ticket_id)")` 唯一索引:同一种事件、同一张工单只能有一行。Day 89 讲过索引,加上 `UNIQUE` 它就同时是一个约束。
- `("webhook:evt_90aa17", "ticket.created", "T1041"),` 事件 id 不同,但工单号和类型都和上一行一样。
- `("email:<CAF7x2@mail.example.com>", "email.received", None),` 邮件事件没有工单号,Python 的 `None` 存进去就是 SQL 的 NULL。
- `cur = conn.execute("INSERT OR IGNORE INTO events VALUES (?, ?, ?)", (event_id, kind, ticket_id))` 主键或者唯一索引任何一个冲突都会被忽略。
- `print(f"{event_id:<34} ticket={ticket_id!s:<6} 插入了 {cur.rowcount} 行")` `!s` 先把值转成字符串(None 变成 `"None"`),再按宽度对齐。

</div>

```bash
uv run python ex_bizkey.py
```

```text
webhook:evt_8f2c41                 ticket=T1041  插入了 1 行
webhook:evt_90aa17                 ticket=T1041  插入了 0 行
email:<CAF7x2@mail.example.com>    ticket=None   插入了 1 行
email:<CAF9k1@mail.example.com>    ticket=None   插入了 1 行
表里一共 3 行
```

同一张 T1041 的第二个 `ticket.created` 被唯一索引挡住了。两封邮件 `ticket_id` 都是 NULL,却都插进去了:在 SQL 里 NULL 表示「不知道」,两个「不知道」不算相等,所以唯一索引不管 NULL。这里正好是我们想要的(两封不同的邮件不该互相挡),但如果你以为「没有工单号的也会被去重」,就会吃亏。

再提醒两点。一是业务去重要先想清楚「什么算同一件事」:`(kind, ticket_id)` 意味着一张工单这辈子只处理一次 `ticket.created`,合理;但如果对 `ticket.updated` 也这么做,客户第二次更新工单就被吞了,那就错了。二是 `INSERT OR IGNORE` 这时会同时吞掉主键冲突和业务冲突,你分不清是「上游重试」还是「业务重复」。要区分的话,先按 `event_id` 插,再单独查一次业务键,或者把业务重复记一条日志。第 3 步说过定时任务每天都会报同一批老工单,那里要不要按工单去重,也是同一个问题,答案取决于业务想要「每天提醒」还是「提醒一次」。

</details>

**验收标准**:能说出三种触发源各自为什么会重复、各用什么做去重键;`store_v1.py` 能复现 `IntegrityError: UNIQUE constraint failed`,`store.py` 能用 `INSERT OR IGNORE` 加 `rowcount` 让重复投递返回 False;`ingest.py` 同一天跑两次表里还是 4 行,换一天定时任务多一行;能解释为什么去重不用「先 SELECT 再 INSERT」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 后台 Agent(ambient agent) | 由事件触发、在后台运行、只在需要人时才打扰人的 Agent。LangChain 2025 年提出的叫法 |
| 通知 / 提问 / 审核 | 后台 Agent 找人的三种方式:告诉人一件事;问人要一个信息;做有后果的事前请人批准 |
| 触发源 | 把 Agent 叫醒的东西。今天讲 webhook、邮件轮询、定时任务三种 |
| webhook | 对方系统发生事件时,主动向你事先给的 URL 发一个 POST 请求。可以理解成「反过来的 fetch」 |
| 至少投递一次(at-least-once) | 保证你至少收到一次、不保证只收到一次的投递方式。webhook 和大多数队列都是这种,收的一方必须去重 |
| 轮询(polling) | 每隔一段时间主动去问一次「有没有新东西」。收邮件常用这种方式 |
| IMAP | 收邮件的标准协议,Python 标准库里有 `imaplib` |
| Message-ID | 每封邮件头里的唯一编号,由发信方生成,用来给邮件去重 |
| 定时任务(cron) | 按时间表自动执行的任务。cron 是 Linux 上的老工具名,现在泛指这一类 |
| 事件表 | 所有触发源进来的东西先写成一行的表,带状态,后面由 worker 统一处理。本质是一个用数据库实现的队列 |
| 去重键 | 判断「是不是同一件事」的那个值。webhook 用事件 id,邮件用 Message-ID,定时任务用任务名加日期 |
| INSERT OR IGNORE | SQLite 的写法,插入时违反唯一约束就当没执行,不报错。Postgres 对应 `ON CONFLICT DO NOTHING` |
| rowcount | 游标上的属性,上一条语句改了几行。INSERT OR IGNORE 插进去是 1,被忽略是 0 |

## 常见误区

**收到 webhook 就直接跑 Agent。** 调模型、查库一来十几秒,上游早判你超时,开始重试。入口只验签、写表、马上返回;Agent 交给后面的 worker。

**以为重复投递是上游的 bug。** webhook 和队列大多是「至少投递一次」,重复是设计如此。处理成功了但回复丢了,对方照样重发。收的一方必须自己去重。

**重复事件让入口报错。** 第 1 步实测普通 INSERT 第二次报 `sqlite3.IntegrityError: UNIQUE constraint failed: events.event_id`。入口一报错就回 500,对方继续重试,越试越多。用 `INSERT OR IGNORE`,重复的照样返回成功。

**用「先 SELECT 再 INSERT」去重。** 两个请求同时到,都查到「没有」,都插进去。把去重交给主键或唯一约束,一条语句完成。

**能拿到上游 id 却用内容哈希。** 练习 2 实测,多一个句号就算新事件,而客户真发两封一样的又会被误吞。上游 id 优先,哈希只当后备。

**定时任务的去重键用 UTC 日期。** 练习 3 实测,北京时间 7:30 算成了前一天,9:00 补跑没被挡住。键里的日期要和业务上的「一天」同一个时区。

**以为唯一索引会把 NULL 也去重。** 练习 4 实测,两行 `ticket_id` 都是 NULL,都插进去了。SQL 里两个 NULL 不相等。

## 学习资料

### 文档与文章

- [LangChain · Introducing ambient agents](https://blog.langchain.com/introducing-ambient-agents):提出这个概念的原文,通知、提问、审核三种找人方式就出自这里,英文,15 分钟。
- [Stripe · Webhooks](https://docs.stripe.com/webhooks):业界写得最好的 webhook 接收指南之一。今天先读讲「快速返回 2xx」和「处理重复事件」的部分,验签留到明天,20 分钟。
- [GitHub · Best practices for using webhooks](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks):短,讲为什么要异步处理、怎么用投递 id 去重,和今天的结论一样,10 分钟。
- [SQLite · ON CONFLICT clause](https://www.sqlite.org/lang_conflict.html):`INSERT OR IGNORE` 里那个 `IGNORE` 的官方定义,还有 `REPLACE`、`ABORT` 等其他几种冲突处理方式,10 分钟。
- [Python · sqlite3 文档(中文)](https://docs.python.org/zh-cn/3/library/sqlite3.html):查 `Cursor.rowcount` 和「将连接对象用作上下文管理器」两节,10 分钟。
- [crontab.guru](https://crontab.guru/):在线解释 cron 表达式(比如 `0 9 * * *` 是「每天 9 点」),以后配定时任务时随手查。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1n34y1M7yL&autoplay=0&high_quality=1" title="什么是 WebHook ？如何实现？适用什么场景？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序猿DD · 什么是 WebHook?如何实现?适用什么场景? · 8 分钟,没接触过 webhook 的先看这个,讲清推和拉的区别。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1BLzrYHE6C&autoplay=0&high_quality=1" title="5分钟的Linux-crontab定时任务" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>卿瑜的技术日记 · 5分钟的Linux-crontab定时任务 · 12 分钟,看 cron 表达式那五个位置各代表什么。今天不用真的配 crontab,知道它是怎么回事就行。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1HkjAzuEoq&autoplay=0&high_quality=1" title="双11支付宝订单重复扣款故障分析：如何保障支付系统的幂等性？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员的角落 · 双11支付宝订单重复扣款故障分析:如何保障支付系统的幂等性? · 5 分钟,用支付场景讲重复请求和去重,和 CloudLedger 的重复扣款工单正好是同一类问题。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/egSh4TxS5go" title="Ambient Agents and the New Agent Inbox ft. Harrison Chase" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Sequoia Capital · Ambient Agents and the New Agent Inbox ft. Harrison Chase · LangChain 创始人在红杉 AI Ascent 2025 上讲为什么聊天界面不适合后台 Agent、收件箱这种交互是怎么想出来的。英文,今天看前半段讲概念的部分,收件箱那段留到 Day 327。</figcaption>
</figure>

- LangChain Academy《Project: Ambient Agents with LangGraph》([课程页](https://academy.langchain.com/courses/ambient-agents)):免费,做一个邮件助手式的后台 Agent。三天学完后想看完整版可以学它。

### 书籍

- Martin Kleppmann《数据密集型应用系统设计》(原书 *Designing Data-Intensive Applications*,O'Reilly 2017;中译本中国电力出版社 2018)第 11 章「流处理」:事件日志、至少一次投递、幂等消费这些概念讲得最透的地方。今天读讲「传递事件流」的前半部分就够。
- Gregor Hohpe、Bobby Woolf《Enterprise Integration Patterns》(Addison-Wesley,2003):老书,「Idempotent Receiver」「Polling Consumer」这几个模式的名字就出自这里,今天的事件表就是它们的组合。翻目录挑这两节看,英文原版。

### 开源项目与代码

- [langchain-ai/agents-from-scratch](https://github.com/langchain-ai/agents-from-scratch):上面那门课的配套代码,一个完整的邮件助手后台 Agent。今天先看它的 README,了解一个后台 Agent 项目由哪几块组成。

## 自测

1. 后台 Agent 和聊天式 Agent 最根本的区别是什么?

<details><summary>答案</summary>

谁启动一次运行、结果交给谁。聊天式是人发起、人等着、结果直接回给这个人;后台 Agent 由事件(webhook、邮件、定时)启动,没人在等,产出多半是给内部的人一条待办,只在需要时通过通知、提问、审核三种方式找人。

</details>

2. 为什么说 webhook「天生会重复」?举一个你处理成功了、对方仍然重发的例子。

<details><summary>答案</summary>

webhook 一般是「至少投递一次」:没收到 2xx 就重试。例子:你已经把事件写进表了,但返回 200 的响应在网络上丢了,或者你返回得太慢超过了对方的超时时间,对方都会认为失败而重发同一个事件(id 不变)。

</details>

3. `add_event` 里 `return cur.rowcount == 1` 在什么情况下返回 False?为什么不直接用 try/except 捕获 IntegrityError?

<details><summary>答案</summary>

`INSERT OR IGNORE` 因为主键冲突被忽略时,`rowcount` 是 0,返回 False,也就是这个事件之前收过。用 try/except 也能做,但 `OR IGNORE` 不会在数据库里产生一个失败的语句、不用写异常处理、意图更清楚;更重要的是不管哪种,都不要「先 SELECT 再 INSERT」,那样并发时会漏。注意 `OR IGNORE` 会吞掉所有唯一约束冲突,表上约束多时要小心。

</details>

4. 定时任务没有上游 id,去重键怎么造?北京时间早上 7 点跑的任务,键里的日期该用什么?

<details><summary>答案</summary>

用「任务名 + 这一次对应的业务日期」,如 `cron:stale_tickets:2026-10-22`,同一天跑几次键都一样。日期要用业务定义「一天」的那个时区:客服按北京时间上班就用北京日期。用 UTC 的话北京 7 点会算成前一天,8 点以后补跑的那次就挡不住(练习 3)。

</details>

5. **面试题**:「你们的 Agent 要处理工单系统推过来的 webhook,怎么保证同一张工单不会被 Agent 处理两次?」

<details><summary>答案</summary>

参考要点:分层回答。入口层:webhook 入口只验签、写事件表、立刻返回 2xx,不在请求里跑 Agent,避免超时引发重试;事件表用上游的事件 id 做主键,`INSERT OR IGNORE`(Postgres 用 `ON CONFLICT DO NOTHING`),重复投递返回成功但不再入队。业务层:上游可能给同一张工单发两个不同 id 的事件,所以按业务键(如 `kind + ticket_id`)再加一道唯一约束,注意 NULL 不参与唯一性。执行层:Agent 里有副作用的步骤(发邮件、建退款)自己也要幂等,比如 outbox 表上 ticket_id 唯一、退款按发票号判断是否已退。能说出「at-least-once 投递 + 幂等消费 = 效果上只处理一次」这句话,再提一下 worker 领任务时也要防两个 worker 抢同一条(明天的内容)会更好。

</details>

## 明天预告

明天是 [Day 326 · 后台 Agent(二):webhook 入口、处理图和 worker](/blog/agent-zero/day-326-ambient-2/)。今天三种来源都是 Python 函数模拟的,事件表里那 5 行 pending 也没人处理。明天用 FastAPI 写一个真的 webhook 入口,加上验签;再写一个 worker,从表里原子地领一个事件、交给 LangGraph 图处理、失败了重试,所有状态都记在今天这张表的 `status` 和 `attempts` 里。
