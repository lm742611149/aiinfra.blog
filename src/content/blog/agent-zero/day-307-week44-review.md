---
title: 'Day 307 · 第 44 周复习:MCP 与编排(Day 301–306)'
description: '这一周把 LangGraph 的图从两个节点串起来一路学到并行和条件边:stream、三种状态写法、覆盖、reducer、扇出扇入、path_map。今天画知识地图,每天一句话回顾,做一个只用本周知识的工单分诊图(41 张工单,账单走并行查证再汇合,其余走模板),再故意改坏三处,看到有一处没被发现;最后默写核心代码、找四个藏起来的错误。'
pubDate: 2026-10-27
regime: none
tags: ['review', 'langgraph', 'parallel', 'conditional-edges', 'reducer', 'python', 'agent-zero']
series: 'agent-zero'
day: 307
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 306](/blog/agent-zero/day-306-lg-conditional/) 学了条件边:`add_conditional_edges(来源, 路由函数, path_map)`,路由函数读状态返回下一站、不改状态;`path_map` 可以是字典、列表或不传,不传又拼错名字时图悄悄结束;返回值不在 `path_map` 里是运行时 `KeyError`,`path_map` 指向不存在的节点是 `compile()` 时的 `ValueError`;路由函数可以返回 `END` 或列表。

今天是第 44 周的最后一天。这一周的六天可以串成一条线:两个节点怎么共享状态,状态怎么写,不配规则为什么被覆盖,配了规则怎么累积,多个节点怎么同时跑,边怎么按状态选路。今天把这六样全装进一张图,做一个工单分诊。依旧不调模型,花费 ¥0。

## 今天要解决的问题

1. 能对着一张图说出本周六天各解决了什么,并说出每天最该记住的一两个数字或现象。
2. 做出小项目 `part05/review44_triage.py`:一张分诊图,41 张工单分成账单(并行查客户和发票再汇合)和其余(模板回复),每张工单的 `trace` 里能看出经过了哪些节点;再故意改坏三处,说清每处是怎么被发现的,或者为什么没被发现。
3. 合上文章默写一张「分类、条件边、并行汇合」的小图,让两条断言通过。
4. 在一份代码里找出本周讲过的四类错误,并说出每一类的真实现象。

预计用时 3.5 小时。今天不调模型,花费 ¥0。

前置:本周的 [Day 301](/blog/agent-zero/day-301-lg-sequence/) 到 [Day 306](/blog/agent-zero/day-306-lg-conditional/)。要用到 `part05/lg/s01_tickets.py`(`classify_text`、`load_tickets`)、`part05/lg/s04_tickets.py`(`customer_note`、`invoice_note`、`query_one`),以及 Day 280 的 `cloudledger/seed.py`。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。复习日的默写最要紧,练习 1 请真的合上文章写。

所有命令在 `agent-zero-lab/` 根目录跑(我的是 `/Users/你/agent-zero-lab`)。先重置业务库,免得前几天的实验留下数据让数字对不上:

```bash
cd /Users/你/agent-zero-lab
uv run python cloudledger/seed.py
uv run python -m part05.lg.s06_parallel
uv run python -m part05.lg.s07_conditional
```

<div class="line-notes">

- `uv run python cloudledger/seed.py` 删库重建,输出 `已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}`。
- `uv run python -m part05.lg.s06_parallel` 确认 Day 305 的文件还在、能跑:应该看到 `merge 看到: ['INV-0042 已付款', 'kb-003 退款政策']` 和后面的 `InvalidUpdateError`。
- `uv run python -m part05.lg.s07_conditional` 确认 Day 306 的文件还在:应该看到三条工单分别转账单组、走退款审批、转人工。

</div>

## 本周知识地图

<figure>
<svg viewBox="0 0 640 290" role="img" aria-label="第 44 周知识地图:左列状态,301 两个节点和 stream,302 三种状态写法,303 覆盖规则,304 reducer;右列连线,305 并行和扇入,306 条件边和 path_map;下方是今天的小项目工单分诊图,用到全部六天">
<rect x="0" y="0" width="640" height="290" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="22" fill="var(--ink-soft)">状态怎么写、怎么合并</text>
<text x="360" y="22" fill="var(--ink-soft)">节点怎么连</text>
<rect x="20" y="30" width="300" height="38" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="170" y="53" fill="var(--ink)" text-anchor="middle">302 TypedDict / dataclass / pydantic</text>
<rect x="20" y="76" width="300" height="38" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="170" y="99" fill="var(--ink)" text-anchor="middle">303 不配规则:同键覆盖,不报错</text>
<rect x="20" y="122" width="300" height="38" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="170" y="145" fill="var(--ink)" text-anchor="middle">304 reducer:operator.add / add_messages</text>
<rect x="360" y="30" width="260" height="38" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="490" y="53" fill="var(--ink)" text-anchor="middle">301 两节点串起来 + stream</text>
<rect x="360" y="76" width="260" height="38" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="490" y="99" fill="var(--ink)" text-anchor="middle">305 并行扇出 + 列表扇入</text>
<rect x="360" y="122" width="260" height="38" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="490" y="145" fill="var(--ink)" text-anchor="middle">306 条件边 + path_map</text>
<line x1="170" y1="160" x2="170" y2="196" stroke="var(--ink-soft)"/>
<line x1="490" y1="160" x2="490" y2="196" stroke="var(--ink-soft)"/>
<rect x="20" y="196" width="600" height="70" rx="6" fill="none" stroke="var(--rule)"/>
<text x="320" y="220" fill="var(--ink)" text-anchor="middle">今天的小项目:工单分诊图 review44_triage.py</text>
<text x="320" y="240" fill="var(--ink-soft)" text-anchor="middle" font-size="11">classify → 条件边 → 账单:并行查客户和发票 → 汇合;其余:模板回复或转人工</text>
<text x="320" y="256" fill="var(--ink-faint)" text-anchor="middle" font-size="11">notes 和 trace 都要 reducer(并行写入),状态用 TypedDict</text>
</g>
</svg>
<figcaption>左列是状态那一侧(怎么写、不配规则会怎样、配了怎么合并),右列是连线那一侧(串起来、并行、按条件选路)。小项目要同时用到两侧。</figcaption>
</figure>

## 本周每天一句话

- [Day 301](/blog/agent-zero/day-301-lg-sequence/):两个节点通过共享的状态传数据,不是互相传参;`add_sequence` 帮你连中间的线,入口和出口要自己连;`stream_mode="updates"` 每个节点跑完产出 `{节点名: 更新}`;顺序写反图不报错,只是第二个节点读不到字段。
- [Day 302](/blog/agent-zero/day-302-lg-state-styles/):状态可以用 TypedDict(节点收字典)、dataclass 或 pydantic(节点收对象);三种返回的都是字典;TypedDict 和 dataclass 的类型标注运行时不检查,pydantic 的校验发生在下一个节点读状态时。
- [Day 303](/blog/agent-zero/day-303-lg-overwrite/):字段没配规则时,节点返回什么字段就变成什么,旧值被覆盖不报错;返回 `{}`、`None`、拼错的键都不改状态,返回列表抛 `InvalidUpdateError`;手动「读旧值、拼新的」串行勉强行,并行直接报错。
- [Day 304](/blog/agent-zero/day-304-lg-reducer/):`Annotated[list[str], operator.add]` 让节点只返回新增的;配了 reducer 的字段从空值起步、初始输入也会走 reducer;清空要用 `Overwrite`;`add_messages` 能按 id 替换。
- [Day 305](/blog/agent-zero/day-305-lg-parallel/):START 连两条边是扇出,`add_edge([a, b], c)` 是扇入;并行写同一个键必须有 reducer;三个各睡 0.3 秒的节点并行只要 0.31 秒;同一步看不到彼此的写入;合并顺序是节点名字母序;扇入写成两条单独的边,分支长度不同时汇合节点跑两次。
- [Day 306](/blog/agent-zero/day-306-lg-conditional/):条件边由路由函数返回下一站,`path_map` 翻译;路由函数不改状态;不传 `path_map` 又拼错名字时图悄悄结束;`path_map` 指向不存在的节点在 `compile()` 时就报错。

## 本周小项目:工单分诊图

需求:41 张工单进来,先分类(Day 299 的规则表)。账单类并行查客户和未付发票,汇合后给一句回复;订阅、技术、账号三类用模板回复;其他转人工。要求每张工单的 `trace` 字段记下经过的节点,`notes` 记查到的东西。

设计时先想好三件事,它们对应本周三个坑。第一,`notes` 和 `trace` 都会被并行的两个节点同时写,所以都要 reducer(Day 304、305)。第二,账单路由要一次去两个节点,路由函数返回列表(Day 306);汇合用列表写法的 `add_edge`(Day 305)。第三,`subscription`、`technical`、`account` 三个值指向同一个节点,用 `path_map` 的多对一(Day 306)。

```python
# agent-zero-lab/part05/review44_triage.py
"""第 44 周小项目:工单分诊图。classify → 条件边 → 账单走并行查证再汇合,其余走模板或转人工。
只用本周的东西:add_sequence、stream、TypedDict、reducer、并行扇入、条件边+path_map。
用法:uv run python -m part05.review44_triage"""
import operator
from collections import Counter
from typing import Annotated, Any, Literal, NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph

from part05.lg.s01_tickets import classify_text, load_tickets
from part05.lg.s04_tickets import customer_note, invoice_note

Category = Literal["billing", "subscription", "technical", "account", "other"]
TEMPLATES = {
    "subscription": "客户成功同事联系确认订阅变更",
    "technical": "转工程师排查",
    "account": "走账号找回流程",
}


class State(TypedDict):
    ticket_id: str
    ticket: str
    category: NotRequired[Category]
    notes: Annotated[list[str], operator.add]
    trace: Annotated[list[str], operator.add]
    reply: NotRequired[str]


def classify(state: State) -> dict:
    return {"category": classify_text(state["ticket"]), "trace": ["classify"]}


def look_customer(state: State) -> dict:
    return {"notes": [customer_note(state["ticket_id"])], "trace": ["look_customer"]}


def look_invoices(state: State) -> dict:
    return {"notes": [invoice_note(state["ticket_id"])], "trace": ["look_invoices"]}


def compose_billing(state: State) -> dict:
    return {"reply": "账单组跟进。" + ";".join(sorted(state["notes"])), "trace": ["compose_billing"]}


def reply_template(state: State) -> dict:
    return {"reply": TEMPLATES.get(state.get("category", "other"), "转人工"), "trace": ["reply_template"]}


def human(state: State) -> dict:
    return {"reply": "转人工", "trace": ["human"]}


def route(state: State) -> list[str] | str:
    category = state.get("category", "other")
    if category == "billing":
        return ["look_customer", "look_invoices"]
    return category


class StateNoReducer(TypedDict):
    """和 State 一样,只是 trace 不配 reducer。给「故意改坏」用。"""

    ticket_id: str
    ticket: str
    category: NotRequired[Category]
    notes: Annotated[list[str], operator.add]
    trace: list[str]
    reply: NotRequired[str]


def build(schema: type = State, list_join: bool = True, typo: bool = False):
    b = StateGraph(schema)
    for fn in (classify, look_customer, look_invoices, compose_billing, reply_template, human):
        b.add_node(fn.__name__, fn)
    b.add_edge(START, "classify")
    b.add_conditional_edges(
        "classify",
        route,
        {
            "look_customer": "look_customer",
            "look_invoices": "look_invoice" if typo else "look_invoices",
            "subscription": "reply_template",
            "technical": "reply_template",
            "account": "reply_template",
            "other": "human",
        },
    )
    if list_join:
        b.add_edge(["look_customer", "look_invoices"], "compose_billing")
    else:
        b.add_edge("look_customer", "compose_billing")
        b.add_edge("look_invoices", "compose_billing")
    for name in ("compose_billing", "reply_template", "human"):
        b.add_edge(name, END)
    return b.compile()


graph = build()


def run(ticket_id: str, text: str, g: Any = graph) -> dict[str, Any]:
    return g.invoke({"ticket_id": ticket_id, "ticket": text, "notes": [], "trace": []})


if __name__ == "__main__":
    tickets = load_tickets()
    results = [run(i, t) for i, t in tickets]
    print("类别分布:", dict(Counter(r["category"] for r in results if "category" in r)))
    print("走过的路径:", dict(Counter(tuple(r["trace"]) for r in results)))
    assert all(len(r["notes"]) == (2 if r["category"] == "billing" else 0) for r in results)
    assert all(r["trace"][0] == "classify" for r in results)
    print("T1001:", results[0]["category"], results[0]["trace"], results[0]["reply"])
    first_billing = next(r for r in results if r["category"] == "billing")
    print(first_billing["ticket_id"], first_billing["reply"])
```

<div class="line-notes">

- `from part05.lg.s01_tickets import classify_text, load_tickets` Day 299 的规则分类函数和读库函数。
- `from part05.lg.s04_tickets import customer_note, invoice_note` Day 303 的两个查库函数。
- `TEMPLATES = {` 三类用模板回复的工单,类别到回复文字的表。
- `class State(TypedDict):` 状态用 TypedDict(Day 302)。
- `category: NotRequired[Category]` 进图时没有,`classify` 写进来。
- `notes: Annotated[list[str], operator.add]` 查到的东西,账单分支的两个并行节点都写,所以配 `operator.add`(Day 304、305)。
- `trace: Annotated[list[str], operator.add]` 每个节点把自己的名字写进来。同样会被并行节点同时写,所以也要 reducer。
- `return {"category": classify_text(state["ticket"]), "trace": ["classify"]}` `classify` 一次返回两个字段:类别和自己的足迹。
- `return {"notes": [customer_note(state["ticket_id"])], "trace": ["look_customer"]}` 查客户节点,只返回自己这一步新增的。
- `return {"notes": [invoice_note(state["ticket_id"])], "trace": ["look_invoices"]}` 查发票节点。它和上一个节点同一步一起跑,都写 `notes` 和 `trace`。
- `return {"reply": "账单组跟进。" + ";".join(sorted(state["notes"])), "trace": ["compose_billing"]}` 汇合节点读两条 `notes`,先排序再拼。排序是为了不依赖并行写入的合并顺序(Day 305)。
- `return {"reply": TEMPLATES.get(state.get("category", "other"), "转人工"), "trace": ["reply_template"]}` 模板节点:按类别查回复,查不到当转人工。
- `if category == "billing":` 路由函数里只有账单特殊。
- `return ["look_customer", "look_invoices"]` 账单返回列表:两个查证节点同一步一起跑(Day 306 第 4 步)。
- `return category` 其他类别直接返回类别名,由 `path_map` 翻译。
- `class StateNoReducer(TypedDict):` 一份故意少了 `trace` reducer 的状态,下面「故意改坏」时用。正常流程用不到。
- `def build(schema: type = State, list_join: bool = True, typo: bool = False):` 建图函数带三个开关,改坏时一个个打开。默认值是正确的版本。
- `b.add_conditional_edges(` 建条件边,从 `classify` 出发。
- `"subscription": "reply_template",` 多对一:三个类别指向同一个节点。
- `"other": "human",` `other` 翻译成 `human`,Day 306 的老写法。
- `b.add_edge(["look_customer", "look_invoices"], "compose_billing")` 列表写法的扇入(`list_join` 为真时)。
- `b.add_edge("look_customer", "compose_billing")` `list_join` 为假时的写法,两条单独的边,「故意改坏」第二处用。
- `def run(ticket_id: str, text: str, g: Any = graph) -> dict[str, Any]:` 跑一张工单的包装,初始状态里 `notes`、`trace` 给空列表。
- `print("走过的路径:", dict(Counter(tuple(r["trace"]) for r in results)))` 数一数有几种不同的路径、各有几张。列表不能当字典的键,所以先转元组。
- `assert all(len(r["notes"]) == (2 if r["category"] == "billing" else 0) for r in results)` 断言:账单类每张 2 条 `notes`,其他类 0 条。
- `assert all(r["trace"][0] == "classify" for r in results)` 断言:每张工单的第一步都是 `classify`。

</div>

```bash
uv run python -m part05.review44_triage
```

```text
类别分布: {'technical': 6, 'subscription': 8, 'billing': 18, 'account': 9}
走过的路径: {('classify', 'reply_template'): 23, ('classify', 'look_customer', 'look_invoices', 'compose_billing'): 18}
T1001: technical ['classify', 'reply_template'] 转工程师排查
T1007 账单组跟进。客户:鹿鸣影视二店;未付发票:0 张
```

类别分布和 Day 299、Day 306 一致:账单 18、订阅 8、技术 6、账号 9。路径只有两种:23 张工单走 `classify → reply_template`,18 张账单走 `classify → look_customer → look_invoices → compose_billing`,两条断言通过。T1007 是第一张账单工单,回复里带着客户名和未付发票数。注意账单路径里 `look_customer` 在 `look_invoices` 前,是字母序,不是谁先完成(Day 305 实测)。

### 故意改坏三处

和上周一样,做完要确认**测试(或报错)能抓到毛病**。三处:一,`trace` 不配 reducer;二,扇入写成两条单独的边;三,`path_map` 里写错一个节点名。

```python
# agent-zero-lab/part05/review44_break.py
"""故意改坏小项目三处,看每一处是怎么暴露的。
用法:uv run python -m part05.review44_break"""
from part05.lg.s01_tickets import load_tickets
from part05.review44_triage import State, StateNoReducer, build, run

ticket_id, text = next((i, t) for i, t in load_tickets() if i == "T1007")  # 账单类

print("1 trace 不配 reducer(并行的两个节点都写 trace)")
try:
    run(ticket_id, text, build(schema=StateNoReducer))
except Exception as e:
    print("  ", type(e).__name__, "|", str(e).splitlines()[0])

print("2 扇入写成两条单独的边")
out = run(ticket_id, text, build(list_join=False))
print("   trace:", out["trace"])

print("3 path_map 里写错一个节点名")
try:
    build(typo=True)
except Exception as e:
    print("  ", type(e).__name__, "|", str(e).splitlines()[0])
```

<div class="line-notes">

- `from part05.review44_triage import State, StateNoReducer, build, run` 复用小项目的建图函数和运行包装。`State` 这里没用到,下一行会演示 `build` 的默认参数就是它。
- `ticket_id, text = next((i, t) for i, t in load_tickets() if i == "T1007")` 取第一张账单工单 T1007。
- `run(ticket_id, text, build(schema=StateNoReducer))` 第一处:换成 `trace` 没配 reducer 的状态。
- `print("  ", type(e).__name__, "|", str(e).splitlines()[0])` 打异常类型和第一行。
- `out = run(ticket_id, text, build(list_join=False))` 第二处:两条单独的边。
- `print("   trace:", out["trace"])` 看 `compose_billing` 出现了几次。
- `build(typo=True)` 第三处:`path_map` 里把 `look_invoices` 写成 `look_invoice`。这一处不需要运行,只建图。

</div>

```bash
uv run python -m part05.review44_break
```

```text
1 trace 不配 reducer(并行的两个节点都写 trace)
   ValueError | Channel 'trace' already exists with a different type
2 扇入写成两条单独的边
   trace: ['classify', 'look_customer', 'look_invoices', 'compose_billing']
3 path_map 里写错一个节点名
   ValueError | At 'classify' node, 'route' branch found unknown target 'look_invoice'
```

逐个看:

**第一处**,报的是 `ValueError: Channel 'trace' already exists with a different type`,不是 Day 305 的 `InvalidUpdateError`。原因我的判断是:节点函数的参数标注写的是 `state: State`,而 `State` 里的 `trace` 带 reducer,和新状态里同名的字段类型不同,框架在**建图**时就发现冲突了。我没有读源码确认这一点。真正想复现「并行写同一个键没 reducer」那个 `InvalidUpdateError`,看 Day 305 的 `s06_parallel.py`。这里学到的是:节点的类型标注也参与状态的定义,标注和图的状态不一致会在建图时报错,不是摆设。

**第二处没有被抓到**。`trace` 里 `compose_billing` 只出现一次,和正确版本一模一样。原因是 Day 305 第 5 步讲过的:两条分支一样长(都是一步)时,两个来源在同一步完成,单独的边也只触发一次。这次改坏**对这个图没有可观察的后果**,但只要以后有人给其中一条分支加一个节点,`compose_billing` 就会悄悄跑两次。要让测试抓得到,得有一个分支长度不同的场景,或者专门断言「`compose_billing` 在 `trace` 里恰好出现一次」(练习里没做,留给你)。

**第三处**在 `compile()` 时抛 `ValueError: At 'classify' node, 'route' branch found unknown target 'look_invoice'`,第一时间就抓到了,没跑工单。这是三处里最好的一个。

三处结果是:一处在建图时报(不是我预想的错),一处没抓到,一处在 `compile()` 时抓到。**改坏实验的价值就在于它常常和你以为的不一样。**

## 本周错题与坑清单

这一周踩过的、最容易再踩的,按「现象 → 原因 → 怎么办」列:

1. **两个节点往同一个列表字段写,最后只剩一条,不报错。**(Day 303)字段没配 reducer,新值覆盖旧值。给字段配 `Annotated[list[str], operator.add]`,节点只返回新增的。
2. **并行节点写同一个键,报 `Can receive only one value per step`。**(Day 305)同一步里同一个键收到多个值又没有合并规则。配 reducer。写不同的键不会报。
3. **节点返回 `{}`、`None`、拼错的键,状态不变也不报错。**(Day 303)返回列表才报 `InvalidUpdateError: Expected dict, got [...]`。
4. **配了 `operator.add` 却想清空列表,返回 `[]` 清不掉。**(Day 304)合并是 `旧 + []`。用 `Overwrite([])`。
5. **用点号读 TypedDict,或用方括号读 dataclass。**(Day 302)前者 `AttributeError`,后者 `TypeError`,换状态写法要改每一处读取。
6. **扇入写成两条单独的边。**(Day 305)分支长度不同时汇合节点跑两次。用 `add_edge([a, b], c)`。
7. **条件边不传 `path_map` 又拼错节点名。**(Day 306)图悄悄结束,只有一行日志。总是传 `path_map`,或把返回类型标成 `Literal`。
8. **在路由函数里改状态。**(Day 306)不生效。要同时改状态和选路,等 Day 309 的 `Command`。
9. **依赖并行节点的合并顺序。**(Day 305)实测按节点名字母序,官方没承诺。对顺序敏感的结果用不同字段,或在汇合节点里排序。
10. **没被真数据走到的分支没测过。**(Day 306)41 张工单没有一张走到 `human`,要手工造数据。

## 动手练习

### 练习 1:默写(最重要)

**合上文章**,在 `part05/` 里新建一个文件,凭记忆写出这张图:状态有 `text`、`kind`、`facts`(要 reducer)、`reply`。`classify` 含「发票」的写 `billing`,否则 `other`。账单走并行的 `look_a`、`look_b`(各写一条 `facts`),汇合到 `join` 拼出回复;其他走 `simple` 回「转人工」。写完让两条断言通过:「发票开错了」的回复是 `账单:a 查到了,b 查到了`,「怎么改密码」的回复是 `转人工` 且 `facts` 为空。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/ex307_dictation.py
"""练习 1 的参考答案:默写本周核心。分类 → 条件边 → 一路并行查证再汇合、一路直接回复。
用法:uv run python -m part05.ex307_dictation"""
import operator
from typing import Annotated, NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    text: str
    kind: NotRequired[str]
    facts: Annotated[list[str], operator.add]
    reply: NotRequired[str]


def classify(state: State) -> dict:
    return {"kind": "billing" if "发票" in state["text"] else "other"}


def look_a(state: State) -> dict:
    return {"facts": ["a 查到了"]}


def look_b(state: State) -> dict:
    return {"facts": ["b 查到了"]}


def join(state: State) -> dict:
    return {"reply": "账单:" + ",".join(state["facts"])}


def simple(state: State) -> dict:
    return {"reply": "转人工"}


def route(state: State) -> list[str]:
    return ["look_a", "look_b"] if state.get("kind") == "billing" else ["simple"]


b = StateGraph(State)
for fn in (classify, look_a, look_b, join, simple):
    b.add_node(fn.__name__, fn)
b.add_edge(START, "classify")
b.add_conditional_edges("classify", route, ["look_a", "look_b", "simple"])
b.add_edge(["look_a", "look_b"], "join")
b.add_edge("join", END)
b.add_edge("simple", END)
graph = b.compile()

if __name__ == "__main__":
    r1 = graph.invoke({"text": "发票开错了", "facts": []})
    r2 = graph.invoke({"text": "怎么改密码", "facts": []})
    assert r1["reply"] == "账单:a 查到了,b 查到了", r1
    assert r2["reply"] == "转人工" and r2["facts"] == [], r2
    print("两条断言通过")
    print(r1)
    print(r2)
```

<div class="line-notes">

- `kind: NotRequired[str]` 进图时没有,`classify` 写进来。`reply` 同理,用 `NotRequired` 让编辑器知道进图时可以不给。
- `facts: Annotated[list[str], operator.add]` 两个并行节点都写它,必须有 reducer。
- `return {"kind": "billing" if "发票" in state["text"] else "other"}` 含「发票」写 `billing`,否则 `other`。
- `return {"reply": "账单:" + ",".join(state["facts"])}` 汇合节点读 `facts` 拼成回复。代入两条 `facts`:`账单:a 查到了,b 查到了`。
- `return ["look_a", "look_b"] if state.get("kind") == "billing" else ["simple"]` 路由函数返回列表:账单一次去两个节点,其他只去一个。
- `b.add_conditional_edges("classify", route, ["look_a", "look_b", "simple"])` 第三个参数用列表,列出所有可能的去处。
- `b.add_edge(["look_a", "look_b"], "join")` 列表写法的扇入。
- `b.add_edge("simple", END)` `simple` 直接到 END,不经过 `join`。
- `r1 = graph.invoke({"text": "发票开错了", "facts": []})` 初始状态里 `facts` 给空列表。
- `assert r2["reply"] == "转人工" and r2["facts"] == [], r2` 非账单工单没有查证,`facts` 仍是空。断言失败时会打印 `r2`。

</div>

```text
两条断言通过
{'text': '发票开错了', 'kind': 'billing', 'facts': ['a 查到了', 'b 查到了'], 'reply': '账单:a 查到了,b 查到了'}
{'text': '怎么改密码', 'kind': 'other', 'facts': [], 'reply': '转人工'}
```

两条断言通过,打印出来的第二条里没有 `look_a`、`look_b` 的痕迹,`facts` 是空列表。默写时最容易漏的四处:`facts` 的 reducer、路由返回列表、扇入用列表、`simple` 的出口。

</details>

### 练习 2:找四个藏起来的错误

下面的脚本里有四张图,每张一个错误。先读代码,预测每张图会怎样,再跑。

```python
# agent-zero-lab/part05/ex307_find_bugs.py
"""练习 2:四个藏起来的错误,每个单独成一张图,看各自的症状。
用法:uv run python -m part05.ex307_find_bugs"""
import operator
from typing import Annotated, Any, NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph


class S1(TypedDict):
    notes: list[str]


def n1a(state: S1) -> dict:
    return {"notes": ["a"]}


def n1b(state: S1) -> dict:
    return {"notes": ["b"]}


def bug1() -> Any:
    b = StateGraph(S1)
    b.add_node("n1a", n1a)
    b.add_node("n1b", n1b)
    b.add_edge(START, "n1a")
    b.add_edge(START, "n1b")
    b.add_edge("n1a", END)
    b.add_edge("n1b", END)
    return b.compile().invoke({"notes": []})


class S2(TypedDict):
    log: Annotated[list[str], operator.add]


def step(name: str):
    def fn(state: S2) -> dict:
        return {"log": [name]}
    return fn


def bug2() -> Any:
    b = StateGraph(S2)
    for n in ("fast", "slow1", "slow2", "done"):
        b.add_node(n, step(n))
    b.add_edge(START, "fast")
    b.add_edge(START, "slow1")
    b.add_edge("slow1", "slow2")
    b.add_edge("fast", "done")
    b.add_edge("slow2", "done")
    b.add_edge("done", END)
    return b.compile().invoke({"log": []})


class S3(TypedDict):
    n: int
    out: NotRequired[str]


def small(state: S3) -> dict:
    return {"out": "small"}


def big(state: S3) -> dict:
    return {"out": "big"}


def entry(state: S3) -> dict:
    return {}


def route3(state: S3) -> str:
    return "bigg" if state["n"] > 10 else "small"


def bug3() -> Any:
    b = StateGraph(S3)
    b.add_node("entry", entry)
    b.add_node("small", small)
    b.add_node("big", big)
    b.add_edge(START, "entry")
    b.add_conditional_edges("entry", route3)
    b.add_edge("small", END)
    b.add_edge("big", END)
    return b.compile().invoke({"n": 50})


class S4(TypedDict):
    n: int
    tag: NotRequired[str]
    out: NotRequired[str]


def mark(state: S4) -> dict:
    return {}


def route4(state: S4) -> str:
    state["tag"] = "large" if state["n"] > 10 else "tiny"
    return "show"


def show(state: S4) -> dict:
    return {"out": f"tag={state.get('tag')}"}


def bug4() -> Any:
    b = StateGraph(S4)
    b.add_node("mark", mark)
    b.add_node("show", show)
    b.add_edge(START, "mark")
    b.add_conditional_edges("mark", route4, {"show": "show"})
    b.add_edge("show", END)
    return b.compile().invoke({"n": 50})


if __name__ == "__main__":
    for i, fn in enumerate((bug1, bug2, bug3, bug4), start=1):
        print(f"错误 {i}:")
        try:
            print("  结果:", fn())
        except Exception as e:
            print("  ", type(e).__name__, "|", str(e).splitlines()[0])
```

<div class="line-notes">

- `class S1(TypedDict):` 第一张图:`notes` 没配 reducer。
- `b.add_edge(START, "n1b")` 两个节点从 START 并行出发,都写 `notes`。
- `class S2(TypedDict):` 第二张图:`log` 配了 `operator.add`。
- `b.add_edge("slow1", "slow2")` 一条分支两步(`slow1`、`slow2`),另一条一步(`fast`)。
- `b.add_edge("fast", "done")` 汇合用两条单独的边,不是列表。
- `def route3(state: S3) -> str:` 第三张图的路由函数。
- `return "bigg" if state["n"] > 10 else "small"` 拼错的名字 `bigg`,不存在这个节点。
- `b.add_conditional_edges("entry", route3)` 没有 `path_map`,返回类型也只是 `str`。
- `def route4(state: S4) -> str:` 第四张图的路由函数。
- `state["tag"] = "large" if state["n"] > 10 else "tiny"` 在路由函数里改状态。

</div>

<details><summary>参考答案</summary>

```text
Task entry with path ('__pregel_pull', 'entry') wrote to unknown channel branch:to:bigg, ignoring it.
错误 1:
   InvalidUpdateError | At key 'notes': Can receive only one value per step. Use an Annotated key to handle multiple values.
错误 2:
  结果: {'log': ['fast', 'slow1', 'done', 'slow2', 'done']}
错误 3:
  结果: {'n': 50}
错误 4:
  结果: {'n': 50, 'out': 'tag=None'}
```

四个错误,四种现象:

1. **并行写同一个键没 reducer**:抛 `InvalidUpdateError: At key 'notes': Can receive only one value per step.` 修法:`notes: Annotated[list[str], operator.add]`。
2. **扇入写成两条单独的边**:不报错,`log` 里 `done` 出现了两次,`['fast', 'slow1', 'done', 'slow2', 'done']`。修法:`b.add_edge(["fast", "slow2"], "done")`。
3. **路由返回拼错的名字、没有 `path_map`**:不报错,结果里只有 `{'n': 50}`,既没有 `big` 也没有 `small` 的输出;只在 stderr 的日志里打了一行 `wrote to unknown channel branch:to:bigg, ignoring it.`(输出最前面那一行)。修法:传 `path_map` 或用 `Literal` 标返回类型。
4. **路由函数里改状态**:不报错,`out` 是 `tag=None`,改动没生效。修法:把 `tag` 的计算放进节点 `mark` 里返回。

</details>

### 练习 3:紧急优先

给分诊图加一条规则:含「急」「马上」「立刻」的工单,不管什么类别都转人工。不要改 `review44_triage.py`,新建一个文件复用里面的节点,只替换路由函数。对 41 张工单跑一遍,说出路径分布。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/ex307_urgent_triage.py
"""练习 3:给分诊图加紧急优先:含「急/马上/立刻」的工单直接转人工,并让 trace 里能看出来。
用法:uv run python -m part05.ex307_urgent_triage"""
from collections import Counter
from typing import Any

from langgraph.graph import END, START, StateGraph

from part05.lg.s01_tickets import load_tickets
from part05.review44_triage import (
    State,
    classify,
    compose_billing,
    human,
    look_customer,
    look_invoices,
    reply_template,
)

URGENT_WORDS = ("急", "马上", "立刻")


def route(state: State) -> list[str] | str:
    if any(w in state["ticket"] for w in URGENT_WORDS):
        return "other"
    category = state.get("category", "other")
    if category == "billing":
        return ["look_customer", "look_invoices"]
    return category


def build() -> Any:
    b = StateGraph(State)
    for fn in (classify, look_customer, look_invoices, compose_billing, reply_template, human):
        b.add_node(fn.__name__, fn)
    b.add_edge(START, "classify")
    b.add_conditional_edges(
        "classify",
        route,
        {
            "look_customer": "look_customer",
            "look_invoices": "look_invoices",
            "subscription": "reply_template",
            "technical": "reply_template",
            "account": "reply_template",
            "other": "human",
        },
    )
    b.add_edge(["look_customer", "look_invoices"], "compose_billing")
    for name in ("compose_billing", "reply_template", "human"):
        b.add_edge(name, END)
    return b.compile()


if __name__ == "__main__":
    g = build()
    results = [g.invoke({"ticket_id": i, "ticket": t, "notes": [], "trace": []}) for i, t in load_tickets()]
    print("走过的路径:", dict(Counter(tuple(r["trace"]) for r in results)))
```

<div class="line-notes">

- `from part05.review44_triage import (` 把小项目里的状态和六个节点函数都导入,不复制。
- `URGENT_WORDS = ("急", "马上", "立刻")` 紧急关键词。
- `if any(w in state["ticket"] for w in URGENT_WORDS):` 路由函数先看有没有紧急词。
- `return "other"` 紧急的直接返回 `other`,`path_map` 把它翻译成 `human`。
- `if category == "billing":` 不紧急再按类别走,账单仍然返回列表。
- `def build() -> Any:` 重新建一张图,和小项目的 `build` 几乎一样,只有路由函数不同。
- `b.add_conditional_edges(` 同样的 `path_map`,不需要新增条目:紧急走的是已有的 `other → human`。
- `print("走过的路径:", dict(Counter(tuple(r["trace"]) for r in results)))` 数路径分布。

</div>

```text
走过的路径: {('classify', 'reply_template'): 14, ('classify', 'look_customer', 'look_invoices', 'compose_billing'): 18, ('classify', 'human'): 9}
```

9 张紧急工单(都是原来的账号类)变成 `classify → human`,模板路径从 23 张变成 14 张,账单路径 18 张不变。

</details>

### 练习 4:用 stream 看并行

用 `stream(stream_mode="updates")` 处理 T1007(账单)和 T1001(技术),打印每个块里节点名和它更新了哪些字段。回答:账单工单的 `look_customer` 和 `look_invoices` 在同一个块里还是不同的块?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/ex307_stream_triage.py
"""练习 4:用 stream 看分诊图处理 T1007(账单)和 T1001(技术)各经过哪些块。
用法:uv run python -m part05.ex307_stream_triage"""
from part05.lg.s01_tickets import load_tickets
from part05.review44_triage import graph

if __name__ == "__main__":
    tickets = dict(load_tickets())
    for ticket_id in ("T1007", "T1001"):
        print(ticket_id)
        init = {"ticket_id": ticket_id, "ticket": tickets[ticket_id], "notes": [], "trace": []}
        for n, chunk in enumerate(graph.stream(init, stream_mode="updates"), start=1):
            for node, update in chunk.items():
                print(f"  块 {n}: {node} -> {sorted(update)}")
```

<div class="line-notes">

- `tickets = dict(load_tickets())` `load_tickets()` 返回 `(工单号, 文本)` 的列表,`dict()` 把它变成按工单号查文本的字典。
- `init = {"ticket_id": ticket_id, "ticket": tickets[ticket_id], "notes": [], "trace": []}` 初始状态,`notes`、`trace` 给空列表。
- `for n, chunk in enumerate(graph.stream(init, stream_mode="updates"), start=1):` 给每个块编号,从 1 开始。
- `for node, update in chunk.items():` 一个块是 `{节点名: 更新}` 字典,逐个取出。
- `print(f"  块 {n}: {node} -> {sorted(update)}")` 打印节点名和它更新了哪些字段(只看字段名)。

</div>

```text
T1007
  块 1: classify -> ['category', 'trace']
  块 2: look_customer -> ['notes', 'trace']
  块 3: look_invoices -> ['notes', 'trace']
  块 4: compose_billing -> ['reply', 'trace']
T1001
  块 1: classify -> ['category', 'trace']
  块 2: reply_template -> ['reply', 'trace']
```

账单工单有 4 个块:`classify`、`look_customer`、`look_invoices`、`compose_billing`,技术工单只有 2 个。`look_customer` 和 `look_invoices` **是不同的块**。这是个容易想错的地方:它们在图上是同一步并行的,但 `updates` 模式每个节点产出一个块,所以看 `stream` 看不出谁和谁是同一步。要看到「同一步」得用别的 stream 模式,后面讲 stream 的那几天再说。

</details>

验收标准:练习 1 默写的版本两条断言通过;练习 2 的四个错误都能说出现象和修法;练习 3、4 的输出和参考答案一致。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 知识地图 | 把本周几天的内容画成一张图,标出彼此的依赖 |
| `trace` | 本项目里自己加的字段,每个节点把自己的名字写进去,用来事后看一张工单经过了哪些节点。不是 LangGraph 的内置概念 |
| 多对一的 `path_map` | 字典里多个键指向同一个节点,如 `subscription`、`technical`、`account` 都指向 `reply_template` |
| 默写 | 合上文章凭记忆把代码写一遍。能默写出来才说明真的懂了,只会看懂不算 |

## 常见误区

**只会看懂,不默写。** 复习日最重要的是练习 1。看懂和写得出之间差得很远,我自己的体会是:默写时才会发现「汇合用列表」这种细节其实没记住。

**改坏实验里,以为每一处都会被抓到。** 今天三处改坏,一处没抓到(扇入写成两条单独的边),一处报的不是预想的错。没抓到不是实验失败,是在告诉你测试覆盖有洞。

**把 `trace` 当成 LangGraph 的功能。** 它是项目里自己加的普通字段,配了 `operator.add`,节点自己往里写名字。

**在练习 3 里直接改小项目的文件。** 改了原文件后,练习 2、练习 4 的结果会变。复用节点、只替换路由函数,这是 LangGraph 里「节点和边分开」的好处。

**以为 `stream` 的一个块等于一步。** 并行的节点在图上是同一步,但 `updates` 模式每个节点各自一个块(练习 4)。

## 学习资料

### 文档与文章

- [LangGraph 文档 · Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api):整周内容的官方总述:State、Reducers、Edges、Conditional edges 都在这一页。复习时从头扫一遍,20 分钟,看看哪些概念今天能不看文章讲出来。
- [LangGraph 文档 · Use the graph API](https://docs.langchain.com/oss/python/langgraph/use-graph-api):带代码的做法合集,可以拿来对答案。
- [LangGraph 文档 · INVALID_CONCURRENT_GRAPH_UPDATE](https://docs.langchain.com/oss/python/langgraph/errors/INVALID_CONCURRENT_GRAPH_UPDATE):本周最常见的报错的官方说明。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1HVFLzfEeS&autoplay=0&high_quality=1" title="挑战19分钟搞定,LangGraph快速入门与原理剖析" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>敲代码的码农 · 挑战19分钟搞定,LangGraph快速入门与原理剖析 · 约 19 分钟(2026 年 10 月查)。复习日拿来快速过一遍整体,我没有看全。</figcaption>
</figure>

- 尚硅谷《LangGraph教程,langgraph入门,langgraph智能体项目实战》(BV1z3NY66EY1,全套约 21 小时,2026 年 10 月查):想把本周六天对着看,可以找「State」「reducer」「并行」「条件分支」几集。我没有逐集看。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/aHCDrAbH_go" title="Building Effective Agents with LangGraph" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Building Effective Agents with LangGraph · 官方频道,英文,开字幕。我只核对了标题和频道,没有逐段看。可以看看别人是怎么把并行、路由这些模式用到一个 Agent 上的。</figcaption>
</figure>

### 书籍

- Mayo Oshin、Nuno Campos,《Learning LangChain: Building AI and LLM Applications with LangChain and LangGraph》,O'Reilly,2025。读 LangGraph 状态、并行和路由相关的章节,出版时的 API 和现在有出入。我没有核实有无中文版。

### 开源项目与代码

- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):仓库里有 `examples` 目录和 `docs`,本周的概念都能在里面找到最小例子。我没有逐个看。

## 自测

1. 一张图里,两个并行节点都要往 `trace` 写,`trace` 需要什么?如果它们写的是不同的字段呢?

<details><summary>答案</summary>

写同一个字段要 reducer(如 `Annotated[list[str], operator.add]`),不配会抛 `InvalidUpdateError`。写不同的字段不需要 reducer。

</details>

2. `add_edge(["a", "b"], "c")` 和 `add_edge("a", "c")`、`add_edge("b", "c")` 有什么区别?今天的改坏实验为什么没抓到这个区别?

<details><summary>答案</summary>

前者等 a、b 都完成才进 c;后者 a、b 任何一个完成都触发一次 c,分支长度不同时 c 会跑两次。今天的两条分支一样长,同一步完成,单独的边也只触发一次,所以没有可观察的差别。

</details>

3. 路由函数返回 `["look_customer", "look_invoices"]` 是什么效果?`path_map` 里要给这两个值各写一项吗?

<details><summary>答案</summary>

两个节点在同一步并行执行(扇出)。传了字典形式的 `path_map` 时,返回值要在字典的键里,所以要给这两个值各写一项(本项目里是 `"look_customer": "look_customer"` 这样的恒等映射)。

</details>

4. 面试题:你在条件边里没传 `path_map`,线上有一类工单一直没人处理,图也没报错。你会怀疑什么?怎么确认?

<details><summary>答案</summary>

怀疑路由函数返回了一个不存在的节点名(拼错、枚举值新增了但没加分支),图悄悄在那一步之后结束(实测只有一行日志 `wrote to unknown channel ... ignoring it`)。确认办法:查日志里有没有这行,或者用 `stream` 看这类工单实际经过的节点;预防办法:传 `path_map`(拼错会抛 `KeyError`),把路由函数返回类型标成 `Literal`,给每个类别写一条测试,包括真数据没走到的类别。

</details>

5. 复习日为什么要默写,而不是再读一遍?

<details><summary>答案</summary>

读一遍是「看懂」,默写是「调出来」。本周很多错误(汇合用列表、`facts` 的 reducer、路由返回列表)都是看的时候觉得简单,写的时候漏掉。默写出错的地方,就是你真正没掌握的地方。

</details>

## 明天预告

Day 308 · LangGraph(八):循环和 `recursion_limit`。到现在为止图都是一条往前走的线(加分叉和汇合)。明天让一条边指回前面的节点,形成循环:写一版、检查一版、不合格再写,直到合格或次数用完。同时会撞上 `GraphRecursionError`,看图是怎么防止无限循环的。
