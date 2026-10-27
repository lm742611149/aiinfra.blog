---
title: 'Day 658 · Loupe(六):先定接口再定表,表设计'
description: '数据入口做完了,今天让数据落地。先列出前端要的六个接口,再从每个接口的查询倒推出 runs、steps、run_tags 三张 SQLite 表;用 EXPLAIN QUERY PLAN 亲眼看索引有没有被用上,试着往库里写真实样例和一万步的合成数据,并留下两处下一课要解决的问题。'
pubDate: 2026-10-27
regime: none
tags: ['agent-loupe', 'sqlite', 'schema', 'index', 'agent-zero']
series: 'agent-zero'
day: 658
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 657](/blog/agent-zero/day-657-week94-review/) 把 Day 651 到 656 的数据入口整条复习了一遍:PRD、`Run` 和 `Step` 两个模型、OTLP 和 Langfuse 和自研 SDK 三个导入器、`import_any` 统一入口、造假数据,还写了 `loupe/check.py` 给 trace 做体检。到这里 Loupe 能把任何一种来源的文件变成统一的 `Trace` 对象。

可它们只活在内存里,服务一重启就没了,前端也没法按需取一部分。今天开始存下来。这一课只做一件事:定表。先问前端要哪些接口,再倒推表怎么建、索引建哪些,最后用真实样例和一万步的假数据试写一遍。事务、分页、接口本身放到明天和后天。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说出 Loupe 后端的六个接口,并且对每一个接口写出它背后那条 SQL 的大致样子。
2. 写出 `loupe/db.py` 里的三张表(`runs`、`steps`、`run_tags`)和 `runs_by_time` 索引,能解释每个冗余字段和每个索引是给哪个查询用的。
3. 用 `EXPLAIN QUERY PLAN` 看一条查询有没有走索引,并能读懂 `SCAN`、`SEARCH`、`USE TEMP B-TREE` 三种输出。
4. 把真实样例和一万步的合成数据写进库里,知道写入时撞到主键冲突是怎么回事。

预计用时 3 小时。今天不调模型,花费 0。

前置:[Day 652](/blog/agent-zero/day-652-loupe-model/)(`Run`、`Step`、`UtcDatetime`)、[Day 656](/blog/agent-zero/day-656-loupe-detect/)(`import_any`、`samples/synthetic_10k.jsonl`);SQL 基础用到 [Day 85](/blog/agent-zero/day-085-sql-1/) 到 [Day 93](/blog/agent-zero/day-093-python-sqlite-2/) 的内容,尤其是 [Day 89](/blog/agent-zero/day-089-sql-5/) 的索引和 EXPLAIN、[Day 91](/blog/agent-zero/day-091-sql-6/) 的主键外键约束。这几天忘了的话先翻一下,今天不重讲 SQL 语法。

学法提示:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把三张表的建表语句和 `connect` 默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先定接口,再定表

前端同学做数据库设计,最容易走的路是「先看数据长什么样,照着建表」。数据已经有现成的 `Run` 和 `Step`,照着建两张表,十分钟的事。可这样建出来的表,常常到了写查询才发现不合用:列表页要显示每条运行有几步,得对 steps 表做一次 `COUNT`;要按标签筛选,标签存在一个 JSON 文本里,得扫全表。

我们反过来做。后端的用户是前端,前端要什么,表就长成什么样。Loupe 的前端要这几件事,每件事对应一个接口:

| 接口 | 前端拿它做什么 | 背后的查询 |
| --- | --- | --- |
| `GET /api/health` | 开发时确认后端活着 | 不碰库 |
| `POST /api/import` | 上传一个 trace 文件 | 写:一条运行加它的所有步骤 |
| `GET /api/runs?tag=&status=&q=&cursor=` | 运行列表,最新的在最前面,一次一页 | 按时间倒序取一页,可带标签、状态、名字过滤 |
| `GET /api/runs/{id}` | 一条运行的汇总:总 token、总成本、状态 | 按主键取一行 |
| `GET /api/runs/{id}/steps?from=&limit=&full=` | 时间轴要画的步骤,分段取 | 一条运行里,从第 N 步起取 limit 步 |
| `GET /api/runs/{id}/steps/{idx}` | 点开某一步,看它完整的输入输出 | 按 `(run_id, idx)` 取一行 |

Day 651 的 PRD 里的用户故事是这些接口的来源,今天不重复。`health` 在 [Day 651](/blog/agent-zero/day-651-loupe-prd/) 就有了,所以真正要存的数据只有 runs 和 steps,真正要快的查询只有读的那四个。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="接口到表的对应:列表接口读 runs 和 run_tags,步骤接口读 steps,导入接口写三张表">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
  <text x="110" y="28" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">接口</text>
  <text x="500" y="28" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">表</text>
  <rect x="20" y="42" width="180" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="110" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">GET /api/runs</text>
  <rect x="20" y="86" width="180" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="110" y="106" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">GET /api/runs/{id}</text>
  <rect x="20" y="130" width="180" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="110" y="150" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">GET .../steps?from=</text>
  <rect x="20" y="174" width="180" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="110" y="194" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">GET .../steps/{idx}</text>
  <rect x="20" y="236" width="180" height="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="110" y="256" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">POST /api/import</text>
  <rect x="400" y="42" width="200" height="50" fill="none" stroke="var(--rule)"/>
  <text x="500" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">runs</text>
  <text x="500" y="80" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">主键 id · 索引 (started_at, id)</text>
  <rect x="400" y="108" width="200" height="50" fill="none" stroke="var(--rule)"/>
  <text x="500" y="128" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">run_tags</text>
  <text x="500" y="146" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">主键 (tag, run_id)</text>
  <rect x="400" y="174" width="200" height="50" fill="none" stroke="var(--rule)"/>
  <text x="500" y="194" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">steps</text>
  <text x="500" y="212" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">主键 (run_id, idx)</text>
  <line x1="200" y1="57" x2="400" y2="67" stroke="var(--mem)"/>
  <line x1="200" y1="57" x2="400" y2="133" stroke="var(--mem)"/>
  <line x1="200" y1="101" x2="400" y2="75" stroke="var(--mem)"/>
  <line x1="200" y1="145" x2="400" y2="195" stroke="var(--mem)"/>
  <line x1="200" y1="189" x2="400" y2="205" stroke="var(--mem)"/>
  <line x1="200" y1="251" x2="400" y2="82" stroke="var(--compute)"/>
  <line x1="200" y1="251" x2="400" y2="148" stroke="var(--compute)"/>
  <line x1="200" y1="251" x2="400" y2="214" stroke="var(--compute)"/>
  <text x="500" y="262" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">蓝线读,琥珀线写</text>
</svg>
<figcaption>五个要用库的接口各自碰哪几张表。读的都只碰一两张,写的一次碰三张,所以导入必须放进一个事务(明天讲)。</figcaption>
</figure>

先把一个看似合理的偷懒做法跑一遍,看看它哪里不行。最省事的存法是一张表,`id` 加一个 `doc` 列,把整条 `Trace` 序列化成 JSON 塞进去。写入最简单,读回来也最简单。列表页要显示每条运行的名字和状态,用 SQLite 的 `json_extract` 从 JSON 里取:

```python
# agent-loupe/server/scratch/s22_blob.py
"""笨办法:一整条 Trace 当一个 JSON 存进一张表,看看列表页要付什么代价。"""
import sqlite3
import time
from pathlib import Path

from loupe.importers import import_any

SAMPLES = Path(__file__).parents[2] / "samples"
trace = import_any((SAMPLES / "synthetic_10k.jsonl").read_text(encoding="utf-8"))[0]
doc = trace.model_dump_json()
print(f"一条 1 万步的 trace 存成 JSON:{len(doc) / 1e6:.1f} MB")

conn = sqlite3.connect(":memory:")
conn.execute("CREATE TABLE traces (id TEXT PRIMARY KEY, doc TEXT)")
conn.executemany("INSERT INTO traces VALUES (?, ?)", [(f"r{i}", doc) for i in range(20)])

t0 = time.perf_counter()
rows = conn.execute("SELECT id, json_extract(doc, '$.run.name'), json_extract(doc, '$.run.status') FROM traces").fetchall()
dt = time.perf_counter() - t0
print(f"列表页:{len(rows)} 条运行,每条只要 name 和 status,耗时 {dt:.3f} 秒")
```

<div class="line-notes">

- `trace = import_any(` 用 [Day 656](/blog/agent-zero/day-656-loupe-detect/) 的统一入口读那份一万步合成数据。`[0]` 取第一条运行,文件里只有一条,所以这就是 `syn10000`。
- `doc = trace.model_dump_json()` pydantic 把整条 `Trace` 变成一个 JSON 字符串,≈ JS 的 `JSON.stringify(trace)`。我这里算出来 17.1 MB。
- `conn = sqlite3.connect(":memory:")` 一个只存在内存里的临时库,脚本结束就没了,适合做实验。
- `CREATE TABLE traces (id TEXT PRIMARY KEY, doc TEXT)` 两列:主键和一大坨 JSON。
- `[(f"r{i}", doc) for i in range(20)]` 同一份文档存 20 份,模拟库里有 20 条一万步的运行。内存里一共约 340 MB。
- `json_extract(doc, '$.run.name')` SQLite 自带的 JSON 函数,按路径从文本里取一个字段,`$.run.name` 相当于 JS 里的 `doc.run.name`。
- `dt = time.perf_counter() - t0` 只计时那一条 SELECT。我这次测出 0.218 秒。

</div>

输出:

```text
一条 1 万步的 trace 存成 JSON:17.1 MB
列表页:20 条运行,每条只要 name 和 status,耗时 0.218 秒
```

20 条运行 0.22 秒,平均每条 11 毫秒,而且这 11 毫秒是为了读两个短字符串,把 17 MB 的文本整个翻了一遍。我没有再往上测,但线性外推,一页 50 条就是半秒多,库里运行越多越慢,而列表页是用户每次打开都要看的第一屏。再加上「按标签筛选」「按 token 数排序」这些要求,整表扫描没有出路。结论:**列表要用的字段必须是真正的列**,而且步骤必须一步一行,这样才能只取一部分。

## 三张表

下面是 `loupe/db.py` 的第一部分,也是今天最重要的一段。`SCHEMA` 是一个多行字符串,里面全是 SQL,≈ 前端写在 `.sql` 文件里的迁移脚本。

```python
# agent-loupe/server/loupe/db.py(Day 658 版:只有表和最朴素的写入)
import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from loupe.models import Trace

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
    model TEXT,
    total_input_tokens INTEGER NOT NULL DEFAULT 0,
    total_output_tokens INTEGER NOT NULL DEFAULT 0,
    total_cost_usd REAL NOT NULL DEFAULT 0,
    tags TEXT NOT NULL DEFAULT '[]',
    parent_run_id TEXT,
    forked_from_step INTEGER,
    step_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS runs_by_time ON runs (started_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS run_tags (
    run_id TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (tag, run_id)
);

CREATE TABLE IF NOT EXISTS steps (
    run_id TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    parent_idx INTEGER,
    kind TEXT NOT NULL CHECK (kind IN ('llm', 'tool', 'agent', 'retrieval', 'other')),
    name TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    input TEXT,
    output TEXT,
    error TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost_usd REAL,
    model TEXT,
    PRIMARY KEY (run_id, idx)
);
"""
```

<div class="line-notes">

- `from loupe.models import Trace` 写入函数的入参类型,来自 [Day 652](/blog/agent-zero/day-652-loupe-model/)。
- `CREATE TABLE IF NOT EXISTS runs (` 「不存在才建」,所以每次启动服务都可以跑一遍,第二次什么也不做,不会报「表已存在」。
- `id TEXT PRIMARY KEY,` 运行的 ID 是文本,因为它来自 trace 本身:OTLP 的 traceId 是 32 位十六进制,SDK 生成的是 12 位。主键保证同一个 ID 在表里只能有一行,明天的「覆盖」就靠它。
- `started_at TEXT NOT NULL,` SQLite 没有专门的时间类型,时间存成文本。下一节讲为什么这样存、怎么存才不出错。
- `status TEXT NOT NULL CHECK (status IN ('ok', 'error')),` `CHECK` 是约束:写进来的值不在这两个里面,数据库当场拒绝。它和 `Run.status` 的 `Literal["ok", "error"]` 是同一条规则,在数据库这一层再守一次。
- `total_cost_usd REAL NOT NULL DEFAULT 0,` `REAL` 是浮点数。钱用浮点有精度问题,但这里只是估算(价格表按「偏贵」的口径),不是账单;[Day 680](/blog/agent-zero/day-680-bs-engine-1/) 做计费的作品时再认真处理。
- `tags TEXT NOT NULL DEFAULT '[]',` 标签以 JSON 文本的形式原样存一份,返回给前端的时候不用再拼。
- `parent_run_id TEXT,` 这两列今天没人用,是给 Day 669 的「从某一步重跑」留的:重跑产生的新运行记着它从哪条运行的第几步分出来。现在就建好,省得以后改表。
- `step_count INTEGER NOT NULL DEFAULT 0` 步数,是冗余字段,下一节专门讲。
- `CREATE INDEX IF NOT EXISTS runs_by_time ON runs (started_at DESC, id DESC);` 给「运行列表」用的索引:先按开始时间倒序,时间相同的再按 id 倒序。和列表查询的 `ORDER BY` 一模一样。
- `CREATE TABLE IF NOT EXISTS run_tags (` 标签单独一张表,一行一个(运行,标签)对,专门给「按标签筛选」用。
- `run_id TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,` 外键:`run_id` 必须是 runs 表里存在的 id;`ON DELETE CASCADE` 的意思是删掉那条运行时,这里引用它的行一起删掉。
- `PRIMARY KEY (tag, run_id)` 联合主键,**标签在前**。按标签查(`WHERE tag = ?`)正好走主键的最左列。反过来写成 `(run_id, tag)` 的话,按标签查就用不上它了。
- `CREATE TABLE IF NOT EXISTS steps (` 步骤表,一步一行。
- `idx INTEGER NOT NULL,` 步骤在这条运行里的序号,Day 652 约定过:导入后从 0 连续编号。
- `kind TEXT NOT NULL CHECK (kind IN ('llm', 'tool', 'agent', 'retrieval', 'other')),` 和 `StepKind` 里的五种一模一样。
- `input TEXT,` 和下一行 `output TEXT,` 存任意 JSON,所以是文本。我们不会按里面的内容查询。
- `PRIMARY KEY (run_id, idx)` 联合主键,取步骤的两个查询(一段、单步)都是「先定 run_id,再按 idx」,这个主键本身就是它们要的索引。

</div>

这三张表背后有五个决定,每一个都可以被反驳,我把理由写出来,你对照自己的判断。

**steps 为什么不拆成 llm_steps、tool_steps 两张表?** 不同 `kind` 的步骤字段确实不一样,llm 步有 `model` 和 token,tool 步没有。拆开的好处是每张表没有空列,坏处是时间轴要把几张表按时间合在一起,要 `UNION`,分段取(第 500 步到第 1000 步)几乎写不出来。Loupe 的核心画面就是一条按顺序排的时间轴,所以一张表,不适用的列留 `NULL`。

**`step_count` 是冗余字段。** 它完全可以用 `SELECT COUNT(*) FROM steps WHERE run_id = ?` 算出来,存一份是多余的。我还是存了,因为列表页每一行都要显示步数,一页 50 行就是 50 次 COUNT;接口里判断「还有没有下一段步骤」也要它。数据导入之后就不会再变,冗余存一份没有「两边不一致」的风险。**前提是导入是原子的**,不然 `step_count` 说 10000 而 steps 里只有 5000 行,就是一个很难查的 bug。这正是明天要讲事务的原因,练习 3 也会写一个检查函数来抓这种不一致。

**标签存了两份。** `runs.tags` 是 JSON 文本,`run_tags` 是一行一个。看上去重复,各有各的用:前者原样返回给前端,后者给筛选用。这里我要老实说一个实测结果,是我写练习 2 时才发现的,和我原来的直觉不一样。**用 `run_tags` 不一定比在 JSON 文本里 `LIKE` 快**。20 万条运行、每条两个标签、标签从 50 个里随机选的库里:

```text
tag7  LIKE 扫 tags 列:51 行,平均 0.5 毫秒
tag7  run_tags 子查询:51 行,平均 12.5 毫秒
rare  LIKE 扫 tags 列:3 行,平均 73.2 毫秒
rare  run_tags 子查询:3 行,平均 0.0 毫秒
```

`tag7` 是常见标签(约 4% 的运行有它),`rare` 只有 3 条运行有。`LIKE` 版本沿着时间索引从新往旧扫,常见标签扫几百行就凑够 51 条,很快;稀有标签它得把 20 万行扫完才知道只有 3 条,73 毫秒。`run_tags` 版本正好相反:先把带这个标签的所有运行找出来再排序,常见标签要找出约 8000 行,稀有标签几乎不用找。所以 `run_tags` 的好处是**最坏情况可控**,不是每种情况都快。我们的数据是用户自己导入的,一个标签可能是 `prod`(很常见)也可能是 `bug-1234`(稀有),谁也说不准,选最坏情况可控的那个。练习 2 带你自己跑这组数字。

**`input` 和 `output` 存 TEXT。** 它们是任意 JSON,而我们不按内容查。SQLite 有 JSON 函数,真要「找出所有调过 get_weather 的步骤」时可以现场 `json_extract`,但今天用不上。

**两个 PRAGMA,不是建表语句,却和表一样重要。** 它们在下面的 `connect` 里。

## 时间怎么存才排得对

SQLite 没有时间类型。官方文档的 [Date And Time Functions](https://www.sqlite.org/lang_datefunc.html) 写了三种常见存法:文本(ISO 8601 字符串)、数字(儒略日)、整数(Unix 时间戳)。我们选文本,因为人能直接看懂,调试时 `SELECT * FROM runs` 出来的就是 `2026-10-27T05:09:58.656190+00:00`。

选文本有一个前提:**文本的字典序必须等于时间先后**,不然 `ORDER BY started_at` 就排错了。下面这个脚本故意用四种写法的时间,看看排出什么:

```python
# agent-loupe/server/scratch/s26_time_sort.py
from datetime import datetime, timezone

from loupe import db

samples = ["2026-10-27T02:00:00Z", "2026-10-27T02:00:00.5Z", "2026-10-27T10:00:00+08:00", "2026-10-27T03:00:00+00:00"]
print("文本排序:", sorted(samples))
print("真实先后:", sorted(samples, key=lambda s: datetime.fromisoformat(s)))

d = [datetime(2026, 10, 27, 2, 0, 0, tzinfo=timezone.utc), datetime(2026, 10, 27, 2, 0, 0, 500000, tzinfo=timezone.utc)]
print("ts() 以后:", [db.ts(x) for x in d])
```

<div class="line-notes">

- `samples = [` 四个字符串,其实只有三个时刻:第一个和第三个都是 UTC 02:00:00(第三个是北京时间 10:00),第二个是 02:00:00.5,第四个是 03:00。写法各不相同:带不带小数、`Z` 还是 `+00:00`、带不带 `+08:00`。
- `sorted(samples)` 不带 key 的排序按字符串字典序,SQLite 对 TEXT 列排序也是这样。
- `key=lambda s: datetime.fromisoformat(s)` 先解析成真正的时间再比较,这才是对的先后。`fromisoformat` 在 Python 3.11 以后认得 `Z`。
- `[db.ts(x) for x in d]` 今天要写的 `ts()`,稍后看它的实现。

</div>

```text
文本排序: ['2026-10-27T02:00:00.5Z', '2026-10-27T02:00:00Z', '2026-10-27T03:00:00+00:00', '2026-10-27T10:00:00+08:00']
真实先后: ['2026-10-27T02:00:00Z', '2026-10-27T10:00:00+08:00', '2026-10-27T02:00:00.5Z', '2026-10-27T03:00:00+00:00']
ts() 以后: ['2026-10-27T02:00:00.000000+00:00', '2026-10-27T02:00:00.500000+00:00']
```

文本排序把 `02:00:00.5Z` 排在了 `02:00:00Z` 前面(字符 `.` 比 `Z` 小),把北京时间 10:00 排到了最后,其实它是 UTC 02:00,应该排在最前。两处都错了。

解法两条,今天都有。第一条在 [Day 652](/blog/agent-zero/day-652-loupe-model/):`UtcDatetime` 在模型层就把所有时间转成 UTC,所以进库的时间不会带 `+08:00`。第二条是今天写的 `ts()`:统一输出成 `isoformat(timespec="microseconds")`,不管有没有小数,都补成六位微秒,字符串**定宽**,同样的位置永远是同样的含义。最后一行输出就是它的样子。两条加起来,「字典序等于先后」才成立。

## `connect`、`ts` 和最朴素的写入

```python
def ts(d: datetime) -> str:
    """时间存成定宽文本:2026-10-27T02:00:00.000000+00:00,这样按文本排序就等于按时间排序。"""
    return d.astimezone(UTC).isoformat(timespec="microseconds")


def connect(path: str | Path = "loupe.db") -> sqlite3.Connection:
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.executescript(SCHEMA)
    return conn


def save_trace(conn: sqlite3.Connection, trace: Trace) -> None:
    """今天的朴素版:一条一条插。明天改成一个事务。"""
    r = trace.run
    conn.execute(
        "INSERT INTO runs (id, name, started_at, ended_at, status, model, total_input_tokens,"
        " total_output_tokens, total_cost_usd, tags, parent_run_id, forked_from_step, step_count)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (r.id, r.name, ts(r.started_at), ts(r.ended_at), r.status, r.model, r.total_input_tokens,
         r.total_output_tokens, r.total_cost_usd, json.dumps(r.tags, ensure_ascii=False),
         r.parent_run_id, r.forked_from_step, len(trace.steps)),
    )
    for tag in r.tags:
        conn.execute("INSERT INTO run_tags (run_id, tag) VALUES (?, ?)", (r.id, tag))
    for s in trace.steps:
        conn.execute(
            "INSERT INTO steps (run_id, idx, parent_idx, kind, name, started_at, ended_at, input,"
            " output, error, input_tokens, output_tokens, cost_usd, model)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (s.run_id, s.idx, s.parent_idx, s.kind, s.name, ts(s.started_at), ts(s.ended_at),
             json.dumps(s.input, ensure_ascii=False), json.dumps(s.output, ensure_ascii=False),
             s.error, s.input_tokens, s.output_tokens, s.cost_usd, s.model),
        )
    conn.commit()
```

<div class="line-notes">

- `return d.astimezone(UTC).isoformat(timespec="microseconds")` 先转成 UTC,再输出 ISO 文本,`timespec="microseconds"` 强制六位小数。代入 `02:00:00` 整点的时间,默认的 `isoformat()` 会省掉小数,这里补成 `.000000`。
- `conn = sqlite3.connect(path, check_same_thread=False)` 打开(没有就创建)一个库文件。`check_same_thread=False` 的含义和风险放到 Day 660 讲,先照抄。
- `conn.row_factory = sqlite3.Row` 查询结果每行变成可以按列名取值的对象,`row["name"]` 而不是 `row[1]`。[Day 93](/blog/agent-zero/day-093-python-sqlite-2/) 讲过。
- `conn.execute("PRAGMA foreign_keys = ON")` **每个连接都要开**。SQLite 默认不检查外键,不开的话 `ON DELETE CASCADE` 不会生效。下一节演示。
- `conn.execute("PRAGMA journal_mode = WAL")` 预写日志模式:读和写可以同时进行,导入大文件时列表页不会被卡住。WAL 是 write-ahead logging,代价是库文件旁边会多出 `-wal` 和 `-shm` 两个文件。
- `conn.executescript(SCHEMA)` 一次执行多条 SQL。因为全是 `IF NOT EXISTS`,重复调用安全。
- `r = trace.run` 少打几个字。
- `" VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"` 13 个问号对应上面 13 个列名。永远用 `?` 占位符传值,不拼字符串,[Day 92](/blog/agent-zero/day-092-python-sqlite-1/) 的注入演示还记得吧。列名写全而不是省略,以后加一列时旧代码不会悄悄错位。
- `ts(r.started_at), ts(r.ended_at)` 每个时间都过 `ts()`,绝不直接把 `datetime` 交给 sqlite3。
- `json.dumps(r.tags, ensure_ascii=False)` 标签列表转成 JSON 文本。`ensure_ascii=False` 让中文标签原样存,而不是 `天` 那种转义,调试时看得懂。
- `len(trace.steps)` 步数就是在这里冗余存进去的。
- `for tag in r.tags:` 每个标签一行写进 `run_tags`。
- `for s in trace.steps:` 每一步一行。`input` 和 `output` 过 `json.dumps` 变文本。
- `conn.commit()` 到这里才真正落盘。前面每一条 `INSERT` 都只是在一个还没提交的事务里。如果循环到一半抛了异常,`commit` 没执行,已经插进去的行会怎样?这个问题明天回答。

</div>

## 两个 PRAGMA 的坑,先演示一次

`foreign_keys` 不开会怎样,光说不如跑一遍。脚本建两个内存库,一个开外键、一个不开,各插一条运行加一步,再删掉运行:

```python
# agent-loupe/server/scratch/s23_fk.py
"""外键开关:不开 foreign_keys,删 run 以后 steps 里留下孤儿。"""
import sqlite3

from loupe import db

for on in (False, True):
    conn = sqlite3.connect(":memory:")
    conn.execute(f"PRAGMA foreign_keys = {'ON' if on else 'OFF'}")
    conn.executescript(db.SCHEMA)
    conn.execute("INSERT INTO runs (id, name, started_at, ended_at, status) VALUES ('r1', 'demo', 'a', 'b', 'ok')")
    conn.execute("INSERT INTO steps (run_id, idx, kind, name, started_at, ended_at)"
                 " VALUES ('r1', 0, 'agent', 'root', 'a', 'b')")
    conn.execute("DELETE FROM runs WHERE id = 'r1'")
    left = conn.execute("SELECT COUNT(*) FROM steps").fetchone()[0]
    print(f"foreign_keys={'ON ' if on else 'OFF'} 删掉 run 以后 steps 还剩 {left} 行")
```

<div class="line-notes">

- `for on in (False, True):` 循环两次,第一次不开外键,第二次开。每次都新建一个内存库,互不影响。
- `conn.execute(f"PRAGMA foreign_keys = {'ON' if on else 'OFF'}")` 注意:每个新连接默认都是 OFF,这里要显式写。第一轮写 OFF 是为了演示,生产代码里 `connect` 永远写 ON。
- `conn.executescript(db.SCHEMA)` 直接复用 `db.py` 里的建表语句,保证演示的就是真实的表。
- `INSERT INTO runs (id, name, started_at, ended_at, status) VALUES ('r1', 'demo', 'a', 'b', 'ok')` 为了演示,时间随便写 `'a'`、`'b'`:数据库只管它是不是文本,不管它像不像时间。这也说明了为什么时间格式要靠代码守,而不是靠表。
- `DELETE FROM runs WHERE id = 'r1'` 删掉运行。外键开着时,`CASCADE` 会把 `steps` 里 `run_id = 'r1'` 的行一起删掉。
- `left = conn.execute("SELECT COUNT(*) FROM steps").fetchone()[0]` 数 steps 里还剩几行。`fetchone()` 返回一行,`[0]` 取第一列。

</div>

```text
foreign_keys=OFF 删掉 run 以后 steps 还剩 1 行
foreign_keys=ON  删掉 run 以后 steps 还剩 0 行
```

不开的话,运行没了,步骤还在,成了没有主人的孤儿。以后「重新导入」会先删旧运行,孤儿步骤会越积越多,而且没有任何报错。所以这一行 `PRAGMA` 是表设计的一部分:少了它,外键只是写在建表语句里的一句注释。

## 索引:给每个查询找一个

[Day 89](/blog/agent-zero/day-089-sql-5/) 讲过 `EXPLAIN` 和索引为什么快,今天是第一次拿它做真正的设计决定。`EXPLAIN QUERY PLAN` 在查询前面加上这几个字,SQLite 不执行查询,只告诉你它打算怎么执行。输出里有三种东西要认:

- `SCAN 表名`:从头到尾扫整张表。表大了就慢。
- `SEARCH 表名 USING INDEX …`:通过索引直接定位。快。
- `USE TEMP B-TREE FOR ORDER BY`:没有现成的顺序可用,SQLite 要自己临时排一次序。数据多时又慢又占内存。

先用 20 万条运行验证列表查询需不需要 `runs_by_time`。脚本建一张没有索引的 runs 表,灌 20 万行随机时间的数据,跑列表的那条查询,再建索引再跑:

```python
# agent-loupe/server/scratch/s24_plan.py
"""没有索引和有索引,同一条列表查询怎么走、多快。"""
import random
import sqlite3
import time
from datetime import datetime, timedelta, timezone

from loupe import db

conn = sqlite3.connect(":memory:")
conn.executescript(db.SCHEMA.replace("CREATE INDEX IF NOT EXISTS runs_by_time ON runs (started_at DESC, id DESC);", ""))
rnd = random.Random(1)
t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
N = 200_000
rows = [(f"run{i:06d}", f"run-{i}", db.ts(t0 + timedelta(seconds=rnd.randint(0, 20_000_000))), "x", "ok") for i in range(N)]
conn.executemany("INSERT INTO runs (id, name, started_at, ended_at, status) VALUES (?, ?, ?, ?, ?)", rows)
conn.commit()

Q = "SELECT id, name, started_at FROM runs ORDER BY started_at DESC, id DESC LIMIT 50"


def run(label: str) -> None:
    plan = conn.execute("EXPLAIN QUERY PLAN " + Q).fetchall()
    t = time.perf_counter()
    for _ in range(20):
        conn.execute(Q).fetchall()
    ms = (time.perf_counter() - t) / 20 * 1000
    print(f"{label}:{[r[3] for r in plan]},平均 {ms:.2f} 毫秒")


print(f"{N} 条运行")
run("没有索引")
conn.execute("CREATE INDEX runs_by_time ON runs (started_at DESC, id DESC)")
run("有了索引")
```

<div class="line-notes">

- `db.SCHEMA.replace(` 把真实建表脚本里的那条索引语句替换成空,得到一份没有索引的表。这样演示的表结构和真实的完全一致,只差索引。
- `rnd = random.Random(1)` 固定种子的随机数,每次跑出同样的数据。
- `rnd.randint(0, 20_000_000)` 从 2026-01-01 起随机往后 0 到约 231 天的秒数。20 万行里肯定有时间相同的行,这很重要,稍后用得上。 每行的主键是 `run000000` 到 `run199999`(`:06d` 补零到六位),时间用的就是今天的 `ts()`,所以文本是定宽的。
- `conn.executemany(` 一次性插入 20 万行。比循环里 `execute` 快得多,明天会再用到。
- `Q = "SELECT id, name, started_at FROM runs` 这就是「运行列表第一页」背后的那条查询。
- `plan = conn.execute("EXPLAIN QUERY PLAN " + Q).fetchall()` 每行有四列,第四列(下标 3)是人读的描述。
- `for _ in range(20):` 同一条查询跑 20 次取平均,单次太快测不准。`_` 表示这个循环变量用不上。

</div>

```text
200000 条运行
没有索引:['SCAN runs', 'USE TEMP B-TREE FOR ORDER BY'],平均 17.81 毫秒
有了索引:['SCAN runs USING INDEX runs_by_time'],平均 0.05 毫秒
```

没有索引时它扫了 20 万行,还要临时排序,17.8 毫秒;有了索引,直接沿着索引走,凑够 50 行就停,0.05 毫秒,差了三百多倍。注意有索引那行写的是 `SCAN ... USING INDEX`,而不是 `SEARCH`。因为这条查询没有 `WHERE`,不是「找到某一个位置」,是「从索引头开始顺着读」,所以叫 `SCAN`,但已经没有 `TEMP B-TREE` 了,这是关键。

索引的两个字段都写了 `DESC`,为什么?查询是 `ORDER BY started_at DESC, id DESC`,索引的顺序和它完全一致时,SQLite 可以不排序。SQLite 其实也能把升序索引倒着读,所以这里 `DESC` 不写也会走索引,我写上是为了让「索引顺序和查询一致」这件事一眼能看见。**`id` 为什么也在索引里?** 因为合成数据和批量导入里,不同的运行开始时间可能完全相同(Day 656 的 `syn30` 和 `syn10000` 就都是 `02:00:00`)。只按时间排序时,相同时间的几行谁先谁后是不确定的,翻页就会重复或遗漏。加上 `id` 做第二排序键,排序才是确定的。这一点明天讲分页时会真正用上。

把接口背后的查询(列表按不同条件过滤算四条)在真实样例库上的计划都看一遍。先要有库,下一节生成;这里先给结果,脚本是 `scratch/s27_plans.py`,和上面的写法一样,遍历一个字典,每条查询打印一遍计划:

```text
列表(最新一页):
     SCAN runs USING INDEX runs_by_time
列表(按标签):
     SEARCH runs USING INDEX sqlite_autoindex_runs_1 (id=?)
     LIST SUBQUERY 1
     SEARCH run_tags USING COVERING INDEX sqlite_autoindex_run_tags_1 (tag=?)
     USE TEMP B-TREE FOR ORDER BY
列表(按状态):
     SCAN runs USING INDEX runs_by_time
列表(名字包含):
     SCAN runs USING INDEX runs_by_time
一条运行:
     SEARCH runs USING INDEX sqlite_autoindex_runs_1 (id=?)
步骤(从第 20 步起):
     SEARCH steps USING COVERING INDEX sqlite_autoindex_steps_1 (run_id=? AND idx>?)
单步:
     SEARCH steps USING INDEX sqlite_autoindex_steps_1 (run_id=? AND idx=?)
```

逐条看:

- **一条运行、单步、步骤分段**:都是 `SEARCH ... USING INDEX sqlite_autoindex_...`。`sqlite_autoindex_xxx_1` 是 SQLite 为 `PRIMARY KEY` 自动建的索引,名字不是我们起的。步骤分段那条的 `(run_id=? AND idx>?)` 说明联合主键的两列都用上了:先定 `run_id`,再从 `idx` 往后读,不需要排序,因为主键索引本来就按这个顺序排。
- **按标签**:`run_tags` 走了主键索引 `(tag=?)`,这是标签放在联合主键前面的回报;但最后有一行 `USE TEMP B-TREE FOR ORDER BY`,先把带标签的运行都找出来再排序。这就是前面实测里「常见标签反而慢」的原因。想完全消掉它,需要换一种写法(比如以 `runs_by_time` 为驱动表,再检查标签是否存在),这是一个值得知道的优化方向,现在数据量小,不动。
- **按状态**:没有给 `status` 单独建索引,它走的还是 `runs_by_time`,一边从新往旧读一边过滤掉不是 `error` 的行。`status` 只有两个值,索引选择性太差,建了也没用。
- **按名字包含**:`name LIKE '%weather%'` 以通配符开头,任何普通索引都帮不了,只能顺着读、逐行比较。对一个单人工具这是可以接受的,需要快的话要换全文索引(FTS5),写进已知限制,不做。

**没有建的索引也是设计的一部分。** 每个索引都要占磁盘、拖慢写入。今天我只建了一个,就是 `runs_by_time`,其余全靠主键。

## 试写:真实样例和一万步

表和 `save_trace` 都有了,把 Day 654 到 656 的所有样例写进一个新库看看:

```python
# agent-loupe/server/scratch/s25_save.py
"""把真实样例和合成样例都写进一个新库,数一数。"""
import sqlite3
import time
from pathlib import Path

from loupe import db
from loupe.importers import import_any

SAMPLES = Path(__file__).parents[2] / "samples"
DB = Path(__file__).parent / "out" / "s25.db"
DB.parent.mkdir(exist_ok=True)
for p in DB.parent.glob("s25.db*"):
    p.unlink()
conn = db.connect(DB)

for name in ["weather_otlp.jsonl", "weather_langfuse.json", "weather_sdk.jsonl", "weather_fail_sdk.jsonl",
             "synthetic_small.jsonl", "synthetic_10k.jsonl"]:
    traces = import_any((SAMPLES / name).read_text(encoding="utf-8"))
    t = time.perf_counter()
    try:
        for tr in traces:
            db.save_trace(conn, tr)
    except sqlite3.IntegrityError as e:
        print(f"{name:26s} 写入失败:{e}(run id = {traces[0].run.id})")
        continue
    print(f"{name:26s} {len(traces)} 条运行,写入 {time.perf_counter() - t:.2f} 秒")

for r in conn.execute("SELECT id, name, status, step_count, started_at, tags FROM runs ORDER BY started_at DESC"):
    print(dict(r))
print("steps 总行数:", conn.execute("SELECT COUNT(*) FROM steps").fetchone()[0])
print("run_tags:", [tuple(r) for r in conn.execute("SELECT tag, COUNT(*) FROM run_tags GROUP BY tag")])
print(f"库文件 {DB.stat().st_size / 1e6:.1f} MB(含 WAL 另有 {(DB.parent / 's25.db-wal').stat().st_size / 1e6 if (DB.parent / 's25.db-wal').exists() else 0:.1f} MB)")
```

<div class="line-notes">

- `DB = Path(__file__).parent / "out" / "s25.db"` 库文件放在 `scratch/out/` 下,和别的实验输出放一起。`scratch/` 整个在 `.gitignore` 里(Day 652 加的),不会提交。
- `for p in DB.parent.glob("s25.db*"):` 每次运行前删掉上次的库,连同 WAL 开的 `-wal`、`-shm` 文件,保证从空库开始。`glob("s25.db*")` 匹配三个名字。
- `conn = db.connect(DB)` 用今天写的 `connect`,表在这一行建好。
- `for name in ["weather_otlp.jsonl"` 六个样例:三种格式的天气 Agent(OTLP 和 Langfuse 这两份是同一次运行,Langfuse 那份是 Day 655 从 OTLP 转出来的,下面会看到这有后果)、一条失败的 SDK 记录、30 步和 1 万步的合成数据。
- `except sqlite3.IntegrityError as e:` 捕获「违反约束」的错误,包括主键重复、CHECK 不通过。`continue` 跳到下一个文件。
- `print(f"{name:26s} {len(traces)}` `:26s` 把名字补空格到 26 个字符宽,输出对齐。
- `print(dict(r))` `sqlite3.Row` 转成普通字典打印,看得清楚。
- `GROUP BY tag` 数每个标签出现了几次。
- 最后一行算库文件和 WAL 文件的大小。WAL 文件是写入过程中的日志,关闭连接时 SQLite 会把它合并回主文件。

</div>

```text
weather_otlp.jsonl         1 条运行,写入 0.00 秒
weather_langfuse.json      写入失败:UNIQUE constraint failed: runs.id(run id = 51d91320d144ee7d815b7648ea5e02f6)
weather_sdk.jsonl          1 条运行,写入 0.00 秒
weather_fail_sdk.jsonl     1 条运行,写入 0.00 秒
synthetic_small.jsonl      1 条运行,写入 0.00 秒
synthetic_10k.jsonl        1 条运行,写入 0.59 秒
{'id': 'a80a69395096', 'name': 'weather-agent', 'status': 'error', 'step_count': 3, 'started_at': '2026-10-27T05:10:09.813705+00:00', 'tags': '["weather", "deepseek", "sdk"]'}
{'id': 'c70cc39b6020', 'name': 'weather-agent', 'status': 'ok', 'step_count': 6, 'started_at': '2026-10-27T05:09:58.656190+00:00', 'tags': '["weather", "deepseek", "sdk"]'}
{'id': '51d91320d144ee7d815b7648ea5e02f6', 'name': 'invoke_agent weather_agent', 'status': 'ok', 'step_count': 6, 'started_at': '2026-10-27T05:03:43.353820+00:00', 'tags': '["otlp", "weather-agent"]'}
{'id': 'syn30', 'name': 'synthetic-30', 'status': 'ok', 'step_count': 30, 'started_at': '2026-10-27T02:00:00.000000+00:00', 'tags': '["synthetic", "sdk"]'}
{'id': 'syn10000', 'name': 'synthetic-10000', 'status': 'ok', 'step_count': 10000, 'started_at': '2026-10-27T02:00:00.000000+00:00', 'tags': '["synthetic", "sdk"]'}
steps 总行数: 10045
run_tags: [('deepseek', 2), ('otlp', 1), ('sdk', 4), ('synthetic', 2), ('weather', 2), ('weather-agent', 1)]
库文件 19.3 MB(含 WAL 另有 19.6 MB)
```

三个观察。

**一万步写入 0.59 秒。** 一条一条 `execute` 加最后一次 `commit`,这个速度够用了。明天换成 `executemany` 会更快一点,也有别的原因要改。

**Langfuse 那条写入失败了,这是真实发生的,不是我造的。** 那份 Langfuse 样例是 Day 655 按 OTLP 样例转出来的,所以两份文件里是**同一次运行**,run id 都是 `51d91320d144...`。第二次写入撞上了主键,`UNIQUE constraint failed: runs.id`。这是主键在做它该做的事:数据库拒绝了重复。但对用户来说,「我重新导入了同一份数据,结果报错」不是好体验。Loupe 要的语义是「后来的覆盖先来的」,这是 [Day 659](/blog/agent-zero/day-659-loupe-ingest/) 的内容,而且要和事务一起做。这里还留了一个更隐蔽的问题:今天的 `save_trace` 是先插 runs、再插 tags、再插 steps,如果 steps 插到一半出错,runs 和部分 steps 已经在库里了。这次撞主键恰好发生在第一条 `INSERT`,所以没有留下半截数据;换一种错法就不一定了。

**`syn30` 和 `syn10000` 的 `started_at` 完全一样**,都是 `2026-10-27T02:00:00.000000+00:00`。前面说的「时间可能相同」就发生在我们自己的样例里,所以排序里一定要带上 `id`。

库文件 19.3 MB,WAL 另有 19.6 MB,是因为连接还没关,写入的内容还在日志里没合并回主文件。一万步的数据(17 MB 的 JSON)进库以后大小差不多。

## 把结论写成测试

今天的约定都值得钉成测试,不然第二天改一下 `ts()` 都没人知道破坏了什么。`tests/test_db.py`:

```python
# agent-loupe/server/tests/test_db.py
import sqlite3
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import pytest

from loupe import db
from loupe.importers import import_any

SAMPLES = Path(__file__).parents[2] / "samples"


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    return db.connect(tmp_path / "t.db")


def load(name: str):
    return import_any((SAMPLES / name).read_text(encoding="utf-8"))[0]


def test_ts_is_fixed_width_utc() -> None:
    a = db.ts(datetime(2026, 10, 27, 2, 0, 0, tzinfo=UTC))
    b = db.ts(datetime(2026, 10, 27, 10, 0, 0, 500000, tzinfo=timezone(timedelta(hours=8))))
    assert a == "2026-10-27T02:00:00.000000+00:00"
    assert b == "2026-10-27T02:00:00.500000+00:00"
    assert len(a) == len(b) and a < b


def test_save_and_count(conn: sqlite3.Connection) -> None:
    trace = load("weather_sdk.jsonl")
    db.save_trace(conn, trace)
    run = conn.execute("SELECT * FROM runs WHERE id = ?", (trace.run.id,)).fetchone()
    assert run["step_count"] == len(trace.steps) == 6
    assert conn.execute("SELECT COUNT(*) FROM steps").fetchone()[0] == 6
    assert {r["tag"] for r in conn.execute("SELECT tag FROM run_tags")} == set(trace.run.tags)


def test_delete_run_cascades(conn: sqlite3.Connection) -> None:
    db.save_trace(conn, load("weather_sdk.jsonl"))
    conn.execute("DELETE FROM runs")
    assert conn.execute("SELECT COUNT(*) FROM steps").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM run_tags").fetchone()[0] == 0


def test_check_constraint_rejects_bad_kind(conn: sqlite3.Connection) -> None:
    db.save_trace(conn, load("weather_sdk.jsonl"))
    with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
        conn.execute("UPDATE steps SET kind = 'llm2' WHERE idx = 1")


def test_steps_primary_key_is_run_id_idx(conn: sqlite3.Connection) -> None:
    trace = load("weather_sdk.jsonl")
    db.save_trace(conn, trace)
    plan = conn.execute(
        "EXPLAIN QUERY PLAN SELECT idx FROM steps WHERE run_id = ? AND idx >= ? ORDER BY idx LIMIT 5",
        (trace.run.id, 2),
    ).fetchall()
    text = " ".join(r[3] for r in plan)
    assert "USING" in text and "TEMP B-TREE" not in text
```

<div class="line-notes">

- `@pytest.fixture` 声明一个 fixture:测试函数的参数里写 `conn`,pytest 就会先调用它,把返回值传进来,≈ jest 的 `beforeEach` 加返回值。[Day 73](/blog/agent-zero/day-073-pytest-3/) 讲过。
- `def conn(tmp_path: Path)` `tmp_path` 是 pytest 自带的 fixture,给每个测试一个独立的临时目录。每个测试一个新库,互不干扰。
- `def load(name: str):` 小辅助函数:读一个样例,取第一条 Trace。
- `b = db.ts(datetime(2026, 10, 27, 10, 0, 0, 500000, tzinfo=timezone(timedelta(hours=8))))` 北京时间 10:00:00.5,UTC 是 02:00:00.5。`500000` 是微秒数(半秒)。
- `assert len(a) == len(b) and a < b` 两条文本一样长,而且字典序 `a < b`,等于时间先后。这是整个「文本时间能排序」的前提。
- `assert run["step_count"] == len(trace.steps) == 6` 链式比较:冗余字段、实际 steps 数、样例里的步数三者都是 6。
- `{r["tag"] for r in conn.execute("SELECT tag FROM run_tags")}` 集合推导,收集 `run_tags` 里所有标签,和 `trace.run.tags` 比较,≈ JS 里 `new Set(rows.map(r => r.tag))`。
- `conn.execute("DELETE FROM runs")` 不带 WHERE,删光所有运行。断言 steps 和 run_tags 都被级联删空,这是对 `PRAGMA foreign_keys = ON` 的测试:如果哪天有人把它删了,这个测试会变红。
- `with pytest.raises(sqlite3.IntegrityError, match="CHECK"):` 断言块里的代码必须抛出指定的错误,而且错误消息里含 `CHECK`。这里把 kind 改成表外的值,`CHECK` 约束拦下来。
- `"EXPLAIN QUERY PLAN SELECT idx FROM steps WHERE run_id = ? AND idx >= ? ORDER BY idx LIMIT 5"` 测试里也能看计划:这条是步骤分段取的核心查询。
- `assert "USING" in text and "TEMP B-TREE" not in text` 断言走了索引、没有临时排序。以后谁改了主键顺序,这条测试会红。

</div>

```text
51 passed in 0.27s
```

51 是我本地全部测试的数量,包含 Day 652 到 657 的所有测试,今天新增的是 `test_db.py` 里的这 5 个。你的总数取决于你前几天写了多少。

## 动手练习

**练习 1:「找出所有出错的步骤」要不要索引?** 在 `s25.db` 的拷贝上跑 `SELECT run_id, idx FROM steps WHERE error IS NOT NULL`,先看计划和耗时,再试着建一个只包含出错行的**部分索引**,再看一次。部分索引的语法是在 `CREATE INDEX` 末尾加 `WHERE 条件`,它只给满足条件的行建索引。比较它和 `steps` 主键索引的大小。先跑 `s25_save.py` 生成库。

<details><summary>参考答案</summary>

```python
# agent-loupe/server/scratch/ex658_partial.py
import shutil
import time
from pathlib import Path

from loupe import db

out = Path(__file__).parent / "out"
shutil.copy(out / "s25.db", out / "ex658.db")
conn = db.connect(out / "ex658.db")
Q = "SELECT run_id, idx FROM steps WHERE error IS NOT NULL"


def show(label: str) -> None:
    plan = [r[3] for r in conn.execute("EXPLAIN QUERY PLAN " + Q)]
    t = time.perf_counter()
    n = len(conn.execute(Q).fetchall())
    print(f"{label}:{plan},{n} 行,{(time.perf_counter() - t) * 1000:.2f} 毫秒")


show("没有索引")
conn.execute("CREATE INDEX steps_errors ON steps (run_id, idx) WHERE error IS NOT NULL")
show("部分索引")
print("索引大小对比:", [tuple(r) for r in conn.execute(
    "SELECT name, SUM(pgsize) FROM dbstat WHERE name IN ('steps_errors', 'sqlite_autoindex_steps_1') GROUP BY name")])
```

<div class="line-notes">

- `shutil.copy(out / "s25.db", out / "ex658.db")` 复制一份再改,不动原库。注意 WAL 模式下原库的内容可能还在 `-wal` 文件里没合并,但 `s25_save.py` 结束时连接被关闭,SQLite 会合并,所以拷贝的主文件是完整的。
- `Q = "SELECT run_id, idx FROM steps WHERE error IS NOT NULL"` 找出有错误信息的步骤。`IS NOT NULL` 才是判断非空的写法,不是 `!= NULL`。
- `CREATE INDEX steps_errors ON steps (run_id, idx) WHERE error IS NOT NULL` 部分索引:只给 `error` 非空的行建。一万步里约 3% 失败,所以索引只有几百项。
- `FROM dbstat` SQLite 的一张内置虚拟表,记录每个表和索引占的页数。`pgsize` 是页大小,`SUM(pgsize)` 就是总字节数。这张表在 Python 自带的 SQLite 里能用;如果你的环境报 `no such table: dbstat`,说明编译时没带它,跳过这一行。

</div>

```text
没有索引:['SCAN steps'],213 行,5.16 毫秒
部分索引:['SCAN steps USING INDEX steps_errors'],213 行,0.22 毫秒
索引大小对比: [('sqlite_autoindex_steps_1', 221184), ('steps_errors', 4096)]
```

213 行出错的步骤(合成数据里每次工具调用有 3% 概率失败,再加上那条真实失败的)。没有索引扫整张 1 万行的表,5 毫秒;有了部分索引,0.22 毫秒。主键索引 216 KB,部分索引只有 4 KB,因为只有 213 项。代价小到可以忽略。但要不要建,取决于这个查询会不会真的出现在界面里:今天的七个接口里没有它,所以我**不加进 `SCHEMA`**。等 Day 673「导出失败步骤到评测集」真要按错误找步骤的时候,再回来加。

</details>

**练习 2:亲手复现标签的取舍。** 照 `s24_plan.py` 的写法,建 20 万条运行、每条两个标签(从 50 个里随机选),再给 3 条运行加一个稀有标签 `rare`。分别对 `tag7`(常见)和 `rare`(稀有)比较两种过滤:`runs.tags LIKE '%"tag7"%'` 和通过 `run_tags` 的子查询,各取最新的 51 条。写下你的结论:什么时候选哪种。

<details><summary>参考答案</summary>

```python
# agent-loupe/server/scratch/ex658_tags_like.py
import random
import sqlite3
import time
from datetime import datetime, timedelta, timezone

from loupe import db

conn = sqlite3.connect(":memory:")
conn.executescript(db.SCHEMA)
rnd = random.Random(2)
t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
TAGS = [f"tag{i}" for i in range(50)]
for i in range(200_000):
    tags = rnd.sample(TAGS, 2) + (['rare'] if i % 70_000 == 0 else [])
    rid = f"run{i:06d}"
    conn.execute("INSERT INTO runs (id, name, started_at, ended_at, status, tags) VALUES (?, ?, ?, 'x', 'ok', ?)",
                 (rid, f"run-{i}", db.ts(t0 + timedelta(seconds=i)), str(tags).replace("'", '"')))
    conn.executemany("INSERT INTO run_tags VALUES (?, ?)", [(rid, t) for t in tags])
conn.commit()

for tag in ("tag7", "rare"):
    for label, sql in {
        "LIKE 扫 tags 列": f"SELECT id FROM runs WHERE tags LIKE '%\"{tag}\"%' ORDER BY started_at DESC, id DESC LIMIT 51",
        "run_tags 子查询": f"SELECT id FROM runs WHERE id IN (SELECT run_id FROM run_tags WHERE tag = '{tag}')"
                           " ORDER BY started_at DESC, id DESC LIMIT 51",
    }.items():
        t = time.perf_counter()
        for _ in range(5):
            rows = conn.execute(sql).fetchall()
        print(f"{tag:5s} {label}:{len(rows)} 行,平均 {(time.perf_counter() - t) / 5 * 1000:.1f} 毫秒")
```

<div class="line-notes">

- `rnd.sample(TAGS, 2) + (['rare'] if i % 70_000 == 0 else [])` 每条运行从 50 个标签里不重复地抽 2 个;`i` 是 0、70000、140000 的三条运行额外多一个 `rare`。`i % 70_000 == 0` 当 `i` 能被 70000 整除时为真。
- `str(tags).replace("'", '"')` 偷懒的 JSON:Python 列表的 `str` 是 `['tag7', 'tag9']`,把单引号换成双引号就成了 `["tag7", "tag9"]`。这里只用于实验,正式代码用 `json.dumps`。 时间用 `db.ts(...)`,每条运行比上一条晚一秒,所以时间互不相同。
- `conn.executemany("INSERT INTO run_tags VALUES (?, ?)", [(rid, t) for t in tags])` 一次插入这条运行的所有标签。列顺序是 `(run_id, tag)`,和建表语句的顺序一致。
- `for tag in ("tag7", "rare"):` 两种标签各比一次。
- `'%\"{tag}\"%'` 连引号一起匹配,这样搜 `tag7` 不会误匹配到 `tag70` 之类。f-string 里的 `\"` 是转义的双引号。
- `(time.perf_counter() - t) / 5 * 1000` 5 次的总时间除以 5,再乘 1000 换成毫秒。

</div>

```text
tag7  LIKE 扫 tags 列:51 行,平均 0.5 毫秒
tag7  run_tags 子查询:51 行,平均 12.5 毫秒
rare  LIKE 扫 tags 列:3 行,平均 73.2 毫秒
rare  run_tags 子查询:3 行,平均 0.0 毫秒
```

结论:常见标签用 LIKE 快 25 倍,稀有标签用 `run_tags` 快到测不出来(73 毫秒对 0.0)。LIKE 的耗时取决于「最新的 51 条里要翻多深才凑够」,没法预测;`run_tags` 的耗时取决于「带这个标签的运行有多少」,上限是 12 毫秒这个级别。我们不知道用户会按什么标签筛,所以选上限可控的 `run_tags`。如果哪天你确定只会筛少数几个常见标签,LIKE 更简单。两种选择都没错,错的是不测就选。

注意这是内存库,磁盘库第一次读还要加上读盘的时间,实际数字会更大,但相对关系不变。我只在这一台机器上跑了这一组,当量级看。

</details>

**练习 3:写一个「冗余字段对不对」的检查。** `runs.step_count` 应该等于 `steps` 里这条运行的实际行数。写 `mismatched(conn)`,返回不一致的运行 `(id, step_count, 实际行数)`。在 `s25.db` 的拷贝上手动删掉 `syn30` 的最后 3 步,验证它能抓出来。注意:有的运行可能一步都没有,不能漏掉它们。

<details><summary>参考答案</summary>

```python
# agent-loupe/server/scratch/ex658_counts.py
import sqlite3
from pathlib import Path

from loupe import db


def mismatched(conn: sqlite3.Connection) -> list[tuple[str, int, int]]:
    rows = conn.execute(
        "SELECT r.id, r.step_count, COUNT(s.idx) FROM runs r LEFT JOIN steps s ON s.run_id = r.id"
        " GROUP BY r.id HAVING r.step_count != COUNT(s.idx)"
    ).fetchall()
    return [tuple(r) for r in rows]


if __name__ == "__main__":
    conn = db.connect(Path(__file__).parent / "out" / "ex658.db")
    print("原始库:", mismatched(conn))
    conn.execute("DELETE FROM steps WHERE run_id = 'syn30' AND idx >= 27")
    print("手动删掉 3 步以后:", mismatched(conn))
```

<div class="line-notes">

- `FROM runs r LEFT JOIN steps s ON s.run_id = r.id` 把每条运行和它的步骤接起来。`r`、`s` 是表的别名。用 `LEFT JOIN` 而不是普通 `JOIN`:一步都没有的运行在普通 JOIN 里会整行消失,检查不到;`LEFT JOIN` 会保留它,`s.idx` 是 `NULL`。<br>`COUNT(s.idx)` 数的是非空的 `s.idx`,所以没有步骤的运行得到 0(`COUNT(*)` 会得到 1,因为那一行本身存在)。这是这条检查最容易写错的地方。
- `HAVING r.step_count != COUNT(s.idx)` 按运行分组,`HAVING` 对分组后的结果过滤,只留下冗余字段和实际数不相等的。`WHERE` 管不了聚合结果,所以必须用 `HAVING`。
- `return [tuple(r) for r in rows]` 把 `sqlite3.Row` 转成普通元组,方便比较和打印。
- `DELETE FROM steps WHERE run_id = 'syn30' AND idx >= 27` 手动制造不一致:30 步的运行删掉第 27、28、29 步。

</div>

```text
原始库: []
手动删掉 3 步以后: [('syn30', 30, 27)]
```

原始库里没有任何不一致;手动删了 3 步后,`syn30` 的 `step_count` 还说 30,实际只有 27。这个函数明天也有用:验证「导入失败时没有留下半截数据」。

</details>

**验收标准**:`uv run pytest -q` 全部通过;`s25_save.py` 能跑完并看到那条主键冲突的报错;`s24_plan.py` 的输出里,有索引时没有 `TEMP B-TREE`;三个练习各有结果;能不看文章默写出三张表的建表语句。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 接口先行 | 先确定前端要调哪些接口、每个接口返回什么,再倒推数据库表怎么建 |
| 联合主键 | 由两列以上共同组成的主键,如 `(run_id, idx)`:单列可以重复,组合不能重复 |
| 冗余字段 | 能从别的数据算出来,但为了查询方便多存一份的字段,如 `step_count` |
| 外键 | 一列的值必须是另一张表主键里存在的值,如 `steps.run_id` 引用 `runs.id` |
| 级联删除(`ON DELETE CASCADE`) | 删除被引用的行时,引用它的行自动一起删除 |
| `CHECK` 约束 | 写进列时检查一个条件,不满足就拒绝,如 `status IN ('ok', 'error')` |
| PRAGMA | SQLite 的配置命令,不是 SQL 标准,如 `PRAGMA foreign_keys = ON` |
| WAL | write-ahead logging,预写日志模式,读写可以同时进行 |
| `EXPLAIN QUERY PLAN` | 让 SQLite 说出它打算怎么执行一条查询,不真的执行 |
| `SCAN` / `SEARCH` | 查询计划里的两种读法:扫整张表(或沿索引顺着读),和通过索引直接定位 |
| 临时 B 树(`TEMP B-TREE`) | 没有现成顺序可用时,SQLite 在内存里临时建的排序结构 |
| 部分索引 | 只给满足某个条件的行建的索引,更小,只服务特定查询 |
| 选择性 | 一个列的值有多分散。只有两个取值的列(如 status)选择性差,建索引通常没用 |
| 定宽文本时间 | 每个时间都格式化成同样长度的字符串,字典序才等于先后 |

## 常见误区

**照着数据的形状建表,最后才想查询。** 表是为查询服务的。先把接口和查询列出来,再设计表和索引,发现某个查询只能全表扫描时还来得及改。

**把时间存成各种写法的文本。** `Z`、`+00:00`、有没有小数,混着存,排序就会错得没有规律。统一转 UTC、统一定宽。

**`PRAGMA foreign_keys` 只在建表时设置一次。** 它是连接级别的,每次 `connect` 都要设,新开一个连接就回到默认的 OFF。

**给每一列都建索引。** 索引占空间、拖慢写入。`status` 只有两个值,建了没用。只给「有一个具体查询在等着它」的列建索引。

**以为 `USE TEMP B-TREE` 只是个提示。** 数据量小的时候无所谓,数据量大了它就是慢的来源。看到它,要想想是不是可以让索引顺序和 `ORDER BY` 一致。

**只看耗时不看计划。** 数据量小时,走不走索引都是几毫秒,测不出区别。`EXPLAIN QUERY PLAN` 不依赖数据量,今天的 `test_steps_primary_key_is_run_id_idx` 就是这么做的。

**冗余字段不配保证一致的手段。** `step_count` 存一份有好处,前提是写入是原子的。没有事务,冗余字段迟早会和真实数据对不上。

## 学习资料

### 文档与文章

- [SQLite:EXPLAIN QUERY PLAN](https://www.sqlite.org/eqp.html):官方对 `SCAN`、`SEARCH`、`COVERING INDEX`、`TEMP B-TREE` 每一种输出的解释,今天读懂计划就靠它,20 分钟。
- [SQLite:Foreign Key Support](https://www.sqlite.org/foreignkeys.html):外键为什么默认关闭、`ON DELETE CASCADE` 怎么写,开头几节讲得很清楚,20 分钟。
- [SQLite:Date And Time Functions](https://www.sqlite.org/lang_datefunc.html):SQLite 没有时间类型,三种存法和它们的函数,10 分钟。
- [SQLite:Partial Indexes](https://www.sqlite.org/partialindex.html):练习 1 里用到的部分索引,官方文档有一节专门讲,10 分钟。
- [SQLite:The SQLite Query Optimizer Overview](https://www.sqlite.org/optoverview.html):想知道 SQLite 怎么挑索引、什么时候放弃索引,可以慢慢读,今天先扫一眼目录,15 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Kc411b7ny&autoplay=0&high_quality=1" title="5分钟讲透索引" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>涛哥编程日记 · 5分钟讲透索引 · 约 7 分钟,播放 2.2 万,2024 年发布。索引为什么快、代价是什么,Day 89 看过的话今天再看一遍巩固,对应「索引:给每个查询找一个」一节。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Hh9dYBEbH&autoplay=0&high_quality=1" title="彻底搞懂MySQL联合索引+最左前缀原则" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>代码记录栈 · 彻底搞懂 MySQL 联合索引 + 最左前缀原则 · 约 13 分钟,播放 3400,2025 年发布。用 MySQL 讲,规则和 SQLite 一致,正好解释为什么 `run_tags` 的主键要把 tag 放前面。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/K1a2Bk8NrYQ" title="Understanding B-Trees: The Data Structure Behind Modern Databases" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Spanning Tree · Understanding B-Trees: The Data Structure Behind Modern Databases · 讲 B 树,也就是索引背后的数据结构。我只核对了标题和作者,没有完整看过,看不懂可以跳过,不影响后面的课。</figcaption>
</figure>

### 书籍

- **Designing Data-Intensive Applications**,Martin Kleppmann 和 Chris Riccomini,O'Reilly,第二版 2026 年出版(第一版 2017 年只有 Kleppmann 一位作者)。讲存储与检索的那一章有 B 树和 LSM 树,约 1.5 小时。章节编号两版不一定相同,以你手里那本的目录为准。
- **SQL Performance Explained**,Markus Winand,2012。它的在线版就是 Use The Index, Luke(<https://use-the-index-luke.com/>),读「The Where Clause」里讲联合索引顺序的那几节,约 40 分钟。

### 开源项目与代码

- [langfuse/langfuse](https://github.com/langfuse/langfuse):开源的 LLM 可观测平台,存 trace 的方式和我们不一样(它用 Postgres 加 ClickHouse),可以看它的数据库 schema 对比:什么情况下需要拆成更多张表。
- [simonw/sqlite-utils](https://github.com/simonw/sqlite-utils):Simon Willison 的 SQLite 工具库,README 里有大量「怎么用 Python 操作 SQLite」的小例子,今天的 `connect` 可以对照着看(我没有读过它的源码,只推荐 README)。

## 自测

1. 为什么 Loupe 先列接口再建表,不直接照着 `Run` 和 `Step` 建?

<details><summary>答案</summary>

因为表的好坏取决于查询跑不跑得快。先列出前端要的接口,才知道哪些字段要变成真正的列(列表页要的名字、状态、步数)、哪些要拆成单独的表(标签)、哪些索引要建。照着对象建表,到写查询时才发现要全表扫描,再改表就晚了。

</details>

2. `runs` 表为什么要存一个能算出来的 `step_count`?它带来什么风险?

<details><summary>答案</summary>

列表页每行都要显示步数,一页 50 行如果每行都 `COUNT(*)` 要多跑 50 次查询,分段取步骤时也要用它判断有没有下一段。导入之后数据不再变,所以冗余没有「改了一边忘了改另一边」的问题。风险是写入不原子时,`step_count` 和 `steps` 的实际行数会对不上,所以导入要放进事务(明天讲),并且可以像练习 3 那样写个检查。

</details>

3. `run_tags` 的主键为什么是 `(tag, run_id)` 而不是 `(run_id, tag)`?

<details><summary>答案</summary>

按标签筛选的查询是 `WHERE tag = ?`,联合主键的索引按第一列、第二列的顺序排,`tag` 在前,这个查询才能直接定位到那个标签的区间。写成 `(run_id, tag)`,按标签查就用不上主键索引,要么全表扫描,要么另外再建一个索引。(联合索引的最左前缀规则。)

</details>

4. 看到这样的查询计划,你会担心什么?怎么改?<br>`SCAN runs`<br>`USE TEMP B-TREE FOR ORDER BY`

<details><summary>答案</summary>

担心两件事:扫整张表,和临时排序,数据量大了两者都慢。改法是建一个和 `WHERE`、`ORDER BY` 一致的索引,让数据库沿着索引直接读出已经排好的行,今天的 `runs_by_time (started_at DESC, id DESC)` 就是这样:加上以后计划变成 `SCAN runs USING INDEX runs_by_time`,20 万行下从 17.8 毫秒降到 0.05 毫秒(我这台机器上)。

</details>

5. 面试题:你的 trace 表有 5000 万行 steps,一个查询 `WHERE kind = 'tool' AND error IS NOT NULL` 很慢,你怎么排查和优化?

<details><summary>答案</summary>

先用 `EXPLAIN`(Postgres 用 `EXPLAIN ANALYZE`)确认它是不是全表扫描,看估计和实际行数差多少。再看这两个条件的选择性:`kind` 只有几个值,单独建索引几乎没用;`error IS NOT NULL` 是少数行,选择性好。所以应该建部分索引(`WHERE error IS NOT NULL`)或把它放在联合索引的最左边。同时看这个查询是不是真的高频,还是一次性的报表,后者可以不优化,放到离线。数据量太大时还要考虑按时间分区、把冷数据归档。回答要体现「先测量、再决定」,不是上来就说「加索引」。

</details>

6. 时间存成文本,什么条件下 `ORDER BY` 才是对的?Loupe 里是怎么保证的?

<details><summary>答案</summary>

文本的字典序必须等于时间先后:所有时间在同一个时区,而且格式定宽。Loupe 两层保证:`UtcDatetime` 在模型层把所有时间转成 UTC,`db.ts()` 在写库时统一输出六位微秒的 ISO 文本。少一层,排序就会出现 `02:00:00.5Z` 排在 `02:00:00Z` 前面这种错误。

</details>

## 明天预告

明天(Day 659)是 Loupe(七):**导入事务、覆盖语义、游标分页**。今天留下了两个问题:`save_trace` 写到一半出错会不会留下半截数据,重新导入同一份文件为什么报「UNIQUE constraint failed」而不是覆盖。明天先把写入包进一个事务,让「要么全进、要么全不进」,再让重复导入变成覆盖;然后写运行列表的游标分页,看 `LIMIT/OFFSET` 在翻页途中有新数据插入时怎么出错,游标又为什么要同时带时间和 id。
