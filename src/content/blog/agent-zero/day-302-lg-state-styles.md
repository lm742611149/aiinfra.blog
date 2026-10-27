---
title: 'Day 302 · LangGraph(三):State 的三种写法'
description: '前两天的状态都是 TypedDict。今天把同一张「分类、起草」两节点图分别用 TypedDict、dataclass、pydantic 的 BaseModel 各写一遍,看节点收到的是字典还是对象、没写的字段是什么样、传错类型在哪里炸,实测 pydantic 的校验发生在下一个节点读状态的时候,而不是写进去的时候。'
pubDate: 2026-10-27
regime: none
tags: ['langgraph', 'state-graph', 'typeddict', 'dataclass', 'pydantic', 'python', 'agent-zero']
series: 'agent-zero'
day: 302
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 301](/blog/agent-zero/day-301-lg-sequence/) 把两个节点串了起来:`classify` 写 `category`,`draft` 读到它再写 `reply`;用 `add_sequence` 少写了几行连线,用 `stream` 看到每个节点各改了什么,还实测了顺序写反时不报错、结果悄悄变差。那两天的状态一直是 `TypedDict` 加 `NotRequired`,读前一个节点的字段要写 `.get("category", "unknown")`,编辑器还会在 `state["category"]` 上画红线。

红线和 `.get` 都是 `TypedDict` 带来的。[Day 299](/blog/agent-zero/day-299-lg-one-node/) 还留了一个问题没答:`TypedDict` 在运行时不检查类型,传个数字当工单会怎样?今天换两种别的写法,把这几件事一起弄清楚。依旧不调模型,花费 ¥0。

## 今天要解决的问题

学完今天,你要能做到:

1. 把同一个状态分别写成 `TypedDict`、`dataclass`、pydantic 的 `BaseModel`,并说出节点里 `state` 各是什么(字典还是对象),读字段该用 `state["x"]` 还是 `state.x`。
2. 说出还没被写过的字段在三种写法里分别是什么样(键不存在、默认值、默认值),以及这对 Day 301 的 `.get` 写法意味着什么。
3. 说出传错类型(数字当工单)、少传必填字段时,三种写法各在哪一步、抛什么错。
4. 说出 pydantic 的校验发生在哪一刻,并说出 `invoke` 返回的永远是什么类型。

预计用时 2 小时。今天不调模型,花费 ¥0。前置:[Day 301](/blog/agent-zero/day-301-lg-sequence/)(`part05/lg/s02_two_nodes.py` 里的 `REPLIES` 和 `DEFAULT_REPLY`)、[Day 299](/blog/agent-zero/day-299-lg-one-node/)(`part05/lg/s01_tickets.py` 里的 `classify_text` 和 `load_tickets`)、[Day 47](/blog/agent-zero/day-047-type-hints-3/)(`TypedDict`、`NotRequired`)、[Day 50](/blog/agent-zero/day-050-dataclass/)(`dataclass`)、[Day 51](/blog/agent-zero/day-051-pydantic-1/)(pydantic 的 `BaseModel` 和 `ValidationError`)。这三种写法在那几天都学过,今天只看它们放进 LangGraph 以后各有什么表现。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写三种写法里 `State` 的那几行定义和节点里读 `category` 的三种写法;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

所有命令在 `agent-zero-lab/` 根目录跑(我的是 `/Users/你/agent-zero-lab`)。先重置业务库,再确认版本:

```bash
cd /Users/你/agent-zero-lab
uv run python cloudledger/seed.py
uv run python -c "import importlib.metadata as m; print('langgraph', m.version('langgraph'), '| pydantic', m.version('pydantic'))"
```

<div class="line-notes">

- `uv run python cloudledger/seed.py` 删库重建,输出 `已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}`。今天只用工单表。
- `uv run python -c "import importlib.metadata as m;` 用标准库读已安装包的版本号([Day 299](/blog/agent-zero/day-299-lg-one-node/) 同一招)。我 2026 年 10 月 27 日装到的是 `langgraph 1.2.18 | pydantic 2.14.1`(PyPI 上 langgraph 的最新版 1.2.18 是 10 月 26 日发的)。前两天写的是 1.2.16,今天用到的行为和 1.2.16 没有区别,你装到更新的也行。

</div>

## 同一个状态,三种写法

先看一眼三种写法放在一起是什么样。状态里都是三个字段:`ticket` 一开始就有,`category` 由 `classify` 写,`reply` 由 `draft` 写。

```python
# 写法一:TypedDict(前两天一直在用)
class State(TypedDict):
    ticket: str
    category: NotRequired[str]
    reply: NotRequired[str]

# 写法二:dataclass
@dataclass
class State:
    ticket: str
    category: str | None = None
    reply: str | None = None

# 写法三:pydantic
class State(BaseModel):
    ticket: str
    category: str | None = None
    reply: str | None = None
```

<div class="line-notes">

- `class State(TypedDict):` 字典的形状说明。运行时它就是一个普通 `dict`,类型只给编辑器看([Day 47](/blog/agent-zero/day-047-type-hints-3/))。
- `category: NotRequired[str]` 「可以没有这个键」。TypedDict 表达「还没写」的唯一办法就是这个键根本不存在。
- `@dataclass` 自动生成 `__init__` 的类([Day 50](/blog/agent-zero/day-050-dataclass/))。字段**必须**有值,没有值就得给默认值。
- `category: str | None = None` 默认值 `None`,表示「还没写」。这里用 `None` 而不是 `""`,是因为空字符串也可能是一个合法的结果,`None` 才能明确表示没有。
- `class State(BaseModel):` pydantic 的模型([Day 51](/blog/agent-zero/day-051-pydantic-1/))。写法和 dataclass 几乎一样,区别在创建对象时它会校验类型。

</div>

写法上差别很小,真正的差别在三件事:节点里拿到的 `state` 是什么,没写过的字段长什么样,以及传错东西时谁来拦。下面用同一张「分类、起草」图一件一件试。图的结构和 Day 301 一模一样,`classify` 复用 Day 299 的 `classify_text`,`draft` 复用 Day 301 的 `REPLIES`,模板是写死的字符串,不调模型。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="三种状态写法对比:同样的初始输入 ticket,TypedDict 里节点收到字典且没有 category 这个键;dataclass 里节点收到对象且 category 为 None;pydantic 里节点收到对象且 category 为 None,并且在进入节点前校验类型;三种写法 invoke 的返回值都是字典">
<rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink-faint)" font-size="11">初始输入 {"ticket": "发票开错了"} 进入 classify 之前</text>
<rect x="20" y="40" width="190" height="104" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="115" y="62" fill="var(--ink)" text-anchor="middle">TypedDict</text>
<text x="115" y="84" fill="var(--ink-soft)" text-anchor="middle" font-size="11">state 是 dict</text>
<text x="115" y="102" fill="var(--ink-soft)" text-anchor="middle" font-size="11">{"ticket": ...}</text>
<text x="115" y="120" fill="var(--ink-soft)" text-anchor="middle" font-size="11">没有 category 这个键</text>
<text x="115" y="136" fill="var(--ink-faint)" text-anchor="middle" font-size="11">读法 state["ticket"]</text>
<rect x="225" y="40" width="190" height="104" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="62" fill="var(--ink)" text-anchor="middle">dataclass</text>
<text x="320" y="84" fill="var(--ink-soft)" text-anchor="middle" font-size="11">state 是 State 对象</text>
<text x="320" y="102" fill="var(--ink-soft)" text-anchor="middle" font-size="11">ticket='发票开错了'</text>
<text x="320" y="120" fill="var(--ink-soft)" text-anchor="middle" font-size="11">category=None</text>
<text x="320" y="136" fill="var(--ink-faint)" text-anchor="middle" font-size="11">读法 state.ticket</text>
<rect x="430" y="40" width="190" height="104" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="525" y="62" fill="var(--ink)" text-anchor="middle">pydantic</text>
<text x="525" y="84" fill="var(--ink-soft)" text-anchor="middle" font-size="11">state 是 State 对象</text>
<text x="525" y="102" fill="var(--ink-soft)" text-anchor="middle" font-size="11">ticket='发票开错了'</text>
<text x="525" y="120" fill="var(--ink-soft)" text-anchor="middle" font-size="11">category=None</text>
<text x="525" y="136" fill="var(--ink-faint)" text-anchor="middle" font-size="11">进节点前先校验类型</text>
<line x1="115" y1="144" x2="115" y2="176" stroke="var(--ink-soft)"/>
<line x1="320" y1="144" x2="320" y2="176" stroke="var(--ink-soft)"/>
<line x1="525" y1="144" x2="525" y2="176" stroke="var(--ink-soft)"/>
<polygon points="115,182 110,174 120,174" fill="var(--ink-soft)"/>
<polygon points="320,182 315,174 325,174" fill="var(--ink-soft)"/>
<polygon points="525,182 520,174 530,174" fill="var(--ink-soft)"/>
<rect x="20" y="184" width="600" height="44" rx="6" fill="none" stroke="var(--rule)"/>
<text x="320" y="204" fill="var(--ink)" text-anchor="middle">invoke() 的返回值:三种都是 dict</text>
<text x="320" y="220" fill="var(--ink-soft)" text-anchor="middle" font-size="11">{"ticket": ..., "category": "billing", "reply": ...}</text>
<text x="20" y="254" fill="var(--ink-faint)" font-size="11">节点里的 state 类型不同,图跑完拿到的东西一样</text>
</g>
</svg>
<figcaption>三种写法在节点里的样子。唯一不变的是 invoke 的返回值,永远是字典。</figcaption>
</figure>

## 第 1 步:TypedDict,节点收到的是字典

这是前两天的写法,这里把几件事演示完整。`classify` 和 `draft` 开头各打印一次「我收到了什么」,包括它的类型。后面三段脚本节点都这么写,这样三种写法的输出能直接对照。

```python
# agent-zero-lab/part05/lg/s03_typeddict.py
"""TypedDict 写法:节点收到字典。顺带看三件事:收到什么、返回值长什么样、传错类型时在哪里炸。
用法:uv run python -m part05.lg.s03_typeddict"""
from typing import NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph

from part05.lg.s01_tickets import classify_text
from part05.lg.s02_two_nodes import DEFAULT_REPLY, REPLIES


class State(TypedDict):
    ticket: str
    category: NotRequired[str]
    reply: NotRequired[str]


def classify(state: State) -> dict:
    print("  classify 收到:", type(state).__name__, state)
    return {"category": classify_text(state["ticket"])}


def draft(state: State) -> dict:
    print("  draft 收到:", type(state).__name__, state)
    opening = REPLIES.get(state.get("category", "other"), DEFAULT_REPLY)
    return {"reply": f"{opening}(关于:{state['ticket'][:8]}…)"}


builder = StateGraph(State)
builder.add_sequence([classify, draft])
builder.add_edge(START, "classify")
builder.add_edge("draft", END)
graph = builder.compile()

if __name__ == "__main__":
    result = graph.invoke({"ticket": "发票开错了,能重开吗?"})
    print("invoke 返回:", type(result).__name__, result)

    print("--- 传一个数字当工单 ---")
    try:
        graph.invoke({"ticket": 12345})  # pyright: ignore[reportArgumentType]
    except Exception as e:
        print(f"{type(e).__name__}: {e}")

    print("--- 不传 ticket ---")
    try:
        graph.invoke({})  # pyright: ignore[reportArgumentType]
    except Exception as e:
        print(f"{type(e).__name__}: {e}")

    print("--- 初始状态里多塞一个没声明的键 ---")
    print(graph.invoke({"ticket": "登录不了", "extra": 1}))  # pyright: ignore[reportArgumentType]
```

<div class="line-notes">

- `from typing import NotRequired, TypedDict` 两个都是 [Day 47](/blog/agent-zero/day-047-type-hints-3/) 学过的。
- `from part05.lg.s01_tickets import classify_text` Day 299 建的规则分类函数。
- `from part05.lg.s02_two_nodes import DEFAULT_REPLY, REPLIES` Day 301 建的模板字典和兜底句。
- `class State(TypedDict):` `ticket` 必填,另外两个 `NotRequired`。
- `print("  classify 收到:", type(state).__name__, state)` `type(state).__name__` 取类型的名字。实跑输出 `classify 收到: dict {'ticket': '发票开错了,能重开吗?'}`,`state` 就是一个字典,里面只有 `ticket`。
- `return {"category": classify_text(state["ticket"])}` 用方括号读 `ticket`,代入后是 `classify_text("发票开错了,能重开吗?")`,命中规则表里的「发票」,返回 `"billing"`。
- `opening = REPLIES.get(state.get("category", "other"), DEFAULT_REPLY)` 先读 `category`,字典里这时已经有 `'category': 'billing'`;`.get` 的第二个参数是读不到时的兜底。这样写是因为 `category` 标了 `NotRequired`,直接 `state["category"]` 会让编辑器画红线(「不是必填键」)。
- `return {"reply": f"{opening}(关于:{state['ticket'][:8]}…)"}` `state['ticket'][:8]` 取前 8 个字,代入得 `发票开错了,能重`。
- `builder.add_sequence([classify, draft])` 和 Day 301 一样,两个节点自动连起来。
- `graph = builder.compile()` 编译一次。
- `result = graph.invoke({"ticket": "发票开错了,能重开吗?"})` 初始状态是一个字典。
- `print("invoke 返回:", type(result).__name__, result)` 返回值的类型。
- `graph.invoke({"ticket": 12345})  # pyright: ignore[reportArgumentType]` 故意传一个数字。后面的注释是让编辑器别画红线,因为这一行就是要演示「编辑器拦得住,运行时拦不住」。
- `graph.invoke({})  # pyright: ignore[reportArgumentType]` 连必填的 `ticket` 都不传。
- `print(graph.invoke({"ticket": "登录不了", "extra": 1}))` 多塞一个没声明的键 `extra`。

</div>

```bash
uv run python -m part05.lg.s03_typeddict
```

```text
  classify 收到: dict {'ticket': '发票开错了,能重开吗?'}
  draft 收到: dict {'ticket': '发票开错了,能重开吗?', 'category': 'billing'}
invoke 返回: dict {'ticket': '发票开错了,能重开吗?', 'category': 'billing', 'reply': '您好,账单问题已收到,我们会在 1 个工作日内核对并回复您。(关于:发票开错了,能重…)'}
--- 传一个数字当工单 ---
  classify 收到: dict {'ticket': 12345}
TypeError: argument of type 'int' is not iterable
--- 不传 ticket ---
  classify 收到: dict {}
KeyError: 'ticket'
--- 初始状态里多塞一个没声明的键 ---
  classify 收到: dict {'ticket': '登录不了'}
  draft 收到: dict {'ticket': '登录不了', 'category': 'account'}
{'ticket': '登录不了', 'category': 'account', 'reply': '您好,账号登录问题已收到,请先确认注册邮箱,我们马上协助。(关于:登录不了…)'}
```

四件事,一件一件看。

**节点收到的是字典。**`classify 收到: dict {...}`,读字段用方括号,和前两天一样。`draft` 收到的字典里多了 `'category': 'billing'`,是框架把 `classify` 的更新合并进去以后才交给它的。

**没写过的字段,这个键压根不存在。**`classify` 收到的字典里只有 `ticket`,没有 `category`,也没有 `reply`。这就是 Day 301 里要写 `.get("category", "unknown")` 的原因:`state["category"]` 在 `classify` 里读会直接 `KeyError`。

**传错类型,运行时不拦。**我传了 `12345` 当工单,图一点不拦,把这个数字原样交给了 `classify`,一直走到 `classify_text` 里那句 `w in text`,才炸出 `TypeError: argument of type 'int' is not iterable`。报错的位置在节点深处,离「你传错了」很远。这就回答了 Day 299 留的问题:`TypedDict` 只服务编辑器,运行时一个字都不检查。

**必填字段不传,也不拦。**`graph.invoke({})` 不报「缺少 ticket」,图照样启动,`classify` 收到一个空字典 `{}`,等它自己去读 `state["ticket"]` 才 `KeyError: 'ticket'`。最后那个多塞的 `extra` 键也不报错,直接被丢掉,`classify` 收到的字典里没有它。拼错键名的后果在练习 4 里单独演示。

## 第 2 步:dataclass,收到的是对象,没写的字段有默认值

同样的图,状态换成 `dataclass`。节点函数里读字段从 `state["x"]` 换成 `state.x`,其余不变。

```python
# agent-zero-lab/part05/lg/s03_dataclass.py
"""dataclass 写法:节点收到对象,字段可以有默认值。用法:uv run python -m part05.lg.s03_dataclass"""
from dataclasses import dataclass

from langgraph.graph import END, START, StateGraph

from part05.lg.s01_tickets import classify_text
from part05.lg.s02_two_nodes import DEFAULT_REPLY, REPLIES


@dataclass
class State:
    ticket: str
    category: str | None = None
    reply: str | None = None


def classify(state: State) -> dict:
    print("  classify 收到:", type(state).__name__, state)
    return {"category": classify_text(state.ticket)}


def draft(state: State) -> dict:
    print("  draft 收到:", type(state).__name__, state)
    opening = REPLIES.get(state.category or "", DEFAULT_REPLY)
    return {"reply": f"{opening}(关于:{state.ticket[:8]}…)"}


builder = StateGraph(State)
builder.add_sequence([classify, draft])
builder.add_edge(START, "classify")
builder.add_edge("draft", END)
graph = builder.compile()

if __name__ == "__main__":
    result = graph.invoke({"ticket": "发票开错了,能重开吗?"})  # pyright: ignore[reportArgumentType]
    print("invoke 返回:", type(result).__name__, result)

    print("--- 传一个数字当工单 ---")
    try:
        graph.invoke({"ticket": 12345})  # pyright: ignore[reportArgumentType]
    except Exception as e:
        print(f"{type(e).__name__}: {e}")

    print("--- 不传 ticket ---")
    try:
        graph.invoke({})  # pyright: ignore[reportArgumentType]
    except Exception as e:
        print(f"{type(e).__name__}: {e}")

    print("--- 直接传对象进去 ---")
    print(graph.invoke(State(ticket="登录不了")))
```

<div class="line-notes">

- `from dataclasses import dataclass` 标准库,不用装。
- `@dataclass` 给下面的类自动生成 `__init__`、`__repr__`。生成的 `__init__` 的参数就是下面三个字段。
- `ticket: str` 没有默认值,所以是必填:创建对象时不给就报错。
- `category: str | None = None` 有默认值 `None`。初始状态里没给 `category`,框架创建对象时就用这个默认值。
- `print("  classify 收到:", type(state).__name__, state)` 输出 `classify 收到: State State(ticket='发票开错了,能重开吗?', category=None, reply=None)`。类型名是 `State`(我们自己的类),后面是 dataclass 自动生成的好读的打印格式。
- `return {"category": classify_text(state.ticket)}` 用点号读 `ticket`。节点的**返回值仍然是字典**(只写要更新的字段),不是对象。这一点和输入不对称,容易写错。
- `opening = REPLIES.get(state.category or "", DEFAULT_REPLY)` 这时 `state.category` 已经是 `'billing'`。`or ""` 是为了让编辑器放心:`category` 的类型是 `str | None`,`REPLIES.get` 的键不能是 `None`。
- `result = graph.invoke({"ticket": "发票开错了,能重开吗?"})  # pyright: ignore[reportArgumentType]` 传的仍然是字典,运行时没问题。但是编辑器会画红线:dataclass 版的图,`invoke` 的参数类型被标成了 `State`,字典不匹配。忽略注释只是为了让输出干净,红线本身是真实存在的。
- `graph.invoke({"ticket": 12345})  # pyright: ignore[reportArgumentType]` 数字当工单。
- `graph.invoke({})  # pyright: ignore[reportArgumentType]` 不传必填的 `ticket`。
- `print(graph.invoke(State(ticket="登录不了")))` 直接把对象传进去也可以,这样编辑器也不报红线。返回的仍然是字典。

</div>

```bash
uv run python -m part05.lg.s03_dataclass
```

```text
  classify 收到: State State(ticket='发票开错了,能重开吗?', category=None, reply=None)
  draft 收到: State State(ticket='发票开错了,能重开吗?', category='billing', reply=None)
invoke 返回: dict {'ticket': '发票开错了,能重开吗?', 'category': 'billing', 'reply': '您好,账单问题已收到,我们会在 1 个工作日内核对并回复您。(关于:发票开错了,能重…)'}
--- 传一个数字当工单 ---
  classify 收到: State State(ticket=12345, category=None, reply=None)
TypeError: argument of type 'int' is not iterable
--- 不传 ticket ---
TypeError: State.__init__() missing 1 required positional argument: 'ticket'
--- 直接传对象进去 ---
  classify 收到: State State(ticket='登录不了', category=None, reply=None)
  draft 收到: State State(ticket='登录不了', category='account', reply=None)
{'ticket': '登录不了', 'category': 'account', 'reply': '您好,账号登录问题已收到,请先确认注册邮箱,我们马上协助。(关于:登录不了…)'}
```

对比 TypedDict,有三处不同。

**节点收到的是 `State` 对象,没写的字段是默认值。**`classify` 收到的是 `category=None, reply=None`,而不是缺键。所以读 `state.category` 永远不会像 `state["category"]` 那样抛 `KeyError`,没写过就读到 `None`。Day 301 那个「顺序写反,悄悄变差」的问题在这里换了个样子:`draft` 先跑的话读到 `None`,`REPLIES.get("", DEFAULT_REPLY)` 悄悄走兜底,依旧没有报错。想让它炸出来,要自己判断 `if state.category is None: raise ...`。

**必填字段不传,拦得住。**`graph.invoke({})` 报 `TypeError: State.__init__() missing 1 required positional argument: 'ticket'`,而且这次**节点一行都没跑**(输出里没有「classify 收到」),错误出在创建 `State` 对象那一步。这比 TypedDict 的 `KeyError` 早、也直白。

**传错类型,照样不拦。**数字 `12345` 一样跑进了 `classify`,最后在 `classify_text` 里炸出同一个 `TypeError`。`dataclass` 的类型标注和 TypedDict 一样,只给编辑器看。

还有一个细节:`graph.invoke(State(ticket="登录不了"))` 把对象传进去能跑,说明输入可以是字典也可以是对象;但输出两次都是字典。这点三种写法完全一样,第 4 步集中讲。

## 第 3 步:pydantic,进节点前先校验

第三种,`BaseModel`。代码和 dataclass 几乎一样,只改了两处:去掉 `@dataclass`,类继承 `BaseModel`。

```python
# agent-zero-lab/part05/lg/s03_pydantic.py
"""pydantic 写法:状态进入节点时会校验和转换类型。用法:uv run python -m part05.lg.s03_pydantic"""
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel

from part05.lg.s01_tickets import classify_text
from part05.lg.s02_two_nodes import DEFAULT_REPLY, REPLIES


class State(BaseModel):
    ticket: str
    category: str | None = None
    reply: str | None = None


def classify(state: State) -> dict:
    print("  classify 收到:", type(state).__name__, state)
    return {"category": classify_text(state.ticket)}


def draft(state: State) -> dict:
    print("  draft 收到:", type(state).__name__, state)
    opening = REPLIES.get(state.category or "", DEFAULT_REPLY)
    return {"reply": f"{opening}(关于:{state.ticket[:8]}…)"}


builder = StateGraph(State)
builder.add_sequence([classify, draft])
builder.add_edge(START, "classify")
builder.add_edge("draft", END)
graph = builder.compile()

if __name__ == "__main__":
    result = graph.invoke({"ticket": "发票开错了,能重开吗?"})  # pyright: ignore[reportArgumentType]
    print("invoke 返回:", type(result).__name__, result)

    print("--- 传一个数字当工单 ---")
    try:
        graph.invoke({"ticket": 12345})  # pyright: ignore[reportArgumentType]
    except Exception as e:
        print(f"{type(e).__name__}: {e}")

    print("--- 不传 ticket ---")
    try:
        graph.invoke({})  # pyright: ignore[reportArgumentType]
    except Exception as e:
        print(f"{type(e).__name__}: {e}")
```

<div class="line-notes">

- `from pydantic import BaseModel` pydantic 是第三方库,Day 51 装过。
- `class State(BaseModel):` 继承 `BaseModel`,不再需要 `@dataclass`。字段写法完全一样,包括默认值。
- `print("  classify 收到:", type(state).__name__, state)` 输出 `classify 收到: State ticket='发票开错了,能重开吗?' category=None reply=None`。和 dataclass 的差别只是打印格式,pydantic 的 `repr` 没有 `State(...)` 外壳。
- `return {"category": classify_text(state.ticket)}` 读法和 dataclass 一样,用点号;返回值依旧是字典。
- `graph.invoke({"ticket": 12345})  # pyright: ignore[reportArgumentType]` 这次数字会被拦在门口。
- `graph.invoke({})  # pyright: ignore[reportArgumentType]` 缺必填字段,一样被拦。

</div>

```bash
uv run python -m part05.lg.s03_pydantic
```

```text
  classify 收到: State ticket='发票开错了,能重开吗?' category=None reply=None
  draft 收到: State ticket='发票开错了,能重开吗?' category='billing' reply=None
invoke 返回: dict {'ticket': '发票开错了,能重开吗?', 'category': 'billing', 'reply': '您好,账单问题已收到,我们会在 1 个工作日内核对并回复您。(关于:发票开错了,能重…)'}
--- 传一个数字当工单 ---
ValidationError: 1 validation error for State
ticket
  Input should be a valid string [type=string_type, input_value=12345, input_type=int]
    For further information visit https://errors.pydantic.dev/2.14/v/string_type
--- 不传 ticket ---
ValidationError: 1 validation error for State
ticket
  Field required [type=missing, input_value={}, input_type=dict]
    For further information visit https://errors.pydantic.dev/2.14/v/missing
```

和前两种比,最大的变化在中间那段:数字 `12345` 当工单,**节点一行都没跑**(没有「classify 收到」),直接抛 `ValidationError: 1 validation error for State / ticket / Input should be a valid string [type=string_type, input_value=12345, input_type=int]`。信息里写明了哪个字段(`ticket`)、什么问题(应该是字符串)、收到了什么(`12345`,类型 `int`)。同样的错误,TypedDict 和 dataclass 要等到 `classify_text` 里才炸成「argument of type 'int' is not iterable」,你得自己顺着堆栈找到源头;pydantic 在门口就说清了。

缺必填字段那一条也类似:`Field required [type=missing, input_value={}, input_type=dict]`。

代价是慢一点。LangGraph 官方文档里也写了,Pydantic 状态比 TypedDict 和 dataclass 慢;而且文档同一处提到 `create_agent` 不支持 Pydantic 状态(Day 298 学过的那个高层入口)。这点放到下面第 5 步实测。

## 第 4 步:校验发生在哪一刻

pydantic 的校验到底卡在哪里:节点往状态里写的时候,还是下一个节点读状态的时候?这个区别很实际。我写了一个会手滑的节点:它往 `category` 里写 `"bilng"`(少了个 i),而 `category` 的类型是 `Literal` 限定的五个值之一(`Literal` 在 [Day 47](/blog/agent-zero/day-047-type-hints-3/) 学过,≈ TS 的字面量联合类型)。

```python
# agent-zero-lab/part05/lg/s03_pydantic_update.py
"""pydantic 到底在哪一刻校验:节点写进去的时候,还是下一个节点读的时候?
用法:uv run python -m part05.lg.s03_pydantic_update"""
from typing import Literal

from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel

Category = Literal["billing", "subscription", "technical", "account", "other"]


class State(BaseModel):
    ticket: str
    category: Category | None = None


def typo_node(state: State) -> dict:
    print("  typo_node 在跑")
    return {"category": "bilng"}  # 手滑,少了个 i


def reader(state: State) -> dict:
    print("  reader 在跑,收到:", state)
    return {}


def run(nodes: list) -> None:
    b = StateGraph(State)
    b.add_sequence(nodes)
    b.add_edge(START, nodes[0].__name__)
    b.add_edge(nodes[-1].__name__, END)
    try:
        out = b.compile().invoke({"ticket": "发票开错了"})  # pyright: ignore[reportArgumentType]
        print("  返回:", out)
    except Exception as e:
        print(f"  {type(e).__name__}: {str(e).splitlines()[0]} / {str(e).splitlines()[1]} / {str(e).splitlines()[2].strip()}")


print("写错的节点后面还有一个节点:")
run([typo_node, reader])
print("写错的节点就是最后一个:")
run([typo_node])
```

<div class="line-notes">

- `from typing import Literal` 标准库。
- `Category = Literal["billing", "subscription", "technical", "account", "other"]` 给「五选一」起个别名,和 Day 299 规则表的五个类别一致。
- `category: Category | None = None` 写入的值必须是这五个之一,或者还没写过(`None`)。
- `print("  typo_node 在跑")` 看这个节点到底有没有跑完。
- `return {"category": "bilng"}  # 手滑,少了个 i` 返回一个不在五选一里的值。
- `print("  reader 在跑,收到:", state)` 这个节点只负责读,看它能不能收到。
- `b.add_sequence(nodes)` 把传进来的节点串起来。`nodes` 是函数列表,`run` 对「一个节点」和「两个节点」都适用。
- `b.add_edge(START, nodes[0].__name__)` 入口连到第一个节点,节点名取 `__name__`。
- `b.add_edge(nodes[-1].__name__, END)` 出口接在最后一个节点之后。
- `out = b.compile().invoke({"ticket": "发票开错了"})  # pyright: ignore[reportArgumentType]` 一个字典当初始状态,运行时没问题。
- `print(f"  {type(e).__name__}: {str(e).splitlines()[0]}` 把 `ValidationError` 那长长的多行消息压成一行:第一行说哪个模型,第二行是字段名,第三行是原因。
- `run([typo_node, reader])` 手滑的节点后面还有一个节点。
- `run([typo_node])` 手滑的节点就是最后一个。

</div>

```bash
uv run python -m part05.lg.s03_pydantic_update
```

```text
写错的节点后面还有一个节点:
  typo_node 在跑
  ValidationError: 1 validation error for State / category / Input should be 'billing', 'subscription', 'technical', 'account' or 'other' [type=literal_error, input_value='bilng', input_type=str]
写错的节点就是最后一个:
  typo_node 在跑
  返回: {'ticket': '发票开错了', 'category': 'bilng'}
```

看第一组:`typo_node` 跑完了(它打印了「在跑」),**之后**抛了 `ValidationError`,而 `reader` 一行都没跑。所以校验发生在**状态被交给下一个节点之前**:错的值写进去的时候没人管,等有人要读时才被拦下。再看第二组:手滑的节点是最后一个,没有「下一个节点」,图正常结束,返回的 `category` 就是错的 `'bilng'`,**没有任何报错**。

这个细节有两个实际影响。一是 pydantic 不能保证「图的最终输出一定合法」,最后一个节点写进去的东西不检查。二是出错时报错的位置在**下一个节点**,不在写错的那个节点,看堆栈会往错的地方找。我第一次看到 `reader` 没跑却报错时也愣了一下,所以专门写了这个实验。

## 第 5 步:41 张真工单,三种写法结果一致吗

三种写法的图各跑一遍 41 张真工单,逐张对比最终结果,顺便量耗时。节点里的打印用 `contextlib.redirect_stdout` 吞掉,不然 41 乘 3 乘 2 会有 246 行。

```python
# agent-zero-lab/part05/lg/s03_tickets.py
"""三种写法的图各跑 41 张工单,结果必须逐张一致,再量一下各自的耗时。
用法:uv run python -m part05.lg.s03_tickets"""
import io
import time
from contextlib import redirect_stdout

from part05.lg import s03_dataclass, s03_pydantic, s03_typeddict
from part05.lg.s01_tickets import load_tickets

tickets = load_tickets()
graphs = {
    "TypedDict": s03_typeddict.graph,
    "dataclass": s03_dataclass.graph,
    "pydantic": s03_pydantic.graph,
}

results: dict[str, list[dict]] = {}
for name, graph in graphs.items():
    with redirect_stdout(io.StringIO()):  # 节点里的 print 全部吞掉
        start = time.perf_counter()
        results[name] = [graph.invoke({"ticket": text}) for _, text in tickets]
        ms = (time.perf_counter() - start) * 1000
    print(f"{name:<9} 41 张共 {ms:.0f} 毫秒,每张 {ms / 41:.2f} 毫秒")

base = results["TypedDict"]
for name in ("dataclass", "pydantic"):
    print(f"{name} 和 TypedDict 逐张一致:", results[name] == base)
print("返回值类型:", {name: type(r[0]).__name__ for name, r in results.items()})
print("T1001 的结果:", base[0])
```

<div class="line-notes">

- `import io` 标准库,里面的 `io.StringIO()` 是一个「假文件」,写进去的字都存在内存里。
- `from contextlib import redirect_stdout` 临时把 `print` 的去向改成别处。
- `from part05.lg import s03_dataclass, s03_pydantic, s03_typeddict` 把前三段脚本整个导入,用它们各自建好的 `graph`。
- `tickets = load_tickets()` 41 张工单,Day 299 的函数。
- `graphs = {` 三张图放进一个字典,键是名字,后面循环着跑。
- `results: dict[str, list[dict]] = {}` 每种写法 41 个结果,按名字存。
- `with redirect_stdout(io.StringIO()):  # 节点里的 print 全部吞掉` 进了这个 `with`,节点里所有 `print` 都写进假文件;出了 `with` 恢复。
- `start = time.perf_counter()` 计时开始。
- `results[name] = [graph.invoke({"ticket": text}) for _, text in tickets]` 列表推导式,41 次 `invoke`。传的是字典,运行时对三种写法都行。
- `print(f"{name:<9} 41 张共 {ms:.0f} 毫秒,每张 {ms / 41:.2f} 毫秒")` `:<9` 是左对齐占 9 格,让三行对齐。
- `base = results["TypedDict"]` 以 TypedDict 的结果为基准。
- `print(f"{name} 和 TypedDict 逐张一致:", results[name] == base)` 两个「字典的列表」用 `==` 比较,41 个字典每个键每个值都相等才是 `True`。
- `print("返回值类型:", {name: type(r[0]).__name__ for name, r in results.items()})` 看三种写法 `invoke` 返回的第一张是什么类型。
- `print("T1001 的结果:", base[0])` 看一张具体的。

</div>

```bash
uv run python -m part05.lg.s03_tickets
```

```text
TypedDict 41 张共 61 毫秒,每张 1.49 毫秒
dataclass 41 张共 57 毫秒,每张 1.38 毫秒
pydantic  41 张共 58 毫秒,每张 1.42 毫秒
dataclass 和 TypedDict 逐张一致: True
pydantic 和 TypedDict 逐张一致: True
返回值类型: {'TypedDict': 'dict', 'dataclass': 'dict', 'pydantic': 'dict'}
T1001 的结果: {'ticket': '导出报表报错:导出年度报表的时候一直提示 ERR_EXPORT_TIMEOUT,换了浏览器也一样。', 'category': 'technical', 'reply': '您好,已记录您遇到的报错,工程师会排查后回复。(关于:导出报表报错:导…)'}
```

结果:逐张一致,返回值类型三种都是 `dict`。耗时每张都在 1.4 毫秒上下。我跑了三遍,每张在 1.1 到 1.9 毫秒之间,TypedDict 三遍都是最慢的,但它是第一个跑的,分不清是它本身慢还是预热,总之三种的差距在两成以内,在我这台 2019 款 MacBook 上小到可以不管。pydantic 慢是真的,但慢在校验本身,这个例子里每次只校验三个短字段,不值一提。状态里装几百条消息、嵌套很深的时候,才值得留意。

## 怎么选

我的做法,按顺序判断:

先用 `TypedDict`。LangGraph 官方文档把它叫「最主要的文档化写法」,官方示例和多数开源项目也都用它,读别人的代码不用来回切换。节点里全是 `state["x"]`,跟你前端写 `req.body.x` 的手感差不多。它的代价就是前面看到的:没有运行时检查,没写的字段缺键。

需要默认值、想用点号读字段时,换 `dataclass`。「没写的字段读到默认值而不是 KeyError」有时很省事,比如计数器、开关。

状态要从**外部**进来(用户提交的表单、别的服务传来的 JSON),并且你要在入口就拦住脏数据时,用 pydantic。内部只在节点之间流转的数据,没必要付校验的钱,而且前面第 4 步说了,它也不能保证最后一个节点写进去的东西合法。

别在一张图里混用。节点函数里 `isinstance(state, dict)` 判断一下再决定怎么读,看着灵活,日后只会让每个节点都带一段多余的代码。选定一种就一路用下去。

## 零件 → 大代码对照表

| 零件 | 在哪个脚本 | 说明 |
| --- | --- | --- |
| TypedDict 状态:收到字典、缺键、运行时不检查 | `s03_typeddict.py` | 读法 `state["x"]`;`NotRequired` 字段要 `.get` |
| dataclass 状态:收到对象、默认值、必填字段会拦 | `s03_dataclass.py` | 读法 `state.x`;返回值仍是字典 |
| pydantic 状态:进节点前校验 | `s03_pydantic.py` | 数字当工单在门口被拦 |
| 校验发生的时刻 | `s03_pydantic_update.py` | 下一个节点读之前才校验;最后一个节点写错不拦 |
| 三种写法对账 | `s03_tickets.py` | 41 张逐张一致,返回值都是 dict |

## 动手练习

四道题,都在 `part05/lg/` 下新建文件。每题后面是参考答案,先自己做。

### 练习 1:给三种写法各加一个 urgent 字段

给三种状态各加一个 `urgent: bool` 字段(没写之前的初始值是「不紧急」),让第一个节点把它收到的 `state` 里 `urgent` 是什么打印出来。观察:三种写法里「还没写过」分别是什么样?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex302_urgent.py
"""练习 1:给三种写法各加一个 urgent 字段,看第一个节点收到时它是什么样。
用法:uv run python -m part05.lg.ex302_urgent"""
from dataclasses import dataclass
from typing import NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel


class TDState(TypedDict):
    ticket: str
    urgent: NotRequired[bool]


@dataclass
class DCState:
    ticket: str
    urgent: bool = False


class PDState(BaseModel):
    ticket: str
    urgent: bool = False


def peek(state) -> dict:
    if isinstance(state, dict):
        print("  字典里的键:", list(state), "| .get('urgent') =", state.get("urgent"))
        try:
            state["urgent"]
        except KeyError as e:
            print("  state['urgent'] 抛了 KeyError:", e)
    else:
        print("  对象里 urgent =", state.urgent)
    return {}


for schema in (TDState, DCState, PDState):
    print(schema.__name__)
    b = StateGraph(schema)
    b.add_node("peek", peek)
    b.add_edge(START, "peek")
    b.add_edge("peek", END)
    b.compile().invoke({"ticket": "马上处理!"})
```

<div class="line-notes">

- `class TDState(TypedDict):` TypedDict 版。
- `urgent: NotRequired[bool]` 可以没有这个键。
- `@dataclass` dataclass 版。
- `urgent: bool = False` 默认值 `False`,「没写」就是 `False`。
- `class PDState(BaseModel):` pydantic 版,同样默认 `False`。
- `def peek(state) -> dict:` 一个函数服务三种状态,所以参数没标类型。
- `if isinstance(state, dict):` 字典是 TypedDict 版([Day 40](/blog/agent-zero/day-040-classes-1/) 学过的 `isinstance`)。
- `print("  字典里的键:", list(state), "| .get('urgent') =", state.get("urgent"))` 输出键只有 `['ticket']`,`.get('urgent')` 返回 `None`。
- `state["urgent"]` 直接取,键不存在。
- `except KeyError as e:` 接住,打印 `KeyError: 'urgent'`。
- `print("  对象里 urgent =", state.urgent)` 对象版直接读属性,读到 `False`。
- `for schema in (TDState, DCState, PDState):` 对三种状态各建一张只有 `peek` 的图。
- `b.compile().invoke({"ticket": "马上处理!"})` 初始状态只给 `ticket`。

</div>

```text
TDState
  字典里的键: ['ticket'] | .get('urgent') = None
  state['urgent'] 抛了 KeyError: 'urgent'
DCState
  对象里 urgent = False
PDState
  对象里 urgent = False
```

TypedDict 里「没写」是键不存在,`.get` 得到 `None`(不是 `False`),直接取抛 `KeyError`。dataclass 和 pydantic 里「没写」就是默认值 `False`。所以用 TypedDict 时,「不紧急」有两种长相(没有这个键、键的值是 `False`),判断时要写 `state.get("urgent", False)`;另外两种只有一种长相。这是 TypedDict 写法需要多留意的地方。

</details>

### 练习 2:给 TypedDict 版加一个入口检查

TypedDict 版传数字当工单,要到 `classify_text` 里才炸。给它加一个叫 `check_input` 的第一个节点,在入口就拦住:`ticket` 不是字符串或者是空白,就抛 `ValueError`,信息写清收到了什么。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex302_check_input.py
"""练习 2:TypedDict 版没有入口校验,自己加一个 check_input 节点。
用法:uv run python -m part05.lg.ex302_check_input"""
from langgraph.graph import END, START, StateGraph

from part05.lg.s03_typeddict import State, classify, draft


def check_input(state: State) -> dict:
    ticket = state.get("ticket")
    if not isinstance(ticket, str) or not ticket.strip():
        raise ValueError(f"ticket 必须是非空字符串,收到 {ticket!r}")
    return {}


builder = StateGraph(State)
builder.add_sequence([check_input, classify, draft])
builder.add_edge(START, "check_input")
builder.add_edge("draft", END)
graph = builder.compile()

for bad in (12345, "   ", None):
    try:
        graph.invoke({"ticket": bad})  # pyright: ignore[reportArgumentType]
    except ValueError as e:
        print(f"ticket={bad!r:<8} -> ValueError: {e}")
```

<div class="line-notes">

- `from part05.lg.s03_typeddict import State, classify, draft` 复用第 1 步的状态和两个节点,一个字不改。
- `def check_input(state: State) -> dict:` 一个只检查、不写任何东西的节点。
- `ticket = state.get("ticket")` 用 `.get`,这样 `ticket` 压根没传时也不会先炸成 `KeyError`。
- `if not isinstance(ticket, str) or not ticket.strip():` 不是字符串,或者去掉两端空白后是空的,都不合格。`or` 左边为真就不再算右边,所以非字符串不会走到 `.strip()`。
- `raise ValueError(f"ticket 必须是非空字符串,收到 {ticket!r}")` `!r` 是用 `repr` 的格式显示,字符串带引号、`None` 显示成 `None`,比直接显示更容易看出收到了什么。
- `return {}` 通过检查什么也不更新。
- `builder.add_sequence([check_input, classify, draft])` 三个节点串起来,入口检查排第一。
- `builder.add_edge(START, "check_input")` 入口连到新的第一个节点。
- `for bad in (12345, "   ", None):` 三种坏输入:数字、纯空白、`None`。
- `graph.invoke({"ticket": bad})  # pyright: ignore[reportArgumentType]` 故意传错的,让编辑器闭嘴。
- `print(f"ticket={bad!r:<8} -> ValueError: {e}")` `:<8` 左对齐占 8 格,三行好对齐。

</div>

```text
ticket=12345    -> ValueError: ticket 必须是非空字符串,收到 12345
ticket='   '    -> ValueError: ticket 必须是非空字符串,收到 '   '
ticket=None     -> ValueError: ticket 必须是非空字符串,收到 None
```

三种坏输入都在 `check_input` 里被拦下,信息直接说明收到了什么,比 `argument of type 'int' is not iterable` 好查得多。这就是 pydantic 替你做的事,手写版要自己写出来,也只检查你想到的那几项。

</details>

### 练习 3:把 invoke 的字典变回对象

`invoke` 返回的永远是字典。请把 dataclass 版和 pydantic 版的结果各自变回 `State` 对象,取出 `category`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex302_back_to_object.py
"""练习 3:invoke 返回的永远是字典,把它变回对象。
用法:uv run python -m part05.lg.ex302_back_to_object"""
from part05.lg import s03_dataclass, s03_pydantic

text = "发票开错了,能重开吗?"

dc_result = s03_dataclass.graph.invoke(s03_dataclass.State(ticket=text))
dc = s03_dataclass.State(**dc_result)
print("dataclass:", type(dc).__name__, dc.category)

pd_result = s03_pydantic.graph.invoke(s03_pydantic.State(ticket=text))
pd = s03_pydantic.State.model_validate(pd_result)
print("pydantic :", type(pd).__name__, pd.category)
```

<div class="line-notes">

- `from part05.lg import s03_dataclass, s03_pydantic` 导入两个模块,用它们的 `graph` 和 `State`。
- `text = "发票开错了,能重开吗?"` 工单文本。
- `s03_dataclass.graph.invoke(s03_dataclass.State(ticket=text))` 这次直接传对象进去,编辑器没有红线。
- `dc = s03_dataclass.State(**dc_result)` `**` 把字典展开成关键字参数,等于 `State(ticket=..., category=..., reply=...)`,字典的键正好是字段名。
- `print("dataclass:", type(dc).__name__, dc.category)` 输出类型 `State` 和类别 `billing`。
- `pd = s03_pydantic.State.model_validate(pd_result)` pydantic 自带的「字典变对象」方法([Day 52](/blog/agent-zero/day-052-pydantic-2/)),变的同时重新校验一遍。
- `print("pydantic :", type(pd).__name__, pd.category)` 同样取出 `billing`。

</div>

```text
  classify 收到: State State(ticket='发票开错了,能重开吗?', category=None, reply=None)
  draft 收到: State State(ticket='发票开错了,能重开吗?', category='billing', reply=None)
dataclass: State billing
  classify 收到: State ticket='发票开错了,能重开吗?' category=None reply=None
  draft 收到: State ticket='发票开错了,能重开吗?' category='billing' reply=None
pydantic : State billing
```

两种写法都能变回对象。前面那四行「收到」的打印是节点里的,不是这两句。dataclass 用 `State(**字典)`,pydantic 用 `State.model_validate(字典)`,后者会再校验一遍,所以字典里一旦有坏值,这一步也会抛 `ValidationError`。

</details>

### 练习 4:揪出悄悄丢掉的键

初始状态里键名拼错(比如 `"tikcet"`),`TypedDict` 版会怎样?写一个 `check_keys(init)` 在调用前检查,键不在 State 里就抛 `KeyError`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lg/ex302_extra_keys.py
"""练习 4:初始状态里多了没声明的键会被悄悄丢掉,写个函数在调用前把它揪出来。
用法:uv run python -m part05.lg.ex302_extra_keys"""
from typing import get_type_hints

from part05.lg.s03_typeddict import State, graph


def check_keys(init: dict) -> None:
    unknown = set(init) - set(get_type_hints(State))
    if unknown:
        raise KeyError(f"状态里没有这些字段:{sorted(unknown)}")


good = {"ticket": "登录不了"}
typo = {"tikcet": "登录不了"}  # 手滑拼错了键名

check_keys(good)
print("good 通过")
try:
    check_keys(typo)
except KeyError as e:
    print("typo 被拦下:", e)

print("不检查直接跑 typo:")
try:
    graph.invoke(typo)  # pyright: ignore[reportArgumentType]
except Exception as e:
    print(f"  {type(e).__name__}: {e}")
```

<div class="line-notes">

- `from typing import get_type_hints` 标准库函数,取一个类的所有字段和类型,返回字典,键是字段名。
- `from part05.lg.s03_typeddict import State, graph` 用第 1 步的 TypedDict 状态和图。
- `unknown = set(init) - set(get_type_hints(State))` `set(init)` 是传入的键,`set(get_type_hints(State))` 是 State 声明的键,集合相减得到「多出来的」。
- `if unknown:` 集合非空就是有多余的键。
- `raise KeyError(f"状态里没有这些字段:{sorted(unknown)}")` 排序后列出来,信息稳定。
- `good = {"ticket": "登录不了"}` 正常的初始状态。
- `typo = {"tikcet": "登录不了"}  # 手滑拼错了键名` `ticket` 写成了 `tikcet`。
- `check_keys(good)` 通过,什么也不输出,下一行才打印。
- `check_keys(typo)` 抛 `KeyError`,被 `except` 接住,打印被拦下的信息。
- `graph.invoke(typo)  # pyright: ignore[reportArgumentType]` 不检查直接跑。

</div>

```text
good 通过
typo 被拦下: "状态里没有这些字段:['tikcet']"
不检查直接跑 typo:
  classify 收到: dict {}
  KeyError: 'ticket'
```

拼错的键 `tikcet` 不是 State 的字段,框架悄悄把它丢掉,`classify` 收到的字典是空的 `{}`,最后在 `state["ticket"]` 上炸出 `KeyError: 'ticket'`。报错说「缺 ticket」,而你明明传了,只是拼错了,很容易盯着错的地方找半天。`check_keys` 把真正的原因直接说出来。用 pydantic 或 dataclass 时这种情况不会让你迷惑:dataclass 会报 `missing 1 required positional argument`,pydantic 会报 `Field required`,也都不会指出拼写,但至少说明是入口的问题。

</details>

**验收标准:** 四个练习的脚本都能跑通,输出和参考答案一致;不看文章能默写出三种写法的 `State` 定义,以及三种写法里读 `category` 的写法;能口头回答「为什么 pydantic 版传数字时节点一行没跑」「为什么 dataclass 版没写的字段不会 KeyError」「为什么 invoke 返回的不是 State 对象」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| State schema(状态模式) | 给图的状态定的形状:有哪些字段、各什么类型。`StateGraph(State)` 里的 `State`。可以是 TypedDict、dataclass、pydantic 模型 |
| 必填字段 | 创建时一定要给值的字段。dataclass 里没有默认值的字段、pydantic 里没写 `= 默认值` 的字段 |
| 默认值 | 字段没给值时自动用的值,比如 `category: str \| None = None` 里的 `None` |
| 校验(validation) | 检查值的类型和范围合不合格。pydantic 在创建对象时做,TypedDict 和 dataclass 不做 |
| 强制转换(coercion) | pydantic 在不丢信息时自动转类型,比如把字符串 `"10"` 转成数字 10.0 |
| `ValidationError` | pydantic 校验不过时抛的异常,信息里有字段名、原因、收到的值 |
| `isinstance(x, 类型)` | 判断 `x` 是不是某种类型,返回 `True` 或 `False`,≈ JS 的 `instanceof`(Day 40) |
| `**字典` 展开 | 把字典展开成关键字参数,`State(**d)` 等于 `State(键1=值1, 键2=值2)` |
| `repr` / `!r` | 对象的「开发者看的」字符串形式,字符串会带引号。f-string 里写 `{x!r}` |
| `redirect_stdout` | `contextlib` 里的工具,在一个 `with` 里临时把 `print` 的输出改到别处 |
| 入口检查 | 在图的最前面放一个只检查输入的节点,不合格就抛错,别让坏数据流进后面的节点 |

## 常见误区

**用点号读 TypedDict,或者用方括号读 dataclass。**`state.ticket` 在 TypedDict 版里抛 `AttributeError: 'dict' object has no attribute 'ticket'`,`state["ticket"]` 在 dataclass 版里抛 `TypeError: 'State' object is not subscriptable`。这两个报错我都亲手撞过(换写法时忘了改节点里的读法)。换一种状态写法,节点里每一处读取都要跟着换。

**以为 TypedDict 或 dataclass 的类型标注会在运行时拦住错误。**两者都只服务编辑器。传数字当工单,都是走到 `classify_text` 里才炸成一个和「传错了」毫无关系的 `TypeError`。需要运行时拦,用 pydantic,或者像练习 2 那样自己写入口检查。

**以为 pydantic 能保证图的最终输出合法。**它在状态交给下一个节点之前校验,最后一个节点写进去的错值不会被拦,第 4 步实测:`category` 是 `'bilng'` 照样返回,零报错。

**以为 `invoke` 返回的是 State 对象。**三种写法返回的都是字典。要对象就自己转(练习 3)。

**节点返回对象而不是字典。**dataclass 和 pydantic 的状态,节点**读**到的是对象,**返回**的仍然是「要更新的字段」组成的字典。输入输出不对称,是最容易写顺手写错的地方。

**在 TypedDict 的「没写」上判断 `is None`。**键根本不存在,`state.get("urgent")` 是 `None`,而键存在、值是 `False` 时是 `False`。用 `NotRequired` 就要想清楚这两种长相。

**一个函数里 `isinstance(state, dict)` 兼容两种写法。**今天的练习 1 为了一个函数演示三种写法这么写了,真项目里别这样,选一种。

**pydantic 错误信息里的堆栈很长,盯着最后一行看。**`ValidationError` 第一行 `1 validation error for State` 告诉你是哪个模型,第二行是字段名,第三行是原因,别的是链接和细节。

## 学习资料

### 文档与文章

- [LangGraph 文档 · Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api):讲状态模式(TypedDict、dataclass、Pydantic)的那一节,今天的选择建议和官方说法对得上。读 State 那一节,15 分钟。
- [LangGraph 文档 · Use the graph API](https://docs.langchain.com/oss/python/langgraph/use-graph-api):同样的内容,以「怎么做」的写法讲,有每种状态写法的完整可跑例子。
- [Python 文档 · dataclasses](https://docs.python.org/3/library/dataclasses.html):`@dataclass` 的参数和默认值规则。Day 50 的官方版。
- [Pydantic 文档 · Models](https://docs.pydantic.dev/latest/concepts/models/):`BaseModel`、校验、`model_validate`。第 3 步和练习 3 用到的都在这一页。
- [Python 文档 · typing 的 TypedDict](https://docs.python.org/3/library/typing.html):`TypedDict` 和 `NotRequired` 的权威说明,搜页面里的 `class typing.TypedDict`。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1z3NY66EY1&autoplay=0&high_quality=1" title="尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>尚硅谷 · 尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战 · 全套约 21 小时,播放 76 万(2026 年 10 月查)。我没有逐集看。按旧课笔记里的对应关系,讲 State 三种写法的在第 14–15 集前后,这个对应来自我之前的整理,没有重新核对,按标题找「State」「TypedDict」「Pydantic」几集即可。</figcaption>
</figure>

- 吴恩达&LangChain《用LangGraph搭建智能体》(BV1bi421v7oD,约 92 分钟,字幕搬运):录于 2024 年,API 有些旧,看状态在节点之间是怎么流的。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/XSkBFFOtQro" title="TypedDict In Python Is Actually AWESOME!" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Indently · "TypedDict" In Python Is Actually AWESOME! · 英文,开字幕。我只核对了标题和频道,没有逐段看完。讲 TypedDict 到底是什么、和普通字典差在哪,正好补第 1 步「运行时一个字都不检查」的背景。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/4mrocPl2AU0" title="Complete Pydantic Course for Beginners | Learn Data Validation in Python" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Yash Jain · Complete Pydantic Course for Beginners · 英文,标题写的是入门全课。我只核对了标题和频道,没有看完,时长未核实,看前几段「怎么定义模型、怎么看校验报错」就够今天用。</figcaption>
</figure>

### 书籍

- Mayo Oshin、Nuno Campos,《Learning LangChain: Building AI and LLM Applications with LangChain and LangGraph》,O'Reilly,2025。讲 LangGraph 状态的章节可以对照今天的内容。出版时 1.0 还没发布,API 要对照着看。我没有核实有无中文版。

### 开源项目与代码

- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):想知道状态模式是怎么被识别的,可以搜 `StateGraph.__init__` 和 `_add_schema`,看它怎么读 TypedDict 的类型标注。
- [pydantic/pydantic](https://github.com/pydantic/pydantic):校验的实现在 `pydantic-core`(Rust 写的),想看校验为什么快可以从它的 README 开始。

## 自测

1. 同一个状态用 TypedDict、dataclass、pydantic 写,节点里的 `state` 分别是什么?读 `ticket` 怎么写?

<details><summary>答案</summary>

TypedDict 里 `state` 是 `dict`,读法 `state["ticket"]`。dataclass 和 pydantic 里 `state` 是 `State` 对象,读法 `state.ticket`。三种写法节点的返回值都是字典(只写要更新的字段),不是对象。

</details>

2. `classify` 还没写过 `category` 时,第一个节点收到的状态里,三种写法的 `category` 分别是什么样?

<details><summary>答案</summary>

TypedDict:键不存在(`list(state)` 只有 `['ticket']`),`state["category"]` 抛 `KeyError`,`state.get("category")` 得 `None`。dataclass 和 pydantic:字段存在,值是默认值(这里是 `None`),读取不会报错。所以 Day 301 里那个「读到缺失值悄悄走兜底」的问题,在对象写法里会变成读到 `None`,同样不会报错,想让顺序错误炸出来要自己判断。

</details>

3. 把数字 `12345` 当工单传进去,三种写法各在哪里、抛什么错?

<details><summary>答案</summary>

TypedDict 和 dataclass:图不拦,数字被原样交给 `classify`,走到 `classify_text` 里的 `w in text` 才抛 `TypeError: argument of type 'int' is not iterable`。pydantic:在进入第一个节点之前就抛 `ValidationError: 1 validation error for State / ticket / Input should be a valid string`,节点一行都没跑。

</details>

4. pydantic 的校验发生在什么时候?一个节点往 `category` 里写了非法值,会被马上拦下吗?

<details><summary>答案</summary>

不会马上拦。实测(第 4 步):写非法值的节点正常跑完,**下一个节点读状态之前**才抛 `ValidationError`,下一个节点一行都没跑;如果写非法值的是最后一个节点,图正常结束,非法值照样出现在返回结果里,零报错。所以 pydantic 不能保证最终输出合法,报错的位置也在下一个节点而不是写错的那个。

</details>

5. 面试题:你们的 Agent 图接收的初始状态来自前端提交的 JSON,你会用哪种状态写法?为什么?只用它够吗?

<details><summary>答案</summary>

入口数据来自外部、不可信,我会让**入口**用 pydantic 状态(或者在图外先用 pydantic 把 JSON 校验一遍再交给图),这样类型不对、必填字段缺失在门口就报清楚的 `ValidationError`,不会在某个节点深处炸出一个莫名其妙的 `TypeError`。但只用它不够:一是它只在状态交给下一个节点前校验,最后一个节点写错的值不拦;二是校验只管类型和范围,管不了业务规则(比如 ticket 不能全是空白、客户编号必须存在),这些要自己写入口检查或用 `Field` 约束。内部节点之间流转的数据,我会用更轻的 TypedDict,别为每一步都付校验的开销。

</details>

6. `graph.invoke(...)` 返回的是 `State` 对象还是字典?想要对象怎么办?

<details><summary>答案</summary>

三种写法返回的都是字典。要对象就自己转:dataclass 用 `State(**字典)`,pydantic 用 `State.model_validate(字典)`。

</details>

## 明天预告

Day 303 · LangGraph(四):不加 reducer 会被覆盖。今天的节点都只写各自不同的字段(`category`、`reply`),没有两个节点写同一个字段。明天让两个节点往同一个 `notes` 列表里写一条记录,看最后剩几条:答案是一条。没配合并规则的字段,谁最后写谁说了算,前面的会被悄悄盖掉,而且不报错。明天把这个坑踩一遍,再看手动把旧值拼上去的办法,以及它什么时候会失效。
