---
title: 'Day 335 · 第 48 周复习:MCP 与编排(Day 329–334)'
description: '这一周讲了多 Agent 该不该拆、三种拆法和七个框架。今天用一张知识地图把六天串起来,默写主管派活和防踢皮球的交接两段核心代码,再只用本周学的东西写一个「拆不拆、拆成什么」的小顾问,最后把这周十几个坑过一遍。全程不调模型,一分钱不花。'
pubDate: 2026-10-27
regime: none
tags: ['multi-agent', 'review', 'python', 'agent-zero']
series: 'agent-zero'
day: 335
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 334](/blog/agent-zero/day-334-frameworks-2/) 把七个框架接到同一个任务上量了一遍:请求数都是 3 次,花费 0.0042 到 0.0078 元,差别淹没在波动里;真正能拿来选型的是接模型顺不顺、关键参数传不传得进去、有没有你要的超时重试降级这类横切能力。末尾的面试三题,每一题都配了当天亲手拿到的证据。

这一周从头到尾只问了一个问题:一件事交给好几个 Agent,值不值。前三天拿数字回答「值不值」,后两天讲「用什么写」。今天停一天,把六天放到一张图上,自己默写两段核心代码,再写一个小顾问把这周的规则变成能跑的东西。

## 今天要解决的问题

学完今天,你应该能做到:

1. 合上文章,说出这周六天各解决什么问题,并把它们归到三条线上:该不该拆(329)、怎么拆(330、331、332)、用什么写(333、334)。
2. 默写一个能让主管同时派活的 Agent 循环(`TinyAgent`),跑出「总耗时等于最慢的那个专员」。
3. 默写带转手上限的专员交接图,跑出「转了两次没人接就转人工」。
4. 只用本周的规则写出 `split_advisor.py`:给一个场景,说出该用单 Agent、交接、主管还是 subagent,并给出估算。
5. 说出这周至少八个坑,每个都能讲出真实报错或真实现象。

预计用时 3.5 小时:知识地图和回顾 30 分钟,两段默写各 30 分钟,小项目 1 小时,剩下做练习和自测。前置:[Day 329](/blog/agent-zero/day-329-multi-agent-1/) 到 [Day 334](/blog/agent-zero/day-334-frameworks-2/) 全部。今天所有脚本都不调模型,一分钱不花。

学法和平时一样:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章,把两段默写代码再写一遍;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 336" role="img" aria-label="第 48 周知识地图:最上面是 Day 329 拆之前先问两个问题,中间三个方框分别是主管派活、专员交接和 subagent,最下面是 Day 333 到 334 的框架横评">
  <rect x="0" y="0" width="640" height="336" fill="var(--paper-raised)"/>
  <rect x="16" y="14" width="608" height="52" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="28" y="35" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Day 329 · 拆之前先问两个问题</text>
  <text x="28" y="55" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">有先后依赖吗?有共同要拍板的决定吗?都没有,才轮到下面三种拆法</text>
  <g stroke="var(--ink-soft)" fill="none">
    <line x1="111" y1="66" x2="111" y2="92"/><line x1="320" y1="66" x2="320" y2="92"/><line x1="529" y1="66" x2="529" y2="92"/>
  </g>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="16" y="92" width="190" height="110" rx="5" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
    <text x="26" y="112" font-size="12" fill="var(--ink)">Day 330 主管派活</text>
    <text x="26" y="132" fill="var(--ink-soft)">专员 = 主管的工具</text>
    <text x="26" y="148" fill="var(--ink-soft)">并行看最慢的那个</text>
    <text x="26" y="164" fill="var(--ink-soft)">坏在交接:编年份</text>
    <text x="26" y="180" fill="var(--ink-faint)">实测 token 约 2.4 倍</text>
    <rect x="225" y="92" width="190" height="110" rx="5" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
    <text x="235" y="112" font-size="12" fill="var(--ink)">Day 331 专员交接</text>
    <text x="235" y="132" fill="var(--ink-soft)">谁在线谁回复用户</text>
    <text x="235" y="148" fill="var(--ink-soft)">共享完整历史</text>
    <text x="235" y="164" fill="var(--ink-soft)">踢皮球要设上限</text>
    <text x="235" y="180" fill="var(--ink-faint)">接手方会以为自己是转出方</text>
    <rect x="434" y="92" width="190" height="110" rx="5" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
    <text x="444" y="112" font-size="12" fill="var(--ink)">Day 332 subagent</text>
    <text x="444" y="132" fill="var(--ink-soft)">拆的是上下文,不是人</text>
    <text x="444" y="148" fill="var(--ink-soft)">结论是有损压缩</text>
    <text x="444" y="164" fill="var(--ink-soft)">大结果加长对话才划算</text>
    <text x="444" y="180" fill="var(--ink-faint)">嵌套深度要设上限</text>
  </g>
  <g stroke="var(--compute)" fill="none" stroke-dasharray="3 3">
    <line x1="111" y1="202" x2="111" y2="226"/><line x1="320" y1="202" x2="320" y2="226"/><line x1="529" y1="202" x2="529" y2="226"/>
  </g>
  <rect x="16" y="226" width="608" height="84" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="28" y="247" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Day 333–334 · 用什么写</text>
  <text x="28" y="267" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">五层:直接调 API → 协议 → 编排框架 → 现成 harness → 低代码平台</text>
  <text x="28" y="283" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">简单任务上七个做法都是 3 次请求,0.004–0.008 元,差别不是选型理由</text>
  <text x="28" y="299" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">引入框架的理由是要它的超时、重试、降级、审批,不是省钱</text>
  <text x="16" y="328" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">蓝 = 判断和模型侧,琥珀 = 工程落地;虚线 = 三种拆法最后都要落到某个框架或手写循环上</text>
</svg>
<figcaption>上面一个问题,中间三种拆法,下面一层落地。下周起第五层(低代码平台)会单独讲两天。</figcaption>
</figure>

这周的主线可以用一句话说完:**先问能不能拆,拆的时候分清是拆人还是拆上下文,拆完要有评测兜底,写的时候别指望框架帮你省钱。** 每个「先」「分清」「兜底」都对应着一篇实测里的翻车现场。

## 本周每天一句话

- [Day 329 · 两篇吵架的文章](/blog/agent-zero/day-329-multi-agent-1/):能不能拆看两个问题,有没有先后依赖、有没有共同要拍板的决定;并行的总耗时等于最慢的那个;玩具模型算出多 Agent 只多 1.21 倍 token,工具结果大到 3000 时反而 0.82 倍,Anthropic 的 15 倍是因为它多干了活。Cognition 2026 年 4 月的续篇只松了一口:写操作留给一个 Agent,别的只贡献判断。
- [Day 330 · 主管派活](/blog/agent-zero/day-330-multi-agent-2/):把专员包装成主管的工具,两个专员确实同时跑;同一个问题比单 Agent 多花约 2.4 倍 token、3 倍钱、慢一倍,而且坏在交接处:主管编了年份 2025、抄错发票号 INV-2026-0126、补出没有依据的到账天数。
- [Day 331 · 专员交接](/blog/agent-zero/day-331-multi-agent-3/):没有主管,谁在线谁回复,接手的人看得到完整历史,所以发票号没抄错;三个坑是漏回 ToolMessage 的 400、接手方以为自己是转出方、两个专员互相踢皮球。
- [Day 332 · subagent](/blog/agent-zero/day-332-multi-agent-4/):拆的是上下文不是人;2925 行日志让主 Agent 的上下文从 1.9 万压到 1.7 千,但有缓存时钱没省、第一轮还慢了近三倍;结论是有损压缩,追问到秒时答不出来;子 Agent 套子 Agent 深度 5 就是 121 个。
- [Day 333 · 框架横评(一)](/blog/agent-zero/day-333-frameworks-1/):先分五层再比;同一个任务四种做法都是 3 次请求;抓包看到 Claude Agent SDK 把 29 个字的系统提示词变成 166 个字,还偷偷多一次起标题的请求;会跑 Claude Code 的那个必须关进 `sandbox-exec`。
- [Day 334 · 框架横评(二)](/blog/agent-zero/day-334-frameworks-2/):七行放一张表,花费 0.0042–0.0078 元;LangGraph 1.2 的节点超时和错误处理器是先重试、重试用完才降级;面试三题的答法是「我量过」,引入框架的理由必须是需要它的能力。

## 默写 1:能同时派活的 Agent 循环

不看前面几天,写一个 `TinyAgent`:自己的 messages,模型每次开口要么调工具、要么给结论,同一轮的多个工具调用并发执行,有步数上限。再写一个主管,把两个专员当成它的两个工具。

Day 330 的 `MiniAgent` 调的是真模型。今天换成一份剧本:模型每次开口说什么,提前写在 `script` 里。这样复习不花钱,每次跑结果都一样,而且你能看清「循环」和「模型」是两个可以拆开的零件。

先自己写,写不出来再往下看。

```python
# agent-zero-lab/part05/review48/recall_loop.py
"""默写 1:Agent 循环 + 「把专员包装成主管的工具」。模型换成一份剧本,不花钱,结果每次都一样。
剧本只回答一件事:模型每次开口,是要调工具,还是直接给结论。"""
import asyncio
import json
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, TypedDict


class Reply(TypedDict, total=False):
    """模型一次开口:要么 content(结论),要么 tool_calls(要调工具)。"""
    content: str
    tool_calls: list[dict[str, Any]]  # 每项 {"id": ..., "name": ..., "args": {...}}


@dataclass
class TinyAgent:
    name: str
    script: list[Reply]  # 假模型:按顺序一条条吐
    tools: dict[str, Callable[..., Awaitable[str]]] = field(default_factory=dict)
    max_steps: int = 6
    chars_sent: int = 0  # 假装的「输入 token」:每次调用把 messages 的字符数加上去

    async def run(self, task: str) -> str:
        t0 = time.perf_counter()
        messages: list[dict[str, Any]] = [{"role": "user", "content": task}]
        replies = iter(self.script)
        ended: Reply = {"content": "(剧本演完了)"}
        for _ in range(self.max_steps):
            self.chars_sent += len(json.dumps(messages, ensure_ascii=False))
            reply = next(replies, ended)
            messages.append({"role": "assistant", **reply})
            calls = reply.get("tool_calls")
            if not calls:
                print(f"  [{self.name}] 交回结论,{time.perf_counter() - t0:.1f} 秒")
                return reply.get("content", "")
            outs = await asyncio.gather(*(self.tools[c["name"]](**c["args"]) for c in calls))
            for call, out in zip(calls, outs):
                messages.append({"role": "tool", "tool_call_id": call["id"], "content": out})
        return f"[{self.name}] 步数用完,没有得出结论"


async def find_customer(query: str) -> str:
    await asyncio.sleep(0.5)
    return '[{"id": "C007", "name": "刘静"}]'


async def search_help(keyword: str) -> str:
    await asyncio.sleep(1.0)
    return "ERR_EXPORT_TIMEOUT:年度报表超过 60 秒会超时,按季度分批导出"


billing = TinyAgent(
    "billing",
    [{"tool_calls": [{"id": "b1", "name": "find_customer", "args": {"query": "user007@example.com"}}]},
     {"content": "C007 刘静,10 月 8 日有两张 2392 元的已付发票"}],
    {"find_customer": find_customer},
)
tech = TinyAgent(
    "tech",
    [{"tool_calls": [{"id": "t1", "name": "search_help", "args": {"keyword": "ERR_EXPORT_TIMEOUT"}}]},
     {"content": "年度报表超过 60 秒会超时,改成按季度分批导出"}],
    {"search_help": search_help},
)


async def ask_billing(task: str) -> str:
    """账务专员。专员看不到用户原话,task 里要写清客户和要查什么。"""
    return await billing.run(task)


async def ask_tech(task: str) -> str:
    """技术支持。"""
    return await tech.run(task)


lead = TinyAgent(
    "lead",
    [{"tool_calls": [{"id": "l1", "name": "ask_billing", "args": {"task": "客户 user007@example.com,查 10 月有没有重复扣款"}},
                     {"id": "l2", "name": "ask_tech", "args": {"task": "导出年度报表报 ERR_EXPORT_TIMEOUT,怎么办"}}]},
     {"content": "两件事都查了:10 月有重复扣款(两张 2392 元),导出超时请按季度分批导出。"}],
    {"ask_billing": ask_billing, "ask_tech": ask_tech},
)

if __name__ == "__main__":
    t0 = time.perf_counter()
    answer = asyncio.run(lead.run("我是 user007@example.com:10 月是不是扣了两次?另外导出报表一直超时"))
    print(f"最终回复:{answer}")
    print(f"总用时 {time.perf_counter() - t0:.1f} 秒(billing 要 0.5 秒查客户,tech 要 1.0 秒查帮助)")
    for a in (lead, billing, tech):
        print(f"  {a.name:<8} 发出的字符数 {a.chars_sent}")
```

<div class="line-notes">

- `class Reply(TypedDict, total=False):` 模型一次开口的形状。`total=False` 表示字段可以缺:只有 `content`(给结论)或者只有 `tool_calls`(要调工具),不会两个都有。相当于 TS 里 `{ content?: string; tool_calls?: Call[] }`。
- `tool_calls: list[dict[str, Any]]` 每项是 `{"id": ..., "name": ..., "args": {...}}`。`id` 后面要原样写回工具结果,这是 [Day 331](/blog/agent-zero/day-331-multi-agent-3/) 那个 400 报错的根源。
- `@dataclass` 和 `class TinyAgent:` 就是 Day 330 `MiniAgent` 去掉记账和真实客户端以后的样子。
- `script: list[Reply]` 假模型的台词本。billing 的台词是两条:先调 `find_customer`,再给结论。
- `tools: dict[str, Callable[..., Awaitable[str]]]` 工具名对异步函数。主管的工具就是两个专员,所以 `ask_billing` 也是 `async def`。
- `max_steps: int = 6` 防跑飞的上限。练习 1 会让一个永远不收尾的专员撞上它。
- `chars_sent: int = 0` 假装的「输入 token」:每次调用把 messages 的字符数累加,只看相对大小。
- `async def run(self, task: str)` 对应 `MiniAgent.run`,`task` 就是主管写给专员的那一句话。
- `messages: list[dict[str, Any]] = [` 每次 `run` 都从一份新的 messages 开始,这就是「专员只看得到任务描述」。billing 第一次发出去的是 `[{"role": "user", "content": "客户 user007@example.com,查 10 月有没有重复扣款"}]`,69 个字符。
- `replies = iter(self.script)` 把台词本变成迭代器,每次 `next` 取下一句。
- `ended: Reply =` 台词演完了的兜底。类型标成 `Reply`,否则 `next(replies, 默认值)` 的类型会变成两种字典的并集,后面 `reply.get(...)` 的类型检查过不去。
- `for _ in range(self.max_steps):` 最多转 6 圈,和 Day 334 里 OpenAI Agents SDK 的 `max_turns`、微软的 `max_iterations` 是同一件事。
- `self.chars_sent += len(json.dumps(` 调模型之前先记账。lead 第一次只发了 78 个字符(只有用户那一句),第二次带着两条专员结论,所以 lead 累计 541,比 billing 的 351 大。
- `reply = next(replies, ended)` 假装调了一次模型。
- `messages.append({"role": "assistant", **reply})` 模型的回复先进历史,再决定干什么。`**reply` 把 `content` 或 `tool_calls` 摊进字典。
- `calls = reply.get("tool_calls")` 没有就是 `None`。
- `if not calls:` 没有工具调用就是结论,打印耗时并返回。
- `return reply.get("content", "")` 返回结论文字。
- `outs = await asyncio.gather(` 同一轮的所有工具调用同时开跑,相当于 JS 的 `Promise.all`。lead 第一轮发出两个调用,`ask_billing` 要 0.5 秒、`ask_tech` 要 1.0 秒,等的是 1.0 秒,不是 1.5 秒。
- `for call, out in zip(calls, outs):` `gather` 返回的顺序和传入顺序一致,所以可以直接 `zip`。
- `messages.append({"role": "tool"` 每个调用都要回一条 tool 消息,`tool_call_id` 对上调用的 `id`。漏一条就是 Day 331 的 400。
- `return f"[{self.name}] 步数用完,没有得出结论"` 转满 6 圈还没收尾时返回的文字。它会作为工具结果回到主管的上下文,练习 1 会看到。
- `async def find_customer(query: str) -> str:` 一个假工具,睡 0.5 秒假装查库。`query` 没用上,所以这个参数只是为了让调用的形状和真工具一样。
- `await asyncio.sleep(1.0)` `search_help` 比 `find_customer` 慢,慢的那个决定并行的总耗时。
- `billing = TinyAgent(` 账务专员:两条台词,工具表里只有 `find_customer`。
- `tech = TinyAgent(` 技术支持:先 `search_help`,再给结论。
- `async def ask_billing(task: str) -> str:` 包装函数。docstring「账务专员。专员看不到用户原话,task 里要写清客户和要查什么」在真实版本里会变成工具描述,模型靠它决定怎么写任务。
- `return await billing.run(task)` 这一行就是「把专员包装成工具」的全部:调专员的 `run`,把结论当字符串还回去。
- `lead = TinyAgent(` 主管的台词:第一句同时发出两个调用,第二句汇总。主管的工具表是 `ask_billing` 和 `ask_tech`,不是 `find_customer`。
- `answer = asyncio.run(lead.run(` 从主管开始跑,专员在里面被调起来。
- `for a in (lead, billing, tech):` 逐个打印每个 Agent 自己发出的字符数,这就是 Day 330 里「按 Agent 记账」的缩小版。

</div>

在练习仓库根目录建目录再跑(`agent-zero-lab` 是 [Day 10](/blog/agent-zero/day-010-uv-1/) 建的仓库,`part05/` 是第五部分的目录):

```bash
cd ~/agent-zero-lab
mkdir -p part05/review48
touch part05/review48/__init__.py
uv run python -m part05.review48.recall_loop
```

实跑输出:

```text
  [billing] 交回结论,0.5 秒
  [tech] 交回结论,1.0 秒
  [lead] 交回结论,1.0 秒
最终回复:两件事都查了:10 月有重复扣款(两张 2392 元),导出超时请按季度分批导出。
总用时 1.0 秒(billing 要 0.5 秒查客户,tech 要 1.0 秒查帮助)
  lead     发出的字符数 541
  billing  发出的字符数 351
  tech     发出的字符数 341
```

先看顺序。billing 0.5 秒交活,tech 1.0 秒交活,lead 一共 1.0 秒,不是 0.5 + 1.0 + 0。这和 [Day 329](/blog/agent-zero/day-329-multi-agent-1/) 的 `parallel_sleep.py` 一样:并行的总耗时由最慢的那个决定。再看字符数,lead 541、billing 351、tech 341,三个 Agent 各发各的,谁也没替谁背着对方的 messages,这就是上下文隔离在账上的样子。

对照一下 Day 330 的 `MiniAgent`,这份代码少了三样东西:真实的模型客户端、按 token 记账、工具报错兜底。它们是真实系统才需要的,但骨架就是这三十几行。默写的时候如果卡住,先想这三件事的顺序:先记账,再问模型,模型说要工具就并发执行并把结果按 id 写回。

## 默写 2:防踢皮球的专员交接

[Day 331](/blog/agent-zero/day-331-multi-agent-3/) 有个玩具图:两个专员按关键词决定自己答还是转给同事,踢皮球时 `recursion_limit` 炸出 `GraphRecursionError`。炸出来的时候用户什么回复都没有。今天默写它的改进版:状态里加一个 `hops`,同一轮转了两次还没人接,就转人工。

```python
# agent-zero-lab/part05/review48/recall_handoff.py
"""默写 2:专员交接 + 防踢皮球。不调模型。共享 messages、active 记住谁在接电话、Command(goto) 交接,
再加一个 hops:同一轮转了两次还没人接,就转人工,不等 recursion_limit 炸。"""
import operator
from typing import Annotated, Literal

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import START, StateGraph
from langgraph.types import Command
from typing_extensions import NotRequired, TypedDict

MINE = {"billing": ["扣", "发票", "退款"], "tech": ["报错", "导出", "登录"]}
Goto = Literal["billing", "tech", "__end__"]
OTHER: dict[str, Goto] = {"billing": "tech", "tech": "billing"}
MAX_HOPS = 2


class State(TypedDict):
    messages: Annotated[list[str], operator.add]
    active: NotRequired[str]
    hops: NotRequired[int]


def make_node(name: str):
    def node(state: State) -> Command[Goto]:
        question = [m for m in state["messages"] if m.startswith("用户:")][-1]
        if any(w in question for w in MINE[name]):
            return Command(goto="__end__", update={"messages": [f"{name}:这个归我,我来处理「{question[3:]}」"],
                                                   "active": name, "hops": 0})
        hops = state.get("hops", 0)
        if hops >= MAX_HOPS:
            return Command(goto="__end__", update={"messages": [f"{name}:已转过 {hops} 次没人接,帮您转人工客服"],
                                                   "active": name, "hops": 0})
        other = OTHER[name]
        return Command(goto=other, update={"messages": [f"{name}:不归我管,转给 {other}"],
                                           "active": other, "hops": hops + 1})
    return node


builder = StateGraph(State)
builder.add_node("billing", make_node("billing"))
builder.add_node("tech", make_node("tech"))
builder.add_conditional_edges(START, lambda s: s.get("active") or "billing", ["billing", "tech"])
graph = builder.compile(checkpointer=InMemorySaver())

if __name__ == "__main__":
    config: RunnableConfig = {"configurable": {"thread_id": "review-1"}}
    for text in ["10 月多扣了一笔", "导出报表报错", "你好,在吗"]:
        out = graph.invoke({"messages": [f"用户:{text}"]}, config)
        print(f"--- 「{text}」本轮结束 active={out['active']} hops={out['hops']}")
    for m in out["messages"]:
        print("  ", m)
```

<div class="line-notes">

- `MINE = {"billing": ["扣", "发票", "退款"], "tech": ["报错", "导出", "登录"]}` 每个专员认领的关键词。真实版里这一步由模型判断,但骨架不变。
- `Goto = Literal["billing", "tech", "__end__"]` `Command` 的返回类型标出可能跳到哪些节点,LangGraph 靠它在画图时画出虚线边([Day 309](/blog/agent-zero/day-309-lg-command/))。
- `OTHER: dict[str, Goto]` billing 转给 tech,tech 转给 billing,只有两个专员所以是一张小表。
- `MAX_HOPS = 2` 一轮对话里最多转两次。
- `messages: Annotated[list[str], operator.add]` 所有专员共享的历史,`operator.add` 让每个节点返回的新消息追加到后面,不是覆盖([Day 304](/blog/agent-zero/day-304-lg-reducer/))。
- `active: NotRequired[str]` 现在是谁在接电话。第一轮没有,所以 `NotRequired`。
- `hops: NotRequired[int]` 这一轮已经转了几次,有人认领就清零。
- `def make_node(name: str):` 用一个工厂函数造出两个专员节点,避免写两遍。
- `question = [m for m in state["messages"] if m.startswith("用户:")][-1]` 从共享历史里取最后一句用户的话。第三轮用户说「你好,在吗」,取到的就是这句。
- `if any(w in question for w in MINE[name]):` 命中自己的关键词就认领。
- `return Command(goto="__end__", update={` 认领以后结束本轮,同时把 `active` 记成自己、`hops` 清零。
- `hops = state.get("hops", 0)` 取目前已转次数,没有就是 0。
- `if hops >= MAX_HOPS:` 已经转满两次还是没人认领,就不再转了。
- `帮您转人工客服` 这句是兜底回复。真实系统里这里会往工单系统写一条人工待办,用户至少收到一句话。
- `other = OTHER[name]` 不归自己管,也没转满,就找同事。
- `"active": other, "hops": hops + 1` 转出时把 `active` 改成同事、转手次数加一。下一轮从同事开始。
- `builder.add_conditional_edges(START, lambda s: s.get("active") or "billing", ["billing", "tech"])` 每一轮从上次停下的专员开始,第一轮默认 billing。
- `graph = builder.compile(checkpointer=InMemorySaver())` 用同一个 `thread_id` 跨轮记住 `active` 和 `messages`。
- `config: RunnableConfig = {"configurable": {"thread_id": "review-1"}}` 三轮对话用同一个 thread。
- `for text in ["10 月多扣了一笔", "导出报表报错", "你好,在吗"]:` 三轮:账务、技术、谁都不管的闲话。
- `print(f"--- 「{text}」本轮结束 active={out['active']} hops={out['hops']}")` 每轮结束打印停在谁那里、转手计数是否清零。

</div>

```bash
uv run python -m part05.review48.recall_handoff
```

实跑输出:

```text
--- 「10 月多扣了一笔」本轮结束 active=billing hops=0
--- 「导出报表报错」本轮结束 active=tech hops=0
--- 「你好,在吗」本轮结束 active=tech hops=0
   用户:10 月多扣了一笔
   billing:这个归我,我来处理「10 月多扣了一笔」
   用户:导出报表报错
   billing:不归我管,转给 tech
   tech:这个归我,我来处理「导出报表报错」
   用户:你好,在吗
   tech:不归我管,转给 billing
   billing:不归我管,转给 tech
   tech:已转过 2 次没人接,帮您转人工客服
```

第三轮最有意思。上一轮停在 tech,所以「你好,在吗」先交给 tech:不归我,转 billing(hops 变 1);billing 也不归,转回 tech(hops 变 2);tech 看到 hops 已经是 2,不再转,回一句转人工。没有撞 `recursion_limit`,用户拿到了一句回复。注意最后 `hops=0`:转人工也算「处理了」,计数清零,下一轮重新数。

这段默写里最容易漏的是清零。认领时不清 `hops`,第二轮会带着第一轮剩下的转手次数,明明只转了一次就被判定踢皮球。

## 小项目:拆不拆,拆成什么

这周的规则散在六篇里:有依赖或共同决定就别拆;要和用户来回聊就交接;只读的大块中间过程用 subagent;互不相干的只读方向用主管并行;没有评测集先别拆。把它们写成一个小顾问:给一个场景,输出建议和理由,再给 inline 和 subagent 两种做法的粗略估算。

估算用的是一个玩具模型,不是真跑出来的数。我调了一个参数让它的「打平点」和 [Day 332](/blog/agent-zero/day-332-multi-agent-4/) 的实测对得上:那天 133 行的小日志 sub 贵 46%,591 行的中日志打平,2925 行的大日志 sub 便宜近三倍。

```python
# agent-zero-lab/part05/review48/split_advisor.py
"""第 48 周小项目:拆不拆,拆成什么。一份规则 + 一个玩具 token 估算,不调模型。
规则来自本周六天:有依赖/共同决定就别拆(329);要和用户来回聊就交接(331);只读的大块中间过程用 subagent(332);
互不相干的只读方向并行用主管(330);没有评测集先别拆(329、332)。"""
from dataclasses import dataclass

SYSTEM, TURN, SUMMARY, TASK = 300, 350, 300, 120  # 系统提示词、每轮问答、子 Agent 交回的结论、任务描述,单位 token
ANSWER, OUT_W = 250, 4  # 每轮回答的输出量;输出 token 单价约是输入的 4 倍(DeepSeek 0.04/2/8 里未命中输入 2、输出 8),折成「等效输入」


@dataclass
class Scenario:
    name: str
    turns: int = 1               # 用户要聊几轮
    big_result: int = 0          # 第一轮要读的大块只读结果有多大(token),0 = 没有
    parts: int = 1               # 能同时查的互不相干的方向有几个
    shared_decision: bool = False  # 子任务之间有没有要共同拍板的决定
    cross_domain_chat: bool = False  # 话题会不会在几个领域之间来回跳
    has_eval: bool = False       # 有没有评测集


def inline_tokens(s: Scenario) -> int:
    """一个 Agent 自己读:大块结果留在 messages 里,之后每一轮都要再发一遍(不算缓存)。"""
    read = sum(SYSTEM + t * TURN + s.big_result for t in range(1, s.turns + 1))
    return read + OUT_W * ANSWER * s.turns


def subagent_tokens(s: Scenario) -> int:
    """开子 Agent 去读:子 Agent 读两次(任务、任务+大块),主 Agent 多一轮往返,之后每轮只背一小段结论。"""
    main = sum(SYSTEM + t * TURN + SUMMARY for t in range(1, s.turns + 1)) + SYSTEM + TURN
    sub = (SYSTEM + TASK) + (SYSTEM + TASK + s.big_result)
    out = OUT_W * (ANSWER * s.turns + TASK + SUMMARY)  # 多出来的输出:派活的任务描述、交回的结论
    return main + sub + out


def recommend(s: Scenario) -> tuple[str, list[str]]:
    why: list[str] = []
    if s.shared_decision:
        return "单 Agent", ["子任务要共同拍板同一个决定,拆开每个都会自己定(Day 329、330)"]
    if s.cross_domain_chat:
        pick = "专员交接 handoff"
        why.append("要和用户来回聊,话题会在领域间跳,接手的人要看完整历史(Day 331)")
    elif s.big_result and s.turns >= 3 and subagent_tokens(s) < inline_tokens(s):
        pick = "subagent"
        why.append(f"大块只读结果 {s.big_result} token,要聊 {s.turns} 轮,估算 inline {inline_tokens(s)} > sub {subagent_tokens(s)}(Day 332)")
    elif s.parts >= 2:
        pick = "主管派活(map-reduce)"
        why.append(f"{s.parts} 个互不相干的只读方向可以并行,总耗时看最慢的那个;token 会成倍涨(Day 329、330)")
    else:
        pick = "单 Agent(需要时加 skills)"
        why.append("没有可并行的大块,也没有要隔离的大结果,拆了只会多一次转述(Day 329、332)")
    if pick != "单 Agent(需要时加 skills)" and not s.has_eval:
        why.append("还没有评测集:多 Agent 的协调失败不报错,先建评测再拆(Day 329、332)")
    return pick, why


SCENARIOS = [
    Scenario("官网在线客服,聊十几轮,账单和功能来回跳", turns=12, cross_domain_chat=True, has_eval=True),
    Scenario("每周一汇总 30 个大客户的用量、工单、发票异常", turns=1, big_result=4000, parts=30),
    Scenario("内部工具:一句话,要么查发票要么查帮助中心", turns=1),
    Scenario("翻 3 个月审计日志找重复扣款原因,客户接着追问", turns=6, big_result=18000, has_eval=True),
    Scenario("两个 Agent 同时改同一个仓库的同一批文件", turns=2, parts=2, shared_decision=True),
    Scenario("读一份 1500 token 的小日志,只聊 1 轮", turns=1, big_result=1500),
]

if __name__ == "__main__":
    for s in SCENARIOS:
        pick, why = recommend(s)
        print(f"{s.name}\n  建议:{pick}")
        for w in why:
            print(f"    - {w}")
    print("\n估算(玩具模型,不算缓存,单位「等效输入 token」):")
    print(f"{'大块结果':>8} {'轮数':>4} {'inline':>8} {'sub':>8}  谁便宜")
    for big, turns in [(1500, 1), (1500, 4), (4000, 4), (18000, 6)]:
        s = Scenario("x", turns=turns, big_result=big)
        a, b = inline_tokens(s), subagent_tokens(s)
        print(f"{big:>8} {turns:>4} {a:>8} {b:>8}  {'sub' if b < a else 'inline'}")
```

<div class="line-notes">

- `SYSTEM, TURN, SUMMARY, TASK = 300, 350, 300, 120` 四个常数:系统提示词 300 token,每一轮问答 350,子 Agent 交回的结论 300,主 Agent 写给子 Agent 的任务描述 120。数量级取自 Day 329 的 `token_bill.py` 和 Day 332 的实测,精确值不重要。
- `ANSWER, OUT_W = 250, 4` 每轮回答 250 token 输出,输出单价按输入的 4 倍折算(DeepSeek 价格表里未命中输入 2 元、输出 8 元每百万)。
- `class Scenario:` 一个场景只有几个事实:聊几轮、大块结果多大、能并行的方向有几个、有没有共同决定、话题会不会跳、有没有评测集。
- `big_result: int = 0` 第一轮要读的大块只读结果的大小,0 表示没有。
- `def inline_tokens(s: Scenario) -> int:` 一个 Agent 自己读。
- `read = sum(SYSTEM + t * TURN + s.big_result for t in range(1, s.turns + 1))` 第 t 轮要把系统提示词、前 t 轮的问答、那块大结果全部再发一遍。聊 4 轮、大块 1500 token:300+350+1500、300+700+1500、300+1050+1500、300+1400+1500,加起来 10700。
- `return read + OUT_W * ANSWER * s.turns` 再加上输出折算:4 × 250 × 4 = 4000,inline 一共 14700。
- `def subagent_tokens(s: Scenario) -> int:` 开子 Agent 去读。
- `main = sum(SYSTEM + t * TURN + SUMMARY` 主 Agent 每一轮只背一小段结论。后面那个 `+ SYSTEM + TURN` 是多出来的一次往返:调 `investigate` 要多问一次模型。
- `sub = (SYSTEM + TASK) + (SYSTEM + TASK + s.big_result)` 子 Agent 自己调两次模型,第二次带着大块结果。
- `out = OUT_W * (ANSWER * s.turns + TASK + SUMMARY)` 多出来的输出:任务描述和结论。
- `def recommend(s: Scenario)` 规则按优先级从上往下判断。
- `if s.shared_decision:` 有共同决定直接返回单 Agent,不看别的。这条优先级最高,因为别的收益都救不了冲突。
- `if s.cross_domain_chat:` 要来回聊且话题会跳,交接。
- `elif s.big_result and s.turns >= 3 and subagent_tokens(s) < inline_tokens(s):` 三个条件同时成立才用 subagent:有大块结果、至少聊 3 轮、估算上真的更省。
- `elif s.parts >= 2:` 有两个以上互不相干的只读方向,才轮到主管并行。
- `if pick != "单 Agent(需要时加 skills)" and not s.has_eval:` 只要建议拆开,又没有评测集,就追加一条提醒。
- `SCENARIOS = [` 六个场景:前三个是 Day 331 练习 4 的原题,后三个是 Day 332 和 329 的。
- `Scenario("翻 3 个月审计日志找重复扣款原因,客户接着追问", turns=6, big_result=18000, has_eval=True)` 这一行就是 Day 332 的主场景。
- `for big, turns in [(1500, 1), (1500, 4), (4000, 4), (18000, 6)]:` 四组数,看估算怎么随大块结果和轮数变。

</div>

```bash
uv run python -m part05.review48.split_advisor
```

实跑输出:

```text
官网在线客服,聊十几轮,账单和功能来回跳
  建议:专员交接 handoff
    - 要和用户来回聊,话题会在领域间跳,接手的人要看完整历史(Day 331)
每周一汇总 30 个大客户的用量、工单、发票异常
  建议:主管派活(map-reduce)
    - 30 个互不相干的只读方向可以并行,总耗时看最慢的那个;token 会成倍涨(Day 329、330)
    - 还没有评测集:多 Agent 的协调失败不报错,先建评测再拆(Day 329、332)
内部工具:一句话,要么查发票要么查帮助中心
  建议:单 Agent(需要时加 skills)
    - 没有可并行的大块,也没有要隔离的大结果,拆了只会多一次转述(Day 329、332)
翻 3 个月审计日志找重复扣款原因,客户接着追问
  建议:subagent
    - 大块只读结果 18000 token,要聊 6 轮,估算 inline 123150 > sub 38120(Day 332)
两个 Agent 同时改同一个仓库的同一批文件
  建议:单 Agent
    - 子任务要共同拍板同一个决定,拆开每个都会自己定(Day 329、330)
读一份 1500 token 的小日志,只聊 1 轮
  建议:单 Agent(需要时加 skills)
    - 没有可并行的大块,也没有要隔离的大结果,拆了只会多一次转述(Day 329、332)

估算(玩具模型,不算缓存,单位「等效输入 token」):
    大块结果   轮数   inline      sub  谁便宜
    1500    1     3150     6620  inline
    1500    4    14700    14570  sub
    4000    4    24700    17070  sub
   18000    6   123150    38120  sub
```

读结果。在线客服那条被判成交接,理由是话题来回跳;每周报告那条是主管并行,但顾问顺手提醒「还没有评测集」,这是 Day 329 和 332 都强调的前提。第四条 subagent 的估算是 123150 对 38120,差三倍多,和 Day 332 大日志那一档同一个量级。最后一张小表里,同样 1500 token 的大块结果,聊 1 轮 inline 便宜(3150 对 6620),聊 4 轮就基本打平(14700 对 14570)。

这个小顾问有两个诚实的短板。第一,它的规则是我手写的,`shared_decision` 这类布尔值要你自己判断,判断错了它照单全收,和 Day 329 的 `split_check.py` 一样,价值在逼你把这几个事实写出来。第二,估算是玩具模型,不算缓存,实测里 DeepSeek 的前缀缓存会让 inline 版便宜很多(Day 332 里总花费 0.0455 对 0.0521 元,inline 反而略省)。真要决定上不上 subagent,拿自己的任务和自己的模型厂商跑一遍,别信这张表。

## 本周错题与坑清单

| 坑 | 真实现象 | 哪天 | 怎么避 |
| --- | --- | --- | --- |
| 只看依赖图判断能不能并行 | Flappy Bird 两个画图任务没有依赖边,但「画风」由两边各自决定,结论变成「先别拆」 | 329 | 依赖和共同决定两个问题都问 |
| 用玩具模型估多 Agent 的 token | 估 1.21 倍,实跑是约 2.4 倍 token、3 倍钱 | 329、330 | 玩具模型只看趋势,数字拿真实记账表 |
| `from server import ...` 之后日志刷屏 | mcp 2.3.0 给根日志器装了 Rich 处理器,每次请求打三行 INFO;关 `httpx` 没用,日志器叫 `httpx2` | 330 | 两个名字都调到 WARNING |
| 主管转述时补信息 | 编了年份 2025、发票号抄成 INV-2026-0126、补出「3–5 个工作日」 | 330 | 回复里的数字只能来自专员结论;给专员补上缺的工具 |
| 直接 import server 里的函数 | `Field(le=20)` 只在 MCP 协议层生效,`limit: 50` 照样执行 | 330 | 要么走协议调用,要么自己再校验一次 |
| 交接工具调用不回结果 | `400 An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'` | 331 | 每个调用都回一条 tool 消息,交接也一样 |
| 接手方以为自己是转出方 | 关掉提醒后 3/3 次 tech 只回「已为您转接技术支持」,一个工具都没调 | 331 | 把「现在由你处理」放在消息列表末尾,写系统提示词里没用 |
| 两个专员互相踢皮球 | `GraphRecursionError: Recursion limit of 6 reached without hitting a stop condition` | 331 | 状态里记 `hops`,转两次没人接就转人工 |
| 以为 subagent 一定省钱 | 有前缀缓存时 inline 0.0455 元、sub 0.0521 元,第一轮 3.5 秒对 9.8 秒 | 332 | 要隔离上下文才用,要省钱先算无缓存口径 |
| 子 Agent 把证据压没了 | 追问「几点几分几秒」答成「这个时间戳我这边看不到」 | 332 | 让它交回结论加关键证据,或追问时再派一次 |
| 子 Agent 再开子 Agent | 每层派 3 个,深度 5 就是 121 个、约 36 万 token | 332 | 默认关嵌套,设深度和并发上限 |
| Intel Mac 装 `openai-agents` | `cryptography` 没预编译包,uv 去装 Rust 失败 | 333 | `uv add "cryptography<48"` |
| 换框架后关键参数没传进去 | OpenAI Agents SDK 不传 `ModelSettings`,思考一直开,输出 461 对 438 token | 333、334 | 抓包确认参数真的进了请求 |
| 照抄旧教程跑新版本 | Pydantic AI v2 `result.usage()` 报 `'RunUsage' object is not callable` | 334 | 先查迁移文档,有测试兜底再升级 |
| 以为错误处理器第一次失败就运行 | LangGraph 1.2 先重试,重试用完才降级,两次尝试共 1.1 秒 | 334 | 把重试预算算进总耗时 |

## 动手练习

**练习 1:专员永远不收尾。** 默写 1 里 `max_steps` 防的是模型不肯收尾。写 `ex335_steps.py`:让账务专员的台词是 10 条一模一样的 `find_customer` 调用,`max_steps` 设成 3,放进主管里跑。主管从专员那里收到的工具结果是什么?专员一共发出多少字符?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/review48/ex335_steps.py
"""练习 1:模型永远不肯收尾,max_steps 会不会兜住?再看主管怎么处理「专员步数用完」。"""
import asyncio

from part05.review48.recall_loop import Reply, TinyAgent, find_customer

loop_forever: list[Reply] = [{"tool_calls": [{"id": f"x{i}", "name": "find_customer", "args": {"query": "user007@example.com"}}]}
                for i in range(10)]
stuck = TinyAgent("billing", loop_forever, {"find_customer": find_customer}, max_steps=3)


async def ask_billing(task: str) -> str:
    """账务专员。"""
    result = await stuck.run(task)
    print(f"  主管收到的工具结果:{result}")
    return result


lead = TinyAgent(
    "lead",
    [{"tool_calls": [{"id": "l1", "name": "ask_billing", "args": {"task": "查 10 月有没有重复扣款"}}]},
     {"content": "账务那边没查出结果,我已转人工,请稍等。"}],
    {"ask_billing": ask_billing},
)

if __name__ == "__main__":
    print(asyncio.run(lead.run("10 月是不是扣了两次?")))
    print("专员发出的字符数", stuck.chars_sent)
```

<div class="line-notes">

- `from part05.review48.recall_loop import Reply, TinyAgent, find_customer` 直接复用默写 1 的零件,不重写。
- `loop_forever: list[Reply] = [` 10 条台词,每条都是调工具,没有一条是结论。
- `stuck = TinyAgent("billing", loop_forever, {"find_customer": find_customer}, max_steps=3)` 只给 3 步。
- `result = await stuck.run(task)` 先把专员的结果存下来再打印,否则看不到主管收到什么。
- `print(f"  主管收到的工具结果:{result}")` 这一行是练习的重点。
- `{"content": "账务那边没查出结果,我已转人工,请稍等。"}` 主管的第二句台词是我写死的,真实的主管模型会读到那句「步数用完」再决定怎么回。这里只验证「兜底文字确实回到了主管手里」。

</div>

```bash
uv run python -m part05.review48.ex335_steps
```

```text
  主管收到的工具结果:[billing] 步数用完,没有得出结论
  [lead] 交回结论,1.5 秒
账务那边没查出结果,我已转人工,请稍等。
专员发出的字符数 777
```

主管收到的就是 `[billing] 步数用完,没有得出结论` 这句话。专员发出 777 个字符,每转一圈 messages 多两条(模型的调用和工具结果),3 圈发了 3 次,一次比一次长。耗时 1.5 秒是三次 `find_customer` 各 0.5 秒。

这个兜底有个隐患:它是一段普通文字,主管模型可能把它当成专员的真实结论转述给客户。Day 330 练习 4 用真模型试过,真实系统里更稳的做法是返回一个有结构的错误,让主管的提示词明确写「看到步数用完就别编结论」。

</details>

**练习 2:打平点。** 小项目的估算说「聊得越久越早打平」。写 `ex335_break_even.py`,对聊 1 到 8 轮,算出大块结果至少多大(步长 100)开 subagent 才不比 inline 贵,打印成表,并说明聊 1 轮的那一行为什么是 `None`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/review48/ex335_break_even.py
"""练习 2:聊 N 轮时,大块结果至少多大,开 subagent 才不亏?"""
from part05.review48.split_advisor import Scenario, inline_tokens, subagent_tokens


def break_even(turns: int) -> int | None:
    for big in range(0, 20001, 100):
        s = Scenario("x", turns=turns, big_result=big)
        if subagent_tokens(s) <= inline_tokens(s):
            return big
    return None


if __name__ == "__main__":
    print("轮数  最小大块结果(token)")
    for turns in range(1, 9):
        print(f"{turns:>4}  {break_even(turns)}")
```

<div class="line-notes">

- `def break_even(turns: int) -> int | None:` 返回第一个让 sub 不贵于 inline 的大块结果,找不到返回 `None`。`int | None` 相当于 TS 的 `number | null`。
- `for big in range(0, 20001, 100):` 从 0 开始每次加 100,扫到 20000。
- `s = Scenario("x", turns=turns, big_result=big)` 临时造一个只有轮数和大块结果的场景,名字随便填。
- `if subagent_tokens(s) <= inline_tokens(s):` 第一次满足就是打平点,直接返回。
- `for turns in range(1, 9):` 聊 1 到 8 轮。

</div>

```bash
uv run python -m part05.review48.ex335_break_even
```

```text
轮数  最小大块结果(token)
   1  None
   2  3800
   3  2100
   4  1500
   5  1200
   6  1000
   7  900
   8  800
```

聊 1 轮是 `None`:子 Agent 只省「之后每一轮不用背」,聊 1 轮没有之后,却要多付一次往返和一份结论,所以不管结果多大都不划算。聊 2 轮要 3800 token 才打平,聊 4 轮 1500,聊 8 轮只要 800。这条曲线是 Day 332 那句「对话越长越早打平」的数字版。

</details>

**练习 3:加一条规则。** Cognition 2026 年 4 月的续篇说,写操作留在一个 Agent 手里,其他 Agent 只贡献判断。给 `split_advisor` 加这条规则:`Scenario2` 多两个字段 `writers`、`readers`;写手 2 个以上建议单 Agent,正好 1 个写手加至少 1 个只读帮手建议「单写手 + 只读帮手」,其他情况交回原来的 `recommend`。用三个场景验证。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/review48/ex335_rules.py
"""练习 3:给 split_advisor 加一条规则。Cognition 2026 年 4 月那篇的结论:写操作留给一个 Agent,别的只贡献判断。"""
from dataclasses import dataclass

from part05.review48.split_advisor import Scenario, recommend


@dataclass
class Scenario2(Scenario):
    writers: int = 0   # 要改东西的 Agent 有几个
    readers: int = 0   # 只读的帮手(审查、搜索、问意见)有几个


def recommend2(s: Scenario2) -> tuple[str, list[str]]:
    if s.writers >= 2:
        return "单 Agent", [f"{s.writers} 个写手会各自做隐含决定,冲突是必然的(Day 329)"]
    if s.writers == 1 and s.readers >= 1:
        return "单写手 + 只读帮手", [f"写操作只留 1 个,{s.readers} 个只读帮手只交回判断,不动手(Cognition 2026-04,Day 329)"]
    return recommend(s)


if __name__ == "__main__":
    for s in [
        Scenario2("Devin 式:一个写 PR,一个拿干净上下文审 PR", writers=1, readers=1),
        Scenario2("三个 Agent 同时改同一个仓库", writers=3),
        Scenario2("官网在线客服,聊十几轮,账单和功能来回跳", turns=12, cross_domain_chat=True, has_eval=True),
    ]:
        pick, why = recommend2(s)
        print(f"{s.name}\n  建议:{pick}\n    - {why[0]}")
```

<div class="line-notes">

- `@dataclass` 和 `class Scenario2(Scenario):` 继承原来的 `Scenario`,只多两个字段。dataclass 继承时,子类字段要有默认值(父类的字段都有默认值,所以这里也要给 0)。
- `writers: int = 0` 要改东西的 Agent 有几个。
- `readers: int = 0` 只读的帮手有几个:审查者、搜索者、只给意见的更强模型。
- `def recommend2(s: Scenario2)` 新规则放在原规则前面,没命中的交回 `recommend`。
- `if s.writers >= 2:` 两个以上写手,直接单 Agent,理由还是 Day 329 的隐含决定会冲突。
- `if s.writers == 1 and s.readers >= 1:` 一个写手加只读帮手,正是续篇里「写单线程、其余贡献智能」的形状。
- `return recommend(s)` 其余情况回到原来的规则,`Scenario2` 是 `Scenario` 的子类,可以直接传。
- `Scenario2("Devin 式:一个写 PR,一个拿干净上下文审 PR", writers=1, readers=1)` 续篇里提到的用法,审查者用干净上下文效果最好。

</div>

```bash
uv run python -m part05.review48.ex335_rules
```

```text
Devin 式:一个写 PR,一个拿干净上下文审 PR
  建议:单写手 + 只读帮手
    - 写操作只留 1 个,1 个只读帮手只交回判断,不动手(Cognition 2026-04,Day 329)
三个 Agent 同时改同一个仓库
  建议:单 Agent
    - 3 个写手会各自做隐含决定,冲突是必然的(Day 329)
官网在线客服,聊十几轮,账单和功能来回跳
  建议:专员交接 handoff
    - 要和用户来回聊,话题会在领域间跳,接手的人要看完整历史(Day 331)
```

前两个场景命中新规则,第三个(在线客服)没命中,交回原来的 `recommend`,还是交接。注意规则的先后顺序:如果把 `writers == 1 and readers >= 1` 放在 `shared_decision` 前面,「共同决定」那条就被架空了。优先级本身就是设计。

</details>

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 剧本模型 | 把模型换成一份写死的台词本,每次开口说什么提前定好。不花钱、结果可重复,用来单独检查「循环」写得对不对。今天的 `TinyAgent.script` |
| 打平点 | 两种做法总成本相等时的那个临界值。今天是「大块结果多大、聊几轮,subagent 才不比 inline 贵」,练习 2 |
| 转手次数(hops) | 一轮对话里请求被转交了几次。给它设上限是防踢皮球最便宜的办法,今天的 `MAX_HOPS = 2` |
| 单写手加只读帮手 | 只有一个 Agent 能改东西,其余 Agent 只交回判断(审查、搜索、问意见)。Cognition 2026 年 4 月续篇里已经在 Devin 上跑通的形状,练习 3 |
| 等效输入 token | 把输出 token 按单价比例折算成输入 token,方便把两种单价放进同一个加法里。今天 `OUT_W = 4` |

本周其他术语都在各天的名词解释里:多 Agent、编排者-工作者、隐含决定(Day 329、330),handoff、`Command(goto)`、router、skills、A2A(Day 331),subagent、fork、有损压缩、context rot(Day 332),五层图、harness、`sandbox-exec`(Day 333),Workflow Runtime、节点超时、错误处理器(Day 334)。

## 常见误区

**默写时把模型和循环写在一起。** 写出来能跑,但没法单独验证循环。`TinyAgent` 把「模型每次说什么」抽成 `script`,换成真模型只改那一行,这和 Day 334 里「手写版的价值是每一行都是你的」是同一个思路。

**交接只写转出,不写计数清零。** 默写 2 里如果认领时不清 `hops`,下一轮会带着旧的计数,一次正常转手就被判成踢皮球。

**拿玩具模型的数字当结论。** 小顾问的估算我特意对齐了 Day 332 的实测,但它不算缓存。有前缀缓存的厂商上,inline 版常常比估算便宜,所以估算只能回答「值不值得去量一量」。

**规则的优先级写反。** 练习 3 的最后一段已经讲了:共同决定要放最前面。优先级写反,规则看起来都在,实际谁也不管用。

**以为复习日可以跳过默写。** 默写时你会发现自己忘了 `tool_call_id` 要原样写回、`gather` 的返回顺序和传入一致、`NotRequired` 为什么要有。这些东西读文章时觉得都懂了,手写才知道没懂。

**把「步数用完」的文字当成结论转给客户。** 练习 1 里它是一段普通文字,没有任何标记说明它是失败。主管的提示词要明确写出看到它该怎么办。

## 学习资料

### 文档与文章

- [Cognition · Multi-Agents: What's Actually Working](https://cognition.ai/blog/multi-agents-working):2026-04-22,小项目里「写单线程、只读帮手」那条规则的出处,重读「哪些能用、哪些还不行」两部分,20 分钟。
- [Anthropic · How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system):90.2%、4 倍、15 倍、token 解释 80% 表现差异这些数字的出处,复习时对照小项目的估算再读一遍,30 分钟。
- [LangChain · Multi-agent](https://docs.langchain.com/oss/python/langchain/multi-agent):五类模式的总览和调用次数对比表,拿来核对小顾问里的四种建议有没有漏类,15 分钟。
- [Claude Code · Subagents](https://code.claude.com/docs/en/sub-agents):Day 332 的出处,重读 fork 和嵌套层数那两节,15 分钟。
- [LangGraph · Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api):对照默写 2 复习 `Command` 和 reducer,10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV11p6wB2EmX&autoplay=0&high_quality=1" title="挑战12分钟搞定,多智能体(Multi-Agent)架构" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI大模型学习study · 挑战12分钟搞定,多智能体(Multi-Agent)架构 · 13 分钟,把常见的几种多 Agent 结构过一遍,复习时对照小顾问里的四种建议。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1yhp4zxEXv&autoplay=0&high_quality=1" title="如何用 LangGraph Supervisor 搭建多智能体系统" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AIDeepCoder · 如何用 LangGraph Supervisor 搭建多智能体系统 · 12 分钟,用框架搭同样的主管结构,和默写 1 的 `ask_billing` 对照:框架替你做的就是把 Agent 包成工具那一步。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/LP5OCa20Zpg" title="Tips for building AI agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Anthropic · Tips for building AI agents · 英文,Anthropic 几位工程师聊什么时候该用 Agent、什么时候不该用,和这周「先单 Agent」的立场是一个思路。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Mi5wOpAgixw" title="Multi-agent Systems Explained in 17 Minutes" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Shaw Talebi · Multi-agent Systems Explained in 17 Minutes · 英文,17 分钟,复习时倍速看一遍,留意它讲的结构能不能对上本周三种拆法。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):第 6 章 Agent 部分,把这周的失败模式(规划失败、工具失败、效率问题)对一遍,英文原版。
- Michael Albada《Building Applications with AI Agents》(O'Reilly,2025):整本围绕多 Agent 系统的设计,选读讲编排模式取舍的几章,英文原版。

### 开源项目与代码

- [langchain-ai/langgraph-swarm-py](https://github.com/langchain-ai/langgraph-swarm-py):交接模式的现成封装,看它的 `create_handoff_tool`,和默写 2 对照。
- [anthropics/claude-cookbooks · patterns/agents](https://github.com/anthropics/claude-cookbooks/tree/main/patterns/agents):Anthropic 官方的 Agent 模式示例,`orchestrator_workers.ipynb` 对应默写 1。

## 自测

1. 一句话说出这周三条线,以及每条线对应哪几天。

<details><summary>答案</summary>

该不该拆(Day 329:有没有依赖、有没有共同决定、并行省时间、token 多花多少);怎么拆(Day 330 主管派活、Day 331 专员交接、Day 332 subagent 拆上下文);用什么写(Day 333 分五层并同任务比较、Day 334 七个框架和面试三题)。

</details>

2. 默写 1 里主管的总耗时为什么是 1.0 秒,不是 1.5 秒?如果把 `asyncio.gather` 换成两个顺序的 `await`,会变成多少?

<details><summary>答案</summary>

同一轮的两个工具调用被 `gather` 同时开跑,总耗时等于最慢的那个,即 `ask_tech` 的 1.0 秒。换成顺序 `await`,billing 0.5 秒加 tech 1.0 秒,约 1.5 秒。真实系统里主管自己还有两次模型调用要串行,并行省下的时间会被它们吃掉一部分(Day 329、330)。

</details>

3. 默写 2 里 `hops` 在什么时候清零?漏了会怎样?

<details><summary>答案</summary>

有专员认领、或者转人工结束本轮时清零。漏了的话,下一轮会带着上一轮剩下的转手次数,一次正常的转手也可能被判成「转了两次没人接」而提前转人工。

</details>

4. subagent 和主管派活在「拆什么」上有什么本质区别?各自典型的失败是什么?

<details><summary>答案</summary>

主管派活拆的是领域分工,专员长期存在,有各自的提示词和工具,典型失败是交接处转述出错(编年份、抄错发票号、补出没有依据的承诺)。subagent 拆的是上下文,子 Agent 临时开、用完即弃,典型失败是结论有损压缩,后面追问细节时主 Agent 答不出来。

</details>

5. 小顾问的估算说「聊 1 轮 inline 更便宜,聊 4 轮基本打平」,它和 Day 332 的实测有哪两点不一致的风险?

<details><summary>答案</summary>

第一,玩具模型不算缓存,有前缀缓存的厂商上 inline 版后面几轮几乎免费,实际比估算便宜得多(Day 332 总花费 inline 0.0455 对 sub 0.0521 元)。第二,模型自己决定读多大的范围,实测里「中」档日志 inline 版的上下文只涨了不到 2000 token,不是我能指定的。所以估算只能决定值不值得去量一量。

</details>

6. **面试题**:「你们的客服系统有账务和技术两个专员,用户经常在一次对话里换话题。你会用主管派活还是交接?各自有什么坑,你怎么兜底?」

<details><summary>答案</summary>

参考要点:用户要和专员来回聊、话题会在领域间跳,选交接(handoff):接手方看得到完整历史,没有转述这一步,Day 331 实测发票号没抄错,而且共享前缀能吃缓存,同样两件事交接版 6615 token、约 0.0075 元,主管版 7854 token、0.0234 元。坑有三个:交接工具调用也要回 tool 消息,否则 400;共享历史里的 AI 消息不带身份,接手方会以为自己是转出方,要把「现在由你处理」放在消息列表末尾;两个专员互相踢皮球,要在状态里记转手次数,转两次没人接就转人工,别等 `recursion_limit`。再补一点:交接也解决不了专员缺工具时自己编数字,所以要给专员补上退款政策这类工具,并且有评测集兜底。如果问题是一次性的、能拆成互不相干的查询(比如周报),才选主管并行。

</details>

## 明天预告

明天是 [Day 336 · 低代码平台(一):Dify、扣子、百炼、n8n 现状,同一流程画 vs 写](/blog/agent-zero/day-336-low-code-1/)。前五周我们把 Agent 都写成了代码,但国内的招聘要求里 Dify、扣子出现得比 LangGraph 还勤。明天先把四个平台 2026 年 10 月的真实状态查清楚,再把同一个工单分流流程写一遍代码、在 n8n 里画一遍,放在一起比。它是上周五层图里最上面那一层。
