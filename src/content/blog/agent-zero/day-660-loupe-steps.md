---
title: 'Day 660 · Loupe(八):分段加载、轻步骤、价格表、接口和多线程连接'
description: '把后端剩下的部分做完:步骤按段读取并默认只返回不带大字段的轻步骤,实测一万步里轻重差了 6 倍多;按价格表给没有成本的模型调用补上成本并写明口径;把六个接口接进 FastAPI 并区分 400、404、413;最后实测一个 SQLite 连接被多个线程共用会让读的人看到写到一半的数据,改成每个请求一个连接。'
pubDate: 2026-10-27
regime: none
tags: ['agent-loupe', 'fastapi', 'sqlite', 'pricing', 'agent-zero']
series: 'agent-zero'
day: 660
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 659](/blog/agent-zero/day-659-loupe-ingest/) 把 `save_trace` 包进了一个事务,让导入要么全进要么全不进,重复导入同一个 id 变成覆盖,失败时旧版本原样保留;又写了 `list_runs` 的游标分页,实测翻页途中新插入一条数据时 `OFFSET` 会重复、游标不会,游标里要同时放 `started_at` 和 `id`。到这里 `db.py` 能存、能列、能按 id 取一条运行。

今天把后端补完:读步骤、补成本、接成六个接口,再回答 Day 658 留下的一个问题:`check_same_thread=False` 到底在关掉什么。

## 今天要解决的问题

学完今天,你应该能做到:

1. 写出步骤的分段读取 `get_steps`,说清为什么默认返回不带 `input` 和 `output` 的「轻」步骤,并能用自己机器上的实测数字支持这个设计。
2. 写出 `prices.json` 和 `fill_costs`,按价格表给没有成本的 llm 步补上成本,并说出这个数字的口径和它不是什么。
3. 写出六个接口,让用户的错误返回 400、找不到返回 404、文件太大返回 413,`curl` 能走通导入、列表、翻页、取单步,并有一组接口测试。
4. 用实测解释 SQLite 连接被多个线程共用时会发生什么,并改成每个请求一个连接。

预计用时 3.5 小时(今天偏重,建议分两次做)。今天不调模型,花费 0。

前置:[Day 659](/blog/agent-zero/day-659-loupe-ingest/)(`save_trace`、`list_runs`、`get_run`、`mismatched_counts`)、[Day 658](/blog/agent-zero/day-658-loupe-schema/)(表、`connect`)、[Day 79](/blog/agent-zero/day-079-fastapi-1/) 到 [Day 81](/blog/agent-zero/day-081-fastapi-3/)(FastAPI 的路由、查询参数、错误处理、依赖注入)、[Day 656](/blog/agent-zero/day-656-loupe-detect/)(`import_any`、`ImportFormatError`)。

学法提示:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `get_steps` 和 `fill_costs` 默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 步骤的分段读取

前端的时间轴要画一条运行的所有步骤,最多一万步。一次全取回来,有两个问题:数据太大(下面实测);用户可能只想看第 9000 步附近。所以接口设计成「从第 `from` 步开始取 `limit` 步」,前端按需一段一段拉。

Day 652 约定过 `idx` 是从 0 开始连续的整数,导入以后不会变,所以 `idx >= from` 本身就是一个天然的游标,不需要像运行列表那样编码。下面是 `db.py` 续写的部分:

```python
# agent-loupe/server/loupe/db.py(Day 660 版,续)
LIGHT_COLS = ("run_id, idx, parent_idx, kind, name, started_at, ended_at, error, "
              "input_tokens, output_tokens, cost_usd, model")


def get_steps(conn: sqlite3.Connection, run_id: str, *, start: int = 0, limit: int = 500,
              full: bool = False) -> list[dict[str, Any]]:
    """从第 start 步起取最多 limit 步。默认「轻」:不带 input 和 output 这两个大字段。"""
    cols = "*" if full else LIGHT_COLS
    rows = conn.execute(
        f"SELECT {cols} FROM steps WHERE run_id = ? AND idx >= ? ORDER BY idx LIMIT ?",
        (run_id, start, limit),
    ).fetchall()
    out: list[dict[str, Any]] = []
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
    """整条读回成 Trace 对象。Day 667 以后的对比、重跑和评测都从这里拿数据。"""
    run = get_run(conn, run_id)
    if run is None:
        return None
    run.pop("step_count")  # Run 模型没有这个字段,它是库里的冗余列
    steps = get_steps(conn, run_id, limit=1_000_000, full=True)
    return Trace(run=Run.model_validate(run), steps=[Step.model_validate(s) for s in steps])
```

<div class="line-notes">

- `LIGHT_COLS = (` 「轻」步骤要的 12 个列:定位(`run_id`、`idx`、`parent_idx`)、画时间轴要的(`kind`、`name`、两个时间)、列表上要显示的(`error`、两个 token 数、`cost_usd`、`model`)。**唯独没有 `input` 和 `output`**。这是一个字符串常量,文件开头多次要用。
- `def get_steps(conn: sqlite3.Connection, run_id: str, *, start: int = 0,` `*` 之后都是关键字参数:`get_steps(conn, "syn10000", start=500, limit=500)`。`start` 默认 0,`limit` 默认 500。
- `cols = "*" if full else LIGHT_COLS` `full=True` 取所有列,否则只取轻的。这里的 `cols` 是我们自己写死的常量,不是用户传的,所以拼进 SQL 字符串是安全的。**用户传的值**(`run_id`、`start`)一律走 `?`。
- `f"SELECT {cols} FROM steps WHERE run_id = ? AND idx >= ? ORDER BY idx LIMIT ?",` 这条查询在 Day 658 的 `EXPLAIN` 里看过:`SEARCH steps USING INDEX sqlite_autoindex_steps_1 (run_id=? AND idx>?)`,主键索引本身就按这个顺序排,不需要临时排序。代入 `start=500, limit=500`,取 `idx` 从 500 到 999 的 500 行。
- `(run_id, start, limit),` 三个值按顺序对应三个 `?`。
- `out: list[dict[str, Any]] = []` 先建一个空列表装结果。
- `d = dict(row)` `sqlite3.Row` 转成可以改的字典。
- `if full:` 只有取完整版才需要把 `input`、`output` 从 JSON 文本解回对象。轻版里压根没有这两个键。
- `d["input"] = json.loads(d["input"]) if d["input"] is not None else None` 库里存的是文本,比如 `'{"messages": [...]}'`,解回字典;`NULL` 保持 `None`。`json.loads` ≈ JS 的 `JSON.parse`。
- `d["output"] = json.loads(d["output"]) if d["output"] is not None else None` 同上。注意 Day 658 存的时候是 `json.dumps(s.input)`:`None` 会存成字符串 `'null'` 而不是 SQL 的 `NULL`,所以解回来也是 `None`。
- `def get_step(` 取单步:复用 `get_steps`,`start=idx, limit=1, full=True`。
- `rows = get_steps(conn, run_id, start=idx, limit=1, full=True)` 从 `idx` 开始取 1 行。如果 `idx` 超出范围,会取到下一个存在的步骤或者空,所以下一行要核对。
- `return rows[0] if rows and rows[0]["idx"] == idx else None` 取到的那一行的 `idx` 必须正好等于要的,否则返回 `None`(接口层变 404)。例如这条运行只有 6 步,要第 99 步,查出来是空列表。
- `def load_trace(` 把整条运行读回成 `Trace` 对象。今天的接口不用它,但 Day 667 的对比、Day 669 的重跑、Day 672 的评测都要从库里拿到完整的 `Trace`,所以今天先写好。
- `run.pop("step_count")` `get_run` 返回的字典里有冗余列 `step_count`,而 `Run` 模型没有这个字段,留着会让 pydantic 报「多余字段」或悄悄忽略,所以先删掉。`pop` 删除并返回这个键。
- `steps = get_steps(conn, run_id, limit=1_000_000, full=True)` 取所有步骤的完整版。一百万是「足够大」的上限,`1_000_000` 里的下划线只是方便读数。
- `return Trace(run=Run.model_validate(run), steps=[Step.model_validate(s) for s in steps])` `model_validate` 把字典变成带校验的模型。时间文本会被解析成 `datetime`,再经过 `UtcDatetime` 转成 UTC。

</div>

`get_step` 单独存在是因为前端的用法:时间轴上先拉一整条轻步骤,用户点开某一步,再取那一步的完整内容。一步完整内容(含上下文 messages)我实测 3.6 KB 到几十 KB 不等,一次请求,不到 10 毫秒。

### 轻和重差多少

「默认轻」是我在 Day 651 PRD 里先拍的设计,今天用真实数字验证它值不值。数据是 Day 656 的一万步合成数据(`syn10000`),服务起来以后用 `curl -w` 测,每个请求跑了三次(下面「接口」一节教你怎么起服务):

```text
请求                           耗时(三次的范围)    响应大小
500 步,轻                     0.012 秒            133 KB
500 步,完整                   0.031 到 0.034 秒   878 KB
5000 步,轻                    0.045 到 0.072 秒   1.34 MB
5000 步,完整                  0.30 到 0.37 秒     8.9 MB
单独一步(idx=9000)            0.007 秒            3.6 KB
```

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="一万步合成数据里,取 5000 步的响应大小:轻步骤 1.34 MB,完整步骤 8.9 MB;取 500 步:轻 133 KB,完整 878 KB">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">响应大小(同样的步骤数)</text>
  <text x="20" y="62" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">5000 步 轻</text>
  <rect x="120" y="50" width="60" height="18" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="190" y="63" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">1.34 MB</text>
  <text x="20" y="92" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">5000 步 完整</text>
  <rect x="120" y="80" width="400" height="18" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="528" y="93" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">8.9 MB</text>
  <text x="20" y="142" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">500 步 轻</text>
  <rect x="120" y="130" width="6" height="18" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="136" y="143" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">133 KB</text>
  <text x="20" y="172" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">500 步 完整</text>
  <rect x="120" y="160" width="39" height="18" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="169" y="173" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">878 KB</text>
  <text x="320" y="210" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">两组的柱子按各自的比例画,完整版都是轻版的约 6.6 倍</text>
</svg>
<figcaption>同样的步骤数,带上 input 和 output 之后体积涨 6.6 倍。一万步全量完整加载是 17 MB 以上。</figcaption>
</figure>

500 步:878 KB 对 133 KB,6.6 倍;5000 步:8,895,382 字节对 1,336,636 字节,也是 6.7 倍。比例稳定,因为合成数据里每个 llm 步的 `input` 都带着一份截到 40 条以内的 messages。一万步全量完整加载就是 17 MB 多,耗时 0.6 秒左右(两次 5000 步各 0.3 秒),在本机回环上就这样,真走网络会更慢。轻版一次取 5000 步不到 1.4 MB、不到 0.1 秒,两次取完一万步,首屏可以先画。

**这组数字有两个局限。** 一是数据是我造的:真实 Agent 的 `input` 里有几十 KB 的检索结果和工具返回,比例可能更悬殊;也可能有的 Agent 上下文很短,差别没这么大。二是都在本机回环(`127.0.0.1`)上测的,没有网络延迟和带宽的影响。把它理解成「设计有依据」,别当成通用结论。你要在自己机器上测一遍,这是练习 2。

`load_trace` 有一个约定需要测试守住:存进库再读回来,必须和原来的 `Trace` 完全相等。后面几天的对比和重跑都在这个前提上,下面「接口测试」里有。

## 价格表和成本

Loupe 要显示每次模型调用和整条运行花了多少钱。可数据里常常没有:我们自己的 SDK 只记 token 不记钱;OTLP 的 GenAI 约定里没有成本字段;只有 Langfuse 导出的数据可能带着它算好的成本,而且如果它不认识模型名(比如 Day 655 说的 `deepseek-flash`)就是 `null`。所以导入时要按价格表补上。

价格放在一个单独的 JSON 文件里,不写进代码,换模型或价格变了只改它:

```json
{
  "_note": "美元 / 百万 token。2026-10-27 查 https://api-docs.deepseek.com/quick_start/pricing 。DeepSeek 分高峰(UTC 01-04 点和 06-10 点,工作日)和非高峰,非高峰是高峰的一半;输入还分缓存命中和未命中。trace 里没有这两样信息,所以统一按「高峰、缓存未命中」算,是偏贵的估计。换模型或价格变了就改这里。",
  "deepseek-flash": {"input": 0.30, "output": 1.20},
  "deepseek-v4-pro": {"input": 1.32, "output": 3.96}
}
```

价格我是 2026 年 10 月 27 日当场查的官方定价页,flash 高峰价输入缓存未命中每百万 token 0.30 美元,输出 1.20 美元;非高峰是它的一半。页面写「美元」符号,但没有明确写货币名,所以我按美元记,你用的时候再核对一遍。价格会变,你读到这里时可能已经不一样,所以 `_note` 里必须写查证的日期和出处。

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
    """llm 步没带成本的,按价格表补上;带了的(比如 Langfuse 算好的)不动;不认识的模型跳过,不报错。"""
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

<div class="line-notes">

- `PRICES_FILE = Path(os.environ.get("LOUPE_PRICES", Path(__file__).parents[1] / "prices.json"))` 价格表的位置:先看环境变量 `LOUPE_PRICES`,没设就用默认位置。`Path(__file__).parents[1]` 是这个文件所在目录(`loupe/`)的上一级,也就是 `server/`,所以默认是 `server/prices.json`。Day 675 部署时会用环境变量换成别的文件。
- `@lru_cache` 缓存函数的返回值:第一次调用读文件,以后直接返回内存里的结果,不再读磁盘。代价是改了 `prices.json` 要重启服务才生效。
- `def load_prices() -> dict[str, dict[str, float]]:` 返回形如 `{"deepseek-flash": {"input": 0.3, "output": 1.2}}` 的字典。
- `raw = json.loads(PRICES_FILE.read_text(encoding="utf-8"))` 读文件、解析 JSON。
- `return {k: v for k, v in raw.items() if not k.startswith("_")}` 字典推导,过滤掉以下划线开头的键。JSON 不允许写注释,所以用 `_note` 这个键当注释,读的时候扔掉。
- `def fill_costs(trace: Trace) -> Trace:` 输入一条 `Trace`,返回一条新的。**不修改传进来的对象**(测试里有一个断言专门守这一点)。
- `prices = load_prices()` 拿到价格表。
- `p = prices.get(s.model or "")` 按这一步的模型名查价。模型名可能是 `None`(没记),所以用 `s.model or ""`;查不到时 `.get` 返回 `None`,不会抛 `KeyError`。
- `if s.kind == "llm" and s.cost_usd is None and p and (s.input_tokens or s.output_tokens):` 四个条件都满足才补:是模型调用、没带成本、价格表里有这个模型、至少有一个 token 数。任何一个不满足就原样跳过。**不认识的模型安安静静地跳过**,这是个有代价的选择,下面讲。
- `cost = ((s.input_tokens or 0) * p["input"] + (s.output_tokens or 0) * p["output"]) / 1_000_000` 公式:输入 token 数乘输入单价,加输出 token 数乘输出单价,再除以一百万(单价是每百万 token)。代入 Day 656 那条成功的 SDK 样例第一次模型调用:输入 310、输出 106 token,`(310 × 0.30 + 106 × 1.20) / 1,000,000 = (93 + 127.2) / 1,000,000 = 0.0002202` 美元。
- `s = s.model_copy(update={"cost_usd": round(cost, 8)})` 复制这一步并写上成本,保留 8 位小数。`model_copy` 不改原对象。
- `steps.append(s)` 补了的和没补的都放进新列表。
- `total = round(sum(s.cost_usd or 0 for s in steps), 8)` 整条运行的总成本重新累加:每步的成本(`None` 当 0)相加。
- `return Trace(run=trace.run.model_copy(update={"total_cost_usd": total}), steps=steps)` 把汇总成本写回 `Run`。那条成功样例的总成本是 0.0004929 美元,约合 0.0035 元,和 Day 656 手算的「两次调用输入 799、输出 211 token」对得上:`(799 × 0.30 + 211 × 1.20) / 1,000,000 = 0.0004929`。

</div>

**这个成本是什么,不是什么。** 它是「按公开价格表、按偏贵口径估出来的数字」,不是你账单上的数。DeepSeek 分高峰和非高峰时段(非高峰半价),输入还分缓存命中和未命中(命中便宜得多),而 trace 里既没有记录调用发生在哪个时段,也没有区分缓存命中的 token,所以我统一按「高峰、缓存未命中」算,是偏保守(偏贵)的上限估计。这个口径要写进 README,界面上显示时也要有一句说明,别让人拿它去对账。

**不认识的模型为什么跳过而不是报错?** 导入一份别人的 trace,里面可能有各种我们没见过的模型,报错会让整份文件导不进来,而用户只是想看看时间轴。所以导入照常成功,这些步骤的成本留空,界面上显示「未知」。代价是你换了模型却忘了更新价格表,成本会悄悄变成 0 而没有任何提示。Day 675 要做每日花费上限,它读的就是这个数字,所以那天专门加了启动检查。练习 3 写一个小工具,把「价格表没覆盖的模型」列出来。

## 把六个接口接起来

数据层都齐了。下面是 `loupe/app.py`,Day 651 的骨架里只有 `/api/health`,今天换成工厂函数 `create_app`:

```python
# agent-loupe/server/loupe/app.py(Day 660 版)
import os
import sqlite3
from collections.abc import Iterator
from typing import Any

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from loupe import db
from loupe.importers import ImportFormatError, import_any
from loupe.pricing import fill_costs

MAX_UPLOAD_BYTES = int(os.environ.get("LOUPE_MAX_UPLOAD_MB", "200")) * 1024 * 1024


def create_app(db_path: str | None = None) -> FastAPI:
    """用 uvicorn 的 --factory 启动:uv run uvicorn loupe.app:create_app --factory --reload"""
    app = FastAPI(title="Agent Loupe")
    app.add_middleware(
        CORSMiddleware, allow_origins=os.environ.get("LOUPE_CORS", "http://localhost:5173").split(","),
        allow_methods=["*"], allow_headers=["*"],
    )
    app.state.db_path = db_path or os.environ.get("LOUPE_DB", "loupe.db")
    db.connect(app.state.db_path).close()  # 启动时建好表,再关掉;之后每个请求自己开一个连接

    def get_conn(request: Request) -> Iterator[sqlite3.Connection]:
        conn = db.connect(request.app.state.db_path)
        try:
            yield conn
        finally:
            conn.close()

    Conn = Depends(get_conn)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": "0.1.0"}

    @app.post("/api/import")
    def import_trace(file: UploadFile = File(...), conn: sqlite3.Connection = Conn) -> dict[str, Any]:
        raw = file.file.read(MAX_UPLOAD_BYTES + 1)
        if len(raw) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, f"文件超过 {MAX_UPLOAD_BYTES // 1024 // 1024} MB")
        try:
            traces = import_any(raw.decode("utf-8"))
        except (ImportFormatError, UnicodeDecodeError) as e:
            raise HTTPException(400, f"导入失败: {e}") from e
        imported = []
        for t in traces:
            t = fill_costs(t)
            db.save_trace(conn, t)
            imported.append({"id": t.run.id, "name": t.run.name, "steps": len(t.steps)})
        return {"imported": imported}

    @app.get("/api/runs")
    def list_runs(tag: str | None = None, status: str | None = None, q: str | None = None,
                  cursor: str | None = None, limit: int = Query(50, ge=1, le=200),
                  conn: sqlite3.Connection = Conn) -> dict[str, Any]:
        try:
            return db.list_runs(conn, tag=tag, status=status, q=q, cursor=cursor, limit=limit)
        except ValueError as e:  # 游标被改坏或截断
            raise HTTPException(400, "cursor 无效") from e

    @app.get("/api/runs/{run_id}")
    def get_run(run_id: str, conn: sqlite3.Connection = Conn) -> dict[str, Any]:
        run = db.get_run(conn, run_id)
        if run is None:
            raise HTTPException(404, "run 不存在")
        return run

    @app.get("/api/runs/{run_id}/steps")
    def get_steps(run_id: str, from_: int = Query(0, alias="from", ge=0),
                  limit: int = Query(500, ge=1, le=5000), full: bool = False,
                  conn: sqlite3.Connection = Conn) -> dict[str, Any]:
        run = db.get_run(conn, run_id)
        if run is None:
            raise HTTPException(404, "run 不存在")
        steps = db.get_steps(conn, run_id, start=from_, limit=limit, full=full)
        last = steps[-1]["idx"] if steps else None
        next_from = last + 1 if last is not None and last + 1 < run["step_count"] else None
        return {"steps": steps, "next_from": next_from, "total": run["step_count"]}

    @app.get("/api/runs/{run_id}/steps/{idx}")
    def get_step(run_id: str, idx: int, conn: sqlite3.Connection = Conn) -> dict[str, Any]:
        step = db.get_step(conn, run_id, idx)
        if step is None:
            raise HTTPException(404, "step 不存在")
        return step

    return app
```

<div class="line-notes">

- `MAX_UPLOAD_BYTES = int(os.environ.get("LOUPE_MAX_UPLOAD_MB", "200")) * 1024 * 1024` 上传大小上限,默认 200 MB,可以用环境变量调。代入默认值:`200 × 1024 × 1024 = 209,715,200` 字节。Day 674 的演示站会把它调小。
- `def create_app(db_path: str | None = None) -> FastAPI:` **工厂函数**:每次调用造出一个新的应用。不写成模块级的 `app = FastAPI()`,是因为测试时每个用例要传一个不同的临时数据库路径,互不干扰。启动命令里的 `--factory` 就是告诉 uvicorn「这是个函数,先调用它再用返回值」。
- `app = FastAPI(title="Agent Loupe")` 和 Day 651 一样。
- `app.add_middleware(` 加 CORS 中间件。浏览器规定一个源(协议加域名加端口)的页面不能随便请求另一个源的接口。开发时前端在 5173 端口、后端在 8000,算两个源。
- `allow_origins=os.environ.get("LOUPE_CORS", "http://localhost:5173").split(",")` 允许哪些源,从环境变量读,逗号分隔。默认只放开本机的前端。**不要写 `*`**,那等于任何网站都能让访问者的浏览器来调你的接口。Day 661 起我们让 Vite 把 `/api` 转发给后端,前端看到的是同源,CORS 就不会触发,这里是备用。
- `app.state.db_path = db_path or os.environ.get("LOUPE_DB", "loupe.db")` 数据库路径:参数优先,其次环境变量,最后默认 `loupe.db`。存在 `app.state` 上,每个请求都能取到。`app.state` 是 FastAPI 提供的一个随便往上挂东西的地方,≈ Express 的 `app.locals`。
- `db.connect(app.state.db_path).close()` 启动时开一次连接,是为了让 `connect` 里的 `executescript(SCHEMA)` 建好表,然后立刻关掉。
- `def get_conn(request: Request) -> Iterator[sqlite3.Connection]:` 一个**带 yield 的依赖**。每个请求进来,FastAPI 调用它:`yield` 之前的是准备(开连接),`yield` 出去的值交给接口函数,请求处理完(不论成功还是抛异常)再回来执行 `finally` 里的清理(关连接)。≈ Express 里 `res.on('finish', ...)` 做清理。[Day 81](/blog/agent-zero/day-081-fastapi-3/) 讲过依赖注入。
- `conn = db.connect(request.app.state.db_path)` 每个请求自己开一个新连接。连接的代价我实测了,平均 0.3 毫秒,下一节有数字。
- `yield conn` 把连接交出去。
- `conn.close()` 无论请求成功还是失败,最后都关掉,不会泄漏。
- `Conn = Depends(get_conn)` 把「依赖」这个声明存成一个变量,下面每个接口的参数里写 `conn: sqlite3.Connection = Conn`,少打几个字。
- `@app.get("/api/health")` 健康检查还保留着,Day 675 的 `smoke.py` 第一个就查它。
- `@app.post("/api/import")` 导入接口,`POST`。
- `def import_trace(file: UploadFile = File(...), conn: sqlite3.Connection = Conn)` 注意这里是 `def` 不是 `async def`,下一小节解释为什么。`UploadFile` 是 FastAPI 的上传文件类型,`File(...)` 声明它是必填的表单文件字段。
- `raw = file.file.read(MAX_UPLOAD_BYTES + 1)` 最多读「上限加 1」个字节。读满了(多出来的那 1 字节)就说明文件超限。不加限制的话,有人传一个几个 GB 的文件,服务内存直接爆掉。
- `if len(raw) > MAX_UPLOAD_BYTES:` 判断是否超限。
- `raise HTTPException(413, f"文件超过 {MAX_UPLOAD_BYTES // 1024 // 1024} MB")` 413 的意思是「请求体太大」。`//` 是整除,把字节数变回 MB。
- `traces = import_any(raw.decode("utf-8"))` 字节解码成文本,交给 Day 656 的统一入口。
- `except (ImportFormatError, UnicodeDecodeError) as e:` 两种「用户传错了文件」:格式认不出或解析失败(`ImportFormatError`),文件不是 UTF-8 文本(比如传了张图片)。这些都是用户的问题。
- `raise HTTPException(400, f"导入失败: {e}") from e` 返回 400,把原因写进 `detail`。前端会直接把 `detail` 显示给用户,所以 `ImportFormatError` 的消息要是人话,Day 656 就是这么设计的。其他意料之外的异常不抓,让 FastAPI 返回 500,那是我们的 bug。
- `for t in traces:` 一个文件里可能有多条运行(OTLP 的 JSONL 里有多个 trace),逐条处理。
- `t = fill_costs(t)` 先补成本,再存。
- `db.save_trace(conn, t)` 存库,一个事务。
- `imported.append(` 记下每条的 id、名字、步数,用来返回。
- `return {"imported": imported}` 前端据此知道导入了哪几条。
- `def list_runs(tag: str | None = None, status: str | None = None, q: str | None = None,` 查询参数全是可选的。FastAPI 看到函数参数有默认值就把它当成查询参数(`?tag=weather&status=error`)。
- `limit: int = Query(50, ge=1, le=200),` `Query` 给查询参数加约束:默认 50,最小 1,最大 200。`limit=0` 或 `limit=1000` 会被 FastAPI 自动拒绝,返回 422,不用我们写判断。
- `return db.list_runs(conn, tag=tag, status=status, q=q, cursor=cursor, limit=limit)` 直接把参数交给 Day 659 的函数。
- `except ValueError as e:  # 游标被改坏或截断` `decode_cursor` 遇到坏游标抛 `ValueError`,在这里变成 400。
- `raise HTTPException(400, "cursor 无效") from e` 400 是调用方传错了,不是我们的 bug。
- `def get_run(run_id: str, conn: sqlite3.Connection = Conn)` 路径里的 `{run_id}` 自动变成参数。
- `raise HTTPException(404, "run 不存在")` 找不到就 404。
- `def get_steps(run_id: str, from_: int = Query(0, alias="from", ge=0),` 查询参数叫 `from`,可它是 Python 的关键字,不能当变量名。`alias="from"` 让 URL 里写 `?from=500`,函数里叫 `from_`。
- `limit: int = Query(500, ge=1, le=5000), full: bool = False,` 步骤每页默认 500、最多 5000;`full` 是布尔,`?full=true` 就是真。
- `steps = db.get_steps(conn, run_id, start=from_, limit=limit, full=full)` 调用前面写好的数据层。
- `last = steps[-1]["idx"] if steps else None` 这一段最后一步的 `idx`。
- `next_from = last + 1 if last is not None and last + 1 < run["step_count"] else None` 还有下一段吗:最后一步的下一个序号小于总步数就还有,`next_from` 是下一段的起点,否则是 `None`。这里用到了 Day 658 的冗余字段 `step_count`。代入 `syn10000`、`from=0&limit=500`:`last = 499`,`next_from = 500`;`from=9500&limit=500`:`last = 9999`,`10000 < 10000` 不成立,`next_from = None`。
- `return {"steps": steps, "next_from": next_from, "total": run["step_count"]}` `total` 让前端不用另外请求就知道滚动条该多长。
- `def get_step(run_id: str, idx: int, conn: sqlite3.Connection = Conn)` 单步接口,`idx` 是路径里的整数。
- `raise HTTPException(404, "step 不存在")` 步骤序号超范围就 404。
- `return app` 工厂函数最后返回造好的应用。

</div>

启动和测试用同样的命令,只是前者在 `server/` 目录里起服务:

```bash
cd /Users/你/agent-loupe/server
uv add python-multipart
uv run uvicorn loupe.app:create_app --factory --reload --port 8000
```

**`uv add python-multipart` 这一步别漏。** 我第一次写完直接跑,`create_app` 报:

```text
RuntimeError: Form data requires "python-multipart" to be installed. 
You can install "python-multipart" with: 

pip install python-multipart
```

FastAPI 处理文件上传需要这个库,但它不会随 `fastapi` 一起装,而且报错在**创建应用时**就出现,不是在第一次上传时。照提示装上(我们用 `uv add`,不用 pip)就好了。

### 为什么导入接口写成 `def` 不是 `async def`

[Day 79](/blog/agent-zero/day-079-fastapi-1/) 说过 FastAPI 的接口 `def` 和 `async def` 都能写,当时没有区别可讲,今天有了。`async def` 的接口直接跑在事件循环里,任何耗时的同步代码(比如解析一万步的文件、写库)都会把整个服务卡住;`def` 的接口 FastAPI 会丢进线程池执行,不挡事件循环。导入一万步要一秒多,而且里面全是同步的 sqlite3 和 pydantic 代码,所以必须是 `def`。

我分别写了两个版本,实测了一下:一个请求在导入一万步的同时,另一个请求去访问 `/api/health`,看它要等多久(各试了一次,每次探测 4 次健康检查,时间是 `curl` 的 `time_total`):

```text
def 版(线程池)
  health 0.256107s
  health 0.099968s
  health 0.236146s
  health 0.009106s
async def 版
  health 1.127323s
  health 0.007111s
  health 0.007644s
  health 0.006625s
```

`async def` 版第一个健康检查等了 1.13 秒,整个服务在这一秒里什么都做不了;`def` 版最慢也只有 0.26 秒。但 `def` 版也不是完全无影响:它的几次探测是 0.1 到 0.26 秒而不是 7 毫秒,因为导入线程在大量执行 Python 代码,和处理健康检查的线程抢同一个解释器锁(GIL)。这个影响我接受,真要彻底隔开得把导入放进单独的进程,不是今天的事。只跑了一次,数字会波动,看量级。

读文件也相应改成了同步的 `file.file.read(...)`,`file.file` 是 `UploadFile` 里面真正的文件对象。`async def` 版本里读文件才用得上 `await file.read(...)`。

## 一个连接,多个线程

现在回答 Day 658 里放着的问题:`connect` 里的 `check_same_thread=False` 是什么意思、为什么要有。

Python 的 `sqlite3` 模块默认**只允许创建连接的那个线程使用它**,别的线程用就抛 `ProgrammingError: SQLite objects created in a thread can only be used in that same thread`。原因是历史上 SQLite 库在某些编译模式下不是线程安全的。我们的接口都是 `def`,FastAPI 把它们放进线程池执行,而依赖 `get_conn` 和接口函数可能不在同一个线程里,所以连接要从一个线程传给另一个线程,必须把这个检查关掉。

关掉安不安全,取决于 SQLite 库编译时的线程模式。Python 3.11 起 `sqlite3.threadsafety` 如实报告,我这里是 3,对应 SQLite 的 serialized 模式:库内部给每个连接加了锁,多个线程同时用一个连接,库自己的内部状态不会被弄坏。你的环境如果是 1,就不要共用连接。(我用的是 uv 装的 Python 3.12,SQLite 版本 3.53.1,下面这个脚本第一行会打印。)

但「库不会被弄坏」不等于「看到的数据是对的」。事务是**连接级别**的:同一个连接上,线程 A 在导入的事务里写了一半,线程 B 用同一个连接查询,会落在同一个事务里,看到线程 A 还没提交的数据。下面是这个现象的实测:一个线程导入一万步,主线程每毫秒数一次 `steps` 表的行数,记下见过的不同数字:

```python
# agent-loupe/server/scratch/s34_threads.py
"""一个连接被两个线程共用:写的线程在事务里,读的线程能看到什么?再换成每个请求一个连接。"""
import sqlite3
import tempfile
import threading
import time
from pathlib import Path

from loupe import db
from loupe.importers import import_any

SAMPLES = Path(__file__).parents[2] / "samples"
trace = import_any((SAMPLES / "synthetic_10k.jsonl").read_text(encoding="utf-8"))[0]
print("sqlite3.threadsafety =", sqlite3.threadsafety, " sqlite 版本", sqlite3.sqlite_version)


def poll(read_conn: sqlite3.Connection, write: threading.Thread) -> list[int]:
    seen: list[int] = []
    write.start()
    while write.is_alive():
        n = read_conn.execute("SELECT COUNT(*) FROM steps").fetchone()[0]
        if not seen or seen[-1] != n:
            seen.append(n)
        time.sleep(0.001)
    n = read_conn.execute("SELECT COUNT(*) FROM steps").fetchone()[0]
    if seen[-1] != n:
        seen.append(n)
    return seen


path = Path(tempfile.mkdtemp()) / "t.db"

shared = db.connect(path)  # 写和读共用同一个连接
w = threading.Thread(target=db.save_trace, args=(shared, trace))
seen = poll(shared, w)
print(f"共用一个连接,读线程看到 {len(seen)} 种步骤数:", seen[:5], "...", seen[-3:])

path2 = Path(tempfile.mkdtemp()) / "t2.db"
writer, reader = db.connect(path2), db.connect(path2)  # 各开各的连接
w = threading.Thread(target=db.save_trace, args=(writer, trace))
seen = poll(reader, w)
print(f"各用各的连接,读线程看到 {len(seen)} 种步骤数:", seen)

t = time.perf_counter()
for _ in range(100):
    db.connect(path2).close()
print(f"开一个连接再关掉:平均 {(time.perf_counter() - t) / 100 * 1000:.2f} 毫秒")
```

<div class="line-notes">

- `print("sqlite3.threadsafety =", sqlite3.threadsafety` 先把线程安全等级和 SQLite 版本打印出来,让数字有出处。
- `def poll(read_conn: sqlite3.Connection, write: threading.Thread) -> list[int]:` 一个函数:启动写线程,在它跑的时候不停地用 `read_conn` 数行数,把每次**变了的**数字记下来返回。
- `seen: list[int] = []` 见过的步骤数,按出现顺序。
- `write.start()` 启动写线程。`threading.Thread(target=函数, args=(参数,))` 是 Python 开线程的方式,≈ JS 的 Web Worker,不过线程之间共享内存。
- `while write.is_alive():` 只要写线程还没结束,就一直循环去读。
- `n = read_conn.execute("SELECT COUNT(*) FROM steps").fetchone()[0]` 数 steps 表现在有几行。
- `if not seen or seen[-1] != n:` 数字和上一次不同才记下来,避免重复。
- `time.sleep(0.001)` 睡 1 毫秒再读,不让读线程把 CPU 吃满。
- `n = read_conn.execute(` 写线程结束后再读最后一次,确保最终值也在列表里。
- `shared = db.connect(path)  # 写和读共用同一个连接` 第一种:一个连接,两个线程都用它。`path` 是临时目录里的文件。
- `w = threading.Thread(target=db.save_trace, args=(shared, trace))` 写线程做的事就是 `db.save_trace(shared, trace)`,一万步的完整导入。
- `seen = poll(shared, w)` 读线程用的是**同一个** `shared`。
- `writer, reader = db.connect(path2), db.connect(path2)  # 各开各的连接` 第二种:同一个库文件开两个连接,一个专写一个专读。
- `seen = poll(reader, w)` 读线程用 `reader`,写线程用 `writer`。
- `db.connect(path2).close()` 测开关一个连接的代价:100 次取平均。

</div>

```text
sqlite3.threadsafety = 3  sqlite 版本 3.53.1
共用一个连接,读线程看到 138 种步骤数: [0, 119, 244, 359, 513] ... [9906, 9942, 10000]
各用各的连接,读线程看到 2 种步骤数: [0, 10000]
开一个连接再关掉:平均 0.33 毫秒
```

共用一个连接时,读线程看到了 138 种不同的行数,从 0 一路涨到 10000,每一种都是导入中途的「半截数据」,比如 `step_count` 说 10000 的那条运行,此时只有 513 个步骤。各用各的连接时只有两种:0(导入前)和 10000(导入后),因为 Day 659 讲过,事务没提交时别的连接看不到,而 WAL 模式让读不阻塞写。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="共用一个连接:写线程和读线程在同一个事务里,读线程看到半截数据。每个请求一个连接:读线程看不到未提交的修改">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)" rx="6"/>
  <text x="160" y="26" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">共用一个连接</text>
  <text x="480" y="26" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">每个请求一个连接</text>
  <rect x="30" y="44" width="100" height="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="80" y="63" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">线程 A 导入</text>
  <rect x="190" y="44" width="100" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="240" y="63" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">线程 B 读列表</text>
  <rect x="90" y="112" width="140" height="40" fill="none" stroke="var(--rule)"/>
  <text x="160" y="130" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">同一个连接</text>
  <text x="160" y="145" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">同一个事务</text>
  <line x1="80" y1="74" x2="130" y2="112" stroke="var(--compute)"/>
  <line x1="240" y1="74" x2="190" y2="112" stroke="var(--mem)"/>
  <text x="160" y="190" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">B 看到 A 写到一半的数据</text>
  <text x="160" y="212" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">实测:138 种中间状态</text>
  <rect x="350" y="44" width="100" height="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="400" y="63" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">请求 A 导入</text>
  <rect x="510" y="44" width="100" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="560" y="63" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">请求 B 读列表</text>
  <rect x="350" y="112" width="100" height="40" fill="none" stroke="var(--rule)"/>
  <text x="400" y="136" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">连接 1</text>
  <rect x="510" y="112" width="100" height="40" fill="none" stroke="var(--rule)"/>
  <text x="560" y="136" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">连接 2</text>
  <line x1="400" y1="74" x2="400" y2="112" stroke="var(--compute)"/>
  <line x1="560" y1="74" x2="560" y2="112" stroke="var(--mem)"/>
  <text x="480" y="190" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">B 只看到导入前或导入后</text>
  <text x="480" y="212" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">实测:2 种状态,每次开关 0.33 毫秒</text>
</svg>
<figcaption>事务属于连接,不属于线程。共用连接就是共用事务,读的人看见写到一半的数据。</figcaption>
</figure>

所以我选了每个请求一个连接,放在上面 `get_conn` 这个依赖里。0.33 毫秒的开关代价相比任何一个接口的耗时都可以忽略,换来的是读请求永远只看到已提交的数据,而且没有连接状态需要在请求之间管理。**代价**:一个请求里不能指望「上一个请求打开的连接」,所以任何要访问库的代码都要自己 `db.connect(路径)` 或者走 `get_conn`,不能再依赖一个全局的连接对象。Day 674 的演示模式保护和后面的重跑接口,都按这个约定拿连接。

`check_same_thread=False` 仍然留着,因为 `get_conn` 创建连接的线程和接口函数运行的线程可能不是同一个。但现在每个连接**同一时刻只有一个请求在用**,这才是它安全的前提,不是「库是 serialized 的」。如果你把连接存进一个全局变量,又让多个请求共用,那就回到了上面实测的情形。

## 用 curl 走一遍

起服务(在 `server/` 目录里,数据库放到 `scratch/out/`,别污染别的):

```bash
LOUPE_DB=scratch/out/api.db uv run uvicorn loupe.app:create_app --factory --port 8000
```

另开一个终端,在 `agent-loupe/` 目录里,导入几个样例:

```bash
for f in weather_sdk.jsonl weather_otlp.jsonl synthetic_small.jsonl; do
  curl -s -F file=@samples/$f http://127.0.0.1:8000/api/import; echo
done
```

```text
{"imported":[{"id":"c70cc39b6020","name":"weather-agent","steps":6}]}
{"imported":[{"id":"51d91320d144ee7d815b7648ea5e02f6","name":"invoke_agent weather_agent","steps":6}]}
{"imported":[{"id":"syn30","name":"synthetic-30","steps":30}]}
```

`-F file=@路径` 让 `curl` 用 `multipart/form-data` 上传文件,字段名叫 `file`,对应接口里的 `file: UploadFile` 参数。再导入同一个 `synthetic_small.jsonl` 一次,返回的仍然是 `syn30`,不会报错也不会多一条(覆盖),列表里还是三条。

一万步的导入和各种读取:

```bash
curl -s -o /dev/null -w "import10k %{http_code} %{time_total}s up=%{size_upload}B\n" \
  -F file=@samples/synthetic_10k.jsonl http://127.0.0.1:8000/api/import
curl -s "http://127.0.0.1:8000/api/runs/syn10000/steps?limit=3" | head -c 700
curl -s "http://127.0.0.1:8000/api/runs?limit=2" | head -c 600
```

```text
import10k 200 1.638115s up=18695253B
{"steps":[{"run_id":"syn10000","idx":0,"parent_idx":null,"kind":"agent","name":"weather_agent","started_at":"2026-10-27T02:00:00.000000+00:00","ended_at":"2026-10-27T04:20:07.706000+00:00","error":null,"input_tokens":null,...
{"items":[{"id":"c70cc39b6020","name":"weather-agent","started_at":"2026-10-27T05:09:58.656190+00:00",...,"total_input_tokens":799,"total_output_tokens":211,"total_cost_usd":0.0004929,"tags":["weather","deepseek","sdk"],"parent_run_id":null,"forked_from_step":null,"step_count":6},...
```

导入 18.7 MB 的一万步文件花了 1.64 秒(第二次覆盖导入 1.94 秒),这包括了解析、补成本和写库,在我这台 2019 款 13 寸 Intel MacBook Pro 上,不需要做成后台任务。轻步骤里确实没有 `input`、`output`;列表里 `total_cost_usd` 是 0.0004929,正是 `fill_costs` 补出来的,SDK 的原始数据里没有这个数。列表第一条是 `c70cc39b6020`,因为它的开始时间 05:09 比另外两条晚,倒序排在最前。

几种出错的情形也各走一遍,看状态码和 `detail`:

```bash
curl -s -w "\n%{http_code}\n" "http://127.0.0.1:8000/api/runs?cursor=garbage"
curl -s -w "\n%{http_code}\n" "http://127.0.0.1:8000/api/runs/nope"
curl -s -w "\n%{http_code}\n" -F file=@samples/gen_synthetic.py http://127.0.0.1:8000/api/import
curl -s -w "\n%{http_code}\n" "http://127.0.0.1:8000/api/runs?limit=0"
```

```text
{"detail":"cursor 无效"}
400
{"detail":"run 不存在"}
404
{"detail":"导入失败: 不是 JSON,也不是一行一个 JSON(JSONL)的文件"}
400
{"detail":[{"type":"greater_than_equal","loc":["query","limit"],"msg":"Input should be greater than or equal to 1","input":"0","ctx":{"ge":1}}]}
422
```

坏游标 400、不存在的运行 404、上传了一个 Python 脚本 400 加一句说人话的原因。最后一个 `limit=0` 是 FastAPI 的参数校验替我们拦下的,返回 422(「请求格式对,但内容不合规则」),`detail` 是它自己的结构化格式,不是一句话。前端处理错误时要区分:`detail` 是字符串就直接显示,是数组就当作校验错误。这一条明天写前端契约时要写进类型里。

## 接口测试

上面的 curl 是手测,要有一组自动跑的。`tests/test_api.py` 用 FastAPI 的 `TestClient`,不用真的起服务,在进程里直接发请求:

```python
# agent-loupe/server/tests/test_api.py
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from loupe.app import create_app

SAMPLES = Path(__file__).parents[2] / "samples"


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(str(tmp_path / "test.db")))


def upload(client: TestClient, name: str):
    return client.post("/api/import", files={"file": (name, (SAMPLES / name).read_bytes())})


def test_import_and_fetch(client: TestClient) -> None:
    r = upload(client, "weather_sdk.jsonl")
    assert r.status_code == 200
    [run] = r.json()["imported"]
    detail = client.get(f"/api/runs/{run['id']}").json()
    assert detail["step_count"] == run["steps"] == 6
    assert detail["total_cost_usd"] == pytest.approx(0.0004929)  # SDK 不记成本,导入时按 prices.json 补上
    light = client.get(f"/api/runs/{run['id']}/steps").json()
    assert "input" not in light["steps"][0] and "output" not in light["steps"][0]  # 默认不带大字段
    full = client.get(f"/api/runs/{run['id']}/steps/1").json()
    assert full["kind"] == "llm" and full["input"]["messages"][0]["role"] == "system"


def test_steps_pagination(client: TestClient) -> None:
    [run] = upload(client, "synthetic_small.jsonl").json()["imported"]
    page1 = client.get(f"/api/runs/{run['id']}/steps", params={"limit": 20}).json()
    assert len(page1["steps"]) == 20 and page1["next_from"] == 20 and page1["total"] == 30
    page2 = client.get(f"/api/runs/{run['id']}/steps", params={"from": 20, "limit": 20}).json()
    assert [s["idx"] for s in page2["steps"]] == list(range(20, 30)) and page2["next_from"] is None


def test_runs_cursor_and_filters(client: TestClient) -> None:
    upload(client, "weather_sdk.jsonl")
    upload(client, "synthetic_small.jsonl")
    first = client.get("/api/runs", params={"limit": 1}).json()
    assert len(first["items"]) == 1 and first["next_cursor"]
    second = client.get("/api/runs", params={"limit": 1, "cursor": first["next_cursor"]}).json()
    assert second["items"][0]["id"] != first["items"][0]["id"] and second["next_cursor"] is None
    assert [r["name"] for r in client.get("/api/runs", params={"tag": "synthetic"}).json()["items"]] == ["synthetic-30"]
    assert client.get("/api/runs", params={"q": "weather"}).json()["items"][0]["name"] == "weather-agent"
    assert client.get("/api/runs", params={"cursor": "garbage"}).status_code == 400


def test_bad_file_gives_400_with_reason(client: TestClient) -> None:
    r = client.post("/api/import", files={"file": ("x.json", b'{"hello": 1}')})
    assert r.status_code == 400 and "认不出格式" in r.json()["detail"]
    r = client.post("/api/import", files={"file": ("x.bin", b"\xff\xfe\x00")})
    assert r.status_code == 400


def test_404s_and_validation(client: TestClient) -> None:
    assert client.get("/api/runs/nope").status_code == 404
    assert client.get("/api/runs/nope/steps").status_code == 404
    [run] = upload(client, "weather_sdk.jsonl").json()["imported"]
    assert client.get(f"/api/runs/{run['id']}/steps/99").status_code == 404
    assert client.get("/api/runs", params={"limit": 0}).status_code == 422
    assert client.get(f"/api/runs/{run['id']}/steps", params={"from": -1}).status_code == 422


def test_reimport_overwrites(client: TestClient) -> None:
    upload(client, "synthetic_small.jsonl")
    upload(client, "synthetic_small.jsonl")
    assert len(client.get("/api/runs").json()["items"]) == 1


def test_upload_limit(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("loupe.app.MAX_UPLOAD_BYTES", 1000)
    assert upload(client, "synthetic_small.jsonl").status_code == 413


def test_load_trace_roundtrip(tmp_path: Path) -> None:
    from loupe import db
    from loupe.importers import import_any
    from loupe.pricing import fill_costs

    original = fill_costs(import_any((SAMPLES / "weather_sdk.jsonl").read_text(encoding="utf-8"))[0])
    conn = db.connect(tmp_path / "t.db")
    db.save_trace(conn, original)
    loaded = db.load_trace(conn, original.run.id)
    assert loaded == original
```

<div class="line-notes">

- `def client(tmp_path: Path) -> TestClient:` fixture:每个测试得到一个**全新的**应用,数据库是它自己的临时文件。`create_app` 做成工厂函数的价值就在这里。注意用的是文件而不是 `:memory:`,因为现在每个请求自己开连接,内存库每个连接各是一个,互相看不见。
- `def upload(client: TestClient, name: str):` 小辅助:用 `files={"file": (文件名, 内容字节)}` 模拟浏览器的文件上传。返回值是响应对象。
- `assert detail["step_count"] == run["steps"] == 6` 导入时接口返回的步数、库里的冗余字段、样例本身的步数三者一致。
- `pytest.approx(0.0004929)` 浮点数不能直接用 `==` 比,`approx` 允许极小的误差。这个数就是上面手算的 `(799 × 0.30 + 211 × 1.20) / 1,000,000`。**这条断言证明 `fill_costs` 接进了导入流程**,SDK 样例里本来没有成本。
- `assert "input" not in light["steps"][0] and "output" not in light["steps"][0]` 默认返回的是轻步骤,两个大字段一个都不能有。
- `full = client.get(f"/api/runs/{run['id']}/steps/1").json()` 单步接口取第 1 步(第一个 llm 调用),完整内容里 `input.messages[0]` 是 system 消息。
- `assert len(page1["steps"]) == 20 and page1["next_from"] == 20 and page1["total"] == 30` 30 步的运行,每页 20:第一页 20 步,下一段从 20 开始,总数 30。
- `params={"from": 20, "limit": 20}` 第二页:只剩 10 步(20 到 29),`next_from` 是 `None`。这是分页边界的测试。
- `assert second["items"][0]["id"] != first["items"][0]["id"] and second["next_cursor"] is None` 两条运行每页 1 条:第二页是另一条,而且是最后一页。
- `params={"tag": "synthetic"}` 标签过滤只留下合成的那条。`synthetic_small.jsonl` 的标签是 `synthetic` 和 `sdk`。
- `assert client.get("/api/runs", params={"cursor": "garbage"}).status_code == 400` 坏游标 400 不是 500。
- `files={"file": ("x.bin", b"\xff\xfe\x00")}` 传几个不是合法 UTF-8 的字节,`raw.decode("utf-8")` 会抛 `UnicodeDecodeError`,接口转成 400。
- `assert client.get("/api/runs", params={"limit": 0}).status_code == 422` `Query(ge=1)` 的约束由 FastAPI 自动检查。
- `monkeypatch.setattr("loupe.app.MAX_UPLOAD_BYTES", 1000)` 测试里临时把上限改成 1000 字节,不用真的造一个 200 MB 的文件。`monkeypatch` 是 pytest 自带的 fixture,测试结束后自动还原。因为接口里每次请求才读 `MAX_UPLOAD_BYTES` 这个模块级变量,所以能生效。
- `assert upload(client, "synthetic_small.jsonl").status_code == 413` 30 步的文件有 32 KB,超过 1000 字节,返回 413。
- `from loupe import db` 这三个导入放在函数里,是因为这个测试不用 `client`,只测数据层;放在函数里表示它们只为这一个测试服务。
- `original = fill_costs(import_any(` 带成本的完整 `Trace`,作为「应该原样存取」的标准答案。
- `loaded = db.load_trace(conn, original.run.id)` 存库再读回来。
- `assert loaded == original` pydantic 模型可以直接用 `==` 比较所有字段。这条断言守住了今天的约定:`save_trace` 和 `load_trace` 互为逆操作,Day 667 的对比、Day 669 的重跑才敢相信从库里读出来的数据。

</div>

```text
71 passed in 0.85s
```

71 是我本地全部测试的数量,包含 Day 652 到 659 的。今天新增的是 `test_api.py` 的 8 个、`test_pricing.py` 的 4 个、`test_health.py` 的 1 个(改成了用 `create_app`)。`test_pricing.py` 我不展开贴代码,它测的是:价格表加载时跳过 `_note`;公式和手算一致(一百万输入加一百万输出等于 1.50 美元);已带成本的不动、不认识的模型和没有 token 的和不是 llm 的步骤都跳过;原来的对象不被修改。

和昨天一样,看测试能不能抓错,我故意改坏了五处:

| 故意改坏的地方 | 变红的测试 |
| --- | --- |
| `get_steps` 默认也取所有列 | `test_import_and_fetch`(轻步骤里出现了 `input`) |
| `next_from` 判断改成永远有下一段 | `test_steps_pagination` |
| `fill_costs` 不再判断「没带成本」,覆盖所有 | `test_existing_cost_is_kept_and_unknown_model_skipped` |
| 导入时不调用 `fill_costs` | `test_import_and_fetch`(成本是 0.0) |
| 坏游标的 `except ValueError` 改成别的 | `test_runs_cursor_and_filters`(500 而不是 400) |

## 今天的文件

| 文件 | 干什么 | 新建还是修改 |
| --- | --- | --- |
| `agent-loupe/server/loupe/db.py` | `get_steps`、`get_step`、`load_trace`、`LIGHT_COLS` | 修改(Day 658、659 的上面续写) |
| `agent-loupe/server/prices.json` | 价格表 | 新建 |
| `agent-loupe/server/loupe/pricing.py` | `load_prices`、`fill_costs` | 新建 |
| `agent-loupe/server/loupe/app.py` | 六个接口、`create_app`、每个请求一个连接 | 修改(Day 651 的 `/api/health` 骨架换成工厂) |
| `agent-loupe/server/tests/test_api.py`、`test_pricing.py`、`test_health.py` | 接口和价格测试 | 新建、新建、修改 |
| `agent-loupe/server/pyproject.toml`、`uv.lock` | 加了 `python-multipart` | 修改 |
| `agent-loupe/server/scratch/s34_threads.py`、`ex660_*.py` | 演示和练习 | 新建,不提交 |

## 动手练习

**练习 1:给步骤接口加一个 `name` 过滤。** 只返回名字等于它的步骤,比如只看所有 `get_weather`。注意这时 `next_from` 不能再用「最后一步的 idx 加一是否小于 `step_count`」判断了,因为过滤后的总数不是 `step_count`。写一个函数和一个检查:取完所有页,没有重复,也没有遗漏。

<details><summary>参考答案</summary>

```python
# agent-loupe/server/scratch/ex660_name.py
import sqlite3
from pathlib import Path
from typing import Any

from loupe import db
from loupe.importers import import_any

SAMPLES = Path(__file__).parents[2] / "samples"


def get_steps_named(conn: sqlite3.Connection, run_id: str, name: str, *, start: int = 0,
                    limit: int = 500) -> tuple[list[dict[str, Any]], int | None]:
    rows = conn.execute(
        f"SELECT {db.LIGHT_COLS} FROM steps WHERE run_id = ? AND idx >= ? AND name = ? ORDER BY idx LIMIT ?",
        (run_id, start, name, limit + 1),  # 多取一条:取到了就说明后面还有
    ).fetchall()
    steps = [dict(r) for r in rows[:limit]]
    next_from = steps[-1]["idx"] + 1 if len(rows) > limit else None
    return steps, next_from


if __name__ == "__main__":
    conn = db.connect(":memory:")
    db.save_trace(conn, import_any((SAMPLES / "synthetic_10k.jsonl").read_text(encoding="utf-8"))[0])
    total = conn.execute("SELECT COUNT(*) FROM steps WHERE name = 'get_weather'").fetchone()[0]
    seen: list[int] = []
    start, pages = 0, 0
    while start is not None:
        steps, start = get_steps_named(conn, "syn10000", "get_weather", start=start, limit=1000)
        seen += [s["idx"] for s in steps]
        pages += 1
    print(f"get_weather 共 {total} 步,分 {pages} 页取完,取到 {len(seen)} 步,有重复吗:{len(seen) != len(set(seen))}")
    steps, nxt = get_steps_named(conn, "syn10000", "get_weather", start=0, limit=5)
    print("前 5 个 idx:", [s["idx"] for s in steps], " next_from =", nxt)
    steps, nxt = get_steps_named(conn, "syn10000", "no_such_tool")
    print("不存在的名字:", steps, nxt)
```

<div class="line-notes">

- `def get_steps_named(conn: sqlite3.Connection, run_id: str, name: str, *, start: int = 0,` 新函数,多一个 `name` 参数,返回两样东西:步骤列表和 `next_from`,所以返回类型是元组。
- `f"SELECT {db.LIGHT_COLS} FROM steps WHERE run_id = ? AND idx >= ? AND name = ? ORDER BY idx LIMIT ?",` 在原来的 `WHERE` 上多一个 `AND name = ?`。仍然是轻列,仍然用 `db.LIGHT_COLS` 这个常量。
- `(run_id, start, name, limit + 1),  # 多取一条:取到了就说明后面还有` 四个值对应四个 `?`。**多取一条**,和 Day 659 的 `list_runs` 一样的技巧。
- `steps = [dict(r) for r in rows[:limit]]` 只返回前 `limit` 条,多取的那条丢掉。
- `next_from = steps[-1]["idx"] + 1 if len(rows) > limit else None` 取到了 `limit + 1` 条才有下一段,起点是这一段最后一步的 idx 加一。**注意是「最后一个返回的」idx 加一,不是「第 limit+1 条的 idx」**,因为中间过滤掉的步骤不算,下一段从 idx 加一往后找,效果等价,而且不用额外解释。
- `total = conn.execute("SELECT COUNT(*) FROM steps WHERE name = 'get_weather'")` 先查出真实总数,用来核对。
- `while start is not None:` 一直翻到 `next_from` 是 `None`。`start, pages = 0, 0` 同时给两个变量赋值。
- `steps, start = get_steps_named(` 同时接收返回的两个值,并把 `start` 更新成下一段的起点。
- `len(seen) != len(set(seen))` 有重复的话去重后会变短。

</div>

```text
get_weather 共 6671 步,分 7 页取完,取到 6671 步,有重复吗:False
前 5 个 idx: [2, 4, 6, 8, 9]  next_from = 10
不存在的名字: [] None
```

6671 步分 7 页(每页 1000)取完,不重不漏;前 5 个是 idx 2、4、6、8、9:idx 3、5、7 是下一轮的模型调用(名字是 `chat deepseek-flash`),8 和 9 是同一轮里连着的两个工具调用。名字不存在时返回空列表和 `None`。至于要不要给 `(run_id, name)` 建索引:一条运行最多几万步,主键范围扫描加过滤已经很快,先不建,测出来慢了再说。

</details>

**练习 2:测你自己机器的数字。** 照「轻和重差多少」那一节的方法,在你的机器上测一遍:导入一万步的耗时、500 步轻和完整、5000 步轻和完整。再加一行:`limit=5000&full=true` 取两次(`from=0` 和 `from=5000`)拿到完整的一万步,算总大小和总时间。把结果和机器型号写进 `docs/perf.md`,Day 663 和 Day 675 要用。

<details><summary>参考答案</summary>

```bash
B=http://127.0.0.1:8000/api/runs/syn10000
for i in 1 2 3; do
  curl -s -o /dev/null -w "500轻 %{http_code} %{time_total}s %{size_download}B\n" "$B/steps?limit=500"
done
curl -s -o /dev/null -w "5000轻 %{http_code} %{time_total}s %{size_download}B\n" "$B/steps?limit=5000"
curl -s -o /dev/null -w "500完整 %{http_code} %{time_total}s %{size_download}B\n" "$B/steps?limit=500&full=true"
curl -s -o /dev/null -w "5000完整(前半) %{http_code} %{time_total}s %{size_download}B\n" "$B/steps?limit=5000&full=true"
curl -s -o /dev/null -w "5000完整(后半) %{http_code} %{time_total}s %{size_download}B\n" "$B/steps?limit=5000&from=5000&full=true"
```

`curl -w` 的 `%{time_total}`、`%{size_download}` 打印总耗时和下载字节数,`-o /dev/null` 把响应体丢掉只看这两个数。`for i in 1 2 3` 跑三次,看波动。

我这台机器上的结果(2019 款 13 寸 Intel MacBook Pro,i7,每项三次):

```text
导入一万步(18.7 MB 文件)   1.64 秒 / 1.94 秒(第二次是覆盖)
500 步 轻       0.012 秒   133,273 B
500 步 完整     0.031 到 0.034 秒   877,555 B
5000 步 轻      0.045 到 0.072 秒   1,336,636 B
5000 步 完整    0.30 到 0.37 秒     8,895,382 B(前半)
一万步 完整(后半 5000)  0.28 到 0.31 秒  8,910,253 B
```

两半加起来 17.8 MB、0.6 秒左右。写进 `docs/perf.md` 时,每个数字写上「测的哪台机器、哪天、回环还是真网络、几次的范围」。这份记录是后面所有「我优化了性能」的基准:没有它,说快了多少没有依据。

</details>

**练习 3:价格表覆盖了 trace 里的所有模型吗?** 写 `unpriced_models(traces)`:返回 `{模型名: 有多少个 llm 步算不出成本}`,只统计没带成本又不在价格表里的。对现有样例跑一次(应该是空),再把一条 trace 的模型名改成价格表里没有的 `gpt-9`,看它能不能抓出来。

<details><summary>参考答案</summary>

```python
# agent-loupe/server/scratch/ex660_models.py
from loupe.models import Trace
from loupe.pricing import load_prices


def unpriced_models(traces: list[Trace]) -> dict[str, int]:
    """返回 {模型名: 有多少个 llm 步算不出成本}。只统计没带成本、又不在价格表里的。"""
    prices = load_prices()
    missing: dict[str, int] = {}
    for t in traces:
        for s in t.steps:
            key = s.model or "(没记模型名)"
            if s.kind == "llm" and s.cost_usd is None and key not in prices:
                missing[key] = missing.get(key, 0) + 1
    return missing


if __name__ == "__main__":
    from pathlib import Path

    from loupe.importers import import_any

    samples = Path(__file__).parents[2] / "samples"
    traces = [t for n in ["weather_sdk.jsonl", "weather_otlp.jsonl", "synthetic_small.jsonl"]
              for t in import_any((samples / n).read_text(encoding="utf-8"))]
    print("现有样例:", unpriced_models(traces))
    bad = traces[0].model_copy(update={"steps": [s.model_copy(update={"model": "gpt-9"}) for s in traces[0].steps]})
    print("换成 gpt-9 以后:", unpriced_models([bad]))
```

<div class="line-notes">

- `prices = load_prices()` 价格表里的模型名集合就是字典的键。
- `missing: dict[str, int] = {}` 结果:模型名到个数。
- `key = s.model or "(没记模型名)"` 模型名是 `None` 时用一个占位文字,让「没记模型名」也能被统计出来,而不是被悄悄忽略。
- `if s.kind == "llm" and s.cost_usd is None and key not in prices:` 三个条件:是模型调用、没带成本、价格表里没有。**带了成本的不算**(Langfuse 自己算好的),即使模型不在价格表里也不用我们补。
- `missing[key] = missing.get(key, 0) + 1` 计数的惯用写法:取当前值(没有就是 0)加一。`dict.get(key, 默认值)` ≈ JS 的 `map[key] ?? 0`。
- `traces = [t for n in` 双层推导:对每个文件名,取出它里面的所有 trace,摊平成一个列表。
- `s.model_copy(update={"model": "gpt-9"})` 把每一步的模型名改成 `gpt-9`,模拟「用了价格表里没有的模型」。注意这里 SDK 样例的 llm 步原来没有成本,所以会被统计。

</div>

```text
现有样例: {}
换成 gpt-9 以后: {'gpt-9': 2}
```

现有样例都被价格表覆盖;改成 `gpt-9` 后,那条两次模型调用的运行里 2 个 llm 步被查了出来。这个函数可以放在启动检查或者 Day 657 的体检工具里:每次导入完提示一句「有 N 个步骤用了价格表没有的模型 gpt-9,成本显示为未知」,比悄悄变成 0 友好得多。

</details>

**验收标准**:`uv run pytest -q` 全部通过;服务能起来,`curl` 能走通导入、列表、翻页、取单步和那四种出错;`s34_threads.py` 的输出里,共用连接能看到很多种中间状态,各用各的只有两种;`docs/perf.md` 里有你自己机器上的数字和型号;三个练习各有输出。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 轻步骤 | 只含定位、类型、时间、token、成本等小字段、不含 `input` 和 `output` 的步骤 |
| 分段加载 | 不一次返回全部,按「从第 N 个起取 M 个」一段一段取 |
| 价格表 | 模型名到单价(每百万 token 多少钱)的映射,放在配置文件里 |
| 工厂函数 | 每次调用返回一个新应用实例的函数,方便测试时注入不同配置 |
| 依赖注入(`Depends`) | FastAPI 在调用接口函数前先调用依赖函数,把结果当参数传进去 |
| 带 `yield` 的依赖 | `yield` 之前准备资源,`yield` 出去的值交给接口,请求结束后继续执行 `yield` 之后的清理代码 |
| `UploadFile` | FastAPI 里表示上传文件的类型,`.file` 是真正的文件对象 |
| `multipart/form-data` | 浏览器上传文件时用的请求体格式,`curl -F` 发的就是它 |
| 413 | HTTP 状态码,请求体太大 |
| 422 | HTTP 状态码,请求格式没错但内容不符合规则,FastAPI 参数校验失败时返回 |
| 线程池 | 一组预先开好的工作线程,FastAPI 把 `def` 接口丢进去并行执行 |
| GIL | Python 的全局解释器锁,同一时刻只有一个线程在执行 Python 代码 |
| 线程安全等级(`sqlite3.threadsafety`) | 报告 SQLite 库允许多线程怎么共用连接,3 是 serialized,最宽松 |
| 事件循环 | `async` 代码运行的单线程调度器,里面有一个同步耗时调用就会卡住所有请求 |
| `monkeypatch` | pytest 的 fixture,测试里临时替换一个变量或函数,结束后自动还原 |

## 常见误区

**默认返回完整的 `input` 和 `output`。** 列表和时间轴不需要它们,一万步的完整数据 17 MB 以上。默认轻、点开再取,首屏快、内存省。

**在 `async def` 里调同步的数据库。** 整个服务被它卡住。要么接口写成 `def`(进线程池),要么用真正的异步数据库驱动。今天实测卡了 1.13 秒。

**把一个 SQLite 连接存在全局变量里让所有请求共用。** 库本身不会坏(serialized 模式),但事务是连接级的,读的人会看到别人写到一半的数据。实测一万步导入期间读到了 138 种中间状态。

**以为 `check_same_thread=False` 是「让 SQLite 线程安全」。** 它只是关掉 Python 的那道检查。连接能不能同时被多个线程用,取决于 SQLite 库的编译方式,而用得对不对取决于你的使用方式。

**用户传错了文件返回 500。** 认不出格式、不是文本、游标坏了,这些是调用方的问题,返回 400 并说清原因;500 留给我们自己的 bug。前端对这两类错误的处理是不同的。

**价格表里的成本当账单。** 它是偏贵的估计,时段和缓存命中都没有算。界面和 README 要写明口径、查证日期和出处。

**换了模型忘了改价格表。** `fill_costs` 对不认识的模型是跳过,成本会悄悄变成 0,没有任何报错。要有检查(练习 3),Day 675 的花费上限也要靠它。

**忘了 `uv add python-multipart`。** 文件上传接口需要它,报错会在创建应用的时候而不是第一次上传时出现。

## 学习资料

### 文档与文章

- [FastAPI:Request Files](https://fastapi.tiangolo.com/tutorial/request-files/):`UploadFile` 和 `File(...)` 的官方教程,今天的导入接口用到,15 分钟。
- [FastAPI:Query Parameters](https://fastapi.tiangolo.com/tutorial/query-params/):可选查询参数和默认值;带约束的 `Query(ge=1, le=200)` 在「Query Parameters and String Validations」那一页,我们 `from` 的别名也在那里,20 分钟。
- [FastAPI:Dependencies with yield](https://fastapi.tiangolo.com/tutorial/dependencies/dependencies-with-yield/):带 `yield` 的依赖怎么做清理,今天的 `get_conn` 就是它,15 分钟。
- [FastAPI:Concurrency and async / await](https://fastapi.tiangolo.com/async/):什么时候写 `def`、什么时候写 `async def`,今天的 1.13 秒卡顿就是不遵守它的后果,20 分钟。
- [SQLite:Using SQLite In Multi-Threaded Applications](https://www.sqlite.org/threadsafe.html):三种线程模式(single-thread、multi-thread、serialized)的官方说明,10 分钟。
- [DeepSeek 定价](https://api-docs.deepseek.com/quick_start/pricing):价格表的出处,注意高峰和非高峰时段的划分,5 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV18F4m1K7N3&autoplay=0&high_quality=1" title="【程序员科科】1小时精通Python的FastAPI框架的所有知识点" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员科科 · 1小时精通Python的FastAPI框架的所有知识点 · 约 68 分钟,FastAPI 忘得差不多了就从头看,只想补文件上传的话拖到讲请求体和表单的部分,我没有核对具体时间点。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1i2dZBaEaF&autoplay=0&high_quality=1" title="【古法编程-Python标准库-sqlite3】古法编程,半小时教会你使用sqlite3标准库!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>北屿青禾 · 【古法编程-Python标准库-sqlite3】古法编程,半小时教会你使用sqlite3标准库! · 约 33 分钟,2026 年发布。用标准库 sqlite3 从头走一遍,可以查缺补漏;多线程那部分今天的文章讲得更细,以文章为准。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/WRjXIA5pMtk" title="Python FastAPI Tutorial (Part 3): Path Parameters - Validation and Error Handling" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python FastAPI Tutorial (Part 3): Path Parameters - Validation and Error Handling · 讲路径参数的校验和错误处理,对应今天的 400、404、422 的区分。核对过标题和作者,我没有完整看过。</figcaption>
</figure>

### 书籍

- **Fluent Python**,Luciano Ramalho,O'Reilly,第 2 版 2022 年。里面有一章专门讲并发模型(线程、进程、`asyncio`)和 GIL,想知道「为什么线程池里的导入还是会拖慢别的请求」可以读那一章,约 1.5 小时,章节编号以你手里那本为准。
- **Designing Data-Intensive Applications**,Martin Kleppmann 和 Chris Riccomini,O'Reilly,第二版 2026 年出版。事务隔离那部分解释了为什么「读到别人写到一半的数据」是一种需要被防止的异常,约 1 小时。

### 开源项目与代码

- [fastapi/fastapi](https://github.com/fastapi/fastapi):翻 `docs_src/request_files/` 和 `docs_src/dependencies/` 下的示例,和我们的上传接口、`get_conn` 对照。
- [langfuse/langfuse](https://github.com/langfuse/langfuse):看它怎么处理模型价格(它有一张模型定价表,也有「不认识的模型要你自己加」的情形,Day 655 就碰到过),和我们的价格表对照。

## 自测

1. 步骤接口为什么默认不返回 `input` 和 `output`?你实测的差距是多少?

<details><summary>答案</summary>

时间轴只需要名字、类型、时间、错误和 token,而模型调用步的 `input` 是当时完整的 messages,越往后越长。同样 500 步,完整版 878 KB、轻版 133 KB;同样 5000 步,完整 8.9 MB、轻版 1.34 MB,约 6.6 倍。一万步全量完整加载就是 17 MB 以上。点开某一步再单独取(3.6 KB,7 毫秒),首屏快、内存省。数字以自己机器上实测为准,而且合成数据的比例可能和真实 Agent 不同。

</details>

2. `fill_costs` 算出的成本和你 DeepSeek 账单上的数会一致吗?为什么?

<details><summary>答案</summary>

不一致,一般偏高。价格表按「高峰时段、缓存未命中」的价格算,而实际有一部分调用发生在非高峰(半价),一部分输入命中缓存(便宜很多)。trace 里没有记录时段和缓存命中的 token 数,所以只能给一个偏保守的估计,要在界面和 README 里写明口径、查证日期和出处。

</details>

3. 为什么导入接口是 `def` 不是 `async def`?

<details><summary>答案</summary>

导入里全是同步的、耗时的代码(解析一万步、写 SQLite)。`async def` 的接口直接跑在事件循环里,这些代码会卡住整个服务:实测导入一万步时,同时发起的健康检查要等 1.13 秒;`def` 的接口 FastAPI 放进线程池执行,同样的情况最慢 0.26 秒。(还有一点余波,因为 GIL。)

</details>

4. 一个 SQLite 连接被多个线程共用,最大的问题是什么?为什么每个请求一个连接能解决?

<details><summary>答案</summary>

事务是连接级别的。线程 A 在事务里写一半,线程 B 用同一个连接去读,会看到未提交的数据:实测导入一万步期间读到 138 种中间状态。每个请求自己开一个连接,读的连接看不到别的连接未提交的修改,WAL 模式下读还不阻塞写,所以只会看到导入前或导入后两种状态。代价是每次开关一个连接,实测平均 0.33 毫秒,可以忽略。

</details>

5. 「用户上传了一个不认识的文件」返回 400,「库文件损坏了」返回 500,为什么要分开?

<details><summary>答案</summary>

400 说明是调用方的问题,可以修:前端把 `detail` 里的原因显示给用户,让他换一个文件。500 说明是我们服务端的 bug 或故障,用户做什么都没用,要报警、查日志。如果都返回 500,监控里看起来全是故障,真正的故障被淹没,用户也得不到任何指引。

</details>

6. 面试题:现在这个后端是单进程加 SQLite。如果要给一个 20 人的团队共用,同时导入、同时浏览,你会改哪些地方,按什么顺序?

<details><summary>答案</summary>

先确认瓶颈再改。第一,数据库换 Postgres:多进程同时写 SQLite 会碰到写锁,而且团队部署一般在容器里,本地文件不可靠;访问都封装在 `db.py` 里,换实现的范围可控。第二,大文件导入改成异步任务:上传后返回任务 ID,后台 worker 解析入库,前端轮询进度,避免请求超时和阻塞 web 进程。第三,加身份和权限:至少知道谁导入的、按项目隔离。第四,trace 原始文件放对象存储,数据库只存解析后的数据和文件位置。第五才是性能优化,比如 steps 表分区。这些都和 PRD 的非目标(不做多用户)冲突,所以先回到 PRD 问:是不是真的要往这个方向走。

</details>

## 明天预告

后端的六个接口都通了,明天(Day 661)是 Loupe(九):**前后端契约类型和三个小工具**。后端返回的 JSON 长什么样,前端要有一份同样的 TypeScript 类型,两边对不上就会在运行时才出错。明天写 `web/src/types.ts`,把今天的响应(运行、轻步骤、完整步骤、列表分页、错误的两种 `detail` 形状)逐个对上,再写三个前端小工具,为 Day 662 的运行列表页和时间轴做准备。
