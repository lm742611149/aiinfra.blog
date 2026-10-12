---
title: 'Day 52 · 可观测与成本:接 Langfuse、算单工单成本、缓存与模型路由'
description: '给 SupportPilot 装上眼睛和账本:每张工单在 Langfuse 里是一棵能点开的 trace,每次模型调用都记一笔精确到分的账。然后用两招把单工单成本压下来:让 prompt 前缀稳定以吃到缓存命中价,让小模型干分类、大模型只管起草。'
pubDate: 2026-10-12
regime: none
tags: ['langfuse', 'observability', 'cost', 'prompt-caching', 'model-routing', 'capstone', 'agent-60']
series: 'agent-60'
day: 52
lang: 'zh'
---

## 今天要解决的问题

Day 51 你按错误分析把分数往上提了一轮。提分的过程中你大概已经有过这种体验:某张工单答错了,你想知道是检索没捞到、工具参数传错了,还是起草时模型没看检索结果,于是你在终端里翻几百行日志。翻得很累,而且一换机器日志就没了。

今天要把这件事彻底解决,顺带把钱算清楚。结束时你应该能做到:

1. SupportPilot 处理的每一张工单,在 Langfuse 里都是一棵 trace 树,分类、检索、工具调用、起草、自检每一步的输入输出、耗时、token 都能点开看。
2. 自己维护一本「模型调用账本」,能回答「上周平均一张工单花了多少钱、P95 是多少、钱花在哪个节点」。
3. 把 prompt 的结构改成「稳定前缀在前,变化内容在后」,在账本里看到缓存命中率从接近 0 涨上去。
4. 实现一个简单的模型路由:分类和自检交给便宜的 `deepseek-flash`,起草交给 `deepseek-v4-pro`,并且能说出这样分的理由。
5. 跑一遍 Day 50 的评测集,填出优化前后的对比表:分数、P95 延迟、单工单成本三列都要有。
6. 算一张「Agent vs 人工」的单工单 ROI 表,说得出 ROI 对哪个参数最敏感。

预计用时 5–7 小时,其中自托管 Langfuse 如果你的电脑比较老,光拉镜像就可能占半小时。前置是 Day 34(tracing 概念)、Day 38(成本与延迟的基本手段)、Day 47(主工作流)、Day 50(评测集)。

### 目录回顾

写到第 52 天,先把 SupportPilot 的目录对一遍。下面是本文和后面几天默认的结构,你的仓库如果在 Day 43–44 里按别的方式组织,对照着改导入路径就行,逻辑不受影响。

```text
supportpilot/
├── pyproject.toml  uv.lock  .env.example
├── Dockerfile  compose.yaml
├── app/        # FastAPI 服务:api.py(SSE 接口)、config.py、llm.py(模型客户端)、pricing.py
├── agent/      # LangGraph 主工作流:state.py、graph.py、nodes.py、prompts.py、routing.py
├── rag/        # 知识库:ingest.py、retriever.py(混合检索 + rerank)
├── tools/      # MCP server 与业务工具:server.py、business.py、permissions.py
├── memory/     # 会话与客户画像:store.py、summarize.py
├── ui/         # Streamlit 前端:streamlit_app.py
├── evals/      # 测试集与评测:cases.jsonl、run_eval.py、judge.py
├── data/       # 造数脚本:seed_kb.py、seed_db.py
├── deploy/     # Caddyfile、上线脚本
├── scripts/    # cost_report.py 等小工具
└── tests/
```

## 为什么光有日志不够

Day 34 讲过 trace、span、generation 这三个词,这里换个角度说一遍,用你现在手里真实的项目。

一张工单进来,SupportPilot 内部大概要走这么几步:分类节点调一次小模型;检索节点去 pgvector 和 BM25 各查一次,再 rerank;执行节点可能调一两个 MCP 工具(查发票、查订阅);起草节点调一次大模型;自检节点再调一次小模型,不通过就回到起草。顺利的话 4 次模型调用,不顺利能到 7、8 次。

如果只靠 `print` 或 `logging`,这些调用在日志里是平铺的,中间还夹着别的请求的日志,因为 FastAPI 是并发处理的。你要找「工单 T-1042 的起草节点看到的检索结果是什么」,得先 grep 工单号,再一行一行拼。trace 做的事情很简单:给同一张工单的所有步骤打上同一个 trace id,并且记住父子关系,于是它们在界面上自动长成一棵树。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="一张工单的 trace 树与时间轴">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">trace: handle_ticket  T-1042   session=C-2087</text>
  <line x1="200" y1="40" x2="200" y2="285" stroke="var(--rule)"/>
  <line x1="620" y1="40" x2="620" y2="285" stroke="var(--rule)"/>
  <text x="200" y="295" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">0 s</text>
  <text x="588" y="295" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">~9 s</text>
  <text x="20" y="62" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">handle_ticket</text>
  <rect x="200" y="50" width="420" height="16" fill="var(--rule)" opacity="0.5"/>
  <text x="36" y="94" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">classify · flash</text>
  <rect x="200" y="82" width="40" height="16" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="36" y="126" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">retrieve</text>
  <rect x="242" y="114" width="36" height="16" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="36" y="158" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">tool: get_invoice</text>
  <rect x="280" y="146" width="22" height="16" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="36" y="190" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">draft · v4-pro</text>
  <rect x="304" y="178" width="250" height="16" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="36" y="222" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">self_check · flash</text>
  <rect x="556" y="210" width="56" height="16" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="304" y="252" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">起草占了大半时间和大半成本</text>
  <line x1="420" y1="242" x2="420" y2="196" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
</svg>
<figcaption>一张工单在 Langfuse 里的样子(示意,时长是按经验画的,不是实测)。蓝色是模型调用,琥珀色是检索和外部工具。点开任何一格都能看到输入输出和 token 数。</figcaption>
</figure>

除了排查单张工单,trace 还解决两个更大的问题。一是聚合:上周 3000 张工单,起草节点的平均延迟是多少,哪天突然变慢了。二是回放:线上一张工单答错了,你把它的 trace 原样加进评测集,这是 Day 31 说的「测试集要跟着产品长」最省事的来源。

## Langfuse:云版还是自托管

Langfuse 是开源的,有两种用法。云版注册就能用,有免费额度,SDK 指向 `https://cloud.langfuse.com`(欧洲区)或 `https://us.cloud.langfuse.com`(美国区)。自托管用官方仓库里的 `docker-compose.yml`,`docker compose up` 之后两三分钟,浏览器打开 `localhost:3000` 自己注册第一个账号。官方文档写得很直白,compose 方式没有高可用和备份,适合试用和小规模。

我的建议:开发阶段用云版,省掉自己维护 Postgres、ClickHouse、Redis、对象存储这一整套。等到 Day 53 部署上线、并且你的 demo 会处理别人的真实输入时,再考虑数据放哪。如果你在国内且访问海外服务不稳定,就在本机或那台云服务器上自托管,但要给它留够内存,ClickHouse 不是省油的灯。我在一台 8 GB 内存的老 Mac 上同时跑 SupportPilot、pgvector 和自托管 Langfuse,风扇就没停过。

不管哪种,拿到三个值写进 `.env`:

```bash
# supportpilot/.env(只放本机,不进 git)
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com   # 自托管就改成你自己的 Langfuse 地址,本机默认是 3000 端口
```

```bash
cd supportpilot
uv add langfuse
```

## 接入:改一行导入,再给节点套上 observe

Langfuse 对 OpenAI SDK 做了一个替身,把 `from openai import OpenAI` 换成 `from langfuse.openai import OpenAI`,之后每一次 `chat.completions.create` 都会自动变成一个 generation,带上 prompt、输出、token 和耗时。DeepSeek 走的是 OpenAI 兼容协议,所以同样适用。

光这样还不够,每次调用会各自成为一棵单独的 trace,散在界面里。要让它们挂到同一张工单下面,得在最外层开一个 span,用 `propagate_attributes` 把 session、user、tags 传下去。下面是改造后的模型客户端,它同时负责往账本里记账,账本下一节讲。

```python
# supportpilot/app/llm.py
import time
from contextvars import ContextVar

from langfuse.openai import OpenAI  # 原来是 from openai import OpenAI

from app.config import settings
from app.ledger import record_call

# 当前在处理哪张工单、哪个节点。用 contextvars 而不是全局变量,
# 因为 FastAPI 会并发处理多张工单,每个请求有自己的上下文。
current_ticket: ContextVar[str] = ContextVar("current_ticket", default="-")
current_node: ContextVar[str] = ContextVar("current_node", default="-")

_client = OpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key)


def chat(messages: list[dict], *, model: str, tools: list[dict] | None = None, **kwargs):
    """所有节点都通过它调模型,好处是计费、重试、tracing 只写一处。"""
    node = current_node.get()
    t0 = time.perf_counter()
    resp = _client.chat.completions.create(
        model=model,
        messages=messages,
        tools=tools or None,
        name=node,  # Langfuse 里这个 generation 显示的名字
        metadata={"ticket_id": current_ticket.get()},
        **kwargs,
    )
    latency_ms = int((time.perf_counter() - t0) * 1000)
    record_call(
        ticket_id=current_ticket.get(),
        node=node,
        model=model,
        usage=resp.usage,
        latency_ms=latency_ms,
    )
    return resp
```

`name` 和 `metadata` 这两个参数是 Langfuse 替身额外认识的,原版 OpenAI SDK 不收,所以只有换了导入才能这么写。

最外层的入口这样包:

```python
# supportpilot/agent/run.py
from langfuse import get_client, observe, propagate_attributes

from agent.graph import build_graph
from app.llm import current_ticket

langfuse = get_client()
graph = build_graph()


@observe(name="handle_ticket")
def handle_ticket(ticket: dict) -> dict:
    token = current_ticket.set(ticket["id"])
    try:
        with propagate_attributes(
            session_id=ticket["customer_id"],  # 同一客户的多张工单归到一个 session
            user_id=ticket["customer_id"],
            tags=["supportpilot", ticket.get("channel", "web")],
        ):
            return graph.invoke({"ticket": ticket})
    finally:
        current_ticket.reset(token)
```

节点内部要标出自己是谁,好让 generation 和账本都知道钱花在哪一步。写一个小装饰器,顺手也让每个节点在 trace 里成为一个 span:

```python
# supportpilot/agent/nodes.py(节选)
from functools import wraps

from langfuse import observe

from app.llm import current_node


def node(name: str):
    def deco(fn):
        @observe(name=name)
        @wraps(fn)
        def wrapper(state, *args, **kwargs):
            token = current_node.set(name)
            try:
                return fn(state, *args, **kwargs)
            finally:
                current_node.reset(token)
        return wrapper
    return deco


@node("classify")
def classify(state):
    ...  # Day 47 的实现不动


@node("draft")
def draft(state):
    ...
```

如果你的工作流里用了 LangChain 的模型对象(比如 `ChatOpenAI`)而不是直接调 SDK,换一种接法:`from langfuse.langchain import CallbackHandler`,在 `graph.invoke(..., config={"callbacks": [CallbackHandler()]})` 里传进去,LangGraph 每个节点会自动成为 span。两种接法别混用,不然同一次调用会出现两遍。

还有一个坑:命令行脚本(比如评测脚本)跑完就退出,Langfuse SDK 是后台批量上报的,进程退出时队列里的事件可能还没发出去。脚本结尾加一句 `get_client().flush()`。FastAPI 这种常驻进程不用管。

## 账本:为什么不直接用 Langfuse 的成本数字

Langfuse 会根据模型名和 token 数推算成本,OpenAI、Anthropic、Google 的价格它内置了,DeepSeek 要你自己在 Project Settings 的 Models 里加一条定义。问题在于 DeepSeek 2026 年 10 月的价目表分高峰和空闲两档,空闲价是高峰价的一半,Langfuse 的模型定义表达不了「按时段变价」。你可以在 Langfuse 里按高峰价配置,把它当作成本上限看趋势;精确的账自己记。

自己记账还有一个好处:评测脚本跑完能直接出成本报告,不依赖任何外部服务,CI 里也能用。

先把价格写清楚。下面是我 2026 年 10 月 12 日在 [DeepSeek 中文价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) 查到的数字(元 / 百万 token),高峰时段是北京时间工作日 9:00–12:00 和 14:00–18:00:

| 模型 | 时段 | 输入·缓存命中 | 输入·缓存未命中 | 输出 |
| --- | --- | --- | --- | --- |
| deepseek-flash | 高峰 | 0.04 | 2 | 8 |
| deepseek-flash | 空闲 | 0.02 | 1 | 4 |
| deepseek-v4-pro | 高峰 | 0.30 | 9 | 27 |
| deepseek-v4-pro | 空闲 | 0.15 | 4.5 | 13.5 |

注意缓存命中价和未命中价差了 50 倍(flash)和 30 倍(pro)。这就是后面优化的突破口。价格以后一定会变,表格只是让你知道量级,代码里的价格放配置。

```python
# supportpilot/app/pricing.py
"""模型计价。价格来自 DeepSeek 官方价格页(2026-10-12 查),单位:元 / 百万 token。"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

CST = timezone(timedelta(hours=8))


@dataclass(frozen=True)
class Price:
    hit: float   # 输入,缓存命中
    miss: float  # 输入,缓存未命中
    out: float   # 输出


# 高峰价;空闲时段打五折
PEAK_PRICES: dict[str, Price] = {
    "deepseek-flash": Price(hit=0.04, miss=2.0, out=8.0),
    "deepseek-v4-pro": Price(hit=0.30, miss=9.0, out=27.0),
}


def is_peak(ts: datetime | None = None) -> bool:
    t = (ts or datetime.now(CST)).astimezone(CST)
    if t.weekday() >= 5:  # 周末;法定节假日没处理,账会略微偏高,可以接受
        return False
    return 9 <= t.hour < 12 or 14 <= t.hour < 18


def split_prompt_tokens(usage) -> tuple[int, int]:
    """返回 (命中, 未命中)。DeepSeek 直接给两个字段;OpenAI 系把命中数放在 prompt_tokens_details 里。"""
    total = usage.prompt_tokens
    hit = getattr(usage, "prompt_cache_hit_tokens", None)
    if hit is None:
        details = getattr(usage, "prompt_tokens_details", None)
        hit = (getattr(details, "cached_tokens", 0) or 0) if details else 0
    return hit, total - hit


def cost_yuan(model: str, usage, ts: datetime | None = None) -> float:
    price = PEAK_PRICES.get(model)
    if price is None:
        return 0.0  # 未知模型不瞎算,报表里会显示为 0,提醒你补价格
    factor = 1.0 if is_peak(ts) else 0.5
    hit, miss = split_prompt_tokens(usage)
    out = usage.completion_tokens
    return factor * (hit * price.hit + miss * price.miss + out * price.out) / 1_000_000
```

账本用 SQLite 就够了,一张表:

```python
# supportpilot/app/ledger.py
import sqlite3
import threading
from datetime import datetime

from app.pricing import CST, cost_yuan, split_prompt_tokens

_DB = "data/ledger.sqlite3"
_lock = threading.Lock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS llm_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    ticket_id TEXT NOT NULL,
    node TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL,
    hit_tokens INTEGER NOT NULL,
    completion_tokens INTEGER NOT NULL,
    cost_yuan REAL NOT NULL,
    latency_ms INTEGER NOT NULL
)
"""


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB, check_same_thread=False)
    conn.execute(_SCHEMA)
    return conn


def record_call(*, ticket_id: str, node: str, model: str, usage, latency_ms: int) -> None:
    now = datetime.now(CST)
    hit, _miss = split_prompt_tokens(usage)
    row = (
        now.isoformat(), ticket_id, node, model,
        usage.prompt_tokens, hit, usage.completion_tokens,
        cost_yuan(model, usage, now), latency_ms,
    )
    with _lock, _conn() as conn:
        conn.execute(
            "INSERT INTO llm_calls (ts, ticket_id, node, model, prompt_tokens, hit_tokens,"
            " completion_tokens, cost_yuan, latency_ms) VALUES (?,?,?,?,?,?,?,?,?)",
            row,
        )
```

每次调用都开一个连接看上去浪费,但对一个 demo 级服务完全够用,SQLite 写入是毫秒级的。如果你已经在用 Postgres 存会话,把这张表搬过去也行,SQL 几乎不用改。

报表脚本回答三个问题:每张工单花多少(平均、P50、P95),钱花在哪个节点,缓存命中率多少。

```python
# supportpilot/scripts/cost_report.py
"""用法:uv run python scripts/cost_report.py [--since 2026-10-12]"""
import argparse
import sqlite3
import statistics


def pct(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    values = sorted(values)
    k = max(0, min(len(values) - 1, round(p / 100 * (len(values) - 1))))
    return values[k]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="1970-01-01")
    ap.add_argument("--db", default="data/ledger.sqlite3")
    args = ap.parse_args()
    conn = sqlite3.connect(args.db)

    per_ticket = [
        r[0] for r in conn.execute(
            "SELECT SUM(cost_yuan) FROM llm_calls WHERE ts >= ? GROUP BY ticket_id", (args.since,)
        )
    ]
    print(f"工单数 {len(per_ticket)}")
    if per_ticket:
        print(
            f"单工单成本(元) 平均 {statistics.mean(per_ticket):.4f}"
            f"  P50 {pct(per_ticket, 50):.4f}  P95 {pct(per_ticket, 95):.4f}"
        )

    print("\n按节点:")
    rows = conn.execute(
        "SELECT node, model, COUNT(*), SUM(cost_yuan), AVG(latency_ms),"
        " SUM(hit_tokens) * 1.0 / MAX(SUM(prompt_tokens), 1)"
        " FROM llm_calls WHERE ts >= ? GROUP BY node, model ORDER BY SUM(cost_yuan) DESC",
        (args.since,),
    )
    print(f"{'node':<12}{'model':<18}{'calls':>6}{'cost':>10}{'avg_ms':>8}{'hit%':>7}")
    for node, model, n, cost, ms, hit in rows:
        print(f"{node:<12}{model:<18}{n:>6}{cost:>10.4f}{ms:>8.0f}{hit * 100:>6.1f}%")


if __name__ == "__main__":
    main()
```

## 先用算式估一下,心里有数

动手优化之前,先拿算式估一张「典型工单」的钱,免得优化完不知道省得多不多。假设一张工单这样走(数字是按 SupportPilot 的 prompt 长度粗估的,你自己的可以从账本里取真实均值替换):

- classify:输入 1,500 token,输出 60 token。
- draft:输入 6,000 token(系统提示 + 政策摘要 + 检索到的 5 段文档 + 工具结果 + 对话历史),输出 400 token。
- self_check:输入 3,000 token,输出 80 token。

先按「全部用 v4-pro、完全不命中缓存、高峰时段」算:

- 输入合计 1,500 + 6,000 + 3,000 = 10,500 token,10,500 × 9 / 1,000,000 ≈ 0.0945 元。
- 输出合计 60 + 400 + 80 = 540 token,540 × 27 / 1,000,000 ≈ 0.0146 元。
- 一张约 0.109 元。一天 3,000 张就是 327 元,一个月接近一万。

这个数对一家小公司的客服团队来说不算夸张,但面试官会追问你「怎么降」。接下来两招。

## 第一招:让 prompt 前缀稳定,吃缓存命中价

DeepSeek、OpenAI 的缓存都是自动的,原理一样:如果这次请求的开头一段和最近某次请求一模一样,那一段就按命中价算。Anthropic 的 Claude 需要你在请求里显式标出缓存断点,写入时还要多付一点,读取很便宜,细节看它的 prompt caching 文档。三家的共同点是**只认前缀**,从第一个 token 开始逐个比对,中间哪怕差一个字符,后面的全部算未命中。

所以问题变成:你的 messages 里,哪些部分每张工单都一样,哪些每次都变?

- 每次都一样:系统提示(角色、语气、输出格式)、工具定义、退款政策等固定规则、few-shot 示例。
- 每张工单都变:客户信息、检索结果、工具返回、工单正文、对话历史。

很多人第一版的系统提示长这样,我自己就这么写过:

```python
# 反例:每次请求的第一行都不一样,后面几千 token 全部白白按未命中计费
system = f"""你是云簿 CloudLedger 的客服助手。现在是 {datetime.now():%Y-%m-%d %H:%M}。
当前客户:{customer['name']}(套餐 {customer['plan']})。
{POLICY_TEXT}
{FEW_SHOTS}
"""
```

时间戳和客户名放在了最前面,于是后面 3,000 token 的政策和示例永远命中不了。改成固定内容在前、变量在后:

```python
# supportpilot/agent/prompts.py(节选)
# 固定部分:模块加载时拼好,之后每次请求逐字相同
DRAFT_SYSTEM = "\n\n".join([ROLE_AND_TONE, OUTPUT_FORMAT, POLICY_TEXT, FEW_SHOTS])


def build_draft_messages(state) -> list[dict]:
    dynamic = (
        f"当前时间:{state['now']:%Y-%m-%d %H:%M}\n"
        f"客户:{state['customer']['name']},套餐 {state['customer']['plan']}\n\n"
        f"<检索结果>\n{state['context']}\n</检索结果>\n\n"
        f"<工具结果>\n{state['tool_results']}\n</工具结果>"
    )
    return [
        {"role": "system", "content": DRAFT_SYSTEM},
        *state["history"],
        {"role": "user", "content": dynamic + "\n\n<工单>\n" + state["ticket"]["body"] + "\n</工单>"},
    ]
```

还有三个容易破坏前缀的细节,都是我在账本里看到命中率上不去才发现的:

- **工具定义的顺序要固定。** 如果你从字典或集合里生成 tools 列表,Python 字典顺序是插入顺序,一般稳定,但有人会按「本次可用工具」动态过滤,过滤后列表变了,前缀就断了。宁可把全部工具都给,用权限层拒绝不该调的。
- **JSON 序列化要稳定。** 工具 schema 或 few-shot 里如果有 `json.dumps`,加上 `sort_keys=True, ensure_ascii=False`。
- **对话历史放在固定部分之后。** 多轮对话时,历史本身也是前缀的一部分:第 3 轮的请求开头和第 2 轮的请求开头一致,所以多轮场景天然命中率高,前提是你没有每轮重写历史(比如每轮都重新摘要一遍)。

改完怎么验证?不用猜,看账本。同一组评测工单跑两遍,`hit%` 那一列应该从个位数涨到几十。

改完再算一次。假设 draft 的 6,000 输入里有 3,500 是固定前缀并且命中,classify 的 1,500 里有 1,200 命中,self_check 的 3,000 里有 2,000 命中(这几个比例是假设,真实值以账本为准):

- 命中 6,700 token × 0.30 / 1,000,000 ≈ 0.0020 元。
- 未命中 3,800 token × 9 / 1,000,000 ≈ 0.0342 元。
- 输出不变 0.0146 元。
- 合计约 0.051 元,比 0.109 元省了一半多,一行业务逻辑都没改。

## 第二招:模型路由,小模型干简单活

第二招更直观:不是每一步都需要最强的模型。分类是从 8 个固定类别里挑一个,自检是判断「这份草稿有没有引用、有没有承诺政策外的东西」,这些是封闭式判断,便宜模型通常够用。起草要读懂检索结果、结合账单数据、写出客户能看懂的话,这一步才值得上大模型。

```python
# supportpilot/agent/routing.py
import os

SMALL = os.getenv("MODEL_SMALL", "deepseek-flash")
LARGE = os.getenv("MODEL_LARGE", "deepseek-v4-pro")

# 默认路由:节点 -> 模型
ROUTES = {
    "classify": SMALL,
    "rewrite_query": SMALL,
    "draft": LARGE,
    "self_check": SMALL,
}

# 这些类别涉及钱和争议,起草和自检都用大模型,宁可贵一点
HIGH_STAKES = {"refund", "billing_dispute", "account_security"}


def pick_model(node: str, state: dict) -> str:
    category = state.get("category")
    if node in ("draft", "self_check") and category in HIGH_STAKES:
        return LARGE
    # 分类节点自己没把握时(Day 47 让它输出了 confidence),下游一律升级
    if node == "draft" and state.get("classify_confidence", 1.0) < 0.6:
        return LARGE
    # 自检没过、回到起草重写时,第二次直接用大模型
    if node == "draft" and state.get("draft_attempts", 0) >= 1:
        return LARGE
    return ROUTES.get(node, LARGE)
```

节点里把写死的模型名换成 `pick_model("draft", state)` 就完成了。

路由能不能用,最终还是看评测分数,不是看我的直觉。一个常见结果是:分类换成小模型后,准确率掉了一两个点,集中在「既像退款又像账单争议」的模糊工单上。这时候有两个选择,要么给分类 prompt 加几个这类边界的 few-shot,要么接受这点损失,因为分类错了后面的自检和转人工还能兜住。这种取舍正是面试里想听的,把你的数据和决定写进 Day 54 的 README。

按路由再算一次(在第一招的基础上):classify 和 self_check 改走 flash,flash 高峰价命中 0.04、未命中 2、输出 8。

- classify:1,200 × 0.04 + 300 × 2 + 60 × 8 = 48 + 600 + 480,即 1,128 / 1,000,000 ≈ 0.0011 元。
- self_check:2,000 × 0.04 + 1,000 × 2 + 80 × 8 = 80 + 2,000 + 640,即 2,720 / 1,000,000 ≈ 0.0027 元。
- draft 还是 pro:3,500 × 0.30 + 2,500 × 9 + 400 × 27 = 1,050 + 22,500 + 10,800,即 34,350 / 1,000,000 ≈ 0.0344 元。
- 合计约 0.038 元。再把批量任务(比如夜里重跑评测)放到空闲时段,还能再打五折。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="三种配置下单工单成本估算对比">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">单工单成本估算(元,高峰价,按文中算式)</text>
  <text x="20" y="72" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">A 全 pro·无缓存</text>
  <rect x="180" y="58" width="380" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="566" y="74" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">0.109</text>
  <text x="20" y="122" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">B + 稳定前缀</text>
  <rect x="180" y="108" width="178" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="364" y="124" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">0.051</text>
  <text x="20" y="172" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">C + 模型路由</text>
  <rect x="180" y="158" width="132" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="318" y="174" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">0.038</text>
  <text x="20" y="212" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">假设的 token 数和命中率,换成你账本里的真实均值再算一遍</text>
</svg>
<figcaption>同一张「典型工单」在三种配置下的估算成本。数字全部来自上文算式,不是实测;实测值填到下面的记录表里。</figcaption>
</figure>

## 账算完了,值不值:Agent 和人工的单工单 ROI

省到 0.04 元一张,听起来很便宜。但招聘方真正关心的问题不是「模型花了多少钱」,而是「上了这个 Agent,一张工单的总成本比纯人工低多少」。今天的 JD 调研里有一家大型游戏公司把「Agent 经济学:成本建模、ROI、Agent vs 人工」直接写进了加分项,海外 JD 里提成本、延迟、ROI 的比例也接近四成。这一节给你一个能套用的算账模板。

先算人工处理一张工单的成本:

- 时薪 = 月薪 × 用工成本系数 ÷ 每月工作小时。用工成本系数把社保、公积金、工位、管理成本都算进去,国内常用 1.3 到 1.6 之间的经验值。
- 单工单人工成本 = 时薪 × 平均处理时长。

再算 Agent 参与后的单工单成本,它不是只有模型费用:

- 模型费用:就是账本里的平均值。
- 基础设施摊销:服务器、数据库、Langfuse 等每月费用 ÷ 每月工单量。
- 人工复核:如果每份草稿都要客服看一眼再发,复核比例 × 复核时长 × 时薪。
- 转人工:Agent 处理不了、转给人从头处理的比例 × 人工全流程成本。
- 出错代价:Agent 答错、客户二次来问或投诉的比例 × 每次出错的处理成本。

拿一组假设数字走一遍(全部是假设,目的是看清哪一项最重要):客服月薪 8,000 元,系数 1.4,每月 174 小时,时薪约 64 元;人工处理一张工单平均 8 分钟,成本约 8.6 元。Agent 这边:模型 0.04 元;服务器每月 300 元、每月 3 万张工单,摊下来 0.01 元;所有草稿人工复核,平均 1.5 分钟,约 1.6 元;转人工率 25%,即 0.25 × 8.6 ≈ 2.15 元;出错率 3%、每次出错额外花 15 分钟处理,即 0.03 × 16 ≈ 0.48 元。合计约 4.3 元,比纯人工的 8.6 元省一半。

这个算式最有意思的地方是:模型费用 0.04 元在 4.3 元里几乎可以忽略。真正决定 ROI 的是转人工率、复核时长和出错率,也就是 Agent 的**质量**。把转人工率从 25% 降到 15%,省下的钱(约 0.86 元一张)是你把模型费用降到零也省不出来的。这就是为什么前面花了整整一周做评测:评测分数直接决定 ROI,token 优化只是锦上添花。面试时被问到「这个 Agent 值不值」,按这个结构答,并且主动指出 ROI 对哪个参数最敏感,会比只报一个 token 成本强得多。

| 项目 | 假设值 | 你的项目(填真实或调研值) |
| --- | --- | --- |
| 人工时薪 | 64 元 | |
| 人工平均处理时长 | 8 分钟 | |
| 模型费用 / 单 | 0.04 元 | |
| 基础设施摊销 / 单 | 0.01 元 | |
| 人工复核比例 × 时长 | 100% × 1.5 分钟 | |
| 转人工率 | 25% | |
| 出错率 × 出错处理时长 | 3% × 15 分钟 | |
| Agent 单工单总成本 | 约 4.3 元 | |
| 相对纯人工节省 | 约 50% | |

转人工率和出错率可以直接从 Day 50 的评测结果里取(评测集里判为「应转人工」和「答错」的比例),这样你的 ROI 表就和评测数据连起来了。

## 别为了省钱把延迟和分数搞坏

优化有三个指标在互相拉扯:分数、延迟、成本。今天两招对延迟的影响方向不同。缓存命中通常让首 token 更快,因为前缀不用重新算。路由到小模型一般也更快。但「自检不过就用大模型重写」会让少数工单多一轮大模型调用,P95 延迟可能反而变长。所以评测时三列一起看,不要只盯着成本那列。

还有一类常见的「省钱」做法我不建议在毕业项目里做:语义缓存,也就是「问题相似就直接返回上次的答案」。客服工单里两个客户问「为什么多扣了我一笔钱」,字面几乎一样,答案却取决于各自的账单。缓存错一次就是把 A 客户的账单信息说给 B 听。Day 38 讲过它适用的场景,这里不适用。

## 动手练习

**步骤**

1. 注册 Langfuse 云版(或按官方文档自托管),把三个环境变量写进 `.env`,运行 `uv run python -c "from langfuse import get_client; print(get_client().auth_check())"`,打印 `True` 再往下走。
2. 按上文改 `app/llm.py`、加 `app/pricing.py`、`app/ledger.py`,给每个节点套上 `@node(...)`,入口套上 `@observe` 和 `propagate_attributes`。
3. 用当前版本(还没做两招优化)跑一遍 Day 50 的评测集,跑完 `get_client().flush()`。在 Langfuse 里随便点开三张工单,确认树的结构是「handle_ticket 下面挂着各节点,节点下面挂着 generation」。
4. 跑 `uv run python scripts/cost_report.py --since <今天日期>`,把结果填进下表的「基线」行。
5. 做第一招(稳定前缀),再跑一遍评测和报表,填「+ 稳定前缀」行。
6. 做第二招(模型路由),再跑一遍,填「+ 路由」行。
7. 在 Langfuse 里找出成本最高的 3 张工单,点开看它们为什么贵(通常是自检反复失败,或者检索结果太长),写两三句结论。

**记录表(留空,填你自己跑出来的值)**

| 配置 | 评测分数 | P50 延迟 | P95 延迟 | 单工单成本 平均 / P95 | 缓存命中率 |
| --- | --- | --- | --- | --- | --- |
| 基线 | | | | | |
| + 稳定前缀 | | | | | |
| + 路由 | | | | | |

**验收标准**

- Langfuse 里每张评测工单是一棵完整的树,没有散落的孤立 generation。
- 账本里所有调用的 `cost_yuan` 都大于 0(等于 0 说明有模型没配价格)。
- 稳定前缀之后,draft 节点的缓存命中率明显高于基线(具体多少取决于你的 prompt 结构,能说清楚为什么是这个数就行)。
- 路由之后评测分数下降不超过你在 Day 43 定的容忍线,如果超了,写下你是加 few-shot 还是回退了哪个节点。
- 能用一分钟向别人讲清楚:钱主要花在哪个节点,你做了什么,省了多少,代价是什么。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| trace | 一次完整请求的全过程记录,这里就是一张工单从进来到回复的所有步骤 |
| span | trace 里的一个步骤,可以嵌套,比如一个 LangGraph 节点 |
| generation | Langfuse 里专指一次模型调用的 span,额外记录 prompt、输出、token、成本 |
| session | 把多条 trace 归成一组,这里按客户 ID 归,能看到同一客户的历次工单 |
| flush | 把 SDK 后台队列里还没上报的事件立即发出去,短命脚本退出前要调 |
| prompt caching | 服务商对重复的 prompt 前缀不再重新计算,按更低的命中价计费 |
| 缓存命中率 | 命中缓存的输入 token 占全部输入 token 的比例 |
| 模型路由 | 按任务难度、风险把请求分给不同价位的模型 |
| P95 | 把所有值从小到大排,第 95% 位置上的值,用来看「慢的那一小撮」有多慢 |
| contextvars | Python 标准库,给每个并发请求保存各自的上下文变量,不互相串 |

## 常见误区

**只看平均成本。** 平均 0.04 元很好看,但如果 5% 的工单因为自检循环花了 0.5 元,这些工单往往也是答得最差的。P95 和最贵的几张要单独看。

**把时间戳放在系统提示第一行。** 这是缓存命中率为零的头号原因。任何每次都变的东西都往后放。

**以为换了 Langfuse 导入就万事大吉。** 不包外层 span、不传 session,得到的是一堆互不相关的单次调用,排查时比日志好不了多少。

**用 Langfuse 推算的成本当账单。** 它不知道 DeepSeek 的高峰空闲价,也不知道你哪些 token 命中了缓存(取决于集成有没有上报这部分)。自己记的账本才是准的,Langfuse 的数字用来看趋势。

**路由规则凭感觉定。** 「分类用小模型肯定够」这句话需要评测分数背书。先跑基线,再改一处,再跑,一次只动一个变量。

**在客服场景用语义缓存省钱。** 相似问题不代表相同答案,账单类问题尤其如此,错一次就是数据泄露。

## 学习资料

### 文档与文章

- [Langfuse · OpenAI (Python) 集成](https://langfuse.com/integrations/model-providers/openai-py):替换导入、设置 session 和 tags、flush 的官方写法,今天的代码基本照着它来,15 分钟。
- [Langfuse · LangChain / LangGraph 集成](https://langfuse.com/integrations/frameworks/langchain):如果你的节点用了 LangChain 模型对象,看 CallbackHandler 那一节。
- [Langfuse · Docker Compose 自托管](https://langfuse.com/self-hosting/deployment/docker-compose):自托管步骤和限制说明,决定云版还是自托管前读一遍。
- [Langfuse · Token 与成本追踪](https://langfuse.com/docs/observability/features/token-and-cost-tracking):成本是怎么推算的,怎么加自定义模型价格。
- [DeepSeek 模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):高峰空闲两档价格,写代码前再查一次。
- [DeepSeek 上下文硬盘缓存](https://api-docs.deepseek.com/zh-cn/guides/kv_cache):缓存怎么判定命中、usage 里的两个字段,10 分钟。
- [Anthropic · Prompt caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching):显式缓存断点的做法,和 DeepSeek 的自动缓存对照着读,面试常问区别。
- [OpenAI · Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching):OpenAI 的自动缓存规则和 `cached_tokens` 字段。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1tUpDzwEr3&autoplay=0&high_quality=1" title="【Langfuse】开源LLM监控平台" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>胖虎遛二狗 · 【Langfuse】开源LLM监控平台 · 约 26 分钟,重点看容器部署和接入后界面上 trace 怎么看,它所在合集还有 prompt 版本管理和评估实验,可以挑着看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV19Z4Q6BExr&autoplay=0&high_quality=1" title="国产大模型API价格比拼:DeepSeek、Qwen、GLM、MiMo、MiniMax、Kimi" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>FutureAI实验室 · 国产大模型API价格比拼:DeepSeek、Qwen、GLM、MiMo、MiniMax、Kimi · 不到 3 分钟,2026 年 8 月的横向对比,帮你选「小模型」那一档的候选。价格以各家官网为准。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/THfB4p2xCFY" title="Langfuse Walkthrough - Full Demo of Agent Tracing, Evals, Experiments and Prompt Management" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Langfuse · Langfuse Walkthrough - Full Demo of Agent Tracing, Evals, Experiments and Prompt Management · 官方完整演示,看 agent tracing 和 sessions 两段,对照你自己的 trace 结构。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/SkM4k4SKvCM" title="Prompt Caching Explained: Stop Overpaying for AI Agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hugging Face · Prompt Caching Explained: Stop Overpaying for AI Agents · 讲为什么 Agent 场景特别适合缓存,以及前缀被破坏的几种方式。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 9 章 Inference Optimization 里讲 prompt caching 的部分,第 10 章 AI Engineering Architecture and User Feedback 讲监控与可观测,合计 1.5 小时。
- Michael Albada《Building Applications with AI Agents》(O'Reilly, 2025):第 10 章 Monitoring in Production,讲 Agent 上线后看什么指标。

### 开源项目与代码

- [langfuse/langfuse](https://github.com/langfuse/langfuse):Langfuse 本体,自托管用的 `docker-compose.yml` 就在根目录。
- [BerriAI/litellm](https://github.com/BerriAI/litellm):统一多家模型接口的代理,自带路由、重试和成本统计,看它的 [routing 文档](https://docs.litellm.ai/docs/routing) 了解生产里路由一般做到什么程度。
- [lm-sys/RouteLLM](https://github.com/lm-sys/RouteLLM):用学出来的路由器在强弱模型之间分流的研究项目,读 README 就够,知道「路由也能训练」这件事,面试时可以提。

## 自测

1. SupportPilot 每张工单都打出了 trace,但在 Langfuse 里看到的是一堆互不相关的 generation,原因最可能是什么?

<details><summary>答案</summary>

只换了 `langfuse.openai` 的导入,没有在入口用 `@observe` 开外层 span(或者节点没有套 span),于是每次模型调用都各自成为一条 trace。解决办法是入口函数加 `@observe(name="handle_ticket")`,节点函数也加,让调用在同一个上下文里嵌套。

</details>

2. 你的 draft 节点每次输入 6,000 token,其中系统提示 3,000 token 每次都一样,但账本显示命中率只有 2%。列出两个最可能的原因。

<details><summary>答案</summary>

一是系统提示的开头放了会变的内容,比如当前时间、客户名、工单号,导致前缀从第一个字就不同。二是工具定义或 few-shot 每次生成的顺序或序列化结果不一样(比如按本次可用工具动态过滤、`json.dumps` 没固定 key 顺序)。另外还可能是两次请求间隔太久,缓存已经被清掉了。

</details>

3. 按文中 DeepSeek 高峰价,一次 v4-pro 调用输入 8,000 token(其中 5,000 命中)、输出 500 token,花多少钱?同样的调用放在空闲时段呢?

<details><summary>答案</summary>

高峰:5,000 × 0.30 + 3,000 × 9 + 500 × 27 = 1,500 + 27,000 + 13,500 = 42,000,除以一百万得 0.042 元。空闲时段打五折,0.021 元。

</details>

4. (面试题)「你的 Agent 一张工单成本多少?怎么降下来的?」请用你的项目回答,控制在一分钟。

<details><summary>答案</summary>

答题结构:先给基线数字和口径(比如「按 DeepSeek 高峰价,基线平均 X 元、P95 Y 元,钱主要花在起草节点,占 Z%」),再讲两招:稳定前缀让缓存命中率从 A 到 B,模型路由让分类和自检走小模型;然后给结果(成本降到多少,评测分数变化多少,P95 延迟变化多少);最后讲取舍,比如高风险类别仍然用大模型、没有做语义缓存的原因。所有数字必须来自你自己的记录表,面试官很可能追问「这个数怎么测的」。

</details>

5. (面试题)「这个 Agent 上线后能给公司省多少钱?」你会怎么算?哪个参数对结果影响最大?

<details><summary>答案</summary>

按「人工单工单成本」对比「Agent 单工单总成本」算。后者包括模型费用、基础设施摊销、人工复核、转人工(转人工率 × 人工全流程成本)和出错代价。通常模型费用占比极小,影响最大的是转人工率、复核时长和出错率,也就是 Agent 的质量,所以提升评测分数比压 token 成本更能改善 ROI。回答时给出你的假设值和来源,并说明哪些是估计。

</details>

6. 有人建议对「常见问题」做语义缓存,问题向量相似度超过 0.95 就直接返回历史答案。在 SupportPilot 里你会怎么回应?

<details><summary>答案</summary>

不在工单回复上用。客服工单的答案往往依赖客户自己的账单、订阅状态,字面相似的两个问题答案可以完全不同,缓存命中等于把 A 客户的信息给了 B,是数据泄露。如果要用,只能用在完全不含个人数据的环节,比如对知识库 FAQ 的检索结果做缓存,而不是对最终回复做缓存。

</details>

## 明天预告

Day 53 · 安全加固与上线:注入测试、权限、Docker 部署。SupportPilot 要第一次放到公网上让别人用,在这之前要先当一回攻击者:往工单正文和知识库文章里埋指令,看它会不会把别的客户的账单说出来、会不会绕过审批直接退款。然后用 Docker Compose 把服务、数据库、前端一起部署到云服务器,加上限流和每日额度,防止 demo 被人刷爆你的 API 账户。
