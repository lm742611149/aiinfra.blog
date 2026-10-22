---
title: 'Day 393 · 断点续跑:让崩在半路的任务接着跑'
description: 'worker 跑到一半被 kill,重新投递后前面调过的模型要不要再调一遍?用 LangGraph 的 Postgres checkpoint 加固定 thread_id 从断点接着跑,实测三档 durability 的区别,再踩两个坑:输入传错会从头再走一遍,崩掉的那个节点会整个重跑。'
pubDate: 2026-10-22
regime: none
tags: ['langgraph', 'checkpoint', 'arq', 'reliability', 'agent-zero']
series: 'agent-zero'
day: 393
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 392](/blog/agent-zero/day-392-timeouts/) 给每一层都装了超时,而且内层比外层短:模型请求 30 秒乘 3 次,工具 20 秒,一轮 120 秒,队列任务 300 秒。超时解决的是「卡住」,卡住了我们能拿回控制权,决定重试还是转人工。今天要处理更糟的情况:进程直接死了。部署时滚动重启、机器内存不够被系统 kill、有人手滑 Ctrl+C,这时候进程里的 `except` 一行都不会执行。任务会被重新投递,问题是重新跑的时候,前面已经花钱调过的模型、已经查过的系统,要不要再来一遍。

## 今天要解决的问题

今天结束时你应该能:

1. 用固定的 `thread_id` 加 Postgres checkpointer,让一个被 kill 的图在新进程里从断点接着跑,并用 checkpoint 表的行数证明前面的节点没有重跑。
2. 说清楚 `durability` 的 `"sync"`、`"async"`、`"exit"` 三档在进程崩溃时各会丢什么,并给出自己的选择理由。
3. 演示两个坑:续跑时又传了一遍完整输入,图会从头再走一遍;崩掉的那个节点会整个重跑,所以节点里的写操作要有幂等键。
4. 把续跑装进 arq worker,知道 worker 崩了以后为什么要等 `job_timeout + 10` 秒任务才会被别的 worker 接手。

预计用时 2.5–3 小时。前置:[Day 316](/blog/agent-zero/day-316-lg-checkpointer/) 的 checkpointer 和 thread_id、[Day 317](/blog/agent-zero/day-317-lg-state-history/) 的 `get_state`、[Day 318](/blog/agent-zero/day-318-lg-sqlite-saver/) 的 kill 后续跑、[Day 304](/blog/agent-zero/day-304-lg-reducer/) 的 reducer、[Day 385](/blog/agent-zero/day-385-session-mgmt/) 的 Postgres checkpointer、[Day 388](/blog/agent-zero/day-388-arq/) 的 arq、[Day 390](/blog/agent-zero/day-390-idempotency/) 的幂等键。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先从前端看:多步表单的「刷新后回到第 3 步」

做过多步表单的话,你大概写过这种逻辑:用户每填完一步,就把当前步数和已填的数据存进 `localStorage`;页面刷新后先读一下,发现「第 3 步做到一半」,就直接显示第 3 步,前两步不用重填。

断点续跑是同一个想法,只是把「每一步的进度」存在了数据库里。LangGraph 的 checkpoint 你在 [Day 316](/blog/agent-zero/day-316-lg-checkpointer/) 到 [Day 318](/blog/agent-zero/day-318-lg-sqlite-saver/) 已经见过:每跑完一个节点(准确说是一个超步,Day 313 讲过),它就把整个 State 存一份快照,用 `thread_id` 区分不同的对话或任务。Day 318 用 SqliteSaver 演示过「kill 掉进程,重新运行接着跑」。

今天要往前走三步:换成生产里用的 Postgres;搞清楚「存」这个动作在什么时机发生;把它放进队列 worker 里,让任务重新投递时自动续跑。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="断点续跑示意:第一次执行跑完 classify 和 lookup_invoice,每步写一个 checkpoint,在 draft 被 kill;第二次执行读到最新 checkpoint,next 是 draft,只跑 draft">
<text x="20" y="22" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">thread_id = ticket-T3001</text>
<text x="20" y="56" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">第 1 次执行</text>
<rect x="110" y="40" width="120" height="28" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="170" y="58" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">classify(模型)</text>
<rect x="250" y="40" width="130" height="28" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="315" y="58" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">lookup_invoice</text>
<rect x="400" y="40" width="90" height="28" rx="5" fill="var(--paper-raised)" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
<text x="445" y="58" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">draft</text>
<text x="505" y="58" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">kill -9</text>
<rect x="110" y="110" width="400" height="44" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="126" y="130" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">Postgres checkpoints 表</text>
<text x="126" y="146" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">step -1 · 0 · 1 · 2 → next = ('draft',)</text>
<line x1="170" y1="68" x2="170" y2="110" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
<line x1="315" y1="68" x2="315" y2="110" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
<text x="20" y="206" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">第 2 次执行</text>
<text x="110" y="206" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">输入传 None,读最新快照 →</text>
<rect x="400" y="190" width="90" height="28" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="445" y="208" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">draft</text>
<line x1="445" y1="154" x2="445" y2="190" stroke="var(--ink-soft)" stroke-width="1.5"/>
<text x="110" y="244" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">classify 不再调模型,lookup_invoice 不再查</text>
</svg>
<figcaption>第一次执行每跑完一步就写一个 checkpoint;进程在 draft 里被 kill。第二次执行用同一个 thread_id、输入传 None,LangGraph 从最新的快照里读到 next 是 draft,只跑这一个节点。</figcaption>
</figure>

## 准备环境

还在 `agent-zero-lab` 目录,数据库用 [Day 391](/blog/agent-zero/day-391-week56-review/) 建的 `agentzero_w56`。今天新装两个包(前几天已经装过的话 uv 会告诉你没有变化):

```bash
cd agent-zero-lab
uv add langgraph langgraph-checkpoint-postgres python-dotenv
```

我实跑的版本是 langgraph 1.2.16、langgraph-checkpoint-postgres 3.2.0(2026 年 10 月在 PyPI 查到的最新版)。`.env` 还是 Day 392 那份,模型是 DeepSeek 的 `deepseek-flash`。Redis 要在跑(`redis-cli ping` 回 `PONG`)。

## 第一步:一张会「崩」的三步图

先搭一张最小的工单图:分类(调一次模型)、查发票(假装查订单系统,睡 1 秒)、起草回复(睡 1 秒)。为了做实验,图里埋一个开关:环境变量 `CRASH_AT` 等于某个节点名时,进程在那个节点里直接退出,效果和 `kill -9` 一样。

```python
# agent-zero-lab/part07/ticket_graph.py
import asyncio
import json
import operator
import os
from pathlib import Path
from typing import Annotated, NotRequired, TypedDict

from dotenv import load_dotenv
from langgraph.graph import END, START, StateGraph
from openai import AsyncOpenAI

load_dotenv()
llm = AsyncOpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"], timeout=30, max_retries=2)
CRASH_FLAG = Path(".crash_flag")  # 在 agent-zero-lab 目录下生成,记录「已经崩过一次」


class TicketState(TypedDict):
    ticket: str
    steps: Annotated[list[str], operator.add]
    category: NotRequired[str]
    invoice: NotRequired[dict]
    draft: NotRequired[str]


def maybe_crash(node: str) -> None:
    if os.getenv("CRASH_AT") == node and not CRASH_FLAG.exists():
        CRASH_FLAG.touch()
        print(f"  !! 在 {node} 节点模拟进程被 kill", flush=True)
        os._exit(1)  # 不走任何清理,和 kill -9 一样


async def classify(state: TicketState) -> dict:
    resp = await llm.chat.completions.create(
        model=os.environ["LLM_MODEL"],
        messages=[{"role": "user", "content": f"把工单分成 billing/tech/other 之一,只回一个词:{state['ticket']}"}],
        max_tokens=5,
        extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY", "{}")),
    )
    category = (resp.choices[0].message.content or "other").strip()
    print(f"  classify 调了一次模型 -> {category}", flush=True)
    return {"category": category, "steps": ["classify"]}


async def lookup_invoice(state: TicketState) -> dict:
    await asyncio.sleep(1)
    maybe_crash("lookup_invoice")
    print("  lookup_invoice 查到发票", flush=True)
    return {"invoice": {"id": "INV-0123", "amount_cents": 239200}, "steps": ["lookup_invoice"]}


async def draft(state: TicketState) -> dict:
    await asyncio.sleep(1)
    maybe_crash("draft")
    invoice_id = state.get("invoice", {}).get("id")
    text = f"[{state.get('category', 'other')}] 已核实发票 {invoice_id},退款申请已提交审批。"
    print("  draft 写好草稿", flush=True)
    return {"draft": text, "steps": ["draft"]}


def build_graph(checkpointer=None):
    g = StateGraph(TicketState)
    g.add_node("classify", classify)
    g.add_node("lookup_invoice", lookup_invoice)
    g.add_node("draft", draft)
    g.add_edge(START, "classify")
    g.add_edge("classify", "lookup_invoice")
    g.add_edge("lookup_invoice", "draft")
    g.add_edge("draft", END)
    return g.compile(checkpointer=checkpointer)
```

<div class="line-notes">

- `import operator` 下面要用 `operator.add` 当 reducer,它就是函数版的 `+`,两个列表相加就是拼接。
- `from typing import Annotated, NotRequired, TypedDict` `TypedDict` 是 [Day 47](/blog/agent-zero/day-047-type-hints-3/) 学的,相当于 TS 的 `interface`;`NotRequired` 相当于 TS 字段后面的 `?`,一开始可以没有。
- `llm = AsyncOpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"], timeout=30, max_retries=2)` 用的是 Day 392 定下的超时配置。
- `CRASH_FLAG = Path(".crash_flag")  # 在 agent-zero-lab 目录下生成,记录「已经崩过一次」` 实验要「只崩一次」:第一次崩之前先留个标记文件,重跑时看到标记就不再崩。每做完一组实验要 `rm .crash_flag`。
- `steps: Annotated[list[str], operator.add]` 每个节点往 `steps` 里追加自己的名字,用来看哪些节点跑过。`Annotated[类型, reducer]` 是 Day 304 讲的写法:节点返回的 `steps` 会和已有的拼起来,而不是覆盖。
- `def maybe_crash(node: str) -> None:` 埋在节点里的「自毁开关」。
- `if os.getenv("CRASH_AT") == node and not CRASH_FLAG.exists():` 环境变量指定了这个节点,而且还没崩过,才崩。
- `os._exit(1)  # 不走任何清理,和 kill -9 一样` 注意是带下划线的 `os._exit`,它让进程立刻结束,`finally`、`with` 的退出逻辑、arq 的收尾全都不执行。普通的 `sys.exit` 会抛一个异常、走正常的清理流程,模拟不出真实的崩溃。
- `async def classify(state: TicketState) -> dict:` 唯一调模型的节点。续跑时如果它没有被再调一次,就省了一次模型的钱和时间。
- `max_tokens=5,` 只要一个词。
- `print(f"  classify 调了一次模型 -> {category}", flush=True)` 每调一次模型就打一行,数这一行出现了几次,就知道模型被调了几次。实测分类结果每次都是 `billing`。
- `return {"category": category, "steps": ["classify"]}` 节点只返回要改的字段,LangGraph 负责合并进 State。
- `await asyncio.sleep(1)` 假装在查订单系统。这 1 秒也给了 checkpoint 写入充足的时间,第三步会说这一点为什么影响实验结果。
- `maybe_crash("lookup_invoice")` 崩溃点放在「干完活、还没返回」的位置,这是最难处理的时刻:活干了,但 LangGraph 不知道。
- `invoice_id = state.get("invoice", {}).get("id")` `.get(键, 默认值)` 拿不到就用默认值,相当于 JS 的 `state.invoice?.id`。
- `return g.compile(checkpointer=checkpointer)` 编译时传入 checkpointer,图才会存快照;不传就和 Day 315 一样,进程一退什么都没了。

</div>

这个文件只定义图,不运行。检查一下能不能导入:

```bash
uv run python -c "from part07.ticket_graph import build_graph; print(build_graph().get_graph().nodes.keys())"
```

```text
dict_keys(['__start__', 'classify', 'lookup_invoice', 'draft', '__end__'])
```

## 第二步:崩一次,再接着跑

运行脚本做三件事:先用 `aget_state` 看这个 thread 有没有半路的进度;有就输入传 None 接着跑,没有就给完整输入从头跑;跑的时候用命令行指定 `durability`。

```python
# agent-zero-lab/part07/resume_demo.py
import asyncio
import sys
from typing import Literal, cast

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from part07.ticket_graph import TicketState, build_graph

DSN = "postgresql://localhost/agentzero_w56"
TICKET = "10 月 8 号被扣了两次款,INV-0123 那笔麻烦退给我"


async def main(thread_id: str, durability: Literal["exit", "async", "sync"]):
    async with AsyncPostgresSaver.from_conn_string(DSN) as saver:
        await saver.setup()
        graph = build_graph(checkpointer=saver)
        config: RunnableConfig = {"configurable": {"thread_id": thread_id}}

        snap = await graph.aget_state(config)
        print(f"开跑前:next={snap.next} 已有字段={sorted(snap.values)}")
        graph_input: TicketState | None
        if snap.values and snap.next:
            print("有半路的进度,输入传 None,从断点接着跑")
            graph_input = None
        else:
            print("没有进度,从头跑")
            graph_input = {"ticket": TICKET, "steps": []}

        result = await graph.ainvoke(graph_input, config=config, durability=durability)
        print(f"跑完:steps={result['steps']}")
        print(f"draft={result['draft']}")


if __name__ == "__main__":
    mode = sys.argv[2] if len(sys.argv) > 2 else "sync"
    asyncio.run(main(sys.argv[1], cast(Literal["exit", "async", "sync"], mode)))
```

<div class="line-notes">

- `from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver` 异步版的 Postgres checkpointer,来自 `langgraph-checkpoint-postgres` 包。worker 里全是 async 代码,要用 `.aio` 下面这个。
- `async with AsyncPostgresSaver.from_conn_string(DSN) as saver:` 按连接串建一个 checkpointer,块结束自动关连接。
- `await saver.setup()` 第一次用时建表(`checkpoints`、`checkpoint_blobs`、`checkpoint_writes`、`checkpoint_migrations`),已经建过就什么也不做,可以每次都调。
- `config: RunnableConfig = {"configurable": {"thread_id": thread_id}}` thread_id 由命令行传入。**同一个 thread_id 才能找回同一份进度**,这是续跑成立的前提。
- `snap = await graph.aget_state(config)` 读这个 thread 最新的快照,Day 317 的 `get_state` 的异步版。
- `print(f"开跑前:next={snap.next} 已有字段={sorted(snap.values)}")` `snap.next` 是「下一步要跑哪些节点」的元组,跑完或者从没跑过都是空元组 `()`。实测崩在 draft 之后是 `('draft',)`。`sorted(字典)` 得到排好序的键列表。
- `graph_input: TicketState | None` 先声明类型,下面两个分支分别赋值,类型检查器才不会抱怨。
- `if snap.values and snap.next:` 有数据、而且还有没跑完的节点,才算「半路的进度」。只看 `snap.values` 不够:一个已经跑完的 thread 也有 values,但 next 是空的。
- `graph_input = None` 关键的一行。输入传 None,LangGraph 就从最新快照继续;第四步会演示传错的后果。
- `graph_input = {"ticket": TICKET, "steps": []}` 从头跑时给完整输入。
- `result = await graph.ainvoke(graph_input, config=config, durability=durability)` `durability` 控制 checkpoint 什么时候写,第三步专门讲。
- `mode = sys.argv[2] if len(sys.argv) > 2 else "sync"` 第二个命令行参数是 durability,不给就是 sync。
- `asyncio.run(main(sys.argv[1], cast(Literal["exit", "async", "sync"], mode)))` `cast` 只是告诉类型检查器「相信我,这是三个值之一」,运行时什么也不做,相当于 TS 的 `as`。

</div>

先正常跑一次,不崩:

```bash
uv run python -m part07.resume_demo t-ok
```

```text
开跑前:next=() 已有字段=[]
没有进度,从头跑
  classify 调了一次模型 -> billing
  lookup_invoice 查到发票
  draft 写好草稿
跑完:steps=['classify', 'lookup_invoice', 'draft']
draft=[billing] 已核实发票 INV-0123,退款申请已提交审批。
```

再来一次在 draft 里崩掉的。`CRASH_AT=draft` 写在命令前面,表示只对这一条命令设这个环境变量:

```bash
CRASH_AT=draft uv run python -m part07.resume_demo t-sync sync
echo "exit=$?"
psql -d agentzero_w56 -Atc "select count(*) from checkpoints where thread_id='t-sync'"
```

```text
开跑前:next=() 已有字段=[]
没有进度,从头跑
  classify 调了一次模型 -> billing
  lookup_invoice 查到发票
  !! 在 draft 节点模拟进程被 kill
exit=1
4
```

进程退出码是 1,`跑完` 那两行没打出来。这时候数据库里 `t-sync` 已经有 4 个 checkpoint。现在用同一个 thread_id 再运行一次(`.crash_flag` 已经在了,这次不会再崩):

```bash
CRASH_AT=draft uv run python -m part07.resume_demo t-sync sync
rm .crash_flag
```

```text
开跑前:next=('draft',) 已有字段=['category', 'invoice', 'steps', 'ticket']
有半路的进度,输入传 None,从断点接着跑
  draft 写好草稿
跑完:steps=['classify', 'lookup_invoice', 'draft']
draft=[billing] 已核实发票 INV-0123,退款申请已提交审批。
```

这次只打出了 `draft 写好草稿` 一行。`classify 调了一次模型` 没出现,说明模型没被再调;`lookup_invoice 查到发票` 也没出现。可最后的 `steps` 里三个节点都在,`draft` 里引用的 `billing` 和 `INV-0123` 是上一个进程算出来的,从快照里读了回来。

看一眼这 5 个 checkpoint 都是什么:

```bash
psql -d agentzero_w56 -c "select checkpoint_id, metadata->>'source' src, metadata->>'step' step from checkpoints where thread_id='t-sync' order by checkpoint_id"
```

```text
            checkpoint_id             |  src  | step 
--------------------------------------+-------+------
 1f1cdd4f-9142-6ef6-bfff-d80ff9ffdf90 | input | -1
 1f1cdd4f-914a-60b6-8000-39b0fce9dc3b | loop  | 0
 1f1cdd4f-9a5a-65de-8001-a82a16963c4e | loop  | 1
 1f1cdd4f-a481-6166-8002-60b895d770f3 | loop  | 2
 1f1cdd4f-e32f-6624-8003-780d14fd1ca1 | loop  | 3
(5 rows)
```

`metadata->>'source'` 是 Postgres 取 JSON 字段的写法,相当于 JS 的 `metadata.source`。step -1 是收到输入时存的,step 0 是 START 之后,step 1 跑完 classify,step 2 跑完 lookup_invoice,这四行是第一个进程写的;step 3 跑完 draft,是第二个进程写的。`checkpoint_id` 按时间递增,前四行和第五行之间隔了几十秒,就是两次运行的间隔。

## 第三步:durability,checkpoint 什么时候写

上面的命令都传了 `sync`。这个参数决定的是「每跑完一步,checkpoint 什么时候写进数据库」。我在本机装的 langgraph 1.2.16 源码(`langgraph/pregel/main.py` 里 `stream` 方法的文档字符串)里查到,一共三档,默认是 `"async"`:

- `"sync"`:写完这一步的 checkpoint,才开始下一步。
- `"async"`:下一步开始执行的同时,在后台写上一步的 checkpoint。
- `"exit"`:只在整个图结束(跑完、出错或者 interrupt)时写。

前端类比:`sync` 像每填完一步就 `await saveDraft()` 再跳下一页;`async` 是跳到下一页的同时发保存请求,不等它回来;`exit` 是只在点「提交」时才存。

三档都用「在 draft 里崩一次再续跑」测一遍。上面 `sync` 已经做过了,再做另外两档(每组做完都要 `rm .crash_flag`):

```bash
CRASH_AT=draft uv run python -m part07.resume_demo t-exit exit
psql -d agentzero_w56 -Atc "select count(*) from checkpoints where thread_id='t-exit'"
CRASH_AT=draft uv run python -m part07.resume_demo t-exit exit
rm .crash_flag
```

```text
开跑前:next=() 已有字段=[]
没有进度,从头跑
  classify 调了一次模型 -> billing
  lookup_invoice 查到发票
  !! 在 draft 节点模拟进程被 kill
0
开跑前:next=() 已有字段=[]
没有进度,从头跑
  classify 调了一次模型 -> billing
  lookup_invoice 查到发票
  draft 写好草稿
跑完:steps=['classify', 'lookup_invoice', 'draft']
draft=[billing] 已核实发票 INV-0123,退款申请已提交审批。
```

`exit` 模式下,崩溃之后数据库里是 0 行。第二次运行什么进度都找不到,只能从头跑,模型又调了一次。`os._exit` 不给任何收尾的机会,所以「结束时写一次」这个时机永远没来。跑完以后这个 thread 只有 1 行 checkpoint,就是结束时写的那一行。

```bash
CRASH_AT=draft uv run python -m part07.resume_demo t-async async
psql -d agentzero_w56 -Atc "select count(*) from checkpoints where thread_id='t-async'"
CRASH_AT=draft uv run python -m part07.resume_demo t-async async
rm .crash_flag
```

```text
开跑前:next=() 已有字段=[]
没有进度,从头跑
  classify 调了一次模型 -> billing
  lookup_invoice 查到发票
  !! 在 draft 节点模拟进程被 kill
4
开跑前:next=('draft',) 已有字段=['category', 'invoice', 'steps', 'ticket']
有半路的进度,输入传 None,从断点接着跑
  draft 写好草稿
跑完:steps=['classify', 'lookup_invoice', 'draft']
draft=[billing] 已核实发票 INV-0123,退款申请已提交审批。
```

`async` 在这次实验里和 `sync` 结果一样,也是 4 行、从 draft 续跑。这是因为 draft 节点先睡了 1 秒才崩,后台写 checkpoint 早就写完了。如果崩溃发生在下一步刚开始、后台写入还没完成的那一瞬间,最后一步的 checkpoint 就会丢,续跑时那一步要重做。这个时间窗口很小,我的实验没有制造出来,但文档的描述就是这个意思,你要按「可能丢最后一步」来设计。

| durability | 崩溃后表里几行 | 续跑时重做什么 | 代价 |
| --- | --- | --- | --- |
| `sync` | 4 | 只有 draft | 每步多等一次数据库写入 |
| `async`(默认) | 4(这次) | 只有 draft;极端情况多重做一步 | 几乎没有 |
| `exit` | 0 | 全部,包括模型调用 | 中间进度全丢 |

我的选择:**队列里跑的工单任务用 `sync`**。每步多一次 Postgres 写入,本机上是毫秒级;一次模型调用是秒级(Day 392 实测 1.16 秒),两者差三个数量级。花几毫秒换「崩了不重调模型」很划算。`exit` 只适合短到无所谓重跑、又特别在意性能的场景。

## 第四步:续跑时又传了一遍输入,会怎样

第二步里有一行 `graph_input = None`,我在 line-notes 里说它是关键。如果忘了这个判断,续跑时照样传完整输入,会发生什么?写一个「错误示范」:

```python
# agent-zero-lab/part07/resume_wrong.py
import asyncio

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from part07.ticket_graph import build_graph

DSN = "postgresql://localhost/agentzero_w56"


async def main():
    async with AsyncPostgresSaver.from_conn_string(DSN) as saver:
        graph = build_graph(checkpointer=saver)
        config: RunnableConfig = {"configurable": {"thread_id": "t-wrong"}}
        snap = await graph.aget_state(config)
        print(f"开跑前:next={snap.next}")
        result = await graph.ainvoke({"ticket": "INV-0123 被重复扣款,请退款", "steps": []}, config=config, durability="sync")
        print(f"跑完:steps={result['steps']}")


asyncio.run(main())
```

<div class="line-notes">

- `config: RunnableConfig = {"configurable": {"thread_id": "t-wrong"}}` thread_id 是对的,和崩掉的那次一样。
- `print(f"开跑前:next={snap.next}")` 实测打印 `('draft',)`,进度明明就在那里。
- `result = await graph.ainvoke({"ticket": "INV-0123 被重复扣款,请退款", "steps": []}, config=config, durability="sync")` 错在这里:不管有没有进度,都传了一份完整的新输入。

</div>

先用 `resume_demo` 在 draft 崩一次,造出半路的进度,再跑错误示范:

```bash
CRASH_AT=draft uv run python -m part07.resume_demo t-wrong sync
uv run python -m part07.resume_wrong
rm .crash_flag
```

错误示范的输出:

```text
开跑前:next=('draft',)
  classify 调了一次模型 -> billing
  lookup_invoice 查到发票
  draft 写好草稿
跑完:steps=['classify', 'lookup_invoice', 'classify', 'lookup_invoice', 'draft']
```

开跑前 `next` 明明是 `('draft',)`,可传了新输入以后,LangGraph 把它当成「这个 thread 上来了一条新消息」,从 START 重新走了一遍:模型又调了一次,发票又查了一次。`steps` 里 classify 和 lookup_invoice 各出现两次,因为 `operator.add` 把旧的和新的拼在了一起;`steps: []` 并不会清空旧值,reducer 是「追加」,追加一个空列表等于什么也没加。

这个坑很隐蔽,因为**程序不报错,结果看起来也对**,只是钱花了两遍,而且如果某个节点有副作用(发邮件、建退款),副作用也执行了两遍。所以续跑的入口一定要先 `aget_state`,有进度就传 None。

## 第五步:崩掉的那个节点,会整个重跑

checkpoint 是在节点**返回之后**才写的。崩在节点中间,这个节点做过的事 LangGraph 一概不知,续跑时会把它从头执行一遍。如果节点里有写操作,那就是 Day 390 说的「至少执行一次」又出现了,只不过这次重复的单位是一个节点。

把 Day 391 的 `create_refund_request` 放进一个节点,崩溃点放在「退款已经写进库、节点还没返回」的位置:

```python
# agent-zero-lab/part07/resume_refund.py
import asyncio
import operator
import sys
from typing import Annotated, TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph import END, START, StateGraph
from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

from part07.ticket_graph import maybe_crash
from part07.tools_refund import create_refund_request

DSN = "postgresql://localhost/agentzero_w56"


class RefundState(TypedDict):
    ticket_id: str
    steps: Annotated[list[str], operator.add]


def build(pool: AsyncConnectionPool, saver: AsyncPostgresSaver):
    async def submit_refund(state: RefundState) -> dict:
        r = await create_refund_request(pool, ticket_id=state["ticket_id"], invoice_id="INV-0123", amount_cents=239200)
        print(f"  submit_refund -> {r}", flush=True)
        maybe_crash("submit_refund")  # 退款已经写进库,节点还没返回
        return {"steps": ["submit_refund"]}

    async def notify(state: RefundState) -> dict:
        print("  notify 发了通知", flush=True)
        return {"steps": ["notify"]}

    g = StateGraph(RefundState)
    g.add_node("submit_refund", submit_refund)
    g.add_node("notify", notify)
    g.add_edge(START, "submit_refund")
    g.add_edge("submit_refund", "notify")
    g.add_edge("notify", END)
    return g.compile(checkpointer=saver)


async def main(ticket_id: str):
    async with (
        AsyncPostgresSaver.from_conn_string(DSN) as saver,
        AsyncConnectionPool(DSN, connection_class=AsyncConnection, kwargs={"autocommit": True}) as pool,
    ):
        graph = build(pool, saver)
        config: RunnableConfig = {"configurable": {"thread_id": f"refund-{ticket_id}"}}
        snap = await graph.aget_state(config)
        graph_input: RefundState | None = None if snap.next else {"ticket_id": ticket_id, "steps": []}
        print(f"next={snap.next} -> {'续跑' if graph_input is None else '从头跑'}")
        result = await graph.ainvoke(graph_input, config=config, durability="sync")
        print(f"steps={result['steps']}")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
```

<div class="line-notes">

- `from part07.ticket_graph import maybe_crash` 复用第一步的自毁开关。
- `from part07.tools_refund import create_refund_request` Day 391 默写过的幂等写库函数,幂等键由工单号和发票号算出来。
- `def build(pool: AsyncConnectionPool, saver: AsyncPostgresSaver):` 节点要用连接池,所以把建图放进一个函数里,节点函数定义在里面,直接用外层的 `pool`。这叫闭包,和 JS 里函数引用外层变量是一回事。
- `r = await create_refund_request(pool, ticket_id=state["ticket_id"], invoice_id="INV-0123", amount_cents=239200)` 写操作。第一次执行实测返回 `deduplicated: False`。
- `maybe_crash("submit_refund")  # 退款已经写进库,节点还没返回` 最糟的崩溃时机:库里已经有退款了,checkpoint 里却还没有这一步。
- `async with (` 括号里同时打开两个异步上下文管理器,Python 3.10 起支持这种写法,退出时按相反顺序关闭。
- `AsyncConnectionPool(DSN, connection_class=AsyncConnection, kwargs={"autocommit": True}) as pool,` 和 Day 391 `check_idem.py` 一样的连接池写法。
- `config: RunnableConfig = {"configurable": {"thread_id": f"refund-{ticket_id}"}}` thread_id 由工单号决定,同一张工单永远找回同一份进度。
- `graph_input: RefundState | None = None if snap.next else {"ticket_id": ticket_id, "steps": []}` 第四步的教训:有进度就传 None。这里只看 `snap.next`,因为跑完的 thread 也不会再进来。
- `print(f"next={snap.next} -> {'续跑' if graph_input is None else '从头跑'}")` 实测第二次打印 `next=('submit_refund',) -> 续跑`。

</div>

```bash
CRASH_AT=submit_refund uv run python -m part07.resume_refund T3002
CRASH_AT=submit_refund uv run python -m part07.resume_refund T3002
rm .crash_flag
psql -d agentzero_w56 -Atc "select id, ticket_id from refund_requests where ticket_id='T3002'"
```

```text
next=() -> 从头跑
  submit_refund -> {'refund_id': 'R-bd8729dc', 'deduplicated': False}
  !! 在 submit_refund 节点模拟进程被 kill
next=('submit_refund',) -> 续跑
  submit_refund -> {'refund_id': 'R-bd8729dc', 'deduplicated': True}
  notify 发了通知
steps=['submit_refund', 'notify']
R-bd8729dc|T3002
```

第二次 `next` 是 `('submit_refund',)`,说明 LangGraph 认为这个节点没跑过,于是又执行了一次。`create_refund_request` 被调了第二次,好在幂等键一样,`deduplicated: True`,拿回的还是 `R-bd8729dc`,表里只有 1 行。

所以断点续跑能省掉的,是**已经完整跑完的节点**;正在跑的那个节点,永远可能被执行两次。设计节点时有两条经验:一个节点里最多放一个写操作,而且放在最后;写操作必须有幂等键。把 `create_refund_request` 换成 Day 391 练习 1 那个随机 key 的版本,这里就会多出一笔退款。

## 第六步:放进 arq worker

最后把续跑装进队列任务。思路是:任务第一次执行(`job_try == 1`)正常给输入;如果是重新投递(`job_try > 1`),先看这个工单的 thread 有没有半路的进度,有就传 None。

```python
# agent-zero-lab/part07/resume_worker.py
import asyncio
import sys

from arq import create_pool
from arq.connections import RedisSettings
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from part07.ticket_graph import TicketState, build_graph

DSN = "postgresql://localhost/agentzero_w56"


async def startup(ctx):
    ctx["saver_cm"] = AsyncPostgresSaver.from_conn_string(DSN)
    saver = await ctx["saver_cm"].__aenter__()
    await saver.setup()
    ctx["graph"] = build_graph(checkpointer=saver)


async def shutdown(ctx):
    await ctx["saver_cm"].__aexit__(None, None, None)


async def has_progress(graph, config: RunnableConfig) -> bool:
    snap = await graph.aget_state(config)
    return bool(snap.values) and bool(snap.next)


async def process_ticket(ctx, ticket_id: str, text: str) -> str:
    graph = ctx["graph"]
    config: RunnableConfig = {"configurable": {"thread_id": f"ticket-{ticket_id}"}}
    resume = ctx["job_try"] > 1 and await has_progress(graph, config)
    print(f"[{ticket_id}] try {ctx['job_try']} resume={resume}", flush=True)
    graph_input: TicketState | None = None if resume else {"ticket": text, "steps": []}
    result = await graph.ainvoke(graph_input, config=config, durability="sync")
    return f"{result['steps']}"


class WorkerSettings:
    functions = [process_ticket]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings()
    job_timeout = 20   # 崩了以后,要等 20 + 10 秒别的 worker 才会接手
    max_tries = 3


async def main(ticket_id: str):
    redis = await create_pool(RedisSettings())
    await redis.enqueue_job("process_ticket", ticket_id, "INV-0123 被重复扣款,请退款", _job_id=f"ticket-{ticket_id}")
    await redis.aclose()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
```

<div class="line-notes">

- `ctx["saver_cm"] = AsyncPostgresSaver.from_conn_string(DSN)` `from_conn_string` 返回的是一个异步上下文管理器,平时用 `async with`。worker 的启动和关闭分在两个函数里,没法写成一个 `async with` 块,所以先把它存进 `ctx`。
- `saver = await ctx["saver_cm"].__aenter__()` 手动调 `async with` 进入时会调的那个方法,拿到真正的 checkpointer。
- `ctx["graph"] = build_graph(checkpointer=saver)` 图只在 worker 启动时编译一次,之后所有任务共用。
- `await ctx["saver_cm"].__aexit__(None, None, None)` 对应 `async with` 退出时的动作,关闭数据库连接。三个 None 表示「没有异常」。
- `return bool(snap.values) and bool(snap.next)` 和第二步同一个判断:有数据而且没跑完。
- `config: RunnableConfig = {"configurable": {"thread_id": f"ticket-{ticket_id}"}}` thread_id 用工单号拼,任务重新投递时自然找回同一份进度。
- `resume = ctx["job_try"] > 1 and await has_progress(graph, config)` `and` 是短路求值,和 JS 的 `&&` 一样:第一次执行时 `job_try` 是 1,前半句为 False,后面那个查数据库的 `await` 根本不会执行。
- `print(f"[{ticket_id}] try {ctx['job_try']} resume={resume}", flush=True)` 实测第一次 `try 1 resume=False`,第二次 `try 2 resume=True`。
- `result = await graph.ainvoke(graph_input, config=config, durability="sync")` 第三步的结论:队列任务用 sync。
- `job_timeout = 20   # 崩了以后,要等 20 + 10 秒别的 worker 才会接手` 这个数字下面实验会解释。
- `await redis.enqueue_job("process_ticket", ticket_id, "INV-0123 被重复扣款,请退款", _job_id=f"ticket-{ticket_id}")` job id 也用工单号,Day 391 讲过的 webhook 去重。

</div>

实验:入队一张工单,起一个会在 lookup_invoice 崩掉的 worker;它崩了之后,马上再起一个 worker,看第二个 worker 多久接手。

```bash
uv run python -m part07.resume_worker T3001
CRASH_AT=lookup_invoice uv run arq --burst part07.resume_worker.WorkerSettings
date +%T
CRASH_AT=lookup_invoice uv run arq --burst part07.resume_worker.WorkerSettings
rm .crash_flag
```

第一个 worker 的输出:

```text
12:58:14: Starting worker for 1 functions: process_ticket
12:58:14: redis_version=7.4.6 mem_usage=1.65M clients_connected=1 db_keys=31
12:58:14:   7.90s → ticket-T3001:process_ticket('T3001', 'INV-0123 被重复扣款,请退款') delayed=7.90s
[T3001] try 1 resume=False
  classify 调了一次模型 -> billing
  !! 在 lookup_invoice 节点模拟进程被 kill
```

`delayed=7.90s` 是入队到开始执行之间的时间,大头花在 worker 启动时导入 langgraph 这些包上,这台 2019 年的 Intel MacBook 启动一个带 langgraph 的 Python 进程要好几秒。中间 `date +%T` 打出的是 `12:58:16`,第二个 worker 的输出:

```text
12:58:21: Starting worker for 1 functions: process_ticket
12:58:21: redis_version=7.4.6 mem_usage=1.65M clients_connected=1 db_keys=34
12:58:44:  37.97s → ticket-T3001:process_ticket('T3001', 'INV-0123 被重复扣款,请退款') try=2 delayed=37.97s
[T3001] try 2 resume=True
  lookup_invoice 查到发票
  draft 写好草稿
12:58:46:   2.03s ← ticket-T3001:process_ticket ● "['classify', 'lookup_invoice', 'draft']"
```

第二个 worker 12:58:21 就起来了,却到 12:58:44 才开始执行这个任务,中间干等了 23 秒。从第一个 worker 开始执行(12:58:14)算起,正好 30 秒左右。这就是 `job_timeout + 10` 的来历。

我翻了 arq 0.28.0 的 `worker.py`:worker 开始执行一个任务前,会在 Redis 里写一个 `in-progress` 标记,过期时间是 `job_timeout + 10` 秒(源码里是 `self.in_progress_timeout_s = (max_timeout or 0) + 10`)。别的 worker 看到这个标记,就认为「有人在做」,跳过它。正常执行完,标记会被删掉;进程被 kill,没人删,只能等它自己过期。arq 没有办法区分「那个 worker 还在认真干活」和「那个 worker 已经死了」,只能靠这个过期时间。

所以 `job_timeout` 不只是「一个任务最多跑多久」,也是「worker 死了以后任务最晚多久被接手」。设成 300 秒,崩溃后的任务要等 5 分钟多才会被重新执行。这是个取舍:设太短,正常的慢任务会被判超时;设太长,崩溃后恢复得慢。

第二次执行 `try=2 resume=True`,只跑了 lookup_invoice 和 draft,用了 2.03 秒,classify 没有再调模型。

## 动手练习

### 练习 1:崩在 lookup_invoice,哪些节点会重跑

用 `resume_demo` 在 lookup_invoice 崩一次再续跑(thread 用 `t-p1`)。先预测:续跑时会打出哪几行?崩溃后表里有几个 checkpoint?

<details><summary>参考答案</summary>

预测:lookup_invoice 是崩在节点中间,它会重跑;classify 已经完整跑完,不会重跑。崩溃后表里应该有 step -1、0、1 三行。

```bash
CRASH_AT=lookup_invoice uv run python -m part07.resume_demo t-p1
CRASH_AT=lookup_invoice uv run python -m part07.resume_demo t-p1
rm .crash_flag
psql -d agentzero_w56 -c "select metadata->>'source' src, metadata->>'step' step, checkpoint->'channel_versions' ? 'category' as has_cat from checkpoints where thread_id='t-p1' order by checkpoint_id"
```

```text
开跑前:next=() 已有字段=[]
没有进度,从头跑
  classify 调了一次模型 -> billing
  !! 在 lookup_invoice 节点模拟进程被 kill
开跑前:next=('lookup_invoice',) 已有字段=['category', 'steps', 'ticket']
有半路的进度,输入传 None,从断点接着跑
  lookup_invoice 查到发票
  draft 写好草稿
跑完:steps=['classify', 'lookup_invoice', 'draft']
draft=[billing] 已核实发票 INV-0123,退款申请已提交审批。
```

```text
  src  | step | has_cat 
-------+------+---------
 input | -1   | f
 loop  | 0    | f
 loop  | 1    | t
 loop  | 2    | t
 loop  | 3    | t
(5 rows)
```

续跑时 `已有字段` 里有 `category` 但没有 `invoice`,和预测一致。`has_cat` 那一列用了 Postgres 的 `?` 运算符,意思是「这个 JSON 对象里有没有 category 这个键」,从 step 1 开始为 true,说明分类结果是在 classify 跑完那一刻存下来的。

</details>

### 练习 2:thread_id 里混进了随机数

有人把 worker 里的 thread_id 写成了 `f"ticket-{ticket_id}-{uuid.uuid4().hex[:6]}"`,理由是「避免冲突」。不用跑,说说崩溃后重新投递会发生什么,和第四步的坑有什么异同。

<details><summary>参考答案</summary>

每次执行都会生成一个新的 thread_id,重新投递时 `aget_state` 查的是一个全新的 thread,`next` 是空的,`has_progress` 返回 False,于是从头跑:模型重调,发票重查。上一次执行留下的 checkpoint 成了孤儿数据,永远不会被读到。

和第四步相同的地方是结果都是「从头再跑一遍」,而且都不报错。不同的地方是:第四步的 thread 是对的,只是输入传错了,所以 `steps` 会把两遍拼在一起;这里是换了一个 thread,新 thread 里干干净净,`steps` 看上去完全正常,更难发现。

这和 Day 391 练习 1 把幂等键换成 uuid 是同一类错误:一个本该由业务含义决定的 key,混进了随机数,「同一件事」就认不出来了。

这道题我没有单独实跑,第四步和第二步的实验已经覆盖了它的两个组成部分(新 thread 从头跑、旧 thread 有进度)。

</details>

### 练习 3:让崩溃后的任务更快被接手

把 `job_timeout` 改成 5 秒,重做第六步的实验,看第二个 worker 等了多久。提示:新建一个 `resume_worker_fast.py`,只放一个新的 `WorkerSettings`。

<details><summary>参考答案</summary>

我第一次图省事,写的是继承:

```python
# agent-zero-lab/part07/resume_worker_fast.py(第一版,跑不起来)
from part07.resume_worker import WorkerSettings as BaseSettings


class WorkerSettings(BaseSettings):
    job_timeout = 5  # 崩了以后,5 + 10 秒别的 worker 就能接手
```

<div class="line-notes">

- `from part07.resume_worker import WorkerSettings as BaseSettings` `as` 是导入时改个名字,相当于 JS 的 `import { WorkerSettings as BaseSettings }`。
- `class WorkerSettings(BaseSettings):` 继承原来的配置,只改一项。看上去很合理。

</div>

一跑就报错:

```text
  File ".../arq/worker.py", line 236, in __init__
    raise RuntimeError('at least one function or cron_job must be registered')
RuntimeError: at least one function or cron_job must be registered
```

原因在 arq 的 `worker.py` 里读配置的 `get_kwargs` 函数:它用的是 `settings_cls.__dict__`,只读这个类**自己**定义的属性,不看父类。子类里只有 `job_timeout`,`functions` 是继承来的,arq 看不见,就认为一个任务函数都没注册。改成把配置写全:

```python
# agent-zero-lab/part07/resume_worker_fast.py
from arq.connections import RedisSettings

from part07.resume_worker import process_ticket, shutdown, startup


class WorkerSettings:
    functions = [process_ticket]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings()
    job_timeout = 5  # 崩了以后,5 + 10 秒别的 worker 就能接手
    max_tries = 3
```

<div class="line-notes">

- `from part07.resume_worker import process_ticket, shutdown, startup` 复用任务函数和启动、关闭函数,只是不复用配置类。
- `job_timeout = 5  # 崩了以后,5 + 10 秒别的 worker 就能接手` 我们的图正常跑完只要 3 秒左右,5 秒够用;真实的 Agent 任务要按实测的耗时分布来定。

</div>

```bash
uv run python -m part07.resume_worker T3003
CRASH_AT=lookup_invoice uv run arq --burst part07.resume_worker_fast.WorkerSettings
CRASH_AT=lookup_invoice uv run arq --burst part07.resume_worker_fast.WorkerSettings
rm .crash_flag
```

两个 worker 的输出接在一起:

```text
13:10:05: Starting worker for 1 functions: process_ticket
13:10:05: redis_version=7.4.6 mem_usage=1.65M clients_connected=1 db_keys=15
13:10:05:  19.28s → ticket-T3003:process_ticket('T3003', 'INV-0123 被重复扣款,请退款') delayed=19.28s
[T3003] try 1 resume=False
  classify 调了一次模型 -> billing
  !! 在 lookup_invoice 节点模拟进程被 kill
13:10:10: Starting worker for 1 functions: process_ticket
13:10:10: redis_version=7.4.6 mem_usage=1.65M clients_connected=1 db_keys=18
13:10:20:  34.66s → ticket-T3003:process_ticket('T3003', 'INV-0123 被重复扣款,请退款') try=2 delayed=34.66s
[T3003] try 2 resume=True
  lookup_invoice 查到发票
  draft 写好草稿
13:10:22:   2.03s ← ticket-T3003:process_ticket ● "['classify', 'lookup_invoice', 'draft']"
```

第一个 worker 13:10:05 开始执行,第二个 13:10:20 接手,15 秒,正好是 5 + 10。(第一个 worker 的 `delayed=19.28s` 是因为我入队以后先撞了上面那个 RuntimeError,改代码花了些时间。)

</details>

**验收标准**:能复现 sync 模式下崩溃后 4 行、续跑只打出 draft 一行;能复现 exit 模式下崩溃后 0 行;能复现第四步 `steps` 里出现两次 classify;能说清 `resume_refund` 里为什么 submit_refund 跑了两次但表里只有 1 行;能解释 worker 为什么要等 `job_timeout + 10` 秒才接手。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 断点续跑 | 任务中途崩溃后,重新执行时从最后一个保存的进度继续,不重做已完成的步骤 |
| `durability` | LangGraph 运行参数,控制 checkpoint 何时写入:`sync` 写完再走下一步,`async`(默认)边走边写,`exit` 只在结束时写 |
| `AsyncPostgresSaver` | `langgraph-checkpoint-postgres` 包里的异步 checkpointer,把快照存进 Postgres 的 `checkpoints` 等表 |
| `snap.next` | `aget_state` 返回的快照里「下一步要跑的节点」元组;空元组表示没开始或已跑完 |
| `os._exit` | 立即结束进程,不执行任何清理代码,用来模拟 `kill -9` |
| in-progress 标记 | arq 在 Redis 里给正在执行的任务加的标记,过期时间 `job_timeout + 10` 秒;worker 被 kill 后要等它过期,任务才会被别的 worker 接手 |
| `__aenter__` / `__aexit__` | `async with` 进入和退出时调用的两个方法,手动调用可以把一个 `async with` 拆到两个函数里 |

## 常见误区

**续跑时又传了一遍完整输入。** 程序不报错,但图会从 START 重新走,模型重调、副作用重做,带 reducer 的字段还会把两遍拼起来(第四步实测 `steps` 里 classify 出现两次)。续跑入口先 `aget_state`,有 `next` 就传 None。

**以为有了 checkpoint 就不用幂等了。** checkpoint 只记录**跑完的**节点。崩在节点中间,这个节点会整个重跑,里面的写操作会执行两次。第五步的 `create_refund_request` 被调了两次,靠幂等键才只有一行。

**用默认 durability,或者为了性能选 `exit`。** 默认是 `async`,极端时机会丢最后一步;`exit` 在进程被 kill 时什么都不留(第三步实测 0 行)。队列里的长任务用 `sync`,每步多几毫秒,换来崩溃后不重调模型。

**thread_id 里混进随机数或时间戳。** 每次执行都是新 thread,永远找不回进度,而且新 thread 里数据干净,比传错输入更难发现。thread_id 要由业务 id 唯一决定,比如 `ticket-{工单号}`。

**以为 worker 一死任务马上被接手。** arq 靠 Redis 里 in-progress 标记的过期来判断,默认 `job_timeout=300` 时要等 310 秒。第六步实测 `job_timeout=20` 等了约 30 秒。

**用继承写 arq 的 `WorkerSettings`。** arq 只读配置类自己的 `__dict__`,继承来的 `functions` 看不见,报 `RuntimeError: at least one function or cron_job must be registered`。每个配置类把需要的属性写全。

## 学习资料

### 文档与文章

- [LangGraph 文档 · Persistence](https://docs.langchain.com/oss/python/langgraph/persistence):checkpointer 和 store 的区别、thread_id、各种 checkpointer 后端。页面末尾的 Troubleshooting 里有一条和今天相关:PostgresSaver 的 thread_id 不能太长。英文,30 分钟。
- [langgraph-checkpoint-postgres · PyPI](https://pypi.org/project/langgraph-checkpoint-postgres/):Postgres checkpointer 的安装和用法,`setup()`、同步版和异步版的写法都在 README 里。15 分钟。
- [arq 官方文档](https://arq-docs.helpmanual.io/):搜 `job_timeout` 和 Health checks,对照今天第六步看 worker 崩溃后的行为。20 分钟。
- [Temporal · What is durable execution?](https://temporal.io/blog/what-is-durable-execution):Temporal 官方博客讲「持久化执行」的概念。今天用 checkpoint 做的事,Temporal 把它做成了整个平台,Day 395 会专门讲。英文,20 分钟,先读个大概。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1g61fBFEKY&autoplay=0&high_quality=1" title="最新 Langchain1.0 入门【17】langgraph 状态管理器 checkpointer 详细解析" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>强哥学编程 · 最新 Langchain1.0 入门【17】langgraph 状态管理器 checkpointer 详细解析 · 约 32 分钟,2025 年 11 月。中文讲 checkpointer,适合把 Day 316 到 318 的内容和今天串起来复习。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1JNkFBMEFH&autoplay=0&high_quality=1" title="用Temporal构建持久化AI智能体 | AI Engineer" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>7k的每日搬运 · 用Temporal构建持久化AI智能体 | AI Engineer · 约 78 分钟,搬运自 AI Engineer 的英文讲座(简介里附了原视频链接)。很长,今天先看前 15 分钟,知道「智能体要能扛住崩溃」这件事业界是怎么做的,Day 395 再看完。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/_IPP7_Bi8uA" title="Persistence in LangGraph | Time Travel in LangGraph | CampusX" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>CampusX · Persistence in LangGraph | Time Travel in LangGraph · 讲 LangGraph 的持久化和时间旅行,和今天的 checkpoint 表是同一套机制。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/0yZAqIsyskA" title="Simplifying distributed systems development with Temporal's durable execution" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Stripe Developers · Simplifying distributed systems development with Temporal's durable execution · 英文,Stripe 开发者频道上关于 Temporal 持久化执行的分享,可以留到 Day 395 前看。</figcaption>
</figure>

### 书籍

今天这组不需要。断点续跑的工程细节都在文档和源码里;想补理论的话,Day 391 书单里的《Designing Data-Intensive Applications》讲流处理容错的那一章(第一版第 11 章)讲的是同一类问题。

### 开源项目与代码

- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):在 `libs/langgraph/langgraph/pregel/main.py` 里搜 `durability`,能看到正文引用的三档说明;`libs/checkpoint-postgres` 是 Postgres checkpointer 的源码,看它建了哪几张表。
- [python-arq/arq](https://github.com/python-arq/arq):`arq/worker.py` 里搜 `in_progress_timeout_s`,就是第六步那个 `+ 10`;搜 `def get_kwargs`,就是练习 3 那个继承坑。

## 自测

1. 同一张工单,worker 第一次执行时在 draft 里被 kill(durability 是 sync)。第二次执行时,模型会被调用几次?为什么?

<details><summary>答案</summary>

0 次。classify 是唯一调模型的节点,它在第一次执行时已经完整跑完,checkpoint 里有它的结果(category)。第二次执行从 `next=('draft',)` 开始,只跑 draft。第二步的实测输出里只打出了 `draft 写好草稿` 一行。

</details>

2. 同样的崩溃,durability 换成 exit,第二次执行时模型会被调用几次?

<details><summary>答案</summary>

1 次。exit 只在图结束时写 checkpoint,进程被 `os._exit` 杀掉时没有结束这个时机,数据库里一行都没有(第三步实测 0 行)。第二次执行找不到任何进度,从头跑。

</details>

3. 续跑时传了完整输入 `{"ticket": ..., "steps": []}`,为什么 `steps` 里会出现重复的节点名,而不是被 `[]` 清空?

<details><summary>答案</summary>

`steps` 的 reducer 是 `operator.add`,新值和旧值是拼接关系。传 `[]` 等于在旧列表后面拼一个空列表,旧的 `['classify', 'lookup_invoice']` 还在;随后图从 START 重新走,又追加了一遍。要清空得换 reducer 或者换一个新的 thread,但续跑的正确做法是传 None。

</details>

4. 节点 `submit_refund` 里先建退款再发邮件,进程在发邮件之后、节点返回之前被 kill。续跑时会发生什么?怎么改?

<details><summary>答案</summary>

整个节点重跑:退款再建一次(有幂等键的话拿回原来那条),邮件再发一次(大多数邮件服务不会替你去重,客户会收到两封)。改法:一个节点只放一个写操作,把发邮件拆成单独的节点;发邮件也带一个由工单号算出的幂等键,发之前先查有没有发过。

</details>

5. (面试题)你的 Agent 任务平均要跑 3 分钟、调 6 次模型,跑在队列 worker 上。部署时会滚动重启 worker。你怎么保证重启不会让任务重头再来、也不会重复执行副作用?

<details><summary>答案</summary>

参考答法:状态用 LangGraph 的 Postgres checkpointer 持久化,thread_id 由任务的业务 id 决定(比如 `ticket-{工单号}`),durability 用 sync,每步写完再走下一步。任务重新投递时(`job_try > 1`)先 `aget_state`,有未完成的 `next` 就输入传 None 续跑,已完成的模型调用不会重做。副作用方面,崩溃中的那个节点一定会重跑,所以每个节点最多一个写操作,写操作都带业务幂等键,由数据库唯一约束去重。另外要考虑队列的接手延迟:arq 靠 in-progress 标记过期判断 worker 死亡,时间是 `job_timeout + 10` 秒,`job_timeout` 要按任务耗时分布来定;滚动重启时更好的做法是让 worker 收到信号后停止领新任务、等手上的跑完再退出,而不是直接被 kill。

</details>

## 明天预告

Day 394 · 工单处理 worker,上线和扩容。这几天的零件(队列、错误分类重试、幂等键、超时分层、断点续跑)都单独跑过了,明天把它们拼成一个完整的工单处理 worker,接上真正的 Agent 图,再讲 worker 怎么部署、开几个、怎么优雅地重启,也就是今天面试题最后那半句。
