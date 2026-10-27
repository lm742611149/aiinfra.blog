---
title: 'Day 401 · 延迟:时间花在哪'
description: '一张工单从点发送到看到回复,等的是哪几段?今天给每次模型调用掐表,拆成首 token 延迟和生成时间,量出输出长度、提示词长度各自对时间的影响,再给整条流水线画瀑布图,比较串行、并行、把分类并进起草三种写法的 p50 和 p95,最后用 Day 400 的真实日志看尾部有多长。'
pubDate: 2026-10-27
regime: none
tags: ['latency', 'streaming', 'asyncio', 'agent-zero']
series: 'agent-zero'
day: 401
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 400](/blog/agent-zero/day-400-advisor/) 把成本这条线收了个尾:Advisor 让便宜模型干活、强模型只出一小段意见,实测比强模型单干省 17%,但便宜的 `deepseek-flash` 单干更省。那天最后留了个尾巴:每张工单里顾问那一次调用平均要 1.9 秒,执行模型一轮才 1.3 秒,多出来的是一次串行的往返。成本看的是 token,用户感受到的却是时间。今天不再算钱,只问一件事:一张工单从发出去到看到回复,这几秒钟花在了哪里,哪几段能压。

## 今天要解决的问题

今天结束时你应该能:

1. 把一次模型调用的耗时拆成两段:首 token 延迟(TTFT,发出请求到收到第一个字)和生成时间(之后一个字一个字吐出来),写一个流式计时的函数测出这两段和生成速度。
2. 用实验回答三个问题:输出多一倍,时间多多少;提示词长一倍,时间多多少;缓存命中能不能让回复变快。
3. 写一个给流水线各步骤掐表、画瀑布图的小工具,量出一条「分类、检索、查发票、起草」的工单流水线里时间主要花在哪。
4. 比较串行、并行、「分类并进起草」三种写法的 p50 和 p95,说清楚并行之后总时间取决于最长的那条链,并解释为什么平均值会骗人、该看 p95。

预计用时 2.5 小时。前置:[Day 133](/blog/agent-zero/day-133-sse-principle/) 和 [Day 134](/blog/agent-zero/day-134-streaming-code/) 的流式输出、[Day 68](/blog/agent-zero/day-068-async-3/) 的 `asyncio.gather`、[Day 397](/blog/agent-zero/day-397-prompt-caching/) 的 `policy.py`(今天直接用它当长提示词),以及 [Day 400](/blog/agent-zero/day-400-advisor/) 留下的 `logs/*.jsonl` 日志(最后一步读它)。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

今天所有计时都用 `deepseek-flash`,实验在 2026 年 10 月 27 日工作日中午前后做的,同一时段连着跑。延迟和网络、厂商当时的负载有关,你自己跑出来的数字不会和我的一样,**该比的是各行之间的相对关系**,别去对绝对值。另外流水线里的「知识库检索」和「查发票」是我用 `asyncio.sleep` 假的,文中会标出来,它们只是占一段时间的零件,不是真实的向量库。

## 先从前端看:Network 面板里的那条瀑布

你调过页面性能的话,对 Chrome DevTools 的 Network 面板里每个请求的那条横条不会陌生:鼠标放上去,条被切成几段,有「Waiting for server response」(也就是 TTFB,等第一个字节)和「Content Download」(下载内容)。模型调用的延迟是同样的结构,只是名字换了:

- **首 token 延迟(TTFT, time to first token)**:相当于 TTFB。请求发出去,经过网络、排队、模型读完你的提示词(叫预填充,prefill),吐出第一个字,这一段都算。
- **生成时间**:相当于 Content Download。第一个字之后,模型一个 token 接一个 token 地往外吐,吐多少就花多少时间。

整个页面还有一个「用户感知」的维度,前端叫 LCP(最大内容绘制)和 FCP(首次内容绘制):用户不在乎整个请求什么时候结束,在乎什么时候**看到东西**。模型调用也是:不流式的话,用户要等到「合计」才看到字;流式的话,用户在 TTFT 那一刻就开始看了。所以延迟优化永远是两个数:合计多久,首字多久。

<figure>
<svg viewBox="0 0 640 170" role="img" aria-label="一次模型调用的时间线:请求发出后依次是网络与排队、模型读提示词、第一个 token、一个字一个字生成,前三段合称首 token 延迟,后一段是生成时间,合计是两者之和。流式时用户在第一个 token 就开始看到字">
<text x="20" y="22" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">一次调用的时间线</text>
<rect x="20" y="40" width="70" height="26" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="55" y="57" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">网络+排队</text>
<rect x="90" y="40" width="90" height="26" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="135" y="57" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">读提示词 prefill</text>
<rect x="180" y="40" width="420" height="26" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="390" y="57" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">一个 token 接一个 token 生成</text>
<line x1="180" y1="30" x2="180" y2="100" stroke="var(--compute)" stroke-dasharray="3 3"/>
<text x="184" y="94" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">第一个字</text>
<path d="M 20 76 L 20 84 L 180 84 L 180 76" fill="none" stroke="var(--ink-soft)"/>
<text x="100" y="112" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">首 token 延迟</text>
<path d="M 180 76 L 180 84 L 600 84 L 600 76" fill="none" stroke="var(--ink-soft)"/>
<text x="390" y="112" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">生成时间 = 输出 token 数 ÷ 生成速度</text>
<text x="20" y="150" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">合计 = 首 token 延迟 + 生成时间。不流式,用户等到合计;流式,用户在第一个字就开始看</text>
</svg>
<figcaption>一次调用的耗时两段式。琥珀色虚线是第一个 token,左边的几段合称首 token 延迟,右边是生成时间。</figcaption>
</figure>

## 第一步:给一次调用掐表

要把这两段分开量,必须用流式:不流式的话,你只能拿到「请求开始」和「整个响应回来」两个时刻,看不到第一个字什么时候到的。流式调用用 `stream=True`,返回一个异步迭代器,每来一块数据就是一个 `chunk`,我们在第一个带文字的 `chunk` 到来时记一个时间。最小的脚本:

```python
# agent-zero-lab/part07/latency_peek.py
import asyncio
import os
import time

from dotenv import load_dotenv
from openai import AsyncOpenAI

load_dotenv()
client = AsyncOpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"], timeout=60, max_retries=0)
EXTRA = {"thinking": {"type": "disabled"}}


async def main() -> None:
    t0 = time.perf_counter()
    stream = await client.chat.completions.create(
        model="deepseek-flash",
        messages=[{"role": "user", "content": "用 80 字左右介绍一下发票和收据的区别。"}],
        stream=True,
        stream_options={"include_usage": True},
        extra_body=EXTRA,
    )
    t_first = None
    n_out = 0
    async for chunk in stream:
        if chunk.usage:
            n_out = chunk.usage.completion_tokens
        if t_first is None and chunk.choices and chunk.choices[0].delta.content:
            t_first = time.perf_counter() - t0
    total = time.perf_counter() - t0
    assert t_first is not None
    gen = total - t_first
    print(f"首 token {t_first:.2f}s  生成 {gen:.2f}s  合计 {total:.2f}s  输出 {n_out} token  速度 {n_out / gen:.0f} token/s")


asyncio.run(main())
```

<div class="line-notes">

- `client = AsyncOpenAI(` 和前几天一样的异步客户端,只是加了 `timeout=60, max_retries=0`:计时的时候不能让 SDK 悄悄重试,否则一次慢请求会被两次请求的时间加起来,数字就不对了。
- `EXTRA = {"thinking": {"type": "disabled"}}` 关掉 DeepSeek 的思考模式,否则首 token 前会先思考一大段,首 token 延迟会长得多,今天要量的是普通调用。
- `t0 = time.perf_counter()` 起点,在发请求**之前**取。`perf_counter` 是 Python 里量短时间的标准时钟,单位是秒,相当于 JS 的 `performance.now() / 1000`。
- `stream = await client.chat.completions.create(` 发请求。注意这里 `await` 等的只是「连接建立、开始收流」,不是整个回答。
- `stream=True,` 打开流式,服务器开始一块一块地推 SSE 事件([Day 133](/blog/agent-zero/day-133-sse-principle/) 看过原始格式)。
- `stream_options={"include_usage": True},` 流式下默认不返回 token 用量,加这一项以后,最后一块数据里会带 `usage`,我们才能知道输出了多少 token、算生成速度。
- `t_first = None` 第一个字到达的时刻,先留空。
- `async for chunk in stream:` 异步迭代,每收到一块就循环一次,相当于 JS 的 `for await (const chunk of stream)`。
- `if chunk.usage:` 只有最后一块带 `usage`,前面的块这个字段是 `None`。
- `if t_first is None and chunk.choices and chunk.choices[0].delta.content:` 三个条件都要满足:还没记过时间、这一块有 `choices`(最后那块带用量的块 `choices` 是空列表)、`delta.content` 非空(第一块有时只带角色、没有文字)。满足就是「第一个字到了」。
- `total = time.perf_counter() - t0` 循环结束,说明流收完了,这是合计。
- `assert t_first is not None` 一个字都没收到就是出错了,直接中断;同时让类型检查器知道下面 `t_first` 不是 `None`。
- `gen = total - t_first` 生成时间 = 合计减首 token 延迟。
- `print(f"首 token` 一行里给出两段、合计和速度:`n_out / gen` 就是每秒生成多少个 token。

</div>

```bash
cd agent-zero-lab
uv run python -m part07.latency_peek
uv run python -m part07.latency_peek
uv run python -m part07.latency_peek
```

```text
首 token 0.82s  生成 0.49s  合计 1.31s  输出 49 token  速度 100 token/s
首 token 0.75s  生成 0.66s  合计 1.41s  输出 63 token  速度 95 token/s
首 token 0.75s  生成 0.66s  合计 1.41s  输出 65 token  速度 99 token/s
```

三次相差不大。这个回答才 50 到 65 个 token,**首 token 延迟 0.75 秒,比后面的生成时间还长**。这一点要先记住:一次短回复里,等第一个字的时间往往比一个字一个字吐出来的时间还长,而这 0.75 秒里,真正「读提示词」的部分占多少,下面第三步再看。生成速度大约每秒 100 个 token,下一步的实验里,要「80 字左右」的回复实际输出约 64 个 token,所以这样一段回复的生成时间在 0.6 秒上下。

## 第二步:输出多一倍,时间多多少

把计时封装成一个能复用的函数,后面所有实验都要用它。它返回的不只是文字,还有两段耗时和 token 数:

```python
# agent-zero-lab/part07/timed.py
import os
import time
from dataclasses import dataclass

from dotenv import load_dotenv
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam

load_dotenv()
client = AsyncOpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"], timeout=60, max_retries=0)
EXTRA = {"thinking": {"type": "disabled"}}


@dataclass
class Timed:
    text: str
    ttft: float  # 从发出请求到收到第一个字,秒
    total: float  # 从发出请求到收完,秒
    n_in: int
    n_hit: int
    n_out: int


async def timed_call(messages: list[ChatCompletionMessageParam], max_tokens: int = 300, model: str = "deepseek-flash") -> Timed:
    t0 = time.perf_counter()
    stream = await client.chat.completions.create(
        model=model,
        messages=messages,
        max_tokens=max_tokens,
        stream=True,
        stream_options={"include_usage": True},
        extra_body=EXTRA,
    )
    parts: list[str] = []
    ttft = 0.0
    n_in = n_hit = n_out = 0
    async for chunk in stream:
        if chunk.usage:
            n_in = chunk.usage.prompt_tokens
            n_hit = getattr(chunk.usage, "prompt_cache_hit_tokens", 0) or 0
            n_out = chunk.usage.completion_tokens
        if chunk.choices and chunk.choices[0].delta.content:
            if not parts:
                ttft = time.perf_counter() - t0
            parts.append(chunk.choices[0].delta.content)
    return Timed("".join(parts), ttft, time.perf_counter() - t0, n_in, n_hit, n_out)
```

<div class="line-notes">

- `from dataclasses import dataclass` 数据类,[Day 50](/blog/agent-zero/day-050-dataclass/) 的老朋友,给一堆字段起个名字,比返回元组好读。
- `@dataclass` 装饰器,自动生成构造函数。
- `class Timed:` 一次计时调用的结果。
- `ttft: float  # 从发出请求到收到第一个字,秒` 首 token 延迟。
- `async def timed_call(messages: list[ChatCompletionMessageParam], max_tokens: int = 300, model: str = "deepseek-flash") -> Timed:` 以后所有计时脚本都调它:传消息、输出上限、模型。
- `t0 = time.perf_counter()` 和上一步一样的起点。
- `stream = await client.chat.completions.create(` 流式请求,参数和上一步一样,多了 `max_tokens`。
- `parts: list[str] = []` 把每一块的文字攒起来,最后拼成完整回复。
- `n_in = n_hit = n_out = 0` 一行给三个变量赋同一个初值 0,Python 的链式赋值。
- `async for chunk in stream:` 逐块读。
- `if chunk.usage:` 最后一块带用量,把输入 token、缓存命中 token、输出 token 都取出来。
- `n_hit = getattr(chunk.usage, "prompt_cache_hit_tokens", 0) or 0` Day 396 的老写法,DeepSeek 自己加的字段,用 `getattr` 取。
- `if chunk.choices and chunk.choices[0].delta.content:` 这一块有文字。
- `if not parts:` 列表还是空的,说明这是第一块有文字的数据,就是第一个字。
- `ttft = time.perf_counter() - t0` 记下首 token 延迟。
- `return Timed("".join(parts), ttft, time.perf_counter() - t0, n_in, n_hit, n_out)` 整个流读完,`total` 就是此刻减 `t0`。

</div>

第一个实验:同一个问题,要 20 字、80 字、200 字的回答,每种问 4 次取中位数。如果「合计 ≈ 首 token 延迟 + 输出 token 数 ÷ 速度」成立,输出越多,合计应该线性涨,首 token 延迟则应该不怎么变:

```python
# agent-zero-lab/part07/latency_len.py
import asyncio
import statistics

from part07.timed import timed_call


async def main() -> None:
    for chars in (20, 80, 200):
        rows = []
        for _ in range(4):
            r = await timed_call([{"role": "user", "content": f"用 {chars} 字左右介绍一下发票和收据的区别。"}], max_tokens=600)
            rows.append(r)
        ttft = statistics.median(r.ttft for r in rows)
        gen = statistics.median(r.total - r.ttft for r in rows)
        n_out = statistics.median(r.n_out for r in rows)
        print(f"要 {chars:>3} 字:输出 {n_out:>4.0f} token  首 token {ttft:.2f}s  生成 {gen:.2f}s  合计 {ttft + gen:.2f}s  ({n_out / gen:.0f} token/s)")


asyncio.run(main())
```

<div class="line-notes">

- `from part07.timed import timed_call` 用上面封装的计时函数。
- `for chars in (20, 80, 200):` 三种长度。
- `rows = []` 每种长度攒 4 次结果。
- `for _ in range(4):` 重复 4 次,因为单次计时有抖动,取中位数更稳。
- `r = await timed_call(` 提示词里写「用 N 字左右介绍……」,`max_tokens=600` 给得很宽,保证不被截断。
- `ttft = statistics.median(r.ttft for r in rows)` 4 次首 token 延迟的中位数。`statistics.median` 是标准库的中位数函数。
- `gen = statistics.median(r.total - r.ttft for r in rows)` 4 次生成时间的中位数。
- `n_out = statistics.median(r.n_out for r in rows)` 输出 token 数的中位数。
- `print(f"要 {chars:>3} 字` 一行输出,`{chars:>3}` 右对齐占 3 格。

</div>

```bash
uv run python -m part07.latency_len
```

```text
要  20 字:输出   20 token  首 token 0.67s  生成 0.22s  合计 0.89s  (90 token/s)
要  80 字:输出   64 token  首 token 0.63s  生成 0.57s  合计 1.20s  (111 token/s)
要 200 字:输出  124 token  首 token 0.55s  生成 1.21s  合计 1.75s  (102 token/s)
```

两个现象。首 token 延迟三行分别是 0.67、0.63、0.55 秒,没有随输出变长而变长,在抖动范围内可以认为是常数,大约 0.6 秒。生成时间则很干净地跟着输出 token 数走:20、64、124 个 token 对应 0.22、0.57、1.21 秒,速度都在 90 到 111 之间,大约每个 token 10 毫秒。所以这个模型上,合计时间 ≈ 0.6 秒 + 输出 token 数 × 0.01 秒。

这条公式很实用:**输出的 token 数,是你手里最直接的延迟旋钮。** 把回复从 124 个 token 压到 64 个,合计从 1.75 秒降到 1.20 秒,省 31%。OpenAI 的[延迟优化指南](https://developers.openai.com/api/docs/guides/latency-optimization)说「砍掉一半输出 token,大约能砍掉一半延迟」,这里的实测相符。这也解释了 [Day 399](/blog/agent-zero/day-399-model-routing/) 里把提示词从「80 字以内」改成「60 字以内」一举两得:既少了超长的错,也少了生成时间。

## 第三步:提示词长一倍呢,缓存能让它变快吗

输入这一头我们有个相反的怀疑:[Day 397](/blog/agent-zero/day-397-prompt-caching/) 把 2300 个 token 的规范放在最前面命中缓存,钱是省了,**时间**省了吗?模型读提示词(预填充)是要花时间的,缓存命中应该让这一段变短。设计三组对照:短提示词(16 个 token)、2.4k 的长提示词、12k 的超长提示词;长的两组各测「冷」(开头加一个随机编号,保证缓存不命中)和「热」(同一段提示词重复发,先预热一次,命中缓存)。

```python
# agent-zero-lab/part07/latency_prefix.py
import asyncio
import statistics
import uuid

from openai.types.chat import ChatCompletionMessageParam

from part07.policy import SYSTEM
from part07.timed import Timed, timed_call

ASK: ChatCompletionMessageParam = {"role": "user", "content": "客户问:发票抬头能改吗?请回复。"}


def msgs(system: str) -> list[ChatCompletionMessageParam]:
    return [{"role": "system", "content": system}, ASK]


def report(name: str, rows: list[Timed]) -> None:
    ttft = statistics.median(r.ttft for r in rows)
    print(f"{name:<14} 输入 {rows[0].n_in:>6} 命中 {statistics.median(r.n_hit for r in rows):>6.0f}  首 token 中位 {ttft:.2f}s")


async def run(label: str, system: str, n: int) -> None:
    cold = []
    for _ in range(n):
        salt = uuid.uuid4().hex  # 每次开头不一样,缓存一定不命中
        cold.append(await timed_call(msgs(f"编号 {salt}\n{system}"), max_tokens=60))
    report(f"{label}·冷", cold)

    await timed_call(msgs(system), max_tokens=60)  # 预热一次,不计入
    await asyncio.sleep(2)
    warm = [await timed_call(msgs(system), max_tokens=60) for _ in range(n)]
    report(f"{label}·热", warm)


async def main() -> None:
    short = [await timed_call([ASK], max_tokens=60) for _ in range(5)]
    report("短提示词", short)
    await run("2.4k 提示词", SYSTEM, 5)
    await run("12k 提示词", "\n\n".join([SYSTEM] * 5), 3)


asyncio.run(main())
```

<div class="line-notes">

- `ASK: ChatCompletionMessageParam = {"role": "user", "content": "客户问:发票抬头能改吗?请回复。"}` 每次都发同一个很短的问题,让变化只来自系统提示词。
- `def msgs(system: str) -> list[ChatCompletionMessageParam]:` 把系统提示词和问题拼成消息列表。
- `def report(name: str, rows: list[Timed]) -> None:` 打印一组结果。
- `ttft = statistics.median(r.ttft for r in rows)` 只看首 token 延迟,因为我们要看的是预填充的影响,生成时间和提示词长度无关。
- `print(f"{name:<14} 输入 {rows[0].n_in:>6} 命中` 输入多少 token,命中多少,首 token 中位数。
- `async def run(label: str, system: str, n: int) -> None:` 一组「冷、热」对照。
- `salt = uuid.uuid4().hex  # 每次开头不一样,缓存一定不命中` 在系统提示词**最前面**加一个随机编号。Day 397 讲过缓存是前缀匹配,开头变了,后面一模一样也命不中。`uuid4().hex` 生成一个 32 位的随机十六进制串。
- `cold.append(` 每次都带不同的编号。
- `report(f"{label}·冷", cold)` 冷组结果。
- `await timed_call(msgs(system), max_tokens=60)  # 预热一次,不计入` 先发一次让缓存建立,这一次不统计。
- `await asyncio.sleep(2)` 等两秒。Day 397 的预热实验也是先发一个、等一秒再发,缓存刚写入时立刻发可能还没命中。
- `warm = [` 重复发同一段提示词,这些应该命中缓存。
- `short = [await timed_call([ASK], max_tokens=60) for _ in range(5)]` 短提示词的基线,不带系统提示词。
- `await run("2.4k 提示词", SYSTEM, 5)` 2.4k 提示词就是 Day 397 的 `SYSTEM`,每组测 5 次。
- `await run("12k 提示词", "\n\n".join([SYSTEM] * 5), 3)` 把 `SYSTEM` 重复 5 遍拼成约 1.2 万 token,每组 3 次(这一组每次的输入有 1.2 万 token,按峰时价要花两分多钱,所以少测几次)。

</div>

```bash
uv run python -m part07.latency_prefix
```

```text
短提示词           输入     16 命中      0  首 token 中位 0.55s
2.4k 提示词·冷     输入   2377 命中      0  首 token 中位 0.46s
2.4k 提示词·热     输入   2356 命中   2176  首 token 中位 0.65s
12k 提示词·冷      输入  11733 命中      0  首 token 中位 0.94s
12k 提示词·热      输入  11712 命中  11520  首 token 中位 0.75s
```

这张表和我事先的预期不一样,值得停一下。**2.4k 的提示词,首 token 延迟和 16 个 token 的几乎没差别**(0.46 对 0.55 秒,差距在抖动之内,冷反而比热还快一点,这就是噪声)。到了 12k,冷的首 token 才涨到 0.94 秒,比短提示词多出约 0.4 秒;热的 0.75 秒,命中缓存后省了约 0.2 秒。

按这个数算,每多一千个输入 token,首 token 延迟大约多 30 到 40 毫秒;一段 2.4k 的提示词只贡献 0.1 秒左右,淹没在 0.5 秒的固定开销(网络、排队、调度)里。OpenAI 的指南里有一句同样的话:提示词砍掉一半,延迟可能只改善 1% 到 5%。结论有两条:

- **缓存主要是省钱的,对时间的帮助有限**,在提示词上万 token 的场景才看得出来(12k 时省了约 0.2 秒)。Day 397 的缓存对你的钱包重要,对用户的等待时间影响很小,别指望它解决「回复慢」。
- 嫌慢,先看输出有多长、调用有几次,不要先去砍提示词。

## 第四步:给整条流水线画瀑布图

单次调用拆清楚了,现在看一张工单整个流水线。要用的工具是一个小小的计时器:给每个步骤包一层 `with sp.span("名字"):`,记下开始和结束时刻,最后把它们画成文字瀑布图,功能上相当于 DevTools 的 Network 面板:

```python
# agent-zero-lab/part07/spans.py
import time
from contextlib import contextmanager
from dataclasses import dataclass, field


@dataclass
class Spans:
    t0: float = field(default_factory=time.perf_counter)
    rows: list[tuple[str, float, float]] = field(default_factory=list)  # (名字, 开始, 结束),都是相对 t0 的秒

    @contextmanager
    def span(self, name: str):
        start = time.perf_counter() - self.t0
        try:
            yield
        finally:
            self.rows.append((name, start, time.perf_counter() - self.t0))

    def render(self, width: int = 50) -> str:
        total = max(end for _, _, end in self.rows)
        lines = []
        for name, s, e in sorted(self.rows, key=lambda r: r[1]):
            a, b = round(s / total * width), max(round(e / total * width), round(s / total * width) + 1)
            lines.append(f"{name:<9}|{' ' * a}{'█' * (b - a)}{' ' * (width - b)}| {s:5.2f} → {e:5.2f}s")
        return "\n".join(lines)
```

<div class="line-notes">

- `@dataclass` 数据类,自动生成构造函数。
- `class Spans:` 一张工单的所有步骤计时。
- `t0: float = field(default_factory=time.perf_counter)` 字段 `t0` 的默认值不是一个固定数,而是**创建对象那一刻**调一次 `time.perf_counter()`。`field(default_factory=...)` 就是干这个的。如果直接写 `t0: float = time.perf_counter()`,默认值在类定义时就算好了,所有对象共用同一个起点,会错。
- `rows: list[tuple[str, float, float]] = field(default_factory=list)` 每一行是 (名字, 开始, 结束),时间都是相对 `t0` 的秒数。列表是可变对象,同样必须用 `default_factory`。
- `@contextmanager` 把下面这个生成器函数变成可以用 `with` 的上下文管理器,[Day 98](/blog/agent-zero/day-098-context-managers/) 学过。
- `def span(self, name: str):` 用法是 `with sp.span("draft"):`。
- `start = time.perf_counter() - self.t0` 进入 `with` 块时记开始时刻。
- `try:` 配合 `finally` 保证无论块里出没出错,结束时刻都会记。
- `yield` 到这里暂停,去执行 `with` 块里的代码,块结束(或出错)再回来。
- `finally:` 无论如何都执行的收尾。
- `self.rows.append(` 记下 (名字, 开始, 结束)。
- `def render(self, width: int = 50) -> str:` 画瀑布图,横条总宽 50 格。
- `total = max(end for _, _, end in self.rows)` 总时长是最晚结束的那一步。
- `for name, s, e in sorted(self.rows, key=lambda r: r[1]):` 按开始时间排序,先开始的在上面。
- `a, b = round(` 把开始、结束时刻换算成横条上的格子位置,`max(..., a + 1)` 保证再短的步骤也至少占一格,不会看不见。
- `lines.append(f"{name:<9}|` 一行:名字、竖线、空格补到开始位置、方块画出这一步的长度、右边补空、竖线、再把原始秒数写在最后。
- `return "\n".join(lines)` 拼成一个多行字符串。

</div>

然后是流水线本身,先看基线(串行)。四步:分类(真的调模型,只回一个词)、知识库检索(假的,睡 0.4 秒)、查发票(假的,睡 0.3 秒)、起草(真的调模型,带 Day 397 的 2.4k 规范,回 80 字以内)。

```python
# agent-zero-lab/part07/ticket_spans.py
import asyncio
import json
import statistics
import sys

from part07.policy import SYSTEM
from part07.spans import Spans
from part07.timed import timed_call

TICKETS = [
    "10 月 8 号被扣了两次款,INV-0123 那笔麻烦退给我",
    "导出 PDF 发票的时候页面一直转圈",
    "怎么把发票抬头改成公司名",
    "INV-0456 是重复扣费,申请退款",
    "登录以后看不到上个月的账单",
    "年付能不能开两张发票",
]


async def classify(text: str) -> str:
    r = await timed_call([{"role": "user", "content": f"把工单分成 billing/tech/other 之一,只回一个词:{text}"}], max_tokens=5)
    return r.text.strip()


async def kb_search(text: str) -> str:
    await asyncio.sleep(0.4)  # 假的知识库检索:真实系统里这里是向量库查询,今天只占个时间
    return "知识库:发票抬头可在「账户设置-开票信息」修改。"


async def lookup_invoice(text: str) -> str:
    await asyncio.sleep(0.3)  # 假的发票查询
    return json.dumps({"invoice": "INV-0123", "amount": "2392.00 元"}, ensure_ascii=False)


async def draft(text: str, facts: str) -> tuple[str, float]:
    r = await timed_call(
        [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"根据事实写一段不超过 80 字的中文回复,事实里没有的不要承诺。\n工单:{text}\n事实:{facts}"},
        ],
        max_tokens=200,
    )
    return r.text, r.ttft


async def serial(text: str) -> tuple[Spans, float]:
    """基线:四步一个接一个。返回计时和用户第一次看到字的时刻(秒)。"""
    sp = Spans()
    with sp.span("classify"):
        await classify(text)
    with sp.span("kb"):
        kb = await kb_search(text)
    with sp.span("invoice"):
        inv = await lookup_invoice(text)
    with sp.span("draft"):
        _, ttft = await draft(text, kb + inv)
    return sp, sp.rows[-1][1] + ttft
```

<div class="line-notes">

- `from part07.policy import SYSTEM` Day 397 建的那 2.4k token 的客服规范,起草用它当系统提示词。
- `from part07.spans import Spans` 上面的计时器。
- `TICKETS = [` 六张不同的工单,按序号轮着用,这样不是同一个问题反复问。
- `async def classify(text: str) -> str:` 分类,真调模型。`max_tokens=5`,只回 billing/tech/other 一个词。
- `async def kb_search(text: str) -> str:` 假的知识库检索。
- `await asyncio.sleep(0.4)  # 假的知识库检索:真实系统里这里是向量库查询,今天只占个时间` 用睡眠占一个固定的 0.4 秒。`asyncio.sleep` 会把控制权让出去,别的协程可以在这期间干活,所以并行时它不会拖累别人(如果写成同步的 `time.sleep`,整个事件循环都会卡住)。
- `async def lookup_invoice(text: str) -> str:` 假的查发票,占 0.3 秒。
- `async def draft(text: str, facts: str) -> tuple[str, float]:` 起草,真调模型,返回文字和首 token 延迟。
- `{"role": "system", "content": SYSTEM},` 2.4k 的规范放在最前面,Day 397 的规矩。
- `max_tokens=200,` 回复上限 200 个 token,正常 80 字以内用不满。
- `async def serial(text: str) -> tuple[Spans, float]:` 基线写法:四步一个接一个。返回计时和「用户第一次看到字」的时刻。
- `sp = Spans()` 每张工单一个计时器。
- `with sp.span("classify"):` 给这一步掐表。
- `await classify(text)` 分类的结果这里没用上,先不管,只是它占着时间。
- `kb = await kb_search(text)` 检索结果留下。
- `inv = await lookup_invoice(text)` 查发票结果留下。
- `_, ttft = await draft(text, kb + inv)` 起草用检索加发票作为事实,取回首 token 延迟。
- `return sp, sp.rows[-1][1] + ttft` 最后一行是 draft 的记录(`with` 块结束时才追加),它的开始时刻加上首 token 延迟,就是用户在流式下第一次看到字的时刻。

</div>

先跑 20 张,看一张中位数工单的瀑布图。`ticket_spans.py` 的后半部分(并行、合并)等一下再讲,这里先把命令的第一条跑了:

```bash
uv run python -m part07.ticket_spans serial 20
```

```text
serial    合计 p50 2.28s  p95 2.68s  首字 p50 1.95s
classify |█████████████                                     |  0.00 →  0.61s
kb       |             █████████                            |  0.61 →  1.01s
invoice  |                      ███████                     |  1.01 →  1.31s
draft    |                             █████████████████████|  1.31 →  2.28s
```

四个条首尾相接,总共 2.28 秒,一目了然:分类 0.61 秒、检索 0.40、查发票 0.30、起草 0.97。其中**两次模型调用占了 1.58 秒,占总时间的 69%**。两个假的工具加起来 0.7 秒,所以在真实系统里,如果检索是真的向量库(通常 50 到 200 毫秒),模型调用的占比还会更高。这和 [Day 396](/blog/agent-zero/day-396-cost-1/) 看账单时的发现是同一个:模型调用是大头,所以压延迟的第一件事永远是想办法**少调用、少等待**。

注意瀑布图里有一个浪费:分类和检索、查发票,其实互相不依赖。分类要的是工单文字,检索要的也是工单文字,查发票要的还是工单文字,它们没有理由排队。

## 第五步:并行,再把分类并进起草

改法有两个。第一个是并行:分类、检索、查发票互不依赖,用 `asyncio.gather` 同时发,三个都回来再起草。第二个更进一步:分类这次调用本来就只为了决定走哪条路,而起草的提示词里反正要读整张工单,让起草的那次调用顺便在第一行写出类别,分类这一次调用就省掉了。代码是 `ticket_spans.py` 的后半部分:

```python
# agent-zero-lab/part07/ticket_spans.py(节选)
async def parallel(text: str) -> tuple[Spans, float]:
    """分类、检索、查发票互不依赖,同时发。"""
    sp = Spans()

    async def tracked(name: str, coro):
        with sp.span(name):
            return await coro

    _, kb, inv = await asyncio.gather(
        tracked("classify", classify(text)), tracked("kb", kb_search(text)), tracked("invoice", lookup_invoice(text))
    )
    with sp.span("draft"):
        _, ttft = await draft(text, kb + inv)
    return sp, sp.rows[-1][1] + ttft


async def merged(text: str) -> tuple[Spans, float]:
    """分类并进起草:少一次模型调用,检索和查发票并行。"""
    sp = Spans()

    async def tracked(name: str, coro):
        with sp.span(name):
            return await coro

    kb, inv = await asyncio.gather(tracked("kb", kb_search(text)), tracked("invoice", lookup_invoice(text)))
    with sp.span("draft+分类"):
        r = await timed_call(
            [
                {"role": "system", "content": SYSTEM},
                {
                    "role": "user",
                    "content": "第一行只写类别(billing/tech/other 之一),从第二行起根据事实写一段不超过 80 字的中文回复,"
                    f"事实里没有的不要承诺。\n工单:{text}\n事实:{kb + inv}",
                },
            ],
            max_tokens=220,
        )
    return sp, sp.rows[-1][1] + r.ttft


VARIANTS = {"serial": serial, "parallel": parallel, "merged": merged}


async def main(name: str, n: int) -> None:
    runs = [await VARIANTS[name](TICKETS[i % len(TICKETS)]) for i in range(n)]
    totals = [max(e for _, _, e in sp.rows) for sp, _ in runs]
    firsts = [first for _, first in runs]
    q = statistics.quantiles(totals, n=20)
    print(f"{name:<9} 合计 p50 {statistics.median(totals):.2f}s  p95 {q[18]:.2f}s  首字 p50 {statistics.median(firsts):.2f}s")
    mid = sorted(range(n), key=lambda i: totals[i])[n // 2]
    print(runs[mid][0].render())


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], int(sys.argv[2])))
```

<div class="line-notes">

- `async def parallel(text: str) -> tuple[Spans, float]:` 并行版。
- `async def tracked(name: str, coro):` 一个小包装:给传进来的协程套上 `span` 掐表再执行。定义在函数里面,这样能直接用外层的 `sp`。`coro` 是一个还没开始跑的协程对象(`classify(text)` 这样调用只是造出协程,`await` 它才开始执行)。
- `with sp.span(name):` 进入时记开始,退出时记结束。
- `return await coro` 真正执行,并把结果原样返回。
- `_, kb, inv = await asyncio.gather(` 三个协程同时开始,全部结束才返回,结果**按传入顺序**排列。分类的结果我们用不上,赋给 `_`。这相当于 JS 的 `await Promise.all([...])`。
- `tracked("classify", classify(text)), tracked("kb", kb_search(text)), tracked("invoice", lookup_invoice(text))` 三个调用同时发出,各自掐表。三条横条会从同一个时刻 0 开始。
- `with sp.span("draft"):` 三个都回来以后再起草,起草依赖检索和发票两项结果,必须等。
- `return sp, sp.rows[-1][1] + ttft` 和串行版一样,最后一行是 draft。
- `async def merged(text: str) -> tuple[Spans, float]:` 合并版:没有单独的分类调用。
- `kb, inv = await asyncio.gather(tracked("kb", kb_search(text)), tracked("invoice"` 检索和查发票并行。
- `with sp.span("draft+分类"):` 起草这一步现在同时负责分类。
- `"content": "第一行只写类别(billing/tech/other 之一),从第二行起根据事实写一段不超过 80 字的中文回复,"` 在提示词里要求第一行写类别。真实系统里下游要读这一行解析出来,这里实验只计时,没有去解析它。
- `max_tokens=220,` 多留 20 个 token 给类别那一行。
- `return sp, sp.rows[-1][1] + r.ttft` 首字时刻同理。
- `VARIANTS = {` 三种写法放进字典,命令行按名字选。
- `async def main(name: str, n: int) -> None:` 跑 n 张工单,打印汇总。
- `runs = [await VARIANTS[name](TICKETS[i % len(TICKETS)]) for i in range(n)]` 一张接一张地跑(不是同时跑多张,否则互相抢带宽,量出来的不是单张的延迟)。`i % len(TICKETS)` 让六张工单轮着用。
- `totals = [max(e for _, _, e in sp.rows) for sp, _ in runs]` 每张工单的总时长:所有步骤里最晚的结束时刻。
- `firsts = [first for _, first in runs]` 每张工单用户第一次看到字的时刻。
- `q = statistics.quantiles(totals, n=20)` 把数据切成 20 份,返回 19 个切点,`q[18]` 就是第 95 百分位。
- `print(f"{name:<9} 合计 p50` 一行汇总:总时长的中位数和 p95,首字的中位数。
- `mid = sorted(range(n), key=lambda i: totals[i])[n // 2]` 找出总时长排在中间的那一张工单的序号。
- `print(runs[mid][0].render())` 把这一张的瀑布图画出来。
- `asyncio.run(main(sys.argv[1], int(sys.argv[2])))` 命令行两个参数:写法名和张数。

</div>

```bash
uv run python -m part07.ticket_spans parallel 20
uv run python -m part07.ticket_spans merged 20
```

```text
parallel  合计 p50 1.58s  p95 2.12s  首字 p50 1.33s
classify |████████████████████                              |  0.00 →  0.63s
kb       |█████████████                                     |  0.00 →  0.40s
invoice  |█████████                                         |  0.00 →  0.30s
draft    |                    ██████████████████████████████|  0.63 →  1.59s
merged    合计 p50 1.34s  p95 1.73s  首字 p50 1.03s
kb       |███████████████                                   |  0.00 →  0.40s
invoice  |███████████                                       |  0.00 →  0.30s
draft+分类 |               ███████████████████████████████████|  0.40 →  1.36s
```

三种写法放在一起,每种 20 张工单:

| 写法 | 合计 p50 | 合计 p95 | 首字 p50 |
| --- | --- | --- | --- |
| 串行 | 2.28 s | 2.68 s | 1.95 s |
| 并行 | 1.58 s | 2.12 s | 1.33 s |
| 分类并进起草 | 1.34 s | 1.73 s | 1.03 s |

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="三种写法的瀑布图对比。串行:分类、检索、查发票、起草首尾相接共 2.28 秒;并行:前三步同时开始,最长的分类 0.63 秒之后起草,共 1.58 秒;分类并进起草:检索和查发票并行 0.40 秒之后起草,共 1.34 秒">
<text x="20" y="20" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">同一张工单的三种写法(横轴:秒,每格约 0.5 秒)</text>
<text x="20" y="48" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">串行</text>
<rect x="110" y="36" width="132" height="16" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="242" y="36" width="86" height="16" fill="var(--compute-wash)" stroke="var(--compute)"/>
<rect x="328" y="36" width="65" height="16" fill="var(--compute-wash)" stroke="var(--compute)"/>
<rect x="393" y="36" width="209" height="16" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="606" y="48" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">2.28</text>
<text x="20" y="130" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">并行</text>
<rect x="110" y="96" width="136" height="16" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="110" y="114" width="86" height="16" fill="var(--compute-wash)" stroke="var(--compute)"/>
<rect x="110" y="132" width="65" height="16" fill="var(--compute-wash)" stroke="var(--compute)"/>
<rect x="246" y="96" width="209" height="16" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="459" y="108" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">1.58</text>
<text x="20" y="226" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">分类并进起草</text>
<rect x="110" y="192" width="86" height="16" fill="var(--compute-wash)" stroke="var(--compute)"/>
<rect x="110" y="210" width="65" height="16" fill="var(--compute-wash)" stroke="var(--compute)"/>
<rect x="196" y="192" width="209" height="16" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="409" y="204" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">1.34</text>
<text x="20" y="276" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">蓝色是模型调用(分类、起草),琥珀色是工具(检索、查发票,其中是假的)</text>
</svg>
<figcaption>并行让三条互不依赖的步骤从同一时刻开始,总时间由其中最长的一条(蓝色的分类)决定;再把分类并进起草,最长的就变成检索,那一条蓝色的横条整条消失。</figcaption>
</figure>

这张表里有三件事要看。

**并行省了 0.70 秒。** 串行时前三步是 0.61 + 0.40 + 0.30 = 1.31 秒,并行以后取最长的一条,0.63 秒,中间省下的 0.68 秒就是并行的收益。注意并行没有减少任何一次调用,token 数、花费一分不变,纯粹是把等待重叠起来。

**并行之后,总时间由「最长的那条链」决定,这叫关键路径。** 并行的三条里,分类(0.63 秒)是最长的,它决定了起草什么时候能开始。所以接下来再优化检索或查发票(0.40 和 0.30 秒),对总时间一点作用都没有,哪怕你把它们压到 0.01 秒,起草照样要等分类。这是并行优化里最容易犯的错:去优化不在关键路径上的那一段。看瀑布图找最长的那条,优化它。

**合并省了又一点,而且合并的效果取决于关键路径上谁是第二长。** 分类并进起草以后,三条里最长的那条(分类)没了,新的关键路径是检索(0.40 秒),起草提前了 0.23 秒开始(0.63 − 0.40),总时间从 1.58 降到 1.34 秒。如果检索本来要 1 秒,那合并分类就一点收益也没有,因为关键路径已经是检索了。所以合并之前先看瀑布图,不要凭「少一次调用总归更快」的直觉。

再看首字那一列。流式输出让用户在起草的第一个 token 就开始看,不用等整段写完。串行时首字 1.95 秒对合计 2.28 秒,只早了 0.33 秒,因为起草的回复很短(60 个 token 左右,生成时间 0.6 秒上下)。回复越长,流式省得越多:一段 400 个 token 的长回复,生成要 4 秒,用户从「等 5 秒」变成「等 1 秒就开始读」。三种写法叠加以后,首字从 1.95 降到 1.03 秒,不到原来的一半,这是用户真正感受到的那个数。

这些优化各有代价,不是白送的:

- **并行**会多花一些「可能白做」的功。如果查发票只对 billing 类工单有用,那 tech 类工单上的查发票就是白查(叫投机执行)。要权衡:白查一次的成本,对比省下的等待。
- **合并**把两个任务塞进一次调用,单个任务的质量可能下降,而且出了错不容易看出是分类错了还是起草错了。分类的结果如果还要被路由代码单独用,它就得被可靠地解析出来。合并以后要重新跑一遍评测([Day 399](/blog/agent-zero/day-399-model-routing/) 的 `draft_check` 那一套),确认没有变差。
- **流式**不缩短合计,只改善感知。如果下游不是人而是另一段代码(要等完整的 JSON 才能处理),流式就没有用。
- **缩短输出**是最便宜的一招,但要在提示词里要求短,不要靠 `max_tokens` 硬截断。

## 第六步:p50 和 p95,以及为什么平均值会骗人

前面所有表里我都同时给了 p50 和 p95。**p50 是中位数,一半的请求比它快;p95 表示 95% 的请求比它快,也就是最慢的那 5%**。为什么要看 p95:用户抱怨的从来不是平均速度,而是「怎么这次这么慢」。如果一百次里有五次特别慢,平均数几乎看不出来,可那五次的用户会走掉。

三种写法的 p95 比 p50 多出的比例是:串行 2.68 ÷ 2.28 = 1.18 倍,并行 2.12 ÷ 1.58 = 1.34 倍,合并 1.73 ÷ 1.34 = 1.29 倍。并行以后尾巴反而变厚了,道理不难:并行时总时间取各分支里**最慢的那个**,同时有几个分支,其中任意一个抽到慢的,整体就慢,概率比串行里单个步骤抽到慢大。(20 张工单的样本很小,p95 基本上就是第二慢的那张,别把 1.18 和 1.34 的差距当结论,这里只是示范怎么看。)

真正看到长尾,要用 Day 400 留下的日志。那些日志记了每次调用的耗时(`sec` 字段),写个脚本按「节点和模型」分组,算平均、p50、p95、最慢:

```python
# agent-zero-lab/part07/log_tail.py
import json
import statistics
import sys

for tag in sys.argv[1:]:
    secs: dict[str, list[float]] = {}
    for line in open(f"logs/{tag}.jsonl", encoding="utf-8"):
        for c in json.loads(line)["calls"]:
            secs.setdefault(f"{c['node']}:{c['model'].split('/')[-1]}", []).append(c["sec"])
    for name, xs in secs.items():
        q = statistics.quantiles(xs, n=20)
        print(f"{tag:<8} {name:<26} {len(xs):>4} 次  平均 {statistics.mean(xs):.2f}s  p50 {statistics.median(xs):.2f}s  p95 {q[18]:.2f}s  最慢 {max(xs):.2f}s")
```

<div class="line-notes">

- `for tag in sys.argv[1:]:` 命令行传几个日志标签就分析几个。
- `secs: dict[str, list[float]] = {}` 键是「节点:模型」,值是这一类调用的耗时列表。
- `for line in open(f"logs/{tag}.jsonl", encoding="utf-8"):` 每行是一张工单的完整记录。
- `for c in json.loads(line)["calls"]:` 每张工单里的每一次模型调用。
- `secs.setdefault(f"{c['node']}:{c['model'].split('/')[-1]}", []).append(c["sec"])` `setdefault(键, 默认值)` 在键不存在时先放一个空列表,再返回它,然后 `append`。`c['model'].split('/')[-1]` 把 `Qwen/Qwen3-14B` 这种带厂商前缀的名字截成最后一段 `Qwen3-14B`。
- `for name, xs in secs.items():` 每一类调用一行输出。
- `q = statistics.quantiles(xs, n=20)` 20 分位切点,`q[18]` 是 p95。
- `print(f"{tag:<8} {name:<26} {len(xs):>4} 次  平均` 打印:次数、平均、p50、p95、最慢。

</div>

```bash
uv run python -m part07.log_tail pro-f flash-f adv-f small-f
```

```text
pro-f    executor:deepseek-v4-pro    146 次  平均 1.87s  p50 1.54s  p95 3.78s  最慢 4.50s
flash-f  executor:deepseek-flash     138 次  平均 1.18s  p50 1.14s  p95 1.78s  最慢 2.12s
adv-f    executor:Qwen3-14B          167 次  平均 1.33s  p50 1.20s  p95 3.11s  最慢 7.80s
adv-f    advisor:deepseek-v4-pro      48 次  平均 1.91s  p50 2.10s  p95 2.49s  最慢 2.73s
small-f  executor:Qwen3-14B          195 次  平均 2.55s  p50 2.23s  p95 4.72s  最慢 7.87s
```

这几行都是真实的长尾。`deepseek-v4-pro` 的执行调用:平均 1.87 秒,p50 才 1.54 秒,p95 到了 3.78 秒,是中位数的 2.5 倍,最慢 4.5 秒;平均数比中位数高 0.33 秒,就是那几个慢请求把均值拽上去的。Qwen3-14B 更夸张,p50 1.20 秒,最慢 7.8 秒,那是撞上了硅基流动的 429 限速,SDK 自己退避重试了几次,单次调用里藏了好几次等待。

这对你设计系统有两个直接影响。**一是超时要按 p95 以上设,不要按平均。** [Day 392](/blog/agent-zero/day-392-timeouts/) 讲过超时要分层,每一层比上一层短;而最里面那一层(单次模型调用)的超时,要大于 p99 左右才不会误杀正常请求,pro 这样的模型 90 秒超时是宽的,15 秒也够,但 3 秒肯定不行。**二是 Advisor 这种多一次往返的结构,延迟要看分位数。** 顾问调用 p50 2.10 秒,执行模型一轮 1.20 秒;一张工单平均 0.92 次顾问调用、3.2 轮执行,串起来:约 3.2 × 1.33 + 0.92 × 1.91 ≈ 6.0 秒(用平均数估的),比 flash 单干(2.7 轮 × 1.18 ≈ 3.2 秒)慢一倍,这个账 Day 400 没有算,今天补上:Advisor 多花的不只是钱。练习 3 会让你把这一条画成瀑布图,看顾问占了总时间的三分之一。

## 延迟的优化清单,和今天的数字对一遍

OpenAI 的延迟指南列了七条原则,我把今天的实测按它的顺序对上:

| 原则 | 今天的实测 |
| --- | --- |
| 让 token 处理得更快(换小模型) | flash 每轮 1.18 秒,pro 每轮 1.87 秒,差 0.7 秒,但换模型会影响质量,要评测 |
| 少生成 token | 输出从 124 降到 64 个 token,合计 1.75 → 1.20 秒,省 31% |
| 少输入 token | 2.4k 提示词对首 token 几乎没影响,12k 才多约 0.4 秒;缓存命中省约 0.2 秒 |
| 少发请求(合并) | 分类并进起草,1.58 → 1.34 秒 |
| 并行 | 2.28 → 1.58 秒;5 张起草同时发,4.44 → 1.03 秒(练习 2) |
| 让用户少等(流式) | 首字 1.95 → 1.03 秒(叠加并行和合并) |
| 不要默认用 LLM | 分类这种一个词的活,可以先试规则或小分类器,查表的延迟是微秒 |

排序上我的经验是:先画瀑布图,找关键路径;再看关键路径上有没有可以砍的调用(合并、换规则);然后并行;再缩短输出;流式几乎是免费的,能开就开;换小模型放最后,因为它动的是质量。

## 零件和今天的文件对照

| 零件 | 文件 | 回答什么问题 |
| --- | --- | --- |
| `latency_peek.py` | 一次调用 | 首 token 延迟和生成时间各多少 |
| `timed.py` | 计时函数 | 后面所有实验共用的流式计时 |
| `latency_len.py` | 输出长度实验 | 输出多一倍,时间多多少 |
| `latency_prefix.py` | 提示词长度和缓存实验 | 输入多一倍、缓存命中,时间变不变 |
| `spans.py` | 步骤计时器和瀑布图 | 一张工单的时间花在哪几步 |
| `ticket_spans.py` | 三种写法 | 串行、并行、合并的 p50/p95/首字 |
| `log_tail.py` | 读 Day 400 的日志 | 真实调用的长尾有多长 |

## 动手练习

### 练习 1:`max_tokens` 能当调速旋钮吗

同一个问题「用 200 字左右介绍一下发票和收据的区别」,`max_tokens` 分别设 600、60、30,各测 4 次取合计的中位数,同时把回复的结尾字打印出来。看时间省了多少,以及回复变成了什么样。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part07/latency_cap.py
import asyncio
import statistics

from part07.timed import timed_call

ASK = "用 200 字左右介绍一下发票和收据的区别。"


async def main() -> None:
    for cap in (600, 60, 30):
        rows = [await timed_call([{"role": "user", "content": ASK}], max_tokens=cap) for _ in range(4)]
        total = statistics.median(r.total for r in rows)
        print(f"max_tokens={cap:<4} 输出 {rows[0].n_out:>3} token  合计中位 {total:.2f}s  结尾:「{rows[0].text[-12:]}」")


asyncio.run(main())
```

<div class="line-notes">

- `ASK = "用 200 字左右介绍一下发票和收据的区别。"` 提示词没有变,变的只有 `max_tokens`。
- `for cap in (600, 60, 30):` 600 是宽松上限(模型自己写完会停),60 和 30 是硬截断。
- `rows = [await timed_call([{"role": "user", "content": ASK}], max_tokens=cap) for _ in range(4)]` 列表推导式里直接 `await`,在 `async def` 里是允许的,4 次一个接一个地跑。
- `total = statistics.median(r.total for r in rows)` 合计的中位数。
- `rows[0].n_out` 和 `rows[0].text[-12:]` 取第一次的输出 token 数和最后 12 个字。`[-12:]` 是切片,从倒数第 12 个字到末尾,JS 里是 `.slice(-12)`。

</div>

```text
max_tokens=600  输出 102 token  合计中位 1.81s  结尾:「，收据是“收付款证明”。」
max_tokens=60   输出  60 token  合计中位 1.22s  结尾:「部收据和外部收据，通常仅」
max_tokens=30   输出  30 token  合计中位 0.87s  结尾:「经营活动中的购销行为，是」
```

时间确实降了(1.81 → 1.22 → 0.87 秒),可回复被拦腰斩断,「通常仅」「是」后面什么都没有。`max_tokens` 是保险丝,防止模型失控写个没完;它不是调速旋钮,想要短的回复,要在提示词里写「60 字以内」让模型自己写完整,而不是写到一半被掐掉。顺便注意,要 200 字的提示词下模型只输出了 102 个 token,也就是说它自己就没写满。

</details>

### 练习 2:同时发 5 张工单的起草

用 `ticket_spans.py` 里的 `draft` 函数,先一张接一张起草 5 张,再用 `asyncio.gather` 同时发 5 张,比较总耗时。想一想:同时发 50 张会怎样?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part07/latency_burst.py
import asyncio
import time

from part07.ticket_spans import TICKETS, draft


async def main() -> None:
    t0 = time.perf_counter()
    for text in TICKETS[:5]:
        await draft(text, "发票 INV-0123,金额 2392.00 元")
    print(f"一张接一张:5 张共 {time.perf_counter() - t0:.2f}s")

    t0 = time.perf_counter()
    await asyncio.gather(*(draft(text, "发票 INV-0123,金额 2392.00 元") for text in TICKETS[:5]))
    print(f"同时发:    5 张共 {time.perf_counter() - t0:.2f}s")


asyncio.run(main())
```

<div class="line-notes">

- `from part07.ticket_spans import TICKETS, draft` 复用上面的六张工单和起草函数。`ticket_spans.py` 末尾有 `if __name__ == "__main__":` 保护,导入它不会触发那段命令行逻辑。
- `t0 = time.perf_counter()` 第一段计时起点。
- `for text in TICKETS[:5]:` 前 5 张,`await` 在循环里,一张结束才开始下一张。
- `await asyncio.gather(*(draft(text,` 生成器造出 5 个协程,`*` 展开成 5 个参数,`gather` 同时发出,全部回来才返回。
- `print(f"同时发:    5 张共 {time.perf_counter() - t0:.2f}s")` 第二段计时的结果。

</div>

```text
一张接一张:5 张共 4.44s
同时发:    5 张共 1.03s
```

4.44 秒降到 1.03 秒,约 4.3 倍,接近 5 倍的理想值。每张起草单独看还是要 1 秒左右,并发没有让**单张**变快,是让 5 张**一起**完成。同时发 50 张就会撞上限速([Day 128](/blog/agent-zero/day-128-rate-limit/) 讲的 RPM/TPM,今天 Day 400 里硅基流动 14B 就是被 429 打回来的),超出的请求会被拒绝或要排队重试,总时间不再线性下降,所以大批量时要用 `Semaphore` 限并发,把并发压在厂商允许的范围内。

</details>

### 练习 3:把 Day 400 的 Advisor 画成瀑布图

用今天的 `Spans.render()`,把 Day 400 里「执行 1.3 秒、1.3 秒,顾问 1.9 秒,执行 1.3 秒」这一张工单画出来,算顾问占总时间的比例。不用调 API。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part07/render_demo.py
from part07.spans import Spans

# Day 400 里带顾问的一张工单,用日志里的平均耗时手工摆一遍:执行 1.3s、1.3s,顾问 1.9s,执行 1.3s
sp = Spans()
sp.rows = [
    ("executor1", 0.0, 1.3),
    ("executor2", 1.3, 2.6),
    ("advisor", 2.6, 4.5),
    ("executor3", 4.5, 5.8),
]
print(sp.render())
print(f"顾问占总时间的 {(4.5 - 2.6) / 5.8 * 100:.0f}%")
```

<div class="line-notes">

- `sp = Spans()` 造一个计时器。
- `sp.rows = [` 不走 `with` 掐表,直接把四行 (名字, 开始, 结束) 填进去。`Spans` 是普通数据类,`rows` 可以直接赋值。
- `("advisor", 2.6, 4.5),` 顾问那一段 1.9 秒,从 2.6 秒开始。
- `print(sp.render())` 画图。
- `print(f"顾问占总时间的 {(4.5 - 2.6) / 5.8 * 100:.0f}%")` 1.9 ÷ 5.8 = 32.8%。

</div>

```text
executor1|███████████                                       |  0.00 →  1.30s
executor2|           ███████████                            |  1.30 →  2.60s
advisor  |                      █████████████████           |  2.60 →  4.50s
executor3|                                       ███████████|  4.50 →  5.80s
顾问占总时间的 33%
```

一次顾问调用占了总时间的三分之一,而且它是串行的:顾问在想的时候,执行模型什么也干不了。Anthropic 的文档里写了同样的事:顾问子推理不流式,执行模型的流在这期间暂停,每 30 秒左右发一个 `ping` 保活。想压这一段,办法是让顾问简短(输出越短生成越快),以及少问几次。

</details>

### 练习 4:合并分类的风险

今天把分类并进了起草,合计少了 0.24 秒。写出三个你上线前要先验证的问题,以及怎么验证。这是开放题,没有实跑。

<details><summary>参考答案</summary>

一、**类别还准吗。** 起草的提示词变复杂了,分类可能变差。验证:拿一批有标准类别的工单,分别用独立分类和合并后的第一行出来的类别比准确率,用 [Day 399](/blog/agent-zero/day-399-model-routing/) 的 8 张或更大的测试集。

二、**起草质量掉了没有。** 多了「第一行写类别」的要求,回复可能会受影响(比如把类别词带进回复里,或者第一行格式乱了解析不出来)。验证:用 `draft_check` 的规则检查通过率对比合并前后,并统计第一行解析失败的比例。

三、**关键路径真的变短了吗。** 合并只有在分类是关键路径上最长那条的时候才有收益。验证:换成真实的检索(不是 `asyncio.sleep`)后重新画瀑布图,如果检索本来就比分类慢,合并就白做了,还白担了前两个风险。

验证的顺序也有讲究:先画瀑布图确认有收益(第三问),再测质量(前两问),最后才改代码。

</details>

**验收标准**:能说清首 token 延迟和生成时间各由什么决定,并用 `latency_len.py` 的数字说出输出每多 100 个 token 大约多几百毫秒;能解释为什么 2.4k 的提示词几乎不影响首 token 延迟;能指着一张瀑布图找出关键路径,并说出优化不在关键路径上的步骤为什么没用;能解释并行后 p95 反而可能变厚。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 延迟(latency) | 从发出请求到收到结果的时间。模型调用里要分开看首 token 延迟和合计 |
| TTFT(首 token 延迟) | 从发出请求到收到第一个 token 的时间,包括网络、排队和读提示词,相当于 DevTools 里的 TTFB |
| 预填充(prefill) | 模型读完整个输入提示词的阶段,输入越长越久,但在几千 token 以内被固定开销淹没 |
| 生成速度 | 模型每秒输出多少个 token。本次 `deepseek-flash` 约每秒 100 个,每个约 10 毫秒 |
| 瀑布图 | 把每个步骤画成一条横条,横轴是时间,一眼看出谁先谁后、谁在等谁 |
| 关键路径 | 并行的几条链里最长的那一条,它决定总时间。优化不在关键路径上的步骤,总时间不会变 |
| 投机执行 | 不确定要不要做,先做了再说。并行里「先查发票,不管是不是账单类」就是一例,猜错了就白做 |
| 分位数(p50/p95) | p50 是中位数,p95 表示 95% 的请求不超过这个值。看长尾要看 p95 甚至 p99,而不是平均数 |
| 长尾 | 少数特别慢的请求,把 p95、p99 拉得远高于 p50 |
| 流式的「感知延迟」 | 用户看到第一个字的时间。流式不缩短合计,但把等待变成首字延迟 |

## 常见误区

**用平均数看延迟。** `deepseek-v4-pro` 的执行调用平均 1.87 秒,p95 却是 3.78 秒,最慢 4.5 秒。设超时、定 SLA 都要看 p95 以上。

**先去砍提示词。** 2.4k 的提示词对首 token 延迟几乎没影响,砍一半最多省百来毫秒。先看输出有多长、调用有几次。

**以为缓存能让回复变快。** 12k 的提示词命中缓存,首 token 只省了约 0.2 秒;2.4k 时看不出差别。缓存是省钱的工具,对时间只有很小的帮助。

**优化不在关键路径上的步骤。** 并行之后,检索 0.40 秒、查发票 0.30 秒再怎么压,总时间都由 0.63 秒的分类决定。先画瀑布图。

**计时的时候让 SDK 悄悄重试。** 默认重试两次,一次慢请求会变成两次请求的时间加起来,量出来的是错的。计时时 `max_retries=0`。

**并行跑多张工单去测单张延迟。** 同时跑会互相抢带宽和限速,量出来的是排队时间。测单张延迟要一张接一张。

**用 `max_tokens` 控制回复长度。** 回复会被拦腰斩断。长度要靠提示词,`max_tokens` 只做保险。

**把 `time.sleep` 写进异步函数。** 同步的睡眠会卡住整个事件循环,并行就失效了。假延迟要用 `await asyncio.sleep`。

## 学习资料

### 文档与文章

- [OpenAI · Latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization):七条延迟优化原则,今天最后那张表照它的结构对的。英文,15 分钟。
- [Anthropic · Reducing latency](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-latency):Claude 这边的延迟指南,讲了选模型、缩短提示词和输出、流式。英文,10 分钟。
- [Chrome DevTools · Network 面板参考](https://developer.chrome.com/docs/devtools/network/reference):前端熟悉的瀑布图和 Timing 分段,今天的 `Spans.render()` 就是它的文字版。
- [web.dev · Time to First Byte (TTFB)](https://web.dev/articles/ttfb):TTFB 在网页里怎么拆、怎么优化,和模型的 TTFT 思路一致。英文。
- [Nielsen Norman Group · Response Times: The 3 Important Limits](https://www.nngroup.com/articles/response-times-3-important-limits/):0.1 秒、1 秒、10 秒三个界限的经典文章,解释了为什么「首字」比「合计」更要紧。英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1gMj16pEcR&autoplay=0&high_quality=1" title="Agent响应太慢怎么办?五套实操优化方案,剪枝、缓存、大小模型搭配,轻松大幅降低推理延迟" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI产品果果姐 · Agent响应太慢怎么办?五套实操优化方案 · 约 14 分钟。把「少调用、缓存、大小模型搭配」几招讲了一遍,看的时候对照今天的实测:缓存对延迟帮助有限,并行和合并才是大头。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/7tl9ivyLsLw" title="Optimizing Time to First Token (TTFT) with LLM Streaming" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>learnwithparam · Optimizing Time to First Token (TTFT) with LLM Streaming · 英文。讲流式怎么降低感知的首字延迟,对应第五步里首字那一列。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/XD8DD4cEHu0" title="The First-Token Latency Problem in LLMs" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Outcome School · The First-Token Latency Problem in LLMs · 英文。解释首 token 延迟里预填充、排队等因素各占多少,和第三步的实验互相印证。</figcaption>
</figure>

### 书籍

- 《AI Engineering: Building Applications with Foundation Models》,Chip Huyen,O'Reilly,2025。讲推理优化和延迟指标(TTFT、TPOT、吞吐)的一章,和今天的拆法一致。英文原版,我没查到正式出版的中译本。
- 《Designing Data-Intensive Applications》,Martin Kleppmann,O'Reilly,2017(第一版)。第 1 章「Describing Performance」讲为什么要看百分位数而不是平均数,和今天第六步是同一个道理。英文原版,中译本我没核实,不写具体版本。

### 开源项目与代码

- [openai/openai-python](https://github.com/openai/openai-python):今天用的 SDK,流式调用和 `stream_options` 的类型定义在里面。
- [DeepSeek API 文档 · 模型与价格](https://api-docs.deepseek.com/quick_start/pricing):flash 和 pro 的价格与峰谷时段。

## 自测

1. 一次流式调用的合计是 1.4 秒,首 token 延迟 0.75 秒,输出 65 个 token,生成速度大约多少?

<details><summary>答案</summary>

生成时间 = 1.4 − 0.75 = 0.65 秒,速度 = 65 ÷ 0.65 = 100 token/秒。

</details>

2. 为什么 2.4k 的提示词对首 token 延迟几乎没影响,12k 才有?

<details><summary>答案</summary>

首 token 延迟由固定开销(网络、排队、调度,今天实测约 0.5 秒)加上读提示词的时间组成。读提示词的时间每千 token 只有 30 到 40 毫秒,2.4k 时贡献约 0.1 秒,被固定开销和测量抖动淹没;12k 时贡献约 0.4 秒,才看得出来。

</details>

3. 并行三个步骤(0.63 秒、0.40 秒、0.30 秒)后,把最短的那个步骤优化到 0.1 秒,总时间变不变?

<details><summary>答案</summary>

不变。并行以后总时间由最长的那一步决定(0.63 秒),这条链叫关键路径。优化不在关键路径上的步骤,总时间纹丝不动。要先把最长的那一条压下去,或者像今天那样把它整条去掉。

</details>

4. 为什么平均延迟 1.87 秒的服务,超时不能设成 2 秒?

<details><summary>答案</summary>

平均数被快请求和慢请求中和了,p95 是 3.78 秒,最慢 4.5 秒。超时设成 2 秒会把大量正常的请求误杀,超时应该按 p99 之上设,并且最内层的超时仍然要比外层的短(Day 392 的分层)。

</details>

5. (面试题)用户反馈 Agent 回复太慢,P95 要 12 秒。你怎么排查和优化?

<details><summary>答案</summary>

参考答法:先量,不猜。给每一步掐表,画瀑布图,看这 12 秒的 p95 请求里时间花在哪几段:模型调用几次、每次首 token 延迟和生成时间各多少、工具和检索多长、有没有重试和限速。接着找关键路径,优化那条最长的链。常见的顺序:合并不必要的串行模型调用,没有依赖的步骤并行,缩短输出(在提示词里要求短,不靠截断),开启流式把用户的等待变成首字延迟,最后才考虑换更小的模型。同时要处理长尾:看 p95 为什么比 p50 高很多,是限速重试、某类工单的输出特别长,还是某个下游偶尔慢,按原因分别处理。每一项改动都要用同一批样本验证质量没有下降,而且要讲清楚改完以后 p50、p95、首字各是多少。我自己做过的一个例子里,串行 2.28 秒的流水线,并行加合并后降到 1.34 秒,首字从 1.95 降到 1.03 秒。

</details>

6. 流式输出能缩短合计时间吗?它的价值在哪?

<details><summary>答案</summary>

不能,合计时间不变。它把用户的等待从「合计」变成「首 token 延迟」,用户在第一个字到达时就开始读。回复越长,这个差距越大。如果下游是需要完整结果的代码(比如要等完整的 JSON),流式没有价值。

</details>

## 明天预告

Day 402 · 批处理、语义缓存和 Agent 经济学。今天压的是「一张工单要等多久」,明天换到「一万张工单怎么便宜地处理」:不赶时间的任务可以排队、错峰、用批处理接口(官方说半价);重复的问题能不能不调模型直接回答(语义缓存,以及为什么在客服场景要非常小心);最后把前面四天(成本和延迟)的数字拼成一张 ROI 表,算一算这个 Agent 到底省了公司多少钱。
