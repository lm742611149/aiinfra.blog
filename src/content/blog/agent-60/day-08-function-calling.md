---
title: 'Day 8 · Function calling:模型怎么「调用」函数(它其实只写了一段 JSON)'
description: '拆掉「模型会执行代码」的误会:模型只负责写出要调哪个函数、传什么参数,真正执行的是你的程序。今天把一次工具调用的完整往返跑通,逐字段读懂 tools、tool_calls 和 tool 消息,再对照 Anthropic 的写法。'
pubDate: 2026-10-12
regime: none
tags: ['function-calling', 'tool-use', 'json-schema', 'agent-60']
series: 'agent-60'
day: 8
lang: 'zh'
---

## 今天要解决的问题

W1 你已经会和模型「聊天」了:拼 messages、发请求、拿回一段文字。但聊天机器人和 Agent 之间隔着一道坎,就是模型能不能碰到外面的世界。它不知道今天北京多少度,查不了你数据库里的订单,也不能帮你发一封邮件。Function calling(也叫 tool calling、tool use,三个词说的是一回事)就是跨过这道坎的那块板子。

今天学完,你应该能做到下面几件事:

1. 用一句话讲清楚 function calling 的本质,而且讲对:模型不执行函数,它只输出「我想调用哪个函数、参数是什么」的结构化数据,执行的是你的代码。
2. 手写一个工具定义(JSON Schema),让模型在需要的时候请求调用它。
3. 读懂响应里的 `tool_calls` 每个字段,知道 `arguments` 为什么是字符串、`id` 拿来干什么。
4. 把工具执行结果用 `role: "tool"` 的消息送回去,拿到模型的最终回答,完成一次完整往返。
5. 知道并行工具调用和 `tool_choice` 是怎么回事,能把同一段逻辑翻译成 Anthropic Messages API 的写法。

预计用时 3–4 小时。前置是 Day 3(OpenAI 兼容协议、环境变量切厂商)和 Day 4(messages 结构)。代码默认跑在 DeepSeek 上,换成通义、Kimi、OpenAI 只需要改三个环境变量。

## 先拆掉一个误会:模型不会执行任何东西

第一次听说「大模型可以调用函数」的时候,我脑子里的画面是模型在某个沙箱里跑了一下 Python。这个画面是错的,而且错得很有害,因为它会让你在设计系统的时候把安全、超时、重试这些责任想成是模型那边的事。

真实情况朴素得多。你在请求里多带一个 `tools` 字段,告诉模型「你可以要求我替你做这几件事,每件事需要这些参数」。模型读完用户的问题,如果判断需要外部信息,它就不直接回答,而是生成一段结构化的输出,大意是「请帮我调用 get_weather,参数是 city=北京」。这段输出本质上就是 JSON 文本,和它平时生成一句话没有区别,只是格式被训练得很规整。然后请求就结束了,模型那边什么都没有执行。

接下来轮到你的程序。你解析出函数名和参数,自己去调天气 API,拿到「22.4 度,阴」,再发第二个请求,把这条结果放进 messages 里。模型这才看到真实数据,写出给用户的回答。

所以一次「工具调用」其实是两次 HTTP 请求,中间夹着你自己的一段代码。理解了这点,很多后面的问题都会变得显然:工具报错了谁处理?你。工具跑了 30 秒谁等?你。参数里塞了 `../../etc/passwd` 谁拦?还是你。模型只是一个特别会写 JSON 的同事,它提需求,你执行。

<figure>
<svg viewBox="0 0 640 380" role="img" aria-label="一次工具调用的时序图:你的程序、模型 API、天气服务三方之间的两次请求">
  <rect x="0" y="0" width="640" height="380" fill="var(--paper-raised)" rx="6"/>
  <text x="90" y="30" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">你的程序</text>
  <text x="330" y="30" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--mem)">模型 API</text>
  <text x="550" y="30" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--compute)">天气服务</text>
  <line x1="90" y1="42" x2="90" y2="360" stroke="var(--rule)" stroke-dasharray="4 4"/>
  <line x1="330" y1="42" x2="330" y2="360" stroke="var(--mem)" stroke-dasharray="4 4"/>
  <line x1="550" y1="42" x2="550" y2="360" stroke="var(--compute)" stroke-dasharray="4 4"/>
  <line x1="90" y1="75" x2="325" y2="75" stroke="var(--ink-soft)" marker-end="url(#a8)"/>
  <text x="100" y="68" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">① messages + tools</text>
  <rect x="300" y="88" width="60" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="330" y="107" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">决定调用</text>
  <line x1="325" y1="135" x2="95" y2="135" stroke="var(--mem)" marker-end="url(#a8)"/>
  <text x="105" y="128" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">② tool_calls: get_weather(北京)</text>
  <line x1="90" y1="175" x2="545" y2="175" stroke="var(--compute)" marker-end="url(#a8)"/>
  <text x="100" y="168" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">③ 你的代码真正去调 HTTP</text>
  <line x1="545" y1="210" x2="95" y2="210" stroke="var(--compute)" marker-end="url(#a8)"/>
  <text x="300" y="203" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">22.4℃ 阴</text>
  <line x1="90" y1="255" x2="325" y2="255" stroke="var(--ink-soft)" marker-end="url(#a8)"/>
  <text x="100" y="248" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">④ 原 messages + tool 结果</text>
  <line x1="325" y1="300" x2="95" y2="300" stroke="var(--mem)" marker-end="url(#a8)"/>
  <text x="105" y="293" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">⑤ 最终回答:北京现在 22 度,阴天</text>
  <text x="320" y="345" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">两次模型请求,中间那段执行完全发生在你的进程里</text>
  <defs><marker id="a8" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
</svg>
<figcaption>一次工具调用的完整往返。蓝色是模型侧,琥珀色是外部系统。注意第 ③ 步,模型 API 完全不参与。</figcaption>
</figure>

## 工具定义:写给模型看的 JSON Schema

工具定义有三样东西:名字、描述、参数的 JSON Schema。OpenAI 兼容协议里长这样:

```python
# agent-60-lab/w2/tools_def.py
from openai.types.chat import ChatCompletionToolParam

WEATHER_TOOL: ChatCompletionToolParam = {
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "查询某个城市当前的天气。用户问到天气、气温、要不要带伞时使用。",
        "parameters": {
            "type": "object",
            "properties": {
                "city": {
                    "type": "string",
                    "description": "城市名,中文或英文都可以,例如 '北京'、'Shanghai'",
                },
                "unit": {
                    "type": "string",
                    "enum": ["celsius", "fahrenheit"],
                    "description": "温度单位,默认 celsius",
                },
            },
            "required": ["city"],
        },
    },
}
```

<div class="line-notes">

- `from openai.types.chat import ChatCompletionToolParam` 只导入一个类型,运行时什么都不做,给编辑器做检查用。它本质是一个 TypedDict,字段名拼错(比如 `paramters`)会画红线。
- `WEATHER_TOOL: ChatCompletionToolParam = {` 变量名后面的 `: 类型` 是类型标注,相当于 TS 的 `const WEATHER_TOOL: ChatCompletionToolParam = {...}`。全大写表示当常量用。
- `"type": "function",` 外层固定写 `function`。OpenAI 协议里工具外面套了一层 `{type, function}`,Anthropic 没有这一层。
- `"name": "get_weather",` 模型回 tool_calls 时 `function.name` 就是这个字符串,你的代码按它找要执行的函数,所以要和真实函数对得上。
- `"description": "查询某个城市当前的天气。` 写给模型看的。后半句「要不要带伞时使用」帮模型把「明天出门带伞吗」也联想到这个工具。
- `"parameters": {` 参数的 JSON Schema。实测模型据此生成的 arguments 是字符串 `'{"city": "北京", "unit": "celsius"}'`。
- `"type": "object",` 参数整体是一个对象,也就是 Python 里会被 `**` 展开成关键字参数的那个 dict。
- `"city": {` 一个字段一个 key,key 名要和 `get_weather(city, unit)` 的参数名一致,不然 `get_weather(**args)` 会报 `unexpected keyword argument`。
- `"description": "城市名,中文或英文都可以` 例子写在 description 里,模型就会照着填 `北京` 这样的值,而不是 `Beijing, CN`。
- `"enum": ["celsius", "fahrenheit"],` 只允许这两个值。实测 DeepSeek 即使用户没提单位,也主动填了 `"unit": "celsius"`。
- `"required": ["city"],` 只有 city 必填。unit 没列进来,模型可以不填,`get_weather` 用默认值 `"celsius"`。

</div>

第一行的类型标注 `ChatCompletionToolParam` 是 OpenAI SDK 给工具定义提供的类型,标上以后字段名拼错(比如 `paramters`)编辑器会直接画红线;不标的话,把这个字典传给 SDK 时类型检查会报「类型对不上」。

如果你没写过 JSON Schema,别慌,Agent 工程里用到的子集非常小。`type: object` 表示参数是一个对象;`properties` 列出每个字段;每个字段有自己的 `type`(string、number、integer、boolean、array、object)和 `description`;`enum` 把取值限定在几个固定值里;`required` 说明哪些字段必须给。这五六个关键字够你用到毕业项目。

这里有一件事值得多停一下:**description 是写给模型看的**,不是写给同事看的注释。模型决定要不要调用这个工具、参数怎么填,依据几乎全来自这里。「查询天气」和「查询某个城市当前的天气。用户问到天气、气温、要不要带伞时使用」,后一种写法会让模型在用户说「明天出门要带伞吗」的时候也想到它。Day 11 会专门花一整天讲工具描述怎么写,今天先记住这一条。

手写 schema 很快会烦,而且容易和函数签名对不上。Python 里常见的做法是用 pydantic 生成:

```python
# agent-60-lab/w2/schema_from_pydantic.py
from typing import Literal

from pydantic import BaseModel, Field


class GetWeatherArgs(BaseModel):
    city: str = Field(description="城市名,中文或英文都可以,例如 '北京'、'Shanghai'")
    unit: Literal["celsius", "fahrenheit"] = Field(default="celsius", description="温度单位")


schema = GetWeatherArgs.model_json_schema()
print(schema)
# 输出大致长这样:
# {'properties': {'city': {'description': ..., 'title': 'City', 'type': 'string'},
#                 'unit': {'default': 'celsius', 'enum': ['celsius', 'fahrenheit'], ...}},
#  'required': ['city'], 'title': 'GetWeatherArgs', 'type': 'object'}
```

<div class="line-notes">

- `from typing import Literal` `Literal["a", "b"]` 表示只能取这几个字面值,生成 schema 时变成 `enum`。
- `from pydantic import BaseModel, Field` `BaseModel` 是 pydantic 的模型基类,`Field` 给字段加描述、默认值、约束。
- `class GetWeatherArgs(BaseModel):` 用一个类描述「参数长什么样」,类似 TS 写一个 `interface GetWeatherArgs` 再用 zod 生成 schema。
- `city: str = Field(description=` 没有 `default`,所以 city 是必填。实测生成 `'city': {'description': "城市名,…", 'title': 'City', 'type': 'string'}`,`title` 是 pydantic 按字段名自动加的。
- `unit: Literal["celsius", "fahrenheit"] = Field(default="celsius"` 有默认值所以不必填。实测生成 `'unit': {'default': 'celsius', 'description': '温度单位', 'enum': ['celsius', 'fahrenheit'], 'title': 'Unit', 'type': 'string'}`。
- `schema = GetWeatherArgs.model_json_schema()` 类方法,直接从类生成 JSON Schema 字典,不用先建实例。
- `print(schema)` 实测输出(一行):<br>`{'properties': {'city': {...}, 'unit': {...}}, 'required': ['city'], 'title': 'GetWeatherArgs', 'type': 'object'}`<br>和上面手写的 `parameters` 对比,只多了 `title`,`required` 也自动算对了(只有 city)。要用它做工具定义,把这个字典放进 `"parameters"` 就行。

</div>

直接 `print` 字典会挤成一长行,很难看。想在控制台里看成缩进好的 JSON,把最后的 `print(schema)` 换成:

```python
import json  # 放到文件开头

print(json.dumps(schema, ensure_ascii=False, indent=2))
```

`indent=2` 负责换行和缩进,`ensure_ascii=False` 让中文原样显示,不变成 `\uXXXX`。效果和 TS 里的 `JSON.stringify(obj, null, 2)` 一样。后面打印 messages、工具结果都可以这么写。顺便分清一对名字:`json.dumps` 是 Python 对象(dict、list)→ JSON 字符串,对应 TS 的 `JSON.stringify`;`json.loads` 反过来,字符串 → 对象,对应 `JSON.parse`。末尾的 s 指 string;不带 s 的 `json.dump` / `json.load` 是直接写文件、读文件。

pydantic 生成的 schema 多了 `title` 之类的字段,模型不在乎,大多数厂商也能接受。好处是同一个类以后还能拿来校验模型给的参数,Day 6 学的校验加重试可以直接复用。明天手写 Agent 循环时,我们会再进一步,直接从函数的类型标注生成 schema。

## 第一次跑通:让模型查天气

先准备一个真的天气函数。我用 Open-Meteo,它免费、不用注册、国内能直连,分两步:先用地理编码接口把城市名换成经纬度,再查当前天气。

```python
# agent-60-lab/w2/weather.py
import httpx

WMO = {0: "晴", 1: "大致晴", 2: "多云", 3: "阴", 45: "雾", 61: "小雨", 63: "中雨", 65: "大雨", 71: "小雪", 95: "雷暴"}


def get_weather(city: str, unit: str = "celsius") -> dict:
    geo = httpx.get(
        "https://geocoding-api.open-meteo.com/v1/search",
        params={"name": city, "count": 1, "language": "zh"},
        timeout=10,
    ).json()
    if not geo.get("results"):
        return {"error": f"找不到城市 '{city}',请换个写法,比如用英文名或加上省份"}
    place = geo["results"][0]
    cur = httpx.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": place["latitude"],
            "longitude": place["longitude"],
            "current": "temperature_2m,weather_code,wind_speed_10m",
            "temperature_unit": unit,
        },
        timeout=10,
    ).json()["current"]
    return {
        "city": place["name"],
        "country": place.get("country"),
        "temperature": cur["temperature_2m"],
        "unit": unit,
        "weather": WMO.get(cur["weather_code"], f"天气代码 {cur['weather_code']}"),
        "wind_kmh": cur["wind_speed_10m"],
    }


if __name__ == "__main__":
    print(get_weather("北京"))
```

<div class="line-notes">

- `import httpx` HTTP 客户端,用法和 requests 几乎一样,另外还支持 async。相当于 Node 里的 axios。
- `WMO = {0: "晴"` Open-Meteo 返回的天气是数字代码(WMO 标准),这张表把常见代码翻成中文。实测北京这次返回 `weather_code: 0`,查表得「晴」。
- `def get_weather(city: str, unit: str = "celsius") -> dict:` 参数名 `city`、`unit` 必须和工具 schema 里的字段名一样,后面才能 `get_weather(**args)` 直接展开调用。
- `geo = httpx.get(` 第一步:地理编码,把城市名换成经纬度。
- `params={"name": city, "count": 1, "language": "zh"},` `params` 会拼成查询串 `?name=北京&count=1&language=zh`。`count=1` 只要最匹配的一个,`language=zh` 让返回的名字是中文。
- `timeout=10,` 最多等 10 秒。httpx 默认超时只有 5 秒,国内连 Open-Meteo 偶尔慢,放宽一点。
- `).json()` 把响应体解析成 dict。实测北京返回(节选):<br>`{"results": [{"id": 1816670, "name": "北京", "latitude": 39.9075, "longitude": 116.39723, "country": "中国", "admin1": "北京市", ...}], "generationtime_ms": 0.14}`
- `if not geo.get("results"):` 查不到时接口不报错,只是没有 `results` 这个键。实测 `火星城` 返回 `{'generationtime_ms': 0.0895}`,`.get("results")` 得 None,`not None` 为 True。用 `.get` 而不是 `geo["results"]`,是为了键不存在时不抛 KeyError。
- `return {"error": f"找不到城市` 不抛异常,而是返回一个带 error 的字典。实测 `get_weather("火星城")` 返回 `{'error': "找不到城市 '火星城',请换个写法,比如用英文名或加上省份"}`。模型看到这句会换个写法再调。
- `place = geo["results"][0]` 取第一个(也是唯一一个)结果,就是上面那个北京的 dict。
- `cur = httpx.get(` 第二步:用经纬度查当前天气。
- `"latitude": place["latitude"],` 代入得 `39.9075`,下一行经度是 `116.39723`。
- `"current": "temperature_2m,weather_code,wind_speed_10m",` 逗号分隔要哪些「当前值」:2 米高处气温、天气代码、10 米高处风速。
- `"temperature_unit": unit,` 直接把模型给的单位透传给接口。实测 `get_weather("Shanghai", "fahrenheit")` 得到 `temperature: 61.2`,接口已经换算好了。
- `).json()["current"]` 响应很长,这里只取 `current` 部分。实测:`{"time": "2026-10-21T23:00", "interval": 900, "temperature_2m": 4.5, "weather_code": 0, "wind_speed_10m": 0.6}`(时间是 UTC,北京当时是早上 7 点)。
- `"city": place["name"],` 用接口返回的标准名字,而不是用户输入的原词。
- `"country": place.get("country"),` 个别地点没有 country 字段,用 `.get` 拿不到时就是 None。
- `"weather": WMO.get(cur["weather_code"], f"天气代码` `dict.get(键, 默认值)`:表里有就翻译,没有就返回「天气代码 80」这样的原样提示,不会因为表没写全而崩溃。
- `if __name__ == "__main__":` 直接运行这个模块时才执行,被 import 时不执行。
- `print(get_weather("北京"))` 实测输出:`{'city': '北京', 'country': '中国', 'temperature': 4.5, 'unit': 'celsius', 'weather': '晴', 'wind_kmh': 0.6}`。这就是之后要交给模型的工具结果。

</div>

先在仓库根目录单独跑一下 `uv run python -m w2.weather`,确认这个函数自己没问题。这是个好习惯:工具本身先用普通单元测试的方式跑通,再交给模型。不然出了错,你分不清是模型参数填错了还是工具本身就坏了。

然后是今天的主角,一次完整往返:

```python
# agent-60-lab/w2/day08_roundtrip.py
import json
import os
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI

from w2.tools_def import WEATHER_TOOL
from w2.weather import get_weather

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
MODEL = os.environ["LLM_MODEL"]

# SDK 给每种消息都定义了严格的类型,手拼的字典(尤其带 reasoning_content 这种扩展字段)对不上,
# 这里直接放宽成 Any;Day 3 的 LLMClient 内部也是用 dict[str, Any] 绕过去的
messages: list[Any] = [
    {"role": "system", "content": "你是一个简洁的中文助手。需要实时信息时使用工具,不要编造。"},
    {"role": "user", "content": "北京现在多少度?出门要穿外套吗?"},
]

# 第一次请求:带上 tools
resp = client.chat.completions.create(model=MODEL, messages=messages, tools=[WEATHER_TOOL])
msg = resp.choices[0].message
print("finish_reason:", resp.choices[0].finish_reason)
print("content:", msg.content)
print("tool_calls:", msg.tool_calls)

if msg.tool_calls:
    # 1. 先把模型这条 assistant 消息原样放回历史(包括 tool_calls)
    assistant = {"role": "assistant", "content": msg.content, "tool_calls": [tc.model_dump() for tc in msg.tool_calls]}
    reasoning = getattr(msg, "reasoning_content", None)  # DeepSeek 思考模式会多这个字段,下文解释
    if reasoning:
        assistant["reasoning_content"] = reasoning
    messages.append(assistant)

    # 2. 逐个执行,每个结果一条 tool 消息,用 tool_call_id 对上号
    for tc in msg.tool_calls:
        if tc.type != "function":  # 还有一种 custom 工具,我们没定义,跳过;这一行也让编辑器知道下面 tc.function 一定存在
            continue
        args = json.loads(tc.function.arguments)
        result = get_weather(**args) if tc.function.name == "get_weather" else {"error": "未知工具"}
        messages.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps(result, ensure_ascii=False)})

    # 第二次请求:模型看到工具结果,写最终回答
    final = client.chat.completions.create(model=MODEL, messages=messages, tools=[WEATHER_TOOL])
    print("最终回答:", final.choices[0].message.content)
```

<div class="line-notes">

- `from typing import Any` `Any` 表示「任何类型都行」,下面用来放宽 messages 的类型检查。
- `from dotenv import load_dotenv` 读 `.env` 文件,把里面的 `LLM_BASE_URL` 等写进环境变量。
- `from w2.tools_def import WEATHER_TOOL` 从同一个包导入。前提是在仓库根目录用 `python -m w2.day08_roundtrip` 运行,否则找不到 `w2`。
- `load_dotenv()` 执行后 `os.environ["LLM_MODEL"]` 就能读到值。按 Day 3 的 `.env`,这里是 `deepseek-flash`。
- `client = OpenAI(base_url=` 用 OpenAI SDK 连 DeepSeek:`base_url` 换成 `https://api.deepseek.com`,协议是一样的。
- `messages: list[Any] = [` 初始历史两条:system 定规矩,user 提问题。
- `{"role": "system", "content": "你是一个简洁的中文助手。` 「需要实时信息时使用工具,不要编造」这句是在推模型去调工具,而不是凭记忆瞎报一个温度。
- `resp = client.chat.completions.create(model=MODEL, messages=messages, tools=[WEATHER_TOOL])` 第一次请求,多了 `tools` 参数。实测用量:输入 382 token、输出 70 token。工具定义本身也算在输入 token 里。
- `msg = resp.choices[0].message` 取第一个候选的消息。`choices` 是列表,没传 `n` 时只有一个。
- `print("finish_reason:"` 实测打印 `finish_reason: tool_calls`,表示模型这一轮是要调工具,不是说完了。
- `print("content:", msg.content)` 实测 DeepSeek 返回的是空字符串 `''`,所以打印出来 `content:` 后面什么都没有。OpenAI 等厂商这里常给 None,两种都要能处理,判断时用 `if not msg.content`。
- `print("tool_calls:", msg.tool_calls)` 实测:<br>`[ChatCompletionMessageFunctionToolCall(id='call_00_z118lSyFuQ7eGmPyXnZr3190', function=Function(arguments='{"city": "北京", "unit": "celsius"}', name='get_weather'), type='function', index=0)]`<br>注意 arguments 是字符串。
- `if msg.tool_calls:` 列表非空就是要调工具。模型直接回答时这里是 None,下面整段跳过。
- `assistant = {"role": "assistant"` 把模型这条消息拼成普通字典(下面正文有详细拆解)。实测拼出来是:<br>`{"role": "assistant", "content": "", "tool_calls": [{"id": "call_00_z118…", "function": {"arguments": "{\"city\": \"北京\", \"unit\": \"celsius\"}", "name": "get_weather"}, "type": "function", "index": 0}]}`<br>`index: 0` 是 DeepSeek 多给的字段,`model_dump()` 原样带上了,DeepSeek 自己认,不影响。
- `reasoning = getattr(msg, "reasoning_content", None)` `getattr(对象, 属性名, 默认值)`:有这个属性就取,没有就返回 None,不会报 AttributeError。实测拿到 68 个字符的思维链:`'The user asks about Beijing weather. I should call the weather tool.'`
- `if reasoning:` 非空字符串为真,于是补进 assistant 字典。带 tools 时 DeepSeek 要求把它回传。
- `messages.append(assistant)` 现在 messages 有 3 条:system、user、assistant。
- `for tc in msg.tool_calls:` 这次只有一个调用,循环跑一次。
- `if tc.type != "function":` 实测 type 就是 `"function"`,不会跳过。这一行的主要作用是让类型检查器知道下面 `tc.function` 一定存在。
- `args = json.loads(tc.function.arguments)` 字符串 → dict:`'{"city": "北京", "unit": "celsius"}'` 变成 `{'city': '北京', 'unit': 'celsius'}`。
- `result = get_weather(**args) if tc.function.name == "get_weather" else {"error": "未知工具"}` 条件表达式 `A if 条件 else B`,相当于 JS 的三元 `条件 ? A : B`。`**args` 把字典展开成 `get_weather(city="北京", unit="celsius")`。实测结果:`{'city': '北京', 'country': '中国', 'temperature': 4.5, 'unit': 'celsius', 'weather': '晴', 'wind_kmh': 0.6}`
- `messages.append({"role": "tool", "tool_call_id": tc.id` 结果作为 tool 消息放回,`tool_call_id` 和上面的 `call_00_z118…` 对上。content 必须是字符串,所以先 `json.dumps`。追加后 4 条的 role 依次是 `['system', 'user', 'assistant', 'tool']`。
- `final = client.chat.completions.create(` 第二次请求,把完整的 4 条历史发回去。实测输入 507 token(比第一次多了工具调用和结果)、输出 61 token。
- `print("最终回答:"` 这次实跑返回:`北京现在 **4.5°C**,天气晴朗,风速很小(0.6 km/h)。出门建议穿外套,最好穿保暖外套或羽绒服……` 数字和工具结果完全一致,说明模型读到了工具结果。

</div>

环境变量用 Day 3 建好的 `.env`(`load_dotenv()` 会读进来),不用再 `export`。在仓库根目录运行:

```bash
uv run python -m w2.day08_roundtrip
```

和 W1 一样用 `-m` 从根目录跑,`from w2.weather import ...` 才找得到。注意这个脚本没用 `LLMClient`,所以 `.env` 里的 `LLM_EXTRA_BODY`(关思考)不会生效,DeepSeek 会开着思考模式跑,正好对应下面「思考模式的一个坑」。

第一次请求打印出来大致长这样(id 每次不同):

```text
finish_reason: tool_calls
content:    (DeepSeek 实测是空字符串 '',有的厂商给 None,也可能是一句「我来查一下」)
tool_calls: [ChatCompletionMessageFunctionToolCall(id='call_00_z118...', function=Function(arguments='{"city": "北京", "unit": "celsius"}', name='get_weather'), type='function', index=0)]
```

### `assistant = {...}` 这一行在干什么

```python
assistant = {"role": "assistant", "content": msg.content, "tool_calls": [tc.model_dump() for tc in msg.tool_calls]}
```

这一行的作用是把模型刚回的这条消息拼成一个普通字典,下一步再放回 `messages`。

为什么要拼一遍?因为 SDK 返回的 `msg` 和它里面的每个 `tc` 都不是字典,而是 pydantic 对象。上面打印出来的 `ChatCompletionMessageToolCall(...)` 就是一个对象。`messages` 里放的都是要发回给 API 的普通字典,所以得先转换。

拆成三块看:

| 片段 | 意思 | TS 类比 |
|---|---|---|
| `"content": msg.content` | 模型说的话,调工具时常常是空的(DeepSeek 给 `''`,有的厂商给 `None`),原样带上 | `content: msg.content` |
| `tc.model_dump()` | pydantic 对象转成普通字典(Day 6 讲过 `model_validate_json` 是字符串→对象,这个反过来是对象→字典) | 把 class 实例转成 plain object |
| `[... for tc in msg.tool_calls]` | 列表推导式,对每个 `tc` 做一次转换,收集成新列表 | `msg.tool_calls.map(tc => toPlain(tc))` |

拼出来的字典大致长这样:

```python
{
    "role": "assistant",
    "content": "",
    "tool_calls": [
        {"id": "call_00_z118...", "type": "function", "index": 0,
         "function": {"name": "get_weather", "arguments": "{\"city\": \"北京\", \"unit\": \"celsius\"}"}},
    ],
}
```

这是 DeepSeek 实跑拼出来的。`index` 不是 OpenAI 标准字段,是 DeepSeek 在 tool call 上多给的,`model_dump()` 会原样带上;发回给 DeepSeek 它自己认,不影响。换别的厂商时如果报「不认识的字段」,就别整个 dump,只挑 `id`、`type`、`function` 三个拼。

为什么一定要把这条放回去?下一步你会给每个工具结果发一条 `tool` 消息,里面带着 `tool_call_id`。API 会往前找,看是哪条 assistant 消息发出了这个 id。如果找不到,就直接报 400。这正是练习 2 要你亲手看到的那个错误。

为什么不直接 `msg.model_dump()` 整条转?也可以,但这样会多带一些值为 `None` 的字段(比如 `refusal`、`audio`),有的兼容厂商看到不认识的字段会报错。只挑 `role`、`content`、`tool_calls` 三个字段来拼,最稳妥。下面的 `reasoning_content` 也是同样的思路:有这个字段就补上,没有就不加。

## 逐字段读响应

这几个字段面试会问,自己写循环时也天天要碰,值得一个个过。

`finish_reason` 变成了 `tool_calls`,而不是平常的 `stop`。这是你判断「模型这一轮是想调工具还是说完了」的信号之一。实际写代码时我更习惯直接判断 `msg.tool_calls` 是否非空,因为个别兼容厂商的 finish_reason 填得不规范。

调工具时 `content` 经常是空的。DeepSeek 实测返回空字符串 `''`,OpenAI 等厂商常常返回 `None`,也有模型会先说一句「我查一下」。你的代码几种情况都要能处理:别对 `None` 直接做字符串拼接,也别用 `content is None` 判断模型「没说话」,写成 `if not msg.content` 才能同时覆盖 `None` 和 `''`。

`tool_calls` 是一个**列表**。一次可以有多个,后面讲并行调用时会看到。每个元素有三个字段。`id` 是这次调用的编号,你回传结果时必须带上同一个 id,模型靠它把结果和请求对上。`type` 目前固定是 `function`。`function` 里有 `name` 和 `arguments`。

`arguments` 是**字符串**,不是字典。新手最常见的写法是直接 `tc.function.arguments["city"]`,得到 `TypeError: string indices must be integers`。它是模型生成的一段 JSON 文本,你得 `json.loads` 一下。既然是模型生成的文本,它就可能不合法:少个引号、多个逗号、字段名拼错、缺了 required 字段。大部分时候不会,但跑一万次总会碰到几次。所以生产代码里 `json.loads` 一定要包 try,解析失败时把错误信息作为 tool 结果送回去让模型重写,这是 Day 12 的内容。

回传的 tool 消息也有讲究。`role` 是 `tool`,`tool_call_id` 对上刚才的 id,`content` 是字符串,所以字典要先 `json.dumps`。中文记得加 `ensure_ascii=False`,不然模型看到的是一堆 `北京`,能看懂,但 token 数会翻几倍。

还有一条顺序规则:带 `tool_calls` 的 assistant 消息必须紧跟着它的所有 tool 结果消息,中间不能插别的,每个 id 都得有回应。漏回一个,大部分厂商直接返回 400,报错信息里通常会说某个 `tool_call_id` 没有对应的响应。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="第二次请求时 messages 列表的结构">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="28" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">第二次请求的 messages(从上到下)</text>
  <rect x="20" y="45" width="600" height="38" fill="none" stroke="var(--rule)"/>
  <text x="32" y="69" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">system   你是一个简洁的中文助手……</text>
  <rect x="20" y="90" width="600" height="38" fill="none" stroke="var(--rule)"/>
  <text x="32" y="114" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">user     北京现在多少度?出门要穿外套吗?</text>
  <rect x="20" y="135" width="600" height="52" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="32" y="157" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">assistant content=&#39;&#39;</text>
  <text x="32" y="176" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">          tool_calls=[{id: call_0_8f2c, get_weather, {"city":"北京"}}]</text>
  <rect x="20" y="194" width="600" height="52" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="32" y="216" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">tool     tool_call_id=call_0_8f2c</text>
  <text x="32" y="235" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">          content='{"city":"北京","temperature":22.4,"weather":"阴"}'</text>
  <text x="32" y="275" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">id 必须一一对应;assistant 与 tool 之间不能插入别的消息</text>
</svg>
<figcaption>API 是无状态的,第二次请求要把整段历史重新发一遍,模型才知道「刚才我要查天气,结果是这个」。</figcaption>
</figure>

## DeepSeek 思考模式的一个坑

上面代码里有一行处理 `reasoning_content`,单独说一下,因为不加它你在 DeepSeek 上可能会遇到奇怪的报错或效果变差。

2026 年 10 月我查 DeepSeek 文档时,它的模型默认开启思考模式(thinking),回答前先输出一段思维链,放在 `reasoning_content` 字段里,和 `content` 平级。[思考模式文档](https://api-docs.deepseek.com/guides/thinking_mode)写得很明确:**请求里带了 tools 时,之前各轮的 reasoning_content 都应该回传**,会被拼进上下文;不带 tools 时则不需要回传,传了也会被忽略。原因不难理解:模型上一轮想好了「先查天气再判断穿什么」,这个计划如果在下一轮丢了,它就得重新想一遍,还可能想得不一样。

所以写 assistant 消息时,我用 `getattr` 把这个字段带上。别的厂商没有这个字段,`getattr` 返回 None,不影响。你也可以在不需要思考的场景关掉它,DeepSeek 的写法是 `extra_body={"thinking": {"type": "disabled"}}`,速度更快,费用也更低。像查天气这种简单任务,我一般关掉。

这件事的通用教训是:**不同厂商的「OpenAI 兼容」只在主干上兼容**,枝节上各有各的扩展字段。你的代码要对多余字段宽容,同时读一遍目标厂商自己的工具调用文档。DeepSeek 的 strict 模式(让服务端强制参数符合 schema)目前也还是 Beta,要把 base URL 换成带 `/beta` 后缀的地址才能用(具体写法见下方 DeepSeek 文档链接),而且要求 schema 里所有字段都列进 required、`additionalProperties` 设成 false。

## 并行工具调用和 tool_choice

用户问「北京和上海哪个更热?」,模型需要两份天气。聪明的模型会在一次响应里给出两个 tool_calls,而不是查完北京再发一轮请求查上海。这就是并行工具调用(parallel tool calls)。

```python
# agent-60-lab/w2/day08_parallel.py
import asyncio
import json
import os
import time
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI
from openai.types.chat import ChatCompletionMessageFunctionToolCall

from w2.tools_def import WEATHER_TOOL
from w2.weather import get_weather

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
MODEL = os.environ["LLM_MODEL"]


async def run_one(tc: ChatCompletionMessageFunctionToolCall) -> dict:
    args = json.loads(tc.function.arguments)
    # get_weather 是普通同步函数,用 to_thread 丢进线程池,gather 才能让两个调用同时跑
    result = await asyncio.to_thread(get_weather, **args)
    return {"role": "tool", "tool_call_id": tc.id, "content": json.dumps(result, ensure_ascii=False)}


async def main() -> None:
    messages: list[Any] = [
        {"role": "system", "content": "你是一个简洁的中文助手。需要实时信息时使用工具,不要编造。"},
        {"role": "user", "content": "北京和上海现在哪个更热?"},
    ]
    resp = client.chat.completions.create(model=MODEL, messages=messages, tools=[WEATHER_TOOL])
    msg = resp.choices[0].message

    # 只留 function 类型的调用;过滤后编辑器知道每个 tc 都有 .function
    calls = [tc for tc in msg.tool_calls or [] if tc.type == "function"]
    print(f"模型一次给了 {len(calls)} 个调用:")
    for tc in calls:
        print(" ", tc.id, tc.function.name, tc.function.arguments)
    if not calls:
        print("模型没调工具,直接回答:", msg.content)
        return

    assistant: dict[str, Any] = {
        "role": "assistant",
        "content": msg.content,
        "tool_calls": [tc.model_dump() for tc in calls],
    }
    reasoning = getattr(msg, "reasoning_content", None)
    if reasoning:
        assistant["reasoning_content"] = reasoning
    messages.append(assistant)

    t0 = time.perf_counter()
    tool_msgs = await asyncio.gather(*(run_one(tc) for tc in calls))  # 结果顺序和 calls 一致
    print(f"并发执行 {len(calls)} 个工具用时 {time.perf_counter() - t0:.2f}s")
    messages.extend(tool_msgs)

    final = client.chat.completions.create(model=MODEL, messages=messages, tools=[WEATHER_TOOL])
    print("最终回答:", final.choices[0].message.content)


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `import asyncio` Python 的异步库,下面用它的 `gather` 让两个天气查询同时跑。
- `import time` 用 `time.perf_counter()` 计时,看并发到底省了多少时间。
- `from openai.types.chat import ChatCompletionMessageFunctionToolCall` 「function 类型的工具调用」这个类,只用来给 `run_one` 的参数做类型标注。
- `async def run_one(tc: ChatCompletionMessageFunctionToolCall) -> dict:` 处理单个调用:解析参数 → 执行 → 包成 tool 消息。`async def` 定义的是协程函数,调用它不会立刻执行。
- `args = json.loads(tc.function.arguments)` 实测两次分别是 `{'city': '北京', 'unit': 'celsius'}` 和 `{'city': '上海', 'unit': 'celsius'}`。
- `result = await asyncio.to_thread(get_weather, **args)` `get_weather` 用的是同步 httpx,直接调用会卡住事件循环,两个查询只能排队。`to_thread` 把它放到线程池里跑,`await` 等它结束。注意写法是 `to_thread(函数, 参数)`,不是 `to_thread(get_weather(**args))`,后者会先在当前线程同步执行完。
- `return {"role": "tool", "tool_call_id": tc.id` 每个调用各自生成一条 tool 消息,id 对应各自的调用。
- `async def main() -> None:` 主流程也写成协程,因为里面要 `await gather`。
- `{"role": "user", "content": "北京和上海现在哪个更热?"}` 要回答这个问题需要两份互不依赖的数据,正好用来触发并行调用。
- `resp = client.chat.completions.create(` 这里用的还是同步 client,请求模型这一步不需要并发。
- `calls = [tc for tc in msg.tool_calls or [] if tc.type == "function"]` 拆开看:`msg.tool_calls or []` 在没有调用时(None)换成空列表,这样 for 不会报错;`if tc.type == "function"` 过滤掉其他类型。实测原始 tool_calls 的 type 是 `['function', 'function']`,过滤后 `calls` 还是 2 个。
- `print(f"模型一次给了 {len(calls)} 个调用:")` 实测:`模型一次给了 2 个调用:`
- `print(" ", tc.id, tc.function.name, tc.function.arguments)` 实测两行:<br>`call_00_VU7VINSpPs9bArs5LfT70899 get_weather {"city": "北京", "unit": "celsius"}`<br>`call_01_MyExPtWxFxSiNb9GMHNj6635 get_weather {"city": "上海", "unit": "celsius"}`<br>DeepSeek 的 id 里 `00`、`01` 是序号。
- `if not calls:` 模型有时会不调工具直接回答,这时打印它的回答就结束。
- `assistant: dict[str, Any] = {` 和往返脚本一样,把 assistant 消息拼回去。这里只放过滤后的 `calls`,和后面要回传的 tool 消息一一对应。
- `messages.append(assistant)` 此时 messages 有 3 条。
- `t0 = time.perf_counter()` 记下开始时间(单位秒,只用来做差值)。
- `tool_msgs = await asyncio.gather(` 两个 `run_one` 同时开跑,全部结束后按传入顺序返回。实测 `tool_msgs[0]` 是北京(`call_00_…`,4.5 度),`tool_msgs[1]` 是上海(`call_01_…`,16.2 度,多云)。
- `print(f"并发执行 {len(calls)} 个工具用时` 这次实测 `3.73s`。我在同一次运行里又串行调了一遍做对照,用了 `8.93s`。每次地理编码加天气查询都要两个网络请求,并发确实省了一半多。
- `messages.extend(tool_msgs)` 两条 tool 消息逐个追加。现在 role 依次是 `['system', 'user', 'assistant', 'tool', 'tool']`。
- `final = client.chat.completions.create(` 第二次请求,模型看到两份天气。
- `print("最终回答:"` 这次实跑返回:`上海更热:16.2°C(多云)vs 北京 4.5°C(晴),相差约 11.7°C。`
- `asyncio.run(main())` 启动事件循环,运行 `main()` 直到结束。整个程序只调用这一次。

</div>

在仓库根目录运行 `uv run python -m w2.day08_parallel`,我跑出来是这样(id 每次不同):

```text
模型一次给了 2 个调用:
  call_00_R4B8MC1P... get_weather {"city": "北京"}
  call_01_NEXyvMXv... get_weather {"city": "上海"}
并发执行 2 个工具用时 …s(看网络)
最终回答: 上海更热。上海 17.7℃,阴;北京 11.9℃,晴。上海比北京高约 5.8℃。
```

如果报 `httpx.ConnectTimeout`,是到 Open-Meteo 的网络抖了一下,不是代码问题,重跑一次就行。

处理方式和单个调用一样:assistant 消息原样放回,每个调用一条 tool 消息。区别在于两个调用之间没有依赖,可以并发执行,省一半等待时间。上面用的就是 Day 2 学的 `asyncio.gather`;`get_weather` 是同步函数,所以先用 `asyncio.to_thread` 包一层放进线程,不然 gather 也只能一个一个跑。Day 13 讲并行模式时还会再用。

`main()` 里最关键的是这三行,逐个拆开:

```python
tool_msgs = await asyncio.gather(*(run_one(tc) for tc in calls))
print(f"并发执行 {len(calls)} 个工具用时 {time.perf_counter() - t0:.2f}s")
messages.extend(tool_msgs)
```

| 片段 | 意思 | TS 类比 |
| --- | --- | --- |
| `run_one(tc) for tc in calls` | 生成器表达式:对每个调用生成一个 `run_one(tc)`。`run_one` 是 `async def`,调用它只是拿到一个还没开始跑的协程,不会立刻执行 | `calls.map(tc => runOne(tc))`,区别是 JS 的 Promise 一创建就开始跑 |
| `*(...)` | 把这一串拆开,当成多个参数传进去,等于 `gather(a, b, c)` | 展开运算符 `...` |
| `await asyncio.gather(...)` | 让这些协程同时跑,全部完成后返回结果列表,顺序和传入顺序一致,和谁先跑完无关 | `await Promise.all([...])` |
| `time.perf_counter() - t0` | 现在的时间减去开始前记下的 `t0`,单位秒 | `performance.now() - t0`,不过那个是毫秒 |
| `:.2f` | f-string 格式说明:保留两位小数 | `.toFixed(2)` |
| `messages.extend(tool_msgs)` | 把列表里每个元素逐个追加进 `messages`。用 `append` 的话会把整个列表当成一个元素塞进去,变成嵌套列表,API 会报错 | `messages.push(...toolMsgs)` |

要注意的是「模型给了多个调用」不等于「它们一定没有依赖」,比如模型同时请求「创建订单」和「查询订单」,并发执行就可能查不到。对有副作用的工具,保守的做法是按顺序执行。OpenAI 提供了 `parallel_tool_calls=False` 参数可以关掉这个行为,其他厂商支持情况不一,用之前查一下。

`tool_choice` 控制模型「要不要用工具」。先别和前面的 `tool_calls` 搞混:**`tool_choice` 是你发给模型的请求参数,`tool_calls` 是模型回给你的响应字段**,方向正好相反。前者规定这一轮能不能、必须不必须用工具,后者是模型实际要调的工具和参数。用 TS 类比,`tool_choice` 像传进函数的 `options.mode`,`tool_calls` 是函数的返回值。

| | `tool_choice` | `tool_calls` |
| --- | --- | --- |
| 方向 | 你 → 模型(请求参数) | 模型 → 你(响应字段) |
| 写在哪 | `create(..., tool_choice=...)` | `resp.choices[0].message.tool_calls` |
| 取值 | `"auto"` / `"none"` / `"required"` / 指定函数 | 列表,每项有 `id`、`function.name`、`function.arguments` |

它的几种取值,以及各自对 `tool_calls` 的影响:

- `"auto"`(默认):模型自己决定,`tool_calls` 可能有也可能是 `None`。
- `"none"`:这一轮禁止用工具,即使 tools 里有,`tool_calls` 一定为空。适合「工具查完了,现在只许总结」的场景。
- `"required"`:必须至少调一个工具,`tool_calls` 至少一项。适合你明确知道这一步就是要分类或抽取的时候。
- `{"type": "function", "function": {"name": "get_weather"}}`:指定必须调这一个,`tool_calls` 里一定是它。练习 4 就靠这个保证一定能读到抽取结果。

`required` 和指定函数有个很实用的副作用:可以把 function calling 当成「结构化输出」来用。比如你定义一个 `classify_ticket(category, priority)` 工具,强制模型调用它,拿到的 arguments 就是你要的结构化结果,根本不用真的执行什么。在一些不支持 JSON Schema 输出的老模型上,这是最稳的抽取方式。

## 同样的事,用 Anthropic 的写法

面试官可能会问「OpenAI 和 Claude 的工具调用格式有什么区别」,你自己做多厂商适配时也得知道。概念完全一样,只是字段名和放的位置不同:

| 环节 | OpenAI 兼容协议 | Anthropic Messages API |
| --- | --- | --- |
| 定义工具 | `{"type":"function","function":{"name","description","parameters"}}` | `{"name","description","input_schema"}`,少一层包装 |
| 模型请求调用 | `message.tool_calls[]`,参数在 `function.arguments`(字符串) | `content` 里出现 `type: "tool_use"` 的块,参数在 `input`(已经是对象) |
| 判断信号 | `finish_reason == "tool_calls"` | `stop_reason == "tool_use"` |
| 回传结果 | 单独一条 `role: "tool"` 消息,带 `tool_call_id` | 放在下一条 `role: "user"` 消息的 content 里,`type: "tool_result"`,带 `tool_use_id` |
| 强制调用 | `tool_choice: "required"` 或指定函数 | `tool_choice: {"type": "any"}` 或 `{"type": "tool", "name": ...}` |

```python
# agent-60-lab/w2/day08_anthropic.py
import json
import os

import anthropic

from w2.weather import get_weather

client = anthropic.Anthropic()  # 读 ANTHROPIC_API_KEY
MODEL = os.environ["ANTHROPIC_MODEL"]  # 用控制台里当前可用的 Claude 模型名
tools = [{
    "name": "get_weather",
    "description": "查询某个城市当前的天气。用户问到天气、气温、要不要带伞时使用。",
    "input_schema": {
        "type": "object",
        "properties": {"city": {"type": "string", "description": "城市名"}},
        "required": ["city"],
    },
}]
messages = [{"role": "user", "content": "北京现在多少度?"}]

resp = client.messages.create(model=MODEL, max_tokens=1024, tools=tools, messages=messages)
if resp.stop_reason == "tool_use":
    messages.append({"role": "assistant", "content": resp.content})  # 整个 content 列表原样放回
    results = []
    for block in resp.content:
        if block.type == "tool_use":
            out = get_weather(**block.input)  # input 已经是 dict,不用 json.loads
            results.append({"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(out, ensure_ascii=False)})
    messages.append({"role": "user", "content": results})
    final = client.messages.create(model=MODEL, max_tokens=1024, tools=tools, messages=messages)
    print(final.content[0].text)
```

<div class="line-notes">

- `import anthropic` Anthropic 官方 SDK。这段没有实跑(需要 Claude 的 key),下面的数据是按协议格式举的例子。
- `client = anthropic.Anthropic()` 不传参数时,SDK 自动读环境变量 `ANTHROPIC_API_KEY`。
- `tools = [{` 工具定义少了一层 `{"type": "function", "function": {...}}` 包装,直接是 name/description/input_schema。
- `"input_schema": {` 就是 OpenAI 那边的 `parameters`,换了个名字,内容一样是 JSON Schema。
- `messages = [{"role": "user"` 没有 system 消息。Anthropic 的 system 是 `create()` 的单独参数,不放在 messages 里。
- `resp = client.messages.create(model=MODEL, max_tokens=1024` Anthropic 要求必须传 `max_tokens`,OpenAI 可以不传。
- `if resp.stop_reason == "tool_use":` 对应 OpenAI 的 `finish_reason == "tool_calls"`。
- `messages.append({"role": "assistant", "content": resp.content})` `resp.content` 是一个内容块列表,比如 `[TextBlock(text="我查一下"), ToolUseBlock(id="toolu_01…", name="get_weather", input={"city": "北京"})]`。整个列表原样放回,SDK 认自己的对象,不用转成字典。
- `for block in resp.content:` 遍历内容块,只处理 `tool_use` 类型的,文字块跳过。
- `out = get_weather(**block.input)` `block.input` 已经是 dict(比如 `{"city": "北京"}`),不用 `json.loads`,这是和 OpenAI 最明显的区别。
- `results.append({"type": "tool_result", "tool_use_id": block.id` 结果用 `tool_use_id` 对上号,对应 OpenAI 的 `tool_call_id`。
- `messages.append({"role": "user", "content": results})` 工具结果放在一条 **user** 消息里,不是单独的 tool 角色。
- `print(final.content[0].text)` 最终回答也是内容块列表,取第一个文本块的 `.text`。

</div>

这段**看懂对照表就行,不要求跑**:要跑得有 Claude 的 API key,还要 `uv add anthropic`,并在 `.env` 里加 `ANTHROPIC_API_KEY` 和 `ANTHROPIC_MODEL`。没有 key 的话编辑器会在 `import anthropic` 下画红线,不用管。

我个人觉得 Anthropic 的设计在两处更顺手:`input` 直接是对象,少一次解析;工具结果被看作「用户那边返回的信息」,放在 user 消息里,语义上也说得通。OpenAI 的单独 tool 角色则在日志里更好认。两种都要会,真到项目里通常用一层自己的适配代码把差异抹平,Day 27 讲框架时你会看到各家 SDK 都在做这件事。

## 模型怎么学会这件事的(只讲直觉)

你可能好奇,模型怎么知道该在什么时候输出 tool_calls?直觉版是这样:厂商在训练数据里放了大量「对话中途需要外部信息,于是输出一段特定格式的调用,然后看到结果,再继续回答」的样本。你传进去的 tools 定义,会被服务端按模型训练时见过的格式渲染进提示词(通常在 system 部分)。模型生成调用时,服务端再把那段特殊格式的文本解析成你看到的 `tool_calls` 结构。

这解释了几件事。工具定义要占 token,而且每次请求都占,工具越多越贵,这也是 Day 11 要讲「工具数量太多怎么办」的原因。工具描述写得好坏直接影响效果,因为它就是提示词的一部分。不同模型的工具调用能力差别很大,小模型经常乱填参数或者该调不调,这不是你代码的问题,是模型训练得不够,选型时要测。

早期没有原生 function calling 时,大家是在提示词里约定「如果你要用工具,请输出 `Action: 工具名[参数]`」,再用正则去抠。这就是 Day 10 要讲的 ReAct 的原始做法。原生 function calling 本质上是把这套约定标准化、并且专门训练过,所以更稳。

## 动手练习

**练习 1:跑通往返并打印完整 messages。** 运行 `day08_roundtrip.py`,在第二次请求前加一行 `print(json.dumps(messages, ensure_ascii=False, indent=2))`,亲眼看一遍发给模型的完整历史。把 `ensure_ascii=False` 去掉再看一次 tool 消息长什么样。

加在 `day08_roundtrip.py` 的这个位置(for 循环结束之后、第二次请求之前):

```python
    for tc in msg.tool_calls:
        ...  # 原来的执行代码不动

    print(json.dumps(messages, ensure_ascii=False, indent=2))  # ← 加这一行
    print(json.dumps(messages[-1], indent=2))                  # ← 对照:不加 ensure_ascii=False 的 tool 消息

    # 第二次请求:模型看到工具结果,写最终回答
    final = client.chat.completions.create(model=MODEL, messages=messages, tools=[WEATHER_TOOL])
```

`messages` 里的 assistant 那条已经是普通字典了(上面 `model_dump()` 转过),所以 `json.dumps` 能直接打印。

**练习 2:故意漏回一个结果。** 用「北京和上海哪个热」触发两个 tool_calls,只回传第一个的结果就发第二次请求,记下厂商返回的错误码和报错原文。这个报错你以后一定会再见到,先认识它。

```python
# agent-60-lab/w2/day08_missing_result.py
import json
import os
from typing import Any

from dotenv import load_dotenv
from openai import BadRequestError, OpenAI

from w2.tools_def import WEATHER_TOOL
from w2.weather import get_weather

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
MODEL = os.environ["LLM_MODEL"]

messages: list[Any] = [
    {"role": "system", "content": "你是一个简洁的中文助手。需要实时信息时使用工具,不要编造。"},
    {"role": "user", "content": "北京和上海现在哪个更热?"},
]
resp = client.chat.completions.create(model=MODEL, messages=messages, tools=[WEATHER_TOOL])
msg = resp.choices[0].message
calls = [tc for tc in msg.tool_calls or [] if tc.type == "function"]
if len(calls) < 2:
    raise SystemExit(f"这次模型只给了 {len(calls)} 个调用,重跑一次,或者把问题改成「北京、上海、广州哪个最热」")

assistant: dict[str, Any] = {"role": "assistant", "content": msg.content, "tool_calls": [tc.model_dump() for tc in calls]}
reasoning = getattr(msg, "reasoning_content", None)
if reasoning:
    assistant["reasoning_content"] = reasoning
messages.append(assistant)

# 故意只回传第一个调用的结果,第二个 id 没有对应的 tool 消息
first = calls[0]
result = get_weather(**json.loads(first.function.arguments))
messages.append({"role": "tool", "tool_call_id": first.id, "content": json.dumps(result, ensure_ascii=False)})
print("已回传:", first.id, "  漏掉:", [tc.id for tc in calls[1:]])

try:
    client.chat.completions.create(model=MODEL, messages=messages, tools=[WEATHER_TOOL])
    print("居然没报错:这家厂商对缺失的 tool 结果比较宽容,看看最终回答里它是不是编了上海的温度")
except BadRequestError as e:
    print("状态码:", e.status_code)
    print("报错原文:", e.message)
```

<div class="line-notes">

- `from openai import BadRequestError, OpenAI` `BadRequestError` 是 SDK 对 HTTP 400 的异常类,下面专门 catch 它。
- `{"role": "user", "content": "北京和上海现在哪个更热?"}` 用两个城市的问题,让模型一次给出两个调用,才有东西可以「漏」。
- `calls = [tc for tc in msg.tool_calls or [] if tc.type == "function"]` 实测 2 个调用:`call_00_swbILejPk8JCzB9R48oc7227`(北京)和 `call_01_lwpdX5eEIIjjrZ1OcCjx3865`(上海)。
- `if len(calls) < 2:` 前置检查,不够两个调用就没法做实验。这次是 2 个,通过。
- `raise SystemExit(f"这次模型只给了` 打印这句话后退出,不打 traceback。
- `assistant: dict[str, Any] = {"role": "assistant"` assistant 消息里**两个调用都放了**,这是故意的:API 会检查后面是不是两个 id 都有回应。
- `first = calls[0]` 只拿北京那个。
- `result = get_weather(**json.loads(first.function.arguments))` 解析和调用写在一行:`json.loads` 得到 `{'city': '北京', 'unit': 'celsius'}`,`**` 展开后调用。
- `messages.append({"role": "tool", "tool_call_id": first.id` 只回传了 `call_00_…` 这一条。
- `print("已回传:", first.id, "  漏掉:", [tc.id for tc in calls[1:]])` `calls[1:]` 是从第二个开始的切片。实测:`已回传: call_00_swbILejPk8JCzB9R48oc7227   漏掉: ['call_01_lwpdX5eEIIjjrZ1OcCjx3865']`
- `client.chat.completions.create(model=MODEL, messages=messages, tools=[WEATHER_TOOL])` 发出去后,DeepSeek 在服务端校验消息顺序,直接返回 400,所以下一行的 print 不会执行。
- `except BadRequestError as e:` 400 被 SDK 转成这个异常,`as e` 拿到异常对象。
- `print("状态码:", e.status_code)` 实测 `400`。
- `print("报错原文:", e.message)` 实测:<br>`Error code: 400 - {'error': {'message': "An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. (insufficient tool messages following tool_calls message) (request_id: …)", 'type': 'invalid_request_error', ...}}`<br>关键句:带 tool_calls 的 assistant 消息后面,每个 tool_call_id 都必须有一条 tool 消息回应。

</div>

`uv run python -m w2.day08_missing_result`,DeepSeek 上我跑出来是:

```text
已回传: call_00_5nwKCaKr...   漏掉: ['call_01_FVBtLS3a...']
状态码: 400
报错原文: ... An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. (insufficient tool messages following tool_calls message) ...
```

脚本开头那个 `if len(calls) < 2: raise SystemExit(...)` 是个前置检查。这个练习要「两个调用只回一个」,可模型偶尔会只给一个调用(比如只查了北京),那就没东西可漏,后面的实验没意义。`raise SystemExit("...")` 的效果是打印这句话然后结束程序,不像普通异常那样打一大段 traceback,相当于 Node 里的 `console.error(msg); process.exit(1)`。碰到这种情况重跑一次,或者问三个城市,让模型更可能一次给出多个调用。

报错原文直接告诉你违反的是哪条规则:带 `tool_calls` 的 assistant 消息后面,每个 `tool_call_id` 都得有一条 tool 消息回应。`BadRequestError` 是 openai SDK 对 400 的封装,以后写循环时要专门 catch 它。

**练习 3:第二个工具。** 加一个 `calculate(expression: str)` 工具,用下面这个安全的实现(只允许数字和四则运算,绝不用 `eval`):

```python
# agent-60-lab/w2/calc.py
import ast
import operator as op

OPS = {ast.Add: op.add, ast.Sub: op.sub, ast.Mult: op.mul, ast.Div: op.truediv,
       ast.Pow: op.pow, ast.USub: op.neg, ast.Mod: op.mod}


def calculate(expression: str) -> dict:
    def ev(node):
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return node.value
        if isinstance(node, ast.BinOp) and type(node.op) in OPS:
            return OPS[type(node.op)](ev(node.left), ev(node.right))
        if isinstance(node, ast.UnaryOp) and type(node.op) in OPS:
            return OPS[type(node.op)](ev(node.operand))
        raise ValueError(f"不支持的表达式成分: {ast.dump(node)[:40]}")
    try:
        return {"expression": expression, "result": ev(ast.parse(expression, mode="eval").body)}
    except (SyntaxError, ValueError, ArithmeticError, RecursionError) as e:  # 把错误交给模型,让它换个写法
        return {"error": f"无法计算 '{expression}': {e}。只支持数字和 + - * / ** %"}


if __name__ == "__main__":
    print(calculate("(22.4 * 9 / 5) + 32"))
    print(calculate("__import__('os').system('ls')"))
```

<div class="line-notes">

- `import ast` 把字符串解析成语法树,只解析、不执行。
- `import operator as op` `operator` 模块把运算符做成了函数:`op.add(2, 3)` 等于 `2 + 3`。`as op` 是起个短名字。
- `OPS = {ast.Add: op.add` 白名单:AST 运算符类型 → 计算函数。`ast.USub` 是一元负号(`-5` 的那个 `-`)。
- `def calculate(expression: str) -> dict:` 下面用 `calculate("(22.4 * 9 / 5) + 32")` 走一遍。
- `def ev(node):` 函数里套函数,递归地算一个节点。
- `if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):` 递归的终点:数字节点直接返回值。`22.4`、`9`、`5`、`32` 都会走到这里。后半句的检查是为了排除字符串常量,比如 `'os'` 也是 Constant。
- `if isinstance(node, ast.BinOp) and type(node.op) in OPS:` 二元运算。代入,按递归顺序追踪:<br>① 根节点 `... + 32`,先算 left<br>② left 是 `... / 5`,先算它的 left<br>③ `22.4 * 9` → `op.mul(22.4, 9)` = `201.6`<br>④ 回到 ②:`op.truediv(201.6, 5)` = `40.32`<br>⑤ 回到 ①:`op.add(40.32, 32)` = `72.32`
- `return OPS[type(node.op)](ev(node.left), ev(node.right))` `type(node.op)` 是 `ast.Mult` → 查表得 `op.mul` → 用左右两边的结果调用。左右两边各自又是一次 `ev`,这就是递归。
- `if isinstance(node, ast.UnaryOp) and type(node.op) in OPS:` 一元运算。`ast.dump` 看 `-5` 是 `UnaryOp(op=USub(), operand=Constant(value=5))`,算出来是 `op.neg(5)` = `-5`。实测 `-2 ** 2` 得 `-4`,因为 Python 里 `**` 比负号优先级高,等于 `-(2**2)`。
- `raise ValueError(f"不支持的表达式成分: {ast.dump(node)[:40]}")` 白名单以外的一律拒绝。`__import__('os').system('ls')` 的根节点是 `Call`,走到这里,`ast.dump(node)[:40]` 是 `Call(func=Attribute(value=Call(func=Name`。
- `return {"expression": expression, "result": ev(ast.parse(expression, mode="eval").body)}` 从里往外:`ast.parse(..., mode="eval")` 解析成表达式,`.body` 取出根节点,`ev(...)` 算出结果。实测返回 `{'expression': '(22.4 * 9 / 5) + 32', 'result': 72.32}`。
- `except (SyntaxError, ValueError, ArithmeticError, RecursionError) as e:` 实测几种错误:<br>`1 +` → SyntaxError:`invalid syntax (<unknown>, line 1)`<br>`1/0` → ZeroDivisionError(属于 ArithmeticError):`division by zero`<br>`__import__(...)` → 上面自己抛的 ValueError
- `return {"error": f"无法计算 '{expression}': {e}。` 实测 `calculate("1/0")` 返回 `{'error': "无法计算 '1/0': division by zero。只支持数字和 + - * / ** %"}`。后半句告诉模型能用什么,方便它换个写法。
- `print(calculate("(22.4 * 9 / 5) + 32"))` 实测:`{'expression': '(22.4 * 9 / 5) + 32', 'result': 72.32}`
- `print(calculate("__import__('os').system('ls')"))` 实测:`{'error': "无法计算 '__import__('os').system('ls')': 不支持的表达式成分: Call(func=Attribute(value=Call(func=Name。只支持数字和 + - * / ** %"}`。`ls` 根本没有执行。

</div>

### calc.py 逐段读懂

这个文件看着绕,其实只做一件事:**不执行字符串,而是先把算式拆成一棵树,自己一个节点一个节点地算**。用 TS 的话说,就是不用 `eval()`,自己写一个只认加减乘除的小解释器。

**第一步,`ast.parse` 把字符串变成树。** `ast` 是 Python 自带的模块,全称 abstract syntax tree(抽象语法树),Python 自己执行代码前也是先把代码解析成这棵树。它只解析、不执行,所以对恶意字符串是安全的。可以在终端里看一眼:

```python
import ast
print(ast.dump(ast.parse("(22.4 * 9 / 5) + 32", mode="eval").body, indent=2))
```

输出是:

```text
BinOp(
  left=BinOp(
    left=BinOp(
      left=Constant(value=22.4),
      op=Mult(),
      right=Constant(value=9)),
    op=Div(),
    right=Constant(value=5)),
  op=Add(),
  right=Constant(value=32))
```

`BinOp` 是二元运算(左边、运算符、右边),`Constant` 是数字。`mode="eval"` 表示「这是一个表达式」,不是一段多行程序;`.body` 取出表达式本身。前端同学可以类比 Babel、ESLint 用的 AST,是同一个东西。

**第二步,`OPS` 是一张查找表。**

```python
OPS = {ast.Add: op.add, ast.Sub: op.sub, ...}
```

键是 AST 里的运算符类型,值是 `operator` 模块里对应的函数:`op.add(2, 3)` 就是 `2 + 3`,`op.truediv` 是除法,`op.pow` 是乘方,`op.neg` 是取负号。相当于 TS 里 `const OPS = new Map([[Add, (a, b) => a + b], ...])`。这张表就是**白名单**,不在表里的运算一律不认。

**第三步,`ev` 递归地算。** 它定义在 `calculate` 里面(函数里套函数,和 JS 一样合法),对每个节点判断是三种情况中的哪一种:

| 判断 | 意思 | 怎么算 |
| --- | --- | --- |
| `isinstance(node, ast.Constant) and isinstance(node.value, (int, float))` | 是个数字 | 直接返回这个数。`isinstance` 约等于 TS 的 `instanceof`,第二个参数传元组表示「是其中任一种」 |
| `isinstance(node, ast.BinOp) and type(node.op) in OPS` | 二元运算,且运算符在白名单里 | 先递归算左右两边,再用表里的函数算:`OPS[type(node.op)](ev(node.left), ev(node.right))` |
| `isinstance(node, ast.UnaryOp) and type(node.op) in OPS` | 一元运算,比如 `-5` | 递归算操作数,再取负 |

三种都不是,就 `raise ValueError(...)`。`__import__('os').system('ls')` 解析出来是 `Call`(函数调用)节点,不在这三种里,于是直接报「不支持的表达式成分」,根本走不到执行那一步。这就是它比 `eval` 安全的原因:**默认拒绝,只放行白名单**。

`OPS[type(node.op)](...)` 这一行可以拆开读:`type(node.op)` 拿到运算符的类型(比如 `ast.Mult`),`OPS[...]` 查表拿到函数(`op.mul`),最后的 `(...)` 调用这个函数。`ast.dump(node)[:40]` 是把出问题的节点转成字符串、只取前 40 个字符放进报错,免得报错太长。

**第四步,`try` 把结果和错误都包成字典。** 成功返回 `{"expression": ..., "result": ...}`,失败返回 `{"error": ...}`。工具函数不抛异常而是返回错误信息,模型看到 error 会自己换个写法再调一次,这是工具设计的惯例,Day 12 会专门讲。

**最后,`if __name__ == "__main__":`。** 直接运行这个文件时(`python -m w2.calc`),`__name__` 等于 `"__main__"`,下面两行测试会执行;被别的文件 `import` 时不会执行。相当于 Node 里的 `if (require.main === module)`。

`except` 那一行只接住四类「表达式算不了」的错误:`SyntaxError`(写的不是合法算式,比如 `1 +`)、`ValueError`(上面 `ev` 自己抛的「不支持的成分」)、`ArithmeticError`(除以零、结果太大溢出都算这一类)、`RecursionError`(括号嵌套几千层)。一开始我写的是 `except Exception`,Zed 里的 Ruff 会在 `Exception` 下画黄线提示 `BLE001 Do not catch blind exception`,意思是别一把接住所有异常:那样连你代码里的笔误(比如把变量名拼错引起的 `NameError`)也会被包装成「无法计算」交给模型,bug 就被藏起来了。只接预期内的错误,意外的错误照常报出来,这是写工具函数的好习惯。

先单独跑 `uv run python -m w2.calc`,确认第二行恶意输入返回的是 error。然后把两个工具一起交给模型:

```python
# agent-60-lab/w2/day08_two_tools.py
import json
import os
from collections.abc import Callable
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI
from openai.types.chat import ChatCompletionToolParam

from w2.calc import calculate
from w2.tools_def import WEATHER_TOOL
from w2.weather import get_weather

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
MODEL = os.environ["LLM_MODEL"]

CALC_TOOL: ChatCompletionToolParam = {
    "type": "function",
    "function": {
        "name": "calculate",
        "description": "计算一个数学表达式,只支持数字和 + - * / ** %。需要换算、求和、算百分比时使用,不要自己心算。",
        "parameters": {
            "type": "object",
            "properties": {
                "expression": {"type": "string", "description": "Python 风格的算式,例如 '(22.4 * 9 / 5) + 32'"},
            },
            "required": ["expression"],
        },
    },
}
TOOLS = [WEATHER_TOOL, CALC_TOOL]
# 工具名 → 真正执行的函数。加新工具只改这里和 TOOLS 两处
REGISTRY: dict[str, Callable[..., dict]] = {"get_weather": get_weather, "calculate": calculate}


def run_tool(name: str, raw_args: str) -> dict:
    func = REGISTRY.get(name)
    if func is None:
        return {"error": f"未知工具 {name}"}
    try:
        return func(**json.loads(raw_args))
    except Exception as e:  # 参数解析失败、参数名不对、网络错误,都交给模型看
        return {"error": f"{type(e).__name__}: {e}"}


messages: list[Any] = [
    {"role": "system", "content": "你是一个简洁的中文助手。需要实时信息或计算时使用工具,不要编造。"},
    {"role": "user", "content": "北京现在的气温换算成华氏度是多少?"},
]

# 模型可能先查天气、看到结果再调计算器,这需要不止一轮,所以套一个最多 5 轮的循环
# (明天 Day 9 会把它正式写成 Agent 循环)
for round_no in range(1, 6):
    resp = client.chat.completions.create(model=MODEL, messages=messages, tools=TOOLS)
    msg = resp.choices[0].message
    calls = [tc for tc in msg.tool_calls or [] if tc.type == "function"]
    if not calls:
        print(f"[第 {round_no} 轮] 最终回答:", msg.content)
        break

    assistant: dict[str, Any] = {"role": "assistant", "content": msg.content, "tool_calls": [tc.model_dump() for tc in calls]}
    reasoning = getattr(msg, "reasoning_content", None)
    if reasoning:
        assistant["reasoning_content"] = reasoning
    messages.append(assistant)

    for tc in calls:
        result = run_tool(tc.function.name, tc.function.arguments)
        print(f"[第 {round_no} 轮] {tc.function.name}({tc.function.arguments}) -> {result}")
        messages.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps(result, ensure_ascii=False)})
else:
    print("5 轮还没结束,停下来,别让它无限调下去")
```

<div class="line-notes">

- `from collections.abc import Callable` `Callable` 用来标注「可调用的东西」(函数)的类型,下面 REGISTRY 用到。
- `from w2.calc import calculate` 第二个工具,就是上面的安全计算器。
- `CALC_TOOL: ChatCompletionToolParam = {` 计算器的工具定义,结构和 WEATHER_TOOL 一样。
- `"description": "计算一个数学表达式` 「不要自己心算」这句是在劝模型把算术交给工具。实测模型确实乖乖调了 calculate。
- `"expression": {"type": "string", "description": "Python 风格的算式` 给出例子,模型就会写出 `4.5 * 9 / 5 + 32` 这种 `ast` 能解析的格式,而不是 `4.5×9÷5+32`。
- `TOOLS = [WEATHER_TOOL, CALC_TOOL]` 两个工具一起交给模型,由它决定先用哪个。
- `REGISTRY: dict[str, Callable[..., dict]] = {` 工具名 → 函数本身(下面正文有拆解)。
- `def run_tool(name: str, raw_args: str) -> dict:` 统一的执行入口:找函数 → 解析参数 → 调用 → 出错就包成 error。
- `func = REGISTRY.get(name)` 实测 `run_tool("send_email", "{}")`:表里没有这个名字,`.get` 返回 None。
- `return {"error": f"未知工具 {name}"}` 得到 `{'error': '未知工具 send_email'}`。模型偶尔会编出不存在的工具名,这里兜住。
- `return func(**json.loads(raw_args))` 正常情况:`run_tool("calculate", '{"expression": "1+1"}')` → `calculate(expression="1+1")` → `{'expression': '1+1', 'result': 2}`。
- `except Exception as e:` 这里有意接住所有异常,因为参数是模型生成的,什么错都可能出。实测两种:<br>参数名写错 `'{"expr": "1+1"}'` → `{'error': "TypeError: calculate() got an unexpected keyword argument 'expr'"}`<br>JSON 少了右括号 `'{"expression": "1+1"'` → `{'error': "JSONDecodeError: Expecting ',' delimiter: line 1 column 21 (char 20)"}`<br>`type(e).__name__` 取异常类名,让模型知道错在哪一类。
- `{"role": "user", "content": "北京现在的气温换算成华氏度是多少?"}` 这个问题要两步:先查温度,再算换算。
- `for round_no in range(1, 6):` `range(1, 6)` 是 1、2、3、4、5,最多 5 轮。用 `round_no` 而不是 `round`,是因为 `round` 是内置函数名,不要覆盖它。
- `resp = client.chat.completions.create(model=MODEL, messages=messages, tools=TOOLS)` 每轮都把完整历史发一次。
- `calls = [tc for tc in msg.tool_calls or [] if tc.type == "function"]` 第 1、2 轮各有 1 个调用,第 3 轮是空列表。
- `if not calls:` 没有调用说明模型要给最终回答了。
- `print(f"[第 {round_no} 轮] 最终回答:", msg.content)` 这次实跑在第 3 轮走到这里:`[第 3 轮] 最终回答: 北京现在天气晴,气温 4.5°C,换算成华氏度是 **40.1°F**。`
- `break` 跳出 for 循环,下面的 `else` 不会执行。
- `assistant: dict[str, Any] = {"role": "assistant"` 每一轮的 assistant 消息都要放回去,所以这段写在循环里。
- `for tc in calls:` 执行这一轮的所有调用。按轮次追踪这次实跑:<br>第 1 轮:`get_weather({"city": "北京", "unit": "celsius"})` → `temperature: 4.5`,messages 变成 4 条<br>第 2 轮:模型看到 4.5,调 `calculate({"expression": "4.5 * 9 / 5 + 32"})` → `result: 40.1`,messages 变成 6 条<br>第 3 轮:不再调用,输出最终回答
- `result = run_tool(tc.function.name, tc.function.arguments)` 把名字和原始字符串交给 run_tool,解析也在里面做,出错不会让循环崩掉。
- `print(f"[第 {round_no} 轮] {tc.function.name}({tc.function.arguments}) -> {result}")` 实测第 2 轮打印:`[第 2 轮] calculate({"expression": "4.5 * 9 / 5 + 32"}) -> {'expression': '4.5 * 9 / 5 + 32', 'result': 40.1}`
- `else:` `for ... else`:循环正常跑完(没被 break 打断)才执行。这次第 3 轮就 break 了,不会执行到这里。

</div>

这里比往返脚本多了两样东西。一是 `REGISTRY` 字典,按工具名找函数,代替 `if name == ...` 一路写下去,明天 Day 9 的工具注册表就是它的升级版。二是外面套了一个最多 5 轮的 `for` 循环:模型很可能先查天气,看到 11.9 度之后才知道要算什么,第二轮再调计算器,只发一次请求是接不住的。`for ... else` 的 `else` 只在循环没被 `break` 打断时执行,也就是 5 轮都没拿到最终回答。

`REGISTRY` 那一行拆开读:

```python
REGISTRY: dict[str, Callable[..., dict]] = {"get_weather": get_weather, "calculate": calculate}
```

| 片段 | 意思 | TS 类比 |
| --- | --- | --- |
| `REGISTRY` | 变量名,全大写表示「当常量用,别改它」 | `const REGISTRY` |
| `dict[str, ...]` | 字典,键是字符串(工具名) | `Record<string, ...>` |
| `Callable[..., dict]` | 值是「可以调用的东西」,参数随意(`...`),返回 dict | `(...args: any[]) => object` |
| `{"get_weather": get_weather, ...}` | 键是字符串,值是**函数本身**,注意后面没有括号,不是调用结果 | `{ get_weather: getWeather, ... }` |

所以 `REGISTRY["calculate"]` 拿到的就是 `calculate` 这个函数,`REGISTRY["calculate"](expression="1+1")` 才是真的调用。`run_tool` 里的 `func(**json.loads(raw_args))` 就是这么用的:`json.loads` 得到 `{"expression": "1+1"}`,`**` 把字典展开成关键字参数,等于 `calculate(expression="1+1")`,相当于 JS 里把对象当参数传进去再解构。Python 和 JS 一样,函数是普通的值,能放进字典、当参数传。

然后问模型「北京现在的气温换算成华氏度是多少?」。观察它是直接让天气工具返回华氏度,还是先查摄氏度再调计算器。两种都算对,但你会开始体会到工具设计对模型行为的影响。我跑的这次是后一种:

```text
[第 1 轮] get_weather({"city": "北京", "unit": "celsius"}) -> {'city': '北京', 'temperature': 11.9, 'unit': 'celsius', 'weather': '晴', ...}
[第 2 轮] calculate({"expression": "(11.9 * 9 / 5) + 32"}) -> {'expression': '(11.9 * 9 / 5) + 32', 'result': 53.42}
[第 3 轮] 最终回答: 北京现在是晴,气温 11.9°C,换算成华氏度约为 53.4°F。
```

**练习 4:用 tool_choice 做抽取。** 定义一个 `extract_order(order_id: str, issue: Literal["退款","发票","登录","其他"])` 工具,对「我上周的订单 CL-20931 被扣了两次钱,怎么办」这句话强制调用它,只读 arguments 不执行。

```python
# agent-60-lab/w2/day08_extract.py
import json
import os
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI
from openai.types.chat import ChatCompletionToolParam

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
MODEL = os.environ["LLM_MODEL"]

EXTRACT_TOOL: ChatCompletionToolParam = {
    "type": "function",
    "function": {
        "name": "extract_order",
        "description": "从客户工单里抽取订单号和问题类型。",
        "parameters": {
            "type": "object",
            "properties": {
                "order_id": {"type": "string", "description": "订单号,形如 CL-12345;没有就填空字符串"},
                "issue": {
                    "type": "string",
                    "enum": ["退款", "发票", "登录", "其他"],
                    "description": "问题类型。重复扣款、多扣钱、要求退钱都算 退款",
                },
            },
            "required": ["order_id", "issue"],
        },
    },
}

messages: list[Any] = [{"role": "user", "content": "我上周的订单 CL-20931 被扣了两次钱,怎么办"}]

results = []
for i in range(5):
    resp = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        tools=[EXTRACT_TOOL],
        # 强制调用 extract_order:模型不能直接说话,只能交出这个函数的参数
        tool_choice={"type": "function", "function": {"name": "extract_order"}},
        # DeepSeek 思考模式不支持强制 tool_choice,这里关掉思考;别的厂商不认这个字段时删掉这行
        extra_body={"thinking": {"type": "disabled"}},
    )
    tc = (resp.choices[0].message.tool_calls or [None])[0]
    if tc is None or tc.type != "function":
        print(f"第 {i + 1} 次:模型没按要求调用工具")
        continue
    args = json.loads(tc.function.arguments)  # 只读参数,不执行任何东西
    print(f"第 {i + 1} 次:", args)
    results.append(json.dumps(args, ensure_ascii=False, sort_keys=True))

print("5 次结果一致" if len(results) == 5 and len(set(results)) == 1 else "结果不一致,看看哪次不一样,试着改 description")
```

<div class="line-notes">

- `EXTRACT_TOOL: ChatCompletionToolParam = {` 这个工具不会被执行,只是借它的 schema 让模型交出结构化结果。
- `"order_id": {"type": "string", "description": "订单号,形如 CL-12345;没有就填空字符串"},` 写清楚「没有就填空字符串」,模型就不会编一个订单号出来。
- `"enum": ["退款", "发票", "登录", "其他"],` 分类只能从这四个里选。
- `"description": "问题类型。重复扣款、多扣钱、要求退钱都算 退款",` 用户说的是「被扣了两次钱」,没出现「退款」两个字,靠这句把它归到退款。
- `"required": ["order_id", "issue"],` 两个字段都必填。
- `messages: list[Any] = [{"role": "user"` 只有一条 user 消息,不需要 system。
- `results = []` 收集每次的结果,最后比较是否一致。
- `for i in range(5):` 同一个问题问 5 次,看模型稳不稳定。`i` 是 0 到 4,打印时用 `i + 1`。
- `tool_choice={"type": "function", "function": {"name": "extract_order"}},` 强制调用:模型不能直接说话,只能交出 extract_order 的参数。
- `extra_body={"thinking": {"type": "disabled"}},` `extra_body` 里的字段会原样塞进请求体,用来传 SDK 不认识的厂商扩展参数。去掉这行,实测 DeepSeek 返回 400:`Thinking mode does not support this tool_choice`。
- `tc = (resp.choices[0].message.tool_calls or [None])[0]` 拆开看:`tool_calls` 有值就取列表,是 None 就换成 `[None]`,再取 `[0]`。这样无论有没有调用都不会 IndexError,没有调用时 `tc` 是 None。
- `if tc is None or tc.type != "function":` 防御性检查。强制调用下理论上不会发生,实测 5 次都没走到这里。
- `args = json.loads(tc.function.arguments)` 实测每次都是 `{'order_id': 'CL-20931', 'issue': '退款'}`。
- `print(f"第 {i + 1} 次:", args)` 实测 5 行都是 `第 N 次: {'order_id': 'CL-20931', 'issue': '退款'}`。
- `results.append(json.dumps(args, ensure_ascii=False, sort_keys=True))` 转成字符串再存。`sort_keys=True` 让 key 按字母排序,得到 `{"issue": "退款", "order_id": "CL-20931"}`,这样两次结果即使 key 顺序不同,字符串也一样。转成字符串是因为 dict 不能放进 `set`。
- `print("5 次结果一致" if len(results) == 5 and len(set(results)) == 1` `set` 去重,5 个一样的字符串去重后只剩 1 个。条件是 5 次都成功,并且去重后只剩一种结果。实测打印 `5 次结果一致`。

</div>

注意 `extra_body` 那一行。我实测过,DeepSeek 开着思考模式时指定 `tool_choice` 会直接 400:`Thinking mode does not support this tool_choice`。往返脚本没关思考也能跑,是因为它用的是默认的 `auto`。关掉思考以后,我连跑 5 次都是 `{'order_id': 'CL-20931', 'issue': '退款'}`。如果你的结果偶尔是「其他」,先改 `issue` 的 description,把「重复扣款算退款」写得更明白,这就是上面说的「description 是写给模型看的」。

**验收标准:** 练习 1 能打印出四条消息的完整历史并得到包含真实温度的回答;练习 2 能说出报错是哪一条规则被违反;练习 3 的计算器对恶意输入返回 error 而不是执行;练习 4 稳定抽出 `{"order_id": "CL-20931", "issue": "退款"}`(或你认为合理的分类),连续跑 5 次结果一致。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| Function calling / Tool calling / Tool use | 同一件事的三种叫法:模型输出「调用哪个函数、参数是什么」的结构化数据,由你的程序执行 |
| tools | 请求里的工具列表,每个工具有名字、描述、参数 JSON Schema |
| JSON Schema | 描述 JSON 数据结构的规范,这里用来声明参数的类型、取值、是否必填 |
| tool_calls | 响应里模型请求的调用列表,每个有 id、name、arguments |
| arguments | 模型生成的参数,在 OpenAI 协议里是 JSON 字符串,需要自己解析 |
| tool_call_id | 回传结果时用来对应某次调用的编号 |
| role: tool | OpenAI 协议里专门承载工具结果的消息角色 |
| tool_use / tool_result | Anthropic 协议里调用请求和结果的内容块类型 |
| parallel tool calls | 一次响应里给出多个互不依赖的调用 |
| tool_choice | 控制模型是否必须调用工具、调用哪一个的参数 |
| reasoning_content | DeepSeek 思考模式返回的思维链字段,带 tools 时需要回传 |
| strict 模式 | 服务端强制模型生成的参数严格符合 schema 的开关 |

## 常见误区

**以为模型会执行函数。** 模型只生成调用意图,执行、超时、权限、错误处理全在你这边。系统设计时把工具当成「模型发给你的请求」来对待,和对待一个不可信的前端请求一样。

**把 arguments 当字典用。** 它是字符串,要 `json.loads`,而且可能解析失败。别让一个格式错误的参数把整个服务打挂。

**回传时忘了带上 assistant 消息。** 只把 tool 结果塞进去而不先放回那条带 tool_calls 的 assistant 消息,模型就看到一条「凭空出现」的工具结果,多数厂商直接报错。

**tool 结果直接塞 Python 对象。** content 必须是字符串。`str(dict)` 能跑但会出现单引号这种不标准的格式,用 `json.dumps(..., ensure_ascii=False)`。

**觉得工具越多越好。** 每个工具定义每次请求都要计费,而且工具多了模型更容易选错。先少量、精确,Day 11 会细讲。

**相信「OpenAI 兼容」就百分百兼容。** 扩展字段、strict 支持、并行调用开关、思考模式的回传要求,各家都有差异。换厂商时把这一天的四个练习重跑一遍,这就是最便宜的兼容性测试。

## 学习资料

### 文档与文章

- [OpenAI · Function calling 指南](https://platform.openai.com/docs/guides/function-calling):协议的「原始出处」,看 tool_choice、parallel_tool_calls 和 strict 三节,30 分钟。
- [Claude · Tool use 概览](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview):Anthropic 版本的官方文档,重点看 tool_use/tool_result 的消息结构和「客户端工具 vs 服务端工具」的区分,30 分钟。
- [DeepSeek · Tool Calls](https://api-docs.deepseek.com/zh-cn/guides/tool_calls) 和 [思考模式](https://api-docs.deepseek.com/guides/thinking_mode):默认厂商的差异点,strict Beta 和 reasoning_content 回传规则都在这里,20 分钟。
- [阿里云百炼 · 通义千问 Function Calling](https://help.aliyun.com/zh/model-studio/qwen-function-calling):如果你用通义,对照看一下它的写法,15 分钟。
- [JSON Schema 入门](https://json-schema.org/understanding-json-schema):只看 type、object、enum、required 几节就够,20 分钟。
- [Toolformer 论文](https://arxiv.org/abs/2302.04761):2023 年 Meta 的「模型自己学会用 API」,读摘要和第一张图,知道 function calling 的研究来路即可,15 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1qTYizcEN3&autoplay=0&high_quality=1" title="什么是Function Calling与MCP协议?它们为何要这样设计?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>堂吉诃德拉曼查的英豪 · 什么是Function Calling与MCP协议?它们为何要这样设计? · 57 分钟,前半段讲 function calling 的设计动机,正好对应今天;后半段讲 MCP,留到 Day 22 再看也行。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1aaxyz8ELY&p=14&autoplay=0&high_quality=1" title="吴恩达《Agentic AI》中英双语 · 模块3 工具使用" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>吴恩达机器学习(搬运)· (中英双语!)吴恩达最新《Agentic AI》大佬亲授智能体教程 · 看第 14–16 P(模块 3「什么是工具」「创建工具」「工具语法」),一共 16 分钟。</figcaption>
</figure>

- 马克的技术工作坊《MCP 与 Function Calling 到底什么关系》(BV15YJTzkENC,27 分钟):观点鲜明,把「function calling 是模型能力、MCP 是集成协议」讲得很清楚,可以作为练习做完后的延伸。
- 花里胡哨的汤无际《【Agent入门】3.工具调用实现原理》(BV1ymrCBeESA,39 分钟):从提示词渲染角度讲模型怎么「学会」工具调用,对应今天「模型怎么学会这件事」一节。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/aqdWSYWC_LI" title="OpenAI Function Calling - Full Beginner Tutorial" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Dave Ebbelaar · OpenAI Function Calling - Full Beginner Tutorial · 跟着他的代码走一遍,和今天的往返代码几乎一一对应,英文但语速慢。</figcaption>
</figure>

- Elvis Saravia《Function Calling with OpenAI APIs | A Crash Course》(YouTube `p0I-hwZSWMs`):DAIR.AI 作者讲的速成版,适合复习。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025;O'Reilly 平台另有 2025 年 10 月上线的 AI 翻译中文版《AI工程》):第 6 章「RAG and Agents」里 Agents 部分的「Tools」一节,讲工具分成只读和写操作两类,对后面的权限设计很有用。目录见[作者的配套仓库](https://github.com/chiphuyen/aie-book)。
- John Berryman、Albert Ziegler《Prompt Engineering for LLMs》(O'Reilly, 2024):第 8 章「Conversational Agency」开头的 Tool Usage 一节,从提示词角度讲工具定义怎么被模型理解。
- 黄佳《大模型应用开发 动手做AI Agent》(人民邮电出版社, 2024):中文书,看讲 Function Calling 的那个实战项目,对应配套仓库的 `05-function-calls` 目录。

### 开源项目与代码

- [huangjia2019/ai-agents · 05-function-calls](https://github.com/huangjia2019/ai-agents/tree/main/05-function-calls):上面那本书的配套代码,中文注释,可以和今天的代码对照。
- [openai/openai-python](https://github.com/openai/openai-python):遇到字段不确定时直接翻 SDK 的类型定义(`types/chat/`),比搜博客快。

## 自测

1. 用户问「北京多少度」,整个过程中一共发了几次模型请求?工具函数是在哪台机器上执行的?

<details><summary>答案</summary>

两次模型请求。第一次模型返回 tool_calls,第二次带着工具结果拿到最终回答。工具函数在你自己的程序进程里执行,模型 API 服务器从头到尾没有执行它。

</details>

2. 下面这行代码哪里错了?`city = msg.tool_calls[0].function.arguments["city"]`

<details><summary>答案</summary>

`arguments` 在 OpenAI 协议里是 JSON 字符串,不是字典,要先 `json.loads(...)` 再取 `["city"]`。而且解析可能失败,生产代码要包 try,失败时把错误回传给模型让它重写参数。

</details>

3. 你只回传了两个 tool_calls 中的一个结果,会发生什么?为什么协议要这么严格?

<details><summary>答案</summary>

大多数厂商直接返回 400,提示某个 tool_call_id 没有对应的 tool 消息。严格的原因是模型需要对每次调用都看到结果才能继续推理,缺一个它就不知道那次调用发生了什么,可能编造结果。

</details>

4. 什么场景下你会用 `tool_choice: "none"`?什么场景下用指定某个函数?

<details><summary>答案</summary>

`none`:工具已经查够了,这一轮只想让模型总结回答,防止它又去调工具绕圈子。指定函数:你明确要做抽取或分类,把工具当结构化输出用,比如强制调用 `classify_ticket` 拿到分类结果。

</details>

5. (面试题)「Function calling 和 MCP 是什么关系?有了 MCP 还需要 function calling 吗?」

<details><summary>答案</summary>

Function calling 是模型侧的能力:模型能按 schema 输出结构化的调用请求。MCP 是集成侧的协议:规定工具提供方(server)怎么把工具清单、调用接口暴露给应用(client)。应用从 MCP server 拿到工具定义,转成模型能理解的 tools 格式发给模型,模型通过 function calling 请求调用,应用再通过 MCP 转发给 server 执行。两者是上下游关系,MCP 解决「工具从哪来、怎么接」,function calling 解决「模型怎么表达要用工具」,缺一不可。

</details>

6. 用 DeepSeek 思考模式做多轮工具调用,第二轮效果明显变差,可能是什么原因?

<details><summary>答案</summary>

很可能没有把上一轮 assistant 消息里的 `reasoning_content` 回传。DeepSeek 文档规定带 tools 的请求需要回传之前各轮的 reasoning_content,否则模型丢失了上一轮的思考过程。检查一下构造 assistant 消息时有没有带上这个字段。

</details>

## 明天预告

今天的代码只能处理「调一轮工具就结束」的情况。可真实任务经常要好几轮:先查订单,发现订单号不对,再搜客户,再查订单,最后才能回答。明天(Day 9)我们把今天的往返改成一个 while 循环,**不用框架,100 行手写一个 Agent 循环**,顺便做一个从函数签名自动生成 schema 的工具注册表。这段代码是面试最常见的手写题,也是后面整门课所有 Agent 的心脏。
