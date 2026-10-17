---
title: 'Day 12 · Agent 的失败模式:死循环、乱调工具、参数错误怎么治'
description: '把 Agent 在生产里会遇到的失败分成三层九类,逐类给出代码层面的治法:重试与指数退避、超时、结果截断、步数和 token 预算、循环检测、撞线后的优雅收尾与转人工。最后用一个假模型写离线测试,不花一分钱验证这些防线。'
pubDate: 2026-10-12
regime: none
tags: ['reliability', 'retry', 'failure-modes', 'testing', 'agent-60']
series: 'agent-60'
day: 12
lang: 'zh'
---

## 今天要解决的问题

Day 9 的 Agent 在演示里表现很好,但把它放到线上跑一千次,你会看到各种奇怪的事情。模型服务凌晨返回一串 429。天气接口卡住 40 秒不返回。模型把同一个查询连发五遍,每次结果都一样,它还在查。工具返回了 6 万字符,下一轮请求直接超出上下文窗口。模型调用了一个叫 `search_web` 的工具,可你从来没定义过它。

这些不是小概率事件。Agent 是一个由不可靠组件(模型输出有随机性、网络会抖、外部服务会挂)串起来的循环,循环的每一圈都在放大失败概率。假设单步成功率 98%,十步全成功的概率是 0.98 的 10 次方,大约 82%。每五次就有一次会在某一步出问题。

今天的目标是让 Agent 在出问题时**体面地失败**,而不是崩溃、卡死或者烧钱。学完你应该能:

1. 把 Agent 的失败分成基础设施、模型行为、任务层面三层,说出每一层的典型症状。
2. 给模型调用加上带抖动的指数退避重试,并知道哪些错误该重试、哪些不该。
3. 给工具加上超时和结果截断,给整个任务加上步数、token、时间三种预算。
4. 实现循环检测,以及撞上限后「禁用工具、给出部分答案、标记转人工」的收尾。
5. 用假模型写离线单元测试,验证每一道防线确实生效。

预计用时 4–5 小时。前置是 Day 9 的 `agent_loop.py` 和 Day 11 的报错设计思路。

## 失败的三层九类

我把常见的失败按「出在哪一层」分成三层。分层的意义在于每层的治法不同:基础设施层靠传统工程手段,模型行为层靠反馈和约束,任务层靠预算和兜底。

| 层 | 失败类型 | 典型症状 | 主要治法 |
| --- | --- | --- | --- |
| 基础设施 | 模型 API 临时错误 | 429 限流、500/503、连接超时 | 指数退避重试 |
| 基础设施 | 工具卡住 | 外部 API 几十秒不返回 | 工具超时 |
| 基础设施 | 工具抛异常 | 网络错误、数据不存在 | 异常转成报错信息交给模型 |
| 模型行为 | 参数格式错误 | arguments 不是合法 JSON、缺必填字段 | 解析失败回传让模型重写 |
| 模型行为 | 幻觉工具 | 调用不存在的工具名 | 回传可用工具列表 |
| 模型行为 | 重复调用 | 同样的调用、同样的结果,反复发 | 循环检测 |
| 任务 | 结果过长 | 单次返回撑爆上下文 | 截断加提示 |
| 任务 | 停不下来 | 步数一直涨,目标没进展 | 步数、token、时间预算 |
| 任务 | 做不完 | 撞到上限时只有半成品 | 优雅收尾、部分答案、转人工 |

第二层里的前两类,Day 9 的注册表已经处理了:参数解析失败和工具名不存在都会变成报错信息交还给模型。今天补齐剩下的。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="Agent 循环上的防线位置示意">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
  <rect x="40" y="40" width="150" height="50" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="115" y="70" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">调用模型</text>
  <rect x="245" y="40" width="150" height="50" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="320" y="70" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">执行工具</text>
  <rect x="450" y="40" width="150" height="50" fill="none" stroke="var(--ink-soft)" rx="4"/>
  <text x="525" y="70" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">结果回到上下文</text>
  <line x1="190" y1="65" x2="245" y2="65" stroke="var(--ink-soft)"/>
  <line x1="395" y1="65" x2="450" y2="65" stroke="var(--ink-soft)"/>
  <path d="M525 90 Q525 120 320 120 Q115 120 115 90" fill="none" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
  <text x="115" y="155" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">① 退避重试</text>
  <text x="115" y="173" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">429 / 5xx / 断连</text>
  <text x="320" y="155" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">② 超时 ③ 异常转报错</text>
  <text x="320" y="173" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">④ 循环检测</text>
  <text x="525" y="155" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">⑤ 结果截断</text>
  <rect x="40" y="200" width="560" height="70" fill="none" stroke="var(--ink)" stroke-dasharray="6 4" rx="4"/>
  <text x="320" y="225" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">⑥ 任务级预算:步数 / token / 墙钟时间</text>
  <text x="320" y="250" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">撞线 → 禁用工具、给部分答案、needs_human=True</text>
</svg>
<figcaption>六道防线分别装在循环的哪个位置。前五道处理单步失败,最外面的虚线框处理整个任务的失控。</figcaption>
</figure>

## 重试:哪些错误该重试,怎么等

先说模型 API 的临时错误。最常见的是 429(触发了限流)和 5xx(服务端临时故障),还有网络层面的连接失败、读超时。这几类错误的共同点是「过一会儿再试大概率会好」,所以该重试。

另一类错误重试没用:400(请求本身有问题,比如消息顺序不对)、401(key 错了)、403(没权限)、404(模型名写错了)。对这类错误重试,只会让你的日志里多几行一样的报错,还可能触发更严格的限流。**只重试临时错误**,这是第一条规矩。

第二条规矩是重试要**等**,而且等的时间要**指数增长加随机抖动**。指数增长(1 秒、2 秒、4 秒、8 秒)是因为服务过载时,你越快重试,它越难恢复。随机抖动是为了避免「惊群」:如果一千个客户端都在同一秒失败、都等 1 秒后重试,它们会在同一秒再次把服务打挂。AWS 的 Builders' Library 里有篇讲超时、重试和抖动的经典文章,把这个道理讲得很透,推荐读。

Python 里最省事的是 `tenacity` 库,一个装饰器搞定。有个细节要注意:OpenAI 的 Python SDK 自己就带重试,默认 `max_retries=2`,对连接错误、429、5xx 等会自动重试。如果你在外面再套一层 tenacity,就会出现「外层重试 4 次、每次内层又重试 2 次」的叠加,最坏情况下一个请求被发了十几次。我的做法是把 SDK 的 `max_retries` 设成 0,统一由外层控制,行为更可预测。SDK 的默认超时也很长(10 分钟),Agent 场景里我会设成 60 秒。

## 工具超时与结果截断

外部服务卡住是 Agent 线上最常见的「无声故障」之一:没有报错,就是不返回,用户那边一直转圈。给每个工具调用加超时是必须的。

实现上有两种思路。一是在工具内部的 HTTP 调用上设超时,比如 Day 8 的 `httpx.get(..., timeout=10)`,这是最好的,应该始终这么做。二是在 Agent 循环这一层再套一个总超时,兜住那些你控制不了的工具(第三方库、写得不规范的同事的代码)。下面的代码用线程池实现第二层:把工具提交到线程池,`future.result(timeout=15)` 等不到就返回一条超时报错。

拆开看一下这几行。`self.pool = ThreadPoolExecutor(max_workers=4)` 在 `__init__` 里建一个最多 4 个工作线程的线程池,挂在实例上。`_run_tool` 里 `self.pool.submit(...)` 把工具丢进池子执行,立刻拿回一个 `future`(类似 JS 的 Promise);`future.result(timeout=15)` 让主线程最多等 15 秒,等不到就抛 `TimeoutError`(代码里改名叫 `ToolTimeout`),我们接住它、返回一段报错给模型。用 JS 类比,就是 `Promise.race([callTool(), sleep(15000).then(() => { throw "timeout" })])`。注意这里的线程池**主要是为了能加超时,不是为了并发**:如果直接调 `self.registry.call(...)`,工具卡住整个 Agent 就跟着卡死;交给线程池以后,主线程手里只有一个能设等待上限的 `future`。

要知道这种做法的局限:Python 线程没法被强制杀死,超时后那个线程其实还在后台跑,只是我们不等它了。对于会产生副作用的工具(写数据库、发邮件),超时后它可能仍然执行成功,而模型以为失败了又重试一次,于是邮件发了两封。这就是为什么写操作类工具需要**幂等**设计,Day 37 会专门讲。

这也解释了 `max_workers` 为什么给 4 而不是 1:卡住的线程会一直占着一个名额。只有 1 个线程的话,一次卡死后面所有工具调用都得排队。留 4 个,偶尔卡住一两个,后面的调用还有空闲线程可用;就算 4 个全卡住,新任务排队的时间也算在 15 秒里,照样会超时返回,Agent 不会永远停住。

结果截断在 Day 11 讲过设计原则,今天在循环层面加一道统一的保险:不管工具本身写得多好,单个结果超过 4000 字符就截断,并附上一句说明。工具层面的分页是主要防线,循环层面的截断是兜底。

## 循环检测:同样的事别做第三遍

模型陷入循环的典型样子是:调用 `search("退款政策")`,拿到结果,没找到想要的,又调用 `search("退款政策")`,拿到一模一样的结果,再调一次。它不是傻,通常是因为结果里确实没有答案,而它又没有别的思路,只好原地打转。

最简单有效的检测办法是给每次调用算一个指纹(工具名加参数的哈希),计数。同一个指纹第三次出现时,不再真的执行,而是返回一句「这个调用和之前完全一样,结果不会变,请换种做法或直接回答」。大多数时候,模型看到这句话就会跳出来。如果它还坚持,第四次就强制收尾。

这种检测有漏网之鱼:模型每次换一个字,`search("退款政策")`、`search("退款 政策")`、`search("退款的政策")`,指纹都不同。更复杂的检测可以看语义相似度,或者看「最近 N 步有没有新信息进入上下文」。不过实践中,完全相同的重复已经覆盖了大部分情况,剩下的交给步数和 token 预算兜底就行。

## 预算与优雅收尾

最外层的防线是三种预算。步数限制模型调用次数;token 限制总花费,这个比步数更直接,因为步数相同的两个任务,花费可能差十倍;墙钟时间限制用户的等待,对同步接口尤其重要,用户不会等三分钟。

撞到任何一条线时怎么办,是这一天里我最想让你记住的设计。最差的做法是直接抛异常或者返回「任务失败」,前面九步花的钱和拿到的信息全浪费了。好一点的做法是:**追加一条系统提示,禁用工具(`tool_choice="none"`),让模型根据已经拿到的信息给出部分答案,并说明哪些没完成**。然后在返回结果上打一个 `needs_human=True` 的标记,让上游系统决定是转人工、提示用户换个问法,还是放进后台队列慢慢跑。

在客服场景里,这个标记直接对应「转人工」按钮。毕业项目 SupportPilot 里,所有撞线的工单都会进入人工队列,并且带着 Agent 已经查到的信息,人工客服不用从头查起。

## 完整实现

把上面所有防线加到 Day 9 的循环上,得到 `RobustAgent`。工具注册表直接复用 Day 9 的 `ToolRegistry`。

> 忘了 `ToolRegistry` 是干什么的?一句话:它是**工具登记处**,只管两件事。一是**登记**:`@reg.tool` 读函数名、参数类型和 docstring,自动生成模型看得懂的 JSON schema,放在 `reg.schemas` 里,调模型时作为 `tools=` 传进去。二是**执行**:模型回来的只是工具名和参数 JSON 字符串,`reg.call(name, arguments)` 负责找到函数、解析参数、调用、把结果转回字符串。出错时它不抛异常,而是返回 `{"error": ...}` 给模型看,让模型自己改正。分工是 Agent 管循环,ToolRegistry 管工具。今天的 `RobustAgent` 只换掉循环那一半,工具那一半原样复用。详见 [Day 9](/blog/agent-60/day-09-agent-loop-from-scratch/)。

先装重试库:在 `agent-60-lab` 根目录执行 `uv add tenacity`(pytest 在 Day 4 已经装过)。和 Day 9 一样,所有命令都在**仓库根目录**跑,所以导入写成 `from w2.agent_loop import ...`,不要写 `from agent_loop import ...`,否则会报 `ModuleNotFoundError`。

```python
# agent-60-lab/w2/robust_agent.py
import hashlib
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as ToolTimeout
from dataclasses import dataclass, field
from typing import Any

import openai
from openai import OpenAI
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential_jitter

from w2.agent_loop import ToolRegistry

RETRYABLE = (openai.APIConnectionError, openai.APITimeoutError, openai.RateLimitError, openai.InternalServerError)


@dataclass
class Limits:
    max_steps: int = 12          # 最多调几次模型
    max_tokens: int = 60_000     # 输入+输出 token 总预算
    max_seconds: float = 120     # 整个任务的墙钟时间
    tool_timeout: float = 15     # 单个工具最长执行时间
    max_tool_chars: int = 4_000  # 单个工具结果最多放进上下文多少字符
    max_repeats: int = 2         # 完全相同的调用最多允许几次


@dataclass
class AgentResult:
    answer: str
    status: str                  # ok / max_steps / budget / timeout / loop / llm_error
    steps: int
    usage: dict = field(default_factory=dict)
    needs_human: bool = False


class RobustAgent:
    def __init__(self, registry: ToolRegistry, system: str, limits: Limits | None = None, client: Any = None):
        # SDK 自带 max_retries=2;这里设为 0,统一交给下面的 tenacity,避免两层重试叠加
        self.client = client or OpenAI(
            base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"], timeout=60, max_retries=0
        )
        self.model = os.environ.get("LLM_MODEL", "fake")
        self.registry = registry
        self.limits = limits or Limits()
        self.messages: list[Any] = [{"role": "system", "content": system}]  # 写 list[dict] 传给 SDK 会报类型红线
        self.usage = {"prompt_tokens": 0, "completion_tokens": 0}
        self.seen: dict[str, int] = {}
        self.pool = ThreadPoolExecutor(max_workers=4)

    @retry(
        retry=retry_if_exception_type(RETRYABLE),
        wait=wait_exponential_jitter(initial=1, max=20),  # 1s、2s、4s… 加随机抖动
        stop=stop_after_attempt(4),
        reraise=True,
    )
    def _llm(self, **kwargs):
        return self.client.chat.completions.create(model=self.model, messages=self.messages, **kwargs)

    def _run_tool(self, name: str, arguments: str) -> str:
        future = self.pool.submit(self.registry.call, name, arguments)
        try:
            out = future.result(timeout=self.limits.tool_timeout)
        except ToolTimeout:
            return json.dumps({"error": f"工具 {name} 超过 {self.limits.tool_timeout} 秒没有返回。可以换个参数重试,或者告诉用户暂时查不到。"}, ensure_ascii=False)
        if len(out) > self.limits.max_tool_chars:
            cut = self.limits.max_tool_chars
            out = out[:cut] + f"\n…[结果过长,已截断:共 {len(out)} 字符,只显示前 {cut}。需要的话请用更精确的参数重新查询]"
        return out

    def _is_loop(self, name: str, arguments: str) -> bool:
        key = hashlib.md5(f"{name}:{arguments}".encode()).hexdigest()
        self.seen[key] = self.seen.get(key, 0) + 1
        return self.seen[key] > self.limits.max_repeats

    def _wrap_up(self, status: str, step: int, reason: str) -> AgentResult:
        """撞到上限时,不让工作白做:禁用工具,让模型基于已有信息给出部分答案。"""
        self.messages.append({"role": "user", "content": f"(系统提示:{reason}。不要再调用工具,根据目前已经拿到的信息给出你能给的最好回答,并明确说明哪些部分没有完成。)"})
        try:
            msg = self._llm(tools=self.registry.schemas, tool_choice="none").choices[0].message
            answer = msg.content or ""
        except Exception as e:  # 收尾也失败了,只能给固定文案
            answer = f"抱歉,这个问题暂时没能处理完({type(e).__name__}),已转给人工同事跟进。"
        return AgentResult(answer, status, step, dict(self.usage), needs_human=True)

    def run(self, user_input: str) -> AgentResult:
        self.messages.append({"role": "user", "content": user_input})
        start = time.monotonic()
        for step in range(1, self.limits.max_steps + 1):
            if time.monotonic() - start > self.limits.max_seconds:
                return self._wrap_up("timeout", step, "任务耗时超过上限")
            if sum(self.usage.values()) > self.limits.max_tokens:
                return self._wrap_up("budget", step, "token 预算已用完")
            try:
                resp = self._llm(tools=self.registry.schemas)
            except RETRYABLE as e:
                return AgentResult(f"模型服务暂时不可用({type(e).__name__}),请稍后再试。", "llm_error", step, dict(self.usage), True)
            msg = resp.choices[0].message
            if resp.usage:
                self.usage["prompt_tokens"] += resp.usage.prompt_tokens
                self.usage["completion_tokens"] += resp.usage.completion_tokens
            self.messages.append(self._assistant_dict(msg))
            if not msg.tool_calls:
                return AgentResult(msg.content or "", "ok", step, dict(self.usage))

            looping = False
            for tc in msg.tool_calls:
                if tc.type != "function":  # 和 Day 8 一样先收窄类型,下面才能用 tc.function
                    continue
                if self._is_loop(tc.function.name, tc.function.arguments):
                    looping = True
                    out = json.dumps({"error": "这个调用和之前完全一样,结果不会变。请换一种做法,或者直接根据已有信息回答。"}, ensure_ascii=False)
                else:
                    out = self._run_tool(tc.function.name, tc.function.arguments)
                self.messages.append({"role": "tool", "tool_call_id": tc.id, "content": out})
            if looping and max(self.seen.values()) > self.limits.max_repeats + 1:
                return self._wrap_up("loop", step, "检测到重复调用,任务可能陷入循环")
        return self._wrap_up("max_steps", self.limits.max_steps, "已达到最大步数")

    @staticmethod
    def _assistant_dict(msg) -> dict:
        d: dict[str, Any] = {"role": "assistant", "content": msg.content}
        if msg.tool_calls:
            d["tool_calls"] = [tc.model_dump() for tc in msg.tool_calls]
        reasoning = getattr(msg, "reasoning_content", None)
        if reasoning:
            d["reasoning_content"] = reasoning
        return d
```

几个设计点再说一下。

返回值从字符串变成了 `AgentResult`,带上状态、步数、用量和 `needs_human`。调用方拿到结果就知道这次是正常完成还是撞线收尾,该怎么处理。这是从「脚本」走向「服务」的一小步,Day 36 把它做成 API 时会直接用上。

`_wrap_up` 自己也包了 try。收尾的那次模型调用也可能失败(比如正是因为模型服务挂了才撞的线),这时只能给一段固定文案。**兜底逻辑本身要有兜底**,不然最后一道防线一破,用户看到的就是一个 500。

`Limits` 用 dataclass 集中管理所有阈值。这些数字没有标准答案,取决于你的任务、模型和用户能接受的等待。我给的默认值适合「客服问答」这类中等复杂度的任务。上线以后,你应该看真实数据里步数和 token 的分布,把上限设在 P99 稍上方。

## 用假模型写离线测试

到这里有个现实问题:这些防线怎么测?你总不能等模型哪天真的陷入循环。而且每测一次都调真模型,既花钱,结果还不稳定。

办法是**写一个假模型**。它和 OpenAI 客户端长得一样(有 `chat.completions.create` 方法),但按你写好的剧本依次返回响应,剧本里放一个异常它就抛异常。这样你就能精确地构造「连续四次同样调用」「前两次 429 第三次成功」这类场景,测试跑起来零成本、结果完全确定。

```python
# agent-60-lab/w2/test_robust_agent.py  用一个「假模型」离线测试失败处理,不花一分钱
import json
import time
from types import SimpleNamespace

import httpx2  # openai 3.x 内部用的是 httpx2,构造错误响应要用同一个包,否则类型检查报红
import openai

from w2.agent_loop import ToolRegistry
from w2.robust_agent import Limits, RobustAgent


def tool_call(name, args, i=0):
    fn = SimpleNamespace(name=name, arguments=json.dumps(args, ensure_ascii=False))
    tc = SimpleNamespace(id=f"call_{i}", type="function", function=fn)
    tc.model_dump = lambda: {"id": tc.id, "type": "function", "function": {"name": name, "arguments": fn.arguments}}
    return tc


def reply(content=None, calls=None):
    msg = SimpleNamespace(content=content, tool_calls=calls)
    return SimpleNamespace(choices=[SimpleNamespace(message=msg)], usage=SimpleNamespace(prompt_tokens=100, completion_tokens=20))


class FakeClient:
    """按剧本依次返回响应;剧本里放异常就抛出异常。"""

    def __init__(self, script):
        self.script, self.calls = list(script), []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


reg = ToolRegistry()


@reg.tool
def slow(x: str) -> dict:
    """一个很慢的工具"""
    time.sleep(2)
    return {"x": x}


@reg.tool
def big(x: str) -> dict:
    """返回超大结果的工具"""
    return {"data": "很长" * 5000}


def test_loop_detected_and_wrapped_up():
    same = lambda i: reply(calls=[tool_call("big", {"x": "a"}, i)])
    client = FakeClient([same(0), same(1), same(2), same(3), reply("根据已有信息,部分完成。")])
    r = RobustAgent(reg, "sys", Limits(max_repeats=2), client=client).run("hi")
    assert r.status == "loop" and r.needs_human
    assert client.calls[-1]["tool_choice"] == "none"  # 收尾时禁止再调工具


def test_tool_timeout_becomes_error_message():
    client = FakeClient([reply(calls=[tool_call("slow", {"x": "a"})]), reply("好的")])
    agent = RobustAgent(reg, "sys", Limits(tool_timeout=0.5), client=client)
    r = agent.run("hi")
    tool_msg = [m for m in agent.messages if m["role"] == "tool"][0]
    assert "超过 0.5 秒" in tool_msg["content"] and r.status == "ok"


def test_big_result_truncated():
    client = FakeClient([reply(calls=[tool_call("big", {"x": "a"})]), reply("好的")])
    agent = RobustAgent(reg, "sys", Limits(max_tool_chars=500), client=client)
    agent.run("hi")
    tool_msg = [m for m in agent.messages if m["role"] == "tool"][0]
    assert len(tool_msg["content"]) < 600 and "已截断" in tool_msg["content"]


def test_rate_limit_is_retried():
    req = httpx2.Request("POST", "https://x.invalid/v1/chat/completions")
    err = openai.RateLimitError("429", response=httpx2.Response(429, request=req), body=None)
    client = FakeClient([err, err, reply("第三次成功")])
    r = RobustAgent(reg, "sys", client=client).run("hi")
    assert r.status == "ok" and len(client.calls) == 3


def test_budget_stops_agent():
    loop = [reply(calls=[tool_call("big", {"x": str(i)}, i)]) for i in range(10)]
    client = FakeClient(loop + [reply("预算用完,先给部分结果")])
    r = RobustAgent(reg, "sys", Limits(max_tokens=300), client=client).run("hi")
    assert r.status == "budget" and r.needs_human
```

这五个测试我在本机实际跑过,在仓库根目录执行 `uv run pytest -q w2/test_robust_agent.py`,结果是 `5 passed`,用时 5 到 9 秒。慢主要是因为 429 那个测试里 tenacity 真的在退避等待,以及超时测试里那个工具真的睡了 2 秒。如果嫌慢,可以在测试里把等待策略换成 `wait_none()`,tenacity 支持在运行时替换。

这个「假模型」技巧在后面会反复用到。W5 讲评测时,规则类的检查(工具有没有按顺序调、撞线后有没有转人工)都可以这样离线测;只有「回答质量好不好」这类问题才需要真模型和 LLM 评分。把能确定性测试的部分剥离出来,是 Agent 工程化最实用的一招。

## 失败了要留下什么

最后说一下日志。Agent 失败后你要能回答三个问题:它在第几步、因为什么撞的线;撞线前它调了哪些工具、拿到了什么;最后给用户的回答是什么。所以每次运行至少要把完整的 `messages` 列表、`AgentResult` 和每步耗时存下来。

现在先存成 JSON 文件就够了,一次运行一个文件,文件名带上时间和状态,出问题时按状态筛选着看。W5 会接入 Langfuse 这类 tracing 工具,在网页上逐步回放每一次运行。到那时你会发现,**读失败的轨迹**是改进 Agent 最有效的方法,比读任何论文都管用。Hamel Husain 把这件事叫做错误分析(error analysis),是 Day 30 的主题。

## 动手练习

下面四个练习的代码我都在 `agent-60-lab` 里实际跑过(DeepSeek `deepseek-flash`,2026-10-16),每段后面写了你应该看到的结果。所有命令都在仓库根目录执行。

### 练习 1:跑通测试,再故意改坏

把上面的 `robust_agent.py` 和 `test_robust_agent.py` 放进 `agent-60-lab/w2/`,然后:

```bash
uv add tenacity
uv run pytest -q w2/test_robust_agent.py
# .....                                   [100%]
# 5 passed in 5.32s
```

现在故意把 `_is_loop` 里的 `>` 改成 `>=`:

```python
        return self.seen[key] >= self.limits.max_repeats   # 原来是 >
```

再跑一遍。你会发现**还是 5 个全过**。这才是这个练习要你看到的东西:代码已经有 bug 了(`max_repeats=2` 的意思是「同样的调用允许做 2 次」,改成 `>=` 以后第 2 次就被当成循环拦下了),但现有的测试没有一个覆盖到「第 2 次应该照常执行」这个边界,所以抓不住它。

补一个专门测边界的用例,加在 `test_robust_agent.py` 末尾:

```python
def test_second_identical_call_still_runs():
    """max_repeats=2 表示同样的调用允许做 2 次,第 2 次必须真的执行,不能被当成循环拦下。"""
    same = lambda i: reply(calls=[tool_call("big", {"x": "a"}, i)])
    client = FakeClient([same(0), same(1), reply("好的")])
    agent = RobustAgent(reg, "sys", Limits(max_repeats=2), client=client)
    r = agent.run("hi")
    tool_msgs = [m["content"] for m in agent.messages if m["role"] == "tool"]
    assert len(tool_msgs) == 2
    assert all("完全一样" not in c for c in tool_msgs)  # 两次都是真结果,不是循环警告
    assert r.status == "ok"
```

`>=` 的版本下它会失败:

```text
FAILED w2/test_robust_agent.py::test_second_identical_call_still_runs - asser...
1 failed, 5 passed
```

把 `>=` 改回 `>`,6 个全过。记住这个套路:**改一个比较符号测试还全绿,说明测试漏了边界**。写阈值类的逻辑时,恰好等于阈值的那一次一定要单独测。

### 练习 2:坏掉的 JSON 和不存在的工具

模型偶尔会吐出半截 JSON,或者调用一个根本没注册的工具。Day 9 的 `ToolRegistry.call` 已经把这两种情况变成了错误消息,这两个测试确认它们真的会回到模型那里,而不是让程序崩掉。同样加在 `test_robust_agent.py` 末尾:

```python
def test_broken_json_arguments():
    fn = SimpleNamespace(name="big", arguments='{"x": ')  # 模型吐出来的半截 JSON
    tc = SimpleNamespace(id="call_0", type="function", function=fn)
    tc.model_dump = lambda: {"id": "call_0", "type": "function", "function": {"name": "big", "arguments": fn.arguments}}
    client = FakeClient([reply(calls=[tc]), reply("参数写错了,我换个方式回答。")])
    agent = RobustAgent(reg, "sys", client=client)
    r = agent.run("hi")
    tool_msg = [m for m in agent.messages if m["role"] == "tool"][0]
    assert "JSONDecodeError" in tool_msg["content"]  # 错误原样告诉模型
    assert r.status == "ok"


def test_unknown_tool_lists_available_ones():
    client = FakeClient([reply(calls=[tool_call("search_web", {"q": "退款"})]), reply("我没有搜索工具。")])
    agent = RobustAgent(reg, "sys", client=client)
    r = agent.run("hi")
    tool_msg = [m for m in agent.messages if m["role"] == "tool"][0]
    assert "search_web" in tool_msg["content"]
    assert "slow" in tool_msg["content"] and "big" in tool_msg["content"]  # 列出了可用工具
    assert r.status == "ok"
```

这里不能用 `tool_call()` 辅助函数造坏 JSON,因为它内部会 `json.dumps`,永远是合法的 JSON;所以手工拼了一个 `arguments` 是半截字符串的调用。跑一遍应该是 `8 passed`。

### 练习 3:接上真模型,看撞线时的部分答案

新建 `w2/day12_real.py`,直接复用 Day 9 `day09_demo.py` 里注册好的三个工具(导入它时会顺带执行 `load_dotenv()`,所以 `.env` 里的 key 能读到;它的 `if __name__ == "__main__":` 部分不会执行):

```python
# agent-60-lab/w2/day12_real.py  练习 3:真模型撞线,看收尾给出的部分答案
from w2.day09_demo import reg  # 复用 Day 9 的三个工具:天气、计算器、读文件
from w2.robust_agent import Limits, RobustAgent

SYSTEM = "你是一个做事很仔细的中文助手。需要外部信息时调用工具;算术一律用 calculate。"
QUESTION = "读一下 cities.txt,查这几个城市现在的气温,算出平均气温,再告诉我最冷和最热的各是哪个、温差多少。"

for limits in (Limits(max_steps=3), Limits(max_tokens=2000)):
    agent = RobustAgent(reg, SYSTEM, limits)
    r = agent.run(QUESTION)
    print(f"\n=== {limits} ===")
    print(f"status={r.status} steps={r.steps} needs_human={r.needs_human} usage={r.usage}")
    print("回答:", r.answer)
```

`workspace/cities.txt` 是 Day 9 跑 demo 时生成的;如果没有,先跑一次 `uv run python -m w2.day09_demo`。然后:

```bash
uv run python -m w2.day12_real
```

我这里的结果(只摘状态行):

```text
=== Limits(max_steps=3, ...) ===
status=max_steps steps=3 needs_human=True usage={'prompt_tokens': 2157, 'completion_tokens': 293}
回答: 三家城市的气温都拿到了(杭州第一次超时,重试后成功),结果如下: ……
=== Limits(max_steps=12, max_tokens=2000, ...) ===
status=budget steps=4 needs_human=True usage={'prompt_tokens': 2159, 'completion_tokens': 300}
回答: ## 目前能给出的结果 ……
```

两条撞线分支都走到了 `_wrap_up`:状态分别是 `max_steps` 和 `budget`,`needs_human` 都是 `True`,而回答是有内容的部分结果(气温表、平均值、还差什么),不是空字符串也不是异常。两点说明:

- `deepseek-flash` 在收尾时接受 `tool_choice="none"`。Day 8 说过思考模式下**强制调用某个工具**会报 400,但「禁止调工具」不受影响。如果你换的模型在这一步报错,`_wrap_up` 里的 try 会兜住,返回固定文案。
- 打印出来的 `usage` 不含收尾那一次调用的 token,因为 `_wrap_up` 没往 `self.usage` 里加。想算准的话,在 `_wrap_up` 里也累加一次 `resp.usage`。

### 练习 4:每次运行留一份日志

在 `robust_agent.py` 里做三处改动。

第一处,文件顶部加两个导入:

```python
from datetime import datetime
from pathlib import Path
```

第二处,把原来的 `def run(self, user_input: str) -> AgentResult:` 改名为 `def _run(...)`,函数体一个字都不用动。

第三处,在类里加一个新的 `run` 和一个 `_save`(放在 `_assistant_dict` 前面就行):

```python
    def run(self, user_input: str) -> AgentResult:
        t0 = time.monotonic()
        result = self._run(user_input)
        self._save(result, time.monotonic() - t0)
        return result

    def _save(self, r: AgentResult, seconds: float) -> None:
        """一次运行一个文件:runs/20261016-170102-123456_max_steps.json"""
        Path("runs").mkdir(exist_ok=True)
        name = f"{datetime.now():%Y%m%d-%H%M%S-%f}_{r.status}.json"
        record = {
            "status": r.status,
            "steps": r.steps,
            "needs_human": r.needs_human,
            "seconds": round(seconds, 2),
            "usage": r.usage,
            "answer": r.answer,
            "messages": self.messages,  # 完整轨迹:出问题时就靠它回放
        }
        Path("runs", name).write_text(json.dumps(record, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
```

这样所有调用方(包括测试)都不用改,`run` 照旧返回 `AgentResult`,只是多了一个副作用。也正因为多了副作用,测试跑起来会往仓库里写 `runs/`。在 `test_robust_agent.py` 的 `reg = ToolRegistry()` 上面加一个自动生效的 fixture,让每个测试都在临时目录里跑(`import pytest` 放到文件顶部,和其他 import 放在一起,否则 Ruff 会提示 import 不在顶部):

```python
import pytest


@pytest.fixture(autouse=True)
def _run_in_tmp(tmp_path, monkeypatch):
    """run() 会写 runs/;测试时切到临时目录,不弄脏仓库。"""
    monkeypatch.chdir(tmp_path)
```

再把 `runs/` 加进 `.gitignore`,日志里有完整对话,不该进仓库。

然后新建 `w2/day12_runs.py`,一口气跑 10 个问题:

```python
# agent-60-lab/w2/day12_runs.py  练习 4:跑 10 个问题,每次运行都会在 runs/ 留一份日志
from w2.day09_demo import reg
from w2.robust_agent import Limits, RobustAgent

SYSTEM = "你是一个做事很仔细的中文助手。需要外部信息时调用工具;算术一律用 calculate。"
QUESTIONS = [
    "北京现在多少度?",
    "(37.5 - 12) * 4 等于多少?",
    "读一下 cities.txt,告诉我要去几个城市。",
    "上海和广州现在哪个更热?热多少?",
    "读一下 cities.txt,查这几个城市现在的气温,算平均值,再说最冷和最热的温差。",
    "读一下 notes.txt。",  # 不存在的文件
    "东京、首尔、曼谷、新加坡、悉尼现在的气温,从高到低排个序。",
    "1 到 100 的平方和是多少?",
    "哈尔滨现在冷不冷?适合穿什么?",
    "把杭州、成都、哈尔滨的气温都换成华氏度。",
]

for q in QUESTIONS:
    r = RobustAgent(reg, SYSTEM, Limits(max_steps=2, max_tokens=6000)).run(q)
    print(f"[{r.status:9}] steps={r.steps} {q}")
```

```bash
uv run python -m w2.day12_runs
ls runs | cut -d_ -f2- | sed 's/\.json$//' | sort | uniq -c
#    5 max_steps
#    5 ok
```

统计命令为什么这样写:文件名是 `时间戳_状态.json`,而状态本身也可能带下划线(`max_steps`、`llm_error`)。`cut -d_ -f2-` 取第一个下划线之后的全部内容,再用 `sed` 去掉 `.json`。如果写成 `sed 's/.*_//'`,`max_steps` 会被截成 `steps`。

故意把 `max_steps` 设成 2,是为了让分布里出现撞线的情况。设成 4 的话,`deepseek-flash` 十个问题全是 `ok`,看不出东西。

跑完挑一个 `max_steps` 的文件打开看看。我这里连「北京现在多少度」这种一步就能答的问题也撞线了,翻 `messages` 才知道原因:天气接口第一次连接超时,模型重试了一次,两步就用完了。**不看日志,你只会以为模型变笨了。** 这就是上面说的「读失败的轨迹」。

**验收标准:** 练习 1 能说清为什么改成 `>=` 后原来的 5 个测试仍然全过,新加的边界测试能抓住它;练习 2 两个新测试通过(共 8 个);练习 3 两次撞线拿到的都是有内容的部分答案;练习 4 能用一行命令列出 10 次运行的状态分布,并能从至少一个撞线日志里找出撞线原因。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 临时错误(transient error) | 过一会儿重试大概率会成功的错误,如 429、5xx、连接超时 |
| 指数退避(exponential backoff) | 每次重试的等待时间翻倍,避免加重服务端压力 |
| 抖动(jitter) | 在等待时间上加随机量,避免大量客户端同时重试 |
| 惊群效应 | 大量客户端在同一时刻重试,把刚恢复的服务再次打垮 |
| 工具超时 | 单次工具执行的最长等待时间,超时后返回报错 |
| 线程池(ThreadPoolExecutor) | 预先建好的一组工作线程,`submit` 提交任务、拿回 `future`,`future.result(timeout=...)` 可以限时等待结果 |
| 幂等(idempotent) | 同一个操作执行多次和执行一次效果相同 |
| 循环检测 | 识别模型反复发出相同调用的机制 |
| 预算(budget) | 步数、token、时间三类上限,防止任务失控 |
| 优雅收尾(graceful degradation) | 撞线后禁用工具、基于已有信息给部分答案 |
| needs_human | 结果上的转人工标记,交给上游系统处理 |
| 假模型(fake client) | 按剧本返回响应的测试替身,用于离线、确定性地测试 Agent 逻辑 |

## 常见误区

**所有错误都重试。** 400、401、404 重试多少次都一样,还会浪费时间、触发限流。只重试临时错误,其他的立刻失败并报清楚原因。

**重试不等待,或者固定间隔。** 立即重试在服务过载时火上浇油,固定间隔会造成惊群。用指数退避加抖动。

**两层重试叠加。** SDK 自带重试,外面再套一层,请求次数是乘法关系。统一在一层控制。

**超时以后就当没发生过。** Python 里超时只是「不再等」,工具可能还在执行。写操作必须幂等,否则重试会造成重复扣款、重复发信。

**默认值写成 `client | OpenAI(...)`。** `|` 是按位或,不是「没传就用默认值」。不管传没传 `client`,它都会先创建 `OpenAI(...)` 再对两个对象做 `|`,运行时报 `TypeError`。要写 `client or OpenAI(...)`。手抄代码时很容易打错这一个字符。

**撞线就返回「失败」。** 前面所有步骤的信息都浪费了。禁用工具、让模型给出部分答案、标记转人工,用户体验和成本都好得多。

**只能靠真模型测试。** 循环、超时、重试、截断这些逻辑完全可以用假模型离线测,零成本、结果确定。真模型留给质量评测。

## 学习资料

### 文档与文章

- [AWS Builders' Library · Timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/):重试和抖动的经典文章,和 AI 无关但每个后端工程师都该读,40 分钟。
- [tenacity 文档](https://tenacity.readthedocs.io/en/latest/):重试库的用法,看 wait、stop、retry 三类策略的组合方式,20 分钟。
- [openai-python · Retries 与 Timeouts](https://github.com/openai/openai-python#retries):SDK 默认的重试次数、哪些错误会自动重试、超时怎么设,10 分钟。
- [Chip Huyen · Agents](https://huyenchip.com/2025/01/07/agents.html):读其中「Agent Failure Modes and Evaluation」一节,讲规划失败、工具失败、效率问题三类失败模式,30 分钟。
- [Why Do Multi-Agent LLM Systems Fail?](https://arxiv.org/abs/2503.13657):2025 年 UC Berkeley 等机构的论文,分析了大量多 Agent 系统运行轨迹,归纳出一套失败分类。今天读摘要和分类图,Day 26 讲多 Agent 时再细读,20 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1rhLn6iEip&autoplay=0&high_quality=1" title="90%的Agent都翻车了|5种死法×5种解法【费曼学AI EP.30】" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>费曼学AI · 90%的Agent都翻车了|5种死法×5种解法【费曼学AI EP.30】 · 12 分钟,把常见失败模式和对策过一遍,可以和今天的九类表格对照。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1GrGE63ESw&autoplay=0&high_quality=1" title="IBM《为什么Agentic AI会失败:无限循环、规划错误等问题解析》中英字幕(LLM)" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI双语课 · IBM《为什么Agentic AI会失败:无限循环、规划错误等问题解析》中英字幕(LLM) · 13 分钟,IBM Technology 频道的讲解搬运,讲无限循环和规划错误的成因。</figcaption>
</figure>

- 吴恩达《Agentic AI》中英双语搬运(BV1aaxyz8ELY)第 20–21 P「误差分析与确定后续步骤优先级」「更多误差分析示例」:讲怎么从失败轨迹里找到该修的地方,是 Day 30 的预习。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/T1Lowy1mnEg" title="How to Build Reliable AI Agents (without the hype)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Dave Ebbelaar · How to Build Reliable AI Agents (without the hype) · 讲把 Agent 拆成确定性组件、用代码兜住模型不可靠部分的工程思路。</figcaption>
</figure>

- Hamel Husain《How to Find Failure Patterns in Complex AI Agents》(YouTube `Kn1XvZhYd34`):怎么在复杂 Agent 的轨迹里找失败规律,和练习 4 的失败日志直接相关。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 6 章「Agent Failure Modes and Evaluation」一节(原书约 298 页),对失败的分类和本文互补。
- Michael T. Nygard《Release It!》第 2 版(Pragmatic Bookshelf, 2018):第 5 章「Stability Patterns」里的超时、断路器、舱壁等模式。这本书和 AI 无关,但它讲的每一种稳定性模式在 Agent 系统里都用得上。

### 开源项目与代码

- [jd/tenacity](https://github.com/jd/tenacity):重试库源码,想知道 `wait_exponential_jitter` 具体怎么算可以直接读。
- [openai/openai-python](https://github.com/openai/openai-python):看 `_base_client.py` 里 SDK 自带的重试逻辑,理解为什么要避免两层重试。

## 自测

1. 下面哪些错误应该重试?429、400、503、401、连接超时、404。

<details><summary>答案</summary>

应该重试:429、503、连接超时,它们是临时错误。不应该重试:400(请求本身有问题)、401(认证失败)、404(模型名或路径错误),重试不会改变结果。

</details>

2. 为什么退避等待要加随机抖动?

<details><summary>答案</summary>

如果大量客户端在同一时刻失败、又都按相同的时间间隔重试,它们会在同一时刻再次涌向服务端,把刚恢复的服务再次打垮(惊群效应)。随机抖动把重试时间打散。

</details>

3. 工具超时后,`RobustAgent` 返回了一条超时报错,模型决定重试。如果这个工具是「发送退款确认邮件」,会有什么风险?怎么防?

<details><summary>答案</summary>

Python 线程超时只是不再等待,原工具可能仍在执行并最终成功,模型重试后会再发一次,用户收到两封邮件。防法是让写操作幂等:调用时带一个幂等键(比如工单号加操作类型),工具端发现同一个键已经处理过就直接返回之前的结果。

</details>

4. Agent 撞到步数上限时,为什么要用 `tool_choice="none"` 再调一次模型,而不是直接返回失败?

<details><summary>答案</summary>

前面的步骤已经拿到了不少信息,直接返回失败会浪费这些投入。禁用工具后再调一次,模型会基于已有信息给出部分答案并说明缺什么,用户和接手的人工客服都能从中受益。禁用工具是为了防止它在收尾时继续调用工具。

</details>

5. (面试题)「你的 Agent 上线后,偶尔一个请求会花掉几块钱,怎么排查和防范?」

<details><summary>答案</summary>

排查:按单次花费排序找出异常请求,回放它们的完整轨迹,看是步数过多(循环、规划失败)、单次工具结果过大(上下文膨胀)还是模型选择问题。防范:设置 token 预算和步数上限、循环检测、工具结果截断和分页;撞线后优雅收尾并转人工;对花费做监控告警,按 P99 设阈值;上线前用假模型测试这些防线确实生效。

</details>

6. 为什么推荐用假模型做测试?它不能替代什么?

<details><summary>答案</summary>

假模型能零成本、确定性地构造各种极端场景(循环、限流、超时、坏参数),适合测试循环控制、重试、截断等工程逻辑。它不能替代对回答质量、工具选择合理性的评测,那些需要真模型加评测集和 LLM 评分,是 W5 的内容。

</details>

## 明天预告

到目前为止我们一直默认「这事得交给 Agent」。但很多任务其实根本不需要模型来决定下一步。明天(Day 13)通读 Anthropic 的《Building effective agents》,讲 **Workflow 还是 Agent**:把文中的五种 workflow 模式(prompt chaining、routing、parallelization、orchestrator-workers、evaluator-optimizer)各写一个最小实现,并学会判断什么时候该用哪一种。
