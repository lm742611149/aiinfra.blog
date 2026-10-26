---
title: 'Day 132 · 第 19 周复习:大模型与 API(Day 126–131)'
description: '这一周讲的是一次请求从发出到记账中间会遇到的所有事:错误分类、重试和退避、限速和并发、messages 就是记忆、system 放什么、对话越聊越贵。今天画成一张「一轮对话的完整路径」图,逐天一句话回顾,列出本周的关键数字和坑,默写 backoff_delay 和 Chat.ask,再写一个小项目:扛得住 429、算得清钱、裁得了历史、花到预算就停的客服会话,假服务器上看它重试和拒绝 401,真 DeepSeek 上聊到 0.003 元自动停。'
pubDate: 2026-10-23
regime: none
tags: ['api', 'review', 'retry', 'messages', 'cost', 'python', 'agent-zero']
series: 'agent-zero'
day: 132
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 131](/blog/agent-zero/day-131-conversation-cost/) 量了多轮对话的账:每轮重发全部历史,第 n 轮输入是 S + (n−1)×T,累计是 N×S + T×N(N−1)/2,平方级。真聊 20 轮,输入从 287 涨到 885,合计 11780 个 token,公式算出 11720;DeepSeek 的缓存命中 66%,账单 0.0115 元,没缓存要 0.0268 元。写了只留最近 3 轮的 `WindowChat`,token 省 39%,但模型忘了第 1 轮的发票抬头,而且在缓存面前几乎没省钱;改动历史里一个早期回答,命中从 768 掉到 256。

这一周从 Day 126 到 131,讲的全是**一次请求出门之后会遇到什么**:出错了是谁的问题、该不该再发、发得太密会怎样、发出去的列表里有什么、第一条消息怎么写、聊久了钱怎么长。今天不学新东西,把六天接成一条路,再用一个小项目把它们一次用上。

## 今天要解决的问题

学完今天,你应该能做到:

1. 不看文章,画出「一轮对话的完整路径」:从拼 `messages` 到记账,标出本周六天各管哪一段、哪一段会出什么错。
2. 默写 `backoff_delay` 和 `Chat.ask`,用测试证明和原版行为一致。
3. 写完 `week19_lab.py`:一个会话对象,把 Day 126–131 的零件全接上,在假服务器上看它重试 429、拒绝 401,在真 DeepSeek 上聊到预算用完自动停。
4. 对着本周的坑清单,每一条都能说出现象和修法。

预计用时:3 小时左右(复习日,默写和小项目占大头)。实跑花费:小项目真 API 一次 0.0036 元,练习 2 一次 0.004 元,全天约 0.02 元(文末有算式)。前置:Day 126–131 全部,特别是 [Day 126](/blog/agent-zero/day-126-error-codes/) 的 `classify.py`、`fake_llm.py`,[Day 127](/blog/agent-zero/day-127-retry-backoff/) 的 `retry.py`,[Day 128](/blog/agent-zero/day-128-rate-limit/) 的 `aretry.py`,[Day 129](/blog/agent-zero/day-129-messages/) 的 `chat.py`、`chat_store.py`,[Day 130](/blog/agent-zero/day-130-system-prompt/) 的 `system_prompt.py`,[Day 131](/blog/agent-zero/day-131-conversation-cost/) 的 `window_chat.py` 和 `data/cost_curve*.json`。

学法提示:先不看文章,把那张路径图在纸上画一遍,再对照下面的图;小项目对照逐行敲一遍(不要复制粘贴)并跑通;明天合上文章,把 `Session.ask` 默写出来;动手练习做不出再展开参考答案,看完关掉,自己重写一遍。

## 本周知识地图

Day 125 那张图画的是「一次调用从 `.env` 到账单」,一条直线。这一周把它变成了一个**圈**:一轮对话结束,回答追加进历史,下一轮再从头走一遍;圈上每一步都可能出岔子。

<figure>
<svg viewBox="0 0 640 360" role="img" aria-label="第 19 周知识地图:一轮对话的路径是一个圈。system(Day 130)加历史(Day 129)拼成 messages,经过并发闸门(Day 128)发出去;失败就进错误分类(Day 126),可重试的等一等再发(Day 127),不可重试的报给人;成功的响应取 usage 记账(Day 124、131),回答追加进历史,历史越长下一轮越贵(Day 131)">
<rect x="0" y="0" width="640" height="360" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="30" width="130" height="70" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="85" y="52" text-anchor="middle" fill="var(--ink)">system</text>
<text x="85" y="70" text-anchor="middle" fill="var(--ink-soft)">五块 · 稳定在前</text>
<text x="85" y="90" text-anchor="middle" fill="var(--ink-faint)">Day 130</text>
<rect x="20" y="120" width="130" height="70" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="85" y="142" text-anchor="middle" fill="var(--ink)">历史 messages</text>
<text x="85" y="160" text-anchor="middle" fill="var(--ink-soft)">你写的,原样放回</text>
<text x="85" y="180" text-anchor="middle" fill="var(--ink-faint)">Day 129 · 131 裁剪</text>
<rect x="190" y="75" width="110" height="70" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="245" y="97" text-anchor="middle" fill="var(--ink)">并发闸门</text>
<text x="245" y="115" text-anchor="middle" fill="var(--ink-soft)">Semaphore</text>
<text x="245" y="135" text-anchor="middle" fill="var(--ink-faint)">Day 128</text>
<rect x="340" y="75" width="110" height="70" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="395" y="97" text-anchor="middle" fill="var(--ink)">厂商服务器</text>
<text x="395" y="115" text-anchor="middle" fill="var(--ink-soft)">前缀缓存</text>
<text x="395" y="135" text-anchor="middle" fill="var(--ink-faint)">Day 124 · 131</text>
<rect x="490" y="75" width="130" height="70" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="555" y="97" text-anchor="middle" fill="var(--ink)">usage → 记账</text>
<text x="555" y="115" text-anchor="middle" fill="var(--ink-soft)">命中/未命中/输出</text>
<text x="555" y="135" text-anchor="middle" fill="var(--ink-faint)">Day 124 · 131</text>
<line x1="150" y1="65" x2="190" y2="100" stroke="var(--ink-soft)"/>
<line x1="150" y1="155" x2="190" y2="120" stroke="var(--ink-soft)"/>
<line x1="300" y1="110" x2="340" y2="110" stroke="var(--ink-soft)"/>
<line x1="450" y1="110" x2="490" y2="110" stroke="var(--ink-soft)"/>
<path d="M 555 145 L 555 200 L 85 200 L 85 190" fill="none" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
<text x="200" y="196" fill="var(--ink-soft)">回答追加进历史,下一轮再走一遍(越聊越贵)</text>
<rect x="340" y="225" width="110" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="395" y="247" text-anchor="middle" fill="var(--ink)">出错了?分类</text>
<text x="395" y="267" text-anchor="middle" fill="var(--ink-faint)">Day 126</text>
<line x1="395" y1="145" x2="395" y2="225" stroke="var(--compute)" stroke-dasharray="4 3"/>
<rect x="190" y="225" width="110" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="245" y="247" text-anchor="middle" fill="var(--ink)">可重试:退避</text>
<text x="245" y="267" text-anchor="middle" fill="var(--ink-faint)">Day 127</text>
<line x1="340" y1="253" x2="300" y2="253" stroke="var(--ink-soft)"/>
<text x="304" y="246" fill="var(--ink-faint)">429/5xx/网络</text>
<path d="M 245 225 L 245 160" fill="none" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
<text x="250" y="170" fill="var(--ink-faint)">等一等,再发</text>
<rect x="490" y="225" width="130" height="56" rx="4" fill="none" stroke="var(--rule)"/>
<text x="555" y="247" text-anchor="middle" fill="var(--ink)">不可重试:报给人</text>
<text x="555" y="267" text-anchor="middle" fill="var(--ink-faint)">401/400/402</text>
<line x1="450" y1="253" x2="490" y2="253" stroke="var(--ink-soft)"/>
<text x="20" y="312" fill="var(--ink-soft)">失败时历史要回滚(129);超时的请求可能已被处理(126);两层重试叠加 1 次失败 = 9 个请求(127)</text>
<text x="20" y="334" fill="var(--ink-soft)">system 里不放机密(130);改动历史缓存就断(131);裁剪以轮为单位(129、131)</text>
</g>
</svg>
<figcaption>一轮对话的路径。上面一排是正常路线:拼好 messages,过并发闸门,发给厂商,拿 usage 记账,回答追加进历史,虚线回到起点。下面一排是失败路线:先分类,可重试的退避后回到闸门,不可重试的直接报人。最下面两行是这一周踩过的坑。</figcaption>
</figure>

这张图上最要记住的是:**分类在重试前面,闸门包住重试**。Day 127 的 `call_with_retry` 先问 `classify` 该不该重试,再决定等多久;Day 128 说车位(Semaphore)要包住整个重试过程,退避等待时也占着车位。今天的小项目把这两件事和 `Chat` 接起来。

## 本周每天一句话

- [Day 126](/blog/agent-zero/day-126-error-codes/) · 错误码:错分五类(你的代码、你的账号、太快了、厂商、网络),看状态码和异常类不看 `message` 文字;`APIStatusError` 是所有 HTTP 错误的父类,`except` 子类在前;DeepSeek 上 `temperature=5` 是 400 不是 422;`html-200` 让 SDK 返回一个 `str`,报错在你的下一行;`classify(e)` 返回 `Verdict(kind, retry, advice, status)`。
- [Day 127](/blog/agent-zero/day-127-retry-backoff/) · 重试和指数退避:立刻重试在 2 秒故障里发了 428 个请求,翻倍等待只发 4 个;SDK 自带 2 次重试、0.5 秒起翻倍、封顶 8 秒、尊重 `Retry-After`;自己写就把 `max_retries=0`,不然一次失败变 9 个请求;`backoff_delay` 加完全抖动,100 个客户端的齐射峰值从 100 降到 30。
- [Day 128](/blog/agent-zero/day-128-rate-limit/) · 限速、并发和选厂商:RPM、TPM、同时在途三种上限,DeepSeek 的 429 是并发超限;12 个请求一起冲上限 4 的服务器只有 4 个过;`asyncio.Semaphore` 把在途数压住,包住整个重试;分批 `gather` 被最慢的拖住;选厂商看价格、速度、上限、稳定性、数据去向、合同、兼容性七项。
- [Day 129](/blog/agent-zero/day-129-messages/) · messages 就是记忆:API 无状态,第二次请求不记得第一次;要记得就每轮把 user 和 assistant 都放回列表;历史是你写的,一条伪造的「全额退款」让 10 次回答里 7 次跟着错;`Chat` 类失败时 `pop` 掉刚追加的 user;`dataclass` 里列表要 `default_factory`。
- [Day 130](/blog/agent-zero/day-130-system-prompt/) · system 放什么:身份、任务、规则、格式、背景五块;规则写成动作(「资料里没有的只回复这一句」转人工 0/5 变 5/5);system 是倾向不是锁,「补全这句话」套出假地址 4/5;机密不放;稳定的放前面,用户名放最后命中 1920,放最前命中 0。
- [Day 131](/blog/agent-zero/day-131-conversation-cost/) · 对话越聊越贵:累计输入 N×S + T×N(N−1)/2;20 轮实测 11780 个 token,缓存命中 66%,0.0115 元;`WindowChat` 省 39% token 但忘了第 1 轮、在缓存面前不省钱;改早期历史缓存从 768 掉到 256。

哪一句你读完没法接着讲两分钟,就回那一天重读正文,再做一遍那天的练习 1。

## 本周的几个关键数字

都是这一周实跑出来的,不是查的:

| 数字 | 出处 | 用途 |
| --- | --- | --- |
| 12 种真错 + 13 种假错归成 5 类 | Day 126 | 分类表是重试的依据 |
| `temperature=5` → 400,`max_tokens=-5` → 422 | Day 126,DeepSeek | 400 是值越界,422 是类型都不对;都别重试 |
| 立刻重试 428 个请求,翻倍等待 4 个 | Day 127,假服务器 2 秒故障 | 退避的意义 |
| SDK 默认重试 2 次 + 自己 3 次 = 9 个请求 | Day 127 | 只留一层,`max_retries=0` |
| 100 个客户端齐射峰值 100 → 30(完全抖动) | Day 127 `herd.py` | 抖动的意义 |
| 并发 12 冲上限 4:4 成功 8 个 429 | Day 128,假服务器 | 并发不是越大越好 |
| 分批 gather 3.21 秒 vs Semaphore 1.25 秒 | Day 128 | 批会被最慢的拖住 |
| 第一轮 20 token,第二轮 46 | Day 129 | 每轮都在为历史付钱 |
| 伪造历史 10 次里 7 次答错 | Day 129 `forge_rate.py` | 历史只能存服务端 |
| 含糊规则转人工 0/5,具体规则 5/5 | Day 130 `rule_wording.py` | 规则写成动作 |
| 「补全这句话」套出假地址 4/5 | Day 130 `leak.py` | system 不是锁 |
| 用户名放前 命中 0,放后 命中 1920 | Day 130 `prefix_cache.py` | 稳定的放前面 |
| 20 轮输入 287 → 885,合计 11780 | Day 131 | 平方级 |
| 缓存命中 66%,0.0115 元 vs 无缓存 0.0268 | Day 131 | 缓存救了平方 |
| 窗口 3 轮:token 少 39%,钱 0.0114 vs 0.0115 | Day 131 | 裁剪省 token 不一定省钱 |
| 改第 1 轮回答:命中 768 → 256 | Day 131 练习 5 | 历史原样放回 |

## 小项目:一个扛得住错、算得清钱的客服会话

Day 125 的小项目给厂商做「体检」,四个探针各发一次。这一周的小项目换个形态:**一个对象管一整段对话**,把本周每天的零件装进去:

1. `WindowChat`(129、131)管历史,只发最近几轮。
2. 每次发请求走 `call_with_retry`(127),重试与否由 `classify`(126)决定,重试过程记日志。
3. 每轮拿 `usage` 算钱(124、131),累计到预算就停,不再发。
4. system 用 `build_system`(130),对话结束存成 JSON(129 练习 5)。

然后在两个地方跑:Day 126 的假服务器(造 429 和 401),和真 DeepSeek。并发(128)这一天的内容不放进会话对象里,因为 `Chat.ask` 是同步的,它放在练习 2 里单独用。

新建 `part02/week19_lab.py`:

```python
# agent-zero-lab/part02/week19_lab.py
import json
import os
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import openai
from dotenv import load_dotenv
from openai import OpenAI
from openai.types import CompletionUsage
from openai.types.chat import ChatCompletion, ChatCompletionMessageParam

from common.cost import Price, call_cost, parse_price, split_input
from part02.chat_store import save_chat
from part02.classify import Verdict, classify
from part02.retry import RetryPolicy, call_with_retry
from part02.system_prompt import build_system
from part02.window_chat import WindowChat

SendOnce = Callable[[list[ChatCompletionMessageParam]], ChatCompletion]


class BudgetExceeded(Exception):
    pass


@dataclass
class TurnReport:
    n: int
    prompt: int
    hit: int
    completion: int
    cost: float
    attempts: int
    latency: float


@dataclass
class Session:
    chat: WindowChat
    send_once: SendOnce
    price: Price
    budget: float
    policy: RetryPolicy = RetryPolicy(max_attempts=4, base=0.2, cap=2.0)
    reports: list[TurnReport] = field(default_factory=list)
    retry_log: list[str] = field(default_factory=list)

    def spent(self) -> float:
        return sum(r.cost for r in self.reports)

    def ask(self, text: str) -> str:
        if self.spent() >= self.budget:
            raise BudgetExceeded(f"已花 {self.spent():.5f} 元, 预算 {self.budget} 元")
        attempts = 0
        usage: CompletionUsage | None = None
        start = time.monotonic()

        def attempt(messages: list[ChatCompletionMessageParam]) -> ChatCompletion:
            nonlocal attempts
            attempts += 1
            return self.send_once(messages)

        def note(attempt_no: int, delay: float, verdict: Verdict) -> None:
            self.retry_log.append(f"第 {attempt_no} 次失败({verdict.kind}), 等 {delay:.2f} 秒再试")

        def send(messages: list[ChatCompletionMessageParam]) -> tuple[str, int]:
            nonlocal usage
            resp = call_with_retry(lambda: attempt(messages), self.policy, on_retry=note)
            usage = resp.usage
            assert usage is not None
            return (resp.choices[0].message.content or "").strip(), usage.prompt_tokens

        reply = self.chat.ask(text, send)
        assert usage is not None
        hit, _ = split_input(usage)
        self.reports.append(TurnReport(len(self.reports) + 1, usage.prompt_tokens, hit, usage.completion_tokens,
                                       call_cost(usage, self.price), attempts, time.monotonic() - start))
        return reply


def run_session(session: Session, turns: list[str]) -> None:
    for text in turns:
        try:
            reply = session.ask(text)
        except BudgetExceeded as e:
            print(f"(停:{e})")
            break
        except openai.OpenAIError as e:
            v = classify(e)
            print(f"你> {text}\n(失败:{v.kind},{v.advice};这一句没有记进历史)")
            continue
        r = session.reports[-1]
        print(f"你> {text}\n助手> {reply}")
        print(f"   [输入 {r.prompt}(命中 {r.hit}) 输出 {r.completion} 试了 {r.attempts} 次 "
              f"{r.latency:.2f} 秒 本轮 {r.cost:.5f} 元 累计 {session.spent():.5f} 元 历史 {len(session.chat.messages)} 条 "
              f"发了 {len(session.chat.payload())} 条]")
    for line in session.retry_log:
        print("   重试记录:", line)


def real_session(budget: float, keep_turns: int) -> Session:
    load_dotenv(os.environ.get("ENV_FILE", ".env"), override=True)
    client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"], max_retries=0, timeout=60)
    model = os.environ["LLM_MODEL"]
    extra_body = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))

    def send_once(messages: list[ChatCompletionMessageParam]) -> ChatCompletion:
        return client.chat.completions.create(model=model, messages=messages, max_tokens=150, extra_body=extra_body)

    chat = WindowChat(system=build_system(date(2026, 10, 23), "小林", "专业版年付"), keep_turns=keep_turns)
    return Session(chat, send_once, parse_price(os.environ["LLM_PRICE"]), budget)


def fake_session(base_url: str, model: str, budget: float = 1.0) -> Session:
    client = OpenAI(base_url=base_url, api_key="sk-fake", max_retries=0, timeout=5)

    def send_once(messages: list[ChatCompletionMessageParam]) -> ChatCompletion:
        return client.chat.completions.create(model=model, messages=messages, max_tokens=50)

    return Session(WindowChat(system="你是客服", keep_turns=2), send_once, Price(0.04, 2, 8), budget)


TURNS = [
    "你好,我是小林,我们团队 6 个人。",
    "专业版含几个席位?",
    "我们够用吗?",
    "退款政策是什么?",
    "我 40 天前买的,能退多少?",
    "能开增值税专用发票吗?",
    "我们团队几个人来着?",
    "帮我总结一下刚才聊的。",
]


def main() -> None:
    if "--fake" in sys.argv:
        from part02.fake_llm import fake_server

        with fake_server() as (url, server):
            print("=== 假服务器: 前两次 429, 第三次成功")
            run_session(fake_session(url, "flaky:429:2"), TURNS[:2])
            print("=== 假服务器: 401")
            run_session(fake_session(url, "status-401"), TURNS[:1])
            print(f"服务器一共收到 {len(server.requests_seen)} 个请求: {server.requests_seen}")
        return
    budget = float(sys.argv[1]) if len(sys.argv) > 1 else 0.003
    session = real_session(budget, keep_turns=3)
    run_session(session, TURNS)
    out = Path("data/week19_session.json")
    save_chat(session.chat, out)
    print(f"对话已存到 {out}, 共 {len(session.reports)} 轮, 花了 {session.spent():.5f} 元")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from collections.abc import Callable` 要给「发一次请求的函数」起类型名。
- `from openai.types import CompletionUsage` `usage` 的类型(Day 124)。
- `from openai.types.chat import ChatCompletion, ChatCompletionMessageParam` 响应的类型和消息的类型。
- `from common.cost import Price, call_cost, parse_price, split_input` Day 124 的全部四样。
- `from part02.chat_store import save_chat` Day 129 练习 5 的存盘函数。
- `from part02.classify import Verdict, classify` Day 126:`Verdict` 用在重试日志的类型标注里,`classify` 用在最后给人看的建议里。
- `from part02.retry import RetryPolicy, call_with_retry` Day 127 的重试。
- `from part02.system_prompt import build_system` Day 130。
- `from part02.window_chat import WindowChat` Day 131。
- `SendOnce = Callable[[list[ChatCompletionMessageParam]], ChatCompletion]` 「发一次、不重试、返回完整响应」的函数类型。和 Day 129 的 `Send` 不一样:`Send` 返回(文字,token 数)给 `Chat` 用,`SendOnce` 返回原始响应,给重试和记账用。两层各管一件事。
- `class BudgetExceeded(Exception):` 预算用完时抛的异常,自定义异常类 [Day 36](/blog/agent-zero/day-036-exceptions-2/) 学的。
- `class TurnReport:` 一轮的账:第几轮、输入、命中、输出、钱、试了几次、耗时。`dataclass` 装数据(Day 50)。
- `class Session:` 一段会话。把本周的零件都装在这里。
- `chat: WindowChat` 历史由它管,发出去的只有最近几轮。
- `send_once: SendOnce` 怎么发一次,由外面传进来:真客户端或者假服务器的客户端。`Session` 自己不知道厂商是谁,这和 Day 129 把 `send` 传给 `Chat.ask` 是同一个思路。
- `budget: float` 预算,元。
- `policy: RetryPolicy = RetryPolicy(max_attempts=4, base=0.2, cap=2.0)` 最多试 4 次,0.2 秒起翻倍,封顶 2 秒。`RetryPolicy` 是 `frozen=True` 的 dataclass,不可变,所以可以直接当默认值,不用 `default_factory`(可变的才要)。
- `reports: list[TurnReport] = field(default_factory=list)` 每轮一份账,Day 129 的 `default_factory` 规矩。
- `retry_log: list[str] = field(default_factory=list)` 重试日志,一行一句人话。
- `def spent(self) -> float:` 累计花费。
- `return sum(r.cost for r in self.reports)` 把每轮的 `cost` 加起来。
- `def ask(self, text: str) -> str:` 问一句。
- `if self.spent() >= self.budget:` 发之前先看钱。超了就不发,抛异常让调用方决定怎么办。
- `attempts = 0` 这一轮试了几次,下面的闭包会改它。
- `usage: CompletionUsage | None = None` 这一轮的 `usage`,同样由闭包填。
- `def attempt(messages: list[ChatCompletionMessageParam]) -> ChatCompletion:` 一次尝试:计数加一,然后真的发。
- `nonlocal attempts` **今天的新语法。**Python 里,函数内部给外层函数的变量赋值,必须先声明 `nonlocal`,否则 `attempts += 1` 会被当成新建一个局部变量,报 `UnboundLocalError`。JS 的闭包可以直接改外层的 `let`,Python 要多写这一行。Day 131 的 `usages.append(...)` 不需要它,因为那是改列表的内容,不是给变量重新赋值。
- `def note(attempt_no: int, delay: float, verdict: Verdict) -> None:` 给 `call_with_retry` 的 `on_retry` 回调(Day 127 的 `demo_retry.py` 用过):每次要重试时它被调用一次。
- `self.retry_log.append(f"第 {attempt_no} 次失败({verdict.kind}), 等 {delay:.2f} 秒再试")` 记一行。
- `def send(messages: list[ChatCompletionMessageParam]) -> tuple[str, int]:` 符合 Day 129 `Send` 类型的函数,交给 `Chat.ask`。
- `nonlocal usage` 同理,下面要给 `usage` 赋值。
- `resp = call_with_retry(lambda: attempt(messages), self.policy, on_retry=note)` **本周的核心一行**:Day 127 的重试包住一次尝试,该不该重试由里面的 `classify` 决定。
- `usage = resp.usage` 记下来,`ask` 后面要用。
- `return (resp.choices[0].message.content or "").strip(), usage.prompt_tokens` 按 `Send` 的约定返回。
- `reply = self.chat.ask(text, send)` Day 129 的 `Chat.ask`:追加 user、发、追加 assistant;失败就回滚并把异常原样抛出来,所以 401 不会把这句话留在历史里。
- `hit, _ = split_input(usage)` 拆命中,未命中这里不用,`_` 丢掉。
- `self.reports.append(TurnReport(len(self.reports) + 1, usage.prompt_tokens, hit, usage.completion_tokens,` 这一轮的账。`attempts` 是闭包里数出来的次数。
- `def run_session(session: Session, turns: list[str]) -> None:` 把一串问题喂给会话,打印每轮,处理两种异常。
- `except BudgetExceeded as e:` 预算用完,打印然后 `break`:后面的问题不问了。
- `except openai.OpenAIError as e:` 重试用完还是失败,或者不该重试的错。
- `v = classify(e)` 用 Day 126 的分类给一句建议。
- `print(f"你> {text}\n(失败:{v.kind},{v.advice};这一句没有记进历史)")` 这一句没进历史,是 `Chat.ask` 回滚的结果。
- `r = session.reports[-1]` 刚才那一轮的账。
- `print(f"   [输入 {r.prompt}(命中 {r.hit}) 输出 {r.completion} 试了 {r.attempts} 次 "` 一行把本周所有数字都打出来。
- `f"发了 {len(session.chat.payload())} 条]")` 「历史 N 条」和「发了 M 条」对比,就能看到窗口在起作用。
- `for line in session.retry_log:` 结束后把重试日志打出来。
- `def real_session(budget: float, keep_turns: int) -> Session:` 真 DeepSeek 的会话。
- `load_dotenv(os.environ.get("ENV_FILE", ".env"), override=True)` Day 123 的读配置,`override=True` 不能少。
- `max_retries=0, timeout=60)` SDK 自己的重试关掉(Day 127:两层叠加一次失败 9 个请求)。
- `def send_once(messages: list[ChatCompletionMessageParam]) -> ChatCompletion:` 一次真实请求,`max_tokens=150`。
- `chat = WindowChat(system=build_system(date(2026, 10, 23), "小林", "专业版年付"), keep_turns=keep_turns)` Day 130 的 system,Day 131 的窗口。
- `return Session(chat, send_once, parse_price(os.environ["LLM_PRICE"]), budget)` 装起来。
- `def fake_session(base_url: str, model: str, budget: float = 1.0) -> Session:` 对准 Day 126 假服务器的会话。`model` 写成 `flaky:429:2` 这种,假服务器按名字决定怎么回。
- `client = OpenAI(base_url=base_url, api_key="sk-fake", max_retries=0, timeout=5)` 假 key 随便写,假服务器不检查。
- `return Session(WindowChat(system="你是客服", keep_turns=2), send_once, Price(0.04, 2, 8), budget)` 假服务器的 `usage` 是固定的 5 / 8,价格随便给一个。
- `TURNS = [` 8 句话。第 7 句回头问第 1 句说的人数,窗口 3 轮时它已经不在窗口里了。
- `def main() -> None:` 命令行:`--fake` 跑假服务器,否则跑真的,第一个参数是预算。
- `from part02.fake_llm import fake_server` 放在函数里 import,是因为真跑的时候用不着它;放顶上也行,只是启动慢一点点。
- `with fake_server() as (url, server):` Day 126 的上下文管理器,进去时起服务器,出来时关掉。
- `run_session(fake_session(url, "flaky:429:2"), TURNS[:2])` 第一个假会话:模型名告诉假服务器「前 2 次回 429,之后成功」。只问两句。
- `run_session(fake_session(url, "status-401"), TURNS[:1])` 第二个假会话:永远 401。
- `print(f"服务器一共收到 {len(server.requests_seen)} 个请求: {server.requests_seen}")` 假服务器记下了每一个请求,这是验证重试次数最可靠的办法(Day 127 的教训:只看异常不够,要数请求)。
- `budget = float(sys.argv[1]) if len(sys.argv) > 1 else 0.003` 默认预算 0.003 元,故意设小,8 句话问不完就会停。
- `save_chat(session.chat, out)` Day 129 练习 5 的存盘,存的是完整历史(窗口只影响发出去的)。

</div>

先跑假服务器那一半,不花钱:

```bash
cd ~/agent-zero-lab
uv run python -m part02.week19_lab --fake
```

```text
=== 假服务器: 前两次 429, 第三次成功
你> 你好,我是小林,我们团队 6 个人。
助手> 假服务器说:你好
   [输入 5(命中 0) 输出 8 试了 3 次 0.64 秒 本轮 0.00007 元 累计 0.00007 元 历史 2 条 发了 3 条]
你> 专业版含几个席位?
助手> 假服务器说:你好
   [输入 5(命中 0) 输出 8 试了 1 次 0.00 秒 本轮 0.00007 元 累计 0.00015 元 历史 4 条 发了 5 条]
   重试记录: 第 1 次失败(太快了), 等 0.18 秒再试
   重试记录: 第 2 次失败(太快了), 等 0.38 秒再试
=== 假服务器: 401
你> 你好,我是小林,我们团队 6 个人。
(失败:你的账号,key 不对或已作废:检查配置文件里的 LLM_API_KEY;这一句没有记进历史)
服务器一共收到 5 个请求: ['flaky:429:2', 'flaky:429:2', 'flaky:429:2', 'flaky:429:2', 'status-401']
```

逐段读。第一句话「试了 3 次」,0.64 秒:两次 429 各等了一会儿(0.18 和 0.38 秒,是 `base=0.2` 翻倍再加抖动的结果),第三次成功。第二句「试了 1 次」,因为假服务器的 `flaky` 是按模型名计数的,前两次失败用完了。回答都是「假服务器说:你好」,`usage` 固定 5 / 8,钱是 (5 × 2 + 8 × 8) / 1,000,000 = 0.00007 元。401 那个会话:一次就放弃,给出 Day 126 的建议,历史里没有留下这句话。最后一行是铁证:服务器收到 4 个 `flaky` 请求(3 + 1)和 1 个 `status-401`,401 没有被重试。

再跑真的:

```bash
uv run python -m part02.week19_lab
```

```text
你> 你好,我是小林,我们团队 6 个人。
助手> 你好小林！专业版年付含 5 个成员席位，你们 6 个人需要额外增加 1 个席位。具体席位费用和开通方式，我需要转给人工同事确认。
   [输入 273(命中 128) 输出 43 试了 1 次 1.08 秒 本轮 0.00064 元 累计 0.00064 元 历史 2 条 发了 3 条]
你> 专业版含几个席位?
助手> 专业版含 5 个成员席位，年付 950 元、月付 99 元。你们 6 人需额外增加 1 个席位。
   [输入 326(命中 128) 输出 38 试了 1 次 0.98 秒 本轮 0.00071 元 累计 0.00134 元 历史 4 条 发了 5 条]
你> 我们够用吗?
助手> 不够用，专业版含 5 个席位，你们 6 个人需要再加 1 个席位。具体席位费用需转人工同事确认。
   [输入 373(命中 128) 输出 34 试了 1 次 0.89 秒 本轮 0.00077 元 累计 0.00211 元 历史 6 条 发了 7 条]
你> 退款政策是什么?
助手> 年付订阅购买后 7 天内可全额退款；超过 7 天，按已使用月数乘月付价扣除后退还剩余，不足一个月按一个月算。具体金额以提交申请后财务核算为准。
   [输入 415(命中 256) 输出 49 试了 1 次 0.76 秒 本轮 0.00072 元 累计 0.00283 元 历史 8 条 发了 7 条]
你> 我 40 天前买的,能退多少?
助手> 按政策，超过 7 天按已使用月数扣费（不足一个月按一个月算），您约用 2 个月。具体金额以提交申请后财务核算为准，需要我帮您提交退款申请吗？
   [输入 421(命中 256) 输出 49 试了 1 次 1.46 秒 本轮 0.00073 元 累计 0.00356 元 历史 10 条 发了 7 条]
(停:已花 0.00356 元, 预算 0.003 元)
对话已存到 data/week19_session.json, 共 5 轮, 花了 0.00356 元
```

每一行都对应本周的一天:「试了 1 次」是 127(没出错);「命中 128、256」是 124 和 131(system 和历史的前缀命中了);「历史 8 条 发了 7 条」从第 4 轮开始分叉,是 131 的窗口在起作用(system + 3 轮 + 当前问题 = 7 条);回答里的「以财务核算为准」「转给人工同事确认」是 130 的规则;第 5 轮之后「停」,是预算 0.003 元用完了,第 6 句没有发出去。注意预算是**发之前**检查的,所以最后一轮会略微超过预算(0.00356),如果要严格不超,就得在发之前估这一轮的钱,那是以后的事。

把 `Session` 的行为用测试钉住,新建 `tests/test_week19_lab.py`:

```python
# agent-zero-lab/tests/test_week19_lab.py
import pytest
from openai.types.chat import ChatCompletion, ChatCompletionMessageParam

from common.cost import Price
from part02.fake_llm import fake_server
from part02.retry import RetryPolicy
from part02.week19_lab import BudgetExceeded, Session, fake_session
from part02.window_chat import WindowChat

FAST = RetryPolicy(max_attempts=4, base=0.01, cap=0.02)


def fake_reply(prompt_tokens: int) -> ChatCompletion:
    return ChatCompletion.model_validate({
        "id": "x", "object": "chat.completion", "created": 0, "model": "fake",
        "choices": [{"index": 0, "message": {"role": "assistant", "content": "好的"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": 10, "total_tokens": prompt_tokens + 10},
    })


def test_budget_stops_the_session() -> None:
    def send_once(messages: list[ChatCompletionMessageParam]) -> ChatCompletion:
        return fake_reply(1_000_000)

    session = Session(WindowChat(), send_once, Price(0.04, 2, 8), budget=3.0, policy=FAST)
    session.ask("一")
    assert session.spent() == pytest.approx(2.00008)
    session.ask("二")
    with pytest.raises(BudgetExceeded):
        session.ask("三")
    assert len(session.chat.messages) == 4


def test_429_twice_then_success_counts_attempts() -> None:
    with fake_server() as (url, server):
        session = fake_session(url, "flaky:429:2")
        session.policy = FAST
        reply = session.ask("你好")
        assert reply == "假服务器说:你好"
        assert session.reports[0].attempts == 3
        assert len(server.requests_seen) == 3
        assert len(session.retry_log) == 2


def test_401_is_not_retried_and_history_stays_clean() -> None:
    with fake_server() as (url, server):
        session = fake_session(url, "status-401")
        session.policy = FAST
        with pytest.raises(Exception):
            session.ask("你好")
        assert len(server.requests_seen) == 1
        assert session.chat.messages == []
        assert session.reports == []


def test_window_bounds_what_is_sent() -> None:
    seen: list[int] = []

    def send_once(messages: list[ChatCompletionMessageParam]) -> ChatCompletion:
        seen.append(len(messages))
        return fake_reply(10)

    session = Session(WindowChat(system="s", keep_turns=1), send_once, Price(0.04, 2, 8), budget=1, policy=FAST)
    for i in range(4):
        session.ask(f"问{i}")
    assert seen == [2, 4, 4, 4]
    assert len(session.chat.messages) == 8
```

<div class="line-notes">

- `FAST = RetryPolicy(max_attempts=4, base=0.01, cap=0.02)` 测试里的退避按 10 毫秒算,不然每个测试要等好几秒(Day 127 的做法)。
- `def fake_reply(prompt_tokens: int) -> ChatCompletion:` 不经过网络,直接用字典造一个响应对象。`model_validate` 是 pydantic 的「字典变对象」,Day 125 用它造过 `usage`。
- `def test_budget_stops_the_session() -> None:` 每轮假装输入 100 万个 token,一轮正好 2 元多一点。
- `assert session.spent() == pytest.approx(2.00008)` (1,000,000 × 2 + 10 × 8) / 1,000,000 = 2.00008。浮点数用 `approx` 比。
- `with pytest.raises(BudgetExceeded):` 第三次问:已花 4.00016 ≥ 3,抛异常。
- `assert len(session.chat.messages) == 4` 前两轮的 4 条在,第三句没有进历史。
- `def test_429_twice_then_success_counts_attempts() -> None:` 对准假服务器:前 2 次 429。
- `assert session.reports[0].attempts == 3` 闭包数出来的 3 次。
- `assert len(server.requests_seen) == 3` 服务器那边也是 3 个请求,两边对上。
- `assert len(session.retry_log) == 2` 重试日志 2 行。
- `def test_401_is_not_retried_and_history_stays_clean() -> None:` 401 只发一次,历史和账都是空的。
- `def test_window_bounds_what_is_sent() -> None:` K = 1:第 1 轮发 2 条(system + 问),之后每轮 4 条(system + 上一轮 + 问)。
- `assert seen == [2, 4, 4, 4]` 发出去的条数。
- `assert len(session.chat.messages) == 8` 完整历史 8 条都在。

</div>

```bash
uv run pytest tests/test_week19_lab.py -q
```

```text
....                                                                     [100%]
4 passed in 0.83s
```

### 零件 → 小项目对照

| 本周学的零件 | 在 `week19_lab.py` 的哪里 |
| --- | --- |
| Day 126 `classify`、假服务器、`Verdict` | `run_session` 的 `except` 分支、`fake_session`、`note` 的参数 |
| Day 127 `call_with_retry`、`RetryPolicy`、`on_retry`、`max_retries=0` | `Session.ask` 的 `send`、`policy` 字段、`real_session` 建客户端那一行 |
| Day 128 并发 | 不在这里,见练习 2 |
| Day 129 `Chat.ask`、失败回滚、`default_factory`、`save_chat` | `self.chat.ask(text, send)`、401 之后历史为空、`reports` 字段、`main` 末尾 |
| Day 130 `build_system` | `real_session` |
| Day 131 `WindowChat`、`split_input`、`call_cost`、预算 | `chat` 字段、`TurnReport` 那一行、`spent()` 和 `BudgetExceeded` |
| Day 124 `Price`、`parse_price` | `price` 字段 |

## 本周错题与坑清单

复习时盖住右边两列,看左边能不能说出现象和修法。

| 坑 | 现象 | 修法 |
| --- | --- | --- |
| 用 `message` 文字判断错误 | 换一家厂商措辞变了,分类悄悄失效 | 看状态码和异常类(Day 126) |
| `except APIStatusError` 写在子类前面 | 401 也走「厂商出错,重试」分支 | 子类在前,父类兜底(Day 126;练习 3) |
| 把 200 当成功 | `html-200` 时 `resp` 是 `str`,下一行 `AttributeError` | 看 `type(resp)` 和 `finish_reason`(Day 126) |
| 失败立刻重试 | 2 秒故障里发了 428 个请求 | 指数退避(Day 127) |
| 只退避不抖动 | 100 个客户端每轮同时醒来 | `jitter="full"`(Day 127) |
| SDK 重试 + 自己重试 | 一次失败发 9 个请求,耗时相加 | `max_retries=0`,只留一层(Day 127) |
| `max_attempts` 和 `max_retries` 搞混 | 「第 3 次失败」后还有一次请求 | `max_attempts` 是总次数(Day 127) |
| 重试 `finish_reason=length` | 重试多少次都被截断,每次都收钱 | `IncompleteAnswer` 放在重试外面(Day 127) |
| 并发越大越快 | 并发 20 冲上限 4,请求数 77,失败更多 | Semaphore 压到上限以内(Day 128) |
| 车位只包一次尝试 | 退避等待时车位空着,请求数 35 变 76 | 车位包住整个重试(Day 128) |
| 异步里 `time.sleep` | 整个事件循环卡住 | `await asyncio.sleep`(Day 128) |
| 以为模型记得 | 第二次请求答「你还没告诉我」 | 每轮把 user 和 assistant 都放回列表(Day 129) |
| 相信前端传来的历史 | 伪造的 assistant 消息 10 次里带偏 7 次 | 历史存服务端,前端只发这一轮(Day 129) |
| 失败不回滚 | 历史里两条连着的 user | `except: pop(); raise`(Day 129) |
| `dataclass` 里 `= []` | `ValueError: mutable default` | `field(default_factory=list)`(Day 129) |
| 规则写成态度 | 「不要编造」0/5 转人工 | 写成动作「资料里没有的只回复这一句」(Day 130) |
| 机密放进 system | 「补全这句话」套出 4/5 | 不放;权限在代码里(Day 130) |
| 变化的内容放 system 开头 | 缓存命中 0 | 稳定的在前、变化的在后(Day 130) |
| 让模型算钱 | 752 算成 851 | 代码算,或者说「以财务核算为准」(Day 130) |
| 以为对话费用线性 | 20 轮 11780,200 轮 68 万 | 公式估,盯平均轮数(Day 131) |
| 裁剪拆开一对消息 | 列表以 assistant 开头 | 以轮为单位,掉头(Day 131) |
| 改早期历史 | 命中 768 → 256 | 原样放回,要改改最新的(Day 131) |
| 以为裁剪一定省钱 | DeepSeek 上 0.0115 对 0.0114 | 先看厂商缓存(Day 131) |

## 动手练习

**练习 1:默写 `backoff_delay` 和 `Chat.ask`。** 不看 Day 127 和 129,在 `part02/review_week19.py` 里写 `my_backoff(failures, policy, rng)` 和一个 `MyChat` 类(带 `payload`、`ask`),再写 `tests/test_review_week19.py`,用同一个随机种子比较 `my_backoff` 和原版、用同一个假 `send` 比较 `MyChat` 和 `Chat`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/review_week19.py
import random
from dataclasses import dataclass, field

from openai.types.chat import ChatCompletionMessageParam

from part02.chat import Send
from part02.retry import RetryPolicy


def my_backoff(failures: int, policy: RetryPolicy, rng: random.Random) -> float:
    ceiling = min(policy.cap, policy.base * 2**failures)
    if policy.jitter == "full":
        return rng.uniform(0, ceiling)
    if policy.jitter == "equal":
        return ceiling / 2 + rng.uniform(0, ceiling / 2)
    return ceiling


@dataclass
class MyChat:
    system: str | None = None
    messages: list[ChatCompletionMessageParam] = field(default_factory=list)
    input_tokens: list[int] = field(default_factory=list)

    def payload(self) -> list[ChatCompletionMessageParam]:
        head: list[ChatCompletionMessageParam] = []
        if self.system is not None:
            head.append({"role": "system", "content": self.system})
        return head + self.messages

    def ask(self, text: str, send: Send) -> str:
        self.messages.append({"role": "user", "content": text})
        try:
            reply, tokens = send(self.payload())
        except BaseException:
            self.messages.pop()
            raise
        self.messages.append({"role": "assistant", "content": reply})
        self.input_tokens.append(tokens)
        return reply
```

<div class="line-notes">

- `ceiling = min(policy.cap, policy.base * 2**failures)` 第 `failures` 次失败后的上限:`base` 翻 `failures` 次倍,不超过 `cap`。默写时最容易忘 `min`。
- `return rng.uniform(0, ceiling)` 完全抖动:0 到上限之间随机。
- `return ceiling / 2 + rng.uniform(0, ceiling / 2)` 等量抖动:一半固定一半随机。
- `return ceiling` 没有抖动。
- `messages: list[ChatCompletionMessageParam] = field(default_factory=list)` 默写时最容易写成 `= []`,写了会被 `dataclass` 当场拒绝。
- `except BaseException:` 任何异常都回滚。
- `self.messages.pop()` 把刚追加的 user 拿掉。
- `raise` 原样抛出。

</div>

```python
# agent-zero-lab/tests/test_review_week19.py
import random

import pytest
from openai.types.chat import ChatCompletionMessageParam

from part02.chat import Chat
from part02.retry import RetryPolicy, backoff_delay
from part02.review_week19 import MyChat, my_backoff


@pytest.mark.parametrize("jitter", ["none", "full", "equal"])
def test_my_backoff_matches_the_original(jitter: str) -> None:
    policy = RetryPolicy(base=0.5, cap=8.0, jitter=jitter)  # type: ignore[arg-type]
    for failures in range(6):
        mine = my_backoff(failures, policy, random.Random(42))
        ref = backoff_delay(failures, policy, random.Random(42))
        assert mine == ref


def test_my_chat_behaves_like_chat() -> None:
    def send(messages: list[ChatCompletionMessageParam]) -> tuple[str, int]:
        return f"回{len(messages)}", 10 * len(messages)

    a, b = MyChat(system="s"), Chat(system="s")
    for text in ("一", "二"):
        assert a.ask(text, send) == b.ask(text, send)
    assert a.payload() == b.payload()
    assert a.input_tokens == b.input_tokens == [20, 40]


def test_my_chat_rolls_back_on_failure() -> None:
    def boom(messages: list[ChatCompletionMessageParam]) -> tuple[str, int]:
        raise RuntimeError("断了")

    chat = MyChat()
    with pytest.raises(RuntimeError):
        chat.ask("你好", boom)
    assert chat.messages == []
```

<div class="line-notes">

- `@pytest.mark.parametrize("jitter", ["none", "full", "equal"])` 三种抖动各测一遍,Day 73 的 parametrize。
- `policy = RetryPolicy(base=0.5, cap=8.0, jitter=jitter)  # type: ignore[arg-type]` `jitter` 的类型是 `Literal`,参数化传进来的是普通 `str`,类型检查器会抱怨,这里告诉它没事。
- `mine = my_backoff(failures, policy, random.Random(42))` 两边都用种子 42 的随机数生成器,所以随机的结果也一样,可以直接 `==`。
- `assert a.input_tokens == b.input_tokens == [20, 40]` 第一轮 2 条 → 20,第二轮 4 条 → 40;链式比较 `a == b == c`。

</div>

```bash
uv run pytest tests/test_review_week19.py -q
```

```text
.....                                                                    [100%]
5 passed in 0.62s
```

5 个全过。我默写 `my_backoff` 时第一遍漏了 `min(policy.cap, ...)`,`failures=5` 时算出 16 秒,测试立刻红了:默写出错的地方就是没真懂的地方。

</details>

**练习 2:5 个会话一起开始。** Day 128 的内容没进小项目。写 `part02/sessions_burst.py`:5 个不同用户(system 里用户名不同)同时问同一个问题,`asyncio.Semaphore(3)` 限并发,每次调用走 Day 128 的 `acall_with_retry`,打印每个会话的耗时、花费和总时间。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/sessions_burst.py
import asyncio
import json
import os
import time
from datetime import date

from dotenv import load_dotenv
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam

from common.cost import call_cost, parse_price
from part02.aretry import acall_with_retry
from part02.retry import RetryPolicy
from part02.system_prompt import build_system

load_dotenv(os.environ.get("ENV_FILE", ".env"), override=True)
client = AsyncOpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"], max_retries=0, timeout=60)
MODEL = os.environ["LLM_MODEL"]
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
PRICE = parse_price(os.environ["LLM_PRICE"])
POLICY = RetryPolicy(max_attempts=4, base=0.5, cap=4.0)
USERS = ["小林", "小周", "小王", "小赵", "小钱"]
QUESTION = "专业版含几个席位?我们团队 6 个人够用吗?"


async def one(name: str, sem: asyncio.Semaphore) -> tuple[str, float, float]:
    messages: list[ChatCompletionMessageParam] = [
        {"role": "system", "content": build_system(date(2026, 10, 23), name, "专业版年付")},
        {"role": "user", "content": QUESTION},
    ]
    async with sem:
        start = time.monotonic()
        resp = await acall_with_retry(
            lambda: client.chat.completions.create(model=MODEL, messages=messages, max_tokens=100, extra_body=EXTRA),
            POLICY,
        )
    assert resp.usage is not None
    return (resp.choices[0].message.content or "")[:30], time.monotonic() - start, call_cost(resp.usage, PRICE)


async def main() -> None:
    sem = asyncio.Semaphore(3)
    start = time.monotonic()
    results = await asyncio.gather(*[one(name, sem) for name in USERS])
    for name, (answer, sec, cost) in zip(USERS, results):
        print(f"{name}: {sec:.2f} 秒 {cost:.5f} 元 「{answer}…」")
    print(f"5 个会话总共 {time.monotonic() - start:.2f} 秒, 花费 {sum(c for _, _, c in results):.5f} 元")


asyncio.run(main())
```

<div class="line-notes">

- `from openai import AsyncOpenAI` 异步客户端,Day 128 用过。
- `from part02.aretry import acall_with_retry` Day 128 的异步重试。
- `async def one(name: str, sem: asyncio.Semaphore) -> tuple[str, float, float]:` 一个用户的第一轮。
- `build_system(date(2026, 10, 23), name, "专业版年付")` 每个用户 system 不同,只差最后那行的用户名(Day 130 的「变化的放最后」),所以前面大段都能命中缓存。
- `async with sem:` 车位。包住整个 `acall_with_retry`,退避等待时也占着(Day 128 的「车位放哪」)。
- `resp = await acall_with_retry(` 重试包住一次调用。
- `results = await asyncio.gather(*[one(name, sem) for name in USERS])` 5 个一起发,最多 3 个在途。
- `for name, (answer, sec, cost) in zip(USERS, results):` 元组嵌套解包。

</div>

```bash
uv run python -m part02.sessions_burst
```

```text
小林: 1.09 秒 0.00060 元 「专业版含 5 个成员席位，你们团队 6 个人不够用，需要额外…」
小周: 0.85 秒 0.00087 元 「专业版含 5 个成员席位，你们团队 6 个人不够用，需要额外…」
小王: 1.20 秒 0.00087 元 「专业版含5个成员席位。你们6个人不够用，需要额外增加席位。具…」
小赵: 0.71 秒 0.00076 元 「专业版含 5 个成员席位。你们团队 6 人不够用，需要额外处…」
小钱: 0.92 秒 0.00085 元 「专业版含 5 个成员席位，你们 6 个人不够用，需要额外增加…」
5 个会话总共 2.01 秒, 花费 0.00395 元
```

5 个会话各 0.7 到 1.2 秒,总共 2.01 秒:限 3 并发,前 3 个一批、后 2 个一批,大约两个请求的时间。一个接一个发要 4.8 秒左右。小林那一行比别人便宜,是因为它的 system 和前面 Day 131 的实验一样,命中了更多缓存。要把这个和小项目合起来做成「多个 `Session` 同时聊」,得给 `Session` 做一个异步版本,`Chat.ask` 也要改成 `async`,[Day 162](/blog/agent-zero/day-162-parallel-tools/) 讲异步和同步代码怎么混用时再做。

</details>

**练习 3:找错。** 下面四段代码各有一个本周讲过的坑,先说出是哪个坑、会出现什么现象,再改对。第一段写成可以跑的 `part02/except_order.py`,对准假服务器验证。

```python
# 一
try:
    client.chat.completions.create(model=model, messages=messages)
except openai.APIStatusError:
    retry()
except openai.AuthenticationError:
    give_up()

# 二
client = OpenAI(base_url=url, api_key=key)
resp = call_with_retry(lambda: client.chat.completions.create(...), RetryPolicy(max_attempts=3))

# 三
@dataclass
class Chat:
    messages: list = []

# 四
def payload(self):
    return [system_message] + self.messages[-6:]
```

<details><summary>参考答案</summary>

**一:父类在前。**`APIStatusError` 是所有 HTTP 错误的父类,401 的 `AuthenticationError` 也是它的子类,所以第二个 `except` 永远走不到,401 被当成「可重试」。改法是子类在前:

```python
# agent-zero-lab/part02/except_order.py
import openai
from openai import OpenAI

from part02.fake_llm import fake_server


def wrong_order(client: OpenAI, model: str) -> str:
    try:
        client.chat.completions.create(model=model, messages=[{"role": "user", "content": "hi"}])
    except openai.APIStatusError:
        return "厂商出错, 重试"
    except openai.AuthenticationError:
        return "key 不对, 别重试"
    return "成功"


def right_order(client: OpenAI, model: str) -> str:
    try:
        client.chat.completions.create(model=model, messages=[{"role": "user", "content": "hi"}])
    except openai.AuthenticationError:
        return "key 不对, 别重试"
    except openai.APIStatusError:
        return "厂商出错, 重试"
    return "成功"


with fake_server() as (url, _):
    client = OpenAI(base_url=url, api_key="sk-fake", max_retries=0, timeout=5)
    for model in ("status-401", "status-503"):
        print(f"{model}: 父类在前 → {wrong_order(client, model)!r:16} 子类在前 → {right_order(client, model)!r}")
```

<div class="line-notes">

- `def wrong_order(client: OpenAI, model: str) -> str:` 错误的顺序,原样照抄题目。
- `except openai.APIStatusError:` 父类,401 和 503 都会被它接住。
- `def right_order(client: OpenAI, model: str) -> str:` 子类 `AuthenticationError` 在前。
- `for model in ("status-401", "status-503"):` 假服务器按模型名回 401 和 503。
- `print(f"{model}: 父类在前 → {wrong_order(client, model)!r:16} 子类在前 → {right_order(client, model)!r}")` `!r:16` 是 repr 再补齐到 16 格。

</div>

```bash
uv run python -m part02.except_order
```

```text
status-401: 父类在前 → '厂商出错, 重试'       子类在前 → 'key 不对, 别重试'
status-503: 父类在前 → '厂商出错, 重试'       子类在前 → '厂商出错, 重试'
```

401 在错误的顺序下被判成「重试」。编辑器不会报错,只有测试或者线上日志能发现。

**二:两层重试叠加。**`OpenAI(...)` 没写 `max_retries=0`,SDK 默认重试 2 次;外面再包 3 次,一次失败最多发 3 × 3 = 9 个请求,耗时两层相加。改法:`OpenAI(base_url=url, api_key=key, max_retries=0)`。

**三:可变默认值。**`dataclass` 直接拒绝,报 `ValueError: mutable default <class 'list'> for field messages is not allowed: use default_factory`。普通函数参数写 `= []` 更糟,不报错但所有调用共用一个列表。改法:`messages: list = field(default_factory=list)`。

**四:切片拆开一对。**`self.messages[-6:]` 在 `ask` 里调用时列表是奇数条([u, a, u, a, u, a, u]),取 6 条会从一条 assistant 开头。改法:取 `2K + 1` 条,再检查第一条是不是 assistant,是就去掉(Day 131 的 `WindowChat.payload`)。

</details>

**练习 4:用本周的数据选厂商。** 不调 API,写 `part02/vendor_pick.py`,读 Day 131 的 `data/cost_curve.json`(DeepSeek)和 `data/cost_curve_sf.json`(硅基流动),对每家算出:20 轮总花费、缓存命中率、有几轮一个都没命中、耗时中位数和最慢一次。再按 Day 128 的七项说说,这个客服场景你选哪家。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/vendor_pick.py
import json
import statistics
from pathlib import Path

for label, name in (("DeepSeek", "cost_curve"), ("硅基流动", "cost_curve_sf")):
    rows = json.loads(Path(f"data/{name}.json").read_text(encoding="utf-8"))
    cost = sum(r["cost"] for r in rows)
    prompt = sum(r["prompt"] for r in rows)
    hit = sum(r["hit"] for r in rows)
    lat = [r["latency"] for r in rows]
    zero_hit = sum(1 for r in rows if r["hit"] == 0)
    print(f"{label:8} 20 轮 {cost:.4f} 元 | 输入 {prompt} 命中率 {hit / prompt:.0%}, 有 {zero_hit} 轮一个都没命中 "
          f"| 耗时中位数 {statistics.median(lat):.2f} 秒, 最慢 {max(lat):.2f} 秒")
```

<div class="line-notes">

- `for label, name in (("DeepSeek", "cost_curve"), ("硅基流动", "cost_curve_sf")):` 两份文件。
- `zero_hit = sum(1 for r in rows if r["hit"] == 0)` 数有几轮命中是 0:生成器里每满足一次就贡献一个 1。
- `statistics.median(lat)` 中位数,Day 128 `vendor_compare.py` 的做法:比平均数更能抵抗一两次特别慢的。

</div>

```bash
uv run python -m part02.vendor_pick
```

```text
DeepSeek 20 轮 0.0115 元 | 输入 11780 命中率 66%, 有 0 轮一个都没命中 | 耗时中位数 0.74 秒, 最慢 1.72 秒
硅基流动     20 轮 0.0288 元 | 输入 13577 命中率 47%, 有 6 轮一个都没命中 | 耗时中位数 1.21 秒, 最慢 12.48 秒
```

同一个模型,硅基流动贵 2.5 倍、慢一半、最慢一次 12 秒、缓存时有时无。按 Day 128 的七项:价格、速度、稳定性三项 DeepSeek 都赢;上限 DeepSeek 并发 2500 也够客服用;兼容性两家都是 OpenAI 协议(DeepSeek 不认 `developer` 角色,Day 129 测过);数据去向和合同两项要问商务,这里没有数据。对「多轮客服」这个场景我选 DeepSeek,理由是多轮对话的大头是重发历史,缓存稳不稳直接决定账单。注意这只是 20 轮、一个下午的数据,上生产前要跑几天再看。

</details>

**练习 5:三分钟讲清一轮对话。** 面试开放题:「用户在你们的客服机器人里发了一句话,到他看到回答,你的代码做了什么?中间可能出什么错?」只用 Day 126–131 的内容,写在 `part02/explain_turn.md` 里,读出来计时,要提到:历史从哪来、system 怎么拼、出错怎么分类、什么情况重试、并发怎么控、钱怎么算、历史怎么裁。

<details><summary>参考答案</summary>

示范,不是标准答案:

> 用户的话到了后端,我先按会话 id 从服务端取出历史,不信任前端传来的任何 assistant 消息,因为伪造一条「全额退款」就能让模型 10 次里 7 次照着说。然后拼 messages:最前面是 system,分身份、任务、规则、格式、背景五块,规则写成可检查的动作,背景里放这个用户的套餐和今天日期,放在最后,这样前面几千 token 都能命中前缀缓存。请求出去之前过一个 Semaphore,把同时在途的请求数压在厂商的并发上限以内。请求失败我先分类:400、401、402 是我们或账号的问题,直接报人不重试;429、5xx、连不上、超时可以重试,指数退避加随机抖动,尊重 Retry-After,最多四次,SDK 自带的重试关掉,不然一次失败会变成九个请求;重试期间车位仍然占着。失败时把刚追加的 user 消息从历史里撤掉,用户重发不会出现两条连着的 user。成功后从 usage 里拆出命中、未命中、输出三种 token 乘各自单价记账,回答追加进历史存回服务端。历史越长每轮越贵,是平方级的,我们实测 20 轮 11780 个输入 token;靠两件事控制:原样放回历史让缓存命中(实测 66%,账单降一半多),以及超过一定轮数只发最近几轮,用户早期报的关键事实抽到 system 的背景里,不然会被窗口推出去。平均轮数和每会话成本两个指标上监控。

我读了一遍 2 分 40 秒。讲得顺,说明那张圈图在脑子里了。

</details>

**验收标准:** `week19_lab.py --fake` 的最后一行是 5 个请求(4 个 flaky + 1 个 401);真跑能看到「历史 N 条 发了 M 条」从第 4 轮起分叉,并在预算用完时打印「停」;`pytest tests/test_week19_lab.py tests/test_review_week19.py` 9 个全过;`except_order.py` 的 401 在两种顺序下结果不同;`vendor_pick.py` 的两行数字和你 Day 131 的数据一致;练习 5 三分钟内讲完。

今天的花费:`week19_lab.py` 真跑一次 0.0036 元;`sessions_burst.py` 一次 0.004 元;写文章时各多跑了两三遍,约 0.02 元。假服务器部分不花钱。

## 名词解释

本周新词都在各天的表里,这里只列今天第一次出现的:

| 名词 | 意思 |
| --- | --- |
| `nonlocal` | 在内层函数里声明「这个名字是外层函数的变量,我要给它赋值」。不写的话 `attempts += 1` 会被当成新的局部变量,报 `UnboundLocalError`。JS 闭包直接改外层 `let` 不用声明 |
| 预算熔断 | 发请求前检查累计花费,到了上限就不再发。`Session.ask` 开头那两行 |
| `SendOnce` | 「发一次、不重试、返回完整响应」的函数类型;和 Day 129 的 `Send`(返回文字和 token 数)是两层 |
| 会话对象(Session) | 把历史、发送方式、价格、预算、账本装在一起的对象,一个用户一段对话一个 |
| `on_retry` 回调 | 传给 `call_with_retry` 的函数,每次决定重试时被调用一次,用来记日志 |
| `pytest.approx` | 浮点数的近似比较,`2.00008` 这种小数不能直接 `==` |
| `model_validate` | pydantic 的「字典变对象」,测试里不经过网络造一个 `ChatCompletion` |
| 链式比较 | `a == b == c` 等于 `a == b and b == c` |
| `!r:16` | f-string 里先取 repr 再补齐到 16 格 |

## 常见误区

**把 `Session` 的预算检查放在发送之后。** 那样最后一轮已经花出去了才发现超了。放在发送前,代价是会略超一点(实测预算 0.003,停在 0.00356);要一点不超就得在发送前估这一轮的钱。

**在闭包里给外层变量赋值忘了 `nonlocal`。** `attempts += 1` 报 `UnboundLocalError: cannot access local variable 'attempts'`。改列表内容(`append`)不用声明,重新赋值才要。

**验证重试次数只看异常。** 最后抛了 `AuthenticationError` 不代表没重试过。要数服务器收到几个请求(`server.requests_seen`)或者闭包里的计数,小项目两处都数了。

**复习只看不写。** 练习 1 我漏掉 `min(policy.cap, ...)`,读的时候完全没发现,默写加测试才抓到。

**把一周的实测数字当定律。** 命中率 66%、0.0115 元、12.48 秒最慢,都是 10 月 23 日一个下午的结果。方法比数字重要:换厂商、换时段,再跑一次 Day 131 的脚本。

**项目里堆进所有东西。** 并发(Day 128)没放进 `Session`,因为 `Chat.ask` 是同步的,硬塞进去要把整条链改成 `async`。复习日的小项目只用已有的零件,改不动的留到该改的那天。

## 学习资料

### 文档与文章

- [openai-python 仓库 README](https://github.com/openai/openai-python):「Handling errors」和「Retries」两节是 Day 126、127 的底子,复习时再读一遍,对照自己的 `classify` 和 `call_with_retry`,看 SDK 哪些做了、哪些没做(抖动、按错误类型决定)。
- [DeepSeek · 限速](https://api-docs.deepseek.com/zh-cn/quick_start/rate_limit):并发上限和「请求保活」那两段,Day 126、128 都引用过。
- [DeepSeek · 上下文硬盘缓存](https://api-docs.deepseek.com/zh-cn/guides/kv_cache):本周三天(124、130、131)都靠它解释账单。
- [OpenAI · Conversation state](https://developers.openai.com/api/docs/guides/conversation-state):手动拼接历史那一段,和 Day 129 的 `Chat` 是一回事。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Le9BYkEm1&autoplay=0&high_quality=1" title="几分钟学会deepseek_R1官网api调用支持多轮对话并计算花销" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Ai意思君 · 几分钟学会 deepseek_R1 官网 API 调用,支持多轮对话并计算花销 · 8 分钟,2025 年 3 月。Day 129 推荐过。复习时对着看:他的循环里哪一行是「追加历史」、哪一行是「算钱」,对应小项目的哪一行。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1z3p76MEwD&autoplay=0&high_quality=1" title="System prompt你怎么组织？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>图灵 AI 大模型 · System prompt 你怎么组织? · 4 分钟,2026 年 10 月。Day 130 推荐过,复习时再看一遍,看完把 `build_system` 的五块默写出来。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/ix8n_giRF94" title="Fitting conversation history in OpenAI Chat Completion calls" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Pamela Fox · Fitting conversation history in OpenAI Chat Completion calls · 英文。Day 129 推荐过,当时说「讲的是后面才会学的裁剪」,现在 Day 131 学了窗口和按预算裁,回头看她的做法和 `WindowChat`、`BudgetChat` 有什么不同。我只核对了标题和能打开,没逐段看过。</figcaption>
</figure>

### 书籍

- 《AI Engineering》(Chip Huyen 著,O'Reilly,2025 年):这一周对应的是第 9 章「推理优化」里关于成本、缓存和延迟的部分,以及第 5 章提示工程里关于系统提示和防御提示攻击的小节。我没核对过中文版的章节编号,以你手上那本的目录为准。

### 开源项目与代码

- [openai/openai-python](https://github.com/openai/openai-python):打开 `src/openai/_base_client.py`,搜 `_should_retry` 和 `_calculate_retry_timeout`,这是 Day 127 读过的 SDK 重试源码。复习时再读一遍,对照 `retry.py`,看它为什么不重试 4xx(除了 408、409、429)。

## 自测

1. 一轮对话的路径上,分类、重试、并发闸门三者的先后和包含关系是什么?

<details><summary>答案</summary>

闸门在最外面,包住整个重试过程(退避等待时也占着车位);重试在中间,每次失败先问分类;分类在最里面,只回答「是什么错、该不该重试」。小项目里:`async with sem` 包住 `acall_with_retry`(练习 2),`call_with_retry` 里面调 `classify`(`Session.ask`)。

</details>

2. 为什么 `Session.ask` 里要写两个 `nonlocal`?

<details><summary>答案</summary>

`attempt` 里的 `attempts += 1` 和 `send` 里的 `usage = resp.usage` 都是给外层函数 `ask` 的变量重新赋值。Python 里内层函数给外层变量赋值必须先声明 `nonlocal`,否则会被当成新建局部变量,`attempts += 1` 报 `UnboundLocalError`。Day 131 的 `usages.append(...)` 不用声明,因为那是改列表内容。

</details>

3. 假服务器那一半为什么最后要打印 `server.requests_seen`?

<details><summary>答案</summary>

它是「到底重试了几次」的铁证:4 个 `flaky` 请求(第一句 3 次,第二句 1 次)加 1 个 `status-401`,说明 429 重试了、401 没重试。只看异常和返回值发现不了「401 被重试了 4 次」这种 bug,Day 127 的测试就是靠数请求抓到的。

</details>

4. 小项目真跑时,「历史 8 条 发了 7 条」是什么意思?

<details><summary>答案</summary>

`WindowChat(keep_turns=3)`:完整历史里有 4 轮共 8 条消息,但第 5 轮发出去的是 system + 最近 3 轮(6 条)+ 当前问题 = 7 条。Day 131 讲过:窗口只影响发出去的,`messages` 里一条不少,所以存盘的是完整对话。

</details>

5. 预算 0.003 元为什么停在了 0.00356?

<details><summary>答案</summary>

预算是在发送前检查的:第 5 轮发送前累计 0.00283 < 0.003,所以发了;发完累计 0.00356,第 6 轮发送前检查才超。要一点不超,得在发送前估算这一轮的费用(比如用上一轮的输入加这一轮的问题长度),再决定发不发。

</details>

6. 面试题:「你们的 Agent 调模型的那一层,是怎么处理错误、限速和成本的?」

<details><summary>答案</summary>

三层说。错误:按状态码和异常类分五类,只重试「太快了、厂商、网络」三类,401、400、402 直接报警;SDK 自带重试关掉,自己一层指数退避加抖动、尊重 Retry-After、有总次数和总时限;超时的请求可能已被处理,有副作用的调用不盲目重试。限速:用 Semaphore 把在途请求压在厂商并发上限以内,车位包住整个重试;每分钟类的上限用节拍器;并发开到刚好用满对方能力为止。成本:每次调用从 usage 拆三种 token 记账,按会话累计,到预算停;多轮对话靠前缀缓存(system 稳定在前、历史原样放回)和窗口裁剪控制平方级增长;监控平均轮数和每会话成本。再补一句:这些都有假服务器上的测试,429 重试几次、401 发几个请求、预算到了停不停,都是断言出来的,不是看日志猜的。

</details>

## 明天预告

[Day 133](/blog/agent-zero/day-133-sse-principle/) · 流式输出(一):SSE 原理和首 token 延迟。这一周的请求都是「发出去,等,整段回来」,小项目里每轮要等一秒多。用户盯着空白等一秒还行,等十秒就走了。明天看厂商怎么把回答一小块一小块地推过来:用 `curl -N` 看原始的事件流长什么样(`data:` 开头、空行分隔、最后一个 `[DONE]`),自己用 Python 写一个最小的 SSE 服务器理解它只是「一个一直不关的 HTTP 响应」,再量一量首 token 延迟:同一个问题,非流式 1.85 秒才见到字,流式 0.5 秒就开始出字。
