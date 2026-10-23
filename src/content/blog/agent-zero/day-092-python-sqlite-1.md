---
title: 'Day 92 · Python 操作 SQLite(一):查询和参数化防注入'
description: '前三天都在 sqlite3 命令行里敲 SQL,Agent 却是 Python 程序在运行时拼 SQL。今天用标准库 sqlite3 连上 practice.db,把查询结果读成 Python 的元组列表,再亲手演示一次「把输入拼进 SQL」怎么被注入、怎么用 ? 占位符堵上,最后认出占位符管不到的几个地方。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'sqlite', 'sql-injection', 'database', 'agent-zero']
series: 'agent-zero'
day: 92
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 91](/blog/agent-zero/day-091-sql-6/) 在命令行里给表加了约束:主键、`NOT NULL`、`UNIQUE`、`CHECK`、外键,让数据库自己拒绝 15 号孤儿发票这种脏数据;又用 `BEGIN`、`COMMIT`、`ROLLBACK` 把「扣余额、记付款、改发票状态」捆成一件事。结尾有两个坑:SQLite 的外键默认是关的,每个连接都要自己 `PRAGMA foreign_keys = ON`;事务里一条语句出错,事务不会自动回滚。

那三天你一直在 `sqlite3` 命令行里手敲 SQL。可 Agent 不是人,它是一个 Python 程序:用户问「星河餐饮欠了多少钱」,程序在**运行的时候**才知道要查哪个客户,SQL 得由代码现拼出来再交给数据库。今天把前面的 SQL 接进 Python,而且先学最要紧的一件事:拼 SQL 的时候,用户(或者模型)给的那个值,怎么才不会变成「命令」。

## 今天要解决的问题

学完今天,你应该能做到:

1. 用标准库 `sqlite3` 连上 `practice.db`,执行一条 `SELECT`,用 `fetchone`、`fetchall` 或者 `for` 循环把结果读成 Python 的元组,并说清 `cursor` 是什么、为什么读第二遍是空的。
2. 亲手演示一次 SQL 注入:把用户输入用 f-string 拼进 SQL,让一条本来只查一个客户的查询返回整张表,甚至把别的表的邮箱拖出来。
3. 用 `?` 占位符把同样的攻击全部挡住,并认得出占位符最常见的四个坑:参数没写成元组、个数对不上、`LIKE` 的百分号、表名和列名不能用 `?`。
4. 在 Python 里开外键(`PRAGMA foreign_keys = ON`),并知道它必须在连接刚建好时就执行。

今天两个新概念:**用 Python 连数据库查数据**(连接、游标、元组),和**参数化查询**(`?` 占位符)。外键开关和只读连接是顺手带上的两行代码。

预计用时:3 小时。花费 ¥0,不调 API。

前置:[Day 85](/blog/agent-zero/day-085-sql-1/) 到 [Day 91](/blog/agent-zero/day-091-sql-6/) 的 SQL,尤其是 `practice.db`(10 家客户、15 张发票,第 15 张是孤儿)和 Day 91 的外键开关;[Day 22](/blog/agent-zero/day-022-tuples-unpack/) 的元组和解包;[Day 37](/blog/agent-zero/day-037-pathlib/) 的 `pathlib`;[Day 33](/blog/agent-zero/day-033-packages/) 的 `-m` 运行;[Day 72](/blog/agent-zero/day-072-pytest-2/) 的 `pyproject.toml` 里 `pythonpath` 配置(练习里会写一个测试)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写「连库 + 带 `?` 的查询」和「一条注入攻击为什么有效」;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 从前端看:Node 里你早就写过 `?`

如果你在 Node 里连过数据库,今天的主角你见过。`better-sqlite3`、`mysql2` 这些库的写法是:

```js
db.prepare("SELECT * FROM customers WHERE city = ?").all("上海");
```

SQL 里留一个 `?`,真正的值作为另一个参数单独传进去。Postgres 的 Node 驱动 `pg` 用 `$1` 代替 `?`,意思一样。你也见过反面教材:用模板字符串把变量塞进 SQL,`` `... WHERE city = '${city}'` ``。今天用 Python 把这两种写法都跑一遍,看看第二种到底会发生什么。

Python 这边不用安装任何东西:`sqlite3` 是**标准库**,装好 Python 就有,不需要 `uv add`。对照表:

| Node(better-sqlite3) | Python(sqlite3) | 说明 |
| --- | --- | --- |
| `new Database("practice.db")` | `sqlite3.connect("practice.db")` | 打开数据库文件,得到一个连接 |
| `db.prepare(sql).all(a, b)` | `conn.execute(sql, (a, b)).fetchall()` | 执行并取回所有行 |
| `db.prepare(sql).get(a)` | `conn.execute(sql, (a,)).fetchone()` | 只取第一行,没有就是 `undefined` / `None` |
| 行是对象 `{ id: 1, company: "星河餐饮" }` | 行是**元组** `(1, '星河餐饮')` | 默认没有列名,明天(Day 93)用 `row_factory` 补上 |
| `db.close()` | `conn.close()` | 关闭连接 |

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="一次查询的路径:Python 脚本调用 sqlite3 模块,模块通过连接打开 practice.db 文件;execute 返回游标,fetchall 把游标里的行取成元组列表">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="30" width="150" height="70" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="95" y="56" fill="var(--ink)" text-anchor="middle">你的 Python 脚本</text>
<text x="95" y="76" fill="var(--ink-soft)" text-anchor="middle" font-size="11">conn.execute(sql, 参数)</text>
<rect x="245" y="30" width="150" height="70" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="56" fill="var(--ink)" text-anchor="middle">sqlite3 模块</text>
<text x="320" y="76" fill="var(--ink-soft)" text-anchor="middle" font-size="11">标准库,不用安装</text>
<rect x="470" y="30" width="150" height="70" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="545" y="56" fill="var(--ink)" text-anchor="middle">practice.db</text>
<text x="545" y="76" fill="var(--ink-soft)" text-anchor="middle" font-size="11">磁盘上的一个文件</text>
<line x1="170" y1="52" x2="245" y2="52" stroke="var(--rule)"/>
<line x1="395" y1="52" x2="470" y2="52" stroke="var(--rule)"/>
<text x="207" y="46" fill="var(--ink-faint)" text-anchor="middle" font-size="11">SQL</text>
<text x="432" y="46" fill="var(--ink-faint)" text-anchor="middle" font-size="11">connect</text>
<line x1="470" y1="82" x2="395" y2="82" stroke="var(--rule)"/>
<line x1="245" y1="82" x2="170" y2="82" stroke="var(--rule)"/>
<text x="207" y="96" fill="var(--ink-faint)" text-anchor="middle" font-size="11">cursor</text>
<rect x="20" y="140" width="600" height="70" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="36" y="164" fill="var(--ink)">fetchall()  →  [(2, '青木设计', '基础版'), (8, '云杉律所', '专业版')]</text>
<text x="36" y="186" fill="var(--ink-soft)" font-size="11">一行 = 一个元组,整个结果 = 元组组成的列表;游标读完就空了,要再读得重新 execute</text>
<line x1="95" y1="100" x2="95" y2="140" stroke="var(--rule)" stroke-dasharray="4 3"/>
</g>
</svg>
<figcaption>一次查询的路径。Python 把 SQL 交给 sqlite3 模块,模块去打开磁盘上的 practice.db,查询的结果以游标(cursor)的形式交回来,你再用 fetchone/fetchall 取成元组。下面第 1、2 步分别跑出这两段。</figcaption>
</figure>

## 第 0 步:准备

你需要 Day 85 到 91 留下的两个文件:`part01/sql/customers.sql` 和 `part01/sql/invoices.sql`。今天所有脚本都读 `practice.db`,先把它重建一份干净的,保证是 10 家客户、15 张发票:

```bash
cd /Users/你/agent-zero-lab/part01/sql
rm -f practice.db
sqlite3 practice.db < customers.sql
sqlite3 practice.db < invoices.sql
sqlite3 practice.db "SELECT count(*) FROM customers; SELECT count(*) FROM invoices; SELECT sum(amount) FROM invoices;"
cd ..
ls __init__.py
```

<div class="line-notes">

- `cd /Users/你/agent-zero-lab/part01/sql` 进入放 SQL 文件的目录。以后写 Python 脚本放在上一层 `part01/`。
- `rm -f practice.db` 删掉旧库(`-f` 是不存在也不报错)。`.sql` 文件才是真正的数据源头,库随时可以重建。
- `sqlite3 practice.db < customers.sql` 用 Day 85 的文件建客户表并插入 10 家客户,`< 文件` 是 Day 5 学的输入重定向。
- `sqlite3 practice.db < invoices.sql` 建发票表并插入 15 张,其中 15 号是孤儿(客户编号 11 不存在)。
- `SELECT count(*) FROM customers; SELECT count(*)` 一次连跑三条查询确认数据:应该是 10、15、100017。
- `cd ..` 回到 `part01/`,后面的脚本都放这里。
- `ls __init__.py` `part01` 是包(Day 33 建的),`-m` 运行和 pytest 导入都靠这个文件。显示 `__init__.py` 就说明在。

</div>

```text
10
15
100017
__init__.py
```

10 家客户,15 张发票,总额 100017,和 Day 90 的审计报表对得上。

## 第 1 步:连上数据库,查一个数

新建 `part01/sqlite_hello.py`,先只做最小的一件事:连上、查客户总数、打印、关掉。

```python
# agent-zero-lab/part01/sqlite_hello.py
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "sql" / "practice.db"

conn = sqlite3.connect(DB_PATH)
cur = conn.execute("SELECT count(*) FROM customers")
row = cur.fetchone()
print("fetchone 拿到:", row)
print("类型:", type(row))
print("客户数:", row[0])
conn.close()
```

<div class="line-notes">

- `import sqlite3` 导入标准库里的 `sqlite3`,Python 自带。
- `from pathlib import Path` Day 37 的路径工具。
- `DB_PATH = Path(__file__).parent / "sql" / "practice.db"` `__file__` 是当前脚本自己的路径,`.parent` 是它所在目录(`part01/`),再用 `/` 拼上 `sql`、`practice.db`。这样不管你在哪个目录运行脚本,找到的都是同一个库文件。
- `conn = sqlite3.connect(DB_PATH)` 打开(必要时创建)数据库文件,返回**连接**(connection)对象。后面所有操作都通过 `conn`。**注意:文件不存在时它不报错,会悄悄建一个空文件**,马上就演示。
- `cur = conn.execute("SELECT count(*) FROM customers")` 执行一条 SQL。`execute` 返回一个**游标**(cursor):一个指着查询结果的「指针」,结果还留在数据库那边,等你来取。
- `row = cur.fetchone()` 从游标取**一行**。`count(*)` 只产出一行一列,所以拿到的是 `(10,)`。
- `print("类型:", type(row))` 看一眼类型:是 `tuple`,就是 Day 22 学的元组。
- `print("客户数:", row[0])` 一行一列的结果,用下标 `[0]` 取出那个数 10。
- `conn.close()` 用完关连接。程序一结束 Python 也会收拾,但养成自己关的习惯,Day 93 会学更好的写法。

</div>

在 `agent-zero-lab` 根目录运行(从根目录跑,Day 33 的规矩):

```bash
cd /Users/你/agent-zero-lab
uv run python part01/sqlite_hello.py
```

```text
fetchone 拿到: (10,)
类型: <class 'tuple'>
客户数: 10
```

`(10,)` 末尾那个逗号不是错别字:只有一个元素的元组必须带逗号,Day 22 讲过。查询结果永远是「行」,哪怕只有一列,取出来也是元组,所以要 `row[0]`。

### 故意拼错一次文件名

`sqlite3.connect` 对不存在的文件不报错。这是一个真实的新手大坑,我自己第一次就中了:路径拼错一个字母,脚本不报「找不到文件」,而是报一个让你摸不着头脑的错。新建 `part01/sqlite_typo.py`:

```python
# agent-zero-lab/part01/sqlite_typo.py
import sqlite3
from pathlib import Path

BAD_PATH = Path(__file__).parent / "sql" / "practise.db"  # 故意拼错

print("连接前存在吗:", BAD_PATH.exists())
conn = sqlite3.connect(BAD_PATH)
print("连接后存在吗:", BAD_PATH.exists())
conn.execute("SELECT count(*) FROM customers")
```

<div class="line-notes">

- `BAD_PATH = Path(__file__).parent / "sql" / "practise.db"` 把 `practice` 写成 `practise`,多了个 s。
- `print("连接前存在吗:", BAD_PATH.exists())` `.exists()` 问这个路径上有没有文件,此刻是 `False`。
- `conn = sqlite3.connect(BAD_PATH)` 连接不存在的文件,SQLite 的做法是新建一个。
- `print("连接后存在吗:", BAD_PATH.exists())` 变成 `True` 了:`part01/sql/` 里凭空多出一个 0 字节的 `practise.db`。
- `conn.execute("SELECT count(*) FROM customers")` 在这个空库里查 `customers`,它当然没有这张表。

</div>

```bash
uv run python part01/sqlite_typo.py
```

```text
连接前存在吗: False
连接后存在吗: True
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/sqlite_typo.py", line 10, in <module>
    conn.execute("SELECT count(*) FROM customers")
sqlite3.OperationalError: no such table: customers
```

报错说「没有 customers 这张表」,可你明明在命令行里查过它。遇到 `no such table`,第一反应不要怀疑表,先怀疑**连的是不是同一个库文件**:打印 `DB_PATH`,看 `part01/sql/` 里是不是多出了一个 0 字节的文件。确认一下,然后删掉它:

```bash
ls -la part01/sql/practise.db
rm part01/sql/practise.db
```

```text
-rw-r--r--  1 你  wheel  0 23 Oct 12:03 part01/sql/practise.db
```

0 字节,就是它。以后写 Agent 工具时,可以在连接前先检查 `DB_PATH.exists()`,不存在就直接报「找不到数据库」,比 `no such table` 好懂得多。

## 第 2 步:把结果取出来:fetchone、fetchall 和 for

只取一行远远不够,更常见的是取一批。新建 `part01/sqlite_fetch.py`,一次看三种取法,再看两个容易懵的现象:游标读完就空了;查不到东西时返回什么。

```python
# agent-zero-lab/part01/sqlite_fetch.py
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "sql" / "practice.db"

conn = sqlite3.connect(DB_PATH)

cur = conn.execute("SELECT id, company, plan FROM customers WHERE city = '上海' ORDER BY id")
print("列信息:", [d[0] for d in cur.description])

rows = cur.fetchall()
print("fetchall:", rows)
print("再 fetchall 一次:", cur.fetchall())

print("--- for 直接遍历 cursor ---")
for customer_id, company, plan in conn.execute("SELECT id, company, plan FROM customers ORDER BY id LIMIT 3"):
    print(customer_id, company, plan)

print("--- fetchone 一行一行拿 ---")
cur = conn.execute("SELECT company FROM customers WHERE plan = '企业版' ORDER BY id")
print(cur.fetchone())
print(cur.fetchone())
print(cur.fetchone())

print("--- 查不到时 ---")
print(conn.execute("SELECT * FROM customers WHERE city = '拉萨'").fetchall())
print(conn.execute("SELECT * FROM customers WHERE city = '拉萨'").fetchone())

conn.close()
```

<div class="line-notes">

- `cur = conn.execute("SELECT id, company, plan FROM customers WHERE city = '上海' ORDER BY id")` 查上海的客户。城市写死在 SQL 里,今天后面才会学「从变量传进去」。
- `print("列信息:", [d[0] for d in cur.description])` `cur.description` 是游标对自己结果的描述:每一列对应一个 7 元素的元组,第 0 个是列名(Day 23 的推导式取出来)。实测得到 `['id', 'company', 'plan']`。这是元组「没有列名」的补救办法,Day 93 有更好的。
- `rows = cur.fetchall()` 一次把所有行取出来,装进列表。上海有两家,所以是 `[(2, '青木设计', '基础版'), (8, '云杉律所', '专业版')]`。
- `print("再 fetchall 一次:", cur.fetchall())` 游标像一个读到末尾的指针,**取过的行不会再来**。第二次取到 `[]`。要再读一遍,必须重新 `execute`。
- `for customer_id, company, plan in conn.execute(` 游标本身(SQL 末尾的 `LIMIT 3` 只要前三行,Day 85 的老朋友)可以直接放进 `for`,一次给一行;每行是 3 元素元组,用 Day 22 的解包拆成三个变量。实测输出 `1 星河餐饮 专业版` 等三行。
- `cur = conn.execute("SELECT company FROM customers WHERE plan = '企业版' ORDER BY id")` 企业版客户只有 2 家:远山物流(3 号)、启明科技(5 号)。
- `print(cur.fetchone())` 三次 `fetchone`:前两次分别取到 `('远山物流',)`、`('启明科技',)`,第三次没有行可取了,返回 `None`。
- `.fetchall()` 查不到时返回**空列表** `[]`,不是报错;`.fetchone()` 查不到返回 `None`。拉萨没有客户,所以两个都是「空」。写代码时要处理:`row = ...fetchone()` 之后先判断 `if row is None`,再用 `row[0]`,否则会得到 `TypeError: 'NoneType' object is not subscriptable`。

</div>

```bash
uv run python part01/sqlite_fetch.py
```

```text
列信息: ['id', 'company', 'plan']
fetchall: [(2, '青木设计', '基础版'), (8, '云杉律所', '专业版')]
再 fetchall 一次: []
--- for 直接遍历 cursor ---
1 星河餐饮 专业版
2 青木设计 基础版
3 远山物流 企业版
--- fetchone 一行一行拿 ---
('远山物流',)
('启明科技',)
None
--- 查不到时 ---
[]
None
```

三种取法怎么选:结果小、要整个看一遍,用 `fetchall()`;一行一行处理,直接 `for` 遍历游标;明确只要一行(按主键查、`count(*)`),用 `fetchone()`。几百万行的表别无脑 `fetchall()`,那会把整张表一次塞进内存;应该在 SQL 里加 `WHERE` 或 `LIMIT`,或者用 `for` 一行一行读。

## 第 3 步:把用户的输入拼进 SQL,会出什么事

前面的城市是写死的。真实场景里,城市来自用户输入,或者来自模型生成的工具参数。最顺手的写法是 f-string,和你在前端拼模板字符串一模一样。下面把这种写法的后果完整跑一遍。

先设定场景,这就是你以后给 Agent 写工具的样子:

- `find_by_city_bad(city)`:按城市查客户。
- `invoices_of_bad(customer_id)`:查某个客户的发票。模型调用工具时传的参数是 JSON,比如 `{"customer_id": "1"}`,工具函数照着参数拼 SQL。

新建 `part01/inject_bad.py`:

```python
# agent-zero-lab/part01/inject_bad.py
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "sql" / "practice.db"


def find_by_city_bad(conn: sqlite3.Connection, city: str) -> list[tuple]:
    sql = f"SELECT id, company FROM customers WHERE city = '{city}'"
    print("  实际执行的 SQL:", sql)
    return conn.execute(sql).fetchall()


def invoices_of_bad(conn: sqlite3.Connection, customer_id: str) -> list[tuple]:
    sql = f"SELECT * FROM invoices WHERE customer_id = {customer_id}"
    print("  实际执行的 SQL:", sql)
    return conn.execute(sql).fetchall()


conn = sqlite3.connect(DB_PATH)

print("1. 正常使用")
print("  结果:", find_by_city_bad(conn, "上海"))

print("2. 名字里带单引号")
try:
    find_by_city_bad(conn, "O'Brien")
except sqlite3.Error as e:
    print("  报错:", type(e).__name__, e)

print("3. 条件被改写")
rows = find_by_city_bad(conn, "' OR '1'='1")
print("  返回", len(rows), "行:", rows[:3], "...")

print("4. 数字参数,连引号都不用")
rows = invoices_of_bad(conn, "1 OR 1=1")
print("  返回", len(rows), "行(1 号客户本来只有 3 张)")

print("5. UNION 把别的表拖出来")
rows = invoices_of_bad(conn, "0 UNION SELECT id, company, seats, email, created_at FROM customers")
for r in rows[:4]:
    print("  ", r)

print("6. 想一次执行两条语句")
try:
    invoices_of_bad(conn, "1; DROP TABLE invoices")
except sqlite3.Error as e:
    print("  报错:", type(e).__name__, e)
print("  invoices 还在吗:", conn.execute("SELECT count(*) FROM invoices").fetchone())
conn.close()
```

<div class="line-notes">

- `def find_by_city_bad(conn: sqlite3.Connection, city: str) -> list[tuple]:` 第一个参数是连接,第二个是城市。类型标注 `sqlite3.Connection` 是连接对象的类型,`list[tuple]` 表示返回元组列表(Day 45)。函数名带 `_bad` 是提醒你:**这是反面教材**。
- `sql = f"SELECT id, company FROM customers WHERE city = '{city}'"` 危险的一行。f-string 把变量 `city` 的内容原样塞进 SQL 文本,两边的单引号是 SQL 里字符串的边界。`city` 是 `上海` 时得到 `... WHERE city = '上海'`,没问题;但 `city` 里带什么内容,SQL 就变成什么样子。
- `print("  实际执行的 SQL:", sql)` 把最终拼出的 SQL 打出来,下面每一次都能看到它被改成了什么。
- `return conn.execute(sql).fetchall()` 拼好的一整串直接交给数据库执行。
- `sql = f"SELECT * FROM invoices WHERE customer_id = {customer_id}"` 数字列的写法:没有引号,更危险,因为攻击者连引号都不用拼。
- `print("2. 名字里带单引号")` 第二个场景。`O'Brien` 是一个正常的英文姓,中间有单引号。拼出来变成 `city = 'O'Brien'`,引号数量成了奇数。实测报 `OperationalError near "Brien": syntax error`:数据库读到 `'O'` 就以为字符串结束了,后面的 `Brien'` 看不懂。这还不是攻击,只是一个正常输入就把程序弄崩了。
- `rows = find_by_city_bad(conn, "' OR '1'='1")` 第三个场景是真正的注入。输入第一个字符是单引号,把 SQL 里的字符串提前「关上」,接着写 `OR '1'='1`,最后一个引号则借用 SQL 原本留的那个结尾引号。拼出 `WHERE city = '' OR '1'='1'`:城市等于空串,**或者** `'1'='1'`(永远成立),所以条件对每一行都成立,实测返回 10 行,整张客户表。
- `rows = invoices_of_bad(conn, "1 OR 1=1")` 数字参数注入。拼出 `WHERE customer_id = 1 OR 1=1`,返回 15 行,也就是**所有客户**的发票。设想模型调用「查我的发票」这个工具,传来 `"1 OR 1=1"`,用户就看到了别人的账单。
- `"0 UNION SELECT id, company, seats, email, created_at FROM customers"` `UNION` 把两条查询的结果竖着拼起来(Day 91 的 `UNION ALL` 的近亲)。前半 `customer_id = 0` 一行也没有,后半从 `customers` 表取五列,**列数要和发票表一致**。结果是发票查询的输出里混进了客户的公司名和邮箱,实测第一行就是 `(1, '星河餐饮', 12, 'wangwei@xinghe.example', '2025-03-14')`。攻击者可以借一个无关的查询把任意表读出来。
- `invoices_of_bad(conn, "1; DROP TABLE invoices")` 想用分号追加第二条语句。Python 的 `sqlite3` 模块的 `execute` **只允许一条语句**,实测报 `ProgrammingError: You can only execute one statement at a time.`,表还在,最后查到 15 张。这算一道偶然的保护,但不能依赖:别的驱动或配置可能允许多条语句;`UNION` 那种读数据的攻击完全不受它影响;`executescript` 就是专门执行多条的。

</div>

```bash
uv run python part01/inject_bad.py
```

```text
1. 正常使用
  实际执行的 SQL: SELECT id, company FROM customers WHERE city = '上海'
  结果: [(2, '青木设计'), (8, '云杉律所')]
2. 名字里带单引号
  实际执行的 SQL: SELECT id, company FROM customers WHERE city = 'O'Brien'
  报错: OperationalError near "Brien": syntax error
3. 条件被改写
  实际执行的 SQL: SELECT id, company FROM customers WHERE city = '' OR '1'='1'
  返回 10 行: [(1, '星河餐饮'), (2, '青木设计'), (3, '远山物流')] ...
4. 数字参数,连引号都不用
  实际执行的 SQL: SELECT * FROM invoices WHERE customer_id = 1 OR 1=1
  返回 15 行(1 号客户本来只有 3 张)
5. UNION 把别的表拖出来
  实际执行的 SQL: SELECT * FROM invoices WHERE customer_id = 0 UNION SELECT id, company, seats, email, created_at FROM customers
   (1, '星河餐饮', 12, 'wangwei@xinghe.example', '2025-03-14')
   (2, '青木设计', 3, 'lifang@qingmu.example', '2025-06-02')
   (3, '远山物流', 85, 'zhanglei@yuanshan.example', '2024-11-20')
   (4, '蓝鲸教育', 20, None, '2025-01-08')
6. 想一次执行两条语句
  实际执行的 SQL: SELECT * FROM invoices WHERE customer_id = 1; DROP TABLE invoices
  报错: ProgrammingError You can only execute one statement at a time.
  invoices 还在吗: (15,)
```

这就是 **SQL 注入**(SQL injection):用户输入里的一部分,被数据库当成了 SQL 命令的一部分。根子在于「命令」和「数据」混在同一个字符串里,数据库收到整串文本,没法知道哪一段是你写的、哪一段是别人塞进来的。经典漫画 [xkcd 327](https://xkcd.com/327/) 讲的就是这件事:一个学生的名字里写着 `Robert'); DROP TABLE Students;--`。

对 Agent 来说,这件事比普通网站更要紧,原因有两个。第一,工具参数是模型生成的,而模型生成什么,会被用户消息、检索到的网页或者工单正文影响(这叫提示注入,第七部分专门讲);工具函数不能默认「参数是我自己人写的所以没问题」。第二,Agent 的工具常常直接连着真实的账单库,出一次事就是别人的数据被读走。所以规矩只有一条:**模型给的任何值、用户给的任何值,都不准拼进 SQL 文本。**

<figure>
<svg viewBox="0 0 640 290" role="img" aria-label="左边是拼接:SQL 模板和用户输入被拼成同一个字符串交给数据库,数据库分不清哪段是命令;右边是占位符:带问号的 SQL 模板和参数元组分开传递,数据库先解析模板,再把参数当成纯数据填进去">
<rect x="0" y="0" width="640" height="290" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="24" fill="var(--ink)">f-string 拼接:一条混在一起的字符串</text>
<rect x="20" y="40" width="270" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="155" y="60" fill="var(--ink)" text-anchor="middle" font-size="11">你写的:... WHERE city = '</text>
<rect x="20" y="78" width="270" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="155" y="98" fill="var(--ink)" text-anchor="middle" font-size="11">用户给的:' OR '1'='1</text>
<rect x="20" y="116" width="270" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="155" y="136" fill="var(--ink)" text-anchor="middle" font-size="11">你写的:'</text>
<line x1="155" y1="146" x2="155" y2="170" stroke="var(--rule)"/>
<rect x="20" y="170" width="270" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="155" y="189" fill="var(--ink)" text-anchor="middle" font-size="11">数据库收到一整串文本</text>
<text x="155" y="205" fill="var(--ink-soft)" text-anchor="middle" font-size="11">WHERE city = '' OR '1'='1'</text>
<text x="20" y="240" fill="var(--ink-soft)" font-size="11">哪段是命令、哪段是数据,看不出来</text>
<text x="20" y="258" fill="var(--ink)" font-size="11">结果:10 行,整张表</text>
<line x1="320" y1="20" x2="320" y2="270" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="340" y="24" fill="var(--ink)">? 占位符:模板和值分开走</text>
<rect x="340" y="40" width="280" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="480" y="60" fill="var(--ink)" text-anchor="middle" font-size="11">模板:... WHERE city = ?</text>
<rect x="340" y="94" width="280" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="480" y="114" fill="var(--ink)" text-anchor="middle" font-size="11">参数:("' OR '1'='1",)</text>
<line x1="480" y1="70" x2="480" y2="170" stroke="var(--rule)"/>
<line x1="480" y1="124" x2="480" y2="170" stroke="var(--rule)"/>
<rect x="340" y="170" width="280" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="480" y="189" fill="var(--ink)" text-anchor="middle" font-size="11">先把模板读成语句,再填值</text>
<text x="480" y="205" fill="var(--ink-soft)" text-anchor="middle" font-size="11">值只会被当成一个字符串</text>
<text x="340" y="240" fill="var(--ink-soft)" font-size="11">城市等于那一整串怪字符,没有这个城市</text>
<text x="340" y="258" fill="var(--ink)" font-size="11">结果:0 行</text>
</g>
</svg>
<figcaption>左边是拼接:蓝色是你写的 SQL,琥珀色是用户塞进来的,拼成一串后数据库分不清。右边是占位符:模板和值走两条路,值进不了「命令」的位置。数字来自上面第 3 步和下面第 4 步的实跑。</figcaption>
</figure>

## 第 4 步:`?` 占位符,把值和命令分开

修法很小:SQL 文本里不再放变量,在要放值的地方写一个 `?`,真正的值作为 `execute` 的**第二个参数**单独传进去,必须是一个序列(通常是元组)。新建 `part01/inject_safe.py`,把第 3 步的同样六次攻击原样重放一遍:

```python
# agent-zero-lab/part01/inject_safe.py
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "sql" / "practice.db"


def find_by_city(conn: sqlite3.Connection, city: str) -> list[tuple]:
    return conn.execute(
        "SELECT id, company FROM customers WHERE city = ?", (city,)
    ).fetchall()


def invoices_of(conn: sqlite3.Connection, customer_id: str) -> list[tuple]:
    return conn.execute(
        "SELECT * FROM invoices WHERE customer_id = ?", (customer_id,)
    ).fetchall()


conn = sqlite3.connect(DB_PATH)
conn.set_trace_callback(lambda sql: print("  数据库收到:", sql))

print("1. 正常使用")
print("  结果:", find_by_city(conn, "上海"))

print("2. 名字里带单引号")
print("  结果:", find_by_city(conn, "O'Brien"))

print("3. 条件被改写的那句")
print("  结果:", find_by_city(conn, "' OR '1'='1"))

print("4. 数字参数")
print("  结果:", invoices_of(conn, "1 OR 1=1"))

print("5. UNION")
print("  结果:", invoices_of(conn, "0 UNION SELECT id, company, seats, email, created_at FROM customers"))

print("6. 正常传数字")
print("  结果:", invoices_of(conn, "1"))
conn.close()
```

<div class="line-notes">

- `"SELECT id, company FROM customers WHERE city = ?", (city,)` 两个参数:第一个是 SQL 模板,值的位置写 `?`,**不加引号**;第二个是参数元组。`(city,)` 末尾的逗号不能省(第 5 步就会踩),这是只有一个元素的元组。
- `"SELECT * FROM invoices WHERE customer_id = ?", (customer_id,)` 数字列同样写 `?`,不用自己加引号也不用转换。
- `conn.set_trace_callback(lambda sql: print("  数据库收到:", sql))` 给连接装一个「监听器」:每执行一条 SQL,就调用这个函数并把语句交给它。这里的函数是 `lambda`(Day 30),只做一件事,打印出来。**注意**:它打印的是 SQLite 为了方便人看,把值填进模板之后的样子;真正执行时,模板和值是分开处理的。
- `print("  结果:", find_by_city(conn, "O'Brien"))` 实测不再报错,结果是 `[]`:没有叫 `O'Brien` 的城市,但程序没崩。监听器里能看到 `'O''Brien'`:值里的单引号被写成了两个单引号,这是 SQL 里「引号本身」的写法,模块自动替你做了。
- `find_by_city(conn, "' OR '1'='1")` 同一句攻击串,这回数据库收到 `city = ''' OR ''1''=''1'`:整串被当成**一个字符串字面量**,里面的每个单引号都被转义了。数据库查「城市等于这串怪字符的客户」,没有,返回 `[]`。
- `invoices_of(conn, "1 OR 1=1")` 数字注入同理:拼成 `customer_id = '1 OR 1=1'`,整串被当作一个字符串去和客户编号比较。这串文字不能转成数字,所以不等于任何编号,返回 `[]`。
- `invoices_of(conn, "0 UNION SELECT id` `UNION` 也只是字符串里的几个单词,没人把它当命令,返回 `[]`。
- `invoices_of(conn, "1")` 正常传 `"1"`:客户编号列声明的是整数,SQLite 比较时会把字符串 `'1'` 自动转成数字 1,所以照常取到 3 张发票。**这是 SQLite 的宽松,别的数据库(比如 Postgres)传字符串给整数列会直接报错**。更稳的写法是在工具函数里先 `int(customer_id)`,转不成数字就在进数据库之前拒绝(第 6 步的封装就这么做)。

</div>

```bash
uv run python part01/inject_safe.py
```

```text
1. 正常使用
  数据库收到: SELECT id, company FROM customers WHERE city = '上海'
  结果: [(2, '青木设计'), (8, '云杉律所')]
2. 名字里带单引号
  数据库收到: SELECT id, company FROM customers WHERE city = 'O''Brien'
  结果: []
3. 条件被改写的那句
  数据库收到: SELECT id, company FROM customers WHERE city = ''' OR ''1''=''1'
  结果: []
4. 数字参数
  数据库收到: SELECT * FROM invoices WHERE customer_id = '1 OR 1=1'
  结果: []
5. UNION
  数据库收到: SELECT * FROM invoices WHERE customer_id = '0 UNION SELECT id, company, seats, email, created_at FROM customers'
  结果: []
6. 正常传数字
  数据库收到: SELECT * FROM invoices WHERE customer_id = '1'
  结果: [(1, 1, 1188, 'paid', '2026-07-01'), (2, 1, 1188, 'paid', '2026-08-01'), (3, 1, 1188, 'unpaid', '2026-09-01')]
```

同样的六个输入,第 3 步里四个出了事,这里全部老实。机制是:数据库先拿到带 `?` 的模板,**把它整个读成一条语句**(结构定死了:查哪张表、条件是 `city = 某个值`),然后值才被填进去,而且只能填进「值」的位置。值里写什么都只是字符串,翻不进命令里。这个做法的行话叫**参数化查询**(parameterized query)或预编译语句(prepared statement)。

规则只有一条,记住就够用:**SQL 文本里不出现任何来自外部的变量,值一律走 `?`。** 官方文档也是这个态度,[Python sqlite3 文档](https://docs.python.org/3/library/sqlite3.html)里提醒过:别用 Python 的字符串操作去组装查询,容易被 SQL 注入攻击,改用 DB-API 的参数替换(也就是 `?`)。

## 第 5 步:占位符的坑

`?` 不是万能的,新手最常踩的坑有五个。把它们放在 `part01/placeholder_traps.py` 里一次跑出来:

```python
# agent-zero-lab/part01/placeholder_traps.py
import sqlite3
from pathlib import Path
from typing import Any

DB_PATH = Path(__file__).parent / "sql" / "practice.db"
conn = sqlite3.connect(DB_PATH)


def try_run(label: str, sql: str, params: Any) -> None:
    try:
        rows = conn.execute(sql, params).fetchall()
        print(f"{label}: {len(rows)} 行 {rows[:2]}")
    except sqlite3.Error as e:
        print(f"{label}: {type(e).__name__}: {e}")


print("== 坑 1:参数忘了写成元组 ==")
try_run("('上海')  ", "SELECT id FROM customers WHERE city = ?", ("上海"))
try_run("('上海',) ", "SELECT id FROM customers WHERE city = ?", ("上海",))
try_run("['上海']  ", "SELECT id FROM customers WHERE city = ?", ["上海"])

print("== 坑 2:个数对不上 ==")
try_run("2 个 ? 给 1 个值", "SELECT id FROM customers WHERE city = ? AND plan = ?", ("上海",))

print("== 命名占位符 ==")
try_run(":city 配字典", "SELECT id FROM customers WHERE city = :city AND plan = :plan", {"city": "上海", "plan": "专业版"})

print("== 坑 3:LIKE 的百分号放哪 ==")
try_run("% 写进 SQL 又加参数", "SELECT id, company FROM customers WHERE company LIKE '%?%'", ("星河",))
try_run("% 拼在值里          ", "SELECT id, company FROM customers WHERE company LIKE ?", ("%星河%",))

print("== 坑 4:? 不能代替表名和列名 ==")
try_run("表名用 ?   ", "SELECT * FROM ? WHERE id = 1", ("customers",))
rows = conn.execute("SELECT id, amount FROM invoices ORDER BY ? DESC LIMIT 3", ("amount",)).fetchall()
print("ORDER BY ? 传 'amount':", rows, "<- 不是按金额排的")
rows = conn.execute("SELECT id, amount FROM invoices ORDER BY amount DESC LIMIT 3").fetchall()
print("ORDER BY amount 写死 :", rows)

print("== 坑 5:IN 的个数不固定 ==")
ids = [1, 3, 5]
marks = ",".join("?" * len(ids))
print("拼出来的占位符:", marks)
print(conn.execute(f"SELECT id, company FROM customers WHERE id IN ({marks})", ids).fetchall())
conn.close()
```

<div class="line-notes">

- `from typing import Any` `Any` 表示「什么类型都行」,这里的参数可能是元组、列表、字典,偷懒用它(Day 45)。
- `def try_run(label: str, sql: str, params: Any) -> None:` 一个小工具:执行 SQL,不管成功失败都打印一行结果,后面每一种情况都靠它。
- `rows = conn.execute(sql, params).fetchall()` 把模板和参数交给数据库。
- `print(f"{label}: {len(rows)} 行 {rows[:2]}")` 成功时打印行数和前两行;`rows[:2]` 是切片(Day 21)。
- `except sqlite3.Error as e:` `sqlite3.Error` 是这个模块所有错误的父类,一次接住;`type(e).__name__` 打印具体错误类名。
- `try_run("('上海')  "` 坑 1:`("上海")` 没有逗号,括号只是括号,值就是字符串 `"上海"` 本身。字符串也是序列,SQLite 把它当成「两个字符 `上`、`海`」,要填 2 个值,模板只有 1 个 `?`。实测 `ProgrammingError: Incorrect number of bindings supplied. The current statement uses 1, and there are 2 supplied.` 看到「there are 2 supplied」而你只传了一个值,先查是不是少了逗号。(如果你传的是一个 3 个字符的字符串,这里就会写 supplied 3。)
- `("上海",)` 正确写法,实测 2 行。
- `["上海"]` 列表也行,任何序列都接受。习惯上用元组。
- `try_run("2 个 ? 给 1 个值"` 坑 2:模板有两个 `?`,只给一个值,报同一类错,这次是 `The current statement uses 2, and there are 1 supplied.`
- `{"city": "上海", "plan": "专业版"}` 命名占位符:SQL 里写 `:city`、`:plan`,参数改传字典,按名字对应。参数多的时候比一堆 `?` 好认,而且同一个值要用两次时只传一次。实测 1 行(上海的专业版只有云杉律所)。
- `LIKE '%?%'` 坑 3 的错误写法:`?` 被包在引号里面,变成了字符串里的一个普通问号字符,不再是占位符。模板里 0 个占位符,却给了 1 个值,报 `The current statement uses 0, and there are 1 supplied.`
- `("%星河%",)` 正确做法:`%` 属于**值**,在 Python 里拼成 `"%星河%"` 再传,SQL 里只写 `LIKE ?`。实测找到 `(1, '星河餐饮')`。
- `try_run("表名用 ?   ", "SELECT * FROM ? WHERE id = 1", ("customers",))` 坑 4 之一:占位符只能代替**值**,不能代替表名或列名。实测 `OperationalError: near "?": syntax error`。
- `ORDER BY ? DESC LIMIT 3", ("amount",)` 坑 4 里最阴的一个:`ORDER BY ?` **不报错**,SQLite 把传进去的 `'amount'` 当成一个固定的字符串值,每一行都是同一个值,等于没排序。实测前三行是 `(1, 1188), (2, 1188), (3, 1188)`,明明按金额降序应该是 27860 起头。这是一个静悄悄的错。
- `ORDER BY amount DESC LIMIT 3` 对照:列名写死在 SQL 里,才是真的按金额排序,实测 `(9, 27860), (10, 27860), (6, 16915)`。
- `marks = ",".join("?" * len(ids))` 坑 5:`IN` 后面要放几个值不固定。`"?" * 3` 是 `"???"`(字符串乘法,Day 15),`",".join(...)` 把里面每个字符用逗号连起来,得到 `?,?,?`。
- `IN ({marks})` 这里**又用了 f-string**,但塞进去的只有程序自己造的一串 `?,?,?`,不含任何外部输入,所以是安全的;真正的值 `ids` 仍然走第二个参数。实测得到 1、3、5 号三家客户。

</div>

```bash
uv run python part01/placeholder_traps.py
```

```text
== 坑 1:参数忘了写成元组 ==
('上海')  : ProgrammingError: Incorrect number of bindings supplied. The current statement uses 1, and there are 2 supplied.
('上海',) : 2 行 [(2,), (8,)]
['上海']  : 2 行 [(2,), (8,)]
== 坑 2:个数对不上 ==
2 个 ? 给 1 个值: ProgrammingError: Incorrect number of bindings supplied. The current statement uses 2, and there are 1 supplied.
== 命名占位符 ==
:city 配字典: 1 行 [(8,)]
== 坑 3:LIKE 的百分号放哪 ==
% 写进 SQL 又加参数: ProgrammingError: Incorrect number of bindings supplied. The current statement uses 0, and there are 1 supplied.
% 拼在值里          : 1 行 [(1, '星河餐饮')]
== 坑 4:? 不能代替表名和列名 ==
表名用 ?   : OperationalError: near "?": syntax error
ORDER BY ? 传 'amount': [(1, 1188), (2, 1188), (3, 1188)] <- 不是按金额排的
ORDER BY amount 写死 : [(9, 27860), (10, 27860), (6, 16915)]
== 坑 5:IN 的个数不固定 ==
拼出来的占位符: ?,?,?
[(1, '星河餐饮'), (3, '远山物流'), (5, '启明科技')]
```

坑 4 引出一个真问题:**表名、列名、排序方向这些「结构」本来就要出现在 SQL 文本里,可用户(模型)又常常想自己选**,比如工具参数 `sort_by: "amount"`。`?` 帮不上,又不能直接拼。办法是**白名单**:代码里写死一张「允许的名字」表,只接受表里有的,拼进 SQL 的永远是你自己写的那个字符串,不是用户给的。下一步就这么做。

## 第 6 步:封装成一个安全的查询模块

把今天学的拼成一个可复用的文件,Day 94 的迷你账单库还会接着用它的写法。新建 `part01/invoice_queries.py`:

```python
# agent-zero-lab/part01/invoice_queries.py
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "sql" / "practice.db"

# 能排序的列:对外的名字 -> 真正的列名。名单写死在代码里,用户和模型只能从里面挑。
SORTABLE = {"id": "id", "amount": "amount", "issued": "issued_at"}
STATUSES = ("paid", "unpaid", "refunded")


def connect(path: Path = DB_PATH, read_only: bool = False) -> sqlite3.Connection:
    """开一个连接:外键必开;read_only=True 时数据库文件只读。"""
    if read_only:
        conn = sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)
    else:
        conn = sqlite3.connect(path)
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def find_customers(conn: sqlite3.Connection, city: str) -> list[tuple]:
    """按城市查客户,返回 (id, company, plan)。"""
    return conn.execute(
        "SELECT id, company, plan FROM customers WHERE city = ? ORDER BY id",
        (city,),
    ).fetchall()


def list_invoices(
    conn: sqlite3.Connection,
    customer_id: int,
    status: str | None = None,
    sort_by: str = "id",
    desc: bool = False,
) -> list[tuple]:
    """查一个客户的发票;状态可选;排序列只能来自 SORTABLE。"""
    if sort_by not in SORTABLE:
        raise ValueError(f"sort_by 只能是 {sorted(SORTABLE)},收到 {sort_by!r}")
    if status is not None and status not in STATUSES:
        raise ValueError(f"status 只能是 {STATUSES},收到 {status!r}")

    sql = "SELECT id, customer_id, amount, status, issued_at FROM invoices WHERE customer_id = ?"
    params: list[object] = [int(customer_id)]
    if status is not None:
        sql += " AND status = ?"
        params.append(status)
    sql += f" ORDER BY {SORTABLE[sort_by]} {'DESC' if desc else 'ASC'}"
    return conn.execute(sql, params).fetchall()
```

<div class="line-notes">

- `SORTABLE = {"id": "id", "amount": "amount", "issued": "issued_at"}` 白名单字典:键是「对外说的名字」,值是真正的列名。这里 `issued` 对应 `issued_at`,说明这张表可以和外部名字不同,模型只需要知道键。
- `STATUSES = ("paid", "unpaid", "refunded")` 状态的合法值,和 Day 91 的 `CHECK` 一致。程序里先挡一次,数据库约束是第二道门。
- `def connect(path: Path = DB_PATH, read_only: bool = False) -> sqlite3.Connection:` 自己的连接函数,所有查询都从它拿连接,保证每个连接都开外键。两个参数都有默认值(Day 29)。
- `"""开一个连接` 函数的文档字符串(docstring),编辑器悬停会显示。
- `conn = sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)` 只读连接。`path.as_uri()` 把路径变成 `file:///Users/你/...` 这样的 URI,后面接 `?mode=ro`(read only),再让 `connect` 用 `uri=True` 按 URI 解析。这样打开的连接只能读,写入会被拒绝。
- `conn = sqlite3.connect(path)` 普通连接,可读可写。
- `conn.execute("PRAGMA foreign_keys = ON")` Day 91 反复强调的一行:**连上后立刻执行**,第 7 步马上讲为什么必须立刻。
- `"SELECT id, company, plan FROM customers WHERE city = ? ORDER BY id",` 城市走 `?`,排序写死。
- `status: str | None = None,` 状态可选:不传就是 `None`(Day 46 的 `X | None`)。
- `if sort_by not in SORTABLE:` `in` 对字典检查的是**键**。`sort_by` 不在白名单里就 `raise ValueError`(Day 36)。错误信息写成「只能是 [...]」,是特意写给模型看的:Agent 收到这条报错,下一次就知道该传什么。
- `if status is not None and status not in STATUSES:` 状态不是 `None` 时,也要在合法值里。
- `sql = "SELECT id, customer_id, amount, status, issued_at FROM invoices WHERE customer_id = ?"` 基础查询,只含一个固定条件。
- `params: list[object] = [int(customer_id)]` 参数列表先放一个客户编号。`int(...)` 把传来的值转成整数:`"1"` 变成 1;`"1 OR 1=1"` 转不了,直接抛 `ValueError`,**在进入数据库之前就被拒绝**。
- `sql += " AND status = ?"` 条件是可选的,要才加。追加的是固定字符串,里面只有 `?`,没有外部值。
- `params.append(status)` 对应的值同步加进参数列表,两个列表始终要对齐:有几个 `?`,就有几个值。
- `sql += f" ORDER BY {SORTABLE[sort_by]} {'DESC' if desc else 'ASC'}"` 排序用 f-string 拼,但拼进去的只有**白名单查出来的列名**和程序自己选的 `DESC`/`ASC`,没有一个字符来自外部。
- `return conn.execute(sql, params).fetchall()` 执行。参数用列表传(列表也是序列)。

</div>

再写一个小脚本把它用一遍。新建 `part01/try_queries.py`(用 `-m` 方式运行,Day 33):

```python
# agent-zero-lab/part01/try_queries.py
import sqlite3

from part01.invoice_queries import connect, find_customers, list_invoices

conn = connect()
print(find_customers(conn, "上海"))
print(list_invoices(conn, 5))
print(list_invoices(conn, 1, status="unpaid"))
print(list_invoices(conn, 3, sort_by="amount", desc=True))

for label, call in [
    ("sort_by 注入", lambda: list_invoices(conn, 1, sort_by="amount; DROP TABLE invoices")),
    ("status 注入 ", lambda: list_invoices(conn, 1, status="' OR '1'='1")),
    ("id 注入     ", lambda: list_invoices(conn, "1 OR 1=1")),  # type: ignore[arg-type]
]:
    try:
        print(label, call())
    except ValueError as e:
        print(label, "ValueError:", e)

print("PRAGMA foreign_keys =", conn.execute("PRAGMA foreign_keys").fetchone())
conn.close()

ro = connect(read_only=True)
print("只读连接能查:", ro.execute("SELECT count(*) FROM invoices").fetchone())
try:
    ro.execute("DELETE FROM invoices WHERE id = 1")
except sqlite3.Error as e:
    print("只读连接写入:", type(e).__name__, e)
ro.close()
```

<div class="line-notes">

- `from part01.invoice_queries import connect, find_customers, list_invoices` 从刚写的模块导入三个函数。因为文件在 `part01/` 包里,要用 `uv run python -m part01.try_queries` 从项目根目录运行。
- `conn = connect()` 拿一个可写连接,外键已经开了。
- `print(list_invoices(conn, 5))` 5 号客户(启明科技)有 2 张发票,各 27860。
- `print(list_invoices(conn, 1, status="unpaid"))` 1 号客户只有 3 号发票是 unpaid。
- `print(list_invoices(conn, 3, sort_by="amount", desc=True))` `sort_by` 传的是对外的名字 `"amount"`,模块替你查表换成真列名。
- `for label, call in [` 三个攻击放进列表,每个是(标签, 一个无参函数)的元组;`lambda: ...` 把调用包起来,放进 `try` 里统一执行(Day 30 的 lambda,Day 24 的遍历)。
- `list_invoices(conn, 1, sort_by="amount; DROP TABLE invoices")` 想借排序参数塞命令。`?` 管不了排序,白名单管得了:不在名单里直接 `ValueError`。
- `status="' OR '1'='1"` 状态被攻击串替换,同样被合法值检查挡住。
- `list_invoices(conn, "1 OR 1=1")` 故意传一个字符串,违反了 `customer_id: int` 的类型标注,编辑器会画红线,这里用注释让它闭嘴,只为演示运行时的防线:`int("1 OR 1=1")` 抛 `ValueError: invalid literal for int() with base 10: '1 OR 1=1'`。
- `print("PRAGMA foreign_keys =", conn.execute("PRAGMA foreign_keys").fetchone())` 不带等号的 `PRAGMA` 是查询,验证外键确实开着:`(1,)`。
- `ro = connect(read_only=True)` 再开一个只读连接。
- `ro.execute("DELETE FROM invoices WHERE id = 1")` 在只读连接上删数据,会被拒绝:`OperationalError: attempt to write a readonly database`。表里 15 张发票一张没少。

</div>

```bash
uv run python -m part01.try_queries
sqlite3 part01/sql/practice.db "select count(*) from invoices"
```

```text
[(2, '青木设计', '基础版'), (8, '云杉律所', '专业版')]
[(9, 5, 27860, 'paid', '2026-08-01'), (10, 5, 27860, 'paid', '2026-09-01')]
[(3, 1, 1188, 'unpaid', '2026-09-01')]
[(6, 3, 16915, 'paid', '2026-08-01'), (7, 3, 16915, 'unpaid', '2026-09-01')]
sort_by 注入 ValueError: sort_by 只能是 ['amount', 'id', 'issued'],收到 'amount; DROP TABLE invoices'
status 注入  ValueError: status 只能是 ('paid', 'unpaid', 'refunded'),收到 "' OR '1'='1"
id 注入      ValueError: invalid literal for int() with base 10: '1 OR 1=1'
PRAGMA foreign_keys = (1,)
只读连接能查: (15,)
只读连接写入: OperationalError attempt to write a readonly database
15
```

攻击串的行为应该被固定下来,不能靠「我上次手动试过」。用 Day 71 到 73 学的 pytest 给它配几个测试,新建 `tests/test_invoice_queries.py`:

```python
# agent-zero-lab/tests/test_invoice_queries.py
import sqlite3
from pathlib import Path

import pytest

from part01.invoice_queries import connect, find_customers, list_invoices

SQL_DIR = Path(__file__).parent.parent / "part01" / "sql"


@pytest.fixture
def conn(tmp_path: Path):
    """每个用例一个临时数据库:10 家客户、15 张发票,用完就扔。"""
    db_file = tmp_path / "test.db"
    setup = sqlite3.connect(db_file)
    for name in ("customers.sql", "invoices.sql"):
        setup.executescript((SQL_DIR / name).read_text(encoding="utf-8"))
    setup.close()
    c = connect(db_file)
    yield c
    c.close()


def test_find_customers_normal(conn):
    assert find_customers(conn, "上海") == [(2, "青木设计", "基础版"), (8, "云杉律所", "专业版")]


def test_city_injection_returns_nothing(conn):
    assert find_customers(conn, "' OR '1'='1") == []


def test_list_invoices_by_status(conn):
    rows = list_invoices(conn, 1, status="unpaid")
    assert rows == [(3, 1, 1188, "unpaid", "2026-09-01")]


def test_sort_by_whitelist(conn):
    with pytest.raises(ValueError):
        list_invoices(conn, 1, sort_by="amount; DROP TABLE invoices")
    assert conn.execute("SELECT count(*) FROM invoices").fetchone() == (15,)


def test_customer_id_injection_rejected(conn):
    with pytest.raises(ValueError):
        list_invoices(conn, "1 OR 1=1")  # type: ignore[arg-type]
```

<div class="line-notes">

- `SQL_DIR = Path(__file__).parent.parent / "part01" / "sql"` 测试文件在 `tests/`,`.parent` 是 `tests/`,再 `.parent` 到项目根目录,然后走到 `part01/sql`。
- `@pytest.fixture` Day 73 的 fixture:每个用例需要什么数据,在参数里写这个函数的名字就拿到它。
- `def conn(tmp_path: Path):` 参数 `tmp_path` 是 pytest 自带的 fixture,给每个用例一个全新的临时目录。这样测试永远不碰真正的 `practice.db`。
- `setup.executescript((SQL_DIR / name).read_text(encoding="utf-8"))` 读出 `customers.sql` 和 `invoices.sql` 的文本,用 `executescript` 在临时库里建表灌数据(这是 `executescript` 该用的场合:脚本是自己写死的文件)。
- `c = connect(db_file)` 用自己的 `connect` 开连接,外键也开着,测的就是真实代码走的路径。
- `yield c` Day 73 的 `yield`:先把连接交给测试用,测试结束后回来执行下一行关闭。
- `assert find_customers(conn, "上海") ==` 正常查询的预期结果,元组列表可以直接用 `==` 比较。
- `assert find_customers(conn, "' OR '1'='1") == []` 攻击串的预期:一行都没有。以后谁把 `?` 改回 f-string,这条测试立刻变红。
- `with pytest.raises(ValueError):` 断言「这段代码一定抛 ValueError」,不抛就算测试失败。
- `assert conn.execute("SELECT count(*) FROM invoices").fetchone() == (15,)` 攻击被拒绝以后,表还完好,仍是 15 张。

</div>

```bash
uv run pytest -v
```

```text
tests/test_invoice_queries.py::test_find_customers_normal PASSED         [ 20%]
tests/test_invoice_queries.py::test_city_injection_returns_nothing PASSED [ 40%]
tests/test_invoice_queries.py::test_list_invoices_by_status PASSED       [ 60%]
tests/test_invoice_queries.py::test_sort_by_whitelist PASSED             [ 80%]
tests/test_invoice_queries.py::test_customer_id_injection_rejected PASSED [100%]

============================== 5 passed in 0.06s ===============================
```

把今天的防线按层数一下:值走 `?`(挡住注入);结构(列名、方向)走白名单;类型在进数据库前先转换;最后只读连接和 Day 91 的约束是数据库那边的兜底。**不要只靠一层**。做 Agent 的「问数」工具时,这是标准配置。

## 第 7 步:在 Python 里开外键,而且要早

Day 91 留了一句话:Python 的 `sqlite3` 默认也不开外键。验证一下,同时撞一个更隐蔽的坑。新建 `part01/fk_in_python.py`,用内存数据库(`:memory:`,程序结束就没了,最适合练手):

```python
# agent-zero-lab/part01/fk_in_python.py
import sqlite3

SCHEMA = """
CREATE TABLE customers (id INTEGER PRIMARY KEY, company TEXT NOT NULL);
CREATE TABLE invoices (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers (id),
    amount INTEGER NOT NULL
);
INSERT INTO customers VALUES (1, '星河餐饮');
"""


def new_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")  # 内存里的临时库,程序结束就没了
    conn.executescript(SCHEMA)
    return conn


print("== A. 什么都不做 ==")
conn = new_conn()
print("foreign_keys =", conn.execute("PRAGMA foreign_keys").fetchone())
conn.execute("INSERT INTO invoices VALUES (15, 11, 156)")
print("孤儿发票插进去了:", conn.execute("SELECT * FROM invoices").fetchall())
print("体检:", conn.execute("PRAGMA foreign_key_check").fetchall())
conn.close()

print("== B. 连上以后第一件事就打开 ==")
conn = new_conn()
conn.execute("PRAGMA foreign_keys = ON")
print("foreign_keys =", conn.execute("PRAGMA foreign_keys").fetchone())
try:
    conn.execute("INSERT INTO invoices VALUES (15, 11, 156)")
except sqlite3.IntegrityError as e:
    print("被拦下:", type(e).__name__, e)
conn.close()

print("== C. 先写了一条,再开 ==")
conn = new_conn()
conn.execute("INSERT INTO invoices VALUES (1, 1, 1188)")
print("in_transaction =", conn.in_transaction)
conn.execute("PRAGMA foreign_keys = ON")
print("foreign_keys =", conn.execute("PRAGMA foreign_keys").fetchone(), "<- 想开,没开上")
conn.execute("INSERT INTO invoices VALUES (15, 11, 156)")
print("孤儿又插进去了:", conn.execute("SELECT count(*) FROM invoices").fetchone())
conn.close()
```

<div class="line-notes">

- `SCHEMA = """` 三引号字符串可以跨多行,这里放一整段建表脚本:两张表,外键写在 `invoices.customer_id` 上,再插一个客户。
- `def new_conn() -> sqlite3.Connection:` 每个小实验开一个全新的内存库,互不干扰。
- `conn = sqlite3.connect(":memory:")` 特殊名字 `":memory:"` 代表不写磁盘、只放内存的临时库。
- `conn.executescript(SCHEMA)` `executescript` 一次执行**多条**语句(普通 `execute` 只许一条),脚本跑完里面的修改就生效了。它只该用来跑自己写死的建表脚本,**绝不能喂外部输入**。
- `print("foreign_keys =", conn.execute("PRAGMA foreign_keys").fetchone())` A 段:什么都不做,查开关,实测 `(0,)`,关着。
- `conn.execute("INSERT INTO invoices VALUES (15, 11, 156)")` 孤儿发票:客户 11 不存在。因为开关是关的,成功了。
- `conn.execute("PRAGMA foreign_key_check").fetchall()` 体检命令,返回 `[('invoices', 15, 'customers', 0)]`:`invoices` 表里行号 15 的记录,在父表 `customers` 里找不到对应的行。
- `conn.execute("PRAGMA foreign_keys = ON")` B 段:连接刚建好、表也刚建好(`executescript` 已经执行完,没有未完成的事务),马上打开。再查,`(1,)`。
- `except sqlite3.IntegrityError as e:` 违反约束(唯一、外键、检查……)在 Python 里都是 `sqlite3.IntegrityError`。实测消息:`FOREIGN KEY constraint failed`,和命令行一样。
- `conn.execute("INSERT INTO invoices VALUES (1, 1, 1188)")` C 段先写入一条合法的发票。Python 的 `sqlite3` 默认在第一条 `INSERT`/`UPDATE`/`DELETE` 时**自动开一个事务,而且不会自动提交**。
- `print("in_transaction =", conn.in_transaction)` `conn.in_transaction` 回答「现在有没有一个没结束的事务」,实测 `True`。
- `conn.execute("PRAGMA foreign_keys = ON")` 在事务里执行开关。SQLite 的规定是:**事务进行中,这条 `PRAGMA` 不起作用,也不报错**。
- `想开,没开上` 实测还是 `(0,)`,静悄悄地没生效。
- `print("孤儿又插进去了:"` 孤儿再次成功,现在表里有 2 行。如果你的代码先写了点什么再去 `PRAGMA`,保护就是假的。

</div>

```bash
uv run python part01/fk_in_python.py
```

```text
== A. 什么都不做 ==
foreign_keys = (0,)
孤儿发票插进去了: [(15, 11, 156)]
体检: [('invoices', 15, 'customers', 0)]
== B. 连上以后第一件事就打开 ==
foreign_keys = (1,)
被拦下: IntegrityError FOREIGN KEY constraint failed
== C. 先写了一条,再开 ==
in_transaction = True
foreign_keys = (0,) <- 想开,没开上
孤儿又插进去了: (2,)
```

所以第 6 步的 `connect()` 把 `PRAGMA foreign_keys = ON` 放在**建好连接的下一行**,不是随手放在用到之前。以后所有的连接都从这个函数拿,就不会忘。「事务」和「提交」是什么、`in_transaction` 为什么是 `True`,明天(Day 93)专门讲。

## 动手练习

先重建数据库(第 0 步的四行命令)。每道题都在 `part01/` 下新建文件,用 `uv run python -m part01.文件名` 运行(不带 `.py`)。

**练习 1:两个条件的查询。** 写 `customers_by_plan(conn, plan, min_seats)`,查某个套餐、席位数不少于 `min_seats` 的客户,返回 `(id, company, seats)`,按席位数从多到少排。试 `("专业版", 10)`、`("基础版", 5)`、`("旗舰版", 1)` 三组。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex92_1_plan_seats.py
import sqlite3

from part01.invoice_queries import connect


def customers_by_plan(conn: sqlite3.Connection, plan: str, min_seats: int) -> list[tuple]:
    """某个套餐、席位数不少于 min_seats 的客户,返回 (id, company, seats)。"""
    return conn.execute(
        "SELECT id, company, seats FROM customers WHERE plan = ? AND seats >= ? ORDER BY seats DESC",
        (plan, min_seats),
    ).fetchall()


conn = connect()
print(customers_by_plan(conn, "专业版", 10))
print(customers_by_plan(conn, "基础版", 5))
print(customers_by_plan(conn, "旗舰版", 1))
conn.close()
```

<div class="line-notes">

- `from part01.invoice_queries import connect` 复用第 6 步的连接函数,外键自动开好。
- `WHERE plan = ? AND seats >= ? ORDER BY seats DESC` 两个条件,两个 `?`,按出现的先后对应参数里的两个值。`ORDER BY seats DESC` 写死,不是外部输入。
- `(plan, min_seats),` 参数元组里的顺序要和 `?` 的顺序一致:先套餐、后席位数。写反了,SQLite 不会报错,只会拿 `10` 去和 `plan` 比,查出 0 行。
- `print(customers_by_plan(conn, "专业版", 10))` 专业版有 4、8、1、9 号,席位 20、18、12、9,9 号只有 9 个席位被 `>= 10` 筛掉。
- `print(customers_by_plan(conn, "基础版", 5))` 基础版里只有 6 号禾丰农业有 5 席,正好 `>= 5` 成立。
- `print(customers_by_plan(conn, "旗舰版", 1))` 没有「旗舰版」这个套餐,返回空列表而不是报错。

</div>

```text
[(4, '蓝鲸教育', 20), (8, '云杉律所', 18), (1, '星河餐饮', 12)]
[(6, '禾丰农业', 5)]
[]
```

</details>

**练习 2:四种拼接写法,哪些有注入?** 下面四个函数都是「按城市查客户 id」:一个用 `%` 格式化,一个用 `+` 拼接,一个用 `.format`,一个用 `?`。用攻击串 `' OR '1'='1` 各试一次,看谁返回的行数不对。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex92_2_four_styles.py
import sqlite3

from part01.invoice_queries import connect


def by_percent(conn: sqlite3.Connection, city: str) -> list[tuple]:
    return conn.execute("SELECT id FROM customers WHERE city = '%s'" % city).fetchall()


def by_plus(conn: sqlite3.Connection, city: str) -> list[tuple]:
    return conn.execute("SELECT id FROM customers WHERE city = '" + city + "'").fetchall()


def by_format(conn: sqlite3.Connection, city: str) -> list[tuple]:
    return conn.execute("SELECT id FROM customers WHERE city = '{}'".format(city)).fetchall()


def by_placeholder(conn: sqlite3.Connection, city: str) -> list[tuple]:
    return conn.execute("SELECT id FROM customers WHERE city = ?", (city,)).fetchall()


ATTACK = "' OR '1'='1"
conn = connect()
for fn in (by_percent, by_plus, by_format, by_placeholder):
    print(f"{fn.__name__:15} 上海 -> {len(fn(conn, '上海'))} 行;攻击串 -> {len(fn(conn, ATTACK))} 行")
conn.close()
```

<div class="line-notes">

- `"SELECT id FROM customers WHERE city = '%s'" % city` Python 老式的格式化:`%s` 被 `city` 的内容原样替换。本质和 f-string 一样,都是**字符串拼接**,和 SQL 里的 `%`(LIKE 通配符)毫无关系。
- `+ city +` 用加号把三段字符串连起来,同样是拼接。
- `.format(city)` `.format` 把 `{}` 换成 `city`,拼接的第三种长相。
- `"SELECT id FROM customers WHERE city = ?", (city,)` 只有这个是占位符。
- `ATTACK = "' OR '1'='1"` 同一个攻击串,四次共用。
- `for fn in (by_percent, by_plus, by_format, by_placeholder):` 函数也是对象,可以放进元组里遍历(Day 28)。
- `{fn.__name__:15}` `__name__` 是函数的名字,冒号后的 `15` 是按 15 个字符宽左对齐,让输出整齐。后半 `len(fn(conn, ATTACK))` 对每个函数各调用一次,数返回行数。实测前三个都是 10 行(全表),只有占位符那个是 0 行。

</div>

```text
by_percent      上海 -> 2 行;攻击串 -> 10 行
by_plus         上海 -> 2 行;攻击串 -> 10 行
by_format       上海 -> 2 行;攻击串 -> 10 行
by_placeholder  上海 -> 2 行;攻击串 -> 0 行
```

结论:凡是**先拼成完整字符串,再交给 `execute`** 的写法,不管用 f-string、`%`、`+` 还是 `.format`,都有注入。判断标准不是看用了哪个符号,而是看 `execute` 收到的第一个参数里,有没有外部来的内容。

</details>

**练习 3:模糊搜索,以及搜 `%` 会怎样。** 写 `search_company(conn, keyword)`,用 `LIKE` 找公司名包含关键词的客户。先写最直接的版本,试关键词 `星河`、`%`、`_`、`星_`;发现问题后,想办法让 `%` 和 `_` 按字面意思匹配。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex92_3_like.py
import sqlite3

from part01.invoice_queries import connect


def search_company_naive(conn: sqlite3.Connection, keyword: str) -> list[tuple]:
    return conn.execute(
        "SELECT id, company FROM customers WHERE company LIKE ?", (f"%{keyword}%",)
    ).fetchall()


def escape_like(text: str) -> str:
    """让 \\ % _ 失去通配符的含义,按字面匹配。反斜杠要最先处理。"""
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def search_company(conn: sqlite3.Connection, keyword: str) -> list[tuple]:
    return conn.execute(
        "SELECT id, company FROM customers WHERE company LIKE ? ESCAPE '\\'",
        (f"%{escape_like(keyword)}%",),
    ).fetchall()


conn = connect()
for kw in ("星河", "%", "_", "星_"):
    print(f"{kw!r:6} naive -> {len(search_company_naive(conn, kw)):2} 行   escape -> {len(search_company(conn, kw)):2} 行")
conn.close()
```

<div class="line-notes">

- `(f"%{keyword}%",)` 朴素版:`keyword` 本身走参数,没有 SQL 注入;`%` 是在 Python 里拼进值里的,第 5 步坑 3 的正确做法。但 `keyword` 里如果带 `%` 或 `_`,它们在 `LIKE` 里是**通配符**(`%` 任意多个字符,`_` 任意一个字符),照样起作用。
- `def escape_like(text: str) -> str:` 把关键词里的三个特殊字符各加一个反斜杠转义。
- `text.replace("\\", "\\\\")` 先把反斜杠本身变成两个;同一行后面两个 `.replace` 依次把 `%` 变成 `\%`、`_` 变成 `\_`。`"\\"` 在 Python 里是**一个**反斜杠字符(反斜杠自己要转义),这一步必须最先做,否则后面加进去的反斜杠会被它重复处理。
- `ESCAPE '\\'` SQLite 的 `LIKE` 默认**没有**转义字符,要用 `ESCAPE` 子句声明哪个字符是转义符。这里声明反斜杠(Python 字符串里写 `'\\'`,SQL 收到的是 `'\'`)。这是 SQL 文本里写死的固定部分,不是外部输入。
- `(f"%{escape_like(keyword)}%",)` 先转义,再在两头加上真正想要的通配符 `%`。
- `for kw in ("星河", "%", "_", "星_"):` 四组关键词。实测朴素版:`星河` 命中 1 家,`%` 和 `_` 都命中 **10 家**(整张表),`星_` 命中 1 家(星河餐饮,因为 `_` 被当成任意一个字符)。转义版:`星河` 1 家,其余三个都是 0(公司名里确实没有叫 `%`、`_`、`星_` 的)。
- `{kw!r:6}` `!r` 是用 `repr` 的形式显示(带引号),`:6` 宽度 6。

</div>

```text
'星河'   naive ->  1 行   escape ->  1 行
'%'    naive -> 10 行   escape ->  0 行
'_'    naive -> 10 行   escape ->  0 行
'星_'   naive ->  1 行   escape ->  0 行
```

朴素版没有 SQL 注入,但搜 `%` 能把整张表翻出来,这是**通配符注入**。对账单表来说多数时候无伤大雅,可如果 Agent 的搜索工具返回的是不该被批量翻出的数据(比如客户邮箱),就值得转义。

</details>

**练习 4:只读连接挡得住什么、挡不住什么。** 用 `connect(read_only=True)` 依次执行五条语句:`SELECT count(*)`、`DELETE`、`DROP TABLE`、`UPDATE`、`SELECT email, contact FROM customers WHERE id = 1`。观察哪些被拒绝,并想一想它对 Agent 的意义。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex92_4_readonly.py
import sqlite3

from part01.invoice_queries import connect

ro = connect(read_only=True)
statements = [
    "SELECT count(*) FROM invoices",
    "DELETE FROM invoices WHERE id = 1",
    "DROP TABLE invoices",
    "UPDATE customers SET seats = 999 WHERE id = 1",
    "SELECT email, contact FROM customers WHERE id = 1",
]
for sql in statements:
    try:
        print("OK  ", sql, "->", ro.execute(sql).fetchall())
    except sqlite3.Error as e:
        print("拒绝", sql, "->", type(e).__name__, e)
ro.close()
```

<div class="line-notes">

- `ro = connect(read_only=True)` 用第 6 步的函数开只读连接。
- `statements = [` 五条 SQL 放进列表,依次试,都是写死的,用来观察数据库的反应:一条查数、三条写操作、一条读邮箱和联系人。
- `print("OK  ", sql` 成功就打印结果。`DELETE` 这类语句成功执行时返回空列表。
- `except sqlite3.Error as e:` 被拒绝就打印错误类名和消息。实测三条写操作都是 `OperationalError attempt to write a readonly database`。 最后一条读邮箱的语句照常成功,拿到 `[('wangwei@xinghe.example', '王伟')]`。

</div>

```text
OK   SELECT count(*) FROM invoices -> [(15,)]
拒绝 DELETE FROM invoices WHERE id = 1 -> OperationalError attempt to write a readonly database
拒绝 DROP TABLE invoices -> OperationalError attempt to write a readonly database
拒绝 UPDATE customers SET seats = 999 WHERE id = 1 -> OperationalError attempt to write a readonly database
OK   SELECT email, contact FROM customers WHERE id = 1 -> [('wangwei@xinghe.example', '王伟')]
```

只读连接挡住所有**写**(改、删、删表),Agent 即使被攻击或者模型自己发疯,也毁不掉数据。但它挡不住**读**:邮箱、联系人照样查得出来。所以只读不能代替参数化,也不能代替「这个 Agent 该看哪些列」的权限设计,两者要一起用。

</details>

**练习 5:`IN` 查询和空列表。** 写 `invoices_of_many(conn, ids)`,查一批客户各有几张发票、金额合计多少,按客户编号排序。要求用 `?` 占位符,并处理 `ids` 是空列表的情况。试 `[1, 3, 6]`、`[]`、`[11]`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex92_5_in_list.py
import sqlite3

from part01.invoice_queries import connect


def invoices_of_many(conn: sqlite3.Connection, ids: list[int]) -> list[tuple]:
    """若干个客户的发票总数和金额合计,按客户分组。"""
    if not ids:
        return []
    marks = ",".join("?" * len(ids))
    sql = (
        "SELECT customer_id, count(*), sum(amount) FROM invoices "
        f"WHERE customer_id IN ({marks}) GROUP BY customer_id ORDER BY customer_id"
    )
    return conn.execute(sql, ids).fetchall()


conn = connect()
print(invoices_of_many(conn, [1, 3, 6]))
print(invoices_of_many(conn, []))
print(invoices_of_many(conn, [11]))
conn.close()
```

<div class="line-notes">

- `if not ids:` 空列表直接返回空结果。SQLite 其实允许 `IN ()`,但 Postgres 不允许(语法错误),养成「先判断空」的习惯,换库也不出事。
- `marks = ",".join("?" * len(ids))` 有几个编号就生成几个 `?`:`[1, 3, 6]` 生成 `?,?,?`。
- `"SELECT customer_id, count(*), sum(amount) FROM invoices "` SQL 太长就拆成两个相邻的字符串,Python 会自动把它们连成一个;括号让多行写法合法。
- `f"WHERE customer_id IN ({marks}) GROUP BY customer_id ORDER BY customer_id"` f-string 里只塞程序自己生成的 `?,?,?`,不含外部输入。
- `return conn.execute(sql, ids).fetchall()` 值 `ids` 走第二个参数。个数一定对得上,因为 `marks` 就是按 `len(ids)` 生成的。
- `print(invoices_of_many(conn, [1, 3, 6]))` 1 号 3 张共 3564,3 号 2 张共 33830,6 号没有发票,不会出现在结果里:`[(1, 3, 3564), (3, 2, 33830)]`。
- `print(invoices_of_many(conn, [11]))` 11 号客户在 `customers` 表里不存在,可是孤儿发票里有他的记录,所以查得到 `(11, 1, 156)`。再次提醒:孤儿发票是脏数据,Day 94 的迷你账单库会用外键杜绝它。

</div>

```text
[(1, 3, 3564), (3, 2, 33830)]
[]
[(11, 1, 156)]
```

</details>

验收标准:五道题都在自己终端里跑通;能不看文章写出「连库 → 带 `?` 的查询 → `fetchall`」;能说出 f-string 拼 SQL 为什么会被注入,并写出让 `' OR '1'='1` 失效的版本;能说出占位符管不到的东西是什么,以及要怎么处理。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| `sqlite3` 模块 | Python 标准库里连接 SQLite 的模块,不用 `uv add`,`import sqlite3` 即可 |
| 连接(connection) | `sqlite3.connect(...)` 返回的对象,代表和一个数据库文件的联系,用完要 `close()` |
| 游标(cursor) | `execute` 的返回值,指向查询结果的指针,取过的行不会再来 |
| `fetchone` / `fetchall` | 从游标取一行(没有时 `None`)/ 取所有剩下的行(没有时 `[]`) |
| 元组形式的行 | 默认情况下每一行结果是一个元组,没有列名,按位置取 |
| SQL 注入(SQL injection) | 外部输入里的内容被数据库当成了 SQL 命令的一部分,让查询做了你没打算让它做的事 |
| 参数化查询(parameterized query) | SQL 模板里用占位符,值单独传,数据库把值只当数据 |
| 占位符 `?` | SQLite 里表示「这里放一个值」的符号;Postgres 常用 `$1`,别的驱动用 `%s` |
| 命名占位符 | 写成 `:名字`,参数用字典传,按名字对应 |
| 白名单(allowlist) | 只接受事先列好的几个合法值,别的一律拒绝;用来处理表名、列名、排序方向这些 `?` 管不到的地方 |
| `UNION` | 把两条 `SELECT` 的结果竖着拼起来,注入里常被用来读别的表 |
| `executescript` | 一次执行多条 SQL 的方法,只能用于自己写死的脚本 |
| `:memory:` | 特殊的数据库名,只存在于内存,程序结束就没了,适合练手和测试 |
| `sqlite3.IntegrityError` | 违反约束(唯一、外键、检查、非空)时抛出的错误类 |
| 只读连接(`mode=ro`) | 打开数据库文件时声明只读,所有写入都会被拒绝 |
| `PRAGMA foreign_key_check` | 体检命令,列出所有违反外键的行 |
| `in_transaction` | 连接的属性,`True` 表示现在有一个没提交的事务 |
| 文档字符串(docstring) | 函数第一行的三引号字符串,编辑器悬停会显示,用来说明函数干什么 |

## 常见误区

**以为 f-string 拼 SQL「只是写起来方便」。** 实测 `' OR '1'='1` 让只查上海的查询返回了整张表 10 行,`1 OR 1=1` 让只查 1 号客户的发票返回了全部 15 张,`UNION` 把客户邮箱拖了出来。拼接的写法不管用 f-string、`%`、`+` 还是 `.format`,本质一样。

**把 `("上海")` 当成元组。** 没有逗号就只是加了括号的字符串,报 `Incorrect number of bindings supplied ... there are 2 supplied`。元素个数异常对不上,先数逗号。

**把 `?` 写进引号里。** `LIKE '%?%'` 里的问号是普通字符,不是占位符,报 `The current statement uses 0`。`%` 属于值,在 Python 里拼好再传。

**用 `?` 传表名、列名、排序方向。** 表名直接 `syntax error`;`ORDER BY ?` 更糟,不报错,但按一个固定字符串排,等于没排序(实测拿到的是 1188 起头而不是 27860)。这些要用白名单。

**以为 `sqlite3.connect` 找不到文件会报错。** 它会新建一个 0 字节的空库,随后才报 `no such table`。路径拼错时,先看有没有凭空多出来的空文件。

**游标读完还想再读。** `fetchall()` 取过的行不会再来,第二次是 `[]`。要重来就重新 `execute`。

**对 `fetchone()` 的结果直接取 `[0]`。** 没有结果时它是 `None`,`None[0]` 会报 `TypeError`。先判断 `is None`。

**先写数据再开外键。** 事务进行中 `PRAGMA foreign_keys = ON` 静悄悄地不生效(实测仍是 0,孤儿又插进去了)。连接一建好就开,放进 `connect()` 里。

**以为只读连接就等于安全。** 实测只读连接挡住了 DELETE、DROP、UPDATE,但邮箱照样读得到。它是兜底,不是权限设计。

## 学习资料

### 文档与文章

- [Python 官方文档 · sqlite3(英文,有中文版)](https://docs.python.org/3/library/sqlite3.html):标准库的完整说明。今天用到的 `connect`、`execute`、占位符、`set_trace_callback` 都在里面;「How to use placeholders to bind values in SQL queries」一节就是今天第 4、5 步的官方版本。
- [OWASP · SQL Injection Prevention Cheat Sheet(英文)](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html):业界最常引用的防注入指南,第一条就是参数化查询,也讲了白名单和最小权限。
- [SQLite 官方 · URI 文件名(英文)](https://www.sqlite.org/uri.html):`file:...?mode=ro` 这类写法的出处。
- [xkcd 327 · Exploits of a Mom](https://xkcd.com/327/):一格漫画把 SQL 注入讲完,传说中的「小表 Bobby Tables」。
- [菜鸟教程 · Python SQLite](https://www.runoob.com/sqlite/sqlite-python.html):中文,代码示例直接,对照今天第 1、2 步。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1LW4y1S7L1&autoplay=0&high_quality=1" title="使用python操作sqlite数据库" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>太阳照常升起233 · 使用python操作sqlite数据库 · 约 12 分钟,播放 3.7 万,2022 年发布。从 `connect` 到 `execute`、取结果走一遍,对应今天第 1、2 步。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1bH3azmEwU&autoplay=0&high_quality=1" title="SQL 注入到底怎么防?这几种写法必须掌握!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IT微工场 · SQL 注入到底怎么防?这几种写法必须掌握! · 约 7 分钟,播放 3 千,2025 年发布。讲防注入的几种写法,示例语言和今天不同,看思路,对应第 3、4 步。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/ciNHn38EyRc" title="Running an SQL Injection Attack - Computerphile" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Computerphile · Running an SQL Injection Attack · 英文,可开字幕。现场演示一次注入,和今天第 3 步的现象一一对得上。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/pd-0G0MigUA" title="Python SQLite Tutorial: Complete Overview - Creating a Database, Table, and Running Queries" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python SQLite Tutorial: Complete Overview · 英文,可开字幕。从建库到查询一条龙,今天和明天的内容都有,可以先看前半。</figcaption>
</figure>

### 书籍

- Al Sweigart,《Automate the Boring Stuff with Python》(第 2 版,No Starch Press,2019)。作者在网上免费放出全文,中文版《Python编程快速上手:让繁琐工作自动化》(人民邮电出版社)。这本书偏办公自动化,没有专门讲 SQLite,今天用不上,列出来只是给想系统补 Python 基础的人。想看数据库那一块,以官方文档为准。

### 开源项目与代码

- [CPython · `Modules/_sqlite`](https://github.com/python/cpython/tree/main/Modules/_sqlite):`sqlite3` 模块自己的 C 源码,今天不用读。想知道 `execute` 里面大致怎么走,可以在 `cursor.c` 里搜 `_pysqlite_query_execute`,`execute` 和 `executemany` 最后都落在这个函数上。

## 自测

1. `cur = conn.execute("SELECT id FROM customers")`,连续调用两次 `cur.fetchall()`,第二次得到什么?为什么?

<details><summary>答案</summary>

空列表 `[]`。游标是一个读到末尾的指针,第一次 `fetchall()` 已经把所有行取走,没有剩下的了。要再读一遍,需要重新 `execute`。

</details>

2. 下面哪一行有 SQL 注入风险?怎么改?

```python
a = conn.execute(f"SELECT * FROM invoices WHERE status = '{status}'")
b = conn.execute("SELECT * FROM invoices WHERE status = ?", (status,))
```

<details><summary>答案</summary>

`a` 有。f-string 把 `status` 的内容直接拼进了 SQL 文本,`status` 若是 `' OR '1'='1`,条件对每一行成立。`b` 没有:SQL 模板里只有 `?`,值走第二个参数。改法就是把 `a` 写成 `b` 的样子。

</details>

3. `conn.execute("SELECT * FROM customers WHERE city = ?", ("上海"))` 报 `Incorrect number of bindings supplied. The current statement uses 1, and there are 2 supplied.`,为什么是 2?怎么改?

<details><summary>答案</summary>

`("上海")` 没有逗号,括号里就是字符串 `"上海"`,字符串是序列,SQLite 把它拆成两个字符(`上`、`海`)当成两个值。改成 `("上海",)` 或者 `["上海"]`。

</details>

4. 工具参数 `sort_by` 由模型传入,你想让它决定按金额还是按日期排序。为什么不能写成 `ORDER BY ?`,应该怎么做?

<details><summary>答案</summary>

`?` 只能代替值,不能代替列名。`ORDER BY ?` 传 `"amount"` 时不报错,但 `'amount'` 被当成一个固定字符串,每行都一样,结果等于没排序。做法是写一个白名单字典,比如 `{"amount": "amount", "issued": "issued_at"}`,检查 `sort_by` 在字典里,再把字典里查出来的列名拼进 SQL;不在字典里就抛 `ValueError`,并把合法值写进错误信息让模型能改正。

</details>

5. 面试题:你的 Agent 有个工具 `get_invoices(customer_id)`,模型生成参数后交给后端执行 SQL。请说出至少三层防护,各防什么。

<details><summary>答案</summary>

①参数化查询,值走 `?`,防注入,让用户和模型给的任何字符串都只是数据;②入参校验,把 `customer_id` 转成整数、`status` 对照合法值表,不合格在进数据库前就报错,并把报错写成模型能读懂的话;③结构名走白名单(排序列、方向),因为占位符管不到;④数据库连接用只读账号(SQLite 里用 `mode=ro`,Postgres 里用只读角色),即使前面都失守也毁不掉数据;⑤工具层再做权限过滤,让查询只能看当前用户的客户,别只靠 SQL 里写的条件。每一层单独都可能漏,叠起来才稳。

</details>

6. 面试题:有同事说「我们的查询参数都做了转义,不用占位符也一样安全」。你怎么回应?

<details><summary>答案</summary>

自己写转义规则很容易漏:引号、反斜杠、字符编码、不同数据库的转义差别、数字列根本不加引号(`customer_id = 1 OR 1=1` 不需要任何引号)。占位符把「模板」和「值」分两条路走,数据库先读懂语句结构,值再作为数据填进去,从机制上就没有「值被当成命令」的路径,而不是靠检查字符串里有没有危险字符。所以优先用占位符;占位符覆盖不到的地方(表名、列名)用白名单,不要自己写转义。

</details>

## 明天预告

Day 93 · Python 操作 SQLite(二):事务、row_factory 和上下文管理器。今天你只做了读(`SELECT`),而且遇到一个没讲透的现象:`conn.in_transaction` 在你写了一条 `INSERT` 之后变成了 `True`,`PRAGMA` 也因此没生效。明天讲写:Python 的 `sqlite3` 什么时候自动开事务、为什么你不 `commit` 数据就不会真的存进去;用 Day 91 的扣款例子写一次 `commit` 和 `rollback`;让查询结果带上列名(`row_factory`);再把「开连接、提交或回滚、关连接」封装成一个 `with` 能用的 `db()`,以后每一章都复用它。
