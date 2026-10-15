---
title: 'Day 117 · Agent Loupe(六):从任意一步改参数重跑'
description: '在第 3 步发现模型做了个糟糕的决定,改一句系统提示词,从第 3 步重新跑:前面的步骤原样保留,工具结果从原运行里回放,白名单里的只读工具可以真实执行。今天实现录制-回放(cassette)、第 N 步上下文重建、分叉运行和重跑对话框,并用 DeepSeek 实测非确定性和 cassette miss。'
pubDate: 2026-10-15
regime: none
tags: ['agent-loupe', 'replay', 'cassette', 'determinism', 'portfolio', 'agent-60']
series: 'agent-60'
day: 117
lang: 'zh'
---

## 今天要解决的问题

调 Agent 的日常是这样的:一个任务跑了 20 步,第 14 步模型选错了工具,后面全歪了。你改了一句提示词,想验证有没有用,只能从头再跑一遍。前 13 步要重新调模型、重新查数据库、重新调外部 API,花钱、花时间,而且模型每次都可能走一条不同的路,第 14 步那个场景不一定能复现。

Langfuse 和 LangSmith 都有 Playground:把某一次 LLM 调用的输入拿出来,改改提示词再发一次。这能看单步效果,但只有一步。你真正想知道的是「从这一步开始,改了以后后面会怎么走」。这就是今天要做的:**从任意一步分叉,带着修改继续跑完,生成一条新的运行,然后和原运行对比。**

学完你应该能:

1. 讲清楚录制-回放(cassette)的原理,它解决什么问题,以及 cassette miss 会怎样扭曲 Agent 的行为。
2. 从存好的 Step 里重建第 N 步发给模型的完整上下文,应用修改(系统提示词、模型、temperature)后继续跑 Agent 循环。
3. 设计「真实执行 vs 回放」的规则,说清楚哪些工具绝对不能在重跑时真实执行。
4. 给新运行记好血缘(`parent_run_id`、`forked_from_step`),重跑完自动跳到 Day 116 的对比页。
5. 用真实模型实测一次,亲眼看到同样的输入跑出不同的路径,理解为什么一次重跑说明不了问题。

预计用时 6 小时。前置:Day 9 的 Agent 循环,Day 112 的 Run/Step/Trace 模型和 `loupe_sdk`(`wrap_openai` 记下的 LLM 步,`input` 是完整的 messages 和 tools,`output` 是 assistant 消息),Day 113 的 `db.load_trace` / `db.save_trace` 和按 `prices.json` 补成本的 `fill_costs`,Day 115 的 `StepInspector`,Day 116 的对比页和 `routes.py`。

## 先想清楚:重跑到底要「重」什么

一次 Agent 运行里有两种外部调用:调模型和调工具。重跑时它们的地位完全不同。

调模型是我们**想要**重新发生的。改了提示词,就是想看模型这次会怎么决定。

调工具大多是我们**不想**重新发生的。有三个原因。第一是副作用:原运行里第 7 步调了 `create_refund_request`,重跑时如果真的再调一次,客户就被退了两次款。第二是成本和速度:搜索、爬网页、查大表,每次都要钱、要时间。第三是可比性:天气、库存、汇率都在变,重跑时工具返回了不同的数据,你就分不清行为变化是因为改了提示词,还是因为外面的世界变了。

所以重跑的默认规则是:**模型真实调用,工具从原运行里回放。** 这个思路在测试领域有个现成的名字,叫录制-回放,Python 里最有名的实现是 VCR.py:第一次跑测试时把 HTTP 请求和响应录进一个 cassette 文件(磁带),之后再跑就直接从磁带里放,不发真实请求。我们的磁带不用另外录,原运行的每个工具步本来就存了输入和输出。

<figure>
<svg viewBox="0 0 640 290" role="img" aria-label="从第 3 步分叉重跑:前 3 步复制,第 3 步起调真实模型,工具调用先查 cassette,命中就回放,白名单工具可以真实执行,都不满足就返回 cassette miss">
  <rect x="0" y="0" width="640" height="290" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">原运行</text>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="20" y="36" width="60" height="26" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="50" y="53" text-anchor="middle" fill="var(--mem)">0 llm</text>
    <rect x="86" y="36" width="60" height="26" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="116" y="53" text-anchor="middle" fill="var(--compute)">1 tool</text>
    <rect x="152" y="36" width="60" height="26" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="182" y="53" text-anchor="middle" fill="var(--compute)">2 tool</text>
    <rect x="218" y="36" width="60" height="26" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="248" y="53" text-anchor="middle" fill="var(--mem)">3 llm</text>
    <rect x="284" y="36" width="60" height="26" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="314" y="53" text-anchor="middle" fill="var(--compute)">4 tool</text>
    <rect x="350" y="36" width="60" height="26" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="380" y="53" text-anchor="middle" fill="var(--mem)">5 llm</text>
  </g>
  <text x="430" y="53" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">工具步 = 磁带</text>
  <line x1="248" y1="62" x2="248" y2="100" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
  <text x="256" y="86" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">取第 3 步的 messages + tools,改系统提示词</text>
  <text x="20" y="122" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">新运行</text>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="20" y="132" width="60" height="26" fill="none" stroke="var(--ink-faint)"/><text x="50" y="149" text-anchor="middle" fill="var(--ink-soft)">0 复制</text>
    <rect x="86" y="132" width="60" height="26" fill="none" stroke="var(--ink-faint)"/><text x="116" y="149" text-anchor="middle" fill="var(--ink-soft)">1 复制</text>
    <rect x="152" y="132" width="60" height="26" fill="none" stroke="var(--ink-faint)"/><text x="182" y="149" text-anchor="middle" fill="var(--ink-soft)">2 复制</text>
    <rect x="218" y="132" width="60" height="26" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="248" y="149" text-anchor="middle" fill="var(--mem)">3 真模型</text>
    <rect x="284" y="132" width="60" height="26" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="314" y="149" text-anchor="middle" fill="var(--compute)">4 ?</text>
    <rect x="350" y="132" width="60" height="26" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="380" y="149" text-anchor="middle" fill="var(--mem)">5 真模型</text>
  </g>
  <rect x="200" y="182" width="420" height="94" fill="none" stroke="var(--compute)"/>
  <text x="212" y="202" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">工具调用怎么执行(按顺序判断)</text>
  <text x="212" y="222" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">1. 勾了「真实执行」且在只读白名单里 → 真实执行</text>
  <text x="212" y="240" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">2. 磁带里有同名同参数的调用 → 回放原结果</text>
  <text x="212" y="258" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">3. 都没有 → 返回 cassette miss 错误给模型</text>
  <line x1="314" y1="158" x2="314" y2="182" stroke="var(--compute)"/>
</svg>
<figcaption>分叉重跑的数据流。前面的步骤只是复制,第 N 步开始才真正调模型;工具调用按三条规则依次判断。</figcaption>
</figure>

## 磁带的键:工具名加规范化参数

回放时要回答一个问题:模型现在要调 `calculate({"expression": "17.7 - 11.9"})`,磁带里有没有这一次的结果?

键用 `(工具名, 参数摘要)`,参数摘要直接复用 Day 116 的 `digest`:规范化以后取 SHA-1 前 8 位。这样 `{"city":"北京"}` 和 `{"city": "北京"}` 是同一个键,和对比页的口径一致。

同一个键可能出现多次。比如原运行里查了两次北京天气(第一次失败重试)。我们给每个键存一个队列,按顺序取;取到只剩最后一条时就不再弹出,之后同样的调用都重复它。这个选择的理由是:重跑时模型多调了一次同样的工具,与其返回 miss,不如给它原运行里最后一次的结果,这最接近「外部世界没变」的假设。

参数不同就是 miss。模型这次要算 `(17.7 - 11.9) * 9 / 5`,原运行里根本没算过这个,磁带里没有。miss 的处理是今天最值得讨论的设计点,后面会用真实数据说明。

## 重建第 N 步的上下文

Day 112 定的模型里,LLM 步的 `input` 存的是完整的 `{"messages": [...], "tools": [...]}`,也就是那一次 API 调用的请求体;`loupe_sdk` 的 `wrap_openai` 记录时还专门做了深拷贝,存下来的就是当时的样子。所以重建第 N 步的上下文不需要回放前面的步骤,直接把第 N 步的 input 拿出来就是。这是当初坚持「LLM 步存完整输入」的回报:多占了一些存储,换来了任意一步都能精确重建。

如果你的 trace 是从别的系统导入的(比如 OTLP),有的导出器为了省空间只存最后一条消息,那第 N 步就重建不出来。这种 trace 在界面上应该把重跑按钮置灰,并说明原因。今天的代码里,`messages_at` 遇到第 N 步不存在、不是 LLM 步、或者没有存 messages,都会直接报错,错误信息会原样显示在重跑对话框里。

为什么只允许从 LLM 步开始?因为工具步的「重跑」没有意义:工具的输入是上一个 LLM 步决定的,要改工具的行为,就去改决定它的那一步。界面上也只在 LLM 步显示重跑按钮。

改系统提示词的实现很朴素:如果 messages 第一条是 system,就替换它的 content;如果没有 system 消息,就在最前面插一条。改模型和 temperature 只影响之后的调用。

## 代码:replay.py

在 `server/loupe/` 下新建 `replay.py`:

```python
# agent-loupe/server/loupe/replay.py
import copy
import json
import os
import sqlite3
import uuid
from collections import defaultdict, deque
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any

from dotenv import load_dotenv
from pydantic import BaseModel

from loupe import db
from loupe.diff import digest
from loupe.models import Run, Step, Trace
from loupe.pricing import fill_costs

load_dotenv()  # 读 server/.env 里的 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL(全课统一的三个变量)

# llm_call(messages, tools, model, temperature) -> (assistant 消息字典, 输入 token, 输出 token)
LLMCall = Callable[[list[dict], list[dict], str, float | None], tuple[dict, int, int]]
ToolFn = Callable[..., Any]
ExecTool = Callable[[str, Any], tuple[Any, str | None]]


class Overrides(BaseModel):
    system_prompt: str | None = None
    model: str | None = None
    temperature: float | None = None


def now() -> datetime:
    return datetime.now(timezone.utc)


class Cassette:
    """原运行里每次工具调用的结果,按 (工具名, 规范化参数摘要) 存起来,重跑时按顺序取。"""

    def __init__(self) -> None:
        self._tapes: dict[tuple[str, str], deque] = defaultdict(deque)

    @classmethod
    def from_steps(cls, steps: list[Step]) -> "Cassette":
        c = cls()
        for s in steps:
            if s.kind == "tool":
                c._tapes[(s.name, digest(s.input))].append((s.output, s.error))
        return c

    def play(self, name: str, args: Any) -> tuple[bool, Any, str | None]:
        tape = self._tapes.get((name, digest(args)))
        if not tape:
            return False, None, None
        out, err = tape[0] if len(tape) == 1 else tape.popleft()  # 最后一条留着,同样的调用再来就重复它
        return True, out, err


def messages_at(steps: list[Step], n: int) -> tuple[list[dict], list[dict], Step]:
    """取出第 n 步(必须是 LLM 步)发给模型的完整输入。"""
    step = next((s for s in steps if s.idx == n), None)
    if step is None or step.kind != "llm":
        raise ValueError(f"第 {n} 步不存在或不是 LLM 步,只能从 LLM 步开始重跑")
    inp = step.input if isinstance(step.input, dict) else {}
    if not inp.get("messages"):
        raise ValueError(f"第 {n} 步没有存完整的 messages(导入时被截断了?),无法重建上下文")
    return copy.deepcopy(inp["messages"]), copy.deepcopy(inp.get("tools") or []), step


def apply_overrides(messages: list[dict], ov: Overrides) -> list[dict]:
    if ov.system_prompt is None:
        return messages
    if messages and messages[0].get("role") == "system":
        return [{**messages[0], "content": ov.system_prompt}, *messages[1:]]
    return [{"role": "system", "content": ov.system_prompt}, *messages]


def run_loop(run: Run, messages: list[dict], tools: list[dict], llm_call: LLMCall, exec_tool: ExecTool,
             start_idx: int, parent_idx: int | None, temperature: float | None, max_steps: int = 12) -> list[Step]:
    """Day 9 的 Agent 循环,只多做一件事:每一步都记成 Step(挂在同一个父步骤下,和 loupe_sdk 记的结构一致)。"""
    steps: list[Step] = []
    idx = start_idx
    for _ in range(max_steps):
        t0 = now()
        msg, tin, tout = llm_call(messages, tools, run.model or "", temperature)
        steps.append(Step(run_id=run.id, idx=idx, parent_idx=parent_idx, kind="llm", name=f"chat {run.model}",
                          started_at=t0, ended_at=now(), input={"messages": copy.deepcopy(messages), "tools": tools},
                          output=msg, input_tokens=tin, output_tokens=tout, model=run.model))
        idx += 1
        messages.append(msg)
        calls = msg.get("tool_calls") or []
        if not calls:
            return steps
        for tc in calls:
            name, t1 = tc["function"]["name"], now()
            try:
                args = json.loads(tc["function"]["arguments"] or "{}")
            except json.JSONDecodeError as e:
                args, out, err = tc["function"]["arguments"], None, f"参数不是合法 JSON: {e}"
            else:
                out, err = exec_tool(name, args)
            steps.append(Step(run_id=run.id, idx=idx, parent_idx=parent_idx, kind="tool", name=name,
                              started_at=t1, ended_at=now(), input=args, output=out, error=err))
            idx += 1
            content = json.dumps({"error": err} if err else out, ensure_ascii=False)
            messages.append({"role": "tool", "tool_call_id": tc["id"], "content": content})
    t = now()
    steps.append(Step(run_id=run.id, idx=idx, parent_idx=parent_idx, kind="other", name="max_steps",
                      started_at=t, ended_at=t, error=f"超过最大步数 {max_steps},强制停止"))
    return steps


def finish(run: Run, steps: list[Step]) -> Trace:
    """汇总 token、状态,再交给 Day 113 的 fill_costs 按 prices.json 算成本。"""
    errored = any(s.kind == "other" and s.error for s in steps)
    end = max([run.started_at, *(s.ended_at for s in steps if s.kind != "agent")])
    # 根上的 agent 步(loupe_sdk 记的 agent.run)覆盖整个运行,结束时间跟着新运行走
    steps[:] = [s.model_copy(update={"ended_at": end}) if s.kind == "agent" else s for s in steps]
    run = run.model_copy(update={
        "ended_at": end,
        "status": "error" if errored else "ok",
        "total_input_tokens": sum(s.input_tokens or 0 for s in steps),
        "total_output_tokens": sum(s.output_tokens or 0 for s in steps),
    })
    return fill_costs(Trace(run=run, steps=steps))


def fork_run(conn: sqlite3.Connection, run_id: str, from_step: int, overrides: Overrides, llm_call: LLMCall,
             live_tools: dict[str, ToolFn] | None = None, max_steps: int = 12) -> Run:
    """从原运行的第 from_step 步(LLM 步)开始重跑,返回新运行。前面的步骤原样复制。"""
    src = db.load_trace(conn, run_id)  # Day 113 写好的:整条读回成 Trace
    if src is None:
        raise ValueError(f"run {run_id} 不存在")
    messages, tools, at = messages_at(src.steps, from_step)
    messages = apply_overrides(messages, overrides)
    cassette = Cassette.from_steps(src.steps)
    stats = {"cassette": 0, "live": 0, "miss": 0}

    def exec_tool(name: str, args: Any) -> tuple[Any, str | None]:
        if live_tools is not None and name in live_tools:  # 用户勾了「真实执行」,且工具在白名单里
            stats["live"] += 1
            try:
                return live_tools[name](**args), None
            except Exception as e:  # 工具报错也是结果,交给模型
                return None, f"{type(e).__name__}: {e}"
        hit, out, err = cassette.play(name, args)
        if hit:
            stats["cassette"] += 1
            return out, err
        stats["miss"] += 1
        return None, f"cassette miss:原运行里没有 {name}({json.dumps(args, ensure_ascii=False)}) 的录制结果"

    # 前缀步骤整体平移到「刚好在现在结束」,时间轴上和新跑的步骤首尾相接,耗时也只算真实花的时间
    t0 = now()
    old_prefix = [s for s in src.steps if s.idx < from_step]
    leaf_end = max((s.ended_at for s in old_prefix if s.kind != "agent"), default=src.run.started_at)
    shift = t0 - leaf_end
    new = Run(id=f"{run_id}-fork-{uuid.uuid4().hex[:6]}", name=f"{src.run.name}(从第 {from_step} 步重跑)",
              started_at=src.run.started_at + shift, ended_at=t0,
              model=overrides.model or at.model or src.run.model,
              tags=[*src.run.tags, "replay"], parent_run_id=run_id, forked_from_step=from_step)
    prefix = [s.model_copy(update={"run_id": new.id, "started_at": s.started_at + shift,
                                   "ended_at": s.ended_at + shift}) for s in old_prefix]
    tail = run_loop(new, messages, tools, llm_call, exec_tool, start_idx=from_step, parent_idx=at.parent_idx,
                    temperature=overrides.temperature, max_steps=max_steps)
    new.tags += [f"{k}:{v}" for k, v in stats.items()]
    trace = finish(new, prefix + tail)
    db.save_trace(conn, trace)
    return trace.run


def openai_llm_call(messages: list[dict], tools: list[dict], model: str, temperature: float | None) -> tuple[dict, int, int]:
    """真实的模型调用,走全课统一的环境变量。"""
    from openai import OpenAI

    client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
    extra = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
    kwargs: dict[str, Any] = {"model": model or os.environ["LLM_MODEL"], "messages": messages, "extra_body": extra}
    if tools:
        kwargs["tools"] = tools
    if temperature is not None:
        kwargs["temperature"] = temperature
    resp = client.chat.completions.create(**kwargs)
    m = resp.choices[0].message
    msg: dict[str, Any] = {"role": "assistant", "content": m.content}
    if m.tool_calls:
        msg["tool_calls"] = [tc.model_dump() for tc in m.tool_calls]
    reasoning = getattr(m, "reasoning_content", None)
    if reasoning:
        msg["reasoning_content"] = reasoning
    u = resp.usage
    return msg, (u.prompt_tokens if u else 0), (u.completion_tokens if u else 0)
```

逐块说一下设计。

**`run_loop` 就是 Day 9 的 Agent 循环。** 区别只在于每一步都记成 Day 112 的 `Step`,工具的执行通过 `exec_tool` 回调注入。LLM 步的名字用 `chat <模型名>`,和 `loupe_sdk` 记下的一样(样例里是 `chat deepseek-flash`),否则 Day 116 的签名会因为名字不同而对不上。新步骤的 `parent_idx` 沿用第 N 步的父步骤:SDK 记的运行有一个根上的 `agent.run` 步,LLM 步和工具步都挂在它下面,重跑出来的步骤也挂在同一个地方,Day 114 的时间轴树才不会乱。重跑、造样例、明天的评测用例,用的都是这同一个循环,只是 `exec_tool` 不一样。这让三个功能的行为保持一致:你在 Loupe 里重跑看到的,就是评测时会发生的。

**`llm_call` 也是注入的。** 生产用 `openai_llm_call`,走全课统一的 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` 三个环境变量,外加 `LLM_EXTRA_BODY`(Day 3 用来关 DeepSeek 思考模式的那个)。文件开头的 `load_dotenv()` 会读 `server/.env`,所以后端要先 `uv add openai python-dotenv`,再把这几个变量写进 `server/.env`。测试里换成按剧本说话的假模型。依赖注入在 Python 里不需要框架,把函数当参数传就行。

**`reasoning_content` 要原样带回去。** Day 8 讲过,DeepSeek 思考模式下带 tools 的多轮请求要回传之前各轮的 `reasoning_content`。`openai_llm_call` 把它存进 assistant 消息,`run_loop` 再原样 append 进 messages,下一轮自然就带上了。

**前缀步骤是复制,不是引用。** 新运行把原运行第 N 步之前的步骤复制一份(换掉 `run_id`,时间整体平移到「刚好在现在结束」,这样时间轴上前缀和新跑的步骤首尾相接,耗时也只算真实花掉的时间;根上 `agent` 步的结束时间在 `finish` 里跟着新运行走)。也可以只存一个指针,查询时拼起来,能省存储。但复制以后新运行是完整、自包含的,详情页、对比页、导出都不用知道「分叉」这回事。存储便宜,复杂度贵。

**统计写进 tags。** `cassette:3`、`live:0`、`miss:2` 这几个计数放进新运行的 tags,列表页就能直接看到这次重跑有多少工具调用是回放的、多少 miss 了。更规范的做法是给 Step 加一个 `source` 字段,但 Day 112 定的模型里没有,改模型会牵动导入器和前端类型。先用 tags,在 ADR 里记一笔(Day 120 会写)。

**`max_steps`。** 重跑时模型可能被 miss 逼得绕圈子(后面会看到),必须有上限。超了就记一个 `kind="other"` 的错误步,运行状态标成 error。

**成本交给 `fill_costs`。** `finish` 汇总 token 和状态以后,调用 Day 113 的 `fill_costs` 按 `server/prices.json` 补上每个 LLM 步的成本和运行总成本,和导入时走的是同一条路,价格只维护一份。存库用 `db.save_trace`,它在一个事务里写 run、tags 和全部步骤,`step_count` 也是它算的。

再加一个白名单文件。只有这里列出的工具可以在重跑时真实执行:

```python
# agent-loupe/server/loupe/demo_tools.py
# 允许「真实执行」的工具白名单。只放只读、无副作用、结果不随时间变的;查询类和写操作一律走回放。
import ast
import operator as op
from typing import Any

OPS = {ast.Add: op.add, ast.Sub: op.sub, ast.Mult: op.mul, ast.Div: op.truediv,
       ast.Pow: op.pow, ast.USub: op.neg, ast.Mod: op.mod}


def calculate(expression: str) -> dict[str, Any]:
    """Day 8 的安全计算器:只认数字和四则运算,绝不 eval。"""
    def ev(n: ast.AST) -> float:
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)):
            return n.value
        if isinstance(n, ast.BinOp) and type(n.op) in OPS:
            return OPS[type(n.op)](ev(n.left), ev(n.right))
        if isinstance(n, ast.UnaryOp) and type(n.op) in OPS:
            return OPS[type(n.op)](ev(n.operand))
        raise ValueError("只支持数字和 + - * / ** %")

    return {"expression": expression, "result": ev(ast.parse(expression, mode="eval").body)}


LIVE_TOOLS = {"calculate": calculate}
```

白名单里只有 Day 8 那个只支持四则运算的安全计算器。`get_weather` 和 `read_file` 不放:天气每时每刻在变,文件在服务器上可能根本不存在,真实执行拿到的都不是原运行那时候的结果。真实项目里,白名单只能放**只读、无副作用、结果不随时间变**的工具:计算器、单位换算、查静态配置。任何会写数据库、发消息、扣钱的工具,永远只能回放。这条规则不是靠代码审查保证的,而是靠白名单:默认全部回放,能真实执行的必须显式列出来。

## 路由

在 Day 116 的 `routes.py` 里追加重跑接口(文件开头的 import 补上 `from pydantic import BaseModel`、`from loupe import replay` 和 `from loupe.demo_tools import LIVE_TOOLS`):

```python
# ---- Day 117:重跑 ----
class ReplayRequest(BaseModel):
    from_step: int
    overrides: replay.Overrides = replay.Overrides()
    live_tools: bool = False
    repeat: int = 1


def register_replay(app: FastAPI, conn: sqlite3.Connection, llm_call: replay.LLMCall = replay.openai_llm_call) -> None:
    @app.post("/api/runs/{run_id}/replay")
    def replay_run(run_id: str, req: ReplayRequest) -> dict:
        if not 1 <= req.repeat <= 3:
            raise HTTPException(400, "repeat 只能是 1–3")
        try:
            runs = [replay.fork_run(conn, run_id, req.from_step, req.overrides, llm_call,
                                    live_tools=LIVE_TOOLS if req.live_tools else None)
                    for _ in range(req.repeat)]
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        return {"runs": [r.id for r in runs], "compare_url": f"/diff?a={run_id}&b={runs[0].id}"}
```

`create_app` 末尾在 `register_diff(app, conn)` 后面加一行 `register_replay(app, conn)`(import 那一行也补上 `register_replay`)。

这个接口是同步的:请求进来,跑完整个分叉,再返回。几步到十几步的重跑,DeepSeek 上通常几秒到十几秒,同步够用。如果你的 Agent 一跑就是几分钟,要改成后台任务:接口立刻返回新运行 id,前端轮询或用 SSE 接收进度。Day 99 讲过持久化运行时,那套东西可以直接用在这里,今天不展开。

`repeat` 为什么最多 3?下面实测一节会解释为什么需要它,上限是为了防止误点一次就跑几十次。

## 测试

```python
# agent-loupe/server/tests/test_replay.py
import pytest

from loupe import db
from loupe.replay import Cassette, Overrides, fork_run
from tests.helpers import T0, call, tool, trace

TOOLS = [{"type": "function", "function": {"name": "get_weather", "parameters": {"type": "object"}}}]


class FakeLLM:
    """按剧本回话的假模型,同时记下每次收到的 messages。"""

    def __init__(self, script):
        self.script, self.seen = list(script), []

    def __call__(self, messages, tools, model, temperature):
        self.seen.append([dict(m) for m in messages])
        return self.script.pop(0), 100, 20


def seed(conn):
    from loupe.models import Step
    sys_msg = {"role": "system", "content": "你是天气助手"}
    user = {"role": "user", "content": "北京现在多少度?"}
    a1 = {"role": "assistant", "content": None, "tool_calls": [call(0, "get_weather", {"city": "北京"})]}

    def llm_step(idx, messages, output):
        return Step(run_id="orig", idx=idx, kind="llm", name="chat m1", started_at=T0, ended_at=T0,
                    input={"messages": messages, "tools": TOOLS}, output=output, model="m1")

    db.save_trace(conn, trace("orig", [
        llm_step(0, [sys_msg, user], a1),
        tool(1, "get_weather", {"city": "北京"}, {"temperature": 11.9}),
        llm_step(2, [sys_msg, user, a1, {"role": "tool", "tool_call_id": "c0", "content": "{}"}],
                 {"role": "assistant", "content": "11.9 度"}),
    ]))


@pytest.fixture
def conn(tmp_path):
    c = db.connect(str(tmp_path / "t.db"))
    seed(c)
    return c


def test_cassette_matches_on_canonical_args():
    c = Cassette.from_steps([tool(1, "get_weather", {"city": "北京"}, {"t": 1})])
    assert c.play("get_weather", '{"city":"北京"}')[:2] == (True, {"t": 1})
    assert c.play("get_weather", {"city": "上海"})[0] is False


def test_fork_from_first_step_replays_tool_from_cassette(conn):
    llm = FakeLLM([
        {"role": "assistant", "content": None, "tool_calls": [call(9, "get_weather", {"city": "北京"})]},
        {"role": "assistant", "content": "北京 11.9 度,晴"},
    ])
    new = fork_run(conn, "orig", 0, Overrides(system_prompt="你是简洁的天气助手"), llm)
    steps = db.load_trace(conn, new.id).steps
    assert [s.kind for s in steps] == ["llm", "tool", "llm"]
    assert steps[1].output == {"temperature": 11.9}          # 没有真的调工具
    assert llm.seen[0][0]["content"] == "你是简洁的天气助手"   # 系统提示词被替换
    assert new.parent_run_id == "orig" and new.forked_from_step == 0
    assert "cassette:1" in new.tags
    assert db.get_run(conn, new.id)["step_count"] == 3


def test_fork_keeps_prefix_and_reports_cassette_miss(conn):
    llm = FakeLLM([
        {"role": "assistant", "content": None, "tool_calls": [call(9, "get_weather", {"city": "上海"})]},
        {"role": "assistant", "content": "查不到"},
    ])
    new = fork_run(conn, "orig", 2, Overrides(), llm)
    steps = db.load_trace(conn, new.id).steps
    assert [s.idx for s in steps] == [0, 1, 2, 3, 4]
    assert steps[3].error and "cassette miss" in steps[3].error
    assert "miss:1" in new.tags


def test_fork_from_tool_step_is_rejected(conn):
    with pytest.raises(ValueError, match="LLM 步"):
        fork_run(conn, "orig", 1, Overrides(), FakeLLM([]))


def test_max_steps_marks_error(conn):
    loop = [{"role": "assistant", "content": None, "tool_calls": [call(i, "get_weather", {"city": "北京"})]}
            for i in range(5)]
    new = fork_run(conn, "orig", 0, Overrides(), FakeLLM(loop), max_steps=3)
    assert new.status == "error"


def test_write_tools_are_never_live(conn):
    """白名单之外的写操作,就算打开了「真实执行」也只能回放或 miss。"""
    called = []
    live = {"calculate": lambda expression: {"result": 0}}
    llm = FakeLLM([
        {"role": "assistant", "content": None, "tool_calls": [call(9, "create_refund_request", {"amount": 100})]},
        {"role": "assistant", "content": "好"},
    ])
    import loupe.demo_tools as dt
    assert "create_refund_request" not in dt.LIVE_TOOLS
    new = fork_run(conn, "orig", 0, Overrides(), llm, live_tools=live)
    assert not called and "miss:1" in new.tags
```

六个测试分别覆盖:磁带按规范化参数匹配;从第 0 步分叉时工具走回放、系统提示词被替换、血缘字段正确、`step_count` 正确;从中间分叉时前缀被保留、miss 被记录;不允许从工具步分叉;超过最大步数时运行标成 error;白名单之外的写操作工具(`create_refund_request`)就算打开了「真实执行」也只会 miss。造数据用的是 Day 116 的 `tests/helpers.py`(造 tool_call 的 `call` 和造整条运行的 `trace` 那天都写好了)。`FakeLLM` 记下了每次收到的 messages,所以能断言「模型真的看到了新的系统提示词」,而不只是「接口返回了 200」。

`uv run pytest -q` 全过以后,再用真模型跑一次。

## 用 DeepSeek 实测:同一个输入,三条不同的路

先造一条真实的原运行。这个脚本用上面的 `run_loop` 调真模型,天气用脚本里写死的假数据(北京 11.9 度、上海 17.7 度),计算器用白名单里那个。放在 `server/scripts/` 下:

```python
# agent-loupe/server/scripts/make_weather_run.py  造一条真实的样例运行(调真模型,天气用本地假数据)
import os
import sys

from dotenv import load_dotenv

from loupe import db
from loupe.demo_tools import calculate
from loupe.models import Run
from loupe.replay import finish, now, openai_llm_call, run_loop

load_dotenv()
WEATHER = {"北京": (11.9, "晴"), "上海": (17.7, "阴"), "广州": (24.3, "多云")}


def get_weather(city: str, unit: str = "celsius") -> dict:
    t, w = WEATHER.get(city, (20.0, "未知"))
    return {"city": city, "temperature": round(t * 9 / 5 + 32, 1) if unit == "fahrenheit" else t,
            "unit": unit, "weather": w}


TOOLS = [
    {"type": "function", "function": {"name": "get_weather", "description": "查询城市当前天气",
     "parameters": {"type": "object", "properties": {"city": {"type": "string"},
                    "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]}}, "required": ["city"]}}},
    {"type": "function", "function": {"name": "calculate", "description": "计算数学表达式,只支持 + - * /",
     "parameters": {"type": "object", "properties": {"expression": {"type": "string"}}, "required": ["expression"]}}},
]
REGISTRY = {"get_weather": get_weather, "calculate": calculate}
question = sys.argv[1] if len(sys.argv) > 1 else "北京和上海现在温差几度?换算成华氏度差多少?"
conn = db.connect(os.environ.get("LOUPE_DB", "loupe.db"))
t0 = now()
run = Run(id=f"weather-{t0:%H%M%S}", name=question, started_at=t0, ended_at=t0,
          model=os.environ["LLM_MODEL"], tags=["sample"])
messages = [{"role": "system", "content": "你是天气助手。需要实时数据或计算时用工具,不要心算。"},
            {"role": "user", "content": question}]


def exec_tool(name, args):
    try:
        return REGISTRY[name](**args), None
    except Exception as e:
        return None, f"{type(e).__name__}: {e}"


steps = run_loop(run, messages, TOOLS, openai_llm_call, exec_tool, start_idx=0, parent_idx=None, temperature=None)
trace = finish(run, steps)
db.save_trace(conn, trace)
print(trace.run.id, len(steps), "步", trace.run.total_input_tokens, "in", trace.run.total_output_tokens, "out")
for s in steps:
    print(s.idx, s.kind, s.name, s.input if s.kind == "tool" else (s.output or {}).get("content"))
```

```bash
cd server && uv run python -m scripts.make_weather_run
```

下面用来做实验的那条 6 步原运行,我已经导出成 `samples/day117_weather.jsonl` 放进了仓库(run id 是 `weather-011033`,导出脚本 Day 119 会讲)。你可以直接导入它,从同一个起点重跑,和我的结果对照。

我在 2026 年 10 月 15 日用 `deepseek-flash`(`.env` 里关了思考模式)跑了两次这个脚本,问题一模一样:「北京和上海现在温差几度?换算成华氏度差多少?」。第一次跑了 7 步:先并行查两个城市,然后**一次请求了两个计算**(`17.7 - 11.9` 和 `(17.7 - 11.9) * 9 / 5`),最后回答。第二次跑了 6 步:查完天气以后只算了 `17.7 - 11.9`,华氏度的差值是模型自己在回答里算的,还顺手解释了一句「温差换算不需要加减 32」。

同样的输入、同样的模型、同样的工具结果,走了两条路。这就是重跑功能要面对的第一个现实:**模型调用不是确定性的。** 你改了提示词,重跑一次,行为变了,可能是因为提示词,也可能只是运气。

然后以第二次(6 步)为原运行,做三组重跑。数字都是我这次实际跑出来的,你的结果大概率不一样,这正是重点。

**第一组:从第 3 步重跑,什么都不改,`repeat=2`。** 两次重跑都是 7 步,和原运行的 6 步不一样:模型在第 3 步一次要了两个计算,和我造样例时的第一次一模一样。tags 是 `cassette:1`、`miss:1`:`17.7 - 11.9` 在磁带里有,回放;`(17.7 - 11.9) * 9 / 5` 原运行没算过,miss 了。

**第二组:从第 0 步重跑,系统提示词末尾加一句「回答只用一句话」。** 这次跑了 9 步,tags 是 `cassette:3`、`miss:2`。打开对比页能看到全过程:第 0 到 2 步和原运行相同(查两次天气都命中磁带);第 3 步要了两个计算,第二个 miss;模型收到 miss 错误以后又发起了一次 `calculate("5.8 * 9 / 5")`,又 miss;最后它放弃了工具,自己算出 10.4℉ 回答了。最终回答确实只有一句话。但请注意,系统提示词里明明写着「不要心算」,模型最后还是心算了,因为工具一直报错。

**第三组:从第 3 步重跑,勾上「真实执行」。** tags 变成 `cassette:0`、`live:2`、`miss:0`,7 步,两个计算都真实执行了。

这三组数据说明了两件事。

第一,**cassette miss 会扭曲行为。** 第二组里模型多绕了两步、违反了「不要心算」的指令,这不是新提示词的效果,是 miss 逼出来的。如果你不知道这次重跑有两次 miss,就会得出错误结论:「加了一句话以后,模型变得不听话了」。所以重跑结果里必须醒目地显示 miss 数量(这就是为什么我们把它写进 tags),对比页里 miss 的工具步会算进「出错步」。

第二,**纯函数类的工具应该真实执行。** 计算器不依赖外部世界,真实执行和回放在「外部世界没变」这个意义上是等价的,却能避免 miss。白名单就是干这个的。查询类工具(查订单、查库存)不行:真实执行会拿到今天的数据,而不是原运行那时候的数据,对比就不干净了。

还有一个更深的问题:miss 时到底应该怎么办?我们的选择是把错误返回给模型,让运行继续。另外两种选择是中止整个重跑,或者调用一个「模拟器」(比如让另一个 LLM 根据磁带猜一个合理的结果)。中止最诚实,但很多重跑会跑不完;模拟器最顺滑,但它生成的是假数据,而你在调试的恰恰是 Agent 对数据的反应。我选了中间这条路,并且把 miss 显式暴露出来。这个取舍值得写进 Day 120 的 ADR。

## 非确定性:为什么要 repeat

第一组实验里,什么都没改的重跑和原运行就不一样了。这意味着任何一次「改了 X,重跑一次,结果变好了」都可能是噪声。

有几种办法可以压低噪声,但都不彻底。`temperature=0` 能让输出更稳定,但不保证完全一致,服务端的批处理、浮点运算顺序都会带来差异。OpenAI 有一个 `seed` 参数,官方 cookbook 的说法是「尽力而为」的可复现,并且会返回一个 `system_fingerprint`,后端配置变了这个值就会变。其他兼容厂商是否支持 `seed`,用之前要查各自的文档,不要默认有。

所以界面上提供 `repeat`:同样的修改跑 2 到 3 次。三次都变好,可以初步相信;一好一坏一样,说明这个改动的效果在噪声里。真正要下结论,得用明天的评测用例跑更多次,再用 Day 69 的统计方法看差异是不是显著。重跑是用来**形成假设**的,评测是用来**验证假设**的,这两件事在 Loupe 里是两个功能。

## 前端:重跑对话框

在 `web/src/api.ts` 末尾追加。Day 114 的 `getJson` 只管 GET,遇到错误只抛一个普通的 `Error`;重跑是 POST,而且要分得清「限流」和「真的出错」,所以加一个带状态码的 `ApiError` 和对应的 `postJson`:

```typescript
// ---- Day 117 新增:重跑 ----
/** POST 请求的错误要带上状态码和 Retry-After,前端才能分清「限流」和「真的出错」 */
export class ApiError extends Error {
  constructor(public status: number, message: string, public retryAfter?: number) {
    super(message);
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const ra = res.headers.get('retry-after');
    throw new ApiError(res.status, data.detail ?? `${res.status} ${res.statusText}`, ra ? Number(ra) : undefined);
  }
  return data as T;
}

export interface ReplayOverrides {
  system_prompt?: string;
  model?: string;
  temperature?: number;
}

export interface ReplayRequest {
  from_step: number;
  overrides: ReplayOverrides;
  live_tools: boolean;
  repeat: number;
}

export const replayRun = (runId: string, req: ReplayRequest) =>
  postJson<{ runs: string[]; compare_url: string }>(`/api/runs/${encodeURIComponent(runId)}/replay`, req);
```

对话框组件,`web/src/components/ReplayDialog.tsx`。传进来的 `step` 是 Day 115 的 `StepInspector` 已经取到的 `StepFull`,不用再请求一次:

```tsx
// agent-loupe/web/src/components/ReplayDialog.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, replayRun, type StepFull } from '../api';

interface Msg {
  role: string;
  content?: string | null;
}

function currentSystemPrompt(step: StepFull): string {
  const msgs = ((step.input ?? {}) as { messages?: Msg[] }).messages ?? [];
  return msgs[0]?.role === 'system' ? (msgs[0].content ?? '') : '';
}

export function ReplayDialog({ runId, step, onClose }: { runId: string; step: StepFull; onClose: () => void }) {
  const navigate = useNavigate();
  const original = currentSystemPrompt(step);
  const [system, setSystem] = useState(original);
  const [model, setModel] = useState(step.model ?? '');
  const [temperature, setTemperature] = useState('');
  const [live, setLive] = useState(false);
  const [repeat, setRepeat] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const resp = await replayRun(runId, {
        from_step: step.idx,
        overrides: { // 只发真正改过的字段,后端记下的就是「改了什么」
          ...(system !== original ? { system_prompt: system } : {}),
          ...(model && model !== step.model ? { model } : {}),
          ...(temperature !== '' ? { temperature: Number(temperature) } : {}),
        },
        live_tools: live,
        repeat,
      });
      navigate(resp.compare_url); // 跑完直接进对比页
    } catch (e) {
      // 429 是限流或额度用完,后端的提示就是写给人看的,原样显示
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog open className="dialog" aria-labelledby="replay-title">
      <h3 id="replay-title">从第 {step.idx} 步重跑</h3>
      <p className="hint">第 {step.idx} 步之前的步骤原样保留,从这一步开始重新请求模型;工具结果默认从原运行回放。</p>
      <label>
        系统提示词
        <textarea rows={6} value={system} onChange={(e) => setSystem(e.target.value)} />
      </label>
      <label>
        模型 <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="留空用原来的" />
      </label>
      <label>
        temperature{' '}
        <input type="number" step="0.1" min="0" max="2" value={temperature}
          onChange={(e) => setTemperature(e.target.value)} placeholder="留空用默认" />
      </label>
      <label>
        <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
        白名单里的只读工具真实执行(其余工具一律用录制结果)
      </label>
      <label>
        重复跑{' '}
        <select value={repeat} onChange={(e) => setRepeat(Number(e.target.value))}>
          {[1, 2, 3].map((n) => <option key={n} value={n}>{n} 次</option>)}
        </select>
        <span className="hint"> 同样的输入模型也可能走出不同的路,多跑几次才分得清是改动的效果还是运气</span>
      </label>
      {error && <p className="bad">{error}</p>}
      <menu>
        <button onClick={onClose} disabled={busy}>取消</button>
        <button onClick={submit} disabled={busy}>{busy ? '运行中…' : '重跑'}</button>
      </menu>
    </dialog>
  );
}
```

几个交互上的考虑:

- **只把改过的字段发出去。** 系统提示词预填成原来的内容,用户没改就不放进 `overrides`。这样后端记录的修改是「真正改了什么」,而不是「用户提交了什么」。
- **「真实执行」默认不勾,文案写清楚范围。** 用户最容易误解的就是这个开关,以为勾上以后所有工具都真实执行。文案里直接写「白名单里的只读工具」和「其余工具一律用录制结果」。
- **repeat 旁边写一句为什么。** 不解释的话,大部分人不会去改它。
- **跑完直接跳转对比页。** 后端返回的 `compare_url` 是 `/diff?a=原运行&b=第一条新运行`。repeat 大于 1 时,其他几条可以在运行列表里找到(它们的 `parent_run_id` 都指向原运行),练习 3 让你把它们也放进对比页。

然后在 Day 115 的 `web/src/components/StepInspector.tsx` 里加入口。顶部 import 对话框,组件里加一个状态,在「概览」页签的 `<dl>` 后面、「上下文构成」前面放按钮(工具步不显示):

```tsx
import { ReplayDialog } from './ReplayDialog';

// StepInspector 组件里,和其他 useState 放在一起
const [dialog, setDialog] = useState<'replay' | 'case' | null>(null); // Day 117/118

// 「概览」页签里,</dl> 后面
{isLlm && (
  <p className="actions">
    <button onClick={() => setDialog('replay')}>从这一步重跑</button>
  </p>
)}
{dialog === 'replay' && <ReplayDialog runId={runId} step={step} onClose={() => setDialog(null)} />}
```

`dialog` 的类型里先留好 `'case'`,明天的「存成评测用例」按钮放在同一行。对话框的样式追加到 `index.css`:

```css
/* ---- Day 117/118 新增:对话框 ---- */
.actions { display: flex; gap: 8px; margin: 12px 0; }
.dialog { position: fixed; inset: 10vh 0 auto; width: min(560px, 92vw); max-height: 80vh; overflow: auto; z-index: 10;
  background: var(--panel); color: var(--ink); border: 1px solid var(--line); border-radius: 6px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2); }
.dialog label { display: block; margin: 8px 0; }
.dialog textarea { width: 100%; font: inherit; }
.dialog menu { display: flex; justify-content: flex-end; gap: 8px; padding: 0; }
```

## 动手练习

1. **跑通测试和实测。** `uv run pytest -q` 全过;用 `make_weather_run.py` 造一条原运行,在界面上从第一个 LLM 步重跑一次、从中间某个 LLM 步重跑一次,确认自动跳到对比页、前缀步骤显示为「相同」。
2. **复现 cassette miss。** 找一个会让模型调用新参数的修改(比如系统提示词里要求「所有计算结果保留一位小数并重新计算」),从中间重跑,记下 tags 里的 miss 数量,在对比页找到 miss 的那一步,看模型收到错误以后做了什么。然后勾上「真实执行」再跑一次,比较两次的步数和最终回答。
3. **repeat 的结果一起对比。** 现在 `repeat=3` 只会跳到第一条的对比页。改成跳到一个汇总页:三条新运行分别和原运行比,列出每条的步数、miss 数、最终回答,让人一眼看出三次是否一致。
4. **运行详情页显示血缘。** 如果 `parent_run_id` 不为空,在详情页顶部显示「从 XXX 的第 N 步重跑」,点击跳到原运行;原运行详情页显示「被重跑过 K 次」,列出子运行。需要后端加一个按 `parent_run_id` 查询的接口(在 `runs` 表上给这一列建索引)。
5. **把安全测试写全。** 仓库里的 `test_write_tools_are_never_live` 只检查了一个工具名。改成参数化测试:遍历 `samples/` 里所有样例出现过的工具名,断言除了 `LIVE_TOOLS` 里的,其余工具在打开「真实执行」时也一次都不会被调用(给每个工具挂一个调用就记录的假函数)。

**验收标准:** 测试全过,练习 5 的参数化安全测试存在且通过;能拿出一组自己跑的数据,说明一次 miss 怎样改变了模型后续的行为;能说出你的白名单里有哪些工具、每个为什么是安全的。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 录制-回放(record/replay) | 第一次运行时记下外部调用的输入和输出,之后用记录代替真实调用 |
| cassette(磁带) | 存放录制结果的地方,VCR.py 里的叫法;这里就是原运行的全部工具步 |
| cassette miss | 重跑时要调用的工具和参数在磁带里找不到 |
| 分叉(fork) | 从原运行某一步开始,带着修改继续跑,生成一条新运行 |
| 血缘(lineage) | 新运行和原运行的关系,用 `parent_run_id` 和 `forked_from_step` 记录 |
| 白名单(allowlist) | 显式列出允许真实执行的工具,其余默认回放 |
| 非确定性(non-determinism) | 同样的输入,模型多次调用给出不同输出 |
| seed / system_fingerprint | OpenAI 提供的尽力而为的可复现参数,以及标识后端配置的指纹 |
| 依赖注入 | 把要调用的函数(模型、工具)作为参数传进去,方便测试时替换 |

## 常见误区

**重跑时所有工具都真实执行。** 写操作会重复发生,查询类工具会拿到今天的数据,和原运行不可比。默认回放,只有白名单里的只读工具可以真实执行。

**cassette miss 时假装没事。** miss 会把模型逼得绕圈子甚至违反指令。重跑结果里必须显示 miss 数量,分析行为变化之前先看它。

**重跑一次就下结论。** 什么都不改的重跑都可能走出不同的路。一次重跑只能形成假设,验证要靠多次运行和评测。

**以为 temperature=0 就是确定性的。** 它只能降低随机性。不同厂商、不同时间的同一请求仍然可能不同。

**只存最后一条消息,想着重跑时再拼。** LLM 步不存完整输入,第 N 步的上下文就无法精确重建(中间可能有压缩、截断、注入)。存储便宜,精确重建的能力很贵。

**把分叉运行做成对原运行的引用。** 省了一点存储,换来所有读路径都要处理「前缀在另一条运行里」。复制前缀,让每条运行自包含。

## 学习资料

### 文档与文章

- [VCR.py 文档](https://vcrpy.readthedocs.io/en/latest/):录制-回放思路的经典实现,看「Usage」和「Record Modes」两节,尤其是 `once` / `new_episodes` / `none` 几种模式,和我们的 miss 处理对照着想,20 分钟。
- [Langfuse · Playground](https://langfuse.com/docs/prompt-management/features/playground):看它怎么从一条 trace 里把某次 LLM 调用拿出来改了再跑,和我们的「从第 N 步继续跑完」区别在哪,15 分钟。
- [LangSmith 文档](https://docs.smith.langchain.com/):搜 Playground 相关章节,看它对「从 trace 打开 playground」的设计,15 分钟。
- [OpenAI Cookbook · Reproducible outputs with the seed parameter](https://cookbook.openai.com/examples/reproducible_outputs_with_the_seed_parameter):`seed` 和 `system_fingerprint` 怎么用,以及为什么只是「尽力而为」,15 分钟。
- [Anthropic · Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):回顾一下 Agent 和工作流的区别。正因为 Agent 的路径由模型在运行时决定,才需要重跑和对比这类工具,10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1BfC1YGEg2&autoplay=0&high_quality=1" title="【LangSmith】LLM应用调试测试监控神器 - LangSmith初体验（纯干货）" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>大模型-小懒哥 · 【LangSmith】LLM应用调试测试监控神器 - LangSmith初体验(纯干货) · 19 分钟,看 trace 列表和 Playground 那几段,对照 Loupe 想想它在「从中间继续跑」上缺了什么。</figcaption>
</figure>

- 前端屎不了《Langfuse 到底是什么?LLM 监控、Trace 与历史记录一次讲清》(BV1nZ3Q6yEzk,11 分钟):Langfuse 的 trace 模型和界面,适合拿来和 Day 112 的 Run/Step 对照。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/h4f6bIWGkog" title="Getting Started with LangSmith (4/8): Playground & Prompts" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Getting Started with LangSmith (4/8): Playground &amp; Prompts · 8 分钟,官方演示怎么从一次运行打开 Playground 改提示词重跑。</figcaption>
</figure>

- LangChain《LangSmith explained in 5 minutes》(YouTube `KPcEhLoh-Wc`,6 分钟):LangSmith 全貌的快速版。

### 书籍

- Martin Kleppmann《Designing Data-Intensive Applications》(O'Reilly, 2017;中文版《数据密集型应用系统设计》中国电力出版社):第 11 章「流处理」里讲事件溯源(event sourcing)和「从日志重放出状态」的部分。Agent 的 trace 本质上就是一份事件日志,重跑就是在日志的某个位置分叉重放,书里关于确定性和副作用的讨论可以直接借用。

### 开源项目与代码

- [kevin1024/vcrpy](https://github.com/kevin1024/vcrpy):看 `vcr/cassette.py` 里怎么匹配请求、怎么处理同一个请求出现多次,和我们的队列设计对比。
- [langfuse/langfuse](https://github.com/langfuse/langfuse):Playground 的前端实现在 `web/` 目录下,可以搜 playground 找到对应组件。
- [Arize-ai/phoenix](https://github.com/Arize-ai/phoenix):另一个开源的 trace 平台,也有从 span 打开 playground 的功能,可以对照看。

## 自测

1. 重跑时为什么默认回放工具结果,而不是真实执行?说出至少三个理由。

<details><summary>答案</summary>

副作用(写操作会重复发生,比如重复退款);成本和速度(搜索、爬取、大查询都要钱和时间);可比性(外部数据在变,真实执行会混入「世界变了」的影响,分不清行为变化来自修改还是来自数据)。

</details>

2. 磁带的键为什么要用规范化参数摘要,而不是原始的 arguments 字符串?

<details><summary>答案</summary>

模型输出的 arguments 是字符串,同样的参数可能有不同的空格、key 顺序。用原始字符串当键,`{"city":"北京"}` 和 `{"city": "北京"}` 会被当成两次不同的调用而 miss。规范化后再摘要,和对比页的签名口径也一致。

</details>

3. 一次重跑的 tags 是 `cassette:3, live:0, miss:2`,最终回答比原来差。你能直接得出「新提示词更差」的结论吗?

<details><summary>答案</summary>

不能。两次 miss 意味着模型收到了两次工具错误,后续行为很可能是被 miss 扭曲的,而不是提示词的效果。应该先看 miss 发生在哪、是什么工具;如果是纯函数工具,打开「真实执行」再跑;再用 repeat 多跑几次排除随机性。

</details>

4. 为什么只允许从 LLM 步开始重跑?

<details><summary>答案</summary>

工具步的输入是上一个 LLM 步决定的,它本身没有可以修改的「决策」。想改变工具调用,就去改做出这个决定的那一步。从 LLM 步开始也让上下文重建很简单:直接取那一步存的完整请求。

</details>

5. 什么样的工具可以放进「真实执行」白名单?举一个不能放的例子并说明原因。

<details><summary>答案</summary>

只读、无副作用、结果不依赖随时间变化的外部状态的工具,比如计算器、单位换算、查静态配置。不能放的例子:`get_order_status`。它虽然只读,但订单状态会变,真实执行会拿到今天的状态,和原运行不可比;`create_refund_request` 更不能放,会产生真实副作用。

</details>

6. 资深面试题:你们的客服 Agent 有 30 个工具,其中 8 个有写操作。产品经理希望「线上出了问题以后,工程师能一键从出问题的那一步改提示词重跑」。你怎么设计,要和产品经理讲清楚哪些限制?

<details><summary>答案</summary>

设计:trace 里 LLM 步存完整请求,工具步存输入输出,作为磁带;重跑默认全部回放,写操作工具在重跑环境里被替换成只记录不执行的桩;只读且稳定的工具进白名单可选真实执行;重跑结果显示 cassette 命中、miss、真实执行的数量;新运行记录血缘,自动和原运行对比;加权限和审计(谁在什么时候重跑了哪条客户对话,因为里面有客户数据)。要讲清的限制:模型非确定,一次重跑不能证明修复有效,要转成评测用例多次运行;修改导致模型调用了原运行没调过的工具或参数时会 miss,结果有偏差;写操作的后续影响(比如退款成功后客户的回复)无法回放,重跑只能看到 Agent 的决策,看不到真实世界的后续;客户数据的使用要合规,重跑环境不能把数据发给未经批准的模型。

</details>

## 明天预告

今天的重跑能帮你形成假设:「加了这句提示词,模型在第 3 步不再乱算了」。但一次、三次重跑都说明不了它在更多场景下是否成立,也防不住以后的改动把它改坏。明天(Day 118)把这条线接到评测上:**把失败步骤一键存成评测用例**,快照保存那一步的完整输入和工具结果,批量跑、算通过率,导出成 Day 35 的评测集格式,改提示词前后各跑一批,用回归对比看板看哪些用例变差了。
