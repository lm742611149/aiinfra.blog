---
title: 'Day 195 · 第 28 周复习:工具与 Agent 循环(Day 189–194)'
description: '这一周从「Agent 为什么特别容易出事」走到「出事之后留下什么」。今天画一张知识地图,默写 LoopGuard 和最小主循环两段核心代码并用自检脚本验证,再做一个小项目:往 Agent 里随机注入六种故障,各跑 200 次,对比有没有防线。没防线 200 次里 111 次直接崩,答对 87 次;有防线答对 186 次,每个答对的任务从 ¥0.026 降到 ¥0.011(模拟的 token 账)。实验里还抓到两个意外:一个把 JSON 截断就读不出来的 policy,让有防线反而比没防线差;一个 0.05 秒的工具超时,在没有 429 时让成功率掉了 1.5 个百分点。'
pubDate: 2026-10-23
regime: none
tags: ['review', 'reliability', 'chaos', 'agent-zero']
series: 'agent-zero'
day: 195
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 194](/blog/agent-zero/day-194-failures-6/) 让 Agent 每次运行留下一行 JSON 日志:`TimedChat` 记每次模型调用的耗时和 token,`LoggedAgent` 覆盖 `_tool_step` 记每个工具调用,写盘前先脱敏截断,写失败不拖垮任务;`triage.py` 把一批日志按状态筛、按耗时排,再把一次运行摊成时间线。顺带抓到了一条会让 2 万字符文本卡 2.9 秒的邮箱正则。

这一周六课其实在回答同一个问题:**Agent 出事是常态,怎么让它出事时不崩、不烧钱、不乱说话、事后查得出来。** 今天停一天,把这条线理清楚,然后用本周的东西做一次「压力实验」:不再一个故障一个故障地手工构造,而是随机撒一把故障,批量跑,看防线整体上到底值多少。

## 今天要解决的问题

学完今天,你应该能:

1. 不看文章,用一张图说清本周九类失败各由哪个零件接住、是哪一天加的。
2. 合上文章默写 `LoopGuard.check` 和不带重试、超时、日志的最小主循环 `run_loop`,并用自检脚本跑通。
3. 读懂 `chaos.py`:一个确定性的「模型」、六种故障注入、两种做法对比;能解释结果里每一行的原因,包括两个意外。
4. 说出本周每一个坑的现象和修法。

预计用时 3.5 小时:默写两段各 40 分钟,小项目 1 小时,剩下做练习和自测。前置:[Day 189](/blog/agent-zero/day-189-failures-1/) 到 [Day 194](/blog/agent-zero/day-194-failures-6/) 全部,代码在 `agent-zero-lab/part03/` 和 `tests/`,命令都在 `agent-zero-lab/` 根目录跑。今天**不调真模型**,实跑花费 ¥0:小项目里的「模型」是我写的规则程序,token 是按字符数估的,文中出现的 ¥ 都是模拟的账,只用来比较两种做法。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `LoopGuard.check`、`run_loop` 和 `PolicyLLM._progress` 再默写一遍;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 本周知识地图

先把九类失败和六天内容放在同一张图上。上排是六天各做了什么,下排是它接住的失败类;灰色虚线框那一类(3、4、5)不是本周新写的,是 Day 170 注册表早就接住的。

<figure>
<svg viewBox="0 0 640 340" role="img" aria-label="第 28 周知识地图:六天各做一件事,对应九类失败:189 分类、190 重试治第 1 类、191 超时截断治第 2 和 7 类、192 循环检测和预算收尾治第 6、8、9 类、193 拼装和离线测试、194 日志">
  <rect x="0" y="0" width="640" height="340" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">六天,六件事</text>
  <rect x="14" y="40" width="96" height="62" fill="var(--paper)" stroke="var(--ink-soft)" rx="4"/>
  <text x="62" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">189 分类</text>
  <text x="62" y="78" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">三层九类</text>
  <text x="62" y="92" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">只接住 3 类</text>
  <rect x="116" y="40" width="96" height="62" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="164" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">190 重试</text>
  <text x="164" y="78" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">tenacity 四参数</text>
  <text x="164" y="92" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">治第 1 类</text>
  <rect x="218" y="40" width="96" height="62" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="266" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">191 超时截断</text>
  <text x="266" y="78" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">线程池 + 提示</text>
  <text x="266" y="92" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">治第 2、7 类</text>
  <rect x="320" y="40" width="96" height="62" fill="var(--paper)" stroke="var(--ink)" rx="4"/>
  <text x="368" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">192 循环预算</text>
  <text x="368" y="78" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">指纹 + 三预算</text>
  <text x="368" y="92" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">治第 6、8、9 类</text>
  <rect x="422" y="40" width="96" height="62" fill="var(--paper)" stroke="var(--ink-soft)" rx="4"/>
  <text x="470" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">193 拼装测试</text>
  <text x="470" y="78" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">FakeClient</text>
  <text x="470" y="92" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">llm_error + 记账</text>
  <rect x="524" y="40" width="102" height="62" fill="var(--paper)" stroke="var(--ink-soft)" rx="4"/>
  <text x="575" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">194 日志</text>
  <text x="575" y="78" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">JSON Lines</text>
  <text x="575" y="92" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">事后查得出来</text>
  <text x="20" y="140" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">九类失败,谁接住</text>
  <rect x="14" y="152" width="200" height="62" fill="var(--paper)" stroke="var(--rule)" rx="4"/>
  <text x="114" y="172" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">基础设施层</text>
  <text x="114" y="190" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">1 API 临时错误 → 190 重试</text>
  <text x="114" y="204" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">2 工具卡住 → 191 超时</text>
  <rect x="226" y="152" width="200" height="62" fill="var(--paper)" stroke="var(--rule)" rx="4"/>
  <text x="326" y="172" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">模型行为层</text>
  <text x="326" y="190" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">6 重复调用 → 192 指纹</text>
  <text x="326" y="204" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">4、5 → 注册表本来就接住</text>
  <rect x="438" y="152" width="188" height="62" fill="var(--paper)" stroke="var(--rule)" rx="4"/>
  <text x="532" y="172" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">任务层</text>
  <text x="532" y="190" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">7 结果过长 → 191 截断</text>
  <text x="532" y="204" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">8、9 → 192 预算和收尾</text>
  <rect x="14" y="236" width="612" height="46" fill="none" stroke="var(--ink-soft)" stroke-dasharray="6 4" rx="4"/>
  <text x="320" y="256" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">3 工具抛异常 · 4 参数不是合法 JSON · 5 调了不存在的工具</text>
  <text x="320" y="272" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">Day 170 注册表的 try/except 早就接住了,本周没有新零件</text>
  <text x="320" y="312" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">还有一类图上没有:看起来成功的失败(status=ok,答案是假的),靠评测,不靠防线</text>
</svg>
<figcaption>九类失败的责任表。三层之间的分工:基础设施问题靠重试和超时,模型的行为问题靠检测和预算,任务本身的问题靠截断和收尾。</figcaption>
</figure>

一句话概括这一周:**Agent 的每一次外部调用(模型、工具)都可能失败或变慢,每一次循环都可能不收敛;失败要被接住并变成「状态」,不要变成异常或沉默;防线要能被离线测试证明有效;出事之后要查得出来。**

## 本周每天一句话

- [Day 189](/blog/agent-zero/day-189-failures-1/) 单步靠谱 95%,十步全对只有 60% 左右;把失败分成基础设施、模型行为、任务三层九类,拿 Day 170 的 `run_agent` 挨个撞,只接住工具抛异常、参数不是合法 JSON、幻觉工具三类;最难缠的是「看起来成功的失败」。
- [Day 190](/blog/agent-zero/day-190-failures-2/) 只有 429、5xx、连接错误这类「过一会儿会好」的错才重试,等待用指数退避加抖动,tenacity 四个参数 `retry/wait/stop/reraise`;SDK 自带重试和 tenacity 叠加会放大成 12 次请求;写操作重试要靠幂等键。
- [Day 191](/blog/agent-zero/day-191-failures-3/) 工具超时用线程池 `future.result(timeout)`,但超时不等于没做,线程杀不掉、写操作会在后台完成;过长的结果截断并告诉模型被截了,不过工具自己支持过滤分页才是正解。
- [Day 192](/blog/agent-zero/day-192-failures-4/) 工具名加规范化后的参数算指纹,同一个调用第三次拦下、拦过还来就收尾;步数、token、时间三种预算每步调模型前检查一次;撞线时禁用工具、让模型用已有信息给部分答案。
- [Day 193](/blog/agent-zero/day-193-failures-5/) 把四个零件拼成 `RobustAgent`,补上收尾 token 记账和 `llm_error`;用按剧本演戏的 `FakeClient` 写 5 个离线测试,再用「改坏被测代码」检验测试有没有用。
- [Day 194](/blog/agent-zero/day-194-failures-6/) 每次运行一行 JSON(JSON Lines),记每一步的耗时、token、结果大小;写盘前脱敏截断,写失败不拖垮任务;`triage.py` 按状态筛、按耗时排、摊时间线;日志还能重放成回归测试。

## 默写一:`LoopGuard.check`

先合上文章,在 `agent-zero-lab/part03/my_loop_guard.py` 里写一个 `LoopGuard` 类:`__init__(max_repeats=2)`、`check(name, arguments) -> "run" | "block" | "stop"`。要求:同名同参数算同一个调用(参数里空格不同、键顺序不同也算),前 `max_repeats` 次放行,下一次拦下,再下一次起收尾;参数不是合法 JSON 不能崩。写完用自检脚本:

```bash
uv run python -m part03.check_dictation part03.my_loop_guard
```

做不出来再看参考答案(`part03/dictation_loop_guard.py`):

```python
# agent-zero-lab/part03/dictation_loop_guard.py  Day 195 默写一的参考答案:LoopGuard
import hashlib
import json


class LoopGuard:
    def __init__(self, max_repeats: int = 2) -> None:
        self.max_repeats = max_repeats
        self.seen: dict[str, int] = {}

    def check(self, name: str, arguments: str) -> str:
        try:
            args = json.dumps(json.loads(arguments), sort_keys=True, ensure_ascii=False)
        except json.JSONDecodeError:
            args = arguments
        key = hashlib.md5(f"{name}:{args}".encode()).hexdigest()
        self.seen[key] = self.seen.get(key, 0) + 1
        n = self.seen[key]
        if n <= self.max_repeats:
            return "run"
        return "block" if n == self.max_repeats + 1 else "stop"
```

<div class="line-notes">

- `import hashlib` 标准库的哈希模块,指纹用它。
- `self.seen: dict[str, int] = {}` 指纹到出现次数的字典,相当于 JS 的 `Map<string, number>`。
- `args = json.dumps(json.loads(arguments), sort_keys=True, ensure_ascii=False)` 规范化:解析再写回,空格统一、键排序。`{"city": "杭州"}` 和 `{"city":"杭州"}` 都变成 `{"city": "杭州"}`。
- `except json.JSONDecodeError:` 模型给出的不是合法 JSON,比如 `{杭州}`,就按原字符串算,不能因为算指纹把程序弄崩。
- `key = hashlib.md5(f"{name}:{args}".encode()).hexdigest()` 工具名和规范化参数拼起来算 md5。`.encode()` 把字符串转成字节,md5 只吃字节。
- `self.seen[key] = self.seen.get(key, 0) + 1` 没有这个 key 就当 0,加一。
- `if n <= self.max_repeats:` `max_repeats=2` 时第 1、2 次放行。写成 `<` 是最常见的默写错误,会少放行一次。
- `return "block" if n == self.max_repeats + 1 else "stop"` 第 3 次拦,第 4 次起收尾。

</div>

我故意写了一个错的版本 `part03/dictation_wrong.py`,把 `n <= self.max_repeats` 写成 `n < self.max_repeats`,看自检脚本怎么报:

```bash
uv run python -m part03.check_dictation part03.dictation_wrong
```

```text
LoopGuard:
  失败  前两次 run、第 3 次 block、第 4 次 stop(第 2 次少个空格,也算同一个)  (['run', 'stop', 'block', 'stop'])
  失败  键的顺序不同也算同一个调用  (['stop', 'block'])
  失败  换了参数就是新调用  (['stop', 'stop'])
  通过  参数不是合法 JSON 也不崩
run_loop:
  通过  正常结束:ok、2 步、账 240
  失败  循环:loop、4 步、转人工、答案是收尾那句  (AgentResult(answer='抱歉,这个问题暂时没能处理完,已转给人工同事跟进。', status='loop', steps=2, usage={'prompt_tokens': 200, 'completion_tokens': 40}, needs_human=True, error=''))
  通过  收尾那次禁用了工具
  失败  收尾那次的 token 记进了账(5 次调用 = 600)  ({'prompt_tokens': 200, 'completion_tokens': 40})
  通过  步数撞线:max_steps、转人工

5 项没过:['前两次 run、第 3 次 block、第 4 次 stop(第 2 次少个空格,也算同一个)', '键的顺序不同也算同一个调用', '换了参数就是新调用', '循环:loop、4 步、转人工、答案是收尾那句', '收尾那次的 token 记进了账(5 次调用 = 600)']
```

一处差一位,前三项全红:`max_repeats=2` 时第 2 次就被判成 `stop`,第 3 次反而是 `block`。后面 `run_loop` 那一项里还有一个红,是我同时让 `wrap_up` 忘了记账(参考答案里 `wrap_up(..., usage)` 的最后一个参数),自检脚本抓到的是「5 次调用应该是 600 token、实际只有 240」。默写时最常错的就是这两类:边界差一位,以及忘了把一个参数传下去。

## 默写二:最小主循环 `run_loop`

第二段更长,写在 `part03/my_run_loop.py`:`run_loop(llm, registry, system, user, limits) -> AgentResult`。没有重试(`llm` 直接是 `chat`)、没有工具超时、没有日志,只有本周的核心骨架:每步调模型前查预算;调模型,累计 token;没有工具调用就是最终回答;有就过 `LoopGuard`,`run` 才执行、其他回提醒;一步里有 `stop` 就收尾;撞线也收尾;**收尾的 token 要记账,被拦的调用也要回 tool 消息。** 你可以导入前几天的零件(`over_budget`、`wrap_up`、`LOOP_MSG`)和刚默写的 `LoopGuard`。

```bash
uv run python -m part03.check_dictation part03.my_run_loop
```

参考答案(`part03/dictation_run_loop.py`):

```python
# agent-zero-lab/part03/dictation_run_loop.py  Day 195 默写二的参考答案:不带重试、超时、日志的最小主循环
import time
from typing import Any

from part03.agent_loop import ToolRegistry
from part03.budget import AgentResult, Limits, over_budget, wrap_up
from part03.dictation_loop_guard import LoopGuard
from part03.loop_guard import LOOP_MSG
from part03.retry_llm import SupportsChat


def run_loop(llm: SupportsChat, registry: ToolRegistry, system: str, user: str, limits: Limits) -> AgentResult:
    guard = LoopGuard(limits.max_repeats)
    messages: list[dict[str, Any]] = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    usage = {"prompt_tokens": 0, "completion_tokens": 0}
    start = time.monotonic()
    step = 0
    while True:
        step += 1
        hit = over_budget(limits, step, sum(usage.values()), time.monotonic() - start)
        if hit:
            status, reason = hit
            return AgentResult(wrap_up(llm, messages, registry.schemas, reason, usage), status, step - 1, dict(usage), True)
        r = llm.chat(messages, tools=registry.schemas)
        usage["prompt_tokens"] += r.prompt_tokens
        usage["completion_tokens"] += r.completion_tokens
        messages.append(r.message)
        calls = r.message.get("tool_calls") or []
        if not calls:
            return AgentResult(r.content, "ok", step, dict(usage))
        stop = False
        for tc in calls:
            name, args = tc["function"]["name"], tc["function"]["arguments"]
            verdict = guard.check(name, args)
            out = registry.call(name, args) if verdict == "run" else LOOP_MSG
            stop = stop or verdict == "stop"
            messages.append({"role": "tool", "tool_call_id": tc["id"], "content": out})
        if stop:
            answer = wrap_up(llm, messages, registry.schemas, "检测到重复调用,任务可能陷入了循环", usage)
            return AgentResult(answer, "loop", step, dict(usage), True)
```

<div class="line-notes">

- `from part03.budget import AgentResult, Limits, over_budget, wrap_up` Day 192 和 193 的零件:带状态的返回值、六个阈值、预算判断、收尾。
- `from part03.dictation_loop_guard import LoopGuard` 导入默写一的 `LoopGuard`。你自己的版本导入你自己的那个就行。
- `def run_loop(llm: SupportsChat, registry: ToolRegistry, system: str, user: str, limits: Limits) -> AgentResult:` `llm` 是协议类型,真的 `LLMClient` 和 `FakeClient` 都能传,自检脚本传的就是 `FakeClient`。
- `guard = LoopGuard(limits.max_repeats)` 每次运行一个新的。
- `messages: list[dict[str, Any]] = [{"role": "system", "content": system}, {"role": "user", "content": user}]` 历史从 system 和 user 开始。
- `usage = {"prompt_tokens": 0, "completion_tokens": 0}` 本次任务的账,`wrap_up` 也往里加。
- `start = time.monotonic()` 掐表,只往前走的时钟。
- `hit = over_budget(limits, step, sum(usage.values()), time.monotonic() - start)` 每步调模型之前问一句。
- `return AgentResult(wrap_up(llm, messages, registry.schemas, reason, usage), status, step - 1, dict(usage), True)` 撞线:先收尾(记账),再把 `usage` 复制进结果;步数写 `step - 1`,因为第 `step` 步没走。
- `usage["prompt_tokens"] += r.prompt_tokens` 调用成功才累加。
- `messages.append(r.message)` 模型的回复(含 `tool_calls`)要进历史。
- `if not calls:` 没有工具调用就是最终回答,`status="ok"`。
- `out = registry.call(name, args) if verdict == "run" else LOOP_MSG` `run` 才执行,`block` 和 `stop` 都回那句提醒。
- `stop = stop or verdict == "stop"` 一步里多个调用,有一个是 `stop` 就要收尾,但先把这一步所有调用都回完。
- `messages.append({"role": "tool", "tool_call_id": tc["id"], "content": out})` 每个调用都要有回复,id 要对上。
- `if stop:` 这一步的调用全回完之后再收尾。
- `return AgentResult(answer, "loop", step, dict(usage), True)` 循环收尾,状态 `loop`,转人工。

</div>

```text
  通过  正常结束:ok、2 步、账 240
  通过  循环:loop、4 步、转人工、答案是收尾那句
  通过  收尾那次禁用了工具
  通过  收尾那次的 token 记进了账(5 次调用 = 600)
  通过  步数撞线:max_steps、转人工

全部通过
```

默写如果不通过,先看是哪一项红,再对着参考答案找那一段,别整个重抄。

## 小项目:往 Agent 里撒一把故障

### 想法

前五天每个防线都是「构造一个故障,看它被接住」。这样能证明防线**能**起作用,但回答不了另一个问题:**撒一把随机的、混在一起的故障,整体上值多少?** 哪些故障最常见、哪些防线贡献最大、有没有防线反而添乱。这个思路叫**故障注入**(fault injection),Netflix 的 Chaos Monkey 把它做成了随机关掉生产环境里的服务器,今天是它的玩具版。

设计分四块:

1. **一个确定性的「模型」`PolicyLLM`**:任务是「查若干城市的天气」,它读历史、查没查到的城市,查完就回答。因为是规则程序,所以每次运行结果可复现、不花钱,而且会被故障搅乱(比如读不到结果就重查,最多 3 次)。
2. **六种故障**:模型层(429、401、卡住重复同一个调用),工具层(抛异常、卡住 0.2 秒、返回 3 万字符垃圾)。每种有发生概率,用固定种子的随机数决定,两种做法碰上完全相同的随机序列。
3. **两种做法**:`plain` 是 Day 170 的 `run_agent`(没防线);`robust` 是 `RobustAgent`(有防线,工具超时设 0.05 秒)。
4. **一把尺**:答案里每个城市的温度都对才算「答对」,对一部分算「部分」,其他算「没信息」。

### 代码

```python
# agent-zero-lab/part03/chaos.py  Day 195:往 Agent 里随机注入故障,批量跑,对比「没防线」和「有防线」
import contextlib
import io
import json
import random
import re
import time
from dataclasses import dataclass, field
from typing import Any

from common.llm import ChatResult
from part03 import agent_loop
from part03.agent_loop import ToolRegistry, run_agent
from part03.budget import Limits
from part03.fake_client import fake_http_error
from part03.retry_llm import chat_with_retry
from part03.robust_agent import RobustAgent

CITIES = ["杭州", "上海", "北京", "广州", "深圳", "成都", "武汉", "西安", "南京", "苏州", "宁波", "合肥"]
TEMPS = {c: 10 + i for i, c in enumerate(CITIES)}  # 每个城市一个固定温度,答案可以核对
PRICE_IN, PRICE_OUT = 2.0, 8.0  # 元每百万 token,和 .env 里的 LLM_PRICE 未命中价一致


@dataclass
class Faults:
    """每一种故障的发生概率。model 开头的是模型服务/模型本身,tool 开头的是工具。"""
    model_429: float = 0.10  # 每次调模型,有这么大概率先收到一个 429
    model_401: float = 0.002  # 每次调模型,有这么大概率 key 失效(永久错误)
    model_stuck: float = 0.04  # 每次运行,有这么大概率模型卡在重复同一个调用上
    tool_error: float = 0.05  # 每次调工具,抛 ConnectionError
    tool_hang: float = 0.03  # 每次调工具,卡住 0.2 秒(Agent 的工具超时设 0.05 秒)
    tool_huge: float = 0.03  # 每次调工具,返回 3 万字符的垃圾


@dataclass
class Run:
    cities: list[str]
    seed: int
    injected: list[str] = field(default_factory=list)  # 这次运行里真的发生了哪些故障


class PolicyLLM:
    """一个确定性的「模型」:任务是查若干城市的天气,查完回答。会读历史,所以能被故障搅乱。同时按 faults 注入模型层故障。"""

    def __init__(self, run: Run, faults: Faults, rng: random.Random) -> None:
        self.run, self.faults, self.rng = run, faults, rng
        self.stuck = rng.random() < faults.model_stuck
        if self.stuck:
            run.injected.append("model_stuck")
        self.prompt_tokens = self.completion_tokens = 0
        self.calls = 0

    def chat(self, messages: list[dict[str, Any]], **kw: Any) -> ChatResult:
        self.calls += 1
        if self.rng.random() < self.faults.model_401:
            self.run.injected.append("model_401")
            raise fake_http_error(401)
        if self.rng.random() < self.faults.model_429:
            self.run.injected.append("model_429")
            raise fake_http_error(429)
        prompt = len(json.dumps(messages, ensure_ascii=False)) // 2  # 粗估:两个字符一个 token
        done, tries = self._progress(messages)
        todo = [c for c in self.run.cities if c not in done and tries.get(c, 0) < 3]
        if kw.get("tool_choice") == "none" or not todo:
            got = "、".join(f"{c}{done[c]}度" for c in self.run.cities if c in done)
            missing = [c for c in self.run.cities if c not in done]
            text = f"查到:{got}。" + (f"没查到:{'、'.join(missing)}。" if missing else "")
            message: dict[str, Any] = {"role": "assistant", "content": text}
        else:
            city = todo[0] if not self.stuck else self.run.cities[0]  # 卡住的模型永远只查第一个城市
            args = json.dumps({"city": city}, ensure_ascii=False)
            call = {"id": f"call_{self.calls}", "type": "function", "function": {"name": "get_weather", "arguments": args}}
            message = {"role": "assistant", "content": "", "tool_calls": [call]}
        self.prompt_tokens += prompt
        self.completion_tokens += 30
        return ChatResult(content=message["content"], reasoning=None, finish_reason="stop", message=message,
                          prompt_tokens=prompt, completion_tokens=30)

    @staticmethod
    def _progress(messages: list[dict[str, Any]]) -> tuple[dict[str, int], dict[str, int]]:
        """从历史里读出:哪些城市已经查到了温度,每个城市已经试过几次。"""
        done: dict[str, int] = {}
        tries: dict[str, int] = {}
        asked: dict[str, str] = {}  # tool_call_id -> 城市
        for m in messages:
            for tc in m.get("tool_calls", []) if m["role"] == "assistant" else []:
                city = json.loads(tc["function"]["arguments"])["city"]
                asked[tc["id"]] = city
                tries[city] = tries.get(city, 0) + 1
            if m["role"] == "tool" and m["tool_call_id"] in asked:
                found = re.search(r'"temp": (-?\d+)', m["content"])  # 像真模型一样「读文字」,结果被截断了也读得到开头的温度
                if found:
                    done[asked[m["tool_call_id"]]] = int(found.group(1))
        return done, tries


def make_registry(run: Run, faults: Faults, rng: random.Random) -> ToolRegistry:
    reg = ToolRegistry()

    @reg.tool
    def get_weather(city: str) -> dict[str, Any]:
        """查一个城市今天的气温。"""
        roll = rng.random()
        if roll < faults.tool_error:
            run.injected.append("tool_error")
            raise ConnectionError("upstream reset by peer")
        if roll < faults.tool_error + faults.tool_hang:
            run.injected.append("tool_hang")
            time.sleep(0.2)
        elif roll < faults.tool_error + faults.tool_hang + faults.tool_huge:
            run.injected.append("tool_huge")
            return {"city": city, "temp": TEMPS[city], "debug": "x" * 30_000}
        return {"city": city, "temp": TEMPS[city]}

    return reg


def grade(run: Run, answer: str) -> str:
    """答案里是不是每个城市的温度都对:对 = full,只有一部分 = partial,别的 = none。"""
    right = [c for c in run.cities if f"{c}{TEMPS[c]}度" in answer]
    return "full" if len(right) == len(run.cities) else "partial" if right else "none"


def one_run(variant: str, seed: int, faults: Faults, llm_cls: type[PolicyLLM] = PolicyLLM) -> dict[str, Any]:
    rng_task = random.Random(seed)
    run = Run(cities=rng_task.sample(CITIES, rng_task.randint(3, 8)), seed=seed)
    llm = llm_cls(run, faults, random.Random(seed + 1))
    reg = make_registry(run, faults, random.Random(seed + 2))
    start = time.perf_counter()
    status, answer = "ok", ""
    task = f"查这些城市的天气:{'、'.join(run.cities)}。"
    if variant == "plain":
        agent_loop.LLMClient = lambda: llm  # type: ignore[assignment,misc]  # 换成注入了故障的模型
        try:
            with contextlib.redirect_stdout(io.StringIO()):  # run_agent 每步都 print,批量跑时不要
                answer, _ = run_agent(reg, "你是助手。", task, max_steps=10)
            if answer.startswith("到了最大步数"):
                status = "max_steps_msg"
        except Exception as e:
            status, answer = "crash", type(e).__name__
    else:
        result = RobustAgent(reg, "你是助手。", Limits(max_steps=10, tool_timeout=0.05), llm=llm, verbose=False).run(task)
        status, answer = result.status, result.answer
    return {"seed": seed, "status": status, "grade": grade(run, answer), "injected": run.injected,
            "tokens_in": llm.prompt_tokens, "tokens_out": llm.completion_tokens,
            "seconds": time.perf_counter() - start}


def batch(variant: str, n: int, faults: Faults, base_seed: int = 1000,
          llm_cls: type[PolicyLLM] = PolicyLLM) -> list[dict[str, Any]]:
    chat_with_retry.retry.sleep = lambda s: None  # type: ignore[method-assign]  # 重试的等待不真睡,批量跑才快
    return [one_run(variant, base_seed + i, faults, llm_cls) for i in range(n)]


def report(name: str, rows: list[dict[str, Any]]) -> None:
    n = len(rows)
    by_status: dict[str, int] = {}
    for r in rows:
        by_status[r["status"]] = by_status.get(r["status"], 0) + 1
    full = sum(r["grade"] == "full" for r in rows)
    partial = sum(r["grade"] == "partial" for r in rows)
    cost = sum(r["tokens_in"] * PRICE_IN + r["tokens_out"] * PRICE_OUT for r in rows) / 1_000_000
    print(f"{name:8} 答对 {full:3d} | 部分 {partial:3d} | 没信息 {n - full - partial:3d} | "
          f"花费 ¥{cost:.3f} | 平均输入 {sum(r['tokens_in'] for r in rows) // n} tok | 耗时 {sum(r['seconds'] for r in rows):.1f}s")
    print(f"{'':8} 状态分布 {dict(sorted(by_status.items(), key=lambda kv: -kv[1]))}")
    print(f"{'':8} 每个答对的任务平均花 ¥{cost / max(full, 1):.4f}")


def by_fault(rows: list[dict[str, Any]]) -> dict[str, tuple[int, int]]:
    """每一种故障:(碰上它的运行数, 其中答对的运行数)。一次运行可以同时碰上好几种,各算一次。"""
    table: dict[str, tuple[int, int]] = {}
    for r in rows:
        for kind in set(r["injected"]):
            seen, ok = table.get(kind, (0, 0))
            table[kind] = (seen + 1, ok + (r["grade"] == "full"))
    return table


if __name__ == "__main__":
    N = 200
    results = {}
    for variant, name in (("plain", "没防线"), ("robust", "有防线")):
        results[variant] = batch(variant, N, Faults())
        report(name, results[variant])
    print("\n碰上某种故障的运行里,答对的比例(碰上的运行数):")
    plain, robust = by_fault(results["plain"]), by_fault(results["robust"])
    for kind in sorted(set(plain) | set(robust)):
        (n1, ok1), (n2, ok2) = plain.get(kind, (0, 0)), robust.get(kind, (0, 0))
        print(f"  {kind:11} 没防线 {ok1 / max(n1, 1):4.0%}({n1:3d}) | 有防线 {ok2 / max(n2, 1):4.0%}({n2:3d})")
```

<div class="line-notes">

- `import contextlib` 和 `import io` 批量跑时 `run_agent` 每步都 `print`,200 次会刷满终端,用它们把输出临时吞掉。
- `from dataclasses import dataclass, field` [Day 50](/blog/agent-zero/day-050-dataclass/) 的 dataclass,故障概率和一次运行的记录都用它。
- `from part03 import agent_loop` 要导入模块本身,才能改它上面的 `LLMClient` 这个名字(Day 189 的 monkeypatch 做法)。
- `from part03.fake_client import fake_http_error` Day 193 的造 HTTP 错误的小工具,模拟 429 和 401。
- `from part03.retry_llm import chat_with_retry` 后面要把重试的 `sleep` 换成空函数,批量跑才不会真等。
- `CITIES = [` 12 个城市。`TEMPS = {c: 10 + i for i, c in enumerate(CITIES)}` 字典推导式:每个城市一个固定温度,杭州 10、上海 11,一直到合肥 21。答案能核对,就是靠这个。
- `PRICE_IN, PRICE_OUT = 2.0, 8.0  # 元每百万 token` 输入 2 元、输出 8 元,和 `.env` 里 DeepSeek 的未命中价一致。这里的 token 是估的,所以算出来的钱是模拟账。
- `class Faults:` 六种故障的概率集中放一个 dataclass。想调某一个,`Faults(model_429=0.3)` 只改它,其余用默认。
- `model_429: float = 0.10  # 每次调模型,有这么大概率先收到一个 429` 每次调用独立地 10%。一次任务要调五六次模型,所以任务里碰上至少一次 429 的概率超过一半。
- `model_stuck: float = 0.04  # 每次运行,有这么大概率模型卡在重复同一个调用上` 注意这个是**每次运行**一次的判定,不是每次调用。
- `tool_hang: float = 0.03  # 每次调工具,卡住 0.2 秒(Agent 的工具超时设 0.05 秒)` 0.2 秒不算久,为的是批量跑得快;重要的是它比超时长。
- `class Run:` 一次运行的任务描述:要查哪些城市、随机种子、以及运行中真的发生了哪些故障(`injected`),最后按故障分组统计要用。
- `injected: list[str] = field(default_factory=list)` 可变默认值要用 `default_factory`,Day 192 讲过。
- `class PolicyLLM:` 假「模型」。有 `chat` 方法、返回 `ChatResult`,所以能当 `SupportsChat` 用。
- `self.stuck = rng.random() < faults.model_stuck` 运行一开始就决定这次是不是「卡住」的运行。
- `self.rng.random() < self.faults.model_401` 每次被调用先掷骰子:401 优先,其次 429。抛的是 Day 193 的 `fake_http_error`,和真 SDK 抛的一模一样,所以重试逻辑会真的运行。
- `prompt = len(json.dumps(messages, ensure_ascii=False)) // 2  # 粗估:两个字符一个 token` 输入 token 按历史长度估。历史里有 3 万字符垃圾时,这一项就大了,这是「垃圾结果让之后每一步都变贵」的体现。
- `done, tries = self._progress(messages)` 从历史里读出已经查到哪些城市、每个城市试过几次。
- `todo = [c for c in self.run.cities if c not in done and tries.get(c, 0) < 3]` 还没查到、且试过不到 3 次的城市。试满 3 次还不行就放弃,这是 policy 自己的规则,不是防线。
- `if kw.get("tool_choice") == "none" or not todo:` 收尾那次(`tool_choice="none"`)或者没有要查的城市了,就回答。
- `text = f"查到:{got}。" + (f"没查到:{'、'.join(missing)}。" if missing else "")` 回答里写「杭州10度」这样的格式,`grade` 靠它核对。收尾那次拿到的是部分答案,同样的格式,只是后面多一句「没查到」。
- `city = todo[0] if not self.stuck else self.run.cities[0]  # 卡住的模型永远只查第一个城市` 卡住的运行里,模型永远发同一个调用,不管查没查到。这就是第 6 类故障。
- `def _progress(` 静态方法:读历史。
- `for tc in m.get("tool_calls", []) if m["role"] == "assistant" else []:` 只在 assistant 消息里找工具调用。`for ... in A if 条件 else B` 是条件表达式做迭代对象。
- `asked[tc["id"]] = city` 记下每个 `tool_call_id` 对应哪个城市,后面 tool 消息只带 id。
- `found = re.search(r'"temp": (-?\d+)', m["content"])` 用正则从工具结果文字里找温度。这一行是第二版,下面「两个意外」会讲为什么要这样读。
- `def make_registry(run: Run, faults: Faults, rng: random.Random) -> ToolRegistry:` 每次运行建一张新的工具表,里面只有一个 `get_weather`,按概率出故障。
- `roll = rng.random()` 一次掷骰子决定这次调用出什么故障,三种故障的概率区间首尾相接(0 到 5% 报错,5% 到 8% 卡住,8% 到 11% 垃圾),互斥。
- `raise ConnectionError("upstream reset by peer")` 抛异常,注册表的 `call` 会把它变成 `{"error": ...}`。
- `time.sleep(0.2)` 卡住,之后还是正常返回结果,所以**没有超时的做法能等到它,有超时的做法等不到**。
- `return {"city": city, "temp": TEMPS[city], "debug": "x" * 30_000}` 垃圾:温度在最前面,后面跟 3 万个 `x`。
- `def grade(run: Run, answer: str) -> str:` 阅卷:答案字符串里有没有「杭州10度」这样的片段。
- `right = [c for c in run.cities if f"{c}{TEMPS[c]}度" in answer]` 答对的城市。
- `def one_run(variant: str, seed: int, faults: Faults, llm_cls: type[PolicyLLM] = PolicyLLM) -> dict[str, Any]:` 跑一次。`llm_cls` 让练习 2 能换一个子类。
- `rng_task = random.Random(seed)` 每次运行自己一个随机数发生器,种子固定,所以同一个 `seed` 两种做法要查的城市完全相同。
- `run = Run(cities=rng_task.sample(CITIES, rng_task.randint(3, 8)), seed=seed)` 随机挑 3 到 8 个城市。
- `llm = llm_cls(run, faults, random.Random(seed + 1))` 模型层故障用 `seed + 1`,工具层用 `seed + 2`,三套随机互不干扰。
- `agent_loop.LLMClient = lambda: llm  # type: ignore[assignment,misc]` 让 `run_agent` 里 new 出来的模型就是 `llm`。
- `with contextlib.redirect_stdout(io.StringIO()):` 在这个 `with` 里 `print` 的内容全扔进一个内存里的假文件。
- `if answer.startswith("到了最大步数"):` Day 170 的 `run_agent` 撞线只回这一句,识别出来标成 `max_steps_msg`。
- `except Exception as e:` 下一行 `status, answer = "crash", type(e).__name__`:没防线的做法碰上异常就是崩,记下异常类名。
- `RobustAgent(reg, "你是助手。", Limits(max_steps=10, tool_timeout=0.05), llm=llm, verbose=False).run(task)` 有防线的做法:和 `run_agent` 一样给 10 步,工具超时 0.05 秒。
- `chat_with_retry.retry.sleep = lambda s: None  # type: ignore[method-assign]` 重试的等待换成空函数,不然 200 次运行里的几百次重试要真睡几分钟。重试的**次数**和**逻辑**还是真的。
- `def report(name: str, rows: list[dict[str, Any]]) -> None:` 打印汇总:答对、部分、没信息、花费、平均输入 token、耗时、状态分布、每个答对的任务平均花多少钱。
- `cost = sum(r["tokens_in"] * PRICE_IN + r["tokens_out"] * PRICE_OUT for r in rows) / 1_000_000` 总花费(元)。
- `def by_fault(` 每种故障:碰上它的运行有几次、其中答对几次。一次运行可以同时碰上好几种,每种各算一次。
- `for kind in set(r["injected"]):` `set` 去重:一次运行里同一种故障发生了好几次,只算一次「碰上过」。
- `table[kind] = (seen + 1, ok + (r["grade"] == "full"))` 布尔值加整数,`True` 当 1。
- `results[variant] = batch(variant, N, Faults())` 两种做法各 200 次,用同一个默认故障概率和同一组种子。

</div>

```bash
uv run python -m part03.chaos
```

```text
没防线      答对  87 | 部分   0 | 没信息 113 | 花费 ¥2.245 | 平均输入 5089 tok | 耗时 2.6s
         状态分布 {'crash': 111, 'ok': 87, 'max_steps_msg': 2}
         每个答对的任务平均花 ¥0.0258
有防线      答对 186 | 部分  10 | 没信息   4 | 花费 ¥2.079 | 平均输入 4387 tok | 耗时 2.2s
         状态分布 {'ok': 185, 'loop': 6, 'max_steps': 5, 'llm_error': 4}
         每个答对的任务平均花 ¥0.0112

碰上某种故障的运行里,答对的比例(碰上的运行数):
  model_401   没防线   0%(  2) | 有防线   0%(  4)
  model_429   没防线   0%(109) | 有防线  93%(107)
  model_stuck 没防线   0%(  6) | 有防线   0%(  6)
  tool_error  没防线  43%( 37) | 有防线  92%( 53)
  tool_hang   没防线  75%( 12) | 有防线  90%( 20)
  tool_huge   没防线  65%( 17) | 有防线 100%( 33)
```

### 读结果

先说结论,再说两个意外。

**没防线:200 次里 111 次直接崩(`crash`),答对 87 次。** 崩的原因绝大部分是 429:每次调模型有 10% 的概率收到 429,一次任务要调五六次模型,碰上 429 的运行有 109 次,没防线时这 109 次**一次都没答对**(表里 `model_429 没防线 0%`),因为异常一路冒出去,整个任务没了。

**有防线:答对 186 次,只有 4 次没有任何信息。** 碰上 429 的 107 次里答对了 93%,因为 `chat_with_retry` 把它们接住了。四次「没信息」都是 `llm_error`,是 401(key 失效)那种不重试的永久错误,重试救不了。

**钱:每个答对的任务从 ¥0.0258 降到 ¥0.0112,不到一半。** 注意这是模拟的账。总花费看着差不多(¥2.245 对 ¥2.079),因为没防线那边有 111 次提前崩了,没花完整的钱;如果按「每个答对的任务」算,崩掉的钱就是白花。另外,没防线答对的那些运行平均输入 9,611 token,有防线的是 4,448,差了一倍多,因为 3 万字符垃圾在没防线时原样进了上下文并且每一步重发,有防线时被截到 4,000 字符。

**卡住重复同一个调用(`model_stuck`),两边都是 0% 答对。** 这一类没有谁「救得了」:模型自己不干正事了。有防线的区别是**及时止损**:6 次都变成了 `loop` 状态、走了 4 步就收尾,给出部分答案并转人工;没防线这 6 次要么先被 429 崩掉,要么烧满 10 步然后回一句「到了最大步数」。看 `ex195_cost_by_status.py`(练习 3):`loop` 状态平均每次 ¥0.0044,而没防线烧满步数的 `max_steps_msg` 是 ¥0.0151。

### 两个意外

**意外一:有防线,反而比没防线差。** 我第一版 `PolicyLLM._progress` 是用 `json.loads` 解析工具结果的。有防线那边 `guarded_call` 把 3 万字符的结果**截断**到 4,000 字符,截断后的 JSON 解析不了,policy 就当「没查到」,重新查,再碰上别的故障,3 次机会用完就放弃。结果在没有 429 的设置下,**有防线答对 90.0%,没防线 94.5%**,防线反而添乱。

这不是防线错了,是我的「模型」比真模型笨:真模型读的是文字,截断后的 `{"city": "杭州", "temp": 10, "debug": "xxxx...` 它照样读得出温度 10。所以第二版改成用正则从文字里找 `"temp": 数字`,和真模型一样「读文字」。但这个意外值得记住:**截断会破坏结构。** 给模型读的结果可以截断(模型读得懂开头),给**程序**读的结果(要 `json.loads` 的)就不能随便截,要么保证关键字段在前、要么让工具自己返回短结果(Day 191 的结论)。

**意外二:没有 429 时,有防线仍然略低。** 改完以后,把 429 概率设成 0,**有防线 93.0%,没防线 94.5%**,差 1.5 个百分点。我把「卡住 0.2 秒」的故障关掉再比,是 188 对 189 次,差 1 次,基本相同。所以那 1.5 个点是 0.05 秒的工具超时造成的:没防线愿意等 0.2 秒拿到结果,有防线 0.05 秒就放弃,多出来的重查占了步数,个别运行用完 10 步。**防线不是免费的**:超时设得比正常慢请求还短,就会把本来能成功的请求砍掉。实验里 0.05 对 0.2 是故意设成这样,真实系统里超时要按工具真实耗时的 P99 往上留余量,Day 192 讲预算时说的「看真实数据里步数和 token 的分布」同一个道理。

### 零件对照

| 零件 | 在 `chaos.py` 里出现在哪 | 来自哪天 |
| --- | --- | --- |
| `Faults`、`Run`、`PolicyLLM`、`make_registry` | 故障和被测对象 | 今天新写 |
| `fake_http_error` | `PolicyLLM.chat` 里的 429、401 | Day 193 |
| `run_agent`、`agent_loop.LLMClient` 替换 | `plain` 做法 | Day 170、189 |
| `RobustAgent`、`Limits` | `robust` 做法 | Day 193、192 |
| `chat_with_retry.retry.sleep` 替换 | `batch` 里 | Day 190 |
| 按故障分组统计 | `by_fault` | 类似 Day 194 的 `triage.py` |

## 本周错题与坑清单

这些都是这六天里真踩过的,按现象和修法列。

| 坑 | 现象 | 修法 |
| --- | --- | --- |
| SDK 自带重试加 tenacity 叠加(Day 190) | 一次调用最坏发 12 个请求 | `make_llm` 把 `max_retries` 设 0,重试只在 `chat_with_retry` 一处 |
| 401 也重试(Day 190) | key 写错,白等好几秒 | `retry_if_exception_type` 只放 429、5xx、连接错误 |
| 忘了 `reraise=True`(Day 190) | 抛出来的是 `RetryError`,`except openai.APIError` 接不住 | 加 `reraise=True` |
| 写操作超时后重试(Day 190、191) | 退了两次款 | 幂等键;超时不等于没做 |
| `ThreadPoolExecutor(max_workers=1)`(Day 191) | 一个工具卡住,后面的快工具也跟着超时 | 至少 4 个 worker,线程池只为限时等待 |
| 只截断不说(Day 191) | 模型以为数据就这么多 | 截断后写明「已截断,共 N 字符」 |
| 用原始参数字符串算指纹(Day 192) | `{"city": "杭州"}` 和 `{"city":"杭州"}` 算两个调用 | 先 `json.loads` 再 `json.dumps(sort_keys=True)` |
| `LoopGuard` 跨任务复用(Day 192) | 第二个任务第一次调用就被拦 | 每次 `run` 新建一个 |
| 被拦的调用不回 tool 消息(Day 192、193) | 下一次请求 400 | 每个 `tool_call_id` 必须有回复,先回完再决定收不收尾 |
| `f"{10.5:.0f}"`(Day 192) | 得到 `10` 不是 `11`,断言写错 | Python 是银行家舍入,正好 .5 取偶数 |
| 收尾不禁用工具,也没有兜底(Day 192) | 收尾拿到空 `content` | `tool_choice="none"` 加 `or FALLBACK` |
| 收尾调用的 token 没记账(Day 192、193) | `usage` 比账本少一笔,撞线的任务最贵偏偏漏了 | `wrap_up(..., usage)` |
| 假模型剧本用完还被调用(Day 193) | 悄悄吞掉「多调了一次」,测试照样绿 | `FakeClient` 剧本用完再调就抛 `AssertionError` |
| `TimedChat` 里吞掉异常(Day 194) | `llm_error` 永远不出现 | `except` 里记完日志再 `raise` |
| 脱敏正则不限长(Day 194) | 2 万字符文本要 2.9 秒,10 万字符 82 秒 | 每段写 `{1,64}` 这样的上限 |
| 日志文件用 `"w"` 打开(Day 194) | 每次清空旧日志 | 追加模式 `"a"` |
| 小项目第一版 policy 用 `json.loads`(今天) | 截断后读不出来,有防线反而更差 | 像模型一样读文字;给程序读的结果别随便截断 |
| 工具超时比正常慢请求还短(今天) | 没 429 时成功率还掉了 1.5 个点 | 超时按真实耗时的 P99 往上留余量 |

## 动手练习

### 练习 1:429 到底多频繁,防线才撑不住

把每次调模型收到 429 的概率从 0 依次调到 0.1、0.3、0.5,各跑 200 次,打印两种做法的答对率,以及有防线那边 `llm_error` 的比例。猜一下 0.5 的时候有防线还能答对多少,再对一对。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex195_sweep.py  练习 1:把 429 的概率从 0 调到 0.5,看两种做法各自的「答对率」怎么掉
from part03.chaos import Faults, batch

print(f"{'每次调模型收到 429 的概率':20} {'没防线答对':>10} {'有防线答对':>10} {'有防线 llm_error':>16}")
for p in (0.0, 0.1, 0.3, 0.5):
    faults = Faults(model_429=p)
    plain = batch("plain", 200, faults)
    robust = batch("robust", 200, faults)
    full_plain = sum(r["grade"] == "full" for r in plain)
    full_robust = sum(r["grade"] == "full" for r in robust)
    errors = sum(r["status"] == "llm_error" for r in robust)
    print(f"{p:<20.1f} {full_plain / 2:9.1f}% {full_robust / 2:9.1f}% {errors / 2:15.1f}%")
```

<div class="line-notes">

- `from part03.chaos import Faults, batch` 复用小项目里的两样东西。
- `for p in (0.0, 0.1, 0.3, 0.5):` 四档 429 概率。
- `faults = Faults(model_429=p)` 只改 429 一项,其他五种故障保持默认。
- `plain = batch("plain", 200, faults)` 两种做法用同一组种子,碰上的任务一样。
- `full_plain = sum(r["grade"] == "full" for r in plain)` 数答对的次数,`True` 当 1 累加。
- `errors = sum(r["status"] == "llm_error" for r in robust)` 有防线那边 `llm_error` 的次数。
- `print(f"{p:<20.1f} {full_plain / 2:9.1f}%` 200 次里的次数除以 2 就是百分比。`:<20.1f` 左对齐宽 20、保留一位小数。

</div>

```bash
uv run python -m part03.ex195_sweep
```

```text
每次调模型收到 429 的概率           没防线答对      有防线答对    有防线 llm_error
0.0                       94.5%      93.0%             2.0%
0.1                       43.5%      93.0%             2.0%
0.3                        7.0%      87.5%             8.0%
0.5                        0.0%      55.5%            41.5%
```

没防线从 94.5% 一路掉到 0:429 概率 0.1 时 43.5%,0.3 时 7.0%,0.5 时一个都没成。有防线 0.1 时几乎不变(93.0%),0.3 时 87.5%,0.5 时 55.5%。

最后一档能算出来:单次调用 429 的概率是 0.5,重试 4 次全失败的概率是 0.5⁴ = 6.25%,一次任务要调五六次模型,至少一次「4 次全失败」的概率大约 `1 - (1 - 0.0625)^5.5` ≈ 30%,实际每个任务调模型的次数比 5.5 多(重试也算一次调用)、再叠上 401 那种永久错误,`llm_error` 41.5% 和答对 55.5% 对得上这个量级。这给了一个直觉:**重试把「单次失败概率 p」变成 p⁴,在 p 很大时救不了**。模型服务真的有一半请求都在限流时,该做的是排队、降速、换模型或者换一家供应商(Day 190 提到的断路器和降级,第七部分讲),不是把重试次数调到 20。

</details>

### 练习 2:模型把工具名写错了(第 7 种故障)

在 `chaos.py` 里加一种故障:模型有 15% 的概率把 `get_weather` 写成不存在的 `get_weathr`。不动 `chaos.py`,在新文件里写一个 `PolicyLLM` 的子类。关掉其他故障只看这一种,比较两种做法。再回答:这一类是被哪个零件接住的?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex195_ghost.py  练习 2:加第 7 种故障「模型把工具名写错」,看没防线和有防线各自怎么样
import random
from typing import Any

from common.llm import ChatResult
from part03.chaos import Faults, PolicyLLM, Run, batch


class GhostLLM(PolicyLLM):
    """在 PolicyLLM 的基础上,有 15% 的概率把工具名写成不存在的 get_weathr。"""

    def __init__(self, run: Run, faults: Faults, rng: random.Random) -> None:
        super().__init__(run, faults, rng)
        self.ghost_rng = random.Random(run.seed + 99)  # 单独一个随机数,不扰乱父类原来的随机序列

    def chat(self, messages: list[dict[str, Any]], **kw: Any) -> ChatResult:
        r = super().chat(messages, **kw)
        if r.message.get("tool_calls") and self.ghost_rng.random() < 0.15:
            r.message["tool_calls"][0]["function"]["name"] = "get_weathr"
            self.run.injected.append("ghost_tool")
        return r


for variant, name in (("plain", "没防线"), ("robust", "有防线")):
    rows = batch(variant, 200, Faults(model_429=0.0, model_401=0.0, model_stuck=0.0, tool_error=0.0, tool_hang=0.0,
                                      tool_huge=0.0), llm_cls=GhostLLM)
    hit = [r for r in rows if "ghost_tool" in r["injected"]]
    print(f"{name}:碰上写错工具名的运行 {len(hit)} 次,其中答对 {sum(r['grade'] == 'full' for r in hit)} 次;"
          f"全部 200 次里答对 {sum(r['grade'] == 'full' for r in rows)} 次,状态 { {s: sum(r['status'] == s for r in rows) for s in sorted({r['status'] for r in rows})} }")
```

<div class="line-notes">

- `class GhostLLM(PolicyLLM):` 继承 `PolicyLLM`,只覆盖 `chat`。
- `super().__init__(run, faults, rng)` 先让父类把自己初始化好。
- `self.ghost_rng = random.Random(run.seed + 99)  # 单独一个随机数,不扰乱父类原来的随机序列` 新故障用自己的随机数发生器。如果用父类的 `self.rng`,多掷一次骰子就会让后面所有故障的发生位置都变,两个实验就没法对比。
- `r = super().chat(messages, **kw)` 先让父类按规则生成这一步的回复。
- `if r.message.get("tool_calls") and self.ghost_rng.random() < 0.15:` 只有这一步真的要调工具时才可能写错名字。
- `r.message["tool_calls"][0]["function"]["name"] = "get_weathr"` 直接改回复里的工具名。
- `self.run.injected.append("ghost_tool")` 记下这次故障,统计用。
- `Faults(model_429=0.0, model_401=0.0,` 一路写到 `tool_huge=0.0`,把六种故障全关掉,只剩新加的这一种。
- `{s: sum(r['status'] == s for r in rows) for s in sorted({r['status'] for r in rows})}` 字典推导式加集合推导式:先把出现过的状态去重、排序,再各数一遍。

</div>

```bash
uv run python -m part03.ex195_ghost
```

```text
没防线:碰上写错工具名的运行 118 次,其中答对 100 次;全部 200 次里答对 182 次,状态 {'max_steps_msg': 17, 'ok': 183}
有防线:碰上写错工具名的运行 118 次,其中答对 113 次;全部 200 次里答对 195 次,状态 {'max_steps': 17, 'ok': 183}
```

两边的状态里都没有 `crash`:**这一类 Day 189 就接住了**,功劳是 Day 170 注册表的 `call`,它发现名字不在表里,返回「没有叫 get_weathr 的工具,可用的有 ['get_weather']」,不抛异常,模型(这里是 policy)看到结果里没有温度就重查。所以这一类**没有新零件**,图里那个虚线框就是它。

两边的差别在末尾:每次写错浪费一步,最多的运行用完了 10 步(两边都是 17 次)。没防线那边 17 次回一句「到了最大步数」,什么都没有,有防线那边走收尾,给出已查到的部分答案(`max_steps` 17 次,答对的有 195 次,比没防线的 182 次多 13 次)。这个差别又回到 Day 192 的主题:撞线不等于白干。

</details>

### 练习 3:哪类运行最费钱(开放题)

按 `status` 给两种做法的运行分组,算每组的平均输入 token 和平均花费。从结果里找出「最该优先治」的一类,说出你会再加哪一条防线,并说明理由。

<details><summary>参考答案</summary>

示范解法:

```python
# agent-zero-lab/part03/ex195_cost_by_status.py  练习 3:哪一类运行最费钱?按状态分组算平均输入 token 和花费
from collections import defaultdict
from typing import Any

from part03.chaos import PRICE_IN, PRICE_OUT, Faults, batch

for variant, name in (("plain", "没防线"), ("robust", "有防线")):
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in batch(variant, 200, Faults()):
        groups[r["status"]].append(r)
    print(name)
    for status, rows in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        tin = sum(r["tokens_in"] for r in rows) / len(rows)
        cost = sum(r["tokens_in"] * PRICE_IN + r["tokens_out"] * PRICE_OUT for r in rows) / len(rows) / 1_000_000
        print(f"  {status:14} {len(rows):3d} 次 | 平均输入 {tin:6.0f} tok | 平均每次 ¥{cost:.4f}")
```

<div class="line-notes">

- `from collections import defaultdict` 带默认值的字典,第一次访问不存在的键时自动建一个空列表。
- `groups: dict[str, list[dict[str, Any]]] = defaultdict(list)` 状态 → 这一状态下的所有运行。
- `groups[r["status"]].append(r)` 不用先判断键在不在。
- `for status, rows in sorted(groups.items(), key=lambda kv: -len(kv[1])):` 按运行次数从多到少排。
- `tin = sum(r["tokens_in"] for r in rows) / len(rows)` 这一组的平均输入 token。
- `cost = sum(r["tokens_in"] * PRICE_IN + r["tokens_out"] * PRICE_OUT for r in rows) / len(rows) / 1_000_000` 平均每次花多少钱。

</div>

```bash
uv run python -m part03.ex195_cost_by_status
```

```text
没防线
  crash          111 次 | 平均输入   1523 tok | 平均每次 ¥0.0037
  ok              87 次 | 平均输入   9611 tok | 平均每次 ¥0.0207
  max_steps_msg    2 次 | 平均输入   6346 tok | 平均每次 ¥0.0151
有防线
  ok             185 次 | 平均输入   4448 tok | 平均每次 ¥0.0105
  loop             6 次 | 平均输入   1612 tok | 平均每次 ¥0.0044
  max_steps        5 次 | 平均输入   7865 tok | 平均每次 ¥0.0184
  llm_error        4 次 | 平均输入   1405 tok | 平均每次 ¥0.0038
```

看数字:没防线那边,正常结束的 87 次平均 ¥0.0207,崩掉的 111 次平均 ¥0.0037(崩得早,没花多少钱,但也什么都没拿到)。有防线那边,正常结束的 185 次平均 ¥0.0105,比没防线的 ¥0.0207 少一半,因为垃圾被截断了;`max_steps` 5 次平均 ¥0.0184,是所有状态里最贵的;`loop` 6 次只要 ¥0.0044,及时止损;`llm_error` 4 次 ¥0.0038。

**我会优先治 `max_steps` 这一类**:次数不多(5 次),但单次最贵,而且是「用满了 10 步仍然没做完」。看它们是怎么来的:这几次大多是工具报错或超时后 policy 反复重查,每次重查都占一步、都让上下文变长。可以再加一条防线:**同一个工具连续失败 3 次就别再让模型重试**,直接收尾并说明是哪个工具不可用。这和 `LoopGuard` 不同(它看的是完全相同的调用),这是看「同一个工具的连续失败」,抓的是参数每次略有不同、但一直在撞墙的情况。

还要承认这个实验的限制:`PolicyLLM` 是规则程序,不是真模型,「模型卡住」「读文字」都是我设计的。数字只说明防线的作用方向和相对大小,不能当成真模型上的绝对数。真正的结论要靠真模型和真任务跑评测(第六部分),今天的实验是它的预习。

</details>

**验收标准**:能默写出 `LoopGuard.check` 并通过自检;能默写 `run_loop` 并通过自检,说出收尾记账和被拦调用也要回消息这两个容易漏的点;`chaos.py` 的结果能解释每一行,尤其是两个意外;能说出每个坑的现象和修法;练习 1 能解释为什么重试救不了 50% 的 429。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 故障注入(fault injection) | 故意往系统里放进故障(报错、卡住、垃圾数据),看系统能不能扛住。Chaos Monkey 是它在生产环境里的版本 |
| `PolicyLLM` | 今天写的「规则模型」:有确定的行为,能被故障搅乱,不花钱,结果可复现 |
| 答对率 | 答案里每个城市的温度都对的运行占比。「部分」是只对一部分 |
| 模拟账 | 按字符数估出的 token 乘单价得到的钱,不是真实花费,只用来比较两种做法 |
| 种子(seed) | 随机数发生器的初始值,同一个种子产生同一串随机数。两种做法用同样的种子,碰上完全相同的故障序列 |
| 对照实验 | 只改一个条件(有没有防线),其余全部相同,比较结果 |
| 回溯、ReDoS | 见 Day 194:写得松的正则在长文本上耗时平方级增长 |
| 默写自检 | `check_dictation.py`:不比对文字,而是按行为检查你默写的代码(判决序列、状态、账) |
| 变异测试 | 见 Day 193:故意改坏被测代码,看测试会不会变红 |
| 断路器(circuit breaker) | 一个服务连续失败多次后,暂时不再调它、直接返回失败,过一阵再试探。本周没写,第七部分讲 |

## 常见误区

**以为防线越多越好。** 实验里 0.05 秒的工具超时,在没有 429 时让成功率掉了 1.5 个点。每一条防线都有误伤,阈值要按真实数据定,并且要有对照实验量出来。

**用「没出错」当「做对了」。** 注册表接住了幻觉工具名,`status=ok`,但答案对不对要看 `grade`。防线管的是「不崩、不烧钱」,答案对不对要靠评测。

**把重试次数调大来解决限流。** 单次 429 概率 0.5 时,4 次重试全失败的概率是 6.25%,调到 20 次也要等很久。限流严重时要换思路:排队、降速、换模型。

**拿一个能被「读文字」的模型去评价给程序读的截断。** 我第一版的 policy 用 `json.loads` 读结果,把防线的作用测反了。实验里的「模型」一定要和真模型一样的读法,否则得出的结论会误导你。

**只在防线的「好场景」里评价它。** 只看「碰上 429 的运行」,有防线 93% 对没防线 0%,漂亮。但还要看没有任何故障的基线(94.5% 对 93.0%),才知道它有没有副作用。

**默写时只看有没有抄全,不看边界。** `n <= max_repeats` 写成 `n <` 一处差一位,四项判决全错。默写后一定要用自检脚本跑,而不是自己看一眼觉得对。

**忘了批量跑要换掉真睡的等待。** 重试的 `sleep` 不换成空函数,200 次运行里的几百次退避要真睡几分钟。测试和实验里「次数、逻辑真的跑,等待不真等」是通用做法。

**拿模拟账当真账。** 今天的 ¥ 是估出来的,真实花费要看 `LLMClient.ledger` 或云厂商账单。比较两种做法的相对大小可以,当成预算依据不行。

## 学习资料

### 文档与文章

- [Principles of Chaos Engineering](https://principlesofchaos.org/):Netflix 等一批公司整理的混沌工程原则,核心是「在稳定状态下提出假设,注入真实世界的故障,看假设是否成立」。一页纸,今天小项目就是这个思路的玩具版。英文。
- [Netflix/chaosmonkey](https://github.com/Netflix/chaosmonkey):随机终止生产环境实例的开源工具,混沌工程的起点。看 README 里它解决的问题。英文。
- [AWS Builders' Library · Timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/):本周第 1、2 类失败的经典读物,今天的练习 1「重试救不了 50% 的 429」可以对照里面讲的重试风暴。英文,40 分钟。
- [Chip Huyen · Agents](https://huyenchip.com/2025/01/07/agents.html):读「Agent Failure Modes and Evaluation」一节,把本周的九类和她的规划失败、工具失败、效率问题对一遍。英文。
- [Python 官方文档 · random](https://docs.python.org/zh-cn/3.12/library/random.html):中文版,`random.Random(seed)` 怎么得到可复现的随机序列,`sample`、`randint` 的用法。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1rhLn6iEip&autoplay=0&high_quality=1" title="90%的Agent都翻车了｜5种死法×5种解法【费曼学AI EP.30】" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>费曼学AI · 90%的Agent都翻车了|5种死法×5种解法 · 12 分钟,本周第一天看过,今天复习日再看一遍:这次试着把它的每一种解法对应到本周的某个零件或某一天。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV11jbg6VENh&autoplay=0&high_quality=1" title="大模型线上经常遇到429限流、超时、流式截断。不是简单加重试就能解决，区分可重试/不可重试异常，熔断降级、流式特殊处理，才是生产环境稳定关键" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>阡陌数智大模型聚集 · 大模型线上经常遇到 429 限流、超时、流式截断 · 4 分钟,讲可重试和不可重试的区分、熔断降级,是练习 1 里「重试救不了」之后的下一步。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Kn1XvZhYd34" title="How to Find Failure Patterns in Complex AI Agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hamel Husain · How to Find Failure Patterns in Complex AI Agents · 怎么在复杂 Agent 的轨迹里找失败规律,和 Day 194 的日志、今天练习 3 按状态分组看花费,是同一种做法,英文。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/T1Lowy1mnEg" title="How to Build Reliable AI Agents (without the hype)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Dave Ebbelaar · How to Build Reliable AI Agents (without the hype) · 讲把 Agent 拆成确定性组件、用代码兜住模型不可靠的部分,和本周「防线是代码,不是提示词」同一个主张,英文。</figcaption>
</figure>

### 书籍

- Casey Rosenthal、Nora Jones《Chaos Engineering: System Resiliency in Practice》(O'Reilly, 2020):混沌工程的专著,故障注入的理论和实践,英文。
- Michael T. Nygard《Release It!》第 2 版(Pragmatic Bookshelf, 2018):稳定性模式的经典,超时、断路器、舱壁、降级,本周六天的理论背景,英文。
- Chip Huyen《AI Engineering》(O'Reilly, 2025):Agent 失败模式与评测相关章节,英文。

### 开源项目与代码

- [jd/tenacity](https://github.com/jd/tenacity):Day 190 的重试库,`wait_exponential_jitter` 的源码也值得看一眼(9.2.1 里 `initial` 参数已标记弃用,改用 `multiplier`)。
- [Netflix/chaosmonkey](https://github.com/Netflix/chaosmonkey):今天小项目的思想来源。

## 自测

1. 九类失败里,哪三类 Day 170 的注册表本来就接住了?靠的是什么?

<details><summary>答案</summary>

第 3 类工具抛异常、第 4 类参数不是合法 JSON、第 5 类调了不存在的工具。靠 `ToolRegistry.call`:先检查工具名在不在表里,不在就返回带可用列表的报错;再在 `try/except` 里解析参数、执行工具,任何异常都转成 `{"error": "类型: 信息"}` 作为 tool 消息交给模型,程序不崩,模型下一步可以改。

</details>

2. `LoopGuard(max_repeats=2)` 对同一个调用连发四次的判决分别是什么?为什么第 3 次不直接结束任务?

<details><summary>答案</summary>

`run`、`run`、`block`、`stop`。第 3 次先拦下并回一句「这个调用和之前完全一样,请换做法」,给模型一次改正的机会,大多数时候它看到提醒就会换做法或直接回答,任务还能完成;拦过还来才真的收尾。

</details>

3. 小项目里,没防线 200 次崩了 111 次,主要原因是什么?有防线时这些运行里答对了多少?为什么?

<details><summary>答案</summary>

主要原因是 429:每次调模型有 10% 概率先收到 429,一次任务要调五六次模型,碰上至少一次的运行有 109 次,没防线时异常一路冒出去,这些运行一次都没答对(0%)。有防线时 107 次碰上 429 的运行里答对了 93%,因为 `chat_with_retry` 对 429 做指数退避重试,绝大多数在 4 次之内会成功。

</details>

4. 实验里有防线为什么曾经比没防线还差?这个教训对你自己的 Agent 意味着什么?

<details><summary>答案</summary>

我的 policy 第一版用 `json.loads` 读工具结果,有防线那边 3 万字符的垃圾被截断到 4,000 字符,截断后的 JSON 解析不了,policy 把它当没查到而反复重查,用完机会就放弃。真模型读文字,截断后还读得到前面的字段。教训有两条:截断会破坏结构,给程序读的结果别随便截;实验里的模拟「模型」要和真模型同样的读法,不然会得出误导的结论。

</details>

5. 超时设得比正常慢请求还短会怎样?你会怎么定一个工具的超时?

<details><summary>答案</summary>

会把本来能成功的请求砍掉。实验里 0.05 秒超时 vs 0.2 秒的慢请求,没有 429 时成功率掉了 1.5 个百分点。定超时要看真实数据:用日志里这个工具的耗时分布,取 P99 再往上留余量(比如 1.5 到 2 倍),并且区分只读和写操作,写操作超时后还要靠幂等键防重复。

</details>

6. 面试题:你要向团队证明一套 Agent 防线有价值,而且不会拖累正常请求。你会怎么设计这个实验?

<details><summary>答案</summary>

做对照实验:同样的任务、同样的随机种子,一组没防线、一组有防线。故障注入覆盖本周九类里常见的几种(限流、永久错误、工具异常和卡住、垃圾结果、模型重复调用),每种有明确的发生概率,既要看「碰上某种故障时」两边的答对率,也要看**零故障的基线**,确认防线没有副作用(比如超时过短导致误伤)。指标至少有:答对率、部分答案占比、崩溃率、每个答对的任务的平均花费、耗时分布。结果要按故障类型拆开看,而不只看总数,这样能知道每条防线各自的贡献。然后补两个限制:模拟的模型和真模型的差别、数字是相对大小不是绝对数;最后用真模型在评测集上复核。再配上线上日志的状态分布监控,验证实验结论在真实流量里成立。

</details>

## 明天预告

明天是 **Day 196 · Workflow 还是 Agent:两个定义和一个构件**。这一周我们让「一个 Agent 循环」足够结实:出事不崩、查得出来。但并不是所有任务都需要 Agent 在循环里自己决定下一步。有的任务步骤是固定的,用一条写死的流程(workflow)更便宜、更稳、更好测。下一周先讲清 workflow 和 agent 的两个定义,再搭一个共用的「增强型 LLM」构件,接着一个个看提示链、路由、并行、编排者-工作者、评估者-优化者这五种常见模式。
