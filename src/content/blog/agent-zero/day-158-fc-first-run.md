---
title: 'Day 158 · 第一次跑通:让模型查天气'
description: '把昨天的工具定义接上一个真的天气函数(Open-Meteo,免费不用 key):模型提请求,我们解析 arguments、用 schema 本地检查、真的去查。工具先单独测,再交给模型;执行函数把所有失败都变成「错误:…」的字符串,不抛异常。实测五种失败:JSON 被 max_tokens 截断(此时 finish_reason 是 length 不是 tool_calls)、多塞的参数、缺必填、城市不存在、服务超时,还有为什么不能把模型给的城市名直接拼进 URL。'
pubDate: 2026-10-23
regime: none
tags: ['function-calling', 'tool-use', 'httpx', 'agent-zero']
series: 'agent-zero'
day: 158
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 157](/blog/agent-zero/day-157-tool-schema/) 把工具定义当提示词认真写了一遍:`description` 决定模型选哪个工具(两个近亲工具,描述含糊时选对率 3/12,写清楚 12/12,名字和描述打架时模型听描述的);参数上 `enum` 管住词汇但管不住意图,例子会被模型当样板抄;`required` 只是告诉模型,真正的防线是用同一份 schema 在本地检查,并且要显式禁止多余参数。结尾留下 `part03/weather_tool.py` 里的 `WEATHER_TOOL`。

昨天的工具都只是「描述」,没有一个函数真的被调用。今天把它接上一个真的天气函数,让整条链路第一次跑通:用户提问,模型提请求,我们的程序解析、检查、执行,拿到真的天气。

## 今天要解决的问题

学完今天你应该能做到:

1. 写一个真的工具函数(查天气),并且在交给模型**之前**先单独把它测通。
2. 写一个执行函数 `execute_call`:接收模型的一个请求,依次做「查白名单、解析 JSON、本地检查、执行」,任何一步出问题都返回一句「错误:…」的字符串,而不是抛异常。
3. 亲眼看到五种失败(JSON 被截断、多余参数、缺必填、城市不存在、服务超时),并说出每种该由谁处理。

今天有两个新概念:**真的工具函数要先单独测**,以及**执行函数把失败变成字符串**。数据流只走到「我们拿到结果」这一步,结果还没有发回给模型,那是明天。

预计用时:2.5 小时,实跑花费不到 ¥0.02(大部分练习不联网调模型)。前置:[Day 157](/blog/agent-zero/day-157-tool-schema/)(`WEATHER_TOOL`、本地检查)、[Day 156](/blog/agent-zero/day-156-fc-idea/)(`tool_calls`、分发)、[Day 64](/blog/agent-zero/day-064-httpx-1/)–[Day 65](/blog/agent-zero/day-065-httpx-2/)(httpx、超时、`raise_for_status`)、[Day 35](/blog/agent-zero/day-035-exceptions-1/)–[Day 36](/blog/agent-zero/day-036-exceptions-2/)(异常、自定义异常)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `tool_runner.py` 里 `execute_call` 的四道关;再做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

两点说明。一,[Day 70](/blog/agent-zero/day-070-weather-project/) 写过命令行天气工具 `weather_cli.py`。今天为了让这一天自成一体,另写一个更小的 `part03/weather_api.py`,同样用 Open-Meteo,你不需要先有那个文件。二,实验用的 DeepSeek 在本仓库的 `.env` 里关了思考模式(`LLM_EXTRA_BODY` 里 `thinking` 是 `disabled`)。默认开着思考时,带工具的多轮对话还有一个额外要回传的字段,[Day 163](/blog/agent-zero/day-163-tool-choice/) 专门讲,今天不涉及。

今天的天气函数会真的联网,但它只访问 Open-Meteo 的两个查询接口,不读写任何文件,不执行任何模型给的字符串。模型能控制的只有「查哪个城市」和「用什么温度单位」,而且这两个值都会先被检查。

## 今天的链路

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="今天走到的链路:请求、模型提出 tool_calls、我们的程序依次做白名单检查、解析 JSON、schema 检查、执行函数,拿到结果;结果还没有发回给模型">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<rect x="14" y="40" width="96" height="56" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="62" y="64" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">用户问题</text>
<text x="62" y="82" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">+ tools</text>
<line x1="110" y1="68" x2="150" y2="68" stroke="var(--ink-soft)"/>
<rect x="150" y="40" width="96" height="56" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="198" y="64" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">模型</text>
<text x="198" y="82" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">tool_calls</text>
<line x1="246" y1="68" x2="286" y2="68" stroke="var(--mem)"/>
<rect x="286" y="20" width="340" height="150" rx="3" fill="none" stroke="var(--compute)" stroke-dasharray="4 4"/>
<text x="296" y="38" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">execute_call(今天写)</text>
<rect x="298" y="48" width="74" height="40" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="335" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">① 白名单</text>
<rect x="380" y="48" width="74" height="40" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="417" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">② 解析</text>
<rect x="462" y="48" width="74" height="40" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="499" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">③ 检查</text>
<rect x="544" y="48" width="74" height="40" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="581" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">④ 执行</text>
<line x1="372" y1="68" x2="380" y2="68" stroke="var(--compute)"/>
<line x1="454" y1="68" x2="462" y2="68" stroke="var(--compute)"/>
<line x1="536" y1="68" x2="544" y2="68" stroke="var(--compute)"/>
<text x="456" y="116" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">任何一关不过,都返回「错误:…」字符串</text>
<text x="456" y="140" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">四关全过,返回 json.dumps(结果)</text>
<line x1="456" y1="170" x2="456" y2="200" stroke="var(--compute)"/>
<rect x="326" y="200" width="260" height="34" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="456" y="222" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">结果字符串,留在我们手里</text>
<text x="160" y="190" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">模型还没看到这个结果</text>
<text x="160" y="208" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">(明天发回去)</text>
</svg>
<figcaption>蓝色是模型,琥珀色是我们自己的代码。四道关做在同一个函数里,返回值永远是字符串。</figcaption>
</figure>

## 第一步:先单独把工具测通

写 Agent 的一条老规矩:**工具函数本身先当普通函数测通,再交给模型**。不然出了问题,你分不清是模型参数填错了,还是函数本身就坏了。新建 `part03/weather_api.py`:

```python
# agent-zero-lab/part03/weather_api.py
from typing import Any

import httpx

GEO_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

# Open-Meteo 返回的是 WMO 天气代码(一个数字),这里只翻译常见的几个
WMO = {0: "晴", 1: "大致晴", 2: "多云", 3: "阴", 45: "雾", 51: "小毛毛雨", 61: "小雨", 63: "中雨", 65: "大雨", 71: "小雪", 80: "阵雨", 95: "雷暴"}


class WeatherError(Exception):
    """天气查询失败:找不到城市、网络超时等。消息会原样给模型看,所以要写成人话。"""


def get_weather(city: str, unit: str = "celsius", timeout: float = 10.0) -> dict[str, Any]:
    try:
        geo = httpx.get(
            GEO_URL,
            params={"name": city, "count": 1, "language": "zh"},  # params 会自动做 URL 编码
            timeout=timeout,
        )
        geo.raise_for_status()
        results = geo.json().get("results")
        if not results:
            raise WeatherError(f"找不到叫 {city!r} 的城市,请换个写法")
        place = results[0]
        cur = httpx.get(
            FORECAST_URL,
            params={
                "latitude": place["latitude"],
                "longitude": place["longitude"],
                "current": "temperature_2m,weather_code,wind_speed_10m",
                "temperature_unit": unit,
            },
            timeout=timeout,
        )
        cur.raise_for_status()
        now = cur.json()["current"]
    except httpx.HTTPError as e:
        raise WeatherError(f"天气服务暂时不可用({type(e).__name__})") from e
    return {
        "city": place["name"],
        "country": place.get("country"),
        "temperature": now["temperature_2m"],
        "unit": unit,
        "weather": WMO.get(now["weather_code"], f"天气代码 {now['weather_code']}"),
        "wind_kmh": now["wind_speed_10m"],
    }


if __name__ == "__main__":
    print(get_weather("北京"))
    print(get_weather("Shanghai", "fahrenheit"))
    for bad in ("火星城", "北京&count=100"):
        try:
            get_weather(bad)
        except WeatherError as e:
            print("WeatherError:", e)
```

<div class="line-notes">

- `from typing import Any` 返回值是一个字典,值的类型五花八门,写 `dict[str, Any]`。
- `import httpx` 发 HTTP 请求的库,[Day 64](/blog/agent-zero/day-064-httpx-1/) 学过,相当于 Node 里的 axios。已经在 `pyproject.toml` 里(`uv add httpx`)。
- `GEO_URL = "https://geocoding-api.open-meteo.com/v1/search"` 地理编码接口:把城市名换成经纬度。Open-Meteo 的天气接口只认经纬度,不认城市名,所以要分两步。
- `FORECAST_URL = "https://api.open-meteo.com/v1/forecast"` 天气接口。
- `WMO = {0: "晴", 1: "大致晴", 2: "多云", 3: "阴",` 接口返回的天气是个数字(WMO 国际气象代码),这张表把常见的几个翻成中文。实测北京这次返回代码 0,查表得「晴」。
- `class WeatherError(Exception):` 自己的异常类([Day 36](/blog/agent-zero/day-036-exceptions-2/))。工具里**预料之内**的失败(找不到城市、服务连不上)都抛它,和程序 bug 区分开。
- `"""天气查询失败:找不到城市、网络超时等。消息会原样给模型看,所以要写成人话。"""` 这句文档字符串是在提醒:异常的消息之后会变成 tool 消息发给模型,它读的是这句话。
- `def get_weather(city: str, unit: str = "celsius", timeout: float = 10.0) -> dict[str, Any]:` 形参名 `city`、`unit` 必须和 `WEATHER_TOOL` 里的字段名一模一样,这样模型给的参数字典可以用 `**args` 直接展开成关键字参数。`timeout` 是我们给自己留的旋钮,**不在 schema 里**,模型不应该碰到它(后面的实验会看到有人想碰)。
- `geo = httpx.get(` 第一步请求:地理编码。
- `params={"name": city, "count": 1, "language": "zh"},  # params 会自动做 URL 编码` 查询参数交给 `params`,httpx 会替你做 URL 编码。实测 `city` 是 `北京` 时,真正发出去的是 `?name=%E5%8C%97%E4%BA%AC&count=1&language=zh`。这一行写法很重要,后面单独演示。
- `timeout=timeout,` 最多等 10 秒。httpx 的默认超时是 5 秒,这里显式写出来,关键是**每个对外请求都要有超时**,没有的话服务一卡,你的程序就跟着卡([Day 65](/blog/agent-zero/day-065-httpx-2/))。
- `geo.raise_for_status()` HTTP 状态码不是 2xx 就抛 `httpx.HTTPStatusError`。
- `results = geo.json().get("results")` 解析响应。**找不到城市时接口不报错**,只是返回里没有 `results` 这个 key,所以用 `.get`,拿不到是 `None`。
- `if not results:` `None` 或空列表都进来。
- `raise WeatherError(f"找不到叫 {city!r} 的城市,请换个写法")` 实测 `get_weather("火星城")` 的消息是 `找不到叫 '火星城' 的城市,请换个写法`。`{city!r}` 带引号显示,模型和你都能看清它到底查了什么。
- `place = results[0]` 取最匹配的一个。`count=1` 保证最多只有一个。
- `cur = httpx.get(` 第二步请求:用经纬度查当前天气。
- `"current": "temperature_2m,weather_code,wind_speed_10m",` 要三个「当前值」:2 米高度气温、天气代码、10 米高度风速。
- `"temperature_unit": unit,` 把单位原样传给接口,它负责换算。实测 `Shanghai` 用 `fahrenheit` 查回来 `73.0`,摄氏同一时刻是 `22.8`(73.0 = 22.8 × 9/5 + 32)。
- `now = cur.json()["current"]` 响应很长,只取 `current` 这一块。
- `except httpx.HTTPError as e:` `httpx.HTTPError` 是网络层所有异常的父类:超时、连不上、状态码错误都在里面。
- `raise WeatherError(f"天气服务暂时不可用({type(e).__name__})") from e` 给模型看的消息只带异常的**类型名**(比如 `ConnectTimeout`),不带细节(可能包含内部地址之类的信息);`from e` 把原始异常挂在 `__cause__` 上,你调试时还能看到。
- `"city": place["name"],` 返回接口给的标准城市名,不是用户原话。用户写 `Shanghai`,这里是 `上海`。
- `"country": place.get("country"),` 个别地点没有这个字段,`.get` 兜底成 `None`。
- `"weather": WMO.get(now["weather_code"], f"天气代码 {now['weather_code']}"),` 表里没有的代码返回「天气代码 80」这样的原样提示,不会因为表没写全就崩。
- `for bad in ("火星城", "北京&count=100"):` 两个故意的坏城市。第二个把一段查询参数夹在城市名里,看它会不会影响请求。

</div>

```bash
uv run python -m part03.weather_api
```

我的输出(2026-10-23):

```text
{'city': '北京', 'country': '中国', 'temperature': 12.5, 'unit': 'celsius', 'weather': '晴', 'wind_kmh': 3.9}
{'city': '上海', 'country': '中国', 'temperature': 73.0, 'unit': 'fahrenheit', 'weather': '小毛毛雨', 'wind_kmh': 12.7}
WeatherError: 找不到叫 '火星城' 的城市,请换个写法
WeatherError: 找不到叫 '北京&count=100' 的城市,请换个写法
```

函数本身没问题:北京 12.5 度、晴;上海用华氏查得 73.0;两个坏城市都变成了 `WeatherError`,没有一个是未捕获的异常。第四行值得多看一眼:城市名里夹带的 `&count=100` **没有**被当成另一个查询参数,而是被当成名字的一部分去查,查不到。这全靠 `params=`。对比一下,新建 `part03/url_injection.py`(只构造请求,不发出去):

```python
# agent-zero-lab/part03/url_injection.py
import httpx

from part03.weather_api import GEO_URL

city = "北京&count=100&language=en"  # 模型传出来的「城市」,里面夹带了别的查询参数

bad_url = f"{GEO_URL}?name={city}&count=1&language=zh"  # 错误做法:字符串直接拼
good = httpx.Request("GET", GEO_URL, params={"name": city, "count": 1, "language": "zh"})  # 正确做法:交给 params

print("拼字符串:", bad_url)
print("用 params:", good.url)
```

<div class="line-notes">

- `import httpx` 只用它来构造一个请求对象,看它最终的 URL。
- `from part03.weather_api import GEO_URL` 复用上面的地址常量。
- `city = "北京&count=100&language=en"  # 模型传出来的「城市」,里面夹带了别的查询参数` 这就是「参数是不可信输入」的一个具体例子:模型传来的 `city` 里藏了 `&count=100&language=en`。
- `bad_url = f"{GEO_URL}?name={city}&count=1&language=zh"  # 错误做法:字符串直接拼` 用 f-string 把城市拼进 URL,是新手最爱的写法。
- `good = httpx.Request("GET", GEO_URL, params={"name": city, "count": 1, "language": "zh"})  # 正确做法:交给 params` 构造一个请求对象,**不发送**,只是为了拿到它的 `.url`。
- `print("拼字符串:", bad_url)` 看拼出来的 URL。
- `print("用 params:", good.url)` 看 httpx 生成的 URL。

</div>

```bash
uv run python -m part03.url_injection
```

```text
拼字符串: https://geocoding-api.open-meteo.com/v1/search?name=北京&count=100&language=en&count=1&language=zh
用 params: https://geocoding-api.open-meteo.com/v1/search?name=%E5%8C%97%E4%BA%AC%26count%3D100%26language%3Den&count=1&language=zh
```

拼字符串那一条,`count=100&language=en` 成了独立的查询参数,攻击者(或者一个被带偏的模型)改写了你的请求。用 `params=` 那一条,`&` 被编码成 `%26`,`=` 被编码成 `%3D`,整个城市名老老实实留在 `name` 里。这类问题叫**注入**(injection):用户或模型给的内容被当成了「结构」而不是「数据」。SQL 注入、命令注入、路径穿越,都是同一个毛病,后面的天会反复遇到。**只要工具参数最终要进 URL、SQL、命令行、文件路径,就一定走库提供的参数化方式,不要字符串拼接。**

再看超时,故意制造一次。新建 `part03/weather_timeout.py`:

```python
# agent-zero-lab/part03/weather_timeout.py
from part03.weather_api import WeatherError, get_weather

try:
    get_weather("北京", timeout=0.001)  # 1 毫秒,连握手都来不及
except WeatherError as e:
    print("给模型看的:", e)
    print("给你自己看的:", repr(e.__cause__))
```

<div class="line-notes">

- `from part03.weather_api import WeatherError, get_weather` 导入函数和自定义异常。
- `get_weather("北京", timeout=0.001)  # 1 毫秒,连握手都来不及` 把超时设成 0.001 秒,稳定触发超时。
- `except WeatherError as e:` 我们的函数把网络层异常包成了 `WeatherError`。
- `print("给模型看的:", e)` `str(e)` 是我们写的那句人话。
- `print("给你自己看的:", repr(e.__cause__))` `__cause__` 是 `raise ... from e` 挂上去的原始异常,这里是 httpx 的 `ConnectTimeout`。

</div>

```bash
uv run python -m part03.weather_timeout
```

```text
给模型看的: 天气服务暂时不可用(ConnectTimeout)
给你自己看的: ConnectTimeout('_ssl.c:993: The handshake operation timed out')
```

两个不同的受众,两份不同详细程度的信息:模型只要知道「服务暂时不可用」,它能据此告诉用户「请稍后再试」;握手超时的 SSL 细节只有你调试时才需要,而且不该发给第三方模型厂商。

## 第二步:执行函数 execute_call

现在有了真函数。模型给的请求要经过哪些关口才能真正调到它?昨天练习里的 `dispatch` 做了白名单和参数检查,今天加上 JSON 解析和 schema 检查,并且把所有失败统一成字符串。新建 `part03/tool_runner.py`:

```python
# agent-zero-lab/part03/tool_runner.py
import copy
import json
from collections.abc import Callable
from typing import Any

from jsonschema import Draft202012Validator

from part03.weather_api import WeatherError, get_weather

# 白名单:模型只能点这张表里有的名字(Day 156 练习 1 的做法)
FUNCS: dict[str, Callable[..., Any]] = {"get_weather": get_weather}


def execute_call(
    call: dict[str, Any],
    tools: list[dict[str, Any]],
    funcs: dict[str, Callable[..., Any]] = FUNCS,
) -> str:
    """执行模型提的一个工具请求,返回要放进 tool 消息的字符串。
    任何一步出问题都返回「错误:…」,不抛异常:这句话会发回给模型,让它知道哪里错了。"""
    fn = call.get("function", {})
    name = fn.get("name")
    schemas = {t["function"]["name"]: t["function"]["parameters"] for t in tools}
    if name not in funcs or name not in schemas:
        return f"错误:没有叫 {name!r} 的工具,可用的工具:{list(funcs)}"

    try:
        args = json.loads(fn.get("arguments", ""))
    except json.JSONDecodeError as e:
        return f"错误:arguments 不是合法的 JSON({e.msg},第 {e.pos} 个字符)"

    schema = copy.deepcopy(schemas[name])
    schema["additionalProperties"] = False  # 我们自己的规矩:schema 里没写的参数一律不收
    problems = [e.message for e in Draft202012Validator(schema).iter_errors(args)]
    if problems:
        return "错误:参数不合格:" + ";".join(problems)

    try:
        result = funcs[name](**args)
    except WeatherError as e:
        return f"错误:{e}"
    except Exception as e:  # noqa: BLE001  工具自己的 bug 不能把整个程序带崩
        return f"错误:工具内部出错({type(e).__name__})"
    return json.dumps(result, ensure_ascii=False)
```

<div class="line-notes">

- `import copy` 下面要深拷贝 schema,在拷贝上加规则,不改发给模型的原件。
- `import json` 解析 `arguments`,以及把结果序列化。
- `from collections.abc import Callable` 「可以被调用的东西」的类型标注。
- `from jsonschema import Draft202012Validator` 昨天的校验器。
- `from part03.weather_api import WeatherError, get_weather` 导入今天的真函数和异常。
- `FUNCS: dict[str, Callable[..., Any]] = {"get_weather": get_weather}` **白名单**:名字映射到函数。`Callable[..., Any]` 里的 `...` 表示「参数个数和类型不限」,因为不同工具的参数不同。以后加工具就往这张表里加一行。
- `def execute_call(` 参数一共三个:模型的请求 `call`、发给模型的 `tools` 列表(要从里面取 schema)、白名单表 `funcs`。
- `funcs: dict[str, Callable[..., Any]] = FUNCS,` 白名单作为带默认值的参数,测试时可以换成假函数,不用联网(练习 3 就这么做)。
- `-> str:` 返回值永远是字符串。
- `任何一步出问题都返回「错误:…」,不抛异常:这句话会发回给模型,让它知道哪里错了。"""` 文档字符串写明设计意图。
- `fn = call.get("function", {})` 请求的结构是 `{"id": ..., "function": {"name": ..., "arguments": ...}}`,取出里面那层。
- `name = fn.get("name")` 函数名。
- `schemas = {t["function"]["name"]: t["function"]["parameters"] for t in tools}` 字典推导式:把工具列表变成「名字 → 参数 schema」的查找表。
- `if name not in funcs or name not in schemas:` **第一关:白名单。**名字必须同时在函数表和定义里。模型提了个不存在的 `delete_all_invoices`,在这里就挡住。
- `return f"错误:没有叫 {name!r} 的工具,可用的工具:{list(funcs)}"` 错误信息里带上可用的工具列表,模型下一轮能自己纠正。
- `args = json.loads(fn.get("arguments", ""))` **第二关:解析。**`arguments` 是字符串,要自己 `json.loads`;没有这个 key 时用空字符串,解析会失败而不是抛 `KeyError`。
- `except json.JSONDecodeError as e:` JSON 不合法就进来。
- `return f"错误:arguments 不是合法的 JSON({e.msg},第 {e.pos} 个字符)"` `e.msg` 是原因,`e.pos` 是出错的位置。
- `schema = copy.deepcopy(schemas[name])` 拷一份,下面要改它。
- `schema["additionalProperties"] = False  # 我们自己的规矩:schema 里没写的参数一律不收` **昨天提过的那条**:JSON Schema 默认允许多余参数,我们在执行侧强制关掉。
- `problems = [e.message for e in Draft202012Validator(schema).iter_errors(args)]` **第三关:检查。**一次收集所有问题。
- `return "错误:参数不合格:" + ";".join(problems)` 把问题用分号连成一句。
- `result = funcs[name](**args)` **第四关:执行。**`funcs[name]` 取出函数,`(**args)` 把字典展开成关键字参数:`{"city": "北京", "unit": "celsius"}` 变成 `get_weather(city="北京", unit="celsius")`。能走到这里,说明名字在白名单里、参数都过了检查。
- `except WeatherError as e:` 预料之内的失败。
- `return f"错误:{e}"` 用我们写的那句人话。
- `except Exception as e:  # noqa: BLE001` 兜底:工具自己出了 bug(比如被零除),不能让它把整个程序带崩。`# noqa: BLE001` 是告诉代码检查工具「这里捕获所有异常是故意的」。
- `return f"错误:工具内部出错({type(e).__name__})"` 只给类型名,不给细节,理由和上面一样。
- `return json.dumps(result, ensure_ascii=False)` 成功时把结果序列化成 JSON 字符串。**不用 `str(result)`**:JSON 格式稳定、模型好读;`ensure_ascii=False` 保留中文,明天会量一下这个参数对 token 数的影响。

</div>

注意最后一关里两个 `except` 的顺序:先 `WeatherError` 再 `Exception`。Python 按顺序匹配,`WeatherError` 本身也是 `Exception` 的子类,顺序反了的话,专门那一条永远走不到。

## 第三步:不联网先把失败演一遍

`execute_call` 的每一关,都可以用手工造的「假请求」测,不花钱,也不用等模型。新建 `part03/fail_modes.py`:

```python
# agent-zero-lab/part03/fail_modes.py
from typing import Any

from part03.tool_runner import execute_call
from part03.weather_tool import WEATHER_TOOL

TOOLS = [WEATHER_TOOL]


def fake_call(name: str, arguments: str) -> dict[str, Any]:
    """手工造一个和模型返回长得一样的请求,不花钱。"""
    return {"id": "call_fake", "type": "function", "function": {"name": name, "arguments": arguments}}


CASES = [
    ("正常", fake_call("get_weather", '{"city": "北京"}')),
    ("没有这个工具", fake_call("delete_all_invoices", "{}")),
    ("JSON 被截断", fake_call("get_weather", '{"city": "北')),
    ("缺必填参数", fake_call("get_weather", "{}")),
    ("类型不对", fake_call("get_weather", '{"city": 123}')),
    ("枚举不对", fake_call("get_weather", '{"city": "北京", "unit": "kelvin"}')),
    ("多塞了个参数", fake_call("get_weather", '{"city": "北京", "timeout": 0.001}')),
    ("城市不存在", fake_call("get_weather", '{"city": "火星城"}')),
]
for label, call in CASES:
    print(f"{label:8} -> {execute_call(call, TOOLS)}")
```

<div class="line-notes">

- `def fake_call(name: str, arguments: str) -> dict[str, Any]:` 造一个和模型返回长得一样的请求字典。注意 `arguments` 是**字符串**,和真实情况一致。
- `"""手工造一个和模型返回长得一样的请求,不花钱。"""` 文档字符串说明用途。
- `("正常", fake_call("get_weather", '{"city": "北京"}')),` 对照组,应该真的联网查到天气。
- `("没有这个工具", fake_call("delete_all_invoices", "{}")),` 第一关会拦。
- `("JSON 被截断", fake_call("get_weather", '{"city": "北')),` 一个没写完的 JSON:引号没闭合。
- `("缺必填参数", fake_call("get_weather", "{}")),` 第三关:缺 `city`。
- `("类型不对", fake_call("get_weather", '{"city": 123}')),` 第三关:`city` 应该是字符串。
- `("枚举不对", fake_call("get_weather", '{"city": "北京", "unit": "kelvin"}')),` 第三关:`kelvin` 不在枚举里。
- `("多塞了个参数", fake_call("get_weather", '{"city": "北京", "timeout": 0.001}')),` 一个攻击场景:有人想把 `timeout` 也传进去。如果没有 `additionalProperties: false`,它会通过检查,被 `**args` 展开成 `get_weather(city="北京", timeout=0.001)`,查询必超时。
- `("城市不存在", fake_call("get_weather", '{"city": "火星城"}')),` 第四关:函数自己抛 `WeatherError`。
- `print(f"{label:8} -> {execute_call(call, TOOLS)}")` 逐个执行并打印返回的字符串。

</div>

```bash
uv run python -m part03.fail_modes
```

我的输出:

```text
正常       -> {"city": "北京", "country": "中国", "temperature": 12.5, "unit": "celsius", "weather": "晴", "wind_kmh": 3.9}
没有这个工具   -> 错误:没有叫 'delete_all_invoices' 的工具,可用的工具:['get_weather']
JSON 被截断 -> 错误:arguments 不是合法的 JSON(Unterminated string starting at,第 9 个字符)
缺必填参数    -> 错误:参数不合格:'city' is a required property
类型不对     -> 错误:参数不合格:123 is not of type 'string'
枚举不对     -> 错误:参数不合格:'kelvin' is not one of ['celsius', 'fahrenheit']
多塞了个参数   -> 错误:参数不合格:Additional properties are not allowed ('timeout' was unexpected)
城市不存在    -> 错误:找不到叫 '火星城' 的城市,请换个写法
```

(中文标签宽度对不齐是终端字体的缘故,不影响内容。)八个用例,七个失败都变成了「错误:…」开头的一句话,每一句都说清了**哪里错、该怎么改**,模型读到它能自己纠正。真正干活的只有第一行。「多塞了个参数」那一行最重要:靠我们在执行侧加的 `additionalProperties: false`,`timeout=0.001` 没有机会被传进函数。

## 第四步:真的让模型来提请求

现在把模型接上。新建 `part03/first_run.py`:

```python
# agent-zero-lab/part03/first_run.py
from common.llm import LLMClient
from part03.tool_runner import execute_call
from part03.weather_tool import WEATHER_TOOL

TOOLS = [WEATHER_TOOL]


def main() -> None:
    client = LLMClient()
    messages = [
        {"role": "system", "content": "你是云簿 CloudLedger 的客服助手。回答简短。"},
        {"role": "user", "content": "北京现在多少度?出门要穿外套吗?"},
    ]
    r = client.chat(messages, tools=TOOLS, temperature=0, max_tokens=200)
    print("finish_reason:", r.finish_reason)

    calls = r.message.get("tool_calls", [])
    print("模型提了", len(calls), "个请求")
    for call in calls:
        print("  请求:", call["function"]["name"], call["function"]["arguments"])
        result = execute_call(call, TOOLS)
        print("  结果:", result)
    print("模型有没有看到这个结果?没有。messages 一共", len(messages), "条,没有一条带结果")
    print(client.ledger)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from part03.tool_runner import execute_call` 刚写的执行函数。
- `from part03.weather_tool import WEATHER_TOOL` [Day 157](/blog/agent-zero/day-157-tool-schema/) 那份认真写的定义。
- `TOOLS = [WEATHER_TOOL]` `tools` 参数要的是列表,哪怕只有一个。
- `def main() -> None:` 逻辑放进 `main()`,明天的脚本要导入这个文件里的东西。
- `messages = [` 这次的 system 加一个**一句话里有两个问题**的提问:几度、要不要穿外套。
- `r = client.chat(messages, tools=TOOLS, temperature=0, max_tokens=200)` 昨天学的写法,多一个 `tools`。
- `print("finish_reason:", r.finish_reason)` 实测 `tool_calls`。
- `calls = r.message.get("tool_calls", [])` 请求列表;没请求时没有这个 key,`get` 给空列表。
- `print("模型提了", len(calls), "个请求")` 实测 1 个。
- `print("  请求:", call["function"]["name"], call["function"]["arguments"])` 实测 `get_weather {"city": "北京"}`。注意这条请求里**没有** `unit`:用户没提单位,模型没填(描述里写了「没说就用 celsius」,函数的默认值也是 celsius)。
- `result = execute_call(call, TOOLS)` 四道关全走一遍,真的去查。
- `print("  结果:", result)` 实测是一整串 JSON:北京 12.5、晴、风速 3.9。
- `print("模型有没有看到这个结果?没有。messages 一共", len(messages), "条,没有一条带结果")` 这行是提醒:结果只在我们的变量里,`messages` 还是那两条。
- `print(client.ledger)` 账单。

</div>

```bash
uv run python -m part03.first_run
```

我的输出:

```text
finish_reason: tool_calls
模型提了 1 个请求
  请求: get_weather {"city": "北京"}
  结果: {"city": "北京", "country": "中国", "temperature": 12.5, "unit": "celsius", "weather": "晴", "wind_kmh": 3.9}
模型有没有看到这个结果?没有。messages 一共 2 条,没有一条带结果
1 次调用 | 输入 392 / 输出 38 tokens | 约 ¥0.0011
```

整条链路通了:用户一句话,模型决定要查北京,我们的程序解析、检查、执行,拿回北京此刻的真实天气。费用:输入 392 个 token(其中大部分是工具定义,昨天量过),输出 38,约 ¥0.0011。

停在这里有个值得注意的事实:用户问了「要不要穿外套」,可是**现在没有任何东西能回答这个问题**,因为模型还没看到 12.5 度。结果躺在我们的变量里。把它发回去,是明天的事。

## 第五步:换几个问题,看模型怎么用它

同一份工具,六种问法。新建 `part03/ask_cases.py`:

```python
# agent-zero-lab/part03/ask_cases.py
from common.llm import LLMClient
from part03.tool_runner import execute_call
from part03.weather_tool import WEATHER_TOOL

TOOLS = [WEATHER_TOOL]
QUESTIONS = [
    "上海现在多少华氏度?",
    "Beijing 今天天气怎么样",
    "出门要带伞吗?",
    "火星城现在多少度?",
    "北京和上海现在哪个更热?",
    "发票抬头怎么改?",
]

client = LLMClient()
for q in QUESTIONS:
    r = client.chat(
        [{"role": "system", "content": "你是云簿 CloudLedger 的客服助手。回答简短。"}, {"role": "user", "content": q}],
        tools=TOOLS,
        temperature=0,
        max_tokens=200,
    )
    print(f"问:{q}  [{r.finish_reason}]")
    calls = r.message.get("tool_calls", [])
    if not calls:
        print(f"  没有请求,模型直接说:{r.content[:40]!r}")
    for call in calls:
        print(f"  请求 {call['function']['arguments']}")
        print(f"  结果 {execute_call(call, TOOLS)}")
print(client.ledger)
```

<div class="line-notes">

- `"上海现在多少华氏度?",` 用户明确要华氏,看模型会不会填 `unit`。
- `"Beijing 今天天气怎么样",` 用户写英文名,看模型传什么。
- `"出门要带伞吗?",` **没有说城市**。
- `"火星城现在多少度?",` 一个不存在的城市。
- `"北京和上海现在哪个更热?",` 要两个城市的数据。
- `"发票抬头怎么改?",` 和天气完全无关。
- `for q in QUESTIONS:` 每个问题单独发,不带历史。
- `print(f"问:{q}  [{r.finish_reason}]")` 问题加结束原因。
- `print(f"  没有请求,模型直接说:{r.content[:40]!r}")` 没请求时它说了什么。
- `for call in calls:` 遍历所有请求,哪怕有两个。
- `print(f"  请求 {call['function']['arguments']}")` 打印它填的参数。
- `print(f"  结果 {execute_call(call, TOOLS)}")` 执行并打印结果。

</div>

```bash
uv run python -m part03.ask_cases
```

我的输出:

```text
问:上海现在多少华氏度?  [tool_calls]
  请求 {"city": "上海", "unit": "fahrenheit"}
  结果 {"city": "上海", "country": "中国", "temperature": 73.0, "unit": "fahrenheit", "weather": "小毛毛雨", "wind_kmh": 12.7}
问:Beijing 今天天气怎么样  [tool_calls]
  请求 {"city": "Beijing"}
  结果 {"city": "北京", "country": "中国", "temperature": 12.5, "unit": "celsius", "weather": "晴", "wind_kmh": 3.9}
问:出门要带伞吗?  [stop]
  没有请求,模型直接说:'您在哪个城市呢?告诉我城市名,我帮您查一下当前天气。'
问:火星城现在多少度?  [tool_calls]
  请求 {"city": "火星城"}
  结果 错误:找不到叫 '火星城' 的城市,请换个写法
问:北京和上海现在哪个更热?  [tool_calls]
  请求 {"city": "北京"}
  结果 {"city": "北京", "country": "中国", "temperature": 12.5, "unit": "celsius", "weather": "晴", "wind_kmh": 3.9}
  请求 {"city": "上海"}
  结果 {"city": "上海", "country": "中国", "temperature": 22.8, "unit": "celsius", "weather": "小毛毛雨", "wind_kmh": 12.7}
问:发票抬头怎么改?  [stop]
  没有请求,模型直接说:'您好,发票抬头修改方式如下:\n\n- **未开票订单**:在「订单详情 → 发票信'
6 次调用 | 输入 2323 / 输出 294 tokens | 约 ¥0.0055
```

逐条:

- **华氏。** 用户说了「华氏」,模型填了 `"unit": "fahrenheit"`,函数把它原样传给接口,返回 73.0。参数说明里的枚举和默认值各司其职。
- **英文名。** 模型把 `Beijing` 原样传出来(昨天它把 `Beijing` 转成了 `北京`,这次没转,说明这种行为**不稳定**)。这次没出问题,是因为地理编码接口认英文名;如果你自己的城市字典只认中文,就会查不到。**别假设模型会帮你规范化参数。**
- **没说城市。** 模型没调工具,反问「您在哪个城市」。这就是昨天讲的 `required` 起作用的样子。注意这一步 `finish_reason` 是 `stop`:模型这一轮只是说了句话。**处理模型回复的代码必须同时能处理「有请求」和「没请求」两种**,练习 2 要写。
- **火星城。** 模型提了请求,函数抛 `WeatherError`,`execute_call` 把它变成「错误:找不到叫 '火星城' 的城市」。明天你会看到模型拿到这句话以后怎么回用户。
- **两个城市。** 一次回复里有**两个**请求,我们的 `for call in calls` 循环逐个处理了。这就是并行工具调用([Day 162](/blog/agent-zero/day-162-parallel-tools/)),今天的代码已经天然支持,只是还没有把两个结果发回去。
- **发票抬头。** 完全无关的问题,模型直接答了,没碰工具。(它给的菜单路径是编的,云簿是虚构公司,不存在这个页面。)

## 第六步:模型的 JSON 被截断了

昨天说过 `arguments` 可能不是合法 JSON。今天真的造一次:把 `max_tokens` 压得很小,逼模型的回复被截断。新建 `part03/truncated.py`:

```python
# agent-zero-lab/part03/truncated.py
import json
import sys

from common.llm import LLMClient
from part03.tool_runner import execute_call
from part03.weather_tool import WEATHER_TOOL

client = LLMClient()
limit = int(sys.argv[1])  # 命令行第一个参数:允许模型最多写多少个 token
r = client.chat(
    [{"role": "user", "content": "北京现在多少度?"}],
    tools=[WEATHER_TOOL],
    temperature=0,
    max_tokens=limit,
)
print("finish_reason:", r.finish_reason)
calls = r.message.get("tool_calls", [])
print("tool_calls:", json.dumps(calls, ensure_ascii=False))
for call in calls:
    print("执行结果:", execute_call(call, [WEATHER_TOOL]))
```

<div class="line-notes">

- `import sys` 要读命令行参数。
- `limit = int(sys.argv[1])  # 命令行第一个参数:允许模型最多写多少个 token` `sys.argv` 是命令行参数列表,`sys.argv[0]` 是脚本名,`[1]` 是第一个参数,是字符串,用 `int` 转成整数。
- `max_tokens=limit,` 把上限设成命令行给的值。
- `print("finish_reason:", r.finish_reason)` 看结束原因,这是今天要看的重点。
- `calls = r.message.get("tool_calls", [])` 取请求。
- `print("tool_calls:", json.dumps(calls, ensure_ascii=False))` 完整打印请求,看 `arguments` 到底剩什么。
- `print("执行结果:", execute_call(call, [WEATHER_TOOL]))` 把半截的请求交给 `execute_call`。

</div>

```bash
uv run python -m part03.truncated 8
uv run python -m part03.truncated 16
uv run python -m part03.truncated 20
uv run python -m part03.truncated 28
```

我的输出:

```text
== python -m part03.truncated 8
finish_reason: length
tool_calls: []
== python -m part03.truncated 16
finish_reason: length
tool_calls: [{"id": "call_00_opvm3c44HhrCZsZEI4lf6793", "function": {"arguments": "", "name": "get_weather"}, "type": "function", "index": 0}]
执行结果: 错误:arguments 不是合法的 JSON(Expecting value,第 0 个字符)
== python -m part03.truncated 20
finish_reason: length
tool_calls: [{"id": "call_00_LkKusrJcIXiQK1d9MB0t1112", "function": {"arguments": "{\"city", "name": "get_weather"}, "type": "function", "index": 0}]
执行结果: 错误:arguments 不是合法的 JSON(Unterminated string starting at,第 1 个字符)
== python -m part03.truncated 28
finish_reason: length
tool_calls: [{"id": "call_00_FsFMRETt8nnxcpkWp4d88413", "function": {"arguments": "{\"city\": \"北京\"", "name": "get_weather"}, "type": "function", "index": 0}]
执行结果: 错误:arguments 不是合法的 JSON(Expecting ',' delimiter,第 13 个字符)
```

四个值看出四种形状。`8`:被截得太早,连请求都没写出来,`tool_calls` 是空的,看上去就像模型什么都没说。`16`:请求有了,但 `arguments` 是空字符串。`20`:`{"city` 只有半截。`28`:离成功只差最后一个 `}`,`{"city": "北京"` 缺一个右花括号,解析报 `Expecting ',' delimiter`。

最要紧的一条:**这四次 `finish_reason` 都是 `length`,不是 `tool_calls`。**如果你的代码写的是 `if r.finish_reason == "tool_calls": ...`,这些半截的请求会被当成普通回答静默地丢掉,用户看到的是一个空回复。所以判断「模型有没有提请求」要看 `tool_calls` 这个字段**是否非空**,同时检查 `finish_reason == "length"` 并报警(这说明 `max_tokens` 设小了)。`execute_call` 对 `16`、`20`、`28` 这三种都正确地返回了错误字符串,没有崩。

### 零件对照

| 零件 | 今天的文件 | 明天 |
| --- | --- | --- |
| 真的工具函数 | `weather_api.py` 的 `get_weather`、`WeatherError` | 不变 |
| 四道关 | `tool_runner.py` 的 `execute_call` | 原样使用,结果放进 tool 消息 |
| 手工造请求测失败 | `fail_modes.py` | 之后写测试都用这个办法 |
| 一轮提请求 | `first_run.py` | [Day 159](/blog/agent-zero/day-159-tool-roundtrip/) 接上第二次请求 |
| 判断有没有请求 | `ask_cases.py`、`truncated.py` | 练习 2 的 `plan` |

## 动手练习

三道题,练习 2 约 2 次模型调用,其余不联网。

**练习 1:接口返回的华氏度到底对不对?** 不经过模型,直接调 `get_weather` 查北京的摄氏和华氏,按公式 `F = C × 9/5 + 32` 验证,打印差值。再想一想:如果接口先后两次请求之间天气数据更新了一次,会发生什么?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex158_units.py
from part03.weather_api import get_weather

c = get_weather("北京", "celsius")
f = get_weather("北京", "fahrenheit")
print("摄氏:", c["temperature"], "华氏:", f["temperature"])
expect = c["temperature"] * 9 / 5 + 32
print(f"按公式 {c['temperature']} × 9/5 + 32 = {expect:.1f},接口给的是 {f['temperature']}")
print("差值:", round(abs(expect - f["temperature"]), 2))
```

<div class="line-notes">

- `from part03.weather_api import get_weather` 直接用函数,不经过模型,也不经过 `execute_call`。
- `c = get_weather("北京", "celsius")` 第一次请求,摄氏。
- `f = get_weather("北京", "fahrenheit")` 第二次请求,华氏。两次是**两个独立的 HTTP 请求**。
- `expect = c["temperature"] * 9 / 5 + 32` 按公式把摄氏换算成华氏:代入 `12.5 × 9 / 5 + 32 = 22.5 + 32 = 54.5`。
- `print(f"按公式 {c['temperature']} × 9/5 + 32 = {expect:.1f},接口给的是 {f['temperature']}")` `:.1f` 保留一位小数。
- `print("差值:", round(abs(expect - f["temperature"]), 2))` `abs` 取绝对值,`round(x, 2)` 保留两位。

</div>

```bash
uv run python -m part03.ex158_units
```

```text
摄氏: 12.5 华氏: 54.5
按公式 12.5 × 9/5 + 32 = 54.5,接口给的是 54.5
差值: 0.0
```

差值是 0,接口的换算和公式一致。至于「两次请求之间数据更新」:Open-Meteo 的当前值每 900 秒(15 分钟,返回里 `current.interval` 就是 900)更新一次,两次请求如果跨了更新点,摄氏和华氏就不是同一时刻的数据,差值会不是 0。我这次没碰上,所以**不能保证**每次都是 0。写测试时,遇到这种来自外部服务、会随时间变的数据,不要断言精确相等,断言「差值小于某个容忍度」,或者干脆不在测试里联网(练习 3 的思路)。

</details>

**练习 2:写一个 `plan` 函数,同时处理「有请求」和「没请求」。** 模型回复要么是一句话,要么是一批请求,二选一。写一个数据类 `Step` 装这两种情况,和 `plan(r: ChatResult) -> Step`,要求:`tool_calls` 不存在、是 `None`、是空列表,都当作没有请求。用两个问题(缺城市和不缺城市)实测,再写 3 个不联网的 pytest。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex158_step.py
from dataclasses import dataclass, field
from typing import Any

from common.llm import ChatResult, LLMClient
from part03.weather_tool import WEATHER_TOOL


@dataclass
class Step:
    """模型这一步的结果:要么是一句话(answer),要么是一批工具请求(calls)。二选一。"""

    answer: str | None = None
    calls: list[dict[str, Any]] = field(default_factory=list)


def plan(r: ChatResult) -> Step:
    calls = r.message.get("tool_calls") or []  # 没有这个 key 或者是 None,都当作没有请求
    if calls:
        return Step(calls=calls)
    return Step(answer=r.content)


if __name__ == "__main__":
    client = LLMClient()
    for q in ["出门要带伞吗?", "北京要带伞吗?"]:
        r = client.chat(
            [{"role": "system", "content": "你是云簿 CloudLedger 的客服助手。回答简短。"}, {"role": "user", "content": q}],
            tools=[WEATHER_TOOL],
            temperature=0,
            max_tokens=200,
        )
        step = plan(r)
        print(f"问:{q}")
        print("  → 请求:" if step.calls else "  → 回答:", step.calls or step.answer)
```

<div class="line-notes">

- `from dataclasses import dataclass, field` 数据类([Day 50](/blog/agent-zero/day-050-dataclass/)),`field` 用来给列表字段设默认值。
- `from common.llm import ChatResult, LLMClient` `ChatResult` 是 `client.chat` 返回的类型,拿它做类型标注。
- `@dataclass` 让下面的类自动有构造函数。
- `answer: str | None = None` 一句话的情况:有内容,请求为空。
- `calls: list[dict[str, Any]] = field(default_factory=list)` 请求的情况。可变默认值(列表)不能直接写 `= []`,要用 `field(default_factory=list)`,不然所有实例共用同一个列表。
- `def plan(r: ChatResult) -> Step:` 看一次回复,返回「这一步该干什么」。
- `calls = r.message.get("tool_calls") or []  # 没有这个 key 或者是 None,都当作没有请求` `get` 取不到给 `None`,`None or []` 得到 `[]`;已经是空列表时 `[] or []` 还是 `[]`。三种「没有」一行搞定。
- `if calls:` 非空列表为真。
- `return Step(calls=calls)` 有请求:装进去,`answer` 保持默认的 `None`。
- `return Step(answer=r.content)` 没请求:装进它说的话。
- `step = plan(r)` 实测调用的地方。
- `print("  → 请求:" if step.calls else "  → 回答:", step.calls or step.answer)` 条件表达式选前缀,`or` 选内容:有请求就打印请求列表,没有就打印回答。

</div>

```bash
uv run python -m part03.ex158_step
```

```text
问:出门要带伞吗?
  → 回答: 您在哪个城市呢?告诉我城市名,我帮您查一下当前天气。
问:北京要带伞吗?
  → 请求: [{'id': 'call_00_lViKnHyZashLnuuSBh1E4561', 'function': {'arguments': '{"city": "北京"}', 'name': 'get_weather'}, 'type': 'function', 'index': 0}]
```

测试:

```python
# agent-zero-lab/tests/test_ex158_step.py
from typing import Any

from common.llm import ChatResult
from part03.ex158_step import plan


def make(message: dict[str, Any], finish: str) -> ChatResult:
    return ChatResult(content=message.get("content") or "", reasoning=None, finish_reason=finish, message=message)


def test_plain_answer() -> None:
    step = plan(make({"role": "assistant", "content": "您在哪个城市?"}, "stop"))
    assert step.answer == "您在哪个城市?"
    assert step.calls == []


def test_tool_calls() -> None:
    call = {"id": "c1", "type": "function", "function": {"name": "get_weather", "arguments": '{"city": "北京"}'}}
    step = plan(make({"role": "assistant", "content": "", "tool_calls": [call]}, "tool_calls"))
    assert step.calls == [call]
    assert step.answer is None


def test_tool_calls_none_counts_as_no_calls() -> None:
    step = plan(make({"role": "assistant", "content": "好的", "tool_calls": None}, "stop"))
    assert step.answer == "好的"
```

<div class="line-notes">

- `from common.llm import ChatResult` 测试里要手工造一个 `ChatResult`。
- `def make(message: dict[str, Any], finish: str) -> ChatResult:` 小工厂函数:`ChatResult` 有几个必填字段,每个测试都写一遍太啰嗦。
- `return ChatResult(content=message.get("content") or "", reasoning=None, finish_reason=finish, message=message)` 只填必要的字段,其余用默认值(`prompt_tokens` 等默认是 0)。
- `def test_plain_answer() -> None:` 用例一:普通回答。
- `assert step.calls == []` 没有请求。
- `call = {"id": "c1", "type": "function", "function": {"name": "get_weather", "arguments": '{"city": "北京"}'}}` 手工造一个请求,和模型返回的形状一致。
- `assert step.calls == [call]` 请求原样装进去。
- `def test_tool_calls_none_counts_as_no_calls() -> None:` 用例三:`tool_calls` 是 `None` 也算没有请求,有些厂商会返回 `null`。

</div>

```bash
uv run pytest -q tests/test_ex158_step.py
```

```text
...                                                                      [100%]
3 passed in 0.08s
```

(这三个测试一个模型调用都没有,因为**手工造数据**就能把分支覆盖全,不需要真的问模型。这是写 Agent 测试的基本功。)

</details>

**练习 3:给 `execute_call` 写不联网的测试。** 用假函数换掉真的天气函数(`funcs` 参数就是为这个留的),覆盖:成功、八种失败(没有这个工具、JSON 被截断、缺必填、类型不对、枚举不对、多余参数、城市不存在、不是对象)、以及工具内部出 bug 时不泄露细节。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/tests/test_tool_runner.py
import json
from collections.abc import Callable
from typing import Any

import pytest

from part03.tool_runner import execute_call
from part03.weather_api import WeatherError
from part03.weather_tool import WEATHER_TOOL

TOOLS = [WEATHER_TOOL]


def call(arguments: str, name: str = "get_weather") -> dict[str, Any]:
    return {"id": "c1", "type": "function", "function": {"name": name, "arguments": arguments}}


def fake_weather(city: str, unit: str = "celsius") -> dict[str, Any]:
    if city == "火星城":
        raise WeatherError("找不到叫 '火星城' 的城市,请换个写法")
    if city == "炸":
        raise RuntimeError("内部细节不该泄露")
    return {"city": city, "temperature": 20.0, "unit": unit}


FUNCS: dict[str, Callable[..., Any]] = {"get_weather": fake_weather}


def run(arguments: str, name: str = "get_weather") -> str:
    return execute_call(call(arguments, name), TOOLS, FUNCS)


def test_success_returns_json_string() -> None:
    out = run('{"city": "北京", "unit": "fahrenheit"}')
    assert json.loads(out) == {"city": "北京", "temperature": 20.0, "unit": "fahrenheit"}


@pytest.mark.parametrize(
    ("arguments", "name", "expect"),
    [
        ("{}", "delete_all_invoices", "没有叫 'delete_all_invoices' 的工具"),
        ('{"city": "北', "get_weather", "不是合法的 JSON"),
        ("{}", "get_weather", "'city' is a required property"),
        ('{"city": 123}', "get_weather", "is not of type 'string'"),
        ('{"city": "北京", "unit": "kelvin"}', "get_weather", "is not one of"),
        ('{"city": "北京", "timeout": 0.001}', "get_weather", "Additional properties"),
        ('{"city": "火星城"}', "get_weather", "找不到叫 '火星城' 的城市"),
        ('["北京"]', "get_weather", "is not of type 'object'"),
    ],
)
def test_errors_become_strings(arguments: str, name: str, expect: str) -> None:
    out = run(arguments, name)
    assert out.startswith("错误:")
    assert expect in out


def test_internal_error_hides_details() -> None:
    out = run('{"city": "炸"}')
    assert out == "错误:工具内部出错(RuntimeError)"
    assert "内部细节" not in out
```

<div class="line-notes">

- `import pytest` 用参数化装饰器。
- `from part03.weather_api import WeatherError` 假函数要抛同一个异常类型。
- `TOOLS = [WEATHER_TOOL]` 定义用真的,函数用假的。
- `def call(arguments: str, name: str = "get_weather") -> dict[str, Any]:` 造请求的小工具函数。
- `def fake_weather(city: str, unit: str = "celsius") -> dict[str, Any]:` 假函数,不联网。
- `raise WeatherError("找不到叫 '火星城' 的城市,请换个写法")` 模拟「城市不存在」。
- `raise RuntimeError("内部细节不该泄露")` 模拟工具里的 bug:异常消息里有一句不该被模型看到的话。
- `FUNCS: dict[str, Callable[..., Any]] = {"get_weather": fake_weather}` 白名单换成假函数。
- `return execute_call(call(arguments, name), TOOLS, FUNCS)` 第三个参数传进去,覆盖默认的真函数。
- `assert json.loads(out) == {"city": "北京", "temperature": 20.0, "unit": "fahrenheit"}` 成功的返回值是 JSON 字符串,解析回来再比较,不比较字符串(字符串里 key 的顺序不应该成为测试的负担)。
- `@pytest.mark.parametrize(` 八种失败各一行。
- `("{}", "delete_all_invoices", "没有叫 'delete_all_invoices' 的工具"),` 每行三项:参数字符串、工具名、返回值里应该包含的片段。
- `('["北京"]', "get_weather", "is not of type 'object'"),` 参数是合法 JSON,但是个数组,不是对象,第三关拦住。
- `assert out.startswith("错误:")` 统一格式:所有失败都以「错误:」开头。
- `assert expect in out` 并且包含具体原因。
- `assert out == "错误:工具内部出错(RuntimeError)"` 内部 bug 只给类型名。
- `assert "内部细节" not in out` 明确断言细节没有泄露。

</div>

```bash
uv run pytest -q tests/test_tool_runner.py
```

```text
..........                                                           [100%]
10 passed in 0.12s
```

(1 个成功 + 8 个参数化的失败 + 1 个内部出错,共 10 个。)以后有人改 `execute_call` 的顺序或者错误文字,这组测试第一时间变红。

</details>

**验收标准:** 能说出「工具函数先单独测」的理由,并跑通 `weather_api.py`;能解释 `params=` 和字符串拼接的区别;`execute_call` 的四道关各自挡什么能说出来,并且知道为什么返回字符串而不是抛异常;能解释为什么截断时 `finish_reason` 是 `length`、该怎么判断「有没有请求」;`tests/test_tool_runner.py` 和 `tests/test_ex158_step.py` 全过。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 地理编码(geocoding) | 把「北京」这样的地名换成经纬度。Open-Meteo 的天气接口只认经纬度,所以查天气要先后调两个接口 |
| WMO 天气代码 | 世界气象组织定的天气编号,Open-Meteo 返回的 `weather_code` 就是它,0 是晴、3 是阴、95 是雷暴,要自己翻译成中文 |
| `params=` | httpx 里传查询参数的方式,会替你做 URL 编码。比字符串拼接安全,也不会漏编码 |
| 注入(injection) | 外面给的数据被当成了「结构」而不是「数据」,比如城市名里的 `&count=100` 被当成另一个查询参数。SQL 注入、命令注入同理 |
| `raise ... from e` | 抛出新异常的同时把原来的异常挂在 `__cause__` 上,调试时能看到真正的原因 |
| `WeatherError` | 今天自定义的异常,表示「预料之内的工具失败」,和程序 bug 区分开 |
| `execute_call` | 今天写的执行函数:白名单、解析、检查、执行四道关,返回字符串,不抛异常 |
| 白名单 | 只允许表里有的名字,其他一律拒绝 |
| `additionalProperties: false` | 不收 schema 里没写的参数。JSON Schema 默认允许,执行侧要显式加上 |
| `finish_reason == "length"` | 回复因为 `max_tokens` 到顶被截断。带工具时,截断可能留下半截的 `arguments` |
| `sys.argv` | 命令行参数列表,`[0]` 是脚本名,后面是你传的参数,都是字符串 |

## 常见误区

**函数没单独测过就交给模型。** 模型参数填错和函数本身有 bug,表现都是「查不到」。先 `python -m part03.weather_api` 跑通,再接模型。

**用字符串拼 URL。** `f"...?name={city}"` 里的 `city` 是模型给的,可能夹着 `&count=100`。用 `params=`。这条同样适用于 SQL(用参数化查询)、命令行(传列表不拼字符串)、文件路径(限定在目录内)。

**只判断 `finish_reason == "tool_calls"`。** 截断时是 `length`,但 `tool_calls` 里可能已经有半截的请求。看 `tool_calls` 是否非空,并且遇到 `length` 要报警。

**`arguments` 直接 `json.loads` 不处理失败。** 不管截断还是模型写错,总会有解析失败的时候。不处理就是线上一个未捕获异常。

**工具里的错误直接抛出去。** 会把整个程序带崩。预料之内的失败(找不到、超时)包成自己的异常,最外层转成「错误:…」的字符串,让模型有机会向用户解释或换个参数重试。

**把 Python 异常的原文发给模型。** 里面可能有内部地址、路径、SQL 片段。给模型看类型名和一句人话,细节留在日志里。

**`except Exception` 放在具体异常前面。** Python 按顺序匹配,宽的在前,窄的永远走不到。具体的在前,兜底的在最后。

**不加 `additionalProperties: false`。** `**args` 展开时,多余的键会变成多余的函数参数,模型(或者对模型下手的人)能传进你没打算开放的开关。

**假设模型会规范化参数。** `Beijing`、`北京`、`北京市` 它哪天传哪个不一定。接口要么都认,要么在函数里自己做规范化。

**默认相信「模型这次拒绝了所以安全」。** 昨天已经看到,换个措辞它就照传。检查要在代码里做。

## 学习资料

### 文档与文章

- [Open-Meteo 文档](https://open-meteo.com/en/docs):英文,免费天气接口,看 `current` 参数能要哪些变量、`temperature_unit` 怎么换单位。
- [Open-Meteo 地理编码接口](https://open-meteo.com/en/docs/geocoding-api):英文,今天第一步用的 `search` 接口,可选 `language`、`count`。
- [httpx 文档:Timeouts](https://www.python-httpx.org/advanced/timeouts/):英文,四种超时(连接、读、写、连接池)分别是什么,今天的 `timeout=` 是一次性设四个。
- [DeepSeek 文档:Tool Calls](https://api-docs.deepseek.com/zh-cn/guides/tool_calls):中文,有一个完整的天气示例,可以和今天的写法对一下。
- [OpenAI 文档:Function calling](https://platform.openai.com/docs/guides/function-calling):英文,看里面处理工具调用结果的那一段;注意各家文档都强调工具的结果由调用方负责执行。
- [Anthropic 文档:Handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls):英文,Claude 一侧怎么解析请求、怎么回传结果,今天的四道关在那边也成立。Day 164 对照讲。
- [OWASP:Injection Flaws](https://owasp.org/www-community/Injection_Flaws):英文,注入类漏洞的总览,今天的 URL 拼接是其中最小的一个例子。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1yUQhYwEJ2&autoplay=0&high_quality=1" title="【大模型tool calls】工具调用原理、MCP协议及极简browser use实现" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>胖虎遛二狗 · 【大模型tool calls】工具调用原理、MCP协议及极简browser use实现 · 14 分 48 秒,2025 年 3 月。从原理讲到代码。今天只看工具调用原理那一段,MCP 和 browser use 是第五部分以后的事。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1vqNX6xEDC&autoplay=0&high_quality=1" title="大模型面试:Agent工具调用失败怎么处理?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI-Agent搭建 · 大模型面试:Agent工具调用失败怎么处理? · 3 分 11 秒,2026 年 7 月。短,面试口径。看完对照今天的「失败变成字符串发回给模型」,看它讲的处理办法有哪几种。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/gMeTK6zzaO4" title="LLM Function Calling - AI Tools Deep Dive" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Adam Lucek · LLM Function Calling - AI Tools Deep Dive · 英文。讲函数调用的整体流程,我没有逐帧看过,按标题和简介选的,看的时候对照今天的链路图。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/LP5OCa20Zpg" title="Tips for building AI agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Anthropic · Tips for building AI agents · 英文,Anthropic 官方频道。第三部分才刚开始,先混个脸熟:工具失败时怎么设计、结果怎么回给模型,后面几天会一点点做到。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering: Building Applications with Foundation Models》(O'Reilly,2025):英文,Agent 那一章里讲了工具调用的失败模式。[出版社页面](https://www.oreilly.com/library/view/ai-engineering/9781098166298/)(对爬虫返回 403,需浏览器打开)。

### 开源项目与代码

- [encode/httpx](https://github.com/encode/httpx):今天用的 HTTP 库,`docs` 目录里能看到超时和异常类的层级。
- [open-meteo/open-meteo](https://github.com/open-meteo/open-meteo):Open-Meteo 本身的开源仓库,想知道 `weather_code` 都有哪些可以去翻。

## 自测

1. 为什么要先把工具函数单独测通,再交给模型?

<details><summary>答案</summary>

模型参数填错和函数自己有 bug,在 Agent 里表现都是「没查到」或者「答非所问」,混在一起很难排查。函数能被普通代码稳定调通以后,再接模型,出了问题就可以把怀疑集中在参数和提示词上。

</details>

2. `execute_call` 的四道关是什么顺序?每一关挡什么?

<details><summary>答案</summary>

一,白名单:函数名必须在表里,挡住不存在或者不该开放的工具;二,解析:`arguments` 字符串要能 `json.loads`,挡住被截断或者写坏的 JSON;三,本地检查:用同一份 schema 加 `additionalProperties: false`,挡住缺必填、类型错、枚举外和多余参数;四,执行:函数自己的失败(找不到城市、服务超时)变成「错误:…」。四关的返回值都是字符串,不抛异常。

</details>

3. 为什么工具的错误要返回一句「错误:…」的字符串,而不是直接抛异常?

<details><summary>答案</summary>

这句话之后会放进 tool 消息发回模型,模型读到「找不到叫 '火星城' 的城市,请换个写法」就能告诉用户或者换个参数再试;抛异常的话整个程序先崩了,模型没有机会处理。同时返回的信息要克制,只给类型名和人话,不带内部细节。

</details>

4. 模型的回复被 `max_tokens` 截断了,`finish_reason` 是什么?只判断 `finish_reason == "tool_calls"` 会怎样?

<details><summary>答案</summary>

是 `length`。截断时 `tool_calls` 里可能有请求,但 `arguments` 是半截的(实测可能是空字符串、`{"city` 或缺一个右花括号),只判断 `tool_calls` 会把它们当成普通回答静默丢掉,用户看到空回复。正确做法:看 `tool_calls` 是否非空来判断有没有请求,同时遇到 `length` 报警,解析失败的结果当「错误」处理。

</details>

5. 面试题:「模型给的工具参数里夹带了恶意内容,比如城市名是 `北京&count=100`,你怎么防?」

<details><summary>答案</summary>

分层。一,参数用 schema 检查,限定类型、取值范围或枚举,显式禁止多余参数;二,凡是参数要进入 URL、SQL、命令行、文件路径,一律用参数化方式,不做字符串拼接(httpx 的 `params=`、SQL 的占位符、`subprocess` 传列表、路径限定在白名单目录内),这样即使内容夹带了特殊字符,也只是数据,不会变成结构;三,工具本身用最小权限,能只读就只读,别给它超过需要的能力;四,工具结果和错误信息里不暴露内部细节。不能依赖「模型这次拒绝了」。

</details>

6. 面试题:「工具调用失败(超时、参数错误、服务返回 500)你会怎么设计处理?」

<details><summary>答案</summary>

先区分失败来源:参数不合格是模型的错,把具体原因作为工具结果返回,让它修正后重试;下游服务暂时不可用是环境的错,设置超时,返回「暂时不可用」让模型告诉用户,必要时有限次重试(幂等的工具才能自动重试);工具自己的 bug 记日志、告警,返回通用错误,不泄露细节。整个过程要有上限(重试次数、总步数),并且所有失败都留日志便于复盘。后面的失败模式几天会逐个展开。

</details>

## 明天预告

Day 159 · 一来一回:回传 tool 消息,消息时序图。今天结果卡在我们的变量里,模型还没看到。明天做两件事:把模型那条「我要调工具」的消息原样放回 `messages`,再加一条 `role: "tool"` 的消息,带着 `tool_call_id` 和今天的结果字符串,发出第二次请求,让模型写出最终回答。会画一张完整的消息时序图,故意制造几个 400 和 422 的真实报错(漏了 assistant 那条、`tool_call_id` 写错、`content` 放了字典),还会看到一个吓人的现象:工具结果是空字符串时,模型会自己编一个温度。
