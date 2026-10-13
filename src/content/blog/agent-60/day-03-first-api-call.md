---
title: 'Day 3 · 第一次调用大模型 API：OpenAI 兼容协议，一份代码切换 DeepSeek/通义/Claude'
description: '把一次 chat completions 的请求和响应逐字段拆开：messages、model、max_tokens、choices、finish_reason、usage。弄清 usage 怎么换算成钱、401/402/429 各是什么意思、SDK 的自动重试替你做了什么，最后写一个改三个环境变量就能换厂商的命令行小工具。'
pubDate: 2026-10-12
regime: none
tags: ['api', 'openai-compatible', 'deepseek', 'claude', 'agent-60']
series: 'agent-60'
day: 3
lang: 'zh'
---

## 今天要解决的问题

Day 0 你已经跑通了一次调用，但那几行代码是照抄的。今天要把它彻底拆开，因为后面每一天都建立在这个调用之上，Agent 说到底就是一个反复调这个接口的循环。

学完今天你应该能：

1. 说出一个 chat completions 请求里每个常用字段的作用，看懂响应的每一层。
2. 解释「OpenAI 兼容协议」是什么，为什么国产模型几乎都兼容它，以及兼容的边界在哪。
3. 从 `usage` 字段算出一次调用花了多少钱，包括缓存命中的部分。
4. 看到 401、402、429、500 时知道是谁的问题、该不该重试。
5. 写一个只改环境变量就能切换 DeepSeek、通义千问、Claude 的小工具。

预计用时：3 到 4 小时。前置：Day 0 的 `.env` 和 Day 2 的 uv 基础。

今天的内容看起来有点「细」，字段、错误码、价格表。但我的经验是，Agent 线上出的问题，很大一部分最后都追到这一层：回答被截断没人发现、重试把限流打爆、缓存没命中导致账单翻倍。把这一层吃透，后面排查问题会快很多。

## 一次调用到底发了什么

SDK 帮你藏掉了很多细节，第一次学最好看一眼裸的 HTTP。下面这条 curl 和 Day 0 的 Python 代码做的是同一件事：

```bash
curl https://api.deepseek.com/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $LLM_API_KEY" \
  -d '{
    "model": "deepseek-flash",
    "messages": [
      {"role": "system", "content": "你是云簿 CloudLedger 的客服助手，回答简洁。"},
      {"role": "user", "content": "发票抬头开错了能改吗？"}
    ],
    "max_tokens": 300,
    "temperature": 0.3,
    "thinking": {"type": "disabled"}
  }'
```

就是一个 POST，JSON 里放模型名和一组消息。没有会话、没有连接状态，这一次请求里有什么，模型就只知道什么。

响应大致长这样（我把内容删短了，字段结构和 DeepSeek 文档一致）：

```json
{
  "id": "a1b2c3...",
  "object": "chat.completion",
  "created": 1760000000,
  "model": "deepseek-flash",
  "choices": [
    {
      "index": 0,
      "message": {"role": "assistant", "content": "可以的。开票后 30 天内……"},
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 38,
    "completion_tokens": 52,
    "total_tokens": 90,
    "prompt_cache_hit_tokens": 0,
    "prompt_cache_miss_tokens": 38
  }
}
```

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="一次 chat completions 请求和响应的结构">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="20" width="270" height="220" rx="6" fill="none" stroke="var(--compute)"/>
<text x="35" y="42" fill="var(--compute)">请求 POST /chat/completions</text>
<text x="35" y="68" fill="var(--ink)">model</text><text x="130" y="68" fill="var(--ink-soft)">用哪个模型</text>
<text x="35" y="92" fill="var(--ink)">messages[]</text><text x="130" y="92" fill="var(--ink-soft)">全部上下文</text>
<text x="50" y="112" fill="var(--ink-faint)">system / user /</text>
<text x="50" y="130" fill="var(--ink-faint)">assistant / tool</text>
<text x="35" y="156" fill="var(--ink)">max_tokens</text><text x="130" y="156" fill="var(--ink-soft)">输出上限</text>
<text x="35" y="180" fill="var(--ink)">temperature</text><text x="130" y="180" fill="var(--ink-soft)">随机程度</text>
<text x="35" y="204" fill="var(--ink)">stream / tools</text><text x="150" y="204" fill="var(--ink-soft)">Day 4 / Day 8</text>
<rect x="350" y="20" width="270" height="220" rx="6" fill="none" stroke="var(--mem)"/>
<text x="365" y="42" fill="var(--mem)">响应</text>
<text x="365" y="68" fill="var(--ink)">choices[0]</text>
<text x="380" y="90" fill="var(--ink)">message.content</text>
<text x="380" y="110" fill="var(--ink-faint)">回复正文</text>
<text x="380" y="132" fill="var(--ink)">finish_reason</text>
<text x="380" y="152" fill="var(--ink-faint)">stop / length / tool_calls</text>
<text x="365" y="180" fill="var(--ink)">usage</text>
<text x="380" y="200" fill="var(--ink-faint)">prompt / completion tokens</text>
<text x="380" y="220" fill="var(--ink-faint)">缓存命中 / 未命中</text>
<line x1="290" y1="130" x2="350" y2="130" stroke="var(--ink-soft)" stroke-width="1.5"/>
</g>
</svg>
<figcaption>一次调用的请求和响应。左边每个字段都是你可以控制的，右边你最常读的是 content、finish_reason 和 usage 三处。</figcaption>
</figure>

### 请求里的字段

**model**：模型名。2026 年 10 月 DeepSeek 文档里列的是 `deepseek-flash`（对应 DeepSeek-V4.1-Flash）和 `deepseek-v4-pro`，旧名字 `deepseek-v4-flash` 仍然能用，会被路由到新模型。模型名变得很快，所以我们的代码永远从环境变量 `LLM_MODEL` 读，不写死。

**messages**：一个列表，每条有 `role` 和 `content`。四种 role：`system` 是给模型的「岗位说明」，`user` 是用户说的话，`assistant` 是模型之前的回复，`tool` 是工具执行结果（Day 8 讲）。明天会专门讲怎么用它管理多轮对话。

**max_tokens**：这次最多输出多少 token。不设的话 DeepSeek 非思考模式默认 8K、思考模式默认 64K。设小了回答会被拦腰截断，设大了不会多花钱（只按实际输出计费），但会影响你对最坏情况的成本估计。

**temperature**：Day 1 讲过。DeepSeek 文档写明它在思考模式下不生效。

**stop**：一个字符串列表，模型生成到其中任何一个时就停。比如让模型列清单时传 `stop=["\n\n"]`，遇到空行就结束。用得不多，但在某些抽取任务里能省不少输出 token。

**n**：一次生成几个候选回答，默认 1。有些厂商不支持大于 1，Agent 场景几乎不用，知道有这个参数就行。

**thinking**：DeepSeek 特有的扩展字段，控制思考模式开关。用 OpenAI SDK 时，不在 OpenAI 标准里的字段要放进 `extra_body`，SDK 会原样合并进请求体。

### 响应里的字段

**choices**：一般只有一个元素。`message.content` 是回复正文；如果开了思考模式，DeepSeek 还会多一个同级的 `reasoning_content`。

**finish_reason**：模型为什么停下来。这个字段新手经常忽略，但它很重要：

- `stop`：正常结束。
- `length`：撞到 `max_tokens` 或上下文上限，**回答是不完整的**。如果你让模型输出 JSON，撞到 length 时 JSON 多半是残缺的，解析必然失败。
- `tool_calls`：模型想调用工具，Day 8 的主角。
- `content_filter`：内容被安全策略过滤了。
- DeepSeek 还有 `insufficient_system_resource`（后端资源不足被打断）和 `aborted`。

我的习惯是每次调用后都检查 `finish_reason`，不是 `stop` 也不是 `tool_calls` 就打日志。很多「模型回答不完整」的 bug 根源就在这里。

**usage**：计费依据，下面单独算账。

## OpenAI 兼容协议：事实标准是怎么来的

OpenAI 是第一个大规模开放大模型 API 的公司，它的 `/chat/completions` 接口格式被大量开发者、SDK、框架用了两三年。后来的厂商发现，与其让开发者学一套新格式，不如直接兼容这套：你只要把 `base_url` 和 `api_key` 换掉，原来的代码、原来的框架就能直接用。于是 DeepSeek、阿里百炼（通义千问）、Kimi、智谱、硅基流动、OpenRouter，甚至 Anthropic 自己，都提供了 OpenAI 兼容的端点。

几个常见厂商的兼容端点（2026 年 10 月查的官方文档，用之前再去核对一次）：

| 厂商 | base_url | 说明 |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com` | 这门课的默认 |
| 阿里云百炼（通义千问） | 北京地域按文档用业务空间专属域名 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`；很多旧教程写的是 `https://dashscope.aliyuncs.com/compatible-mode/v1` | 到百炼控制台看你的地域和模型名 |
| Anthropic（Claude） | `https://api.anthropic.com/v1/` | 兼容层，适合快速对比；Claude 专属能力要用官方 SDK |
| OpenAI | 默认值，不用填 | |

**兼容的边界**要心里有数。基础的 messages、temperature、max_tokens、stream、tools 基本都通；但每家都有自己的扩展参数（DeepSeek 的 `thinking`、通义的 `enable_thinking` 之类），返回里也有各自多出来的字段（比如 DeepSeek 的 `reasoning_content`、`prompt_cache_hit_tokens`），有些 OpenAI 的新参数别家还不支持。Anthropic 自己的文档就明确说，它的 OpenAI 兼容层是给测试和对比用的，生产环境建议用原生 API。

所以工程上的做法是：主流程按 OpenAI 格式写，把厂商差异集中在一个地方处理（明天的 `LLMClient` 就是干这个的），不要让 `if provider == "deepseek"` 散落在代码各处。

### Anthropic 原生格式长什么样

Claude 的原生接口叫 Messages API，和 OpenAI 格式大同小异，有几处差别值得记住，因为面试和读别人代码时都会遇到：

```python
# 需要 uv add anthropic
import anthropic

client = anthropic.Anthropic()   # 读环境变量 ANTHROPIC_API_KEY
resp = client.messages.create(
    model="claude-sonnet-5-5",
    max_tokens=300,               # 必填，OpenAI 格式里是可选的
    system="你是云簿 CloudLedger 的客服助手，回答简洁。",   # system 是顶层参数，不在 messages 里
    messages=[{"role": "user", "content": "发票抬头开错了能改吗？"}],
)
# content 是一个块列表，不是字符串；开了思考时第一块可能是 thinking 块，所以按类型取
print("".join(b.text for b in resp.content if b.type == "text"))
print(resp.stop_reason)           # 对应 finish_reason，取值是 end_turn / max_tokens / tool_use 等
print(resp.usage.input_tokens, resp.usage.output_tokens)
```

差别集中在四处：`system` 单独放、`max_tokens` 必填、返回的 `content` 是一个由多个块组成的列表（文字块、工具调用块、思考块）、字段名不同（`stop_reason`、`input_tokens`）。有意思的是，DeepSeek 也提供了 Anthropic 格式的端点 `https://api.deepseek.com/anthropic`，用 anthropic SDK 指过去也能调。两种协议现在是行业里并存的两大格式。

还有一个名字你会在 OpenAI 的文档里看到：Responses API。这是 OpenAI 2025 年推出的新接口，把多轮状态、内置工具这些能力放到了服务端。DeepSeek 文档显示它也支持了 Responses API。这门课统一用 chat completions，因为它是所有厂商都支持的最大公约数，你学会了它，换到哪一家都没障碍。

## 算钱：从 usage 到人民币

DeepSeek 2026 年 10 月的官方价格（人民币，每百万 token）：

| 模型 | 时段 | 输入（缓存命中） | 输入（缓存未命中） | 输出 |
| --- | --- | --- | --- | --- |
| deepseek-flash | 高峰 | 0.04 | 2 | 8 |
| deepseek-flash | 空闲 | 0.02 | 1 | 4 |
| deepseek-v4-pro | 高峰 | 0.30 | 9 | 27 |
| deepseek-v4-pro | 空闲 | 0.15 | 4.5 | 13.5 |

高峰时段是北京时间工作日 9:00–12:00 和 14:00–18:00，其余时间是空闲价。

注意那一列「缓存命中」，比未命中便宜 50 倍。DeepSeek 会自动缓存请求的前缀：如果你这次请求的开头（比如很长的 system prompt + 工具定义）和之前某次请求一模一样，这部分就按命中价算。`usage` 里的 `prompt_cache_hit_tokens` 和 `prompt_cache_miss_tokens` 告诉你各占多少。

计算公式：

```
花费 = (命中 tokens × 命中价 + 未命中 tokens × 未命中价 + 输出 tokens × 输出价) ÷ 1,000,000
```

举个例子。一次调用 `prompt_cache_hit_tokens = 3000`，`prompt_cache_miss_tokens = 500`，`completion_tokens = 400`，deepseek-flash 高峰价：

```
(3000 × 0.04 + 500 × 2 + 400 × 8) ÷ 1,000,000
= (120 + 1000 + 3200) ÷ 1,000,000
= 0.00432 元
```

如果同样的调用一点缓存都没命中：(3500 × 2 + 400 × 8) ÷ 1,000,000 = 0.0102 元，贵了一倍多。Agent 每一步都会带着同样的 system prompt 和工具定义，所以**把不变的内容放在 messages 最前面、把变化的内容放在后面**，是最便宜的优化手段之一。Day 38 会细讲 prompt caching，现在先记住这个原则。

还有一个容易漏的：开了思考模式，`completion_tokens` 里包含了思考的 token（`completion_tokens_details.reasoning_tokens` 能看到具体多少），它们按输出价计费。一次思考几千 token 很正常，这就是为什么简单任务要关掉思考。

## 错误码：谁的问题，要不要重试

DeepSeek 文档列出的错误码和我的处理建议：

| 状态码 | 含义 | 是谁的问题 | 要不要重试 |
| --- | --- | --- | --- |
| 400 | 请求体格式错 | 你的代码 | 不要，改代码 |
| 401 | key 错误或缺失 | 你的配置 | 不要，检查 `.env` |
| 402 | 余额不足 | 你的钱包 | 不要，去充值 |
| 422 | 参数错（比如 temperature=5） | 你的代码 | 不要 |
| 429 | 速率超限 | 你太快了 | 要，等一会儿（指数退避） |
| 500 | 服务端故障 | 厂商 | 要，稍后重试 |
| 503 | 服务端过载 | 厂商 | 要，稍后重试 |

规律很好记：**4xx 里除了 429 都别重试，重试一百次也是错；429 和 5xx 要重试，而且要越等越久**。

好消息是 OpenAI 官方 Python SDK 已经替你做了这件事：默认对连接错误、408、409、429 和 5xx 自动重试 2 次，带指数退避。可以调：

```python
client = OpenAI(base_url=..., api_key=..., max_retries=5, timeout=60.0)
```

`timeout` 也要注意设。SDK 默认超时很长（10 分钟），对于需要快速失败的场景（比如用户在网页上等着），应该设短一点，超时了给用户一个友好提示，而不是让页面转十分钟。

SDK 抛出的异常类型和状态码对应：`openai.AuthenticationError`（401）、`openai.RateLimitError`（429）、`openai.BadRequestError`（400）、`openai.APIStatusError`（其他状态码的父类）、`openai.APIConnectionError`（连不上）、`openai.APITimeoutError`（超时）。下面的练习会分别处理它们。

## 限速、并发和选厂商

除了错误码，还有两个上线前一定会碰到的现实问题。

第一个是限速。每家都会限制你每分钟能发多少请求（RPM）、每分钟能处理多少 token（TPM），或者同时能有多少个请求在跑（并发数）。DeepSeek 2026 年的价格页写的是并发上限：`deepseek-flash` 2,500，`deepseek-v4-pro` 500。学习阶段完全碰不到，但 W5 跑评测的时候，你可能一口气并发跑 200 条测试用例，这时候就要自己控制并发数，比如用 `asyncio.Semaphore(20)` 限制同时只有 20 个请求在飞。不控制的话会收到一堆 429，SDK 自动重试又加重拥堵，评测反而跑得更慢。

第二个是怎么选厂商。我的建议分三种情况。

学习阶段，用国内能直连、便宜、文档清楚的，DeepSeek 或通义千问都行，这门课默认 DeepSeek。一个月几十块钱，不用担心花钱，可以大胆地反复跑。

做作品给面试官看，最好**同时支持两家**，并且在 README 里放一张对比表：同一批评测用例，模型 A 准确率多少、单次成本多少、P95 延迟多少，模型 B 又是多少，最后选了哪个、为什么。这张表比任何「熟悉多种大模型」的简历措辞都有说服力。

真正上生产，选择因素会多很多：数据能不能出境（国内很多企业客户要求数据不出境，只能用国内模型或者私有化部署）、SLA、发票和合同、峰谷价格、限速额度能不能申请提高。这些面试的时候被问到，能说出两三条就很加分。

最后说说 key 的安全。平台控制台一般都能建多个 key，我的习惯是一个项目一个 key，名字写清楚用途（比如「agent-60-lab 本地」「supportpilot 线上」）。哪个泄露了就单独作废，不影响别的。能设用量上限或余额告警的平台一定要设，余额别一次充太多。这些在面试里也算加分项，说明你有生产环境的意识：真实公司里一个泄露的 key 被人拿去刷，一晚上烧掉几万块钱的事是真发生过的。

另外提醒一个坑：国外模型的 API 在国内直连通常不稳定，用代理调的话，`APIConnectionError` 和超时会明显变多。这也是为什么课程默认国内模型，Claude 和 OpenAI 只作为对比。

## 动手练习

写一个叫 `ask.py` 的命令行工具：从命令行接收问题，调用模型，打印回复、finish_reason、token 用量和花费；只改环境变量就能切换厂商。

**第 1 步：准备多个厂商的配置。** 在 `.env` 旁边建几个配置文件，想切换时用 `--env` 参数指定。没有的厂商可以不建，只有 DeepSeek 的话建一个 `.env.deepseek` 就够了。最省事的办法是复制一份现有的 `.env`，再对照下面补齐缺的行（主要是 `LLM_EXTRA_BODY` 和 `LLM_PRICE`）：

```bash
cp .env .env.deepseek
```

```bash
# agent-60-lab/.env.deepseek
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=sk-...
LLM_MODEL=deepseek-flash
LLM_EXTRA_BODY={"thinking": {"type": "disabled"}}
# 价格：命中/未命中/输出，元每百万 token（高峰价）
LLM_PRICE=0.04,2,8
```

```bash
# agent-60-lab/.env.claude
LLM_BASE_URL=https://api.anthropic.com/v1/
LLM_API_KEY=sk-ant-...
LLM_MODEL=claude-sonnet-5-5
LLM_EXTRA_BODY={}
# Claude 按美元计价，这里为了演示按 1 美元 ≈ 7.1 元粗略换算：输入 $2、输出 $10 每百万 token
# 缓存读按官方说明为基础输入价的 5%，即 $0.1
LLM_PRICE=0.71,14.2,71
```

记得把 `.env.*` 也加进 `.gitignore`。如果你在 Day 0 已经按那里的内容建过 `.gitignore`，这两行已经有了，跳过这一步，用 `git check-ignore -v .env.deepseek` 确认能输出一行就行：

```bash
echo ".env.*" >> .gitignore
echo '!.env.example' >> .gitignore
```

**第 2 步：写 `ask.py`。**

```python
# agent-60-lab/w1/ask.py
"""命令行问答：uv run w1/ask.py "你的问题" [--env .env.deepseek]"""
import argparse
import json
import os
import sys

import openai
from dotenv import load_dotenv
from openai import OpenAI


def parse_price(raw: str) -> tuple[float, float, float]:
    hit, miss, out = (float(x) for x in raw.split(","))
    return hit, miss, out


def cost_yuan(usage, price: tuple[float, float, float]) -> float:
    hit_price, miss_price, out_price = price
    # DeepSeek 返回命中/未命中明细；别家没有时，全部按未命中算（偏保守）
    hit = getattr(usage, "prompt_cache_hit_tokens", None) or 0
    miss = getattr(usage, "prompt_cache_miss_tokens", None)
    if miss is None:
        miss = usage.prompt_tokens - hit
    return (hit * hit_price + miss * miss_price + usage.completion_tokens * out_price) / 1_000_000


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("question")
    parser.add_argument("--env", default=".env")
    parser.add_argument("--max-tokens", type=int, default=500)
    args = parser.parse_args()

    load_dotenv(args.env, override=True)
    client = OpenAI(
        base_url=os.environ["LLM_BASE_URL"],
        api_key=os.environ["LLM_API_KEY"],
        max_retries=3,
        timeout=60.0,
    )
    extra_body = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
    price = parse_price(os.environ.get("LLM_PRICE", "0,0,0"))

    try:
        resp = client.chat.completions.create(
            model=os.environ["LLM_MODEL"],
            messages=[
                {"role": "system", "content": "你是一个简洁的技术助手，用中文回答。"},
                {"role": "user", "content": args.question},
            ],
            max_tokens=args.max_tokens,
            temperature=0.3,
            extra_body=extra_body,
        )
    except openai.AuthenticationError:
        print("401：API key 不对。检查", args.env, "里的 LLM_API_KEY。", file=sys.stderr)
        return 1
    except openai.RateLimitError as e:
        print("429：请求太快或额度用完（已自动重试 3 次）。", e.message, file=sys.stderr)
        return 1
    except openai.BadRequestError as e:
        print("400：请求参数有问题，通常是模型名或扩展参数不对：", e.message, file=sys.stderr)
        return 1
    except openai.APIConnectionError:
        print("连不上服务器：检查网络、代理和 LLM_BASE_URL。", file=sys.stderr)
        return 1
    except openai.APIStatusError as e:
        print(f"HTTP {e.status_code}：{e.message}", file=sys.stderr)
        return 1

    choice = resp.choices[0]
    print(choice.message.content)
    print("-" * 40)
    print("模型:", resp.model, "| finish_reason:", choice.finish_reason)
    if choice.finish_reason == "length":
        print("⚠ 回答被 max_tokens 截断了，调大 --max-tokens 再试")
    u = resp.usage
    assert u is not None  # 和 Day 1 一样，SDK 把 usage 标成可能为空
    print(f"tokens: 输入 {u.prompt_tokens} / 输出 {u.completion_tokens}，花费约 ¥{cost_yuan(u, price):.5f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

**第 3 步：跑几种情况。**

```bash
uv run w1/ask.py "用三句话解释什么是 HTTP 幂等" --env .env.deepseek
uv run w1/ask.py "写一篇 2000 字的文章介绍 Python" --env .env.deepseek --max-tokens 50
```

第二条会触发 `finish_reason: length` 和那条警告。

故意把 `.env.deepseek` 里的 key 改错一个字符再跑，看 401 的提示；把 `LLM_MODEL` 改成 `deepseek-nonexistent` 再跑，看报什么错（多半是 400，具体看厂商）。改完记得改回来。

**第 4 步：同一个问题问两次，观察缓存。** 把 system prompt 改得很长（比如复制一段 2000 字的产品说明进去），连续跑两次同样的命令。DeepSeek 的缓存需要一点时间建立，第二次或第三次时 `prompt_cache_hit_tokens` 通常会变大，花费随之下降。把 `cost_yuan` 里的 hit 和 miss 打印出来观察。

**第 5 步（可选）：** 如果你有 Claude 或通义的 key，用同一个问题跑一遍，比较回答风格、速度和花费。

**验收标准：** 能用 `--env` 切换至少一家厂商并正常回答；能触发并看懂 `length` 截断；能看到 401 的友好提示；能从输出里读出这次调用花了多少钱。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| chat completions | OpenAI 定义的对话补全接口，`POST /chat/completions`，事实上的行业标准 |
| OpenAI 兼容协议 | 其他厂商实现的与 OpenAI 相同格式的接口，换 base_url 和 key 即可调用 |
| base_url | API 服务器地址，切换厂商主要就是改它 |
| Messages API | Anthropic（Claude）的原生对话接口 |
| Responses API | OpenAI 2025 年推出的新一代接口，服务端可管理状态和内置工具 |
| finish_reason / stop_reason | 模型停止生成的原因：正常结束、长度截断、调用工具等 |
| usage | 本次调用的 token 用量，计费依据 |
| 缓存命中（cache hit） | 请求前缀与之前的请求相同，这部分按低价计费 |
| extra_body | OpenAI SDK 的参数，用来传非标准的厂商扩展字段 |
| 指数退避 | 重试间隔按 1s、2s、4s……递增，避免一起重试把服务压垮 |

## 常见误区

**不检查 finish_reason。** 回答被截断时 content 照样有内容，看起来一切正常，直到某个用户发现回复只有半句话，或者 JSON 解析失败。

**4xx 也自动重试。** 401、400 重试多少次都一样，还会刷出一堆无意义的请求。只对 429 和 5xx 重试。

**把模型名写死在代码里。** 模型更新很快，DeepSeek 一年里改了好几次模型名。从配置读。

**以为兼容就是完全一样。** 扩展参数、返回字段、某些新特性各家都不同。把厂商差异收在一个模块里处理。

**跟着旧教程抄模型名。** B 站和博客上大量 2024、2025 年的教程还在用 `deepseek-chat`、`gpt-3.5-turbo` 这类旧名字。有的旧名字还能用但被映射到了别的模型，有的已经下线直接报错。模型名、价格、参数永远以官方文档当前版本为准，教程只用来学思路。

**在海外模型和国内模型之间来回切，却不记录结果。** 换了模型「感觉好像更好了」不算数。从今天起养成习惯，每次对比至少记下同一组问题的回答、耗时和花费，W5 的评测体系就是把这个习惯系统化。

**只看输入价格。** 输出价通常是输入的 4 倍左右，思考模式的思考 token 也按输出计费。估算成本时输出往往是大头。

## 学习资料

### 文档与文章

- [DeepSeek 首次调用 API](https://api-docs.deepseek.com/zh-cn/)、[模型 & 价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)、[错误码](https://api-docs.deepseek.com/zh-cn/quick_start/error_codes)：**必看**，三页一共 15 分钟。价格页上的模型名和价格以你看到时为准。
- [阿里云百炼：OpenAI 兼容接口](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)：想用通义千问的看这页，重点是 base_url 和地域。
- [Claude：OpenAI SDK 兼容](https://platform.claude.com/docs/en/api/openai-sdk)：Anthropic 官方说明兼容层支持什么、不支持什么。
- [Claude：快速开始](https://platform.claude.com/docs/en/get-started)：原生 Messages API 的第一次调用。
- [Claude 定价](https://platform.claude.com/docs/en/about-claude/pricing)：对照国外旗舰模型的价格量级。
- [openai-python README](https://github.com/openai/openai-python)：看 Handling errors、Retries、Timeouts 三节，是今天练习里错误处理的来源。15 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1kJPvzcEjV&autoplay=0&high_quality=1" title="手把手教你用30分钟学会Python调用大模型API" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>A1星球 · 手把手教你用30分钟学会Python调用大模型API · 看 P1（30 分钟）。适合想先看别人操作一遍再动手的人，P2 的学习路线可以跳过。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1P6NaeeEAN&autoplay=0&high_quality=1" title="DeepSeek API 的 Python 调用小白详细教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Java普惠学堂 · DeepSeek API 的 Python 调用小白详细教程 · 看 P2（26 分钟），演示了注册、充值、建 key 的完整流程。视频是 2025 年初录的，里面的模型名已经过时，以官方文档为准。</figcaption>
</figure>

### 其他经典视频

- Andrej Karpathy《How I use LLMs》（YouTube ID EWvNQjAaOHw，2 小时）：从使用者角度讲各家模型和功能的区别，思考模式、工具、文件上传都涉及。今天不必看，周末有空可以看，对选模型有帮助。
- DeepLearning.AI 的《ChatGPT Prompt Engineering for Developers》第一课也演示了如何调用 API，明天讲提示词时一起看。

### 书籍

- Chip Huyen《AI Engineering》（O'Reilly，2025）第 2 章「Understanding Foundation Models」的采样（Sampling）部分：讲 temperature、top_p、结构化输出背后的原理，可以把 Day 1 和今天的内容串起来。1 小时。

### 开源项目与代码

- [openai/openai-python](https://github.com/openai/openai-python)：官方 SDK，今天用的就是它。
- [anthropics/anthropic-sdk-python](https://github.com/anthropics/anthropic-sdk-python)：Claude 官方 SDK。
- [OpenRouter](https://openrouter.ai/)：一个 key 调几百个模型的聚合服务，OpenAI 兼容格式，适合做模型对比（需要海外支付方式）。

## 自测

1. 你调用模型让它输出一个很长的 JSON，`json.loads` 报错「Unterminated string」。第一件事该检查什么？

<details><summary>答案</summary>

检查 `finish_reason` 是不是 `length`。如果是，说明输出撞到了 max_tokens 被截断，JSON 不完整。调大 max_tokens，或者让输出更短。

</details>

2. 一次调用：缓存命中 5,000 token，未命中 1,000 token，输出 600 token，deepseek-flash 空闲价。花多少钱？

<details><summary>答案</summary>

空闲价：命中 0.02、未命中 1、输出 4（元 / 百万 token）。(5000 × 0.02 + 1000 × 1 + 600 × 4) ÷ 1,000,000 = (100 + 1000 + 2400) ÷ 1,000,000 = 0.0035 元。

</details>

3. 下面四种错误，哪些应该自动重试？401、402、429、503。

<details><summary>答案</summary>

429 和 503。401 是 key 错、402 是余额不足，重试没有意义。

</details>

4. 把 OpenAI 格式的代码改成调 Claude 原生 API，至少有哪几处要改？

<details><summary>答案</summary>

system 从 messages 里拿出来作为顶层参数；max_tokens 必填；读回复要从 `resp.content` 块列表里取文字块的 text；停止原因字段是 `stop_reason`，取值不同；usage 字段名是 input_tokens / output_tokens。

</details>

5. 为什么要把 system prompt 和工具定义放在 messages 最前面，把每次变化的内容放后面？

<details><summary>答案</summary>

前缀缓存只对「开头完全相同」的部分生效。不变的内容放前面，连续多次调用时这部分能命中缓存，按低很多的价格计费，延迟也更低。如果把每次变化的内容（比如当前时间戳）放在最前面，整个前缀就都不一样了，缓存全部失效。

</details>

6. 面试题：「你的系统要支持多个模型厂商，怎么设计？」

<details><summary>答案</summary>

要点：统一按 OpenAI 兼容格式作为内部接口；做一个适配层（客户端封装），把各家的 base_url、key、模型名、扩展参数、返回字段差异（如思考内容、缓存用量）、错误类型都收在里面，上层业务代码只依赖统一接口；配置驱动切换，不写死；按任务路由模型（便宜模型做分类，强模型做复杂推理）；加上统一的重试、超时、限流、成本统计和降级（主厂商故障时切备用）。也可以提到用 LiteLLM 这类现成的网关库，但要说清楚自己理解它解决了什么问题。

</details>

## 明天预告

Day 4 · messages、system prompt 与流式输出。API 没有记忆，多轮对话全靠你自己拼 messages，聊得越久越贵；流式输出能让用户在第一个字出来时就开始读。明天把这两件事写进一个 `LLMClient` 类，后面整门课都用它。
