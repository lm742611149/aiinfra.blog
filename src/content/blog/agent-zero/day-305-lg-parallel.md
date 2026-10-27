---
title: 'Day 305 · LangGraph(六):并行节点和扇入'
description: '让两个节点从同一个出发点同时跑,再汇合到一个节点:扇出和扇入怎么连、为什么并行写同一个键必须有 reducer、不配会抛什么错。实测三个各睡 0.3 秒的节点并行只要 0.31 秒、并行的节点看不到彼此的写入、合并顺序按节点名字母序而不是谁先跑完、扇入写成两条单独的边会让汇合节点跑两次、一个分支抛异常时另一个的结果还在。'
pubDate: 2026-10-27
regime: none
tags: ['langgraph', 'parallel', 'fan-in', 'reducer', 'python', 'agent-zero']
series: 'agent-zero'
day: 305
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 304](/blog/agent-zero/day-304-lg-reducer/) 学了 reducer:用 `Annotated[list[str], operator.add]` 给字段配合并规则,节点只返回这一步新增的内容;配了 reducer 的字段从空值起步,初始输入也会走一遍 reducer,想清空要用 `Overwrite`;自己写 reducer 就是两个参数(旧值、新值)返回合并后的值;`add_messages` 在拼接之外还会按 id 替换。

昨天结尾留了一句:reducer 是为并行准备的。[Day 303](/blog/agent-zero/day-303-lg-overwrite/) 里两个并行节点写同一个键时报过 `Can receive only one value per step`,当时只说「要用 `Annotated` 的键」,没展开。今天让并行真的跑起来:两个节点同时出发,再汇合到一个节点。依旧不调模型,花费 ¥0。

## 今天要解决的问题

学完今天,你要能做到:

1. 用 `add_edge(START, a)`、`add_edge(START, b)` 让两个节点同时跑,用 `add_edge([a, b], c)` 让 c 等两个都跑完再开始,并说出这两个写法分别叫扇出和扇入。
2. 说出并行的节点写同一个键时为什么必须配 reducer,不配会抛 `InvalidUpdateError`,以及并行写**不同**的键时不需要 reducer。
3. 预测并行的几个实测现象:同一步里的节点看不到彼此的写入、合并顺序由什么决定、扇入写成两条单独的边在什么情况下会让汇合节点跑两次、一个分支抛异常时整张图怎么表现。

预计用时 2.5 小时。今天不调模型,花费 ¥0。前置:[Day 304](/blog/agent-zero/day-304-lg-reducer/)(`operator.add` 当 reducer)、[Day 303](/blog/agent-zero/day-303-lg-overwrite/)(并行写同一个键的报错预告)、[Day 301](/blog/agent-zero/day-301-lg-sequence/)(`stream` 的 `updates` 模式)、[Day 299](/blog/agent-zero/day-299-lg-one-node/)(`part05/lg/s01_tickets.py` 里的 `load_tickets`)、[Day 303](/blog/agent-zero/day-303-lg-overwrite/) 建的 `part05/lg/s04_tickets.py`(`customer_note`、`invoice_note`、`query_one`)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `s06_parallel.py` 里 `build` 函数的五行连线;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

所有命令在 `agent-zero-lab/` 根目录跑(我的是 `/Users/你/agent-zero-lab`)。先重置业务库:

```bash
cd /Users/你/agent-zero-lab
uv run python cloudledger/seed.py
```

<div class="line-notes">

- `uv run python cloudledger/seed.py` 删库重建,输出 `已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}`。今天最后一步和练习 1 要用工单、客户、发票、订阅表。

</div>

## 什么叫「同时跑」

先看你熟悉的东西。前端里 `Promise.all([fetchA(), fetchB()])`:两个请求同时发出,等两个都回来,再往下走。LangGraph 的并行是同一个形状:从一个点分叉出两条路(扇出,fan-out),两条路都走完后汇到一个点(扇入,fan-in)。

LangGraph 里连法很直接:一个节点后面连两条普通边,这两个目标节点就会在**同一步**一起执行。官方文档的说法是「所有这些目标节点会作为下一个 superstep 的一部分并行执行」,同一个 superstep 里的节点算同一步(文档里 superstep 的意思是图执行的一轮离散迭代)。这个词不用背,记住「同一步」就够:前面几天你看到的 `stream` 每个块,串行图里每步只有一个节点,并行图里同一步里会有好几个。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="扇出和扇入:START 连出两条边到 search_kb 和 query_db,两个节点都写 found,reducer 是 operator.add,然后 add_edge 列表形式汇合到 merge,merge 看到两个结果,再到 END">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="95" width="80" height="36" rx="18" fill="none" stroke="var(--rule)"/>
<text x="60" y="118" fill="var(--ink-soft)" text-anchor="middle">START</text>
<rect x="210" y="30" width="140" height="40" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="280" y="55" fill="var(--ink)" text-anchor="middle">search_kb</text>
<rect x="210" y="155" width="140" height="40" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="280" y="180" fill="var(--ink)" text-anchor="middle">query_db</text>
<rect x="440" y="95" width="90" height="36" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="485" y="118" fill="var(--ink)" text-anchor="middle">merge</text>
<rect x="560" y="95" width="60" height="36" rx="18" fill="none" stroke="var(--rule)"/>
<text x="590" y="118" fill="var(--ink-soft)" text-anchor="middle">END</text>
<line x1="100" y1="105" x2="210" y2="52" stroke="var(--ink-soft)"/>
<line x1="100" y1="121" x2="210" y2="172" stroke="var(--ink-soft)"/>
<line x1="350" y1="52" x2="440" y2="105" stroke="var(--ink-soft)"/>
<line x1="350" y1="172" x2="440" y2="121" stroke="var(--ink-soft)"/>
<line x1="530" y1="113" x2="560" y2="113" stroke="var(--ink-soft)"/>
<polygon points="210,52 202,52 206,59" fill="var(--ink-soft)"/>
<polygon points="210,172 202,172 206,165" fill="var(--ink-soft)"/>
<polygon points="440,105 432,100 432,108" fill="var(--ink-soft)"/>
<polygon points="440,121 432,116 432,124" fill="var(--ink-soft)"/>
<polygon points="560,113 552,109 552,117" fill="var(--ink-soft)"/>
<text x="120" y="22" fill="var(--ink-faint)" font-size="11">扇出:同一步一起跑</text>
<text x="360" y="22" fill="var(--ink-faint)" font-size="11">扇入:两个都完成才进 merge</text>
<rect x="140" y="204" width="360" height="20" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="218" fill="var(--ink)" text-anchor="middle" font-size="11">两个节点都写 found,所以 found 必须有 reducer</text>
</g>
</svg>
<figcaption>扇出是从一个点连出多条边,扇入是用列表把多个来源汇到一个节点。中间同一步里的两个节点写同一个字段时,要靠 reducer 合并。</figcaption>
</figure>

## 第 1 步:两个节点同时跑,有 reducer 和没有 reducer

先用最小的例子。两个节点:`search_kb` 假装查知识库,`query_db` 假装查订单库,都往 `found` 这个列表里写一条;`merge` 汇合,打印它看到的 `found`。写两份状态:`Good` 给 `found` 配 `operator.add`,`Bad` 什么都不配。

```python
# agent-zero-lab/part05/lg/s06_parallel.py
"""两个节点从 START 同时出发,在 merge 汇合。有 reducer 正常,没有 reducer 报错。
用法:uv run python -m part05.lg.s06_parallel"""
import operator
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph


class Good(TypedDict):
    found: Annotated[list[str], operator.add]


class Bad(TypedDict):
    found: list[str]


def search_kb(state) -> dict:
    return {"found": ["kb-003 退款政策"]}


def query_db(state) -> dict:
    return {"found": ["INV-0042 已付款"]}


def merge(state) -> dict:
    print("  merge 看到:", state["found"])
    return {}


def build(schema):
    b = StateGraph(schema)
    b.add_node("search_kb", search_kb)
    b.add_node("query_db", query_db)
    b.add_node("merge", merge)
    b.add_edge(START, "search_kb")
    b.add_edge(START, "query_db")
    b.add_edge(["search_kb", "query_db"], "merge")
    b.add_edge("merge", END)
    return b.compile()


if __name__ == "__main__":
    print("有 reducer:")
    out = build(Good).invoke({"found": []})
    print("  最终:", out)
    print("没有 reducer:")
    try:
        build(Bad).invoke({"found": []})
    except Exception as e:
        print(" ", type(e).__name__, "|", str(e).splitlines()[0])
        print("  异常的全部行数:", len(str(e).splitlines()))
        print(str(e))
```

<div class="line-notes">

- `class Good(TypedDict):` 带 reducer 的状态,`found` 是 `Annotated[list[str], operator.add]`,[Day 304](/blog/agent-zero/day-304-lg-reducer/) 的写法。
- `class Bad(TypedDict):` 不带 reducer 的对照版,`found` 就是普通的 `list[str]`。
- `return {"found": ["kb-003 退款政策"]}` `search_kb` 返回的更新:一个只有一条的列表。节点不读旧值,只报自己这一步查到的。
- `return {"found": ["INV-0042 已付款"]}` `query_db` 也往同一个键写一条。两个节点没有先后关系,会在同一步里一起执行。
- `print("  merge 看到:", state["found"])` `merge` 开始时,状态里的 `found` 已经是两个节点合并后的结果。代入实跑值是 `['INV-0042 已付款', 'kb-003 退款政策']`。
- `def build(schema):` 把建图包成函数,传哪种状态就建哪种图,同一套连线跑两遍对比。
- `b.add_edge(START, "search_kb")` 入口连出第一条边。
- `b.add_edge(START, "query_db")` 入口连出第二条边。一个点连出两条普通边,两个目标就在同一步里一起跑,这就是扇出。
- `b.add_edge(["search_kb", "query_db"], "merge")` 第一个参数是列表,意思是「这两个都完成了才进 merge」,这就是扇入。
- `out = build(Good).invoke({"found": []})` 有 reducer 的版本,初始 `found` 给空列表。
- `build(Bad).invoke({"found": []})` 没有 reducer 的版本,同一步里两个节点都写 `found`,框架不知道该听谁的。
- `print(" ", type(e).__name__, "|", str(e).splitlines()[0])` 只打异常类型和第一行。错误信息有两行,第二行是文档链接。

</div>

```bash
uv run python -m part05.lg.s06_parallel
```

```text
有 reducer:
  merge 看到: ['INV-0042 已付款', 'kb-003 退款政策']
  最终: {'found': ['INV-0042 已付款', 'kb-003 退款政策']}
没有 reducer:
  InvalidUpdateError | At key 'found': Can receive only one value per step. Use an Annotated key to handle multiple values.
  异常的全部行数: 2
At key 'found': Can receive only one value per step. Use an Annotated key to handle multiple values.
For troubleshooting, visit: https://docs.langchain.com/oss/python/langgraph/errors/INVALID_CONCURRENT_GRAPH_UPDATE
```

有 reducer 时两条记录都在,`merge` 看到的顺序是 `INV-0042` 在前、`kb-003` 在后,先别管为什么,第 4 步专门讲。没有 reducer 时抛 `InvalidUpdateError`,报错原文说得很清楚:`At key 'found': Can receive only one value per step. Use an Annotated key to handle multiple values.`(`found` 这个键同一步只能收到一个值,要处理多个值请用 `Annotated` 的键)。第二行是 LangGraph 给的文档链接,对应官方的 `INVALID_CONCURRENT_GRAPH_UPDATE` 页面。

对比一下 [Day 303](/blog/agent-zero/day-303-lg-overwrite/):串行时没 reducer 是**悄悄覆盖**(后写的盖掉先写的,不报错),并行时没 reducer 是**直接报错**。我觉得并行这个结果反而是好事,覆盖了你都不知道,报错至少当场炸。

官方对这个错的解释是「并行节点往一个不支持并发更新的状态属性写了东西」,修法一句话:并行的图里,相关的键要配 reducer。

## 第 2 步:并行写不同的键,不需要 reducer

前面的错有个条件:**同一个键**。如果两个并行节点写的是不同的键,框架没有「该听谁的」的问题,不需要 reducer。这一点我自己第一次就没想清楚,以为只要并行就得 reducer,所以在练习 2 里让你亲手验证一遍。简单说:冲突是按键算的,不是按节点算的。

## 第 3 步:真的更快吗,以及并行的节点能不能看到彼此

找三个节点各睡 0.3 秒(`time.sleep(0.3)`),用串行和并行各连一遍,同时让每个节点在开始时打印自己看到的 `found`。

```python
# agent-zero-lab/part05/lg/s06_time.py
"""并行真的省时间吗:三个各睡 0.3 秒的节点,串行 vs 并行;并行的节点能不能看到彼此的写入。
用法:uv run python -m part05.lg.s06_time"""
import operator
import time
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    found: Annotated[list[str], operator.add]


def make(label: str):
    def node(state) -> dict:
        print(f"  {label} 开始时看到 found =", state["found"])
        time.sleep(0.3)
        return {"found": [label]}
    return node


def build(parallel: bool):
    b = StateGraph(State)
    for n in ("a", "b", "c"):
        b.add_node(n, make(n))
    if parallel:
        for n in ("a", "b", "c"):
            b.add_edge(START, n)
            b.add_edge(n, END)
    else:
        b.add_edge(START, "a")
        b.add_edge("a", "b")
        b.add_edge("b", "c")
        b.add_edge("c", END)
    return b.compile()


if __name__ == "__main__":
    for parallel in (False, True):
        print("并行" if parallel else "串行")
        t0 = time.perf_counter()
        out = build(parallel).invoke({"found": []})
        print(f"  共 {time.perf_counter() - t0:.2f} 秒,found = {out['found']}")
```

<div class="line-notes">

- `def make(label: str):` 工厂函数,返回一个节点函数。三个节点除了标签完全一样,用工厂免得写三遍。相当于 JS 里返回箭头函数的高阶函数。
- `print(f"  {label} 开始时看到 found =", state["found"])` 节点一开始就打印它看到的 `found`。这一行是今天第二个观察点。
- `time.sleep(0.3)` 假装做了 0.3 秒的 IO(查库、请求)。`sleep` 期间 Python 线程让出,别的线程可以继续跑。
- `return {"found": [label]}` 返回自己的标签,`found` 配了 `operator.add`,所以会被拼起来。
- `if parallel:` 并行版:三个节点都从 START 出发、都连到 END。三个节点同时出发,各自跑完直接到 END,不需要汇合节点。
- `b.add_edge(START, "a")` 串行版:START → a → b → c → END,一条线。
- `for parallel in (False, True):` 串行、并行各跑一遍,用 `perf_counter` 量时间。

</div>

```bash
uv run python -m part05.lg.s06_time
```

```text
串行
  a 开始时看到 found = []
  b 开始时看到 found = ['a']
  c 开始时看到 found = ['a', 'b']
  共 0.92 秒,found = ['a', 'b', 'c']
并行
  a 开始时看到 found = []
  b 开始时看到 found = []
  c 开始时看到 found = []
  共 0.31 秒,found = ['a', 'b', 'c']
```

两个观察。第一,串行 0.92 秒,并行 0.31 秒,三个 0.3 秒的节点并行只花一个 0.3 秒的时间,说明它们确实是同时跑的(是不是线程池我没看实现,这里只讲实测)。第二,串行时 `b` 开始就看得到 `a` 的结果,`c` 看得到 `a`、`b`;并行时三个节点开始时 `found` 都是空的。**同一步里的节点读到的都是这一步开始之前的状态,看不到同一步里别的节点写了什么**,写入要等这一步全部结束才合并。所以并行节点之间不能互相依赖,有依赖就得连成串。

另外要注意并行不是白送的。节点里是几毫秒的数据库查询的话并行没有收益,第 7 步会实测:41 张工单,串行 87 毫秒,并行 97 毫秒,并行还慢了一点。并行只在节点里是真正的等待(调模型、请求外部接口)时才值得。

## 第 4 步:合并顺序由谁决定

昨天的 `operator.add` 是「旧值 + 新值」,顺序有意义:`[a] + [b]` 和 `[b] + [a]` 不同。两个并行节点同时写,谁排前面?用三个节点实测:A 睡 0.2 秒、B 睡 0.1 秒、C 不睡,所以实际完成顺序是 C、B、A;再换注册顺序、连线顺序各试一遍。

```python
# agent-zero-lab/part05/lg/s06_order.py
"""合并顺序由什么决定:注册顺序、连线顺序、节点名字母序、还是谁先跑完?
用法:uv run python -m part05.lg.s06_order"""
import operator
import time
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    found: Annotated[list[str], operator.add]


def make(label: str, delay: float):
    def node(state) -> dict:
        time.sleep(delay)
        return {"found": [label]}
    return node


def run(order_of_add: list[tuple[str, float]], order_of_edges: list[str]) -> list[str]:
    b = StateGraph(State)
    for name, delay in order_of_add:
        b.add_node(name, make(name, delay))
    for name in order_of_edges:
        b.add_edge(START, name)
    b.add_edge([n for n, _ in order_of_add], END)
    return b.compile().invoke({"found": []})["found"]


if __name__ == "__main__":
    print("A 慢 C 快,注册 A B C,连线 A B C:", run([("A", 0.2), ("B", 0.1), ("C", 0.0)], ["A", "B", "C"]))
    print("同上但注册 C B A,连线 C B A:    ", run([("C", 0.0), ("B", 0.1), ("A", 0.2)], ["C", "B", "A"]))
    print("同上但连线顺序 B C A:            ", run([("A", 0.2), ("B", 0.1), ("C", 0.0)], ["B", "C", "A"]))
    print("全不睡,节点名 zeta mid alpha:    ", run([("zeta", 0), ("mid", 0), ("alpha", 0)], ["zeta", "mid", "alpha"]))
```

<div class="line-notes">

- `def make(label: str, delay: float):` 和上一步一样的工厂,多了一个睡多久的参数。
- `def run(order_of_add: list[tuple[str, float]], order_of_edges: list[str]) -> list[str]:` 两个参数分别控制「`add_node` 的先后」和「`add_edge(START, ...)` 的先后」,返回最后的 `found`。
- `for name, delay in order_of_add:` 按给定顺序注册节点。
- `for name in order_of_edges:` 按给定顺序连 START 的边。
- `b.add_edge([n for n, _ in order_of_add], END)` 三个节点都到 END,用列表扇入。
- `print("A 慢 C 快,注册 A B C,连线 A B C:", run(` 第一组:A 最慢,C 最快。如果按完成顺序合并,结果应该是 C B A。
- `print("同上但注册 C B A,连线 C B A:    ", run(` 第二组:注册顺序、连线顺序都倒过来。
- `print("同上但连线顺序 B C A:            ", run(` 第三组:只改连线顺序。
- `print("全不睡,节点名 zeta mid alpha:    ", run(` 第四组:全不睡,节点名换成不按字母顺序登记的三个名字,看是不是名字决定顺序。

</div>

```bash
uv run python -m part05.lg.s06_order
```

```text
A 慢 C 快,注册 A B C,连线 A B C: ['A', 'B', 'C']
同上但注册 C B A,连线 C B A:     ['A', 'B', 'C']
同上但连线顺序 B C A:             ['A', 'B', 'C']
全不睡,节点名 zeta mid alpha:     ['alpha', 'mid', 'zeta']
```

四组结果都是按节点名的字母顺序合并:A、B、C 永远是这个顺序,不管谁先跑完、谁先注册、谁先连线;第四组 `zeta`、`mid`、`alpha` 注册,结果是 `alpha`、`mid`、`zeta`。这是 langgraph 1.2.18 上的实测。官方 Graph API 文档没有说并行写同一个键时 reducer 的应用顺序,所以**这个顺序是实现细节,别依赖它**。如果你的 reducer 对顺序敏感(比如拼对话),要么让并行的结果分别放进不同字段,要么在汇合节点里自己排序。

「谁先跑完」在哪里能看到?在 `stream` 里。下面用 `stream` 看一个慢一个快:

```python
# agent-zero-lab/part05/lg/s06_stream.py
"""用 stream 看并行:两个节点的更新出现在同一步吗?谁先谁后?
用法:uv run python -m part05.lg.s06_stream"""
import operator
import time
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    found: Annotated[list[str], operator.add]


def slow(state) -> dict:
    time.sleep(0.3)
    return {"found": ["slow(睡 0.3 秒)"]}


def fast(state) -> dict:
    return {"found": ["fast(不睡)"]}


def merge(state) -> dict:
    return {}


b = StateGraph(State)
b.add_node("slow", slow)
b.add_node("fast", fast)
b.add_node("merge", merge)
b.add_edge(START, "slow")
b.add_edge(START, "fast")
b.add_edge(["slow", "fast"], "merge")
b.add_edge("merge", END)
graph = b.compile()

if __name__ == "__main__":
    t0 = time.perf_counter()
    for chunk in graph.stream({"found": []}, stream_mode="updates"):
        print(f"{time.perf_counter() - t0:.2f}s", chunk)
    for i in range(3):
        print("第", i + 1, "次最终 found:", graph.invoke({"found": []})["found"])
```

<div class="line-notes">

- `time.sleep(0.3)` `slow` 节点睡 0.3 秒,返回 `slow(睡 0.3 秒)`。
- `return {"found": ["fast(不睡)"]}` `fast` 节点不睡,马上返回。
- `b.add_edge(["slow", "fast"], "merge")` 两个都完成才进 `merge`。`merge` 什么都不返回(返回 `{}`)。
- `t0 = time.perf_counter()` 开始计时。
- `for chunk in graph.stream({"found": []}, stream_mode="updates"):` `updates` 模式,每个节点完成就产出一个块,形状是 `{节点名: 更新}`([Day 301](/blog/agent-zero/day-301-lg-sequence/) 学过)。
- `print(f"{time.perf_counter() - t0:.2f}s", chunk)` 每个块前面带上它出现的时间。
- `for i in range(3):` 再 `invoke` 三次,看最终 `found` 稳不稳定。

</div>

```bash
uv run python -m part05.lg.s06_stream
```

```text
0.00s {'fast': {'found': ['fast(不睡)']}}
0.31s {'slow': {'found': ['slow(睡 0.3 秒)']}}
0.31s {'merge': None}
第 1 次最终 found: ['fast(不睡)', 'slow(睡 0.3 秒)']
第 2 次最终 found: ['fast(不睡)', 'slow(睡 0.3 秒)']
第 3 次最终 found: ['fast(不睡)', 'slow(睡 0.3 秒)']
```

`fast` 的块在 0.00 秒就出现了,`slow` 的块等到 0.31 秒,`merge` 紧跟在后面,它返回空字典,所以更新显示成 `None`。**块出现的顺序是完成顺序,最终 `found` 里的顺序是合并顺序**,两件事不是一回事。这里 `fast` 排在 `slow` 前,可以说是巧合(`f` 排在 `s` 前)也可以说是字母序,上一组实验才证明了是后者。

## 第 5 步:扇入的两种写法

扇入有两种写法,一个用列表:`add_edge(["a", "b"], "merge")`;一个写两条单独的边:`add_edge("a", "merge")`、`add_edge("b", "merge")`。旧课里我写过一句「两条单独的边也能跑,但语义不同」,这次实测看看到底不同在哪。构造一个两条分支长度不同的图:`short` 一步,`long1 → long2` 两步,都汇到 `merge`。

```python
# agent-zero-lab/part05/lg/s06_fanin.py
"""扇入的两种写法:一条分支 1 步、另一条 2 步时,merge 跑几次?
用法:uv run python -m part05.lg.s06_fanin"""
import operator
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    log: Annotated[list[str], operator.add]


def node(name: str):
    def fn(state) -> dict:
        return {"log": [name]}
    return fn


def build(list_form: bool):
    b = StateGraph(State)
    for n in ("short", "long1", "long2", "merge"):
        b.add_node(n, node(n))
    b.add_edge(START, "short")
    b.add_edge(START, "long1")
    b.add_edge("long1", "long2")
    if list_form:
        b.add_edge(["short", "long2"], "merge")
    else:
        b.add_edge("short", "merge")
        b.add_edge("long2", "merge")
    b.add_edge("merge", END)
    return b.compile()


if __name__ == "__main__":
    for list_form in (True, False):
        g = build(list_form)
        print("列表写法" if list_form else "两条单独的边")
        for chunk in g.stream({"log": []}, stream_mode="updates"):
            print("  ", chunk)
        print("  最终 log:", g.invoke({"log": []})["log"])
```

<div class="line-notes">

- `log: Annotated[list[str], operator.add]` 每个节点往 `log` 里写自己的名字,最后看谁跑了几次。
- `def node(name: str):` 工厂函数,返回一个「把自己名字写进 log」的节点。
- `for n in ("short", "long1", "long2", "merge"):` 四个节点都用工厂登记。
- `b.add_edge(START, "short")` 第一条分支:`short` 一步。
- `b.add_edge(START, "long1")` 第二条分支开始。
- `b.add_edge("long1", "long2")` 第二条分支有两步,所以比第一条长。
- `b.add_edge(["short", "long2"], "merge")` 列表写法:等 `short` 和 `long2` **都**完成才进 `merge`。
- `b.add_edge("short", "merge")` 单独写法的第一条边:`short` 完成就触发 `merge`。
- `b.add_edge("long2", "merge")` 单独写法的第二条边:`long2` 完成再触发一次 `merge`。
- `for chunk in g.stream({"log": []}, stream_mode="updates"):` 用 `stream` 看 `merge` 出现几次。

</div>

```bash
uv run python -m part05.lg.s06_fanin
```

```text
列表写法
   {'long1': {'log': ['long1']}}
   {'short': {'log': ['short']}}
   {'long2': {'log': ['long2']}}
   {'merge': {'log': ['merge']}}
  最终 log: ['long1', 'short', 'long2', 'merge']
两条单独的边
   {'long1': {'log': ['long1']}}
   {'short': {'log': ['short']}}
   {'long2': {'log': ['long2']}}
   {'merge': {'log': ['merge']}}
   {'merge': {'log': ['merge']}}
  最终 log: ['long1', 'short', 'long2', 'merge', 'merge']
```

列表写法 `merge` 出现一次,等两条分支都走完;两条单独的边,`merge` 出现**两次**:第一步 `short` 完成时触发一次,`long2` 完成时又触发一次,`log` 里就有两个 `merge`。如果 `merge` 里是「发邮件」「扣费」这种动作,就会做两遍。

什么时候两种写法没区别?两条分支一样长的时候,两个来源在同一步完成,同一步里触发一次。后面第 7 步和 Day 307 的小项目里就是这种情况,所以你会发现单独写也「碰巧」对,这是个坑:**测试里要有一个分支长度不一样的场景,才抓得到**。要汇合就用列表写法。

## 第 6 步:一个分支抛异常了

并行的两个节点,一个正常,一个抛 `RuntimeError`。图整体怎么表现?正常节点的结果还在吗?

```python
# agent-zero-lab/part05/lg/s06_branch_fail.py
"""并行的两个节点里,一个抛异常,另一个的结果还在吗?
用法:uv run python -m part05.lg.s06_branch_fail"""
import operator
import time
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    found: Annotated[list[str], operator.add]


def ok(state) -> dict:
    time.sleep(0.1)
    print("  ok 节点跑完了")
    return {"found": ["ok 的结果"]}


def boom(state) -> dict:
    raise RuntimeError("查订单库超时")


b = StateGraph(State)
b.add_node("ok", ok)
b.add_node("boom", boom)
b.add_edge(START, "ok")
b.add_edge(START, "boom")
b.add_edge("ok", END)
b.add_edge("boom", END)
graph = b.compile()

if __name__ == "__main__":
    try:
        graph.invoke({"found": []})
    except RuntimeError as e:
        print("invoke 抛出:", type(e).__name__, e)
    print("stream 拿到的块:")
    try:
        for chunk in graph.stream({"found": []}, stream_mode="updates"):
            print("  ", chunk)
    except RuntimeError as e:
        print("  然后抛出:", e)
```

<div class="line-notes">

- `time.sleep(0.1)` `ok` 节点睡 0.1 秒,确保它比 `boom` 慢,看它会不会被异常打断。
- `print("  ok 节点跑完了")` 节点里的打印,用来确认它有没有跑完。
- `raise RuntimeError("查订单库超时")` `boom` 一开始就抛异常。
- `graph.invoke({"found": []})` `invoke` 拿不到任何结果,只拿到异常。
- `except RuntimeError as e:` 异常原样抛出来,类型还是 `RuntimeError`,没有被框架包装。
- `for chunk in graph.stream({"found": []}, stream_mode="updates"):` `stream` 的好处:异常抛出之前已经产出的块读得到。

</div>

```bash
uv run python -m part05.lg.s06_branch_fail
```

```text
  ok 节点跑完了
invoke 抛出: RuntimeError 查订单库超时
stream 拿到的块:
  ok 节点跑完了
   {'ok': {'found': ['ok 的结果']}}
  然后抛出: 查订单库超时
```

三点:一,`ok` 节点跑完了(打印出现了两次,`invoke` 一次,`stream` 一次);二,异常原样抛出,`invoke` 只给你异常,拿不到 `ok` 的结果;三,`stream` 能在异常抛出前拿到 `ok` 的更新块。这次 `ok` 的块出现在异常之前,我只跑了这一次,框架对「一个失败时别的节点怎么处理」的细节我没读源码,别依赖「一定能拿到」。想让整张图稳稳地继续,办法是在节点里自己 `try/except`,把失败写进状态里的 `errors` 字段(练习 4)。

## 第 7 步:41 张真工单

回到业务库。每张工单并行做两件事:查客户所在公司(`customer_note`)、查客户未付发票数(`invoice_note`),都是 [Day 303](/blog/agent-zero/day-303-lg-overwrite/) 在 `s04_tickets.py` 里写的。`summarize` 汇合,把两条记录排序后拼成一句。同时建串行版,对比结果和耗时。

```python
# agent-zero-lab/part05/lg/s06_tickets.py
"""41 张真工单:查客户和查发票并行,再汇合成一张摘要;和串行版对比结果与耗时。
用法:uv run python -m part05.lg.s06_tickets"""
import operator
import time
from collections import Counter
from typing import Annotated, NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph

from part05.lg.s01_tickets import load_tickets
from part05.lg.s04_tickets import customer_note, invoice_note


class State(TypedDict):
    ticket_id: str
    notes: Annotated[list[str], operator.add]
    summary: NotRequired[str]


def look_customer(state: State) -> dict:
    return {"notes": [customer_note(state["ticket_id"])]}


def look_invoices(state: State) -> dict:
    return {"notes": [invoice_note(state["ticket_id"])]}


def summarize(state: State) -> dict:
    return {"summary": " | ".join(sorted(state["notes"]))}


def build(parallel: bool):
    b = StateGraph(State)
    b.add_node("look_customer", look_customer)
    b.add_node("look_invoices", look_invoices)
    b.add_node("summarize", summarize)
    if parallel:
        b.add_edge(START, "look_customer")
        b.add_edge(START, "look_invoices")
        b.add_edge(["look_customer", "look_invoices"], "summarize")
    else:
        b.add_edge(START, "look_customer")
        b.add_edge("look_customer", "look_invoices")
        b.add_edge("look_invoices", "summarize")
    b.add_edge("summarize", END)
    return b.compile()


if __name__ == "__main__":
    ids = [i for i, _ in load_tickets()]
    outs, ms = {}, {}
    for parallel in (False, True):
        g = build(parallel)
        t0 = time.perf_counter()
        outs[parallel] = [g.invoke({"ticket_id": i, "notes": []}) for i in ids]
        ms[parallel] = (time.perf_counter() - t0) * 1000
    print(f"串行 {ms[False]:.0f} 毫秒,并行 {ms[True]:.0f} 毫秒")
    print("两种写法 summary 全部一致:", [o["summary"] for o in outs[False]] == [o["summary"] for o in outs[True]])
    print("notes 条数分布:", dict(Counter(len(o["notes"]) for o in outs[True])))
    print("T1001:", outs[True][0])
```

<div class="line-notes">

- `from part05.lg.s04_tickets import customer_note, invoice_note` 复用 [Day 303](/blog/agent-zero/day-303-lg-overwrite/) 的两个查库函数,返回 `客户:白塔印务`、`未付发票:0 张` 这样的字符串。
- `notes: Annotated[list[str], operator.add]` 两个并行节点都写 `notes`,所以配 `operator.add`。
- `summary: NotRequired[str]` 汇合节点才写,初始输入里不提供,所以标 `NotRequired`。
- `return {"notes": [customer_note(state["ticket_id"])]}` 节点只返回自己查到的一条,不读旧值。
- `return {"summary": " | ".join(sorted(state["notes"]))}` 汇合节点读两条记录,先 `sorted` 再用 ` | ` 拼起来。排序是为了让串行、并行两个版本的 `summary` 一样,不依赖前面讲的合并顺序。
- `def build(parallel: bool):` 同一套节点,按参数选并行或串行连线。
- `b.add_edge(["look_customer", "look_invoices"], "summarize")` 并行版的扇入,用列表写法。
- `b.add_edge("look_customer", "look_invoices")` 串行版:先查客户,再查发票,再汇总。
- `outs[parallel] = [g.invoke({"ticket_id": i, "notes": []}) for i in ids]` 41 张工单各 `invoke` 一次。
- `print("两种写法 summary 全部一致:",` 对账:41 张的 `summary` 串行版和并行版必须全部相同。

</div>

```bash
uv run python -m part05.lg.s06_tickets
```

```text
串行 87 毫秒,并行 97 毫秒
两种写法 summary 全部一致: True
notes 条数分布: {2: 41}
T1001: {'ticket_id': 'T1001', 'notes': ['客户:白塔印务', '未付发票:0 张'], 'summary': '客户:白塔印务 | 未付发票:0 张'}
```

两个版本的 41 条 `summary` 完全一致,每张工单 2 条 `notes`。耗时:串行 87 毫秒,并行 97 毫秒(每次不同,我连跑几次并行都不比串行快)。原因是这两个查询每次几毫秒,线程调度的开销比省下来的时间还多。到 Day 311 节点里真的调模型时(一次几百毫秒到几秒),并行才有意义。今天的收获是「能并行」,不是「该并行」。

## 零件 → 大代码对照表

| 零件 | 在哪个脚本 | 说明 |
| --- | --- | --- |
| 扇出:START 连两条边 | `s06_parallel.py` | 两个节点同一步一起跑 |
| 扇入:`add_edge([a, b], c)` | `s06_parallel.py`、`s06_fanin.py` | 等来源都完成才进 c |
| 并行写同一个键必须 reducer | `s06_parallel.py` | 不配抛 `InvalidUpdateError` |
| 并行时的快慢、互相看不到 | `s06_time.py` | 0.92 秒对 0.31 秒;开始时 `found` 都是空 |
| 合并顺序 | `s06_order.py` | 按节点名字母序,文档没承诺 |
| 单独两条边会跑两次 | `s06_fanin.py` | 分支长度不同时 |
| 分支抛异常 | `s06_branch_fail.py` | `invoke` 只拿异常,`stream` 能拿到之前的块 |
| 41 张真工单 | `s06_tickets.py` | 结果一致,并行没更快 |

## 动手练习

### 练习 1:三路并行

在 `s06_tickets.py` 的基础上,再加一个并行节点 `look_plan`,查这张工单客户的订阅套餐和状态(`subscriptions` 表的 `plan`、`status`),记成 `套餐:专业版(active)` 这样的字符串。三个节点都到一个 `collect` 节点汇合。对 41 张工单跑一遍,说出 `notes` 的条数分布,并打印 T1001 的 `notes`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex305_three_way.py
"""练习 1:在 s06_tickets 的基础上加第三个并行节点,查订阅套餐。
用法:uv run python -m part05.lg.ex305_three_way"""
import operator
from collections import Counter
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph

from part05.lg.s01_tickets import load_tickets
from part05.lg.s04_tickets import customer_note, invoice_note, query_one


class State(TypedDict):
    ticket_id: str
    notes: Annotated[list[str], operator.add]


def look_plan(state: State) -> dict:
    row = query_one(
        "SELECT s.plan, s.status FROM tickets t JOIN subscriptions s ON s.customer_id = t.customer_id "
        "WHERE t.id = ?",
        (state["ticket_id"],),
    )
    return {"notes": [f"套餐:{row[0]}({row[1]})"]}


def look_customer(state: State) -> dict:
    return {"notes": [customer_note(state["ticket_id"])]}


def look_invoices(state: State) -> dict:
    return {"notes": [invoice_note(state["ticket_id"])]}


def collect(state: State) -> dict:
    return {}


b = StateGraph(State)
b.add_node("look_customer", look_customer)
b.add_node("look_invoices", look_invoices)
b.add_node("look_plan", look_plan)
b.add_node("collect", collect)
for name in ("look_customer", "look_invoices", "look_plan"):
    b.add_edge(START, name)
b.add_edge(["look_customer", "look_invoices", "look_plan"], "collect")
b.add_edge("collect", END)
graph = b.compile()

if __name__ == "__main__":
    ids = [i for i, _ in load_tickets()]
    outs = [graph.invoke({"ticket_id": i, "notes": []}) for i in ids]
    print("notes 条数分布:", dict(Counter(len(o["notes"]) for o in outs)))
    print("T1001 的 notes(顺序是节点名字母序):", outs[0]["notes"])
```

<div class="line-notes">

- `from part05.lg.s04_tickets import customer_note, invoice_note, query_one` 除了两个查库函数,还借用了 `query_one`,它收 SQL 和参数,返回第一行。
- `row = query_one(` 查订阅:工单表连订阅表,条件是工单号。
- `return {"notes": [f"套餐:{row[0]}({row[1]})"]}` `row[0]` 是套餐名,`row[1]` 是状态。T1001 查出来是 `专业版`、`active`。
- `for name in ("look_customer", "look_invoices", "look_plan"):` 三个节点都从 START 连出来,三路扇出。
- `b.add_edge(["look_customer", "look_invoices", "look_plan"], "collect")` 列表里放三个来源,三个都完成才进 `collect`。
- `print("notes 条数分布:", dict(Counter(len(o["notes"]) for o in outs)))` 41 张都是 3 条。

</div>

```text
notes 条数分布: {3: 41}
T1001 的 notes(顺序是节点名字母序): ['客户:白塔印务', '未付发票:0 张', '套餐:专业版(active)']
```

`notes` 全是 3 条。T1001 的三条按字母序 `look_customer`、`look_invoices`、`look_plan` 排,和第 4 步的结论一致。

</details>

### 练习 2:并行写不同的键

做一个状态 `kb: str`、`db: str`(都不配 reducer),`search_kb` 写 `kb`,`query_db` 写 `db`,两个都从 START 出发、都直接到 END。先预测会不会报错,再跑。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex305_diff_keys.py
"""练习 2:并行的两个节点写不同的键,要不要 reducer?
用法:uv run python -m part05.lg.ex305_diff_keys"""
from typing import TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict, total=False):
    kb: str
    db: str


def search_kb(state: State) -> dict:
    return {"kb": "kb-003 退款政策"}


def query_db(state: State) -> dict:
    return {"db": "INV-0042 已付款"}


b = StateGraph(State)
b.add_node("search_kb", search_kb)
b.add_node("query_db", query_db)
b.add_edge(START, "search_kb")
b.add_edge(START, "query_db")
b.add_edge("search_kb", END)
b.add_edge("query_db", END)
graph = b.compile()

if __name__ == "__main__":
    print(graph.invoke({}))
```

<div class="line-notes">

- `class State(TypedDict, total=False):` `total=False` 让所有键都变成可选,这样 `invoke({})` 不用传初始值。
- `return {"kb": "kb-003 退款政策"}` 只写 `kb`。
- `return {"db": "INV-0042 已付款"}` 只写 `db`,和上面的键不同。
- `b.add_edge(START, "search_kb")` 两个节点都从 START 出发,同一步跑。
- `print(graph.invoke({}))` 初始状态给空字典。

</div>

```text
{'kb': 'kb-003 退款政策', 'db': 'INV-0042 已付款'}
```

不报错,两个键都有值。冲突是按键算的:同一步里同一个键收到两个值才算冲突,各写各的就没事。

</details>

### 练习 3:去重 reducer 对比拼接

两个并行节点都打 `has_customer` 标签,第二个还多打 `has_open_invoice`。状态里放两个字段,一个配 `operator.add`,一个配自己写的 `merge_unique`(旧值 + 新值里不在旧值中的项),看区别。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex305_dedupe.py
"""练习 3:两个并行节点都打同一个标签,用自己写的去重 reducer 合并。
用法:uv run python -m part05.lg.ex305_dedupe"""
import operator
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph


def merge_unique(old: list[str], new: list[str]) -> list[str]:
    return old + [x for x in new if x not in old]


class State(TypedDict):
    tags_add: Annotated[list[str], operator.add]
    tags_unique: Annotated[list[str], merge_unique]


def a(state: State) -> dict:
    return {"tags_add": ["has_customer"], "tags_unique": ["has_customer"]}


def b_node(state: State) -> dict:
    return {"tags_add": ["has_customer", "has_open_invoice"], "tags_unique": ["has_customer", "has_open_invoice"]}


b = StateGraph(State)
b.add_node("a", a)
b.add_node("b", b_node)
b.add_edge(START, "a")
b.add_edge(START, "b")
b.add_edge("a", END)
b.add_edge("b", END)
graph = b.compile()

if __name__ == "__main__":
    print(graph.invoke({"tags_add": [], "tags_unique": []}))
```

<div class="line-notes">

- `def merge_unique(old: list[str], new: list[str]) -> list[str]:` [Day 304](/blog/agent-zero/day-304-lg-reducer/) 的去重 reducer。
- `return old + [x for x in new if x not in old]` 把新值里已经在旧值里的项剔掉再拼。
- `tags_add: Annotated[list[str], operator.add]` 这个字段直接拼接。
- `tags_unique: Annotated[list[str], merge_unique]` 这个字段拼接并去重。
- `return {"tags_add": ["has_customer"], "tags_unique": ["has_customer"]}` 节点 `a` 对两个字段写同样的值。
- `def b_node(state: State) -> dict:` 函数名加 `_node`,是因为变量 `b` 已经被建图的 `StateGraph` 用掉了。
- `print(graph.invoke({"tags_add": [], "tags_unique": []}))` 两个字段都用空列表起步。

</div>

```text
{'tags_add': ['has_customer', 'has_customer', 'has_open_invoice'], 'tags_unique': ['has_customer', 'has_open_invoice']}
```

`tags_add` 里 `has_customer` 出现两次,`tags_unique` 只一次。并行节点常常会重复地打同一个标签,去重 reducer 比事后处理省事。

</details>

### 练习 4:失败不要拖垮整张图

并行的两个节点,一个正常、一个必失败。要求整张图不抛异常:失败的节点自己捕获,把错误写进 `errors` 字段;汇合节点打印「全部成功」或「部分成功」。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex305_errors_field.py
"""练习 4:并行节点之一失败时,别让整张图崩,把失败记到 errors 字段里。
用法:uv run python -m part05.lg.ex305_errors_field"""
import operator
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    found: Annotated[list[str], operator.add]
    errors: Annotated[list[str], operator.add]


def ok(state: State) -> dict:
    return {"found": ["ok 的结果"]}


def flaky(state: State) -> dict:
    try:
        raise RuntimeError("查订单库超时")
    except RuntimeError as e:
        return {"errors": [f"flaky: {e}"]}


def report(state: State) -> dict:
    status = "部分成功" if state["errors"] else "全部成功"
    print(f"  report: {status},found={state['found']},errors={state['errors']}")
    return {}


b = StateGraph(State)
b.add_node("ok", ok)
b.add_node("flaky", flaky)
b.add_node("report", report)
b.add_edge(START, "ok")
b.add_edge(START, "flaky")
b.add_edge(["ok", "flaky"], "report")
b.add_edge("report", END)
graph = b.compile()

if __name__ == "__main__":
    out = graph.invoke({"found": [], "errors": []})
    print("最终:", out)
```

<div class="line-notes">

- `errors: Annotated[list[str], operator.add]` 错误也是并行写的,所以同样要 reducer。
- `raise RuntimeError("查订单库超时")` 模拟查询失败。
- `except RuntimeError as e:` 节点自己接住异常。
- `return {"errors": [f"flaky: {e}"]}` 把失败写进 `errors`,并带上节点名。这样节点正常返回了一个更新,框架看来这一步是成功的。
- `status = "部分成功" if state["errors"] else "全部成功"` 汇合节点根据 `errors` 有没有内容判断。
- `b.add_edge(["ok", "flaky"], "report")` 两个来源都「成功」返回了,所以 `report` 会跑。
- `out = graph.invoke({"found": [], "errors": []})` 两个列表字段都给空起步。

</div>

```text
  report: 部分成功,found=['ok 的结果'],errors=['flaky: 查订单库超时']
最终: {'found': ['ok 的结果'], 'errors': ['flaky: 查订单库超时']}
```

验收:`invoke` 不抛异常,`found` 里有 `ok` 的结果,`errors` 里有失败原因。这是并行调用外部服务时常用的写法。

</details>

验收标准:四道题的脚本都能跑通;能默写 `s06_parallel.py` 里的五行连线,并说出 `add_edge([a, b], c)` 和两条单独的边的区别。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 扇出(fan-out) | 一个节点连出多条边,目标节点同一步一起跑。≈ `Promise.all` 发出多个请求 |
| 扇入(fan-in) | 多个节点汇到一个节点。用 `add_edge([a, b], c)` 表示等 a、b 都完成才进 c。≈ `Promise.all` 等全部回来 |
| superstep | LangGraph 执行的一轮。同一轮里并行的节点读到的是这一轮开始前的状态,写入在这一轮结束时合并 |
| `InvalidUpdateError` | 并行节点同一步写同一个没配 reducer 的键时抛的异常。官方文档页是 `INVALID_CONCURRENT_GRAPH_UPDATE` |
| 并行(这里) | 同一步里的多个节点同时执行。三个各睡 0.3 秒的节点实测总共 0.31 秒 |
| `total=False` | `TypedDict` 的一个参数,让所有键都变成可选 |

## 常见误区

**以为只要并行就得配 reducer。** 并行写**同一个键**才要;各写各的键(练习 2)不需要,实测不报错。

**以为并行的节点能看到彼此的结果。** 同一步里的节点读到的都是这一步开始前的状态,实测三个节点开始时 `found` 都是 `[]`。有依赖就连成串。

**依赖并行节点的合并顺序。** 实测是按节点名字母序,和谁先完成、谁先注册、谁先连线都无关,但官方文档没承诺这点。对顺序敏感的 reducer(比如拼对话)不要让并行节点直接写进去。

**扇入写成两条单独的边。** 两条分支长度不同时,汇合节点会跑两次(第 5 步实测 `merge` 出现两次)。两条分支恰好一样长时单独写也碰巧对,更容易让人以为没问题。要汇合就写 `add_edge([a, b], c)`。

**以为并行一定更快。** 节点里只是几毫秒的数据库查询时,并行反而慢一点(第 7 步实测串行 87 毫秒、并行 97 毫秒)。节点里是调模型、请求外部接口这种要等的操作,并行才有收益。

**让一个并行节点抛异常,指望其他节点的结果还在。** `invoke` 只给你异常。想让图继续,在节点里自己捕获,把错误写进状态的 `errors` 字段。

## 学习资料

### 文档与文章

- [LangGraph 文档 · Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api):讲节点可以有多条出边,「目标节点会在下一个 superstep 并行执行」。官方没有写并行时 reducer 的应用顺序,所以第 4 步的结论是我实测的,不是文档说的。读「Edges」一节,15 分钟。
- [LangGraph 文档 · INVALID_CONCURRENT_GRAPH_UPDATE](https://docs.langchain.com/oss/python/langgraph/errors/INVALID_CONCURRENT_GRAPH_UPDATE):今天第 1 步那个报错的官方说明,只有几行,读完就知道修法。
- [LangGraph 文档 · Use the graph API](https://docs.langchain.com/oss/python/langgraph/use-graph-api):带代码的做法,里面有并行分支的完整示例。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1z3NY66EY1&autoplay=0&high_quality=1" title="尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>尚硅谷 · 尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战 · 全套约 21 小时(2026 年 10 月查)。我没有逐集看。按旧课笔记里的对应关系,节点的并行执行在第 21 集、静态扇入在第 38 集,这个对应来自我之前的整理,没有重新核对,按标题找「并行」「扇入」几集即可。</figcaption>
</figure>

- 敲代码的码农《挑战19分钟搞定,LangGraph快速入门与原理剖析》(BV1HVFLzfEeS,19 分钟,2026 年查):短,适合先看一遍建立整体印象。我没有看全。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/aHCDrAbH_go" title="Building Effective Agents with LangGraph" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Building Effective Agents with LangGraph · 官方频道,英文,开字幕。我只核对了标题和频道,没有逐段看。「Parallelization」是 Anthropic 那篇文章里的一种工作流模式,可以对照今天的扇出扇入看。</figcaption>
</figure>

### 书籍

- Mayo Oshin、Nuno Campos,《Learning LangChain: Building AI and LLM Applications with LangChain and LangGraph》,O'Reilly,2025。讲 LangGraph 并行节点的章节对应今天的内容,出版时的 API 和现在有出入。我没有核实有无中文版。

### 开源项目与代码

- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):今天的合并顺序实测结果可以对照源码里 `Pregel` 的写入合并部分去找原因,我没有读过那一段,不保证怎么找。

## 自测

1. 一个节点同时连出两条普通边,目标节点是串行还是并行?怎么让后面的节点等它们都完成?

<details><summary>答案</summary>

并行,在同一步一起执行。后面的节点用 `add_edge([a, b], c)`(列表写法)连,意思是等 a 和 b 都完成才进 c。

</details>

2. 两个并行节点都写 `found`,没配 reducer,会怎样?如果一个写 `kb` 一个写 `db` 呢?

<details><summary>答案</summary>

前者抛 `InvalidUpdateError: At key 'found': Can receive only one value per step. Use an Annotated key to handle multiple values.`。后者不报错,冲突按键算,各写各的就没事。

</details>

3. 并行的节点 `b` 能读到同一步里节点 `a` 刚写进状态的内容吗?

<details><summary>答案</summary>

读不到。同一步里的节点读到的都是这一步开始之前的状态,写入要等这一步结束才合并。实测三个并行节点开始时 `found` 都是 `[]`。

</details>

4. 面试题:两个分支一条 1 步、一条 2 步,汇合节点写成了两条单独的边而不是列表,会出什么问题?为什么在两条分支一样长时没发现?

<details><summary>答案</summary>

汇合节点会跑两次:第一条分支完成时触发一次,第二条分支完成时再触发一次。如果汇合节点里有发邮件、扣费之类的副作用,就做了两遍。两条分支一样长时,两个来源在同一步完成,同一步里只触发一次,所以碰巧没问题,测试里没有分支长度不同的场景就发现不了。要汇合用列表写法 `add_edge([a, b], c)`。

</details>

5. 三个并行节点写同一个列表字段,配 `operator.add`,最终列表里的顺序取决于什么?能依赖吗?

<details><summary>答案</summary>

langgraph 1.2.18 上实测按节点名字母序,和谁先完成、注册顺序、连线顺序无关。官方文档没有承诺,不能依赖。对顺序敏感时让并行节点写不同字段,或者在汇合节点里自己排序。

</details>

## 明天预告

Day 306 · LangGraph(七):条件边和 `path_map`。今天的连线都是写死的,一条边永远去同一个地方。真实的工单流要「看分类结果决定下一站」:账单走账单分支,退款走退款分支,别的转人工。明天学 `add_conditional_edges`:路由函数怎么写、`path_map` 把返回值翻译成节点名,以及它出错时的几种样子。
