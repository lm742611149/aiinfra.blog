---
title: 'Day 659 · Loupe(七):导入事务、覆盖语义、游标分页'
description: '昨天的 save_trace 写到一半出错会留下半截数据,重新导入同一份文件还会撞主键。今天先把这个现象跑出来,再用一个事务修好,让导入要么全进要么全不进,重复导入变成覆盖;然后写运行列表的游标分页,实测翻页途中插入新数据时 OFFSET 会重复、游标不会,以及游标为什么要同时带时间和 id。'
pubDate: 2026-10-27
regime: none
tags: ['agent-loupe', 'sqlite', 'transaction', 'pagination', 'agent-zero']
series: 'agent-zero'
day: 659
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 658](/blog/agent-zero/day-658-loupe-schema/) 先列了前端要的六个接口,再倒推出 `runs`、`steps`、`run_tags` 三张表和一个 `runs_by_time` 索引,写了 `loupe/db.py` 的 `connect`、`ts` 和一个朴素的 `save_trace`,还留下了两个问题:一是 `save_trace` 逐条 `INSERT` 最后才 `commit`,中途出错会怎样;二是把 Langfuse 样例导入时撞上了 `UNIQUE constraint failed: runs.id`,因为它和 OTLP 样例是同一次运行。

今天把这两个问题都解决,然后写接口里最有讲究的一个查询:运行列表的分页。

## 今天要解决的问题

学完今天,你应该能做到:

1. 复现「写到一半出错,库里留下半截数据」,并用 `with conn:` 把导入变成一个事务,说清 `commit` 和 `rollback` 分别什么时候发生。
2. 让重复导入同一个 ID 的运行变成覆盖,并且覆盖失败时旧版本原样保留。
3. 写出 `list_runs` 的游标分页:`(started_at, id) < (?, ?)`、多取一条判断有没有下一页、游标的编码和解码。
4. 用实测数字解释 `LIMIT/OFFSET` 在翻页途中有新数据时会出什么错,和游标里只放时间会漏什么。

预计用时 3 小时。今天不调模型,花费 0。

前置:[Day 658](/blog/agent-zero/day-658-loupe-schema/)(三张表、`ts`、朴素版 `save_trace`)、[Day 91](/blog/agent-zero/day-091-sql-6/)(事务的直觉)、[Day 93](/blog/agent-zero/day-093-python-sqlite-2/)(Python 里的 `commit`、`rollback` 和 `with conn`)。

学法提示:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `save_trace` 和 `list_runs` 默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先看半截数据长什么样

动手改之前先把昨天的版本留一份。后面几个演示要拿它做对照:

```bash
cd /Users/你/agent-loupe/server
cp loupe/db.py scratch/db_658.py
```

然后写一个脚本,故意让一万步里的第 5000 步出错。出错的办法是把那一步的 `kind` 改成 `llm2`,它不在五种里,会被 Day 658 的 `CHECK` 约束拦下:

```python
# agent-loupe/server/scratch/s28_half.py
"""Day 658 的 save_trace 写到一半出错,会留下什么?(用 scratch/db_658.py 里的朴素版,那是昨天 db.py 的拷贝)"""
import sqlite3
from pathlib import Path

from loupe import db
from loupe.importers import import_any
from loupe.models import Trace
from scratch import db_658 as old

SAMPLES = Path(__file__).parents[2] / "samples"
big = import_any((SAMPLES / "synthetic_10k.jsonl").read_text(encoding="utf-8"))[0]
broken_steps = list(big.steps)
broken_steps[5000] = broken_steps[5000].model_copy(update={"kind": "llm2"})  # 第 5000 步的 kind 不在五种里
broken = Trace(run=big.run, steps=broken_steps)

conn = db.connect(":memory:")
try:
    old.save_trace(conn, broken)
except sqlite3.IntegrityError as e:
    print("写入失败:", e)

print("失败之后,同一个连接里:", [tuple(r) for r in conn.execute(
    "SELECT id, step_count, (SELECT COUNT(*) FROM steps) FROM runs")])

# 再写一条毫无关系的、正常的小运行。它最后的 commit() 会把前面那半截一起提交
old.save_trace(conn, import_any((SAMPLES / "weather_sdk.jsonl").read_text(encoding="utf-8"))[0])
print("再写一条正常的之后:", [tuple(r) for r in conn.execute(
    "SELECT r.id, r.step_count, COUNT(s.idx) FROM runs r LEFT JOIN steps s ON s.run_id = r.id GROUP BY r.id")])
```

<div class="line-notes">

- `from scratch import db_658 as old` 把昨天的 `db.py` 拷贝当模块导入,改个名叫 `old`,和今天的 `db` 区分开。`scratch/` 里有 `__init__.py`(Day 652 建的),所以能这样导入;要用 `uv run python -m scratch.s28_half` 来跑,不是 `python scratch/s28_half.py`。
- `big = import_any(` 读那份一万步的合成数据,`[0]` 取唯一的一条运行。
- `broken_steps[5000] = broken_steps[5000].model_copy(update={"kind": "llm2"})` `model_copy(update=...)` 复制一个对象并改几个字段。**它不会重新校验**,所以 `kind` 能被改成 `Step` 本来不允许的值,pydantic 不拦,等到数据库的 `CHECK` 才拦。这是我们要的:模拟「模型层放过去了、库里出了问题」。
- `broken = Trace(run=big.run, steps=broken_steps)` 拼一条新的 `Trace`,和原来唯一的区别是第 5000 步。
- `conn = db.connect(":memory:")` 用今天的 `connect` 开一个内存库。表结构和昨天一样。
- `old.save_trace(conn, broken)` 昨天的朴素版。它会先插 runs、再插 tags、再逐步插 steps,插到第 5000 步被拦下。
- `except sqlite3.IntegrityError as e:` 抓住那个错误,打印出来。
- `"SELECT id, step_count, (SELECT COUNT(*) FROM steps) FROM runs"` 查运行表,并且用一个子查询数 steps 总行数。两个数放在一起看:运行声称有多少步,实际有多少步。
- `old.save_trace(conn, import_any(` 现在写一条完全无关的、正常的运行(Day 656 的天气 Agent 样例)。它最后会调用 `conn.commit()`。
- `GROUP BY r.id` 按运行分组,数每条运行实际有几步,这是昨天练习 3 的检查,今天放进 `db.py` 里。

</div>

```text
写入失败: CHECK constraint failed: kind IN ('llm', 'tool', 'agent', 'retrieval', 'other')
失败之后,同一个连接里: [('syn10000', 10000, 5000)]
再写一条正常的之后: [('c70cc39b6020', 6, 6), ('syn10000', 10000, 5000)]
```

三行输出一行比一行糟。

第一行是预期之内的:数据库把坏数据拦下了。第二行:失败之后,`runs` 里已经有一行 `syn10000`,它的 `step_count` 说 10000,而 `steps` 表里只有前 5000 步(第 0 到 4999 步在出错之前已经插进去了)。这时候这些数据在同一个连接里是看得见的,只是**还没提交**。

第三行才是真正的坑。我又写了一条毫不相干的正常运行,它的最后一行 `conn.commit()` 把**这个连接上所有未提交的修改**一起提交了,包括那半截 `syn10000`。现在库里躺着一条声称 10000 步、实际只有 5000 步的运行,前端加载到第 5000 步就没有了,也没有任何报错告诉你这条数据是坏的。

为什么会这样?[Day 93](/blog/agent-zero/day-093-python-sqlite-2/) 讲过,Python 的 `sqlite3` 在你第一次执行 `INSERT`、`UPDATE`、`DELETE` 时,会悄悄先发一个 `BEGIN` 开始一个事务,之后所有写操作都在这个事务里,直到你调用 `commit()` 或 `rollback()`。出错时 Python **不会自动回滚**,事务停在那里敞着,下一次谁调用 `commit()`,谁就把它提交。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="没有事务和有事务的对比:没有事务时第 5000 步出错,前 4999 步留在库里;有事务时出错就回滚,库回到导入之前">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
  <text x="160" y="26" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">昨天的版本</text>
  <text x="480" y="26" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">with conn: 一个事务</text>
  <rect x="40" y="42" width="240" height="26" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="160" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">INSERT runs ✓</text>
  <rect x="40" y="72" width="240" height="26" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="160" y="90" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">INSERT steps 第 0 到 4999 步 ✓</text>
  <rect x="40" y="102" width="240" height="26" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="160" y="120" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">第 5000 步:CHECK 失败 ✗</text>
  <rect x="40" y="136" width="240" height="26" fill="none" stroke="var(--rule)"/>
  <text x="160" y="154" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">没人回滚,事务敞着</text>
  <rect x="40" y="170" width="240" height="26" fill="none" stroke="var(--rule)"/>
  <text x="160" y="188" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">下一次 commit() 把半截一起提交</text>
  <text x="160" y="226" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">库里:step_count 10000,实际 5000</text>
  <rect x="360" y="42" width="240" height="26" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="480" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">DELETE 旧版 + INSERT runs</text>
  <rect x="360" y="72" width="240" height="26" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="480" y="90" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">INSERT steps 第 0 到 4999 步</text>
  <rect x="360" y="102" width="240" height="26" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="480" y="120" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">第 5000 步:CHECK 失败 ✗</text>
  <rect x="360" y="136" width="240" height="26" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="480" y="154" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">with 块抛异常 → 自动 ROLLBACK</text>
  <rect x="360" y="170" width="240" height="26" fill="none" stroke="var(--rule)"/>
  <text x="480" y="188" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">以上全部作废,包括 DELETE</text>
  <text x="480" y="226" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">库里:和导入之前一模一样</text>
</svg>
<figcaption>同样在第 5000 步出错。右边的 ROLLBACK 连先前的 DELETE 一起撤销,所以覆盖失败时旧版本还在。</figcaption>
</figure>

## 一个事务,加上覆盖

修法是把整个导入包进 `with conn:`。Python 的 sqlite3 里,连接对象本身就是事务的上下文管理器:代码块正常走完就 `commit`,中途抛了异常就 `rollback` 然后把异常继续往外抛。`save_trace` 改成这样:

```python
# agent-loupe/server/loupe/db.py(Day 659 版,只列改动的函数)
def save_trace(conn: sqlite3.Connection, trace: Trace) -> None:
    r = trace.run
    with conn:  # 一个事务:代码块正常结束就提交,抛异常就整个回滚
        conn.execute("DELETE FROM runs WHERE id = ?", (r.id,))  # 同一个 id 再导入 = 覆盖;级联删掉旧的 steps 和 run_tags
        conn.execute(
            "INSERT INTO runs (id, name, started_at, ended_at, status, model, total_input_tokens,"
            " total_output_tokens, total_cost_usd, tags, parent_run_id, forked_from_step, step_count)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (r.id, r.name, ts(r.started_at), ts(r.ended_at), r.status, r.model, r.total_input_tokens,
             r.total_output_tokens, r.total_cost_usd, json.dumps(r.tags, ensure_ascii=False),
             r.parent_run_id, r.forked_from_step, len(trace.steps)),
        )
        conn.executemany("INSERT INTO run_tags (run_id, tag) VALUES (?, ?)", [(r.id, t) for t in r.tags])
        conn.executemany(
            "INSERT INTO steps (run_id, idx, parent_idx, kind, name, started_at, ended_at, input,"
            " output, error, input_tokens, output_tokens, cost_usd, model)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [(s.run_id, s.idx, s.parent_idx, s.kind, s.name, ts(s.started_at), ts(s.ended_at),
              json.dumps(s.input, ensure_ascii=False), json.dumps(s.output, ensure_ascii=False),
              s.error, s.input_tokens, s.output_tokens, s.cost_usd, s.model) for s in trace.steps],
        )


def mismatched_counts(conn: sqlite3.Connection) -> list[tuple[str, int, int]]:
    """step_count 和 steps 实际行数对不上的运行。正常情况下永远是空列表。"""
    rows = conn.execute(
        "SELECT r.id, r.step_count, COUNT(s.idx) FROM runs r LEFT JOIN steps s ON s.run_id = r.id"
        " GROUP BY r.id HAVING r.step_count != COUNT(s.idx)"
    ).fetchall()
    return [(r[0], r[1], r[2]) for r in rows]
```

<div class="line-notes">

- `with conn:` 进入块时什么也不做(事务在第一条写语句时自动开始),块正常结束调用 `conn.commit()`,抛异常调用 `conn.rollback()`。≈ JS 里 `try { ...; await commit() } catch (e) { await rollback(); throw e }` 的简写。注意它**不关闭连接**,只管事务。
- `conn.execute("DELETE FROM runs WHERE id = ?", (r.id,))` 事务的第一件事:删掉同 id 的旧运行。没有旧运行就什么也不删,不报错。因为 Day 658 打开了外键,`ON DELETE CASCADE` 会把旧版本的 `steps` 和 `run_tags` 一起删掉,所以不用我们另外写两条 DELETE。
- `" VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",` 插入新版本的 runs 行,和昨天一样。`step_count` 取 `len(trace.steps)`。
- `conn.executemany("INSERT INTO run_tags (run_id, tag) VALUES (?, ?)", [(r.id, t) for t in r.tags])` 昨天是 `for` 循环里一条条 `execute`,今天换成 `executemany`:一次调用,传一个参数列表,Python 在 C 层循环。标签很少,差别看不出,但写法一致。
- `" output, error, input_tokens, output_tokens, cost_usd, model)"` 步骤的插入。`executemany` 的第二个参数是一个列表,每一项是一行的 14 个值。一万步就是一万个元组。
- `[(s.run_id, s.idx, s.parent_idx, s.kind,` 列表推导里每一步转成一个元组,顺序必须和上面 14 个列名一致。
- `def mismatched_counts(` 昨天练习 3 的检查,今天放进 `db.py`,测试和以后的体检脚本都能用。
- `HAVING r.step_count != COUNT(s.idx)` 分组之后只留下不一致的运行。返回空列表就是一切正常。
- `return [(r[0], r[1], r[2]) for r in rows]` 把 `sqlite3.Row` 转成普通元组。这样返回类型是 `list[tuple[str, int, int]]`,类型检查也满意。

</div>

同样是第 5000 步出错的 `broken`,现在会怎样,再加上「覆盖」,放在一个脚本里看:

```python
# agent-loupe/server/scratch/s29_atomic.py
"""同样的坏数据,事务版 save_trace 会留下什么?再看覆盖语义。"""
import sqlite3
from pathlib import Path

from loupe import db
from loupe.importers import import_any
from loupe.models import Trace

SAMPLES = Path(__file__).parents[2] / "samples"


def load(name: str) -> Trace:
    return import_any((SAMPLES / name).read_text(encoding="utf-8"))[0]


big = load("synthetic_10k.jsonl")
broken_steps = list(big.steps)
broken_steps[5000] = broken_steps[5000].model_copy(update={"kind": "llm2"})
broken = Trace(run=big.run, steps=broken_steps)

conn = db.connect(":memory:")
try:
    db.save_trace(conn, broken)
except sqlite3.IntegrityError as e:
    print("写入失败:", e)
print("失败之后:", conn.execute("SELECT COUNT(*) FROM runs").fetchone()[0], "条运行,",
      conn.execute("SELECT COUNT(*) FROM steps").fetchone()[0], "个步骤")

print("--- 覆盖")
otlp, langfuse = load("weather_otlp.jsonl"), load("weather_langfuse.json")
print("两份样例 id 相同:", otlp.run.id == langfuse.run.id)
db.save_trace(conn, otlp)
print("导入 OTLP 版:", [tuple(r) for r in conn.execute("SELECT name, step_count, tags FROM runs")],
      [r[0] for r in conn.execute("SELECT tag FROM run_tags ORDER BY tag")])
db.save_trace(conn, langfuse)
print("再导入 Langfuse 版:", [tuple(r) for r in conn.execute("SELECT name, step_count, tags FROM runs")],
      [r[0] for r in conn.execute("SELECT tag FROM run_tags ORDER BY tag")])

print("--- 覆盖时出错,旧的还在吗")
db.save_trace(conn, big.model_copy(update={"steps": big.steps[:30]}))  # 先放一个正常的版本
good = conn.execute("SELECT step_count FROM runs WHERE id = ?", (big.run.id,)).fetchone()[0]
try:
    db.save_trace(conn, broken)  # 同一个 id,新版本是坏的
except sqlite3.IntegrityError:
    pass
now = conn.execute("SELECT step_count FROM runs WHERE id = ?", (big.run.id,)).fetchone()[0]
print(f"覆盖前 step_count={good},覆盖失败后 step_count={now},steps 实际 {conn.execute('SELECT COUNT(*) FROM steps WHERE run_id = ?', (big.run.id,)).fetchone()[0]} 行")
print("不一致的运行:", db.mismatched_counts(conn))
```

<div class="line-notes">

- `def load(name: str) -> Trace:` 小辅助:读一个样例文件,返回第一条 `Trace`。后面几个脚本和测试都会用到同样的写法。
- `broken_steps[5000] = broken_steps[5000].model_copy(` 和上一个脚本一样,制造第 5000 步的坏数据。
- `db.save_trace(conn, broken)` 这回是今天的事务版。
- `conn.execute("SELECT COUNT(*) FROM runs").fetchone()[0]` 数运行数。如果事务回滚生效,应该是 0。
- `otlp.run.id == langfuse.run.id` 两个样例的 run id 相同。打印出来是 `True`,这就是昨天撞主键的原因。
- `db.save_trace(conn, otlp)` 第一次导入 OTLP 版。再查 `runs` 和 `run_tags`,标签是 `otlp`、`weather-agent`。
- `db.save_trace(conn, langfuse)` 第二次导入同 id 的 Langfuse 版,不报错了:先 DELETE 旧行(级联清掉旧标签和旧步骤),再 INSERT 新行。标签变成 `langfuse`、`weather`,旧标签没有残留。
- `big.model_copy(update={"steps": big.steps[:30]})` 先放一个只有前 30 步的正常版本进去,当「旧版本」。注意这里的 `run` 没改,所以 id 是 `syn10000`。
- `good = conn.execute("SELECT step_count FROM runs WHERE id = ?", (big.run.id,)).fetchone()[0]` 记下覆盖之前的步数,30。
- `db.save_trace(conn, broken)  # 同一个 id,新版本是坏的` 用坏数据去覆盖。事务里先 DELETE 了旧版本,再插到第 5000 步出错,整个回滚,DELETE 也被撤销。
- `except sqlite3.IntegrityError:` 吞掉异常(`pass`),脚本继续。真实的接口里这个异常会变成 HTTP 响应,Day 660 讲。
- `db.mismatched_counts(conn)` 最后用检查函数确认库里没有任何不一致。

</div>

```text
写入失败: CHECK constraint failed: kind IN ('llm', 'tool', 'agent', 'retrieval', 'other')
失败之后: 0 条运行, 0 个步骤
--- 覆盖
两份样例 id 相同: True
导入 OTLP 版: [('invoke_agent weather_agent', 6, '["otlp", "weather-agent"]')] ['otlp', 'weather-agent']
再导入 Langfuse 版: [('invoke_agent weather_agent', 6, '["weather", "langfuse"]')] ['langfuse', 'weather']
--- 覆盖时出错,旧的还在吗
覆盖前 step_count=30,覆盖失败后 step_count=30,steps 实际 30 行
不一致的运行: []
```

三件事都成立:失败之后库是空的(不是半截);重复导入同一个 id 是覆盖,旧标签没有残留;覆盖到一半失败,旧版本毫发无损,这是「先 DELETE 再 INSERT 放在同一个事务里」的直接好处,也是我不选「先判断存不存在再决定」的原因,那样要自己处理两步之间别人插进来的情况。

**为什么选覆盖,而不是报「已存在」?** 调试 Loupe 的时候,最常见的操作是「改了导入器,把同一个文件再导一次看看」。报错的话每次都得先去手动删除。覆盖语义对这个使用场景最顺手。代价是用户不小心导入了另一份同 id 的文件,会静默覆盖掉原来的,对单人使用的工具我接受;多人共用的话要换成「报冲突」,写进已知限制。

同一个事务也让一万步写得更快一点:

```text
朴素版:[0.79, 0.86, 0.87] 秒,平均 0.84
事务版:[0.67, 0.66, 0.57] 秒,平均 0.64
```

(脚本是 `scratch/s33_speed.py`,各写三次,在我这台 2019 款 13 寸 Intel MacBook Pro 上。)快了 25% 左右,主要省在 `executemany`,不是事务。大头其实是 Python 一侧的 `json.dumps` 和 `ts()`,一万步每步都要转一遍。这个速度不需要再优化,所以我不动它。

## 事务期间别人能看到什么

事务是「连接级别」的,不是「库级别」的,这一点容易想错。同一个连接里,事务没提交时你自己能看到自己的修改;**另一个连接看不到**。练习 1 带你亲手验证,数字在那里。这件事 Day 660 会再用到:接口层同一个连接被多个线程共用时,事务会「串」起来,需要多想一步。

## 分页:先看 OFFSET 怎么坏

运行列表按开始时间倒序,最新的在最上面。库里的运行多了,一次不可能全返回,要分页。最容易想到的写法是 `LIMIT 50 OFFSET 100`:跳过 100 行,取 50 行。

它有两个毛病。第一个是慢:`OFFSET 100000` 的意思是「先数出十万行扔掉,再取 50 行」,越往后越慢。第二个更要紧:**翻页途中数据变了,结果会错**。下面用 7 条运行、每页 3 条演示:

```python
# agent-loupe/server/scratch/s30_offset.py
"""翻页途中来了一条新运行:OFFSET 分页 vs 游标分页。"""
from datetime import datetime, timedelta, timezone

from loupe import db

conn = db.connect(":memory:")
T0 = datetime(2026, 10, 27, 2, 0, 0, tzinfo=timezone.utc)


def add(n: int) -> None:
    conn.execute(
        "INSERT INTO runs (id, name, started_at, ended_at, status) VALUES (?, ?, ?, ?, 'ok')",
        (f"R{n}", f"run {n}", db.ts(T0 + timedelta(minutes=n)), db.ts(T0 + timedelta(minutes=n))),
    )
    conn.commit()


for n in range(1, 8):  # R1 最旧,R7 最新
    add(n)

ids = lambda rows: [r["id"] for r in rows]  # noqa: E731
q = "SELECT id FROM runs ORDER BY started_at DESC, id DESC"

page1 = ids(conn.execute(q + " LIMIT 3 OFFSET 0").fetchall())
cur_page1 = db.list_runs(conn, limit=3)
print("第一页(OFFSET):", page1, " 第一页(游标):", [r["id"] for r in cur_page1["items"]])

add(8)  # 用户还停在第一页,另一个窗口导入了一条更新的运行
print("--- 导入了 R8")
page2 = ids(conn.execute(q + " LIMIT 3 OFFSET 3").fetchall())
print("第二页(OFFSET):", page2, " <- 和第一页重复了:", sorted(set(page1) & set(page2)))
cur_page2 = db.list_runs(conn, limit=3, cursor=cur_page1["next_cursor"])
print("第二页(游标):  ", [r["id"] for r in cur_page2["items"]])
print("游标内容(base64):", cur_page1["next_cursor"], "->", db.decode_cursor(cur_page1["next_cursor"]))
```

<div class="line-notes">

- `T0 = datetime(2026, 10, 27, 2, 0, 0, tzinfo=timezone.utc)` 基准时间。`n` 越大,运行开始得越晚。
- `def add(n: int) -> None:` 往库里加一条名叫 `R{n}` 的运行,开始时间是 T0 加 n 分钟。每条都有不同的开始时间,先不考虑时间相同的情况。
- `for n in range(1, 8):` 加 R1 到 R7,所以倒序是 R7、R6、……、R1。
- `ids = lambda rows: [r["id"] for r in rows]` 一个一行的小函数,把查询结果取出 id 列表。`# noqa: E731` 是告诉代码检查工具别抱怨「不要把 lambda 赋给变量」。
- `page1 = ids(conn.execute(q + " LIMIT 3 OFFSET 0").fetchall())` OFFSET 版第一页:跳过 0 行,取 3 行,得到 R7、R6、R5。
- `cur_page1 = db.list_runs(conn, limit=3)` 游标版第一页,用的是稍后要看的 `list_runs`。同样得到 R7、R6、R5,并且返回一个 `next_cursor`。
- `add(8)` 用户的页面还停在第一页,这时另一个窗口导入了一条更新的运行 R8,它排在列表的最前面,原来的所有行都往后挪了一位。
- `" LIMIT 3 OFFSET 3"` OFFSET 版第二页:跳过 3 行。但现在最前面多了 R8,「前 3 行」变成了 R8、R7、R6,跳过它们以后取到的是 R5、R4、R3。R5 在第一页已经看过了。
- `sorted(set(page1) & set(page2))` 集合交集,找出两页里重复的 id。
- `db.list_runs(conn, limit=3, cursor=cur_page1["next_cursor"])` 游标版第二页:不管前面多了几条,总是「从 R5 之后接着取」,得到 R4、R3、R2。
- `db.decode_cursor(` 把游标解开给你看:它就是第一页最后一条的开始时间和 id,用 base64 编码。

</div>

```text
第一页(OFFSET): ['R7', 'R6', 'R5']  第一页(游标): ['R7', 'R6', 'R5']
--- 导入了 R8
第二页(OFFSET): ['R5', 'R4', 'R3']  <- 和第一页重复了: ['R5']
第二页(游标):   ['R4', 'R3', 'R2']
游标内容(base64): MjAyNi0xMC0yN1QwMjowNTowMC4wMDAwMDArMDA6MDB8UjU= -> ('2026-10-27T02:05:00.000000+00:00', 'R5')
```

OFFSET 把 R5 返回了两次。反方向也一样:翻页途中删掉一条,会漏掉一条,而且不会有任何报错。调试工具里「刚导入一条,马上回列表找」是最常见的操作,所以这是真问题。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="翻页途中导入 R8:OFFSET 第二页重复返回 R5,游标第二页从 R5 之后接着取 R4 R3 R2">
  <rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)" rx="6"/>
  <text x="160" y="26" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">LIMIT 3 OFFSET 3</text>
  <text x="480" y="26" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">(时间, id) &lt; (R5 的)</text>
  <rect x="60" y="40" width="200" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="160" y="56" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">R8(新导入)</text>
  <rect x="60" y="64" width="200" height="22" fill="none" stroke="var(--rule)"/>
  <text x="160" y="80" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">R7</text>
  <rect x="60" y="88" width="200" height="22" fill="none" stroke="var(--rule)"/>
  <text x="160" y="104" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">R6</text>
  <rect x="60" y="112" width="200" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="160" y="128" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">R5 ← 又出现了一次</text>
  <rect x="60" y="136" width="200" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="160" y="152" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">R4</text>
  <rect x="60" y="160" width="200" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="160" y="176" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">R3</text>
  <rect x="380" y="40" width="200" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="480" y="56" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">R8(新导入,不影响)</text>
  <rect x="380" y="64" width="200" height="22" fill="none" stroke="var(--rule)"/>
  <text x="480" y="80" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">R7</text>
  <rect x="380" y="88" width="200" height="22" fill="none" stroke="var(--rule)"/>
  <text x="480" y="104" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">R6</text>
  <rect x="380" y="112" width="200" height="22" fill="none" stroke="var(--rule)"/>
  <text x="480" y="128" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">R5 ← 第一页最后一条</text>
  <rect x="380" y="136" width="200" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="480" y="152" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">R4</text>
  <rect x="380" y="160" width="200" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="480" y="176" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">R3</text>
  <rect x="380" y="184" width="200" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="480" y="200" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">R2</text>
  <text x="160" y="232" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">第二页:R5 R4 R3</text>
  <text x="480" y="232" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">第二页:R4 R3 R2</text>
  <text x="320" y="258" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">蓝色是第二页返回的行,第一页是 R7 R6 R5</text>
</svg>
<figcaption>用户停在第一页期间导入了 R8:左边按「跳过 3 行」翻页,R5 重复;右边按「第一页最后一条之后」翻页,不受影响。</figcaption>
</figure>

慢的那一个毛病,在我们这个数据量下没那么吓人。下面是 20 万条运行、每页 50 条,翻到不同深度的耗时(脚本 `scratch/s32_deep.py`):

```text
第    1 页:OFFSET   0.19 毫秒,游标  0.13 毫秒
第  100 页:OFFSET   0.27 毫秒,游标  0.13 毫秒
第 1000 页:OFFSET   2.27 毫秒,游标  0.14 毫秒
第 3999 页:OFFSET   8.76 毫秒,游标  0.17 毫秒
```

OFFSET 随页数线性变慢,游标不变。但 8.76 毫秒对用户来说也没有区别,没有人会翻 4000 页。所以不要说 OFFSET「太慢所以不能用」,不诚实;**重复和漏行**才是我们换成游标的理由。(这里的「第 1 页」游标是取第一条之后的 50 条,不是真正的第一页,量级对比不受影响。)

## 游标:从上一页最后一条之后接着取

游标分页换一种问法:不说「跳过多少行」,而说「从上一页最后一条之后接着取」。上一页最后一条的排序键编码成一个字符串交给前端,下一页的查询条件就是「排序键小于它」。新数据插在前面不影响后面,查询直接沿着 Day 658 的 `runs_by_time` 索引定位,也不用数前面的行。

排序键用 `started_at` 就够了吗?不够。我在 Day 658 说过,合成数据和批量导入里,不同的运行开始时间可能完全相同。看看只用时间会漏什么:

```python
# agent-loupe/server/scratch/s31_ties.py
"""游标里只放时间会怎样:同一时刻的几条运行会被跳过。"""
from datetime import datetime, timezone

from loupe import db

conn = db.connect(":memory:")
SAME = db.ts(datetime(2026, 10, 27, 2, 0, 0, tzinfo=timezone.utc))
for rid in ["a", "b", "c", "d", "e"]:  # 五条运行,开始时间完全一样(批量导入、合成数据都会这样)
    conn.execute("INSERT INTO runs (id, name, started_at, ended_at, status) VALUES (?, ?, ?, ?, 'ok')",
                 (rid, rid, SAME, SAME))
conn.commit()

page1 = conn.execute("SELECT id, started_at FROM runs ORDER BY started_at DESC, id DESC LIMIT 2").fetchall()
print("第一页:", [r["id"] for r in page1])
last = page1[-1]

only_time = conn.execute("SELECT id FROM runs WHERE started_at < ? ORDER BY started_at DESC, id DESC LIMIT 2",
                         (last["started_at"],)).fetchall()
print("游标只有时间,第二页:", [r["id"] for r in only_time], "(c、b、a 全丢了)")

both = conn.execute("SELECT id FROM runs WHERE (started_at, id) < (?, ?) ORDER BY started_at DESC, id DESC LIMIT 2",
                    (last["started_at"], last["id"])).fetchall()
print("时间加 id,第二页:", [r["id"] for r in both])

plan = conn.execute("EXPLAIN QUERY PLAN SELECT * FROM runs WHERE (started_at, id) < (?, ?)"
                    " ORDER BY started_at DESC, id DESC LIMIT 2", (last["started_at"], last["id"])).fetchall()
print("行值比较的计划:", [r[3] for r in plan])
```

<div class="line-notes">

- `SAME = db.ts(datetime(2026, 10, 27, 2, 0, 0, tzinfo=timezone.utc))` 一个固定的时间文本,下面五条运行都用它。
- `for rid in ["a", "b", "c", "d", "e"]:` 五条运行,id 分别是 a 到 e,开始时间完全一样。`ORDER BY started_at DESC, id DESC` 以后的顺序是 e、d、c、b、a。
- `page1 = conn.execute("SELECT id, started_at FROM runs ORDER BY started_at DESC, id DESC LIMIT 2")` 第一页取两条,得到 e、d。
- `last = page1[-1]` 第一页最后一条是 d,它的游标是 `(那个时间, 'd')`。
- `WHERE started_at < ?` 游标里只放时间的写法:要比 d 的时间更早的运行。可是 a 到 e 的时间一样,没有一条「更早」,查询返回空列表。c、b、a 就这样从列表里消失了,而且没有报错,用户以为第二页已经没有数据。
- `WHERE (started_at, id) < (?, ?)` 行值比较:先比时间,时间相同再比 id,等价于 `started_at < ? OR (started_at = ? AND id < ?)`,但更短,而且能用上索引。比 `(时间, 'd')` 更小的是 c、b、a,取前两条得到 c、b。
- `EXPLAIN QUERY PLAN SELECT * FROM runs WHERE (started_at, id) < (?, ?)` 看这个写法的查询计划。

</div>

```text
第一页: ['e', 'd']
游标只有时间,第二页: [] (c、b、a 全丢了)
时间加 id,第二页: ['c', 'b']
行值比较的计划: ['SEARCH runs USING INDEX runs_by_time ((started_at,id)<(?,?))']
```

最后一行是我最想让你看的:计划写的是 `SEARCH ... USING INDEX runs_by_time ((started_at,id)<(?,?))`,SQLite 把行值比较直接变成了索引范围查找,没有 `SCAN`、没有 `TEMP B-TREE`。行值比较是 SQLite 3.15(2016 年)才支持的,我这里是 3.53.1。如果你的环境太老,换成展开的 `OR` 写法也行,但计划就不一定这么漂亮,要自己看一眼。

## `list_runs` 和游标的编码

```python
# agent-loupe/server/loupe/db.py(Day 659 版,续)
import base64
from typing import Any   # 这两行加在文件顶部


def _run_from_row(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    d["tags"] = json.loads(d["tags"])
    return d


def encode_cursor(started_at: str, run_id: str) -> str:
    return base64.urlsafe_b64encode(f"{started_at}|{run_id}".encode()).decode()


def decode_cursor(cursor: str) -> tuple[str, str]:
    """被改坏或截断的游标会抛 ValueError(binascii.Error 和 UnicodeDecodeError 都是它的子类)。"""
    started_at, run_id = base64.urlsafe_b64decode(cursor.encode()).decode().split("|", 1)
    return started_at, run_id


def list_runs(conn: sqlite3.Connection, *, tag: str | None = None, status: str | None = None,
              q: str | None = None, cursor: str | None = None, limit: int = 50) -> dict[str, Any]:
    where: list[str] = []
    args: list[Any] = []
    if tag:
        where.append("id IN (SELECT run_id FROM run_tags WHERE tag = ?)")
        args.append(tag)
    if status:
        where.append("status = ?")
        args.append(status)
    if q:
        where.append("name LIKE ?")
        args.append(f"%{q}%")
    if cursor:
        where.append("(started_at, id) < (?, ?)")  # 接着上一页最后一条往后取
        args += decode_cursor(cursor)
    sql = "SELECT * FROM runs" + (" WHERE " + " AND ".join(where) if where else "")
    sql += " ORDER BY started_at DESC, id DESC LIMIT ?"
    rows = conn.execute(sql, [*args, limit + 1]).fetchall()  # 多取一条,用来判断还有没有下一页
    items = [_run_from_row(r) for r in rows[:limit]]
    next_cursor = encode_cursor(items[-1]["started_at"], items[-1]["id"]) if len(rows) > limit else None
    return {"items": items, "next_cursor": next_cursor}


def get_run(conn: sqlite3.Connection, run_id: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
    return _run_from_row(row) if row else None
```

<div class="line-notes">

- `import base64` 游标要用 base64 编码。`from typing import Any` 是因为返回的字典里值的类型各不相同(字符串、数字、列表)。这两行放到 `db.py` 文件顶部的导入区,不是放在这里。
- `d = dict(row)` `sqlite3.Row` 转成普通字典,这样才能改。
- `d["tags"] = json.loads(d["tags"])` 库里的 `tags` 是 JSON 文本,返回给前端前解成真正的列表,前端拿到的是 `["weather", "sdk"]` 不是字符串。
- `base64.urlsafe_b64encode(f"{started_at}|{run_id}".encode()).decode()` 把「时间|id」编码成字符串。`urlsafe` 版本用 `-` 和 `_` 代替 `+` 和 `/`,放进 URL 不用再转义。`.encode()` 字符串变字节,`.decode()` 编出来的字节再变回字符串。代入 R5:`2026-10-27T02:05:00.000000+00:00|R5` 编成 `MjAyNi0xMC0y...`。
- `started_at, run_id = base64.urlsafe_b64decode(cursor.encode()).decode().split("|", 1)` 解码,按第一个 `|` 切成两段。`split("|", 1)` 的 `1` 表示最多切一刀,万一 id 里也有 `|` 也不会错。被改坏的游标会在这里抛 `ValueError`:`"garbage"` 解码时抛 `binascii.Error`(长度不对),合法 base64 但里面没有 `|` 则是解包失败。
- `def list_runs(conn` 参数里的 `*` 表示后面的都必须写成关键字参数 `list_runs(conn, tag="demo")`,不能按位置传。`limit` 默认 50。
- `where: list[str] = []` 条件片段列表,`args` 对应的参数列表。条件是一块一块拼的,但**值永远走 `?` 占位符**,不拼进 SQL 字符串,所以没有注入风险。
- `where.append("id IN (SELECT run_id FROM run_tags WHERE tag = ?)")` 标签过滤:用 Day 658 的 `run_tags` 表。
- `where.append("status = ?")` 状态过滤,值是 `ok` 或 `error`。
- `args.append(f"%{q}%")` 名字包含:前后各加一个 `%` 通配符。注意如果用户的搜索词里本身有 `%` 或 `_`,它们也会被当成通配符,练习 2 处理这个。
- `where.append("(started_at, id) < (?, ?)")` 游标条件,有 cursor 才加。
- `args += decode_cursor(cursor)` 解码出来的两个值依次追加到参数列表。`+=` 对列表是原地追加,元组会被展开成两项。
- `" ORDER BY started_at DESC, id DESC LIMIT ?"` 排序和 Day 658 的索引完全一致。`LIMIT` 也用占位符。
- `[*args, limit + 1]` 把 `args` 展开,再追加 `limit + 1`。**多取一条**:取到了 `limit + 1` 条,说明后面还有;只取到 `limit` 条或更少,说明这是最后一页。这样不用另外跑一个 `COUNT`。
- `items = [_run_from_row(r) for r in rows[:limit]]` 只取前 `limit` 条返回,多出来的那一条丢掉。
- `next_cursor = encode_cursor(` 还有下一页时,用这页最后一条做游标;没有就是 `None`,前端据此隐藏「加载更多」。
- `def get_run(` 按主键取一条,不存在返回 `None`,接口层(明天)据此返回 404。

</div>

几个细节:

**游标是不透明的。** 前端应该把它当成一个黑盒字符串原样传回,不要去拆、不要去拼。base64 不是加密,谁都能解开(上面的输出就解开了),所以游标里不能放任何敏感信息,我们放的只是一个时间和一个 id。以后想换排序键(比如按成本排序),只要后端改编码,前端一行都不用动,这是「不透明」的好处。

**被改坏的游标要报 400 不是 500。** `decode_cursor` 遇到坏游标抛 `ValueError`。明天写接口时把它转成 HTTP 400「cursor 无效」。500 是我们程序的 bug,400 是调用方传错了,这两种要分开,前端处理错误的方式也不同。

**和过滤条件一起用,没有问题。** 游标条件只是又加了一个 `AND`。带 `tag` 或 `status` 翻页时,每一页都带同样的过滤条件,游标是上一页最后一条的位置。但**前端翻页时必须保持过滤条件不变**,换了 `status` 就要丢掉旧的 cursor 从头来。

## 把今天的约定写成测试

昨天的 `tests/test_db.py` 继续往下加。每一个测试对应一个今天踩过的坑:

```python
# agent-loupe/server/tests/test_db.py(Day 659 追加)
def broken_copy(trace: Trace) -> Trace:
    """第 3 步的 kind 改成表里不允许的值:model_copy 不校验,写库时才被 CHECK 拦下。"""
    steps = list(trace.steps)
    steps[3] = steps[3].model_copy(update={"kind": "llm2"})
    return Trace(run=trace.run, steps=steps)


def test_failed_import_leaves_nothing(conn: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        db.save_trace(conn, broken_copy(load("synthetic_small.jsonl")))
    for table in ("runs", "steps", "run_tags"):
        assert conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0


def test_reimport_overwrites_including_tags(conn: sqlite3.Connection) -> None:
    otlp, langfuse = load("weather_otlp.jsonl"), load("weather_langfuse.json")
    assert otlp.run.id == langfuse.run.id
    db.save_trace(conn, otlp)
    db.save_trace(conn, langfuse)
    assert conn.execute("SELECT COUNT(*) FROM runs").fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM steps").fetchone()[0] == len(langfuse.steps)
    assert {r["tag"] for r in conn.execute("SELECT tag FROM run_tags")} == set(langfuse.run.tags)


def test_failed_overwrite_keeps_old_version(conn: sqlite3.Connection) -> None:
    good = load("synthetic_small.jsonl")
    db.save_trace(conn, good)
    with pytest.raises(sqlite3.IntegrityError):
        db.save_trace(conn, broken_copy(good))
    assert db.mismatched_counts(conn) == []
    assert db.get_run(conn, good.run.id) is not None
    assert conn.execute("SELECT COUNT(*) FROM steps").fetchone()[0] == 30


def seed_runs(conn: sqlite3.Connection, n: int, *, distinct_times: int) -> None:
    """造 n 条运行,开始时间只有 distinct_times 种,所以有大量时间相同的行。"""
    t0 = datetime(2026, 10, 27, tzinfo=UTC)
    conn.executemany(
        "INSERT INTO runs (id, name, started_at, ended_at, status) VALUES (?, ?, ?, ?, ?)",
        [(f"r{i:04d}", f"run {i}", db.ts(t0 + timedelta(seconds=i % distinct_times)),
          db.ts(t0), "error" if i % 10 == 0 else "ok") for i in range(n)],
    )
    conn.commit()


def walk(conn: sqlite3.Connection, **kw: Any) -> list[str]:
    ids: list[str] = []
    cursor = None
    while True:
        page = db.list_runs(conn, cursor=cursor, **kw)
        ids += [r["id"] for r in page["items"]]
        cursor = page["next_cursor"]
        if cursor is None:
            return ids


def test_cursor_walk_no_dup_no_miss_with_ties(conn: sqlite3.Connection) -> None:
    seed_runs(conn, 120, distinct_times=7)  # 120 条里只有 7 种时间,每个时间点十几条
    ids = walk(conn, limit=25)
    assert len(ids) == 120 and len(set(ids)) == 120
    assert ids == [r["id"] for r in conn.execute("SELECT id FROM runs ORDER BY started_at DESC, id DESC")]


def test_cursor_stable_when_new_run_arrives(conn: sqlite3.Connection) -> None:
    seed_runs(conn, 10, distinct_times=10)
    page1 = db.list_runs(conn, limit=4)
    conn.execute("INSERT INTO runs (id, name, started_at, ended_at, status) VALUES ('new', 'new', ?, ?, 'ok')",
                 (db.ts(datetime(2030, 1, 1, tzinfo=UTC)),) * 2)
    page2 = db.list_runs(conn, limit=4, cursor=page1["next_cursor"])
    seen = [r["id"] for r in page1["items"]]
    assert not set(seen) & {r["id"] for r in page2["items"]}


def test_last_page_has_no_cursor(conn: sqlite3.Connection) -> None:
    seed_runs(conn, 5, distinct_times=5)
    assert db.list_runs(conn, limit=5)["next_cursor"] is None  # 刚好一页,没有下一页
    assert db.list_runs(conn, limit=4)["next_cursor"] is not None


def test_filters_and_bad_cursor(conn: sqlite3.Connection) -> None:
    seed_runs(conn, 30, distinct_times=30)
    assert len(walk(conn, status="error", limit=2)) == 3
    assert [r["name"] for r in db.list_runs(conn, q="run 17")["items"]] == ["run 17"]
    db.save_trace(conn, load("weather_sdk.jsonl"))
    assert [r["id"] for r in db.list_runs(conn, tag="weather")["items"]] == ["c70cc39b6020"]
    for bad in ("garbage", base64.urlsafe_b64encode(b"no-separator").decode()):
        with pytest.raises(ValueError):
            db.list_runs(conn, cursor=bad)
```

<div class="line-notes">

- `def broken_copy(trace: Trace) -> Trace:` 测试辅助:复制一条 trace,把第 3 步弄坏。以后别的测试要「写库一定失败的数据」都用它。
- `with pytest.raises(sqlite3.IntegrityError):` 断言里面的代码必须抛这个错误。如果 `save_trace` 吞掉了错误,这个测试会红。
- `for table in ("runs", "steps", "run_tags"):` 三张表都要查,不能只查 runs。昨天的半截数据就是 runs 里有一行、steps 里有一半。
- `assert otlp.run.id == langfuse.run.id` 先断言前提成立,避免样例以后换了、测试变成了在测别的东西。
- `{r["tag"] for r in conn.execute("SELECT tag FROM run_tags")} == set(langfuse.run.tags)` 覆盖以后标签只剩新版本的,旧标签不残留。这也间接测了外键级联。
- `db.save_trace(conn, good)` 先写一个好的版本,再去覆盖它。`assert db.mismatched_counts(conn) == []` 用今天写的检查函数。
- `distinct_times: int` 关键字参数。`i % distinct_times` 让时间在 0 到 6 秒之间循环,120 条里每个时间点有十几条,专门制造「时间相同」。
- `"error" if i % 10 == 0 else "ok"` 每 10 条有一条是 error,30 条里是 3 条(i 为 0、10、20)。
- `def walk(conn` 一直翻页翻到 `next_cursor` 为 `None`,返回所有 id。`**kw` 把额外参数(`limit`、`status`)原样传给 `list_runs`。
- `assert len(ids) == 120 and len(set(ids)) == 120` 一条不少(120 条),也一条不重(去重后还是 120)。
- `assert ids == [r["id"] for r in conn.execute(` 而且顺序和一次性全部查出来的顺序完全一致。
- `(db.ts(datetime(2030, 1, 1, tzinfo=UTC)),) * 2` 一个元组重复两次,得到 `(时间, 时间)` 给两个 `?` 用。2030 年保证它排在最前面。
- `assert not set(seen) &` 翻页途中插了一条最新的运行,第二页和第一页没有交集。
- `assert db.list_runs(conn, limit=5)["next_cursor"] is None` 刚好 5 条、每页 5 条:多取一条取不到,所以没有下一页。这是「多取一条」写法的边界。
- `walk(conn, status="error", limit=2)` 每页 2 条翻过滤后的列表,共 3 条 error,所以要翻两页。
- `for bad in ("garbage", base64.urlsafe_b64encode(b"no-separator").decode()):` 两种坏游标:根本不是 base64;是 base64 但里面没有 `|`。

</div>

```text
58 passed in 0.32s
```

58 是我本地全部测试(包含前几天)。光看「通过」不够,得验证这些测试真的能抓住错误。我故意把代码改坏五次,看哪个测试变红:

| 故意改坏的地方 | 变红的测试 |
| --- | --- |
| 去掉 `with conn:` | `test_failed_import_leaves_nothing`、`test_failed_overwrite_keeps_old_version` |
| 游标条件改成只比时间 | `test_cursor_walk_no_dup_no_miss_with_ties` |
| 去掉先 `DELETE` | `test_reimport_overwrites_including_tags`(`UNIQUE constraint failed: runs.id`) |
| `limit + 1` 改成 `limit` | 四个翻页相关的测试 |
| 关掉 `PRAGMA foreign_keys` | `test_delete_run_cascades`、`test_reimport_overwrites_including_tags` |

每一处都至少有一个测试盯着,这些测试才算有用。改完以后记得把代码恢复回去。

## 动手练习

**练习 1:事务期间,另一个连接能看到什么?** 用同一个磁盘上的库文件开两个连接(一个写、一个读)。写的那个手动 `BEGIN`,插入一行,在提交之前让读的连接去数行数;提交之后再数一次;再让写的那个删光所有运行但不提交,看读的连接数到几条。

<details><summary>参考答案</summary>

```python
# agent-loupe/server/scratch/ex659_isolation.py
import tempfile
from pathlib import Path

from loupe import db
from loupe.importers import import_any

SAMPLES = Path(__file__).parents[2] / "samples"
trace = import_any((SAMPLES / "synthetic_small.jsonl").read_text(encoding="utf-8"))[0]
path = Path(tempfile.mkdtemp()) / "iso.db"
writer, reader = db.connect(path), db.connect(path)

writer.execute("BEGIN")
writer.execute("INSERT INTO runs (id, name, started_at, ended_at, status) VALUES ('x', 'x', 'a', 'b', 'ok')")
print("写入方自己看:", writer.execute("SELECT COUNT(*) FROM runs").fetchone()[0], "条")
print("另一个连接看:", reader.execute("SELECT COUNT(*) FROM runs").fetchone()[0], "条(事务还没提交)")
writer.commit()
print("提交以后另一个连接看:", reader.execute("SELECT COUNT(*) FROM runs").fetchone()[0], "条")

db.save_trace(writer, trace)
writer.execute("BEGIN")
writer.execute("DELETE FROM runs")
print("删到一半(没提交),另一个连接看:", reader.execute("SELECT COUNT(*) FROM runs").fetchone()[0], "条")
writer.rollback()
```

<div class="line-notes">

- `path = Path(tempfile.mkdtemp()) / "iso.db"` 要用磁盘文件,不能用 `:memory:`:每个 `:memory:` 连接各是一个独立的库,两个连接根本看不到同一份数据。`tempfile.mkdtemp()` 在系统临时目录建一个新目录。
- `writer, reader = db.connect(path), db.connect(path)` 同一个文件开两个连接。`connect` 里的 `PRAGMA journal_mode = WAL` 让读和写能同时进行。
- `writer.execute("BEGIN")` 手动开始事务。
- `writer.execute("INSERT INTO runs` 时间随便写 `'a'`、`'b'`,演示不要求格式正确。
- `reader.execute("SELECT COUNT(*) FROM runs")` 读的连接数一下:0 条。事务隔离:未提交的修改别的连接看不见。
- `writer.commit()` 提交以后,读的连接再数就是 1 条。
- `db.save_trace(writer, trace)` 再导入 30 步的合成数据,现在库里有 2 条运行。
- `writer.execute("DELETE FROM runs")` 在新事务里删光,但不提交。
- `writer.rollback()` 最后回滚,删除作废。

</div>

```text
写入方自己看: 1 条
另一个连接看: 0 条(事务还没提交)
提交以后另一个连接看: 1 条
删到一半(没提交),另一个连接看: 2 条
```

写入方自己能看到自己没提交的修改,别的连接看不到。「删到一半」那一行读到 2 条,也就是删除之前的状态,读的连接看到的永远是已提交的版本。WAL 模式下读和写不互相阻塞,这就是 Day 658 打开它的好处:导入一万步的 1 秒里,别人刷新列表看到的要么是导入前、要么是导入后,不会是中间。下一课你会看到,同一个连接被多个线程共用时,这个保证会被破坏,所以那里要多想一步。

</details>

**练习 2:搜索词里有 `%` 和 `_`。** `list_runs(q="100%")` 会怎样?`q="a_b"` 呢?在库里放四条运行,名字是 `cost 100% check`、`cost 100 check`、`a_b`、`axb`,试一试,然后用 SQLite 的 `ESCAPE` 子句修好。

<details><summary>参考答案</summary>

```python
# agent-loupe/server/scratch/ex659_like.py
from datetime import UTC, datetime

from loupe import db

conn = db.connect(":memory:")
t = db.ts(datetime(2026, 10, 27, tzinfo=UTC))
for rid, name in [("1", "cost 100% check"), ("2", "cost 100 check"), ("3", "a_b"), ("4", "axb")]:
    conn.execute("INSERT INTO runs (id, name, started_at, ended_at, status) VALUES (?, ?, ?, ?, 'ok')", (rid, name, t, t))
conn.commit()
names = lambda q: sorted(r["name"] for r in db.list_runs(conn, q=q)["items"])  # noqa: E731
print("搜 '100%':", names("100%"))
print("搜 'a_b':", names("a_b"))


def escape_like(s: str) -> str:
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


rows = conn.execute("SELECT name FROM runs WHERE name LIKE ? ESCAPE '\\' ORDER BY name", (f"%{escape_like('100%')}%",)).fetchall()
print("转义以后搜 '100%':", [r[0] for r in rows])
rows = conn.execute("SELECT name FROM runs WHERE name LIKE ? ESCAPE '\\' ORDER BY name", (f"%{escape_like('a_b')}%",)).fetchall()
print("转义以后搜 'a_b':", [r[0] for r in rows])
```

<div class="line-notes">

- `for rid, name in [("1", "cost 100% check")` 四条运行,名字里特意放了 `%` 和 `_`,还放了对照用的 `cost 100 check` 和 `axb`。
- `names = lambda q: sorted(` 用 `list_runs` 搜一个词,返回命中的名字(排序后好比较)。
- `names("100%")` 搜 `100%`。`list_runs` 里拼成 `%100%%`,最后那个 `%` 是通配符,「100 后面跟任意字符」,所以 `cost 100 check` 也被搜出来,而用户想找的是字面意思的 `100%`。
- `names("a_b")` `_` 在 LIKE 里是「任意一个字符」,所以 `axb` 也命中。
- `s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")` 在 `%`、`_` 前面加一个反斜杠 `\`,表示「就是这个字符本身」。**必须先转义反斜杠自己**,再转义另外两个,否则顺序反了会重复转义。
- `LIKE ? ESCAPE '\\'` 告诉 SQLite 反斜杠是转义字符。Python 字符串里的 `'\\'` 在 SQL 里变成 `'\'`。搜索词先过 `escape_like` 转义,再前后各加一个真正的通配符 `%`,即 `f"%{escape_like('100%')}%"`。

</div>

```text
搜 '100%': ['cost 100 check', 'cost 100% check']
搜 'a_b': ['a_b', 'axb']
转义以后搜 '100%': ['cost 100% check']
转义以后搜 'a_b': ['a_b']
```

没转义时多搜出了 `cost 100 check` 和 `axb`。这不是安全问题(值走的占位符,没有注入),是正确性问题:用户搜什么就应该找什么。要把转义放进 `list_runs`,只要在 `where.append("name LIKE ? ESCAPE '\\'")` 里加上 `ESCAPE`,并把 `args.append(...)` 里的搜索词先过 `escape_like`。我这里没有放进 `db.py`,因为单人的调试工具里搜索词带 `%` 的情况很少,记进已知限制;你可以自己决定。

</details>

**练习 3:能不能用 `INSERT OR REPLACE` 代替先 DELETE 再 INSERT?** 试一试:库里有一条 `r1`,带 5 个旧步骤;用 `INSERT OR REPLACE INTO runs` 写入新版本的 `r1`(新版本声明只有 2 步)。外键开着和关着各试一次,看旧步骤还剩几行。然后说说你会不会这样改。

<details><summary>参考答案</summary>

```python
# agent-loupe/server/scratch/ex659_replace.py
from datetime import UTC, datetime

from loupe import db

t = db.ts(datetime(2026, 10, 27, tzinfo=UTC))
for fk in ("ON", "OFF"):
    conn = db.connect(":memory:")
    conn.execute(f"PRAGMA foreign_keys = {fk}")
    conn.execute("INSERT INTO runs (id, name, started_at, ended_at, status, step_count) VALUES ('r1', 'v1', ?, ?, 'ok', 5)", (t, t))
    for i in range(5):
        conn.execute("INSERT INTO steps (run_id, idx, kind, name, started_at, ended_at) VALUES ('r1', ?, 'tool', 'old', ?, ?)", (i, t, t))
    conn.commit()
    conn.execute("INSERT OR REPLACE INTO runs (id, name, started_at, ended_at, status, step_count) VALUES ('r1', 'v2', ?, ?, 'ok', 2)", (t, t))
    conn.commit()
    left = conn.execute("SELECT COUNT(*) FROM steps WHERE run_id = 'r1'").fetchone()[0]
    print(f"foreign_keys={fk:3s} REPLACE 之后旧 steps 还剩 {left} 行;run 现在是 {conn.execute('SELECT name FROM runs').fetchone()[0]}")
```

<div class="line-notes">

- `for fk in ("ON", "OFF"):` 各跑一轮,每轮新建一个内存库。
- `conn.execute(f"PRAGMA foreign_keys = {fk}")` `db.connect` 里已经设成了 ON,这里在它之后覆盖成 ON 或 OFF。
- `INSERT INTO runs (id, name, started_at, ended_at, status, step_count) VALUES ('r1', 'v1'` 旧版本,声明 5 步。
- `for i in range(5):` 真的插 5 个步骤,名字都叫 `old`。
- `INSERT OR REPLACE INTO runs` 新版本(`'v2'`,声明 2 步),冲突时的处理方式是 `REPLACE`:主键冲突就把旧行删掉,再插新行。
- `left = conn.execute("SELECT COUNT(*) FROM steps WHERE run_id = 'r1'")` 数旧步骤还剩几行。

</div>

```text
foreign_keys=ON  REPLACE 之后旧 steps 还剩 0 行;run 现在是 v2
foreign_keys=OFF REPLACE 之后旧 steps 还剩 5 行;run 现在是 v2
```

外键开着时,`REPLACE` 删旧行也会触发级联,旧步骤被清掉,效果和先 DELETE 再 INSERT 一样;外键关着时旧步骤原样留下,新版本只有 2 步,库里却有 5 步,而且之后插入新步骤时 `(run_id, idx)` 还会撞主键。所以两种写法在外键开着时等价,但 `REPLACE` 的行为依赖那个 PRAGMA,读代码的人也不容易一眼看出它会「顺便」删掉子表的行。我不改:显式的 `DELETE` 让「覆盖会清掉旧步骤」写在眼前。另一个不用 `REPLACE` 的理由是,它会对**任何**唯一约束冲突都静默替换,以后表里加了别的唯一索引,可能误删不该删的行。

</details>

**验收标准**:`uv run pytest -q` 全部通过;`s28_half.py` 能复现半截数据,`s29_atomic.py` 的失败之后是 0 条运行;`s30_offset.py` 里 OFFSET 重复了 R5、游标没有;改坏代码的五种变异你至少亲自试了两种;三个练习各有输出。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 事务(transaction) | 一组数据库操作,要么全部生效,要么全部不生效 |
| 提交(commit) | 让事务里的修改正式生效,别的连接从此能看到 |
| 回滚(rollback) | 撤销事务里所有未提交的修改,库回到事务开始之前 |
| 原子性 | 事务的「全有或全无」性质,ACID 里的 A |
| 覆盖语义 | 重复导入同一个 id 时,用新的整个替换旧的,而不是报错或叠加 |
| OFFSET 分页 | `LIMIT n OFFSET m`,跳过 m 行再取 n 行。深页慢,翻页途中数据变动会重复或遗漏 |
| 游标分页(keyset pagination) | 用上一页最后一条的排序键作为下一页的起点 |
| 行值比较 | `(a, b) < (x, y)`,按字典序比较多列,等价于 `a < x OR (a = x AND b < y)` |
| 不透明游标 | 前端只管原样传回、不去解读的字符串,后端想怎么编码都行 |
| base64 | 把任意字节变成只含字母数字和少数符号的文本,不是加密 |
| 上下文管理器 | 支持 `with` 的对象,进入和离开块时自动执行动作,≈ JS 的 `try/finally` 封装 |
| 事务隔离 | 事务没提交时,别的连接看不到它的修改 |
| 级联删除 | 删父行时自动删引用它的子行,今天靠它在覆盖时清掉旧步骤 |

## 常见误区

**以为出错时 Python 会自动回滚。** 它不会。不用 `with conn:` 的话,出错之后事务敞着,下一个 `commit()` 会把半截数据一起提交。今天的第一个实验就是这个。

**导入先判断「存不存在」再决定插入还是更新。** 判断和写入之间别人可能插进一条,要自己处理竞争。把 `DELETE` 和 `INSERT` 放在同一个事务里更简单,也不会留下中间状态。

**以为 `with conn:` 会关闭连接。** 不会,它只管事务。连接要自己 `conn.close()`。

**游标里只放时间。** 时间相同的运行会被整批跳过,而且没有任何报错。要加一个唯一的第二排序键,并且游标条件和 `ORDER BY` 的顺序一致。

**游标条件和 `ORDER BY` 方向不一致。** `ORDER BY ... DESC` 配 `<`;如果排序是升序,就要配 `>`。写反了,翻到第二页是空的,或者第一页又来一遍。

**把 base64 游标当成保密手段。** 解码只要一行代码。别放敏感信息,别靠它防止用户翻到不该看的页,那要靠权限。

**拼 SQL 字符串。** `list_runs` 里条件是拼的,值永远走 `?`。把 `q` 直接 f-string 进 SQL 就是注入,[Day 92](/blog/agent-zero/day-092-python-sqlite-1/) 演示过。

**过滤条件变了还带着旧游标。** 游标是在某一组过滤条件下的位置,条件一变,必须从头开始。这条是前端的责任,明天的接口说明里要写。

## 学习资料

### 文档与文章

- [SQLite:Transaction](https://www.sqlite.org/lang_transaction.html):`BEGIN`、`COMMIT`、`ROLLBACK` 的官方说明,读开头两节,15 分钟。
- [SQLite:Atomic Commit In SQLite](https://www.sqlite.org/atomiccommit.html):SQLite 怎么在断电时也保证事务的原子性,偏底层,感兴趣再看,今天看第 1 节引言就够了,20 分钟。
- [Python 文档:sqlite3 事务控制](https://docs.python.org/3/library/sqlite3.html#sqlite3-controlling-transactions):Python 在什么时候替你 `BEGIN`、`with conn` 怎么提交和回滚。注意 Python 3.12 新增了 `autocommit` 属性,默认行为没变,我们用的是旧的默认行为,15 分钟。
- [SQLite:Row Values](https://www.sqlite.org/rowvalue.html):行值比较的官方说明,里面正好有一个用它做分页的例子,10 分钟。
- [Use The Index, Luke:No Offset](https://use-the-index-luke.com/no-offset):Markus Winand 讲为什么不该用 OFFSET 分页、keyset 分页怎么写,数据库无关,20 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1JG4y1Q7BX&autoplay=0&high_quality=1" title="5分钟精通数据库事务-ACID和三大问题" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>猿人林克 · 5分钟精通数据库事务-ACID和三大问题 · 约 7 分钟,播放 5 万,2023 年发布。ACID 四个字和并发时的脏读等问题,对应「一个事务,加上覆盖」和「事务期间别人能看到什么」。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1iu4y1a7Bp&autoplay=0&high_quality=1" title="MySQL中的分页方法:偏移量 vs. 游标分页" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>沃趣Squids数据库平台 · MySQL中的分页方法:偏移量 vs. 游标分页 · 约 13 分钟,用 MySQL 演示,原理和 SQLite 完全一样,对应今天的分页部分。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/zwDIN04lIpc" title="Pagination in MySQL - offset vs. cursor" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>PlanetScale · Pagination in MySQL - offset vs. cursor · 约 13 分钟。核对过标题和作者,我没有完整看过它里面是否讲了「为什么要第二排序键」,以文章为准。</figcaption>
</figure>

### 书籍

- **Designing Data-Intensive Applications**,Martin Kleppmann 和 Chris Riccomini,O'Reilly,第二版 2026 年出版。讲事务的那一章把 ACID 四个字背后的实际含义、隔离级别和常见异常讲得最透,约 2 小时。章节编号两版不一定一致,以目录为准。
- **SQL Performance Explained**,Markus Winand,2012。讲分页(取部分结果)那一章,约 30 分钟,在线版是上面那个 Use The Index, Luke。

### 开源项目与代码

- [langfuse/langfuse](https://github.com/langfuse/langfuse):看它的公开 API 文档里列表接口的分页怎么设计(我没有核对它用的是页码还是游标,点进去自己看),和我们的选择对照。

## 自测

1. 昨天的 `save_trace` 在第 5000 步出错后,为什么库里会留下半截数据?仅仅「出错」就会留下吗?

<details><summary>答案</summary>

出错本身只会让那个事务敞着:已经执行过的 INSERT 在连接里是未提交状态。留下半截数据是因为**之后有人调用了 `commit()`**(比如下一次正常的导入),它把整个连接上所有未提交的修改一起提交。Python 的 sqlite3 在出错时不会自动回滚,所以要用 `with conn:` 或自己 `try/except` 里调 `rollback()`。

</details>

2. 覆盖导入时为什么先 `DELETE` 再 `INSERT`,而且必须在同一个事务里?

<details><summary>答案</summary>

先删旧的,再插新的,这样新旧版本不会混在一起,级联删除也顺便清掉旧的 steps 和标签。放在同一个事务里,是为了新版本写失败时,DELETE 也一并回滚,旧版本原样保留。如果分成两个事务,DELETE 提交了而 INSERT 失败,用户的数据就丢了。

</details>

3. `LIMIT/OFFSET` 分页在翻页途中有新数据插入时会发生什么?游标分页为什么不受影响?

<details><summary>答案</summary>

OFFSET 是「跳过前 m 行」,新数据插在前面,所有行往后挪一位,第二页的开头就是第一页的最后一条,于是重复;删除数据时则会漏掉一条。游标分页的条件是「排序键小于上一页最后一条的排序键」,不依赖行的位置,前面插入或删除多少行,后面接着取的内容不变。

</details>

4. 游标里为什么要同时放 `started_at` 和 `id`?只放 `started_at` 会漏什么?

<details><summary>答案</summary>

开始时间可能相同(批量导入、合成数据)。只放时间,条件 `started_at < X` 会把和上一页最后一条同一时刻的其他行全部跳过,实验里五条时间相同的运行翻到第二页是空的。`id` 是唯一的,做第二排序键以后排序是严格全序,`(started_at, id) < (?, ?)` 不重不漏。

</details>

5. `list_runs` 为什么多取一条(`limit + 1`),而不是另外 `SELECT COUNT(*)`?

<details><summary>答案</summary>

多取一条只需要一次查询:取到了 limit+1 条说明还有下一页,第 limit 条做游标;不够 limit+1 条就是最后一页。COUNT 要另外跑一次,过滤条件下还要扫一遍匹配的行,更慢,而且在翻页途中数据变化时,COUNT 的结果也可能和实际翻出来的不一致。

</details>

6. 面试题:运行列表要支持「按成本从高到低排序」并且分页,你的游标怎么设计?有什么新问题?

<details><summary>答案</summary>

排序键变成 `(total_cost_usd, id)`,游标里放这两个值,条件是 `(total_cost_usd, id) < (?, ?)`,同样需要唯一的 id 做第二键,保证全序。要为它建索引 `(total_cost_usd DESC, id DESC)`,否则要全表排序。新问题:一是成本是浮点数,编码进游标要用精确的字符串形式,避免精度丢失后比较出错;二是每增加一种排序方式就要多一个索引,写入变慢、占空间,要看用户是否真的需要;三是游标要带上排序方式,换排序要丢掉旧游标,最好在游标里编码排序字段,服务端校验和当前请求一致。

</details>

## 明天预告

明天(Day 660)是 Loupe(八):**分段加载、轻步骤、价格表、接口和多线程连接**。今天的 `list_runs` 和 `get_run` 已经能回答两个接口,明天把剩下的补齐:步骤的分段读取,为什么默认只返回「轻」步骤(不带大字段的 input 和 output),点开某一步再单独取完整内容;按价格表给没有成本的模型调用补上成本,并写明价格从哪天查的;然后把它们接成 FastAPI 接口,用 `curl` 走一遍,再回答 `check_same_thread=False` 到底安不安全。
