---
title: 'Day 396 · 成本(一):一张工单花多少钱'
description: '成本优化的第一步是测量。从 DeepSeek 响应的 usage 里读出每次调用的 token,按 2026 年 10 月的峰谷价格写一个计价函数,给 Day 394 的工单 worker 装上记账,算出每张工单几分钱、钱花在输入还是输出。最后用崩溃实验揭穿一个漏账的坑:只看图的状态记账,崩溃时白调的那次模型不会出现在账上。'
pubDate: 2026-10-22
regime: none
tags: ['cost', 'tokens', 'deepseek', 'agent-zero']
series: 'agent-zero'
day: 396
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 395](/blog/agent-zero/day-395-temporal/) 在本机起了 Temporal,把工单流程改写成 workflow 加 activity,看到它靠事件历史重放让已完成的 activity 不重跑,也看到「正在跑的那一个」照样会重做。这几天反复出现一句话:「崩了之后 classify 没有重调模型,省了一次钱」。可到底省了多少?一次模型调用是一分钱还是一毛钱?一张工单总共花多少?钱主要花在哪?这些问题我们一直没有正面回答。今天开始连着三课讲成本,第一课只做一件事:**把账算清楚**。不算清楚就去优化,很可能优化错地方。

## 今天要解决的问题

今天结束时你应该能:

1. 从 openai SDK 返回的 `resp.usage` 里读出输入 token、输出 token、缓存命中 token,并说清 DeepSeek 按这三样怎么收费,包括 2026 年新出的峰谷价格。
2. 写一个计价函数 `call_cost`,输入 token 数和时段,输出人民币金额,并用手算验证它。
3. 给 Day 394 的工单 worker 装上记账,跑一批工单,打印每张工单的账单和「输入、输出各占多少」。
4. 用崩溃实验证明「从图的状态里记账会漏掉白调的那一次」,并改成调用一返回就写日志的记账方式。

预计用时 2.5 小时。前置:[Day 107](/blog/agent-zero/day-107-tokens-1/) 和 [Day 108](/blog/agent-zero/day-108-tokens-2/) 的 token、[Day 304](/blog/agent-zero/day-304-lg-reducer/) 的 reducer、[Day 393](/blog/agent-zero/day-393-resume/) 的崩溃开关、[Day 394](/blog/agent-zero/day-394-ticket-worker/) 的 `ticket_agent.py`、`ticket_worker.py`、`ticket_intake.py`。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先从前端看:Network 面板的 Size 列

在 DevTools 的 Network 面板里,每个请求都有一列 Size,告诉你这次传了多少字节。做性能优化时你会先按 Size 排序,看哪个资源最大,而不是凭感觉去压缩一张 2KB 的图标。

模型 API 的计费单位是 token(Day 107 讲过,模型看到的不是字,是 token)。每次调用的响应里都带一个 `usage` 字段,就是这次请求的「Size 列」:发过去多少 token、回来多少 token。成本优化的第一步和性能优化一样:先把每个请求的 usage 记下来,按工单、按节点汇总,看钱花在哪,再决定优化什么。

旧课里我见过有人花一周给系统加语义缓存,最后发现钱 80% 花在起草那一步的长上下文上,缓存根本碰不到那里。今天这课就是为了不犯这种错。

## 第一步:价格表和账单公式

一次模型调用的价格由三部分组成:

```text
一次调用的钱 = 缓存命中的输入 token × 命中单价
             + 没命中的输入 token × 未命中单价
             + 输出 token × 输出单价
```

「缓存命中」是明天 Day 397 的主题,今天先知道有这么一档、而且便宜得多就行:同样的开头(比如很长的系统提示词)之前发过,厂商那边存着算好的中间结果,这部分输入就按很低的价格收。

下面是我 2026 年 10 月 22 日在 [DeepSeek 官方定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)查到的价格,单位是**人民币元 / 百万 token**:

| 模型 | 时段 | 输入(缓存命中) | 输入(缓存未命中) | 输出 |
| --- | --- | --- | --- | --- |
| `deepseek-flash` | 高峰 | 0.04 | 2 | 8 |
| `deepseek-flash` | 空闲 | 0.02 | 1 | 4 |
| `deepseek-v4-pro` | 高峰 | 0.30 | 9 | 27 |
| `deepseek-v4-pro` | 空闲 | 0.15 | 4.5 | 13.5 |

页面上的规则:高峰时段是北京时间周一到周五(不含法定节假日)的 9:00–12:00 和 14:00–18:00,其余时间(包括周末和法定节假日全天)都是空闲时段,空闲价是高峰价的一半。这个峰谷价格是 DeepSeek 2026 年 9 月新出的规则,价格变得很快,你学到这里时请自己再去看一眼。

从表里先读出三个数量关系,后面会反复用到:

- 输出比输入贵:flash 的输出单价是未命中输入的 4 倍(8 比 2)。
- 缓存命中比未命中便宜得多:flash 是 50 倍(2 比 0.04)。
- pro 比 flash 贵:未命中输入 4.5 倍,输出 3.4 倍。

## 第二步:usage 里到底有什么

先不碰 worker,用最小的脚本调一次模型,把 `usage` 整个打印出来:

```python
# agent-zero-lab/part07/usage_peek.py
import json
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
resp = client.chat.completions.create(
    model=os.environ["LLM_MODEL"],
    messages=[{"role": "user", "content": "把工单分成 billing/tech/other 之一,只回一个词:INV-0123 被重复扣款,请退款"}],
    max_tokens=5,
    extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY", "{}")),
)
print(resp.choices[0].message.content)
print(resp.usage.model_dump() if resp.usage else None)
```

<div class="line-notes">

- `from openai import OpenAI` 同步版客户端,一次性的小脚本不需要 async。
- `messages=[{"role": "user", "content": "把工单分成 billing/tech/other 之一,只回一个词:INV-0123 被重复扣款,请退款"}],` 和 Day 394 classify 节点同样的提示词,只是工单内容写死了。
- `max_tokens=5,` 最多输出 5 个 token,分类只要一个词。
- `print(resp.usage.model_dump() if resp.usage else None)` `usage` 是一个 pydantic 对象([Day 52](/blog/agent-zero/day-052-pydantic-2/) 学过),`.model_dump()` 把它变成普通字典,方便看全部字段。`usage` 理论上可能是 None(有的兼容接口不返回),所以先判断一下。

</div>

```bash
cd agent-zero-lab
uv run python -m part07.usage_peek
```

```text
billing
{'completion_tokens': 2, 'prompt_tokens': 34, 'total_tokens': 36, 'completion_tokens_details': None, 'prompt_tokens_details': {'audio_tokens': None, 'cache_write_tokens': None, 'cached_tokens': 0, 'image_tokens': None, 'text_tokens': None}, 'prompt_cache_hit_tokens': 0, 'prompt_cache_miss_tokens': 34}
```

字段不少,和钱有关的是这几个:

| 字段 | 这次的值 | 意思 |
| --- | --- | --- |
| `prompt_tokens` | 34 | 输入一共多少 token |
| `completion_tokens` | 2 | 输出多少 token。`billing` 这个词被切成了 2 个 |
| `prompt_cache_hit_tokens` | 0 | 输入里命中缓存的部分,DeepSeek 自己加的字段 |
| `prompt_cache_miss_tokens` | 34 | 输入里没命中的部分。和上一个加起来等于 `prompt_tokens` |
| `prompt_tokens_details.cached_tokens` | 0 | OpenAI 标准格式里的命中数。DeepSeek 两种都给了 |

只用 34 个 token 是因为提示词很短。手算一下这次花了多少(按高峰价):

```text
34 × 2 / 1,000,000 + 2 × 8 / 1,000,000
= 0.000068 + 0.000016
= 0.000084 元
```

不到万分之一元,也就是 0.0084 分钱。别急着觉得「这也太便宜了,不用算」,后面会看到真实的 Agent 一次调用的输入是这个的几十倍,而且一天几万张工单。

## 第三步:计价函数

把价格表和公式写成代码。`period_at` 根据调用发生的时间判断是高峰还是空闲,`call_cost` 算钱:

```python
# agent-zero-lab/part07/pricing.py
from datetime import datetime, timedelta, timezone

BEIJING = timezone(timedelta(hours=8))
# 元 / 百万 token:(缓存命中输入, 未命中输入, 输出)。2026 年 10 月 22 日从 DeepSeek 定价页抄的
PRICES = {
    "deepseek-flash": {"peak": (0.04, 2.0, 8.0), "idle": (0.02, 1.0, 4.0)},
    "deepseek-v4-pro": {"peak": (0.30, 9.0, 27.0), "idle": (0.15, 4.5, 13.5)},
}


def period_at(when: datetime) -> str:
    bj = when.astimezone(BEIJING)
    if bj.weekday() >= 5:  # 周六、周日
        return "idle"
    if 9 <= bj.hour < 12 or 14 <= bj.hour < 18:
        return "peak"
    return "idle"


def call_cost(model: str, prompt: int, hit: int, completion: int, period: str) -> float:
    p_hit, p_miss, p_out = PRICES[model][period]
    return (hit * p_hit + (prompt - hit) * p_miss + completion * p_out) / 1_000_000
```

<div class="line-notes">

- `from datetime import datetime, timedelta, timezone` 日期时间三件套:`datetime` 是一个时刻,`timedelta` 是一段时长,`timezone` 是时区。
- `BEIJING = timezone(timedelta(hours=8))` 北京时间是 UTC+8。DeepSeek 的峰谷按北京时间划分,而我们记录调用时间用的是 UTC,比较前要换算。
- `PRICES = {` 两层字典:先按模型,再按时段,值是一个三元组。相当于 JS 的 `{ "deepseek-flash": { peak: [0.04, 2, 8], ... } }`。
- `"deepseek-flash": {"peak": (0.04, 2.0, 8.0), "idle": (0.02, 1.0, 4.0)},` 顺序固定是「命中、未命中、输出」,和上面价格表一列一列对应。
- `def period_at(when: datetime) -> str:` 给一个时刻,返回 `"peak"` 或 `"idle"`。
- `bj = when.astimezone(BEIJING)` 不管传进来的是什么时区,先换成北京时间。传进来的时间必须带时区信息,不带的话 Python 会当成本机时区,在服务器上(通常是 UTC)就会算错 8 小时。
- `if bj.weekday() >= 5:  # 周六、周日` `weekday()` 周一是 0、周日是 6,大于等于 5 就是周末。注意这和 JS 的 `getDay()`(周日是 0)不一样。
- `if 9 <= bj.hour < 12 or 14 <= bj.hour < 18:` Python 可以连着写比较,`9 <= h < 12` 等于 JS 的 `9 <= h && h < 12`。`< 12` 不含 12 点整,所以 12:00 已经是空闲时段。
- `return "idle"` 其余时间都是空闲。这里**没有处理法定节假日**,练习 3 会补上。
- `p_hit, p_miss, p_out = PRICES[model][period]` 解构三元组。模型名写错会抛 `KeyError`,这是故意的:宁可报错,也不要悄悄按 0 元算。
- `return (hit * p_hit + (prompt - hit) * p_miss + completion * p_out) / 1_000_000` 第一步的公式原样搬过来。`prompt - hit` 就是没命中的部分。`1_000_000` 里的下划线只是为了好读,和 JS 的 `1_000_000` 一样。

</div>

写个检查脚本,用几个边界时间和上一步手算的数验证它:

```python
# agent-zero-lab/part07/pricing_check.py
from datetime import datetime

from part07.pricing import BEIJING, call_cost, period_at

for t in ["2026-10-22 10:30", "2026-10-22 12:30", "2026-10-22 17:59", "2026-10-24 10:30"]:
    when = datetime.strptime(t, "%Y-%m-%d %H:%M").replace(tzinfo=BEIJING)
    print(t, when.strftime("%a"), period_at(when))

for period in ("peak", "idle"):
    yuan = call_cost("deepseek-flash", prompt=34, hit=0, completion=2, period=period)
    print(period, f"{yuan:.8f} 元")
```

<div class="line-notes">

- `for t in ["2026-10-22 10:30", "2026-10-22 12:30", "2026-10-22 17:59", "2026-10-24 10:30"]:` 四个故意挑的时间:上午高峰中间、午休、下午高峰最后一分钟、周六上午。
- `when = datetime.strptime(t, "%Y-%m-%d %H:%M").replace(tzinfo=BEIJING)` `strptime` 按格式把字符串解析成时刻(str parse time);`.replace(tzinfo=...)` 给它贴上北京时区。
- `print(t, when.strftime("%a"), period_at(when))` `%a` 是星期几的英文缩写,用来确认日期没弄错。
- `yuan = call_cost("deepseek-flash", prompt=34, hit=0, completion=2, period=period)` 用第二步实测的 34 和 2。
- `print(period, f"{yuan:.8f} 元")` `:.8f` 保留 8 位小数,不然这么小的数会显示成科学计数法。

</div>

```bash
uv run python -m part07.pricing_check
```

```text
2026-10-22 10:30 Thu peak
2026-10-22 12:30 Thu idle
2026-10-22 17:59 Thu peak
2026-10-24 10:30 Sat idle
peak 0.00008400 元
idle 0.00004200 元
```

高峰价 0.000084 元,和上一步手算的一样;空闲价正好一半。

## 第四步:给 worker 装上记账

要算一张工单的账,就要把这张工单每次模型调用的 usage 都留下来。最顺手的地方是图的状态:Day 394 的 `TicketState` 里加一个 `llm_calls` 列表,用 reducer 追加,每个调模型的节点把这次的 usage 塞进去。checkpoint 会把它和状态一起存进 Postgres,事后随时能读。

`ticket_agent.py` 改三处(没列出来的部分和 Day 394 一样):

```python
# agent-zero-lab/part07/ticket_agent.py(改动部分)
from datetime import datetime, timezone

class TicketState(TypedDict):
    ticket_id: str
    text: str
    steps: Annotated[list[str], operator.add]
    category: NotRequired[str]
    invoice: NotRequired[dict]
    refund: NotRequired[dict]
    draft: NotRequired[str]
    llm_calls: Annotated[list[dict], operator.add]


async def ask_metered(node: str, prompt: str, max_tokens: int) -> tuple[str, dict]:
    resp = await llm.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=max_tokens,
        extra_body=EXTRA,
    )
    u = resp.usage
    call = {
        "node": node,
        "model": resp.model,
        "at": datetime.now(timezone.utc).isoformat(),
        "prompt": u.prompt_tokens if u else 0,
        "hit": getattr(u, "prompt_cache_hit_tokens", 0) or 0,
        "completion": u.completion_tokens if u else 0,
    }
    return (resp.choices[0].message.content or "").strip(), call


async def ask(prompt: str, max_tokens: int) -> str:
    text, _ = await ask_metered("ask", prompt, max_tokens)
    return text

    # build_graph 里面的 classify 和 draft:
    async def classify(state: TicketState) -> dict:
        word, call = await ask_metered("classify", f"把工单分成 billing/tech/other 之一,只回一个词:{state['text']}", 5)
        category = word if word in ("billing", "tech", "other") else "other"
        return {"category": category, "steps": ["classify"], "llm_calls": [call]}

    async def draft(state: TicketState) -> dict:
        facts = facts_for_model(state)
        text, call = await ask_metered(
            "draft",
            "你是云簿 CloudLedger 的客服。根据事实写一段不超过 80 字的中文回复,"
            f"事实里没有的不要承诺。\n工单:{state['text']}\n事实:{json.dumps(facts, ensure_ascii=False)}",
            200,
        )
        maybe_crash("draft")
        return {"draft": text, "steps": ["draft"], "llm_calls": [call]}
```

<div class="line-notes">

- `from datetime import datetime, timezone` 记录调用时间要用。加在文件开头的 import 区。
- `llm_calls: Annotated[list[dict], operator.add]` 和 `steps` 一样的追加 reducer。每个节点返回 `{"llm_calls": [这次的记录]}`,LangGraph 把它拼到已有列表后面。注意它不是 `NotRequired`,所以 worker 给图的初始输入里必须带上 `"llm_calls": []`,下面会改。
- `async def ask_metered(node: str, prompt: str, max_tokens: int) -> tuple[str, dict]:` 原来的 `ask` 只返回文本;新函数同时返回文本和一条 usage 记录。`tuple[str, dict]` 就是「两个值」,相当于 TS 的 `[string, object]`。
- `u = resp.usage` 第二步看到的那个对象。
- `"node": node,` 哪个节点调的。汇总时按它分组,才知道钱花在 classify 还是 draft。
- `"model": resp.model,` 用响应里的模型名,不用请求里的。实测返回的是 `deepseek-flash`。以后做模型路由(Day 399),同一张工单不同节点用不同模型,账单才不会算错单价。
- `"at": datetime.now(timezone.utc).isoformat(),` 调用时刻,UTC,转成 ISO 8601 字符串(形如 `2026-10-22T11:07:08.337835+00:00`)存起来。峰谷价格要靠它判断。存字符串而不是 datetime 对象,是因为它要进 checkpoint、进 JSON,字符串最稳。
- `"prompt": u.prompt_tokens if u else 0,` usage 可能是 None,兜底为 0。
- `"hit": getattr(u, "prompt_cache_hit_tokens", 0) or 0,` `prompt_cache_hit_tokens` 是 DeepSeek 自己加的字段,openai SDK 的类型定义里没有它,直接写 `u.prompt_cache_hit_tokens` 类型检查会报红,换别的厂商还可能真没有这个属性。`getattr(对象, 名字, 默认值)` 是「有就取、没有就用默认值」,相当于 JS 的 `u?.prompt_cache_hit_tokens ?? 0`。后面的 `or 0` 处理「有这个字段但值是 None」的情况。
- `async def ask(prompt: str, max_tokens: int) -> str:` 保留旧的 `ask`,内部转给 `ask_metered`、丢掉记录。Day 395 的 `temporal_acts.py` 还在用它,这样不用改那边。
- `text, _ = await ask_metered("ask", prompt, max_tokens)` `_` 是约定俗成的「这个值我不要」。
- `return {"category": category, "steps": ["classify"], "llm_calls": [call]}` 把这次的记录交给 reducer。
- `maybe_crash("draft")` 新加的崩溃埋点,放在**模型已经调完、节点还没返回**的位置。第七步要用它做漏账实验。

</div>

`ticket_worker.py` 只改一行,给初始输入加上空列表:

```python
# agent-zero-lab/part07/ticket_worker.py(process_ticket 里改这一行)
            graph_input = {"ticket_id": ticket_id, "text": row[0], "steps": [], "llm_calls": []}
```

<div class="line-notes">

- `graph_input = {"ticket_id": ticket_id, "text": row[0], "steps": [], "llm_calls": []}` 不加的话 basedpyright 会标红,说这个字典不符合 `TicketState`(缺了必填的 `llm_calls`)。

</div>

跑一批,和 Day 394 一样四种工单各一张:

```bash
uv run python -m part07.ticket_intake M 4
uv run arq --burst part07.ticket_worker.WorkerSettings
```

```text
M-01 入队
M-02 入队
M-03 入队
M-04 入队
...
19:05:37:   1.01s ← ticket-M-04:process_ticket ● 'needs_human'
19:05:37:   1.63s ← ticket-M-01:process_ticket ● 'draft_ready'
19:05:37:   1.70s ← ticket-M-02:process_ticket ● 'draft_ready'
19:05:38:   1.93s ← ticket-M-03:process_ticket ● 'draft_ready'
```

注意时间是晚上 7 点,空闲时段。

## 第五步:打印每张工单的账单

worker 跑完,每张工单的 `llm_calls` 都在 checkpoint 里。写个脚本读出来,逐条算钱:

```python
# agent-zero-lab/part07/ticket_bill.py
import asyncio
import sys
from datetime import datetime

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

from part07.pricing import call_cost, period_at
from part07.ticket_agent import build_graph
from part07.ticket_worker import DSN


async def bill(graph, ticket_id: str) -> float:
    config: RunnableConfig = {"configurable": {"thread_id": f"ticket-{ticket_id}"}}
    snap = await graph.aget_state(config)
    calls = snap.values.get("llm_calls", [])
    total = 0.0
    print(f"工单 {ticket_id}  分类={snap.values.get('category')}  模型调用 {len(calls)} 次")
    for c in calls:
        period = period_at(datetime.fromisoformat(c["at"]))
        yuan = call_cost("deepseek-flash", c["prompt"], c["hit"], c["completion"], period)
        total += yuan
        print(f"  {c['node']:<9} 输入 {c['prompt']:>4}(命中 {c['hit']:>3}) 输出 {c['completion']:>4}  {period}  {yuan * 100:.4f} 分")
    print(f"  合计 {total * 100:.4f} 分")
    return total


async def main(ticket_ids: list[str]):
    async with (
        AsyncPostgresSaver.from_conn_string(DSN) as saver,
        AsyncConnectionPool(DSN, connection_class=AsyncConnection, kwargs={"autocommit": True}) as pool,
    ):
        graph = build_graph(pool, checkpointer=saver)
        totals = [await bill(graph, tid) for tid in ticket_ids]
    avg = sum(totals) / len(totals)
    print(f"{len(totals)} 张工单平均 {avg * 100:.4f} 分/张,10 万张约 {avg * 100_000:.2f} 元")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:]))
```

<div class="line-notes">

- `from part07.ticket_worker import DSN` 和 worker 读同一个库。
- `async def bill(graph, ticket_id: str) -> float:` 打印一张工单的账单,返回合计金额(元)。
- `snap = await graph.aget_state(config)` 和 worker 里一样的读法,拿到这张工单最新的状态。
- `calls = snap.values.get("llm_calls", [])` Day 394 跑的旧工单没有这个字段,`.get` 给空列表,不会报错。
- `period = period_at(datetime.fromisoformat(c["at"]))` 把存的 ISO 字符串变回带时区的时刻,再判断峰谷。`fromisoformat` 相当于 JS 的 `new Date(isoString)`。
- `yuan = call_cost("deepseek-flash", c["prompt"], c["hit"], c["completion"], period)` 这里模型名先写死成 flash。更严谨的写法是用 `c["model"]`,但那要求价格表里的名字和厂商返回的完全一致,练习 1 会处理。
- `print(f"  {c['node']:<9} 输入 {c['prompt']:>4}(命中 {c['hit']:>3}) 输出 {c['completion']:>4}  {period}  {yuan * 100:.4f} 分")` `:<9` 左对齐占 9 格,`:>4` 右对齐占 4 格,让几行对得整齐,相当于 JS 的 `padEnd(9)` / `padStart(4)`。`yuan * 100` 换成「分」,数字好读一些。
- `async with (` Day 393 讲过的写法,一次打开两个异步上下文。`build_graph` 需要连接池参数,这里虽然不跑图,也要给一个。
- `totals = [await bill(graph, tid) for tid in ticket_ids]` 列表推导式里也能 `await`,一张一张按顺序算。
- `print(f"{len(totals)} 张工单平均 {avg * 100:.4f} 分/张,10 万张约 {avg * 100_000:.2f} 元")` 粗略外推:平均每张多少乘以 10 万。

</div>

```bash
uv run python -m part07.ticket_bill M-01 M-02 M-03 M-04
```

```text
工单 M-01  分类=billing  模型调用 2 次
  classify  输入   45(命中   0) 输出    2  idle  0.0053 分
  draft     输入  117(命中   0) 输出   49  idle  0.0313 分
  合计 0.0366 分
工单 M-02  分类=billing  模型调用 2 次
  classify  输入   34(命中   0) 输出    2  idle  0.0042 分
  draft     输入  107(命中   0) 输出   32  idle  0.0235 分
  合计 0.0277 分
工单 M-03  分类=tech  模型调用 2 次
  classify  输入   30(命中   0) 输出    1  idle  0.0034 分
  draft     输入   55(命中   0) 输出   34  idle  0.0191 分
  合计 0.0225 分
工单 M-04  分类=billing  模型调用 1 次
  classify  输入   36(命中   0) 输出    2  idle  0.0044 分
  合计 0.0044 分
4 张工单平均 0.0228 分/张,10 万张约 22.80 元
```

挑 M-01 的 draft 手算一遍,确认脚本没算错(空闲价):`117 × 1 + 49 × 4 = 117 + 196 = 313`,再除以一百万,是 0.000313 元,也就是 0.0313 分。对得上。

几件值得注意的事:

- **draft 是大头。** 每张工单里 draft 花的钱都是 classify 的 6 倍左右(5.6 到 5.9 倍)。它的输入更长(要带上事实),输出也长得多(一段回复对比一个词)。
- **转人工的工单也花钱。** M-04 在查发票时失败了,没走到 draft,但 classify 已经花了 0.0044 分。失败的工单不是免费的。
- **我们这个系统非常便宜。** 平均每张 0.0228 分,10 万张 22.8 元(空闲价)。这是因为提示词很短、只调两次模型。真实的 Agent 远不止这些,第六步就会看到。

## 第六步:钱花在输入还是输出

再写一个小脚本,把一批工单的钱拆成输入和输出两部分:

```python
# agent-zero-lab/part07/bill_split.py
import asyncio
import sys

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from part07.pricing import PRICES
from part07.ticket_worker import DSN


async def main(ticket_ids: list[str]):
    p_hit, p_miss, p_out = PRICES["deepseek-flash"]["peak"]
    inp = out = 0.0
    async with AsyncPostgresSaver.from_conn_string(DSN) as saver:
        for tid in ticket_ids:
            config: RunnableConfig = {"configurable": {"thread_id": f"ticket-{tid}"}}
            tup = await saver.aget_tuple(config)
            if tup is None:
                continue
            for c in tup.checkpoint["channel_values"].get("llm_calls", []):
                inp += (c["hit"] * p_hit + (c["prompt"] - c["hit"]) * p_miss) / 1_000_000
                out += c["completion"] * p_out / 1_000_000
    total = inp + out
    print(f"输入 {inp * 100:.4f} 分({inp / total:.0%})  输出 {out * 100:.4f} 分({out / total:.0%})")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:]))
```

<div class="line-notes">

- `p_hit, p_miss, p_out = PRICES["deepseek-flash"]["peak"]` 这里统一用高峰价。算的是比例,空闲价每一项都正好减半,比例不变,所以用哪个都一样。
- `inp = out = 0.0` 连等赋值,两个变量都是 0.0。
- `tup = await saver.aget_tuple(config)` 换个读法:不建图,直接问 checkpointer 要这个 thread 最新的 checkpoint。比上一个脚本少了连接池和建图,只是读数据时更轻。
- `for c in tup.checkpoint["channel_values"].get("llm_calls", []):` checkpoint 里的状态存在 `channel_values` 这个键下面,LangGraph 把每个状态字段叫一个 channel(通道)。
- `print(f"输入 {inp * 100:.4f} 分({inp / total:.0%})  输出 {out * 100:.4f} 分({out / total:.0%})")` `:.0%` 把小数格式化成不带小数位的百分比,0.46 打印成 `46%`。

</div>

```bash
uv run python -m part07.bill_split M-01 M-02 M-03 M-04
```

```text
输入 0.0848 分(46%)  输出 0.0976 分(54%)
```

输出比输入还多一点。这和很多文章里说的「Agent 的钱大头在输入」对不上。原因是我们的提示词太短了:classify 只有三十几个 token,draft 一百个出头。真实系统里每次调用都要带上一大段系统提示词(客服规范、语气要求、禁止事项)、工具定义、检索到的知识库片段,一次调用的输入轻松上几千 token。

模拟一下:写一份 120 条规范的长提示词(大约 2400 token,真实系统里很常见),用它起草三张工单的回复:

```python
# agent-zero-lab/part07/long_prompt_cost.py
import asyncio

from part07.pricing import PRICES, call_cost
from part07.ticket_agent import ask_metered

RULES = [
    "称呼客户用「您」,不用「亲」。",
    "退款申请提交后要说明需要主管审批,不承诺到账时间。",
    "涉及金额时写清楚币种和小数点后两位。",
    "不要在回复里出现内部系统名、表名和字段名。",
    "客户情绪激动时先致歉再说明处理进度。",
    "技术问题要告诉客户已转给技术团队,并给出工单号。",
    "不能确认的事实一律不写,改成「我们会核实后回复您」。",
    "回复结尾不要加营销内容。",
]
POLICY = "\n".join(f"第 {i + 1} 条:{RULES[i % len(RULES)]}" for i in range(120))
TICKETS = ["INV-0123 被重复扣款,请退款", "INV-0456 是重复扣费,申请退款", "导出 PDF 发票的时候页面一直转圈"]


async def main():
    for text in TICKETS:
        prompt = f"你是云簿 CloudLedger 的客服,严格遵守下面的规范。\n{POLICY}\n\n工单:{text}\n写一段不超过 80 字的回复。"
        _, c = await ask_metered("draft", prompt, 200)
        no_cache = call_cost("deepseek-flash", c["prompt"], 0, c["completion"], "peak")
        real = call_cost("deepseek-flash", c["prompt"], c["hit"], c["completion"], "peak")
        out_share = c["completion"] * PRICES["deepseek-flash"]["peak"][2] / 1_000_000 / no_cache
        print(f"输入 {c['prompt']}(命中 {c['hit']}) 输出 {c['completion']}  不算缓存 {no_cache * 100:.4f} 分(输出占 {out_share:.0%})  实际 {real * 100:.4f} 分")


asyncio.run(main())
```

<div class="line-notes">

- `RULES = [` 八条规范,下面循环拼成 120 条,模拟一份很长的客服手册。
- `POLICY = "\n".join(f"第 {i + 1} 条:{RULES[i % len(RULES)]}" for i in range(120))` `"\n".join(...)` 用换行把一串字符串连起来,相当于 JS 的 `arr.join("\n")`。括号里是生成器表达式,和列表推导式一样,只是不先建出整个列表。
- `prompt = f"你是云簿 CloudLedger 的客服,严格遵守下面的规范。\n{POLICY}\n\n工单:{text}\n写一段不超过 80 字的回复。"` 长规范在前,工单在后。这个顺序明天会讲为什么重要。
- `_, c = await ask_metered("draft", prompt, 200)` 只要 usage 记录,不要回复文本。
- `no_cache = call_cost("deepseek-flash", c["prompt"], 0, c["completion"], "peak")` 假设一个 token 都没命中缓存,算出「原价」。
- `real = call_cost("deepseek-flash", c["prompt"], c["hit"], c["completion"], "peak")` 按实际命中数算。
- `out_share = c["completion"] * PRICES["deepseek-flash"]["peak"][2] / 1_000_000 / no_cache` 输出那部分的钱占原价的比例。`[2]` 取三元组的第三个,也就是输出单价。
- `asyncio.run(main())` 这个脚本只是实验,没写 main guard;它也不会被别的文件 import。

</div>

```bash
uv run python -m part07.long_prompt_cost
```

```text
输入 2369(命中 2176) 输出 32  不算缓存 0.4994 分(输出占 5%)  实际 0.0729 分
输入 2369(命中 2176) 输出 42  不算缓存 0.5074 分(输出占 7%)  实际 0.0809 分
输入 2365(命中 2176) 输出 26  不算缓存 0.4938 分(输出占 4%)  实际 0.0673 分
```

这下比例完全反过来了:输入 2369 token,输出只有三四十,**输出只占 4% 到 7%,输入占九成以上**。一次起草按原价要 0.5 分,是我们短提示词版本 draft(0.0313 分空闲价,换成高峰价约 0.0626 分)的 8 倍。

再看「命中」那一列:2369 里有 2176 个 token 命中了缓存。我在写这一课之前已经用同样的提示词跑过几次,前面那 2176 个 token 的开头一模一样,DeepSeek 认出来了,按 0.04 元/百万收,于是实际只花了 0.07 分左右,是原价的七分之一。你第一次跑的时候,第一条大概率是 0 命中,第二、三条才开始命中。这就是明天 Day 397 要讲的 prompt caching:同一个长开头,第一次原价,之后几乎免费。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="两种提示词下一次起草调用的成本构成对比:短提示词时输入 117 token、输出 49 token,输出的钱占一半以上;长提示词时输入约 2369 token、输出约 32 token,输入的钱占九成以上,其中大部分是可以命中缓存的长规范">
<text x="20" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">一次 draft 调用,按 flash 高峰价、不算缓存</text>
<text x="20" y="70" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">短提示词</text>
<rect x="110" y="56" width="40" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="150" y="56" width="67" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="230" y="72" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">0.063 分:输入 117 · 输出 49(输出占 63%)</text>
<text x="20" y="130" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">长提示词</text>
<rect x="110" y="116" width="410" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="520" y="116" width="22" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="120" y="132" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">输入 2369 token(其中长规范 ~2200)</text>
<text x="110" y="160" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">0.50 分:输出 32 token 只占 5%</text>
<rect x="110" y="190" width="14" height="12" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="130" y="200" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">输入的钱</text>
<rect x="230" y="190" width="14" height="12" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="250" y="200" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">输出的钱</text>
<text x="20" y="224" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">条形长度按金额画。长提示词时优化方向是输入:缓存、缩短、少调几次</text>
</svg>
<figcaption>同样是起草一段回复,提示词长短决定了钱花在哪。短提示词时输入输出差不多;一旦带上长规范、工具定义、知识库片段,输入就占了九成以上,优化输出长度几乎没意义。</figcaption>
</figure>

所以「钱花在输入还是输出」没有标准答案,**必须用你自己系统的真实 usage 算**。这就是今天先测量、后优化的意思:如果你的系统像 M 批次那样输入输出各一半,去压输出长度(比如把回复限制在 80 字以内)是有用的;如果像长提示词那样输入占九成,压输出几乎没用,该做的是让长开头命中缓存(Day 397)、或者让便宜的模型干简单的活(Day 399)。

## 第七步:状态里的账,会漏掉崩溃那一次

现在来验证上一课预告里那个说法。记账放在图的状态里,看起来很优雅:checkpoint 一起存,不用另外建表。但想一想 Day 393 的结论:**checkpoint 只记录跑完的节点**。如果 draft 调完模型、还没返回就崩了,这次调用的 usage 跟着节点一起丢了,而厂商那边是实打实收了钱的。

用第四步埋好的 `maybe_crash("draft")` 实验一下:

```bash
uv run python -m part07.ticket_intake X 1
export JOB_TIMEOUT=5
CRASH_AT=draft uv run arq --burst part07.ticket_worker.WorkerSettings
CRASH_AT=draft uv run arq --burst part07.ticket_worker.WorkerSettings
rm .crash_flag
uv run python -m part07.ticket_bill X-01
```

```text
X-01 入队
...
[X-01] try 1 resume=False
  !! 在 draft 节点模拟进程被 kill
...
[X-01] try 2 resume=True
19:06:21:   1.46s ← ticket-X-01:process_ticket ● 'draft_ready'
工单 X-01  分类=billing  模型调用 2 次
  classify  输入   45(命中   0) 输出    2  idle  0.0053 分
  draft     输入  116(命中   0) 输出   44  idle  0.0292 分
  合计 0.0345 分
1 张工单平均 0.0345 分/张,10 万张约 34.50 元
```

账单上 2 次调用,可实际上 draft 调了两次:第一次调完崩了,第二次续跑又调了一次。**厂商收了 3 次的钱,我们的账上只有 2 次。**

这个误差在一张工单上很小,但它是系统性的:崩溃越多、重试越多,漏得越多,而崩溃和重试多的时候恰恰是你最想知道钱花到哪去了的时候。对账时你会发现自己算的总数比厂商账单少一截,还找不到原因。

改法是**调用一返回就记账,不等节点跑完**。把记录写到一个只追加的日志文件里(真实系统里写到一张 `llm_usage` 表或者发到 Langfuse 这类工具,第六部分讲过 tracing),和图的状态无关。`ask_metered` 再改三处:

```python
# agent-zero-lab/part07/ticket_agent.py(第二次改动)
from pathlib import Path

USAGE_LOG = Path(os.getenv("USAGE_LOG", "logs/llm_usage.jsonl"))


async def ask_metered(node: str, prompt: str, max_tokens: int, ticket_id: str = "") -> tuple[str, dict]:
    resp = await llm.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=max_tokens,
        extra_body=EXTRA,
    )
    u = resp.usage
    call = {
        "ticket_id": ticket_id,
        "node": node,
        "model": resp.model,
        "at": datetime.now(timezone.utc).isoformat(),
        "prompt": u.prompt_tokens if u else 0,
        "hit": getattr(u, "prompt_cache_hit_tokens", 0) or 0,
        "completion": u.completion_tokens if u else 0,
    }
    USAGE_LOG.parent.mkdir(exist_ok=True)
    with USAGE_LOG.open("a", encoding="utf-8") as f:  # 调用一返回就记账,不等节点跑完
        f.write(json.dumps(call) + "\n")
    return (resp.choices[0].message.content or "").strip(), call

    # build_graph 里 classify 和 draft 调用时多传一个工单号:
        word, call = await ask_metered("classify", f"把工单分成 billing/tech/other 之一,只回一个词:{state['text']}", 5, state["ticket_id"])
        text, call = await ask_metered(
            "draft",
            "你是云簿 CloudLedger 的客服。根据事实写一段不超过 80 字的中文回复,"
            f"事实里没有的不要承诺。\n工单:{state['text']}\n事实:{json.dumps(facts, ensure_ascii=False)}",
            200,
            state["ticket_id"],
        )
```

<div class="line-notes">

- `from pathlib import Path` [Day 37](/blog/agent-zero/day-037-pathlib/) 学的路径对象。
- `USAGE_LOG = Path(os.getenv("USAGE_LOG", "logs/llm_usage.jsonl"))` 日志文件路径,相对于运行目录 `agent-zero-lab`。`.jsonl` 是「每行一个 JSON」的格式,追加写很方便,一行坏了不影响别的行。
- `async def ask_metered(node: str, prompt: str, max_tokens: int, ticket_id: str = "") -> tuple[str, dict]:` 多一个工单号参数,默认空字符串,这样 `ask` 和 `long_prompt_cost.py` 那些不传工单号的调用不用改。
- `"ticket_id": ticket_id,` 日志里每一行都要知道属于哪张工单,否则没法按工单汇总。
- `USAGE_LOG.parent.mkdir(exist_ok=True)` 确保 `logs/` 目录存在;已经存在不报错。相当于 Node 的 `fs.mkdirSync(dir, { recursive: true })`。
- `with USAGE_LOG.open("a", encoding="utf-8") as f:  # 调用一返回就记账,不等节点跑完` `"a"` 是追加模式([Day 38](/blog/agent-zero/day-038-files-with/) 讲过 open 的几种模式)。关键在位置:这行在模型调用返回之后、节点返回之前,崩溃发生在节点后面的 `maybe_crash` 那里,这时记录已经落盘了。
- `f.write(json.dumps(call) + "\n")` 一条记录一行。`with` 块结束时文件关闭,内容写进磁盘。
- `200,` 和原来一样,最多 200 个 token。
- `state["ticket_id"],` 新加的第四个参数。

</div>

再写一个从日志汇总的报表:

```python
# agent-zero-lab/part07/usage_report.py
import json
import sys
from collections import defaultdict
from datetime import datetime

from part07.pricing import call_cost, period_at
from part07.ticket_agent import USAGE_LOG

wanted = set(sys.argv[1:])
per_ticket: dict[str, list[dict]] = defaultdict(list)
for line in USAGE_LOG.read_text(encoding="utf-8").splitlines():
    c = json.loads(line)
    if c["ticket_id"] in wanted:
        per_ticket[c["ticket_id"]].append(c)

for tid in sorted(per_ticket):
    calls = per_ticket[tid]
    yuan = sum(
        call_cost("deepseek-flash", c["prompt"], c["hit"], c["completion"], period_at(datetime.fromisoformat(c["at"])))
        for c in calls
    )
    nodes = ", ".join(c["node"] for c in calls)
    print(f"{tid}  调用 {len(calls)} 次({nodes})  {yuan * 100:.4f} 分")
```

<div class="line-notes">

- `from collections import defaultdict` 带默认值的字典:访问不存在的键时自动建一个空列表,不用先判断「有没有这个键」。相当于 JS 里 `(map[k] ??= []).push(x)` 的省事版。
- `wanted = set(sys.argv[1:])` 命令行给的工单号放进集合,`in` 判断很快。集合是 [Day 25](/blog/agent-zero/day-025-sets/) 学的。
- `for line in USAGE_LOG.read_text(encoding="utf-8").splitlines():` 一次读进整个文件、按行切开。文件很大时应该一行一行读,练习用这样就够了。
- `c = json.loads(line)` 每行是一个独立的 JSON。
- `per_ticket[c["ticket_id"]].append(c)` 按工单号分组。
- `yuan = sum(` `sum` 里面直接放生成器表达式,把每次调用的钱加起来。
- `nodes = ", ".join(c["node"] for c in calls)` 把节点名连成一串,一眼看出调了哪些节点、有没有重复。

</div>

重做一次崩溃实验(换个工单号 Y,先清掉旧日志):

```bash
rm -f logs/llm_usage.jsonl
uv run python -m part07.ticket_intake Y 1
CRASH_AT=draft uv run arq --burst part07.ticket_worker.WorkerSettings
CRASH_AT=draft uv run arq --burst part07.ticket_worker.WorkerSettings
rm .crash_flag
uv run python -m part07.ticket_bill Y-01 | head -1
uv run python -m part07.usage_report Y-01
cat logs/llm_usage.jsonl
```

```text
工单 Y-01  分类=billing  模型调用 2 次
Y-01  调用 3 次(classify, draft, draft)  0.0621 分
{"ticket_id": "Y-01", "node": "classify", "model": "deepseek-flash", "at": "2026-10-22T11:07:08.337835+00:00", "prompt": 45, "hit": 0, "completion": 2}
{"ticket_id": "Y-01", "node": "draft", "model": "deepseek-flash", "at": "2026-10-22T11:07:09.225856+00:00", "prompt": 116, "hit": 0, "completion": 44}
{"ticket_id": "Y-01", "node": "draft", "model": "deepseek-flash", "at": "2026-10-22T11:07:23.591603+00:00", "prompt": 116, "hit": 0, "completion": 40}
```

(`| head -1` 只看第一行,[Day 5](/blog/agent-zero/day-005-terminal-3/) 学的管道。)同一张工单,状态里的账说调了 2 次,日志说调了 3 次,两次 draft 隔了 14 秒(第一次崩溃、5 + 10 秒后被接手)。日志里多出来的那一行,就是厂商实际收了、但状态里没有的钱。这张工单的真实成本是 0.0621 分,状态版账单只有它的一半多一点。

到这里可以下结论了:状态里的 `llm_calls` 适合回答「这张工单最终走了哪几步、每步用了多少」,日志才适合回答「一共花了多少钱」。真实系统两样都留:状态版用来调试和分析单张工单,日志版用来对账和算总成本。

## 零件和完整记账的对照

| 今天的零件 | 放在哪 | 回答什么问题 |
| --- | --- | --- |
| `resp.usage` | 每次调用的响应里 | 这次用了多少 token |
| `pricing.py` 的 `PRICES` / `period_at` / `call_cost` | 独立模块,所有报表共用 | 这些 token 值多少钱 |
| `ask_metered` 返回的 `call` | 调模型的唯一入口 | 一次调用的完整记录 |
| `TicketState.llm_calls` | 图的状态,跟 checkpoint 一起存 | 这张工单最终走了哪些步 |
| `logs/llm_usage.jsonl` | 调用一返回就追加 | 厂商实际收了多少次钱 |
| `ticket_bill.py` / `bill_split.py` | 离线报表 | 每张多少、输入输出各占多少 |
| `usage_report.py` | 离线报表 | 按日志对账,包括崩溃白调的 |

## 动手练习

### 练习 1:换成 pro 模型要多花多少

不重新跑工单,用 M-01 到 M-04 已有的 usage,分别按 flash 和 pro、高峰和空闲算出每张平均成本和 10 万张的总价。写成 `part07/bill_compare.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part07/bill_compare.py
import asyncio
import sys

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from part07.pricing import PRICES, call_cost
from part07.ticket_worker import DSN


async def main(ticket_ids: list[str]):
    calls: list[dict] = []
    async with AsyncPostgresSaver.from_conn_string(DSN) as saver:
        for tid in ticket_ids:
            config: RunnableConfig = {"configurable": {"thread_id": f"ticket-{tid}"}}
            tup = await saver.aget_tuple(config)
            if tup is not None:
                calls += tup.checkpoint["channel_values"].get("llm_calls", [])
    for model in PRICES:
        for period in ("peak", "idle"):
            yuan = sum(call_cost(model, c["prompt"], c["hit"], c["completion"], period) for c in calls)
            per_ticket = yuan / len(ticket_ids)
            print(f"{model:<16} {period:<4} 每张 {per_ticket * 100:.4f} 分  10 万张 {per_ticket * 100_000:7.2f} 元")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:]))
```

<div class="line-notes">

- `calls += tup.checkpoint["channel_values"].get("llm_calls", [])` 把所有工单的调用记录拼成一个大列表。`+=` 对列表是原地拼接,相当于 JS 的 `calls.push(...arr)`。
- `for model in PRICES:` 遍历字典就是遍历它的键,得到两个模型名。
- `yuan = sum(call_cost(model, c["prompt"], c["hit"], c["completion"], period) for c in calls)` 同一批 token,换不同的单价算。这里假设换了模型 token 数不变,严格说不同模型的分词器不同(Day 108 讲过),但同一家厂商的两个模型差别很小。
- `print(f"{model:<16} {period:<4} 每张 {per_ticket * 100:.4f} 分  10 万张 {per_ticket * 100_000:7.2f} 元")` `:7.2f` 占 7 格、两位小数,让几行的金额右对齐。

</div>

```bash
uv run python -m part07.bill_compare M-01 M-02 M-03 M-04
```

```text
deepseek-flash   peak 每张 0.0456 分  10 万张   45.60 元
deepseek-flash   idle 每张 0.0228 分  10 万张   22.80 元
deepseek-v4-pro  peak 每张 0.1777 分  10 万张  177.75 元
deepseek-v4-pro  idle 每张 0.0889 分  10 万张   88.88 元
```

pro 高峰价是 flash 空闲价的 7.8 倍。两个结论:对批量、不着急的活(比如夜里给积压工单出草稿),放到空闲时段跑直接打五折;要不要用 pro,取决于它能不能把转人工率降下来,这要用第六部分的评测去量,不能只看单价。

</details>

### 练习 2:失败的工单花了多少

M-04 转人工了,花了 0.0044 分;Day 394 的 R-01(模型连不上,重试两次后转人工)花了多少?K2-01(崩在 lookup_invoice、被接手续跑)和正常的 W-01 比,多花了多少?不用跑代码,根据你对这几条路径的理解回答。

<details><summary>参考答案</summary>

R-01:0 元。三次执行都在连接阶段就失败了,请求根本没到模型那边,厂商不收钱。但这不代表「连不上」的失败是免费的:如果是读超时(请求发出去了、模型在生成、你等不及断开了),厂商很可能照样收钱,而且 SDK 自己还会重试两次,一次失败可能变成三次付费调用。Day 392 讲「超时不等于没执行」,在钱上也成立。

K2-01:和 W-01 一样多。它崩在 lookup_invoice,这个节点不调模型;classify 已经完整跑完、续跑时没重调;draft 在崩溃后才第一次执行。所以多花的是 0。如果崩在 draft 调完模型之后(就像第七步的 Y-01),才会多花一次 draft 的钱。

这道题的意思是:不同的失败路径成本差别很大。有了第七步的日志,你可以按 `agent_status` 分组,算出「转人工的工单平均花了多少」,这在算 Agent 到底省不省钱时是一个必须扣掉的数。

</details>

### 练习 3:法定节假日也是空闲价

`period_at` 没有处理法定节假日。写一个 `period_at_cn`,在它前面加一层节假日判断,用 10 月 1 日、10 月 5 日、10 月 9 日测一下。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part07/pricing_holiday.py
from datetime import date, datetime

from part07.pricing import BEIJING, period_at

HOLIDAYS = {date(2026, 10, 1), date(2026, 10, 2), date(2026, 10, 5)}  # 示例,以国务院当年公布的放假安排为准


def period_at_cn(when: datetime) -> str:
    if when.astimezone(BEIJING).date() in HOLIDAYS:
        return "idle"
    return period_at(when)


for t in ["2026-10-01 10:30", "2026-10-05 15:00", "2026-10-09 15:00"]:
    when = datetime.strptime(t, "%Y-%m-%d %H:%M").replace(tzinfo=BEIJING)
    print(t, when.strftime("%a"), "原版", period_at(when), "加节假日", period_at_cn(when))
```

<div class="line-notes">

- `from datetime import date, datetime` `date` 只有年月日,没有时分秒,拿来表示「哪一天」正合适。
- `HOLIDAYS = {date(2026, 10, 1), date(2026, 10, 2), date(2026, 10, 5)}  # 示例,以国务院当年公布的放假安排为准` 只写了三天做演示。真实的放假安排每年由国务院公布,应该每年更新一次这份名单,或者用一个维护得好的节假日库。
- `if when.astimezone(BEIJING).date() in HOLIDAYS:` 先换成北京时间再取日期,不然 UTC 的 10 月 1 日 0 点到 8 点在北京已经是 10 月 1 日了,会判错。
- `return period_at(when)` 不是节假日就交给原来的函数,不重复写周末和时段的逻辑。

</div>

```bash
uv run python -m part07.pricing_holiday
```

```text
2026-10-01 10:30 Thu 原版 peak 加节假日 idle
2026-10-05 15:00 Mon 原版 peak 加节假日 idle
2026-10-09 15:00 Fri 原版 peak 加节假日 peak
```

原版把节假日的上午当成了高峰,多算一倍。按 DeepSeek 定价页的说法,周末和法定节假日全天都是空闲时段,所以调休上班的周末也是空闲价,`period_at` 里「周六日一律空闲」的写法正好符合。

</details>

### 练习 4:给老板一个月度预算

你的系统每天 3000 张工单,每张的调用结构和长提示词实验一样(classify 一次约 50 token 输入,draft 一次约 2370 token 输入、40 token 输出,draft 的长开头八成能命中缓存),70% 的调用在高峰时段。估算每月(30 天)的模型费用,写出算式。

<details><summary>参考答案</summary>

先算一张工单(按 flash):

```text
classify(高峰):50 × 2 + 2 × 8                          = 116   (元 / 百万)
draft(高峰,命中 80%):
  命中   2370 × 0.8 = 1896 token × 0.04                  ≈ 75.8
  未命中 2370 × 0.2 =  474 token × 2                     = 948
  输出   40 × 8                                           = 320
  小计                                                    ≈ 1343.8
一张(高峰)≈ 116 + 1343.8 = 1459.8 元 / 百万 ≈ 0.00146 元
一张(空闲)≈ 0.00073 元(减半)
加权:0.7 × 0.00146 + 0.3 × 0.00073 ≈ 0.00124 元
每月:0.00124 × 3000 × 30 ≈ 112 元
```

每月一百多块。这个数字本身不重要(你的系统会不一样),重要的是这个算法:按节点拆、按命中率拆、按时段拆,每一项都能从第七步的日志里拿到真实值,而不是拍脑袋。另外要加一笔 10% 到 20% 的余量给重试和崩溃白调的那部分,第七步实测它是真实存在的。

这道题是纸面计算,没有实跑。

</details>

**验收标准**:能手算一次调用的成本并和 `call_cost` 对上;能跑出 M 批次四张工单的账单,并说出 draft 是大头、转人工的也花钱;能跑出长提示词实验,解释为什么输出占比从一半降到 5% 左右;能复现 Y-01 状态账单 2 次、日志 3 次,并说清各自适合回答什么问题。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| `usage` | 模型 API 响应里的用量字段,包含输入、输出 token 数等,是计费的依据 |
| `prompt_tokens` / `completion_tokens` | 输入 token 数 / 输出 token 数 |
| 缓存命中 token | 输入里和之前请求开头相同、被厂商缓存住的部分,按很低的单价收费。DeepSeek 的字段是 `prompt_cache_hit_tokens` |
| 峰谷价格 | DeepSeek 2026 年的计价规则:工作日 9–12 点、14–18 点为高峰,其余为空闲,空闲价是高峰价的一半 |
| 单工单成本 | 一张工单所有模型调用的费用之和,是判断 Agent 划不划算的基本单位 |
| JSONL | 每行一个 JSON 对象的文本格式,适合追加写日志 |
| `getattr(对象, 名字, 默认值)` | 按名字取属性,没有就返回默认值,用来读厂商自己加的非标准字段 |
| `defaultdict` | 访问不存在的键时自动生成默认值的字典,适合分组 |
| 对账 | 把自己记录的用量和厂商账单核对,确认没有漏记或多记 |

## 常见误区

**不测量就开始优化。** 先跑出每个节点、每张工单的真实账单,再决定优化什么。第六步的两个实验说明,同一个系统换个提示词长度,输入输出的占比能从「各一半」变成「输入占九成以上」,优化方向完全相反。

**用请求里的模型名算钱。** 用 `resp.model`。以后做路由、降级、灰度切模型时,请求代码里写的和实际用的可能不一样。

**直接写 `u.prompt_cache_hit_tokens`。** 这是 DeepSeek 自己加的字段,openai SDK 的类型里没有,basedpyright 会报红,换厂商还可能真没有。用 `getattr(u, "prompt_cache_hit_tokens", 0) or 0`,或者读标准的 `prompt_tokens_details.cached_tokens`。

**调用时间不带时区。** `datetime.now()` 不带时区,在 UTC 服务器上和本机算出的峰谷会差 8 小时。记录用 `datetime.now(timezone.utc)`,判断时换成北京时间。

**只从图的状态里记账。** checkpoint 只记录跑完的节点,崩在节点中间的那次模型调用不会出现在状态里。第七步实测状态说 2 次、实际 3 次。对账要用调用一返回就写的日志。

**以为失败的工单不花钱。** M-04 转人工了,classify 那一次照样收钱;读超时的请求厂商很可能也收。算 Agent 的总成本要把失败路径算进去。

**把价格写死在很多地方。** 价格会变(DeepSeek 2026 年 9 月刚改成峰谷价),只放在 `pricing.py` 一处,其他报表都从这里读。表上方写清楚是哪天从哪抄的。

## 学习资料

### 文档与文章

- [DeepSeek API 文档 · 模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):今天价格表的出处,峰谷时段的规则也在这一页。中文,5 分钟,每次算账前都来看一眼。
- [DeepSeek API 文档 · Token 用量计算](https://api-docs.deepseek.com/zh-cn/quick_start/token_usage):一个中文字、英文字母大约多少 token 的经验值,和怎么在本地离线估算。中文,10 分钟。
- [DeepSeek API 文档 · 上下文硬盘缓存](https://api-docs.deepseek.com/zh-cn/guides/kv_cache):`prompt_cache_hit_tokens` 的官方解释,明天的预习。中文,15 分钟。
- [Langfuse · Token and cost tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking):Day 365 接入的 Langfuse 怎么自动记 usage 和算钱,真实项目里第七步的日志通常就交给它。英文,15 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1HNPxegEux&autoplay=0&high_quality=1" title="为啥大模型按Tokens收费?Tokens是啥?和API调用收费区别?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>智驭导师授AI · 为啥大模型按Tokens收费?Tokens是啥?和API调用收费区别? · 约 8 分钟。把 token 计费的逻辑从头讲一遍,适合配合 Day 107 复习。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV16vpu6SEwh&autoplay=0&high_quality=1" title="Token价格怎么算?AI大模型100万Token价格对比:ChatGPT、Claude、Gemini、Grok、DeepSeek、Qwen、Kimi、GLM" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>不管这么多 · Token价格怎么算?AI大模型100万Token价格对比 · 约 11 分钟,2026 年。横向对比各家每百万 token 的价格,看完你会对「DeepSeek 便宜多少」有个量级概念。视频里的价格以各家官网当天为准。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1NqeY6dEPP&autoplay=0&high_quality=1" title="DeepSeek 公布最新 API 峰谷计费规则;Step 5 Preview 现身知名评测网站与官方订阅【AI 早报 2026-09-20】" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>橘鸦Juya · DeepSeek 公布最新 API 峰谷计费规则【AI 早报 2026-09-20】 · 约 4 分钟,开头一段讲峰谷计费,就是今天 `period_at` 实现的那条规则。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/IHSqiOVVRNw" title="Estimate the capacity and cost of an LLM app: tokens, peak QPS, and tokens per minute" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>FDE Interviews · Estimate the capacity and cost of an LLM app · 英文,面试向。从 token、峰值 QPS 到每分钟 token 数估算一个 LLM 应用的容量和成本,接得上 Day 394 的 `workers_needed` 和今天的练习 4。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/7zbuEULTHIs" title="What are LLM Tokens and API Prices? (Beginner Friendly)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Eamonn Cottrell · What are LLM Tokens and API Prices? (Beginner Friendly) · 英文,入门向。讲输入输出分开计价的原因,适合听力练习。</figcaption>
</figure>

### 书籍

- 《AI Engineering: Building Applications with Foundation Models》,Chip Huyen,O'Reilly,2025。讲推理优化和成本的章节把「延迟、成本、质量」三者的取舍讲得很清楚。英文原版;O'Reilly 平台上有一个机器翻译的中文版,我没查到正式出版的中译本。

### 开源项目与代码

- [langfuse/langfuse](https://github.com/langfuse/langfuse):开源的 LLM 可观测平台,自带按模型计价的价格表,看它的模型定价是怎么配置的,和今天的 `PRICES` 对比。
- [BerriAI/litellm](https://github.com/BerriAI/litellm):统一调用上百家模型的库,仓库里有一份很大的各家模型价格表(`model_prices_and_context_window.json`),很多项目直接拿它算钱。

## 自测

1. 一次调用输入 2000 token(命中 1500)、输出 100 token,flash 高峰价多少钱?

<details><summary>答案</summary>

`1500 × 0.04 + 500 × 2 + 100 × 8 = 60 + 1000 + 800 = 1860`,除以一百万,是 0.00186 元,约 0.19 分。注意 500 个没命中的输入 token 花的钱(1000)比 1500 个命中的(60)多得多。

</details>

2. 为什么 `ask_metered` 用 `resp.model` 而不是请求里写的 `MODEL` 记录模型名?

<details><summary>答案</summary>

响应里的模型名是厂商实际用来服务这次请求的模型。做模型路由、降级、灰度时,请求代码里写的可能和实际用的不一样;按实际的算钱、按实际的分析质量才对。

</details>

3. 我们的短提示词系统里输出占 54%,长提示词实验里输出只占 5% 左右。各自应该优先优化什么?

<details><summary>答案</summary>

短提示词:输入输出差不多,压缩回复长度(比如 `max_tokens`、提示词里限制字数)有实效。长提示词:输入占九成以上,优先让长开头命中缓存(明天讲)、精简系统提示词、减少调用次数或者把简单步骤交给便宜模型,压输出几乎没用。

</details>

4. 崩溃实验里,状态版账单和日志版账单哪个是对的?为什么不干脆只留日志版?

<details><summary>答案</summary>

算钱以日志版为准,它记了厂商实际收费的每一次调用,包括崩溃时白调的。状态版也有用:它和工单的最终路径绑定在一起,适合分析「这张工单最终每步用了多少 token」、调试单张工单;日志版里有重复和失败的调用,做这种分析反而乱。所以两样都留,各回答各的问题。

</details>

5. (面试题)老板问你:「我们的 Agent 一个月模型费用多少?钱都花哪了?怎么降?」你怎么回答,需要哪些数据?

<details><summary>答案</summary>

参考答法:先说怎么拿数:每次模型调用一返回就记一条用量日志(工单号、节点、实际模型、时间、输入/命中/输出 token),按价格表(含峰谷、缓存价)算钱;每月和厂商账单对账,差额说明有漏记。再说怎么拆:按节点拆看哪一步最贵(我们实测 draft 是 classify 的 6 倍左右),按输入输出拆看优化方向(长提示词时输入占九成以上),按工单状态拆算出转人工的工单也在花钱,按时段拆看有多少能挪到空闲时段。最后给降本的顺序:能挪到空闲时段的批量任务先挪(直接五折);长系统提示词放在开头保持稳定,让它命中缓存;简单步骤换小模型;减少不必要的调用。每一项上线前后用同一份日志对比,用数字说话,同时用评测保证质量没掉。

</details>

## 明天预告

Day 397 · 成本(二):prompt caching 原理和命中规矩。今天长提示词实验里那 2176 个「命中」的 token,让一次起草的成本降到了原价的七分之一。明天搞清楚它是怎么做到的:厂商缓存的到底是什么、为什么只认「开头一模一样」、哪些写法会让缓存悄悄失效,并用 `prompt_cache_hit_tokens` 实测几种写法的命中率。
