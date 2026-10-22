---
title: 'Day 122 · 响应逐字段:choices、finish_reason、usage'
description: '用 with_raw_response 把 DeepSeek 返回的原始 JSON 原样打出来,再一层层拆:外层的 id、created、model、system_fingerprint,choices 里的 message 和 finish_reason,最后是 usage 这张账单。实跑三种停法:正常说完、max_tokens=10 被拦腰截断、开着思考给 40 个 token 结果 content 是空字符串;顺便看清 SDK 对象和字典的区别,把 ask.py 升级成会检查 finish_reason 的 ask2.py。'
pubDate: 2026-10-23
regime: none
tags: ['api', 'deepseek', 'python', 'agent-zero']
series: 'agent-zero'
day: 122
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 121](/blog/agent-zero/day-121-api-request/) 我们给 openai SDK 挂了一个事件钩子,把它发出去的 HTTP 请求原样打印出来:一行 `POST https://api.deepseek.com/chat/completions`,十几个请求头,一段 JSON 请求体。又用 httpx 手写了同一个请求,逐个试了 `model`、`messages`、`max_tokens`、`temperature`、`stop`、`n` 和 `thinking`,弄清了 `extra_body` 是给厂商自己的字段留的口袋。

练习 5 用 curl 拿到了一整段响应 JSON,里面有 `id`、`choices`、`finish_reason`、`usage`、`system_fingerprint`,当时只说「明天拆」。请求是你说给模型的话,响应是模型交回来的东西。你写的每一个 Agent,下一步该干什么都取决于从响应里读出了什么,所以今天把它一个字段一个字段地拆开。

## 今天要解决的问题

学完今天,你应该能做到:

1. 拿到一次调用的**原始响应 JSON**,指着每个字段说出它是什么,知道 SDK 把它变成了什么对象、怎么用点号取值。
2. 说出 `finish_reason` 的几种取值,亲手制造出 `stop` 和 `length`,知道为什么**每次调用后都要检查它**,包括「开着思考、`max_tokens` 太小,结果 `content` 是空字符串」这个坑。
3. 读懂 `usage` 里的每个数:`prompt_tokens`、`completion_tokens`、`total_tokens`、缓存命中和未命中、推理 token,知道它们之间的加法关系。
4. 把 Day 120 的 `ask.py` 升级成 `ask2.py`:打印账单,模型没说完时报错退出。

今天的两个新概念:**响应的结构**(外层字段、`choices`、`message`)和**两个必看字段**(`finish_reason` 和 `usage`)。`usage` 换算成人民币是 Day 124 的事,今天只认字段。

预计用时:2–2.5 小时。实跑花费:今天全部脚本加练习一共调用 DeepSeek 大约 20 次,合计不到 0.015 元(文末有算式)。前置:[Day 120](/blog/agent-zero/day-120-api-register/) 的 `.env` 和 `ask.py`,[Day 121](/blog/agent-zero/day-121-api-request/) 的 `extra_body` 和 `max_tokens`,[Day 115](/blog/agent-zero/day-115-reasoning-models/) 的思考模式,[Day 108](/blog/agent-zero/day-108-tokens-2/) 的本地分词器,[Day 39](/blog/agent-zero/day-039-json/) 的 JSON,[Day 36](/blog/agent-zero/day-036-exceptions-2/) 的自定义异常。

学法提示:先对照文章把每个脚本逐行敲一遍(不要复制粘贴)并跑通;明天合上文章,把 `ask2.py` 默写出来;然后做动手练习,做不出来再展开参考答案,看完关掉,自己重写一遍。

## 先拿到原始 JSON

Day 120 的 `ask.py` 里,我们写的是 `resp.choices[0].message.content`。这个 `resp` 已经是 SDK 加工过的 Python 对象了,不是服务器发回来的原文。想看原文,前端同学的直觉是去 DevTools 的 Network 面板点「Response」那一栏。Python 这边,openai SDK 留了一个口子:在 `create` 前面加上 `with_raw_response`,它就把原始的 HTTP 响应一起交给你。

新建 `part02/show_response.py`(在 `agent-zero-lab` 根目录,`.env` 是 Day 120 配好的那份):

```python
# agent-zero-lab/part02/show_response.py
import json
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])

raw = client.chat.completions.with_raw_response.create(
    model=os.environ["LLM_MODEL"],
    messages=[
        {"role": "system", "content": "你是云簿 CloudLedger 的客服助手,回答简洁。"},
        {"role": "user", "content": "发票抬头开错了能改吗?"},
    ],
    max_tokens=100,
    temperature=0.3,
    extra_body={"thinking": {"type": "disabled"}},
)
print("状态码:", raw.status_code)
print("content-type:", raw.headers.get("content-type"))
data = raw.http_response.json()
print(json.dumps(data, ensure_ascii=False, indent=2))

resp = raw.parse()
print("---- SDK 对象 ----")
print(type(resp).__name__)
print(resp.choices[0].message.content == data["choices"][0]["message"]["content"])
```

<div class="line-notes">

- `raw = client.chat.completions.with_raw_response.create(` 和平时的 `create` 参数一模一样,只是中间多了 `with_raw_response`。返回的不再是加工好的对象,而是一个「原始响应」包装,里面既有 HTTP 层的东西(状态码、响应头、响应体),也能再加工成平时那个对象。
- `{"role": "system", "content": "你是云簿 CloudLedger 的客服助手,回答简洁。"},` 和 Day 121 `show_request.py` 同一个请求,方便对照:昨天看它发出去长什么样,今天看它回来长什么样。
- `print("状态码:", raw.status_code)` 实跑 `200`。
- `print("content-type:", raw.headers.get("content-type"))` 响应头。实跑 `application/json`,说明响应体是 JSON。响应头的名字和请求头一样不分大小写,用 `.get` 取不到时返回 `None` 不报错。
- `data = raw.http_response.json()` `raw.http_response` 是底层 httpx2 的响应对象,`.json()` 把响应体解析成**普通字典**,和 Day 121 `raw_request.py` 里 `r.json()` 拿到的东西一样。
- `print(json.dumps(data, ensure_ascii=False, indent=2))` 缩进打印,中文原样显示。
- `resp = raw.parse()` 让 SDK 把原始响应加工成平时 `create()` 直接返回的那个对象。
- `print(type(resp).__name__)` `type(x)` 拿到对象的类,`.__name__` 是类名。实跑 `ChatCompletion`。
- `print(resp.choices[0].message.content == data["choices"][0]["message"]["content"])` 同一段回答,左边用点号从对象里取,右边用方括号从字典里取。实跑 `True`。

</div>

```bash
uv run part02/show_response.py
```

实跑输出(北京时间 10 月 22 日 23:50 左右跑的):

```text
状态码: 200
content-type: application/json
{
  "id": "327e228d-dc54-4789-be1a-1f53bc2d7a91",
  "object": "chat.completion",
  "created": 1792684220,
  "model": "deepseek-flash",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "可以改。分两种情况:\n\n1. **当月开具、未认证**:直接联系开票方作废重开即可。\n2. **跨月或已认证**:需开票方开具红字发票冲销,再重新开具正确的蓝字发票。\n\n请尽快联系开票方处理,并提供正确的抬头信息。"
      },
      "logprobs": null,
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 27,
    "completion_tokens": 67,
    "total_tokens": 94,
    "prompt_tokens_details": {
      "cached_tokens": 0
    },
    "prompt_cache_hit_tokens": 0,
    "prompt_cache_miss_tokens": 27
  },
  "system_fingerprint": "e72d3c7f663d3e1383b00b3884cb4501"
}
---- SDK 对象 ----
ChatCompletion
True
```

这就是一次调用交回来的全部东西。回答里的 `\n` 是换行符,JSON 里换行只能这样写,`print` 出 `content` 时它会变回真的换行。整个结构可以分成三块:外层的几个「身份信息」、`choices` 里的回答、`usage` 里的账单。下面这张图先给你一个整体印象。

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="chat.completion 响应的三块结构:外层身份信息、choices 里的回答、usage 账单">
<rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="16" width="600" height="72" rx="6" fill="none" stroke="var(--ink-faint)"/>
<text x="34" y="36" fill="var(--ink-soft)">外层:这次回答的身份信息</text>
<text x="34" y="58" fill="var(--ink)">id  object  created  model  system_fingerprint</text>
<text x="34" y="78" fill="var(--ink-faint)">排查问题、记日志时用,业务逻辑很少读</text>
<rect x="20" y="100" width="290" height="214" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="34" y="122" fill="var(--mem)">choices[0]:模型交回的东西</text>
<text x="34" y="148" fill="var(--ink)">index: 0</text>
<text x="34" y="170" fill="var(--ink)">message:</text>
<text x="50" y="190" fill="var(--ink)">role: "assistant"</text>
<text x="50" y="210" fill="var(--ink)">content: 回答正文</text>
<text x="50" y="230" fill="var(--ink-soft)">reasoning_content(开思考才有)</text>
<text x="34" y="256" fill="var(--ink)">logprobs: null</text>
<text x="34" y="282" fill="var(--mem)">finish_reason: 为什么停</text>
<text x="34" y="302" fill="var(--ink-faint)">每次都要先看这个</text>
<rect x="330" y="100" width="290" height="214" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="344" y="122" fill="var(--compute)">usage:这次的账单</text>
<text x="344" y="148" fill="var(--ink)">prompt_tokens      输入</text>
<text x="360" y="168" fill="var(--ink-soft)">= cache_hit + cache_miss</text>
<text x="344" y="194" fill="var(--ink)">completion_tokens  输出</text>
<text x="360" y="214" fill="var(--ink-soft)">含 reasoning_tokens</text>
<text x="344" y="240" fill="var(--ink)">total_tokens = 输入 + 输出</text>
<text x="344" y="270" fill="var(--ink-soft)">prompt_tokens_details</text>
<text x="344" y="290" fill="var(--ink-soft)">completion_tokens_details</text>
</g>
</svg>
<figcaption>一次非流式响应的三块。蓝色是模型交回的内容,琥珀色是计费依据。Day 124 算钱只用右边这块。</figcaption>
</figure>

## 外层五个字段:这次回答的身份信息

外层除了 `choices` 和 `usage`,还有五个字段。它们平时很少用来做业务判断,但出问题时全靠它们。新建 `part02/read_fields.py`,这次不用 `with_raw_response`,直接用 SDK 对象逐个取:

```python
# agent-zero-lab/part02/read_fields.py
import os
from datetime import datetime

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])

resp = client.chat.completions.create(
    model=os.environ["LLM_MODEL"],
    messages=[{"role": "user", "content": "发票抬头开错了能改吗?一句话回答。"}],
    extra_body={"thinking": {"type": "disabled"}},
)

print("id     :", resp.id)
print("object :", resp.object)
print("created:", resp.created, "=", datetime.fromtimestamp(resp.created))
print("model  :", resp.model)
print("指纹   :", resp.system_fingerprint)
print("候选数 :", len(resp.choices))

choice = resp.choices[0]
print("index  :", choice.index)
print("role   :", choice.message.role)
print("content:", choice.message.content)
print("停止原因:", choice.finish_reason)

u = resp.usage
if u is not None:
    print("输入/输出/合计:", u.prompt_tokens, u.completion_tokens, u.total_tokens)
    print("标准字段 cached_tokens:", u.prompt_tokens_details.cached_tokens if u.prompt_tokens_details else None)
    print("DeepSeek 自己加的:", u.model_extra)
```

<div class="line-notes">

- `from datetime import datetime` 标准库里处理日期时间的类,相当于 JS 的 `Date`。今天只用它一个方法。
- `print("id     :", resp.id)` 这次回答的唯一编号。实跑 `9a697e93-6948-4852-91e6-31246d843b43`。
- `print("object :", resp.object)` 固定是 `chat.completion`,说明这是一次非流式的对话补全。流式的每一小段是 `chat.completion.chunk`(Day 133 讲流式)。
- `print("created:", resp.created, "=", datetime.fromtimestamp(resp.created))` `created` 是 Unix 时间戳,单位**秒**。实跑 `1792684231`,换算成本机时间 `2026-10-22 23:50:31`。前端的 `Date.now()` 是毫秒,JS 里要写 `new Date(created * 1000)`,这里不用乘。
- `print("model  :", resp.model)` 服务器说「这次是哪个模型答的」。实跑 `deepseek-flash`,和请求里写的一样。
- `print("指纹   :", resp.system_fingerprint)` 服务端配置的指纹。实跑 `e72d3c7f663d3e1383b00b3884cb4501`,我这两天几十次调用都是这个值。
- `print("候选数 :", len(resp.choices))` `choices` 是一个列表。实跑长度 `1`。
- `choice = resp.choices[0]` 取第一个(也是唯一一个)候选,存进变量省得每次写一长串。
- `print("index  :", choice.index)` 这个候选在列表里的位置,实跑 `0`。
- `print("role   :", choice.message.role)` 实跑 `assistant`,模型说的话角色永远是这个。
- `print("停止原因:", choice.finish_reason)` 实跑 `stop`。下一节专门讲。
- `u = resp.usage` 账单。SDK 的类型里它可能是 `None`(有些接口不返回用量),所以下一行先判断。
- `print("输入/输出/合计:", u.prompt_tokens, u.completion_tokens, u.total_tokens)` 实跑 `15 29 44`,15 + 29 = 44。
- `print("标准字段 cached_tokens:", u.prompt_tokens_details.cached_tokens if u.prompt_tokens_details else None)` OpenAI 标准里「输入命中缓存多少」写在 `prompt_tokens_details.cached_tokens`。`prompt_tokens_details` 本身也可能是 `None`,所以又判断了一次。实跑 `0`。
- `print("DeepSeek 自己加的:", u.model_extra)` `model_extra` 是一个字典,装着**SDK 不认识的那些字段**。实跑 `{'prompt_cache_hit_tokens': 0, 'prompt_cache_miss_tokens': 15}`,正是 DeepSeek 自己加的两个。

</div>

```bash
uv run part02/read_fields.py
```

实跑输出:

```text
id     : 9a697e93-6948-4852-91e6-31246d843b43
object : chat.completion
created: 1792684231 = 2026-10-22 23:50:31
model  : deepseek-flash
指纹   : e72d3c7f663d3e1383b00b3884cb4501
候选数 : 1
index  : 0
role   : assistant
content: 能，但需视发票类型和是否已跨月/勾选，按规定流程作废或开具红字发票后重开。
停止原因: stop
输入/输出/合计: 15 29 44
标准字段 cached_tokens: 0
DeepSeek 自己加的: {'prompt_cache_hit_tokens': 0, 'prompt_cache_miss_tokens': 15}
```

挨个说一下这五个字段什么时候有用。

**`id`** 是这次回答的编号。你在日志里记下它,用户投诉「昨天下午那个回答胡说八道」时,你能从日志里找到那一次的完整请求和响应。注意它和 Day 121 报错里的 `request_id` 不是一回事:报错时请求没有成功,没有回答,也就没有 `id`,厂商给的是请求编号。找厂商客服排查时,两个都可以报。

**`object`** 告诉你这是什么类型的东西,非流式就是 `chat.completion`。写代码时基本不用看它。

**`created`** 是服务器生成这个回答的时间戳,单位是秒。前端同学注意,JS 的时间戳一般是毫秒,别直接塞进 `new Date()`。

**`model`** 看起来多余,请求里不是已经写了吗?它的用处在于厂商会「换芯」。DeepSeek 的价格页写着,旧名字 `deepseek-v4-flash` 现在还能调,但请求会由新版本处理、按 Flash 价格计费。你的代码里写的名字、实际干活的模型、账单上的名字,这三者可能不一样。把响应里的 `model` 记进日志,将来行为变了能对得上。

**`system_fingerprint`** 是服务端配置的指纹。[Day 112](/blog/agent-zero/day-112-sampling-2/) 讲可复现时提过它:同样的请求、同样的 seed,如果指纹变了,说明厂商后端改了东西,结果对不上不一定是你的锅。DeepSeek 这几天一直返回同一个值。有些厂商根本不填,明天切到硅基流动时你会看到它返回空字符串。

`choices` 为什么是列表?因为 OpenAI 允许一次要 `n` 个候选回答(Day 121 讲过,DeepSeek 只收 `n=1`),每个候选是列表里的一项,`index` 就是它的位置。所以整门课取回答都写 `choices[0]`,意思是「第一个,也是唯一一个」。

`message` 里只有两个键:`role` 永远是 `assistant`,`content` 是回答正文。开了思考模式,DeepSeek 会在 `message` 里多放一个 `reasoning_content`,下一节就会看到。第三部分讲工具调用时,`message` 里还会出现 `tool_calls`。`logprobs` 是每个 token 的概率,[Day 110](/blog/agent-zero/day-110-sampling-1/) 用过,不传 `logprobs=True` 时它就是 `null`。

## finish_reason:每次都要先看它

`finish_reason` 是「模型为什么停下来」。DeepSeek 的接口文档列了六种取值(2026 年 10 月查):

| 取值 | 意思 | 你该怎么办 |
| --- | --- | --- |
| `stop` | 模型自己说完了,或者碰到了你给的 `stop` 停止序列 | 正常使用 |
| `length` | 撞到了 `max_tokens` 或上下文长度上限,**回答不完整** | 不能当完整结果用 |
| `tool_calls` | 模型想调用工具 | 第三部分的主角 |
| `content_filter` | 输出触发了内容过滤 | 换个问法,或提示用户 |
| `insufficient_system_resource` | 后端资源不够,生成被打断 | 稍后重试 |
| `aborted` | 生成过程被中断 | 稍后重试 |

最后两个是 DeepSeek 自己加的,OpenAI 的标准里没有。前两个最常见,我们把它们都制造出来,外加一个更阴险的情况。新建 `part02/finish_reasons.py`:

```python
# agent-zero-lab/part02/finish_reasons.py
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
MODEL = os.environ["LLM_MODEL"]
OFF = {"thinking": {"type": "disabled"}}
ON = {"thinking": {"type": "enabled"}}
Q = "用两句话说说发票抬头开错了怎么办。"

CASES = [
    ("正常说完", 300, OFF),
    ("max_tokens=10", 10, OFF),
    ("开思考 max_tokens=40", 40, ON),
]

for name, limit, extra in CASES:
    resp = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": Q}],
        max_tokens=limit,
        extra_body=extra,
    )
    choice = resp.choices[0]
    msg = choice.message
    reasoning = getattr(msg, "reasoning_content", None)
    u = resp.usage
    detail = u.completion_tokens_details if u else None
    print(f"[{name}] finish_reason={choice.finish_reason}")
    print("  content  :", repr(msg.content))
    print("  reasoning:", repr(reasoning[:40]) if reasoning else None)
    print("  输出 token:", u.completion_tokens if u else None, "其中推理:", detail.reasoning_tokens if detail else None)
```

<div class="line-notes">

- `OFF = {"thinking": {"type": "disabled"}}` 关思考,和 Day 121 的 `NO_THINK` 一样。
- `ON = {"thinking": {"type": "enabled"}}` 开思考。DeepSeek 默认就是开的(Day 121 练习 4),这里显式写出来,读代码的人一眼能看懂。
- `CASES = [` 三组实验,每组是一个元组:(名字, max_tokens, 思考开关)。用元组列表而不是三段重复代码,是 [Day 22](/blog/agent-zero/day-022-tuples-unpack/) 学的写法。
- `("正常说完", 300, OFF),` 给足 300 个 token,让它说完。
- `("max_tokens=10", 10, OFF),` 只给 10 个,肯定说不完。
- `("开思考 max_tokens=40", 40, ON),` 开思考,给 40 个。猜一下 `content` 会是什么。
- `for name, limit, extra in CASES:` 每次取出一个元组,一次拆成三个变量,和 JS 的 `for (const [name, limit, extra] of CASES)` 一样。
- `max_tokens=limit,` 每组用自己的上限。
- `reasoning = getattr(msg, "reasoning_content", None)` `reasoning_content` 不在 OpenAI 的标准字段里,SDK 的类型没有它,所以用 `getattr` 取,取不到给 `None`(Day 121 练习 4 用过)。
- `detail = u.completion_tokens_details if u else None` 输出 token 的明细,开思考时里面有 `reasoning_tokens`。
- `print("  content  :", repr(msg.content))` 用 `repr` 打印,空字符串会显示成 `''`,一眼能看出来;直接 `print` 空字符串,你只会看到一片空白。
- `print("  reasoning:", repr(reasoning[:40]) if reasoning else None)` 推理内容可能很长,只看前 40 个字符。
- `print("  输出 token:", u.completion_tokens if u else None, "其中推理:", detail.reasoning_tokens if detail else None)` 输出总数和其中花在推理上的部分。

</div>

```bash
uv run part02/finish_reasons.py
```

实跑输出:

```text
[正常说完] finish_reason=stop
  content  : '发票抬头开错后，如果是当月发现且未跨月，可直接在开票系统中作废重开；如果已跨月或已认证，则需开具红字发票冲销后重新开具正确的蓝字发票。务必及时联系受票方收回原发票全部联次，确保新发票的抬头信息与企业营业执照完全一致。'
  reasoning: None
  输出 token: 72 其中推理: None
[max_tokens=10] finish_reason=length
  content  : '发票抬头开错后，如果是当月开具且'
  reasoning: None
  输出 token: 10 其中推理: None
[开思考 max_tokens=40] finish_reason=length
  content  : ''
  reasoning: '我们需要回答中文。用户要求用两句话说说发票抬头开错了怎么办。需要简洁两句话。需要'
  输出 token: 40 其中推理: 40
```

第一组正常,`stop`,72 个 token 说完两句话。

第二组 `length`,`content` 停在「如果是当月开具且」,半句话。Day 121 已经见过一次:**截断不报错**,状态码照样是 200,你拿到的就是半截。

第三组是今天最想让你记住的。开着思考、只给 40 个 token,模型先开始「想」,想了 40 个 token 还没想完,额度就用光了,正文一个字都没来得及写。结果 `content` 是空字符串 `''`,`finish_reason` 是 `length`,40 个输出 token **全部是推理**,照样按输出价收钱。如果你的代码只看 `content`,会以为模型「什么都没说」,而且这种情况没有任何报错。思考模式下 `max_tokens` 管的是「推理 + 正文」的总和,这一点 DeepSeek 文档也写了:思考模式默认上限比非思考模式大得多(Day 121 查过,64K 对 8K),就是给推理留的。

所以我的习惯是:**拿到响应先看 `finish_reason`,再看 `content`**。不是 `stop` 的(以后加上 `tool_calls`)都不能当正常结果用,至少要打日志。这个习惯在 Agent 里更要命:Agent 往往让模型输出 JSON 或工具参数,截断的 JSON 解析一定失败,而失败点在下游,很难一眼联想到是上游被截断了。

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="三种停法:正常说完、max_tokens 截断正文、开思考时推理吃光额度导致正文为空">
<rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="30" fill="var(--ink-soft)">max_tokens 是一个总额度,推理和正文都从里面扣</text>
<text x="20" y="62" fill="var(--ink)">正常说完 (300)</text>
<rect x="170" y="48" width="160" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="178" y="64" fill="var(--mem)">正文 72</text>
<rect x="330" y="48" width="290" height="22" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="340" y="64" fill="var(--ink-faint)">没用完 → stop</text>
<text x="20" y="112" fill="var(--ink)">max_tokens=10</text>
<rect x="170" y="98" width="100" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="178" y="114" fill="var(--mem)">正文 10</text>
<text x="282" y="114" fill="var(--ink-faint)">← 撞线,半句话 → length</text>
<text x="20" y="162" fill="var(--ink)">开思考, 40</text>
<rect x="170" y="148" width="160" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="178" y="164" fill="var(--compute)">推理 40</text>
<text x="342" y="164" fill="var(--ink-faint)">← 撞线,正文 '' → length</text>
<text x="20" y="196" fill="var(--ink-faint)">三种情况状态码都是 200,只有 finish_reason 能告诉你区别</text>
</g>
</svg>
<figcaption>finish_reasons.py 的三组实跑。第三组最阴险:钱花了,content 是空的,也不报错。</figcaption>
</figure>

`content_filter` 我没能稳定地制造出来,DeepSeek 对普通问题不会触发,今天就不演示了,知道有这个值、遇到时别当正常结果就行。

## usage:这次的账单

`usage` 在 Day 120 已经瞄过一眼,今天把每个数的关系说清楚。拿 `show_response.py` 那次来看:

```text
"prompt_tokens": 27,
"completion_tokens": 67,
"total_tokens": 94,
"prompt_tokens_details": {"cached_tokens": 0},
"prompt_cache_hit_tokens": 0,
"prompt_cache_miss_tokens": 27
```

- **`prompt_tokens`**:输入了多少 token。注意「输入」是你发过去的**全部** `messages`,不只是用户最后那句话。这次 system 加 user 两条,一共 27 个。
- **`completion_tokens`**:模型输出了多少 token。开思考时,**推理的 token 也算在这里面**。
- **`total_tokens`**:前两个相加,27 + 67 = 94。它只是方便看,算钱不用它,因为输入和输出单价不一样。
- **`prompt_cache_hit_tokens`** 和 **`prompt_cache_miss_tokens`**:输入里有多少命中了 DeepSeek 的上下文缓存,多少没命中。两者加起来正好等于 `prompt_tokens`,这里是 0 + 27 = 27。[Day 117](/blog/agent-zero/day-117-moe-kvcache/) 实测过,一段 4073 token 的提示词第二次发,命中了 3840 个。命中的部分便宜 50 倍,Day 124 算钱时这是重点。
- **`prompt_tokens_details.cached_tokens`**:OpenAI 标准里的「命中缓存数」。DeepSeek 两套都给,数值相同。别的厂商多半只有这一套。
- **`completion_tokens_details.reasoning_tokens`**:输出里花在推理上的部分。上面第三组实跑就是 40 个里 40 个都是推理。关思考时 DeepSeek 不返回 `completion_tokens_details`,SDK 里就是 `None`。

把关系写成两个等式,记住它们,Day 124 写算钱的代码就是照着它来的:

```text
prompt_tokens     = prompt_cache_hit_tokens + prompt_cache_miss_tokens
completion_tokens = 正文 token + reasoning_tokens
```

还有一个事实值得知道:`prompt_tokens` 比你的文字本身多几个。[Day 108](/blog/agent-zero/day-108-tokens-2/) 用本地分词器数过,一句话本地数 16 个,API 收 20 个,多出来的是「这是用户说的话」这类格式标记。那天说过,等你有了 key 自己再验一遍,练习 1 就是干这个的。

### SDK 对象和字典,别混着用

SDK 返回的 `resp` 是一个对象,原始 JSON 解析出来的 `data` 是一个字典。前端同学写 JS 时两者没区别,`resp.choices` 和 `resp["choices"]` 都行;Python 里不行。我把三种常见的写错各跑了一次,新建 `part02/wrong_access.py`:

```python
# agent-zero-lab/part02/wrong_access.py
import os
import sys

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
resp = client.chat.completions.create(
    model=os.environ["LLM_MODEL"],
    messages=[{"role": "user", "content": "只回复 OK"}],
    extra_body={"thinking": {"type": "disabled"}},
)
case = sys.argv[1]
if case == "bracket":
    print(resp["choices"])  # pyright: ignore[reportIndexIssue]
elif case == "nolist":
    print(resp.choices.message.content)  # pyright: ignore[reportAttributeAccessIssue]
elif case == "extra":
    print(resp.usage.prompt_cache_hit_tokens)  # pyright: ignore[reportOptionalMemberAccess, reportAttributeAccessIssue]
elif case == "dump":
    d = resp.model_dump()
    print(type(d).__name__, list(d.keys()))
    print(d["choices"][0]["message"]["content"], d["usage"]["prompt_cache_miss_tokens"])
```

<div class="line-notes">

- `case = sys.argv[1]` 和 Day 121 的 `bad_params.py` 一样,命令行参数选要试哪一种。
- `print(resp["choices"])  # pyright: ignore[reportIndexIssue]` 用方括号从**对象**里取值。行尾注释让编辑器别画红线,因为我们是故意的。
- `print(resp.choices.message.content)  # pyright: ignore[reportAttributeAccessIssue]` 忘了 `[0]`。`choices` 是列表,列表没有 `.message`。
- `print(resp.usage.prompt_cache_hit_tokens)  # pyright: ignore[reportOptionalMemberAccess, reportAttributeAccessIssue]` 直接用点号取 DeepSeek 自己加的字段。编辑器会画两条红线:`usage` 可能是 `None`,以及类型里没有这个属性。
- `d = resp.model_dump()` 把 SDK 对象整个转回普通字典。`model_dump` 是 [Day 52](/blog/agent-zero/day-052-pydantic-2/) 学的 pydantic 方法,SDK 的响应对象就是 [Day 51](/blog/agent-zero/day-051-pydantic-1/) 讲的 pydantic 模型。
- `print(type(d).__name__, list(d.keys()))` 看看转出来的字典有哪些键。
- `print(d["choices"][0]["message"]["content"], d["usage"]["prompt_cache_miss_tokens"])` 字典就要用方括号一路取下去。

</div>

```bash
uv run part02/wrong_access.py bracket
uv run part02/wrong_access.py nolist
uv run part02/wrong_access.py extra
uv run part02/wrong_access.py dump
```

实跑输出(前两个只取最后一行):

```text
TypeError: 'ChatCompletion' object is not subscriptable
AttributeError: 'list' object has no attribute 'message'
0
dict ['id', 'choices', 'created', 'model', 'object', 'metadata', 'moderation', 'service_tier', 'system_fingerprint', 'usage']
OK 7
```

第一个,`not subscriptable` 的意思是「这个东西不能用方括号取」。SDK 对象只能用点号。

第二个,忘了 `[0]`,报「列表没有 `message` 属性」。看到 `'list' object has no attribute` 这种报错,先想想是不是少取了一层下标。

第三个最有意思:编辑器画了红线,可运行起来**没报错**,打印出 `0`。原因是 SDK 的对象会把不认识的字段也收下来,运行时能用点号取到;但类型标注里没有它,编辑器不知道它存在。这种写法能跑,但编辑器一直红着,而且换一家没有这个字段的厂商就会 `AttributeError`。正经的取法是 `read_fields.py` 里那样从 `usage.model_extra` 这个字典里 `.get`,下面 `ask2.py` 就这么写。

第四个,`model_dump()` 转出来的字典里多了 `metadata`、`moderation`、`service_tier` 三个键,原始 JSON 里根本没有。这是 SDK 的类型里定义了这些字段,服务器没给,SDK 就填 `None`。所以想看「服务器到底返回了什么」,看 `with_raw_response` 拿到的原文,别看 `model_dump()`。

对照记一下:

| 想做的事 | SDK 对象 `resp` | 字典 `data` |
| --- | --- | --- |
| 取回答 | `resp.choices[0].message.content` | `data["choices"][0]["message"]["content"]` |
| 取 DeepSeek 的缓存命中数 | `resp.usage.model_extra.get("prompt_cache_hit_tokens")` | `data["usage"]["prompt_cache_hit_tokens"]` |
| 两者互转 | `resp.model_dump()` 变字典 | `ChatCompletion.model_validate(data)` 变对象 |
| JS 里相当于 | 带类型的 class 实例 | `JSON.parse` 出来的普通对象 |

## 拼起来:会检查 finish_reason 的 ask2.py

把今天学的拼进 Day 120 的 `ask.py`:打印一行账单,`finish_reason` 不是 `stop` 就报错退出。新建 `part02/ask2.py`(`ask.py` 不动,留着对照):

```python
# agent-zero-lab/part02/ask2.py
import os
import sys

from dotenv import load_dotenv
from openai import OpenAI
from openai.types.chat import ChatCompletion

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])


class IncompleteAnswer(Exception):
    pass


def read_answer(resp: ChatCompletion) -> str:
    choice = resp.choices[0]
    if choice.finish_reason != "stop":
        raise IncompleteAnswer(f"模型没说完:finish_reason={choice.finish_reason}")
    return choice.message.content or ""


def usage_line(resp: ChatCompletion) -> str:
    u = resp.usage
    if u is None:
        return "没有 usage"
    extra = u.model_extra or {}
    hit = extra.get("prompt_cache_hit_tokens", 0)
    return f"输入 {u.prompt_tokens}(命中缓存 {hit})/ 输出 {u.completion_tokens} / 合计 {u.total_tokens}"


question = sys.argv[1] if len(sys.argv) > 1 else "用一句话介绍你自己"
limit = int(sys.argv[2]) if len(sys.argv) > 2 else 500

resp = client.chat.completions.create(
    model=os.environ["LLM_MODEL"],
    messages=[{"role": "user", "content": question}],
    max_tokens=limit,
    extra_body={"thinking": {"type": "disabled"}},
)
print(usage_line(resp))
try:
    print(read_answer(resp))
except IncompleteAnswer as e:
    print("出错了:", e)
    print("半截内容:", repr(resp.choices[0].message.content))
    sys.exit(1)
```

<div class="line-notes">

- `from openai.types.chat import ChatCompletion` 响应对象的类型,给下面两个函数的参数标注用。
- `class IncompleteAnswer(Exception):` 自定义一个异常类型,名字说清楚是什么错。[Day 36](/blog/agent-zero/day-036-exceptions-2/) 学过,继承 `Exception` 就行,类体里只写 `pass`。
- `def read_answer(resp: ChatCompletion) -> str:` 从响应里取回答,但先检查。参数标了类型,编辑器能补全 `resp.choices`。
- `if choice.finish_reason != "stop":` 今天的核心规矩。以后有了工具调用,`tool_calls` 也是正常情况,到时候再放宽。
- `raise IncompleteAnswer(f"模型没说完:finish_reason={choice.finish_reason}")` 把原因写进报错信息,日志里一看就懂。
- `return choice.message.content or ""` SDK 的类型里 `content` 可能是 `None`(比如模型只调用工具、不说话),`or ""` 保证返回的一定是字符串,编辑器也不会画红线。
- `extra = u.model_extra or {}` SDK 不认识的字段都在 `model_extra` 里。它的类型可能是 `None`,`or {}` 换成空字典。
- `hit = extra.get("prompt_cache_hit_tokens", 0)` 字典的 `.get(键, 默认值)`:有就取,没有给 0。换到没有这个字段的厂商也不会报错。
- `limit = int(sys.argv[2]) if len(sys.argv) > 2 else 500` 第二个命令行参数是 `max_tokens`,方便演示截断。命令行传进来的都是字符串,要 `int(...)` 转成整数。
- `print(usage_line(resp))` 先打印账单,截断也要知道花了多少。
- `except IncompleteAnswer as e:` 只接住我们自己的这种错,别的错照常抛出来。
- `print("半截内容:", repr(resp.choices[0].message.content))` 截断时把半截内容也打出来,方便判断要把上限加到多少。
- `sys.exit(1)` 以非 0 状态码退出。[Day 44](/blog/agent-zero/day-044-notebook-project/) 讲过,别的程序或脚本靠退出码判断成功还是失败。

</div>

```bash
uv run part02/ask2.py "发票抬头开错了能改吗?请用两句话回答。"
echo "exit=$?"
uv run part02/ask2.py "写一段 300 字的云簿 CloudLedger 产品介绍" 30
echo "exit=$?"
```

实跑输出:

```text
输入 18(命中缓存 0)/ 输出 55 / 合计 73
发票抬头开错可以修改，但需根据发票类型（纸质或电子）及是否已认证/跨月等情况，按规定流程作废或开具红字发票后重开。建议及时联系开票方按要求处理，避免影响报销或税务合规。
exit=0
输入 18(命中缓存 0)/ 输出 30 / 合计 48
出错了: 模型没说完:finish_reason=length
半截内容: '云簿 CloudLedger 是一款面向中小企业的智能云财务记账平台，致力于让财务管理像使用手机一样简单。产品打通银行流水、'
exit=1
```

第一次正常,退出码 0。第二次只给 30 个 token,写到「产品打通银行流水、」被截断,脚本没有假装成功,打印原因后以退出码 1 结束。

零件和 `ask2.py` 的对照:

| 今天的零件 | 在 `ask2.py` 的哪一段 |
| --- | --- |
| `read_fields.py` 用点号取 `choices[0]`、`finish_reason` | `read_answer` 里的 `choice = resp.choices[0]` 和 `if` 判断 |
| `finish_reasons.py` 看到 `length` 不报错、`content` 可能为空 | `raise IncompleteAnswer`,以及 `content or ""` |
| `read_fields.py` 的 `usage.model_extra` | `usage_line` 里的 `extra.get("prompt_cache_hit_tokens", 0)` |
| `wrong_access.py` 的 `extra` 分支(能跑但编辑器红) | 改成从 `model_extra` 字典 `.get`,不直接点属性 |

## 动手练习

**练习 1:和 Day 108 对账。** Day 108 留了一个作业:本地分词器数出来的 token,和 API 收的对不对得上。用 `data/deepseek_v4_tokenizer/tokenizer.json`(Day 107 下载的)数 Day 108 那句中文样本,再发给 API 只要 1 个输出 token,对比 `prompt_tokens`。再加上一条 system 消息试一次,看差值变不变。写 `part02/usage_vs_local.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/usage_vs_local.py
import os

from dotenv import load_dotenv
from openai import OpenAI
from openai.types.chat import ChatCompletionMessageParam
from tokenizers import Tokenizer

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
tok = Tokenizer.from_file("data/deepseek_v4_tokenizer/tokenizer.json")

SYSTEM = "你是云簿 CloudLedger 的客服助手,回答简洁。"
USER = "我的发票被重复扣款了，请帮我查一下是怎么回事，谢谢。"

for with_system in (False, True):
    messages: list[ChatCompletionMessageParam] = [{"role": "user", "content": USER}]
    local = len(tok.encode(USER).ids)
    if with_system:
        messages.insert(0, {"role": "system", "content": SYSTEM})
        local += len(tok.encode(SYSTEM).ids)
    resp = client.chat.completions.create(
        model=os.environ["LLM_MODEL"],
        messages=messages,
        max_tokens=1,
        extra_body={"thinking": {"type": "disabled"}},
    )
    api = resp.usage.prompt_tokens if resp.usage else -1
    print(f"带 system={with_system}: 本地 {local}, API {api}, 差 {api - local}")
```

<div class="line-notes">

- `from tokenizers import Tokenizer` Day 108 装过的分词库(`uv add tokenizers`)。
- `tok = Tokenizer.from_file("data/deepseek_v4_tokenizer/tokenizer.json")` 相对路径,在 `agent-zero-lab` 根目录跑。
- `USER = "我的发票被重复扣款了，请帮我查一下是怎么回事，谢谢。"` Day 108 的中文样本,一字不差(注意是全角逗号和句号)。
- `for with_system in (False, True):` 跑两次:第一次只有 user,第二次加上 system。
- `messages: list[ChatCompletionMessageParam] = [{"role": "user", "content": USER}]` 单独存消息列表要标类型,Day 121 讲过不标会画红线。
- `local = len(tok.encode(USER).ids)` 本地数 token。实跑 16,和 Day 108 一样。
- `messages.insert(0, {"role": "system", "content": SYSTEM})` 在列表最前面插入 system,相当于 JS 的 `unshift`。
- `local += len(tok.encode(SYSTEM).ids)` 加上 system 本身的 token,实跑合计 30。
- `max_tokens=1,` 只为了拿 `usage`,输出越少越省钱。
- `api = resp.usage.prompt_tokens if resp.usage else -1` API 收的输入 token。

</div>

```bash
uv run part02/usage_vs_local.py
```

实跑输出:

```text
带 system=False: 本地 16, API 20, 差 4
带 system=True: 本地 30, API 35, 差 5
```

只有 user 时差 4,和 Day 108 我替你跑的结果一样。加一条 system,差值只多了 1,不是再多 4。说明格式开销不是「每条消息固定 4 个」,而是开头有一段固定的标记,每多一条消息再加一点点。具体怎么拼,要看模型的对话模板,DeepSeek 下载包里的 `tokenizer_config.json` 有这个模板,有兴趣可以打开看看。结论很实用:**估算成本时,文字本身的 token 数是大头,格式开销每条只有几个**。

</details>

**练习 2:把响应存下来。** 写 `part02/save_responses.py`,问三个问题,每次把整个响应用 `model_dump_json()` 转成一行 JSON,追加到 `data/responses.jsonl`。三个问题分别是:正常的一句话问答(`max_tokens=300`,关思考);写 300 字产品介绍但只给 30 个 token(关思考);「年付 468 元的套餐用了 3 个月想退,按月折算该退多少?」(`max_tokens=2000`,开思考)。这个文件 Day 124 还要用。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/save_responses.py
import os
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
OUT = Path("data/responses.jsonl")

RUNS = [
    ("发票抬头开错了能改吗?一句话回答。", 300, "disabled"),
    ("写一段 300 字的云簿 CloudLedger 产品介绍", 30, "disabled"),
    ("年付 468 元的套餐用了 3 个月想退,按月折算该退多少?", 2000, "enabled"),
]

with OUT.open("a", encoding="utf-8") as f:
    for question, limit, thinking in RUNS:
        resp = client.chat.completions.create(
            model=os.environ["LLM_MODEL"],
            messages=[{"role": "user", "content": question}],
            max_tokens=limit,
            extra_body={"thinking": {"type": thinking}},
        )
        f.write(resp.model_dump_json() + "\n")
        print("存了一条:", resp.id, resp.choices[0].finish_reason)

print("文件里一共", len(OUT.read_text(encoding="utf-8").splitlines()), "行")
```

<div class="line-notes">

- `OUT = Path("data/responses.jsonl")` [Day 37](/blog/agent-zero/day-037-pathlib/) 的 `Path`。`.jsonl` 是「每行一个 JSON」的格式,追加写很方便,不用每次读出整个文件再写回去。
- `("年付 468 元的套餐用了 3 个月想退,按月折算该退多少?", 2000, "enabled"),` 第三个元素直接是 `thinking` 的 `type` 取值,下面拼进 `extra_body`。
- `with OUT.open("a", encoding="utf-8") as f:` `"a"` 是追加模式,文件不存在就新建,存在就接着往后写([Day 38](/blog/agent-zero/day-038-files-with/))。
- `f.write(resp.model_dump_json() + "\n")` `model_dump_json()` 把 SDK 对象直接转成一行 JSON 字符串,相当于 `JSON.stringify(resp)`。末尾自己加换行。
- `print("存了一条:", resp.id, resp.choices[0].finish_reason)` 打出编号和停止原因确认一下。
- `print("文件里一共", len(OUT.read_text(encoding="utf-8").splitlines()), "行")` 读回整个文件,按行切开数一数。多跑几次脚本行数会一直加。

</div>

```bash
uv run part02/save_responses.py
```

实跑输出:

```text
存了一条: 2476f5f6-a24f-4aa0-b9a3-084abe43dab2 stop
存了一条: b8acbd9d-4abb-48c4-9697-42594a96753c length
存了一条: 6d143a98-6e7a-46a6-bd0a-1d3a61ec9b87 stop
文件里一共 3 行
```

第三条开了思考,模型算出「应退 351 元」(468 ÷ 12 × 9)。打开文件看第一行开头:`{"id":"2476f5f6-...","choices":[{"finish_reason":"stop","index":0,"logprobs":null,"message":{"content":"...","refusal":null,"role":"assistant","annotations":null,"audio":null,"function_call":null,"tool_calls":null}}],...`。`message` 里多了一堆 `null`,又是 SDK 自己补的字段,原始 JSON 里没有。

</details>

**练习 3:不花钱地读回来。** 写 `part02/read_saved.py`,把练习 2 的文件一行行读出来,每行用 `ChatCompletion.model_validate_json` 变回 SDK 对象,打印编号前 8 位、`finish_reason`、输入(命中多少)、输出(其中推理多少)。整个脚本不调 API。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/read_saved.py
from pathlib import Path

from openai.types.chat import ChatCompletion

for line in Path("data/responses.jsonl").read_text(encoding="utf-8").splitlines():
    resp = ChatCompletion.model_validate_json(line)
    u = resp.usage
    if u is None:
        continue
    detail = u.completion_tokens_details
    reasoning = detail.reasoning_tokens if detail and detail.reasoning_tokens else 0
    extra = u.model_extra or {}
    print(
        f"{resp.id[:8]}  {resp.choices[0].finish_reason:<6}"
        f"  输入 {u.prompt_tokens:>3}(命中 {extra.get('prompt_cache_hit_tokens', 0)})"
        f"  输出 {u.completion_tokens:>4}(推理 {reasoning})"
    )
```

<div class="line-notes">

- `from openai.types.chat import ChatCompletion` 只导入类型,不建客户端,所以这个脚本不需要 `.env`,也不花钱。
- `resp = ChatCompletion.model_validate_json(line)` 把一行 JSON 字符串解析并校验成 SDK 对象,是 `model_dump_json` 的反方向([Day 52](/blog/agent-zero/day-052-pydantic-2/) 学过 `model_validate`)。之后就能用点号取值了。
- `if u is None:` 万一某行没有 `usage`,跳过。
- `reasoning = detail.reasoning_tokens if detail and detail.reasoning_tokens else 0` 关思考的那两条,存下来的 `completion_tokens_details` 是 `null`,读回来是 `None`,所以要判断两层。
- `extra = u.model_extra or {}` DeepSeek 的缓存字段存进文件时也保留了,读回来依然在 `model_extra` 里。
- `f"{resp.id[:8]}  {resp.choices[0].finish_reason:<6}"` `[:8]` 只取前 8 个字符;`:<6` 左对齐占 6 格,`stop` 和 `length` 能对齐。
- `f"  输入 {u.prompt_tokens:>3}` `:>3` 右对齐占 3 格。

</div>

```bash
uv run part02/read_saved.py
```

实跑输出:

```text
2476f5f6  stop    输入  15(命中 0)  输出   37(推理 0)
b8acbd9d  length  输入  18(命中 0)  输出   30(推理 0)
6d143a98  stop    输入  51(命中 0)  输出  275(推理 168)
```

第三条问题只有二十多个字,输入却是 51 个。开思考时服务端会在输入里加一段自己的内容,所以同一个问题开思考比关思考的输入多。输出 275 个里 168 个是推理,正文只占三分之一多一点。存一份响应到文件,以后排查、算钱、做评测都不用再花钱重跑,这是后面可观测那部分的雏形。

</details>

**练习 4:截断了就加额度。** 写 `part02/ask_grow.py`:问「写一段 200 字左右的云簿 CloudLedger 产品介绍」,`max_tokens` 从 50 开始,`finish_reason` 是 `length` 就翻倍再问一次,最多到 800。打印每次的上限、停止原因和输出 token,最后说一共付了多少输出 token 的钱。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/ask_grow.py
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])

question = "写一段 200 字左右的云簿 CloudLedger 产品介绍"
spent = 0
reason = None
for limit in (50, 100, 200, 400, 800):
    resp = client.chat.completions.create(
        model=os.environ["LLM_MODEL"],
        messages=[{"role": "user", "content": question}],
        max_tokens=limit,
        extra_body={"thinking": {"type": "disabled"}},
    )
    used = resp.usage.completion_tokens if resp.usage else 0
    spent += used
    reason = resp.choices[0].finish_reason
    print(f"max_tokens={limit:<4} finish_reason={reason:<6} 这次输出 {used}")
    if reason == "stop":
        break

if reason == "stop":
    print("说完了,一共付了", spent, "个输出 token 的钱")
else:
    print("加到 800 还没说完,放弃")
```

<div class="line-notes">

- `spent = 0` 累计付了多少输出 token。被截断的那几次,输出 token 也是要付钱的。
- `reason = None` 先给个初值,循环结束后要用它判断结果。
- `for limit in (50, 100, 200, 400, 800):` 直接把翻倍后的几个上限写成元组,比自己算翻倍简单。
- `spent += used` 每次的输出都加进去。
- `if reason == "stop":` 说完了就 `break` 跳出循环,不再加额度。
- `if reason == "stop":` 循环外再判断一次:是说完了跳出来的,还是五次都没说完。

</div>

```bash
uv run part02/ask_grow.py
```

实跑输出:

```text
max_tokens=50   finish_reason=length 这次输出 50
max_tokens=100  finish_reason=length 这次输出 100
max_tokens=200  finish_reason=stop   这次输出 112
说完了,一共付了 262 个输出 token 的钱
```

真正需要的只有 112 个,却付了 262 个,前两次的 150 个白花了。这个练习想说明的是:**`max_tokens` 设得太小,省不了钱,反而可能多花**。Day 121 讲过,设大了只按实际输出收费。所以平时把它设成「正常回答用不完、但能拦住模型失控狂写」的值,比如这类任务给 1000;而不是抠得很紧,再靠截断重试兜底。

</details>

**验收标准**:`show_response.py` 打出原始 JSON,你能指着每个字段说出含义;`finish_reasons.py` 三组都跑出来,能解释第三组为什么 `content` 是 `''`;`ask2.py` 在第二个参数给 30 时以退出码 1 结束;能写出 `prompt_tokens = hit + miss` 这个等式。

今天的花费:一共调用了 20 次左右。绝大多数输入不到 30 个 token、输出不到 120 个,开思考那次输入 51、输出 275。按高峰价最坏情况估:20 × (30 × 2 + 120 × 8) ÷ 1,000,000 ≈ 0.0204 元,再加思考那次 (51 × 2 + 275 × 8) ÷ 1,000,000 ≈ 0.0023 元。实际我是在晚上 11 点以后跑的,空闲价减半,大多数请求的输出也远不到 120,真实花费在 0.01 元上下。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| `with_raw_response` | openai SDK 的写法,`client.chat.completions.with_raw_response.create(...)` 返回原始 HTTP 响应,能看状态码、响应头、原始 JSON,再用 `.parse()` 变回平时的对象 |
| `ChatCompletion` | SDK 里「一次非流式对话补全响应」的类,是一个 pydantic 模型,用点号取值 |
| `id` | 这次回答的唯一编号,记进日志方便以后排查 |
| `object` | 响应类型,非流式固定是 `chat.completion` |
| `created` | 生成时间的 Unix 时间戳,单位秒(JS 的 `Date.now()` 是毫秒) |
| `system_fingerprint` | 服务端配置的指纹,变了说明厂商后端改过;有的厂商返回空字符串 |
| `choices` | 候选回答的列表,DeepSeek 只有一项,所以总是取 `[0]` |
| `message` | 一个候选里模型说的话,有 `role`(固定 `assistant`)和 `content`,开思考时 DeepSeek 多一个 `reasoning_content` |
| `finish_reason` | 模型为什么停下:`stop` 说完了,`length` 撞上限被截断,还有 `tool_calls`、`content_filter` 等 |
| `usage` | 本次用量账单:`prompt_tokens` 输入、`completion_tokens` 输出、`total_tokens` 合计 |
| `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` | DeepSeek 自有字段,输入里命中和没命中缓存的 token 数,两者之和等于 `prompt_tokens` |
| `cached_tokens` | OpenAI 标准里的缓存命中数,在 `prompt_tokens_details` 里 |
| `reasoning_tokens` | 输出里花在推理上的 token 数,在 `completion_tokens_details` 里,已经包含在 `completion_tokens` 中 |
| `model_extra` | pydantic 模型上装「类型里没定义的字段」的字典,DeepSeek 的缓存字段就在 `usage.model_extra` 里 |
| `model_dump()` / `model_dump_json()` | 把 SDK 对象转成字典 / JSON 字符串 |
| `model_validate_json()` | 把 JSON 字符串变回 SDK 对象 |
| `.jsonl` | 每行一个 JSON 的文本格式,适合一条条追加记录 |
| `not subscriptable` | Python 报错,意思是这个东西不能用方括号取值,常见于把对象当字典用 |

## 常见误区

**只看 `content`,不看 `finish_reason`。** 实测 `max_tokens=10` 时 `content` 是「发票抬头开错后,如果是当月开具且」,状态码 200,不报错。只有 `finish_reason` 是 `length` 告诉你它没说完。

**以为思考模式下 `max_tokens` 只管正文。** 实测开思考、`max_tokens=40`,40 个 token 全被推理用掉,`content` 是空字符串 `''`,`finish_reason` 是 `length`,钱照付。思考模式下这个上限管的是推理加正文的总和。

**把 SDK 对象当字典用。** `resp["choices"]` 报 `TypeError: 'ChatCompletion' object is not subscriptable`。SDK 对象用点号,`r.json()` 或 `model_dump()` 出来的字典才用方括号。

**忘了 `choices` 是列表。** `resp.choices.message` 报 `AttributeError: 'list' object has no attribute 'message'`,要写 `resp.choices[0].message`。

**直接用点号取厂商自己的字段。** `resp.usage.prompt_cache_hit_tokens` 运行能拿到 0,但编辑器一直画红线,换一家没有这个字段的厂商就 `AttributeError`。从 `usage.model_extra` 里 `.get(键, 默认值)`。

**用 `model_dump()` 看服务器返回了什么。** 实测转出来多了 `metadata`、`moderation`、`service_tier` 等原始 JSON 里没有的键,值都是 `None`,是 SDK 自己补的。想看原文用 `with_raw_response`。

**以为 `total_tokens` 可以直接拿来算钱。** 输入和输出单价差 4 倍,缓存命中和未命中差 50 倍。算钱要拆开算,Day 124 讲。

**以为 `max_tokens` 设小一点能省钱。** 实测从 50 翻倍到 200 才说完,付了 262 个输出 token,一次给够只要 112 个。只按实际输出计费,设大不亏。

## 学习资料

### 文档与文章

- [DeepSeek API:对话补全](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion):中文。昨天看的是上半部分「请求」,今天往下翻到「响应」,`finish_reason` 的六种取值和 `usage` 每个字段的定义都在这里。今天的取值表就是从这页整理的。
- [DeepSeek API:思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode):中文,`reasoning_content` 在响应里的位置、思考模式下 `max_tokens` 的默认值,和今天第三组实跑对照看。
- [openai-python README](https://github.com/openai/openai-python):英文,搜「with_raw_response」能看到官方对原始响应的说明;搜「model_dump」能看到响应对象是 pydantic 模型的说明。
- [pydantic 文档:序列化](https://docs.pydantic.dev/latest/concepts/serialization/):英文,`model_dump`、`model_dump_json` 的完整参数,比如 `exclude_none=True` 能去掉那些 SDK 补的 `null`。
- [OpenAI API Reference:The chat completion object](https://platform.openai.com/docs/api-reference/chat/object):英文,OpenAI 自己定义的响应字段,对比着看哪些是 DeepSeek 多出来的。这个站对命令行访问返回 403,需浏览器打开。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1kJPvzcEjV&autoplay=0&high_quality=1" title="手把手教你用30分钟学会Python调用大模型API" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>A1星球 · 手把手教你用 30 分钟学会 Python 调用大模型 API · 42 分钟,2026 年 3 月。从发请求讲到解析返回,看他怎么从响应里一层层取出回答,和今天的 `read_fields.py` 对照。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1P6NaeeEAN&autoplay=0&high_quality=1" title="DeepSeek API 的 Python 调用小白详细教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Java普惠学堂 · DeepSeek API 的 Python 调用小白详细教程 · 28 分钟,2025 年 2 月。视频里用的还是旧模型名,但打印响应、看 usage 的部分没变,适合零基础再过一遍。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/6F5IQJCDte4" title="Understanding Chat Completions API: Building Conversational AI with OpenAI" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Mathew K Analytics · Understanding Chat Completions API · 英文。讲 OpenAI 原版的请求和响应结构,看他讲 choices 和 usage 的那段,和 DeepSeek 的响应对比,能看出哪些字段是标准、哪些是 DeepSeek 自己加的。</figcaption>
</figure>

### 书籍

今天这组不需要。响应字段以厂商文档为准,书里的写法很快就过时。

### 开源项目与代码

- [openai/openai-python](https://github.com/openai/openai-python):`src/openai/types/chat/chat_completion.py` 是 `ChatCompletion` 的定义,不到 100 行,能看到 `finish_reason` 在类型里允许哪几个值(OpenAI 的标准里没有 DeepSeek 那两个);`src/openai/types/completion_usage.py` 是 `usage` 的定义。

## 自测

1. 一次调用返回 200,`content` 是空字符串,`finish_reason` 是 `length`,`completion_tokens` 等于你设的 `max_tokens`。最可能是什么情况?怎么修?

<details><summary>答案</summary>

开着思考模式,推理把 `max_tokens` 的额度全用光了,正文还没开始写。确认方法是看 `completion_tokens_details.reasoning_tokens` 是否等于 `completion_tokens`,或者看 `reasoning_content` 是不是有内容。修法二选一:不需要推理就关掉思考(`extra_body={"thinking": {"type": "disabled"}}`);需要推理就把 `max_tokens` 调大很多,给推理留足空间。

</details>

2. `usage` 里 `prompt_tokens=4073`、`prompt_cache_hit_tokens=3840`,`prompt_cache_miss_tokens` 应该是多少?`total_tokens` 能直接拿来算钱吗?

<details><summary>答案</summary>

233。DeepSeek 的 `prompt_tokens` 等于命中加未命中,4073 − 3840 = 233。`total_tokens` 不能直接算钱:它把输入和输出混在一起,而输入命中、输入未命中、输出三种单价差很多,要分开乘各自的单价。

</details>

3. 下面三行,哪行会报错,报什么错?`resp.choices[0].message.content`、`resp["choices"][0]`、`resp.choices.message`

<details><summary>答案</summary>

第一行正确。第二行报 `TypeError: 'ChatCompletion' object is not subscriptable`,SDK 对象不能用方括号。第三行报 `AttributeError: 'list' object has no attribute 'message'`,`choices` 是列表,要先 `[0]`。

</details>

4. 为什么建议把响应里的 `id`、`model`、`system_fingerprint` 记进日志?举一个用得上的场景。

<details><summary>答案</summary>

`id` 能把用户投诉的那一次回答和完整的请求、响应对上;`model` 是实际干活的模型,厂商会把旧名字路由到新版本(DeepSeek 的 `deepseek-v4-flash` 现在由新版本处理),代码里写的名字不一定是真实模型;`system_fingerprint` 变了说明厂商后端配置变了。场景:上周还稳定的输出这周突然变了,代码一行没改,查日志发现 `system_fingerprint` 换了值,就知道是厂商那边动了,而不是自己的 bug。

</details>

5. 面试题:「你们的 Agent 让模型输出 JSON 再解析,线上偶尔报 JSON 解析错误,本地怎么也复现不出来。你怎么排查?」

<details><summary>答案</summary>

第一怀疑对象是输出被截断。去日志里找出报错那几次的响应,看 `finish_reason`:是 `length` 就说明撞到了 `max_tokens`,JSON 只有半截。线上更容易出现,是因为线上的输入更长、更杂,模型输出也跟着变长;如果开着思考模式,推理长度波动很大,更容易把额度吃光。修法:每次调用先检查 `finish_reason`,不是 `stop` 就不解析,直接按「输出不完整」处理并记日志;把 `max_tokens` 设到正常输出用不完的程度;不需要推理的抽取任务关掉思考。如果日志里没记 `finish_reason` 和 `usage`,第一步先把它们加进日志,这本身就是这次事故最该改的地方。

</details>

## 明天预告

Day 123 · OpenAI 兼容协议:一份代码切换多家。今天你读的每一个字段,`choices`、`finish_reason`、`usage`,都是 OpenAI 定下的格式,DeepSeek 照着实现了,只是多加了几个自己的字段。很多厂商都这么做,所以同一份代码只换 `base_url`、key 和模型名,就能调另一家。明天把配置挪进环境变量,在 DeepSeek 和硅基流动之间来回切,顺便看看「兼容」到底兼容到什么程度:同一个模型,两家默认的思考开关就不一样。
