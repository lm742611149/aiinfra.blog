---
title: 'Day 189 · 失败模式(一):三层九类'
description: '单步 98% 靠谱,十步全对只有 81.7%,一万次模拟是 81.6%。Agent 的失败按出在哪一层分成基础设施、模型行为、任务三层九类,每一层治法完全不同。用一个按剧本说话的假模型,加两次真的连不上和 key 写错,拿 Day 170 的 run_agent 挨个撞一遍:九类里它接住了三类,一类直接崩,一类干等 3 秒,一类把 21 万字符原样塞进上下文,剩下三类都变成一句「到了最大步数 6 还没做完」。'
pubDate: 2026-10-22
regime: none
tags: ['reliability', 'failure-modes', 'agent-loop', 'agent-zero']
series: 'agent-zero'
day: 189
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 188](/blog/agent-zero/day-188-week27-review/) 复习了第 27 周:工具的说明书、工具的数量、工具的结果,上下文里这三块各有各的省法,省法叠在一起不一定更省。复习日的小项目里我们撞上了好几种失败:BM25 搜不到、模型把一串 `<｜｜DSML｜｜ calls>` 当成回答吐出来、`refund_submit` 被桥拦下。再往前,Day 187 有卡死的桥,Day 186 有心算错的金额,Day 182 有工具重名的 400。

这些失败看起来五花八门,但只要问一句「它出在哪一层」,就能归到很少几类里,而每一类的治法是固定的。接下来五天是失败模式系列:今天只做分类,明天起一类一类地治。

## 今天要解决的问题

学完你应该能:

1. 用「单步成功率连乘」解释为什么 Agent 跑得越长越容易出事,并能用一个十几行的模拟验证这个算式。
2. 背出三层九类:基础设施层(模型 API 临时错误、工具卡住、工具抛异常),模型行为层(参数格式错误、幻觉工具、重复调用),任务层(结果过长、停不下来、做不完),以及每类的典型症状和主要治法。
3. 拿 Day 170 的 `run_agent` 挨个撞这九类,说出它现在接得住哪几类、接不住的是怎么坏的。
4. 拿到一条失败记录,能判断它属于哪一层,该交给哪种治法。

今天两个新概念:**成功率连乘**和**三层九类的失败分类**。

预计用时 2 小时。前置:[Day 170](/blog/agent-zero/day-170-agent-full/)(`run_agent` 和注册表)、[Day 74](/blog/agent-zero/day-074-pytest-4/)(假对象和 monkeypatch)、[Day 135](/blog/agent-zero/day-135-llm-client-1/)(`LLMClient`)。代码在 `agent-zero-lab/part03/`,命令都在 `agent-zero-lab/` 根目录跑。**今天基本不花钱**:除了一次故意用错 key 的请求(401 不计费),全部用假模型或本地模拟。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写九类的表格(层、类型、症状、治法四列)和 `FakeLLM` 的 `chat` 方法;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 为什么 Agent 特别容易出事

先说一个前端里的类比。一个页面打开时要串行请求 10 个接口,每个接口 98% 的时候正常。页面完整加载成功的概率是多少?不是 98%,是 0.98 乘 10 次,大约 82%。每五次打开就有一次某个接口出了问题。

Agent 就是这个页面,而且更糟。它的每一步至少包含一次模型调用和一次工具调用,两者都可能出错;模型的输出还有随机性,同一步这次对了下次不一定对([Day 112](/blog/agent-zero/day-112-sampling-2/) 讲过,`temperature=0` 五次也能五种回答)。步数越多,连乘的项越多。

算式不用信,自己模拟一下:

```python
# agent-zero-lab/part03/chain_sim.py  单步成功率连乘:每步 98% 靠谱,十步全对的概率是多少。先算,再模拟
import random

rng = random.Random(189)
for p in [0.99, 0.98, 0.95]:
    for steps in [5, 10, 20]:
        exact = p ** steps
        runs = 10_000
        ok = sum(all(rng.random() < p for _ in range(steps)) for _ in range(runs))
        print(f"单步 {p:.0%} × {steps:2d} 步 | 算出来 {exact:.1%} | 模拟 {runs} 次成功 {ok} 次 = {ok / runs:.1%}")
```

<div class="line-notes">

- `rng = random.Random(189)` 固定种子的随机数生成器,你跑出来和我一样。Day 186 的订单数据也是这么生成的。
- `for p in [0.99, 0.98, 0.95]:` 三种单步成功率。
- `exact = p ** steps` `**` 是乘方,0.98 的 10 次方。相当于 JS 的 `p ** steps` 或 `Math.pow(p, steps)`。
- `runs = 10_000` 数字里的下划线只是为了好读,等于 10000。JS 里也能写 `10_000`。
- `ok = sum(all(rng.random() < p for _ in range(steps)) for _ in range(runs))` 从里往外读:`rng.random() < p` 是「这一步成功了吗」,`rng.random()` 返回 0 到 1 之间的随机小数,小于 0.98 的概率正好是 98%;`all(... for _ in range(steps))` 是「这一次运行的每一步都成功了吗」,相当于 JS 的 `Array.from({length: steps}).every(...)`;外层 `sum(... for _ in range(runs))` 数一万次里有几次全成功,`True` 当 1 加。
- `print(f"单步 {p:.0%} × {steps:2d} 步 |` `:.0%` 把 0.98 显示成 `98%`;`:2d` 是整数占两位,让表格对齐。

</div>

```bash
cd /Users/你/agent-zero-lab
uv run python -m part03.chain_sim
```

```text
单步 99% ×  5 步 | 算出来 95.1% | 模拟 10000 次成功 9543 次 = 95.4%
单步 99% × 10 步 | 算出来 90.4% | 模拟 10000 次成功 9034 次 = 90.3%
单步 99% × 20 步 | 算出来 81.8% | 模拟 10000 次成功 8206 次 = 82.1%
单步 98% ×  5 步 | 算出来 90.4% | 模拟 10000 次成功 9032 次 = 90.3%
单步 98% × 10 步 | 算出来 81.7% | 模拟 10000 次成功 8162 次 = 81.6%
单步 98% × 20 步 | 算出来 66.8% | 模拟 10000 次成功 6719 次 = 67.2%
单步 95% ×  5 步 | 算出来 77.4% | 模拟 10000 次成功 7772 次 = 77.7%
单步 95% × 10 步 | 算出来 59.9% | 模拟 10000 次成功 6005 次 = 60.1%
单步 95% × 20 步 | 算出来 35.8% | 模拟 10000 次成功 3584 次 = 35.8%
```

模拟和算式对得上,误差在零点几个百分点。看中间那行:**单步 98%,十步只有 81.7%。** 单步 95%、二十步,一大半的任务会在某一步出问题。Day 188 小项目走了 7 步,Day 185 的检索 Agent 走了四五步,这都是很普通的步数。

这张表还说明了一件事:想让长任务靠谱,光提高「平均水平」不够,要让每一步出错时**有人接住**。一步出错不等于整个任务失败,只要错误被发现、被重试、被改正。接住的办法因错误而异,所以先得分类。

## 三层九类

我按「出在哪一层」把常见失败分成三层。分层的意义在于每层的治法不同:基础设施层靠传统后端工程手段(重试、超时、异常处理),模型行为层靠把错误反馈给模型、加约束,任务层靠预算和兜底。

| 层 | 失败类型 | 典型症状 | 主要治法 | 哪天治 |
| --- | --- | --- | --- | --- |
| 基础设施 | 1 模型 API 临时错误 | 429 限流、500/503、连接断开、超时 | 指数退避重试 | [Day 190](/blog/agent-zero/day-190-failures-2/) |
| 基础设施 | 2 工具卡住 | 外部接口几十秒不返回 | 工具超时 | [Day 191](/blog/agent-zero/day-191-failures-3/) |
| 基础设施 | 3 工具抛异常 | 网络错误、数据不存在 | 异常转成报错信息交给模型 | Day 170 已做 |
| 模型行为 | 4 参数格式错误 | arguments 不是合法 JSON、参数名写错 | 解析失败回传,让模型重写 | Day 170 已做 |
| 模型行为 | 5 幻觉工具 | 调用一个根本不存在的工具名 | 回传可用工具列表 | Day 170 已做 |
| 模型行为 | 6 重复调用 | 同样的调用、同样的结果,一遍遍发 | 循环检测 | [Day 192](/blog/agent-zero/day-192-failures-4/) |
| 任务 | 7 结果过长 | 一次返回撑爆上下文 | 截断加提示 | Day 191 |
| 任务 | 8 停不下来 | 步数一直涨,目标没进展 | 步数、token、时间预算 | Day 192 |
| 任务 | 9 做不完 | 撞到上限时手里只有半成品 | 优雅收尾、给部分答案、转人工 | Day 192 |

每一类都对应着我们已经见过的真实事件,对一下就记住了:

- **1 模型 API 临时错误**:今天下面会真的连一次不存在的地址。线上最常见的是 429(Too Many Requests,请求太多被限流)和 5xx(服务端出错),HTTP 状态码在 DevTools 的 Network 面板里你天天见。
- **2 工具卡住**:Day 187 漏了 `flush()` 的桥,卡满 5 秒被计时器杀掉。
- **3 工具抛异常**:Day 182 的 `FileNotFoundError` 带着服务器路径回给了模型。
- **4 参数格式错误**:Day 187 练习 2 的 `TypeError: list_orders() got an unexpected keyword argument 'state'`。
- **5 幻觉工具**:Day 184 路由把发票工具分丢了,模型说「我没有查发票的工具」,这是幻觉工具的反面(该有的不知道有);今天会看到正面(没有的硬要调)。
- **6 重复调用**:明天之前你多半已经在自己的实验里见过,模型拿到结果后又原样发一遍同一个调用。
- **7 结果过长**:Day 180 的坏工具一次 `grep` 灌进三万多 token,Day 186 的 116 条订单每步重发。
- **8 停不下来**和 **9 做不完**:Day 188 练习 2 走满了 8 步;`run_agent` 撞线时只返回一句「到了最大步数」,前面查到的东西全丢了。

<figure>
<svg viewBox="0 0 640 310" role="img" aria-label="九类失败在 Agent 循环上的位置:调用模型处是 API 临时错误和模型行为错误,执行工具处是卡住和抛异常,结果回到上下文处是结果过长,外层是任务级预算">
  <rect x="0" y="0" width="640" height="310" fill="var(--paper-raised)" rx="6"/>
  <rect x="40" y="40" width="150" height="50" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="115" y="70" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">调用模型</text>
  <rect x="245" y="40" width="150" height="50" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="320" y="70" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">执行工具</text>
  <rect x="450" y="40" width="150" height="50" fill="var(--paper)" stroke="var(--ink-soft)" rx="4"/>
  <text x="525" y="70" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">结果回到上下文</text>
  <line x1="190" y1="65" x2="245" y2="65" stroke="var(--ink-soft)"/>
  <line x1="395" y1="65" x2="450" y2="65" stroke="var(--ink-soft)"/>
  <path d="M525 90 Q525 122 320 122 Q115 122 115 90" fill="none" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
  <text x="115" y="150" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">1 API 临时错误</text>
  <text x="115" y="168" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">4 参数格式 5 幻觉工具</text>
  <text x="115" y="186" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">6 重复调用</text>
  <text x="320" y="150" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">2 工具卡住</text>
  <text x="320" y="168" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">3 工具抛异常</text>
  <text x="525" y="150" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">7 结果过长</text>
  <rect x="40" y="212" width="560" height="78" fill="none" stroke="var(--ink)" stroke-dasharray="6 4" rx="4"/>
  <text x="320" y="238" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">整个循环:8 停不下来 · 9 做不完</text>
  <text x="320" y="260" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">靠步数 / token / 时间预算兜住,撞线后给部分答案、转人工</text>
  <text x="320" y="280" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">蓝:模型侧 · 琥珀:工具侧 · 虚线框:任务级</text>
</svg>
<figcaption>九类失败分别发生在循环的哪个位置。前七类是单步的失败,最外面的虚线框是整个任务失控。</figcaption>
</figure>

模型行为层的 4、5、6 三类放在「调用模型」那里,是因为错误是模型产生的,虽然要到执行工具时才暴露出来。分类时问的是「谁犯的错」,不是「在哪儿发现的」。

## 拿 run_agent 挨个撞一遍

分类表光看记不牢。下面让 Day 170 的 `run_agent` 一类一类地撞,看它现在接得住哪几类。

问题是,怎么让真模型「按要求犯错」?让 DeepSeek 发一个不合法的 JSON 参数,你求它它也不一定肯。办法是 [Day 74](/blog/agent-zero/day-074-pytest-4/) 学的假对象:写一个 `FakeLLM`,长得和 `LLMClient` 一样(有 `chat` 方法、返回带 `message` 的结果),但它不联网,按我们写好的剧本回话。再用 monkeypatch 的思路,把 `agent_loop` 模块里的 `LLMClient` 换成它,`run_agent` 里 `LLMClient()` 那一行 new 出来的就是假模型了。相当于 jest 里 `jest.mock` 掉一个模块。

模型 API 那一类用不着假的:把地址改成一个没人监听的端口,真 SDK 自己就会连不上。顺便再拿一个写错的 key 做对照。

```python
# agent-zero-lab/part03/failure_zoo.py  拿 Day 170 的 run_agent 挨个撞九类失败,看它现在接得住哪几类
import json
import os
import sys
import time
from dataclasses import dataclass, field
from typing import Any

from part03 import agent_loop
from part03.agent_loop import ToolRegistry, run_agent


@dataclass
class FakeResult:  # 只有 run_agent 用到的那几个字段
    content: str
    message: dict[str, Any]
    prompt_tokens: int = 0
    completion_tokens: int = 0


@dataclass
class FakeLLM:
    """按剧本回话的假模型。script 里每一项是 (工具名, 参数字符串);None 表示给最终回答。"""
    script: list[tuple[str, str] | None]
    seen_chars: list[int] = field(default_factory=list)
    ledger: str = "假模型,不花钱"

    def chat(self, messages: list[dict[str, Any]], **kw: Any) -> FakeResult:
        self.seen_chars.append(len(json.dumps(messages, ensure_ascii=False)))
        step = self.script[min(len(self.seen_chars) - 1, len(self.script) - 1)]
        if step is None:
            return FakeResult("这是最终回答。", {"role": "assistant", "content": "这是最终回答。"})
        name, args = step
        tc = {"id": f"call_{len(self.seen_chars)}", "type": "function", "function": {"name": name, "arguments": args}}
        return FakeResult("", {"role": "assistant", "content": "", "tool_calls": [tc]})


reg = ToolRegistry()


@reg.tool
def get_weather(city: str) -> dict[str, Any]:
    """查城市天气。"""
    return {"city": city, "temp": 21}


@reg.tool
def slow_lookup(order_id: str) -> dict[str, Any]:
    """查订单,但这个外部接口会卡 3 秒。"""
    time.sleep(3)
    return {"order_id": order_id, "status": "paid"}


@reg.tool
def flaky_lookup(order_id: str) -> dict[str, Any]:
    """查订单,但外部接口断了。"""
    raise ConnectionError("upstream reset by peer")


@reg.tool
def dump_logs(day: str) -> str:
    """返回某天的全部日志,一天有 20 万字符。"""
    return "2026-10-22 INFO request ok\n" * 7500


def with_fake(script: list[tuple[str, str] | None], max_steps: int = 6) -> tuple[str, FakeLLM, float]:
    fake = FakeLLM(script)
    agent_loop.LLMClient = lambda: fake  # type: ignore[assignment,misc]  # 让 run_agent 里 new 出来的就是假模型
    start = time.perf_counter()
    answer, _ = run_agent(reg, "你是助手。", "帮我查一下。", max_steps=max_steps)
    return answer, fake, time.perf_counter() - start


CASES = {
    "3 工具抛异常": [("flaky_lookup", '{"order_id": "O1"}'), None],
    "4 参数不是合法 JSON": [("get_weather", '{"city": 杭州}'), None],
    "5 调了不存在的工具": [("search_web", '{"q": "杭州天气"}'), None],
    "2 工具卡住": [("slow_lookup", '{"order_id": "O1"}'), None],
    "7 结果过长": [("dump_logs", '{"day": "2026-10-22"}'), None],
    "6 同一个调用反复发": [("get_weather", '{"city": "杭州"}')],
    "8/9 停不下来,撞线": [("get_weather", '{"city": "杭州"}'), ("get_weather", '{"city": "上海"}'),
                     ("get_weather", '{"city": "北京"}'), ("get_weather", '{"city": "广州"}'),
                     ("get_weather", '{"city": "深圳"}'), ("get_weather", '{"city": "成都"}'),
                     ("get_weather", '{"city": "武汉"}')],
}

if __name__ == "__main__":
    real_client = agent_loop.LLMClient
    for name, script in CASES.items():
        print(f"\n===== {name}")
        answer, fake, sec = with_fake(script)
        print(f"-> 回答 {answer!r} | 模型被调 {len(fake.seen_chars)} 次 | 上下文最大 {max(fake.seen_chars)} 字符 | 耗时 {sec:.1f} 秒")
    agent_loop.LLMClient = real_client

    print("\n===== 1 模型 API 连不上(真 SDK,端口 9 没人监听)")
    os.environ["LLM_BASE_URL"] = "http://127.0.0.1:9"
    start = time.perf_counter()
    try:
        run_agent(reg, "你是助手。", "杭州天气?", max_steps=3)
    except Exception as e:
        print(f"-> 抛出 {type(e).__module__}.{type(e).__name__}: {e} | 耗时 {time.perf_counter() - start:.1f} 秒")

    print("\n===== 对照:key 写错(真 SDK,真发到 DeepSeek)")
    os.environ["LLM_BASE_URL"] = "https://api.deepseek.com"
    os.environ["LLM_API_KEY"] = "sk-wrong-key-for-demo"
    start = time.perf_counter()
    try:
        run_agent(reg, "你是助手。", "杭州天气?", max_steps=3)
    except Exception as e:
        print(f"-> 抛出 {type(e).__module__}.{type(e).__name__}: {str(e)[:120]} | 耗时 {time.perf_counter() - start:.1f} 秒")
    sys.exit(0)
```

<div class="line-notes">

- `from part03 import agent_loop` 导入**模块本身**,而不只是里面的函数。后面要改模块上的 `LLMClient` 这个名字,必须拿到模块对象。
- `class FakeResult:  # 只有 run_agent 用到的那几个字段` 真的 `ChatResult` 有十几个字段,`run_agent` 只读了 `message`、`content`、`prompt_tokens`、`completion_tokens`,假的只要有这几个就够。这就是 Python 的「鸭子类型」:长得像鸭子、叫得像鸭子,就当它是鸭子。TS 里叫结构类型,只要形状对得上。
- `script: list[tuple[str, str] | None]` 剧本:每一项是模型这一步要发的工具调用 `(工具名, 参数字符串)`,`None` 表示这一步给最终回答。
- `seen_chars: list[int] = field(default_factory=list)` 每次被调用时,记下收到的 messages 有多少字符。dataclass 的列表默认值必须这么写,直接写 `= []` 会报错([Day 50](/blog/agent-zero/day-050-dataclass/) 讲过,和 Day 29 的可变默认值陷阱是同一个原因)。
- `ledger: str = "假模型,不花钱"` `run_agent` 会把 `llm` 原样返回,调用方可能打印 `llm.ledger`,给个字符串占位。
- `self.seen_chars.append(len(json.dumps(messages, ensure_ascii=False)))` 用字符数近似「这一步上下文有多大」。假模型不算 token,所以 `run_agent` 打印的「输入 0 tok」是假的,看这个字符数。
- `step = self.script[min(len(self.seen_chars) - 1, len(self.script) - 1)]` 第 n 次调用就取剧本第 n 项;剧本用完了就一直重复最后一项。「重复调用」那个剧本只有一项,就是靠这一行让它一直重复。
- `return FakeResult("这是最终回答。", {"role": "assistant", "content": "这是最终回答。"})` 没有 `tool_calls`,`run_agent` 就认为任务结束。
- `tc = {"id": f"call_{len(self.seen_chars)}", "type": "function", "function": {"name": name, "arguments": args}}` 手工拼一个和 OpenAI 格式一样的工具调用。注意 `arguments` 是**字符串**,和真模型一样,这样才能模拟「模型写了不合法的 JSON」。
- `def slow_lookup(order_id: str) -> dict[str, Any]:` 卡 3 秒的工具,模拟外部接口变慢。真实情况可能是 30 秒或者永远。
- `raise ConnectionError("upstream reset by peer")` 抛异常的工具,模拟下游服务断了。
- `return "2026-10-22 INFO request ok\n" * 7500` 字符串乘以整数就是重复,27 个字符 × 7500 ≈ 20 万字符。
- `agent_loop.LLMClient = lambda: fake  # type: ignore[assignment,misc]` monkeypatch:把 `agent_loop` 模块里 `LLMClient` 这个名字换成一个返回假模型的函数。`run_agent` 里写的是 `llm = LLMClient()`,它查找 `LLMClient` 时找的是自己模块里的这个名字,所以拿到的就是 `fake`。`type: ignore` 是告诉类型检查器「我知道类型不对,是故意的」。
- `"4 参数不是合法 JSON": [("get_weather", '{"city": 杭州}'), None],` `杭州` 没有引号,不是合法 JSON。真模型偶尔会这样,尤其是参数里有中文或者引号嵌套的时候。
- `"5 调了不存在的工具": [("search_web", '{"q": "杭州天气"}'), None],` 注册表里没有 `search_web`,模型「以为」有。
- `"6 同一个调用反复发": [("get_weather", '{"city": "杭州"}')],` 剧本只有一项,配合上面那行 `min(...)`,每一步都发同一个调用,永远不给最终回答。
- `real_client = agent_loop.LLMClient` 先把真的存起来,撞完假模型那几类再换回去,后面两类要用真 SDK。
- `os.environ["LLM_BASE_URL"] = "http://127.0.0.1:9"` `127.0.0.1` 是本机,9 号端口一般没有程序在监听,连上去会立刻被拒绝。`LLMClient` 里用的 `load_dotenv()` 默认不覆盖已经存在的环境变量,所以这里改的值会生效。
- `os.environ["LLM_API_KEY"] = "sk-wrong-key-for-demo"` 一个错误的 key。请求会真的发到 DeepSeek,被拒绝,不计费。你真正的 key 不会被发出去。
- `sys.exit(0)` 正常退出。前面改了环境变量,只影响这个进程,脚本结束就没了,不会改你的 `.env`。

</div>

```bash
uv run python -m part03.failure_zoo
```

假模型那几类每一步都会打印「输入 0 tok | 输出 0 tok」,那是 `run_agent` 自己的打印,假模型不算 token,忽略它。完整输出:

```text
===== 3 工具抛异常
[step 1] 输入 0 tok | 输出 0 tok
    调用 flaky_lookup({"order_id": "O1"}) -> 返回 52 字符
[step 2] 输入 0 tok | 输出 0 tok
-> 回答 '这是最终回答。' | 模型被调 2 次 | 上下文最大 363 字符 | 耗时 0.0 秒

===== 4 参数不是合法 JSON
[step 1] 输入 0 tok | 输出 0 tok
    调用 get_weather({"city": 杭州}) -> 返回 72 字符
[step 2] 输入 0 tok | 输出 0 tok
-> 回答 '这是最终回答。' | 模型被调 2 次 | 上下文最大 374 字符 | 耗时 0.0 秒

===== 5 调了不存在的工具
[step 1] 输入 0 tok | 输出 0 tok
    调用 search_web({"q": "杭州天气"}) -> 返回 96 字符
[step 2] 输入 0 tok | 输出 0 tok
-> 回答 '这是最终回答。' | 模型被调 2 次 | 上下文最大 400 字符 | 耗时 0.0 秒

===== 2 工具卡住
[step 1] 输入 0 tok | 输出 0 tok
    调用 slow_lookup({"order_id": "O1"}) -> 返回 36 字符
[step 2] 输入 0 tok | 输出 0 tok
-> 回答 '这是最终回答。' | 模型被调 2 次 | 上下文最大 350 字符 | 耗时 3.0 秒

===== 7 结果过长
[step 1] 输入 0 tok | 输出 0 tok
    调用 dump_logs({"day": "2026-10-22"}) -> 返回 210002 字符
[step 2] 输入 0 tok | 输出 0 tok
-> 回答 '这是最终回答。' | 模型被调 2 次 | 上下文最大 217811 字符 | 耗时 0.0 秒

===== 6 同一个调用反复发
[step 1] 输入 0 tok | 输出 0 tok
    调用 get_weather({"city": "杭州"}) -> 返回 26 字符
……(step 2 到 step 6 一模一样)
-> 回答 '到了最大步数 6 还没做完' | 模型被调 6 次 | 上下文最大 1354 字符 | 耗时 0.0 秒

===== 8/9 停不下来,撞线
[step 1] 输入 0 tok | 输出 0 tok
    调用 get_weather({"city": "杭州"}) -> 返回 26 字符
[step 2] 输入 0 tok | 输出 0 tok
    调用 get_weather({"city": "上海"}) -> 返回 26 字符
……(北京、广州、深圳、成都)
-> 回答 '到了最大步数 6 还没做完' | 模型被调 6 次 | 上下文最大 1354 字符 | 耗时 0.0 秒

===== 1 模型 API 连不上(真 SDK,端口 9 没人监听)
-> 抛出 openai.APIConnectionError: Connection error. | 耗时 3.6 秒

===== 对照:key 写错(真 SDK,真发到 DeepSeek)
-> 抛出 openai.AuthenticationError: Error code: 401 - {'error': {'message': 'Authentication Fails, Your api key: ****demo is invalid (request_id: 7e5f5b8d-c | 耗时 0.2 秒
```

前三类被注册表变成了报错字符串,我单独调 `reg.call` 看了一下它们的原文:

```text
{"error": "ConnectionError: upstream reset by peer"}
{"error": "JSONDecodeError: Expecting value: line 1 column 10 (char 9)"}
{"error": "没有叫 search_web 的工具,可用的有 ['get_weather', 'slow_lookup', 'flaky_lookup', 'dump_logs']"}
```

### 读结果:接住三类,其余各有各的坏法

把九类的结果整理成一张表,这就是 `run_agent` 现在的「体检报告」:

| 类 | 现在的表现 | 接住了吗 |
| --- | --- | --- |
| 1 API 临时错误 | 抛出 `APIConnectionError`,整个 `run_agent` 崩掉,3.6 秒 | 没有,崩 |
| 2 工具卡住 | 干等 3 秒,等多久都等 | 没有,干等 |
| 3 工具抛异常 | 变成 `{"error": "ConnectionError: ..."}` 交给模型 | 接住了 |
| 4 参数格式错误 | 变成 `{"error": "JSONDecodeError: ..."}` 交给模型 | 接住了 |
| 5 幻觉工具 | 变成「没有叫 search_web 的工具,可用的有 [...]」 | 接住了 |
| 6 重复调用 | 同一个调用发了 6 遍,直到步数上限 | 没有,白烧 6 步 |
| 7 结果过长 | 21 万字符原样进了上下文 | 没有,全塞进去 |
| 8 停不下来 | 靠 `max_steps=6` 停住 | 勉强,只有步数一种预算 |
| 9 做不完 | 只返回「到了最大步数 6 还没做完」 | 没有,查到的六个城市天气全丢了 |

逐条说几句。

**3、4、5 三类接住了,功劳在 Day 170 注册表的 `call` 里那个 `try/except` 和名字检查。** 错误没有让程序崩,而是变成一条模型看得懂的 tool 消息,模型下一步可以改。第 5 类还附上了可用工具列表,这是 [Day 182](/blog/agent-zero/day-182-tool-design-2/) 原则六「报错要指导下一步」。第 3 类的报错只是异常的原文,`upstream reset by peer` 对模型来说没什么指导意义,它不知道该重试还是放弃。这一点 Day 191 会改。

**第 1 类直接崩。** 注意耗时是 3.6 秒而不是一瞬间:`LLMClient` 创建 OpenAI 客户端时设了 `max_retries=3`([Day 135](/blog/agent-zero/day-135-llm-client-1/)),SDK 在抛出异常之前已经自己重试了三次,每次之间等一小会儿。所以「重试」其实已经有一层了,只是重试完还失败时,没人接住这个异常,整个任务连同前面几步的成果一起丢掉。明天专门讲重试:哪些错误该重试、怎么等、SDK 那一层和我们自己那一层别叠在一起。

**写错 key 的对照很重要。** 它也是模型 API 的错误,但耗时只有 0.2 秒,SDK 没有重试。因为 401(认证失败)不是「临时」的,key 错了重试一百次还是错。SDK 只对连接错误、429 和 5xx 这些可能过一会儿就好的错误重试。这就是分类的用处:同一层里,临时错误和永久错误的治法也不一样,一个该重试,一个该立刻报警。

**第 2 类干等。** 3 秒还好,如果外部接口卡 60 秒,用户就在那里看 60 秒的转圈。`run_agent` 没有任何工具超时。Day 187 的 `run_code` 有墙钟超时,那是给子进程的;普通工具在主进程里执行,需要另一种超时写法,Day 191 讲。

**第 7 类最隐蔽。** 程序没有报错,假模型也照常回答了,只是它第二步收到的上下文有 217,811 个字符。换成真模型,中文日志按 Day 186 量的密度,这是好几万 token,一步就可能超出上下文窗口(报 400),或者没超但花掉几毛钱、后面每一步再重发。

**第 6、8、9 类的结局一模一样**:都是 6 步后返回一句「到了最大步数 6 还没做完」。但它们的病因不同。第 6 类是同一个调用重复了 6 遍,第一遍之后就该发现;第 8 类是每一步都在做不同的事,也许真的需要更多步,也许在瞎转;第 9 类说的是撞线之后:前 6 步查到了 6 个城市的天气,结果一个字都没留给用户。只看最终回答,三类分不开,要看轨迹。Day 192 会给循环检测、多种预算和「撞线后给部分答案」三样东西。

### 九类之外:看起来成功的失败

最后补一类表里没有、却最难缠的:**程序不报错,结果是错的。** Day 186 模型心算出 10,560.85,表格整整齐齐;Day 187 模型写了 `list_orders('退款')`,代码退出码 0,安静地拿到一个空列表;Day 185 检索漏了 `refund_submit`,模型很有礼貌地说「我没有提交退款的接口」。

这三件事,今天的 `failure_zoo` 一样都抓不到,因为没有异常、没有超时、没有撞线。抓它们只能靠评测:固定的题、程序判卷、看工具调用轨迹。这是第六部分的主题,现在先记住一点:**九类失败是「出错了」,还有一种失败是「错了却没出错」**,前者靠今天这套工程手段,后者靠评测。

## 动手练习

### 练习 1:给十条失败记录分类(不写代码)

下面十条都是本课程里真实出现过的现象。每条写出它属于哪一层、哪一类(或者「九类之外」),以及该用哪种治法。

1. DeepSeek 返回 400 `Tool names must be unique`。
2. 子进程里 `refund_order('O0001')` 报 `NameError`。
3. `run_code` 返回 `timed_out=True, returncode=-9`,原因是桥里忘了 flush。
4. 模型在回答里写「上海退款 10,560.85 元」,正确答案是 10,731.38。
5. 一次请求报 `openai.RateLimitError: Error code: 429`。
6. 检索 Agent 走了 8 步,前 5 步都在用不同说法搜同一个工具。
7. 模型输出 `<｜｜DSML｜｜ calls>...`,循环把它当成了最终回答。
8. 工具返回 70,454 个字符的会议纪要原文。
9. 模型调用 `customer_find(email="...")`,而工具的参数名是 `query`。
10. `run_agent` 撞到上限,返回「到了最大步数 8 还没做完」,前面已经查到了客户和发票。

<details><summary>参考答案</summary>

1. **不在九类里,是我们自己的配置错误**(工具定义重名,Day 182)。它看起来像「模型 API 错误」,但 400 是请求本身有问题,重试没用,要修代码:工具名加命名空间、注册表查重。这类「我们自己写错了」的错误要在上线前用测试抓住。
2. **模型行为 / 幻觉工具(第 5 类)。** 代码模式里没有注册表帮你回「可用工具有哪些」,而是 Python 的 `NameError`。治法一样:把错误回给模型,最好附上可用的函数名。
3. **基础设施 / 工具卡住(第 2 类)。** 这次是我们自己的 bug 让桥卡住,但从 Agent 的角度看就是「工具不返回」,墙钟超时把它兜住了。治法:工具超时;另外修 bug。
4. **九类之外:看起来成功的失败。** 没有异常、没有超时,数字错了。治法:计算交给代码(Day 186–187),用带标准答案的评测抓。
5. **基础设施 / 模型 API 临时错误(第 1 类)。** 治法:指数退避重试(明天)。
6. **任务 / 停不下来(第 8 类)**,根因是检索不准(Day 188)。预算能让它停,但修好它要改检索。这说明分类决定的是「怎么兜住」,根因还得看轨迹。
7. **模型行为 / 格式错误(和第 4 类同一层)。** 模型没按我们要求的格式(python 代码块或最终回答)输出。我们的循环把它误判为成功,所以它同时也是「看起来成功的失败」。治法:最终回答要有显式标记,格式不对就回一条提示让模型重来。
8. **任务 / 结果过长(第 7 类)。** 治法:Day 182 原则五(返回值有上限、有总数、能翻页),或在循环里截断加提示(Day 191)。
9. **模型行为 / 参数格式错误(第 4 类)。** 注册表会返回 `TypeError: ... unexpected keyword argument 'email'`,模型下一步改成 `query`。如果工具描述写清楚了参数,这类错误会少很多。
10. **任务 / 做不完(第 9 类)。** 治法:撞线后禁用工具再调一次模型,让它基于已有信息给部分答案,并标记转人工(Day 192)。

</details>

### 练习 2:写一个自动贴标签的函数

把练习 1 的判断写成代码:`classify(event)` 接收一个异常对象、或 `registry.call` 返回的字符串、或 `run_agent` 的最终回答,返回「层 / 类」和建议。用今天 `failure_zoo` 里见过的那几种原文测一测。不调模型,不花钱。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/failure_classify.py  练习 2:给一条失败记录自动贴上「层 / 类」标签
import httpx2
import openai

TRANSIENT = (openai.APIConnectionError, openai.RateLimitError, openai.InternalServerError)  # APITimeoutError 是 APIConnectionError 的子类


def classify(event: object) -> str:
    """event 是抛出来的异常,或者 registry.call 返回的字符串,或者 run_agent 的最终回答。"""
    if isinstance(event, TRANSIENT):
        return "基础设施 / 模型 API 临时错误 → 可以重试"
    if isinstance(event, openai.APIStatusError):
        return f"基础设施 / 模型 API 永久错误({event.status_code})→ 别重试,报警"
    text = str(event)
    if text.startswith('{"error": "没有叫 '):
        return "模型行为 / 幻觉工具"
    if text.startswith('{"error": "JSONDecodeError') or text.startswith('{"error": "TypeError'):
        return "模型行为 / 参数格式错误"
    if text.startswith('{"error": '):
        return "基础设施 / 工具抛异常"
    if text.startswith("到了最大步数"):
        return "任务 / 停不下来(要看轨迹分清是重复调用还是没进展)"
    return "没认出来,人工看"


if __name__ == "__main__":
    req = httpx2.Request("POST", "https://api.deepseek.com/chat/completions")
    samples: list[object] = [
        openai.APIConnectionError(request=req),
        openai.RateLimitError("429", response=httpx2.Response(429, request=req), body=None),
        openai.AuthenticationError("401", response=httpx2.Response(401, request=req), body=None),
        '{"error": "ConnectionError: upstream reset by peer"}',
        '{"error": "JSONDecodeError: Expecting value: line 1 column 10 (char 9)"}',
        '{"error": "没有叫 search_web 的工具,可用的有 [\'get_weather\']"}',
        '{"error": "TypeError: get_weather() got an unexpected keyword argument \'town\'"}',
        "到了最大步数 6 还没做完",
        "<｜｜DSML｜｜ calls>",
    ]
    for s in samples:
        label = type(s).__name__ if isinstance(s, Exception) else str(s)[:40]
        print(f"{label:42} -> {classify(s)}")
```

<div class="line-notes">

- `import httpx2` openai SDK 底层用的 HTTP 库。2026 年 10 月装的 openai 3.36.1 依赖的是 `httpx2`(不是旧的 `httpx`),它随 openai 一起装好了,不用另外 `uv add`。我第一次写 `import httpx`,报 `ModuleNotFoundError: No module named 'httpx'`。这里只用它来手工造几个异常对象。
- `TRANSIENT = (openai.APIConnectionError, openai.RateLimitError, openai.InternalServerError)` 临时错误的异常类。`isinstance(x, (A, B, C))` 传一个元组,是「属于其中任意一种」。`InternalServerError` 对应 5xx。行尾注释说 `APITimeoutError` 是 `APIConnectionError` 的子类,我在 openai 3.36.1 里用 `issubclass` 确认过,所以超时也会被这一条接住。
- `if isinstance(event, openai.APIStatusError):` 所有带 HTTP 状态码的错误的父类。能走到这里说明不是 429 和 5xx,剩下的 400、401、403、404 都是重试也没用的。注意顺序:`RateLimitError` 也是 `APIStatusError` 的子类,所以临时错误的判断必须写在前面。
- `return f"基础设施 / 模型 API 永久错误({event.status_code})→ 别重试,报警"` `status_code` 是异常对象上的 HTTP 状态码。
- `if text.startswith('{"error": "没有叫 '):` 靠注册表报错的固定开头来认。这很脆弱,注册表的文案一改就认不出;生产里更好的做法是让 `call` 返回结构化的错误类型字段,而不是让下游去解析文字。
- `if text.startswith('{"error": "JSONDecodeError') or text.startswith('{"error": "TypeError'):` 参数 JSON 坏了、参数名写错了,都是模型写参数的问题。
- `if text.startswith('{"error": '):` 其余的工具报错,归到工具抛异常。这一条要放在上面两条后面,否则会先把它们吞掉。
- `return "没认出来,人工看"` 认不出的别硬猜。DSML 那条会落到这里。
- `openai.RateLimitError("429", response=httpx2.Response(429, request=req), body=None),` 手工造一个 429 异常。真实的 429 很难稳定触发,测试里都是这样造的,明天测重试也会用到。

</div>

```bash
uv run python -m part03.failure_classify
```

```text
APIConnectionError                         -> 基础设施 / 模型 API 临时错误 → 可以重试
RateLimitError                             -> 基础设施 / 模型 API 临时错误 → 可以重试
AuthenticationError                        -> 基础设施 / 模型 API 永久错误(401)→ 别重试,报警
{"error": "ConnectionError: upstream res   -> 基础设施 / 工具抛异常
{"error": "JSONDecodeError: Expecting va   -> 模型行为 / 参数格式错误
{"error": "没有叫 search_web 的工具,可用的有 ['get   -> 模型行为 / 幻觉工具
{"error": "TypeError: get_weather() got    -> 模型行为 / 参数格式错误
到了最大步数 6 还没做完                              -> 任务 / 停不下来(要看轨迹分清是重复调用还是没进展)
<｜｜DSML｜｜ calls>                           -> 没认出来,人工看
```

(中文字符在终端里占两格,`:42` 按字符数对齐,所以带中文的几行没对齐,不影响结果。)

九条里八条认对了,DSML 那条认不出,这是对的:它是格式错误,但我们只看字符串开头,判断不了一段文字「是不是模型该给的格式」。还有一个局限:「到了最大步数」那条我们分不清是第 6 类还是第 8 类,只看最终回答信息不够,要看整条轨迹里有没有重复的调用。Day 192 的循环检测就是在轨迹上做这件事。

</details>

### 练习 3:重试能把十步成功率拉回多少

假设每一步失败都是临时的、互相独立的(比如偶发的 429),失败了允许重试。改一下 `chain_sim.py`:每一步最多重试 0、1、2 次,单步 98%,看十步全成功的概率。再想想:哪几类失败不满足「临时、独立」这个前提?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/retry_math.py  练习 3:每步失败时允许重试一次,十步全成功的概率变成多少
import random

rng = random.Random(1890)


def step_ok(p: float, retries: int) -> bool:
    return any(rng.random() < p for _ in range(1 + retries))  # 第一次加上最多 retries 次重试,有一次成功就算成功


for retries in [0, 1, 2]:
    p_step = 1 - (1 - 0.98) ** (1 + retries)
    runs = 10_000
    ok = sum(all(step_ok(0.98, retries) for _ in range(10)) for _ in range(runs))
    print(f"重试 {retries} 次 | 单步成功率 {p_step:.4%} | 十步全成功 算出来 {p_step ** 10:.2%} | 模拟 {ok / runs:.2%}")
```

<div class="line-notes">

- `return any(rng.random() < p for _ in range(1 + retries))` 一步最多尝试 `1 + retries` 次,`any` 是「有一次成功就行」,相当于 JS 的 `some`。`any` 遇到第一个 True 就停,和真实的重试一样,成功了就不再试。
- `p_step = 1 - (1 - 0.98) ** (1 + retries)` 一步失败的概率是 2%,连续失败 2 次是 2% × 2% = 0.04%,所以重试一次后单步成功率是 1 − 0.0004 = 99.96%。

</div>

```bash
uv run python -m part03.retry_math
```

```text
重试 0 次 | 单步成功率 98.0000% | 十步全成功 算出来 81.71% | 模拟 82.26%
重试 1 次 | 单步成功率 99.9600% | 十步全成功 算出来 99.60% | 模拟 99.63%
重试 2 次 | 单步成功率 99.9992% | 十步全成功 算出来 99.99% | 模拟 99.98%
```

只重试一次,十步成功率就从 81.7% 拉到 99.6%。这就是为什么重试是第一道防线,明天第一个讲它。

但这个算式有个前提:**失败是临时的、每次独立的。** 第 1 类(429、5xx、断连)基本满足,过一会儿再试大概率就好。不满足的有:401、400 这种永久错误,重试结果一模一样;第 4、5 类模型行为错误,同样的上下文原样再问一次,模型很可能犯同样的错,要把报错放进上下文让它「改」,而不是让它「重来」;第 2 类工具卡住,如果是下游服务挂了,重试只会再卡一次,还可能把它压得更死;第 6 类重复调用,本身就是「重试」过头了。所以「哪类失败配哪种治法」不能乱配,这正是今天分类的意义。

</details>

**验收标准**:`chain_sim.py` 的结果和文中一致,能说出 0.98 的 10 次方是多少;能默写九类表格的前三列;`failure_zoo.py` 跑出九类的结果,能说出哪三类被接住了、第 1 类为什么耗时 3.6 秒而 401 只有 0.2 秒;练习 1 十条都有分类和治法;练习 2 九条里八条分对;练习 3 能说出重试的前提和不满足前提的几类。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 成功率连乘 | 一个任务要每一步都成功才算成功,总成功率是各步成功率相乘。单步 98%、十步约 81.7% |
| 失败模式(failure mode) | 系统出错的一种典型方式,有固定的症状和对应的治法。今天按层分成九类 |
| 基础设施层 | 模型 API、网络、外部服务这些「管道」出的问题,和模型聪不聪明无关 |
| 模型行为层 | 模型自己犯的错:参数写坏、调了不存在的工具、反复发同一个调用 |
| 任务层 | 单步都没错,但整个任务失控:结果太大、停不下来、做不完 |
| 临时错误(transient error) | 过一会儿再试大概率就好的错误,如 429、5xx、连接断开 |
| 永久错误 | 重试多少次结果都一样的错误,如 400 请求有误、401 认证失败、404 找不到 |
| 429 / 5xx | HTTP 状态码。429 是请求太多被限流;5xx(500、502、503……)是服务端出错 |
| 幻觉工具 | 模型调用了一个根本没定义的工具名 |
| 假模型(fake LLM) | 和真客户端长得一样、按剧本回话的测试替身,不联网不花钱,能稳定地制造各种失败 |
| 鸭子类型 | Python 不看对象「是什么类」,只看它「有没有这些方法和属性」。TS 的结构类型是同一个意思 |
| 看起来成功的失败 | 没有异常、没有超时,但结果是错的。工程手段抓不到,要靠评测 |

## 常见误区

**以为单步够准,长任务就没问题。** 单步 98% 听起来很高,十步只剩 81.7%,二十步 66.8%。步数越多,越要在每一步加接住错误的办法。

**所有失败一律重试。** 练习 3 的算式只对临时错误成立。401 重试一百次也是 401,模型的参数错了原样重问很可能还错,下游挂了重试只会压得更死。先分类,再选治法。

**以为 SDK 没有重试。** `failure_zoo` 里连不上的那一类耗了 3.6 秒才抛异常,因为 `LLMClient` 给 SDK 设了 `max_retries=3`,它已经悄悄重试过了。自己再套一层重试之前,先搞清楚下面那层在干什么,否则请求次数是乘出来的。明天细讲。

**只看最终回答判断失败类型。** 重复调用、停不下来、做不完,最终回答都是同一句「到了最大步数」。分清它们要看轨迹:每一步调了什么、拿到了什么。所以每次运行都要把完整的 messages 存下来。

**以为程序没报错就是成功了。** 第 7 类结果过长没有任何报错,21 万字符悄悄进了上下文;九类之外的「看起来成功的失败」更是连可疑的迹象都没有。没报错只说明没撞上今天这九类。

**用真模型去测失败处理逻辑。** 让真模型稳定地输出不合法 JSON 几乎做不到,而且花钱、结果不确定。重试、超时、截断、循环检测这些工程逻辑,用假模型测;真模型留给回答质量的评测。

**在字符串里认错误类型。** 练习 2 靠 `startswith('{"error": "没有叫 ')` 认幻觉工具,注册表文案一改就失效。真项目里让工具层返回结构化的错误码,下游按码处理。

## 学习资料

### 文档与文章

- [Chip Huyen · Agents](https://huyenchip.com/2025/01/07/agents.html):读「Agent Failure Modes and Evaluation」一节,她把失败分成规划失败、工具失败、效率问题三类,和今天的三层是两种切法,对照着看,英文,30 分钟。
- [Why Do Multi-Agent LLM Systems Fail?](https://arxiv.org/abs/2503.13657):UC Berkeley 等机构的论文,标注了 7 个多 Agent 框架的 1,600 多条轨迹,归纳出 14 种失败、3 大类(系统设计问题、Agent 之间不一致、任务验证),人工标注一致性 kappa 0.88。今天读摘要和分类图,讲多 Agent 时再细读,英文。
- [Microsoft 安全博客 · New whitepaper outlines the taxonomy of failure modes in AI agents](https://www.microsoft.com/en-us/security/blog/2025/04/24/new-whitepaper-outlines-the-taxonomy-of-failure-modes-in-ai-agents/):2025 年 4 月,微软 AI 红队从安全角度给 Agent 失败做的分类,和今天偏工程的分类互补。这个页面对命令行请求返回 403,需浏览器打开,英文。
- [AWS Builders' Library · Timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/):第 1、2 类的经典读物,和 AI 无关,明天的预习,英文,40 分钟。
- [openai-python](https://github.com/openai/openai-python):README 里搜 Retries,看 SDK 默认对哪些错误自动重试、重试几次,解释了今天 3.6 秒和 0.2 秒的差别,英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1rhLn6iEip&autoplay=0&high_quality=1" title="90%的Agent都翻车了｜5种死法×5种解法【费曼学AI EP.30】" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>费曼学AI · 90% 的 Agent 都翻车了:5 种死法 × 5 种解法 · 12 分钟,把常见失败和对策过一遍,边看边把它的「5 种死法」往今天的九类里放,看能不能放进去。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1GrGE63ESw&autoplay=0&high_quality=1" title="IBM《为什么Agentic AI会失败：无限循环、规划错误等问题解析》中英字幕（LLM）" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI双语课 · IBM《为什么 Agentic AI 会失败:无限循环、规划错误等问题解析》中英字幕 · 13 分钟,IBM Technology 频道的搬运,重点听无限循环那段,对应今天的第 6、8 类。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Kn1XvZhYd34" title="How to Find Failure Patterns in Complex AI Agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hamel Husain · How to Find Failure Patterns in Complex AI Agents · 怎么在复杂 Agent 的轨迹里找失败规律,对应今天「只看最终回答分不清,要看轨迹」那一条,英文。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/T1Lowy1mnEg" title="How to Build Reliable AI Agents (without the hype)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Dave Ebbelaar · How to Build Reliable AI Agents (without the hype) · 讲把 Agent 拆成确定性组件、用代码兜住模型不可靠的部分,英文。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 6 章 Agent 部分的「Agent Failure Modes and Evaluation」一节,和上面那篇博客同一套分类,书里展开得更细,英文。
- Michael T. Nygard《Release It!》第 2 版(Pragmatic Bookshelf, 2018):讲生产系统怎么出事、怎么扛住的经典,第 5 章「Stability Patterns」里的超时、断路器等模式在 Agent 里全用得上。和 AI 无关,但第 1、2 类失败它讲得最透,英文。

### 开源项目与代码

- [openai/openai-python](https://github.com/openai/openai-python):`_base_client.py` 里有 SDK 自带的重试逻辑,搜 `_should_retry` 看它对哪些状态码重试,明天会用到。
- 今天这组不需要别的项目,`failure_zoo.py` 自己就是一个小靶场,后面四天每加一道防线就回来跑一遍,看体检报告里的「没有」变成「接住了」。

## 自测

1. 单步成功率 95%,一个 10 步的任务全部成功的概率大约是多少?如果每步失败都能重试一次(失败独立),呢?

<details><summary>答案</summary>

0.95 的 10 次方约 59.9%(今天模拟是 60.1%)。重试一次后单步成功率是 1 − 0.05 × 0.05 = 99.75%,10 步约 97.5%。前提是失败是临时且独立的。

</details>

2. 三层九类是哪九类?各属于哪一层?

<details><summary>答案</summary>

基础设施层:模型 API 临时错误、工具卡住、工具抛异常。模型行为层:参数格式错误、幻觉工具、重复调用。任务层:结果过长、停不下来、做不完。

</details>

3. 今天 `run_agent` 接住了哪三类?是靠什么接住的?

<details><summary>答案</summary>

工具抛异常、参数格式错误、幻觉工具。都是靠 Day 170 注册表的 `call`:先检查工具名在不在、不在就返回可用列表;再在 `try/except` 里解析参数、执行工具,任何异常都转成 `{"error": "类型: 信息"}` 作为 tool 消息交给模型,程序不崩,模型下一步可以改。

</details>

4. 连不上服务器那次用了 3.6 秒才抛异常,写错 key 那次只用了 0.2 秒。为什么?

<details><summary>答案</summary>

`LLMClient` 给 OpenAI SDK 设了 `max_retries=3`,SDK 会对连接错误、429、5xx 这类临时错误自动重试,中间还要等待,所以连不上的那次重试了三次才放弃。401 是永久错误,SDK 不重试,第一次失败就抛出。这也说明同一层里还要分临时和永久,治法不同。

</details>

5. 面试题:你的 Agent 上线一周,监控显示 3% 的请求「失败」。你会怎么分析?

<details><summary>答案</summary>

示范回答:先把「失败」拆开,不同失败的治法完全不同。第一步按层分桶:异常日志里的模型 API 错误(再分 429/5xx 这类临时的和 400/401 这类永久的)、工具超时和工具异常,属于基础设施层,看是哪个下游、什么时段,加重试、超时、断路器;轨迹里参数解析失败、调了不存在的工具、同一调用重复,属于模型行为层,看是不是工具描述不清或者工具太多,改描述、加循环检测;撞到步数或 token 上限的,属于任务层,看是任务本身太难还是在空转,调预算、加部分答案和转人工。第二步看这 3% 之外:没报错的请求里有多少其实答错了,抽样做人工评审或者用带标准答案的评测集,这部分往往比 3% 大。最后每一类都要有对应的离线测试(用假模型稳定复现),修完回归。

</details>

## 明天预告

明天是 **Day 190 · 失败模式(二):重试和 tenacity**。今天体检报告里第一行就是「没有,崩」:模型 API 一出临时错误,整个任务就丢了。明天先讲哪些错误该重试、哪些不该,为什么要「指数退避加抖动」,再用 tenacity 库的 `@retry` 四个参数把重试写出来,用今天练习 2 那种手工造出来的 429 测它真的会等、会停。
