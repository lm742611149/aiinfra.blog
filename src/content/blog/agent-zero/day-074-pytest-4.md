---
title: 'Day 74 · pytest(四):假对象和 monkeypatch'
description: '天气工具每次都要真的联网,测试慢、结果每次不一样、断网就挂。今天手写一个假的 HTTP 客户端顶替真的(对照 TS 的结构类型),再用 pytest 自带的 monkeypatch 临时换掉模块里的函数和环境变量(对照 jest.mock),测完自动还原。'
pubDate: 2026-10-22
regime: none
tags: ['python', 'pytest', 'testing', 'agent-zero']
series: 'agent-zero'
day: 74
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 73](/blog/agent-zero/day-073-pytest-3/) 学了 fixture 和 parametrize:用 `@pytest.fixture` 把准备工作抽出来,测试在参数里写上名字就能拿到;用 `yield` 写清理;`tmp_path` 给每个测试一个临时目录;`conftest.py` 放共享的 fixture;`@pytest.mark.parametrize` 把一个测试函数按数据表展开成多条用例。到现在为止,我们测的 `total_cost` 和 `total_from_file` 都是「给输入、算输出」的纯计算,不碰网络。

可这门课后面要写的东西几乎都要碰网络:[Day 70](/blog/agent-zero/day-070-weather-project/) 的天气工具要请求 Open-Meteo,以后的 Agent 要请求模型 API、调工具、查数据库。这类代码怎么测,就是今天的内容。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说清楚为什么单元测试里不该发真请求,并能在本机制造一次「断网」看测试怎么挂。
2. 手写一个假的 HTTP 客户端 `FakeClient`,按剧本返回响应或抛异常,用它把天气工具的成功、找不到城市、500、超时四条路径都测一遍,一分钱不花、一秒钟不到。
3. 会用 pytest 自带的 `monkeypatch` fixture:`setattr` 临时换掉模块里的函数或类,`setenv`/`delenv` 临时改环境变量,并且知道它测完会自动还原。
4. 能认出两个最常见的坑:手动替换不还原导致后面的测试一起挂;模块在导入时就读了环境变量,`setenv` 改了也没用。

预计用时:2.5–3 小时。

前置:[Day 49](/blog/agent-zero/day-049-type-hints-4/) 的 Protocol、[Day 53](/blog/agent-zero/day-053-env-secrets/) 的环境变量、[Day 64](/blog/agent-zero/day-064-httpx-1/) 和 [Day 65](/blog/agent-zero/day-065-httpx-2/) 的 httpx 和它的异常、[Day 67](/blog/agent-zero/day-067-async-2/) 的 `asyncio.run`、[Day 70](/blog/agent-zero/day-070-weather-project/) 的天气工具,以及 [Day 71](/blog/agent-zero/day-071-pytest-1/) 到 [Day 73](/blog/agent-zero/day-073-pytest-3/) 的 pytest 三课。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `tests/fakes.py` 里的 `FakeClient` 和 `test_weather_main.py` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先看今天要测的代码

下面是 [Day 70](/blog/agent-zero/day-070-weather-project/) 写完的 `part01/weather_cli.py`。今天在它上面做了两处小改动,先说是哪两处,免得你对不上:

- 函数参数 `client` 的类型从 `httpx.AsyncClient` 改成了一个 Protocol `HttpClient`(第 1 处,第 2 步会讲为什么)。
- 超时秒数原来写死 10,现在可以用环境变量 `WEATHER_TIMEOUT` 改(第 2 处,第 6 步要测它)。

如果你 Day 70 写的版本函数名、提示文字和这里不一样,先照这份改过来,今天所有测试都基于它。

```python
# agent-zero-lab/part01/weather_cli.py
import asyncio
import os
import sys
from typing import Any, Protocol

import httpx

GEO_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"


class HttpClient(Protocol):
    async def get(self, url: str, *, params: dict[str, Any] | None = None) -> httpx.Response: ...


class WeatherError(Exception):
    """查天气失败,带一句给人看的原因。"""


async def geocode(client: HttpClient, city: str) -> tuple[float, float]:
    resp = await client.get(GEO_URL, params={"name": city, "count": 1, "language": "zh"})
    resp.raise_for_status()
    results = resp.json().get("results")
    if not results:
        raise WeatherError(f"找不到城市: {city}")
    return results[0]["latitude"], results[0]["longitude"]


async def current_temp(client: HttpClient, lat: float, lon: float) -> float:
    resp = await client.get(FORECAST_URL, params={"latitude": lat, "longitude": lon, "current": "temperature_2m"})
    resp.raise_for_status()
    return resp.json()["current"]["temperature_2m"]


async def get_weather(client: HttpClient, city: str) -> str:
    try:
        lat, lon = await geocode(client, city)
        temp = await current_temp(client, lat, lon)
    except httpx.TimeoutException:
        return f"{city}: 请求超时"
    except httpx.HTTPStatusError as e:
        return f"{city}: 接口返回 {e.response.status_code}"
    except WeatherError as e:
        return str(e)
    return f"{city}: {temp}°C"


def timeout_seconds() -> float:
    return float(os.environ.get("WEATHER_TIMEOUT", "10"))


async def main(cities: list[str]) -> None:
    async with httpx.AsyncClient(timeout=timeout_seconds()) as client:
        lines = await asyncio.gather(*(get_weather(client, c) for c in cities))
    for line in lines:
        print(line)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:] or ["北京"]))
```

<div class="line-notes">

- `from typing import Any, Protocol` `Protocol` 是 Day 49 学的「结构类型」,相当于 TS 里的 `interface`:只规定长什么样,不管是谁。
- `GEO_URL = "https://geocoding-api.open-meteo.com/v1/search"` 地理编码接口:城市名换经纬度。今天测试里会拿这个常量当「路由表」的键。
- `FORECAST_URL = "https://api.open-meteo.com/v1/forecast"` 天气预报接口:经纬度换温度。
- `class HttpClient(Protocol):` 改动 1。意思是「任何有一个 `async def get(url, *, params=None)` 方法、返回 `httpx.Response` 的对象,都算 `HttpClient`」。真的 `httpx.AsyncClient` 满足,等会儿写的假客户端也满足。
- `async def get(self, url: str, *, params: dict[str, Any] | None = None) -> httpx.Response: ...` 参数里那个单独的 `*` 表示后面的参数只能按名字传(`params=...`),不能按位置传。httpx 自己的 `get` 就是这么定义的,所以这里照抄。结尾的 `...` 是「这里没有函数体」,Protocol 里只写签名。
- `async def geocode(client: HttpClient, city: str) -> tuple[float, float]:` 第一步:城市名 → `(纬度, 经度)`。client 是从外面传进来的,不是函数里自己 new 的。这一点今天非常关键。
- `resp = await client.get(GEO_URL, params={"name": city, "count": 1, "language": "zh"})` 实跑时 `city="北京"`,httpx 会拼出 `...search?name=%E5%8C%97%E4%BA%AC&count=1&language=zh`。
- `resp.raise_for_status()` 状态码是 4xx/5xx 就抛 `httpx.HTTPStatusError`,Day 65 学的。
- `results = resp.json().get("results")` 我实测请求「北京」,返回里 `results` 是一个列表,第一项有 `"latitude": 39.9075, "longitude": 116.39723`;请求一个瞎编的名字 `qwertyzz`,返回只有 `{"generationtime_ms": 0.18656254}`,根本没有 `results` 这个键,所以用 `.get` 取,拿到 `None`。
- `if not results:` `None` 和空列表都算「假」,都走这里。
- `raise WeatherError(f"找不到城市: {city}")` 用 Day 36 学的自定义异常表达「业务上的失败」。
- `return results[0]["latitude"], results[0]["longitude"]` 北京返回 `(39.9075, 116.39723)`。
- `async def current_temp(client: HttpClient, lat: float, lon: float) -> float:` 第二步:经纬度 → 当前气温。
- `resp = await client.get(FORECAST_URL, params={"latitude": lat, "longitude": lon, "current": "temperature_2m"})` `current=temperature_2m` 是 Open-Meteo 的参数,意思是「要当前 2 米高处的气温」。
- `return resp.json()["current"]["temperature_2m"]` 我写这篇时(北京时间 12 点多)实测是 `14.5`。
- `async def get_weather(client: HttpClient, city: str) -> str:` 把两步串起来,并把各种失败变成一句人话。今天主要测的就是它。
- `except httpx.TimeoutException:` 超时的总类,下面有 `ConnectTimeout`、`ReadTimeout` 等子类,写总类就都能接住。
- `except httpx.HTTPStatusError as e:` `raise_for_status` 抛的就是它,`e.response.status_code` 是状态码。
- `except WeatherError as e:` 找不到城市。`str(e)` 就是 `"找不到城市: qwertyzz"`。
- `return f"{city}: {temp}°C"` 成功时得到 `"北京: 14.5°C"`。
- `def timeout_seconds() -> float:` 改动 2。每次调用都去读一次环境变量。
- `return float(os.environ.get("WEATHER_TIMEOUT", "10"))` 没设就用 `"10"`;设了 `WEATHER_TIMEOUT=0.001` 就是 0.001 秒,我实跑这样设,输出是 `北京: 请求超时`。
- `async with httpx.AsyncClient(timeout=timeout_seconds()) as client:` 真客户端是在 `main` 里自己 new 的。测 `main` 时要想办法把这个类换掉,第 5 步讲。
- `lines = await asyncio.gather(*(get_weather(client, c) for c in cities))` Day 68 的 gather,几个城市同时查,结果按传入顺序排。
- `print(line)` 结果打到屏幕。
- `asyncio.run(main(sys.argv[1:] or ["北京"]))` 命令行参数就是城市列表,不给就查北京。

</div>

在仓库根目录真跑一次(需要联网):

```bash
time uv run python -m part01.weather_cli 北京 上海 qwertyzz
```

实跑输出:

```text
北京: 14.5°C
上海: 21.0°C
找不到城市: qwertyzz
uv run python -m part01.weather_cli 北京 上海 qwertyzz  1.18s user 0.28s system 26% cpu 5.620 total
```

5.6 秒。`time` 是 zsh 自带的计时,最后的 `total` 是总耗时。我在国内走代理访问 Open-Meteo,所以慢一些,你那边可能快,也可能更慢。

## 第 1 步:用真请求写测试,问题在哪

先用 Day 71 学的办法,直接写一个联网的测试,看看会遇到什么。新建 `tests/test_weather_real.py`:

```python
# agent-zero-lab/tests/test_weather_real.py(演示用,看完删掉)
import asyncio

import httpx

from part01.weather_cli import get_weather


async def fetch_beijing() -> str:
    async with httpx.AsyncClient(timeout=10) as client:
        return await get_weather(client, "北京")


def test_beijing_real():
    line = asyncio.run(fetch_beijing())
    print(line)
    assert line == "北京: 14.5°C"
```

<div class="line-notes">

- `async def fetch_beijing() -> str:` 测试函数本身先写成普通函数(为什么不能直接写 `async def test_...`,第 3 步演示),所以把异步的部分包进一个协程。
- `async with httpx.AsyncClient(timeout=10) as client:` 真的客户端,真的会联网。
- `return await get_weather(client, "北京")` 返回 `"北京: 14.5°C"` 这样的字符串。
- `line = asyncio.run(fetch_beijing())` Day 67 学的,在普通函数里跑一个协程并拿到它的返回值。
- `assert line == "北京: 14.5°C"` 问题就出在这里:期望值写的是我写文章那一刻的气温。

</div>

```bash
uv run pytest tests/test_weather_real.py -q -s
```

实跑输出:

```text
北京: 14.5°C
.
1 passed in 4.94s
```

过了,但有三个问题,每一个都会在后面真的咬你一口。

**结果每次不一样。** 气温一小时一变,这个测试今天下午还绿,晚上就红了,而代码一个字没改。测试变红应该只意味着「代码有问题」,不能意味着「天气变了」。你也许会想改成 `assert "°C" in line`,那就几乎什么都没测。

**慢。** 一个测试 4.94 秒,而 Day 73 的 30 个测试加起来 0.44 秒。以后测试有几百个,每个都联网,跑一遍要几分钟,你就不会愿意常跑了。

**网络不归你管。** 我故意制造一次断网。httpx 默认会读 `HTTPS_PROXY` 这类代理环境变量,我把代理指到本机一个没人监听的端口 9,请求就一定发不出去:

```bash
HTTPS_PROXY=http://127.0.0.1:9 https_proxy=http://127.0.0.1:9 uv run pytest tests/test_weather_real.py -q
```

<div class="line-notes">

- `HTTPS_PROXY=http://127.0.0.1:9` 写在命令前面的 `变量=值` 只对这一条命令生效,Day 53 讲过。大写小写两个都写,是因为我本机开着代理,shell 里本来就有小写的 `https_proxy`,只改大写的那个盖不住它。你本机没开代理的话,写一个也行。

</div>

实跑输出(末尾):

```text
>           raise mapped_exc(message) from exc
E           httpx.ConnectError: All connection attempts failed

.venv/lib/python3.12/site-packages/httpx/_transports/default.py:118: ConnectError
=========================== short test summary info ============================
FAILED tests/test_weather_real.py::test_beijing_real - httpx.ConnectError: Al...
1 failed in 1.57s
```

红了,而且是 `httpx.ConnectError`,我们的 `get_weather` 根本没接这个异常。这其实暴露了一个真 bug:Day 70 只处理了超时和 HTTP 状态码,「连不上服务器」这种情况会让整个程序崩掉。练习 2 会修它。可你注意,这个 bug 是靠运气撞出来的:网好的时候它永远不会出现。

我们想要的测试是:不联网,想让它返回什么就返回什么,想让它超时就超时,想让它 500 就 500。这就要一个**假对象**。

看完删掉:`rm tests/test_weather_real.py`。

## 第 2 步:写一个假的 HTTP 客户端

假对象(fake)就是一个「长得和真的一样、但行为由你写死」的对象。`get_weather` 对 `client` 只做了一件事:`await client.get(url, params=...)`,拿回来一个 `httpx.Response`。所以只要我们的假对象也有一个这样的 `get` 方法,`get_weather` 就分不出真假。

这在前端你其实天天见。TypeScript 是结构类型:一个函数参数要 `{ get(url: string): Promise<Response> }`,你传一个字面量对象只要有这个方法就行,不用 `extends` 任何类。Python 的 Protocol 是同一个思路,运行时更是根本不检查类型,有这个方法就能跑(这种「像鸭子一样叫就当它是鸭子」的风格叫鸭子类型)。

这就是改动 1 的原因。如果参数类型写的还是 `httpx.AsyncClient`,假对象传进去照样能跑,但编辑器会画红线说类型不对。改成 Protocol 以后,真客户端和假客户端都合规,红线消失。

还有一个省事的发现:`httpx.Response` 这个类可以直接 new,不用真发请求。所以我们只假「客户端」,响应用真的,`raise_for_status()`、`.json()` 这些行为都是 httpx 原装的,不用自己模仿。

新建 `tests/test_weather_fake.py`:

```python
# agent-zero-lab/tests/test_weather_fake.py(第一版)
import asyncio
from typing import Any

import httpx

from part01.weather_cli import FORECAST_URL, GEO_URL, get_weather


class FakeClient:
    """假的 HTTP 客户端:不联网,按 URL 返回事先写好的响应。"""

    def __init__(self, routes: dict[str, httpx.Response]):
        self.routes = routes
        self.calls: list[tuple[str, dict[str, Any]]] = []

    async def get(self, url: str, *, params: dict[str, Any] | None = None) -> httpx.Response:
        self.calls.append((url, params or {}))
        return self.routes[url]


def ok(url: str, data: dict[str, Any]) -> httpx.Response:
    return httpx.Response(200, json=data, request=httpx.Request("GET", url))


def test_beijing_fake():
    fake = FakeClient({
        GEO_URL: ok(GEO_URL, {"results": [{"latitude": 39.9075, "longitude": 116.39723}]}),
        FORECAST_URL: ok(FORECAST_URL, {"current": {"temperature_2m": 14.5}}),
    })
    line = asyncio.run(get_weather(fake, "北京"))
    assert line == "北京: 14.5°C"
    print(fake.calls)
```

<div class="line-notes">

- `class FakeClient:` 一个普通的类,没有继承任何东西。它能顶替真客户端,全靠下面那个 `get` 方法的签名和真的一样。
- `def __init__(self, routes: dict[str, httpx.Response]):` 「剧本」从外面传进来:一个字典,键是 URL,值是这个 URL 该返回的响应。每个测试可以给不同的剧本。
- `self.routes = routes` 存起来,`get` 里要查。
- `self.calls: list[tuple[str, dict[str, Any]]] = []` 一个记录本,每次被调用就记下「请求了哪个 URL、带了什么参数」。测试结束后可以翻它,检查代码有没有发对请求。
- `async def get(self, url: str, *, params: dict[str, Any] | None = None) -> httpx.Response:` 签名和 `HttpClient` 一字不差。注意它也是 `async def`,因为 `get_weather` 里是 `await client.get(...)`,await 一个普通函数的返回值会报错。
- `self.calls.append((url, params or {}))` `params` 是 `None` 时 `or {}` 换成空字典,记录本里格式统一。
- `return self.routes[url]` 按 URL 查剧本。请求了剧本里没有的 URL,字典取不到会抛 `KeyError`,测试直接挂。这其实是好事:代码偷偷请求了你没预料到的地址,你会马上知道。
- `def ok(url: str, data: dict[str, Any]) -> httpx.Response:` 造一个「成功响应」的小工具,省得每次写一长串。
- `return httpx.Response(200, json=data, request=httpx.Request("GET", url))` 直接构造一个真的响应对象:状态码 200,body 是 `data` 转成的 JSON。`request=` 不能省,`raise_for_status()` 要用它拼报错信息,不传的话一调用就报错。
- `def test_beijing_fake():` 测试本身还是普通函数。
- `fake = FakeClient({` 剧本:两个 URL 各返回什么。数据是我第 1 步前面真请求时看到的返回,删掉了用不上的字段。
- `GEO_URL: ok(GEO_URL, {"results": [{"latitude": 39.9075, "longitude": 116.39723}]}),` 地理编码返回北京的经纬度。
- `FORECAST_URL: ok(FORECAST_URL, {"current": {"temperature_2m": 14.5}}),` 天气接口返回 14.5 度。这个数字现在是我定的,不会再变。
- `line = asyncio.run(get_weather(fake, "北京"))` 把假客户端传进去。`get_weather` 完全不知道自己拿到的是假的。
- `assert line == "北京: 14.5°C"` 这次可以放心写死期望值了。
- `print(fake.calls)` 看看记录本里有什么,下一步把它变成断言。

</div>

```bash
uv run pytest tests/test_weather_fake.py -q -s
```

实跑输出:

```text
[('https://geocoding-api.open-meteo.com/v1/search', {'name': '北京', 'count': 1, 'language': 'zh'}), ('https://api.open-meteo.com/v1/forecast', {'latitude': 39.9075, 'longitude': 116.39723, 'current': 'temperature_2m'})]
.
1 passed in 0.19s
```

0.19 秒,而且这 0.19 秒大部分是 pytest 自己启动的时间。拔掉网线也一样能过。记录本里有两条:先请求了地理编码,带着 `name=北京`;再请求天气,带着地理编码返回的经纬度。代码的行为一目了然。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="真客户端和假客户端:get_weather 只认 get 方法,真客户端走网络,假客户端查剧本">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="95" width="160" height="56" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
<text x="38" y="118" fill="var(--ink)">get_weather(</text>
<text x="38" y="138" fill="var(--ink)">  client, city)</text>
<text x="190" y="88" fill="var(--ink-soft)">await client.get(url, params=...)</text>
<line x1="180" y1="110" x2="330" y2="55" stroke="var(--rule)" stroke-width="2"/>
<line x1="180" y1="136" x2="330" y2="190" stroke="var(--rule)" stroke-width="2"/>
<rect x="330" y="30" width="140" height="50" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="342" y="52" fill="var(--ink)">httpx.AsyncClient</text>
<text x="342" y="70" fill="var(--ink-soft)">真客户端</text>
<line x1="470" y1="55" x2="510" y2="55" stroke="var(--rule)" stroke-width="2"/>
<rect x="510" y="30" width="115" height="50" fill="var(--paper-raised)" stroke="var(--rule)" rx="4"/>
<text x="522" y="52" fill="var(--ink)">网络</text>
<text x="522" y="70" fill="var(--ink-soft)">Open-Meteo</text>
<rect x="330" y="165" width="140" height="50" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="342" y="187" fill="var(--ink)">FakeClient</text>
<text x="342" y="205" fill="var(--ink-soft)">假客户端</text>
<line x1="470" y1="190" x2="510" y2="190" stroke="var(--rule)" stroke-width="2"/>
<rect x="510" y="165" width="115" height="50" fill="var(--paper-raised)" stroke="var(--rule)" rx="4"/>
<text x="522" y="187" fill="var(--ink)">routes 字典</text>
<text x="522" y="205" fill="var(--ink-soft)">+ calls 记录本</text>
<text x="20" y="240" fill="var(--ink-soft)">两者都满足 HttpClient(Protocol),get_weather 分不出真假</text>
</g>
</svg>
<figcaption>被测函数只依赖「有一个 get 方法」这件事。上面是生产环境走网络,下面是测试时查剧本。客户端从参数传进来,测试才有机会把假的塞进去。</figcaption>
</figure>

### 假对象长得不像会怎样

假对象只要有一处签名对不上,就骗不过去。我故意写一个偷懒的版本,`get` 只收 `url`,不收 `params`:

```python
# agent-zero-lab/tests/test_bad_fake.py(演示完删掉)
import asyncio

import httpx

from part01.weather_cli import get_weather


class LazyFake:
    async def get(self, url: str) -> httpx.Response:
        return httpx.Response(200, json={}, request=httpx.Request("GET", url))


def test_lazy_fake():
    assert asyncio.run(get_weather(LazyFake(), "北京")) == "北京: 14.5°C"
```

<div class="line-notes">

- `async def get(self, url: str) -> httpx.Response:` 少了 `params` 参数。
- `assert asyncio.run(get_weather(LazyFake(), "北京")) == "北京: 14.5°C"` 在 Zed 里这一行的 `LazyFake()` 下面会出现红线。

</div>

先看编辑器(`uv run basedpyright tests/test_bad_fake.py`)怎么说,实跑输出(路径缩短了):

```text
tests/test_bad_fake.py:15:36 - error: Argument of type "LazyFake" cannot be assigned to parameter "client" of type "HttpClient" in function "get_weather"
    "LazyFake" is incompatible with protocol "HttpClient"
      "get" is an incompatible type
        Type "(url: str) -> CoroutineType[Any, Any, Response]" is not assignable to type "(url: str, *, params: dict[str, Any] | None = None) -> CoroutineType[Any, Any, Response]"
          Missing keyword parameter "params" (reportArgumentType)
1 error, 0 warnings, 0 notes
```

最后一行说得很直白:`Missing keyword parameter "params"`。这就是改成 Protocol 的好处,假对象写错了,还没运行编辑器就告诉你。再看运行时,`uv run pytest tests/test_bad_fake.py -q` 的关键一行:

```text
E       TypeError: LazyFake.get() got an unexpected keyword argument 'params'
```

`get_weather` 调用时传了 `params=`,假对象不收,Python 报 `TypeError`。看完删掉:`rm tests/test_bad_fake.py`。

## 第 3 步:为什么测试函数不直接写成 async def

你可能想,`get_weather` 是协程,测试直接写成 `async def test_...` 然后里面 `await` 不是更顺手吗?Jest/Vitest 里 `test('x', async () => { await ... })` 就是这么写的。试一下:

```python
# agent-zero-lab/tests/test_async_demo.py(演示完删掉)
async def test_async_directly():
    assert 1 + 1 == 3
```

<div class="line-notes">

- `async def test_async_directly():` 测试函数写成协程。
- `assert 1 + 1 == 3` 故意写一个一定失败的断言,看它到底有没有被执行。

</div>

实跑 `uv run pytest tests/test_async_demo.py -q`:

```text
F                                                                        [100%]
=================================== FAILURES ===================================
_____________________________ test_async_directly ______________________________
async def functions are not natively supported.
You need to install a suitable plugin for your async framework, for example:
  - anyio
  - pytest-asyncio
  - pytest-tornasync
  - pytest-trio
  - pytest-twisted
=========================== short test summary info ============================
FAILED tests/test_async_demo.py::test_async_directly - Failed: async def func...
1 failed in 0.05s
```

失败原因不是 `1 + 1 == 3`,而是 `async def functions are not natively supported`:pytest 本身不会跑协程,要装插件。Jest 天生在 Node 的事件循环里,Python 的事件循环要有人来启动,pytest 默认不管这事。

这里有个历史坑值得知道:pytest 8.4 之前(2025 年 6 月以前的版本),遇到这种测试是**跳过并给一个警告**,结果显示成黄色的 `s`,很多人没注意,以为测试过了,其实一行都没跑。8.4.0 的更新日志写的是 "Async tests will now fail, instead of warning+skipping"。网上 2024 年以前的教程和你公司的老项目可能还是老行为,看到 `skipped` 要警觉。

插件最常用的是 pytest-asyncio(2026 年 10 月 PyPI 上是 1.4.0)。这门课前面这段先不装它,理由很简单:多一个插件就多一套配置要学,而 `asyncio.run(...)` 包一层完全够用,Day 67 早就会了。等后面测试里异步的东西多起来再引入。演示完删掉:`rm tests/test_async_demo.py`。

## 第 4 步:让假对象演失败,一次测四条路径

真接口很难让它「正好超时一次」「正好返回 500」,假对象想演什么演什么。把剧本的值从「只能是响应」扩成「响应或者异常」,遇到异常就抛出来。

另外,这个 `FakeClient` 等会儿第二个测试文件也要用。Day 73 讲过,写在某个测试文件里的东西别的文件拿不到。fixture 可以放 `conftest.py`,可 `FakeClient` 是一个类,不是 fixture。我的做法是单独建一个 `tests/fakes.py` 放它,用的地方 `from tests.fakes import FakeClient`。能这么导入,是因为 Day 72 在 `pyproject.toml` 里配了 `pythonpath = ["."]`,仓库根目录在搜索路径里,`tests` 文件夹就能当包导入。

新建 `tests/fakes.py`:

```python
# agent-zero-lab/tests/fakes.py
from typing import Any

import httpx


class FakeClient:
    """假的 HTTP 客户端:不联网,按 URL 返回事先写好的响应或抛出事先放好的异常。"""

    def __init__(self, routes: dict[str, httpx.Response | Exception]):
        self.routes = routes
        self.calls: list[tuple[str, dict[str, Any]]] = []

    async def get(self, url: str, *, params: dict[str, Any] | None = None) -> httpx.Response:
        self.calls.append((url, params or {}))
        result = self.routes[url]
        if isinstance(result, Exception):
            raise result
        return result

    async def __aenter__(self) -> "FakeClient":
        return self

    async def __aexit__(self, *args: object) -> None:
        return None


def ok(url: str, data: dict[str, Any], status: int = 200) -> httpx.Response:
    return httpx.Response(status, json=data, request=httpx.Request("GET", url))
```

<div class="line-notes">

- `def __init__(self, routes: dict[str, httpx.Response | Exception]):` 剧本的值现在可以是响应,也可以是一个异常对象。`|` 是 Day 46 学的「或」类型。
- `self.calls.append((url, params or {}))` 和第一版一样,先记账。抛异常的那次请求也会被记下来。
- `result = self.routes[url]` 取出这个 URL 对应的剧本。
- `if isinstance(result, Exception):` `isinstance` 判断一个对象是不是某个类(或它的子类)的实例,相当于 JS 的 `instanceof`。`httpx.ReadTimeout(...)` 是 `Exception` 的子类,所以成立。
- `raise result` 把剧本里放好的异常抛出去,对 `get_weather` 来说就像真的超时了一样。
- `return result` 不是异常就是响应,原样返回。
- `async def __aenter__(self) -> "FakeClient":` 这两个方法是为第 5 步准备的:`main` 里写的是 `async with httpx.AsyncClient(...) as client`,`async with` 要求对象有 `__aenter__` 和 `__aexit__`。它们的原理 Day 98 讲上下文管理器时细说,今天照抄就行。`__aenter__` 返回什么,`as client` 就拿到什么,这里返回自己。返回类型写成字符串 `"FakeClient"` 是因为类还没定义完,不能直接写类名。
- `async def __aexit__(self, *args: object) -> None:` 离开 `async with` 时调用。真客户端在这里关闭网络连接,假的没什么要关,直接返回。
- `def ok(url: str, data: dict[str, Any], status: int = 200) -> httpx.Response:` 比第一版多了 `status` 参数,默认 200,要造 500 时传 `status=500`。
- `return httpx.Response(status, json=data, request=httpx.Request("GET", url))` 状态码 500 的响应,`raise_for_status()` 会照真的规矩抛 `HTTPStatusError`。

</div>

然后把 `tests/test_weather_fake.py` 改成最终版:删掉文件里的 `FakeClient` 和 `ok`,改成从 `tests.fakes` 导入;再加一个检查请求参数的测试,和一个用 Day 73 的 parametrize 写的失败路径测试:

```python
# agent-zero-lab/tests/test_weather_fake.py
import asyncio

import httpx
import pytest

from part01.weather_cli import FORECAST_URL, GEO_URL, get_weather
from tests.fakes import FakeClient, ok

BEIJING_GEO = {"results": [{"latitude": 39.9075, "longitude": 116.39723}]}
TEMP_14_5 = {"current": {"temperature_2m": 14.5}}


def test_beijing_fake():
    fake = FakeClient({GEO_URL: ok(GEO_URL, BEIJING_GEO), FORECAST_URL: ok(FORECAST_URL, TEMP_14_5)})
    line = asyncio.run(get_weather(fake, "北京"))
    assert line == "北京: 14.5°C"


def test_sends_right_params():
    fake = FakeClient({GEO_URL: ok(GEO_URL, BEIJING_GEO), FORECAST_URL: ok(FORECAST_URL, TEMP_14_5)})
    asyncio.run(get_weather(fake, "北京"))
    assert len(fake.calls) == 2
    assert fake.calls[0] == (GEO_URL, {"name": "北京", "count": 1, "language": "zh"})
    url, params = fake.calls[1]
    assert url == FORECAST_URL
    assert params["latitude"] == 39.9075


@pytest.mark.parametrize(
    ("geo", "forecast", "expected"),
    [
        pytest.param(ok(GEO_URL, {"generationtime_ms": 0.18}), None, "找不到城市: 北京", id="not-found"),
        pytest.param(ok(GEO_URL, {}, status=500), None, "北京: 接口返回 500", id="geo-500"),
        pytest.param(httpx.ReadTimeout("timed out"), None, "北京: 请求超时", id="geo-timeout"),
        pytest.param(ok(GEO_URL, BEIJING_GEO), ok(FORECAST_URL, {"reason": "bad"}, status=400), "北京: 接口返回 400", id="forecast-400"),
    ],
)
def test_weather_errors(geo: httpx.Response | Exception, forecast: httpx.Response | None, expected: str):
    routes: dict[str, httpx.Response | Exception] = {GEO_URL: geo}
    if forecast is not None:
        routes[FORECAST_URL] = forecast
    fake = FakeClient(routes)
    assert asyncio.run(get_weather(fake, "北京")) == expected
```

<div class="line-notes">

- `from tests.fakes import FakeClient, ok` 从刚建的 `tests/fakes.py` 导入。
- `BEIJING_GEO = {"results": [{"latitude": 39.9075, "longitude": 116.39723}]}` 几个测试都要的数据提成模块级常量。全大写是 Python 里「常量」的命名习惯。
- `TEMP_14_5 = {"current": {"temperature_2m": 14.5}}` 天气接口的假返回。
- `def test_beijing_fake():` 和第一版一样,只是写短了。
- `def test_sends_right_params():` 不看返回值,看「发出去的请求对不对」。这类断言叫行为验证:有时候结果对了,但代码请求了两次、或者参数拼错了碰巧没出事,只有翻记录本才看得出来。
- `assert len(fake.calls) == 2` 正好两次请求:地理编码一次,天气一次。
- `assert fake.calls[0] == (GEO_URL, {"name": "北京", "count": 1, "language": "zh"})` 第一次请求的 URL 和参数,元组和字典都可以直接用 `==` 整体比较。
- `url, params = fake.calls[1]` 第二次请求,解包成两个变量。
- `assert params["latitude"] == 39.9075` 天气请求用的纬度,正是地理编码返回的那个数。说明两步之间的数据确实接上了。
- `@pytest.mark.parametrize(` 四种失败,逻辑一样、数据不同,正好用 Day 73 的参数化。
- `("geo", "forecast", "expected"),` 三列:地理编码接口的剧本、天气接口的剧本、期望输出。
- `pytest.param(ok(GEO_URL, {"generationtime_ms": 0.18}), None, "找不到城市: 北京", id="not-found"),` 模仿第一节里实测「找不到城市」时的真实返回:没有 `results`。天气接口根本不会被调到,剧本给 `None`。
- `pytest.param(ok(GEO_URL, {}, status=500), None, "北京: 接口返回 500", id="geo-500"),` 地理编码接口 500。`raise_for_status` 抛 `HTTPStatusError`。
- `pytest.param(httpx.ReadTimeout("timed out"), None, "北京: 请求超时", id="geo-timeout"),` 剧本里直接放一个异常对象,`FakeClient.get` 会把它抛出来。`ReadTimeout` 是「连上了但等响应超时」。
- `pytest.param(ok(GEO_URL, BEIJING_GEO), ok(FORECAST_URL, {"reason": "bad"}, status=400), "北京: 接口返回 400", id="forecast-400"),` 第一步成功、第二步 400。真接口传错纬度时就返回 400,我实测传 `latitude=999` 拿到的是 `{"error":true,"reason":"Latitude must be in range of -90 to 90°. Given: 999.0."}`。
- `def test_weather_errors(geo: httpx.Response | Exception, forecast: httpx.Response | None, expected: str):` 三个参数名和列名一一对上。
- `routes: dict[str, httpx.Response | Exception] = {GEO_URL: geo}` 先放地理编码的剧本。类型标注要写全,不然编辑器会把字典推断得太窄,下一行放不进去。
- `if forecast is not None:` 只有给了天气剧本才放进去。没放的话,代码要是误请求了天气接口,`FakeClient` 会抛 `KeyError`,测试就会挂。
- `assert asyncio.run(get_weather(fake, "北京")) == expected` 以 `geo-timeout` 为例:`geocode` 里 `await client.get(...)` 抛出 `ReadTimeout`,一路冒泡到 `get_weather` 的 `except httpx.TimeoutException`,返回 `"北京: 请求超时"`。

</div>

```bash
uv run pytest tests/test_weather_fake.py -v
```

实跑输出(中间部分):

```text
tests/test_weather_fake.py::test_beijing_fake PASSED                     [ 16%]
tests/test_weather_fake.py::test_sends_right_params PASSED               [ 33%]
tests/test_weather_fake.py::test_weather_errors[not-found] PASSED        [ 50%]
tests/test_weather_fake.py::test_weather_errors[geo-500] PASSED          [ 66%]
tests/test_weather_fake.py::test_weather_errors[geo-timeout] PASSED      [ 83%]
tests/test_weather_fake.py::test_weather_errors[forecast-400] PASSED     [100%]

============================== 6 passed in 0.28s ===============================
```

六条全绿。可全绿不说明测试有用,还得确认它真能抓 bug。我把 `get_weather` 里的 `except httpx.TimeoutException:` 故意改成 `except httpx.ConnectTimeout:`,这是很真实的手误:以为 `ConnectTimeout` 就是「超时」,其实它只管「连接阶段超时」,`ReadTimeout` 是它的兄弟不是它的子类。再跑:

```text
E           httpx.ReadTimeout: timed out
FAILED tests/test_weather_fake.py::test_weather_errors[geo-timeout] - httpx.R...
1 failed, 5 passed in 0.20s
```

`geo-timeout` 红了,其他五条不受影响,用例 id 直接告诉你是哪条路径坏了。真网络下这个 bug 要等到某天服务器正好慢才会冒出来,假对象让它在 0.2 秒内现形。看完改回 `TimeoutException`。

## 第 5 步:monkeypatch.setattr,临时换掉模块里的东西

假对象能用,是因为 `get_weather` 的 client 从参数传进来。可 `main` 不是这样:它在函数里自己 `httpx.AsyncClient(...)` new 了一个真客户端,你没机会塞假的进去。前端遇到这种情况会用 `jest.mock('axios')` 或者 `vi.mock(...)`,把整个模块换掉。pytest 的对应物是一个内置 fixture,叫 **monkeypatch**(猴子补丁,意思是程序运行中临时改掉别人的代码)。

先用一个最简单的例子看它的用法和特点,再去对付 `main`。

### 先看手动替换为什么不行

Python 里模块也是对象,模块里的函数就是它的属性。你完全可以直接赋值换掉它:`weather_cli.geocode = 别的函数`。我先这么干一次:

```python
# agent-zero-lab/tests/test_leak_demo.py(演示完删掉)
import asyncio

from part01 import weather_cli
from part01.weather_cli import HttpClient, WeatherError, get_weather
from tests.fakes import FakeClient


async def fake_geocode(client: HttpClient, city: str) -> tuple[float, float]:
    raise WeatherError(f"找不到城市: {city}")


def test_replace_by_hand():
    weather_cli.geocode = fake_geocode
    assert asyncio.run(get_weather(FakeClient({}), "火星")) == "找不到城市: 火星"
```

<div class="line-notes">

- `from part01 import weather_cli` 导入的是模块对象本身,这样才能改它的属性。
- `async def fake_geocode(client: HttpClient, city: str) -> tuple[float, float]:` 一个假的 `geocode`,签名和真的一样,永远说找不到城市。
- `weather_cli.geocode = fake_geocode` 直接把模块里的 `geocode` 换掉。`get_weather` 执行时是去 `weather_cli` 模块里按名字找 `geocode` 的,所以它会用到假的。
- `assert asyncio.run(get_weather(FakeClient({}), "火星")) == "找不到城市: 火星"` 剧本是空字典,假 `geocode` 根本不发请求,所以不需要剧本。

</div>

单独跑这个文件会过。问题出在和别的测试一起跑的时候:

```bash
uv run pytest tests/test_leak_demo.py tests/test_weather_fake.py -q
```

实跑输出(末尾):

```text
FAILED tests/test_weather_fake.py::test_beijing_fake - AssertionError: assert...
FAILED tests/test_weather_fake.py::test_sends_right_params - assert 0 == 2
FAILED tests/test_weather_fake.py::test_weather_errors[geo-500] - AssertionEr...
FAILED tests/test_weather_fake.py::test_weather_errors[geo-timeout] - Asserti...
FAILED tests/test_weather_fake.py::test_weather_errors[forecast-400] - Assert...
5 failed, 2 passed in 0.43s
```

刚才好好的 `test_weather_fake.py` 挂了五条。展开第一条,是 `assert '找不到城市: 北京' == '北京: 14.5°C'`。原因是那次手动赋值从来没被改回去,整个 pytest 运行期间 `weather_cli.geocode` 都是假的,所有后面的测试都在用一个永远找不到城市的 `geocode`。更阴险的是把两个文件顺序反过来跑(`test_weather_fake.py` 在前),实跑是 `7 passed`,全绿。同一份代码,换个顺序结果不同,Day 73 自测最后一题说的「单独跑能过、一起跑就挂」就是这种。

演示完删掉:`rm tests/test_leak_demo.py`。

### 用 monkeypatch 换,测完自动还原

新建 `tests/test_patch_intro.py`:

```python
# agent-zero-lab/tests/test_patch_intro.py
import asyncio

import pytest

from part01 import weather_cli
from part01.weather_cli import HttpClient, WeatherError, get_weather
from tests.fakes import FakeClient


async def fake_geocode(client: HttpClient, city: str) -> tuple[float, float]:
    raise WeatherError(f"找不到城市: {city}")


def test_geocode_replaced(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(weather_cli, "geocode", fake_geocode)
    print("\n测试里 geocode 是:", weather_cli.geocode.__name__)
    fake = FakeClient({})
    assert asyncio.run(get_weather(fake, "火星")) == "找不到城市: 火星"
    assert fake.calls == []


def test_geocode_restored():
    print("\n下一个测试里 geocode 是:", weather_cli.geocode.__name__)
    assert weather_cli.geocode.__name__ == "geocode"
```

<div class="line-notes">

- `def test_geocode_replaced(monkeypatch: pytest.MonkeyPatch):` 参数名写 `monkeypatch`,和 Day 73 的 `tmp_path` 一样,是 pytest 自带的 fixture,按名字注入。`: pytest.MonkeyPatch` 是类型标注,写上后编辑器能补全它的方法。
- `monkeypatch.setattr(weather_cli, "geocode", fake_geocode)` 三个参数:改哪个对象、改它的哪个属性(字符串)、换成什么。效果和 `weather_cli.geocode = fake_geocode` 一样,区别是 monkeypatch 会先把原来的值记下来,测试结束时放回去。
- `print("\n测试里 geocode 是:", weather_cli.geocode.__name__)` 函数对象的 `__name__` 是它定义时的名字,用来看现在到底是哪个函数。
- `fake = FakeClient({})` 空剧本。
- `assert asyncio.run(get_weather(fake, "火星")) == "找不到城市: 火星"` 假 `geocode` 起作用了。
- `assert fake.calls == []` 记录本是空的,证明真的 `geocode` 一次都没被调用,没有发任何请求。
- `def test_geocode_restored():` 下一个测试,没用 monkeypatch。
- `assert weather_cli.geocode.__name__ == "geocode"` 检查上一个测试换掉的东西有没有被放回来。

</div>

```bash
uv run pytest tests/test_patch_intro.py -v -s
```

实跑输出(中间部分):

```text
tests/test_patch_intro.py::test_geocode_replaced 
测试里 geocode 是: fake_geocode
PASSED
tests/test_patch_intro.py::test_geocode_restored 
下一个测试里 geocode 是: geocode
PASSED
```

测试里是 `fake_geocode`,下一个测试里又变回了 `geocode`。monkeypatch 做的事说白了就是 Day 73 学的 fixture 的 `yield` 套路:yield 之前替换并记下原值,yield 之后把原值写回去。测试失败了也照样还原。

和 `jest.mock` 比一下,两者都是「把被测代码依赖的东西临时换成假的」,但做法不一样。`jest.mock('./weather')` 是在模块加载阶段换掉整个模块,写在文件顶层,对整个测试文件生效;`monkeypatch.setattr` 是运行时改一个属性,只在当前这个测试里生效,粒度更细。Jest 里和它最像的其实是 `jest.spyOn(obj, 'method').mockImplementation(...)` 加 `afterEach(() => jest.restoreAllMocks())`。

### 对付 main:把 httpx.AsyncClient 换掉

回到 `main`。它里面写的是 `httpx.AsyncClient(timeout=...)`,执行时 Python 先找到 `weather_cli` 里的 `httpx` 这个名字(就是 httpx 模块),再取它的 `AsyncClient` 属性。那我们用 monkeypatch 把 httpx 模块的 `AsyncClient` 属性换成一个返回 `FakeClient` 的函数就行。`main` 还会 `print` 结果,要检查打印了什么,用 pytest 另一个内置 fixture `capsys`:它把测试期间打到屏幕上的内容截下来,`capsys.readouterr().out` 取出 stdout 的全部文字。

这个测试会顺带用到下一步的 `setenv`,先看代码,`setenv` 那一行下一步细讲。新建 `tests/test_weather_main.py`:

```python
# agent-zero-lab/tests/test_weather_main.py
import asyncio
from typing import Any

import pytest

from part01 import weather_cli
from part01.weather_cli import FORECAST_URL, GEO_URL
from tests.fakes import FakeClient, ok


def test_main_prints_weather(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]):
    fake = FakeClient({
        GEO_URL: ok(GEO_URL, {"results": [{"latitude": 39.9075, "longitude": 116.39723}]}),
        FORECAST_URL: ok(FORECAST_URL, {"current": {"temperature_2m": 14.5}}),
    })
    created: list[dict[str, Any]] = []

    def fake_async_client(**kwargs: Any) -> FakeClient:
        created.append(kwargs)
        return fake

    monkeypatch.setenv("WEATHER_TIMEOUT", "2.5")
    monkeypatch.setattr(weather_cli.httpx, "AsyncClient", fake_async_client)

    asyncio.run(weather_cli.main(["北京"]))

    assert capsys.readouterr().out == "北京: 14.5°C\n"
    assert created == [{"timeout": 2.5}]
    assert len(fake.calls) == 2
```

<div class="line-notes">

- `def test_main_prints_weather(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]):` 一次要两个内置 fixture。`CaptureFixture[str]` 是 `capsys` 的类型,方括号里的 `str` 表示截到的是文字。
- `fake = FakeClient({` 和前面一样的北京剧本。
- `created: list[dict[str, Any]] = []` 记下 `main` 创建客户端时传了什么参数。
- `def fake_async_client(**kwargs: Any) -> FakeClient:` 用来顶替 `httpx.AsyncClient` 这个类。`main` 里是 `httpx.AsyncClient(timeout=...)`,类和函数都是「加括号调用、返回一个对象」,所以一个函数就能冒充一个类。`**kwargs` 是 Day 30 学的,收下所有关键字参数,变成一个字典。
- `created.append(kwargs)` 实跑时这里收到的是 `{"timeout": 2.5}`。
- `return fake` 不管怎么调用,都交出同一个假客户端。`main` 里的 `async with ... as client` 会调它的 `__aenter__`,拿到的 `client` 就是 `fake`。
- `monkeypatch.setenv("WEATHER_TIMEOUT", "2.5")` 临时设环境变量,下一步讲。`main` 调 `timeout_seconds()` 时会读到 2.5。
- `monkeypatch.setattr(weather_cli.httpx, "AsyncClient", fake_async_client)` `weather_cli.httpx` 就是 httpx 模块本身(`weather_cli` 里 `import httpx` 了)。也可以写成字符串形式 `monkeypatch.setattr("httpx.AsyncClient", fake_async_client)`,效果一样。注意这改的是 httpx 模块,测试期间所有地方的 `httpx.AsyncClient` 都变成了假的,测完还原。
- `asyncio.run(weather_cli.main(["北京"]))` 跑 `main`,它以为自己 new 了一个真客户端。
- `assert capsys.readouterr().out == "北京: 14.5°C\n"` `print` 会在末尾加换行,所以期望值有 `\n`。
- `assert created == [{"timeout": 2.5}]` 客户端只创建了一次,超时参数确实来自环境变量。
- `assert len(fake.calls) == 2` 请求还是那两次。

</div>

```bash
uv run pytest tests/test_weather_main.py -v
```

实跑输出:

```text
tests/test_weather_main.py::test_main_prints_weather PASSED              [100%]

============================== 1 passed in 0.23s ===============================
```

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="monkeypatch 的生命周期:记下原值并替换,测试运行,测试结束还原">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="30" width="180" height="70" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
<text x="32" y="52" fill="var(--ink)">setattr / setenv</text>
<text x="32" y="72" fill="var(--ink-soft)">记下原值</text>
<text x="32" y="90" fill="var(--ink-soft)">换成假的</text>
<line x1="200" y1="65" x2="230" y2="65" stroke="var(--rule)" stroke-width="2"/>
<rect x="230" y="30" width="180" height="70" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="242" y="52" fill="var(--ink)">测试函数运行</text>
<text x="242" y="72" fill="var(--ink-soft)">被测代码按名字</text>
<text x="242" y="90" fill="var(--ink-soft)">找到的是假的</text>
<line x1="410" y1="65" x2="440" y2="65" stroke="var(--rule)" stroke-width="2"/>
<rect x="440" y="30" width="180" height="70" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
<text x="452" y="52" fill="var(--ink)">测试结束(含失败)</text>
<text x="452" y="72" fill="var(--ink-soft)">把原值写回去</text>
<text x="452" y="90" fill="var(--ink-soft)">下个测试看到真的</text>
<text x="20" y="140" fill="var(--ink)">手动赋值 weather_cli.geocode = fake</text>
<text x="20" y="160" fill="var(--ink-soft)">没有第三格:后面所有测试都用假的,结果取决于执行顺序</text>
<text x="20" y="195" fill="var(--ink)">对照 Jest:jest.spyOn(...).mockImplementation(...)</text>
<text x="20" y="215" fill="var(--ink-soft)">         + afterEach(() =&gt; jest.restoreAllMocks())</text>
</g>
</svg>
<figcaption>monkeypatch 就是一个带清理步骤的 fixture:替换前记下原值,测试结束时写回去。手动赋值少了还原这一步,这是它和 monkeypatch 唯一的区别,也是最要命的区别。</figcaption>
</figure>

## 第 6 步:setenv 和 delenv,临时改环境变量

Day 53 学过,密钥、开关这些配置放环境变量里。测试读环境变量的代码时,你不想去改真实的 shell 环境,也不想一个测试设了变量、影响后面的测试。`monkeypatch.setenv(名字, 值)` 临时设一个,`monkeypatch.delenv(名字)` 临时删一个,测完都会恢复。

新建 `tests/test_weather_env.py`:

```python
# agent-zero-lab/tests/test_weather_env.py
import pytest

from part01.weather_cli import timeout_seconds


def test_timeout_default(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("WEATHER_TIMEOUT", raising=False)
    assert timeout_seconds() == 10.0


def test_timeout_from_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("WEATHER_TIMEOUT", "2.5")
    assert timeout_seconds() == 2.5


def test_timeout_bad_value(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("WEATHER_TIMEOUT", "abc")
    with pytest.raises(ValueError):
        timeout_seconds()
```

<div class="line-notes">

- `def test_timeout_default(monkeypatch: pytest.MonkeyPatch):` 测「没设变量时用默认值 10」。
- `monkeypatch.delenv("WEATHER_TIMEOUT", raising=False)` 先确保这个变量不存在。`raising=False` 是说「本来就没有也别报错」,不写的话变量不存在时 `delenv` 会抛 `KeyError`。这一行看着多余,下面马上演示它为什么必须写。
- `assert timeout_seconds() == 10.0` `os.environ.get` 拿不到,用默认的 `"10"`,转成 `10.0`。
- `monkeypatch.setenv("WEATHER_TIMEOUT", "2.5")` 值必须是字符串,环境变量本来就只能存字符串。传数字 `2.5` 进去,我实测 pytest 会自动转成字符串,同时给一条警告 `PytestWarning: Value of environment variable WEATHER_TIMEOUT type should be str, but got 2.5 (type: float); converted to str implicitly`。
- `assert timeout_seconds() == 2.5` `float("2.5")` 得 2.5。
- `monkeypatch.setenv("WEATHER_TIMEOUT", "abc")` 一个转不成数字的值。
- `with pytest.raises(ValueError):` `float("abc")` 会抛 `ValueError: could not convert string to float: 'abc'`,Day 71 学的 `pytest.raises` 接住它。这个测试把「配错了会直接报错」这个行为钉住。

</div>

```bash
uv run pytest tests/test_weather_env.py -v
```

实跑输出(中间部分):

```text
tests/test_weather_env.py::test_timeout_default PASSED                   [ 33%]
tests/test_weather_env.py::test_timeout_from_env PASSED                  [ 66%]
tests/test_weather_env.py::test_timeout_bad_value PASSED                 [100%]
```

### 为什么默认值那个测试要先 delenv

我把 `delenv` 那一行去掉,单独写成一个测试:

```python
# agent-zero-lab/tests/test_nodel_demo.py(演示完删掉)
from part01.weather_cli import timeout_seconds


def test_timeout_default_no_delenv():
    assert timeout_seconds() == 10.0
```

<div class="line-notes">

- `def test_timeout_default_no_delenv():` 没要 monkeypatch,直接读当前环境。
- `assert timeout_seconds() == 10.0` 默认以为环境里没有 `WEATHER_TIMEOUT`。

</div>

在 shell 里带着 `WEATHER_TIMEOUT=3` 跑:

```bash
WEATHER_TIMEOUT=3 uv run pytest tests/test_nodel_demo.py -q
```

实跑输出:

```text
E       assert 3.0 == 10.0
E        +  where 3.0 = timeout_seconds()
FAILED tests/test_nodel_demo.py::test_timeout_default_no_delenv - assert 3.0 ...
1 failed in 0.10s
```

不带 `WEATHER_TIMEOUT=3` 跑,实跑是 `1 passed`。也就是说,这个测试过不过,取决于运行它的人 shell 里有没有设这个变量。你本机绿、同事本机红、CI 上又绿,查半天。演示完删掉 `tests/test_nodel_demo.py`。加上 `delenv` 之后,带着 `WEATHER_TIMEOUT=3` 跑 `tests/test_weather_env.py`,实跑是 `3 passed`。规矩是:**测「没设时的默认值」,就主动把它删掉,别假设环境是干净的。**

monkeypatch 还原时,是恢复成「测试开始前的样子」:原来没有就删掉,原来是 `3` 就改回 `3`。它不会把变量统统删光。

### 坑:模块在导入时就读了环境变量

还有一种写法很常见,而且 monkeypatch 拿它没办法。很多代码会在模块顶层读配置:

```python
# agent-zero-lab/part01/settings_demo.py(演示完删掉)
import os

TIMEOUT = float(os.environ.get("WEATHER_TIMEOUT", "10"))


def timeout_seconds() -> float:
    return TIMEOUT
```

<div class="line-notes">

- `TIMEOUT = float(os.environ.get("WEATHER_TIMEOUT", "10"))` 这一行写在函数外面,模块第一次被 `import` 时执行一次,之后就不再读环境变量了。测试文件顶部 `from part01.settings_demo import ...` 的那一刻,`TIMEOUT` 已经定成 10.0。
- `return TIMEOUT` 函数只是返回那个早就算好的值。

</div>

配一个测试 `tests/test_import_time.py`:

```python
# agent-zero-lab/tests/test_import_time.py(演示完删掉)
import pytest

from part01.settings_demo import timeout_seconds


def test_timeout_from_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("WEATHER_TIMEOUT", "2.5")
    assert timeout_seconds() == 2.5
```

<div class="line-notes">

- `monkeypatch.setenv("WEATHER_TIMEOUT", "2.5")` 环境变量确实改成了 2.5,可是已经没人再去读它了。

</div>

实跑 `uv run pytest tests/test_import_time.py -q`:

```text
>       assert timeout_seconds() == 2.5
E       assert 10.0 == 2.5
E        +  where 10.0 = timeout_seconds()

tests/test_import_time.py:9: AssertionError
=========================== short test summary info ============================
FAILED tests/test_import_time.py::test_timeout_from_env - assert 10.0 == 2.5
1 failed in 0.06s
```

两种修法。第一种是改被测代码,像 `weather_cli.py` 那样每次调用时再读,这也是今天开头改动 2 这么写的原因。第二种是不改代码,直接 patch 那个已经算好的模块变量:把测试里的 `setenv` 换成 `monkeypatch.setattr(settings_demo, "TIMEOUT", 2.5)`(还要 `from part01 import settings_demo`),我实跑是 `1 passed`。我更推荐第一种:顶层读配置的代码不光难测,改了 `.env` 还得重启进程才生效。

演示完把 `part01/settings_demo.py` 和 `tests/test_import_time.py` 都删掉。

## 零件和成品的对照

今天最后留在仓库里的文件:

| 成品里的这一段 | 来自 | 做什么 |
| --- | --- | --- |
| `weather_cli.py` 的 `HttpClient` | 开头改动 1 + 第 2 步 | 让真假客户端都通过类型检查 |
| `weather_cli.py` 的 `timeout_seconds` | 开头改动 2 + 第 6 步 | 超时可配,每次调用时读环境变量 |
| `tests/fakes.py` 的 `FakeClient` | 第 2 步 + 第 4 步 | 按剧本返回响应或抛异常,带记录本 |
| `FakeClient.__aenter__/__aexit__` | 第 4 步 | 能被 `async with` 使用,为测 `main` 准备 |
| `test_weather_fake.py` | 第 2、4 步 | 成功路径、请求参数、四条失败路径 |
| `test_patch_intro.py` | 第 5 步 | `setattr` 换函数,验证自动还原 |
| `test_weather_main.py` | 第 5、6 步 | `setattr` 换类 + `setenv` + `capsys` |
| `test_weather_env.py` | 第 6 步 | `setenv` / `delenv` |

全做完(包括下面的练习)`uv run pytest -q`,我这里实跑是 `46 passed in 0.24s`。46 个测试,其中一半和网络有关,不到四分之一秒,断网也能跑。

最后说一下什么时候用假对象、什么时候用 monkeypatch。能把依赖从参数传进来,就优先传假对象:代码结构清楚,测试也不用知道被测代码内部 import 了什么。只有改不了的地方(像 `main` 里自己 new 客户端、模块里调了 `time.time()`、读了环境变量)才用 monkeypatch。monkeypatch 用多了,测试会和代码的内部写法绑得很死,换个 import 方式测试就全挂,练习 4 你会亲眼看到一次。

## 动手练习

**练习 1:缺字段的返回。** 天气接口如果返回 `{"current": {}}`(没有 `temperature_2m`),`get_weather` 会怎样?先猜,然后新建 `tests/test_ex74.py`,写一个测试把现在的行为钉住。

<details><summary>参考答案</summary>

现在的代码没处理这种情况,`resp.json()["current"]["temperature_2m"]` 会抛 `KeyError`,而 `get_weather` 的几个 `except` 都接不住它,异常会冒出来。测试就写「确实会抛 KeyError」:

```python
# agent-zero-lab/tests/test_ex74.py
import asyncio

import httpx
import pytest

from part01 import weather_cli
from part01.weather_cli import FORECAST_URL, GEO_URL, HttpClient, get_weather
from tests.fakes import FakeClient, ok

BEIJING_GEO = {"results": [{"latitude": 39.9075, "longitude": 116.39723}]}


def test_missing_temperature():
    fake = FakeClient({GEO_URL: ok(GEO_URL, BEIJING_GEO), FORECAST_URL: ok(FORECAST_URL, {"current": {}})})
    with pytest.raises(KeyError):
        asyncio.run(get_weather(fake, "北京"))
```

<div class="line-notes">

- `import httpx` 练习 2 要用,先导入。
- `from part01 import weather_cli` 练习 3 要用。
- `from part01.weather_cli import FORECAST_URL, GEO_URL, HttpClient, get_weather` `HttpClient` 也是练习 3 给假函数写类型标注用的。
- `def test_missing_temperature():` 剧本:地理编码正常,天气接口返回空的 `current`。
- `with pytest.raises(KeyError):` 断言会抛 `KeyError`。
- `asyncio.run(get_weather(fake, "北京"))` `asyncio.run` 会把协程里没接住的异常原样抛到外面,所以 `pytest.raises` 能接到。

</div>

实跑 `uv run pytest tests/test_ex74.py -q` 是 `1 passed`。这类「把现状钉住」的测试叫特征测试:不评价行为对不对,先记下它现在是这样。哪天你决定改成返回 `"北京: 数据格式不对"`,这个测试会先红,提醒你同时更新测试。

</details>

**练习 2:先写红的测试,再修 bug。** 第 1 步断网时发现 `get_weather` 接不住 `httpx.ConnectError`。在 `test_ex74.py` 里先写一个测试:剧本让地理编码接口抛 `httpx.ConnectError("All connection attempts failed")`,期望返回 `"北京: 连不上服务器"`。跑一次看它红,再改 `weather_cli.py` 让它变绿,最后用第 1 步的假代理真跑一次确认。

<details><summary>参考答案</summary>

测试追加在 `test_ex74.py` 末尾:

```python
# agent-zero-lab/tests/test_ex74.py(追加)
def test_connect_error():
    fake = FakeClient({GEO_URL: httpx.ConnectError("All connection attempts failed")})
    assert asyncio.run(get_weather(fake, "北京")) == "北京: 连不上服务器"
```

<div class="line-notes">

- `fake = FakeClient({GEO_URL: httpx.ConnectError("All connection attempts failed")})` 错误信息照抄第 1 步实测断网时 httpx 给的原文。
- `assert asyncio.run(get_weather(fake, "北京")) == "北京: 连不上服务器"` 期望值是我们想要的行为,现在的代码还做不到。

</div>

先跑,实跑输出的关键几行:

```text
E           httpx.ConnectError: All connection attempts failed
FAILED tests/test_ex74.py::test_connect_error - httpx.ConnectError: All conne...
1 failed, 1 passed in 0.32s
```

然后在 `part01/weather_cli.py` 的 `get_weather` 里,`except httpx.TimeoutException:` 那两行下面加两行:

```python
# agent-zero-lab/part01/weather_cli.py(get_weather 里新增的两行)
    except httpx.ConnectError:
        return f"{city}: 连不上服务器"
```

<div class="line-notes">

- `except httpx.ConnectError:` 连接阶段就失败了:DNS 解析不了、端口没人听、代理挂了都是它。放在 `TimeoutException` 后面,两者互不包含,顺序其实无所谓,但我习惯把更常见的超时写在前面。
- `return f"{city}: 连不上服务器"` 和其他失败一样,变成一句人话,不让程序崩。

</div>

再跑 `uv run pytest tests/test_ex74.py -q`,实跑 `2 passed`。最后真跑一次:

```bash
HTTPS_PROXY=http://127.0.0.1:9 https_proxy=http://127.0.0.1:9 uv run python -m part01.weather_cli 北京 上海
```

实跑输出:

```text
北京: 连不上服务器
上海: 连不上服务器
```

「先写一个红的测试,再改代码让它绿」这个顺序以后会反复用,它保证你的测试真的能抓住这个 bug,不是写完代码后补一个永远绿的测试。

</details>

**练习 3:monkeypatch 和假对象一起用。** 不给天气接口写剧本,而是用 `monkeypatch.setattr` 把 `weather_cli.current_temp` 换成一个永远返回 `-3.5` 的假函数,测 `get_weather` 能正确输出零下的温度 `"北京: -3.5°C"`,并断言 `FakeClient` 只被请求了一次。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/tests/test_ex74.py(追加)
async def fake_temp(client: HttpClient, lat: float, lon: float) -> float:
    return -3.5


def test_negative_temp(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(weather_cli, "current_temp", fake_temp)
    fake = FakeClient({GEO_URL: ok(GEO_URL, BEIJING_GEO)})
    assert asyncio.run(get_weather(fake, "北京")) == "北京: -3.5°C"
    assert len(fake.calls) == 1
```

<div class="line-notes">

- `async def fake_temp(client: HttpClient, lat: float, lon: float) -> float:` 签名和真的 `current_temp` 一样,必须也是 `async def`,因为 `get_weather` 里是 `await current_temp(...)`。
- `return -3.5` 不管经纬度,永远零下 3.5 度。
- `monkeypatch.setattr(weather_cli, "current_temp", fake_temp)` 换掉模块里的 `current_temp`。
- `fake = FakeClient({GEO_URL: ok(GEO_URL, BEIJING_GEO)})` 剧本里只有地理编码,天气接口没写,因为它不会被请求。
- `assert asyncio.run(get_weather(fake, "北京")) == "北京: -3.5°C"` f-string 把 `-3.5` 原样拼进去。
- `assert len(fake.calls) == 1` 只有地理编码那一次请求。

</div>

实跑 `uv run pytest tests/test_ex74.py -q`,三个练习合起来是 `3 passed in 0.16s`。

</details>

**练习 4(观察题):patch 错了地方。** 新建 `part01/weather_report.py`,里面 `from part01.weather_cli import get_weather`,写一个 `async def report(client, cities) -> str`,并发查几个城市,把结果用换行拼起来。测试里用 `monkeypatch.setattr(weather_cli, "get_weather", 假函数)` 换掉 `get_weather`,假函数永远返回 `"城市: 20.0°C"`,传一个空剧本的 `FakeClient({})`。跑一下,看发生了什么、为什么;然后改成能过的写法。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/weather_report.py
import asyncio

from part01.weather_cli import HttpClient, get_weather


async def report(client: HttpClient, cities: list[str]) -> str:
    lines = await asyncio.gather(*(get_weather(client, c) for c in cities))
    return "\n".join(lines)
```

<div class="line-notes">

- `from part01.weather_cli import HttpClient, get_weather` 关键在这里。`from ... import` 会在 `weather_report` 模块里新建一个名字 `get_weather`,指向导入那一刻的函数对象。从此 `weather_report.get_weather` 和 `weather_cli.get_weather` 是两个名字,只是一开始指向同一个函数。
- `lines = await asyncio.gather(*(get_weather(client, c) for c in cities))` 执行时找的是 `weather_report` 自己的 `get_weather`。
- `return "\n".join(lines)` 两个城市就是 `"北京: 20.0°C\n上海: 20.0°C"`。

</div>

错误的测试:

```python
# agent-zero-lab/tests/test_ex74_report.py(错误版)
import asyncio

import pytest

from part01 import weather_cli, weather_report
from part01.weather_cli import HttpClient
from tests.fakes import FakeClient


async def fake_get_weather(client: HttpClient, city: str) -> str:
    return f"{city}: 20.0°C"


def test_report_wrong_place(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(weather_cli, "get_weather", fake_get_weather)
    out = asyncio.run(weather_report.report(FakeClient({}), ["北京", "上海"]))
    assert out == "北京: 20.0°C\n上海: 20.0°C"
```

<div class="line-notes">

- `monkeypatch.setattr(weather_cli, "get_weather", fake_get_weather)` 改的是 `weather_cli` 里的名字,`weather_report` 里那个名字没动。
- `out = asyncio.run(weather_report.report(FakeClient({}), ["北京", "上海"]))` `report` 用的还是真的 `get_weather`,真的会去调 `client.get`。

</div>

实跑输出(关键部分):

```text
url = 'https://geocoding-api.open-meteo.com/v1/search'
params = {'name': '北京', 'count': 1, 'language': 'zh'}
    async def get(self, url: str, *, params: dict[str, Any] | None = None) -> httpx.Response:
        self.calls.append((url, params or {}))
>       result = self.routes[url]
                 ^^^^^^^^^^^^^^^^
E       KeyError: 'https://geocoding-api.open-meteo.com/v1/search'

tests/fakes.py:16: KeyError
=========================== short test summary info ============================
FAILED tests/test_ex74_report.py::test_report_wrong_place - KeyError: 'https:...
```

报错发生在 `FakeClient.get` 里:真的 `get_weather` 去请求地理编码,空剧本里没有这个 URL。这里能看出空剧本的价值,它像一张安全网,patch 没生效时测试会明确地挂,而不是悄悄去请求真网络。

修法是 **patch 被测代码查找名字的地方**,也就是 `weather_report`:

```python
# agent-zero-lab/tests/test_ex74_report.py(正确版,替换掉错误版的测试函数和 import)
from part01 import weather_report


def test_report_right_place(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(weather_report, "get_weather", fake_get_weather)
    out = asyncio.run(weather_report.report(FakeClient({}), ["北京", "上海"]))
    assert out == "北京: 20.0°C\n上海: 20.0°C"
```

<div class="line-notes">

- `from part01 import weather_report` 不再需要 `weather_cli` 了。
- `monkeypatch.setattr(weather_report, "get_weather", fake_get_weather)` 换 `weather_report` 模块里的那个名字。
- `assert out == "北京: 20.0°C\n上海: 20.0°C"` gather 保持顺序,北京在前。

</div>

实跑是 `1 passed`。口诀:**patch 用的地方,不是定义的地方。** 这条规则对 `unittest.mock.patch` 同样成立,面试问 mock 时很常被追问。

</details>

**验收标准:** `tests/fakes.py` 里有能演成功和失败的 `FakeClient`;`get_weather` 的成功、找不到城市、500、超时、连不上五条路径都有测试;`main` 有一个不联网的测试;`uv run pytest -q` 全绿(我这里是 `46 passed`),并且你在断网(或者用假代理)的情况下再跑一次,结果完全一样;你能说出 monkeypatch 和手动赋值的区别。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 假对象(fake) | 和真对象有同样方法签名、但行为由测试写死的对象,比如按剧本返回响应的 `FakeClient` |
| 测试替身 | 测试里顶替真依赖的东西的总称,fake、stub、mock 都属于它;今天写的是 fake |
| 剧本(routes) | 我们给 `FakeClient` 准备的「URL → 响应或异常」字典,不是正式术语,是这门课的叫法 |
| 鸭子类型 | 运行时不看对象是什么类,只看它有没有需要的方法,Python 和 JS 都是这样 |
| 依赖从参数传入 | 函数需要的客户端、配置由调用者传进来,而不是函数里自己创建,这样测试才能换成假的 |
| 行为验证 | 不只看返回值,还检查代码发出了哪些调用、带了什么参数,今天用 `fake.calls` 做的 |
| monkeypatch | pytest 内置 fixture,运行中临时替换属性、环境变量等,测试结束自动还原 |
| `monkeypatch.setattr` | 临时把某个对象(常是模块)的某个属性换成别的值 |
| `monkeypatch.setenv` / `delenv` | 临时设置 / 删除一个环境变量,`delenv(..., raising=False)` 不存在也不报错 |
| capsys | pytest 内置 fixture,截下测试期间打印到 stdout/stderr 的文字,用 `readouterr()` 取 |
| `httpx.Response(...)` | httpx 的响应类,可以直接构造,测试里用来造真实的假响应 |
| `isinstance` | 判断对象是不是某个类或其子类的实例,≈ JS 的 `instanceof` |
| `__aenter__` / `__aexit__` | 让对象能用在 `async with` 里的两个方法,Day 98 细讲 |
| pytest-asyncio | 让 pytest 能直接运行 `async def` 测试的插件,今天没装 |
| 特征测试 | 先把代码现在的行为钉住的测试,不评判对错,改行为时提醒你 |

## 常见误区

**在单元测试里请求真网络。** 结果随时间变、慢、断网就红,第 1 步三个问题都实测过。真联网的测试有它的用处(确认接口没改版),但应该单独放、少量跑,不能混在每次都跑的单元测试里。

**把 `async def test_...` 当成能直接跑。** 没装插件时,pytest 9 报 `async def functions are not natively supported`;pytest 8.4 以前更坑,只是跳过加警告,看起来像过了。今天的办法是测试写普通函数,里面 `asyncio.run(...)`。

**假对象的方法签名和真的不一致。** 少一个 `params` 参数,运行时报 `TypeError: ... got an unexpected keyword argument 'params'`;方法忘了写 `async`,`await` 时会报 `TypeError: object Response can't be used in 'await' expression`。被测函数参数用 Protocol 标注,编辑器会提前画红线。

**手动给模块属性赋值,不还原。** `weather_cli.geocode = fake` 会一直留到 pytest 结束,第 5 步实测连累了后面 5 个测试,而且结果取决于执行顺序。一律用 `monkeypatch.setattr`。

**patch 了定义的地方,而不是使用的地方。** 被测模块写的是 `from a import f`,你 patch `a.f` 没用,要 patch `被测模块.f`。练习 4 实测过,表现是 patch 好像「没生效」。

**测默认值时假设环境是干净的。** shell 里或 CI 上恰好设了同名环境变量,测试就红。测默认值前先 `monkeypatch.delenv(..., raising=False)`。

**以为 setenv 能改掉已经读过的配置。** 模块顶层 `X = os.environ.get(...)` 只在导入时执行一次,之后 `setenv` 不起作用,实测得到 `assert 10.0 == 2.5`。要么改成用时再读,要么直接 `setattr` 那个模块变量。

**用 monkeypatch 去替换 `open`、`print` 这类内置函数。** pytest 文档专门提醒过,patch 内置函数可能把 pytest 自己弄坏。要测打印就用 `capsys`,要测文件就用 Day 73 的 `tmp_path`。

## 学习资料

### 文档与文章

- [pytest 文档 · How to monkeypatch/mock modules and environments](https://docs.pytest.org/en/stable/how-to/monkeypatch.html):今天第 5、6 步的官方说明,里面有一个「替换 requests.get」的例子和今天的思路完全一样,还列了 `setattr`、`setenv`、`delenv`、`setitem` 等全部方法。
- [pytest 文档 · How to capture stdout/stderr output](https://docs.pytest.org/en/stable/how-to/capture-stdout-stderr.html):`capsys` 的用法,以及 pytest 为什么默认把 print 吞掉(所以前几天要加 `-s`)。
- [pytest 更新日志](https://docs.pytest.org/en/stable/changelog.html):在页面里搜 "Async tests will now fail",就是 8.4.0 那条改动。
- [HTTPX 文档 · Exceptions](https://www.python-httpx.org/exceptions/):httpx 全部异常的继承关系图,看清 `TimeoutException`、`ConnectTimeout`、`ReadTimeout`、`ConnectError` 谁是谁的父类。
- [HTTPX 文档 · Transports](https://www.python-httpx.org/advanced/transports/):里面有一节 Mock transports,httpx 自带的 `MockTransport` 能用一个函数顶替整个网络层,和今天手写的 `FakeClient` 是同一个想法、更正式的做法,知道有这个东西就行。
- [Jest 文档 · Mock Functions](https://jestjs.io/docs/mock-functions) 和 [Jest Object](https://jestjs.io/docs/jest-object):对照看 `jest.fn`、`jest.mock`、`jest.spyOn`,把前端的经验和 pytest 对上号。
- [Python 文档 · unittest.mock](https://docs.python.org/zh-cn/3.12/library/unittest.mock.html):标准库里更强大的 mock 工具,中文。今天先不学,但其中「Where to patch」一节讲的就是练习 4 那条规则,可以先读这一节。
- Martin Fowler,[Mocks Aren't Stubs](https://martinfowler.com/articles/mocksArentStubs.html):英文长文,讲 fake、stub、mock 这些测试替身的区别。现在读前半篇就够。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1gu4y1B7sD&autoplay=0&high_quality=1" title="python进阶之pytest使用(part2: monkeypatch初探)" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>大刘gary · python进阶之pytest使用(part2: monkeypatch初探) · 16 分钟。专讲 monkeypatch,对应今天第 5、6 步,可以和文章对着看他换了哪些东西。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1784y147P7&autoplay=0&high_quality=1" title="Python单元测试-04.Mock" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>跟峰哥学编程 · Python单元测试-04.Mock · 31 分钟。Day 73 推荐过的同一个系列,这一集讲标准库的 unittest.mock。今天只学了手写假对象和 monkeypatch,这集当作「另一套工具长什么样」来看,不用全记住。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/wbHaXVqX8sk" title="Monkey Patching in Python" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LeetCoder · Monkey Patching in Python · 英文,讲「运行时替换属性」这件事本身在 Python 里是怎么成立的,帮你理解为什么模块里的函数能被换掉。</figcaption>
</figure>

### 书籍

- Brian Okken,《Python Testing with pytest》第 2 版,Pragmatic Bookshelf,2022。第 4 章讲内置 fixture(含 `capsys`、`monkeypatch`),第 10 章讲 mock,和今天、以后的内容一一对应。
- Roy Osherove、Vladimir Khorikov,《The Art of Unit Testing》第 3 版,Manning,2024。例子全是 JavaScript/TypeScript,讲 stub、mock 和「依赖从外面传进来」,对前端出身的读者特别友好;不确定有没有第 3 版中译本,这里只写英文原版。

### 开源项目与代码

- [lundberg/respx](https://github.com/lundberg/respx):专门给 httpx 做假响应的库(2026 年 10 月是 0.23.1),README 里的例子能看出「按 URL 配剧本」这个思路在正式库里是怎么做的。
- [pytest-dev/pytest-mock](https://github.com/pytest-dev/pytest-mock):把 `unittest.mock` 包装成 pytest fixture 的插件(2026 年 10 月是 3.17.0),很多公司项目在用。现在看 README 认识一下就行。

## 自测

1. 第 1 步那个联网测试,列出它的三个问题。

<details><summary>答案</summary>

结果随时间变(气温会变,测试无故变红);慢(一个测试接近 5 秒);依赖网络(断网、代理挂掉就红,而且还暴露不了它本该测的东西)。

</details>

2. `FakeClient` 为什么能顶替 `httpx.AsyncClient` 传给 `get_weather`?如果参数类型标注写的是 `httpx.AsyncClient`,运行和编辑器分别会怎样?

<details><summary>答案</summary>

`get_weather` 只调用了 `client.get(url, params=...)`,`FakeClient` 有同样签名的 `async def get`,Python 运行时不检查类型,所以能跑。标注写 `httpx.AsyncClient` 时运行照样能过,但编辑器会对传入的 `FakeClient` 报类型不匹配;改成 Protocol `HttpClient` 后真假都合规。

</details>

3. 下面的测试为什么可能害到别的测试?怎么改?

```python
def test_x():
    weather_cli.geocode = fake_geocode
    ...
```

<details><summary>答案</summary>

手动赋值不会还原,之后所有测试用的都是 `fake_geocode`,而且结果取决于执行顺序。改成在参数里要 `monkeypatch`,写 `monkeypatch.setattr(weather_cli, "geocode", fake_geocode)`,测试结束自动恢复。

</details>

4. 测「没设 `WEATHER_TIMEOUT` 时默认 10 秒」的测试,为什么要先 `monkeypatch.delenv("WEATHER_TIMEOUT", raising=False)`?`raising=False` 又是干什么的?

<details><summary>答案</summary>

运行测试的环境里可能本来就设了这个变量(我实测带着 `WEATHER_TIMEOUT=3` 跑,不删就得到 `assert 3.0 == 10.0`),先删掉才是真正在测默认值。`raising=False` 表示变量本来就不存在时不要报错,不写的话会抛 `KeyError`。

</details>

5. 面试题:`report.py` 里写的是 `from weather import get_weather`。你在测试里 patch 了 `weather.get_weather`,但 `report` 还是调到了真函数。为什么?怎么修?

<details><summary>答案</summary>

`from weather import get_weather` 在 `report` 模块里创建了自己的名字 `get_weather`,导入时就指向了原函数;patch `weather.get_weather` 只改了 `weather` 模块里的名字。要 patch 使用的地方:`monkeypatch.setattr(report, "get_weather", fake)`(用 `unittest.mock.patch` 时就是 `patch("report.get_weather")`)。更好的做法是把依赖从参数传进去,测试就不用关心它怎么 import 的。

</details>

6. 面试题:你负责的 Agent 每一步都要调模型 API。怎么给它的「工具调用出错后重试」逻辑写单元测试,既不花钱又能稳定复现?

<details><summary>答案</summary>

把模型客户端从参数(或构造函数)传进去,测试时传一个假客户端:按剧本依次返回响应,剧本里可以放异常,比如前两次抛限流错误、第三次返回正常结果;假客户端同时记下每次调用的参数。断言最终结果正确、总共调了三次、每次的参数符合预期。这样零成本、零网络、结果完全确定。只有「回答质量好不好」这类问题才需要真模型。

</details>

## 明天预告

Day 75 · 日志:logging 和 getLogger(__name__)。今天的天气工具出错时只会返回一句「请求超时」,你不知道是哪个城市、哪个接口、等了几秒;为了看清楚发生了什么,很多人会到处加 `print`,最后满屏输出分不清哪句是结果、哪句是调试信息。明天学 Python 自带的 logging:日志级别、输出格式、每个模块一个 logger,给天气工具加上日志,并且让日志和正常输出走两条不同的路。
