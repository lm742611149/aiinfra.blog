---
title: 'Day 306 · LangGraph(七):条件边和 path_map'
description: '前面所有的连线都是写死的。今天学 add_conditional_edges:路由函数读状态、返回下一站的名字,path_map 把返回值翻译成节点名。实测三种写法画出来的边不一样、返回值不在 path_map 里报 KeyError、path_map 指向不存在的节点在 compile 时报 ValueError、路由函数里改状态不会写进状态、没有第三个参数时返回未知名字不报错只是悄悄结束;再把 41 张真工单按类别分流。'
pubDate: 2026-10-27
regime: none
tags: ['langgraph', 'conditional-edges', 'path-map', 'routing', 'python', 'agent-zero']
series: 'agent-zero'
day: 306
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 305](/blog/agent-zero/day-305-lg-parallel/) 让两个节点同时跑:START 连出两条边是扇出,`add_edge([a, b], c)` 是扇入;并行写同一个键必须配 reducer,不配抛 `InvalidUpdateError`;同一步里的节点看不到彼此的写入;并行写同一个键时合并顺序实测按节点名字母序;扇入写成两条单独的边,分支长度不同时汇合节点会跑两次。

那些连线有个共同点:都是写死的,一条边永远去同一个地方。可是真实的工单流是「先分类,再看类别决定下一站」:账单的去账单组,退款的走审批,不认识的转人工。今天学的就是让边变聪明的办法:条件边。依旧不调模型,花费 ¥0。

## 今天要解决的问题

学完今天,你要能做到:

1. 用 `add_conditional_edges(来源节点, 路由函数, path_map)` 写出按状态分流的图,并说出路由函数、`path_map` 各自负责什么。
2. 说出 `path_map` 的三种写法(字典、列表、什么都不传),以及它们对「画出来的图」有什么影响。
3. 预测几种出错的样子:返回值不在 `path_map` 里、`path_map` 指向不存在的节点、路由函数里改状态、什么都不传时返回未知名字。
4. 知道路由函数可以返回 `END`,也可以返回列表(一次去多个节点)。

预计用时 2.5 小时。今天不调模型,花费 ¥0。前置:[Day 305](/blog/agent-zero/day-305-lg-parallel/)(并行和列表返回值会用到)、[Day 301](/blog/agent-zero/day-301-lg-sequence/)(`stream` 的 `updates`)、[Day 299](/blog/agent-zero/day-299-lg-one-node/)(`part05/lg/s01_tickets.py` 里的 `classify_text` 和 `load_tickets`、`Literal` 类型)、[Day 303](/blog/agent-zero/day-303-lg-overwrite/) 建的 `part05/lg/s04_tickets.py`(`invoice_note`)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `s07_conditional.py` 里的路由函数和 `add_conditional_edges` 那一段;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

所有命令在 `agent-zero-lab/` 根目录跑(我的是 `/Users/你/agent-zero-lab`)。先重置业务库:

```bash
cd /Users/你/agent-zero-lab
uv run python cloudledger/seed.py
```

<div class="line-notes">

- `uv run python cloudledger/seed.py` 删库重建,输出 `已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}`。最后一步用到工单表和发票表。

</div>

## 条件边是什么

前端里你写过路由:`switch (action.type) { case 'billing': ...; case 'refund': ... }`,或者 React Router 里「按 URL 渲染不同页面」。条件边是同一个思路:一个节点跑完之后,**调一个函数看状态,函数返回下一站的名字**。

普通边是 `add_edge("classify", "billing")`,写死。条件边是:

```text
add_conditional_edges("classify", route, path_map)
                       ↑ 从哪出发  ↑ 路由函数   ↑ 返回值怎么翻译成节点名
```

三个零件分工:**路由函数**读状态、返回一个字符串(下一站);**`path_map`** 把这个字符串翻译成真正的节点名;路由函数本身不是节点,**它不改状态**。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="条件边:classify 节点跑完后,路由函数 route 读状态里的 category,返回 billing、refund 或 other;path_map 把 other 翻译成节点 human,billing 和 refund 原样;三个分支节点 billing、refund、human 都连到 END">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="105" width="100" height="40" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="70" y="130" fill="var(--ink)" text-anchor="middle">classify</text>
<rect x="190" y="100" width="130" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="255" y="122" fill="var(--ink)" text-anchor="middle">route(state)</text>
<text x="255" y="140" fill="var(--ink-soft)" text-anchor="middle" font-size="11">读 category</text>
<line x1="120" y1="125" x2="190" y2="125" stroke="var(--ink-soft)"/>
<rect x="380" y="20" width="110" height="40" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="435" y="45" fill="var(--ink)" text-anchor="middle">billing</text>
<rect x="380" y="105" width="110" height="40" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="435" y="130" fill="var(--ink)" text-anchor="middle">refund</text>
<rect x="380" y="190" width="110" height="40" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="435" y="215" fill="var(--ink)" text-anchor="middle">human</text>
<line x1="320" y1="115" x2="380" y2="42" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
<line x1="320" y1="125" x2="380" y2="125" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
<line x1="320" y1="135" x2="380" y2="208" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
<text x="330" y="70" fill="var(--ink-faint)" font-size="11">"billing"</text>
<text x="328" y="120" fill="var(--ink-faint)" font-size="11" transform="translate(0,-8)">"refund"</text>
<text x="320" y="190" fill="var(--ink-faint)" font-size="11">"other" → human</text>
<rect x="560" y="105" width="60" height="40" rx="20" fill="none" stroke="var(--rule)"/>
<text x="590" y="130" fill="var(--ink-soft)" text-anchor="middle">END</text>
<line x1="490" y1="40" x2="590" y2="105" stroke="var(--ink-soft)"/>
<line x1="490" y1="125" x2="560" y2="125" stroke="var(--ink-soft)"/>
<line x1="490" y1="210" x2="590" y2="145" stroke="var(--ink-soft)"/>
<text x="20" y="22" fill="var(--ink-faint)" font-size="11">虚线 = 条件边:路由函数的返回值决定走哪条</text>
</g>
</svg>
<figcaption>路由函数读状态返回一个字符串;path_map 把字符串翻译成节点名(这里 other 被翻成 human);三条虚线只有一条会走。实线是普通边。</figcaption>
</figure>

## 第 1 步:三个分支

延续旧课的例子。`classify` 用关键词粗分三类:含「发票」是 `billing`,含「退款」是 `refund`,其余 `other`。三个分支节点各写一句回复。注意 `other` 对应的节点叫 `human`,这是为了演示 `path_map` 的翻译作用。

```python
# agent-zero-lab/part05/lg/s07_conditional.py
"""条件边:classify 之后按 category 走不同分支。
用法:uv run python -m part05.lg.s07_conditional"""
from typing import Literal, NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph


Category = Literal["billing", "refund", "other"]


class State(TypedDict):
    ticket: str
    category: NotRequired[Category]
    reply: NotRequired[str]


def classify(state: State) -> dict:
    t = state["ticket"]
    cat: Category = "billing" if "发票" in t else "refund" if "退款" in t else "other"
    return {"category": cat}


def billing(state: State) -> dict:
    return {"reply": "转账单组"}


def refund(state: State) -> dict:
    return {"reply": "走退款审批"}


def human(state: State) -> dict:
    return {"reply": "转人工"}


def route(state: State) -> Category:
    return state.get("category", "other")


builder = StateGraph(State)
for fn in (classify, billing, refund, human):
    builder.add_node(fn.__name__, fn)
builder.add_edge(START, "classify")
builder.add_conditional_edges(
    "classify",
    route,
    {"billing": "billing", "refund": "refund", "other": "human"},
)
for n in ("billing", "refund", "human"):
    builder.add_edge(n, END)
graph = builder.compile()

if __name__ == "__main__":
    for t in ["发票开错了", "我要退款", "怎么改密码"]:
        print(t, "→", graph.invoke({"ticket": t})["reply"])
    print("--- stream 看走了哪些节点 ---")
    for chunk in graph.stream({"ticket": "我要退款"}, stream_mode="updates"):
        print(chunk)
```

<div class="line-notes">

- `Category = Literal["billing", "refund", "other"]` 给「类别」起个名字:只能是这三个字符串之一。`Literal` 是 [Day 299](/blog/agent-zero/day-299-lg-one-node/) 见过的类型,≈ TS 的联合字面量 `'billing' | 'refund' | 'other'`。
- `category: NotRequired[Category]` 状态里的类别字段,进图时还没有,`classify` 写进去,所以标 `NotRequired`。
- `cat: Category = "billing" if "发票" in t else "refund" if "退款" in t else "other"` 嵌套的条件表达式:先看「发票」,再看「退款」,都不是就 `other`。代入 `"我要退款"`:`"发票"` 不在里面,`"退款"` 在,所以是 `"refund"`。
- `return {"reply": "转账单组"}` 分支节点很简单,只写 `reply`。三个分支各写各的。
- `def route(state: State) -> Category:` **路由函数**:收状态,返回一个 `Category`。它不是节点,不会出现在图里,也不返回更新字典。
- `return state.get("category", "other")` 从状态里取类别,取不到就当 `other`。代入 `"我要退款"` 走到这里时 `category` 是 `"refund"`,所以返回 `"refund"`。
- `for fn in (classify, billing, refund, human):` 四个节点用循环登记,节点名取函数名。
- `builder.add_conditional_edges(` 三个参数:从哪个节点出发、路由函数、`path_map`。
- `{"billing": "billing", "refund": "refund", "other": "human"},` `path_map`:左边是路由函数的返回值,右边是节点名。`other` 被翻译成 `human`。
- `for n in ("billing", "refund", "human"):` 三个分支节点各连一条普通边到 END。
- `for t in ["发票开错了", "我要退款", "怎么改密码"]:` 三条工单分别走三条路。
- `for chunk in graph.stream({"ticket": "我要退款"}, stream_mode="updates"):` 用 `stream` 看一张工单实际经过了哪几个节点。

</div>

```bash
uv run python -m part05.lg.s07_conditional
```

```text
发票开错了 → 转账单组
我要退款 → 走退款审批
怎么改密码 → 转人工
--- stream 看走了哪些节点 ---
{'classify': {'category': 'refund'}}
{'refund': {'reply': '走退款审批'}}
```

三条工单分别走了账单、退款、人工三条路。`stream` 的输出只有两个块:`classify`、`refund`,没有 `billing` 和 `human`,**没被选中的分支节点完全没有执行**。这和上一课的扇出不同:扇出是所有出边都走,条件边是只走路由函数选中的那条(或那几条,第 4 步)。

## 第 2 步:path_map 的三种写法

第三个参数 `path_map` 可以传字典、传列表,或者不传。官方 Graph API 文档的原话:默认情况下路由函数的返回值就是下一个节点的名字(或名字列表),也可以传一个字典把返回值映射到节点。这里实测四种写法,看三件事:能不能分流、画图时 `start` 的出边是什么、路由函数写成 `Literal` 返回类型有什么用。

```python
# agent-zero-lab/part05/lg/s07_forms.py
"""add_conditional_edges 的三种写法,以及画出来的边有什么不同。
用法:uv run python -m part05.lg.s07_forms"""
from typing import Literal, NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    n: int
    out: NotRequired[str]


def start(state: State) -> dict:
    return {}


def big(state: State) -> dict:
    return {"out": "big"}


def small(state: State) -> dict:
    return {"out": "small"}


def route_names(state: State) -> str:
    return "big" if state["n"] > 10 else "small"


def route_words(state: State) -> bool:
    return state["n"] > 10


def route_literal(state: State) -> Literal["big", "small"]:
    return "big" if state["n"] > 10 else "small"


def build(kind: str):
    b = StateGraph(State)
    b.add_node("start", start)
    b.add_node("big", big)
    b.add_node("small", small)
    b.add_edge(START, "start")
    if kind == "A 返回值就是节点名,不传第三个参数":
        b.add_conditional_edges("start", route_names)
    elif kind == "B 传列表":
        b.add_conditional_edges("start", route_names, ["big", "small"])
    elif kind == "C 传 path_map 字典":
        b.add_conditional_edges("start", route_words, {True: "big", False: "small"})
    else:
        b.add_conditional_edges("start", route_literal)
    b.add_edge("big", END)
    b.add_edge("small", END)
    return b.compile()


if __name__ == "__main__":
    for kind in ["A 返回值就是节点名,不传第三个参数", "B 传列表", "C 传 path_map 字典", "D 只靠返回类型 Literal"]:
        g = build(kind)
        edges = sorted((e.source, e.target, e.conditional) for e in g.get_graph().edges if e.source == "start")
        print(kind)
        print("  n=50 →", g.invoke({"n": 50})["out"], "| n=3 →", g.invoke({"n": 3})["out"])
        print("  画图时 start 的出边:", edges)
```

<div class="line-notes">

- `n: int` 状态里放一个整数,路由函数看它大于 10 还是小于等于 10。
- `def route_names(state: State) -> str:` 返回值就是节点名(`"big"` 或 `"small"`),返回类型只写了 `str`。
- `def route_words(state: State) -> bool:` 返回布尔值,不是节点名,必须用字典翻译成节点名。
- `def route_literal(state: State) -> Literal["big", "small"]:` 返回类型写成 `Literal`,把所有可能的返回值列出来。
- `if kind == "A 返回值就是节点名,不传第三个参数":` 写法 A:什么都不传。
- `b.add_conditional_edges("start", route_names)` A 的调用,只有两个参数。
- `b.add_conditional_edges("start", route_names, ["big", "small"])` 写法 B:第三个参数传列表,列出所有可能的目标。
- `b.add_conditional_edges("start", route_words, {True: "big", False: "small"})` 写法 C:字典,键不一定是字符串,这里是 `True`/`False`。
- `b.add_conditional_edges("start", route_literal)` 写法 D:不传第三个参数,但路由函数的返回类型是 `Literal`。
- `edges = sorted((e.source, e.target, e.conditional) for e in g.get_graph().edges if e.source == "start")` 取编译后图的所有边里,从 `start` 出发的那些。`conditional` 为真表示是条件边。`get_graph()` 的画图用法 Day 310 才正式讲,今天只借它看边。

</div>

```bash
uv run python -m part05.lg.s07_forms
```

```text
A 返回值就是节点名,不传第三个参数
  n=50 → big | n=3 → small
  画图时 start 的出边: [('start', '__end__', False)]
B 传列表
  n=50 → big | n=3 → small
  画图时 start 的出边: [('start', 'big', True), ('start', 'small', True)]
C 传 path_map 字典
  n=50 → big | n=3 → small
  画图时 start 的出边: [('start', 'big', True), ('start', 'small', True)]
D 只靠返回类型 Literal
  n=50 → big | n=3 → small
  画图时 start 的出边: [('start', 'big', True), ('start', 'small', True)]
```

四种写法分流结果完全一致,差别在**画出来的图**:写法 A(什么都不传、返回类型是普通的 `str`)图里 `start` 只有一条到 `__end__` 的非条件边,`big`、`small` 都没画出来。因为框架在建图时看不到路由函数会返回什么。B(列表)、C(字典)、D(返回类型是 `Literal`)三种,图里都有两条条件边指向 `big`、`small`。练习 3 会再对比一次。所以我的习惯是:**要么传 `path_map`,要么把返回类型标成 `Literal`**,这样图画得对,以后改图也有地方检查。

字典形式的价值是翻译:路由函数可以返回业务词(`billing`、`other`),节点名可以另起(`human`),甚至像写法 C 这样返回布尔值。多个返回值指向同一个节点也行(Day 307 的小项目里 `subscription`、`technical`、`account` 都指向 `reply_template`)。

## 第 3 步:出错的几种样子

条件边的错误,有的在建图时炸,有的在运行时炸,有一个还不炸。逐个制造:

```python
# agent-zero-lab/part05/lg/s07_errors.py
"""条件边常见的几种错:返回值没在 path_map 里、返回不存在的节点名、路由函数里改状态、返回 None。
用法:uv run python -m part05.lg.s07_errors"""
from collections.abc import Callable
from typing import Any, NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    n: int
    out: NotRequired[str]
    seen: NotRequired[str]


def start(state: State) -> dict:
    return {}


def big(state: State) -> dict:
    return {"out": "big", "seen": str(state.get("seen"))}


def small(state: State) -> dict:
    return {"out": "small"}


def build(route: Callable[[State], Any], path_map: Any) -> Any:
    b = StateGraph(State)
    b.add_node("start", start)
    b.add_node("big", big)
    b.add_node("small", small)
    b.add_edge(START, "start")
    b.add_conditional_edges("start", route, path_map)
    b.add_edge("big", END)
    b.add_edge("small", END)
    return b.compile()


def attempt(title: str, make: Callable[[], Any], n: int = 50) -> None:
    print(title)
    try:
        print("  结果:", make().invoke({"n": n}))
    except Exception as e:
        print("  ", type(e).__name__, "|", str(e).splitlines()[0])


def r_unmapped(state: State) -> str:
    return "huge"


def r_missing_node(state: State) -> str:
    return "nowhere"


def r_none(state: State) -> None:
    return None


def r_mutates(state: State) -> str:
    state["seen"] = "路由函数写的"
    return "big"


if __name__ == "__main__":
    pm = {"big": "big", "small": "small"}
    attempt("1 返回值不在 path_map 里", lambda: build(r_unmapped, pm))
    attempt("2 第三个参数是列表,返回的名字不在列表里", lambda: build(r_missing_node, ["big", "small"]))
    attempt("3 path_map 指向不存在的节点", lambda: build(lambda s: "big", {"big": "ghost"}))
    attempt("4 路由函数返回 None", lambda: build(r_none, pm))
    attempt("5 路由函数里改 state", lambda: build(r_mutates, pm))
```

<div class="line-notes">

- `def build(route: Callable[[State], Any], path_map: Any) -> Any:` 把路由函数和 `path_map` 当参数传进来,方便换着试。`Callable[[State], Any]` 表示「收一个 State、返回任何东西的函数」。
- `b.add_conditional_edges("start", route, path_map)` 用传进来的路由函数和 `path_map` 建条件边。
- `def attempt(title: str, make: Callable[[], Any], n: int = 50) -> None:` 把「建图加运行」包进 `try`,出了异常打印类型和第一行。`make` 是一个无参函数,返回建好的图。
- `def r_unmapped(state: State) -> str:` 返回 `"huge"`,不在下面的 `path_map` 里。
- `def r_missing_node(state: State) -> str:` 返回 `"nowhere"`,一个根本不存在的名字。
- `def r_none(state: State) -> None:` 什么都不返回,即 `None`。
- `state["seen"] = "路由函数写的"` 路由函数里直接改状态,想看改的东西能不能让后面的节点看到。
- `pm = {"big": "big", "small": "small"}` 一份正常的 `path_map`。
- `attempt("1 返回值不在 path_map 里", lambda: build(r_unmapped, pm))` 第一种错:返回 `"huge"`,字典里没有这个键。
- `attempt("2 第三个参数是列表,返回的名字不在列表里", lambda: build(r_missing_node, ["big", "small"]))` 第二种:第三个参数是列表,返回 `"nowhere"`。
- `attempt("3 path_map 指向不存在的节点", lambda: build(lambda s: "big", {"big": "ghost"}))` 第三种:字典的值是一个没登记过的节点。
- `attempt("4 路由函数返回 None", lambda: build(r_none, pm))` 第四种:返回 `None`。
- `attempt("5 路由函数里改 state", lambda: build(r_mutates, pm))` 第五种:路由函数里改状态。

</div>

```bash
uv run python -m part05.lg.s07_errors
```

```text
1 返回值不在 path_map 里
   KeyError | 'huge'
2 第三个参数是列表,返回的名字不在列表里
   KeyError | 'nowhere'
3 path_map 指向不存在的节点
   ValueError | At 'start' node, 'condition' branch found unknown target 'ghost'
4 路由函数返回 None
   KeyError | None
5 路由函数里改 state
  结果: {'n': 50, 'out': 'big', 'seen': 'None'}
```

逐条读:

- **1、2、4(`KeyError`)**:返回值不在 `path_map` 里,运行到那一步才炸,报错是 `KeyError: 'huge'`,不太友好,只告诉你是哪个值,没告诉你是哪条边。返回 `None`(忘了写 `return` 的典型后果)也是这个类型,`KeyError: None`。
- **3(`ValueError`)**:`path_map` 的值指向不存在的节点,**建图(`compile`)时**就报:`At 'start' node, 'condition' branch found unknown target 'ghost'`。这是好的错,没跑就发现。
- **5(没报错)**:路由函数里 `state["seen"] = ...` 没报错,但 `big` 节点读到的 `seen` 是 `None`,改动没生效。**路由函数返回的是去向,不是状态更新**,想同时改状态要放进节点里写,或者用 Day 309 的 `Command`。官方文档也建议「既要更新状态又要路由时,用 `Command`」。

## 第 4 步:返回 END、返回列表、返回未知名字

路由函数的返回值不止「一个节点名」这一种。最后三种形态实测:

```python
# agent-zero-lab/part05/lg/s07_multi.py
"""路由函数的返回值不止一个节点名:返回 END 提前结束;返回列表一次去多个节点;没有第三个参数时返回未知名字。
用法:uv run python -m part05.lg.s07_multi"""
import operator
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    n: int
    log: Annotated[list[str], operator.add]


def start(state: State) -> dict:
    return {"log": ["start"]}


def a(state: State) -> dict:
    return {"log": ["a"]}


def b(state: State) -> dict:
    return {"log": ["b"]}


def route(state: State) -> str | list[str]:
    if state["n"] == 0:
        return END
    if state["n"] == 1:
        return "a"
    if state["n"] == 2:
        return ["a", "b"]
    return "nowhere"


builder = StateGraph(State)
builder.add_node("start", start)
builder.add_node("a", a)
builder.add_node("b", b)
builder.add_edge(START, "start")
builder.add_conditional_edges("start", route)
builder.add_edge("a", END)
builder.add_edge("b", END)
graph = builder.compile()

if __name__ == "__main__":
    for n in (0, 1, 2, 3):
        try:
            print(f"n={n}:", graph.invoke({"n": n, "log": []})["log"])
        except Exception as e:
            print(f"n={n}:", type(e).__name__, "|", str(e).splitlines()[0])
```

<div class="line-notes">

- `def route(state: State) -> str | list[str]:` 返回类型是「字符串或字符串列表」。`str | list[str]` 是 Python 3.10 起的联合类型写法,≈ TS 的 `string | string[]`。
- `return END` `n == 0` 时返回 `END`,图直接结束,一个分支节点都不去。`END` 就是字符串 `'__end__'`。
- `return "a"` `n == 1` 时去 `a`。
- `return ["a", "b"]` `n == 2` 时返回列表:`a` 和 `b` 同一步一起跑,就是 Day 305 的扇出。
- `return "nowhere"` 其余情况返回一个不存在的名字。
- `builder.add_conditional_edges("start", route)` 只传两个参数,没有 `path_map`,也没有 `Literal` 返回类型。
- `builder.add_edge("a", END)` `a` 和 `b` 都连到 END,各自跑完就结束。
- `for n in (0, 1, 2, 3):` 四种输入各走一遍。

</div>

```bash
uv run python -m part05.lg.s07_multi
```

```text
Task start with path ('__pregel_pull', 'start') wrote to unknown channel branch:to:nowhere, ignoring it.
n=0: ['start']
n=1: ['start', 'a']
n=2: ['start', 'a', 'b']
n=3: ['start']
```

第一行是 stderr 上的一条日志(日志在输出最前面是因为它不走缓冲,不影响结果)。

- `n=0`:返回 `END`,日志里只有 `start`,提前结束。
- `n=1`:去 `a`。
- `n=2`:返回列表,`a`、`b` 都跑了,日志顺序是 `a` 在 `b` 前(Day 305 第 4 步的字母序)。
- `n=3`:返回不存在的 `nowhere`,**没有抛异常**,只在日志里打了一行 `wrote to unknown channel branch:to:nowhere, ignoring it.`(写到未知通道,忽略),图悄悄在 `start` 之后结束了。最终状态里没有 `a`、`b`,调用方根本不知道出过问题。

第四种是今天最危险的坑:**不传 `path_map`、路由函数拼错节点名,图不会报错,只是悄悄结束**。传了 `path_map`(字典或列表),同样的错会在运行时抛 `KeyError`(第 3 步),比悄悄结束好。所以我推荐总是传第三个参数。

## 第 5 步:41 张真工单分流

CloudLedger 的 41 张工单用 Day 299 的 `classify_text` 分成 `billing`、`subscription`、`technical`、`account`、`other` 五类。这次五条出路:账单分支查一次发票写进回复,订阅、技术、账号三个分支给模板回复,`other` 转人工。

```python
# agent-zero-lab/part05/lg/s07_tickets.py
"""41 张真工单按类别分流:账单分支会查发票,其余分支给模板回复,other 转人工。
用法:uv run python -m part05.lg.s07_tickets"""
from collections import Counter
from typing import Literal, NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph

from part05.lg.s01_tickets import classify_text, load_tickets
from part05.lg.s04_tickets import invoice_note

Category = Literal["billing", "subscription", "technical", "account", "other"]


class State(TypedDict):
    ticket_id: str
    ticket: str
    category: NotRequired[Category]
    reply: NotRequired[str]


def classify(state: State) -> dict:
    return {"category": classify_text(state["ticket"])}


def billing(state: State) -> dict:
    return {"reply": f"账单组跟进。{invoice_note(state['ticket_id'])}"}


def subscription(state: State) -> dict:
    return {"reply": "客户成功同事联系确认订阅变更"}


def technical(state: State) -> dict:
    return {"reply": "转工程师排查"}


def account(state: State) -> dict:
    return {"reply": "走账号找回流程"}


def human(state: State) -> dict:
    return {"reply": "转人工"}


def route(state: State) -> Category:
    return state.get("category", "other")


builder = StateGraph(State)
for fn in (classify, billing, subscription, technical, account, human):
    builder.add_node(fn.__name__, fn)
builder.add_edge(START, "classify")
builder.add_conditional_edges(
    "classify",
    route,
    {
        "billing": "billing",
        "subscription": "subscription",
        "technical": "technical",
        "account": "account",
        "other": "human",
    },
)
for name in ("billing", "subscription", "technical", "account", "human"):
    builder.add_edge(name, END)
graph = builder.compile()

if __name__ == "__main__":
    tickets = load_tickets()
    visited: Counter[str] = Counter()
    for ticket_id, text in tickets:
        for chunk in graph.stream({"ticket_id": ticket_id, "ticket": text}, stream_mode="updates"):
            for node in chunk:
                if node != "classify":
                    visited[node] += 1
    print("各分支被走到的次数:", dict(visited))
    print("总和:", sum(visited.values()), "human 节点:", visited.get("human", 0))
    first_id, first_text = tickets[0]
    out = graph.invoke({"ticket_id": first_id, "ticket": first_text})
    print(first_id, out["category"], "→", out["reply"])
    out = graph.invoke({"ticket_id": first_id, "ticket": "今天天气真好"})
    print("编一张不属于任何类别的:", out["category"], "→", out["reply"])
```

<div class="line-notes">

- `from part05.lg.s01_tickets import classify_text, load_tickets` 复用 Day 299 的规则分类函数和读库函数。
- `from part05.lg.s04_tickets import invoice_note` 复用 Day 303 的查发票函数,账单分支用它。
- `Category = Literal["billing", "subscription", "technical", "account", "other"]` 五个类别。
- `return {"category": classify_text(state["ticket"])}` `classify` 节点直接用规则表分类。
- `return {"reply": f"账单组跟进。{invoice_note(state['ticket_id'])}"}` 账单分支:回复里带上这个客户的未付发票数。比如 `账单组跟进。未付发票:0 张`。
- `for fn in (classify, billing, subscription, technical, account, human):` 六个节点循环登记。
- `"other": "human",` `path_map` 里唯一需要翻译的一项:`other` 对应的节点叫 `human`。
- `for name in ("billing", "subscription", "technical", "account", "human"):` 五个分支节点都连到 END。
- `visited: Counter[str] = Counter()` 数每个分支被走到的次数。
- `for chunk in graph.stream({"ticket_id": ticket_id, "ticket": text}, stream_mode="updates"):` 用 `stream` 取每张工单经过的节点,块的键就是节点名。
- `if node != "classify":` 每张都会经过 `classify`,不计,只数分支。
- `out = graph.invoke({"ticket_id": first_id, "ticket": "今天天气真好"})` 编一张不属于任何类别的工单,验证 `other` 到 `human` 的翻译真的生效。

</div>

```bash
uv run python -m part05.lg.s07_tickets
```

```text
各分支被走到的次数: {'technical': 6, 'subscription': 8, 'billing': 18, 'account': 9}
总和: 41 human 节点: 0
T1001 technical → 转工程师排查
编一张不属于任何类别的: other → 转人工
```

41 张分到四个分支:账单 18、订阅 8、技术 6、账号 9,和 Day 299 的分类计数一致,总和 41。`human` 节点一次也没走到:41 张真工单没有一张落进 `other`(规则表覆盖得挺全)。所以我编了一张「今天天气真好」,验证了 `other → human` 这条路是通的。**没被真数据走到的分支一定要手工造一条数据测**,否则这条路出问题你很久都不知道。

## 零件 → 大代码对照表

| 零件 | 在哪个脚本 | 说明 |
| --- | --- | --- |
| 路由函数 + `add_conditional_edges` + `path_map` | `s07_conditional.py` | 三条工单走三条路 |
| 字典 / 列表 / 不传 / `Literal` 四种写法 | `s07_forms.py` | 画出的边不同,不传时看不到出路 |
| `KeyError`、`ValueError`、路由里改状态 | `s07_errors.py` | 运行时 / 建图时 / 无效 |
| 返回 `END`、返回列表、返回未知名字 | `s07_multi.py` | 未知名字不传 `path_map` 时悄悄结束 |
| 41 张真工单 | `s07_tickets.py` | 18 / 8 / 6 / 9,`human` 没被走到 |

## 动手练习

### 练习 1:紧急工单优先

含「急」「马上」「立刻」的工单,不管什么类别都转人工(新增一个 `urgent` 出路);其他的照旧。对 41 张工单跑一遍,说出每个分支各有几张。提示:紧急判断放在路由函数里,不用新增节点。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex306_urgent.py
"""练习 1:含「急/马上/立刻」的工单不管什么类别都转人工,别的照旧。
用法:uv run python -m part05.lg.ex306_urgent"""
from collections import Counter
from typing import NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph

from part05.lg.s01_tickets import classify_text, load_tickets

URGENT_WORDS = ("急", "马上", "立刻")


class State(TypedDict):
    ticket: str
    category: NotRequired[str]
    reply: NotRequired[str]


def classify(state: State) -> dict:
    return {"category": classify_text(state["ticket"])}


def make_reply(text: str):
    def node(state: State) -> dict:
        return {"reply": text}
    return node


def route(state: State) -> str:
    if any(w in state["ticket"] for w in URGENT_WORDS):
        return "urgent"
    return state.get("category", "other")


b = StateGraph(State)
b.add_node("classify", classify)
targets = {"billing": "账单组", "subscription": "客户成功", "technical": "工程师", "account": "账号找回", "urgent": "转人工(紧急)", "other": "转人工"}
for name, reply in targets.items():
    b.add_node(name, make_reply(reply))
b.add_edge(START, "classify")
b.add_conditional_edges("classify", route, {k: k for k in targets})
for name in targets:
    b.add_edge(name, END)
graph = b.compile()

if __name__ == "__main__":
    counts: Counter[str] = Counter()
    for _, text in load_tickets():
        counts[graph.invoke({"ticket": text})["reply"]] += 1
    print(dict(counts))
```

<div class="line-notes">

- `URGENT_WORDS = ("急", "马上", "立刻")` 紧急关键词,放成常量。
- `def make_reply(text: str):` 工厂函数,返回一个「写固定回复」的节点,六个分支只是回复不同,没必要各写一个函数。
- `if any(w in state["ticket"] for w in URGENT_WORDS):` 路由函数先判紧急:任何一个关键词在工单里就返回 `"urgent"`。
- `return state.get("category", "other")` 不紧急就看类别。
- `targets = {` 出路表:键是路由返回值,值是回复文字。
- `for name, reply in targets.items():` 用同一张表登记所有分支节点,节点名就是键。
- `b.add_conditional_edges("classify", route, {k: k for k in targets})` `path_map` 用字典推导生成:每个键翻译成同名节点。≈ JS 的 `Object.fromEntries(keys.map(k => [k, k]))`。
- `counts[graph.invoke({"ticket": text})["reply"]] += 1` 按回复文字计数。

</div>

```text
{'工程师': 6, '客户成功': 8, '账单组': 18, '转人工(紧急)': 9}
```

九张紧急工单(都是「登录不了」类的账号问题)被抢走,账号分支从 9 张变成 0,所以输出里没有「账号找回」。路由函数里的判断顺序就是优先级:先判紧急就优先于类别。

</details>

### 练习 2:两层条件边

账单工单里再分一层:客户有未付发票的走 `chase`(核对未付发票并催款),没有的走 `explain`(解释账单明细)。不是账单的走 `other_flow`。提示:账单分支第一站是 `count_open` 节点,查出未付发票数写进状态,再接第二个条件边。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex306_two_level.py
"""练习 2:两层条件边。billing 里再分:有未付发票走 chase,没有走 explain。
用法:uv run python -m part05.lg.ex306_two_level"""
from collections import Counter
from typing import Literal, NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph

from part05.lg.s01_tickets import classify_text, load_tickets
from part05.lg.s04_tickets import query_one


class State(TypedDict):
    ticket_id: str
    ticket: str
    category: NotRequired[str]
    open_invoices: NotRequired[int]
    reply: NotRequired[str]


def classify(state: State) -> dict:
    return {"category": classify_text(state["ticket"])}


def count_open(state: State) -> dict:
    (n,) = query_one(
        "SELECT COUNT(*) FROM invoices i JOIN tickets t ON t.customer_id = i.customer_id "
        "WHERE t.id = ? AND i.status = 'open'",
        (state["ticket_id"],),
    )
    return {"open_invoices": n}


def chase(state: State) -> dict:
    return {"reply": "核对未付发票并催款"}


def explain(state: State) -> dict:
    return {"reply": "解释账单明细"}


def other_flow(state: State) -> dict:
    return {"reply": "走其他流程"}


def route1(state: State) -> Literal["billing", "else"]:
    return "billing" if state.get("category") == "billing" else "else"


def route2(state: State) -> Literal["chase", "explain"]:
    return "chase" if state.get("open_invoices", 0) > 0 else "explain"


b = StateGraph(State)
for fn in (classify, count_open, chase, explain, other_flow):
    b.add_node(fn.__name__, fn)
b.add_edge(START, "classify")
b.add_conditional_edges("classify", route1, {"billing": "count_open", "else": "other_flow"})
b.add_conditional_edges("count_open", route2)
for name in ("chase", "explain", "other_flow"):
    b.add_edge(name, END)
graph = b.compile()

if __name__ == "__main__":
    counts: Counter[str] = Counter()
    for ticket_id, text in load_tickets():
        counts[graph.invoke({"ticket_id": ticket_id, "ticket": text})["reply"]] += 1
    print(dict(counts))
```

<div class="line-notes">

- `open_invoices: NotRequired[int]` 未付发票数,`count_open` 写进来。
- `(n,) = query_one(` 查未付发票数。`query_one` 返回一行(元组),`(n,) =` 把只有一个元素的元组拆开取出数字。
- `def route1(state: State) -> Literal["billing", "else"]:` 第一层路由:是不是账单。
- `def route2(state: State) -> Literal["chase", "explain"]:` 第二层路由:有没有未付发票。
- `b.add_conditional_edges("classify", route1, {"billing": "count_open", "else": "other_flow"})` 第一层:账单去 `count_open`,其余去 `other_flow`。
- `b.add_conditional_edges("count_open", route2)` 第二层:从 `count_open` 出发,`route2` 返回的 `Literal` 就是节点名,所以不用 `path_map`,图也能画出两条出边。
- `for name in ("chase", "explain", "other_flow"):` 三个叶子节点连到 END。

</div>

```text
{'走其他流程': 23, '解释账单明细': 15, '核对未付发票并催款': 3}
```

18 张账单里 3 张有未付发票(`催款`),15 张没有(`解释`),另外 23 张走其他流程。和 Day 304 第 6 步里「8 张有未付发票」不同,那里是 41 张里所有查到有未付发票的客户,这里只看账单类的 18 张。

</details>

### 练习 3:画出来的边

写一个路由函数,三种写法(没有 `Literal` 也没有第三个参数、有 `Literal`、有列表),用 `get_graph().edges` 看 `start` 的出边,说出哪一种「图里看不到出路」。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex306_draw_edges.py
"""练习 3:同一个路由函数,有没有 Literal 返回类型、有没有第三个参数,图里画出的出边一样吗?
用法:uv run python -m part05.lg.ex306_draw_edges"""
from typing import Literal, TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    n: int


def start(state: State) -> dict:
    return {}


def x(state: State) -> dict:
    return {}


def y(state: State) -> dict:
    return {}


def plain(state: State) -> str:
    return "x" if state["n"] > 0 else "y"


def typed(state: State) -> Literal["x", "y"]:
    return "x" if state["n"] > 0 else "y"


def edges_of(route, third):
    b = StateGraph(State)
    for name, fn in (("start", start), ("x", x), ("y", y)):
        b.add_node(name, fn)
    b.add_edge(START, "start")
    if third is None:
        b.add_conditional_edges("start", route)
    else:
        b.add_conditional_edges("start", route, third)
    b.add_edge("x", END)
    b.add_edge("y", END)
    return sorted((e.target, e.conditional) for e in b.compile().get_graph().edges if e.source == "start")


if __name__ == "__main__":
    print("无 Literal、无第三个参数:", edges_of(plain, None))
    print("有 Literal、无第三个参数:", edges_of(typed, None))
    print("无 Literal、有列表     :", edges_of(plain, ["x", "y"]))
```

<div class="line-notes">

- `def plain(state: State) -> str:` 返回类型只是 `str`,框架看不出会返回什么。
- `def typed(state: State) -> Literal["x", "y"]:` 返回类型是 `Literal`,框架从类型里读出可能的值。
- `def edges_of(route, third):` 建同一张图,路由函数和第三个参数由调用者传。
- `if third is None:` 不传第三个参数时,不能传 `None` 占位,得写成两个参数的调用,所以分开写。
- `return sorted((e.target, e.conditional) for e in b.compile().get_graph().edges if e.source == "start")` 取出 `start` 的所有出边,只看目标和是否条件边。

</div>

```text
无 Literal、无第三个参数: [('__end__', False)]
有 Literal、无第三个参数: [('x', True), ('y', True)]
无 Literal、有列表     : [('x', True), ('y', True)]
```

第一种(没有 `Literal` 也没有第三个参数)图里 `start` 只连到 `__end__`,看不到 `x`、`y`。后两种都能画出两条条件边。

</details>

### 练习 4:返回列表

做一个 `entry` 节点,后面的路由函数:`open_invoices > 0` 时返回 `["billing", "notify"]`(两个节点一起跑),否则只返回 `["billing"]`。分别用 0 和 2 调用,看 `log`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex306_list_return.py
"""练习 4:路由函数返回列表,账单工单有未付发票时同时去 billing 和 notify 两个节点。
用法:uv run python -m part05.lg.ex306_list_return"""
import operator
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    open_invoices: int
    log: Annotated[list[str], operator.add]


def entry(state: State) -> dict:
    return {"log": ["entry"]}


def billing(state: State) -> dict:
    return {"log": ["billing"]}


def notify(state: State) -> dict:
    return {"log": ["notify(通知客户成功)"]}


def route(state: State) -> list[str]:
    return ["billing", "notify"] if state["open_invoices"] > 0 else ["billing"]


b = StateGraph(State)
for fn in (entry, billing, notify):
    b.add_node(fn.__name__, fn)
b.add_edge(START, "entry")
b.add_conditional_edges("entry", route, ["billing", "notify"])
b.add_edge("billing", END)
b.add_edge("notify", END)
graph = b.compile()

if __name__ == "__main__":
    for n in (0, 2):
        print(f"open_invoices={n}:", graph.invoke({"open_invoices": n, "log": []})["log"])
```

<div class="line-notes">

- `log: Annotated[list[str], operator.add]` 返回列表时可能多个节点同一步写 `log`,所以要 reducer(Day 305)。
- `return ["billing", "notify"] if state["open_invoices"] > 0 else ["billing"]` 路由函数返回列表,有未付发票时一次去两个节点。
- `b.add_conditional_edges("entry", route, ["billing", "notify"])` 第三个参数列出所有可能去的节点,图也能画出来。
- `for n in (0, 2):` 两种输入各调用一次。

</div>

```text
open_invoices=0: ['entry', 'billing']
open_invoices=2: ['entry', 'billing', 'notify(通知客户成功)']
```

`open_invoices=0` 只去 `billing`;`=2` 两个都去,`log` 里顺序是 `billing`、`notify`(字母序)。

</details>

验收标准:四道题的脚本都能跑通;能默写 `s07_conditional.py` 里的路由函数和 `add_conditional_edges` 调用;说得出建图时报的错和运行时报的错各是哪一种。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 条件边 | 节点跑完后,由一个路由函数看状态决定下一站的边。`add_conditional_edges` 建立。≈ 路由表里按条件匹配 |
| 路由函数 | 收状态、返回下一站名字(或名字列表)的函数。不是节点,不改状态 |
| `path_map` | `add_conditional_edges` 的第三个参数,把路由函数的返回值翻译成节点名,可以是字典或列表 |
| `Literal` | 把值限定为几个字面量之一的类型,≈ TS 的字符串联合类型。路由函数返回类型写成 `Literal` 能让图画出所有出路 |
| `END` | 表示图结束的特殊名字,字符串 `'__end__'`。路由函数返回它,图直接结束 |
| `KeyError` | Python 里字典取不到键时抛的异常。路由函数返回值不在 `path_map` 里时就是它 |

## 常见误区

**以为条件边会把所有出路都跑一遍。** 只走路由函数选中的那条(返回列表时是选中的那几条),没选中的分支节点完全不执行(第 1 步 `stream` 实测只有 `classify`、`refund` 两个块)。

**在路由函数里改状态。** 不会生效(第 3 步实测 `big` 读到的 `seen` 是 `None`)。路由函数只负责返回去向,改状态放进节点,或者等 Day 309 的 `Command`。

**不传 `path_map` 又拼错节点名。** 图不报错,只在日志里打一行「写到未知通道,忽略」,图悄悄结束(第 4 步 `n=3`)。总是传 `path_map`,或者把返回类型标成 `Literal`。

**路由函数忘了写 `return`。** 返回 `None`,运行时抛 `KeyError: None`。读报错时看到 `KeyError` 后面是 `None`,先查路由函数的每个分支都有没有 `return`。

**`path_map` 里的节点名写错。** 这个最好抓,`compile()` 时就抛 `ValueError: ... found unknown target 'ghost'`。

**以为没被走到的分支也测过了。** 41 张真工单没有一张走到 `human`,不手工造一条,这条路通不通你根本不知道(第 5 步)。

## 学习资料

### 文档与文章

- [LangGraph 文档 · Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api):「Conditional edges」一节讲路由函数和映射字典,还提到要同时改状态和路由时推荐 `Command`。读这一小节,10 分钟。
- [LangGraph 文档 · Use the graph API](https://docs.langchain.com/oss/python/langgraph/use-graph-api):有带代码的条件分支示例。
- [LangGraph 参考 · add_conditional_edges](https://reference.langchain.com/python/langgraph/graph/state/StateGraph/add_conditional_edges):方法签名和参数说明。
- [Python 文档 · typing.Literal](https://docs.python.org/3/library/typing.html):在页面里搜 `Literal`,≈ TS 的字符串联合类型。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1z3NY66EY1&autoplay=0&high_quality=1" title="尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>尚硅谷 · 尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战 · 全套约 21 小时(2026 年 10 月查)。我没有逐集看。按旧课笔记里的对应关系,条件分支、path_map 在第 32–34 集,这个对应来自我之前的整理,没有重新核对,按标题找「条件分支」「path_map」几集即可。</figcaption>
</figure>

- 敲代码的码农《挑战19分钟搞定,LangGraph快速入门与原理剖析》(BV1HVFLzfEeS,19 分钟,2026 年查):短,里面有条件边的演示,我没有看全。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/aHCDrAbH_go" title="Building Effective Agents with LangGraph" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Building Effective Agents with LangGraph · 官方频道,英文,开字幕。我只核对了标题和频道,没有逐段看。「Routing」是 Anthropic 那篇文章里的一种工作流模式,和今天的条件边是同一件事。</figcaption>
</figure>

### 书籍

- Mayo Oshin、Nuno Campos,《Learning LangChain: Building AI and LLM Applications with LangChain and LangGraph》,O'Reilly,2025。讲 LangGraph 条件边的章节对应今天的内容,出版时的 API 和现在有出入。我没有核实有无中文版。

### 开源项目与代码

- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):想知道「路由函数返回未知名字为什么只打日志」,搜日志里那句 `wrote to unknown channel`,今天的实测只到现象,我没有读那段源码。

## 自测

1. `add_conditional_edges("classify", route, {"billing": "billing", "other": "human"})` 里,三个参数各是什么?路由函数返回 `"other"` 时去哪个节点?

<details><summary>答案</summary>

从哪个节点出发(`classify`)、路由函数(`route`)、`path_map`(返回值到节点名的翻译)。返回 `"other"` 去 `human` 节点。

</details>

2. 路由函数里写 `state["seen"] = "x"`,后面的节点能读到吗?

<details><summary>答案</summary>

读不到。路由函数的返回值只决定去向,不是状态更新(实测后面节点读到的 `seen` 是 `None`)。要同时改状态和路由,把改动放进节点里,或者用 `Command`(Day 309)。

</details>

3. 路由函数返回了 `path_map` 里没有的值,什么时候、报什么错?`path_map` 里写了不存在的节点名呢?

<details><summary>答案</summary>

前者运行时抛 `KeyError`,比如 `KeyError: 'huge'`。后者在建图(`compile()`)时抛 `ValueError: At 'start' node, 'condition' branch found unknown target 'ghost'`。

</details>

4. 面试题:不传 `path_map`,路由函数返回了一个拼错的节点名,图会怎样?你怎么避免?

<details><summary>答案</summary>

实测不抛异常,日志里打一行 `wrote to unknown channel branch:to:nowhere, ignoring it.`,图在那一步之后悄悄结束。避免的办法:总是传 `path_map`(字典或列表),这样拼错会运行时抛 `KeyError`;或者把路由函数的返回类型标成 `Literal`,类型检查器和图都能看到所有出路;再加一条走到这条边的测试。

</details>

5. 路由函数返回 `["billing", "notify"]` 和返回 `"billing"` 有什么区别?返回 `END` 呢?

<details><summary>答案</summary>

返回列表时两个节点在同一步并行执行(Day 305 的扇出),多个节点写同一个键时要 reducer。返回字符串只去一个节点。返回 `END` 时图直接结束,不去任何分支节点。

</details>

## 明天预告

Day 307 · 第 44 周复习:MCP 与编排(Day 301–306)。这一周从两个节点串起来开始,一路学了 `stream`、三种状态写法、覆盖、reducer、并行、条件边。明天画知识地图,每天一句话回顾,然后做一个只用本周知识的小项目:工单分诊图,账单走并行查证再汇合,其余走模板或转人工,再故意改坏三处,看每一处是怎么被发现(或者没被发现)的。
