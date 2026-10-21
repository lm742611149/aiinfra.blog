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

下面完整实现里的 `_llm` 就套了这样一个装饰器,逐个参数看一下。`@retry(...)` 是 Python 装饰器,相当于 JS 里用高阶函数把原函数包一层:`_llm = retry(options)(_llm)`,之后调用 `_llm()` 跑的是包过的版本。

| 参数 | 意思 |
| --- | --- |
| `retry=retry_if_exception_type(RETRYABLE)` | 哪些错误才重试:只有异常属于 `RETRYABLE`(连接失败、读超时、429、5xx)才重试,400、401 之类直接抛出去 |
| `wait=wait_exponential_jitter(initial=1, max=20)` | 每次重试前等多久:从 1 秒起翻倍(1、2、4…),每次再加 0~1 秒随机抖动,单次最多等 20 秒 |
| `stop=stop_after_attempt(4)` | 什么时候放弃:总共最多**调用** 4 次,也就是第一次加 3 次重试,不是重试 4 次 |
| `reraise=True` | 放弃时抛什么:抛最后一次的原始异常(比如 `openai.RateLimitError`)。不加的话 tenacity 会抛自己的 `RetryError` 把原异常包起来,外面的 `except openai.XXX` 就接不住了 |

最坏情况的时间线是这样的:

```
第 1 次调用 → 429
  等 ~1-2 秒
第 2 次调用 → 503
  等 ~2-3 秒
第 3 次调用 → 读超时
  等 ~4-5 秒
第 4 次调用 → 还是失败 → 抛出原始异常,交给 run() 里的 except 处理
```

重试最多多花十秒左右,在 `Limits.max_seconds=120` 的总预算里绰绰有余。

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

对应到下面完整实现里的 `_is_loop`,四行各干一件事:

- `key = hashlib.md5(f"{name}:{arguments}".encode()).hexdigest()`:把工具名和参数拼成 `"search:{\"q\": \"退款政策\"}"` 这样的字符串,`.encode()` 转成字节(md5 只吃字节),算出一个 32 位十六进制的指纹。用哈希不是为了保密,只是让 key 定长,参数再长也不会把字典撑大。直接用拼好的字符串当 key 也能工作。
- `self.seen[key] = self.seen.get(key, 0) + 1`:`self.seen` 是 `__init__` 里建的字典,记录每个指纹出现了几次。`.get(key, 0)` 是「有就取,没有算 0」,相当于 JS 的 `seen[key] = (seen[key] ?? 0) + 1`。
- `return self.seen[key] > self.limits.max_repeats`:`max_repeats` 默认是 2,所以第 1、2 次返回 `False` 正常执行,第 3 次开始返回 `True`。

调用方在 `run()` 里:`_is_loop` 为 `True` 时不执行工具,而是把「和之前完全一样,请换做法」作为工具结果塞回去;如果某个指纹已经出现超过 `max_repeats + 1` 次(也就是第 4 次,代码里用 `max(self.seen.values())` 取出现最多的那个),就调 `_wrap_up("loop", ...)` 收尾。注意 `self.seen` 跟着 Agent 实例走,同一个实例连续处理多个问题时计数会累加,所以每个任务最好新建一个 Agent。

还有个小坑:`arguments` 是模型生成的 JSON 字符串,`{"q":"退款政策"}` 和 `{"q": "退款政策"}` 只差一个空格,指纹就不同。想更稳可以先 `json.loads` 再 `json.dumps(..., sort_keys=True)` 规范化一下再算哈希。

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
from openai.types.chat import ChatCompletion
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
    def _llm(self, **kwargs: Any) -> ChatCompletion:  # 返回类型要写,否则后面 resp/msg/tc 全是 Any,没有代码提示
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
        self.messages.append({"role": "assistant", "content": answer})  # 收尾的回答也进历史,日志和下一轮对话才完整
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

<div class="line-notes">

- `import hashlib` 后面 `_is_loop` 用它算 md5 指纹,判断「这次调用和之前是不是一模一样」。
- `from concurrent.futures import ThreadPoolExecutor` 线程池。工具放到另一个线程里跑,主线程才能「等 15 秒等不到就不等了」。同一个函数直接调的话,它卡住你也只能陪着卡。
- `import TimeoutError as ToolTimeout` `as` 是起别名。`concurrent.futures.TimeoutError` 和 Python 内置的 `TimeoutError` 名字一样,改叫 `ToolTimeout`,下面 `except ToolTimeout:` 一看就知道接的是「工具超时」。
- `from dataclasses import dataclass, field` `@dataclass` 让你只写字段和默认值,`__init__`、`__repr__` 自动生成。实测 `print(Limits())` 输出 `Limits(max_steps=12, max_tokens=60000, max_seconds=120, tool_timeout=15, max_tool_chars=4000, max_repeats=2)`,就是 `__repr__` 的功劳。
- `from tenacity import` 重试库:`retry` 是装饰器,`retry_if_exception_type` 决定哪些异常才重试,`stop_after_attempt` 决定最多试几次,`wait_exponential_jitter` 决定每次等多久。
- `from w2.agent_loop import ToolRegistry` 复用 Day 9 的工具登记处,今天只换循环,不碰工具。
- `RETRYABLE = (` 一个元组,装着 4 种「过一会儿重试大概率会好」的异常:连不上、超时、429 限流、5xx。`except RETRYABLE` 能接住元组里任意一种。400(参数错)、401(key 错)不在里面,那种错重试一万次也一样错。
- `class Limits:` 所有阈值集中放在这里。想改上限时只改一处,测试里也能按需传 `Limits(max_repeats=2)` 这样只改一个字段,其余用默认值。
- `max_tokens: int = 60_000` `60_000` 就是 60000,下划线只是为了好读,Python 3.6 起支持。注意它是**整个任务**累计的 prompt+completion,不是单次调用的 `max_tokens` 参数。
- `max_repeats: int = 2` 同一个工具、同样参数最多允许做 2 次,第 3 次就拦。练习 1 专门测的就是「恰好第 2 次」这个边界。
- `class AgentResult:` `run()` 的返回值,不再是一个裸字符串。调用方看 `status` 就知道是正常完成(`ok`)还是撞了哪条线。
- `usage: dict = field(default_factory=dict)` 可变的默认值必须用 `field(default_factory=...)`。直接写 `usage: dict = {}`,dataclass 会报 `ValueError: mutable default`,因为那样所有实例会共用同一个 dict。
- `def __init__(self, registry: ToolRegistry` `client: Any = None` 是给测试留的口子:测试时塞一个假模型进来,不传就自己建真的 OpenAI 客户端。`limits: Limits | None = None` 同理,不传就用默认上限。
- `self.client = client or OpenAI(` `a or b`:`a` 为真就用 `a`,否则用 `b`。测试里 `client=FakeClient(...)` 为真,真客户端根本不会建,所以测试时 `.env` 里没 key 也不会报 KeyError。
- `api_key=os.environ["LLM_API_KEY"], timeout=60, max_retries=0` `max_retries=0` 关掉 SDK 自带的重试(默认 2 次)。否则 SDK 重试 3 次 × tenacity 重试 4 次,最坏一次调用要打 12 次请求。
- `self.model = os.environ.get("LLM_MODEL", "fake")` 实测 `.env` 里配的是 `deepseek-flash`;测试时没配,就是 `"fake"`,假模型不在乎这个名字。
- `self.messages: list[Any] = [{"role": "system", "content": system}]` 对话历史从 system 开始。测试里 `system="sys"`,所以一开始就是 `[{"role": "system", "content": "sys"}]`。
- `self.seen: dict[str, int] = {}` 调用指纹 → 出现次数,`_is_loop` 往里记。
- `self.pool = ThreadPoolExecutor(max_workers=4)` 最多同时跑 4 个工具。这个 Agent 实际是一个一个跑工具的,池子主要是为了能「限时等待」。
- `retry=retry_if_exception_type(RETRYABLE),` 只有 `RETRYABLE` 里那 4 种异常才重试,其他异常直接往外抛。
- `wait=wait_exponential_jitter(initial=1, max=20),` 第 n 次重试前等 `1 × 2^n` 秒,再加 0~1 秒随机抖动,最多 20 秒。实测 `test_rate_limit_is_retried`(连续两次 429):第 1 次失败后等了 **1.45 秒**,第 2 次失败后等了 **2.89 秒**,第 3 次成功。抖动是为了避免一堆客户端同时被限流后又同一秒一起重试。
- `stop=stop_after_attempt(4),` 总共最多试 4 次(1 次 + 重试 3 次)。
- `reraise=True,` 4 次都失败时抛出**原来的异常**(比如 `RateLimitError`)。不写的话 tenacity 会包一层 `RetryError` 再抛,`run()` 里的 `except RETRYABLE` 就接不住了。
- `def _llm(self, **kwargs: Any) -> ChatCompletion:` `**kwargs` 收下所有关键字参数,原样转给 `create(...)`。主循环传 `tools=...`,收尾时传 `tools=..., tool_choice="none"`,都走这一个函数,都享受重试。
- `return self.client.chat.completions.create(model=self.model, messages=self.messages, **kwargs)` 实测收尾那次,`FakeClient` 记下的参数 key 是 `['model', 'messages', 'tools', 'tool_choice']`,`tool_choice` 的值是 `"none"`。
- `future = self.pool.submit(self.registry.call, name, arguments)` `submit` 把「调用 `registry.call(name, arguments)`」扔进线程池,马上返回一个 `future`(期货单),这时工具已经在另一个线程里开始跑了。
- `out = future.result(timeout=self.limits.tool_timeout)` 最多等 `tool_timeout` 秒拿结果。实测 `slow` 工具睡 2 秒、`tool_timeout=0.5`:0.5 秒时抛 `ToolTimeout`,整个 `run()` 只用了 0.5 秒左右。注意那个线程其实还在后台继续睡完 2 秒,Python 杀不掉线程,只是我们不等它了。
- `return json.dumps({"error": f"工具 {name} 超过` 超时不抛异常,变成一条错误消息交给模型。实测内容是 `{"error": "工具 slow 超过 0.5 秒没有返回。可以换个参数重试,或者告诉用户暂时查不到。"}`。`ensure_ascii=False` 让中文原样输出,不变成 `工` 这种转义。
- `if len(out) > self.limits.max_tool_chars:` 实测测试里的 `big` 工具返回 `{"data": "很长很长…"}`,一共 **10012** 个字符。`max_tool_chars=500` 时进入截断。
- `out = out[:cut] + f"\n…[结果过长` `out[:500]` 取前 500 个字符,再接一段说明。实测截断后总长 **549**,结尾是 `…[结果过长,已截断:共 10012 字符,只显示前 500。需要的话请用更精确的参数重新查询]`。告诉模型「被截了、原来多长」,它才知道该换更精确的参数,而不是以为数据就这么多。
- `key = hashlib.md5(f"{name}:{arguments}".encode()).hexdigest()` 把「工具名:参数字符串」算成 32 位指纹。实测 `big:{"x": "a"}` → `65b73c733bc3615e236caf244d35a276`。`.encode()` 是因为 md5 只吃 bytes,不吃 str。
- `self.seen[key] = self.seen.get(key, 0) + 1` 次数加一,第一次没有这个 key,`get` 返回默认值 0。实测循环测试里四次同样调用,`seen` 的值依次是 1、2、3、4。
- `return self.seen[key] > self.limits.max_repeats` `max_repeats=2` 时:1>2 False、2>2 False、**3>2 True**、4>2 True。也就是前两次照常执行,第 3 次起被拦。
- `def _wrap_up(self, status: str, step: int, reason: str) -> AgentResult:` 撞线时的收尾。四种撞线(timeout/budget/loop/max_steps)都走这里,只是 `reason` 不同。
- `self.messages.append({"role": "user", "content": f"(系统提示:{reason}。` 往对话里补一句「别再调工具了,用已有信息回答」。实测循环测试里,倒数第二条消息就是 `(系统提示:检测到重复调用,任务可能陷入循环。不要再调用工具,……)`,最后一条是下面补进去的收尾回答。
- `msg = self._llm(tools=self.registry.schemas, tool_choice="none").choices[0].message` `tool_choice="none"` 禁止模型再调工具,只能回文字。`tools` 照样传上,和前面每一步保持一致,只是用 `tool_choice` 把调用关掉。练习 3 实测 `deepseek-flash` 接受这个组合。
- `answer = msg.content or ""` 模型没回文字时 `content` 是 None,`or ""` 兜成空串。真模型遵守 `tool_choice="none"`,收尾时一定回文字;假模型不管这个参数,剧本里排到哪条就给哪条,所以测试里要把收尾那条文字回复排在正确的位置(见下面 `test_budget_stops_agent`)。
- `except Exception as e:  # 收尾也失败了` 兜底的兜底。比如正是模型服务挂了才撞的线,收尾这次多半也会失败,这时只能返回固定文案。`type(e).__name__` 取异常类名,比如 `"RateLimitError"`。
- `self.messages.append({"role": "assistant", "content": answer})` 收尾得到的回答也写进历史。不写的话,历史停在那句「系统提示」上:存日志时看不到最终回答,Day 14 多轮对话里下一轮也接不上。实测循环测试跑完,`agent.messages[-1]` 是 `{"role": "assistant", "content": "根据已有信息,部分完成。"}`。收尾失败时补进去的是那段固定文案,用户看到什么,历史里就记什么。
- `return AgentResult(answer, status, step, dict(self.usage), needs_human=True)` 撞线一律 `needs_human=True`。`dict(self.usage)` 复制一份,避免外面拿到的结果被后续调用改掉。注意收尾这一次的 token 没有算进 usage(练习 3 后面说了)。
- `self.messages.append({"role": "user", "content": user_input})` 用户这句话进历史。测试里是 `"hi"`。
- `start = time.monotonic()` 掐表,只用来算差值。
- `for step in range(1, self.limits.max_steps + 1):` `range(1, 13)` 就是 1 到 12,step 从 1 开始数,打印、撞线时报的步数和人的直觉一致。
- `if time.monotonic() - start > self.limits.max_seconds:` 每一步开始前先看时间。超过 120 秒就收尾,状态 `timeout`。
- `if sum(self.usage.values()) > self.limits.max_tokens:` `usage.values()` 是 prompt 和 completion 两个数,相加就是总消耗。实测 `test_budget_stops_agent`(假模型每次记 100+20=120,上限 300):第 1 步 0、第 2 步 120、第 3 步 240 都没超,照常调模型;第 4 步开始时是 360 > 300,收尾,`status="budget"`、`steps=4`。注意它是「调用前检查」,所以最后一次调用可能让总量超过上限一点,这是有意的取舍。
- `resp = self._llm(tools=self.registry.schemas)` 主循环的模型调用,带上全部工具 schema。实测测试里的 schema 有 `slow` 和 `big` 两个,参数都是 `{"x": {"type": "string"}}`。
- `except RETRYABLE as e:` tenacity 重试 4 次还失败,异常才会到这里(多亏 `reraise=True` 抛的是原异常)。这时模型都叫不动,也没法让它收尾,直接返回 `llm_error`。
- `msg = resp.choices[0].message` 真模型和假模型都是这个结构,所以假模型才能骗过这里。
- `self.usage["prompt_tokens"] += resp.usage.prompt_tokens` 每一步累加 token。实测练习 3 里,`max_steps=3` 那次三步累计 `{'prompt_tokens': 2145, 'completion_tokens': 285}`。
- `self.messages.append(self._assistant_dict(msg))` 模型这一步的回复(含 tool_calls)必须进历史,下一轮模型才知道自己刚才要调什么。
- `if not msg.tool_calls:` 不调工具 = 模型给出了最终回答,`status="ok"`,正常结束。
- `looping = False` 这一步里有没有出现过「被拦下的重复调用」。
- `for tc in msg.tool_calls:` 模型一次可以调好几个工具。实测练习 3 第 2 步一次调了 3 个 `get_weather`(杭州、成都、哈尔滨)。
- `if self._is_loop(tc.function.name, tc.function.arguments):` 先算指纹计次数,超过 `max_repeats` 就不执行,直接回一条「和之前完全一样」的提醒。
- `out = self._run_tool(tc.function.name, tc.function.arguments)` 正常执行,带超时和截断。
- `self.messages.append({"role": "tool", "tool_call_id": tc.id, "content": out})` 每个 tool_call 都必须有一条对应的 tool 消息,`tool_call_id` 要对上,否则下一次调用会 400。被拦下的那次也要回一条(就是那句提醒)。
- `if looping and max(self.seen.values()) > self.limits.max_repeats + 1:` 第一次被拦时只是提醒,给模型一次改正的机会;被拦后还要再来,才真的收尾。实测循环测试:第 3 步 `seen=3`,`3 > 3` 为 False,只提醒;第 4 步 `seen=4`,`4 > 3` 为 True → `_wrap_up("loop")`,`steps=4`,usage `{'prompt_tokens': 400, 'completion_tokens': 80}`。
- `return self._wrap_up("max_steps", self.limits.max_steps, "已达到最大步数")` for 循环正常跑完 12 步还没结束,才会走到这里。实测练习 4 里「(37.5 - 12) * 4 等于多少?」就撞了这条线(`max_steps=2`):模型第 2 步明明已经写出了 `= **102**`,却又附带调了一次同样的 calculate,有 tool_calls 就不算结束,两步用完只能收尾。
- `@staticmethod` 静态方法,不用 `self`,纯粹的格式转换。
- `d: dict[str, Any] = {"role": "assistant", "content": msg.content}` 把 SDK 的消息对象转成普通 dict 存进历史。
- `d["tool_calls"] = [tc.model_dump() for tc in msg.tool_calls]` `model_dump()` 是 pydantic 对象转 dict 的方法。实测第一条 assistant 消息存成 `{'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'call_0', 'type': 'function', 'function': {'name': 'big', 'arguments': '{"x": "a"}'}}]}`。
- `reasoning = getattr(msg, "reasoning_content", None)` `getattr(对象, 属性名, 默认值)`:有这个属性就取,没有就返回 None,不报错。DeepSeek 开思考模式时会有 `reasoning_content`,要原样带回去,不然下一轮会报错;我们的 `.env` 关了思考模式,所以这里一般是 None。

</div>

几个设计点再说一下。

`run()` 开头的 `start = time.monotonic()` 是在掐表。`time.monotonic()` 返回一个「只会往前走的秒数」,数值本身没有意义(不是几点几分),只能拿两次的差来算过了多久:循环里每一步 `time.monotonic() - start` 就是任务已经跑了几秒,超过 `max_seconds`(默认 120)就收尾。相当于 JS 的 `performance.now()`,只不过单位是秒、带小数。为什么不用 `time.time()`?`time.time()` 是系统时钟,电脑自动对时、手动改时间时会往回跳或突然往前跳,算出来的耗时可能是负数或者多出几分钟;`monotonic` 保证不回退,**算耗时一律用它,要显示「现在几点」才用 `time.time()`**。

返回值从字符串变成了 `AgentResult`,带上状态、步数、用量和 `needs_human`。调用方拿到结果就知道这次是正常完成还是撞线收尾,该怎么处理。这是从「脚本」走向「服务」的一小步,Day 36 把它做成 API 时会直接用上。

`_llm` 的返回类型 `-> ChatCompletion` 一定要写。`client` 参数标的是 `Any`(为了测试时能塞假模型),于是 `self.client.chat.completions.create(...)` 的返回值也被推断成 `Any`,一路传下去 `resp`、`msg`、`tc` 全是 `Any`,编辑器里敲 `tc.` 就什么提示都没有了。在 `_llm` 上写明返回 `ChatCompletion`,类型从这里重新接上,`tc` 经过 `tc.type != "function"` 收窄后就是 `ChatCompletionMessageFunctionToolCall`,`tc.function.name` 这些都能补全。规律是:**`Any` 会顺着调用链传染,在源头最近的函数上把返回类型写死就能截断它。**

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
    loop = [reply(calls=[tool_call("big", {"x": str(i)}, i)]) for i in range(3)]  # 每次记 120 token,3 次后超 300
    client = FakeClient(loop + [reply("预算用完,先给部分结果")])  # 第 4 次调用就是收尾
    r = RobustAgent(reg, "sys", Limits(max_tokens=300), client=client).run("hi")
    assert r.status == "budget" and r.needs_human
    assert r.answer == "预算用完,先给部分结果" and client.calls[-1]["tool_choice"] == "none"
```

<div class="line-notes">

- `import httpx2` openai 3.x 内部用 httpx2 发请求,构造假的 429 响应要用同一个包的 `Request`/`Response`,否则类型对不上。
- `from w2.robust_agent import Limits, RobustAgent` 被测的东西。测试文件也放在 `w2/` 下,在仓库根目录跑 `uv run pytest -q w2/test_robust_agent.py`。
- `def tool_call(name, args, i=0):` 造一个假的工具调用对象。实测 `tool_call("big", {"x": "a"}, 0)` 得到的对象:`tc.id == "call_0"`,`tc.function.arguments == '{"x": "a"}'`。
- `fn = SimpleNamespace(name=name, arguments=json.dumps(args, ensure_ascii=False))` 真模型返回的 `arguments` 是 JSON **字符串**,不是 dict,所以这里要先 `json.dumps`。
- `tc.model_dump = lambda: {` 给假对象手动挂一个 `model_dump()` 方法,因为 `_assistant_dict` 会调它。实测返回 `{'id': 'call_0', 'type': 'function', 'function': {'name': 'big', 'arguments': '{"x": "a"}'}}`。
- `def reply(content=None, calls=None):` 造一条假的模型响应,结构见正文下面那段 JSON。
- `usage=SimpleNamespace(prompt_tokens=100, completion_tokens=20)` 每条假响应固定记 100+20=120 个 token。预算测试就靠这个固定数字算出「第几步会撞线」。
- `class FakeClient:` 按剧本演的假模型,正文下面有详细讲解。
- `self.script, self.calls = list(script), []` 一行给两个变量赋值(元组解包)。`list(script)` 复制一份剧本,`pop` 时不会改掉调用方传进来的那个列表。
- `self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))` 凑出 `client.chat.completions.create(...)` 这条调用路径,实际走到 `self._create`。
- `self.calls.append(kwargs)` 记下每次调用的参数。实测循环测试跑完 `len(client.calls) == 5`,最后一条的 key 是 `['model', 'messages', 'tools', 'tool_choice']`。
- `item = self.script.pop(0)` 从剧本开头取一条并删掉。剧本取空了再 `pop` 会抛 `IndexError`,测试就挂,这正好能抓住「Agent 多调了一次模型」。
- `if isinstance(item, Exception):` 剧本里放的是异常对象就抛出去,模拟 429 这种失败。
- `reg = ToolRegistry()` 测试专用的工具表,只有下面两个假工具。
- `def slow(x: str) -> dict:` 故意睡 2 秒的工具,用来测超时。
- `def big(x: str) -> dict:` 故意返回超长结果。实测 `reg.call("big", '{"x": "a"}')` 返回 10012 个字符。
- `return {"data": "很长" * 5000}` 字符串乘整数是重复拼接,`"很长" * 5000` 是 10000 个汉字,再加上 JSON 外壳 `{"data": ""}` 的 12 个字符,正好 10012。
- `same = lambda i: reply(calls=[tool_call("big", {"x": "a"}, i)])` 详细讲解和逐步追踪表在正文下面,这里只说结论:实测 `seen` 依次是 1、2、3、4,第 3 次被拦,第 4 次收尾。
- `r = RobustAgent(reg, "sys", Limits(max_repeats=2), client=client).run("hi")` 实测 `r` 是 `AgentResult(answer='根据已有信息,部分完成。', status='loop', steps=4, usage={'prompt_tokens': 400, 'completion_tokens': 80}, needs_human=True)`。usage 只算了 4 次,收尾那次没算进去。
- `client = FakeClient([reply(calls=[tool_call("slow", {"x": "a"})]), reply("好的")])` 剧本:第 1 次让 Agent 调 `slow`,第 2 次回「好的」结束。
- `agent = RobustAgent(reg, "sys", Limits(tool_timeout=0.5), client=client)` 只给工具 0.5 秒,`slow` 要 2 秒,必然超时。这里把 agent 单独存成变量,是因为后面要翻 `agent.messages`。
- `tool_msg = [m for m in agent.messages if m["role"] == "tool"][0]` 从历史里筛出所有 tool 消息,取第一条。实测内容是 `{"error": "工具 slow 超过 0.5 秒没有返回。可以换个参数重试,或者告诉用户暂时查不到。"}`。
- `assert "超过 0.5 秒" in tool_msg["content"] and r.status == "ok"` 两件事:超时变成了给模型看的错误消息;Agent 没崩,模型看完错误回了「好的」,正常结束。实测 `steps=2`。
- `agent = RobustAgent(reg, "sys", Limits(max_tool_chars=500), client=client)` 只允许工具结果放 500 个字符进上下文。
- `assert len(tool_msg["content"]) < 600 and "已截断" in tool_msg["content"]` 实测截断后长度 549(500 + 说明文字 49),小于 600。
- `req = httpx2.Request("POST", "https://x.invalid/v1/chat/completions")` 构造 `RateLimitError` 必须带一个 response,response 又必须带 request,所以先造一个假请求。`.invalid` 是保留域名,永远解析不到,不会真发出去。
- `err = openai.RateLimitError("429", response=httpx2.Response(429, request=req), body=None)` 实测 `err.status_code == 429`。
- `client = FakeClient([err, err, reply("第三次成功")])` 剧本:前两次抛 429,第三次成功。
- `assert r.status == "ok" and len(client.calls) == 3` 实测通过,两次重试之间分别等了 1.45 秒和 2.89 秒,这就是这个测试慢的原因。注意 `steps=1`:重试发生在 `_llm` 内部,对循环来说只算一步。
- `loop = [reply(calls=[tool_call("big", {"x": str(i)}, i)]) for i in range(3)]` 造 3 条「调 big」的响应,参数分别是 `"0"`、`"1"`、`"2"`,每次都不一样,不会触发循环检测,只能靠预算拦下。为什么正好 3 条:假模型每次记 100+20=120 token,3 次后累计 360,超过 300,第 4 次调用就是收尾。
- `client = FakeClient(loop + [reply("预算用完,先给部分结果")])` 剧本第 4 条是一句纯文字回复,正好被收尾那次拿到。剧本条数要和撞线的时机对上,不然收尾拿到的是一条工具调用,`answer` 就成了空串,测试也照样能过。
- `r = RobustAgent(reg, "sys", Limits(max_tokens=300), client=client).run("hi")` 实测 `status='budget', steps=4`,usage 是 `{'prompt_tokens': 300, 'completion_tokens': 60}`(360 > 300)。剧本 4 条刚好用完:3 次正常 + 1 次收尾。
- `assert r.status == "budget" and r.needs_human` 撞的是预算线,并且标记了要人工接手。
- `assert r.answer == "预算用完,先给部分结果"` 这一行检查收尾真的拿到了回答,`tool_choice` 也确实是 `"none"`。实测这个测试文件的 5 个测试全部通过。只查 status 是不够的:之前剧本排了 10 条,收尾拿到的是第 4 条工具调用,answer 是空串,但测试照样是绿的。

</div>

先看最上面两个辅助函数,后面每个测试都靠它们造假响应。

`reply(content=None, calls=None)` 造一条「模型的回应」。两个参数都可选:传 `content` 就是模型回了一段文字,传 `calls` 就是模型要调工具,`calls` 是一个列表,因为模型一次可以调好几个工具。`reply(calls=[...])` 里的 `calls=` 是**关键字参数**,按名字传参,相当于 JS 里传 `{ calls: [...] }` 这种选项对象。`tool_call(name, args, i)` 造列表里的一个工具调用。

所以 `reply(calls=[tool_call("big", {"x": "a"}, 0)])` 造出来的东西,结构和真模型返回的 JSON 一样:

```
{
  "choices": [{ "message": {
      "content": null,
      "tool_calls": [{ "id": "call_0", "type": "function",
                       "function": { "name": "big", "arguments": "{\"x\": \"a\"}" } }]
  }}],
  "usage": { "prompt_tokens": 100, "completion_tokens": 20 }
}
```

意思就是「模型说:我要调 `big`,参数 `x="a"`」。`reply("好的")` 则是「模型直接回了一句『好的』,不调工具」,Agent 看到没有 `tool_calls` 就会结束循环。

`FakeClient` 是那个「按剧本演的假模型」。`FakeClient([a, b, c])` 把一个列表交给它当剧本,存在 `self.script` 里。Agent 每调一次 `client.chat.completions.create(...)`,实际走到的是 `_create`,它做三件事:`self.calls.append(kwargs)` 把这次传进来的参数记进记录本;`self.script.pop(0)` 从剧本**开头**取出一条并删掉,相当于 JS 的 `script.shift()`;取出来的如果是异常就 `raise` 抛出(模拟 429 之类的报错),否则当作模型响应返回。所以剧本里第 1 条给第 1 次调用,第 2 条给第 2 次,依次往下。

`FakeClient([same(0), same(1), same(2), same(3), reply("根据已有信息,部分完成。")])` 就是一份 5 幕的剧本:前 4 次被调都回「我要调 `big`」,第 5 次回一句文字。列表里的 `same(0)` 这些在建剧本时就已经执行完了,存进去的是 5 个造好的响应对象,不是函数。

测试里有两个之前没出现过的写法,再解释一下。

**`SimpleNamespace`:随手捏一个「有这些属性的对象」。** `SimpleNamespace(name="big", arguments="{...}")` 造出来的对象可以用 `fn.name`、`fn.arguments` 点出属性,相当于 JS 里直接写对象字面量 `{ name: "big", arguments: "{...}" }`。Python 的 dict 只能 `d["name"]`,不能 `d.name`,而 `RobustAgent` 里读模型响应用的是 `resp.choices[0].message.tool_calls`、`tc.function.name` 这种点号写法,所以假响应得是「能点出属性的对象」。`reply()` 和 `tool_call()` 就是用一层层 `SimpleNamespace` 搭出一个和真 `ChatCompletion` 长得一样的结构;`FakeClient` 里 `self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))` 也是同一个思路,凑出 `client.chat.completions.create(...)` 这条调用路径。这就是 Python 的「鸭子类型」:代码只管对象有没有这个属性,不管它是不是真的 `ChatCompletion` 类。

**`lambda`:一行的匿名函数,相当于 JS 的箭头函数。** `lambda i: reply(...)` 就是 `(i) => reply(...)`,冒号前是参数,冒号后是返回值,只能写一个表达式。测试里用了两处:

- `tc.model_dump = lambda: {...}`:没有参数的 lambda,相当于 `tc.model_dump = () => ({...})`。真的 tool call 对象有 `model_dump()` 方法(pydantic 提供),`_assistant_dict` 会调它把工具调用转成 dict 存进 `messages`,`SimpleNamespace` 没有这个方法,就手动挂一个上去。
- `same = lambda i: reply(calls=[tool_call("big", {"x": "a"}, i)])`:造一个「每次都发出完全相同调用」的响应,`i` 只用来让每次的 `call_id` 不同。`same(0)`、`same(1)`…连续四个,正好触发循环检测。

把 lambda 赋给变量(`same = lambda ...`)在正式代码里不推荐,Ruff 会报 E731,建议改成 `def same(i): return ...`;测试里图省事这样写问题不大。lambda 最常见的正经用法是当参数传,比如 Day 2 里的 `sorted(ok, key=lambda x: x.stars)`。

这五个测试我在本机实际跑过,在仓库根目录执行 `uv run pytest -q w2/test_robust_agent.py`,结果是 `5 passed`,用时 5 到 9 秒。慢主要是因为 429 那个测试里 tenacity 真的在退避等待,以及超时测试里那个工具真的睡了 2 秒。如果嫌慢,可以在测试里把等待策略换成 `wait_none()`,tenacity 支持在运行时替换。

如果你觉得测试代码比业务代码还难读,很正常,前端转过来的同学大多卡在这里。以后做项目,测试可以让 AI 写,但你得会**审**。审一个测试只看三件事:

1. **剧本(准备)**:`FakeClient([...])` 里排了什么,也就是「模型依次会怎么回应」。比如 `[err, err, reply("第三次成功")]` 就是「前两次 429,第三次正常」。
2. **动作**:调了什么,一般就一行 `RobustAgent(...).run("hi")`。
3. **断言**:`assert` 那几行检查了什么。`r.status == "ok" and len(client.calls) == 3` 读出来就是「最后成功了,而且模型确实被调了 3 次(重试了 2 次)」。

能用一句中文说出「这个测试在验证什么场景」,就算读懂了。拿第一个测试 `test_loop_detected_and_wrapped_up` 走一遍,它验证的是「模型连续四次发出一模一样的调用,Agent 能识别出循环并收尾转人工」:

| 第几次调模型 | 剧本给的回应 | `_is_loop` 计数 | Agent 做了什么 |
| --- | --- | --- | --- |
| 1 | `same(0)`:调 `big(x="a")` | 1 | 正常执行工具 |
| 2 | `same(1)`:同样的调用 | 2 | 正常执行工具 |
| 3 | `same(2)`:同样的调用 | 3 > 2 | 不执行,回「和之前完全一样,请换做法」 |
| 4 | `same(3)`:还是同样的调用 | 4 > 3 | 判定陷入循环,调 `_wrap_up("loop")` |
| 5 | `reply("根据已有信息,部分完成。")` | | 收尾这次调用带 `tool_choice="none"`,模型只能给文字答案 |

逐句加上注释是这样的:

```python
def test_loop_detected_and_wrapped_up():
    # pytest 会自动运行所有 test_ 开头的函数,函数名就是这个测试在验证什么
    same = lambda i: reply(calls=[tool_call("big", {"x": "a"}, i)])
    # 定义一个小函数 same(i):造一条「模型要调 big,参数 x="a"」的响应;i 只是调用编号,不影响指纹
    client = FakeClient([same(0), same(1), same(2), same(3), reply("根据已有信息,部分完成。")])
    # 假模型的剧本:前 4 次被调都发出同一个工具调用,第 5 次回一句文字
    r = RobustAgent(reg, "sys", Limits(max_repeats=2), client=client).run("hi")
    # 建 Agent:工具表 reg、系统提示 "sys"、同样的调用最多允许 2 次、用假模型;然后发一句 "hi" 跑起来,结果存到 r
    assert r.status == "loop" and r.needs_human
    # 检查 1:结束原因是 loop(不是 ok 或 max_steps),并且标记了转人工
    assert client.calls[-1]["tool_choice"] == "none"
    # 检查 2:client.calls 记录了每次调模型时传的参数,[-1] 是最后一次(收尾那次),它必须禁止再调工具
```

这三行的值都能在 `RobustAgent` 源码里找到出处,对照着看就不玄了:

- `r` 是 `run()` 的返回值,也就是一个 `AgentResult`。第 4 次重复调用时,`run()` 走到 `return self._wrap_up("loop", step, ...)`;`_wrap_up` 最后一行 `return AgentResult(answer, status, step, dict(self.usage), needs_human=True)`,把传进来的 `"loop"` 填进 `status`、`needs_human` 写死成 `True`。所以 `r.status == "loop"`、`r.needs_human` 为真。
- `client.calls` 是 `FakeClient` 的记录本,每个元素是一次调用传进来的参数字典(`_create(self, **kwargs)` 里的 `kwargs`)。`_wrap_up` 调的是 `self._llm(tools=..., tool_choice="none")`,`_llm` 再把这些参数原样传给 `create(...)`,于是最后一条记录长这样:`{"model": "fake", "messages": [...], "tools": [...], "tool_choice": "none"}`。`client.calls[-1]["tool_choice"]` 就是从这个字典里取 `"tool_choice"` 这个键。
- 反过来想:如果哪天有人把 `_wrap_up` 里的 `tool_choice="none"` 删了,第二条断言会报 `KeyError` 或不等于 `"none"`,测试变红,这条防线就被守住了。

所以两条断言分别检查:`r.status == "loop" and r.needs_human`,结束原因是循环、并标记转人工;`client.calls[-1]["tool_choice"] == "none"`,`FakeClient` 记下了每次被调用时的参数,最后一次(收尾那次)确实禁止了再调工具。剧本正好排 5 条也不是随便写的:如果 Agent 多调了一次模型,剧本被 `pop` 空了会直接报错,测试就挂了;反过来剧本有剩余不会报错,这个测试查不出「少调了」。再验证它是不是真的在测东西:把被测代码故意改坏(练习 1 就是这么做的),测试应该变红;改坏了还是绿的,说明这个测试没用,AI 写测试最常见的问题就是这个。面试里问 Agent 怎么保证可靠性,能讲清楚「用假模型离线测失败路径」比会写测试代码本身更加分。

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

<div class="line-notes">

- `def test_second_identical_call_still_runs():` 专门测「恰好等于阈值」那一次:同样的调用做第 2 次,必须真的执行。
- `client = FakeClient([same(0), same(1), reply("好的")])` 剧本:连续两次一模一样的 `big(x="a")`,然后回「好的」。实测 `seen` 依次是 1、2,`2 > 2` 为 False,两次都正常执行。
- `tool_msgs = [m["content"] for m in agent.messages if m["role"] == "tool"]` 只取 tool 消息的内容。实测两条都是 `{"data": "很长很长…`,真结果。
- `assert len(tool_msgs) == 2` 两次调用都有回执。
- `assert all("完全一样" not in c for c in tool_msgs)` `all(...)` 要求每一条都满足条件,括号里是生成器表达式。如果 `_is_loop` 被改成 `>=`,第 2 条就会变成「这个调用和之前完全一样」的提醒,这一行就会失败。
- `assert r.status == "ok"` 实测 `status='ok', steps=3`:第 1、2 步调工具,第 3 步回「好的」。

</div>

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

<div class="line-notes">

- `fn = SimpleNamespace(name="big", arguments='{"x": ')` 手工拼一个半截 JSON。外层用单引号,里面的双引号就不用转义。
- `tc = SimpleNamespace(id="call_0", type="function", function=fn)` 自己搭工具调用对象,不走 `tool_call()`,因为那个辅助函数会 `json.dumps`,永远造不出坏 JSON。
- `client = FakeClient([reply(calls=[tc]), reply("参数写错了,我换个方式回答。")])` 剧本:第 1 次吐出坏参数,第 2 次模型「看到错误后改口」。
- `assert "JSONDecodeError" in tool_msg["content"]` 实测 tool 消息是 `{"error": "JSONDecodeError: Expecting value: line 1 column 7 (char 6)"}`。`ToolRegistry.call` 里 `json.loads` 抛的异常被接住,变成了给模型看的错误消息,程序没崩。`char 6` 指 `{"x": ` 第 7 个字符的位置,那里本该有一个值。
- `client = FakeClient([reply(calls=[tool_call("search_web", {"q": "退款"})]), reply("我没有搜索工具。")])` 模型调了一个根本没注册的工具 `search_web`。
- `assert "search_web" in tool_msg["content"]` 实测 tool 消息是 `{"error": "没有叫 search_web 的工具,可用的有 ['slow', 'big']"}`。错误里带上了可用工具清单,模型下一步才知道该换哪个。
- `assert "slow" in tool_msg["content"] and "big" in tool_msg["content"]` 确认清单真的列出来了。实测 8 个测试全部通过,用时约 5 秒。

</div>

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

<div class="line-notes">

- `from w2.day09_demo import reg` 导入 Day 9 注册好三个工具的 `reg`。导入时 `day09_demo.py` 顶层代码会执行(包括 `load_dotenv()`),但 `if __name__ == "__main__":` 下面的部分不会。
- `QUESTION = "读一下 cities.txt` 要读文件、查三个城市的天气、算平均和温差,至少要 3 步,正好用来撞线。
- `for limits in (Limits(max_steps=3), Limits(max_tokens=2000)):` 同一个问题用两种上限各跑一次。实测第一次撞步数,第二次撞预算。
- `agent = RobustAgent(reg, SYSTEM, limits)` 每次新建一个 Agent,历史、计数都是干净的。
- `r = agent.run(QUESTION)` 这次实跑 `max_steps=3`:第 1 步 `read_file("cities.txt")` 拿到「杭州、成都、哈尔滨」;第 2 步一次调 3 个 `get_weather`,拿到 14.1℃、15.2℃、-0.1℃;第 3 步调两次 `calculate`,`(14.1+15.2+(-0.1))/3` 得 `9.733333333333333`,`15.2-(-0.1)` 得 `15.299999999999999`。第 3 步还有 tool_calls,所以 3 步用完撞线,进 `_wrap_up`。
- `print(f"\n=== {limits} ===")` 打印出 `Limits(...)` 的全部字段,dataclass 自动生成的 `__repr__`。
- `print(f"status={r.status} steps={r.steps} needs_human={r.needs_human} usage={r.usage}")` 这次实跑两行分别是:<br>`status=max_steps steps=3 needs_human=True usage={'prompt_tokens': 2145, 'completion_tokens': 285}`<br>`status=budget steps=4 needs_human=True usage={'prompt_tokens': 2177, 'completion_tokens': 308}`<br>第二次三步一共用了 2485 个 token,第 4 步开始前发现超过 2000,收尾。
- `print("回答:", r.answer)` 两次收尾都给出了完整的表格:平均约 9.73℃,最冷哈尔滨 -0.1℃,最热成都 15.2℃,温差 15.3℃。其实信息在撞线前已经全拿到了,模型自己也说「没有未完成的部分」,只是循环没机会让它把话说完。这说明 `_wrap_up` 的价值:撞线不等于白干。

</div>

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

<div class="line-notes">

- `def run(self, user_input: str) -> AgentResult:` 新的 `run` 只是个外壳:掐表、调原来的 `_run`、存日志、返回结果。调用方完全感觉不到变化。
- `result = self._run(user_input)` 原来的 `run` 改名成了 `_run`,函数体一个字没动。
- `self._save(result, time.monotonic() - t0)` 第二个参数是这次运行用了多少秒。实测练习 4 第一个问题「北京现在多少度?」存下来是 `"seconds": 5.96`。
- `Path("runs").mkdir(exist_ok=True)` 建 `runs/` 目录,已经存在也不报错。相对路径,所以是在**当前工作目录**下建,这也是测试要 `chdir` 到临时目录的原因。
- `name = f"{datetime.now():%Y%m%d-%H%M%S-%f}_{r.status}.json"` f-string 里冒号后面是格式说明,`%f` 是微秒。实测文件名 `20261022-070535-229377_ok.json`、`20261022-070537-834478_max_steps.json`。带微秒是为了同一秒里跑完两次也不会撞名。
- `record = {` 要存的东西:结果的几个字段,加上完整的 `messages`。
- `"seconds": round(seconds, 2),` 保留两位小数,`5.9612...` 存成 `5.96`。
- `"messages": self.messages,` 完整轨迹。实测「北京现在多少度」那份有 5 条:system、user、assistant(调 get_weather)、tool(`"temperature": 4.5`)、assistant(最终回答)。撞线的那几份,倒数第二条是 `_wrap_up` 加的那句「系统提示」,最后一条是收尾得到的回答(`_wrap_up` 会把它也追加进 messages),日志里能直接看到 Agent 最后说了什么。
- `Path("runs", name).write_text(json.dumps(record, ensure_ascii=False, indent=2, default=str), encoding="utf-8")` `indent=2` 缩进方便人看;`default=str` 是保险:遇到 json 不认识的类型就转成字符串,不至于存日志时崩掉。

</div>

这样所有调用方(包括测试)都不用改,`run` 照旧返回 `AgentResult`,只是多了一个副作用。也正因为多了副作用,测试跑起来会往仓库里写 `runs/`。在 `test_robust_agent.py` 的 `reg = ToolRegistry()` 上面加一个自动生效的 fixture,让每个测试都在临时目录里跑(`import pytest` 放到文件顶部,和其他 import 放在一起,否则 Ruff 会提示 import 不在顶部):

```python
import pytest


@pytest.fixture(autouse=True)
def _run_in_tmp(tmp_path, monkeypatch):
    """run() 会写 runs/;测试时切到临时目录,不弄脏仓库。"""
    monkeypatch.chdir(tmp_path)
```

<div class="line-notes">

- `@pytest.fixture(autouse=True)` fixture 是 pytest 的「测试前准备」。`autouse=True` 表示这个文件里每个测试都自动套上它,不用在测试函数参数里写名字。
- `def _run_in_tmp(tmp_path, monkeypatch):` 参数名就是 pytest 内置 fixture 的名字,pytest 按名字自动注入:`tmp_path` 是每个测试独享的临时目录,`monkeypatch` 用来临时改环境,测试结束自动还原。
- `monkeypatch.chdir(tmp_path)` 把当前目录切到临时目录。`_save` 写的是相对路径 `runs/`,于是日志都落在临时目录里,测试结束 pytest 自己清理,仓库保持干净。

</div>

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

<div class="line-notes">

- `QUESTIONS = [` 十个问题,有一步就能答的、要好几步的、还有故意读不存在文件的,让结果分布里出现不同情况。
- `"读一下 notes.txt。",  # 不存在的文件` 实测 `read_file` 返回「文件不存在,workspace 里现有的文件: [...]」,模型照实告诉用户,`status` 是 `ok`。
- `for q in QUESTIONS:` 每个问题新建一个 Agent,互不影响。
- `r = RobustAgent(reg, SYSTEM, Limits(max_steps=2, max_tokens=6000)).run(q)` `max_steps=2` 是故意设紧的。这次实跑结果是 6 个 `max_steps`、4 个 `ok`。连「(37.5 - 12) * 4 等于多少?」都撞线了:翻日志发现模型第 2 步写出了 `= **102**`,却又附带调了一次一模一样的 calculate(第 2 次同样调用不算循环,照常执行),有 tool_calls 就不算结束,两步就用完了。
- `print(f"[{r.status:9}] steps={r.steps} {q}")` `:9` 是格式说明,把 status 补空格到 9 个字符宽,`ok` 和 `max_steps` 打出来是对齐的。实测前两行:<br>`[ok       ] steps=2 北京现在多少度?`<br>`[max_steps] steps=2 (37.5 - 12) * 4 等于多少?`

</div>

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
| tenacity | Python 重试库,用 `@retry(...)` 装饰器声明重试条件、等待策略和放弃条件 |
| 抖动(jitter) | 在等待时间上加随机量,避免大量客户端同时重试 |
| 惊群效应 | 大量客户端在同一时刻重试,把刚恢复的服务再次打垮 |
| 工具超时 | 单次工具执行的最长等待时间,超时后返回报错 |
| 线程池(ThreadPoolExecutor) | 预先建好的一组工作线程,`submit` 提交任务、拿回 `future`,`future.result(timeout=...)` 可以限时等待结果 |
| 幂等(idempotent) | 同一个操作执行多次和执行一次效果相同 |
| 循环检测 | 识别模型反复发出相同调用的机制 |
| 预算(budget) | 步数、token、时间三类上限,防止任务失控 |
| 优雅收尾(graceful degradation) | 撞线后禁用工具、基于已有信息给部分答案 |
| needs_human | 结果上的转人工标记,交给上游系统处理 |
| SimpleNamespace | 标准库里的空对象,传什么关键字参数就有什么属性,测试里用来随手造假响应 |
| lambda | 一行的匿名函数,`lambda x: x + 1` 相当于 JS 的 `(x) => x + 1` |
| time.monotonic() | 只增不减的计时器,用来算耗时(两次相减),不受系统改时间影响 |
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
