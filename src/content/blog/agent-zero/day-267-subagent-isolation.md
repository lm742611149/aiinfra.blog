---
title: 'Day 267 · 隔离:把翻资料的脏活交给子 Agent,harness 这一层'
description: '上下文工程四类手段里最后一类是隔离:把要翻很多资料的任务交给一个有独立消息列表的子 Agent,它自己查、自己读,只交回一段短结论。同一场三轮对话,主对话的上下文从 2639 token 降到 1401,代价是总费用从 ¥0.0143 涨到 ¥0.0198。然后把这周写的零件按顺序接成一个 harness:取记忆、整理历史、拼 system、跑循环、存回、记轨迹,一个会话五轮加一个新会话跑完。'
pubDate: 2026-10-23
regime: none
tags: ['context-engineering', 'subagent', 'harness', 'agent', 'python', 'agent-zero']
series: 'agent-zero'
day: 267
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 266](/blog/agent-zero/day-266-agentic-rag/) 把检索做成工具交给 Agent 循环。十道题各跑三遍,固定流水线 26/30,Agentic 30/30,赢在一句两问;代价是平均每题检索 1.5 次、费用 2.7 倍、输入 token 是固定流水线的 4 倍。输入变多的原因是每一轮工具结果都留在 `messages` 里,下一轮要全部重发。

这个代价在「问一句、查两次」时还能忍。如果一个问题要翻五六篇文章,几千字原文会一直赖在主对话里,之后用户每问一句,这些字都要再发一遍、再算一遍钱。今天讲 Day 262 那张四类手段表里最后一类:**隔离**。

## 今天要解决的问题

学完你应该能做到:

1. 说清楚子 Agent 是什么(一个有自己独立消息列表的 Agent 循环,被主 Agent 当成一个普通工具调用),以及它省的是什么、花的是什么。
2. 写出 `part04/agent_loop.py`(把 Day 266 的循环抽成通用函数)和 `part04/subagent.py`(`run_subagent`、`research` 工具),并用同一场三轮对话量出:主对话的上下文少了多少、总费用多了多少。
3. 看到并修好子 Agent 最常见的坑:它看不到主对话,客户早先说过的背景要主 Agent 自己写进 `task`;结论长度模型只是大概遵守;步数用完怎么降级;它能用哪些工具要有清单。
4. 说清楚 harness 是什么,并把这一周的零件(Day 263 的清理和压缩、Day 264 的短期和长期记忆、Day 266 的循环、今天的子 Agent)接成 `part04/harness.py`,读懂一次会话留下的轨迹。

预计用时 3.5 小时(今天有两个新概念,偏满,见汇报里的拆天建议)。API 花费约 ¥0.25:三轮对话对比 ¥0.0143 + ¥0.0198,harness 演示 ¥0.0275,子 Agent 单跑和背景丢失 ¥0.03,练习合计约 ¥0.12。价格同 Day 265。

前置:[Day 262](/blog/agent-zero/day-262-context-budget/) 的 `ctx_budget.py`(`message_tokens`)、四类手段;[Day 263](/blog/agent-zero/day-263-compaction/) 的 `tool_clearing.py` 和 `compaction.py`;[Day 264](/blog/agent-zero/day-264-memory-short-long/) 的 `session_store.py`、`memory_store.py`、`memory_chat.py`(`MEMORY_HEADER`)、`pg_store.py`;[Day 266](/blog/agent-zero/day-266-agentic-rag/) 的 `kb_tools.py`、`agentic_rag.py`(`SYSTEM_AGENT`)。Postgres.app 要开着,`.env` 里 `PG_DSN` 指向你自己的库。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `loop()` 和 `run_subagent()`;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 子 Agent:翻资料的脏活放在另一个窗口里

设想用户问:「帮我对比一下三种套餐在账本数、成员数、导出次数、能不能开增值税专用发票、退款规则上的区别。」要答这个问题,Agent 得查四五次、读两篇全文,几千字原文全部堆进对话。答完以后,这些字还留在历史里:用户接下来问「我们 5 个人要开 3 个账本,选哪个?」,每一轮都要为它们付钱,还可能干扰后面的问题。

子 Agent 的做法:主 Agent 把「翻资料」这件事交给另一个 Agent 循环去做。那个循环有**自己的 `messages` 列表**,从空白开始,在自己的窗口里查、读、折腾,最后只交回一段短结论。主 Agent 的 `messages` 里只多了一条 `tool` 消息,就是这段结论。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="子 Agent 隔离:左边主 Agent 的 messages 只有 user、一次 research 调用、一条短结论和回答;右边子 Agent 有自己的 messages,里面有多次 search_kb 和 get_article 的调用和大段工具结果;只有最后的结论穿过边界回到主 Agent">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<defs><marker id="sb267a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--ink-soft)"/></marker></defs>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink-soft)">主 Agent 的 messages</text>
<rect x="20" y="38" width="250" height="236" rx="4" fill="none" stroke="var(--rule)"/>
<rect x="34" y="52" width="222" height="30" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="145" y="72" fill="var(--ink)" text-anchor="middle">user:对比三种套餐…</text>
<rect x="34" y="92" width="222" height="30" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="145" y="112" fill="var(--ink)" text-anchor="middle">assistant:research(task)</text>
<rect x="34" y="132" width="222" height="30" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="145" y="152" fill="var(--ink)" text-anchor="middle">tool:短结论(约 440 字)</text>
<rect x="34" y="172" width="222" height="30" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="145" y="192" fill="var(--ink)" text-anchor="middle">assistant:最终回答</text>
<text x="34" y="232" fill="var(--ink-faint)" font-size="11">之后每一轮都带着这 4 条</text>
<text x="34" y="250" fill="var(--ink-faint)" font-size="11">对话 5 条 / 1027 token</text>
<text x="370" y="26" fill="var(--ink-soft)">子 Agent 的 messages(用完即扔)</text>
<rect x="370" y="38" width="250" height="236" rx="4" fill="none" stroke="var(--rule)" stroke-dasharray="5 3"/>
<rect x="384" y="52" width="222" height="26" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="495" y="70" fill="var(--ink)" text-anchor="middle">system + task</text>
<rect x="384" y="86" width="222" height="26" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="495" y="104" fill="var(--ink)" text-anchor="middle">search_kb ×4 一轮并发</text>
<rect x="384" y="120" width="222" height="40" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="495" y="138" fill="var(--ink)" text-anchor="middle">4 条 tool 结果</text>
<text x="495" y="153" fill="var(--ink-soft)" text-anchor="middle" font-size="11">几百字一条</text>
<rect x="384" y="168" width="222" height="26" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="495" y="186" fill="var(--ink)" text-anchor="middle">get_article ×2</text>
<rect x="384" y="202" width="222" height="26" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="495" y="220" fill="var(--ink)" text-anchor="middle">2 篇全文</text>
<text x="384" y="250" fill="var(--ink-faint)" font-size="11">最后涨到约 2000 token</text>
<line x1="372" y1="144" x2="258" y2="144" stroke="var(--ink-soft)" marker-end="url(#sb267a)"/>
<text x="314" y="136" fill="var(--ink-soft)" text-anchor="middle" font-size="11">只有结论</text>
<text x="314" y="162" fill="var(--ink-soft)" text-anchor="middle" font-size="11">穿过边界</text>
</g>
</svg>
<figcaption>隔离的意思:子 Agent 在自己的窗口里翻资料,窗口里涨到两千 token 也不要紧,函数返回后就扔掉了;主 Agent 的窗口只多一条短结论。数字来自今天的三轮对话实验:主对话第一问之后 5 条消息、1027 token,而让主 Agent 自己查是 10 条、2055 token。</figcaption>
</figure>

这个设计用到前面学的两样东西:子 Agent 本身就是 Day 266 的 `run()` 那个循环,多了一个独立的 `messages`;主 Agent 看它,就是 Day 157 学过的一个工具,有名字、有描述、有参数。**对主 Agent 来说,`research` 和 `search_kb` 没区别**,它不需要知道这个工具里面又跑了一个循环。

要写子 Agent,得先把 Day 266 的循环抽成一个函数,因为今天有三个地方要用它:子 Agent、对比实验里的主 Agent、后面的 harness。

## 第一步:把循环抽成函数

新建 `part04/agent_loop.py`。逻辑和 Day 266 的 `run()` 一样,区别有三点:收现成的 `messages`(不是一个问题),返回新增的消息(要存会话时用得到),用 `finished` 区分「模型自己说完了」和「步数用完被截断」。

```python
# agent-zero-lab/part04/agent_loop.py  把 Day 266 的循环抽成一个函数:收现成的 messages,返回新增的消息,子 Agent 和 harness 都用它
import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from common.llm import LLMClient


@dataclass
class LoopResult:
    answer: str
    messages: list[dict[str, Any]]  # 完整的 messages:传进来的那些,加上这一次循环里新增的
    calls: list[tuple[str, str]]    # (工具名, 参数原文),按发生顺序
    finished: bool                  # True 表示模型自己说完了;False 表示步数用完被截断


def loop(client: LLMClient, messages: list[dict[str, Any]], tools: list[dict],
         funcs: dict[str, Callable[..., str]], max_steps: int = 6) -> LoopResult:
    msgs = list(messages)  # 复制一份,不改调用方手里的列表
    calls: list[tuple[str, str]] = []
    for _ in range(max_steps):
        r = client.chat(msgs, tools=tools, temperature=0)
        msgs.append(r.message)
        tool_calls = r.message.get("tool_calls") or []
        if not tool_calls:
            return LoopResult(r.content, msgs, calls, True)
        for tc in tool_calls:
            name, raw = tc["function"]["name"], tc["function"]["arguments"]
            try:
                result = funcs[name](**json.loads(raw or "{}"))
            except Exception as e:
                result = f"工具调用失败:{e}"
            calls.append((name, raw))
            msgs.append({"role": "tool", "tool_call_id": tc["id"], "content": result})
    return LoopResult("", msgs, calls, False)
```

<div class="line-notes">

- `from dataclasses import dataclass` Day 50 学的。这里用 dataclass 当「带名字的返回值」,比返回一个四元组好读。
- `class LoopResult:` 一次循环的结果。
- `answer: str` 最终回答。没说完(步数用完)时是空字符串。
- `messages: list[dict[str, Any]]  # 完整的 messages:传进来的那些,加上这一次循环里新增的` 完整对话。调用方想拿「这一轮新增的」,就用 `res.messages[len(原来的):]` 切出来。
- `calls: list[tuple[str, str]]    # (工具名, 参数原文),按发生顺序` 和 Day 266 的调用记录一样。
- `finished: bool                  # True 表示模型自己说完了;False 表示步数用完被截断` Day 266 的 `run` 把「步数用完」直接换成一句固定的话。这里把两种情况留给调用方自己处理(练习 3 的收尾,子 Agent 的降级,harness 的转人工,处理办法各不相同)。
- `def loop(client: LLMClient, messages: list[dict[str, Any]], tools: list[dict],` 参数全由调用方传:谁的客户端(账本),什么历史,什么工具,什么映射表,几步上限。函数本身不带任何业务内容。
- `msgs = list(messages)  # 复制一份,不改调用方手里的列表` 浅拷贝一份新列表。不复制的话,函数一边循环一边 `append`,调用方手里的 `messages` 也跟着变了,以后某个地方复用同一个列表时会很难查。
- `r = client.chat(msgs, tools=tools, temperature=0)` 每一步把完整的 `msgs` 和工具说明书发出去。
- `msgs.append(r.message)` 模型的回复原样记进历史,带 `tool_calls` 时必须先于 `tool` 消息。
- `if not tool_calls:` 出口。
- `return LoopResult(r.content, msgs, calls, True)` 模型说完了:`finished=True`。
- `result = funcs[name](**json.loads(raw or "{}"))` 找函数、解参数、调用,和 Day 266 一样。
- `except Exception as e:` 工具出错当结果发回去。
- `return LoopResult("", msgs, calls, False)` 步数用完:没有回答,`finished=False`。`for` 循环正常走完才会到这一行。

</div>

## 第二步:子 Agent

新建 `part04/subagent.py`:

```python
# agent-zero-lab/part04/subagent.py  子 Agent:翻资料的脏活在它自己的 messages 里做,只把一段短结论交回主 Agent
from dataclasses import dataclass

from common.llm import Ledger, LLMClient
from part04.agent_loop import loop
from part04.ctx_budget import message_tokens
from part04.kb_tools import FUNCS, TOOLS

SUB_SYSTEM = """你是资料调研助手,只负责查 CloudLedger 帮助中心并整理结论,不直接面对客户。
用工具把任务里涉及的每一点都查清楚。最后输出不超过 300 字的结论,每条结论后标注出处编号(例如 [kb-001#1]),
查不到的点明确写「帮助中心未提及」。
你看不到客户和客服之前的对话,任务里没写的背景就当不存在。"""


@dataclass
class SubResult:
    conclusion: str
    calls: list[tuple[str, str]]
    inner_tokens: int  # 子 Agent 自己的 messages 最后涨到多少 token
    ledger: Ledger     # 子 Agent 自己的账本:调了几次模型、输入输出多少 token、花了多少钱
    finished: bool


def run_subagent(task: str, max_steps: int = 8) -> SubResult:
    client = LLMClient()  # 新建一个客户端,账本和主 Agent 分开
    messages = [{"role": "system", "content": SUB_SYSTEM}, {"role": "user", "content": task}]
    res = loop(client, messages, TOOLS, FUNCS, max_steps)
    conclusion = res.answer if res.finished else "子任务没有在步数上限内完成,下面的信息可能不全。"
    inner = sum(message_tokens(m) for m in res.messages)
    return SubResult(conclusion, res.calls, inner, client.ledger, res.finished)


# 主 Agent 眼里,子 Agent 就是一个普通工具
RESEARCH_TOOL = {"type": "function", "function": {
    "name": "research",
    "description": "把一个需要查很多篇帮助文章的问题交给调研助手,返回整理好的短结论(带出处)。"
                   "适合「对比几种套餐」「列出所有和发票有关的规则」这类要翻很多资料的任务;单个问题直接用 search_kb。"
                   "调研助手看不到你和客户的对话,客户说过的、和任务有关的情况要写进 task 里。",
    "parameters": {"type": "object", "properties": {
        "task": {"type": "string", "description": "要调研的问题,写清楚要覆盖哪些方面,以及相关的客户背景"}},
        "required": ["task"]}}}

SUB_LOG: list[SubResult] = []  # 每次子 Agent 跑完,把成绩单放这里,方便外面统计


def research(task: str) -> str:
    result = run_subagent(task)
    SUB_LOG.append(result)
    return result.conclusion


if __name__ == "__main__":
    task = "对比免费版、专业版、企业版在账本数、成员数、导出次数、能否开增值税专用发票、退款规则上的区别"
    r = run_subagent(task)
    print(f"子 Agent 调了 {len(r.calls)} 次工具:")
    for name, raw in r.calls:
        print(f"  {name} {raw}")
    print(f"自己的 messages 涨到 {r.inner_tokens} token;{r.ledger}")
    print(f"交回的结论 {len(r.conclusion)} 字:\n{r.conclusion}")
```

<div class="line-notes">

- `from common.llm import Ledger, LLMClient` `Ledger` 是 `LLMClient.ledger` 的类型(调用次数、token、钱),用来给 `SubResult` 的字段标类型。
- `from part04.ctx_budget import message_tokens` Day 262 的分词器计数,用来量子 Agent 自己的 messages 最后涨到多少 token。
- `SUB_SYSTEM = """你是资料调研助手,只负责查 CloudLedger 帮助中心并整理结论,不直接面对客户。` 子 Agent 的人设和主 Agent 完全不同:它的读者是主 Agent,不是客户。
- `用工具把任务里涉及的每一点都查清楚。最后输出不超过 300 字的结论,每条结论后标注出处编号(例如 [kb-001#1]),` 「不超过 300 字」是整个隔离设计的关键:子 Agent 读多少都行,交回去的必须短。实测模型只是大概遵守,下面会看到 400 多字。
- `查不到的点明确写「帮助中心未提及」。` 子 Agent 不能编。查不到要明说,主 Agent 才知道哪里缺。
- `你看不到客户和客服之前的对话,任务里没写的背景就当不存在。` 让子 Agent 清楚自己的边界,不要凭空猜客户是谁。
- `class SubResult:` 子 Agent 的成绩单,不只是结论,还有它花了多少。
- `inner_tokens: int  # 子 Agent 自己的 messages 最后涨到多少 token` 它「脏活」有多脏。
- `ledger: Ledger     # 子 Agent 自己的账本:调了几次模型、输入输出多少 token、花了多少钱` 子 Agent 的钱要单独记,才能和主 Agent 的合起来算总账。
- `def run_subagent(task: str, max_steps: int = 8) -> SubResult:` `max_steps=8` 比主 Agent 的 6 大一点,调研本来就要多查几次。
- `client = LLMClient()  # 新建一个客户端,账本和主 Agent 分开` 子 Agent 自己一个客户端。这也是以后可以给它换便宜模型的地方(`LLMClient(model=...)`)。
- `messages = [{"role": "system", "content": SUB_SYSTEM}, {"role": "user", "content": task}]` **这就是「隔离」本身**:一个全新的列表,只有调研规则和这个任务,没有主对话的任何历史。
- `res = loop(client, messages, TOOLS, FUNCS, max_steps)` 和主 Agent 用同一个循环函数、同一组只读工具。
- `conclusion = res.answer if res.finished else "子任务没有在步数上限内完成,下面的信息可能不全。"` 步数用完时,把一句警告当结论交回去,主 Agent 看到就知道资料不全。(练习 3 看这个降级的缺点。)
- `inner = sum(message_tokens(m) for m in res.messages)` 把子 Agent 整个 messages 数一遍,即「它自己的窗口里最后装了多少」。
- `return SubResult(conclusion, res.calls, inner, client.ledger, res.finished)` 打包返回。
- `RESEARCH_TOOL = {"type": "function", "function": {` 把子 Agent 包装成主 Agent 的一个普通工具。
- `"description": "把一个需要查很多篇帮助文章的问题交给调研助手,返回整理好的短结论(带出处)。"` 前半句:干什么。
- `"适合「对比几种套餐」「列出所有和发票有关的规则」这类要翻很多资料的任务;单个问题直接用 search_kb。"` 中间:什么时候该用、什么时候别用。告诉主 Agent 简单问题别派子 Agent。
- `"调研助手看不到你和客户的对话,客户说过的、和任务有关的情况要写进 task 里。",` 最后一句是今天最重要的一句,下面「坑」一节用实验证明它的作用。
- `SUB_LOG: list[SubResult] = []  # 每次子 Agent 跑完,把成绩单放这里,方便外面统计` 模块级的列表,相当于一个简易的「日志桶」。harness 和实验脚本都从这里读子 Agent 的账。
- `def research(task: str) -> str:` 主 Agent 能调的函数,签名和 `search_kb` 一样:字符串进、字符串出。
- `SUB_LOG.append(result)` 先留一份成绩单,再把结论返回。
- `return result.conclusion` 只交回结论,`inner_tokens`、中间的几次检索、读到的全文,都不出这个函数。
- `r = run_subagent(task)` 以下是直接运行时的小测试:不经过主 Agent,直接让子 Agent 做一次调研。
- `print(f"自己的 messages 涨到 {r.inner_tokens} token;{r.ledger}")` 子 Agent 的账:自己的窗口多大、花了多少。

</div>

```bash
uv run python -m part04.subagent
```

```text
子 Agent 调了 6 次工具:
  search_kb {"query": "免费版 专业版 企业版 套餐对比 账本数量 成员数量"}
  search_kb {"query": "导出次数限制"}
  search_kb {"query": "增值税专用发票 开票"}
  search_kb {"query": "退款政策 各套餐"}
  get_article {"doc_id": "kb-001"}
  get_article {"doc_id": "kb-002"}
自己的 messages 涨到 1971 token;3 次调用 | 输入 4413 / 输出 558 tokens | 约 ¥0.0080
交回的结论 515 字:
**三档套餐对比结论**

**账本数**：免费版 1 个；专业版最多 5 个；企业版不限 [kb-001#1]

**成员数**：免费版 1 名；专业版最多 3 名；企业版不限 [kb-001#1][kb-015#2]

**导出次数**：免费版每天 1 次；专业版和企业版每天 20 次 [kb-014#2]

**增值税专用发票**：仅企业版，或年付的专业版可以开具；所有付费订单都可以开具电子普通发票 [kb-006#1]

**退款规则**：
- 月付：不支持中途退款，当期费用不退 [kb-002#2]
- 年付（专业版、企业版）：按剩余整月数比例退款，已使用月份和当前月份不退 [kb-002#1]
- 重复扣款：核实后全额退还重复的那一笔，3 个工作日内原路退回 [kb-002#3]
- 已开发票的订单需先红冲才能退款 [kb-003#2]

**补充**：免费版每月最多记录 200 条流水；专业版流水不限条数，并支持多币种；企业版包含开放 API 和专属客服 [kb-001#1]

**帮助中心未提及**：免费版是否可开具发票（仅说明“所有付费订单”可开电子普通发票，免费版无付费订单）[kb-006#1]
```

按行读。子 Agent 第一轮一次发了 4 个 `search_kb`(账本和成员、导出次数、专票、退款),第二轮觉得退款和套餐的片段不够,读了 kb-001 和 kb-002 两篇全文,第三轮才写结论。一共 3 次模型调用、6 次工具调用,**自己的 messages 涨到了 1971 token**,花 ¥0.0080。交回的结论 515 字:**要求的是不超过 300 字,实际是 515**。我另外跑过几次,430、444、453、367、436 字,没有一次在 300 以内。「不超过 N 字」模型只是大概遵守,下面练习 3 会在代码里再卡一道。

## 第三步:同一场对话,量一量隔离到底省了什么

光看一次不够。写一个对比脚本,同一场三轮对话,两种做法:A 是主 Agent 自己查(Day 266 的做法);B 是给主 Agent 多一个 `research` 工具,说明书里告诉它「要翻很多篇文章的交给 research」。三个问题:

1. 帮我对比一下三种套餐在账本数、成员数、导出次数、能不能开增值税专用发票、退款规则上的区别
2. 我们公司 5 个人,要开 3 个账本,还要开增值税专用发票,选哪个套餐?
3. 那年付专业版用到第 3 个月想取消,能退多少?

后两个问题用的是第一个问题里已经查到的信息,看后续轮次会不会因此不同。新建 `part04/subagent_demo.py`:

```python
# agent-zero-lab/part04/subagent_demo.py  同一场三轮对话,主 Agent 自己翻资料 vs 把翻资料交给子 Agent:主对话的上下文差多少、总共花多少
from typing import Any

from common.llm import LLMClient
from part04.agent_loop import loop
from part04.agentic_rag import SYSTEM_AGENT
from part04.ctx_budget import message_tokens
from part04.kb_tools import FUNCS, TOOLS
from part04.subagent import RESEARCH_TOOL, SUB_LOG, research

QUESTIONS = [
    "帮我对比一下三种套餐在账本数、成员数、导出次数、能不能开增值税专用发票、退款规则上的区别",
    "我们公司 5 个人,要开 3 个账本,还要开增值税专用发票,选哪个套餐?",
    "那年付专业版用到第 3 个月想取消,能退多少?",
]
SYSTEM_DELEGATE = SYSTEM_AGENT + "\n需要对比几种套餐、或者要翻很多篇文章才能答的问题,交给 research;单个问题用 search_kb。"


def conversation(label: str, system: str, tools: list[dict], funcs: dict) -> float:
    client = LLMClient()
    messages: list[dict[str, Any]] = [{"role": "system", "content": system}]
    print(f"== {label}")
    for i, q in enumerate(QUESTIONS, 1):
        before = client.ledger.prompt_tokens
        res = loop(client, [*messages, {"role": "user", "content": q}], tools, funcs, max_steps=8)
        messages = res.messages
        names = [n for n, _ in res.calls]
        print(f"  第 {i} 问 工具 {names}  这一问输入 {client.ledger.prompt_tokens - before} token  "
              f"对话现在 {len(messages)} 条 / {sum(message_tokens(m) for m in messages)} token")
    sub_cost = sum(s.ledger.cost for s in SUB_LOG)
    print(f"  主 Agent {client.ledger}" + (f"  子 Agent {len(SUB_LOG)} 次共 ¥{sub_cost:.4f}" if SUB_LOG else ""))
    return client.ledger.cost + sub_cost


if __name__ == "__main__":
    a = conversation("A 主 Agent 自己查", SYSTEM_AGENT, TOOLS, FUNCS)
    SUB_LOG.clear()
    b = conversation("B 可以派子 Agent", SYSTEM_DELEGATE, [*TOOLS, RESEARCH_TOOL], {**FUNCS, "research": research})
    print(f"\n总花费 A ¥{a:.4f}  B ¥{b:.4f}(含子 Agent)")
```

<div class="line-notes">

- `from part04.agentic_rag import SYSTEM_AGENT` Day 266 的系统提示词,A 组直接用。
- `QUESTIONS = [` 三个问题。
- `SYSTEM_DELEGATE = SYSTEM_AGENT + "\n需要对比几种套餐、或者要翻很多篇文章才能答的问题,交给 research;单个问题用 search_kb。"` B 组的系统提示词:在 A 的基础上加一句,告诉主 Agent 什么时候派子 Agent。除了这一句和多一个工具,两组完全一样。
- `def conversation(label: str, system: str, tools: list[dict], funcs: dict) -> float:` 跑一场三轮对话,返回总花费(含子 Agent)。
- `messages: list[dict[str, Any]] = [{"role": "system", "content": system}]` 对话从一条 system 开始,三个问题**共用同一个** `messages`,每一轮在上一轮的基础上接着聊。这就是「上下文会越来越长」的真实场景。
- `before = client.ledger.prompt_tokens` 问之前先记下累计输入 token,问完相减就是这一问的输入。
- `res = loop(client, [*messages, {"role": "user", "content": q}], tools, funcs, max_steps=8)` 把新问题接在历史后面发出去。`*messages` 展开成一条条。
- `messages = res.messages` 循环返回完整的 messages,存回去,下一问接着用。
- `names = [n for n, _ in res.calls]` 这一问用了哪些工具。
- `f"对话现在 {len(messages)} 条 / {sum(message_tokens(m) for m in messages)} token"` 主对话此刻的大小,今天最关心的一列。
- `sub_cost = sum(s.ledger.cost for s in SUB_LOG)` 把所有子 Agent 的钱加起来。
- `return client.ledger.cost + sub_cost` 主 Agent 的钱加子 Agent 的钱,才是总花费。
- `SUB_LOG.clear()` 跑 B 之前清空日志桶,避免混进别的。

</div>

```bash
uv run python -m part04.subagent_demo
```

```text
== A 主 Agent 自己查
  第 1 问 工具 ['search_kb', 'search_kb', 'search_kb', 'search_kb', 'get_article']  这一问输入 4094 token  对话现在 10 条 / 2055 token
  第 2 问 工具 []  这一问输入 2600 token  对话现在 12 条 / 2370 token
  第 3 问 工具 []  这一问输入 2902 token  对话现在 14 条 / 2639 token
  主 Agent 5 次调用 | 输入 9596 / 输出 1269 tokens | 约 ¥0.0143
== B 可以派子 Agent
  第 1 问 工具 ['research']  这一问输入 1919 token  对话现在 5 条 / 1027 token
  第 2 问 工具 []  这一问输入 1605 token  对话现在 7 条 / 1242 token
  第 3 问 工具 []  这一问输入 1807 token  对话现在 9 条 / 1401 token
  主 Agent 4 次调用 | 输入 5331 / 输出 841 tokens | 约 ¥0.0099  子 Agent 1 次共 ¥0.0100

总花费 A ¥0.0143  B ¥0.0198(含子 Agent)
```

整理成表:

| | A 主 Agent 自己查 | B 派子 Agent |
| --- | --- | --- |
| 第 1 问调用的工具 | `search_kb` ×4 + `get_article` ×1 | `research` ×1 |
| 第 1 问之后的主对话 | 10 条 / 2055 token | 5 条 / 1027 token |
| 第 2 问之后 | 12 条 / 2370 token | 7 条 / 1242 token |
| 第 3 问之后 | 14 条 / 2639 token | 9 条 / 1401 token |
| 第 2 问的输入 token | 2600 | 1605 |
| 第 3 问的输入 token | 2902 | 1807 |
| 主 Agent 费用 | ¥0.0143 | ¥0.0099 |
| 子 Agent 费用 | | ¥0.0100 |
| 总费用 | ¥0.0143 | ¥0.0198(多 38%) |

读法:

**主对话确实变短了,而且一直短。** 第 1 问之后差 1028 token,三问之后差 1238。后面每一问的输入 token 少了 1000 左右(2600 对 1605,2902 对 1807),因为那几千字的原文不在历史里了。如果这场对话继续聊 20 轮,每一轮都省这 1000 token,节省是累加的。

**但总费用更高了。** 三轮下来 B 贵 38%。原因:子 Agent 自己也要花钱查资料,而且这一次的查询并没有因为「隔离」变少,只是换了个地方花。第 1 问里,A 一次花掉的资料检索,B 里变成了子 Agent 的 ¥0.0100,再加上主 Agent 多出来的一轮「调用 research、拿回结论、写回答」。**隔离省的是主对话的长度,不是总 token。** Anthropic 在介绍他们的多 Agent 调研系统时说,按他们的数据,Agent 的 token 用量大约是普通聊天的 4 倍,多 Agent 系统大约是 15 倍(那是他们自己的系统和数据,不是规律,但方向一致)。

**什么时候值得?** 看三个数:这个任务**探索量**大不大(子 Agent 自己的窗口涨到多少)、**结论**短不短、之后主对话**还要聊多少轮**。探索量大、结论短、后面还要聊很久,值得;只问一次就结束的对话,隔离是纯额外花销。所以描述里写「单个问题直接用 search_kb」。

两个小提醒。第一,这场对话的第 2、3 问两组都没调工具,答案直接从上下文里来(第 3 问的退款规则,A 的历史里有 kb-002 原文,B 的结论里也带了)。这是巧合,不是规律:如果第 3 问是「导出一次最多多少行」,两组都得再查。第二,A 组第 1 问用了 5 次工具(4 次检索加 1 次读全文),上面单独跑子 Agent 那次是 6 次,同一个问题每次的路线都有出入,这是 Day 261 讲的噪声,只对一次结论要小心。

## 第四步:子 Agent 看不到你的对话

隔离的代价之一是**信息进不去**。子 Agent 的 `messages` 是新建的,里面没有主对话的任何东西。客户在第 1 轮说「我们是年付企业版,10 个席位,下个月想降级到专业版」,主 Agent 调 `research` 时如果只写「查一下退款规则」,子 Agent 就只能给出一份面向所有人的通用结论。

先直接对比,不经过主 Agent。新建 `part04/subagent_blind.py`:

```python
# agent-zero-lab/part04/subagent_blind.py  坑:子 Agent 看不到主对话。客户早先说过的背景,主 Agent 不写进 task,它就当不存在
from part04.subagent import run_subagent

bare = "查一下退款规则"
with_ctx = "查一下退款规则。客户是年付企业版,10 个席位,下个月想降级到专业版,只整理和他有关的部分。"
for label, task in (("task 里没带背景", bare), ("task 里带了背景", with_ctx)):
    r = run_subagent(task)
    print(f"== {label}:{task!r}\n结论 {len(r.conclusion)} 字,{len(r.calls)} 次工具\n{r.conclusion}\n")
```

<div class="line-notes">

- `bare = "查一下退款规则"` 没带背景的 task,相当于主 Agent 偷懒时会写的那种。
- `with_ctx = "查一下退款规则。客户是年付企业版,10 个席位,下个月想降级到专业版,只整理和他有关的部分。"` 带了背景的 task。
- `for label, task in (("task 里没带背景", bare), ("task 里带了背景", with_ctx)):` 同一个子 Agent,只换 `task`。
- `r = run_subagent(task)` 直接调,不经过主 Agent。
- `print(f"== {label}:{task!r}\n结论 {len(r.conclusion)} 字,{len(r.calls)} 次工具\n{r.conclusion}\n")` 打印结论全文,`{task!r}` 加引号方便看清 task。

</div>

```bash
uv run python -m part04.subagent_blind
```

```text
== task 里没带背景:'查一下退款规则'
结论 460 字,4 次工具
**退款规则结论**

1. 年付套餐（专业版、企业版）中途取消，按剩余整月数比例退款；已使用月份和当前月份不退。例：年付专业版 468 元（39 元/月），第 3 个月中途取消，退 9 个月共 351 元 [kb-002#1]。
2. 月付套餐不支持中途退款；取消后当期结束停止服务，当期费用不退 [kb-002#2]。
3. 重复扣款：核实后全额退还重复那一笔，3 个工作日内原路退回 [kb-002#3]。
4. 申请路径：设置 → 订阅 → 申请退款，选择原因提交，客服主管 1 个工作日内审批 [kb-003#1]。
5. 到账时间：审批通过后原路退回，支付宝 1–3 个工作日，银行卡 3–7 个工作日 [kb-002#4]。
6. 使用优惠码的订单按实际支付金额退款，优惠部分不退现金 [kb-008#2]。
7. 已开发票的订单需先完成发票红冲才能退款；电子普通发票一般当天完成，增值税专用发票需配合退回或开红字信息表 [kb-003#2]。

其他退款情形（如企业版特殊条款、超期退款）帮助中心未提及。

== task 里带了背景:'查一下退款规则。客户是年付企业版,10 个席位,下个月想降级到专业版,只整理和他有关的部分。'
结论 427 字,6 次工具
**结论（年付企业版 10 席位 → 专业版）**

1. 降级在当前计费周期结束后生效，**不退差价**；降级后超出新套餐额度的账本变为只读，数据不删除 [kb-005#2]。
2. 专业版最多 3 名成员、最多 5 个账本；企业版成员和账本不限 [kb-001#1][kb-015#2]。客户现有 10 个席位，降级后需减至 3 人以内。
3. 若改为「中途取消年付企业版」而非降级：按剩余整月数比例退款，已用月份和当月不退 [kb-002#1]。年付企业版 1908 元/年，折合每月 159 元。
4. 退款需在「设置 → 订阅 → 申请退款」提交，客服主管 1 个工作日内审批；支付宝 1–3 个工作日、银行卡 3–7 个工作日原路到账 [kb-003#1][kb-002#3]。
5. 若订单用过优惠码，按实际支付金额退款，优惠部分不退现金 [kb-008#2]。
6. 减少席位是否单独退费、降级与退款能否同时申请：**帮助中心未提及**。
```

差别很清楚。没带背景的结论是一份全面的退款规则清单,七条,每一条都对,可是**漏了客户真正关心的**:他要的不是中途取消,是降级,降级的规则在 kb-005 里(降级在周期结束后生效,**不退差价**),这份结论根本没查。带了背景的版本一开头就是「降级在当前计费周期结束后生效,不退差价」,还主动指出专业版最多 3 名成员、客户有 10 个席位,降级后要减到 3 人以内。两份结论都没有错,但对这位客户,一份有用,一份无用。

这个坑怎么治?在主 Agent 的 `research` 工具说明书里写「客户说过的、和任务有关的情况要写进 task 里」,就是 `subagent.py` 里那句话。但它真的起作用吗?别只信我,练习 2 用主 Agent 真实跑三遍,有这句话 3/3 把背景写进了 `task`,去掉这句话 0/3。

## 第五步:harness,模型之外的那一层

回头看这一周,我们一点一点写了好些东西:Day 263 的清理旧工具结果和总结压缩,Day 264 的短期会话存取和长期记忆,Day 266 的 Agent 循环,今天的子 Agent。它们各自都有自己的 `__main__` 和小演示,但真的做一个客服机器人,这些东西得按顺序接起来:每来一句话,先取记忆,再整理历史,拼出 system,跑循环,存回去,留一份记录。**把这条线接起来的那层代码,就是 harness。**

harness 原意是马具、挽具,把马的力气接到车上的那一整套东西。放在 Agent 里:**模型是马,harness 是模型之外让它能干活的全部工程。** Anthropic 在 2025 年 11 月的文章《Effective harnesses for long-running agents》里把 Claude Agent SDK 称为「一个通用的 agent harness」(原文:a powerful, general-purpose agent harness),他们讨论的是跨很多个上下文窗口的长任务怎么接力:第一次运行时由一个「初始化」Agent 搭好环境、写好进度记录文件、做一次初始提交,之后每个会话在这个基础上做一点增量,并把结构化的进度留给下一个会话。这是 harness 的一种,我们今天写的是客服场景的一种。

一个 harness 通常包括六块,下面这张表把它们对到本课程里写过的东西上:

| 块 | 是什么 | 我们写过的 |
| --- | --- | --- |
| Agent 循环 | 调模型、解析工具调用、执行、回传、判断结束,带步数上限 | Day 170、`agent_loop.py` |
| 工具注册 | 有哪些工具、说明书、映射表;MCP、skills 也在这一层 | `kb_tools.py`;MCP 在第五部分 |
| 上下文组装 | 每一轮窗口里放什么:system、工具、记忆、检索、整理后的历史 | Day 262 预算、263 清理和压缩、264 召回 |
| 状态持久化 | 会话存取、长任务中断后接着跑 | Day 264 `session_store.py`;checkpoint 在第五部分 |
| 执行环境和安全 | 权限分级、工具参数校验、危险操作要人批 | `get_article` 白名单;第七部分系统讲 |
| 可观测 | 每一轮的 trace、token、耗时、花费 | 今天的轨迹;第六部分系统讲 |

<figure>
<svg viewBox="0 0 640 280" role="img" aria-label="harness 一轮的流程:用户一句话进来,取长期记忆和短期历史,清理旧工具结果,超过阈值就总结压缩,拼 system,跑 Agent 循环(可以调 search_kb、get_article、research 子 Agent),把新增消息存回会话,写一行轨迹,返回回答">
<rect x="0" y="0" width="640" height="280" fill="var(--paper-raised)"/>
<defs><marker id="hn267a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--ink-soft)"/></marker></defs>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="36" width="110" height="52" rx="4" fill="none" stroke="var(--rule)"/>
<text x="75" y="58" fill="var(--ink)" text-anchor="middle">用户一句话</text>
<text x="75" y="76" fill="var(--ink-soft)" text-anchor="middle" font-size="11">turn(text)</text>
<line x1="130" y1="62" x2="152" y2="62" stroke="var(--ink-soft)" marker-end="url(#hn267a)"/>
<rect x="154" y="36" width="110" height="52" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="209" y="58" fill="var(--ink)" text-anchor="middle">1 取记忆</text>
<text x="209" y="76" fill="var(--ink-soft)" text-anchor="middle" font-size="11">recall + load</text>
<line x1="264" y1="62" x2="286" y2="62" stroke="var(--ink-soft)" marker-end="url(#hn267a)"/>
<rect x="288" y="36" width="130" height="52" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="353" y="58" fill="var(--ink)" text-anchor="middle">2 整理历史</text>
<text x="353" y="76" fill="var(--ink-soft)" text-anchor="middle" font-size="11">清工具结果;超阈值压缩</text>
<line x1="418" y1="62" x2="440" y2="62" stroke="var(--ink-soft)" marker-end="url(#hn267a)"/>
<rect x="442" y="36" width="110" height="52" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="497" y="58" fill="var(--ink)" text-anchor="middle">3 拼 system</text>
<text x="497" y="76" fill="var(--ink-soft)" text-anchor="middle" font-size="11">规矩 + 记忆(未核实)</text>
<line x1="497" y1="88" x2="497" y2="120" stroke="var(--ink-soft)" marker-end="url(#hn267a)"/>
<rect x="400" y="122" width="220" height="64" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="510" y="144" fill="var(--ink)" text-anchor="middle">4 Agent 循环(max_steps)</text>
<text x="510" y="162" fill="var(--ink-soft)" text-anchor="middle" font-size="11">search_kb / get_article</text>
<text x="510" y="177" fill="var(--ink-soft)" text-anchor="middle" font-size="11">research → 子 Agent</text>
<line x1="400" y1="154" x2="372" y2="154" stroke="var(--ink-soft)" marker-end="url(#hn267a)"/>
<rect x="250" y="122" width="120" height="64" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="310" y="150" fill="var(--ink)" text-anchor="middle">5 存回会话</text>
<text x="310" y="168" fill="var(--ink-soft)" text-anchor="middle" font-size="11">save(thread)</text>
<line x1="250" y1="154" x2="222" y2="154" stroke="var(--ink-soft)" marker-end="url(#hn267a)"/>
<rect x="104" y="122" width="116" height="64" rx="4" fill="none" stroke="var(--rule)"/>
<text x="162" y="150" fill="var(--ink)" text-anchor="middle">6 记轨迹</text>
<text x="162" y="168" fill="var(--ink-soft)" text-anchor="middle" font-size="11">一行 JSON</text>
<text x="20" y="222" fill="var(--ink-soft)">会话结束(另外触发):remember() 写长期记忆 → user_memories</text>
<text x="20" y="244" fill="var(--ink-faint)" font-size="11">模型是马,harness 是除了模型之外的所有东西。每一步都是这周写过的零件。</text>
</g>
</svg>
<figcaption>harness 一轮的六步。1 到 3 是「上下文组装」(Day 262 到 264),4 是 Agent 循环(Day 266、今天的子 Agent),5、6 是状态和可观测。会话结束后另外触发 `remember` 写长期记忆,不在每一轮里。</figcaption>
</figure>

下面把它写成 `part04/harness.py`。一个 `Harness` 对象管一个用户的一个会话(`thread_id`),`turn(text)` 处理一句话:

```python
# agent-zero-lab/part04/harness.py  Harness:模型之外让它能干活的那一层。把这周写过的零件按顺序接起来,每一轮留一份轨迹
import json
import time
from pathlib import Path
from typing import Any

import psycopg

from common.llm import LLMClient
from part04.agent_loop import loop
from part04.compaction import compact
from part04.ctx_budget import message_tokens
from part04.kb_tools import FUNCS, TOOLS
from part04.memory_chat import MEMORY_HEADER
from part04.memory_store import recall
from part04.session_store import load, save
from part04.subagent import RESEARCH_TOOL, SUB_LOG, research
from part04.tool_clearing import clear_old_tool_results

SYSTEM = """你是云簿 CloudLedger 的客服助手,可以用工具查帮助中心。
涉及 CloudLedger 的规则、价格、操作步骤、错误码时,必须先查帮助中心,不要凭记忆回答。
需要对比几种套餐、或者要翻很多篇文章才能答的问题,交给 research;单个问题用 search_kb。
回答时在事实后面用方括号标出处,例如 [kb-002#1]。查不到就说「帮助中心里没有找到这个问题的说明,建议转人工客服」。
回答用简洁的中文,先给结论。"""

MAIN_TOOLS = [*TOOLS, RESEARCH_TOOL]
MAIN_FUNCS = {**FUNCS, "research": research}
TRACE = Path("out/harness_trace.jsonl")


class Harness:
    def __init__(self, conn: psycopg.Connection, user_id: str, thread_id: str,
                 compact_at: int = 3000, max_steps: int = 6) -> None:
        self.conn, self.user_id, self.thread_id = conn, user_id, thread_id
        self.compact_at, self.max_steps = compact_at, max_steps
        self.client = LLMClient()  # 这个 harness 自己的账本,子 Agent 另有自己的

    def turn(self, text: str) -> str:
        start = time.perf_counter()
        trace: dict[str, Any] = {"thread": self.thread_id, "user": text}
        calls_before, sub_before = self.client.ledger.calls, len(SUB_LOG)

        # 1. 取记忆:长期记忆按这句话召回,短期记忆是这个会话以前的 messages
        memories = recall(self.conn, self.user_id, text)
        history = load(self.thread_id)
        trace["memories"] = memories
        trace["history_msgs"] = len(history)

        # 2. 整理历史:先清旧工具结果(不花钱),超了再总结压缩(花一次调用)
        history = clear_old_tool_results(history, keep_recent=2)
        before = sum(message_tokens(m) for m in history)
        compacted = compact(self.client, history, keep_last_turns=3, trigger_tokens=self.compact_at)
        trace["compacted"] = compacted is not history
        history = compacted
        trace["history_tokens"] = [before, sum(message_tokens(m) for m in history)]

        # 3. 拼 system:固定规矩 + 记忆(标明没经过核实)
        system = SYSTEM + (("\n\n" + MEMORY_HEADER + "\n" + "\n".join(f"- {m}" for m in memories)) if memories else "")
        prefix = [{"role": "system", "content": system}, *history]

        # 4. 跑循环
        res = loop(self.client, [*prefix, {"role": "user", "content": text}], MAIN_TOOLS, MAIN_FUNCS, self.max_steps)
        answer = res.answer if res.finished else "这个问题我处理得不太顺利,已经帮你转给人工客服。"
        trace["tools"] = [name for name, _ in res.calls]
        trace["finished"] = res.finished

        # 5. 存回去:这一轮新增的消息(user、assistant、tool 都要)接在整理后的历史后面
        save(self.thread_id, [*history, *res.messages[len(prefix):]])

        # 6. 记轨迹:这一轮主 Agent 调了几次模型、子 Agent 干了什么、花了多少
        subs = SUB_LOG[sub_before:]
        trace["main_calls"] = self.client.ledger.calls - calls_before
        trace["sub"] = [{"tools": len(s.calls), "inner_tokens": s.inner_tokens, "concl_chars": len(s.conclusion),
                         "cost": round(s.ledger.cost, 4)} for s in subs]
        trace["seconds"] = round(time.perf_counter() - start, 1)
        TRACE.parent.mkdir(exist_ok=True)
        with TRACE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(trace, ensure_ascii=False) + "\n")
        return answer
```

<div class="line-notes">

- `from part04.compaction import compact` Day 263 的总结压缩,总量没超 `trigger_tokens` 就原样返回。
- `from part04.memory_chat import MEMORY_HEADER` Day 264 写的那句「这些是客户自己说的,没有核实;权限、折扣、退款审批以系统为准」,拼记忆进 system 时要带上。
- `from part04.session_store import load, save` Day 264 的短期记忆:按 `thread_id` 存取会话的 messages。
- `from part04.subagent import RESEARCH_TOOL, SUB_LOG, research` 今天的子 Agent。
- `SYSTEM = """你是云簿 CloudLedger 的客服助手,可以用工具查帮助中心。` 主 Agent 的 system 和 Day 266 的 `SYSTEM_AGENT` 基本一样,多一句派子 Agent 的规矩。
- `需要对比几种套餐、或者要翻很多篇文章才能答的问题,交给 research;单个问题用 search_kb。` 和 `subagent_demo.py` 里的 B 组一样。
- `MAIN_TOOLS = [*TOOLS, RESEARCH_TOOL]` 主 Agent 能用三个工具:两个查资料的和一个派子 Agent 的。
- `MAIN_FUNCS = {**FUNCS, "research": research}` 对应的映射表。**子 Agent 只能用 `TOOLS` 里那两个**,不在这里(练习 4 把这条写成断言)。
- `TRACE = Path("out/harness_trace.jsonl")` 轨迹文件,一行一轮。
- `def __init__(self, conn: psycopg.Connection, user_id: str, thread_id: str,` 一个 `Harness` 对应一个用户的一个会话。`conn` 是 Postgres 连接,记忆表在里面。
- `compact_at: int = 3000, max_steps: int = 6) -> None:` 压缩阈值和步数上限都是参数,默认 3000 token 和 6 步,和 Day 263、266 一致。
- `self.client = LLMClient()  # 这个 harness 自己的账本,子 Agent 另有自己的` 主 Agent 的钱记在这里,子 Agent 的钱记在 `SUB_LOG` 里。
- `def turn(self, text: str) -> str:` 处理一句话,返回回答。下面按注释里的 1 到 6 步走。
- `trace: dict[str, Any] = {"thread": self.thread_id, "user": text}` 轨迹从一个字典开始,每步往里填。
- `calls_before, sub_before = self.client.ledger.calls, len(SUB_LOG)` 记下这一轮开始时的调用次数和 `SUB_LOG` 长度,最后相减得到「这一轮」的数字。
- `memories = recall(self.conn, self.user_id, text)` 第 1 步:长期记忆,用这句话去召回。Day 264 的 `recall` 带 `WHERE user_id`。
- `history = load(self.thread_id)` 短期记忆:这个会话以前的消息。新会话是空列表。
- `history = clear_old_tool_results(history, keep_recent=2)` 第 2 步:先清,不花钱。保留最近 2 条工具结果的原文,更早的、超过 200 字的换成占位。
- `before = sum(message_tokens(m) for m in history)` 清理之后、压缩之前的 token 数,记进轨迹。
- `compacted = compact(self.client, history, keep_last_turns=3, trigger_tokens=self.compact_at)` 超过阈值才压缩,留最近 3 轮原文。没超就**原样返回同一个列表对象**。
- `trace["compacted"] = compacted is not history` `is not` 比较的是「是不是同一个对象」,不是内容相等。`compact` 没压缩时返回的就是传进去的那个列表,所以 `is not` 为 `False`;压缩了返回新列表,为 `True`。
- `system = SYSTEM + (("\n\n" + MEMORY_HEADER + "\n" + "\n".join(f"- {m}" for m in memories)) if memories else "")` 第 3 步:固定规矩,后面接上召回的记忆(没有记忆就什么都不接)。记忆放在 system 里,而且带那句「没有核实」的提醒。
- `prefix = [{"role": "system", "content": system}, *history]` 这一轮「用户这句话之前」的所有消息。后面存回会话时,要靠 `len(prefix)` 切出这一轮新增的。
- `res = loop(self.client, [*prefix, {"role": "user", "content": text}], MAIN_TOOLS, MAIN_FUNCS, self.max_steps)` 第 4 步:跑循环。
- `answer = res.answer if res.finished else "这个问题我处理得不太顺利,已经帮你转给人工客服。"` 步数用完的降级,由 harness 决定怎么说。
- `save(self.thread_id, [*history, *res.messages[len(prefix):]])` 第 5 步:存回会话。注意存的是**整理后的** `history`,加上这一轮新增的消息(user、assistant、tool 都要),不存 system(system 每一轮重新拼)。`res.messages[len(prefix):]` 切掉前面的 prefix,剩下的就是新增的。
- `subs = SUB_LOG[sub_before:]` 第 6 步:这一轮新增的子 Agent 成绩单。
- `trace["main_calls"] = self.client.ledger.calls - calls_before` 主 Agent 这一轮调用了几次模型,压缩那一次也算在里面。
- `trace["sub"] = [{"tools": len(s.calls), "inner_tokens": s.inner_tokens, "concl_chars": len(s.conclusion),` 每个子 Agent 记四样:调了几次工具、自己的窗口涨到多少、交回多少字、花了多少钱。
- `with TRACE.open("a", encoding="utf-8") as f:` 追加一行 JSON。
- `return answer` 回答交给调用方。

</div>

再写一个演示脚本,让它走一个完整的故事:一个会话聊五轮,会话结束写长期记忆,再开一个新会话问「我们现在是什么套餐」。新建 `part04/harness_demo.py`:

```python
# agent-zero-lab/part04/harness_demo.py  跑一遍 harness:一个会话聊三轮,会话结束写长期记忆,再开新会话看它还记不记得
import json

from common.llm import LLMClient
from part04.harness import TRACE, Harness
from part04.memory_store import forget, init, remember
from part04.pg_store import connect
from part04.session_store import SESSION_DIR, load

USER = "u-harness"
conn = connect()
init(conn)
forget(conn, USER)
for f in SESSION_DIR.glob("t-h*.json"):
    f.unlink()
TRACE.unlink(missing_ok=True)

h1 = Harness(conn, USER, "t-h1", compact_at=1000)  # 演示用,故意把压缩线设低
for text in ("帮我对比一下三种套餐在账本数、成员数、导出次数、能不能开增值税专用发票、退款规则上的区别",
             "我们公司是年付的专业版,5 个人在用,账本也快不够了,要不要升级?",
             "升级的话,差价怎么算?",
             "升级以后,账本里原来的数据会保留吗?",
             "好的,我先去试试,谢谢"):
    answer = h1.turn(text)
    print(f"\n客户:{text}\n客服:{answer[:150]}{'…' if len(answer) > 150 else ''}")

print("\n== 会话结束,写长期记忆")
writer = LLMClient()
for line in remember(conn, writer, USER, load("t-h1")):
    print(" ", line)

h2 = Harness(conn, USER, "t-h2", compact_at=1000)
text = "我们现在是什么套餐?上次聊的升级后来怎么说的?"
print(f"\n== 新会话 t-h2\n客户:{text}\n客服:{h2.turn(text)}")

print("\n== 轨迹")
for line in TRACE.read_text(encoding="utf-8").splitlines():
    t = json.loads(line)
    print(f"{t['thread']} 工具 {t['tools']} 主调用 {t['main_calls']} 次 | 记忆 {len(t['memories'])} 条 | "
          f"历史 {t['history_msgs']} 条 {t['history_tokens']} token,压缩过 {t['compacted']} | 子 Agent {t['sub']} | {t['seconds']} 秒")
print("主 Agent", h1.client.ledger, "+", h2.client.ledger)
forget(conn, USER)
```

<div class="line-notes">

- `from part04.harness import TRACE, Harness` 上面的 harness 和轨迹文件路径。
- `USER = "u-harness"` 用户编号。
- `forget(conn, USER)` 清场,记忆从空开始。
- `for f in SESSION_DIR.glob("t-h*.json"):` 清掉上次留下的演示会话文件。`glob` 找匹配的文件。
- `TRACE.unlink(missing_ok=True)` 删掉旧轨迹,`missing_ok=True` 文件不存在时不报错。
- `h1 = Harness(conn, USER, "t-h1", compact_at=1000)  # 演示用,故意把压缩线设低` 默认 3000,但这场对话只有五轮,到不了。设成 1000 才能让第五轮触发压缩。真实系统别这么低(Day 263 讲过,阈值太低会频繁压缩,反而更贵)。
- `"帮我对比一下三种套餐在账本数、成员数、导出次数、能不能开增值税专用发票、退款规则上的区别",` 第 1 轮:对比题,该派子 Agent。
- `"我们公司是年付的专业版,5 个人在用,账本也快不够了,要不要升级?",` 第 2 轮:要用第 1 轮留下的套餐对比结论,不该再查。
- `"升级的话,差价怎么算?",` 第 3 轮:需要新查升级规则。
- `"升级以后,账本里原来的数据会保留吗?",` 第 4 轮:同上。
- `"好的,我先去试试,谢谢"):` 第 5 轮:寒暄。这时历史已经五轮,会触发压缩。
- `print(f"\n客户:{text}\n客服:{answer[:150]}{'…' if len(answer) > 150 else ''}")` 回答太长,只打印前 150 个字符,结尾补一个省略号。
- `for line in remember(conn, writer, USER, load("t-h1")):` 会话结束:把整个会话抽成长期记忆。`load("t-h1")` 取出存下的 messages,包括 tool 和 system 消息;Day 264 的 `extract` 只读 user 和 assistant 的正文。
- `h2 = Harness(conn, USER, "t-h2", compact_at=1000)` 新会话,`thread_id` 不同,短期记忆是空的。
- `text = "我们现在是什么套餐?上次聊的升级后来怎么说的?"` 只有长期记忆才答得出的问题。
- `for line in TRACE.read_text(encoding="utf-8").splitlines():` 读轨迹。
- `t = json.loads(line)` 一行 JSON 变字典。
- `print("主 Agent", h1.client.ledger, "+", h2.client.ledger)` 两个 harness 各自的账本。子 Agent 的钱在轨迹里。

</div>

```bash
uv run python -m part04.harness_demo
```

```text

客户:帮我对比一下三种套餐在账本数、成员数、导出次数、能不能开增值税专用发票、退款规则上的区别
客服:**三种套餐对比（免费版 / 专业版 / 企业版）**

| 项目 | 免费版 | 专业版 | 企业版 |
|---|---|---|---|
| 账本数 | 1 个 | 5 个 | 不限 [kb-001#1] |
| 成员数 | 1 名 | 3 名 | 不限 [kb-001#1][kb-015#2…

客户:我们公司是年付的专业版,5 个人在用,账本也快不够了,要不要升级?
客服:**结论：建议升级到企业版。** 你们现在有两个限制已经或即将触及上限。

**具体原因：**
1. **成员数已经超了**：专业版成员上限是 3 名，你们 5 个人在用，已经超出 [kb-001#1][kb-015#2]。企业版成员不限。
2. **账本快不够**：专业版账本上限 5 个，企业版不…

客户:升级的话,差价怎么算?
客服:**结论：升级立即生效，差价按当前计费周期剩余天数折算，只需补差价 [kb-005#1]。**

**你们的情况（年付专业版 → 企业版）：**
- 专业版年付 468 元（折合每月 39 元），企业版年付 1908 元 [kb-001#1]。
- 差价 = 两个套餐的年费差额，按剩余天数比例折算后…

客户:升级以后,账本里原来的数据会保留吗?
客服:**结论：会保留。升级不会影响原有数据。**

- 升级只是提升套餐额度（账本数、成员数等），立即生效，帮助中心没有提到升级会删除或迁移数据 [kb-005#1]。
- 帮助中心明确说明「数据不会删除」的是降级场景：降级后超出新套餐额度的账本会变成只读，但数据保留 [kb-005#2]。升级是额度变…

客户:好的,我先去试试,谢谢
客服:好的，祝顺利！简单提醒一下：升级是立即生效、按剩余天数补差价 [kb-005#1]，操作前如果原订单已开票，记得先红冲 [kb-003#2]。

如果升级后账本或成员显示异常，随时回来找我，也可以直接转人工客服处理。

== 会话结束,写长期记忆
  新增[profile]: 公司使用 CloudLedger 年付专业版，5 名成员在用，账本数量接近专业版上限
  新增[event]: 2026 年考虑从年付专业版升级到企业版，原因是成员数已超专业版上限（3 名）、账本接近上限（5 个）

== 新会话 t-h2
客户:我们现在是什么套餐?上次聊的升级后来怎么说的?
客服:**结论：** 我这边只能看到帮助中心的规则说明，查不到你们账户的实际订阅状态，所以「现在是什么套餐」需要你在后台「设置 → 订阅」里确认。按你之前告诉我的情况，你们用的是**年付专业版**（5 名成员、账本接近上限）。

**关于升级，帮助中心的规则是：**
- 升级**立即生效**，差价按当前周期剩余天数折算，只需补差价 [kb-005#1]。
- 专业版上限：最多 5 个账本、最多 3 名成员 [kb-001#1]。你们 5 名成员已经超过专业版上限，账本也接近 5 个上限，所以确实需要企业版（账本和成员都不限）[kb-001#1]。
- 企业版：每月 199 元，年付 1908 元，含开放 API、专属客服和增值税专用发票 [kb-001#1]。

**需要说明：** 上次沟通的具体结论（比如是否已报价、有没有特殊折扣或审批）我这边没有记录，帮助中心里也没有相关内容，建议转人工客服核实一下进度。

另外提醒一点：如果之后考虑降级，降级是当前周期结束后生效、不退差价，超出额度的账本会变只读 [kb-005#2]。

== 轨迹
t-h1 工具 ['research'] 主调用 2 次 | 记忆 0 条 | 历史 0 条 [0, 0] token,压缩过 False | 子 Agent [{'tools': 7, 'inner_tokens': 2261, 'concl_chars': 453, 'cost': 0.0089}] | 7.4 秒
t-h1 工具 [] 主调用 1 次 | 记忆 0 条 | 历史 4 条 [843, 843] token,压缩过 False | 子 Agent [] | 2.8 秒
t-h1 工具 ['search_kb'] 主调用 2 次 | 记忆 0 条 | 历史 6 条 [1196, 1196] token,压缩过 False | 子 Agent [] | 2.6 秒
t-h1 工具 ['search_kb'] 主调用 2 次 | 记忆 0 条 | 历史 10 条 [1818, 1818] token,压缩过 False | 子 Agent [] | 2.9 秒
t-h1 工具 [] 主调用 2 次 | 记忆 0 条 | 历史 14 条 [1967, 1582] token,压缩过 True | 子 Agent [] | 2.7 秒
t-h2 工具 ['search_kb', 'search_kb'] 主调用 2 次 | 记忆 2 条 | 历史 0 条 [0, 0] token,压缩过 False | 子 Agent [] | 3.8 秒
主 Agent 9 次调用 | 输入 15722 / 输出 1580 tokens | 约 ¥0.0215 + 2 次调用 | 输入 2173 / 输出 390 tokens | 约 ¥0.0060
```

先看故事。第 1 轮,客户问「三种套餐对比」,主 Agent 调了 `research`,轨迹里那一行:子 Agent 用了 7 次工具、自己的窗口涨到 2261 token、交回 453 字、花 ¥0.0089,主 Agent 只调了 2 次模型(一次发出 `research`,一次写回答),用时 7.4 秒。第 2 轮客户说「我们是年付专业版,5 个人在用」,主 Agent **没调任何工具**,直接用第 1 轮的结论回答了「建议升级到企业版」。第 3、4 轮各查了一次 `search_kb`。

**第 5 轮触发了压缩。** 轨迹最后一栏:历史 14 条,`[1967, 1582]` token,压缩过 `True`,主调用 2 次(一次压缩、一次回答)。1967 是清理旧工具结果之后、压缩之前的大小,1582 是压缩之后。只压了 385 token,是因为 `keep_last_turns=3`,五轮里只有最早的两轮被总结。

会话结束,`remember` 把整个会话抽成了两条长期记忆:一条 profile(「公司使用 CloudLedger 年付专业版,5 名成员在用,账本数量接近专业版上限」),一条 event(「考虑从年付专业版升级到企业版,原因是成员数已超专业版上限、账本接近上限」)。**新会话 `t-h2` 的短期记忆是空的,历史 0 条**,但轨迹里「记忆 2 条」,模型的回答开头就是「按你之前告诉我的情况,你们用的是年付专业版(5 名成员、账本接近上限)」,而且这句话来源标明是之前说的。它还说「我这边查不到你们账户的实际套餐状态」,没有把记忆当事实断言,这正是 `MEMORY_HEADER` 那句「没有核实」起的作用(Day 264 的设计)。

再看这几天的总账:主 Agent 两个会话共 9 + 2 次模型调用、¥0.0215 + ¥0.0060,子 Agent ¥0.0089,合计 ¥0.0364。

**这不代表回答对。** harness 只管「接起来」,不管「答得对」。我第一次跑这个演示的时候,第 3 轮的回答里模型自己推算了一个「年付周期剩 200 天大约补 789 元」的数字,资料里并没有这个公式,它标了「估算」,但仍然是编的。这类问题要靠 Day 260 的忠实裁判和评估集才抓得到,第六部分会把评估接进 harness。

## 子 Agent 的几个边界

**能用哪些工具,要有清单。** 子 Agent 的工具只给了 `search_kb` 和 `get_article` 两个只读工具,而且 `get_article` 有白名单(Day 266)。如果哪天有人为了「方便」把 `create_refund_request` 也给了子 Agent,它就能在你看不见的窗口里自己提交退款。子 Agent 的上下文用完即扔,出了问题没有对话可查。练习 4 把「子 Agent 只能有这两个工具」写成断言。**不要让子 Agent 再派子 Agent**:它们会一层套一层,每层都花钱,而且步数上限只管一层。

**要不要给它换便宜的模型。** `run_subagent` 里的 `LLMClient()` 是新建的,理论上可以 `LLMClient(model=便宜的)`。翻资料、整理结论是个相对机械的活,常见做法是子 Agent 用小模型、主 Agent 用大模型。我今天没有做这个实验,所以不知道在这个场景里小模型会不会漏要点,只能说这是该量的东西。

**子 Agent 越多,越难排查。** Cognition 的一篇文章《Don't Build Multi-Agents》(2025 年 6 月)提出两条原则:Agent 之间要共享完整的上下文和操作轨迹,不只是传一两句话;每个行动都隐含着决策,决策互相冲突就会出坏结果。我们的子 Agent 只做「只读的资料调研」,不做决定、不写东西,这两条风险都小;如果让两个子 Agent 各自去改代码或写文档,风险就大得多。Anthropic 的多 Agent 文章里也说,有些领域需要所有 Agent 共享同一个上下文,不太适合多 Agent,多数编码任务比研究任务可并行的部分少。这是第五部分「多 Agent」要正式展开的话题。

## 动手练习

**练习 1:记数。** 写 `part04/ex267_1.py`:同一个调研任务(三种套餐的五点对比),先让 `run_subagent` 做,记下它调了几次工具、几次模型、自己的窗口多大、交回的结论多少字;再让一个没有子 Agent 的主 Agent 用 `loop` 自己做同一个任务,看它的对话留在上下文里有多大。算出「主对话里多留了多少 token」。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex267_1.py  练习 1:同一个调研任务,子 Agent 里面用了多少、交回多少;再让一个没有子 Agent 的主 Agent 自己答,对比主对话的长度
from common.llm import LLMClient
from part04.agent_loop import loop
from part04.agentic_rag import SYSTEM_AGENT
from part04.ctx_budget import message_tokens
from part04.kb_tools import FUNCS, TOOLS
from part04.subagent import run_subagent

TASK = "对比免费版、专业版、企业版在账本数、成员数、导出次数、能否开增值税专用发票、退款规则上的区别"

sub = run_subagent(TASK)
print(f"子 Agent:调工具 {len(sub.calls)} 次,模型 {sub.ledger.calls} 次,自己的 messages {sub.inner_tokens} token,{sub.ledger}")
print(f"  交回主 Agent 的结论 {len(sub.conclusion)} 字 ≈ {message_tokens({'role': 'tool', 'content': sub.conclusion})} token")

client = LLMClient()
messages = [{"role": "system", "content": SYSTEM_AGENT}, {"role": "user", "content": TASK}]
res = loop(client, messages, TOOLS, FUNCS, max_steps=8)
alone = sum(message_tokens(m) for m in res.messages)
print(f"主 Agent 自己查:调工具 {len(res.calls)} 次,对话留在上下文里 {alone} token,{client.ledger}")
print(f"差别:主对话里多留了 {alone - message_tokens({'role': 'tool', 'content': sub.conclusion})} token(没算最终回答)")
```

<div class="line-notes">

- `from part04.ctx_budget import message_tokens` Day 262 的数 token 函数。
- `TASK = "对比免费版、专业版、企业版在账本数、成员数、导出次数、能否开增值税专用发票、退款规则上的区别"` 同一个任务文字,两边都用。
- `sub = run_subagent(TASK)` 子 Agent 做。
- `print(f"子 Agent:调工具 {len(sub.calls)} 次,模型 {sub.ledger.calls} 次,自己的 messages {sub.inner_tokens} token,{sub.ledger}")` 子 Agent 的四项数字:这一次 9 次工具(第一轮一次并发发了很多)、3 次模型、窗口 2427 token。
- `message_tokens({'role': 'tool', 'content': sub.conclusion})` 把结论包成一条假的 `tool` 消息数 token,因为它交回主 Agent 后就是这么一条消息。444 字约 291 token。
- `client = LLMClient()` 没有子 Agent 的主 Agent 用另一个新客户端。
- `res = loop(client, messages, TOOLS, FUNCS, max_steps=8)` 它自己调工具,没有 `research`。
- `alone = sum(message_tokens(m) for m in res.messages)` 整个对话(含 system、user、所有工具结果、最终回答)的 token,2205。
- `print(f"差别:主对话里多留了 {alone - message_tokens({'role': 'tool', 'content': sub.conclusion})} token(没算最终回答)")` 2205 − 291 = 1914。这是估算:主 Agent 自己做时的最终回答和有子 Agent 时的最终回答长度不同,没有扣除,量级是对的。

</div>

```bash
uv run python -m part04.ex267_1
```

```text
子 Agent:调工具 9 次,模型 3 次,自己的 messages 2427 token,3 次调用 | 输入 5286 / 输出 615 tokens | 约 ¥0.0095
  交回主 Agent 的结论 444 字 ≈ 291 token
主 Agent 自己查:调工具 6 次,对话留在上下文里 2205 token,3 次调用 | 输入 4452 / 输出 786 tokens | 约 ¥0.0099
差别:主对话里多留了 1914 token(没算最终回答)
```

两条看点。子 Agent 用了 2427 token 的窗口,是它自己的事,函数一返回就没了。主 Agent 自己做时,这 2205 token 全部留在主对话里。差别约 1900 token,每一轮后续对话都要多付这个数。另一方面,把两边的费用加起来,子 Agent ¥0.0095 加主 Agent 那次 `research` 的开销,而主 Agent 自己做这一整件事是 ¥0.0099;子 Agent 这一项已经快到它了,再加上主 Agent 派活、收结论、写回答的两次调用,总数还是更贵(三轮对话实验里是 ¥0.0198 对 ¥0.0143)。

</details>

**练习 2:背景到底会不会被带进去?** 主 Agent 在第一轮听客户说「我们是年付企业版,10 个席位,下个月想降级到专业版」,第二轮客户说「那降级相关的规则,退款、账本、成员、发票这几方面,你帮我都查清楚整理一下」。写 `part04/ex267_2.py`:用两种 `research` 说明书各跑三遍,一种保留「客户说过的、和任务有关的情况要写进 task 里」那句,一种去掉,打印主 Agent 实际传给 `research` 的 `task`,判断里面有没有带「年付企业版」和「10」。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex267_2.py  练习 2:客户在前面说过的背景,主 Agent 会不会写进 research 的 task 里?看两种工具说明书写法的区别
import copy
import json

from common.llm import LLMClient
from part04.agent_loop import loop
from part04.kb_tools import FUNCS, TOOLS
from part04.subagent import RESEARCH_TOOL, research
from part04.subagent_demo import SYSTEM_DELEGATE

BACKGROUND = "我们是年付企业版,10 个席位,下个月想降级到专业版。"
FOLLOW_UP = "那降级相关的规则,退款、账本、成员、发票这几方面,你帮我都查清楚整理一下。"

# 对照:把说明书里「客户说过的、和任务有关的情况要写进 task 里」这句去掉
loose = copy.deepcopy(RESEARCH_TOOL)
loose["function"]["description"] = loose["function"]["description"].split("调研助手看不到")[0]
loose["function"]["parameters"]["properties"]["task"]["description"] = "要调研的问题"

for label, tool in (("说明书里提醒了要带背景", RESEARCH_TOOL), ("说明书里没提醒", loose)):
    print(f"== {label}")
    for n in range(3):
        client = LLMClient()
        first = loop(client, [{"role": "system", "content": SYSTEM_DELEGATE}, {"role": "user", "content": BACKGROUND}],
                     [*TOOLS, tool], {**FUNCS, "research": research}, max_steps=6)
        res = loop(client, [*first.messages, {"role": "user", "content": FOLLOW_UP}],
                   [*TOOLS, tool], {**FUNCS, "research": research}, max_steps=6)
        tasks = [json.loads(raw)["task"] for name, raw in res.calls if name == "research"]
        if not tasks:
            print(f"  第 {n + 1} 遍:主 Agent 没派子 Agent,自己查了 {[name for name, _ in res.calls]}")
        for t in tasks:
            has_bg = "年付企业版" in t and "10" in t
            print(f"  第 {n + 1} 遍:task 带了背景(年付企业版、10 席位):{has_bg}\n    {t}")
```

<div class="line-notes">

- `import copy` 标准库,深拷贝。
- `from part04.subagent_demo import SYSTEM_DELEGATE` 复用对比实验里那句「要翻很多篇文章的交给 research」。导入它不会触发实验,实验在 `__main__` 里。
- `BACKGROUND = "我们是年付企业版,10 个席位,下个月想降级到专业版。"` 第一轮客户说的背景。
- `FOLLOW_UP = "那降级相关的规则,退款、账本、成员、发票这几方面,你帮我都查清楚整理一下。"` 第二轮的问题:要查的东西多,适合派子 Agent;而且好的调研应该针对「年付企业版降到专业版」这个具体情况。
- `loose = copy.deepcopy(RESEARCH_TOOL)` 深拷贝一份再改,不动原来的 `RESEARCH_TOOL`。浅拷贝的话内层字典是同一个,改了会影响原件。
- `loose["function"]["description"] = loose["function"]["description"].split("调研助手看不到")[0]` 在「调研助手看不到」处切一刀,只留前面。这就去掉了那句提醒。
- `loose["function"]["parameters"]["properties"]["task"]["description"] = "要调研的问题"` 参数说明里「以及相关的客户背景」也换成最朴素的。两处都去掉才是干净的对照。
- `first = loop(client, [{"role": "system", "content": SYSTEM_DELEGATE}, {"role": "user", "content": BACKGROUND}],` 第一轮:客户只说了背景,主 Agent 一般只会接话,不会调工具。
- `res = loop(client, [*first.messages, {"role": "user", "content": FOLLOW_UP}],` 第二轮接着第一轮的 messages 问。
- `tasks = [json.loads(raw)["task"] for name, raw in res.calls if name == "research"]` 从调用记录里把 `research` 的参数取出来,`["task"]` 就是主 Agent 写给子 Agent 的那段话。
- `if not tasks:` 主 Agent 也可能不派子 Agent、自己查,这时没有 `task` 可看,记录一下。
- `has_bg = "年付企业版" in t and "10" in t` 判定:`task` 里同时有「年付企业版」和「10」才算带了背景。

</div>

```bash
uv run python -m part04.ex267_2
```

```text
== 说明书里提醒了要带背景
  第 1 遍:task 带了背景(年付企业版、10 席位):True
    客户情况：CloudLedger 年付企业版，10 个席位，计划下个月降级到专业版。请把「降级」相关的全部规则整理清楚，需覆盖以下四个方面，并给出出处编号：
1) 降级本身的规则：生效时间、是否退差价、与「取消订阅」的区别；
2) 退款：年付套餐中途取消的退款计算方式、月付套餐退款政策、降级是否涉及退款；
3) 账本：降级后超出新套餐额度的账本会怎样（是否只读、数据是否保留），各套餐的账本数量额度；
4) 成员/席位：各套餐的成员人数上限，降级后超出上限的成员如何处理；
5) 发票：降级、套餐变更、退款场景下发票如何处理（是否重开、是否影响已开发票）。
请逐条列出结论和出处。
  第 2 遍:task 带了背景(年付企业版、10 席位):True
    客户情况：CloudLedger 年付企业版，10 个席位，计划下个月降级到专业版。请把「从企业版降级到专业版」相关的全部规则查清楚并整理，需覆盖以下四个方面：1) 降级本身的生效时间、是否退差价、操作方式；2) 退款政策（年付套餐中途取消/降级的退款计算方式，月付是否可退）；3) 账本额度（专业版账本数量上限，降级后超出额度的账本会怎样，数据是否保留）；4) 成员席位（专业版成员人数上限，10 个席位降级后如何处理，角色和权限相关规则）；5) 发票（企业版与专业版在发票类型上的差异，降级后是否还能开增值税专用发票）。请给出带出处的结论。
  第 3 遍:task 带了背景(年付企业版、10 席位):True
    客户情况：CloudLedger 年付企业版，10 个席位，计划下个月降级到专业版。请把「降级」相关的全部规则整理清楚，需覆盖以下四个方面，每条都要带出处编号：
1) 退款：降级是否退差价；年付套餐中途取消的退款计算方式（含示例）；月付套餐的退款规则。
2) 账本：降级后超出新套餐额度的账本会怎样（是否只读、数据是否保留）；各套餐的账本数量额度。
3) 成员/席位：各套餐的成员人数上限；降级后超出上限的成员会怎样处理；席位减少的操作方式。
4) 发票：降级、退款、套餐变更相关的发票规则（是否可开票、已开票是否需冲红、退款后发票如何处理等）。
另外请说明降级与「取消后重新订阅」的区别，以及降级生效时间。请给出整理后的短结论，不要遗漏任何一条相关规则。
== 说明书里没提醒
  第 1 遍:task 带了背景(年付企业版、10 席位):False
    CloudLedger 从企业版降级到专业版涉及的所有规则，请分别整理：1) 降级的生效时间和是否退差价；2) 退款政策（年付套餐中途取消如何退款、月付是否可退）；3) 降级后账本数量额度和超出额度的处理方式（专业版和企业版各自的账本上限）；4) 成员/席位数量上限（各套餐分别多少）；5) 降级或套餐变更相关的发票规则（已开发票是否需要处理、退款后发票怎么处理、能否重开）。每条结论请附出处编号。
  第 2 遍:task 带了背景(年付企业版、10 席位):False
    整理 CloudLedger 套餐降级的全部相关规则，分四个方面：1) 降级生效时间与差价/退款处理；2) 降级后账本数量超出新套餐额度的处理方式；3) 降级后成员席位超出新套餐人数上限的处理方式；4) 降级与发票相关的规则（已开发票是否需重开、降级后开票金额等）。每条结论请附出处编号。
  第 3 遍:task 带了背景(年付企业版、10 席位):False
    整理 CloudLedger 降级相关的全部规则，分四个方面：1) 降级生效时间与差价/退款处理；2) 降级后账本数量超限会怎样；3) 降级后成员席位数量限制与超出上限的处理；4) 降级/退款相关的发票规则（已开发票是否需要退回、红冲等）。请给出带出处的结论。
```

提醒了的三遍,`task` 都以「客户情况:CloudLedger 年付企业版,10 个席位,计划下个月降级到专业版」开头,后面才是要查的五个方面。去掉提醒的三遍,`task` 写得同样详细(分了四五个方面,每个方面还列了子项),但**一个字都没提客户是谁**,子 Agent 会给出一份通用的降级规则清单。这一句说明书的提醒,是整个 `research` 工具里最值钱的一句。

这个对照也说明一件事:模型写 `task` 时「很认真」,认真到把要查的方面列得很细,却没有想到子 Agent 不知道客户是谁。认真不等于完整,要把「看不到对话」这件事明明白白写进说明书。

</details>

**练习 3:步数用完怎么办,结论太长怎么办。** 写 `part04/ex267_3.py`:把 `run_subagent` 的 `max_steps` 设成 2,看返回什么、主 Agent 拿到的是什么;再写一个 `clip(conclusion, limit=500)`,超长就截断并注明被截了多少。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex267_3.py  练习 3:子 Agent 步数用完会怎样;结论太长怎么兜底
from part04.subagent import run_subagent

TASK = "对比免费版、专业版、企业版在账本数、成员数、导出次数、能否开增值税专用发票、退款规则上的区别"
MAX_CHARS = 500


def clip(conclusion: str, limit: int = MAX_CHARS) -> str:
    """模型对「不超过 300 字」只是大概遵守,所以交回主 Agent 之前,在代码里再卡一次。"""
    if len(conclusion) <= limit:
        return conclusion
    return conclusion[:limit] + f"\n(结论被截断:原文 {len(conclusion)} 字,只保留前 {limit} 字)"


r = run_subagent(TASK, max_steps=2)
print(f"max_steps=2:finished={r.finished},调了 {len(r.calls)} 次工具\n  交回的是:{r.conclusion}")
r = run_subagent(TASK)
print(f"\nmax_steps=8:finished={r.finished},结论 {len(r.conclusion)} 字(要求不超过 300)")
print(f"clip 以后 {len(clip(r.conclusion))} 字;clip 一条 900 字的假结论 ->", clip('字' * 900)[-40:].replace("\n", " "))
```

<div class="line-notes">

- `MAX_CHARS = 500` 交回主 Agent 的结论最多多少字。比提示词里的 300 宽松一些,给模型留点余地,又不至于失控。
- `def clip(conclusion: str, limit: int = MAX_CHARS) -> str:` 代码里卡一道。模型对「不超过 300 字」只是大概遵守,所以提示词管不住的,代码来管。
- `if len(conclusion) <= limit:` 没超就原样返回。
- `return conclusion[:limit] + f"\n(结论被截断:原文 {len(conclusion)} 字,只保留前 {limit} 字)"` 超了就截,**而且把「被截了」写进结论里**,让主 Agent 知道资料不全,不要把半截话当完整结论。真实系统里截断可能切在一句话中间,更讲究的做法是按句子切,或者让子 Agent 重写更短的版本。
- `r = run_subagent(TASK, max_steps=2)` 只给两步。第一步子 Agent 一次发出了好几个检索,第二步还想读全文,到上限就被截了。
- `print(f"max_steps=2:finished={r.finished},调了 {len(r.calls)} 次工具\n  交回的是:{r.conclusion}")` `finished=False`,交回的就是那句警告。
- `print(f"clip 以后 {len(clip(r.conclusion))} 字;clip 一条 900 字的假结论 ->", clip('字' * 900)[-40:].replace("\n", " "))` 先看真结论(436 字)在 500 以内不被改,再造一条 900 个「字」的假结论测截断那条路径。`'字' * 900` 字符串重复 900 次,`[-40:]` 取最后 40 个字符。

</div>

```bash
uv run python -m part04.ex267_3
```

```text
max_steps=2:finished=False,调了 9 次工具
  交回的是:子任务没有在步数上限内完成,下面的信息可能不全。

max_steps=8:finished=True,结论 436 字(要求不超过 300)
clip 以后 436 字;clip 一条 900 字的假结论 -> 字字字字字字字字字字字字 (结论被截断:原文 900 字,只保留前 500 字)
```

`max_steps=2` 的子 Agent 已经调了 9 次工具、查到了一堆资料,但 `loop` 返回 `finished=False`,`run_subagent` 只交回了一句「没有在步数上限内完成」,查到的全浪费了。这和 Day 266 练习 2 是同一个问题,同样的修法:步数用完时关掉工具,让它用手上的资料写一个结论(留作你的延伸练习)。`clip` 那一行说明,今天这一次的结论 436 字,在 500 之内没被改;造出来的 900 字假结论被截成 500 并带上了说明。

</details>

**练习 4:子 Agent 的权限清单。** 写 `part04/ex267_4.py`:`check_sub_tools(tools, funcs)`,检查子 Agent 的工具集合只能是 `search_kb` 和 `get_article`、不能包含 `research`、`funcs` 里不能有没写进 `tools` 的函数。用「现在的」「误把 research 给了子 Agent」「有人加了退款工具」三种情况测。不调模型。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex267_4.py  练习 4:子 Agent 的权限清单。不调模型,把「最小权限」写成断言,以后有人改工具就会红
from part04.kb_tools import FUNCS, TOOLS
from part04.subagent import RESEARCH_TOOL

READ_ONLY = {"search_kb", "get_article"}  # 子 Agent 允许用的工具:都是只读,而且只碰帮助中心
MAIN_ONLY = {"research"}                  # 只有主 Agent 能用的


def check_sub_tools(tools: list[dict], funcs: dict) -> list[str]:
    problems = []
    names = {t["function"]["name"] for t in tools}
    if names - READ_ONLY:
        problems.append(f"子 Agent 拿到了不该有的工具:{sorted(names - READ_ONLY)}")
    if names & MAIN_ONLY:
        problems.append("子 Agent 不能再派子 Agent(会一层层套下去,每层都花钱)")
    if set(funcs) - names:
        problems.append(f"funcs 里有工具没写进 tools:{sorted(set(funcs) - names)}")
    return problems


print("现在的子 Agent:", check_sub_tools(TOOLS, FUNCS) or "没问题")
bad_tools = [*TOOLS, RESEARCH_TOOL]
print("如果把 research 也给了子 Agent:", check_sub_tools(bad_tools, {**FUNCS, "research": print}))
fake_write = {"type": "function", "function": {"name": "create_refund_request"}}
print("如果有人加了退款工具:", check_sub_tools([*TOOLS, fake_write], FUNCS))
```

<div class="line-notes">

- `READ_ONLY = {"search_kb", "get_article"}  # 子 Agent 允许用的工具:都是只读,而且只碰帮助中心` 白名单,集合。以后要给子 Agent 加工具,必须先改这一行,所以改的人会看见。
- `MAIN_ONLY = {"research"}                  # 只有主 Agent 能用的` 只有主 Agent 才能派子 Agent。
- `names = {t["function"]["name"] for t in tools}` 把说明书列表里的工具名收成集合。
- `if names - READ_ONLY:` 集合相减:子 Agent 拿到的工具里,不在白名单里的。非空就有问题。
- `problems.append(f"子 Agent 拿到了不该有的工具:{sorted(names - READ_ONLY)}")` `sorted` 让输出顺序固定。
- `if names & MAIN_ONLY:` 集合交集:子 Agent 有没有拿到 `research`。
- `if set(funcs) - names:` `set(funcs)` 是映射表里所有工具名(字典转集合取键)。映射表里有、说明书里没有的,模型看不到、但代码里能调到,同样是隐患。
- `bad_tools = [*TOOLS, RESEARCH_TOOL]` 构造一个「把 research 也给了子 Agent」的坏配置。
- `print("如果把 research 也给了子 Agent:", check_sub_tools(bad_tools, {**FUNCS, "research": print}))` `{**FUNCS, "research": print}` 把 `print` 当成假的 `research` 函数填进映射表,只为了凑够配置,不会真的调用。
- `fake_write = {"type": "function", "function": {"name": "create_refund_request"}}` 构造一个「有人加了退款工具」的坏配置,说明书只写了名字,够测了。

</div>

```bash
uv run python -m part04.ex267_4
```

```text
现在的子 Agent: 没问题
如果把 research 也给了子 Agent: ["子 Agent 拿到了不该有的工具:['research']", '子 Agent 不能再派子 Agent(会一层层套下去,每层都花钱)']
如果有人加了退款工具: ["子 Agent 拿到了不该有的工具:['create_refund_request']"]
```

三种情况的输出和预期一致:现在没问题;误给 `research` 会报两条(不在白名单,而且是只有主 Agent 才能用的);加了退款工具会报一条。把它放进测试([Day 71](/blog/agent-zero/day-071-pytest-1/) 的 pytest),以后改子 Agent 的工具集合时,CI 会替你拦住。

</details>

**练习 5:把轨迹读成账单。** 写 `part04/ex267_5.py`,读 `out/harness_trace.jsonl`,按轮打印:会话、工具、主调用次数、子 Agent 的钱、历史 token(清理后到压缩后)、耗时,最后找出最慢的一轮。不调模型。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex267_5.py  练习 5:把 harness 的轨迹读成一张按轮的账单,找最贵的一轮。不调模型
import json
from pathlib import Path

rows = [json.loads(line) for line in Path("out/harness_trace.jsonl").read_text(encoding="utf-8").splitlines()]
print(f"{'轮':>2} {'会话':<5} {'工具':<28} {'主调用':>4} {'子Agent ¥':>9} {'历史 token':>11} {'秒':>5}")
total_sub = 0.0
for i, t in enumerate(rows, 1):
    sub_cost = sum(s["cost"] for s in t["sub"])
    total_sub += sub_cost
    hist = f"{t['history_tokens'][0]}→{t['history_tokens'][1]}"
    print(f"{i:>2} {t['thread']:<5} {','.join(t['tools']) or '-':<28} {t['main_calls']:>4} {sub_cost:>9.4f} {hist:>11} {t['seconds']:>5}")
slowest = max(rows, key=lambda t: t["seconds"])
print(f"\n最慢的一轮:{slowest['user'][:20]}…  {slowest['seconds']} 秒,子 Agent 占 ¥{sum(s['cost'] for s in slowest['sub']):.4f}")
print(f"子 Agent 合计 ¥{total_sub:.4f}")
```

<div class="line-notes">

- `rows = [json.loads(line) for line in Path("out/harness_trace.jsonl").read_text(encoding="utf-8").splitlines()]` 一行一个 JSON,[Day 39](/blog/agent-zero/day-039-json/) 学的写法。
- `print(f"{'轮':>2} {'会话':<5} {'工具':<28} {'主调用':>4} {'子Agent ¥':>9} {'历史 token':>11} {'秒':>5}")` 表头。`:>2` 右对齐占 2 格,`:<5` 左对齐占 5 格。
- `for i, t in enumerate(rows, 1):` `enumerate` 从 1 开始数,第 1 轮显示 1。
- `sub_cost = sum(s["cost"] for s in t["sub"])` 这一轮所有子 Agent 的钱。没派子 Agent 时 `t["sub"]` 是空列表,`sum` 得 0。
- `hist = f"{t['history_tokens'][0]}→{t['history_tokens'][1]}"` 清理后、压缩前的 token,和压缩后的,中间一个箭头。没压缩时两个数一样。
- `{t['thread']:<5}` 每一行的数据:会话、工具列表用逗号拼成一格(一个都没调时显示 `-`)、主调用次数、子 Agent 的钱、历史 token、耗时。
- `slowest = max(rows, key=lambda t: t["seconds"])` `max` 加 `key` 参数:按每一行的 `seconds` 取最大的那一行。`lambda t: t["seconds"]` 是一行的匿名函数。
- `print(f"\n最慢的一轮:{slowest['user'][:20]}…  {slowest['seconds']} 秒,子 Agent 占 ¥{sum(s['cost'] for s in slowest['sub']):.4f}")` 最慢的一轮和子 Agent 在里面的花费。

</div>

```bash
uv run python -m part04.ex267_5
```

```text
 轮 会话    工具                            主调用  子Agent ¥    历史 token     秒
 1 t-h1  research                        2    0.0089         0→0   7.4
 2 t-h1  -                               1    0.0000     843→843   2.8
 3 t-h1  search_kb                       2    0.0000   1196→1196   2.6
 4 t-h1  search_kb                       2    0.0000   1818→1818   2.9
 5 t-h1  -                               2    0.0000   1967→1582   2.7
 6 t-h2  search_kb,search_kb             2    0.0000         0→0   3.8

最慢的一轮:帮我对比一下三种套餐在账本数、成员数、导…  7.4 秒,子 Agent 占 ¥0.0089
子 Agent 合计 ¥0.0089
```

最慢的是第 1 轮,7.4 秒,因为子 Agent 要先查五六次、读两篇、再写结论,而且是串在主 Agent 前面的;其余轮次 2.6 到 3.8 秒。这是隔离的另一面:**子 Agent 是同步的**,主 Agent 要等它做完才能继续,用户那一轮的等待时间是两个 Agent 的总和。要让用户少等,得把子 Agent 放到后台、先给用户一个进度,这是第五部分「后台 Agent」的话题。

</details>

**验收标准:** 练习 1 的两个窗口大小对得上;练习 2 看到有提醒 3/3、没提醒 0/3;练习 4 三种情况的断言输出和上面一致;能用自己的话说出 harness 一轮六步分别对应本周哪一天写的东西;能说出子 Agent 省了什么、多花了什么。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 隔离(isolation) | 上下文工程的第四类手段:把一部分工作放进另一个独立的上下文里做,只把结果带回来。子 Agent 是最常见的做法 |
| 子 Agent(subagent) | 有自己独立的 `messages`、自己的系统提示词和工具集的 Agent 循环,被主 Agent 当成一个普通工具调用,返回一段短结论 |
| 主 Agent | 直接面对用户、拿着完整对话的那个 Agent。它决定要不要把某件事交给子 Agent |
| 探索量 | 子 Agent 自己为了得出结论读了多少东西,用它自己 messages 的 token 数衡量。探索量大、结论短,才值得隔离 |
| harness | 模型之外让 Agent 能干活的全部工程:循环、工具、上下文组装、状态持久化、权限和安全、可观测。模型是马,harness 是挽具和车 |
| 轨迹(trace) | 每一轮留下的一行记录:用了什么工具、花了多少、历史多大、是否压缩。出问题时靠它复盘,第六部分会系统讲 |
| 最小权限 | 子 Agent、工具、用户只拿完成任务必需的权限,别的一律不给。今天体现在子 Agent 只有两个只读工具 |

## 常见误区

**以为隔离能省钱。** 实测三轮对话,派子 Agent 的总费用 ¥0.0198,比主 Agent 自己查的 ¥0.0143 多 38%。隔离省的是主对话的长度(三问之后 1401 对 2639 token),是后续每一轮的输入,不是总 token。只问一次就结束的对话,隔离是纯额外花销。

**以为模型会自己把背景写进 task。** 没提醒时 3 遍里 0 遍带了客户是谁,尽管 `task` 写得很详细。子 Agent 看不到主对话,这件事要写进工具说明书里。

**以为「不超过 300 字」会被遵守。** 实测 367 到 515 字,没有一次在 300 以内。代码里要再卡一道(`clip`),并且把「被截断」告诉主 Agent。

**步数用完只交回一句警告。** 子 Agent 已经查到的资料全浪费了。和 Day 266 练习 2 一样的修法:到上限就关掉工具、让它整理手上有的。

**给子 Agent 过多的权限。** 它的上下文用完即扔,出了事没有对话可查。子 Agent 只给只读工具,不给写操作,也不给派子 Agent 的能力。

**把 harness 当成一个框架。** harness 不是某个库,是一类工作:把模型调用接成一条可靠的流水线。你今天写的 `harness.py` 一百行不到,是一个最小的 harness;LangGraph、Claude Agent SDK 这些是更大的 harness,每一块你都已经亲手写过,所以看它们的文档时会知道它们在替你做什么。

**以为 harness 接好了就对了。** harness 管「接起来」,不管「答得对」。我第一次跑演示时,模型自己编了一个升级差价的估算公式。接好之后还要靠评估集量,这周前半段学的东西没有因为后半段失效。

**记忆当事实用。** 新会话里模型说「按你之前告诉我的情况,你们是年付专业版」,这是对的写法:把记忆当成「用户说过」,而不是「系统核实过」。`MEMORY_HEADER` 那一句不要省。

## 学习资料

### 文档与文章

- [Anthropic · How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)(2025 年 6 月 13 日):主 Agent 派多个子 Agent 并行调研,每个子 Agent 有自己的上下文窗口,最后把最重要的内容压缩后交回。里面有 token 用量的数字(Agent 约是聊天的 4 倍,多 Agent 约 15 倍)和哪些场景不适合多 Agent。
- [Anthropic · Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)(2025 年 11 月 26 日):harness 这个词的出处,讲长任务怎么跨多个上下文窗口接力,读「初始化 Agent」和「进度文件」那两段。
- [Anthropic · Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents):四类手段里的子 Agent 架构,每个子 Agent 可能用掉几万 token 去探索,但只返回压缩过的结果。
- [Claude Code 文档 · Subagents](https://code.claude.com/docs/en/sub-agents):一个现成产品里的子 Agent:有独立的上下文窗口、自己的系统提示词、可限定的工具和权限,不会看到主对话的历史。读它的「工具和权限」一节,对照我们的 `check_sub_tools`。
- [Cognition · Don't Build Multi-Agents](https://cognition.com/blog/dont-build-multi-agents)(2025 年 6 月 12 日):对多 Agent 持保留意见的一篇,提出要共享完整上下文、行动里藏着隐含决策两条原则,读完再看我们的只读子 Agent 为什么风险小。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV18UUSBCEeE&autoplay=0&high_quality=1" title="多智能体架构全景-主agent如何动态派生subagent:精读《How we built our multi-agent research system》②" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>慢学AI · 多智能体架构全景-主agent如何动态派生subagent:精读《How we built our multi-agent research system》② · 8 分钟,精读上面 Anthropic 那篇多 Agent 文章里主 Agent 怎么派子 Agent 的部分,先看文章再看视频。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1xgi5BzENW&autoplay=0&high_quality=1" title="【第6期】子智能体实现上下文隔离" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>小鱼儿at青岛 · 【第6期】子智能体实现上下文隔离 · 16 分钟,用子智能体做上下文隔离的一期,和今天第一到第三步对着看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1xZdbBaEFY&autoplay=0&high_quality=1" title="面试官问:一个完整的Agent架构包括哪些部分?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI深度幻觉 · 面试官问:一个完整的Agent架构包括哪些部分? · 10 分钟,按面试回答的角度讲一个 Agent 系统由哪几块组成,对照今天 harness 的六块表看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/n9xKblqyQ28" title="Why The Harness Matters More Than The Model | YC Paper Club" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Y Combinator · Why The Harness Matters More Than The Model | YC Paper Club · 英文,开自动字幕,从标题看是讲 harness 对效果的影响,我只核对了标题和作者,没完整看过,把它当对「harness」这个词的另一个说法来参考。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/HI2q3ci3Iuc" title="When to Build Your Own Agent Harness | Harrison Chase, LangChain | Sequoia Capital" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Sequoia Capital · When to Build Your Own Agent Harness | Harrison Chase, LangChain · 英文,LangChain 创始人讲什么时候该自己写 harness、什么时候用现成的,我只核对了标题和作者,没完整看过;今天手写一遍之后听这个问题有体感。</figcaption>
</figure>

### 书籍

- Michael Albada《Building Applications with AI Agents》(O'Reilly,2025):单 Agent 和多 Agent 系统的设计与实现,讲到多 Agent 的协调、工具设计和安全,对照今天的子 Agent 和权限清单。
- Chip Huyen《AI Engineering》(O'Reilly,2025):Agent 的规划、工具、记忆、评估,对应这周整体内容。

### 开源项目与代码

- [anthropics/claude-agent-sdk-python](https://github.com/anthropics/claude-agent-sdk-python):Anthropic 的 Agent SDK,也是文章里说的「通用 agent harness」的 Python 实现,读它怎么管循环、权限和子 Agent。
- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):状态图式的 harness,第五部分会用它把今天手写的循环、存回、轨迹重新搭一遍。

## 自测

**1. 子 Agent 的上下文涨到了 2000 多 token,为什么说它「省」了主 Agent 的上下文,总费用却更高?**

<details><summary>答案</summary>

子 Agent 自己的窗口用完即扔,只有一段几百字的结论回到主对话,所以主对话每一轮的输入更短(三问之后 1401 对 2639 token)。但子 Agent 自己也要调模型、查资料、读全文,这部分钱照花,还多了主 Agent 派活和收结论的一轮,所以三轮对话总费用 ¥0.0198 比主 Agent 自己查的 ¥0.0143 多 38%。隔离省的是主对话的长度和后续轮次的输入,不是总 token。

</details>

**2. 去掉 `research` 说明书里「客户说过的、和任务有关的情况要写进 task 里」那一句,会发生什么?为什么模型自己想不到?**

<details><summary>答案</summary>

主 Agent 写给子 Agent 的 `task` 会很详细,但不再提客户是谁(实测 3 遍里 0 遍带了「年付企业版、10 个席位」),子 Agent 就会给一份通用结论。模型想不到是因为它不知道子 Agent 看不到主对话,「认真」只是把要查的方面列细,不等于信息完整。要把「子 Agent 看不到对话」这个事实写进工具说明书里。

</details>

**3. harness 一轮的六步是什么?每一步对应这一周的哪一天?**

<details><summary>答案</summary>

取记忆(长期记忆召回加短期会话读取,Day 264);整理历史(清旧工具结果加超阈值总结压缩,Day 263);拼 system(固定规矩加带「未核实」提醒的记忆,Day 262 预算和 Day 264);跑 Agent 循环(带步数上限,可以调检索工具和子 Agent,Day 266 和今天);存回会话(整理后的历史加这一轮新增的消息,Day 264);记轨迹(一行 JSON,留作复盘)。会话结束后另外触发 `remember` 写长期记忆,不在每一轮里。

</details>

**4. 为什么子 Agent 只给只读工具,而且不给它派子 Agent 的能力?**

<details><summary>答案</summary>

子 Agent 的上下文用完即扔,在里面做了什么写操作(比如提交退款申请),事后没有对话可查,所以只给只读的资料工具。不给它 `research` 是因为子 Agent 再派子 Agent 会一层层套下去,每一层都花钱,而步数上限只管一层。最小权限要写成断言(练习 4),别人改工具集合时才拦得住。

</details>

**5.(面试题)面试官问:「你们的 Agent 用上下文隔离了吗?怎么判断一个任务值不值得派子 Agent?」**

<details><summary>答案</summary>

先说清楚隔离是什么:子 Agent 有独立的消息列表,在自己的窗口里翻资料,只把一段短结论交回,主对话只多一条 tool 消息。再说判断的三个量:这个任务的探索量(子 Agent 自己的窗口会涨到多少,我们实测对比五个方面的套餐任务是 2000 多 token)、结论的长度(几百字)、之后主对话还要聊多少轮(每轮都省那一两千 token)。探索量大、结论短、后面还要聊很久,值得;只问一次的对话,隔离只是多花钱。然后补账:我们实测三轮对话总费用多 38%,主对话从 2639 降到 1401 token。最后补风险:子 Agent 看不到主对话,背景要写进 task,说明书里要写明;结论长度要在代码里卡;工具给只读的最小集合,不让它再派子 Agent。

</details>

## 明天预告

Day 268 · 小项目(一):文档问答 Agent 骨架和检索。这一周的上下文工程到这里就讲完了:预算、压缩、记忆、Agentic 检索、隔离和 harness。接下来要把第四部分的东西(切块、检索、评估、上下文)接成一个完整的项目:文档问答 Agent。明天先搭骨架和检索这一层,把今天的 harness 里「取记忆、整理历史、拼 system、跑循环」的结构用在一个真正的文档问答上。
