---
title: 'Day 291 · 问数 Agent(一):给模型一份库说明书'
description: '「用大白话查数据」是企业里最常被提的 Agent 需求。今天先不管安全和循环,只解决一件事:模型凭什么知道你们库里存的是什么。只给列名时 6 道题错 5 道,而且每道错题都安安静静返回一个看起来合理的数;我们一层层加上带注释的建表语句、枚举列的真实取值和业务术语表,看每一层分别救回了哪几题。'
pubDate: 2026-10-23
regime: none
tags: ['text-to-sql', 'nl2sql', 'sqlite', 'schema', 'glossary', 'agent-zero']
series: 'agent-zero'
day: 291
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 290](/blog/agent-zero/day-290-mcp-remote/) 把 CloudLedger server 换成了 Streamable HTTP,用一条 curl 证明了没鉴权的 server 谁都能调写工具,然后用 Starlette 中间件加上 Bearer token,最后用 Gradio 做了一个只读的演示版。到这里,「写一个 MCP server」这条线就收尾了。

回头看这个 server,它有四个写死的工具:查客户、查订阅、列发票、提退款申请。客服的日常问题它都能答。可老板要是问「现在 MRR 多少」「企业版有几个客户」「最近一周进了多少工单」,四个工具一个都用不上。每来一个问题加一个工具显然不现实。另一条路是让模型自己写 SQL 去查库,这就是今天开始的「问数 Agent」。

## 今天要解决的问题

学完今天,你要能做到:

1. 说清楚「问数」难在哪:不是模型不会写 SQL,而是它不知道你们库里的值长什么样、业务口径怎么定。
2. 写出 `part05/text2sql/schema.py`,生成一份三层的「库说明书」:带注释的建表语句、枚举列的真实取值、业务术语表。
3. 用同一组 6 道题,对比说明书从薄到厚五个档次各答对几道,并能指着错题说出缺的是哪一层。

预计用时 2.5 小时。实跑花费约 ¥0.06(算式在「花了多少钱」一节)。

前置:[Day 85](/blog/agent-zero/day-085-sql-1/) 到 [Day 91](/blog/agent-zero/day-091-sql-6/) 的 SQL(SELECT、WHERE、JOIN、GROUP BY、聚合)、[Day 92](/blog/agent-zero/day-092-python-sqlite-1/)(Python 里用 sqlite3、`?` 占位符)、[Day 280](/blog/agent-zero/day-280-mcp-seed/)(`cloudledger/seed.py` 和那五张表)、[Day 135](/blog/agent-zero/day-135-llm-client-1/)(`common/llm.py` 的 `LLMClient`)、[Day 148](/blog/agent-zero/day-148-structured-2/)(JSON mode)、[Day 110](/blog/agent-zero/day-110-sampling-1/)(temperature)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `schema.py` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 问数 Agent 长什么样

用户问一句话,Agent 要做的不只是「翻译成 SQL」。完整的样子是这张图,接下来四天一块一块做:

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="问数 Agent 的全貌:用户问题交给模型写 SQL,模型要看库说明书;SQL 经过三道闸后执行;执行报错或结果自检不通过就带着原因回去重写;通过后用人话回答。标出了每部分在哪一天做">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="40" width="100" height="40" rx="4" fill="none" stroke="var(--ink-soft)"/><text x="70" y="65" fill="var(--ink)" text-anchor="middle">用户问题</text>
<line x1="120" y1="60" x2="150" y2="60" stroke="var(--ink-soft)"/>
<rect x="150" y="40" width="120" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="210" y="58" fill="var(--ink)" text-anchor="middle">模型写 SQL</text><text x="210" y="73" fill="var(--ink-faint)" text-anchor="middle" font-size="11">看库说明书</text>
<rect x="150" y="100" width="120" height="30" rx="4" fill="var(--paper-raised)" stroke="var(--mem)" stroke-width="2"/><text x="210" y="120" fill="var(--mem)" text-anchor="middle">今天:说明书</text>
<line x1="210" y1="80" x2="210" y2="100" stroke="var(--mem)"/>
<line x1="270" y1="60" x2="300" y2="60" stroke="var(--ink-soft)"/>
<rect x="300" y="40" width="120" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="360" y="58" fill="var(--ink)" text-anchor="middle">三道闸</text><text x="360" y="73" fill="var(--ink-faint)" text-anchor="middle" font-size="11">Day 292</text>
<line x1="420" y1="60" x2="450" y2="60" stroke="var(--ink-soft)"/>
<rect x="450" y="40" width="170" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="535" y="65" fill="var(--ink)" text-anchor="middle">执行 cloudledger.db</text>
<line x1="535" y1="80" x2="535" y2="150" stroke="var(--ink-soft)"/>
<rect x="450" y="150" width="170" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="535" y="168" fill="var(--ink)" text-anchor="middle">结果自检、用人话答</text><text x="535" y="183" fill="var(--ink-faint)" text-anchor="middle" font-size="11">Day 294</text>
<path d="M450 165 Q300 200 230 135" fill="none" stroke="var(--compute)" stroke-dasharray="4 3"/>
<text x="250" y="200" fill="var(--compute)" font-size="11">报错 / 自检不过:带原因重写(Day 294)</text>
<text x="20" y="235" fill="var(--ink-faint)" font-size="11">Day 294 还有 10 道题评测;Day 295 讲表多了怎么办、语义层和基准</text>
</g>
</svg>
<figcaption>问数 Agent 的全貌。蓝色是调模型的步骤,琥珀色是执行和防护。今天只做最左边那块:模型写 SQL 时看的那份说明书。</figcaption>
</figure>

为什么今天先做说明书,而不是先把循环跑起来?因为 2026 年的模型写 SQL 的语法已经很少出错了,今天你会看到它随手就写出子查询和 `CASE`。真正让问数出错的是另外两件事:模型不知道库里的**值**长什么样(套餐存的是「企业版」还是 `enterprise`?),也不知道公司的**口径**(MRR 怎么算?「最近 7 天」以哪天为准?)。这两件事都不会报错,SQL 跑得通,返回一个数,只是数不对。这种错比报错可怕得多。

## 准备

所有命令在 `agent-zero-lab/` 根目录跑(我的是 `/Users/你/agent-zero-lab`)。问数的代码单独放一个子目录:

```bash
mkdir -p part05/text2sql
touch part05/text2sql/__init__.py
uv run python cloudledger/seed.py
```

<div class="line-notes">

- `mkdir -p part05/text2sql` 问数这四天的文件都放这里,和 MCP server 那一堆分开。
- `touch part05/text2sql/__init__.py` 建一个空文件,让它成为包([Day 33](/blog/agent-zero/day-033-packages/)),这样才能 `from part05.text2sql.xxx import ...`、用 `uv run python -m part05.text2sql.xxx` 跑。
- `uv run python cloudledger/seed.py` 重置业务库。输出 `已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}`。Day 290 往 `refund_requests` 里写过东西,重置一下,今天的数字才能和文章对上。

</div>

`.env` 里要有 [Day 120](/blog/agent-zero/day-120-api-register/) 配好的 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`(我用的是 `deepseek-flash`),`LLMClient` 从这里读。今天不需要装新包。

## 第 1 步:最朴素的说明书,只有列名

网上大部分 Text-to-SQL 入门教程是这么做的:把每张表的名字和列名列给模型,然后问问题。先照做一遍,看看它能走多远。

```python
# agent-zero-lab/part05/text2sql/bare_schema.py
"""最朴素的「说明书」:只有表名和列名。先看看模型拿着它能写成什么样。"""
import os
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB_PATH = Path(os.environ.get("CLOUDLEDGER_DB", ROOT / "cloudledger" / "cloudledger.db"))


def connect_ro() -> sqlite3.Connection:
    """只读方式打开业务库。明天(Day 292)会讲为什么、以及它还挡不住什么。"""
    return sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)


def bare_schema() -> str:
    with connect_ro() as conn:
        tables = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )]
        lines = []
        for t in tables:
            cols = [r[1] for r in conn.execute(f"PRAGMA table_info({t})")]
            lines.append(f"{t}({', '.join(cols)})")
    return "\n".join(lines)


if __name__ == "__main__":
    print(bare_schema())
```

<div class="line-notes">

- `ROOT = Path(__file__).resolve().parents[2]` `__file__` 是这个文件的路径 `.../agent-zero-lab/part05/text2sql/bare_schema.py`,`.resolve()` 变成绝对路径,`.parents[0]` 是 `text2sql/`,`[1]` 是 `part05/`,`[2]` 就是 `agent-zero-lab/`。用它拼路径,不管你在哪个目录运行都找得到库。
- `DB_PATH = Path(os.environ.get("CLOUDLEDGER_DB", ROOT / "cloudledger" / "cloudledger.db"))` 和 `server.py`、`seed.py` 同一个约定:有 `CLOUDLEDGER_DB` 环境变量就用它,没有就用默认那个库。四天的问数代码都从这里拿路径。
- `def connect_ro() -> sqlite3.Connection:` 一个小函数,统一用只读方式打开。
- `return sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)` 把路径写成 `file:` 开头的网址形式,`?mode=ro` 表示只读,`uri=True` 告诉 sqlite3 按网址解析。今天模型写的 SQL 会被直接执行,先用只读挡一挡;它能挡什么、挡不住什么,明天专门讲。
- `"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"` `sqlite_master` 是 SQLite 自带的系统表,库里每张表、每个索引在里面都有一行。`type = 'table'` 只要表;`sqlite_sequence` 是 `AUTOINCREMENT` 自动建的内部表,用 `NOT LIKE 'sqlite_%'` 排除掉。实跑拿到 `customers`、`invoices`、`refund_requests`、`subscriptions`、`tickets` 五张。
- `cols = [r[1] for r in conn.execute(f"PRAGMA table_info({t})")]` `PRAGMA table_info(表名)` 是 SQLite 查表结构的命令,每列返回一行 `(序号, 列名, 类型, 是否非空, 默认值, 是否主键)`,`r[1]` 取列名。表名用 f-string 拼进去是安全的,因为它来自上一行从系统表查出来的结果,不是用户输入。
- `lines.append(f"{t}({', '.join(cols)})")` 拼成 `customers(id, name, email, company, created_at)` 这种一行一张表的格式。

</div>

`uv run python -m part05.text2sql.bare_schema`:

```text
customers(id, name, email, company, created_at)
invoices(id, customer_id, subscription_id, amount_cents, status, issued_at, paid_at)
refund_requests(id, invoice_id, amount_cents, reason, status, created_at, decided_at, decided_by)
subscriptions(id, customer_id, plan, billing_cycle, seats, status, started_at, current_period_end)
tickets(id, customer_id, subject, body, status, created_at)
```

五行,389 个字符。看着挺清楚的,你作为人类读得懂吗?`plan` 里存的是什么?`status` 有哪几种?`amount_cents` 你大概猜得到是「分」。记住你此刻的困惑,模型的困惑和你一样。

## 第 2 步:让模型写 SQL,跑一下

写一个最小的脚本:把说明书和问题交给模型,要它只回一条 SQL,然后在只读连接上跑。

```python
# agent-zero-lab/part05/text2sql/try_sql.py
"""拿一份说明书让模型写 SQL,在只读连接上跑一下,看结果对不对。"""
import json
import sys

from common.llm import LLMClient
from part05.text2sql.bare_schema import bare_schema, connect_ro

SQL_PROMPT = """你是 CloudLedger 的数据分析师,数据库是 SQLite。根据下面的库说明书写一条 SELECT 回答问题。
只输出 JSON:{{"sql": "..."}}

{schema}"""

llm = LLMClient()


def write_sql(schema: str, question: str) -> str:
    messages = [
        {"role": "system", "content": SQL_PROMPT.format(schema=schema)},
        {"role": "user", "content": question},
    ]
    r = llm.chat(messages, response_format={"type": "json_object"}, temperature=0)
    return json.loads(r.content)["sql"]


def run_readonly(sql: str) -> list[tuple]:
    with connect_ro() as conn:
        return conn.execute(sql).fetchall()


if __name__ == "__main__":
    question = sys.argv[1] if len(sys.argv) > 1 else "试用中的订阅有几个?"
    sql = write_sql(bare_schema(), question)
    print("SQL:", sql)
    print("结果:", run_readonly(sql))
    print("账单:", llm.ledger)
```

<div class="line-notes">

- `from common.llm import LLMClient` [Day 135](/blog/agent-zero/day-135-llm-client-1/) 建的模型客户端,自带记账。
- `SQL_PROMPT = """你是 CloudLedger 的数据分析师,数据库是 SQLite。` 告诉它方言是 SQLite。不说的话它可能写出 MySQL 的 `DATE_SUB` 或 Postgres 的 `::date`,在 SQLite 上直接报错。
- `只输出 JSON:{{"sql": "..."}}` 要求固定格式,代码好解析。双花括号 `{{` `}}` 是因为这个字符串后面要 `.format()`,单花括号会被当成占位符,双写才是字面的 `{`。提示词里出现「JSON」这个词也是 DeepSeek JSON mode 的硬性要求,它的文档写的是 system 或 user 消息里「必须含有 json 字样」([Day 148](/blog/agent-zero/day-148-structured-2/))。
- `{schema}"""` 说明书放在 system 消息里。四天里所有调模型写 SQL 的地方都走这个函数,只换 `schema`。
- `llm = LLMClient()` 模块级只建一个,后面几个脚本导入 `write_sql` 时共用同一个账本,方便看总花费。
- `r = llm.chat(messages, response_format={"type": "json_object"}, temperature=0)` `json_object` 让模型保证输出合法 JSON;`temperature=0` 让它尽量每次选概率最高的词([Day 110](/blog/agent-zero/day-110-sampling-1/)),便于对比实验。尽量,不是保证,后面会看到同一题两次跑出不同 SQL。
- `return json.loads(r.content)["sql"]` 解析 JSON,取出 SQL 字符串。
- `def run_readonly(sql: str) -> list[tuple]:` 在只读连接上执行并取回所有行。今天先这么裸跑,明天给它加三道闸。
- `question = sys.argv[1] if len(sys.argv) > 1 else "试用中的订阅有几个?"` 命令行第一个参数当问题,没给就用默认问题。`sys.argv` 相当于 Node 的 `process.argv.slice(1)`。

</div>

直接用 `python part05/text2sql/try_sql.py` 运行会报:

```text
ModuleNotFoundError: No module named 'common'
```

这个坑 Day 33 讲过:按文件路径运行时,Python 只把脚本所在的目录放进搜索路径,看不到根目录下的 `common/`。要用 `-m` 从根目录按模块跑。连问四个问题:

```bash
uv run python -m part05.text2sql.try_sql "试用中的订阅有几个?"
uv run python -m part05.text2sql.try_sql "2026 年 10 月开出的发票一共多少元?"
uv run python -m part05.text2sql.try_sql "最近 7 天新建了几张工单?"
uv run python -m part05.text2sql.try_sql "现在的 MRR 是多少元?"
```

我的输出(每次只贴 SQL、结果和账单):

```text
SQL: SELECT COUNT(*) AS trial_subscription_count FROM subscriptions WHERE status = 'trialing'
结果: [(2,)]
账单: 1 次调用 | 输入 167 / 输出 22 tokens | 约 ¥0.0005

SQL: SELECT SUM(amount_cents) / 100.0 AS total_yuan FROM invoices WHERE issued_at >= '2026-10-01' AND issued_at < '2026-11-01'
结果: [(103409.0,)]
账单: 1 次调用 | 输入 177 / 输出 47 tokens | 约 ¥0.0007

SQL: SELECT COUNT(*) AS ticket_count FROM tickets WHERE created_at >= datetime('now', '-7 days')
结果: [(0,)]
账单: 1 次调用 | 输入 173 / 输出 25 tokens | 约 ¥0.0005

SQL: SELECT ROUND(SUM(CASE WHEN billing_cycle = 'monthly' THEN amount_cents WHEN billing_cycle = 'yearly' THEN amount_cents / 12.0 ELSE 0 END) / 100.0, 2) AS mrr_yuan FROM subscriptions s JOIN invoices i ON i.subscription_id = s.id WHERE s.status = 'active' AND i.status = 'paid'
结果: [(79175.0,)]
账单: 1 次调用 | 输入 169 / 输出 90 tokens | 约 ¥0.0011
```

我自己手写 SQL 查过正确答案:试用 2 个,10 月发票 103409 元,最近 7 天工单 25 张,MRR 20273 元(怎么算的后面讲)。前两题对了,后两题错了。

第一题它猜对了 `trialing`,是因为 Stripe 等计费系统普遍用这个词,训练数据里见多了。第二题它看列名 `amount_cents` 就知道要除以 100。模型确实很聪明。

第三题错在「今天」:`datetime('now', '-7 days')` 用的是你运行脚本的那天(我跑的时候是 2026-10-22),而这份假数据是按 2026-10-12 造的,工单都在 9 月 28 日到 10 月 12 日之间,往前数 7 天一张都没有。结果是 0,不报错。

第四题错得更有意思。库里没有价格表,模型没法知道每个套餐多少钱,于是它自己发明了一个口径:把所有已付发票的金额加起来,年付的除以 12。SQL 写得有模有样,数字是 79175 元,比正确答案大了将近 4 倍。如果你是老板,你看到这个数会怀疑吗?

再试三个:

```bash
uv run python -m part05.text2sql.try_sql "企业版的订阅有几个?"
uv run python -m part05.text2sql.try_sql "欠费的客户有几家?"
uv run python -m part05.text2sql.try_sql "按年付费的有效订阅有几个?"
```

```text
SQL: SELECT COUNT(*) AS subscription_count FROM subscriptions WHERE plan = 'enterprise'
结果: [(0,)]

SQL: SELECT COUNT(DISTINCT customer_id) AS overdue_customers FROM invoices WHERE status = 'overdue'
结果: [(0,)]

SQL: SELECT COUNT(*) AS active_annual_subscriptions FROM subscriptions WHERE billing_cycle = 'annual' AND status = 'active'
结果: [(0,)]
```

三道全是 0,正确答案是 8、3、9。错的方式一模一样:模型**猜了一个值**。库里套餐存的是中文「企业版」,它猜 `enterprise`;欠费在订阅表里叫 `past_due`,它猜发票表的 `overdue`;年付存的是 `yearly`,它猜 `annual`。每一个猜测在英文世界里都很合理,SQL 语法也完全正确,`WHERE` 一个都匹配不上,于是返回 0。

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="同一个问题,模型猜的值和库里真实的值对不上,WHERE 匹配不到任何行,COUNT 返回 0,不报错">
<rect x="0" y="0" width="640" height="200" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="30" fill="var(--ink)">模型猜的值</text>
<text x="330" y="30" fill="var(--ink)">库里真实的值</text>
<rect x="20" y="45" width="250" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="30" y="65" fill="var(--ink)">plan = 'enterprise'</text>
<rect x="330" y="45" width="290" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="340" y="65" fill="var(--ink)">专业版 / 企业版 / 基础版</text>
<rect x="20" y="85" width="250" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="30" y="105" fill="var(--ink)">invoices.status = 'overdue'</text>
<rect x="330" y="85" width="290" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="340" y="105" fill="var(--ink)">subscriptions.status = past_due</text>
<rect x="20" y="125" width="250" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="30" y="145" fill="var(--ink)">billing_cycle = 'annual'</text>
<rect x="330" y="125" width="290" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="340" y="145" fill="var(--ink)">monthly / yearly</text>
<line x1="270" y1="60" x2="330" y2="60" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
<line x1="270" y1="100" x2="330" y2="100" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
<line x1="270" y1="140" x2="330" y2="140" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
<text x="300" y="185" fill="var(--ink-soft)" text-anchor="middle">对不上 → WHERE 一行都不匹配 → COUNT 返回 0,不报错</text>
</g>
</svg>
<figcaption>只看列名时,模型只能按常识猜值。猜错不会报错,只会安静地返回 0。</figcaption>
</figure>

**这一步的小结**:7 道题错了 5 道,没有一道报错。错误分两类:一类是**不知道值**(enterprise、overdue、annual),一类是**不知道口径**(今天是哪天、MRR 怎么算)。下面三层说明书就是分别治这两类病的。

## 第 3 步:第一层,带注释的建表语句

[Day 280](/blog/agent-zero/day-280-mcp-seed/) 写 `seed.py` 时,每张表的关键列后面都写了 SQL 注释(`--` 开头的那段)。SQLite 有个好习惯:它把建表时的**原文**原封不动存在 `sqlite_master` 的 `sql` 列里,注释也在。取出来看看:

```python
# agent-zero-lab/part05/text2sql/ddl_peek.py
"""第一层:SQLite 把建表原文(连注释)存在 sqlite_master 里,取出来看看。"""
from part05.text2sql.bare_schema import connect_ro

with connect_ro() as conn:
    row = conn.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'invoices'").fetchone()
print(row[0])
```

<div class="line-notes">

- `row = conn.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'invoices'").fetchone()` 只取 `invoices` 这一张表的建表原文。`fetchone()` 取一行,是一个只有一个元素的元组。
- `print(row[0])` 取出那个字符串打印。

</div>

`uv run python -m part05.text2sql.ddl_peek`:

```text
CREATE TABLE invoices (
    id               TEXT PRIMARY KEY,     -- INV-2026-0001
    customer_id      TEXT NOT NULL REFERENCES customers(id),
    subscription_id  TEXT NOT NULL REFERENCES subscriptions(id),
    amount_cents     INTEGER NOT NULL,     -- 金额一律用「分」存,避免浮点误差
    status           TEXT NOT NULL,        -- paid / open / void / refunded
    issued_at        TEXT NOT NULL,
    paid_at          TEXT
)
```

这比一行列名多了很多信息:每列的类型,`REFERENCES` 说明了 `invoices.customer_id` 指向 `customers.id`(模型就知道怎么 JOIN),注释写了金额单位、编号格式、状态有哪几种。对模型来说,这些注释就是文档。

建表语句一般叫 **DDL**(Data Definition Language,数据定义语言),就是 `CREATE TABLE` 这类定义结构的 SQL。很多生产库在 DDL 里写注释,MySQL 和 Postgres 还有专门的 `COMMENT` 语法,把它们取出来喂给模型是成本最低的一层。

## 第 4 步:第二层,枚举列的真实取值

注释有一个问题:它是人写的,会过时。上面 `invoices.status` 的注释写着 `paid / open / void / refunded` 四种,库里真的有这四种吗?

**枚举列**是指那种只会取少数几个固定值的列,比如状态、套餐、计费周期。对这种列,直接去库里查它实际出现过哪些值:

```python
# agent-zero-lab/part05/text2sql/enum_peek.py
"""第二层:注释说的取值和库里真实的取值,对一对。"""
from part05.text2sql.bare_schema import connect_ro

CHECKS = [("subscriptions", "plan"), ("subscriptions", "billing_cycle"), ("subscriptions", "status"), ("invoices", "status")]

with connect_ro() as conn:
    for table, col in CHECKS:
        values = [r[0] for r in conn.execute(f"SELECT DISTINCT {col} FROM {table} ORDER BY 1")]
        print(f"{table}.{col}: {values}")
```

<div class="line-notes">

- `CHECKS = [("subscriptions", "plan")` 要查的列,一个元组是 `(表名, 列名)`。
- `for table, col in CHECKS:` 遍历时直接把元组解包成两个变量,相当于 JS 的 `for (const [table, col] of checks)`。
- `values = [r[0] for r in conn.execute(f"SELECT DISTINCT {col} FROM {table} ORDER BY 1")]` `SELECT DISTINCT` 去重,`ORDER BY 1` 按第一列排序。表名和列名必须拼进 SQL 字符串,下面专门演示为什么不能用 `?`。这里能拼,是因为它们来自我们自己写死的 `CHECKS`,不是用户输入。

</div>

`uv run python -m part05.text2sql.enum_peek`:

```text
subscriptions.plan: ['专业版', '企业版', '基础版']
subscriptions.billing_cycle: ['monthly', 'yearly']
subscriptions.status: ['active', 'canceled', 'past_due', 'trialing']
invoices.status: ['open', 'paid']
```

`invoices.status` 实际只有 `open` 和 `paid`,注释里的 `void`、`refunded` 一张都没有。在真实公司里,这种「注释说有、库里没有」或者「库里有、注释没写」的情况非常常见:新加了一种状态没人去改注释,旧状态早就不用了注释还留着。真实取值是从库里查的,它不会骗人。

### 为什么列名不能用 `?` 占位

[Day 92](/blog/agent-zero/day-092-python-sqlite-1/) 反复强调用 `?` 占位防注入,这里却用 f-string 拼。试一下用 `?` 会怎样:

```bash
uv run python -c "
import sqlite3
c = sqlite3.connect('file:cloudledger/cloudledger.db?mode=ro', uri=True)
print(c.execute('SELECT DISTINCT ? FROM subscriptions', ('plan',)).fetchall())
c.execute('SELECT DISTINCT plan FROM ?', ('subscriptions',))
"
```

```text
[('plan',)]
Traceback (most recent call last):
  ...
sqlite3.OperationalError: near "?": syntax error
```

第一句没报错,但结果是 `[('plan',)]`,30 行订阅去重后只剩一个字符串 `'plan'`。因为 `?` 只能代表**值**,SQLite 把它当成字面量 `'plan'` 来选,每一行都选出同一个字符串。第二句把表名换成 `?` 直接语法错误。所以表名、列名只能拼字符串,能拼的前提是它们来自你写死的白名单,绝不能来自用户输入。

## 第 5 步:第三层,业务术语表

前两层解决了「不知道值」。「不知道口径」怎么办?「最近 7 天」从哪天往前数、MRR 怎么算,这些东西库里根本没有。CloudLedger 的业务库里没有价格表,单价写在 `seed.py` 的 `PLANS` 字典里(基础版每席位每月 49 元、专业版 99 元、企业版 299 元),只有写代码的人知道。

只能把它们写下来。这就是**业务术语表**(glossary):把公司里的业务词翻译成库里的列和条件。

```python
GLOSSARY = """业务术语(按这里的口径算,不要自己发明):
- 金额:所有 *_cents 列单位是「分」,回答「多少元」时除以 100.0。
- 套餐单价(每席位每月):基础版 49 元、专业版 99 元、企业版 299 元。库里没有价格表,需要时用 CASE 写进 SQL。
- 有效订阅:status IN ('active', 'past_due')。trialing 是试用,不算收入;canceled 是已取消。
- 欠费客户:订阅 status = 'past_due' 的客户。
- MRR(月经常性收入):有效订阅的 单价 × seats 之和,年付也按月折算(单价本来就是按月的)。
- 未付发票:invoices.status = 'open'。已付:'paid'。
- 「今天」:数据快照日 2026-10-12。「最近 N 天」= 日期 >= date('2026-10-12', '-N days'),
  例如最近 7 天是 >= '2026-10-05'。日期列是 'YYYY-MM-DD' 文本,可以直接比较大小。
"""
```

<div class="line-notes">

- `业务术语(按这里的口径算,不要自己发明):` 开头这句是写给模型的指令。第 2 步里它自己发明了一个 MRR 口径,这句话就是冲着那个来的。
- `- 金额:所有 *_cents 列单位是「分」` 注释里已经写了,术语表再强调一次「回答多少元时除以 100.0」。写 `100.0` 不写 `100`,是因为 SQLite 里整数除整数结果还是整数,`239250 / 100` 得 `2392`,小数部分直接丢了。
- `- 套餐单价(每席位每月):` 这一条决定 MRR 能不能算对。注意帮助中心文章里写的套餐可能和业务库不一样,文档和数据对不上在真实公司很常见,问数要以业务库为准。
- `- 有效订阅:status IN ('active', 'past_due')。` 欠费的客户还在用、还欠着钱,算不算「有效」是个业务决定,不是技术问题。我们这里定为算。换一家公司可能就不算,所以必须写下来。
- `- MRR(月经常性收入):` MRR 是 SaaS 最核心的指标,Monthly Recurring Revenue,每个月稳定能收到的订阅收入。它的定义每家公司都有细节差异(折扣算不算、试用算不算、年付怎么折),模型不可能猜对。
- `- 「今天」:数据快照日 2026-10-12。` `seed.py` 里写死了 `today = date(2026, 10, 12)`,数据是按这一天造的。不告诉模型,它会用 SQLite 的 `'now'`,得到你运行那天的日期。真实系统里这一行要写成「今天是 {实际日期}」,每次调用时动态填进去。
- `例如最近 7 天是 >= '2026-10-05'。` 给一个算好的例子。「最近 7 天」包不包括今天、是 7 天还是 8 天,本身就有歧义,给个例子就把口径钉死了。

</div>

术语表里的每一条,都对应一个模型猜不到的口径。写的时候问自己:「一个刚入职、会写 SQL 但不了解我们业务的数据分析师,问这个问题时会不会算错?」会,就写一条。

## 第 6 步:拼成完整的 schema.py

三层拼起来。为了下一步做对比实验,给 `schema_text()` 加两个开关,可以单独关掉第二层或第三层:

```python
# agent-zero-lab/part05/text2sql/schema.py
"""拼给模型看的「库说明书」:带注释的建表语句 + 枚举列的真实取值 + 业务术语表。"""
import sqlite3

from part05.text2sql.bare_schema import DB_PATH, connect_ro

# 只有值少、又常被拿来过滤的列,才值得把取值列出来
ENUM_COLUMNS = {
    "subscriptions": ["plan", "billing_cycle", "status"],
    "invoices": ["status"],
    "tickets": ["status", "subject"],
    "refund_requests": ["status"],
}

GLOSSARY = """业务术语(按这里的口径算,不要自己发明):
- 金额:所有 *_cents 列单位是「分」,回答「多少元」时除以 100.0。
- 套餐单价(每席位每月):基础版 49 元、专业版 99 元、企业版 299 元。库里没有价格表,需要时用 CASE 写进 SQL。
- 有效订阅:status IN ('active', 'past_due')。trialing 是试用,不算收入;canceled 是已取消。
- 欠费客户:订阅 status = 'past_due' 的客户。
- MRR(月经常性收入):有效订阅的 单价 × seats 之和,年付也按月折算(单价本来就是按月的)。
- 未付发票:invoices.status = 'open'。已付:'paid'。
- 「今天」:数据快照日 2026-10-12。「最近 N 天」= 日期 >= date('2026-10-12', '-N days'),
  例如最近 7 天是 >= '2026-10-05'。日期列是 'YYYY-MM-DD' 文本,可以直接比较大小。
"""


def table_ddl(conn: sqlite3.Connection) -> list[tuple[str, str]]:
    """第一层:每张表的建表原文,注释也在里面。"""
    return conn.execute(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()


def enum_line(conn: sqlite3.Connection, table: str, col: str) -> str:
    """第二层:某一列在库里真实出现过的值。"""
    values = [r[0] for r in conn.execute(f"SELECT DISTINCT {col} FROM {table} ORDER BY 1")]
    return f"-- {table}.{col} 实际取值:{', '.join(map(str, values))}"


def schema_text(enums: bool = True, glossary: bool = True) -> str:
    parts: list[str] = []
    with connect_ro() as conn:
        for name, sql in table_ddl(conn):
            parts.append(sql + ";")
            if enums:
                parts.extend(enum_line(conn, name, col) for col in ENUM_COLUMNS.get(name, []))
    text = "\n".join(parts)
    if glossary:
        text += "\n\n" + GLOSSARY  # 第三层
    return text


if __name__ == "__main__":
    print(f"库文件:{DB_PATH.name}")
    text = schema_text()
    print(text)
    print(f"共 {len(text)} 个字符")
```

<div class="line-notes">

- `ENUM_COLUMNS = {` 不是所有列都列取值。`customers.name` 有 30 个不同的值,列出来只是浪费 token,而且没人会问「名字等于张三的客户」时需要知道全部名字;`tickets.subject` 只有 8 种工单主题,用户常问「按主题统计」,值得列。练习 2 会写一个自动挑候选列的脚本。
- `"refund_requests": ["status"],` 退款申请表现在是空的,这一行查出来的取值是空,放着是为了以后有数据时自动带上。
- `def table_ddl(conn: sqlite3.Connection) -> list[tuple[str, str]]:` 第一层。返回 `[(表名, 建表原文), ...]`,下面要用表名去 `ENUM_COLUMNS` 里找该列哪些取值。
- `def enum_line(conn: sqlite3.Connection, table: str, col: str) -> str:` 第二层。和第 4 步 `enum_peek.py` 一样的查询,区别是结果写成 SQL 注释的格式。
- `return f"-- {table}.{col} 实际取值:{', '.join(map(str, values))}"` `map(str, values)` 把每个值转成字符串再 `join`(值里可能有数字)。写成 `--` 开头的 SQL 注释,紧跟在建表语句后面,模型读起来很自然。实跑 `subscriptions.status` 这一行是 `-- subscriptions.status 实际取值:active, canceled, past_due, trialing`。
- `def schema_text(enums: bool = True, glossary: bool = True) -> str:` 两个开关默认都开,外面直接调 `schema_text()` 就是完整说明书。Day 292、Day 294 都会这么用。
- `parts.append(sql + ";")` 建表原文末尾没有分号,补一个,一条一条分得清。
- `parts.extend(enum_line(conn, name, col) for col in ENUM_COLUMNS.get(name, []))` 这张表在 `ENUM_COLUMNS` 里登记了哪些列,就给每一列生成一行取值注释,紧跟在这张表的 DDL 后面。`.get(name, [])` 没登记的表返回空列表,什么都不加。`extend` 接一个生成器([Day 99](/blog/agent-zero/day-099-generators/)),把里面的元素一个个追加进去,相当于 JS 的 `parts.push(...arr)`。
- `text += "\n\n" + GLOSSARY  # 第三层` 术语表放在最后,和表结构之间空一行。
- `print(f"共 {len(text)} 个字符")` 量一下长度。说明书越长,每次问数的输入 token 越多,练习 3 会算这笔账。

</div>

`uv run python -m part05.text2sql.schema`(中间几张表省略):

```text
库文件:cloudledger.db
CREATE TABLE customers (
    id          TEXT PRIMARY KEY,          -- C001
    name        TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE,
    company     TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE TABLE invoices (
    ...
    status           TEXT NOT NULL,        -- paid / open / void / refunded
    ...
);
-- invoices.status 实际取值:open, paid
CREATE TABLE refund_requests (
    ...
);
-- refund_requests.status 实际取值:
CREATE TABLE subscriptions (
    ...
    plan                TEXT NOT NULL,     -- 基础版 / 专业版 / 企业版
    billing_cycle       TEXT NOT NULL,     -- monthly / yearly
    ...
);
-- subscriptions.plan 实际取值:专业版, 企业版, 基础版
-- subscriptions.billing_cycle 实际取值:monthly, yearly
-- subscriptions.status 实际取值:active, canceled, past_due, trialing
CREATE TABLE tickets (
    ...
);
-- tickets.status 实际取值:open
-- tickets.subject 实际取值:升级套餐, 发票抬头修改, 取消订阅, 导出报表报错, 席位数量不对, 申请退款, 登录不了, 重复扣款

业务术语(按这里的口径算,不要自己发明):
- 金额:所有 *_cents 列单位是「分」,回答「多少元」时除以 100.0。
...
共 2577 个字符
```

`tickets.status` 的注释写着 `open / pending / solved`,实际只有 `open`。第二层又抓到一处注释和数据对不上。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="库说明书的三层:第一层带注释的建表语句,告诉模型有哪些表列、类型、关联和单位;第二层枚举列真实取值,纠正过时的注释;第三层业务术语表,写下库里不存在的口径">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="20" width="600" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="35" y="42" fill="var(--ink)">① 带注释的建表语句(sqlite_master.sql)</text>
<text x="35" y="62" fill="var(--ink-faint)" font-size="11">有哪些表和列、类型、谁 JOIN 谁、金额单位是分   → 来自库,但注释是人写的,会过时</text>
<rect x="20" y="86" width="600" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="35" y="108" fill="var(--ink)">② 枚举列的真实取值(SELECT DISTINCT)</text>
<text x="35" y="128" fill="var(--ink-faint)" font-size="11">企业版不是 enterprise,yearly 不是 annual   → 来自库,不会骗人</text>
<rect x="20" y="152" width="600" height="56" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="35" y="174" fill="var(--ink)">③ 业务术语表(人手写)</text>
<text x="35" y="194" fill="var(--ink-faint)" font-size="11">今天是哪天、MRR 怎么算、单价多少   → 库里根本没有,只能问业务方</text>
</g>
</svg>
<figcaption>前两层能从库里自动生成,治「不知道值」;第三层只能人写,治「不知道口径」。</figcaption>
</figure>

## 第 7 步:一层层加厚,看每层救回了哪几题

有了开关,就能做对照实验:同样 6 道题,说明书从薄到厚五个档次,看每档答对几道。正确答案是我自己手写 SQL 查出来的,写死在题目旁边。

```python
# agent-zero-lab/part05/text2sql/compare_layers.py
"""同样 6 个问题,说明书一层层加厚,看每层救回了哪几题。"""
import sqlite3

from part05.text2sql.bare_schema import bare_schema, connect_ro
from part05.text2sql.schema import ENUM_COLUMNS, enum_line, schema_text
from part05.text2sql.try_sql import llm, run_readonly, write_sql

QUESTIONS = [  # (问题, 正确答案):正确答案是我手写 SQL 查出来的
    ("企业版的订阅有几个?", 8),
    ("欠费的客户有几家?", 3),
    ("按年付费的有效订阅有几个?", 9),
    ("2026 年 10 月开出的发票一共多少元?", 103409),
    ("最近 7 天新建了几张工单?", 25),
    ("现在的 MRR 是多少元?", 20273),
]


def bare_with_enums() -> str:
    """没有注释的库很常见:只给列名 + 真实取值,看取值单独能救回多少。"""
    with connect_ro() as conn:
        lines = [enum_line(conn, t, c) for t, cols in ENUM_COLUMNS.items() for c in cols]
    return bare_schema() + "\n" + "\n".join(lines)


def first_value(sql: str) -> float | str:
    try:
        rows = run_readonly(sql)
    except sqlite3.Error as e:
        return f"报错:{e}"
    return rows[0][0] if rows and rows[0] else "空"


def main() -> None:
    levels = {
        "只有列名": bare_schema(),
        "列名+真实取值": bare_with_enums(),
        "建表注释": schema_text(enums=False, glossary=False),
        "注释+真实取值": schema_text(enums=True, glossary=False),
        "注释+取值+术语表": schema_text(enums=True, glossary=True),
    }
    for level, schema in levels.items():
        right = 0
        print(f"== {level}(说明书 {len(schema)} 字符)")
        for question, expected in QUESTIONS:
            got = first_value(write_sql(schema, question))
            ok = isinstance(got, (int, float)) and round(got, 2) == expected
            right += ok
            print(f"  {'✓' if ok else '✗'} {question} → {got}")
        print(f"  {right}/{len(QUESTIONS)}")
    print("账单:", llm.ledger)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from part05.text2sql.try_sql import llm, run_readonly, write_sql` 复用第 2 步的三样东西,包括那个共享账本 `llm`,最后能打出 30 次调用的总花费。
- `("企业版的订阅有几个?", 8),` 每道题配一个手算的正确答案。怎么得来的:`SELECT COUNT(*) FROM subscriptions WHERE plan = '企业版'`。其余几道同理,MRR 用的是术语表里的口径。
- `("现在的 MRR 是多少元?", 20273),` 有效订阅(23 个 active 加 3 个 past_due)的 单价 × 席位 之和。
- `def bare_with_enums() -> str:` 多做一个档次:没有注释、只有列名加真实取值。很多生产库根本没写注释,想知道取值这一层单独有多大用。
- `lines = [enum_line(conn, t, c) for t, cols in ENUM_COLUMNS.items() for c in cols]` 两层 for 的列表推导式,读法是从左往右:先遍历每张表 `t` 和它的列清单 `cols`,再遍历每一列 `c`。相当于 JS 的 `Object.entries(ENUM).flatMap(([t, cols]) => cols.map(c => enumLine(t, c)))`。
- `def first_value(sql: str) -> float | str:` 只看结果的第一行第一列。6 道题都是「一个数」的问题,这么比够用;评测更一般的结果要比整张结果表,那是 Day 294 的事。
- `except sqlite3.Error as e:` SQL 执行出错(比如列名写错)时不让整个实验崩掉,把报错当结果记下来。
- `return rows[0][0] if rows and rows[0] else "空"` 结果为空时返回「空」。条件表达式相当于 JS 的三元运算符。
- `levels = {` 五个档次。字典在 Python 3.7 以后保持插入顺序,打印出来就是从薄到厚。
- `ok = isinstance(got, (int, float)) and round(got, 2) == expected` 结果是数字且四舍五入到两位后等于答案才算对。`103409.0 == 103409` 在 Python 里是 `True`,整数和浮点数可以直接比。
- `right += ok` 布尔值在 Python 里可以当 0 和 1 加,`True` 加 1、`False` 加 0。JS 里 `true + 0` 也是 1,一个道理。

</div>

`uv run python -m part05.text2sql.compare_layers`:

```text
== 只有列名(说明书 389 字符)
  ✗ 企业版的订阅有几个? → 0
  ✗ 欠费的客户有几家? → 0
  ✗ 按年付费的有效订阅有几个? → 0
  ✓ 2026 年 10 月开出的发票一共多少元? → 103409.0
  ✗ 最近 7 天新建了几张工单? → 0
  ✗ 现在的 MRR 是多少元? → 79175.0
  1/6
== 列名+真实取值(说明书 720 字符)
  ✓ 企业版的订阅有几个? → 8
  ✓ 欠费的客户有几家? → 3
  ✓ 按年付费的有效订阅有几个? → 9
  ✓ 2026 年 10 月开出的发票一共多少元? → 103409.0
  ✗ 最近 7 天新建了几张工单? → 0
  ✗ 现在的 MRR 是多少元? → 85.75
  4/6
== 建表注释(说明书 1777 字符)
  ✓ 企业版的订阅有几个? → 8
  ✓ 欠费的客户有几家? → 3
  ✓ 按年付费的有效订阅有几个? → 9
  ✓ 2026 年 10 月开出的发票一共多少元? → 103409.0
  ✗ 最近 7 天新建了几张工单? → 0
  ✗ 现在的 MRR 是多少元? → 19089.0
  4/6
== 注释+真实取值(说明书 2108 字符)
  ✓ 企业版的订阅有几个? → 8
  ✓ 欠费的客户有几家? → 3
  ✓ 按年付费的有效订阅有几个? → 9
  ✓ 2026 年 10 月开出的发票一共多少元? → 103409.0
  ✗ 最近 7 天新建了几张工单? → 0
  ✗ 现在的 MRR 是多少元? → 21481.0
  4/6
== 注释+取值+术语表(说明书 2577 字符)
  ✓ 企业版的订阅有几个? → 8
  ✓ 欠费的客户有几家? → 3
  ✓ 按年付费的有效订阅有几个? → 9
  ✓ 2026 年 10 月开出的发票一共多少元? → 103409.0
  ✓ 最近 7 天新建了几张工单? → 25
  ✓ 现在的 MRR 是多少元? → 20273.0
  6/6
账单: 30 次调用 | 输入 14355 / 输出 1208 tokens | 约 ¥0.0218
```

怎么读这张成绩单:

**「不知道值」的三道题**(企业版、欠费、年付),只要模型看到了真实的值,不管是从注释里看到还是从取值行里看到,立刻全对。「列名+真实取值」只用 720 个字符就拿到了和「建表注释」(1777 字符)一样的 4 分。如果你接手的库没有注释,取值这一层是性价比最高的。

**「不知道口径」的两道题**(最近 7 天、MRR),前四档全错,只有加上术语表才对。注释和取值都是「库里有的东西」,而「今天是 10 月 12 日」「MRR 用单价乘席位」是库里没有的东西,再怎么查库也查不出来。

在「建表注释」这一档,取值层没有多救回任何一题。这不代表它没用:这 6 道题恰好都是注释写对了的列。注释写错的地方(`invoices.status` 的 `void`/`refunded`、`tickets.status` 的 `pending`/`solved`),是取值层兜底的。

还有一处要留意:MRR 在前四档里分别给出了 79175、85.75、19089、21481 四个不同的错数,而且我第一次跑这个脚本时,「只有列名」那档给的是 21481。`temperature=0` 也不能保证每次一样。最危险的是 19089 和 21481 这种,和正确答案 20273 只差几个百分点,看起来完全可信。

看一眼有没有术语表时 MRR 的 SQL 差在哪:

```python
# agent-zero-lab/part05/text2sql/show_sql.py
"""看同一个问题在「没术语表」和「有术语表」时,模型写的 SQL 差在哪。"""
import sys

from part05.text2sql.schema import schema_text
from part05.text2sql.try_sql import llm, run_readonly, write_sql

question = sys.argv[1] if len(sys.argv) > 1 else "现在的 MRR 是多少元?"
for glossary in (False, True):
    sql = write_sql(schema_text(glossary=glossary), question)
    print(f"--- 术语表={glossary}\n{sql}\n结果:{run_readonly(sql)}")
print("账单:", llm.ledger)
```

<div class="line-notes">

- `for glossary in (False, True):` 同一个问题跑两遍,只差术语表开关。取值层两遍都开着。
- `sql = write_sql(schema_text(glossary=glossary), question)` 关键字参数只传 `glossary`,`enums` 用默认的 `True`。

</div>

`uv run python -m part05.text2sql.show_sql`:

```text
--- 术语表=False
SELECT ROUND(SUM(CASE WHEN billing_cycle = 'monthly' THEN amount_cents ELSE amount_cents / 12.0 END) / 100.0, 2) AS mrr_yuan FROM (SELECT s.billing_cycle, i.amount_cents FROM subscriptions s JOIN invoices i ON i.subscription_id = s.id WHERE s.status = 'active' AND i.status = 'paid' AND i.issued_at = (SELECT MAX(i2.issued_at) FROM invoices i2 WHERE i2.subscription_id = s.id AND i2.status = 'paid')) t
结果:[(21481.0,)]
--- 术语表=True
SELECT ROUND(SUM(CASE s.plan WHEN '基础版' THEN 49 WHEN '专业版' THEN 99 WHEN '企业版' THEN 299 END * s.seats), 2) AS mrr_yuan FROM subscriptions s WHERE s.status IN ('active', 'past_due')
结果:[(20273.0,)]
```

没有术语表时,模型自己设计了一个挺聪明的口径:每个 active 订阅取最近一张已付发票,年付的除以 12。带子查询、带关联,SQL 水平比很多初级工程师都高。但它漏了欠费订阅,又用发票金额代替订阅单价,两处偏差叠加,得出 21481。有了术语表,SQL 反而简单得多,一行 `CASE` 乘席位,直接对。

再看「最近 7 天」:

```bash
uv run python -m part05.text2sql.show_sql "最近 7 天新建了几张工单?"
```

```text
--- 术语表=False
SELECT COUNT(*) AS ticket_count FROM tickets WHERE created_at >= datetime('now', '-7 days')
结果:[(0,)]
--- 术语表=True
SELECT COUNT(*) AS ticket_count FROM tickets WHERE created_at >= date('2026-10-12', '-7 days')
结果:[(25,)]
```

区别只有 `'now'` 换成了 `'2026-10-12'`,结果从 0 变成 25。

**这一步的小结**:取值层治「不知道值」,术语表治「不知道口径」,两者缺一不可。错的结果往往看起来很合理,所以每一层都得有,而且要有标准答案来对照,光看模型写的 SQL「像不像」是看不出来的。

## 零件 → 大代码对照表

| 今天的零件 | 落在哪个文件 | 在 `schema.py` 里对应 |
| --- | --- | --- |
| `sqlite_master` + `PRAGMA table_info` | `bare_schema.py` | 基础:`DB_PATH`、`connect_ro()` 从这里导入 |
| 让模型写 SQL、只读执行 | `try_sql.py` | 不在 `schema.py` 里,`write_sql` 后面几天还会用 |
| 建表原文带注释 | `ddl_peek.py` | `table_ddl()`,第一层 |
| `SELECT DISTINCT` 真实取值 | `enum_peek.py` | `ENUM_COLUMNS` + `enum_line()`,第二层 |
| 业务口径 | 第 5 步的 `GLOSSARY` | `GLOSSARY`,第三层 |
| 五档对照实验 | `compare_layers.py`、`show_sql.py` | 用 `schema_text(enums=..., glossary=...)` 的开关 |

## 花了多少钱

价格按 deepseek-flash 高峰价:缓存命中 0.04、未命中 2、输出 8,元每百万 token([DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing),2026 年 10 月查到;工作日 9–12 点、14–18 点以外是半价)。

- 第 2 步 7 次 `try_sql`:每次 ¥0.0005 到 ¥0.0011,合计约 ¥0.005。
- 第 7 步 `compare_layers.py` 一次 30 次调用:账本 ¥0.0218;我跑了两次(第一次的结果用来写「MRR 每次不一样」那段),约 ¥0.042。`show_sql.py` 两次合计 ¥0.0038。
- 练习:练习 1 ¥0.0022,练习 3 ¥0.0037。

总共约 ¥0.06。你照着跑一遍主线约 ¥0.03。拿 `compare_layers` 那次算一下:14355 × 2 ÷ 100 万 + 1208 × 8 ÷ 100 万 ≈ 0.0287 + 0.0097 = ¥0.038,账本记 ¥0.0218,差额是缓存命中省下的(同一份说明书连问 6 题,前缀相同)。

## 动手练习

**练习 1:给术语表加一条 ARPA。** ARPA(Average Revenue Per Account)是「每个客户平均每月贡献多少收入」。问「现在的 ARPA 是多少元?」,先用现有的完整说明书问一次,再在术语表末尾加一条 ARPA 的口径问一次,对比两次的 SQL 和结果。正确答案是 20273 ÷ 26 ≈ 779.73(26 是有效订阅的客户数)。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/text2sql/ex291_arpa.py
"""练习 1:术语表里加一条 ARPA 口径,比较加之前和加之后。"""
from part05.text2sql.schema import schema_text
from part05.text2sql.try_sql import llm, run_readonly, write_sql

ARPA = "- ARPA(每客户平均月收入):MRR ÷ 有效订阅的客户数,保留两位小数。\n"
QUESTION = "现在的 ARPA 是多少元?"
EXPECTED = 779.73  # 手算:20273 ÷ 26

for label, schema in [("原术语表", schema_text()), ("加了 ARPA", schema_text() + ARPA)]:
    sql = write_sql(schema, QUESTION)
    got = run_readonly(sql)[0][0]
    print(f"{label}: {got} {'✓' if got == EXPECTED else '✗'}\n  {sql}")
print("账单:", llm.ledger)
```

<div class="line-notes">

- `ARPA = "- ARPA(每客户平均月收入):MRR ÷ 有效订阅的客户数,保留两位小数。\n"` 和其他条目同样的格式,直接接在完整说明书末尾。它引用了术语表里已有的「MRR」「有效订阅」,口径可以层层组合。
- `EXPECTED = 779.73  # 手算:20273 ÷ 26` 26 来自 `SELECT COUNT(DISTINCT customer_id) FROM subscriptions WHERE status IN ('active', 'past_due')`。
- `for label, schema in [("原术语表", schema_text()), ("加了 ARPA", schema_text() + ARPA)]:` 两份说明书各问一次。

</div>

`uv run python -m part05.text2sql.ex291_arpa`:

```text
原术语表: 7.8 ✗
  SELECT ROUND(SUM(CASE s.plan WHEN '基础版' THEN 49 WHEN '专业版' THEN 99 WHEN '企业版' THEN 299 END * s.seats) / 100.0 / COUNT(DISTINCT s.customer_id), 2) AS arpa FROM subscriptions s WHERE s.status IN ('active', 'past_due')
加了 ARPA: 779.73 ✓
  SELECT ROUND(SUM(CASE s.plan WHEN '基础版' THEN 49 WHEN '专业版' THEN 99 WHEN '企业版' THEN 299 END * s.seats) * 1.0 / COUNT(DISTINCT s.customer_id), 2) AS arpa FROM subscriptions s WHERE s.status IN ('active', 'past_due')
```

没写 ARPA 口径时,模型其实猜对了「MRR ÷ 客户数」,但它多除了一个 100:术语表第一条说「`*_cents` 列单位是分,回答多少元时除以 100.0」,它把这条规则套到了单价上,而单价 49、99、299 本来就是元。结果 7.8 元,差了 100 倍。

这暴露了术语表本身的一个坑:**条目之间会互相干扰**。更稳的写法是把单价那条改成「单价单位是元,不要再除以 100」。术语表要像代码一样有测试,每次改都要重跑评测,这就是 Day 294 要做的事。

</details>

**练习 2:自动挑出枚举列。** `ENUM_COLUMNS` 是手写的。写一个脚本,遍历每张表的每个 `TEXT` 列,找出不同值不超过 10 种、而且不是每行都不一样的列,作为候选。和手写的 `ENUM_COLUMNS` 对比。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/text2sql/ex291_find_enums.py
"""练习 2:不手写 ENUM_COLUMNS,自动找出「值少的文本列」当候选。"""
from part05.text2sql.bare_schema import connect_ro

MAX_DISTINCT = 10

with connect_ro() as conn:
    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )]
    for t in tables:
        for _, col, col_type, *_ in conn.execute(f"PRAGMA table_info({t})"):
            if col_type != "TEXT":
                continue
            n_distinct, n_rows = conn.execute(f"SELECT COUNT(DISTINCT {col}), COUNT(*) FROM {t}").fetchone()
            if 0 < n_distinct <= MAX_DISTINCT and n_distinct < n_rows:
                print(f"{t}.{col}: {n_distinct} 种值 / {n_rows} 行")
```

<div class="line-notes">

- `MAX_DISTINCT = 10` 不同值超过 10 种就不算枚举。这个阈值是经验值,表大了可以调高。
- `for _, col, col_type, *_ in conn.execute(f"PRAGMA table_info({t})"):` `PRAGMA table_info` 每行 6 个字段,只要第 2、3 个(列名、类型)。第一个用 `_` 丢掉,`*_` 把剩下的全丢掉,相当于 JS 的 `const [, col, colType, ...rest] = row`。
- `if col_type != "TEXT":` 只看文本列。`seats` 这种整数列虽然值也不多,但用户不会拿它当类别过滤。
- `n_distinct, n_rows = conn.execute(f"SELECT COUNT(DISTINCT {col}), COUNT(*) FROM {t}").fetchone()` 一次查出不同值个数和总行数。
- `if 0 < n_distinct <= MAX_DISTINCT and n_distinct < n_rows:` 三个条件:至少有一个值(排除空表)、不超过阈值、不是每行都不同(排除行数很少的表里的 id 列)。Python 支持 `0 < x <= 10` 这种连写,JS 不行。

</div>

`uv run python -m part05.text2sql.ex291_find_enums`:

```text
invoices.status: 2 种值 / 123 行
subscriptions.plan: 3 种值 / 30 行
subscriptions.billing_cycle: 2 种值 / 30 行
subscriptions.status: 4 种值 / 30 行
tickets.subject: 8 种值 / 41 行
tickets.status: 1 种值 / 41 行
```

和手写的 `ENUM_COLUMNS` 相比,只少了 `refund_requests.status`,因为那张表现在是空的,`n_distinct` 是 0。自动挑能省事,但空表、新上线的状态它发现不了,所以实践中一般是「自动挑一遍,人再补几个」。

</details>

**练习 3:每一层多花多少钱。** 说明书越厚越准,也越贵。用 `max_tokens=1` 让模型只回一个 token,分别发四档说明书,读 `prompt_tokens`,算出每问一次的输入成本。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/text2sql/ex291_tokens.py
"""练习 3:每一层说明书各占多少 token、每问一次多花多少钱。"""
from common.llm import LLMClient
from part05.text2sql.bare_schema import bare_schema
from part05.text2sql.schema import schema_text

llm = LLMClient()
levels = {
    "只有列名": bare_schema(),
    "建表注释": schema_text(enums=False, glossary=False),
    "注释+取值": schema_text(glossary=False),
    "完整说明书": schema_text(),
}
for name, schema in levels.items():
    r = llm.chat([{"role": "system", "content": schema}, {"role": "user", "content": "只回复 ok"}], max_tokens=1)
    miss = r.prompt_tokens - r.cache_hit_tokens
    print(f"{name}: {len(schema)} 字符 → {r.prompt_tokens} token(缓存命中 {r.cache_hit_tokens}),未命中按 2 元/百万算 ¥{miss * 2 / 1e6:.5f}")
print("账单:", llm.ledger)
```

<div class="line-notes">

- `max_tokens=1)` `max_tokens=1` 让模型最多输出 1 个 token,输出成本几乎为零,我们只关心输入算了多少 token。用接口返回的 `prompt_tokens` 而不是自己估,因为中英文、SQL 符号混在一起时字符数和 token 数的比例很难估准([Day 108](/blog/agent-zero/day-108-tokens-2/))。
- `miss = r.prompt_tokens - r.cache_hit_tokens` 缓存未命中的部分才按 2 元/百万算。
- `¥{miss * 2 / 1e6:.5f}` `1e6` 是一百万,`:.5f` 保留五位小数。

</div>

`uv run python -m part05.text2sql.ex291_tokens`:

```text
只有列名: 389 字符 → 110 token(缓存命中 0),未命中按 2 元/百万算 ¥0.00022
建表注释: 1777 字符 → 414 token(缓存命中 0),未命中按 2 元/百万算 ¥0.00083
注释+取值: 2108 字符 → 537 token(缓存命中 0),未命中按 2 元/百万算 ¥0.00107
完整说明书: 2577 字符 → 794 token(缓存命中 0),未命中按 2 元/百万算 ¥0.00159
```

完整说明书每问一次多花不到 2 厘钱,换来从 1/6 到 6/6。五张表的库,这笔账一点都不用犹豫。几百张表时说明书会变成几十万 token,每问一次几毛钱,还会超出上下文窗口,那时候就不能全贴了,这是 Day 295 的题目。另外,同一份说明书放在 system 消息最前面,连续问的时候会命中前缀缓存,实际更便宜。

</details>

**验收标准**:`compare_layers.py` 跑出来最后一档 6/6,前面几档的分数和错题类型与正文一致(具体错数可以不同);你能对着每一道错题说出它缺的是哪一层;练习 1 你能解释 7.8 是怎么来的。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 问数 / Text-to-SQL / NL2SQL | 用户用自然语言提问,模型写 SQL 查库再回答;ChatBI 是它在 BI 产品里的叫法 |
| 库说明书 | 给模型看的数据库描述,今天的版本有三层:带注释的 DDL、枚举列真实取值、业务术语表 |
| DDL | Data Definition Language,定义表结构的 SQL,比如 `CREATE TABLE` |
| `sqlite_master` | SQLite 的系统表,存着每张表、索引的名字和建表原文(包括注释) |
| `PRAGMA table_info` | SQLite 查某张表每一列的名字、类型、是否非空等信息的命令 |
| 枚举列 | 只会取少数几个固定值的列,比如状态、套餐、计费周期 |
| 业务术语表(glossary) | 把业务词翻译成库里的列和条件的说明,写下库里不存在的口径 |
| 口径 | 一个指标具体怎么算的约定,比如 MRR 算不算欠费订阅 |
| MRR | Monthly Recurring Revenue,月经常性收入,SaaS 最核心的指标之一 |
| ARPA | Average Revenue Per Account,每个客户平均每月贡献的收入 |
| 数据快照日 | 造数据或导出数据时的「今天」,问「最近 N 天」要以它为准 |
| `mode=ro` | 以只读方式打开 SQLite 库的 URI 参数,明天细讲 |

## 常见误区

**「模型 SQL 写得好,问数就成了。」** 今天模型随手写出了带关联子查询的 MRR,语法挑不出毛病,数字是错的。7 道题错的 5 道没有一道是语法问题,全是值和口径。

**「SQL 跑通、有结果,数就是对的。」** `plan = 'enterprise'` 返回 0,`datetime('now')` 返回 0,MRR 返回 21481,全都顺利执行。返回 0 尤其要警惕:它可能是真的 0,也可能是条件没匹配上。

**「注释写了就够了,不用查真实取值。」** 实测 `invoices.status` 的注释说有四种值,库里只有两种;`tickets.status` 注释说三种,库里只有一种。注释是人写的,会过时;取值是从库里查的。

**「表名列名也用 `?` 占位,更安全。」** `?` 只能代表值。`SELECT DISTINCT ? FROM subscriptions` 不报错,返回的是字面量 `'plan'`;表名用 `?` 直接语法错误。表名列名只能拼字符串,前提是它们来自你写死的白名单。

**「`temperature=0` 每次结果都一样,跑一次就够了。」** 同一道 MRR 题、同一份说明书,两次跑出 79175 和 21481。对比实验要么多跑几次,要么只看稳定的那部分结论。

**术语表写完就不管了。** 练习 1 里加一条 ARPA 就暴露了「除以 100」被误用到单价上。术语表的条目会互相影响,每次改都要用评测集回归一遍。

**用 SQLite 的 `'now'` 处理「最近 N 天」。** 演示数据、测试库、历史快照的「今天」都不是你跑代码的那天。在术语表里写清楚以哪天为准,生产环境就每次调用时把真实日期填进去。

## 学习资料

### 文档与文章

- [SQLite · The Schema Table](https://www.sqlite.org/schematab.html):`sqlite_master` 每一列的含义,10 分钟。
- [SQLite · PRAGMA Statements](https://www.sqlite.org/pragma.html):搜 `table_info`,看它返回的六列;顺便看一眼 `foreign_key_list`,表间关系也能这样取出来。
- [BIRD 基准](https://bird-bench.github.io/):目前最常被引用的 Text-to-SQL 基准之一,首页的例子里专门有「外部知识」(evidence)一项,就是今天的术语表。Day 295 细讲。
- [dbt Semantic Layer](https://docs.getdbt.com/docs/use-dbt-semantic-layer/dbt-sl):术语表的工业版叫语义层,把 MRR 这类指标的口径定义成代码。今天先知道有这个东西,Day 295 再看。
- [DeepSeek · JSON Output](https://api-docs.deepseek.com/zh-cn/guides/json_mode):`response_format={"type": "json_object"}` 的要求,包括提示词里必须出现「json」这个词。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Yhn3zWEmj&autoplay=0&high_quality=1" title="智能问数 Agent 如何确保 SQL 生成 100% 准确?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Aloudata · 智能问数 Agent 如何确保 SQL 生成 100% 准确? · 33 分钟,厂商的分享。前半段讲为什么直接让模型写 SQL 不可靠、口径不一致的问题,和今天的实验结论一致;后半段是他们产品的指标语义层方案,带着「这是推销」的眼光看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1trg36gErA&autoplay=0&high_quality=1" title="【IT老齐899.76】NL2SQL四种落地方法" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IT老齐 · 【IT老齐899.76】NL2SQL四种落地方法 · 10 分钟。快速过一遍企业里问数的几种做法,今天的「库说明书」属于最基础的那种,知道后面还有哪些路就行。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/9eV8XHLe_fI" title="Finally. Semantic Layer. Explained in 9 minutes." loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Dawn Choo · Finally. Semantic Layer. Explained in 9 minutes. · 用 9 分钟讲清楚「同一个指标,不同部门算出不同的数」这个老问题,以及语义层怎么解决。今天的术语表就是一个手写的迷你语义层。</figcaption>
</figure>

### 书籍

- Ben Forta,《SQL 必知必会》(第 5 版),钟鸣、刘晓霞译,人民邮电出版社,2020。如果第一部分的 SQL 课学得有点虚,这本薄书一个晚上就能翻完,今天用到的 `DISTINCT`、`CASE`、子查询都在里面。

### 开源项目与代码

- [vanna-ai/vanna](https://github.com/vanna-ai/vanna):一个开源的 Text-to-SQL 框架。它早期 0.x 版本的「训练」就是往检索库里存三类东西:DDL、文档(相当于术语表)、问答对,和今天的三层说明书思路一致;2.0 版改成了 Agent 框架,README 里讲的是新架构,想看老思路翻它的旧版本文档。
- [simonw/datasette](https://github.com/simonw/datasette):把 SQLite 库变成可浏览网页的工具,做问数时拿它看数据、核对答案很方便。

## 自测

1. 只给列名时,「企业版的订阅有几个」返回 0。错在哪一类?哪一层说明书能救它?

<details><summary>答案</summary>

错在「不知道值」:模型猜 `plan = 'enterprise'`,库里存的是中文「企业版」。注释(`-- 基础版 / 专业版 / 企业版`)或真实取值(`-- subscriptions.plan 实际取值:专业版, 企业版, 基础版`)任意一层都能救,实验里「列名+真实取值」和「建表注释」两档都答对了。

</details>

2. 既然建表注释里已经写了每列的取值,为什么还要再去查真实取值?

<details><summary>答案</summary>

注释是人写的,会过时。实测 `invoices.status` 注释写 `paid / open / void / refunded`,库里只有 `open` 和 `paid`;`tickets.status` 注释写三种,实际只有 `open`。另外很多生产库根本没写注释。真实取值是从库里查出来的,能纠正注释,也能在没注释时单独顶上(720 字符就拿到 4/6)。

</details>

3. 为什么「最近 7 天」和「MRR」只有加了术语表才答对?

<details><summary>答案</summary>

它们缺的是口径,口径不在库里。「最近 7 天」要知道「今天」是数据快照日 2026-10-12,不是运行代码那天;MRR 要知道单价表(库里没有)和「有效订阅包括 past_due」这个业务决定。注释和取值都是从库里来的,再怎么查库也查不出库里没有的东西。

</details>

4. `SELECT DISTINCT ? FROM subscriptions` 传入参数 `('plan',)`,为什么不报错却返回 `[('plan',)]`?

<details><summary>答案</summary>

`?` 只能代表值,不能代表列名。SQLite 把它当成字面量字符串 `'plan'`,每一行都选出同一个字符串,去重后只剩一行 `'plan'`。所以列名、表名只能拼进 SQL 字符串,前提是来自写死的白名单。

</details>

5. 面试题:你接手一个问数项目,用户反馈「数经常不对,但 SQL 看着都没问题」。你会怎么排查和改进?

<details><summary>答案</summary>

先建一份带标准答案的题集(几十道真实的业务问题,答案由数据同学手写 SQL 得出),跑一遍拿到基线分数,把错题分类:不知道值(枚举猜错)、不知道口径(指标定义、时间范围)、关联错误(JOIN 放大行数)、其他。然后对症:不知道值就给枚举列加真实取值,注意检查注释和数据是否一致;不知道口径就和业务方一起写术语表,核心指标最好沉淀到语义层统一定义;时间类问题把「今天」动态注入。每改一次说明书都回归跑题集,因为术语表条目会互相干扰(比如单位换算被误用)。最后在回答里附上口径说明和 SQL,让用户能核对。

</details>

## 明天预告

Day 292 · 问数 Agent(二):三道闸,让 SQL 只读、跑得完。今天模型写的 SQL 我们是直接在只读连接上执行的。明天你会看到,用户说一句「把这张发票删掉」,模型就老老实实写出 `DELETE`;只读连接也有挡不住的东西,一条 `ATTACH` 就能把客户表复制到一个新文件里。我们用 sqlglot 解析、只读连接、授权回调三道闸加上超时,把模型写的 SQL 关进笼子里。
