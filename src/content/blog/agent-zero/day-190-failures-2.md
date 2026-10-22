---
title: 'Day 190 · 失败模式(二):重试和 tenacity'
description: '只重试临时错误,重试前要等,等的时间指数增长再加一点随机。先手写一个重试循环看清它在干什么,再模拟一千个客户端同时被 429:不加抖动,第 1 秒那一刻挤进 1000 个请求;加了抖动,最挤的 0.1 秒只有 111 个。然后用 tenacity 的 @retry 四个参数写出 chat_with_retry,本地起一个永远回 429 的假服务,数出 SDK 和 tenacity 两层重试叠在一起会发 16 个请求,关掉一层只剩 4 个。'
pubDate: 2026-10-23
regime: none
tags: ['reliability', 'retry', 'tenacity', 'agent-zero']
series: 'agent-zero'
day: 190
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 189](/blog/agent-zero/day-189-failures-1/) 把 Agent 的失败分成三层九类,然后拿 Day 170 的 `run_agent` 挨个撞了一遍,得到一份体检报告。报告第一行写着:**模型 API 临时错误,没有接住,直接崩**。连不上服务器的那次,`run_agent` 抛出 `openai.APIConnectionError`,整个任务连同前面几步查到的东西一起丢了。

那天还发现一个细节:连不上的那次花了 3.6 秒才抛异常,写错 key 的那次只花了 0.2 秒。原因是 `LLMClient` 里的 OpenAI SDK 已经悄悄重试过三次,而 401 它不重试。今天就从这里接着讲:哪些错误该重试,重试前等多久,怎么用 tenacity 写,以及 SDK 自己那层重试怎么和我们这层相处。

## 今天要解决的问题

学完你应该能:

1. 说出哪些错误该重试(连不上、超时、429、5xx)、哪些不该(400、401、403、404、422),并能解释原因。
2. 说清「指数退避加抖动」是什么,用一个模拟脚本证明不加抖动时重试会挤在同一刻。
3. 用 tenacity 的 `@retry` 写出带四个参数(`retry`、`wait`、`stop`、`reraise`)的重试,说出每个参数管什么、不写会怎样。
4. 知道 OpenAI SDK 自己会重试,两层叠加时请求数是乘出来的,并能用测试证明你的重试「会等、会停、不该重试的不重试」。

今天两个新概念:**指数退避加抖动**和 **tenacity 的 `@retry`**。

预计用时 2.5 小时。前置:[Day 189](/blog/agent-zero/day-189-failures-1/)(三层九类、`failure_zoo.py`、`failure_classify.py`)、[Day 135](/blog/agent-zero/day-135-llm-client-1/)(`LLMClient` 和它的 `max_retries`)、[Day 96](/blog/agent-zero/day-096-decorators/)(装饰器)、[Day 74](/blog/agent-zero/day-074-pytest-4/)(假对象和 monkeypatch)。代码在 `agent-zero-lab/part03/` 和 `agent-zero-lab/tests/`,命令都在 `agent-zero-lab/` 根目录跑。**今天花了 ¥0.0004**:只有一次真的调 DeepSeek,其余全是本地模拟、假服务和假模型。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `part03/retry_llm.py` 里 `@retry(...)` 那四行参数,以及 `tests/test_retry_llm.py` 里 `waits` 那个 fixture;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 哪些错误该重试

先从前端的经验说起。你在 DevTools 的 Network 面板里见过各种状态码。如果一个请求返回 503(服务暂时不可用),你刷新一下多半就好了;如果返回 401(没登录),你刷新一百次还是 401,得去重新登录。重试这件事的全部道理,就藏在这个直觉里:**过一会儿再试会不会好?**

会好的叫临时错误(transient error),Day 189 已经见过这个词:

| 错误 | SDK 抛的异常 | 为什么过一会儿可能就好 |
| --- | --- | --- |
| 连不上、连接被断开 | `openai.APIConnectionError` | 网络抖了一下、对方刚重启 |
| 读超时 | `openai.APITimeoutError`(它是 `APIConnectionError` 的子类) | 对方这一刻太忙 |
| 429 请求太多 | `openai.RateLimitError` | 限流是按时间窗算的,窗口过去就放行 |
| 500、502、503 | `openai.InternalServerError` | 服务端临时故障或过载 |

不会好的叫永久错误,重试只会让日志里多几行一模一样的报错,还白占对方的限流额度:

| 错误 | 意思 | 该怎么办 |
| --- | --- | --- |
| 400 | 请求本身写错了,比如消息顺序不对、工具名重复 | 改代码 |
| 401 | key 错了 | 换 key,报警 |
| 402 | DeepSeek 特有:余额不足 | 去充值 |
| 404 | 模型名写错了 | 改配置 |
| 422 | 参数值不合法 | 改代码 |

DeepSeek 的错误码文档(2026 年 10 月查)把这层意思写得很直白:429 的解决办法是「请合理规划您的请求速率」,500 是「请等待后重试」,503 是「请稍后重试您的请求」,而 400、401、402、422 写的都是让你去改请求、查 key、充值。**只重试临时错误**,这是第一条规矩。

## 手写一个重试循环

用库之前先手写一次,看清重试到底是什么。它就是一个 `for` 循环:试一次,失败了睡一会儿,再试,成功就 `break`。

```python
# agent-zero-lab/part03/retry_by_hand.py  不用任何库,手写一个重试循环,先看清重试到底在做什么
import time


class FakeRateLimit(Exception):  # 假装是 429
    pass


calls = 0


def flaky_api() -> str:
    """前两次调用报 429,第三次才成功。"""
    global calls
    calls += 1
    if calls <= 2:
        raise FakeRateLimit(f"第 {calls} 次:429 Too Many Requests")
    return f"第 {calls} 次:200 OK"


start = time.perf_counter()
for attempt in range(1, 5):  # 最多试 4 次
    try:
        print(f"[{time.perf_counter() - start:.1f}s] 第 {attempt} 次尝试 ->", flaky_api())
        break  # 成功了就跳出循环
    except FakeRateLimit as e:
        print(f"[{time.perf_counter() - start:.1f}s] 失败:{e},等 1 秒再试")
        time.sleep(1)
else:
    print("4 次都失败,放弃")
```

<div class="line-notes">

- `class FakeRateLimit(Exception):  # 假装是 429` 自己定义一个异常类,继承 `Exception`([Day 36](/blog/agent-zero/day-036-exceptions-2/) 讲过自定义异常)。相当于 JS 里 `class FakeRateLimit extends Error {}`。
- `calls = 0` 模块级计数器,记 `flaky_api` 被调了几次。
- `global calls` 函数里要**改**模块级变量,必须先声明 `global`,否则 Python 会把 `calls += 1` 当成在给一个局部变量赋值,报 `UnboundLocalError`。JS 没有这个规矩,闭包里直接改外层 `let` 就行。
- `if calls <= 2:` 第 1、2 次失败,第 3 次起成功。这是一个按剧本出错的假接口,和 Day 189 的 `FakeLLM` 一个思路。
- `start = time.perf_counter()` 掐表,只用来算差值,相当于 JS 的 `performance.now()`(单位是秒)。
- `for attempt in range(1, 5):  # 最多试 4 次` `range(1, 5)` 是 1、2、3、4。
- `break  # 成功了就跳出循环` 和 JS 的 `break` 一样。
- `except FakeRateLimit as e:` 只接 429 这一种。别的异常(比如 401)不在这里接,会直接往外抛,这就是「只重试临时错误」。
- `time.sleep(1)` 让当前程序停 1 秒。JS 里没有同步的 sleep,最接近的是 `await new Promise(r => setTimeout(r, 1000))`。
- `else:` 这是 Python 的 `for ... else`:循环**没有被 break 打断**、自然跑完时才执行 `else`。也就是 4 次都失败了才走到这里。JS 没有这个语法,通常用一个 `succeeded` 标志变量代替。

</div>

```bash
cd /Users/你/agent-zero-lab
uv run python -m part03.retry_by_hand
```

```text
[0.0s] 失败:第 1 次:429 Too Many Requests,等 1 秒再试
[1.0s] 失败:第 2 次:429 Too Many Requests,等 1 秒再试
[2.0s] 第 3 次尝试 -> 第 3 次:200 OK
```

第 1 次 429,等 1 秒;第 2 次 429,再等 1 秒;第 3 次成功,循环 `break`,第 4 次根本没发生。整件事就这么简单。

但这个手写版有两个毛病。第一,每次都等固定的 1 秒,下一节会看到这在人多的时候是灾难。第二,「试几次」「等多久」「哪些错误才重试」三件事全搅在一个循环里,每个要重试的函数都得抄一遍。下面一个一个解决。

## 为什么要指数退避,为什么要抖动

先想一个场景。DeepSeek 的服务某一刻过载了,同一秒有一千个客户端(你的 Agent 部署了很多份,或者很多公司都在用)收到 429。它们都用上面那个手写循环,都等 1 秒,然后在**同一个时刻**一起重试。服务端刚喘口气,又被一千个请求同时砸中,接着又全部 429,再一起等 1 秒……这叫**惊群**(thundering herd):一群人被同一个信号惊醒,同时冲向同一扇门。

两个改法:

- **指数退避**(exponential backoff):每失败一次,等待时间翻倍,1 秒、2 秒、4 秒、8 秒。服务过载时你越快重试它越难恢复,翻倍是给它越来越多的喘息时间。
- **抖动**(jitter):在等待时间上加一点随机数,比如 1 秒变成「1 到 2 秒之间随机」。目的是把一千个客户端的重试时刻打散,别挤在同一瞬间。

光说不直观,模拟一下。一千个客户端都在第 0 秒失败,每个重试 3 次,我们数服务端每 0.1 秒收到多少个重试请求:

```python
# agent-zero-lab/part03/herd_sim.py  1000 个客户端同一刻被 429,三种等法下,服务端每 0.1 秒收到多少个重试请求
import random
from collections import Counter

rng = random.Random(190)
CLIENTS = 1000

STRATEGIES = {
    "固定等 1 秒": lambda n: 1.0,
    "指数退避,不抖动": lambda n: 2.0 ** (n - 1),
    "指数退避 + 抖动": lambda n: 2.0 ** (n - 1) + rng.uniform(0, 1),
}

for name, wait in STRATEGIES.items():
    buckets: Counter[int] = Counter()
    for _ in range(CLIENTS):
        t = 0.0  # 所有客户端都在第 0 秒第一次失败
        for n in range(1, 4):  # 每个客户端重试 3 次
            t += wait(n)
            buckets[int(t * 10)] += 1  # 落进第几个 0.1 秒
    busiest = buckets.most_common(1)[0]
    print(f"{name:14} 最挤的 0.1 秒是第 {busiest[0] / 10:.1f}s,收到 {busiest[1]:4d} 个请求;"
          f"重试分散在 {len(buckets):3d} 个 0.1 秒里")
```

<div class="line-notes">

- `from collections import Counter` `Counter` 是专门用来计数的字典:`buckets[k] += 1` 时 `k` 不存在也不报错,默认从 0 开始。相当于 JS 里 `map.set(k, (map.get(k) ?? 0) + 1)` 的简写。
- `rng = random.Random(190)` 固定种子的随机数生成器,你跑出来和我一模一样。Day 189 的 `chain_sim.py` 也是这么写的。
- `"固定等 1 秒": lambda n: 1.0,` 每种策略是一个函数,输入「第几次重试」`n`,返回「这次等几秒」。`lambda n: 1.0` 相当于 JS 的 `n => 1.0`。
- `"指数退避,不抖动": lambda n: 2.0 ** (n - 1),` 第 1 次等 2⁰=1 秒,第 2 次 2¹=2 秒,第 3 次 2²=4 秒。
- `"指数退避 + 抖动": lambda n: 2.0 ** (n - 1) + rng.uniform(0, 1),` 在上面的基础上加 0 到 1 秒之间的随机数。`rng.uniform(0, 1)` 返回 [0, 1] 之间均匀分布的小数。这正是待会儿 tenacity 的默认算法。
- `buckets: Counter[int] = Counter()` 每种策略重新数一遍。键是「第几个 0.1 秒」,值是这 0.1 秒里到了多少个请求。
- `t = 0.0  # 所有客户端都在第 0 秒第一次失败` 每个客户端从第 0 秒开始累加等待时间。
- `t += wait(n)` 第 n 次重试发生在「前面所有等待之和」的时刻。比如不抖动时三次重试发生在第 1、3、7 秒。
- `buckets[int(t * 10)] += 1  # 落进第几个 0.1 秒` 1.37 秒 × 10 = 13.7,取整是 13,也就是第 1.3 到 1.4 秒那个格子。
- `busiest = buckets.most_common(1)[0]` `most_common(1)` 返回计数最大的一项,形如 `[(10, 1000)]`,取 `[0]` 得到 `(10, 1000)`:第 10 个格子,1000 个请求。
- `f"重试分散在 {len(buckets):3d} 个 0.1 秒里"` 有多少个格子收到过请求。格子越多,说明重试越分散。

</div>

```bash
uv run python -m part03.herd_sim
```

```text
固定等 1 秒        最挤的 0.1 秒是第 1.0s,收到 1000 个请求;重试分散在   3 个 0.1 秒里
指数退避,不抖动       最挤的 0.1 秒是第 1.0s,收到 1000 个请求;重试分散在   3 个 0.1 秒里
指数退避 + 抖动      最挤的 0.1 秒是第 1.9s,收到  111 个请求;重试分散在  58 个 0.1 秒里
```

前两行一模一样:一千个请求全挤在同一个 0.1 秒里,三次重试只占了 3 个格子。**光有指数退避不够**,它只是把三次重试的间隔拉开了(第 1、3、7 秒),每一次依然是一千个人同时冲。加了抖动,最挤的时刻只有 111 个请求,三千次重试摊到了 58 个格子里,峰值降到原来的九分之一。

(中文在终端里占两格,`{name:14}` 按字符数对齐,所以三行没对齐,不影响结果。)

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="三种等待策略下重试请求随时间的分布:固定等待和不抖动的指数退避都是几根尖峰,加抖动后变成一片矮而宽的分布">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">1000 个客户端同时失败后,服务端每 0.1 秒收到的重试数</text>
  <line x1="60" y1="210" x2="620" y2="210" stroke="var(--rule)"/>
  <text x="60" y="228" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">0s</text>
  <text x="130" y="228" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">1s</text>
  <text x="200" y="228" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">2s</text>
  <text x="270" y="228" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">3s</text>
  <text x="410" y="228" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">5s</text>
  <text x="550" y="228" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">7s</text>
  <rect x="130" y="60" width="6" height="150" fill="var(--compute)"/>
  <rect x="270" y="60" width="6" height="150" fill="var(--compute)"/>
  <rect x="550" y="60" width="6" height="150" fill="var(--compute)"/>
  <text x="290" y="72" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">不抖动:第 1、3、7 秒各一根 1000 的尖峰</text>
  <rect x="130" y="194" width="70" height="16" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <rect x="270" y="194" width="70" height="16" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <rect x="550" y="194" width="70" height="16" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="290" y="182" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">加抖动:每次重试摊开 1 秒宽,峰值 111</text>
  <text x="20" y="250" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">琥珀:指数退避不抖动 · 蓝:指数退避 + 0~1 秒抖动(示意,高度按比例)</text>
</svg>
<figcaption>不抖动时,一千个重试在同一瞬间到达;加了 0 到 1 秒的随机,同样多的重试被摊成矮而宽的一片。</figcaption>
</figure>

抖动还有好几种加法。AWS 那篇经典博客比较过「全抖动」(在 0 到 2ⁿ 之间整个随机)、「等量抖动」等几种,结论是全抖动总工作量最小。tenacity 默认的是「2ⁿ 再加 0 到 1 秒」,另外提供了 `wait_random_exponential` 做全抖动。对我们一个 Agent 来说差别不大,重要的是**一定要有抖动**。

## tenacity 第一步:stop 和 reraise

手写循环能用,但每个函数抄一遍很烦。Python 里最常用的重试库是 **tenacity**,它把重试做成一个装饰器:在函数头上写一行 `@retry(...)`,这个函数被调用时失败了就会按你的规则自动重来。

装饰器 [Day 96](/blog/agent-zero/day-096-decorators/) 学过,提醒一句:`@retry(...)` 写在 `def f` 上面,等价于 `f = retry(...)(f)`,也就是用一个高阶函数把原函数包一层。JS 里没有装饰器语法糖(TS 有实验版),但你肯定写过 `const g = withRetry(opts)(f)` 这种东西。

先装上。在 `agent-zero-lab` 根目录:

```bash
uv add tenacity
```

```text
Installed 1 package in 60ms
 + tenacity==9.2.1
```

2026 年 10 月查到的最新版是 9.2.1(10 月 7 日发布)。

`@retry` 有四个参数今天要学,一次只加一个。第一个是 `stop`:什么时候放弃。

```python
# agent-zero-lab/part03/tenacity_stop.py  tenacity 第一步:只用 stop,看它试几次、最后抛什么
from tenacity import RetryError, retry, stop_after_attempt

calls = 0


@retry(stop=stop_after_attempt(3))
def always_fails() -> str:
    global calls
    calls += 1
    raise ConnectionError(f"第 {calls} 次连不上")


try:
    always_fails()
except RetryError as e:
    print(f"抛出 {type(e).__name__},一共调用了 {calls} 次")
    print("包在里面的原始异常:", repr(e.last_attempt.exception()))


@retry(stop=stop_after_attempt(3), reraise=True)
def always_fails_reraise() -> str:
    raise ConnectionError("还是连不上")


try:
    always_fails_reraise()
except ConnectionError as e:
    print(f"加了 reraise=True,抛出的直接是 {type(e).__name__}: {e}")
```

<div class="line-notes">

- `from tenacity import RetryError, retry, stop_after_attempt` `retry` 是装饰器本身;`stop_after_attempt` 是「试够几次就停」;`RetryError` 是 tenacity 放弃时默认抛的异常。
- `@retry(stop=stop_after_attempt(3))` 最多**调用** 3 次,也就是第一次加 2 次重试。注意是「尝试次数」不是「重试次数」,这个数很多人第一次会数错。
- `raise ConnectionError(f"第 {calls} 次连不上")` 每次都失败。`ConnectionError` 是 Python 内置的异常。
- `except RetryError as e:` 三次都失败后,tenacity 默认不会把 `ConnectionError` 原样抛出来,而是抛一个自己的 `RetryError`。
- `repr(e.last_attempt.exception())` 原始异常藏在 `RetryError` 里面:`e.last_attempt` 是最后一次尝试,`.exception()` 取出那次的异常。`repr` 显示成 `ConnectionError('第 3 次连不上')` 这样带类型的形式。
- `@retry(stop=stop_after_attempt(3), reraise=True)` 第二个参数 `reraise=True`:放弃时把最后一次的**原始异常**重新抛出来,不包成 `RetryError`。
- `except ConnectionError as e:` 加了 `reraise=True`,外面就能按原来的异常类型接了。

</div>

```bash
uv run python -m part03.tenacity_stop
```

```text
抛出 RetryError,一共调用了 3 次
包在里面的原始异常: ConnectionError('第 3 次连不上')
加了 reraise=True,抛出的直接是 ConnectionError: 还是连不上
```

`reraise=True` 看起来是个小选项,对我们其实很要紧。Day 193 拼完整 Agent 时,外面会写 `except openai.RateLimitError` 之类的代码来兜底;如果 tenacity 抛的是 `RetryError`,这些 `except` 一个都接不住,异常会一路冒到最外面把程序弄崩。**用 tenacity 基本都要写 `reraise=True`**,除非你专门想区分「重试过了才失败」和「第一次就失败」。

那 `stop` 不写会怎样?默认是**永不停止**,而且默认**不等待**。练习 1 会让你亲眼看看:一个连续失败 99999 次的函数,不写 `stop` 时 tenacity 会在 6 秒多里不停地狂试十万次。生产代码里一定要写 `stop`。

## tenacity 第二步:retry 决定哪些错误才重试

第二个参数 `retry=`(和装饰器同名,别搞混):什么样的失败才重试。我们要的是「只重试临时错误」,用 `retry_if_exception_type`,把临时错误的异常类放进一个元组传进去。

为了不真的去触发 429,这里手工造几个和 SDK 抛出来一模一样的异常对象,这招 Day 189 练习 2 用过。

```python
# agent-zero-lab/part03/tenacity_when.py  tenacity 第二步:retry= 决定哪些错误才重试。429 重试,401 不重试
import httpx2
import openai
from tenacity import retry, retry_if_exception_type, stop_after_attempt

REQ = httpx2.Request("POST", "https://api.deepseek.com/chat/completions")
RETRYABLE = (openai.APIConnectionError, openai.RateLimitError, openai.InternalServerError)

calls: list[int] = []


def fake_error(status: int) -> openai.APIStatusError:
    """手工造一个和 SDK 抛出来一模一样的 HTTP 错误。"""
    resp = httpx2.Response(status, request=REQ)
    cls = {429: openai.RateLimitError, 401: openai.AuthenticationError, 500: openai.InternalServerError}[status]
    return cls(f"Error code: {status}", response=resp, body=None)


@retry(retry=retry_if_exception_type(RETRYABLE), stop=stop_after_attempt(4), reraise=True)
def call_api(status: int) -> str:
    calls.append(status)
    raise fake_error(status)


for status in [429, 500, 401]:
    calls.clear()
    try:
        call_api(status)
    except openai.APIStatusError as e:
        print(f"{status}: 调用 {len(calls)} 次后放弃,最后抛出 {type(e).__name__}")
```

<div class="line-notes">

- `import httpx2` openai SDK 底层用的 HTTP 库。2026 年 10 月的 openai 3.36.1 依赖的是 `httpx2`,随 openai 一起装好,不用另外 `uv add`(Day 189 练习 2 讲过我第一次写成 `import httpx` 报错)。这里只用它造假的请求和响应对象。
- `REQ = httpx2.Request("POST", "https://api.deepseek.com/chat/completions")` 一个假的请求对象。SDK 的异常类要求带上请求和响应,我们照着给,不会真发出去。
- `RETRYABLE = (openai.APIConnectionError, openai.RateLimitError, openai.InternalServerError)` 临时错误的三个异常类。读超时 `APITimeoutError` 是 `APIConnectionError` 的子类,自动包含在内。
- `calls: list[int] = []` 记录每次调用,用来数调了几次。这里用列表而不是 `global` 计数器:往列表里 `append` 是修改对象,不是给变量重新赋值,不用写 `global`。
- `cls = {429: openai.RateLimitError, 401: openai.AuthenticationError, 500: openai.InternalServerError}[status]` 用字典按状态码查出对应的异常类。类在 Python 里也是普通的值,可以放进字典,和 JS 里把 class 放进对象一样。
- `return cls(f"Error code: {status}", response=resp, body=None)` 造出异常对象。`body=None` 表示响应体为空。
- `@retry(retry=retry_if_exception_type(RETRYABLE), stop=stop_after_attempt(4), reraise=True)` 三个参数:异常属于 `RETRYABLE` 才重试;最多试 4 次;放弃时抛原异常。
- `calls.clear()` 每种状态码开始前清空计数。
- `except openai.APIStatusError as e:` 所有带 HTTP 状态码的 SDK 异常的父类,429、500、401 都能在这里接住。

</div>

```bash
uv run python -m part03.tenacity_when
```

```text
429: 调用 4 次后放弃,最后抛出 RateLimitError
500: 调用 4 次后放弃,最后抛出 InternalServerError
401: 调用 1 次后放弃,最后抛出 AuthenticationError
```

429 和 500 都试满 4 次;401 第一次就放弃了,因为 `AuthenticationError` 不在 `RETRYABLE` 里,tenacity 根本不重试,直接抛出去。和 Day 189 那个「写错 key 只花 0.2 秒」是同一个道理,只是这回是我们自己定的规矩。

这一步跑得飞快,是因为还没有写 `wait`:失败后立刻重试,一毫秒都不等。这正是上一节说的惊群写法。

## tenacity 第三步:wait 决定等多久

第三个参数 `wait=`。我们用 `wait_exponential_jitter`,它的算法就是 `herd_sim.py` 里第三种:第 n 次失败后等 2ⁿ⁻¹ 秒,再加 0 到 1 秒的随机,最多不超过 `max`。量一下真实的间隔:

```python
# agent-zero-lab/part03/tenacity_wait.py  tenacity 第三步:wait= 决定每次重试前等多久。量一下真实的间隔
import time

from tenacity import retry, stop_after_attempt, wait_exponential_jitter

stamps: list[float] = []


@retry(wait=wait_exponential_jitter(max=20), stop=stop_after_attempt(4), reraise=True)
def flaky() -> str:
    stamps.append(time.perf_counter())
    if len(stamps) < 4:
        raise ConnectionError("连不上")
    return "第 4 次成功"


print(flaky())
for i in range(1, len(stamps)):
    print(f"第 {i} 次失败后等了 {stamps[i] - stamps[i - 1]:.2f} 秒")
print(f"总耗时 {stamps[-1] - stamps[0]:.2f} 秒")
```

<div class="line-notes">

- `stamps: list[float] = []` 每次调用时记一下时间戳,算出相邻两次之间隔了多久。
- `@retry(wait=wait_exponential_jitter(max=20), stop=stop_after_attempt(4), reraise=True)` `max=20` 是单次等待的上限,指数涨到 20 秒就不再涨。这里没写 `retry=`,默认是「任何异常都重试」。
- `stamps.append(time.perf_counter())` 一进函数就记时间。
- `if len(stamps) < 4:` 前 3 次失败,第 4 次成功。
- `print(f"第 {i} 次失败后等了 {stamps[i] - stamps[i - 1]:.2f} 秒")` 第 i 次调用和第 i+1 次调用之间的时间差,就是第 i 次失败后等的时间(函数本身几乎不花时间)。

</div>

```bash
uv run python -m part03.tenacity_wait
```

```text
第 4 次成功
第 1 次失败后等了 1.05 秒
第 2 次失败后等了 2.08 秒
第 3 次失败后等了 4.41 秒
总耗时 7.53 秒
```

1 秒多、2 秒多、4 秒多,整数部分在翻倍,小数部分是随机抖动(你跑出来的小数会不一样)。最坏情况下,第 4 次还失败的话总共要等 1+2+4 再加最多 3 秒抖动,也就是 7 到 10 秒。这个数要放进心里:Agent 的一步,最坏可能因为重试多花 10 秒。

这里有个 2026 年的坑。网上很多教程(包括本课程的旧版)写的是 `wait_exponential_jitter(initial=1, max=20)`。我在 tenacity 9.2.1 里试了一下把 `initial` 改成 0.5:

```bash
uv run python -c "from tenacity import wait_exponential_jitter; wait_exponential_jitter(initial=0.5, max=20)"
```

```text
<string>:1: DeprecationWarning: The 'initial' parameter is deprecated, use 'multiplier' instead
```

`initial` 已经被标为弃用,新写法是 `multiplier=0.5`。默认值是 1,所以我们干脆不写。

## 四个参数合起来:chat_with_retry

把三步合起来,给模型调用包一层。这个文件 Day 193 拼完整 Agent 时会直接导入,所以单独放一个模块:

```python
# agent-zero-lab/part03/retry_llm.py  Day 190:模型调用只对临时错误重试,SDK 那层关掉。Day 193 的 robust_agent 会导入它
from typing import Any, Protocol

import openai
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential_jitter

from common.llm import ChatResult, LLMClient

# 过一会儿再试大概率会好的错误:连不上/超时(APITimeoutError 是 APIConnectionError 的子类)、429、5xx
RETRYABLE = (openai.APIConnectionError, openai.RateLimitError, openai.InternalServerError)


class SupportsChat(Protocol):
    """有 chat 方法、返回 ChatResult 的东西都行:真的 LLMClient,或者测试里的假模型。"""

    def chat(self, messages: list[dict[str, Any]], **kw: Any) -> ChatResult: ...


def make_llm(**overrides: Any) -> LLMClient:
    """建一个关掉 SDK 自带重试的 LLMClient,重试统一交给下面的 chat_with_retry。"""
    overrides.setdefault("max_retries", 0)
    overrides.setdefault("timeout", 60.0)
    return LLMClient(**overrides)


@retry(
    retry=retry_if_exception_type(RETRYABLE),  # 哪些错误才重试
    wait=wait_exponential_jitter(max=20),  # 每次等多久:1、2、4 秒……再加 0~1 秒抖动,最多 20 秒
    stop=stop_after_attempt(4),  # 最多调用 4 次(第一次 + 重试 3 次)
    reraise=True,  # 放弃时抛原始异常,不包成 RetryError
)
def chat_with_retry(llm: SupportsChat, messages: list[dict[str, Any]], **kw: Any) -> ChatResult:
    return llm.chat(messages, **kw)
```

<div class="line-notes">

- `from typing import Any, Protocol` `Protocol` 是 [Day 49](/blog/agent-zero/day-049-type-hints-4/) 学的「只看形状」的类型,相当于 TS 的 `interface`。
- `from common.llm import ChatResult, LLMClient` 这是 [Day 135](/blog/agent-zero/day-135-llm-client-1/) 建的 `common/llm.py`。
- `RETRYABLE = (openai.APIConnectionError, openai.RateLimitError, openai.InternalServerError)` 和上面 `tenacity_when.py` 一样的三个类,放在模块顶层,Day 193 的 Agent 还要在 `except RETRYABLE` 里用它。
- `class SupportsChat(Protocol):` 声明「有一个 `chat(messages, **kw) -> ChatResult` 方法」的东西。真的 `LLMClient` 符合,测试里的假模型只要也写一个同样签名的 `chat` 就符合,不用继承任何类。
- `def chat(self, messages: list[dict[str, Any]], **kw: Any) -> ChatResult: ...` 函数体写 `...`(三个点),表示这里只声明不实现。
- `overrides.setdefault("max_retries", 0)` `setdefault` 是「没有这个键才设」:调用方没指定 `max_retries` 就用 0,指定了就听调用方的。相当于 JS 的 `overrides.max_retries ??= 0`。为什么是 0,下一节用实验说明。
- `overrides.setdefault("timeout", 60.0)` SDK 默认的超时是 600 秒(`_constants.py` 里写的 `DEFAULT_TIMEOUT = httpx2.Timeout(timeout=600, connect=5.0)`),`LLMClient` 改成了 120 秒。Agent 里一步等 2 分钟太久了,这里给 60 秒。
- `return LLMClient(**overrides)` `**overrides` 把字典拆成关键字参数传进去,相当于 JS 的 `new LLMClient({...overrides})`。Day 135 的 `LLMClient` 接受 `base_url`、`api_key`、`model`、`max_retries`、`timeout` 这几个覆盖项。
- `retry=retry_if_exception_type(RETRYABLE),  # 哪些错误才重试` 参数一。
- `wait=wait_exponential_jitter(max=20),` 参数二。
- `stop=stop_after_attempt(4),` 参数三。
- `reraise=True,` 参数四。
- `def chat_with_retry(llm: SupportsChat, messages: list[dict[str, Any]], **kw: Any) -> ChatResult:` 把 `llm` 当参数传进来,而不是在函数里 new 一个,这样测试时能塞假模型。`**kw` 原样转给 `chat`,`tools=`、`tool_choice=` 都能透传。
- `return llm.chat(messages, **kw)` 整个函数只有这一行,所有本事都在装饰器上。

</div>

用它走三趟:正常调用、连不上、key 写错。

```python
# agent-zero-lab/part03/retry_demo.py  用 chat_with_retry 走三趟:正常、连不上、key 写错
import time

import openai

from part03.retry_llm import chat_with_retry, make_llm

MSG = [{"role": "user", "content": "用一句话说说什么是指数退避。"}]

cases = {
    "正常调用 DeepSeek": {},
    "连不上(端口 9)": {"base_url": "http://127.0.0.1:9"},
    "key 写错": {"api_key": "sk-wrong-key-for-demo"},
}
for name, overrides in cases.items():
    llm = make_llm(**overrides)
    start = time.perf_counter()
    try:
        r = chat_with_retry(llm, MSG)
        print(f"{name}: {r.content} | {llm.ledger} | {time.perf_counter() - start:.1f} 秒")
    except openai.APIError as e:
        print(f"{name}: 抛出 {type(e).__name__} | 调用 {chat_with_retry.statistics['attempt_number']} 次 | {time.perf_counter() - start:.1f} 秒")
```

<div class="line-notes">

- `"正常调用 DeepSeek": {},` 空字典,什么都不覆盖,用 `.env` 里的真配置。
- `"连不上(端口 9)": {"base_url": "http://127.0.0.1:9"},` Day 189 用过的招:本机 9 号端口没人监听,连上去立刻被拒绝。
- `"key 写错": {"api_key": "sk-wrong-key-for-demo"},` 错的 key,真发到 DeepSeek,401,不计费。你的真 key 不会被发出去。
- `llm = make_llm(**overrides)` 每一趟新建一个 `max_retries=0` 的客户端。
- `except openai.APIError as e:` SDK 所有异常的父类,连接错误和 HTTP 错误都能接住。
- `chat_with_retry.statistics['attempt_number']` tenacity 在被装饰的函数上挂了一个 `statistics` 字典,记着最近一次调用试了几次。调试时很好用。

</div>

```bash
uv run python -m part03.retry_demo
```

```text
正常调用 DeepSeek: 指数退避是一种在请求失败后按指数级递增等待时间再重试的策略（如 1s、2s、4s、8s……），用于避免频繁重试加剧系统压力。 | 1 次调用 | 输入 13 / 输出 43 tokens | 约 ¥0.0004 | 1.0 秒
连不上(端口 9): 抛出 APIConnectionError | 调用 4 次 | 8.5 秒
key 写错: 抛出 AuthenticationError | 调用 1 次 | 0.1 秒
```

正常那趟和不加重试没有区别,一次成功,装饰器什么都没做。连不上那趟试了 4 次、等了 8.5 秒才放弃,和 `tenacity_wait.py` 量出来的 7 到 10 秒对得上。key 写错那趟 0.1 秒,一次就放弃。

花费:输入 13、输出 43 个 token,按 `.env` 里 DeepSeek 的价格(未命中 2 元、输出 8 元每百万 token,2026 年 10 月核对),13 × 2 / 10⁶ + 43 × 8 / 10⁶ ≈ ¥0.0004。

注意连不上那趟最后**还是抛出了异常**。重试只是让临时错误有机会自己好,真好不了时还是得有人接住,把「模型服务暂时不可用」变成一个像样的返回值,而不是让整个 Agent 崩掉。这件事放在 Day 193 拼完整 Agent 时做。

## 两层重试叠在一起:16 个请求

`make_llm` 里那行 `max_retries=0` 是为什么?因为 OpenAI SDK 自己就会重试。我翻了 openai 3.36.1 的 `_base_client.py`,`_should_retry` 里写着它对 408、409、429 和所有 5xx 重试,连接错误也重试;默认 `max_retries=2`,等待是从 0.5 秒起翻倍、最多 8 秒、再乘一个 0.75 到 1 的随机系数;如果服务端在响应头里给了 `retry-after`,就按服务端说的等(两分钟以内)。Day 135 的 `LLMClient` 把它设成了 3。

SDK 一层、tenacity 一层,叠在一起会怎样?最好的办法是数一数。在本地起一个**永远回 429** 的假服务,让真的 SDK 去打它,看服务端一共收到多少个请求。

这个假服务用的是 Python 标准库的 `http.server`([Day 78](/blog/agent-zero/day-078-server-2/) 讲过服务端怎么收请求、回状态码)。为了让它在后台一直跑、主程序同时去调它,用了一个线程,线程明天细讲,今天先把 `threading.Thread(...).start()` 当成「让这个函数在后台跑起来」就行。

第一版我写的假服务只回了状态码,没读请求体,一跑就报错:

```text
httpx2.ReadError: [Errno 54] Connection reset by peer

The above exception was the direct cause of the following exception:
...
openai.APIConnectionError: Connection error.
```

服务端没把客户端发来的请求体读完就关了连接,客户端那边看到的就是「连接被对方重置」,SDK 把它当成连接错误。真实服务器不会犯这种错,但自己写假服务时很容易踩到。修法是先 `rfile.read` 把请求体读完,并且在响应头里写上 `Content-Length`。下面是改好的版本:

```python
# agent-zero-lab/part03/layer_count.py  SDK 自己会重试,外面再套 tenacity,一次调用到底发了几个请求?本地起一个永远回 429 的假服务数一数
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import openai
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential_jitter

from common.llm import LLMClient

hits = 0


class Always429(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        global hits
        hits += 1
        self.rfile.read(int(self.headers["Content-Length"]))  # 先把请求体读完,不然客户端会收到 Connection reset
        body = b'{"error": {"message": "rate limited (fake)"}}'
        self.send_response(429)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("retry-after-ms", "50")  # 告诉客户端:50 毫秒后再来
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:  # 不要每个请求都往终端打一行
        pass


server = HTTPServer(("127.0.0.1", 0), Always429)  # 端口写 0,让系统随便给一个空闲端口
threading.Thread(target=server.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{server.server_port}/v1"

for sdk_retries in [3, 0]:
    llm = LLMClient(base_url=BASE, api_key="sk-fake", max_retries=sdk_retries)

    @retry(retry=retry_if_exception_type(openai.RateLimitError), wait=wait_exponential_jitter(max=20),
           stop=stop_after_attempt(4), reraise=True)
    def ask() -> str:
        return llm.chat([{"role": "user", "content": "hi"}]).content

    hits, start = 0, time.perf_counter()
    try:
        ask()
    except openai.RateLimitError:
        pass
    print(f"SDK max_retries={sdk_retries} + tenacity 4 次:服务端一共收到 {hits} 个请求,耗时 {time.perf_counter() - start:.1f} 秒")
server.shutdown()
```

<div class="line-notes">

- `from http.server import BaseHTTPRequestHandler, HTTPServer` 标准库自带的极简 HTTP 服务器,不用装任何东西。`HTTPServer` 负责监听端口,`BaseHTTPRequestHandler` 的子类负责处理每个请求。
- `hits = 0` 服务端收到的请求总数,这就是今天要数的东西。
- `def do_POST(self) -> None:` 收到 POST 请求时调这个方法。方法名是约定好的:GET 请求调 `do_GET`,POST 调 `do_POST`。SDK 调 `/chat/completions` 用的是 POST。
- `self.rfile.read(int(self.headers["Content-Length"]))` `rfile` 是请求体的输入流,`Content-Length` 头告诉我们请求体有多少字节。读完它,连接才能正常收尾。这就是上面那个 Connection reset 的修法。
- `body = b'{"error": {"message": "rate limited (fake)"}}'` 前面的 `b` 表示这是字节串(bytes),不是普通字符串。网络上传的都是字节。
- `self.send_response(429)` 状态行:HTTP/1.0 429。
- `self.send_header("Content-Length", str(len(body)))` 告诉客户端响应体多长。不写的话客户端只能等连接关闭才知道读完了。
- `self.send_header("retry-after-ms", "50")` 「50 毫秒后再来」。`retry-after-ms` 是 OpenAI 自己用的非标准头,标准的是 `Retry-After`(单位秒)。SDK 两个都认,优先认毫秒的。这里给 50 毫秒,是为了让 SDK 那层重试快点结束,实验不用等太久。
- `self.wfile.write(body)` `wfile` 是响应的输出流。
- `def log_message(self, format: str, *args: object) -> None:` 父类默认每个请求往终端打一行访问日志,这里覆盖成什么都不做。参数名必须叫 `format`,和父类一致,否则类型检查器会报「覆盖方式不兼容」,我第一次写成 `*args` 就被 basedpyright 拦下了。
- `server = HTTPServer(("127.0.0.1", 0), Always429)` 端口写 0,操作系统会挑一个当前空闲的端口,避免和你机器上别的程序冲突。
- `threading.Thread(target=server.serve_forever, daemon=True).start()` 让服务器在后台线程里一直跑,主程序继续往下走。`daemon=True` 表示主程序结束时这个线程跟着结束,不会卡住退出。
- `BASE = f"http://127.0.0.1:{server.server_port}/v1"` `server.server_port` 是系统实际分配的端口号。
- `for sdk_retries in [3, 0]:` 先用 Day 135 的默认值 3,再用 0,对比。
- `llm = LLMClient(base_url=BASE, api_key="sk-fake", max_retries=sdk_retries)` 指向本地假服务。key 随便写,假服务不检查。
- `@retry(retry=retry_if_exception_type(openai.RateLimitError), wait=wait_exponential_jitter(max=20),` 外层 tenacity:只对 429 重试,其余和 `chat_with_retry` 一样。装饰器写在循环里是为了每次绑定这一轮的 `llm`。
- `hits, start = 0, time.perf_counter()` 两个变量一起赋值,相当于 JS 的 `[hits, start] = [0, performance.now()]`。
- `except openai.RateLimitError:` 最后肯定是 429,接住了什么都不做,我们只关心 `hits`。
- `server.shutdown()` 停掉假服务。

</div>

```bash
uv run python -m part03.layer_count
```

```text
SDK max_retries=3 + tenacity 4 次:服务端一共收到 16 个请求,耗时 8.9 秒
SDK max_retries=0 + tenacity 4 次:服务端一共收到 4 个请求,耗时 8.3 秒
```

16 = 4 × 4。tenacity 每试 1 次,SDK 在里面又试了 1 + 3 = 4 次。要是假服务没给 `retry-after-ms`,SDK 每一轮内部还要多等 0.5、1、2 秒左右,总耗时会更长。把 SDK 的 `max_retries` 设成 0,服务端只收到 4 个请求,由 tenacity 一家说了算。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="两层重试叠加:外层 tenacity 尝试 4 次,每次里面 SDK 又尝试 4 次,一共 16 个请求;关掉 SDK 那层后只有 4 个">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">SDK max_retries=3 + tenacity 4 次</text>
  <rect x="20" y="40" width="140" height="60" fill="none" stroke="var(--mem)" rx="4"/>
  <rect x="170" y="40" width="140" height="60" fill="none" stroke="var(--mem)" rx="4"/>
  <rect x="320" y="40" width="140" height="60" fill="none" stroke="var(--mem)" rx="4"/>
  <rect x="470" y="40" width="140" height="60" fill="none" stroke="var(--mem)" rx="4"/>
  <text x="90" y="56" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">tenacity 第 1 次</text>
  <text x="240" y="56" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">第 2 次</text>
  <text x="390" y="56" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">第 3 次</text>
  <text x="540" y="56" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">第 4 次</text>
  <text x="90" y="84" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">■ ■ ■ ■</text>
  <text x="240" y="84" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">■ ■ ■ ■</text>
  <text x="390" y="84" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">■ ■ ■ ■</text>
  <text x="540" y="84" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">■ ■ ■ ■</text>
  <text x="320" y="122" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">每个 ■ 是一个真实发出去的 HTTP 请求,共 16 个</text>
  <text x="20" y="160" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">SDK max_retries=0 + tenacity 4 次</text>
  <text x="90" y="192" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">■</text>
  <text x="240" y="192" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">■</text>
  <text x="390" y="192" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">■</text>
  <text x="540" y="192" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">■</text>
  <text x="320" y="218" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">一家说了算:4 个请求,等待节奏只由 tenacity 决定</text>
</svg>
<figcaption>两层重试是乘法。蓝框是外层 tenacity 的一次尝试,琥珀方块是里面 SDK 真正发出的请求。</figcaption>
</figure>

那反过来,只用 SDK 的重试、不用 tenacity 行不行?也行,SDK 的重试本身写得很规矩(指数退避、抖动、认 `retry-after`)。我选择关掉 SDK 那层、统一用 tenacity,理由有三个:重试规则写在我们自己的代码里,一眼能看到;能挂日志(练习 2);以后要重试的不只是模型调用,工具里调外部接口也要重试,用同一套写法更统一。反过来,如果你不想多一个依赖,保留 SDK 那层、不套 tenacity,也是合理的选择。**两层都开是唯一不合理的选择。**

## 用测试证明它会等、会停

重试逻辑最怕「看起来写对了」。`tenacity_when.py` 那种打印看一眼是一回事,能一直守住是另一回事:哪天有人把 `RETRYABLE` 改了一下,打印脚本不会提醒你。所以要写测试,而且测试不能真的联网、不能真的等 7 秒。

两个替身:一个按剧本抛错的假模型(和 Day 189 的 `FakeLLM` 同一个思路),一个只记账不睡觉的假 `sleep`。tenacity 在装饰器对象上留了一个 `sleep` 属性,默认是 `time.sleep`,用 monkeypatch 把它换掉,每次「该睡多久」就被记进一个列表,测试一瞬间就跑完,还能检查等的时间对不对。

先装 pytest(第一部分装过的话跳过),并确认 `pyproject.toml` 里有 [Day 72](/blog/agent-zero/day-072-pytest-2/) 加的那段配置:

```bash
uv add --dev pytest
```

```toml
[tool.pytest]
pythonpath = ["."]
testpaths = ["tests"]
```

```python
# agent-zero-lab/tests/test_retry_llm.py  Day 190:用假模型和假 sleep 测重试,不联网、不真等
from typing import Any

import httpx2
import openai
import pytest

from common.llm import ChatResult
from part03.retry_llm import chat_with_retry

REQ = httpx2.Request("POST", "https://api.deepseek.com/chat/completions")


def http_error(status: int) -> openai.APIStatusError:
    cls = {429: openai.RateLimitError, 401: openai.AuthenticationError, 503: openai.InternalServerError}[status]
    return cls(f"Error code: {status}", response=httpx2.Response(status, request=REQ), body=None)


class ScriptedLLM:
    """前几次按剧本抛错,剧本用完就正常回答。"""

    def __init__(self, errors: list[Exception]) -> None:
        self.errors = errors
        self.calls = 0

    def chat(self, messages: list[dict[str, Any]], **kw: Any) -> ChatResult:
        self.calls += 1
        if self.errors:
            raise self.errors.pop(0)
        return ChatResult(content="ok", reasoning=None, finish_reason="stop", message={"role": "assistant", "content": "ok"})


@pytest.fixture
def waits(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    """把 tenacity 的 sleep 换成只记账不睡觉的假函数。"""
    record: list[float] = []
    monkeypatch.setattr(chat_with_retry.retry, "sleep", record.append)
    return record


def test_429_is_retried_then_succeeds(waits: list[float]) -> None:
    llm = ScriptedLLM([http_error(429), http_error(429)])
    r = chat_with_retry(llm, [])
    assert r.content == "ok"
    assert llm.calls == 3
    assert len(waits) == 2


def test_waits_grow_exponentially(waits: list[float]) -> None:
    llm = ScriptedLLM([http_error(503)] * 3)
    chat_with_retry(llm, [])
    assert 1 <= waits[0] <= 2
    assert 2 <= waits[1] <= 3
    assert 4 <= waits[2] <= 5


def test_401_is_not_retried(waits: list[float]) -> None:
    llm = ScriptedLLM([http_error(401)])
    with pytest.raises(openai.AuthenticationError):
        chat_with_retry(llm, [])
    assert llm.calls == 1
    assert waits == []


def test_gives_up_after_4_attempts_with_original_error(waits: list[float]) -> None:
    llm = ScriptedLLM([http_error(429)] * 10)
    with pytest.raises(openai.RateLimitError):
        chat_with_retry(llm, [])
    assert llm.calls == 4
    assert len(waits) == 3
```

<div class="line-notes">

- `def http_error(status: int) -> openai.APIStatusError:` 和 `tenacity_when.py` 的 `fake_error` 一样,造一个 SDK 风格的 HTTP 异常。测试文件里自己再写一份,不去导入演示脚本,测试才不依赖演示脚本。
- `class ScriptedLLM:` 假模型。它有 `chat` 方法,签名和 `SupportsChat` 一致,所以类型检查器认它是合格的 `llm` 参数,不用写 `type: ignore`。
- `self.errors = errors` 剧本:一个异常列表,每次调用取走第一个抛出去。
- `raise self.errors.pop(0)` `pop(0)` 取出并删除列表第一个元素,相当于 JS 的 `shift()`。
- `return ChatResult(content="ok", reasoning=None, finish_reason="stop", message={"role": "assistant", "content": "ok"})` 剧本用完就返回一个正常结果。`ChatResult` 的前四个字段没有默认值,必须给;后面的 token 数、花费都有默认值 0。
- `@pytest.fixture` [Day 73](/blog/agent-zero/day-073-pytest-3/) 学的 fixture:测试函数参数里写 `waits`,pytest 就先跑这个函数,把返回值传进去。
- `monkeypatch.setattr(chat_with_retry.retry, "sleep", record.append)` 关键一行。`chat_with_retry.retry` 是 tenacity 挂在函数上的「重试器」对象,它的 `sleep` 属性决定怎么睡。换成 `record.append` 后,本来要 `time.sleep(1.66)` 的地方变成了 `record.append(1.66)`:不睡了,只记下来。测试结束时 monkeypatch 会自动换回去。
- `return record` 测试函数拿到的就是这个列表,里面是每次该睡的秒数。
- `llm = ScriptedLLM([http_error(429), http_error(429)])` 前两次 429,第三次成功。
- `r = chat_with_retry(llm, [])` messages 传空列表就行,假模型不看它。
- `assert llm.calls == 3` 调了 3 次:失败、失败、成功。
- `assert len(waits) == 2` 中间睡了 2 次。
- `llm = ScriptedLLM([http_error(503)] * 3)` 列表乘 3 就是重复三遍,和字符串乘法一样。三次 503,第四次成功。我单独跑过一次,三次等待记下来是 `[1.66, 2.19, 4.48]`。
- `assert 1 <= waits[0] <= 2` Python 允许连写比较,等于 `1 <= waits[0] and waits[0] <= 2`。JS 里不能这么写。第 1 次等 2⁰ 秒加 0 到 1 秒抖动,所以在 1 到 2 之间。
- `assert 4 <= waits[2] <= 5` 第 3 次是 2² = 4 秒加抖动。
- `with pytest.raises(openai.AuthenticationError):` 断言里面那行会抛这个异常,不抛测试就失败。相当于 jest 的 `expect(() => ...).toThrow(AuthenticationError)`。
- `assert waits == []` 401 一次都没等。
- `llm = ScriptedLLM([http_error(429)] * 10)` 剧本里有 10 个 429,但 tenacity 只会用掉 4 个。
- `with pytest.raises(openai.RateLimitError):` 放弃时抛的是原始的 `RateLimitError`,不是 `RetryError`。这条在测 `reraise=True`。
- `assert len(waits) == 3` 4 次调用之间睡 3 次。

</div>

```bash
uv run pytest tests/test_retry_llm.py -v
```

```text
tests/test_retry_llm.py::test_429_is_retried_then_succeeds PASSED        [ 25%]
tests/test_retry_llm.py::test_waits_grow_exponentially PASSED            [ 50%]
tests/test_retry_llm.py::test_401_is_not_retried PASSED                  [ 75%]
tests/test_retry_llm.py::test_gives_up_after_4_attempts_with_original_error PASSED [100%]

============================== 4 passed in 1.55s ===============================
```

1.55 秒里大部分是导入 openai 的时间,测试本身一秒都没睡。

测试有没有用,要看它能不能抓住错误。我故意把 `retry_llm.py` 里 `RETRYABLE` 的 `openai.RateLimitError` 删掉,假装有人「顺手」改了一下,再跑:

```text
    def test_gives_up_after_4_attempts_with_original_error(waits: list[float]) -> None:
        llm = ScriptedLLM([http_error(429)] * 10)
        with pytest.raises(openai.RateLimitError):
            chat_with_retry(llm, [])
>       assert llm.calls == 4
E       assert 1 == 4
E        +  where 1 = <test_retry_llm.ScriptedLLM object at 0x10c7f95e0>.calls

tests/test_retry_llm.py:69: AssertionError
=========================== short test summary info ============================
FAILED tests/test_retry_llm.py::test_429_is_retried_then_succeeds - openai.Ra...
FAILED tests/test_retry_llm.py::test_gives_up_after_4_attempts_with_original_error
2 failed, 2 passed in 1.64s
```

两个和 429 有关的测试变红,`assert 1 == 4` 说得很清楚:429 只试了 1 次。改回去,4 个全绿。这就是大纲里说的「429 重试测试」。

## 重试的边界

最后说几件重试管不了、或者不该管的事。

**重试只对「临时、独立」的失败有用。** Day 189 练习 3 算过:单步 98%,重试一次,十步成功率从 81.7% 拉到 99.6%。但前提是失败互相独立。如果是下游服务整个挂了,十个请求全会失败,重试只是把同一个失败重复 4 遍,再多等 10 秒。这种情况要靠**断路器**(circuit breaker):连续失败多了就暂时不再调用,直接返回「服务不可用」,过一阵再放一个请求去探路。断路器在第七部分生产化时讲。

**模型行为层的错误不要这样重试。** 模型把参数写成了不合法的 JSON,原样再问一次大概率还是这个结果。Day 170 的做法是把报错作为 tool 消息回给模型,让它**改**,这和「重来」是两回事。tenacity 只用在模型 API 和外部接口的**网络层**错误上。

**写操作要小心。** 「退款」这种工具,如果请求其实已经到达对方、钱已经退了,只是响应在回来的路上丢了(读超时),那么重试就会退第二次款。练习 4 会模拟这个场景,并用**幂等键**(idempotency key)解决:每次操作带一个唯一编号,对方发现这个编号办过了就直接返回上次的结果。Stripe 的 API 就是这么做的。

## 动手练习

### 练习 1:@retry 什么都不写,会怎样

写一个前 99999 次都抛 `ConnectionError`、第 100000 次才成功的函数,只加一个光秃秃的 `@retry`(不写任何参数)。运行它,记下调用次数和用时,说说为什么生产代码里一定要写 `stop` 和 `wait`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex190_no_stop.py  练习 1:@retry 什么参数都不写,会试几次、等多久?
import time

from tenacity import retry

calls = 0


@retry
def fails_a_lot() -> str:
    global calls
    calls += 1
    if calls < 100_000:
        raise ConnectionError("连不上")
    return "终于成功"


start = time.perf_counter()
print(fails_a_lot(), f"| 调用了 {calls} 次 | 用时 {time.perf_counter() - start:.2f} 秒")
```

<div class="line-notes">

- `@retry` 不带括号也能用,tenacity 两种写法都支持。这时 `stop` 默认是「永不停止」,`wait` 默认是「不等」,`retry` 默认是「任何异常都重试」。
- `if calls < 100_000:` 前 99999 次失败。
- `print(fails_a_lot(),` 这一行会卡在 `fails_a_lot()` 里,直到第 100000 次成功才返回。

</div>

```bash
uv run python -m part03.ex190_no_stop
```

```text
终于成功 | 调用了 100000 次 | 用时 6.49 秒
```

6.49 秒里狂试了十万次,中间一刻都没停。如果这是真的模型 API,你会在 6 秒内向对方发出十万个请求,足够触发对方最严格的封禁;如果下游永远不恢复,这个函数会永远不返回。默认值适合「我确定它很快会好」的极少数场景,生产代码里 `stop` 和 `wait` 都要显式写出来。

</details>

### 练习 2:每次重试前打一行日志

线上出了问题,如果日志里看不出「这一步其实重试了 3 次才成功」,你就会误判延迟的来源。tenacity 的第五个常用参数 `before_sleep` 可以在每次睡之前调一个函数。用 `before_sleep_log` 配合 [Day 75](/blog/agent-zero/day-075-logging/) 学的 `logging`,让连不上的那趟每次重试都打一行 WARNING。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex190_log.py  练习 2:每次重试前打一行日志,出事时才知道它重试过
import logging

import openai
from tenacity import before_sleep_log, retry, retry_if_exception_type, stop_after_attempt, wait_exponential_jitter

from part03.retry_llm import RETRYABLE, SupportsChat, make_llm
from common.llm import ChatResult

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s | %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("llm")


@retry(
    retry=retry_if_exception_type(RETRYABLE),
    wait=wait_exponential_jitter(max=20),
    stop=stop_after_attempt(4),
    reraise=True,
    before_sleep=before_sleep_log(log, logging.WARNING),  # 第五个参数:每次睡之前调一下
)
def chat_logged(llm: SupportsChat, messages: list[dict], **kw: object) -> ChatResult:
    return llm.chat(messages, **kw)


try:
    chat_logged(make_llm(base_url="http://127.0.0.1:9"), [{"role": "user", "content": "hi"}])
except openai.APIConnectionError as e:
    log.error("4 次都失败,放弃:%s", type(e).__name__)
```

<div class="line-notes">

- `from part03.retry_llm import RETRYABLE, SupportsChat, make_llm` 复用今天写好的元组、Protocol 和工厂函数,规则只写一份。
- `logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s | %(message)s", datefmt="%H:%M:%S")` Day 75 的写法:日志带时间、级别、logger 名。
- `log = logging.getLogger("llm")` 取一个叫 `llm` 的 logger,下面日志行里的 `llm` 就是它。
- `before_sleep=before_sleep_log(log, logging.WARNING),` `before_sleep_log` 生成一个回调:每次要睡之前,用 WARNING 级别写一行「要重试了、睡多久、因为什么异常」。
- `log.error("4 次都失败,放弃:%s", type(e).__name__)` logging 的参数写法:`%s` 占位,值作为后面的参数传,只有真要输出时才拼字符串。

</div>

```bash
uv run python -m part03.ex190_log
```

```text
23:50:20 WARNING llm | Retrying __main__.chat_logged in 1.96 seconds as it raised APIConnectionError: Connection error..
23:50:22 WARNING llm | Retrying __main__.chat_logged in 2.59 seconds as it raised APIConnectionError: Connection error..
23:50:25 WARNING llm | Retrying __main__.chat_logged in 4.43 seconds as it raised APIConnectionError: Connection error..
23:50:29 ERROR llm | 4 次都失败,放弃:APIConnectionError
```

三行 WARNING 正好对应三次重试,睡的秒数 1.96、2.59、4.43 也印证了「2ⁿ⁻¹ 加 0 到 1 秒」。结尾两个句点是 tenacity 的日志模板自己带一个、SDK 的异常信息 `Connection error.` 又带一个,不是你写错了。

</details>

### 练习 3:按服务端说的 Retry-After 等

有的服务端在 429 响应里带 `Retry-After: 7`,意思是「7 秒后再来」,它比你更清楚自己什么时候能恢复。tenacity 默认不看这个头。写一个自定义的 `wait` 函数:异常带了 `retry-after` 就按它等(最多 60 秒),没带就用指数退避。用三个假 429(带 7、不带、带 3)测一下,不要真睡。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex190_retry_after.py  练习 3:服务端在 429 里写了 Retry-After,就按它说的等;没写才用指数退避
import httpx2
import openai
from tenacity import RetryCallState, retry, retry_if_exception_type, stop_after_attempt, wait_exponential_jitter

REQ = httpx2.Request("POST", "https://api.deepseek.com/chat/completions")
backoff = wait_exponential_jitter(max=20)


def wait_retry_after(state: RetryCallState) -> float:
    err = state.outcome.exception() if state.outcome else None
    if isinstance(err, openai.APIStatusError):
        value = err.response.headers.get("retry-after")
        if value and value.isdigit():
            return min(float(value), 60)  # 服务端说等多久就等多久,但别超过 60 秒
    return backoff(state)


def rate_limited(retry_after: str | None) -> openai.RateLimitError:
    headers = {"retry-after": retry_after} if retry_after else {}
    return openai.RateLimitError("429", response=httpx2.Response(429, headers=headers, request=REQ), body=None)


script = [rate_limited("7"), rate_limited(None), rate_limited("3")]
waited: list[float] = []


@retry(retry=retry_if_exception_type(openai.RateLimitError), wait=wait_retry_after,
       stop=stop_after_attempt(4), reraise=True, sleep=waited.append)
def call() -> str:
    if script:
        raise script.pop(0)
    return "200 OK"


print(call(), "| 每次等了", [round(w, 2) for w in waited])
```

<div class="line-notes">

- `backoff = wait_exponential_jitter(max=20)` 没有 `retry-after` 时用的后备策略。tenacity 的 wait 对象本身就是可调用的,传一个 `state` 进去就返回秒数。
- `def wait_retry_after(state: RetryCallState) -> float:` 自定义 wait:任何「接收 `RetryCallState`、返回秒数」的函数都可以传给 `wait=`。`RetryCallState` 是 tenacity 记录这一次重试现场的对象,里面有第几次、上次的结果或异常。
- `err = state.outcome.exception() if state.outcome else None` `outcome` 是上一次尝试的结果,`.exception()` 取出它抛的异常。
- `value = err.response.headers.get("retry-after")` SDK 的 HTTP 异常带着完整的响应对象,响应头都在。
- `if value and value.isdigit():` `Retry-After` 还可以写成一个日期,这里只处理秒数这种最常见的写法。`isdigit()` 判断是不是全由数字组成。
- `return min(float(value), 60)` 给个上限,防止服务端说「一小时后再来」把你的 Agent 挂起一小时。OpenAI SDK 自己的上限是两分钟。
- `headers = {"retry-after": retry_after} if retry_after else {}` 条件表达式,相当于 JS 的 `retryAfter ? {...} : {}`。
- `stop=stop_after_attempt(4), reraise=True, sleep=waited.append)` `sleep=` 也是 `@retry` 的参数,直接传一个假 sleep,和测试里 monkeypatch 是同一个效果。
- `print(call(), "| 每次等了", [round(w, 2) for w in waited])` `round(w, 2)` 保留两位小数。

</div>

```bash
uv run python -m part03.ex190_retry_after
```

```text
200 OK | 每次等了 [7.0, 2.2, 3.0]
```

第一次服务端说 7 秒就等 7 秒;第二次没说,用指数退避,这是第 2 次失败,所以是 2 秒加 0.2 秒抖动;第三次说 3 秒就等 3 秒。

</details>

### 练习 4:写操作超时后重试,会退两次款吗

模拟一个退款接口:第一次请求时服务端已经把退款写进了数据库,但响应在回来的路上丢了(抛 `TimeoutError`)。用 tenacity 对 `TimeoutError` 重试,看退款表里最后有几条。然后加一个幂等键再试一次。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex190_double_write.py  练习 4:写操作超时后重试,会不会退两次款?
import uuid

from tenacity import retry, retry_if_exception_type, stop_after_attempt

refunds: list[dict[str, str]] = []  # 假装是数据库里的退款表
lost_responses = 1  # 第一次请求:服务端已经写进去了,但响应在回来的路上丢了


def create_refund(order_id: str, key: str | None = None) -> str:
    global lost_responses
    if key and any(r["key"] == key for r in refunds):  # 带了幂等键:同一个键只办一次
        return f"已办过,直接返回原来的结果({key[:8]})"
    refunds.append({"order_id": order_id, "key": key or ""})
    if lost_responses:
        lost_responses -= 1
        raise TimeoutError("读响应超时")
    return f"退款单 {len(refunds)} 已创建"


@retry(retry=retry_if_exception_type(TimeoutError), stop=stop_after_attempt(3), reraise=True)
def refund_naive(order_id: str) -> str:
    return create_refund(order_id)


@retry(retry=retry_if_exception_type(TimeoutError), stop=stop_after_attempt(3), reraise=True)
def refund_with_key(order_id: str, key: str) -> str:
    return create_refund(order_id, key)


print("直接重试:", refund_naive("O1001"), "| 退款表里有", len(refunds), "条")
refunds.clear()
lost_responses = 1
print("带幂等键:", refund_with_key("O1001", uuid.uuid4().hex), "| 退款表里有", len(refunds), "条")
```

<div class="line-notes">

- `import uuid` 生成全局唯一编号的标准库,相当于浏览器里的 `crypto.randomUUID()`。
- `lost_responses = 1` 剧本:第一次请求的响应会丢。
- `if key and any(r["key"] == key for r in refunds):` 服务端的幂等检查:这个键办过就不再办。`any(...)` 相当于 JS 的 `refunds.some(r => r.key === key)`。
- `refunds.append({"order_id": order_id, "key": key or ""})` 先写库,这一步已经发生了。
- `raise TimeoutError("读响应超时")` 再让响应丢掉。客户端看到的是超时,但钱已经退了。
- `refund_with_key("O1001", uuid.uuid4().hex)` 幂等键在**重试之前**生成一次,所有重试用同一个键。如果每次重试都生成新键,就等于没有。`uuid.uuid4().hex` 是 32 位十六进制字符串,每次运行都不一样,所以你看到的 `14d5e799` 会是别的。

</div>

```bash
uv run python -m part03.ex190_double_write
```

```text
直接重试: 退款单 2 已创建 | 退款表里有 2 条
带幂等键: 已办过,直接返回原来的结果(14d5e799) | 退款表里有 1 条
```

直接重试退了两次款。带上幂等键,第二次请求被服务端认出来是同一笔,只记了一条。结论:**读操作随便重试,写操作要么带幂等键,要么不自动重试、交给人确认。** 明天讲工具超时还会撞上同样的问题。

</details>

**验收标准**:`herd_sim.py` 能说出为什么前两行一样、第三行峰值只有 111;能默写 `chat_with_retry` 上的四个参数并说出每个不写会怎样;`layer_count.py` 跑出 16 和 4,能解释 16 是怎么乘出来的;`tests/test_retry_llm.py` 4 个测试全绿,删掉 `RateLimitError` 后能看到 2 个变红;四道练习都跑出和文中同类的结果。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 重试(retry) | 操作失败后自动再做一次。只对过一会儿可能自己好的错误有用 |
| 指数退避(exponential backoff) | 每失败一次,等待时间翻倍:1、2、4、8 秒。给过载的服务越来越多的喘息时间 |
| 抖动(jitter) | 在等待时间上加一点随机数,把大量客户端的重试时刻打散 |
| 惊群(thundering herd) | 大量客户端被同一个事件触发,在同一时刻一起冲向服务端 |
| tenacity | Python 的重试库,用 `@retry(...)` 装饰器给函数加重试规则 |
| `stop` | tenacity 参数:什么时候放弃,如 `stop_after_attempt(4)` 最多调用 4 次 |
| `wait` | tenacity 参数:每次重试前等多久,如 `wait_exponential_jitter(max=20)` |
| `retry`(参数) | tenacity 参数:什么样的失败才重试,如 `retry_if_exception_type(RETRYABLE)` |
| `reraise` | tenacity 参数:放弃时抛原始异常,而不是包成 `RetryError` |
| `RetryError` | tenacity 默认在放弃时抛的异常,原始异常藏在 `.last_attempt` 里 |
| Retry-After | HTTP 响应头,服务端告诉客户端多少秒后再来。OpenAI 还用非标准的 `retry-after-ms` |
| 幂等 / 幂等键 | 同一个操作做一次和做多次结果一样。幂等键是请求带的唯一编号,服务端凭它认出重复请求 |
| 断路器(circuit breaker) | 下游连续失败时暂时不再调用、直接返回失败,过一阵再试探。第七部分讲 |

## 常见误区

**以为重试次数就是 `stop_after_attempt` 里的数。** `stop_after_attempt(4)` 是最多**调用** 4 次,也就是重试 3 次。测试里 `len(waits) == 3` 就是在钉这件事。

**忘了 `reraise=True`。** 不写的话放弃时抛 `RetryError`,外面所有 `except openai.RateLimitError` 都接不住。`tenacity_stop.py` 里两种写法的输出对比一下就记住了。

**只加指数退避不加抖动。** `herd_sim.py` 的第二行:指数退避只把重试的间隔拉开了,一千个客户端在每个重试时刻依然同时到达,峰值还是 1000。

**SDK 和 tenacity 两层都开着。** OpenAI SDK 默认自己重试 2 次,Day 135 的 `LLMClient` 设成了 3 次。外面再套 4 次的 tenacity,最坏一次调用发 16 个请求(`layer_count.py` 实测)。选一层,另一层关掉。

**把所有异常都放进重试名单。** `retry=` 不写默认是任何异常都重试,401、400 也会被重试 4 次、白等 7 秒以上。永久错误应该第一时间暴露出来。

**把重试当成模型出错的解药。** 模型把参数写坏了,原样重问大概率还是坏的。模型行为层的错误要把报错回给模型让它改(Day 170 的注册表已经在做),tenacity 只管网络层。

**写操作也自动重试。** 读超时不代表对方没做,练习 4 里退了两次款。写操作要带幂等键,或者不自动重试。

**照抄旧教程写 `initial=`。** tenacity 9.2.1 里 `wait_exponential_jitter(initial=...)` 只要不是默认值就会报 `DeprecationWarning`,新写法是 `multiplier=`。

**自己写假服务时不读请求体。** `layer_count.py` 第一版只回状态码,客户端收到 `Connection reset by peer`,SDK 报成 `APIConnectionError`,看起来像网络问题,其实是假服务写错了。

## 学习资料

### 文档与文章

- [AWS Architecture Blog · Exponential Backoff And Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/):Marc Brooker 用模拟比较了不抖动、全抖动、等量抖动、去相关抖动几种算法的总请求数和完成时间,今天 `herd_sim.py` 就是它的极简版。英文,20 分钟。
- [AWS Builders' Library · Timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/):同一作者的长文,多了「重试会放大负载」「只在一层重试」这些工程经验,和今天两层叠加那节直接对应。英文,40 分钟。
- [tenacity 官方文档](https://tenacity.readthedocs.io/en/latest/):看「Stopping」「Waiting before retrying」「Whether to retry」「Error Handling」四节,正好是今天的四个参数;「Before and After Retry, and Logging」对应练习 2。英文。
- [DeepSeek API 文档 · 错误码](https://api-docs.deepseek.com/zh-cn/quick_start/error_codes):中文,一张表列出 400/401/402/422/429/500/503 的原因和解决方法,决定哪些该重试就看这张表。
- [MDN · 429 Too Many Requests](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Status/429) 和 [MDN · Retry-After](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Retry-After):前端熟悉的地方,查状态码和响应头的标准含义,练习 3 用到。
- [openai-python README](https://github.com/openai/openai-python):搜「Retries」一节,官方说明 SDK 默认对哪些错误重试 2 次、怎么用 `max_retries` 关掉或调大。英文。
- [Stripe API · Idempotent requests](https://docs.stripe.com/api/idempotent_requests):幂等键最经典的工业实现,练习 4 的思路就来自这里。英文,10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV11jbg6VENh&autoplay=0&high_quality=1" title="大模型线上经常遇到429限流、超时、流式截断。不是简单加重试就能解决，区分可重试/不可重试异常，熔断降级、流式特殊处理，才是生产环境稳定关键" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>阡陌数智大模型聚集 · 大模型线上 429 限流、超时、流式截断 · 4 分钟,讲「区分可重试和不可重试异常」,和今天第一节完全一致,结尾提到的熔断降级是第七部分的内容。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1dvYU6EEZJ&autoplay=0&high_quality=1" title="Claude、OpenAI与Gemini API限流详解：HTTP 429、指数退避与全抖动" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>快乐的天才程序员 · Claude、OpenAI 与 Gemini API 限流详解:HTTP 429、指数退避与全抖动 · 13 分钟,三家的限流规则对比加全抖动算法,看完可以回头对照 AWS 那篇博客。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Gu411Q7JV&autoplay=0&high_quality=1" title="【python】装饰器超详细教学，用尽毕生所学给你解释清楚，以后再也不迷茫了！" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>码农高天 · 装饰器超详细教学 · 11 分钟,如果 `@retry(...)` 带括号和不带括号两种写法让你迷糊,看后半段「带参数的装饰器」。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/yGO4Igb45V0" title="Every engineer should know this (retries with jitter)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Software Developer Diaries · Every engineer should know this (retries with jitter) · 用动画演示不加抖动时的重试风暴,和今天 `herd_sim.py` 的输出对照着看,英文。</figcaption>
</figure>

### 书籍

- Michael T. Nygard《Release It!》第 2 版(Pragmatic Bookshelf, 2018):第 5 章「Stability Patterns」讲超时、断路器、稳态,第 4 章讲重试和连锁故障怎么把系统拖垮。和 AI 无关,但今天和明天的内容它讲得最透,英文。
- Betsy Beyer 等《Site Reliability Engineering》(O'Reilly, 2016),中文版《SRE:Google 运维解密》(电子工业出版社):第 22 章「Addressing Cascading Failures」讲重试为什么会放大故障、怎么限制重试。英文原文在 [sre.google 免费在线读](https://sre.google/sre-book/addressing-cascading-failures/)。

### 开源项目与代码

- [jd/tenacity](https://github.com/jd/tenacity):今天用的库。`tenacity/wait.py` 里 `wait_exponential_jitter.__call__` 只有六行,就是 `multiplier * 2**(n-1) + random.uniform(0, jitter)`,读一遍就再也不会忘它怎么算。
- [openai/openai-python](https://github.com/openai/openai-python):`src/openai/_base_client.py` 里搜 `_should_retry` 和 `_calculate_retry_timeout`,看 SDK 自己的重试规则:408/409/429/5xx 重试、从 0.5 秒起翻倍最多 8 秒、认 `retry-after-ms` 和 `retry-after`。

## 自测

1. 下面哪些错误该重试:400、401、408、429、500、503、`APIConnectionError`、`APITimeoutError`?

<details><summary>答案</summary>

该重试:408(请求超时)、429、500、503、`APIConnectionError`、`APITimeoutError`。不该重试:400(请求本身错了)、401(key 错了)。判断标准是「过一会儿再试会不会好」。

</details>

2. 只用指数退避、不加抖动,有什么问题?

<details><summary>答案</summary>

大量客户端在同一时刻失败时,它们的重试时刻依然完全一致(都在第 1、3、7 秒),每个时刻服务端还是同时收到所有人的请求。`herd_sim.py` 里不抖动的峰值是 1000,加了 0 到 1 秒抖动后峰值降到 111。

</details>

3. `@retry(stop=stop_after_attempt(4), wait=wait_exponential_jitter(max=20))` 最坏情况下要等多久?这里漏了什么参数?

<details><summary>答案</summary>

调用 4 次、等 3 次:1+2+4 秒再加 3 次 0 到 1 秒的抖动,总共 7 到 10 秒。漏了 `retry=`(默认任何异常都重试,401 也会白等)和 `reraise=True`(放弃时会抛 `RetryError` 而不是原始异常)。

</details>

4. `LLMClient` 设了 `max_retries=3`,外面又套了 `stop_after_attempt(4)` 的 tenacity,服务端一直 429,一次调用最多发出多少个请求?怎么改?

<details><summary>答案</summary>

16 个:tenacity 4 次,每次里面 SDK 又试 1+3=4 次。改法是只留一层,比如 `make_llm` 里把 SDK 的 `max_retries` 设成 0,统一由 tenacity 控制。

</details>

5. 面试题:你的 Agent 调用的模型服务偶尔返回 429。你会怎么处理?说说重试之外还要考虑什么。

<details><summary>答案</summary>

示范回答:第一步是只对临时错误(连接错误、超时、429、5xx)重试,用指数退避加抖动,设最大次数和单次等待上限,服务端给了 Retry-After 就按它等;重试只在一层做,SDK 自带的重试和外层重试不能叠加,否则请求数是乘出来的。第二步,重试用尽后不能让整个任务崩掉,要返回明确的「服务暂时不可用」状态,让上游决定提示用户还是转人工。第三步,429 频繁出现说明速率本身超了,光重试只是把问题往后推:要在客户端做限流(控制并发数、令牌桶),必要时申请更高配额,或者准备一个备用模型做降级。最后,写操作类工具的重试要有幂等键,并且用假模型写离线测试,证明会等、会停、不该重试的不重试,每次重试都打日志,便于分析延迟。

</details>

## 明天预告

明天是 **Day 191 · 失败模式(三):工具超时和结果截断**。今天治好了体检报告的第一行,模型 API 的临时错误有了重试。报告里还有两行和工具有关:工具卡住时 `run_agent` 干等 3 秒、等多久都等;工具一次返回 21 万字符时原样塞进上下文。明天用线程池给工具加超时(Python 版的 `Promise.race`),再给结果加一道截断,并用真模型看看「截断时告诉它被截了」和「悄悄截掉」会得出多不一样的结论。
