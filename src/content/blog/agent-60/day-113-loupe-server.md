---
title: 'Day 113 · Agent Loupe(二):FastAPI 存储与查询接口'
description: '把导入器接到后端:SQLite 表和索引怎么设计,导入为什么要放在一个事务里,运行列表用游标分页而不是 OFFSET,一万步的 trace 怎么分段加载,成本按价格表补上。最后用 curl 和 pytest 把每个接口都验一遍,并实测一万步导入和查询的耗时。'
pubDate: 2026-10-15
regime: none
tags: ['agent-loupe', 'fastapi', 'sqlite', 'pagination', 'agent-60']
series: 'agent-60'
day: 113
lang: 'zh'
---

## 今天要解决的问题

昨天的导入器能把三种格式转成 `Trace` 对象,但它们只活在内存里。今天把数据存下来、查出来,让前端有东西可调。学完你应该能:

1. 设计出存 Run 和 Step 的 SQLite 表,说清楚每个索引是给哪个查询用的。
2. 写出导入接口,做到「一个文件要么全部进库、要么什么都不进」,重复导入同一条运行时覆盖而不是重复。
3. 实现运行列表的游标分页,能解释它比 `LIMIT/OFFSET` 好在哪、`(started_at, id)` 为什么要一起比较。
4. 实现步骤的分段加载,默认返回不带大字段的「轻」步骤,点开某一步时再取完整内容。
5. 按价格表给没有成本的模型调用补上成本,并能说出这个价格是哪天、从哪里查的。

预计用时 4 到 5 小时。前置:Day 112 的模型和导入器;Day 36 把 Agent 做成服务时写过的 FastAPI;一点 SQL。

## 先定接口,再定表

后端今天要提供五个接口,前三个是 5C 规格里定好的,后两个是为了前端性能我额外加的:

| 接口 | 用途 |
| --- | --- |
| `POST /api/import` | 上传一个 trace 文件,自动识别格式,返回导入了哪些运行 |
| `GET /api/runs?tag=&status=&q=&cursor=` | 运行列表,按开始时间倒序,游标分页 |
| `GET /api/runs/{id}` | 一条运行的汇总信息 |
| `GET /api/runs/{id}/steps?from=&limit=&full=` | 一条运行的步骤,从第 `from` 步开始取 `limit` 步 |
| `GET /api/runs/{id}/steps/{idx}` | 单独一步的完整内容(新增) |

先列接口有一个好处:表的设计直接从「这些查询怎么跑得快」推出来,而不是先拍脑袋建表,再想办法凑查询。

## 表设计

```python
# agent-loupe/server/loupe/db.py
import base64
import json
import sqlite3
from pathlib import Path
from typing import Any

from loupe.models import Run, Step, Trace

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    status TEXT NOT NULL,
    model TEXT,
    total_input_tokens INTEGER NOT NULL DEFAULT 0,
    total_output_tokens INTEGER NOT NULL DEFAULT 0,
    total_cost_usd REAL NOT NULL DEFAULT 0,
    tags TEXT NOT NULL DEFAULT '[]',
    parent_run_id TEXT,
    forked_from_step INTEGER,
    step_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS runs_by_time ON runs(started_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS run_tags (
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (tag, run_id)
);
CREATE TABLE IF NOT EXISTS steps (
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    parent_idx INTEGER,
    kind TEXT NOT NULL,
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

LIGHT_COLS = ("run_id, idx, parent_idx, kind, name, started_at, ended_at, error, "
              "input_tokens, output_tokens, cost_usd, model")


def connect(path: str | Path = "loupe.db") -> sqlite3.Connection:
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")  # 读写可以并发,导入大文件时列表页不卡
    conn.executescript(SCHEMA)
    return conn


def save_trace(conn: sqlite3.Connection, trace: Trace) -> None:
    r = trace.run
    with conn:  # 一个事务:要么整条 run 进库,要么什么都不进
        conn.execute("DELETE FROM runs WHERE id = ?", (r.id,))  # 重复导入同一条 = 覆盖
        conn.execute(
            "INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (r.id, r.name, r.started_at.isoformat(), r.ended_at.isoformat(), r.status, r.model,
             r.total_input_tokens, r.total_output_tokens, r.total_cost_usd, json.dumps(r.tags, ensure_ascii=False),
             r.parent_run_id, r.forked_from_step, len(trace.steps)),
        )
        conn.executemany("INSERT INTO run_tags VALUES (?, ?)", [(r.id, t) for t in r.tags])
        conn.executemany(
            "INSERT INTO steps VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [(s.run_id, s.idx, s.parent_idx, s.kind, s.name, s.started_at.isoformat(), s.ended_at.isoformat(),
              json.dumps(s.input, ensure_ascii=False), json.dumps(s.output, ensure_ascii=False), s.error,
              s.input_tokens, s.output_tokens, s.cost_usd, s.model) for s in trace.steps],
        )


def _run_from_row(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    d["tags"] = json.loads(d["tags"])
    return d


def encode_cursor(started_at: str, run_id: str) -> str:
    return base64.urlsafe_b64encode(f"{started_at}|{run_id}".encode()).decode()


def decode_cursor(cursor: str) -> tuple[str, str]:
    started_at, run_id = base64.urlsafe_b64decode(cursor.encode()).decode().split("|", 1)
    return started_at, run_id


def list_runs(conn: sqlite3.Connection, *, tag: str | None = None, status: str | None = None,
              q: str | None = None, cursor: str | None = None, limit: int = 50) -> dict[str, Any]:
    where, args = [], []
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
        # 游标分页:接着上一页最后一条往后取,(started_at, id) 一起比较保证同一时刻的 run 不重不漏
        where.append("(started_at, id) < (?, ?)")
        args += list(decode_cursor(cursor))
    sql = "SELECT * FROM runs" + (" WHERE " + " AND ".join(where) if where else "")
    sql += " ORDER BY started_at DESC, id DESC LIMIT ?"
    rows = conn.execute(sql, [*args, limit + 1]).fetchall()  # 多取一条,用来判断还有没有下一页
    items = [_run_from_row(r) for r in rows[:limit]]
    next_cursor = encode_cursor(items[-1]["started_at"], items[-1]["id"]) if len(rows) > limit else None
    return {"items": items, "next_cursor": next_cursor}


def get_run(conn: sqlite3.Connection, run_id: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
    return _run_from_row(row) if row else None


def get_steps(conn: sqlite3.Connection, run_id: str, *, start: int = 0, limit: int = 500,
              full: bool = False) -> list[dict[str, Any]]:
    cols = "*" if full else LIGHT_COLS
    rows = conn.execute(
        f"SELECT {cols} FROM steps WHERE run_id = ? AND idx >= ? ORDER BY idx LIMIT ?",
        (run_id, start, limit),
    ).fetchall()
    out = []
    for row in rows:
        d = dict(row)
        if full:
            d["input"] = json.loads(d["input"]) if d["input"] is not None else None
            d["output"] = json.loads(d["output"]) if d["output"] is not None else None
        out.append(d)
    return out


def get_step(conn: sqlite3.Connection, run_id: str, idx: int) -> dict[str, Any] | None:
    rows = get_steps(conn, run_id, start=idx, limit=1, full=True)
    return rows[0] if rows and rows[0]["idx"] == idx else None


def load_trace(conn: sqlite3.Connection, run_id: str) -> Trace | None:
    """整条读回成 Trace 对象,对比和重跑(Day 116、117)会用到。"""
    run = get_run(conn, run_id)
    if run is None:
        return None
    run.pop("step_count")
    steps = get_steps(conn, run_id, limit=1_000_000, full=True)
    return Trace(run=Run.model_validate(run), steps=[Step.model_validate(s) for s in steps])
```

**runs 表多存了一个 `step_count`**。这是一个冗余字段,完全可以 `SELECT COUNT(*) FROM steps WHERE run_id = ?` 算出来。但列表页每一行都要显示步数,一页 50 行就是 50 次 COUNT,而且步骤分页接口要靠它判断「还有没有下一页」。数据导入以后就不会变,冗余存一份没有一致性风险。

**tags 存了两份**。runs 表里的 `tags` 是 JSON 字符串,原样返回给前端用;`run_tags` 表一行一个标签,专门给「按标签筛选」用。只存 JSON 的话,按标签查就得用 `LIKE '%"demo"%'` 或者 SQLite 的 JSON 函数扫全表。`run_tags` 的主键是 `(tag, run_id)`,标签在前,按标签查正好走主键索引。

**input 和 output 存成 TEXT**。它们是任意 JSON,我们不会按里面的内容查询,存成文本最简单。SQLite 也有 JSON 函数,真要按内容搜的时候(比如「找出所有调过 get_weather 的步骤」)可以用,但今天用不上。

**索引**。`runs_by_time` 是 `(started_at DESC, id DESC)`,和列表查询的 `ORDER BY` 完全一致,游标条件也是这两个字段,SQLite 可以沿着索引直接取到一页。steps 表的主键 `(run_id, idx)` 本身就是索引,`WHERE run_id = ? AND idx >= ? ORDER BY idx LIMIT ?` 正好是一次范围扫描,不需要再建别的索引。

**两个 PRAGMA**。`foreign_keys = ON`:SQLite 默认不检查外键,不打开的话 `ON DELETE CASCADE` 也不会生效,删一条 run 会留下一堆孤儿步骤。`journal_mode = WAL`:预写日志模式下读和写可以同时进行,导入一个 19 MB 的大文件时,列表页的查询不会被卡住。

## 导入:一个事务,覆盖语义

`save_trace` 里的 `with conn:` 是 sqlite3 模块的事务写法:代码块正常结束就提交,抛异常就回滚。为什么一定要放在一个事务里?设想导入一万步,插到第五千步时磁盘满了。没有事务的话,数据库里会留下一条 `step_count = 10000` 但只有 5000 步的运行,前端加载到一半就断了,还查不出原因。有事务,要么全进、要么全不进。

事务的第一句是 `DELETE FROM runs WHERE id = ?`。同一个文件导入两次会怎样?run 的 ID 来自 trace 本身(OTLP 的 traceId、Langfuse 的 trace id、SDK 生成的 id),所以第二次导入时 ID 相同。我选的语义是覆盖:先删再插,外键的级联删除会把旧步骤一起清掉。另一种选择是报错「已存在」,但调试时经常是「改了导入器,重新导入看看效果」,覆盖更顺手。

`executemany` 一次插入所有步骤,比循环里一条条 `execute` 快得多。一万步的导入,我下面实测过。

## 列表的游标分页

运行列表按开始时间倒序。最容易想到的分页是 `LIMIT 50 OFFSET 100`,取第三页。它有两个毛病。

第一个是慢。`OFFSET 100000` 的意思是「先数出十万行,扔掉,再取 50 行」,越往后翻越慢。我们的数据量不大,这一点暂时不明显。

第二个对我们更要紧:**翻页过程中数据变了,结果会错**。用户在看第一页的时候,另一个窗口导入了一条新运行,它排在最前面。用户点「加载更多」取第二页,`OFFSET 50` 现在对应的是原来的第 49 条,于是第 49 条出现了两次。删除数据时则会漏掉一条。

游标分页换一种问法:不说「跳过多少行」,而说「从上一页最后一条之后接着取」。上一页最后一条的 `(started_at, id)` 编码成一个不透明的字符串交给前端,下一页的查询条件就是 `(started_at, id) < (上一条的值)`。新插入的数据排在前面,不影响后面的页;查询直接沿索引定位,不用数前面的行。

<figure>
<svg viewBox="0 0 640 280" role="img" aria-label="OFFSET 分页和游标分页对比:OFFSET 在中途插入数据后会重复返回一条,游标分页从上一页最后一条之后接着取">
  <rect x="0" y="0" width="640" height="280" fill="var(--paper-raised)" rx="6"/>
  <text x="160" y="26" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">LIMIT 3 OFFSET 3</text>
  <text x="480" y="26" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">游标:(时间, id) &lt; (R4)</text>
  <rect x="60" y="40" width="200" height="24" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="160" y="57" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">新插入 R0(第一页之后)</text>
  <rect x="60" y="68" width="200" height="22" fill="none" stroke="var(--rule)"/>
  <text x="160" y="84" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">R1</text>
  <rect x="60" y="92" width="200" height="22" fill="none" stroke="var(--rule)"/>
  <text x="160" y="108" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">R2</text>
  <rect x="60" y="116" width="200" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="160" y="132" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">R3 ← 第二页又返回了一次</text>
  <rect x="60" y="140" width="200" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="160" y="156" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">R4</text>
  <rect x="60" y="164" width="200" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="160" y="180" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">R5</text>
  <rect x="380" y="40" width="200" height="24" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="480" y="57" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">新插入 R0(不影响)</text>
  <rect x="380" y="68" width="200" height="22" fill="none" stroke="var(--rule)"/>
  <text x="480" y="84" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">R1</text>
  <rect x="380" y="92" width="200" height="22" fill="none" stroke="var(--rule)"/>
  <text x="480" y="108" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">R2</text>
  <rect x="380" y="116" width="200" height="22" fill="none" stroke="var(--rule)"/>
  <text x="480" y="132" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">R3 ← 第一页最后一条</text>
  <rect x="380" y="140" width="200" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="480" y="156" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">R4</text>
  <rect x="380" y="164" width="200" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="480" y="180" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">R5</text>
  <rect x="380" y="188" width="200" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="480" y="204" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">R6</text>
  <text x="160" y="232" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">第一页是 R1 R2 R3,第二页 R3 R4 R5</text>
  <text x="480" y="232" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">第二页从 R3 之后取:R4 R5 R6</text>
  <text x="320" y="262" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">蓝色是第二页返回的行</text>
</svg>
<figcaption>用户翻页期间有新数据插进来时,OFFSET 会重复(删除数据时则会漏),游标分页不受影响。</figcaption>
</figure>

为什么游标里要同时有 `started_at` 和 `id`?只用时间的话,两条运行开始时间完全相同(合成数据、批量导入时很常见),`started_at < X` 会把和最后一条同一时刻的其他运行全部跳过。加上 id 做第二排序键,就变成了严格的全序,不重不漏。`(started_at, id) < (?, ?)` 这种写法叫行值比较,SQLite 3.15 起支持,等价于 `started_at < ? OR (started_at = ? AND id < ?)`,但更短,也能用上索引。

还有一个小技巧:每次多取一条(`LIMIT limit + 1`)。如果真取到了 limit+1 条,说明还有下一页,把第 limit 条做成游标;否则 `next_cursor` 是 null。这样不需要额外的 COUNT 查询。

游标用 base64 编码,是为了让它看起来不透明,前端只管原样传回,不去拼它。被人改坏了会解码失败,接口返回 400 而不是 500。注意 base64 不是加密,别在游标里放敏感信息。

## 步骤的分段加载和「轻」步骤

步骤的分页简单得多。步骤的 idx 是连续整数,而且导入后不会变,`idx >= from` 本身就是一个天然的游标。`next_from` 是这一页最后一步的 idx 加一,到了最后一页就是 null。

真正值得设计的是**每一步返回哪些字段**。时间轴只需要名字、类型、时间、错误和 token,一步大概一两百字节;但一次模型调用的 input 是当时完整的 messages,越往后越长,可能有几十 KB。所以接口默认返回 `LIGHT_COLS` 里那些字段,`full=true` 时才带上 input 和 output;再单独提供 `/steps/{idx}`,前端点开哪一步就取哪一步。

这个差距有多大,下面用一万步的合成数据实测。

## 成本:价格表和查证

我们的 SDK 只记 token,不记成本;OTLP 的 GenAI 约定里也没有成本字段;只有 Langfuse 导出的数据自带它算好的成本。所以导入时要按价格表补上。

```json
{
  "_note": "美元 / 百万 token。2026-10-15 查 https://api-docs.deepseek.com/quick_start/pricing ,按高峰时段、缓存未命中计(偏保守)。换模型或价格变了就改这里。",
  "deepseek-flash": {"input": 0.30, "output": 1.20},
  "deepseek-v4-pro": {"input": 1.32, "output": 3.96}
}
```

```python
# agent-loupe/server/loupe/pricing.py
import json
import os
from functools import lru_cache
from pathlib import Path

from loupe.models import Trace

PRICES_FILE = Path(os.environ.get("LOUPE_PRICES", Path(__file__).parents[1] / "prices.json"))


@lru_cache
def load_prices() -> dict[str, dict[str, float]]:
    raw = json.loads(PRICES_FILE.read_text(encoding="utf-8"))
    return {k: v for k, v in raw.items() if not k.startswith("_")}


def fill_costs(trace: Trace) -> Trace:
    """trace 里没带成本的 llm 步,按价格表补上;带了的(比如 Langfuse 算好的)不动。"""
    prices = load_prices()
    steps = []
    for s in trace.steps:
        p = prices.get(s.model or "")
        if s.kind == "llm" and s.cost_usd is None and p and (s.input_tokens or s.output_tokens):
            cost = ((s.input_tokens or 0) * p["input"] + (s.output_tokens or 0) * p["output"]) / 1_000_000
            s = s.model_copy(update={"cost_usd": round(cost, 8)})
        steps.append(s)
    total = round(sum(s.cost_usd or 0 for s in steps), 8)
    return Trace(run=trace.run.model_copy(update={"total_cost_usd": total}), steps=steps)
```

价格是我 2026 年 10 月 15 日查 [DeepSeek 定价页](https://api-docs.deepseek.com/quick_start/pricing)得到的,单位是美元每百万 token。DeepSeek 现在分高峰和非高峰时段,非高峰价格是高峰的一半;输入还分缓存命中和未命中。我们的 trace 里没有记录调用发生在哪个时段,也没有区分缓存命中的 token,所以统一按「高峰、缓存未命中」算,这是一个偏保守(偏贵)的估计。这个口径要写进 README,别让人以为这是账单上的精确数字。

`fill_costs` 只补 `cost_usd is None` 的步骤,Langfuse 自己算好的成本不动。价格表用 `lru_cache` 缓存,改了 `prices.json` 要重启服务。价格表的路径可以用环境变量 `LOUPE_PRICES` 换掉,方便你放自己的模型。

## 接口

```python
# agent-loupe/server/loupe/app.py
import os

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from loupe import db
from loupe.importers import import_any
from loupe.pricing import fill_costs

MAX_UPLOAD_BYTES = int(os.environ.get("LOUPE_MAX_UPLOAD_MB", "200")) * 1024 * 1024


def create_app(db_path: str | None = None) -> FastAPI:
    """用 uvicorn 的 --factory 启动:uv run uvicorn loupe.app:create_app --factory --reload"""
    app = FastAPI(title="Agent Loupe")
    app.add_middleware(  # 开发时前端跑在 5173,后端在 8000
        CORSMiddleware, allow_origins=os.environ.get("LOUPE_CORS", "http://localhost:5173").split(","),
        allow_methods=["*"], allow_headers=["*"],
    )
    conn = db.connect(db_path or os.environ.get("LOUPE_DB", "loupe.db"))
    app.state.conn = conn

    @app.post("/api/import")
    async def import_trace(file: UploadFile = File(...)) -> dict:
        raw = await file.read(MAX_UPLOAD_BYTES + 1)
        if len(raw) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, f"文件超过 {MAX_UPLOAD_BYTES // 1024 // 1024} MB")
        try:
            traces = import_any(raw.decode("utf-8"))
        except (ValueError, KeyError) as e:  # 格式认不出、缺字段:告诉用户是哪里不对
            raise HTTPException(400, f"导入失败: {e}") from e
        ids = []
        for t in traces:
            t = fill_costs(t)
            db.save_trace(conn, t)
            ids.append({"id": t.run.id, "name": t.run.name, "steps": len(t.steps)})
        return {"imported": ids}

    @app.get("/api/runs")
    def list_runs(tag: str | None = None, status: str | None = None, q: str | None = None,
                  cursor: str | None = None, limit: int = Query(50, ge=1, le=200)) -> dict:
        try:
            return db.list_runs(conn, tag=tag, status=status, q=q, cursor=cursor, limit=limit)
        except ValueError as e:  # 游标被篡改或截断
            raise HTTPException(400, "cursor 无效") from e

    @app.get("/api/runs/{run_id}")
    def get_run(run_id: str) -> dict:
        run = db.get_run(conn, run_id)
        if run is None:
            raise HTTPException(404, "run 不存在")
        return run

    @app.get("/api/runs/{run_id}/steps")
    def get_steps(run_id: str, from_: int = Query(0, alias="from", ge=0),
                  limit: int = Query(500, ge=1, le=5000), full: bool = False) -> dict:
        run = db.get_run(conn, run_id)
        if run is None:
            raise HTTPException(404, "run 不存在")
        steps = db.get_steps(conn, run_id, start=from_, limit=limit, full=full)
        last = steps[-1]["idx"] if steps else None
        next_from = last + 1 if last is not None and last + 1 < run["step_count"] else None
        return {"steps": steps, "next_from": next_from, "total": run["step_count"]}

    @app.get("/api/runs/{run_id}/steps/{idx}")
    def get_step(run_id: str, idx: int) -> dict:
        step = db.get_step(conn, run_id, idx)
        if step is None:
            raise HTTPException(404, "step 不存在")
        return step

    return app
```

几个细节。

**用工厂函数创建应用**。`create_app(db_path)` 而不是模块级的 `app = FastAPI()`,测试时每个用例可以传一个临时数据库路径,互不干扰。启动时用 uvicorn 的 `--factory` 参数:

```bash
cd server
uv run uvicorn loupe.app:create_app --factory --reload --port 8000
```

**上传大小限制**。`file.read(MAX_UPLOAD_BYTES + 1)` 最多读上限加一个字节,读满了说明文件超限,返回 413。不加限制的话,有人传一个几 GB 的文件,服务直接被内存撑爆。Day 119 公开部署时这个值要调小。

**错误分级**。格式认不出、缺字段,这是用户的问题,返回 400 加一句说人话的原因;游标被篡改也是 400;找不到运行是 404。其他异常让 FastAPI 返回 500,那是我们的 bug。前端会把 `detail` 直接显示给用户,所以 detail 要写成用户看得懂的话。

**CORS**。开发时前端在 5173 端口,后端在 8000,浏览器认为这是两个源。其实 Day 114 我们会让 Vite 把 `/api` 转发给后端,前端看到的是同源,用不到 CORS;这里先配上,是为了你直接用浏览器打开 `http://localhost:5173` 以外的地方调试接口时不被挡。允许的源用环境变量配置,别写 `*`。

## 一个连接,多个线程

`create_app` 里只创建了一个 SQLite 连接,所有请求共用它,而且连接时传了 `check_same_thread=False`。这一点值得停下来想一想,因为它看起来像是在关掉一个安全检查。

FastAPI 里用 `def`(不是 `async def`)写的接口,会被放进一个线程池里执行。也就是说,两个请求同时到来时,可能有两个线程同时在用这个连接。Python 的 sqlite3 模块默认不允许在创建连接以外的线程使用它,就是为了防止这种情况;`check_same_thread=False` 关掉的正是这个检查。

关掉安不安全,取决于 SQLite 库编译时的线程模式。Python 3.11 起,`sqlite3.threadsafety` 会如实报告这个值。我这里用 uv 装的 Python 3.12 打印出来是 3,对应 SQLite 的 serialized 模式:库内部对每个连接加了互斥锁,多个线程共用一个连接不会把内部状态弄坏。你可以自己验证一下:

```bash
uv run python -c "import sqlite3; print(sqlite3.threadsafety, sqlite3.sqlite_version)"
```

如果你的环境打印出来是 1,就不要共用连接,改成每个请求打开一个连接(SQLite 打开连接很便宜),或者给连接包一把 `threading.Lock`。

即使是 3,也还有一个逻辑上的问题:事务是连接级别的。导入请求正在 `with conn:` 里插一万步时,另一个线程用同一个连接执行的查询,会落在同一个事务里,能看到还没提交的一半数据。对我们这个单人工具,这个窗口只有一秒多,而且只影响刚好在导入时刷新列表的人,我选择接受,写进已知限制。要彻底解决,就是上面说的每个请求一个连接,配合 WAL 模式,读请求看到的永远是已提交的数据。Day 119 公开部署前我们会再评估一次。

## 用 curl 走一遍,顺便实测

服务起来以后,导入三个样例:

```bash
for f in day09_cities.jsonl synthetic_small.jsonl synthetic_10k.jsonl; do
  curl -s -F file=@../samples/$f http://127.0.0.1:8000/api/import; echo
done
```

```text
{"imported":[{"id":"a0d55b7ecb94","name":"day09-cities","steps":10}]}
{"imported":[{"id":"syn30","name":"synthetic-30","steps":30}]}
{"imported":[{"id":"syn10000","name":"synthetic-10000","steps":10000}]}
```

再看看一万步的数据导入和查询要多久。`curl -w` 能打印请求耗时和响应大小:

```bash
curl -s -o /dev/null -w "import10k %{http_code} %{time_total}s\n" \
  -F file=@../samples/synthetic_10k.jsonl http://127.0.0.1:8000/api/import
curl -s -o /dev/null -w "500 步 轻 %{time_total}s %{size_download}B\n" \
  "http://127.0.0.1:8000/api/runs/syn10000/steps?limit=500"
curl -s -o /dev/null -w "5000 步 轻 %{time_total}s %{size_download}B\n" \
  "http://127.0.0.1:8000/api/runs/syn10000/steps?limit=5000"
curl -s -o /dev/null -w "500 步 完整 %{time_total}s %{size_download}B\n" \
  "http://127.0.0.1:8000/api/runs/syn10000/steps?limit=500&full=true"
```

我在 2019 款 13 寸 Intel MacBook Pro(i7-8569U)上跑的一次结果:

| 请求 | 耗时 | 响应大小 |
| --- | --- | --- |
| 导入 1 万步(19 MB 文件) | 1.40 秒 | |
| 500 步,轻 | 0.011 秒 | 133 KB |
| 5000 步,轻 | 0.046 秒 | 1.34 MB |
| 500 步,完整 | 0.045 秒 | 898 KB |

只跑了一次,数字会有波动,看量级就好。几个结论:一万步的导入一秒多,可以接受,不需要做成后台任务;同样 500 步,完整版的体积是轻版的将近 7 倍,一万步全量完整加载会到十几 MB,轻版只要两三 MB,所以「默认轻、点开再取」这个设计是值得的;5000 步一页的轻数据不到 50 毫秒,前端一次取 5000 步、两次取完一万步是合理的。导入后的数据库文件是 19.8 MB,和原始文件差不多大。

你的机器上数字会不一样,把你测的结果记进 `docs/perf.md`,写清楚机器型号,Day 119 要用。

## 动手练习

**练习 1:写测试,跑通。** `server/tests/test_api.py`:

```python
# agent-loupe/server/tests/test_api.py
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from loupe.app import create_app

SAMPLES = Path(__file__).parents[2] / "samples"


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(str(tmp_path / "test.db")))


def upload(client, path: Path):
    return client.post("/api/import", files={"file": (path.name, path.read_bytes())})


def test_import_and_fetch(client):
    r = upload(client, SAMPLES / "day09_cities.jsonl")
    assert r.status_code == 200
    [run] = r.json()["imported"]
    detail = client.get(f"/api/runs/{run['id']}").json()
    assert detail["step_count"] == run["steps"]
    assert detail["total_cost_usd"] > 0  # SDK 不记成本,导入时按 prices.json 补上
    light = client.get(f"/api/runs/{run['id']}/steps").json()
    assert "input" not in light["steps"][0]  # 默认不带大字段
    full = client.get(f"/api/runs/{run['id']}/steps/1").json()
    assert full["kind"] == "llm" and full["input"]["messages"][0]["role"] == "system"


def test_steps_pagination(client):
    [run] = upload(client, SAMPLES / "synthetic_small.jsonl").json()["imported"]
    page1 = client.get(f"/api/runs/{run['id']}/steps", params={"limit": 20}).json()
    assert len(page1["steps"]) == 20 and page1["next_from"] == 20 and page1["total"] == 30
    page2 = client.get(f"/api/runs/{run['id']}/steps", params={"from": 20, "limit": 20}).json()
    assert [s["idx"] for s in page2["steps"]] == list(range(20, 30)) and page2["next_from"] is None


def test_runs_cursor_and_filters(client):
    upload(client, SAMPLES / "day09_cities.jsonl")
    upload(client, SAMPLES / "synthetic_small.jsonl")
    first = client.get("/api/runs", params={"limit": 1}).json()
    assert len(first["items"]) == 1 and first["next_cursor"]
    second = client.get("/api/runs", params={"limit": 1, "cursor": first["next_cursor"]}).json()
    assert second["items"][0]["id"] != first["items"][0]["id"] and second["next_cursor"] is None
    assert [r["name"] for r in client.get("/api/runs", params={"tag": "synthetic"}).json()["items"]] == ["synthetic-30"]
    assert client.get("/api/runs", params={"q": "cities"}).json()["items"][0]["name"] == "day09-cities"
    assert client.get("/api/runs", params={"cursor": "garbage"}).status_code == 400


def test_bad_file_gives_400(client):
    r = client.post("/api/import", files={"file": ("x.json", b'{"hello": 1}')})
    assert r.status_code == 400 and "认不出格式" in r.json()["detail"]


def test_reimport_overwrites(client):
    upload(client, SAMPLES / "synthetic_small.jsonl")
    upload(client, SAMPLES / "synthetic_small.jsonl")
    assert len(client.get("/api/runs").json()["items"]) == 1
```

测试用 FastAPI 的 `TestClient`,它不用真的启动服务器就能发请求。我这里加上昨天的导入器测试一共是:

```text
11 passed, 1 warning
```

那个 warning 是 Starlette 提示它的 TestClient 以后会换一个底层 HTTP 库,和我们的代码无关,不影响测试结果。等 FastAPI 和 Starlette 的升级说明出来再按说明改。

几个测试值得看一眼它在证明什么:`test_import_and_fetch` 证明 SDK 的 trace 导入后成本被补上了,并且默认的步骤列表里没有 `input`;`test_steps_pagination` 证明分页的边界(最后一页 `next_from` 是 null);`test_runs_cursor_and_filters` 证明游标翻页不重复,也证明被篡改的游标返回 400;`test_reimport_overwrites` 证明重复导入是覆盖。

**练习 2:实测你自己的数字。** 按上一节的 curl 命令测一遍,填进 `docs/perf.md`。再加一行:把 `limit` 改成 10000、`full=true`,一次取完一万步的完整内容,记下耗时和大小。这个数字就是「如果不做轻重分离」的代价。

**练习 3:给步骤加一个按名字筛选的参数。** 给 `GET /api/runs/{id}/steps` 加一个可选的 `name` 参数,只返回名字等于它的步骤(比如只看所有 `get_weather`)。注意这时 `next_from` 的逻辑要怎么改,写一个测试。

<details><summary>参考思路</summary>

在 `get_steps` 的 SQL 里加 `AND name = ?`。`next_from` 不能再用「最后一步的 idx 加一是否小于 step_count」来判断还有没有下一页,因为筛选后的总数不是 step_count;改成和列表一样多取一条:取 `limit + 1` 条,多出来了就说明有下一页,`next_from` 是第 limit 条的 idx 加一。顺便想一想:要不要给 `(run_id, name)` 建索引?一条运行最多几万步,主键范围扫描已经很快,先不建,测出来慢了再说。

</details>

**验收标准**:`uv run pytest -q` 全部通过;`uv run uvicorn loupe.app:create_app --factory` 能启动,curl 能完成导入、列表、翻页、取单步;`docs/perf.md` 里有你机器上的实测数字和机器型号;练习 3 有测试。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 游标分页(cursor / keyset pagination) | 用上一页最后一条的排序键作为下一页的起点,而不是跳过若干行 |
| OFFSET 分页 | `LIMIT n OFFSET m`,跳过 m 行取 n 行;越往后越慢,翻页期间数据变化会重复或遗漏 |
| 行值比较 | `(a, b) < (x, y)` 的写法,按字典序比较多列 |
| 冗余字段 | 能从别的数据算出来、但为了查询方便多存一份的字段,比如 step_count |
| 事务 | 一组数据库操作要么全部生效、要么全部不生效 |
| WAL | SQLite 的预写日志模式,读写可以并发 |
| 级联删除 | 删除父记录时自动删除引用它的子记录 |
| 工厂函数 | 每次调用创建一个新应用实例的函数,方便测试注入不同配置 |
| TestClient | FastAPI 提供的测试客户端,不启动服务器就能调用接口 |
| CORS | 浏览器的跨源资源共享规则,决定一个源的页面能不能请求另一个源的接口 |
| serialized 模式 | SQLite 的一种线程模式,库内部给连接加锁,多线程共用一个连接也不会损坏内部状态 |

## 常见误区

**列表用 OFFSET 分页,觉得数据少无所谓。** 慢只是一个问题,更隐蔽的是翻页期间新导入一条数据就会出现重复。调试工具里「刚导入一条、马上去列表找」是最常见的操作。

**游标只用时间戳。** 时间相同的记录会被跳过。合成数据、批量导入、精度只到秒的时间,都会制造大量相同时间。加上唯一 ID 做第二排序键。

**导入不放事务里。** 中途出错会留下半条数据,`step_count` 和实际步数对不上,前端加载到一半就停。这类 bug 极难复现。

**SQLite 默认就检查外键。** 不会。每个连接都要 `PRAGMA foreign_keys = ON`,否则级联删除也不生效。

**把估算的成本当账单。** 价格分时段、分缓存命中,trace 里没有这些信息。界面和 README 要说明口径,并写清价格查证的日期和出处。

**接口什么错误都返回 500。** 用户上传了一个不认识的文件,这是 400,并且要告诉他支持哪几种格式。500 留给真正的程序 bug。

## 学习资料

### 文档与文章

- [FastAPI 官方教程](https://fastapi.tiangolo.com/tutorial/):今天用到的部分是「Request Files」和「Query Parameters」两节,文件上传和带别名的查询参数(我们的 `from` 是 Python 关键字,所以用了 `alias`),30 分钟。
- [SQLite:Row Values](https://www.sqlite.org/rowvalue.html):行值比较的官方说明,里面正好有一个用它做分页的例子,15 分钟。
- [SQLite:Write-Ahead Logging](https://www.sqlite.org/wal.html):WAL 模式的原理和限制(比如不适合网络文件系统),20 分钟。
- [Use The Index, Luke:No Offset](https://use-the-index-luke.com/no-offset):Markus Winand 讲为什么不该用 OFFSET 分页,以及 keyset 分页怎么写、怎么建索引,数据库无关,20 分钟。
- [DeepSeek 定价](https://api-docs.deepseek.com/quick_start/pricing):价格表的出处,注意高峰和非高峰时段的划分,5 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1iu4y1a7Bp&autoplay=0&high_quality=1" title="MySQL中的分页方法:偏移量 vs. 游标分页" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>沃趣Squids数据库平台 · MySQL中的分页方法:偏移量 vs. 游标分页 · 13 分钟,用 MySQL 演示,原理和 SQLite 完全一样。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV18F4m1K7N3&autoplay=0&high_quality=1" title="【程序员科科】1小时精通Python的FastAPI框架的所有知识点" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员科科 · 1小时精通Python的FastAPI框架的所有知识点 · 68 分钟,FastAPI 忘得差不多了就从头看,只想补文件上传的话拖到讲请求体和表单的部分。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/zwDIN04lIpc" title="Pagination in MySQL - offset vs. cursor" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>PlanetScale · Pagination in MySQL - offset vs. cursor · 13 分钟,把「为什么要第二排序键」讲得很清楚,和今天的 (started_at, id) 一一对应。</figcaption>
</figure>

### 书籍

- **Designing Data-Intensive Applications**,Martin Kleppmann,O'Reilly。第 3 章讲存储与检索,B 树索引那部分能帮你理解为什么「索引顺序和 ORDER BY 一致」时查询最快,约 1 小时。
- **SQL Performance Explained**,Markus Winand,2012(上面那个 Use The Index, Luke 网站就是这本书的在线版)。读讲分页(partial results)的那一章,约 30 分钟。

### 开源项目与代码

- [fastapi/fastapi](https://github.com/fastapi/fastapi):翻 `docs_src/request_files/` 下的示例,和我们的上传接口对照。
- [langfuse/langfuse](https://github.com/langfuse/langfuse):看它的公开 API 怎么做分页(observations v2 接口用的是游标),和我们的选择对照。

## 自测

1. 列表查询为什么要 `LIMIT limit + 1`?

<details><summary>答案</summary>

多取一条用来判断还有没有下一页:取到了 limit+1 条说明后面还有,第 limit 条做成游标返回;不够 limit+1 条说明这是最后一页,next_cursor 为 null。这样不用额外跑一次 COUNT 查询。

</details>

2. 游标为什么是 `(started_at, id)` 两个字段,而不是只用 `started_at`?

<details><summary>答案</summary>

开始时间可能相同。只用时间的话,条件 `started_at < X` 会把和上一页最后一条同一时刻的其他记录全部跳过。加上唯一的 id 做第二排序键,排序变成严格全序,翻页不重不漏。

</details>

3. 步骤接口默认不返回 input 和 output,依据是什么?你实测的差距是多少?

<details><summary>答案</summary>

时间轴只需要名字、时间、类型、错误、token,而 llm 步的 input 是完整的 messages,很大。我实测同样 500 步,完整版 898 KB,轻版 133 KB,差将近 7 倍;一万步全量完整加载会到十几 MB。点开某一步时再单独取,首屏快、内存省。(你的数字以自己实测为准。)

</details>

4. 导入时先 `DELETE` 再 `INSERT`,如果这两步之间程序崩了会怎样?

<details><summary>答案</summary>

不会出问题,因为它们在同一个事务里。崩溃时事务没有提交,数据库回到导入前的状态,旧数据还在。只有整个代码块正常结束,删除和插入才一起生效。

</details>

5. 资深面试题:现在这个后端是单进程 + SQLite。如果要支持一个 20 人的团队共用,同时导入、同时浏览,你会改哪些地方?按优先级说。

<details><summary>答案</summary>

先确认瓶颈再改。第一,数据库换 Postgres:多进程同时写 SQLite 会碰到写锁,而且团队部署通常在容器里,本地文件不可靠;因为访问都封装在 db.py,换实现的范围可控。第二,大文件导入改成异步任务:上传后返回任务 ID,后台解析入库,前端轮询进度,避免请求超时和阻塞 worker。第三,加身份和权限:至少要知道谁导入的、按项目隔离。第四,trace 原始文件放对象存储,数据库只存解析后的数据和文件指针。第五才是性能优化,比如步骤表按 run 分区。这些都和非目标里的「不做多用户」冲突,所以要先回到 PRD 问:是不是真的要做这个方向。

</details>

6. 价格表里的成本,和你实际的 DeepSeek 账单会一致吗?为什么?

<details><summary>答案</summary>

不一致,一般偏高。价格表按高峰时段、缓存未命中的价格计算,而实际有一部分调用发生在非高峰时段(半价),一部分输入命中了缓存(便宜很多)。trace 里没有记录这两样信息,所以只能给一个偏保守的估计,并在界面和 README 里写明口径。

</details>

## 明天预告

后端的五个接口都通了。明天(Day 114)开始写前端:**React 时间轴与一万步的渲染性能**。Vite + React + TypeScript 起项目,运行列表页,步骤树加瀑布时间轴,用虚拟滚动让一万步也能顺畅滚动,再学会用 Chrome 的 Performance 面板测量它到底卡不卡。
