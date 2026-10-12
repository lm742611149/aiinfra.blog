---
title: 'Day 62 · Agent Harness 设计:把循环做成可复用的运行时'
description: '基础篇 Day 9 手写的那 100 行循环,到了平台上要变成一个运行时:工具层、上下文管理、权限、钩子、子 Agent、状态持久化都要有扩展点。今天先读 OpenAI Agents SDK、Claude Agent SDK 和 LangGraph 三家的运行时源码,看它们各自怎么取舍,再给 AgentOps 写一个 200 行的 harness,带审批暂停和恢复。'
pubDate: 2026-10-12
regime: none
tags: ['harness', 'runtime', 'agent-sdk', 'langgraph', 'agent-60']
series: 'agent-60'
day: 62
lang: 'zh'
---

## 今天要解决的问题

2025 年下半年开始,「harness」这个词突然在 Agent 圈里到处都是。腾讯、美团、字节好几个岗位的标题直接写着 Agent Harness,Anthropic 写长任务的文章标题也是 harness。它到底指什么?简单说,模型是「大脑」,harness 是包在模型外面、让它能干活的那一整套运行时:循环、工具、上下文、权限、钩子、状态。Claude Code、Codex、Cursor 的 Agent 模式,本质上都是一个 harness 加一个模型。

基础篇 Day 9 你写过一个 100 行的循环,那是 harness 的最小形态。今天要把它升级成平台级的运行时。学完你应该能:

1. 说出一个生产级 harness 由哪几层组成,每层解决什么问题。
2. 在 OpenAI Agents SDK、Claude Agent SDK、LangGraph 的源码里找到对应的部分,说出三家的取舍差别。
3. 给 AgentOps 写一个带扩展点的 harness:换模型、换上下文策略、换权限策略、挂钩子、暂停等审批、从存储恢复,都不用改核心循环。
4. 说清楚 harness 里哪些是扩展点、哪些必须是硬约束。

预计用时 5–6 小时,读源码占一半。前置:Day 9(Agent 循环)、Day 12(失败模式)、Day 25(审批中断)、Day 27(框架横评)。

## harness 到底包了哪些东西

先把 Day 9 的循环拿出来看。它做了三件事:调模型、执行工具、把结果塞回去,直到模型不再调工具。上线以后你会陆续往里加东西,加着加着就会发现它们可以分成七层:

**循环本身**。决定什么时候继续、什么时候停:模型没有工具调用就停,超过步数停,超过预算停,遇到需要人确认的操作就暂停。

**工具层**。工具注册、schema 生成、参数校验、执行、超时、把报错翻译成模型能看懂的话。工具名不存在、参数类型不对,这一层要兜住。

**上下文管理**。每一轮送给模型的 messages 不能无限增长,要裁剪、压缩、清理旧的工具结果。明天 Day 63 专门讲。

**权限**。每次工具调用之前问一句:这个调用允许吗?允许、拒绝,还是要人来批?规则可能来自配置、来自租户、也可能来自运行时的上下文(比如退款金额超过 1000 才要审批)。

**钩子**。在关键时刻(运行开始、工具调用前后、需要审批、运行结束、上下文压缩前)通知外面的人。日志、tracing、计费、审计、风控都挂在钩子上,不进核心循环。

**子 Agent**。把一部分任务交给另一个有自己上下文的循环去做,只拿回结论。Day 26 讲过它的收益和代价。

**状态持久化**。循环跑到一半能保存下来,换一台机器、隔几个小时还能接着跑。审批暂停依赖它,Day 65 的持久化执行也依赖它。

<figure>
<svg viewBox="0 0 640 280" role="img" aria-label="harness 的七层:中间是循环,围绕它的是工具层、上下文管理、权限、钩子、子 Agent 和状态持久化,模型在最上面">
  <rect x="0" y="0" width="640" height="280" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" text-anchor="middle">
    <rect x="250" y="14" width="140" height="34" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="320" y="36" font-size="13" fill="var(--ink)">模型 Model</text>
    <rect x="230" y="110" width="180" height="60" rx="30" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="2"/>
    <text x="320" y="136" font-size="13" fill="var(--ink)">循环 loop</text>
    <text x="320" y="154" font-size="10" fill="var(--ink-soft)">继续 / 停 / 暂停</text>
    <g font-size="11">
      <rect x="40" y="70" width="140" height="34" rx="4" fill="var(--paper)" stroke="var(--ink-soft)"/><text x="110" y="92" fill="var(--ink)">上下文管理</text>
      <rect x="40" y="130" width="140" height="34" rx="4" fill="var(--paper)" stroke="var(--ink-soft)"/><text x="110" y="152" fill="var(--ink)">权限策略</text>
      <rect x="40" y="190" width="140" height="34" rx="4" fill="var(--paper)" stroke="var(--ink-soft)"/><text x="110" y="212" fill="var(--ink)">钩子</text>
      <rect x="460" y="70" width="140" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="530" y="92" fill="var(--ink)">工具层</text>
      <rect x="460" y="130" width="140" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="530" y="152" fill="var(--ink)">子 Agent</text>
      <rect x="460" y="190" width="140" height="34" rx="4" fill="var(--paper)" stroke="var(--ink-soft)"/><text x="530" y="212" fill="var(--ink)">状态持久化</text>
    </g>
  </g>
  <g stroke="var(--rule)" fill="none">
    <line x1="320" y1="48" x2="320" y2="110"/>
    <line x1="180" y1="87" x2="240" y2="122"/><line x1="180" y1="147" x2="230" y2="140"/><line x1="180" y1="207" x2="245" y2="160"/>
    <line x1="460" y1="87" x2="400" y2="122"/><line x1="460" y1="147" x2="410" y2="140"/><line x1="460" y1="207" x2="395" y2="160"/>
  </g>
  <text x="320" y="262" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">左边三层是「怎么跑」的策略,右边三层是「和外界打交道」</text>
</svg>
<figcaption>harness 的七个组成部分。好的 harness 把循环做得很薄,其余六层都做成可替换的扩展点。</figcaption>
</figure>

## 读三家的源码

读源码之前先定好问题,不然很容易迷路。今天带着这四个问题去读:循环在哪个文件,工具执行失败时怎么处理,需要人审批时怎么暂停和恢复,状态存在哪。

### OpenAI Agents SDK

仓库是 [openai/openai-agents-python](https://github.com/openai/openai-agents-python),我看的是 2026 年 10 月的 main 分支,PyPI 上的版本是 0.23.1。对外入口是 `src/agents/run.py` 里的 `Runner`,但真正的循环在 `src/agents/run_internal/` 这个目录。目录本身就很说明问题,它按职责拆成了二十几个文件:

- `run_loop.py`:模块开头的注释写得很直白,这里协调工具执行、审批和每一轮的处理,所有符号都是内部的。`run_single_turn` 和 `run_single_turn_streamed` 是一轮的主体。
- `turn_preparation.py` 和 `turn_resolution.py`:一轮开始前怎么准备输入,一轮结束后怎么判断下一步(继续、交接给别的 Agent、输出最终结果)。
- `tool_execution.py`、`tool_planning.py`、`tool_actions.py`:工具调用的计划和执行,分得很细。
- `approvals.py`:需要人批准的工具调用走这里。暂停后返回一个可以序列化的运行状态(`run_state.py`),批准后从这个状态继续跑。
- `guardrails.py`:输入输出的护栏,跟权限是分开的两套机制。
- `session_persistence.py`:会话历史怎么存。

它的取舍是:**把 handoff(交接)当成一等公民**。一个 Agent 的输出可以是「交给另一个 Agent」,循环会切换当前 Agent 继续跑。这让它很适合做客服分流这类场景,代价是状态里要记录「现在是谁在说话」。

### Claude Agent SDK

仓库是 [anthropics/claude-agent-sdk-python](https://github.com/anthropics/claude-agent-sdk-python),版本 0.2.165。它的结构和另外两家完全不同:`src/claude_agent_sdk/` 下面只有 `client.py`、`query.py`、`types.py` 和一个 `_internal/`,还有一个 `_bundled` 目录。原因是它的循环不在 Python 里,而是复用了 Claude Code 本身(打包的 CLI),Python 这一层主要负责传配置和收消息。所以读它的源码,重点看 `types.py` 里的 `ClaudeAgentOptions`,这个类就是它的扩展点清单:

- `allowed_tools`、`disallowed_tools`、`permission_mode`、`can_use_tool`:权限。`can_use_tool` 是一个回调,每次工具调用前由你决定放行还是拒绝。
- `hooks`:钩子。`HookEvent` 一共十种:`PreToolUse`、`PostToolUse`、`PostToolUseFailure`、`UserPromptSubmit`、`Stop`、`SubagentStop`、`PreCompact`、`Notification`、`SubagentStart`、`PermissionRequest`。注意 `PreCompact`,上下文压缩前会通知你,方便你把重要信息先存下来。
- `agents`:用 `AgentDefinition` 定义子 Agent。
- `max_turns`、`max_budget_usd`:步数和预算的硬上限。
- `resume`、`fork_session`、`session_id`:会话恢复和分叉。
- `skills`、`mcp_servers`、`sandbox`:Skills、MCP 和沙箱。

它的取舍是:**给你一个已经在千万级用户身上磨过的 harness,你通过配置和钩子去改造它**,而不是从零拼。上下文压缩、工具结果清理、文件操作、bash 这些都是现成的。代价是循环本身你改不了,而且依赖一个外部进程。

### LangGraph

仓库是 [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph),版本 1.2.14。它的运行时叫 Pregel,在 `libs/langgraph/langgraph/pregel/` 下面,核心是 `_loop.py` 里的 `PregelLoop` 类。`tick` 方法执行一步:找出这一步该跑哪些节点,并行执行,收集它们的写入;`after_tick` 把写入合并进状态,并在每一步结束时写 checkpoint(`_checkpoint.py`)。

它的取舍是:**根本不假设你在写 Agent 循环**,它是一个通用的状态图执行引擎。Agent 循环只是其中一种图(模型节点和工具节点之间的条件边)。好处是你可以把确定性的工作流和 Agent 循环混在一张图里,checkpoint 和中断是图的通用能力;代价是简单的 Agent 写起来比另外两家啰嗦,而且「循环」这个概念被拆散在节点和边里,读代码时要在脑子里拼回来。

### 三家放在一起

| 维度 | OpenAI Agents SDK | Claude Agent SDK | LangGraph |
| --- | --- | --- | --- |
| 循环在哪 | Python,`run_internal/run_loop.py` | 打包的 Claude Code 进程里 | Python,`pregel/_loop.py` |
| 你能改循环吗 | 部分,通过 hooks 和 run config | 基本不能,只能配置 | 能,图就是你自己画的 |
| 权限 | 工具级 approval + guardrails | `can_use_tool` 回调 + 权限模式 + hooks | 自己在节点里写,或用 interrupt |
| 暂停恢复 | 可序列化的 RunState | session resume / fork | checkpoint + thread_id |
| 上下文管理 | 自己做,有 session 抽象 | 内置压缩和清理 | 自己做 |
| 多 Agent | handoff 一等公民 | 子 Agent 定义 | 子图 |
| 适合 | 多角色客服、分流 | 需要成熟工具集的通用 Agent | 工作流和 Agent 混合、强控制 |

面试里如果被问「为什么选这个框架」,这张表的每一行都是一个能展开讲的点。比「它流行」「文档好」有说服力得多。

## Anthropic 的长任务 harness

读完源码,再看一篇讲 harness 设计思路的文章。Anthropic 2025 年 11 月发了《Effective harnesses for long-running agents》,讲他们怎么让 Claude 跨几十个上下文窗口去做一个完整的 Web 应用(一个 claude.ai 的克隆)。

他们发现只靠上下文压缩不够,模型会犯两种错。一种是想一口气做完,结果做到一半上下文满了,下一个会话接手时面对一个写了一半、没有说明的功能。另一种出现在项目后期:新会话看到已经做了不少,就宣布任务完成了。

他们的解法很像人类工程师轮班:

- 第一个会话用一个专门的「初始化 Agent」,写好启动脚本、一个进度文件 `claude-progress.txt`、一个 JSON 格式的功能清单(他们的例子里有两百多条,每条初始都标成未通过),再做一次 git 提交。
- 之后每个会话都是「编码 Agent」,每次只做一个功能,做完要提交 git 并更新进度文件,保证留给下一班的是一个干净的状态。
- 每个会话开头固定做几件事:看当前目录,读 git log 和进度文件,在功能清单里挑优先级最高的未完成项。

两个细节很值得注意。功能清单用 JSON 而不用 Markdown,因为他们发现模型不太会乱改 JSON 文件;提示词里明确写「删除或修改测试是不可接受的」。另外,让模型用浏览器自动化像真实用户一样做端到端测试,效果提升很大。

这篇文章对 harness 设计的启发是:**harness 不只是代码,还包括它给模型准备的环境和约定**。进度文件、功能清单、开工检查清单,这些都是 harness 的一部分。我们给 AgentOps 设计长任务能力时(Day 65、Day 99)会用到这个思路。

## 给 AgentOps 写一个 harness

下面这个 harness 大约 200 行,刻意只用标准库,方便你看清楚每一层在哪。它的设计原则是:核心循环只管「调模型、分发工具调用、决定继续还是停」,其余全部是可替换的接口。

```python
# agentops/runtime/harness.py
"""一个最小的 Agent harness:循环 + 工具层 + 上下文管理 + 权限 + 钩子 + 状态持久化。"""
from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol


# ---------- 数据结构 ----------
@dataclass
class ToolCall:
    id: str
    name: str
    args: dict[str, Any]


@dataclass
class ModelReply:
    text: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    usage: dict[str, int] = field(default_factory=dict)


@dataclass
class RunState:
    run_id: str
    messages: list[dict[str, Any]]
    step: int = 0
    status: str = "running"  # running / waiting_approval / done / failed
    pending: list[dict[str, Any]] = field(default_factory=list)
    cost_tokens: int = 0


# ---------- 扩展点:每一个都是可替换的接口 ----------
class Model(Protocol):
    def complete(self, messages: list[dict], tools: list[dict]) -> ModelReply: ...


class ContextManager(Protocol):
    def prepare(self, messages: list[dict]) -> list[dict]: ...


class StateStore(Protocol):
    def save(self, state: RunState) -> None: ...
    def load(self, run_id: str) -> RunState | None: ...


@dataclass
class Tool:
    name: str
    description: str
    schema: dict
    fn: Callable[..., Any]
    side_effect: bool = False  # 有副作用的工具默认要审批


Decision = str  # "allow" / "deny" / "ask"


class PermissionPolicy(Protocol):
    def check(self, tool: Tool, args: dict, state: RunState) -> Decision: ...


Hook = Callable[[str, dict], None]  # (事件名, 载荷)


# ---------- 默认实现 ----------
class KeepLastN:
    """最简单的上下文策略:system 消息 + 最近 N 条。"""

    def __init__(self, n: int = 40):
        self.n = n

    def prepare(self, messages):
        system = [m for m in messages if m["role"] == "system"]
        rest = [m for m in messages if m["role"] != "system"]
        return system + rest[-self.n:]


class SideEffectNeedsApproval:
    def check(self, tool, args, state):
        return "ask" if tool.side_effect else "allow"


class JsonFileStore:
    def __init__(self, path: str = "runs.json"):
        self.path = path

    def _all(self) -> dict:
        try:
            with open(self.path) as f:
                return json.load(f)
        except FileNotFoundError:
            return {}

    def save(self, state):
        data = self._all()
        data[state.run_id] = state.__dict__
        with open(self.path, "w") as f:
            json.dump(data, f, ensure_ascii=False)

    def load(self, run_id):
        raw = self._all().get(run_id)
        return RunState(**raw) if raw else None


# ---------- 运行时本体 ----------
class Harness:
    def __init__(self, model: Model, tools: list[Tool], *, context: ContextManager | None = None,
                 policy: PermissionPolicy | None = None, store: StateStore | None = None,
                 hooks: list[Hook] | None = None, max_steps: int = 20, token_budget: int = 200_000):
        self.model = model
        self.tools = {t.name: t for t in tools}
        self.context = context or KeepLastN()
        self.policy = policy or SideEffectNeedsApproval()
        self.store = store or JsonFileStore()
        self.hooks = hooks or []
        self.max_steps = max_steps
        self.token_budget = token_budget

    def _emit(self, event: str, payload: dict) -> None:
        for h in self.hooks:
            h(event, payload)

    def _tool_specs(self) -> list[dict]:
        return [{"type": "function", "function": {"name": t.name, "description": t.description,
                 "parameters": t.schema}} for t in self.tools.values()]

    def start(self, system: str, user: str) -> RunState:
        state = RunState(run_id=uuid.uuid4().hex[:8],
                         messages=[{"role": "system", "content": system},
                                   {"role": "user", "content": user}])
        self._emit("run_start", {"run_id": state.run_id})
        return self._loop(state)

    def resume(self, run_id: str, approvals: dict[str, bool]) -> RunState:
        state = self.store.load(run_id)
        if state is None or state.status != "waiting_approval":
            raise ValueError(f"run {run_id} 不在等待审批状态")
        for call in state.pending:
            ok = approvals.get(call["id"], False)
            content = self._execute(call) if ok else "审批被拒绝,不要再尝试这个操作,告诉用户已转人工处理。"
            state.messages.append({"role": "tool", "tool_call_id": call["id"], "content": content})
        state.pending, state.status = [], "running"
        return self._loop(state)

    def _execute(self, call: dict) -> str:
        tool = self.tools[call["name"]]
        self._emit("pre_tool", call)
        t0 = time.perf_counter()
        try:
            out = tool.fn(**call["args"])
            result = json.dumps(out, ensure_ascii=False) if not isinstance(out, str) else out
        except Exception as e:  # 报错原样交给模型,让它自己改
            result = f"工具执行失败:{type(e).__name__}: {e}"
        self._emit("post_tool", {**call, "ms": round((time.perf_counter() - t0) * 1000), "result": result[:200]})
        return result

    def _loop(self, state: RunState) -> RunState:
        while state.step < self.max_steps:
            if state.cost_tokens > self.token_budget:
                state.status = "failed"
                self._emit("budget_exceeded", {"run_id": state.run_id, "tokens": state.cost_tokens})
                break
            state.step += 1
            reply = self.model.complete(self.context.prepare(state.messages), self._tool_specs())
            state.cost_tokens += sum(reply.usage.values())
            state.messages.append({"role": "assistant", "content": reply.text,
                                   "tool_calls": [c.__dict__ for c in reply.tool_calls]})
            if not reply.tool_calls:
                state.status = "done"
                break
            waiting = []
            for c in reply.tool_calls:
                call = c.__dict__
                if c.name not in self.tools:
                    state.messages.append({"role": "tool", "tool_call_id": c.id,
                                           "content": f"没有叫 {c.name} 的工具,可用的有:{list(self.tools)}"})
                    continue
                decision = self.policy.check(self.tools[c.name], c.args, state)
                if decision == "deny":
                    state.messages.append({"role": "tool", "tool_call_id": c.id, "content": "无权限执行该操作。"})
                elif decision == "ask":
                    waiting.append(call)
                else:
                    state.messages.append({"role": "tool", "tool_call_id": c.id, "content": self._execute(call)})
            if waiting:
                state.status, state.pending = "waiting_approval", waiting
                self._emit("approval_needed", {"run_id": state.run_id, "calls": waiting})
                break
            self.store.save(state)
        else:
            state.status = "failed"
            self._emit("max_steps", {"run_id": state.run_id})
        self.store.save(state)
        self._emit("run_end", {"run_id": state.run_id, "status": state.status, "steps": state.step})
        return state
```

几个设计决定值得说一下。

**工具名不存在、权限拒绝、执行报错,都变成一条 tool 消息还给模型**,不抛异常。模型看到「没有叫 X 的工具,可用的有……」通常会自己改正,这比让整个运行失败好得多。Day 12 讲过这个原则,这里把它做进了运行时。

**需要审批时整轮暂停**,把待审批的调用放进 `pending`,状态存盘后返回。同一轮里不需要审批的调用照常执行。恢复时按审批结果逐个处理,拒绝的那条会告诉模型「不要再尝试」,否则模型很可能换个参数再调一次。

**预算检查放在每一步开头**,而不是只看步数。生产环境里真正让你半夜被叫起来的,往往是某个 Agent 陷进循环烧掉了几百块钱,而步数上限 20 步在长上下文下可能已经是几十万 token。

**钩子只读不写**。钩子拿到的是事件和载荷,可以记日志、发 trace、扣费,但不能改变循环的行为。改变行为的事情(拦截、改参数)应该放进权限策略。把这两件事分开,出了问题时你才知道该去哪找。Claude Agent SDK 的 hooks 允许返回决定去影响行为,能力更强,但也更容易让逻辑散落在各处,这是一个可以讨论的取舍。

下面用一个按剧本回复的假模型跑一遍退款场景,不花 API 钱:

```python
# agentops/runtime/demo.py
from harness import Harness, JsonFileStore, ModelReply, Tool, ToolCall


class ScriptedModel:
    """按剧本回复的假模型,用来测试 harness 本身,不花 API 钱。"""

    def __init__(self, script):
        self.script, self.i = script, 0

    def complete(self, messages, tools):
        r = self.script[self.i]
        self.i += 1
        return r


def get_invoices(customer_id: str):
    return [{"id": "INV-2290", "amount": 468}, {"id": "INV-2291", "amount": 468}]


def create_refund(invoice_id: str, amount: int):
    return {"refund_id": "RF-77", "invoice_id": invoice_id, "amount": amount}


tools = [
    Tool("get_invoices", "查询客户最近的发票", {"type": "object", "properties": {"customer_id": {"type": "string"}}}, get_invoices),
    Tool("create_refund", "创建退款申请", {"type": "object", "properties": {"invoice_id": {"type": "string"}, "amount": {"type": "integer"}}}, create_refund, side_effect=True),
]
script = [
    ModelReply("", [ToolCall("c1", "get_invoices", {"customer_id": "C007"})], {"in": 900, "out": 40}),
    ModelReply("", [ToolCall("c2", "create_refund", {"invoice_id": "INV-2291", "amount": 468})], {"in": 1100, "out": 50}),
    ModelReply("多扣的 468 元已提交退款,3 个工作日内到账。", [], {"in": 1300, "out": 60}),
]
log = lambda event, payload: print(f"[{event}]", {k: v for k, v in payload.items() if k != "result"})
h = Harness(ScriptedModel(script), tools, hooks=[log], store=JsonFileStore("runs.json"))
s = h.start("你是 CloudLedger 客服。", "上个月被扣了两次 468,能退吗?")
print("状态:", s.status, "等待:", [c["name"] for c in s.pending])
s = h.resume(s.run_id, {"c2": True})
print("状态:", s.status, "步数:", s.step, "token:", s.cost_tokens)
print("最终回复:", s.messages[-1]["content"])
```

在 `agentops/runtime/` 目录下运行 `python3 demo.py`,输出是这样(run_id 每次不同):

```text
[run_start] {'run_id': '12e6c32a'}
[pre_tool] {'id': 'c1', 'name': 'get_invoices', 'args': {'customer_id': 'C007'}}
[post_tool] {'id': 'c1', 'name': 'get_invoices', 'args': {'customer_id': 'C007'}, 'ms': 0}
[approval_needed] {'run_id': '12e6c32a', 'calls': [{'id': 'c2', 'name': 'create_refund', 'args': {'invoice_id': 'INV-2291', 'amount': 468}}]}
[run_end] {'run_id': '12e6c32a', 'status': 'waiting_approval', 'steps': 2}
状态: waiting_approval 等待: ['create_refund']
[pre_tool] {'id': 'c2', 'name': 'create_refund', 'args': {'invoice_id': 'INV-2291', 'amount': 468}}
[post_tool] {'id': 'c2', 'name': 'create_refund', 'args': {'invoice_id': 'INV-2291', 'amount': 468}, 'ms': 0}
[run_end] {'run_id': '12e6c32a', 'status': 'done', 'steps': 3}
状态: done 步数: 3 token: 3450
最终回复: 多扣的 468 元已提交退款,3 个工作日内到账。
```

这是我在本机实际跑出来的输出。注意 `start` 和 `resume` 是两次独立的调用,中间状态存在 `runs.json` 里。把 `JsonFileStore` 换成 Postgres 实现,就可以让审批在几个小时后、在另一台机器上恢复。

接真模型时,写一个实现了 `complete` 方法的适配器,把基础篇 Day 4 的 `LLMClient` 包一层,把 OpenAI 格式的 `tool_calls` 转成这里的 `ToolCall` 就行。harness 本身一行不用改,这就是扩展点的价值。

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="审批暂停与恢复的时序:start 跑到需要审批的工具时保存状态并返回,几小时后 resume 从存储读回状态继续">
  <rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <line x1="40" y1="60" x2="600" y2="60" stroke="var(--rule)"/>
    <text x="40" y="40" fill="var(--ink)">start()</text>
    <rect x="40" y="48" width="70" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="75" y="64" text-anchor="middle" fill="var(--ink)">模型</text>
    <rect x="120" y="48" width="90" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="165" y="64" text-anchor="middle" fill="var(--ink)">查发票</text>
    <rect x="220" y="48" width="70" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="255" y="64" text-anchor="middle" fill="var(--ink)">模型</text>
    <rect x="300" y="48" width="100" height="24" rx="3" fill="none" stroke="var(--compute)" stroke-dasharray="4 3"/><text x="350" y="64" text-anchor="middle" fill="var(--compute)">退款?暂停</text>
    <rect x="300" y="110" width="100" height="30" rx="4" fill="var(--paper)" stroke="var(--ink-soft)"/><text x="350" y="129" text-anchor="middle" fill="var(--ink)">runs.json</text>
    <line x1="350" y1="72" x2="350" y2="110" stroke="var(--ink-faint)"/>
    <text x="420" y="129" fill="var(--ink-faint)">几小时后,另一台机器</text>
    <line x1="40" y1="180" x2="600" y2="180" stroke="var(--rule)"/>
    <text x="40" y="200" fill="var(--ink)">resume()</text>
    <line x1="350" y1="140" x2="350" y2="168" stroke="var(--ink-faint)"/>
    <rect x="300" y="168" width="100" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="350" y="184" text-anchor="middle" fill="var(--ink)">执行退款</text>
    <rect x="410" y="168" width="70" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="445" y="184" text-anchor="middle" fill="var(--ink)">模型</text>
    <rect x="490" y="168" width="80" height="24" rx="3" fill="var(--paper)" stroke="var(--mem)"/><text x="530" y="184" text-anchor="middle" fill="var(--ink)">回复</text>
  </g>
</svg>
<figcaption>暂停时整个运行状态落盘,进程可以直接退出。恢复不依赖内存里的任何东西,这是平台化的前提。</figcaption>
</figure>

## 扩展点和硬约束

设计 harness 时,最难的不是写代码,是决定哪些东西让用户改,哪些不让。我的划分是这样的:

**应该做成扩展点的**:模型(换供应商、换路由)、上下文策略(不同任务需要不同的压缩方式)、权限策略(每个租户规则不同)、存储(开发用文件,生产用数据库)、钩子(日志、trace、计费各团队自己挂)。

**应该做成硬约束、不让业务方关掉的**:最大步数、token 预算、有副作用工具的审批默认开启、审计日志。理由很简单,这几样一旦被某个团队关掉,出了事故损失的是整个平台的信誉。可以允许调整数值,比如某个团队的预算调高,但不能让它不存在。

还有一类是**约定**:Anthropic 那篇文章里的进度文件、功能清单、开工检查清单。它们不是代码约束,但写进了每个会话的系统提示词里。平台可以提供模板,让长任务类的 Agent 默认带上。

最后说一个今天这个 harness 留下的坑,当作思考题:`KeepLastN` 按条数裁剪消息,有可能把一条 assistant 的 tool_calls 留下、却把对应的 tool 结果裁掉,或者反过来。大多数模型 API 遇到这种不配对的消息会直接报 400。真正的上下文管理要以「一轮」为单位裁剪,这正是明天要讲的内容。

## 动手练习

**第一步:读源码,回答四个问题。** 在 OpenAI Agents SDK 和 LangGraph 里,各找到下面四个问题的答案,记下文件路径和函数名:循环在哪;工具执行抛异常时怎么处理;需要人审批时怎么暂停;暂停的状态存在哪、是什么格式。Claude Agent SDK 只需要在 `types.py` 里找到对应的配置项。

**第二步:跑通上面的 harness。** 把 `harness.py` 和 `demo.py` 放进 `agentops/runtime/`,跑出和上面一样的输出。

**第三步:加两个扩展。** 一是写一个 `AmountPolicy`,退款金额小于 100 直接放行,100 到 1000 要审批,超过 1000 直接拒绝;二是写一个钩子,把每次工具调用的名字、耗时和结果长度追加到 `tool_calls.jsonl`。两者都不能改 `Harness` 类本身。

**第四步:写一个接真模型的适配器。** 用你 Day 4 的 `LLMClient`,实现 `complete(messages, tools) -> ModelReply`,用 DeepSeek 跑一次退款场景。

**验收标准**:四个问题都有文件路径作答;第三步的两个扩展没有修改 `Harness` 类;真模型跑通审批暂停和恢复;能用一段话说清楚你会把哪些东西做成硬约束、为什么。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| harness | 包在模型外面让它能干活的运行时:循环、工具、上下文、权限、钩子、状态 |
| 扩展点 | 运行时里留出来、可以替换实现而不改核心代码的接口 |
| 钩子 hook | 在关键事件发生时被调用的回调,用来记日志、trace、审计 |
| handoff | 一个 Agent 把对话交给另一个 Agent 继续处理 |
| Pregel | LangGraph 运行时的名字,源自 Google 的图计算模型,按「超步」执行节点 |
| checkpoint | 每一步结束时保存的状态快照,用于恢复和回放 |
| 硬约束 | 平台强制的规则,业务方可以调参数但不能关闭 |

## 常见误区

**以为 harness 就是框架的别名。** 框架是你用来搭 harness 的库;harness 是最终跑起来的那套运行时,包括你写的配置、提示词约定和钩子。同一个框架可以搭出完全不同的 harness。

**把所有逻辑都塞进钩子。** 钩子能拦截、能改参数以后,很容易变成第二套业务逻辑,出了问题没人知道是哪个钩子改的。让钩子只读,把会改变行为的逻辑集中到权限策略这类明确的扩展点。

**只限制步数不限制预算。** 长上下文下,20 步可能就是几十万 token。预算是比步数更直接的保险。

**工具报错就让整个运行失败。** 大部分工具错误模型自己能修正,把错误信息还给它就好。只有基础设施故障(比如数据库连不上)才应该让运行失败并重试。

**读源码从第一行读到最后一行。** 带着问题读,用搜索定位。OpenAI Agents SDK 的 `run_internal` 有二十几个文件,全读完没意义。

## 学习资料

### 文档与文章

- [Anthropic《Effective harnesses for long-running agents》](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents):今天的核心阅读,初始化 Agent、进度文件、功能清单这套做法值得照搬。20 分钟。
- [Anthropic《Building agents with the Claude Agent SDK》](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk):讲 Claude Agent SDK 的设计思路,「收集上下文、采取行动、验证结果」那个循环图很清楚。20 分钟。
- [Claude Agent SDK 文档](https://docs.claude.com/en/docs/agent-sdk/overview):配合读 `types.py`,看每个配置项的说明。
- [OpenAI Agents SDK 文档](https://openai.github.io/openai-agents-python/):重点看 Running agents、Handoffs、Guardrails 三页。
- [LangGraph 持久化文档](https://docs.langchain.com/oss/python/langgraph/persistence):checkpoint 和 thread 的概念,和 `pregel/_checkpoint.py` 对照读。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1t55v6DE2v&autoplay=0&high_quality=1" title="Agent和Harness到底是什么?一个动画彻底搞懂!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>轩辕的编程宇宙 · Agent和Harness到底是什么?一个动画彻底搞懂! · 13 分钟,动画讲 harness 的概念,适合读源码之前先建立直觉。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1FPArzkEaH&autoplay=0&high_quality=1" title="基于 Claude Agent SDK 打造 Agent 平台| Agent 平台化 上集|录屏精简版" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Koala聊开源 · 基于 Claude Agent SDK 打造 Agent 平台 · 8 分钟,一个国内团队用 Claude Agent SDK 做平台化的实践,可以看他们把哪些东西做成了平台能力。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/TqC1qOfiVcQ" title="Claude Agent SDK [Full Workshop] — Thariq Shihipar, Anthropic" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · Claude Agent SDK [Full Workshop] — Thariq Shihipar, Anthropic · Anthropic 工程师的完整工作坊。前半小时讲 harness 设计理念,后面是动手部分,可以挑着看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/1a1VXDdIyrk" title="Agent Harness explained in 8min.." loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Caleb Writes Code · Agent Harness explained in 8min.. · 8 分钟的英文概览,播放量很高,讲得直白。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 6 章「RAG and Agents」:Agent 部分讲了工具、规划和失败模式,可以和今天的七层结构对照。
- Martin Kleppmann《Designing Data-Intensive Applications》(O'Reilly,2017),中文版《数据密集型应用系统设计》:不讲 Agent,但第 11 章流处理里关于事件日志和状态重建的思路,和 harness 的状态持久化是一回事。挑那一章读。

### 开源项目与代码

- [openai/openai-agents-python](https://github.com/openai/openai-agents-python) 的 `src/agents/run_internal/`:今天读的重点目录。
- [anthropics/claude-agent-sdk-python](https://github.com/anthropics/claude-agent-sdk-python) 的 `src/claude_agent_sdk/types.py`:看 `ClaudeAgentOptions` 和 `HookEvent`。
- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph) 的 `libs/langgraph/langgraph/pregel/_loop.py`:看 `PregelLoop.tick` 和 `after_tick`。

## 自测

1. harness 由哪几层组成?哪几层适合做成扩展点?

<details><summary>答案</summary>

循环、工具层、上下文管理、权限、钩子、子 Agent、状态持久化。模型、上下文策略、权限策略、存储、钩子适合做成扩展点;循环本身应该尽量薄且稳定。

</details>

2. Claude Agent SDK 的 Python 源码为什么看起来很少?这带来什么取舍?

<details><summary>答案</summary>

它的循环复用了打包的 Claude Code,Python 层主要负责配置和收发消息。好处是直接用上一个成熟的 harness(压缩、文件、bash 等现成);代价是循环本身改不了,依赖外部进程,只能通过配置和钩子改造。

</details>

3. 为什么今天的 harness 在工具名不存在时不抛异常,而是返回一条 tool 消息?

<details><summary>答案</summary>

模型看到明确的错误信息和可用工具列表,通常能自己改正。抛异常会让整个运行失败,浪费前面所有步骤。只有基础设施级的故障才应该让运行失败。

</details>

4. Anthropic 的长任务 harness 为什么用 JSON 而不是 Markdown 写功能清单?

<details><summary>答案</summary>

他们实验发现,模型不太会不恰当地修改或覆盖 JSON 文件,而 Markdown 更容易被改乱。功能清单是跨会话的「真相来源」,必须稳定。

</details>

5. `KeepLastN` 这种按条数裁剪的上下文策略有什么问题?

<details><summary>答案</summary>

可能把 assistant 的 tool_calls 和对应的 tool 结果拆开,留下不配对的消息,很多模型 API 会直接报 400。应该以完整的一轮(assistant 消息加它所有的 tool 结果)为单位裁剪。

</details>

6. 资深面试题:「你要给公司做一个 Agent 运行时,供五个业务团队使用。哪些东西你会做成硬约束,哪些开放给业务方?为什么?」

<details><summary>答案</summary>

要点:硬约束包括最大步数、token 预算、有副作用工具默认审批、审计日志,可以调数值但不能关,因为任何一个团队出事都会伤到整个平台的信任;开放的包括模型选择(在白名单内)、上下文策略、权限规则细节、钩子、存储后端。还要提到演进:先从最小约束集开始,每次事故复盘后评估是否新增约束,并且约束的变更要有评审。答题时最好举一个具体的事故例子说明为什么需要预算上限。

</details>

## 明天预告

Day 63 · 上下文工程进阶:长任务里的压缩、外部记忆和缓存命中。今天留下的那个裁剪坑明天解决。我们会看上下文腐烂的实证、Manus 怎么围绕 KV 缓存命中率设计上下文、分层压缩怎么做,还会设计一个实验,在自己的任务上比较几种上下文策略的成功率和成本。
