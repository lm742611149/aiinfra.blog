---
title: 'Day 94 · 小项目:CloudLedger 迷你账单库'
description: '把 Day 85 到 93 学的 SQL 和 Python 拼成一个能一直用下去的小项目:带约束地建客户和发票两张表,把 practice.db 里的 15 张发票搬进来(15 号孤儿单独存档),按月自动开票且重复运行不会重复开,再配上月度汇总、欠款排行、自检和 27 个测试。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'sqlite', 'project', 'database', 'agent-zero']
series: 'agent-zero'
day: 94
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 93](/blog/agent-zero/day-093-python-sqlite-2/) 学了 Python 里事务的几条规则:写了不 `commit` 就不算数;捕获了异常却照样提交,会把残局存进库(余额 1812 变成 624);`with conn:` 管提交和回滚、不管关闭;`row_factory = sqlite3.Row` 让每一行带上列名;最后把「开连接、成功提交、出错回滚、一定关闭」封进了 `part01/db.py` 的 `with db() as conn:`。再往前,[Day 92](/blog/agent-zero/day-092-python-sqlite-1/) 学了 `?` 占位符防注入。

今天不学新概念。做一个项目,把 Day 85 到 93 的零件装成一个能一直用下去的小工具:**CloudLedger 迷你账单库**。CloudLedger(云簿)是这门课虚构的 SaaS 公司,卖按席位收费的在线记账软件;前面几天的 10 家客户、15 张发票就是它的数据。第五部分做 MCP 服务时,那个服务背后的数据库,就是今天这个项目长大以后的样子。

## 今天要解决的问题

学完今天,你应该能做到:

1. 用 Python 从零建 `customers`、`invoices` 两张带约束的表,说清每一条约束在挡什么,包括一条今天新出现的**联合唯一**(`UNIQUE (customer_id, issued_at)`:同一个客户同一天只能有一张发票)。
2. 把 Day 85 到 87 的 `practice.db` 搬进新库:14 张配得上客户的发票进 `invoices`,15 号孤儿发票进 `invoices_orphans` 存档,并核对「新库 + 孤儿档案 = 旧库」总额对得上(99861 + 156 = 100017)。
3. 写 `bill_month`:按「席位数 × 套餐单价」给每个客户开月度发票,重复运行不会重复开,中途出错整批撤回。
4. 写一组查询(客户发票、月度汇总、欠款排行、库的自检)、一个命令行入口 `python -m part01.ledger`,再配上 27 个测试(今天新增的 17 个加 Day 92、93 的 10 个)。

这是项目日,没有新概念,预计用时 4 小时。花费 ¥0,不调 API。

前置:[Day 85](/blog/agent-zero/day-085-sql-1/) 到 [Day 91](/blog/agent-zero/day-091-sql-6/) 的 SQL(尤其是 `JOIN`、`GROUP BY`、约束、事务);[Day 92](/blog/agent-zero/day-092-python-sqlite-1/)、[Day 93](/blog/agent-zero/day-093-python-sqlite-2/) 的 `sqlite3`、占位符、`db()`;[Day 33](/blog/agent-zero/day-033-packages/) 的包和 `-m`;[Day 44](/blog/agent-zero/day-044-notebook-project/) 的 `sys.argv`;[Day 73](/blog/agent-zero/day-073-pytest-3/)、[Day 74](/blog/agent-zero/day-074-pytest-4/) 的 fixture、`parametrize`、`monkeypatch`。

学法:项目日稍微变一下。先读「先想清楚」,**合上文章自己试着写 `schema.py`**(想不起来再看),然后每一步先对照敲一遍并跑通;第二天合上文章,默写 `bill_month`;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先想清楚:这个账单库要做什么

先把需求写成人话,再决定谁来管:

- 有**客户**(`customers`):公司名、联系人、邮箱、套餐、席位数、城市、注册日期。
- 有**发票**(`invoices`):属于某个客户,有金额、状态(`paid` 已付 / `unpaid` 未付 / `refunded` 已退款)、开票日期。
- 每个月 1 号,给每个客户开一张发票:**金额 = 席位数 × 套餐单价**(基础版 39、专业版 99、企业版 199,单位是每席位每月的元)。比如星河餐饮专业版 12 席位,12 × 99 = 1188,和前几天看到的 1188 完全吻合。
- 旧数据在 Day 85 到 87 的 `practice.db` 里,有一张**孤儿发票**(15 号,客户 11 不存在)。新库的外键不会让它进来,但也不能直接丢掉,要存档,以后有人问起「那 156 元去哪了」有地方查。
- 要能看:某个客户的所有发票;每月每种状态各有几张、多少钱;谁欠钱最多;库本身有没有问题。

几个设计决定,先说清楚理由:

- **金额用整数(元)**,不用小数。Day 12 看过 `0.1 + 0.2` 的浮点误差,钱不能有这个。真实系统通常用「分」,这里为了和前几天的数字对上,用元。
- **日期用文本 `YYYY-MM-DD`**。SQLite 没有专门的日期类型,但这种写法按字符串排序就是按时间排序,按月份截取(`substr(issued_at, 1, 7)`)也方便。
- **「同一个客户同一天只能有一张发票」写成数据库约束**,而不是只靠程序检查。第 4 步和练习 5 都会看到这条约束救命。
- **两张主表有约束,孤儿档案表故意没有**:它存的就是「不合规」的东西。

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="数据流:旧库 practice.db 经 seed.py 的 build 搬进新库 ledger.db,新库里有 customers、invoices、invoices_orphans 三张表;bill_month 往 invoices 里开新发票;queries.py 和命令行从 ledger.db 读数据出报表;tests 用临时库验证这一切">
<rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="30" width="140" height="64" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="90" y="56" fill="var(--ink)" text-anchor="middle">practice.db</text>
<text x="90" y="76" fill="var(--ink-soft)" text-anchor="middle" font-size="11">10 客户 · 15 发票</text>
<rect x="250" y="20" width="370" height="150" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="266" y="40" fill="var(--ink)">ledger.db(新库,带约束)</text>
<rect x="266" y="52" width="100" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="316" y="72" fill="var(--ink)" text-anchor="middle">customers</text>
<text x="316" y="88" fill="var(--ink-soft)" text-anchor="middle" font-size="11">10 行</text>
<rect x="378" y="52" width="110" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="433" y="72" fill="var(--ink)" text-anchor="middle">invoices</text>
<text x="433" y="88" fill="var(--ink-soft)" text-anchor="middle" font-size="11">14 行 + 每月新开</text>
<rect x="500" y="52" width="110" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="555" y="72" fill="var(--ink)" text-anchor="middle">orphans</text>
<text x="555" y="88" fill="var(--ink-soft)" text-anchor="middle" font-size="11">1 行(15 号)</text>
<text x="266" y="124" fill="var(--ink-soft)" font-size="11">invoices.customer_id → customers.id (外键)</text>
<text x="266" y="142" fill="var(--ink-soft)" font-size="11">UNIQUE (customer_id, issued_at):每客户每天一张</text>
<text x="266" y="160" fill="var(--ink-faint)" font-size="11">orphans 没有约束,存的就是不合规的</text>
<line x1="160" y1="62" x2="250" y2="62" stroke="var(--rule)"/>
<text x="205" y="54" fill="var(--ink-faint)" text-anchor="middle" font-size="11">seed.build</text>
<rect x="20" y="210" width="130" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="85" y="230" fill="var(--ink)" text-anchor="middle">bill_month</text>
<text x="85" y="246" fill="var(--ink-soft)" text-anchor="middle" font-size="11">按月开票</text>
<rect x="190" y="210" width="130" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="255" y="230" fill="var(--ink)" text-anchor="middle">queries.py</text>
<text x="255" y="246" fill="var(--ink-soft)" text-anchor="middle" font-size="11">汇总 · 欠款 · 自检</text>
<rect x="360" y="210" width="130" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="425" y="230" fill="var(--ink)" text-anchor="middle">__main__.py</text>
<text x="425" y="246" fill="var(--ink-soft)" text-anchor="middle" font-size="11">命令行入口</text>
<rect x="520" y="210" width="100" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="570" y="230" fill="var(--ink)" text-anchor="middle">tests/</text>
<text x="570" y="246" fill="var(--ink-soft)" text-anchor="middle" font-size="11">临时库验证</text>
<line x1="85" y1="210" x2="330" y2="170" stroke="var(--rule)"/>
<line x1="255" y1="210" x2="400" y2="170" stroke="var(--rule)"/>
<line x1="425" y1="210" x2="470" y2="170" stroke="var(--rule)"/>
<text x="20" y="290" fill="var(--ink-soft)" font-size="11">所有读写都从 part01/db.py 的 with db() 进出:外键必开、行带列名、成功提交、出错回滚、一定关闭。</text>
<text x="20" y="310" fill="var(--ink-faint)" font-size="11">ledger.db 是可以随时重建的产物,别提交进 git。</text>
</g>
</svg>
<figcaption>今天的整体结构。琥珀色是会改变数据的两处(旧库是只读来源,bill_month 往新库写),蓝色是读取和展示。`ledger.db` 里三张表,数字是第 3 步的实测结果。</figcaption>
</figure>

文件放在 `part01/ledger/` 这个新的包里,按职责拆开,每个文件只管一件事:

```text
part01/
  db.py            ← Day 93 的 with db()
  ledger/
    __init__.py    ← 空文件,让它成为包
    schema.py      ← 建表语句和套餐单价
    seed.py        ← 搬旧数据,建新库
    billing.py     ← 按月开票
    queries.py     ← 各种查询
    __main__.py    ← 命令行入口
tests/
  test_ledger.py
```

## 第 0 步:准备

重建一份干净的 `practice.db`(10 家客户、15 张发票),建好新包,并确认 Day 93 写的 `db.py` 还在:

```bash
cd /Users/你/agent-zero-lab/part01/sql
rm -f practice.db
sqlite3 practice.db < customers.sql
sqlite3 practice.db < invoices.sql
cd /Users/你/agent-zero-lab
mkdir -p part01/ledger
touch part01/ledger/__init__.py
ls part01/db.py part01/ledger
```

<div class="line-notes">

- `cd /Users/你/agent-zero-lab/part01/sql` 先去放 SQL 文件的目录。
- `rm -f practice.db` 删掉旧库;`.sql` 文件才是源头,库随时能重建。
- `sqlite3 practice.db < customers.sql` 和 `< invoices.sql` 两行重建 10 家客户、15 张发票(第 15 张是孤儿)。
- `cd /Users/你/agent-zero-lab` 回到项目根目录。以后所有 `uv run` 都从这里跑。
- `mkdir -p part01/ledger` 建新目录。`-p` 的意思是:目录已经存在也不报错。
- `touch part01/ledger/__init__.py` 建一个空文件。Day 33 讲过,有 `__init__.py` 的目录才是包,`python -m part01.ledger` 和 `from part01.ledger import ...` 才找得到它。
- `ls part01/db.py part01/ledger` 确认 Day 93 的 `db.py` 在,新目录里有 `__init__.py`。

</div>

```text
part01/db.py

part01/ledger:
__init__.py
```

## 第 1 步:`schema.py`,先把表设计清楚

表的设计是整个项目最值钱的一步,后面所有代码都建立在它上面。新建 `part01/ledger/schema.py`:

```python
# agent-zero-lab/part01/ledger/schema.py
# 每个席位每月的单价。和 Day 85 起 invoices 里的金额对得上:
# 星河餐饮 专业版 12 席位 × 99 = 1188;青木设计 基础版 3 席位 × 39 = 117;远山物流 企业版 85 席位 × 199 = 16915。
PRICES = {"基础版": 39, "专业版": 99, "企业版": 199}

SCHEMA = """
CREATE TABLE customers (
    id          INTEGER PRIMARY KEY,
    company     TEXT    NOT NULL,
    contact     TEXT    NOT NULL,
    email       TEXT    UNIQUE,
    plan        TEXT    NOT NULL CHECK (plan IN ('基础版', '专业版', '企业版')),
    seats       INTEGER NOT NULL CHECK (seats > 0),
    city        TEXT,
    created_at  TEXT    NOT NULL
);

CREATE TABLE invoices (
    id           INTEGER PRIMARY KEY,
    customer_id  INTEGER NOT NULL REFERENCES customers (id),
    amount       INTEGER NOT NULL CHECK (amount > 0),
    status       TEXT    NOT NULL CHECK (status IN ('paid', 'unpaid', 'refunded')),
    issued_at    TEXT    NOT NULL,
    UNIQUE (customer_id, issued_at)
);

CREATE TABLE invoices_orphans (
    id           INTEGER PRIMARY KEY,
    customer_id  INTEGER,
    amount       INTEGER,
    status       TEXT,
    issued_at    TEXT
);
"""
```

<div class="line-notes">

- `PRICES = {"基础版": 39, "专业版": 99, "企业版": 199}` 套餐单价,每席位每月多少元。注释里验算了三个例子:12 × 99 = 1188,3 × 39 = 117,85 × 199 = 16915,和 Day 85 起各客户的发票金额吻合。这个字典留在代码里而不是数据库里,因为它是业务规则,改它要走代码评审。
- `SCHEMA = """` 三引号字符串放整段建表脚本,稍后用 `executescript` 一次执行。这是自己写死的脚本,不含任何外部输入,用 `executescript` 是安全的(Day 92)。
- `CREATE TABLE customers (` 客户表,和 Day 91 的 `strict.sql` 同一个设计,不用重新想。
- `email       TEXT    UNIQUE,` 邮箱可空,但填了就不能重复;可以有多个 NULL(Day 91)。
- `CHECK (plan IN` 套餐只能是三种之一,和上面的 `PRICES` 的键一致。两处要一起改,第 4 步的 `PRICES[r["plan"]]` 就是靠这条约束保证一定查得到。
- `CHECK (seats > 0)` 席位必须是正数,一个客户至少买一个席位。
- `CREATE TABLE invoices (` 发票表。
- `customer_id  INTEGER NOT NULL REFERENCES customers (id),` 外键:发票必须属于一个存在的客户。`NOT NULL` 防止「没有客户」的发票。
- `CHECK (amount > 0)` 金额必须是正数,退款用状态表示,不用负数。
- `CHECK (status IN` 状态只能是三种。
- `UNIQUE (customer_id, issued_at)` **今天新出现的写法**:写在所有列的后面、用括号列出几个列,叫**表级约束**(table constraint)。意思是这几列的**组合**不能重复:同一个客户在同一个开票日只能有一张发票。客户 1 在 7、8、9 月各有一张是允许的,在 9 月 1 号有两张就不行。
- `CREATE TABLE invoices_orphans (` 孤儿发票的存档表。列和 `invoices` 一样,但**没有任何约束**,连 `NOT NULL` 也不写:它要装的就是不合规的行,不能自己也要求合规。

</div>

两个值得停下来想的设计:

**没有单独给 `customer_id` 建索引。** Day 89 说过,按外键列查询(比如「某客户的所有发票」)很常见,通常要建索引。可今天的 `UNIQUE (customer_id, issued_at)` 已经让 SQLite 自动建了一个以 `customer_id` 打头的索引,按最左前缀规则(Day 89),单查 `customer_id` 也能用上它。等第 3 步建完库,用 `EXPLAIN QUERY PLAN` 验证,别靠猜。

**`invoices.id` 是自增主键,孤儿档案表里的 `id` 是旧库带来的 15。** 两张表的编号互不相干:新库以后开出的新发票 `invoices` 里也会有一个 15 号,和档案里那张 15 号孤儿是两回事。第 6 步会看到。

## 第 2 步:先试一次笨办法,看它怎么失败

最直接的搬法是:新库建好表,把旧库的 15 张发票原样灌进去。先试试看,理解为什么后面要写一个「分流」函数。新建 `part01/ledger_naive_import.py`:

```python
# agent-zero-lab/part01/ledger_naive_import.py
import sqlite3
from pathlib import Path

from part01.db import db
from part01.ledger.schema import SCHEMA
from part01.ledger.seed import OLD_DB

NAIVE_DB = Path(__file__).parent / "ledger" / "naive.db"
NAIVE_DB.unlink(missing_ok=True)

with db(NAIVE_DB) as conn:
    conn.executescript(SCHEMA)

old = sqlite3.connect(f"{OLD_DB.as_uri()}?mode=ro", uri=True)
old.row_factory = sqlite3.Row
customers = [dict(r) for r in old.execute("SELECT * FROM customers ORDER BY id")]
invoices = [dict(r) for r in old.execute("SELECT * FROM invoices ORDER BY id")]
old.close()
print(f"旧库里有 {len(customers)} 家客户、{len(invoices)} 张发票")

with db(NAIVE_DB) as conn:
    conn.executemany(
        "INSERT INTO customers (id, company, contact, email, plan, seats, city, created_at)"
        " VALUES (:id, :company, :contact, :email, :plan, :seats, :city, :created_at)",
        customers,
    )

try:
    with db(NAIVE_DB) as conn:
        conn.executemany(
            "INSERT INTO invoices (id, customer_id, amount, status, issued_at)"
            " VALUES (:id, :customer_id, :amount, :status, :issued_at)",
            invoices,
        )
except sqlite3.IntegrityError as e:
    print("整批导入失败:", type(e).__name__, e)

with db(NAIVE_DB, read_only=True) as conn:
    print("发票表里现在有几张:", conn.execute("SELECT count(*) FROM invoices").fetchone()[0])
NAIVE_DB.unlink()
```

<div class="line-notes">

- `NAIVE_DB = Path(__file__).parent / "ledger" / "naive.db"` 实验用的临时库,和正式的 `ledger.db` 分开。
- `NAIVE_DB.unlink(missing_ok=True)` 清掉上次可能残留的文件。
- `with db(NAIVE_DB) as conn:` 第一个 `with`:建表。`SCHEMA` 就是刚写的建表脚本。
- `conn.executescript(SCHEMA)` 一次建好三张表。
- `old = sqlite3.connect(f"{OLD_DB.as_uri()}?mode=ro", uri=True)` 用只读方式打开旧库(Day 92):搬家过程中绝不能改到旧数据。
- `old.row_factory = sqlite3.Row` 行带列名,下面才能 `dict(r)`。
- `customers = [dict(r) for r in old.execute("SELECT * FROM customers ORDER BY id")]` 列表推导式(Day 23):把每一行转成字典,例如 `{'id': 1, 'company': '星河餐饮', ...}`。注意这里没写 `.fetchall()`,游标本身可以遍历(Day 92)。
- `print(f"旧库里有 {len(customers)} 家客户、{len(invoices)} 张发票")` 实测 10 家、15 张。
- `"INSERT INTO customers (id, company, contact, email, plan, seats, city, created_at)"` 这是 `INSERT` 的**命名占位符**写法(Day 92):列名全部写出来,值写成 `:id`、`:company` 这种,`executemany` 配一个字典的列表,每个字典按名字对号入座。比 `?` 好的地方是列顺序不用背。
- `try:` 第三个 `with` 外面套 `try`:要接住里面可能抛的 `IntegrityError`。
- `conn.executemany(` 把 15 张发票一起灌进 `invoices`。灌到第 15 张(客户 11)时,外键拒绝,整个 `executemany` 抛异常,`with db()` 回滚。
- `except sqlite3.IntegrityError as e:` 实测 `FOREIGN KEY constraint failed`。
- `with db(NAIVE_DB, read_only=True) as conn:` 用只读连接查结果。
- `print("发票表里现在有几张:"` 实测 **0 张**。前面 14 张合规的也跟着回滚了,一张都没存进去。
- `NAIVE_DB.unlink()` 实验完删掉临时库。

</div>

```bash
uv run python -m part01.ledger_naive_import
```

```text
旧库里有 10 家客户、15 张发票
整批导入失败: IntegrityError FOREIGN KEY constraint failed
发票表里现在有几张: 0
```

这个结果既是坏消息也是好消息。坏消息:一颗老鼠屎让整批导入失败。好消息:这正是 Day 93 里事务的价值,**失败后库里没有留下一半**,不会出现「14 张进去了、1 张没进去」却没人知道的局面。我们要做的是在灌之前把数据**分流**:配得上客户的走正门,配不上的进档案。

## 第 3 步:`seed.py`,搬旧数据

新建 `part01/ledger/seed.py`,放两个函数:`migrate_from_practice` 负责搬数据,`build` 负责从零建库。

```python
# agent-zero-lab/part01/ledger/seed.py
import sqlite3
from pathlib import Path

from part01.db import db
from part01.ledger.schema import SCHEMA

HERE = Path(__file__).parent
LEDGER_DB = HERE / "ledger.db"
OLD_DB = HERE.parent / "sql" / "practice.db"

CUSTOMER_COLS = "id, company, contact, email, plan, seats, city, created_at"
CUSTOMER_NAMED = ":id, :company, :contact, :email, :plan, :seats, :city, :created_at"


def migrate_from_practice(conn: sqlite3.Connection, old_path: Path = OLD_DB) -> dict[str, int]:
    """把 Day 85~87 的 practice.db 搬进新库:客户全搬,发票只搬配得上客户的,孤儿放进 invoices_orphans。"""
    if not old_path.exists():
        raise FileNotFoundError(f"找不到 {old_path},先按 Day 85~87 重建 practice.db")
    old = sqlite3.connect(f"{old_path.as_uri()}?mode=ro", uri=True)
    old.row_factory = sqlite3.Row
    customers = old.execute("SELECT * FROM customers ORDER BY id").fetchall()
    invoices = old.execute("SELECT * FROM invoices ORDER BY id").fetchall()
    old.close()

    customer_ids = {c["id"] for c in customers}
    good = [dict(i) for i in invoices if i["customer_id"] in customer_ids]
    orphans = [dict(i) for i in invoices if i["customer_id"] not in customer_ids]

    conn.executemany(
        f"INSERT INTO customers ({CUSTOMER_COLS}) VALUES ({CUSTOMER_NAMED})",
        [dict(c) for c in customers],
    )
    insert_invoice = "(id, customer_id, amount, status, issued_at) VALUES (:id, :customer_id, :amount, :status, :issued_at)"
    conn.executemany(f"INSERT INTO invoices {insert_invoice}", good)
    conn.executemany(f"INSERT INTO invoices_orphans {insert_invoice}", orphans)
    return {"customers": len(customers), "invoices": len(good), "orphans": len(orphans)}


def build(path: Path = LEDGER_DB, old_path: Path = OLD_DB) -> dict[str, int]:
    """从零建一个账单库:删旧文件 → 建表 → 搬数据。"""
    if not old_path.exists():  # 先检查再删:别因为源数据不在,把现成的账单库也删了
        raise FileNotFoundError(f"找不到 {old_path},先按 Day 85~87 重建 practice.db")
    path.unlink(missing_ok=True)
    with db(path) as conn:
        conn.executescript(SCHEMA)
    with db(path) as conn:
        return migrate_from_practice(conn, old_path)
```

<div class="line-notes">

- `from part01.db import db` 用 Day 93 的 `db()`。
- `from part01.ledger.schema import SCHEMA` 从同一个包里的 `schema.py` 取建表脚本。写成 `part01.ledger.schema` 这样完整的路径,是 Day 33 的规矩(从项目根目录跑)。
- `HERE = Path(__file__).parent` 这个文件所在的目录,也就是 `part01/ledger/`。
- `LEDGER_DB = HERE / "ledger.db"` 新库放在包目录里。
- `OLD_DB = HERE.parent / "sql" / "practice.db"` 旧库:从 `part01/ledger/` 上一层 `part01/`,再进 `sql/`。
- `CUSTOMER_COLS = "id, company, contact, email, plan, seats, city, created_at"` 两个常量:客户表的列名清单,和对应的命名占位符清单。它们是**代码里写死的常量**,下面用 f-string 拼进 SQL 是安全的(拼进去的不含外部输入,Day 92 的原则)。
- `CUSTOMER_NAMED = ":id` 和上一行逐个对应,前面加冒号。
- `def migrate_from_practice(conn: sqlite3.Connection, old_path: Path = OLD_DB) -> dict[str, int]:` 参数是一个**已经打开**的新库连接,说明事务由调用方管。返回搬了多少行的统计。
- `"""把 Day 85~87` 文档字符串,说清楚这个函数干什么,尤其是孤儿怎么处理。
- `if not old_path.exists():` 旧库不在就直接抛 `FileNotFoundError`,而不是让 `sqlite3` 报一句让人摸不着头脑的 `unable to open database file`。
- `raise FileNotFoundError(f"找不到 {old_path},先按 Day 85~87 重建 practice.db")` 错误信息里直接告诉你怎么办。
- `old = sqlite3.connect(f"{old_path.as_uri()}?mode=ro", uri=True)` 只读打开旧库。
- `customers = old.execute("SELECT * FROM customers ORDER BY id").fetchall()` 读出全部客户,10 行 `Row`。
- `invoices = old.execute("SELECT * FROM invoices ORDER BY id").fetchall()` 读出全部发票,15 行。
- `old.close()` 读完立刻关,后面不再需要旧库。
- `customer_ids = {c["id"] for c in customers}` **集合推导式**(Day 25 的集合,Day 23 的推导式):把 10 个客户编号装进一个集合,得到 `{1, 2, ..., 10}`。集合判断「在不在里面」很快。
- `good = [dict(i) for i in invoices if i["customer_id"] in customer_ids]` 列表推导式加 `if`:只保留客户编号在集合里的发票,每行转成字典。代入数据:1 到 14 号发票的客户编号都在 1 到 10 里,留下 14 张。
- `orphans = [dict(i) for i in invoices if i["customer_id"] not in customer_ids]` 反过来:客户编号不在集合里的。15 号发票的客户编号是 11,不在,所以孤儿是 1 张。**好的和孤儿合起来恰好是全部,不多不少**,这个分流是互斥且完整的。
- `conn.executemany(` 第一批:搬客户。
- `f"INSERT INTO customers ({CUSTOMER_COLS}) VALUES ({CUSTOMER_NAMED})",` 用刚才的常量拼出完整的 `INSERT`。
- `[dict(c) for c in customers],` 参数:10 个字典的列表。
- `insert_invoice = "(id, customer_id, amount, status, issued_at) VALUES (:id, :customer_id, :amount, :status, :issued_at)"` 发票的列清单和占位符,存成一个字符串。**两张表共用**:新发票表和孤儿档案表列一样,`INSERT INTO <表名> ` 后面接同一段。
- `conn.executemany(f"INSERT INTO invoices {insert_invoice}", good)` 第二批:14 张发票进正式表。每一张都要过外键、`CHECK`、`UNIQUE` 的检查,因为已经分过流,不会失败。
- `conn.executemany(f"INSERT INTO invoices_orphans {insert_invoice}", orphans)` 第三批:孤儿进档案表,没有约束,一定进得去。
- `return {"customers": len(customers), "invoices": len(good), "orphans": len(orphans)}` 返回统计字典,调用方可以打印也可以断言。
- `def build(path: Path = LEDGER_DB, old_path: Path = OLD_DB) -> dict[str, int]:` 对外的入口:从零建一个新库。两个路径参数都有默认值,测试时可以换成临时路径。
- `if not old_path.exists():  # 先检查再删` 这里**又检查了一次**,而且必须在 `unlink` 之前。第 6 步后面的「故意搞坏」会演示:顺序反了,旧库不在时现成的账单库会被白白删掉。
- `path.unlink(missing_ok=True)` 删掉旧的账单库(不存在也不报错)。
- `with db(path) as conn:` 第一个事务:只建表。
- `conn.executescript(SCHEMA)` 执行建表脚本。
- `with db(path) as conn:` 第二个事务:搬数据。**建表和搬数据分成两个 `with`**,是因为 `executescript` 会先提交当前事务再执行脚本(Day 93 引用的官方文档),放在同一个事务里没有意义。
- `return migrate_from_practice(conn, old_path)` 在 `with` 块里 `return` 是允许的:离开块时 `db()` 照样提交并关闭连接。

</div>

跑一遍。用 `-c` 在命令行里直接执行一行 Python(不用再建脚本),然后用 `sqlite3` 命令行对着生成的库查几件事:

```bash
uv run python -c "from part01.ledger.seed import build; print(build())"
sqlite3 part01/ledger/ledger.db "SELECT count(*) FROM customers; SELECT count(*), sum(amount) FROM invoices; SELECT * FROM invoices_orphans;"
```

<div class="line-notes">

- `uv run python -c "from part01.ledger.seed import build; print(build())"` `-c` 后面的字符串被当成一段程序执行:导入 `build`,调用它,打印返回的统计。
- `sqlite3 part01/ledger/ledger.db "SELECT count(*) FROM customers;` 命令行 `sqlite3` 直接对着新库查,双引号里三条查询用分号隔开:客户数、发票张数和总额、孤儿档案。

</div>

```text
{'customers': 10, 'invoices': 14, 'orphans': 1}
10
14|99861
15|11|156|unpaid|2026-10-23
```

再用 `EXPLAIN QUERY PLAN` 验证第 1 步的判断,索引是不是真的存在、按客户查是不是真的用上了:

```bash
sqlite3 part01/ledger/ledger.db ".indexes invoices"
sqlite3 part01/ledger/ledger.db "EXPLAIN QUERY PLAN SELECT id FROM invoices WHERE customer_id = 1;"
sqlite3 part01/ledger/ledger.db "EXPLAIN QUERY PLAN SELECT id FROM invoices WHERE issued_at = '2026-09-01';"
```

<div class="line-notes">

- `".indexes invoices"` 点命令,列出 `invoices` 表上的所有索引。我们没写过 `CREATE INDEX`,但 `UNIQUE` 自动建了一个。
- `"EXPLAIN QUERY PLAN SELECT id FROM invoices WHERE customer_id = 1;"` 按客户查,看执行计划(Day 89)。
- `"EXPLAIN QUERY PLAN SELECT id FROM invoices WHERE issued_at = '2026-09-01';"` 对照:只按开票日查,不带 `customer_id`。

</div>

```text
sqlite_autoindex_invoices_1
QUERY PLAN
`--SEARCH invoices USING COVERING INDEX sqlite_autoindex_invoices_1 (customer_id=?)
QUERY PLAN
`--SCAN invoices USING COVERING INDEX sqlite_autoindex_invoices_1
```

第一条查询是 `SEARCH ... USING COVERING INDEX sqlite_autoindex_invoices_1 (customer_id=?)`,**直接顺着索引定位**;第二条只有 `SCAN`,从头到尾扫一遍,因为这个索引的第一列是 `customer_id`,只按第二列 `issued_at` 查用不上它(最左前缀规则,Day 89 的内容在这里应验了)。今天表小,感觉不出来;以后发票表有几百万行,第二种查询就要考虑再建一个以 `issued_at` 开头的索引。

## 第 4 步:`billing.py`,按月开票

项目最核心的业务函数。需求:给每个「这个月还没有发票、而且开票日之前已经注册」的客户开一张未付发票,金额 = 席位数 × 单价,**重复运行不能重复开**。新建 `part01/ledger/billing.py`:

```python
# agent-zero-lab/part01/ledger/billing.py
import sqlite3

from part01.ledger.schema import PRICES


def check_month(month: str) -> None:
    """月份必须是 YYYY-MM。"""
    ok = len(month) == 7 and month[4] == "-" and month[:4].isdigit() and month[5:].isdigit()
    if not ok or not 1 <= int(month[5:]) <= 12:
        raise ValueError(f"月份要写成 YYYY-MM,收到 {month!r}")


def bill_month(conn: sqlite3.Connection, month: str) -> int:
    """给每个这个月还没有发票、且当月 1 号前已注册的客户开一张 unpaid 发票。重复运行不会重复开。返回新开了几张。"""
    check_month(month)
    issued = f"{month}-01"
    todo = conn.execute(
        """
        SELECT c.id, c.plan, c.seats
        FROM customers c
        LEFT JOIN invoices i ON i.customer_id = c.id AND i.issued_at = ?
        WHERE i.id IS NULL AND c.created_at < ?
        ORDER BY c.id
        """,
        (issued, issued),
    ).fetchall()
    new = [(r["id"], r["seats"] * PRICES[r["plan"]], "unpaid", issued) for r in todo]
    conn.executemany(
        "INSERT INTO invoices (customer_id, amount, status, issued_at) VALUES (?, ?, ?, ?)", new
    )
    return len(new)
```

<div class="line-notes">

- `from part01.ledger.schema import PRICES` 从 `schema.py` 取单价字典。
- `def check_month(month: str) -> None:` 先把输入检查放在最前面:月份必须是 `YYYY-MM`。以后命令行、Agent 工具都会传字符串进来,不能信。
- `ok = len(month) == 7 and month[4] == "-" and month[:4].isdigit() and month[5:].isdigit()` 四个条件用 `and` 连起来:总长 7;第 5 个字符(下标 4)是减号;前 4 位全是数字;后 2 位全是数字。代入 `"2026-10"`:长度 7,`month[4]` 是 `-`,`"2026".isdigit()` 为真,`"10".isdigit()` 为真,`ok` 是 `True`。`"202610"` 长度只有 6,第一个条件就假了。
- `if not ok or not 1 <= int(month[5:]) <= 12:` 格式对了,还要月份在 1 到 12 之间。`or` 短路:`ok` 为假时,后半段(里面有 `int(...)`,遇到非数字会炸)根本不会执行。`1 <= x <= 12` 是 Python 的连比写法,和数学写法一样(对照 JS 要写 `1 <= x && x <= 12`)。
- `raise ValueError(f"月份要写成 YYYY-MM,收到 {month!r}")` 不合格就抛 `ValueError`,`!r` 让报错里带引号,空字符串也看得清。
- `def bill_month(conn: sqlite3.Connection, month: str) -> int:` 收一个连接和月份,返回新开了几张。事务仍然由调用方的 `with db()` 管。
- `check_month(month)` 第一件事:检查格式。
- `issued = f"{month}-01"` 这个月的开票日:每月 1 号。代入 `"2026-10"` 得到 `"2026-10-01"`。
- `todo = conn.execute(` 找出该开票的客户。
- `SELECT c.id, c.plan, c.seats` 只取开票需要的三列:编号、套餐、席位数。
- `LEFT JOIN invoices i ON i.customer_id = c.id AND i.issued_at = ?` **关键的一行**:左连接发票表,而且连接条件里除了「客户对得上」,还加了「开票日就是这个月 1 号」。这样,这个月已经有发票的客户,会连上一行 `i`;还没有的,`i` 那边全是 NULL。
- `WHERE i.id IS NULL AND c.created_at < ?` `i.id IS NULL` 就是 Day 87 找孤儿的写法:只留下**没连上发票**的客户,也就是这个月还没开票的。后一个条件 `c.created_at < ?`:开票日之前已经注册。字符串 `YYYY-MM-DD` 可以直接比大小,`'2026-07-15' < '2026-10-01'` 成立。
- `(issued, issued),` 两个 `?` 各对应一个值,这里恰好是同一个。
- `new = [(r["id"], r["seats"] * PRICES[r["plan"]], "unpaid", issued) for r in todo]` 列表推导式:对每个待开票的客户,算出一行要插入的数据 `(客户编号, 金额, 状态, 开票日)`。金额 = 席位数 × 单价,代入 1 号客户:`12 * PRICES["专业版"]` 就是 `12 * 99 = 1188`。`PRICES[...]` 一定查得到,因为 `customers.plan` 有 `CHECK`。
- `conn.executemany(` 一次批量插入。
- `"INSERT INTO invoices (customer_id, amount, status, issued_at) VALUES (?, ?, ?, ?)", new` 没有写 `id`,让 SQLite 自动编号。四个 `?` 对应元组里的四个值。
- `return len(new)` 返回新开张数。重复运行时 `todo` 是空的,`new` 是空列表,`executemany` 什么也不做,返回 0。

</div>

用一个小脚本验证它的几个行为。新建 `part01/ledger_try_bill.py`:

```python
# agent-zero-lab/part01/ledger_try_bill.py
from part01.db import db
from part01.ledger.billing import bill_month
from part01.ledger.seed import LEDGER_DB, build

build()
with db(LEDGER_DB) as conn:
    print("第一次开 2026-10:", bill_month(conn, "2026-10"), "张")
    print("再开一次:", bill_month(conn, "2026-10"), "张")
    print("总张数:", conn.execute("SELECT count(*) FROM invoices").fetchone()[0])
    try:
        bill_month(conn, "2026-13")
    except ValueError as e:
        print("月份不合格:", e)
```

<div class="line-notes">

- `build()` 每次先重建一个干净的库:14 张发票。
- `with db(LEDGER_DB) as conn:` 开可写连接。
- `print("第一次开 2026-10:", bill_month(conn, "2026-10"), "张")` 10 家客户都是 2026-10-01 前注册的,都还没有 10 月发票,实测开 10 张。
- `print("再开一次:"` 再调用:`LEFT JOIN` 这次全连上了,`todo` 为空,实测 0 张。
- `print("总张数:"` 14 + 10 = 24 张,说明没有重复。
- `except ValueError as e:` 传 `"2026-13"` 触发格式检查。
- `print("月份不合格:", e)` 实测 `月份要写成 YYYY-MM,收到 '2026-13'`。

</div>

```bash
uv run python -m part01.ledger_try_bill
```

```text
第一次开 2026-10: 10 张
再开一次: 0 张
总张数: 24
月份不合格: 月份要写成 YYYY-MM,收到 '2026-13'
```

注意第二次是 0 张,靠的是**两道防线**:`bill_month` 里的 `LEFT JOIN ... IS NULL` 先把已经开过的客户筛掉,即使它失效了,`UNIQUE (customer_id, issued_at)` 也会拒绝重复插入。第一道防线管「正常重复运行」,第二道防线管「两个人同时运行」,练习 5 会亲眼看到后一种。

## 第 5 步:`queries.py`,四个查询

读的部分。每个函数收一个连接,返回 `Row` 列表或字典,不碰事务。新建 `part01/ledger/queries.py`:

```python
# agent-zero-lab/part01/ledger/queries.py
import sqlite3


def invoices_of(conn: sqlite3.Connection, customer_id: int, status: str | None = None) -> list[sqlite3.Row]:
    """一个客户的发票,按开票日排序,状态可选。"""
    sql = "SELECT id, amount, status, issued_at FROM invoices WHERE customer_id = ?"
    params: list[object] = [int(customer_id)]
    if status is not None:
        sql += " AND status = ?"
        params.append(status)
    sql += " ORDER BY issued_at, id"
    return conn.execute(sql, params).fetchall()


def monthly_summary(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    """按月份、状态汇总:张数和金额。"""
    return conn.execute(
        """
        SELECT substr(issued_at, 1, 7) AS month, status, count(*) AS n, sum(amount) AS total
        FROM invoices
        GROUP BY month, status
        ORDER BY month, status
        """
    ).fetchall()


def unpaid_by_customer(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    """有未付发票的客户,按欠款从多到少。"""
    return conn.execute(
        """
        SELECT c.id AS customer_id, c.company, count(*) AS n, sum(i.amount) AS owed
        FROM customers c
        JOIN invoices i ON i.customer_id = c.id
        WHERE i.status = 'unpaid'
        GROUP BY c.id, c.company
        ORDER BY owed DESC, c.id
        """
    ).fetchall()


def audit(conn: sqlite3.Connection) -> dict[str, int]:
    """账单库自检:外键违规数、孤儿存档数、没有任何发票的客户数、发票总额。"""
    fk = len(conn.execute("PRAGMA foreign_key_check").fetchall())
    orphans = conn.execute("SELECT count(*) FROM invoices_orphans").fetchone()[0]
    no_invoice = conn.execute(
        """
        SELECT count(*)
        FROM customers c
        LEFT JOIN invoices i ON i.customer_id = c.id
        WHERE i.id IS NULL
        """
    ).fetchone()[0]
    total = conn.execute("SELECT coalesce(sum(amount), 0) FROM invoices").fetchone()[0]
    return {"fk_violations": fk, "orphans_archived": orphans, "customers_without_invoice": no_invoice, "invoice_total": total}
```

<div class="line-notes">

- `import sqlite3` 只为类型标注用:参数是 `sqlite3.Connection`,返回 `list[sqlite3.Row]`。
- `def invoices_of(conn: sqlite3.Connection, customer_id: int, status: str | None = None) -> list[sqlite3.Row]:` 一个客户的发票,状态可选。和 Day 92 的 `list_invoices` 一脉相承,去掉了排序白名单(固定按开票日排)。
- `sql = "SELECT id, amount, status, issued_at FROM invoices WHERE customer_id = ?"` 基础查询。
- `params: list[object] = [int(customer_id)]` `int(...)` 在进数据库之前把外部来的值转成整数,转不了就抛 `ValueError`。
- `if status is not None:` 状态是可选条件,给了才加。
- `sql += " AND status = ?"` 追加固定文本,值走参数列表。
- `sql += " ORDER BY issued_at, id"` 先按开票日,同一天再按编号,保证每次顺序一样。
- `return conn.execute(sql, params).fetchall()` 执行并取回。
- `def monthly_summary(conn: sqlite3.Connection) -> list[sqlite3.Row]:` 月度汇总。
- `SELECT substr(issued_at, 1, 7) AS month, status, count(*) AS n, sum(amount) AS total` `substr(文本, 起点, 长度)` 从第 1 个字符起取 7 个,`'2026-09-01'` 变成 `'2026-09'`,起别名 `month`。
- `GROUP BY month, status` 按月份和状态分组。SQLite 允许在 `GROUP BY` 里直接写 `SELECT` 里起的别名。
- `ORDER BY month, status` 先按月、再按状态,输出稳定。
- `def unpaid_by_customer(conn: sqlite3.Connection) -> list[sqlite3.Row]:` 欠款排行。
- `SELECT c.id AS customer_id, c.company, count(*) AS n, sum(i.amount) AS owed` 每家客户几张未付、共欠多少。`c.id` 起了别名 `customer_id`,避免和以后可能的 `id` 重名(Day 93)。
- `JOIN invoices i ON i.customer_id = c.id` 内连接:没有未付发票的客户连不上,自然不出现,正好是想要的。
- `WHERE i.status = 'unpaid'` 先筛出未付的行,再分组。
- `GROUP BY c.id, c.company` 按客户分组。
- `ORDER BY owed DESC, c.id` 欠得多的在前,并列时按编号。
- `def audit(conn: sqlite3.Connection) -> dict[str, int]:` 库的自检。
- `fk = len(conn.execute("PRAGMA foreign_key_check").fetchall())` Day 91 的体检命令,每行是一条违规,数一下有几条。
- `orphans = conn.execute("SELECT count(*) FROM invoices_orphans").fetchone()[0]` 档案里存了几张孤儿。
- `no_invoice = conn.execute(` 没有任何发票的客户有几个。
- `LEFT JOIN invoices i ON i.customer_id = c.id` 左连接,保住所有客户。
- `WHERE i.id IS NULL` Day 87 的写法:没连上发票的客户。
- `total = conn.execute("SELECT coalesce(sum(amount), 0) FROM invoices").fetchone()[0]` 发票总额。表是空时 `sum` 是 `NULL`,`coalesce` 换成 0。
- `return {"fk_violations": fk,` 四个数放进字典返回。

</div>

## 第 6 步:`__main__.py`,命令行入口

Day 44 学过:`python -m 包名` 会去执行这个包里的 `__main__.py`。新建 `part01/ledger/__main__.py`:

```python
# agent-zero-lab/part01/ledger/__main__.py
import sys

from part01.db import db
from part01.ledger import queries
from part01.ledger.billing import bill_month
from part01.ledger.seed import LEDGER_DB, build

USAGE = """用法:uv run python -m part01.ledger <命令>
  build              从 practice.db 重建账单库
  bill YYYY-MM       给这个月还没开票的客户开发票
  report             月度汇总、欠款排行、自检
  customer <编号>    看一个客户的全部发票"""


def main(argv: list[str]) -> int:
    if not argv:
        print(USAGE)
        return 2
    cmd, args = argv[0], argv[1:]

    if cmd == "build":
        try:
            print("已重建:", build())
        except FileNotFoundError as e:
            print("错误:", e)
            return 1
        return 0

    if not LEDGER_DB.exists():
        print("还没有账单库,先运行:build")
        return 1

    if cmd == "bill" and len(args) == 1:
        try:
            with db(LEDGER_DB) as conn:
                n = bill_month(conn, args[0])
        except ValueError as e:
            print("错误:", e)
            return 2
        print(f"{args[0]} 新开发票 {n} 张")
        return 0

    if cmd == "report":
        with db(LEDGER_DB, read_only=True) as conn:
            print("== 月度汇总 ==")
            for r in queries.monthly_summary(conn):
                print(f"{r['month']}  {r['status']:<9} {r['n']:>2} 张  {r['total']:>6}")
            print("== 欠款排行 ==")
            for r in queries.unpaid_by_customer(conn):
                print(f"{r['customer_id']:>2} {r['company']}  {r['n']} 张未付,共 {r['owed']}")
            print("== 自检 ==")
            print(queries.audit(conn))
        return 0

    if cmd == "customer" and len(args) == 1 and args[0].isdigit():
        with db(LEDGER_DB, read_only=True) as conn:
            rows = queries.invoices_of(conn, int(args[0]))
        if not rows:
            print("没有发票(或没有这个客户)")
        for r in rows:
            print(f"#{r['id']:<3} {r['issued_at']}  {r['amount']:>6}  {r['status']}")
        return 0

    print(USAGE)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

<div class="line-notes">

- `import sys` 要用 `sys.argv` 和 `sys.exit`(Day 44)。
- `from part01.ledger import queries` 导入整个 `queries` 模块,下面用 `queries.xxx` 调用,一眼看出函数来自哪里。
- `USAGE = """用法` 帮助文字,写成常量,参数不对时打印。
- `def main(argv: list[str]) -> int:` 把「真正干活」放进一个函数,参数是命令行参数列表,返回退出码。这样测试可以直接 `main(["report"])`,不用启动新进程。
- `if not argv:` 没给任何命令:打印用法,退出码 2(命令行里「用法错误」的惯例)。
- `cmd, args = argv[0], argv[1:]` 第一个是命令,后面是它的参数。代入 `["bill", "2026-10"]`:`cmd` 是 `"bill"`,`args` 是 `["2026-10"]`。
- `if cmd == "build":` 建库命令,先于下面的「库必须存在」检查,因为它就是用来建库的。
- `try:` 包住 `build()`。
- `print("已重建:", build())` 打印统计字典。
- `except FileNotFoundError as e:` 旧库不在,接住第 3 步写的那个异常,打印友好信息,退出码 1(运行失败)。
- `if not LEDGER_DB.exists():` 其余命令都要读库。库不存在就直接提示「先 build」,而不是让 `sqlite3` 在空路径上新建一个 0 字节的假库(Day 92 的坑)。
- `if cmd == "bill" and len(args) == 1:` 开票命令,必须正好一个参数。
- `with db(LEDGER_DB) as conn:` 可写连接,正常结束自动提交。
- `n = bill_month(conn, args[0])` 开票。
- `except ValueError as e:` 月份格式不对,友好提示,退出码 2。注意 `with` 在 `try` 里面:`bill_month` 抛异常时,`db()` 已经先回滚了,再传到这里。
- `print(f"{args[0]} 新开发票 {n} 张")` 报告结果。
- `if cmd == "report":` 报表命令,用**只读**连接:报表不应该有改库的能力。
- `for r in queries.monthly_summary(conn):` 逐行打印月度汇总。
- `{r['status']:<9}` f-string 的格式说明:`:<9` 是左对齐、占 9 个字符宽,让表格的列对齐;`{r['n']:>2}` 是右对齐占 2 宽,`{r['total']:>6}` 右对齐占 6 宽。f-string 里面用单引号 `r['status']`,因为外面是双引号。
- `print(queries.audit(conn))` 自检结果是字典,直接打印。
- `if cmd == "customer" and len(args) == 1 and args[0].isdigit():` 查某个客户。`isdigit()` 先确认是纯数字,再 `int(...)`,避免 `customer abc` 时抛异常。
- `rows = queries.invoices_of(conn, int(args[0]))` 查出发票。
- `if not rows:` 没有发票时给一句人话,不是空白。
- `{r['id']:<3}` 编号左对齐占 3 宽。
- `print(USAGE)` 走到这里说明命令不认识或参数个数不对,打印用法。
- `if __name__ == "__main__":` 只有被直接运行(`python -m part01.ledger`)时才执行,被别的文件 `import` 时不执行。
- `sys.exit(main(sys.argv[1:]))` `sys.argv[0]` 是程序名,后面才是真参数。`main` 返回的数字成为进程的退出码。

</div>

按顺序把命令都敲一遍。第一条故意在还没有账单库时 `report`:

```bash
rm -f part01/ledger/ledger.db
uv run python -m part01.ledger
uv run python -m part01.ledger report
uv run python -m part01.ledger build
uv run python -m part01.ledger report
```

<div class="line-notes">

- `rm -f part01/ledger/ledger.db` 先删掉第 3、4 步生成的库,模拟「第一次用」。
- `uv run python -m part01.ledger` 不带命令:打印用法。
- `uv run python -m part01.ledger report` 没有库就出报表:打印提示。
- `uv run python -m part01.ledger build` 建库。
- `uv run python -m part01.ledger report` 建好以后再出报表。

</div>

```text
用法:uv run python -m part01.ledger <命令>
  build              从 practice.db 重建账单库
  bill YYYY-MM       给这个月还没开票的客户开发票
  report             月度汇总、欠款排行、自检
  customer <编号>    看一个客户的全部发票
还没有账单库,先运行:build
已重建: {'customers': 10, 'invoices': 14, 'orphans': 1}
== 月度汇总 ==
2026-07  paid       1 张    1188
2026-08  paid       5 张   47862
2026-09  paid       4 张   30848
2026-09  refunded   1 张      78
2026-09  unpaid     3 张   19885
== 欠款排行 ==
 3 远山物流  1 张未付,共 16915
 8 云杉律所  1 张未付,共 1782
 1 星河餐饮  1 张未付,共 1188
== 自检 ==
{'fk_violations': 0, 'orphans_archived': 1, 'customers_without_invoice': 2, 'invoice_total': 99861}
```

读这份输出:没带命令时打印用法;没有库时 `report` 不会悄悄新建一个空库,而是提示先 `build`;建库统计是 `{'customers': 10, 'invoices': 14, 'orphans': 1}`。报表的月度汇总:7 月 1 张(1188)、8 月 5 张(47862)、9 月分成已付 4 张(30848)、退款 1 张(78)、未付 3 张(19885),合计 1188 + 47862 + 30848 + 78 + 19885 = **99861**,正好是 Day 90 审计里「能配上客户的发票合计」。自检里 `fk_violations` 是 0,孤儿存档 1 张,`customers_without_invoice` 是 2(6 号禾丰农业和 10 号小满花店从来没有发票)。

接着开票、故意重复开、故意写错月份,再看一个客户的发票:

```bash
uv run python -m part01.ledger bill 2026-10
uv run python -m part01.ledger bill 2026-10
uv run python -m part01.ledger bill 2026-13
uv run python -m part01.ledger customer 1
uv run python -m part01.ledger customer 6
uv run python -m part01.ledger report
```

```text
2026-10 新开发票 10 张
2026-10 新开发票 0 张
错误: 月份要写成 YYYY-MM,收到 '2026-13'
#1   2026-07-01    1188  paid
#2   2026-08-01    1188  paid
#3   2026-09-01    1188  unpaid
#15  2026-10-01    1188  unpaid
#20  2026-10-01     195  unpaid
== 月度汇总 ==
2026-07  paid       1 张    1188
2026-08  paid       5 张   47862
2026-09  paid       4 张   30848
2026-09  refunded   1 张      78
2026-09  unpaid     3 张   19885
2026-10  unpaid    10 张   51045
== 欠款排行 ==
 3 远山物流  2 张未付,共 33830
 5 启明科技  1 张未付,共 27860
 8 云杉律所  2 张未付,共 3564
 1 星河餐饮  2 张未付,共 2376
 4 蓝鲸教育  1 张未付,共 1980
 9 北辰贸易  1 张未付,共 891
 6 禾丰农业  1 张未付,共 195
 2 青木设计  1 张未付,共 117
 7 半岛咖啡  1 张未付,共 78
10 小满花店  1 张未付,共 39
== 自检 ==
{'fk_violations': 0, 'orphans_archived': 1, 'customers_without_invoice': 0, 'invoice_total': 150906}
```

逐段对照:第一次开 10 张,第二次 0 张(幂等),`2026-13` 被挡下并打印错误。1 号客户多了一张 10 月的未付发票 1188(12 席 × 99),编号是 `#15`:**这是新库里的 15 号发票,和档案里那张 15 号孤儿不是同一张**,两张表的编号各算各的。6 号禾丰农业从来没有过发票,现在有了第一张:5 席基础版,5 × 39 = 195。月度汇总里多了一行 `2026-10 unpaid 10 张 51045`,可以验算:1188 + 117 + 16915 + 1980 + 27860 + 195 + 78 + 1782 + 891 + 39 = 51045。欠款排行里每个客户都出现了,而且 3 号远山物流排第一,欠 33830(9 月和 10 月各 16915)。

## 第 7 步:用测试把规矩钉死

每一个「应该」都该有一个测试。新建 `tests/test_ledger.py`,今天新增 17 个用例(其中 `parametrize` 把一个函数展开成多个):

```python
# agent-zero-lab/tests/test_ledger.py
import sqlite3
from pathlib import Path

import pytest

from part01.db import db
from part01.ledger import queries
from part01.ledger.schema import PRICES
from part01.ledger.billing import bill_month
from part01.ledger.seed import build

SQL_DIR = Path(__file__).parent.parent / "part01" / "sql"


@pytest.fixture
def old_db(tmp_path: Path) -> Path:
    """按 Day 85~87 的两个 .sql 文件造一个「旧的 practice.db」:10 家客户,15 张发票(含孤儿)。"""
    path = tmp_path / "old.db"
    raw = sqlite3.connect(path)
    for name in ("customers.sql", "invoices.sql"):
        raw.executescript((SQL_DIR / name).read_text(encoding="utf-8"))
    raw.close()
    return path


@pytest.fixture
def ledger(tmp_path: Path, old_db: Path) -> Path:
    path = tmp_path / "ledger.db"
    build(path, old_db)
    return path


def invoice_count(path: Path) -> int:
    """用一个全新的连接数发票张数,不借用被测代码的连接。"""
    raw = sqlite3.connect(path)
    n = raw.execute("SELECT count(*) FROM invoices").fetchone()[0]
    raw.close()
    return n


def test_build_counts(tmp_path: Path, old_db: Path):
    result = build(tmp_path / "x.db", old_db)
    assert result == {"customers": 10, "invoices": 14, "orphans": 1}


def test_missing_old_db_gives_clear_error(tmp_path: Path):
    with pytest.raises(FileNotFoundError, match="先按 Day 85"):
        build(tmp_path / "x.db", tmp_path / "nope.db")


def test_orphan_is_archived_not_lost(ledger: Path):
    with db(ledger, read_only=True) as conn:
        row = conn.execute("SELECT customer_id, amount FROM invoices_orphans").fetchone()
        assert (row["customer_id"], row["amount"]) == (11, 156)
        assert queries.audit(conn)["fk_violations"] == 0


@pytest.mark.parametrize(
    "values",
    [
        (11, 156, "unpaid", "2026-10-23"),   # 客户不存在
        (1, -5, "unpaid", "2026-10-23"),     # 金额不是正数
        (1, 100, "随便写", "2026-10-23"),    # 状态不在三种之内
        (1, 100, "unpaid", "2026-09-01"),    # 1 号客户 9 月已经有发票了
    ],
)
def test_bad_invoice_rejected(ledger: Path, values: tuple):
    with pytest.raises(sqlite3.IntegrityError):
        with db(ledger) as conn:
            conn.execute(
                "INSERT INTO invoices (customer_id, amount, status, issued_at) VALUES (?, ?, ?, ?)", values
            )
    assert invoice_count(ledger) == 14


def test_bill_month_and_idempotent(ledger: Path):
    with db(ledger) as conn:
        assert bill_month(conn, "2026-10") == 10
        assert bill_month(conn, "2026-10") == 0
        rows = queries.invoices_of(conn, 1, status="unpaid")
    assert [(r["issued_at"], r["amount"]) for r in rows] == [("2026-09-01", 1188), ("2026-10-01", 1188)]
    assert invoice_count(ledger) == 24


def test_bill_month_skips_customers_registered_later(ledger: Path):
    with db(ledger) as conn:
        assert bill_month(conn, "2026-07") == 8  # 10 号客户 7-15 才注册,1 号 7 月已有发票


@pytest.mark.parametrize("bad", ["2026-13", "202610", "2026-1", "abcd-ef", "2026-00"])
def test_bill_month_rejects_bad_month(ledger: Path, bad: str):
    with db(ledger) as conn:
        with pytest.raises(ValueError):
            bill_month(conn, bad)


def test_bill_month_all_or_nothing(ledger: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setitem(PRICES, "企业版", 0)  # 3 号、5 号客户是企业版,金额算成 0,违反 CHECK
    with pytest.raises(sqlite3.IntegrityError):
        with db(ledger) as conn:
            bill_month(conn, "2026-10")
    assert invoice_count(ledger) == 14  # 1、2 号客户已经插进去的两张也被撤回


def test_summary_total_matches_audit(ledger: Path):
    with db(ledger, read_only=True) as conn:
        summary_total = sum(r["total"] for r in queries.monthly_summary(conn))
        assert summary_total == queries.audit(conn)["invoice_total"] == 99861


def test_unpaid_ranking(ledger: Path):
    with db(ledger, read_only=True) as conn:
        top = queries.unpaid_by_customer(conn)[0]
    assert (top["company"], top["owed"]) == ("远山物流", 16915)
```

<div class="line-notes">

- `SQL_DIR = Path(__file__).parent.parent / "part01" / "sql"` 从 `tests/` 回到项目根,再进 `part01/sql`。
- `def old_db(tmp_path: Path) -> Path:` 第一个 fixture:在临时目录里按 Day 85 到 87 的两个 `.sql` 文件造一个**旧库**:10 家客户、15 张发票(含孤儿)。测试绝不碰真正的 `practice.db`。
- `raw.executescript((SQL_DIR / name).read_text(encoding="utf-8"))` 把两个文件的内容喂给 `executescript`,和之前一样。
- `def ledger(tmp_path: Path, old_db: Path) -> Path:` 第二个 fixture,**依赖第一个**:参数里写 `old_db`,pytest 就先造它再造这个(Day 73)。它用 `build(path, old_db)` 在临时路径建好新库,返回路径。
- `def invoice_count(path: Path) -> int:` 测试用的小工具:**另开一个全新的连接**数发票,不借用被测代码的连接,免得「自己证明自己」。
- `def test_build_counts(tmp_path: Path, old_db: Path):` 搬家的统计应该是 10 家客户、14 张发票、1 张孤儿。
- `def test_missing_old_db_gives_clear_error(tmp_path: Path):` 旧库不存在时,`build` 抛带指引的 `FileNotFoundError`。
- `with pytest.raises(FileNotFoundError, match="先按 Day 85"):` `match` 参数检查异常消息里包含这几个字,保证错误信息真的在教人怎么办。
- `def test_orphan_is_archived_not_lost(ledger: Path):` 孤儿没有丢:档案里有一行,客户编号 11、金额 156,而且新库自检的外键违规为 0。
- `@pytest.mark.parametrize(` 参数化(Day 73):下面的函数会对列表里每一组 `values` 各跑一遍。
- `(11, 156, "unpaid", "2026-10-23"),   # 客户不存在` 四个非法发票,每个违反一条不同的约束:外键。
- `(1, -5, "unpaid", "2026-10-23"),     # 金额不是正数` `CHECK (amount > 0)`。
- `(1, 100, "随便写", "2026-10-23"),    # 状态不在三种之内` `CHECK (status IN ...)`。
- `(1, 100, "unpaid", "2026-09-01"),    # 1 号客户 9 月已经有发票了` 联合唯一约束。
- `def test_bad_invoice_rejected(ledger: Path, values: tuple):` 每组都应该抛 `IntegrityError`。
- `assert invoice_count(ledger) == 14` 被拒绝以后,发票数还是 14,没有半条写进去。
- `def test_bill_month_and_idempotent(ledger: Path):` 开票和幂等:第一次开 10 张,第二次 0 张。
- `rows = queries.invoices_of(conn, 1, status="unpaid")` 1 号客户的未付发票。
- `assert [(r["issued_at"], r["amount"]) for r in rows] ==` 应该有两张:9 月的旧发票和刚开的 10 月发票,都是 1188。
- `assert invoice_count(ledger) == 24` 14 + 10,总共 24,没有重复。
- `def test_bill_month_skips_customers_registered_later(ledger: Path):` 对 2026-07 开票:10 号客户 7 月 15 日才注册,不在 7 月 1 日之前,所以不开;1 号客户 7 月已经有发票;剩下 2 到 9 号共 8 个客户,所以返回 8。
- `@pytest.mark.parametrize("bad", ["2026-13", "202610", "2026-1", "abcd-ef", "2026-00"])` 五种坏月份。
- `with pytest.raises(ValueError):` 都应该被 `check_month` 拒绝。
- `def test_bill_month_all_or_nothing(ledger: Path, monkeypatch: pytest.MonkeyPatch):` 整批开票要么全成功要么全撤回。
- `monkeypatch.setitem(PRICES, "企业版", 0)` Day 74 的 `monkeypatch`:测试期间临时把企业版单价改成 0(测完自动还原)。这样 3 号、5 号客户算出的金额是 0,违反 `CHECK (amount > 0)`。
- `assert invoice_count(ledger) == 14  # 1、2 号客户` 客户按编号顺序开票:1、2 号先成功插入,3 号失败,整批回滚,发票数仍是 14。
- `def test_summary_total_matches_audit(ledger: Path):` 月度汇总各行金额相加,应该等于自检里的发票总额,都是 99861。
- `def test_unpaid_ranking(ledger: Path):` 欠款第一名是远山物流 16915。

</div>

```bash
uv run pytest -v
```

@@PYTEST@@

全部通过。其中最有价值的是 `test_bill_month_all_or_nothing`:它不是测「正常能用」,而是测「出了事不留残局」。

## 把零件拼起来

今天的代码都在上面了,这张表是「零件 → 它来自哪天」的对照,哪一块不会了就回哪一天:

| 零件 | 在哪个文件 | 来自 |
| --- | --- | --- |
| 表、主键、`NOT NULL`、`UNIQUE`、`CHECK`、外键 | `schema.py` | [Day 85](/blog/agent-zero/day-085-sql-1/)、[Day 91](/blog/agent-zero/day-091-sql-6/) |
| 联合唯一 `UNIQUE (a, b)` | `schema.py` | 今天新写法,原理同 Day 91 的 `UNIQUE` |
| 左连接 + `IS NULL` 找「没有」 | `bill_month`、`audit` | [Day 87](/blog/agent-zero/day-087-sql-3/) |
| `GROUP BY`、`sum`、`count`、`coalesce` | `queries.py` | [Day 88](/blog/agent-zero/day-088-sql-4/) |
| 最左前缀、`EXPLAIN QUERY PLAN` | 第 3 步验证 | [Day 89](/blog/agent-zero/day-089-sql-5/) |
| 只读连接、`?` 占位符、命名占位符 | `seed.py`、`queries.py` | [Day 92](/blog/agent-zero/day-092-python-sqlite-1/) |
| `with db()`、`executemany`、`rowcount`、事务 | 所有写操作 | [Day 93](/blog/agent-zero/day-093-python-sqlite-2/) |
| 集合推导式、列表推导式 | `migrate_from_practice` | [Day 23](/blog/agent-zero/day-023-comprehensions/)、[Day 25](/blog/agent-zero/day-025-sets/) |
| `sys.argv`、`sys.exit`、`-m` | `__main__.py` | [Day 33](/blog/agent-zero/day-033-packages/)、[Day 44](/blog/agent-zero/day-044-notebook-project/) |
| fixture、`parametrize`、`monkeypatch` | `test_ledger.py` | [Day 73](/blog/agent-zero/day-073-pytest-3/)、[Day 74](/blog/agent-zero/day-074-pytest-4/) |

## 故意搞坏:三种「不是你写错,是环境出问题」

**旧库不在了,现成的账单库会不会被误删?** 把 `practice.db` 临时挪走,再 `build`:

```bash
mv part01/sql/practice.db /tmp/practice.db.bak
uv run python -m part01.ledger build
ls -l part01/ledger/ledger.db
mv /tmp/practice.db.bak part01/sql/practice.db
```

<div class="line-notes">

- `mv part01/sql/practice.db /tmp/practice.db.bak` 把旧库挪到别处,模拟「源数据不在了」。
- `uv run python -m part01.ledger build` 触发 `build`。
- `ls -l part01/ledger/ledger.db` 确认现成的账单库还在,大小没变。
- `mv /tmp/practice.db.bak part01/sql/practice.db` 实验完放回去。

</div>

```text
错误: 找不到 /Users/你/agent-zero-lab/part01/sql/practice.db,先按 Day 85~87 重建 practice.db
24576 part01/ledger/ledger.db
```

提示信息里直接写了怎么办,账单库文件还在,没有被动。回头看 `build` 里那个「先检查再删」的顺序:如果写成「先 `unlink` 再检查」,这个实验里账单库就会被删掉,剩下一个报错。**破坏性的操作,放在所有可能失败的检查之后。**

**有人绕过程序,直接改了库。** 命令行里的 `sqlite3` 默认不开外键(Day 91),有人手快,直接插了一张孤儿发票:

```bash
sqlite3 part01/ledger/ledger.db "INSERT INTO invoices (customer_id, amount, status, issued_at) VALUES (11, 156, 'unpaid', '2026-10-23');"
uv run python -m part01.ledger report
```

```text
10 小满花店  1 张未付,共 39
== 自检 ==
{'fk_violations': 1, 'orphans_archived': 1, 'customers_without_invoice': 0, 'invoice_total': 151062}
```

插进去了,没有任何报错。但是 `report` 末尾的自检**抓到了**:`fk_violations` 是 1。这就是 `audit` 存在的意义:约束是第一道门,自检是「万一第一道门被绕过」的第二道。清理掉它,再确认:

```bash
sqlite3 part01/ledger/ledger.db "DELETE FROM invoices WHERE customer_id = 11;"
uv run python -m part01.ledger report | tail -1
```

```text
{'fk_violations': 0, 'orphans_archived': 1, 'customers_without_invoice': 0, 'invoice_total': 150906}
```

**两个人同时开同一个月的票。** 这种情形放在练习 5,因为要同时操作两个连接,在命令行里不好演示。

## 动手练习

每道题开始前,先确认 `practice.db` 是新鲜的(第 0 步前四行命令)。用 `uv run python -m part01.文件名` 运行。练习里的临时库都建在 `part01/ledger/ex.db`,脚本结束时会删掉。

**练习 1:退款。** 写 `refund_invoice(conn, invoice_id)`:只有 `paid` 的发票能改成 `refunded`。找不到发票、状态不是 `paid`,要抛**不同**的 `RefundError`。试 1、1、3、999 号发票各一次。提示:先试着用一条带 `AND status = 'paid'` 的 `UPDATE`,再根据 `rowcount` 判断。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex94_1_refund.py
import sqlite3
from pathlib import Path

from part01.db import db
from part01.ledger.seed import build

EX_DB = Path(__file__).parent / "ledger" / "ex.db"


class RefundError(Exception):
    pass


def refund_invoice(conn: sqlite3.Connection, invoice_id: int) -> str:
    """把一张 paid 发票改成 refunded。找不到、不是 paid,分别给出不同的错误。"""
    cur = conn.execute(
        "UPDATE invoices SET status = 'refunded' WHERE id = ? AND status = 'paid'", (invoice_id,)
    )
    if cur.rowcount == 1:
        return f"{invoice_id} 号发票已退款"
    row = conn.execute("SELECT status FROM invoices WHERE id = ?", (invoice_id,)).fetchone()
    if row is None:
        raise RefundError(f"没有 {invoice_id} 号发票")
    raise RefundError(f"{invoice_id} 号发票状态是 {row['status']},只有 paid 的才能退款")


build(EX_DB)
for invoice_id in (1, 1, 3, 999):
    try:
        with db(EX_DB) as conn:
            print(refund_invoice(conn, invoice_id))
    except RefundError as e:
        print("RefundError:", e)

with db(EX_DB, read_only=True) as conn:
    print("现在 1 号发票:", conn.execute("SELECT status FROM invoices WHERE id = 1").fetchone()["status"])
EX_DB.unlink()
```

<div class="line-notes">

- `EX_DB = Path(__file__).parent / "ledger" / "ex.db"` 练习用的临时库。
- `class RefundError(Exception):` 自己的业务异常。
- `"UPDATE invoices SET status = 'refunded' WHERE id = ? AND status = 'paid'", (invoice_id,)` 关键:把「状态必须是 paid」写进 `WHERE`。这样判断和修改是**同一条语句**,不存在「先查到是 paid、再改」之间被别人改走的空隙(Day 93 的丢失更新)。
- `if cur.rowcount == 1:` 改到 1 行就是成功。
- `row = conn.execute("SELECT status FROM invoices WHERE id = ?", (invoice_id,)).fetchone()` 没改到,再查一下原因:发票是不存在,还是状态不对。
- `if row is None:` 不存在。
- `raise RefundError(f"{invoice_id} 号发票状态是 {row['status']},只有 paid 的才能退款")` 存在但状态不对,错误信息里带上当前状态,Agent 看了知道怎么回复客户。
- `for invoice_id in (1, 1, 3, 999):` 四个用例:1 号 paid 能退;再退一次已经是 refunded;3 号是 unpaid;999 号不存在。
- `with db(EX_DB) as conn:` 每次退款一个事务。
- `print(refund_invoice(conn, invoice_id))` 成功时打印返回的话。
- `except RefundError as e:` 失败时打印业务异常。

</div>

```text
1 号发票已退款
RefundError: 1 号发票状态是 refunded,只有 paid 的才能退款
RefundError: 3 号发票状态是 unpaid,只有 paid 的才能退款
RefundError: 没有 999 号发票
现在 1 号发票: refunded
```

</details>

**练习 2:按套餐汇总某个月的开票金额。** 写 `revenue_by_plan(conn, month)`:某个月的发票按客户的套餐分组,返回每种套餐的张数和金额合计,金额大的在前。月份先过 `check_month`。试 `2026-09`、`2026-10`(先开票)、`2026-11`(还没有)。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex94_2_by_plan.py
import sqlite3
from pathlib import Path

from part01.db import db
from part01.ledger.billing import bill_month, check_month
from part01.ledger.seed import build

EX_DB = Path(__file__).parent / "ledger" / "ex.db"


def revenue_by_plan(conn: sqlite3.Connection, month: str) -> list[sqlite3.Row]:
    """某个月的发票按客户套餐汇总:张数、金额合计。"""
    check_month(month)
    return conn.execute(
        """
        SELECT c.plan, count(*) AS n, sum(i.amount) AS total
        FROM invoices i
        JOIN customers c ON c.id = i.customer_id
        WHERE substr(i.issued_at, 1, 7) = ?
        GROUP BY c.plan
        ORDER BY total DESC
        """,
        (month,),
    ).fetchall()


build(EX_DB)
with db(EX_DB) as conn:
    bill_month(conn, "2026-10")
with db(EX_DB, read_only=True) as conn:
    for month in ("2026-09", "2026-10", "2026-11"):
        rows = revenue_by_plan(conn, month)
        print(month, [(r["plan"], r["n"], r["total"]) for r in rows] or "没有发票")
EX_DB.unlink()
```

<div class="line-notes">

- `from part01.ledger.billing import bill_month, check_month` 复用项目里的函数,包括 `check_month`;`build` 仍然来自 `seed.py`。
- `check_month(month)` 进数据库之前先过格式检查。
- `SELECT c.plan, count(*) AS n, sum(i.amount) AS total` 套餐在客户表里,金额在发票表里,所以要连接。
- `JOIN customers c ON c.id = i.customer_id` 内连接,每张发票找到它的客户。
- `WHERE substr(i.issued_at, 1, 7) = ?` 把开票日截成 `YYYY-MM` 再和参数比。**注意**:对列套函数会让索引用不上(Day 89),表小无所谓,大表要改写成范围条件 `issued_at >= ? AND issued_at < ?`。
- `GROUP BY c.plan` 按套餐分组。
- `ORDER BY total DESC` 金额大的在前。
- `build(EX_DB)` 建一个干净的临时库。
- `bill_month(conn, "2026-10")` 先开 10 月的票。
- `print(month, [(r["plan"], r["n"], r["total"]) for r in rows] or "没有发票")` 把每行转成元组;`rows` 为空时列表是空的,`or` 会取后面的「没有发票」(Day 14 的真假值)。

</div>

```text
2026-09 [('企业版', 2, 44775), ('专业版', 4, 5841), ('基础版', 2, 195)]
2026-10 [('企业版', 2, 44775), ('专业版', 4, 5841), ('基础版', 4, 429)]
2026-11 没有发票
```

核对:2026-09 企业版 2 张(16915 + 27860 = 44775)、专业版 4 张(1188 + 1980 + 1782 + 891 = 5841)、基础版 2 张(117 + 78 = 195)。2026-10 多了 6 号和 10 号两家基础版客户,基础版变成 4 张、429(117 + 195 + 78 + 39)。

</details>

**练习 3:开票先预览。** 给 `bill_month` 加一个 `dry_run` 参数:默认只返回「将要开哪些票」的预览(客户、公司、金额),不写库;`dry_run=False` 才真的写。这是 Agent 工具「预演后再确认」的基本模式。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex94_3_dry_run.py
import sqlite3
from pathlib import Path

from part01.db import db
from part01.ledger.schema import PRICES
from part01.ledger.billing import check_month
from part01.ledger.seed import build

EX_DB = Path(__file__).parent / "ledger" / "ex.db"


def plan_month(conn: sqlite3.Connection, month: str) -> list[dict]:
    """只算不写:这个月会给哪些客户开多少钱的发票。"""
    check_month(month)
    issued = f"{month}-01"
    todo = conn.execute(
        """
        SELECT c.id, c.company, c.plan, c.seats
        FROM customers c
        LEFT JOIN invoices i ON i.customer_id = c.id AND i.issued_at = ?
        WHERE i.id IS NULL AND c.created_at < ?
        ORDER BY c.id
        """,
        (issued, issued),
    ).fetchall()
    return [
        {"customer_id": r["id"], "company": r["company"], "amount": r["seats"] * PRICES[r["plan"]], "issued_at": issued}
        for r in todo
    ]


def bill_month(conn: sqlite3.Connection, month: str, dry_run: bool = True) -> list[dict]:
    """dry_run=True(默认)只返回预览;False 才真的写入。"""
    plan = plan_month(conn, month)
    if not dry_run:
        conn.executemany(
            "INSERT INTO invoices (customer_id, amount, status, issued_at) VALUES (?, ?, 'unpaid', ?)",
            [(p["customer_id"], p["amount"], p["issued_at"]) for p in plan],
        )
    return plan


if __name__ == "__main__":
    build(EX_DB)
    with db(EX_DB) as conn:
        preview = bill_month(conn, "2026-10")
        print(f"预览:将给 {len(preview)} 个客户开票,合计 {sum(p['amount'] for p in preview)}")
        print("前两条:", preview[:2])
        print("现在库里的发票数:", conn.execute("SELECT count(*) FROM invoices").fetchone()[0])
        bill_month(conn, "2026-10", dry_run=False)
        print("真开之后发票数:", conn.execute("SELECT count(*) FROM invoices").fetchone()[0])
        print("再预览一次:", bill_month(conn, "2026-10"))
    EX_DB.unlink()
```

<div class="line-notes">

- `def plan_month(conn: sqlite3.Connection, month: str) -> list[dict]:` 把「算出要开什么」单独拆成一个纯查询函数,不写库。
- `SELECT c.id, c.company, c.plan, c.seats` 比项目里的版本多取了公司名,预览给人看的时候要用。
- `{"customer_id": r["id"],` 返回字典列表(列表推导式里每个元素是一个字典),每个字典是一张将要开的发票。
- `def bill_month(conn: sqlite3.Connection, month: str, dry_run: bool = True) -> list[dict]:` `dry_run` 默认 `True`:**默认安全**,忘了传参数也不会写库。
- `plan = plan_month(conn, month)` 无论预览还是真开,都先算计划。
- `if not dry_run:` 只有明确传 `dry_run=False` 才执行下面的写入。
- `"INSERT INTO invoices (customer_id, amount, status, issued_at) VALUES (?, ?, 'unpaid', ?)",` `'unpaid'` 写在 SQL 里,因为它是固定值不是外部输入,只剩三个 `?`。
- `[(p["customer_id"], p["amount"], p["issued_at"]) for p in plan],` 把字典转回元组,顺序要和三个 `?` 对上。
- `return plan` 不管写没写,都把计划返回。
- `if __name__ == "__main__":` 直接运行这个文件时才执行下面的演示;被别的文件 `import` 时不执行(练习 5 就会 `import` 它)。
- `print(f"预览:将给 {len(preview)} 个客户开票,合计 {sum(p['amount'] for p in preview)}")` 生成器表达式求和:把 10 张发票的金额加起来,51045。
- `print("现在库里的发票数:"` 预览之后还是 14,没写。
- `bill_month(conn, "2026-10", dry_run=False)` 真开,24。
- `print("再预览一次:", bill_month(conn, "2026-10"))` 开完再预览,计划是空列表 `[]`。

</div>

```text
预览:将给 10 个客户开票,合计 51045
前两条: [{'customer_id': 1, 'company': '星河餐饮', 'amount': 1188, 'issued_at': '2026-10-01'}, {'customer_id': 2, 'company': '青木设计', 'amount': 117, 'issued_at': '2026-10-01'}]
现在库里的发票数: 14
真开之后发票数: 24
再预览一次: []
```

</details>

**练习 4:迁移核对。** 写 `verify_migration(old_path, ledger_path)`:比较「旧库发票张数、总额」和「新库发票 + 孤儿档案」是否一致,返回一个字典(含 `ok`)。然后故意删掉新库里一张发票,看它能不能发现。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex94_4_verify.py
import sqlite3
from pathlib import Path

from part01.db import db
from part01.ledger.seed import LEDGER_DB, OLD_DB, build


def verify_migration(old_path: Path, ledger_path: Path) -> dict[str, int | bool]:
    """旧库发票总额,应该等于 新库发票总额 + 孤儿档案总额;张数同理。"""
    old = sqlite3.connect(f"{old_path.as_uri()}?mode=ro", uri=True)
    old_n, old_total = old.execute("SELECT count(*), sum(amount) FROM invoices").fetchone()
    old.close()
    with db(ledger_path, read_only=True) as conn:
        new_n, new_total = conn.execute("SELECT count(*), sum(amount) FROM invoices").fetchone()
        orp_n, orp_total = conn.execute("SELECT count(*), coalesce(sum(amount), 0) FROM invoices_orphans").fetchone()
    return {
        "old_count": old_n, "old_total": old_total,
        "new_count": new_n, "new_total": new_total,
        "orphan_count": orp_n, "orphan_total": orp_total,
        "ok": old_n == new_n + orp_n and old_total == new_total + orp_total,
    }


build()
print(verify_migration(OLD_DB, LEDGER_DB))

with db(LEDGER_DB) as conn:
    conn.execute("DELETE FROM invoices WHERE id = 14")  # 故意弄丢一张 891 的发票
print("丢了一张之后:", verify_migration(OLD_DB, LEDGER_DB))
build()
```

<div class="line-notes">

- `def verify_migration(old_path: Path, ledger_path: Path) -> dict[str, int | bool]:` 返回字典,值可以是整数,也可以是布尔(`ok`)。
- `old_n, old_total = old.execute("SELECT count(*), sum(amount) FROM invoices").fetchone()` 一行两列直接解包成两个变量(Day 22)。这里的 `old` 没设 `row_factory`,取出来是普通元组,正好能解包。
- `new_n, new_total = conn.execute(` 新库的发票张数和总额。
- `orp_n, orp_total = conn.execute("SELECT count(*), coalesce(sum(amount), 0) FROM invoices_orphans").fetchone()` 档案表可能为空,`coalesce` 保证总额是数字不是 `None`。
- `"ok": old_n == new_n + orp_n and old_total == new_total + orp_total,` 核对的关键:**张数和金额两个都要对得上**。只对金额,恰好一张多一张少也能蒙混过去。
- `build()` 重建一个新库。
- `print(verify_migration(OLD_DB, LEDGER_DB))` 实测旧库 15 张 100017,新库 14 张 99861,档案 1 张 156,`ok` 为 `True`。
- `conn.execute("DELETE FROM invoices WHERE id = 14")  # 故意弄丢一张 891 的发票` 14 号发票金额 891。
- `print("丢了一张之后:"` 实测新库 13 张 98970,98970 + 156 = 99126 ≠ 100017,`ok` 变成 `False`,抓到了。
- `build()` 最后重建一次,把库还原。

</div>

```text
{'old_count': 15, 'old_total': 100017, 'new_count': 14, 'new_total': 99861, 'orphan_count': 1, 'orphan_total': 156, 'ok': True}
丢了一张之后: {'old_count': 15, 'old_total': 100017, 'new_count': 13, 'new_total': 98970, 'orphan_count': 1, 'orphan_total': 156, 'ok': False}
```

</details>

**练习 5:两个人同时开同一个月的票。** 模拟两个连接:都先「算计划」(都看到 10 张要开),`a` 先插入并提交,`b` 再插入。看 `b` 会怎样,最终库里有几张发票。这道题说明为什么 `bill_month` 里的 `LEFT JOIN` 检查不够,`UNIQUE (customer_id, issued_at)` 才是最后一道门。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex94_5_race.py
import sqlite3
from pathlib import Path

from part01.ex94_3_dry_run import plan_month
from part01.ledger.seed import build

EX_DB = Path(__file__).parent / "ledger" / "ex.db"
INSERT = "INSERT INTO invoices (customer_id, amount, status, issued_at) VALUES (?, ?, 'unpaid', ?)"


def rows_of(plan: list[dict]) -> list[tuple]:
    return [(p["customer_id"], p["amount"], p["issued_at"]) for p in plan]


def invoice_count() -> int:
    raw = sqlite3.connect(EX_DB)
    n = raw.execute("SELECT count(*) FROM invoices").fetchone()[0]
    raw.close()
    return n


build(EX_DB)
a = sqlite3.connect(EX_DB)
b = sqlite3.connect(EX_DB)
for c in (a, b):
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = ON")

plan_a = plan_month(a, "2026-11")
plan_b = plan_month(b, "2026-11")
print("a 算出要开", len(plan_a), "张;b 也算出要开", len(plan_b), "张(两人同时看到的是同一个旧状态)")

a.executemany(INSERT, rows_of(plan_a))
a.commit()
print("a 提交后,发票共", invoice_count(), "张")

try:
    b.executemany(INSERT, rows_of(plan_b))
    b.commit()
except sqlite3.IntegrityError as e:
    b.rollback()
    print("b 写入失败:", type(e).__name__, e)

print("最终发票共", invoice_count(), "张(不是 34)")
a.close()
b.close()
EX_DB.unlink()
```

<div class="line-notes">

- `from part01.ex94_3_dry_run import plan_month` 复用练习 3 的预览函数。
- `INSERT = "INSERT INTO invoices (customer_id, amount, status, issued_at) VALUES (?, ?, 'unpaid', ?)"` 插入语句提成常量,两个连接共用。
- `def rows_of(plan: list[dict]) -> list[tuple]:` 把计划里的字典转成插入用的元组。
- `def invoice_count() -> int:` 另开一个连接数发票张数。
- `a = sqlite3.connect(EX_DB)` / `b = sqlite3.connect(EX_DB)` 两个连接,模拟两个同时运行的开票程序。
- `for c in (a, b):` 对两个连接各做同样的设置。
- `c.row_factory = sqlite3.Row` `plan_month` 里用了 `r["id"]` 这种按名字取,所以必须设。
- `c.execute("PRAGMA foreign_keys = ON")` 外键开关(这里两个连接还没开始事务,开得上)。
- `plan_a = plan_month(a, "2026-11")` a 看到:2026-11 还没有发票,要开 10 张。
- `plan_b = plan_month(b, "2026-11")` b **同时**看到同一个旧状态,也认为要开 10 张。读操作没有开事务,没有锁,两边互不知道对方。
- `a.executemany(INSERT, rows_of(plan_a))` a 插入 10 张。
- `a.commit()` a 提交,库里变成 24 张。
- `b.executemany(INSERT, rows_of(plan_b))` b 按旧计划插入同样 10 张,第一张(1 号客户 2026-11-01)就撞上 `UNIQUE`。
- `except sqlite3.IntegrityError as e:` 实测 `UNIQUE constraint failed: invoices.customer_id, invoices.issued_at`。
- `b.rollback()` b 回滚,它那次插入一张都不留。
- `print("最终发票共", invoice_count(), "张(不是 34)")` 14 + 10 + 10 = 34 是没有约束时的结果,实测 24。

</div>

```text
a 算出要开 10 张;b 也算出要开 10 张(两人同时看到的是同一个旧状态)
a 提交后,发票共 24 张
b 写入失败: IntegrityError UNIQUE constraint failed: invoices.customer_id, invoices.issued_at
最终发票共 24 张(不是 34)
```

结论:检查和写入之间永远有空隙,别人可以钻进来。程序里的检查是为了「正常情况下少出错、报错友好」,约束才是「怎样都不会错」。两者都要。

</details>

验收标准:五道题都在自己终端里跑通;能不看文章默写 `bill_month`(尤其是 `LEFT JOIN ... AND i.issued_at = ?` 加 `WHERE i.id IS NULL` 这一对);能说出这个项目里每一层防线各挡什么:`CHECK`、外键、联合唯一、`LEFT JOIN` 检查、事务、`audit`;`uv run pytest` 全部通过(27 个)。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 联合唯一 / 表级约束(`UNIQUE (a, b)`) | 几个列的**组合**不能重复,写在建表语句的列清单后面 |
| 孤儿档案表(`invoices_orphans`) | 专门存放不合规数据的表,不加约束,方便日后追查 |
| 分流 | 导入前先把数据分成「合规」和「不合规」两堆,各走各的路 |
| 幂等(idempotent) | 同一个操作重复执行多次,结果和执行一次相同;`bill_month` 重复运行不会重复开票 |
| `LEFT JOIN ... IS NULL` | 找「某表里没有对应行」的那一批,Day 87 的写法 |
| 命名占位符 | `:name` 形式的占位符,参数传字典,按名字对应 |
| `executemany` | 同一条 SQL 配一批参数,一次执行 |
| 预演(dry run) | 只算会发生什么,不真的改数据 |
| 退出码 | 程序结束时返回给终端的数字,0 是成功,非 0 是失败 |
| `python -m 包名` | 运行包里的 `__main__.py`,从项目根目录执行 |
| 自检(audit) | 程序自己检查库的一致性,比如外键违规、总额对账 |
| `monkeypatch` | pytest 的工具,测试期间临时替换某个值,测完还原 |
| 自动索引(autoindex) | `UNIQUE` 和主键约束在背后自动建的索引,名字形如 `sqlite_autoindex_...` |

## 常见误区

**以为外键约束建好了,旧数据就能原样灌进去。** 实测 15 张整批灌入,第 15 张失败,事务把前 14 张也撤了,发票表是 0 行。导入之前要先分流,不合规的单独存档。

**导入前不核对总数。** 搬完以后一定对一遍「旧 = 新 + 档案」(张数和金额都要),实测总额 99861 + 156 = 100017 才放心。只核对金额会被「一张多一张少」蒙混过去。

**以为程序里的检查就够了,约束可以省。** 练习 5 里两个人同时开票,两边的检查都通过了,只有 `UNIQUE (customer_id, issued_at)` 拦住了第二批,最终 24 张而不是 34 张。

**先删旧库,再检查源数据在不在。** 源数据不在时,现成的账单库就白白没了。破坏性的操作放在所有检查之后。

**对 `invoices` 重复建索引。** `UNIQUE (customer_id, issued_at)` 已经自动建了以 `customer_id` 打头的索引,实测按客户查用的就是它(`sqlite_autoindex_invoices_1`)。再建一个 `customer_id` 单列索引,只会拖慢写入。

**只按第二列查联合索引。** 实测只按 `issued_at` 查,执行计划是 `SCAN`,用不上这个索引。联合索引的最左前缀(Day 89)今天又应验了一次。

**报表用可写连接。** 报表命令只读,用 `read_only=True`,出 bug 也不会误改数据。

**命令行直接改库,以为约束一定在。** `sqlite3` 命令行默认不开外键,实测手插一张孤儿发票成功了,是自检里的 `fk_violations` 抓到的。

**把 `ledger.db` 提交进 git。** 它是可以随时用 `build` 重建的产物。想让它别进版本库,往 `.gitignore` 里加一行 `part01/ledger/*.db`。

## 学习资料

### 文档与文章

- [SQLite 官方 · CREATE TABLE(英文)](https://sqlite.org/lang_createtable.html):表级 `UNIQUE (a, b)`、`CHECK`、外键的完整语法。
- [SQLite 官方 · The SQLite Query Planner(英文)](https://sqlite.org/queryplanner.html):为什么「以 `customer_id` 打头的联合索引」能给单查 `customer_id` 用,而反过来不行。
- [Python 官方文档 · sqlite3(英文,有中文版)](https://docs.python.org/3/library/sqlite3.html):`executemany`、命名占位符、`row_factory` 都在这里。
- [Python 官方文档 · runpy / `-m` 选项](https://docs.python.org/3/using/cmdline.html#cmdoption-m):`python -m` 到底怎么找到并执行 `__main__.py`。
- [菜鸟教程 · SQLite 约束](https://www.runoob.com/sqlite/sqlite-constraints.html):中文速查。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1cQPKz2Ez5&autoplay=0&high_quality=1" title="Python + 数据库SQLite,数据操作如此简单" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>一心向白昼 · Python + 数据库SQLite,数据操作如此简单 · 约 11 分钟,播放 1 千 8,2026 年发布。短,用 Python 操作 SQLite 的整体流程,可以先看它对照今天的 `seed.py`;视频内容没有逐段核对,以文章里的实测为准。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Pg4y1a7a7&autoplay=0&high_quality=1" title="Python 数据库实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>POUR_OVER · Python 数据库实战 · 约 92 分钟,播放 9 万,2020 年发布。时间长,不用全看;想看一个更大的、同样「建表、造数、查询」的完整例子时,挑着看。同样没有逐段核对,和今天文章不一致的地方以文章为准。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/byHcYRpMgI4" title="SQLite Databases With Python - Full Course" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>freeCodeCamp.org · SQLite Databases With Python - Full Course · 英文,可开字幕。较长的完整课程,从建库到查询、批量插入,可以当作今天项目的另一种讲法,挑想补的部分看。</figcaption>
</figure>

### 书籍

- Harry Percival、Bob Gregory,《Architecture Patterns with Python》(O'Reilly,2020)。作者在 [cosmicpython.com](https://www.cosmicpython.com/) 上免费放出全文。讲「仓库模式」「工作单元」,今天的 `with db()` 就是一个最小的工作单元(一次业务操作里的所有写,一起成功或一起失败)。没有读过中文版,这里只写英文原版;现在读会偏重,等第七部分做服务时回来看。
- Ben Forta,《SQL必知必会》(第 5 版),人民邮电出版社。项目里的查询(连接、分组、聚合、子查询)和书里几章一一对应,忘了写法就翻它。

### 开源项目与代码

- [simonw/sqlite-utils](https://github.com/simonw/sqlite-utils):Simon Willison 写的 Python 库和命令行,用来更快地操作 SQLite 数据库。读它的 `db.py`,看成熟的项目怎么封装「建表、批量插入、读成字典」,和今天你手写的 `seed.py` 对照。

## 自测

1. `UNIQUE (customer_id, issued_at)` 允许 1 号客户在 9 月 1 号和 10 月 1 号各有一张发票吗?允许 1 号客户和 2 号客户在同一天都有发票吗?

<details><summary>答案</summary>

两个都允许。联合唯一约束限制的是「`customer_id` 和 `issued_at` 这对组合」不能重复,不是限制单独某一列。(1, 2026-09-01) 和 (1, 2026-10-01) 是两个不同的组合,(1, 2026-09-01) 和 (2, 2026-09-01) 也是。不允许的只有同一个客户在同一个日期出现第二次。

</details>

2. `bill_month` 里的 `LEFT JOIN invoices i ON i.customer_id = c.id AND i.issued_at = ?` 后面接 `WHERE i.id IS NULL`。如果把 `AND i.issued_at = ?` 挪到 `WHERE` 里,会怎样?

<details><summary>答案</summary>

行为会变:`WHERE i.issued_at = ? AND i.id IS NULL` 里 `i.issued_at = ?` 要求 `i` 那边有值,又同时要求 `i.id` 是 NULL,两个条件互相矛盾,结果永远是空,一张票也开不出来。条件写在 `ON` 里,是「连接的时候就限定只连这个月的发票」,没连上的客户保留下来(`i` 全是 NULL),`WHERE i.id IS NULL` 再把它们挑出来。这是 `LEFT JOIN` 里条件放 `ON` 还是放 `WHERE` 的经典区别。

</details>

3. 迁移时为什么孤儿发票不直接丢掉,而要放进 `invoices_orphans`?这张表为什么故意不加约束?

<details><summary>答案</summary>

直接丢掉,日后有人问「那 156 元去哪了」就无从查起,而且总额对不上(100017 对 99861)。存档保证「旧 = 新 + 档案」可以核对。档案表不加约束,因为它存的就是不合规的东西(客户不存在、可能还有别的毛病),加了约束反而存不进去。

</details>

4. 为什么 `build` 里「检查旧库在不在」要写在 `unlink` 之前?

<details><summary>答案</summary>

`unlink` 会删掉现成的账单库,是破坏性操作。如果先删再检查,旧库不在时检查失败,账单库已经没了,既没有新库也丢了旧的。把检查放前面,检查失败就直接报错退出,现有的账单库原封不动(实测挪走 `practice.db` 后 `build`,账单库文件大小不变)。

</details>

5. 面试题:你做的 Agent 有一个「给客户开本月账单」的工具,模型有时会因为超时重试,有时用户会同时点两次。你怎么设计,才能保证每个客户每月只有一张账单?

<details><summary>答案</summary>

分层:①数据库层,发票表加 `UNIQUE (customer_id, issued_at)`(或「客户 + 账期」),重复插入一定失败,不依赖任何代码路径,这是最后一道门。②应用层,开票函数先查「这个月还没开的客户」(`LEFT JOIN ... IS NULL`),已经开过的直接跳过,让重复调用变成无害的空操作(幂等),返回「已开 0 张」。③事务层,一批客户的开票放进同一个事务,中途出错整批回滚,不留一半。④并发时检查和写入之间有空隙(今天练习 5),所以要接受撞上唯一约束的那次失败,把它当成「已经有人开过了」,而不是系统错误。⑤工具对模型返回清楚的结果:新开了几张、跳过了几张,模型重试时不会误以为失败。

</details>

6. 面试题:数据迁移上线前,你怎么证明「没丢数据、没多数据」?

<details><summary>答案</summary>

做对账:迁移前后同时算几个**不变量**。张数(旧 = 新 + 被隔离的)、金额合计(同理)、关键维度的分组合计(按客户、按月)。今天的做法:旧库 15 张 100017,新库 14 张 99861,孤儿档案 1 张 156,张数和金额都能加平。再配上约束自检(外键违规为 0)。要能重复:迁移脚本可以随时从头再跑(幂等),对账脚本能独立运行,发现不一致时立刻报警而不是悄悄通过(练习 4 故意删一张,`ok` 变成 `False`)。大表还要在上线前用一份生产数据的副本演练一遍,而不是第一次就对真库跑。

</details>

## 明天预告

Day 95 · JSON Schema:描述数据长什么样的标准。到今天为止,你写过的每个工具函数,参数的合法范围都是靠 Python 代码里的 `if` 和白名单检查的(比如 `check_month`、`PLANS`)。明天换一种写法:用 JSON Schema 把「这个参数是什么类型、哪些必填、取值范围」写成一份普通的 JSON 数据,让别人(包括大模型)不看代码就知道怎么调用。这正是后面「函数调用」(模型怎么知道你的工具有什么参数)要用的东西。
