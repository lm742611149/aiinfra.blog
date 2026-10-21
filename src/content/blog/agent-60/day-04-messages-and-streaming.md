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

如果每轮都不重发历史，40 轮的输入只有 40 × (500 + 150) ≈ 26,000。差了十倍。按 deepseek-flash 高峰未命中价 2 元 / 百万 token，26.6 万 token 约 0.53 元。一次聊天五毛钱看着不多，一天十万次对话就是五万块。好在 DeepSeek 的前缀缓存在这里很有效：每轮的历史都是上一轮请求的前缀，聊到一定长度之后，前面那一大段都会命中缓存，命中部分按 0.04 元 / 百万计，实际费用低得多。注意开头几轮不会命中：缓存按块存，前缀不够一块就是 0。我实测一个短 system 的客服对话，前 3 轮命中都是 0，第 4 轮输入 274 token 命中 128，第 7 轮 415 命中 256，命中数都是 128 的整数倍，涨一截停一截。这也是为什么回放历史要**原样**放回去，你改动了历史里的任何一个字，那之后的缓存就全部失效了。

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
from dataclasses import dataclass
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

<div class="line-notes">

- `"""全课复用的大模型客户端` 下面的「实测」是 2026-10 用课程统一的 `.env` 跑的:`deepseek-flash`、思考关闭、`LLM_PRICE=0.04,2,8`。例子用的是本课开头那段对话:system「你是一个简洁的助手。」+ user「我叫小林，在云簿做后端开发」。
- `from __future__ import annotations` 让类型标注延迟求值。有了它,`Price` 类里面的 `parse` 方法才能写 `-> Price`(这时 Price 还没定义完)。
- `from collections.abc import Iterator` `stream()` 的返回类型 `Iterator[str]` 要用,意思是「能一段段吐出字符串的东西」。
- `from dataclasses import dataclass` `@dataclass` 根据字段声明自动生成 `__init__`、`__repr__`、`__eq__`。
- `@dataclass` 加在类上面。下面 `class Price` 只写了三个字段,就能直接 `Price(0.04, 2, 8)` 构造,打印出来是 `Price(hit=0.04, miss=2.0, out=8.0)`。
- `hit: float = 0.0` 字段带默认值,所以 `Price()` 不传参数也行,三个都是 0。
- `@classmethod` 类方法的第一个参数是类本身(`cls`),不是实例。用法是 `Price.parse("...")`,用来做「另一种构造方式」。
- `if not raw:` `None` 和空字符串 `""` 都算假值。实测 `Price.parse(None)` 和 `Price.parse("")` 都返回 `Price(hit=0.0, miss=0.0, out=0.0)`。
- `hit, miss, out = (float(x) for x in raw.split(","))` 和 Day 3 的 `parse_price` 一样,`"0.04,2,8"` → `0.04, 2.0, 8.0`。
- `return cls(hit, miss, out)` `cls(...)` 就是 `Price(...)`。实测 `Price.parse("0.04,2,8")` 得到 `Price(hit=0.04, miss=2.0, out=8.0)`。
- `class ChatResult:` 一次调用的全部结果装在这里。前四个字段没有默认值,必须传;后面的有默认值。dataclass 规定**有默认值的字段必须排在没有默认值的后面**,顺序反了会报错。
- `message: dict[str, Any]` 原样存回历史的 assistant 消息。实测非流式那次是 `{'content': '你好，小林！很高兴认识你。……', 'role': 'assistant'}`。
- `ttft: float | None = None` 首字延迟(time to first token),只有流式调用才有意义,非流式就是 None。
- `class Ledger:` 账本,累计这个客户端发出的所有调用。
- `def add(self, r: ChatResult) -> None:` 每次调用结束后加一笔。实测:先非流式一次(输入 20 / 输出 29),再流式一次(输入 60 / 输出 11),账本变成 `calls=2`、`prompt_tokens=80`、`completion_tokens=40`。
- `def __str__(self) -> str:` `print(ledger)` 或 f-string 里显示时调用它。实测打印 `2 次调用 | 输入 80 / 输出 40 tokens | 约 ¥0.0005`。两个 f-string 挨着写会自动拼成一个。
- `def __init__(self, env_file: str | None = None, **overrides: Any) -> None:` `**overrides` 收集所有额外的关键字参数,放进一个 dict。`LLMClient(model="deepseek-v4-pro")` 里的 `overrides` 就是 `{"model": "deepseek-v4-pro"}`。
- `if env_file:` 传了文件名就读那个文件并覆盖已有变量;没传就 `load_dotenv()`,默认从当前目录往上找 `.env`。
- `self.model: str = overrides.get("model") or os.environ["LLM_MODEL"]` `a or b`:a 是假值(None 或空串)时取 b。没传 model 就读环境变量,实测得到 `deepseek-flash`。
- `self.price = Price.parse(` 实测 `Price(hit=0.04, miss=2.0, out=8.0)`。
- `self.extra_body: dict[str, Any] = json.loads(` 实测 `{'thinking': {'type': 'disabled'}}`。
- `self.client = OpenAI(` 和 Day 3 一样,只是每个参数都能被 overrides 覆盖。
- `max_retries=overrides.get("max_retries", 3),` 这里用 `.get(键, 默认值)` 而不是 `or`,因为有人可能真想传 `max_retries=0`,0 是假值,用 `or` 就被吞成 3 了。
- `self.ledger = Ledger()` 每个客户端一本账,从 0 开始。
- `def _kwargs(self, messages` 下划线开头表示「内部用,外面别调」(只是约定,Python 不拦)。作用是拼出要传给 SDK 的全部参数。
- `extra = {**self.extra_body, **kw.pop("extra_body", {})}` 两个 dict 合并,后面的覆盖前面的。`kw.pop` 取出并**删掉**调用方传的 extra_body,避免下一行 `**kw` 再带进去一份。实测默认时 `extra = {'thinking': {'type': 'disabled'}}`;调用时传 `extra_body={"thinking": {"type": "enabled"}}`,合并后就是 enabled。
- `args: dict[str, Any] = {"model": kw.pop("model", self.model), "messages": messages, **kw}` 实测 `_kwargs(msgs, temperature=0.3, max_tokens=500)` 返回:<br>`{"model": "deepseek-flash", "messages": [...两条...], "temperature": 0.3, "max_tokens": 500, "extra_body": {"thinking": {"type": "disabled"}}}`
- `if extra:` extra 为空 dict 时就不加 `extra_body` 键,发给 OpenAI 这类不认识扩展参数的厂商也干干净净。
- `def _cost(self, prompt: int, completion: int, hit: int) -> float:` 用文章「算钱」那节的例子代入:`_cost(3500, 400, 3000)` → `miss = 500` → `(3000×0.04 + 500×2 + 400×8) ÷ 1,000,000 = 0.00432`,实测一致。
- `@staticmethod` 静态方法,不需要 self,也不需要 cls,就是一个挂在类上的普通函数。
- `hit = getattr(usage, "prompt_cache_hit_tokens", None)` 先按 DeepSeek 的字段名找。实测 DeepSeek 的 usage 里**两种字段都有**:`prompt_cache_hit_tokens: 0`,还有 `prompt_tokens_details: {'cached_tokens': 0}`。
- `if hit is None:` 找不到 DeepSeek 的字段,再去找 OpenAI 的 `prompt_tokens_details.cached_tokens`。
- `return hit or 0` 两种都没有就返回 0。
- `start = time.perf_counter()` 高精度计时器,只用来算时间差,数值本身没意义。
- `resp = self.client.chat.completions.create(**self._kwargs(messages, **kw))` `**dict` 把字典展开成关键字参数,等于把上面 `_kwargs` 拼出来的那一包原样传给 SDK。
- `latency = time.perf_counter() - start` 实测非流式这次是 0.99 秒。
- `msg = choice.message.model_dump(exclude_none=True)` 把 SDK 的 pydantic 对象转成普通 dict,`exclude_none=True` 去掉值为 None 的字段(比如没有工具调用时的 `tool_calls: None`)。实测得到 `{'content': '你好，小林！很高兴认识你。作为云簿的后端开发，你平时主要用哪些技术栈？最近在忙什么项目？', 'role': 'assistant'}`。开思考时这里还会有 `reasoning_content`。
- `hit = self._cache_hit(u)` 实测 0。这么短的请求够不上 DeepSeek 的缓存粒度,前缀不够一块时命中就是 0。我另外实测一个多轮对话,输入 274 token 时命中 128、415 token 时命中 256,命中数是 128 的整数倍。system prompt 长了才会更早命中。
- `content=choice.message.content or "",` content 可能是 None(比如模型只返回了工具调用),`or ""` 保证一定是字符串。
- `reasoning=msg.get("reasoning_content"),` dict 的 `.get` 取不到时返回 None。思考关闭,实测是 None。
- `prompt_tokens=u.prompt_tokens if u else 0,` 三元表达式:`A if 条件 else B`。实测 20。
- `cost=self._cost(u.prompt_tokens, u.completion_tokens, hit) if u else 0.0,` 实测输入 20、输出 29、命中 0:`20×2 + 29×8 = 272`,`cost = 0.000272` 元。
- `self.ledger.add(result)` 记一笔账再返回。
- `def stream(self, messages` 函数体里有 `yield`,它就是**生成器函数**:调用时不会立刻执行,而是返回一个迭代器,`for` 每要一次,函数就往下跑到下一个 `yield`。
- `args = self._kwargs(messages, stream=True, **kw)` 多加一个 `stream=True`。实测参数键依次是 `['model', 'messages', 'stream', 'temperature', 'max_tokens', 'extra_body', 'stream_options']`。
- `args.setdefault("stream_options", {"include_usage": True})` `setdefault`:键不存在才设置。`include_usage` 让服务端在流的最后附上 token 用量,不开的话流式拿不到 usage,也就算不了钱。
- `content: list[str] = []` 先把一段段文字收进列表,最后一次性 `"".join`,比一路用 `+=` 拼字符串快。
- `for chunk in self.client.chat.completions.create(**args):` 这里用的是第二轮「我叫什么名字？在哪工作？」(带着第一轮历史)。实测一共收到 13 个 chunk:<br>chunk1:`content=''`(空的开场块)<br>chunk2–12:`'你' '叫' '小林' '，' '在' '云' '簿' '做' '后端' '开发' '。'`<br>chunk13:`content=''`、`finish_reason='stop'`,并且带着 usage。
- `if chunk.usage:` DeepSeek 把 usage 附在最后一块上(上面的 chunk13);OpenAI 会在最后单独多发一块。两种情况都能接住。
- `if not chunk.choices:` OpenAI 那个单独的 usage 块里 choices 是空列表,跳过,不然下一行 `[0]` 会越界。
- `r = getattr(delta, "reasoning_content", None)` 思考内容。思考关闭时每块都是 None;打开时前面会先来一串思考块。实测问「1+1 等于几」,思考内容开头是 `We need answer in Chinese one character?...`。
- `if delta.content:` 空字符串 `''` 是假值,所以 chunk1 和 chunk13 都不会进这个分支。
- `if ttft is None:` 只在第一次拿到正文时记时间。实测 chunk2 的「你」到达时 `ttft = 0.45` 秒,整轮总耗时 0.53 秒。开思考再问一次,ttft 变成 0.60 秒,输出 token 变成 21(正文只有一个「2」,其余全是思考)。
- `yield delta.content` 交出这一段文字,函数在这里暂停;调用方 print 完了再回来继续循环。实测依次 yield 出 11 段:`['你', '叫', '小林', '，', '在', '云', '簿', '做', '后端', '开发', '。']`。
- `if choice.finish_reason:` 只有最后一块的 finish_reason 不为空,实测是 `'stop'`。
- `text = "".join(content)` 实测拼回 `'你叫小林，在云簿做后端开发。'`,模型确实记住了第一轮。
- `msg: dict[str, Any] = {"role": "assistant", "content": text}` 流式没有现成的 message 对象,自己拼一个,存回历史时用。
- `if reasoning:` 有思考内容才加 `reasoning_content` 字段,和非流式的 message 形状保持一致。
- `prompt = usage.prompt_tokens if usage else 0` 实测第二轮输入 60 个 token:system + 第一轮问答 + 新问题,全部重新发了一遍。第一轮只有 20 个,这就是「聊得越久越贵」。
- `self.last = ChatResult(` 生成器没法 `return` 一个值给 `for` 循环,所以把结果挂在 `self.last` 上,调用方循环结束后自己去读。实测 `last.cost = 0.000208`(60×2 + 11×8 = 208)。
- `self.ledger.add(self.last)` 流式调用也记账。
- `class Conversation:` 下面用测试里的数据走一遍:`Conversation("SYS", max_turns=2)`,依次加 3 轮 `q0/a0`、`q1/a1`、`q2/a2`。
- `self.system = {"role": "system", "content": system}` system 单独存放,不放进 turns,裁剪历史时就不会被裁掉。
- `self.turns: list[list[dict[str, Any]]] = []` 列表的列表:每个元素是一轮,一轮里有多条消息。
- `self.turns.append([{"role": "user", "content": text}])` 新开一轮,里面先放 user 这条。
- `self.turns[-1].append(message)` `[-1]` 是最后一个元素,也就是当前这一轮,把 assistant 回复加进去。加完 3 轮后实测 `turns` 是:<br>`[[q0, a0], [q1, a1], [q2, a2]]`(每个都是 `{"role":..., "content":...}`)
- `kept = self.turns[-self.max_turns:]` 切片 `[-2:]` 取最后 2 个元素,实测得到 `[[q1, a1], [q2, a2]]`,q0 那一轮被丢掉了。轮数不够 2 时切片不会报错,有几个取几个。
- `return [self.system] + [m for turn in kept for m in turn]` 嵌套推导式拆开就是两层 for:`for turn in kept: for m in turn: 收集 m`,把「列表的列表」压平成一层。实测返回:<br>`[{'role': 'system', 'content': 'SYS'}, {'role': 'user', 'content': 'q1'}, {'role': 'assistant', 'content': 'a1'}, {'role': 'user', 'content': 'q2'}, {'role': 'assistant', 'content': 'a2'}]`

</div>

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

<div class="line-notes">

- `from common.llm import Conversation, LLMClient` 从上面的 `common/llm.py` 导入。要在仓库根目录用 `python -m w1.chat_stream` 跑,`common` 才找得到。下面的「实测」是 2026-10 用管道一次喂了三个问题跑出来的:「发票抬头开错了能改吗？」「那年付能退吗？」「我的订单号是 INV-2026-004417」,最后一行空行退出。
- `SYSTEM = "你是云簿 CloudLedger 的在线客服助手` 写进「今天是 2026-10-12」,是因为模型自己不知道今天几号,问到「上个月的账单」时它需要这个信息。
- `client = LLMClient()` 读 `.env`,建客户端和一本空账本。
- `conv = Conversation(SYSTEM, max_turns=6)` 最多保留最近 6 轮。
- `while True:` 一直循环,直到下面的某个 `break`。
- `text = input("\n你：").strip()` `input` 先打印提示文字,再等用户输入一行。`.strip()` 去掉首尾空格和换行。
- `except EOFError:` 输入流结束时(按 Ctrl+D,或者管道里的内容读完了)`input` 会抛这个异常,当成退出处理。
- `if not text:` 直接回车,text 是空字符串,退出循环。实测第四行是空行,程序走到这里结束。
- `conv.add_user(text)` 新开一轮。第一次进来后,`conv.turns` 是 `[[{"role": "user", "content": "发票抬头开错了能改吗？"}]]`。
- `print("助手：", end="", flush=True)` 先打出「助手：」,不换行,后面流式的字接着打在同一行。
- `for piece in client.stream(conv.messages(), temperature=0.3, max_tokens=500):` `conv.messages()` 每轮都把 system 加上全部保留的历史重新发一遍。`stream()` 是生成器,每来一小段文字,循环体就执行一次。
- `print(piece, end="", flush=True)` 一段段接着打,看起来就像在打字。`end` 和 `flush` 的作用见下面正文。
- `r = client.last` 循环结束后,完整结果在 `client.last` 里。
- `conv.add_assistant(r.message)` 把整条 assistant 消息存回这一轮。存的是整个 `message` dict,不只是文字,开思考时 `reasoning_content` 也会跟着存回去。
- `ttft = f"{r.ttft:.2f}s" if r.ttft is not None else "-"` 模型一个字都没输出时(比如被截断在思考里),ttft 是 None,这时显示 `-`,避免格式化 None 报错。
- `print(f"\n  [TTFT {ttft} | 总 {r.latency:.2f}s` 实测三轮的统计行:<br>第 1 轮:`[TTFT 0.48s | 总 1.02s | 输入 44（缓存 0）| 输出 76 | ¥0.00070]`<br>第 2 轮:`[TTFT 0.67s | 总 1.25s | 输入 130（缓存 0）| 输出 64 | ¥0.00077]`<br>第 3 轮:`[TTFT 0.53s | 总 0.87s | 输入 209（缓存 0）| 输出 43 | ¥0.00076]`<br>输入 44 → 130 → 209,每一轮都把前面的问答带上,所以一直在涨。缓存这三轮都是 0,因为总长度才两百来个 token,还不够 DeepSeek 缓存一块。聊到七八轮、或者把 system 写长了,缓存数就会出来。
- `print("\n本次会话：", client.ledger)` 实测:`本次会话： 3 次调用 | 输入 383 / 输出 183 tokens | 约 ¥0.0022`。383 = 44 + 130 + 209。

</div>

```bash
uv run python -m w1.chat_stream
```

`print(piece, end="", flush=True)` 里的两个参数是流式输出的关键：

- `end=""`：`print` 默认在末尾自动加一个换行（`end="\n"`），流式时每来一小段就换一行会很难看，改成空字符串就是「打完不换行」，几段文字接在同一行上。相当于 Node 里用 `process.stdout.write(piece)` 而不是 `console.log(piece)`。
- `flush=True`：立刻把文字推到屏幕上。终端输出是有缓冲的，没遇到换行时 Python 会先把字攒着，攒够一批或者遇到换行才一起显示。我们恰好用了 `end=""` 不换行，不加 flush 的话，字会憋到整段回答结束才一下子冒出来，流式就白做了。

用 `python -m w1.chat_stream` 而不是 `python w1/chat_stream.py`，是为了让 Python 从仓库根目录找到 `common` 包。

**第 3 步：观察三件事。**

聊 8 到 10 轮，每轮看底下那行统计。第一，输入 token 是不是在逐轮上涨，到第 7 轮之后因为 `max_turns=6` 不再明显上涨。第二，缓存命中数是不是随着轮数增加。开头几轮多半是 0，因为对话太短，前缀还不够缓存的一块；聊到三四轮、输入过了两三百 token 后才开始命中，而且是一截一截地涨（我实测是 128 的整数倍）。system prompt 写得长，从第二轮起就能命中一大段。第三，在第 1 轮告诉它「我的订单号是 INV-2026-004417」，第 8 轮问它「我的订单号是多少」，它会忘掉，因为第 1 轮已经被滑出窗口了。

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

<div class="line-notes">

- `def test_window_keeps_system_and_last_turns():` pytest 会自动找 `test_` 开头的函数来跑,不需要写类,也不需要注册。实测 `pytest -q` 的结果是 `2 passed in 0.62s`。
- `conv = Conversation("SYS", max_turns=2)` 只留 2 轮,好让 3 轮数据能把第一轮挤出去。
- `for i in range(3):` `range(3)` 依次是 0、1、2。三圈之后 `turns` 依次变成:<br>i=0:`[[q0, a0]]`<br>i=1:`[[q0, a0], [q1, a1]]`<br>i=2:`[[q0, a0], [q1, a1], [q2, a2]]`
- `conv.add_user(f"q{i}")` i=0 时就是 `"q0"`。
- `msgs = conv.messages()` 实测是 5 条:`SYS, q1, a1, q2, a2`。turns 里其实还存着 q0,只是取的时候被切片切掉了。
- `assert msgs[0] == {"role": "system", "content": "SYS"}` system 永远排在第一条。dict 用 `==` 比较的是内容,不是同一个对象。
- `assert [m["content"] for m in msgs[1:]] == ["q1", "a1", "q2", "a2"]` `msgs[1:]` 跳过 system,把剩下每条的 content 取出来,和期望的列表比。q0、a0 不在里面,窗口裁剪生效了。
- `assert Price.parse("0.04,2,8") == Price(0.04, 2.0, 8.0)` dataclass 自动生成的 `__eq__` 会逐个比较字段,所以两个 Price 对象能直接用 `==`。
- `assert Price.parse(None) == Price()` 没配价格时三个价钱全是 0,程序不会因为少了 `LLM_PRICE` 就崩掉。

</div>

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
