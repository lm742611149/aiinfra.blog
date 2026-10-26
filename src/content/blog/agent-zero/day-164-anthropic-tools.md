---
title: 'Day 164 · Anthropic 的写法,以及模型怎么学会调工具'
description: 'Anthropic 的工具调用和 OpenAI 兼容格式是同一件事的两种 JSON:没有 tool 角色,结果装在 user 消息的 tool_result 块里,参数是对象不是字符串。今天用 Anthropic 官方 SDK 对着 DeepSeek 的兼容端点真跑一遍,写双向互转函数并用 8 个测试钉住,再用 DeepSeek 官方的编码脚本把一段带工具的对话渲染成模型真正看到的纯文本:没有 tool 角色,tool_call_id 根本不在里面,一个工具定义占 372 个 token。最后讲清楚模型是怎么被训练成会写这段文字的。'
pubDate: 2026-10-27
regime: none
tags: ['function-calling', 'tool-use', 'anthropic', 'agent-zero']
series: 'agent-zero'
day: 164
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 163](/blog/agent-zero/day-163-tool-choice/) 讲了 `tool_choice`:`auto`、`none`、`required` 和指定函数,以及两个坑。一个是 `none` 之后模型会把想调的工具写成一段 `<｜DSML｜>` 标记文字漏进 `content`,不带 `tools` 也一样;另一个是思考模式开着时 `required` 和指定函数直接 400。那天结尾留了一个问题:这段标记文字到底是什么?为什么服务端能把它变成整齐的 `tool_calls`?

今天回答它,分两半。前半把视线移到另一家:Anthropic 的 Messages API 里同样的事怎么写,字段名和放的位置全不一样,但骨架一模一样。后半往下钻一层:不管你发的是哪家的 JSON,到了模型那里都变成一整段文字,今天把这段文字原样打印出来看。看完你会明白 Day 156 那句「模型不会执行,它只写一段 JSON」更精确的版本应该是「模型只续写一段文字」。

## 今天要解决的问题

学完今天你应该能做到:

1. 说出 Anthropic 格式和 OpenAI 兼容格式在工具调用上的五处差别(工具定义、请求、结果、结束信号、强制调用),并写出两边互转的函数。
2. 用 Anthropic 官方 SDK 跑通一次带并行工具的两轮调用,知道 `tool_result` 必须放在哪、放错了会收到什么报错。
3. 看懂 DeepSeek 官方编码脚本渲染出来的「模型视角」:工具定义放在哪、调用长什么样、结果怎么回来、`tool_call_id` 去哪了;并用这个解释工具定义为什么花钱、`none` 为什么会漏标记。

今天的两个新概念:**Anthropic 的内容块格式**(`tool_use` / `tool_result`)和**对话模板**(chat template,把 JSON 消息编码成一段文字的规则)。

预计用时:2.5 小时,实跑花费约 ¥0.03(算式在文末)。前置:[Day 158](/blog/agent-zero/day-158-fc-first-run/)(`weather_api.py`、`tool_runner.py` 里的 `execute_call`)、[Day 159](/blog/agent-zero/day-159-tool-roundtrip/)(tool 消息和 `tool_call_id`)、[Day 162](/blog/agent-zero/day-162-parallel-tools/)(一次多个请求)、[Day 163](/blog/agent-zero/day-163-tool-choice/)(`tool_choice`、思考模式限制、漏出的 DSML)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `format_convert.py` 里的 `messages_to_anthropic`(system 抽出来、assistant 变块、连续的 tool 合并成一条 user);再做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

今天要说清楚两件事。第一,**Anthropic 这一半我用官方 SDK 对着 DeepSeek 的 Anthropic 兼容端点跑**,因为我手里没有 Anthropic 官方的 key。所以报错和行为是兼容端点的,不是 `api.anthropic.com` 的;凡是只来自官方文档、我没有实跑的地方,我都会写明「官方文档说」。第二,对话模板那一半用的是 DeepSeek 在 Hugging Face 上公开的 V4-Flash 官方编码脚本。API 现在的 `deepseek-flash` 由 V4.1-Flash-1017 提供(定价页 2026 年 10 月的原话),和这个公开版本不一定逐字节一致,后面会撞上一个小差别。

今天的实验边界和前几天一样:只查 Open-Meteo 天气,不读写文件,不执行模型给的任何字符串。

## 第一步:Anthropic 的写法长什么样

先把五处差别放在一张表里,下面每一处都会在真实输出里对上。表里 OpenAI 一栏是你前面九天写的,Anthropic 一栏来自官方文档(2026 年 10 月查,链接在文末):

| 环节 | OpenAI 兼容格式 | Anthropic Messages API |
| --- | --- | --- |
| 定义工具 | `{"type": "function", "function": {"name", "description", "parameters"}}` | `{"name", "description", "input_schema"}`,少一层包装,`parameters` 改名 |
| system 提示 | `messages` 里 `role: "system"` 的一条 | `create()` 的单独参数 `system=`,`messages` 里没有 system |
| 模型请求调用 | `message.tool_calls[]`,参数在 `function.arguments`,是**字符串** | `content` 块列表里的 `{"type": "tool_use", "id", "name", "input"}`,`input` 已经是**对象** |
| 结束信号 | `finish_reason == "tool_calls"` | `stop_reason == "tool_use"` |
| 回传结果 | 每个结果一条 `role: "tool"` 消息,带 `tool_call_id` | **一条 `role: "user"` 消息**,`content` 里放 `{"type": "tool_result", "tool_use_id", "content"}` 块,有几个请求放几块 |
| 强制调用 | `tool_choice: "required"` / 指定函数 | `tool_choice: {"type": "any"}` / `{"type": "tool", "name": ...}` |

最大的观念差别在第五行。OpenAI 给工具结果单独开了一个角色 `tool`;Anthropic 没有这个角色,官方文档的大意是:不像有些 API 把工具单独拆出来、或者用 `tool`、`function` 这种特殊角色,Claude API 把工具直接融进 `user` 和 `assistant` 消息的结构里:消息的 `content` 是块的数组,`user` 消息里装客户端的内容和 `tool_result`,`assistant` 消息里装模型生成的内容和 `tool_use`。你可以把它想成 React 里的 children:一条消息不是一个字符串,而是一串带 `type` 的节点。

先看真实的。DeepSeek 提供了 Anthropic 兼容端点(`https://api.deepseek.com/anthropic`,文档 2026 年 10 月查),可以直接用 Anthropic 官方 SDK 连。装一个包:

```bash
cd ~/agent-zero-lab
uv add anthropic
```

新建 `part03/anthropic_run.py`,把 Day 162 那个「北京和上海各多少度」用 Anthropic 的写法跑完两轮:

```python
# agent-zero-lab/part03/anthropic_run.py
"""用 Anthropic 官方 SDK 的写法,对着 DeepSeek 的 Anthropic 兼容端点跑一遍天气查询(完整两轮)。"""
import json
import os
from typing import Any, cast

import anthropic
from dotenv import load_dotenv

from part03.weather_api import WeatherError, get_weather

load_dotenv()
client = anthropic.Anthropic(
    base_url="https://api.deepseek.com/anthropic",  # 兼容端点,不是 api.anthropic.com
    api_key=os.environ["LLM_API_KEY"],  # 这里放的是 DeepSeek 的 key
)
MODEL = os.environ["LLM_MODEL"]  # deepseek-flash

TOOLS: list[Any] = [
    {
        "name": "get_weather",  # 少一层 {"type": "function", "function": ...}
        "description": "查询一个城市当前的天气(温度、天气状况、风速)。用户问到天气、气温时使用。",
        "input_schema": {  # 相当于 OpenAI 的 parameters
            "type": "object",
            "properties": {"city": {"type": "string", "description": "城市名,例如 北京、Shanghai"}},
            "required": ["city"],
        },
    }
]

messages: list[Any] = [{"role": "user", "content": "北京和上海现在各多少度?"}]
resp = client.messages.create(
    model=MODEL,
    max_tokens=1024,
    system="你是云簿 CloudLedger 的客服助手。回答简短。",  # system 是单独的参数
    tools=TOOLS,
    messages=messages,
)
print("stop_reason:", resp.stop_reason, "| 用量:", resp.usage.input_tokens, "输入 /", resp.usage.output_tokens, "输出")
for block in resp.content:
    print("  块:", block.type, block.model_dump(exclude_none=True) if block.type != "text" else repr(block.text))

# 把整个 assistant 的 content 原样放回,再把所有结果放进「同一条」user 消息
messages.append({"role": "assistant", "content": [b.model_dump(exclude_none=True) for b in resp.content]})
results: list[Any] = []
for block in resp.content:
    if block.type == "tool_use":
        args = cast(dict[str, Any], block.input)  # SDK 把 input 标成 object,告诉类型检查器它其实是 dict
        try:
            out = json.dumps(get_weather(**args), ensure_ascii=False)  # 已经是 dict,不用 json.loads
            results.append({"type": "tool_result", "tool_use_id": block.id, "content": out})
        except WeatherError as e:  # 查失败也要回一块 tool_result,用 is_error 标出来
            results.append({"type": "tool_result", "tool_use_id": block.id, "content": f"错误:{e}", "is_error": True})
messages.append({"role": "user", "content": results})
final = client.messages.create(
    model=MODEL, max_tokens=1024, system="你是云簿 CloudLedger 的客服助手。回答简短。", tools=TOOLS, messages=messages
)
print("stop_reason:", final.stop_reason)
print("回答:", final.content[-1].text if final.content[-1].type == "text" else final.content)
print("用量:", final.usage.input_tokens, "输入 /", final.usage.output_tokens, "输出")
print("第二次请求的 user 消息 content 块数:", len(messages[-1]["content"]), [r["type"] for r in messages[-1]["content"]])
```

<div class="line-notes">

- `from typing import Any, cast` `cast` 等一下用,它不改变任何值,只是告诉类型检查器「相信我,这个东西是这个类型」。
- `import anthropic` Anthropic 官方 Python SDK,和 `openai` 是两个独立的包。
- `from part03.weather_api import WeatherError, get_weather` Day 158 的真函数和它的异常,这次多导入了异常,工具查失败时要用。
- `base_url="https://api.deepseek.com/anthropic",  # 兼容端点,不是 api.anthropic.com` 整个脚本唯一和「真 Anthropic」不同的地方。换成官方只需要删掉这一行、换 key、换模型名。
- `api_key=os.environ["LLM_API_KEY"],  # 这里放的是 DeepSeek 的 key` 复用 `.env` 里已经有的 key,不用新注册。
- `MODEL = os.environ["LLM_MODEL"]  # deepseek-flash` 兼容端点接受 `deepseek-flash`;文档还说以 `claude-sonnet`/`claude-haiku` 开头的名字会被映射到它。
- `"name": "get_weather",  # 少一层 {"type": "function", "function": ...}` 工具定义直接是 `name`、`description`、`input_schema` 三个字段。
- `"input_schema": {  # 相当于 OpenAI 的 parameters` 里面的 JSON Schema 和 Day 157 的 `parameters` 一字不差,只是换了个 key。
- `messages: list[Any] = [{"role": "user", "content": "北京和上海现在各多少度?"}]` 历史里没有 system 消息。
- `max_tokens=1024,` Anthropic 的 `max_tokens` 是必填项,不传就报错;OpenAI 那边可以不传。
- `system="你是云簿 CloudLedger 的客服助手。回答简短。",  # system 是单独的参数` system 提示是 `create()` 的一个关键字参数,不在 `messages` 里。
- `print("stop_reason:", resp.stop_reason,` 第一轮实测 `tool_use`,对应 OpenAI 的 `finish_reason == "tool_calls"`;用量 212 输入、88 输出。
- `for block in resp.content:` `resp.content` 是块列表。实测三块:一块 `thinking`,两块 `tool_use`。
- `print("  块:", block.type,` `thinking` 块是这个端点默认开着思考带来的:有 `thinking` 文字和一个 `signature`;两个 `tool_use` 块的 `input` 直接是 `{'city': '北京'}`、`{'city': 'Shanghai'}`,是字典,不用 `json.loads`。
- `messages.append({"role": "assistant", "content": [b.model_dump(exclude_none=True) for b in resp.content]})` 把模型这一轮的全部块原样放回,**包括 thinking 块**(后面马上会看到不放会怎样)。`model_dump(exclude_none=True)` 把 SDK 对象变回字典。
- `for block in resp.content:` 第二次遍历,只处理 `tool_use`。
- `args = cast(dict[str, Any], block.input)` SDK 把 `input` 标成 `object`,直接 `**` 展开类型检查器会报红线;`cast` 一下就好,运行时没有任何区别。
- `out = json.dumps(get_weather(**args), ensure_ascii=False)` `get_weather(**args)` 就是 `get_weather(city='北京')`;结果转成 JSON 字符串。
- `results.append({"type": "tool_result", "tool_use_id": block.id, "content": out})` 一个请求一块结果,`tool_use_id` 抄请求的 `id`(实测形如 `call_00_MGJ7…`),对应 OpenAI 的 `tool_call_id`。
- `except WeatherError as e:  # 查失败也要回一块 tool_result,用 is_error 标出来` 我第一次跑这个脚本时 Open-Meteo 超时了,没接异常,脚本直接崩在这里。失败的请求也得回一块,不然就是 Day 161 的缺失。
- `"content": f"错误:{e}", "is_error": True` Anthropic 专门给了 `is_error` 字段,官方文档说设成 `true` 表示工具执行出错。DeepSeek 兼容端点的文档写的是「`is_error` 被忽略」,所以在这里它只是写给人看的标记,真正让模型明白出错的是 `content` 里那句人话。
- `messages.append({"role": "user", "content": results})` **所有结果放进同一条 user 消息**。实测两个请求,这一条 `content` 里有两块。
- `final = client.messages.create(` 第二次请求,带着完整历史。
- `print("stop_reason:", final.stop_reason)` 第二轮实测 `end_turn`(OpenAI 的 `stop`)。
- `print("第二次请求的 user 消息 content 块数:"` 实测 `2 ['tool_result', 'tool_result']`。

</div>

```bash
uv run python -m part03.anthropic_run
```

```text
stop_reason: tool_use | 用量: 212 输入 / 88 输出
  块: thinking {'signature': '5d94aa77-609a-4760-9247-2284563fdb8b', 'thinking': 'The user asks for both Beijing and Shanghai temperatures. Independent calls — make both in same block.', 'type': 'thinking'}
  块: tool_use {'id': 'call_00_MGJ75EydkJiGRgVvJpEz3721', 'input': {'city': '北京'}, 'name': 'get_weather', 'type': 'tool_use'}
  块: tool_use {'id': 'call_01_OzD7dCo0HBwvRl9vSCBp4523', 'input': {'city': 'Shanghai'}, 'name': 'get_weather', 'type': 'tool_use'}
stop_reason: end_turn
回答: 当前温度：

- **北京**：6.4°C，晴，风速 9.1 km/h
- **上海**：17.4°C，多云，风速 8.9 km/h

上海比北京暖约 11°C。需要了解其他城市或其他信息吗？
用量: 150 输入 / 64 输出
第二次请求的 user 消息 content 块数: 2 ['tool_result', 'tool_result']
```

逐行读输出。`stop_reason: tool_use`,三个块:一个 `thinking`,两个 `tool_use`。每个 `tool_use` 带 `id`、`name`、`input`,`input` 是 `{'city': '北京'}` 这样的字典,和 Day 158 里你要自己 `json.loads(arguments)` 的字符串形成对比。这个差别看着小,但它背后是一个取舍:OpenAI 把参数当字符串传,模型吐出被截断的 JSON 时你自己得处理(Day 158 第六步);Anthropic 在服务端就把它解析好了,你拿到的一定是对象。两家都不保证对象符合 schema。

第二轮的回答和 OpenAI 那边没有区别,只是文字放在 `final.content` 的最后一个文字块里,而不是 `message.content`。用量也要从 `usage.input_tokens` / `usage.output_tokens` 取,字段名和 OpenAI 的 `prompt_tokens` / `completion_tokens` 不一样。

### 放错位置会怎样:三个文档说会 400 的写法

Anthropic 官方文档(handle-tool-calls 一页,2026 年 10 月查)对 `tool_result` 有两条硬要求:必须**紧跟**在对应的 `tool_use` 那条消息之后,中间不能插别的消息;而且在装结果的那条 user 消息里,`tool_result` 块必须排在最前面,文字只能放在它们后面。文档还给了一个会 400 的例子:文字放在 `tool_result` 前面。我没有官方 key,没法验证官方到底怎么报,但兼容端点是可以试的。新建 `part03/anthropic_order.py`:

```python
# agent-zero-lab/part03/anthropic_order.py
"""三个「官方文档说会 400」的写法,看 DeepSeek 的兼容端点怎么处理。"""
import os
from typing import Any

import anthropic
from dotenv import load_dotenv

load_dotenv()
client = anthropic.Anthropic(base_url="https://api.deepseek.com/anthropic", api_key=os.environ["LLM_API_KEY"])
TOOLS: list[Any] = [
    {
        "name": "get_weather",
        "description": "查询一个城市当前的天气。",
        "input_schema": {"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]},
    }
]
USE = {"type": "tool_use", "id": "toolu_demo_01", "name": "get_weather", "input": {"city": "北京"}}
RESULT = {"type": "tool_result", "tool_use_id": "toolu_demo_01", "content": '{"temperature": 6.4, "weather": "晴"}'}
BASE: list[Any] = [
    {"role": "user", "content": "北京现在多少度?"},
    {"role": "assistant", "content": [USE]},
]

CASES: dict[str, list[Any]] = {
    "A 正确:tool_result 在最前": [*BASE, {"role": "user", "content": [RESULT, {"type": "text", "text": "用一句话回答"}]}],
    "B 文字放在 tool_result 前面": [*BASE, {"role": "user", "content": [{"type": "text", "text": "结果如下:"}, RESULT]}],
    "C 漏回 tool_result": [*BASE, {"role": "user", "content": "算了,你直接说吧"}],
}
for name, msgs in CASES.items():
    try:
        r = client.messages.create(model=os.environ["LLM_MODEL"], max_tokens=300, tools=TOOLS, messages=msgs)
        texts = [b.text for b in r.content if b.type == "text"]
        print(f"{name:24} -> 200,stop_reason={r.stop_reason},回答:{(texts[0] if texts else '(无文字)')[:40]!r}")
    except anthropic.BadRequestError as e:
        print(f"{name:24} -> 400:{e.body['error']['message'] if isinstance(e.body, dict) else e.message}")
```

<div class="line-notes">

- `client = anthropic.Anthropic(base_url="https://api.deepseek.com/anthropic", api_key=os.environ["LLM_API_KEY"])` 同样连兼容端点。
- `"input_schema": {"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]},` 一个最小的工具定义,够触发调用就行。
- `USE = {"type": "tool_use", "id": "toolu_demo_01",` 我们**自己编**一个 `tool_use` 块放进历史,假装模型刚才请求了北京天气。`id` 是随便起的字符串,服务端只检查能不能对上。
- `RESULT = {"type": "tool_result", "tool_use_id": "toolu_demo_01",` 对应的结果块,`tool_use_id` 和上面的 `id` 一样。
- `BASE: list[Any] = [` 两条消息:用户提问、assistant 带着 `USE`。三种情况都在它后面接第三条。
- `"A 正确:tool_result 在最前":` 结果块在前,文字在后,官方推荐的形状。
- `"B 文字放在 tool_result 前面":` 文字在前,结果块在后,官方文档说这样会 400。
- `"C 漏回 tool_result":` 第三条 user 消息只有一句普通的话,根本没回结果,等价于 Day 161 的漏回。
- `except anthropic.BadRequestError as e:` 400 进这里。
- `print(f"{name:24} -> 400:{e.body['error']['message'] if isinstance(e.body, dict) else e.message}")` `e.body` 是服务端返回的 JSON,错误文字在 `error.message` 里。

</div>

```bash
uv run python -m part03.anthropic_order
```

```text
A 正确:tool_result 在最前     -> 200,stop_reason=end_turn,回答:'北京现在 6.4℃，天气晴。'
B 文字放在 tool_result 前面    -> 400:messages.2: `tool_use` ids were found without `tool_result` blocks immediately after: toolu_demo_01. Each `tool_use` block must have a corresponding `tool_result` block in the next message. (request_id: 41b58a2d-3a05-4860-acba-e993d2a21b18)
C 漏回 tool_result         -> 400:messages.2: `tool_use` ids were found without `tool_result` blocks immediately after: toolu_demo_01. Each `tool_use` block must have a corresponding `tool_result` block in the next message. (request_id: 166d0cca-eabf-4a99-95df-c96410e6a026)
```

A 正常。B 和 C 报了同一句话:`tool_use ids were found without tool_result blocks immediately after`,意思是「`toolu_demo_01` 这个请求,下一条消息里没有紧跟着它的 `tool_result`」。对 B 来说,结果块明明在,只是被一段文字挤到了第二位,服务端也判成没有。这句话和官方文档里「如果你收到这样的错误,检查 tool result 的格式」引用的原文一致。这个兼容端点对位置的要求和官方文档写的一样严。Day 161 在 OpenAI 兼容端点实测过,几个 tool 消息之间乱序是 200;这里不是乱序的问题,是一段文字挤到了结果前面,约束的是另一件事,但同样是「摆放位置不对就 400」。

还有一处细节:报错只说「缺 `tool_result`」,不告诉你其实是顺序问题。所以遇到这句话,先看结果块是不是排在了装结果那条消息的最前面,再看是不是真的漏了。

## 第二步:写两边互转的函数

面试官会问「OpenAI 和 Claude 的工具调用格式有什么区别」,做多厂商适配时你也要自己写这层。把上面的表翻译成纯函数,先不联网,用测试钉住。新建 `part03/format_convert.py`:

```python
# agent-zero-lab/part03/format_convert.py
"""OpenAI 兼容格式 <-> Anthropic Messages 格式的互转。纯函数,不联网。"""
import json
from typing import Any

FINISH_TO_STOP = {"stop": "end_turn", "tool_calls": "tool_use", "length": "max_tokens"}
STOP_TO_FINISH = {v: k for k, v in FINISH_TO_STOP.items()}


def tools_to_anthropic(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """去掉 {"type": "function", "function": ...} 那层包装,parameters 改名 input_schema。"""
    out = []
    for t in tools:
        fn = t["function"]
        out.append({"name": fn["name"], "description": fn.get("description", ""), "input_schema": fn["parameters"]})
    return out


def tools_to_openai(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {"type": "function", "function": {"name": t["name"], "description": t.get("description", ""), "parameters": t["input_schema"]}}
        for t in tools
    ]


def messages_to_anthropic(messages: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
    """返回 (system 文字, messages)。system 要单独传;连续的 tool 消息合并进同一条 user 消息。"""
    system_parts: list[str] = []
    out: list[dict[str, Any]] = []
    for m in messages:
        role = m["role"]
        if role == "system":
            system_parts.append(m["content"])
        elif role == "user":
            block = {"type": "text", "text": m["content"]}
            if out and out[-1]["role"] == "user":  # 紧跟在 tool_result 后面的文字,放在结果之后
                out[-1]["content"].append(block)
            else:
                out.append({"role": "user", "content": [block]})
        elif role == "assistant":
            blocks: list[dict[str, Any]] = []
            if m.get("content"):
                blocks.append({"type": "text", "text": m["content"]})
            for c in m.get("tool_calls") or []:
                try:
                    args = json.loads(c["function"]["arguments"] or "{}")
                except json.JSONDecodeError as e:
                    raise ValueError(f"arguments 不是合法 JSON,没法放进 input:{e.msg}") from e
                blocks.append({"type": "tool_use", "id": c["id"], "name": c["function"]["name"], "input": args})
            out.append({"role": "assistant", "content": blocks})
        elif role == "tool":
            result = {"type": "tool_result", "tool_use_id": m["tool_call_id"], "content": m["content"]}
            if out and out[-1]["role"] == "user" and all(b["type"] == "tool_result" for b in out[-1]["content"]):
                out[-1]["content"].append(result)
            else:
                out.append({"role": "user", "content": [result]})
        else:
            raise ValueError(f"不认识的角色:{role!r}")
    return "\n\n".join(system_parts), out


def anthropic_to_openai_message(content: list[dict[str, Any]]) -> dict[str, Any]:
    """Anthropic 的 assistant content 块列表 -> OpenAI 的 assistant 消息。thinking 块这里直接丢掉。"""
    text = "".join(b["text"] for b in content if b["type"] == "text")
    calls = [
        {"id": b["id"], "type": "function", "function": {"name": b["name"], "arguments": json.dumps(b["input"], ensure_ascii=False)}}
        for b in content
        if b["type"] == "tool_use"
    ]
    msg: dict[str, Any] = {"role": "assistant", "content": text}
    if calls:
        msg["tool_calls"] = calls
    return msg
```

<div class="line-notes">

- `FINISH_TO_STOP = {"stop": "end_turn", "tool_calls": "tool_use", "length": "max_tokens"}` 结束信号的对照:`finish_reason` 的三个常见值对应 `stop_reason`。
- `STOP_TO_FINISH = {v: k for k, v in FINISH_TO_STOP.items()}` 字典推导式把它反过来,`tool_use` 变回 `tool_calls`。
- `def tools_to_anthropic(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:` 工具定义,OpenAI 到 Anthropic。
- `fn = t["function"]` 剥掉外面那层 `{"type": "function", "function": ...}`。
- `out.append({"name": fn["name"], "description": fn.get("description", ""), "input_schema": fn["parameters"]})` 三个字段,`parameters` 原封不动换名 `input_schema`。对 Day 157 的 `WEATHER_TOOL` 来说,结果就是 `{"name": "get_weather", "description": "查询一个城市当前的天气…", "input_schema": {...}}`。
- `def tools_to_openai(` 反方向,把包装加回去。
- `def messages_to_anthropic(messages` 最长的一个:整段历史翻译。返回 `(system, messages)` 两样东西,因为 system 要单独传。
- `system_parts: list[str] = []` 可能有不止一条 system,先收集。
- `if role == "system":` system 消息不进输出列表,只记下文字。
- `elif role == "user":` 普通用户消息变成一个 `text` 块。
- `if out and out[-1]["role"] == "user":  # 紧跟在 tool_result 后面的文字,放在结果之后` 如果上一条已经是 user(装着 `tool_result`),这条文字追加在它的块后面,正好符合「文字在结果后」的要求。
- `elif role == "assistant":` assistant 消息变成块列表。
- `if m.get("content"):` 有文字才生成 `text` 块;Day 159 说过带 `tool_calls` 时 `content` 常常是空字符串,空字符串不该变成一个空文字块。
- `for c in m.get("tool_calls") or []:` 每个请求变成一个 `tool_use` 块。
- `args = json.loads(c["function"]["arguments"] or "{}")` **字符串变对象**,这是两边最实质的一步转换。`or "{}"` 处理没有参数的工具(`arguments` 是空串)。
- `raise ValueError(f"arguments 不是合法 JSON,没法放进 input:{e.msg}") from e` 被截断的 JSON(Day 158 第六步)翻译不了,直接报错,不要偷偷塞一个空对象。
- `blocks.append({"type": "tool_use", "id": c["id"], "name": c["function"]["name"], "input": args})` `id` 原样带过去。
- `elif role == "tool":` 重点:每条 `tool` 消息变成一个 `tool_result` 块。
- `if out and out[-1]["role"] == "user" and all(b["type"] == "tool_result" for b in out[-1]["content"]):` 如果上一条已经是「全是结果块的 user 消息」,就把这个结果并进去,两条连续的 tool 消息于是合成一条 user。
- `out.append({"role": "user", "content": [result]})` 否则新开一条 user 消息。
- `return "\n\n".join(system_parts), out` 多条 system 用空行拼成一段。
- `def anthropic_to_openai_message(` 回程:模型的块列表变回 OpenAI 的 assistant 消息。
- `text = "".join(b["text"] for b in content if b["type"] == "text")` 所有文字块拼起来;`thinking` 块在这里被丢掉,这是一个有损转换,所以这个函数只适合「把回复翻成 OpenAI 格式存档」,不能拿它翻出来的结果再发回 Anthropic(下面会看到思考块必须带回去)。
- `"arguments": json.dumps(b["input"], ensure_ascii=False)` 对象变回字符串,`ensure_ascii=False` 保留中文。
- `if calls:` 没有请求就不要 `tool_calls` 这个 key,和 OpenAI 的习惯一致。

</div>

测试:

```python
import pytest

from part03.format_convert import (
    anthropic_to_openai_message,
    messages_to_anthropic,
    tools_to_anthropic,
    tools_to_openai,
)
from part03.weather_tool import WEATHER_TOOL

CALL_BJ = {"id": "c1", "type": "function", "function": {"name": "get_weather", "arguments": '{"city": "北京"}'}}
CALL_SH = {"id": "c2", "type": "function", "function": {"name": "get_weather", "arguments": '{"city": "上海"}'}}
OPENAI_CHAT = [
    {"role": "system", "content": "你是客服。"},
    {"role": "user", "content": "北京和上海几度?"},
    {"role": "assistant", "content": "我查一下。", "tool_calls": [CALL_BJ, CALL_SH]},
    {"role": "tool", "tool_call_id": "c1", "content": '{"temperature": 6.4}'},
    {"role": "tool", "tool_call_id": "c2", "content": '{"temperature": 17.2}'},
]


def test_tools_roundtrip() -> None:
    a = tools_to_anthropic([WEATHER_TOOL])
    assert set(a[0]) == {"name", "description", "input_schema"}
    assert a[0]["input_schema"] == WEATHER_TOOL["function"]["parameters"]
    assert tools_to_openai(a) == [WEATHER_TOOL]


def test_system_is_pulled_out() -> None:
    system, msgs = messages_to_anthropic(OPENAI_CHAT)
    assert system == "你是客服。"
    assert [m["role"] for m in msgs] == ["user", "assistant", "user"]


def test_assistant_becomes_text_plus_tool_use_with_dict_input() -> None:
    _, msgs = messages_to_anthropic(OPENAI_CHAT)
    blocks = msgs[1]["content"]
    assert [b["type"] for b in blocks] == ["text", "tool_use", "tool_use"]
    assert blocks[1] == {"type": "tool_use", "id": "c1", "name": "get_weather", "input": {"city": "北京"}}


def test_two_tool_messages_merge_into_one_user_message() -> None:
    _, msgs = messages_to_anthropic(OPENAI_CHAT)
    results = msgs[2]["content"]
    assert [b["type"] for b in results] == ["tool_result", "tool_result"]
    assert [b["tool_use_id"] for b in results] == ["c1", "c2"]


def test_user_text_after_results_goes_after_them() -> None:
    chat = [*OPENAI_CHAT, {"role": "user", "content": "用一句话说"}]
    _, msgs = messages_to_anthropic(chat)
    assert [b["type"] for b in msgs[2]["content"]] == ["tool_result", "tool_result", "text"]


def test_empty_content_has_no_text_block() -> None:
    chat = [{"role": "user", "content": "q"}, {"role": "assistant", "content": "", "tool_calls": [CALL_BJ]}]
    _, msgs = messages_to_anthropic(chat)
    assert [b["type"] for b in msgs[1]["content"]] == ["tool_use"]


def test_truncated_arguments_raise() -> None:
    bad = {"id": "c9", "type": "function", "function": {"name": "get_weather", "arguments": '{"city": "北'}}
    with pytest.raises(ValueError, match="不是合法 JSON"):
        messages_to_anthropic([{"role": "assistant", "content": "", "tool_calls": [bad]}])


def test_back_to_openai_message_drops_thinking() -> None:
    content = [
        {"type": "thinking", "thinking": "", "signature": "x"},
        {"type": "text", "text": "我查一下。"},
        {"type": "tool_use", "id": "c1", "name": "get_weather", "input": {"city": "北京"}},
    ]
    msg = anthropic_to_openai_message(content)
    assert msg == {"role": "assistant", "content": "我查一下。", "tool_calls": [CALL_BJ]}
```

<div class="line-notes">

- `from part03.weather_tool import WEATHER_TOOL` 用 Day 157 的真定义做输入。
- `CALL_BJ = {"id": "c1", "type": "function", "function": {"name": "get_weather", "arguments": '{"city": "北京"}'}}` 一个 OpenAI 格式的请求,`arguments` 是字符串。
- `OPENAI_CHAT = [` 一段完整历史:system、user、带两个请求的 assistant、两条 tool。
- `assert set(a[0]) == {"name", "description", "input_schema"}` 翻译后只剩三个 key。
- `assert tools_to_openai(a) == [WEATHER_TOOL]` 来回一圈等于原样,说明没丢信息。
- `assert system == "你是客服。"` system 被抽出来了。
- `assert [m["role"] for m in msgs] == ["user", "assistant", "user"]` 五条消息变三条:两条 tool 合进了最后的 user。
- `assert blocks[1] == {"type": "tool_use", "id": "c1", "name": "get_weather", "input": {"city": "北京"}}` `input` 是字典,不是字符串。
- `assert [b["tool_use_id"] for b in results] == ["c1", "c2"]` 两个结果的顺序和请求一致。
- `chat = [*OPENAI_CHAT, {"role": "user", "content": "用一句话说"}]` 在结果后面再追加一句用户的话。
- `assert [b["type"] for b in msgs[2]["content"]] == ["tool_result", "tool_result", "text"]` 文字排在两个结果后面,正好是官方要求的顺序。
- `chat = [{"role": "user", "content": "q"}, {"role": "assistant", "content": "", "tool_calls": [CALL_BJ]}]` 空 `content` 的 assistant。
- `assert [b["type"] for b in msgs[1]["content"]] == ["tool_use"]` 没有多出一个空文字块。
- `bad = {"id": "c9", "type": "function", "function": {"name": "get_weather", "arguments": '{"city": "北'}}` 被截断的参数。
- `with pytest.raises(ValueError, match="不是合法 JSON"):` 必须抛错,不能悄悄塞空对象。
- `{"type": "thinking", "thinking": "", "signature": "x"},` 一个思考块,和上面真实输出里的长相一样。
- `assert msg == {"role": "assistant", "content": "我查一下。", "tool_calls": [CALL_BJ]}` 翻回来:思考块被丢掉,文字保留,请求变回带字符串参数的形式。

</div>

```bash
uv run pytest -q tests/test_format_convert.py
```

```text
........                                                                 [100%]
8 passed in 0.02s
```

测试通过只说明函数自洽。它翻出来的东西 Anthropic 认不认,得真发一次。新建 `part03/convert_live.py`:用 OpenAI 这边的客户端问第一轮、执行工具、拼成 OpenAI 格式的历史,翻译成 Anthropic 格式,交给 Anthropic SDK 续写,再把回复翻回来。

```python
# agent-zero-lab/part03/convert_live.py
"""用 format_convert 把一段 OpenAI 格式的对话翻译给 Anthropic SDK 发出去,再把回复翻译回来。"""
import json
import os
from typing import Any

import anthropic
from dotenv import load_dotenv

from common.llm import LLMClient
from part03.format_convert import anthropic_to_openai_message, messages_to_anthropic, tools_to_anthropic
from part03.tool_runner import execute_call
from part03.weather_tool import WEATHER_TOOL

load_dotenv()
TOOLS = [WEATHER_TOOL]
llm = LLMClient(max_retries=0)  # OpenAI 兼容这一边
ant = anthropic.Anthropic(base_url="https://api.deepseek.com/anthropic", api_key=os.environ["LLM_API_KEY"])

# 1) OpenAI 这边问第一轮,拿到 tool_calls,执行,拼成 OpenAI 格式的完整历史
history: list[dict[str, Any]] = [
    {"role": "system", "content": "你是云簿 CloudLedger 的客服助手。回答简短。"},
    {"role": "user", "content": "北京和上海现在各多少度?"},
]
first = llm.chat(history, tools=TOOLS, temperature=0, max_tokens=300)
history.append({k: v for k, v in first.message.items() if k != "reasoning_content"})
for call in first.message.get("tool_calls") or []:
    history.append({"role": "tool", "tool_call_id": call["id"], "content": execute_call(call, TOOLS)})
print("OpenAI 格式历史的角色:", [m["role"] for m in history])

# 2) 翻译成 Anthropic 格式,交给 Anthropic SDK 去续写
system, msgs = messages_to_anthropic(history)
print("Anthropic 格式历史的角色:", [m["role"] for m in msgs], "| 最后一条的块:", [b["type"] for b in msgs[-1]["content"]])
r = ant.messages.create(model=os.environ["LLM_MODEL"], max_tokens=500, system=system, tools=tools_to_anthropic(TOOLS), messages=msgs, thinking={"type": "disabled"})  # type: ignore[arg-type]
print("Anthropic 这边的 stop_reason:", r.stop_reason)

# 3) 回复再翻译回 OpenAI 的 assistant 消息
back = anthropic_to_openai_message([b.model_dump(exclude_none=True) for b in r.content])
print(json.dumps(back, ensure_ascii=False)[:200])
print(llm.ledger)
```

<div class="line-notes">

- `from common.llm import LLMClient` Day 135 的客户端,OpenAI 兼容这一边。
- `from part03.format_convert import anthropic_to_openai_message, messages_to_anthropic, tools_to_anthropic` 刚写的三个函数。
- `llm = LLMClient(max_retries=0)  # OpenAI 兼容这一边` 不重试。
- `ant = anthropic.Anthropic(base_url=` Anthropic SDK 这一边,同一个 key。
- `first = llm.chat(history, tools=TOOLS, temperature=0, max_tokens=300)` 第一轮用 OpenAI 的写法问,拿到两个 `tool_calls`。
- `history.append({k: v for k, v in first.message.items() if k != "reasoning_content"})` 放回 assistant 消息,去掉 `reasoning_content`。这一步我故意的:`.env` 里思考是关的,这个字段本来就是空的或不存在,去掉它只是让历史是干净的纯 OpenAI 格式。
- `history.append({"role": "tool", "tool_call_id": call["id"], "content": execute_call(call, TOOLS)})` Day 158 的 `execute_call`,每个请求一条 tool 消息。
- `system, msgs = messages_to_anthropic(history)` 翻译。实测历史从 5 条(`system, user, assistant, tool, tool`)变成 3 条(`user, assistant, user`)。
- `r = ant.messages.create(model=os.environ["LLM_MODEL"], max_tokens=500, system=system, tools=tools_to_anthropic(TOOLS), messages=msgs, thinking={"type": "disabled"})` 注意最后那个 `thinking={"type": "disabled"}`:去掉它会 400,下面讲。
- `back = anthropic_to_openai_message([b.model_dump(exclude_none=True) for b in r.content])` 把 Anthropic 的回复翻回 OpenAI 的 assistant 消息。
- `print(llm.ledger)` 只有 OpenAI 这边那一次调用的账本,Anthropic SDK 没有走 `LLMClient`,不在里面。

</div>

```bash
uv run python -m part03.convert_live
```

```text
OpenAI 格式历史的角色: ['system', 'user', 'assistant', 'tool', 'tool']
Anthropic 格式历史的角色: ['user', 'assistant', 'user'] | 最后一条的块: ['tool_result', 'tool_result']
Anthropic 这边的 stop_reason: end_turn
{"role": "assistant", "content": "- 北京：6.4°C，晴，风速 9.1 km/h\n- 上海：17.4°C，多云，风速 8.9 km/h"}
1 次调用 | 输入 389 / 输出 67 tokens | 约 ¥0.0008
```

翻译有效:3 条消息的 Anthropic 历史被接受了,回答里北京 6.4°C、上海 17.4°C 和 OpenAI 那边查到的一致。

但我第一次跑的时候**没有**写 `thinking={"type": "disabled"}`,得到了这个 400:

```text
anthropic.BadRequestError: Error code: 400 - {'error': {'message': 'The `content[].thinking` in the thinking mode must be passed back to the API. (request_id: a18c4cff-db88-4263-b2ce-c3771c443b19)', 'type': 'invalid_request_error', 'param': None, 'code': 'invalid_request_error'}}
```

意思是:这个端点默认开着思考模式,开着思考时 assistant 那一轮必须带着它的 `thinking` 块回来。可我们的历史是 OpenAI 那边在思考关闭的状态下产生的,里面根本没有思考块,当然没得带。解法有两条:像上面那样显式关掉思考;或者整段对话从头到尾都走 Anthropic 这边,每一轮把 `resp.content` 整个放回去(第一个脚本就是这么做的,所以没出事)。这和 Day 163 第四步的 `reasoning_content` 是同一件事换了个名字:**思考内容是历史的一部分,不能随手丢**。顺手回答一个自然的疑问,`anthropic_to_openai_message` 为什么说「有损」:它丢掉了思考块,所以它的输出只能存档,不能再喂回开着思考的 Anthropic 接口。

### 兼容端点和官方文档不一定一回事

最后一个提醒,顺着 Day 163 的 `tool_choice`。DeepSeek 的兼容端点文档(2026 年 10 月查)写着:`tool_choice` 的 `none` 完全支持,`auto`、`any`、`tool` 「支持」,`disable_parallel_tool_use` 被忽略。这个「支持」到底多支持?练习 1 会写 `tool_choice` 的翻译函数并实测。先给你结论:在思考默认开着时,`tool` 报 400 `Thinking mode does not support this tool_choice`,和 Day 163 在 OpenAI 端点撞到的一模一样;思考关掉后 `tool` 能强制;而 **`any` 在两种状态下都没有强制**,问「你好,你是谁?」它照样直接回答。我又换成两个工具、关掉思考,问两遍「你好」再试,依然是纯文字,问「北京天气」才调工具。所以在这个端点上,`any` 的行为更像 `auto`。官方文档里 `any` 的意思是「必须用提供的工具之一」,换一个端点就未必成立。**兼容端点上「字段能传」和「语义一样」是两回事**,换端点要重新测。

官方文档本身也在变:我今天读到的 define-tools 一页写着,Claude Opus 5.5、Sonnet 5.5 等几个模型上 `any` 和 `tool` 会返回 400,建议改用 `auto` 加严格模式(strict tool use)或结构化输出;手动开启扩展思考时 `any` 和 `tool` 同样不支持。这和 Day 163 DeepSeek 的「思考模式不支持强制调用」是同一种取向:**强制调用和思考天生不太合得来**,两家都在往「让模型自己决定,但让输出严格符合 schema」的方向走。这一段只来自官方文档,我没有实跑。

## 第三步:模型真正看到的是一段文字

前面两步都是在 JSON 层面比来比去。现在往下钻一层。不管是 OpenAI 格式还是 Anthropic 格式,服务端收到以后做的事是一样的:按这个模型训练时用的**对话模板**(chat template),把整个 `messages` 和 `tools` 编码成**一段文字**,再切成 token 喂进去。模型从头到尾没见过 JSON 的 `role` 字段,它见到的是一段带特殊标记的文字,它做的事是接着往后写。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="两种 JSON 格式经过服务端的对话模板,变成同一段文字,再交给模型">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="30" width="170" height="70" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="105" y="54" text-anchor="middle" fill="var(--ink)">OpenAI 兼容 JSON</text>
<text x="105" y="74" text-anchor="middle" fill="var(--ink-soft)" font-size="11">tool_calls / role: tool</text>
<rect x="20" y="130" width="170" height="70" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="105" y="154" text-anchor="middle" fill="var(--ink)">Anthropic JSON</text>
<text x="105" y="174" text-anchor="middle" fill="var(--ink-soft)" font-size="11">tool_use / tool_result</text>
<rect x="250" y="70" width="140" height="90" rx="6" fill="none" stroke="var(--ink-soft)"/>
<text x="320" y="96" text-anchor="middle" fill="var(--ink)">服务端</text>
<text x="320" y="116" text-anchor="middle" fill="var(--ink-soft)" font-size="11">按对话模板</text>
<text x="320" y="134" text-anchor="middle" fill="var(--ink-soft)" font-size="11">拼成一段文字</text>
<rect x="450" y="40" width="170" height="150" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="535" y="64" text-anchor="middle" fill="var(--ink)">模型看到的</text>
<text x="462" y="90" fill="var(--ink-soft)" font-size="11">&lt;｜User｜&gt;…</text>
<text x="462" y="108" fill="var(--ink-soft)" font-size="11">&lt;｜DSML｜tool_calls&gt;…</text>
<text x="462" y="126" fill="var(--ink-soft)" font-size="11">&lt;tool_result&gt;…</text>
<text x="462" y="152" fill="var(--ink)" font-size="11">没有 tool 角色</text>
<text x="462" y="170" fill="var(--ink)" font-size="11">没有 tool_call_id</text>
<line x1="190" y1="65" x2="250" y2="105" stroke="var(--compute)" stroke-width="2"/>
<line x1="190" y1="165" x2="250" y2="125" stroke="var(--compute)" stroke-width="2"/>
<line x1="390" y1="115" x2="450" y2="115" stroke="var(--mem)" stroke-width="2"/>
<polygon points="450,115 440,110 440,120" fill="var(--mem)"/>
<text x="320" y="228" text-anchor="middle" fill="var(--ink-faint)" font-size="11">两种 JSON 只是你和服务端之间的写法</text>
</g>
</svg>
<figcaption>JSON 格式是给你写代码用的;到了模型那里,它们都变成同一种东西:一段带标记的文字。</figcaption>
</figure>

DeepSeek 在 Hugging Face 上公开了 V4-Flash 的官方编码脚本,MIT 许可证,文件叫 `encoding_dsv4.py`,还附了说明文档。把它和分词器下载下来(链接在文末;如果 `huggingface.co` 打不开,把域名换成 `hf-mirror.com`):

```bash
cd ~/agent-zero-lab
mkdir -p vendor/dsv4
curl -L -o vendor/dsv4/encoding_dsv4.py https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash/resolve/main/encoding/encoding_dsv4.py
curl -L -o vendor/dsv4/tokenizer.json https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash/resolve/main/tokenizer.json
uv add tokenizers
ls -la vendor/dsv4
```

`tokenizer.json` 约 6.4 MB,`encoding_dsv4.py` 约 28 KB。运行别人写的脚本之前先扫一眼是好习惯:这份 `encoding_dsv4.py` 只用了标准库的 `json`、`re`、`copy`,不联网、不读文件,就是一堆字符串拼接和解析函数。

新建 `part03/raw_view.py`,把 Day 162 那个「北京和上海」的对话渲染出来:

```python
# agent-zero-lab/part03/raw_view.py
"""把一段 OpenAI 格式的带工具对话,用 DeepSeek-V4 官方的编码脚本渲染成「模型真正看到的那一整段文字」。"""
from vendor.dsv4.encoding_dsv4 import encode_messages
from part03.weather_tool import WEATHER_TOOL

messages = [
    {"role": "system", "content": "你是云簿 CloudLedger 的客服助手。", "tools": [WEATHER_TOOL]},  # 工具挂在 system 消息上
    {"role": "user", "content": "北京和上海现在各多少度?"},
    {
        "role": "assistant",
        "content": "我查一下。",
        "tool_calls": [
            {"id": "c1", "type": "function", "function": {"name": "get_weather", "arguments": '{"city": "北京"}'}},
            {"id": "c2", "type": "function", "function": {"name": "get_weather", "arguments": '{"city": "上海"}'}},
        ],
    },
    {"role": "tool", "tool_call_id": "c1", "content": '{"temperature": 6.4, "weather": "晴"}'},
    {"role": "tool", "tool_call_id": "c2", "content": '{"temperature": 17.2, "weather": "多云"}'},
]
text = encode_messages(messages, thinking_mode="chat")
print(text)
```

<div class="line-notes">

- `from vendor.dsv4.encoding_dsv4 import encode_messages` 官方脚本的主函数。能这样导入,靠的是 `pyproject.toml` 里的 `pythonpath = ["."]`(Day 72 配的),`vendor` 目录不需要 `__init__.py`。
- `{"role": "system", "content": "你是云簿 CloudLedger 的客服助手。", "tools": [WEATHER_TOOL]},  # 工具挂在 system 消息上` 官方脚本约定:工具定义挂在 system(或 developer)消息的 `tools` 字段上,用的就是 OpenAI 格式的工具列表,不用我们转换。
- `{"role": "user", "content": "北京和上海现在各多少度?"},` 普通用户消息。
- `"content": "我查一下。",` assistant 先说了一句话,再提请求,和 Anthropic 文档里「`text` 块加 `tool_use` 块」是一个形状。
- `{"id": "c1", "type": "function", "function": {"name": "get_weather", "arguments": '{"city": "北京"}'}},` 两个请求,用 `c1`、`c2` 当 id。等会儿找找看这两个 id 在输出里出现没有。
- `{"role": "tool", "tool_call_id": "c1", "content": '{"temperature": 6.4, "weather": "晴"}'},` 两条 `tool` 消息,和我们平时发给 API 的一样。
- `text = encode_messages(messages, thinking_mode="chat")` 编码。`thinking_mode="chat"` 表示不开思考,对应 `.env` 里 `thinking disabled`。
- `print(text)` 直接打印,换行是真的换行。

</div>

```bash
uv run python -m part03.raw_view
```

```text
<｜begin▁of▁sentence｜>你是云簿 CloudLedger 的客服助手。

## Tools

You have access to a set of tools to help answer the user's question. You can invoke tools by writing a "<｜DSML｜tool_calls>" block like the following:

<｜DSML｜tool_calls>
<｜DSML｜invoke name="$TOOL_NAME">
<｜DSML｜parameter name="$PARAMETER_NAME" string="true|false">$PARAMETER_VALUE</｜DSML｜parameter>
...
</｜DSML｜invoke>
<｜DSML｜invoke name="$TOOL_NAME2">
...
</｜DSML｜invoke>
</｜DSML｜tool_calls>

String parameters should be specified as is and set `string="true"`. For all other types (numbers, booleans, arrays, objects), pass the value in JSON format and set `string="false"`.

If thinking_mode is enabled (triggered by <think>), you MUST output your complete reasoning inside <think>...</think> BEFORE any tool calls or final response.

Otherwise, output directly after </think> with tool calls or final response.

### Available Tool Schemas

{"name": "get_weather", "description": "查询一个城市当前的天气(温度、天气状况、风速)。用户问到天气、气温、冷不冷、要不要带伞、穿什么时使用。只能查当前,不能查预报。", "parameters": {"type": "object", "properties": {"city": {"type": "string", "description": "城市名,中文或英文都行,例如 北京、Shanghai。只填城市,不要带省、国家或「市」字。"}, "unit": {"type": "string", "enum": ["celsius", "fahrenheit"], "description": "温度单位。用户没有特别说明就用 celsius。"}}, "required": ["city"]}}

You MUST strictly follow the above defined tool name and parameter schemas to invoke tool calls.
<｜User｜>北京和上海现在各多少度?<｜Assistant｜></think>我查一下。

<｜DSML｜tool_calls>
<｜DSML｜invoke name="get_weather">
<｜DSML｜parameter name="city" string="true">北京</｜DSML｜parameter>
</｜DSML｜invoke>
<｜DSML｜invoke name="get_weather">
<｜DSML｜parameter name="city" string="true">上海</｜DSML｜parameter>
</｜DSML｜invoke>
</｜DSML｜tool_calls><｜end▁of▁sentence｜><｜User｜><tool_result>{"temperature": 6.4, "weather": "晴"}</tool_result>

<tool_result>{"temperature": 17.2, "weather": "多云"}</tool_result><｜Assistant｜></think>
```

这就是模型看到的全部,一个字不差。逐段读:

最开头 `<｜begin▁of▁sentence｜>` 是整段对话的起点标记,后面直接跟 system 文字。紧接着是官方脚本自动生成的 `## Tools` 一节:先用英文告诉模型「你可以写一个 `<｜DSML｜tool_calls>` 块来调用工具」,附一个格式示范,再把我们的 `WEATHER_TOOL` 压成一行 JSON 放在 `### Available Tool Schemas` 下面,最后一句警告「必须严格按这些名字和参数调用」。**你在 Day 157 花心思写的工具描述,就躺在这一行里,是 system 提示词的一部分。**所以描述写得好坏会直接影响选择,所以每次请求都会为它付费。

然后是 `<｜User｜>北京和上海现在各多少度?<｜Assistant｜></think>`:用户说完,轮到助手,`</think>` 紧跟着,表示「思考到此结束」(`chat` 模式是直接不思考)。助手的回合是 `我查一下。`,空一行,然后就是 DSML 块:`<｜DSML｜tool_calls>` 开头,每个请求一个 `invoke name="get_weather"`,里面一个个 `parameter name="city" string="true"`,值是 `北京`。`string="true"` 表示这个值按原样当字符串;数字、布尔、数组这些写 `string="false"`,值用 JSON。整个回合以 `<｜end▁of▁sentence｜>` 收尾。**这就是 Day 163 里漏出来的那一段**:`tool_choice="none"` 时服务端没有把它解析成 `tool_calls`,模型写出的就是这个。

最后一段最有意思:`<｜User｜><tool_result>…</tool_result>` 两个结果挨着放。**没有 tool 角色,结果装在一条 user 回合里,用 `<tool_result>` 标签包着。**这和 Anthropic 把结果放进 user 消息的 `tool_result` 块,骨架是一样的。换句话说,「OpenAI 的 tool 角色」在这个模型的真实输入里并不存在,它只是 API 层给你的一种写法,官方脚本里的 `merge_tool_messages()` 函数干的就是把连续的 tool 消息合成一条 user。

再回头找 `c1`、`c2`:**输出里根本没有 `tool_call_id`。**模型靠两个 `invoke` 和两个 `<tool_result>` 的**先后顺序**对应,第一个结果属于第一个请求。`tool_call_id` 看起来是 API 层用来校验你有没有漏回、有没有对错的账本,不是给模型看的。官方脚本的 `sort_tool_results_by_call_order()` 还会按请求的顺序重排结果。这很可能就是 Day 161 里 tool 消息乱序也是 200 的原因:服务端大概也替你按请求顺序排好了(服务端内部我看不到,这是从脚本推断的)。练习 3 会在这个脚本上实测。

回答一个你可能想问的:`<｜Assistant｜>` 后面为什么不是 `<｜Assistant｜><think>`?因为 `chat` 模式关了思考。开思考时是 `thinking_mode="thinking"`,会变成 `<｜Assistant｜><think>` 然后模型自己先写一段思考。官方说明文档里有一句和 Day 163 对得上:有 `tools` 的时候,`drop_thinking` 会自动关掉,「所有回合都保留思考,因为带工具的对话需要完整上下文才能跟踪多步推理」。这就是 `reasoning_content` 要原样回传的原因。

## 第四步:数一数 token,再把模型的输出解析回来

文字有了,就能数 token。新建 `part03/raw_tokens.py`,同时验证两件事:一是工具定义到底占多少 token,二是模型的输出文字怎么被解析成 `tool_calls`。

```python
# agent-zero-lab/part03/raw_tokens.py
"""数一数:上一个脚本那段文字有多少 token、其中几个是特殊 token、工具定义占多少;再把它还给 API 看它数出多少。"""
import json
from typing import Any

from tokenizers import Tokenizer

from common.llm import LLMClient
from part03.weather_tool import WEATHER_TOOL
from vendor.dsv4.encoding_dsv4 import encode_messages, parse_message_from_completion_text

tok = Tokenizer.from_file("vendor/dsv4/tokenizer.json")
# 词表里单独占一个编号的「添加 token」(<｜User｜>、｜DSML｜、<think> 等),不管有没有标 special
added = {t["content"] for t in json.load(open("vendor/dsv4/tokenizer.json"))["added_tokens"]}

CALLS: list[dict[str, Any]] = [
    {"id": "c1", "type": "function", "function": {"name": "get_weather", "arguments": '{"city": "北京"}'}},
    {"id": "c2", "type": "function", "function": {"name": "get_weather", "arguments": '{"city": "上海"}'}},
]
HISTORY: list[dict[str, Any]] = [
    {"role": "user", "content": "北京和上海现在各多少度?"},
    {"role": "assistant", "content": "我查一下。", "tool_calls": CALLS},
    {"role": "tool", "tool_call_id": "c1", "content": '{"temperature": 6.4, "weather": "晴"}'},
    {"role": "tool", "tool_call_id": "c2", "content": '{"temperature": 17.2, "weather": "多云"}'},
]
SYSTEM = {"role": "system", "content": "你是云簿 CloudLedger 的客服助手。"}
with_tools = encode_messages([{**SYSTEM, "tools": [WEATHER_TOOL]}, *HISTORY], thinking_mode="chat")
without = encode_messages([SYSTEM, *HISTORY], thinking_mode="chat")

enc = tok.encode(with_tools, add_special_tokens=False)
n_added = sum(1 for t in enc.tokens if t in added)
print(f"带一个工具定义:{len(enc.ids)} 个 token,其中专用 token {n_added} 个")
print("专用 token 有:", sorted({t for t in enc.tokens if t in added}))
n0 = len(tok.encode(without, add_special_tokens=False).ids)
print(f"同一段对话不带工具定义:{n0} 个 token;一个工具定义加了 {len(enc.ids) - n0} 个")

# 模型的「输出」也是一段文字;服务端把它解析成 tool_calls,和 Day 156 说的一样
completion = (
    '我再查一个。\n\n<｜DSML｜tool_calls>\n<｜DSML｜invoke name="get_weather">\n'
    '<｜DSML｜parameter name="city" string="true">广州</｜DSML｜parameter>\n'
    "</｜DSML｜invoke>\n</｜DSML｜tool_calls><｜end▁of▁sentence｜>"
)
print(json.dumps(parse_message_from_completion_text(completion, thinking_mode="chat"), ensure_ascii=False))

# 把同一段历史交给 API,看它报告的 prompt_tokens
client = LLMClient(max_retries=0)
r = client.chat([SYSTEM, *HISTORY], tools=[WEATHER_TOOL], max_tokens=1)
print(f"API 报告的 prompt_tokens:{r.prompt_tokens}(本地按官方编码数出来 {len(enc.ids)})")
```

<div class="line-notes">

- `from tokenizers import Tokenizer` Hugging Face 的分词库,`uv add tokenizers` 装的,读 `tokenizer.json` 就能用,不用装整个 transformers。
- `tok = Tokenizer.from_file("vendor/dsv4/tokenizer.json")` 加载刚下载的分词器,路径相对仓库根目录。
- `added = {t["content"] for t in json.load(open("vendor/dsv4/tokenizer.json"))["added_tokens"]}` `tokenizer.json` 里有个 `added_tokens` 列表,是词表里单独占一个编号的特殊串,比如 `<｜User｜>`、`<think>`、`｜DSML｜`。我最初按 `special` 标志过滤,结果只数出两个,因为 `<｜User｜>` 这些在文件里 `special` 是 `false`,所以改成只看有没有在这个列表里。
- `CALLS: list[dict[str, Any]] = [` 和 `raw_view.py` 一样的两个请求。
- `with_tools = encode_messages([{**SYSTEM, "tools": [WEATHER_TOOL]}, *HISTORY], thinking_mode="chat")` 带一个工具的完整文字。`{**SYSTEM, "tools": ...}` 把 `tools` 加进 system 消息的拷贝里。
- `without = encode_messages([SYSTEM, *HISTORY], thinking_mode="chat")` 同一段对话,不带工具,拿来做差。
- `enc = tok.encode(with_tools, add_special_tokens=False)` 切成 token。`add_special_tokens=False` 是因为文字开头已经有 BOS 了,不要重复加。
- `n_added = sum(1 for t in enc.tokens if t in added)` `enc.tokens` 是切出来的每一块文字,数一数有几块是专用 token。实测 31 个。
- `print("专用 token 有:", sorted({t for t in enc.tokens if t in added}))` 去重后只有七种:`<｜begin▁of▁sentence｜>`、`<｜end▁of▁sentence｜>`、`<｜User｜>`、`<｜Assistant｜>`、`<think>`、`</think>`、`｜DSML｜`。`｜DSML｜` 是**一个** token,不是五个字符,所以那些 `<｜DSML｜invoke` 很便宜。
- `n0 = len(tok.encode(without, add_special_tokens=False).ids)` 不带工具的总数,实测 149。
- `print(f"同一段对话不带工具定义:{n0} 个 token;一个工具定义加了 {len(enc.ids) - n0} 个")` 521 减 149,一个工具定义(含固定说明)加了 372 个。
- `completion = (` 手写一段模型可能输出的文字:一句话,空一行,一个 DSML 块,EOS。注意第一行 `我再查一个。\n\n` 那个空行不能省,官方解析器靠 `\n\n<｜DSML｜tool_calls` 这个串找到调用开始的位置;我第一次没写,直接触发了 `AssertionError: Unexpected special token '｜DSML｜' in content`。
- `print(json.dumps(parse_message_from_completion_text(completion, thinking_mode="chat"), ensure_ascii=False))` 官方的解析函数:把输出文字还原成 `content` 加 `tool_calls`。
- `r = client.chat([SYSTEM, *HISTORY], tools=[WEATHER_TOOL], max_tokens=1)` 把同样的历史交给真 API,`max_tokens=1` 只要它读完输入、吐一个 token 就停,为了拿 `prompt_tokens`。
- `print(f"API 报告的 prompt_tokens:{r.prompt_tokens}` 实测 504,本地数出来 521。

</div>

```bash
uv run python -m part03.raw_tokens
```

```text
带一个工具定义:521 个 token,其中专用 token 31 个
专用 token 有: ['</think>', '<think>', '<｜Assistant｜>', '<｜User｜>', '<｜begin▁of▁sentence｜>', '<｜end▁of▁sentence｜>', '｜DSML｜']
同一段对话不带工具定义:149 个 token;一个工具定义加了 372 个
{"role": "assistant", "content": "我再查一个。", "reasoning_content": "", "tool_calls": [{"type": "function", "function": {"name": "get_weather", "arguments": "{\"city\": \"广州\"}"}}]}
API 报告的 prompt_tokens:504(本地按官方编码数出来 521)
```

四个结果。第一,521 个 token 里只有 31 个是专用 token,七种,剩下的是普通文字。第二,**一个工具定义(含固定的格式说明和那句警告)让整段对话多了 372 个 token**。这和 Day 157 实测的工具定义花销是一个量级;练习 2 会量「同一个工具描述写短一点」能省多少,还会量十个工具要多少。第三,`parse_message_from_completion_text` 把输出文字还原成了 `tool_calls`,`arguments` 是 `{"city": "广州"}` 字符串,**但里面没有 `id`**。API 返回的那种 `call_00_…` 的 id,是服务端解析完之后自己生成的。

第四个结果是个小遗憾:API 报告的 `prompt_tokens` 是 504,我按官方编码本地数出 521,差了 17。我没法确定原因。能确定的是 API 现在的 `deepseek-flash` 由 V4.1-Flash-1017 提供,而我下载的是 V4-Flash 的公开脚本,两个版本的模板可能有细微差别。Day 163 里那段漏出来的标记长成 `<｜｜DSML｜｜ calls>`(两根竖线、空格、没有 `tool_`),而官方脚本写的是 `<｜DSML｜tool_calls>`,也是这种「不逐字节一致」的另一个证据。你照着今天的方法去数,会得到和我差不多、但不会分毫不差的数字。**做精确的成本核算以 API 返回的 `usage` 为准,本地数 token 只能用来估算和对比。**

## 第五步:模型怎么学会写这段文字的(只讲直觉)

现在可以回答「模型怎么学会调工具」了。先说一个结论:**没有什么特别的魔法,它学会的是在这种格式的文字后面续写。**

具体是这样。模型的基本能力是预测下一个 token([Day 113](/blog/agent-zero/day-113-training/) 讲训练时学过)。厂商要让它会调工具,做法的骨架大致是三步,下面我标出哪些是公开资料里能查到的,哪些是我的推断:

第一步,**把工具调用变成普通文本的一部分**。就是你刚才在第三步看到的:约定一套标记(DSML),约定「调用写在 assistant 回合里,结果写在下一个 user 回合里」。从模型的角度,调用一次工具和写一句话没有区别,都是往后续写 token。这一步是官方脚本和 README 直接写明的。

第二步,**准备大量这种格式的对话,让模型学着续写**。数据是「对话中途需要外部信息,于是写一段调用,看到结果,再接着回答」的样本。工具定义在这些样本里每次都出现在 system 部分,所以模型学到的是「看到 `## Available Tool Schemas` 下面的 JSON,就知道有哪些工具可用,按那个名字和参数写调用」。这是公开的常规做法,我没有读到 DeepSeek 具体用了哪些数据的原文。一个常见的细节是训练时通常只对 assistant 写的那部分计算损失,工具返回的结果是环境给的,不是模型该学会生成的内容;这是业界通行的做法,我没有查证 DeepSeek 的具体设置,所以只当直觉看。

第三步,**用强化学习把它练稳**。DeepSeek-V3.2 技术报告(arXiv 2512.02556,2025 年 12 月)的摘要里写了一条:搭了一条大规模的 Agent 任务合成流水线,目的是把推理「整合进工具使用场景」,系统地批量生成训练数据,用来做 Agent 方向的后训练。更细的内容(环境数量、奖励怎么设计)我只在二手文章里看到过,没有去读报告原文,所以不引用数字。

Toolformer(Schick 等人 2023,arXiv 2302.04761)是更早、更好懂的一个版本:让模型自己决定在哪些位置插入 API 调用、调什么、传什么参数,通过自监督的方式学出来。它证明了「模型自己学会调工具」可行,方法和今天的主流不一样,但思路相通。

把这个直觉用回前面看到的现象,几件事就解释得通了:

工具定义花钱,因为它就是 system 提示词里的几百个 token(第四步实测 372 个),每次请求都要重新读一遍,缓存命中才便宜(Day 157 的 `token_cost.py`)。描述写得好坏影响选择,因为模型读的就是这段文字,它没有别的信息来源。小模型经常乱填参数、该调不调,因为这是训练出来的行为,训练得不够就不稳,这不是你代码的问题,选型时要测。`none` 会漏出标记,因为 `none` 是服务端那一层的开关,模型脑子里学到的「看到这样的历史就接着写调用」没被关掉。思考内容要回传,因为带工具的多步任务里,上一轮的计划是后面几轮的上下文。

早期没有原生 function calling 的时候,大家在提示词里约定「要用工具就输出 `Action: 工具名[参数]`」,再用正则去抠,那是 ReAct 的原始做法([Day 172](/blog/agent-zero/day-172-react-1/) 会讲)。原生工具调用就是把这套约定标准化,并且专门训练过。你今天读到的 DSML 就是它的一个具体实现。


### 零件对照

| 概念 | 今天的文件 | 以后哪天用 |
| --- | --- | --- |
| Anthropic 一来一回 | `anthropic_run.py` | 第五部分 MCP 讲「各家 SDK 的差异」时对照 |
| `tool_result` 位置规则 | `anthropic_order.py` | 自己做多厂商适配层时的测试用例 |
| 两边互转 | `format_convert.py`、`tests/test_format_convert.py` | 以后要在两家之间切换时直接用 |
| 模型视角的文字 | `raw_view.py`、`vendor/dsv4/` | [Day 180](/blog/agent-zero/day-180-tool-design-1/) 的「工具定义怎么写才省 token」 |
| 数 token | `raw_tokens.py` | 成本估算;精确账以 API 的 `usage` 为准 |

## 动手练习

三道题,练习 1 联网(几分钱),练习 2、3 不联网。

**练习 1:`tool_choice` 的翻译函数,并实测 `any`。** 写 `tool_choice_to_anthropic(choice)`,把 OpenAI 的四种取值翻成 Anthropic 的写法。然后对 DeepSeek 兼容端点,在「思考默认开」和「思考关」两种状态下,各用 `auto`、`required`(翻成 `any`)、指定函数(翻成 `tool`)问一句和天气无关的「你好,你是谁?」,记下哪个调了工具、哪个 400。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex164_choice.py
"""练习 1:tool_choice 的四种取值翻译成 Anthropic 的写法,并对着兼容端点验证 any。"""
import os
from typing import Any

import anthropic
from dotenv import load_dotenv

from part03.format_convert import tools_to_anthropic
from part03.weather_tool import WEATHER_TOOL


def tool_choice_to_anthropic(choice: Any) -> dict[str, Any]:
    """OpenAI 的 tool_choice -> Anthropic 的 tool_choice。"""
    if choice == "auto":
        return {"type": "auto"}
    if choice == "none":
        return {"type": "none"}
    if choice == "required":
        return {"type": "any"}
    if isinstance(choice, dict) and choice.get("type") == "function":
        return {"type": "tool", "name": choice["function"]["name"]}
    raise ValueError(f"不认识的 tool_choice:{choice!r}")


if __name__ == "__main__":
    load_dotenv()
    client = anthropic.Anthropic(base_url="https://api.deepseek.com/anthropic", api_key=os.environ["LLM_API_KEY"])
    named: Any = {"type": "function", "function": {"name": "get_weather"}}
    for think_label, extra in [("思考默认(开)", {}), ("思考关", {"thinking": {"type": "disabled"}})]:
        print(think_label)
        for label, choice in [("auto", "auto"), ("required -> any", "required"), ("指定 -> tool", named)]:
            try:
                r = client.messages.create(
                    model=os.environ["LLM_MODEL"],
                    max_tokens=300,
                    tools=tools_to_anthropic([WEATHER_TOOL]),  # type: ignore[arg-type]
                    tool_choice=tool_choice_to_anthropic(choice),  # type: ignore[arg-type]
                    messages=[{"role": "user", "content": "你好,你是谁?"}],
                    **extra,  # type: ignore[arg-type]
                )
            except anthropic.BadRequestError as e:
                print(f"  {label:16} 400:{e.body['error']['message'] if isinstance(e.body, dict) else e.message}")
                continue
            uses = [b.input for b in r.content if b.type == "tool_use"]
            print(f"  {label:16} stop_reason={r.stop_reason:9} tool_use {uses}")
```

<div class="line-notes">

- `def tool_choice_to_anthropic(choice: Any) -> dict[str, Any]:` 输入 OpenAI 的 `tool_choice`(字符串或字典),输出 Anthropic 的字典。
- `if choice == "auto":` 两边的 `auto` 同名,只是 Anthropic 要包成 `{"type": "auto"}`。
- `if choice == "none":` 同理。DeepSeek 的兼容文档说 `none` 是「完全支持」。
- `if choice == "required":` `required` 翻成 `any`,意思是「必须用,但不指定哪个」。
- `if isinstance(choice, dict) and choice.get("type") == "function":` OpenAI 的指定函数是个字典:`{"type": "function", "function": {"name": ...}}`。
- `return {"type": "tool", "name": choice["function"]["name"]}` 翻成 Anthropic 的 `{"type": "tool", "name": ...}`,名字少一层嵌套。
- `raise ValueError(f"不认识的 tool_choice:{choice!r}")` 不认识就报错,不要悄悄当成 `auto`。
- `named: Any = {"type": "function", "function": {"name": "get_weather"}}` Day 163 第一步用过的指定函数写法。
- `for think_label, extra in [("思考默认(开)", {}), ("思考关", {"thinking": {"type": "disabled"}})]:` 两种思考状态。第二种用 `thinking={"type": "disabled"}` 关掉(上面 `convert_live.py` 里同款)。
- `for label, choice in [("auto", "auto"), ("required -> any", "required"), ("指定 -> tool", named)]:` 三种取值,每种都先经过翻译函数。
- `tool_choice=tool_choice_to_anthropic(choice),  # type: ignore[arg-type]` 翻译后传给 SDK。`# type: ignore` 因为 SDK 的类型是一堆精确的 TypedDict,我们的 `dict[str, Any]` 对不上,运行时没有影响。
- `**extra,  # type: ignore[arg-type]` `extra` 为空字典就什么都不传,否则带上 `thinking=...`。
- `except anthropic.BadRequestError as e:` 400 进这里。
- `uses = [b.input for b in r.content if b.type == "tool_use"]` 收集所有 `tool_use` 块的 `input`,没调就是空列表。

</div>

```bash
uv run python -m part03.ex164_choice
```

```text
思考默认(开)
  auto             stop_reason=end_turn  tool_use []
  required -> any  stop_reason=end_turn  tool_use []
  指定 -> tool       400:Thinking mode does not support this tool_choice (request_id: 7cf4aef7-633b-4070-83e4-5c1749e40b0f)
思考关
  auto             stop_reason=end_turn  tool_use []
  required -> any  stop_reason=end_turn  tool_use []
  指定 -> tool       stop_reason=tool_use  tool_use [{'city': '北京', 'unit': 'celsius'}]
```

读结果:`auto` 在两种状态下都没调工具,正常,因为问题和天气无关。`required -> any` 也没调,而且**没有报错**,模型直接回答了「你好」。指定 `tool` 的那一行最有信息量:思考开着是 400 `Thinking mode does not support this tool_choice`,和 Day 163 OpenAI 端点的报错一字不差;思考关掉就强制调用了 `get_weather`,参数 `{'city': '北京', 'unit': 'celsius'}`,和 Day 163 练习 1 里 `required` 硬造 `{"city": "北京"}` 是同一类现象。结论有两条:一,兼容端点上 `tool` 是真强制,`any` 不是;二,思考开着强制调用会 400 这件事,Anthropic 兼容端点和 OpenAI 端点是同一套服务端规则。我另外用两个工具、关思考、问两遍「你好」测过 `any`,同样没有强制,所以不是「只有一个工具」的缘故。这个行为只代表 2026 年 10 月 27 日这个端点,官方 `api.anthropic.com` 上的 `any` 怎么样我没实跑。

</details>

**练习 2:工具描述写长写短,差多少 token?** 用第四步的方法,在不联网的前提下量四种情况:不带工具、把 `WEATHER_TOOL` 的三处描述都缩成两三个字、完整的 `WEATHER_TOOL`、同一个完整工具复制 10 份。算出每多一个工具大约多多少 token,以及那段固定的格式说明大约多少 token。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex164_toolcost.py
"""练习 2:同一个工具,描述写长写短,在模型眼里差多少 token?不联网。"""
import copy

from tokenizers import Tokenizer

from part03.weather_tool import WEATHER_TOOL
from vendor.dsv4.encoding_dsv4 import encode_messages

tok = Tokenizer.from_file("vendor/dsv4/tokenizer.json")


def prompt_tokens(tools: list[dict]) -> int:
    msgs = [{"role": "system", "content": "客服。", "tools": tools}, {"role": "user", "content": "你好"}] if tools else [
        {"role": "system", "content": "客服。"},
        {"role": "user", "content": "你好"},
    ]
    return len(tok.encode(encode_messages(msgs, thinking_mode="chat"), add_special_tokens=False).ids)


short = copy.deepcopy(WEATHER_TOOL)
short["function"]["description"] = "查天气"
short["function"]["parameters"]["properties"]["city"]["description"] = "城市"
short["function"]["parameters"]["properties"]["unit"]["description"] = "单位"

zero = prompt_tokens([])
for label, tools in [("不带工具", []), ("简写版 1 个", [short]), ("认真写的版本 1 个", [WEATHER_TOOL]), ("认真写的版本 10 个", [WEATHER_TOOL] * 10)]:
    n = prompt_tokens(tools)
    print(f"{label:14} 总 {n:5} token,比不带工具多 {n - zero}")
```

<div class="line-notes">

- `tok = Tokenizer.from_file("vendor/dsv4/tokenizer.json")` 加载一次分词器,下面反复用。
- `def prompt_tokens(tools: list[dict]) -> int:` 给定工具列表,返回整段文字的 token 数。
- `msgs = [{"role": "system", "content": "客服。", "tools": tools}, {"role": "user", "content": "你好"}] if tools else [` 有工具时把 `tools` 挂在 system 上;没有工具时不挂,因为 `tools` 是空列表时官方脚本不渲染 `## Tools` 一节,效果等于不带。
- `return len(tok.encode(encode_messages(msgs, thinking_mode="chat"), add_special_tokens=False).ids)` 先渲染成文字,再数 token。
- `short = copy.deepcopy(WEATHER_TOOL)` 深拷贝一份,下面改它,不能动原件(`WEATHER_TOOL` 其他脚本还要用)。
- `short["function"]["description"] = "查天气"` 三处描述都缩成两三个字。
- `zero = prompt_tokens([])` 基线:不带工具的总数,实测 7。
- `for label, tools in [("不带工具", []), ("简写版 1 个", [short]), ("认真写的版本 1 个", [WEATHER_TOOL]), ("认真写的版本 10 个", [WEATHER_TOOL] * 10)]:` 四种情况。`[WEATHER_TOOL] * 10` 是同一个对象重复 10 次,列表乘法。
- `print(f"{label:14} 总 {n:5} token,比不带工具多 {n - zero}")` 实测:304、379、1738,对应多 297、372、1731。

</div>

```bash
uv run python -m part03.ex164_toolcost
```

```text
不带工具           总     7 token,比不带工具多 0
简写版 1 个        总   304 token,比不带工具多 297
认真写的版本 1 个     总   379 token,比不带工具多 372
认真写的版本 10 个    总  1738 token,比不带工具多 1731
```

算一下。一个完整工具比简写版多 75 个 token(372 减 297),那是三处描述的字数差。10 份比 1 份多 1359(1731 减 372),均摊每多一个工具约 151 个 token;所以一个工具里「固定的格式说明和那句警告」大约是 372 减 151,约 221 个,这部分不管你有几个工具都只付一次。这里的 10 份是同一个工具复制的,真实工具的描述长短不一,只能当量级看。这个量级的意思是:10 个工具大约 1700 个 token,按每百万输入 2 元算,每次请求 ¥0.0035,缓存命中时更便宜;工具到上百个就是另一回事了,后面讲工具检索时会回来。再提醒一次:这是本地估算,和 API 报告的 `usage` 差了几个百分点(第四步),精确账看 `usage`。

</details>

**练习 3:`tool_call_id` 改名、tool 消息换顺序,模型看到的文字变不变?** 不联网。用 `encode_messages` 渲染三份对话:基准、把 id 从 `c1`、`c2` 改成 `call_00_AAA`、`call_01_BBB`、两个 tool 消息调换顺序。比较三份文字是否一样,并回答 id 有没有出现在文字里。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex164_ids.py
"""练习 3:tool_call_id 改名、tool 消息换顺序,模型看到的文字变不变?不联网。"""
from typing import Any

from part03.weather_tool import WEATHER_TOOL
from vendor.dsv4.encoding_dsv4 import encode_messages


def conversation(ids: tuple[str, str], tool_order: tuple[int, int]) -> list[dict[str, Any]]:
    calls = [
        {"id": ids[0], "type": "function", "function": {"name": "get_weather", "arguments": '{"city": "北京"}'}},
        {"id": ids[1], "type": "function", "function": {"name": "get_weather", "arguments": '{"city": "上海"}'}},
    ]
    results = [
        {"role": "tool", "tool_call_id": ids[0], "content": "北京结果"},
        {"role": "tool", "tool_call_id": ids[1], "content": "上海结果"},
    ]
    return [
        {"role": "system", "content": "客服。", "tools": [WEATHER_TOOL]},
        {"role": "user", "content": "北京和上海几度?"},
        {"role": "assistant", "content": "", "tool_calls": calls},
        *[results[i] for i in tool_order],
    ]


base = encode_messages(conversation(("c1", "c2"), (0, 1)), thinking_mode="chat")
renamed = encode_messages(conversation(("call_00_AAA", "call_01_BBB"), (0, 1)), thinking_mode="chat")
swapped = encode_messages(conversation(("c1", "c2"), (1, 0)), thinking_mode="chat")
print("改 id 后文字相同:", base == renamed)
print("tool 消息换顺序后文字相同:", base == swapped)
print("id 出现在文字里吗:", "c1" in base or "c2" in base)
print(base.split("<｜User｜>")[-1])
```

<div class="line-notes">

- `def conversation(ids: tuple[str, str], tool_order: tuple[int, int]) -> list[dict[str, Any]]:` 造对话的函数:`ids` 是两个请求的 id,`tool_order` 是两条 tool 消息的排列顺序。
- `calls = [` 两个请求,id 由参数决定。
- `results = [` 两条结果,`tool_call_id` 和上面的 id 对应;内容分别是「北京结果」「上海结果」,一眼能看出谁是谁。
- `*[results[i] for i in tool_order],` 按 `tool_order` 取结果:`(0, 1)` 是正常顺序,`(1, 0)` 是调换。
- `base = encode_messages(conversation(("c1", "c2"), (0, 1)), thinking_mode="chat")` 基准文字。
- `renamed = encode_messages(conversation(("call_00_AAA", "call_01_BBB"), (0, 1)), thinking_mode="chat")` 只换 id。
- `swapped = encode_messages(conversation(("c1", "c2"), (1, 0)), thinking_mode="chat")` 只换顺序。
- `print("改 id 后文字相同:", base == renamed)` 实测 `True`。
- `print("tool 消息换顺序后文字相同:", base == swapped)` 实测 `True`:官方脚本把结果按请求顺序重排了。
- `print("id 出现在文字里吗:", "c1" in base or "c2" in base)` 实测 `False`。
- `print(base.split("<｜User｜>")[-1])` 打印最后一段,也就是结果回传的那个 user 回合。

</div>

```bash
uv run python -m part03.ex164_ids
```

```text
改 id 后文字相同: True
tool 消息换顺序后文字相同: True
id 出现在文字里吗: False
<tool_result>北京结果</tool_result>

<tool_result>上海结果</tool_result><｜Assistant｜></think>
```

三份文字完全相同:改 id 不影响,调换顺序也不影响,id 根本不在文字里。最后打印的那段里,「北京结果」排在「上海结果」前面,尽管 `swapped` 那份对话里上海的结果在前。这说明官方脚本的 `sort_tool_results_by_call_order()` 起了作用。意思是:对**这个模型的这个编码脚本**,结果的归属靠顺序,`tool_call_id` 只用来在编码前把结果排回请求的顺序。这和 Day 161「乱序是 200」的现象吻合,但服务端在 API 那一层怎么实现的我看不到,所以这是一个推断,不是确证。别因此养成乱写 id 的习惯:别家的服务端(包括 Anthropic 官方)会校验 `tool_use_id` 对不对得上,第一步 `anthropic_order.py` 的 C 就是证据。

</details>

**验收标准:** 能不看文章默写 Anthropic 格式和 OpenAI 格式的五处差别;能说出为什么 `tool_result` 要放在 user 消息的最前面;`tests/test_format_convert.py` 8 个测试全部通过;能说出模型真正看到的是一段文字、`tool` 角色在其中并不存在、`tool_call_id` 不在文字里;能说出一个工具定义大约占几百个 token,以及这个数字该以什么为准。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| Anthropic Messages API | Anthropic 的对话接口。消息的 `content` 是一串带 `type` 的块,不是一个字符串 |
| 内容块(content block) | `content` 数组里的一项,常见的有 `text`、`tool_use`、`tool_result`、`thinking`。类比 React 里带 `type` 的节点 |
| `tool_use` | assistant 消息里的块,表示模型想调工具:`id`、`name`、`input`。对应 OpenAI 的 `tool_calls` 里的一项 |
| `tool_result` | user 消息里的块,把工具结果还给模型:`tool_use_id`、`content`,可选 `is_error`。必须排在那条 user 消息的最前面 |
| `input_schema` | Anthropic 工具定义里放 JSON Schema 的字段,等于 OpenAI 的 `parameters` |
| `stop_reason` | Anthropic 的结束原因:`tool_use`(要调工具)、`end_turn`(说完了)、`max_tokens`(被截断),对应 OpenAI 的 `finish_reason` |
| `is_error` | `tool_result` 的可选字段,标记工具执行出错。DeepSeek 兼容端点会忽略它 |
| 兼容端点 | 别家服务按 Anthropic(或 OpenAI)的接口格式提供的入口。字段能传不代表语义和原版一样 |
| 对话模板(chat template) | 把 `messages` 和 `tools` 编码成一段文字的规则。模型只见过这段文字 |
| 特殊标记 / 专用 token | 词表里单独占一个编号的标记,比如 `<｜User｜>`、`<think>`、`｜DSML｜`,用来分隔角色和结构 |
| DSML | DeepSeek 用来写工具调用的标记语言,`<｜DSML｜tool_calls>` 开头。Day 163 漏进 `content` 的就是它 |
| BOS / EOS | 序列开始 / 结束标记。`<｜begin▁of▁sentence｜>` 在整段开头,`<｜end▁of▁sentence｜>` 在每个 assistant 回合末尾 |
| Toolformer | 2023 年的论文,让模型自己学会在文本里插入 API 调用。「模型自己学会调工具」的早期证明 |

## 常见误区

**以为 Anthropic 和 OpenAI 的工具调用是两种机制。** 骨架一样:模型写一段请求,你执行,把结果放回去再问一次。差别只在字段名、结果放在哪、参数是字符串还是对象。

**把 `tool_result` 放在文字后面。** 放在装结果那条 user 消息的最前面,文字放后面。不然报 `tool_use ids were found without tool_result blocks immediately after`,而这句话看上去像是「漏回了」,其实可能只是顺序。

**把 OpenAI 的多条 `tool` 消息原样一条条翻成多条 user 消息。** 要合并成一条 user 消息里的多个 `tool_result` 块。`messages_to_anthropic` 里那个 `all(b["type"] == "tool_result" ...)` 判断就是干这个的。

**翻译时把思考块丢了又接着发。** 开着思考的 Anthropic 接口要求 `thinking` 块跟着 assistant 回合回来,丢了会 400 `The content[].thinking in the thinking mode must be passed back to the API`。要么关思考,要么整个对话都用同一家的格式、整块原样放回。

**以为兼容端点就是官方。** `any` 在 DeepSeek 兼容端点上没有强制,`is_error` 被忽略,`disable_parallel_tool_use` 被忽略。换到 `api.anthropic.com` 要把这几条重新测。

**以为 `tool_call_id` 是给模型看的。** 模型看到的文字里没有它。它是 API 层对账用的,别家服务端会严格校验,所以不能乱写。

**把本地数出来的 token 当成账单。** 今天 521 对 504,差 17。估算用本地,结算看 `usage`。

**以为「模型怎么学会调工具」有什么神秘的机制。** 就是把调用写成一种约定好的文字,拿大量这种格式的对话训练它续写,再用强化学习练稳。工具定义花钱、`none` 会漏标记,都是这个事实的推论。

## 学习资料

### 文档与文章

- [Anthropic 文档:Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools):英文,`input_schema`、工具描述的写法、`tool_choice` 的四种取值,以及哪些模型不支持强制调用的表,今天的格式对照表就来自这里。
- [Anthropic 文档:Handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls):英文,`tool_use` / `tool_result` 的结构、`is_error`、`tool_result` 必须排最前面的那条规则。
- [DeepSeek 文档:Anthropic API 兼容](https://api-docs.deepseek.com/guides/anthropic_api):`base_url`、模型名怎么映射、哪些字段被忽略(`is_error`、`disable_parallel_tool_use`)。
- [DeepSeek-V4-Flash 编码说明(Hugging Face)](https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash/blob/main/encoding/README.md):英文,DSML 格式、`<tool_result>` 包在 user 回合里、思考模式和 `drop_thinking` 的规则,第三步那段文字的出处。
- [Anthropic 工程博客:Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents):英文,怎么给 Agent 设计工具,Day 180 起会用到,今天先收藏。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1wPEm6DEzS&autoplay=0&high_quality=1" title="从原理到代码,讲清楚大模型的Tool Use和Function Calling" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>懂点AI的H先生 · 从原理到代码,将清楚大模型的Tool Use和Function Calling · 约 17 分钟,2026 年 6 月。对照第三步:看它怎么讲「模型只续写文字」。我只核对了标题、时长和简介,没有逐帧看,UP 主的结论请你自己判断。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1yUQhYwEJ2&autoplay=0&high_quality=1" title="【大模型tool calls】工具调用原理、MCP协议及极简browser use实现" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>胖虎遛二狗 · 【大模型tool calls】工具调用原理、MCP协议及极简browser use实现 · 约 15 分钟,2025 年 3 月。前半讲工具调用原理,MCP 部分第五部分才学,现在跳过。我只核对了标题和时长,没有逐帧看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/7xTGNNLPyMI" title="Deep Dive into LLMs like ChatGPT" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Andrej Karpathy · Deep Dive into LLMs like ChatGPT · 英文,三个多小时的长视频。不用全看,找讲「对话怎么编码成 token 序列、特殊 token 分隔角色」和「后训练」的部分,对照第三步和第五步。我只核对了标题,没有逐帧看,所以不写具体时间点。</figcaption>
</figure>

### 书籍

今天这组不需要。

### 开源项目与代码

- [DeepSeek-V4-Flash 仓库的 encoding 目录](https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash/tree/main/encoding):`encoding_dsv4.py` 只有 700 多行,读一遍 `encode_messages`、`merge_tool_messages` 和 `parse_message_from_completion_text`,就知道对话模板是怎么回事。同目录有测试用的输入输出样例。
- [anthropics/anthropic-sdk-python](https://github.com/anthropics/anthropic-sdk-python):官方 Python SDK,`ToolUseBlock`、`ToolResultBlockParam` 的类型定义在这里。
- [Toolformer 论文](https://arxiv.org/abs/2302.04761)和 [DeepSeek-V3.2 技术报告](https://arxiv.org/abs/2512.02556):第五步的两个出处。后者我只读了摘要。

## 自测

1. Anthropic 和 OpenAI 兼容格式在「回传工具结果」上最大的差别是什么?

<details><summary>答案</summary>

OpenAI 每个结果是一条独立的 `role: "tool"` 消息,带 `tool_call_id`;Anthropic 没有 `tool` 角色,所有结果放进同一条 `role: "user"` 消息的 `content` 里,每个结果一个 `tool_result` 块,带 `tool_use_id`,而且 `tool_result` 必须排在这条消息的最前面,文字放后面。

</details>

2. 为什么 `tool_use` 的 `input` 是对象而 `tool_calls` 的 `arguments` 是字符串?各有什么后果?

<details><summary>答案</summary>

OpenAI 格式把模型写出的参数原样当字符串给你,所以你要自己 `json.loads`,被截断的 JSON 会让你解析失败(Day 158 第六步)。Anthropic 在服务端先解析好,你拿到的一定是对象,少一步解析;但两边都不保证对象符合 schema,本地校验仍然不能省。

</details>

3. `messages_to_anthropic` 里为什么要把连续的 `tool` 消息合并成一条 user?不合并会怎样?

<details><summary>答案</summary>

Anthropic 要求模型一个回合里的所有 `tool_use` 都在紧跟着的下一条 user 消息里得到 `tool_result`。分成多条 user 消息,第一个结果之后的消息不再是「紧跟着」,结果会被判成缺失,报 `tool_use ids were found without tool_result blocks immediately after`。

</details>

4. 模型真正看到的输入是什么样的?`tool` 角色和 `tool_call_id` 在里面吗?

<details><summary>答案</summary>

是一段文字:对话模板把 system、工具定义(放在 system 部分)、user、assistant(调用写成 `<｜DSML｜tool_calls>` 块)和结果(包在 user 回合的 `<tool_result>` 标签里)按固定标记拼成一整段。`tool` 角色不存在,结果装在 user 回合里;`tool_call_id` 不在文字里,模型靠请求和结果的先后顺序对应。

</details>

5. 面试题:「工具定义为什么会让每次请求变贵?怎么控制?」

<details><summary>答案</summary>

因为工具定义会被渲染成 system 提示词的一部分,每次请求都要整段重新读一遍,按输入 token 计费(今天实测一个工具约 372 个 token,其中约 221 个是不随工具数变化的固定说明,每多一个工具约再加 150)。控制办法:描述写够但别啰嗦;保持工具定义的内容和顺序稳定,让前缀缓存命中;工具很多时只放相关的几个(工具检索,后面会学);合并功能相近的工具。精确成本以 API 的 `usage` 为准。

</details>

6. 面试题:「模型是怎么学会调用工具的?」

<details><summary>答案</summary>

把工具调用变成约定好的文字格式(比如 DSML 标记),调用写在 assistant 回合,结果写在下一个 user 回合;拿大量这种格式的对话(工具定义在 system,中途写调用、看结果、继续回答)训练模型续写,通常只对 assistant 写的部分算损失;再用强化学习在可验证的任务上练稳。服务端的「解析」就是把模型输出的标记文字转成 JSON。早期的 Toolformer 是让模型自监督地学会插入 API 调用。这些细节有些来自官方说明,有些是业界通行做法,面试时要区分「我读过的」和「我推断的」。

</details>

## 明天预告

Day 165 · Agent 是什么:循环 = 调模型 + 执行工具。今天看到的是一次调用:模型读一段文字,续写出一段调用,你执行、把结果拼回去,再让它续写。前几天的 `two_rounds` 正好是这件事做了两次。明天回答那个绕不开的问题:如果任务需要的次数事先不知道,是 2 次还是 7 次,该怎么办?答案就是把这件事放进一个循环,让模型自己决定什么时候不再调工具。明天先把「Agent」这个词讲清楚,再看循环什么时候该停。

实跑花费:Anthropic 兼容端点不走 `LLMClient`,没有账本,下面是按 token 数估算。按 `.env` 里 `LLM_PRICE=0.04,2,8`(缓存命中 / 未命中 / 输出,元每百万 token)的未命中和输出价算:`anthropic_run`(输入 212+150、输出 88+64)、`anthropic_order`(三次,各约 100 输入、30 输出)、`convert_live`(OpenAI 一次 ¥0.0008 加 Anthropic 一次约 390 输入 67 输出)、练习 1 的六次(各约 150 输入、60 输出)、`raw_tokens` 里的一次 504 输入 1 输出。合计输入约 3000、输出约 800 token,约 ¥0.0126,四舍五入 ¥0.013;加上写文章时反复试 `any` 和 `thinking`、第一次超时重跑等探路,总共约 ¥0.03。这是估算,不是账单。
