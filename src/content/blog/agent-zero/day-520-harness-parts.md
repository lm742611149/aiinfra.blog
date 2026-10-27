---
title: 'Day 520 · Harness(一):harness 包了哪些东西'
description: '模型是马,harness 是套在它身上的那一整套挽具。今天从 Day 267 的 25 行循环出发,一层一层补:循环的刹车、工具层、上下文裁剪、权限、钩子、子 Agent、状态持久化。每一层都先看缺了它会怎么坏(真报错、真的 400),再补上,最后拼成 150 行的 mini_harness,真模型跑一遍「停在审批上、换个进程批准、接着跑完」。'
pubDate: 2026-10-27
regime: none
tags: ['harness', 'agent', 'python', 'agent-zero']
series: 'agent-zero'
day: 520
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 519](/blog/agent-zero/day-519-senior-map/) 讲了进阶篇的地图和学法,写了第一份 ADR:一个决定一页纸,背景、方案、决定、理由、代价和推翻条件。从今天起进入第一块硬内容,harness。

这个词你其实在 [Day 267](/blog/agent-zero/day-267-subagent-isolation/) 见过。那天把一周写的零件接成了 `part04/harness.py`:取记忆、整理历史、拼 system、跑循环、存回去、记轨迹,当时我说它是「模型之外让它能干活的那层代码」,并列了一张六块的表。今天把这个词认真拆开。拆的方法不是列定义,而是从那 25 行的 `loop()` 出发,看它上线以后会在哪里坏,每坏一处就补一层,补到七层为止。

## 今天要解决的问题

学完这一课你应该能:

1. 说出 harness 的七层(循环、工具层、上下文管理、权限、钩子、子 Agent、状态持久化),并且对每一层说得出「没有它会怎么坏」,最好带一个真实的报错或现象。
2. 写出 `s1_stop.py` 到 `s7_state.py` 七个小脚本,并看懂怎么拼成 `mini_harness.py`。
3. 让真模型跑一遍:停在「退款要人批」上,进程退出,另开一个进程批准,接着跑完,并从事件日志里读出整个过程。
4. 说清 harness 和框架的区别,以及为什么「崩在副作用之后」会重复退款(这个坑今天只演示,不解决)。

预计用时 3 小时。**今天七层偏满**,每层都是小脚本、都不长,但加起来是七个概念,我在汇报里建议拆成两天,你自己学的时候也可以分两次,第四层之前一次,之后一次。前置:[Day 267](/blog/agent-zero/day-267-subagent-isolation/) 的 `part04/agent_loop.py`(`loop()` 和 `LoopResult`)、[Day 135](/blog/agent-zero/day-135-llm-client-1/) 的 `LLMClient`、[Day 159](/blog/agent-zero/day-159-tool-roundtrip/) 的 `tool_call_id` 和 `role=tool` 消息。

实跑花费:约 ¥0.01。起点那次 ¥0.0028,裁剪那次 ¥0.0002,完整 harness 两次(停在审批、批准后继续)¥0.0017 + ¥0.0007,拒绝路径 ¥0.0007,练习 ¥0.0006,合计约 ¥0.0067,加上我调试时多跑的几次,取整 ¥0.01。价格是 `.env` 里 `LLM_PRICE=0.04,2,8`(缓存命中 / 未命中输入 / 输出,元每百万 token,2026 年 10 月查到的 DeepSeek 价格)。凡是写了「剧本模型」的演示都不调 API,花费为 0。

学法提示:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `Registry.execute` 和 `trim` 这两个函数;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先把词拆开:七层

harness 本义是马具。马有力气,但不套上挽具、缰绳、笼头,它拉不了车。放到 Agent 上:模型是马,**harness 是除了模型之外、让它能稳定干活的全部工程**。Claude Code、Codex、Cursor 的 Agent 模式,拆开看都是「一个模型加一个 harness」。Anthropic 在 2025 年 9 月的文章里把 Claude Agent SDK 说成是「驱动 Claude Code 的 agent harness」,这篇文章还提到一个循环:收集上下文、采取行动、验证结果、重复。

Day 267 的表里列了六块。今天换一种切法,按「上线以后会逐个撞上的问题」切成七层,多出来的是钩子和子 Agent 各自独立,而「记忆和检索」那一块归到上下文管理里:

<figure>
<svg viewBox="0 0 640 290" role="img" aria-label="harness 的七层:中间是循环,左边是上下文管理、权限、钩子三个策略层,右边是工具层、子 Agent、状态持久化三个对外打交道的层,模型在最上面">
  <rect x="0" y="0" width="640" height="290" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" text-anchor="middle">
    <rect x="250" y="14" width="140" height="34" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="320" y="36" font-size="13" fill="var(--ink)">模型</text>
    <rect x="230" y="110" width="180" height="60" rx="30" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="2"/>
    <text x="320" y="136" font-size="13" fill="var(--ink)">1 循环</text>
    <text x="320" y="154" font-size="10" fill="var(--ink-soft)">继续 / 停 / 暂停</text>
    <g font-size="11">
      <rect x="40" y="70" width="140" height="34" rx="4" fill="var(--paper)" stroke="var(--ink-soft)"/><text x="110" y="92" fill="var(--ink)">3 上下文管理</text>
      <rect x="40" y="130" width="140" height="34" rx="4" fill="var(--paper)" stroke="var(--ink-soft)"/><text x="110" y="152" fill="var(--ink)">4 权限</text>
      <rect x="40" y="190" width="140" height="34" rx="4" fill="var(--paper)" stroke="var(--ink-soft)"/><text x="110" y="212" fill="var(--ink)">5 钩子</text>
      <rect x="460" y="70" width="140" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="530" y="92" fill="var(--ink)">2 工具层</text>
      <rect x="460" y="130" width="140" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="530" y="152" fill="var(--ink)">6 子 Agent</text>
      <rect x="460" y="190" width="140" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="530" y="212" fill="var(--ink)">7 状态持久化</text>
    </g>
  </g>
  <g stroke="var(--rule)" fill="none">
    <line x1="320" y1="48" x2="320" y2="110"/>
    <line x1="180" y1="87" x2="240" y2="122"/><line x1="180" y1="147" x2="230" y2="140"/><line x1="180" y1="207" x2="245" y2="160"/>
    <line x1="460" y1="87" x2="400" y2="122"/><line x1="460" y1="147" x2="410" y2="140"/><line x1="460" y1="207" x2="395" y2="160"/>
  </g>
  <text x="320" y="262" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">数字是今天讲的顺序。左边三层是「怎么跑」的策略,右边三层是「和外界打交道」</text>
</svg>
<figcaption>harness 的七层。蓝色是模型这一侧的东西(循环、上下文),琥珀色是对接外部系统的东西(工具、子 Agent、存储)。好的 harness 把循环写得很薄,其余各层做成可以替换的零件,这一点后面几天会反复回来。</figcaption>
</figure>

| 层 | 管什么 | 没有它会怎么坏 |
| --- | --- | --- |
| 1 循环 | 什么时候继续、什么时候停 | 模型卡在同一个工具上转圈,账单一直涨 |
| 2 工具层 | 找工具、解参数、执行、把出错翻成模型能读的话 | 模型多打一位数字,整个运行崩溃 |
| 3 上下文管理 | 每一轮送给模型的消息列表怎么裁 | 历史越来越长;粗暴裁剪还会直接 400 |
| 4 权限 | 每次调用工具前问「这个调用允许吗」 | 一句话就能让 Agent 退一笔五千块的款 |
| 5 钩子 | 关键时刻通知外面(日志、计费、审计) | 想记个日志就得改核心循环 |
| 6 子 Agent | 把一部分活交给另一个有自己上下文的循环 | 翻资料的脏活把主对话撑爆 |
| 7 状态持久化 | 跑到一半能存下来,换个进程接着跑 | 等人审批的几个小时里,进程不能重启 |

下面一层一层来。每一层的写法一样:先让没有这一层的版本出一次事,再补。

## 起点:Day 267 的 loop() 原样跑一次

把 Day 267 的 `part04/agent_loop.py` 拿来,配两个假工具。工具和数据放在 `part10/harness/tools.py`,数据和 [Day 540](/blog/agent-zero/day-540-orch-1/) 的 `orch_tools.py` 一样:客户 C007 有两张 2026-09-03 的 468 元发票,是一次重复扣款。

```python
# agent-zero-lab/part10/harness/tools.py
"""今天所有脚本共用的假数据和两个假工具。数据和 Day 540 的 orch_tools.py 一致。"""
import json
from typing import Any

INVOICES: dict[str, list[dict[str, Any]]] = {
    "C007": [
        {"id": "INV-2290", "date": "2026-09-03", "amount": 468},
        {"id": "INV-2291", "date": "2026-09-03", "amount": 468},
        {"id": "INV-2188", "date": "2026-08-03", "amount": 468},
    ],
    "C012": [{"id": "INV-2301", "date": "2026-09-05", "amount": 199}],
}
REFUNDS: list[dict[str, Any]] = []  # 假的支付系统:每次退款追加一条


def list_invoices(customer_id: str) -> str:
    if customer_id not in INVOICES:
        raise ValueError(f"没有这个客户:{customer_id}")
    return json.dumps(INVOICES[customer_id], ensure_ascii=False)


def create_refund(invoice_id: str, amount: int) -> str:
    REFUNDS.append({"invoice_id": invoice_id, "amount": amount})
    return json.dumps({"refund_id": f"RF-{len(REFUNDS)}", "invoice_id": invoice_id, "amount": amount})


def spec(name: str, desc: str, props: dict[str, tuple[str, str]]) -> dict[str, Any]:
    """props: 参数名 -> (类型, 说明)。拼出 OpenAI 格式的工具说明书。"""
    return {"type": "function", "function": {"name": name, "description": desc, "parameters": {
        "type": "object",
        "properties": {k: {"type": t, "description": d} for k, (t, d) in props.items()},
        "required": list(props)}}}


TOOL_SPECS = [
    spec("list_invoices", "查一个客户的全部发票", {"customer_id": ("string", "客户 id,形如 C007")}),
    spec("create_refund", "对一张发票发起退款", {"invoice_id": ("string", "发票号"), "amount": ("integer", "退款金额,元")}),
]
FUNCS = {"list_invoices": list_invoices, "create_refund": create_refund}
```

<div class="line-notes">

- `INVOICES: dict[str, list[dict[str, Any]]] = {` 键是客户 id,值是发票列表。相当于 JS 里 `Record<string, Invoice[]>`。C007 三张发票,其中 INV-2290 和 INV-2291 日期相同、金额相同,就是那笔重复扣款。
- `REFUNDS: list[dict[str, Any]] = []` 假的支付系统。每次退款往里追加一条。后面所有「到底退了几次」的判断都看这个列表。
- `def list_invoices(customer_id: str) -> str:` 返回的是 JSON 字符串,因为 `role=tool` 消息的 `content` 必须是字符串。
- `raise ValueError(f"没有这个客户:{customer_id}")` 客户不存在就抛异常。传 `"C0007"`(多打一个 0)时会走到这一行,第二层要处理的就是它。
- `REFUNDS.append({"invoice_id": invoice_id, "amount": amount})` 副作用发生的那一行。「钱已经退出去了」就是指这行执行过。
- `"refund_id": f"RF-{len(REFUNDS)}"` 退款单号用列表长度生成。第一次退款是 `RF-1`,第二次是 `RF-2`。
- `def spec(name: str, desc: str, props: dict[str, tuple[str, str]])` 拼 OpenAI 格式的工具说明书,少写点重复的 JSON。`props` 的值是(类型, 说明)。
- `FUNCS = {"list_invoices": list_invoices, "create_refund": create_refund}` 工具名到函数的映射表,`loop()` 的第四个参数就是它。

</div>

再写 `part10/harness/s0_baseline.py`,让真模型处理一张工单:

```python
# agent-zero-lab/part10/harness/s0_baseline.py
"""起点:Day 267 的 loop() 原样拿来跑一次真模型。"""
from common.llm import LLMClient
from part04.agent_loop import loop
from part10.harness.tools import FUNCS, REFUNDS, TOOL_SPECS

client = LLMClient()
system = "你是云簿 CloudLedger 的客服助手。用工具查账、退款。回答要简短。"
msgs = [{"role": "system", "content": system},
        {"role": "user", "content": "我是 C007,9 月 3 号被扣了两次 468 元,把重复的那笔退给我。"}]
res = loop(client, msgs, TOOL_SPECS, FUNCS)
for name, raw in res.calls:
    print("工具调用:", name, raw)
print("回答:", res.answer)
print("finished:", res.finished, "| 退款流水:", REFUNDS)
print(client.ledger)
```

<div class="line-notes">

- `res = loop(client, msgs, TOOL_SPECS, FUNCS)` 就是 Day 267 的 `loop()`,默认最多 6 步。
- `for name, raw in res.calls:` `res.calls` 是 `(工具名, 参数原文)` 的列表,按发生顺序。
- `print("finished:", res.finished, "| 退款流水:", REFUNDS)` `finished` 为 True 说明是模型自己说完的,不是步数用完被截断。

</div>

在 `agent-zero-lab` 根目录运行:

```bash
uv run python -m part10.harness.s0_baseline
```

真实输出:

```text
工具调用: list_invoices {"customer_id": "C007"}
工具调用: create_refund {"invoice_id": "INV-2291", "amount": 468}
回答: 已退款：发票 INV-2291，金额 468 元，退款单号 RF-1。到账时间以银行处理为准。
finished: True | 退款流水: [{'invoice_id': 'INV-2291', 'amount': 468}]
3 次调用 | 输入 1617 / 输出 168 tokens | 约 ¥0.0028
```

模型查了发票,挑中 `INV-2291` 退了 468 元,回答也干净。这个循环能用。但把它放到线上,下面七件事一件一件会出问题。

## 第一层:循环,除了「说完了」还要有别的刹车

Day 267 的 `loop()` 只有两个出口:模型不再调工具(说完了),或者 `max_steps` 步用完。一个出口是信模型,一个是数步数,但步数不等于钱。长上下文下,每一步都要把前面全部消息重发一遍,20 步可能是几十万 token。所以第二个刹车应该是预算。

`s1_stop.py` 把出口写成明确的枚举,并加上 token 预算。为了稳定地演示「模型停不下来」,我用一个照剧本说话的假模型(`fake.py`,接口和 `LLMClient.chat` 对得上),让它永远在查同一个客户。**这里的数字是我在剧本里设定的,不是真模型的行为**。

```python
# agent-zero-lab/part10/harness/fake.py
"""一个照剧本说话的假模型,接口和 LLMClient.chat 对得上,用来免费演示 harness 的各层。"""
from dataclasses import dataclass
from typing import Any, Protocol


@dataclass
class Reply:
    message: dict[str, Any]
    prompt_tokens: int = 100
    completion_tokens: int = 20

    @property
    def content(self) -> str:
        return self.message.get("content") or ""


class Chatter(Protocol):
    def chat(self, messages: list[dict[str, Any]], **kw: Any) -> Any: ...


def call(name: str, args: str, cid: str = "c1") -> dict[str, Any]:
    """造一条带一个工具调用的 assistant 消息。args 是 JSON 字符串原文。"""
    return {"role": "assistant", "content": None, "tool_calls": [
        {"id": cid, "type": "function", "function": {"name": name, "arguments": args}}]}


def say(text: str) -> dict[str, Any]:
    return {"role": "assistant", "content": text}


class Scripted:
    """按顺序吐出剧本里的回复;剧本用完就一直重复最后一条。seen 记录它每次看到了多少条消息。"""

    def __init__(self, script: list[Reply]) -> None:
        self.script = script
        self.n = 0
        self.seen: list[int] = []

    def chat(self, messages: list[dict[str, Any]], **kw: Any) -> Reply:
        self.seen.append(len(messages))
        r = self.script[min(self.n, len(self.script) - 1)]
        self.n += 1
        return r
```

<div class="line-notes">

- `class Reply:` 假模型的一次回复。`message` 是 OpenAI 格式的 assistant 消息,`prompt_tokens` 和 `completion_tokens` 默认 100 和 20,和 `ChatResult` 上的同名字段对得上。
- `def content(self) -> str:` 加了 `@property`,所以读 `r.content` 不用加括号,和 `ChatResult.content` 用法一致。`or ""` 是因为带工具调用的消息 `content` 是 `None`。
- `class Chatter(Protocol):` Python 的「结构类型」:只要一个对象有 `chat(messages, **kw)` 方法,就算 `Chatter`,不用继承。相当于 TS 里的 `interface`。`LLMClient` 和 `Scripted` 都满足它。
- `def call(name: str, args: str, cid: str = "c1")` 造一条带一个工具调用的 assistant 消息。`args` 是 JSON 字符串原文,模型真实返回的就是字符串。
- `self.seen: list[int] = []` 记录每次被调用时看到多少条消息,今天没用到,留着以后看历史有没有被裁剪。
- `r = self.script[min(self.n, len(self.script) - 1)]` 剧本用完就一直重复最后一条。`min` 防止下标越界。

</div>

```python
# agent-zero-lab/part10/harness/s1_stop.py
"""第一层:循环。除了「模型说完了」,还得有别的刹车。"""
import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal

from part10.harness.fake import Chatter, Reply, Scripted, call, say
from part10.harness.tools import FUNCS, TOOL_SPECS

StopReason = Literal["done", "max_steps", "budget"]


@dataclass
class Outcome:
    reason: StopReason
    answer: str
    messages: list[dict[str, Any]]
    steps: int
    tokens: int


def run(client: Chatter, messages: list[dict[str, Any]], tools: list[dict[str, Any]],
        funcs: dict[str, Callable[..., str]], max_steps: int = 8, max_tokens: int = 20000) -> Outcome:
    msgs = list(messages)
    used = 0
    for step in range(1, max_steps + 1):
        r = client.chat(msgs, tools=tools, temperature=0)
        used += r.prompt_tokens + r.completion_tokens
        msgs.append(r.message)
        calls = r.message.get("tool_calls") or []
        if not calls:
            return Outcome("done", r.content, msgs, step, used)
        for tc in calls:
            result = funcs[tc["function"]["name"]](**json.loads(tc["function"]["arguments"]))
            msgs.append({"role": "tool", "tool_call_id": tc["id"], "content": result})
        if used >= max_tokens:
            return Outcome("budget", "", msgs, step, used)
    return Outcome("max_steps", "", msgs, max_steps, used)


if __name__ == "__main__":
    same = call("list_invoices", '{"customer_id": "C007"}')
    # 剧本:模型一直在查同一个客户,永远不说完。每一步它看到的历史更长,所以 prompt_tokens 递增。
    script = [Reply(same, prompt_tokens=200 * (i + 1), completion_tokens=20) for i in range(12)]
    base = [{"role": "user", "content": "查一下 C007"}]

    o1 = run(Scripted(script), base, TOOL_SPECS, FUNCS, max_steps=5, max_tokens=10**9)
    print(f"只有步数上限: reason={o1.reason} steps={o1.steps} tokens={o1.tokens}")

    o2 = run(Scripted(script), base, TOOL_SPECS, FUNCS, max_steps=50, max_tokens=1500)
    print(f"步数放到 50,只有 token 预算: reason={o2.reason} steps={o2.steps} tokens={o2.tokens}")

    o3 = run(Scripted([Reply(same), Reply(say("C007 有 3 张发票。"))]), base, TOOL_SPECS, FUNCS)
    print(f"正常收工: reason={o3.reason} steps={o3.steps} answer={o3.answer}")
```

<div class="line-notes">

- `StopReason = Literal["done", "max_steps", "budget"]` 三种结束原因。`Literal` 相当于 TS 的字符串字面量联合类型,拼错一个字,类型检查就红线。
- `class Outcome:` 一次运行的结果。把「为什么停」放进返回值,调用方才能分别处理:budget 要告警,max_steps 要排查。
- `msgs = list(messages)` 复制一份,不改调用方的列表。
- `used += r.prompt_tokens + r.completion_tokens` 累计这次运行已经花的 token。因为每一步都重发整个历史,所以这个数增长得比步数快。
- `if not calls:` 模型没有调工具,说完了,返回 `"done"`。
- `result = funcs[tc["function"]["name"]](**json.loads(tc["function"]["arguments"]))` 这一行还是 Day 267 的写法:找函数、解 JSON、调用。出错怎么办留给第二层。
- `if used >= max_tokens:` 注意位置:放在这一步的工具**执行完之后**。预算只能拦住「下一次模型调用」,拦不住这一步里已经发出去的工具调用。
- `script = [Reply(same, prompt_tokens=200 * (i + 1), completion_tokens=20) for i in range(12)]` 剧本:第 i 步的输入是 200×(i+1) token,模拟历史越来越长。第 1 步花 220,第 2 步 420,第 3 步 620。
- `o1 = run(Scripted(script), base, TOOL_SPECS, FUNCS, max_steps=5, max_tokens=10**9)` 只设步数上限:预算设成十亿等于没有。
- `o2 = run(Scripted(script), base, TOOL_SPECS, FUNCS, max_steps=50, max_tokens=1500)` 步数放宽到 50,只靠预算刹车。累计 220、640、1260、2080,第 4 步越过 1500。

</div>

```bash
uv run python -m part10.harness.s1_stop
```

```text
只有步数上限: reason=max_steps steps=5 tokens=3100
步数放到 50,只有 token 预算: reason=budget steps=4 tokens=2080
正常收工: reason=done steps=2 answer=C007 有 3 张发票。
```

第一行,只有步数上限:停在第 5 步,花了 220+420+620+820+1020 = 3100 token。第二行,步数放到 50,预算 1500:停在第 4 步,累计 2080。如果只有步数上限、又把它放大到 50,同一个剧本会一直烧到第 50 步,我实际跑了一次(`max_steps=50, max_tokens=10**9`):累计 107800 token,是预算 1500 时的 52 倍。这就是「只限步数不限预算」的坑。

还有一个细节在输出里看不出来:`budget` 停下的时候,这一步的工具已经执行了。如果这一步调的是退款,钱已经退了。所以预算是兜底,不是权限。拦一笔危险的调用要靠第四层。

## 第二层:工具层,别让一个错参数炸掉整个运行

先让它出一次事。模型把 `C007` 多打了一个 0,传了 `C0007`。`s1_stop.py` 里的 `run()` 直接调函数,没有任何保护:

```python
# agent-zero-lab/part10/harness/s2_crash.py
"""没有工具层会怎样:模型传了个不存在的客户号,s1 的 run() 直接崩。"""
from part10.harness.fake import Reply, Scripted, call, say
from part10.harness.s1_stop import run
from part10.harness.tools import FUNCS, TOOL_SPECS

script = [Reply(call("list_invoices", '{"customer_id": "C0007"}')), Reply(say("好的"))]
run(Scripted(script), [{"role": "user", "content": "查 C007"}], TOOL_SPECS, FUNCS)
```

```bash
uv run python -m part10.harness.s2_crash
```

真实输出(中间几行文件路径我省掉了):

```text
Traceback (most recent call last):
  ...
    result = funcs[tc["function"]["name"]](**json.loads(tc["function"]["arguments"]))
  ...
    raise ValueError(f"没有这个客户:{customer_id}")
ValueError: 没有这个客户:C0007
```

整个运行因为一个参数崩了,前面已经花掉的模型调用全部白费。但这种错模型自己是能改的:告诉它「没有 C0007,客户 id 形如 C007」,它下一步就会改对。所以工具层的职责是**把各种出错翻成模型能读的一句话,放进 `role=tool` 消息还给它**。

`s2_tools.py` 把出错分成五类,另外留了一个例外:

```python
# agent-zero-lab/part10/harness/s2_tools.py
"""第二层:工具层。找工具、解参数、执行、把各种出错翻成模型看得懂的话。"""
import json
from collections.abc import Callable
from typing import Any


class InfraError(Exception):
    """基础设施故障(数据库连不上之类)。模型改参数没用,必须让整个运行失败、交给重试。"""


class Registry:
    def __init__(self, funcs: dict[str, Callable[..., str]]) -> None:
        self.funcs = funcs

    def execute(self, name: str, raw_args: str) -> str:
        fn = self.funcs.get(name)
        if fn is None:
            return f"错误:没有叫 {name} 的工具。可用工具:{', '.join(self.funcs)}"
        try:
            args: Any = json.loads(raw_args or "{}")
        except json.JSONDecodeError as e:
            return f"错误:参数不是合法 JSON({e.msg},第 {e.pos} 个字符)。原文:{raw_args[:80]}"
        if not isinstance(args, dict):
            return f"错误:参数必须是 JSON 对象,拿到的是 {type(args).__name__}"
        try:
            return fn(**args)
        except InfraError:
            raise
        except TypeError as e:  # 参数名不对、缺参数、多参数
            return f"错误:调用 {name} 的参数不对:{e}"
        except Exception as e:
            return f"错误:{name} 执行失败:{type(e).__name__}: {e}"
```

<div class="line-notes">

- `class InfraError(Exception):` 基础设施故障:数据库连不上、下游服务 500。这种错模型改参数没用,应该让整个运行失败,交给外面的重试机制([Day 190](/blog/agent-zero/day-190-failures-2/) 讲过的那套)。
- `def __init__(self, funcs: dict[str, Callable[..., str]]) -> None:` 注册表就是把「工具名到函数」那张映射表包一层。
- `fn = self.funcs.get(name)` 用 `.get` 而不是 `[]`,找不到返回 `None` 而不是抛 `KeyError`。
- `return f"错误:没有叫 {name} 的工具。可用工具:{', '.join(self.funcs)}"` 第一类:工具名不存在。把可用工具列出来,模型一般能改对。`', '.join(self.funcs)` 遍历字典拿到的是键,也就是工具名。
- `args: Any = json.loads(raw_args or "{}")` `raw_args or "{}"` 处理模型传空字符串的情况(没有参数的工具有时就是这样)。
- `except json.JSONDecodeError as e:` 第二类:参数不是合法 JSON。模型输出被截断时会发生。`e.msg` 是原因,`e.pos` 是出错的位置。
- `if not isinstance(args, dict):` 第三类:JSON 合法但不是对象(比如 `["C007"]`)。后面要 `**args` 展开,必须是字典。
- `except InfraError:` 先接住基础设施故障,原样 `raise`。这个 `except` 必须写在 `except Exception` 之前,否则会被后者吞掉。
- `except TypeError as e:  # 参数名不对、缺参数、多参数` 第四类:参数名对不上函数签名。Python 调用时多一个参数、少一个参数都抛 `TypeError`。
- `except Exception as e:` 第五类:工具自己的业务异常,比如我们的 `ValueError`。`type(e).__name__` 把异常类名也带上。

</div>

`s2_demo.py` 把六种情况各打一遍(不调模型):

```python
# agent-zero-lab/part10/harness/s2_demo.py
from part10.harness.s2_tools import InfraError, Registry
from part10.harness.tools import FUNCS

reg = Registry(FUNCS)
cases = [
    ("list_invoices", '{"customer_id": "C0007"}'),
    ("list_invoice", '{"customer_id": "C007"}'),
    ("list_invoices", '{"customer_id": "C007"'),
    ("list_invoices", '{"cust": "C007"}'),
    ("list_invoices", '["C007"]'),
    ("list_invoices", '{"customer_id": "C012"}'),
]
for name, raw in cases:
    print(f"{name}({raw}) ->\n    {reg.execute(name, raw)}")


def broken_db(customer_id: str) -> str:
    raise InfraError("数据库连接超时")


try:
    Registry({"list_invoices": broken_db}).execute("list_invoices", '{"customer_id": "C007"}')
except InfraError as e:
    print("基础设施故障照样往外抛:", e)
```

```bash
uv run python -m part10.harness.s2_demo
```

```text
list_invoices({"customer_id": "C0007"}) ->
    错误:list_invoices 执行失败:ValueError: 没有这个客户:C0007
list_invoice({"customer_id": "C007"}) ->
    错误:没有叫 list_invoice 的工具。可用工具:list_invoices, create_refund
list_invoices({"customer_id": "C007") ->
    错误:参数不是合法 JSON(Expecting ',' delimiter,第 22 个字符)。原文:{"customer_id": "C007"
list_invoices({"cust": "C007"}) ->
    错误:调用 list_invoices 的参数不对:list_invoices() got an unexpected keyword argument 'cust'
list_invoices(["C007"]) ->
    错误:参数必须是 JSON 对象,拿到的是 list
list_invoices({"customer_id": "C012"}) ->
    [{"id": "INV-2301", "date": "2026-09-05", "amount": 199}]
基础设施故障照样往外抛: 数据库连接超时
```

前五行是五类错,每一类模型看到的都是一句有信息量的话:「没有叫 list_invoice 的工具,可用工具:list_invoices, create_refund」「参数不是合法 JSON(Expecting ',' delimiter,第 22 个字符)」。最后一行是基础设施故障,照样往外抛。

这里我有一个取舍要说明。**错误信息给模型看多少?** 我的写法是原文给。OpenAI Agents SDK 的默认做法正相反,只给一句固定的话,明天读源码会实测。两种做法各有道理,原文给更利于模型自救,但异常原文可能带出内部路径、SQL 之类你不想让模型(以及模型背后的用户)看到的东西。这件事今天先记一笔,明天用真数据比较。

## 第三层:上下文管理,裁剪不能把工具调用和它的结果拆开

多轮对话的消息列表只会增长。最朴素的办法是只留最近 N 条。这里有个坑,我写这个脚本时亲自踩过:**`assistant` 消息里的 `tool_calls` 和后面对应的 `role=tool` 消息是一对,拆开就不合法。**

先演示。`sample_history.py` 里放一段 6 条消息的历史(system、user、带工具调用的 assistant、tool 结果、assistant 回答、user 追问),朴素裁剪「系统消息加最近 3 条」:

```python
# agent-zero-lab/part10/harness/sample_history.py
"""演示裁剪用的一段 6 条消息的历史。"""
from typing import Any

HISTORY: list[dict[str, Any]] = [
    {"role": "system", "content": "你是客服助手。"},
    {"role": "user", "content": "查 C012 的发票"},
    {"role": "assistant", "content": None, "tool_calls": [
        {"id": "call_1", "type": "function", "function": {"name": "list_invoices", "arguments": '{"customer_id": "C012"}'}}]},
    {"role": "tool", "tool_call_id": "call_1", "content": '[{"id": "INV-2301", "amount": 199}]'},
    {"role": "assistant", "content": "C012 有 1 张发票,199 元。"},
    {"role": "user", "content": "金额再说一遍"},
]
```

```python
# agent-zero-lab/part10/harness/s3_naive_trim.py
"""坑:只留最近 N 条消息,把 assistant 的 tool_calls 和它的 tool 结果拆开了。这次是真调模型。"""
from common.llm import LLMClient
from part10.harness.sample_history import HISTORY as history

print("原始 6 条,角色:", [m["role"] for m in history])

cut = [history[0]] + history[-3:]  # 系统消息 + 最近 3 条
print("朴素裁剪后:", [m["role"] for m in cut])

client = LLMClient()
try:
    client.chat(cut)
except Exception as e:
    print(type(e).__name__, str(e)[:300])
```

<div class="line-notes">

- `from part10.harness.sample_history import HISTORY as history` 把常量起个小写别名,下面读起来像一个变量。
- `cut = [history[0]] + history[-3:]  # 系统消息 + 最近 3 条` `history[-3:]` 是最后 3 条,相当于 JS 的 `history.slice(-3)`。6 条里取到的是 `tool`、`assistant`、`user`,而那条带 `tool_calls` 的 assistant 被切掉了。
- `except Exception as e:` 这次是真调 API,所以会抛真异常。`str(e)[:300]` 只取前 300 个字符,免得输出太长。

</div>

```bash
uv run python -m part10.harness.s3_naive_trim
```

```text
原始 6 条,角色: ['system', 'user', 'assistant', 'tool', 'assistant', 'user']
朴素裁剪后: ['system', 'tool', 'assistant', 'user']
BadRequestError Error code: 400 - Messages with role 'tool' must be a response to a preceding message with 'tool_calls' (request_id: 1aa32e52-781a-46e7-8995-815019481ed0)
```

DeepSeek 直接回 400:`Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`。这是真实报错原文。

修法是不按「条」裁,按「组」裁:一条 assistant 消息加它后面紧跟的所有 tool 消息算一组,user 消息单独一组,整组留或整组丢。

```python
# agent-zero-lab/part10/harness/s3_context.py
"""第三层:上下文管理。按「一组」裁剪,assistant 的工具调用和它的结果永远一起走或一起留。"""
from typing import Any

from part10.harness.sample_history import HISTORY

Msg = dict[str, Any]


def split_groups(msgs: list[Msg]) -> list[list[Msg]]:
    """assistant 消息带着紧跟其后的 tool 消息算一组;user 消息单独一组。system 不在这里处理。"""
    groups: list[list[Msg]] = []
    for m in msgs:
        if m["role"] == "tool" and groups:
            groups[-1].append(m)
        else:
            groups.append([m])
    return groups


def trim(msgs: list[Msg], keep_groups: int) -> list[Msg]:
    """留下:system、第一条 user(任务本身)、最近 keep_groups 组。中间的丢掉。"""
    head = [m for m in msgs[:2] if m["role"] in ("system", "user")]
    rest = split_groups(msgs[len(head):])
    kept = rest[-keep_groups:] if keep_groups > 0 else []
    return head + [m for g in kept for m in g]


if __name__ == "__main__":
    for k in (3, 2, 1):
        print(f"keep_groups={k}:", [m["role"] for m in trim(HISTORY, k)])
```

<div class="line-notes">

- `Msg = dict[str, Any]` 类型别名,省得到处写长类型。
- `def split_groups(msgs: list[Msg]) -> list[list[Msg]]:` 把扁平的消息列表切成「组」的列表。
- `if m["role"] == "tool" and groups:` tool 消息不开新组,追加到上一组(也就是发起调用的那条 assistant 所在的组)。`and groups` 是防御:如果历史一上来就是 tool 消息,没有上一组可追加,就让它自己成组,而不是抛 `IndexError`。
- `head = [m for m in msgs[:2] if m["role"] in ("system", "user")]` 开头的 system 和第一条 user 钉住不动:system 是规矩,第一条 user 是任务本身,丢了模型就不知道自己在干什么。
- `rest = split_groups(msgs[len(head):])` 钉住的部分之后的消息才参与分组。
- `kept = rest[-keep_groups:] if keep_groups > 0 else []` 只留最近的 `keep_groups` 组。`rest[-0:]` 会返回整个列表,所以 0 要单独处理。
- `return head + [m for g in kept for m in g]` 把留下的组重新摊平。这个双层推导式相当于 JS 的 `kept.flat()`。
- `for k in (3, 2, 1):` 用 3、2、1 三个值各裁一次,看角色序列。

</div>

```bash
uv run python -m part10.harness.s3_context
```

```text
keep_groups=3: ['system', 'user', 'assistant', 'tool', 'assistant', 'user']
keep_groups=2: ['system', 'user', 'assistant', 'user']
keep_groups=1: ['system', 'user', 'user']
```

`keep_groups=2` 的结果是 `system, user, assistant, user`:那条带工具调用的 assistant 和它的 tool 结果一起被丢了,留下的序列是合法的。拿它再发给真模型(`s3_real.py`,`trim(HISTORY, 2)`):

```text
C012 的发票金额是 **199 元**。
1 次调用 | 输入 36 / 输出 13 tokens | 约 ¥0.0002
```

(这次的输出最前面还有 `s3_naive_trim` 的那三行,因为当时我没给它加 `if __name__` 保护;现在的文件已经改成只导入常量了。)

模型答对了,但答的是「199 元」,这个数它从哪来的?从 assistant 说过的那句「C012 有 1 张发票,199 元」。**裁掉的内容就是真的没了。** 这个 `trim` 只能叫「能发出去的最小裁剪」,真正在长任务里保留信息,要靠 Day 526 起的压缩和记忆。今天只记住一条规矩:裁剪的单位是组,不是条。

## 第四层:权限,每次执行前问一句

第一层末尾说了,预算拦不住这一步里发出去的调用。要拦一笔危险的退款,得在**执行之前**问一句「这个调用允许吗」。答案不是两种,是三种:放行、拒绝、等人批。

`s4_policy.py`:

```python
# agent-zero-lab/part10/harness/s4_policy.py
"""第四层:权限。每次执行工具之前问一句:放行、拒绝、还是等人批?"""
import json
from dataclasses import dataclass
from typing import Any, Literal


@dataclass
class Decision:
    verdict: Literal["allow", "deny", "ask"]
    reason: str = ""


class RefundPolicy:
    """查询类直接放;退款按金额分三档;没见过的工具默认拒绝。"""

    READ_ONLY = {"list_invoices"}

    def check(self, name: str, args: dict[str, Any]) -> Decision:
        if name in self.READ_ONLY:
            return Decision("allow")
        if name == "create_refund":
            amount = args.get("amount")
            if not isinstance(amount, int) or amount <= 0:
                return Decision("deny", f"退款金额必须是正整数,拿到 {amount!r}")
            if amount < 100:
                return Decision("allow", "小额,直接放行")
            if amount <= 1000:
                return Decision("ask", f"退款 {amount} 元,需要人批准")
            return Decision("deny", f"{amount} 元超过 1000 元,本助手无权发起")
        return Decision("deny", f"未登记的工具 {name}")


if __name__ == "__main__":
    p = RefundPolicy()
    for name, raw in [("list_invoices", '{"customer_id": "C007"}'),
                      ("create_refund", '{"invoice_id": "INV-2301", "amount": 50}'),
                      ("create_refund", '{"invoice_id": "INV-2291", "amount": 468}'),
                      ("create_refund", '{"invoice_id": "INV-2291", "amount": 5000}'),
                      ("create_refund", '{"invoice_id": "INV-2291", "amount": -468}'),
                      ("delete_customer", '{"customer_id": "C007"}')]:
        d = p.check(name, json.loads(raw))
        print(f"{name}({raw}) -> {d.verdict}  {d.reason}")
```

<div class="line-notes">

- `verdict: Literal["allow", "deny", "ask"]` 三种判决。`ask` 就是「暂停,等人」,是和 allow、deny 本质不同的第三种,它不是 deny 的一个变体。
- `READ_ONLY = {"list_invoices"}` 只读工具白名单。用集合,查找是 O(1),写起来也像「这几个我认识」。
- `if name in self.READ_ONLY:` 查询类直接放行。
- `if not isinstance(amount, int) or amount <= 0:` 金额必须是正整数。模型可能传字符串 `"468"` 或负数,这里统一拒。`isinstance` 相当于 JS 的 `typeof`,但更严格。
- `if amount < 100:` 小额直接放行,这是业务规则,数字是我设的。
- `if amount <= 1000:` 100 到 1000 元,返回 `ask`。我们的 468 元重复扣款会落到这一档。
- `return Decision("deny", f"{amount} 元超过 1000 元,本助手无权发起")` 超过 1000 一律拒,连人工批准的入口都不开。
- `return Decision("deny", f"未登记的工具 {name}")` 没见过的工具默认拒绝。这是「默认拒绝」原则:新加了工具却忘了登记权限,结果是用不了,而不是随便用。

</div>

```bash
uv run python -m part10.harness.s4_policy
```

```text
list_invoices({"customer_id": "C007"}) -> allow  
create_refund({"invoice_id": "INV-2301", "amount": 50}) -> allow  小额,直接放行
create_refund({"invoice_id": "INV-2291", "amount": 468}) -> ask  退款 468 元,需要人批准
create_refund({"invoice_id": "INV-2291", "amount": 5000}) -> deny  5000 元超过 1000 元,本助手无权发起
create_refund({"invoice_id": "INV-2291", "amount": -468}) -> deny  退款金额必须是正整数,拿到 -468
delete_customer({"customer_id": "C007"}) -> deny  未登记的工具 delete_customer
```

六个例子:查询放行,50 元放行,468 元要人批,5000 元拒,负数拒,没登记的 `delete_customer` 拒。判断依据全是工具名加参数,不看模型怎么解释。**权限判断放在代码里,不放在提示词里**,提示词里写「超过 1000 元不要退款」是请求,代码里写是规矩。

## 第五层:钩子,关键时刻通知外面

日志、计费、审计、风控都需要在「工具调用前后」「运行结束」这些时刻知道发生了什么。如果每加一项就改核心循环,循环会越来越胖。钩子的做法是:循环只负责在关键时刻喊一声(`emit`),谁关心谁订阅(`on`)。

`s5_hooks.py` 里有两个设计决定,都是踩过坑才加的:给钩子的是数据的**拷贝**,钩子里抛的错被接住、记下来、不往外传。

```python
# agent-zero-lab/part10/harness/s5_hooks.py
"""第五层:钩子。关键时刻通知外面,日志、计费、审计都挂在这里,不进核心循环。"""
import copy
import json
import time
from collections import defaultdict
from collections.abc import Callable
from pathlib import Path
from typing import Any

Hook = Callable[[dict[str, Any]], None]


class Hooks:
    def __init__(self) -> None:
        self._subs: dict[str, list[Hook]] = defaultdict(list)
        self.errors: list[str] = []

    def on(self, event: str, fn: Hook) -> None:
        self._subs[event].append(fn)

    def emit(self, event: str, **data: Any) -> None:
        for fn in self._subs[event]:
            try:
                fn({"event": event, **copy.deepcopy(data)})  # 给钩子一份拷贝:它改了也影响不到循环
            except Exception as e:  # 钩子写坏了,不能把主流程带崩
                self.errors.append(f"{event}/{fn.__name__}: {type(e).__name__}: {e}")


def jsonl_logger(path: Path) -> Hook:
    def log(data: dict[str, Any]) -> None:
        row = {"ts": round(time.time(), 3), **data}
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    return log


if __name__ == "__main__":
    out = Path("out/tool_calls.jsonl")
    out.parent.mkdir(exist_ok=True)
    out.unlink(missing_ok=True)

    def buggy(data: dict[str, Any]) -> None:
        data["args"]["amount"] = 1  # 想改参数,改的只是拷贝
        raise RuntimeError("钩子里写了个 bug")

    h = Hooks()
    h.on("before_tool", jsonl_logger(out))
    h.on("before_tool", buggy)
    args = {"invoice_id": "INV-2291", "amount": 468}
    h.emit("before_tool", name="create_refund", args=args)
    print("原来的 args:", args)
    print("钩子报的错:", h.errors)
    print("日志文件:", out.read_text(encoding="utf-8").strip())
```

<div class="line-notes">

- `Hook = Callable[[dict[str, Any]], None]` 钩子的类型:收一个字典,不返回东西。注意没有返回值,钩子只能「听」不能「改」,想改行为请去第四层写权限策略。
- `self._subs: dict[str, list[Hook]] = defaultdict(list)` `defaultdict(list)` 访问不存在的键时自动建一个空列表,所以 `on` 里不用先判断。
- `fn({"event": event, **copy.deepcopy(data)})` 两件事:`deepcopy` 给钩子一份完整拷贝,钩子里怎么改都影响不到循环;顺手把事件名也塞进字典,一个日志函数订阅好几个事件时能分辨。`**` 是字典展开,相当于 JS 的 `{...obj}`。
- `except Exception as e:  # 钩子写坏了,不能把主流程带崩` 一个写坏的监控钩子不该让客户的退款失败。错误记进 `self.errors`,事后查。
- `row = {"ts": round(time.time(), 3), **data}` 日志行加时间戳,保留三位小数(毫秒)。
- `with path.open("a", encoding="utf-8") as f:` `"a"` 是追加模式。每行一个 JSON(叫 JSONL),方便 `grep` 和逐行读。
- `data["args"]["amount"] = 1  # 想改参数,改的只是拷贝` 这个有 bug 的钩子故意想把金额改成 1,看会不会生效。
- `h.on("before_tool", jsonl_logger(out))` 同一个事件挂了两个钩子:一个正常的日志,一个有 bug 的。第一个照常写文件,第二个的异常被接住。

</div>

```bash
uv run python -m part10.harness.s5_hooks
```

```text
原来的 args: {'invoice_id': 'INV-2291', 'amount': 468}
钩子报的错: ['before_tool/buggy: RuntimeError: 钩子里写了个 bug']
日志文件: {"ts": 1793105013.255, "event": "before_tool", "name": "create_refund", "args": {"invoice_id": "INV-2291", "amount": 468}}
```

`原来的 args` 里 `amount` 还是 468,钩子改的只是拷贝;`钩子报的错` 记下了那个 `RuntimeError`;日志文件里照常有一行(`ts` 和 `event` 是运行时填的,每次的 `ts` 不同)。

钩子很容易被滥用。能改参数、能拦截以后,它会变成「第二套业务逻辑」,出了事没人知道是哪个钩子改的。我的规矩是钩子只读,会改变行为的逻辑集中放在权限策略这种有名字的地方。

## 第六层:子 Agent,说穿了是一个工具

[Day 267](/blog/agent-zero/day-267-subagent-isolation/) 讲过子 Agent 的收益:翻资料的脏活在它自己的消息列表里做,主 Agent 只拿回一段结论。放到 harness 的视角看,它没有任何新机制,**就是一个工具,函数体里又跑了一个循环**。

`s6_subagent.py` 用剧本模型演示:主 Agent 有一个叫 `research` 的工具,调用它时子 Agent 自己查了两次发票,最后交回一句话。

```python
# agent-zero-lab/part10/harness/s6_subagent.py
"""第六层:子 Agent。说穿了就是一个工具,函数体里又跑了一个循环,只把结论交回来。"""
from collections.abc import Callable
from typing import Any

from part10.harness.fake import Chatter, Reply, Scripted, call, say
from part10.harness.s1_stop import run
from part10.harness.tools import FUNCS, TOOL_SPECS


def make_subagent(client: Chatter, system: str) -> tuple[Callable[[str], str], list[int]]:
    sizes: list[int] = []  # 每次子 Agent 跑完,记下它自己的消息条数

    def research(task: str) -> str:
        msgs: list[dict[str, Any]] = [{"role": "system", "content": system}, {"role": "user", "content": task}]
        o = run(client, msgs, TOOL_SPECS, FUNCS, max_steps=4)
        sizes.append(len(o.messages))
        return o.answer if o.reason == "done" else f"(子 Agent 没做完,停在 {o.reason})"
    return research, sizes


if __name__ == "__main__":
    child = Scripted([
        Reply(call("list_invoices", '{"customer_id": "C007"}', "k1")),
        Reply(call("list_invoices", '{"customer_id": "C012"}', "k2")),
        Reply(say("C007 在 2026-09-03 有两张 468 元的发票(INV-2290、INV-2291),疑似重复扣款。")),
    ])
    research, sizes = make_subagent(child, "你是账务调研员。")
    parent = Scripted([
        Reply(call("research", '{"task": "查 C007 9 月有没有重复扣款"}', "p1")),
        Reply(say("查到了:INV-2290 和 INV-2291 重复,建议退 INV-2291。")),
    ])
    o = run(parent, [{"role": "user", "content": "C007 说被扣了两次"}], TOOL_SPECS, {"research": research})
    print("主 Agent 最终消息条数:", len(o.messages), "| 回答:", o.answer)
    print("子 Agent 自己的消息条数:", sizes)
    print("主 Agent 看到的子 Agent 结果:", o.messages[2]["content"])
```

<div class="line-notes">

- `def make_subagent(client: Chatter, system: str) -> tuple[Callable[[str], str], list[int]]:` 工厂函数,返回两样东西:`research` 这个工具函数,和一个记账的列表。返回类型 `tuple[...]` 相当于 TS 的元组。
- `sizes: list[int] = []` 每次子 Agent 跑完,把它自己消息列表的长度记下来,好和主 Agent 的对比。
- `def research(task: str) -> str:` 闭包,能访问外层的 `client` 和 `system`。就是 JS 的闭包。
- `o = run(client, msgs, TOOL_SPECS, FUNCS, max_steps=4)` 子 Agent 的循环就是 s1 的 `run`,步数上限收得更紧(4)。子 Agent 也要有刹车,不然它能把主 Agent 拖进死循环。
- `return o.answer if o.reason == "done" else f"(子 Agent 没做完,停在 {o.reason})"` 子 Agent 没做完时,不要返回空字符串,要把停下的原因告诉主 Agent,否则主 Agent 会当成「查完了,没有结果」。
- `Reply(call("list_invoices", '{"customer_id": "C012"}', "k2")),` 子 Agent 的剧本:查 C007、查 C012、再给结论,共三次模型调用。
- `o = run(parent, [{"role": "user", "content": "C007 说被扣了两次"}], TOOL_SPECS, {"research": research})` 主 Agent 的 `funcs` 里只有一个 `research`,它完全不知道子 Agent 内部查了什么。
- `print("主 Agent 看到的子 Agent 结果:", o.messages[2]["content"])` 主 Agent 的第 3 条消息(下标 2)就是 tool 结果,里面只有那句结论。

</div>

```bash
uv run python -m part10.harness.s6_subagent
```

```text
主 Agent 最终消息条数: 4 | 回答: 查到了:INV-2290 和 INV-2291 重复,建议退 INV-2291。
子 Agent 自己的消息条数: [7]
主 Agent 看到的子 Agent 结果: C007 在 2026-09-03 有两张 468 元的发票(INV-2290、INV-2291),疑似重复扣款。
```

主 Agent 的消息列表只有 4 条(user、带 `research` 调用的 assistant、tool 结果、最终回答),子 Agent 自己有 7 条(system、user、三次 assistant、两次 tool)。那 3 条中间过程没有进主上下文。

这里有两个后果要认。一是主 Agent 拿不到原始数据,子 Agent 说错了没法复核,所以子 Agent 的结论里最好带可追查的标识(这里是发票号 INV-2290、INV-2291)。二是**权限要一起设计**:子 Agent 如果能调 `create_refund`,它的调用有没有走第四层?在今天的写法里,子 Agent 调的是 s1 的 `run`,什么都没拦。Day 525 会处理这件事。

## 第七层:状态持久化,把「跑到哪了」存成文件

前面六层都假设进程一直活着。但「等人审批」可能要几个小时,这期间进程可能被重启、被部署覆盖、被机器回收。要撑过这些,循环必须能把「现在跑到哪了」存下来,以后读回来接着跑。

要存什么?回头看 s1 的 `run()`:一次运行的状态就是那几个变量,消息列表、已经调了几次模型、已经花了多少 token。再加两样:这一步里还没执行完的工具调用(`todo`),和人对某个调用批准或拒绝的记录(`approvals`)。

```python
# agent-zero-lab/part10/harness/s7_state.py
"""第七层:状态持久化。跑到哪一步、消息列表、还没执行的工具调用,都存成一个 JSON 文件。"""
import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class State:
    messages: list[dict[str, Any]]
    step: int = 0                                                # 已经调过几次模型
    used: int = 0                                                # 已经花了多少 token
    todo: list[dict[str, Any]] = field(default_factory=list)     # 模型要的、还没执行完的工具调用
    approvals: dict[str, bool] = field(default_factory=dict)     # tool_call_id -> 人批了还是拒了


def save(path: Path, st: State) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(asdict(st), ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, path)  # 原子替换:读的人要么看到旧文件,要么看到新文件,不会看到写了一半的


def load(path: Path) -> State:
    return State(**json.loads(path.read_text(encoding="utf-8")))
```

<div class="line-notes">

- `@dataclass` 把类变成「带字段的数据袋」,自动生成 `__init__`。相当于 TS 的 `interface` 加一个构造函数。
- `step: int = 0                                                # 已经调过几次模型` 带默认值的字段必须写在没默认值的字段后面,所以 `messages` 在最前。
- `todo: list[dict[str, Any]] = field(default_factory=list)` 可变默认值(列表)必须用 `field(default_factory=list)`,不能直接写 `= []`,否则所有实例共用同一个列表。这是 Python 最经典的坑之一。
- `approvals: dict[str, bool] = field(default_factory=dict)` 键是 `tool_call_id`,值是 True(批准)或 False(拒绝)。
- `tmp = path.with_suffix(".tmp")` 先写到 `run_a.tmp`,不直接写目标文件。
- `os.replace(tmp, path)` 原子替换。写文件写到一半进程被杀,目标文件要么是旧的完整版本,要么是新的完整版本,不会是半截 JSON。这一行是「存档」和「存档损坏」的分界线。
- `return State(**json.loads(path.read_text(encoding="utf-8")))` 读回来用 `**` 把字典展开成关键字参数,正好对上 dataclass 的字段名。

</div>

## 拼起来:mini_harness.py

七层都有了。拼的时候只有两件新事:一个驱动循环 `_drive` 把状态存在每个关键点,一个 `_run_todo` 按顺序执行工具调用,遇到「要人批」就存档并返回。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="mini_harness 一圈的流程:调模型,拿到工具调用放进待办,逐个过权限,放行就执行并存档,要人批就存档后暂停,批准后从文件恢复接着跑">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11" text-anchor="middle">
    <rect x="20" y="30" width="110" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="75" y="54" fill="var(--ink)">调模型(裁剪)</text>
    <rect x="160" y="30" width="110" height="40" rx="4" fill="none" stroke="var(--ink-soft)"/><text x="215" y="54" fill="var(--ink)">todo 队列</text>
    <rect x="300" y="30" width="110" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="355" y="54" fill="var(--ink)">权限判断</text>
    <rect x="440" y="30" width="110" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="495" y="54" fill="var(--ink)">工具层执行</text>
    <rect x="440" y="110" width="110" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="495" y="134" fill="var(--ink)">存档 JSON</text>
    <rect x="300" y="170" width="110" height="40" rx="4" fill="none" stroke="var(--ink-soft)" stroke-dasharray="4 3"/><text x="355" y="194" fill="var(--ink)">暂停(ask)</text>
    <rect x="160" y="170" width="110" height="40" rx="4" fill="none" stroke="var(--ink-soft)" stroke-dasharray="4 3"/><text x="215" y="194" fill="var(--ink)">resume(批/拒)</text>
    <text x="520" y="90" fill="var(--ink-faint)" font-size="10">钩子在每个箭头上 emit</text>
  </g>
  <g stroke="var(--rule)" fill="none" stroke-width="1.5">
    <line x1="130" y1="50" x2="160" y2="50"/><line x1="270" y1="50" x2="300" y2="50"/><line x1="410" y1="50" x2="440" y2="50"/>
    <line x1="495" y1="70" x2="495" y2="110"/><line x1="355" y1="70" x2="355" y2="170"/><line x1="300" y1="190" x2="270" y2="190"/>
    <line x1="215" y1="170" x2="215" y2="70"/><line x1="440" y1="130" x2="75" y2="130"/><line x1="75" y1="130" x2="75" y2="70"/>
  </g>
</svg>
<figcaption>一圈的流程。工具执行后存档,回到调模型;权限判断为 ask 时存档并暂停,以后读文件、带上人的决定,从 todo 队列的队首继续。</figcaption>
</figure>

```python
# agent-zero-lab/part10/harness/mini_harness.py
"""把今天七层拼在一起:循环刹车、工具层、上下文裁剪、权限、钩子、状态。子 Agent 当工具挂上来。"""
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from part10.harness.fake import Chatter
from part10.harness.s2_tools import Registry
from part10.harness.s3_context import trim
from part10.harness.s4_policy import RefundPolicy
from part10.harness.s5_hooks import Hooks
from part10.harness.s7_state import State, load, save

Reason = Literal["done", "max_steps", "budget", "needs_approval"]


@dataclass
class Outcome:
    reason: Reason
    answer: str
    state: State


class MiniHarness:
    def __init__(self, client: Chatter, tools: list[dict[str, Any]], registry: Registry,
                 policy: RefundPolicy, hooks: Hooks | None = None, state_path: Path | None = None,
                 max_steps: int = 8, max_tokens: int = 20000, keep_groups: int = 8) -> None:
        self.client, self.tools, self.registry, self.policy = client, tools, registry, policy
        self.hooks = hooks or Hooks()
        self.state_path = state_path
        self.max_steps, self.max_tokens, self.keep_groups = max_steps, max_tokens, keep_groups

    def start(self, system: str, user: str) -> Outcome:
        st = State(messages=[{"role": "system", "content": system}, {"role": "user", "content": user}])
        self.hooks.emit("run_start", user=user)
        return self._drive(st)

    def resume(self, approve: dict[str, bool] | None = None) -> Outcome:
        assert self.state_path is not None
        st = load(self.state_path)
        st.approvals.update(approve or {})
        return self._drive(st)

    def _save(self, st: State) -> None:
        if self.state_path is not None:
            save(self.state_path, st)

    def _finish(self, reason: Reason, st: State, answer: str = "") -> Outcome:
        self._save(st)
        self.hooks.emit("run_end", reason=reason, steps=st.step, tokens=st.used)
        return Outcome(reason, answer, st)

    def _drive(self, st: State) -> Outcome:
        while True:
            if not st.todo:
                if st.step >= self.max_steps:
                    return self._finish("max_steps", st)
                r = self.client.chat(trim(st.messages, self.keep_groups), tools=self.tools, temperature=0)
                st.step += 1
                st.used += r.prompt_tokens + r.completion_tokens
                st.messages.append(r.message)
                st.todo = list(r.message.get("tool_calls") or [])
                self._save(st)
                if not st.todo:
                    return self._finish("done", st, r.content)
            if self._run_todo(st):
                return self._finish("needs_approval", st)
            if st.used >= self.max_tokens:
                return self._finish("budget", st)

    def _run_todo(self, st: State) -> bool:
        """依次执行 todo 里的工具调用。遇到要人批的就停下返回 True。"""
        while st.todo:
            tc = st.todo[0]
            name, raw = tc["function"]["name"], tc["function"]["arguments"]
            try:
                parsed = json.loads(raw or "{}")
            except json.JSONDecodeError:
                parsed = None
            if isinstance(parsed, dict):
                d = self.policy.check(name, parsed)
                if d.verdict == "ask" and tc["id"] not in st.approvals:
                    self.hooks.emit("approval_needed", name=name, args=parsed, reason=d.reason)
                    self._save(st)
                    return True
                if d.verdict == "deny" or (d.verdict == "ask" and not st.approvals[tc["id"]]):
                    why = d.reason if d.verdict == "deny" else "人工审批没有通过,不要重试这笔操作"
                    result = f"拒绝执行:{why}"
                else:
                    self.hooks.emit("before_tool", name=name, args=parsed)
                    result = self.registry.execute(name, raw)
            else:
                result = self.registry.execute(name, raw)  # 交给工具层生成统一的报错
            self.hooks.emit("after_tool", name=name, result_chars=len(result))
            st.messages.append({"role": "tool", "tool_call_id": tc["id"], "content": result})
            st.todo.pop(0)
            self._save(st)
        return False
```

<div class="line-notes">

- `Reason = Literal["done", "max_steps", "budget", "needs_approval"]` 比 s1 多一种结束原因 `needs_approval`:不是失败也不是完成,是「等人」。
- `class Outcome:` 返回值里带完整的 `state`,调用方想看待办是什么、消息列表什么样,直接取。
- `def start(self, system: str, user: str) -> Outcome:` 开一次新运行:建初始状态、通知 `run_start` 钩子、进入驱动循环。
- `def resume(self, approve: dict[str, bool] | None = None) -> Outcome:` 从文件恢复。`approve` 是「tool_call_id 到批准与否」,合并进状态里再继续。
- `assert self.state_path is not None` 没配存档路径就不能恢复。`assert` 在这里同时是给类型检查器看的:往下 `state_path` 就是 `Path` 了。
- `def _finish(self, reason: Reason, st: State, answer: str = "") -> Outcome:` 所有出口统一走这里:存档、发 `run_end` 钩子、返回。出口只有一个,好处是不会漏存。
- `if not st.todo:` 待办队列空了才调模型,否则先把待办做完。恢复时 `todo` 不空,就直接接着执行,不会重新问模型。
- `r = self.client.chat(trim(st.messages, self.keep_groups), tools=self.tools, temperature=0)` 第三层在这里:每次发给模型的是裁剪后的消息,但 `st.messages` 保留完整历史。
- `st.todo = list(r.message.get("tool_calls") or [])` 模型这一步要的所有工具调用放进待办。一个 assistant 消息可以带多个调用。
- `self._save(st)` 第七层在这里:模型回复之后立刻存一次。此时 `todo` 有内容,崩了重启能知道要做什么。
- `if self._run_todo(st):` 返回 True 表示停在审批上。
- `if st.used >= self.max_tokens:` 预算检查,放在一步的工具都执行完之后,和 s1 一样。
- `d = self.policy.check(name, parsed)` 第四层在这里:参数解出来才能判断;解不出来(`parsed` 是 `None`)就跳过权限、交给工具层生成统一的报错。
- `if d.verdict == "ask" and tc["id"] not in st.approvals:` 要人批,而且还没有人的决定:发 `approval_needed` 钩子、存档、返回 True。
- `if d.verdict == "deny" or (d.verdict == "ask" and not st.approvals[tc["id"]]):` 拒绝有两种来源:策略直接拒,或者人批了「否」。两种都给模型一句「拒绝执行」的 tool 消息,让它能向客户解释。
- `why = d.reason if d.verdict == "deny" else "人工审批没有通过,不要重试这笔操作"` 末尾那句「不要重试」是写给模型的,不然它可能换个说法又调一次。
- `self.hooks.emit("before_tool", name=name, args=parsed)` 第五层在这里:只有真的要执行的调用才发 `before_tool`。
- `result = self.registry.execute(name, raw)` 第二层在这里:所有出错在这里被翻成文字。
- `st.messages.append({"role": "tool", "tool_call_id": tc["id"], "content": result})` 结果放回消息列表,`tool_call_id` 要和 assistant 消息里那个对上。
- `st.todo.pop(0)` 这个调用做完了,从队首弹出。然后立刻存档:这一行和上一行之间崩掉,就是后面「崩在副作用之后」的窗口。

</div>

零件对照表,方便你回头查每一层现在住在哪:

| 层 | 小脚本 | 在 `mini_harness.py` 里 |
| --- | --- | --- |
| 1 循环 | `s1_stop.py` 的 `run()` | `_drive` 里的 `max_steps`、`max_tokens` 检查和 `_finish` |
| 2 工具层 | `s2_tools.py` 的 `Registry` | `_run_todo` 里的 `self.registry.execute` |
| 3 上下文 | `s3_context.py` 的 `trim` | `_drive` 里发给模型前的 `trim(...)` |
| 4 权限 | `s4_policy.py` 的 `RefundPolicy` | `_run_todo` 里的 `self.policy.check` 和三种判决的分支 |
| 5 钩子 | `s5_hooks.py` 的 `Hooks` | `emit` 的五处:`run_start`、`before_tool`、`after_tool`、`approval_needed`、`run_end` |
| 6 子 Agent | `s6_subagent.py` | 没有拼进来,它只是挂在 `funcs` 里的一个工具,Day 525 再处理它的权限 |
| 7 状态 | `s7_state.py` 的 `State`、`save`、`load` | `_save` 调用的六处,和 `resume` |

### 用剧本模型把每条路径走一遍

`s8_fake_run.py` 用剧本模型走审批通过、审批拒绝两条路径(崩溃路径在下一节)。这段代码比较长,我只把关键的四处贴出来,完整文件见 `agent-zero-lab/part10/harness/s8_fake_run.py`:

```python
# agent-zero-lab/part10/harness/s8_fake_run.py
"""用剧本模型把 mini_harness 的几条路径都走一遍:审批通过、审批拒绝、崩溃后恢复(含一个坑)。"""
from pathlib import Path
from typing import Any

from part10.harness import tools
from part10.harness.fake import Reply, Scripted, call, say
from part10.harness.mini_harness import MiniHarness
from part10.harness.s2_tools import Registry
from part10.harness.s4_policy import RefundPolicy
from part10.harness.s5_hooks import Hooks, jsonl_logger
from part10.harness.tools import FUNCS, TOOL_SPECS

OUT = Path("out")
OUT.mkdir(exist_ok=True)


def script() -> Scripted:
    return Scripted([
        Reply(call("list_invoices", '{"customer_id": "C007"}', "a1")),
        Reply(call("create_refund", '{"invoice_id": "INV-2291", "amount": 468}', "a2")),
        Reply(say("已处理。")),
    ])


def make(client: Scripted, path: Path, funcs: dict[str, Any] = FUNCS, hooks: Hooks | None = None) -> MiniHarness:
    return MiniHarness(client, TOOL_SPECS, Registry(funcs), RefundPolicy(), hooks, path)


print("== A 审批通过")
path = OUT / "run_a.json"
path.unlink(missing_ok=True)
tools.REFUNDS.clear()
log = OUT / "events_a.jsonl"
log.unlink(missing_ok=True)
hooks = Hooks()
for ev in ("before_tool", "approval_needed", "run_end"):
    hooks.on(ev, jsonl_logger(log))
o = make(script(), path, hooks=hooks).start("你是客服助手。", "C007 被扣了两次,退掉重复的")
print("第一次:", o.reason, "| 待办:", [t["function"]["name"] for t in o.state.todo], "| 退款流水:", tools.REFUNDS)
# 换一个新的 harness 对象、新的剧本(从第二条回复开始),模拟「进程重启」后读文件继续
client2 = Scripted([Reply(say("已处理。"))])
o = make(client2, path, hooks=hooks).resume({"a2": True})
print("批准后:", o.reason, "|", o.answer, "| 退款流水:", tools.REFUNDS)
print("事件日志:")
for line in log.read_text(encoding="utf-8").splitlines():
    print("  ", line)

print("== B 审批拒绝")
path = OUT / "run_b.json"
path.unlink(missing_ok=True)
tools.REFUNDS.clear()
make(script(), path).start("你是客服助手。", "C007 被扣了两次,退掉重复的")
o = make(Scripted([Reply(say("这笔退款没有批准,已转人工。"))]), path).resume({"a2": False})
print(o.reason, "|", o.answer, "| 退款流水:", tools.REFUNDS)
print("工具消息:", o.state.messages[-2]["content"])
```

<div class="line-notes">

- `def script() -> Scripted:` 剧本:第一步查发票,第二步申请退款(会被权限拦成 `ask`),第三步说「已处理」。
- `def make(client: Scripted, path: Path, funcs: dict[str, Any] = FUNCS, hooks: Hooks | None = None) -> MiniHarness:` 每次都新建一个 `MiniHarness` 对象,模拟「进程重启后重新构造」。
- `hooks.on(ev, jsonl_logger(log))` 同一个日志钩子订阅三个事件。
- `o = make(script(), path, hooks=hooks).start("你是客服助手。", "C007 被扣了两次,退掉重复的")` 第一次运行,走到 `create_refund` 会停。
- `client2 = Scripted([Reply(say("已处理。"))])` 恢复时换一个新的剧本,只含最后一句话。因为恢复不会重新问模型要不要退款,它直接执行待办里那一条,然后才问模型。
- `o = make(client2, path, hooks=hooks).resume({"a2": True})` 批准 `a2` 这个调用 id(剧本里退款调用的 id 就是 `a2`)。
- `o = make(Scripted([Reply(say("这笔退款没有批准,已转人工。"))]), path).resume({"a2": False})` 拒绝路径:同样的暂停,但批的是 False。

</div>

```bash
uv run python -m part10.harness.s8_fake_run
```

真实输出里 `ts` 是时间戳,每次不同:

```text
== A 审批通过
第一次: needs_approval | 待办: ['create_refund'] | 退款流水: []
批准后: done | 已处理。 | 退款流水: [{'invoice_id': 'INV-2291', 'amount': 468}]
事件日志:
   {"ts": 1793104788.863, "event": "before_tool", "name": "list_invoices", "args": {"customer_id": "C007"}}
   {"ts": 1793104788.865, "event": "approval_needed", "name": "create_refund", "args": {"invoice_id": "INV-2291", "amount": 468}, "reason": "退款 468 元,需要人批准"}
   {"ts": 1793104788.866, "event": "run_end", "reason": "needs_approval", "steps": 2, "tokens": 240}
   {"ts": 1793104788.866, "event": "before_tool", "name": "create_refund", "args": {"invoice_id": "INV-2291", "amount": 468}}
   {"ts": 1793104788.868, "event": "run_end", "reason": "done", "steps": 3, "tokens": 360}
== B 审批拒绝
done | 这笔退款没有批准,已转人工。 | 退款流水: []
工具消息: 拒绝执行:人工审批没有通过,不要重试这笔操作
```

A 路径:第一次停在 `needs_approval`,待办里是 `create_refund`,退款流水是空的,钱没动。换一个全新的 harness 对象读文件,批准后 `done`,流水里有一笔 468。事件日志把整个过程摊开了:`before_tool`(查发票)、`approval_needed`、第一次 `run_end`(原因 `needs_approval`,2 步)、第二个进程里的 `before_tool`(退款)、第二次 `run_end`(`done`,3 步)。注意第二次的 `tokens` 是 360,比第一次的 240 多:状态里存了 `used`,恢复后接着累加。

B 路径:批的是 False,流水还是空的,模型收到的 tool 消息是 `拒绝执行:人工审批没有通过,不要重试这笔操作`,最后回答里告诉客户转人工。

### 换成真模型

`s10_real_run.py` 和 s8 的结构一样,只是模型换成 `LLMClient`,而且分成两个**独立进程**:

```python
# agent-zero-lab/part10/harness/s10_real_run.py
"""真模型跑一遍完整的 mini_harness。分两个进程:第一次停在审批上,第二次批准后继续。
用法:  uv run python -m part10.harness.s10_real_run start
       uv run python -m part10.harness.s10_real_run approve   (或 reject)"""
import sys
from pathlib import Path

from common.llm import LLMClient
from part10.harness import tools
from part10.harness.mini_harness import MiniHarness
from part10.harness.s2_tools import Registry
from part10.harness.s4_policy import RefundPolicy
from part10.harness.s5_hooks import Hooks, jsonl_logger
from part10.harness.s7_state import load
from part10.harness.tools import FUNCS, TOOL_SPECS

PATH = Path("out/real_run.json")
SYSTEM = "你是云簿 CloudLedger 的客服助手。用工具查账、退款。回答要简短。"
USER = "我是 C007,9 月 3 号被扣了两次 468 元,把重复的那笔退给我。"

client = LLMClient()
hooks = Hooks()
log = Path("out/real_events.jsonl")
for ev in ("before_tool", "approval_needed", "run_end"):
    hooks.on(ev, jsonl_logger(log))
h = MiniHarness(client, TOOL_SPECS, Registry(FUNCS), RefundPolicy(), hooks, PATH)

if sys.argv[1] == "start":
    PATH.unlink(missing_ok=True)
    log.unlink(missing_ok=True)
    o = h.start(SYSTEM, USER)
else:
    ids = {tc["id"]: sys.argv[1] == "approve" for tc in load(PATH).todo[:1]}
    o = h.resume(ids)
print("reason:", o.reason, "| 回答:", o.answer)
print("待办:", [(t["id"], t["function"]["name"], t["function"]["arguments"]) for t in o.state.todo])
print("退款流水(本进程内):", tools.REFUNDS)
print(client.ledger)
```

<div class="line-notes">

- `PATH = Path("out/real_run.json")` 状态文件。两个进程靠它交接。
- `h = MiniHarness(client, TOOL_SPECS, Registry(FUNCS), RefundPolicy(), hooks, PATH)` `client` 直接传 `LLMClient`,因为它的 `chat` 满足 `Chatter`。
- `if sys.argv[1] == "start":` `sys.argv[1]` 是命令行第一个参数,相当于 Node 的 `process.argv[2]`。
- `ids = {tc["id"]: sys.argv[1] == "approve" for tc in load(PATH).todo[:1]}` 从文件里读出队首那个待办调用的 id,批准与否取决于命令行写的是 `approve` 还是 `reject`。这里的 id 是真模型生成的,所以得从文件里读,写不死。

</div>

```bash
uv run python -m part10.harness.s10_real_run start
uv run python -m part10.harness.s10_real_run approve
```

真实输出:

```text
reason: needs_approval | 回答: 
待办: [('call_00_Smn1IKAjlWrOQccBAxqx0454', 'create_refund', '{"invoice_id": "INV-2291", "amount": 468}')]
退款流水(本进程内): []
2 次调用 | 输入 945 / 输出 138 tokens | 约 ¥0.0017
reason: done | 回答: 已退款：发票 INV-2291，金额 468 元，退款单号 RF-1。到账时间以银行为准，通常 3–5 个工作日。
待办: []
退款流水(本进程内): [{'invoice_id': 'INV-2291', 'amount': 468}]
1 次调用 | 输入 672 / 输出 39 tokens | 约 ¥0.0007
```

两个进程各有自己的账本:第一个进程调了 2 次模型(查发票、申请退款),停在审批;第二个进程只调了 1 次(写最后的回复),退款是在第二个进程里执行的。`事件日志`(`out/real_events.jsonl`)有 5 行,和 s8 的结构一致。顺便说一句,「到账时间通常 3–5 个工作日」是模型自己编的,我们的工具没有返回过这个信息,这是 [Day 463](/blog/agent-zero/day-463-flow-e2e/) 那类质检要抓的问题,harness 管不到。

再跑一次拒绝路径:`start` 之后改用 `reject`,真实输出:

```text
reason: done | 回答: 退款没能成功：这笔操作需要人工审批，审批未通过，系统也不允许重试。

建议您联系人工客服核实重复扣款情况，由他们处理。抱歉没能直接帮您退成。
待办: []
退款流水(本进程内): []
1 次调用 | 输入 659 / 输出 43 tokens | 约 ¥0.0007
```

流水是空的,模型把拒绝如实告诉了客户,没有换个法子再退。

## 坑:崩在副作用之后

第七层有一个我必须当场演示的坑。存档发生在两个时刻:模型回复之后、每个工具执行完之后。那么进程在这两次存档**之间**崩掉呢?

`s9_crash.py` 模拟两种时刻。一个是工具函数一进来就崩(副作用还没发生),一个是退款已经写进流水之后才崩。`Crash` 继承 `BaseException`,不会被工具层的 `except Exception` 当成普通报错吞掉,这样才能模拟「进程被杀」。

```python
# agent-zero-lab/part10/harness/s9_crash.py
"""进程在两个不同的时刻崩掉,重启后读文件接着跑。第二种会重复退款。"""
from pathlib import Path
from typing import Any

from part10.harness import tools
from part10.harness.fake import Reply, Scripted, call, say
from part10.harness.mini_harness import MiniHarness
from part10.harness.s2_tools import Registry
from part10.harness.s4_policy import RefundPolicy
from part10.harness.s7_state import load
from part10.harness.tools import FUNCS, TOOL_SPECS


class Crash(BaseException):
    """模拟进程被杀。继承 BaseException,不会被工具层的 except Exception 当成普通报错吞掉。"""


def crashing_refund(when: str):
    def refund(invoice_id: str, amount: int) -> str:
        if when == "before":
            raise Crash()
        out = tools.create_refund(invoice_id, amount)  # 副作用已经发生
        raise Crash()
    return refund


def script() -> Scripted:
    return Scripted([Reply(call("create_refund", '{"invoice_id": "INV-2301", "amount": 50}', "r1"))])


for when in ("before", "after"):
    path = Path(f"out/crash_{when}.json")
    path.unlink(missing_ok=True)
    tools.REFUNDS.clear()
    funcs: dict[str, Any] = {**FUNCS, "create_refund": crashing_refund(when)}
    h = MiniHarness(script(), TOOL_SPECS, Registry(funcs), RefundPolicy(), state_path=path)
    try:
        h.start("你是客服助手。", "给 C012 退 50 元作补偿")
    except Crash:
        todo = [t["function"]["name"] for t in load(path).todo]
        print(f"[{when}] 进程崩了。文件里的待办:", todo, "| 退款流水:", tools.REFUNDS)
    h2 = MiniHarness(Scripted([Reply(say("退好了。"))]), TOOL_SPECS, Registry(FUNCS), RefundPolicy(), state_path=path)
    o = h2.resume()
    print(f"[{when}] 重启后:", o.reason, "| 退款流水:", tools.REFUNDS)
```

<div class="line-notes">

- `class Crash(BaseException):` 继承 `BaseException`。工具层的 `except Exception` 抓不到它,它会一路冒泡到最外层,就像进程被 `kill`。
- `def crashing_refund(when: str):` 返回一个会崩的假退款函数。`when` 是 `"before"` 或 `"after"`。
- `out = tools.create_refund(invoice_id, amount)  # 副作用已经发生` 先真的退了款,流水里多一条,然后才崩。
- `funcs: dict[str, Any] = {**FUNCS, "create_refund": crashing_refund(when)}` 用字典展开把真函数里的 `create_refund` 替换成会崩的那个。
- `todo = [t["function"]["name"] for t in load(path).todo]` 崩溃之后读存档文件,看里面记的待办是什么。
- `h2 = MiniHarness(Scripted([Reply(say("退好了。"))])` 重启:新对象、真的 `FUNCS`(不会再崩)、只含最后一句话的剧本。
- `o = h2.resume()` 不传批准信息,因为这笔 50 元的退款策略直接放行。

</div>

```bash
uv run python -m part10.harness.s9_crash
```

```text
[before] 进程崩了。文件里的待办: ['create_refund'] | 退款流水: []
[before] 重启后: done | 退款流水: [{'invoice_id': 'INV-2301', 'amount': 50}]
[after] 进程崩了。文件里的待办: ['create_refund'] | 退款流水: [{'invoice_id': 'INV-2301', 'amount': 50}]
[after] 重启后: done | 退款流水: [{'invoice_id': 'INV-2301', 'amount': 50}, {'invoice_id': 'INV-2301', 'amount': 50}]
```

`before` 的情况:崩了,文件里待办还有 `create_refund`,流水是空的;重启后执行,流水里一笔,正确。`after` 的情况:崩了,文件里**同样**写着待办还有 `create_refund`(因为存档在工具执行之后才发生,崩的时候还没轮到存),但流水里已经有一笔了;重启后看到待办,又执行一次,流水里变成**两笔**。同一张发票,退了两次。

这就是「至少一次」的语义:存档保证不丢事,不保证不重复。怎么做到「恰好一次」,是 Day 535 到 537 的主题([Day 535](/blog/agent-zero/day-535-durable-1/) 记日志然后重放,[Day 536](/blog/agent-zero/day-536-durable-2/) 讲 Agent 为什么让这件事变难)。今天先给一个最朴素的补丁,放进练习 1。

## 动手练习

### 练习 1:堵住重复退款

`s9` 里 `after` 的情况重复退款了。不改 `MiniHarness`,只改工具:给退款函数加一道检查,同一张发票退过了就不再退,而是原样告诉模型「已经退过」。再跑一次「崩在副作用之后」,确认流水里只有一笔。

<details><summary>参考答案</summary>

新建 `part10/harness/ex520_idem.py`:

```python
# agent-zero-lab/part10/harness/ex520_idem.py
"""练习 1:s9 的「崩在副作用之后」会重复退款。给退款工具加一道「这张发票退过没有」的检查。"""
import json
from pathlib import Path
from typing import Any

from part10.harness import tools
from part10.harness.fake import Reply, Scripted, call, say
from part10.harness.mini_harness import MiniHarness
from part10.harness.s2_tools import Registry
from part10.harness.s4_policy import RefundPolicy
from part10.harness.s7_state import load
from part10.harness.tools import FUNCS, TOOL_SPECS


class Crash(BaseException):
    pass


def safe_refund(invoice_id: str, amount: int) -> str:
    done = [r for r in tools.REFUNDS if r["invoice_id"] == invoice_id]
    if done:  # 退过了:原样告诉模型,不再退第二次
        return json.dumps({"already_refunded": True, "invoice_id": invoice_id, "amount": done[0]["amount"]})
    return tools.create_refund(invoice_id, amount)


crash_once = {"armed": True}


def crashing(invoice_id: str, amount: int) -> str:
    out = safe_refund(invoice_id, amount)
    if crash_once["armed"]:
        crash_once["armed"] = False
        raise Crash()  # 副作用发生之后才崩
    return out


path = Path("out/ex520_idem.json")
path.unlink(missing_ok=True)
tools.REFUNDS.clear()
s = Scripted([Reply(call("create_refund", '{"invoice_id": "INV-2301", "amount": 50}', "r1"))])
funcs: dict[str, Any] = {**FUNCS, "create_refund": crashing}
try:
    MiniHarness(s, TOOL_SPECS, Registry(funcs), RefundPolicy(), state_path=path).start("你是客服助手。", "给 C012 退 50 元作补偿")
except Crash:
    print("崩了。待办:", [t["function"]["name"] for t in load(path).todo], "| 退款流水:", tools.REFUNDS)
o = MiniHarness(Scripted([Reply(say("退好了。"))]), TOOL_SPECS, Registry(funcs), RefundPolicy(), state_path=path).resume()
print("重启后:", o.reason, "| 退款流水:", tools.REFUNDS)
print("模型看到的工具结果:", o.state.messages[-2]["content"])
```

<div class="line-notes">

- `def safe_refund(invoice_id: str, amount: int) -> str:` 带检查的退款。
- `done = [r for r in tools.REFUNDS if r["invoice_id"] == invoice_id]` 先查流水里这张发票退过没有。
- `return json.dumps({"already_refunded": True, "invoice_id": invoice_id, "amount": done[0]["amount"]})` 退过了就不再退,返回一个明确的「已经退过」。模型看到这个会如实告诉客户,而不是再试一次。
- `crash_once = {"armed": True}` 用一个字典当开关,让函数只在**第一次**被调用时崩。用字典是因为闭包里改列表和字典的内容不需要 `nonlocal`。
- `out = safe_refund(invoice_id, amount)` 崩之前先调带检查的退款,副作用发生。
- `crash_once["armed"] = False` 关掉开关,重启后同一个函数就不再崩。
- `raise Crash()  # 副作用发生之后才崩` 和 s9 的 `after` 一样。

</div>

```bash
uv run python -m part10.harness.ex520_idem
```

```text
崩了。待办: ['create_refund'] | 退款流水: [{'invoice_id': 'INV-2301', 'amount': 50}]
重启后: done | 退款流水: [{'invoice_id': 'INV-2301', 'amount': 50}]
模型看到的工具结果: {"already_refunded": true, "invoice_id": "INV-2301", "amount": 50}
```

崩溃之后文件里待办还有 `create_refund`,流水已经有一笔。重启后函数再被调用,检查发现 INV-2301 退过了,直接返回「已经退过」,流水里仍然是一笔。模型看到的工具结果是 `{"already_refunded": true, ...}`。

要说清这个补丁的局限:它靠「按发票号查流水」判断,只适合「同一张发票只能退一次」的业务;如果业务允许分多次退款,这个检查就是错的。真正通用的做法是给每次调用一个幂等键,让支付系统自己去重,这是 Day 536 的内容。

</details>

### 练习 2:把预算压到 300,看它停在哪

把 `max_tokens` 设成 300,问一个简单问题「帮我查一下 C012 有哪些发票」,用真模型跑。猜一猜它会在第几步停、消息列表长什么样、工具有没有被执行。

<details><summary>参考答案</summary>

新建 `part10/harness/ex520_budget.py`:

```python
# agent-zero-lab/part10/harness/ex520_budget.py
"""练习 2:把 token 预算压到 300,真模型会停在哪一步?"""
from pathlib import Path

from common.llm import LLMClient
from part10.harness import tools
from part10.harness.mini_harness import MiniHarness
from part10.harness.s2_tools import Registry
from part10.harness.s4_policy import RefundPolicy
from part10.harness.tools import FUNCS, TOOL_SPECS

client = LLMClient()
path = Path("out/ex520_budget.json")
h = MiniHarness(client, TOOL_SPECS, Registry(FUNCS), RefundPolicy(), state_path=path, max_tokens=300)
o = h.start("你是云簿 CloudLedger 的客服助手。用工具查账、退款。回答要简短。", "帮我查一下 C012 有哪些发票。")
print("reason:", o.reason, "| 已用 token:", o.state.used, "| 模型调用次数:", o.state.step)
print("消息角色:", [m["role"] for m in o.state.messages])
print("退款流水:", tools.REFUNDS)
print(client.ledger)
```

<div class="line-notes">

- `h = MiniHarness(client, TOOL_SPECS, Registry(FUNCS), RefundPolicy(), state_path=path, max_tokens=300)` 只改了 `max_tokens`。其他全是默认值。
- `o = h.start("你是云簿 CloudLedger 的客服助手。用工具查账、退款。回答要简短。", "帮我查一下 C012 有哪些发票。")` 一个只需要查一次的问题。
- `print("消息角色:", [m["role"] for m in o.state.messages])` 看消息的角色序列,就能知道停在哪一步。

</div>

```bash
uv run python -m part10.harness.ex520_budget
```

真实输出:

```text
reason: budget | 已用 token: 425 | 模型调用次数: 1
消息角色: ['system', 'user', 'assistant', 'tool']
退款流水: []
1 次调用 | 输入 385 / 输出 40 tokens | 约 ¥0.0006
```

第一次模型调用就花了 425 token(输入 385 加输出 40),超过 300,所以 harness 在**执行完那一步的工具之后**停下:消息列表里有 assistant(调 `list_invoices`)和 tool(结果),但没有最后那句给客户的回答。`reason` 是 `budget`,`answer` 是空字符串。

这是预算刹车的真实代价:它拦的是「下一次模型调用」,不是「这一次的工具调用」。我把 `max_tokens` 设成 500 时(早先试的),第一步花 425 没超,模型多调了一次,答完收工,`reason` 是 `done`。所以预算数字要比一次正常运行的开销大得多,才不会误伤正常请求。

</details>

### 练习 3:对号入座(开放题)

Day 267 的 `part04/harness.py` 有六块(Agent 循环、工具注册、上下文组装、状态持久化、执行环境和安全、可观测)。今天的 `mini_harness.py` 有七层。写一张表:Day 267 的每一块对应今天的哪一层?哪些东西 Day 267 有而今天没有?哪些今天有而 Day 267 没有?

<details><summary>参考答案</summary>

| Day 267 的块 | 对应今天的层 | 备注 |
| --- | --- | --- |
| Agent 循环 | 1 循环 | 今天多了 token 预算和 `needs_approval` 这个出口 |
| 工具注册 | 2 工具层 | 今天多了五类错误的统一翻译和 `InfraError` 例外 |
| 上下文组装 | 3 上下文管理(一半) | Day 267 的上下文组装包括取长期记忆、整理历史、拼 system;今天只有「裁剪」这一件 |
| 状态持久化 | 7 状态持久化 | Day 267 存的是会话历史;今天存的是整个运行状态(含待办和审批) |
| 执行环境和安全 | 4 权限 | Day 267 只有 `get_article` 的白名单;今天有三态判决 |
| 可观测 | 5 钩子 | Day 267 直接写轨迹文件;今天把「写日志」变成订阅者 |

Day 267 有而今天没有的:取长期记忆、总结压缩(Day 263/264 的零件)。今天有而 Day 267 没有的:第 6 层子 Agent 作为 harness 的组成部分(Day 267 的子 Agent 是单独一节,没有和权限、预算放在一起考虑)、人工审批的暂停与恢复。

这张表的意义是看到:**同一个东西,换一个切法会多出新问题。** 按「零件」切(Day 267),看不到权限和预算该管子 Agent;按「会出什么事」切(今天),这些缺口就浮出来了。

</details>

**验收标准**:`part10/harness/` 下有 `tools.py`、`fake.py`、`s1_stop.py` 到 `s10_real_run.py` 和三个练习文件,每一个都能跑;你能不看文章说出七层各自「没有它会怎么坏」;你的 `s9_crash.py` 在 `after` 情况下确实重复退款,练习 1 之后只退一笔;`out/real_events.jsonl` 里有 5 行事件日志。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| harness | 套在模型外面、让它能稳定干活的运行时:循环、工具层、上下文、权限、钩子、子 Agent、状态。例:Claude Code 去掉模型剩下的就是 harness([Day 267](/blog/agent-zero/day-267-subagent-isolation/) 首次出现) |
| 停止原因 | 一次运行为什么结束:`done`、`max_steps`、`budget`、`needs_approval`。把它放进返回值,调用方才能分别处理 |
| token 预算 | 一次运行最多花多少 token。比步数上限更直接,因为每步都要重发整个历史 |
| 工具层 | 找工具、解参数、执行、把出错翻成模型能读的话的那一层。例:`Registry.execute` |
| 基础设施故障 | 数据库连不上、下游 500 这类模型改参数没用的错。应该让运行失败、交给外面重试,不是翻成文字给模型 |
| 消息组 | 一条带 `tool_calls` 的 assistant 消息和它后面所有的 tool 消息。裁剪的最小单位 |
| 权限判决 | 工具调用前的三种结果:allow(放行)、deny(拒绝)、ask(暂停等人) |
| 默认拒绝 | 没登记过的工具一律拒绝,新工具必须显式放行 |
| 钩子 | 在关键时刻被调用的回调,用于日志、计费、审计。今天的钩子只读 |
| JSONL | 每行一个 JSON 的文本格式,方便追加和逐行读 |
| 子 Agent | 函数体里跑着另一个循环的工具,有自己的消息列表,只交回结论 |
| 待办队列(`todo`) | 模型这一步要的、还没执行完的工具调用。存档时一起存,恢复后先做完它们 |
| 原子替换 | 先写临时文件再 `os.replace`,让读文件的人看不到写了一半的内容 |
| 至少一次 | 存档保证事情不丢,但崩在副作用和存档之间会重复执行。要「恰好一次」需要幂等([Day 536](/blog/agent-zero/day-536-durable-2/)) |

## 常见误区

**以为 harness 就是框架的别名。** 框架是搭 harness 的库;harness 是最后跑起来的整套运行时,包括你写的权限规则、提示词约定和钩子。同一个框架可以搭出完全不同的 harness。明天读三家源码时会看到,有的框架连循环都不给你写。

**把预算当权限用。** 今天的练习 2 说明白了:预算是在工具执行之后才检查的,它拦的是下一次模型调用。想拦一笔危险的退款,必须在执行之前问权限。

**工具一报错就让整个运行失败。** 大部分工具错误模型自己能改,把错误翻成一句话还给它就好。只有基础设施故障才该让运行失败并重试。反过来也有坑:异常原文全给模型,有可能把内部路径带出去,这是取舍,不是对错。

**按条数裁剪消息。** 今天真踩了一次:`Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`。裁剪的单位是组。

**把所有逻辑都塞进钩子。** 钩子能改参数以后,它会变成第二套业务逻辑。让钩子只读,会改变行为的逻辑放在权限策略这种有名字的位置。

**以为存了档就不会重复执行。** 存档只保证不丢。崩在「副作用已经发生、存档还没写」之间,恢复后会再做一次。有副作用的工具要自己做幂等。

## 学习资料

### 文档与文章

- [Anthropic《Building agents with the Claude Agent SDK》](https://claude.com/blog/building-agents-with-the-claude-agent-sdk)(2025-09-29):把 SDK 说成「驱动 Claude Code 的 agent harness」,讲「收集上下文、采取行动、验证结果」那个循环。20 分钟。
- [Anthropic《Effective harnesses for long-running agents》](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents):跨很多上下文窗口的长任务怎么设计 harness。Day 522 精读,今天先扫一遍。
- [OpenAI Agents SDK 文档:Running agents](https://openai.github.io/openai-agents-python/running_agents/):看 `max_turns` 和循环那几段,明天读源码时对照。
- [Claude Agent SDK 文档](https://platform.claude.com/docs/en/agent-sdk/overview):看权限和钩子两部分。
- [humanlayer/12-factor-agents](https://github.com/humanlayer/12-factor-agents):把生产级 Agent 的原则写成 12 条,和今天的七层很多条能对上。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1t55v6DE2v&autoplay=0&high_quality=1" title="Agent和Harness到底是什么?一个动画彻底搞懂!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>轩辕的编程宇宙 · Agent和Harness到底是什么?一个动画彻底搞懂! · 约 13 分钟,动画讲 harness 的概念,适合在敲代码之前先建立直觉。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1FPArzkEaH&autoplay=0&high_quality=1" title="基于 Claude Agent SDK 打造 Agent 平台| Agent 平台化 上集|录屏精简版" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Koala聊开源 · 基于 Claude Agent SDK 打造 Agent 平台 · 约 8 分钟,一个团队用 Claude Agent SDK 做平台化的实践,可以看他们把哪些东西做成了平台能力。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/TqC1qOfiVcQ" title="Claude Agent SDK [Full Workshop] — Thariq Shihipar, Anthropic" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · Claude Agent SDK [Full Workshop] — Thariq Shihipar, Anthropic · Anthropic 工程师的完整工作坊。前半讲 harness 的设计理念,可以挑着看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/1a1VXDdIyrk" title="Agent Harness explained in 8min.." loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Caleb Writes Code · Agent Harness explained in 8min.. · 8 分钟英文概览,讲得直白。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):第 6 章讲 RAG 和 Agent,其中工具、规划和失败模式可以和今天的七层对照。
- Martin Kleppmann《Designing Data-Intensive Applications》(O'Reilly,2017),中文版《数据密集型应用系统设计》:不讲 Agent,但事件日志和状态重建的思路和第七层是一回事。今天的「至少一次」和「恰好一次」在书里对应流处理那一章。

### 开源项目与代码

- [openai/openai-agents-python](https://github.com/openai/openai-agents-python):明天读它的 `run.py` 和 `run_internal/`。
- [anthropics/claude-agent-sdk-python](https://github.com/anthropics/claude-agent-sdk-python):明天读它的 `types.py` 和 `_internal/query.py`。
- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):明天读它的 `pregel/_loop.py`。

## 自测

1. harness 的七层是什么?哪一层最容易被误认为不属于 harness?

<details><summary>答案</summary>

循环、工具层、上下文管理、权限、钩子、子 Agent、状态持久化。最容易被漏掉的是权限和钩子:很多人以为它们是「安全功能」「运维功能」,和 Agent 本身无关;但没有权限,Agent 只能靠提示词约束自己,没有钩子,每加一个日志都要改循环。

</details>

2. 为什么 token 预算要和步数上限同时设?今天哪个实验能证明?

<details><summary>答案</summary>

步数不等于钱:每一步都要把历史重发一遍,所以开销随步数增长得更快。`s1_stop.py` 里,同一个死循环,步数上限 5 时花 3100 token,放宽到 50 时烧到 107800 token;设预算 1500 则在第 4 步(2080 token)停下。

</details>

3. 工具层为什么要把基础设施故障和其他错误分开处理?

<details><summary>答案</summary>

模型传错参数、写错工具名,它看到报错能自己改,所以翻成文字还给它。数据库连不上这类故障,模型改什么参数都没用,把它翻成文字只会让模型反复重试、白白烧 token,所以应该让整个运行失败,交给外面的重试和告警。

</details>

4. 「系统消息加最近 3 条」的裁剪为什么会得到 400?正确的裁剪单位是什么?

<details><summary>答案</summary>

最近 3 条可能把带 `tool_calls` 的 assistant 消息切掉,只留下它的 tool 结果。DeepSeek 的报错是 `Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`。正确的单位是「组」:一条 assistant 消息加它后面紧跟的所有 tool 消息,整组留或整组丢。

</details>

5. 面试题:你的 Agent 有一个退款工具。请说出至少三道在代码里(而不是提示词里)的防线,并说明每一道拦的是哪种情况。

<details><summary>答案</summary>

(1)权限判决:执行前按工具名和参数判断,金额超限拒绝、中等金额等人批、未登记的工具默认拒绝,拦的是模型想做不该做的事。(2)工具层参数校验:金额必须是正整数、发票号存在,拦的是模型传错参数。(3)幂等检查:同一张发票退过了不再退,拦的是崩溃恢复或重试造成的重复执行。还可以加:token 预算(拦失控的循环,但拦不住已经发出去的那一步)、审计钩子(不拦,但事后能查)。答题时最好强调每一道各自拦什么,以及预算不能代替权限。

</details>

6. 存档文件为什么要用「先写临时文件再 `os.replace`」?只用 `write_text` 直接写有什么风险?

<details><summary>答案</summary>

直接写目标文件时,进程在写到一半被杀,文件会是半截 JSON,下次 `load` 抛 `JSONDecodeError`,整个运行丢失。`os.replace` 是原子操作:读文件的人要么看到旧的完整文件,要么看到新的完整文件。

</details>

## 明天预告

明天是 Day 521,Harness(二):读三家的源码。今天的 `mini_harness.py` 是 150 行、一个人写的 harness。OpenAI Agents SDK、Claude Agent SDK、LangGraph 是三家各自的取舍:同样的七层,它们的循环在哪、工具抛异常默认给模型看什么、暂停的状态存成什么样,明天用真源码和真实运行回答。其中有一个结果今天已经埋了伏笔:工具抛异常时,三家的默认行为完全不同。
