---
title: 'Day 23 · 动手写 MCP server:把 CloudLedger 业务库包成工具'
description: '造一份云簿 CloudLedger 的假业务库,用 MCP Python SDK 2.x 把查客户、查订阅、查发票、提交退款申请包成四个工具,在 Inspector 里调通、用内存客户端写测试、接进 Claude Code,最后写一段桥接代码把它接到自己的 Agent 循环上。'
pubDate: 2026-10-12
regime: none
tags: ['mcp', 'mcp-server', 'sqlite', 'cloudledger', 'agent-60']
series: 'agent-60'
day: 23
lang: 'zh'
---

## 今天要解决的问题

昨天在 Inspector 里看了别人的 server,今天自己写一个。从今天开始,课程里的所有例子都围绕一个虚构公司:云簿 CloudLedger,一家卖在线记账软件的 SaaS 公司,按席位、按月或按年收费。W7 的毕业项目 SupportPilot 就是给它做智能客服,今天写的 server 会一路用到毕业项目。

学完今天,你要能做到:

1. 跑一个造数脚本,生成云簿的客户、订阅、发票、工单、退款申请五张表。
2. 用 MCP Python SDK 2.x 写出四个工具,参数有约束、出错有能让模型看懂的提示、读写权限有标注。
3. 用 MCP Inspector 手动调用每个工具,用内存客户端写 pytest 测试。
4. 把 server 接进 Claude Code(或 Cursor、Claude Desktop),用自然语言查数据。
5. 自己当一回 host:写一段桥接代码,把 MCP 工具接到 Day 9 那种手写 Agent 循环上,让 DeepSeek 之类的模型通过 MCP 查库。

预计用时 4–6 小时。代码量比前几天大,但每一段都不难。前置:Day 2(uv、pydantic)、Day 8–9(function calling 和 Agent 循环)、Day 22(MCP 概念)。

## 先把数据造出来

写工具之前得有数据。真实项目里你会连公司的数据库,学习时我们自己造一份,好处是想要什么情况就造什么情况。比如我在脚本里故意给客户 C007 复制了一张发票,模拟「重复扣款」,后面几天的演示都会用它。

表结构故意设计得和真实 SaaS 计费系统差不多,只是砍掉了很多字段。有一点值得专门说:**金额一律用「分」存成整数**。这是做过计费系统的人都会坚持的规矩。用浮点数存钱,`0.1 + 0.2` 不等于 `0.3` 的问题迟早会以「对账差一分钱」的形式出现在你面前,而且很难查。对外展示时再除以 100 转成元。

先建目录、装依赖。如果你一直跟着课程,`agent-60-lab` 已经是一个 uv 项目了:

```bash
cd agent-60-lab
mkdir -p w4/cloudledger
uv add "mcp[cli]" openai python-dotenv
uv add --dev pytest anyio
```

`mcp[cli]` 里的 `cli` 会顺带装上 `mcp` 命令行工具,后面启动 Inspector 要用。

```python
# agent-60-lab/w4/cloudledger/seed.py
"""造一份 CloudLedger(云簿)的假业务库。可重复运行:每次删库重建,随机种子固定,数据每次一样。"""
import calendar
import os
import random
import sqlite3
from datetime import date, timedelta
from pathlib import Path

DB_PATH = Path(os.environ.get("CLOUDLEDGER_DB", Path(__file__).with_name("cloudledger.db")))  # 和 server.py 同一个约定

SCHEMA = """
CREATE TABLE customers (
    id          TEXT PRIMARY KEY,          -- C001
    name        TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE,
    company     TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE TABLE subscriptions (
    id                  TEXT PRIMARY KEY,  -- S001
    customer_id         TEXT NOT NULL REFERENCES customers(id),
    plan                TEXT NOT NULL,     -- 基础版 / 专业版 / 企业版
    billing_cycle       TEXT NOT NULL,     -- monthly / yearly
    seats               INTEGER NOT NULL,
    status              TEXT NOT NULL,     -- active / trialing / past_due / canceled
    started_at          TEXT NOT NULL,
    current_period_end  TEXT NOT NULL
);
CREATE TABLE invoices (
    id               TEXT PRIMARY KEY,     -- INV-2026-0001
    customer_id      TEXT NOT NULL REFERENCES customers(id),
    subscription_id  TEXT NOT NULL REFERENCES subscriptions(id),
    amount_cents     INTEGER NOT NULL,     -- 金额一律用「分」存,避免浮点误差
    status           TEXT NOT NULL,        -- paid / open / void / refunded
    issued_at        TEXT NOT NULL,
    paid_at          TEXT
);
CREATE TABLE tickets (
    id           TEXT PRIMARY KEY,         -- T1001
    customer_id  TEXT NOT NULL REFERENCES customers(id),
    subject      TEXT NOT NULL,
    body         TEXT NOT NULL,
    status       TEXT NOT NULL,            -- open / pending / solved
    created_at   TEXT NOT NULL
);
CREATE TABLE refund_requests (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id    TEXT NOT NULL REFERENCES invoices(id),
    amount_cents  INTEGER NOT NULL,
    reason        TEXT NOT NULL,
    status        TEXT NOT NULL,           -- pending_approval / approved / rejected
    created_at    TEXT NOT NULL,
    decided_at    TEXT,
    decided_by    TEXT
);
"""

PLANS = {"基础版": 4900, "专业版": 9900, "企业版": 29900}   # 每席位每月,单位:分
SURNAMES = "王李张刘陈杨黄赵吴周徐孙马朱胡郭何林罗高"
GIVEN = ["伟", "芳", "娜", "敏", "静", "磊", "洋", "艳", "勇", "军", "杰", "涛", "明", "超", "霞", "平", "刚", "桂英"]
COMPANIES = ["星河餐饮", "青木设计", "远山物流", "蓝鲸教育", "启明科技", "禾丰农业", "半岛咖啡", "云杉律所",
             "北辰贸易", "小满花店", "知行咨询", "海盐文创", "长风汽修", "鹿鸣影视", "白塔印务"]

TICKET_TEMPLATES = [
    ("重复扣款", "你好,我这个月的账单好像扣了两次,{inv} 和另一笔金额一样,麻烦帮我查一下,多扣的要退给我。"),
    ("申请退款", "我们公司下个月起不再使用云簿了,年付还剩几个月,想问能不能退剩下的钱?发票号 {inv}。"),
    ("席位数量不对", "我们只有 {seats} 个人在用,但账单上好像按更多席位收费了,能核对一下吗?"),
    ("发票抬头修改", "上个月的发票抬头写错了,应该是「{company}有限公司」,能重开吗?"),
    ("导出报表报错", "导出年度报表的时候一直提示 ERR_EXPORT_TIMEOUT,换了浏览器也一样。"),
    ("升级套餐", "想从{plan}升级到企业版,中途升级怎么计费?"),
    ("登录不了", "收到的验证码一直提示过期,已经试了五六次了,急!"),
    ("取消订阅", "请帮我取消订阅,不要再自动续费了。"),
]


def add_months(d: date, n: int) -> date:
    """d 往后推 n 个自然月;目标月没有这一天(比如 1 月 31 日推一个月)就取当月最后一天。"""
    y, m = divmod(d.month - 1 + n, 12)
    year, month = d.year + y, m + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def main() -> None:
    rng = random.Random(42)
    DB_PATH.unlink(missing_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)

    today = date(2026, 10, 12)
    inv_seq = 0
    for i in range(1, 31):
        cid = f"C{i:03d}"
        name = rng.choice(SURNAMES) + rng.choice(GIVEN)
        company = COMPANIES[(i - 1) % len(COMPANIES)] + ("" if i <= 15 else "二店")
        email = f"user{i:03d}@example.com"
        created = today - timedelta(days=rng.randint(60, 700))
        conn.execute("INSERT INTO customers VALUES (?,?,?,?,?)",
                     (cid, name, email, company, created.isoformat()))

        sid = f"S{i:03d}"
        plan = rng.choice(list(PLANS))
        cycle = rng.choice(["monthly", "monthly", "yearly"])
        seats = rng.choice([1, 2, 3, 5, 8, 12])
        status = rng.choices(["active", "trialing", "past_due", "canceled"], [70, 10, 10, 10])[0]
        started = created + timedelta(days=rng.randint(0, 20))
        months = 12 if cycle == "yearly" else 1
        rng.randint(1, 30 * months)  # 这次抽到的数不用,但调用要留着:后面所有随机数(发票、工单)都排在它之后

        # 每个客户最近 3~5 张发票,k=0 是最近一张
        for k in range(rng.randint(3, 5)):
            inv_seq += 1
            inv_id = f"INV-2026-{inv_seq:04d}"
            amount = PLANS[plan] * seats * months
            issued = today - timedelta(days=30 * months * k + rng.randint(0, 5))
            inv_status = "paid" if k > 0 else rng.choice(["paid", "paid", "open"])
            paid_at = (issued + timedelta(days=rng.randint(0, 3))).isoformat() if inv_status == "paid" else None
            conn.execute("INSERT INTO invoices VALUES (?,?,?,?,?,?,?)",
                         (inv_id, cid, sid, amount, inv_status, issued.isoformat(), paid_at))
            if k == 0:
                latest = issued

        # 订阅周期跟着发票走:本期从最近一张发票的开票日开始,过一个计费周期结束;
        # 订阅开始日不能晚于最早那张发票(循环结束时 issued 就是最早那张)
        period_end = add_months(latest, months)
        started = min(started, issued)
        conn.execute("INSERT INTO subscriptions VALUES (?,?,?,?,?,?,?,?)",
                     (sid, cid, plan, cycle, seats, status, started.isoformat(), period_end.isoformat()))

    # 故意造一个「重复扣款」:C007 最近一张发票被复制了一份
    row = conn.execute("SELECT * FROM invoices WHERE customer_id='C007' ORDER BY issued_at DESC LIMIT 1").fetchone()
    inv_seq += 1
    dup_id = f"INV-2026-{inv_seq:04d}"
    conn.execute("INSERT INTO invoices VALUES (?,?,?,?,?,?,?)",
                 (dup_id, row[1], row[2], row[3], "paid", row[5], row[6] or row[5]))

    for t in range(1, 41):
        cid = f"C{rng.randint(1, 30):03d}"
        subject, body = rng.choice(TICKET_TEMPLATES)
        inv = conn.execute("SELECT id FROM invoices WHERE customer_id=? ORDER BY issued_at DESC LIMIT 1",
                           (cid,)).fetchone()[0]
        sub = conn.execute("SELECT plan, seats FROM subscriptions WHERE customer_id=?", (cid,)).fetchone()
        company = conn.execute("SELECT company FROM customers WHERE id=?", (cid,)).fetchone()[0]
        text = body.format(inv=inv, seats=max(1, sub[1] - 2), company=company, plan=sub[0])
        created = today - timedelta(days=rng.randint(0, 14))
        conn.execute("INSERT INTO tickets VALUES (?,?,?,?,?,?)",
                     (f"T{1000 + t}", cid, subject, text, "open", created.isoformat()))

    # 再给 C007 补一张真的「重复扣款」工单,后面几天的演示都用它
    conn.execute("INSERT INTO tickets VALUES (?,?,?,?,?,?)",
                 ("T1041", "C007", "重复扣款",
                  f"你好,10 月 8 号我被扣了两次款,{row[0]} 和 {dup_id} 金额一模一样,麻烦把多扣的那笔退给我。",
                  "open", today.isoformat()))

    conn.commit()
    counts = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
              for t in ["customers", "subscriptions", "invoices", "tickets"]}
    print(f"已生成 {DB_PATH.name}: {counts}")
    conn.close()


if __name__ == "__main__":
    main()
```

```bash
uv run python w4/cloudledger/seed.py
```

输出大致长这样:

```text
已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}
```

随机种子固定成 42,所以你我跑出来的数据完全一样,课程里提到的 `C007`、`INV-2026-0123`、`T1041` 在你的库里也都存在。用 `sqlite3 w4/cloudledger/cloudledger.db "select * from invoices where customer_id='C007'"` 看一眼,能看到两张 10 月 8 日、金额都是 2392.00 元的发票,这就是我们造的重复扣款。

**`seed.py` 逐行讲解。** 下面的数据都是用种子 42 真实跑出来的,你那边应该一模一样。

**导入**

```python
import calendar
import os
import random
import sqlite3
from datetime import date, timedelta
from pathlib import Path
```
`calendar` 只用它的 `monthrange` 查某个月有几天,下面推算订阅到期日要用;`os` 读环境变量;`random` 造随机数据;`sqlite3` 是 Python 自带的 SQLite 驱动,不用装任何东西,数据库就是一个文件;`date` 表示日期、`timedelta` 表示一段时长,两者可以加减;`Path` 处理路径。

```python
DB_PATH = Path(os.environ.get("CLOUDLEDGER_DB", Path(__file__).with_name("cloudledger.db")))
```
从里往外读:`Path(__file__)` 是 `seed.py` 自己的路径;`.with_name("cloudledger.db")` 把文件名换掉,得到同目录下的 `.../w4/cloudledger/cloudledger.db`;`os.environ.get("CLOUDLEDGER_DB", 默认值)` 先看有没有设这个环境变量,没设就用默认值;最外面再包一层 `Path`,因为环境变量读出来是字符串。相当于 Node 的 `process.env.CLOUDLEDGER_DB ?? path.join(__dirname, "cloudledger.db")`。

**表结构 `SCHEMA`**

五张表,关系是:一个客户(customers)有一个订阅(subscriptions),订阅产生多张发票(invoices);客户可以提工单(tickets);退款申请(refund_requests)挂在某张发票上。

- `TEXT PRIMARY KEY`:主键用 `C001` 这样的可读编号,不用自增数字,工单和日志里一眼能认出来。
- `REFERENCES customers(id)`:外键,声明这一列指向哪张表。SQLite 默认**不强制检查**外键(要 `PRAGMA foreign_keys=ON` 才检查),这里主要起文档作用。
- `amount_cents INTEGER`:金额用整数「分」存。`0.1 + 0.2` 在浮点里等于 `0.30000000000000004`,钱不能有这种误差,所以 2392 元存成 `239200`。
- 日期列都是 `TEXT`,存 `2026-10-08` 这样的 ISO 格式字符串。SQLite 没有专门的日期类型,ISO 格式按字符串排序正好就是按时间排序。
- `paid_at TEXT` 没有 `NOT NULL`:还没付的发票这里是 `NULL`。
- `refund_requests` 的主键是 `INTEGER PRIMARY KEY AUTOINCREMENT` 自增,因为它是后面 Agent 运行时才写入的,seed 不往里放数据。

**常量**

```python
PLANS = {"基础版": 4900, "专业版": 9900, "企业版": 29900}   # 每席位每月,单位:分
```
三个套餐每个席位每月 49、99、299 元。

```python
SURNAMES = "王李张刘陈杨黄赵吴周徐孙马朱胡郭何林罗高"
```
一个字符串。`rng.choice` 对字符串也能用,会随机挑一个字符,所以这里不用写成列表。

`GIVEN`、`COMPANIES` 是名字和公司名的候选池。

```python
TICKET_TEMPLATES = [
    ("重复扣款", "你好,我这个月的账单好像扣了两次,{inv} 和另一笔金额一样,..."),
    ...
]
```
8 个工单模板,每个是 `(标题, 正文)` 元组。正文里的 `{inv}`、`{seats}`、`{company}`、`{plan}` 是占位符,后面用 `.format()` 填。注意这里是普通字符串,不是 f-string:f-string 定义时就会立刻替换,这里要等到后面拿到具体客户才填。

**`add_months`:按自然月往后推**

```python
def add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    year, month = d.year + y, m + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))
```
`timedelta` 只能加天数,「加一个月」得自己算。先把月份换成从 0 数的 `d.month - 1`,加上 n,再用 `divmod(x, 12)` 拆成「进几年、落在第几个月」。代入 `add_months(date(2026, 10, 11), 12)`:`divmod(9 + 12, 12)` 得 `(1, 9)`,年份 2026 + 1 = 2027,月份 9 + 1 = 10,结果 2027-10-11。`calendar.monthrange(year, month)` 返回 `(这个月 1 号是星期几, 这个月有几天)`,取 `[1]` 就是天数;`add_months(date(2026, 1, 31), 1)` 时 2 月只有 28 天,`min(31, 28)` 得 28,结果 2026-02-28,不会因为「2 月 31 日」报错。

**`main`:准备工作**

```python
    rng = random.Random(42)
```
创建一个独立的随机数生成器,种子固定为 42。同样的种子,每次产生的随机序列完全一样,所以「随机」数据每次跑都一样,课程里提到的 `C007`、`INV-2026-0123` 在你的库里也一定存在。用自己的 `rng` 而不是全局的 `random.choice`,是为了不受其他代码调用 random 的影响。

「每次一样」指的是**同一个种子产生的整串序列一样**,不是每次调用都返回同一个数。实测:

```python
a = random.Random(42); b = random.Random(42); c = random.Random(7)
[a.randint(1, 100) for _ in range(5)]   # [82, 15, 4, 95, 36]
[b.randint(1, 100) for _ in range(5)]   # [82, 15, 4, 95, 36]  同种子,同一串
[c.randint(1, 100) for _ in range(5)]   # [42, 20, 51, 84, 7]  换种子,换一串
```

`randint(1, 100)` 随机取 1 到 100 的整数(两头都包含),相当于 JS 的 `Math.floor(Math.random() * 100) + 1`。`[... for _ in range(5)]` 是「做 5 次,结果装进列表」,相当于 `Array.from({length: 5}, () => ...)`。

逐个拆开这一行 `[a.randint(1, 100) for _ in range(5)]`,从 `for` 开始读:`range(5)` 生成 0~4 五个数,控制循环 5 次;`for _ in` 依次把它们放进 `_`(不用这个值);每圈执行一次 `a.randint(1, 100)`;结果按顺序装进方括号的列表。

| 圈 | `_` | `a.randint(1, 100)` | 列表 |
| --- | --- | --- | --- |
| 1 | 0 | 82 | `[82]` |
| 2 | 1 | 15 | `[82, 15]` |
| 3 | 2 | 4 | `[82, 15, 4]` |
| 4 | 3 | 95 | `[82, 15, 4, 95]` |
| 5 | 4 | 36 | `[82, 15, 4, 95, 36]` |

等价于 `result = []` 加 `for _ in range(5): result.append(a.randint(1, 100))`。

同一个 `rng` 连着调用,每次拿到的是这串里的下一个数(82、15、4……),所以数据看起来是随机的;但重新运行脚本,又从 82 开始,所以每次生成的库一模一样。这类随机数叫「伪随机」:它是用种子算出来的,不是真随机。有一个前提:调用的顺序和次数也得一样。比如你在 `seed.py` 中间多加一句 `rng.choice(...)`,后面所有数据都会跟着变。

```python
    DB_PATH.unlink(missing_ok=True)
```
删掉旧库文件,`missing_ok=True` 表示文件不存在也不报错。这就是开头说的「每次删库重建」。

```python
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
```
`connect` 打开数据库,文件不存在就新建一个。`executescript` 能一次执行多条用分号隔开的 SQL,五张表一次建完;普通的 `execute` 一次只能执行一条。

```python
    today = date(2026, 10, 12)
    inv_seq = 0
```
「今天」写死成 2026-10-12,而不是 `date.today()`,否则你哪天跑数据就会变。`inv_seq` 是发票的全局流水号。

**造 30 个客户**

```python
    for i in range(1, 31):
        cid = f"C{i:03d}"
```
`i` 从 1 到 30。`{i:03d}` 是格式说明:整数(`d`)补足 3 位,不够补 0。`i=7` 得到 `C007`。相当于 TS 的 `` `C${String(i).padStart(3, "0")}` ``。

```python
        name = rng.choice(SURNAMES) + rng.choice(GIVEN)
        company = COMPANIES[(i - 1) % len(COMPANIES)] + ("" if i <= 15 else "二店")
        email = f"user{i:03d}@example.com"
        created = today - timedelta(days=rng.randint(60, 700))
```
- 名字:随机姓加随机名,`C001` 是「刘伟」。
- 公司:`(i - 1) % 15` 让 30 个客户轮流用 15 个公司名;第 16 个起加「二店」,保证公司名不重复。`C001` 是「星河餐饮」,`C016` 是「星河餐饮二店」。
- 邮箱按编号生成,保证 `UNIQUE` 约束不冲突。
- 注册日期:今天往前随机 60 到 700 天(`randint` 两头都包含)。`C001` 是 `2025-11-05`。`date - timedelta` 得到另一个 `date`。

```python
        conn.execute("INSERT INTO customers VALUES (?,?,?,?,?)",
                     (cid, name, email, company, created.isoformat()))
```
`?` 是参数占位符,值按顺序从后面的元组里填,驱动负责转义,不会 SQL 注入。`isoformat()` 把日期变成 `"2025-11-05"` 字符串。

**每人一个订阅**

```python
        sid = f"S{i:03d}"
        plan = rng.choice(list(PLANS))
        cycle = rng.choice(["monthly", "monthly", "yearly"])
        seats = rng.choice([1, 2, 3, 5, 8, 12])
        status = rng.choices(["active", "trialing", "past_due", "canceled"], [70, 10, 10, 10])[0]
```
- `list(PLANS)` 取出 dict 的键 `["基础版", "专业版", "企业版"]`,再随机挑一个。
- `"monthly"` 写两遍,是让月付的概率变成 2/3。
- `rng.choices(候选列表, 权重列表)`(多了个 s)支持权重,不带 s 的 `choice` 只能等概率挑:70% active,其余各 10%。它返回的是**列表**(默认抽 1 个),所以要 `[0]` 取出来。真实结果是 active 23 个、past_due 3 个、trialing 2 个、canceled 2 个。

逐个拆开 `rng.choices(["active", "trialing", "past_due", "canceled"], [70, 10, 10, 10])[0]`:第 1 个参数是候选项;第 2 个参数是权重,和候选项一一对应,active 占 70 份、其余各 10 份;`choices` 返回列表,比如 `["active"]`;最后的 `[0]` 取出第 0 个元素,得到字符串 `"active"`。

```python
        started = created + timedelta(days=rng.randint(0, 20))
        months = 12 if cycle == "yearly" else 1
        rng.randint(1, 30 * months)  # 这次抽到的数不用,但调用要留着:后面所有随机数(发票、工单)都排在它之后
```
注册后 0~20 天开始订阅(先算个初值,发票生成完还会再校正一次);年付一个账期 12 个月,月付 1 个月。

第三行看着奇怪:抽了一个随机数却不用。这一版之前,到期日是用它随机出来的(今天往后 1 天到一个账期),结果和发票对不上,比如 C009 年付,最近一张年费发票 2026-10-11 开,到期日却随机成了 2027-04-16,Agent 按政策算剩余月数时自相矛盾。改成按发票推算到期日以后,这次调用如果删掉,`rng` 后面吐出的每个数都会错开一位,发票号、金额、工单全变,课程里引用的 C007、INV-2026-0123、T1041 就对不上了。所以保留调用、丢掉结果。固定种子的造数脚本都有这个特点:**改逻辑可以,别增删随机数调用**。

订阅这一行先不写库,等这个客户的发票生成完,按发票推出到期日再写(见下一节末尾)。

**每人 3~5 张发票**

```python
        for k in range(rng.randint(3, 5)):
            inv_seq += 1
            inv_id = f"INV-2026-{inv_seq:04d}"
            amount = PLANS[plan] * seats * months
            issued = today - timedelta(days=30 * months * k + rng.randint(0, 5))
```
`k=0` 是最近一张,`k=1` 往前推一个账期,以此类推。金额 = 单价 × 席位 × 月数:`C001` 是 4900 × 2 × 1 = `9800` 分(98 元);`C007` 是 29900 × 8 × 1 = `239200` 分(2392 元)。开票日再随机往前错 0~5 天,让日期不那么整齐。`inv_seq` 是全局累加的,所以 `C001` 拿到 0001~0005,`C007` 拿到 0026~0029。

```python
            inv_status = "paid" if k > 0 else rng.choice(["paid", "paid", "open"])
            paid_at = (issued + timedelta(days=rng.randint(0, 3))).isoformat() if inv_status == "paid" else None
```
历史发票全部已付;只有最近一张有 1/3 概率还没付(`open`)。已付的付款日在开票后 0~3 天,没付的 `paid_at` 是 `None`,写进数据库就是 `NULL`。

`C001` 的五张:

| id | amount_cents | status | issued_at | paid_at |
| --- | --- | --- | --- | --- |
| INV-2026-0001 | 9800 | paid | 2026-10-09 | 2026-10-09 |
| INV-2026-0002 | 9800 | paid | 2026-09-12 | 2026-09-13 |
| INV-2026-0003 | 9800 | paid | 2026-08-12 | 2026-08-12 |
| INV-2026-0004 | 9800 | paid | 2026-07-10 | 2026-07-11 |
| INV-2026-0005 | 9800 | paid | 2026-06-09 | 2026-06-12 |

循环结束,30 个客户一共生成了 122 张发票。

```python
            if k == 0:
                latest = issued

        period_end = add_months(latest, months)
        started = min(started, issued)
        conn.execute("INSERT INTO subscriptions VALUES (?,?,?,?,?,?,?,?)",
                     (sid, cid, plan, cycle, seats, status, started.isoformat(), period_end.isoformat()))
```
发票按「每个账期开头开一张」来理解:最近一张(`k=0`)的开票日就是本期开始,往后推一个账期就是本期结束。`add_months` 按自然月推,1 月 31 日推一个月得到 2 月的最后一天,而不是报错。循环结束时 `issued` 停在最早那张发票上,订阅开始日不能比它还晚,所以取两者较小的。

实测几个:

| 订阅 | 周期 | 最近一张发票 | 开始日 | 本期结束 |
| --- | --- | --- | --- | --- |
| `S001` | 基础版 monthly 2 席位 trialing | 2026-10-09 | 2025-11-22 | 2026-11-09 |
| `S007` | 企业版 monthly 8 席位 active | 2026-10-08 | 2026-03-15 | 2026-11-08 |
| `S009` | 基础版 yearly 3 席位 active | 2026-10-11 | 2023-10-28 | 2027-10-11 |

`S009` 的开始日被校正成了最早那张年费发票的日期。年付客户有 3~5 张年费发票,最早的在三四年前,比客户的注册日 `created_at` 还早,这是假数据的一个瑕疵;Agent 能调到的工具都不返回 `created_at`,所以不影响课程里的用例。

**故意造一笔重复扣款**

```python
    row = conn.execute("SELECT * FROM invoices WHERE customer_id='C007' ORDER BY issued_at DESC LIMIT 1").fetchone()
```
取 `C007` 最近一张发票,`fetchone()` 返回一个元组:
`('INV-2026-0026', 'C007', 'S007', 239200, 'paid', '2026-10-08', '2026-10-08')`。按列顺序,`row[0]` 是 id,`row[1]` 是客户,`row[2]` 是订阅,`row[3]` 是金额,`row[5]` 是开票日,`row[6]` 是付款日。

```python
    inv_seq += 1
    dup_id = f"INV-2026-{inv_seq:04d}"
    conn.execute("INSERT INTO invoices VALUES (?,?,?,?,?,?,?)",
                 (dup_id, row[1], row[2], row[3], "paid", row[5], row[6] or row[5]))
```
流水号到了 123,复制出一张 `INV-2026-0123`:同一客户、同一订阅、同样 2392 元、同一天开票,状态强制为 `paid`。`row[6] or row[5]`:原发票如果还没付(`paid_at` 是 None),就用开票日当付款日,保证这张重复发票「确实扣了钱」。

现在 `C007` 有两张 10 月 8 日、各 2392 元的已付发票,0026 和 0123。发票总数 123。

**造 40 张随机工单**

```python
    for t in range(1, 41):
        cid = f"C{rng.randint(1, 30):03d}"
        subject, body = rng.choice(TICKET_TEMPLATES)
```
随机挑一个客户、一个模板。`subject, body = (...)` 是元组解包,一次给两个变量赋值。

```python
        inv = conn.execute("SELECT id FROM invoices WHERE customer_id=? ORDER BY issued_at DESC LIMIT 1",
                           (cid,)).fetchone()[0]
        sub = conn.execute("SELECT plan, seats FROM subscriptions WHERE customer_id=?", (cid,)).fetchone()
        company = conn.execute("SELECT company FROM customers WHERE id=?", (cid,)).fetchone()[0]
```
查出这个客户最近的发票号、套餐和席位、公司名,准备填进模板。`(cid,)` 末尾的逗号不能省,只有一个元素的元组必须这么写。

```python
        text = body.format(inv=inv, seats=max(1, sub[1] - 2), company=company, plan=sub[0])
```
`.format()` 按名字填占位符,模板里没用到的参数会被忽略,所以每个模板都可以传同样四个参数。`seats=max(1, sub[1] - 2)` 故意比真实席位少报 2 个,对应「席位数量不对」这个投诉;`max(1, ...)` 保证不会出现 0 或负数。

```python
        created = today - timedelta(days=rng.randint(0, 14))
        conn.execute("INSERT INTO tickets VALUES (?,?,?,?,?,?)",
                     (f"T{1000 + t}", cid, subject, text, "open", created.isoformat()))
```
工单号 `T1001` 到 `T1040`,都是最近两周内提的,全部 `open`。真实的 `T1001`:客户 `C015`,「导出报表报错」,`2026-09-30`。

40 张的标题分布:登录不了 9、重复扣款 8、导出报表报错 6、发票抬头修改 5、申请退款 5、升级套餐 4、取消订阅 3、席位数量不对 1。注意那 8 张「重复扣款」是随机客户提的,他们其实**没有**被重复扣款,只有 `C007` 是真的。这正好可以考 Agent:它得去查发票,不能客户说什么就信什么。

**C007 的真工单**

```python
    conn.execute("INSERT INTO tickets VALUES (?,?,?,?,?,?)",
                 ("T1041", "C007", "重复扣款",
                  f"你好,10 月 8 号我被扣了两次款,{row[0]} 和 {dup_id} 金额一模一样,麻烦把多扣的那笔退给我。",
                  "open", today.isoformat()))
```
这里用 f-string,因为 `row[0]` 和 `dup_id` 已经确定了。正文填好后是:「你好,10 月 8 号我被扣了两次款,INV-2026-0026 和 INV-2026-0123 金额一模一样,麻烦把多扣的那笔退给我。」后面几天的演示都围绕这张工单。

**收尾**

```python
    conn.commit()
```
提交事务。Python 的 sqlite3 默认在第一条 INSERT 时自动开启事务,不 commit 就关闭连接,前面写的数据全部丢失。

```python
    counts = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
              for t in ["customers", "subscriptions", "invoices", "tickets"]}
```
字典推导式:对每个表名查一次行数,得到 `{'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}`。表名不能用 `?` 占位(占位符只能用于值),所以这里用 f-string 拼。拼 SQL 一般是大忌,这里能接受,是因为表名来自代码里写死的列表,不是外部输入。

```python
    print(f"已生成 {DB_PATH.name}: {counts}")
    conn.close()
```
`DB_PATH.name` 只取文件名 `cloudledger.db`。打印的就是上面那行输出。

## 第一个工具:一个普通函数加一个装饰器

MCP Python SDK 2.x 写 server 的方式非常像 FastAPI。你写普通的 Python 函数,加上 `@mcp.tool()`,SDK 从函数身上读出三样东西:

- 函数名变成工具名;
- docstring 变成工具描述,这是模型决定要不要调用它的主要依据;
- 参数的类型标注变成 inputSchema。

先看最简单的一个:

```python
@mcp.tool(annotations=READ_ONLY)
def find_customer(
    query: Annotated[str, Field(description="客户邮箱、姓名、公司名或客户编号(如 C007),支持部分匹配")],
) -> list[dict]:
    """按邮箱/姓名/公司/编号查找客户,返回最多 5 条。查订阅和发票前先用它拿到 customer_id。"""
```

`Annotated[str, Field(description=...)]` 是 pydantic 的写法,给单个参数加说明。docstring 的最后半句「查订阅和发票前先用它拿到 customer_id」是写给模型看的使用顺序提示。Day 11 讲工具设计时说过,描述是写给模型的说明书,不是写给人的注释。没有这半句,模型很可能直接拿邮箱去调 `list_invoices`,吃一个参数校验错误再回头找客户编号,白白多一轮调用。有没有这半句差别多大,动手练习第 4 题让你自己测。

再看一个带约束的:

```python
@mcp.tool(annotations=READ_ONLY)
def list_invoices(
    customer_id: Annotated[str, Field(description="客户编号,如 C007", pattern=r"^C\d{3}$")],
    status: Literal["paid", "open", "void", "refunded"] | None = None,
    limit: Annotated[int, Field(ge=1, le=20)] = 6,
) -> list[dict]:
```

三个技巧都在这里了:`pattern` 用正则限定客户编号格式;`Literal` 生成枚举,模型只能从这四个状态里选;`ge`/`le` 给数字设上下限,防止模型一次要一万条把上下文撑爆。有默认值的参数自动变成可选。

这些约束不只是文档。模型传了 `customer_id: "7"`,SDK 在你的函数执行**之前**就拦下来,返回一个 `isError: true` 的结果,里面写着哪个字段不符合什么规则。模型读到之后通常会去调 `find_customer` 拿正确编号再重试。你写一次 `pattern`,就换来一个会自我纠正的 Agent。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="Python 函数的名字、docstring、类型标注分别映射为 MCP 工具的 name、description、inputSchema">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
  <text x="20" y="28" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">你写的 Python</text>
  <text x="400" y="28" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">tools/list 里模型看到的</text>
  <rect x="20" y="42" width="300" height="168" rx="4" fill="none" stroke="var(--rule)"/>
  <g font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">
    <text x="32" y="64">@mcp.tool(annotations=READ_ONLY)</text>
    <text x="32" y="84" fill="var(--compute)">def list_invoices(</text>
    <text x="44" y="104" fill="var(--mem)">customer_id: str  pattern ^C\d{3}$</text>
    <text x="44" y="122" fill="var(--mem)">status: Literal[paid, open, ...]</text>
    <text x="44" y="140" fill="var(--mem)">limit: int  1..20 = 6</text>
    <text x="32" y="158" fill="var(--compute)">) -&gt; list[dict]:</text>
    <text x="44" y="180" fill="var(--ink)">"""列出客户最近的发票..."""</text>
  </g>
  <rect x="400" y="42" width="220" height="168" rx="4" fill="none" stroke="var(--rule)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <text x="412" y="70" fill="var(--compute)">name</text>
    <text x="412" y="100" fill="var(--ink)">description</text>
    <text x="412" y="130" fill="var(--mem)">inputSchema</text>
    <text x="424" y="148" fill="var(--ink-faint)">required / enum /</text>
    <text x="424" y="164" fill="var(--ink-faint)">minimum / maximum</text>
    <text x="412" y="192" fill="var(--ink-soft)">annotations, outputSchema</text>
  </g>
  <g stroke="var(--rule)" stroke-dasharray="3 3">
    <line x1="230" y1="80" x2="405" y2="66"/>
    <line x1="270" y1="176" x2="405" y2="96"/>
    <line x1="300" y1="122" x2="405" y2="126"/>
  </g>
</svg>
<figcaption>你不用手写任何 JSON Schema。函数名、docstring、类型标注就是工具的全部定义,返回值类型还会生成 outputSchema。</figcaption>
</figure>

## 出错时让模型看得懂

这是今天最值得花时间的一节。一个 Agent 好不好用,很大程度上取决于工具失败时它能不能自己爬起来。MCP Python SDK 里,工具失败有三种走法,效果完全不同:

**raise `ToolError`**:模型能看到你写的错误信息。结果里 `isError` 为 true,content 是你的消息。这是你想要的大多数情况,比如「没有找到匹配的客户,可以换成邮箱或客户编号再试」。

**raise 其他异常**(比如代码里一个 `KeyError`):SDK 2.x 会把它当成意外崩溃,模型只看到「Error executing tool xxx」,具体原因写进 server 日志。这是故意的设计,避免把数据库报错、文件路径这类内部细节泄露给模型和用户。

**return 一个错误字符串**:最坑的一种。`isError` 是 false,模型以为调用成功了,会把「发票不存在」当成正常数据用,有时候还会顺着编出一个答案。千万别这么写。

所以 server 里凡是「模型传错了、可以改正」的情况,一律 `raise ToolError(...)`,而且消息里**告诉它怎么改**:

```python
if inv["status"] != "paid":
    raise ToolError(f"发票 {invoice_id} 状态是 {inv['status']},只有 paid 的发票能退款。")
...
if cents > left:
    raise ToolError(f"最多还能申请 {yuan(left)} 元(发票 {yuan(inv['amount_cents'])} 元,已申请 {yuan(already)} 元)。")
```

对比一下两种报错消息给模型的信息量:「invalid amount」和「最多还能申请 2392.00 元(发票 2392.00 元,已申请 0.00 元)」。前者模型只能瞎猜,后者它下一步就知道该填多少。

## 读和写要分开对待

四个工具里,三个只读,一个写库。写的那个我故意设计成「提交退款申请」而不是「执行退款」:它只往 `refund_requests` 表插一条 `pending_approval` 状态的记录,真正退钱要等主管审批。这个审批流程 Day 25 会用 LangGraph 的 interrupt 实现。

为什么不让 Agent 直接退款?因为退款是钱的事,一次幻觉就是真金白银的损失。比较稳妥的做法都遵循同一个原则:**Agent 可以提议,人来拍板**,至少在上线初期是这样。等你有了 W5 的评测数据,证明它在某类场景里准确率够高,再逐步放开小额自动退款。

工具上的 `annotations` 是给 host 看的行为提示:

```python
READ_ONLY = ToolAnnotations(read_only_hint=True, open_world_hint=False)

@mcp.tool(annotations=ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=False))
def create_refund_request(...):
```

`read_only_hint=True` 告诉 host 这个工具不改数据,一些 host 会据此允许并行调用或免确认。`idempotent_hint=False` 说明重复调用会产生重复记录。但规范里写得很清楚:**这些只是提示,不是安全机制**。恶意或写错的 server 完全可以把删库工具标成只读。真正的权限控制要在 server 内部做(比如这里只允许插入 pending 状态),或者在 host 侧做人工确认。

## resource 和 prompt 各写一个

server 里我还放了一个 resource 和一个 prompt,主要是让你在 Inspector 里看看它们长什么样:

- `cloudledger://policy/refund` 是退款政策原文,resource 由应用决定是否加载;
- `reply_ticket(ticket_id)` 是一个提示词模板,用户在 host 里选它,传一个工单号,得到一段「处理这张工单」的标准指令。

昨天说过,很多 host 对这两样支持得不完整,核心能力还是做成 tool。退款政策这种模型经常需要查的东西,在毕业项目里我们会放进知识库,通过检索工具给模型,而不是依赖 resource。

## 完整的 server

```python
# agent-60-lab/w4/cloudledger/server.py
"""CloudLedger 业务库的 MCP server。只读工具随便调,写操作只能「提交退款申请」,真正退款要人审批。"""
import logging
import os
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Annotated, Literal, TypedDict

from pydantic import Field

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

# 默认用同目录下的 cloudledger.db;评测和部署时可以用环境变量指到别的库(比如每次测试用一份干净副本)
DB_PATH = Path(os.environ.get("CLOUDLEDGER_DB", Path(__file__).with_name("cloudledger.db")))
log = logging.getLogger("cloudledger")

mcp = MCPServer(
    "cloudledger",
    instructions="云簿 CloudLedger 的客户、订阅、发票查询工具。金额对外一律用「元」,内部存「分」。",
)

READ_ONLY = ToolAnnotations(read_only_hint=True, open_world_hint=False)


# 返回值用 TypedDict 声明,SDK 会据此生成 outputSchema,并把结果放进 structured_content。
# 如果只写 -> dict,SDK 不知道结构,structured_content 会是 None。
class Subscription(TypedDict):
    id: str
    customer_id: str
    plan: str
    billing_cycle: str
    seats: int
    status: str
    started_at: str
    current_period_end: str


class RefundRequest(TypedDict):
    refund_request_id: int
    status: str
    amount_yuan: str


def db() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise ToolError("业务库不存在,请先运行 seed.py 生成 cloudledger.db。")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def yuan(cents: int) -> str:
    return f"{cents / 100:.2f}"


@mcp.tool(annotations=READ_ONLY)
def find_customer(
    query: Annotated[str, Field(description="客户邮箱、姓名、公司名或客户编号(如 C007),支持部分匹配")],
) -> list[dict]:
    """按邮箱/姓名/公司/编号查找客户,返回最多 5 条。查订阅和发票前先用它拿到 customer_id。"""
    like = f"%{query.strip()}%"
    with db() as conn:
        rows = conn.execute(
            "SELECT id, name, email, company FROM customers "
            "WHERE id = ? OR email LIKE ? OR name LIKE ? OR company LIKE ? LIMIT 5",
            (query.strip().upper(), like, like, like),
        ).fetchall()
    if not rows:
        raise ToolError(f"没有找到匹配「{query}」的客户。可以换成邮箱或客户编号再试。")
    return [dict(r) for r in rows]


@mcp.tool(annotations=READ_ONLY)
def get_subscription(
    customer_id: Annotated[str, Field(description="客户编号,如 C007", pattern=r"^C\d{3}$")],
) -> Subscription:
    """查询客户当前订阅:套餐、计费周期、席位数、状态、开始日期、本期结束日。"""
    with db() as conn:
        row = conn.execute("SELECT * FROM subscriptions WHERE customer_id = ?", (customer_id,)).fetchone()
    if row is None:
        raise ToolError(f"客户 {customer_id} 没有订阅记录。确认编号是否来自 find_customer 的结果。")
    return Subscription(**dict(row))


@mcp.tool(annotations=READ_ONLY)
def list_invoices(
    customer_id: Annotated[str, Field(description="客户编号,如 C007", pattern=r"^C\d{3}$")],
    status: Literal["paid", "open", "void", "refunded"] | None = None,
    limit: Annotated[int, Field(ge=1, le=20)] = 6,
) -> list[dict]:
    """列出客户最近的发票(按开票日期倒序),金额单位为元。可按状态过滤。"""
    sql = "SELECT id, amount_cents, status, issued_at, paid_at FROM invoices WHERE customer_id = ?"
    args: list = [customer_id]
    if status:
        sql += " AND status = ?"
        args.append(status)
    sql += " ORDER BY issued_at DESC, id DESC LIMIT ?"
    args.append(limit)
    with db() as conn:
        rows = conn.execute(sql, args).fetchall()
    return [{**dict(r), "amount_yuan": yuan(r["amount_cents"])} for r in rows]


@mcp.tool(annotations=ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=False))
def create_refund_request(
    invoice_id: Annotated[str, Field(description="要退款的发票号,如 INV-2026-0123")],
    amount_yuan: Annotated[float, Field(gt=0, description="退款金额,单位元")],
    reason: Annotated[str, Field(min_length=4, max_length=200, description="退款原因,写清楚依据")],
) -> RefundRequest:
    """提交一条退款申请,状态为 pending_approval,不会立刻退钱,需要客服主管审批。
    只能对 paid 状态的发票申请,金额不能超过发票金额减去已申请金额。"""
    with db() as conn:
        inv = conn.execute("SELECT * FROM invoices WHERE id = ?", (invoice_id,)).fetchone()
        if inv is None:
            raise ToolError(f"发票 {invoice_id} 不存在。先用 list_invoices 查到正确的发票号。")
        if inv["status"] != "paid":
            raise ToolError(f"发票 {invoice_id} 状态是 {inv['status']},只有 paid 的发票能退款。")
        already = conn.execute(
            "SELECT COALESCE(SUM(amount_cents), 0) FROM refund_requests "
            "WHERE invoice_id = ? AND status != 'rejected'",
            (invoice_id,),
        ).fetchone()[0]
        cents = round(amount_yuan * 100)
        left = inv["amount_cents"] - already
        if cents > left:
            raise ToolError(f"最多还能申请 {yuan(left)} 元(发票 {yuan(inv['amount_cents'])} 元,已申请 {yuan(already)} 元)。")
        cur = conn.execute(
            "INSERT INTO refund_requests (invoice_id, amount_cents, reason, status, created_at) "
            "VALUES (?, ?, ?, 'pending_approval', ?)",
            (invoice_id, cents, reason, datetime.now().isoformat(timespec="seconds")),
        )
        log.info("refund request %s created for %s", cur.lastrowid, invoice_id)
    return RefundRequest(refund_request_id=cur.lastrowid, status="pending_approval", amount_yuan=yuan(cents))


@mcp.resource("cloudledger://policy/refund")
def refund_policy() -> str:
    """云簿退款政策原文。"""
    return (
        "1. 重复扣款:核实后全额退还重复的那一笔,3 个工作日内原路退回。\n"
        "2. 年付(专业版和企业版)中途取消:按剩余整月数退款,已使用月份和当月不退;基础版年付不退,取消后当期结束不再续费。\n"
        "3. 月付:不支持中途退款,取消后当期结束不再续费。\n"
        "4. 所有退款需客服主管审批后执行。"
    )


@mcp.prompt()
def reply_ticket(ticket_id: str) -> str:
    """生成「处理一张工单」的标准提示词,用户在客户端里像斜杠命令一样选用。"""
    with db() as conn:
        t = conn.execute("SELECT * FROM tickets WHERE id = ?", (ticket_id,)).fetchone()
    if t is None:
        raise ToolError(f"工单 {ticket_id} 不存在")
    return (
        f"你是云簿的客服。请处理工单 {t['id']}(客户 {t['customer_id']}):\n"
        f"标题:{t['subject']}\n内容:{t['body']}\n\n"
        "先用工具核实事实,再起草回复。涉及退款只提交申请,告诉客户需要审批。"
    )


if __name__ == "__main__":
    mcp.run()  # 默认 stdio
```

<div class="line-notes">

- `"""CloudLedger 业务库` 模块 docstring,把这个 server 的权限边界写在最前面:读随便调,写只有一个口子,而且这个口子只能「提申请」,钱不会马上退出去。**给 Agent 的写权限要收窄到人能兜底的程度**,这是今天最重要的设计思想。
- `import logging` 打日志用。stdio 模式下不能用 `print`,原因见下面 `log = ...` 那一行。
- `from typing import Annotated` `Annotated[类型, 附加信息]` 给类型贴上额外信息,比如 `Annotated[str, Field(...)]` 的意思是:类型是 str,另外附带一份描述和校验规则。`Literal` 限定只能取几个固定值,生成 schema 时会变成 `enum`;`TypedDict` 声明「有固定 key 的 dict」。
- `from pydantic import Field` `Field` 用来声明参数的说明(description)和约束(pattern、ge、le、min_length……)。SDK 会把它们翻译成 JSON Schema 交给模型,**模型就是看这份 description 决定该填什么值的**。
- `from mcp.server import MCPServer` SDK 2.x 的高层 server 类(1.x 叫 `FastMCP`,用法基本一样)。
- `import ToolError` 在工具里抛它,SDK 会把它转成 `isError: true` 的工具结果,把这段文字**原样交给模型**,server 不会崩。所以本文件里的错误信息都写成「告诉模型下一步该怎么做」。
- `DB_PATH = Path(` 从里往外读:`Path(__file__)` 是 `server.py` 自己的路径 → `.with_name("cloudledger.db")` 换成同目录下的 `.../w4/cloudledger/cloudledger.db` → 外层的 `os.environ.get` 先看有没有设 `CLOUDLEDGER_DB`。没设就用同目录的库;运行 `CLOUDLEDGER_DB=/tmp/eval_1.db uv run python server.py` 就会用 `/tmp/eval_1.db`。评测时每个用例拷一份干净的库再指过去,上一个用例写进去的退款申请就不会影响下一个。
- `log = logging.getLogger` 建一个名为 cloudledger 的 logger。**stdio 模式下 stdout 就是 JSON-RPC 通信线路**,随手 `print("hello")` 会把协议消息弄坏;logging 默认写 stderr,所以是安全的。在 Inspector 里调用退款工具时,能看到它打出 `refund request 1 created for INV-2026-0123`。
- `mcp = MCPServer(` 第一个参数 `"cloudledger"` 是 server 名,host 里显示的就是它。
- `instructions=` 握手(initialize)时发给 host,很多 host 会把它放进系统提示词。「对外用元、内部存分」是在提醒模型:库里的 `239200` 要说成 2392.00 元,不能直接念给客户。
- `READ_ONLY = ToolAnnotations(` 三个只读工具共用的注解。`read_only_hint=True` 表示不改数据,host 可以据此不弹确认框;`open_world_hint=False` 表示只访问自己的库,不连外部系统。注意这些**只是提示,没有强制力**,真正兜底的是下面的代码里根本没写 UPDATE/DELETE。
- `class Subscription(TypedDict):` 返回类型写成 TypedDict,SDK 才能生成 `outputSchema`,并把结果放进 `structured_content`。运行时它就是一个普通 dict:`Subscription(id="S007", ...)` 得到的就是 `{"id": "S007", ...}`,作用只体现在类型声明和 schema 上。
- `class RefundRequest(TypedDict):` 退款工具的返回结构。
- `amount_yuan: str` 金额用 str 不用 float,`"2392.00"` 会原样保留两位小数,不会变成 `2392.0`。
- `def db() -> sqlite3.Connection:` 每个工具都通过它拿连接。
- `if not DB_PATH.exists():` 先检查库文件存不存在。不检查的话,`sqlite3.connect` 遇到不存在的路径会**悄悄新建一个空库**,紧接着查询就会报 `no such table: customers`,模型看到这个错误也不知道怎么办。
- `conn.row_factory = sqlite3.Row` 让查询结果从元组 `('C007', '刘静', ...)` 变成可以按列名取的 `row["name"]`,也能用 `dict(row)` 转成字典。
- `return f"{cents / 100:.2f}"` 代入:`yuan(239200)` → `239200 / 100 = 2392.0` → `:.2f` 保留两位 → `"2392.00"`;`yuan(1999)` → `"19.99"`。
- `@mcp.tool(annotations=READ_ONLY)` 装饰器把函数注册成 MCP 工具:函数名是工具名,docstring 是工具描述,参数生成 inputSchema。
- `query: Annotated[str` 模型看到的 schema 是 `{"query": {"type": "string", "description": "客户邮箱、姓名……"}}`。没有默认值,所以是 required。
- `"""按邮箱/姓名/公司/编号查找客户` 后半句「查订阅和发票前先用它拿到 customer_id」是**在给模型安排调用顺序**,对 Agent 选对工具帮助很大。
- `like = f"%{query.strip()}%"` 代入 `query = " user007 "` → strip 去掉首尾空格 → `like = "%user007%"`。`%` 是 SQL LIKE 的通配符,表示任意多个字符。
- `with db() as conn:` sqlite3 连接的 `with` **只管事务**:正常结束自动 commit,出异常 rollback,**但不会关闭连接**。练习规模下靠垃圾回收就够了,生产里会用连接池或 `contextlib.closing`。
- `"SELECT id, name, email, company FROM customers "` 两个挨着的字符串字面量,Python 会自动拼成一个。
- `"WHERE id = ? OR email LIKE ?` `?` 是参数占位符,值单独放在后面的元组里,**这样能防 SQL 注入**。千万别用 f-string 把 query 拼进 SQL。
- `(query.strip().upper(), like, like, like),` 四个值依次填进四个 `?`。实测几种 query:<br>`"c007"` → `.upper()` 得到 `C007`,`id = ?` 精确命中,返回刘静;<br>`"user007"` → 编号没命中,email 命中,还是 C007;<br>`"刘"` → name 命中 4 个人:C001 刘伟、C007 刘静、C008 刘军、C030 刘霞;<br>`"咖啡"` → company 命中 C007 半岛咖啡和 C022 半岛咖啡二店。<br>用 `.upper()` 是因为 SQLite 的 LIKE 对英文本来就不区分大小写,但 `=` 区分。
- `).fetchall()` 取出全部结果行,是一个列表,查不到时是 `[]`。
- `if not rows:` 查「张三」时 `rows = []`,`not []` 为 True,进入报错。
- `raise ToolError(f"没有找到匹配` 错误信息里带着下一步建议(换成邮箱或编号),模型读到会换个词重试,不会就此卡住。
- `return [dict(r) for r in rows]` 列表推导式,把每个 `sqlite3.Row` 转成普通 dict。实测 `"c007"` 的结构化结果是 `{"result": [{"id": "C007", "name": "刘静", "email": "user007@example.com", "company": "半岛咖啡"}]}`。返回值是列表不是对象,所以 SDK 在外面包了一层 `result`。
- `customer_id: Annotated[str` `pattern=r"^C\d{3}$"` 规定必须是大写 C 加 3 位数字(`r""` 是原始字符串,`\d` 不会被当成转义)。`"C007"` ✅,`"c007"`、`"刘静"`、`"C0007"` 都 ❌。实测传 `"c007"`,**函数体根本没执行**,pydantic 先拦了下来,返回 `String should match pattern '^C\d{3}$'`。模型想跳过 find_customer 直接传名字,在这里就走不通。
- `row = conn.execute("SELECT * FROM subscriptions` `(customer_id,)` 末尾的逗号不能省,**单元素元组必须带逗号**,`("C007")` 只是加了括号的字符串。`fetchone()` 取第一行,没有就返回 None。代入 C007,拿到 S007 这一行。
- `if row is None:` 代入 `"C099"`:格式合法,但库里只有 30 个客户,查不到,报错时顺便提示模型确认编号来源。
- `return Subscription(**dict(row))` `**` 是字典解包,把 `{"id": "S007", "plan": "企业版", ...}` 展开成关键字参数。返回 `{"id": "S007", "customer_id": "C007", "plan": "企业版", "billing_cycle": "monthly", "seats": 8, "status": "active", "started_at": "2026-03-15", "current_period_end": "2026-11-08"}`。隐患:`SELECT *` 加 `**`,以后表里加一列,返回值就会多出 schema 里没有的 key。更稳妥的做法是把列名一个个写出来。
- `customer_id: Annotated[str` 和 get_subscription 一样的编号校验。
- `status: Literal[` schema 里会变成 `"enum": ["paid", "open", "void", "refunded"]`,模型传 `"已支付"` 会被直接拒掉。`X | None = None` 是 Python 3.10 的联合类型写法,表示可以不传。
- `limit: Annotated[int, Field(ge=1, le=20)] = 6` 大于等于 1、小于等于 20,默认 6。传 100 会被拦下,防止一次拉几千行把上下文撑爆。
- `sql = "SELECT id, amount_cents` 动态拼 SQL,但**拼进去的只有固定的 SQL 片段,值始终走 `?`**。
- `args: list = [customer_id]` 和 sql 里的 `?` 一一对应的参数列表。
- `if status:` 传了 status 才加这个条件。代入 `list_invoices("C007")`:最后 `args = ["C007", 6]`;代入 `list_invoices("C007", status="open", limit=3)`:`args = ["C007", "open", 3]`。
- `sql += " ORDER BY issued_at DESC, id DESC LIMIT ?"` C007 有两张发票都是 2026-10-08 开的,日期相同时按 id 倒序,所以 INV-2026-0123 排在 INV-2026-0026 前面。加第二个排序键是为了**让结果顺序稳定**,评测才好写断言。
- `return [{**dict(r), "amount_yuan"` `{**原字典, 新key: 值}` 是「复制一份再加一个字段」。实测 `limit=3` 的前两条:<br>`{"id": "INV-2026-0123", "amount_cents": 239200, "status": "paid", "issued_at": "2026-10-08", ..., "amount_yuan": "2392.00"}`<br>`{"id": "INV-2026-0026", "amount_cents": 239200, ..., "issued_at": "2026-10-08", "amount_yuan": "2392.00"}`<br>同一天两笔 2392 元,模型从这里就能看出重复扣款。查不到时返回 `[]` 而不是报错:「这个客户没有发票」是合法答案,和 find_customer「找不到人 = 输入有问题」不一样。
- `@mcp.tool(annotations=ToolAnnotations(read_only_hint=False` 唯一的写工具。`read_only_hint=False`:会写库,host 一般会弹确认框;`destructive_hint=False`:只新增,不删不改,也不动钱;`idempotent_hint=False`:**不幂等**,同样的参数调两次就会插两条,host 和模型看到它就知道不能随便重试。
- `amount_yuan: Annotated[float, Field(gt=0` `gt=0` 是严格大于 0,传 0 或负数会被拦。
- `reason: Annotated[str, Field(min_length=4` 原因要 4~200 字。像「退款」这样两个字会被拦,逼着模型写出依据,审批的人也看得明白。
- `"""提交一条退款申请` docstring 把业务规则提前告诉模型(只有 paid 能退、不能超额),模型就不太会拿 open 的发票来试。
- `inv = conn.execute("SELECT * FROM invoices` 下面用一个真实场景走一遍:模型调用 `create_refund_request("INV-2026-0123", 2392, "同日重复扣款,与 INV-2026-0026 重复")`。这一行查到 0123,`amount_cents = 239200`,`status = "paid"`。
- `if inv is None:` 传一个不存在的 `INV-2026-9999` 就会走到这里。
- `if inv["status"] != "paid":` 传 C003 那张未付的 `INV-2026-0009` 会报「状态是 open,只有 paid 的发票能退款」。0123 是 paid,通过。注意 f-string 里用的是单引号 `inv['status']`,因为外层已经是双引号(3.12 之前不能嵌套同一种引号)。
- `already = conn.execute(` 统计这张发票已经申请了多少钱。
- `"SELECT COALESCE(SUM(amount_cents), 0)` 没有任何行时 `SUM` 返回 NULL,`COALESCE(x, 0)` 把 NULL 换成 0。
- `"WHERE invoice_id = ? AND status != 'rejected'"` 被驳回的申请不算占用,待审批和已通过的都算。
- `).fetchone()[0]` 取第一行第一列。第一次调用时表是空的 → `already = 0`。
- `cents = round(amount_yuan * 100)` `round(2392 * 100) = 239200`。为什么用 `round` 不用 `int`?浮点数有误差:`19.99 * 100` 等于 `1998.9999999999998`,`int` 截断得 1998,**少了 1 分**;`round` 得 1999。
- `left = inv["amount_cents"] - already` `239200 - 0 = 239200`,还能申请 2392 元。
- `if cents > left:` 第一次:`239200 > 239200` 为 False,放行。**同样参数再调一次**(`idempotent_hint=False` 要防的就是这个):`already = 239200`,`left = 0`,`239200 > 0` 为 True,报错。
- `raise ToolError(f"最多还能申请` 第二次调用的实测报错:`最多还能申请 0.00 元(发票 2392.00 元,已申请 2392.00 元)。`额度校验顺带挡住了重复提交,模型看错误信息也知道是怎么回事。隐患:「先查 already 再 INSERT」不是原子操作,两个请求同时进来可能都读到 0,合起来就超额了。单人 stdio 场景基本碰不到,真要防可以用 `BEGIN IMMEDIATE` 先拿写锁。
- `"VALUES (?, ?, ?, 'pending_approval', ?)"` status **在 SQL 里写死成 `'pending_approval'`**,不是参数,模型没有任何办法直接写出 approved。「人审批」这个设计就落在这一行。
- `datetime.now().isoformat(timespec="seconds")` 得到 `"2026-10-22T14:30:05"` 这种格式,精确到秒,不带微秒。
- `log.info("refund request %s created for %s"` `cur.lastrowid` 是刚插入那行的自增 id,第一次是 1。日志用 `%s` 占位、参数分开传,而不是 f-string:这样日志级别关掉时就不用做字符串格式化,这是 logging 的惯用写法。写到 stderr,不影响 stdio。with 块到这里结束,没有异常,**自动 commit**。
- `return RefundRequest(refund_request_id=cur.lastrowid` 实测返回 `{"refund_request_id": 1, "status": "pending_approval", "amount_yuan": "2392.00"}`。`cur` 在 with 块外面还能用,with 只是结束了事务,cursor 对象还在。
- `@mcp.resource("cloudledger://policy/refund")` resource 是「一份可以读的资料」,通常由用户或 host 决定挂进上下文;tool 则由模型自己决定什么时候调用。`cloudledger://` 这个 scheme 是自定义的,随你起名。
- `"1. 重复扣款` 对应 T1041:C007 的 0123 和 0026 是重复扣款,按第 1 条应该全额退还重复的那一笔。几个相邻的字符串会自动拼起来,`\n` 是换行。
- `"2. 年付(专业版和企业版)中途取消` 和帮助中心 kb-002 的写法保持一致:只有专业版、企业版年付能按剩余整月退,基础版年付和月付一样,取消后用到本期结束。代入种子数据:C023 企业版 2 席年付,本期 2026-10-09 到 2027-10-09,今天 10-12,当月(10-09 开始的这个月)不退,剩 11 个整月,每月 29900 × 2 = 59800 分,可退 6578 元;C009 是基础版年付,按这条不退。两份资料说法不一致的话,Agent 会拿不准,要么乱退、要么全转人工,所以政策原文只能有一个版本。
- `"3. 月付` C007 的订阅是 monthly。如果客户说「下个月不用了,把这个月退给我」,按这条应该拒绝,不该提申请。这个金额该不该退、退多少,代码不判断,**它只管不超额**,对不对靠模型读政策加主管审批兜底。
- `"4. 所有退款需客服主管审批后执行。"` 和上面写死的 `pending_approval` 对应。
- `@mcp.prompt()` prompt 是第三种原语:**用户主动选用的提示词模板**,在 host 里通常显示成斜杠命令。
- `t = conn.execute("SELECT * FROM tickets` 代入 `"T1041"` → 查到 C007 的重复扣款工单。
- `raise ToolError(f"工单 {ticket_id} 不存在")` 代入 `"T9999"` 走到这里。严格说 prompt 不是工具,这里借用了 ToolError,SDK 一样会把它转成错误返回。
- `f"你是云簿的客服。请处理工单` 代入 T1041,生成:<br>`你是云簿的客服。请处理工单 T1041(客户 C007):`<br>`标题:重复扣款`<br>`内容:你好,10 月 8 号我被扣了两次款,INV-2026-0026 和 INV-2026-0123 金额一模一样,麻烦把多扣的那笔退给我。`<br>后面是固定的那句指令。模型拿到之后的理想路径:list_invoices 核实两笔 → 按政策第 1 条 → create_refund_request 提申请 → 回复客户「已提交,主管审批后 3 个工作日内原路退回」。
- `if __name__ == "__main__":` 直接 `python server.py` 时才启动;被测试文件 import 时不启动。
- `mcp.run()` 默认走 stdio:host 把它当子进程拉起来,通过 stdin/stdout 收发 JSON-RPC。

</div>

几处细节解释一下:

- `with db() as conn:` 是 sqlite3 的事务写法,块结束自动 commit。注意它不会关闭连接,学习项目无所谓,生产里你会用连接池。
- 为什么用同步的 `def` 而不是 `async def`?SQLite 查询很快,同步写法更简单。SDK 2.x 会把同步工具放到工作线程里跑,不会卡住事件循环。如果你的工具要调远程 API,用 `async def` 配合 httpx。
- `DB_PATH` 默认指向同目录下的 `cloudledger.db`,也可以用环境变量 `CLOUDLEDGER_DB` 指到别的文件。`seed.py` 用的是同一个约定,所以 `CLOUDLEDGER_DB=/tmp/test.db uv run python seed.py` 能造一份独立的测试库。
- `logging` 而不是 `print`,原因昨天讲过:stdio 模式下 stdout 是通信线路。
- `mcp.run()` 不带参数就是 stdio。想换 HTTP,改成 `mcp.run(transport="streamable-http", port=8765)`,其他代码一行不用动。

## 在 Inspector 里调试

```bash
cd w4/cloudledger
uv run mcp dev server.py
```

它会打印一个本地网址,浏览器打开后点 Connect。建议按这个顺序过一遍,每一步都想想「模型会怎么看到这个结果」:

1. Tools → List Tools,确认四个工具都在,点开 `list_invoices` 看 inputSchema 里的 pattern、enum、minimum。
2. 调 `find_customer`,query 填 `user007`,应该返回 C007。
3. 调 `get_subscription`,customer_id 故意填 `7`,看 SDK 在函数执行前就返回的校验错误。
4. 调 `list_invoices`,customer_id 填 `C007`,能看到两张 10 月 8 日的发票。
5. 调 `create_refund_request`,金额填 `999999`,看 ToolError 的提示;再填 `2392`,看返回的 `pending_approval`。
6. Resources 标签里读 `cloudledger://policy/refund`;Prompts 标签里用 `reply_ticket`,参数填 `T1041`。

Inspector 需要 Node.js,第一次运行会通过 npx 下载。如果卡在下载,检查一下 npm 的镜像或代理设置。

## 用内存客户端写测试

手动点 Inspector 只能验证一次,改了代码还得重新点。SDK 提供了一个很方便的测试方式:把 server 对象直接传给 `Client`,两者在同一个进程里通信,不起子进程、不开端口,但每个请求仍然完整地走一遍协议层,包括参数校验。

```python
# agent-60-lab/w4/cloudledger/test_server.py
"""用内存连接测 server:不起进程、不开端口,但请求照样走完整的 MCP 协议层。"""
import pytest

from mcp import Client

import seed
from server import mcp


@pytest.fixture(scope="module", autouse=True)
def fresh_db():
    seed.main()  # 每次测试前重建业务库,保证数据一致


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    async with Client(mcp, raise_exceptions=True) as c:
        yield c


@pytest.mark.anyio
async def test_lists_four_tools(client):
    names = {t.name for t in (await client.list_tools()).tools}
    assert names == {"find_customer", "get_subscription", "list_invoices", "create_refund_request"}


@pytest.mark.anyio
async def test_find_customer_by_email(client):
    r = await client.call_tool("find_customer", {"query": "user007@example.com"})
    assert not r.is_error
    assert r.structured_content["result"][0]["id"] == "C007"


@pytest.mark.anyio
async def test_unknown_customer_is_tool_error(client):
    r = await client.call_tool("find_customer", {"query": "nobody@nowhere"})
    assert r.is_error
    assert "没有找到" in r.content[0].text


@pytest.mark.anyio
async def test_bad_customer_id_rejected_by_schema(client):
    r = await client.call_tool("get_subscription", {"customer_id": "7"})
    assert r.is_error  # pattern ^C\d{3}$ 在函数执行前就拦下了


@pytest.mark.anyio
async def test_refund_cannot_exceed_invoice(client):
    r = await client.call_tool(
        "create_refund_request",
        {"invoice_id": "INV-2026-0123", "amount_yuan": 999999, "reason": "测试超额退款"},
    )
    assert r.is_error
    assert "最多还能申请" in r.content[0].text


@pytest.mark.anyio
async def test_refund_request_is_pending(client):
    r = await client.call_tool(
        "create_refund_request",
        {"invoice_id": "INV-2026-0123", "amount_yuan": 2392, "reason": "10 月 8 日重复扣款"},
    )
    assert not r.is_error
    assert r.structured_content["status"] == "pending_approval"
```

```bash
cd w4/cloudledger
uv run pytest -q test_server.py
```

`raise_exceptions=True` 只在测试里用:它让 server 内部的意外崩溃直接在测试里抛出真实异常,而不是被包装成一句笼统的「Internal server error」。工具里的 `ToolError` 不受影响,依然以 `is_error=True` 的结果返回,这正是我们要断言的。

把这个测试文件当成工具的「合同」。W5 做评测时你会发现,很多 Agent 的失败其实是工具本身的 bug,工具层有测试兜底,排查起来能省一半时间。

## 接进现成的 host

host 用 stdio 启动你的 server 时,工作目录和环境变量都不是你终端里的那一套,所以**路径一律写绝对路径**。这是新手接 MCP 最常见的失败原因,没有之一。

先在终端里确认启动命令本身能跑(没有任何输出、不退出,就是对的,Ctrl+C 结束):

```bash
uv run --directory /绝对路径/agent-60-lab python w4/cloudledger/server.py
```

**Claude Code**:

```bash
claude mcp add cloudledger -- uv run --directory /绝对路径/agent-60-lab python w4/cloudledger/server.py
```

进 Claude Code 输入 `/mcp` 确认已连接,然后直接问:「帮我看看 user007@example.com 这个客户最近的发票,有没有重复扣款?」你会看到它先调 `find_customer`,再调 `list_invoices`,然后指出两张同日同额的发票。

**Cursor**:项目根目录建 `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "cloudledger": {
      "command": "uv",
      "args": ["run", "--directory", "/绝对路径/agent-60-lab", "python", "w4/cloudledger/server.py"]
    }
  }
}
```

**Claude Desktop**:可以用 `uv run mcp install server.py --name cloudledger` 自动写配置,它会帮你把路径转成绝对路径。改完配置要**完全退出** Claude Desktop 再打开,只关窗口不算。连不上时去 `~/Library/Logs/Claude/` 看 `mcp-server-cloudledger.log`,里面是你 server 的 stderr。

## 不接模型,先写一个最小 client

接进 Claude Code 能用,不代表你知道它在背后发了什么。下一节我们要自己当 host,在那之前先写一个更小的东西:不调大模型,只用 SDK 的 `Client` 连上 server,把三样东西各列一遍,再手动调一次工具。它有两个用处,一是确认 server 在「别人的进程里」也能正常启动(内存客户端测不出这一点),二是以后接第三方 server 时,先用它看看对方到底暴露了什么,再决定要不要信它。

```python
# agent-60-lab/w4/mcp_probe.py
"""最小 MCP client:不接模型,把 server 的三样东西逛一遍,再手动调一个工具。"""
import asyncio
import json
import sys
from pathlib import Path

from mcp import Client, StdioServerParameters

SERVER = Path(__file__).parent / "cloudledger" / "server.py"


async def main() -> None:
    params = StdioServerParameters(command=sys.executable, args=[str(SERVER)])
    async with Client(params) as c:
        print("server:", c.server_info.name, "| 协议版本:", c.protocol_version)

        for t in (await c.list_tools()).tools:
            print(f"[tool] {t.name}: {(t.description or '').splitlines()[0]}")
        for r in (await c.list_resources()).resources:
            print(f"[resource] {r.uri}")
        for p in (await c.list_prompts()).prompts:
            print(f"[prompt] {p.name}")

        result = await c.call_tool("find_customer", {"query": "user007@example.com"})
        print("is_error =", result.is_error)
        print(json.dumps(result.structured_content, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `from mcp import Client, StdioServerParameters` 和测试里用的是同一个 `Client` 类。区别只在传给它什么:测试传 server 对象(同进程),这里传 `StdioServerParameters`(起子进程),下一节 HTTP 时传一个 URL 字符串。
- `SERVER = Path(__file__).parent` `__file__` 是 `.../agent-60-lab/w4/mcp_probe.py`,所以 `SERVER` 是 `.../agent-60-lab/w4/cloudledger/server.py`。用绝对路径,从哪个目录运行都找得到。
- `params = StdioServerParameters(` `command=sys.executable` 是当前虚拟环境的 Python,比如 `.../agent-60-lab/.venv/bin/python`,子进程就能找到同一套依赖。这里没传 `env`,server 用默认的数据库路径(相对于 server.py 的 `cloudledger.db`),够用。
- `async with Client(params) as c:` 进入时启动子进程、和 server 谈好协议版本;退出 `with` 时关掉子进程。你不用写任何 initialize。
- `print("server:"` 实测输出 `server: cloudledger | 协议版本: 2026-07-28`。`cloudledger` 是 server.py 里 `MCPServer("cloudledger")` 起的名字;协议版本说明 2.x 的 client 和 server 用上了新版无状态协议。
- `for t in (await c.list_tools()).tools:` 发 `tools/list`。`.tools` 是 Tool 对象列表,实测 4 个。这个结果对象上还有 `ttl_ms` 和 `cache_scope`,实测是 `0` 和 `"private"`,就是 Day 22 讲的缓存提示。
- `.splitlines()[0]` 只取描述第一行,免得多行 docstring 刷屏。实测第一行是 `[tool] find_customer: 按邮箱/姓名/公司/编号查找客户,返回最多 5 条。查订阅和发票前先用它拿到 customer_id。`
- `for r in (await c.list_resources()).resources:` 实测一条:`[resource] cloudledger://policy/refund`,就是前面写的退款政策。
- `for p in (await c.list_prompts()).prompts:` 实测一条:`[prompt] reply_ticket`。
- `result = await c.call_tool(` 手动调工具,和模型调用走的是完全同一条路,只是参数是你写死的。
- `print("is_error ="` 实测 `is_error = False`。
- `print(json.dumps(result.structured_content` 实测 `{"result": [{"id": "C007", "name": "刘静", "email": "user007@example.com", "company": "半岛咖啡"}]}`。`ensure_ascii=False` 让中文名照原样打出来,不变成 `刘静`。

</div>

```bash
uv run python w4/mcp_probe.py
```

输出:

```text
server: cloudledger | 协议版本: 2026-07-28
[tool] find_customer: 按邮箱/姓名/公司/编号查找客户,返回最多 5 条。查订阅和发票前先用它拿到 customer_id。
[tool] get_subscription: 查询客户当前订阅:套餐、计费周期、席位数、状态、开始日期、本期结束日。
[tool] list_invoices: 列出客户最近的发票(按开票日期倒序),金额单位为元。可按状态过滤。
[tool] create_refund_request: 提交一条退款申请,状态为 pending_approval,不会立刻退钱,需要客服主管审批。
[resource] cloudledger://policy/refund
[prompt] reply_ticket
is_error = False
{"result": [{"id": "C007", "name": "刘静", "email": "user007@example.com", "company": "半岛咖啡"}]}
```

这个脚本跑不通,下一节的 Agent 也一定跑不通,而它没有模型的随机性,报错只会是 server 本身的问题(路径、依赖、启动时往 stdout 打了东西)。我自己排查 MCP 问题的顺序就是:先 probe,再 Inspector,最后才看 Agent。

## 自己当 host:接到手写的 Agent 循环

现成 host 好用,但你做产品时 host 是你自己写的。这一节我们写一个最小的 host:用 OpenAI 兼容接口调 DeepSeek(或任何你在 `.env` 里配的模型),工具清单从 MCP server 拿,工具调用转发给 MCP server。

核心只有两个转换:

- MCP 的 `Tool` 对象 → OpenAI `tools` 参数。因为两边都是 JSON Schema,几乎就是改个字段名:`tool.input_schema` 放进 `function.parameters`。
- MCP 的 `CallToolResult` → tool 消息的 content 字符串。优先用 `structured_content` 序列化成 JSON;出错时加一个「[工具报错]」前缀,让模型明确知道这次失败了。

循环本身和 Day 9 一样:调模型,有 tool_calls 就逐个执行,结果追加到 messages,直到模型不再调用工具或步数用完。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="手写 host 的时序:启动时 list_tools,之后模型返回 tool_calls,host 通过 MCP client 调 call_tool,server 查 SQLite 后返回,结果作为 tool 消息回到模型">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">
    <text x="80" y="26">大模型</text>
    <text x="250" y="26">你的循环(host)</text>
    <text x="420" y="26">MCP server</text>
    <text x="570" y="26">SQLite</text>
  </g>
  <g stroke="var(--rule)">
    <line x1="80" y1="36" x2="80" y2="290"/>
    <line x1="250" y1="36" x2="250" y2="290"/>
    <line x1="420" y1="36" x2="420" y2="290"/>
    <line x1="570" y1="36" x2="570" y2="290"/>
  </g>
  <g font-family="var(--font-mono)" font-size="11">
    <line x1="250" y1="55" x2="420" y2="55" stroke="var(--compute)" stroke-width="1.5"/>
    <text x="335" y="50" text-anchor="middle" fill="var(--ink-soft)">① tools/list</text>
    <line x1="420" y1="72" x2="250" y2="72" stroke="var(--compute)" stroke-dasharray="4 3"/>
    <text x="335" y="86" text-anchor="middle" fill="var(--ink-faint)">4 个工具 → 转成 tools 参数</text>
    <line x1="250" y1="110" x2="80" y2="110" stroke="var(--mem)" stroke-width="1.5"/>
    <text x="165" y="105" text-anchor="middle" fill="var(--ink-soft)">② messages + tools</text>
    <line x1="80" y1="130" x2="250" y2="130" stroke="var(--mem)" stroke-dasharray="4 3"/>
    <text x="165" y="145" text-anchor="middle" fill="var(--ink-faint)">tool_calls: list_invoices</text>
    <line x1="250" y1="170" x2="420" y2="170" stroke="var(--compute)" stroke-width="1.5"/>
    <text x="335" y="165" text-anchor="middle" fill="var(--ink-soft)">③ tools/call</text>
    <line x1="420" y1="185" x2="570" y2="185" stroke="var(--rule)"/>
    <text x="495" y="180" text-anchor="middle" fill="var(--ink-faint)">SELECT</text>
    <line x1="420" y1="210" x2="250" y2="210" stroke="var(--compute)" stroke-dasharray="4 3"/>
    <text x="335" y="225" text-anchor="middle" fill="var(--ink-faint)">CallToolResult</text>
    <line x1="250" y1="250" x2="80" y2="250" stroke="var(--mem)" stroke-width="1.5"/>
    <text x="165" y="245" text-anchor="middle" fill="var(--ink-soft)">④ role=tool 消息</text>
    <text x="165" y="275" text-anchor="middle" fill="var(--ink-faint)">循环,直到不再调用工具</text>
  </g>
</svg>
<figcaption>蓝色是 function calling(模型和 host 之间),琥珀色是 MCP(host 和 server 之间)。昨天说的「两者在不同层」,在这张图里一目了然。</figcaption>
</figure>

```python
# agent-60-lab/w4/mcp_agent.py
"""把 MCP server 接到 Day 9 那种手写 Agent 循环上:工具清单从 server 拿,调用也转发给 server。"""
import asyncio
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from openai import AsyncOpenAI

from mcp import Client, StdioServerParameters

load_dotenv()
SERVER = Path(__file__).parent / "cloudledger" / "server.py"
MAX_STEPS = 8


def mcp_tool_to_openai(tool) -> dict:
    """MCP 的 Tool(name/description/input_schema)→ OpenAI 兼容的 tools 参数。"""
    return {
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description or "",
            "parameters": tool.input_schema,
        },
    }


def result_to_text(result) -> str:
    """把 CallToolResult 压成给模型看的字符串。出错时加前缀,让模型知道这次调用失败了。"""
    if result.structured_content is not None:
        body = json.dumps(result.structured_content, ensure_ascii=False)
    else:
        body = "\n".join(getattr(c, "text", "") for c in result.content)
    return f"[工具报错] {body}" if result.is_error else body


async def run(question: str) -> str:
    llm = AsyncOpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
    model = os.environ["LLM_MODEL"]
    # SDK 默认只给子进程传 HOME、PATH 等少数变量。开发时把当前环境整个传过去最省事(包括 CLOUDLEDGER_DB);
    # 生产里只传 server 真正需要的那几个,别把 LLM_API_KEY 之类的密钥也塞给它。
    server = StdioServerParameters(command=sys.executable, args=[str(SERVER)], env={**os.environ})

    async with Client(server) as mcp:
        listing = await mcp.list_tools()
        tools = [mcp_tool_to_openai(t) for t in listing.tools]
        print(f"[mcp] 连上 server,拿到 {len(tools)} 个工具:", [t["function"]["name"] for t in tools])

        messages = [
            {"role": "system", "content": "你是云簿 CloudLedger 的客服助手。先用工具查事实再回答,不要编造金额和单号。"},
            {"role": "user", "content": question},
        ]
        for step in range(1, MAX_STEPS + 1):
            resp = await llm.chat.completions.create(model=model, messages=messages, tools=tools)
            msg = resp.choices[0].message
            messages.append(msg.model_dump(exclude_none=True))
            if not msg.tool_calls:
                return msg.content or ""
            for call in msg.tool_calls:
                args = json.loads(call.function.arguments or "{}")
                print(f"[step {step}] {call.function.name}({args})")
                result = await mcp.call_tool(call.function.name, args)
                text = result_to_text(result)
                print(f"         → {text[:120]}")
                messages.append({"role": "tool", "tool_call_id": call.id, "content": text})
        return "步数用完了还没得出结论,转人工处理。"


if __name__ == "__main__":
    q = " ".join(sys.argv[1:]) or "客户 user007@example.com 说 10 月被扣了两次款,帮我核实一下,确实重复的话提交退款申请。"
    print(asyncio.run(run(q)))
```

`.env` 里配好模型(Day 3 讲过怎么拿 key):

```bash
# agent-60-lab/.env
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=sk-你的key
LLM_MODEL=填 DeepSeek 文档里当前的模型名
```

```bash
uv run python w4/mcp_agent.py
```

输出大致长这样(模型每次措辞不同,工具调用顺序也可能略有差异):

```text
[mcp] 连上 server,拿到 4 个工具: ['find_customer', 'get_subscription', 'list_invoices', 'create_refund_request']
[step 1] find_customer({'query': 'user007@example.com'})
         → {"result": [{"id": "C007", "name": "刘静", "email": "user007@example.com", "company": "半岛咖啡"}]}
[step 2] list_invoices({'customer_id': 'C007', 'limit': 6})
         → {"result": [{"id": "INV-2026-0123", "amount_cents": 239200, "status": "paid", "issued_at": "2026-10-08", ...
[step 3] create_refund_request({'invoice_id': 'INV-2026-0123', 'amount_yuan': 2392, 'reason': '10月8日重复扣款,与INV-2026-0026同日同额'})
         → {"refund_request_id": 1, "status": "pending_approval", "amount_yuan": "2392.00"}
已核实:客户 C007 在 2026-10-08 有两张金额同为 2392.00 元的发票(INV-2026-0026 和 INV-2026-0123),确认重复扣款。已提交退款申请(编号 1),金额 2392.00 元,目前等待主管审批……
```

注意 `StdioServerParameters` 里我用的是 `sys.executable`,也就是当前虚拟环境的 Python 去启动 server,这样 server 子进程能找到同一套依赖。还有一个坑:SDK 启动 stdio 子进程时**不会继承你的全部环境变量**,只传 HOME、PATH 这几个安全的。我们的 server 支持用 `CLOUDLEDGER_DB` 环境变量指定数据库位置(W5 做评测时每个测试用例要用一份干净的库副本,就靠它),所以这里写了 `env={**os.environ}`,把当前环境整个传给子进程。开发阶段这样最省事;生产里只传 server 真正需要的那几个变量,别把 `LLM_API_KEY` 这类和 server 无关的密钥也塞过去。

这段桥接代码就是你以后在任何框架里接 MCP 的原型。LangChain 1.4 起官方有一个 `langchain.mcp.MCPAdapter`(目前是 beta),OpenAI Agents SDK、Claude Agent SDK 也都内置了 MCP 支持,本质都是在做这两个转换。自己写过一遍,用框架时出了问题你知道往哪里查。

## 远程 server 和鉴权

stdio 只能本机用。要让服务器上的客服 Agent、同事的 Claude Desktop 都能连,就得换 Streamable HTTP:

```python
if __name__ == "__main__":
    mcp.run(transport="streamable-http", host="127.0.0.1", port=8765)
```

客户端那边只要把 `StdioServerParameters` 换成一个 URL:`Client("http://127.0.0.1:8765/mcp")`。

一旦上了网络,鉴权就躲不掉了。MCP 规范对 HTTP 传输规定的是 OAuth 2.1:server 作为资源服务器,client 通过授权服务器拿 token,每个请求带 `Authorization: Bearer ...`。完整的 OAuth 流程在 W6 部署时再细讲。内部系统的简化做法是在网关层校验一个固定的 API key;客户端侧,SDK 2.x 让你自己构造一个带 header 的 `httpx2.AsyncClient` 传给 `streamable_http_client(url, http_client=...)`。注意 2.x 里 `streamable_http_client` 不再直接接收 `headers=` 参数,这是从 1.x 升级时常见的报错。

另外,部署到公网的 MCP server 要考虑 DNS rebinding 防护、Host 白名单这些 Web 安全问题,SDK 的 Deploy 文档里有清单。今天不展开,记住一句话就行:**本机用 stdio,远程用 HTTP + 鉴权,永远不要把没有鉴权的写操作 server 暴露到公网**。

## 用 Gradio 快速放一个公网演示

写简历、发帖时你会想让别人点一个链接就能试你的 MCP server。自己买服务器、配 HTTPS、加鉴权,一套下来大半天。有个省事的办法:Gradio 的 `launch(mcp_server=True)`,一个 Python 函数同时变成网页表单和 MCP 工具,再丢到 Hugging Face Spaces 上免费托管,别人在 Claude Desktop 或 Cursor 里填个 URL 就能连。

先说一个我实际撞上的坑:2026 年 10 月最新的 Gradio 6.30.0,它的 `mcp` 可选依赖写的是 `mcp<2.0.0`,和我们 lab 里的 `mcp 2.3.0` 冲突,装不进同一个项目。所以演示版单独放一个目录,依赖分开:

```python
# cloudledger-demo/app.py
"""Gradio 演示版:网页上能点,同时是一个 MCP server。只放只读工具。"""
import json
import sqlite3
from pathlib import Path

import gradio as gr

DB = Path(__file__).parent / "cloudledger.db"


def find_customer(query: str) -> str:
    """按邮箱、姓名、公司或编号查找 CloudLedger 客户,最多返回 5 条。

    Args:
        query: 邮箱、姓名、公司名或客户编号,如 user007@example.com 或 C007
    """
    like = f"%{query.strip()}%"
    with sqlite3.connect(f"file:{DB}?mode=ro", uri=True) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT id, name, email, company FROM customers "
            "WHERE id = ? OR email LIKE ? OR name LIKE ? OR company LIKE ? LIMIT 5",
            (query.strip().upper(), like, like, like),
        ).fetchall()
    if not rows:
        return f"没有找到和「{query}」匹配的客户,换邮箱或客户编号再试。"
    return json.dumps([dict(r) for r in rows], ensure_ascii=False)


demo = gr.Interface(
    fn=find_customer,
    inputs=gr.Textbox(label="邮箱 / 姓名 / 公司 / 编号"),
    outputs=gr.Textbox(label="结果"),
    title="CloudLedger 客户查询(演示数据)",
    api_name="find_customer",
)

if __name__ == "__main__":
    demo.launch(mcp_server=True)
```

<div class="line-notes">

- `DB = Path(__file__).parent / "cloudledger.db"` 把 `w4/cloudledger/cloudledger.db` 复制一份到 `cloudledger-demo/` 里。演示用造的数据,别放真实客户数据,公网上谁都能查。
- `def find_customer(query: str) -> str:` Gradio 用函数名当工具名(`find_customer`),用类型标注生成参数 schema。返回 `str` 是因为输出组件是文本框。
- `"""按邮箱、姓名、公司或编号` docstring 第一段变成工具描述,`Args:` 下面那行变成参数 `query` 的描述。实测连上以后,`list_tools` 拿到的描述就是这一句,`input_schema` 是 `{"type": "object", "properties": {"query": {"type": "string", "description": "邮箱、姓名、公司名或客户编号,如 user007@example.com 或 C007"}}, "required": ["query"]}`。和 MCPServer 一样,描述写得好不好直接决定模型会不会用。
- `file:{DB}?mode=ro", uri=True` 以只读方式打开 SQLite。就算有人想办法注入 SQL,写操作也会被数据库本身拒掉。公网演示多加一层保险不吃亏。
- `WHERE id = ? OR email LIKE ?` 参数全部用 `?` 占位,不拼字符串。查 `C007` 时,`query.strip().upper()` 是 `"C007"`,`like` 是 `"%C007%"`,第一个条件就命中。
- `return f"没有找到` 查不到时返回一句能指导模型改参数的话。Gradio 这里没有 `ToolError`,只能用文字表达失败,`isError` 会是 false,这是它比 MCPServer 粗糙的地方。
- `return json.dumps([dict(r) for r in rows]` 实测查 `C007` 返回 `[{"id": "C007", "name": "刘静", "email": "user007@example.com", "company": "半岛咖啡"}]`。
- `api_name="find_customer",` 固定接口名。不写的话 Gradio 默认叫 `predict`,工具名会变得没意义。
- `demo.launch(mcp_server=True)` 同时启动网页(默认 7860 端口)和 MCP 端点 `http://127.0.0.1:7860/gradio_api/mcp/`。也可以不改代码,设环境变量 `GRADIO_MCP_SERVER=True`。

</div>

```bash
mkdir -p ~/Documents/cloudledger-demo && cd ~/Documents/cloudledger-demo
cp ~/Documents/agent-60-lab/w4/cloudledger/cloudledger.db .
# 把上面的 app.py 存到这里,然后:
uv run --no-project --python 3.12 --with "gradio[mcp]" python app.py
```

`--no-project --with` 的意思是临时建一个环境装 gradio,不碰任何项目的依赖,第一次要下载 30MB 左右。浏览器开 `http://127.0.0.1:7860` 能看到表单。然后用我们 lab 里的 2.x client 连它试试(在 lab 目录下执行):

```bash
cd ~/Documents/agent-60-lab
uv run python -c "
import asyncio
from mcp import Client
async def main():
    async with Client('http://127.0.0.1:7860/gradio_api/mcp/') as c:
        print(c.protocol_version, [t.name for t in (await c.list_tools()).tools])
        r = await c.call_tool('find_customer', {'query': 'C007'})
        print(r.is_error, r.content[0].text)
asyncio.run(main())
"
```

我实测的输出是:

```text
2025-11-25 ['find_customer']
False [{"id": "C007", "name": "刘静", "email": "user007@example.com", "company": "半岛咖啡"}]
```

注意第一行协议版本是 `2025-11-25`,不是 `2026-07-28`。Gradio 背后用的是 mcp 1.x,不认识新版协议,2.x 的 client 探测到以后自动退回老协议,你什么都不用做。这正是 Day 22 说的「SDK 2.x 两种都支持」。

**放到 Hugging Face Spaces。** 在 huggingface.co 新建一个 Space,SDK 选 Gradio,硬件选免费的 CPU。把 `app.py`、`cloudledger.db` 传上去,再加一个 `requirements.txt`,里面写一行 `gradio[mcp]`。Space 启动后,MCP 地址是 `https://你的用户名-space名.hf.space/gradio_api/mcp/`,网页底部的「View API」链接点进去,切到 MCP 那一栏,有可以直接复制的客户端配置。我只在本机跑通了,没有实际发布到 Spaces,发布步骤以 [Spaces 的 Gradio 文档](https://huggingface.co/docs/hub/spaces-sdks-gradio)为准。

几条边界要守住:只放只读工具和造的数据;Space 默认是公开的,谁都能调,免费 CPU 会休眠,第一次访问要等它醒;要加鉴权就得用 Gradio 的 `gr.Header` 读请求头里的 token,这已经超出「快速演示」的范围了。正式给团队用的 server 还是按上一节的 Streamable HTTP 加 OAuth 来。

## 动手练习

1. 按上面的步骤造数、写 server、跑测试,`pytest` 全绿。
2. 在 Inspector 里把六个检查点都过一遍,截图存进你的笔记。
3. 接进 Claude Code 或 Cursor 中的任意一个,问三个问题:「C012 是什么套餐、多少席位?」「星河餐饮最近有没有未付款的发票?」「user007 有重复扣款吗?有的话提交退款申请。」记录每个问题它调用了哪些工具、几步完成。
4. 跑通 `mcp_agent.py`。然后做一个对照实验:把 `find_customer` 的 docstring 改成只有「查找客户」四个字,删掉使用顺序提示,重跑三次同一个问题,看模型是否开始直接拿邮箱去调 `list_invoices`。把两种描述下的步数和失败次数记下来。
5. 加分题:新增一个只读工具 `get_ticket(ticket_id)`,返回工单详情,补上对应的测试。
6. 加分题:先跑 `mcp_probe.py` 确认四个工具、一个资源、一个提示词都在;再按「用 Gradio 快速放一个公网演示」那一节在本机起演示版,用 2.x client 连上去,看看协商出来的协议版本是哪个。

**验收标准**:测试全部通过;在 Claude Code 或 Cursor 里能用中文问出 C007 的重复扣款;`mcp_agent.py` 能自主完成「查客户 → 查发票 → 提交退款申请」三步,并且 `refund_requests` 表里出现一条 `pending_approval` 记录(`sqlite3 w4/cloudledger/cloudledger.db "select * from refund_requests"`);第 4 题的对照数据写进笔记。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| MCPServer | Python SDK 2.x 的高层 server 类,1.x 里叫 FastMCP |
| `@mcp.tool()` | 把函数注册成工具的装饰器,名字、描述、参数 schema 都从函数本身推导 |
| `Annotated` + `Field` | pydantic 的参数元数据写法,用来加描述和约束(pattern、ge、le) |
| `Literal` | 类型标注里的枚举,生成 JSON Schema 的 enum |
| ToolError | 工具执行失败、希望模型看到原因时抛出的异常 |
| ToolAnnotations | 工具行为提示:只读、破坏性、幂等、是否访问开放世界,只是提示不是安全机制 |
| structured_content | 工具结果的结构化部分,给程序用;content 是给模型读的文本 |
| outputSchema | 由函数返回值类型生成的输出结构定义 |
| MCP Inspector | 官方调试界面,`uv run mcp dev server.py` 启动 |
| 内存客户端 | `Client(mcp)`,同进程连接 server,用于测试 |
| StdioServerParameters | 描述如何把 server 作为子进程启动(命令、参数、环境变量) |
| probe 脚本 | 不接模型、只列工具和手动调用的最小 client,用来先排除 server 本身的问题 |
| `mcp_server=True` | Gradio `launch()` 的参数,把界面函数同时暴露成 MCP 工具,端点在 `/gradio_api/mcp/` |
| Hugging Face Spaces | Hugging Face 的免费应用托管,适合放公开演示,不适合放真实数据 |
| 幂等(idempotent) | 同样的调用执行一次和执行多次效果相同 |

## 常见误区

**工具失败时返回错误字符串。** 模型会以为调用成功了。可纠正的错误用 `ToolError`,并在消息里写清怎么改。

**用浮点数存金额。** 对账差一分钱的问题迟早出现。存整数「分」,展示时再转元;工具参数接收元时,用 `round(x * 100)` 转换。

**host 配置里写相对路径。** host 启动 server 的工作目录不是你的项目目录,相对路径大概率找不到文件。命令、脚本、数据库路径都用绝对路径,数据库路径最好像本文这样默认相对于 `__file__` 计算,需要换库时用环境变量覆盖。

**以为 server 子进程能读到你终端里的环境变量。** SDK 只传少数几个安全变量,需要的变量用 `env=` 显式传;Claude Desktop 则在配置的 `env` 字段里写。

**相信 annotations 能挡住危险操作。** 它们是给 host 的提示,server 可以随便标。危险操作的防线要放在 server 内部逻辑和 host 侧的人工确认上。

**让 Agent 直接执行退款、删除这类不可逆操作。** 至少在有评测数据证明可靠之前,写操作做成「提交申请」,由人审批。

**照抄 1.x 教程的 `streamable_http_client(url, headers=...)`。** 2.x 里会报 `unexpected keyword argument 'headers'`,header 要配在你传进去的 `httpx2.AsyncClient` 上。

## 学习资料

### 文档与文章

- [MCP Python SDK 文档](https://py.sdk.modelcontextprotocol.io/):今天主要读 Get started 下的 First steps、Connect to a real host、Testing 三页,以及 Servers 下的 Tools、Structured Output、Handling errors,合计约 1.5 小时。所有例子都是 2.x 写法。
- [Gradio · Building an MCP Server with Gradio](https://www.gradio.app/guides/building-mcp-server-with-gradio):`mcp_server=True` 的官方说明,看 docstring 怎么变成工具描述、怎么接 Claude Desktop、怎么放到 Spaces,20 分钟。
- [MCP Python SDK · Migration Guide](https://py.sdk.modelcontextprotocol.io/migration/):如果你手上有 1.x 的代码或教程,这页列出了每一个破坏性改动的前后对照。
- [Anthropic · Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents):Day 11 读过的话今天重读「返回有意义的上下文」和「错误信息」两节,对照你的 ToolError 消息改一遍。
- [MCP 规范 · Tools](https://modelcontextprotocol.io/specification/2026-07-28):在规范目录里找到 Server Features → Tools,看 annotations 和错误处理的原文规定。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Y854zmEg9&autoplay=0&high_quality=1" title="MCP终极指南 - 带你深入掌握MCP(进阶篇)" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>马克的技术工作坊 · MCP终极指南 - 带你深入掌握MCP(进阶篇) · 27 分钟。昨天基础篇的续集,讲 server 开发和 host 如何调用。代码是 2025 年的 FastMCP 写法,看思路,写法以本文为准。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1RNTtzMENj&autoplay=0&high_quality=1" title="从零编写MCP并发布上线,超简单!手把手教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>技术爬爬虾 · 从零编写MCP并发布上线,超简单!手把手教程 · 16 分钟,从写到发布到 PyPI 的全流程,看「发布」那部分,知道别人是怎么用 uvx 一行命令装你的 server 的。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/kQmXtrmQ5Zg" title="Building Agents with Model Context Protocol - Full Workshop with Mahesh Murag of Anthropic" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · Building Agents with Model Context Protocol - Full Workshop with Mahesh Murag of Anthropic · 1 小时 44 分。MCP 团队成员的完整工作坊,前 40 分钟讲设计理念和 server 开发,后面讲远程 server、鉴权和注册表。今天看前半,后半留到 W6。</figcaption>
</figure>

- DeepLearning.AI 短课 [MCP: Build Rich-Context AI Apps with Anthropic](https://www.deeplearning.ai/short-courses/mcp-build-rich-context-ai-apps-with-anthropic/):昨天看了概念部分,今天看写 server 和写 client 的几节。B 站有中文字幕搬运,搜「吴恩达 用MCP构建AI Apps」。

### 书籍

- 今天这组不需要。MCP 和它的 Python SDK 更新太快,纸质书跟不上,以官方文档为准。想补底层的话,翻翻 Chip Huyen《AI Engineering》(O'Reilly, 2025)第 6 章关于工具调用和写操作风险的段落。

### 开源项目与代码

- [modelcontextprotocol/python-sdk](https://github.com/modelcontextprotocol/python-sdk):`examples/` 目录下有各种 server 和 client 示例,遇到不会写的功能先来这里找。
- [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers):对照读 `src/fetch` 的实现,看官方怎么处理长文本分页和错误。
- [MCP Registry](https://registry.modelcontextprotocol.io):搜 postgres、sqlite,看看别人怎么设计数据库类 server 的工具粒度。很多数据库 server 只给一个「执行 SQL」工具,想想它和我们这种「每个业务查询一个工具」的设计各有什么利弊。

## 自测

1. `list_invoices` 的 `limit` 参数写成 `Annotated[int, Field(ge=1, le=20)] = 6`。模型传了 `limit=100`,会发生什么?你的函数会被执行吗?

<details><summary>答案</summary>

不会执行。SDK 根据 schema 在调用函数之前做校验,发现超过 maximum 20,直接返回 `isError: true` 的结果,content 里说明哪个字段违反了什么约束。模型读到后一般会改成 20 以内重试。

</details>

2. 下面两种写法,模型看到的结果有什么区别?

```python
# 写法 A
if inv is None:
    return f"发票 {invoice_id} 不存在"
# 写法 B
if inv is None:
    raise ToolError(f"发票 {invoice_id} 不存在。先用 list_invoices 查到正确的发票号。")
```

<details><summary>答案</summary>

A 返回的是一个 `isError: false` 的正常结果,模型和 host 都会以为调用成功,「不存在」只是一段普通文本,模型可能照着它继续往下编。B 返回 `isError: true`,明确标记失败,而且消息里告诉模型下一步该做什么。B 的写法才能让 Agent 自我纠正。

</details>

3. 你的 server 在 Inspector 里一切正常,配进 Claude Desktop 后却显示连接失败。列出你会依次检查的三件事。

<details><summary>答案</summary>

一,配置里的命令和路径是不是绝对路径,uv 本身也要写绝对路径(`which uv` 查),因为 Claude Desktop 启动子进程时 PATH 很短;二,在终端里原样执行那条启动命令,看是否报错退出(正常应该无输出地挂着);三,看 `~/Library/Logs/Claude/mcp-server-<名字>.log` 里的 stderr,常见的是缺环境变量、数据库文件找不到,或者代码里有 print 污染了 stdout。另外别忘了改配置后要完全退出再打开。

</details>

4. `create_refund_request` 被标成 `idempotent_hint=False`。如果 Agent 因为网络超时重试了一次同样的调用,会发生什么?怎么在 server 侧防住?

<details><summary>答案</summary>

会插入两条一样的退款申请。防法:让调用方传一个幂等键(比如工单号 + 发票号),server 插入前先查是否已有相同键的申请,有就直接返回已有记录;或者在表上建唯一约束。这里现有的「已申请金额不能超过发票金额」校验也能挡住第二次全额申请,但部分退款的场景挡不住。Day 37 讲可靠性时会系统讲幂等。

</details>

5. 你写的桥接代码里,`result_to_text` 为什么优先用 `structured_content` 而不是 `content`?有没有不该这么做的情况?

<details><summary>答案</summary>

structured_content 是严格按 outputSchema 输出的 JSON,字段完整、格式稳定,序列化后给模型读不会丢信息。但如果工具返回的是图片、长篇文本这类非结构化内容,或者 content 里有专门为模型写的说明(比如「共 200 条,只显示前 20 条」),就应该用 content。更稳的做法是两者都看:有 content 文本就用 content,没有再退回 structured_content。

</details>

6. **面试题**:「如果让你把公司的订单系统开放给 AI Agent 用,你会怎么设计这个 MCP server?」

<details><summary>答案</summary>

参考要点:先按业务动作设计工具,而不是暴露一个通用的「执行 SQL」(安全、可控、模型更容易用对);读写分离,只读工具可以放开,写操作做成「提交申请」或要求人工确认,并做幂等;参数用 schema 约束(编号格式、枚举、上限),错误信息告诉模型怎么改;返回值精简,金额单位统一,大列表分页;传输上本机调试用 stdio,给多个应用用就部署成 Streamable HTTP,加鉴权(OAuth 2.1 或网关 API key)、审计日志、限流;用内存客户端写工具层测试;上线前用评测集验证 Agent 在这些工具上的成功率。能举 CloudLedger 这种具体例子会更有说服力。

</details>

## 明天预告

Day 24 · LangGraph 入门:状态、节点、边、条件路由。到今天为止,Agent 的控制流都写在一个 while 循环里,步骤一多就开始变成意大利面。明天用 LangGraph 把它画成一张图:先用图重写 Day 9 的 Agent 循环,再写一个工单分类、按类别走不同分支的工作流,为 W4 的小项目搭骨架。
