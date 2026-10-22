---
title: 'Day 191 · 失败模式(三):工具超时和结果截断'
description: '工具卡住时 Agent 不能陪着干等:把工具丢进线程池,主线程用 future.result(timeout=…) 最多等几秒,这就是 Python 版的 Promise.race。代价是线程杀不掉,超时的写操作照样在后台完成,实测退款表里多出一条。结果太长就截断,并且告诉模型「被截了」:同一份 600 行日志截到 4000 字符,悄悄截掉时模型说「未发现问题」,带提示时它会翻页,但两种都没把三个异常找全;给工具加一个 level 参数,一步就全找到了。'
pubDate: 2026-10-23
regime: none
tags: ['reliability', 'timeout', 'threading', 'agent-zero']
series: 'agent-zero'
day: 191
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 190](/blog/agent-zero/day-190-failures-2/) 治好了体检报告的第一行:模型 API 的临时错误。只重试连不上、超时、429、5xx,等待用指数退避加抖动,用 tenacity 的 `@retry` 四个参数写成了 `part03/retry_llm.py` 里的 `chat_with_retry`,还数出 SDK 和 tenacity 两层重试叠在一起会发 16 个请求。

[Day 189](/blog/agent-zero/day-189-failures-1/) 的体检报告里还有两行和工具有关。第 2 类「工具卡住」:`slow_lookup` 睡 3 秒,`run_agent` 就陪着干等 3 秒,换成 60 秒它也照等不误。第 7 类「结果过长」:`dump_logs` 返回 21 万字符,原样塞进了上下文。今天把这两行治好。

## 今天要解决的问题

学完你应该能:

1. 用 `ThreadPoolExecutor` 加 `future.result(timeout=...)` 给任何一个工具加上「最多等几秒」,并说出它和 JS 里 `Promise.race` 的对应关系。
2. 说出这种超时的两个代价:超时的线程杀不掉、还在后台跑;写操作超时了不等于没做。并用实验证明。
3. 给工具结果加一道截断,截断时附上「被截了、原来多长、怎么查得更准」的提示,并用真模型对比带提示和不带提示的差别。
4. 把超时和截断包成 `GuardedRegistry`,让 Day 170 的 `run_agent` 一行不改就用上。

今天两个新概念:**线程池超时**和**结果截断**。

预计用时 2.5 小时。前置:[Day 189](/blog/agent-zero/day-189-failures-1/)(`failure_zoo.py` 里的 `FakeLLM`、`CASES`、`reg`)、[Day 170](/blog/agent-zero/day-170-agent-full/)(`ToolRegistry`、`run_agent`)、[Day 187](/blog/agent-zero/day-187-codeact-2/)(子进程和墙钟超时)、[Day 42](/blog/agent-zero/day-042-classes-2/)(继承和 `super()`)、[Day 182](/blog/agent-zero/day-182-tool-design-2/)(六条原则里「返回值有上限、能翻页」)。代码在 `agent-zero-lab/part03/` 和 `tests/`,命令都在 `agent-zero-lab/` 根目录跑。今天真调模型 5 次运行,一共花了 ¥0.073,算式在文中。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `part03/tool_guard.py` 里的 `guarded_call` 和 `truncate`;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 为什么工具会卡住,为什么要两道超时

工具卡住的原因五花八门:外部接口变慢,数据库锁住,第三方库在等一个永远不会来的响应。从 Agent 的角度看,它们都是同一个现象:**调用发出去了,一直不返回。** 没有报错,不会触发 Day 170 注册表里的 `try/except`,用户那边就是一直在转圈。

治法分两层。

第一层在工具内部:工具里每一个发网络请求的地方都设超时,比如 [Day 70](/blog/agent-zero/day-070-weather-project/) 的天气 CLI,[Day 74](/blog/agent-zero/day-074-pytest-4/) 让它的超时读环境变量 `WEATHER_TIMEOUT`。这是最好的办法,因为工具自己最清楚该等多久,超时后它还能做清理。**能在工具内部设超时的,一律设。**

第二层在 Agent 循环:循环不信任任何工具,每个工具调用都套一个总超时。它兜的是你控制不了的情况:第三方库内部没设超时、同事写的工具忘了设、某个计算本身就跑不完。今天讲的是这一层。

[Day 187](/blog/agent-zero/day-187-codeact-2/) 其实已经做过一次超时:`run_code` 把模型写的代码放进**子进程**,超时就把子进程杀掉。那招对付不了今天的情况,因为普通工具就是我们自己进程里的一个 Python 函数,没有单独的进程可杀。我们需要另一种办法:让工具在另一条「线」上跑,主线只等一会儿。

## 线程和线程池

先说**线程**(thread)。一个进程([Day 77](/blog/agent-zero/day-077-server-1/) 讲过,一个运行中的程序)里可以有好几条同时往前走的执行路线,每条叫一个线程。你的 Python 脚本默认只有一条,叫主线程,代码一行一行往下跑,遇到 `time.sleep(3)` 整条线就停 3 秒。如果开第二条线程去跑那个慢工具,主线程就可以不管它、自己往下走。

前端对照:浏览器的 JS 主线程也只有一条,你写过 `while(true){}` 就知道页面会整个卡死。Web Worker 就是另开一条线程跑耗时的活。不同的是,Python 的线程共享同一份内存,开起来比 Web Worker 轻得多。

**线程池**(thread pool)是预先准备好的几条线程,有活就派给空闲的那条,干完回到池子里等下一个活。Python 标准库的 `concurrent.futures.ThreadPoolExecutor` 就是一个线程池,用法只有两步:

- `pool.submit(函数, 参数...)`:把活派出去,**立刻**返回一个 `Future` 对象,这时函数已经在另一条线程上开始跑了。`Future` 就是「将来会有结果的一张单据」,和 JS 的 Promise 几乎是一个东西。
- `future.result(timeout=秒数)`:主线程拿着单据等结果,最多等这么多秒。等到了就返回结果;等不到就抛 `TimeoutError`。

所以「给工具加超时」在 JS 里大概是这样:

```javascript
// 对照用,不用跑:JS 里给一个慢函数加 1 秒超时
const result = await Promise.race([
  callTool(),
  new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1000)),
]);
```

Python 里对应的就是 `pool.submit(...)` 加 `future.result(timeout=1)`。跑一下看看:

```python
# agent-zero-lab/part03/pool_timeout.py  把卡住的工具丢进线程池,主线程最多等 1 秒
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as ToolTimeout

start = time.perf_counter()


def slow_lookup(order_id: str) -> str:
    time.sleep(3)  # 外部接口卡了 3 秒
    print(f"[{time.perf_counter() - start:.1f}s] slow_lookup 其实还在跑,现在才做完")
    return f"{order_id}: paid"


pool = ThreadPoolExecutor(max_workers=4)
future = pool.submit(slow_lookup, "O1001")  # 立刻返回,工具在另一个线程里开始跑
print(f"[{time.perf_counter() - start:.1f}s] 已提交,拿到 {future}")
try:
    print(future.result(timeout=1))  # 最多等 1 秒
except ToolTimeout:
    print(f"[{time.perf_counter() - start:.1f}s] 等了 1 秒没结果,不等了,告诉模型超时")
print(f"[{time.perf_counter() - start:.1f}s] 主线程继续干别的;脚本快结束了")
```

<div class="line-notes">

- `from concurrent.futures import ThreadPoolExecutor` 线程池,标准库自带,不用装。
- `from concurrent.futures import TimeoutError as ToolTimeout` `as` 起别名。`concurrent.futures.TimeoutError` 和 Python 内置的 `TimeoutError` 同名(Python 3.11 起它们其实就是同一个类),改叫 `ToolTimeout` 是为了下面 `except ToolTimeout:` 一眼看出接的是「工具超时」。
- `start = time.perf_counter()` 掐表,所有打印都带上「从开始到现在过了几秒」。
- `time.sleep(3)  # 外部接口卡了 3 秒` 模拟一个卡住的工具,和 Day 189 的 `slow_lookup` 一样。
- `print(f"[{time.perf_counter() - start:.1f}s] slow_lookup 其实还在跑,现在才做完")` 工具睡醒后打一行。看这行在什么时候出现,就知道超时之后它到底停没停。
- `pool = ThreadPoolExecutor(max_workers=4)` 建一个最多 4 条线程的池子。为什么是 4,后面专门做实验。
- `future = pool.submit(slow_lookup, "O1001")` 注意是把**函数本身**和参数分开传,不是 `pool.submit(slow_lookup("O1001"))`。后者会在主线程里先把函数跑完(卡 3 秒),再把结果交给池子,超时就白加了。JS 里同样的坑是 `setTimeout(f(), 1000)` 和 `setTimeout(f, 1000)` 的区别。
- `print(f"[{time.perf_counter() - start:.1f}s] 已提交,拿到 {future}")` 打印 `Future` 对象本身,能看到它此刻的状态。
- `print(future.result(timeout=1))  # 最多等 1 秒` 主线程在这里最多停 1 秒。
- `except ToolTimeout:` 1 秒到了还没结果,`result` 抛超时异常,我们接住。真实代码里这里会返回一段报错给模型。

</div>

```bash
cd /Users/你/agent-zero-lab
uv run python -m part03.pool_timeout
```

```text
[0.0s] 已提交,拿到 <Future at 0x10ce24740 state=running>
[1.0s] 等了 1 秒没结果,不等了,告诉模型超时
[1.0s] 主线程继续干别的;脚本快结束了
[3.0s] slow_lookup 其实还在跑,现在才做完
```

逐行看:

- 第 0 秒,`submit` 马上返回,`state=running` 说明工具已经在另一条线程上跑起来了。
- 第 1 秒,主线程等够 1 秒,放弃,继续往下走。这正是我们要的:Agent 不再陪着卡。
- 但最后一行出现在第 3 秒:**工具根本没停**,它在后台睡满 3 秒,做完了自己的事。主线程只是「不等它了」,并没有「杀掉它」。而且脚本最后一行打印完以后,进程并没有马上退出,而是等那条线程跑完才退出(练习 4 会量这个时间)。

这就是线程池超时最重要的局限:**Python 没有办法从外面强行杀掉一条线程。** 这是语言层面的设计,强杀线程可能让它拿着的锁永远不释放、写了一半的数据永远写一半。Day 187 用子进程能杀,是因为进程之间不共享内存,杀掉一个不会弄坏另一个。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="时间线:主线程在第 0 秒提交工具,等到第 1 秒超时后继续往下走;工作线程上的工具一直跑到第 3 秒才结束">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
  <line x1="100" y1="190" x2="610" y2="190" stroke="var(--rule)"/>
  <text x="100" y="208" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">0s</text>
  <text x="260" y="208" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">1s</text>
  <text x="420" y="208" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">2s</text>
  <text x="580" y="208" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">3s</text>
  <text x="20" y="64" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">主线程</text>
  <rect x="100" y="50" width="160" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="180" y="65" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">result(timeout=1)</text>
  <rect x="262" y="50" width="120" height="22" fill="var(--paper)" stroke="var(--mem)"/>
  <text x="322" y="65" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">回报错给模型</text>
  <text x="400" y="65" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">Agent 继续下一步</text>
  <text x="20" y="134" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">工作线程</text>
  <rect x="100" y="120" width="480" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="340" y="135" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">slow_lookup 睡 3 秒,超时后照样跑完</text>
  <line x1="260" y1="40" x2="260" y2="180" stroke="var(--ink)" stroke-dasharray="4 3"/>
  <text x="266" y="100" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">超时:不等了,但没杀掉</text>
</svg>
<figcaption>线程池超时只管「主线程最多等多久」。工具所在的工作线程不受影响,一直跑到自己结束。</figcaption>
</figure>

## 代价一:超时了不等于没做

线程杀不掉,带来一个很实际的问题:如果超时的工具是**写操作**呢?

```python
# agent-zero-lab/part03/pool_side_effect.py  超时了不等于没做:写操作在后台照样完成
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as ToolTimeout

refunds: list[str] = []  # 假装是数据库里的退款表


def create_refund(order_id: str) -> str:
    time.sleep(2)  # 支付网关慢
    refunds.append(order_id)
    return f"{order_id} 退款成功"


pool = ThreadPoolExecutor(max_workers=4)
for attempt in [1, 2]:  # 模型以为第一次失败了,又调了一次
    try:
        print(pool.submit(create_refund, "O1001").result(timeout=1))
    except ToolTimeout:
        print(f"第 {attempt} 次:超时,告诉模型「退款没成功」")
pool.shutdown(wait=True)  # 等后台线程都跑完再看结果
print("退款表:", refunds)
```

<div class="line-notes">

- `refunds: list[str] = []  # 假装是数据库里的退款表` 两条线程都会往这个列表里写。线程共享内存,所以工作线程写进去的东西,主线程能看见。
- `time.sleep(2)  # 支付网关慢` 退款要 2 秒,超时只给 1 秒。
- `refunds.append(order_id)` 写库。注意它在 `sleep` 之后,也就是第 2 秒才发生,那时主线程早就「超时放弃」了。
- `for attempt in [1, 2]:  # 模型以为第一次失败了,又调了一次` 模拟 Agent 的真实反应:看到超时报错,模型很可能换个时间再调一次同一个工具。
- `print(pool.submit(create_refund, "O1001").result(timeout=1))` `submit` 和 `result` 连写在一行,先派活再最多等 1 秒。
- `pool.shutdown(wait=True)` 关闭线程池,`wait=True` 表示等所有已经开始的活都干完再返回。这样下一行打印的就是最终的退款表。

</div>

```bash
uv run python -m part03.pool_side_effect
```

```text
第 1 次:超时,告诉模型「退款没成功」
第 2 次:超时,告诉模型「退款没成功」
退款表: ['O1001', 'O1001']
```

两次都告诉模型「没成功」,结果退款表里有两条。模型被骗了两次,客户被退了两次款。[Day 190](/blog/agent-zero/day-190-failures-2/) 练习 4 用 tenacity 重试时撞上过一模一样的事,这回是超时加上模型自己的「重试」。

两个对策:

- 写操作带**幂等键**,同一个键对方只办一次(Day 190 练习 4)。
- 超时报错的措辞要诚实。别说「退款失败」,要说「工具超过 N 秒没有返回,**结果未知**」,并让模型在重试前先查一下状态。今天 `guarded_call` 里的报错写的是「超过 N 秒没有返回」,没说失败,就是这个原因。

## 代价二:线程池为什么给 4 条,不给 1 条

既然超时的线程杀不掉,它就一直占着池子里的一个名额,直到自己跑完。如果池子只有 1 条线程会怎样?

```python
# agent-zero-lab/part03/pool_starve.py  max_workers 给 1 会怎样:一个工具卡住,后面的快工具也跟着超时
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as ToolTimeout


def stuck() -> str:
    time.sleep(5)
    return "stuck 终于返回"


def fast() -> str:
    return "fast 立刻返回"


for workers in [1, 4]:
    pool = ThreadPoolExecutor(max_workers=workers)
    for fn in [stuck, fast]:
        start = time.perf_counter()
        try:
            out = pool.submit(fn).result(timeout=1)
        except ToolTimeout:
            out = "超时"
        print(f"max_workers={workers} | {fn.__name__:5} -> {out}({time.perf_counter() - start:.1f} 秒)")
    pool.shutdown(wait=False, cancel_futures=True)  # 不等卡住的线程,排队没开始的直接取消
```

<div class="line-notes">

- `def stuck() -> str:` 卡 5 秒的工具。
- `def fast() -> str:` 本来一瞬间就能返回的工具。
- `for workers in [1, 4]:` 先 1 条线程,再 4 条,对比。
- `for fn in [stuck, fast]:` 先调卡住的,紧接着调快的。函数在 Python 里是普通的值,能放进列表遍历。
- `out = pool.submit(fn).result(timeout=1)` 每个工具都最多等 1 秒。
- `{fn.__name__:5}` `__name__` 是函数的名字字符串,`stuck` 或 `fast`。
- `pool.shutdown(wait=False, cancel_futures=True)` `wait=False` 不等卡住的线程跑完;`cancel_futures=True` 把还在排队、没开始跑的活直接取消。

</div>

```bash
time uv run python -m part03.pool_starve
```

```text
max_workers=1 | stuck -> 超时(1.0 秒)
max_workers=1 | fast  -> 超时(1.0 秒)
max_workers=4 | stuck -> 超时(1.0 秒)
max_workers=4 | fast  -> fast 立刻返回(0.0 秒)
uv run python -m part03.pool_starve  0.09s user 0.04s system 1% cpu 7.168 total
```

只有 1 条线程时,`stuck` 超时后还占着那唯一的线程,`fast` 只能排队,排了 1 秒也没轮到,冤枉地超时了。4 条线程时,`stuck` 占一条,`fast` 用另一条,立刻返回。

最后一行是 `time` 命令打的,`7.168 total` 是整个脚本的墙钟时间。两轮各有一个 `stuck` 在后台睡 5 秒,虽然我们 `shutdown(wait=False)` 不等它们,Python 进程退出时还是要等所有线程结束,所以总时间是 2 秒(两轮的超时)加上第二个 `stuck` 剩下的 5 秒左右。

所以 `max_workers` 要留余量:偶尔卡住一两个,后面的工具还有空线程用。就算 4 条全卡住,新来的工具排队的时间也算在它自己的超时里,照样会超时返回,Agent 不会永远停住。

## 结果截断:截掉,还要说一声

第二个问题,工具返回太长。Day 189 的 `dump_logs` 一次返回 210,002 个字符,原样进了上下文。

治本的办法在工具设计上,[Day 182](/blog/agent-zero/day-182-tool-design-2/) 讲过:返回值要有上限、带总数、能翻页、能过滤。Anthropic 那篇《Writing effective tools for agents》也说他们在 Claude Code 里默认把工具响应限制在 25,000 token 以内,并建议对可能很大的结果做分页、范围选择、过滤或截断。

但循环这一层还要有一道兜底:不管工具写得怎样,单个结果超过 N 个字符就截断。截断的关键在后半句:**告诉模型被截了。** 只截不说,模型会以为数据就这么多,然后基于残缺的数据下结论。

```python
# agent-zero-lab/part03/truncate_demo.py  工具结果太长就截断,并且告诉模型「被截了」
import json


def truncate(out: str, max_chars: int = 4000) -> str:
    if len(out) <= max_chars:
        return out
    note = f"\n…[结果过长,已截断:共 {len(out)} 字符,只显示前 {max_chars}。需要的话请用更精确的参数重新查询]"
    return out[:max_chars] + note


logs = "2026-10-22 INFO request ok\n" * 7500  # Day 189 dump_logs 的返回
raw = json.dumps(logs, ensure_ascii=False)  # registry.call 会把返回值转成 JSON 字符串
short = truncate(raw)
print(f"原始 {len(raw)} 字符 -> 截断后 {len(short)} 字符")
print("结尾长这样:", short[-90:])
print("短结果原样返回:", truncate('{"city": "杭州", "temp": 21}'))
```

<div class="line-notes">

- `def truncate(out: str, max_chars: int = 4000) -> str:` 默认 4000 字符。中文日志大概每 1.5 到 2 个字符一个 token,4000 字符是两三千 token,一步重发几十次也不心疼。这个数没有标准答案,要按你的模型窗口和价格定。
- `if len(out) <= max_chars:` 不长就原样返回,绝大多数工具结果走这条路。
- `note = f"\n…[结果过长,已截断:共 {len(out)} 字符,只显示前 {max_chars}。需要的话请用更精确的参数重新查询]"` 提示里三样东西:被截了、原来多长、下一步怎么办。「原来多长」让模型知道自己只看到了 2%,「怎么办」引导它换参数,而不是基于这 2% 下结论。
- `return out[:max_chars] + note` 切片取前 4000 个字符,相当于 JS 的 `out.slice(0, 4000)`。
- `logs = "2026-10-22 INFO request ok\n" * 7500` Day 189 的 `dump_logs` 返回的就是这个,27 个字符重复 7500 遍,202,500 个字符。
- `raw = json.dumps(logs, ensure_ascii=False)` Day 170 注册表的 `call` 最后会 `json.dumps` 一下工具的返回值。字符串经过 JSON 编码,每个换行 `\n` 变成两个字符的 `\\n`,再加首尾两个引号,所以变成 202,500 + 7,500 + 2 = 210,002 个字符,正好是 Day 189 输出里那个数。
- `print("结尾长这样:", short[-90:])` 负数切片取最后 90 个字符,相当于 JS 的 `slice(-90)`。

</div>

```bash
uv run python -m part03.truncate_demo
```

```text
原始 210002 字符 -> 截断后 4051 字符
结尾长这样: NFO request ok\n2026-10-22 INFO request
…[结果过长,已截断:共 210002 字符,只显示前 4000。需要的话请用更精确的参数重新查询]
短结果原样返回: {"city": "杭州", "temp": 21}
```

21 万字符变成了 4051 个,多出来的 51 个是那句提示。注意截断处把一行日志从中间切开了(`INFO request` 后面的 `ok` 没了),还把 JSON 字符串的结尾引号切掉了,截断后的内容已经不是合法的 JSON。对模型来说这不要紧,它读的是文字,不是解析器;但如果你的代码之后要 `json.loads` 这个结果,就会出错。所以截断只放在「结果交给模型之前」这一步做。

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="截断示意:21 万字符的工具结果只保留前 4000 字符,再追加一句说明原来多长、怎么查得更准">
  <rect x="0" y="0" width="640" height="200" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="30" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">工具原始返回:210,002 字符</text>
  <rect x="20" y="42" width="600" height="26" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <rect x="20" y="42" width="12" height="26" fill="var(--compute)"/>
  <text x="40" y="60" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">前 4000(约 2%)</text>
  <text x="20" y="104" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">进上下文的:</text>
  <rect x="20" y="116" width="120" height="26" fill="var(--compute)"/>
  <text x="80" y="134" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--paper)">4000 字符</text>
  <rect x="140" y="116" width="480" height="26" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="380" y="134" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">…[已截断:共 210002 字符,只显示前 4000,请用更精确的参数]</text>
  <text x="20" y="180" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">琥珀:工具给的数据 · 蓝:循环加给模型的说明,告诉它看到的只是一小部分</text>
</svg>
<figcaption>截断时最重要的不是砍掉多少,而是那句说明:被截了、原来多长、怎么查得更准。</figcaption>
</figure>

## 合起来:GuardedRegistry

超时和截断都写好了,下一步是接进 Agent。最省事的接法是**不改 `run_agent`**:Day 170 的 `run_agent` 执行工具时调的是 `registry.call(name, args)`,那我们就写一个 `ToolRegistry` 的子类,把 `call` 换成带超时和截断的版本。`run_agent` 拿到的还是一个「注册表」,根本不知道里面变了。

继承和 `super()` 在 [Day 42](/blog/agent-zero/day-042-classes-2/) 学过,提醒一句:子类里写 `super().call(...)`,调的是父类原来那个 `call`。JS 的 `class A extends B` 里 `super.call(...)` 是一回事。

```python
# agent-zero-lab/part03/tool_guard.py  Day 191:工具调用加超时和结果截断。Day 193 的 robust_agent 会导入它
import json
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as ToolTimeout

from part03.agent_loop import ToolRegistry

POOL = ThreadPoolExecutor(max_workers=4)  # 主要为了能限时等待,不是为了并发


def truncate(out: str, max_chars: int = 4000) -> str:
    if len(out) <= max_chars:
        return out
    note = f"\n…[结果过长,已截断:共 {len(out)} 字符,只显示前 {max_chars}。需要的话请用更精确的参数重新查询]"
    return out[:max_chars] + note


def guarded_call(call: Callable[[str, str], str], name: str, arguments: str,
                 timeout: float = 15, max_chars: int = 4000) -> str:
    """在线程池里执行 call(name, arguments),超时返回报错,结果过长就截断。"""
    future = POOL.submit(call, name, arguments)
    try:
        out = future.result(timeout=timeout)
    except ToolTimeout:
        return json.dumps({"error": f"工具 {name} 超过 {timeout} 秒没有返回。可以换个参数重试,或者告诉用户暂时查不到。"},
                          ensure_ascii=False)
    return truncate(out, max_chars)


class GuardedRegistry(ToolRegistry):
    """和 Day 170 的注册表一样用,只是每次 call 都带超时和截断。run_agent 一行不用改。"""

    def __init__(self, timeout: float = 15, max_chars: int = 4000) -> None:
        super().__init__()
        self.timeout = timeout
        self.max_chars = max_chars

    def timeout_for(self, name: str) -> float:
        return self.timeout  # 所有工具一个超时;想按工具区分,子类改这一个方法(练习 2)

    def call(self, name: str, arguments: str) -> str:
        return guarded_call(super().call, name, arguments, self.timeout_for(name), self.max_chars)
```

<div class="line-notes">

- `from collections.abc import Callable` 函数类型的标注。`Callable[[str, str], str]` 读作「接收两个 str、返回 str 的函数」,相当于 TS 的 `(name: string, args: string) => string`。
- `from part03.agent_loop import ToolRegistry` Day 170 的注册表,我们要继承它。
- `POOL = ThreadPoolExecutor(max_workers=4)` 模块级的线程池,整个程序共用一个,不要每次调工具都新建一个(新建池子就要新建线程,慢,还会留下一堆杀不掉的线程)。
- `def truncate(out: str, max_chars: int = 4000) -> str:` 和 `truncate_demo.py` 里的一字不差,搬进模块。
- `def guarded_call(call: Callable[[str, str], str], name: str, arguments: str,` 第一个参数是「真正执行工具的那个函数」,由调用方传进来。这样 `guarded_call` 不关心工具怎么执行,只管超时和截断,Day 193 的 Agent 也能直接用它。
- `timeout: float = 15, max_chars: int = 4000) -> str:` 默认 15 秒、4000 字符。
- `future = POOL.submit(call, name, arguments)` 把 `call(name, arguments)` 派到池子里。
- `out = future.result(timeout=timeout)` 最多等 `timeout` 秒。
- `return json.dumps({"error": f"工具 {name} 超过 {timeout} 秒没有返回。可以换个参数重试,或者告诉用户暂时查不到。"},` 超时不抛异常,变成和 Day 170 注册表一样格式的 `{"error": ...}` 字符串,模型下一步看得懂。措辞是「没有返回」而不是「失败了」,原因见上面代价一。还告诉模型两条出路(Day 182 原则六:报错要指导下一步)。
- `return truncate(out, max_chars)` 正常返回的结果,过一遍截断。
- `class GuardedRegistry(ToolRegistry):` 继承 Day 170 的注册表,`@reg.tool` 登记工具、`reg.schemas` 生成说明书这些本事全部白拿。
- `super().__init__()` 先让父类把 `funcs` 和 `schemas` 两个字典建好,再加自己的两个属性。
- `def timeout_for(self, name: str) -> float:` 单独拎出一个小方法回答「这个工具超时给几秒」。现在所有工具一样,练习 2 的子类只要改这一个方法就能按工具区分。
- `return guarded_call(super().call, name, arguments, self.timeout_for(name), self.max_chars)` 关键一行。`super().call` 是父类那个「找函数、解析参数、执行、出错转成报错」的 `call`,我们把它当参数交给 `guarded_call`,让它在线程池里跑。注意不能传 `self.call`,那是我们自己这个新 `call`,会自己调自己,无限递归。

</div>

用它重跑 Day 189 体检报告的第 2 类和第 7 类。`failure_zoo.py` 里的工具都登记在 `reg` 上,我们把它的 `funcs` 和 `schemas` 原样搬到一个 `GuardedRegistry` 里,只换 `call`:

```python
# agent-zero-lab/part03/failure_zoo_191.py  换上 GuardedRegistry,重跑 Day 189 体检报告里的第 2、7 类
import time

from part03 import agent_loop
from part03.agent_loop import run_agent
from part03.failure_zoo import CASES, FakeLLM, reg
from part03.tool_guard import GuardedRegistry

greg = GuardedRegistry(timeout=1, max_chars=4000)
greg.funcs, greg.schemas = reg.funcs, reg.schemas  # 工具原样搬过来,只换 call

for name in ["2 工具卡住", "7 结果过长"]:
    fake = FakeLLM(CASES[name])
    agent_loop.LLMClient = lambda: fake  # type: ignore[assignment,misc]
    start = time.perf_counter()
    answer, _ = run_agent(greg, "你是助手。", "帮我查一下。", max_steps=6)
    print(f"-> {name}:上下文最大 {max(fake.seen_chars)} 字符 | 耗时 {time.perf_counter() - start:.1f} 秒\n")
```

<div class="line-notes">

- `from part03.failure_zoo import CASES, FakeLLM, reg` Day 189 的假模型、九类剧本、登记了四个工具的注册表。`failure_zoo.py` 的主程序写在 `if __name__ == "__main__":` 里,导入时不会跑。
- `greg = GuardedRegistry(timeout=1, max_chars=4000)` 超时给 1 秒,`slow_lookup` 要 3 秒,必然超时。
- `greg.funcs, greg.schemas = reg.funcs, reg.schemas` 直接共用那两个字典,工具不用重新登记一遍。
- `agent_loop.LLMClient = lambda: fake  # type: ignore[assignment,misc]` Day 189 的 monkeypatch:让 `run_agent` 里 `LLMClient()` new 出来的就是假模型。
- `answer, _ = run_agent(greg, "你是助手。", "帮我查一下。", max_steps=6)` 传进去的是 `greg`。`run_agent` 一行没改。
- `max(fake.seen_chars)` 假模型每次被调时记下 messages 的字符数,取最大值就是「上下文最大的那一步」。

</div>

```bash
uv run python -m part03.failure_zoo_191
```

```text
[step 1] 输入 0 tok | 输出 0 tok
    调用 slow_lookup({"order_id": "O1"}) -> 返回 60 字符
[step 2] 输入 0 tok | 输出 0 tok
-> 2 工具卡住:上下文最大 370 字符 | 耗时 1.0 秒

[step 1] 输入 0 tok | 输出 0 tok
    调用 dump_logs({"day": "2026-10-22"}) -> 返回 4051 字符
[step 2] 输入 0 tok | 输出 0 tok
-> 7 结果过长:上下文最大 4502 字符 | 耗时 0.0 秒
```

对照 Day 189 的体检报告:

| 类 | Day 189 | 今天 |
| --- | --- | --- |
| 2 工具卡住 | 干等 3 秒 | 1 秒后返回 60 字符的超时报错,模型照常走第 2 步 |
| 7 结果过长 | 上下文最大 217,811 字符 | 上下文最大 4,502 字符 |

两行从「没有」变成了「接住了」。

## 真模型:截断时说不说,结论差多少

上面的假模型不管看到什么都回「这是最终回答」,证明不了那句提示有没有用。换真模型做个对照实验。

造一份 600 行的服务日志,大部分是 `INFO GET /api/orders 200`,在第 300、450、590 行藏三个问题:两个 ERROR 一个 WARN。工具 `read_logs(day, start_line)` 返回从某行开始到结尾的全部日志,600 行大约 2.5 万字符,截到 4000 只能看到前八九十行,三个问题全在截掉的部分。然后问模型:「看看 2026-10-22 的日志,系统今天有没有出什么问题?」

两组:一组用 `GuardedRegistry`(截断加提示),一组用 `SilentCut`(只截不说)。

```python
# agent-zero-lab/part03/truncate_real.py  真模型:同样截到 4000 字符,带提示和不带提示,模型的结论一样吗?
import sys

from part03.agent_loop import ToolRegistry, run_agent
from part03.tool_guard import GuardedRegistry

LINES = [f"2026-10-22 10:{i // 60 % 60:02d}:{i % 60:02d} INFO GET /api/orders 200" for i in range(600)]
for i, msg in [(300, "ERROR 支付网关超时 order=O1042"), (450, "ERROR 数据库连接池耗尽"), (590, "WARN 磁盘使用率 91%")]:
    LINES[i] = f"2026-10-22 10:{i // 60 % 60:02d}:{i % 60:02d} {msg}"


def read_logs(day: str, start_line: int = 0) -> str:
    """读某一天的服务日志,从第 start_line 行开始往后读到最后。"""
    rows = [x for x in LINES if x.startswith(day)]
    return "\n".join(rows[start_line:])


class SilentCut(ToolRegistry):
    def call(self, name: str, arguments: str) -> str:
        return super().call(name, arguments)[:4000]  # 只截,不说


if __name__ == "__main__":
    registries = {"不带提示": SilentCut(), "带提示": GuardedRegistry(max_chars=4000)}
    reg = registries[sys.argv[1]]
    reg.tool(read_logs)
    answer, llm = run_agent(reg, "你是运维助手,回答要简短。", "看看 2026-10-22 的日志,系统今天有没有出什么问题?", max_steps=10)
    print("回答:", answer)
    print(llm.ledger)
```

<div class="line-notes">

- `LINES = [f"2026-10-22 10:{i // 60 % 60:02d}:{i % 60:02d} INFO GET /api/orders 200" for i in range(600)]` 列表推导式生成 600 行。第 i 行的时间是 10 点 `i // 60` 分 `i % 60` 秒,`//` 是整除,`:02d` 补成两位。比如第 300 行是 `10:05:00`。
- `for i, msg in [(300, "ERROR 支付网关超时 order=O1042"), (450, "ERROR 数据库连接池耗尽"), (590, "WARN 磁盘使用率 91%")]:` 把三行换成问题。它们分别在 10:05:00、10:07:30、10:09:50。
- `def read_logs(day: str, start_line: int = 0) -> str:` 工具故意设计得很朴素:只能从某行开始读到结尾,没有过滤。这种工具在真实项目里很常见。
- `return "\n".join(rows[start_line:])` 用换行把行拼起来,相当于 JS 的 `rows.slice(startLine).join("\n")`。
- `class SilentCut(ToolRegistry):` 对照组:截到 4000,一个字的提示都不加。
- `return super().call(name, arguments)[:4000]  # 只截,不说` 父类的 `call` 返回完整结果,我们只取前 4000 个字符。
- `if __name__ == "__main__":` 下面的代码只在直接运行时执行。练习 3 要从这个文件导入 `LINES`,有了这个守卫,导入时就不会跑一遍 Agent。
- `reg = registries[sys.argv[1]]` 命令行第一个参数选组:`不带提示` 或 `带提示`。`sys.argv` 相当于 Node 的 `process.argv.slice(1)`。
- `reg.tool(read_logs)` 不用 `@` 语法,直接把函数交给 `reg.tool` 登记,效果一样。`@reg.tool` 只是这行的语法糖。
- `max_steps=10` 给足步数,让模型有机会翻页。

</div>

```bash
uv run python -m part03.truncate_real 不带提示
```

```text
[step 1] 输入 311 tok | 输出 72 tok
    调用 read_logs({"day": "2026-10-22", "start_line": 1}) -> 返回 4000 字符
[step 2] 输入 2221 tok | 输出 91 tok
    调用 read_logs({"day": "2026-10-22", "start_line": 88}) -> 返回 4000 字符
[step 3] 输入 4150 tok | 输出 57 tok
回答: 日志内容仍然全部是正常的 `200` 响应，没有错误或异常。今天读取到的日志区间（10:00:01–10:02:54）内系统运行正常，未发现问题。

如果担心后面时段有问题，可以告诉我从哪一行继续查。
3 次调用 | 输入 6682 / 输出 220 tokens | 约 ¥0.0101
```

```bash
uv run python -m part03.truncate_real 带提示
```

```text
[step 1] 输入 311 tok | 输出 60 tok
    调用 read_logs({"day": "2026-10-22", "start_line": 1}) -> 返回 4050 字符
[step 2] 输入 2243 tok | 输出 95 tok
    调用 read_logs({"day": "2026-10-22", "start_line": 200}) -> 返回 4050 字符
[step 3] 输入 4210 tok | 输出 69 tok
    调用 read_logs({"day": "2026-10-22", "start_line": 450}) -> 返回 4049 字符
[step 4] 输入 6154 tok | 输出 70 tok
    调用 read_logs({"day": "2026-10-22", "start_line": 540}) -> 返回 2750 字符
[step 5] 输入 7497 tok | 输出 72 tok
    调用 read_logs({"day": "2026-10-22", "start_line": 600}) -> 返回 2 字符
[step 6] 输入 7582 tok | 输出 106 tok
回答: 今天日志到此结束（10:09:59）。结论：

**发现 2 个问题：**
1. **10:07:30 ERROR 数据库连接池耗尽** — 较严重，需立即检查连接泄漏/慢查询、连接池配置。
2. **10:09:50 WARN 磁盘使用率 91%** — 接近阈值，建议清理日志/临时文件并扩容。

其余日志均为正常的 `GET /api/orders 200`，无其他报错。
6 次调用 | 输入 27997 / 输出 472 tokens | 约 ¥0.0196
```

先看结论。不带提示那组翻了一页,看到的全是 200,结论是「未发现问题」,虽然加了一句「担心后面可以告诉我从哪一行继续查」,但它并不知道后面还有五百多行。如果这是给值班工程师的回答,他会放心地去睡觉。

带提示那组看到了「共 25,000 多字符,只显示前 4000」,于是一路翻页翻到结尾(`start_line=600` 返回 2 个字符,就是一对空引号),找到了数据库连接池和磁盘两个问题。**但它漏了第 300 行的支付网关超时。** 看它的翻页轨迹:1、200、450、540。从第 200 行开始读 4000 字符,只能看到第 200 到第 285 行左右,下一页它直接跳到了 450,中间 286 到 449 行一眼没看,第 300 行的 ERROR 就在这个缝里。它为什么跳这么大,我们不知道,大概是想「快点翻完」。

两组我各跑了第二次,结果又不一样:

```text
--- 不带提示
    调用 read_logs({"day": "2026-10-22", "start_line": 1}) -> 返回 4000 字符
    调用 read_logs({"day": "2026-10-22", "start_line": 90}) -> 返回 4000 字符
    调用 read_logs({"day": "2026-10-22", "start_line": 180}) -> 返回 4000 字符
    调用 read_logs({"day": "2026-10-22", "start_line": 270}) -> 返回 4000 字符
    调用 read_logs({"day": "2026-10-22", "start_line": 360}) -> 返回 4000 字符
回答: ## 结论:有 1 个问题
6 次调用 | 输入 30718 / 输出 589 tokens | 约 ¥0.0248
--- 带提示
    调用 read_logs({"day": "2026-10-22", "start_line": 1}) -> 返回 4050 字符
    调用 read_logs({"day": "2026-10-22", "start_line": 200}) -> 返回 4050 字符
    调用 read_logs({"day": "2026-10-22", "start_line": 400}) -> 返回 4049 字符
    调用 read_logs({"day": "2026-10-22", "start_line": 520}) -> 返回 3670 字符
回答: 今天有两个问题点：
5 次调用 | 输入 20819 / 输出 392 tokens | 约 ¥0.0157
```

(这次只抓了调用和结论的第一行。)不带提示那组这回自己一页页往下翻了,每页 90 行左右,翻到 360 就停了,报了 1 个问题;带提示那组又是跳着翻,报了 2 个。四次运行,没有一次把三个问题全找到。

这个实验说明了三件事:

1. **截断加提示比悄悄截断好**:带提示的两次都翻到了结尾附近,至少知道「我只看到了一部分」;悄悄截断的第一次直接下了「未发现问题」的错误结论。
2. **但截断加提示不是解药**:模型翻页会跳、会漏,还会把上下文越堆越大(带提示第一次最后一步输入 7,582 token)。截断只是兜底,让错误不那么离谱。
3. **真正的解法在工具上**:让工具支持按级别过滤,模型一步就能拿到三个问题。练习 3 会实测这一点。

花费:四次运行分别 ¥0.0101、¥0.0196、¥0.0248、¥0.0157,就是每次 `llm.ledger` 那行。`LLMClient` 按 `.env` 里的价格算:缓存命中 0.04 元、未命中 2 元、输出 8 元每百万 token(2026 年 10 月核对)。每一步都会重发前面的全部消息,前缀能命中缓存,所以第一次如果全按未命中算是 6682 × 2 / 10⁶ + 220 × 8 / 10⁶ ≈ ¥0.015,实际只有 ¥0.0101。加上练习 3 的 ¥0.0026,今天一共 ¥0.073。

## 测一下

超时和截断写进测试,Day 193 改代码时能守住:

```python
# agent-zero-lab/tests/test_tool_guard.py  Day 191:超时和截断的离线测试
import json
import time

from part03.tool_guard import GuardedRegistry

reg = GuardedRegistry(timeout=0.5, max_chars=100)


@reg.tool
def slow(x: str) -> str:
    """睡 2 秒。"""
    time.sleep(2)
    return x


@reg.tool
def big(x: str) -> str:
    """返回 1000 个字符。"""
    return x * 1000


def test_slow_tool_times_out_fast() -> None:
    start = time.perf_counter()
    out = reg.call("slow", '{"x": "a"}')
    assert time.perf_counter() - start < 1
    assert "超过 0.5 秒没有返回" in json.loads(out)["error"]


def test_long_result_is_truncated_with_note() -> None:
    out = reg.call("big", '{"x": "a"}')
    assert out.startswith('"aaaa')
    assert "共 1002 字符,只显示前 100" in out


def test_errors_still_pass_through() -> None:
    out = reg.call("nope", "{}")
    assert "没有叫 nope 的工具" in out
```

<div class="line-notes">

- `reg = GuardedRegistry(timeout=0.5, max_chars=100)` 测试里把阈值调得很小,测试才跑得快、才好构造「过长」。
- `time.sleep(2)` 比超时 0.5 秒长得多。
- `return x * 1000` `"a" * 1000` 是 1000 个 a。
- `assert time.perf_counter() - start < 1` 证明没有陪着睡 2 秒。
- `assert "超过 0.5 秒没有返回" in json.loads(out)["error"]` 超时报错是合法 JSON,能解析,`error` 字段里有超时秒数。`in` 判断子串,相当于 JS 的 `includes`。
- `assert out.startswith('"aaaa')` 截断后开头还是原来的数据。开头那个引号是 `json.dumps` 加的。
- `assert "共 1002 字符,只显示前 100" in out` 1000 个 a 加一对引号是 1002 字符,提示里的数要对。
- `out = reg.call("nope", "{}")` 不存在的工具。父类 `call` 的「回传可用工具列表」不能因为套了一层就丢了。

</div>

```bash
time uv run pytest -q
```

```text
.......                                                                  [100%]
7 passed in 1.89s
uv run pytest -q 2>&1  1.80s user 0.31s system 49% cpu 4.258 total
```

7 个是昨天 4 个加今天 3 个。pytest 自己说 1.89 秒,`time` 量的总时间是 4.26 秒:多出来的 2 秒多,就是 `slow` 那条线程在后台睡完,进程退出时要等它。测试本身没有被拖慢,拖慢的是退出。

## 动手练习

### 练习 1:日志要看结尾,改成头尾各留一段

日志、报错堆栈这类结果,最新、最重要的内容往往在**末尾**,只留开头会把它们截掉。写一个 `truncate_head_tail(out, max_chars=4000, tail=1000)`:开头留 3000、结尾留 1000,中间放一句「省略了多少」。用一份最后一行才出错的日志测一下。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex191_head_tail.py  练习 1:日志的最新内容在末尾,只留开头会丢掉最重要的部分。改成头尾各留一段
def truncate_head_tail(out: str, max_chars: int = 4000, tail: int = 1000) -> str:
    if len(out) <= max_chars:
        return out
    head = max_chars - tail
    skipped = len(out) - max_chars
    note = f"\n…[中间省略 {skipped} 字符,共 {len(out)} 字符,下面是最后 {tail} 字符]…\n"
    return out[:head] + note + out[-tail:]


lines = [f"10:{i // 60:02d}:{i % 60:02d} INFO ok" for i in range(600)]
lines[-1] = "10:09:59 ERROR 数据库连接池耗尽"  # 最后一行才出事
text = "\n".join(lines)
cut = truncate_head_tail(text)
print(f"原始 {len(text)} 字符 -> {len(cut)} 字符 | 最后一行还在吗:", "ERROR" in cut)
print(cut[2990:3080])
```

<div class="line-notes">

- `head = max_chars - tail` 开头留 3000。
- `skipped = len(out) - max_chars` 中间扔掉了多少。
- `return out[:head] + note + out[-tail:]` 开头、说明、结尾三段拼起来。`out[-tail:]` 是最后 1000 个字符。
- `lines[-1] = "10:09:59 ERROR 数据库连接池耗尽"` 负数下标取最后一个,相当于 JS 的 `lines.at(-1)`(赋值时 JS 要写 `lines[lines.length - 1]`)。
- `print(cut[2990:3080])` 打印接缝附近,看看说明插在哪。

</div>

```bash
uv run python -m part03.ex191_head_tail
```

```text
原始 10206 字符 -> 4043 字符 | 最后一行还在吗: True
k
10:02:56
…[中间省略 6206 字符,共 10206 字符,下面是最后 1000 字符]…
INFO ok
10:09:02 INFO ok
10:09:03 INF
```

最后一行的 ERROR 保住了。接缝处一行日志被切成了 `10:02:56` 和 `INFO ok` 两半,想更整齐可以在换行处切:用 `out.rfind("\n", 0, head)` 找开头部分最后一个换行,`out.find("\n", len(out) - tail)` 找结尾部分第一个换行。对哪类工具用头尾截断、哪类只留开头,要按结果的性质定:搜索结果最相关的在前面,日志最新的在后面。

</details>

### 练习 2:不同工具给不同超时

查订单应该一秒内返回,生成月报本来就要几秒。所有工具共用一个 15 秒的超时,查订单卡住时要白等 15 秒;都给 1 秒,月报永远生成不了。继承 `GuardedRegistry`,支持按工具名单独配超时,没配的用默认值。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex191_per_tool.py  练习 2:不同工具给不同超时,查库 1 秒,生成报表 5 秒
import time

from part03.tool_guard import GuardedRegistry


class PerToolTimeout(GuardedRegistry):
    def __init__(self, timeouts: dict[str, float], default: float = 1, max_chars: int = 4000) -> None:
        super().__init__(timeout=default, max_chars=max_chars)
        self.timeouts = timeouts

    def timeout_for(self, name: str) -> float:
        return self.timeouts.get(name, self.timeout)  # 单独配了就用单独的,没配用默认


reg = PerToolTimeout({"build_report": 5})


@reg.tool
def lookup(order_id: str) -> str:
    """查订单。"""
    time.sleep(3)
    return "paid"


@reg.tool
def build_report(month: str) -> str:
    """生成月报,本来就慢。"""
    time.sleep(3)
    return f"{month} 月报已生成"


for name, args in [("lookup", '{"order_id": "O1"}'), ("build_report", '{"month": "2026-10"}')]:
    start = time.perf_counter()
    print(f"{name:12} -> {reg.call(name, args)} | {time.perf_counter() - start:.1f} 秒")
```

<div class="line-notes">

- `class PerToolTimeout(GuardedRegistry):` 继承今天的 `GuardedRegistry`,只改「超时给几秒」这一件事。
- `super().__init__(timeout=default, max_chars=max_chars)` 默认超时交给父类存成 `self.timeout`。
- `def timeout_for(self, name: str) -> float:` 覆盖父类那个小方法。父类的 `call` 会调 `self.timeout_for(name)`,因为 `self` 是子类对象,调到的就是这个新版本。这就是 `tool_guard.py` 里专门拎出 `timeout_for` 的原因:子类不用碰 `call`。
- `return self.timeouts.get(name, self.timeout)` 字典的 `get(键, 默认值)`,有就取,没有用默认。
- `reg = PerToolTimeout({"build_report": 5})` 只给月报单独配 5 秒,其他工具 1 秒。
- `time.sleep(3)` 两个工具都要 3 秒。

</div>

```bash
uv run python -m part03.ex191_per_tool
```

```text
lookup       -> {"error": "工具 lookup 超过 1 秒没有返回。可以换个参数重试,或者告诉用户暂时查不到。"} | 1.0 秒
build_report -> "2026-10 月报已生成" | 3.0 秒
```

同样慢 3 秒,查订单 1 秒就放弃了,月报等到了结果。

</details>

### 练习 3:从工具层面修

真模型实验里四次都没把三个问题找全。按 Day 182 的原则,给 `read_logs` 加一个 `level` 参数(可选 INFO、WARN、ERROR),再跑一次,看模型怎么用。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex191_filter.py  练习 3:从工具层面修。给 read_logs 加一个 level 参数,让模型不用翻页
from part03.agent_loop import run_agent
from part03.tool_guard import GuardedRegistry
from part03.truncate_real import LINES

reg = GuardedRegistry(max_chars=4000)


@reg.tool
def read_logs(day: str, level: str = "", start_line: int = 0) -> str:
    """读某一天的服务日志。level 可选 INFO、WARN、ERROR,填了就只返回这个级别的行;start_line 用来翻页。"""
    rows = [x for x in LINES if x.startswith(day) and (not level or f" {level} " in x)]
    return "\n".join(rows[start_line:])


answer, llm = run_agent(reg, "你是运维助手,回答要简短。", "看看 2026-10-22 的日志,系统今天有没有出什么问题?", max_steps=10)
print("回答:", answer)
print(llm.ledger)
```

<div class="line-notes">

- `from part03.truncate_real import LINES` 用和正文实验一模一样的 600 行日志。因为 `truncate_real.py` 的主程序在 `if __name__ == "__main__":` 里,导入它不会跑 Agent。
- `def read_logs(day: str, level: str = "", start_line: int = 0) -> str:` 新增 `level`,默认空字符串表示不过滤。
- `"""读某一天的服务日志。level 可选 INFO、WARN、ERROR,填了就只返回这个级别的行;start_line 用来翻页。"""` docstring 会变成工具描述发给模型([Day 169](/blog/agent-zero/day-169-tool-registry-2/)),可选值要写清楚,模型才知道怎么填。
- `rows = [x for x in LINES if x.startswith(day) and (not level or f" {level} " in x)]` 不填 level 时 `not level` 为真,全部保留;填了就只留包含 ` ERROR ` 这样前后带空格的行,避免误匹配别的单词。

</div>

```bash
uv run python -m part03.ex191_filter
```

```text
[step 1] 输入 334 tok | 输出 110 tok
    调用 read_logs({"day": "2026-10-22", "level": "ERROR"}) -> 返回 82 字符
    调用 read_logs({"day": "2026-10-22", "level": "WARN"}) -> 返回 36 字符
[step 2] 输入 528 tok | 输出 92 tok
回答: 今天有 3 条异常：

1. **10:05** 支付网关超时（order=O1042）
2. **10:07** 数据库连接池耗尽
3. **10:09** 磁盘使用率 91%

问题较集中：连接池耗尽可能引发支付超时，建议排查慢查询和连接泄漏；磁盘 91% 也需尽快清理。要我看完整日志上下文吗？
2 次调用 | 输入 862 / 输出 202 tokens | 约 ¥0.0026
```

模型第一步就并行调了两次,一次查 ERROR、一次查 WARN,两步、¥0.0026,三个问题全找到了。对比正文里带提示那次:6 步、¥0.0196、漏一个。截断是兜底,好工具才是正解。

</details>

### 练习 4:超时的线程拖住了进程退出

用 `time` 命令量一下 `pool_timeout.py` 整个脚本跑了多久,和脚本自己打印的时间比一比。解释差别从哪来,再想想:如果工具卡的不是 3 秒而是永远,会发生什么?有什么办法?

<details><summary>参考答案</summary>

```bash
time uv run python -m part03.pool_timeout > /dev/null
```

```text
uv run python -m part03.pool_timeout > /dev/null  0.09s user 0.04s system 4% cpu 3.151 total
```

`> /dev/null` 把脚本自己的打印扔掉,只看 `time` 的结果。正文里脚本打印的最后一行「主线程继续干别的」出现在第 1.0 秒,主线程第 1 秒就走完了,但整个进程 3.15 秒才退出。`ThreadPoolExecutor` 的线程不是 `daemon` 线程,Python 在退出前会等它们全部结束(标准库在解释器退出时会对线程池做 join)。

如果工具永远卡住,这条线程就永远不结束:对一个长期运行的服务(比如 FastAPI 后端)来说,它会一直占着池子里的一个名额,攒多了池子就满了;对一个命令行脚本来说,进程永远退不出去。线程池超时兜不住「永远」。

办法有三层。最好的是在工具内部设超时(HTTP 客户端的 `timeout`、数据库驱动的语句超时),让工具自己按时结束。其次,对完全不可信、可能永远跑下去的代码,放进子进程,超时就杀,这是 [Day 187](/blog/agent-zero/day-187-codeact-2/) 的做法,代价是启动慢、数据要序列化传来传去。最后,服务端要监控线程池里「卡住的线程数」,超过阈值就报警、重启进程。

</details>

**验收标准**:`pool_timeout.py` 能说出为什么第 3 秒还有打印;`pool_side_effect.py` 跑出两条退款,能说出两个对策;`pool_starve.py` 能解释 `max_workers=1` 时 `fast` 为什么超时;能默写 `guarded_call` 和 `truncate`;`failure_zoo_191.py` 的两类结果和文中一致;`tests/` 里 7 个测试全绿;练习 3 能说出「截断兜底、工具才是正解」的证据。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 线程(thread) | 一个进程里的一条执行路线。主线程卡住时,别的线程可以继续跑。线程共享进程的内存 |
| 线程池(thread pool) | 预先准备好的几条线程,有活就派给空闲的那条。Python 里是 `ThreadPoolExecutor` |
| `Future` | `submit` 返回的单据,代表「将来会有的结果」。`result(timeout=…)` 等结果,相当于 JS 的 Promise |
| 工具超时 | 循环层面给每个工具调用设的最长等待时间,到点就返回报错给模型 |
| `max_workers` | 线程池最多几条线程。卡住的线程会一直占名额,所以要留余量 |
| 结果截断 | 工具结果超过上限时只保留一部分,并附上说明 |
| 截断提示 | 截断后追加的说明:被截了、原来多长、怎么查得更准 |
| 头尾截断 | 开头和结尾各留一段、中间省略,适合日志、堆栈这类重点在末尾的结果 |
| `GuardedRegistry` | 今天写的 `ToolRegistry` 子类,`call` 自带超时和截断,`run_agent` 不用改 |

## 常见误区

**把 `pool.submit(f(x))` 写成了 `pool.submit(f, x)` 的样子。** 前者先在主线程里把 `f(x)` 跑完,再把结果交给线程池,超时形同虚设。函数和参数要分开传。

**以为超时就是把工具停掉了。** Python 杀不掉线程。`pool_timeout.py` 第 3 秒的那行打印、`pool_side_effect.py` 里的两条退款都是证据:超时只是「主线程不等了」。

**超时报错写成「失败了」。** 工具可能已经做完了,只是没按时回来。写成「没有返回、结果未知」,并让模型在重试写操作之前先查状态。

**线程池只开 1 条。** 一个工具卡住,后面所有工具都得排队,快工具也被冤枉超时(`pool_starve.py` 第二行)。

**每次调工具都新建一个线程池。** 新建线程池要新建线程,而且超时的线程留在旧池子里没人管。整个程序共用一个模块级的池子。

**只截不说。** 模型会把截断后的内容当成全部数据下结论,真模型实验第一次就说了「未发现问题」。

**以为截断加提示就够了。** 带提示的两次都漏了问题,模型翻页会跳。截断是兜底,工具支持过滤和分页才是正解(练习 3)。

**截断后的结果再拿去 `json.loads`。** 截断会把 JSON 从中间切开,只能交给模型读,不能再给代码解析。

**超时的阈值拍脑袋定。** 太短,正常的慢工具永远做不完;太长,用户跟着干等。上线后看每个工具耗时的分布,按工具分别设(练习 2),设在 P99 稍上方。

## 学习资料

### 文档与文章

- [Python 官方文档 · concurrent.futures](https://docs.python.org/zh-cn/3.12/library/concurrent.futures.html):中文版。看 `ThreadPoolExecutor`、`Future.result`、`Executor.shutdown` 三处,`shutdown` 的 `cancel_futures` 参数在 `pool_starve.py` 里用过。
- [Python 官方文档 · threading](https://docs.python.org/zh-cn/3.12/library/threading.html):中文版。开头「线程对象」一节里有一句话值得记:守护线程在关闭时会突然停止,资源可能没有正确释放;对应今天「杀不掉线程」是有意的设计。
- [Anthropic · Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents):「Optimizing tool responses for token efficiency」一节。说 Claude Code 默认把工具响应限制在 25,000 token,建议分页、过滤、截断并用提示引导 Agent;今天截断提示的写法就是照这个思路。英文,20 分钟。
- [Claude Code 文档 · MCP](https://code.claude.com/docs/en/mcp):搜「MCP output limits」,一个真实产品怎么处理工具结果过长:超过 10,000 token 警告,默认上限 25,000 token,可以用 `MAX_MCP_OUTPUT_TOKENS` 调整。英文。
- [Chroma Research · Context Rot](https://research.trychroma.com/context-rot):用 18 个模型实测,输入越长,模型在同样任务上表现越差。它解释了为什么「窗口装得下」不等于「可以都塞进去」。英文,30 分钟。
- [HTTPX 文档 · Timeouts](https://www.python-httpx.org/advanced/timeouts/):工具内部那一层超时怎么设,连接、读、写、连接池四种超时分别是什么。openai SDK 底层用的 httpx2 沿用了这套设计。英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1C5411v7iy&autoplay=0&high_quality=1" title="【python】使用concurrent.futures多线程多进程高效处理数据" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>谷老丝er · 使用 concurrent.futures 多线程多进程高效处理数据 · 28 分钟,前半段讲 ThreadPoolExecutor、submit 和 Future,今天只需要这部分;后半段的进程池可以先跳过。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1qv8u6NExZ&autoplay=0&high_quality=1" title="请你谈谈Agent上下文超限并还只会截断？你应该如何处理？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>智能体大模型-大鱼 · 请你谈谈 Agent 上下文超限并还只会截断?你应该如何处理? · 2 分钟面试题,和练习 3 的结论一致:截断只是兜底,还要有过滤、摘要、分页。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/IEEhzQoKtQU" title="Python Threading Tutorial: Run Code Concurrently Using the Threading Module" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Threading Tutorial · 90 万播放的经典,后半段从 threading 过渡到 concurrent.futures 的 ThreadPoolExecutor,例子是并发下载图片,英文。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/TUjQuC4ugak" title="Context Rot: How Increasing Input Tokens Impacts LLM Performance" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Chroma · Context Rot: How Increasing Input Tokens Impacts LLM Performance · 上面那篇研究的视频版,看实验设计和曲线,理解为什么工具结果要截、要精简,英文。</figcaption>
</figure>

### 书籍

- Luciano Ramalho《Fluent Python》第 2 版(O'Reilly, 2022),中文版《流畅的 Python(第 2 版)》(人民邮电出版社, 2023):第 20 章「并发执行器」专讲 `concurrent.futures`、`Executor` 和 `Future`,把今天的线程池讲得最透。
- Michael T. Nygard《Release It!》第 2 版(Pragmatic Bookshelf, 2018):第 5 章「Stability Patterns」的 Timeouts 一节,讲为什么每个跨进程调用都必须有超时、超时后怎么处理,英文。

### 开源项目与代码

- [cpython 的 concurrent/futures/thread.py](https://github.com/python/cpython/blob/3.12/Lib/concurrent/futures/thread.py):`ThreadPoolExecutor` 的实现只有两百多行。搜 `_python_exit`,能看到解释器退出时会等线程池里的线程结束,这就是练习 4 那 3 秒的来源。
- 今天这组不需要别的项目。`failure_zoo_191.py` 就是体检报告的复查单,Day 193 拼完整 Agent 时会再跑一遍九类。

## 自测

1. `pool.submit(slow_lookup, "O1")` 和 `pool.submit(slow_lookup("O1"))` 有什么区别?

<details><summary>答案</summary>

前者把函数和参数交给线程池,在工作线程里执行,`submit` 立刻返回。后者先在主线程里执行 `slow_lookup("O1")`(卡满 3 秒),再把它的返回值交给 `submit`,而返回值不是函数,`submit` 会报错;就算不报错,超时也已经白加了。

</details>

2. `future.result(timeout=1)` 超时之后,工具还在跑吗?会带来什么问题?

<details><summary>答案</summary>

还在跑,Python 杀不掉线程,超时只是主线程不等了。问题有三个:写操作可能在后台照样完成,模型以为失败了再调一次就会做两遍(`pool_side_effect.py` 退了两次款);卡住的线程一直占着线程池名额;进程退出时要等这些线程结束。

</details>

3. 截断时为什么一定要加一句提示?只加提示够不够?

<details><summary>答案</summary>

不加提示,模型会把残缺的数据当成全部,真模型实验里悄悄截断那组第一次直接说「未发现问题」。加了提示,模型知道自己只看到一部分,会翻页或换参数。但不够:带提示的两次都漏了问题,翻页会跳,上下文越来越大。根本办法是工具本身支持过滤和分页(练习 3 一步找全)。

</details>

4. `GuardedRegistry.call` 里为什么传 `super().call` 而不是 `self.call`?

<details><summary>答案</summary>

`self.call` 就是 `GuardedRegistry` 自己的 `call`,传进 `guarded_call` 后在线程里执行,又会调 `guarded_call`,无限递归。`super().call` 是父类 `ToolRegistry` 原来的 `call`,负责真正找函数、解析参数、执行工具。

</details>

5. 面试题:你的 Agent 调用了一个第三方工具,它偶尔几十秒都不返回。你怎么处理?

<details><summary>答案</summary>

示范回答:分两层。工具内部,所有网络调用都设连接和读超时,这是首选,因为工具自己能清理现场。Agent 循环层,每个工具调用都套一个总超时(比如线程池加 `future.result(timeout=…)`),按工具分别配阈值,参考线上耗时的 P99;超时后不抛异常,而是给模型一条「没有返回、结果未知」的报错,让它换参数、换工具或者如实告诉用户。要清楚线程超时的局限:线程杀不掉,写操作可能在后台完成,所以写类工具必须幂等,重试前先查状态;线程池要留余量并监控卡住的线程数。对可能永远跑下去的不可信代码,放进子进程,超时就杀。最后,超时事件要记日志、上监控,频繁超时说明要和下游一起解决,或者加断路器。

</details>

## 明天预告

明天是 **Day 192 · 失败模式(四):循环检测和预算收尾**。体检报告里还剩三行没治:第 6 类同一个调用反复发,第 8 类停不下来,第 9 类撞线后只给一句「到了最大步数」、前面查到的东西全丢。明天给每次工具调用算一个指纹做循环检测,加上步数、token、时间三种预算,撞线时禁用工具、让模型用已经拿到的信息给出部分答案,并打上转人工的标记。
