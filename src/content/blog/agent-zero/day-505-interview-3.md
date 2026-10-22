---
title: 'Day 505 · 面试(三):Agent 架构、框架原理与上下文工程题'
description: '面试基础题的第三套:架构与框架原理 8 题、上下文工程与记忆 6 题。四个小实验给答案找证据:同一张工单 workflow 和 agent 各花多少、不调模型的 LangGraph 小图跑出 reducer 报错和四个 checkpoint、假模型演示死循环和重复检测、长对话直接截断和先摘要再截断的对比。'
pubDate: 2026-10-22
regime: none
tags: ['interview', 'agent-architecture', 'langgraph', 'context-engineering', 'agent-zero']
series: 'agent-zero'
day: 505
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 504](/blog/agent-zero/day-504-interview-2/) 刷了第二套题,工具调用和 RAG。`quiz.py` 学会了选题库,`weak.py` 换成 `load_all` 之后能同时看所有题库;四个实验留下了几个能当场说的数:模型返回的参数是字符串、`unpaid` 被校验拦下后一次改成 `open`、500 张发票原样塞进去两次答错、「开票报 E1042」让向量检索把只差一位的 E2042 排第一。

那两套考的是零件。今天第三套往上一层,问零件怎么拼成一个 Agent:流程由谁决定、框架在背后替你做了什么、跑久了上下文越来越长怎么办。这一层是「会调 API」和「会做 Agent」的分界线,国内 JD 里写到上下文工程的占 52%,写到 Agent 框架的占 46%,写到多 Agent 的占 37%,海外这三个数分别是 25%、36%、22%,国内明显更爱问内部机制。

## 今天要解决的问题

学完今天,你应该能做到:

1. 用自己跑出来的调用次数和 token 数,说清同一个任务 workflow 和 agent 差在哪,为什么「能用 workflow 就用 workflow」。
2. 不调模型,用一个三节点的 LangGraph 小图演示 reducer 的作用和超步、checkpoint 的样子,答第 32 题时能说出四个关键词并给出现象。
3. 说出长对话压缩的两种做法各丢什么,并有一组「直接截断答不出、摘要后答得出」的实测对比。
4. 把第 29 到 42 题每道计时出声答一遍。

预计用时 2.5–3 小时。前置:第三部分 [Day 165](/blog/agent-zero/day-165-agent-what/) 到 [Day 204](/blog/agent-zero/day-204-when-agent/) 的 Agent 循环、失败模式和 workflow 模式;第五部分 [Day 298](/blog/agent-zero/day-298-langchain-vs-langgraph/) 到 [Day 324](/blog/agent-zero/day-324-lg-subgraph/) 的 LangGraph;第四部分 [Day 262](/blog/agent-zero/day-262-context-budget/) 到 [Day 267](/blog/agent-zero/day-267-subagent-isolation/) 的上下文工程;Day 504 的 `tools2.py` 和改过的 `quiz.py`。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把实验二的 LangGraph 小图和实验三的重复检测默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。题目部分先计时出声答,再看答案。

## 这一套题和前两套有什么不一样

前两套题,多数有一个比较确定的答案:token 是什么、tool_calls 长什么样、RRF 怎么算。今天这套,很多题没有标准答案,问的是取舍:什么时候用 agent、什么时候不用框架、什么时候拆多 Agent。面试官问这类题,是想看你脑子里有没有一杆秤。

所以今天答题,四步结构里的第 3 步「取舍」最重要。光说「Agent 更灵活」不够,要说「灵活的代价是什么、我在什么情况下愿意付这个代价」。最好的代价是一个数字,实验一就是给这个数字准备的。

第三套题库照旧放 `part09/interview/bank3.json`,编号从 29 到 42。Day 504 写的 `load_all` 用 `glob("bank*.json")` 找题库,所以这一套放进去就会被自动读到,不用改代码:

```bash
cd agent-zero-lab
```

`part09/interview/bank3.json` 可以直接复制:

```json
[
 {"id": "29", "q": "Workflow 和 Agent 有什么区别?怎么选?", "day": [196, 204], "points": ["代码定路径 vs 模型定路径", "能 workflow 就 workflow:可预测、便宜、好测", "常见:workflow 里嵌一个 agent 节点"]},
 {"id": "30", "q": "常见的 workflow 模式有哪几种?", "day": [197, 198, 199, 200, 201], "points": ["提示链、路由、并行", "编排者-工作者、评估者-优化者", "说出 SupportPilot 用了哪两种"]},
 {"id": "31", "q": "ReAct 是什么?原生 function calling 普及后它还重要吗?", "day": [172, 175], "points": ["Thought/Action/Observation 交替", "文本解析被原生 tool_calls 取代", "循环形态还在,Thought 被推理模型内化"]},
 {"id": "32", "q": "LangGraph 底层是怎么实现的?", "day": [304, 313, 316], "points": ["状态 + 节点 + 边,编译成 Pregel 式运行时", "按超步推进,reducer 合并更新", "每个超步存 checkpoint,interrupt 靠它"]},
 {"id": "33", "q": "什么时候不应该用 Agent 框架?", "day": [204, 313, 334], "points": ["一个循环能搞定", "要完全控制、抽象碍事、版本跟不上", "要持久化/审批/续跑时框架才值"]},
 {"id": "34", "q": "长任务里,怎么让 Agent 不跑偏?", "day": [176, 177], "points": ["先计划,todo 逐项更新", "验收条件、检查点、人确认", "预算上限;子 Agent 隔离"]},
 {"id": "35", "q": "Agent 常见的失败模式有哪些?分别怎么处理?", "day": [189, 192], "points": ["死循环:步数 + 重复检测", "工具名/参数错:校验回传", "超时降级、提前宣布完成、兜底转人工"]},
 {"id": "36", "q": "多 Agent 什么时候值得用,什么时候不该用?", "day": [329, 332], "points": ["可并行、需要大量独立上下文", "token 贵很多,协调难调试", "强依赖、共享上下文的任务别拆"]},
 {"id": "37", "q": "什么是上下文工程?和提示词工程有什么区别?", "day": [262], "points": ["每次调用窗口里放什么", "系统提示、工具、检索、历史、记忆的取舍", "国内 JD 52% 提到"]},
 {"id": "38", "q": "为什么上下文越长效果可能越差?", "day": [262, 109], "points": ["注意力有限,无关内容干扰", "中间位置利用差", "过时结果、错误尝试会误导"]},
 {"id": "39", "q": "长对话或长任务的上下文怎么压缩?", "day": [263, 465], "points": ["早期摘要 + 最近几轮原文", "清理用过的工具结果,外部笔记", "注意缓存和评测压缩后效果"]},
 {"id": "40", "q": "短期记忆和长期记忆怎么设计?", "day": [264, 466], "points": ["短期:会话状态 checkpoint", "长期:跨会话事实和偏好", "写入时机、检索、过期、隐私"]},
 {"id": "41", "q": "在 SupportPilot 这样的系统里,上下文预算怎么分配?", "day": [262, 465], "points": ["固定前缀 + 动态内容", "检索、工具结果、历史各有上限", "上限用评测调"]},
 {"id": "42", "q": "子 Agent 怎么帮助上下文管理?", "day": [267, 332], "points": ["脏活在独立上下文里做", "只回传结论", "代价:多 token,派活要写清"]}
]
```

抽两道试试,再看回炉清单(管道模拟按键的写法见 Day 502,你自己练时直接 `uv run python -m part09.quiz 5 bank3`):

```bash
( sleep 2; echo; echo 2; sleep 2; echo; echo 1 ) | uv run python -m part09.quiz 2 bank3
uv run python -m part09.weak
```

```text

【40】短期记忆和长期记忆怎么设计?
出声答完按回车 > 用时 1.8 秒
  要点: 短期:会话状态 checkpoint
  要点: 长期:跨会话事实和偏好
  要点: 写入时机、检索、过期、隐私
自评 0 没答出 / 1 答了一半 / 2 都答到 > 
【39】长对话或长任务的上下文怎么压缩?
出声答完按回车 > 用时 2.0 秒
  要点: 早期摘要 + 最近几轮原文
  要点: 清理用过的工具结果,外部笔记
  要点: 注意缓存和评测压缩后效果
自评 0 没答出 / 1 答了一半 / 2 都答到 > 
已记录 2 题到 part09/interview/log.jsonl
题库 46 题,答过 8 题,要回炉 4 题
  [0分 2.0秒] 25. RAG 回答不准,怎么排查?… → 回去看 Day 255、Day 259
  [1分 2.0秒] 加2. 注意力里的 Q、K、V 是什么?多头有什… → 回去看 Day 116
  [1分 1.6秒] 24. rerank 是做什么的?为什么不直接用… → 回去看 Day 238
  [1分 2.0秒] 39. 长对话或长任务的上下文怎么压缩?… → 回去看 Day 263、Day 465
还没抽到过:['1', '2', '3', '4', '5', '加1', '加3', '加4', '8', '9', '10', '11', '12', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '26', '27', '28', '29', '30', '31', '32', '33', '34', '35', '36', '37', '38', '41', '42']
```

题库从 32 题变成了 46 题,一行代码没改。这就是 Day 504 用 `glob` 而不是写死文件名的好处。第 39 题这次拿了 1 分,进了回炉清单,今天的实验四就是给它准备的。

## 给答案找证据

四个实验:实验一调 DeepSeek,实验二和实验三一分钱不花(实验二不调模型,实验三用假模型),实验四调 DeepSeek。都放在 `part09/interview/`,都在 `agent-zero-lab/` 目录下用 `-m` 运行。实验二要 LangGraph,第五部分已经装过;如果你的 `pyproject.toml` 里没有,先 `uv add langgraph`(2026 年 10 月我装到的是 1.2.16)。

### 实验一:同一张工单,workflow 和 agent 各花多少(第 29、30 题)

第 29 题人人都会背 Anthropic 那句「能用 workflow 就用 workflow」。但你问他为什么,多半只会说「更可控」。今天用同一张工单各跑一遍,把差别变成数字。

workflow 版本是写死的两步:先让模型分类,如果是账单问题,代码直接去查客户和发票(不经过模型决定),再让模型写回复。这就是 [Day 198](/blog/agent-zero/day-198-routing/) 的路由模式。agent 版本把 Day 504 的三个工具都给模型,让它自己决定查什么。工具结果都是假数据,写在字典里,和 CloudLedger 业务库里 C001 的数据一致。

```python
# agent-zero-lab/part09/interview/evidence_wf_agent.py
import json

from common.llm import LLMClient
from part09.interview.tools2 import TOOLS

TICKET = "我是 user001@example.com,这个月的发票金额好像不对,帮我看看。"
FAKE_DB = {
    "find_customer": [{"id": "C001", "name": "刘伟", "company": "星河餐饮"}],
    "get_subscription": {"plan": "基础版", "billing_cycle": "monthly", "seats": 2, "status": "trialing"},
    "list_invoices": [{"id": "INV-2026-0001", "amount_yuan": "98.00", "status": "paid", "issued_at": "2026-10-09"},
                      {"id": "INV-2026-0002", "amount_yuan": "98.00", "status": "paid", "issued_at": "2026-09-12"}],
}
REPLY_RULE = "你是云簿客服。根据给定数据用三句话以内回复客户,不要编数据。"


def workflow(llm: LLMClient) -> str:
    cat = llm.chat([
        {"role": "system", "content": "把工单分到 billing / technical / account / other,只输出类别名。"},
        {"role": "user", "content": TICKET},
    ], temperature=0).content.strip()
    data = {"customer": FAKE_DB["find_customer"][0], "invoices": FAKE_DB["list_invoices"]} if cat == "billing" else {}
    return llm.chat([
        {"role": "system", "content": REPLY_RULE},
        {"role": "user", "content": f"工单:{TICKET}\n类别:{cat}\n数据:{json.dumps(data, ensure_ascii=False)}"},
    ], temperature=0).content


def agent(llm: LLMClient, max_steps: int = 6) -> str:
    messages: list[dict] = [{"role": "system", "content": REPLY_RULE + "需要数据时调用工具。"},
                            {"role": "user", "content": TICKET}]
    for _ in range(max_steps):
        r = llm.chat(messages, tools=TOOLS, temperature=0)
        messages.append(r.message)
        calls = r.message.get("tool_calls", [])
        if not calls:
            return r.content
        for c in calls:
            print("    agent 调用:", c["function"]["name"], c["function"]["arguments"])
            messages.append({"role": "tool", "tool_call_id": c["id"],
                             "content": json.dumps(FAKE_DB[c["function"]["name"]], ensure_ascii=False)})
    return "超过最大步数,转人工"


for name, fn in [("workflow", workflow), ("agent", agent)]:
    llm = LLMClient()
    answer = fn(llm)
    print(f"{name}: {llm.ledger}\n  回复:{answer[:70]!r}")
```

<div class="line-notes">

- `from part09.interview.tools2 import TOOLS` Day 504 写的三个工具定义:`find_customer`、`get_subscription`、`list_invoices`。
- `FAKE_DB = {` 假的工具结果,键是工具名。不管模型传什么参数,都返回这一份,今天只比较「谁决定流程」,不关心查询本身。
- `def workflow(llm: LLMClient) -> str:` 流程写死在代码里:分类 → 按类别查数据 → 写回复。模型只负责两个小任务,不决定下一步做什么。
- `data = {"customer": FAKE_DB["find_customer"][0], "invoices": FAKE_DB["list_invoices"]} if cat == "billing" else {}` 这一行就是「路由」:分类结果是 billing 才查客户和发票。查什么由代码决定,所以它不会去查订阅。
- `return llm.chat([` 第二次调用,把工单、类别、数据一次交给模型写回复。
- `def agent(llm: LLMClient, max_steps: int = 6) -> str:` [Day 166](/blog/agent-zero/day-166-agent-min/) 那个最小 Agent 循环,加了一个步数上限。
- `messages.append(r.message)` 模型的回复先进历史,再追加工具结果,顺序不能反。
- `if not calls:` 模型不再要工具,说明它认为可以回答了,循环结束。
- `"content": json.dumps(FAKE_DB[c["function"]["name"]], ensure_ascii=False)})` 按工具名取假数据回传。这里没做参数校验,生产代码要先过 Day 504 实验二的 `check`。
- `llm = LLMClient()` 每个版本新建一个客户端,各自的 `ledger` 只记自己的花费,方便对比。

</div>

```bash
uv run python -m part09.interview.evidence_wf_agent
```

```text
workflow: 2 次调用 | 输入 203 / 输出 77 tokens | 约 ¥0.0010
  回复:'您好，查询到您名下最近两张发票：INV-2026-0001（2026-10-09，98.00元，已支付）和INV-2026-0002（202'
    agent 调用: find_customer {"query": "user001@example.com"}
    agent 调用: get_subscription {"customer_id": "C001"}
    agent 调用: list_invoices {"customer_id": "C001"}
agent: 3 次调用 | 输入 1874 / 输出 184 tokens | 约 ¥0.0032
  回复:'您当前是基础版月付、2 个席位，状态为试用中；最近两张发票（2026-09-12 和 2026-10-09）金额均为 98.00 元，已支付'
```

数字摆出来:workflow 2 次调用、输入 203 个 token、¥0.0010;agent 3 次调用、输入 1874 个 token、¥0.0032。输入 token 差了 9 倍,花费差了 3 倍多。为什么输入差这么多?agent 每一轮都要把工具定义(三个工具的 JSON Schema)和之前所有的消息重新发一遍,第三次调用时历史里已经有两轮工具调用和结果了。workflow 的两次调用各自只带自己需要的那点东西。

但 agent 也不是白花钱。它多查了一次订阅,发现了一个 workflow 漏掉的细节:这位客户的状态是「试用中」,却付了两张 98 元的发票。这很可能就是「金额不对」的真正原因(试用期不该收费)。workflow 的路由里写死了「账单问题只查发票」,所以永远看不到这个线索。

这就是第 29 题第 3 步的完整取舍:**workflow 便宜、可预测、好评测,但只能走你预先想到的路;agent 贵三倍,但能根据中间结果走你没想到的路**。面试时把这组数说出来,再补一句「所以 SupportPilot 的主流程是 workflow,只在『复杂账单调查』这一个节点里放了一个 agent」,这就是「workflow 里嵌一个 agent 节点」的具体样子。

一次运行的样本只能说明方向,不能说明比例。不同工单、不同模型,倍数会不一样;练习时多换几张工单跑。

### 实验二:不调模型,看清 LangGraph 的 reducer 和超步(第 32 题)

第 32 题「LangGraph 底层是怎么实现的」,能答出「状态、reducer、超步、checkpoint」四个词的人不多,能当场举出现象的更少。这个实验不调模型,一分钱不花,用三个节点的小图把四个词都跑出来。

图长这样:开始后两个节点并行(查发票、查套餐),都完成后进入回复节点。两个并行节点都往同一个字段 `notes` 里写东西,这正是 [Day 303](/blog/agent-zero/day-303-lg-overwrite/) 和 [Day 304](/blog/agent-zero/day-304-lg-reducer/) 讲的场景。

```python
# agent-zero-lab/part09/interview/evidence_reducer.py
import operator
from typing import Annotated, Any, TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.errors import InvalidUpdateError
from langgraph.graph import END, START, StateGraph


class NoReducer(TypedDict):
    notes: list[str]


class WithReducer(TypedDict):
    notes: Annotated[list[str], operator.add]


def check_invoice(state: Any) -> dict:
    return {"notes": ["发票 INV-0087 金额 980"]}


def check_plan(state: Any) -> dict:
    return {"notes": ["套餐 基础版 月付"]}


def reply(state: Any) -> dict:
    return {"notes": [f"回复时看到 {len(state['notes'])} 条笔记"]}


def build(state_type: type) -> StateGraph:
    g = StateGraph(state_type)
    g.add_node("check_invoice", check_invoice)
    g.add_node("check_plan", check_plan)
    g.add_node("reply", reply)
    g.add_edge(START, "check_invoice")
    g.add_edge(START, "check_plan")
    g.add_edge("check_invoice", "reply")
    g.add_edge("check_plan", "reply")
    g.add_edge("reply", END)
    return g


try:
    build(NoReducer).compile().invoke({"notes": []})
except InvalidUpdateError as e:
    print("没有 reducer:", str(e).splitlines()[0])

app = build(WithReducer).compile(checkpointer=InMemorySaver())
config: RunnableConfig = {"configurable": {"thread_id": "t1"}}
print("有 reducer:", app.invoke({"notes": []}, config)["notes"])

print("checkpoint 历史(新的在前):")
for snap in app.get_state_history(config):
    step = snap.metadata.get("step") if snap.metadata else None
    print(f"  step={step:>2}  next={snap.next}  notes={len(snap.values.get('notes', []))} 条")
```

<div class="line-notes">

- `class NoReducer(TypedDict):` 第一种状态:`notes` 是普通列表,没有说「多个更新怎么合并」。`TypedDict` 相当于 TS 里给对象写一个 `interface`,运行时它就是普通字典。
- `notes: Annotated[list[str], operator.add]` 第二种状态:用 `Annotated` 给字段挂一个 reducer。`operator.add` 就是 `+`,两个列表相加等于拼接。意思是「新来的更新拼到旧值后面」,而不是覆盖。
- `def check_invoice(state: Any) -> dict:` 节点就是普通函数:读状态,返回「要更新哪些字段」。注意返回的是更新,不是整个新状态。参数标成 `Any` 是因为同一组节点要给两种状态用,类型检查器推不出具体是哪种。
- `return {"notes": [f"回复时看到 {len(state['notes'])} 条笔记"]}` 回复节点数一下它看到了几条笔记,用来证明两个并行节点的结果都到了。
- `g.add_edge(START, "check_invoice")` 从 START 连出两条边,`check_invoice` 和 `check_plan` 会在同一个超步里并行执行。
- `g.add_edge("check_invoice", "reply")` 两个节点都连到 `reply`,LangGraph 会等两个都完成后才执行 `reply`。
- `build(NoReducer).compile().invoke({"notes": []})` 先用没有 reducer 的状态跑。`compile()` 把你声明的图编译成可执行的对象,`invoke` 跑一遍。
- `except InvalidUpdateError as e:` 两个并行节点在同一个超步里都要写 `notes`,又没告诉它怎么合并,LangGraph 不会替你随便选一个,直接报错。
- `app = build(WithReducer).compile(checkpointer=InMemorySaver())` 第二次用有 reducer 的状态,并且挂一个内存 checkpointer,让它每个超步都存一份快照。
- `config: RunnableConfig = {"configurable": {"thread_id": "t1"}}` 快照按 `thread_id` 存,同一个 thread_id 就是同一段会话。写上 `RunnableConfig` 类型是为了让类型检查器不报红线。
- `for snap in app.get_state_history(config):` 按时间倒序列出这个 thread 的所有快照,[Day 317](/blog/agent-zero/day-317-lg-state-history/) 用过。
- `step = snap.metadata.get("step") if snap.metadata else None` 每个快照的元数据里有 `step`,就是第几个超步。
- `print(f"  step={step:>2}  next={snap.next}  notes={len(snap.values.get('notes', []))} 条")` `snap.next` 是「这个快照之后要执行哪些节点」,`snap.values` 是这一刻的状态。

</div>

```bash
uv run python -m part09.interview.evidence_reducer
```

```text
没有 reducer: At key 'notes': Can receive only one value per step. Use an Annotated key to handle multiple values.
有 reducer: ['发票 INV-0087 金额 980', '套餐 基础版 月付', '回复时看到 2 条笔记']
checkpoint 历史(新的在前):
  step= 2  next=()  notes=3 条
  step= 1  next=('reply',)  notes=2 条
  step= 0  next=('check_invoice', 'check_plan')  notes=0 条
  step=-1  next=('__start__',)  notes=0 条
```

四个词都在这几行输出里了,从下往上读:

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="实验二的四个超步:step -1 输入,step 0 两个节点并行,reducer 合并两条笔记,step 1 回复节点,step 2 结束;每个超步结束都存一个 checkpoint">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">时间 →(每一列是一个超步,列尾的方块是这一步存下的 checkpoint)</text>
  <rect x="20" y="50" width="120" height="44" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="32" y="70" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">step -1</text>
  <text x="32" y="86" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">写入输入</text>
  <rect x="170" y="40" width="140" height="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="180" y="60" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">check_invoice</text>
  <rect x="170" y="78" width="140" height="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="180" y="98" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">check_plan</text>
  <text x="170" y="128" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">step 0:并行</text>
  <rect x="340" y="50" width="120" height="44" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="352" y="70" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">reducer</text>
  <text x="352" y="86" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">[] + [a] + [b]</text>
  <rect x="490" y="50" width="130" height="44" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="502" y="70" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">reply</text>
  <text x="502" y="86" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">step 1,看到 2 条</text>
  <line x1="140" y1="72" x2="170" y2="55" stroke="var(--ink-faint)"/>
  <line x1="140" y1="72" x2="170" y2="93" stroke="var(--ink-faint)"/>
  <line x1="310" y1="55" x2="340" y2="72" stroke="var(--ink-faint)"/>
  <line x1="310" y1="93" x2="340" y2="72" stroke="var(--ink-faint)"/>
  <line x1="460" y1="72" x2="490" y2="72" stroke="var(--ink-faint)"/>
  <rect x="50" y="160" width="60" height="28" fill="var(--paper-raised)" stroke="var(--ink-faint)"/>
  <text x="58" y="179" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">ckpt-1</text>
  <rect x="210" y="160" width="60" height="28" fill="var(--paper-raised)" stroke="var(--ink-faint)"/>
  <text x="218" y="179" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">ckpt 0</text>
  <rect x="370" y="160" width="60" height="28" fill="var(--paper-raised)" stroke="var(--ink-faint)"/>
  <text x="378" y="179" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">ckpt 1</text>
  <rect x="525" y="160" width="60" height="28" fill="var(--paper-raised)" stroke="var(--ink-faint)"/>
  <text x="533" y="179" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">ckpt 2</text>
  <text x="20" y="226" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">没有 reducer 时,step 0 两个更新撞在同一个键上,直接 InvalidUpdateError</text>
</svg>
<figcaption>实验二的运行过程。超步就是「一批可以同时跑的节点」;一批跑完,所有更新经过 reducer 合并,再存一个 checkpoint,然后才进下一批。interrupt、断点续跑、时间旅行,都是在这些 checkpoint 上做文章。</figcaption>
</figure>

**状态和 reducer。** 没有 reducer 时报错原文是「At key 'notes': Can receive only one value per step」:一个超步里同一个键只能收一个值。加了 `operator.add` 后,两条笔记拼在一起,回复节点看到了 2 条。这说明节点返回的不是新状态,而是「更新」,合并规则由 reducer 决定。面试时可以接一句:消息列表用的 `add_messages` 也是一个 reducer,它按消息 id 追加或替换,所以多轮对话的消息不会互相覆盖。

**超步。** `step=0` 那一行的 `next=('check_invoice', 'check_plan')`,说明这两个节点在同一个超步里执行;`step=1` 的 `next=('reply',)` 说明回复节点要等下一个超步。LangGraph 的运行时受 Google 的 Pregel 图计算模型启发:按超步推进,一个超步内的节点读的是同一份旧状态,写的更新在超步结束时统一合并。这就是为什么两个并行节点写同一个键会冲突,也是为什么 reducer 必须存在。

**checkpoint。** 一共 4 个快照,对应 step -1 到 2,每个超步结束存一个。`step=1` 那个快照里 `notes` 已经有 2 条、下一步是 `reply`:如果程序在这一刻崩了,用同一个 thread_id 重新 invoke,就会从 `reply` 接着跑,前两个节点不会重跑。`interrupt` 本质上也是这样:在节点里暂停,状态已经存在 checkpoint 里,人审批完带着输入 resume,从那一点继续。

所以第 32 题的答案骨架是:「你声明状态、节点和边,编译后交给一个受 Pregel 启发的运行时;它按超步推进,每个超步里被激活的节点读当前状态、返回更新,更新经过每个字段的 reducer 合并;配了 checkpointer 时每个超步结束都按 thread_id 存快照,断点续跑、interrupt、时间旅行都建立在这上面。」再把今天的报错原文和 4 个快照说出来,面试官就知道你不是背的。

### 实验三:Agent 卡在一个工具上会怎样(第 35 题)

第 35 题的第一条失败模式是死循环:模型反复用同样的参数调同一个工具。真模型很难稳定复现这个现象,所以用一个假模型,它永远返回同一个动作。这和 [Day 193](/blog/agent-zero/day-193-failures-5/) 用假模型离线测试失败模式是一个思路:不花钱,结果每次都一样。

```python
# agent-zero-lab/part09/interview/evidence_loop.py
import json
from collections import Counter


class StuckModel:
    """假模型:永远要求用同样的参数查同一个客户,模拟 Agent 卡死。"""

    def __init__(self) -> None:
        self.calls = 0

    def next_action(self, history: list[dict]) -> dict:
        self.calls += 1
        return {"tool": "find_customer", "args": {"query": "星河"}}


def run(model: StuckModel, max_steps: int = 20, max_repeat: int | None = None) -> str:
    history: list[dict] = []
    seen: Counter[str] = Counter()
    for step in range(1, max_steps + 1):
        action = model.next_action(history)
        key = action["tool"] + json.dumps(action["args"], sort_keys=True, ensure_ascii=False)
        seen[key] += 1
        if max_repeat and seen[key] > max_repeat:
            return f"第 {step} 步:同一个调用已重复 {max_repeat} 次,停下转人工"
        history.append({"tool": action["tool"], "result": "[]"})
    return f"跑满 {max_steps} 步才停"


for label, kw in [("只有步数上限", {}), ("加重复检测", {"max_repeat": 2})]:
    m = StuckModel()
    print(f"{label}: {run(m, **kw)},调了模型 {m.calls} 次")
```

<div class="line-notes">

- `class StuckModel:` 假模型,只有一个方法 `next_action`,接口和真模型「给历史,返回下一步动作」一样。真实代码里这里是 `llm.chat(...)` 加解析 tool_calls。
- `self.calls += 1` 数一下被调了几次。真模型每次调用都要花钱,这个数就是花费的代理指标。
- `return {"tool": "find_customer", "args": {"query": "星河"}}` 永远返回同一个调用。真实场景里这常常发生在工具返回空结果时:模型查「星河」没查到,又用同样的参数查一遍,觉得这次也许能查到。
- `seen: Counter[str] = Counter()` 记每种「工具名 + 参数」出现过几次。`Counter` 是带默认值 0 的计数字典,Day 502 用过。
- `key = action["tool"] + json.dumps(action["args"], sort_keys=True, ensure_ascii=False)` 把工具名和参数拼成一个字符串当键。`sort_keys=True` 很关键:`{"a":1,"b":2}` 和 `{"b":2,"a":1}` 是同一个调用,不排序的话会被当成两个不同的键。
- `if max_repeat and seen[key] > max_repeat:` 同一个调用超过 `max_repeat` 次就停。`max_repeat` 是 `None` 时不检测,`None and ...` 直接得到假值,和 JS 的短路求值一样。
- `for label, kw in [("只有步数上限", {}), ("加重复检测", {"max_repeat": 2})]:` 两种配置各跑一次。`**kw` 把字典展开成关键字参数,空字典就等于什么都不传。

</div>

```bash
uv run python -m part09.interview.evidence_loop
```

```text
只有步数上限: 跑满 20 步才停,调了模型 20 次
加重复检测: 第 3 步:同一个调用已重复 2 次,停下转人工,调了模型 3 次
```

只靠步数上限,卡死的 Agent 会把 20 步全跑完才停,模型被调了 20 次。每一步都要带上越来越长的历史:按实验一里 agent 平均每次调用约 600 个输入 token(1874 ÷ 3)估,20 步至少 20 × 600 = 12000 个 token,按 2 元每百万算至少 ¥0.024,而且这是下限,因为历史在一直变长。一张工单两分多钱看着不多,一天一万张工单里有 5% 卡住,就是每天 500 张白跑。加了重复检测,第 3 步就停下转人工,只调了 3 次。

两道保护缺一不可:步数上限防所有情况的兜底,重复检测让明显卡住的情况早停。重复检测的阈值不能设成 1,因为有时候第一次真的是网络抖了,重试一次是合理的。

第 35 题答到这里,再补上 Day 504 的「参数错了校验回传」和「工具超时重试加退避」,失败模式就覆盖了三类:循环、参数、外部故障。最后一条兜底永远是转人工。

### 实验四:长对话怎么压缩,直接截断丢什么(第 38、39 题)

第 39 题最常见的错误答法是「超过长度就把前面的删掉」。这个实验造一段 15 轮的客服对话:前 3 轮里客户说了身份、一张有争议的发票、一个升级需求;后面 12 轮是在问怎么给门店开账号。最后客户问「回到最开始那个问题,有争议的发票号和金额是多少」。三种做法各问一次:全量历史、只留最近 4 轮、把前面 11 轮摘要后加最近 4 轮。

```python
# agent-zero-lab/part09/interview/evidence_compact.py
from common.llm import LLMClient

SYSTEM = {"role": "system", "content": "你是云簿客服助手,回答简短。"}
TURNS = [
    ("我是星河餐饮的刘伟,客户编号 C001。", "好的刘先生,已记下 C001。"),
    ("我们 9 月那张发票 INV-2026-0087 是 980 元,但我们只有 2 个席位,应该是 196 元。", "明白,INV-2026-0087 金额 980 元,您认为应为 196 元,我记下了。"),
    ("另外我们想下个月从基础版升级到专业版。", "好的,升级需求已记录。"),
] + [
    (f"再问一下,第 {i} 个门店的员工账号怎么开通?", f"第 {i} 个门店:进入「设置-成员」点「邀请」,输入手机号即可,每个席位一个账号。")
    for i in range(1, 13)
]
QUESTION = {"role": "user", "content": "回到最开始那个问题:有争议的那张发票号和金额是多少?我认为应该是多少?"}


def history(turns: list[tuple[str, str]]) -> list[dict]:
    return [m for u, a in turns for m in ({"role": "user", "content": u}, {"role": "assistant", "content": a})]


if __name__ == "__main__":
    llm = LLMClient()
    full = [SYSTEM] + history(TURNS) + [QUESTION]
    window = [SYSTEM] + history(TURNS[-4:]) + [QUESTION]
    summary = llm.chat([
        {"role": "system", "content": "把下面的客服对话压缩成要点:保留客户身份、所有编号和金额、未解决的问题;已经答完的操作问题一句话带过。"},
        {"role": "user", "content": "\n".join(f"{m['role']}: {m['content']}" for m in history(TURNS[:-4]))},
    ], temperature=0).content
    compact = [SYSTEM, {"role": "user", "content": f"(之前对话的摘要)\n{summary}"}, {"role": "assistant", "content": "好的。"}] + history(TURNS[-4:]) + [QUESTION]
    print("摘要:", summary.replace("\n", " ")[:160])

    for name, msgs in [("全量历史", full), ("只留最近 4 轮", window), ("摘要 + 最近 4 轮", compact)]:
        r = llm.chat(msgs, temperature=0)
        print(f"{name}: {len(msgs)} 条消息,prompt_tokens {r.prompt_tokens} → {r.content.strip()[:70]}")
    print(llm.ledger)
```

<div class="line-notes">

- `TURNS = [` 每一轮是一个 (用户说的, 助手答的) 元组。前 3 轮是关键信息。
- `] + [` 后面 12 轮用列表推导式生成,内容几乎一样,模拟「聊了很久的琐事」。
- `def history(turns: list[tuple[str, str]]) -> list[dict]:` 把元组列表展开成 messages 格式。
- `return [m for u, a in turns for m in ({"role": "user", "content": u}, {"role": "assistant", "content": a})]` 两层 for 的推导式:外层取每一轮的 u 和 a,内层把这一轮拆成两条消息。相当于 JS 的 `turns.flatMap(([u, a]) => [{role:"user",...}, {role:"assistant",...}])`。
- `if __name__ == "__main__":` 下面的请求只在直接运行时发。练习 3 要 import 这里的 `TURNS` 和 `history`,有这一行 import 时就不会白发 4 次请求。我第一版没加,做练习时屏幕上先把这个实验又跑了一遍,多花了 ¥0.0035。
- `window = [SYSTEM] + history(TURNS[-4:]) + [QUESTION]` 「滑动窗口」:只留最后 4 轮。[Day 135](/blog/agent-zero/day-135-llm-client-1/) 的 `Conversation(max_turns=...)` 就是这么做的。`[-4:]` 是最后 4 个元素,相当于 JS 的 `slice(-4)`。
- `{"role": "system", "content": "把下面的客服对话压缩成要点:保留客户身份、所有编号和金额、未解决的问题;已经答完的操作问题一句话带过。"},` 摘要的指令写清「保留什么、丢什么」。不写的话模型会平均用力,12 轮门店开通也会写进去。
- `"\n".join(f"{m['role']}: {m['content']}" for m in history(TURNS[:-4]))` 被摘要的是前 11 轮(`[:-4]` 是除了最后 4 个之外的全部),拼成一段纯文本发过去。
- `compact = [SYSTEM, {"role": "user", "content": f"(之前对话的摘要)\n{summary}"}, {"role": "assistant", "content": "好的。"}]` 摘要作为一条 user 消息放进去,后面跟一条 assistant 的「好的」,让消息继续保持 user、assistant 交替。

</div>

```bash
uv run python -m part09.interview.evidence_compact
```

```text
摘要: - 客户：星河餐饮 刘伟，客户编号 C001   - 发票问题未解决：INV-2026-0087 金额 980 元，客户认为仅 2 个席位应为 196 元   - 升级需求：下个月从基础版升级到专业版   - 操作问题已答复：第 1 至第 8 个门店员工账号开通方式均为「设置-成员」点「邀请」，输入手机号，每个席位一个
全量历史: 32 条消息,prompt_tokens 714 → 发票号 INV-2026-0087,开票金额 980 元,您认为应为 196 元。
只留最近 4 轮: 10 条消息,prompt_tokens 220 → 抱歉,我这边没有你之前提到的争议发票记录,也没有你给出的应得金额信息。请提供发票号或相关截图,我再帮你核对。
摘要 + 最近 4 轮: 12 条消息,prompt_tokens 338 → 发票号 INV-2026-0087,金额 980 元;您认为仅 2 个席位,应为 196 元。
4 次调用 | 输入 1833 / 输出 195 tokens | 约 ¥0.0052
```

**只留最近 4 轮,答不出来。** 模型很诚实地说「我这边没有你之前提到的争议发票记录」,还让客户再提供一遍发票号。对客户来说这是最糟的体验:聊了半小时,客服把最重要的事忘了。

**摘要加最近 4 轮,答对了,输入只有全量的一半不到。** 338 对 714 个 token。摘要按指令保留了身份、发票号、两个金额和升级需求,门店开通的 8 轮被压成一句。注意摘要那一次调用本身也要花钱,一共 4 次调用 1833 个输入 token,其中约 560 个是摘要那一次的。所以压缩不是每轮都做,而是在历史接近预算上限时做一次,之后很多轮都受益。

**全量历史当然对,但它不可持续。** 15 轮 714 个 token 还好,真实的 Agent 一次工具结果就可能几千 token,几十轮之后就会撞上窗口上限,而且像第 38 题说的,越长越容易被无关内容干扰。

摘要也有风险。看摘要最后一句「第 1 至第 8 个门店」:这次它是对的,因为第 9 到 12 个门店在最近 4 轮的原文里,没交给它摘要。可如果客户接着问「我们一共问了几个门店」,模型得把摘要里的 8 和原文里的 4 个自己加起来,这就容易出错;要是摘要把「第 1 至第 8」写成了「若干门店」,就彻底答不了。摘要会丢细节,丢哪些你控制不了,所以要用评测检查压缩后任务成功率有没有下降,不能想当然。练习 3 还会看到压缩对前缀缓存的影响。

四个实验的花费:实验一 ¥0.0010 + ¥0.0032,实验二、三 ¥0,实验四 ¥0.0052,合计约 ¥0.0094,按 Day 504 同样的 DeepSeek 价格记账。

## 题库(三):Agent 架构、框架原理与上下文工程

下面 14 道题,每道先计时出声答,再展开看要点。答不上来就回题目后面标的那一天重看。

### 架构与框架原理

**29. Workflow 和 Agent 有什么区别?怎么选?([Day 196](/blog/agent-zero/day-196-workflow-vs-agent/)、[Day 204](/blog/agent-zero/day-204-when-agent/))**

<details><summary>答案</summary>

按 Anthropic《Building effective agents》的定义,workflow 是由代码预先定义执行路径、在其中调用模型;agent 是由模型动态决定流程和用哪些工具。能用 workflow 解决就用 workflow,它更可预测、更便宜、更好评测;只有步骤没法预先确定、需要根据中间结果决定下一步时才用 agent。实际系统常常是 workflow 里嵌一个 agent 节点。第 4 步用实验一:同一张工单,workflow 2 次调用 ¥0.0010,agent 3 次调用 ¥0.0032、输入 token 多 9 倍;但 agent 多查了订阅,发现客户在试用期却被收了费,这是写死的路由看不到的。

</details>

**30. 常见的 workflow 模式有哪几种?([Day 197](/blog/agent-zero/day-197-chaining/) 到 [Day 201](/blog/agent-zero/day-201-evaluator/))**

<details><summary>答案</summary>

五种:提示链(prompt chaining,串行多步,每步处理上一步的输出,中间可以加代码检查);路由(routing,先分类再分发到不同的处理路径或不同大小的模型);并行(parallelization,把任务切成独立的几段同时做,或者同一个任务做几次投票);编排者-工作者(orchestrator-workers,中心模型动态拆分子任务派给 worker,和并行的区别是子任务不是预先定好的);评估者-优化者(evaluator-optimizer,一个生成、一个评估,不通过就带着意见重写)。SupportPilot 用到了路由(按类别和难度选路径和模型)和评估者-优化者(回复自检不通过就重写)。

</details>

**31. ReAct 是什么?在原生 function calling 普及后它还重要吗?([Day 172](/blog/agent-zero/day-172-react-1/)、[Day 175](/blog/agent-zero/day-175-react-3/))**

<details><summary>答案</summary>

ReAct(2022 年的论文)让模型交替输出思考(Thought)、行动(Action)、观察(Observation),把推理和工具使用结合起来。当时模型没有原生工具调用,Action 要写成固定格式的文本,再由程序用正则解析。原生 function calling 普及后,不再需要文本解析,模型直接返回结构化的 tool_calls;推理模型又把 Thought 部分内化到了推理过程里。但「想一下、调工具、看结果、再决定」这个循环就是今天 Agent 循环的基本形态,实验一的 agent 函数就是它。答 ReAct 时说清这层演变会加分。

</details>

**32. LangGraph 底层是怎么实现的?([Day 304](/blog/agent-zero/day-304-lg-reducer/)、[Day 313](/blog/agent-zero/day-313-lg-compiled/)、[Day 316](/blog/agent-zero/day-316-lg-checkpointer/))**

<details><summary>答案</summary>

你定义一个状态结构、若干节点函数和边(含条件边),编译后由一个受 Pregel 启发的运行时执行:按超步推进,每个超步里被激活的节点读取当前状态、返回状态更新,更新通过每个字段的 reducer 合并(比如消息列表是追加而不是覆盖);边决定下一个超步激活哪些节点。配了 checkpointer 时,每个超步结束都按 thread_id 存一份快照,所以能断点续跑、回放历史;interrupt 是在节点里暂停并把状态存下,恢复时带着人的输入从那一点继续。第 4 步用实验二:两个并行节点写同一个键,没有 reducer 时报「Can receive only one value per step」;加上 `operator.add` 后合并成功,一共存了 4 个 checkpoint,对应 step -1 到 2。

</details>

**33. 什么时候不应该用 Agent 框架?([Day 204](/blog/agent-zero/day-204-when-agent/)、[Day 313](/blog/agent-zero/day-313-lg-compiled/)、[Day 334](/blog/agent-zero/day-334-frameworks-2/))**

<details><summary>答案</summary>

逻辑简单、一个循环就能搞定时(实验一的 agent 函数二十行);需要对每一步完全控制、框架的抽象反而碍事时;框架版本变动快、团队没精力跟进时;调试时要穿透好几层抽象才能看到真实发给模型的 prompt 时。Anthropic 的建议是先直接用模型 API,很多模式几十行代码就能实现。需要持久化、人工审批、流式、断点续跑这些能力时,框架的价值才明显,因为这些自己写很容易出错。面试官问这道题,是在看你懂不懂框架替你做了什么,答案的核心是实验二那几样:状态合并、checkpoint、interrupt。

</details>

**34. 长任务里,怎么让 Agent 不跑偏?([Day 176](/blog/agent-zero/day-176-plan-execute/)、[Day 177](/blog/agent-zero/day-177-todo-reflection/))**

<details><summary>答案</summary>

先规划再执行,把计划写成 todo 列表,每完成一项更新状态,并把这份列表定期放回上下文,让模型一直看得见目标和进度;每个子任务设验收条件,做完先检查再往下走;关键节点设检查点,必要时让人确认;步数和预算上限;读大量材料的子任务交给独立上下文的子 Agent,只回传结论。上线后用轨迹评测找跑偏的模式,比如「在第 N 步之后开始重复调同一个工具」。Claude Code 这类 coding agent 的 todo 列表就是这个思路。

</details>

**35. Agent 常见的失败模式有哪些?分别怎么处理?([Day 189](/blog/agent-zero/day-189-failures-1/)、[Day 192](/blog/agent-zero/day-192-failures-4/))**

<details><summary>答案</summary>

死循环(反复调同一个工具):步数上限加重复检测;调不存在的工具或参数错:schema 校验,错误作为 tool 结果回传让它自己改;工具超时或报错:重试加退避,超过次数降级;上下文过长导致遗忘:压缩和摘要;提前宣布完成:用验收条件或自检节点检查;最终兜底是转人工。第 4 步用实验三:同一个卡死的假模型,只有步数上限时跑满 20 步、调了 20 次模型;加上「同一调用重复超过 2 次就停」后第 3 步就停下转人工。

</details>

**36. 多 Agent 什么时候值得用,什么时候不该用?([Day 329](/blog/agent-zero/day-329-multi-agent-1/)、[Day 332](/blog/agent-zero/day-332-multi-agent-4/))**

<details><summary>答案</summary>

值得用:任务能拆成可并行的独立子任务,或者子任务需要大量独立上下文(比如广泛搜索资料),用子 Agent 隔离上下文能提升效果。Anthropic 介绍他们的多 Agent 研究系统时说,内部评测上比单 Agent 高 90.2%,但 token 消耗约是普通聊天的 15 倍。不该用:子任务之间强依赖、需要频繁共享上下文(比如大多数写代码的任务,Cognition 那篇《Don't Build Multi-Agents》讲的就是这个),或者预算敏感的场景。多 Agent 还会引入协调失败,调试更难。两篇文章观点相反,能把两边都讲清,再说你的项目为什么选了哪一边,是这道题最好的答法。

</details>

### 上下文工程与记忆

**37. 什么是上下文工程?和提示词工程有什么区别?([Day 262](/blog/agent-zero/day-262-context-budget/))**

<details><summary>答案</summary>

提示词工程关注怎么写指令;上下文工程关注每一次调用模型时,窗口里到底放什么:系统提示、工具定义、检索结果、工具返回、对话历史、记忆,各占多少、按什么顺序、什么时候压缩或清理。Agent 多轮运行时上下文会不断膨胀,上下文工程决定了它能不能长时间保持效果。站长 10 月整理的 JD 里,国内有正文的 334 条中 52% 提到这一项,海外 185 条中只有 25%,是国内比海外明显更看重的方向。

</details>

**38. 为什么上下文越长效果可能越差?([Day 262](/blog/agent-zero/day-262-context-budget/)、[Day 109](/blog/agent-zero/day-109-context-window/))**

<details><summary>答案</summary>

模型的注意力是有限资源,无关内容越多,关键信息越容易被忽略;放在中间位置的信息利用率更低(lost in the middle);过时的工具结果、错误的中间尝试留在上下文里会误导后续决策。所以要主动管理,只保留有用的内容,而不是能塞多少塞多少。Day 504 实验三是一个直接的例子:500 张发票原样塞进去,模型数 open 发票两次都数错。

</details>

**39. 长对话或长任务的上下文怎么压缩?([Day 263](/blog/agent-zero/day-263-compaction/)、[Day 465](/blog/agent-zero/day-465-memory-compact/))**

<details><summary>答案</summary>

保留系统提示和最近几轮原文,较早的对话做摘要,摘要指令要写清保留什么(身份、编号、金额、未解决的问题);清理已经用过的工具结果,只留结论;接近窗口上限时做一次整体压缩;需要长期保留的信息写到外部(笔记文件、数据库),需要时再读回。注意两点:压缩会让历史部分的前缀缓存失效,所以不要每轮都压;要用评测检查压缩后任务成功率有没有下降。第 4 步用实验四:只留最近 4 轮,模型说「没有你之前提到的争议发票记录」;摘要加最近 4 轮答对了,输入 338 个 token,全量是 714。

</details>

**40. 短期记忆和长期记忆怎么设计?([Day 264](/blog/agent-zero/day-264-memory-short-long/)、[Day 466](/blog/agent-zero/day-466-memory-profile/))**

<details><summary>答案</summary>

短期记忆是当前会话的状态,用 checkpoint 按会话 ID 持久化,实验二里那 4 个快照就是。长期记忆是跨会话的事实和偏好,比如客户的历史工单摘要、套餐信息、沟通偏好。要设计四件事:写入时机(会话结束时抽取,而不是每句话都存)、检索方式(按客户 ID 精确取,或按语义检索)、冲突和过期处理(客户换了套餐,旧记忆要更新)、隐私(哪些能存、存多久、客户要求删除时怎么删)。别把所有历史都塞进去,SupportPilot 的客户画像只放几行。

</details>

**41. 在 SupportPilot 这样的系统里,上下文预算怎么分配?([Day 262](/blog/agent-zero/day-262-context-budget/)、[Day 465](/blog/agent-zero/day-465-memory-compact/))**

<details><summary>答案</summary>

按「固定前缀 + 动态内容」分。系统提示、政策、工具定义、示例作为稳定前缀放最前面,保持不变以命中缓存;动态部分里给检索结果一个上限(比如 5 段、约 2,000 token),工具结果只保留需要的字段,对话历史保留最近几轮加摘要,客户画像精简成几行。每部分的上限用评测调出来,不是拍脑袋。下面这张图就是一次调用的样子。练习 3 实测:压缩后第一次调用,固定前缀那 1408 个 token 照样命中缓存,只有历史部分重新计费。

</details>

<figure>
<svg viewBox="0 0 640 170" role="img" aria-label="一次调用的上下文预算:左边是固定前缀,系统提示、政策、工具定义,命中缓存;右边是动态内容,摘要、最近几轮、检索结果、工具结果,各有上限">
  <rect x="0" y="0" width="640" height="170" fill="var(--paper-raised)"/>
  <rect x="20" y="40" width="250" height="60" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="32" y="62" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">固定前缀(吃缓存)</text>
  <text x="32" y="84" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">系统提示 · 政策 · 工具定义</text>
  <rect x="270" y="40" width="90" height="60" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="280" y="62" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">摘要</text>
  <text x="280" y="84" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">几百</text>
  <rect x="360" y="40" width="90" height="60" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="370" y="62" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">最近 N 轮</text>
  <text x="370" y="84" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">原文</text>
  <rect x="450" y="40" width="90" height="60" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="460" y="62" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">检索</text>
  <text x="460" y="84" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">≤5 段</text>
  <rect x="540" y="40" width="80" height="60" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="550" y="62" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">工具结果</text>
  <text x="550" y="84" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">裁字段</text>
  <text x="20" y="130" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">左边不变,右边每轮变。压缩只动右边,所以压缩后左边照样命中缓存</text>
  <text x="20" y="152" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">右边每一块的上限,用评测调出来</text>
</svg>
<figcaption>第 41 题的答题骨架。顺序本身就是设计:不变的放前面吃缓存,变化的放后面,每块有上限。</figcaption>
</figure>

**42. 子 Agent 怎么帮助上下文管理?([Day 267](/blog/agent-zero/day-267-subagent-isolation/)、[Day 332](/blog/agent-zero/day-332-multi-agent-4/))**

<details><summary>答案</summary>

把需要读大量材料的子任务(比如翻 20 份历史工单找规律)交给子 Agent,它在自己独立的上下文里完成,只把精简结论返回给主 Agent,主 Agent 的上下文不会被中间过程淹没。这和实验四的摘要是同一个思路,只是摘要发生在「事后」,子 Agent 发生在「事前」:脏活从一开始就不进主上下文。代价是额外的 token 和协调成本,子 Agent 还可能缺少主任务的背景,所以派活时要写清目标、边界和返回格式。

</details>

## 动手练习

**练习 1:自定义一个 reducer。** 实验二用 `operator.add` 拼列表。现在状态里有一个字典 `facts`,两个并行节点各往里面写几个不同的键,第三个节点根据席位数把金额改对。写一个 reducer 让字典按键合并、后来的值覆盖先前的值,跑出最终的 `facts`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex505_merge.py
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph


def merge(old: dict, new: dict) -> dict:
    return {**old, **new}


class State(TypedDict):
    facts: Annotated[dict, merge]


def check_invoice(state: State) -> dict:
    return {"facts": {"invoice": "INV-2026-0087", "amount": 980}}


def check_plan(state: State) -> dict:
    return {"facts": {"plan": "基础版", "seats": 2}}


def fix_amount(state: State) -> dict:
    return {"facts": {"amount": state["facts"]["seats"] * 98}}


g = StateGraph(State)
g.add_node("check_invoice", check_invoice)
g.add_node("check_plan", check_plan)
g.add_node("fix_amount", fix_amount)
g.add_edge(START, "check_invoice")
g.add_edge(START, "check_plan")
g.add_edge(["check_invoice", "check_plan"], "fix_amount")
g.add_edge("fix_amount", END)
print(g.compile().invoke({"facts": {"customer": "C001"}})["facts"])
```

<div class="line-notes">

- `def merge(old: dict, new: dict) -> dict:` reducer 就是一个普通函数:收旧值和新来的更新,返回合并后的值。
- `return {**old, **new}` 字典展开合并,相当于 JS 的 `{...old, ...new}`,同名键后面的覆盖前面的。
- `facts: Annotated[dict, merge]` 把自己写的函数挂成 reducer,和挂 `operator.add` 的写法一样。
- `return {"facts": {"amount": state["facts"]["seats"] * 98}}` 只返回要改的那个键 `amount`。因为有 reducer,其他键不会丢。没有 reducer 的话,这一行会把整个 `facts` 覆盖成只有 `amount` 一个键。
- `g.add_edge(["check_invoice", "check_plan"], "fix_amount")` 起点写成列表,意思是「两个都完成后再执行」,比写两条边更明确。

</div>

```bash
uv run python -m part09.ex.ex505_merge
```

```text
{'customer': 'C001', 'invoice': 'INV-2026-0087', 'amount': 196, 'plan': '基础版', 'seats': 2}
```

初始的 `customer`、两个并行节点写的四个键都在,`amount` 被第三个节点从 980 改成了 2 × 98 = 196。并行的两个节点写的键不重叠,所以同一个超步里两次合并互不影响;如果它们写了同一个键,结果取决于合并顺序,这种情况要么改成不同的键,要么在 reducer 里写清冲突怎么处理。

</details>

**练习 2:观察题。一个永远回到自己的图,会跑多久?** 写一个只有一个节点的图,条件边永远指回它自己,分别用 `recursion_limit=5` 和默认设置跑,看报什么错、默认值是多少。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex505_recursion.py
from typing import TypedDict

from langgraph.errors import GraphRecursionError
from langgraph.graph import START, StateGraph


class State(TypedDict):
    tries: int


def call_tool(state: State) -> dict:
    return {"tries": state["tries"] + 1}


def always_again(state: State) -> str:
    return "call_tool"


g = StateGraph(State)
g.add_node("call_tool", call_tool)
g.add_edge(START, "call_tool")
g.add_conditional_edges("call_tool", always_again)
app = g.compile()
try:
    app.invoke({"tries": 0}, {"recursion_limit": 5})
except GraphRecursionError as e:
    print("limit=5:", str(e).splitlines()[0])
try:
    app.invoke({"tries": 0})
except GraphRecursionError as e:
    print("默认:", str(e).splitlines()[0])
```

<div class="line-notes">

- `def always_again(state: State) -> str:` 条件边的路由函数,返回下一个节点的名字。永远返回自己,就是一个没有出口的循环,模拟「模型永远觉得还要再调一次工具」。
- `g.add_conditional_edges("call_tool", always_again)` [Day 306](/blog/agent-zero/day-306-lg-conditional/) 学过的条件边。这里没有任何一条路通向 END。
- `app.invoke({"tries": 0}, {"recursion_limit": 5})` 第二个参数是运行配置,`recursion_limit` 是最多跑几个超步。
- `except GraphRecursionError as e:` 超过上限时抛的异常,只打印第一行,后面是一个文档链接。

</div>

```bash
time uv run python -m part09.ex.ex505_recursion
```

```text
limit=5: Recursion limit of 5 reached without hitting a stop condition. You can increase the limit by setting the `recursion_limit` config key.
默认: Recursion limit of 10007 reached without hitting a stop condition. You can increase the limit by setting the `recursion_limit` config key.
uv run python -m part09.ex.ex505_recursion  7.31s user 0.27s system 95% cpu 7.964 total
```

两点值得记住。

第一,**默认上限是 10007**,不是很多老教程里写的 25。我在装好的 1.2.16 源码里查到这一行:`DEFAULT_RECURSION_LIMIT = int(getenv("LANGGRAPH_DEFAULT_RECURSION_LIMIT", "10007"))`,也就是默认 10007,可以用环境变量改。这个节点什么都不做,跑一万步也花了将近 8 秒;如果每一步都调一次模型,在撞到上限之前钱早就烧光了。

第二,所以 **框架的递归上限不能当成你的步数保护**。真实的 Agent 图里要自己在状态里记步数和花费,在路由函数里判断「超过 N 步或超过多少钱就去 END 或转人工」,就像实验三那样。面试时说出「我查过,当前版本默认是一万多,所以我们自己在路由里加了步数和预算判断」,比只说「LangGraph 有 recursion_limit」实在得多。

</details>

**练习 3:开放题。压缩之后,前缀缓存还命中吗?** 第 39 题答案里说「压缩会让历史部分的缓存失效,所以不要每轮都压」。用数据验证:在 system 后面加一段约一千多 token 的固定政策,对全量历史和压缩后的历史,各连发两次(第二次多一句新的提问),看每次命中多少。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex505_cache.py
import time

from common.llm import LLMClient
from part09.interview.evidence_compact import SYSTEM, TURNS, history

POLICY = {"role": "system", "content": "退款与发票规则:\n" + "\n".join(
    f"{i}. 席位单价 98 元/月,发票金额 = 席位数 × 98 × 月数;第 {i} 类争议先核对席位数和账期。" for i in range(1, 41))}
NEXT = [{"role": "user", "content": "第 13 个门店也一样吗?"}]

llm = LLMClient()
full = [SYSTEM, POLICY] + history(TURNS)
compact = [SYSTEM, POLICY, {"role": "user", "content": "(之前对话的摘要)客户 C001 刘伟;INV-2026-0087 980 元有争议,客户认为应为 196 元;想升级专业版。"},
           {"role": "assistant", "content": "好的。"}] + history(TURNS[-4:])
for name, msgs in [("全量 第1次", full), ("全量 第2次", full + NEXT), ("压缩后 第1次", compact), ("压缩后 第2次", compact + NEXT)]:
    r = llm.chat(msgs, max_tokens=30)
    print(f"{name}: 输入 {r.prompt_tokens},命中缓存 {r.cache_hit_tokens},¥{r.cost:.5f}")
    time.sleep(1)
print(llm.ledger)
```

<div class="line-notes">

- `from part09.interview.evidence_compact import SYSTEM, TURNS, history` 复用实验四的对话数据。实验四的请求放在 `if __name__` 下面,import 时不会发。
- `POLICY = {"role": "system", "content": "退款与发票规则:\n" + "\n".join(` 造一段 40 条的固定政策,一千多个 token,模拟真实系统里那个很长的固定前缀。内容是凑的,我们只看缓存。
- `compact = [SYSTEM, POLICY, {"role": "user", "content": "(之前对话的摘要)` 摘要我直接写死了,不再花一次调用去生成,今天只看缓存。
- `r = llm.chat(msgs, max_tokens=30)` 只要输入侧的数字,回答限制在 30 个 token,省钱。
- `time.sleep(1)` 隔一秒再发,给缓存写入留时间,Day 502 实验三说过。

</div>

```bash
uv run python -m part09.ex.ex505_cache
```

```text
全量 第1次: 输入 2301,命中缓存 0,¥0.00483
全量 第2次: 输入 2311,命中缓存 2176,¥0.00060
压缩后 第1次: 输入 1854,命中缓存 1408,¥0.00116
压缩后 第2次: 输入 1864,命中缓存 1664,¥0.00071
4 次调用 | 输入 8330 / 输出 115 tokens | 约 ¥0.0073
```

(这是第一次运行的结果。我马上又跑了一遍,四次全都大量命中,因为第一遍已经把这些前缀写进了缓存;要复现「第 1 次命中 0」,得换一段政策文字。ledger 里的 8330 个输入 token 也包含了我第一版忘加 `if __name__` 时多跑的那 4 次实验四请求。)

读这四行:

- 全量第 1 次:冷启动,0 命中,¥0.00483。
- 全量第 2 次:历史只在末尾多了一句,前面 2176 个 token 都命中,¥0.00060。这就是「历史只追加不修改」的好处,每一轮都能吃到前面所有轮的缓存。
- 压缩后第 1 次:命中 1408 个。system 和 POLICY 这段固定前缀照样命中了,从摘要开始的部分是新的,重新计费,¥0.00116,大约是全量第 2 次的两倍。
- 压缩后第 2 次:又回到大量命中,1664 个,¥0.00071。

结论是开放的,我的取舍是:压缩会让「从被改的位置往后」的缓存失效一次,但固定前缀不受影响(前提是固定前缀放在最前面且不变,上面那张预算图)。所以压缩应该是「接近上限时做一次,然后继续追加很多轮」,而不是每轮都重新摘要;每轮都摘要,等于每轮都付「压缩后第 1 次」的价钱,外加一次摘要调用。面试时这段可以接在第 39 题后面说,很少有人会想到缓存这一层。

</details>

**验收标准**

- `bank3.json` 放进去后,`weak.py` 不改代码显示「题库 46 题」。
- 实验二的报错原文和 4 个 checkpoint 你都跑出来了,能对着输出讲清状态、reducer、超步、checkpoint 四个词。
- 实验一和实验四的结论你能用自己的数字讲:workflow 和 agent 的调用次数和花费比、截断和摘要各丢了什么。
- 第 29 到 42 题每道都计时出声答过,回炉清单里的题都回对应那天重看过。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| workflow | 由代码预先写死执行路径、在其中调用模型的系统,模型不决定下一步做什么 |
| agent | 由模型根据中间结果动态决定下一步做什么、调哪个工具的系统 |
| reducer | LangGraph 状态字段的合并规则,决定多个更新怎么合成一个值,比如 `operator.add` 拼接列表 |
| 超步(super-step) | LangGraph 运行的一个批次:一批可以同时执行的节点跑完、更新合并、存快照,再进下一批 |
| Pregel | Google 提出的按超步推进的图计算模型,LangGraph 的运行时受它启发 |
| `InvalidUpdateError` | LangGraph 在一个超步里同一个键收到多个更新、又没有 reducer 时抛的异常 |
| `GraphRecursionError` | 图运行的超步数超过 `recursion_limit` 时抛的异常,1.2.16 的默认上限是 10007 |
| 重复检测 | 记录每个「工具名 + 参数」出现的次数,同一个调用重复超过阈值就停下 |
| 滑动窗口 | 只保留最近 N 轮对话,更早的直接丢掉 |
| 摘要压缩 | 把较早的对话交给模型压成要点,和最近几轮原文一起放回上下文 |

## 常见误区

**背「能用 workflow 就用 workflow」,说不出代价。** 实验一里 agent 输入 token 多 9 倍、花费多 3 倍,但它发现了 workflow 看不到的线索。两边都说出来才叫取舍。

**以为 LangGraph 的节点返回的是新状态。** 返回的是更新,由 reducer 合并。忘了这一点,并行节点一写同一个键就是 `InvalidUpdateError`;用自定义字典字段时,没有 reducer 会整个覆盖掉。

**把框架的 `recursion_limit` 当步数保护。** 1.2.16 默认 10007 步,真正的保护要自己在路由函数里按步数和花费判断。

**只有步数上限,没有重复检测。** 卡死的 Agent 会把步数用完才停,实验三里 20 步对 3 步。

**长对话直接截断。** 实验四里只留最近 4 轮,模型直接说「没有你之前提到的争议发票记录」。先摘要再截断。

**每一轮都重新摘要。** 每次摘要都会让历史部分的缓存失效一次,还要多付一次摘要调用。接近上限时做一次就够了。

**相信摘要什么都不会丢。** 摘要会丢细节,丢哪些你控制不了,要用评测看压缩后的任务成功率。

**被 import 的脚本没有 `if __name__ == "__main__":`。** 今天练习 3 import 实验四的数据时我又踩了一次,白发了 4 次请求。凡是会发请求的脚本,运行部分一律放进这个判断里。

## 学习资料

### 文档与文章

- [Anthropic · Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):第 29、30、33 题的原始出处,五种 workflow 模式的定义和那句「先直接用 API」都在这里。面试前再读一遍。
- [Anthropic · Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents):第 37 到 42 题,压缩、结构化笔记、子 Agent 三种长任务策略。
- [Anthropic · How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system):第 36 题里 90.2% 和 15 倍 token 两个数的出处。
- [Cognition · Don't Build Multi-Agents](https://cognition.ai/blog/dont-build-multi-agents):第 36 题的反方观点,和上一篇对着读。
- [LangGraph · Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api) 和 [Persistence](https://docs.langchain.com/oss/python/langgraph/persistence):第 32 题,state、reducer、super-step、checkpoint 的官方说法。
- [ReAct 论文](https://arxiv.org/abs/2210.03629):第 31 题,读摘要和第一张图就够。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ED3iz5ECv&autoplay=0&high_quality=1" title="上下文工程 Context Engineering" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>小工蚁创始人 · 上下文工程 Context Engineering · 7 分半,2025 年 7 月。「上下文工程」这个词刚火起来时的中文解读,第 37 题的背景。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Txng6fEs9&autoplay=0&high_quality=1" title="面试官：大模型上下文污染如何防御？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>图灵AI大模型 · 面试官:大模型上下文污染如何防御? · 约 6 分钟,2026 年 10 月。一道真实的面试追问,对应第 38、39 题;先自己答,再听它怎么答,有营销味的部分自己判断。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/D7_ipDqhtwk" title="How We Build Effective Agents: Barry Zhang, Anthropic" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · How We Build Effective Agents: Barry Zhang, Anthropic · 15 分钟左右,《Building effective agents》作者之一的演讲。「什么时候不该做 agent」那一段就是第 29 题的标准答案。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):第 6 章后半讲 Agent 的规划、工具和失败模式,对应第 29、34、35 题。
- John Berryman、Albert Ziegler《Prompt Engineering for LLMs》(O'Reilly,2024):中间几章讲怎么组装 prompt、给每一块分配空间、哪些内容放前面,是第 37、41 题「上下文预算」的系统讲法。

### 开源项目与代码

- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):第 32 题。想看 reducer 和超步在源码里怎么实现,从 `langgraph/pregel` 目录开始读。
- [datawhalechina/hello-agents](https://github.com/datawhalechina/hello-agents):Datawhale 的中文 Agent 教程,ReAct、Plan-and-Solve、记忆和上下文几章可以当今天的中文复习材料。

## 自测

1. 实验一里 agent 的输入 token 是 workflow 的 9 倍,主要多在哪里?

<details><summary>答案</summary>

agent 每一轮调用都要重新发三个工具的定义和之前所有的消息,第三次调用时历史里已经有两轮工具调用和工具结果。workflow 的两次调用各自只带分类指令或回复所需的数据,没有工具定义,也不累积历史。

</details>

2. 实验二里没有 reducer 为什么会报错?如果把两个节点改成串行(一个接一个),还会报错吗?

<details><summary>答案</summary>

两个并行节点在同一个超步里都返回了 `notes` 的更新,没有 reducer 就不知道怎么合并,LangGraph 拒绝随便选一个。改成串行后,它们在不同的超步里各写一次,不会冲突,不会报错,但后写的会覆盖先写的,最后 `notes` 里只剩一条,这是更隐蔽的 bug([Day 303](/blog/agent-zero/day-303-lg-overwrite/) 讲过)。

</details>

3. 实验二的 4 个 checkpoint 里,如果程序在执行 `reply` 时崩了,用同一个 thread_id 重新运行会从哪里开始?

<details><summary>答案</summary>

从 `step=1` 那个快照开始:它的 `notes` 已经有两条,`next=('reply',)`,所以只重新执行 `reply`,`check_invoice` 和 `check_plan` 不会重跑。

</details>

4. 实验三里重复检测为什么要把参数 `sort_keys=True` 序列化后再当键?

<details><summary>答案</summary>

同一个调用的参数字典,键的顺序可能不同,比如 `{"a":1,"b":2}` 和 `{"b":2,"a":1}`。直接 `json.dumps` 会得到两个不同的字符串,被当成两个不同的调用,重复检测就漏了。排序后两者序列化结果相同。

</details>

5. (面试题)「你们的 Agent 为什么用 LangGraph?不用框架行不行?」

<details><summary>答案</summary>

可以先承认:核心循环不用框架二十行就能写,简单场景我更倾向不用。我们用 LangGraph 是因为需要三样自己写容易出错的东西:按超步存 checkpoint,进程崩了能从断点续跑;interrupt,退款要人审批,审批完从暂停的地方继续;并行节点的状态合并靠 reducer,不会互相覆盖。代价是多一层抽象,调试时要看清真正发给模型的 prompt,而且版本变化快,比如我查过当前版本默认递归上限是 10007,所以步数和预算保护我们自己在路由函数里做。

</details>

6. (面试题)「对话越来越长,你怎么处理?」面试官追问:「每轮都重新摘要行不行?」

<details><summary>答案</summary>

保留系统提示和最近几轮原文,更早的部分按「保留身份、编号、金额、未解决问题」的指令摘要,工具结果只留结论,长期信息写到外部存储。我测过一段 15 轮的对话,只留最近 4 轮时模型说找不到争议发票记录;摘要加最近 4 轮答对了,输入 338 个 token,全量是 714。追问的答案是不行:每次摘要都会让历史部分的前缀缓存失效,我测过压缩后第一次调用要比正常追加时贵一倍左右,还要多付一次摘要调用;所以只在接近预算上限时做一次。

</details>

## 明天预告

Day 506 · 面试(四):MCP、Skills、评测、安全与工程化题。今天这套问的是 Agent 内部怎么组织,明天是最后一套,问它怎么接外部、怎么证明自己好用、怎么不出事:MCP 和 function calling 的关系、Skills 和 MCP 工具怎么分工、pass@k 和 pass^k、LLM 评委的位置偏差、prompt injection 怎么防。一共 18 道题,题库换成 `bank4.json`,实验会用内存里的 MCP 客户端看 CloudLedger server 的工具列表怎么变成 function calling 的工具定义。
