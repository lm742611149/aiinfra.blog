---
title: 'Day 75 · 日志:logging 和 getLogger(__name__)'
description: '别再到处 print 了。今天学 Python 自带的 logging:五个级别、basicConfig 定格式、每个模块一个 getLogger(__name__),入口脚本统一配置;给天气工具加上日志,让结果走 stdout、日志走 stderr,用一个环境变量切换详细程度。'
pubDate: 2026-10-22
regime: none
tags: ['python', 'logging', 'agent-zero']
series: 'agent-zero'
day: 75
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 74](/blog/agent-zero/day-074-pytest-4/) 给天气工具写了不联网的测试:手写一个 `FakeClient` 按剧本返回响应或抛异常,用它把成功、找不到城市、500、超时、连不上五条路径都测了;再用 `monkeypatch` 临时换掉模块里的函数、类和环境变量,测完自动还原。练习 2 还顺手修了一个真 bug:`get_weather` 接不住 `httpx.ConnectError`。

测试回答的是「代码对不对」。可程序真跑起来以后,出了问题你要知道「刚才到底发生了什么」:哪个城市超时了,请求的是哪个接口,参数是什么。测试管不了这个,这是日志的活。以后 Agent 一次要调十几步模型和工具,没有日志基本没法排查,所以今天把这个习惯定下来。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说出 logging 的五个级别分别用在什么场合,能用 `basicConfig` 设置级别和输出格式。
2. 在每个模块里写 `log = logging.getLogger(__name__)`,知道 `__name__` 在被导入和直接运行时分别是什么,以及日志里的名字有什么用。
3. 给天气工具加上日志,并写一个入口脚本统一配置:结果打到 stdout,日志打到 stderr,用环境变量 `LOG_LEVEL` 切换详细程度,把 httpx 这类第三方库的日志压下去。
4. 认出两个坑:`basicConfig` 写在第一条日志之后不生效;占位符和参数个数对不上不会崩,只会打出一段 `--- Logging error ---`。

预计用时:2 小时。

前置:[Day 5](/blog/agent-zero/day-005-terminal-3/) 的重定向 `>`、[Day 32](/blog/agent-zero/day-032-modules/) 的 `__name__`、[Day 33](/blog/agent-zero/day-033-packages/) 的 `-m` 运行、[Day 53](/blog/agent-zero/day-053-env-secrets/) 的环境变量、[Day 70](/blog/agent-zero/day-070-weather-project/) 的天气工具和 [Day 74](/blog/agent-zero/day-074-pytest-4/) 改过的 `part01/weather_cli.py`、`tests/fakes.py`。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `part01/weather_run.py` 和 `weather_cli.py` 里加日志的几行默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## print 调试的问题

前端你肯定这么干过:哪里不对就塞一行 `console.log`,看完再删。Python 里对应的是 `print`。小脚本这样没毛病,程序一大就出三个问题。

第一,**分不清轻重**。一行「北京 14.5°C」是给用户看的结果,一行「请求参数 name=北京」是你调试用的,一行「北京 请求超时」是出了问题,全都用 `print` 打出来长得一模一样。浏览器控制台好歹还有 `console.log`、`console.warn`、`console.error` 三种颜色,还能按级别筛选。

第二,**关不掉**。调试完要么一行行删,要么注释掉,下次出问题又一行行加回来。

第三,**和结果混在一起**。天气工具的结果本来就是 `print` 出来的,有人会把它重定向进文件 `uv run python -m part01.weather_cli 北京 > today.txt`,或者以后被别的程序读取。调试信息也走 `print` 的话,就会混进 `today.txt` 里。

Python 标准库自带的 `logging` 模块正好解决这三件事,不用装任何东西。它相当于一个正经的 `console.log/warn/error`:有级别,能一处设置开关,默认输出到另一条通道。

## 第 1 步:第一行日志

新建 `part01/log_first.py`:

```python
# agent-zero-lab/part01/log_first.py
import logging

print("print 写到 stdout")
logging.debug("debug:请求参数 name=北京")
logging.info("info:北京 14.5°C")
logging.warning("warning:北京 请求超时")
logging.error("error:接口返回 500")
```

<div class="line-notes">

- `import logging` 标准库,不用 `uv add`。
- `print("print 写到 stdout")` 对照组。
- `logging.debug("debug:请求参数 name=北京")` 最低的级别,调试细节。
- `logging.info("info:北京 14.5°C")` 普通的进展信息。
- `logging.warning("warning:北京 请求超时")` 出了点问题,但程序还能继续。
- `logging.error("error:接口返回 500")` 出错了,某件事没做成。

</div>

在仓库根目录跑:

```bash
uv run python -m part01.log_first
```

实跑输出:

```text
print 写到 stdout
WARNING:root:warning:北京 请求超时
ERROR:root:error:接口返回 500
```

四条日志只出来两条。`debug` 和 `info` 不见了,因为 logging 默认只输出 `WARNING` 及以上的级别,我用 `logging.getLogger().level` 查了一下,实测是 `30`,也就是 `WARNING`。默认格式是 `级别:logger 名字:内容`,`root` 是 logger 的名字,第 4 步讲。

再做个实验。Day 5 学过,`2>/dev/null` 把 stderr 扔掉,`1>/dev/null` 把 stdout 扔掉:

```bash
uv run python -m part01.log_first 2>/dev/null
uv run python -m part01.log_first 1>/dev/null
```

<div class="line-notes">

- `uv run python -m part01.log_first 2>/dev/null` `2` 是 stderr 的编号,`/dev/null` 是一个「写进去就消失」的特殊文件。
- `uv run python -m part01.log_first 1>/dev/null` `1` 是 stdout 的编号,`1>` 和单独写 `>` 是一个意思。

</div>

实跑输出依次是:

```text
print 写到 stdout
```

```text
WARNING:root:warning:北京 请求超时
ERROR:root:error:接口返回 500
```

扔掉 stderr,日志全没了,`print` 还在;扔掉 stdout,`print` 没了,日志还在。说明**日志默认走 stderr(标准错误输出),print 走 stdout(标准输出)**,是两条独立的通道。终端里两条都显示在屏幕上,所以平时看不出区别,一重定向就分开了。这正好解决了上面第三个问题:结果用 `print` 进 stdout,日志进 stderr,`> today.txt` 只会存下结果。

还有一个现象:我第一次让程序的输出被管道接走(不是直接打到终端)时,看到的顺序是两行日志在前、`print` 在后。原因是 stdout 在不连终端时会攒一批再输出,stderr 是立刻输出。这也说明它们是两条路,不保证谁先谁后。在终端里直接跑,顺序就是代码的顺序。

## 第 2 步:五个级别

| 级别 | 数值 | 什么时候用 | 天气工具里的例子 |
| --- | --- | --- | --- |
| `DEBUG` | 10 | 排查问题时才想看的细节 | 请求参数、地理编码返回的经纬度 |
| `INFO` | 20 | 正常运行中的关键进展 | 开始查 2 个城市;北京查询成功 14.5°C |
| `WARNING` | 30 | 出了意外,但程序处理了 | 找不到城市;请求超时;连不上服务器 |
| `ERROR` | 40 | 某件事失败了,需要人关注 | 接口返回 500 |
| `CRITICAL` | 50 | 整个程序没法继续了 | 配置文件读不了,直接退出 |

数值是我用 `print(logging.DEBUG, logging.INFO, logging.WARNING, logging.ERROR, logging.CRITICAL)` 实测打出来的:`10 20 30 40 50`。设置级别的规则只有一条:**设成某个级别,就只输出数值大于等于它的日志**。设成 `INFO`(20),`DEBUG`(10)就被过滤掉。

怎么选级别,我的经验是看「半夜三点会不会想被这条日志叫醒」:`ERROR` 会,`WARNING` 白天看看就行,`INFO` 是事后翻看用的,`DEBUG` 只在排查时打开。拿不准时偏低一档写,一个 `WARNING` 都不该是正常情况。

## 第 3 步:basicConfig,定级别和格式

默认的格式 `WARNING:root:...` 太简陋,没有时间,级别也不对齐。用 `logging.basicConfig` 统一设置。新建 `part01/log_config.py`:

```python
# agent-zero-lab/part01/log_config.py
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("weather")

log.debug("请求参数 name=%s", "北京")
log.info("%s 当前 %.1f°C", "北京", 14.5)
log.warning("%s 请求超时(%s 秒)", "上海", 10)
log.error("接口返回 %d", 500)
```

<div class="line-notes">

- `logging.basicConfig(` 一次性配置「日志往哪写、什么格式、什么级别」。整个程序只该调一次,第 5 步会讲为什么。
- `level=logging.INFO,` 只输出 INFO(20)及以上。也可以写字符串 `"INFO"`,效果一样。
- `format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",` 每条日志长什么样。`%(xxx)s` 是占位符,logging 输出时自动填:`asctime` 是时间,`levelname` 是级别名,`name` 是 logger 的名字,`message` 是你写的内容。`-7s` 的意思是「至少占 7 个字符宽,不够在右边补空格」,`WARNING` 正好 7 个字母,`INFO` 后面补 3 个空格,这样各行的名字能对齐。
- `datefmt="%H:%M:%S",` 时间只显示「时:分:秒」。不写的话默认是 `2026-10-22 12:59:53,336` 这种带日期和毫秒的格式。
- `log = logging.getLogger("weather")` 拿一个名叫 `weather` 的 logger。之前用的 `logging.info(...)` 是直接用最顶层的 root logger;正式代码里都是先拿一个有名字的 logger 再用它,好处第 4 步讲。
- `log.debug("请求参数 name=%s", "北京")` 级别 10 小于 20,被过滤,不会出现。
- `log.info("%s 当前 %.1f°C", "北京", 14.5)` 注意写法:内容里用 `%s`、`%.1f` 占位,参数跟在后面,**不是** f-string。`%s` 填 `"北京"`,`%.1f` 是保留一位小数的浮点数,填 `14.5`。
- `log.warning("%s 请求超时(%s 秒)", "上海", 10)` `%s` 什么类型都能填,整数 10 也行。
- `log.error("接口返回 %d", 500)` `%d` 是整数。

</div>

```bash
uv run python -m part01.log_config
```

实跑输出:

```text
12:58:01 INFO    weather | 北京 当前 14.5°C
12:58:01 WARNING weather | 上海 请求超时(10 秒)
12:58:01 ERROR   weather | 接口返回 500
```

三条,`debug` 那条被过滤了;时间、级别、名字、内容各占一列,级别对齐了。

### 为什么用 %s 占位而不是 f-string

你可能觉得 `log.info(f"{city} 当前 {temp}°C")` 更顺手,它也能用。logging 推荐占位写法有两个原因。

一是**省事**。用占位写法时,logging 先判断这条日志会不会输出,会输出才去拼字符串;f-string 是在调用 `log.debug(...)` 之前就拼好了,哪怕这条日志马上被过滤掉。一条无所谓,一个循环里每次都拼一大段请求内容就是白干活。

二是**后面的工具能用上**。占位写法下,logging 记下的是「模板 + 参数」两部分,以后接日志平台时,同一个模板的日志可以归成一类统计,比如「`%s 请求超时` 今天出现了 37 次」。

占位写法有个坑:占位符和参数个数对不上。我故意少传一个参数:

```bash
uv run python -c "
import logging
logging.basicConfig(level=logging.INFO)
logging.info('城市 %s 温度 %s', '北京')
print('程序还活着')
"
```

<div class="line-notes">

- `uv run python -c "` `-c` 后面直接跟一段代码,Day 71 用过。这里用双引号括了一段多行代码。
- `logging.info('城市 %s 温度 %s', '北京')` 两个 `%s`,只给了一个参数。
- `print('程序还活着')` 看程序有没有被打断。

</div>

实跑输出(中间的 traceback 我删了几行):

```text
--- Logging error ---
Traceback (most recent call last):
  File ".../python3.12/logging/__init__.py", line 1160, in emit
    msg = self.format(record)
  ...
TypeError: not enough arguments for format string
Call stack:
  File "<string>", line 4, in <module>
Message: '城市 %s 温度 %s'
Arguments: ('北京',)
程序还活着
```

logging 不会因为这种错误让程序崩掉(日志本身出错就把业务停掉,太不划算),而是在 stderr 打一段 `--- Logging error ---`,告诉你哪一行、模板是什么、参数是什么,然后程序照常往下走。看到 `--- Logging error ---` 就去数占位符。

## 第 4 步:getLogger(__name__),每个模块一个 logger

上一步 `getLogger("weather")` 的名字是手写的。正式代码里几乎都写成:

```python
log = logging.getLogger(__name__)
```

`__name__` 是 [Day 32](/blog/agent-zero/day-032-modules/) 学过的那个自动变量。回忆一下它的值,做个小实验。新建两个文件:

```python
# agent-zero-lab/part01/name_demo.py
print("name_demo 里的 __name__ =", __name__)
```

<div class="line-notes">

- `print("name_demo 里的 __name__ =", __name__)` 打印这个模块自己的 `__name__`。

</div>

```python
# agent-zero-lab/part01/name_main.py
import part01.name_demo

print("name_main 里的 __name__ =", __name__)
```

<div class="line-notes">

- `import part01.name_demo` 导入另一个模块,导入时它的 `print` 会执行。
- `print("name_main 里的 __name__ =", __name__)` 打印自己的。

</div>

```bash
uv run python -m part01.name_main
uv run python -m part01.name_demo
```

实跑输出:

```text
name_demo 里的 __name__ = part01.name_demo
name_main 里的 __name__ = __main__
name_demo 里的 __name__ = __main__
```

规律:**被导入的模块,`__name__` 是它的完整模块名 `part01.name_demo`;被直接运行的那个模块(`-m` 后面那个),`__name__` 是 `"__main__"`**。

那 `getLogger(__name__)` 好在哪?

一是**日志自带出处**。格式里有 `%(name)s`,每条日志都会写明是 `part01.weather_cli` 打的还是 `httpx` 打的。程序有几十个模块时,这就是你找代码的线索。

二是**名字是分层的,可以一层层控制**。logger 名字用点分隔,`part01.weather_cli` 是 `part01` 的子 logger,`part01` 又是最顶层 root 的子 logger。给 `part01` 设级别,它下面所有模块都受影响。这和模块的包结构正好一一对应,用 `__name__` 起名,分层就是白送的。第 6 步会用上。

三是**同一个名字永远拿到同一个对象**。在哪个文件里调 `logging.getLogger("part01.weather_cli")`,拿到的都是同一个 logger,不用把它传来传去。

所以分工是这样的:**每个模块开头只写一行 `log = logging.getLogger(__name__)`,只管打日志;程序入口写一次 `basicConfig`,决定日志往哪输出、什么格式、什么级别**。模块不要自己调 `basicConfig`,因为模块不知道自己会被谁用:你的天气模块被一个网页服务导入时,日志格式应该听网页服务的。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="logger 的层级:模块用 getLogger(__name__) 打日志,日志沿名字往上传到 root,由入口配置的 handler 统一输出到 stderr">
<rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="240" y="20" width="160" height="48" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
<text x="252" y="40" fill="var(--ink)">root</text>
<text x="252" y="58" fill="var(--ink-soft)">级别 WARNING</text>
<rect x="430" y="20" width="190" height="48" fill="var(--paper-raised)" stroke="var(--rule)" rx="4"/>
<text x="442" y="40" fill="var(--ink)">basicConfig 装的输出</text>
<text x="442" y="58" fill="var(--ink-soft)">格式 → stderr</text>
<line x1="400" y1="44" x2="430" y2="44" stroke="var(--rule)" stroke-width="2"/>
<rect x="60" y="110" width="160" height="48" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
<text x="72" y="130" fill="var(--ink)">part01</text>
<text x="72" y="148" fill="var(--ink-soft)">级别 = LOG_LEVEL</text>
<rect x="420" y="110" width="160" height="48" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="432" y="130" fill="var(--ink)">httpx</text>
<text x="432" y="148" fill="var(--ink-soft)">没设,沿用 WARNING</text>
<rect x="20" y="200" width="200" height="48" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
<text x="32" y="220" fill="var(--ink)">part01.weather_cli</text>
<text x="32" y="238" fill="var(--ink-soft)">getLogger(__name__)</text>
<rect x="240" y="200" width="170" height="48" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="252" y="220" fill="var(--ink)">httpcore.http11</text>
<text x="252" y="238" fill="var(--ink-soft)">第三方库</text>
<line x1="120" y1="200" x2="140" y2="158" stroke="var(--rule)" stroke-width="2"/>
<line x1="140" y1="110" x2="280" y2="68" stroke="var(--rule)" stroke-width="2"/>
<line x1="500" y1="110" x2="360" y2="68" stroke="var(--rule)" stroke-width="2"/>
<line x1="325" y1="200" x2="320" y2="68" stroke="var(--rule)" stroke-width="2"/>
<text x="430" y="200" fill="var(--ink-soft)">一条日志先过自己</text>
<text x="430" y="218" fill="var(--ink-soft)">(或最近的上级)的级别,</text>
<text x="430" y="236" fill="var(--ink-soft)">再沿线往上交给 root 的输出</text>
</g>
</svg>
<figcaption>名字里的点就是层级。模块只用 getLogger(__name__) 打日志;入口脚本给 root 装上输出(basicConfig),再按名字给自己的包和第三方库分别设级别。图里是第 6 步最终的配置。</figcaption>
</figure>

## 第 5 步:basicConfig 写晚了会怎样

`basicConfig` 有一个很容易踩的规矩:**它只在 root logger 还没有任何输出目标时才生效**。而你随手调一次 `logging.warning(...)`(直接用 `logging.xxx` 函数,不是 `log.xxx`),logging 发现还没配置,会自动帮你按默认格式配一次。之后你再调 `basicConfig`,它一声不吭什么也不做。

```python
# agent-zero-lab/part01/log_bad.py(演示完删掉)
import logging

logging.warning("先打一条")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s | %(message)s")
logging.info("这条能看到吗?")
```

<div class="line-notes">

- `logging.warning("先打一条")` 这一行触发了自动配置:默认格式、默认级别 WARNING。
- `logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s | %(message)s")` 想改成 INFO 和新格式,但 root 已经有输出目标了,这一行被静默忽略。
- `logging.info("这条能看到吗?")` 级别还是 WARNING,INFO 被过滤。

</div>

实跑 `uv run python -m part01.log_bad`:

```text
WARNING:root:先打一条
```

只有一行,`这条能看到吗?` 没出来,也没有任何报错。真实项目里更常见的版本是:某个被导入的模块在顶层调了一次 `logging.info(...)` 或自己调了 `basicConfig`,于是入口脚本的配置全部失效,你怎么改格式都没反应。解决办法就是上一步的分工:模块里只用 `getLogger(__name__)` 拿到的 logger 打日志,`basicConfig` 放在入口、放在最前面。练习 4 还会看到一个强制覆盖的参数。演示完删掉 `part01/log_bad.py`。

## 第 6 步:给天气工具加日志

打开 Day 74 改过的 `part01/weather_cli.py`,加上日志。改动的地方:顶部 `import logging` 和一行 `log = ...`;`geocode` 里两条 DEBUG;`get_weather` 每个 `except` 里一条 WARNING 或 ERROR,成功时一条 INFO;`main` 开头一条 INFO。`print` 不动,结果照样走 stdout。

```python
# agent-zero-lab/part01/weather_cli.py
import asyncio
import logging
import os
import sys
from typing import Any, Protocol

import httpx

GEO_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

log = logging.getLogger(__name__)


class HttpClient(Protocol):
    async def get(self, url: str, *, params: dict[str, Any] | None = None) -> httpx.Response: ...


class WeatherError(Exception):
    """查天气失败,带一句给人看的原因。"""


async def geocode(client: HttpClient, city: str) -> tuple[float, float]:
    log.debug("geocode 请求 city=%s", city)
    resp = await client.get(GEO_URL, params={"name": city, "count": 1, "language": "zh"})
    resp.raise_for_status()
    results = resp.json().get("results")
    if not results:
        raise WeatherError(f"找不到城市: {city}")
    lat, lon = results[0]["latitude"], results[0]["longitude"]
    log.debug("geocode %s -> (%s, %s)", city, lat, lon)
    return lat, lon


async def current_temp(client: HttpClient, lat: float, lon: float) -> float:
    resp = await client.get(FORECAST_URL, params={"latitude": lat, "longitude": lon, "current": "temperature_2m"})
    resp.raise_for_status()
    return resp.json()["current"]["temperature_2m"]


async def get_weather(client: HttpClient, city: str) -> str:
    try:
        lat, lon = await geocode(client, city)
        temp = await current_temp(client, lat, lon)
    except httpx.TimeoutException:
        log.warning("%s 请求超时", city)
        return f"{city}: 请求超时"
    except httpx.ConnectError as e:
        log.warning("%s 连不上服务器: %s", city, e)
        return f"{city}: 连不上服务器"
    except httpx.HTTPStatusError as e:
        log.error("%s 接口返回 %d,url=%s", city, e.response.status_code, e.request.url)
        return f"{city}: 接口返回 {e.response.status_code}"
    except WeatherError as e:
        log.warning("%s", e)
        return str(e)
    log.info("%s 查询成功 %.1f°C", city, temp)
    return f"{city}: {temp}°C"


def timeout_seconds() -> float:
    return float(os.environ.get("WEATHER_TIMEOUT", "10"))


async def main(cities: list[str]) -> None:
    timeout = timeout_seconds()
    log.info("开始查询 %d 个城市,超时 %.1f 秒", len(cities), timeout)
    async with httpx.AsyncClient(timeout=timeout) as client:
        lines = await asyncio.gather(*(get_weather(client, c) for c in cities))
    for line in lines:
        print(line)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:] or ["北京"]))
```

<div class="line-notes">

- `import logging` 新增。
- `log = logging.getLogger(__name__)` 新增。写在模块顶层,所有函数共用。被导入时 `__name__` 是 `part01.weather_cli`。注意这里只拿 logger,不调 `basicConfig`。
- `log.debug("geocode 请求 city=%s", city)` 请求前记一笔参数。DEBUG 级别,平时看不到,排查时打开。
- `lat, lon = results[0]["latitude"], results[0]["longitude"]` 原来直接 `return` 的那一行拆成两步,为了在返回前记日志。
- `log.debug("geocode %s -> (%s, %s)", city, lat, lon)` 实跑时是 `geocode 北京 -> (39.9075, 116.39723)`。
- `log.warning("%s 请求超时", city)` 超时是「出了意外但处理了」,WARNING。
- `except httpx.ConnectError as e:` Day 74 练习 2 加的那个分支,这里多了 `as e`,要把异常信息写进日志。
- `log.warning("%s 连不上服务器: %s", city, e)` `%s` 填异常对象时,填的是 `str(e)`,实跑是 `All connection attempts failed`。返回给用户的那句话不带这些技术细节,日志里要带。这是日志和输出分开的另一个好处:给人看的简短,给工程师看的详细。
- `log.error("%s 接口返回 %d,url=%s", city, e.response.status_code, e.request.url)` 接口报错是 ERROR,把出错的 URL 也记下来,`e.request.url` 是完整的请求地址。
- `log.warning("%s", e)` 找不到城市。只写 `log.warning(e)` 也能跑,但第一个参数应该是模板字符串,养成 `"%s", e` 的习惯,免得异常信息里碰巧有 `%` 号时出错。
- `log.info("%s 查询成功 %.1f°C", city, temp)` 成功的关键进展,INFO。
- `timeout = timeout_seconds()` 原来写在 `AsyncClient(...)` 括号里,拆出来是为了下一行能记进日志。
- `log.info("开始查询 %d 个城市,超时 %.1f 秒", len(cities), timeout)` 超时实际取了多少,是排查「为什么老超时」时第一个要看的东西。
- `print(line)` 结果还是 `print`,不改。
- `asyncio.run(main(sys.argv[1:] or ["北京"]))` 这里**没有** `basicConfig`,原因下面看。

</div>

先确认 Day 74 的测试没被改坏:

```bash
uv run pytest -q
```

实跑 `46 passed in 0.27s`。加日志不改变行为,测试本来就该全过。

然后不做任何配置,直接跑:

```bash
uv run python -m part01.weather_cli 北京 qwertyzz
```

实跑输出:

```text
找不到城市: qwertyzz
北京: 14.5°C
找不到城市: qwertyzz
```

第一行是日志,后两行是结果。没人调 `basicConfig` 时,logging 有一个兜底:WARNING 及以上的日志只打内容本身,输出到 stderr,所以只看到了那条 WARNING,INFO 和 DEBUG 都没有。这个兜底是故意设计的:一个库就算没人配置日志,真出问题时也不会一声不吭。

### 先在 __main__ 里配,看看会怎样

最直接的想法是在 `if __name__ == "__main__":` 下面加一行 `basicConfig`。我临时这么改了一下(看完会改回来):

```python
# agent-zero-lab/part01/weather_cli.py(临时改动,看完改回去)
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s | %(message)s", datefmt="%H:%M:%S")
    asyncio.run(main(sys.argv[1:] or ["北京"]))
```

<div class="line-notes">

- `logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s | %(message)s", datefmt="%H:%M:%S")` 和第 3 步一样的格式,级别 INFO。

</div>

再跑 `uv run python -m part01.weather_cli 北京 qwertyzz`,实跑输出:

```text
12:58:52 INFO    __main__ | 开始查询 2 个城市,超时 10.0 秒
12:58:54 INFO    httpx | HTTP Request: GET https://geocoding-api.open-meteo.com/v1/search?name=%E5%8C%97%E4%BA%AC&count=1&language=zh "HTTP/1.1 200 OK"
12:58:55 INFO    httpx | HTTP Request: GET https://geocoding-api.open-meteo.com/v1/search?name=qwertyzz&count=1&language=zh "HTTP/1.1 200 OK"
12:58:55 WARNING __main__ | 找不到城市: qwertyzz
12:58:55 INFO    httpx | HTTP Request: GET https://api.open-meteo.com/v1/forecast?latitude=39.9075&longitude=116.39723&current=temperature_2m "HTTP/1.1 200 OK"
12:58:55 INFO    __main__ | 北京 查询成功 14.5°C
北京: 14.5°C
找不到城市: qwertyzz
```

看到两件事。

第一,我们自己的日志名字是 `__main__`,不是 `part01.weather_cli`。因为 `-m part01.weather_cli` 直接运行了它,`__name__` 就是 `"__main__"`,第 4 步的实验说过。名字没了出处,而且按名字分层控制也失效了。

第二,多出来三行 `httpx | HTTP Request: ...`,这是 httpx 库自己打的 INFO 日志。httpx 的源码里有一行 `logger = logging.getLogger("httpx")`(我在 `.venv` 里的 `httpx/_client.py` 第 117 行看到的),每发一个请求记一条。我们把 root 设成 INFO,第三方库的 INFO 也就全放出来了。

两个问题的解法是同一个:把配置挪到一个单独的入口脚本里。先把 `weather_cli.py` 末尾改回原样(删掉那行 `basicConfig`)。

## 第 7 步:入口脚本统一配置

新建 `part01/weather_run.py`,它只做两件事:配置日志,然后调 `weather_cli.main`:

```python
# agent-zero-lab/part01/weather_run.py(第一版)
import asyncio
import logging
import os
import sys

from part01.weather_cli import main

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
logging.getLogger("httpx").setLevel(logging.WARNING)

asyncio.run(main(sys.argv[1:] or ["北京"]))
```

<div class="line-notes">

- `from part01.weather_cli import main` 这次 `weather_cli` 是被导入的,它里面的 `__name__` 就是 `part01.weather_cli` 了。
- `level=os.environ.get("LOG_LEVEL", "INFO").upper(),` 级别从环境变量读,没设就 INFO。`.upper()` 让 `LOG_LEVEL=debug` 小写也能用,basicConfig 认 `"DEBUG"` 这样的大写字符串。
- `logging.getLogger("httpx").setLevel(logging.WARNING)` 单独把名叫 `httpx` 的 logger 调成 WARNING,它的 INFO 请求记录就不出来了,真出错的 WARNING 还在。
- `asyncio.run(main(sys.argv[1:] or ["北京"]))` 和 `weather_cli` 末尾那行一样。

</div>

```bash
uv run python -m part01.weather_run 北京 qwertyzz
```

实跑输出:

```text
12:58:56 INFO    part01.weather_cli | 开始查询 2 个城市,超时 10.0 秒
12:58:57 WARNING part01.weather_cli | 找不到城市: qwertyzz
12:58:59 INFO    part01.weather_cli | 北京 查询成功 14.5°C
北京: 14.5°C
找不到城市: qwertyzz
```

名字变成了 `part01.weather_cli`,httpx 安静了。再试 `LOG_LEVEL=debug`,看看排查模式:

```bash
LOG_LEVEL=debug uv run python -m part01.weather_run 北京
```

实跑输出的开头(实际有几十行,我只留了前几行):

```text
12:58:59 DEBUG   asyncio | Using selector: KqueueSelector
12:58:59 INFO    part01.weather_cli | 开始查询 1 个城市,超时 10.0 秒
12:58:59 DEBUG   part01.weather_cli | geocode 请求 city=北京
12:58:59 DEBUG   httpcore.connection | connect_tcp.started host='127.0.0.1' port=7897 local_address=None timeout=10.0 socket_options=None
12:58:59 DEBUG   httpcore.connection | connect_tcp.complete return_value=<httpcore._backends.anyio.AnyIOStream object at 0x111ab39b0>
12:58:59 DEBUG   httpcore.http11 | send_request_headers.started request=<Request [b'CONNECT']>
12:58:59 DEBUG   httpcore.http11 | send_request_headers.complete
```

被淹没了。`asyncio`、`httpcore.connection`、`httpcore.http11` 都是别的库(httpcore 是 httpx 底层用的库),root 设成 DEBUG,它们的 DEBUG 全涌出来,我们自己那两条 DEBUG 夹在中间很难找。(顺带能看到我本机的请求是先连到 `127.0.0.1:7897` 这个代理端口,这种细节在排查网络问题时反而很有用,所以第三方库的 DEBUG 不是没价值,只是平时不想看。)

一个个第三方库去压是压不完的。反过来想:**root 保持 WARNING,只把我们自己的包 `part01` 调成 `LOG_LEVEL`**。第 4 步说过名字是分层的,`part01` 的设置会管住 `part01.weather_cli` 和以后 `part01` 下的所有模块。把 `weather_run.py` 改成最终版:

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

- `level=logging.WARNING,` root 定成 WARNING:所有没单独设置的 logger(httpx、httpcore、asyncio……)都只放 WARNING 以上。
- `format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",` 格式不变。`basicConfig` 除了设级别,还给 root 装上了「按这个格式写到 stderr」的输出,所有 logger 的日志最终都沿着名字往上交给它。
- `logging.getLogger("part01").setLevel(os.environ.get("LOG_LEVEL", "INFO").upper())` 只放开我们自己的包。`setLevel` 也接受 `"DEBUG"` 这样的字符串。一条 `part01.weather_cli` 的 DEBUG 日志,先看它自己有没有设级别(没有),再看上级 `part01`(DEBUG,放行),然后交给 root 的输出打出来。往上交的时候,root 自己的 WARNING 级别不会再拦它一次,这一点有点反直觉,记住「级别只在最开始检查一次」就行。
- `asyncio.run(main(sys.argv[1:] or ["北京"]))` 不变。

</div>

再跑一次排查模式:

```bash
LOG_LEVEL=debug uv run python -m part01.weather_run 北京
```

实跑输出:

```text
12:59:13 INFO    part01.weather_cli | 开始查询 1 个城市,超时 10.0 秒
12:59:13 DEBUG   part01.weather_cli | geocode 请求 city=北京
12:59:15 DEBUG   part01.weather_cli | geocode 北京 -> (39.9075, 116.39723)
12:59:16 INFO    part01.weather_cli | 北京 查询成功 14.5°C
北京: 14.5°C
```

干净了。时间戳也能看出点东西:从发请求到拿到经纬度花了两秒,查温度又一秒,慢在网络上,不在代码里。

### 结果和日志分开存

最后验证一开始说的「结果走 stdout、日志走 stderr」:

```bash
uv run python -m part01.weather_run 北京 qwertyzz 2>/dev/null
uv run python -m part01.weather_run 北京 qwertyzz 2>weather.log >/dev/null
cat weather.log
```

<div class="line-notes">

- `uv run python -m part01.weather_run 北京 qwertyzz 2>/dev/null` 扔掉日志,只看结果。
- `uv run python -m part01.weather_run 北京 qwertyzz 2>weather.log >/dev/null` 日志存进 `weather.log`,结果扔掉。两个重定向可以同时写。
- `cat weather.log` 看存下来的日志。看完 `rm weather.log`。

</div>

实跑输出依次是:

```text
北京: 14.5°C
找不到城市: qwertyzz
```

```text
12:59:21 INFO    part01.weather_cli | 开始查询 2 个城市,超时 10.0 秒
12:59:22 WARNING part01.weather_cli | 找不到城市: qwertyzz
12:59:25 INFO    part01.weather_cli | 北京 查询成功 14.5°C
```

再看出错的情况。用 Day 74 的假代理制造一次断网,只看 WARNING 以上:

```bash
LOG_LEVEL=warning HTTPS_PROXY=http://127.0.0.1:9 https_proxy=http://127.0.0.1:9 uv run python -m part01.weather_run 北京
```

实跑输出:

```text
12:59:26 WARNING part01.weather_cli | 北京 连不上服务器: All connection attempts failed
北京: 连不上服务器
```

用户看到的是一句人话,日志里有具体原因。

`LOG_LEVEL` 写错会怎样?我试了 `LOG_LEVEL=verbose`,实跑报错的最后一行是 `ValueError: Unknown level: 'VERBOSE'`,程序直接退出。这是好事,配置错了就该早点大声报错,别默默用一个你没想到的级别跑。

### 测试里的日志

Day 74 的测试现在还会用到这些日志吗?会。pytest 默认会截下测试期间 WARNING 及以上的日志,测试失败时贴在报告里。我故意写了一个会失败的测试,剧本让地理编码超时,却期望拿到 14.5 度:

```python
# agent-zero-lab/tests/test_tmp_log.py(演示完删掉)
import asyncio

import httpx

from part01.weather_cli import GEO_URL, get_weather
from tests.fakes import FakeClient


def test_fail_with_log():
    fake = FakeClient({GEO_URL: httpx.ReadTimeout("timed out")})
    assert asyncio.run(get_weather(fake, "北京")) == "北京: 14.5°C"
```

<div class="line-notes">

- `fake = FakeClient({GEO_URL: httpx.ReadTimeout("timed out")})` Day 74 的剧本写法,地理编码直接超时,`get_weather` 会打一条 WARNING。
- `assert asyncio.run(get_weather(fake, "北京")) == "北京: 14.5°C"` 故意写错的期望值,让测试失败。

</div>

实跑 `uv run pytest tests/test_tmp_log.py -q`,报告的末尾:

```text
E       AssertionError: assert '北京: 请求超时' == '北京: 14.5°C'
E         
E         - 北京: 14.5°C
E         + 北京: 请求超时

tests/test_tmp_log.py:11: AssertionError
------------------------------ Captured log call -------------------------------
WARNING  part01.weather_cli:weather_cli.py:47 北京 请求超时
=========================== short test summary info ============================
```

`Captured log call` 这一段就是测试运行时打的日志,还带了文件名和行号 `weather_cli.py:47`。测试红了先看这里,往往直接就知道走了哪条分支。练习 2 会反过来,用 pytest 的 `caplog` 断言「确实打了这条日志」。看完把这个故意失败的测试删掉。

## 零件和成品的对照

| 成品里的这一段 | 来自 | 做什么 |
| --- | --- | --- |
| `weather_cli.py` 的 `log = logging.getLogger(__name__)` | 第 4 步 | 每个模块一个 logger,名字带出处 |
| `geocode` 里的两条 `log.debug` | 第 2、6 步 | 排查时才看的请求参数和中间结果 |
| `get_weather` 里的 WARNING / ERROR / INFO | 第 2、6 步 | 按轻重记录每条路径,带上技术细节 |
| `log.xxx("%s ...", 参数)` 的写法 | 第 3 步 | 占位写法,被过滤时不拼字符串 |
| `weather_run.py` 的 `basicConfig` | 第 3、5、7 步 | 入口统一定格式,输出到 stderr |
| `getLogger("part01").setLevel(...)` | 第 4、7 步 | 只放开自己的包,第三方库保持 WARNING |
| `LOG_LEVEL` 环境变量 | 第 7 步 | 不改代码切换详细程度 |

以后运行天气工具用 `uv run python -m part01.weather_run 城市...`;`weather_cli.py` 自己也还能直接跑,只是不带日志配置。

`print` 也不是从此不能用了。我的规则是:**给用户看的结果用 print(或者以后的返回值、接口响应),给工程师看的过程用日志**。调试时临时加一行 `print` 看个值,看完就删,也没问题;只要你想把它留在代码里,就改成 `log.debug`。

## 动手练习

**练习 1:日志写进文件。** 新建 `part01/log_file.py`,和 `weather_run.py` 一样调 `main`,但让日志写进仓库根目录的 `weather.log`(用 UTF-8 编码),`part01` 的级别固定 INFO,时间用默认格式。跑两次,看文件里有几行,说明默认是追加还是覆盖。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/log_file.py
import asyncio
import logging
import sys

from part01.weather_cli import main

logging.basicConfig(
    level=logging.WARNING,
    filename="weather.log",
    encoding="utf-8",
    format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
)
logging.getLogger("part01").setLevel(logging.INFO)

asyncio.run(main(sys.argv[1:] or ["北京"]))
```

<div class="line-notes">

- `filename="weather.log",` 给了 `filename`,basicConfig 就把日志写进这个文件,不再写 stderr。路径相对于你运行命令的目录,在仓库根目录跑就生成在根目录。
- `encoding="utf-8",` 日志里有中文,明确写 UTF-8,Day 38 讲过不写编码的坑。
- `format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",` 没写 `datefmt`,时间是默认的完整格式。
- `logging.getLogger("part01").setLevel(logging.INFO)` 固定 INFO。

</div>

```bash
uv run python -m part01.log_file 北京 qwertyzz
cat weather.log
uv run python -m part01.log_file 上海 >/dev/null
wc -l weather.log
```

实跑输出:

```text
北京: 14.5°C
找不到城市: qwertyzz
```

```text
2026-10-22 12:59:53,336 INFO    part01.weather_cli | 开始查询 2 个城市,超时 10.0 秒
2026-10-22 12:59:54,888 WARNING part01.weather_cli | 找不到城市: qwertyzz
2026-10-22 12:59:56,403 INFO    part01.weather_cli | 北京 查询成功 14.5°C
```

```text
       5 weather.log
```

第一次跑屏幕上只剩结果,日志都进了文件,默认时间格式带日期和毫秒(`,336` 是毫秒)。第二次查上海又写了 2 行,文件变成 5 行,说明默认是**追加**。想每次覆盖,`basicConfig` 里加 `filemode="w"`。`weather.log` 别提交进 git,加进 `.gitignore`(Day 53 学的),练习完 `rm weather.log`。

</details>

**练习 2:用 caplog 断言日志。** pytest 还有一个内置 fixture 叫 `caplog`,能截下测试里打的日志。新建 `tests/test_weather_log.py`,用 Day 74 的 `FakeClient` 让地理编码超时,断言 `get_weather` 返回 `"北京: 请求超时"`,并且恰好打了一条 `part01.weather_cli` 的 WARNING,内容是 `"北京 请求超时"`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/tests/test_weather_log.py
import asyncio
import logging

import httpx
import pytest

from part01.weather_cli import GEO_URL, get_weather
from tests.fakes import FakeClient


def test_timeout_logs_warning(caplog: pytest.LogCaptureFixture):
    fake = FakeClient({GEO_URL: httpx.ReadTimeout("timed out")})
    with caplog.at_level(logging.WARNING, logger="part01.weather_cli"):
        line = asyncio.run(get_weather(fake, "北京"))
    assert line == "北京: 请求超时"
    print(caplog.record_tuples)
    assert caplog.record_tuples == [("part01.weather_cli", logging.WARNING, "北京 请求超时")]
```

<div class="line-notes">

- `def test_timeout_logs_warning(caplog: pytest.LogCaptureFixture):` 和 `capsys`、`monkeypatch` 一样,按名字注入。
- `fake = FakeClient({GEO_URL: httpx.ReadTimeout("timed out")})` Day 74 的剧本写法,地理编码直接超时。
- `with caplog.at_level(logging.WARNING, logger="part01.weather_cli"):` 在这个 `with` 块里,把 `part01.weather_cli` 的级别临时设成 WARNING 并截下日志。写明级别,测试就不依赖外面怎么配置,出了块自动恢复。
- `line = asyncio.run(get_weather(fake, "北京"))` 跑被测代码。
- `assert line == "北京: 请求超时"` 返回值照常检查。
- `print(caplog.record_tuples)` 看看截到了什么。`record_tuples` 是一个列表,每条日志是 `(logger 名字, 级别数值, 渲染后的内容)`。
- `assert caplog.record_tuples == [("part01.weather_cli", logging.WARNING, "北京 请求超时")]` 正好一条。内容是占位符填好之后的样子,所以写 `"北京 请求超时"` 不是 `"%s 请求超时"`。

</div>

实跑 `uv run pytest tests/test_weather_log.py -q -s`:

```text
[('part01.weather_cli', 30, '北京 请求超时')]
.
1 passed in 0.09s
```

`30` 就是 WARNING 的数值。什么时候值得测日志?大多数日志不用测,测多了改一个字就红一片。值得测的是有人依赖它的:比如运维按某条 ERROR 设了告警,这条日志没了告警就失灵了。

</details>

**练习 3:把 traceback 也记进日志。** `log.error` 只记一句话。有时候你想把完整的 traceback 也留下来,又不想让程序崩。新建 `part01/log_exc.py`,模拟 Day 74 练习 1 那种「天气数据缺字段」:`data = {"current": {}}`,在 `try` 里取 `data["current"]["temperature_2m"]`,`except KeyError` 里用 `log.exception(...)` 记下来,最后打印「程序继续往下走」。看输出和 `log.error` 有什么不同。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/log_exc.py
import logging

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s | %(message)s")
log = logging.getLogger("part01.log_exc")

data = {"current": {}}
try:
    temp = data["current"]["temperature_2m"]
except KeyError:
    log.exception("解析天气数据失败,原始数据=%s", data)
print("程序继续往下走")
```

<div class="line-notes">

- `logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s | %(message)s")` 这个文件自己就是入口(会被 `-m` 直接运行),所以在这里配置。
- `log = logging.getLogger("part01.log_exc")` 名字手写成模块名。直接运行时 `__name__` 是 `__main__`,手写一下让日志里的名字更有意义。
- `data = {"current": {}}` 缺了 `temperature_2m`。
- `temp = data["current"]["temperature_2m"]` 抛 `KeyError`。
- `log.exception("解析天气数据失败,原始数据=%s", data)` 只能在 `except` 块里用。它等于 `log.error(...)` 再加上当前异常的完整 traceback。把原始数据一起记下来,排查时就知道对方到底返回了什么。

</div>

实跑 `uv run python -m part01.log_exc`(traceback 里的长路径我缩短了):

```text
ERROR part01.log_exc | 解析天气数据失败,原始数据={'current': {}}
Traceback (most recent call last):
  File ".../agent-zero-lab/part01/log_exc.py", line 9, in <module>
    temp = data["current"]["temperature_2m"]
           ~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^
KeyError: 'temperature_2m'
程序继续往下走
```

级别是 ERROR,下面跟着和 Day 35 学的一样的 traceback,能看到出错的文件、行号和那一行代码;然后「程序继续往下走」照样打出来了。`log.error` 只会有第一行。经验:**接住了一个你没预料到的异常、又不打算往上抛的时候,用 `log.exception`**;预料之中的失败(像找不到城市)用 `warning` 写一句就够,不用每次都贴 traceback。

</details>

**练习 4(观察题):强制重新配置。** 把第 5 步的 `log_bad.py` 复制成 `part01/log_force.py`,在 `basicConfig(...)` 里加一个参数 `force=True`,跑一下,和第 5 步的结果对比。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/log_force.py
import logging

logging.warning("先打一条")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s | %(message)s", force=True)
logging.info("这条能看到吗?")
```

<div class="line-notes">

- `logging.warning("先打一条")` 还是先触发了一次默认配置。
- `logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s | %(message)s", force=True)` `force=True` 表示先把 root 现有的输出目标拆掉,再按新参数重新配。
- `logging.info("这条能看到吗?")` 这次用的是新配置。

</div>

实跑 `uv run python -m part01.log_force`:

```text
WARNING:root:先打一条
INFO root | 这条能看到吗?
```

第一行是旧的默认格式,第二行是新格式,INFO 也出来了。`force=True` 能救急,但它掩盖的是「有人在你之前配了日志」这个问题。我只在两种情况下用它:Jupyter 这类别人已经配过日志的环境里做实验;入口脚本里明确要覆盖某个第三方库偷偷做的配置。

</details>

**验收标准:** `part01/weather_cli.py` 里每个模块级 logger 都是 `getLogger(__name__)`,没有 `basicConfig`;`uv run python -m part01.weather_run 北京 qwertyzz` 能看到带时间、级别、名字的 INFO 和 WARNING,且没有 httpx 的请求记录;`LOG_LEVEL=debug` 能看到 geocode 的两条 DEBUG 且没有 httpcore 的刷屏;`2>/dev/null` 只剩结果;`uv run pytest -q` 全绿(我这里加上练习 2 是 `47 passed`)。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| logging | Python 标准库的日志模块,有级别、格式、输出目标,不用安装 |
| 日志级别 | 一条日志的轻重:DEBUG 10、INFO 20、WARNING 30、ERROR 40、CRITICAL 50,设成某级只输出大于等于它的 |
| logger | 打日志用的对象,用 `logging.getLogger(名字)` 拿,同名永远是同一个 |
| root logger | 最顶层的 logger,`logging.info(...)` 这类函数直接用的就是它,名字显示为 `root` |
| `getLogger(__name__)` | 用模块名给 logger 起名的惯用写法,日志能看出出处,还能按包分层控制级别 |
| logger 层级 | 名字用点分隔形成父子关系,`part01.weather_cli` 的上级是 `part01`,再上是 root |
| `basicConfig` | 给 root 一次性配置级别、格式、输出位置;root 已有输出目标时不生效,除非 `force=True` |
| 格式占位符 | `format` 里的 `%(asctime)s`、`%(levelname)s`、`%(name)s`、`%(message)s` 等,输出时自动填 |
| 占位写法 | `log.info("%s 成功", city)`,模板和参数分开传,被过滤时不拼字符串 |
| stdout / stderr | 标准输出 / 标准错误输出,程序的两条输出通道;print 默认走前者,logging 默认走后者 |
| 兜底输出 | 没人配置日志时,WARNING 及以上只打内容本身到 stderr 的默认行为 |
| `log.exception` | 在 `except` 里用,记一条 ERROR 并附上完整 traceback |
| caplog | pytest 内置 fixture,截下测试期间的日志,`record_tuples` 取 `(名字, 级别, 内容)` |
| `Captured log call` | pytest 失败报告里贴出的、测试运行期间打的日志 |

## 常见误区

**在模块里调 `basicConfig`。** 模块被谁导入它不知道,在模块里配日志会抢走入口的配置权,入口再调 `basicConfig` 就静默失效。模块里只写 `log = logging.getLogger(__name__)`。

**`basicConfig` 写在第一条日志之后。** 任何一次 `logging.warning(...)` 这类直接调用都会触发默认配置,之后的 `basicConfig` 什么也不做,不报错。第 5 步实测只出来一行 `WARNING:root:先打一条`。放在入口最前面。

**直接运行的模块,logger 名字是 `__main__`。** `-m part01.weather_cli` 运行时,它的 `__name__` 是 `"__main__"`,日志里出处丢了,按 `part01` 设的级别也管不到它。入口放一个单独的小脚本,业务模块都被导入。

**把 root 设成 DEBUG。** 第三方库的 DEBUG 会刷屏,第 7 步实测 httpcore 一个请求就打十几行。root 保持 WARNING,只把自己的包调低。

**日志里用 f-string,或者占位符个数不对。** f-string 能用但每次都拼字符串;占位符和参数对不上时程序不崩,只在 stderr 打 `--- Logging error ---` 和 `TypeError: not enough arguments for format string`,很容易被忽略。

**用 `log.error` 吞掉异常又不留 traceback。** 只写一句「出错了」,事后完全不知道是哪一行。接住意料之外的异常时用 `log.exception`。

**以为日志会进 stdout。** logging 默认写 stderr,`> out.txt` 存不下日志;想存日志要 `2> log.txt` 或者 `basicConfig(filename=...)`。反过来,别用日志输出程序的正式结果。

**日志里打密钥。** 调试时顺手 `log.debug("headers=%s", headers)`,`Authorization: Bearer sk-...` 就进了日志文件,日志文件往往权限很松还会被上传到日志平台。Day 53 说过密钥不进仓库,同样也不进日志。

## 学习资料

### 文档与文章

- [Python 文档 · 日志常用指引](https://docs.python.org/zh-cn/3/howto/logging.html):官方的 logging 入门教程,中文。「基础教程」一节就是今天第 1–3 步,「进阶教程」开头讲的 logger 层级和「每个模块一个 logger」就是第 4 步,先读这两节。
- [Python 文档 · logging 模块参考](https://docs.python.org/zh-cn/3/library/logging.html):查 `basicConfig` 全部参数(`filename`、`filemode`、`encoding`、`force`)和 `format` 里所有占位符时用,在页面里搜「LogRecord 属性」。
- [Python 文档 · 日志操作手册](https://docs.python.org/zh-cn/3/howto/logging-cookbook.html):各种进阶用法的菜谱,比如同时写文件和终端、按大小切分日志文件。现在知道有这页就行。
- [pytest 文档 · How to manage logging](https://docs.pytest.org/en/stable/how-to/logging.html):`caplog` 的用法,以及失败报告里 `Captured log call` 是怎么来的。
- [HTTPX 文档 · Logging](https://www.python-httpx.org/logging/):httpx 和 httpcore 各自用哪些 logger 名字、每个级别打什么,第 7 步那些刷屏的日志在这里都有解释。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1rJv8eNE1x&autoplay=0&high_quality=1" title="[Python] logging模块怎么用" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>隔壁的程序员老王 · [Python] logging模块怎么用 · 10 分钟。讲级别、basicConfig 和格式,和今天第 1–3 步对得上,节奏快,适合学完再看一遍巩固。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1gM7HzuEEJ&autoplay=0&high_quality=1" title="Python 别再打印了,赶紧学完日志模块,调试的好帮手" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>努力啊小白 · Python 别再打印了,赶紧学完日志模块,调试的好帮手 · 15 分钟。从「为什么不用 print」讲起,对应今天开头那一节和第 3 步。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/-ARI4Cz-awo" title="Python Tutorial: Logging Basics - Logging to Files, Setting Levels, and Formatting" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Tutorial: Logging Basics - Logging to Files, Setting Levels, and Formatting · 英文,很多人的 logging 入门课,讲级别、写文件、格式,和练习 1 对应。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/9L77QExPmI0" title="Modern Python logging" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>mCoding · Modern Python logging · 英文,难度比今天高,讲 logger 层级、handler 和用配置文件管日志。看前三分之一,把「日志沿名字往上传」这件事看明白就够了。</figcaption>
</figure>

### 书籍

- David Beazley、Brian K. Jones,《Python Cookbook》第 3 版,O'Reilly,2013;中文版《Python Cookbook(第 3 版)中文版》,人民邮电出版社,2015。第 13 章有两节正好对应今天:13.11「给简单脚本增加日志功能」和 13.12「给函数库增加日志功能」,后者讲的就是「库里只拿 logger、不做配置」。网上有社区翻译的免费中文版 [python3-cookbook](https://python3-cookbook.readthedocs.io/zh-cn/latest/chapters/p13_utility_script_and_system_manage.html),这两节可以直接在线读。

### 开源项目与代码

- [encode/httpx 的 _client.py](https://github.com/encode/httpx/blob/master/httpx/_client.py):搜 `logger`,看一个流行库怎么拿 logger、在哪里打 INFO 和 DEBUG。你会发现它用的是写死的名字 `"httpx"` 而不是 `__name__`,这是库作者为了让用户好记做的取舍。
- [python/cpython 的 Lib/logging](https://github.com/python/cpython/tree/main/Lib/logging):标准库 logging 的源码。打开 `__init__.py` 搜 `def basicConfig`,能看到它只在 `len(root.handlers) == 0`(root 还没有输出目标)时才做配置,第 5 步的坑就来自这里。
- [Delgan/loguru](https://github.com/Delgan/loguru):一个很流行的第三方日志库,用法比标准库简单。我建议先把标准库学扎实,因为你用的每个第三方库(httpx、FastAPI、LangChain)都在用标准库 logging,不懂它就压不住它们的日志。

## 自测

1. 设置 `level=logging.INFO` 后,`log.debug`、`log.info`、`log.warning` 哪些会输出?为什么?

<details><summary>答案</summary>

`info` 和 `warning` 会输出,`debug` 不会。INFO 是 20,只输出级别数值大于等于 20 的日志,DEBUG 是 10。

</details>

2. 运行 `uv run python -m part01.weather_run 北京 > out.txt`,`out.txt` 里有什么?日志去哪了?

<details><summary>答案</summary>

`out.txt` 里只有结果 `北京: 14.5°C`(print 走 stdout)。日志默认走 stderr,没被重定向,所以还是显示在终端上。

</details>

3. 为什么模块里写 `logging.getLogger(__name__)`,而不是在每个模块里调 `basicConfig`?

<details><summary>答案</summary>

`__name__` 让日志带上模块名作为出处,并能按包名分层控制级别。`basicConfig` 只应该由入口调一次:模块不知道自己会被谁导入,而且 root 一旦被配置过,后面入口的 `basicConfig` 会静默失效。

</details>

4. 同样一个模块,被 `import` 时 logger 名是 `part01.weather_cli`,被 `-m` 直接运行时是什么?这会带来什么问题?

<details><summary>答案</summary>

是 `__main__`。日志里看不出是哪个模块打的,而且给 `part01` 设置的级别管不到它(`__main__` 不在 `part01` 下面)。所以入口单独放一个小脚本,业务模块都通过导入使用。

</details>

5. 面试题:线上 Agent 服务出了问题,你想看某一个模块的详细日志,但不想被所有第三方库的 DEBUG 刷屏,也不想改代码重新发布。你会怎么设计日志配置?

<details><summary>答案</summary>

所有模块用 `getLogger(__name__)`;入口里 root 保持 WARNING(或 INFO),只按包名或模块名单独设置级别,而且级别从环境变量或配置读,比如 `LOG_LEVEL`,甚至支持按 logger 名分别配置;这样改一个环境变量重启(或者用支持热更新的配置)就能只放开那个模块的 DEBUG。日志里不打密钥和用户隐私,ERROR 及以上接告警。

</details>

## 明天预告

Day 76 · 第 11 周复习:编程地基(Day 70–75)。这一周从 Day 70 的天气小项目出发,接连学了 pytest 四课和今天的日志,其实一直在围着同一个文件 `weather_cli.py` 打转:先让它能用,再让它可测,最后让它出了问题能查。明天画一张本周知识地图,把六天串起来,默写本周最核心的几段代码,再做一个只用本周知识的小项目。
