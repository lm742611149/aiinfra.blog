---
title: 'Day 4 · messages、system prompt 与流式输出：对话状态握在你手里'
description: 'API 没有记忆，多轮对话是你的程序每次把历史整个重发一遍，所以聊得越久越贵，而且是平方级地贵。今天弄清四种 role 的分工、system prompt 该写什么、怎么裁剪历史，再用 SSE 流式输出把首字延迟压下来，最后封装一个后面整门课都要用的 LLMClient。'
pubDate: 2026-10-12
regime: none
tags: ['messages', 'streaming', 'sse', 'llm-client', 'agent-60']
series: 'agent-60'
day: 4
lang: 'zh'
---

## 今天要解决的问题

昨天的 `ask.py` 是一问一答，问完就忘。今天要做一个能连续聊天的程序，然后你会亲眼看到一个让很多人意外的事实：**模型从来没记住过任何东西，记性全是你的程序给的**。

学完今天你应该能：

1. 说清 system、user、assistant、tool 四种 role 各自放什么，system prompt 里该写什么、不该写什么。
2. 解释为什么多轮对话的总成本随轮数平方增长，并能算出一个具体数字。
3. 写出至少两种裁剪对话历史的策略，知道各自的代价。
4. 用流式输出实现「打字机效果」，知道 SSE 的报文长什么样、首字延迟（TTFT）是什么。
5. 写好 `common/llm.py` 里的 `LLMClient` 和 `Conversation`，后面 56 天都会 import 它们。

预计用时：4 到 5 小时，`LLMClient` 那部分要慢慢写、仔细测。前置：Day 3 的 `ask.py` 跑通。

## 模型没有记忆，你的 messages 列表就是它的全部记忆

先做个实验。用昨天的 `ask.py` 连续问两句：

```bash
uv run w1/ask.py "我叫小林，在云簿做后端开发"
uv run w1/ask.py "我叫什么名字？在哪工作？"
```

第二次它会说不知道。两次调用之间没有任何联系，服务器也不会替你存什么（OpenAI 的 Responses API 和某些厂商的「会话」功能除外，但那也只是服务端替你存了 messages，原理一样）。

要让它记住，第二次请求必须带上第一轮：

```python
messages = [
    {"role": "system", "content": "你是一个简洁的助手。"},
    {"role": "user", "content": "我叫小林，在云簿做后端开发"},
    {"role": "assistant", "content": "你好小林！有什么可以帮你的？"},
    {"role": "user", "content": "我叫什么名字？在哪工作？"},
]
```

这次模型能答对，因为答案就在输入里。这件事对 Agent 工程师的意义非常大：**messages 列表就是 Agent 的工作记忆**。W2 你会看到，Agent 调用的每一个工具、拿到的每一个结果，也都是作为消息追加进这个列表的。管好这个列表，是 Agent 工程的一半工作量。Anthropic 后来专门给这件事起了个名字叫「上下文工程」，Day 20 会展开。

### 四种 role

| role | 谁写的 | 放什么 |
| --- | --- | --- |
| system | 你（开发者） | 身份、任务、规则、输出格式、背景知识。用户看不到 |
| user | 终端用户（或你代用户写） | 用户的问题和输入 |
| assistant | 模型 | 模型之前的回复。你回放历史时原样放回去 |
| tool | 你的程序 | 工具执行结果，Day 8 详细讲 |

有两个细节要知道。第一，assistant 消息是可以「伪造」的。你可以手写一条 assistant 消息塞进历史，模型会以为那是自己说过的话。这个技巧有正当用途（给示例、做预填），也是一类攻击手法的原理。第二，某些厂商有额外字段需要回传。比如 DeepSeek 的思考模式，带工具调用的对话里 assistant 消息的 `reasoning_content` 必须原样回传，否则报 400。所以回放历史时，**最稳妥的做法是把模型返回的那条 message 整个存下来原样放回**，而不是只挑 content 自己重新拼。下面的 `LLMClient` 就是这么做的。

### system prompt 写什么

system prompt 是你对模型的「岗位说明书」。一个客服场景的例子：

```text
你是云簿 CloudLedger 的在线客服助手。云簿是一款面向中小企业的在线记账和订阅管理软件。

你的任务：回答用户关于产品使用、计费和账户的问题。

规则：
- 只回答和云簿相关的问题，其他问题礼貌拒绝。
- 不确定的信息不要编造，回复「这个问题我需要转给人工同事确认」。
- 涉及退款、修改订阅等操作，告诉用户你会提交申请，不要承诺结果。
- 回答控制在 150 字以内，用中文。

今天的日期：2026-10-12。
```

几条经验：

- **写清楚身份和边界**，比写「你是一个乐于助人的助手」有用得多。
- **把模型不可能知道的上下文给它**：今天日期、用户的身份和套餐、公司名字。模型不知道今天几号，你不给它就会瞎猜。
- **规则写成具体行为**，「不要编造」不如「不确定时回复某句固定话术」好执行。
- 不要往 system prompt 里放敏感信息（内部 API 地址、数据库密码、其他客户的数据）。用户有一万种办法让模型把 system prompt 吐出来，Day 39 讲 prompt injection 时会演示。

明天专门讲提示词工程，今天先有这个印象。

## 聊得越久越贵，而且是平方级

每一轮都要把之前所有的消息重发一遍，所以第 n 轮的输入 token 数大约是：

```
第 n 轮输入 ≈ S + n × T
```

S 是 system prompt 的 token 数，T 是平均每轮（一问一答）新增的 token 数。把 N 轮加起来：

```
总输入 ≈ N × S + T × (1 + 2 + … + N) = N × S + T × N(N+1)/2
```

第二项是 N 的平方级。代入一组数字：S = 500，T = 300，聊 40 轮：

```
总输入 ≈ 40 × 500 + 300 × 40 × 41 / 2 = 20,000 + 246,000 = 266,000 token
```

如果每轮都不重发历史，40 轮的输入只有 40 × (500 + 150) ≈ 26,000。差了十倍。按 deepseek-flash 高峰未命中价 2 元 / 百万 token，26.6 万 token 约 0.53 元。一次聊天五毛钱看着不多，一天十万次对话就是五万块。好在 DeepSeek 的前缀缓存在这里很有效：每轮的历史都是上一轮请求的前缀，大部分会命中缓存，实际费用低得多。这也是为什么回放历史要**原样**放回去，你改动了历史里的任何一个字，那之后的缓存就全部失效了。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="每一轮的输入 token 随轮数线性增长，累计总量平方增长">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="11">
<line x1="50" y1="210" x2="610" y2="210" stroke="var(--rule)"/>
<line x1="50" y1="20" x2="50" y2="210" stroke="var(--rule)"/>
<text x="330" y="238" text-anchor="middle" fill="var(--ink-faint)">对话轮数 →</text>
<text x="56" y="32" fill="var(--ink-faint)">每轮输入 token</text>
<g fill="var(--mem-wash)" stroke="var(--mem)">
<rect x="70" y="196" width="22" height="14"/>
<rect x="100" y="187" width="22" height="23"/>
<rect x="130" y="178" width="22" height="32"/>
<rect x="160" y="169" width="22" height="41"/>
<rect x="190" y="160" width="22" height="50"/>
<rect x="220" y="151" width="22" height="59"/>
<rect x="250" y="142" width="22" height="68"/>
<rect x="280" y="133" width="22" height="77"/>
<rect x="310" y="124" width="22" height="86"/>
<rect x="340" y="115" width="22" height="95"/>
<rect x="370" y="106" width="22" height="104"/>
<rect x="400" y="97" width="22" height="113"/>
</g>
<g fill="var(--compute-wash)" stroke="var(--compute)">
<rect x="70" y="196" width="22" height="7"/>
<rect x="100" y="196" width="22" height="7"/>
<rect x="130" y="196" width="22" height="7"/>
</g>
<text x="440" y="110" fill="var(--mem)">重发全部历史</text>
<text x="440" y="126" fill="var(--ink-soft)">每轮线性涨，总量 ∝ N²</text>
<text x="440" y="186" fill="var(--compute)">只发最近几轮</text>
<text x="440" y="202" fill="var(--ink-soft)">每轮基本持平，总量 ∝ N</text>
<line x1="70" y1="200" x2="422" y2="200" stroke="var(--compute)" stroke-dasharray="4 3"/>
</g>
</svg>
<figcaption>蓝色柱是每一轮实际发出去的输入 token：历史越积越多，柱子越来越高，所有柱子的面积加起来就是平方级的总量。琥珀色虚线是只保留最近几轮时的水平，代价是模型会忘掉更早的内容。</figcaption>
</figure>

### 三种裁剪历史的办法

不可能让历史无限长下去，迟早会撞到上下文窗口，钱也受不了。常见做法有三种，复杂度依次上升：

**滑动窗口**：只保留 system prompt + 最近 K 轮。实现最简单，缺点是早期的信息（比如用户一开始报的订单号）会被丢掉。

**按 token 预算裁剪**：从最新的消息往前数，累计 token 不超过预算就保留，超了就丢。比按轮数更精确，因为有的轮次一句话，有的轮次贴了一大段日志。

**摘要压缩**：历史超过阈值时，调用一次模型，把较早的对话压缩成一段摘要，放在 system prompt 后面，再接上最近几轮原文。效果最好，代价是多一次调用，而且摘要可能漏掉细节。ChatGPT、Claude 这类产品在长对话里都在做类似的事。

还有一条裁剪时容易犯的错：**不能把一对消息拆开**。比如 W2 里，assistant 发起了工具调用，紧跟着一条 tool 结果。如果你裁掉了前者留下了后者，API 会直接报 400，因为它看到一条没有来源的工具结果。所以裁剪要以「轮」为单位，而不是以「条」为单位。今天的 `Conversation` 先做按轮的滑动窗口，Day 20 再做摘要压缩。

## 流式输出：别让用户盯着空白等十秒

一次调用生成 500 个 token，按每秒 50 个算要 10 秒。非流式调用就是 10 秒什么都看不到，然后整段一起出来。流式调用则是第一个 token 生成出来就推给你，用户在半秒后就开始阅读。总时间没变，体感完全不同。

衡量这件事有两个指标：

- **TTFT（Time To First Token，首字延迟）**：从发请求到收到第一个 token 的时间。对话类产品最看重这个。
- **生成速度**：每秒输出多少 token（也有人看它的倒数，每个 token 间隔多少毫秒）。

思考模式会显著拉高 TTFT：模型要先想完才开始输出正文。如果你在流式里把思考过程也显示出来（像很多聊天产品那样折叠显示），用户就不会觉得卡。

### SSE 报文长什么样

各家的流式接口几乎都基于 SSE（Server-Sent Events）：一个保持打开的 HTTP 响应，`Content-Type: text/event-stream`，服务器每有新内容就写一行 `data: ...`，用空行分隔。用 curl 加 `"stream": true` 看一下原始报文：

```bash
curl -N https://api.deepseek.com/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $LLM_API_KEY" \
  -d '{"model":"deepseek-flash","stream":true,"thinking":{"type":"disabled"},
       "messages":[{"role":"user","content":"说三个水果"}]}'
```

输出大致是一串这样的行（我省略了一些字段）：

```text
data: {"id":"...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}

data: {"id":"...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"苹果"},"finish_reason":null}]}

data: {"id":"...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"、香蕉"},"finish_reason":null}]}

data: {"id":"...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"、橙子"},"finish_reason":"stop"}],"usage":{"prompt_tokens":9,"completion_tokens":6,"total_tokens":15}}

data: [DONE]
```

几个要点：每块里不是完整的 `message`，而是增量 `delta`，你要自己把 content 一段段拼起来；`finish_reason` 只有最后一块非空；`data: [DONE]` 表示结束。DeepSeek 文档说明，用量统计附在 `[DONE]` 之前的最后一块上；OpenAI 则需要传 `stream_options={"include_usage": True}`，并且是在一个 `choices` 为空的单独块里返回。为了兼容两种情况，代码里要同时处理「这块有 usage」和「这块 choices 是空的」。开了思考模式时，DeepSeek 的 delta 里还会有 `reasoning_content`，它会先于 content 出现。

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="非流式和流式调用的时间线对比">
<rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="30" fill="var(--ink)">非流式</text>
<rect x="100" y="16" width="400" height="22" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="300" y="32" text-anchor="middle" fill="var(--ink-faint)">用户看到空白……</text>
<rect x="500" y="16" width="110" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="555" y="32" text-anchor="middle" fill="var(--ink)">整段出现</text>
<text x="20" y="90" fill="var(--ink)">流式</text>
<rect x="100" y="76" width="40" height="22" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
<g fill="var(--mem-wash)" stroke="var(--mem)">
<rect x="140" y="76" width="30" height="22"/><rect x="172" y="76" width="30" height="22"/><rect x="204" y="76" width="30" height="22"/>
<rect x="236" y="76" width="30" height="22"/><rect x="268" y="76" width="30" height="22"/><rect x="300" y="76" width="30" height="22"/>
<rect x="332" y="76" width="30" height="22"/><rect x="364" y="76" width="30" height="22"/><rect x="396" y="76" width="30" height="22"/>
<rect x="428" y="76" width="30" height="22"/><rect x="460" y="76" width="30" height="22"/><rect x="492" y="76" width="30" height="22"/>
</g>
<line x1="140" y1="110" x2="140" y2="130" stroke="var(--compute)"/>
<text x="146" y="128" fill="var(--compute)">TTFT：第一个字出现</text>
<text x="20" y="168" fill="var(--ink-soft)">两条线的总时长几乎一样，但流式让用户在第一个块到达时就开始读。</text>
<text x="20" y="190" fill="var(--ink-faint)">开思考模式时，TTFT 会变长，因为要先想完再写正文。</text>
</g>
</svg>
<figcaption>非流式和流式的时间线。流式不会让模型算得更快，它改善的是用户等第一个字的时间。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV12uHk6XE2a&autoplay=0&high_quality=1" title="AI 串流为什么用 SSE 而不是 WebSocket" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>CodingStartup起码课 · AI 串流为什么用 SSE 而不是 WebSocket｜Server-Sent Events 教学｜真实封包拆解 · 9 分钟，抓包拆解 SSE 报文，正好对上面这一节，今天必看。</figcaption>
</figure>

## 封装 LLMClient：一次写好，全课复用

到目前为止，每个脚本都在重复同样的几件事：读环境变量、建客户端、拼 extra_body、算成本、处理思考内容。今天把它们收进一个类。这个类会跟着你走完整门课，W6 部署时还会加上异步版本。设计目标：

- 上层代码只调 `client.chat(messages)` 或 `client.stream(messages)`，不关心是哪家厂商。
- 返回的结果里直接带上「要追加到历史里的那条 assistant 消息」，原样保留厂商额外字段。
- 自动累计调用次数、token 和花费，随时能打印一张账单。
- 流式和非流式两种用法，流式结束后同样能拿到完整结果和用量。

**这段 180 行不用全手敲。** 一半是工程细节（厂商字段兼容、成本计算、流式统计），整份粘进 `common/llm.py`，然后分三层读：

1. **先看怎么用。** 跳到后面的 `w1/chat_stream.py`，看 `LLMClient()`、`Conversation(...)`、`client.stream(conv.messages())`、`conv.add_assistant(r.message)` 这四步（非流式就把 `stream` 换成 `chat`，直接拿到 `r`）。核心就一句：API 没有记忆，`Conversation` 负责存历史，每轮整份重发。
2. **再看每个类管什么。** `Price` / `ChatResult` / `Ledger` 都是 `@dataclass`，相当于 TS 的 interface 加自动生成的构造函数，只装数据；`LLMClient` 是对 `openai` SDK 的一层包装（调用前拼参数 `_kwargs`，调用后算钱 `_cost`、记账）；`Conversation` 就是一个数组，system 钉在最前，只留最近 N 轮。
3. **只手敲 `chat()` 一个方法。** 计时 → 调 API → 取 `choices[0].message` → 读 `usage` 算成本 → 装进 `ChatResult` → 记账。这是后面每一课都在用的骨架。

`_cache_hit`（兼容两家的缓存字段名）、`stream()`（生成器，`yield` 相当于 TS 的 `function*`，第 4 步练流式时再回来看）、`extra_body`（Day 5 才用）第一遍可以跳过。自测两个问题：为什么存回历史的是整条 `r.message` 而不只是 `content`？为什么聊得越久越贵？答得上来就够了。

粘贴时注意：光标先放在行首第 0 列再粘，否则 Zed 会把整段跟着光标缩进，报 `IndentationError: unexpected indent`，而且有语法错误的文件保存时也不会自动格式化。

```python
# agent-60-lab/common/llm.py
"""全课复用的大模型客户端。依赖：uv add openai python-dotenv"""
from __future__ import annotations

import json
import os
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI


@dataclass
class Price:
    """元 / 百万 token：缓存命中输入、未命中输入、输出。"""

    hit: float = 0.0
    miss: float = 0.0
    out: float = 0.0

    @classmethod
    def parse(cls, raw: str | None) -> Price:
        if not raw:
            return cls()
        hit, miss, out = (float(x) for x in raw.split(","))
        return cls(hit, miss, out)


@dataclass
class ChatResult:
    content: str
    reasoning: str | None
    finish_reason: str | None
    message: dict[str, Any]          # 原样追加进历史的 assistant 消息
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cache_hit_tokens: int = 0
    cost: float = 0.0                # 元
    latency: float = 0.0             # 秒，非流式为总耗时
    ttft: float | None = None        # 秒，只有流式有


@dataclass
class Ledger:
    calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost: float = 0.0

    def add(self, r: ChatResult) -> None:
        self.calls += 1
        self.prompt_tokens += r.prompt_tokens
        self.completion_tokens += r.completion_tokens
        self.cost += r.cost

    def __str__(self) -> str:
        return (f"{self.calls} 次调用 | 输入 {self.prompt_tokens} / 输出 {self.completion_tokens} tokens"
                f" | 约 ¥{self.cost:.4f}")


class LLMClient:
    def __init__(self, env_file: str | None = None, **overrides: Any) -> None:
        if env_file:
            load_dotenv(env_file, override=True)
        else:
            load_dotenv()
        self.model: str = overrides.get("model") or os.environ["LLM_MODEL"]
        self.price = Price.parse(overrides.get("price") or os.environ.get("LLM_PRICE"))
        self.extra_body: dict[str, Any] = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
        self.client = OpenAI(
            base_url=overrides.get("base_url") or os.environ["LLM_BASE_URL"],
            api_key=overrides.get("api_key") or os.environ["LLM_API_KEY"],
            max_retries=overrides.get("max_retries", 3),
            timeout=overrides.get("timeout", 120.0),
        )
        self.ledger = Ledger()

    # ---------- 内部工具 ----------
    def _kwargs(self, messages: list[dict[str, Any]], **kw: Any) -> dict[str, Any]:
        extra = {**self.extra_body, **kw.pop("extra_body", {})}
        args: dict[str, Any] = {"model": kw.pop("model", self.model), "messages": messages, **kw}
        if extra:
            args["extra_body"] = extra
        return args

    def _cost(self, prompt: int, completion: int, hit: int) -> float:
        miss = prompt - hit
        p = self.price
        return (hit * p.hit + miss * p.miss + completion * p.out) / 1_000_000

    @staticmethod
    def _cache_hit(usage: Any) -> int:
        # DeepSeek: prompt_cache_hit_tokens；OpenAI 等：prompt_tokens_details.cached_tokens
        hit = getattr(usage, "prompt_cache_hit_tokens", None)
        if hit is None:
            details = getattr(usage, "prompt_tokens_details", None)
            hit = getattr(details, "cached_tokens", None) if details else None
        return hit or 0

    # ---------- 非流式 ----------
    def chat(self, messages: list[dict[str, Any]], **kw: Any) -> ChatResult:
        start = time.perf_counter()
        resp = self.client.chat.completions.create(**self._kwargs(messages, **kw))
        latency = time.perf_counter() - start
        choice = resp.choices[0]
        msg = choice.message.model_dump(exclude_none=True)   # 保留 reasoning_content、tool_calls 等
        u = resp.usage
        hit = self._cache_hit(u)
        result = ChatResult(
            content=choice.message.content or "",
            reasoning=msg.get("reasoning_content"),
            finish_reason=choice.finish_reason,
            message=msg,
            prompt_tokens=u.prompt_tokens if u else 0,
            completion_tokens=u.completion_tokens if u else 0,
            cache_hit_tokens=hit,
            cost=self._cost(u.prompt_tokens, u.completion_tokens, hit) if u else 0.0,
            latency=latency,
        )
        self.ledger.add(result)
        return result

    # ---------- 流式 ----------
    def stream(self, messages: list[dict[str, Any]], **kw: Any) -> Iterator[str]:
        """逐段 yield 正文文本；结束后 self.last 里是完整的 ChatResult。"""
        args = self._kwargs(messages, stream=True, **kw)
        args.setdefault("stream_options", {"include_usage": True})
        start = time.perf_counter()
        ttft: float | None = None
        content: list[str] = []
        reasoning: list[str] = []
        finish_reason: str | None = None
        usage = None
        for chunk in self.client.chat.completions.create(**args):
            if chunk.usage:                      # OpenAI 单独一块；DeepSeek 附在最后一块
                usage = chunk.usage
            if not chunk.choices:
                continue
            choice = chunk.choices[0]
            delta = choice.delta
            r = getattr(delta, "reasoning_content", None)
            if r:
                reasoning.append(r)
            if delta.content:
                if ttft is None:
                    ttft = time.perf_counter() - start
                content.append(delta.content)
                yield delta.content
            if choice.finish_reason:
                finish_reason = choice.finish_reason
        text = "".join(content)
        msg: dict[str, Any] = {"role": "assistant", "content": text}
        if reasoning:
            msg["reasoning_content"] = "".join(reasoning)
        prompt = usage.prompt_tokens if usage else 0
        completion = usage.completion_tokens if usage else 0
        hit = self._cache_hit(usage) if usage else 0
        self.last = ChatResult(
            content=text,
            reasoning=msg.get("reasoning_content"),
            finish_reason=finish_reason,
            message=msg,
            prompt_tokens=prompt,
            completion_tokens=completion,
            cache_hit_tokens=hit,
            cost=self._cost(prompt, completion, hit),
            latency=time.perf_counter() - start,
            ttft=ttft,
        )
        self.ledger.add(self.last)


class Conversation:
    """一个对话的 messages 管理：system 永远保留，历史按「轮」做滑动窗口。"""

    def __init__(self, system: str, max_turns: int = 20) -> None:
        self.system = {"role": "system", "content": system}
        self.turns: list[list[dict[str, Any]]] = []   # 每一轮是一组消息：user + assistant（以后还有 tool）
        self.max_turns = max_turns

    def add_user(self, text: str) -> None:
        self.turns.append([{"role": "user", "content": text}])

    def add_assistant(self, message: dict[str, Any]) -> None:
        self.turns[-1].append(message)

    def messages(self) -> list[dict[str, Any]]:
        kept = self.turns[-self.max_turns:]
        return [self.system] + [m for turn in kept for m in turn]
```

这段代码里有几处值得停下来看：

`choice.message.model_dump(exclude_none=True)`：OpenAI SDK 的响应对象是 pydantic 模型，会保留厂商多返回的字段。dump 成 dict 之后，DeepSeek 的 `reasoning_content` 就自然在里面了，原样放回历史，Day 8 加工具调用时不会踩那个 400 的坑。

`stream()` 是一个生成器：调用方用 `for piece in client.stream(...)` 一段段拿文本，循环结束后再从 `client.last` 读完整结果。这种「边产出边累积、结束后给汇总」的模式，在 W6 做 SSE 接口时还会用到。

`Conversation` 按「轮」存历史而不是按「条」存，裁剪时整轮丢弃，就不会出现把工具调用和工具结果拆散的问题。

你可能会问：LiteLLM 这类库已经做好了多厂商适配，为什么还要自己写？两个理由。一是学习，自己写一遍才知道适配层要处理哪些差异，面试被问「多模型怎么接」时你能讲出细节。二是可控，这一百来行代码你完全看得懂，出问题时不用去翻别人几万行的源码。等你清楚自己需要什么了，生产项目里换成成熟的库完全没问题。

流式时我们只把思考内容收集起来、不 yield 出去。如果你想在界面上显示思考过程，可以改成 yield 一个带类型标记的元组，比如 `("reasoning", text)` 和 `("content", text)`。

## 动手练习

**第 1 步：把上面的代码存成 `common/llm.py`，加一个空的 `common/__init__.py`。**

```bash
mkdir -p common && touch common/__init__.py
```

确认 `.env` 里有 `LLM_EXTRA_BODY` 和 `LLM_PRICE` 两行（Day 3 加过）。

**第 2 步：写一个多轮流式聊天。**

```python
# agent-60-lab/w1/chat_stream.py
from common.llm import Conversation, LLMClient

SYSTEM = "你是云簿 CloudLedger 的在线客服助手。回答简洁，中文，150 字以内。今天是 2026-10-12。"


def main() -> None:
    client = LLMClient()
    conv = Conversation(SYSTEM, max_turns=6)
    print("输入问题，空行退出。")
    while True:
        try:
            text = input("\n你：").strip()
        except EOFError:
            break
        if not text:
            break
        conv.add_user(text)
        print("助手：", end="", flush=True)
        for piece in client.stream(conv.messages(), temperature=0.3, max_tokens=500):
            print(piece, end="", flush=True)
        r = client.last
        conv.add_assistant(r.message)
        ttft = f"{r.ttft:.2f}s" if r.ttft is not None else "-"
        print(f"\n  [TTFT {ttft} | 总 {r.latency:.2f}s | 输入 {r.prompt_tokens}"
              f"（缓存 {r.cache_hit_tokens}）| 输出 {r.completion_tokens} | ¥{r.cost:.5f}]")
    print("\n本次会话：", client.ledger)


if __name__ == "__main__":
    main()
```

```bash
uv run python -m w1.chat_stream
```

用 `python -m w1.chat_stream` 而不是 `python w1/chat_stream.py`，是为了让 Python 从仓库根目录找到 `common` 包。

**第 3 步：观察三件事。**

聊 8 到 10 轮，每轮看底下那行统计。第一，输入 token 是不是在逐轮上涨，到第 7 轮之后因为 `max_turns=6` 不再明显上涨。第二，缓存命中数是不是随着轮数增加，第二轮之后大部分输入都命中了。第三，在第 1 轮告诉它「我的订单号是 INV-2026-004417」，第 8 轮问它「我的订单号是多少」，它会忘掉，因为第 1 轮已经被滑出窗口了。

**第 4 步：比较 TTFT。** 把 `.env` 里的 `LLM_EXTRA_BODY` 改成 `{"thinking": {"type": "enabled"}}` 再聊一轮同样的问题，看 TTFT 和输出 token 数的变化。思考模式下 TTFT 会明显变长，输出 token 也多了很多（思考内容计费）。记下两组数字，改回来。

**第 5 步：给 `Conversation` 写测试。** 它是纯逻辑，不需要网络：

```python
# agent-60-lab/tests/test_conversation.py
from common.llm import Conversation, Price


def test_window_keeps_system_and_last_turns():
    conv = Conversation("SYS", max_turns=2)
    for i in range(3):
        conv.add_user(f"q{i}")
        conv.add_assistant({"role": "assistant", "content": f"a{i}"})
    msgs = conv.messages()
    assert msgs[0] == {"role": "system", "content": "SYS"}
    assert [m["content"] for m in msgs[1:]] == ["q1", "a1", "q2", "a2"]


def test_price_parse():
    assert Price.parse("0.04,2,8") == Price(0.04, 2.0, 8.0)
    assert Price.parse(None) == Price()
```

```bash
uv run pytest -q
```

如果报 `ModuleNotFoundError: No module named 'common'`，说明 Day 2 练习里那段 pytest 配置还没加。pytest 默认不会把仓库根目录放进模块搜索路径，在 `pyproject.toml` 末尾加上这两行再跑：

```toml
[tool.pytest.ini_options]
pythonpath = ["."]
```

**验收标准：** 能连续流式聊天，每轮显示 TTFT、token、缓存命中和花费；能复现「第 1 轮信息被滑出窗口后模型忘记」的现象；记录了思考开关前后的 TTFT 对比；`Conversation` 的测试通过。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| messages | 一次请求里的全部对话消息，是模型唯一能看到的上下文 |
| system prompt | role 为 system 的消息，开发者给模型的身份、规则、背景 |
| 无状态（stateless） | 服务端不保存会话，每次请求必须自带全部上下文 |
| 滑动窗口 | 只保留最近 K 轮历史的裁剪方式 |
| 摘要压缩 | 把较早的历史用模型总结成一段摘要来节省 token |
| 流式输出（streaming） | 边生成边返回，客户端逐块接收 |
| SSE（Server-Sent Events） | 基于 HTTP 的服务端单向推送协议，大模型流式接口的标准做法 |
| delta | 流式响应中每块的增量内容 |
| TTFT | Time To First Token，从发请求到收到第一个 token 的延迟 |
| 生成器（generator） | Python 中用 yield 逐个产出值的函数，适合包装流式数据 |

## 常见误区

**以为模型「记得」上一次对话。** 记忆完全来自你重发的 messages。换个进程、清了列表，它就什么都不知道。

**只存 content，回放时重新拼 assistant 消息。** 会丢掉厂商需要的额外字段（如 DeepSeek 的 reasoning_content、工具调用的 tool_calls），带工具时直接 400。原样存、原样放回。

**修改历史消息里的内容。** 比如每轮都给历史里的时间戳更新一下。这会让前缀缓存全部失效，成本和延迟一起上涨。

**按「条」裁剪历史。** 会把工具调用和工具结果拆开，API 报错。以「轮」为单位裁剪。

**流式时忘了处理空 choices 的块。** OpenAI 的 usage 块 choices 为空，直接取 `chunk.choices[0]` 会 IndexError。

**以为流式能让模型更快。** 总时长基本不变，改善的是首字延迟和体感。

**流式输出直接 print 不加 flush。** 终端有输出缓冲，不加 `flush=True` 时字会攒一批才出来，看起来就像没有流式。

## 学习资料

### 文档与文章

- [DeepSeek：多轮对话](https://api-docs.deepseek.com/zh-cn/guides/multi_round_chat)：官方示例，演示如何拼接历史。5 分钟。
- [DeepSeek：思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode)：重读「多轮对话是否回传 reasoning_content」那部分。
- [Claude：Streaming Messages](https://platform.claude.com/docs/en/build-with-claude/streaming)：Anthropic 的流式事件比 OpenAI 格式更细（message_start、content_block_delta 等），对比着看能更理解流式的本质。20 分钟。
- [OpenAI：Streaming API responses](https://platform.openai.com/docs/guides/streaming-responses)：OpenAI 官方的流式说明。
- [MDN：使用服务器发送事件](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)：SSE 协议本身的权威说明，W6 写服务端时要用。15 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1cuMJztEcL&autoplay=0&high_quality=1" title="AI根本无记忆！一条视频搞懂 大模型上下文窗口！" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>清华姜学长 · AI根本无记忆！一条视频搞懂 大模型上下文窗口！ · 10 分钟，用产品使用者的视角讲「无记忆」和上下文窗口，和今天第一节互相印证。</figcaption>
</figure>

- 李宏毅 2025 秋第 2 讲「上下文工程」（BV1DWJkzvEKw，Day 0 推荐过）：今天可以接着看 30 到 60 分钟的部分，讲上下文里该放什么、怎么管理。

### 其他经典视频

- DeepLearning.AI《ChatGPT Prompt Engineering for Developers》最后一课「Chatbot」：演示了用 messages 列表做一个点餐机器人，正是今天的内容。B 站 Datawhale 搬运版 BV1Bo4y1A7FU（看第 9 集左右），或者 [官方课程页](https://learn.deeplearning.ai/courses/chatgpt-prompt-eng)。15 分钟。

### 书籍

- Chip Huyen《AI Engineering》（O'Reilly，2025）第 6 章 RAG and Agents 里关于「Memory」的小节：讲短期记忆（上下文）和长期记忆的区分，今天读这一小节建立概念，Day 20 再完整读。
- 《流畅的 Python（第 2 版）》第 17 章「迭代器、生成器和经典协程」：想吃透 `yield` 的人读，今天的 `stream()` 就是一个生成器。

### 开源项目与代码

- [openai/openai-python](https://github.com/openai/openai-python)：README 的 Streaming responses 一节，以及 `src/openai/_streaming.py`，看 SDK 怎么解析 SSE 的。有兴趣再看。
- [Datawhale《hello-agents》](https://github.com/datawhalechina/hello-agents)：前几章也有对话和记忆的中文讲解，可以对照。

## 自测

1. 用户在第 1 轮说了自己的手机号，第 15 轮模型答不出来了。可能的原因有哪些？

<details><summary>答案</summary>

最可能是历史裁剪：滑动窗口或 token 预算把第 1 轮丢掉了。也可能是上下文很长，模型对早期内容注意力下降（lost in the middle）。解决办法：把这类关键信息抽取出来放进 system prompt 或一个「用户档案」区域，不随历史裁剪；或者用摘要压缩时显式要求保留关键实体。

</details>

2. S = 800，每轮新增 T = 400，不裁剪聊 30 轮，总输入 token 大约多少？如果每轮都是全新会话（不带历史），是多少？

<details><summary>答案</summary>

不裁剪：30 × 800 + 400 × 30 × 31 / 2 = 24,000 + 186,000 = 210,000。不带历史：每轮约 800 + 200（只有本轮用户输入，假设一半）≈ 1,000，30 轮约 30,000。具体口径可以略有不同，关键是前者是平方增长。

</details>

3. 为什么说「修改历史消息」会让成本上升？

<details><summary>答案</summary>

前缀缓存只对完全相同的开头生效。你改了历史里第 k 条消息，从第 k 条开始的所有内容都和上次请求不同，这之后的部分全部无法命中缓存，要按未命中价计费，延迟也会增加。

</details>

4. 流式响应中，怎么知道生成结束了？怎么拿到 token 用量？

<details><summary>答案</summary>

最后一个内容块的 `finish_reason` 非空，随后是 `data: [DONE]`。用量：DeepSeek 附在 [DONE] 之前的最后一块里；OpenAI 需要请求时传 `stream_options={"include_usage": true}`，用量在一个 choices 为空的单独块里。代码要兼容这两种情况。

</details>

5. 面试题：「你们的客服机器人对话很长时会变慢、变贵，还会忘事，你怎么优化？」

<details><summary>答案</summary>

分几层答：一，历史管理，按 token 预算的滑动窗口加摘要压缩，关键实体（订单号、用户身份）抽出来放进固定的档案区不参与裁剪；二，成本，把 system prompt、工具定义等不变内容放在前面并保持不变，利用前缀缓存，历史原样回放不做修改；三，体验，流式输出降低首字延迟，简单问题关掉思考模式；四，必要时用长期记忆（向量检索历史对话）替代把所有历史塞进上下文。最后说要用数据验证：优化前后对比平均输入 token、成本、TTFT 和回答准确率。

</details>

6. `Conversation` 为什么按「轮」而不是按「条」保存历史？

<details><summary>答案</summary>

一轮里可能有 user、assistant（含 tool_calls）、多条 tool 结果，它们之间有依赖关系。按条裁剪可能留下一条 tool 结果却丢了发起调用的 assistant 消息，API 会报 400。按轮裁剪保证每一轮要么完整保留，要么完整丢弃。

</details>

## 明天预告

Day 5 · 提示词工程：清晰指令、示例、思维链、结构化标签。今天的 system prompt 只是随手写的。明天系统地讲怎么写一个好提示词：为什么「说清楚」比「说漂亮」重要、few-shot 示例怎么选、什么时候让模型先想再答、为什么用 XML 标签把材料分隔开，以及最重要的一条，什么时候提示词已经救不了你了。
