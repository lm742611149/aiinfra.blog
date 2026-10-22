---
title: 'Day 569 · 自部署(三):压测和量化'
description: '自己写一个 60 行的流式压测脚本,量出 TTFT、TPOT 和吞吐,用模拟看清一张卡在并发上去以后哪里开始排队;再用 numpy 亲手把权重压成 8 位和 4 位,看量化到底省了多少、错了多少。'
pubDate: 2026-10-22
regime: none
tags: ['vllm', 'benchmark', 'quantization', 'python', 'agent-zero']
series: 'agent-zero'
day: 569
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 568](/blog/agent-zero/day-568-self-host-2/) 我们走了两条路线把 vLLM 跑了起来:Colab 免费 T4,或者租一张云 GPU,最后用 OpenAI SDK 调通了 `http://localhost:8000/v1`。服务能回话,只说明它活着。它一秒能吐多少字、同时来二十个人会不会卡、要不要换成更小的量化版,这些昨天都没回答。[Day 565](/blog/agent-zero/day-565-model-selection-3/) 的总拥有成本(TCO)表里「单卡吞吐」那一格也还空着,今天就是去把这个数量出来,顺便弄懂量化是怎么拿精度换显存的。

## 今天要解决的问题

学完今天你应该能做到:

1. 自己写一个流式压测脚本,对任意 OpenAI 兼容端点量出 TTFT、TPOT、每秒请求数和每秒输出 token 数,并且说得清每个数是怎么算出来的。
2. 读懂「并发 → 吞吐 / 延迟」这张表,知道拐点在哪,按 SLO 挑出工作点,而不是挑吞吐最大的那一档。
3. 用 numpy 亲手做一次 8 位和 4 位量化,看到「分组」为什么能大幅降低误差,能说出 FP8、AWQ、GPTQ、GGUF 各适合什么卡。

预计用时 2.5 小时。前置:[Day 68](/blog/agent-zero/day-068-async-3/)(`gather` 和 `Semaphore`)、[Day 133](/blog/agent-zero/day-133-sse-principle/)(流式输出和首 token 延迟)、[Day 214](/blog/agent-zero/day-214-numpy-basics/)(numpy 够用版)、[Day 567](/blog/agent-zero/day-567-self-host-1/)(显存账和 KV cache)、[Day 568](/blog/agent-zero/day-568-self-host-2/)(vLLM 上线)。

今天的代码全部能在没有 GPU 的笔记本上跑:压测脚本打的是 DeepSeek API(换个环境变量就能打你自己的 vLLM),卡的行为用一个模拟脚本来演示,量化用 numpy 演示。真卡上的 `vllm bench serve` 我没有实跑,原因和命令都写在对应那一节。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分(`one_request` 和 `quantize` 两个函数);做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先分清两种「快」

前端同学对「快」的感觉一般来自 DevTools 的 Network 面板:一个请求从发出到拿到响应,中间有个 Waiting (TTFB),然后是 Content Download。大模型的流式接口完全可以用这个画面来理解,只是名字换了。

**TTFT**(Time To First Token,首 token 时间)就是 TTFB 的大模型版:从你发出请求到收到第一个有内容的 token。这段时间里服务端在做 prefill,把你的整段输入一次性过一遍模型,输入越长越慢,排队越久越慢。用户盯着空白的输入框等的就是它。

**TPOT**(Time Per Output Token,每个输出 token 的平均时间)对应 Content Download 那一段的「下载速度」:第一个 token 出来以后,后面每个 token 之间平均隔多久。这段是 decode,一个一个往外蹦。TPOT 是 20 毫秒,意味着每秒 50 个 token,人眼看着就是字在匀速往外冒。

这两个数描述的是**一个请求有多快**,也就是延迟。还有另一种快叫**产能**(也常叫吞吐 throughput):一张卡**一秒钟总共**能处理多少请求、吐多少 token。延迟是用户感受,产能是老板的账单。两者经常此消彼长:让一张卡同时服务更多人,总产能上去了,每个人分到的速度会变慢,排队的人 TTFT 还会暴涨。

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="一个流式请求的时间线:TTFT、TPOT 和端到端延迟">
<line x1="40" y1="100" x2="600" y2="100" stroke="var(--rule)" stroke-width="2"/>
<circle cx="60" cy="100" r="6" fill="var(--compute)"/>
<text x="60" y="80" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">发出请求</text>
<rect x="66" y="88" width="174" height="24" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="153" y="105" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">排队 + prefill</text>
<circle cx="250" cy="100" r="6" fill="var(--mem)"/>
<text x="250" y="80" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">第 1 个 token</text>
<circle cx="290" cy="100" r="4" fill="var(--mem)"/>
<circle cx="330" cy="100" r="4" fill="var(--mem)"/>
<circle cx="370" cy="100" r="4" fill="var(--mem)"/>
<circle cx="410" cy="100" r="4" fill="var(--mem)"/>
<circle cx="450" cy="100" r="4" fill="var(--mem)"/>
<circle cx="490" cy="100" r="4" fill="var(--mem)"/>
<circle cx="530" cy="100" r="6" fill="var(--mem)"/>
<text x="530" y="80" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">最后一个</text>
<line x1="60" y1="135" x2="250" y2="135" stroke="var(--compute)" stroke-width="1.5"/>
<text x="155" y="152" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">TTFT</text>
<line x1="290" y1="135" x2="330" y2="135" stroke="var(--mem)" stroke-width="1.5"/>
<text x="310" y="152" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">TPOT</text>
<text x="420" y="152" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">decode,一个一个往外蹦</text>
<line x1="60" y1="175" x2="530" y2="175" stroke="var(--rule)" stroke-width="1.5"/>
<text x="295" y="192" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)" text-anchor="middle">端到端延迟 = TTFT + TPOT × (输出 token 数 − 1)</text>
</svg>
<figcaption>一个流式请求的时间线。TTFT 像 DevTools 里的 TTFB,TPOT 像下载速度。压测就是同时发很多条这样的线,看它们互相挤的时候各段怎么变长。</figcaption>
</figure>

## 第一步:量一个请求

先只发一个请求,把 TTFT 和 TPOT 量出来。用到的东西都学过:流式读取是 [Day 134](/blog/agent-zero/day-134-streaming-code/) 的写法,只是多了计时。

在 `agent-zero-lab/` 目录下(依赖 `openai` 和 `python-dotenv` 早在第二部分就装过,没有的话先 `uv add openai python-dotenv`),新建 `part10/ttft_once.py`:

```python
# agent-zero-lab/part10/ttft_once.py
import json
import os
import time

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
extra = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))

t0 = time.perf_counter()
stream = client.chat.completions.create(
    model=os.environ["LLM_MODEL"],
    messages=[{"role": "user", "content": "用两句话解释发票和收据的区别。"}],
    max_tokens=80,
    stream=True,
    stream_options={"include_usage": True},
    extra_body=extra,
)
first = None
usage = None
for chunk in stream:
    if chunk.choices and chunk.choices[0].delta.content and first is None:
        first = time.perf_counter()
    if chunk.usage:
        usage = chunk.usage
end = time.perf_counter()

assert first is not None and usage is not None
out_tokens = usage.completion_tokens
print(f"TTFT  = {(first - t0) * 1000:.0f} ms")
print(f"总耗时 = {(end - t0) * 1000:.0f} ms")
print(f"输出   = {out_tokens} token,输入 = {usage.prompt_tokens} token")
print(f"TPOT  = {(end - first) * 1000 / max(out_tokens - 1, 1):.1f} ms/token")
```

<div class="line-notes">

- `import time` 标准库的计时模块。下面用的 `time.perf_counter()` 相当于浏览器里的 `performance.now()`:单调递增、精度高,只适合算两个时刻的差,不代表现在几点。
- `load_dotenv()` 读同目录的 `.env`。我的 `.env` 里 `LLM_BASE_URL=https://api.deepseek.com`、`LLM_MODEL=deepseek-flash`。等你有了昨天的 vLLM,把这两行换成 `http://localhost:8000/v1` 和模型名,脚本一个字不用改。
- `extra = json.loads(` `LLM_EXTRA_BODY` 是 `{"thinking": {"type": "disabled"}}`,关掉思考模式。不关的话模型先想一段才开口,TTFT 会把「想」的时间也算进去,量出来的就不是 prefill 的速度了。
- `t0 = time.perf_counter()` 计时起点放在发请求之前。建立连接、TLS 握手的时间也会算进 TTFT,这和用户感受一致。
- `stream=True,` 必须是流式。非流式请求只能拿到「全部生成完」的时刻,TTFT 量不出来。
- `stream_options={"include_usage": True},` 让服务端在流的最后多发一个 chunk,里面带 `usage`(输入多少 token、输出多少 token)。不加这一行,流式响应里没有 usage,你只能自己数 chunk,而一个 chunk 不一定等于一个 token。
- `if chunk.choices and chunk.choices[0].delta.content and first is None:` 三个条件:有 choices(最后那个 usage chunk 的 choices 是空列表)、这次增量里真有文字、还没记过首 token。第一次三个都满足时记下时间。
- `if chunk.usage:` 只有最后一个 chunk 带 usage,其他 chunk 这里是 None。
- `assert first is not None and usage is not None` 正常情况下两个都会被赋值。加这一行一是防止请求异常时后面算出奇怪的数,二是让类型检查器知道下面它们不是 None,Zed 里不会画红线。
- `out_tokens = usage.completion_tokens` 第一次跑是 44。
- `print(f"TTFT  = {(first - t0) * 1000:.0f} ms")` 秒乘 1000 变毫秒,`:.0f` 不留小数。第一次跑 833 ms。
- `print(f"TPOT  = {(end - first) * 1000 / max(out_tokens - 1, 1):.1f} ms/token")` 首 token 之后的时间除以「剩下的 token 数」。44 个 token 有 43 个间隔,所以减 1;`max(..., 1)` 防止只输出 1 个 token 时除以 0。第一次:(1261 − 833) ÷ 43 ≈ 10.0。

</div>

```bash
cd agent-zero-lab
uv run python part10/ttft_once.py
uv run python part10/ttft_once.py
```

我连跑两次(2026-10-22 上午,北京时间工作日 11 点多,DeepSeek 的高峰时段):

```text
TTFT  = 833 ms
总耗时 = 1261 ms
输出   = 44 token,输入 = 14 token
TPOT  = 10.0 ms/token
TTFT  = 752 ms
总耗时 = 1329 ms
输出   = 48 token,输入 = 14 token
TPOT  = 12.3 ms/token
```

输入只有 14 个 token,prefill 几乎不花时间,可 TTFT 还是七八百毫秒。这部分主要是网络往返、服务端排队和调度,不是模型在算。这也提醒你:同一个脚本打本机的 vLLM,TTFT 会小得多,打公网 API 量到的是「API 加网络」的整体。两次结果差了 80 毫秒,单次测量的噪声就这么大,所以压测从来不看一次,要看一批请求的分布。

## 第二步:一次发很多个

压测说白了就是按一定并发发一批请求,把每个请求的 TTFT、TPOT 收集起来,再算整体的吞吐。并发的写法是 [Day 68](/blog/agent-zero/day-068-async-3/) 学过的 `asyncio.gather` 加 `asyncio.Semaphore`:`gather` 相当于 `Promise.all`,`Semaphore(4)` 像一个只有 4 张门票的闸口,同一时刻最多 4 个请求在飞。

请求的形状要像真实业务。SupportPilot 的回答节点输入长、输出短,所以我在提示词里塞了一段重复 40 次的帮助中心文字(大约 800 个 token),`max_tokens` 设 80。新建 `part10/load_test.py`:

```python
# agent-zero-lab/part10/load_test.py
"""最小压测脚本:对任意 OpenAI 兼容端点,按几档并发各发 N 个流式请求。
用法:uv run python part10/load_test.py 1 4 8
"""
import asyncio
import json
import os
import statistics
import sys
import time

from dotenv import load_dotenv
from openai import AsyncOpenAI

load_dotenv()
client = AsyncOpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
MODEL = os.environ["LLM_MODEL"]
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
N_REQUESTS = 12
ARTICLE = "CloudLedger 的发票在每个账期结束后第一天生成,状态从 draft 变成 open。" * 40


async def one_request(i: int) -> dict:
    prompt = f"[请求编号 {i} {time.time_ns()}]\n{ARTICLE}\n客户问:我的发票为什么还是 open?用三句话回答。"
    t0 = time.perf_counter()
    first = None
    usage = None
    stream = await client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=80,
        stream=True,
        stream_options={"include_usage": True},
        extra_body=EXTRA,
    )
    async for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content and first is None:
            first = time.perf_counter()
        if chunk.usage:
            usage = chunk.usage
    end = time.perf_counter()
    assert first is not None and usage is not None
    out = usage.completion_tokens
    return {
        "ttft": first - t0,
        "tpot": (end - first) / max(out - 1, 1),
        "in": usage.prompt_tokens,
        "out": out,
    }


async def run_level(concurrency: int) -> dict:
    sem = asyncio.Semaphore(concurrency)

    async def limited(i: int) -> dict:
        async with sem:
            return await one_request(i)

    t0 = time.perf_counter()
    results = await asyncio.gather(*(limited(i) for i in range(N_REQUESTS)))
    wall = time.perf_counter() - t0
    ttfts = [r["ttft"] * 1000 for r in results]
    tpots = [r["tpot"] * 1000 for r in results]
    return {
        "c": concurrency,
        "req_s": N_REQUESTS / wall,
        "out_tok_s": sum(r["out"] for r in results) / wall,
        "ttft_p50": statistics.median(ttfts),
        "ttft_p90": statistics.quantiles(ttfts, n=10)[-1],
        "tpot_p50": statistics.median(tpots),
        "in_tokens": sum(r["in"] for r in results),
        "out_tokens": sum(r["out"] for r in results),
    }


async def main(levels: list[int]) -> None:
    print("并发  req/s  输出tok/s  TTFT_P50ms  TTFT_P90ms  TPOT_P50ms  输入tok  输出tok")
    for c in levels:
        r = await run_level(c)
        print(f"{r['c']:>4}  {r['req_s']:5.2f}  {r['out_tok_s']:9.1f}  {r['ttft_p50']:10.0f}"
              f"  {r['ttft_p90']:10.0f}  {r['tpot_p50']:10.1f}  {r['in_tokens']:7}  {r['out_tokens']:7}")


if __name__ == "__main__":
    asyncio.run(main([int(x) for x in sys.argv[1:]] or [1, 4, 8]))
```

<div class="line-notes">

- `import statistics` 标准库的统计模块,下面用它算中位数和分位数。JS 里没有对应的内置,一般装 `simple-statistics` 之类的包。
- `from openai import AsyncOpenAI` 异步版客户端。和 `OpenAI` 用法一样,只是每个调用要 `await`。
- `N_REQUESTS = 12` 每档并发发 12 个请求。真实压测一般几百个,这里为了省钱和省时间只发 12 个,分布会比较粗。
- `ARTICLE = "CloudLedger` 一句约 20 个 token 的话重复 40 遍,加上问题,实测每个请求输入 832 个 token。
- `prompt = f"[请求编号 {i} {time.time_ns()}]` 每个请求开头放编号和纳秒时间戳,让每条请求的开头都不一样。原因是 DeepSeek(还有 vLLM 的前缀缓存)会缓存相同的开头,命中缓存的请求 prefill 几乎不花时间,压出来的数会好看得不真实。练习 1 会专门看缓存的影响。
- `stream = await client.chat.completions.create(` 异步客户端创建流也要 `await`,拿到的是一个异步迭代器。
- `async for chunk in stream:` 相当于 JS 的 `for await (const chunk of stream)`。循环体和第一步完全一样。
- `"tpot": (end - first) / max(out - 1, 1),` 这里先存秒,汇总时再乘 1000。
- `sem = asyncio.Semaphore(concurrency)` 闸口。`concurrency` 是 4 就只有 4 张门票。
- `async def limited(i: int) -> dict:` 一个定义在函数里面的小函数,作用是「先拿门票再发请求」。`async with sem:` 进门拿票,出了这个块自动还票,相当于 try/finally 里的 acquire/release。
- `results = await asyncio.gather(*(limited(i) for i in range(N_REQUESTS)))` 一口气把 12 个任务交给事件循环,闸口保证同时在飞的不超过 `concurrency` 个。`*(...)` 把生成器展开成多个参数,相当于 JS 的展开运算符 `...`。
- `wall = time.perf_counter() - t0` 这一档从第一个请求发出到最后一个结束的墙上时间。并发 1 时实测 12.9 秒左右(12 ÷ 0.93)。
- `"req_s": N_REQUESTS / wall,` 每秒完成的请求数。
- `"out_tok_s": sum(r["out"] for r in results) / wall,` 每秒输出的 token 总数,这是产能最常用的口径。并发 8 时 898 ÷ wall ≈ 372.8。
- `"ttft_p50": statistics.median(ttfts),` 中位数,也叫 P50:一半请求比它快,一半比它慢。
- `"ttft_p90": statistics.quantiles(ttfts, n=10)[-1],` `quantiles(n=10)` 把数据切成 10 份,返回 9 个切点,最后一个就是 P90:90% 的请求比它快。12 个样本算 P99 没有意义,所以这里只看 P90。
- `asyncio.run(main([int(x) for x in sys.argv[1:]] or [1, 4, 8]))` 命令行参数是并发档位。`sys.argv[1:]` 是空列表时 `or` 取默认值,和 JS 的 `||` 一样。

</div>

```bash
uv run python part10/load_test.py 1 4 8
```

实跑输出(2026-10-22 11:59,打 DeepSeek `deepseek-flash`):

```text
并发  req/s  输出tok/s  TTFT_P50ms  TTFT_P90ms  TPOT_P50ms  输入tok  输出tok
   1   0.93       70.4         524         991         6.3     9984      905
   4   3.26      249.1         746         984         5.9     9984      917
   8   4.98      372.8         617        1009         7.1     9984      898
```

这次花了多少钱:三档一共 36 个请求,输入 9,984 × 3 = 29,952 token,输出 905 + 917 + 898 = 2,720 token。高峰价(2026 年 10 月查到,[DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing))输入未命中每百万 2 元、输出每百万 8 元:29,952 × 2 ÷ 1,000,000 + 2,720 × 8 ÷ 1,000,000 ≈ 0.060 + 0.022 = 0.082 元。

读这张表。并发从 1 加到 8,输出吞吐从 70 涨到 373,翻了 5 倍多;TTFT 的 P90 一直在 1 秒左右,TPOT 也没变。也就是说,加并发几乎是白捡的产能,没有任何代价。这不是因为 DeepSeek 的卡特别神,而是你这 8 个请求落在了一个很大的集群里,对它来说根本不算负载。打公网 API 压不出拐点,它只能告诉你「从这里调用,延迟大概多少」。

### 故意踩一次坑:样本太少算不了分位数

我第一次写的时候 `N_REQUESTS` 设成了 1,想先试一下流程。程序在 `statistics.quantiles` 那一行炸了。单独复现一下:

```bash
uv run python -c "
import statistics
print(statistics.quantiles([524.0, 991.0], n=10))
print(statistics.quantiles([524.0], n=10))"
```

```text
[197.1, 337.2, 477.3, 617.4, 757.5, 897.6, 1037.7, 1177.8, 1317.9]
Traceback (most recent call last):
  ...
  File ".../lib/python3.12/statistics.py", line 846, in quantiles
    raise StatisticsError('must have at least two data points')
statistics.StatisticsError: must have at least two data points
```

两个点能算,一个点就报错。还要注意上面两个点算出来的「P90」是 1,317.9,比最大值 991 还大,因为默认的算法会在数据两端外推。样本少的时候分位数很不靠谱,这就是正式压测要发几百个请求的原因:想看 P99,至少要几百个样本才有十来个落在最慢的 1% 里。

## 一张卡会在哪里开始排队

想看到拐点,得压一张容量有限的卡。我没有 GPU,所以写了一个模拟脚本,用几个**假设的**参数模仿 vLLM 的连续批处理([Day 567](/blog/agent-zero/day-567-self-host-1/) 讲过:每生成一步就把做完的请求移出去、把排队的补进来)。它不调任何 API,一分钱不花,目的是让你亲眼看见形状。

模拟的规则只有三条。显存里最多同时放 16 个请求的 KV cache,第 17 个只能排队。每一步 decode,批里每个请求各吐一个 token,这一步耗时 12 毫秒的固定开销(读一遍权重)加上每个请求 0.6 毫秒。新进批的请求要先做 prefill,每个输入 token 0.02 毫秒。客户端是「闭环」的:每个虚拟用户拿到回答就立刻发下一个,一共发 20 个。新建 `part10/sim_gpu.py`:

```python
# agent-zero-lab/part10/sim_gpu.py
"""用假设的参数模拟一张卡的连续批处理,看并发上去以后吞吐和排队怎么变。不调任何 API。"""
import random
import statistics

MAX_BATCH = 16          # 显存里最多同时放 16 个请求的 KV cache(假设)
STEP_BASE_MS = 12.0     # 每一步 decode 读一遍权重的固定开销(假设)
STEP_PER_REQ_MS = 0.6   # 批里每多一个请求,这一步多花的时间(假设)
PREFILL_MS_PER_TOKEN = 0.02
PROMPT, PER_CLIENT = 800, 20
random.seed(0)


def simulate(clients: int) -> tuple[float, float, float]:
    now = 0.0
    waiting = [{"submit": 0.0, "left": random.randint(40, 120), "first": None}
               for _ in range(clients)]
    active: list[dict] = []
    remaining = clients * PER_CLIENT - clients   # 除了第一批,还要再发多少个
    done: list[dict] = []
    while waiting or active:
        new = waiting[: MAX_BATCH - len(active)]
        waiting = waiting[len(new):]
        active += new
        step = STEP_BASE_MS + STEP_PER_REQ_MS * len(active) + PREFILL_MS_PER_TOKEN * PROMPT * len(new)
        now += step
        for r in active:
            r["left"] -= 1
            r["out"] = r.get("out", 0) + 1
            if r["first"] is None:
                r["first"] = now
        finished = [r for r in active if r["left"] == 0]
        active = [r for r in active if r["left"] > 0]
        for r in finished:
            r["end"] = now
            done.append(r)
            if remaining > 0:
                remaining -= 1
                waiting.append({"submit": now, "left": random.randint(40, 120), "first": None})
    tok_s = sum(r["out"] for r in done) / (now / 1000)
    ttfts = [r["first"] - r["submit"] for r in done]
    return tok_s, statistics.median(ttfts), statistics.quantiles(ttfts, n=10)[-1]


print("并发  输出tok/s  TTFT_P50ms  TTFT_P90ms")
for c in (1, 2, 4, 8, 16, 32, 64):
    tok_s, p50, p90 = simulate(c)
    print(f"{c:>4}  {tok_s:9.0f}  {p50:10.0f}  {p90:10.0f}")
```

<div class="line-notes">

- `MAX_BATCH = 16` 这个数在真卡上由显存决定:Day 567 算过,显存减去权重剩下的部分除以每个请求的 KV cache 大小,就是能同时放几个请求。它是整个模拟里最关键的参数,拐点就在这里。
- `STEP_BASE_MS = 12.0` decode 每一步都要把全部权重从显存读一遍,不管批里几个请求,这份开销都得付。这就是「拼批」划算的原因:读一遍权重,批里 16 个人各得一个 token。
- `STEP_PER_REQ_MS = 0.6` 批越大每一步越慢一点。这个数比固定开销小得多,所以批大了单步只慢一点点。
- `random.seed(0)` 固定随机种子,每次跑结果一样,你跑出来应该和我一字不差。
- `waiting = [{"submit": 0.0, "left": random.randint(40, 120), "first": None}` 一开始每个虚拟用户都提交一个请求。`left` 是这个请求还要输出几个 token,40 到 120 随机,模拟回答长短不一;`first` 记首 token 时刻。
- `remaining = clients * PER_CLIENT - clients` 每人发 20 个,第一批已经放进 `waiting` 了。并发 4 时是 4 × 20 − 4 = 76。
- `new = waiting[: MAX_BATCH - len(active)]` 批里还有几个空位,就从队头拿几个进来。批满了这里是空列表,排队的人只能干等。
- `step = STEP_BASE_MS + STEP_PER_REQ_MS * len(active) + PREFILL_MS_PER_TOKEN * PROMPT * len(new)` 这一步的耗时。批里 16 个、这一步没有新进的:12 + 0.6 × 16 = 21.6 ms;如果同时新进 1 个,还要加 0.02 × 800 = 16 ms 的 prefill。
- `r["left"] -= 1` 批里每个请求各吐一个 token。
- `if r["first"] is None:` 刚进批的请求在这一步结束时拿到第一个 token,TTFT = 这一刻减去它提交的时刻,排队等的时间全算在里面。
- `waiting.append({"submit": now,` 闭环:有人拿到回答,马上发下一个,提交时刻是现在。
- `tok_s = sum(r["out"] for r in done) / (now / 1000)` 总 token 数除以总时间(毫秒换成秒)。
- `ttfts = [r["first"] - r["submit"] for r in done]` 每个请求的 TTFT。

</div>

```bash
uv run python part10/sim_gpu.py
```

```text
并发  输出tok/s  TTFT_P50ms  TTFT_P90ms
   1         78          29          29
   2        146          29          29
   4        260          30          30
   8        427          33          49
  16        634          38          54
  32        639        2000        2259
  64        643        5990        6335
```

<figure>
<svg viewBox="0 0 640 320" role="img" aria-label="模拟结果:吞吐在并发 16 之后饱和,TTFT P90 在并发 32 之后暴涨">
<text x="40" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">输出 tok/s(0–700)</text>
<line x1="60" y1="150" x2="590" y2="150" stroke="var(--rule)"/>
<line x1="60" y1="50" x2="60" y2="150" stroke="var(--rule)"/>
<polyline points="80,139 160,129 240,113 320,89 400,59 480,59 560,58" fill="none" stroke="var(--mem)" stroke-width="2"/>
<circle cx="80" cy="139" r="3" fill="var(--mem)"/><circle cx="160" cy="129" r="3" fill="var(--mem)"/><circle cx="240" cy="113" r="3" fill="var(--mem)"/><circle cx="320" cy="89" r="3" fill="var(--mem)"/><circle cx="400" cy="59" r="4" fill="var(--mem)"/><circle cx="480" cy="59" r="3" fill="var(--mem)"/><circle cx="560" cy="58" r="3" fill="var(--mem)"/>
<text x="400" y="48" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">634</text>
<text x="560" y="48" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">643</text>
<text x="40" y="182" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">TTFT P90 ms(0–6500)</text>
<line x1="60" y1="290" x2="590" y2="290" stroke="var(--rule)"/>
<line x1="60" y1="190" x2="60" y2="290" stroke="var(--rule)"/>
<polyline points="80,290 160,290 240,290 320,289 400,289 480,255 560,193" fill="none" stroke="var(--compute)" stroke-width="2"/>
<circle cx="400" cy="289" r="4" fill="var(--compute)"/><circle cx="480" cy="255" r="3" fill="var(--compute)"/><circle cx="560" cy="193" r="3" fill="var(--compute)"/>
<text x="480" y="245" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">2259</text>
<text x="560" y="210" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="end">6335</text>
<text x="80" y="308" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">1</text>
<text x="160" y="308" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">2</text>
<text x="240" y="308" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">4</text>
<text x="320" y="308" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">8</text>
<text x="400" y="308" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">16 拐点</text>
<text x="480" y="308" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">32</text>
<text x="560" y="308" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">64 并发</text>
</svg>
<figcaption>sim_gpu.py 的输出画成图。上半张是产能,到 16(批的上限)就平了;下半张是首 token 延迟,过了 16 以后多出来的请求全在排队,P90 从 54 毫秒跳到 2 秒多。横轴每格翻一倍。</figcaption>
</figure>

这就是压测要找的形状,真卡上也基本是这样,只是具体数字不同。读法分两段看。

拐点之前(并发 1 到 16),吞吐几乎随并发线性涨:1 个人时每秒 78 个 token,16 个人时 634,翻了 8 倍多;TTFT 只从 29 毫秒涨到 54 毫秒。原因就在 `STEP_BASE_MS`:读一遍权重的固定开销被更多人分摊了。这一段加并发几乎是白捡。

拐点之后(32、64),吞吐纹丝不动,TTFT 暴涨到几秒。批已经满了,多来的人只能站在队里等前面的人说完。这时候再加并发,产能一点不涨,只是让用户等得更久。

### 选工作点:先写下 SLO

**SLO**(Service Level Objective,服务水平目标)就是你对用户的承诺写成数字,比如「TTFT 的 P90 不超过 500 毫秒」。选工作点的规则是:**在满足 SLO 的档位里挑吞吐最大的那一个**,而不是挑吞吐最大的那一档。上面这张表,SLO 是 500 毫秒时工作点是 16;如果你只看吞吐,会选 64(643 最大),可那时候十个用户里有一个要等 6 秒以上才看到第一个字。

为什么用 P90、P99 而不用平均值?举个数一眼就懂:100 个请求,95 个 100 毫秒,5 个 3 秒。

```bash
uv run python -c "import statistics;d=[100]*95+[3000]*5;print(statistics.mean(d), statistics.median(d), statistics.quantiles(d,n=100)[98])"
```

```text
245 100.0 3000.0
```

平均值 245 毫秒,看着挺好;中位数 100 毫秒,更好;P99 是 3,000 毫秒,说明每 100 个人里有 5 个等了 3 秒。用户投诉的永远是这 5 个人,所以 SLO 都写在尾部的分位数上。

### 在真卡上:vllm bench serve

上面是模拟。等你按 Day 568 起好了 vLLM,真卡上的压测用 vLLM 自带的 `vllm bench serve`(2026 年 10 月 PyPI 上 vLLM 最新是 0.32.0)。它做的事和我们的 `load_test.py` 一样,只是更完整:能按 SLO 统计 goodput,能保存 JSON 结果。在实例上另开一个终端:

```bash
# 在 GPU 实例上跑,服务已经在 127.0.0.1:8000 起好
for c in 1 4 8 16 32; do
  vllm bench serve \
    --backend openai-chat --endpoint /v1/chat/completions \
    --model Qwen/Qwen3-4B-Instruct-2507 \
    --dataset-name random --random-input-len 800 --random-output-len 80 \
    --num-prompts 200 --max-concurrency $c \
    --percentile-metrics ttft,tpot,itl,e2el --metric-percentiles 50,90,99 \
    --goodput ttft:500 tpot:50 \
    --save-result --result-filename bench_c$c.json
done
```

<div class="line-notes">

- `--backend openai-chat --endpoint /v1/chat/completions` 打 Chat Completions 接口,和我们的脚本、和 SupportPilot 走的是同一条路。
- `--dataset-name random --random-input-len 800 --random-output-len 80` 用随机 token 拼输入,长度和 `load_test.py` 一样,方便对照。随机输入不会命中前缀缓存,这一点和我们加时间戳是一个意思。
- `--num-prompts 200 --max-concurrency $c` 每档 200 个请求,最多 `$c` 个同时在飞,作用等于我们的 `Semaphore`。
- `--percentile-metrics ttft,tpot,itl,e2el --metric-percentiles 50,90,99` 报哪些指标的哪些分位。ITL 是相邻两个输出 token 的间隔,e2el 是端到端延迟。
- `--goodput ttft:500 tpot:50` 只把 TTFT ≤ 500 ms 且 TPOT ≤ 50 ms 的请求算作「好的」,报告里会多一行 goodput,也就是满足 SLO 的有效吞吐。
- `--save-result --result-filename bench_c$c.json` 每档存一份 JSON,之后可以用脚本汇总成表。

</div>

**这段没实跑**:本机是 2019 款 Intel MacBook Pro,没有 NVIDIA 显卡,装不了 vLLM 的 GPU 版。参数名是照 [vLLM 文档的 bench serve 页](https://docs.vllm.ai/en/latest/cli/bench/serve.html)(2026 年 10 月查到)写的。你在 Colab T4 上跑时,先按 Day 568 的 `--max-model-len` 把服务起好,再跑这段;T4 上 200 个请求一档大约几分钟,五档加起来二三十分钟。跑完挑出满足 SLO 的工作点,把它的输出 tok/s 填回 Day 565 的 TCO 表:

```text
单卡月产能 = 工作点吞吐(tok/s) × 3600 × 每月运行小时 × 利用率
```

比如工作点吞吐 600 tok/s、一个月开 720 小时、利用率 40%,单卡月产能就是 600 × 3600 × 720 × 0.4 ≈ 6.2 亿输出 token。这里 600 是我编的演示数,你要换成自己的实测值。

## 量化:用精度换显存

压测量出的是「这张卡在这个模型上能干多少活」。想让同一张卡干更多活,最常用的手段就是量化。

**量化**(quantization)就是把模型权重从 16 位的小数压成 8 位甚至 4 位的整数存。打个前端的比方:一张 PNG 存成 JPEG 质量 80,文件小了一大截,肉眼基本看不出区别;压到质量 20,块状噪点就出来了。量化也是有损压缩,压得越狠省得越多、错得也越多。

省下来的显存有两个用处。一是装更大的模型:T4 只有 16 GB,bf16 的 8B 模型放不下,4 位的能放下。二是装更多 KV cache:还记得模拟里的 `MAX_BATCH` 吗,权重变小了,剩给 KV cache 的显存就多了,同时能服务的请求就多,拐点往后挪。另外 decode 每一步都要读一遍权重,权重变小,读得也快。

先看真实的数字。我在 Hugging Face(国内用镜像 hf-mirror.com)上查了 Qwen3-8B 三个版本的权重总大小(2026 年 10 月查到,读的是仓库里 `model.safetensors.index.json` 的 `total_size`):

| 版本 | 每个权重几位 | 权重总大小 | T4(16 GB)上 |
| --- | --- | --- | --- |
| `Qwen/Qwen3-8B` | 16(bf16) | 16.38 GB | 放不下,还没算 KV cache |
| `Qwen/Qwen3-8B-FP8` | 8 | 9.44 GB | 放得下,但 T4 没有 FP8 的计算单元 |
| `Qwen/Qwen3-8B-AWQ` | 4 | 6.10 GB | 放得下,还剩将近 10 GB 给 KV cache |

8 位的版本不是正好一半(8.19 GB),4 位的也不是正好四分之一(4.1 GB),因为一部分层(比如词表嵌入和输出层)通常不量化,每组权重还要额外存缩放系数。缩放系数是什么,下面亲手做一次就明白了。

### 亲手量化一个矩阵

模型的权重说到底就是一堆大矩阵。我们拿一个 1024 × 1024 的随机矩阵当「权重」,用 [Day 214](/blog/agent-zero/day-214-numpy-basics/) 学过的 numpy 把它压成整数再还原,看还原以后算出来的结果偏了多少。

量化的做法很朴素。以 8 位为例,8 位有符号整数能表示 −127 到 127。找出这组数里绝对值最大的那个,比如 0.08,那么 `scale = 0.08 / 127`;每个数除以 scale、四舍五入成整数存起来;用的时候整数乘回 scale。误差来自四舍五入那一步。

这里有个陷阱:如果这组数里有一个特别大的「离群值」,scale 就被它撑大了,其他小数字除以一个大 scale 以后全挤到 0、1、−1 附近,精度全丢。真实的大模型权重里确实有这种离群值,AWQ、GPTQ 这些方法花了很大力气对付它们。最简单的对策是**分组**:不要一整行共用一个 scale,每 128 个数一组各算各的,离群值只祸害它所在的那一组。

先装 numpy(第四部分装过的话跳过):

```bash
uv add numpy
```

新建 `part10/quant_sim.py`:

```python
# agent-zero-lab/part10/quant_sim.py
"""把一个假的权重矩阵压成 8 位和 4 位,看占多少字节、算出来的结果差多少。纯 numpy,不要 GPU。"""
import numpy as np

rng = np.random.default_rng(0)
W = rng.normal(0, 0.02, size=(1024, 1024)).astype(np.float32)
W[:, :4] *= 50                      # 4 列「离群值」,真实模型里也有
x = rng.normal(0, 1, size=1024).astype(np.float32)
y_ref = W @ x


def quantize(w: np.ndarray, bits: int, group: int | None) -> np.ndarray:
    qmax = 2 ** (bits - 1) - 1      # 8 位是 127,4 位是 7
    rows, cols = w.shape
    g = group or cols
    blocks = w.reshape(rows, cols // g, g)
    scale = np.abs(blocks).max(axis=2, keepdims=True) / qmax
    q = np.clip(np.round(blocks / scale), -qmax, qmax)
    return (q * scale).reshape(rows, cols)


def report(name: str, w_hat: np.ndarray, bits: float) -> None:
    err = np.linalg.norm(w_hat @ x - y_ref) / np.linalg.norm(y_ref)
    mb = W.size * bits / 8 / 1024 / 1024
    print(f"{name:<22} {mb:6.2f} MB   输出相对误差 {err:.4%}")


report("fp16(基准)", W.astype(np.float16).astype(np.float32), 16)
report("int8 每行一个 scale", quantize(W, 8, None), 8)
report("int4 每行一个 scale", quantize(W, 4, None), 4)
report("int8 每 128 个一组", quantize(W, 8, 128), 8 + 16 / 128)
report("int4 每 128 个一组", quantize(W, 4, 128), 4 + 16 / 128)
```

<div class="line-notes">

- `rng = np.random.default_rng(0)` 带种子的随机数生成器,种子固定,你跑出来和我一样。
- `W = rng.normal(0, 0.02, size=(1024, 1024))` 一百多万个数,平均 0、标准差 0.02,大小和真实模型权重差不多(真实模型的一层大约是 4096 × 4096,这里缩小了省内存)。
- `W[:, :4] *= 50` 前 4 列乘 50,造出离群值。每一行的前 4 个数现在是其他数的 50 倍左右。
- `y_ref = W @ x` `@` 是矩阵乘法。模型里每一层干的事说到底就是「权重矩阵乘输入向量」,所以我们用这个乘积的偏差来衡量量化伤了多少,比直接比权重更贴近效果。
- `qmax = 2 ** (bits - 1) - 1` 有符号整数的最大值。`**` 是乘方,相当于 JS 的 `**`。8 位得 127,4 位得 7:4 位一共只有 −7 到 7 十五个格子。
- `g = group or cols` 没给分组就整行一组(1024 个数共用一个 scale)。
- `blocks = w.reshape(rows, cols // g, g)` 把每行切成若干组。分组 128 时形状从 (1024, 1024) 变成 (1024, 8, 128):每行 8 组,每组 128 个。`//` 是整除。
- `scale = np.abs(blocks).max(axis=2, keepdims=True) / qmax` 每组里绝对值最大的数除以 qmax。`axis=2` 是沿着「组内」那一维取最大,`keepdims=True` 保留这一维,方便下一行按组相除。
- `q = np.clip(np.round(blocks / scale), -qmax, qmax)` 除以 scale、四舍五入、夹到合法范围。这一步得到的就是真正要存的小整数。
- `return (q * scale).reshape(rows, cols)` 乘回 scale,变回原来的形状。真实推理时整数和 scale 分开存,算的时候再乘;这里直接还原,方便比较误差。
- `err = np.linalg.norm(w_hat @ x - y_ref) / np.linalg.norm(y_ref)` 相对误差 = 偏差向量的长度 ÷ 正确结果的长度。`norm` 是 Day 214 学过的范数,也就是向量的长度。
- `mb = W.size * bits / 8 / 1024 / 1024` 一百多万个数乘每个数的位数,除以 8 变字节,再换成 MB。
- `report("int8 每 128 个一组", quantize(W, 8, 128), 8 + 16 / 128)` 分组的代价:每 128 个数要多存一个 16 位的 scale,平均每个数多 0.125 位,所以位数写成 8.125。

</div>

```bash
uv run python part10/quant_sim.py
```

```text
fp16(基准)                 2.00 MB   输出相对误差 0.0213%
int8 每行一个 scale          1.00 MB   输出相对误差 5.8808%
int4 每行一个 scale          0.50 MB   输出相对误差 33.1123%
int8 每 128 个一组           1.02 MB   输出相对误差 1.9393%
int4 每 128 个一组           0.52 MB   输出相对误差 12.3195%
```

五行数字能读出三件事。fp16 本身也有一点误差(0.02%),但小到可以忽略,所以它当基准。离群值的破坏力很大:int8 整行一个 scale 误差将近 6%,int4 整行一个 scale 误差 33%,这个模型基本废了。分组把误差砍掉一大截:int8 从 5.9% 降到 1.9%,int4 从 33% 降到 12%,代价只是多了 2% 的体积(0.50 MB 变 0.52 MB)。

这个玩具故意造了很凶的离群值,真实模型的情况要温和一些,而且 AWQ、GPTQ 在分组之外还有别的招:AWQ 先根据激活值找出重要的权重通道,把它们放大以后再量化;GPTQ 逐层用一小份校准数据,让量化以后这一层的输出尽量接近原来。所以真实的 4 位模型远没有 12% 这么差。这个实验想让你记住的只是机制:**位数越少,格子越粗;一组里的数差得越大,误差越大;分组越细,误差越小、额外开销越大**。练习 4 会把离群值去掉,你会看到 int8 的误差掉到 1% 以下。

### 几种格式怎么选

| 格式 | 每个权重 | 怎么做的 | 适合 |
| --- | --- | --- | --- |
| FP8 | 8 位浮点 | 权重(常常连激活一起)换成 8 位浮点 | 新卡(Ada、Hopper 及以后,比如 L4、L40S、H100)上的生产部署,效果损失通常很小 |
| AWQ | 4 位整数 | 按激活找重要通道,保护它们以后分组量化 | 显存紧的卡上跑更大的模型,T4 能用 |
| GPTQ | 4 位(也有 8 位) | 逐层用校准数据最小化输出误差 | 和 AWQ 定位相近,生态成熟,T4 能用 |
| GGUF | 多档(Q4_K_M、Q8_0 等) | llama.cpp 的格式 | CPU、Mac、Ollama 这种本地场景,不是 vLLM 的主场 |

T4 这一点要多说一句。按 [vLLM 量化文档](https://docs.vllm.ai/en/latest/features/quantization/index.html)里的硬件兼容表(2026 年 10 月查到),T4 属于 Turing 架构,AWQ、GPTQ、GGUF 都支持;FP8 那种「权重和激活都用 8 位算」(W8A8)的方式要 Ada 或 Hopper 才行,T4 上不支持。T4 上 FP8 的权重最多能通过 Marlin 内核按「只压权重」的方式加载,省显存,但拿不到 8 位计算的加速。所以 Colab 免费 T4 上想跑 8B 模型,选 `Qwen/Qwen3-8B-AWQ` 最省心。

### 量化伤没伤效果,用自己的评测集说话

厂商发量化版的时候都会附一张通用榜单,告诉你「掉了不到 1 个点」。这个数对你的业务没多大参考价值。量化最容易出问题的恰好是 Agent 最依赖的东西:严格的 JSON 格式、工具调用的参数、长上下文里找细节。

正确的做法和 [Day 564](/blog/agent-zero/day-564-model-selection-2/) 选模型时一样:同一个模型的 bf16 版和量化版各起一个服务,用你的评测集各跑一遍,对比分类准确率、JSON 合法率、工具调用成功率,再加上今天的压测表(量化版的工作点吞吐应该更高)。两边一放,值不值得量化就是一道算术题。经验上 8 位几乎看不出差别,4 位在严格格式输出上偶尔出问题。这一段需要 GPU,我没有实跑,练习里也不要求。

## 动手练习

1. **前缀缓存会让压测数字失真吗**:写一个脚本,把 `load_test.py` 里那段 800 token 的提示词原样(不加编号和时间戳)连发 5 次,打印每次的 TTFT 和 `usage` 里 DeepSeek 返回的 `prompt_cache_hit_tokens`。观察缓存命中了多少、TTFT 有没有变化。

<details><summary>参考答案</summary>

新建 `part10/cache_effect.py`:

```python
# agent-zero-lab/part10/cache_effect.py
"""同一段长前缀连发 5 次,看缓存命中的 token 数和 TTFT 怎么变。"""
import json
import os
import time

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
extra = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
ARTICLE = "CloudLedger 的发票在每个账期结束后第一天生成,状态从 draft 变成 open。" * 40

for i in range(5):
    t0 = time.perf_counter()
    first = None
    usage = None
    stream = client.chat.completions.create(
        model=os.environ["LLM_MODEL"],
        messages=[{"role": "user", "content": f"{ARTICLE}\n客户问:我的发票为什么还是 open?一句话回答。"}],
        max_tokens=40,
        stream=True,
        stream_options={"include_usage": True},
        extra_body=extra,
    )
    for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content and first is None:
            first = time.perf_counter()
        if chunk.usage:
            usage = chunk.usage
    assert first is not None and usage is not None
    hit = (usage.model_extra or {}).get("prompt_cache_hit_tokens", 0)
    print(f"第 {i + 1} 次  TTFT {(first - t0) * 1000:5.0f} ms  输入 {usage.prompt_tokens}  命中缓存 {hit}")
```

<div class="line-notes">

- `ARTICLE = "CloudLedger` 和 `load_test.py` 同一段文字,但这次每次请求一模一样,没有编号和时间戳。
- `for i in range(5):` 串行发 5 次,一次发完再发下一次,这样第 2 次开始才可能命中第 1 次留下的缓存。
- `max_tokens=40,` 只看 TTFT,输出短一点省钱。
- `hit = (usage.model_extra or {}).get("prompt_cache_hit_tokens", 0)` `prompt_cache_hit_tokens` 是 DeepSeek 自己加的字段,OpenAI SDK 的类型里没有它,多出来的字段会放进 `model_extra` 这个字典。`or {}` 防止它是 None。换成别的厂商这个字段名可能不一样,打 vLLM 时没有这个字段,会打印 0。

</div>

实跑输出:

```text
第 1 次  TTFT   872 ms  输入 816  命中缓存 0
第 2 次  TTFT   535 ms  输入 816  命中缓存 640
第 3 次  TTFT   816 ms  输入 816  命中缓存 640
第 4 次  TTFT   532 ms  输入 816  命中缓存 640
第 5 次  TTFT   648 ms  输入 816  命中缓存 640
```

第 1 次没有缓存;从第 2 次开始 816 个输入 token 里有 640 个命中缓存(DeepSeek 按固定大小的块缓存,末尾凑不满一块的部分不缓存,所以不是全部命中)。TTFT 有快有慢,没有稳定变快,因为 800 token 的 prefill 本身就很快,TTFT 主要被网络和排队左右。缓存在这里主要省的是钱(命中部分按每百万 0.04 元算,是未命中的 1/50)。输入换成几万 token 时,命中缓存对 TTFT 的影响才会明显。结论是:压测时一定要像 `load_test.py` 那样打散开头,否则测到的是「缓存命中时」的成绩,而真实流量的命中率你并不知道。

</details>

2. **显存多一倍会怎样**:把 `sim_gpu.py` 里的 `MAX_BATCH` 从 16 改成 32(相当于量化以后省出显存,能多放一倍的 KV cache),其他不动,重跑。拐点挪到哪了?最高吞吐涨了多少?

<details><summary>参考答案</summary>

复制一份改一行:

```bash
sed 's/^MAX_BATCH = 16 /MAX_BATCH = 32 /' part10/sim_gpu.py > part10/sim_gpu_b32.py
uv run python part10/sim_gpu_b32.py
```

`sed 's/旧/新/'` 是终端里的查找替换,`^` 表示从行首匹配,结果写进新文件,原文件不动。

```text
并发  输出tok/s  TTFT_P50ms  TTFT_P90ms
   1         78          29          29
   2        146          29          29
   4        260          30          30
   8        427          33          49
  16        634          38          54
  32        838          47          78
  64        847        3055        3336
```

拐点从 16 挪到了 32:并发 32 时 TTFT P90 只有 78 毫秒,吞吐从 639 涨到 838,多了三成。64 时又开始排队。吞吐没有翻倍,是因为批越大每一步越慢(`STEP_PER_REQ_MS`),固定开销摊薄的收益在递减。这就是量化(或者换大显存的卡)提高产能的主要途径:能同时放的请求多了。

</details>

3. **写一个挑工作点的函数**:输入压测表的每一行(并发、输出 tok/s、TTFT P90)和一个 SLO,返回满足 SLO 的档位里吞吐最大的那一行;都不满足返回 None。用 `sim_gpu.py` 的结果试 40、500、3000 毫秒三个 SLO。

<details><summary>参考答案</summary>

新建 `part10/working_point.py`:

```python
# agent-zero-lab/part10/working_point.py
"""从压测表里挑工作点:满足 TTFT P90 的 SLO 前提下,吞吐最大的那一档。"""

ROWS = [  # (并发, 输出tok/s, TTFT_P90ms),抄自 sim_gpu.py 的输出
    (1, 78, 29), (2, 146, 29), (4, 260, 30), (8, 427, 49),
    (16, 634, 54), (32, 639, 2259), (64, 643, 6335),
]


def pick(rows: list[tuple[int, int, int]], slo_ms: int) -> tuple[int, int, int] | None:
    ok = [r for r in rows if r[2] <= slo_ms]
    if not ok:
        return None
    return max(ok, key=lambda r: r[1])


for slo in (40, 500, 3000):
    print(f"SLO TTFT P90 ≤ {slo} ms → 工作点 {pick(ROWS, slo)}")
```

<div class="line-notes">

- `ROWS = [` 每行是一个元组(Day 22 学过),三个数按顺序是并发、吞吐、TTFT P90。
- `ok = [r for r in rows if r[2] <= slo_ms]` 列表推导式过滤出满足 SLO 的行,相当于 JS 的 `rows.filter(r => r[2] <= sloMs)`。
- `return max(ok, key=lambda r: r[1])` 按第二列(吞吐)挑最大的。`key=` 告诉 `max` 比什么,相当于 JS 里自己写 `reduce` 比较 `r[1]`。

</div>

```text
SLO TTFT P90 ≤ 40 ms → 工作点 (4, 260, 30)
SLO TTFT P90 ≤ 500 ms → 工作点 (16, 634, 54)
SLO TTFT P90 ≤ 3000 ms → 工作点 (32, 639, 2259)
```

第三行值得多看一眼:SLO 放宽到 3 秒,函数选了 32,吞吐只比 16 多 5 tok/s,TTFT 却从 54 毫秒变成 2.3 秒。函数严格按规则办事,可人一看就知道这笔买卖不划算。实际工作里会再加一条「吞吐比上一档至少涨 10% 才往上挪」,或者干脆把 SLO 定得紧一点。

</details>

4. **没有离群值会怎样**:把 `quant_sim.py` 里 `W[:, :4] *= 50` 那一行注释掉,重跑,和有离群值时对比。

<details><summary>参考答案</summary>

```bash
sed -e 's/W\[:, :4\] \*= 50 /# W[:, :4] *= 50 /' part10/quant_sim.py > part10/quant_sim_no_outlier.py
uv run python part10/quant_sim_no_outlier.py
```

`sed` 里 `[`、`]`、`*` 有特殊含义,前面加 `\` 表示按普通字符匹配。

```text
fp16(基准)                 2.00 MB   输出相对误差 0.0197%
int8 每行一个 scale          1.00 MB   输出相对误差 0.7762%
int4 每行一个 scale          0.50 MB   输出相对误差 13.3460%
int8 每 128 个一组           1.02 MB   输出相对误差 0.6338%
int4 每 128 个一组           0.52 MB   输出相对误差 11.0774%
```

int8 的误差从 5.9% 掉到 0.78%,分组以后 0.63%:没有离群值时 8 位几乎无损,分不分组差别也不大。int4 只从 33% 降到 13%,分组以后 11%,说明 4 位的问题主要不是离群值,而是格子本身太粗(只有 15 个格子)。这就是为什么 4 位量化要靠 AWQ、GPTQ 这类更聪明的方法,而 8 位用最朴素的方法就够了。

</details>

5. **把账算完**(开放题):假设你在 Colab T4 上实测,Qwen3-4B-Instruct-2507 在 SLO「TTFT P90 ≤ 500 ms」下的工作点输出吞吐是 300 tok/s。租一张同级别的卡每小时 2 元,一个月开 720 小时,利用率 40%。算单卡月产能,以及每百万输出 token 的成本,和 DeepSeek 高峰输出价每百万 8 元比一比。

<details><summary>参考答案</summary>

题目里的 300 tok/s 和每小时 2 元都是假设值。

```text
单卡月产能 = 300 × 3600 × 720 × 0.4 = 311,040,000 ≈ 3.1 亿输出 token
月租金     = 2 × 720 = 1,440 元
每百万输出 token 成本 = 1,440 ÷ 311.04 ≈ 4.63 元
```

用 Python 验算:

```bash
uv run python -c "cap=300*3600*720*0.4;print(cap, 2*720/(cap/1e6))"
```

```text
311040000.0 4.62962962962963
```

每百万输出 token 4.63 元,看起来比 DeepSeek 高峰价 8 元便宜。但这个比较要打三个折扣:DeepSeek 空闲时段只要 4 元,和自部署差不多;自部署的账还没算冗余卡、运维人力和夜里没请求时的空转(利用率 40% 已经算进去了,真实可能更低);4B 模型和 DeepSeek 不是一个能力档,只能接分类这种简单节点。示范结论:按这个数,只有当分类节点的量大到能把一张卡喂到 40% 利用率时自部署才划算,否则老实用 API。

</details>

验收标准:`load_test.py` 能对 DeepSeek 跑出三档并发的表,你能对着表说出每一列怎么算的;`sim_gpu.py` 的输出和本文一致,能指出拐点并按 SLO 选出工作点;`quant_sim.py` 跑通,能解释为什么分组能降低误差。今天的实跑花费在 0.1 元左右。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 压测 | 按一定并发发一大批请求,量服务能扛多少、延迟怎么变。例:`load_test.py 1 4 8` |
| TTFT | 首 token 时间,从发请求到收到第一个字。像 DevTools 里的 TTFB |
| TPOT | 第一个 token 之后,每个输出 token 平均隔多久。10 ms 约等于每秒 100 个 token |
| ITL | 相邻两个输出 token 的间隔,TPOT 是它的平均值 |
| E2E 延迟(e2el) | 一个请求从发出到全部收完的时间 |
| 吞吐 / 产能 | 单位时间总共完成多少请求、输出多少 token,例:输出 372.8 tok/s |
| 并发 | 同一时刻在飞的请求数,`Semaphore(4)` 就是并发 4 |
| P50 / P90 / P99 | 分位数:50%、90%、99% 的请求比这个数快。P50 就是中位数 |
| 拐点 | 吞吐不再随并发上涨、延迟开始暴涨的那个并发 |
| SLO | 服务水平目标,写成数字的承诺,例:TTFT P90 ≤ 500 ms |
| 工作点 | 满足 SLO 的前提下吞吐最大的那一档并发 |
| goodput | 只算满足 SLO 的请求的吞吐 |
| 闭环压测 | 每个虚拟用户拿到回答才发下一个,`sim_gpu.py` 用的就是这种 |
| 量化 | 把权重从 16 位压成 8 位或 4 位存,用精度换显存和速度 |
| scale(缩放系数) | 量化时每组数共用的一个系数,整数乘回 scale 得到近似原值 |
| 离群值 | 比同组其他数大很多的个别数,会把 scale 撑大、拉低整组精度 |
| 分组量化 | 每 128 个数一组各算各的 scale,例:int4 误差从 33% 降到 12% |
| FP8 / AWQ / GPTQ / GGUF | 四种常见量化格式,见正文对比表 |
| W8A8 | 权重(Weight)和激活(Activation)都用 8 位,要新卡才有硬件加速 |

## 常见误区

**对着公网 API 压测,以为测的是模型速度。** 我们的 `load_test.py` 打 DeepSeek,并发加到 8 也看不到任何拐点,因为请求落在一个巨大的集群里。这个结果只能说明「从你这里调用的延迟分布」,不能拿来估算自部署一张卡的产能。

**提示词每次都一样,压出来的数好看得不真实。** 前缀缓存会让重复的开头几乎不花时间。练习 1 里 816 个输入 token 有 640 个命中缓存。压测要像 `load_test.py` 那样在开头加编号和时间戳,或者用 `vllm bench serve` 的随机数据集。

**样本太少就看 P99。** 12 个请求算 P99,其实就是最大值那一个;只有 1 个样本时 `statistics.quantiles` 直接报 `StatisticsError: must have at least two data points`。想看 P99,每档至少几百个请求。

**挑吞吐最大的那一档当容量。** 模拟里并发 64 吞吐最大,可 TTFT P90 有 6.3 秒。先写下 SLO,再找满足它的最大并发。

**数 chunk 当 token。** 流式响应里一个 chunk 可能带好几个 token,也可能一个都没有(最后的 usage chunk)。输出 token 数用 `stream_options={"include_usage": True}` 拿服务端的 `usage.completion_tokens`。

**在 T4 上用 FP8 模型想提速。** T4 是 Turing 架构,没有 FP8 的计算单元,W8A8 的 FP8 在 vLLM 的兼容表里明确不支持 Turing。T4 上用 AWQ 或 GPTQ 的 4 位版本。

**相信量化版的通用榜单。** 量化最先伤到的是严格格式、工具参数、长上下文这些 Agent 最依赖的能力,通用榜单不一定测得出来。用自己的评测集对比 bf16 版和量化版。

## 学习资料

### 文档与文章

- [vLLM · bench serve](https://docs.vllm.ai/en/latest/cli/bench/serve.html):今天那段压测命令的全部参数,`--goodput` 和 `--percentile-metrics` 两段要读,20 分钟。
- [vLLM · Benchmarking 总览](https://docs.vllm.ai/en/latest/benchmarking/):vLLM 自带的几种压测方式,知道还有离线吞吐测试就行。
- [vLLM · 量化](https://docs.vllm.ai/en/latest/features/quantization/index.html):支持哪些格式,最重要的是那张硬件兼容表,先找到 Turing 那一列。
- [Qwen 官方文档 · vLLM 部署](https://qwen.readthedocs.io/zh-cn/latest/deployment/vllm.html):中文,Qwen 系列推荐的启动参数,量化版怎么起。
- [Python 文档 · statistics](https://docs.python.org/zh-cn/3.12/library/statistics.html):`median` 和 `quantiles` 两个函数的说明,`quantiles` 的 `method` 参数解释了为什么两个点能外推出比最大值还大的 P90。
- [DeepSeek · 上下文硬盘缓存](https://api-docs.deepseek.com/zh-cn/guides/kv_cache):练习 1 里 `prompt_cache_hit_tokens` 的官方说明,中文,10 分钟。
- [AWQ 论文](https://arxiv.org/abs/2306.00978)和 [GPTQ 论文](https://arxiv.org/abs/2210.17323):只读摘要和第一张图,知道它们各自怎么对付离群值。
- [Qwen3-8B-AWQ 模型页](https://huggingface.co/Qwen/Qwen3-8B-AWQ)(国内打不开换 [hf-mirror 镜像](https://hf-mirror.com/Qwen/Qwen3-8B-AWQ)):看 Files 里的文件大小,和正文表格对一下。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1NwddYLEw1&autoplay=0&high_quality=1" title="vLLM:并发压测及监控实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AIGC科技官 · vLLM:并发压测及监控实战 · 约 20 分钟,演示对一个真实的 vLLM 服务做并发压测并看监控,补上今天没法在本机演示的那部分。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1euPkerEun&autoplay=0&high_quality=1" title="【13】GPTQ、AWQ、GGUF等模型量化概念讲解" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>LLM张老师 · 【13】GPTQ、AWQ、GGUF等模型量化概念讲解 · 约 18 分钟,把几种量化格式的区别讲清楚,对应正文「几种格式怎么选」那一节。</figcaption>
</figure>

- 西瓜讲大模型 · [如何测试大模型的并发能力?](https://www.bilibili.com/video/BV1WQouYEECX):5 分钟,讲吞吐测试的思路,适合看完正文再看一遍巩固。
- 小工蚁创始人 · [开源大模型压力测试工具 GuideLLM](https://www.bilibili.com/video/BV1Qv4TzdEZQ):3 分钟,介绍 vLLM 团队的另一个压测工具。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/5ZlavKF_98U" title="Fast LLM Serving with vLLM and PagedAttention" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Anyscale · Fast LLM Serving with vLLM and PagedAttention · vLLM 作者讲连续批处理和 KV cache,半小时左右。看完你会明白 sim_gpu.py 里 MAX_BATCH 和 STEP_BASE_MS 这两个假设是从哪来的。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 9 章 Inference Optimization,讲 TTFT、TPOT、吞吐、批处理和量化,和今天几乎一一对应,读这一章约 1.5 小时。

### 开源项目与代码

- [vllm-project/guidellm](https://github.com/vllm-project/guidellm):vLLM 团队的压测工具,能按不同请求速率扫一遍并出报告,今天的 `load_test.py` 想做大了就是它。
- [vllm-project/llm-compressor](https://github.com/vllm-project/llm-compressor):自己把模型量化成 vLLM 能加载的格式,README 里有 FP8 和 4 位的示例。
- [vllm-project/vllm](https://github.com/vllm-project/vllm):`vllm/benchmarks/` 目录下就是 `vllm bench serve` 的源码,看它怎么算 TTFT,和我们的写法对一下。

## 自测

1. `load_test.py` 里如果把 `stream_options={"include_usage": True}` 删掉,程序会怎样?

<details><summary>答案</summary>

流里不会再有带 `usage` 的那个 chunk,`usage` 一直是 None,走到 `assert first is not None and usage is not None` 时抛 `AssertionError`。要么加回这一行,要么自己数输出的 token(数 chunk 不准,要用 tokenizer 数)。

</details>

2. 并发 1 时 TTFT P50 是 524 毫秒,同一个脚本打本机 vLLM 时 TTFT 一般会小很多。为什么?

<details><summary>答案</summary>

打公网 API 的 TTFT 包含了网络往返、TLS 握手、服务端的排队和调度,800 token 的 prefill 本身只占一小部分。本机 vLLM 没有公网往返,并发低时也不排队,TTFT 主要就是 prefill 的时间。

</details>

3. 一张卡压测结果:并发 8 时输出 600 tok/s、TTFT P99 0.4 秒;并发 16 时 640 tok/s、TTFT P99 3.1 秒。SLO 是 TTFT P99 ≤ 1 秒。工作点选哪个?想再提高产能有哪些办法?

<details><summary>答案</summary>

选 8,16 不满足 SLO,而且吞吐只多了 7%,多出来的并发基本在排队。提高产能的办法:换量化版本省出显存放更多 KV cache(练习 2 里拐点从 16 挪到 32);把 `--max-model-len` 设成够用的值别浪费显存;加卡横向扩展;或者换显存更大的卡。

</details>

4. 为什么分组量化能降低误差?代价是什么?

<details><summary>答案</summary>

一组共用一个 scale,scale 由组里绝对值最大的数决定。整行一组时,一个离群值会把整行的 scale 撑大,其他数挤到很少几个格子里。分成每 128 个一组,离群值只影响它所在的那一组。代价是每组要多存一个 scale,128 个一组时平均每个权重多 0.125 位,文件大约大 2%。

</details>

5. (面试题)老板说「把模型换成 4 位量化版,显存省一半多,速度还快,直接上线吧」。你怎么回?

<details><summary>答案</summary>

先认同收益:4 位版权重小,同一张卡能放更多 KV cache,压测的拐点会后移,单卡产能上去。然后说清楚要验证的两件事。一是效果:用我们自己的评测集同时跑 bf16 版和量化版,重点看 JSON 合法率、工具调用参数正确率和长上下文的用例,这些最容易被量化伤到,通用榜单测不出来。二是性能:用 `vllm bench serve` 在同样的 SLO 下压两个版本,比工作点吞吐,确认真的变快了,并且看清楚这张卡支不支持对应格式(比如 T4 跑不了 FP8 的 W8A8)。两项都过了再灰度上线,先切一小部分流量,盯线上指标。

</details>

## 明天预告

Day 570 · 微调(一):提示词、RAG、微调各管什么,造训练集。今天我们学会了怎么量一个自部署模型的产能,也知道了量化能让一张卡多干活。可一个 4B 的开源模型直接拿来做 SupportPilot 的分诊,准确率往往不够。明天先把「什么问题该改提示词、什么该上 RAG、什么才轮到微调」分清楚,然后用一个能在本机跑的脚本,从工单记录里造出一份干净的分诊训练集:去重、剔除评测集里的题、平衡类别。
