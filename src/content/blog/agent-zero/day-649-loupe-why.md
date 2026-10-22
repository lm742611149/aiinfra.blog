---
title: 'Day 649 · Loupe 开题(一):调 Agent 痛在看不清每一步,现有工具做到哪'
description: '第十一部分开工,先不写 Loupe 的代码。用一个查三城气温的小 Agent 演示「看不清」:终端日志只告诉你调了什么,给每一步记下起止时间以后才看出 89% 的时间花在一个接一个的工具调用上,第一步 310 个输入 token 里工具定义占了 272 个。然后把 Langfuse、LangSmith、Phoenix、OpenAI Traces、Laminar 五家放进一张带出处的竞品表,用脚本检查,看清 2026 年哪些空白已经被别人补上了。'
pubDate: 2026-10-22
regime: none
tags: ['agent-loupe', 'observability', 'portfolio', 'python', 'agent-zero']
series: 'agent-zero'
day: 649
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 648](/blog/agent-zero/day-648-senior-graduation/) 是第十部分的最后一天。`self_check.py` 把十行资深自检表过了一遍,我的练习目录只有 2/10 行有证据;`pay_stats.py` 从真实 JD 里算出资深职位名那一档的挂牌中位 66 万到 72 万,还看清了「高级」两个字怎么把数据拉低;`offer_compare.py` 把两个 offer 拆到四年,月薪高三分之一的那个四年反而少 46 万。

那一课最后说,自检表上最难补的是「前沿判断」和「影响力」两行。第十一部分的两个作品就是冲着这两行去的:做一个别人能在线点开试用的东西,开源出去,再写文章讲它。今天是第一个作品 Agent Loupe 的第一天,先回答两个问题:它要解决的痛到底是什么,别人已经做到哪一步了。

## 今天要解决的问题

学完今天,你应该能做到:

1. 用一个真实跑起来的小 Agent 说清楚「调 Agent 痛在看不清每一步」:光看终端日志发现不了什么,给每一步记下起止时间和 token 以后能看出什么。
2. 用两次调用的 token 差,量出一次模型调用的输入里工具定义占了多少。
3. 写出一张五家工具 × 三项能力的竞品表,每一格都有出处,并用脚本检查它;能说出 2026 年 10 月哪一项能力还没人完整做到。
4. 面试官问「为什么不直接用 Langfuse 或 LangSmith」时,给出一个承认对方强项、又说得清自己定位的回答。

预计用时 2.5 小时,其中差不多一半在读五家的文档。今天只花几分钱(调 DeepSeek 十几次,算式在后面)。

前置:[Day 170](/blog/agent-zero/day-170-agent-full/)(完整的 Agent 循环)、[Day 162](/blog/agent-zero/day-162-parallel-tools/)(一次返回多个 tool_calls)、[Day 136](/blog/agent-zero/day-136-llm-client-2/)(`LLMClient` 和 `ledger`)、[Day 364](/blog/agent-zero/day-364-tracing-concepts/) 到 [Day 367](/blog/agent-zero/day-367-tracing-views/)(trace、span、Langfuse)、[Day 322](/blog/agent-zero/day-322-lg-time-travel/)(LangGraph 时间旅行)、[Day 178](/blog/agent-zero/day-178-thinking-budget/)(线程池,练习 2 用)。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `traced_agent.py` 里记录一步的那几行和 `waterfall.py` 默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先准备环境

第十一部分前半段的练习代码放在 `agent-zero-lab/part11/`,从 Day 651 开始 Loupe 本体会有自己的独立仓库 `agent-loupe/`。今天还用不着新仓库,所有东西都在练习仓库里。

在 `agent-zero-lab` 根目录(就是有 `pyproject.toml` 和 `.env` 的那一层,我这里是 `/Users/你/agent-zero-lab`)跑:

```bash
cd /Users/你/agent-zero-lab
mkdir -p part11/runs
touch part11/__init__.py
uv add openai python-dotenv httpx    # 前面早就装过的话,这一行什么也不会改
```

`common/llm.py` 是 [Day 135](/blog/agent-zero/day-135-llm-client-1/) 到 Day 137 写的那个 `LLMClient`,今天直接 import。`.env` 里的三个变量 `LLM_BASE_URL / LLM_API_KEY / LLM_MODEL` 和前面一样,我用的是 `deepseek-flash`,价格写在 `LLM_PRICE=0.04,2,8`(缓存命中、未命中、输出,元每百万 token,2026 年 10 月查到的)。

## 第一步:一个查三城气温的小 Agent

先造一个「病人」。任务很简单:北京、上海、广州现在各多少度,算平均。工具只有一个 `get_weather`,用的是 [Day 70](/blog/agent-zero/day-070-weather-project/) 天气 CLI 用过的 Open-Meteo 免费接口,不用 key。为了让今天的文件不依赖 `part01/`,我写了一个最短的版本。循环本身就是 [Day 170](/blog/agent-zero/day-170-agent-full/) 那个 Agent 的骨架,去掉了错误处理,只留主干。

```python
# agent-zero-lab/part11/weather_agent.py
import json
import time
from typing import Any

import httpx

from common.llm import LLMClient

GEO_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
SYSTEM = "你是天气助手。需要气温时调用 get_weather,不要自己编。"
TASK = "北京、上海、广州现在各多少度?算一下三个城市的平均气温。"
TOOLS: list[dict[str, Any]] = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "查一个城市现在的气温,单位摄氏度",
        "parameters": {
            "type": "object",
            "properties": {"city": {"type": "string", "description": "城市英文名,如 Beijing"}},
            "required": ["city"],
        },
    },
}]


def get_weather(city: str) -> dict[str, Any]:
    geo = httpx.get(GEO_URL, params={"name": city, "count": 1}, timeout=20).json()
    place = geo["results"][0]
    params = {"latitude": place["latitude"], "longitude": place["longitude"], "current": "temperature_2m"}
    now = httpx.get(FORECAST_URL, params=params, timeout=20).json()
    return {"city": city, "temp_c": now["current"]["temperature_2m"]}


def run(task: str, llm: LLMClient, max_steps: int = 6) -> str:
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": task},
    ]
    for _ in range(max_steps):
        r = llm.chat(messages, tools=TOOLS)
        messages.append(r.message)
        calls = r.message.get("tool_calls")
        if not calls:
            return r.content
        for tc in calls:
            args = json.loads(tc["function"]["arguments"])
            print(f"调用 get_weather({args['city']})")
            result = get_weather(**args)
            messages.append({"role": "tool", "tool_call_id": tc["id"],
                             "content": json.dumps(result, ensure_ascii=False)})
    return "超过步数上限"


if __name__ == "__main__":
    llm = LLMClient()
    t0 = time.perf_counter()
    print(run(TASK, llm))
    print(f"总耗时 {time.perf_counter() - t0:.1f} 秒;{llm.ledger}")
```

<div class="line-notes">

- `GEO_URL = "https://geocoding-api.open-meteo.com/v1/search"` 地名转经纬度的接口。Open-Meteo 查天气要经纬度,所以一次 `get_weather` 其实是两个 HTTP 请求,这一点等会儿很关键。
- `SYSTEM = "你是天气助手。` 系统提示词只有一句,让模型别自己编气温。
- `TOOLS: list[dict[str, Any]] = [{` 工具定义,类型标注写成「字典的列表」,不写的话练习 1 改 `t["function"]["name"]` 时编辑器会画红线,因为它推断出来的值类型是「字符串或字典」。结构和 [Day 156](/blog/agent-zero/day-156-fc-idea/) 起一直用的一样:名字、描述、参数的 JSON Schema。等会儿要量它在输入里占多少 token。
- `"properties": {"city": {"type": "string", "description": "城市英文名,如 Beijing"}},` 要求英文城市名,因为地名接口对英文最稳。模型会自己把「北京」翻成 `Beijing`。
- `geo = httpx.get(GEO_URL, params={"name": city, "count": 1}, timeout=20).json()` 第一个请求。`params` 会被拼成 `?name=Beijing&count=1`,≈ 前端的 `new URLSearchParams(...)`。`.json()` ≈ `await res.json()`。
- `place = geo["results"][0]` 取第一个匹配的地点。北京返回的是 `latitude 39.9075, longitude 116.39723`。查不到时这里会 `KeyError`,今天不处理,Day 170 的错误处理你已经会了。
- `now = httpx.get(FORECAST_URL, params=params, timeout=20).json()` 第二个请求,拿当前气温。
- `return {"city": city, "temp_c": now["current"]["temperature_2m"]}` 我跑的那次北京是 `12.0`。
- `r = llm.chat(messages, tools=TOOLS)` `LLMClient.chat` 把 `tools` 原样透传给 openai SDK,返回 `ChatResult`,里面有 `message`(原样的 assistant 消息)、`prompt_tokens`、`completion_tokens`。
- `calls = r.message.get("tool_calls")` 第一轮模型一次返回了三个 tool_calls,北京、上海、广州各一个,就是 [Day 162](/blog/agent-zero/day-162-parallel-tools/) 讲的并行工具调用。第二轮没有 tool_calls,说明它要给最终回答了。
- `for tc in calls:` 三个工具调用**一个接一个**执行。这一行就是今天要「发现」的问题,先别改它。
- `print(f"调用 get_weather({args['city']})")` 我们平时调试最常加的那种日志:只说调了什么。
- `"content": json.dumps(result, ensure_ascii=False)})` 工具结果转成字符串塞回历史。`ensure_ascii=False` 让中文不被转成 `北` 这种样子。
- `print(f"总耗时 {time.perf_counter() - t0:.1f} 秒;{llm.ledger}")` `llm.ledger` 是 Day 136 的累计账本,打印出调用次数、token 和钱。

</div>

在 `agent-zero-lab/` 根目录跑:

```bash
uv run python -m part11.weather_agent
```

```text
调用 get_weather(Beijing)
调用 get_weather(Shanghai)
调用 get_weather(Guangzhou)
现在三个城市的气温如下：

- 北京：12.0 °C
- 上海：17.8 °C
- 广州：28.4 °C

平均气温 = (12.0 + 17.8 + 28.4) ÷ 3 = 58.2 ÷ 3 = **19.4 °C**
总耗时 15.0 秒;2 次调用 | 输入 792 / 输出 173 tokens | 约 ¥0.0025
```

答案对了,`(12.0 + 17.8 + 28.4) / 3 = 19.4`。花了 0.0025 元,算式是输入 792 × 2 + 输出 173 × 8 = 2968,除以一百万约 0.003(有一部分输入命中了缓存,所以实际比这个略少)。

问题是 15 秒。一个查天气的任务 15 秒算慢,可这几行输出里没有任何一行能告诉你慢在哪。是模型想太久?是网络?是三个城市里某一个特别慢?你只能猜。

我第一次碰到这种情况的反应是到处加 `print(time.time())`,加完再删,删完下次又加。这就是今天要讲的痛:**Agent 出问题时往往不报错,只是慢了、贵了、绕路了、答偏了,而普通日志只记录「调了什么」,不记录「每一步花了多久、模型每次看到了什么」。**

### 故意制造一次:直接 `python 文件路径` 跑

很多人(包括我)习惯用文件路径跑脚本。试一下:

```bash
uv run python part11/weather_agent.py
```

```text
  File "/Users/你/agent-zero-lab/part11/weather_agent.py", line 8, in <module>
    from common.llm import LLMClient
ModuleNotFoundError: No module named 'common'
```

用文件路径跑时,Python 把 `part11/` 当成起点去找模块,找不到和它平级的 `common/`。[Day 33](/blog/agent-zero/day-033-packages/) 讲过,从根目录用 `-m part11.weather_agent` 跑,起点才是 `agent-zero-lab/`。这一课所有命令都用 `-m`。

## 第二步:给每一步记下起止时间

要看清每一步,最朴素的办法是在循环里每做完一件事就往一个列表里追加一条记录:这一步是什么类型(调模型还是调工具)、叫什么、什么时候开始、什么时候结束、用了多少 token。这条列表存下来,就是一条最简陋的 **trace(运行记录)**。[Day 364](/blog/agent-zero/day-364-tracing-concepts/) 讲过 trace 和 span 的概念,今天我们自己手写一个,不接任何平台。

`part11/traced_agent.py` 只比上一个文件多一件事:记录。

```python
# agent-zero-lab/part11/traced_agent.py
import json
import sys
import time
from pathlib import Path
from typing import Any

from common.llm import LLMClient
from part11.weather_agent import SYSTEM, TASK, TOOLS, get_weather


def run(task: str, llm: LLMClient, steps: list[dict[str, Any]], max_steps: int = 6) -> str:
    t0 = time.perf_counter()
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": task},
    ]
    for _ in range(max_steps):
        start = time.perf_counter() - t0
        r = llm.chat(messages, tools=TOOLS)
        steps.append({"idx": len(steps), "kind": "llm", "name": llm.model,
                      "start": round(start, 2), "end": round(time.perf_counter() - t0, 2),
                      "input_tokens": r.prompt_tokens, "output_tokens": r.completion_tokens})
        messages.append(r.message)
        calls = r.message.get("tool_calls")
        if not calls:
            return r.content
        for tc in calls:
            args = json.loads(tc["function"]["arguments"])
            start = time.perf_counter() - t0
            result = get_weather(**args)
            steps.append({"idx": len(steps), "kind": "tool", "name": f"get_weather({args['city']})",
                          "start": round(start, 2), "end": round(time.perf_counter() - t0, 2)})
            messages.append({"role": "tool", "tool_call_id": tc["id"],
                             "content": json.dumps(result, ensure_ascii=False)})
    return "超过步数上限"


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "part11/runs/weather_run.json")
    steps: list[dict[str, Any]] = []
    answer = run(TASK, LLMClient(), steps)
    out.write_text(json.dumps({"answer": answer, "steps": steps}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(steps)} 步,存到 {out}")
```

<div class="line-notes">

- `from part11.weather_agent import SYSTEM, TASK, TOOLS, get_weather` 复用第一步的常量和工具函数。`weather_agent.py` 的运行代码在 `if __name__ == "__main__":` 下面,import 时不会跑。
- `def run(task: str, llm: LLMClient, steps: list[dict[str, Any]], max_steps: int = 6) -> str:` 多了一个参数 `steps`,调用方传一个空列表进来,函数往里追加。≈ JS 里把一个数组传进函数再 `push`,数组是同一个对象,外面能看到。
- `t0 = time.perf_counter()` 记下这次运行的起点。后面所有时间都写成「离起点几秒」,这样两步之间谁先谁后、隔了多久一眼能看出来。`perf_counter` 是专门用来量耗时的时钟,≈ 浏览器的 `performance.now()`。
- `start = time.perf_counter() - t0` 模型调用开始的相对时间。第一次是 `0.0`。
- `steps.append({"idx": len(steps), "kind": "llm", "name": llm.model,` `idx` 用当前列表长度,第一条就是 0。`kind` 只有两种:`llm` 和 `tool`。这三个字段名在 Day 652 定数据模型时会正式定下来。
- `"start": round(start, 2), "end": round(time.perf_counter() - t0, 2),` 起止时间保留两位小数。第一步实测是 `0.0` 到 `0.89`。
- `"input_tokens": r.prompt_tokens, "output_tokens": r.completion_tokens})` 这一次调用的输入和输出 token。第一次 310 和 99,第二次 482 和若干,输入变多是因为历史里多了三条工具结果。
- `start = time.perf_counter() - t0` 工具调用也一样先记开始时间。
- `steps.append({"idx": len(steps), "kind": "tool", "name": f"get_weather({args['city']})",` 工具步把参数写进名字,`get_weather(Beijing)`,看列表时一眼知道是哪个城市。
- `out = Path(sys.argv[1] if len(sys.argv) > 1 else "part11/runs/weather_run.json")` 命令行传了路径就存那里,没传就用默认路径。练习 2 会用它存第二条运行。
- `out.write_text(json.dumps({"answer": answer, "steps": steps}, ensure_ascii=False, indent=2), encoding="utf-8")` 存成带缩进的 JSON,`indent=2` ≈ `JSON.stringify(x, null, 2)`。

</div>

光有一堆 JSON 还是不好看。再写一个 `part11/waterfall.py`,把每一步画成一根横条,横条的位置和长度按时间比例来,这种图叫**瀑布图(waterfall)**,你在浏览器 DevTools 的 Network 面板里天天见:每个请求一行,横条从什么时候开始、拉多长。

```python
# agent-zero-lab/part11/waterfall.py
import json
import sys
from pathlib import Path

WIDTH = 40

trace = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
steps = trace["steps"]
total = max(s["end"] for s in steps)
for s in steps:
    left = round(s["start"] / total * WIDTH)
    size = max(1, round((s["end"] - s["start"]) / total * WIDTH))
    bar = " " * left + ("█" if s["kind"] == "llm" else "▒") * size
    tokens = f"  输入 {s['input_tokens']}" if s["kind"] == "llm" else ""
    print(f"{s['idx']:>2} {s['name']:<24}|{bar:<{WIDTH}}| {s['end'] - s['start']:5.2f}s{tokens}")
by_kind: dict[str, float] = {}
for s in steps:
    by_kind[s["kind"]] = by_kind.get(s["kind"], 0) + s["end"] - s["start"]
print(f"总 {total:.2f}s:" + ",".join(f"{k} {v:.2f}s({v / total:.0%})" for k, v in by_kind.items()))
```

<div class="line-notes">

- `WIDTH = 40` 整条时间轴画成 40 个字符宽。
- `total = max(s["end"] for s in steps)` 最后结束的那一步的结束时间,就是整次运行的总时长。实测 `15.91`。
- `left = round(s["start"] / total * WIDTH)` 起点按比例换算成「前面空几格」。北京那一步从 0.89 秒开始,`0.89 / 15.91 × 40 ≈ 2.2`,四舍五入空 2 格。这和 Day 662 用 CSS 百分比定位时间轴是同一个算式,只是单位从百分比换成了字符。
- `size = max(1, round((s["end"] - s["start"]) / total * WIDTH))` 长度按比例换算,最少画 1 格,免得很短的步骤直接消失。
- `bar = " " * left + ("█" if s["kind"] == "llm" else "▒") * size` 字符串乘整数是重复,`" " * 2` 就是两个空格,≈ JS 的 `" ".repeat(2)`。模型步用实心块,工具步用浅色块。
- `{s['name']:<24}|{bar:<{WIDTH}}|` `:<24` 左对齐补到 24 格,`:>2` 右对齐补到 2 格。`{bar:<{WIDTH}}` 是把宽度本身也写成变量,花括号套花括号。
- `by_kind[s["kind"]] = by_kind.get(s["kind"], 0) + s["end"] - s["start"]` 按类型累加耗时,`.get(键, 0)` 没有这个键时从 0 开始,≈ JS 的 `(byKind[k] ?? 0) + ...`。
- `print(f"总 {total:.2f}s:"` 最后一行写出模型和工具各占总时长的多少。这一行有个隐藏的 bug,练习 2 会把它逼出来。

</div>

```bash
uv run python -m part11.traced_agent
uv run python -m part11.waterfall part11/runs/weather_run.json
```

```text
5 步,存到 part11/runs/weather_run.json
 0 deepseek-flash          |██                                      |  0.89s  输入 310
 1 get_weather(Beijing)    |  ▒▒▒▒▒▒▒▒▒▒▒▒                          |  4.81s
 2 get_weather(Shanghai)   |              ▒▒▒▒▒▒▒▒▒▒▒               |  4.47s
 3 get_weather(Guangzhou)  |                          ▒▒▒▒▒▒▒▒▒▒▒▒  |  4.82s
 4 deepseek-flash          |                                      ██|  0.92s  输入 482
总 15.91s:llm 1.81s(11%),tool 14.10s(89%)
```

这一眼看到的东西,刚才那几行日志怎么也给不了:

- 两次模型调用加起来不到 2 秒,模型一点都不慢。
- 三次 `get_weather` 每次 4.5 到 4.8 秒,**首尾相接**,加起来占了 89%。每次慢是因为它要发两个请求,我这里的网络到 Open-Meteo 一个请求大约 2.4 秒(我用 `curl` 单独量过)。
- 模型在第 0 步已经一口气给出了三个工具调用,它们互不依赖,完全可以同时发。慢的根源不在模型,在我们自己那个 `for tc in calls:`。

改法很简单,[Day 178](/blog/agent-zero/day-178-thinking-budget/) 用过的线程池三五行就能解决,练习 2 你自己改,改完我实测是 15.91 秒降到 8.05 秒。**难的不是改,是发现。** 这句话就是 Agent Loupe 存在的理由。

再看最右边那列:第 0 步输入 310 个 token,第 4 步 482 个。用户的问题才二十来个字,310 个 token 是从哪来的?

## 第三步:量一下工具定义占了多少

一次模型调用的输入不只是你看得到的 messages。工具定义也要变成 token 喂给模型,而且每一轮都要重新喂一遍。它占多少,API 不会单独告诉你,usage 里只有一个总数 `prompt_tokens`。

办法是做减法:同样的 messages,带工具调一次、不带工具调一次,两次 `prompt_tokens` 的差就是工具定义的 token 数。再去掉系统提示词调一次,就能量出系统提示词。`max_tokens=1` 让模型只吐一个 token,几乎不花输出的钱。

```python
# agent-zero-lab/part11/tool_share.py
from common.llm import LLMClient
from part11.weather_agent import SYSTEM, TASK, TOOLS

llm = LLMClient()
messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": TASK}]
with_tools = llm.chat(messages, tools=TOOLS, max_tokens=1).prompt_tokens
bare = llm.chat(messages, max_tokens=1).prompt_tokens
only_user = llm.chat([{"role": "user", "content": TASK}], max_tokens=1).prompt_tokens
print(f"带工具 {with_tools},不带工具 {bare},只有用户消息 {only_user}")
print(f"工具定义 ≈ {with_tools - bare} token,占这一步输入的 {(with_tools - bare) / with_tools:.0%}")
print(f"系统提示词 ≈ {bare - only_user} token")
print(llm.ledger)
```

<div class="line-notes">

- `messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": TASK}]` 和第 0 步完全一样的两条消息。
- `with_tools = llm.chat(messages, tools=TOOLS, max_tokens=1).prompt_tokens` 带工具。`max_tokens=1` 透传给 API,输出被截在 1 个 token。实测 310,和瀑布图第 0 步一致,说明这个量法靠谱。
- `bare = llm.chat(messages, max_tokens=1).prompt_tokens` 不带工具,实测 38。
- `only_user = llm.chat([{"role": "user", "content": TASK}], max_tokens=1).prompt_tokens` 连系统提示词也去掉,实测 21。剩下的 21 个 token 里除了问题本身,还有聊天模板给每条消息加的标记。
- `print(f"工具定义 ≈ {with_tools - bare} token,占这一步输入的 {(with_tools - bare) / with_tools:.0%}")` `310 - 38 = 272`,`272 / 310 ≈ 88%`。`:.0%` 把小数格式化成不带小数位的百分比。

</div>

```bash
uv run python -m part11.tool_share
```

```text
带工具 310,不带工具 38,只有用户消息 21
工具定义 ≈ 272 token,占这一步输入的 88%
系统提示词 ≈ 17 token
3 次调用 | 输入 369 / 输出 3 tokens | 约 ¥0.0005
```

一个只有一个参数的工具,272 个 token,是系统提示词的十几倍。我一开始以为是我的 JSON Schema 写得太啰嗦,练习 1 加到 10 个工具一量才明白:DeepSeek 只要你传了 tools,就会先塞进一段固定的说明(约 208 个 token),之后每个工具再加 64 个左右。这是在 deepseek-flash 上量出来的,换一家厂商、换一个模型,模板不一样,数字也不一样,要自己量。

这又是一件「不报错、但值得知道」的事。[Day 184](/blog/agent-zero/day-184-tool-search-1/) 量过 60 个工具有多贵,那时你是专门写脚本去量的;如果调试工具能在每一步旁边画一根横条,告诉你这 310 个 token 里系统提示词、工具定义、历史、工具结果各占多少,你根本不用专门去量。这件事 Day 666 会做成界面。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="终端日志看到的和 trace 看到的对比:日志只有三行调用,trace 能看到每步耗时和输入构成">
<rect x="0" y="0" width="640" height="260" rx="6" fill="var(--paper-raised)"/>
<text x="20" y="26" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">同一次运行,两种视角</text>
<rect x="20" y="44" width="250" height="150" rx="4" fill="none" stroke="var(--rule)"/>
<text x="34" y="66" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">终端日志</text>
<text x="34" y="92" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">调用 get_weather(Beijing)</text>
<text x="34" y="112" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">调用 get_weather(Shanghai)</text>
<text x="34" y="132" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">调用 get_weather(Guangzhou)</text>
<text x="34" y="152" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">平均气温 19.4 °C</text>
<text x="34" y="178" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">总耗时 15.0 秒 ← 慢在哪?</text>
<rect x="300" y="44" width="320" height="150" rx="4" fill="none" stroke="var(--rule)"/>
<text x="314" y="66" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">trace + 瀑布图</text>
<rect x="314" y="80" width="12" height="14" fill="var(--mem)"/>
<rect x="326" y="100" width="88" height="14" fill="var(--compute)"/>
<rect x="414" y="120" width="82" height="14" fill="var(--compute)"/>
<rect x="496" y="140" width="88" height="14" fill="var(--compute)"/>
<rect x="584" y="160" width="17" height="14" fill="var(--mem)"/>
<text x="332" y="91" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">模型 0.89s</text>
<text x="314" y="186" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">工具 89%,三次首尾相接</text>
<rect x="20" y="210" width="600" height="20" fill="var(--paper)" stroke="var(--rule)"/>
<rect x="20" y="210" width="527" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/>
<rect x="547" y="210" width="33" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="224" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">第 0 步输入 310:工具定义 272</text>
<text x="552" y="224" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">系统17</text>
<text x="586" y="224" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">其他</text>
<text x="20" y="250" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">蓝色 = 模型侧,琥珀 = 工具侧。数字都来自今天的实跑。</text>
</svg>
<figcaption>左边是我们平时看到的东西,右边是同一次运行记下每一步以后看到的东西。底下那根条是第 0 步 310 个输入 token 的构成,工具定义占了 88%。</figcaption>
</figure>

把今天看到的归纳一下,调 Agent 比调普通程序难在哪。普通程序出错有堆栈、能打断点、能单步。Agent 出问题经常没有报错,你要回答的是这几类问题:

- 慢在哪一步,是模型还是工具,能不能并行。
- 贵在哪一步,输入里是什么把 token 撑大的。
- 第几步开始走偏了。改了一句提示词以后,两次运行从第几步开始不一样。
- 能不能只重跑出问题的那一段,而不是每次从头跑、每次都真的去查天气、真的去花钱。

前两类今天用三十行代码就看到了。后两类要难得多,也正是我们要去看看别人做到哪了的地方。

## 现有的工具做到了哪一步

动手做之前一定要先查一圈。做一个别人已经做好的东西,放进作品集是减分的,面试官问一句「这不就是 LangSmith 的某某功能吗」你就很难接下去。

我在 2026 年 10 月 22 日查了五家的官方文档,只写查到的,没查到的写「没查到」,不猜。五家里四家是你在 [Day 365](/blog/agent-zero/day-365-langfuse/) 前后听说过的;第五家 Laminar 是我这次查的时候才注意到的,它恰好做了我原本以为是空白的东西,下面细说。

**Langfuse。** 开源、能自己部署,Day 365 我们接过。trace 详情页是嵌套的 observation 树,每个 generation 有输入输出、token 和成本。它的 [Playground 文档](https://langfuse.com/docs/prompt-management/features/playground) 写得清楚:在 generation 详情页点 `Open in Playground`,可以把**这一次模型调用**搬进 playground 改提示词重跑;playground 还支持几个 prompt 变体并排跑、并排比。注意两件事:搬过去的是单次调用,不是整条 Agent 运行;并排比的是 prompt 变体的输出,不是两条运行的每一步。

**LangSmith。** LangChain 家的商业平台。两样东西和我们相关。第一,它能比较两条 trace:打开一条 trace,右上角有 Compare,选第二条后两条并排显示、同步滚动。这个我是在 [LangChain 官方论坛的一个帖子](https://forum.langchain.com/t/missing-compare-runs-is-this-a-bug-i-could-compare-2-runs-quickly-in-the-ui/839) 里看到 LangChain 员工 2025 年 7 月的回复确认的,当前文档里我没找到专门讲它的一页,所以它对齐两条步数不同的运行时具体怎么对,我没法确认。第二,[LangGraph 的 time travel](https://docs.langchain.com/oss/python/langgraph/use-time-travel)(你在 [Day 322](/blog/agent-zero/day-322-lg-time-travel/) 用过):从某个 checkpoint 原样重放(replay)或改了状态再分叉(fork),文档原话是 checkpoint 之前的节点不重新执行,之后的节点会重新执行,**包括模型调用和 API 请求,结果可能不一样**。前提是你的 Agent 写在 LangGraph 里并且开了 checkpointer。

**Arize Phoenix。** 基于 OpenTelemetry 的开源可观测工具,能自己部署。它的 [Span Replay](https://arize.com/docs/phoenix/prompt-engineering/overview-prompts/span-replay) 把一个记录下来的 LLM span 加载进 prompt playground,换模型、改参数重跑。和 Langfuse 一样,粒度是一次模型调用。

**OpenAI Traces。** OpenAI Agents SDK [默认开启 tracing](https://openai.github.io/openai-agents-python/tracing/),记录模型生成、工具调用、handoff、guardrail,在 OpenAI 平台的 Traces 面板里看。它主要服务用 Agents SDK 的项目;文档写明开了零数据保留(ZDR)的组织用不了。对比和中途重跑,我在这页文档里没查到。

**Laminar。** 一个开源(Apache-2.0)的 Agent 可观测平台,2026 年 3 月拿了种子轮。它有一个 [debugger](https://laminar.sh/docs/debugger):用 `LMNR_DEBUG=true` 跑你的 Agent,运行被录下来;改了代码以后「对着录下来的 trace 重跑」,你选一个边界,边界之前的模型调用直接从录制里返回,不花 token,之后的全部真跑,新旧两条 trace 放在同一个 session 的时间线上。[缓存的文档](https://laminar.sh/docs/debugger/caching) 写了两个细节,很值得读:缓存键是「trace id + 这一步输入的哈希」,**哈希故意不算系统消息**,这样你改了系统提示词,前面的调用照样能命中缓存;缓存只支持一部分 SDK(OpenAI、Anthropic、Google GenAI、LiteLLM 的 Python 版和 Vercel AI SDK),其他集成重跑时每次调用都是真跑。

### 把它们放进一张表

五家的信息散在十几个页面里,口头说很容易说乱。把它写成数据文件,每一格都写上等级、一句备注和出处链接。等级只用三个词:**有**(完整做到)、**部分**(做了相近的但粒度或前提不一样)、**没查到**(我查了那一页没找到,不等于它一定没有)。

存成 `part11/competitors.json`。这是数据不是代码,可以直接复制:

```json
{
  "checked_on": "2026-10-22",
  "capabilities": ["逐步对比", "中途重跑整条", "上下文构成"],
  "tools": {
    "Langfuse": {
      "逐步对比": {"level": "部分", "note": "playground 里并排比几个 prompt 变体,不是两条运行", "source": "https://langfuse.com/docs/prompt-management/features/playground"},
      "中途重跑整条": {"level": "部分", "note": "Open in Playground 只搬一次模型调用", "source": "https://langfuse.com/docs/prompt-management/features/playground"},
      "上下文构成": {"level": "没查到", "note": "只有每次调用的 token 总数", "source": "https://langfuse.com/docs/observability/features/observation-types"}
    },
    "LangSmith": {
      "逐步对比": {"level": "有", "note": "trace 右上角 Compare,两条并排,同步滚动", "source": "https://forum.langchain.com/t/missing-compare-runs-is-this-a-bug-i-could-compare-2-runs-quickly-in-the-ui/839"},
      "中途重跑整条": {"level": "有", "note": "LangGraph time travel,要求图 + checkpointer,之后的节点真的重跑", "source": "https://docs.langchain.com/oss/python/langgraph/use-time-travel"},
      "上下文构成": {"level": "没查到", "note": "", "source": "https://docs.langchain.com/langsmith/view-traces"}
    },
    "Phoenix": {
      "逐步对比": {"level": "没查到", "note": "", "source": "https://arize.com/docs/phoenix/prompt-engineering/overview-prompts/span-replay"},
      "中途重跑整条": {"level": "部分", "note": "Span Replay 只重跑一个 LLM span", "source": "https://arize.com/docs/phoenix/prompt-engineering/overview-prompts/span-replay"},
      "上下文构成": {"level": "没查到", "note": "", "source": "https://arize.com/docs/phoenix/prompt-engineering/overview-prompts/span-replay"}
    },
    "OpenAI Traces": {
      "逐步对比": {"level": "没查到", "note": "", "source": "https://openai.github.io/openai-agents-python/tracing/"},
      "中途重跑整条": {"level": "没查到", "note": "", "source": "https://openai.github.io/openai-agents-python/tracing/"},
      "上下文构成": {"level": "没查到", "note": "只服务 Agents SDK,ZDR 组织不可用", "source": "https://openai.github.io/openai-agents-python/tracing/"}
    },
    "Laminar": {
      "逐步对比": {"level": "部分", "note": "重跑的新 trace 和旧的放在同一个 session 时间线上", "source": "https://laminar.sh/docs/debugger"},
      "中途重跑整条": {"level": "有", "note": "前缀 LLM 调用走缓存,之后全部真跑;缓存只支持部分 SDK", "source": "https://laminar.sh/docs/debugger/caching"},
      "上下文构成": {"level": "没查到", "note": "", "source": "https://laminar.sh/docs/debugger"}
    }
  }
}
```

然后写一个检查器 `part11/check_competitors.py`:把表打印成 Markdown,检查每一格的等级只用了那三个词、都有 `https://` 开头的出处,最后按能力统计哪一项还没人完整做到。和 [Day 648](/blog/agent-zero/day-648-senior-graduation/) 的 `self_check.py` 一个思路:手工对表容易自我感觉良好,交给脚本。

```python
# agent-zero-lab/part11/check_competitors.py
import json
import sys
from pathlib import Path

LEVELS = {"有", "部分", "没查到"}

data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
caps: list[str] = data["capabilities"]
problems: list[str] = []
print("| 工具 | " + " | ".join(caps) + " |")
print("| --- " * (len(caps) + 1) + "|")
for tool, cells in data["tools"].items():
    row = []
    for cap in caps:
        cell = cells.get(cap)
        if cell is None:
            problems.append(f"{tool} 缺「{cap}」这一格")
            row.append("?")
            continue
        if cell["level"] not in LEVELS:
            problems.append(f"{tool}/{cap}:level 写成了「{cell['level']}」")
        if not cell.get("source", "").startswith("https://"):
            problems.append(f"{tool}/{cap}:没有出处")
        row.append(cell["level"])
    print(f"| {tool} | " + " | ".join(row) + " |")

print(f"\n查证日期 {data['checked_on']}")
for cap in caps:
    has = [t for t, cells in data["tools"].items() if cells.get(cap, {}).get("level") == "有"]
    print(f"{cap}:" + ("已有 " + "、".join(has) if has else "没有一家完整做到 ← 空白点"))
for p in problems:
    print("问题:", p)
sys.exit(1 if problems else 0)
```

<div class="line-notes">

- `LEVELS = {"有", "部分", "没查到"}` 一个集合(set),[Day 25](/blog/agent-zero/day-025-sets/) 讲过,判断「在不在里面」最快。≈ JS 的 `new Set([...])`。
- `caps: list[str] = data["capabilities"]` 三项能力,决定表有几列、按什么顺序。
- `print("| 工具 | " + " | ".join(caps) + " |")` 拼出 Markdown 表头。`" | ".join(caps)` ≈ JS 的 `caps.join(" | ")`。
- `print("| --- " * (len(caps) + 1) + "|")` 分隔行,四列就重复四次 `| --- `。
- `for tool, cells in data["tools"].items():` 遍历字典的键和值,`tool` 是 `"Langfuse"`,`cells` 是它那三格。≈ JS 的 `Object.entries(...)`。
- `cell = cells.get(cap)` 某一格没写时返回 `None`,不会 `KeyError`。
- `if cell["level"] not in LEVELS:` 等级只许三个词。写成「无」「✓」「暂无」这种,表一大就没法统计了。
- `if not cell.get("source", "").startswith("https://"):` 出处要是链接。「没查到」也要写出处,写你查的是哪一页,别人才能复核你到底查没查。
- `has = [t for t, cells in data["tools"].items() if cells.get(cap, {}).get("level") == "有"]` 列表推导式,挑出这一项是「有」的工具。`cells.get(cap, {})` 给一个空字典当默认值,后面的 `.get("level")` 才不会在 `None` 上报错,≈ JS 的 `cells[cap]?.level`。
- `print(f"{cap}:" + ("已有 " + "、".join(has) if has else "没有一家完整做到 ← 空白点"))` 空列表在 Python 里当假,`if has` ≈ JS 的 `has.length > 0`。
- `sys.exit(1 if problems else 0)` 有问题时退出码 1,以后可以接进 CI,和 Day 646 的 `pr_lint.py` 一样。

</div>

```bash
uv run python -m part11.check_competitors part11/competitors.json
```

```text
| 工具 | 逐步对比 | 中途重跑整条 | 上下文构成 |
| --- | --- | --- | --- |
| Langfuse | 部分 | 部分 | 没查到 |
| LangSmith | 有 | 有 | 没查到 |
| Phoenix | 没查到 | 部分 | 没查到 |
| OpenAI Traces | 没查到 | 没查到 | 没查到 |
| Laminar | 部分 | 有 | 没查到 |

查证日期 2026-10-22
逐步对比:已有 LangSmith
中途重跑整条:已有 LangSmith、Laminar
上下文构成:没有一家完整做到 ← 空白点
```

检查器自己也要验一次,故意写错两格:把 Phoenix 的等级写成「无」,把 Laminar 一格的出处清空,存成 `part11/runs/competitors_bad.json` 再跑:

```text
问题: Phoenix/逐步对比:level 写成了「无」
问题: Laminar/上下文构成:没有出处
```

两处都抓到了(上面的表和统计照常打印,我只截了最后两行)。

### 这张表说明了什么

老实说,这张表的结果和我动笔前的预期不一样。这门课的旧版大纲(2026 年 10 月中旬定的)认为 Loupe 的三个卖点是「两条运行逐步对比、从中间某一步重跑整条 Agent、上下文占用可视化」,三项都是空白。这次一查,前两项已经有人做了:LangSmith 能并排比两条 trace,LangGraph 的 time travel 和 Laminar 的 debugger 都能从中间重跑整条运行。只有第三项,上下文构成,五家里一家都没查到。

这时候有两种错误的反应。一种是假装没看见,README 里照样写「市面上没有工具能做到」,面试官一搜就穿帮。另一种是觉得「被做过了,那我不做了」。作品集项目不是创业,不需要独一无二,需要的是**你清楚它和别人的区别在哪,并且说得出为什么这样选**。

细看「有」的那几格,前提都不一样:

- LangSmith 的比较要求 trace 在 LangSmith 里;LangGraph 的重跑要求 Agent 写成 LangGraph 的图并开 checkpointer。你在 Day 170 手写的那种循环用不上。
- Laminar 要用它的 SDK 来跑你的 Agent,缓存的是**模型调用的回复**,边界之后的工具调用会真的执行。这对「修提示词」很合适,但如果边界之后有一个 `create_refund_request`,它会真的去建一张退款单。
- 五家都是平台:数据要先发到它们的服务(或你自己部署的服务)里才能看。

所以 Loupe 的定位可以这样写:**一个不绑框架、不用接入 SDK 的本地调试器,导入已经存下来的 trace 文件(OTLP、Langfuse 导出,或者今天这种自己记的 JSON),做三件事:逐步对齐两条运行并标出第一处分歧,从任意一步重跑且工具结果走回放,把每一步的上下文构成画出来。** 第三件是没人做的;前两件别人有,我们换了前提和取舍。比如重跑,Laminar 回放模型、工具真跑,我们反过来,工具回放、模型真跑,为什么这样选、代价是什么,Day 669 会专门讲。

面试官十有八九会问「为什么不直接用 Langfuse 或 LangSmith」。一个诚实的回答长这样:

> 生产环境的监控我会直接用 Langfuse 或 LangSmith,它们记录和看 trace 比我做得全得多,LangSmith 也能并排比两条 trace。Loupe 解决的是开发时的调试:它不要求 Agent 用某个框架或 SDK,直接导入 trace 文件;重跑时工具结果默认回放,所以有写操作的 Agent 也能安全地从中间重跑;另外它会把每一步输入里工具定义、历史、工具结果各占多少画出来,这个我在五家的文档里都没找到。

先承认对方强,再说你的前提和取舍,最后给一个能验证的差别。这比「我的更好」可信得多。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="三项能力的覆盖情况:逐步对比和中途重跑已有人做,前提不同;上下文构成没查到">
<rect x="0" y="0" width="640" height="250" rx="6" fill="var(--paper-raised)"/>
<text x="20" y="26" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">2026-10-22 查到的覆盖情况</text>
<rect x="20" y="44" width="190" height="130" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="115" y="68" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">逐步对比</text>
<text x="34" y="94" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">有:LangSmith</text>
<text x="34" y="114" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">部分:Langfuse、Laminar</text>
<text x="34" y="146" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">前提:数据在它的平台</text>
<rect x="225" y="44" width="190" height="130" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="68" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">中途重跑整条</text>
<text x="239" y="94" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">有:LangGraph、Laminar</text>
<text x="239" y="114" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">部分:Langfuse、Phoenix</text>
<text x="239" y="146" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">前提:框架或 SDK</text>
<rect x="430" y="44" width="190" height="130" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="525" y="68" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">上下文构成</text>
<text x="444" y="94" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">五家都没查到</text>
<text x="444" y="146" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">真正的空白</text>
<text x="20" y="204" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">Loupe 的取舍:不绑框架,导入 trace 文件;</text>
<text x="20" y="224" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">重跑时工具回放、模型真跑;三件事放进一个本地工具。</text>
</svg>
<figcaption>琥珀色两块已经有人做到,区别在前提;蓝色那块是五家文档里都没查到的。「没查到」是我查的那几页没有,不等于一定没有,所以表里每一格都留着出处。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1EFtd6ZEVH&autoplay=0&high_quality=1" title="Agent 可观测性全解:Run、Trace、Thread 与生产评估闭环" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>老纪的技术唠嗑局 · Agent 可观测性全解:Run、Trace、Thread 与生产评估闭环 · 9 分钟。把 run、trace、thread 几个层级讲清楚,看完对照今天手写的 steps 列表,想想它缺了哪一层。</figcaption>
</figure>

## 今天的文件

| 文件 | 干什么 | 花钱吗 |
| --- | --- | --- |
| `part11/weather_agent.py` | 查三城气温的小 Agent,工具顺序执行 | 约 ¥0.0025 |
| `part11/traced_agent.py` | 同一个 Agent,每一步记起止时间和 token,存成 JSON | 约 ¥0.0025 |
| `part11/waterfall.py` | 把 trace 画成文本瀑布图 | 不花 |
| `part11/tool_share.py` | 做减法量出工具定义的 token | ¥0.0005 |
| `part11/competitors.json` | 五家 × 三项的竞品表,每格带出处 | 不花 |
| `part11/check_competitors.py` | 检查竞品表并找空白点 | 不花 |
| `part11/ex649_*.py`(练习) | 练习参考答案 | 合计约 ¥0.005 |

今天全部实跑加起来约 1 分钱。

## 动手练习

**练习 1:工具越多,工具定义占比越高吗?** 用 `TOOLS` 做模板,复制出 1、2、5、10 个工具(名字和描述改一下),分别量带工具时的输入 token,算出工具部分占多少。从数字里推出「固定开销」和「每个工具多少」。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part11/ex649_tools.py
import copy
from typing import Any

from common.llm import LLMClient
from part11.weather_agent import SYSTEM, TASK, TOOLS


def fake_tool(i: int) -> dict[str, Any]:
    t = copy.deepcopy(TOOLS[0])
    t["function"]["name"] = f"get_metric_{i}"
    t["function"]["description"] = f"查一个城市的第 {i} 号指标"
    return t


llm = LLMClient()
messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": TASK}]
bare = llm.chat(messages, max_tokens=1).prompt_tokens
for n in (1, 2, 5, 10):
    tools = TOOLS + [fake_tool(i) for i in range(1, n)]
    total = llm.chat(messages, tools=tools, max_tokens=1).prompt_tokens
    print(f"{n:>2} 个工具:输入 {total},工具部分 {total - bare}({(total - bare) / total:.0%})")
print(llm.ledger)
```

<div class="line-notes">

- `t = copy.deepcopy(TOOLS[0])` 深拷贝,改副本的名字不会改到原来的 `TOOLS`。只用 `dict(TOOLS[0])` 是浅拷贝,里面的 `"function"` 字典还是同一个,改名会把原工具也改掉。≈ JS 的 `structuredClone`。
- `t["function"]["name"] = f"get_metric_{i}"` 工具名不能重复,不然 API 会拒绝。
- `bare = llm.chat(messages, max_tokens=1).prompt_tokens` 不带工具的基准,和正文一样是 38。
- `tools = TOOLS + [fake_tool(i) for i in range(1, n)]` 两个列表相加是拼接,≈ JS 的 `[...TOOLS, ...fakes]`。`n=1` 时 `range(1, 1)` 是空的,只有天气工具。

</div>

```bash
uv run python -m part11.ex649_tools
```

```text
 1 个工具:输入 310,工具部分 272(88%)
 2 个工具:输入 374,工具部分 336(90%)
 5 个工具:输入 566,工具部分 528(93%)
10 个工具:输入 886,工具部分 848(96%)
5 次调用 | 输入 2174 / 输出 5 tokens | 约 ¥0.0024
```

每多一个工具多 `374 - 310 = 64` 个 token,10 个工具时 `(848 - 272) / 9 = 64`,很整齐。倒推回去,1 个工具 272 = 固定开销 + 64,固定开销约 208 个 token。也就是说在 deepseek-flash 上,只要传了 tools,哪怕只有一个,也先付 208 个 token 的「入场费」。10 个工具时用户问题和系统提示词加起来只占 4%,Agent 每一轮都在为工具说明书付钱。这组数字只对这个模型成立,换模型要重量。

</details>

**练习 2:让三个工具同时跑,再看瀑布图。** 用 [Day 178](/blog/agent-zero/day-178-thinking-budget/) 学过的 `ThreadPoolExecutor` 改 `traced_agent.py`,让同一轮的工具调用并行执行,存到 `part11/runs/weather_parallel.json`,用 `waterfall.py` 画出来。看看最后一行的百分比,是不是哪里不对?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part11/ex649_parallel.py
import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from common.llm import LLMClient
from part11.weather_agent import SYSTEM, TASK, TOOLS, get_weather


def run(task: str, llm: LLMClient, steps: list[dict[str, Any]], max_steps: int = 6) -> str:
    t0 = time.perf_counter()
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": task},
    ]

    def timed_tool(tc: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        args = json.loads(tc["function"]["arguments"])
        start = time.perf_counter() - t0
        result = get_weather(**args)
        step = {"kind": "tool", "name": f"get_weather({args['city']})",
                "start": round(start, 2), "end": round(time.perf_counter() - t0, 2)}
        return step, {"role": "tool", "tool_call_id": tc["id"],
                      "content": json.dumps(result, ensure_ascii=False)}

    for _ in range(max_steps):
        start = time.perf_counter() - t0
        r = llm.chat(messages, tools=TOOLS)
        steps.append({"idx": len(steps), "kind": "llm", "name": llm.model,
                      "start": round(start, 2), "end": round(time.perf_counter() - t0, 2),
                      "input_tokens": r.prompt_tokens, "output_tokens": r.completion_tokens})
        messages.append(r.message)
        calls = r.message.get("tool_calls")
        if not calls:
            return r.content
        with ThreadPoolExecutor(max_workers=len(calls)) as pool:
            for step, tool_msg in pool.map(timed_tool, calls):
                steps.append({"idx": len(steps), **step})
                messages.append(tool_msg)
    return "超过步数上限"


if __name__ == "__main__":
    steps: list[dict[str, Any]] = []
    run(TASK, LLMClient(), steps)
    out = Path("part11/runs/weather_parallel.json")
    out.write_text(json.dumps({"steps": steps}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(steps)} 步,存到 {out}")
```

<div class="line-notes">

- `def timed_tool(tc: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:` 把「执行一个工具 + 记时间」包成一个函数,交给线程池。它定义在 `run` 里面,所以能直接用外层的 `t0`,≈ JS 的闭包。
- `step = {"kind": "tool", "name": f"get_weather({args['city']})",` 这里先不写 `idx`,因为三个线程谁先跑完不确定,编号要在主线程里按顺序补。
- `return step, {"role": "tool", "tool_call_id": tc["id"],` 返回一个二元组:步骤记录和要塞回历史的工具消息。
- `with ThreadPoolExecutor(max_workers=len(calls)) as pool:` 有几个工具调用就开几个线程。`with` 块结束时会等所有线程跑完。
- `for step, tool_msg in pool.map(timed_tool, calls):` `pool.map` 同时把三个调用发出去,但**按输入顺序**返回结果,≈ `Promise.all(calls.map(timedTool))`。所以工具消息在历史里的顺序和 tool_calls 一致。
- `steps.append({"idx": len(steps), **step})` `**step` 把字典展开合并进来,≈ JS 的 `{idx, ...step}`。

</div>

```bash
uv run python -m part11.ex649_parallel
uv run python -m part11.waterfall part11/runs/weather_parallel.json
```

```text
5 步,存到 part11/runs/weather_parallel.json
 0 deepseek-flash          |██████                                  |  1.22s  输入 310
 1 get_weather(Beijing)    |      ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒          |  4.92s
 2 get_weather(Shanghai)   |      ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒           |  4.55s
 3 get_weather(Guangzhou)  |      ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒     |  5.87s
 4 deepseek-flash          |                                   █████|  0.95s  输入 489
总 8.05s:llm 2.17s(27%),tool 15.34s(191%)
```

三根工具条从同一个位置开始,总时长从 15.91 秒降到 8.05 秒,省下的正好是两个城市的时间。

最后一行的「tool 191%」就是 `waterfall.py` 里藏着的 bug:它把每一步的时长直接相加,并行时三段重叠的时间被算了三次,加起来超过总时长。顺序执行时这个算法碰巧是对的,一并行就错。正确的算法是把重叠的区间合并以后再算长度,Day 662 画正式时间轴时会遇到同样的问题。这也说明一件事:调试工具自己的统计口径也要验证,不然它会给你一个看起来很精确的错数。

</details>

**练习 3:检查出处还能不能打开。** `check_competitors.py` 只检查出处是不是 `https://` 开头。写 `part11/ex649_online.py`,把表里所有出处去重后逐个请求,打印状态码。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part11/ex649_online.py
import json
import sys
from pathlib import Path

import httpx

data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
urls = sorted({cell["source"] for cells in data["tools"].values() for cell in cells.values()})
bad = 0
for url in urls:
    try:
        code = httpx.get(url, follow_redirects=True, timeout=20,
                         headers={"User-Agent": "Mozilla/5.0"}).status_code
    except httpx.HTTPError as e:
        code = type(e).__name__
    ok = isinstance(code, int) and code < 400
    bad += not ok
    print(f"{'ok ' if ok else 'BAD'} {code}  {url}")
print(f"{len(urls)} 个出处,{bad} 个打不开")
```

<div class="line-notes">

- `urls = sorted({cell["source"] for cells in data["tools"].values() for cell in cells.values()})` 花括号的推导式生成集合,自动去重;两层 `for` 从左往右读,先遍历工具再遍历格子。15 格去重后剩 9 个链接。
- `code = httpx.get(url, follow_redirects=True, timeout=20,` httpx 默认不跟随跳转,文档站经常 301 到新地址,要打开 `follow_redirects`。
- `headers={"User-Agent": "Mozilla/5.0"}).status_code` 有些站对没有 UA 的请求返回 403,带一个浏览器的 UA。
- `except httpx.HTTPError as e:` 超时、连不上都是 `HTTPError` 的子类,一个 except 都接住,把异常类名当状态打印。
- `bad += not ok` `not ok` 是 True 或 False,加到整数上当 1 或 0。

</div>

```bash
uv run python -m part11.ex649_online part11/competitors.json
```

```text
ok  200  https://arize.com/docs/phoenix/prompt-engineering/overview-prompts/span-replay
ok  200  https://docs.langchain.com/langsmith/view-traces
ok  200  https://docs.langchain.com/oss/python/langgraph/use-time-travel
ok  200  https://forum.langchain.com/t/missing-compare-runs-is-this-a-bug-i-could-compare-2-runs-quickly-in-the-ui/839
ok  200  https://laminar.sh/docs/debugger
ok  200  https://laminar.sh/docs/debugger/caching
ok  200  https://langfuse.com/docs/observability/features/observation-types
ok  200  https://langfuse.com/docs/prompt-management/features/playground
ok  200  https://openai.github.io/openai-agents-python/tracing/
9 个出处,0 个打不开
```

我查资料时就碰到过一次失效:Laminar 的旧文档地址 `docs.laminar.sh/platform/debugger` 会跳到 `laminar.sh/docs/platform/debugger`,那一页已经是 404,现在的地址是 `laminar.sh/docs/debugger`。竞品表要隔几个月重查一次,文档地址也会变。

</details>

**练习 4:给表加一行。** 我查资料时还看到 JetBrains 在 PyCharm 2025.2 里出了一个 AI Agents Debugger 插件。去读它的官方介绍,给 `competitors.json` 加一行,三格都要有等级和出处,然后重跑检查器。

<details><summary>参考答案</summary>

我读的是 [PyCharm 2025.2 的 What's New 页面](https://www.jetbrains.com/pycharm/whatsnew/2025-2/),里面关于这个插件的原话是它提供「每个 agent 节点的思考过程、元数据、输入和输出」,标着 Pro(付费功能)。对比、重跑、上下文构成这三项,那一页都没提。所以我加的是:

```json
    "JetBrains AI Agents Debugger": {
      "逐步对比": {"level": "没查到", "note": "PyCharm Pro 插件,看每个节点的输入输出", "source": "https://www.jetbrains.com/pycharm/whatsnew/2025-2/"},
      "中途重跑整条": {"level": "没查到", "note": "", "source": "https://www.jetbrains.com/pycharm/whatsnew/2025-2/"},
      "上下文构成": {"level": "没查到", "note": "", "source": "https://www.jetbrains.com/pycharm/whatsnew/2025-2/"}
    }
```

加在 `"Laminar": {...}` 后面,别忘了 Laminar 那一块的右花括号后面要补一个逗号,JSON 不允许多逗号也不允许少逗号。重跑检查器,表多了一行,三项能力的统计结论不变。第三方网站上有人说它支持 LangGraph,但 JetBrains 自己那一页没写,我就没写进备注:竞品表只记一手来源。

</details>

**练习 5:亲手体验一个竞品。** 选 Langfuse(Day 365 接过)或 Laminar,把今天的 `weather_agent.py` 接进去跑一次,在它的界面里找出三件事各要点几下:看第 0 步模型调用的完整输入;比较两次运行;从中间某一步改提示词重跑。记在 `part11/runs/competitor_notes.md` 里,做不到的写「做不到」并附你查的文档页。

<details><summary>参考答案</summary>

这道题要注册账号、把 trace 发到第三方平台,我写这篇时没有实跑,下面是笔记应该长成的样子,你要换成自己点出来的结果:

```markdown
# Langfuse 体验(日期)
- 看第 0 步完整输入:trace 列表 → 点 trace → 点第一个 generation,(几)下。能看到 messages 和 tools 吗?
- 比较两次运行:(找到了 / 没找到,查的页面链接)
- 从中间重跑:generation 详情 → Open in Playground,只能重跑这一次调用,后面的工具调用不会跟着跑。
- 意外发现:(你注意到的任何一件文档里没写的事)
```

验收看两点:每一条都有「点了几下」或「做不到 + 链接」;至少有一条「意外发现」。Day 676 写 README 的「为什么做这个」时会直接用这份笔记,你亲手用过的体验比从文档里抄的有说服力。

</details>

**验收标准**:`weather_agent.py`、`traced_agent.py`、`waterfall.py`、`tool_share.py` 都能在 `agent-zero-lab/` 根目录用 `-m` 跑通,瀑布图能看出工具是首尾相接的;能用 `tool_share.py` 的减法解释第 0 步 310 个 token 从哪来;`check_competitors.py` 对你的表返回 0 个问题,并且你能说出哪一项是空白点、另外两项别人做到了但前提是什么;能在一分钟内回答「为什么不直接用 LangSmith」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| trace / 运行记录 | 一次 Agent 运行从头到尾的完整记录,由很多步组成。今天的 `weather_run.json` 就是一条最简陋的 trace |
| step / span / observation | trace 里的一步。OpenTelemetry 叫 span,Langfuse 叫 observation,Loupe 统一叫 step |
| 瀑布图(waterfall) | 每一步画一根横条,位置和长度按时间比例,一眼看出谁先谁后、谁在等谁。DevTools 的 Network 面板就是这种图 |
| 上下文构成 | 一次模型调用的输入 token 里,系统提示词、工具定义、历史、工具结果各占多少 |
| 竞品表 | 把几家工具按同一组能力逐格对比的表,每格要有等级和出处 |
| playground | 观测平台里单独调一次模型的页面,能改提示词和参数重跑 |
| replay(回放) | 用记录下来的结果代替真实执行,让一次运行能被重现 |
| fork(分叉) | 从某一步开始改了东西以后接着跑,产生一条新的运行 |
| time travel | LangGraph 的功能,回到某个 checkpoint 回放或分叉,之后的节点会真的重新执行 |
| Span Replay | Phoenix 的功能,把记录下来的一次模型调用搬进 playground 重跑 |
| ZDR(零数据保留) | 和模型厂商约定不保存请求数据。开了 ZDR 的组织用不了 OpenAI 的 Traces 面板 |

## 常见误区

**以为 Agent 慢就是模型慢。** 今天那次运行模型只占 11%,89% 是工具一个接一个在等网络。没有每一步的时间记录之前,我也是第一反应去换更快的模型。

**只看 usage 的总数。** `prompt_tokens: 310` 不会告诉你 272 个是工具定义。要知道构成,得自己做减法量,或者让工具帮你画出来。

**以为工具定义的 token 和 schema 长度成正比。** 在 deepseek-flash 上,只要传了 tools 就先有约 208 个 token 的固定开销,每个工具再加 64 左右。只有一个工具时,「工具很少所以不贵」是错的。

**用文件路径跑带 `from common...` 的脚本。** `uv run python part11/traced_agent.py` 会报 `ModuleNotFoundError: No module named 'common'`。在 `agent-zero-lab/` 根目录用 `-m part11.traced_agent` 跑。

**把各步时长直接相加当总耗时。** 工具一并行,`waterfall.py` 就算出了 191%。重叠的时间段要先合并再算。

**竞品调研只看自己知道的那几家。** 我如果只查了旧大纲里的四家,就会得出「中途重跑整条没人做」的结论,而 Laminar 已经做了。搜一下「agent debugger rerun from step」这种描述功能的词,比搜产品名更容易发现新玩家。

**把「没查到」写成「没有」。** 你只查了一页文档,不代表它没有这个功能。表里写「没查到」并留出处,被人指出来时你可以更新,而不是被抓住说谎。

**发现被做过了就放弃。** 作品集要的是你说得清区别和取舍,不是全世界独一份。今天的表让 Loupe 的定位从「没人做过」变成了「前提不同、取舍不同,外加一个真空白」,后者在面试里更站得住。

## 学习资料

### 文档与文章

- [Langfuse Playground 文档](https://langfuse.com/docs/prompt-management/features/playground):看「Open a generation in the playground」和「Side-by-Side Comparison View」两段,弄清楚它比的是什么、重跑的粒度是什么,15 分钟。
- [LangGraph:Use time travel](https://docs.langchain.com/oss/python/langgraph/use-time-travel):replay 和 fork 的区别,以及「之后的节点会真的重新执行」那句提醒,20 分钟。
- [Laminar:AI Agent Debugger](https://laminar.sh/docs/debugger) 和 [How Debugger Caching Works](https://laminar.sh/docs/debugger/caching):今天最值得细读的两页,尤其是「哈希不算系统消息」那一段,它和 Day 669 我们设计回放的键是同一个问题,20 分钟。
- [Arize Phoenix:Span Replay](https://arize.com/docs/phoenix/prompt-engineering/overview-prompts/span-replay):另一种单次调用重跑,10 分钟。
- [OpenAI Agents SDK:Tracing](https://openai.github.io/openai-agents-python/tracing/):看它把一次运行分成哪几类 span,和我们的 `kind` 对照,15 分钟。
- [LangChain 论坛:Missing "Compare Runs"](https://forum.langchain.com/t/missing-compare-runs-is-this-a-bug-i-could-compare-2-runs-quickly-in-the-ui/839):LangSmith 比较两条 trace 的入口在哪,5 分钟。这是论坛帖子,不是正式文档。
- [PyCharm 2025.2 What's New](https://www.jetbrains.com/pycharm/whatsnew/2025-2/):练习 4 用,找「AI Agents Debugger」那一段。

### B 站视频

- 老纪的技术唠嗑局《Agent 可观测性全解:Run、Trace、Thread 与生产评估闭环》已经嵌在正文里。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Fpxxz9ErH&autoplay=0&high_quality=1" title="AI智能体调试神器:LangSmith Studio使用全解析" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AIDeepCoder · AI智能体调试神器:LangSmith Studio使用全解析 · 10 分钟。看 LangSmith 这一侧调 LangGraph Agent 的体验长什么样,对照竞品表里 LangSmith 那一行。</figcaption>
</figure>

- 前端屎不了《Langfuse 到底是什么?LLM 监控、Trace 与历史记录一次讲清》(BV1nZ3Q6yEzk),11 分钟,做练习 5 之前看。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/2E8iTvGo9Hs" title="10 min Walkthrough of Langfuse – Open Source LLM Observability, Evaluation, and Prompt Management" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Langfuse 官方 · 10 min Walkthrough of Langfuse · 官方十分钟演示。注意它的 trace 详情页怎么布局,Loupe 的详情页会借鉴它,但把时间轴和上下文构成放到更显眼的位置。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/JF9VrfJWZ0o" title="Introducing the AI Agents Debugger" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>JetBrains for Data · Introducing the AI Agents Debugger · JetBrains 介绍 PyCharm 里的 Agent 调试插件。做练习 4 时看,注意它是在 IDE 里看,而不是在网页平台里看,这是另一种产品形态。</figcaption>
</figure>

### 书籍

- **Observability Engineering**,Charity Majors、Liz Fong-Jones、George Miranda,O'Reilly,2022。读第 1 章,理解「能回答你事先没想到的问题」才叫可观测。今天的瀑布图就是让你回答一个事先没想到的问题:慢在哪。约 40 分钟。
- **AI Engineering**,Chip Huyen,O'Reilly,2025。第 10 章讲 AI 应用的架构,其中监控与可观测一节列了该看哪些指标,和竞品表的三项能力对照,约 30 分钟。

### 开源项目与代码

- [langfuse/langfuse](https://github.com/langfuse/langfuse):看 README 的功能列表和截图。
- [Arize-ai/phoenix](https://github.com/Arize-ai/phoenix):另一个能自己部署的竞品,README 有快速启动命令。
- [lmnr-ai/lmnr](https://github.com/lmnr-ai/lmnr):Laminar 的开源仓库,Apache-2.0。重跑那部分的实现值得翻一下,Day 669 写回放时可以拿来对照。

## 自测

1. 今天那次运行花了 15.9 秒,为什么光看终端日志找不到原因?你加了什么才找到?

<details><summary>答案</summary>

日志只打印了「调用 get_weather(Beijing)」这种「调了什么」,没有每一步的开始和结束时间,也没有 token。给每一步记下 kind、name、相对起止时间和输入输出 token,再按时间比例画成瀑布图,才看到模型只占 11%,三次工具调用首尾相接占了 89%,而它们本可以同时跑。

</details>

2. 你怎么量出一次调用的输入里工具定义占多少 token?这个数字能直接拿到别的模型上用吗?

<details><summary>答案</summary>

做减法:同样的 messages 带工具调一次、不带工具调一次,`max_tokens=1` 只花输入的钱,两次 `prompt_tokens` 的差就是工具定义。今天是 310 − 38 = 272。不能直接搬到别的模型:不同厂商、不同模型的聊天模板不一样,deepseek-flash 上有约 208 个 token 的固定开销加每个工具 64 个左右,换一家要重新量。

</details>

3. 竞品表里「没查到」和「没有」有什么区别?为什么「没查到」也要写出处?

<details><summary>答案</summary>

「没查到」是我查了某一页文档没找到,「没有」是断言这个产品不具备这个功能。前者是诚实的观察,后者你通常没资格下。写出处是让别人能复核你查的是哪一页,如果别人在另一页找到了,你改表就行。今天的检查器要求每一格都有 `https://` 开头的出处,就是为了逼自己做到这一点。

</details>

4. LangGraph 的 time travel 和 Laminar 的 debugger 都能从中间重跑整条 Agent,它们在「什么会真的执行」上有什么不同?

<details><summary>答案</summary>

LangGraph 从 checkpoint 之后的节点全部真的重新执行,包括模型调用和 API 请求,checkpoint 之前的节点不重跑,结果已经存在状态里。Laminar 是边界之前的模型调用从录制里返回,边界之后全部真跑;它缓存的是模型回复,工具调用照常执行。所以如果边界后面有写操作(比如建退款单),两者都会真的执行。Loupe 打算反过来,工具结果默认回放、模型真跑。

</details>

5. 面试题:面试官说「这不就是 LangSmith 吗?你为什么要自己做一个?」你怎么回答?

<details><summary>答案</summary>

先承认:生产监控我会用 Langfuse 或 LangSmith,它们记录和看 trace 比我做得全,LangSmith 也能并排比两条 trace。再说前提和取舍:Loupe 不要求 Agent 用某个框架或 SDK,直接导入 trace 文件离线用;重跑时工具结果默认回放,所以带写操作的 Agent 也能安全地从中间重跑;它把每一步输入里工具定义、历史、工具结果各占多少画出来,这个我查了五家文档都没找到。最后给一个能验证的例子:我的天气 Agent 第 0 步 310 个 token 里 272 个是工具定义,在 Loupe 里一眼就能看到。

</details>

6. 面试题:你做竞品调研时发现自己原本以为的三个卖点有两个已经被别人做了。你会怎么调整项目?

<details><summary>答案</summary>

不改目标用户和核心问题(开发时调 Agent 看不清每一步),改定位的说法和优先级。真正的空白(上下文构成)提到最前面重点做;别人已有的两项(对比、重跑)保留,但明确写出和他们前提的不同(不绑框架、离线、工具回放),并在 README 里承认对方的强项、给出对方的链接。另外把调研结果写成带日期和出处的表放进仓库,以后定期重查。不该做的是装作没看见,或者干脆放弃。

</details>

## 明天预告

明天是 Day 650,第 93 周复习:作品(Day 644–649)。这一周从 Staff 系统设计的真题二、三走到影响力、开源、结业谈薪,今天又开了作品篇的头。明天把这六天串成一张图,默写本周最容易写错的两段代码,再拼一个只用本周知识的小工具:用今天的竞品表生成一段 30 秒的面试回答,并用 Day 647 的语速算法检查它是不是真的 30 秒。
</content>
</invoke>
