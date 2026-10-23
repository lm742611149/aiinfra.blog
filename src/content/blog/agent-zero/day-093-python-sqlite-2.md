---
title: 'Day 93 · Python 操作 SQLite(二):事务、row_factory 和上下文管理器'
description: 'Python 的 sqlite3 默认在你写数据时悄悄开事务,不 commit 就不算数。今天用 Day 91 的扣款例子,在 Python 里重现「出错了还照样提交,钱被扣两遍」,再学 commit、rollback 和 with conn,让查询结果带上列名(row_factory),最后封装成一个 with db() 能用的函数。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'sqlite', 'transaction', 'row-factory', 'context-manager', 'agent-zero']
series: 'agent-zero'
day: 93
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 92](/blog/agent-zero/day-092-python-sqlite-1/) 把 SQL 接进了 Python:`sqlite3.connect` 连库,`execute` 拿游标,`fetchone`、`fetchall` 取成元组;用 f-string 拼 SQL 被 `' OR '1'='1` 一把读出整张表,换成 `?` 占位符就全部挡住;还知道了占位符管不到表名和列名,要靠白名单。最后一个实验里留了个没讲透的现象:往表里写一条数据以后,`conn.in_transaction` 变成了 `True`,`PRAGMA foreign_keys = ON` 也因此失效。

今天补上这块。Day 91 在命令行里用 `BEGIN`、`COMMIT`、`ROLLBACK` 管事务,Python 里没人替你敲 `BEGIN`,却有一套自己的规则:什么时候开、什么时候提交、出错怎么办。这套规则踩错一步,就是 Day 91 里「重试一次,钱被扣了两遍」。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说清 Python 的 `sqlite3` 什么时候自动开事务、为什么不调 `commit()` 数据就不会真的存下来,并用 `conn.in_transaction` 看出来。
2. 在 Python 里重现 Day 91 的扣款事故(捕获了错误还照样 `commit`),再用 `rollback()` 和 `with conn:` 两种办法修好。
3. 用 `row_factory = sqlite3.Row` 让查询结果能按列名取,转成字典和 JSON,并认得出 `Row` 不是字典带来的三个报错。
4. 写出一个 `with db() as conn:`:成功时自动提交,出错时自动回滚,无论如何都关连接,并用 pytest 证明它做到了。

今天两个新概念:**Python 里的事务**(`commit`、`rollback`、`with conn`)和 **`row_factory`**。最后一步的 `@contextmanager` 是一个固定写法,先照着用,装饰器 Day 96 讲,`with` 背后的原理 Day 98 讲。

预计用时:3 小时(东西比较多,第 5、6 步是补充,时间紧可以只读不跑)。花费 ¥0,不调 API。

前置:[Day 91](/blog/agent-zero/day-091-sql-6/) 的事务和约束(尤其是 `strict.sql`、`pay.sql` 和那个扣款事故);[Day 92](/blog/agent-zero/day-092-python-sqlite-1/) 的 `sqlite3` 基本用法;[Day 35](/blog/agent-zero/day-035-exceptions-1/)、[Day 36](/blog/agent-zero/day-036-exceptions-2/) 的 `try/except`、`raise`、`finally`;[Day 38](/blog/agent-zero/day-038-files-with/) 的 `with open(...)` 等价于 `try/finally`;[Day 73](/blog/agent-zero/day-073-pytest-3/) 的 fixture 和 `yield`。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写「出错 rollback」「`with conn:`」「`row_factory` 转字典」三件事;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 从前端看:你用过的「全成功或全撤回」

前端里最近的对照有两个。一个是 `IndexedDB` 的 `transaction`:一组读写放进同一个事务里,任何一步抛错,整组都不生效。另一个是乐观更新:先在界面上把数改了,请求失败了再整个还原。数据库的事务是同一个意思,只是更严格,而且处理的是钱。

Python 这边的特点是:**你没写 `BEGIN`,它也会替你开**;但**不替你提交**。这点和 JS 里 `fetch` 一发出去就生效的直觉相反:写了一条 `UPDATE`,在你调 `commit()` 之前,别的连接什么都看不到,程序一关,改动全部消失。

| JS / 前端里的东西 | Python sqlite3 里对应的 | 说明 |
| --- | --- | --- |
| `db.transaction(["a"], "readwrite")` | 第一条 `INSERT`/`UPDATE`/`DELETE` 自动开事务 | 默认模式下,你不用也不能手写 `BEGIN`(想手写,见练习 5) |
| 事务 `oncomplete` | `conn.commit()` | 确认,别的连接才看得见 |
| 事务 `abort()` / 抛错 | `conn.rollback()` | 全部撤销 |
| `try { ... } finally { close() }` | `with ... :` | `with conn:` 管提交和回滚,不管关闭 |
| 响应 JSON 里的 `{ id, company }` | `row_factory = sqlite3.Row` 再 `dict(row)` | 默认行是元组,没有名字 |

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="三条时间线:你的脚本里 execute 一条 UPDATE 后改动只在事务里,别的连接看不到;commit 以后写进文件,别的连接才看得到;rollback 或者关闭连接而没有 commit,改动被丢弃">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="24" fill="var(--ink)">连接 a(你的脚本)</text>
<rect x="20" y="36" width="170" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="105" y="57" fill="var(--ink)" text-anchor="middle" font-size="11">UPDATE 余额 -1188</text>
<text x="20" y="92" fill="var(--ink-soft)" font-size="11">自动开事务,in_transaction = True</text>
<text x="20" y="108" fill="var(--ink-soft)" font-size="11">a 看到 1812</text>
<rect x="250" y="36" width="170" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="335" y="57" fill="var(--ink)" text-anchor="middle" font-size="11">commit()</text>
<text x="250" y="92" fill="var(--ink-soft)" font-size="11">写进磁盘文件</text>
<text x="250" y="108" fill="var(--ink-soft)" font-size="11">in_transaction = False</text>
<rect x="470" y="36" width="150" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="545" y="57" fill="var(--ink)" text-anchor="middle" font-size="11">rollback() / close()</text>
<text x="470" y="92" fill="var(--ink-soft)" font-size="11">没 commit 的改动丢掉</text>
<text x="470" y="108" fill="var(--ink-soft)" font-size="11">余额回到 3000</text>
<line x1="190" y1="53" x2="250" y2="53" stroke="var(--rule)"/>
<line x1="420" y1="53" x2="470" y2="53" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="20" y="150" fill="var(--ink)">连接 b(别人)</text>
<rect x="20" y="162" width="170" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="105" y="183" fill="var(--ink)" text-anchor="middle" font-size="11">SELECT 余额 → 3000</text>
<rect x="250" y="162" width="170" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="335" y="183" fill="var(--ink)" text-anchor="middle" font-size="11">SELECT 余额 → 1812</text>
<rect x="470" y="162" width="150" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="545" y="183" fill="var(--ink)" text-anchor="middle" font-size="11">SELECT 余额 → 3000</text>
<text x="20" y="218" fill="var(--ink-soft)" font-size="11">commit 之前,b 看不到 a 的改动</text>
<text x="250" y="218" fill="var(--ink-soft)" font-size="11">commit 之后才看得到</text>
<text x="470" y="218" fill="var(--ink-soft)" font-size="11">改动从没发生过</text>
<text x="20" y="262" fill="var(--ink)">三个出口:commit 生效,rollback 撤销,没处理就 close(等于撤销)。</text>
<text x="20" y="282" fill="var(--ink-faint)" font-size="11">数字来自第 1 步的实跑。</text>
</g>
</svg>
<figcaption>事务的三个出口。蓝色是脚本里的普通操作,琥珀色的 commit 是唯一让改动「真正存下来」的一步;最右边是 rollback 和直接关连接,都等于这件事没发生过。</figcaption>
</figure>

## 第 1 步:写了不 commit,就不算数

今天的实验要一个有账户、有付款记录、有外键约束的库。Day 91 已经有现成的建表文件:`strict.sql`(带约束的客户和发票)和 `pay.sql`(`accounts` 账户表和 `payments` 付款表,1 号客户 3000 元,2 号客户 500 元)。写一个小工具,每次实验前把库**重建**一遍,保证每次都从同一个状态开始。新建 `part01/pay_setup.py`:

```python
# agent-zero-lab/part01/pay_setup.py
import sqlite3
from pathlib import Path

SQL_DIR = Path(__file__).parent / "sql"
PAY_DB = SQL_DIR / "pay_demo.db"


def fresh_db(path: Path = PAY_DB) -> None:
    """删掉旧库,按 Day 91 的 strict.sql + pay.sql 重建:带约束的客户、发票,加 accounts 和 payments。"""
    path.unlink(missing_ok=True)
    conn = sqlite3.connect(path)
    for name in ("strict.sql", "pay.sql"):
        conn.executescript((SQL_DIR / name).read_text(encoding="utf-8"))
    conn.close()
```

<div class="line-notes">

- `SQL_DIR = Path(__file__).parent / "sql"` Day 91 那些 `.sql` 文件所在的目录。
- `PAY_DB = SQL_DIR / "pay_demo.db"` 今天所有实验共用的数据库文件,和 `practice.db` 分开,不会弄脏它。
- `def fresh_db(path: Path = PAY_DB) -> None:` 参数有默认值,不传就重建 `PAY_DB`。
- `path.unlink(missing_ok=True)` 删文件。`missing_ok=True` 表示文件本来就不存在也不报错(Day 37 的 `pathlib`)。
- `conn = sqlite3.connect(path)` 连一个新的空库(文件已经被删了,这里会新建)。
- `for name in ("strict.sql", "pay.sql"):` 按顺序读两个文件:先建带约束的客户、发票,再建账户和付款表。
- `conn.executescript((SQL_DIR / name).read_text(encoding="utf-8"))` 把文件内容整段交给 `executescript` 执行。上一课说过它只用来跑自己的脚本,这里正是这个场合。
- `conn.close()` 关闭连接。

</div>

然后写第一个实验 `part01/tx_basics.py`。同一个数据库文件开**两个连接**:`a` 是写的人,`b` 是旁边看着的另一个人(另一个程序)。

```python
# agent-zero-lab/part01/tx_basics.py
import sqlite3

from part01.pay_setup import PAY_DB, fresh_db


def balance(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT balance FROM accounts WHERE customer_id = 1").fetchone()
    return row[0]


fresh_db()
a = sqlite3.connect(PAY_DB)
b = sqlite3.connect(PAY_DB)  # 另一个连接,模拟「别的人 / 别的程序」

print("一开始      a 看到", balance(a), " b 看到", balance(b), " a.in_transaction =", a.in_transaction)

a.execute("UPDATE accounts SET balance = balance - 1188 WHERE customer_id = 1")
print("a 扣款后    a 看到", balance(a), " b 看到", balance(b), " a.in_transaction =", a.in_transaction)

a.commit()
print("a.commit() 后 a 看到", balance(a), " b 看到", balance(b), " a.in_transaction =", a.in_transaction)

print("--- 不 commit 就关掉 ---")
a.execute("UPDATE accounts SET balance = balance - 100 WHERE customer_id = 1")
print("扣 100 后    a 看到", balance(a))
a.close()
print("a 关掉后     b 看到", balance(b))

print("--- rollback ---")
c = sqlite3.connect(PAY_DB)
c.execute("UPDATE accounts SET balance = balance - 100 WHERE customer_id = 1")
print("扣 100 后    c 看到", balance(c), " c.in_transaction =", c.in_transaction)
c.rollback()
print("rollback 后  c 看到", balance(c), " c.in_transaction =", c.in_transaction)
c.close()
b.close()
```

<div class="line-notes">

- `def balance(conn: sqlite3.Connection) -> int:` 小函数:查 1 号客户的余额。`fetchone()` 拿到 `(3000,)` 这样的元组,`row[0]` 取出数字。
- `fresh_db()` 每次实验先重建库。
- `a = sqlite3.connect(PAY_DB)` 连接 a,下面所有写操作都用它。
- `b = sqlite3.connect(PAY_DB)  # 另一个连接,模拟「别的人 / 别的程序」` 同一个文件再开一个连接。两个连接各自有各自的事务,互相看不到对方没提交的东西。
- `print("一开始      a 看到"` 实测两边都是 3000,`a.in_transaction = False`:光是连上、读一读,不会开事务。
- `a.execute("UPDATE accounts SET balance = balance - 1188 WHERE customer_id = 1")` 扣款。Python 在执行这种修改语句之前,**自动先发了一条 `BEGIN`**。
- `print("a 扣款后    a 看到"` 实测 a 看到 1812,`in_transaction = True`;b 看到的**还是 3000**,因为 a 没提交。
- `a.commit()` 提交:把事务里的改动正式写进文件,事务结束。
- `print("a.commit() 后 a 看到"` 实测 b 也看到 1812 了,`a.in_transaction = False`。
- `a.execute("UPDATE accounts SET balance = balance - 100 WHERE customer_id = 1")` 又扣 100,这次不提交。
- `a.close()` 直接关掉连接。没提交的改动在关闭时被撤销。
- `print("a 关掉后     b 看到", balance(b))` 实测 b 看到 1812,那 100 没有扣成。
- `c = sqlite3.connect(PAY_DB)` 再开一个连接 c 练 `rollback`。
- `c.rollback()` 主动撤销事务里的全部改动。
- `print("rollback 后  c 看到"` 实测余额从 1712 变回 1812,`in_transaction` 回到 `False`。

</div>

```bash
cd /Users/你/agent-zero-lab
uv run python -m part01.tx_basics
```

```text
一开始      a 看到 3000  b 看到 3000  a.in_transaction = False
a 扣款后    a 看到 1812  b 看到 3000  a.in_transaction = True
a.commit() 后 a 看到 1812  b 看到 1812  a.in_transaction = False
--- 不 commit 就关掉 ---
扣 100 后    a 看到 1712
a 关掉后     b 看到 1812
--- rollback ---
扣 100 后    c 看到 1712  c.in_transaction = True
rollback 后  c 看到 1812  c.in_transaction = False
```

读这份输出,要抓住三件事:

- `UPDATE` 之后 `in_transaction` 变成 `True`,说明 Python 悄悄开了一个事务。**`SELECT` 不会触发**,只有 `INSERT`、`UPDATE`、`DELETE`、`REPLACE` 才会。(官方文档在 [Transaction control](https://docs.python.org/3/library/sqlite3.html) 一节里写得很清楚,这是默认模式的行为,3.12 以前只有这一种。)
- 事务没结束前,另一个连接 b 看到的永远是旧值。这是**隔离**:别人的半成品对你不可见。
- 事务不提交就关掉,等于没做。所以**忘了写 `conn.commit()` 的脚本,跑完什么都没存下来**,而且不报任何错。这是新手写 SQLite 最常遇到的第一个「我的数据呢」。

## 第 2 步:重现 Day 91 的事故

Day 91 在命令行里演示过:付 3 号发票要三步(扣余额、记付款、改发票状态),重试一次时第 2 步撞上 `UNIQUE`,命令行却继续往下读,最后 `COMMIT` 把第 1 步的重复扣款也提交了,余额从 1812 变成 624。现在在 Python 里复现一遍,并用三种写法对比。新建 `part01/pay_py.py`:

```python
# agent-zero-lab/part01/pay_py.py
import sqlite3
from collections.abc import Callable

from part01.pay_setup import PAY_DB, fresh_db

TODAY = "2026-10-23"


def state(conn: sqlite3.Connection) -> str:
    """一行看三个状态:余额、付款记录条数、3 号发票状态。"""
    bal = conn.execute("SELECT balance FROM accounts WHERE customer_id = 1").fetchone()[0]
    n = conn.execute("SELECT count(*) FROM payments").fetchone()[0]
    st = conn.execute("SELECT status FROM invoices WHERE id = 3").fetchone()[0]
    return f"余额 {bal},付款记录 {n} 条,3 号发票 {st}"


def pay_v1(conn: sqlite3.Connection) -> None:
    """错误示范:出错只打印,然后照样提交。"""
    try:
        conn.execute("UPDATE accounts SET balance = balance - 1188 WHERE customer_id = 1")
        conn.execute("INSERT INTO payments (invoice_id, amount, paid_at) VALUES (3, 1188, ?)", (TODAY,))
        conn.execute("UPDATE invoices SET status = 'paid' WHERE id = 3")
    except sqlite3.Error as e:
        print("  出错了:", e)
    conn.commit()


def pay_v2(conn: sqlite3.Connection) -> None:
    """出错就 rollback,再把异常原样抛出去。"""
    try:
        conn.execute("UPDATE accounts SET balance = balance - 1188 WHERE customer_id = 1")
        conn.execute("INSERT INTO payments (invoice_id, amount, paid_at) VALUES (3, 1188, ?)", (TODAY,))
        conn.execute("UPDATE invoices SET status = 'paid' WHERE id = 3")
        conn.commit()
    except sqlite3.Error:
        conn.rollback()
        raise


def pay_v3(conn: sqlite3.Connection) -> None:
    """with conn:成功自动 commit,出错自动 rollback,异常继续往外抛。"""
    with conn:
        conn.execute("UPDATE accounts SET balance = balance - 1188 WHERE customer_id = 1")
        conn.execute("INSERT INTO payments (invoice_id, amount, paid_at) VALUES (3, 1188, ?)", (TODAY,))
        conn.execute("UPDATE invoices SET status = 'paid' WHERE id = 3")


def run(label: str, pay: Callable[[sqlite3.Connection], None]) -> None:
    print(f"== {label} ==")
    fresh_db()
    conn = sqlite3.connect(PAY_DB)
    conn.execute("PRAGMA foreign_keys = ON")
    print("开始:", state(conn))
    pay(conn)
    print("第一次付款后:", state(conn))
    try:
        pay(conn)
    except sqlite3.Error as e:
        print("  重试时抛出:", type(e).__name__, e)
    print("重试之后:", state(conn))
    conn.close()


run("v1 出错只打印,照样提交", pay_v1)
run("v2 出错 rollback 再抛", pay_v2)
run("v3 with conn", pay_v3)
```

<div class="line-notes">

- `TODAY = "2026-10-23"` 付款日期,写死,让输出每次一样。
- `def state(conn: sqlite3.Connection) -> str:` 把三个状态拼成一句话,每个实验前后都打印它。
- `bal = conn.execute("SELECT balance FROM accounts WHERE customer_id = 1").fetchone()[0]` 余额。
- `n = conn.execute("SELECT count(*) FROM payments").fetchone()[0]` 付款记录有几条。
- `st = conn.execute("SELECT status FROM invoices WHERE id = 3").fetchone()[0]` 3 号发票状态。
- `def pay_v1(conn: sqlite3.Connection) -> None:` 第一种写法,**错误示范**:出错只打印一下,然后照常提交。很多初学者写出这样的代码,因为「不让程序崩」听起来是好事。
- `conn.execute("UPDATE accounts SET balance = balance - 1188 WHERE customer_id = 1")` 第 1 步扣款。
- `conn.execute("INSERT INTO payments (invoice_id, amount, paid_at) VALUES (3, 1188, ?)", (TODAY,))` 第 2 步记付款。3 号发票已经有付款记录时,这里撞上 `UNIQUE`。注意日期用 `?` 传(Day 92 的规矩),`(TODAY,)` 的逗号别漏。
- `conn.execute("UPDATE invoices SET status = 'paid' WHERE id = 3")` 第 3 步改状态。
- `except sqlite3.Error as e:` 接住所有 sqlite3 的错误,只 `print`,**没有 `rollback`**,也没有重新抛出。第 1 步已经执行完的扣款还在事务里挂着。
- `conn.commit()` 接在 `try/except` 之后,不管有没有出错都会执行。于是第 1 步的扣款被提交了,而第 2、3 步没做。
- `def pay_v2(conn: sqlite3.Connection) -> None:` 第二种写法:`commit()` 放进 `try` 的最后一行,只有三步都成功才会走到。
- `except sqlite3.Error:` 出错就进这里。
- `conn.rollback()` 撤销这个事务里已经做完的所有步骤。
- `raise` 单独一个 `raise`(Day 36)把刚才接住的异常**原样再抛出去**,让调用的人知道失败了。吞掉错误只打印是 v1 的毛病。
- `def pay_v3(conn: sqlite3.Connection) -> None:` 第三种写法,最短。
- `with conn:` 把连接当成「上下文管理器」用:块里的代码全部跑完,自动 `commit()`;块里抛了异常,自动 `rollback()`,然后异常继续往外传。**注意它不会关闭连接**,下一步专门验证。
- `def run(label: str, pay: Callable[[sqlite3.Connection], None]) -> None:` 把「付款函数」当参数传进来(函数也是对象,Day 28),这样三种写法能用同一个实验流程。`Callable[[sqlite3.Connection], None]` 的意思是:接收一个连接、不返回东西的函数。
- `fresh_db()` 每种写法从同一个初始状态开始。
- `conn.execute("PRAGMA foreign_keys = ON")` 连接一建好就开外键(Day 92 的规矩)。
- `print("开始:", state(conn))` 先看初始状态:余额 3000,0 条付款记录,3 号发票 unpaid。
- `pay(conn)` 第一次付款,应该成功。
- `pay(conn)` 第二次是「重试」,第 2 步一定撞 `UNIQUE`。v1 里错误在函数内部被吞掉了,v2、v3 会把异常抛出来,所以放在 `try` 里接。
- `print("  重试时抛出:", type(e).__name__, e)` 打印异常的类名和消息,实测是 `IntegrityError UNIQUE constraint failed: payments.invoice_id`。
- `run("v1 出错只打印,照样提交", pay_v1)` 三次调用,各跑一遍完整流程。

</div>

```bash
uv run python -m part01.pay_py
```

```text
== v1 出错只打印,照样提交 ==
开始: 余额 3000,付款记录 0 条,3 号发票 unpaid
第一次付款后: 余额 1812,付款记录 1 条,3 号发票 paid
  出错了: UNIQUE constraint failed: payments.invoice_id
重试之后: 余额 624,付款记录 1 条,3 号发票 paid
== v2 出错 rollback 再抛 ==
开始: 余额 3000,付款记录 0 条,3 号发票 unpaid
第一次付款后: 余额 1812,付款记录 1 条,3 号发票 paid
  重试时抛出: IntegrityError UNIQUE constraint failed: payments.invoice_id
重试之后: 余额 1812,付款记录 1 条,3 号发票 paid
== v3 with conn ==
开始: 余额 3000,付款记录 0 条,3 号发票 unpaid
第一次付款后: 余额 1812,付款记录 1 条,3 号发票 paid
  重试时抛出: IntegrityError UNIQUE constraint failed: payments.invoice_id
重试之后: 余额 1812,付款记录 1 条,3 号发票 paid
```

v1 的最后一行就是 Day 91 的那个事故:**余额 624,付款记录只有 1 条**。三步里只有第 1 步在重试时被提交了,钱凭空少了 1188,账上没有对应的付款记录。v2 和 v3 的重试都抛出了 `IntegrityError`,而且「重试之后」的余额还是 1812,说明第二次的第 1 步被撤回了。

这里有一个很值得记住的区别。v1 的错误**不是 SQLite 的错,是写代码的人的错**:SQLite 乖乖地把第 2 步拒绝了,是 `commit()` 这行把残局提交了。数据库的约束只能说「这一步不行」,「前面的步骤也要作废」得由你的代码(`rollback` 或者 `with conn:`)来说。

### `with conn:` 不会关连接

`with conn:` 很容易被误会成 `with open(...)` 那样,出了块就关。新建 `part01/with_conn_facts.py` 验证三件事:正常走完时发生什么、块里抛异常时发生什么、块结束后连接还能不能用。

```python
# agent-zero-lab/part01/with_conn_facts.py
import sqlite3

from part01.pay_setup import PAY_DB, fresh_db

fresh_db()
conn = sqlite3.connect(PAY_DB)


def balance() -> int:
    return conn.execute("SELECT balance FROM accounts WHERE customer_id = 1").fetchone()[0]


print("== 正常走完 with ==")
with conn:
    conn.execute("UPDATE accounts SET balance = balance - 100 WHERE customer_id = 1")
    print("块内 in_transaction =", conn.in_transaction, " 余额", balance())
print("块外 in_transaction =", conn.in_transaction, " 余额", balance())

print("== with 块里抛异常 ==")
try:
    with conn:
        conn.execute("UPDATE accounts SET balance = balance - 100 WHERE customer_id = 1")
        print("块内 余额", balance())
        raise RuntimeError("中途出错")
except RuntimeError as e:
    print("异常照常传出来:", e)
print("块外 in_transaction =", conn.in_transaction, " 余额", balance())

print("== with 不会关连接 ==")
print("连接还能用吗:", conn.execute("SELECT 1").fetchone())
conn.close()
try:
    conn.execute("SELECT 1")
except sqlite3.ProgrammingError as e:
    print("close() 之后:", type(e).__name__, e)
```

<div class="line-notes">

- `conn = sqlite3.connect(PAY_DB)` 一个连接用到底,这是要观察的对象。
- `def balance() -> int:` 查余额的小函数,这次直接用外面的 `conn`。
- `with conn:` 第一个实验:块里正常结束。
- `conn.execute("UPDATE accounts SET balance = balance - 100 WHERE customer_id = 1")` 扣 100。
- `print("块内 in_transaction =",` 块内实测 `True`,余额 2900。
- `print("块外 in_transaction =",` 离开块后实测 `False`:`with` 帮你 `commit()` 了,余额还是 2900。
- `raise RuntimeError("中途出错")` 第二个实验:扣了 100 之后(块内余额 2800)故意抛一个和数据库无关的异常。
- `except RuntimeError as e:` 在 `with` 外面接住,证明 `with conn:` **没有吞掉异常**,打印出「异常照常传出来」。
- `print("块外 in_transaction =",` 块外余额回到 2900,第二个 100 被撤回了,`in_transaction` 是 `False`。
- `print("连接还能用吗:", conn.execute("SELECT 1").fetchone())` 离开 `with conn:` 之后连接还能照常执行,实测 `(1,)`。它没被关。
- `conn.close()` 自己关。
- `except sqlite3.ProgrammingError as e:` 关了以后再用,报 `ProgrammingError: Cannot operate on a closed database.`。

</div>

```text
== 正常走完 with ==
块内 in_transaction = True  余额 2900
块外 in_transaction = False  余额 2900
== with 块里抛异常 ==
块内 余额 2800
异常照常传出来: 中途出错
块外 in_transaction = False  余额 2900
== with 不会关连接 ==
连接还能用吗: (1,)
close() 之后: ProgrammingError Cannot operate on a closed database.
```

所以 `with conn:` 只管**提交还是回滚**,不管**关闭**。要想「出了块连接就关」,得自己 `conn.close()`,或者用后面第 7 步封装的 `db()`。

## 第 3 步:「改成功」不等于「改到了东西」

Day 86 里埋过一句:`UPDATE ... WHERE id = 999` 找不到那一行时不会报错,只是改了 0 行,接口要自己检查影响行数,0 行就该回 404。Python 里拿影响行数的办法是 `cursor.rowcount`。新建 `part01/rowcount_demo.py`:

```python
# agent-zero-lab/part01/rowcount_demo.py
import sqlite3

from part01.pay_setup import PAY_DB, fresh_db

fresh_db()
conn = sqlite3.connect(PAY_DB)
conn.execute("PRAGMA foreign_keys = ON")

cur = conn.execute("UPDATE accounts SET balance = balance - 10 WHERE customer_id = 1")
print("改存在的账户  rowcount =", cur.rowcount)
cur = conn.execute("UPDATE accounts SET balance = balance - 10 WHERE customer_id = 99")
print("改不存在的账户 rowcount =", cur.rowcount, " <- 没报错,但什么也没改")
cur = conn.execute("SELECT * FROM accounts")
print("SELECT 的 rowcount =", cur.rowcount)
cur = conn.execute("INSERT INTO payments (invoice_id, amount, paid_at) VALUES (3, 1188, '2026-10-23')")
print("INSERT 之后 lastrowid =", cur.lastrowid, " rowcount =", cur.rowcount)
conn.rollback()
conn.close()
```

<div class="line-notes">

- `cur = conn.execute("UPDATE accounts SET balance = balance - 10 WHERE customer_id = 1")` 把 `execute` 的返回值留下来,它是游标,上面带着这条语句的信息。
- `print("改存在的账户  rowcount =", cur.rowcount)` `rowcount` 是「这条语句改了几行」,实测 1。
- `WHERE customer_id = 99` 99 号账户不存在。
- `print("改不存在的账户 rowcount =",` 实测 0:**没有报错**,只是什么也没改。如果调用方不看 `rowcount`,就会以为扣款成功了。
- `cur = conn.execute("SELECT * FROM accounts")` 查询语句的 `rowcount` 没有意义。
- `print("SELECT 的 rowcount =", cur.rowcount)` 实测 -1,表示「不知道」。别拿它判断查到几行,查询的行数用 `len(fetchall())`。
- `cur = conn.execute("INSERT INTO payments` 插入一条付款记录。
- `print("INSERT 之后 lastrowid =",` `cur.lastrowid` 是刚插入那一行的主键,这里实测 1(付款表是空的,第一行编号 1)。以后「创建一张工单,把新工单的编号返回给模型」就靠它。
- `conn.rollback()` 这些都是实验,撤销掉,别留下痕迹。

</div>

```text
改存在的账户  rowcount = 1
改不存在的账户 rowcount = 0  <- 没报错,但什么也没改
SELECT 的 rowcount = -1
INSERT 之后 lastrowid = 1  rowcount = 1
```

所以修改类的函数要养成习惯:拿到 `cur.rowcount`,是 0 就抛异常或者返回「没找到」。第 7 步的 `pay_invoice` 和练习 2 都会用到。

## 第 4 步:commit 不是免费的,事务也不能开太久

提交一次要把改动真正落到磁盘,这一步有成本。把「每插一条就 commit」和「全插完 commit 一次」比一下。新建 `part01/commit_cost.py`:

```python
# agent-zero-lab/part01/commit_cost.py
import sqlite3
import time
from pathlib import Path

TMP_DB = Path(__file__).parent / "sql" / "commit_cost.db"
N = 500


def fresh() -> None:
    TMP_DB.unlink(missing_ok=True)
    conn = sqlite3.connect(TMP_DB)
    conn.execute("CREATE TABLE logs (id INTEGER PRIMARY KEY, msg TEXT NOT NULL)")
    conn.commit()
    conn.close()


def each_commit() -> float:
    conn = sqlite3.connect(TMP_DB)
    t0 = time.perf_counter()
    for i in range(N):
        conn.execute("INSERT INTO logs (msg) VALUES (?)", (f"第 {i} 条",))
        conn.commit()
    elapsed = time.perf_counter() - t0
    conn.close()
    return elapsed


def one_commit() -> float:
    conn = sqlite3.connect(TMP_DB)
    t0 = time.perf_counter()
    for i in range(N):
        conn.execute("INSERT INTO logs (msg) VALUES (?)", (f"第 {i} 条",))
    conn.commit()
    elapsed = time.perf_counter() - t0
    conn.close()
    return elapsed


fresh()
a = each_commit()
fresh()
b = one_commit()
print(f"每条都 commit:{a:.3f} 秒;全部做完 commit 一次:{b:.3f} 秒;差 {a / b:.0f} 倍")
TMP_DB.unlink()
```

<div class="line-notes">

- `TMP_DB = Path(__file__).parent / "sql" / "commit_cost.db"` 临时库,实验完删掉。
- `N = 500` 插 500 条日志。
- `def fresh() -> None:` 删旧库、新建一张只有两列的日志表,每次比较前都从空表开始。建表后手动 `conn.commit()`、`conn.close()`,这些都是今天学过的。
- `def each_commit() -> float:` 第一种:每插一行就 `commit()` 一次。
- `t0 = time.perf_counter()` `perf_counter` 是 Python 里测短时间的计时器,单位秒。
- `conn.execute("INSERT INTO logs (msg) VALUES (?)", (f"第 {i} 条",))` 插一行,参数里用 f-string 生成这一行的内容。注意 f-string 在参数元组里,不在 SQL 文本里,不违反 Day 92 的规矩。
- `conn.commit()` 在循环里。500 次提交,每次都要等磁盘确认。
- `def one_commit() -> float:` 第二种:插完 500 行再提交一次。
- `conn.commit()` 缩进在循环**外面**,只有一次。
- `print(f"每条都 commit:` 打印两个耗时和倍数。

</div>

```bash
uv run python -m part01.commit_cost
```

```text
每条都 commit:0.273 秒;全部做完 commit 一次:0.001 秒;差 191 倍
```

两次实测相差大约二百倍(这台机器同时还有别的任务在跑,具体数字每次不同,只看量级)。结论很实用:**一批相关的写操作放进同一个事务,最后提交一次**,既快又保证一致;每条一提交,慢,而且中途断了会留下一半。Day 94 造 15 张发票时就这么做。

反过来,事务也不能开太久。一个连接的事务没结束,它手里的写锁就一直占着。新建 `part01/locked_demo.py`,让连接 a 写了不提交,连接 b 也来写:

```python
# agent-zero-lab/part01/locked_demo.py
import sqlite3
import time

from part01.pay_setup import PAY_DB, fresh_db

fresh_db()
a = sqlite3.connect(PAY_DB)
b = sqlite3.connect(PAY_DB, timeout=0.5)  # 默认 5 秒,这里缩短,免得干等

a.execute("UPDATE accounts SET balance = balance - 1 WHERE customer_id = 1")  # 开了事务,没提交
print("a 正在写,还没提交。b 也想写:")
t0 = time.perf_counter()
try:
    b.execute("UPDATE accounts SET balance = balance - 1 WHERE customer_id = 2")
except sqlite3.OperationalError as e:
    print(f"  {time.perf_counter() - t0:.1f} 秒后报错:", type(e).__name__, e)
    print("  b.in_transaction =", b.in_transaction, "<- 失败了,但事务还开着")
    b.rollback()

print("b 只是读,不受影响:", b.execute("SELECT balance FROM accounts WHERE customer_id = 2").fetchall())
a.commit()
b.execute("UPDATE accounts SET balance = balance - 1 WHERE customer_id = 2")
b.commit()
print("a 提交之后 b 写成功了:", b.execute("SELECT balance FROM accounts WHERE customer_id = 2").fetchall())
a.close()
b.close()
```

<div class="line-notes">

- `a = sqlite3.connect(PAY_DB)` 连接 a 用默认设置。
- `b = sqlite3.connect(PAY_DB, timeout=0.5)` `timeout` 是「碰到别人正在写,最多等几秒」,默认 5 秒。这里改成 0.5 秒,免得实验时干等。
- `a.execute("UPDATE accounts SET balance = balance - 1 WHERE customer_id = 1")  # 开了事务,没提交` a 开了事务,拿到写锁,故意不提交。
- `t0 = time.perf_counter()` 记下 b 开始等的时间。
- `b.execute("UPDATE accounts SET balance = balance - 1 WHERE customer_id = 2")` b 想改另一个客户的余额。**不是同一行也不行**:SQLite 的写锁是整个数据库文件一把,同一时刻只有一个连接能写。
- `except sqlite3.OperationalError as e:` b 等了约 0.5 秒,放弃,报 `OperationalError: database is locked`。
- `print("  b.in_transaction =",` 实测 `True`:b 的 `UPDATE` 失败了,可它之前已经隐式开了事务,事务还挂着。
- `b.rollback()` 必须主动回滚结束它。我最初没写这一行,后面 `a.commit()` 也被卡住,同样报 `database is locked`:b 事务里那次读,占着读锁,a 的提交要等所有读者让开。**出了错,事务别晾着。**
- `b.execute("SELECT balance FROM accounts WHERE customer_id = 2").fetchall()` 读操作不受写锁影响,b 照样读到 500。这里用 `fetchall()` 把结果取干净,没取完的查询也会占着锁。
- `a.commit()` a 提交,写锁释放。
- `b.execute("UPDATE accounts SET balance = balance - 1 WHERE customer_id = 2")` 再写就成功了,余额 499。

</div>

```text
a 正在写,还没提交。b 也想写:
  0.6 秒后报错: OperationalError database is locked
  b.in_transaction = True <- 失败了,但事务还开着
b 只是读,不受影响: [(500,)]
a 提交之后 b 写成功了: [(499,)]
```

规矩合起来是:事务里只放数据库操作,越短越好;不要在事务中间等网络、等用户、等模型回复(Day 91 的老话);出错了立刻 `rollback`。

## 第 5 步:Python 3.12 的 `autocommit` 参数(了解就行)

前面所有行为是 Python 的**默认模式**(官方文档里叫 legacy,沿用 3.12 以前的老习惯)。3.12 新增了一个 `autocommit` 参数,文档说推荐用它,而且「默认值将来会改成 `False`」。三种取值对比一下,新建 `part01/autocommit_modes.py`:

```python
# agent-zero-lab/part01/autocommit_modes.py
import sqlite3

from part01.pay_setup import PAY_DB, fresh_db

fresh_db()

print("== 默认(legacy):写的时候才开事务 ==")
conn = sqlite3.connect(PAY_DB)
print("autocommit =", conn.autocommit, " in_transaction =", conn.in_transaction)
conn.execute("SELECT 1")
print("SELECT 之后  in_transaction =", conn.in_transaction)
conn.execute("UPDATE accounts SET balance = balance WHERE customer_id = 1")
print("UPDATE 之后  in_transaction =", conn.in_transaction)
conn.close()

print("== autocommit=False:连上就在事务里 ==")
conn = sqlite3.connect(PAY_DB, autocommit=False)
print("autocommit =", conn.autocommit, " in_transaction =", conn.in_transaction)
conn.execute("PRAGMA foreign_keys = ON")
print("foreign_keys =", conn.execute("PRAGMA foreign_keys").fetchone(), "<- 事务里开不上")
conn.commit()
print("commit 之后 in_transaction =", conn.in_transaction, "(马上又开了新的一个)")
conn.close()

print("== autocommit=True:每条语句自己提交 ==")
conn = sqlite3.connect(PAY_DB, autocommit=True)
conn.execute("PRAGMA foreign_keys = ON")
print("foreign_keys =", conn.execute("PRAGMA foreign_keys").fetchone())
conn.execute("UPDATE accounts SET balance = balance - 5 WHERE customer_id = 1")
print("UPDATE 之后 in_transaction =", conn.in_transaction)
conn.close()
other = sqlite3.connect(PAY_DB)
print("别的连接看到余额:", other.execute("SELECT balance FROM accounts WHERE customer_id = 1").fetchone()[0])
other.close()
```

<div class="line-notes">

- `conn = sqlite3.connect(PAY_DB)` 默认模式,什么参数都不传。
- `print("autocommit =", conn.autocommit,` 实测 `-1`,这是「保持老行为」的特殊常量 `sqlite3.LEGACY_TRANSACTION_CONTROL`。
- `conn.execute("SELECT 1")` 读不会开事务,`in_transaction` 仍是 `False`。
- `conn.execute("UPDATE accounts SET balance = balance WHERE customer_id = 1")` 一条不改数的 `UPDATE`,为了触发隐式事务,执行后 `in_transaction` 是 `True`。
- `sqlite3.connect(PAY_DB, autocommit=False)` 第二种,**PEP 249 风格**(PEP 249 是 Python 数据库接口的统一规范):连上就在事务里,`commit()` 之后马上自动又开一个新的。
- `conn.execute("PRAGMA foreign_keys = ON")` 注意!连接一建好就已经在事务里了,这条 `PRAGMA` 又碰上第 92 课的老问题,实测查回来 `(0,)`:**开不上**。
- `sqlite3.connect(PAY_DB, autocommit=True)` 第三种:SQLite 自己的自动提交模式,每条语句执行完立刻生效,`commit()` 和 `rollback()` 都没有作用。
- `conn.execute("PRAGMA foreign_keys = ON")` 这个模式下没有事务拦着,开关实测 `(1,)`,开上了。
- `conn.execute("UPDATE accounts SET balance = balance - 5 WHERE customer_id = 1")` 没写 `commit()`。
- `print("UPDATE 之后 in_transaction =",` 实测 `False`。
- `other = sqlite3.connect(PAY_DB)` 开另一个连接来核对。
- `print("别的连接看到余额:"` 实测 2995,在没写 `commit()` 的情况下,别人已经看到扣款了。

</div>

```text
== 默认(legacy):写的时候才开事务 ==
autocommit = -1  in_transaction = False
SELECT 之后  in_transaction = False
UPDATE 之后  in_transaction = True
== autocommit=False:连上就在事务里 ==
autocommit = False  in_transaction = True
foreign_keys = (0,) <- 事务里开不上
commit 之后 in_transaction = True (马上又开了新的一个)
== autocommit=True:每条语句自己提交 ==
foreign_keys = (1,)
UPDATE 之后 in_transaction = False
别的连接看到余额: 2995
```

怎么选?这一课我们**用默认模式**,理由有两个:本课程以后所有代码都按它写;`with conn:` 加 `rollback()` 在这个模式下行为最清楚。但要知道另外两个存在:如果你以后在别人的项目里看到 `autocommit=False`,意思是「PEP 249 风格,每次 commit 之后自动开新事务」;而且**用它时 `PRAGMA foreign_keys = ON` 要换个办法打开**,因为连上就在事务里,没机会先开。同一个坑有三种表现,答案都是一句话:外键开关要在任何事务开始之前设置。

## 第 6 步:让每一行有名字:`row_factory`

Day 92 取回来的是元组 `(1, '星河餐饮', '专业版')`,不知道哪个是哪个,代码里只能写 `row[1]`。这很脆:有人在 `SELECT` 里调换一下列的顺序,所有下标都错位,而且没有报错。办法是给连接设 `row_factory`。新建 `part01/row_factory_demo.py`:

```python
# agent-zero-lab/part01/row_factory_demo.py
import json
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "sql" / "practice.db"
SQL = "SELECT id, company, plan FROM customers WHERE id = 1"

conn = sqlite3.connect(DB_PATH)

print("== 默认:元组 ==")
row = conn.execute(SQL).fetchone()
print(row, type(row).__name__)

print("== row_factory = sqlite3.Row ==")
conn.row_factory = sqlite3.Row
row = conn.execute(SQL).fetchone()
print("类型:", type(row).__name__)
print("按名字:", row["company"], "  按位置:", row[1], "  列名:", row.keys())
print("解包照旧可用:", end=" ")
customer_id, company, plan = row
print(customer_id, company, plan)
as_dict = dict(row)
print("转成字典:", as_dict)
print("转成 JSON:", json.dumps(as_dict, ensure_ascii=False))

print("== Row 不是字典 ==")


def missing_key() -> None:
    row["nope"]


def call_get() -> None:
    row.get("nope")


def assign() -> None:
    row["plan"] = "x"


for label, fn in [("row['nope']      ", missing_key), ("row.get('nope')  ", call_get), ("row['plan'] = 'x'", assign)]:
    try:
        fn()
    except Exception as e:
        print(label, "->", type(e).__name__ + ":", e)

print("== 自己写一个返回字典的 row_factory ==")


def dict_factory(cursor: sqlite3.Cursor, row: tuple) -> dict:
    return {col[0]: value for col, value in zip(cursor.description, row)}


conn.row_factory = dict_factory
rows = conn.execute("SELECT id, company FROM customers WHERE city = '上海' ORDER BY id").fetchall()
print(rows)

print("== JOIN 出现同名列 ==")
conn.row_factory = sqlite3.Row
join_sql = "SELECT c.id, i.id, i.amount FROM customers c JOIN invoices i ON i.customer_id = c.id WHERE i.id = 3"
row = conn.execute(join_sql).fetchone()
print("keys():", row.keys(), " dict(row):", dict(row))
row = conn.execute(join_sql.replace("c.id, i.id", "c.id AS customer_id, i.id AS invoice_id")).fetchone()
print("起别名后:", dict(row))
conn.close()
```

<div class="line-notes">

- `import json` 把行转成 JSON 字符串要用(Day 39)。
- `SQL = "SELECT id, company, plan FROM customers WHERE id = 1"` 同一条查询会在不同设置下用好几次,所以存成常量。
- `row = conn.execute(SQL).fetchone()` 默认状态,实测 `(1, '星河餐饮', '专业版') tuple`。
- `conn.row_factory = sqlite3.Row` 设置 `row_factory`:告诉连接「以后每一行用这个东西来造」。`sqlite3.Row` 是标准库自带的一种行类型,**之后**创建的游标才生效,所以要在 `execute` 之前设。
- `print("类型:", type(row).__name__)` 现在是 `Row`。注意我故意没有直接 `print(row)`,因为它会打印出带内存地址的 `<sqlite3.Row object at 0x...>`,每次不同,没有信息量。
- `print("按名字:", row["company"], "  按位置:", row[1], "  列名:", row.keys())` `Row` 同时支持按名字(`row["company"]`)和按位置(`row[1]`);`.keys()` 返回列名列表 `['id', 'company', 'plan']`。
- `customer_id, company, plan = row` 解包(Day 22)照旧可用,`Row` 还是一个序列。
- `as_dict = dict(row)` 转成真正的字典 `{'id': 1, 'company': '星河餐饮', 'plan': '专业版'}`。
- `json.dumps(as_dict, ensure_ascii=False)` 转成 JSON 字符串。`ensure_ascii=False` 让中文保持原样,不写成 `星` 那种转义。Agent 的工具返回给模型的,多数时候就是这样一个字符串。
- `def missing_key() -> None:` 下面三个小函数各演示一种 `Row` 与字典不同的地方。`row["nope"]` 取不存在的列。
- `def call_get() -> None:` `row.get("nope")`,字典有的 `.get()`,Row 没有。
- `def assign() -> None:` `row["plan"] = "x"`,想修改 Row 里的值。
- `for label, fn in [(` 把三个函数连同标签放进列表,统一在 `try` 里调用,打印出异常类名和消息。
- `except Exception as e:` 这里故意接得很宽,因为三种异常类型不一样:`IndexError`(列名不存在)、`AttributeError`(没有 `.get`)、`TypeError`(不支持赋值),实测分别是 `IndexError: No item with that key`、`AttributeError: 'sqlite3.Row' object has no attribute 'get'`、`TypeError: 'sqlite3.Row' object does not support item assignment`。
- `def dict_factory(cursor: sqlite3.Cursor, row: tuple) -> dict:` 自己写一个 `row_factory`:它是一个函数,每取一行就被调用一次,收到游标和原始元组,返回你想要的东西。
- `return {col[0]: value for col, value in zip(cursor.description, row)}` 字典推导式(Day 26):`cursor.description` 每项的第 0 个是列名,`zip` 把「列名」和「值」一一配对。
- `conn.row_factory = dict_factory` 换成自己的,取出来的每一行直接是字典,实测 `[{'id': 2, 'company': '青木设计'}, {'id': 8, 'company': '云杉律所'}]`。
- `join_sql = "SELECT c.id, i.id, i.amount FROM customers c JOIN invoices i ON i.customer_id = c.id WHERE i.id = 3"` JOIN 两张表,而且**两张表都有 `id` 列**,都没起别名。
- `print("keys():", row.keys(), " dict(row):", dict(row))` 实测 `keys()` 是 `['id', 'id', 'amount']`,`dict(row)` 却只有 `{'id': 1, 'amount': 1188}`:两个 `id` 合并成了一个,3 号发票的编号**悄悄丢了**。
- `join_sql.replace("c.id, i.id", "c.id AS customer_id, i.id AS invoice_id")` 起别名(Day 87 的 `AS`)就解决了,实测 `{'customer_id': 1, 'invoice_id': 3, 'amount': 1188}`。做 JOIN 又要转 JSON 的时候,**每一列都起一个不重名的别名**。

</div>

```text
== 默认:元组 ==
(1, '星河餐饮', '专业版') tuple
== row_factory = sqlite3.Row ==
类型: Row
按名字: 星河餐饮   按位置: 星河餐饮   列名: ['id', 'company', 'plan']
解包照旧可用: 1 星河餐饮 专业版
转成字典: {'id': 1, 'company': '星河餐饮', 'plan': '专业版'}
转成 JSON: {"id": 1, "company": "星河餐饮", "plan": "专业版"}
== Row 不是字典 ==
row['nope']       -> IndexError: No item with that key
row.get('nope')   -> AttributeError: 'sqlite3.Row' object has no attribute 'get'
row['plan'] = 'x' -> TypeError: 'sqlite3.Row' object does not support item assignment
== 自己写一个返回字典的 row_factory ==
[{'id': 2, 'company': '青木设计'}, {'id': 8, 'company': '云杉律所'}]
== JOIN 出现同名列 ==
keys(): ['id', 'id', 'amount']  dict(row): {'id': 1, 'amount': 1188}
起别名后: {'customer_id': 1, 'invoice_id': 3, 'amount': 1188}
```

`sqlite3.Row` 和自己写的 `dict_factory` 怎么选?`Row` 是标准库的 C 实现,省内存,支持按位置和按名字两种取法,类型检查器认得它;`dict_factory` 直接得到字典,但每行多一次推导式。我的习惯是用 `Row`,需要转 JSON 时再 `dict(row)`。

## 第 7 步:`@contextmanager`,把「开、提交或回滚、关」封进一个函数

现在零件齐了:连接要建好就开外键、设 `row_factory`;用完要按成功或失败决定 `commit` 还是 `rollback`;最后一定要 `close`。每次写一遍太容易漏。把它封进一个函数,做成 `with db() as conn:` 能用的样子。新建 `part01/db.py`:

```python
# agent-zero-lab/part01/db.py
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(__file__).parent / "sql" / "practice.db"


@contextmanager
def db(path: Path = DB_PATH, read_only: bool = False) -> Iterator[sqlite3.Connection]:
    """开连接 → 交给 with 块用 → 成功就 commit,出错就 rollback → 无论如何都 close。"""
    if read_only:
        conn = sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)
    else:
        conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
```

<div class="line-notes">

- `from collections.abc import Iterator` 类型标注用,下面标这个函数的返回类型。
- `from contextlib import contextmanager` `contextlib` 是标准库里和 `with` 有关的工具箱。`contextmanager` 能把「一个只 `yield` 一次的函数」变成 `with` 能用的东西。
- `@contextmanager` 一个**装饰器**(Day 96 才系统学):写在函数前面,把下面这个函数包一层再交出去。今天你只要知道它的作用:被它装饰的函数,可以放在 `with ... as ...:` 里用。
- `def db(path: Path = DB_PATH, read_only: bool = False) -> Iterator[sqlite3.Connection]:` 两个参数都有默认值。返回类型写成「产出连接的迭代器」,因为里面有 `yield`,这是 `@contextmanager` 函数的固定标注法。
- `"""开连接 → 交给` 文档字符串,说明了这个函数从头到尾发生的事。
- `if read_only:` 和 Day 92 的 `connect()` 一样,支持只读。
- `conn.row_factory = sqlite3.Row` 取出来的行带列名。
- `conn.execute("PRAGMA foreign_keys = ON")` 连接刚建好,第一件事就开外键。
- `try:` 下面是「中间的那段」。
- `yield conn` **整个函数最关键的一行**:到这里先暂停,把 `conn` 交给 `with` 块,`with ... as conn:` 的 `conn` 就是它。`with` 块里的代码执行完(或者抛了异常),再回到这一行下面继续。这和 Day 73 的 fixture 里 `yield` 一个意思:先交出去,用完再回来收拾。
- `conn.commit()` `with` 块**正常**结束,执行到这里,提交。
- `except Exception:` `with` 块里抛了异常,异常会从 `yield` 那一行「冒出来」,在这里被接住。
- `conn.rollback()` 撤销全部。
- `raise` 把异常原样再抛出去,不吞,调用方照样知道失败了。
- `finally:` 不论成功失败都执行(Day 36)。
- `conn.close()` 关连接。这是和 `with conn:` 的区别:`db()` 出了块,连接必关。

</div>

用法就是:`with db() as conn:` 后面的缩进块里,尽管写 SQL,不用管提交和关闭。用它重写付款逻辑,并把 Day 91 的几种失败逐个跑一遍。先写业务函数 `part01/pay_service.py`,它**只管三步付款,不管提交**,提交是外面 `with db()` 的事:

```python
# agent-zero-lab/part01/pay_service.py
import sqlite3


class PayError(Exception):
    """业务上能说清楚的付款失败:发票不存在、已付、没账户、余额不足。"""


def pay_invoice(conn: sqlite3.Connection, invoice_id: int, paid_at: str = "2026-10-23") -> dict:
    """用客户的预付余额付一张发票。三步都在调用方给的同一个连接里,由外面的 with db() 负责提交或回滚。"""
    inv = conn.execute(
        "SELECT id, customer_id, amount, status FROM invoices WHERE id = ?", (invoice_id,)
    ).fetchone()
    if inv is None:
        raise PayError(f"没有 {invoice_id} 号发票")
    if inv["status"] != "unpaid":
        raise PayError(f"{invoice_id} 号发票状态是 {inv['status']},只能付 unpaid 的")

    try:
        cur = conn.execute(
            "UPDATE accounts SET balance = balance - ? WHERE customer_id = ?",
            (inv["amount"], inv["customer_id"]),
        )
    except sqlite3.IntegrityError as e:
        raise PayError("余额不足") from e
    if cur.rowcount == 0:
        raise PayError(f"客户 {inv['customer_id']} 没有预付账户")

    try:
        conn.execute(
            "INSERT INTO payments (invoice_id, amount, paid_at) VALUES (?, ?, ?)",
            (invoice_id, inv["amount"], paid_at),
        )
    except sqlite3.IntegrityError as e:
        raise PayError(f"{invoice_id} 号发票已经有付款记录") from e
    conn.execute("UPDATE invoices SET status = 'paid' WHERE id = ?", (invoice_id,))

    balance = conn.execute(
        "SELECT balance FROM accounts WHERE customer_id = ?", (inv["customer_id"],)
    ).fetchone()["balance"]
    return {"invoice_id": invoice_id, "amount": inv["amount"], "balance": balance}
```

<div class="line-notes">

- `class PayError(Exception):` 自定义异常(Day 36):业务上能说清楚的失败都用它,调用方可以只接 `PayError` 而不是笼统地接所有异常。
- `def pay_invoice(conn: sqlite3.Connection, invoice_id: int, paid_at: str = "2026-10-23") -> dict:` 参数里收的是一个已经开好的连接,说明「事务由调用方管」。
- `inv = conn.execute(` 先从**数据库**里读发票的金额、归属客户和状态,不信调用方传来的金额。因为 `db()` 设了 `Row`,`inv` 可以按名字取。
- `if inv is None:` 发票不存在,抛 `PayError`。注意要先判断 `None`,再用 `inv[...]`。
- `if inv["status"] != "unpaid":` 只有未付的才能付。这是业务上的第一道检查,下面有数据库约束做第二道。
- `cur = conn.execute(` 第 1 步扣款,金额和客户都来自刚才读出的发票。
- `except sqlite3.IntegrityError as e:` 余额不够时,`pay.sql` 里 `CHECK (balance >= 0)` 会拒绝这次 `UPDATE`,抛 `IntegrityError`。我们**靠数据库约束来判断余额够不够**,而不是自己先查余额再比较(那样两步之间别人可能改了余额,第 91 课的丢失更新)。
- `raise PayError("余额不足") from e` 把底层的数据库错误翻译成业务能懂的话;`from e` 把原始错误挂在 `__cause__` 上,排查时还能看到。
- `if cur.rowcount == 0:` 第 3 步学的:改了 0 行,说明这个客户没有预付账户,不能装作成功。
- `"INSERT INTO payments (invoice_id, amount, paid_at) VALUES (?, ?, ?)",` 第 2 步记付款。`payments.invoice_id` 有 `UNIQUE`,同一张发票第二次来会被拒绝。
- `raise PayError(f"{invoice_id} 号发票已经有付款记录") from e` 同样翻译。
- `conn.execute("UPDATE invoices SET status = 'paid' WHERE id = ?", (invoice_id,))` 第 3 步改状态。
- `).fetchone()["balance"]` 付完再读一次余额,按名字取出放进返回值。
- `return {"invoice_id": invoice_id, "amount": inv["amount"], "balance": balance}` 返回一个小字典,Agent 工具可以把它转成 JSON 给模型。

</div>

再写 `part01/pay_demo.py` 把六种情形跑一遍:

```python
# agent-zero-lab/part01/pay_demo.py
import sqlite3

from part01.db import db
from part01.pay_service import PayError, pay_invoice
from part01.pay_setup import PAY_DB, fresh_db


def show(title: str) -> None:
    with db(PAY_DB, read_only=True) as conn:
        bal1 = conn.execute("SELECT balance FROM accounts WHERE customer_id = 1").fetchone()[0]
        n = conn.execute("SELECT count(*) FROM payments").fetchone()[0]
        st = conn.execute("SELECT status FROM invoices WHERE id = 3").fetchone()[0]
    print(f"{title}:余额 {bal1},付款记录 {n} 条,3 号发票 {st}")


fresh_db()
show("开始")

print("-- 1. 正常付款 --")
with db(PAY_DB) as conn:
    print(pay_invoice(conn, 3))
show("付完")

print("-- 2. 再付一次 --")
try:
    with db(PAY_DB) as conn:
        pay_invoice(conn, 3)
except PayError as e:
    print("PayError:", e)

print("-- 3. 没有账户的客户(7 号发票是 3 号客户的) --")
try:
    with db(PAY_DB) as conn:
        pay_invoice(conn, 7)
except PayError as e:
    print("PayError:", e)

print("-- 4. 数据不一致:有付款记录,发票却还是 unpaid --")
fresh_db()
with db(PAY_DB) as conn:
    conn.execute("INSERT INTO payments (invoice_id, amount, paid_at) VALUES (3, 1188, '2026-10-01')")
show("造好不一致数据后")
try:
    with db(PAY_DB) as conn:
        pay_invoice(conn, 3)
except PayError as e:
    print("PayError:", e, "| 原始错误:", e.__cause__)
show("失败之后(第 1 步扣款应该被撤回)")

print("-- 5. 余额不足 --")
fresh_db()
with db(PAY_DB) as conn:
    conn.execute("UPDATE accounts SET balance = 1000 WHERE customer_id = 1")
try:
    with db(PAY_DB) as conn:
        pay_invoice(conn, 3)
except PayError as e:
    print("PayError:", e, "| 原始错误:", e.__cause__)
show("失败之后")

print("-- 6. with 块之后连接已关闭 --")
with db(PAY_DB) as conn:
    pass
try:
    conn.execute("SELECT 1")
except sqlite3.ProgrammingError as e:
    print(type(e).__name__, e)
```

<div class="line-notes">

- `def show(title: str) -> None:` 用**只读**连接把三个状态打印出来:余额、付款记录数、3 号发票状态。检查结果用只读,保证检查本身不改东西。
- `with db(PAY_DB, read_only=True) as conn:` 出了 `with` 块,连接自动关掉。
- `fresh_db()` 重建库,初始状态:余额 3000,0 条付款,3 号发票 unpaid。
- `with db(PAY_DB) as conn:` 第 1 种情形:正常付款。块里调 `pay_invoice`,正常结束,`db()` 自动提交。实测余额 1812、1 条付款、发票 paid。
- `except PayError as e:` 第 2 种:再付一次。业务检查先拦住,抛 `PayError`,`db()` 回滚(什么都没改),异常传出来,被这里接住。
- `pay_invoice(conn, 7)` 第 3 种:7 号发票属于 3 号客户,他没有预付账户,`rowcount == 0` 触发 `PayError`。
- `INSERT INTO payments (invoice_id, amount, paid_at) VALUES (3, 1188, '2026-10-01')` 第 4 种:人为造一份**不一致**的数据:有付款记录,发票状态却还是 `unpaid`(模拟以前某次事故留下的残局)。这一步放在 `with db()` 里,块正常结束,所以会提交。
- `print("PayError:", e, "| 原始错误:", e.__cause__)` 这次业务检查拦不住(状态是 `unpaid`),第 1 步扣款**执行成功**,第 2 步才撞上 `UNIQUE`。实测原始错误是 `UNIQUE constraint failed: payments.invoice_id`。
- `show("失败之后(第 1 步扣款应该被撤回)")` 关键的检查:实测余额还是 3000,说明被第 2 步的失败拖着,第 1 步也回滚了。这就是事务的价值。
- `UPDATE accounts SET balance = 1000 WHERE customer_id = 1` 第 5 种:把余额改成 1000,小于发票的 1188。
- `print("PayError:", e, "| 原始错误:"` 实测输出 `PayError: 余额不足 | 原始错误: CHECK constraint failed: balance >= 0`:数据库的 `CHECK` 拒绝了第 1 步,被翻译成「余额不足」。
- `pass` 第 6 种,写成 `with db(PAY_DB) as conn: pass`:什么都不做的 `with` 块,走完以后连接已经被 `db()` 关了。
- `conn.execute("SELECT 1")` 在块外还拿着 `conn` 去用,实测 `ProgrammingError Cannot operate on a closed database.`。

</div>

```bash
uv run python -m part01.pay_demo
```

```text
开始:余额 3000,付款记录 0 条,3 号发票 unpaid
-- 1. 正常付款 --
{'invoice_id': 3, 'amount': 1188, 'balance': 1812}
付完:余额 1812,付款记录 1 条,3 号发票 paid
-- 2. 再付一次 --
PayError: 3 号发票状态是 paid,只能付 unpaid 的
-- 3. 没有账户的客户(7 号发票是 3 号客户的) --
PayError: 客户 3 没有预付账户
-- 4. 数据不一致:有付款记录,发票却还是 unpaid --
造好不一致数据后:余额 3000,付款记录 1 条,3 号发票 unpaid
PayError: 3 号发票已经有付款记录 | 原始错误: UNIQUE constraint failed: payments.invoice_id
失败之后(第 1 步扣款应该被撤回):余额 3000,付款记录 1 条,3 号发票 unpaid
-- 5. 余额不足 --
PayError: 余额不足 | 原始错误: CHECK constraint failed: balance >= 0
失败之后:余额 1000,付款记录 0 条,3 号发票 unpaid
-- 6. with 块之后连接已关闭 --
ProgrammingError Cannot operate on a closed database.
```

第 4 种情形最值得停下来读:`show` 在失败之后打出「余额 3000,付款记录 1 条,3 号发票 unpaid」,和造好数据时一模一样。付款函数里第 1 步的扣款确实执行成功了,可是整个 `with db()` 因为第 2 步抛出的异常而回滚,扣款随之撤回。

最后给 `db()` 配上测试,固定它的四个行为。新建 `tests/test_db.py`:

```python
# agent-zero-lab/tests/test_db.py
import sqlite3
from pathlib import Path

import pytest

from part01.db import db


@pytest.fixture
def path(tmp_path: Path) -> Path:
    p = tmp_path / "t.db"
    raw = sqlite3.connect(p)
    raw.execute("CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance INTEGER NOT NULL CHECK (balance >= 0))")
    raw.execute("INSERT INTO accounts VALUES (1, 100)")
    raw.commit()
    raw.close()
    return p


def read_balance(p: Path) -> int:
    check = sqlite3.connect(p)
    value = check.execute("SELECT balance FROM accounts WHERE id = 1").fetchone()[0]
    check.close()
    return value


def test_commit_on_success(path: Path):
    with db(path) as conn:
        conn.execute("UPDATE accounts SET balance = balance - 30 WHERE id = 1")
    assert read_balance(path) == 70


def test_rollback_on_error_and_error_still_raised(path: Path):
    with pytest.raises(RuntimeError):
        with db(path) as conn:
            conn.execute("UPDATE accounts SET balance = balance - 30 WHERE id = 1")
            raise RuntimeError("中途出错")
    assert read_balance(path) == 100


def test_constraint_error_rolls_back_earlier_steps(path: Path):
    with pytest.raises(sqlite3.IntegrityError):
        with db(path) as conn:
            conn.execute("UPDATE accounts SET balance = balance - 30 WHERE id = 1")
            conn.execute("UPDATE accounts SET balance = balance - 200 WHERE id = 1")
    assert read_balance(path) == 100


def test_connection_closed_after_with(path: Path):
    with db(path) as conn:
        pass
    with pytest.raises(sqlite3.ProgrammingError):
        conn.execute("SELECT 1")


def test_rows_have_names(path: Path):
    with db(path) as conn:
        row = conn.execute("SELECT id, balance FROM accounts").fetchone()
    assert dict(row) == {"id": 1, "balance": 100}
```

<div class="line-notes">

- `@pytest.fixture` 一个 fixture(Day 73),给每个用例准备一个数据库文件。
- `def path(tmp_path: Path) -> Path:` `tmp_path` 是 pytest 的临时目录。fixture 起名叫 `path`,用例里写参数 `path` 就能拿到它。
- `raw.execute("CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance INTEGER NOT NULL CHECK (balance >= 0))")` 建一个最简单的账户表,带 `CHECK`。
- `raw.commit()` 建表、插数据之后手动提交一次,这样别的连接才看得到。
- `def read_balance(p: Path) -> int:` 测试用的小工具:**另开一个全新的连接**读余额,不借用被测的连接,避免「自己看自己」。
- `def test_commit_on_success(path: Path):` 正常结束的 `with db()`,余额从 100 变成 70,说明提交了。
- `with pytest.raises(RuntimeError):` 第二个用例:块里抛 `RuntimeError`,断言「这个异常一定会传出来」,证明 `db()` 没有吞掉它。
- `assert read_balance(path) == 100` 异常之后余额没变,说明回滚了。
- `def test_constraint_error_rolls_back_earlier_steps(path: Path):` 第三个用例:先扣 30(成功),再扣 200(违反 `CHECK`,抛 `IntegrityError`);断言最终还是 100,第一次扣款也被撤回。
- `def test_connection_closed_after_with(path: Path):` 第四个:`with` 块结束后再用连接会 `ProgrammingError`,说明关了。
- `def test_rows_have_names(path: Path):` 第五个:`row_factory` 生效,`dict(row)` 得到 `{"id": 1, "balance": 100}`。

</div>

```bash
uv run pytest -q
```

```text
..........                                                               [100%]
10 passed in 0.15s
```

10 个是今天的 5 个加 Day 92 的 5 个。把 `db()` 的 `rollback` 那两行删掉再跑,第 2、3 个用例会变红,可以自己试一试验证测试真的有用。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="db 函数的流程图:with 开始前先连接、设 row_factory、开外键,然后 yield 把连接交给 with 块;块正常结束就 commit,抛异常就 rollback 并重新抛出,最后无论如何 close">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="20" width="190" height="60" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="115" y="42" fill="var(--ink)" text-anchor="middle">① yield 之前</text>
<text x="115" y="62" fill="var(--ink-soft)" text-anchor="middle" font-size="11">connect · Row · 外键 ON</text>
<rect x="225" y="20" width="190" height="60" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="42" fill="var(--ink)" text-anchor="middle">② yield conn</text>
<text x="320" y="62" fill="var(--ink-soft)" text-anchor="middle" font-size="11">with 块里的代码在这里跑</text>
<line x1="210" y1="50" x2="225" y2="50" stroke="var(--rule)"/>
<rect x="430" y="20" width="190" height="60" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="525" y="42" fill="var(--ink)" text-anchor="middle">with 块里的代码</text>
<text x="525" y="62" fill="var(--ink-soft)" text-anchor="middle" font-size="11">pay_invoice(conn, 3)</text>
<line x1="415" y1="50" x2="430" y2="50" stroke="var(--rule)"/>
<line x1="525" y1="80" x2="525" y2="120" stroke="var(--rule)"/>
<text x="535" y="104" fill="var(--ink-faint)" font-size="11">块结束</text>
<rect x="330" y="120" width="140" height="56" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="400" y="142" fill="var(--ink)" text-anchor="middle">没出错</text>
<text x="400" y="162" fill="var(--ink-soft)" text-anchor="middle" font-size="11">conn.commit()</text>
<rect x="490" y="120" width="130" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="555" y="142" fill="var(--ink)" text-anchor="middle">抛了异常</text>
<text x="555" y="162" fill="var(--ink-soft)" text-anchor="middle" font-size="11">rollback + raise</text>
<line x1="525" y1="120" x2="400" y2="120" stroke="var(--rule)"/>
<line x1="525" y1="120" x2="555" y2="120" stroke="var(--rule)"/>
<rect x="330" y="210" width="290" height="46" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="475" y="230" fill="var(--ink)" text-anchor="middle">③ finally:conn.close()</text>
<text x="475" y="246" fill="var(--ink-soft)" text-anchor="middle" font-size="11">无论成功失败,连接都关</text>
<line x1="400" y1="176" x2="400" y2="210" stroke="var(--rule)"/>
<line x1="555" y1="176" x2="555" y2="210" stroke="var(--rule)"/>
<text x="20" y="130" fill="var(--ink)">三个时机,三个动作</text>
<text x="20" y="152" fill="var(--ink-soft)" font-size="11">连上:准备好(外键、Row)</text>
<text x="20" y="170" fill="var(--ink-soft)" font-size="11">结束:提交或回滚</text>
<text x="20" y="188" fill="var(--ink-soft)" font-size="11">离开:关连接</text>
<text x="20" y="230" fill="var(--ink-faint)" font-size="11">这就是 with 的全部意思,Day 98 再看它的原理</text>
</g>
</svg>
<figcaption>db() 的流程。yield 是分界线:前面是进 with 之前做的准备,后面是出 with 时做的收尾,收尾又分「提交」和「回滚」两条路,最后都汇到关闭连接。</figcaption>
</figure>

## 动手练习

每道题开始前,按需要重建库:涉及付款和账户的先 `fresh_db()`(下面的脚本里已经带了);涉及 `practice.db` 的,在 `part01/sql` 里 `rm -f practice.db` 再重跑 `customers.sql` 和 `invoices.sql`。用 `uv run python -m part01.文件名` 运行。

**练习 1:转账。** 写 `transfer(conn, from_id, to_id, amount)`,把一个客户账户里的钱转到另一个账户。要求:金额必须是正数;余额不足、转出账户不存在、转入账户不存在,都抛自己的 `TransferError`;外层用 `with db(PAY_DB)`,让失败的转账一分钱都不动。依次试 `(1, 2, 1000)`、`(2, 1, 5000)`、`(1, 99, 200)`、`(1, 2, 0)`,每次打印余额。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex93_1_transfer.py
import sqlite3

from part01.db import db
from part01.pay_setup import PAY_DB, fresh_db


class TransferError(Exception):
    pass


def transfer(conn: sqlite3.Connection, from_id: int, to_id: int, amount: int) -> None:
    """从 from_id 的账户转 amount 到 to_id 的账户。出错就抛 TransferError,由外面的 with db() 回滚。"""
    if amount <= 0:
        raise TransferError("金额必须是正数")
    try:
        cur = conn.execute(
            "UPDATE accounts SET balance = balance - ? WHERE customer_id = ?", (amount, from_id)
        )
    except sqlite3.IntegrityError as e:
        raise TransferError("余额不足") from e
    if cur.rowcount == 0:
        raise TransferError(f"转出账户 {from_id} 不存在")
    cur = conn.execute(
        "UPDATE accounts SET balance = balance + ? WHERE customer_id = ?", (amount, to_id)
    )
    if cur.rowcount == 0:
        raise TransferError(f"转入账户 {to_id} 不存在")


def balances() -> dict[int, int]:
    with db(PAY_DB, read_only=True) as conn:
        return {r["customer_id"]: r["balance"] for r in conn.execute("SELECT * FROM accounts ORDER BY customer_id")}


fresh_db()
print("开始:", balances())
for from_id, to_id, amount in [(1, 2, 1000), (2, 1, 5000), (1, 99, 200), (1, 2, 0)]:
    try:
        with db(PAY_DB) as conn:
            transfer(conn, from_id, to_id, amount)
        print(f"转 {from_id}->{to_id} {amount}: 成功", balances())
    except TransferError as e:
        print(f"转 {from_id}->{to_id} {amount}: 失败({e})", balances())
```

<div class="line-notes">

- `class TransferError(Exception):` 自己的业务异常。
- `if amount <= 0:` 先检查金额,不进数据库。
- `cur = conn.execute(` 先扣转出账户。写成 `balance = balance - ?`,让数据库自己算。
- `except sqlite3.IntegrityError as e:` 余额不够触发 `CHECK (balance >= 0)`,翻译成「余额不足」。
- `if cur.rowcount == 0:` 转出账户不存在,扣了 0 行。
- `"UPDATE accounts SET balance = balance + ? WHERE customer_id = ?", (amount, to_id)` 再给转入账户加钱。**顺序很关键**:这时转出账户已经少了钱。
- `raise TransferError(f"转入账户 {to_id} 不存在")` 转入账户不存在,这时第一步的扣款已经执行了,所以只有回滚才能还原。
- `return {r["customer_id"]: r["balance"] for r in conn.execute("SELECT * FROM accounts ORDER BY customer_id")}` 字典推导式,把每一行转成「账户编号:余额」,`Row` 让这里能按名字取。
- `for from_id, to_id, amount in [(1, 2, 1000), (2, 1, 5000), (1, 99, 200), (1, 2, 0)]:` 四组测试数据,每组解包成三个变量(Day 22)。
- `with db(PAY_DB) as conn:` 每次转账一个新的 `with`,成功提交,失败回滚。
- `except TransferError as e:` 失败后打印原因和**当时的余额**。实测四次里只有第一次成功(1 号 2000,2 号 1500);后三次失败后余额都没变,尤其第三次,1 号的钱已经被扣了 200,转入 99 失败后又被还回来了。

</div>

```text
开始: {1: 3000, 2: 500}
转 1->2 1000: 成功 {1: 2000, 2: 1500}
转 2->1 5000: 失败(余额不足) {1: 2000, 2: 1500}
转 1->99 200: 失败(转入账户 99 不存在) {1: 2000, 2: 1500}
转 1->2 0: 失败(金额必须是正数) {1: 2000, 2: 1500}
```

</details>

**练习 2:改套餐,并且不能假装成功。** 写 `change_plan(conn, customer_id, new_plan)`:套餐必须是三种之一;客户不存在时,要抛 `LookupError`(用影响行数判断)。再试一次绕过白名单,直接对 `pay_demo.db` 里带 `CHECK` 的客户表写 `'旗舰版'`,看数据库那一层怎么说。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex93_2_change_plan.py
import sqlite3

from part01.db import db
from part01.pay_setup import PAY_DB, fresh_db

PLANS = ("基础版", "专业版", "企业版")


def change_plan(conn: sqlite3.Connection, customer_id: int, new_plan: str) -> str:
    """改套餐。返回人话结果,客户不存在时抛 LookupError。"""
    if new_plan not in PLANS:
        raise ValueError(f"套餐只能是 {PLANS},收到 {new_plan!r}")
    cur = conn.execute("UPDATE customers SET plan = ? WHERE id = ?", (new_plan, customer_id))
    if cur.rowcount == 0:
        raise LookupError(f"没有 {customer_id} 号客户,什么都没改")
    return f"{customer_id} 号客户已改成{new_plan}"


fresh_db()
for cid, plan in [(2, "专业版"), (99, "企业版"), (2, "旗舰版")]:
    try:
        with db(PAY_DB) as conn:
            print(change_plan(conn, cid, plan))
    except (LookupError, ValueError) as e:
        print(type(e).__name__ + ":", e)

print("--- 没有白名单,只靠数据库的 CHECK ---")
try:
    with db(PAY_DB) as conn:
        conn.execute("UPDATE customers SET plan = '旗舰版' WHERE id = 2")
except sqlite3.IntegrityError as e:
    print(type(e).__name__ + ":", e)
with db(PAY_DB, read_only=True) as conn:
    print("2 号客户现在的套餐:", conn.execute("SELECT plan FROM customers WHERE id = 2").fetchone()["plan"])
```

<div class="line-notes">

- `PLANS = ("基础版", "专业版", "企业版")` 合法套餐,和 Day 91 `CHECK` 一致。
- `if new_plan not in PLANS:` 第一层:程序里先挡,错误信息写清楚合法值,模型看了能改。
- `cur = conn.execute("UPDATE customers SET plan = ? WHERE id = ?", (new_plan, customer_id))` 套餐和编号都走 `?`。
- `if cur.rowcount == 0:` 影响行数是 0,说明没有这个客户,抛 `LookupError`,不让调用方误以为改成功了。
- `for cid, plan in [(2, "专业版"), (99, "企业版"), (2, "旗舰版")]:` 三种情形:正常、客户不存在、套餐不合法。
- `except (LookupError, ValueError) as e:` 一个 `except` 同时接两种异常,放进括号里的元组。
- `conn.execute("UPDATE customers SET plan = '旗舰版' WHERE id = 2")` 绕过程序里的白名单,直接写非法值。这个库是 `strict.sql` 建的,`customers.plan` 有 `CHECK`,被拒绝,实测 `IntegrityError: CHECK constraint failed: plan IN ('基础版', '专业版', '企业版')`。
- `with db(PAY_DB, read_only=True) as conn:` 用只读连接核对,2 号客户的套餐还是「专业版」(第一个用例改成功的结果),非法值没写进去。

</div>

```text
2 号客户已改成专业版
LookupError: 没有 99 号客户,什么都没改
ValueError: 套餐只能是 ('基础版', '专业版', '企业版'),收到 '旗舰版'
--- 没有白名单,只靠数据库的 CHECK ---
IntegrityError: CHECK constraint failed: plan IN ('基础版', '专业版', '企业版')
2 号客户现在的套餐: 专业版
```

</details>

**练习 3:Agent 工具的返回值。** 写 `get_customer_json(customer_id)`:查客户的编号、公司、邮箱、城市,再加上这个客户的发票张数和金额合计(客户没有发票时是 0 张 0 元),返回 JSON 字符串;客户不存在时返回 `{"error": "没有 N 号客户"}`,不抛异常。用只读连接,列要起不重名的别名。试 1、6、10、99 号。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex93_3_customer_json.py
import json

from part01.db import DB_PATH, db


def get_customer_json(customer_id: int) -> str:
    """Agent 工具:返回一个客户加发票汇总的 JSON 字符串。找不到时返回 error 字段,不抛异常。"""
    sql = """
        SELECT c.id AS customer_id, c.company, c.email, c.city,
               count(i.id) AS invoice_count,
               coalesce(sum(i.amount), 0) AS invoice_total
        FROM customers c
        LEFT JOIN invoices i ON i.customer_id = c.id
        WHERE c.id = ?
        GROUP BY c.id
    """
    with db(DB_PATH, read_only=True) as conn:
        row = conn.execute(sql, (customer_id,)).fetchone()
    if row is None:
        return json.dumps({"error": f"没有 {customer_id} 号客户"}, ensure_ascii=False)
    return json.dumps(dict(row), ensure_ascii=False)


for cid in (1, 6, 10, 99):
    print(get_customer_json(cid))
```

<div class="line-notes">

- `sql = """` 多行 SQL 放在三引号里,好读。这是一个**写死的**字符串,没有拼接任何变量。
- `SELECT c.id AS customer_id, c.company, c.email, c.city,` 客户的列,`c.id` 起别名 `customer_id`,避免和后面可能出现的 `id` 重名。
- `count(i.id) AS invoice_count,` 数发票张数。数的是 `i.id` 而不是 `*`,没有发票的客户这里是 0 而不是 1(Day 88 的坑)。
- `coalesce(sum(i.amount), 0) AS invoice_total` 没有发票时 `sum` 是 `NULL`,`coalesce` 把它换成 0。
- `LEFT JOIN invoices i ON i.customer_id = c.id` 左连接,保住没有发票的客户。
- `WHERE c.id = ?` 编号走占位符。
- `with db(DB_PATH, read_only=True) as conn:` 只读连接,查完就关。
- `row = conn.execute(sql, (customer_id,)).fetchone()` 一个客户一行。
- `if row is None:` 查不到时是 `None`。
- `json.dumps({"error": f"没有 {customer_id} 号客户"}, ensure_ascii=False)` 返回一个带 `error` 字段的 JSON,让模型读得懂,而不是抛异常让 Agent 循环崩掉。
- `return json.dumps(dict(row), ensure_ascii=False)` 正常情况:`Row` 转字典再转 JSON。`email` 是 `None` 的客户(此处没出现)会变成 JSON 的 `null`;6 号客户的 `city` 是 `NULL`,实测输出里就是 `"city": null`。

</div>

```text
{"customer_id": 1, "company": "星河餐饮", "email": "wangwei@xinghe.example", "city": "杭州", "invoice_count": 3, "invoice_total": 3564}
{"customer_id": 6, "company": "禾丰农业", "email": "yangyong@hefeng.example", "city": null, "invoice_count": 0, "invoice_total": 0}
{"customer_id": 10, "company": "小满花店", "email": "zhouxia@xiaoman.example", "city": "杭州", "invoice_count": 0, "invoice_total": 0}
{"error": "没有 99 号客户"}
```

</details>

**练习 4:批量插入。** 把 5000 条日志插进一张表,比较「`for` 循环里 `execute`」和「`executemany`」两种写法的耗时(都在同一个事务里,只提交一次),并说出为什么批量插入前面必须有一个外层事务。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex93_4_executemany.py
import time
from pathlib import Path

from part01.db import db

TMP_DB = Path(__file__).parent / "sql" / "em.db"
N = 5000
rows = [(f"第 {i} 条",) for i in range(N)]

TMP_DB.unlink(missing_ok=True)
with db(TMP_DB) as conn:
    conn.execute("CREATE TABLE logs (id INTEGER PRIMARY KEY, msg TEXT NOT NULL)")

t0 = time.perf_counter()
with db(TMP_DB) as conn:
    for r in rows:
        conn.execute("INSERT INTO logs (msg) VALUES (?)", r)
t_loop = time.perf_counter() - t0

with db(TMP_DB) as conn:
    conn.execute("DELETE FROM logs")

t0 = time.perf_counter()
with db(TMP_DB) as conn:
    conn.executemany("INSERT INTO logs (msg) VALUES (?)", rows)
t_many = time.perf_counter() - t0

with db(TMP_DB, read_only=True) as conn:
    print("行数:", conn.execute("SELECT count(*) FROM logs").fetchone()[0])
print(f"for 循环 execute:{t_loop * 1000:.1f} 毫秒;executemany:{t_many * 1000:.1f} 毫秒;(都只 commit 一次)")
TMP_DB.unlink()
```

<div class="line-notes">

- `N = 5000` 一次插 5000 条。
- `rows = [(f"第 {i} 条",) for i in range(N)]` 列表推导式(Day 23)准备数据,每个元素是一个**只有一个值的元组**,所以逗号不能少。
- `TMP_DB.unlink(missing_ok=True)` 清掉可能残留的库。
- `with db(TMP_DB) as conn:` 建表。
- `for r in rows:` 第一种(循环体是 `conn.execute("INSERT INTO logs (msg) VALUES (?)", r)`):Python 循环里一条一条执行。整个循环在同一个 `with db()` 里,所以只提交一次。
- `t_loop = time.perf_counter() - t0` 耗时包含了开连接和最后的提交。
- `conn.execute("DELETE FROM logs")` 清空表,让第二种也从空表开始。
- `conn.executemany("INSERT INTO logs (msg) VALUES (?)", rows)` 第二种:`executemany` 把「同一条 SQL + 一批参数」一次交给 SQLite,省掉 5000 次 Python 到 SQLite 的往返。
- `print("行数:"` 核对两种写法最终都是 5000 行。
- `TMP_DB.unlink()` 实验完删掉临时库。

</div>

```text
行数: 5000
for 循环 execute:9.1 毫秒;executemany:4.7 毫秒;(都只 commit 一次)
```

三次实测(各跑一次的结果略有出入,量级一样)里,`executemany` 都比循环快,差距大概在一半左右;它们都比第 4 步「每条一个 commit」快两个数量级。真正决定快慢的是**提交的次数**,所以批量写入一定要放进一个外层事务;`executemany` 是在这个基础上的小优化。Day 94 造发票数据时会用到 `executemany`。

</details>

**练习 5:丢失更新,在 Python 里重现。** 两个连接都先读余额、在 Python 里算 `余额 - 100`、再写回去,最后余额是多少?换成让数据库自己算(`balance = balance - 100`)呢?如果非要「先读后写」,怎么保证读到的是别人写完之后的值?(提示:`BEGIN IMMEDIATE`,Day 91 讲过。)

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex93_5_lost_update.py
import sqlite3
from pathlib import Path

from part01.pay_setup import PAY_DB, fresh_db


def balance_of(path: Path = PAY_DB) -> int:
    c = sqlite3.connect(path)
    value = c.execute("SELECT balance FROM accounts WHERE customer_id = 1").fetchone()[0]
    c.close()
    return value


print("== A. 先读、算、再写回(两个人交错) ==")
fresh_db()
a = sqlite3.connect(PAY_DB)
b = sqlite3.connect(PAY_DB)
bal_a = a.execute("SELECT balance FROM accounts WHERE customer_id = 1").fetchone()[0]
bal_b = b.execute("SELECT balance FROM accounts WHERE customer_id = 1").fetchone()[0]
print("a 读到", bal_a, " b 读到", bal_b)
a.execute("UPDATE accounts SET balance = ? WHERE customer_id = 1", (bal_a - 100,))
a.commit()
b.execute("UPDATE accounts SET balance = ? WHERE customer_id = 1", (bal_b - 100,))
b.commit()
print("两人各扣 100,最后余额:", balance_of(), "(应该是 2800)")
a.close()
b.close()

print("== B. 让数据库自己算 ==")
fresh_db()
a = sqlite3.connect(PAY_DB)
b = sqlite3.connect(PAY_DB)
a.execute("UPDATE accounts SET balance = balance - 100 WHERE customer_id = 1")
a.commit()
b.execute("UPDATE accounts SET balance = balance - 100 WHERE customer_id = 1")
b.commit()
print("最后余额:", balance_of())
a.close()
b.close()

print("== C. 必须先读后写:BEGIN IMMEDIATE 把读也锁进事务 ==")
fresh_db()
a = sqlite3.connect(PAY_DB, timeout=0.3)
b = sqlite3.connect(PAY_DB, timeout=0.3)
a.execute("BEGIN IMMEDIATE")
bal_a = a.execute("SELECT balance FROM accounts WHERE customer_id = 1").fetchone()[0]
try:
    b.execute("BEGIN IMMEDIATE")
except sqlite3.OperationalError as e:
    print("b 想开写事务:", type(e).__name__, e, "-> 要等 a 结束再来")
a.execute("UPDATE accounts SET balance = ? WHERE customer_id = 1", (bal_a - 100,))
a.commit()
b.execute("BEGIN IMMEDIATE")
bal_b = b.execute("SELECT balance FROM accounts WHERE customer_id = 1").fetchone()[0]
print("b 这回读到", bal_b)
b.execute("UPDATE accounts SET balance = ? WHERE customer_id = 1", (bal_b - 100,))
b.commit()
print("最后余额:", balance_of())
a.close()
b.close()
```

<div class="line-notes">

- `def balance_of(path: Path = PAY_DB) -> int:` 另开一个连接读最终余额,读完就关。
- `a = sqlite3.connect(PAY_DB)` / `b = sqlite3.connect(PAY_DB)` A 段:两个连接模拟两个人。
- `bal_a = a.execute("SELECT balance FROM accounts WHERE customer_id = 1").fetchone()[0]` a 读到 3000。
- `bal_b = b.execute(` b **也**读到 3000,因为 a 还没写。
- `a.execute("UPDATE accounts SET balance = ? WHERE customer_id = 1", (bal_a - 100,))` a 把自己算出的 2900 写回去,然后 `commit()`。
- `b.execute("UPDATE accounts SET balance = ? WHERE customer_id = 1", (bal_b - 100,))` b 手里的 `bal_b` 是旧的 3000,算出 2900,写回去覆盖了 a 的结果。两人各扣了 100,实测最后只有 2900(应该是 2800)。这就是**丢失更新**。
- `a.execute("UPDATE accounts SET balance = balance - 100 WHERE customer_id = 1")` B 段:数据库在写的那一刻读当前值再减,两次叠加,实测 2800,对。
- `a = sqlite3.connect(PAY_DB, timeout=0.3)` C 段:缩短等待时间。
- `a.execute("BEGIN IMMEDIATE")` 手动写 `BEGIN IMMEDIATE`,**一开始就拿写锁**,而不是等到第一条 `UPDATE`。默认模式下这样手写 `BEGIN` 是允许的,sqlite3 看到事务已经开了,就不再自己开。
- `bal_a = a.execute("SELECT balance FROM accounts WHERE customer_id = 1").fetchone()[0]` 读余额。因为已经拿了写锁,在 a 结束前别人写不进来,读到的数字不会被偷偷改掉。
- `b.execute("BEGIN IMMEDIATE")` b 也想开写事务,a 没结束,等 0.3 秒后实测 `OperationalError database is locked`。
- `a.commit()` a 写完提交,锁释放。
- `bal_b = b.execute(` b 重试,这回读到 a 写完的 2900,再算再写,最后实测 2800。

</div>

```text
== A. 先读、算、再写回(两个人交错) ==
a 读到 3000  b 读到 3000
两人各扣 100,最后余额: 2900 (应该是 2800)
== B. 让数据库自己算 ==
最后余额: 2800
== C. 必须先读后写:BEGIN IMMEDIATE 把读也锁进事务 ==
b 想开写事务: OperationalError database is locked -> 要等 a 结束再来
b 这回读到 2900
最后余额: 2800
```

所以处理「先读后写」的两条路:能写成一条 `UPDATE ... SET x = x - ?` 就写成一条;必须先看了再决定的,用 `BEGIN IMMEDIATE` 把读也放进写锁里(Postgres 里对应 `SELECT ... FOR UPDATE`)。

</details>

验收标准:五道题都在自己终端里跑通;能不看文章写出一个「出错就回滚」的付款函数(`try/except` 或者 `with conn:` 都行);能解释 `with conn:` 和 `with db():` 在「关不关连接」上的区别;能用 `sqlite3.Row` 取出一行并转成 JSON;能说出为什么 v1 里「捕获错误后照样 commit」会多扣钱。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 隐式事务 | Python 在你执行第一条 `INSERT`/`UPDATE`/`DELETE`/`REPLACE` 时自动开的事务,不会自动提交 |
| `commit()` | 提交当前事务,改动写进文件,别的连接才能看到 |
| `rollback()` | 撤销当前事务里所有没提交的改动 |
| `conn.in_transaction` | 连接的属性,`True` 表示当前有一个没结束的事务 |
| `with conn:` | 块正常结束就 `commit()`,抛异常就 `rollback()`;**不关闭**连接,也不吞异常 |
| 上下文管理器 | 能放在 `with` 后面的对象,进入时做准备,离开时做收尾(原理 Day 98 讲) |
| `@contextmanager` | `contextlib` 里的装饰器,把一个只 `yield` 一次的函数变成上下文管理器;装饰器 Day 96 讲 |
| `yield` | 先把一个值交给调用方,等调用方用完再回来继续执行下面的代码;fixture 和 `db()` 里都是这个用法 |
| `cursor.rowcount` | 上一条修改语句影响了几行;`UPDATE` 找不到行时是 0,不报错;查询语句是 -1 |
| `cursor.lastrowid` | 刚插入那一行的主键 |
| `row_factory` | 连接上的设置,决定每一行用什么类型返回,默认是元组 |
| `sqlite3.Row` | 标准库自带的行类型,支持按名字和按位置取值,`.keys()` 查列名,`dict(row)` 转字典 |
| 丢失更新(lost update) | 两个人先读后写,后写的覆盖了先写的,一次修改丢了 |
| `database is locked` | 别的连接正在写,你等了 `timeout`(默认 5 秒)还拿不到写锁 |
| `timeout` | `connect` 的参数,碰到别人正在写时最多等几秒 |
| `BEGIN IMMEDIATE` | 一开始就拿写锁的事务,用来保证「先读后写」中间没人插队 |
| `executemany` | 同一条 SQL 配一批参数,一次执行 |
| `autocommit` 参数 | Python 3.12 新增,控制事务模式;默认 `LEGACY_TRANSACTION_CONTROL`,保留老行为 |
| PEP 249 | Python 数据库接口的统一规范,`sqlite3`、`psycopg` 这些模块都按它写 |
| 业务异常 | 自己定义的、能用人话说清楚的异常类,比如 `PayError`,和数据库抛出的原始错误区分开 |

## 常见误区

**忘了 `commit()`,以为数据存下来了。** 实测 `UPDATE` 之后别的连接看到的还是旧余额,不提交就 `close()`,改动整个消失,而且不报错。写入之后要么 `commit()`,要么放进 `with conn:`,要么放进 `with db():`。

**捕获了异常却照样提交。** v1 的写法实测把余额从 1812 扣到了 624,付款记录只有 1 条。`except` 里要么 `rollback()` 再 `raise`,要么干脆不接,让 `with` 去处理。

**以为 `with conn:` 会关连接。** 实测块结束后 `conn.execute("SELECT 1")` 还能用。它只管提交和回滚。要关连接,自己 `close()`,或者用 `db()`。

**以为 `with conn:` 会吞掉异常。** 实测块里的 `RuntimeError` 照常传了出去,只是事务被回滚了。吞不吞异常由你自己的 `try/except` 决定。

**`UPDATE` 找不到行,当成成功。** 影响行数 0 不报错。实测 `customer_id = 99` 的 `UPDATE` `rowcount` 是 0。修改类函数要检查它。

**每条语句都 `commit()`。** 500 条,每条提交,比插完提交一次慢两个数量级。一批相关的写操作放进同一个事务。

**事务里出了错就晾着。** 实测 b 写失败后 `in_transaction` 仍是 `True`,不 `rollback`,a 的 `commit()` 也被卡住。出错要么回滚,要么靠 `with db()` 自动回滚。

**用 `row[0]`、`row[1]` 按位置取。** `SELECT` 里列的顺序一改,全部错位且不报错。设 `row_factory = sqlite3.Row`,按名字取。

**JOIN 两张表都有 `id`,又没起别名。** 实测 `dict(row)` 只剩一个 `id`,发票编号悄悄丢了。每一列起不重名的别名。

**以为 `Row` 是字典。** 没有 `.get()`,取不存在的列是 `IndexError` 而不是 `KeyError`,不能赋值。需要字典就 `dict(row)`。

**先写数据,再 `PRAGMA foreign_keys = ON`。** Day 92 的老坑,今天又出现一次:`autocommit=False` 下连上就在事务里,开不上。外键开关要在任何事务开始之前设置。

## 学习资料

### 文档与文章

- [Python 官方文档 · sqlite3(英文,有中文版)](https://docs.python.org/3/library/sqlite3.html):今天用到的 `commit`、`rollback`、`with` 的行为、`row_factory`、`autocommit`、`executemany` 都在这里。先读「Transaction control」那一节。
- [Python 官方文档 · contextlib(英文,有中文版)](https://docs.python.org/3/library/contextlib.html):`@contextmanager` 的说明和示例,Day 98 会再回到这里。
- [SQLite 官方 · Transaction(英文)](https://sqlite.org/lang_transaction.html):`BEGIN DEFERRED`、`IMMEDIATE`、`EXCLUSIVE` 的区别,今天练习 5 用到的 `BEGIN IMMEDIATE` 出处。
- [SQLite 官方 · File Locking And Concurrency(英文)](https://sqlite.org/lockingv3.html):`database is locked` 背后的锁机制,第 4 步现象的原理。
- [菜鸟教程 · SQLite 事务](https://www.runoob.com/sqlite/sqlite-transaction.html):中文,命令行里的写法,和 Day 91 对照。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1i2dZBaEaF&autoplay=0&high_quality=1" title="【古法编程-Python标准库-sqlite3】古法编程,半小时教会你使用sqlite3标准库!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>北屿青禾 · 【古法编程-Python标准库-sqlite3】古法编程,半小时教会你使用sqlite3标准库! · 约 33 分钟,播放 3 千,2026 年发布。标题说的是用标准库 sqlite3 从头走一遍,可以对照今天和昨天两课查缺补漏;视频内容我没有逐段核对,看的时候以今天文章里的实测为准。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1qe411U7Xu&autoplay=0&high_quality=1" title="Python数据库操作(第一节)之sqlite3" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>陶欤冰 · Python数据库操作(第一节)之sqlite3 · 约 15 分钟,播放 6 千,2024 年发布。短,偏入门,和 Day 92 到 93 的基础用法对应;同样没有逐段核对,以文章为准。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Oy2NpxfV9ok" title="Understand SQL Transactions in 5 Minutes" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Unwired · Understand SQL Transactions in 5 Minutes · 英文,可开字幕。五分钟讲事务,和今天第 1、2 步的 commit、rollback 对照着看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/-aKFBoZpiqA" title="Python Tutorial: Context Managers - Efficiently Managing Resources" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Tutorial: Context Managers · 英文,可开字幕。讲 with 背后的原理,包括 `@contextmanager`,是 Day 98 的内容;今天先用,看懂 `yield` 前后分别发生什么就够,完整的看 Day 98 再回来。</figcaption>
</figure>

### 书籍

- Martin Kleppmann、Chris Riccomini,《Designing Data-Intensive Applications》(第 2 版,O'Reilly,2026;中文译本《设计数据密集型应用》第 1 版由清华大学出版社出版,具体版次以出版社页面为准)。有专门一章讲事务:ACID、隔离级别、丢失更新、写偏斜。今天遇到的「先读后写」问题,书里讲得最透;现在读会有点深,以后做多个服务同时写数据时回来看。

### 开源项目与代码

今天这组不需要。想看这种「with 开连接、成功提交、失败回滚」的封装在真实框架里长什么样,可以等到 Day 98 学完 `with` 的原理后,翻 FastAPI 文档里「SQL (Relational) Databases」那一节的会话管理部分。

## 自测

1. 下面的脚本跑完,`accounts` 表里 1 号客户的余额会变吗?为什么?

```python
conn = sqlite3.connect("pay_demo.db")
conn.execute("UPDATE accounts SET balance = balance - 100 WHERE customer_id = 1")
conn.close()
```

<details><summary>答案</summary>

不会变。`UPDATE` 触发了隐式事务,但没有 `commit()`,关闭连接时未提交的事务被撤销。要么在 `close()` 前调 `conn.commit()`,要么把 `UPDATE` 放进 `with conn:`(它会在块正常结束时提交)。

</details>

2. 下面的函数有什么问题?会造成什么后果?怎么改?

```python
def pay(conn):
    try:
        conn.execute("UPDATE accounts SET balance = balance - 1188 WHERE customer_id = 1")
        conn.execute("INSERT INTO payments (invoice_id, amount, paid_at) VALUES (3, 1188, '2026-10-23')")
    except sqlite3.Error as e:
        print("出错了", e)
    conn.commit()
```

<details><summary>答案</summary>

出错只打印,不回滚,之后又无条件 `commit()`。如果第二条 `INSERT` 失败(比如发票已经付过,撞 `UNIQUE`),第一条的扣款已经在事务里,被这个 `commit()` 提交了,钱少了,却没有对应的付款记录(今天实测 1812 变成 624)。改法:`except` 里 `conn.rollback()` 并 `raise`,把 `commit()` 放进 `try` 的最后一行;或者整段包进 `with conn:`。

</details>

3. `with conn:` 和 `with db() as conn:`(今天封装的)在三方面分别有什么区别:提交、回滚、关闭连接?

<details><summary>答案</summary>

提交和回滚两者一样:块正常结束就提交,抛异常就回滚,且异常继续往外抛。区别在关闭:`with conn:` 不会关连接,出了块还能继续用(实测);`db()` 在 `finally` 里调了 `close()`,出了块再用就报 `ProgrammingError: Cannot operate on a closed database.`。另外 `db()` 还顺手设了 `row_factory` 并开了外键。

</details>

4. 一个修改函数执行 `UPDATE tickets SET status = 'closed' WHERE id = ?`,传入了不存在的 id,函数没有报错。怎么让调用方知道什么也没改?

<details><summary>答案</summary>

用 `cur = conn.execute(...)`,检查 `cur.rowcount`:0 表示没有匹配的行,据此抛 `LookupError`(或让接口返回 404、让 Agent 工具返回 `{"error": "没有这张工单"}`),别装成功。`rowcount` 对 `SELECT` 没意义,是 -1。

</details>

5. 面试题:Agent 有个工具「帮客户付发票」,模型因为超时重试了一次,会发生什么,你怎么保证不会重复扣款?

<details><summary>答案</summary>

重试会再执行一遍三步付款。保护要分层:①数据库层,`payments.invoice_id` 加 `UNIQUE`,第二次记付款必然失败;②事务层,三步放进同一个事务(`with db()`),第二步失败时第一步的扣款一起回滚,不会出现「钱扣了,没记账」;③业务层,先检查发票状态,已付就直接返回「已付过」,并把结果原样返回给模型,让重试变成无害的操作(幂等);④工具接口可以让调用方带一个幂等键,同一个键只处理一次。③和④让重试在到达数据库之前就被处理掉,①和②是兜底。

</details>

6. 面试题:同事说「事务越大越安全,把整个请求处理过程都放进一个事务里」。你同意吗?

<details><summary>答案</summary>

不同意。事务要覆盖的是「必须一起成功或一起失败」的那几步写操作,而不是整个请求。事务开着,写锁就占着:SQLite 同一时刻只有一个连接能写,别人会等到超时报 `database is locked`;Postgres 虽然有行锁,长事务照样会拖慢别人、推迟清理。在事务中间等网络、等用户、等模型回复,尤其不行。做法是:先把要查的、要算的、要调的外部服务都做完,最后开一个短事务,只放数据库写操作,尽快提交。

</details>

## 明天预告

Day 94 · 小项目:CloudLedger 迷你账单库。这几天你学了 SQL 的增删改查、连接和聚合、约束和事务,Python 里的查询、参数化、`row_factory` 和 `db()`,明天把它们拼起来做一个完整的小项目:用 Python 脚本从零建 `customers`、`invoices` 两张带约束的表,造一批数据(用练习 4 的 `executemany` 和一个事务),再写一组查询函数(按客户查发票、按月汇总、找欠款),最后配上测试。这个项目就是第五部分 CloudLedger 服务的 `seed.py` 的雏形。
