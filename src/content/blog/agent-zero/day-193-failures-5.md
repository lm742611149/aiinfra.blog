---
title: 'Day 193 · 失败模式(五):完整实现和假模型离线测试'
description: '把 Day 190 到 192 的四个零件拼成一个 RobustAgent:模型调用有重试,工具调用有超时和截断,循环有检测,撞线有收尾。再补上两个漏洞:收尾那次调用的 token 没进账,模型服务叫不动时没有明确的状态。然后写一个按剧本演戏的 FakeClient,用 5 个离线测试(共 8 个用例)把失败路径钉住,0.9 秒跑完、不花钱。最后重跑 Day 189 的体检报告,九类失败不再有一行「没有」,真模型实测收尾的 token 和账本一分不差。'
pubDate: 2026-10-23
regime: none
tags: ['reliability', 'testing', 'agent-loop', 'agent-zero']
series: 'agent-zero'
day: 193
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 192](/blog/agent-zero/day-192-failures-4/) 做了最后两道防线:`LoopGuard` 给每个工具调用算指纹,同一个调用第三次拦下、拦了还来就收尾;`over_budget` 在每一步调模型之前检查步数、token、时间三种预算,撞线以后 `wrap_up` 禁用工具、让模型用已有信息给部分答案。那天留了两个尾巴:练习 4 发现收尾那次调用的 token 没有算进 `AgentResult.usage`;`AgentResult.status` 里写了 `llm_error`,却一直没有地方真正返回它。

这四天你一共做了四个零件,散在四个文件里:Day 190 的 `chat_with_retry`、Day 191 的 `guarded_call`、Day 192 的 `LoopGuard` 和 `over_budget`/`wrap_up`。今天把它们拼成一个循环,补上两个尾巴,再回答一个更重要的问题:这么多条防线,**怎么证明它们真的在起作用**。总不能等线上真出了事再看。

## 今天要解决的问题

学完你应该能:

1. 说出四个零件各治九类失败里的哪几类,在 `RobustAgent` 主循环的哪个位置接上。
2. 补上两个漏洞:收尾调用的 token 记进 `usage`(和 `LLMClient.ledger` 对得上),模型叫不动时返回 `llm_error` 而不是让整个程序崩掉。
3. 写一个按剧本演戏的 `FakeClient`,用它写 5 个离线测试,覆盖重试、`llm_error`、循环收尾、三种预算、工具层四种失败,并能解释每个断言钉住的是哪一行代码。
4. 用「故意改坏被测代码」的办法检验测试有没有用。

今天两个新概念:**RobustAgent 的拼装**(其实是把已有零件接起来)和**用假模型做离线测试**。

预计用时 3 小时。前置:[Day 190](/blog/agent-zero/day-190-failures-2/)(`retry_llm.py`)、[Day 191](/blog/agent-zero/day-191-failures-3/)(`tool_guard.py`)、[Day 192](/blog/agent-zero/day-192-failures-4/)(`loop_guard.py`、`budget.py`、`budget_agent.py`)、[Day 189](/blog/agent-zero/day-189-failures-1/)(`failure_zoo.py`)、[Day 72](/blog/agent-zero/day-072-pytest-2/)(pytest 的 pythonpath 和目录结构)、[Day 50](/blog/agent-zero/day-050-dataclass/)(dataclass)。代码在 `agent-zero-lab/part03/` 和 `tests/`,命令都在 `agent-zero-lab/` 根目录跑。今天真调模型 2 次运行,约 ¥0.01(算式在「真模型」一节);测试和体检脚本里只有两处会联网,一处连本机没人监听的端口,一处故意用错 key,都不花钱。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `RobustAgent.run` 的主循环和 `FakeClient.chat`;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 四个零件,一张对照表

先把手里的东西摆出来。Day 189 的体检报告把失败分成三层九类,四天里每个零件各治其中几类:

| 零件 | 文件和函数 | 治哪几类 | 接在循环的哪里 |
| --- | --- | --- | --- |
| 重试 | `retry_llm.py` 的 `chat_with_retry`、`make_llm` | 1 模型 API 临时错误 | 每次调模型都包一层 |
| 工具超时 + 截断 | `tool_guard.py` 的 `guarded_call` | 2 工具卡住、7 结果过长 | 每次执行工具都包一层 |
| 循环检测 | `loop_guard.py` 的 `LoopGuard`、`LOOP_MSG` | 6 重复调用 | 执行工具之前问一句 |
| 预算 + 收尾 | `budget.py` 的 `Limits`、`over_budget`、`wrap_up`、`AgentResult` | 8 停不下来、9 做不完 | 每一步调模型之前问一句;撞线时收尾 |

剩下的 3、4、5 三类(工具抛异常、参数不是合法 JSON、调了不存在的工具)Day 189 就已经接住了,功劳在注册表 `call` 里的 `try/except`,不用新零件。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="RobustAgent 一步循环的内部结构:调模型前查预算,调模型经过重试,工具调用先过循环检测再过超时截断,撞线或循环都汇到收尾,模型叫不动直接返回 llm_error">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
  <rect x="20" y="30" width="120" height="46" fill="var(--paper)" stroke="var(--ink-soft)" rx="4"/>
  <text x="80" y="50" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">over_budget</text>
  <text x="80" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">步数/token/时间</text>
  <rect x="170" y="30" width="130" height="46" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="235" y="50" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">调模型</text>
  <text x="235" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">chat_with_retry 4 次</text>
  <rect x="330" y="30" width="120" height="46" fill="var(--paper)" stroke="var(--ink-soft)" rx="4"/>
  <text x="390" y="50" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">LoopGuard</text>
  <text x="390" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">run/block/stop</text>
  <rect x="480" y="30" width="140" height="46" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="550" y="50" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">guarded_call</text>
  <text x="550" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">超时 + 截断</text>
  <line x1="140" y1="53" x2="170" y2="53" stroke="var(--ink-soft)"/>
  <line x1="300" y1="53" x2="330" y2="53" stroke="var(--ink-soft)"/>
  <line x1="450" y1="53" x2="480" y2="53" stroke="var(--ink-soft)"/>
  <path d="M550 76 Q550 130 80 130 L80 76" fill="none" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
  <text x="300" y="124" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">下一步</text>
  <rect x="20" y="170" width="290" height="50" fill="none" stroke="var(--ink)" stroke-dasharray="6 4" rx="4"/>
  <text x="165" y="191" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">wrap_up:禁用工具,给部分答案</text>
  <text x="165" y="208" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">status = max_steps/budget/timeout/loop</text>
  <rect x="340" y="170" width="280" height="50" fill="none" stroke="var(--ink)" rx="4"/>
  <text x="480" y="191" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">直接返回 llm_error</text>
  <text x="480" y="208" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">模型都叫不动,收尾也没意义</text>
  <line x1="80" y1="76" x2="80" y2="170" stroke="var(--ink)"/>
  <text x="86" y="160" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">超了</text>
  <line x1="390" y1="76" x2="270" y2="170" stroke="var(--ink)"/>
  <text x="330" y="134" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">stop</text>
  <line x1="235" y1="76" x2="420" y2="170" stroke="var(--ink)"/>
  <text x="400" y="156" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">重试用尽</text>
  <text x="320" y="262" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">三条路都返回 AgentResult,不再有「崩掉」和「一句话打发」</text>
</svg>
<figcaption>RobustAgent 的一步:左边两个方框是「调用之前问一句」,右边两个是「包住一次调用」。只有模型服务彻底叫不动这一条路不收尾。</figcaption>
</figure>

图里有个值得先说清的取舍:为什么模型叫不动就不收尾。收尾本身也要再调一次模型。刚刚重试了四次都失败,说明服务现在不可用(或者 key 错了),再调一次大概率还是失败,只会白等几秒。所以这条路直接返回 `llm_error`,告诉用户和上游「不是你的问题,是模型服务的问题」。

## 先造一个会演戏的假模型

要证明这些防线起作用,得能**稳定地**制造故障:连续两次 429、模型连续四次发同一个调用、工具卡住。真模型做不到这一点(上一课两次「施压」实验它都没打转)。办法是写一个和 `LLMClient` 长得一样的假模型,按你写好的剧本一幕一幕演。这个思路 Day 189 的 `FakeLLM` 用过,Day 190 的 `ScriptedLLM` 又用过,但两个都有局限:`FakeLLM` 剧本用完会一直重复最后一幕,多调了一次模型也发现不了,而且不报 token;`ScriptedLLM` 只会抛错。今天合成一个统一的:

- 剧本里放一个**异常**,这一次调用就抛它(模拟 429、401)。
- 放一个**字符串**,这一次就是模型给的最终回答。
- 放一个**列表**,每项是 `(工具名, 参数字符串)`,这一次模型就一口气发出这些工具调用。
- 剧本用完了模型又被调用,**直接报错**。这样「Agent 多调了一次模型」会让测试变红,而不是悄悄通过。
- 每次成功的调用固定报 100 个输入、20 个输出 token,这样任何一次运行的总 token 数都能心算出来。

```python
# agent-zero-lab/part03/fake_client.py  Day 193:按剧本回话的假模型。剧本里放异常就抛,放字符串就是最终回答,放列表就是这一步要发的工具调用
import json
from collections.abc import Sequence
from typing import Any

import httpx2
import openai

from common.llm import ChatResult

Step = Exception | str | list[tuple[str, str]]


class FakeClient:
    """和 LLMClient 一样有 chat 方法,但按剧本一条条演。每次成功的调用固定报 100 个输入、20 个输出 token。"""

    def __init__(self, script: Sequence[Step], prompt_tokens: int = 100, completion_tokens: int = 20) -> None:
        self.script = list(script)  # 复制一份,pop 的时候不会改到调用方手里的列表
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens
        self.calls: list[dict[str, Any]] = []  # 每次 chat 被调用时收到的参数,断言时用

    def chat(self, messages: list[dict[str, Any]], **kw: Any) -> ChatResult:
        self.calls.append({"messages": len(messages), "tool_choice": kw.get("tool_choice")})
        if not self.script:
            raise AssertionError(f"剧本用完了,模型却又被调用了一次(第 {len(self.calls)} 次)")
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        n = len(self.calls)
        if isinstance(item, str):
            message: dict[str, Any] = {"role": "assistant", "content": item}
            finish = "stop"
        else:
            tool_calls = [
                {"id": f"call_{n}_{i}", "type": "function", "function": {"name": name, "arguments": args}}
                for i, (name, args) in enumerate(item)
            ]
            message = {"role": "assistant", "content": "", "tool_calls": tool_calls}
            finish = "tool_calls"
        return ChatResult(content=message["content"], reasoning=None, finish_reason=finish, message=message,
                          prompt_tokens=self.prompt_tokens, completion_tokens=self.completion_tokens)


def call(name: str, **args: Any) -> tuple[str, str]:
    """造一个工具调用:call("get_weather", city="杭州") -> ("get_weather", '{"city": "杭州"}')。"""
    return name, json.dumps(args, ensure_ascii=False)


def fake_http_error(status: int) -> openai.APIStatusError:
    """手工造一个和 SDK 抛出来一模一样的 HTTP 错误(Day 190 的 http_error,搬到这里让所有测试共用)。"""
    req = httpx2.Request("POST", "https://api.deepseek.com/chat/completions")
    cls = {429: openai.RateLimitError, 401: openai.AuthenticationError, 503: openai.InternalServerError}[status]
    return cls(f"Error code: {status}", response=httpx2.Response(status, request=req), body=None)
```

<div class="line-notes">

- `from collections.abc import Sequence` 「只读的序列」类型。`__init__` 的参数用它而不用 `list`,是因为 `list[Step]` 要求元素类型**一模一样**,调用方传 `list[str | list[...]]` 时类型检查会报红;`Sequence` 允许更窄的元素类型,相当于 TS 里只读数组 `readonly Step[]` 的协变。
- `import httpx2` 和 `import openai` 只给文件末尾的 `fake_http_error` 用。openai 3.x 内部用的 HTTP 库叫 httpx2,造错误响应要用同一个包([Day 190](/blog/agent-zero/day-190-failures-2/) 讲过)。
- `Step = Exception | str | list[tuple[str, str]]` 给「剧本里的一幕」起个别名,相当于 TS 的 `type Step = Error | string | [string, string][]`。三种幕对应三种情况:抛错、最终回答、工具调用。
- `def __init__(self, script: Sequence[Step], prompt_tokens: int = 100, completion_tokens: int = 20) -> None:` 后两个参数有默认值,所以测试里直接写 `FakeClient([...])` 就是每次报 100 + 20。
- `self.script = list(script)  # 复制一份,pop 的时候不会改到调用方手里的列表` 不复制的话,`pop(0)` 会把调用方传进来的列表吃掉一截。测试里 `[[call(...)]] * 4` 这种共用同一个列表的写法也就不会出怪事。
- `self.calls: list[dict[str, Any]] = []  # 每次 chat 被调用时收到的参数,断言时用` 记录本。只记两样:这次收到几条消息,以及 `tool_choice` 传的是什么。收尾那次一定是 `"none"`,测试靠它认出收尾。
- `def chat(self, messages: list[dict[str, Any]], **kw: Any) -> ChatResult:` 签名和 Day 190 的 `SupportsChat` 协议完全一致,所以 `RobustAgent` 分不清它和真的 `LLMClient`。`**kw` 收下 `tools`、`tool_choice` 等所有关键字参数。
- `self.calls.append({"messages": len(messages), "tool_choice": kw.get("tool_choice")})` 先记账再演。`kw.get("tool_choice")` 没传就是 `None`。注意失败的那几次也会被记,所以 `len(fake.calls)` 是「模型被调用了几次」,不是「成功了几次」。
- `if not self.script:` 剧本用完了。空列表在 Python 里是假值。
- `raise AssertionError(f"剧本用完了,模型却又被调用了一次(第 {len(self.calls)} 次)")` 故意抛 `AssertionError` 而不是 `openai.APIError`:`RobustAgent` 只接 `openai.APIError`,这个异常会一路冒出去让测试红掉,不会被当成 `llm_error` 吞掉。
- `item = self.script.pop(0)` 从头取一幕并删掉,相当于 JS 的 `script.shift()`。
- `raise item` 这一幕是异常就抛。这一次没有 token(失败的请求没有 `usage`),调用方的 `usage` 也就不会加。
- `n = len(self.calls)` 当前是第几次调用,下面拿来造不重复的 `tool_call` id。
- `if isinstance(item, str):` 字符串幕:`message` 是一条普通 assistant 消息,`finish_reason` 是 `"stop"`。
- `{"id": f"call_{n}_{i}", "type": "function", "function": {"name": name, "arguments": args}}` 列表幕:每个 `(工具名, 参数)` 变成一个 `tool_call`。id 写成 `call_2_0`、`call_2_1`(第 2 次调用的第 0、1 个),保证整场戏里不重复。`enumerate` 同时给下标和元素,`(name, args)` 是元组拆包。
- `message = {"role": "assistant", "content": "", "tool_calls": tool_calls}` 和真模型发工具调用时的消息形状一样:`content` 是空串,`tool_calls` 里是调用列表。
- `return ChatResult(content=message["content"], reasoning=None, finish_reason=finish, message=message,` 返回真正的 `ChatResult`(Day 135 定义的 dataclass),不是自己糊的假对象。好处是类型检查全绿,`RobustAgent` 读 `r.message`、`r.content`、`r.prompt_tokens` 都有提示。
- `def call(name: str, **args: Any) -> tuple[str, str]:` 写剧本的小工具。`**args` 收下所有关键字参数成一个字典,相当于 JS 的 `(name, args)` 里 args 是对象。
- `return name, json.dumps(args, ensure_ascii=False)` 把参数转成 JSON 字符串,因为真模型给的 `arguments` 就是字符串。`call("get_weather", city="杭州")` 得到 `("get_weather", '{"city": "杭州"}')`。
- `def fake_http_error(status: int) -> openai.APIStatusError:` Day 190 测试里的 `http_error` 搬过来,所有测试共用,不用每个测试文件抄一遍。
- `cls = {429: openai.RateLimitError, 401: openai.AuthenticationError, 503: openai.InternalServerError}[status]` 字典当查找表:状态码查异常类。传了表里没有的状态码会 `KeyError`,正好提醒你先把它加进表。

</div>

先看它怎么演。这个小脚本放一次 429、一次两个并行的工具调用、一句最终回答,然后故意多调一次:

```python
# agent-zero-lab/part03/fake_demo.py  看一遍 FakeClient 怎么按剧本演:一次 429、一次工具调用、一句最终回答
import openai

from part03.fake_client import FakeClient, call, fake_http_error

fake = FakeClient([fake_http_error(429), [call("get_weather", city="杭州"), call("get_aqi", city="杭州")], "杭州 21 度,空气优。"])
history = [{"role": "user", "content": "杭州天气?"}]
for i in range(1, 5):
    try:
        r = fake.chat(history, tool_choice="none" if i == 3 else None)
        print(f"第 {i} 次:content={r.content!r} finish={r.finish_reason} tokens={r.prompt_tokens}+{r.completion_tokens}")
        for tc in r.message.get("tool_calls", []):
            print("        工具调用", tc["id"], tc["function"]["name"], tc["function"]["arguments"])
    except openai.APIError as e:
        print(f"第 {i} 次:抛出 {type(e).__name__}")
    except AssertionError as e:
        print(f"第 {i} 次:AssertionError {e}")
print("记录本:", fake.calls)
```

<div class="line-notes">

- `fake = FakeClient([fake_http_error(429), [call("get_weather", city="杭州"), call("get_aqi", city="杭州")], "杭州 21 度,空气优。"])` 三幕剧本:第 1 次调用抛 `RateLimitError`,第 2 次一口气发两个工具调用,第 3 次回最终回答。
- `history = [{"role": "user", "content": "杭州天气?"}]` 假模型不看内容,历史随便给一条。
- `for i in range(1, 5):` 调 4 次,剧本只有 3 幕,第 4 次应该爆。
- `r = fake.chat(history, tool_choice="none" if i == 3 else None)` 第 3 次故意传 `tool_choice="none"`,看记录本里记不记得住。条件表达式 `a if 条件 else b` 相当于 JS 的三元运算符。
- `for tc in r.message.get("tool_calls", [])` 字典的 `.get(键, 默认值)`:没有 `tool_calls` 键(最终回答那一幕)就当空列表。
- `except openai.APIError as e:` 第 1 次的 429 在这里接住。`RateLimitError` 是 `APIError` 的子类。
- `except AssertionError as e:` 第 4 次剧本用完的报错在这里接住;真的测试里不会接它,让它冒出去。

</div>

```bash
cd /Users/你/agent-zero-lab
uv run python -m part03.fake_demo
```

```text
第 1 次:抛出 RateLimitError
第 2 次:content='' finish=tool_calls tokens=100+20
        工具调用 call_2_0 get_weather {"city": "杭州"}
        工具调用 call_2_1 get_aqi {"city": "杭州"}
第 3 次:content='杭州 21 度,空气优。' finish=stop tokens=100+20
第 4 次:AssertionError 剧本用完了,模型却又被调用了一次(第 4 次)
记录本: [{'messages': 1, 'tool_choice': None}, {'messages': 1, 'tool_choice': None}, {'messages': 1, 'tool_choice': 'none'}, {'messages': 1, 'tool_choice': None}]
```

注意第 1 次抛错那一次,记录本里也有一笔;两个工具调用的 id 是 `call_2_0` 和 `call_2_1`,说明是第 2 次调用里的第 0 个和第 1 个。

## 先补第一个漏洞:收尾那次调用的钱

Day 192 练习 4 的发现是:`wrap_up` 里那次 `llm.chat(...)` 的 token 没有进 `AgentResult.usage`。用 FakeClient 可以把这个问题**稳定**地复现出来,不用再靠真模型凑巧撞线。剧本:第 1 步发一个工具调用,第 2 步(撞线之后的收尾)回一句文字,`max_steps=1`,所以模型一共被调 2 次,每次 120 token,应该是 240。

```python
# agent-zero-lab/part03/usage_gap.py  Day 193:复现 Day 192 练习 4 的窟窿:收尾那次调用的 token 没进 usage
from part03 import budget_agent
from part03.budget import Limits
from part03.failure_zoo import reg
from part03.fake_client import FakeClient, call

fake = FakeClient([[call("get_weather", city="杭州")], "目前只查到杭州,别的城市没查。"])
budget_agent.LLMClient = lambda: fake  # type: ignore[assignment,misc]
result = budget_agent.run_budget_agent(reg, "你是助手。", "查五个城市的天气。", Limits(max_steps=1))
actual = len(fake.calls) * (fake.prompt_tokens + fake.completion_tokens)
print(f"模型一共被调 {len(fake.calls)} 次,实际 {actual} 个 token | AgentResult.usage = {result.usage},合计 {sum(result.usage.values())}")
print(f"status={result.status} answer={result.answer}")
```

<div class="line-notes">

- `from part03 import budget_agent` 导入的是 Day 192 的 `run_budget_agent` 所在模块,还没换成今天的 `RobustAgent`,先看旧代码有没有这个洞。
- `fake = FakeClient([[call("get_weather", city="杭州")], "目前只查到杭州,别的城市没查。"])` 两幕:一次工具调用,一句文字。第二幕会被收尾那次调用拿到。
- `budget_agent.LLMClient = lambda: fake  # type: ignore[assignment,misc]` Day 189 讲过的换法:`run_budget_agent` 里的 `LLMClient()` 查的是它自己模块里的这个名字,换掉它,new 出来的就是 `fake`。
- `Limits(max_steps=1)` 只许走一步,第 2 步开始前撞线,进收尾。
- `actual = len(fake.calls) * (fake.prompt_tokens + fake.completion_tokens)` 实际花了多少 token:调用次数乘每次的 100 + 20。这个数是假模型「亲口说」的,不会错。
- `sum(result.usage.values())` `usage` 字典两个值相加,就是 Agent 自己记的总数。

</div>

先在 Day 192 的原样代码上跑(`budget.py` 和 `budget_agent.py` 还没改):

```bash
uv run python -m part03.usage_gap
```

```text
[step 1] 累计 120 tok | 调用 ['get_weather']
    get_weather({"city": "杭州"}) -> run
模型一共被调 2 次,实际 240 个 token | AgentResult.usage = {'prompt_tokens': 100, 'completion_tokens': 20},合计 120
status=max_steps answer=目前只查到杭州,别的城市没查。
```

账上只有 120,实际 240。少的那 120 就是收尾那次。这在小任务里无所谓,但如果你按 `usage` 给用户计费、或者拿它做预算上限、或者拿它和云厂商账单对数,每次撞线都会漏一笔,而且**偏偏撞线的任务通常最长、最贵**。

修法两处。第一处在 `budget.py`:`wrap_up` 多收一个可选参数 `usage`,传了就把这次调用的 token 加进去;顺手给 `AgentResult` 加一个 `error` 字段,下一节要用。

```python
# agent-zero-lab/part03/budget.py  Day 193 改动一:AgentResult 加 error 字段
@dataclass
class AgentResult:
    answer: str
    status: str  # ok / max_steps / budget / timeout / loop / llm_error
    steps: int
    usage: dict[str, int] = field(default_factory=dict)
    needs_human: bool = False
    error: str = ""  # Day 193 加的:llm_error 时放异常类名,其余状态是空串
```

<div class="line-notes">

- `status: str` 状态字符串没变,`llm_error` 今天才真正有人返回。
- `error: str = ""  # Day 193 加的:llm_error 时放异常类名,其余状态是空串` 新字段放在最后并给默认值,Day 192 里所有 `AgentResult(answer, status, steps, usage, True)` 的位置参数写法一个都不用改。给已有的数据结构加字段,放最后、带默认值,是最不容易弄坏旧代码的加法。

</div>

```python
# agent-zero-lab/part03/budget.py  Day 193 改动二:wrap_up 把收尾那次调用的 token 记进 usage
def wrap_up(llm: SupportsChat, messages: list[dict[str, Any]], tools: list[Any], reason: str,
            usage: dict[str, int] | None = None) -> str:
    """撞线了:禁用工具,让模型用已经拿到的信息给出部分答案。收尾本身失败就给固定文案。"""
    messages.append({"role": "user", "content": f"(系统提示:{reason},不能再调用工具了。请根据目前已经拿到的信息"
                                                f"给出你能给的最好回答,并明确说明哪些部分没有完成。)"})
    try:
        r = llm.chat(messages, tools=tools, tool_choice="none")
        if usage is not None:  # Day 193 加的:收尾这次也花了钱,记进同一本账
            usage["prompt_tokens"] += r.prompt_tokens
            usage["completion_tokens"] += r.completion_tokens
        answer = r.content.strip() or FALLBACK  # 模型没给文字(比如还想调工具)也算收尾失败
    except Exception as e:
        answer = f"{FALLBACK}({type(e).__name__})"
    messages.append({"role": "assistant", "content": answer})
    return answer
```

<div class="line-notes">

- `usage: dict[str, int] | None = None` 新参数默认 `None`,不传就和 Day 192 的行为完全一样,旧调用不会坏。
- `r = llm.chat(messages, tools=tools, tool_choice="none")` 这一行没变。
- `if usage is not None:` 传了字典才记账。判断用 `is not None` 而不是 `if usage:`,因为一个空字典 `{}` 也是假值,`if usage:` 会把「传了空字典」误当成「没传」。
- `usage["prompt_tokens"] += r.prompt_tokens` 直接改调用方传进来的那个字典,不是改副本。这是有意的:调用方拿同一个 `usage` 对象继续用,账自然是连续的。Python 的字典传参传的是引用,和 JS 传对象一样。
- 放在 `answer = ...` 之前,是因为就算模型回了空串、答案落到 `FALLBACK`,这次调用也确实花了钱。
- `except Exception as e:` 调用失败的情况没有 `r`,当然也没有 token,不记账,这和上面「失败的请求没有 `usage`」一致。

</div>

第二处在 `budget_agent.py`,两处 `wrap_up(...)` 调用末尾补一个 `usage`:

```python
# agent-zero-lab/part03/budget_agent.py  Day 193 改动三:两处 wrap_up 调用补上 usage(只列改动的两行)
            return AgentResult(wrap_up(llm, messages, registry.schemas, reason, usage), status, step - 1, usage, True)
...
            answer = wrap_up(llm, messages, registry.schemas, "检测到重复调用,任务可能陷入了循环", usage)
```

<div class="line-notes">

- `return AgentResult(wrap_up(llm, messages, registry.schemas, reason, usage), status, step - 1, usage, True)` 参数求值从左到右:先执行 `wrap_up`(它把收尾的 token 加进 `usage`),再把同一个 `usage` 字典放进 `AgentResult`,所以结果里已经包含收尾那笔。
- `answer = wrap_up(llm, messages, registry.schemas, "检测到重复调用,任务可能陷入了循环", usage)` 循环那条路同理。

</div>

重跑同一个脚本:

```bash
uv run python -m part03.usage_gap
```

```text
[step 1] 累计 120 tok | 调用 ['get_weather']
    get_weather({"city": "杭州"}) -> run
模型一共被调 2 次,实际 240 个 token | AgentResult.usage = {'prompt_tokens': 200, 'completion_tokens': 40},合计 240
status=max_steps answer=目前只查到杭州,别的城市没查。
```

240 对 240。

> 这个窟窿是靠假模型发现的,不是靠看代码。Day 192 的练习 4 用真模型也找到了,但要靠真调用、真付钱、还得看账本。有了固定每次 120 token 的假模型,一个断言就够了:`usage` 的总数等于「调用次数 × 120」。下面的测试会把它钉住。

## 第二个漏洞:模型叫不动,不能让程序崩

Day 189 体检第 1 类:模型 API 连不上,整个 `run_agent` 抛出 `APIConnectionError`,前面几步的成果跟着一起丢。Day 190 加了重试,但重试用尽之后异常还是会抛出来。今天在 `RobustAgent.run` 里接住它,返回 `status="llm_error"`、`needs_human=True`、`error` 里放异常类名,这样上游(接口层、日志、监控)能分清:

- `llm_error`:模型服务的问题(重试 4 次都失败,或者 401 这种根本没重试的),要找运维或者看 key;
- `max_steps`/`budget`/`timeout`/`loop`:任务本身的问题,通常要看轨迹、改提示词或工具。

两类问题的负责人不同,处理方式也不同,混成一个「失败」会让排查很痛苦。接哪些异常?`openai.APIError` 是 SDK 所有异常的基类,连接错误、429、5xx、401、400 都是它的子类,所以一个 `except openai.APIError` 全接。不接 `Exception`:代码本身的 bug(比如 `KeyError`、`AssertionError`)不该被伪装成「模型服务不可用」。

## 拼成 RobustAgent

终于到拼装。先说三个设计决定,再看代码。

**决定一:重试放在一个小适配器里,主循环和收尾共用。** `chat_with_retry(llm, messages, **kw)` 的第一个参数是 `llm`,而 `wrap_up` 想要的是一个有 `chat` 方法的对象(`SupportsChat`)。写一个 `RetryingChat` 类,`chat` 方法转调 `chat_with_retry`,它自己也有 `chat`,就能同时塞给主循环和 `wrap_up`。这样收尾那次调用也享受重试,不用在 `wrap_up` 里再写一遍。

**决定二:把「调一次模型」和「执行一个工具」拆成两个小方法 `_model_step`、`_tool_step`。** 主循环只管流程,这两个方法管细节。明天 Day 194 要给每一步计时、记日志,继承一下覆盖这两个方法就行,不用改主循环;练习 2 也靠它。

**决定三:`run` 里的状态全放局部变量,不放 `self`。** `guard`、`usage`、`start` 都是每次 `run` 新建的。这样同一个 `RobustAgent` 对象连续 `run` 两次,计数不会串。只有 `messages` 同时留一份在 `self.messages`,因为测试和日志要在跑完之后翻它。

```python
# agent-zero-lab/part03/robust_agent.py  Day 193:把 Day 190–192 的四个零件拼成一个循环。Day 194 的 LoggedAgent 会继承它
import time
from typing import Any

import openai

from common.llm import ChatResult
from part03.agent_loop import ToolRegistry
from part03.budget import AgentResult, Limits, over_budget, wrap_up
from part03.loop_guard import LOOP_MSG, LoopGuard
from part03.retry_llm import SupportsChat, chat_with_retry, make_llm
from part03.tool_guard import guarded_call


class RetryingChat:
    """给任何有 chat 方法的东西套上 Day 190 的重试。主循环和收尾共用它,收尾那次调用也有重试。"""

    def __init__(self, llm: SupportsChat) -> None:
        self.llm = llm

    def chat(self, messages: list[dict[str, Any]], **kw: Any) -> ChatResult:
        return chat_with_retry(self.llm, messages, **kw)


class RobustAgent:
    def __init__(self, registry: ToolRegistry, system: str, limits: Limits | None = None,
                 llm: SupportsChat | None = None, verbose: bool = True) -> None:
        self.registry = registry
        self.system = system
        self.limits = limits or Limits()
        self.llm = RetryingChat(llm or make_llm())  # 不传就建一个真的,SDK 自带重试已关
        self.verbose = verbose
        self.messages: list[dict[str, Any]] = []  # 每次 run 重新开始;跑完留着,测试和日志要看

    # ---- 两个可以被子类替换的小步骤(Day 194 的 LoggedAgent 靠它们计时) ----
    def _model_step(self, messages: list[dict[str, Any]]) -> ChatResult:
        return self.llm.chat(messages, tools=self.registry.schemas)

    def _tool_step(self, name: str, arguments: str, elapsed: float) -> str:
        return guarded_call(self.registry.call, name, arguments,
                            self._tool_timeout(elapsed), self.limits.max_tool_chars)

    def _tool_timeout(self, elapsed: float) -> float:
        return self.limits.tool_timeout  # elapsed 是任务已经跑了多久;练习 2 会用它

    # ---- 主循环 ----
    def run(self, user: str) -> AgentResult:
        limits = self.limits
        guard = LoopGuard(limits.max_repeats)  # 每次 run 一个新的,计数不串任务
        self.messages = [{"role": "system", "content": self.system}, {"role": "user", "content": user}]
        messages = self.messages
        usage = {"prompt_tokens": 0, "completion_tokens": 0}
        start = time.monotonic()
        step = 0
        while True:
            step += 1
            hit = over_budget(limits, step, sum(usage.values()), time.monotonic() - start)
            if hit:
                status, reason = hit
                answer = wrap_up(self.llm, messages, self.registry.schemas, reason, usage)
                return AgentResult(answer, status, step - 1, dict(usage), True)
            try:
                r = self._model_step(messages)
            except openai.APIError as e:  # 重试用尽的临时错误,或者 401 这种不重试的错误
                name = type(e).__name__
                answer = f"模型服务暂时不可用({name}),已转人工同事跟进。"
                messages.append({"role": "assistant", "content": answer})
                return AgentResult(answer, "llm_error", step - 1, dict(usage), True, name)
            usage["prompt_tokens"] += r.prompt_tokens
            usage["completion_tokens"] += r.completion_tokens
            messages.append(r.message)
            calls = r.message.get("tool_calls") or []
            if self.verbose:
                print(f"[step {step}] 累计 {sum(usage.values())} tok | 调用 {[c['function']['name'] for c in calls]}")
            if not calls:
                return AgentResult(r.content, "ok", step, dict(usage))
            stop = False
            for tc in calls:
                name, args = tc["function"]["name"], tc["function"]["arguments"]
                verdict = guard.check(name, args)
                if verdict == "run":
                    out = self._tool_step(name, args, time.monotonic() - start)
                else:
                    out = LOOP_MSG
                stop = stop or verdict == "stop"
                if self.verbose:
                    print(f"    {name}({args}) -> {verdict}")
                messages.append({"role": "tool", "tool_call_id": tc["id"], "content": out})
            if stop:
                answer = wrap_up(self.llm, messages, self.registry.schemas, "检测到重复调用,任务可能陷入了循环", usage)
                return AgentResult(answer, "loop", step, dict(usage), True)
```

<div class="line-notes">

- `import time` 只用 `time.monotonic()` 掐表,Day 192 讲过:只往前走的时钟,专门算耗时。
- `import openai` 用到 `openai.APIError` 这个基类。
- `from common.llm import ChatResult` 只为了写返回类型。
- `from part03.agent_loop import ToolRegistry` Day 170 的注册表,有 `schemas` 和 `call`。
- `from part03.budget import AgentResult, Limits, over_budget, wrap_up` Day 192 的四样东西,今天它们终于在同一个文件里被用到。
- `from part03.loop_guard import LOOP_MSG, LoopGuard` Day 192 的循环检测。
- `from part03.retry_llm import SupportsChat, chat_with_retry, make_llm` Day 190 的三样:协议、带重试的调用、关掉 SDK 重试的客户端工厂。
- `from part03.tool_guard import guarded_call` Day 191 的超时加截断。
- `class RetryingChat:` 适配器。「给一个东西套上另一种行为,对外还是同一个接口」,前端叫包装器或者装饰器模式,和给 `fetch` 包一层自动重试的函数是同一个思路。
- `def chat(self, messages: list[dict[str, Any]], **kw: Any) -> ChatResult:` 签名和 `SupportsChat` 一样,所以它自己也满足协议。
- `return chat_with_retry(self.llm, messages, **kw)` 转调 Day 190 的函数,所有关键字参数(`tools`、`tool_choice`)原样转发。重试 4 次、只重试临时错误,都是 `chat_with_retry` 装饰器里定的。
- `llm: SupportsChat | None = None, verbose: bool = True) -> None:` 参数里 `llm` 是测试的入口:传 `FakeClient` 就是假模型,不传就用真的。`verbose` 控制要不要打印每一步,测试里关掉,免得满屏输出。
- `self.limits = limits or Limits()` 不传就用默认的六个阈值。
- `self.llm = RetryingChat(llm or make_llm())  # 不传就建一个真的,SDK 自带重试已关` `make_llm()` 是 Day 190 的工厂,`max_retries=0`,避免 SDK 那层重试和 tenacity 叠加成 3 × 4 = 12 次。`llm or make_llm()`:传了就用传的,没传才建,所以测试里 `.env` 没有 key 也不会报错。
- `self.messages: list[dict[str, Any]] = []  # 每次 run 重新开始;跑完留着,测试和日志要看` 对话历史的出口。
- `def _model_step(self, messages: list[dict[str, Any]]) -> ChatResult:` 一步里「调模型」的部分,方法名前的下划线是 Python 约定的「内部用,子类可以覆盖」。
- `return self.llm.chat(messages, tools=self.registry.schemas)` 经过 `RetryingChat`,所以这里自带重试。
- `def _tool_step(self, name: str, arguments: str, elapsed: float) -> str:` 一步里「执行一个工具」的部分。`elapsed` 是任务已经跑了多久。
- `return guarded_call(self.registry.call, name, arguments,` Day 191 的函数:把 `registry.call` 丢进线程池限时等,超时返回报错 JSON,结果过长就截断。第一个参数传的是**方法本身**(不加括号),`guarded_call` 内部再 `POOL.submit(call, name, arguments)`。
- `def _tool_timeout(self, elapsed: float) -> float:` 单独拎成一个方法,默认永远返回 `limits.tool_timeout`。练习 2 的子类会让它「不超过任务剩下的时间」。
- `limits = self.limits` 取个短名字,下面用得多。
- `guard = LoopGuard(limits.max_repeats)  # 每次 run 一个新的,计数不串任务` Day 192 的误区之一:`LoopGuard` 跨任务复用,计数会累加到下一个任务。
- `self.messages = [{"role": "system", "content": self.system}, {"role": "user", "content": user}]` 每次 `run` 重新开始,从 system 和这次的 user 起。注意这是**单轮任务**的 Agent,多轮对话怎么管历史,[Day 152](/blog/agent-zero/day-152-chatbot-1/) 的聊天机器人讲过。
- `messages = self.messages` 同一个列表起两个名字,不是复制。后面往 `messages` 里 `append`,`self.messages` 也跟着变。
- `usage = {"prompt_tokens": 0, "completion_tokens": 0}` 本次任务的账,`wrap_up` 也会往里加。
- `start = time.monotonic()` 掐表。
- `step = 0` 和 `while True:` 步数交给 `over_budget` 判断,不用 `for ... in range(max_steps)`。
- `hit = over_budget(limits, step, sum(usage.values()), time.monotonic() - start)` 每一步调模型**之前**问一句:撞线了没有?返回 `(状态, 原因)` 或 `None`。
- `answer = wrap_up(self.llm, messages, self.registry.schemas, reason, usage)` 撞线收尾。传的是 `self.llm`,也就是 `RetryingChat`,所以收尾也有重试;最后一个 `usage` 是今天补的。
- `return AgentResult(answer, status, step - 1, dict(usage), True)` 步数写 `step - 1`,因为第 `step` 步其实没走。`dict(usage)` 复制一份,避免调用方拿到的结果后续被改动。注意这一行在 `wrap_up` 之后,复制出来的已经包含收尾那笔。
- `r = self._model_step(messages)` 放在 `try` 里。
- `except openai.APIError as e:  # 重试用尽的临时错误,或者 401 这种不重试的错误` 接住 SDK 所有异常的基类。429/5xx/连接错误会先被 `chat_with_retry` 重试 4 次,用尽才到这里;401 一次就到这里。
- `name = type(e).__name__` 取异常类名,比如 `"RateLimitError"`。
- `answer = f"模型服务暂时不可用({name}),已转人工同事跟进。"` 给用户的话。不暴露细节,但带上类名方便客服转述。
- `messages.append({"role": "assistant", "content": answer})` 和 `wrap_up` 一样,给用户看到的话也进历史,日志里就能看到最终说了什么。
- `return AgentResult(answer, "llm_error", step - 1, dict(usage), True, name)` 第六个位置参数是今天加的 `error`,放异常类名。步数同样是 `step - 1`:这一步没成功。
- `usage["prompt_tokens"] += r.prompt_tokens` 模型调用成功才累加。
- `messages.append(r.message)` 模型这一步的完整回复(含 `tool_calls`)要进历史。
- `calls = r.message.get("tool_calls") or []` 没有工具调用就是空列表。
- `if self.verbose:` 只在需要时打印这一步的轨迹,格式和 Day 192 一样。
- `return AgentResult(r.content, "ok", step, dict(usage))` 没有工具调用就是最终回答,正常结束,不转人工。
- `stop = False` 这一步里有没有出现「拦过还来」。
- `verdict = guard.check(name, args)` 先过循环检测。
- `out = self._tool_step(name, args, time.monotonic() - start)` 只有 `run` 才真执行;第三个参数是此刻已经跑了多久。
- `out = LOOP_MSG` `block` 和 `stop` 都不执行,回那句提醒。
- `stop = stop or verdict == "stop"` 一步里多个调用,有一个是 `stop` 就要收尾。
- `messages.append({"role": "tool", "tool_call_id": tc["id"], "content": out})` 被拦的调用也**必须**回一条 tool 消息,id 要对上,否则下一次请求会 400(练习 4 专门测这个)。
- `if stop:` 等这一步所有调用都回完话再收尾,保证历史是完整的。
- `answer = wrap_up(self.llm, messages, self.registry.schemas, "检测到重复调用,任务可能陷入了循环", usage)` 循环收尾,同样记账。
- `return AgentResult(answer, "loop", step, dict(usage), True)` 状态 `loop`,步数是 `step`:这一步的工具调用已经处理了。

</div>

### 零件对照:大代码的哪一行是哪天的

| 零件(哪天) | 在 `robust_agent.py` 里是哪几行 | 删掉它会怎样 |
| --- | --- | --- |
| `make_llm` + `chat_with_retry`(Day 190) | `RetryingChat.chat`、`__init__` 里的 `make_llm()` | 一次 429 就让整个任务崩 |
| `guarded_call`(Day 191) | `_tool_step` | 卡住的工具让用户干等;21 万字符的日志整个塞进上下文 |
| `LoopGuard`(Day 192) | `guard = LoopGuard(...)`、`verdict = guard.check(...)` 那几行、`if stop:` | 同一个调用白烧到步数上限 |
| `over_budget` + `wrap_up`(Day 192) | `hit = over_budget(...)` 那一段、两处 `wrap_up(...)` | 撞线只回一句「到了最大步数」 |
| `AgentResult.error`、`llm_error`(今天) | `except openai.APIError` 那一段 | 模型叫不动,异常一路冒出去 |
| `usage` 记账(今天补的) | `wrap_up(..., usage)` 的最后一个参数 | 撞线的任务少算一笔钱 |

先随手跑一次,确认拼起来没有接错线:

```bash
uv run python - <<'PY'
from part03.robust_agent import RobustAgent
from part03.failure_zoo import reg
from part03.fake_client import FakeClient, call
fake = FakeClient([[call("get_weather", city="杭州")], "杭州 21 度。"])
print(RobustAgent(reg, "你是助手。", llm=fake).run("杭州天气?"))
PY
```

```text
[step 1] 累计 120 tok | 调用 ['get_weather']
    get_weather({"city": "杭州"}) -> run
[step 2] 累计 240 tok | 调用 []
AgentResult(answer='杭州 21 度。', status='ok', steps=2, usage={'prompt_tokens': 200, 'completion_tokens': 40}, needs_human=False, error='')
```

两步,正常结束,`usage` 200 + 40 = 240,和两次调用各 120 吻合。

## 五个离线测试

「离线」的意思:不联网、不花钱、不真等、结果每次一样。下面五个测试一共 8 个用例(有两个测试用了参数化,下面解释),在笔记本上 0.9 秒跑完。

先看它们共用的两个替身。一个是 Day 190 用过的 `waits`:把 tenacity 的 `sleep` 换成只记账不睡觉的假函数,测试里 429 重试要等的 1 秒、2 秒、4 秒一瞬间就过去,还能检查「该等多久」。Day 190 把它写在 `test_retry_llm.py` 里,今天五个测试都要用,所以挪进 `tests/conftest.py`,pytest 会自动加载这个文件,里面的 fixture 所有测试文件都能直接用。(`test_retry_llm.py` 里原来那份不用删,同名的 fixture 在文件里优先。)

```python
# agent-zero-lab/tests/conftest.py  Day 193:所有测试共用的替身。pytest 会自动加载这个文件
import pytest

from part03.retry_llm import chat_with_retry


@pytest.fixture
def waits(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    """把 tenacity 的 sleep 换成只记账不睡觉的假函数(Day 190 test_retry_llm.py 里那个,搬过来)。"""
    record: list[float] = []
    monkeypatch.setattr(chat_with_retry.retry, "sleep", record.append)
    return record
```

<div class="line-notes">

- `from part03.retry_llm import chat_with_retry` 要换 `sleep` 的就是它。tenacity 装饰过的函数上有个 `.retry` 属性,里面存着重试策略对象。
- `@pytest.fixture` 把函数标成 fixture。测试函数的参数里写一个同名参数(`waits`),pytest 就先调用这个函数,把返回值塞进来。相当于 jest 的 `beforeEach` 里准备好一个变量再传给测试。
- `def waits(monkeypatch: pytest.MonkeyPatch) -> list[float]:` fixture 自己也可以要别的 fixture:`monkeypatch` 是 pytest 自带的,能临时改对象的属性,测试一结束自动改回来。
- `record: list[float] = []` 记账本,每次「该睡多久」会被 append 进去。
- `monkeypatch.setattr(chat_with_retry.retry, "sleep", record.append)` 把 `retry.sleep` 换成 `record.append`:tenacity 本来要调 `time.sleep(1.45)`,现在变成调 `record.append(1.45)`,只记一笔、立刻返回。`record.append` 是方法本身(没有括号)。
- `return record` 测试拿到这个列表,事后可以断言 `len(waits) == 2`(睡了两次)。

</div>

另一个替身是工具表。测试里造一个专用的 `ToolRegistry`,五个假工具各有分工:

```python
# agent-zero-lab/tests/test_robust_agent.py  Day 193:用假模型把 RobustAgent 的失败路径一条条钉住,不联网、不花钱
import time
from typing import Any

import pytest

from part03.agent_loop import ToolRegistry
from part03.budget import Limits
from part03.fake_client import FakeClient, call, fake_http_error
from part03.loop_guard import LOOP_MSG
from part03.robust_agent import RobustAgent

reg = ToolRegistry()


@reg.tool
def echo(text: str) -> str:
    """原样返回。"""
    return text


@reg.tool
def nap(text: str) -> str:
    """睡 0.1 秒再返回,用来消耗时间预算。"""
    time.sleep(0.1)
    return text


@reg.tool
def slow(text: str) -> str:
    """睡 1 秒,用来超时。"""
    time.sleep(1)
    return text


@reg.tool
def big(text: str) -> str:
    """返回 10000 个字符。"""
    return text * 10_000


@reg.tool
def boom(text: str) -> str:
    """永远抛异常。"""
    raise ConnectionError("upstream reset by peer")


def assert_every_tool_call_has_a_reply(messages: list[dict[str, Any]]) -> None:
    """历史完整:assistant 发出的每个 tool_call_id,都有一条 tool 消息回它,否则下一次请求会 400。"""
    asked = [tc["id"] for m in messages if m["role"] == "assistant" for tc in m.get("tool_calls", [])]
    replied = [m["tool_call_id"] for m in messages if m["role"] == "tool"]
    assert asked == replied


def test_transient_errors_are_retried_and_task_finishes(waits: list[float]) -> None:
    fake = FakeClient([fake_http_error(429), fake_http_error(503), "好的"])
    r = RobustAgent(reg, "sys", llm=fake, verbose=False).run("hi")
    assert (r.status, r.steps, r.needs_human) == ("ok", 1, False)
    assert len(fake.calls) == 3 and len(waits) == 2
    assert r.usage == {"prompt_tokens": 100, "completion_tokens": 20}  # 失败的两次没有 usage,只算成功那一次


@pytest.mark.parametrize("status, error, attempts", [(429, "RateLimitError", 4), (401, "AuthenticationError", 1)])
def test_unreachable_model_returns_llm_error(waits: list[float], status: int, error: str, attempts: int) -> None:
    fake = FakeClient([fake_http_error(status)] * attempts)
    agent = RobustAgent(reg, "sys", llm=fake, verbose=False)
    r = agent.run("hi")
    assert (r.status, r.error, r.needs_human) == ("llm_error", error, True)
    assert len(fake.calls) == attempts and len(waits) == attempts - 1  # 429 试满 4 次,401 一次就放弃
    assert r.usage == {"prompt_tokens": 0, "completion_tokens": 0}
    assert error in r.answer and agent.messages[-1]["content"] == r.answer


def test_loop_is_stopped_and_wrap_up_tokens_are_counted() -> None:
    fake = FakeClient([[call("echo", text="a")]] * 4 + ["已查到 a,其余没做。"])
    agent = RobustAgent(reg, "sys", llm=fake, verbose=False)
    r = agent.run("hi")
    assert (r.status, r.steps, r.needs_human, r.answer) == ("loop", 4, True, "已查到 a,其余没做。")
    assert len(fake.calls) == 5 and fake.calls[-1]["tool_choice"] == "none"
    assert r.usage == {"prompt_tokens": 500, "completion_tokens": 100}  # 5 次调用都在账上,包括收尾那次
    replies = [m["content"] for m in agent.messages if m["role"] == "tool"]
    assert replies == ['"a"', '"a"', LOOP_MSG, LOOP_MSG]  # 前两次真执行,后两次被拦
    assert_every_tool_call_has_a_reply(agent.messages)


@pytest.mark.parametrize("limits, tool_steps, status", [
    (Limits(max_steps=2), 2, "max_steps"),
    (Limits(max_tokens=200), 2, "budget"),  # 第 3 步开始前累计 240 > 200
    (Limits(max_seconds=0.05), 1, "timeout"),  # nap 睡了 0.1 秒,第 2 步开始前已经超了
])
def test_each_budget_line_triggers_a_wrap_up(limits: Limits, tool_steps: int, status: str) -> None:
    fake = FakeClient([[call("nap", text=str(i))] for i in range(tool_steps)] + ["部分答案"])
    r = RobustAgent(reg, "sys", limits, llm=fake, verbose=False).run("hi")
    assert (r.status, r.needs_human, r.answer) == (status, True, "部分答案")
    assert len(fake.calls) == tool_steps + 1 and fake.calls[-1]["tool_choice"] == "none"
    assert r.usage == {"prompt_tokens": 100 * (tool_steps + 1), "completion_tokens": 20 * (tool_steps + 1)}


def test_tool_failures_become_messages_and_the_run_continues() -> None:
    step = [call("slow", text="a"), call("big", text="x"), call("boom", text="a"), call("nosuch", text="a"),
            ("echo", '{"text": 杭州}')]  # 最后一个:参数不是合法 JSON
    fake = FakeClient([step, "都处理完了。"])
    agent = RobustAgent(reg, "sys", Limits(tool_timeout=0.3, max_tool_chars=200), llm=fake, verbose=False)
    r = agent.run("hi")
    assert (r.status, r.steps) == ("ok", 2)
    replies = [m["content"] for m in agent.messages if m["role"] == "tool"]
    assert "超过 0.3 秒" in replies[0]
    assert "已截断" in replies[1] and len(replies[1]) < 300
    assert "ConnectionError" in replies[2]
    assert "没有叫 nosuch 的工具" in replies[3]
    assert "JSONDecodeError" in replies[4]
    assert_every_tool_call_has_a_reply(agent.messages)
```

<div class="line-notes">

- `import time` 假工具要 `sleep`。
- `import pytest` 用到 `pytest.mark.parametrize`。
- `from part03.fake_client import FakeClient, call, fake_http_error` 今天造的三样替身。
- `from part03.loop_guard import LOOP_MSG` 被拦下时回给模型的那句提醒,断言要拿它做比较。
- `reg = ToolRegistry()` 测试专用的工具表,只有下面五个工具,和 `failure_zoo.py` 里的那个互不相干。
- `def echo(text: str) -> str:` 原样返回,最简单的工具。`@reg.tool` 会读它的名字、类型标注和 docstring 生成 schema(Day 169)。因为 `call` 把返回值 `json.dumps` 一遍,`echo("a")` 回给模型的是带引号的 `'"a"'`,测试里断言的就是这个。
- `def nap(text: str) -> str:` 睡 0.1 秒,用来「消耗时间预算」。
- `def slow(text: str) -> str:` 睡 1 秒,用来超时。注意线程池里的它超时后还会睡完那一秒才结束,但主线程不等了。
- `return text * 10_000` 字符串乘整数是重复拼接,`"x" * 10_000` 是一万个 `x`,远超测试里设的 200 字符上限。
- `raise ConnectionError("upstream reset by peer")` 和 Day 189 的 `flaky_lookup` 一样,模拟外部接口断连。
- `def assert_every_tool_call_has_a_reply(messages: list[dict[str, Any]]) -> None:` 一个检查历史是否完整的辅助函数,下面三个测试用它。
- `asked = [tc["id"] for m in messages if m["role"] == "assistant" for tc in m.get("tool_calls", [])]` 嵌套的列表推导式:先遍历所有消息,只看 assistant 的,再遍历它的 `tool_calls`,取每个 id。读法是「两层 for 从左往右」,相当于 JS 的 `messages.filter(...).flatMap(m => m.tool_calls ?? []).map(tc => tc.id)`。
- `replied = [m["tool_call_id"] for m in messages if m["role"] == "tool"]` 所有 tool 消息里回的 id。
- `assert asked == replied` 两个列表**逐项相等**:每个调用都有回复,顺序也一致。少一条,下一次请求 400。
- `def test_transient_errors_are_retried_and_task_finishes(waits: list[float]) -> None:` 测试一:临时错误会重试,任务照常完成。参数 `waits` 触发上面的 fixture。
- `fake = FakeClient([fake_http_error(429), fake_http_error(503), "好的"])` 剧本:连续两次临时错误,第三次成功。
- `r = RobustAgent(reg, "sys", llm=fake, verbose=False).run("hi")` 建、跑、拿结果一行写完。`"sys"` 是随便写的系统提示,假模型不看。
- `assert (r.status, r.steps, r.needs_human) == ("ok", 1, False)` 元组对元组比较,一行断言三个值。`steps` 是 1:重试发生在 `chat_with_retry` 里面,对循环来说只是一步。
- `assert len(fake.calls) == 3 and len(waits) == 2` 假模型被调了 3 次(两次失败 + 一次成功),睡了 2 次。
- `assert r.usage == {"prompt_tokens": 100, "completion_tokens": 20}` 失败的两次没有 token,账上只有成功的那一次,正好 100 + 20。如果有人把失败重试也错误地记了账,这一行会红。
- `@pytest.mark.parametrize("status, error, attempts", [(429, "RateLimitError", 4), (401, "AuthenticationError", 1)])` 参数化:同一个测试函数跑两遍,每遍用一组参数,相当于 jest 的 `test.each`。第一组:429 是临时错误,试满 4 次;第二组:401 不是,试 1 次就放弃。pytest 报告里会写成 `[429-RateLimitError-4]` 这样的名字,哪一组红了一眼就知道。
- `fake = FakeClient([fake_http_error(status)] * attempts)` 列表乘整数是重复:429 那组是 4 次 429,401 那组是 1 次 401。
- `agent = RobustAgent(reg, "sys", llm=fake, verbose=False)` 这个测试要翻 `agent.messages`,所以把 agent 单独存成变量。
- `assert (r.status, r.error, r.needs_human) == ("llm_error", error, True)` 状态、异常类名、转人工,三个一起断言。
- `assert len(fake.calls) == attempts and len(waits) == attempts - 1` 429 那组调了 4 次、等了 3 次;401 那组调了 1 次、一次没等。n 次尝试之间只有 n - 1 次间隔。
- `assert r.usage == {"prompt_tokens": 0, "completion_tokens": 0}` 一次都没成功,账上是零。
- `assert error in r.answer and agent.messages[-1]["content"] == r.answer` 给用户的话里带异常类名,而且历史最后一条就是这句话。
- `fake = FakeClient([[call("echo", text="a")]] * 4 + ["已查到 a,其余没做。"])` 循环测试的剧本:同一幕演四遍,再加一句最终的文字(收尾那次拿到)。`[[...]] * 4` 是把「一个元素的列表」重复四次,得到四个指向同一个列表对象的引用,只读不改,没问题。
- `assert (r.status, r.steps, r.needs_human, r.answer) == ("loop", 4, True, "已查到 a,其余没做。")` 第 4 步触发收尾,状态 `loop`,答案就是剧本最后那句。
- `assert len(fake.calls) == 5 and fake.calls[-1]["tool_choice"] == "none"` 模型被调了 5 次(4 步加收尾),最后一次传了 `tool_choice="none"`。`calls[-1]` 是最后一项,相当于 JS 的 `calls.at(-1)`。
- `assert r.usage == {"prompt_tokens": 500, "completion_tokens": 100}` 今天补的账:5 次调用 × (100 + 20)。把 `wrap_up` 里那个 `if usage is not None:` 删掉,这一行就会红。
- `replies = [m["content"] for m in agent.messages if m["role"] == "tool"]` 取出所有 tool 消息的内容。
- `assert replies == ['"a"', '"a"', LOOP_MSG, LOOP_MSG]` 一行讲完这个测试的故事:前两次真执行(`echo` 回了 `"a"`),第三、四次被拦,回的是那句提醒。
- `@pytest.mark.parametrize("limits, tool_steps, status", [` 第二个参数化:三组不同的预算,各自应该撞出什么状态。
- `(Limits(max_steps=2), 2, "max_steps")` 步数上限 2:走完第 2 步,第 3 步开始前撞线。
- `(Limits(max_tokens=200), 2, "budget"),  # 第 3 步开始前累计 240 > 200` 每次 120:第 1 步前 0,第 2 步前 120,都不超 200;第 3 步前 240 > 200,撞线。
- `(Limits(max_seconds=0.05), 1, "timeout"),  # nap 睡了 0.1 秒,第 2 步开始前已经超了` 工具睡 0.1 秒,比 0.05 秒的预算还长,所以只走一步。
- `fake = FakeClient([[call("nap", text=str(i))] for i in range(tool_steps)] + ["部分答案"])` 剧本是动态拼的:`tool_steps` 步工具调用(参数各不相同,免得先触发循环检测),最后一幕是收尾的回答。`str(i)` 把数字转成字符串。
- `assert len(fake.calls) == tool_steps + 1 and fake.calls[-1]["tool_choice"] == "none"` 调用次数 = 工具步数 + 一次收尾。
- `assert r.usage == {"prompt_tokens": 100 * (tool_steps + 1), "completion_tokens": 20 * (tool_steps + 1)}` 三组预算下收尾的账都对得上。
- `step = [call("slow", text="a"), call("big", text="x"), call("boom", text="a"), call("nosuch", text="a"),` 工具层四类失败塞进同一步:超时、结果过长、抛异常、不存在的工具,再加一个参数不是合法 JSON(`杭州` 没加引号)。
- `agent = RobustAgent(reg, "sys", Limits(tool_timeout=0.3, max_tool_chars=200), llm=fake, verbose=False)` 把超时调到 0.3 秒、字符上限调到 200,测试才快、才好构造。
- `assert (r.status, r.steps) == ("ok", 2)` 五个工具全出事,Agent 没崩,第 2 步模型看完错误给了最终回答,正常结束。
- `assert "超过 0.3 秒" in replies[0]` 第一个工具超时,回的是超时报错。`in` 判断子串,相当于 JS 的 `includes`。
- `assert "已截断" in replies[1] and len(replies[1]) < 300` 过长的结果被截断:200 字符加一段说明,不到 300。
- `assert "ConnectionError" in replies[2]` 工具抛的异常变成了 `{"error": "ConnectionError: ..."}`。
- `assert "没有叫 nosuch 的工具" in replies[3]` 不存在的工具,回的是「没有叫 … 的工具,可用的有 …」。
- `assert "JSONDecodeError" in replies[4]` 参数不是合法 JSON,回的是解析报错。
- `assert_every_tool_call_has_a_reply(agent.messages)` 五个调用,五条回复,一条不少。

</div>

```bash
uv run pytest -q
```

```text
..................                                                       [100%]
18 passed in 1.40s
```

Day 190 的 4 个、Day 191 的 3 个、Day 192 的 3 个,加今天的 8 个用例,一共 18 个,全绿。用 `-v` 看今天这个文件的每个用例的名字:

```bash
uv run pytest tests/test_robust_agent.py -v
```

```text
tests/test_robust_agent.py::test_transient_errors_are_retried_and_task_finishes PASSED [ 12%]
tests/test_robust_agent.py::test_unreachable_model_returns_llm_error[429-RateLimitError-4] PASSED [ 25%]
tests/test_robust_agent.py::test_unreachable_model_returns_llm_error[401-AuthenticationError-1] PASSED [ 37%]
tests/test_robust_agent.py::test_loop_is_stopped_and_wrap_up_tokens_are_counted PASSED [ 50%]
tests/test_robust_agent.py::test_each_budget_line_triggers_a_wrap_up[limits0-2-max_steps] PASSED [ 62%]
tests/test_robust_agent.py::test_each_budget_line_triggers_a_wrap_up[limits1-2-budget] PASSED [ 75%]
tests/test_robust_agent.py::test_each_budget_line_triggers_a_wrap_up[limits2-1-timeout] PASSED [ 87%]
tests/test_robust_agent.py::test_tool_failures_become_messages_and_the_run_continues PASSED [100%]
```

### 读一个测试:循环收尾,一步步追踪

拿第三个测试走一遍,把每一步 `FakeClient` 演什么、`RobustAgent` 做什么、账上多少写成表。剧本是 `[call("echo", text="a")] × 4`,再加最终一句话。

| 第几次调模型 | 剧本演的 | `guard.check` | Agent 做什么 | 累计 token |
| --- | --- | --- | --- | --- |
| 1 | 调 `echo("a")` | `run` | 真执行,tool 消息是 `"a"` | 120 |
| 2 | 同一个调用 | `run` | 真执行 | 240 |
| 3 | 同一个调用 | `block` | 不执行,回 `LOOP_MSG` | 360 |
| 4 | 同一个调用 | `stop` | 不执行,回 `LOOP_MSG`,这一步结束后收尾 | 480 |
| 5(收尾) | 「已查到 a,其余没做。」 | | `tool_choice="none"`,答案就是这句 | 600 |

把 `a.messages` 打出来是这样(我跑的,每条消息只列角色和前 30 个字):

```text
system    你是助手。
user      查天气
assistant (空,带 tool_calls)
tool      {"city": "杭州", "temp": 21}
assistant (空,带 tool_calls)
tool      {"city": "杭州", "temp": 21}
assistant (空,带 tool_calls)
tool      {"error": "这个调用和之前完全一样,结果不会变。请
assistant (空,带 tool_calls)
tool      {"error": "这个调用和之前完全一样,结果不会变。请
user      (系统提示:检测到重复调用,任务可能陷入了循环,不能再调用工
assistant 已查到杭州 21 度,其余没做。
```

(这是用 `get_weather` 杭州重演了一遍,和测试里的 `echo` 一样的结构。)最后两条正是 `wrap_up` 补的:一条 user 提示、一条 assistant 回答。四个 tool 调用,四条回复,没有缺的。

`FakeClient.calls` 也记下了每次收到几条消息:`2、4、6、8、11`,以及最后一次的 `tool_choice` 是 `'none'`。2 → 4 → 6 → 8 每步加两条(assistant 发调用、tool 回结果),第 5 次(收尾)前多了第 4 步的 assistant 和 tool 两条,再加一条 user 的收尾提示,所以是 11。

### 参数化是什么

`@pytest.mark.parametrize("limits, tool_steps, status", [...])` 是今天第一次出现的写法,你可以把它想成 jest 的 `test.each`:一个测试函数、多组输入,每组独立算一个用例,哪组红了报告里会写清楚是哪组。如果不用它,你要把「预算撞线」写成三个几乎一样的函数,改一处要改三处。用的时机很简单:**测试逻辑一样、只有输入和期望值不同**,就参数化。逻辑不同(比如「工具层四类失败」)就别硬凑。

### 为什么这样的测试有用

回头想想这五个测试各自**钉住了哪一条防线**:

- 测试一钉住「临时错误会被重试,而且只有成功的那次进账」。
- 测试二钉住「重试用尽和 401 都返回 `llm_error`,而且 401 不重试」。
- 测试三钉住「循环被拦、历史完整、收尾禁用工具、收尾的 token 进账」。
- 测试四钉住「三条预算线各自撞出各自的状态」。
- 测试五钉住「工具层四种失败变成给模型看的消息,任务不崩」。

注意它们都**不测模型说得好不好**,只测「模型按这个剧本演,Agent 的反应对不对」。这是离线测试的边界:能确定性验证的(控制流、状态、账、历史完整性)全部离线测掉;「回答质量好不好」这种事才需要真模型加评测(第六部分)。把能确定的部分剥出来,是 Agent 工程化最实用的一招。

## 体检报告重跑:九类全部接住

测试绿了,再回到起点。Day 189 的 `failure_zoo.py` 把 `run_agent` 拿去撞九类失败,结果是「接住三类、没接住六类」。今天换上 `RobustAgent`,同样的九类再撞一遍。前七类用 FakeClient 按剧本演,最后两类(模型 API 连不上、key 写错)用**真的** SDK,不过前者连本机一个没人监听的端口、后者发一个必然被拒的请求,都不花钱。

```python
# agent-zero-lab/part03/failure_zoo_193.py  把 Day 189 的九类失败全部交给 RobustAgent,看体检报告还剩几个「没有」
import json
import time

from part03.budget import Limits
from part03.failure_zoo import reg
from part03.fake_client import FakeClient, Step, call
from part03.retry_llm import make_llm
from part03.robust_agent import RobustAgent

PARTIAL = "已经查到的结果见上,其余没有完成。"
SCRIPTS: dict[str, list[Step]] = {
    "2 工具卡住": [[call("slow_lookup", order_id="O1")], "订单接口暂时没有响应,请稍后再查。"],
    "3 工具抛异常": [[call("flaky_lookup", order_id="O1")], "订单接口连不上,请稍后再查。"],
    "4 参数不是合法 JSON": [[("get_weather", '{"city": 杭州}')], "杭州天气:21 度。"],
    "5 调了不存在的工具": [[call("search_web", q="杭州天气")], "我没有联网搜索的工具。"],
    "6 同一个调用反复发": [[call("get_weather", city="杭州")]] * 4 + [PARTIAL],
    "7 结果过长": [[call("dump_logs", day="2026-10-22")], "日志太长,我只看到开头,请给我具体的时间段。"],
    "8/9 停不下来,撞线": [[call("get_weather", city=c)] for c in ["杭州", "上海", "北京", "广州", "深圳", "成都"]] + [PARTIAL],
}


for name, script in SCRIPTS.items():
    fake = FakeClient(script)
    agent = RobustAgent(reg, "你是助手。", Limits(max_steps=6, tool_timeout=1), llm=fake, verbose=False)
    start = time.perf_counter()
    r = agent.run("帮我查一下。")
    seconds = time.perf_counter() - start
    chars = len(json.dumps(agent.messages, ensure_ascii=False))
    print(f"-> {name}:status={r.status} steps={r.steps} needs_human={r.needs_human} | 模型被调 {len(fake.calls)} 次 | "
          f"上下文 {chars} 字符 | 耗时 {seconds:.1f} 秒")

REAL = {"1 模型 API 连不上(端口 9 没人监听)": {"base_url": "http://127.0.0.1:9"},
        "对照:key 写错(真发到 DeepSeek)": {"api_key": "sk-wrong-key-for-demo"}}
for name, overrides in REAL.items():
    agent = RobustAgent(reg, "你是助手。", llm=make_llm(**overrides), verbose=False)
    start = time.perf_counter()
    r = agent.run("杭州天气?")
    print(f"-> {name}:status={r.status} error={r.error} needs_human={r.needs_human} | 耗时 {time.perf_counter() - start:.1f} 秒")
```

<div class="line-notes">

- `from part03.failure_zoo import reg` 直接复用 Day 189 的那张工具表(`get_weather`、`slow_lookup`、`flaky_lookup`、`dump_logs`),工具原样不动,只换循环。
- `from part03.fake_client import FakeClient, Step, call` `Step` 是剧本里一幕的类型别名,下面标注 `SCRIPTS` 用。
- `PARTIAL = "已经查到的结果见上,其余没有完成。"` 收尾那一幕的统一台词。
- `"2 工具卡住": [[call("slow_lookup", order_id="O1")], "订单接口暂时没有响应,请稍后再查。"],` 剧本:模型调一次卡 3 秒的工具,工具超时后拿到报错,第二次调用给出最终回答。后面 3、4、5、7 都是同一个模式:一次工具调用(出各种事)加一句最终回答。
- `"4 参数不是合法 JSON": [[("get_weather", '{"city": 杭州}')], "杭州天气:21 度。"],` 这一类要手写 `(工具名, 参数字符串)`,因为 `call()` 会把参数规规矩矩序列化成合法 JSON。
- `"6 同一个调用反复发": [[call("get_weather", city="杭州")]] * 4 + [PARTIAL],` 演四遍同一个调用,再加收尾那一句。
- `"8/9 停不下来,撞线": [[call("get_weather", city=c)] for c in` 六个不同的城市,每步一个,走满 6 步撞线,再加收尾那一句。
- `agent = RobustAgent(reg, "你是助手。", Limits(max_steps=6, tool_timeout=1), llm=fake, verbose=False)` 和 Day 189 一样给 6 步,工具超时调成 1 秒(原来卡 3 秒,调成 1 秒才看得到「超时」而不用干等)。
- `start = time.perf_counter()` 记起点。`perf_counter` 是精度最高的计时器,量一小段耗时用它(`monotonic` 也行,Day 192 讲过后者)。
- `chars = len(json.dumps(agent.messages, ensure_ascii=False))` 上下文一共多少字符。`messages` 只增不减,跑完的长度就是最大值。Day 189 的 `FakeLLM` 里是用 `seen_chars` 记的,今天换成事后量。
- `REAL = {"1 模型 API 连不上(端口 9 没人监听)": {"base_url": "http://127.0.0.1:9"},` 两个真 SDK 场景,值是传给 `make_llm` 的覆盖参数。
- `agent = RobustAgent(reg, "你是助手。", llm=make_llm(**overrides), verbose=False)` `**overrides` 把字典展开成关键字参数,相当于 JS 的 `make_llm({...overrides})`。
- `error={r.error}` `llm_error` 的结果里,`error` 字段就是异常类名。

</div>

```bash
uv run python -m part03.failure_zoo_193
```

```text
-> 2 工具卡住:status=ok steps=2 needs_human=False | 模型被调 2 次 | 上下文 429 字符 | 耗时 1.0 秒
-> 3 工具抛异常:status=ok steps=2 needs_human=False | 模型被调 2 次 | 上下文 419 字符 | 耗时 0.0 秒
-> 4 参数不是合法 JSON:status=ok steps=2 needs_human=False | 模型被调 2 次 | 上下文 426 字符 | 耗时 0.0 秒
-> 5 调了不存在的工具:status=ok steps=2 needs_human=False | 模型被调 2 次 | 上下文 453 字符 | 耗时 0.0 秒
-> 6 同一个调用反复发:status=loop steps=4 needs_human=True | 模型被调 5 次 | 上下文 1320 字符 | 耗时 0.0 秒
-> 7 结果过长:status=ok steps=2 needs_human=False | 模型被调 2 次 | 上下文 4566 字符 | 耗时 0.0 秒
-> 8/9 停不下来,撞线:status=max_steps steps=6 needs_human=True | 模型被调 7 次 | 上下文 1783 字符 | 耗时 0.0 秒
-> 1 模型 API 连不上(端口 9 没人监听):status=llm_error error=APIConnectionError needs_human=True | 耗时 8.6 秒
-> 对照:key 写错(真发到 DeepSeek):status=llm_error error=AuthenticationError needs_human=True | 耗时 0.2 秒
```

把它填进 Day 189 的那张表,对照看:

| 类 | Day 189 的表现 | 今天的表现 |
| --- | --- | --- |
| 1 模型 API 临时错误 | 抛 `APIConnectionError`,整个任务崩,3.6 秒 | 重试 4 次后返回 `llm_error`,不崩,8.6 秒 |
| 2 工具卡住 | 干等 3 秒 | 1 秒超时,报错交给模型,耗时 1.0 秒 |
| 3 工具抛异常 | 接住了 | 接住了(没变) |
| 4 参数格式错误 | 接住了 | 接住了(没变) |
| 5 幻觉工具 | 接住了 | 接住了(没变) |
| 6 重复调用 | 白烧 6 步 | 第 4 步收尾,`loop`,只用了 4 步 |
| 7 结果过长 | 21 万字符原样进上下文(217,811 字符) | 截断到 4000 字符,上下文总共 4566 字符 |
| 8 停不下来 | 勉强,靠 `max_steps` | `max_steps` 状态,走了 6 步 |
| 9 做不完 | 只回一句「到了最大步数」 | 进收尾,`needs_human=True`,有部分答案 |

有一行值得单独说:第 1 类**变慢了**,从 3.6 秒到 8.6 秒。Day 189 的 3.6 秒是 SDK 自带的 3 次重试,今天是 tenacity 的 4 次(间隔约 1、2、4 秒加抖动)。这是有意的取舍:换来的是不崩、状态明确。如果你的用户不愿意干等 8 秒,可以把 `stop_after_attempt` 调成 2 或 3,或者给 `Limits.max_seconds` 配合工具超时来管整体时间,这是练习 2 的出发点。

另一行是 key 写错:0.2 秒就返回 `llm_error`,`error=AuthenticationError`。和连不上同样是 `llm_error`,但耗时差 40 倍,因为 401 根本不重试。上游看到 `AuthenticationError` 就该立刻报警:key 错了,重试一万次也没用,而 `APIConnectionError` 可能是网络抖动。

## 真模型:收尾的账现在对得上了

假模型上的账对,不代表真模型上的账也对。用 Day 192 的「华东跑步」任务,`max_steps=1` 让它撞线收尾,这次把 `LLMClient` 自己建好、留一份引用,跑完直接看 `ledger`,不再用 Day 192 那个 monkeypatch 间谍。

```python
# agent-zero-lab/part03/robust_real.py  Day 193:真模型跑 RobustAgent,把 AgentResult.usage 和 LLMClient 的账本对一对
import sys

from part03.budget import Limits
from part03.retry_llm import make_llm
from part03.robust_agent import RobustAgent
from part03.wrapup_real import reg

llm = make_llm()  # 自己建、自己留一份引用,跑完才能看它的账本
agent = RobustAgent(reg, "你是出行助手。", Limits(max_steps=int(sys.argv[1])), llm=llm)
result = agent.run("华东哪个城市今天最适合户外跑步?气温和空气质量都要看。")
print(f"status={result.status} steps={result.steps} needs_human={result.needs_human} usage={result.usage}")
print(f"LLMClient.ledger = {llm.ledger}")
print("回答:", result.answer[:120].replace("\n", " "), "…")
```

<div class="line-notes">

- `from part03.wrapup_real import reg` Day 192 的 `wrapup_real.py` 里登记好 `list_cities`、`get_weather`、`get_aqi` 三个工具的注册表。
- `llm = make_llm()  # 自己建、自己留一份引用,跑完才能看它的账本` 这是 `RobustAgent` 接受 `llm` 参数的又一个好处:不用 monkeypatch,也能拿到内部用的那个客户端。
- `agent = RobustAgent(reg, "你是出行助手。", Limits(max_steps=int(sys.argv[1])), llm=llm)` 步数从命令行读,`int("1")` 把字符串转整数。
- `print(f"LLMClient.ledger = {llm.ledger}")` `Ledger` 的 `__str__` 会打出「几次调用、输入输出各多少、约多少钱」。账本记的是每次 `chat` 实际收到的 `usage`,是对账的标准答案。
- `result.answer[:120].replace("\n", " ")` 回答只截前 120 个字符并把换行换成空格,免得占满终端。

</div>

```bash
uv run python -m part03.robust_real 1
```

```text
[step 1] 累计 440 tok | 调用 ['list_cities']
    list_cities({"region": "华东"}) -> run
status=max_steps steps=1 needs_human=True usage={'prompt_tokens': 530, 'completion_tokens': 231}
LLMClient.ledger = 2 次调用 | 输入 530 / 输出 231 tokens | 约 ¥0.0024
回答: 目前我只能确认华东候选城市有:杭州、上海、南京、苏州、宁波、合肥。  但我还没能获取各城市的**今日气温**和**空气质量指数(AQI)**,所以无法可靠地比较出"今天最适合户外跑步"的城市——这部分没有完成,我不能凭印象给结论。  建议的 …
```

`usage` 是 530 / 231,账本也是 530 / 231,一分不差。第 1 步结束时累计 440,账本总共 530 + 231 = 761,差的 321 就是收尾那次。Day 192 练习 4 那个「账本比 usage 多一次」的问题没有了。再放开步数,正常跑完:

```bash
uv run python -m part03.robust_real 8
```

```text
[step 1] 累计 440 tok | 调用 ['list_cities']
    list_cities({"region": "华东"}) -> run
[step 2] 累计 1267 tok | 调用 ['get_weather', 'get_weather', 'get_weather', 'get_weather', 'get_weather', 'get_weather', 'get_aqi', 'get_aqi', 'get_aqi', 'get_aqi', 'get_aqi', 'get_aqi']
    get_weather({"city": "杭州"}) -> run
    get_weather({"city": "上海"}) -> run
    get_weather({"city": "南京"}) -> run
    get_weather({"city": "苏州"}) -> run
    get_weather({"city": "宁波"}) -> run
    get_weather({"city": "合肥"}) -> run
    get_aqi({"city": "杭州"}) -> run
    get_aqi({"city": "上海"}) -> run
    get_aqi({"city": "南京"}) -> run
    get_aqi({"city": "苏州"}) -> run
    get_aqi({"city": "宁波"}) -> run
    get_aqi({"city": "合肥"}) -> run
[step 3] 累计 2607 tok | 调用 []
status=ok steps=3 usage={'prompt_tokens': 1926, 'completion_tokens': 681}
LLMClient.ledger = 3 次调用 | 输入 1926 / 输出 681 tokens | 约 ¥0.0068
回答: | 城市 | 气温 | AQI | 评价 | |------|------|-----|------| | 杭州 | 21℃ | 48 | 良好 ✅ | | 上海 | 19℃ | 95 | 空气一般 | | 南京 | 17℃ | 130 | …
```

三步,`status=ok`,账也对得上:1926 / 681,账本 3 次调用。和 Day 192 的 `wrapup_real 2` 对比:那次因为只给 2 步,撞线后靠收尾救回来;这次给了 8 步,模型第 3 步自己给了最终回答,不转人工。`needs_human` 是 `False`。

两次真调用的花费:¥0.0024 + ¥0.0068 = ¥0.0092,约 ¥0.01(账本按 `.env` 里的价格 0.04 / 2 / 8 元每百万 token 算,2026 年 10 月核对)。

## 动手练习

### 练习 1:任务时间不够了,工具别再等满 15 秒

Day 192 练习 3 发现:每个工具 0.8 秒、整个任务只给 2 秒时,总耗时 2.4 秒,因为 `over_budget` 只在「调模型之前」检查,一个工具跑到一半时预算就过期了也不管。今天的 `RobustAgent` 留了 `_tool_timeout(elapsed)` 这个钩子。写一个子类 `TimeAwareAgent`,让工具的超时不超过「整个任务还剩多少时间」,再和原版对比总耗时。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex193_time_aware.py  练习 2:工具的超时不能超过整个任务剩下的时间
import time

from part03.agent_loop import ToolRegistry
from part03.budget import Limits
from part03.fake_client import FakeClient, call
from part03.robust_agent import RobustAgent

reg = ToolRegistry()


@reg.tool
def slow_weather(city: str) -> dict[str, object]:
    """查天气,但接口慢,要 0.8 秒。"""
    time.sleep(0.8)
    return {"city": city, "temp": 20}


class TimeAwareAgent(RobustAgent):
    def _tool_timeout(self, elapsed: float) -> float:
        remaining = self.limits.max_seconds - elapsed  # 整个任务还剩多少秒
        return max(round(min(self.limits.tool_timeout, remaining), 1), 0.1)  # 不超过原来的工具超时;取一位小数,报错好读;不给零或负数


CITIES = ["杭州", "上海", "北京", "广州", "深圳"]
for cls in (RobustAgent, TimeAwareAgent):
    fake = FakeClient([[call("slow_weather", city=c)] for c in CITIES[:4]] + ["部分答案"])
    agent = cls(reg, "你是助手。", Limits(max_seconds=2), llm=fake, verbose=False)
    start = time.perf_counter()
    r = agent.run("五个城市的天气。")
    tools = [m["content"] for m in agent.messages if m["role"] == "tool"]
    print(f"{cls.__name__:15} status={r.status} steps={r.steps} 总耗时 {time.perf_counter() - start:.1f} 秒")
    print(f"{'':15} 每个工具的结果:{tools}")
```

<div class="line-notes">

- `reg = ToolRegistry()` 和 `def slow_weather(city: str)` 一个睡 0.8 秒的工具,和 Day 192 练习 3 的 `slow_weather` 一样。
- `class TimeAwareAgent(RobustAgent):` 继承,只覆盖一个方法。其余主循环、重试、收尾全部沿用,这就是上面把 `_tool_timeout` 单独拎出来的价值。
- `remaining = self.limits.max_seconds - elapsed  # 整个任务还剩多少秒` `elapsed` 是主循环传进来的「已经跑了多久」,`max_seconds` 是 2,第 3 步开始时 `elapsed` 约 1.6,所以 `remaining` 约 0.4。
- `return max(round(min(self.limits.tool_timeout, remaining), 1), 0.1)` 从里往外读:`min(15, 0.4)` 取更小的 0.4;`round(..., 1)` 保留一位小数,免得报错里出现 `0.3998` 这种数;`max(..., 0.1)` 兜底,剩余时间是零或负数时也给工具 0.1 秒,不传负数给线程池。
- `for cls in (RobustAgent, TimeAwareAgent):` 用同一段代码跑两个类。类也是对象,可以放进元组遍历,相当于 JS 里把两个 class 放进数组。
- `fake = FakeClient([[call("slow_weather", city=c)] for c in CITIES[:4]] + ["部分答案"])` 4 步工具调用加收尾一句。`CITIES[:4]` 是切片,取前 4 个。
- `agent = cls(reg, "你是助手。", Limits(max_seconds=2), llm=fake, verbose=False)` `cls(...)` 就是调用当前这个类的构造函数。
- `tools = [m["content"] for m in agent.messages if m["role"] == "tool"]` 取出所有 tool 消息,看每个工具回了什么。

</div>

```bash
uv run python -m part03.ex193_time_aware
```

```text
RobustAgent     status=timeout steps=3 总耗时 2.4 秒
                每个工具的结果:['{"city": "杭州", "temp": 20}', '{"city": "上海", "temp": 20}', '{"city": "北京", "temp": 20}']
TimeAwareAgent  status=timeout steps=3 总耗时 2.0 秒
                每个工具的结果:['{"city": "杭州", "temp": 20}', '{"city": "上海", "temp": 20}', '{"error": "工具 slow_weather 超过 0.4 秒没有返回。可以换个参数重试,或者告诉用户暂时查不到。"}']
```

原版第 3 个工具跑完 0.8 秒,总共 2.4 秒;子类在第 3 步只给工具 0.4 秒(2 − 1.6),0.4 秒一到就超时,总共 2.0 秒,没有越过预算。代价是第 3 个城市的天气没拿到,收尾时模型会如实说明。这是用「少一个结果」换「不超时间」,值不值取决于你的产品:客服场景通常宁可少一点信息也要快。

还有一点:被超时放弃的那个工具线程其实还在后台睡完剩下的 0.4 秒,Day 191 讲过「超时不等于没做」,这里是只读的假工具所以无所谓,写操作要靠幂等键。

</details>

### 练习 2:收尾那次调用也失败了

`wrap_up` 里有一个 `try/except` 兜底,但今天之前没有任何测试走过那条路。写一个测试:`max_steps=2`,前两步正常,收尾那次调用连续 429(重试 4 次也不成功)。检查:状态仍然是 `max_steps`(不能变成 `llm_error`),答案是固定文案加异常类名,收尾一共试了 4 次,`usage` 里没有失败的那四次。

<details><summary>参考答案</summary>

先看这两个练习共用的测试文件前半(练习 3 的测试在同一个文件里):

```python
# agent-zero-lab/tests/test_robust_extra.py  练习 3、4:收尾那次也失败;一步里多个调用、其中一个被拦
from part03.budget import FALLBACK, Limits
from part03.fake_client import FakeClient, call, fake_http_error
from part03.loop_guard import LOOP_MSG
from part03.robust_agent import RobustAgent
from tests.test_robust_agent import assert_every_tool_call_has_a_reply, reg


def test_wrap_up_itself_fails_gives_fallback(waits: list[float]) -> None:
    fake = FakeClient([[call("echo", text="0")], [call("echo", text="1")]] + [fake_http_error(429)] * 4)
    r = RobustAgent(reg, "sys", Limits(max_steps=2), llm=fake, verbose=False).run("hi")
    assert (r.status, r.needs_human) == ("max_steps", True)  # 状态还是撞的那条线,不会变成 llm_error
    assert r.answer == f"{FALLBACK}(RateLimitError)"
    assert len(fake.calls) == 2 + 4 and len(waits) == 3  # 收尾那次也重试了 4 次
    assert r.usage == {"prompt_tokens": 200, "completion_tokens": 40}  # 失败的 4 次没有 usage


def test_blocked_call_in_a_parallel_step_still_gets_a_reply() -> None:
    same = [call("echo", text="a")]
    fake = FakeClient([same, same, same, [call("echo", text="a"), call("echo", text="b")], "收尾回答"])
    agent = RobustAgent(reg, "sys", llm=fake, verbose=False)
    r = agent.run("hi")
    assert (r.status, r.steps) == ("loop", 4)
    replies = [m["content"] for m in agent.messages if m["role"] == "tool"]
    assert replies[-2:] == [LOOP_MSG, '"b"']  # 第一个被拦,第二个是新调用,照常执行
    assert_every_tool_call_has_a_reply(agent.messages)
```

<div class="line-notes">

- `from part03.budget import FALLBACK, Limits` `FALLBACK` 是 Day 192 `budget.py` 里的固定文案常量,测试直接拿它拼期望值,文案改了测试不用跟着改。
- `from tests.test_robust_agent import assert_every_tool_call_has_a_reply, reg` 从另一个测试文件借工具表和检查函数。`tests.test_robust_agent` 能被找到,是因为 `pyproject.toml` 里的 `pythonpath = ["."]`(Day 72)把仓库根目录加进了搜索路径。
- `fake = FakeClient([[call("echo", text="0")], [call("echo", text="1")]] + [fake_http_error(429)] * 4)` 剧本:两个不同的工具调用(各一步),然后 4 次 429。第 3 次调用是收尾那次,它拿到第 1 个 429,重试 3 次后拿到第 4 个。
- `assert (r.status, r.needs_human) == ("max_steps", True)  # 状态还是撞的那条线,不会变成 llm_error` 收尾失败不改变撞线的原因。`llm_error` 只用来表示**主循环**里模型叫不动。
- `assert r.answer == f"{FALLBACK}(RateLimitError)"` `wrap_up` 的 `except` 把异常类名拼在固定文案后面。
- `assert len(fake.calls) == 2 + 4 and len(waits) == 3` 模型一共被调 6 次:两步正常、收尾 4 次。收尾那次之所以会重试,是因为 `RobustAgent` 把 `RetryingChat` 传给了 `wrap_up`。
- `assert r.usage == {"prompt_tokens": 200, "completion_tokens": 40}` 只有前两步的 2 × 120。收尾的 4 次都失败了,没有 token。

</div>

```bash
uv run pytest tests/test_robust_extra.py -v
```

```text
tests/test_robust_extra.py::test_wrap_up_itself_fails_gives_fallback PASSED [ 50%]
tests/test_robust_extra.py::test_blocked_call_in_a_parallel_step_still_gets_a_reply PASSED [100%]
============================== 2 passed in 0.08s ===============================
```

两个测试 0.08 秒。这条路径值得测,因为它是「最后一道防线也失守」的情形,线上哪天会真走到,走到时用户看到的是固定文案而不是一个 500。

</details>

### 练习 3:一步里有好几个调用,其中一个被拦

模型一步里可以发多个工具调用(Day 162)。写一个测试:前三步各发 `echo("a")`,第四步同时发 `echo("a")` 和 `echo("b")`。第一个是第 4 次出现(该 `stop`),第二个是新调用(该照常执行)。检查:状态是 `loop`;`"b"` 真的被执行了;两个调用都有 tool 消息回复。

<details><summary>参考答案</summary>

答案就是上面 `test_robust_extra.py` 里的第二个测试,节选如下:

```python
# agent-zero-lab/tests/test_robust_extra.py  (节选)
def test_blocked_call_in_a_parallel_step_still_gets_a_reply() -> None:
    same = [call("echo", text="a")]
    fake = FakeClient([same, same, same, [call("echo", text="a"), call("echo", text="b")], "收尾回答"])
    agent = RobustAgent(reg, "sys", llm=fake, verbose=False)
    r = agent.run("hi")
    assert (r.status, r.steps) == ("loop", 4)
    replies = [m["content"] for m in agent.messages if m["role"] == "tool"]
    assert replies[-2:] == [LOOP_MSG, '"b"']  # 第一个被拦,第二个是新调用,照常执行
    assert_every_tool_call_has_a_reply(agent.messages)
```

<div class="line-notes">

- `same = [call("echo", text="a")]` 一步的内容:发一个 `echo("a")`。
- `fake = FakeClient([same, same, same, [call("echo", text="a"), call("echo", text="b")], "收尾回答"])` 前三步各一遍,第四步一次发两个,最后是收尾一句。
- `assert (r.status, r.steps) == ("loop", 4)` 第 4 步里第一个调用是 `echo("a")` 第 4 次出现,`stop`,所以第 4 步结束后收尾。
- `assert replies[-2:] == [LOOP_MSG, '"b"']` `[-2:]` 是切片,取最后两项。前一个是被拦的 `a`,回提醒;后一个是 `b`,**照常执行了**,回 `"b"`。这说明同一步里一个调用被拦,不影响其他调用。
- `assert_every_tool_call_has_a_reply(agent.messages)` 第 4 步的 assistant 消息里有两个 `tool_call`,必须有两条 tool 回复。如果循环里写成「`stop` 了就 `break`」,第二个调用没回复,这一行就会红。

</div>

这是个真实踩过的坑:有人写循环检测时一遇到 `stop` 就直接 `return`,后面的调用没回复,收尾那次请求被 API 以 400 拒绝(「assistant message with tool_calls must be followed by tool messages」),用户拿到的是一个错误页。`RobustAgent` 先把这一步所有调用都回完,再看 `stop` 要不要收尾。

</details>

### 练习 4:故意改坏被测代码,看测试抓得住吗

一个测试绿了,不代表它有用。把被测代码改坏,测试应该变红;改坏了还是绿,这个测试就是摆设。写一个脚本:把整个实验仓库复制到临时目录,依次对六处代码做小手术,每次改完跑一遍 `pytest`,报告测试抓没抓住、红的是哪几个。六处:收尾不再禁用工具;收尾 token 不记账;拦过还来也不收尾;只接 429 不接别的模型错误;被拦下的调用不回 tool 消息;步数预算 `>` 改成 `>=`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex193_mutants.py  练习 1:把被测代码故意改坏六处,看测试能不能抓住。每次只在临时副本里改,不动原文件
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MUTANTS = [
    ("收尾不再禁用工具", "part03/budget.py", 'tool_choice="none"', "tool_choice=None"),
    ("收尾的 token 不记账", "part03/budget.py", "if usage is not None:", "if False:"),
    ("拦过还来也不收尾", "part03/robust_agent.py", 'stop = stop or verdict == "stop"', "stop = False"),
    ("只接 429,不接别的模型错误", "part03/robust_agent.py", "except openai.APIError as e:", "except openai.RateLimitError as e:"),
    ("被拦下的调用不回 tool 消息", "part03/robust_agent.py", 'if self.verbose:\n                    print(f"    {name}({args}) -> {verdict}")\n                messages.append',
     'if self.verbose:\n                    print(f"    {name}({args}) -> {verdict}")\n                if verdict == "run": messages.append'),
    ("步数预算 > 改成 >=", "part03/budget.py", "if step > limits.max_steps:", "if step >= limits.max_steps:"),
]

for label, rel, old, new in MUTANTS:
    with tempfile.TemporaryDirectory() as tmp:
        copy = Path(tmp) / "lab"
        shutil.copytree(ROOT, copy, ignore=shutil.ignore_patterns(".venv", ".env", "__pycache__", ".pytest_cache", ".git"))
        target = copy / rel
        text = target.read_text()
        assert old in text, f"{rel} 里找不到要改的那一段:{old!r}"  # 找不到说明文件改过了,变异就没意义
        target.write_text(text.replace(old, new, 1))
        run = subprocess.run([sys.executable, "-m", "pytest", "-q", "--tb=no", "-p", "no:cacheprovider"],
                             cwd=copy, capture_output=True, text=True, timeout=120)
        failed = Counter(m.group(1) for m in re.finditer(r"^FAILED tests/(\S+?)(?:\[\S*\])?(?: - .*)?$", run.stdout, re.M))
        verdict = "测试抓住了" if run.returncode != 0 else "没抓住!"
        print(f"{label:20} -> {verdict} | {run.stdout.strip().splitlines()[-1]}")
        for name, n in sorted(failed.items()):
            print(f"    红了:{name}" + (f"(参数化里的 {n} 个)" if n > 1 else ""))
```

<div class="line-notes">

- `ROOT = Path(__file__).resolve().parent.parent` 仓库根目录:这个文件在 `part03/` 下,往上两层。`Path` 是 Day 37 学的路径对象。
- `MUTANTS = [` 每一项是「名字、改哪个文件、原文、改成什么」。这种元组列表相当于 JS 的对象数组,下面 `for label, rel, old, new in MUTANTS` 一次拆成四个变量。
- `with tempfile.TemporaryDirectory() as tmp:` 建一个临时目录,`with` 块结束自动删掉。每个变异体各用一份新副本,互不污染。
- `shutil.copytree(ROOT, copy, ignore=shutil.ignore_patterns(".venv", ".env", "__pycache__", ".pytest_cache", ".git"))` 复制整个仓库,但跳过虚拟环境、缓存和 `.env`(里面有真 key,不该被复制到别处)。这一步保证**原文件一个字都不会被改**。
- `assert old in text, f"{rel} 里找不到要改的那一段:{old!r}"` 如果原文找不到(比如你以后改了代码),脚本会直接报错而不是悄悄「改了个寂寞」,测试也就没法白绿。
- `target.write_text(text.replace(old, new, 1))` 只替换第一处。
- `subprocess.run([sys.executable, "-m", "pytest"` 在副本目录里用同一个 Python 解释器跑 pytest。`--tb=no` 不打印失败的详细回溯,我们只要结果;`-p no:cacheprovider` 不写缓存目录。
- `failed = Counter(m.group(1) for m in re.finditer(r"^FAILED tests/(\S+?)(?:\[\S*\])?(?: - .*)?$", run.stdout, re.M))` 用正则从 pytest 输出里捞所有 `FAILED tests/文件::测试名` 行,参数化的用例名后面带 `[...]`,去掉后按测试函数分组数个数。`re.M` 让 `^` 和 `$` 匹配每一行的行首行尾。
- `verdict = "测试抓住了" if run.returncode != 0 else "没抓住!"` pytest 有失败时退出码非 0。
- `(f"(参数化里的 {n} 个)" if n > 1 else "")` 一个测试函数红了多个参数组时,标出个数。

</div>

```bash
uv run python -m part03.ex193_mutants
```

```text
收尾不再禁用工具             -> 测试抓住了 | 4 failed, 16 passed in 1.43s
    红了:test_robust_agent.py::test_each_budget_line_triggers_a_wrap_up(参数化里的 3 个)
    红了:test_robust_agent.py::test_loop_is_stopped_and_wrap_up_tokens_are_counted
收尾的 token 不记账        -> 测试抓住了 | 4 failed, 16 passed in 1.56s
    红了:test_robust_agent.py::test_each_budget_line_triggers_a_wrap_up(参数化里的 3 个)
    红了:test_robust_agent.py::test_loop_is_stopped_and_wrap_up_tokens_are_counted
拦过还来也不收尾             -> 测试抓住了 | 2 failed, 18 passed in 1.45s
    红了:test_robust_agent.py::test_loop_is_stopped_and_wrap_up_tokens_are_counted
    红了:test_robust_extra.py::test_blocked_call_in_a_parallel_step_still_gets_a_reply
只接 429,不接别的模型错误      -> 测试抓住了 | 1 failed, 19 passed in 1.43s
    红了:test_robust_agent.py::test_unreachable_model_returns_llm_error
被拦下的调用不回 tool 消息     -> 测试抓住了 | 2 failed, 18 passed in 1.58s
    红了:test_robust_agent.py::test_loop_is_stopped_and_wrap_up_tokens_are_counted
    红了:test_robust_extra.py::test_blocked_call_in_a_parallel_step_still_gets_a_reply
步数预算 > 改成 >=         -> 测试抓住了 | 3 failed, 17 passed in 1.46s
    红了:test_loop_guard.py::test_over_budget_reports_which_line
    红了:test_robust_agent.py::test_each_budget_line_triggers_a_wrap_up
    红了:test_robust_extra.py::test_wrap_up_itself_fails_gives_fallback
```

六个变异体全被抓住,而且红的测试和你直觉里该红的对得上:

- 收尾不禁用工具、收尾不记账:都是 `tool_choice` 或 `usage` 的断言,红了三个预算用例和循环测试(它们都经过收尾)。
- 拦过还来也不收尾:循环测试红,练习 3 也红。
- 只接 429:`test_unreachable_model_returns_llm_error` 的 401 那组红,401 的异常没被接住冒出来了。
- 被拦下的调用不回消息:`assert_every_tool_call_has_a_reply` 让两个测试红。
- `>` 改成 `>=`:Day 192 的 `test_over_budget_reports_which_line` 红(刚好踩在边界上),今天的预算用例也红。
- 顺带发现:练习 2 的测试在「`>=`」那一行也红了,因为它的 `max_steps=2` 同样踩边界。

如果有一个变异体显示「没抓住!」,说明你的测试里有个洞。真实项目里做这件事的工具叫**变异测试**(mutation testing),Python 里有 `mutmut`、`cosmic-ray`,原理和这个脚本一样,只是自动生成变异体。今天的手写版足够理解这个思想。

</details>

**验收标准**:能说出四个零件各治哪几类、接在主循环的哪里;`usage_gap.py` 改前 120、改后 240 都能复现;能默写 `FakeClient.chat` 的三种分支和 `RobustAgent.run` 的主循环;`uv run pytest -q` 20 个全绿;`failure_zoo_193.py` 的九行里没有「崩」或「干等」;练习 4 六个变异体全被抓住;能回答「怎么证明这些防线真的起作用」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| `RobustAgent` | 今天拼出来的循环:重试、超时截断、循环检测、预算收尾四个零件都接在里面,返回带状态的 `AgentResult` |
| 适配器(`RetryingChat`) | 给一个对象套上额外行为、对外还是原来的接口的小类。这里给任何有 `chat` 的东西加上重试 |
| 钩子方法(`_tool_timeout`) | 主流程里留的一个可以被子类覆盖的小方法。想改行为就继承、覆盖它,不用动主循环 |
| `llm_error` | `AgentResult.status` 的一个取值:模型服务叫不动(重试用尽或者 401 这类不重试的错误),区别于撞线类的状态 |
| 假模型(fake / test double) | 和真对象有同样接口、行为由测试控制的替身。测试里用它制造稳定的故障 |
| `FakeClient` | 今天写的假模型:按剧本演,异常幕抛错、字符串幕回答、列表幕发工具调用,每次成功固定报 100 + 20 token,剧本用完再被调就报错 |
| 剧本(script) | 一个列表,第 n 项决定假模型第 n 次被调时做什么 |
| 离线测试 | 不联网、不花钱、不真等、结果每次一样的测试 |
| fixture | pytest 里「测试之前先准备好某个东西」的函数,测试参数里写同名参数就能拿到。相当于 jest 的 `beforeEach` 加传参 |
| `conftest.py` | pytest 自动加载的特殊文件,里面的 fixture 同目录下所有测试文件都能用,不用 import |
| `monkeypatch` | pytest 自带的 fixture,临时改某个对象的属性,测试结束自动恢复。Day 190 用它把 tenacity 的 `sleep` 换成假的 |
| 参数化(`parametrize`) | 同一个测试函数用多组输入各跑一遍,每组算一个用例。相当于 jest 的 `test.each` |
| 变异测试 | 故意在被测代码里改坏一小处,看测试会不会变红。不变红说明测试没有真正在检查那一处 |
| 对账 | 把自己记的数(`usage`)和权威来源(`ledger`、云厂商账单)比一比,对不上就是漏记或多记 |

## 常见误区

**测试里用真模型,觉得这样才算真测。** 真模型每次回答不一样、会花钱、会因为网络抖动而红,一个测试偶尔红偶尔绿,团队很快就不再相信它。控制流、状态、账、历史完整性这些确定的东西用假模型测;「回答好不好」另算,放进评测。

**剧本写长了,收尾拿到的不是文字。** 假模型不认 `tool_choice="none"`,它只管按剧本一幕幕演。剧本里工具调用的幕数要和「撞线的时机」对上,最后一幕才是收尾的文字,否则收尾拿到一个工具调用,`content` 是空的,答案落进 `FALLBACK`,有的断言还照样通过。今天的 `FakeClient` 用「剧本用完再被调就报错」来抓这种错位。

**断言只查 `status`。** 只查状态,收尾的答案是空串、`tool_choice` 没禁用、账少了一笔,测试都是绿的。每个测试至少查三样:状态、答案(或错误)、账。

**重试写在 SDK 里又写在 tenacity 里。** 一次调用最坏打 3 × 4 = 12 个请求。`make_llm` 把 SDK 的 `max_retries` 设成 0,重试统一在 `chat_with_retry` 一处。Day 190 的 `layer_count.py` 数过。

**失败的重试也记 token。** 失败的请求没有 `usage`,你根本拿不到数字,硬猜只会记错。账上只记成功的那次,测试一的 `usage == 100 + 20` 就钉着这一点。

**以为 `llm_error` 和撞线都是「失败」,一起处理。** 前者是模型服务的问题,找运维、查 key、看限流;后者是任务的问题,看轨迹、改提示词。混在一起,排查时会走错方向。所以才单独放 `error` 字段,把异常类名带出去。

**收尾也失败,就把状态改成 `llm_error`。** 状态说明任务为什么停下来,撞的是步数线就是 `max_steps`,收尾失败只影响最终文案。

**把共享状态放进 `self` 里跨 `run` 复用。** `LoopGuard`、`usage`、`start` 都在 `run` 里新建。Day 192 说过 `LoopGuard` 跨任务复用会让第二个任务的第一次调用就被拦。

**用 `wait_exponential_jitter(initial=2)` 调等待时间。** tenacity 9.2.1 的源码里,`initial` 参数已标记弃用:传 `initial=1`(等于默认值)不会警告,传别的值会给 `DeprecationWarning`,要调基数请用 `multiplier`。Day 190 的 `chat_with_retry` 只用了 `max=20`,所以没受影响;2026 年 10 月的 9.2.1 实测是这样。

**循环里一遇到 `stop` 就直接 return。** 同一步的其他调用没回复,下一次请求 400。先把这一步的调用全回完,再决定收不收尾(练习 3)。

## 学习资料

### 文档与文章

- [pytest 文档 · How to monkeypatch/mock modules and environments](https://docs.pytest.org/en/stable/how-to/monkeypatch.html):`monkeypatch.setattr` 的用法和为什么测试结束会自动恢复。英文,20 分钟。
- [pytest 文档 · How to parametrize fixtures and test functions](https://docs.pytest.org/en/stable/how-to/parametrize.html):`@pytest.mark.parametrize` 官方讲解,今天用到的写法这里都有。英文。
- [pytest 文档 · How to use fixtures](https://docs.pytest.org/en/stable/how-to/fixtures.html):fixture 和 `conftest.py` 的规则。英文。
- [Anthropic · Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):讲怎么评测 Agent。文章把一次运行的完整记录叫 transcript,并说明基于代码的确定性检查(grader)速度快、客观、可复现,正好对应今天「能确定的部分用代码离线测」。英文。
- [Testing Strategies for Agent Patterns](https://agent-patterns.readthedocs.io/en/stable/guides/testing.html):一个开源 Agent 模式库的测试指南,里面用 `MagicMock` 的 `side_effect` 给每一步准备罐头回答,和今天 `FakeClient` 的剧本是同一个思路。英文。
- [tenacity 文档](https://tenacity.readthedocs.io/en/latest/):重试库的完整文档,搜 `wait_exponential_jitter` 和「Testing」一节。英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1gu4y1B7sD&autoplay=0&high_quality=1" title="python进阶之pytest使用(part2: monkeypatch初探)" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>大刘gary · python进阶之pytest使用(part2: monkeypatch初探) · 16 分钟,看 monkeypatch 怎么临时改一个函数或属性,对应今天 conftest 里把 `sleep` 换成假的那一行。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1784y147P7&autoplay=0&high_quality=1" title="Python单元测试-04.Mock" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>跟峰哥学编程 · Python单元测试-04.Mock · 31 分钟,讲 `unittest.mock` 怎么造替身。今天的 `FakeClient` 是手写的替身,看完能理解为什么有时候手写比 `Mock` 更清楚。2022 年的视频,概念没变。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1rhLn6iEip&autoplay=0&high_quality=1" title="90%的Agent都翻车了｜5种死法×5种解法【费曼学AI EP.30】" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>费曼学AI · 90%的Agent都翻车了|5种死法×5种解法 · 12 分钟,把 Agent 常见的失败方式和对策过一遍,看完对照 Day 189 到今天的九类,看哪些你已经有了。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/EgpLj86ZHFQ" title="Please Learn How To Write Tests in Python… • Pytest Tutorial" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Tech With Tim · Please Learn How To Write Tests in Python… · pytest 入门,英文,看 fixture 和 parametrize 的部分。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/EIV_ixKGPmc" title="How to Write Great Unit Tests in Python" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>ArjanCodes · How to Write Great Unit Tests in Python · 讲怎么写让人愿意维护的单元测试,英文,和「测试要钉住什么,不钉住什么」一节对着看。</figcaption>
</figure>

### 书籍

- Brian Okken《Python Testing with pytest》第 2 版(Pragmatic Bookshelf, 2022):讲 fixture、参数化、`conftest.py` 和 monkeypatch 的专著,英文。今天用到的 pytest 功能这本书里都有一整章。
- Michael T. Nygard《Release It!》第 2 版(Pragmatic Bookshelf, 2018):前面几天提过,它讲的稳定性模式(超时、断路器、舱壁)就是今天拼在一起的东西的理论来源,英文。
- Chip Huyen《AI Engineering》(O'Reilly, 2025):评测和 Agent 失败模式相关的章节,讲「怎么系统地验证 AI 应用」,英文。

### 开源项目与代码

- [jd/tenacity](https://github.com/jd/tenacity):仓库里 `tests/` 目录是学「怎么测重试」的好材料,他们也替换了 `sleep`。
- [pytest-dev/pytest](https://github.com/pytest-dev/pytest):`src/_pytest/monkeypatch.py` 是 `monkeypatch` 的实现,不到 600 行,读得懂。

## 自测

1. 四个零件(重试、超时截断、循环检测、预算收尾)分别治九类失败里的哪几类?

<details><summary>答案</summary>

重试治第 1 类(模型 API 临时错误);超时加截断治第 2 类(工具卡住)和第 7 类(结果过长);循环检测治第 6 类(重复调用);预算加收尾治第 8 类(停不下来)和第 9 类(做不完)。第 3、4、5 类(工具抛异常、参数不是合法 JSON、幻觉工具)靠注册表的 `call` 里的 `try/except` 已经接住,不用新零件。

</details>

2. 为什么模型叫不动时返回 `llm_error`,而不是像撞线那样收尾?

<details><summary>答案</summary>

收尾也要再调一次模型。重试 4 次都失败(或者 401 这类根本不重试的错误)说明服务当前不可用,再调一次多半还是失败,只会多等几秒。直接返回 `llm_error`,带上异常类名,上游能分清是模型服务的问题还是任务本身的问题。

</details>

3. `FakeClient` 为什么在「剧本用完又被调用」时抛 `AssertionError`,而不是重复最后一幕?

<details><summary>答案</summary>

重复最后一幕会把「Agent 多调了一次模型」悄悄吞掉,测试照样绿。抛错让这种多调变成红色的测试;抛的是 `AssertionError` 而不是 `openai.APIError`,因为 `RobustAgent` 只接 `APIError`,这个异常会冒出去让测试失败,不会被当成 `llm_error` 吞掉。

</details>

4. `wrap_up` 为什么用 `if usage is not None:` 而不是 `if usage:`?收尾那次调用的 token 为什么要记?

<details><summary>答案</summary>

`if usage:` 对空字典也是假,「传了一个空字典」会被误当成「没传」。收尾那次调用真实花了钱,不记的话账上比实际少,撞线的任务通常最长最贵,偏偏漏的是它。今天的测试把「账上总数 = 调用次数 × 120」钉住了,真模型上也和 `LLMClient.ledger` 一分不差。

</details>

5. 面试题:你写了一堆防线(重试、超时、循环检测、预算),怎么证明它们真的起作用,而且以后改代码不会悄悄失效?

<details><summary>答案</summary>

用假模型做离线测试:按剧本稳定制造每一种故障(连续 429、401、同一个调用连发、工具卡住、结果过长、预算耗尽),断言状态、答案、账和历史完整性(每个 tool_call 都有回复),测试不联网、不花钱、不真等,放进 CI。再用变异测试验证测试本身有没有用:故意把被测代码改坏一处,测试必须变红。能确定性验证的部分全部离线测掉;回答质量这种需要真模型的另算,放进评测集。上线之后再用日志和监控看真实的状态分布(明天讲)。

</details>

6. 为什么把 `_model_step` 和 `_tool_step` 拆成单独的方法?

<details><summary>答案</summary>

主循环只管流程,这两个方法管细节。想改某一步的行为(比如给每一步计时、让工具超时不超过剩余时间)时,继承并覆盖对应方法就行,不用复制主循环。练习 1 覆盖 `_tool_timeout`,明天 Day 194 覆盖 `_model_step` 和 `_tool_step` 记日志,都是这个用法。

</details>

## 明天预告

明天是 **Day 194 · 失败模式(六):失败了要留下什么**。今天的测试证明了「出事时 Agent 怎么反应」,但线上真出事之后,你要回答的是另一些问题:这次是第几步、因为什么撞的线,撞线前调了哪些工具、各花多久、拿到什么,最后给用户说了什么。明天继承今天的 `RobustAgent`,覆盖 `_model_step` 和 `_tool_step` 计时,把每次运行落成一行结构化日志,再写一个小脚本从一堆日志里按状态筛、按耗时排,看一遍真实的失败轨迹是什么样。
