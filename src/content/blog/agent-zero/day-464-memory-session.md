---
title: 'Day 464 · 记忆(一):工单内的对话状态'
description: '给 SupportPilot 加上第一种记忆:同一张工单里的多轮对话。状态加一个 turns 列表,每轮开头把上一轮的临时字段清干净,给模型看的文本带上对话记录;checkpoint 从内存换成 Postgres,进程重启后用工单号接着聊。用假 LLM 测多轮,用真模型聊三轮,还复现了工单号重用接上旧对话的坑。'
pubDate: 2026-10-22
regime: none
tags: ['memory', 'langgraph', 'checkpoint', 'postgres', 'supportpilot', 'agent-zero']
series: 'agent-zero'
day: 464
lang: 'zh'
draft: true
---

## 上一课回顾

昨天(Day 463)给主工作流写了 11 个不花钱的单测,又用真模型跑了 10 张演示工单,合计 0.17 元,记下了四条问题清单。到这里,SupportPilot 已经能独立处理一张工单:分诊、检索、查账、起草、质检、审批、定稿或转人工。

但它只会一问一答。客户看完回复追问一句「重新授权了还是不行」,现在的图会把这句话当成一张全新的工单,前面说过什么全忘了。Day 129 讲过,模型本身没有记忆,你传给它的 messages 列表就是它的全部记忆。今天开始三天的「记忆」专题,先做最基础的一种:同一张工单里的多轮对话。

## 今天要解决的问题

学完今天你应该能做到:

1. 说清 SupportPilot 需要的三种记忆各自存什么、存在哪、什么时候读写,今天做的是第一种。
2. 给 `SupportState` 加上 `turns` 对话记录,改四处节点代码,让第二轮的 Agent 知道第一轮说过什么;用假 LLM 写 3 个多轮测试,全部通过。
3. 讲清楚为什么每一轮开头要重置一批字段,并亲手复现一次「没重置 review,第二轮草稿莫名其妙在修正上一轮的错误」。
4. 把 checkpoint 存进 Postgres,进程退出再启动,用工单号接着聊;复现并修好「重新造数后新工单接上了旧对话」这个坑。

预计用时 2.5 小时。前置:Day 129(messages 就是记忆)、Day 264(短期记忆和长期记忆)、Day 303–304(覆盖和 reducer)、Day 316–318(checkpointer、thread_id、历史快照、SqliteSaver)、Day 228(Postgres 入门)、Day 457–463。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `load_customer` 的重置逻辑和 `make_checkpointer` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 三种记忆,三个问题

「记忆」这个词被用得太泛了。学术上有短期记忆、长期记忆,细一点还有语义记忆(事实)、情景记忆(经历)、程序记忆(怎么做事)。Day 264 讲过这些分法。做工程时我更愿意问三个具体问题:存什么、存在哪、什么时候读写。按这三个问题拆,SupportPilot 需要三样东西:

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="SupportPilot 的三种记忆:今天做第一种">
<g font-family="var(--font-mono)" font-size="11">
<rect x="10" y="20" width="200" height="220" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="110" y="44" text-anchor="middle" font-size="13" fill="var(--ink)">① 工单内:对话状态</text>
<text x="110" y="74" text-anchor="middle" fill="var(--ink-soft)">存:turns + 全部字段</text>
<text x="110" y="96" text-anchor="middle" fill="var(--ink-soft)">在:Postgres checkpoint</text>
<text x="110" y="118" text-anchor="middle" fill="var(--ink-soft)">键:thread_id = 工单号</text>
<text x="110" y="140" text-anchor="middle" fill="var(--ink-soft)">寿命:工单关闭为止</text>
<text x="110" y="180" text-anchor="middle" fill="var(--ink)">解决:追问时不忘前文</text>
<text x="110" y="214" text-anchor="middle" font-size="12" fill="var(--mem)">今天 Day 464</text>
<rect x="220" y="20" width="200" height="220" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="320" y="44" text-anchor="middle" font-size="13" fill="var(--ink)">② 工单内:对话摘要</text>
<text x="320" y="74" text-anchor="middle" fill="var(--ink-soft)">存:早期轮次的摘要</text>
<text x="320" y="96" text-anchor="middle" fill="var(--ink-soft)">在:同上,状态的一部分</text>
<text x="320" y="118" text-anchor="middle" fill="var(--ink-soft)">触发:超过 token 预算</text>
<text x="320" y="140" text-anchor="middle" fill="var(--ink-soft)">保留:最近几轮原文</text>
<text x="320" y="180" text-anchor="middle" fill="var(--ink)">解决:聊得越久越贵越乱</text>
<text x="320" y="214" text-anchor="middle" font-size="12" fill="var(--ink-faint)">Day 465</text>
<rect x="430" y="20" width="200" height="220" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="530" y="44" text-anchor="middle" font-size="13" fill="var(--ink)">③ 跨工单:客户画像</text>
<text x="530" y="74" text-anchor="middle" fill="var(--ink-soft)">存:一段 100 字的话</text>
<text x="530" y="96" text-anchor="middle" fill="var(--ink-soft)">在:业务库里单独一张表</text>
<text x="530" y="118" text-anchor="middle" fill="var(--ink-soft)">更新:历史工单变了</text>
<text x="530" y="140" text-anchor="middle" fill="var(--ink-soft)">寿命:跟着客户</text>
<text x="530" y="180" text-anchor="middle" fill="var(--ink)">解决:老客户不用从头讲</text>
<text x="530" y="214" text-anchor="middle" font-size="12" fill="var(--ink-faint)">Day 466</text>
</g>
</svg>
<figcaption>三种记忆的存储位置、键、更新时机和寿命都不同。混在一起设计,最后就是一个越来越大、谁也说不清里面有什么的「记忆库」。</figcaption>
</figure>

今天只做第一种。它要回答的问题是:客户在同一张工单里追问,Agent 怎么知道前面聊过什么。

先定一个设计问题:`thread_id` 用工单号还是客户 ID?我选工单号。一张工单是一件事,有开始有结束,状态的边界很清楚。用客户 ID 的话,同一个客户今天问银行同步、下个月问发票,两件不相干的事挤进一个对话,前一件的检索结果和调查结论会干扰后一件,对话也会无限变长。练习 4 会实测这种做法出什么事。跨工单要记住的东西(这个客户是谁、以前遇到过什么),交给 Day 466 的客户画像。

前端视角可以这么类比:thread_id 像 `sessionStorage` 的作用域,一个标签页一份;客户画像像 `localStorage`,跟着用户走,跨会话都在。

## 第一步:状态里加一个 turns

LangGraph 的 checkpointer 已经替我们做了大部分事。Day 316 你在玩具图上见过:每个节点执行完,整个状态按 `thread_id` 存一份快照;同一个 `thread_id` 再次 `invoke`,LangGraph 先读出上次的状态,再把这次的输入合并进去,然后从 START 重新跑一遍图。

所以多轮对话要做的只有两件事:状态里要有一份对话记录,每轮把新消息追加进去。

打开 Day 457 写的 `agent/state.py`,在 `SupportState` 里 `ticket` 下面加一行:

```python
# supportpilot/src/supportpilot/agent/state.py(SupportState 的开头,只多了 turns 一行)
class SupportState(TypedDict, total=False):
    ticket: Ticket
    turns: Annotated[list[dict], operator.add]      # Day 464:对话记录,每条 {"role": "customer"|"agent", "content": ...}
    customer: dict | None
    triage: dict
    hits: list[dict]
    tool_log: Annotated[list[dict], operator.add]   # 每次工具调用追加一条,不覆盖
```

<div class="line-notes">

- `class SupportState(TypedDict, total=False):` Day 457 的状态定义,`total=False` 表示每个键都可以不存在。
- `ticket: Ticket` 工单本身,第一轮传进来,之后每轮都在(checkpoint 存着)。
- `turns: Annotated[list[dict], operator.add]` 新增的对话记录。合并规则是 `operator.add`,也就是列表相加:节点返回 `{"turns": [新的一条]}`,会接到已有记录后面,不会覆盖。Day 304 讲过这个 reducer。每条是 `{"role": "customer" 或 "agent", "content": 文本}`,角色用英文存,给模型看时再换成中文。
- `customer: dict | None` 后面这些字段都没变。
- `tool_log: Annotated[list[dict], operator.add]` 和 turns 一样是累加的,所以多轮下来工具调用记录会越来越长,这是有意的,Day 484 做可观测时要用。

</div>

为什么 turns 一定要挂 `operator.add`?因为追问时外面只会传新的那一条:`graph.invoke({"turns": [{"role": "customer", "content": "重新授权了还是不行"}]}, cfg)`。没有 reducer,LangGraph 的默认规则是覆盖(Day 303),这一条会把之前的整个列表替换掉,对话记录只剩一句。练习 1 会在玩具图上实测这件事。

再新建一个小文件,专门负责把对话记录渲染成文本:

```python
# supportpilot/src/supportpilot/memory/turns.py
"""对话记录的小工具。turns 里存英文角色名,给模型看时换成中文。"""

WHO = {"customer": "客户", "agent": "客服"}


def render_turns(turns: list[dict]) -> str:
    return "\n".join(f"{WHO[t['role']]}:{t['content']}" for t in turns)
```

<div class="line-notes">

- `WHO = {"customer": "客户", "agent": "客服"}` 角色名对照表。存英文是为了代码里判断方便、不怕繁简和同义词;给模型看中文是因为整段上下文都是中文。
- `def render_turns(turns: list[dict]) -> str:` 输入一串对话,输出一段多行文本。
- `return "\n".join(f"{WHO[t['role']]}:{t['content']}" for t in turns)` 每条一行,「客户:……」「客服:……」。`"\n".join(...)` 相当于 JS 的 `arr.join("\n")`,括号里是一个生成器表达式,不用先建列表。实测两条渲染成 `客户:提示 E3001` 和 `客服:您好,您的问题已经转给人工客服同事……`。

</div>

`memory/` 目录 Day 441 建骨架时就已经有了(带一个空的 `__init__.py`)。明天(Day 465)的压缩也会用到 `render_turns`,所以它单独放一个文件,不塞进 nodes.py。

## 第二步:四处节点改动

turns 要被三类节点碰到:第一轮把工单正文放进去(load_customer);每个调模型的节点给模型看对话记录(`_ticket_text`);发回复时把回复追加进去(finalize、handoff)。打开 Day 460 的 `agent/nodes.py`,先在文件开头的导入里加一行:

```python
from ..memory.turns import render_turns
```

### 改动一:给模型看的文本带上历史

Day 460 的 `_ticket_text` 只拼了邮箱、主题、正文。分诊、调查、起草、质检四个节点都用它,改这一处,四个节点同时有了记忆:

```python
# supportpilot/src/supportpilot/agent/nodes.py(_ticket_text 整个替换)
def _ticket_text(state: SupportState) -> str:
    """把工单 + 对话记录拼成给模型看的文本。最新一条客户消息单独标出来,放在最后。"""
    t = state["ticket"]
    turns = state.get("turns") or [{"role": "customer", "content": t["body"]}]
    parts = [f"发件邮箱:{t['customer_email']}\n主题:{t['subject']}"]
    history = turns[:-1]
    if history:
        parts.append(f"对话记录:\n{render_turns(history)}")
    parts.append(f"客户最新消息:{turns[-1]['content']}")
    return "\n\n".join(parts)
```

<div class="line-notes">

- `t = state["ticket"]` 工单每轮都在,这里直接用方括号取,和 Day 460 其他节点的写法保持一致。
- `turns = state.get("turns") or [{"role": "customer", "content": t["body"]}]` 没有 turns 的老状态(比如单测里直接调节点函数、只给了 ticket)也能用:把正文当成唯一一条消息。`or` 在左边是空列表或 None 时取右边。
- `parts = [f"发件邮箱:{t['customer_email']}\n主题:{t['subject']}"]` 第一段永远是工单的基本信息。原来的「正文:」那一行去掉了,因为正文已经是 turns 的第一条。
- `history = turns[:-1]` 切片 `[:-1]` 取除最后一条以外的全部,相当于 JS 的 `turns.slice(0, -1)`。第一轮只有一条,history 是空列表。
- `if history:` 空列表为假,第一轮不加「对话记录」这一段,和改之前给模型看的内容几乎一样。
- `parts.append(f"对话记录:\n{render_turns(history)}")` 实测第二轮是「客户:提示 E3001」「客服:您好,您的问题已经转给人工客服同事……」两行。
- `parts.append(f"客户最新消息:{turns[-1]['content']}")` `turns[-1]` 取最后一条,负数下标从末尾数。最新消息单独标出来,放在最后。
- `return "\n\n".join(parts)` 段与段之间空一行。

</div>

结构是:基本信息 → 对话记录 → 客户最新消息。最新消息单独一行、放在最后、明确标出来,这一点很重要。如果只把所有轮次平铺,模型有时会去回答第一轮的问题而不是最新的追问。放在末尾也符合「Lost in the Middle」那篇论文的发现:长上下文里,开头和结尾的信息最容易被模型用上,中间的最容易被忽略(Day 262 讲上下文预算时提过)。

### 改动二:load_customer 每轮开头重置「本轮」字段

```python
# supportpilot/src/supportpilot/agent/nodes.py(load_customer 整个替换,在 make_nodes 里面)
    def load_customer(state: SupportState) -> dict:
        text, err = deps.call_tool("get_customer", {"email": state["ticket"]["customer_email"]},
                                   ticket_id=state["ticket"]["id"])
        customer = None if err else json.loads(text)
        _emit({"type": "step", "node": "load_customer", "found": customer is not None})
        update: dict = {"customer": customer, "revisions": 0, "refund_request": None, "approval": None,
                        "followup": "", "review": {}, "findings": "", "hits": [], "handoff_reason": ""}
        if not state.get("turns"):  # 第一轮:把工单正文当作客户的第一条消息
            update["turns"] = [{"role": "customer", "content": state["ticket"]["body"]}]
        return update
```

<div class="line-notes">

- `text, err = deps.call_tool("get_customer"` 和 Day 460 一样,每轮都重新查一次客户。客户档案可能在两轮之间变了(比如刚升级了套餐),重查一次只花一条 SQL。
- `customer = None if err else json.loads(text)` 实测吴刚是 `C0010`。
- `update: dict = {"customer": customer, "revisions": 0, "refund_request": None, "approval": None,` Day 460 原来就重置这四个。
- `"followup": "", "review": {}, "findings": "", "hits": [], "handoff_reason": ""}` 今天新增重置的五个。原因见下文,漏掉 review 和 followup 的后果第四步和练习 2 都会实测。
- `if not state.get("turns"):` 只有第一轮 turns 还是空的。从第二轮开始,外面传进来的那条客户消息已经通过 `operator.add` 合并进去了,图从 START 跑到这里时 turns 至少有 3 条。
- `update["turns"] = [{"role": "customer", "content": state["ticket"]["body"]}]` 第一轮把工单正文当作客户说的第一句话。返回的是只有一条的列表,reducer 会把它加到空列表后面。

</div>

为什么要重置?因为 checkpoint 会把上一轮的所有字段原样带过来。上一轮质检的 `review`、上一轮查到的 `findings`、上一轮审批写的 `followup`,如果不清掉,第二轮的 draft 会看到「上一版草稿被质检退回」,finalize 会把上一轮的「退款已审核通过」又贴一遍。

想清楚哪些字段跨轮保留、哪些每轮重置,并写在一处:

| 跨轮保留 | 每轮重置 |
| --- | --- |
| `ticket`、`turns`、`tool_log`、`cost_cny` | `customer`(重新查)、`revisions`、`refund_request`、`approval`、`followup`、`review`、`findings`、`hits`、`handoff_reason` |

`triage`、`draft`、`outcome`、`reply` 没放进重置列表,因为它们每一轮都一定会被重新写:classify 必跑,draft 和 reply 在走到它们之前不会被读。规则是:一个字段只要有可能在被写之前被读,就必须重置。

### 改动三和四:回复追加进 turns

handoff 和 finalize 的返回值各加一个键,把发给客户的回复追加进对话记录:

```python
# supportpilot/src/supportpilot/agent/nodes.py(handoff、finalize 的 return 各改一行)
        return {"outcome": "escalated", "handoff_reason": reason, "reply": reply,
                "turns": [{"role": "agent", "content": reply}]}

        return {"outcome": "resolved", "reply": reply, "turns": [{"role": "agent", "content": reply}]}
```

<div class="line-notes">

- `return {"outcome": "escalated", "handoff_reason": reason, "reply": reply,` handoff 原来的返回值。
- `"turns": [{"role": "agent", "content": reply}]}` 转人工的固定话术也是发给客户的话,也要进记录,否则第二轮模型不知道已经说过「转给人工了」。
- `return {"outcome": "resolved", "reply": reply, "turns": [{"role": "agent", "content": reply}]}` finalize 追加的是渲染后的最终版本(引用已经变成 `[1]` 和文末链接),也就是客户真正看到的那份。

</div>

存进 turns 的是客户看到的版本,而不是带 `[KB-xxx]` 的草稿,原因很简单:对话记录要记的是「我们对客户说了什么」。坏处是记录里会带着「参考文章」那几行链接,多占一点 token,Day 465 的压缩会处理变长的问题。

图本身一行都不用改。`build_graph` 还是 Day 462 那个,checkpointer 从外面传进来。

## 第三步:用假 LLM 测多轮

先不花钱,把多轮逻辑测一遍。新建 `tests/test_memory.py`,复用 Day 463 的 `fakes.py`:

```python
# supportpilot/tests/test_memory.py
"""多轮对话:同一个 thread_id 上第二次 invoke,要接上第一轮;每轮的临时字段要清干净。"""

from fakes import FakeLLM, FakeTools, make_deps
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver

from supportpilot.agent.graph import build_graph
from supportpilot.agent.state import Ticket

TRIAGE = {"category": "technical", "needs_account_data": False, "needs_human": False, "urgency": "normal",
          "summary": "银行同步失败", "search_query": "E3001 银行流水同步失败"}
TICKET: Ticket = {"id": "T000901", "customer_email": "wugang@example.com", "subject": "银行流水又不同步了",
                  "body": "提示 E3001"}
DRAFT = "您好,E3001 一般是银行授权过期,请重新授权 [KB-refund-002]。"


def test_follow_up_keeps_history_on_same_thread():
    llm = FakeLLM(TRIAGE, [], DRAFT)
    graph = build_graph(make_deps(llm, FakeTools(customer={"id": "C0010"})), checkpointer=InMemorySaver())
    cfg: RunnableConfig = {"configurable": {"thread_id": TICKET["id"]}}

    first = graph.invoke({"ticket": TICKET}, cfg)
    assert [t["role"] for t in first["turns"]] == ["customer", "agent"]

    second = graph.invoke({"turns": [{"role": "customer", "content": "重新授权了还是不行"}]}, cfg)
    assert [t["role"] for t in second["turns"]] == ["customer", "agent", "customer", "agent"]
    assert second["turns"][2]["content"] == "重新授权了还是不行"


def test_other_thread_starts_fresh():
    graph = build_graph(make_deps(FakeLLM(TRIAGE, [], DRAFT), FakeTools(customer={"id": "C0010"})),
                        checkpointer=InMemorySaver())
    graph.invoke({"ticket": TICKET}, {"configurable": {"thread_id": "T000901"}})
    other = graph.invoke({"ticket": {**TICKET, "id": "T000902"}}, {"configurable": {"thread_id": "T000902"}})
    assert len(other["turns"]) == 2                          # 换一个 thread_id,什么都不带过来


def test_per_turn_fields_are_reset():
    llm = FakeLLM(TRIAGE, [], DRAFT, review_ok=False)        # 第一轮质检永远不过,最后转人工
    graph = build_graph(make_deps(llm, FakeTools(customer={"id": "C0010"})), checkpointer=InMemorySaver())
    cfg: RunnableConfig = {"configurable": {"thread_id": TICKET["id"]}}
    first = graph.invoke({"ticket": TICKET}, cfg)
    assert first["outcome"] == "escalated" and first["revisions"] == 2

    llm.review_ok = True                                     # 第二轮质检能过
    second = graph.invoke({"turns": [{"role": "customer", "content": "那我先自己试试"}]}, cfg)
    assert second["outcome"] == "resolved"
    assert second["revisions"] == 0                          # 上一轮的打回次数没带过来
    assert len(second["turns"]) == 4
```

<div class="line-notes">

- `from fakes import FakeLLM, FakeTools, make_deps` Day 463 写的假零件。
- `TRIAGE = {"category": "technical", "needs_account_data": False` 不查账,图走 retrieve → draft,最短的路,方便专注测多轮。
- `TICKET: Ticket = {"id": "T000901", "customer_email": "wugang@example.com"` 吴刚,种子数据里反复遇到银行同步问题的老客户。
- `DRAFT = "您好,E3001 一般是银行授权过期,请重新授权 [KB-refund-002]。"` 假检索返回的是 KB-refund-002,草稿要引用它才能过引用检查,和内容对不对无关。
- `graph = build_graph(make_deps(llm, FakeTools(customer={"id": "C0010"})), checkpointer=InMemorySaver())` 多轮必须有存档,否则第二次 invoke 读不到上一轮。
- `first = graph.invoke({"ticket": TICKET}, cfg)` 第一轮只传 ticket,turns 由 load_customer 填。
- `assert [t["role"] for t in first["turns"]] == ["customer", "agent"]` 列表推导式只取角色,一问一答两条。
- `second = graph.invoke({"turns": [{"role": "customer", "content": "重新授权了还是不行"}]}, cfg)` 第二轮只传新的一条,不传 ticket,ticket 从存档里来。
- `assert [t["role"] for t in second["turns"]] == ["customer", "agent", "customer", "agent"]` 四条,顺序正确,说明 reducer 是追加而不是覆盖。
- `assert second["turns"][2]["content"] == "重新授权了还是不行"` 第三条就是刚传进来的那句。
- `def test_other_thread_starts_fresh():` 隔离性:换一个 thread_id,上一张工单的对话一点都不能带过来。
- `assert len(other["turns"]) == 2` 新工单只有自己的一问一答。
- `def test_per_turn_fields_are_reset():` 第一轮故意走到最糟的结局(质检两次不过、转人工),看第二轮会不会被拖累。
- `llm.review_ok = True` 直接改假对象的属性,模拟「第二轮模型写得好了」。
- `assert second["revisions"] == 0` 第二轮一次就过,revisions 应该是 0。如果 load_customer 不重置 revisions,它从上一轮的 2 开始,第二轮第一次质检过了也不影响,但只要第二轮有一次不过,3 > 1 直接转人工,一次重写机会都没有。
- `assert len(second["turns"]) == 4` 客户、客服(转人工话术)、客户、客服。

</div>

```bash
uv run pytest tests/test_memory.py -v
```

真实输出:

```text
tests/test_memory.py::test_follow_up_keeps_history_on_same_thread PASSED [ 33%]
tests/test_memory.py::test_other_thread_starts_fresh PASSED              [ 66%]
tests/test_memory.py::test_per_turn_fields_are_reset PASSED              [100%]
============================== 3 passed in 7.82s ===============================
```

再跑一次全部测试,确认改节点没把 Day 463 的 11 个单测弄坏:`uv run pytest -q`,实测 `36 passed in 12.11s`。Day 463 的测试只跑一轮,turns 从空开始,`_ticket_text` 拼出来的内容和以前几乎一样,所以全部还能过。

## 第四步:故意漏掉一个重置

第一次写 load_customer 的时候,我只重置了 Day 460 原来那四个字段,没加 review。为了看清后果,写一个探针:继承 FakeLLM,把 draft 节点收到的提示词存下来。

```python
# supportpilot/scratch/probe_reset.py
"""看第二轮 draft 节点到底收到了什么。第一轮故意质检两次不过,第二轮正常。"""

import sys

sys.path[:0] = ["tests"]

from fakes import FakeLLM, FakeTools, make_deps
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from test_memory import DRAFT, TICKET, TRIAGE

from supportpilot.agent.graph import build_graph


class Spy(FakeLLM):
    last_prompt = ""

    def stream(self, messages, on_token=None, **kw):
        self.last_prompt = messages[1]["content"]
        return super().stream(messages, on_token, **kw)


llm = Spy(TRIAGE, [], DRAFT, review_ok=False)
g = build_graph(make_deps(llm, FakeTools(customer={"id": "C0010"})), checkpointer=InMemorySaver())
cfg: RunnableConfig = {"configurable": {"thread_id": "T000901"}}
g.invoke({"ticket": TICKET}, cfg)
llm.review_ok = True
out = g.invoke({"turns": [{"role": "customer", "content": "那我先自己试试"}]}, cfg)
print(llm.last_prompt)
print("---", out["outcome"], out["revisions"], len(out["turns"]), "handoff_reason=", repr(out.get("handoff_reason")))
```

<div class="line-notes">

- `sys.path[:0] = ["tests"]` 把 tests 目录插到模块搜索路径最前面,和 `sys.path.insert(0, "tests")` 效果一样。
- `from test_memory import DRAFT, TICKET, TRIAGE` 直接复用上一节测试文件里的常量。
- `class Spy(FakeLLM):` 继承假 LLM,只覆盖 stream 一个方法。这种「记下自己被怎么调用」的替身叫 spy。
- `self.last_prompt = messages[1]["content"]` draft 节点的 messages 是 [系统提示, 用户消息],第二条就是拼好的全部材料。
- `return super().stream(messages, on_token, **kw)` 记完以后照常走父类的逻辑,相当于 JS 的 `super.stream(...)`。
- `llm.review_ok = True` 第二轮质检会过。
- `print(llm.last_prompt)` 打印第二轮起草时模型实际看到的材料。
- `repr(out.get("handoff_reason"))` repr 会带上引号,空字符串能看得出来是 `''`。

</div>

正常版本(重置了全部九个字段)第二轮 draft 收到的材料,真实输出:

```text
【客户工单】
发件邮箱:wugang@example.com
主题:银行流水又不同步了

对话记录:
客户:提示 E3001
客服:您好,您的问题已经转给人工客服同事,会在 1 个工作日内通过这个工单回复您。

客户最新消息:那我先自己试试

【帮助中心资料】
[KB-refund-002] 年付 14 天无理由退款 / 条件
首次购买的年付订阅 14 天内全额退款。

【调查结论】
(没有查询客户数据)
--- resolved 0 4 handoff_reason= ''
```

把 load_customer 的重置改回只有原来那四个字段,再跑一次,差别在最后:

```text
【调查结论】
(没有查询客户数据)

【上一版草稿被质检退回,问题如下,请改正】
金额没有依据
--- resolved 0 4 handoff_reason= '草稿多次未通过质检:金额没有依据'
```

第二轮客户只说了一句「那我先自己试试」,模型却被要求「改正上一版草稿的问题:金额没有依据」。真模型拿到这个,回复里就会莫名其妙地去「修正」一个客户根本没看到过的错误。我第一次接真模型时就碰上了:客户问了个很简单的问题,回复开头却在解释金额是怎么算的。还有 `handoff_reason` 也残留着上一轮的原因,这张工单第二轮明明 resolved 了,状态里却还挂着转人工的理由,将来做统计会算错。

这种 bug 单看任何一个节点都没错,只有在「同一个 thread 跑第二次」时才出现。所以 `test_per_turn_fields_are_reset` 专门造了一个「第一轮最糟」的场景。

## 第五步:checkpoint 存进 Postgres

`InMemorySaver` 存在进程内存里,进程一退出就没了。真实客服里,客户隔天才回来追问,财务第二天早上才点审批,服务中间还可能重启部署,状态必须落盘。Day 318 你用过 SqliteSaver,生产上我们用 Postgres,SupportPilot 的业务库本来就在 Postgres 里,不用多一个依赖。`langgraph-checkpoint-postgres` 这个包 Day 441 装依赖时已经装好了(2026 年 10 月 PyPI 上是 3.2.0)。

新建 `memory/checkpoint.py`:

```python
# supportpilot/src/supportpilot/memory/checkpoint.py
"""LangGraph 的 checkpoint 存 Postgres:进程重启、审批隔天才点,工单状态都还在。"""

import psycopg
from langgraph.checkpoint.postgres import PostgresSaver
from psycopg.rows import DictRow, dict_row

from ..config import get_settings

# setup() 建的四张表里,这三张存对话快照;checkpoint_migrations 记的是表结构版本,不能清
CHECKPOINT_TABLES = ("checkpoint_writes", "checkpoint_blobs", "checkpoints")


def make_checkpointer(url: str | None = None) -> PostgresSaver:
    # PostgresSaver 要求 autocommit + dict_row;prepare_threshold=0 避免和连接池的预编译语句冲突
    conn = psycopg.Connection[DictRow].connect(url or get_settings().database_url, autocommit=True,
                                               prepare_threshold=0, row_factory=dict_row)
    saver = PostgresSaver(conn)
    saver.setup()  # 第一次运行时建 checkpoint 相关的表,之后什么都不做
    return saver


def reset_checkpoints(url: str | None = None) -> int:
    """清空所有工单的对话快照,返回清掉了几份。重新 seed 业务库之前先跑:
    seed 会把工单号重新从 T000001 编起,不清的话新工单会接上同号旧工单的对话。"""
    make_checkpointer(url)  # 表还没建过的话先建好,下面的 TRUNCATE 才不会报错
    with psycopg.connect(url or get_settings().database_url, autocommit=True) as conn:
        row = conn.execute("SELECT count(*) FROM checkpoints").fetchone()
        n = row[0] if row else 0
        conn.execute(f"TRUNCATE {', '.join(CHECKPOINT_TABLES)}")
    return n


if __name__ == "__main__":
    print(f"cleared {reset_checkpoints()} checkpoints")
```

<div class="line-notes">

- `import psycopg` Day 443 起一直在用的 Postgres 驱动。
- `from langgraph.checkpoint.postgres import PostgresSaver` 来自 `langgraph-checkpoint-postgres` 包。
- `from psycopg.rows import DictRow, dict_row` `dict_row` 让查询结果是字典而不是元组;`DictRow` 是它的类型名,下面给连接标类型用。
- `CHECKPOINT_TABLES = ("checkpoint_writes", "checkpoint_blobs", "checkpoints")` 只清存快照的三张。`checkpoint_migrations` 记的是表结构版本,清掉的话下次 setup 会以为表还没建,重跑建表语句。
- `def make_checkpointer(url: str | None = None) -> PostgresSaver:` 不传 url 就用 `.env` 里的 DATABASE_URL,和业务库同一个库。
- `conn = psycopg.Connection[DictRow].connect(` 单独开一条连接给 checkpointer,不和业务查询共用。写成 `Connection[DictRow].connect` 而不是 `psycopg.connect`,是为了让 basedpyright 知道这条连接返回字典行:用 `psycopg.connect(..., row_factory=dict_row)` 运行时完全一样,但类型检查会报 `"Connection[TupleRow]" is not assignable to "Connection[DictRow]"`。
- `prepare_threshold=0, row_factory=dict_row)` 上一行末尾的 `autocommit=True` 是 PostgresSaver 的要求:每条语句自己提交,它内部自己管事务。`prepare_threshold=0` 关掉 psycopg 的预编译语句,以后前面加 pgbouncer 这类连接池时不会报 `prepared statement already exists`。
- `saver = PostgresSaver(conn)` 以后每个节点跑完,快照都通过这条连接写进库。
- `saver.setup()` 实测第一次跑完,public schema 里多了 `checkpoint_blobs`、`checkpoint_migrations`、`checkpoint_writes`、`checkpoints` 四张表。再调一次什么都不做。
- `def reset_checkpoints(url: str | None = None) -> int:` 重新造数前调用,原因第七步实测。
- `make_checkpointer(url)` 在全新的库上直接 TRUNCATE 会报「表不存在」,先确保表建好了。
- `with psycopg.connect(url or get_settings().database_url, autocommit=True) as conn:` 这条连接只用一次,`with` 结束自动关闭(Day 98)。
- `row = conn.execute("SELECT count(*) FROM checkpoints").fetchone()` 先数一下要清多少份。这条连接没设 dict_row,返回元组。
- `n = row[0] if row else 0` `fetchone()` 的类型是「元组或 None」,先判断再取,类型检查才不报错。count(*) 实际上一定有一行。
- `conn.execute(f"TRUNCATE {', '.join(CHECKPOINT_TABLES)}")` 拼出来是 `TRUNCATE checkpoint_writes, checkpoint_blobs, checkpoints`。表名是代码里写死的常量,不是用户输入,用 f-string 拼没有 SQL 注入风险。TRUNCATE 比 DELETE 快,不逐行处理。
- `print(f"cleared {reset_checkpoints()} checkpoints")` 用 `uv run python -m supportpilot.memory.checkpoint` 运行,`-m` 按模块名运行(Day 33),包内的相对导入才能用。

</div>

先建表看看:

```bash
uv run python -m supportpilot.memory.checkpoint
psql -d supportpilot -c "\dt public.*"
```

(库名按你 Day 443 建的来,我本机的临时库名不一样。)真实输出:

```text
cleared 0 checkpoints
                List of relations
 Schema |         Name          | Type  | Owner  
--------+-----------------------+-------+--------
 public | checkpoint_blobs      | table | minliu
 public | checkpoint_migrations | table | minliu
 public | checkpoint_writes     | table | minliu
 public | checkpoints           | table | minliu
(4 rows)
```

四张表建在 public schema,和我们 Day 443 的 `biz`、`kb` 两个 schema 分开,互不干扰。

## 第六步:在终端里和一张工单聊三轮

新建 `scripts/chat_ticket.py`:第一次运行建工单并处理第一句话,然后进入追问循环;Ctrl+C 退出后,用 `--ticket 工单号` 重新启动接着聊。

```python
# supportpilot/scripts/chat_ticket.py
"""终端里和一张工单多轮对话,状态存 Postgres。Ctrl+C 退出后,用 --ticket 接着聊,前面的对话都还在。

uv run python scripts/chat_ticket.py wugang@example.com "银行流水又同步失败了,提示E3001"
uv run python scripts/chat_ticket.py --ticket T000153
"""

import argparse

from langchain_core.runnables import RunnableConfig
from langgraph.types import Command

from supportpilot.agent.deps import Deps
from supportpilot.agent.graph import build_graph
from supportpilot.db import connect
from supportpilot.memory.checkpoint import make_checkpointer
from supportpilot.tools import business as biz


def run(graph, payload, cfg: RunnableConfig) -> None:
    for mode, chunk in graph.stream(payload, cfg, stream_mode=["updates", "custom"]):
        if mode == "custom" and chunk["type"] == "token":
            print(chunk["text"], end="", flush=True)
        elif mode == "custom" and chunk["type"] == "tool":
            print(f"\n  [tool] {chunk['name']}({chunk['args']})")
        elif mode == "custom" and chunk["type"] == "step" and chunk["node"] == "check":
            print(f"\n  [check] passed={chunk['passed']}")
    while graph.get_state(cfg).next:
        ok = input("\n  [审批] 通过这笔退款吗?[y/N] ").strip().lower() == "y"
        graph.invoke(Command(resume={"approved": ok, "approver": "cli"}), cfg)
    v = graph.get_state(cfg).values
    print(f"\n\n--- 发给客户({v.get('outcome')})---\n{v.get('reply')}\n")
    print(f"[记忆] 对话记录共 {len(v.get('turns', []))} 条,累计花费 ¥{v.get('cost_cny', 0):.4f}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("email", nargs="?")
    ap.add_argument("message", nargs="?")
    ap.add_argument("--ticket")
    args = ap.parse_args()

    conn = connect()
    graph = build_graph(Deps.from_conn(conn), checkpointer=make_checkpointer())
    if args.ticket:
        tid = args.ticket
        if not graph.get_state({"configurable": {"thread_id": tid}}).values:
            raise SystemExit(f"工单 {tid} 没有保存的对话")
    else:
        if not (args.email and args.message):
            raise SystemExit("用法:chat_ticket.py 邮箱 \"第一句话\",或者 --ticket 工单号")
        tid = biz.create_ticket(conn, args.email, args.message[:30], args.message)
        run(graph, {"ticket": {"id": tid, "customer_email": args.email, "subject": args.message[:30],
                               "body": args.message}}, {"configurable": {"thread_id": tid}})
    cfg: RunnableConfig = {"configurable": {"thread_id": tid}}
    print(f"工单 {tid},输入追问(Ctrl+C 退出):")
    while True:
        try:
            msg = input("客户> ").strip()
        except (KeyboardInterrupt, EOFError):
            print(f"\n下次接着聊:uv run python scripts/chat_ticket.py --ticket {tid}")
            return
        if msg:
            run(graph, {"turns": [{"role": "customer", "content": msg}]}, cfg)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `import argparse` Python 标准库的命令行参数解析,相当于 Node 里的 commander 或 yargs。
- `def run(graph, payload, cfg: RunnableConfig) -> None:` 跑一轮:流式打印、处理审批、打印结果和记忆状态。
- `if mode == "custom" and chunk["type"] == "token":` 起草的 token 连着打。和 Day 463 的 run_tickets 一样,只是少打印一些步骤。
- `elif mode == "custom" and chunk["type"] == "step" and chunk["node"] == "check":` 只打印质检结果,别的步骤省掉,对话时屏幕清爽一点。
- `while graph.get_state(cfg).next:` 停在审批前才进循环。银行同步这类工单没有退款,`next` 是 `()`。
- `graph.invoke(Command(resume={"approved": ok, "approver": "cli"}), cfg)` 审批后恢复。这里用 invoke 不用 stream,恢复之后只剩 approval 和 finalize,没什么好看的。
- `v = graph.get_state(cfg).values` 从 Postgres 里读出这一轮跑完后的完整状态。
- `print(f"[记忆] 对话记录共 {len(v.get('turns', []))} 条,累计花费` 「条」是消息条数,一问一答算 2 条。cost_cny 跨轮累加,显示的是整张工单到目前为止的总花费。
- `ap.add_argument("email", nargs="?")` `nargs="?"` 表示这个位置参数可以不给,用 `--ticket` 接着聊时就不给。
- `ap.add_argument("--ticket")` 带两个横线的是可选参数,`args.ticket` 没给时是 None。
- `graph = build_graph(Deps.from_conn(conn), checkpointer=make_checkpointer())` 和 Day 463 唯一的区别:存档从 InMemorySaver 换成了 Postgres。
- `if not graph.get_state({"configurable": {"thread_id": tid}}).values:` 没存过的 thread,values 是空字典。实测 `--ticket T999999` 输出 `工单 T999999 没有保存的对话` 后退出。
- `raise SystemExit(f"工单 {tid} 没有保存的对话")` 抛 SystemExit 会打印这句话并以非 0 状态码退出,不打一长串 traceback。
- `tid = biz.create_ticket(conn, args.email, args.message[:30], args.message)` 先在业务库建工单拿编号,主题取消息的前 30 个字。
- `run(graph, {"ticket": {"id": tid, "customer_email": args.email, "subject": args.message[:30],` 第一轮只传 ticket。
- `msg = input("客户> ").strip()` 读一行追问。
- `except (KeyboardInterrupt, EOFError):` Ctrl+C 抛 KeyboardInterrupt;输入流结束(管道读完了、按了 Ctrl+D)抛 EOFError。两种都优雅退出,提示下次怎么接着聊。
- `run(graph, {"turns": [{"role": "customer", "content": msg}]}, cfg)` 追问只传新的一条,靠 `operator.add` 接到历史后面。

</div>

先重新造数(保证工单号从 T000153 开始),然后开聊。我用管道喂了第二句话,效果等于手动输入:

```bash
uv run python scripts/seed_db.py
printf '重新授权了还是不行\n' | uv run python scripts/chat_ticket.py wugang@example.com "银行流水又同步失败了,提示E3001"
```

第一轮的回复(真实输出,只截了「发给客户」那段):

```text
--- 发给客户(resolved)---
您好,E3001 表示银行流水同步失败,最常见的原因是银行授权超过 90 天已过期,授权有效期为 90 天,到期需重新授权,否则会同步失败并提示 E3001 [1][2]。

请按以下步骤处理:1. 进入「银行账户」点击「重新授权」;2. 授权成功后点「立即同步」;3. 若仍失败,请确认网银没有修改密码或注销 [1]。

如按上述步骤操作后仍未解决,请提交工单并附上报错截图、报错码 E3001 和发生时间,我们会转给技术同事跟进 [1]。另外,我们暂未查到您的账户信息,方便的话请提供注册邮箱,以便进一步核实。

参考文章:
[1] E3001 银行流水同步失败 https://help.cloudledger.example/help/error/005
[2] 连接银行账户同步流水 https://help.cloudledger.example/help/technical/003

[记忆] 对话记录共 2 条,累计花费 ¥0.0054
```

末尾那句「暂未查到您的账户信息」又出现了,和 Day 463 问题清单第 1 条是同一个问题(这单分诊判不需要查账,模型把「没查」理解成了「没查到」),先不管它。

第二轮,客户说「重新授权了还是不行」:

```text
  [tool] search_past_tickets({"customer_id": "C0010"})

  [tool] list_subscriptions({"customer_id": "C0010"})

  [tool] query_customer_data({"sql": "SELECT id, subject, category, status, created_at, resolved_at, resolution_summary FROM tickets ORDER BY created_at DESC"})
您好,重新授权后仍失败,说明问题已超出授权过期这一常见原因。请先确认网银近期没有修改密码或注销 [KB-error-005],并再次点击「立即同步」尝试 [KB-error-005]。
...
[记忆] 对话记录共 4 条,累计花费 ¥0.0303
客户> 
下次接着聊:uv run python scripts/chat_ticket.py --ticket T000153
```

「重新授权后仍失败,说明问题已超出授权过期这一常见原因」,它接上了上一轮的建议,没有再把重新授权那一套重复一遍。而且这一轮分诊判了需要查账:光看「重新授权了还是不行」这一句,什么都判断不出来;是对话记录让模型知道这是一个反复出现的同步问题,于是去查了历史工单。管道里的输入读完,触发 EOFError,脚本打印了下次接着聊的命令。

现在进程已经退出了。重新启动,用工单号接着问:

```bash
printf '还在吗?刚才说到哪了\n' | uv run python scripts/chat_ticket.py --ticket T000153
```

```text
工单 T000153,输入追问(Ctrl+C 退出):
客户> 
  [tool] search_past_tickets({"customer_id": "C0010"})

  [tool] list_subscriptions({"customer_id": "C0010"})
您好，刚才说到：您重新授权后仍同步失败，已超出授权过期的常见原因，请先确认网银近期没有修改密码或注销 [KB-error-005]，再点一次「立即同步」试试 [KB-error-005]。
...
[记忆] 对话记录共 6 条,累计花费 ¥0.0512
```

这一步最能说明问题:进程已经退出过一次,内存里什么都没有,Agent 依然知道这张工单前面聊过什么,「刚才说到」后面复述的正是第二轮的建议。三轮一共花了 0.0512 元,每轮的花费在涨(0.0054 → 0.0249 → 0.0209),因为对话记录越来越长,还多了工具调用。

看看库里存了多少份快照:

```sql
SELECT thread_id, count(*) AS snapshots FROM checkpoints GROUP BY thread_id;
```

```text
 thread_id | snapshots 
-----------+-----------
 T000153   |        26
(1 row)
```

三轮 26 份。每个节点跑完存一份,加上每轮开头的输入各一份,一轮大概 8 到 10 份,走了 act 或者被质检打回重写的那一轮会多一两份。快照里是完整的状态,所以 Day 317 的「看历史」、Day 322 的「时间旅行」在 Postgres 上照样能用。代价是这几张表长得很快,上线后要定期清理已关闭工单的快照,这件事 Day 466 讲隐私和删除时再说。

## 第七步:重新造数后,新工单接上了旧对话

这是我真踩过的坑。`seed_db.py`(Day 445)会清空业务表,工单号重新从 T000001 编起,但 checkpoint 表它不管。复现一下:不清快照,直接重新造数,然后建一张内容完全不同的新工单:

```bash
uv run python scripts/seed_db.py
printf '' | uv run python scripts/chat_ticket.py zhangwei@example.com "发票抬头写错了,能重开吗"
```

这次是张伟问发票,和吴刚的银行同步毫无关系。打印出来的是 `[记忆] 对话记录共 7 条,累计花费 ¥0.0799`,一张新工单,7 条记录,花费从 0.05 起跳。写个小脚本看看库里这张工单到底存了什么:

```python
# supportpilot/scratch/peek_turns.py
"""看一眼某张工单存在 Postgres 里的对话记录。"""

import sys

from supportpilot.memory.checkpoint import make_checkpointer

saver = make_checkpointer()
tup = saver.get_tuple({"configurable": {"thread_id": sys.argv[1]}})
values = tup.checkpoint["channel_values"] if tup else {}
print("ticket:", values.get("ticket", {}).get("body"))
for t in values.get("turns", []):
    print(f"  {t['role']:<8} {t['content'][:40]}")
```

<div class="line-notes">

- `saver = make_checkpointer()` 不建图,直接用存档对象读。
- `tup = saver.get_tuple({"configurable": {"thread_id": sys.argv[1]}})` 取这个 thread 最新的一份快照,没有就是 None。
- `values = tup.checkpoint["channel_values"] if tup else {}` 快照里 `channel_values` 就是状态字典。LangGraph 内部把每个状态字段叫一个 channel。
- `print(f"  {t['role']:<8} {t['content'][:40]}")` 每条只打前 40 个字。

</div>

```bash
uv run python scratch/peek_turns.py T000153
```

真实输出:

```text
ticket: 发票抬头写错了,能重开吗
  customer 银行流水又同步失败了,提示E3001
  agent    您好,E3001 表示银行流水同步失败,最常见的原因是银行授权超过 90 天已过
  customer 重新授权了还是不行
  agent    您好,重新授权后仍失败,说明问题已超出授权过期这一常见原因。请先确认网银近期没有
  customer 还在吗?刚才说到哪了
  agent    您好，刚才说到：您重新授权后仍同步失败，已超出授权过期的常见原因，请先确认网银近
  agent    您好，关于发票抬头重开的问题：您的工单 T000153 目前状态为 open，尚
```

ticket 已经被新工单覆盖了(ticket 没有 reducer,新输入直接替换),但 turns 是旧对话的 6 条加上新回复 1 条。更糟的是,新工单的正文「发票抬头写错了」一个字都没进 turns:load_customer 看到 turns 不是空的,以为这是第二轮,就不再把正文当第一条消息放进去。模型能答上发票问题,完全是因为 `_ticket_text` 里还有一个「主题」字段。

修法就是 `reset_checkpoints()`,每次重新造数之前先清快照:

```bash
uv run python -m supportpilot.memory.checkpoint
uv run python scripts/seed_db.py
printf '' | uv run python scripts/chat_ticket.py zhangwei@example.com "发票抬头写错了,能重开吗"
uv run python scratch/peek_turns.py T000153
```

```text
cleared 35 checkpoints
...
[记忆] 对话记录共 2 条,累计花费 ¥0.0049
ticket: 发票抬头写错了,能重开吗
  customer 发票抬头写错了,能重开吗
  agent    您好,发票抬头填错可以重开:开票后 30 天内,在「设置 - 发票」在线申请红冲
```

干净了。建议把这一步写进 Day 446 的 Makefile,让 `make seed` 先跑一遍 `python -m supportpilot.memory.checkpoint`。生产环境不会碰到这个问题,因为工单号永远不会重用;只有本地反复造数时才会撞上。但它提醒了一件事:**thread_id 必须是永不重复的东西**,用自增编号时尤其要小心。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1g61fBFEKY&autoplay=0&high_quality=1" title="最新 Langchain1.0 入门【17】langgraph 状态管理器 checkpointer 详细解析" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>强哥学编程 · 最新 Langchain1.0 入门【17】langgraph 状态管理器 checkpointer 详细解析 · 32 分钟,把 InMemorySaver、thread_id、get_state 和持久化后端讲一遍,看完再对照今天从内存换到 Postgres 那一步。</figcaption>
</figure>

## 零件和大代码的对照

| 零件 | 改了哪个文件 | 作用 |
| --- | --- | --- |
| `turns` + `operator.add` | `agent/state.py` | 对话记录,追加不覆盖 |
| `render_turns` | `memory/turns.py`(新) | 对话记录渲染成「客户:/客服:」 |
| 新 `_ticket_text` | `agent/nodes.py` | 四个调模型的节点都看到历史,最新消息放最后 |
| 新 `load_customer` | `agent/nodes.py` | 第一轮放入正文;每轮重置九个「本轮」字段 |
| handoff / finalize 追加回复 | `agent/nodes.py` | 发给客户的话进记录 |
| `make_checkpointer` / `reset_checkpoints` | `memory/checkpoint.py`(新) | 状态落 Postgres;重新造数前清快照 |
| `chat_ticket.py` | `scripts/`(新) | 终端多轮对话,`--ticket` 接着聊 |
| `test_memory.py` | `tests/`(新) | 接得上、隔得开、清得干净 |

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/JTL0yp85FsE" title="Memory for agents (conceptual video)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Memory for agents (conceptual video) · 官方的概念讲解,把短期记忆(线程内)和长期记忆(跨线程)放在一张图里,今天做的是前者,Day 466 的客户画像是后者。</figcaption>
</figure>

## 动手练习

**练习 1:去掉 reducer 会怎样。** 在一个不调模型的玩具图上,分别用「turns 带 `operator.add`」和「turns 是普通 `list[dict]`」两种状态,同一个 thread 上 invoke 两次,打印第二次之后的 turns。

<details><summary>参考答案</summary>

```python
# supportpilot/scratch/ex1_no_reducer.py
"""练习 1:把 turns 的 reducer 去掉,看第二轮之后对话记录还剩几条。玩具图,不调模型。"""

import operator
from typing import Annotated, Any, TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph


class WithReducer(TypedDict, total=False):
    turns: Annotated[list[dict], operator.add]


class NoReducer(TypedDict, total=False):
    turns: list[dict]


def reply(state: Any) -> dict:
    return {"turns": [{"role": "agent", "content": f"收到第 {len(state['turns'])} 条"}]}


def two_rounds(schema: Any) -> list[str]:
    g = StateGraph(schema)
    g.add_node("reply", reply)
    g.add_edge(START, "reply")
    g.add_edge("reply", END)
    graph = g.compile(checkpointer=InMemorySaver())
    cfg: RunnableConfig = {"configurable": {"thread_id": "T1"}}
    graph.invoke({"turns": [{"role": "customer", "content": "你好"}]}, cfg)
    out = graph.invoke({"turns": [{"role": "customer", "content": "还在吗"}]}, cfg)
    return [t["content"] for t in out["turns"]]


print("WithReducer", two_rounds(WithReducer))
print("NoReducer  ", two_rounds(NoReducer))
```

<div class="line-notes">

- `class WithReducer(TypedDict, total=False):` 和 SupportState 的 turns 一样的写法。
- `class NoReducer(TypedDict, total=False):` 没有 Annotated,默认覆盖。
- `def reply(state: Any) -> dict:` 唯一的节点,回一句「收到第几条」,条数是它看到的 turns 长度。参数标 `Any` 是因为两种状态共用这个函数。
- `def two_rounds(schema: Any) -> list[str]:` 用给定的状态类型建图、跑两轮,返回第二轮之后所有消息的内容。
- `graph.invoke({"turns": [{"role": "customer", "content": "你好"}]}, cfg)` 第一轮。
- `out = graph.invoke({"turns": [{"role": "customer", "content": "还在吗"}]}, cfg)` 第二轮,同一个 thread,只传新的一条。

</div>

```bash
uv run python scratch/ex1_no_reducer.py
```

```text
WithReducer ['你好', '收到第 1 条', '还在吗', '收到第 3 条']
NoReducer   ['收到第 1 条']
```

有 reducer 时四条都在,第二轮节点看到 3 条。没有 reducer 时:第二轮的输入「还在吗」先把整个列表覆盖成一条,reply 节点看到 1 条,又用自己的返回值再覆盖一次,最后只剩 `收到第 1 条`,连客户刚说的话都没了。

</details>

**练习 2:followup 漏重置会怎样。** 第一轮退款审批通过,finalize 会在回复末尾贴「补充:您的退款申请已审核通过……」。写一个测试:第二轮客户只说「好的,谢谢」,断言第二轮的回复里没有「已审核通过」。然后把 load_customer 里的 `"followup": ""` 去掉,再跑一次看看。

<details><summary>参考答案</summary>

```python
# supportpilot/tests/test_memory_more.py
"""练习 2:第一轮退款审批通过,第二轮随口问个问题,回复里不能再带上一轮的「审核通过」补充。"""

from fakes import FakeLLM, FakeTools, make_deps
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command
from test_graph_smoke import ACT, DRAFT, LINA, REFUND_TRIAGE, TICKET

from supportpilot.agent.graph import build_graph


def test_followup_does_not_leak_into_next_turn():
    llm = FakeLLM(REFUND_TRIAGE, ACT, DRAFT)
    graph = build_graph(make_deps(llm, FakeTools(customer=LINA)), checkpointer=InMemorySaver())
    cfg: RunnableConfig = {"configurable": {"thread_id": TICKET["id"]}}
    graph.invoke({"ticket": TICKET}, cfg)
    first = graph.invoke(Command(resume={"approved": True, "approver": "finance-amy"}), cfg)
    assert "已审核通过" in first["reply"]

    llm.triage = {**REFUND_TRIAGE, "category": "other", "needs_account_data": False}
    second = graph.invoke({"turns": [{"role": "customer", "content": "好的,谢谢"}]}, cfg)
    assert "已审核通过" not in second["reply"]
    assert len(second["turns"]) == 4
```

<div class="line-notes">

- `from test_graph_smoke import ACT, DRAFT, LINA, REFUND_TRIAGE, TICKET` 复用 Day 463 的退款剧本。
- `first = graph.invoke(Command(resume={"approved": True` 第一轮停在审批,批准后定稿。
- `assert "已审核通过" in first["reply"]` 第一轮应该有补充说明。注意不能断言「审核通过」四个字:DRAFT 里本来就有「审核通过后会原路退回」,我第一版就这么写,结果正确的代码也挂了。
- `llm.triage = {**REFUND_TRIAGE, "category": "other", "needs_account_data": False}` 第二轮换个分诊剧本,不查账,不会再建退款申请。
- `assert "已审核通过" not in second["reply"]` 第二轮的回复不能带上一轮的补充。

</div>

```bash
uv run pytest tests/test_memory_more.py -q
```

正常代码:`1 passed in 2.99s`。去掉 `"followup": ""` 之后:

```text
E       AssertionError: assert '已审核通过' not in '您好,您的年付订阅在 ...到账时间以支付渠道为准。'
1 failed in 3.20s
```

客户只说了声谢谢,回复末尾却又通知了一遍「退款已审核通过,950 元将原路退回」。客户会以为又退了一笔。改回去,测试通过。

</details>

**练习 3:看一张工单的历史快照。** 写一个脚本,用 `graph.get_state_history(cfg)` 列出某张工单在 Postgres 里的快照数,并打印最新 9 份的 step、next 和 turns 条数。先和一张工单聊两轮再跑。

<details><summary>参考答案</summary>

```python
# supportpilot/scratch/history.py
"""练习 3:列出一张工单在 Postgres 里的快照,从新到旧。"""

import sys

from langchain_core.runnables import RunnableConfig

from supportpilot.agent.deps import Deps
from supportpilot.agent.graph import build_graph
from supportpilot.db import connect
from supportpilot.memory.checkpoint import make_checkpointer

graph = build_graph(Deps.from_conn(connect()), checkpointer=make_checkpointer())
cfg: RunnableConfig = {"configurable": {"thread_id": sys.argv[1]}}
snaps = list(graph.get_state_history(cfg))
print("快照数:", len(snaps))
for s in snaps[:9]:
    print(s.metadata.get("step") if s.metadata else None, s.next, len(s.values.get("turns", [])))
```

<div class="line-notes">

- `snaps = list(graph.get_state_history(cfg))` `get_state_history` 返回一个生成器(Day 99),从新到旧逐份产出,`list()` 一次全取出来。
- `print(s.metadata.get("step") if s.metadata else None, s.next, len(s.values.get("turns", [])))` step 是第几步,next 是这份快照之后要跑的节点,最后是这时 turns 有几条。metadata 类型上可能是 None,先判断再取。

</div>

我先清了快照、重新造数,和吴刚聊了两轮(第二句是「谢谢,那授权多久要重新弄一次?」,两轮共 0.0152 元),然后:

```bash
uv run python scratch/history.py T000153
```

```text
快照数: 18
16 () 4
15 ('finalize',) 3
14 ('check',) 3
13 ('draft',) 3
12 ('retrieve',) 3
11 ('classify',) 3
10 ('load_customer',) 3
9 ('__start__',) 2
8 () 2
```

从下往上读就是第二轮的执行过程:step 8 是第一轮结束(2 条),step 9 是第二轮的输入刚到、还没合并(next 是 `__start__`,turns 还是 2 条),step 10 输入已合并成 3 条、接下来要跑 load_customer,然后 classify、retrieve、draft、check、finalize,step 16 finalize 追加了回复,4 条,next 为空表示这一轮跑完了。剩下 9 份是第一轮的(step -1 到 7),比第二轮多,是因为第一轮第一版草稿被质检打回过一次,draft 和 check 各多跑了一遍。

</details>

**练习 4(开放题):thread_id 用客户 ID 会怎样?** 用假零件写个脚本:同一个客户的两张不同工单(银行同步、发票抬头),都用客户 ID `C0010` 当 thread_id,跑完看第二张工单的 turns。

<details><summary>参考答案</summary>

```python
# supportpilot/scratch/ex4_thread_by_customer.py
"""练习 4:如果 thread_id 用客户 ID,同一个客户的两张工单会怎样?假零件,不花钱。"""

import sys

sys.path.insert(0, "tests")

from fakes import FakeLLM, FakeTools, make_deps
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver

from supportpilot.agent.graph import build_graph
from supportpilot.agent.state import Ticket

triage = {"category": "technical", "needs_account_data": False, "needs_human": False, "urgency": "normal",
          "summary": "银行同步失败", "search_query": "E3001"}
graph = build_graph(make_deps(FakeLLM(triage, [], "您好 [KB-refund-002]。"), FakeTools(customer={"id": "C0010"})),
                    checkpointer=InMemorySaver())
cfg: RunnableConfig = {"configurable": {"thread_id": "C0010"}}   # 错误示范:用客户 ID 当 thread_id

first: Ticket = {"id": "T000201", "customer_email": "wugang@example.com", "subject": "银行同步", "body": "提示 E3001"}
second: Ticket = {"id": "T000202", "customer_email": "wugang@example.com", "subject": "发票", "body": "发票抬头写错了"}
graph.invoke({"ticket": first}, cfg)
out = graph.invoke({"ticket": second}, cfg)
print("ticket:", out["ticket"]["id"], out["ticket"]["body"])
for t in out["turns"]:
    print(" ", t["role"], t["content"].splitlines()[0])
```

<div class="line-notes">

- `cfg: RunnableConfig = {"configurable": {"thread_id": "C0010"}}` 两张工单共用一个 thread,这就是要演示的错误设计。
- `out = graph.invoke({"ticket": second}, cfg)` 第二张工单作为新的 ticket 传进去。
- `print(" ", t["role"], t["content"].splitlines()[0])` 回复里有换行(参考文章),只打第一行。

</div>

```text
ticket: T000202 发票抬头写错了
  customer 提示 E3001
  agent 您好 [1]。
  agent 您好 [1]。
```

和第七步「工单号重用」是同一个病:ticket 换成了第二张,但 turns 里只有第一张的「提示 E3001」,「发票抬头写错了」根本没进对话记录,模型看到的「客户最新消息」还是 E3001。真实客户下个月来问发票,Agent 会对着一段银行同步的历史回答。

示范结论:thread_id 的边界应该和「一件事」的边界一致。工单号天然就是这个边界;没有工单概念的在线聊天产品,通常用「会话 ID」,规则是闲置 30 分钟或者用户点「新对话」就换一个。跨会话要记住的东西,放进单独设计的长期记忆(Day 466),而不是让一个 thread 无限长下去。

</details>

验收标准:`uv run pytest tests/test_memory.py` 3 个全过,全部测试仍然通过;你亲手复现过「漏重置 review」和「重新造数后接上旧对话」两个坑;`chat_ticket.py` 能跑三轮,并且中间退出过一次进程,第三轮仍然接得上;三轮花费在 0.1 元以内。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 多轮对话 | 同一件事里来回好几次问答。例:同一张工单里客户追问「重新授权了还是不行」。 |
| turns | SupportState 里新增的对话记录列表,每条 `{"role", "content"}`,用 `operator.add` 追加。 |
| 本轮字段 | 只对当前这一轮有意义、每轮开头要重置的状态字段,如 review、findings、followup。 |
| thread_id | checkpoint 的键,同一个 thread_id 的多次 invoke 共享状态。SupportPilot 用工单号。 |
| PostgresSaver | `langgraph-checkpoint-postgres` 包提供的 checkpointer,把快照存进 Postgres。 |
| 快照(checkpoint) | 某个节点跑完后的完整状态副本,一轮对话大约 8–10 份。 |
| channel_values | 快照里存状态字典的那个键,LangGraph 内部把每个状态字段叫一个 channel。 |
| TRUNCATE | SQL 语句,一次清空整张表,比 DELETE 快,不逐行处理。 |
| spy | 一种测试替身,照常干活的同时记下自己被怎么调用。例:第四步的 Spy 记下了 draft 的提示词。 |
| Lost in the Middle | 2023 年的一篇论文,发现长上下文中间的信息最容易被模型忽略,所以最新消息放最后。 |
| argparse | Python 标准库的命令行参数解析,`nargs="?"` 表示位置参数可选。 |

## 常见误区

**以为 checkpointer 就是记忆的全部。** checkpointer 只负责把状态存下来、读回去。状态里要有对话记录(turns)、每轮要把新消息追加进去、给模型的文本要带上历史,这三件事都得自己做。没有 turns,存档存得再好,模型也看不到上一轮说了什么。

**turns 不挂 reducer。** 练习 1 实测:没有 `operator.add`,第二轮传进来的一条消息会把整个记录覆盖掉,最后只剩一条。

**每轮不清理上一轮的临时字段。** 第四步实测:漏掉 review,第二轮草稿被要求「改正上一版的问题:金额没有依据」;漏掉 followup,客户说声谢谢就又收到一遍「退款已审核通过」。哪些跨轮保留、哪些每轮重置,列一张表,写在 load_customer 一处。

**断言写得太宽,把正确的代码判错。** 练习 2 里我第一版断言「审核通过」不在第二轮回复里,结果正常代码也挂了,因为草稿本身就有「审核通过后会原路退回」。断言要挑只有那个功能才会产生的字符串,这里是「已审核通过」。

**用会重复的编号当 thread_id。** 第七步实测:重新造数后工单号从头编,新工单接上了同号旧工单的 6 条对话,新正文一个字都没进记录。本地造数前先 `reset_checkpoints()`;生产上 thread_id 必须永不重复。

**thread_id 用客户 ID。** 练习 4 实测:同一个客户的第二张工单完全被第一张的历史淹没。一个 thread 对应一件事。

**以为 Postgres 存档不用管。** 三轮对话就 26 份快照,每份是完整状态。上线前想好清理策略(关闭的工单保留多久、是否只留最后一份),也要想好客户要求删除数据时这几张表怎么删。

**类型检查报 `Connection[TupleRow]` 不能赋给 `Connection[DictRow]`。** 用 `psycopg.connect(..., row_factory=dict_row)` 运行时没问题,但 basedpyright 推不出行类型。写成 `psycopg.Connection[DictRow].connect(...)` 就好了。

## 学习资料

### 文档与文章

- [LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence):checkpoint、thread、get_state、get_state_history 的官方概念文档,看 Threads 和 Checkpoints 两节,25 分钟。
- [LangGraph Add memory](https://docs.langchain.com/oss/python/langgraph/add-memory):官方 how-to,里面有 PostgresSaver 的完整用法(包括为什么要 autocommit 和 dict_row),今天第五步就是照它写的。
- [LangGraph Memory 概念](https://docs.langchain.com/oss/python/langgraph/memory):短期记忆和长期记忆在 LangGraph 里分别对应什么,为接下来两天打底。
- [Lost in the Middle: How Language Models Use Long Contexts](https://arxiv.org/abs/2307.03172):论文原文,看摘要和第一张图(U 形曲线)就够,10 分钟。
- [psycopg 3 基本用法](https://www.psycopg.org/psycopg3/docs/basic/usage.html):连接、autocommit、row factory 的官方说明,第五步那几个参数在这里都有解释。

### B 站视频

- 强哥学编程《最新 Langchain1.0 入门【17】langgraph 状态管理器 checkpointer 详细解析》:上面嵌入的那个。
- 清华姜学长《AI根本无记忆!一条视频搞懂 大模型上下文窗口!》:10 分钟,用很直白的方式讲为什么模型没有记忆、记忆全靠每次把历史塞回去,适合对着 Day 129 再复习一遍。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1cuMJztEcL&autoplay=0&high_quality=1" title="AI根本无记忆!一条视频搞懂 大模型上下文窗口!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>清华姜学长 · AI根本无记忆!一条视频搞懂 大模型上下文窗口! · 10 分钟,讲清楚「记忆」其实是每次把历史重新发给模型,今天的 _ticket_text 做的就是这件事。</figcaption>
</figure>

### 其他经典视频

- LangChain《Memory for agents (conceptual video)》:上面嵌入的那个。
- IBM Technology《The Four Types of Memory Every AI Agent Needs》:把记忆分成四类讲,和今天开头那张图的「三个问题」对照着看,能看出分法不同、要解决的问题一样。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/BacJ6sEhqMo" title="The Four Types of Memory Every AI Agent Needs" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>IBM Technology · The Four Types of Memory Every AI Agent Needs · 英文,开字幕看。今天做的工单内对话状态属于里面的短期(工作)记忆。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 6 章讲 Agents 的部分有一节专门讲 memory,区分了模型内部知识、短期记忆和长期记忆,还讨论了记忆的存储和检索策略,读这一节约 30 分钟。

### 开源项目与代码

- [langgraph/libs/checkpoint-postgres](https://github.com/langchain-ai/langgraph/tree/main/libs/checkpoint-postgres):PostgresSaver 的源码,看 `setup()` 里的建表语句,就知道那四张表各存什么、为什么 blobs 要单独一张。
- [langgraph-checkpoint-postgres(PyPI)](https://pypi.org/project/langgraph-checkpoint-postgres/):版本历史和安装说明,升级前先看这里的发布记录。

## 自测

1. 同一张工单的第二轮,外面只传了 `{"turns": [新的一条]}`,为什么 ticket、customer 这些字段还在?

<details><summary>答案</summary>

因为有 checkpointer 且 thread_id 相同。LangGraph 会先从存档里读出上一轮结束时的完整状态,再把这次的输入按 reducer 合并进去(turns 追加,其他字段没传就保持原样),然后从 START 重新跑一遍图。所以 ticket 来自存档,customer 则在 load_customer 里被重新查了一次。

</details>

2. 为什么「客户最新消息」要单独一行放在最后,而不是和历史平铺在一起?

<details><summary>答案</summary>

一是明确告诉模型这一轮要回答的是哪一句,平铺时模型有时会去回答第一轮的问题;二是长上下文里开头和结尾的信息最容易被模型利用,中间的最容易被忽略(Lost in the Middle)。

</details>

3. load_customer 每轮重置的字段,判断标准是什么?举一个漏重置会出错的例子。

<details><summary>答案</summary>

标准是:这个字段只对本轮有意义,而且在本轮被重新写之前有可能被读到。例:review 漏重置,第二轮 draft 会读到上一轮的「质检退回」,模型被要求去改一个客户没见过的错误;followup 漏重置,第二轮回复末尾会再贴一遍上一轮的「退款已审核通过」。

</details>

4. 面试题:你的客服 Agent 怎么做多轮对话?状态存在哪?进程重启怎么办?

<details><summary>答案</summary>

示范回答:我用 LangGraph 的 checkpointer,thread_id 用工单号,一张工单一个 thread。状态里有一个用 `operator.add` 追加的 turns 对话记录,第一轮把工单正文放进去,每次发回复时把回复追加进去,客户追问时只传新的一条。给模型的上下文是基本信息、历史对话、客户最新消息三段,最新消息放最后。每轮开头重置质检结果、调查结论、审批补充这些本轮字段,避免上一轮的结论污染这一轮。存档用 PostgresSaver,和业务库同一个 Postgres,进程重启、审批隔天才点都能接着跑,实测三轮对话中间重启过进程,第三轮能准确复述前面聊到哪。另外注意 thread_id 必须永不重复,我在本地重新造数时踩过工单号重用、新工单接上旧对话的坑。

</details>

5. 为什么 thread_id 用工单号而不是客户 ID?

<details><summary>答案</summary>

工单是「一件事」,有开始有结束,状态边界清楚。用客户 ID 的话,同一个客户不相干的几件事会挤进一个对话,前一件的历史会干扰后一件,对话还会无限变长。练习 4 实测:第二张工单的正文根本没进对话记录。跨工单要记住的信息交给客户画像这种长期记忆。

</details>

## 明天预告

明天是 Day 465,记忆(二):对话太长时压缩。今天的三轮对话,每轮花费已经从 0.005 涨到 0.02 多,因为每一轮都把全部历史重新发给模型,而且历史里还带着参考文章链接。总有客户来回聊十几轮,不处理的话越聊越贵,模型也越容易在一大段历史里迷路。明天在 load_customer 和 classify 之间加一个 prepare_context 节点,超过 token 预算时把早期轮次压成一段摘要,最近几轮原样保留,今天写的 `render_turns` 会派上用场。
