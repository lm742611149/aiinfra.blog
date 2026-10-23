---
title: 'Day 301 · LangGraph(二):两个节点串起来,用 stream 看每一步'
description: '一个节点太简单,真实的流程至少是「分类、起草」两步。今天把两个节点串起来,看第二个节点怎么读到第一个节点写下的字段;再用 add_sequence 省掉重复的连线;最后用 stream 代替 invoke,每个节点跑完就拿到它改了什么,并实测节点中途出错时两者各拿到什么、顺序写反时为什么不报错。'
pubDate: 2026-10-23
regime: none
tags: ['langgraph', 'state-graph', 'stream', 'orchestration', 'python', 'agent-zero']
series: 'agent-zero'
day: 301
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 300](/blog/agent-zero/day-300-week43-review/) 是第 43 周的复习日。小项目「上线门禁」用 Day 299 的六步骨架做了一个单节点图:一个节点里同时检查 skill 目录和一批模型写的 SQL,配 8 条测试,故意改坏三处都被抓到。收尾时留了一个账:一个节点装两件事,看不见各自的耗时,一个失败拖着另一个,没法只重跑一半。

欠的账今天开始还。图里一旦有两个节点,马上冒出三个问题:第二个节点怎么拿到第一个节点的结果?两个节点的连线能不能少写几行?图跑起来之后,怎么看见每个节点各自做了什么?今天挨个回答。依旧不调模型,节点里都是规则和模板。

## 今天要解决的问题

学完今天,你要能做到:

1. 用 `add_node` 加 `add_edge` 手工把两个节点串起来,说清第二个节点是怎么读到第一个节点写下的字段的。
2. 用 `add_sequence` 写出同一张图,说出它替你做了什么、没做什么(入口和出口要自己连),以及节点名是怎么来的。
3. 用 `stream(..., stream_mode="updates")` 看每个节点各改了什么,读懂 `{节点名: 更新}` 这个形状,并说出它和 `invoke` 的区别。
4. 说出节点中途抛异常时,`invoke` 和 `stream` 各拿到什么,以及节点顺序写反时为什么不报错。

预计用时 2 小时。今天不调模型,花费 ¥0。前置:[Day 299](/blog/agent-zero/day-299-lg-one-node/)(六步骨架、`part05/lg/s01_tickets.py` 里的 `classify_text` 和 `load_tickets`)、[Day 99](/blog/agent-zero/day-099-generators/)(生成器和 `for ... in` 取值)、[Day 24](/blog/agent-zero/day-024-dicts/)(字典的 `.get`)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `s02_sequence.py` 里连线的四行和 `s02_stream.py` 里取出节点名与更新的那两行;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

所有命令在 `agent-zero-lab/` 根目录跑(我的是 `/Users/你/agent-zero-lab`)。先重置业务库:

```bash
cd /Users/你/agent-zero-lab
uv run python cloudledger/seed.py
```

<div class="line-notes">

- `uv run python cloudledger/seed.py` 删库重建,输出 `已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}`。今天用到其中的工单表。

</div>

## 第二个节点怎么拿到第一个节点的结果

先想一个你熟悉的场景。Express 里两个中间件依次处理一个请求:第一个算出用户的角色,挂在 `req.role` 上,第二个从 `req.role` 读。它们之间没有互相调用,谁也不知道对方的名字,共用的是 `req` 这个对象。

LangGraph 的两个节点是同一回事,共用的是**状态**。`classify` 把 `category` 写进状态,框架把它合并进去;轮到 `draft` 时,框架把合并后的状态交给它,它就能读到 `category`。节点不传参、不 `return` 给下一个节点,`return` 的是「给状态的更新」。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="两个节点共享状态:classify 读 ticket 并写入 category,draft 读到 category 并写入 reply;状态是下面一条三格的横条,ticket、category、reply;classify 到 draft 之间有一条边规定先后顺序">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="90" y="24" width="140" height="44" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="160" y="51" fill="var(--ink)" text-anchor="middle">classify</text>
<rect x="410" y="24" width="140" height="44" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="480" y="51" fill="var(--ink)" text-anchor="middle">draft</text>
<line x1="230" y1="46" x2="410" y2="46" stroke="var(--ink-soft)"/>
<polygon points="410,46 402,42 402,50" fill="var(--ink-soft)"/>
<text x="320" y="38" fill="var(--ink-faint)" text-anchor="middle" font-size="11">边:先 classify 后 draft</text>
<rect x="60" y="128" width="160" height="50" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="140" y="150" fill="var(--ink)" text-anchor="middle">ticket</text>
<text x="140" y="168" fill="var(--ink-soft)" text-anchor="middle" font-size="11">调用时就有</text>
<rect x="240" y="128" width="160" height="50" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="150" fill="var(--ink)" text-anchor="middle">category</text>
<text x="320" y="168" fill="var(--ink-soft)" text-anchor="middle" font-size="11">classify 写入后才有</text>
<rect x="420" y="128" width="160" height="50" rx="4" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="500" y="150" fill="var(--ink)" text-anchor="middle">reply</text>
<text x="500" y="168" fill="var(--ink-soft)" text-anchor="middle" font-size="11">draft 写入后才有</text>
<text x="20" y="108" fill="var(--ink-faint)" font-size="11">共享的状态</text>
<line x1="150" y1="68" x2="140" y2="128" stroke="var(--ink-soft)" stroke-dasharray="3 3"/>
<line x1="190" y1="68" x2="290" y2="128" stroke="var(--ink-soft)"/>
<polygon points="290,128 283,121 279,129" fill="var(--ink-soft)"/>
<line x1="350" y1="128" x2="450" y2="68" stroke="var(--ink-soft)" stroke-dasharray="3 3"/>
<line x1="510" y1="68" x2="510" y2="128" stroke="var(--ink-soft)"/>
<polygon points="510,128 506,120 514,120" fill="var(--ink-soft)"/>
<text x="150" y="104" fill="var(--ink)" font-size="12">①</text>
<text x="246" y="102" fill="var(--ink)" font-size="12">②</text>
<text x="408" y="102" fill="var(--ink)" font-size="12">③</text>
<text x="520" y="102" fill="var(--ink)" font-size="12">④</text>
<text x="20" y="206" fill="var(--ink-soft)" font-size="11">① classify 读 ticket(虚线是读)  ② classify 写 category(实线是写)</text>
<text x="20" y="224" fill="var(--ink-soft)" font-size="11">③ draft 读 category(能读到,是因为边保证了先后)  ④ draft 写 reply</text>
</g>
</svg>
<figcaption>两个节点之间没有直接的数据通道,所有数据都经过状态。边只规定先后顺序,顺序对了,后面的节点才读得到前面写下的东西。</figcaption>
</figure>

这张图里最后一句很关键:**边保证了先后,先后保证了读得到**。如果顺序反了,`draft` 先跑,它读到的状态里还没有 `category`。这件事「不一定报错」,第 5 步会专门演示。

## 第 1 步:用 add_node 和 add_edge 手工连

两个节点:`classify` 复用 Day 299 的规则表判断类别;`draft` 读 `category`,从模板里挑一句开场白,再带上工单开头几个字,拼成一条回复草稿。模板是写死的字符串,不调模型。

```python
# agent-zero-lab/part05/lg/s02_two_nodes.py
"""两个节点串起来:classify 写 category,draft 读 category 起草回复。用 add_node 加 add_edge 手工连。
用法:uv run python -m part05.lg.s02_two_nodes"""
from typing import NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph

from part05.lg.s01_tickets import classify_text, load_tickets

REPLIES = {
    "billing": "您好,账单问题已收到,我们会在 1 个工作日内核对并回复您。",
    "subscription": "您好,订阅相关的请求已收到,客户成功同事会联系您确认细节。",
    "technical": "您好,已记录您遇到的报错,工程师会排查后回复。",
    "account": "您好,账号登录问题已收到,请先确认注册邮箱,我们马上协助。",
}
DEFAULT_REPLY = "您好,已收到,我们会尽快处理。"
SHOW = True  # 节点里要不要打印「收到了什么」。批量跑几十张工单时关掉


class State(TypedDict):
    ticket: str
    category: NotRequired[str]
    reply: NotRequired[str]


def classify(state: State) -> dict:
    if SHOW:
        print("  classify 收到:", list(state))
    return {"category": classify_text(state["ticket"])}


def draft(state: State) -> dict:
    if SHOW:
        print("  draft 收到:", list(state))
    category = state.get("category", "unknown")
    opening = REPLIES.get(category, DEFAULT_REPLY)
    return {"reply": f"{opening}(关于:{state['ticket'][:8]}…)"}


builder = StateGraph(State)
builder.add_node("classify", classify)
builder.add_node("draft", draft)
builder.add_edge(START, "classify")
builder.add_edge("classify", "draft")
builder.add_edge("draft", END)
graph = builder.compile()

if __name__ == "__main__":
    ticket_id, text = next(t for t in load_tickets() if t[0] == "T1008")
    print(f"{ticket_id}:{text}")
    result = graph.invoke({"ticket": text})
    print("最终状态的字段:", list(result))
    print("category:", result["category"])
    print("reply:", result["reply"])
```

<div class="line-notes">

- `from typing import NotRequired, TypedDict` 和 Day 299 一样的两个类型工具。
- `from langgraph.graph import END, START, StateGraph` 六步骨架要用的三样。
- `from part05.lg.s01_tickets import classify_text, load_tickets` 直接复用 Day 299 写好的规则判断函数和读库函数,不重写一遍。`classify_text` 对「发票抬头修改」这类文本返回 `"billing"`。
- `REPLIES = {` 四种类别各一句开场白,字典的键是类别名,值是模板。Day 299 的规则表只会产出 `billing`、`subscription`、`technical`、`account`、`other` 五种,这里 `other` 没有专属模板。
- `DEFAULT_REPLY = "您好,已收到,我们会尽快处理。"` 兜底:类别查不到模板时用它。
- `SHOW = True  # 节点里要不要打印「收到了什么」。批量跑几十张工单时关掉` 一个模块级的开关。节点里的 `print` 读它,别的文件里写 `s02_two_nodes.SHOW = False` 就能把打印关掉。
- `class State(TypedDict):` 状态的定义。
- `ticket: str` 必填,调用时就要给。
- `category: NotRequired[str]` 由 `classify` 写入,调用时没有,所以 `NotRequired`。
- `reply: NotRequired[str]` 由 `draft` 写入,同理。
- `def classify(state: State) -> dict:` 第一个节点。
- `print("  classify 收到:", list(state))` 打印状态里有哪些键,`list(字典)` 得到所有键的列表。T1008 进来时是 `['ticket']`。
- `return {"category": classify_text(state["ticket"])}` 代入 T1008「发票抬头修改:上个月的发票抬头写错了……」,里面有「发票」,规则表第一条就命中,返回 `{"category": "billing"}`。
- `def draft(state: State) -> dict:` 第二个节点。
- `print("  draft 收到:", list(state))` 到这里状态里应该已经有 `category` 了,输出 `['ticket', 'category']`。这一行是今天最重要的证据:第一个节点写的东西,第二个节点收到了。
- `category = state.get("category", "unknown")` 为什么用 `.get` 不用 `state["category"]`:`category` 是 `NotRequired`,编辑器会对 `state["category"]` 画红线,提示「它不是必填键,访问可能抛异常」。`.get("category", "unknown")` 的意思是:有就取,没有就用 `"unknown"`,不抛异常。T1008 走到这里已经有了,取到 `"billing"`。
- `opening = REPLIES.get(category, DEFAULT_REPLY)` 从模板字典里取开场白,取不到就用兜底。`"billing"` 取到「您好,账单问题已收到……」。
- `return {"reply": f"{opening}(关于:{state['ticket'][:8]}…)"}` 切片取工单的前 8 个字,T1008 是「发票抬头修改:上」。f-string 里用单引号取键,免得和外面的双引号打架。
- `builder = StateGraph(State)` 六步骨架第 2 步。
- `builder.add_node("classify", classify)` 第 3 步,登记第一个节点。
- `builder.add_node("draft", draft)` 登记第二个节点。有几个节点就写几行。
- `builder.add_edge(START, "classify")` 第 4 步:入口接到 `classify`。
- `builder.add_edge("classify", "draft")` 今天新增的一条边:`classify` 跑完接着跑 `draft`。**这一条就是「串起来」**。
- `builder.add_edge("draft", END)` 最后一个节点连到出口。
- `graph = builder.compile()` 第 5 步。
- `if __name__ == "__main__":` 直接运行时才执行下面的演示。
- `ticket_id, text = next(t for t in load_tickets() if t[0] == "T1008")` 取出 T1008 这一张。`load_tickets()` 返回 `(工单号, 文本)` 的列表,`next(... for ... if ...)` 取第一个满足条件的,左边一次拆成两个变量。
- `result = graph.invoke({"ticket": text})` 第 6 步。
- `print("最终状态的字段:", list(result))` 输出三个键:`ticket`、`category`、`reply`。
- `print("category:", result["category"])` 输出 `billing`。
- `print("reply:", result["reply"])` 输出开场白加「(关于:发票抬头修改:上…)」。

</div>

```bash
uv run python -m part05.lg.s02_two_nodes
```

```text
T1008:发票抬头修改:上个月的发票抬头写错了,应该是「启明科技有限公司」,能重开吗?
  classify 收到: ['ticket']
  draft 收到: ['ticket', 'category']
最终状态的字段: ['ticket', 'category', 'reply']
category: billing
reply: 您好,账单问题已收到,我们会在 1 个工作日内核对并回复您。(关于:发票抬头修改:上…)
```

把这次 `invoke` 里发生的事按时间排一遍(Day 299 那种表,多了一行):

| 时刻 | 谁在跑 | 它收到的状态 | 它返回的更新 |
| --- | --- | --- | --- |
| 调用时 | (还没开始) | `{ticket}` | |
| 经过 `START → classify` | `classify` | `{ticket}` | `{category: "billing"}` |
| 经过 `classify → draft` | `draft` | `{ticket, category}` | `{reply: "您好,账单问题……"}` |
| 经过 `draft → END` | 图结束 | | 最终状态 `{ticket, category, reply}` 交给你 |

对着这张表再问一遍 Day 299 的三个问题:这个节点开始时状态长什么样?返回了什么更新?合并之后长什么样?第二行和第三行的区别只有一处,就是 `draft` 收到的状态里多了一个键。这就是「串起来」的全部含义。

## 第 2 步:add_sequence,少写几行连线

节点多了,`add_node` 加 `add_edge` 要写很多重复的行。`add_sequence` 一次登记一串节点,并且把相邻两个自动连起来。同一张图的另一种写法:

```python
# agent-zero-lab/part05/lg/s02_sequence.py
"""同一张两节点图,换成 add_sequence 来连。用法:uv run python -m part05.lg.s02_sequence"""
from langgraph.graph import END, START, StateGraph

from part05.lg import s02_two_nodes as manual
from part05.lg.s01_tickets import load_tickets
from part05.lg.s02_two_nodes import State, classify, draft

builder = StateGraph(State)
builder.add_sequence([classify, draft])
builder.add_edge(START, "classify")
builder.add_edge("draft", END)
graph = builder.compile()


def edges(g) -> list[tuple[str, str]]:
    return sorted((e.source, e.target) for e in g.get_graph().edges)


if __name__ == "__main__":
    print("节点:", list(graph.nodes))
    print("add_sequence 版的边:", edges(graph))
    print("手工连线版的边    :", edges(manual.graph))
    print("两张图的边一样:", edges(graph) == edges(manual.graph))

    manual.SHOW = False  # 下面要各跑一次,不想看重复的打印
    text = next(t for i, t in load_tickets() if i == "T1008")
    same = graph.invoke({"ticket": text}) == manual.graph.invoke({"ticket": text})
    print("同一张工单,两张图的最终状态一样:", same)
```

<div class="line-notes">

- `from part05.lg import s02_two_nodes as manual` 把上一个文件整个导入,起名 `manual`(手工连线版),后面要拿它的图来对比。
- `from part05.lg.s01_tickets import load_tickets` 读工单用。
- `from part05.lg.s02_two_nodes import State, classify, draft` 复用状态和两个节点函数。**节点函数一个字没改**,只换了连线的写法。
- `builder.add_sequence([classify, draft])` 等于下面三件事:`add_node("classify", classify)`、`add_node("draft", draft)`、`add_edge("classify", "draft")`。节点名自动取函数名,所以叫 `"classify"` 和 `"draft"`。
- `builder.add_edge(START, "classify")` `add_sequence` **不会**替你连入口,要自己连到第一个节点。
- `builder.add_edge("draft", END)` 也不会连出口,要自己把最后一个节点连到 `END`。
- `def edges(g) -> list[tuple[str, str]]:` 小帮手:取出一张图所有的边,每条是(起点,终点)。
- `return sorted((e.source, e.target) for e in g.get_graph().edges)` Day 299 的 `get_graph()` 描述里每条边有 `source` 和 `target`。`sorted` 排序,让两张图的边能直接比较。
- `print("节点:", list(graph.nodes))` 输出 `['__start__', 'classify', 'draft']`,`__start__` 是入口路标。
- `print("add_sequence 版的边:", edges(graph))` 三条边:入口到 classify、classify 到 draft、draft 到出口。
- `print("手工连线版的边    :", edges(manual.graph))` 手工版的边,看是不是同样三条。
- `print("两张图的边一样:", edges(graph) == edges(manual.graph))` 两个列表相等就是 `True`。
- `manual.SHOW = False  # 下面要各跑一次,不想看重复的打印` 把上一个文件里的打印开关关掉。节点函数是共用的,所以这里关了,`graph` 里的节点也安静了。
- `text = next(t for i, t in load_tickets() if i == "T1008")` 同一张工单,这次只要文本。
- `same = graph.invoke({"ticket": text}) == manual.graph.invoke({"ticket": text})` 两张图各跑一次,最终状态是两个字典,相等就是 `True`。
- `print("同一张工单,两张图的最终状态一样:", same)` 输出 `True`。

</div>

```bash
uv run python -m part05.lg.s02_sequence
```

```text
节点: ['__start__', 'classify', 'draft']
add_sequence 版的边: [('__start__', 'classify'), ('classify', 'draft'), ('draft', '__end__')]
手工连线版的边    : [('__start__', 'classify'), ('classify', 'draft'), ('draft', '__end__')]
两张图的边一样: True
同一张工单,两张图的最终状态一样: True
```

`add_sequence` 只是语法糖,生成的图和手工连的一模一样,不是一种新能力。三点要记住:

1. **它返回的就是 `builder` 本身**。实测 `b.add_sequence([...]) is b` 是 `True`,所以可以链式写 `builder.add_sequence([...]).add_edge(...)`,我自己更愿意分行写,读起来清楚。
2. **节点名取函数名**。函数名重复(同一个函数放两次、两个 `lambda`)就会报「节点名必须唯一」,办法是写成 `(名字, 函数)` 的元组,练习 4 会实跑。
3. **入口和出口自己连**。忘了连 `START` 照样是 Day 299 那个 `Graph must have an entrypoint`。

## 第 3 步:用 stream 看每一步

`invoke` 把整张图跑完才把最终状态给你。图只有两个节点、都是规则判断时没问题;换成真实的 Agent,其中一个节点要调模型,要等好几秒,你想知道「它现在跑到哪一步了」「第一步的结果是什么」,`invoke` 回答不了。`stream` 可以:每个节点跑完,就把它这一步的更新吐出来。

为了让两者的区别看得见,下面用 `time.sleep(1.0)` 假装 `draft` 要等一秒的模型:

```python
# agent-zero-lab/part05/lg/s02_stream.py
"""stream 和 invoke 的区别:什么时候拿到第一个结果。用 sleep 假装 draft 要调一次模型(约 1 秒)。
用法:uv run python -m part05.lg.s02_stream"""
import time

from langgraph.graph import END, START, StateGraph

from part05.lg.s01_tickets import load_tickets
from part05.lg.s02_two_nodes import State, classify, draft


def slow_draft(state: State) -> dict:
    time.sleep(1.0)  # 假装在等模型
    return draft(state)


builder = StateGraph(State)
builder.add_sequence([classify, slow_draft])
builder.add_edge(START, "classify")
builder.add_edge("slow_draft", END)
graph = builder.compile()

text = next(t for i, t in load_tickets() if i == "T1008")
init: State = {"ticket": text}

print("== invoke:等到整张图跑完才有结果")
t0 = time.perf_counter()
result = graph.invoke(init)
print(f"  t={time.perf_counter() - t0:.2f}s 拿到最终状态,字段 {list(result)}")

print("== stream:每个节点跑完就吐一个更新")
chunks = graph.stream(init, stream_mode="updates")
print("  stream() 返回的是:", type(chunks).__name__, "(还没有开始跑)")
t0 = time.perf_counter()
for chunk in chunks:
    node, update = next(iter(chunk.items()))
    print(f"  t={time.perf_counter() - t0:.2f}s {node} 写了 {list(update)}")
```

<div class="line-notes">

- `import time` 标准库,`time.sleep(秒)` 让程序停一会,`time.perf_counter()` 取一个高精度的计时值,两次相减就是耗时。
- `from part05.lg.s01_tickets import load_tickets` 读工单。
- `from part05.lg.s02_two_nodes import State, classify, draft` 复用状态和两个节点。
- `def slow_draft(state: State) -> dict:` 在原来的 `draft` 外面包一层。
- `time.sleep(1.0)  # 假装在等模型` 停一秒。真调模型时,这一秒是网络和生成的耗时。
- `return draft(state)` 然后做原来 `draft` 做的事。节点是普通函数,所以可以直接调用别的节点函数。
- `builder.add_sequence([classify, slow_draft])` 这次序列里的第二个节点是 `slow_draft`,节点名自动取成 `"slow_draft"`。
- `builder.add_edge("slow_draft", END)` 出口要连的是新名字,写成 `"draft"` 会报「边指向了不存在的节点」。
- `text = next(t for i, t in load_tickets() if i == "T1008")` 还是 T1008。
- `init: State = {"ticket": text}` 初始状态存进变量,下面两种跑法共用。
- `t0 = time.perf_counter()` 记下起点。
- `result = graph.invoke(init)` `invoke` 会卡在这一行,一秒多以后才返回。
- `print(f"  t={time.perf_counter() - t0:.2f}s 拿到最终状态,字段 {list(result)}")` 用现在的时间减去起点得到耗时,`:.2f` 保留两位小数。
- `chunks = graph.stream(init, stream_mode="updates")` **调用 `stream` 本身不会跑任何节点**,它返回一个生成器([Day 99](/blog/agent-zero/day-099-generators/)),要迭代它才会一步一步往前跑。`stream_mode="updates"` 的意思是「每个节点吐出它的更新」。
- `print("  stream() 返回的是:", type(chunks).__name__, "(还没有开始跑)")` 输出 `generator`,而且这一行之前,终端里没有出现任何「classify 收到」的打印,说明真的还没跑。
- `for chunk in chunks:` 开始取值,每取一次,图就往前跑到下一个节点结束。相当于 JS 里的 `for await (const chunk of stream)`。
- `node, update = next(iter(chunk.items()))` `chunk` 是只有一个键的字典 `{节点名: 更新}`。`chunk.items()` 得到(键, 值)的集合,`iter` 变成迭代器,`next` 取第一个,一次拆成 `node` 和 `update`。第一次是 `("classify", {"category": "billing"})`。
- `print(f"  t={time.perf_counter() - t0:.2f}s {node} 写了 {list(update)}")` 打印时间、节点名和它写了哪些键。

</div>

```bash
uv run python -m part05.lg.s02_stream
```

```text
== invoke:等到整张图跑完才有结果
  classify 收到: ['ticket']
  draft 收到: ['ticket', 'category']
  t=1.01s 拿到最终状态,字段 ['ticket', 'category', 'reply']
== stream:每个节点跑完就吐一个更新
  stream() 返回的是: generator (还没有开始跑)
  classify 收到: ['ticket']
  t=0.00s classify 写了 ['category']
  draft 收到: ['ticket', 'category']
  t=1.01s slow_draft 写了 ['reply']
```

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="时间线对比:invoke 在大约 1.01 秒时一次拿到最终状态;stream 在 0.00 秒拿到 classify 的更新,在 1.01 秒拿到 draft 的更新">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<line x1="120" y1="190" x2="580" y2="190" stroke="var(--rule)"/>
<line x1="120" y1="186" x2="120" y2="194" stroke="var(--rule)"/>
<line x1="580" y1="186" x2="580" y2="194" stroke="var(--rule)"/>
<text x="120" y="210" fill="var(--ink-faint)" text-anchor="middle" font-size="11">0 秒</text>
<text x="580" y="210" fill="var(--ink-faint)" text-anchor="middle" font-size="11">1 秒</text>
<text x="20" y="62" fill="var(--ink)">invoke</text>
<rect x="120" y="44" width="4" height="26" fill="var(--compute)"/>
<rect x="124" y="44" width="456" height="26" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="352" y="62" fill="var(--ink-soft)" text-anchor="middle" font-size="11">draft(sleep 1 秒,假装等模型)</text>
<polygon points="580,34 575,24 585,24" fill="var(--mem)"/>
<text x="580" y="18" fill="var(--ink)" text-anchor="end" font-size="11">t=1.01s 才第一次拿到东西:最终状态</text>
<text x="20" y="142" fill="var(--ink)">stream</text>
<rect x="120" y="124" width="4" height="26" fill="var(--compute)"/>
<rect x="124" y="124" width="456" height="26" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="352" y="142" fill="var(--ink-soft)" text-anchor="middle" font-size="11">draft(sleep 1 秒,假装等模型)</text>
<polygon points="122,114 117,104 127,104" fill="var(--mem)"/>
<polygon points="580,114 575,104 585,104" fill="var(--mem)"/>
<text x="120" y="98" fill="var(--ink)" font-size="11">t=0.00s classify 的更新</text>
<text x="580" y="98" fill="var(--ink)" text-anchor="end" font-size="11">t=1.01s draft 的更新</text>
</g>
</svg>
<figcaption>两种跑法总耗时一样,区别在你什么时候能看到东西。<code>stream</code> 让你在第 0 秒就拿到第一步的结果,界面可以先显示「已分类:账单」,再等回复。</figcaption>
</figure>

读输出要抓三件事:

1. **`stream()` 返回的是 `generator`,调用它不会跑任何节点。** 输出里「`stream()` 返回的是」那一行出现时,终端上还没有任何节点的打印。真正开始跑,是 `for chunk in chunks` 取第一个值的时候。如果你只写 `graph.stream(...)` 而不去迭代,什么也不会发生,也不会报错。很容易漏掉循环,然后盯着空白的终端,不知道哪里错了。
2. **每个 `chunk` 是 `{节点名: 更新}`。** 第一个是 `{'classify': {'category': 'billing'}}`,第二个是 `{'slow_draft': {'reply': ...}}`。注意第二个键是 `slow_draft`,不是 `draft`:节点名取的是**登记时的名字**(`add_sequence` 取函数名),不是函数里面调用的那个。
3. **时间:第一个更新在 0.00 秒,第二个在 1.01 秒。** 总耗时和 `invoke` 一样,但你不必等到最后才看到东西。和 Day 299 一样,更新里只有这个节点改的键,不是整个状态。

顺带一个我实测的细节:不写 `stream_mode` 时,1.2.16 里默认给的也是 `updates` 形状的输出。别依赖默认值,版本一换可能就变了,**一律写明**。

## 第 4 步:节点中途出错,stream 已经交出了什么

`stream` 还有一个 `invoke` 没有的用处:出错的时候,能看到出错之前的东西。让第二个节点抛一个异常:

```python
# agent-zero-lab/part05/lg/s02_stream_fail.py
"""第二个节点抛异常时,invoke 和 stream 各拿到什么。用法:uv run python -m part05.lg.s02_stream_fail"""
from langgraph.graph import END, START, StateGraph

from part05.lg.s02_two_nodes import State, classify


def broken_draft(state: State) -> dict:
    raise ValueError("回复模板服务挂了")


builder = StateGraph(State)
builder.add_sequence([classify, broken_draft])
builder.add_edge(START, "classify")
builder.add_edge("broken_draft", END)
graph = builder.compile()

init: State = {"ticket": "上个月的发票抬头写错了"}

print("== invoke")
try:
    result = graph.invoke(init)
    print("  拿到:", result)
except ValueError as e:
    print("  什么都没拿到,只有异常:", e)

print("== stream")
try:
    for chunk in graph.stream(init, stream_mode="updates"):
        print("  收到更新:", chunk)
except ValueError as e:
    print("  然后抛了异常:", e)
```

<div class="line-notes">

- `from part05.lg.s02_two_nodes import State, classify` 第一个节点还是正常的 `classify`。
- `def broken_draft(state: State) -> dict:` 第二个节点,一进来就抛错。
- `raise ValueError("回复模板服务挂了")` 假装模板服务不可用。这个异常会一路冒出来。
- `builder.add_sequence([classify, broken_draft])` 序列里放着 `classify` 和会出错的节点。
- `builder.add_edge("broken_draft", END)` 出口连的是 `"broken_draft"`。
- `init: State = {"ticket": "上个月的发票抬头写错了"}` 这次不用库里的工单,写一句短的。
- `result = graph.invoke(init)` `invoke` 要跑完才返回,第二个节点抛错,这一行直接抛异常,下面的 `print("  拿到:", result)` 不会执行。
- `except ValueError as e:` 接住异常。
- `print("  什么都没拿到,只有异常:", e)` 打印异常信息:「回复模板服务挂了」。`classify` 其实已经把 `category` 算出来了,但 `invoke` 没有办法把这个「半成品」交给你。
- `for chunk in graph.stream(init, stream_mode="updates"):` 同样的图换 `stream`。
- `print("  收到更新:", chunk)` 第一次取值时 `classify` 跑完了,这里先打印出 `{'classify': {'category': 'billing'}}`。
- `except ValueError as e:` 取第二个值时,图去跑 `broken_draft`,异常从这个 `for` 里冒出来,被接住。
- `print("  然后抛了异常:", e)` 同一个异常信息。

</div>

```bash
uv run python -m part05.lg.s02_stream_fail
```

```text
== invoke
  classify 收到: ['ticket']
  什么都没拿到,只有异常: 回复模板服务挂了
== stream
  classify 收到: ['ticket']
  收到更新: {'classify': {'category': 'billing'}}
  然后抛了异常: 回复模板服务挂了
```

`invoke` 一条结果也拿不到,`stream` 至少拿到了第一步的更新。这在调试时很有用:一个有十个节点的图,报错信息只告诉你最后炸在哪,而 `stream` 能让你看到前面九步各自产出了什么,哪一步开始数据不对了。

但这不是什么「保存了进度」。第一个更新只是**交给你看**了,图本身并没有把状态存下来。异常一抛,这次运行就结束了,想从第二个节点接着跑,得从头再来。真正能断点续跑的是 checkpoint,后面专门有一天讲。

## 第 5 步:顺序写反了,不报错

把 `[classify, draft]` 写成 `[draft, classify]` 会怎样?`draft` 先跑,读到的状态里没有 `category`:

```python
# agent-zero-lab/part05/lg/s02_order.py
"""顺序反了会怎样:先 draft 后 classify。用法:uv run python -m part05.lg.s02_order"""
from langgraph.graph import END, START, StateGraph

from part05.lg.s02_two_nodes import State, classify, draft

builder = StateGraph(State)
builder.add_sequence([draft, classify])  # 故意写反
builder.add_edge(START, "draft")
builder.add_edge("classify", END)
graph = builder.compile()

for chunk in graph.stream({"ticket": "上个月的发票抬头写错了"}, stream_mode="updates"):
    print(chunk)
```

<div class="line-notes">

- `from part05.lg.s02_two_nodes import State, classify, draft` 复用同样的两个节点。
- `builder.add_sequence([draft, classify])  # 故意写反` 顺序反了:先 `draft` 后 `classify`。
- `builder.add_edge(START, "draft")` 入口接到现在排第一的 `draft`。
- `builder.add_edge("classify", END)` 出口接到现在排最后的 `classify`。
- `for chunk in graph.stream({"ticket": "上个月的发票抬头写错了"}, stream_mode="updates"):` 用 stream 看顺序。
- `print(chunk)` 先出来的是 `draft` 的更新:`reply` 是兜底那句「您好,已收到,我们会尽快处理。」,因为 `draft` 里 `state.get("category", "unknown")` 取不到,得到 `"unknown"`,`REPLIES` 里没有这个键,用了 `DEFAULT_REPLY`。
- 第二个出来的是 `classify` 的更新:`category` 是 `billing`。它收到的状态是 `['ticket', 'reply']`,`reply` 是 `draft` 写的,说明 `classify` 在后面。

</div>

```bash
uv run python -m part05.lg.s02_order
```

```text
  draft 收到: ['ticket']
{'draft': {'reply': '您好,已收到,我们会尽快处理。(关于:上个月的发票抬头…)'}}
  classify 收到: ['ticket', 'reply']
{'classify': {'category': 'billing'}}
```

整个过程没有任何报错。最终状态里 `ticket`、`reply`、`category` 三个键一个不缺,看起来很完整,但回复是兜底的那一句,账单的模板没用上。这是一类最难查的错:**代码都对,每个函数单独测都过,只是顺序错了,结果悄悄变差**。

两条防线:

- 读取前一个节点写的字段时,别用「有默认值的 `.get`」把缺失吞掉。想让顺序写反时立刻炸出来,就写 `state["category"]`,运行时抛 `KeyError`(编辑器那条红线可以加一句 `# pyright: ignore` 并在旁边写明「靠前面的节点保证有」);或者像这里,保留 `.get` 的兜底,但**写一条测试**断言「账单工单的回复里有『账单问题』」。
- 用 `stream` 看一眼顺序。调新图时,先把 `stream` 的输出打印出来,看节点出现的次序和你脑子里的图是不是一样,比读代码快得多。

## 第 6 步:41 张真工单

最后用 `stream` 把 41 张真工单都跑一遍,核对两件事:每一张经过的节点顺序是不是都一样、每个节点是不是只写了自己该写的字段。

```python
# agent-zero-lab/part05/lg/s02_tickets.py
"""41 张真工单过两节点图,用 stream 核对每一张的节点顺序和每个节点写的字段。用法:uv run python -m part05.lg.s02_tickets"""
from collections import Counter

from part05.lg import s02_two_nodes
from part05.lg.s01_tickets import load_tickets
from part05.lg.s02_two_nodes import REPLIES, State, graph

s02_two_nodes.SHOW = False  # 41 张工单,节点里的打印全关掉
tickets = load_tickets()
orders: Counter[tuple[str, ...]] = Counter()
wrote: dict[str, set[str]] = {}
replies: Counter[str] = Counter()

for _, text in tickets:
    init: State = {"ticket": text}
    order: list[str] = []
    for chunk in graph.stream(init, stream_mode="updates"):
        for node, update in chunk.items():
            order.append(node)
            wrote.setdefault(node, set()).update(update)
            if "reply" in update:
                replies[update["reply"].split("(")[0]] += 1
    orders[tuple(order)] += 1

print("每张工单经过的节点顺序:", dict(orders))
print("每个节点写过的字段:", {node: sorted(keys) for node, keys in wrote.items()})
print("起草的开头一共几种:", len(replies), "(模板共", len(REPLIES) + 1, "条,含兜底)")
for opening, n in replies.most_common():
    print(f"  {n:>2} 张  {opening}")
```

<div class="line-notes">

- `from collections import Counter` 数每种情况出现几次。
- `from part05.lg import s02_two_nodes` 导入整个模块,后面要改它的 `SHOW`。
- `from part05.lg.s02_two_nodes import REPLIES, State, graph` 导入模板字典、状态和第 1 步建好的图。
- `s02_two_nodes.SHOW = False  # 41 张工单,节点里的打印全关掉` 41 张乘以两个节点,不关的话会打出 82 行。
- `tickets = load_tickets()` 41 张工单。
- `orders: Counter[tuple[str, ...]] = Counter()` 记「节点顺序」出现的次数。键是元组,比如 `("classify", "draft")`;类型标注读作「键是若干个字符串的元组的 Counter」。
- `wrote: dict[str, set[str]] = {}` 记每个节点写过的字段。键是节点名,值是一个集合(去重)。
- `replies: Counter[str] = Counter()` 记起草出来的开场白各出现几次。
- `for _, text in tickets:` 逐张处理,工单号用不上,用 `_` 接住。
- `init: State = {"ticket": text}` 每张工单的初始状态。
- `order: list[str] = []` 这一张工单的节点顺序,先空着。
- `for chunk in graph.stream(init, stream_mode="updates"):` 每张工单一次 `stream`。
- `for node, update in chunk.items():` 一个 `chunk` 只有一项,这里用循环取出来,比 `next(iter(...))` 好读。
- `order.append(node)` 把节点名记下来。
- `wrote.setdefault(node, set()).update(update)` `setdefault` 的意思是「这个键没有就先放一个空集合,然后把它取出来」;`update(update)` 把更新里的键(`category` 或 `reply`)加进集合。**对字典调用 `set.update` 加进去的是它的键**。
- `if "reply" in update:` 只有 `draft` 的更新里才有 `reply`。
- `replies[update["reply"].split("(")[0]] += 1` 回复的格式是「开场白(关于:……)」,按 `(` 切开取前半句,当作 `Counter` 的键。
- `orders[tuple(order)] += 1` 这一张的顺序转成元组(列表不能当键),计数加一。
- `print("每张工单经过的节点顺序:", dict(orders))` 期望只有一种。
- `print("每个节点写过的字段:", {node: sorted(keys) for node, keys in wrote.items()})` 字典推导式,每个节点一项。
- `print("起草的开头一共几种:", len(replies), "(模板共", len(REPLIES) + 1, "条,含兜底)")` `REPLIES` 里有 4 条,加兜底一共 5 条。
- `for opening, n in replies.most_common():` `most_common()` 按次数从多到少给出(键, 次数)。
- `print(f"  {n:>2} 张  {opening}")` `:>2` 是右对齐、占两位。

</div>

```bash
uv run python -m part05.lg.s02_tickets
```

```text
每张工单经过的节点顺序: {('classify', 'draft'): 41}
每个节点写过的字段: {'classify': ['category'], 'draft': ['reply']}
起草的开头一共几种: 4 (模板共 5 条,含兜底)
  18 张  您好,账单问题已收到,我们会在 1 个工作日内核对并回复您。
   9 张  您好,账号登录问题已收到,请先确认注册邮箱,我们马上协助。
   8 张  您好,订阅相关的请求已收到,客户成功同事会联系您确认细节。
   6 张  您好,已记录您遇到的报错,工程师会排查后回复。
```

读法:41 张工单全是「先 `classify` 后 `draft`」这一种顺序;`classify` 只写过 `category`,`draft` 只写过 `reply`,没有谁越界。回复开场白用到了 4 种,18 + 9 + 8 + 6 = 41,和 Day 299 数出的类别人数一一对应(账单 18、账号 9、订阅 8、技术 6)。第 5 种(兜底那句)一次也没用上,因为这份库里的 41 张工单,没有一张被规则表判成 `other`。

## 零件 → 大代码对照表

| 零件 | 在哪个脚本 | 说明 |
| --- | --- | --- |
| 两个节点、`add_edge` 三条边 | `s02_two_nodes.py` | 节点之间通过状态传数据 |
| `add_sequence` | `s02_sequence.py` | 同一张图,连线少写几行;入口出口自己连 |
| `stream(..., stream_mode="updates")` | `s02_stream.py` | `{节点名: 更新}`,生成器要迭代才会跑 |
| 节点抛异常 | `s02_stream_fail.py` | `invoke` 什么都拿不到,`stream` 先吐出前面的更新 |
| 顺序写反 | `s02_order.py` | 不报错,结果悄悄变差 |
| 41 张真工单 | `s02_tickets.py` | 用 `stream` 核对每一张的顺序和写入的字段 |

## 动手练习

**练习 1:三个节点。** 在 `classify` 和 `draft` 之间再加一个节点 `mark_urgent`(和 Day 299 练习 1 一样:工单里有「急」「马上」「立刻」就是紧急),把结果写进 `urgent` 字段;`draft` 读 `urgent`,紧急的回复前面加「【加急】」。用 `add_sequence` 连三个节点,对 T1012(登录不了,紧急)和 T1001(导出报表报错,不紧急)各 `stream` 一次,说出每一步写了什么。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex301_three_nodes.py
"""练习 1:三个节点串起来。classify → mark_urgent → draft,紧急工单的回复加「【加急】」前缀。
用法:uv run python -m part05.lg.ex301_three_nodes"""
from typing import NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph

from part05.lg.s01_tickets import classify_text, load_tickets
from part05.lg.s02_two_nodes import DEFAULT_REPLY, REPLIES

URGENT_WORDS = ("急", "马上", "立刻")


class State(TypedDict):
    ticket: str
    category: NotRequired[str]
    urgent: NotRequired[bool]
    reply: NotRequired[str]


def classify(state: State) -> dict:
    return {"category": classify_text(state["ticket"])}


def mark_urgent(state: State) -> dict:
    return {"urgent": any(w in state["ticket"] for w in URGENT_WORDS)}


def draft(state: State) -> dict:
    opening = REPLIES.get(state.get("category", ""), DEFAULT_REPLY)
    prefix = "【加急】" if state.get("urgent") else ""
    return {"reply": prefix + opening}


builder = StateGraph(State)
builder.add_sequence([classify, mark_urgent, draft])
builder.add_edge(START, "classify")
builder.add_edge("draft", END)
graph = builder.compile()

if __name__ == "__main__":
    tickets = dict(load_tickets())
    for tid in ("T1012", "T1001"):
        print(f"== {tid}")
        init: State = {"ticket": tickets[tid]}
        for chunk in graph.stream(init, stream_mode="updates"):
            print("  ", chunk)
```

<div class="line-notes">

- `from part05.lg.s02_two_nodes import DEFAULT_REPLY, REPLIES` 复用模板,不重写。
- `URGENT_WORDS = ("急", "马上", "立刻")` 和 Day 299 练习 1 同一组关键词。
- `urgent: NotRequired[bool]` 状态里新加的字段,由 `mark_urgent` 写入。
- `def classify(state: State) -> dict:` 这个文件自己的 `classify`,因为 `State` 是新定义的(多了 `urgent`),所以节点也重新写,不复用 `s02_two_nodes` 里的。
- `def mark_urgent(state: State) -> dict:` 新节点,只做一件事:判断紧急。
- `return {"urgent": any(w in state["ticket"] for w in URGENT_WORDS)}` T1012 的文本里有「急」,返回 `{"urgent": True}`;T1001 没有,返回 `{"urgent": False}`。
- `opening = REPLIES.get(state.get("category", ""), DEFAULT_REPLY)` 两层取值:先从状态里取类别(没有就用空字符串),再用类别去模板里取开场白(没有就兜底)。
- `prefix = "【加急】" if state.get("urgent") else ""` `urgent` 为 `True` 才加前缀。`state.get("urgent")` 没有这个键时返回 `None`,在条件里是假。
- `return {"reply": prefix + opening}` 前缀加开场白拼起来。
- `builder.add_sequence([classify, mark_urgent, draft])` 三个节点按顺序连成一串,中间两条边自动生成。
- `builder.add_edge(START, "classify")` 入口。
- `builder.add_edge("draft", END)` 出口。
- `tickets = dict(load_tickets())` 把 `(工单号, 文本)` 的列表直接转成字典,下面用工单号取文本。
- `for tid in ("T1012", "T1001"):` 两张工单各跑一次。
- `for chunk in graph.stream(init, stream_mode="updates"):` 看每一步。

</div>

```bash
uv run python -m part05.lg.ex301_three_nodes
```

```text
== T1012
   {'classify': {'category': 'account'}}
   {'mark_urgent': {'urgent': True}}
   {'draft': {'reply': '【加急】您好,账号登录问题已收到,请先确认注册邮箱,我们马上协助。'}}
== T1001
   {'classify': {'category': 'technical'}}
   {'mark_urgent': {'urgent': False}}
   {'draft': {'reply': '您好,已记录您遇到的报错,工程师会排查后回复。'}}
```

T1012 三步依次是:`classify` 写 `category: account`、`mark_urgent` 写 `urgent: True`、`draft` 写出带「【加急】」的回复。T1001 的 `urgent` 是 `False`,回复没有前缀。**加一个节点,只需要写这个节点函数、`add_sequence` 里多放一项**,其余一行不用动,这就是把流程拆成节点的好处。

</details>

**练习 2:两种 stream_mode 吐出什么。** 同一张两节点图、同一张工单 T1008,分别用 `stream_mode="updates"` 和 `stream_mode="values"` 跑,把每一次吐出的内容打印出来(长字符串截短),数一数各吐几次,说出区别。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex301_modes.py
"""练习 2:stream_mode 的 "updates" 和 "values" 各吐出什么。用法:uv run python -m part05.lg.ex301_modes"""
from part05.lg import s02_two_nodes
from part05.lg.s01_tickets import load_tickets
from part05.lg.s02_two_nodes import State, graph

s02_two_nodes.SHOW = False
text = next(t for i, t in load_tickets() if i == "T1008")
init: State = {"ticket": text}

def short(v):
    """把长字符串截成 10 个字,字典往里一层层截,为了让输出短一点。"""
    if isinstance(v, str):
        return v if len(v) <= 10 else v[:10] + "…"
    if isinstance(v, dict):
        return {k: short(x) for k, x in v.items()}
    return v


for mode in ("updates", "values"):
    chunks = list(graph.stream(init, stream_mode=mode))
    print(f"== {mode}:共 {len(chunks)} 个")
    for i, chunk in enumerate(chunks, start=1):
        print(f"  {i}. {short(chunk)}")
```

<div class="line-notes">

- `s02_two_nodes.SHOW = False` 关掉节点里的打印,让输出只剩 stream 的内容。
- `init: State = {"ticket": text}` T1008 的完整文本。
- `def short(v):` 把值截短的小函数,为了让输出一行放得下。
- `if isinstance(v, str):` 字符串:超过 10 个字就截成前 10 个字加省略号。
- `if isinstance(v, dict):` 字典:对每个值递归调用 `short`,所以嵌在 `{节点名: 更新}` 里面的长字符串也能截到。
- `for mode in ("updates", "values"):` 两种模式各跑一遍。
- `chunks = list(graph.stream(init, stream_mode=mode))` `list(...)` 把生成器一次取完,存成列表,方便数个数。
- `print(f"== {mode}:共 {len(chunks)} 个")` 每种模式吐几个。
- `for i, chunk in enumerate(chunks, start=1):` `enumerate` 给每项配上序号,`start=1` 从 1 开始。
- `print(f"  {i}. {short(chunk)}")` 序号加截短后的内容。

</div>

```bash
uv run python -m part05.lg.ex301_modes
```

```text
== updates:共 2 个
  1. {'classify': {'category': 'billing'}}
  2. {'draft': {'reply': '您好,账单问题已收到…'}}
== values:共 3 个
  1. {'ticket': '发票抬头修改:上个月…'}
  2. {'ticket': '发票抬头修改:上个月…', 'category': 'billing'}
  3. {'ticket': '发票抬头修改:上个月…', 'category': 'billing', 'reply': '您好,账单问题已收到…'}
```

`updates` 吐 2 个,每个只含一个节点的更新,键是节点名;`values` 吐 3 个,每个都是**当时完整的状态**,第一个是还没有任何节点跑过的初始状态,之后每个节点跑完多一个。选哪个看用途:想知道「这一步改了什么」用 `updates`,想要「每一步之后的全貌」用 `values`。今天只用 `updates`,别的模式以后用到再讲。

</details>

**练习 3:把 Day 300 的门禁拆开。** Day 300 的 `review43_gate.py` 里一个节点装了 skill 检查和 SQL 判决。把它拆成三个节点:`skill_step`(只查 skill)、`sql_step`(只判 SQL)、`verdict_step`(只汇总 `ok`),用 `add_sequence` 连起来,对 `GOOD + BAD` 五条用例 `stream` 一次,并证明拆开以后的 `ok`、`skill_problems`、`sql_problems` 和原来的单节点图完全一致。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex301_split_gate.py
"""练习 3:把 Day 300 的 review43_gate 里一个节点装两件事,拆成三个节点,并用 stream 看每个节点写了什么。
用法:uv run python -m part05.lg.ex301_split_gate"""
from pathlib import Path
from typing import NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph

from part05.review43_gate import BAD, GOOD, Case, graph as one_node_graph, judge
from part05.skills.skill_check import check as check_skill


class State(TypedDict):
    skill_dir: str
    cases: list[Case]
    skill_problems: NotRequired[list[str]]
    sql_problems: NotRequired[list[str]]
    ok: NotRequired[bool]


def skill_step(state: State) -> dict:
    return {"skill_problems": check_skill(Path(state["skill_dir"]))}


def sql_step(state: State) -> dict:
    problems = [p for p in map(judge, state["cases"]) if p is not None]
    return {"sql_problems": problems}


def verdict_step(state: State) -> dict:
    return {"ok": not state.get("skill_problems") and not state.get("sql_problems")}


builder = StateGraph(State)
builder.add_sequence([skill_step, sql_step, verdict_step])
builder.add_edge(START, "skill_step")
builder.add_edge("verdict_step", END)
graph = builder.compile()

if __name__ == "__main__":
    init: State = {"skill_dir": ".claude/skills/refund-policy", "cases": GOOD + BAD}
    for chunk in graph.stream(init, stream_mode="updates"):
        node, update = next(iter(chunk.items()))
        print(f"{node}:", {k: (f"{len(v)} 条" if isinstance(v, list) else v) for k, v in update.items()})
    split = graph.invoke(init)
    one = one_node_graph.invoke(init)
    print("三个节点和一个节点的 ok、skill_problems、sql_problems 完全一致:",
          all(split[k] == one[k] for k in ("ok", "skill_problems", "sql_problems")))
```

<div class="line-notes">

- `from part05.review43_gate import BAD, GOOD, Case, graph as one_node_graph, judge` 从 Day 300 的文件里拿用例、`Case` 类型、判决函数 `judge`,以及**原来的单节点图**(改名叫 `one_node_graph`,用来对账)。`judge` 本来就是独立的函数,拆开几乎不用改。
- `from part05.skills.skill_check import check as check_skill` Day 296 的检查器,直接导入。
- `class State(TypedDict):` 和 Day 300 的状态字段完全一样,所以两张图的结果可以直接比。这里重新定义一份,是因为新图自己登记状态。
- `def skill_step(state: State) -> dict:` 第一个节点,只管 skill。
- `return {"skill_problems": check_skill(Path(state["skill_dir"]))}` 目录字符串转 `Path`,交给检查器,问题列表写进状态。
- `def sql_step(state: State) -> dict:` 第二个节点,只管 SQL。
- `problems = [p for p in map(judge, state["cases"]) if p is not None]` `map(judge, 用例列表)` 对每条用例调一次 `judge`,得到判决的迭代器;推导式里把 `None`(没问题)的丢掉,只留下问题字符串。
- `return {"sql_problems": problems}` 写进状态。
- `def verdict_step(state: State) -> dict:` 第三个节点,只汇总。
- `return {"ok": not state.get("skill_problems") and not state.get("sql_problems")}` 两个问题列表都为空(或者不存在,`.get` 得到 `None`)才是 `True`。
- `builder.add_sequence([skill_step, sql_step, verdict_step])` 三个节点,名字取函数名:`skill_step`、`sql_step`、`verdict_step`。
- `builder.add_edge(START, "skill_step")` 入口接第一个。
- `builder.add_edge("verdict_step", END)` 出口接最后一个。
- `init: State = {"skill_dir": ".claude/skills/refund-policy", "cases": GOOD + BAD}` 好的两条加坏的三条,共五条,和 Day 300「坏的一批」一样。
- `node, update = next(iter(chunk.items()))` 取出节点名和它的更新。
- `print(f"{node}:", {k: (f"{len(v)} 条" if isinstance(v, list) else v) for k, v in update.items()})` 更新里的列表只打印条数,免得输出太长;不是列表的(比如 `ok`)原样打印。
- `split = graph.invoke(init)` 拆开后的图跑一次,拿最终状态。
- `one = one_node_graph.invoke(init)` 原来的单节点图也跑一次。
- `all(split[k] == one[k] for k in ("ok", "skill_problems", "sql_problems"))` 三个键逐个比,`all` 全部为真才是 `True`。

</div>

```bash
uv run python -m part05.lg.ex301_split_gate
```

```text
skill_step: {'skill_problems': '0 条'}
sql_step: {'sql_problems': '3 条'}
verdict_step: {'ok': False}
三个节点和一个节点的 ok、skill_problems、sql_problems 完全一致: True
```

拆开之后,三个节点各自写了一个键:skill 那一步 0 个问题、SQL 那一步 3 个问题、最后一步 `ok` 是 `False`,和单节点图完全一致。得到的好处立刻看得见:`stream` 的输出本身就是一份报告,哪一道检查出了问题一目了然;你想只重跑 SQL 那一步,也有了落脚点(后面讲 checkpoint 和重放时会用到)。代价是多了两个节点函数和一个 `verdict_step`,代码行数多了一点。

</details>

**练习 4:连线时的三种错。** 故意写错三处,打印真实报错:①节点登记时改了名字(`"draft"` 改成 `"reply"`),边里还写着旧名字;②`add_sequence([classify, classify])` 同一个函数放两次;③`add_sequence([lambda ..., lambda ...])` 两个 lambda。再用报错里提示的办法,给两个 lambda 起名字让它编译通过。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex301_wiring_errors.py
"""练习 4:两个节点连线时的三种错,和 add_sequence 报错里提示的办法。用法:uv run python -m part05.lg.ex301_wiring_errors"""
from langgraph.graph import END, START, StateGraph

from part05.lg.s02_two_nodes import State, classify, draft


def attempt(label: str, wire) -> None:
    builder = StateGraph(State)
    try:
        wire(builder)
        graph = builder.compile()
    except Exception as e:
        print(f"{label} → {type(e).__name__}: {e}")
        return
    print(f"{label} → 编译通过,节点 {list(graph.nodes)}")


def renamed_but_edges_not(b: StateGraph) -> None:
    b.add_node("classify", classify)
    b.add_node("reply", draft)  # 改了名字
    b.add_edge(START, "classify")
    b.add_edge("classify", "draft")  # 边里还是旧名字
    b.add_edge("draft", END)


def same_function_twice(b: StateGraph) -> None:
    b.add_sequence([classify, classify])


def two_lambdas(b: StateGraph) -> None:
    b.add_sequence([lambda state: {}, lambda state: {}])


def lambdas_with_names(b: StateGraph) -> None:
    b.add_sequence([("step_one", lambda state: {}), ("step_two", lambda state: {})])  # pyright: ignore[reportArgumentType]
    b.add_edge(START, "step_one")
    b.add_edge("step_two", END)


attempt("改了名字没改边", renamed_but_edges_not)
attempt("同一个函数放两次", same_function_twice)
attempt("两个 lambda", two_lambdas)
attempt("给 lambda 起名字", lambdas_with_names)
```

<div class="line-notes">

- `def attempt(label: str, wire) -> None:` 和 Day 299 一样的小帮手:新建图纸,交给 `wire` 去连,编译,报错就打印,没报错就打印节点。
- `print(f"{label} → {type(e).__name__}: {e}")` 打印异常类名和完整信息。`ValueError` 的信息里已经写着怎么改。
- `print(f"{label} → 编译通过,节点 {list(graph.nodes)}")` 通过时列出节点,确认名字是我们起的。
- `def renamed_but_edges_not(b: StateGraph) -> None:` 第一种错。
- `b.add_node("reply", draft)  # 改了名字` 节点登记成了 `"reply"`。
- `b.add_edge("classify", "draft")  # 边里还是旧名字` 但边里写的还是 `"draft"`。
- `def same_function_twice(b: StateGraph) -> None:` 第二种错。
- `b.add_sequence([classify, classify])` 同一个函数放两次,自动取名都是 `"classify"`,重名。
- `def two_lambdas(b: StateGraph) -> None:` 第三种错。
- `b.add_sequence([lambda state: {}, lambda state: {}])` 两个匿名函数,函数名都是 `<lambda>`。参数名写成 `state` 是为了让编辑器的类型检查通过。
- `def lambdas_with_names(b: StateGraph) -> None:` 修法。
- `b.add_sequence([("step_one", lambda state: {}), ("step_two", lambda state: {})])  # pyright: ignore[reportArgumentType]` 按报错提示,每项写成(名字, 函数)的元组。运行没问题,但 LangGraph 的类型标注里没有列出这种写法,编辑器会画红线,这里加注释让检查器闭嘴。
- `b.add_edge(START, "step_one")` 入口接到自己起的名字。
- `b.add_edge("step_two", END)` 出口也是。

</div>

```bash
uv run python -m part05.lg.ex301_wiring_errors
```

```text
改了名字没改边 → ValueError: Found edge starting at unknown node 'draft'
同一个函数放两次 → ValueError: Node names must be unique: node with the name 'classify' already exists. If you need to use two different runnables/callables with the same name (for example, using `lambda`), please provide them as tuples (name, runnable/callable).
两个 lambda → ValueError: Node names must be unique: node with the name '<lambda>' already exists. If you need to use two different runnables/callables with the same name (for example, using `lambda`), please provide them as tuples (name, runnable/callable).
给 lambda 起名字 → 编译通过,节点 ['__start__', 'step_one', 'step_two']
```

第一种报错说「边从不存在的节点 `'draft'` 出发」,和 Day 299 的「边指向幽灵」是同一类,改名之后要把所有引用都改掉。第二、三种报错一模一样,而且信息里直接写了办法:两个不同的可调用对象同名时,用 `(name, callable)` 元组传给 `add_sequence`。第四种用这个办法,编译通过,节点名就是我们起的 `step_one` 和 `step_two`。

顺带一个观察:今天的几张图里,**节点名同时出现在三个地方**(`add_node` 或自动取名、`add_edge` 的参数、`stream` 吐出的键)。起名时一次想清楚,改名时三处一起改。

</details>

**验收标准:** 四个练习的脚本都能跑通,输出和参考答案一致;不看文章能默写出 `add_sequence` 加两条边的四行连线,和从 `chunk` 里取出节点名与更新的写法;能口头解释「为什么 `stream()` 本身不会运行节点」「为什么第二个节点读得到第一个节点写的字段」「为什么顺序写反不报错」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 串联 | 把两个节点用一条边连起来,让后一个在前一个之后跑。例:`add_edge("classify", "draft")` |
| 共享状态 | 所有节点读写的同一份数据。节点之间不直接传参,全靠它 |
| `add_sequence` | 一次登记一串节点并把相邻的连起来,等价于若干次 `add_node` 加 `add_edge`;入口和出口要自己连 |
| 语法糖 | 不增加新能力、只让写法更短的语法。`add_sequence` 就是 |
| `stream` | 图的另一种调用方式:返回一个生成器,每个节点跑完吐出一次结果;`invoke` 只在最后给一次 |
| `stream_mode="updates"` | 让 `stream` 吐出「节点名 → 这个节点写的更新」。另有 `"values"` 吐完整状态 |
| 生成器(generator) | 惰性产出值的东西:你取一个,它才算下一个。调用它本身不会执行函数体,Day 99 |
| chunk | `stream` 每次吐出的一小块。`updates` 模式下是只有一个键的字典 `{节点名: 更新}` |
| 兜底(fallback) | 查不到时用的默认值。例:`REPLIES.get(category, DEFAULT_REPLY)` |
| `.get(键, 默认值)` | 字典的取值方法,键不存在时返回默认值,不抛 `KeyError`。相当于 JS 的 `obj[key] ?? default` |
| `time.perf_counter()` | 取高精度计时值,两次相减得到耗时(秒) |
| `enumerate` | 给一个序列配上序号,`enumerate(列表, start=1)` 从 1 开始 |

## 常见误区

**以为节点之间是互相调用或互相传参。** 节点不知道别的节点的存在,它们只读写同一份状态。`classify` 的返回值不会「传给」`draft`,而是先合并进状态,`draft` 再从状态里读。

**只写 `graph.stream(...)` 不去迭代。** `stream` 返回的是生成器,不迭代就一个节点也不会跑,也不报错,终端上一片空白。要么 `for chunk in graph.stream(...)`,要么 `list(graph.stream(...))`。

**忘了 `add_sequence` 不连入口和出口。** 它只连相邻的节点。少连 `START` 会报「Graph must have an entrypoint」;少连 `END` 在 1.2.16 里不报错(Day 299 实测),但我一律连上。

**节点名用错。** `slow_draft` 包了 `draft`,图里的节点名是 `slow_draft`,出口那条边写成 `"draft"` 就报「边指向了不存在的节点」。`stream` 吐出来的键也是 `slow_draft`,不是里面调用的那个函数名。

**用带默认值的 `.get` 读前一个节点的字段,把顺序错误吞掉了。** 顺序写反时 `.get("category", "unknown")` 悄悄返回 `"unknown"`,回复变成兜底那句,没有任何报错。读前一个节点写的字段,想清楚「缺了是该炸还是该兜底」,要兜底就配一条测试。

**以为 stream 是保存进度。** `stream` 在节点出错之前交出的更新只是给你看了一眼,图没有把状态存下来,从中间接着跑要靠 checkpoint(后面专门讲)。

**不写 `stream_mode`,依赖默认值。** 1.2.16 里不写也是 `updates` 形状,但这个默认值不在我们的控制下,版本一变输出形状就变。一律写明。

**把 `lambda` 直接放进 `add_sequence`。** 两个 `lambda` 的函数名都是 `<lambda>`,重名报错。给每个写成 `(名字, 函数)`,或者干脆写成有名字的函数,后者更好读、报错信息里也有名字。

## 学习资料

### 文档与文章

- [LangGraph 文档 · Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api):今天用到的 `add_sequence`、边和状态的权威说明。读「Sequence」相关的部分,15 分钟。
- [LangGraph 文档 · Streaming](https://docs.langchain.com/oss/python/langgraph/streaming):`stream` 的所有模式(`updates`、`values`、`messages`、`custom` 等)。今天只用 `updates`,先扫一遍有哪些,别的以后每用到一个再细读。
- [LangGraph 文档 · Thinking in LangGraph](https://docs.langchain.com/oss/python/langgraph/thinking-in-langgraph):怎么把一个流程拆成「每个节点只做一件事」,和练习 3 拆门禁的思路一致。
- [Python 文档 · 生成器](https://docs.python.org/3/tutorial/classes.html#generators):`stream` 返回的生成器是怎么回事,Day 99 的官方版。
- [Python 文档 · dict.get](https://docs.python.org/3/library/stdtypes.html#dict.get):`.get` 的行为,搜页面里的 `get(key[, default])`。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1z3NY66EY1&autoplay=0&high_quality=1" title="尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>尚硅谷 · 尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战 · 全套约 21 小时,播放 83 万(2026 年 10 月查)。我没有逐集看,只核对过标题和时长;从目录判断,边的用法和 add_sequence 在第 28–29 集前后,按标题找「边」「add_sequence」几集即可。</figcaption>
</figure>

- 吴恩达&LangChain《用LangGraph搭建智能体》(BV1bi421v7oD,约 92 分钟,字幕搬运):录于 2024 年,API 有些旧,看「状态在节点之间怎么流」的讲法。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/aHCDrAbH_go" title="Building Effective Agents with LangGraph" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Building Effective Agents with LangGraph · 官方频道,英文,开字幕。我只核对了标题和频道,没有逐段看完。里面的第一个例子「提示词链」就是今天两节点串联的放大版:前一步的输出变成后一步的输入。</figcaption>
</figure>

- NeuralNine《LangGraph Crash Course - Agent Workflows in Python》(YouTube `uWLJAtMOVT0`,英文):实操向入门,可以对照看它怎么连节点、怎么 `stream`。注意它可能是 1.0 以前的写法,以今天的为准。

### 书籍

- Mayo Oshin、Nuno Campos,《Learning LangChain: Building AI and LLM Applications with LangChain and LangGraph》,O'Reilly,2025。讲 LangGraph 的章节有「顺序执行」和流式输出,出版时 1.0 还没发布,API 要对照着看。我没有核实有无中文版。

### 开源项目与代码

- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):可以搜 `add_sequence`,看它的实现有多短,就是循环里调 `add_node` 和 `add_edge`。
- [langchain-ai/langgraph 的官方示例](https://github.com/langchain-ai/langgraph/tree/main/examples):按目录找最简单的顺序流程示例,对照今天的写法。

## 自测

1. `classify` 把 `category` 写进状态,`draft` 是怎么读到的?中间有没有函数调用或参数传递?

<details><summary>答案</summary>

没有直接的调用或参数传递。`classify` 返回 `{"category": "billing"}`,框架把它合并进状态;轮到 `draft` 时,框架把合并后的状态作为参数交给它,里面就有 `category`。两个节点共用的是状态。边只规定了先后,先后对了,后面的节点才读得到前面写的东西。

</details>

2. `builder.add_sequence([classify, draft])` 替你做了哪几件事,没做哪几件事?

<details><summary>答案</summary>

做了三件:登记 `classify` 节点、登记 `draft` 节点(名字取函数名)、连一条 `classify → draft` 的边。没做的:不连入口(要自己 `add_edge(START, "classify")`),不连出口(要自己 `add_edge("draft", END)`)。它返回的是 `builder` 本身。函数名重复(比如两个 `lambda`)时要写成 `(名字, 函数)` 的元组。

</details>

3. `graph.stream(init, stream_mode="updates")` 这一行代码执行完,节点跑了吗?为什么?

<details><summary>答案</summary>

没有。`stream` 返回一个生成器,调用它只是创建了生成器对象,要用 `for` 取值或 `list(...)` 才会一步一步往前跑。实测在 `stream()` 返回之后、`for` 开始之前,终端上没有任何节点的打印。只写 `graph.stream(...)` 不迭代,什么也不会发生,也不会报错。

</details>

4. 第二个节点抛了异常,`invoke` 和 `stream` 各拿到什么?`stream` 拿到的算不算「保存了进度」?

<details><summary>答案</summary>

`invoke` 什么结果都拿不到,只有一个异常。`stream` 会先吐出第一个节点的更新(实测 `{'classify': {'category': 'billing'}}`),取第二个值时异常才冒出来。这不算保存进度:更新只是交给你看了,图没有把状态存下来,异常一抛这次运行就结束了,想接着跑要从头开始。能从中间续跑的是 checkpoint,后面会讲。

</details>

5. 面试题:你的 Agent 流程有五个步骤,用户抱怨「要等十几秒才有任何反应」。用 LangGraph 的 `stream` 能怎么缓解?它解决了什么、没解决什么?

<details><summary>答案</summary>

用 `stream` 代替 `invoke`,每个节点一跑完就把它的更新推给前端:比如分类一做完就显示「已识别为账单问题」,检索做完显示「找到 3 条相关记录」,最后才出最终回复。解决的是**体感**:用户在第 0 秒就看到进展,而不是十几秒空白。没解决的是**总耗时**:总时间和 `invoke` 一样(我实测都是 1.01 秒左右)。想真缩短时间,要优化慢的那个节点本身(换更快的模型、减少上下文、并行无依赖的节点),或者用 token 级的流式输出让最后一步边生成边显示。另外,`stream` 的更新只是节点级的粒度,模型生成的字是否逐字推送,是另一种流模式。

</details>

## 明天预告

Day 302 · LangGraph(三):State 的三种写法。今天和昨天的状态都是 `TypedDict`,连带 `NotRequired` 和 `.get`,以及编辑器那条「不是必填键」的红线。明天把同一个状态换成 `dataclass` 和 pydantic 的 `BaseModel`:节点收到的是字典还是对象?初始状态里不传字段会怎样?传错类型会在什么时候被拦下?正好把 Day 299 留下的「`TypedDict` 运行时不检查」那个问题答完。
