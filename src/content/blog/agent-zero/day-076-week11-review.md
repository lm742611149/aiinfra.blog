---
title: 'Day 76 · 第 11 周复习:编程地基(Day 70–75)'
description: '这一周一直围着天气工具转:Day 70 让它能用,Day 71–74 让它可测,Day 75 让它出了问题能查。今天画一张知识地图,每天一句话回顾,默写三段核心代码,再用本周学的全部东西做一个空气质量查询小工具,连测试带日志一起交付。'
pubDate: 2026-10-22
regime: none
tags: ['review', 'python', 'pytest', 'logging', 'agent-zero']
series: 'agent-zero'
day: 76
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 75](/blog/agent-zero/day-075-logging/) 学了 logging:五个级别,`basicConfig` 定格式,每个模块 `getLogger(__name__)`,入口脚本 `weather_run.py` 统一配置,root 保持 WARNING、只把自己的包 `part01` 调到 `LOG_LEVEL`;结果走 stdout,日志走 stderr。

这是第 11 周的最后一天。回头看这一周,六天全是围着同一个文件 `part01/weather_cli.py` 转的:先让它能用,再让它能被自动检查,最后让它出了问题能查清楚。今天把这条线理一遍,然后自己从零做一个同样结构的小工具。

## 今天要解决的问题

1. 能对着一张图说出本周六天各解决了什么问题,以及它们之间是怎么接起来的。
2. 合上文章默写出三段核心代码并跑通:pytest 配置和两个基础断言(Day 71–72)、`FakeClient`(Day 74)、日志入口脚本(Day 75)。
3. 完成本周小项目 `part01/air_cli.py`:查城市的 PM2.5 并分级,配一套不联网的测试(parametrize、假对象、caplog)和一个带日志配置的入口。

预计用时 3–3.5 小时。花费 ¥0,今天不调模型,只请求免费的 Open-Meteo。

前置:本周的 [Day 70](/blog/agent-zero/day-070-weather-project/) 到 [Day 75](/blog/agent-zero/day-075-logging/)。小项目要用到 Day 74 建的 `tests/fakes.py` 和 Day 75 改过的 `part01/weather_cli.py`(要从里面导入 `geocode`),请先确认这两个文件和文章里一致,`uv run pytest -q` 是全绿的。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。复习日的默写特别重要,练习 1 到练习 3 请真的合上文章写,写完再展开答案对。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="第 11 周知识地图:中间是 weather_cli.py,Day 70 让它能用,Day 71 到 74 让它可测,Day 75 让它可查">
<rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="230" y="135" width="180" height="60" rx="8" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="160" fill="var(--ink)" text-anchor="middle">weather_cli.py</text>
<text x="320" y="180" fill="var(--ink-soft)" text-anchor="middle" font-size="11">geocode→温度→一句话</text>
<rect x="20" y="20" width="190" height="62" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="32" y="40" fill="var(--ink)">Day 70 能用</text>
<text x="32" y="58" fill="var(--ink-soft)" font-size="11">httpx + async + gather</text>
<text x="32" y="74" fill="var(--ink-soft)" font-size="11">异常变成一句人话</text>
<rect x="225" y="20" width="190" height="62" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="237" y="40" fill="var(--ink)">Day 71 assert</text>
<text x="237" y="58" fill="var(--ink-soft)" font-size="11">test_ 命名、读报告</text>
<text x="237" y="74" fill="var(--ink-soft)" font-size="11">approx、raises</text>
<rect x="430" y="20" width="190" height="62" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="442" y="40" fill="var(--ink)">Day 72 目录与配置</text>
<text x="442" y="58" fill="var(--ink-soft)" font-size="11">tests/、sys.path</text>
<text x="442" y="74" fill="var(--ink-soft)" font-size="11">pythonpath、-k、-x</text>
<rect x="20" y="248" width="190" height="62" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="32" y="268" fill="var(--ink)">Day 73 去重复</text>
<text x="32" y="286" fill="var(--ink-soft)" font-size="11">fixture、tmp_path</text>
<text x="32" y="302" fill="var(--ink-soft)" font-size="11">conftest、parametrize</text>
<rect x="225" y="248" width="190" height="62" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="237" y="268" fill="var(--ink)">Day 74 不联网</text>
<text x="237" y="286" fill="var(--ink-soft)" font-size="11">FakeClient 剧本</text>
<text x="237" y="302" fill="var(--ink-soft)" font-size="11">monkeypatch 自动还原</text>
<rect x="430" y="248" width="190" height="62" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="442" y="268" fill="var(--ink)">Day 75 可查</text>
<text x="442" y="286" fill="var(--ink-soft)" font-size="11">级别、getLogger(__name__)</text>
<text x="442" y="302" fill="var(--ink-soft)" font-size="11">stdout 结果 / stderr 日志</text>
<line x1="115" y1="82" x2="250" y2="140" stroke="var(--rule)" stroke-width="2"/>
<line x1="320" y1="82" x2="320" y2="135" stroke="var(--rule)" stroke-width="2"/>
<line x1="525" y1="82" x2="390" y2="140" stroke="var(--rule)" stroke-width="2"/>
<line x1="115" y1="248" x2="250" y2="195" stroke="var(--rule)" stroke-width="2"/>
<line x1="320" y1="248" x2="320" y2="195" stroke="var(--rule)" stroke-width="2"/>
<line x1="525" y1="248" x2="390" y2="195" stroke="var(--rule)" stroke-width="2"/>
<text x="20" y="118" fill="var(--ink-soft)" font-size="11">上排:写出来、能检查</text>
<text x="20" y="222" fill="var(--ink-soft)" font-size="11">下排:检查得省事、不靠网、出事能查</text>
</g>
</svg>
<figcaption>本周六天都在加工同一个文件。上排三天让它能用、让测试能跑起来;下排三天让测试不重复、不依赖网络,再给程序本身加上日志。</figcaption>
</figure>

把这张图换成一句话:**写一个会联网的小工具,然后让它可以被自动、离线、稳定地检查,最后让它在真实环境里出了问题能被查清楚。** 后面写 Agent 时你会一遍遍重复这个顺序,只是「天气接口」换成了「模型 API」和「工具」。

下面这张表把前端的老经验和本周学的东西对齐,默写前扫一眼:

| 前端里你熟悉的 | 本周学的 | 哪天 |
| --- | --- | --- |
| `fetch` + `Promise.all` | `httpx.AsyncClient` + `asyncio.gather` | Day 70 |
| `expect(a).toBe(b)` | `assert a == b` | Day 71 |
| `expect(x).toBeCloseTo(y)` | `assert x == pytest.approx(y)` | Day 71 |
| `expect(fn).toThrow(...)` | `with pytest.raises(..., match=...)` | Day 71 |
| `vitest.config.ts` 的 `include` | `[tool.pytest]` 的 `testpaths`、`pythonpath` | Day 72 |
| `vitest -t "名字"` | `pytest -k 名字` | Day 72 |
| `beforeEach` / `afterEach` | fixture,`yield` 前后 | Day 73 |
| `test.each([...])` | `@pytest.mark.parametrize` | Day 73 |
| 结构类型的假对象 | `FakeClient` + Protocol | Day 74 |
| `jest.spyOn` + `restoreAllMocks` | `monkeypatch.setattr`,测完自动还原 | Day 74 |
| `console.log/warn/error` | `log.info/warning/error` | Day 75 |

## 本周每天一句话

- [Day 70](/blog/agent-zero/day-070-weather-project/) · 小项目:命令行天气查询。把 httpx、async 和错误处理拼成 `weather_cli.py`:城市名先换经纬度、再查气温,几个城市用 `gather` 同时查,超时和 HTTP 错误都变成一句人话。
- [Day 71](/blog/agent-zero/day-071-pytest-1/) · pytest(一)。`assert` 失败才会报错;文件和函数以 `test_` 开头 pytest 才看得见;小数用 `pytest.approx`;读懂 `FAILED` 报告里的期望值和实际值。
- [Day 72](/blog/agent-zero/day-072-pytest-2/) · pytest(二)。测试搬进 `tests/` 后撞上 `ModuleNotFoundError`,原因是 pytest 往 `sys.path` 里插的是「往上第一个没有 `__init__.py` 的目录」;在 `pyproject.toml` 写 `pythonpath = ["."]` 修好;`-k`、`-x`、`--lf` 和 node id 挑着跑。
- [Day 73](/blog/agent-zero/day-073-pytest-3/) · pytest(三)。fixture 按参数名注入、`yield` 后面写清理;`tmp_path` 给每个测试一个临时目录;`conftest.py` 放共享 fixture;parametrize 让一个函数配一张数据表。
- [Day 74](/blog/agent-zero/day-074-pytest-4/) · pytest(四)。手写 `FakeClient` 按剧本返回响应或抛异常,五条路径全部离线测;`monkeypatch` 换函数、换类、改环境变量,测完自动还原;patch 用的地方,不是定义的地方。
- [Day 75](/blog/agent-zero/day-075-logging/) · 日志。五个级别,`basicConfig` 只在入口调一次,模块里 `getLogger(__name__)`;root 保持 WARNING,只放开自己的包;结果走 stdout,日志走 stderr。

## 本周小项目:空气质量查询

做一个和天气工具同样结构的新工具:输入城市名,输出当前 PM2.5 和等级,比如 `北京: PM2.5 53.8 μg/m³,良`。要求只用本周学过的东西,并且一起交付:

1. `part01/air_cli.py`:复用 `weather_cli.geocode` 把城市换成经纬度,再请求 Open-Meteo 的空气质量接口;超时、HTTP 错误、找不到城市都返回一句人话,并打对应级别的日志。
2. 一个纯函数 `pm25_level(value)` 把数值换成等级,用 parametrize 把各档边界都测到。
3. `tests/test_air.py`:用 `FakeClient` 离线测成功和失败路径,用 `caplog` 测成功时那条 INFO 日志。
4. `part01/air_run.py`:入口脚本,配置日志,真跑一次。

先看一眼真接口长什么样。空气质量接口和天气接口是同一家,参数风格一样:

```bash
curl -s "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=39.9075&longitude=116.39723&current=pm2_5"
```

<div class="line-notes">

- `curl -s "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=39.9075&longitude=116.39723&current=pm2_5"` Day 59 学的 curl,`-s` 不显示进度条。经纬度是 Day 74 实测的北京,`current=pm2_5` 要当前的 PM2.5。整个 URL 用双引号括起来,不然 zsh 会把 `&` 当成「放到后台运行」。

</div>

实跑输出(一行,我只换了行没删内容):

```text
{"latitude":39.90001,"longitude":116.399994,"generationtime_ms":0.0680685043334961,"utc_offset_seconds":0,
"timezone":"GMT","timezone_abbreviation":"GMT","elevation":47.0,
"current_units":{"time":"iso8601","interval":"seconds","pm2_5":"μg/m³"},
"current":{"time":"2026-10-22T05:00","interval":3600,"pm2_5":53.8}}
```

我们要的是 `current.pm2_5`,`53.8`。单位是 `μg/m³`(微克每立方米)。再试一下传错纬度 `latitude=999`,实跑返回 `{"error":true,"reason":"Latitude must be in range of -90 to 90°. Given: 999.0."}`,状态码 400,和天气接口一模一样。

等级按国家标准里 PM2.5 的分档:0–35 优,35–75 良,75–115 轻度污染,115–150 中度污染,150–250 重度污染,250 以上严重污染。严格说这套分档是按 24 小时平均值算的,我们拿的是这一小时的值,所以结果只当个参考。这个不影响练手。

### 第 1 步:被测代码

```python
# agent-zero-lab/part01/air_cli.py
import asyncio
import logging
import sys

import httpx

from part01.weather_cli import HttpClient, WeatherError, geocode

AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"

log = logging.getLogger(__name__)

LEVELS = [(35, "优"), (75, "良"), (115, "轻度污染"), (150, "中度污染"), (250, "重度污染")]


def pm25_level(value: float) -> str:
    if value < 0:
        raise ValueError(f"PM2.5 不能是负数: {value}")
    for upper, name in LEVELS:
        if value <= upper:
            return name
    return "严重污染"


async def current_pm25(client: HttpClient, lat: float, lon: float) -> float:
    resp = await client.get(AIR_URL, params={"latitude": lat, "longitude": lon, "current": "pm2_5"})
    resp.raise_for_status()
    return resp.json()["current"]["pm2_5"]


async def get_air(client: HttpClient, city: str) -> str:
    try:
        lat, lon = await geocode(client, city)
        pm25 = await current_pm25(client, lat, lon)
    except httpx.TimeoutException:
        log.warning("%s 空气质量请求超时", city)
        return f"{city}: 请求超时"
    except httpx.HTTPStatusError as e:
        log.error("%s 接口返回 %d,url=%s", city, e.response.status_code, e.request.url)
        return f"{city}: 接口返回 {e.response.status_code}"
    except WeatherError as e:
        log.warning("%s", e)
        return str(e)
    level = pm25_level(pm25)
    log.info("%s PM2.5=%.1f -> %s", city, pm25, level)
    return f"{city}: PM2.5 {pm25} μg/m³,{level}"


async def main(cities: list[str]) -> None:
    async with httpx.AsyncClient(timeout=10) as client:
        lines = await asyncio.gather(*(get_air(client, c) for c in cities))
    for line in lines:
        print(line)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:] or ["北京"]))
```

<div class="line-notes">

- `from part01.weather_cli import HttpClient, WeatherError, geocode` 直接复用天气工具的三样东西:Protocol、找不到城市的异常、城市换经纬度的函数。不复制代码。
- `AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"` 和 `GEO_URL` 一样做成常量,测试里拿它当剧本的键。
- `log = logging.getLogger(__name__)` Day 75 的规矩:模块只拿 logger,不配置。被导入时名字是 `part01.air_cli`。
- `LEVELS = [(35, "优"), (75, "良"), (115, "轻度污染"), (150, "中度污染"), (250, "重度污染")]` 每一档写成「(上限, 名字)」的元组,按从小到大排。把数据和逻辑分开,哪天标准改了只改这张表。
- `def pm25_level(value: float) -> str:` 纯函数:不联网、不打日志、同样的输入永远同样的输出。这种函数最好测。
- `if value < 0:` 负数一定是数据出错了,与其返回一个假等级,不如大声报错。
- `raise ValueError(f"PM2.5 不能是负数: {value}")` 和 Day 71 的 `total_cost` 同一个套路,测试里用 `pytest.raises(..., match="不能是负数")` 接。
- `for upper, name in LEVELS:` 元组解包,第一轮 `upper=35`、`name="优"`。
- `if value <= upper:` 用 `<=`,所以正好 35 算「优」,35.1 才算「良」。边界归哪边是最容易写错的地方,测试里专门测了。
- `return "严重污染"` 循环走完都没返回,说明大于 250。
- `async def current_pm25(client: HttpClient, lat: float, lon: float) -> float:` 结构和天气工具的 `current_temp` 完全一样,只是 URL 和字段名不同。
- `resp = await client.get(AIR_URL, params={"latitude": lat, "longitude": lon, "current": "pm2_5"})` 实跑北京时,参数是 `latitude=39.9075`、`longitude=116.39723`。
- `return resp.json()["current"]["pm2_5"]` 实测 `53.8`。
- `async def get_air(client: HttpClient, city: str) -> str:` 和 `get_weather` 同一个形状:两步请求,失败转成人话。
- `lat, lon = await geocode(client, city)` 调的是 `weather_cli` 里的 `geocode`,它会打它自己的 DEBUG 日志,名字是 `part01.weather_cli`。
- `except httpx.TimeoutException:` 超时总类。
- `log.warning("%s 空气质量请求超时", city)` 占位写法。
- `log.error("%s 接口返回 %d,url=%s", city, e.response.status_code, e.request.url)` 接口报错记 ERROR,带上 URL。
- `except WeatherError as e:` `geocode` 找不到城市时抛的异常。
- `level = pm25_level(pm25)` 53.8 落在 35 到 75 之间,得 `"良"`。
- `log.info("%s PM2.5=%.1f -> %s", city, pm25, level)` 实跑是 `北京 PM2.5=53.8 -> 良`。
- `return f"{city}: PM2.5 {pm25} μg/m³,{level}"` 得 `北京: PM2.5 53.8 μg/m³,良`。
- `async with httpx.AsyncClient(timeout=10) as client:` 这里超时写死 10 秒,不像天气工具那样可配,保持小项目简单。
- `lines = await asyncio.gather(*(get_air(client, c) for c in cities))` 几个城市并发查。

</div>

你会发现 `get_air` 和 `get_weather` 有不少重复,而且这一版故意漏了一样东西(练习 4 你会把它找出来)。两个工具都稳定以后,可以把「两步请求 + 异常转人话」抽成一个公共函数。现在先不抽:只有两处重复时就急着抽象,往往抽错。

### 第 2 步:入口脚本

和 Day 75 的 `weather_run.py` 一样,唯一的区别是导入的 `main` 来自 `air_cli`:

```python
# agent-zero-lab/part01/air_run.py
import asyncio
import logging
import os
import sys

from part01.air_cli import main

logging.basicConfig(
    level=logging.WARNING,
    format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
logging.getLogger("part01").setLevel(os.environ.get("LOG_LEVEL", "INFO").upper())

asyncio.run(main(sys.argv[1:] or ["北京"]))
```

<div class="line-notes">

- `from part01.air_cli import main` `air_cli` 被导入,它的 logger 名字才是 `part01.air_cli` 而不是 `__main__`。
- `level=logging.WARNING,` root 保持 WARNING,httpx 和 httpcore 的 INFO、DEBUG 都不出来。
- `logging.getLogger("part01").setLevel(os.environ.get("LOG_LEVEL", "INFO").upper())` 一行管住 `part01.air_cli` 和 `part01.weather_cli` 两个模块,因为它们都在 `part01` 下面。

</div>

```bash
uv run python -m part01.air_run 北京 上海 qwertyzz
```

实跑输出:

```text
13:12:02 WARNING part01.air_cli | 找不到城市: qwertyzz
13:12:02 INFO    part01.air_cli | 上海 PM2.5=20.1 -> 优
13:12:03 INFO    part01.air_cli | 北京 PM2.5=53.8 -> 良
北京: PM2.5 53.8 μg/m³,良
上海: PM2.5 20.1 μg/m³,优
找不到城市: qwertyzz
```

日志的顺序是「谁先查完谁先打」(三个城市是并发的),结果的顺序是传入的顺序(`gather` 保证)。这个区别本身就是 Day 68 和 Day 70 的内容,在日志里看得很清楚。

### 第 3 步:测试

```python
# agent-zero-lab/tests/test_air.py
import asyncio
import logging

import httpx
import pytest

from part01.air_cli import AIR_URL, get_air, pm25_level
from part01.weather_cli import GEO_URL
from tests.fakes import FakeClient, ok

BEIJING_GEO = {"results": [{"latitude": 39.9075, "longitude": 116.39723}]}


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        pytest.param(0, "优", id="zero"),
        pytest.param(35, "优", id="edge-35"),
        pytest.param(35.1, "良", id="just-over-35"),
        pytest.param(53.8, "良", id="beijing-today"),
        pytest.param(150, "中度污染", id="edge-150"),
        pytest.param(251, "严重污染", id="over-250"),
    ],
)
def test_pm25_level(value: float, expected: str):
    assert pm25_level(value) == expected


def test_pm25_negative():
    with pytest.raises(ValueError, match="不能是负数"):
        pm25_level(-1)


def test_get_air_ok(caplog: pytest.LogCaptureFixture):
    fake = FakeClient({GEO_URL: ok(GEO_URL, BEIJING_GEO), AIR_URL: ok(AIR_URL, {"current": {"pm2_5": 53.8}})})
    with caplog.at_level(logging.INFO, logger="part01.air_cli"):
        line = asyncio.run(get_air(fake, "北京"))
    assert line == "北京: PM2.5 53.8 μg/m³,良"
    assert fake.calls[1] == (AIR_URL, {"latitude": 39.9075, "longitude": 116.39723, "current": "pm2_5"})
    assert caplog.record_tuples == [("part01.air_cli", logging.INFO, "北京 PM2.5=53.8 -> 良")]


@pytest.mark.parametrize(
    ("air", "expected"),
    [
        pytest.param(httpx.ReadTimeout("timed out"), "北京: 请求超时", id="timeout"),
        pytest.param(ok(AIR_URL, {"reason": "bad"}, status=400), "北京: 接口返回 400", id="air-400"),
    ],
)
def test_get_air_errors(air: httpx.Response | Exception, expected: str):
    fake = FakeClient({GEO_URL: ok(GEO_URL, BEIJING_GEO), AIR_URL: air})
    assert asyncio.run(get_air(fake, "北京")) == expected


def test_get_air_city_not_found():
    fake = FakeClient({GEO_URL: ok(GEO_URL, {"generationtime_ms": 0.18})})
    assert asyncio.run(get_air(fake, "qwertyzz")) == "找不到城市: qwertyzz"
    assert len(fake.calls) == 1
```

<div class="line-notes">

- `from part01.air_cli import AIR_URL, get_air, pm25_level` 被测的三样。
- `from part01.weather_cli import GEO_URL` 地理编码的 URL 还是天气工具里那个常量,剧本要用它当键。
- `from tests.fakes import FakeClient, ok` Day 74 的假客户端和造响应的小工具,原样复用。
- `@pytest.mark.parametrize(` Day 73 的参数化,一张表测完所有分档。
- `pytest.param(35, "优", id="edge-35"),` 边界值正好 35。`<=` 写成 `<` 的话这条会红。
- `pytest.param(35.1, "良", id="just-over-35"),` 刚过边界。边界两侧各放一条,是测分档逻辑的固定套路。
- `pytest.param(53.8, "良", id="beijing-today"),` 今天实测的北京数据。
- `pytest.param(150, "中度污染", id="edge-150"),` 另一个边界。
- `pytest.param(251, "严重污染", id="over-250"),` 走到循环之后的 `return`。
- `def test_pm25_level(value: float, expected: str):` 参数名和列名对上。
- `with pytest.raises(ValueError, match="不能是负数"):` Day 71 的 `raises`,`match` 检查错误信息。
- `def test_get_air_ok(caplog: pytest.LogCaptureFixture):` Day 75 练习 2 的 `caplog`。
- `fake = FakeClient({GEO_URL: ok(GEO_URL, BEIJING_GEO), AIR_URL: ok(AIR_URL, {"current": {"pm2_5": 53.8}})})` 两个 URL 的剧本,数据照抄真接口。
- `with caplog.at_level(logging.INFO, logger="part01.air_cli"):` 只截 `part01.air_cli` 的 INFO 及以上。`geocode` 打的是 `part01.weather_cli` 的 DEBUG,不会混进来。
- `assert line == "北京: PM2.5 53.8 μg/m³,良"` 返回值。
- `assert fake.calls[1] == (AIR_URL, {"latitude": 39.9075, "longitude": 116.39723, "current": "pm2_5"})` 第二次请求的参数完全正确,行为验证。
- `assert caplog.record_tuples == [("part01.air_cli", logging.INFO, "北京 PM2.5=53.8 -> 良")]` 恰好一条 INFO。
- `pytest.param(httpx.ReadTimeout("timed out"), "北京: 请求超时", id="timeout"),` 剧本里放异常,`FakeClient` 会抛出来。
- `pytest.param(ok(AIR_URL, {"reason": "bad"}, status=400), "北京: 接口返回 400", id="air-400"),` 模仿真接口 400 的返回。
- `def test_get_air_errors(air: httpx.Response | Exception, expected: str):` 地理编码都成功,只变空气接口的剧本。
- `def test_get_air_city_not_found():` 找不到城市。
- `fake = FakeClient({GEO_URL: ok(GEO_URL, {"generationtime_ms": 0.18})})` 剧本里没有 `AIR_URL`。如果代码在找不到城市后还去请求空气接口,`FakeClient` 会抛 `KeyError`。
- `assert len(fake.calls) == 1` 只请求了一次,证明找不到城市后就停了。

</div>

```bash
uv run pytest tests/test_air.py -v
```

实跑输出(中间部分):

```text
tests/test_air.py::test_pm25_level[zero] PASSED                          [  9%]
tests/test_air.py::test_pm25_level[edge-35] PASSED                       [ 18%]
tests/test_air.py::test_pm25_level[just-over-35] PASSED                  [ 27%]
tests/test_air.py::test_pm25_level[beijing-today] PASSED                 [ 36%]
tests/test_air.py::test_pm25_level[edge-150] PASSED                      [ 45%]
tests/test_air.py::test_pm25_level[over-250] PASSED                      [ 54%]
tests/test_air.py::test_pm25_negative PASSED                             [ 63%]
tests/test_air.py::test_get_air_ok PASSED                                [ 72%]
tests/test_air.py::test_get_air_errors[timeout] PASSED                   [ 81%]
tests/test_air.py::test_get_air_errors[air-400] PASSED                   [ 90%]
tests/test_air.py::test_get_air_city_not_found PASSED                    [100%]

============================== 11 passed in 0.21s ==============================
```

11 条,0.21 秒,不联网。用 basedpyright 检查 `part01` 和 `tests`,实跑 `0 errors, 0 warnings, 0 notes`。

### 小项目用到了本周哪一天

| 小项目里的这一段 | 本周哪天 |
| --- | --- |
| `geocode` 复用、`gather` 并发、异常转人话 | Day 70 |
| `assert`、`pytest.raises(match=)` | Day 71 |
| `from part01...` / `from tests.fakes ...` 能导入 | Day 72 的 `pythonpath` |
| 分档表 parametrize、用例 id | Day 73 |
| `FakeClient` 剧本、`fake.calls` 行为验证 | Day 74 |
| `getLogger(__name__)`、入口配置、`caplog` | Day 75 |

## 本周错题与坑清单

每一条都是这周真实跑出来的报错或现象,前面写了是哪天。

| 现象 | 原因 | 怎么办 | 哪天 |
| --- | --- | --- | --- |
| 测试永远是绿的 | 忘写 `assert`,或者写成 `assert(a == b, "说明")` 变成断言一个非空元组 | 每个测试至少故意让它红一次 | 71 |
| `assert 0.30000000000000004 == 0.3` 失败 | 浮点误差 | `pytest.approx` | 71 |
| pytest 说 `collected 0 items` | 文件或函数没以 `test_` 开头 | 改名 | 71 |
| `ModuleNotFoundError: No module named 'part01'` | 测试搬进 `tests/` 后,插进 `sys.path` 的是 `tests/` 本身 | `pyproject.toml` 写 `pythonpath = ["."]` | 72 |
| 配置不生效 | `[tool.pytest]` 和 `[tool.pytest.ini_options]` 混用,或者选项名拼错 | 只留一种,看输出末尾的 `Unknown config option` | 72 |
| `fixture 'xxx' not found`,结果是 `E` | fixture 名字拼错,或者定义在别的测试文件里 | 对名字;共享的放 `conftest.py` | 73 |
| `function uses no argument 'xxx'` | parametrize 列名和函数参数名对不上 | 对列名 | 73 |
| 单独跑能过,一起跑就挂 | `scope="module"` 的可变 fixture,或手动改了模块属性没还原 | 默认 scope;用 `monkeypatch` | 73、74 |
| `async def functions are not natively supported` | pytest 不会跑协程 | 普通测试函数里 `asyncio.run(...)` | 74 |
| `TypeError: ... got an unexpected keyword argument 'params'` | 假对象签名和真的不一样 | 用 Protocol 标注,编辑器会提前报 | 74 |
| patch 了好像没生效,`FakeClient` 抛 `KeyError` | `from a import f` 后 patch 的是 `a.f` | patch 使用的地方 | 74 |
| `assert 10.0 == 2.5`,`setenv` 不起作用 | 模块顶层导入时就读了环境变量 | 改成调用时读,或 `setattr` 那个变量 | 74 |
| `assert 3.0 == 10.0`,只在某人机器上红 | 测默认值时环境里正好设了同名变量 | 先 `delenv(..., raising=False)` | 74 |
| `basicConfig` 写了没反应 | 前面已经有一次 `logging.xxx(...)` 触发了默认配置 | 入口最前面配置;救急用 `force=True` | 75 |
| `--- Logging error ---` / `not enough arguments for format string` | 占位符和参数个数不一致 | 数占位符 | 75 |
| 日志名字是 `__main__` | 模块被 `-m` 直接运行 | 单独的入口脚本 | 75 |
| DEBUG 时 httpcore 刷屏 | root 设成了 DEBUG | root 保持 WARNING,只放开自己的包 | 75 |

## 动手练习

**练习 1(默写,Day 71–72):** 合上文章,写出 `pyproject.toml` 里 pytest 的那三行配置,再新建 `tests/test_recall.py`,写两个测试:`total_cost(8, 29, 2.0, 8.0)` 约等于 `0.000248`;token 数为负时抛 `ValueError` 且信息里有「不能是负数」。然后只跑名字里同时有 `recall` 和 `negative` 的用例。

<details><summary>参考答案</summary>

`pyproject.toml` 里的配置(Day 72 写的):

```toml
[tool.pytest]
pythonpath = ["."]
testpaths = ["tests"]
```

<div class="line-notes">

- `[tool.pytest]` pytest 9 开始支持的原生 TOML 配置表。和老写法 `[tool.pytest.ini_options]` 只能二选一。
- `pythonpath = ["."]` 启动时把仓库根目录加进 `sys.path`,`from part01.cost import ...` 才找得到。
- `testpaths = ["tests"]` 不给路径时只在 `tests/` 里找测试。

</div>

```python
# agent-zero-lab/tests/test_recall.py
import pytest

from part01.cost import total_cost


def test_real_call():
    assert total_cost(8, 29, 2.0, 8.0) == pytest.approx(0.000248)


def test_negative_tokens():
    with pytest.raises(ValueError, match="不能是负数"):
        total_cost(-1, 0, 2.0, 8.0)
```

<div class="line-notes">

- `from part01.cost import total_cost` Day 71 建、Day 73 扩展过的 `part01/cost.py`。
- `assert total_cost(8, 29, 2.0, 8.0) == pytest.approx(0.000248)` `(8×2 + 29×8) / 1e6 = 248 / 1e6`。
- `with pytest.raises(ValueError, match="不能是负数"):` 块里必须抛 `ValueError`,而且信息要匹配。
- `total_cost(-1, 0, 2.0, 8.0)` 实际的错误信息是 `token 数不能是负数: -1, 0`。

</div>

```bash
uv run pytest tests/test_recall.py -v
uv run pytest -k "recall and negative" -q
```

实跑输出依次是(第一条只留了关键几行):

```text
configfile: pyproject.toml
tests/test_recall.py::test_real_call PASSED                              [ 50%]
tests/test_recall.py::test_negative_tokens PASSED                        [100%]
============================== 2 passed in 0.03s ===============================
```

```text
1 passed, 61 deselected in 0.21s
```

`-k` 后面可以写 `and`、`or`、`not` 组合条件,匹配的是 node id 里的名字。`61 deselected` 是我仓库里其他没被选中的用例数,你的数字会因为删没删演示文件而不同。

</details>

**练习 2(默写,Day 74):** 合上文章,写出 `tests/fakes.py` 里的 `FakeClient` 和 `ok`:能按 URL 返回响应、能抛剧本里的异常、能记录每次调用、能用在 `async with` 里。写完跑 `uv run pytest -q` 确认 Day 74 的测试全绿。

<details><summary>参考答案</summary>

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

- `def __init__(self, routes: dict[str, httpx.Response | Exception]):` 剧本:URL → 响应或异常。
- `self.calls: list[tuple[str, dict[str, Any]]] = []` 记录本。
- `async def get(self, url: str, *, params: dict[str, Any] | None = None) -> httpx.Response:` 签名照抄 `HttpClient` Protocol。`async` 和 `params` 参数一个都不能少;那个 `*` 在假对象这边漏了倒没关系(我实测去掉后 basedpyright 仍是 0 errors,因为不带 `*` 的参数既能按位置也能按名字传,只会更宽松),但 Protocol 里的 `*` 不能删,删了真的 `httpx.AsyncClient` 反而对不上。
- `self.calls.append((url, params or {}))` 先记账再干活,抛异常的那次也有记录。
- `result = self.routes[url]` 剧本里没有这个 URL 就 `KeyError`,这是安全网。
- `if isinstance(result, Exception):` 是异常就抛。
- `return result` 否则返回响应。
- `async def __aenter__(self) -> "FakeClient":` `async with` 进入时调用,返回自己。
- `async def __aexit__(self, *args: object) -> None:` 离开时调用,什么都不用做。
- `return httpx.Response(status, json=data, request=httpx.Request("GET", url))` `request=` 不能省,`raise_for_status` 要用。

</div>

默写完我这里跑 `uv run pytest -q` 是全绿。对照时重点看三处,少了哪一处会报什么,都是实测的:`get` 忘了 `async`,报 `TypeError: object Response can't be used in 'await' expression`;`get` 漏了 `params` 参数,报 `TypeError: ... got an unexpected keyword argument 'params'`;`ok` 里漏了 `request=`,一调 `raise_for_status` 就报 ``RuntimeError: Cannot call `raise_for_status` as the request instance has not been set on this response.``。

</details>

**练习 3(默写,Day 75):** 合上文章,写出 `part01/weather_run.py`:root 保持 WARNING,格式带时间(时:分:秒)、级别(对齐)、名字和内容,只把 `part01` 的级别交给环境变量 `LOG_LEVEL`(默认 INFO),然后运行 `weather_cli.main`。用 `LOG_LEVEL=debug` 跑一次北京,确认能看到 geocode 的 DEBUG,看不到 httpcore。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/weather_run.py
import asyncio
import logging
import os
import sys

from part01.weather_cli import main

logging.basicConfig(
    level=logging.WARNING,
    format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
logging.getLogger("part01").setLevel(os.environ.get("LOG_LEVEL", "INFO").upper())

asyncio.run(main(sys.argv[1:] or ["北京"]))
```

<div class="line-notes">

- `from part01.weather_cli import main` 业务模块被导入,logger 名字才对。
- `level=logging.WARNING,` root 和所有第三方库默认只出 WARNING 以上。
- `format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",` `-7s` 让级别对齐。
- `datefmt="%H:%M:%S",` 只要时分秒。
- `logging.getLogger("part01").setLevel(os.environ.get("LOG_LEVEL", "INFO").upper())` 只放开自己的包。`.upper()` 让小写的 `debug` 也能用。
- `asyncio.run(main(sys.argv[1:] or ["北京"]))` 命令行参数是城市列表。

</div>

`LOG_LEVEL=debug uv run python -m part01.weather_run 北京` 我 Day 75 实跑的输出是:

```text
12:59:13 INFO    part01.weather_cli | 开始查询 1 个城市,超时 10.0 秒
12:59:13 DEBUG   part01.weather_cli | geocode 请求 city=北京
12:59:15 DEBUG   part01.weather_cli | geocode 北京 -> (39.9075, 116.39723)
12:59:16 INFO    part01.weather_cli | 北京 查询成功 14.5°C
北京: 14.5°C
```

默写时最容易犯的错是把 `LOG_LEVEL` 给了 `basicConfig` 的 `level`,那样 DEBUG 时 httpcore 会刷屏;第二常见是把 `basicConfig` 写进 `weather_cli.py` 里。

</details>

**练习 4:找出小项目漏掉的那条路径。** 对照 Day 74 练习 2,`get_air` 漏处理了哪种失败?先写一个红的测试证明它,再修代码让它变绿。

<details><summary>参考答案</summary>

漏了 `httpx.ConnectError`(连不上服务器)。新建 `tests/test_ex76.py`:

```python
# agent-zero-lab/tests/test_ex76.py
import asyncio
from typing import Any

import httpx
import pytest

from part01 import air_cli
from part01.air_cli import AIR_URL, get_air
from part01.weather_cli import GEO_URL
from tests.fakes import FakeClient, ok

BEIJING_GEO = {"results": [{"latitude": 39.9075, "longitude": 116.39723}]}


def test_air_connect_error():
    fake = FakeClient({GEO_URL: httpx.ConnectError("All connection attempts failed")})
    assert asyncio.run(get_air(fake, "北京")) == "北京: 连不上服务器"
```

<div class="line-notes">

- `from typing import Any` 和 `import pytest`、`from part01 import air_cli`、`AIR_URL`、`ok` 都是练习 5 要用的,先一起导入。
- `fake = FakeClient({GEO_URL: httpx.ConnectError("All connection attempts failed")})` 第一步就连不上。
- `assert asyncio.run(get_air(fake, "北京")) == "北京: 连不上服务器"` 期望行为,现在的代码做不到。

</div>

实跑 `uv run pytest tests/test_ex76.py -q` 的关键几行:

```text
E           httpx.ConnectError: All connection attempts failed
FAILED tests/test_ex76.py::test_air_connect_error - httpx.ConnectError: All c...
```

在 `air_cli.py` 的 `get_air` 里,`except httpx.TimeoutException:` 那一段后面加:

```python
# agent-zero-lab/part01/air_cli.py(get_air 里新增的三行)
    except httpx.ConnectError as e:
        log.warning("%s 连不上服务器: %s", city, e)
        return f"{city}: 连不上服务器"
```

<div class="line-notes">

- `except httpx.ConnectError as e:` 和 Day 75 天气工具里的写法一样。
- `log.warning("%s 连不上服务器: %s", city, e)` 日志里带上原因。
- `return f"{city}: 连不上服务器"` 给用户的一句话。

</div>

再跑,这个测试变绿。这道题想让你记住的是:「抄一份结构相似的代码」是最常见的漏 bug 方式,上一份代码后来修过的东西,复制时很容易拿到修之前的版本。这也是为什么等两个工具都稳定了,值得把这段公共逻辑抽出来。

</details>

**练习 5:给 air_cli.main 写一个不联网的测试。** 用 `monkeypatch` 把 `httpx.AsyncClient` 换成返回 `FakeClient` 的函数,剧本给北京 PM2.5 `160.0`,用 `capsys` 断言打印的是 `北京: PM2.5 160.0 μg/m³,重度污染`。

<details><summary>参考答案</summary>

追加在 `tests/test_ex76.py` 末尾:

```python
# agent-zero-lab/tests/test_ex76.py(追加)
def test_air_main(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]):
    fake = FakeClient({GEO_URL: ok(GEO_URL, BEIJING_GEO), AIR_URL: ok(AIR_URL, {"current": {"pm2_5": 160.0}})})

    def fake_async_client(**kwargs: Any) -> FakeClient:
        return fake

    monkeypatch.setattr(air_cli.httpx, "AsyncClient", fake_async_client)
    asyncio.run(air_cli.main(["北京"]))
    assert capsys.readouterr().out == "北京: PM2.5 160.0 μg/m³,重度污染\n"
```

<div class="line-notes">

- `fake = FakeClient({GEO_URL: ok(GEO_URL, BEIJING_GEO), AIR_URL: ok(AIR_URL, {"current": {"pm2_5": 160.0}})})` 160 落在 150 到 250 之间,重度污染。
- `def fake_async_client(**kwargs: Any) -> FakeClient:` 冒充 `httpx.AsyncClient` 这个类,收下 `timeout=10`,交出假客户端。
- `monkeypatch.setattr(air_cli.httpx, "AsyncClient", fake_async_client)` `air_cli` 里写的是 `httpx.AsyncClient(...)`,查找路径是「httpx 模块的 AsyncClient 属性」,所以 patch httpx 模块上的属性。测完自动还原。
- `asyncio.run(air_cli.main(["北京"]))` 跑 `main`,它以为自己连上了网。
- `assert capsys.readouterr().out == "北京: PM2.5 160.0 μg/m³,重度污染\n"` `160.0` 是浮点数,f-string 原样输出 `160.0`;末尾的 `\n` 是 `print` 加的。

</div>

实跑 `uv run pytest tests/test_ex76.py -q` 是 `2 passed in 0.07s`(练习 4 修完之后)。全做完我这里 `uv run pytest -q` 是 `62 passed in 0.27s`。

</details>

**验收标准:** 练习 1–3 是合上文章写出来的,和答案对比后只有变量名之类的小差别;`uv run python -m part01.air_run 北京 上海` 能真跑出结果和日志;`tests/test_air.py` 加练习的测试全部离线通过;你能不看本文,对着知识地图说出每一天解决的问题。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| PM2.5 | 直径不超过 2.5 微米的颗粒物浓度,单位 μg/m³,数值越大空气越差 |
| 纯函数 | 不碰网络、文件、日志等外部世界,同样输入永远同样输出的函数,如 `pm25_level`,最好测 |
| 边界值测试 | 在分档边界两侧各放一个用例(35 和 35.1),专门抓 `<` 和 `<=` 写错 |
| 复用 vs 抽象 | 复用是直接调已有函数(`geocode`);抽象是把两段相似逻辑合成一个,重复不多时别急着抽 |
| 知识地图 | 复习日用的一张图,把一周内容按「解决什么问题」连起来 |

本周其他术语都在各天的名词解释里:`assert`、`pytest.approx`、node id 见 Day 71–72;fixture、parametrize、`conftest.py` 见 Day 73;假对象、monkeypatch、capsys 见 Day 74;logger、级别、`basicConfig`、caplog 见 Day 75。

## 常见误区

**复习日只看不写。** 看懂和写得出来是两回事,练习 1–3 真的合上文章写,卡住的地方就是你没掌握的地方,把它记进自己的错题本。

**复制一份旧代码当新工具的起点,又不对照旧代码后来的修改。** 练习 4 就是这么来的:`get_weather` 在 Day 74 补了 `ConnectError`,照着旧版写的 `get_air` 没有。

**两处相似就急着抽公共函数。** 才两个工具,共同点还没看清,抽出来的函数参数会越加越多。等第三处出现、或者确定它们会一起变化时再抽。

**新工具不复用旧模块,而是整段复制 `geocode`。** 复制以后两份要分别维护,修一个 bug 要记得修两处。能 import 就 import。

**测试数据和真实接口对不上。** 假对象的剧本最好照抄一次真实返回(像今天先 `curl` 看一眼),而不是凭印象写字段名。字段名写错,测试照样绿,上线就挂。

**觉得「测试全绿」就等于「真接口没问题」。** 假对象测的是你的代码在各种返回下的行为,测不了对方接口改版。偶尔手动真跑一次(像今天的 `air_run`),或者以后专门写少量联网的检查,两者要配合。

## 学习资料

### 文档与文章

- [pytest 文档 · How to monkeypatch/mock modules and environments](https://docs.pytest.org/en/stable/how-to/monkeypatch.html):复习 Day 74,`setattr`、`setenv`、`delenv` 的全部用法。
- [pytest 文档 · How to manage logging](https://docs.pytest.org/en/stable/how-to/logging.html):`caplog` 和 `at_level`,小项目第 3 步用到。
- [Python 文档 · 日志常用指引](https://docs.python.org/zh-cn/3/howto/logging.html):复习 Day 75,中文。
- [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api):空气质量接口的官方文档,能看到除了 `pm2_5` 还能要哪些字段(`pm10`、`us_aqi` 等),练习之外想扩展小项目时用。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1KZWKz3Ek5&autoplay=0&high_quality=1" title="如何使用pytest进行单元测试" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>隔壁的程序员老王 · 如何使用pytest进行单元测试 · 13 分钟。把 pytest 从安装到 fixture、参数化串讲一遍,正好当 Day 71–73 的复习,看的时候在心里对一下哪些这周学过。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/cHYq1MRoyI0" title="Pytest Tutorial – How to Test Python Code" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>freeCodeCamp.org · Pytest Tutorial – How to Test Python Code · 英文长视频,不用一口气看完,挑和本周对应的段落复习;遇到这周没讲的插件,知道名字就行。</figcaption>
</figure>

### 书籍

- Brian Okken,《Python Testing with pytest》第 2 版,Pragmatic Bookshelf,2022。这一周的 pytest 四课基本对应它的第 1–5 章和第 10 章,复习时可以把这几章当成一张对照清单。

### 开源项目与代码

- [lundberg/respx](https://github.com/lundberg/respx):今天的 `FakeClient` 做成正式库的样子。读 README 里「按 URL 配响应、断言调用次数」那几个例子,对照你默写的 `FakeClient`,看看正式库多做了什么。

## 自测

1. 用一句话说出本周六天的主线。

<details><summary>答案</summary>

写一个会联网的小工具(Day 70),让它能被自动检查(Day 71–72),检查得不重复(Day 73)、不依赖网络(Day 74),最后让它在真实环境出问题时能查清楚(Day 75)。

</details>

2. `pm25_level` 的测试为什么同时放 35 和 35.1 两条?如果代码里把 `<=` 写成 `<`,哪条会红?

<details><summary>答案</summary>

边界两侧各放一条,专门抓比较符写错。写成 `<` 时,35 会被判成「良」,`edge-35` 那条会红,`just-over-35` 不受影响。

</details>

3. 小项目里 `air_cli` 用了 `weather_cli` 的 `geocode`。`test_get_air_ok` 里 `caplog` 为什么只截到一条日志,`geocode` 打的日志去哪了?

<details><summary>答案</summary>

`caplog.at_level(logging.INFO, logger="part01.air_cli")` 只把 `part01.air_cli` 设成 INFO;`geocode` 打的是 `part01.weather_cli` 的 DEBUG,级别不够也不是这个 logger,所以 `record_tuples` 里只有 `air_cli` 那一条 INFO。

</details>

4. 你在 `test_x.py` 里手动写了 `air_cli.current_pm25 = fake`,自己的测试过了,却导致 `test_air.py` 里几个测试失败。为什么?怎么改?

<details><summary>答案</summary>

手动赋值不会还原,之后的测试用的都是假的 `current_pm25`,结果还取决于执行顺序。改成 `monkeypatch.setattr(air_cli, "current_pm25", fake)`,测完自动恢复。

</details>

5. 面试题:你接手一个没有任何测试、每个函数都在里面自己 new HTTP 客户端、到处 `print` 的脚本,要在一周内让它「可测、可查」。你会按什么顺序改?

<details><summary>答案</summary>

先不改行为,用 monkeypatch 换掉客户端,写几条特征测试把现在的主要行为钉住;再把客户端改成从参数传入,换成假对象测试,覆盖成功和主要失败路径,纯计算部分抽成纯函数用 parametrize 测边界;然后把 `print` 分成两类,给用户的结果保留,调试信息改成各模块 `getLogger(__name__)` 的日志,入口统一配置级别和格式;每一步改完都跑一遍测试,确认行为没变。

</details>

## 明天预告

Day 77 · 后端是什么(一):进程、端口和 localhost。这一周写的都是「跑一次就结束」的命令行工具。前端你天天敲 `npm run dev`,然后打开 `localhost:3000`,那个一直开着、等着你来请求的东西就是一个后端进程。下周开始从这里讲起:什么是进程、端口是什么、localhost 指的是谁,一步步走到自己写一个能被浏览器访问的服务,后面的 FastAPI 和 Agent 服务都建在这上面。
