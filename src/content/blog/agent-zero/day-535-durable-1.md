---
title: 'Day 535 · 持久化执行(一):记日志,然后重放'
description: '一个跑到一半的 Agent 任务,进程被杀掉以后怎么接着跑,而不是从头再来?今天从前端熟悉的 Redux reducer 讲起,先理解事件溯源:状态是事件一条条折叠出来的;再把同样的想法用到 Agent 的每一步上,写一个把每步结果记进日志、重启后按日志重放的最小运行器,最后用真的 kill -9 验证它。'
pubDate: 2026-10-22
regime: none
tags: ['durable-execution', 'event-sourcing', 'sqlite', 'python', 'agent-zero']
series: 'agent-zero'
day: 535
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 534](/blog/agent-zero/day-534-memory-build/) 给 SupportPilot 写了客户记忆:用 SQLite 存事实,旧值不删、只标记被替代,来源低的不能覆盖来源高的,当前问题 30 天后过期,还用一批标注过的对话测了写入质量。记忆管的是**跨会话**的事:这周的对话能用上上周的信息。

今天换一个方向,管**一次任务之内**的事。SupportPilot 处理一张退款工单,要调模型做计划、查发票、等主管审批、调支付接口、写回复,前后可能要几个小时。这几个小时里,发版重启、容器被回收、机器断电都是正常现象。进程一挂,内存里的进度全没了。今天要解决的就是:挂了以后,怎么从挂掉的地方接着跑。

## 今天要解决的问题

学完今天你应该能做到:

1. 用自己的话讲清楚**事件溯源**:状态不直接存,而是存发生过的事件,需要时从头折叠出来;并能把它和 Redux 的 reducer 对应起来。
2. 讲清楚**持久化执行**的核心机制「记日志,然后重放」:每做完一步就把结果写进持久化的日志,重启后已经做过的步骤直接从日志取结果,只有没做过的才真正执行。
3. 写一个 40 行左右的运行器 `DurableRun`,用 SQLite 存日志,用真的 `kill -9` 杀掉进程后能接着跑,而且重放的步骤不再花模型的钱。

预计用时 2.5 小时。前置:[Day 469](/blog/agent-zero/day-469-ui-stream/)(一次运行就是一个 reducer)、[Day 93](/blog/agent-zero/day-093-python-sqlite-2/)(SQLite 的事务和 commit)、[Day 318](/blog/agent-zero/day-318-lg-sqlite-saver/)(LangGraph 用 SqliteSaver 在进程重启后续跑)、[Day 390](/blog/agent-zero/day-390-idempotency/)(至少执行一次和幂等)。

今天只讲两个新概念:**事件溯源**和**重放**。Agent 给重放带来的两个麻烦(模型输出不确定、副作用可能做两次)是明天 Day 536 的内容,今天会碰到它们的影子,但先不解决。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分(`DurableRun.step` 和 `Journal.put`);做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先看问题:挂了就从头再来

先写一个三步的小流程,感受一下没有任何保护时会发生什么。为了不花钱,模型先用一个假函数代替,它每被调一次就在计数器上加一。在 `agent-zero-lab/` 下新建 `part10/durable_step0_naive.py`:

```python
# agent-zero-lab/part10/durable_step0_naive.py
CALLS = {"llm": 0}


def fake_llm(prompt: str) -> str:
    CALLS["llm"] += 1
    return {"plan": "先查发票,再写回复", "reply": "您 9 月有两笔 468 元扣款,我们核实后处理"}[prompt]


def list_invoices(customer_id: str) -> list[dict]:
    return [{"id": "INV-2290", "amount": 468}, {"id": "INV-2291", "amount": 468}]


def workflow(crash: bool) -> str:
    plan = fake_llm("plan")
    print("  第 1 步 调模型:", plan)
    invoices = list_invoices("C007")
    print("  第 2 步 查发票:", len(invoices), "张")
    if crash:
        raise SystemExit("  进程在第 2 步之后挂了")
    reply = fake_llm("reply")
    print("  第 3 步 调模型:", reply)
    return reply


print("第一次运行")
try:
    workflow(crash=True)
except SystemExit as e:
    print(e)
print("重启,从头再跑")
workflow(crash=False)
print("模型一共被调了", CALLS["llm"], "次,真正需要的是 2 次")
```

<div class="line-notes">

- `CALLS = {"llm": 0}` 计数器。用 dict 而不是一个整数变量,是因为函数里改 dict 的内容不需要 `global` 声明(改整数要,Day 30 讲作用域时提过)。
- `"reply": "您 9 月有两笔 468 元扣款,我们核实后处理"}[prompt]` 假模型:按提示词查表返回固定的话。建一个 dict 马上用 `[prompt]` 取值,相当于 JS 的 `({plan: "...", reply: "..."})[prompt]`。
- `def list_invoices(customer_id: str) -> list[dict]:` 假的查发票工具,总是返回 C007 的两张 468 元发票。
- `if crash:` 用一个参数控制要不要在第 2 步之后「挂掉」。
- `raise SystemExit("  进程在第 2 步之后挂了")` `SystemExit` 是 Python 用来表示「程序要退出」的异常,`sys.exit()` 内部抛的就是它。这里用它模拟进程挂掉,但能被下面的 `except` 接住,方便在同一个脚本里演示「重启」。
- `except SystemExit as e:` 接住以后打印出原因。真实的进程崩溃是接不住的,后面会用 `kill -9` 来一次真的。
- `workflow(crash=False)` 「重启」以后,没有任何记录,只能从第 1 步开始。

</div>

```bash
cd agent-zero-lab
uv run python part10/durable_step0_naive.py
```

```text
第一次运行
  第 1 步 调模型: 先查发票,再写回复
  第 2 步 查发票: 2 张
  进程在第 2 步之后挂了
重启,从头再跑
  第 1 步 调模型: 先查发票,再写回复
  第 2 步 查发票: 2 张
  第 3 步 调模型: 您 9 月有两笔 468 元扣款,我们核实后处理
模型一共被调了 3 次,真正需要的是 2 次
```

三步的流程多调一次模型,看起来不算什么。换成真实的 Agent:一次任务调二三十次模型,每次输入几千个 token,跑到第 25 步挂了,重来一遍就是二十多次白花的钱,还有白等的时间。更麻烦的是那些「做过了就收不回来」的步骤:第 2 步要是「调支付接口退款」,从头再跑一遍,客户会收到两笔退款。这个问题明天专门讲,今天先把「从挂掉的地方接着跑」这件事做出来。

要做到这一点,得先换一种看待「状态」的方式。

## 事件溯源:状态是事件折叠出来的

### 从 Redux 说起

你写 React 时大概用过 Redux,或者 `useReducer`。它的核心是一个 reducer 函数:`(旧状态, action) => 新状态`。你不直接改状态,而是 `dispatch` 一个 action,reducer 算出新状态。Redux DevTools 能做「时间旅行」,往回拖到任意一个 action,页面就变回那时候的样子,靠的是它记下了**所有的 action**,想看哪个时刻,就把从开头到那个时刻的 action 依次交给 reducer 重算一遍。[Day 469](/blog/agent-zero/day-469-ui-stream/) 讲 SupportPilot 界面时说「一次运行就是一个 reducer」,也是这个意思。

后端有一个同样思路的设计模式,叫**事件溯源**(event sourcing):系统不直接保存「当前状态」,而是把发生过的每一件事(事件)按顺序追加记下来,只增不改。当前状态是从第一个事件开始,一个一个 apply 出来的结果。Martin Fowler 2005 年写过一篇很有名的文章讲它,银行账户是最经典的例子:你的余额不是一个存在那儿的数字,而是所有存款和取款记录加起来的结果。

### 二十几行看清它

拿一张工单来试。工单从打开到关闭,发生过五件事。新建 `part10/event_sourcing.py`:

```python
# agent-zero-lab/part10/event_sourcing.py
events = [  # 一张工单从开到关发生过的事,只追加,不修改
    {"type": "opened", "by": "C007", "title": "9 月重复扣款"},
    {"type": "assigned", "to": "agent-01"},
    {"type": "refund_requested", "amount": 468},
    {"type": "refund_paid", "refund_id": "RF-1"},
    {"type": "closed"},
]


def apply(state: dict, e: dict) -> dict:  # 相当于 Redux 的 reducer:旧状态 + 一个事件 -> 新状态
    t = e["type"]
    if t == "opened":
        return {"status": "open", "title": e["title"], "owner": None, "pending": 0, "refunded": 0}
    if t == "assigned":
        return {**state, "owner": e["to"]}
    if t == "refund_requested":
        return {**state, "status": "waiting_refund", "pending": e["amount"]}
    if t == "refund_paid":
        return {**state, "status": "refunded", "refunded": state["refunded"] + state["pending"], "pending": 0}
    if t == "closed":
        return {**state, "status": "closed"}
    return state


def rebuild(upto: int) -> dict:
    state: dict = {}
    for e in events[:upto]:
        state = apply(state, e)
    return state


if __name__ == "__main__":
    print("现在:", rebuild(len(events)))
    print("第 3 个事件之后:", rebuild(3))
```

<div class="line-notes">

- `events = [  # 一张工单从开到关发生过的事,只追加,不修改` 事件列表就是这张工单的全部「真相」。每个事件是一个 dict,`type` 说明发生了什么,其余字段是细节,和 Redux action 的 `{ type, payload }` 长得几乎一样。
- `{"type": "refund_paid", "refund_id": "RF-1"},` 事件用过去时命名(opened、paid、closed),表示「已经发生了的事」,不是「要去做的事」。这个习惯能帮你分清事件和命令。
- `def apply(state: dict, e: dict) -> dict:` reducer:拿旧状态和一个事件,返回新状态。它是纯函数,不读外部数据、不改传进来的 state。
- `return {"status": "open", "title": e["title"], "owner": None, "pending": 0, "refunded": 0}` 第一个事件创建出初始状态。
- `return {**state, "owner": e["to"]}` `{**state, ...}` 是 dict 的展开,和 JS 的 `{...state, owner: e.to}` 完全一样:复制一份旧状态,覆盖其中一个字段。不在原 dict 上改,所以旧状态还在。
- `return {**state, "status": "waiting_refund", "pending": e["amount"]}` 申请退款时把金额记进 `pending`(待退)。
- `"refunded": state["refunded"] + state["pending"], "pending": 0}` 退款到账:待退的钱转成已退。
- `return state` 不认识的事件类型,状态不变。Redux 的 reducer 最后也是 `default: return state`。
- `def rebuild(upto: int) -> dict:` 从空状态开始,把前 `upto` 个事件依次 apply 一遍。这就是「折叠」(fold),JS 里写成 `events.slice(0, upto).reduce(apply, {})`。
- `print("第 3 个事件之后:", rebuild(3))` 想知道某个时刻的状态,就只折叠到那个时刻。这就是 Redux DevTools 时间旅行的原理。

</div>

```bash
uv run python part10/event_sourcing.py
```

```text
现在: {'status': 'closed', 'title': '9 月重复扣款', 'owner': 'agent-01', 'pending': 0, 'refunded': 468}
第 3 个事件之后: {'status': 'waiting_refund', 'title': '9 月重复扣款', 'owner': 'agent-01', 'pending': 468, 'refunded': 0}
```

现在的状态和三步之前的状态,都是从同一份事件列表里折叠出来的。事件溯源换来三样东西:**审计**(工单是怎么走到今天的,每一步都在);**时间旅行**(任何一个历史时刻都能重建);**换个算法重算**(哪天想加一个「重开次数」字段,改 reducer 再折叠一遍就有了,练习 1 会做)。代价是读状态要多算一步,事件很多时要定期存一个「快照」,从快照往后折叠。

Day 534 的记忆系统其实已经用了一半这个思路:旧值不删、只标记被替代,历史全在。只是我们还存了「当前值」这一列方便查。

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="事件溯源:五个事件按顺序排成一条线,reducer 依次折叠,可以在任意位置停下得到那一刻的状态">
  <rect x="0" y="0" width="640" height="200" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11" text-anchor="middle">
    <rect x="20" y="30" width="100" height="32" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="70" y="50" fill="var(--ink)">opened</text>
    <rect x="140" y="30" width="100" height="32" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="190" y="50" fill="var(--ink)">assigned</text>
    <rect x="260" y="30" width="120" height="32" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="320" y="50" fill="var(--ink)">refund_requested</text>
    <rect x="400" y="30" width="100" height="32" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="450" y="50" fill="var(--ink)">refund_paid</text>
    <rect x="520" y="30" width="100" height="32" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="570" y="50" fill="var(--ink)">closed</text>
    <text x="320" y="20" fill="var(--ink-faint)" font-size="10">事件日志:只追加,不修改</text>
    <rect x="200" y="120" width="240" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="320" y="141" fill="var(--ink)">state = apply(state, e)</text>
    <line x1="320" y1="62" x2="320" y2="120" stroke="var(--ink-faint)"/>
    <line x1="380" y1="80" x2="380" y2="62" stroke="var(--mem)" stroke-dasharray="3 3"/>
    <text x="440" y="96" fill="var(--mem)">rebuild(3) 停在这里</text>
    <text x="320" y="182" fill="var(--ink-faint)" font-size="10">当前状态 = 从第一个事件折叠到最后一个;历史状态 = 折叠到中间某一个</text>
  </g>
</svg>
<figcaption>事件溯源的样子。琥珀色是存下来的事件,蓝色是 reducer。状态从来不单独存,需要时现算。</figcaption>
</figure>

## 把同样的想法用到 Agent 上

回到开头那个三步流程。把「每一步做完的结果」当成事件记下来会怎样?Agent 一次运行的事件就是:「第 1 步调了模型,得到计划 X」「第 2 步查了发票,得到两张发票」……这份记录有一个专门的名字,叫**执行日志**(journal),Temporal 里叫事件历史(event history)。

### 第一步:只管记

先只做「记」这一半:每一步的结果追加成文件里的一行。格式用 **JSON Lines**:每行一个独立的 JSON 对象,行与行之间用换行分隔。它比一整个 JSON 数组更适合日志,因为追加一条只要往文件末尾写一行,不用把整个文件读出来、改、再写回去。新建 `part10/durable_step1_log.py`:

```python
# agent-zero-lab/part10/durable_step1_log.py
import json
from pathlib import Path

LOG = Path("part10/run-1.jsonl")


def record(seq: int, name: str, result) -> None:
    with LOG.open("a", encoding="utf-8") as f:  # "a" 是追加模式,只往文件末尾写
        f.write(json.dumps({"seq": seq, "name": name, "result": result}, ensure_ascii=False) + "\n")


LOG.unlink(missing_ok=True)
record(1, "llm", "先查发票,再写回复")
record(2, "tool.list_invoices", [{"id": "INV-2290", "amount": 468}, {"id": "INV-2291", "amount": 468}])
print(LOG.read_text(encoding="utf-8"))
```

<div class="line-notes">

- `LOG = Path("part10/run-1.jsonl")` 一次运行一个日志文件,文件名带上运行的 id。路径是相对于当前目录的,所以要在 `agent-zero-lab/` 下运行(Day 37 的 pathlib)。
- `def record(seq: int, name: str, result) -> None:` 三样东西:第几步(seq)、这一步叫什么(name)、结果(result)。`result` 没写类型,因为它可能是字符串、列表、dict,只要能转成 JSON 就行。
- `with LOG.open("a", encoding="utf-8") as f:` `"a"` 是 append,文件不存在就新建,存在就从末尾接着写。和 `"w"` 的区别是 `"w"` 会先清空。`with` 保证写完自动关闭文件([Day 98](/blog/agent-zero/day-098-context-managers/) 的上下文管理器)。
- `f.write(json.dumps({"seq": seq, "name": name, "result": result}, ensure_ascii=False) + "\n")` 一条记录转成一行 JSON,末尾加换行。JSON Lines 的唯一规则就是「一行一个 JSON」。
- `LOG.unlink(missing_ok=True)` 每次演示前删掉旧文件。`missing_ok=True` 表示文件不存在也不报错,相当于 `rm -f`。

</div>

```bash
uv run python part10/durable_step1_log.py
```

```text
{"seq": 1, "name": "llm", "result": "先查发票,再写回复"}
{"seq": 2, "name": "tool.list_invoices", "result": [{"id": "INV-2290", "amount": 468}, {"id": "INV-2291", "amount": 468}]}
```

两行,就是这次运行的两个事件。和工单的事件列表比一下,结构一模一样,只是事件的内容从「工单发生了什么」换成了「第几步得到了什么结果」。

### 第二步:重放

有了日志,另一半就是**重放**(replay):重启以后,代码还是从第 1 步开始跑,但每走到一步,先去日志里看这一步是不是已经做过了。做过了,就不执行,直接把日志里的结果拿来用;没做过,才真的执行,执行完把结果追加进日志。

从代码的角度看,工作流函数一路从头跑到尾,像从来没有挂过;实际上前面几步只是在读日志。这个机制要成立,有一个前提:**每一次运行,步骤的顺序都一样**,这样「第 2 步」在日志里和在代码里才是同一件事。今天的流程步骤是写死的,前提天然成立;Agent 的步骤由模型决定,这个前提会被打破,那是明天的事。

为了让所有步骤都经过「先查日志」这个检查,我们规定:**工作流里每一个调模型、调工具的动作,都必须通过 `run.step(名字, 函数, 参数...)` 来执行**,不能直接调。新建 `part10/durable_step2_replay.py`:

```python
# agent-zero-lab/part10/durable_step2_replay.py
import json
from pathlib import Path
from typing import Any, Callable

LOG = Path("part10/run-1.jsonl")
CALLS = {"llm": 0}


def fake_llm(prompt: str) -> str:
    CALLS["llm"] += 1
    return {"plan": "先查发票,再写回复", "reply": "您 9 月有两笔 468 元扣款,我们核实后处理"}[prompt]


def list_invoices(customer_id: str) -> list[dict]:
    return [{"id": "INV-2290", "amount": 468}, {"id": "INV-2291", "amount": 468}]


class Run:
    def __init__(self, log: Path):
        self.log, self.seq = log, 0
        lines = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
        self.done = [json.loads(line) for line in lines]  # 上次已经做完的步骤

    def step(self, name: str, fn: Callable[..., Any], *args: Any) -> Any:
        self.seq += 1
        if self.seq <= len(self.done):  # 日志里有这一步:不执行,直接拿结果
            print(f"  第 {self.seq} 步 {name}:重放")
            return self.done[self.seq - 1]["result"]
        result = fn(*args)
        with self.log.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"seq": self.seq, "name": name, "result": result}, ensure_ascii=False) + "\n")
        print(f"  第 {self.seq} 步 {name}:真正执行")
        return result


def workflow(run: Run, crash: bool) -> str:
    run.step("llm", fake_llm, "plan")
    run.step("tool.list_invoices", list_invoices, "C007")
    if crash:
        raise SystemExit("  进程在第 2 步之后挂了")
    return run.step("llm", fake_llm, "reply")


LOG.unlink(missing_ok=True)
print("第一次运行")
try:
    workflow(Run(LOG), crash=True)
except SystemExit as e:
    print(e)
print("重启后")
print("  结果:", workflow(Run(LOG), crash=False))
print("模型一共被调了", CALLS["llm"], "次")
print("再跑一次(全部做完以后)")
workflow(Run(LOG), crash=False)
print("模型一共被调了", CALLS["llm"], "次")
```

<div class="line-notes">

- `from typing import Any, Callable` `Callable[..., Any]` 表示「任意参数、任意返回值的函数」,相当于 TS 的 `(...args: any[]) => any`。
- `self.log, self.seq = log, 0` 一行给两个属性赋值。`seq` 是「现在走到第几步了」,每次新建 `Run` 都从 0 开始。
- `lines = log.read_text(encoding="utf-8").splitlines() if log.exists() else []` 日志文件存在就按行读出来,不存在(第一次运行)就是空列表。
- `self.done = [json.loads(line) for line in lines]  # 上次已经做完的步骤` 每行解析成一个 dict。重启后这里有 2 条。
- `def step(self, name: str, fn: Callable[..., Any], *args: Any) -> Any:` 把「要执行的函数」本身当参数传进来,而不是先调用再传结果。这是关键:只有把函数交给 `step`,`step` 才有机会决定**不调用它**。JS 里同样的写法是 `run.step("llm", fakeLlm, "plan")`,而不是 `run.step("llm", fakeLlm("plan"))`。
- `self.seq += 1` 每进一次 `step`,步数加一。代码第 1 次调 `step` 就是第 1 步,第 2 次就是第 2 步,这就是为什么顺序必须稳定。
- `if self.seq <= len(self.done):  # 日志里有这一步:不执行,直接拿结果` 日志里有 2 条,那么第 1、2 步都是重放。
- `return self.done[self.seq - 1]["result"]` seq 从 1 开始,列表下标从 0 开始,所以减 1。
- `result = fn(*args)` 日志里没有这一步,真的调用。`*args` 把收集来的参数再展开传进去,相当于 JS 的 `fn(...args)`。
- `f.write(json.dumps({"seq": self.seq, "name": name, "result": result}` 执行完马上追加一行日志,再返回结果。先记再走,顺序不能反。
- `run.step("llm", fake_llm, "plan")` 工作流里不再直接调 `fake_llm`,一律经过 `run.step`。
- `workflow(Run(LOG), crash=False)` 每次「重启」都新建一个 `Run`,它会重新读日志,`seq` 重新从 0 开始。

</div>

```bash
uv run python part10/durable_step2_replay.py
```

```text
第一次运行
  第 1 步 llm:真正执行
  第 2 步 tool.list_invoices:真正执行
  进程在第 2 步之后挂了
重启后
  第 1 步 llm:重放
  第 2 步 tool.list_invoices:重放
  第 3 步 llm:真正执行
  结果: 您 9 月有两笔 468 元扣款,我们核实后处理
模型一共被调了 2 次
再跑一次(全部做完以后)
  第 1 步 llm:重放
  第 2 步 tool.list_invoices:重放
  第 3 步 llm:重放
模型一共被调了 2 次
```

这就是持久化执行(durable execution)的全部核心。重启后前两步是重放,模型只为第 3 步多调了一次,一共 2 次,正好是需要的次数。全部做完以后再跑一遍,三步都是重放,一次模型都不调,结果和第一次完全一样。

(这个脚本在同一个进程里模拟「重启」,所以 `CALLS` 计数器能一直累加。下面换成真的进程重启。)

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="第一次运行执行了第 1、2 步并写入日志后崩溃;第二次运行时第 1、2 步从日志重放,第 3 步真正执行">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <text x="20" y="44" fill="var(--ink)">第一次</text>
    <rect x="90" y="28" width="100" height="28" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="140" y="46" text-anchor="middle" fill="var(--ink)">1 调模型</text>
    <rect x="200" y="28" width="100" height="28" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="250" y="46" text-anchor="middle" fill="var(--ink)">2 查发票</text>
    <text x="320" y="46" fill="var(--compute)">✕ kill -9</text>
    <rect x="90" y="84" width="210" height="34" rx="3" fill="var(--paper)" stroke="var(--ink-soft)"/>
    <text x="195" y="100" text-anchor="middle" fill="var(--ink)">日志:第 1、2 步的结果</text>
    <text x="195" y="113" text-anchor="middle" fill="var(--ink-faint)" font-size="10">每步做完先落盘</text>
    <line x1="140" y1="56" x2="140" y2="84" stroke="var(--ink-faint)"/><line x1="250" y1="56" x2="250" y2="84" stroke="var(--ink-faint)"/>
    <text x="20" y="174" fill="var(--ink)">第二次</text>
    <rect x="90" y="158" width="100" height="28" rx="3" fill="var(--paper)" stroke="var(--rule)" stroke-dasharray="4 3"/><text x="140" y="176" text-anchor="middle" fill="var(--ink-faint)">1 重放</text>
    <rect x="200" y="158" width="100" height="28" rx="3" fill="var(--paper)" stroke="var(--rule)" stroke-dasharray="4 3"/><text x="250" y="176" text-anchor="middle" fill="var(--ink-faint)">2 重放</text>
    <rect x="310" y="158" width="100" height="28" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="360" y="176" text-anchor="middle" fill="var(--ink)">3 调模型</text>
    <line x1="140" y1="118" x2="140" y2="158" stroke="var(--ink-faint)"/><line x1="250" y1="118" x2="250" y2="158" stroke="var(--ink-faint)"/>
    <text x="320" y="214" text-anchor="middle" fill="var(--ink-faint)" font-size="10">虚线框:不真正执行,直接从日志取结果。模型不会再被调一次,也不再花钱</text>
  </g>
</svg>
<figcaption>记日志,然后重放。代码看起来是一路跑下来的,实际上前两步只是在读日志。</figcaption>
</figure>

## 换成 SQLite,来一次真的 kill -9

JSON Lines 文件够演示原理,但有一个隐患:进程恰好在写某一行写到一半时被杀,文件末尾会留下半行坏 JSON,下次读日志时 `json.loads` 直接报错。练习 2 会亲手制造这种情况。数据库帮我们处理了这件事:SQLite 的一次 commit 要么完整写进去,要么完全没写,不会留下半条记录(Day 91 讲的事务原子性)。

### 先确认 commit 这件事有多重要

[Day 93](/blog/agent-zero/day-093-python-sqlite-2/) 讲过,Python 的 `sqlite3` 执行 INSERT 时会自动开一个事务,不 `commit` 的话改动只在这个连接里看得见。进程正常退出时,没提交的事务会被回滚;那被 `kill -9` 呢?用十几行验证一下。新建 `part10/no_commit.py`:

```python
# agent-zero-lab/part10/no_commit.py
import os
import signal
import sqlite3
import sys

db = sqlite3.connect("part10/nc.db")
db.execute("CREATE TABLE IF NOT EXISTS steps(seq INTEGER, result TEXT)")
db.execute("INSERT INTO steps VALUES(1, '第 1 步的结果')")
if sys.argv[1] == "commit":
    db.commit()
os.kill(os.getpid(), signal.SIGKILL)  # 自己给自己发 kill -9,模拟进程被系统杀掉
```

<div class="line-notes">

- `import signal` 信号模块。`SIGKILL` 就是终端里 `kill -9` 发的那个信号:进程收到后立刻被操作系统终止,没有任何机会执行清理代码,`try/finally`、`with` 的退出逻辑都不会跑。
- `db = sqlite3.connect("part10/nc.db")` 这次用真的文件,不用 `:memory:`,因为要在进程死掉后用另一个程序去看里面有什么。
- `db.execute("INSERT INTO steps VALUES(1, '第 1 步的结果')")` 插入一行,此时还在事务里,没提交。
- `if sys.argv[1] == "commit":` 命令行第一个参数是 `commit` 才提交。
- `os.kill(os.getpid(), signal.SIGKILL)` `os.getpid()` 是当前进程的编号,给自己发 SIGKILL。这一行之后什么都不会执行。

</div>

```bash
rm -f part10/nc.db
uv run python part10/no_commit.py nocommit; echo "exit=$?"
sqlite3 part10/nc.db "SELECT count(*) FROM steps"
uv run python part10/no_commit.py commit; echo "exit=$?"
sqlite3 part10/nc.db "SELECT count(*) FROM steps"
```

`sqlite3` 命令行工具 macOS 自带,`echo "exit=$?"` 打印上一条命令的退出码,`$?` 是 shell 里专门存这个数的变量。

```text
exit=137
0
exit=137
1
```

退出码 137 = 128 + 9,表示进程被 9 号信号(SIGKILL)杀死。没提交的那次,数据库里 0 行;提交了的那次,1 行。所以运行器的规则是:**每一步的结果写进日志后立刻 commit,commit 返回了,才算这一步完成**。

### 运行器

新建 `part10/durable.py`,这是今天的核心代码:

```python
# agent-zero-lab/part10/durable.py
"""最小的持久化执行:每一步的结果写进 SQLite 日志,重启后按日志重放。"""
import json
import sqlite3
from typing import Any, Callable


class Journal:
    def __init__(self, path: str = "part10/journal.db"):
        self.db = sqlite3.connect(path)
        self.db.execute("CREATE TABLE IF NOT EXISTS steps("
                        "run_id TEXT, seq INTEGER, name TEXT, result TEXT, PRIMARY KEY(run_id, seq))")

    def get(self, run_id: str, seq: int) -> tuple[str, str] | None:
        return self.db.execute("SELECT name, result FROM steps WHERE run_id=? AND seq=?",
                               (run_id, seq)).fetchone()

    def put(self, run_id: str, seq: int, name: str, result: Any) -> None:
        self.db.execute("INSERT INTO steps VALUES(?,?,?,?)",
                        (run_id, seq, name, json.dumps(result, ensure_ascii=False)))
        self.db.commit()  # 先落盘再往下走


class DurableRun:
    def __init__(self, journal: Journal, run_id: str):
        self.j, self.run_id, self.seq = journal, run_id, 0
        self.replayed = self.executed = 0

    def step(self, name: str, fn: Callable[..., Any], *args: Any) -> Any:
        self.seq += 1
        row = self.j.get(self.run_id, self.seq)
        if row:
            self.replayed += 1
            return json.loads(row[1])
        result = fn(*args)
        self.j.put(self.run_id, self.seq, name, result)
        self.executed += 1
        return result
```

<div class="line-notes">

- `class Journal:` 把「日志存在哪、怎么读写」单独做成一个类,`DurableRun` 只管重放逻辑。以后想把日志换成 Postgres,只改这个类。
- `def __init__(self, path: str = "part10/journal.db"):` 所有运行共用一个数据库文件,用 `run_id` 区分。
- `"run_id TEXT, seq INTEGER, name TEXT, result TEXT, PRIMARY KEY(run_id, seq))")` 联合主键 `(run_id, seq)`:同一次运行的同一步只能有一行。万一有 bug 试图把同一步写两次,数据库会直接报 `UNIQUE constraint failed`,而不是悄悄存两份。
- `def get(self, run_id: str, seq: int) -> tuple[str, str] | None:` 查某次运行的第几步,有就返回 `(name, result)`,没有就是 None。
- `(run_id, seq, name, json.dumps(result, ensure_ascii=False)))` 结果转成 JSON 字符串存进 TEXT 列。所以 `step` 执行的函数返回值必须能转 JSON:字符串、数字、列表、dict 可以,一个 openai 的响应对象不行,要先取出需要的字段。
- `self.db.commit()  # 先落盘再往下走` 刚才的实验证明了这一行的必要性。`put` 返回之前数据已经在硬盘上了。
- `self.j, self.run_id, self.seq = journal, run_id, 0` 和 JSONL 版的 `Run` 一样,`seq` 每次从 0 开始。
- `self.replayed = self.executed = 0` 两个计数器,统计这次运行重放了几步、真正执行了几步,方便观察。
- `row = self.j.get(self.run_id, self.seq)` 和 JSONL 版的区别:不再一次读出全部日志,而是每一步按主键查一次。日志有几千步时也不用全部载入内存。
- `return json.loads(row[1])` `row[1]` 是存进去的 JSON 字符串,解析回 Python 对象。注意它和第一次执行时的返回值「看起来一样」,但不是同一个对象,比如元组会变成列表(JSON 没有元组)。
- `self.j.put(self.run_id, self.seq, name, result)` 执行完、commit 完,才把结果返回给工作流。

</div>

### 用真的模型、真的进程试一次

这次第 1、3 步调真的 DeepSeek,第 2 步查发票故意 `sleep` 3 秒,给我们留出动手 kill 的时间。新建 `part10/durable_demo.py`:

```python
# agent-zero-lab/part10/durable_demo.py
import json
import os
import sys
import time

from dotenv import load_dotenv
from openai import OpenAI

from durable import DurableRun, Journal

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))


def call_llm(prompt: str) -> dict:
    resp = client.chat.completions.create(
        model=os.environ["LLM_MODEL"], temperature=0, extra_body=EXTRA, max_tokens=80,
        messages=[{"role": "user", "content": prompt}])
    u = resp.usage
    return {"text": resp.choices[0].message.content, "tokens": [u.prompt_tokens, u.completion_tokens] if u else [0, 0]}


def list_invoices(customer_id: str) -> list[dict]:
    time.sleep(3)  # 假装这个接口很慢,给我们留出 kill 的时间
    return [{"id": "INV-2290", "amount": 468}, {"id": "INV-2291", "amount": 468}]


run = DurableRun(Journal(), sys.argv[1])
plan = run.step("llm", call_llm, "客户 C007 说 9 月被重复扣款。用一句话写处理计划。")
print("1 计划:", plan["text"], plan["tokens"], flush=True)
invoices = run.step("tool.list_invoices", list_invoices, "C007")
print("2 发票:", [i["id"] for i in invoices], flush=True)
time.sleep(3)
reply = run.step("llm", call_llm, f"发票是 {invoices},用一句话回复客户。")
print("3 回复:", reply["text"], reply["tokens"], flush=True)
print(f"重放 {run.replayed} 步,真正执行 {run.executed} 步", flush=True)
```

<div class="line-notes">

- `from durable import DurableRun, Journal` 导入刚写的运行器。
- `def call_llm(prompt: str) -> dict:` 调模型的函数自己把响应整理成一个普通 dict 再返回,因为 `Journal.put` 要把返回值转成 JSON,原始的响应对象转不了。
- `max_tokens=80,` 限制输出长度,演示不需要长回复,也控制花费。
- `return {"text": resp.choices[0].message.content, "tokens":` 把这一步用了多少 token 也存进结果里。重放时打印出来的 token 数是**第一次执行时**的,不是这次花的,这一点下面会看到。
- `time.sleep(3)  # 假装这个接口很慢,给我们留出 kill 的时间` 真实的工具调用也常常要几秒。
- `run = DurableRun(Journal(), sys.argv[1])` 运行 id 从命令行传进来,`uv run python part10/durable_demo.py run-1` 里的 `run-1`。同一个 id 再跑一次,就是「恢复这次运行」。
- `print("1 计划:", plan["text"], plan["tokens"], flush=True)` `flush=True` 让输出立刻写出去。我们把输出重定向到文件,Python 默认会攒一批再写,进程被 kill 时还在缓冲区里的内容就丢了,你会以为第 1 步没跑。
- `time.sleep(3)` 第 2 步和第 3 步之间再等 3 秒,方便在第 2 步完成后、第 3 步开始前杀掉它。
- `reply = run.step("llm", call_llm, f"发票是 {invoices},用一句话回复客户。")` 第 3 步的提示词用到了第 2 步的结果。重放时 `invoices` 来自日志,提示词和第一次完全一样。

</div>

在 `agent-zero-lab/` 下依次执行。第一条把程序放到后台跑(行尾的 `&`),输出写进 `out1.txt`;等 7 秒,大约是第 2 步完成、第 3 步还没开始的时候,用 `pkill -9 -f` 按命令行内容找到这个进程发 `kill -9`:

```bash
rm -f part10/journal.db
uv run python part10/durable_demo.py run-1 > part10/out1.txt 2>&1 &
sleep 7; pkill -9 -f "durable_demo.py run-1"; sleep 1
cat part10/out1.txt
sqlite3 part10/journal.db "SELECT run_id, seq, name, substr(result,1,60) FROM steps"
uv run python part10/durable_demo.py run-1
uv run python part10/durable_demo.py run-1
```

我的输出,分成四段看。被杀之前程序打印的:

```text
1 计划: 核实C007在9月的扣款记录，确认重复扣款后立即发起退款并同步客户处理结果。 [24, 24]
2 发票: ['INV-2290', 'INV-2291']
```

日志里有两行:

```text
run-1|1|llm|{"text": "核实C007在9月的扣款记录，确认重复扣款后立即发起退款并同步客户处理结果。", "tokens":
run-1|2|tool.list_invoices|[{"id": "INV-2290", "amount": 468}, {"id": "INV-2291", "amou
```

第一次恢复:

```text
1 计划: 核实C007在9月的扣款记录，确认重复扣款后立即发起退款并同步客户处理结果。 [24, 24]
2 发票: ['INV-2290', 'INV-2291']
3 回复: 您好，您的两张发票（INV-2290 和 INV-2291）金额均为 468 元，合计 936 元，请查收。 [45, 35]
重放 2 步,真正执行 1 步
```

全部做完以后再跑一次:

```text
1 计划: 核实C007在9月的扣款记录，确认重复扣款后立即发起退款并同步客户处理结果。 [24, 24]
2 发票: ['INV-2290', 'INV-2291']
3 回复: 您好，您的两张发票（INV-2290 和 INV-2291）金额均为 468 元，合计 936 元，请查收。 [45, 35]
重放 3 步,真正执行 0 步
```

这次是真的进程死亡,不是被 `except` 接住的异常。恢复时前两步是重放:计划的文字和被杀前一字不差,查发票也没有再等那 3 秒,程序几乎是立刻就打印出了第 2 行。最后一次三步全部重放,一个 token 都没花,但打印出来的 `[24, 24]`、`[45, 35]` 还在,因为那是存在日志里的「第一次执行时的用量」。如果你要统计这次运行实际花了多少钱,得用 `executed` 那些步骤的 token,别把重放的也算进去。

回复的内容其实不太对:它说「合计 936 元,请查收」,好像要客户付钱,完全没看出这是重复扣款。这是提示词的问题,和今天的运行器无关,但它提醒了一件事:运行器只保证「做过的事不重做」,不保证「做的事是对的」。

成本:真正调模型的只有两次,输入 24 + 45 = 69 个 token,输出 24 + 35 = 59 个。按 `deepseek-flash` 高峰价(2026-10 查,输入 ¥2/百万、输出 ¥8/百万):69 × 2 ÷ 1,000,000 + 59 × 8 ÷ 1,000,000 ≈ ¥0.0006。没有这个运行器,被杀后从头跑会多调一次计划。真实 Agent 一次任务几十步,省下的就是几十次调用。

### 零件和大代码的对应

| 零件 | 在 `durable.py` 里的位置 |
| --- | --- |
| 事件溯源:只追加的事件列表 | `steps` 表,一行一步,只 INSERT 不 UPDATE |
| JSONL 版的 `record` | `Journal.put` |
| JSONL 版启动时读日志 | `Journal.get`,改成每一步按主键查一次 |
| 重放的判断 `seq <= len(done)` | `DurableRun.step` 里的 `if row:` |
| `no_commit.py` 的结论 | `Journal.put` 最后的 `self.db.commit()` |

## 和 LangGraph 的 checkpoint 有什么不同

第五部分 [Day 318](/blog/agent-zero/day-318-lg-sqlite-saver/) 用 `SqliteSaver` 也做过「kill 掉进程后续跑」。两者是同一个家族,差别在于**记什么、多细**。LangGraph 的 checkpoint 是在每个节点执行完后,把整个 State 存一份快照;恢复时从最后一个快照接着往后跑。我们的运行器存的是每一步的结果,粒度到每一次调模型、每一次调工具,恢复时把代码从头跑一遍、前面的步骤读日志。

粒度的差别平时看不出来,出事时才明显:一个 LangGraph 节点里先调了模型、再调了工具,在两者之间崩溃,恢复时整个节点重跑,模型又被调一次。如果那个工具是退款,就退两次。Temporal、Restate、DBOS 这些专门的持久化执行系统走的都是我们这条路:把每个有外部效果的动作单独记录。它们各自怎么做,是 Day 539 的内容。

## 动手练习

**练习 1:给工单加一个「重开」事件。** 在不修改 `event_sourcing.py` 的前提下,写一个新的 reducer `apply2`,认识 `reopened` 事件:状态回到 `open`,并且多一个字段 `reopen_count` 记录重开了几次。在原来五个事件后面追加「重开」和「再关闭」,打印每个事件之后的状态。

<details><summary>参考答案</summary>

新建 `part10/ex535_reopen.py`:

```python
# agent-zero-lab/part10/ex535_reopen.py
from event_sourcing import apply, events


def apply2(state: dict, e: dict) -> dict:
    if e["type"] == "reopened":
        return {**state, "status": "open", "reopen_count": state.get("reopen_count", 0) + 1}
    return apply(state, e)


log = events + [{"type": "reopened", "reason": "退款金额不对"}, {"type": "closed"}]
state: dict = {}
for i, e in enumerate(log, start=1):
    state = apply2(state, e)
    print(i, e["type"], "->", state["status"], "| 重开次数", state.get("reopen_count", 0))
```

<div class="line-notes">

- `from event_sourcing import apply, events` 正文的 `event_sourcing.py` 把演示放在了 `if __name__ == "__main__":` 下,导入时不会打印。
- `def apply2(state: dict, e: dict) -> dict:` 新 reducer 只处理新事件,其余交给旧的 `apply`。Redux 里把多个 reducer 组合起来也是这个思路。
- `"reopen_count": state.get("reopen_count", 0) + 1}` 旧状态里没有这个字段,`.get(key, 0)` 取不到时给 0,相当于 JS 的 `state.reopen_count ?? 0`。
- `log = events + [` 两个列表用 `+` 拼成新列表,原来的 `events` 不变。事件只追加。
- `for i, e in enumerate(log, start=1):` `enumerate` 同时给出序号和元素,`start=1` 让序号从 1 开始(Day 18)。

</div>

```text
1 opened -> open | 重开次数 0
2 assigned -> open | 重开次数 0
3 refund_requested -> waiting_refund | 重开次数 0
4 refund_paid -> refunded | 重开次数 0
5 closed -> closed | 重开次数 0
6 reopened -> open | 重开次数 1
7 closed -> closed | 重开次数 1
```

「重开次数」这个字段是今天才发明的,但前五个事件是早就存在的。因为状态是折叠出来的,改了 reducer 就能对所有历史工单重新算出这个字段,不需要写数据迁移脚本。这是事件溯源最常被拿来举的好处。

</details>

**练习 2:日志写了一半。** JSONL 版的日志,如果进程恰好在写某一行时被杀,文件末尾会留下半行。手工造一个这样的文件,先看原来的读法会怎么报错,再写一个 `load_done(log)`,丢掉坏掉的最后一行,只返回完整的步骤。

<details><summary>参考答案</summary>

新建 `part10/ex535_torn_line.py`:

```python
# agent-zero-lab/part10/ex535_torn_line.py
import json
from pathlib import Path

LOG = Path("part10/torn.jsonl")
LOG.write_text('{"seq": 1, "name": "llm", "result": "先查发票"}\n{"seq": 2, "name": "tool.list_in', encoding="utf-8")


def load_done(log: Path) -> list[dict]:
    done = []
    for line in log.read_text(encoding="utf-8").splitlines():
        try:
            done.append(json.loads(line))
        except json.JSONDecodeError:
            print("丢弃写了一半的行:", line)
            break  # 写坏的只可能是最后一行,后面不会再有完整的
    return done


try:
    [json.loads(line) for line in LOG.read_text(encoding="utf-8").splitlines()]
except json.JSONDecodeError as e:
    print("原来的读法:", type(e).__name__, e)
print("新读法读到:", load_done(LOG))
```

<div class="line-notes">

- `LOG.write_text(` 手工造一个坏文件:第一行完整,第二行只写了一半。
- `except json.JSONDecodeError:` JSON 解析失败的异常类型([Day 39](/blog/agent-zero/day-039-json/) 学 `json.loads` 时见过)。
- `break  # 写坏的只可能是最后一行,后面不会再有完整的` 因为是追加写,只有最后一行可能没写完。遇到坏行就停,而不是 `continue` 跳过它接着读,否则万一中间真坏了一行,后面的步骤序号就全错位了。
- `print("原来的读法:", type(e).__name__, e)` `type(e).__name__` 取异常的类名。

</div>

```text
原来的读法: JSONDecodeError Unterminated string starting at: line 1 column 20 (char 19)
丢弃写了一半的行: {"seq": 2, "name": "tool.list_in
新读法读到: [{'seq': 1, 'name': 'llm', 'result': '先查发票'}]
```

丢掉半行之后,恢复时第 2 步会被重新执行,这是对的:它的结果没有完整落盘,就当它没做完。不过「当它没做完」只对没有副作用的步骤安全;如果第 2 步是退款,它可能已经在支付系统那边成功了,只是日志没写完。这正是明天要解决的问题。也正因为有这类麻烦,正文最后换成了 SQLite:一次 commit 要么完整、要么没有。

</details>

**练习 3:换一个位置杀。** 正文是在第 2 步完成后杀的。这次在第 2 步执行到一半(查发票的 `sleep` 期间)杀掉,看日志里有几步、恢复时哪些重放、哪些重新执行。再写一个 `show_journal.py run-id`,把某次运行的日志打印出来,代替手写 sqlite3 命令。

<details><summary>参考答案</summary>

新建 `part10/show_journal.py`:

```python
# agent-zero-lab/part10/show_journal.py
import json
import sys

from durable import Journal

j = Journal()
rows = j.db.execute("SELECT seq, name, result FROM steps WHERE run_id=? ORDER BY seq", (sys.argv[1],)).fetchall()
print(f"{sys.argv[1]} 一共 {len(rows)} 步")
for seq, name, result in rows:
    text = json.dumps(json.loads(result), ensure_ascii=False)
    print(f"  {seq}  {name:<20} {text[:50]}")
```

<div class="line-notes">

- `j = Journal()` 和运行器用同一个数据库文件。
- `rows = j.db.execute("SELECT seq, name, result FROM steps WHERE run_id=? ORDER BY seq", (sys.argv[1],)).fetchall()` 只有一个参数的元组也要写逗号 `(x,)`。
- `text = json.dumps(json.loads(result), ensure_ascii=False)` 先解析再序列化一遍,保证中文原样显示。
- `print(f"  {seq}  {name:<20} {text[:50]}")` `:<20` 左对齐占 20 个字符,让结果列对齐;结果只显示前 50 个字符。

</div>

第 1 步调模型大约 1 秒,第 2 步 `sleep` 3 秒,所以第 4 秒杀掉时正在第 2 步里:

```bash
uv run python part10/durable_demo.py run-2 > part10/out2.txt 2>&1 &
sleep 4; pkill -9 -f "durable_demo.py run-2"; sleep 1
cat part10/out2.txt
uv run python part10/show_journal.py run-2
uv run python part10/durable_demo.py run-2
```

```text
1 计划: 核实C007在9月的扣款记录，确认重复扣款后立即发起退款并同步客户处理进度。 [24, 24]
run-2 一共 1 步
  1  llm                  {"text": "核实C007在9月的扣款记录，确认重复扣款后立即发起退款并同步客户处理进度。",
1 计划: 核实C007在9月的扣款记录，确认重复扣款后立即发起退款并同步客户处理进度。 [24, 24]
2 发票: ['INV-2290', 'INV-2291']
3 回复: 您好，您的两张发票（INV-2290 和 INV-2291）金额均为 468 元，请查收。 [45, 29]
重放 1 步,真正执行 2 步
```

日志里只有 1 步:第 2 步在执行中被杀,`put` 没来得及调用,所以没有记录。恢复时第 1 步重放,第 2、3 步重新执行。

再仔细看一眼第 1 步的文字:run-1 是「同步客户处理**结果**」,run-2 是「同步客户处理**进度**」。同样的提示词、`temperature=0`,两次调用输出不一样。同一次运行里,重放保证了它不会变;但这说明模型输出本身是不确定的,明天的第一个话题就从这里开始。

</details>

**练习 4(观察题):手动删掉日志里的一步。** 对已经全部完成的 run-1,用 `sqlite3 part10/journal.db "DELETE FROM steps WHERE run_id='run-1' AND seq=1"` 删掉第 1 步的记录,再运行 `uv run python part10/durable_demo.py run-1`。会发生什么?这说明了什么?

<details><summary>参考答案</summary>

```bash
sqlite3 part10/journal.db "DELETE FROM steps WHERE run_id='run-1' AND seq=1"
uv run python part10/durable_demo.py run-1
```

```text
1 计划: 核实C007在9月的扣款记录，确认重复扣款后立即发起退款并同步客户处理进度。 [24, 24]
2 发票: ['INV-2290', 'INV-2291']
3 回复: 您好，您的两张发票（INV-2290 和 INV-2291）金额均为 468 元，合计 936 元，请查收。 [45, 35]
重放 2 步,真正执行 1 步
```

第 1 步重新调了模型,得到的计划变成了「处理进度」(原来是「处理结果」);第 2、3 步照样从日志重放。现在这次运行的日志自相矛盾:第 3 步的回复是基于旧计划那次运行产生的,而第 1 步的计划已经换了一个。这个例子里两者碰巧不冲突,如果第 1 步的计划从「退款」变成了「先转人工」,第 3 步却还是重放出「已为您退款」,就出大事了。

这说明两件事。第一,日志是这次运行唯一的真相,只能追加,不能改、不能删;要清理,就整次运行一起清。第二,运行器目前只按「第几步」对号入座,不检查日志里记的那一步和代码这次要执行的是不是同一件事。明天 Day 536 会给每一步加上名字和参数的指纹,对不上就报错,而不是悄悄用错结果。

</details>

**验收标准**:`durable_step2_replay.py` 和 `durable_demo.py` 跑出和文中同样结构的输出;你亲手做过至少两次 `kill -9`(在第 2 步之后、在第 2 步之中),恢复后的结果和不杀时一致,且日志里每次运行的步数和你预想的一样;能不看文章说出 `Journal.put` 里为什么必须 commit。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 事件溯源 event sourcing | 不直接保存当前状态,只按顺序追加保存发生过的事件,状态需要时从事件折叠出来 |
| 事件 | 一件已经发生的事,用过去时命名,例如 `refund_paid`,只追加不修改 |
| reducer / apply | 「旧状态 + 一个事件 → 新状态」的纯函数,和 Redux 的 reducer 是同一个东西 |
| 折叠 fold | 从初始状态出发,把事件一个个交给 reducer,得到最终状态,相当于 JS 的 `reduce` |
| 持久化执行 durable execution | 把任务每一步的结果持久化,进程崩溃后通过重放恢复,代码看起来像没中断过 |
| 执行日志 journal / 事件历史 | 记录某次运行每一步结果的持久化日志,重放的依据 |
| 重放 replay | 重新运行代码时,日志里已有的步骤不执行,直接取记录的结果 |
| JSON Lines | 每行一个 JSON 对象的文本格式,适合追加写的日志,扩展名常用 `.jsonl` |
| SIGKILL / kill -9 | 让操作系统立刻终止进程的信号,进程没有任何机会做清理,退出码 137 |
| 快照 snapshot | 事件很多时定期保存一次折叠结果,以后从快照往后折叠,不用每次从头算 |

## 常见误区

**以为加了重试就等于持久化。** 重试应对的是单次调用失败,进程还活着。进程被 `kill -9` 以后内存里的一切都没了,重试逻辑本身也没了。持久化执行要的是**进度**落在进程外面。

**把调用结果传给 step,而不是把函数传给 step。** 写成 `run.step("llm", call_llm(prompt))`,模型在进 `step` 之前就已经被调用了,重放根本没机会拦住它,钱照花。必须写成 `run.step("llm", call_llm, prompt)`。

**写日志不 commit。** Python 的 `sqlite3` 插入后不提交,数据只在当前连接里可见。实测 `kill -9` 后没提交的那行 0 条。`put` 里的 `commit` 一行都不能省。

**把重放出来的 token 也算进成本。** 日志里存的是第一次执行时的用量,重放时原样打印出来。算这次运行花了多少钱,只能算 `executed` 的那些步。

**输出重定向到文件时不 flush。** 程序被 kill 时缓冲区里还没写出去的 print 全部丢失,你会误以为某一步没执行。演示和排查时 `print(..., flush=True)`,或者运行时加 `python -u`。

**手动改日志「修」一次运行。** 练习 4 演示了删掉一步的后果:那一步重新执行,后面的步骤还在重放旧结果,日志自相矛盾。日志只能追加,要清就整次运行一起清。

**以为 LangGraph 的 checkpoint 和这个一样细。** checkpoint 按节点存快照,节点内部做到一半崩溃会整个节点重跑。节点里有调模型又有调工具时,要么拆成多个节点,要么在节点内部也做逐步记录。

## 学习资料

### 文档与文章

- [Martin Fowler《Event Sourcing》](https://martinfowler.com/eaaDev/EventSourcing.html):事件溯源最常被引用的原始文章,读前半部分的例子就够了。20 分钟。
- [Redux 官方文档:三大原则](https://redux.js.org/understanding/thinking-in-redux/three-principles):「状态只读,只能通过 action 改变」「用纯函数 reducer 计算新状态」,对照今天的 `apply` 读一遍。10 分钟。
- [microservices.io:Event Sourcing 模式](https://microservices.io/patterns/data/event-sourcing.html):Chris Richardson 对这个模式的简洁说明,包括优缺点。
- [Temporal 文档:Workflows](https://docs.temporal.io/workflows):看「Deterministic constraints」那一节,今天说的「每次步骤顺序必须一样」在 Temporal 里是一条硬规定。30 分钟。
- [Temporal 文档:Event History](https://docs.temporal.io/encyclopedia/event-history):Temporal 的执行日志里记了哪些事件,和我们的 `steps` 表对照着看。
- [SQLite:Atomic Commit](https://www.sqlite.org/atomiccommit.html):SQLite 怎么保证一次提交要么全有要么全无,想知道 commit 背后发生了什么可以读前几节。
- [JSON Lines 格式说明](https://jsonlines.org/):一页纸,三条规则。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV15541147z3&autoplay=0&high_quality=1" title="[动画] 事件溯源(Event Sourcing),读写分离(CQRS)与事件驱动的设计(Event-Driven Design)" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>小马过河Vizit · [动画] 事件溯源(Event Sourcing),读写分离(CQRS)与事件驱动的设计 · 10 分钟动画,看前半段事件溯源的部分,CQRS 今天用不到。视频是 2020 年的,但讲的是不会过时的基础概念。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1JNkFBMEFH&autoplay=0&high_quality=1" title="用Temporal构建持久化AI智能体 | AI Engineer" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>7k的每日搬运 · 用Temporal构建持久化AI智能体 | AI Engineer · 78 分钟的官方工作坊搬运,今天只看前 20 分钟讲原理的部分,和我们的运行器对照;后面的动手部分留到 Day 539。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/STKCRSUsyP0" title="The Many Meanings of Event-Driven Architecture • Martin Fowler • GOTO 2017" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>GOTO Conferences · The Many Meanings of Event-Driven Architecture • Martin Fowler • GOTO 2017 · Fowler 本人讲「事件驱动」这个词的几种不同含义,事件溯源是其中之一,英文,50 分钟。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/GEXllEH2XiQ" title="Build an AI Agent with Temporal" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Temporal · Build an AI Agent with Temporal · 官方频道的入门演示,看一个真正的持久化执行系统里 Agent 的每一步是怎么被记录的,英文。</figcaption>
</figure>

### 书籍

- Martin Kleppmann《Designing Data-Intensive Applications》(O'Reilly,2017;中文版《数据密集型应用系统设计》,中国电力出版社)第 11 章「Stream Processing」里讲事件日志和事件溯源,第 7 章讲事务。今天的两个新概念背后的原理都在这两章。2026 年出了第二版,章节有调整。
- Chris Richardson《Microservices Patterns》(Manning,2018)第 6 章专讲用事件溯源实现业务逻辑,有完整的代码例子和快照、事件版本升级这些工程细节。

### 开源项目与代码

- [temporalio/samples-python](https://github.com/temporalio/samples-python):Temporal 官方的 Python 示例,先找 hello 目录下最短的那几个,看 workflow 和 activity 是怎么分开的。
- [dbos-inc/dbos-transact-py](https://github.com/dbos-inc/dbos-transact-py):DBOS 用 Postgres 存执行日志,思路和我们用 SQLite 最像,README 里的例子可以和 `durable.py` 对照。
- [restatedev/sdk-python](https://github.com/restatedev/sdk-python):Restate 的 Python SDK,另一种「每一步都记录」的写法。

## 自测

1. 用 Redux 的说法解释事件溯源:事件、reducer、当前状态分别对应什么?

<details><summary>答案</summary>

事件对应 action(已经发生的事,只追加);reducer 对应 `apply(state, event)`,一个纯函数;当前状态是从初始状态开始把所有事件依次交给 reducer 折叠出来的结果,对应 Redux store 里的 state。Redux DevTools 的时间旅行就是只折叠到某个 action 为止。

</details>

2. 持久化执行的核心原理用一句话怎么说?它依赖一个什么前提?

<details><summary>答案</summary>

每一步的结果都写进持久化日志,崩溃后重新运行代码,已经做过的步骤直接从日志取结果,没做过的才真正执行。前提是每次运行时步骤的顺序一样,这样代码里的第 N 步和日志里的第 N 步才是同一件事。

</details>

3. 为什么 `step` 要接收函数本身(`run.step("llm", call_llm, prompt)`),而不是函数的结果?

<details><summary>答案</summary>

只有拿到函数本身,`step` 才能在发现日志里已有结果时**不调用**它。如果传的是结果,函数在进入 `step` 之前就已经执行了,重放既省不了钱,也挡不住重复的副作用。

</details>

4. `kill -9` 杀掉的进程,退出码为什么是 137?为什么 `Journal.put` 里必须 commit?

<details><summary>答案</summary>

被信号杀死的进程退出码是 128 加信号编号,SIGKILL 是 9,所以是 137。SIGKILL 不给进程任何清理机会,没有提交的事务不会被写进数据库文件,实测没提交的那行在进程被杀后是 0 条。commit 返回后数据才真正落盘,所以要在 commit 之后才认为这一步完成。

</details>

5. 面试题:「你们的 Agent 任务要跑几个小时,发版时进程会被重启。你怎么保证重启后不从头再来?说说你的设计和它的局限。」

<details><summary>答案</summary>

要点:采用持久化执行,工作流里所有调模型、调工具的动作都通过一个 `step` 包装执行;每一步执行完先把结果写进持久化日志(数据库,带 run_id 和步骤序号的联合主键)并提交,再继续;重启后用同一个 run_id 重新运行代码,日志里已有的步骤直接返回记录的结果,不再调用模型和工具,从第一个没有记录的步骤开始真正执行。好处是不重复花 token、不重复等待。局限要主动说:一是要求步骤顺序稳定,模型决定下一步做什么时、或者代码升级后步骤变了,重放会对不上,需要给每一步记名字和参数指纹并检测;二是外部调用成功但写日志前崩溃的窗口消不掉,有副作用的调用要带幂等键;三是生产上还要处理多进程同时恢复同一次运行(加锁或租约)和日志归档。最后可以说规模大了会考虑 Temporal、DBOS 这类现成系统。

</details>

6. LangGraph 的 checkpoint 和今天的运行器,粒度有什么不同?这在什么情况下会出问题?

<details><summary>答案</summary>

LangGraph 在每个节点执行完后存一份整个 State 的快照,粒度是节点;今天的运行器记录每一次调模型、调工具的结果,粒度是步骤。一个节点里先调模型再调工具,在两者之间崩溃,LangGraph 恢复时整个节点重跑,模型被再调一次;如果工具有副作用(比如退款),还会重复执行。

</details>

## 明天预告

Day 536 · 持久化执行(二):Agent 让这件事变难的两个地方。今天练习里已经看到了它们的影子:同样的提示词两次输出不一样(非确定性),日志写坏了一步就会重做一个可能已经成功过的动作(副作用)。明天讲清楚这两件事为什么是 Agent 特有的麻烦,以及步骤指纹、幂等键这两个对应的解法。
