---
title: 'Day 97 · 第 14 周复习:编程地基(Day 91–96)'
description: '这一周从数据库的约束和事务,到 Python 操作 SQLite、账单库项目,再到 JSON Schema 和装饰器。今天把六天画成一张图,默写 db()、timed 和一份 schema,再用一个小项目把它们全接起来:给账单库做一层「能让 Agent 调用的工具」,参数先过 schema、再进事务、再撞数据库约束,每一道门拒绝的原因都变成一条 error 回给调用方。'
pubDate: 2026-10-27
regime: none
tags: ['review', 'sqlite', 'json-schema', 'decorator', 'python', 'agent-zero']
series: 'agent-zero'
day: 97
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 96](/blog/agent-zero/day-096-decorators/) 讲了装饰器:`@timed` 只是 `func = timed(func)` 的一行写法,函数是一个值,可以传进去、再传出来。装饰器有两种做法,包一层(返回 `wrapper`,要用 `functools.wraps` 抄名牌)和只登记(把函数写进一张表,原样返回),带参数的装饰器是三层。最后那个 `@tool` 用 `inspect` 从类型标注生成 JSON Schema,和 [Day 95](/blog/agent-zero/day-095-json-schema/) 的 `jsonschema` 接上了。

这是第 14 周的最后一天。这一周的六天看起来是三件不相干的事:数据库怎么守住数据(Day 91 到 94)、怎么描述数据长什么样(Day 95)、怎么给函数包一层(Day 96)。今天不学新东西,先把它们画成一张图,再做一个小项目证明它们其实是一条线:Agent 的工具函数要查库、要写库,参数得先验、写库得带事务、失败得回一条能读懂的错误。

## 今天要解决的问题

1. 对着一张图说出这周六天各自解决什么问题,并能说出每个坑发生在哪一天。
2. 合上文章默写两段核心代码并跑通:Day 93 的 `db()`(`@contextmanager` 加提交、回滚、关闭),Day 96 的 `timed` 和带参数装饰器的三层结构。
3. 完成本周小项目 `part01/ledger_tools.py`:五个账单工具,用带参数的登记型装饰器挂上各自的 schema,执行前先过 schema,执行时放进 `with db()`,失败按「工具名不对、JSON 坏了、参数不合 schema、找不到、业务拒绝、数据库拒绝」六种原因分类回给调用方;配 10 个 pytest 测试。
4. 做完练习,其中两道是闭卷默写。

预计用时 3.5 小时。花费 ¥0,不调模型,不联网。

前置:本周的 [Day 91](/blog/agent-zero/day-091-sql-6/) 到 [Day 96](/blog/agent-zero/day-096-decorators/)。仓库里应该已经有 Day 93 建的 `part01/db.py`、Day 94 建的 `part01/ledger/` 包(`schema.py`、`seed.py`、`billing.py`、`queries.py`)和 Day 96 建的 `part01/timing.py`,以及 Day 95 装好的 `jsonschema`(`uv add jsonschema`)。开始前在仓库根目录跑一遍 `uv run python -m part01.ledger build`,确认输出 `已重建: {'customers': 10, 'invoices': 14, 'orphans': 1}`。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。复习日最要紧的是闭卷:练习 1 和练习 2 请真的把文章关掉写,写完再展开答案对。

## 本周知识地图

左边四天是「数据落进库里」这条线:约束和事务决定库**肯不肯收**,sqlite3 和 `?` 决定 Python **怎么递**,`db()` 把开、提交、回滚、关封成一个 `with`,账单库项目把它们拼成能用的东西。下面两天是「数据在程序之间**怎么传**」这条线:schema 描述参数该长什么样,装饰器把函数登记起来。右边的小项目把两条线接在一个地方:`call()`。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="第 14 周知识地图:上面一行是 Day 91 约束和事务、Day 92 sqlite3 和问号占位符、Day 93 事务和 db 上下文管理器、Day 94 账单库项目;下面一行是 Day 95 JSON Schema 和 Day 96 装饰器;右侧小项目 ledger_tools 把 schema、装饰器和 db 接在一起">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="16" y="24" fill="var(--ink)">Day 91–94 · 数据怎么守</text>
<rect x="16" y="34" width="100" height="48" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="66" y="54" fill="var(--ink)" text-anchor="middle">91 约束 事务</text>
<text x="66" y="71" fill="var(--ink-soft)" text-anchor="middle" font-size="11">库自己拒绝</text>
<rect x="136" y="34" width="100" height="48" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="186" y="54" fill="var(--ink)" text-anchor="middle">92 sqlite3</text>
<text x="186" y="71" fill="var(--ink-soft)" text-anchor="middle" font-size="11">? 占位符</text>
<rect x="256" y="34" width="100" height="48" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="306" y="54" fill="var(--ink)" text-anchor="middle">93 db()</text>
<text x="306" y="71" fill="var(--ink-soft)" text-anchor="middle" font-size="11">提交 回滚 关闭</text>
<rect x="376" y="34" width="100" height="48" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="426" y="54" fill="var(--ink)" text-anchor="middle">94 账单库</text>
<text x="426" y="71" fill="var(--ink-soft)" text-anchor="middle" font-size="11">建表 造数 查询</text>
<line x1="116" y1="58" x2="136" y2="58" stroke="var(--rule)"/>
<line x1="236" y1="58" x2="256" y2="58" stroke="var(--rule)"/>
<line x1="356" y1="58" x2="376" y2="58" stroke="var(--rule)"/>
<text x="16" y="126" fill="var(--ink)">Day 95–96 · 数据怎么传、函数怎么包</text>
<rect x="16" y="136" width="100" height="48" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="66" y="156" fill="var(--ink)" text-anchor="middle">95 schema</text>
<text x="66" y="173" fill="var(--ink-soft)" text-anchor="middle" font-size="11">iter_errors</text>
<rect x="136" y="136" width="100" height="48" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="186" y="156" fill="var(--ink)" text-anchor="middle">96 装饰器</text>
<text x="186" y="173" fill="var(--ink-soft)" text-anchor="middle" font-size="11">wraps 三层 登记</text>
<line x1="116" y1="160" x2="136" y2="160" stroke="var(--rule)"/>
<line x1="476" y1="58" x2="504" y2="58" stroke="var(--rule)"/>
<line x1="236" y1="160" x2="504" y2="130" stroke="var(--rule)" stroke-dasharray="4 3"/>
<rect x="504" y="34" width="124" height="150" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="566" y="56" fill="var(--ink)" text-anchor="middle">小项目</text>
<text x="566" y="80" fill="var(--ink-soft)" text-anchor="middle" font-size="11">ledger_tools.py</text>
<text x="566" y="100" fill="var(--ink-soft)" text-anchor="middle" font-size="11">@tool(schema)</text>
<text x="566" y="116" fill="var(--ink-soft)" text-anchor="middle" font-size="11">call() 先验参数</text>
<text x="566" y="132" fill="var(--ink-soft)" text-anchor="middle" font-size="11">with db() 带事务</text>
<text x="566" y="148" fill="var(--ink-soft)" text-anchor="middle" font-size="11">错误回成 JSON</text>
<text x="566" y="168" fill="var(--ink)" text-anchor="middle" font-size="11">→ Day 157 起接模型</text>
<text x="16" y="222" fill="var(--ink-soft)" font-size="11">蓝=数据库那一侧,琥珀=对外传话那一侧。虚线:schema 和装饰器在小项目里一起管「调用方给的参数」。</text>
</g>
</svg>
<figcaption>第 14 周知识地图。蓝色四天教库怎么守住数据,琥珀两天教参数怎么描述和登记,小项目里的 call() 是两条线的交汇点。</figcaption>
</figure>

## 本周每天一句话

- [Day 91](/blog/agent-zero/day-091-sql-6/) 约束(`PRIMARY KEY`、`NOT NULL`、`UNIQUE`、`CHECK`、外键)让数据库自己拒绝脏数据,但 SQLite 的外键默认关、每个连接都要 `PRAGMA foreign_keys = ON`;事务(`BEGIN`/`COMMIT`/`ROLLBACK`)把几步捆成一件事,出错要主动回滚,否则前面的修改会被后面的 `COMMIT` 一起提交(余额被多扣成 624)。
- [Day 92](/blog/agent-zero/day-092-python-sqlite-1/) 在 Python 里用 `sqlite3` 查库,用 f-string 拼 SQL 会被 `' OR '1'='1` 拖出整张表,正确做法是 `?` 占位符,把值和命令分开;占位符只能换值,不能换表名、列名和排序方向。
- [Day 93](/blog/agent-zero/day-093-python-sqlite-2/) 写了不 `commit()` 就不算数;`with conn:` 只管提交和回滚、不关连接;`row_factory = sqlite3.Row` 让每一行有名字;最后把「开连接、成功提交、失败回滚、一定关闭」封成 `@contextmanager` 的 `db()`。
- [Day 94](/blog/agent-zero/day-094-ledger-project/) CloudLedger 迷你账单库:带约束的两张表、搬旧数据时把孤儿发票分流存档、按月开票且重复运行不重复、四个查询、一个命令行入口,搬完要核对「旧 = 新 + 档案」(99861 + 156 = 100017)。
- [Day 95](/blog/agent-zero/day-095-json-schema/) JSON Schema 把「字段是什么类型、哪些必填、能取哪些值」写成一份数据,`jsonschema` 的 `iter_errors` 一次报全所有错;`additionalProperties: false` 才会拦多余字段;pydantic 的 `model_json_schema()` 生成的是同一种东西,区别是 pydantic 会转换、jsonschema 只判断。
- [Day 96](/blog/agent-zero/day-096-decorators/) 装饰器是 `func = deco(func)` 的一行写法;包一层的要 `functools.wraps`,带参数的是三层,登记型的只记一笔、原样返回函数,路由、fixture、工具注册都是这一类。

## 本周要默写的核心代码

默写三样,都在今天的练习里,请闭卷。

| 默写什么 | 从哪天来 | 写完要能证明 |
| --- | --- | --- |
| `db(path, read_only=False)`:`@contextmanager`、只读用 URI、`row_factory`、开外键、`try/yield/commit`、`except/rollback/raise`、`finally/close` | Day 93 | 成功提交、出错回滚且异常照抛、出 `with` 后连接已关、外键真的开着 |
| `timed`(带 `functools.wraps`)和三层的带参数版本 | Day 96 | 返回值原样、函数名和 docstring 没丢、参数版在阈值内不打印 |
| 一份「新建发票」参数的 schema:`type`、`properties`、`required`、`minimum`、`pattern`、`additionalProperties` | Day 95 | 练习 3 里五种错误参数都被拦住 |

默写的目的不是背下来,是暴露「看懂了但手上没有」的地方。最容易漏的是 `except` 里的那句 `raise`:漏了它,异常被悄悄吞掉,`with` 块里出了错程序还继续往下走,和 Day 93 常见误区里「捕获了异常却照样提交」是近亲。写完先自己对,再看答案。

## 本周小项目:给账单库做一层工具

先说要做什么。第三部分(Day 156 起)你会把「工具」发给大模型:模型看到工具的名字、说明和参数 schema,决定调哪个、传什么参数,你的程序执行,再把结果回给它。到那时你要的工具层长这样:

- 能按名字登记一批函数,每个函数带着自己的参数 schema。
- 模型传来的是一段 JSON 字符串,不是 Python 对象,什么错都可能有:工具名编错、JSON 少个引号、字段类型不对、多传了一个没定义的参数。
- 写库的工具必须在一个事务里,出任何错都整件事撤回。
- 失败**不能让程序崩**,要回一条模型读得懂的错误,让它下一轮改。

今天用已经有的账单库把这一层先做出来,不调模型,调用方是我们自己写的几行脚本。所有零件都是这一周学过的,没有新概念。

### 先看一眼:一次调用要过五道门

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="call 函数的五道门:工具名、JSON 解析、schema 校验这三道在打开数据库之前,业务判断和数据库约束这两道在 with db 里面;每一道失败各回一种 error 类别">
<rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="12" y="30" width="112" height="64" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="68" y="54" fill="var(--ink)" text-anchor="middle">① 工具名</text>
<text x="68" y="74" fill="var(--ink-soft)" text-anchor="middle" font-size="11">unknown_tool</text>
<rect x="136" y="30" width="112" height="64" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="192" y="54" fill="var(--ink)" text-anchor="middle">② JSON</text>
<text x="192" y="74" fill="var(--ink-soft)" text-anchor="middle" font-size="11">bad_json</text>
<rect x="260" y="30" width="112" height="64" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="316" y="54" fill="var(--ink)" text-anchor="middle">③ schema</text>
<text x="316" y="74" fill="var(--ink-soft)" text-anchor="middle" font-size="11">bad_arguments</text>
<rect x="384" y="30" width="112" height="64" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="440" y="54" fill="var(--ink)" text-anchor="middle">④ 业务判断</text>
<text x="440" y="74" fill="var(--ink-soft)" text-anchor="middle" font-size="11">not_found</text>
<text x="440" y="88" fill="var(--ink-soft)" text-anchor="middle" font-size="11">rejected</text>
<rect x="508" y="30" width="120" height="64" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="568" y="54" fill="var(--ink)" text-anchor="middle">⑤ 数据库约束</text>
<text x="568" y="74" fill="var(--ink-soft)" text-anchor="middle" font-size="11">db_rejected</text>
<line x1="124" y1="62" x2="136" y2="62" stroke="var(--rule)"/>
<line x1="248" y1="62" x2="260" y2="62" stroke="var(--rule)"/>
<line x1="372" y1="62" x2="384" y2="62" stroke="var(--rule)"/>
<line x1="496" y1="62" x2="508" y2="62" stroke="var(--rule)"/>
<text x="12" y="124" fill="var(--ink)">前三道在开库之前:不碰数据库,最便宜</text>
<text x="12" y="144" fill="var(--ink-soft)" font-size="11">Day 96 的登记表 · Day 95 的 schema</text>
<line x1="384" y1="108" x2="628" y2="108" stroke="var(--mem)"/>
<text x="384" y="124" fill="var(--ink)">后两道在 with db() 里面</text>
<text x="384" y="144" fill="var(--ink-soft)" font-size="11">Day 93 的事务 · Day 91 的约束</text>
<text x="12" y="184" fill="var(--ink-soft)" font-size="11">任何一道失败,call() 都返回一个 {"ok": false, "error": 类别, "message": 原因},不抛异常。</text>
</g>
</svg>
<figcaption>一次 call() 的五道门。便宜的检查放前面,数据库放最后;每一道门失败都有自己的类别,模型看到类别就知道该改参数还是该换思路。</figcaption>
</figure>

为什么 schema 和数据库约束两层都要?练习 4 会亲眼看到:只靠第三道门挡不住的,第五道能挡;第三道不在,第五道也挡不住所有,因为 SQLite 对类型很宽松。

### 第 1 步:ledger_tools.py

新建 `part01/ledger_tools.py`,这是今天唯一的新模块。先通读,后面有逐行讲解。

```python
# agent-zero-lab/part01/ledger_tools.py
import json
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from jsonschema import Draft202012Validator

from part01.db import db
from part01.ledger import queries
from part01.ledger.billing import bill_month as run_bill_month
from part01.ledger.seed import LEDGER_DB

DATE = r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$"
MONTH = r"^\d{4}-(0[1-9]|1[0-2])$"


class NotFound(Exception):
    """要找的客户或发票不存在。"""


@dataclass
class Tool:
    func: Callable
    validator: Draft202012Validator
    write: bool


REGISTRY: dict[str, Tool] = {}


def tool(parameters: dict, write: bool = False) -> Callable[[Callable], Callable]:
    """带参数的登记型装饰器:把函数和它的 schema 登记起来,函数本身原样返回。"""

    def decorator(func: Callable) -> Callable:
        Draft202012Validator.check_schema(parameters)
        REGISTRY[func.__name__] = Tool(func, Draft202012Validator(parameters), write)
        return func

    return decorator


@tool({
    "type": "object",
    "properties": {"keyword": {"type": "string", "minLength": 1, "maxLength": 20}},
    "required": ["keyword"],
    "additionalProperties": False,
})
def find_customer(conn: sqlite3.Connection, keyword: str) -> list[dict]:
    """按公司名里的关键字找客户。"""
    rows = conn.execute(
        "SELECT id, company, plan, seats, city FROM customers WHERE company LIKE ? ORDER BY id",
        (f"%{keyword}%",),
    ).fetchall()
    if not rows:
        raise NotFound(f"没有公司名里带 {keyword!r} 的客户")
    return [dict(r) for r in rows]


@tool({
    "type": "object",
    "properties": {
        "customer_id": {"type": "integer", "minimum": 1},
        "status": {"enum": ["paid", "unpaid", "refunded"]},
    },
    "required": ["customer_id"],
    "additionalProperties": False,
})
def list_invoices(conn: sqlite3.Connection, customer_id: int, status: str | None = None) -> list[dict]:
    """一个客户的发票,可按状态筛选。"""
    if conn.execute("SELECT 1 FROM customers WHERE id = ?", (customer_id,)).fetchone() is None:
        raise NotFound(f"没有编号 {customer_id} 的客户")
    return [dict(r) for r in queries.invoices_of(conn, customer_id, status)]


@tool({
    "type": "object",
    "properties": {"month": {"type": "string", "pattern": MONTH}},
    "required": ["month"],
    "additionalProperties": False,
}, write=True)
def bill_month(conn: sqlite3.Connection, month: str) -> dict:
    """给这个月还没开票的客户开发票,重复运行不会重复开。"""
    return {"new_invoices": run_bill_month(conn, month)}


@tool({
    "type": "object",
    "properties": {
        "customer_id": {"type": "integer", "minimum": 1},
        "amount": {"type": "integer", "minimum": 1},
        "issued_at": {"type": "string", "pattern": DATE},
    },
    "required": ["customer_id", "amount", "issued_at"],
    "additionalProperties": False,
}, write=True)
def create_invoice(conn: sqlite3.Connection, customer_id: int, amount: int, issued_at: str) -> dict:
    """手工开一张未付发票。客户存不存在、同月有没有重复,交给数据库的约束去判断。"""
    cur = conn.execute(
        "INSERT INTO invoices (customer_id, amount, status, issued_at) VALUES (?, ?, 'unpaid', ?)",
        (customer_id, amount, issued_at),
    )
    return {"invoice_id": cur.lastrowid}


@tool({
    "type": "object",
    "properties": {"invoice_id": {"type": "integer", "minimum": 1}},
    "required": ["invoice_id"],
    "additionalProperties": False,
}, write=True)
def mark_paid(conn: sqlite3.Connection, invoice_id: int) -> dict:
    """把一张未付发票标成已付。"""
    row = conn.execute("SELECT status FROM invoices WHERE id = ?", (invoice_id,)).fetchone()
    if row is None:
        raise NotFound(f"没有编号 {invoice_id} 的发票")
    if row["status"] != "unpaid":
        raise ValueError(f"发票 {invoice_id} 当前是 {row['status']},只有 unpaid 才能标成已付")
    conn.execute("UPDATE invoices SET status = 'paid' WHERE id = ?", (invoice_id,))
    return {"invoice_id": invoice_id, "status": "paid"}


def fail(kind: str, message: str) -> str:
    return json.dumps({"ok": False, "error": kind, "message": message}, ensure_ascii=False)


def call(name: str, arguments: str, path: Path = LEDGER_DB) -> str:
    """模型说要调 name、参数是 arguments(JSON 字符串)。已知的各类失败都变成一个 JSON 字符串返回;我们自己代码里的 bug 故意不接。"""
    t = REGISTRY.get(name)
    if t is None:
        return fail("unknown_tool", f"没有叫 {name} 的工具,可用的有 {sorted(REGISTRY)}")
    try:
        args = json.loads(arguments)
    except json.JSONDecodeError as e:
        return fail("bad_json", f"参数不是合法 JSON:{e.msg}(第 {e.colno} 列)")
    errors = sorted(t.validator.iter_errors(args), key=lambda e: [str(p) for p in e.absolute_path])
    if errors:
        lines = [f"{'.'.join(map(str, e.absolute_path)) or '(整体)'}: {e.message}" for e in errors]
        return fail("bad_arguments", "; ".join(lines))
    try:
        with db(path, read_only=not t.write) as conn:
            result = t.func(conn, **args)
    except NotFound as e:
        return fail("not_found", str(e))
    except ValueError as e:
        return fail("rejected", str(e))
    except sqlite3.IntegrityError as e:
        return fail("db_rejected", str(e))
    except sqlite3.Error as e:
        return fail("db_error", f"{type(e).__name__}: {e}")
    return json.dumps({"ok": True, "result": result}, ensure_ascii=False)


def definitions() -> list[dict]:
    """给模型看的工具列表:名字、docstring、schema。Day 157 起会真的发给模型。"""
    return [
        {
            "type": "function",
            "function": {
                "name": name,
                "description": (t.func.__doc__ or "").strip(),
                "parameters": t.validator.schema,
            },
        }
        for name, t in REGISTRY.items()
    ]
```

<div class="line-notes">

- `from jsonschema import Draft202012Validator` Day 95 的校验器。每个工具登记时造一个,以后每次调用复用,不用每次重造。
- `from part01.db import db` Day 93 的 `db()`。整个模块打开数据库只有一个入口,在 `call()` 里。
- `from part01.ledger.billing import bill_month as run_bill_month` 把 Day 94 的 `bill_month(conn, month)` 起个别名。因为下面我们自己要定义一个同名的工具函数 `bill_month`,不改名会把它盖掉。
- `DATE = r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$"` 日期的 `pattern`。`r"..."` 是原始字符串,反斜杠不用写两遍。它只管「长得像日期」,`2026-02-31` 也能过,真正的日期合法性不归 schema 管(见常见误区)。
- `MONTH = r"^\d{4}-(0[1-9]|1[0-2])$"` 月份,`2026-13` 过不了,和 Day 94 `check_month` 手写的四个条件是同一件事,现在写成一行数据。
- `class NotFound(Exception):` 一个自己的异常类(Day 36 的自定义异常)。用它和别的错误区分:找不到是「问法没问题,但库里没有」,不是参数错。
- `@dataclass` Day 50。`Tool` 只是一个装三样东西的盒子:函数、校验器、是否要写库。
- `func: Callable` 被登记的函数本身。
- `validator: Draft202012Validator` 提前造好的校验器,调用时 `iter_errors` 用。
- `write: bool` 这个工具要不要写库。决定 `call()` 开什么连接:读工具用只读连接,哪怕函数里有 bug 也写不进去。
- `REGISTRY: dict[str, Tool] = {}` 登记表:工具名 → `Tool`。Day 96 第 6 步 `TOOLS` 的升级版,多存了 schema 和 `write`。
- `def tool(parameters: dict, write: bool = False)` 带参数的装饰器,三层里的最外层(Day 96 第 5 步):收 schema 和 `write`,返回真正的装饰器。
- `def decorator(func: Callable) -> Callable:` 中间层:收函数。
- `Draft202012Validator.check_schema(parameters)` 登记的那一刻就检查 schema 本身写没写错。写错了(比如 `"type": "str"`)在 import 这个模块时就抛 `SchemaError`,不用等调用时才发现。
- `REGISTRY[func.__name__] = Tool(func, Draft202012Validator(parameters), write)` 登记。`func.__name__` 是函数名,代入第一个工具:`'find_customer'`。
- `return func` 原样还回去,登记型装饰器的标志。所以 `find_customer(conn, "星河")` 照样可以直接调用,测试里就这么用。
- `@tool({` 第一个工具的 schema:只有一个必填字符串 `keyword`,长度 1 到 20。
- `"additionalProperties": False,` 每个工具都写这一行(Day 95 常见误区第一条),模型多传的参数才会被发现。
- `def find_customer(conn: sqlite3.Connection, keyword: str) -> list[dict]:` 工具函数的第一个参数永远是 `conn`,连接由外面的 `call()` 开和关、提交和回滚,函数自己不管。这是 Day 96 练习 5 里那个教训:事务边界放在最外层,内层只收连接。
- `"SELECT id, company, plan, seats, city FROM customers WHERE company LIKE ? ORDER BY id",` 用 `?` 占位符(Day 92)。模型传来的 `keyword` 无论里面有没有引号、分号,都只是值。
- `(f"%{keyword}%",),` 两侧的 `%` 属于值,在 Python 里拼好再传(Day 92 第 5 步);末尾的逗号让它是元组。代入 `"星河"`:`('%星河%',)`。
- `raise NotFound(` 空结果不当成「成功但没有」,回一个明确的找不到,模型才知道是关键字问题。
- `return [dict(r) for r in rows]` `Row` 转成普通字典(Day 93)。必须在 `with db()` 结束之前转,连接关了之后 `Row` 就没法用。
- `"status": {"enum": ["paid", "unpaid", "refunded"]},` 只写 `enum`、不写 `type` 也合法:值必须是这三个之一。和 Day 94 `status` 的 `CHECK` 是同一份名单,但这份在程序里,CHECK 在库里。
- `def list_invoices(conn: sqlite3.Connection, customer_id: int, status: str | None = None)` `status` 有默认值,所以 schema 的 `required` 里没有它。
- `if conn.execute("SELECT 1 FROM customers WHERE id = ?", (customer_id,)).fetchone() is None:` 先确认客户存在。没有这一步,客户 99 会得到空列表,和「客户存在但没发票」分不开。`fetchone()` 没有结果是 `None`(Day 92 误区)。
- `return [dict(r) for r in queries.invoices_of(conn, customer_id, status)]` 复用 Day 94 `queries.py` 里已经写好、测试过的函数,不重写 SQL。
- `}, write=True)` 从这里起的三个工具都要写库,`write=True`。
- `return {"new_invoices": run_bill_month(conn, month)}` 工具函数只是 Day 94 函数的一层薄壳。`bill_month` 内部本来就有 `check_month`,schema 的 `MONTH` 是它前面的第二层保险。
- `"amount": {"type": "integer", "minimum": 1},` 金额必须是整数且大于等于 1。`"1188"` 和 `1188.5` 都过不了(Day 95:jsonschema 只判断,不转换)。
- `"issued_at": {"type": "string", "pattern": DATE},` 引用上面的 `DATE`。
- `"""手工开一张未付发票。客户存不存在、同月有没有重复,交给数据库的约束去判断。"""` 这句话是故意的:这两件事 schema 管不了,不想在 Python 里再查一遍,让库用外键和 `UNIQUE` 拦。
- `cur = conn.execute(` 这里 `INSERT` 语句里 `status` 直接写死 `'unpaid'`,不让模型决定。
- `return {"invoice_id": cur.lastrowid}` 新行的编号(Day 93 的 `lastrowid`)。
- `row = conn.execute("SELECT status FROM invoices WHERE id = ?", (invoice_id,)).fetchone()` 先读状态。这一步在同一个事务里,所以读和写之间别人改不了(这个库此刻只有我们一个写者,真有并发时还要想更多,Day 93 练习 5)。
- `if row is None:` 发票不存在,抛 `NotFound`。
- `if row["status"] != "unpaid":` `row["status"]` 按名字取,`row_factory` 的好处(Day 93)。已付的再标一次、已退款的标成已付,都是业务不允许,抛 `ValueError`,`call()` 里会归到 `rejected`。
- `conn.execute("UPDATE invoices SET status = 'paid' WHERE id = ?", (invoice_id,))` 一定带 `WHERE`(Day 86 的事故)。上面刚确认过它存在,所以不检查 `rowcount`。
- `def fail(kind: str, message: str) -> str:` 统一的错误出口,所有失败长一个样:`ok`、`error`(类别)、`message`(原因)。
- `ensure_ascii=False` 写在 `json.dumps` 里,让中文原样输出,不变成 `\u4e2d` 这种转义。
- `def call(name: str, arguments: str, path: Path = LEDGER_DB) -> str:` 入口。`arguments` 是字符串,因为模型回的就是字符串;`path` 默认是真账单库,测试和演示传别的路径。
- `t = REGISTRY.get(name)` 用 `get`,找不到得到 `None`,不是 `KeyError`。
- `return fail("unknown_tool", f"没有叫 {name} 的工具,可用的有 {sorted(REGISTRY)}")` 第一道门。把可用工具列出来,模型下一轮能改对。
- `args = json.loads(arguments)` 第二道门:不是 JSON 就抛 `JSONDecodeError`。
- `return fail("bad_json", f"参数不是合法 JSON:{e.msg}(第 {e.colno} 列)")` `e.msg` 是原因,`e.colno` 是第几列,代入缺了右花括号的那个例子:`Expecting ',' delimiter`,第 17 列。
- `errors = sorted(t.validator.iter_errors(args), key=lambda e: [str(p) for p in e.absolute_path])` 第三道门。`iter_errors` 一次拿到全部错误(Day 95),按字段路径排序让输出稳定。`absolute_path` 里有的是字段名、有的是数组下标,统一转成字符串才能互相比较排序。
- `lines = [f"{'.'.join(map(str, e.absolute_path)) or '(整体)'}: {e.message}" for e in errors]` 每条错误前面加上字段名;`required` 和 `additionalProperties` 这类对整个对象的错误没有字段路径,显示成 `(整体)`。
- `return fail("bad_arguments", "; ".join(lines))` 全部错误拼成一条回去,模型一轮就能改完,不用一个一个试。
- `with db(path, read_only=not t.write) as conn:` 到这里才打开数据库。读工具走只读连接,写工具走可写连接;`with` 块结束时 `db()` 自己提交或回滚并关闭。
- `result = t.func(conn, **args)` `**args` 把字典拆成关键字参数(Day 52)。因为前面 schema 已经保证了只有声明过的字段,这里不会出现「多了一个没见过的参数名」的 `TypeError`。
- `except NotFound as e:` 第四道门之一。注意 `except` 的**顺序**:自己写的 `NotFound` 和 `ValueError` 在前,`sqlite3.IntegrityError` 在后,最后才是兜底的 `sqlite3.Error`,子类必须写在父类前面(Day 84 的老坑)。
- `except ValueError as e:` 业务拒绝(`mark_paid` 里抛的),类别 `rejected`。
- `except sqlite3.IntegrityError as e:` 第五道门:约束拦住了。`str(e)` 就是库的原话,例如 `FOREIGN KEY constraint failed`,模型能从中看出是哪类问题。
- `except sqlite3.Error as e:` 其他数据库错误(比如只读连接上写)的兜底,带上异常类名。
- `return json.dumps({"ok": True, "result": result}, ensure_ascii=False)` 成功也是同一个信封,`ok` 为 `True`。
- `def definitions() -> list[dict]:` 把登记表变成「给模型看的工具列表」,形状和 Day 95 第 6 步的 `CREATE_TICKET_TOOL` 一样。
- `"description": (t.func.__doc__ or "").strip(),` docstring 当说明。`__doc__` 没写时是 `None`,`or ""` 兜底。
- `"parameters": t.validator.schema,` 校验器自己存着当初传进去的 schema,发给模型的和本地校验用的是同一份,不会出现两处不一致。

</div>

`call()` 有两个地方是故意的,先交代清楚:

一是只接已知的错误。如果工具函数里有我们自己的 bug,比如写成了 `1 / 0`,`ZeroDivisionError` 会原样抛出来,而不是被悄悄变成一条 `error` 回给模型。我实测过,登记一个 `1 / 0` 的工具再调它,抛出来的就是 `ZeroDivisionError: division by zero`。这是对的:模型能改的是参数,改不了我们的代码,把 bug 藏起来,只会让问题活得更久。

二是 `iter_errors` 在 `with db()` **之前**。一次库都没打开就拒绝了,代价最小。

### 第 2 步:试一遍十二种情况

新建 `part01/ledger_tools_try.py`,用一个独立的演示库,按顺序试十二次调用。每一次都先印标签、再印返回值。

```python
# agent-zero-lab/part01/ledger_tools_try.py
from pathlib import Path

from part01.db import db
from part01.ledger import seed
from part01.ledger_tools import call, definitions, mark_paid

DEMO_DB = Path(__file__).parent / "ledger" / "tools_demo.db"
print("重建演示库:", seed.build(DEMO_DB))
print("登记了", len(definitions()), "个工具:", [d["function"]["name"] for d in definitions()])

CASES = [
    ("正常查询", "find_customer", '{"keyword": "星河"}'),
    ("正常查询", "list_invoices", '{"customer_id": 1, "status": "unpaid"}'),
    ("没有这个工具", "refund_all", "{}"),
    ("JSON 都不合法", "find_customer", '{"keyword": "星河"'),
    ("schema 一次报全", "create_invoice", '{"customer_id": "1", "amount": -5, "color": "red"}'),
    ("schema 放行、库拒绝", "create_invoice", '{"customer_id": 99, "amount": 100, "issued_at": "2026-10-01"}'),
    ("正常写入", "create_invoice", '{"customer_id": 1, "amount": 1188, "issued_at": "2026-10-01"}'),
    ("同月再开一张", "create_invoice", '{"customer_id": 1, "amount": 1188, "issued_at": "2026-10-01"}'),
    ("找不到", "list_invoices", '{"customer_id": 99}'),
    ("业务拒绝", "mark_paid", '{"invoice_id": 1}'),
    ("按月开票", "bill_month", '{"month": "2026-11"}'),
    ("重复开票", "bill_month", '{"month": "2026-11"}'),
]
for label, name, arguments in CASES:
    print(f"\n[{label}] {name} {arguments}")
    print("  →", call(name, arguments, DEMO_DB))

print("\n[只读连接上写] 绕过 call,拿只读连接直接调 mark_paid(3)")
try:
    with db(DEMO_DB, read_only=True) as conn:
        mark_paid(conn, 3)
except Exception as e:
    print("  →", type(e).__name__, e)
```

<div class="line-notes">

- `DEMO_DB = Path(__file__).parent / "ledger" / "tools_demo.db"` 演示用的独立数据库文件,和真正的 `ledger.db` 分开,弄脏了不心疼。
- `print("重建演示库:", seed.build(DEMO_DB))` Day 94 的 `build` 接受路径参数,从 `practice.db` 重建。每次运行都是同样的起点,所以下面的编号和数字每次一样。
- `print("登记了", len(definitions()), "个工具:"` 只要 `import part01.ledger_tools`,装饰器就已经跑完了(Day 96 的第一条常见误区),不需要手动注册。
- `CASES = [` 十二个例子,每个是「标签、工具名、参数字符串」。注意参数是字符串,不是字典,模拟模型回来的样子。
- `("JSON 都不合法", "find_customer", '{"keyword": "星河"'),` 少了结尾的 `}`。
- `("schema 一次报全", "create_invoice", '{"customer_id": "1", "amount": -5, "color": "red"}'),` 故意出四个错:`customer_id` 是字符串、`amount` 是负数、多了 `color`、缺 `issued_at`。
- `("schema 放行、库拒绝"` 形状完全合法,但客户 99 不存在。schema 不知道库里有谁,只有外键知道。
- `("同月再开一张"` 和上一行「正常写入」是同一份参数,撞 `UNIQUE (customer_id, issued_at)`。
- `("业务拒绝", "mark_paid", '{"invoice_id": 1}'),` 1 号发票本来就是 `paid`。
- `print("  →", call(name, arguments, DEMO_DB))` 每次调用都传演示库的路径。
- `with db(DEMO_DB, read_only=True) as conn:` 故意绕过 `call()`,拿一个只读连接直接调写工具,看只读连接到底挡不挡得住。
- `except Exception as e:` 这里接 `Exception` 只是为了把名字打印出来看,正式代码里别这么写。

</div>

```bash
cd ~/agent-zero-lab
uv run python -m part01.ledger_tools_try
```

```text
重建演示库: {'customers': 10, 'invoices': 14, 'orphans': 1}
登记了 5 个工具: ['find_customer', 'list_invoices', 'bill_month', 'create_invoice', 'mark_paid']

[正常查询] find_customer {"keyword": "星河"}
  → {"ok": true, "result": [{"id": 1, "company": "星河餐饮", "plan": "专业版", "seats": 12, "city": "杭州"}]}

[正常查询] list_invoices {"customer_id": 1, "status": "unpaid"}
  → {"ok": true, "result": [{"id": 3, "amount": 1188, "status": "unpaid", "issued_at": "2026-09-01"}]}

[没有这个工具] refund_all {}
  → {"ok": false, "error": "unknown_tool", "message": "没有叫 refund_all 的工具,可用的有 ['bill_month', 'create_invoice', 'find_customer', 'list_invoices', 'mark_paid']"}

[JSON 都不合法] find_customer {"keyword": "星河"
  → {"ok": false, "error": "bad_json", "message": "参数不是合法 JSON:Expecting ',' delimiter(第 17 列)"}

[schema 一次报全] create_invoice {"customer_id": "1", "amount": -5, "color": "red"}
  → {"ok": false, "error": "bad_arguments", "message": "(整体): 'issued_at' is a required property; (整体): Additional properties are not allowed ('color' was unexpected); amount: -5 is less than the minimum of 1; customer_id: '1' is not of type 'integer'"}

[schema 放行、库拒绝] create_invoice {"customer_id": 99, "amount": 100, "issued_at": "2026-10-01"}
  → {"ok": false, "error": "db_rejected", "message": "FOREIGN KEY constraint failed"}

[正常写入] create_invoice {"customer_id": 1, "amount": 1188, "issued_at": "2026-10-01"}
  → {"ok": true, "result": {"invoice_id": 15}}

[同月再开一张] create_invoice {"customer_id": 1, "amount": 1188, "issued_at": "2026-10-01"}
  → {"ok": false, "error": "db_rejected", "message": "UNIQUE constraint failed: invoices.customer_id, invoices.issued_at"}

[找不到] list_invoices {"customer_id": 99}
  → {"ok": false, "error": "not_found", "message": "没有编号 99 的客户"}

[业务拒绝] mark_paid {"invoice_id": 1}
  → {"ok": false, "error": "rejected", "message": "发票 1 当前是 paid,只有 unpaid 才能标成已付"}

[按月开票] bill_month {"month": "2026-11"}
  → {"ok": true, "result": {"new_invoices": 10}}

[重复开票] bill_month {"month": "2026-11"}
  → {"ok": true, "result": {"new_invoices": 0}}

[只读连接上写] 绕过 call,拿只读连接直接调 mark_paid(3)
  → OperationalError attempt to write a readonly database
```

逐条看:

- 第 5 个例子(`schema 一次报全`)一次把四个错都报出来,模型改一遍就够。`customer_id: '1' is not of type 'integer'` 是 Day 95 说的「jsonschema 只判断不转换」:字符串 `"1"` 就是不合格,不会被悄悄转成 1。
- 第 6 个例子参数形状完全合法,被**数据库**挡了,原话是 `FOREIGN KEY constraint failed`。这个错能出现,是因为 `db()` 一建连接就开了外键(Day 91、92、93 三次强调的那个 `PRAGMA`)。
- 新开的发票编号是 15,不是 14 也不是 16。因为 14 张发票是 1 到 14,15 号孤儿发票存进了 `invoices_orphans`(Day 94),新发票接着 14 往后排。
- `bill_month` 第一次开 10 张(10 个客户都在 2026-11-01 之前注册),第二次开 0 张(Day 94 的幂等性)。
- 最后一行:只读连接确实挡住了写入,抛的是 `OperationalError: attempt to write a readonly database`。这是 `call()` 里 `except sqlite3.Error` 兜底接的那一类(`db_error`)。

### 第 3 步:用测试把它钉住

新建 `tests/test_ledger_tools.py`。每个测试用 `tmp_path` 自己建一个库,不碰 `ledger.db`。

```python
# agent-zero-lab/tests/test_ledger_tools.py
import json
import sqlite3
from pathlib import Path

import pytest

from part01.ledger import seed
from part01.ledger_tools import REGISTRY, call, definitions, find_customer


@pytest.fixture
def ledger(tmp_path: Path) -> Path:
    path = tmp_path / "ledger.db"
    seed.build(path)
    return path


def count_invoices(path: Path) -> int:
    conn = sqlite3.connect(path)
    try:
        return conn.execute("SELECT count(*) FROM invoices").fetchone()[0]
    finally:
        conn.close()


def run(path: Path, name: str, arguments: dict | str) -> dict:
    text = arguments if isinstance(arguments, str) else json.dumps(arguments)
    return json.loads(call(name, text, path))


def test_find_customer_ok(ledger: Path) -> None:
    out = run(ledger, "find_customer", {"keyword": "星河"})
    assert out["ok"] is True
    assert out["result"][0]["company"] == "星河餐饮"


def test_unknown_tool_lists_available(ledger: Path) -> None:
    out = run(ledger, "refund_all", {})
    assert out["error"] == "unknown_tool"
    assert "create_invoice" in out["message"]


def test_bad_json(ledger: Path) -> None:
    assert run(ledger, "find_customer", '{"keyword": ')["error"] == "bad_json"


def test_schema_reports_every_problem_at_once(ledger: Path) -> None:
    out = run(ledger, "create_invoice", {"customer_id": "1", "amount": -5, "color": "red"})
    assert out["error"] == "bad_arguments"
    for part in ("issued_at", "color", "amount", "customer_id"):
        assert part in out["message"]


def test_db_rejects_what_schema_lets_through(ledger: Path) -> None:
    before = count_invoices(ledger)
    out = run(ledger, "create_invoice", {"customer_id": 99, "amount": 100, "issued_at": "2026-10-01"})
    assert out["error"] == "db_rejected"
    assert "FOREIGN KEY" in out["message"]
    assert count_invoices(ledger) == before


def test_duplicate_month_is_rejected_by_unique(ledger: Path) -> None:
    args = {"customer_id": 1, "amount": 1188, "issued_at": "2026-10-01"}
    assert run(ledger, "create_invoice", args)["ok"] is True
    out = run(ledger, "create_invoice", args)
    assert out["error"] == "db_rejected"
    assert "UNIQUE" in out["message"]


def test_mark_paid_twice(ledger: Path) -> None:
    assert run(ledger, "mark_paid", {"invoice_id": 3})["ok"] is True
    again = run(ledger, "mark_paid", {"invoice_id": 3})
    assert again["error"] == "rejected"
    assert run(ledger, "mark_paid", {"invoice_id": 999})["error"] == "not_found"


def test_bill_month_twice(ledger: Path) -> None:
    assert run(ledger, "bill_month", {"month": "2026-11"})["result"]["new_invoices"] == 10
    assert run(ledger, "bill_month", {"month": "2026-11"})["result"]["new_invoices"] == 0
    assert run(ledger, "bill_month", {"month": "2026-13"})["error"] == "bad_arguments"


def test_registered_function_is_still_the_original(ledger: Path) -> None:
    assert find_customer.__name__ == "find_customer"
    conn = sqlite3.connect(ledger)
    conn.row_factory = sqlite3.Row
    assert find_customer(conn, "星河")[0]["id"] == 1
    conn.close()


def test_every_tool_forbids_extra_arguments() -> None:
    for d in definitions():
        assert d["function"]["parameters"]["additionalProperties"] is False, d["function"]["name"]
    assert set(REGISTRY) == {"find_customer", "list_invoices", "bill_month", "create_invoice", "mark_paid"}
```

<div class="line-notes">

- `@pytest.fixture` Day 73 的 fixture。
- `def ledger(tmp_path: Path) -> Path:` `tmp_path` 是 pytest 内置的临时目录,每个测试一个新的,测试完自动清理。
- `seed.build(path)` 每个测试都从 `practice.db` 重建一个干净的账单库,互不影响。`seed.build` 要求 `practice.db` 在(前置里说过的 Day 85、87)。
- `def count_invoices(path: Path) -> int:` 测试里自己直接开连接数发票,不经过 `call()`,这样「失败后没有留下半截数据」的证据不依赖被测代码。
- `finally:` 无论成功失败,关连接。
- `def run(path: Path, name: str, arguments: dict | str) -> dict:` 测试里方便:传字典就自动转成 JSON 字符串,传字符串(坏 JSON)就原样给。返回值再解析回字典,断言写起来短。
- `assert out["result"][0]["company"] == "星河餐饮"` 种子数据里 1 号客户。
- `assert "create_invoice" in out["message"]` 不整句比较错误消息,只确认可用工具被列出来了,消息措辞以后改了测试不用跟着改。
- `for part in ("issued_at", "color", "amount", "customer_id"):` 四个错都出现在同一条消息里。
- `before = count_invoices(ledger)` 失败前先数一次。
- `assert count_invoices(ledger) == before` 失败后再数,一张没多:被拒绝的写入没有留下痕迹(Day 91 的事务)。
- `assert run(ledger, "create_invoice", args)["ok"] is True` 第一次成功。
- `assert "UNIQUE" in out["message"]` 第二次被 `UNIQUE` 拦。
- `assert run(ledger, "mark_paid", {"invoice_id": 3})["ok"] is True` 3 号发票是 `unpaid`,第一次成功。
- `assert again["error"] == "rejected"` 同一张发票再标一次,不允许。这个测试同时钉住 `rowcount` 那类「改了 0 行也当成功」的坑(Day 93)。
- `== 10` 种子数据里 10 个客户都在 2026-11-01 之前注册。
- `["error"] == "bad_arguments"` `2026-13` 不是合法月份,被 schema 的 `pattern` 拦在了门外,没碰到库。
- `assert find_customer.__name__ == "find_customer"` 登记型装饰器原样返回函数,名字没变,Day 96 的结论。
- `assert find_customer(conn, "星河")[0]["id"] == 1` 不经过 `call()`,直接调用,也能用。
- `assert d["function"]["parameters"]["additionalProperties"] is False, d["function"]["name"]` 逗号后面是断言失败时显示的消息,哪个工具漏写会直接报出名字。以后新增工具忘了这一行,这个测试会拦住。

</div>

```bash
uv run pytest tests/test_ledger_tools.py -q
```

```text
..........                                                               [100%]
10 passed in 0.34s
```

再跑全部,看这一周以及更早写的测试有没有被碰坏:

```bash
uv run pytest -q
```

```text
.......................................................                  [100%]
55 passed in 0.78s
```

我这边全仓是 55 个通过(前面几天的 45 个加今天的 10 个),你的数字可能不一样,取决于你做了哪些练习、保存了哪些测试文件,只要全绿就对。

### 小项目用到了本周哪一天

| 小项目里的哪一段 | 用到的知识 | 哪天 |
| --- | --- | --- |
| `@tool(parameters, write=...)` 三层、`return func` | 带参数的登记型装饰器 | 96 |
| `Draft202012Validator.check_schema(...)`、`iter_errors`、`additionalProperties` | JSON Schema 校验 | 95 |
| `with db(path, read_only=not t.write)` | `@contextmanager`、事务提交和回滚、只读连接 | 93 |
| `sqlite3.IntegrityError`、`FOREIGN KEY constraint failed`、`UNIQUE constraint failed` | 约束由库执行 | 91 |
| `?` 占位符、`(f"%{keyword}%",)` | 参数化查询、`LIKE` 里的 `%` | 92 |
| `queries.invoices_of`、`bill_month` 幂等、`build(path)` | CloudLedger 账单库 | 94 |
| `except` 子类写在父类前面、`NotFound` 自定义异常 | 异常 | Day 36 前后 |

## 本周错题与坑清单

六天踩过的坑,按「看到什么现象 → 真正的原因 → 怎么改」排在一起。表里的数字和报错都是前几天实跑得来的。

| 看到的现象 | 真正的原因 | 怎么改 | 哪天 |
| --- | --- | --- | --- |
| 孤儿发票(客户 11)照样插进去,没有警告 | SQLite 外键默认关,开关只对当前连接有效 | 每个连接建好第一件事 `PRAGMA foreign_keys = ON`,放进 `db()` | 91 |
| 重试一次扣款,余额从 1812 变成 624 | 事务里一条语句失败不会自动回滚,后面的 `COMMIT` 把前面的一起提交 | 出错主动 `ROLLBACK`,一件事的几步放进同一个事务 | 91 |
| 先记付款再扣款「躲过」重试,换成余额不足就付款记了、钱没扣 | 调顺序不是修复,事务才是 | 用事务 | 91 |
| 两个人各扣 100,只扣了一次 | 先读出来在程序里算、再写回去,互相覆盖 | `SET balance = balance - 100` 一句话算完 | 91 |
| `database is locked` | 一个连接的事务开着没结束,另一个想写 | 事务只放数据库操作,越短越好,别在里面等网络 | 91、93 |
| `' OR '1'='1` 让只查上海的查询返回整张表 10 行 | f-string 拼 SQL,值变成了命令 | `?` 占位符 | 92 |
| `Incorrect number of bindings supplied ... there are 2 supplied` | `("上海")` 没有逗号,是字符串不是元组 | `("上海",)` | 92 |
| `The current statement uses 0, and there are 1 supplied` | `LIKE '%?%'` 里的 `?` 在引号里,是普通字符 | `%` 拼进值里再传 | 92 |
| `ORDER BY ?` 不报错也不排序 | 占位符只能换值,不能换列名、表名 | 白名单,不放行就报错 | 92 |
| 路径拼错,先冒出一个 0 字节的新文件,再报 `no such table` | `sqlite3.connect` 找不到文件会新建一个 | 先 `exists()`,或只读模式 | 92 |
| `TypeError: 'NoneType' object is not subscriptable` | 对没结果的 `fetchone()` 直接取 `[0]` | 先判断 `is None` | 92 |
| 写了数据,别的连接看到的还是旧的;`close()` 后改动消失 | 没有 `commit()`,不报错 | `commit()`,或 `with db():` | 93 |
| 捕获了异常,余额照样扣成 624 | `except` 里没有 `rollback()` 也没有 `raise` | 回滚后重新抛,或干脆不接 | 93 |
| `with conn:` 之后 `conn.execute(...)` 还能用 | `with conn:` 只管提交回滚,不关连接 | 用 `db()`,出块必关 | 93 |
| `UPDATE` 的 `rowcount` 是 0,当成成功 | 找不到行不是错误 | 修改类函数检查 `rowcount` | 93 |
| `row[0]`、`row[1]` 按位置取,改了列顺序全错位 | 位置取值不报错 | `row_factory = sqlite3.Row`,按名字取 | 93 |
| 15 张发票整批灌入,第 15 张失败,发票表 0 行 | 整批在一个事务里,一张不合规,全撤 | 导入前先分流,不合规的存档 | 94 |
| 手工开两张同月发票,两边程序检查都通过,最后 24 张不是 34 张 | 程序里先查后写有空隙,只有 `UNIQUE` 拦得住 | 约束留在库里 | 94 |
| `sqlite3` 命令行手插孤儿发票成功了 | 命令行默认不开外键 | 开 `PRAGMA foreign_keys = ON`,事后用 `audit` 的 `fk_violations` 抓 | 94 |
| 工具多传的参数没人发现 | 没写 `additionalProperties: false`,默认放行 | 每个工具 schema 都写 | 95 |
| `format: "email"` 写了却没检查 | `jsonschema` 默认不检查 `format` | 造校验器时传 `format_checker` | 95 |
| `requird`、`minimun` 拼错了没有任何提示 | 不认识的关键字被当注释忽略 | 写测试,拿故意不合格的数据去试 | 95 |
| `"type": "str"` 抛 `SchemaError` | 要写 JSON 的叫法 `"string"` | 对照 `string`、`integer`、`number`、`boolean` | 95 |
| 同一份 `"amount": "66"`,jsonschema 拒绝、pydantic 放行 | pydantic 转换,jsonschema 只判断 | 按场景选,别混用 | 95 |
| 函数被装饰后返回 `None`,到运算时才报 `unsupported operand` | `wrapper` 忘了 `return func(...)` | 返回结果 | 96 |
| `'NoneType' object is not callable` | 装饰器忘了 `return wrapper` | 返回 `wrapper` | 96 |
| 日志里函数名全是 `wrapper`,docstring 变 `None` | 没写 `functools.wraps` | 永远写 | 96 |
| `@retry` 报 `TypeError`,`@retry()` 才行 | 三层装饰器必须带括号 | 数定义里有几层 | 96 |
| `UnboundLocalError: cannot access local variable 'n'` | `wrapper` 里改外层变量没声明 `nonlocal` | 声明 | 96 |
| 金额传 `"很多"` 居然存进去了,`sum` 变成 3564.0 | SQLite 整数列遇到存不了的文字就按文本存,`CHECK (amount > 0)` 里文本比数字大,照样通过 | schema 先拦(`integer`),建表加 `STRICT` | 今天,练习 4 |

这一周的坑和上周一样,有一半是「**不报错,但结果不对**」:外键没开、没 `commit()`、`ORDER BY ?`、多余字段、`@retry` 少括号。对付这类问题还是三招:**造一个反例去试**(故意传孤儿、故意传坏参数)、**数一数**(发票张数、合计、余额)、**写成测试**。小项目里 `call()` 的十二个例子,本质上就是把这一周的坑一个个造成反例,看每一道门是不是真拦住了。

## 动手练习

五道题,练习 1、2 是闭卷默写。先自己做,做不出再展开参考答案,看完关掉重写一遍。

### 练习 1(闭卷默写):db()

不看文章,写出 Day 93 的 `db()`。为了不和 `part01/db.py` 重名,函数叫 `db2`,放在 `part01/ex97_1_db_again.py`。再写四个检查(新建一个临时数据库,里面建 `a`、`b` 两张表,`b.a_id` 引用 `a.id`):

1. `with db2(p) as conn:` 里插一行,出块后用另一个只读连接数,应该是 1 行。
2. `with` 里先插一行再 `raise RuntimeError`,异常要照常抛出来,而且这一行不能留下。
3. 出了 `with` 之后,同一个连接再 `execute("SELECT 1")`,应该报错。
4. 往 `b` 里插 `a_id = 99`,应该报外键错误。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex97_1_db_again.py
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def db2(path: Path, read_only: bool = False) -> Iterator[sqlite3.Connection]:
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


if __name__ == "__main__":
    import tempfile

    p = Path(tempfile.mkdtemp()) / "t.db"
    with db2(p) as conn:
        conn.execute("CREATE TABLE a (id INTEGER PRIMARY KEY, n INTEGER NOT NULL)")
        conn.execute("CREATE TABLE b (id INTEGER PRIMARY KEY, a_id INTEGER REFERENCES a (id))")

    with db2(p) as conn:
        conn.execute("INSERT INTO a (n) VALUES (1)")
    with db2(p, read_only=True) as conn:
        print("1 成功后提交了吗:", conn.execute("SELECT count(*) FROM a").fetchone()[0], "行")

    try:
        with db2(p) as conn:
            conn.execute("INSERT INTO a (n) VALUES (2)")
            raise RuntimeError("中途出错")
    except RuntimeError as e:
        print("2 异常照常抛出来了:", e)
    with db2(p, read_only=True) as conn:
        print("2 出错后回滚了吗:", conn.execute("SELECT count(*) FROM a").fetchone()[0], "行")

    with db2(p) as conn:
        pass
    try:
        conn.execute("SELECT 1")
    except sqlite3.ProgrammingError as e:
        print("3 出了 with 连接已关:", e)

    try:
        with db2(p) as conn:
            conn.execute("INSERT INTO b (a_id) VALUES (99)")
    except sqlite3.IntegrityError as e:
        print("4 外键开着:", e)
```

<div class="line-notes">

- `@contextmanager` 把只 `yield` 一次的函数变成能放进 `with` 的东西(Day 93,原理 Day 98 才讲)。
- `def db2(path: Path, read_only: bool = False) -> Iterator[sqlite3.Connection]:` 有 `yield` 的函数,返回类型标成「产出连接的迭代器」。
- `conn = sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)` 只读要用 URI 写法。`path.as_uri()` 把路径变成 `file:///...`,后面接 `?mode=ro`,`uri=True` 告诉 `connect` 这是 URI 不是文件名(Day 92 练习 4)。
- `conn.row_factory = sqlite3.Row` 行带列名。
- `conn.execute("PRAGMA foreign_keys = ON")` 连接一建好就开外键,写在任何写入之前(Day 92 误区)。
- `yield conn` 暂停,把连接交给 `with` 块。块里的代码在这里运行。
- `conn.commit()` 块正常走完才会执行到这里。
- `except Exception:` 块里抛了异常,从 `yield` 那一行冒出来,在这里被接住。
- `conn.rollback()` 撤销这一整块里做的所有修改。
- `raise` 重新抛出,不吞。漏了这一句,第 2 项检查里的 `RuntimeError` 就不会出来。
- `conn.close()` 在 `finally` 里,成功失败都关。
- `p = Path(tempfile.mkdtemp()) / "t.db"` `mkdtemp()` 建一个临时目录,里面放测试库,不碰任何真实数据。
- `conn.execute("CREATE TABLE a (id INTEGER PRIMARY KEY, n INTEGER NOT NULL)")` 父表 `a`。
- `conn.execute("CREATE TABLE b (id INTEGER PRIMARY KEY, a_id INTEGER REFERENCES a (id))")` 子表 `b`,`a_id` 引用 `a.id`。
- `print("1 成功后提交了吗:"` 用只读连接去数,只读连接是一个新连接,只有提交了的数据才看得到。代入:插了 1 行,所以是 1。
- `raise RuntimeError("中途出错")` 在 `with` 里主动抛。`INSERT` 已经执行了,回滚要把它撤掉。
- `except RuntimeError as e:` 接在 `with` 的**外面**,能接到,证明 `db2` 把异常原样抛了出来。
- `print("2 出错后回滚了吗:"` 还是 1 行,不是 2 行,说明第二行 `INSERT` 被回滚了。
- `conn.execute("SELECT 1")` 此时 `conn` 是上一个 `with` 里那个,已经被 `db2` 关了。
- `except sqlite3.ProgrammingError as e:` 对已关闭的连接操作报这个错。
- `conn.execute("INSERT INTO b (a_id) VALUES (99)")` `a` 里没有 99,外键开着就会被拒绝。

</div>

```bash
uv run python -m part01.ex97_1_db_again
```

```text
1 成功后提交了吗: 1 行
2 异常照常抛出来了: 中途出错
2 出错后回滚了吗: 1 行
3 出了 with 连接已关: Cannot operate on a closed database.
4 外键开着: FOREIGN KEY constraint failed
```

自检办法:把 `raise` 那一行删掉再跑,第 2 项会变成「没有异常出来、程序继续往下走」,并且打印不出 `2 异常照常抛出来了`。这就是它的作用。

</details>

### 练习 2(闭卷默写):带参数的装饰器

不看文章,写一个 `slow_log(limit_ms)`:只有被装饰函数用的时间**超过** `limit_ms` 毫秒才打印一行警告,返回值原样交回,函数名和 docstring 不能丢。用 `@slow_log(limit_ms=20)` 装饰一个 `work(seconds)`,分别让它睡 0.001 秒和 0.05 秒,再打印 `work.__name__` 和 `work.__doc__`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex97_2_slow_log.py
import functools
import time
from collections.abc import Callable


def slow_log(limit_ms: float = 100) -> Callable[[Callable], Callable]:
    """带参数的装饰器:只有超过 limit_ms 才打印,返回值原样交回。"""

    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            t0 = time.perf_counter()
            try:
                return func(*args, **kwargs)
            finally:
                ms = (time.perf_counter() - t0) * 1000
                if ms > limit_ms:
                    print(f"[slow] {func.__name__} 用了 {ms:.0f} 毫秒,超过 {limit_ms:g}")

        return wrapper

    return decorator


@slow_log(limit_ms=20)
def work(seconds: float) -> str:
    """睡一会儿。"""
    time.sleep(seconds)
    return f"睡了 {seconds} 秒"


print(work(0.001))
print(work(0.05))
print(work.__name__, "|", work.__doc__)
```

<div class="line-notes">

- `def slow_log(limit_ms: float = 100) -> Callable[[Callable], Callable]:` 最外层,收参数,返回「装饰器」。返回类型读作「一个收函数、返回函数的函数」。
- `def decorator(func: Callable) -> Callable:` 中间层,收被装饰的函数。
- `@functools.wraps(func)` 把 `func` 的名字、docstring 抄到 `wrapper` 上。不写,最后一行会打印 `wrapper | None`。
- `def wrapper(*args, **kwargs):` 最里层,真正每次调用时跑的那一层,`*args, **kwargs` 把所有参数原样转交。
- `t0 = time.perf_counter()` 开始计时。
- `return func(*args, **kwargs)` 调用原函数,返回值原样交回。
- `finally:` 不管成功还是抛异常都算时间,这是 Day 96 `timed` 的写法。
- `ms = (time.perf_counter() - t0) * 1000` 秒换毫秒。
- `if ms > limit_ms:` 只有超过阈值才打印。代入:`work(0.001)` 大约 1 毫秒,不超过 20,什么都不印;`work(0.05)` 大约 50 毫秒,超过。
- `return wrapper` 中间层返回最里层。
- `return decorator` 最外层返回中间层。三个 `return`,各返回一层。
- `@slow_log(limit_ms=20)` 先调用 `slow_log(limit_ms=20)` 得到 `decorator`,再用它装饰 `work`,等价于 `work = slow_log(limit_ms=20)(work)`。
- `print(work.__name__, "|", work.__doc__)` 因为 `wraps`,这里是 `work` 和它的 docstring,不是 `wrapper`。

</div>

```bash
uv run python -m part01.ex97_2_slow_log
```

```text
睡了 0.001 秒
[slow] work 用了 52 毫秒,超过 20
睡了 0.05 秒
work | 睡一会儿。
```

毫秒数每次跑都不同(这次是 52),别照抄。要对的是:第一次调用没有 `[slow]` 行,第二次有;`[slow]` 行出现在 `work(0.05)` 的返回值被打印**之前**,因为 `finally` 在函数返回时就执行了,`print` 才拿到结果。

</details>

### 练习 3:再加一个工具

给 `ledger_tools` 加第六个工具 `unpaid_total(customer_id)`:返回这个客户所有 `unpaid` 发票的张数和金额合计。要求:schema 从空白开始自己写(`customer_id` 必填、整数、至少 1,不许多余字段);客户不存在回 `not_found`;客户存在但没有未付发票时,合计是 `0` 而不是 `null`。写在 `part01/ex97_3_unpaid_total.py` 里,用 `@tool` 登记,不改 `ledger_tools.py`。试四次调用:1 号客户、2 号客户、99 号客户、多传一个 `status` 字段。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex97_3_unpaid_total.py
import sqlite3
from pathlib import Path

from part01.ledger import seed
from part01.ledger_tools import NotFound, call, tool


@tool({
    "type": "object",
    "properties": {"customer_id": {"type": "integer", "minimum": 1}},
    "required": ["customer_id"],
    "additionalProperties": False,
})
def unpaid_total(conn: sqlite3.Connection, customer_id: int) -> dict:
    """一个客户所有未付发票的金额合计。"""
    if conn.execute("SELECT 1 FROM customers WHERE id = ?", (customer_id,)).fetchone() is None:
        raise NotFound(f"没有编号 {customer_id} 的客户")
    row = conn.execute(
        "SELECT count(*) AS n, coalesce(sum(amount), 0) AS owed FROM invoices WHERE customer_id = ? AND status = 'unpaid'",
        (customer_id,),
    ).fetchone()
    return {"customer_id": customer_id, "unpaid_invoices": row["n"], "owed": row["owed"]}


if __name__ == "__main__":
    demo = Path(__file__).parent / "ledger" / "ex97_demo.db"
    seed.build(demo)
    for args in ('{"customer_id": 1}', '{"customer_id": 2}', '{"customer_id": 99}', '{"customer_id": 1, "status": "unpaid"}'):
        print(args, "→", call("unpaid_total", args, demo))
```

<div class="line-notes">

- `from part01.ledger_tools import NotFound, call, tool` 直接用小项目里已有的三样东西。新工具只要 `import` 了这个模块、`@tool` 跑过,就已经进了同一个 `REGISTRY`(Day 96:装饰器在 import 时就执行完了)。
- `@tool({` 第一个参数是 schema,没写 `write=True`,所以是读工具,`call()` 给它的是只读连接。
- `"properties": {"customer_id": {"type": "integer", "minimum": 1}},` 一个整数字段,编号至少 1。
- `"required": ["customer_id"],` 必填。
- `"additionalProperties": False,` 不许多余字段,最后一次调用会撞上它。
- `def unpaid_total(conn: sqlite3.Connection, customer_id: int) -> dict:` 第一个参数永远是 `conn`。
- `if conn.execute("SELECT 1 FROM customers WHERE id = ?", (customer_id,)).fetchone() is None:` 先查客户在不在。没有这一步,99 号客户会得到「0 张、0 元」,看起来和「欠款为零的老客户」一模一样。
- `count(*) AS n, coalesce(sum(amount), 0) AS owed` 这一行三件事。`count(*)` 数行,这里数对了,因为没有 `LEFT JOIN`,不会出现 Day 88 那个「没发票显示 1 张」;`sum` 在没有未付发票时是 NULL(Day 88),`coalesce` 换成 0;`WHERE` 里客户编号走 `?`,状态 `'unpaid'` 是写死的字符串,不来自调用方。
- `return {"customer_id": customer_id, "unpaid_invoices": row["n"], "owed": row["owed"]}` 按名字取列,`row_factory` 的好处。
- `seed.build(demo)` 每次运行都重建演示库,所以 1 号客户永远是 1 张未付、1188 元。
- `for args in (` 四次调用,最后一次多传 `status`。

</div>

```bash
uv run python -m part01.ex97_3_unpaid_total
```

```text
{"customer_id": 1} → {"ok": true, "result": {"customer_id": 1, "unpaid_invoices": 1, "owed": 1188}}
{"customer_id": 2} → {"ok": true, "result": {"customer_id": 2, "unpaid_invoices": 0, "owed": 0}}
{"customer_id": 99} → {"ok": false, "error": "not_found", "message": "没有编号 99 的客户"}
{"customer_id": 1, "status": "unpaid"} → {"ok": false, "error": "bad_arguments", "message": "(整体): Additional properties are not allowed ('status' was unexpected)"}
```

2 号客户的 `owed` 是 `0` 不是 `null`,靠的是 `coalesce`。如果以后接模型,`null` 和 `0` 对它来说是两个意思。

</details>

### 练习 4:观察,没有 schema 会发生什么

把 `call()` 里第三道门(schema 校验)绕开:直接调 `create_invoice(conn, customer_id=1, amount="很多", issued_at="2026-10-01")`,放在可写的 `with db(...)` 里。**先猜**:数据库的 `CHECK (amount > 0)` 和 `INTEGER` 列会不会拦住?然后写 `part01/ex97_4_no_schema.py` 跑一遍,再查存进去的是什么、`sum` 变成什么。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex97_4_no_schema.py
from pathlib import Path

from part01.db import db
from part01.ledger import seed
from part01.ledger_tools import create_invoice

demo = Path(__file__).parent / "ledger" / "ex97_demo.db"
seed.build(demo)

# 绕过 call(),不做 schema 检查,直接把模型可能给的怪参数塞给函数
with db(demo) as conn:
    new_id = create_invoice(conn, customer_id=1, amount="很多", issued_at="2026-10-01")["invoice_id"]
    print("没报错,新发票编号:", new_id)

with db(demo, read_only=True) as conn:
    row = conn.execute(
        "SELECT id, amount, typeof(amount) AS t FROM invoices WHERE id = ?", (new_id,)
    ).fetchone()
    print("存进去的:", dict(row))
    total = conn.execute("SELECT sum(amount) FROM invoices WHERE customer_id = 1").fetchone()[0]
    print("1 号客户发票合计:", total)
```

<div class="line-notes">

- `from part01.ledger_tools import create_invoice` 直接拿到原函数。能直接调用,是因为登记型装饰器原样返回函数(Day 96)。
- `with db(demo) as conn:` 可写连接,`with` 块正常结束会提交。
- `new_id = create_invoice(conn, customer_id=1, amount="很多", issued_at="2026-10-01")["invoice_id"]` `amount` 传一个中文字符串。没有 schema 拦着,`?` 占位符只管把值递给库,不管类型。
- `print("没报错,新发票编号:", new_id)` 实测没有报错。
- `typeof(amount) AS t` SQLite 的函数,返回这一格里存的值实际是什么类型。
- `print("存进去的:", dict(row))` 代入实测:`{'id': 15, 'amount': '很多', 't': 'text'}`。`amount` 列声明是 `INTEGER`,里面却躺着一个文本。
- `SELECT sum(amount) FROM invoices WHERE customer_id = 1` 1 号客户本来有 3 张发票,每张 1188。

</div>

```bash
uv run python -m part01.ex97_4_no_schema
```

```text
没报错,新发票编号: 15
存进去的: {'id': 15, 'amount': '很多', 't': 'text'}
1 号客户发票合计: 3564.0
```

数据库**没有**拦住,原因有两个,都是 SQLite 的脾气。一,列类型在 SQLite 里叫「类型亲和性」,是个倾向不是规定:往 `INTEGER` 列里放一个转不成整数的字符串,它就老老实说按文本存下来。二,`CHECK (amount > 0)` 比较的时候,SQLite 规定文本永远比数字大,所以 `'很多' > 0` 为真,检查通过。合计变成 `3564.0`:`sum` 遇到文本当 0 加,一旦有非整数输入就返回浮点数,3 张真发票 3 × 1188 = 3564,「很多」贡献了 0。

这个坑今天才第一次遇到,可它正是 schema 在最前面那一道门的价值:`"amount": {"type": "integer", "minimum": 1}` 一句话就能挡住。库那一层想补救也有办法,SQLite 3.37 起可以在建表语句末尾加 `STRICT`,我在本机(SQLite 3.53.1)试过,同样的 `INSERT` 会直接报 `cannot store TEXT value in INTEGER column t.amount`。但已有的表加不了(Day 91 说过,SQLite 不能给已有表加约束,要建新表、搬数据、改名),所以账单库现在这张 `invoices` 表仍然没有这层保护,**更要靠前面的 schema**。结论:两层各守一部分,谁也替代不了谁。

</details>

### 练习 5(开放题):给 call 加一本流水账

模型每次调工具,你想事后知道:调了哪个工具、成功没有、失败的话属于哪一类、花了多少毫秒。不要改 `ledger_tools.py` 的代码,用**装饰器**做:写 `logged(func)`,包住 `call`,把每次的记录 `append` 到一个全局列表 `CALL_LOG`。调五次(一次成功查客户、一次找不到、一次库拒绝、一次标已付成功、一次再标已付被拒),打印整张表。对比:加之前,你只能从返回的字符串里自己找;加之后,你得到什么。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex97_5_call_log.py
import functools
import json
import time
from collections.abc import Callable
from pathlib import Path

from part01.ledger import seed
from part01.ledger_tools import call

CALL_LOG: list[dict] = []


def logged(func: Callable[..., str]) -> Callable[..., str]:
    """给 call 加一行记账:工具名、是否成功、错误类别、耗时。返回值原样交回。"""

    @functools.wraps(func)
    def wrapper(name: str, arguments: str, *args, **kwargs) -> str:
        t0 = time.perf_counter()
        out = func(name, arguments, *args, **kwargs)
        data = json.loads(out)
        CALL_LOG.append({
            "tool": name,
            "ok": data["ok"],
            "error": data.get("error"),
            "ms": round((time.perf_counter() - t0) * 1000, 1),
        })
        return out

    return wrapper


logged_call = logged(call)

if __name__ == "__main__":
    demo = Path(__file__).parent / "ledger" / "ex97_demo.db"
    seed.build(demo)
    logged_call("find_customer", '{"keyword": "星河"}', demo)
    logged_call("list_invoices", '{"customer_id": 99}', demo)
    logged_call("create_invoice", '{"customer_id": 99, "amount": 1, "issued_at": "2026-10-01"}', demo)
    logged_call("mark_paid", '{"invoice_id": 3}', demo)
    logged_call("mark_paid", '{"invoice_id": 3}', demo)
    for r in CALL_LOG:
        print(r)
    ok = sum(r["ok"] for r in CALL_LOG)
    print(f"共 {len(CALL_LOG)} 次,成功 {ok} 次")
    print("logged_call.__name__ =", logged_call.__name__)
```

<div class="line-notes">

- `CALL_LOG: list[dict] = []` 模块级的列表,所有记录往里放。
- `def logged(func: Callable[..., str]) -> Callable[..., str]:` 包一层的装饰器(Day 96 两种之一)。`Callable[..., str]` 是「参数不限、返回字符串的函数」。
- `@functools.wraps(func)` 抄名牌,最后一行打印的 `logged_call.__name__` 因此是 `call`。
- `def wrapper(name: str, arguments: str, *args, **kwargs) -> str:` 前两个参数写明白(要用 `name`),其余用 `*args, **kwargs` 原样转交,比如第三个位置参数 `path`。
- `out = func(name, arguments, *args, **kwargs)` 调原来的 `call`,拿到 JSON 字符串。
- `data = json.loads(out)` 把返回值解析回字典读 `ok` 和 `error`。这也说明了统一的信封格式有多方便:五种失败,读法完全一样。
- `"error": data.get("error"),` 成功的返回里没有 `error` 这个键,用 `.get` 得到 `None`,不是 `KeyError`。
- `"ms": round((time.perf_counter() - t0) * 1000, 1),` 毫秒,保留一位小数。
- `return out` 原样交回,调用方不知道自己被记了账。
- `logged_call = logged(call)` 不用 `@` 语法也行:装饰器就是 `call = logged(call)`,这里换了个新名字,原来的 `call` 不动。
- `logged_call("mark_paid", '{"invoice_id": 3}', demo)` 第三个位置参数 `demo` 走 `*args` 转交给原 `call` 的 `path`。
- `ok = sum(r["ok"] for r in CALL_LOG)` `True` 当 1 加,失败当 0,Day 14 的布尔。

</div>

```bash
uv run python -m part01.ex97_5_call_log
```

```text
{'tool': 'find_customer', 'ok': True, 'error': None, 'ms': 1.4}
{'tool': 'list_invoices', 'ok': False, 'error': 'not_found', 'ms': 1.3}
{'tool': 'create_invoice', 'ok': False, 'error': 'db_rejected', 'ms': 1.3}
{'tool': 'mark_paid', 'ok': True, 'error': None, 'ms': 5.8}
{'tool': 'mark_paid', 'ok': False, 'error': 'rejected', 'ms': 1.3}
共 5 次,成功 2 次
logged_call.__name__ = call
```

加之前:要知道「这五次里失败了几次、各是什么类别」,得自己拿 `call()` 返回的字符串去查。加之后:一个列表、五条记录,按 `error` 分组数一数就得到失败原因的分布。成功的那次写库(`mark_paid`)耗时 5.8 毫秒,明显比只读的几次慢,因为提交要真的写磁盘(Day 93 第 4 步:commit 不是免费的)。毫秒数每次不同,看比例就行。

以后(第六部分,Day 341 起讲可观测)你会把这种「每次调用记一行」换成真正的日志和追踪,但思路就是这个:包在调用入口上,不改工具本身。

</details>

### 验收标准

- 练习 1、2 闭卷写完之后才看答案,四项检查全对;
- `uv run pytest -q` 全绿;
- 练习 3 的第四次调用被 `additionalProperties` 拦住,`owed` 是 `0` 不是 `null`;
- 练习 4 你能说出「库为什么没拦」的两个原因,并说出 schema 里哪一句能挡;
- 能不看文章说出 `call()` 的五道门各回什么类别。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 知识地图 | 把一段时间学的东西画成一张「谁依赖谁」的图,复习时先看图再看细节 |
| 默写 | 合上资料凭记忆把代码写出来。看懂和写得出是两回事,默写时卡住的地方就是没学牢的地方 |
| 工具层 | 夹在「模型」和「你的函数」中间的一层:登记工具、校验参数、执行、把结果或错误包成统一格式回去。Day 157 起会正式用 |
| 登记表(registry) | 一张「名字 → 函数」的字典,装饰器往里写,调用时按名字找。Day 96 第 6 步首次出现 |
| 错误类别 | 失败时返回里的 `error` 字段,比如 `bad_arguments`、`db_rejected`。比一句话更好处理,调用方可以按类别决定下一步 |
| 信封(envelope) | 所有返回都用同一个外壳 `{"ok": ..., ...}`。这样成功还是失败、什么失败,读法永远一样 |
| 幂等(idempotent) | 同一个操作做两次和做一次结果一样。Day 94 的 `bill_month` 重复运行不重复开票就是幂等的 |
| 类型亲和性(type affinity) | SQLite 对列类型的宽松处理:列声明成 `INTEGER` 只是「倾向存整数」,存不了就按文本存,不报错。例子:练习 4 里 `'很多'` 住进了 `INTEGER` 列 |
| `STRICT` 表 | SQLite 3.37 起建表时加在末尾的关键字,开启严格类型,存不进的值会报错。只能在建表时加 |
| `typeof()` | SQLite 函数,返回一个值实际存成什么类型(`integer`、`text`、`null`...),查类型亲和性问题时用 |

## 常见误区

**把 schema 和数据库约束当成二选一。** 两道门看的东西不一样:schema 看「形状」(类型、必填、格式),在数据进门最早的地方一次报全;库的约束看「和库里已有数据的关系」(客户存不存在、同月有没有重复)。练习 4 里只有库那一层时,`'很多'` 照样存了进去;小项目的第 6 个例子里只有 schema 那一层时,客户 99 照样过得了关。两层都要。

**以为 schema 的 `pattern` 能保证日期是真的。** `DATE` 只管长得像 `YYYY-MM-DD`,`2026-02-31` 也能通过,因为正则没法知道每个月有几天。真要保证,要在工具函数里用 `datetime.date.fromisoformat(...)` 再验一次。这一周没学 `datetime`,先知道有这个坑。

**`call()` 里 `except Exception` 一把接住。** 看着稳,其实把我们自己代码里的 bug(`TypeError`、`ZeroDivisionError`)也变成了一条 `error` 回给模型,模型改不了我们的代码,问题会被藏很久。只接已知的几类,其余让它炸出来。

**读工具也用可写连接。** `call()` 里 `read_only=not t.write` 只有一行,却让读工具即使将来被改坏也写不进库。只读连接是兜底,不是权限设计(Day 92),但便宜,值得用。

**默写时偷看一眼。** 复习日的价值全在「闭卷」。看了再写,和抄一遍没区别,发现不了自己哪里不会。

**测试直接用真实的账单库。** 测试里的写操作会改你的 `ledger.db`。用 `tmp_path` 现建一个,每个测试一份。

**以为复习日可以只读文章。** 小项目的代码不要复制粘贴,从 `REGISTRY` 开始自己敲;卡住了再回头看逐行讲解。

## 学习资料

### 文档与文章

- [Python 官方文档 · sqlite3(英文,有中文版)](https://docs.python.org/3/library/sqlite3.html):这一周所有数据库操作的出处,先读 `Transaction control` 和 `How to use placeholders to bind values in SQL queries` 两节,复习时对着今天的 `db()` 看。
- [OWASP · SQL Injection Prevention Cheat Sheet(英文)](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html):业界最常引用的防注入指南,第一条就是参数化查询,Day 92 的内容。
- [SQLite 官方 · Foreign Key Support(英文)](https://sqlite.org/foreignkeys.html):外键默认关、每个连接要开,这一周踩过的第一个坑在这里有完整说明。
- [Understanding JSON Schema(英文,官方在线书)](https://json-schema.org/understanding-json-schema):每个关键字一节,小项目里用到的 `type`、`enum`、`pattern`、`minimum` 都能查到。
- [python-jsonschema 文档 · Schema Validation(英文)](https://python-jsonschema.readthedocs.io/en/stable/validate/):`check_schema`、`iter_errors` 的用法。
- [Python 官方文档 · functools(中文)](https://docs.python.org/zh-cn/3/library/functools.html):`wraps` 在这一页,Day 96 的内容。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Gu411Q7JV&autoplay=0&high_quality=1" title="【python】装饰器超详细教学,用尽毕生所学给你解释清楚,以后再也不迷茫了!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>码农高天 · 【python】装饰器超详细教学,用尽毕生所学给你解释清楚,以后再也不迷茫了! · 约 11 分钟,播放 16 万。复习 Day 96 时看,尤其是带参数那一段,对照练习 2。内容没有逐段核对,以文章里的实测为准。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1JG4y1Q7BX&autoplay=0&high_quality=1" title="5分钟精通数据库事务-ACID和三大问题" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>猿人林克 · 5分钟精通数据库事务-ACID和三大问题 · 约 7 分钟,播放 5 万。复习 Day 91 的事务和 Day 93 的提交、回滚。同样没有逐段核对。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/FsAPt_9Bf3U" title="Python Tutorial: Decorators - Dynamically Alter The Functionality Of Your Functions" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Tutorial: Decorators · 英文,可开字幕。从闭包讲起,中间有 `wraps` 和叠放顺序的演示,和 Day 96 对应。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/dtLl37W68g8" title="An Introduction to JSON Schema: A Practical Look" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Erik Wilde · An Introduction to JSON Schema: A Practical Look · 英文,可开字幕。JSON Schema 在接口契约里的位置,和 Day 95 对应,也预习了第三部分把 schema 发给模型的做法。</figcaption>
</figure>

### 书籍

- Luciano Ramalho,《Fluent Python》第二版,O'Reilly,2022;中文版《流畅的 Python(第 2 版)》,人民邮电出版社。第 9 章讲装饰器和闭包,Day 96 学完直接读正好。
- Ben Forta,《SQL必知必会》(第 5 版),人民邮电出版社。薄,有专门讲约束和事务的课,回头补 Day 91 用。

### 开源项目与代码

- [python-jsonschema/jsonschema](https://github.com/python-jsonschema/jsonschema):小项目里用的库,`validators.py` 里用带参数的装饰器登记各个版本的校验器,和今天 `@tool(parameters)` 是同一个思路。

## 自测

1. 下面这段代码有什么问题?怎么改?

```python
name = input("客户名:")
cur = conn.execute(f"SELECT * FROM customers WHERE company = '{name}'")
```

<details><summary>答案</summary>

用 f-string 把用户输入拼进了 SQL,输入 `' OR '1'='1` 就会返回整张表(Day 92 实测 10 行)。改成占位符:`conn.execute("SELECT * FROM customers WHERE company = ?", (name,))`,注意元组要有逗号。占位符把「值」和「命令」分开送给数据库,值里有什么引号、分号都只是文字。

</details>

2. `with conn:` 和 `with db():` 各管什么?哪一个会关闭连接?

<details><summary>答案</summary>

`with conn:` 只管事务:块正常结束提交、抛异常回滚,连接不关,出了块还能继续用。`db()` 是我们自己封的 `@contextmanager`:开连接并设好 `row_factory` 和外键,块正常结束提交、抛异常回滚并重新抛出,最后一定 `close()`。关连接的是 `db()`。

</details>

3. 一个创建发票的工具,调用方传了 `{"customer_id": 99, "amount": 100, "issued_at": "2026-10-01"}`,形状完全符合 schema,会在哪一层被拦住?用的是什么机制?

<details><summary>答案</summary>

在数据库那一层。schema 只知道 `customer_id` 应该是个整数,不知道库里有没有 99 号客户。`db()` 一建连接就开了 `PRAGMA foreign_keys = ON`,`invoices.customer_id` 引用 `customers.id` 的外键会拒绝这次 `INSERT`,抛 `sqlite3.IntegrityError: FOREIGN KEY constraint failed`,`call()` 把它归到 `db_rejected` 回给调用方,事务回滚,库里没留下东西。

</details>

4. 写出 `@slow_log(limit_ms=20)` 等价的不带 `@` 的写法,并说明为什么 `@retry` 和 `@retry()` 是两回事。

<details><summary>答案</summary>

`work = slow_log(limit_ms=20)(work)`:先调用 `slow_log(limit_ms=20)` 得到真正的装饰器,再用它装饰 `work`。三层结构的装饰器(外层收参数、中间层收函数、里层是 `wrapper`),用的时候必须带括号,写成 `@retry` 会把被装饰的函数当成 `times` 参数传进去,后面做 `times + 1` 时报 `TypeError`。反过来两层结构的 `@timed` 也不能写成 `@timed()`。判断方法:数定义里有几层。

</details>

5. 面试题:你写了一个给 Agent 用的工具,执行时库里抛了 `IntegrityError`,有人建议直接让它抛出去,让整个程序崩溃好调试。你怎么看?

<details><summary>答案</summary>

模型传来的参数出问题是**常态**,不是例外,程序崩了这一次对话就断了,别的用户也受影响。已知的失败(参数不合 schema、库里没有、违反约束)应当被接住,转成一条统一格式的错误回给模型,里面带类别和原话,让它下一轮改参数重试;事务要回滚,保证没有留下半截数据。但只接**已知**的几类:我们自己代码里的 bug(`TypeError`、`ZeroDivisionError` 这种)不能吞,吞掉就没人知道,应当让它抛出来、进日志。调试需要的信息放在日志里,不靠崩溃。

</details>

6. 面试题:同一个表单,前端校验、接口层 schema 校验、数据库约束都做了,是不是重复劳动?

<details><summary>答案</summary>

不是,它们守的东西不同,而且每一层都可能被绕过。前端校验能被绕过(别人直接发请求、模型直接调工具);接口层 schema 看形状,能一次报全所有错,错误能定位到字段,能发给调用方当契约,但不知道库里已有什么;数据库约束是最后一道门,只有它知道「客户存不存在」「同月有没有重复」,并且不管数据是从哪条路进来的都会执行。代价是约束能晚一点才报错、报错只报第一个,所以前面还要有 schema 把明显的错先挡掉。三层都留,各管一段。

</details>

## 明天预告

Day 98 · 上下文管理器:`with` 背后的 `__enter__`/`__exit__`。这一周你已经写了好几次 `with db() as conn:`,`db()` 还是靠 `@contextmanager` 加一个 `yield` 做出来的,当时说「照着用,原理以后讲」。明天就是以后:不用 `@contextmanager`,手写一个有 `__enter__` 和 `__exit__` 的类,看清 `with` 块里出了异常时 `__exit__` 收到的三个参数是什么、返回 `True` 会发生什么,再回头把 `db()` 拆开,知道每一行为什么在那个位置。
