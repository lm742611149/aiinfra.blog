---
title: 'Day 323 · LangGraph(二十一):三种 stream_mode'
description: 'invoke 要等整张图跑完才给结果,stream 每跑一步就吐一次。今天把 stream_mode 的三个常用值 updates、values、messages 各跑一遍,看清每种吐出来的是什么、什么时候用;再学怎么一次开两种模式,以及 version="v2" 这个让类型检查器不再标红的新格式。最后给退款审批写一个流式的 start:节点跑完打进度,模型起草方案时一段段显示,顺手踩一个结构化输出下 content 永远是空字符串的坑。'
pubDate: 2026-10-22
regime: none
tags: ['langgraph', 'streaming', 'agent-zero']
series: 'agent-zero'
day: 323
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 322](/blog/agent-zero/day-322-lg-time-travel/) 学了时间旅行:从 `get_state_history` 里挑一张旧快照,`invoke(None, 旧config)` 是重放,先 `update_state` 再跑是分叉。我们给退款审批加了 rewind 和 fork,也踩到了时间旅行管不到业务库的坑,所以 `execute_refund` 现在写库前会先查「这张发票退过没有」,退过就跳过。

这几天我们一直用 `invoke`:敲下 `start`,终端安静一两秒,然后整段结果一起出来。退款图只有一个节点调模型,一两秒还忍得了。可前端同学都知道,页面上转圈两秒和「正在读工单……正在起草方案……」一行行冒出来,用户感觉完全是两回事。Day 322 末尾说过,快照之间的差异就是图每一步做的事;今天学的 `stream`,就是让图每走一步就把这一步的东西推给你,不用等到最后。

## 今天要解决的问题

学完今天,你要能做到:

1. 说出 `stream_mode="updates"`、`"values"`、`"messages"` 各自吐出什么,并用玩具图的真实输出证明。
2. 一次开两种模式(`stream_mode=["updates", "messages"]`),用 `version="v2"` 按 `part["type"]` 分开处理,而且 basedpyright 0 报错。
3. 给退款审批写 `refund_stream.py`:节点跑完打一行进度,draft 起草时把模型吐的片段实时打出来,停在审批点时提示主管。
4. 解释为什么结构化输出(Day 320 的 `with_structured_output`)在 messages 模式下 `token.content` 全是空字符串,该去哪里拿片段。

预计用时 2.5 小时。前置:[Day 301](/blog/agent-zero/day-301-lg-sequence/) 第一次见过的 `stream` 和 updates,[Day 134](/blog/agent-zero/day-134-streaming-code/) 用 openai SDK 读模型的流(`stream=True`、拼增量),[Day 319](/blog/agent-zero/day-319-lg-interrupt/) 的 interrupt,以及 Day 320 的 `refund_approval.py`(已按 Day 322 练习 2 加了「发票退过就跳过」)。前四步的玩具图不调模型,一分钱不花;第 5 步和练习一共调了 6 次模型,算式在第 5 步末尾。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `refund_stream.py` 里 `for part in graph.stream(...)` 那个循环和两个 `if part["type"] == ...` 分支默写出来;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 先看图:同一次运行,三种模式各吐什么

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="同一次运行的时间线:输入、classify 节点、draft 节点。updates 在每个节点结束时吐一次增量;values 在开头和每个节点结束时吐完整状态;messages 在节点调模型的过程中吐很多小片段">
  <rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12">
    <text x="16" y="30" fill="var(--ink-soft)">时间 →</text>
    <rect x="110" y="44" width="60" height="30" rx="4" fill="none" stroke="var(--ink-faint)"/>
    <text x="140" y="64" text-anchor="middle" fill="var(--ink-soft)">输入</text>
    <rect x="186" y="44" width="160" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="266" y="64" text-anchor="middle" fill="var(--ink)">classify(调模型)</text>
    <rect x="362" y="44" width="260" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="492" y="64" text-anchor="middle" fill="var(--ink)">draft(调模型,吐得久)</text>
    <text x="16" y="114" fill="var(--ink)">updates</text>
    <text x="16" y="164" fill="var(--ink)">values</text>
    <text x="16" y="214" fill="var(--ink)">messages</text>
  </g>
  <g fill="var(--compute)">
    <rect x="340" y="102" width="12" height="16" rx="2"/>
    <rect x="616" y="102" width="12" height="16" rx="2"/>
    <rect x="164" y="152" width="12" height="16" rx="2"/>
    <rect x="340" y="152" width="12" height="16" rx="2"/>
    <rect x="616" y="152" width="12" height="16" rx="2"/>
  </g>
  <g fill="var(--mem)">
    <rect x="300" y="204" width="6" height="12"/>
    <rect x="380" y="204" width="6" height="12"/><rect x="398" y="204" width="6" height="12"/><rect x="416" y="204" width="6" height="12"/>
    <rect x="434" y="204" width="6" height="12"/><rect x="452" y="204" width="6" height="12"/><rect x="470" y="204" width="6" height="12"/>
    <rect x="488" y="204" width="6" height="12"/><rect x="506" y="204" width="6" height="12"/><rect x="524" y="204" width="6" height="12"/>
    <rect x="542" y="204" width="6" height="12"/><rect x="560" y="204" width="6" height="12"/><rect x="578" y="204" width="6" height="12"/>
  </g>
  <g font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">
    <text x="110" y="134">节点跑完吐一次:{"节点名": 它返回的那几个字段}</text>
    <text x="110" y="184">开头先吐输入,之后每步吐一次完整状态</text>
    <text x="110" y="234">模型吐一段就推一段:(片段, 元数据),元数据里写着是哪个节点</text>
    <text x="16" y="258">琥珀色小块 = 一次输出(按步);蓝色细条 = 一个模型片段(按 token)</text>
  </g>
</svg>
<figcaption>这是第 3 步那张玩具图的真实形状:classify 的假模型只吐 1 段,draft 吐 13 段。updates 和 values 按「步」推,messages 按「模型片段」推,粒度差了一个数量级。</figcaption>
</figure>

今天的两个新概念:

- **stream_mode**:`graph.stream(...)` 的一个参数,决定每次推给你什么。今天只讲最常用的三个值。
- **v2 流格式**:`version="v2"` 让每一项都变成带 `type` 标签的字典,一次开几种模式也不会混,类型检查器也认得。

`stream` 本身你在 Day 301 见过:它不是一个新的执行方式,图该怎么跑还怎么跑,只是 `invoke` 把结果攒到最后一次性还给你,`stream` 每有一点进展就 `yield` 一次。前端类比:`invoke` 像 `await fetch(url).then(r => r.json())`,`stream` 像拿着 `response.body.getReader()` 一块块读。在 Python 里,`graph.stream(...)` 返回一个生成器,`for x in ...` 就是一块块读。

## 第 1 步:updates,节点跑完就吐一次

先用不调模型的玩具图,还是 Day 322 那两个节点 draft 和 execute。为了看清「什么时候到」,每个节点里睡 1 秒,假装在干活。

```python
# agent-zero-lab/part05/lg_steps/stream_updates.py
import time
from typing import TypedDict

from langgraph.graph import START, StateGraph


class State(TypedDict):
    amount: int
    result: str


def draft(state: State) -> dict:
    time.sleep(1)
    return {"amount": 2392}


def execute(state: State) -> dict:
    time.sleep(1)
    return {"result": f"已退 {state['amount']} 元"}


builder = StateGraph(State)
builder.add_node("draft", draft)
builder.add_node("execute", execute)
builder.add_edge(START, "draft")
builder.add_edge("draft", "execute")
graph = builder.compile()

if __name__ == "__main__":
    t0 = time.time()
    print("invoke:", graph.invoke({"amount": 0, "result": ""}), f"{time.time() - t0:.1f}s")

    t0 = time.time()
    for chunk in graph.stream({"amount": 0, "result": ""}, stream_mode="updates"):
        print("updates:", chunk, f"{time.time() - t0:.1f}s")
```

<div class="line-notes">

- `import time` 标准库的时间模块。`time.sleep(1)` 让程序停 1 秒,`time.time()` 拿当前时间戳(秒,带小数),相当于 JS 的 `Date.now() / 1000`。
- `time.sleep(1)` 模拟一个要花 1 秒的节点,比如查库或者调接口。Python 的 `sleep` 会真的卡住这一行,不像 JS 的 `setTimeout` 是排一个回调。
- `return {"amount": 2392}` 和 Day 322 一样,draft 把金额定成 2392。
- `graph = builder.compile()` 今天前四步都不需要 checkpointer,`stream` 和 `invoke` 一样,不带 checkpointer 也能跑。
- `if __name__ == "__main__":` 下面的代码只有直接运行这个文件时才执行。第 2 步要 `from stream_updates import builder`,有了这一行,导入时就不会把这里的 invoke 和 stream 再跑一遍。Day 322 的 `tt_replay.py` 没加这一行,导入时输出打了两遍,今天把它补上。
- `t0 = time.time()` 记下开始时间,后面减一下就知道过了多久。
- `print("invoke:", graph.invoke({"amount": 0, "result": ""}), f"{time.time() - t0:.1f}s")` 对照组:`invoke` 跑完整张图才返回。`:.1f` 是保留 1 位小数,相当于 JS 的 `.toFixed(1)`。
- `t0 = time.time()` 第二次计时,给 stream 用。
- `for chunk in graph.stream({"amount": 0, "result": ""}, stream_mode="updates"):` 参数和 `invoke` 完全一样,多一个 `stream_mode`。每次循环拿到一个 chunk,这个 for 会一直循环到图跑完。
- `print("updates:", chunk, f"{time.time() - t0:.1f}s")` 打出 chunk 和它到达的时刻。实跑第一个 chunk 在 1.0 秒到,第二个在 2.0 秒到。

</div>

```bash
cd agent-zero-lab/part05/lg_steps
uv run python stream_updates.py
```

```text
invoke: {'amount': 2392, 'result': '已退 2392 元'} 2.0s
updates: {'draft': {'amount': 2392}} 1.0s
updates: {'execute': {'result': '已退 2392 元'}} 2.0s
```

总时间一样是 2 秒,图一点也没变快。区别在于第 1 秒末你就知道 draft 已经做完、金额是 2392,不用干等到第 2 秒。

再看 chunk 的形状:外层是 `{节点名: ...}`,里面是这个节点 `return` 的那个字典,原样照搬。draft 只返回了 `amount`,所以 chunk 里只有 `amount`,`result` 没出现。updates 就是「这一步改了什么」,也就是 Day 322 两张相邻快照之间的差。前端同学可以把它想成 Redux 里的 action:只描述这一步做的修改,不带整个 store。

为什么外层要套一个节点名?因为图里可以有并行节点([Day 305](/blog/agent-zero/day-305-lg-parallel/)),同一步里两个节点都跑完,一个 chunk 里就会有两个键。这时候你才知道每一份修改是谁做的。

## 第 2 步:values,每一步吐一次完整状态

还是同一张图,换成 `stream_mode="values"`。这次加上 checkpointer,顺便和 Day 317 的历史快照对一对。

```python
# agent-zero-lab/part05/lg_steps/stream_values.py
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver

from stream_updates import builder

graph = builder.compile(checkpointer=InMemorySaver())
config: RunnableConfig = {"configurable": {"thread_id": "V1"}}

for state in graph.stream({"amount": 0, "result": ""}, config, stream_mode="values"):
    print("values:", state)

print("history:")
for s in reversed(list(graph.get_state_history(config))):
    print("  ", s.next, s.values)
```

<div class="line-notes">

- `from stream_updates import builder` 导入第 1 步建好的 builder,自己再 compile 一次。因为第 1 步加了 `if __name__ == "__main__":`,导入时那边的 invoke 和 stream 不会执行。
- `graph = builder.compile(checkpointer=InMemorySaver())` 同一个 builder 可以 compile 出不同配置的图,这次带上内存版 checkpointer,才能查历史。
- `config: RunnableConfig = {"configurable": {"thread_id": "V1"}}` 有 checkpointer 就要给 thread_id,Day 316 学过。
- `for state in graph.stream({"amount": 0, "result": ""}, config, stream_mode="values"):` `config` 放第二个参数,和 `invoke` 的写法一样。
- `print("values:", state)` 每次拿到的是完整状态。实跑打了 3 行。
- `for s in reversed(list(graph.get_state_history(config))):` `get_state_history` 是从新到旧,`reversed` 倒过来变成从旧到新,方便和上面对着看。`reversed` 只能用在列表这种知道长度的东西上,所以先 `list()`,相当于 JS 的 `[...it].reverse()`。
- `print("  ", s.next, s.values)` 每张快照打 `next` 和状态。

</div>

```bash
uv run python stream_values.py
```

```text
values: {'amount': 0, 'result': ''}
values: {'amount': 2392, 'result': ''}
values: {'amount': 2392, 'result': '已退 2392 元'}
history:
   ('__start__',) {}
   ('draft',) {'amount': 0, 'result': ''}
   ('execute',) {'amount': 2392, 'result': ''}
   () {'amount': 2392, 'result': '已退 2392 元'}
```

对照着看,values 吐的 3 行和历史里后 3 张快照的 `values` 一模一样。第一行是输入本身(还没有任何节点跑过),这一点和 updates 不同,updates 只在节点跑完时吐,不会把输入吐给你。历史里最早那张 `{}` 是「收到输入之前」的空状态,values 不吐它。

所以两种模式的关系是:**values 是每张快照的全貌,updates 是相邻两张之间的差**。拿 values 的第 2 行减第 1 行,得到的就是 updates 的第 1 个 chunk `{'amount': 2392}`。

什么时候用哪个?updates 小、带节点名,适合做进度展示和后台日志:「draft 跑完了,改了 proposal」。values 大,但拿到就能直接用,不用自己合并,适合调试时看状态一步步怎么变,或者前端只关心「当前完整状态」、每次直接整块替换的场景。真实的 Agent 状态里常有几十条消息,每步都推全量就很浪费,这时候用 updates 自己拼。

## 第 3 步:messages,模型吐一段就推一段

updates 和 values 都是按「步」推的。draft 节点里模型要生成 100 个字,这两种模式都得等它全部生成完才推一次。想做打字机效果,要用第三种:messages。

先做一个实验:第 1 步那张图没有模型,开 messages 会怎样?

```python
# agent-zero-lab/part05/lg_steps/stream_empty.py
from stream_updates import graph

items = list(graph.stream({"amount": 0, "result": ""}, stream_mode="messages"))
print("messages 模式吐了", len(items), "项")
```

<div class="line-notes">

- `from stream_updates import graph` 直接用第 1 步那张不带 checkpointer 的图。
- `items = list(graph.stream({"amount": 0, "result": ""}, stream_mode="messages"))` `list()` 把生成器一口气读完放进列表,相当于 JS 的 `Array.from(迭代器)`。图会正常跑完(要 2 秒)。
- `print("messages 模式吐了", len(items), "项")` 实跑 0 项。

</div>

```bash
uv run python stream_empty.py
```

```text
messages 模式吐了 0 项
```

一项都没有,也不报错。messages 模式只截获**节点里调用 LangChain 聊天模型时产生的输出**,节点里自己 `return` 的普通字典它不管。第一次用的时候我以为是自己写错了,其实是图里根本没有模型。

要演示 messages 又不想花钱,用 langchain-core 自带的假模型 `GenericFakeChatModel`:你先告诉它要回什么话,它被调用时把这句话按空格切开,一段段吐出来,不联网。这张图两个节点都「调模型」:classify 给工单打标签,draft 写回复。

```python
# agent-zero-lab/part05/lg_steps/stream_messages.py
from itertools import cycle
from typing import TypedDict

from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage
from langgraph.graph import START, StateGraph

tagger = GenericFakeChatModel(messages=cycle([AIMessage(content="退款类")]))
writer = GenericFakeChatModel(messages=cycle([AIMessage(content="INV-2026-0123 是 重复扣款 建议 退 2392 元")]))


class State(TypedDict):
    ticket: str
    tag: str
    reply: str


def classify(state: State) -> dict:
    return {"tag": tagger.invoke(state["ticket"]).content}


def draft(state: State) -> dict:
    return {"reply": writer.invoke(state["ticket"]).content}


builder = StateGraph(State)
builder.add_node("classify", classify)
builder.add_node("draft", draft)
builder.add_edge(START, "classify")
builder.add_edge("classify", "draft")
graph = builder.compile()
inputs: State = {"ticket": "T1041 我被扣了两次钱", "tag": "", "reply": ""}

if __name__ == "__main__":
    for token, meta in graph.stream(inputs, stream_mode="messages"):
        print(repr(token.content), meta["langgraph_node"], meta["langgraph_step"])
```

<div class="line-notes">

- `from itertools import cycle` `cycle([a])` 返回一个无限重复 `a` 的迭代器。假模型每被调用一次就从里面取下一条回复,用 `cycle` 才能反复调用,后面几个脚本会导入这张图跑好几遍。
- `from langchain_core.language_models.fake_chat_models import GenericFakeChatModel` 假模型在 langchain-core 里,不用另装包。它和 Day 320 的 `ChatOpenAI` 是同一类对象,有 `invoke`,也会被 LangGraph 截获流式输出。
- `tagger = GenericFakeChatModel(messages=cycle([AIMessage(content="退款类")]))` 打标签的假模型,永远回「退款类」。中间没有空格,所以会整段吐出来。
- `writer = GenericFakeChatModel(messages=cycle([AIMessage(content="INV-2026-0123 是 重复扣款 建议 退 2392 元")]))` 写回复的假模型。我故意在词之间加了空格,它按空格切,就能看到一段段的效果。
- `return {"tag": tagger.invoke(state["ticket"]).content}` 节点里用的是 `invoke`,不是 `stream`。不用改成 stream,LangGraph 会在模型上挂一个回调,模型每产出一段就截下来推给你。
- `return {"reply": writer.invoke(state["ticket"]).content}` draft 同理。
- `inputs: State = {"ticket": "T1041 我被扣了两次钱", "tag": "", "reply": ""}` 把输入单独存一个变量,下面几个脚本都导入它。
- `for token, meta in graph.stream(inputs, stream_mode="messages"):` messages 模式每一项是一个二元组 `(片段, 元数据)`,`for a, b in ...` 当场拆开,相当于 JS 的 `for (const [token, meta] of ...)`。
- `print(repr(token.content), meta["langgraph_node"], meta["langgraph_step"])` `token.content` 是这一段的文字,`repr` 会带上引号,空格也能看见。`meta` 是个字典,`langgraph_node` 写着片段来自哪个节点,`langgraph_step` 是第几步。

</div>

```bash
uv run python stream_messages.py
```

```text
'退款类' classify 1
'INV-2026-0123' draft 2
' ' draft 2
'是' draft 2
' ' draft 2
'重复扣款' draft 2
' ' draft 2
'建议' draft 2
' ' draft 2
'退' draft 2
' ' draft 2
'2392' draft 2
' ' draft 2
'元' draft 2
```

classify 吐了 1 段,draft 吐了 13 段(词和空格交替)。真模型按 token 切,一个 token 大约是一两个汉字,所以真实的片段会比这多得多,第 5 步会看到 71 段。

**两个节点的片段混在同一个流里。** 做打字机效果时,你多半只想显示 draft 写的回复,不想把 classify 的「退款类」也打到用户屏幕上。所以要按 `meta["langgraph_node"]` 过滤。Day 311 那种 Agent 循环里更明显,tools 节点返回的工具结果也会出现在 messages 流里。

### 编辑器里的三条红线

上面的代码能跑,输出也对,但在 Zed 里打开,最后那行有三条红线。用 basedpyright 看原文:

```bash
cd agent-zero-lab
uv run basedpyright part05/lg_steps/stream_messages.py
```

```text
part05/lg_steps/stream_messages.py:37:26 - error: Cannot access attribute "content" for class "str"
    Attribute "content" is unknown (reportAttributeAccessIssue)
part05/lg_steps/stream_messages.py:37:36 - error: Argument of type "Literal['langgraph_node']" cannot be assigned to parameter "key" of type "SupportsIndex | slice[SupportsIndex | None, SupportsIndex | None, SupportsIndex | None]" in function "__getitem__"
...
3 errors, 0 warnings, 0 notes
```

(路径前面那一长串我删了,还有几行缩进的补充说明也省略了。)类型检查器说:`token` 可能是一个 `str`,`str` 没有 `.content`;`meta` 可能也是 `str`,字符串不能用 `"langgraph_node"` 当下标。为什么它会这么想?因为 `stream` 的返回类型写得很宽:同一个函数,传一种模式、传多种模式、开不开子图,吐出来的东西形状都不一样,它只能写成「各种可能都有」。其中一种可能就是「(模式名字符串, 数据)」,下一步你会看到这种情况真的会发生。

旧写法的常见对付办法是 `cast` 强行告诉检查器「相信我,它是元组」。LangGraph 现在给了更好的办法:`version="v2"`。

```python
# agent-zero-lab/part05/lg_steps/stream_messages_v2.py
from stream_messages import graph, inputs

for part in graph.stream(inputs, stream_mode="messages", version="v2"):
    if part["type"] == "messages":
        token, meta = part["data"]
        if meta["langgraph_node"] == "draft":
            print(token.content, end="|", flush=True)
print()
```

<div class="line-notes">

- `from stream_messages import graph, inputs` 同一张图、同一份输入,只改读流的方式。
- `for part in graph.stream(inputs, stream_mode="messages", version="v2"):` 加上 `version="v2"`,每一项不再是裸元组,而是一个固定形状的字典:`{"type": 模式名, "ns": 命名空间, "data": 数据}`。`ns` 明天讲子图时才用得上,今天它一直是空元组 `()`。
- `if part["type"] == "messages":` 这个 `if` 是给类型检查器看的。v2 的类型定义是一个按 `type` 区分的联合类型,判断完 `type` 之后,检查器就知道 `data` 一定是 `(片段, 元数据)`。TS 里的可辨识联合(discriminated union)就是这个东西:`if (part.type === "messages") { part.data ... }`。
- `token, meta = part["data"]` 拆开元组,和上面一样。
- `if meta["langgraph_node"] == "draft":` 只要 draft 节点的片段,classify 的「退款类」被滤掉。
- `print(token.content, end="|", flush=True)` `end="|"` 让 print 结尾打一个竖线而不换行(默认 `end` 是换行符),这里用竖线是为了看清每一段的边界;做真打字机时写 `end=""`。`flush=True` 立刻把字推到终端,不然 Python 会攒一会儿再一起显示,打字机效果就没了。Day 134 用 openai SDK 读流时也是这两个参数。
- `print()` 最后补一个换行。

</div>

```bash
cd part05/lg_steps
uv run python stream_messages_v2.py
cd ../.. && uv run basedpyright part05/lg_steps/stream_messages_v2.py
```

```text
INV-2026-0123| |是| |重复扣款| |建议| |退| |2392| |元|
0 errors, 0 warnings, 0 notes
```

「退款类」没了,只剩 draft 的片段;basedpyright 0 报错。v2 是 LangGraph 1.x 新加的格式,不写 `version` 时默认还是老格式(官方文档叫它 v1),所以网上大部分例子是老写法,看到要认得。这门课从今天起,凡是读流都写 `version="v2"`。

## 第 4 步:一次开两种模式

真实的界面往往两样都要:进度条要 updates,打字机要 messages。`stream_mode` 可以传一个列表。先用老格式写,看会发生什么:

```python
# agent-zero-lab/part05/lg_steps/stream_combo_bad.py
from stream_messages import graph, inputs

for token, meta in graph.stream(inputs, stream_mode=["updates", "messages"]):
    print(token.content, meta)
```

<div class="line-notes">

- `for token, meta in graph.stream(inputs, stream_mode=["updates", "messages"]):` 照搬第 3 步的拆包写法,只是把模式换成了列表。
- `print(token.content, meta)` 第一次循环就会在这里炸。

</div>

```bash
cd part05/lg_steps
uv run python stream_combo_bad.py
```

```text
Traceback (most recent call last):
  File ".../part05/lg_steps/stream_combo_bad.py", line 5, in <module>
    print(token.content, meta)
          ^^^^^^^^^^^^^
AttributeError: 'str' object has no attribute 'content'
```

报错说 `token` 是字符串。传多种模式时,老格式的每一项变成了 `(模式名, 数据)`:第一项是 `('messages', (片段, 元数据))`,`token` 拿到的是字符串 `'messages'`。这就是第 3 步那三条红线在警告的事,当时代码能跑只是因为只开了一种模式。拆包两边个数一样(都是 2),Python 不会提前报错,一直走到 `.content` 才炸。

换成 v2,两种模式靠 `part["type"]` 分开:

```python
# agent-zero-lab/part05/lg_steps/stream_combo.py
from stream_messages import graph, inputs

for part in graph.stream(inputs, stream_mode=["updates", "messages"], version="v2"):
    if part["type"] == "updates":
        print("\n[进度]", list(part["data"]), "跑完")
    elif part["type"] == "messages":
        token, meta = part["data"]
        print(token.content, end="", flush=True)
```

<div class="line-notes">

- `for part in graph.stream(inputs, stream_mode=["updates", "messages"], version="v2"):` 两种模式的输出按发生顺序混在同一个流里,每一项都带 `type`。
- `if part["type"] == "updates":` updates 那一项,`data` 是 `{节点名: 修改}`。
- `print("\n[进度]", list(part["data"]), "跑完")` `list(字典)` 得到所有键,也就是这一步跑完的节点名,相当于 JS 的 `Object.keys(...)`。前面加 `\n` 是因为打字机那边没换行,不加的话进度会接在片段后面。
- `elif part["type"] == "messages":` messages 那一项。`elif` 就是 JS 的 `else if`。
- `token, meta = part["data"]` 和第 3 步一样拆开。
- `print(token.content, end="", flush=True)` 打字机,不过滤节点,两个节点的片段都打出来,方便看顺序。

</div>

```bash
uv run python stream_combo.py
```

```text
退款类
[进度] ['classify'] 跑完
INV-2026-0123 是 重复扣款 建议 退 2392 元
[进度] ['draft'] 跑完
```

顺序很清楚:classify 的片段先到,然后 classify 的 updates 到;draft 的 13 段片段一段段到,最后 draft 的 updates 到。也就是说,**一个节点的 messages 片段总是在它自己的 updates 之前**,updates 到了就说明这个节点的模型已经说完了。做界面时可以靠这一点:收到某节点的 updates,就把它那块打字区域标成「完成」。

再对比一下两种格式,方便以后看别人的代码:

| 写法 | 一种模式时每项是 | 多种模式时每项是 |
| --- | --- | --- |
| 不写 `version`(v1,默认) | 直接是数据:updates 是字典,messages 是 `(片段, 元数据)` | `(模式名, 数据)` 元组 |
| `version="v2"` | `{"type", "ns", "data"}` 字典 | 还是 `{"type", "ns", "data"}`,形状不变 |

v2 的好处就在第二列和第三列一样:加一种模式、去一种模式,读流的代码不用改形状。

LangGraph 还有别的模式:`custom`(节点里用 `get_stream_writer()` 自己推任意数据)、`checkpoints`、`tasks`、`debug`,文档里有一张表。今天不展开,[Day 382](/blog/agent-zero/day-382-langgraph-adapter/) 把图的输出翻译成给前端的 SSE 事件时,再看要不要用它们。官方文档还在推一套更新的 `stream_events(..., version="v3")` API,目前文档对它的输出格式写得不多,我们先把 `stream` 用熟。

## 第 5 步:退款审批的流式 start

现在给退款审批写一个流式版的 start。和 Day 322 的 `refund_tt.py` 一样,不改 `refund_approval.py`,另写一个文件导入它的 `builder` 和 `CKPT_DB`。

先按第 4 步的思路直接写,只开 messages,把 `token.content` 打出来:

```python
# agent-zero-lab/part05/lgdemo/refund_stream_bad.py
import sqlite3
import sys

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.sqlite import SqliteSaver

from refund_approval import CKPT_DB, builder

config: RunnableConfig = {"configurable": {"thread_id": f"refund-{sys.argv[1]}"}}
with sqlite3.connect(CKPT_DB, check_same_thread=False) as conn:
    graph = builder.compile(checkpointer=SqliteSaver(conn))
    count = 0
    for part in graph.stream({"ticket_id": sys.argv[1]}, config, stream_mode="messages", version="v2"):
        if part["type"] == "messages":
            token, meta = part["data"]
            count += 1
            print(token.content, end="", flush=True)
    print("\n收到", count, "项")
```

<div class="line-notes">

- `from refund_approval import CKPT_DB, builder` Day 320 的图和 checkpoint 库路径。`refund_approval.py` 末尾有 `if __name__ == "__main__":`,导入时不会执行它的 `main()`。
- `config: RunnableConfig = {"configurable": {"thread_id": f"refund-{sys.argv[1]}"}}` 和 Day 320 一样的 thread_id 拼法,T1041 对应 `refund-T1041`。
- `with sqlite3.connect(CKPT_DB, check_same_thread=False) as conn:` 和 Day 318 一样打开 checkpoint 库。
- `for part in graph.stream({"ticket_id": sys.argv[1]}, config, stream_mode="messages", version="v2"):` 输入和 Day 320 的 start 一样只给 `ticket_id`。
- `count += 1` 数一共收到多少项,`+=` 和 JS 一样。
- `print(token.content, end="", flush=True)` 打字机,想看模型一段段写出方案。

</div>

```bash
cd agent-zero-lab && uv run python cloudledger/seed.py && cd part05/lgdemo
rm -f checkpoints.db
uv run python refund_stream_bad.py T1041
```

```text
已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}

收到 81 项
```

收到 81 项,屏幕上一个字都没打出来。我第一次跑到这里愣了一下。把其中几项原样打出来看(这是我调试时临时加的 print,只摘几行):

```text
AIMessageChunk '' [] draft
AIMessageChunk '' [{'name': 'Proposal', 'args': '', 'id': 'call_00_yvWsLZBuVL1o6Mpu6KNf6022', 'index': 0, 'type': 'tool_call_chunk'}] draft
AIMessageChunk '' [{'name': None, 'args': '{', 'id': None, 'index': 0, 'type': 'tool_call_chunk'}] draft
AIMessageChunk '' [{'name': None, 'args': '"', 'id': None, 'index': 0, 'type': 'tool_call_chunk'}] draft
AIMessageChunk '' [{'name': None, 'args': 'IN', 'id': None, 'index': 0, 'type': 'tool_call_chunk'}] draft
```

每一列依次是片段的类型、`content`、`tool_call_chunks`、节点名。`content` 全是空字符串,真正的内容在 `tool_call_chunks` 里:`{`、`"`、`IN`……是一段 JSON 被切成了碎片。

原因在 Day 320 的 draft 节点:它用的是 `with_structured_output(Proposal, method="function_calling")`。这个写法其实是让模型「调用一个叫 Proposal 的工具」,方案以工具参数的形式返回([Day 156](/blog/agent-zero/day-156-fc-idea/) 讲过,模型调工具就是写一段 JSON)。模型从头到尾没有说一句普通的话,所以 `content` 一直是空的,参数 JSON 一段段放在 `tool_call_chunks[i]["args"]` 里。

知道了这一点,改起来就简单了。完整的 `refund_stream.py`:

```python
# agent-zero-lab/part05/lgdemo/refund_stream.py
"""refund_approval.py start 的流式版本:节点跑完打一行进度,draft 起草时把模型吐的片段实时打出来。

用法(在 agent-zero-lab/part05/lgdemo 目录下):
  uv run python refund_stream.py T1041
批准/驳回还是用 refund_approval.py approve / reject。
"""
import sqlite3
import sys
import time

from langchain_core.messages import AIMessageChunk
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.sqlite import SqliteSaver

from refund_approval import CKPT_DB, builder

LABELS = {"load": "读完工单和发票", "draft": "方案起草完成", "__interrupt__": "停在审批点,等主管处理"}


def main() -> None:
    ticket_id = sys.argv[1]
    config: RunnableConfig = {"configurable": {"thread_id": f"refund-{ticket_id}"}}

    with sqlite3.connect(CKPT_DB, check_same_thread=False) as conn:
        graph = builder.compile(checkpointer=SqliteSaver(conn))
        t0 = time.time()
        pieces = 0
        for part in graph.stream({"ticket_id": ticket_id}, config, stream_mode=["updates", "messages"], version="v2"):
            if part["type"] == "messages":
                token, meta = part["data"]
                if meta["langgraph_node"] != "draft" or not isinstance(token, AIMessageChunk):
                    continue
                for c in token.tool_call_chunks:
                    if c["args"]:
                        pieces += 1
                        print(c["args"], end="", flush=True)
            elif part["type"] == "updates":
                for node in part["data"]:
                    print(f"\n[{time.time() - t0:4.1f}s] {LABELS.get(node, node)}")
        print(f"模型一共吐了 {pieces} 段参数片段")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from langchain_core.messages import AIMessageChunk` 模型流式输出的每一段都是 `AIMessageChunk`(「AI 消息的一块」),下面要用它判断类型。
- `LABELS = {"load": "读完工单和发票", "draft": "方案起草完成", "__interrupt__": "停在审批点,等主管处理"}` 节点名到中文进度的对照表,给人看的。`__interrupt__` 不是节点,是 interrupt 发生时 updates 里出现的特殊键,下面会看到。
- `t0 = time.time()` 计时起点,进度行前面打出过了几秒。
- `pieces = 0` 数一共打出多少段片段。
- `for part in graph.stream({"ticket_id": ticket_id}, config, stream_mode=["updates", "messages"], version="v2"):` 第 4 步的组合写法,同时要进度和片段。
- `if part["type"] == "messages":` 先处理模型片段。
- `token, meta = part["data"]` 拆出片段和元数据。
- `if meta["langgraph_node"] != "draft" or not isinstance(token, AIMessageChunk):` 两个条件任一成立就跳过:不是 draft 节点的,或者不是模型片段的。`isinstance(x, 类)` 判断类型,相当于 JS 的 `x instanceof AIMessageChunk`。类型上 `token` 是更宽的消息基类,只有判断成 `AIMessageChunk` 之后,下一行的 `.tool_call_chunks` 才不会被标红。
- `continue` 跳到下一次循环,和 JS 一样。
- `for c in token.tool_call_chunks:` 这一段里的工具调用碎片,通常只有 0 或 1 个。每个 `c` 是一个字典,有 `name`、`args`、`id`、`index`。
- `if c["args"]:` 第一段的 `args` 是空字符串(只带了工具名 `Proposal`),最后一段可能是 `None`,都跳过。空字符串和 `None` 在 if 里都算假。
- `print(c["args"], end="", flush=True)` 打出这一段 JSON 碎片,不换行,立刻刷新。
- `elif part["type"] == "updates":` 节点跑完了。
- `for node in part["data"]:` 遍历字典的键,也就是这一步跑完的节点名。interrupt 发生时,这里会出现一个 `__interrupt__` 键。
- `print(f"\n[{time.time() - t0:4.1f}s] {LABELS.get(node, node)}")` `:4.1f` 是总宽 4 位、1 位小数,让时间对齐。`LABELS.get(node, node)` 查不到就原样用节点名,相当于 JS 的 `LABELS[node] ?? node`。
- `print(f"模型一共吐了 {pieces} 段参数片段")` 最后报一下片段数。

</div>

```bash
cd agent-zero-lab && uv run python cloudledger/seed.py && cd part05/lgdemo
rm -f checkpoints.db
uv run python refund_stream.py T1041
uv run python refund_approval.py status T1041
```

```text
已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}

[ 0.2s] 读完工单和发票
{"invoice_id": "INV-2026-0123", "amount_yuan": 2392.00, "reason": "与 INV-2026-0026 为同日同额重复扣款，INV-2026-0123 为较晚生成的一张，退还该重复笔"}
[ 1.4s] 方案起草完成

[ 1.4s] 停在审批点,等主管处理
模型一共吐了 71 段参数片段
下一步要执行的节点: ('approval',)
当前方案: {'invoice_id': 'INV-2026-0123', 'amount_yuan': 2392.0, 'reason': '与 INV-2026-0026 为同日同额重复扣款，INV-2026-0123 为较晚生成的一张，退还该重复笔'}
```

终端里那段 JSON 是一点点长出来的(文章里只能贴最终样子)。0.2 秒 load 跑完;接着模型开始吐参数,71 段在 1.2 秒内到齐;1.4 秒 draft 的 updates 到,紧接着 `__interrupt__` 也到了,图停在审批点。

`status` 用的是 Day 320 原封不动的代码,`next` 是 `('approval',)`,方案和流里看到的一致。**换成 stream 不影响 checkpoint**:图照样一步步存快照,照样在 interrupt 处停下,接下来用 `refund_approval.py approve T1041` 就能接着跑。stream 只是「怎么把过程给你看」,不是另一种执行方式。

还有一个细节。updates 里那一项 `__interrupt__` 的数据是一个元组,里面是 Day 319 见过的 `Interrupt(value={...}, id=...)`,和 `invoke` 返回值里的 `result["__interrupt__"]` 是同一个东西。所以流式版不需要再 `invoke` 一次去拿中断内容,在流里就能拿到。

给用户看的界面上当然不该显示一坨 JSON。想只显示 `reason` 那段文字,要边收边从不完整的 JSON 里找出 reason 字段,练习 3 会做。

### 这一天的花费

前四步全是假模型,不花钱。真调模型的是第 5 步的两个脚本和练习 1、练习 3,我写这篇时一共调了 6 次(包括摘那几行片段时临时跑的一次调试脚本,还有练习 1 里第一次跑错线多调的一次)。每次就是 Day 320 的那一次 draft 调用,按 Day 320 第 2 步算出的约 0.00125 元一次:6 × 0.00125 ≈ 0.0075 元,不到一分钱。流式不会多花钱,token 数和 invoke 完全一样,只是分批到。

## 动手练习

**练习 1:用 values 看退款图的状态怎么长出来。** 写 `stream_keys.py`,用 `stream_mode="values"` 跑退款图的 start,每一步只打印状态里有哪些键(排好序),不打值。先 seed、删 `checkpoints.db`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lgdemo/stream_keys.py
import sqlite3
import sys

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.sqlite import SqliteSaver

from refund_approval import CKPT_DB, builder

config: RunnableConfig = {"configurable": {"thread_id": f"refund-{sys.argv[1]}"}}
with sqlite3.connect(CKPT_DB, check_same_thread=False) as conn:
    graph = builder.compile(checkpointer=SqliteSaver(conn))
    for i, state in enumerate(graph.stream({"ticket_id": sys.argv[1]}, config, stream_mode="values")):
        print(i, sorted(state))
```

<div class="line-notes">

- `for i, state in enumerate(graph.stream({"ticket_id": sys.argv[1]}, config, stream_mode="values")):` `enumerate` 给每一项配一个从 0 开始的序号,相当于 JS 的 `arr.forEach((state, i) => ...)`,只是顺序是 `(序号, 值)`。这里只开一种模式又只用到字典的键,不写 `version="v2"` 类型检查也不报错。
- `print(i, sorted(state))` `sorted(字典)` 返回排好序的键列表。键少时一眼就能看出哪一步多了什么。

</div>

```bash
cd agent-zero-lab && uv run python cloudledger/seed.py && cd part05/lgdemo
rm -f checkpoints.db
uv run python stream_keys.py T1041
```

```text
已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}
0 ['ticket_id']
1 ['invoices', 'ticket_id', 'ticket_text']
2 ['invoices', 'proposal', 'ticket_id', 'ticket_text']
3 ['__interrupt__', 'invoices', 'proposal', 'ticket_id', 'ticket_text']
```

第 0 行是输入,只有 `ticket_id`;load 跑完多了 `ticket_text` 和 `invoices`;draft 跑完多了 `proposal`;最后一行多了一个 `__interrupt__`,老格式的 values 模式就是这样告诉你「停在中断了」(v2 格式里中断放在每一项的 `interrupts` 字段,不混进状态)。`decision` 和 `outcome` 还没出现,因为 approval 之后的节点还没跑。

我第一次做这道题忘了删 `checkpoints.db`,在已经停在审批点的线上又跑了一次,第 0 行就已经带着 `proposal` 等全部键,而且 draft 又调了一次模型。这就是 [Day 321](/blog/agent-zero/day-321-week46-review/) 那个坑:对已经存在的线传新输入,会从 START 重跑,旧状态里的字段还在。

</details>

**练习 2:批准也能流式。** 接着练习 1 的状态(停在审批点),写 `approve_stream.py`,把 `Command(resume=...)` 交给 `graph.stream`(而不是 invoke),用 updates 模式打出每一步。批准之后再跑一次,看会输出什么。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lgdemo/approve_stream.py
import sqlite3
import sys

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.types import Command

from refund_approval import CKPT_DB, builder

config: RunnableConfig = {"configurable": {"thread_id": f"refund-{sys.argv[1]}"}}
with sqlite3.connect(CKPT_DB, check_same_thread=False) as conn:
    graph = builder.compile(checkpointer=SqliteSaver(conn))
    resume = Command(resume={"approved": True, "note": sys.argv[2]})
    for chunk in graph.stream(resume, config, stream_mode="updates"):
        print(chunk)
```

<div class="line-notes">

- `from langgraph.types import Command` Day 319 学的恢复命令。
- `resume = Command(resume={"approved": True, "note": sys.argv[2]})` 和 Day 320 `approve` 命令传的东西一样,备注从命令行拿。
- `for chunk in graph.stream(resume, config, stream_mode="updates"):` `invoke` 能接受的第一个参数,`stream` 都能接受:新输入、`None`(Day 322 的重放)、`Command`。
- `print(chunk)` 原样打出每一步的修改。

</div>

```bash
uv run python approve_stream.py T1041 "流式批准"
sqlite3 ../../cloudledger/cloudledger.db "select id, invoice_id, amount_cents, status from refund_requests"
uv run python approve_stream.py T1041 "再批一次"
```

```text
{'approval': {'decision': {'approved': True, 'note': '流式批准'}}}
{'execute': {'outcome': '已批准:INV-2026-0123 退 2392.00 元。审批备注:流式批准'}}
1|INV-2026-0123|239200|approved
```

恢复之后先到 approval 的修改(`decision` 写进状态),再到 execute 的修改,业务库多了一行。第二次 `再批一次` 一行都没打:这条线已经跑完,没有待恢复的中断,`stream` 什么也不吐就结束了,也不报错。用 `invoke` 时这种情况会返回原来的状态,用 `stream` 时是「安静地什么都没有」,做界面时要处理这种空流,不然前端会一直等。

</details>

**练习 3(开放题):只把 reason 打成打字机,并量出第一段到达的时间。** 第 5 步屏幕上是一整坨 JSON。改写成只显示 `reason` 字段的文字,一个字一个字地出来;同时记下从开始到第一段参数到达用了多久、全部结束用了多久。

<details><summary>参考答案</summary>

示范解法:把参数碎片拼进一个字符串 `buf`,每收到一段就在 `buf` 里找 `"reason": "` 这个标记,找到了就把标记后面、下一个双引号之前的文字取出来,只打新增的那部分。

```python
# agent-zero-lab/part05/lgdemo/reason_typewriter.py
import re
import sqlite3
import sys
import time

from langchain_core.messages import AIMessageChunk
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.sqlite import SqliteSaver

from refund_approval import CKPT_DB, builder

MARK = re.compile(r'"reason"\s*:\s*"')
config: RunnableConfig = {"configurable": {"thread_id": f"refund-{sys.argv[1]}"}}
with sqlite3.connect(CKPT_DB, check_same_thread=False) as conn:
    graph = builder.compile(checkpointer=SqliteSaver(conn))
    t0 = time.time()
    first = None
    buf = ""
    shown = 0
    for part in graph.stream({"ticket_id": sys.argv[1]}, config, stream_mode="messages", version="v2"):
        if part["type"] != "messages":
            continue
        token, meta = part["data"]
        if meta["langgraph_node"] != "draft" or not isinstance(token, AIMessageChunk):
            continue
        for c in token.tool_call_chunks:
            if not c["args"]:
                continue
            if first is None:
                first = time.time() - t0
            buf += c["args"]
            m = MARK.search(buf)
            if m:
                text = buf[m.end():].split('"')[0]
                print(text[shown:], end="", flush=True)
                shown = len(text)
    print(f"\n第一段参数到达:{first:.2f}s,全部结束:{time.time() - t0:.2f}s")
```

<div class="line-notes">

- `import re` Python 的正则模块,相当于 JS 的 `RegExp`。
- `MARK = re.compile(r'"reason"\s*:\s*"')` 匹配 `"reason"`、可能有的空格、冒号、空格、开头的双引号。`r'...'` 是原始字符串,反斜杠不用写两遍。实跑模型输出的是 `"reason": "`(冒号后有一个空格),写 `\s*` 是怕别的模型不带空格。
- `first = None` 第一段参数到达的时间,还没到时是 `None`。
- `buf = ""` 拼起来的参数 JSON,越来越长。
- `shown = 0` reason 文字已经打出去多少个字,下次只打后面新增的。
- `if part["type"] != "messages":` 只开了 messages 一种模式,这个判断是为了让类型检查器收窄 `data` 的类型。
- `if meta["langgraph_node"] != "draft" or not isinstance(token, AIMessageChunk):` 和第 5 步一样的过滤。
- `if not c["args"]:` 空的碎片跳过。
- `if first is None:` 第一次走到这里,说明第一段真内容到了。
- `first = time.time() - t0` 实跑 1.21 秒。
- `buf += c["args"]` 把碎片接上。
- `m = MARK.search(buf)` 在已经拼好的部分里找标记,没找到返回 `None`。每次都从头找,`buf` 只有一两百个字符,不用担心慢。
- `text = buf[m.end():].split('"')[0]` `m.end()` 是标记结束的位置,往后切就是 reason 的文字;`split('"')[0]` 截到下一个双引号为止,结尾的 `"}` 就不会打出来。
- `print(text[shown:], end="", flush=True)` 只打新增的部分。
- `shown = len(text)` 记下已经打到哪。
- `print(f"\n第一段参数到达:{first:.2f}s,全部结束:{time.time() - t0:.2f}s")` 两个时间。

</div>

```bash
cd agent-zero-lab && uv run python cloudledger/seed.py && cd part05/lgdemo
rm -f checkpoints.db
uv run python reason_typewriter.py T1041
```

```text
已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}
与 INV-2026-0026 同为 2026-10-08 扣款、金额相同，属重复扣款，退较晚生成的 INV-2026-0123 一笔
第一段参数到达:1.21s,全部结束:1.50s
```

屏幕上只有理由那句话,一个个字出来。时间很说明问题:前 1.21 秒什么都没有(load 的 0.2 秒加上模型的首 token 延迟,Day 133 讲过),后面 0.3 秒参数全部到齐。也就是说,这张图里流式真正改善的是那 0.3 秒,用户等待的大头是首 token 之前。对这么短的方案,打字机效果有点锦上添花;但第 5 步那种「读完工单和发票」的进度行,从 0.2 秒开始就让用户知道系统在动,这个价值更实在。

这个解法有两个已知的毛病,写在这里免得你以为它是通用的:理由里如果有转义的双引号 `\"`,`split('"')` 会提前截断;字段顺序换了(比如 reason 在 amount 前面)也照样能用,但如果模型输出的 JSON 里有两个 `"reason"` 就会认错。真要做,用能解析不完整 JSON 的库,或者让模型把要给人看的文字放在普通回复里、结构化数据另外传。

</details>

**验收标准**:能用第 1、2 步的输出说出 updates 和 values 的区别(差量 vs 全量,values 会先吐输入);能解释 `stream_combo_bad.py` 为什么报 `'str' object has no attribute 'content'`,并用 v2 写法修好;`refund_stream.py` 跑通,能指出进度行、参数片段、`__interrupt__` 各自来自哪种模式;能说清结构化输出的片段为什么在 `tool_call_chunks` 里。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| stream | `graph.stream(输入, config, stream_mode=...)`,和 invoke 跑的是同一张图,只是每有进展就 yield 一次,返回一个生成器 |
| stream_mode | 决定 stream 每次推什么。今天讲的三个:`updates`、`values`、`messages`;可以传列表一次开多种 |
| updates | 每个节点跑完推一次 `{节点名: 它返回的字典}`,是相邻两张快照的差 |
| values | 开头推一次输入,之后每一步推一次完整状态,和每张快照的 values 一样 |
| messages | 节点里调聊天模型时,模型每产出一段就推一次 `(片段, 元数据)`;没有模型的图吐 0 项 |
| langgraph_node | messages 元数据里的字段,写着这段片段来自哪个节点,做打字机时靠它过滤 |
| AIMessageChunk | 模型流式输出的一块,有 `content`(文字片段)和 `tool_call_chunks`(工具调用参数的碎片) |
| tool_call_chunks | 模型以工具调用方式输出时,参数 JSON 被切成的碎片列表,每个碎片的 `args` 是一小段字符串 |
| v2 流格式 | `version="v2"`,每项都是 `{"type", "ns", "data"}`,按 `type` 区分;不管开几种模式形状都一样,类型检查器认得 |
| GenericFakeChatModel | langchain-core 自带的假聊天模型,回复写死,按空格切开流式吐出,不联网,写演示和测试用 |

## 常见误区

**以为 stream 能让图跑得更快。** 第 1 步实测,invoke 和 stream 都是 2.0 秒。stream 只改变你什么时候看到结果,不改变图要做的事;练习 3 里首段参数要等 1.21 秒,流式也省不掉。

**messages 模式什么都没吐,以为写错了。** 它只截获节点里调用 LangChain 聊天模型的输出。第 3 步那张没有模型的图吐了 0 项,不报错。节点里用 openai SDK 直接调模型(不走 LangChain)也截不到,要么换成 LangChain 的模型对象,要么用 `custom` 模式自己推。

**结构化输出时打印 `token.content`。** Day 320 的 draft 用 `with_structured_output(..., method="function_calling")`,模型是在「调用工具」,第 5 步实测 81 项片段的 `content` 全是空字符串,内容在 `token.tool_call_chunks[i]["args"]` 里。

**开多种模式还按一种模式拆包。** 老格式下 `stream_mode=["updates", "messages"]` 每项变成 `(模式名, 数据)`,`for token, meta in ...` 拆出来的 `token` 是字符串 `'messages'`,报 `AttributeError: 'str' object has no attribute 'content'`。写 `version="v2"`,按 `part["type"]` 分支。

**不过滤节点就做打字机。** 第 3 步两个节点的片段混在一个流里,classify 的「退款类」也会出现。按 `meta["langgraph_node"]` 只留要显示的节点。

**对已经跑完的线 stream 一个 Command,以为会报错。** 练习 2 第二次批准,流里什么都没有,程序安静地结束。界面上要处理「流结束了但没收到任何东西」的情况。

**分不清 values 和 updates 谁多吐一次。** values 会先把输入吐一遍,所以两节点图 values 吐 3 次、updates 吐 2 次(第 1、2 步)。拿 values 的行数数节点会多数一个。

## 学习资料

### 文档与文章

- [LangGraph · Streaming](https://docs.langchain.com/oss/python/langgraph/streaming):今天的主文档,开头那张 stream mode 表和「v2 stream format」一节最重要,30 分钟。Subgraph 那一节明天用。
- [LangGraph · Event streaming](https://docs.langchain.com/oss/python/langgraph/event-streaming):官方推荐的新 `stream_events` API,先扫一眼知道有这么个东西,10 分钟。
- [MDN · 使用服务器发送事件](https://developer.mozilla.org/zh-CN/docs/Web/API/Server-sent_events/Using_server-sent_events):中文。前端那一头怎么收流,Day 133 看过的可以跳过;今天 Python 这边拿到的 chunk,将来就是要通过它推到浏览器里,10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1z3NY66EY1&p=108&autoplay=0&high_quality=1" title="尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>尚硅谷 · LangGraph 教程 · 第 108 集「流式执行_基础状态内容输出」(10 分钟),讲 values 和 updates,对应今天第 1、2 步。第 107 集是流式执行概述(8 分钟),可以先看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1z3NY66EY1&p=109&autoplay=0&high_quality=1" title="尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>尚硅谷 · LangGraph 教程 · 第 109 集「流式执行_messages消息」(5 分钟),对应第 3 步。第 110–112 集讲 checkpoints、debug 和自定义输出,今天不要求,有兴趣再看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/D1PcZaeQ2eg" title="Streaming in LangGraph | CampusX" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>CampusX · Streaming in LangGraph · 印度口音英语,有自动字幕。讲 LangGraph 里流式输出的几种模式,配合聊天界面演示,可以看看 messages 模式接到界面上的样子。</figcaption>
</figure>

### 书籍

- Mayo Oshin、Nuno Campos《Learning LangChain》(O'Reilly,2025):讲 LangGraph 的章节有流式输出的内容。书里的 API 写法可能比今天的版本旧,`version="v2"` 是后来才有的,以今天的文档为准。英文原版。

### 开源项目与代码

- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):`libs/langgraph/langgraph/types.py` 里能找到 v2 那几种 StreamPart 的类型定义,看一眼就明白 `part["type"]` 为什么能让检查器收窄类型。

## 自测

1. 两个节点 A → B 的图,不带 checkpointer,分别用 updates 和 values 跑,各吐几次?第一次吐的分别是什么?

<details><summary>答案</summary>

updates 2 次,第一次是 `{'A': A 返回的字典}`;values 3 次,第一次是输入本身。第 1、2 步的玩具图就是这个结果。

</details>

2. 为什么第 3 步不改节点里的 `invoke`,messages 模式也能拿到一段段的输出?

<details><summary>答案</summary>

LangGraph 在运行节点时给 LangChain 的模型对象挂了回调,模型内部按流式方式生成,每产出一段就通过回调推给 stream。所以节点里写 `invoke` 就够了。前提是模型必须是 LangChain 的聊天模型对象;没有模型的图吐 0 项。

</details>

3. 下面这段代码在只开一种模式时能跑,改成 `stream_mode=["updates", "messages"]` 就报错。报什么错?怎么改?

```python
for token, meta in graph.stream(inputs, stream_mode="messages"):
    print(token.content)
```

<details><summary>答案</summary>

报 `AttributeError: 'str' object has no attribute 'content'`。多种模式下老格式每项是 `(模式名, 数据)`,`token` 拿到的是字符串 `'updates'` 或 `'messages'`。改成 `graph.stream(..., version="v2")`,循环里先 `if part["type"] == "messages":` 再 `token, meta = part["data"]`。

</details>

4. 退款图流式跑 start 时,怎么在流里知道图停在了审批点,不用事后再查 `get_state`?

<details><summary>答案</summary>

开 updates 模式,停在 interrupt 时会收到一项 `{'__interrupt__': (Interrupt(value=..., id=...),)}`,里面的 value 就是交给主管的那份方案。老格式的 values 模式会在最后一份状态里多出 `__interrupt__` 键;v2 格式把中断放在 values 那一项的 `interrupts` 字段。

</details>

5. **面试题**:「你们的 Agent 前端要显示『正在查询发票…』这样的进度,还要把最终回复做成打字机效果。后端用 LangGraph,你怎么设计?」

<details><summary>答案</summary>

参考要点:用 `graph.stream(..., stream_mode=["updates", "messages"], version="v2")` 一次拿两种输出。updates 每个节点跑完一项,带节点名,映射成「进度事件」推给前端(节点名到中文文案的对照表放后端);messages 是模型片段,按 `langgraph_node` 只保留生成最终回复的那个节点,映射成「文本增量事件」。要说出几个细节:messages 的元数据里有节点名,不过滤的话分类节点、工具结果都会混进打字机;如果那个节点用的是结构化输出,文字在 `tool_call_chunks` 里而不是 `content`;中断在 updates 里以 `__interrupt__` 出现,要映射成「等待审批」事件;一个节点的 updates 总在它的片段之后,可以当「这段说完了」的信号。传输层用 SSE 推给浏览器,这部分是 Day 379–382 的内容。能补一句「流式不降低总耗时,首 token 延迟才是用户等待的大头,要配合进度事件一起改善体感」会更好。

</details>

## 明天预告

明天是 [Day 324 · LangGraph(二十二):子图,把一段流程封装起来](/blog/agent-zero/day-324-lg-subgraph/)。今天 v2 格式里一直是空元组的那个 `ns`,明天就有用了:把退款审批整个封装成一个子图,放进一个先分类再路由的主图里,子图里的 interrupt、快照、流式输出都要能从父图找到。还会讲子图的持久化策略,也就是子图每次被调用时,是记得上次的状态还是从头来。
