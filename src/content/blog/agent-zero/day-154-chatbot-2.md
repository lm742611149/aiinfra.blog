---
title: 'Day 154 · 小项目(二):切换厂商和每轮成本统计'
description: '给 Day 152 的聊天机器人加两样东西:每轮回答后打印首字延迟、token 和这一轮花了多少钱,以及 /env 在 DeepSeek 和硅基流动之间切换。切换时故意踩一次「配置串味」(价格和模型名悄悄沿用上一家的),再补上 Day 152 留下的洞:被 Ctrl+C 打断的调用没进账单,只能按字数估算。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'cost', 'cli', 'agent-zero']
series: 'agent-zero'
day: 154
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 153](/blog/agent-zero/day-153-week22-review/) 是第 22 周的复习日,把结构化输出那五天串成了一张图,又用本周的东西做了一个工单分拣小工具。再往前的 [Day 152](/blog/agent-zero/day-152-chatbot-1/) 把第二部分的零件拼成了一个命令行聊天机器人:`input()` 循环、流式打印、`Conversation` 记多轮、`/help` `/clear` `/history` `/quit` 四个命令,出错或者 Ctrl+C 时把这一轮从历史里删掉。

那天收工时留了一个尾巴:被 Ctrl+C 打断的那次调用,`LLMClient.stream()` 没走到记账那一行,本地账单里没有它,可服务端已经生成了一部分回答。今天就从这里接着做。再加上计划好的两个功能:每轮回答后打印这一轮花了多少钱,以及不退出程序就能换一家厂商。

## 今天要解决的问题

学完今天你应该能做到:

1. 在聊天机器人里每轮打印一行小字:模型、首字延迟、输入输出 token、缓存命中数、这一轮的钱和累计的钱,并且能手算验证其中任何一个数。
2. 实现 `/env 文件名` 在两家厂商之间切换,`/cost` 按厂商分开列账,说清楚切换时为什么要新建客户端、旧账本为什么要留着,并且避开「配置串味」这个不报错的坑。
3. 给被 Ctrl+C 打断的调用估一个花费记进账里,说得出这个估算有多准、什么时候不准。

今天有两个新概念:**分厂商记账**(账本跟着客户端走,切换时要保管旧的)和**估算**(拿不到真实 usage 时怎么办)。

预计用时:2.5 小时,实跑花费不到 ¥0.05(文末有算式)。前置:[Day 152](/blog/agent-zero/day-152-chatbot-1/) 的 `part02/chatbot.py`,[Day 123](/blog/agent-zero/day-123-openai-compatible/) 的 `.env.sf` 和 `override=True`,[Day 124](/blog/agent-zero/day-124-cost/) 的 `LLM_PRICE` 和算价公式,[Day 135](/blog/agent-zero/day-135-llm-client-1/)–[Day 137](/blog/agent-zero/day-137-llm-client-3/) 的 `LLMClient`(`ledger`、`last`、`price`),[Day 131](/blog/agent-zero/day-131-conversation-cost/) 的越聊越贵,[Day 71](/blog/agent-zero/day-071-pytest-1/)–[Day 73](/blog/agent-zero/day-073-pytest-3/) 的 pytest。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `switch_env()` 和 `record_aborted()`;再做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先想清楚要加什么

聊天机器人分三天做完,今天是中间那一段:

| 哪天 | 做什么 |
| --- | --- |
| [Day 152](/blog/agent-zero/day-152-chatbot-1/) | 输入循环、流式输出、多轮历史、四个命令、出错回滚 |
| 今天 Day 154 | 每轮成本行、`/env` 切换厂商、`/cost`、估算被打断的调用 |
| [Day 155](/blog/agent-zero/day-155-chatbot-3/) | `/save` `/load` `/system`、第二部分知识地图和面试题 |

先看今天要加的状态放在哪里:

<figure>
<svg viewBox="0 0 640 290" role="img" aria-label="ChatBot 对象里的三份账:现在用的客户端自带账本,切走的客户端账本放进 retired 列表,被打断的调用估算后记进 aborted;total_cost 把三份加起来">
<rect x="0" y="0" width="640" height="290" fill="var(--paper-raised)"/>
<rect x="20" y="20" width="190" height="86" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="32" y="44" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">self.client(现在用的)</text>
<text x="32" y="66" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">.model .price</text>
<text x="32" y="86" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">.ledger 真实 usage</text>
<rect x="225" y="20" width="190" height="86" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="237" y="44" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">self.retired(切走的)</text>
<text x="237" y="66" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">[(.env, 模型, 账本),</text>
<text x="237" y="86" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)"> (.env.sf, 模型, 账本)]</text>
<rect x="430" y="20" width="190" height="86" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="442" y="44" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">self.aborted(被打断)</text>
<text x="442" y="66" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">按字数估算,不是</text>
<text x="442" y="86" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">服务端给的 usage</text>
<line x1="115" y1="106" x2="260" y2="160" stroke="var(--ink-faint)"/>
<line x1="320" y1="106" x2="320" y2="160" stroke="var(--ink-faint)"/>
<line x1="525" y1="106" x2="380" y2="160" stroke="var(--ink-faint)"/>
<rect x="190" y="160" width="260" height="40" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="206" y="185" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">total_cost() = 三份相加</text>
<line x1="320" y1="200" x2="320" y2="226" stroke="var(--ink-faint)"/>
<text x="120" y="248" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">每轮那一行的「累计」、/cost 的「合计」、退出时那句话都读它</text>
<text x="120" y="270" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">/env 切换 = 把 self.client 的账本挪进 retired,再换一个新客户端</text>
</svg>
<figcaption>账本是客户端的一部分,所以换客户端就等于换账本。今天的所有改动都在围绕这一点:旧账本不能丢,被打断的调用也要有个地方记。</figcaption>
</figure>

一步一步来,每一步都能跑。

## 第一步:一轮的账单从哪来

先不动聊天机器人,用 8 行代码看清「一轮花了多少钱」要读哪几个字段。新建 `part02/turn_report.py`:

```python
# agent-zero-lab/part02/turn_report.py
from common.llm import LLMClient

client = LLMClient()
messages = [
    {"role": "system", "content": "你是云簿 CloudLedger 的客服助手。回答简短。"},
    {"role": "user", "content": "发票抬头开错了怎么办?两句话"},
]
for piece in client.stream(messages, temperature=0.5, max_tokens=300):
    print(piece, end="", flush=True)
print()

r = client.last
print("model:", client.model)
print("ttft:", r.ttft)
print("latency:", r.latency)
print("prompt_tokens:", r.prompt_tokens)
print("cache_hit_tokens:", r.cache_hit_tokens)
print("completion_tokens:", r.completion_tokens)
print("cost:", r.cost)
print("price:", client.price)
print(f"  [{client.model} | 首字 {r.ttft:.2f}s | 输入 {r.prompt_tokens}(缓存 {r.cache_hit_tokens}) | 输出 {r.completion_tokens} | ¥{r.cost:.5f}]")
```

<div class="line-notes">

- `from common.llm import LLMClient` [Day 135](/blog/agent-zero/day-135-llm-client-1/) 封装的客户端,今天要读它的 `last`、`price` 和 `ledger`。
- `client = LLMClient()` 不传文件名,读 `agent-zero-lab/.env`,也就是 DeepSeek 官方的 `deepseek-flash`。
- `messages = [` 两条消息:system 是 22 个字左右的人设,user 是问题。输入 token 只有二十多个,是因为这次请求就这么短。
- `for piece in client.stream(messages, temperature=0.5, max_tokens=300):` 和 Day 152 一样的流式写法。流读完以后,`LLMClient` 会把完整结果放到 `client.last` 上。
- `print(piece, end="", flush=True)` 来一段打一段。
- `r = client.last` `last` 是一个 `ChatResult`,今天用到它的七个字段。注意它**只有在流读完以后才有值**,流还没读完或者中途被打断,`client.last` 是上一次的旧值,甚至根本不存在。
- `print("ttft:", r.ttft)` 首字延迟(time to first token):从发出请求到收到第一段正文的秒数,是个浮点数。如果整个回答里一个正文字都没有(比如一上来就被截断),它是 `None`,所以后面格式化时要考虑 `None`。
- `print("latency:", r.latency)` 从发请求到流读完的总秒数,今天的成本行不打印它,只作对照。
- `print("prompt_tokens:", r.prompt_tokens)` 服务端数出来的输入 token 数,包含 system 和 user 两条消息。
- `print("cache_hit_tokens:", r.cache_hit_tokens)` 输入里有多少个 token 命中了缓存([Day 124](/blog/agent-zero/day-124-cost/) 讲过)。
- `print("cost:", r.cost)` `LLMClient` 按 `price` 算出来的钱,单位是元。
- `print("price:", client.price)` 现在用的价格,从 `.env` 的 `LLM_PRICE` 来。
- `print(f"  [{client.model} | 首字 {r.ttft:.2f}s |` 把上面几项拼成一行小字。`{r.ttft:.2f}` 是 f-string 的格式说明,保留两位小数。

</div>

在 `agent-zero-lab` 根目录运行:

```bash
uv run python -m part02.turn_report
```

我的输出(2026-10-23,`deepseek-flash`):

```text
发票抬头开错需联系开票方作废原发票并重新开具正确抬头的发票。若已跨月或已认证，需按红字发票流程处理后再重开。
model: deepseek-flash
ttft: 0.502909327999987
latency: 0.9458358430001681
prompt_tokens: 27
cache_hit_tokens: 0
completion_tokens: 40
cost: 0.000374
price: Price(hit=0.04, miss=2.0, out=8.0)
  [deepseek-flash | 首字 0.50s | 输入 27(缓存 0) | 输出 40 | ¥0.00037]
```

最后一行就是我们要的成本行。手算验证一下,这是 [Day 124](/blog/agent-zero/day-124-cost/) 的公式:

```text
(命中 0 × 0.04 + 未命中 27 × 2 + 输出 40 × 8) ÷ 1,000,000
= (0 + 54 + 320) ÷ 1,000,000
= 0.000374 元
```

和 `cost: 0.000374` 一致。成本行里写 `¥0.00037` 而不是 `¥0.000374`,是因为 `:.5f` 保留五位小数,够看出「一轮几分之一分钱」就行了。

两点提醒。第一,`price` 是配置文件里写的**高峰价**,DeepSeek 空闲时段实际只收一半,所以这行数字是偏高的上限,不是账单。第二,首字延迟 0.50 秒,总耗时 0.95 秒,两个数差不多大,因为回答只有 40 个 token;回答越长,两个数差得越多,首字延迟才是用户觉得「它有没有反应」的那个数。

## 第二步:换厂商,账本不能跟着丢

[Day 123](/blog/agent-zero/day-123-openai-compatible/) 我们用 `ENV_FILE` 换厂商,每次换要重启脚本。聊天机器人里想不退出就换,办法是新建一个 `LLMClient`,读另一个配置文件。先用一个脚本看看两个客户端同时存在时,账本是什么样。新建 `part02/switch_demo.py`:

```python
# agent-zero-lab/part02/switch_demo.py
from common.llm import LLMClient

QUESTION = [{"role": "user", "content": "用一句话说说什么是发票抬头"}]

a = LLMClient(".env")
print("A:", a.model, a.price)
a.chat(QUESTION, max_tokens=100)
print("A 账单:", a.ledger)

b = LLMClient(".env.sf")
print("B:", b.model, b.price)
b.chat(QUESTION, max_tokens=100)
print("B 账单:", b.ledger)

print("A 账单现在:", a.ledger)
```

<div class="line-notes">

- `QUESTION = [{"role": "user", "content": "用一句话说说什么是发票抬头"}]` 只有一条 user 消息,没有 system,够用了。
- `a = LLMClient(".env")` 读 DeepSeek 的配置。参数是配置文件路径,[Day 123](/blog/agent-zero/day-123-openai-compatible/) 说过 `LLMClient` 内部用 `load_dotenv(文件, override=True)`。
- `print("A:", a.model, a.price)` 打印 `deepseek-flash` 和 `Price(hit=0.04, miss=2.0, out=8.0)`。
- `a.chat(QUESTION, max_tokens=100)` 非流式调用。返回值这里不用,所以不赋值;每次调用都会被 `a.ledger` 记一笔。
- `print("A 账单:", a.ledger)` `Ledger` 的打印格式是 Day 136 写的:「N 次调用 | 输入 … / 输出 … tokens | 约 ¥…」。
- `b = LLMClient(".env.sf")` 读硅基流动的配置,这是另一个独立的对象,有自己的 `ledger`。
- `print("B:", b.model, b.price)` 打印 `deepseek-ai/DeepSeek-V4-Flash` 和 `Price(hit=0.3, miss=3.0, out=9.0)`,价格是硅基流动自己的一套。
- `print("A 账单现在:", a.ledger)` 创建 B 并调用以后,A 的账单没变,仍是 1 次调用。这就是要验证的事。

</div>

```bash
uv run python -m part02.switch_demo
```

我的输出:

```text
A: deepseek-flash Price(hit=0.04, miss=2.0, out=8.0)
A 账单: 1 次调用 | 输入 10 / 输出 31 tokens | 约 ¥0.0003
B: deepseek-ai/DeepSeek-V4-Flash Price(hit=0.3, miss=3.0, out=9.0)
B 账单: 1 次调用 | 输入 10 / 输出 29 tokens | 约 ¥0.0003
A 账单现在: 1 次调用 | 输入 10 / 输出 31 tokens | 约 ¥0.0003
```

两个客户端各记各的账,谁也不影响谁。所以聊天机器人里「切换」的做法很直接:**新建一个客户端换上去,旧客户端的账本收进一个列表留着**。累计花费就是列表里每本账加上现在这本。

这里有一个设计上的取舍。另一种做法是让 `LLMClient` 自己支持换配置(比如加一个 `reload(env_file)` 方法),账本一直是同一本。我没这么做,因为 `LLMClient` 是 Day 135–137 写好并测过的共享模块,后面每一天都在用,今天为了一个聊天机器人去改它不划算;而且一本账里混着两家的 token,以后想分开看就分不开了。

## 第三步:切换时的坑,配置会串味

看起来切换已经没事了:`LLMClient(新文件)` 一行。我第一次写就是这样写的,跑了几天没发现问题,直到故意拿一个缺了一行的配置文件试,才看到一个**不报错**的 bug。

先造两个缺东西的配置文件,都是从 `.env.sf` 删一行得到的:

```bash
grep -v '^LLM_PRICE' .env.sf > .env.noprice
grep -v '^LLM_MODEL' .env.sf > .env.nomodel
```

`grep -v` 是 [Day 5](/blog/agent-zero/day-005-terminal-3/) 学的 grep 加了 `-v`:反过来,**留下不匹配**的行。`^LLM_PRICE` 里的 `^` 表示「行首」。所以这两条命令分别生成「没有价格那行」和「没有模型名那行」的硅基流动配置。

先看缺价格。新建 `part02/stale_price.py`:

```python
# agent-zero-lab/part02/stale_price.py
from common.llm import LLMClient

QUESTION = [{"role": "user", "content": "用一句话说说什么是发票抬头"}]

a = LLMClient(".env")
print("A:", a.model, a.price)

b = LLMClient(".env.noprice")
print("B:", b.model, b.price)
r = b.chat(QUESTION, max_tokens=100)
print(f"B 算出来 ¥{r.cost:.6f}(输入 {r.prompt_tokens},输出 {r.completion_tokens})")
real = (r.prompt_tokens * 3 + r.completion_tokens * 9) / 1_000_000
print(f"按硅基流动真价应该是 ¥{real:.6f}")
```

<div class="line-notes">

- `a = LLMClient(".env")` 先建 DeepSeek 的客户端。这一步会把 `.env` 里的变量(包括 `LLM_PRICE=0.04,2,8`)**写进当前进程的环境变量**。
- `print("A:", a.model, a.price)` `deepseek-flash` 和 DeepSeek 的价格。
- `b = LLMClient(".env.noprice")` 读缺了 `LLM_PRICE` 的硅基流动配置。`load_dotenv(override=True)` 的规则是:文件里有的变量覆盖环境里的,**文件里没有的变量,环境里原来的值原封不动**。
- `print("B:", b.model, b.price)` 模型名是硅基流动的(文件里有),价格却还是 `0.04, 2.0, 8.0`,是上一个客户端留在环境变量里的。
- `r = b.chat(QUESTION, max_tokens=100)` 真请求发给硅基流动,这没错,错的只有价格。
- `real = (r.prompt_tokens * 3 + r.completion_tokens * 9) / 1_000_000` 用硅基流动的真实价格(未命中 3 元、输出 9 元每百万 token)手算一遍对照。这里命中数是 0,所以没有写命中那一项。

</div>

```bash
uv run python -m part02.stale_price
```

输出:

```text
A: deepseek-flash Price(hit=0.04, miss=2.0, out=8.0)
B: deepseek-ai/DeepSeek-V4-Flash Price(hit=0.04, miss=2.0, out=8.0)
B 算出来 ¥0.000196(输入 10,输出 22)
按硅基流动真价应该是 ¥0.000228
```

没有任何报错。模型名对了,请求也发对了,但算出来的钱用的是 DeepSeek 的价格,少了 14%。这种错最麻烦:数字看着合理,谁也不会怀疑它,等到月底对账才发现。

再看缺模型名。新建 `part02/stale_model.py`:

```python
# agent-zero-lab/part02/stale_model.py
import openai

from common.llm import LLMClient

QUESTION = [{"role": "user", "content": "用一句话说说什么是发票抬头"}]

a = LLMClient(".env")
print("A:", a.model, a.client.base_url)

c = LLMClient(".env.nomodel")
print("C:", c.model, c.client.base_url)
try:
    c.chat(QUESTION, max_tokens=100)
except openai.APIStatusError as e:
    print("C 出错:", e.status_code, e.message)
```

<div class="line-notes">

- `import openai` 为了接 `openai.APIStatusError`,[Day 126](/blog/agent-zero/day-126-error-codes/) 的那个异常类型。
- `print("A:", a.model, a.client.base_url)` `a.client` 是 `LLMClient` 里那个真正的 openai 客户端,`base_url` 是请求发去的地址。
- `c = LLMClient(".env.nomodel")` 这次文件里有 `LLM_BASE_URL` 和 key,没有 `LLM_MODEL`。
- `print("C:", c.model, c.client.base_url)` 地址换成了硅基流动,模型名却还是 `deepseek-flash`,是 A 留下的。
- `c.chat(QUESTION, max_tokens=100)` 把 DeepSeek 官方的模型名发给了硅基流动。
- `print("C 出错:", e.status_code, e.message)` 硅基流动不认这个名字,回 400。

</div>

```bash
uv run python -m part02.stale_model
```

输出:

```text
A: deepseek-flash https://api.deepseek.com
C: deepseek-flash https://api.siliconflow.cn/v1/
C 出错: 400 Error code: 400 - {'code': 20012, 'message': 'Model does not exist. Please check it carefully.', 'data': None}
```

这个至少报了错,而且是「模型不存在」,不难排查。但想一想如果两家都有一个叫 `deepseek-flash` 的模型呢?那就连这个报错也没有,请求悄悄发给了另一家的同名模型。

怎么防?不能靠 `try: LLMClient(path) except KeyError`,因为 `LLMClient` 读的是 `os.environ["LLM_MODEL"]`,环境里有旧值,**根本不会 KeyError**。要在新建客户端之前,单独检查文件本身。`python-dotenv` 有个 `dotenv_values(路径)` 函数,只把文件解析成字典,**不碰环境变量**。新建 `part02/envcheck.py`:

```python
# agent-zero-lab/part02/envcheck.py
from pathlib import Path

from dotenv import dotenv_values

REQUIRED = ("LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "LLM_PRICE")


def missing_keys(path: str) -> list[str]:
    """配置文件里缺哪几个必填变量。文件不存在时抛 FileNotFoundError。"""
    if not Path(path).is_file():
        raise FileNotFoundError(path)
    values = dotenv_values(path)
    return [k for k in REQUIRED if not values.get(k)]


if __name__ == "__main__":
    for name in (".env", ".env.sf", ".env.noprice", ".env.nomodel", ".env.nope"):
        try:
            print(f"{name:14s} 缺 {missing_keys(name)}")
        except FileNotFoundError:
            print(f"{name:14s} 文件不存在")
```

<div class="line-notes">

- `from pathlib import Path` [Day 37](/blog/agent-zero/day-037-pathlib/) 学的路径对象,这里只用它的 `is_file()`。
- `from dotenv import dotenv_values` 和 `load_dotenv` 同一个包。区别:`load_dotenv` 把变量写进环境;`dotenv_values` 只返回一个字典,什么都不改。
- `REQUIRED = ("LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "LLM_PRICE")` 四个必填变量。`LLM_EXTRA_BODY` 不算必填,缺了顶多沿用旧值,不影响钱和模型(练习 1 会碰到它)。
- `def missing_keys(path: str) -> list[str]:` 返回缺失的变量名列表,空列表表示齐全。
- `if not Path(path).is_file():` 文件不存在,或者它是个目录,都算没找到。
- `raise FileNotFoundError(path)` 抛标准库自带的异常,调用方用 `except FileNotFoundError` 接,不用自己发明新类型。
- `values = dotenv_values(path)` 对 `.env.noprice` 来说,得到的字典里没有 `LLM_PRICE` 这个 key。
- `return [k for k in REQUIRED if not values.get(k)]` 列表推导式([Day 23](/blog/agent-zero/day-023-comprehensions/)):按 `REQUIRED` 的顺序挑出取不到或者为空的。`.get(k)` 取不到返回 `None`,`not None` 是 `True`,和空字符串一样会被挑出来。
- `if __name__ == "__main__":` 直接运行时打印五个文件的检查结果,方便你自己改了配置马上验。

</div>

```bash
uv run python -m part02.envcheck
```

输出:

```text
.env           缺 []
.env.sf        缺 []
.env.noprice   缺 ['LLM_PRICE']
.env.nomodel   缺 ['LLM_MODEL']
.env.nope      文件不存在
```

五种情况分得清清楚楚。有了它,`/env` 可以先问「这个文件齐不齐」,不齐就拒绝切换,还用着原来的那家。

## 第四步:被打断的调用,花了多少钱

回到 Day 152 留下的洞。按 Ctrl+C 打断流式回答时,服务端已经生成了一部分,`LLMClient.stream()` 在流读完之后才记账,所以本地账本里没有这一次。拿不到服务端的 `usage`(它在流的最后一块里,我们没等到),只能自己估。

估算要有个换算率:一个汉字大约多少 token。别凭印象,量一下。新建 `part02/token_ratio.py`,问六个不同的问题,对比字数和服务端数出来的 token 数:

```python
# agent-zero-lab/part02/token_ratio.py
from common.llm import LLMClient

SYSTEM = "你是云簿 CloudLedger 的客服助手。回答简短。"
QUESTIONS = [
    "发票抬头开错了怎么办?",
    "年付套餐和月付套餐有什么区别?列三条",
    "用 Python 写一个函数,把金额按千分位格式化,附一句说明",
    "写一份给团队开发票的 8 条操作清单",
    "Explain what an invoice header is in two sentences.",
    "我们的退款政策是什么?请详细说明申请流程和注意事项",
]

client = LLMClient()
tot_chars = tot_tokens = 0
for q in QUESTIONS:
    msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": q}]
    r = client.chat(msgs, temperature=0.5, max_tokens=400)
    chars = len(r.content)
    in_chars = len(SYSTEM) + len(q)
    tot_chars += chars
    tot_tokens += r.completion_tokens
    print(f"输出 {chars:4d} 字 {r.completion_tokens:4d} token 每字 {r.completion_tokens / chars:.2f} | 输入 {in_chars:3d} 字 {r.prompt_tokens:3d} token 每字 {r.prompt_tokens / in_chars:.2f}")
print(f"合计每字 {tot_tokens / tot_chars:.2f} token")
```

<div class="line-notes">

- `QUESTIONS = [` 六个问题故意不一样:纯中文的、带 Python 代码的、整段英文的。
- `client = LLMClient()` 用默认的 DeepSeek。
- `tot_chars = tot_tokens = 0` 链式赋值,两个变量同时设成 0,用来累加总字数和总 token。
- `msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": q}]` 每个问题单独问,不带历史。
- `r = client.chat(msgs, temperature=0.5, max_tokens=400)` 非流式,拿到的 `completion_tokens` 是服务端数的,最准。
- `chars = len(r.content)` 回答的字符数。`len()` 数的是字符不是字节,一个汉字算 1。
- `in_chars = len(SYSTEM) + len(q)` 输入只数 system 和问题两段的字数,没算消息格式本身的开销。
- `print(f"输出 {chars:4d} 字 {r.completion_tokens:4d} token 每字 {r.completion_tokens / chars:.2f}` 第一个问题得到「输出 128 字 88 token 每字 0.69」。`:4d` 把整数右对齐占 4 位,让几行对得齐。
- `print(f"合计每字 {tot_tokens / tot_chars:.2f} token")` 六个问题输出加起来的平均值。

</div>

```bash
uv run python -m part02.token_ratio
```

输出:

```text
输出  128 字   88 token 每字 0.69 | 输入  39 字  25 token 每字 0.64
输出  110 字   74 token 每字 0.67 | 输入  46 字  30 token 每字 0.65
输出  176 字   81 token 每字 0.46 | 输入  59 字  37 token 每字 0.63
输出  357 字  218 token 每字 0.61 | 输入  46 字  32 token 每字 0.70
输出  211 字   42 token 每字 0.20 | 输入  79 字  29 token 每字 0.37
输出  315 字  193 token 每字 0.61 | 输入  53 字  31 token 每字 0.58
合计每字 0.54 token
```

纯中文每个字 0.6 到 0.7 个 token;第 5 行是整段英文,每个字符才 0.20(一个 token 约 5 个字符);第 3 行带了 Python 代码,0.46,介于中间。总平均 0.54 没有意义,因为它取决于你问的是什么。我们的客服场景几乎全是中文,所以按汉字 0.65 估;全角标点(`,`、`。`)差不多一个符号一个 token,按 0.9;其余字符(字母、数字、半角标点、空格)按 0.3。这三个数不是理论值,是我拿十几条真实回答凑出来的,够用来估量级。

新建 `part02/cost_estimate.py`:

```python
# agent-zero-lab/part02/cost_estimate.py
import re

from common.llm import Price

HAN = re.compile(r"[一-鿿]")
FULL_PUNCT = re.compile(r"[　-〿＀-￯]")  # 全角标点:，。、：;「」等
HAN_PER_CHAR = 0.65  # 汉字:实测每字 0.6~0.7 个 token
PUNCT_PER_CHAR = 0.9  # 全角标点:差不多一个符号一个 token
OTHER_PER_CHAR = 0.3  # 字母、数字、半角标点、空格:约 3~4 个字符一个 token


def estimate_tokens(text: str) -> int:
    """粗估 token 数:汉字、全角标点、其他字符分开算。只用来估中断的调用,不是计费依据。"""
    han = len(HAN.findall(text))
    punct = len(FULL_PUNCT.findall(text))
    other = len(text) - han - punct
    return round(han * HAN_PER_CHAR + punct * PUNCT_PER_CHAR + other * OTHER_PER_CHAR)


def estimate_cost(price: Price, prompt_text: str, partial: str) -> tuple[int, int, float]:
    """估算一次被中断的调用:返回 (输入 token, 输出 token, 元)。输入一律按未命中价。"""
    prompt = estimate_tokens(prompt_text)
    completion = estimate_tokens(partial)
    cost = (prompt * price.miss + completion * price.out) / 1_000_000
    return prompt, completion, cost
```

<div class="line-notes">

- `import re` 正则表达式模块。不熟的话就把它当成「按规则找字符」的工具,下面两行是规则。
- `from common.llm import Price` `Price` 是 `LLM_PRICE` 解析出来的三个单价(`hit`、`miss`、`out`),[Day 124](/blog/agent-zero/day-124-cost/) 讲过。
- `HAN = re.compile(r"[一-鿿]")` 方括号里的 `一-鿿` 是一个范围:从「一」到「鿿」,Unicode 里常用汉字都在这段。`re.compile` 先把规则编译好,重复用时更快。
- `FULL_PUNCT = re.compile(r"[　-〿＀-￯]")` 两个范围:`　`–`〿` 是中日韩标点(「」、。),`＀`–`￯` 是全角字符(全角逗号和冒号)。`　` 这种写法表示「编号 3000 的那个 Unicode 字符」。
- `HAN_PER_CHAR = 0.65` 刚才量出来的 0.6 到 0.7 取中间。
- `PUNCT_PER_CHAR = 0.9` 、`OTHER_PER_CHAR = 0.3` 另外两个系数,注释写了来由。改系数只要改这三行。
- `def estimate_tokens(text: str) -> int:` 输入一段文字,返回估算的 token 数。
- `han = len(HAN.findall(text))` `findall` 返回所有匹配的列表,数一下有几个汉字。对 `"发票抬头,好"` 来说是 5(发、票、抬、头、好)。
- `punct = len(FULL_PUNCT.findall(text))` 同一个句子里的全角逗号算 1 个。
- `other = len(text) - han - punct` 总字符数减去前两类,剩下的都算「其他」。
- `return round(han * HAN_PER_CHAR + punct * PUNCT_PER_CHAR + other * OTHER_PER_CHAR)` 三类各乘各的系数相加,四舍五入成整数。对上面那句:5 × 0.65 + 1 × 0.9 = 4.15,结果是 4。`round()` 对 `.5` 会取偶数(`round(6.5)` 是 6),估算用不着在意。
- `def estimate_cost(price: Price, prompt_text: str, partial: str)` 参数是价格、发出去的全部文字、已经收到的那一截回答;返回三个值:输入 token、输出 token、元。
- `prompt = estimate_tokens(prompt_text)` 输入也是估的,因为被打断的调用根本没等到服务端数的 `usage`。
- `completion = estimate_tokens(partial)` 已经收到的回答。服务端可能还多生成了一些没发过来的,所以这个数偏低。
- `cost = (prompt * price.miss + completion * price.out) / 1_000_000` 输入一律按未命中价,假设没命中缓存;命中了实际更便宜,所以这一项偏高。两个偏差方向相反,有一点抵消。

</div>

估得准不准?别猜,拿真实调用对一下。新建 `part02/estimate_check.py`,还是那六个问题,每个问题同时打印估算值和服务端给的真实值:

```python
# agent-zero-lab/part02/estimate_check.py
from common.llm import LLMClient
from part02.cost_estimate import estimate_cost

SYSTEM = "你是云簿 CloudLedger 的客服助手。回答简短。"
QUESTIONS = [
    "发票抬头开错了怎么办?",
    "年付套餐和月付套餐有什么区别?列三条",
    "用 Python 写一个函数,把金额按千分位格式化,附一句说明",
    "写一份给团队开发票的 8 条操作清单",
    "Explain what an invoice header is in two sentences.",
    "我们的退款政策是什么?请详细说明申请流程和注意事项",
]

client = LLMClient()
for q in QUESTIONS:
    msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": q}]
    r = client.chat(msgs, temperature=0.5, max_tokens=400)
    prompt_text = "".join(m["content"] for m in msgs)
    p, c, cost = estimate_cost(client.price, prompt_text, r.content)
    print(f"输入 估{p:3d}/实{r.prompt_tokens:3d} | 输出 估{c:3d}/实{r.completion_tokens:3d} | 花费 估¥{cost:.5f}/实¥{r.cost:.5f}")
```

<div class="line-notes">

- `from part02.cost_estimate import estimate_cost` 导入刚写的估算函数。在 `agent-zero-lab` 根目录用 `python -m part02.estimate_check` 运行,这个导入才找得到。
- `r = client.chat(msgs, temperature=0.5, max_tokens=400)` 完整地问一遍,拿到真实的 token 数,模拟「如果它没被打断」的情况。
- `prompt_text = "".join(m["content"] for m in msgs)` 把发出去的所有消息的文字连成一个字符串。括号里是生成器表达式,和列表推导式一个意思,只是不先攒成列表。
- `p, c, cost = estimate_cost(client.price, prompt_text, r.content)` 返回的三元组解包给三个变量。这里把完整回答当作「已收到的部分」。
- `print(f"输入 估{p:3d}/实{r.prompt_tokens:3d} | 输出 估{c:3d}/实{r.completion_tokens:3d}` 第一行是「输入 估 21/实 25 | 输出 估 63/实 69」。

</div>

```bash
uv run python -m part02.estimate_check
```

输出:

```text
输入 估 21/实 25 | 输出 估 63/实 69 | 花费 估¥0.00055/实¥0.00060
输入 估 26/实 30 | 输出 估 63/实 70 | 花费 估¥0.00056/实¥0.00062
输入 估 31/实 37 | 输出 估 47/实 64 | 花费 估¥0.00044/实¥0.00059
输入 估 25/实 32 | 输出 估191/实205 | 花费 估¥0.00158/实¥0.00170
输入 估 29/实 29 | 输出 估 65/实 43 | 花费 估¥0.00058/实¥0.00040
输入 估 30/实 31 | 输出 估134/实153 | 花费 估¥0.00113/实¥0.00129
```

中文的几行(1、2、4、6)花费差 7% 到 12%,偏低。带代码的第 3 行低了 25%,整段英文的第 5 行反而高了 45%。所以结论很具体:**中文客服场景下估算能到八九成,英文和代码会差得多**;而且被打断时回答只有一半,真实的输出还在继续生成,估算只会更偏低。它的用途是让账单不要「假装这次没花钱」,不是对账。真要对账,以厂商控制台的账单为准。

另一点诚实的话:厂商对「连接断开后已经生成但没发给你的 token」到底收不收、收多少,各家规则不同,我没有拿平台账单核对过。所以聊天机器人里这一行写的是「估算」,不是「已扣费」。

## 第五步:拼成 chatbot.py

零件齐了。把 Day 152 的 `part02/chatbot.py` 换成下面的版本。比 Day 152 多了 `turn_line()`、`switch_env()`、`show_cost()`、`record_aborted()` 四个函数,`ask()` 和 `handle_command()` 各改了几处,其余不变。Day 152 的版本我另存成 `part02/chatbot_day152.py` 留着对照(`cp part02/chatbot.py part02/chatbot_day152.py`,在覆盖之前做)。

```python
# agent-zero-lab/part02/chatbot.py
"""命令行聊天机器人(二):切换厂商 + 每轮成本。运行:uv run python -m part02.chatbot [--env .env.sf]"""
import argparse
import readline  # noqa: F401

import openai

from common.llm import ChatResult, Conversation, Ledger, LLMClient
from part02.cost_estimate import estimate_cost
from part02.envcheck import missing_keys

DEFAULT_SYSTEM = "你是云簿 CloudLedger 的客服助手。回答简短,不确定就说不确定。"
HELP = """命令:
  /help         显示帮助
  /env [文件]   切换厂商配置,比如 /env .env.sf;不带文件就看当前用的
  /cost         看每家厂商和累计花了多少钱
  /clear        清空历史,从头聊
  /history      看现在记着几轮
  /quit         退出"""


def turn_line(model: str, r: ChatResult, total: float) -> str:
    """每轮回答后那一行小字:模型、首字延迟、token、本轮花费、累计花费。"""
    ttft = f"{r.ttft:.2f}s" if r.ttft is not None else "-"
    return (
        f"  [{model} | 首字 {ttft} | 输入 {r.prompt_tokens}(缓存 {r.cache_hit_tokens})"
        f" | 输出 {r.completion_tokens} | ¥{r.cost:.5f} | 累计 ¥{total:.4f}]"
    )


class ChatBot:
    def __init__(self, env_file: str | None) -> None:
        self.env_name = env_file or ".env"
        self.client = LLMClient(env_file)
        self.conv = Conversation(DEFAULT_SYSTEM, max_turns=10)
        self.retired: list[tuple[str, str, Ledger]] = []  # 切走的客户端:(配置文件, 模型, 账本)
        self.aborted = Ledger()  # 被 Ctrl+C 打断的调用,只能估算

    def total_cost(self) -> float:
        old = sum(ledger.cost for _, _, ledger in self.retired)
        return old + self.client.ledger.cost + self.aborted.cost

    def switch_env(self, path: str) -> None:
        if not path:
            print(f"现在用 {self.env_name} | {self.client.model} | {self.client.client.base_url}")
            return
        try:
            missing = missing_keys(path)
        except FileNotFoundError:
            print(f"找不到配置文件 {path},还在用 {self.env_name}")
            return
        if missing:
            print(f"{path} 缺少 {', '.join(missing)},没有切换,还在用 {self.env_name}")
            return
        try:
            new_client = LLMClient(path)
        except ValueError as e:
            print(f"{path} 读不进来({e}),没有切换,还在用 {self.env_name}")
            return
        self.retired.append((self.env_name, self.client.model, self.client.ledger))
        self.client = new_client
        self.env_name = path
        print(f"已切换到 {self.client.model}({path}),历史 {len(self.conv.turns)} 轮保留")

    def show_cost(self) -> None:
        for name, model, ledger in self.retired:
            print(f"  {name} {model}:{ledger}")
        print(f"  {self.env_name} {self.client.model}(现在用的):{self.client.ledger}")
        if self.aborted.calls:
            print(f"  被中断的(估算):{self.aborted}")
        print(f"合计约 ¥{self.total_cost():.4f}")

    def handle_command(self, line: str) -> bool:
        """处理斜杠命令。返回 False 表示退出。"""
        cmd, _, arg = line.partition(" ")
        if cmd == "/quit":
            return False
        if cmd == "/help":
            print(HELP)
        elif cmd == "/env":
            self.switch_env(arg.strip())
        elif cmd == "/cost":
            self.show_cost()
        elif cmd == "/clear":
            self.conv.turns.clear()
            print("历史已清空")
        elif cmd == "/history":
            print(f"记着 {len(self.conv.turns)} 轮,最多发最近 {self.conv.max_turns} 轮给模型")
        else:
            print(f"未知命令 {cmd}{' ' + arg if arg else ''},输入 /help 查看")
        return True

    def record_aborted(self, sent: list[dict[str, str]], partial: str) -> float:
        """被打断的调用没有 usage,按字数估算后记进 self.aborted,返回估算花费。"""
        prompt_text = "".join(m["content"] for m in sent)
        p, c, cost = estimate_cost(self.client.price, prompt_text, partial)
        self.aborted.calls += 1
        self.aborted.prompt_tokens += p
        self.aborted.completion_tokens += c
        self.aborted.cost += cost
        return cost

    def ask(self, text: str) -> None:
        self.conv.add_user(text)
        sent = self.conv.messages()
        parts: list[str] = []
        print("助手:", end="", flush=True)
        try:
            for piece in self.client.stream(sent, temperature=0.5, max_tokens=1000):
                parts.append(piece)
                print(piece, end="", flush=True)
        except openai.APIStatusError as e:
            self.conv.turns.pop()
            print(f"\n[出错 HTTP {e.status_code}] 这一轮没记进历史")
            return
        except openai.APIConnectionError:
            self.conv.turns.pop()
            print("\n[连不上服务器,检查网络或代理] 这一轮没记进历史")
            return
        except KeyboardInterrupt:
            self.conv.turns.pop()
            cost = self.record_aborted(sent, "".join(parts))
            print(f"\n[已中断] 这一轮没记进历史,但服务端照样收费,估算约 ¥{cost:.5f}")
            return
        r = self.client.last
        self.conv.add_assistant(r.message)
        if r.finish_reason == "length":
            print("\n[回答被 max_tokens 截断了]", end="")
        print()
        print(turn_line(self.client.model, r, self.total_cost()))

    def run(self) -> None:
        print(f"已连接 {self.client.model}。输入 /help 查看命令。")
        while True:
            try:
                line = input("\n你:").strip()
            except (EOFError, KeyboardInterrupt):
                break
            if not line:
                continue
            if line.startswith("/"):
                if not self.handle_command(line):
                    break
            else:
                self.ask(line)
        print(f"\n再见。本次运行累计约 ¥{self.total_cost():.4f}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", default=None, help="配置文件,默认 .env")
    ChatBot(parser.parse_args().env).run()


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `"""命令行聊天机器人(二)` 文档字符串改成「(二)」,运行方式不变。
- `import argparse` 这几行导入和 Day 152 一样,`readline` 仍然是为了方向键。
- `from common.llm import ChatResult, Conversation, Ledger, LLMClient` 新导入两个:`ChatResult` 只在 `turn_line()` 的类型标注里用,`Ledger` 用来存被打断的调用。
- `from part02.cost_estimate import estimate_cost` 第四步写的估算函数。
- `from part02.envcheck import missing_keys` 第三步写的配置检查。
- `DEFAULT_SYSTEM = "你是云簿 CloudLedger 的客服助手。` 没变。
- `HELP = """命令:` 加了 `/env` 和 `/cost` 两行说明,其余没变。
- `def turn_line(model: str, r: ChatResult, total: float) -> str:` 把「拼那行小字」单独拿出来做成函数,好处是不用真的调模型就能测它(练习 2)。参数是模型名、`ChatResult`、累计花费。
- `ttft = f"{r.ttft:.2f}s" if r.ttft is not None else "-"` 第一步说过 `ttft` 可能是 `None`。有值就格式化成「0.50s」,没有就写一个减号。
- `f"  [{model} | 首字 {ttft} | 输入 {r.prompt_tokens}(缓存 {r.cache_hit_tokens})"` 两个相邻的 f-string 会自动拼成一个字符串,所以可以拆成两行写。第一轮实测拼出来是「[deepseek-flash | 首字 0.74s | 输入 32(缓存 0)」。
- `f" | 输出 {r.completion_tokens} | ¥{r.cost:.5f} | 累计 ¥{total:.4f}]"` 后半截:输出 9 个 token,本轮 ¥0.00014,累计 ¥0.0001。本轮用五位小数,累计用四位,是因为单轮太小,看不出差别。
- `def __init__(self, env_file: str | None) -> None:` 构造函数,参数和 Day 152 一样。
- `self.env_name = env_file or ".env"` 记下现在用的是哪个文件,`/cost` 和 `/env` 的提示里要显示。不传 `--env` 时是 `.env`。
- `self.client = LLMClient(env_file)` 没变。
- `self.conv = Conversation(DEFAULT_SYSTEM, max_turns=10)` 没变。
- `self.retired: list[tuple[str, str, Ledger]] = []` 切走的客户端放这里。每一项是三元组:配置文件名、模型名、账本。把模型名也存下来,是因为 `/cost` 要显示是哪个模型花的钱。
- `self.aborted = Ledger()` 一本专门记「被打断调用」的账。直接用 `Ledger` 类,它本来就有 `calls`、`prompt_tokens`、`completion_tokens`、`cost` 四个字段,打印格式也现成。
- `def total_cost(self) -> float:` 三份账的钱加起来。
- `old = sum(ledger.cost for _, _, ledger in self.retired)` 生成器表达式加 `sum`。`for _, _, ledger in` 把每个三元组解包,前两项用不上,用 `_` 接住。列表是空的时候 `sum` 返回 0。
- `return old + self.client.ledger.cost + self.aborted.cost` 切走的、现在的、被打断的。
- `def switch_env(self, path: str) -> None:` 切换厂商,前面一大半都是检查。
- `if not path:` `/env` 后面没跟文件名时,当作「查看现在用的」。
- `print(f"现在用 {self.env_name} | {self.client.model} | {self.client.client.base_url}")` 实测是「现在用 .env | deepseek-flash | https://api.deepseek.com」。两个 `client`:前一个是 `ChatBot` 的属性,后一个是 `LLMClient` 里的 openai 客户端。
- `missing = missing_keys(path)` 先检查文件,**这时候还没碰 `LLMClient`**,所以环境变量一点没动。
- `except FileNotFoundError:` 实测 `/env .env.nope` 打印「找不到配置文件 .env.nope,还在用 .env」。
- `if missing:` 实测 `/env .env.noprice` 打印「.env.noprice 缺少 LLM_PRICE,没有切换,还在用 .env」。
- `new_client = LLMClient(path)` 到这里才真的建新客户端。先放进临时变量 `new_client`,不直接赋给 `self.client`:万一这一行失败,`self.client` 还是旧的完好的。
- `except ValueError as e:` 文件齐全但内容有毛病,比如 `LLM_EXTRA_BODY` 的 JSON 写坏了,`json.loads` 抛的 `JSONDecodeError` 是 `ValueError` 的子类。实测会打印「读不进来(Expecting property name enclosed in double quotes: line 1 column 2 (char 1))」。
- `self.retired.append((self.env_name, self.client.model, self.client.ledger))` 所有检查都过了才动手:把旧客户端的账本收起来。这里存的是账本对象本身,不是复制;旧客户端被替换以后没人再往里加账,所以不会变。
- `self.client = new_client` 换上新的。`self.conv` 一个字没动,所以历史还在,新厂商会看到之前聊过的所有内容。
- `print(f"已切换到 {self.client.model}({path}),历史 {len(self.conv.turns)} 轮保留")` 实测「已切换到 deepseek-ai/DeepSeek-V4-Flash(.env.sf),历史 1 轮保留」。
- `def show_cost(self) -> None:` `/cost` 的实现。
- `for name, model, ledger in self.retired:` 先列切走的,每个一行。
- `print(f"  {self.env_name} {self.client.model}(现在用的):{self.client.ledger}")` 再列现在用的。`{self.client.ledger}` 会调用 `Ledger.__str__`。
- `if self.aborted.calls:` 只有真的被打断过才显示这一行,数字 0 是假值。
- `print(f"合计约 ¥{self.total_cost():.4f}")` 最后一行合计。
- `elif cmd == "/env":` `handle_command` 新增的两个分支之一。`arg.strip()` 去掉两头空格,交给 `switch_env`。
- `elif cmd == "/cost":` 另一个新分支。其余分支(`/clear`、`/history`、未知命令)和 Day 152 一样。
- `def record_aborted(self, sent: list[dict[str, str]], partial: str) -> float:` 参数是发出去的消息列表和已经收到的那一截。返回估算的花费,给 `ask()` 打印用。
- `prompt_text = "".join(m["content"] for m in sent)` 所有消息的文字连成一串,和第四步的 `estimate_check.py` 一样的做法。
- `p, c, cost = estimate_cost(self.client.price, prompt_text, partial)` 价格取**现在这个客户端**的,所以切到硅基流动以后被打断,按硅基流动的价格估。
- `self.aborted.calls += 1` 往 `aborted` 这本账里一笔笔加。`Ledger.add()` 要一个 `ChatResult`,这里没有,所以直接改字段。
- `def ask(self, text: str) -> None:` 和 Day 152 相比多了三处,下面逐处标。
- `sent = self.conv.messages()` 新增:先把要发的消息存成变量。Day 152 是直接把 `self.conv.messages()` 写在 `stream()` 里,现在被打断时还要用它来估输入 token,所以要留着。
- `parts: list[str] = []` 新增:攒已经收到的每一小段,被打断时用来估输出 token。
- `parts.append(piece)` 新增:每收到一段就记一份,再打印。
- `cost = self.record_aborted(sent, "".join(parts))` `"".join(parts)` 把已收到的段拼回完整的半截回答。这一行在 `pop()` 之后、`print` 之前。
- `print(f"\n[已中断] 这一轮没记进历史,但服务端照样收费,估算约 ¥{cost:.5f}")` 把估算值直接告诉用户。
- `print(turn_line(self.client.model, r, self.total_cost()))` 每轮成功后多打这一行。`self.total_cost()` 在这一刻已经包含了这一轮,因为 `stream()` 结束时 `ledger.add` 过了。
- `print(f"\n再见。本次运行累计约 ¥{self.total_cost():.4f}")` 退出时那句话,从打印 `ledger` 改成打印总花费。
- `def main() -> None:` 以下和 Day 152 一样。

</div>

先把「切换」这条线从头走一遍。我用管道一次喂十二行,涵盖查看、拒绝、切换、再切回:

```bash
printf '我叫小林,买的是年付套餐\n/cost\n/env\n/env .env.nope\n/env .env.noprice\n/env .env.sf\n我叫什么?\n/cost\n/env .env\n年付能退吗?一句话\n/cost\n/quit\n' | uv run python -m part02.chatbot
```

我的输出:

```text
已连接 deepseek-flash。输入 /help 查看命令。

你:助手:小林你好！请问有什么可以帮你的？
  [deepseek-flash | 首字 0.74s | 输入 32(缓存 0) | 输出 9 | ¥0.00014 | 累计 ¥0.0001]

你:  .env deepseek-flash(现在用的):1 次调用 | 输入 32 / 输出 9 tokens | 约 ¥0.0001
合计约 ¥0.0001

你:现在用 .env | deepseek-flash | https://api.deepseek.com

你:找不到配置文件 .env.nope,还在用 .env

你:.env.noprice 缺少 LLM_PRICE,没有切换,还在用 .env

你:已切换到 deepseek-ai/DeepSeek-V4-Flash(.env.sf),历史 1 轮保留

你:助手:你叫小林，买的是年付套餐。有什么问题吗？
  [deepseek-ai/DeepSeek-V4-Flash | 首字 0.84s | 输入 47(缓存 0) | 输出 14 | ¥0.00027 | 累计 ¥0.0004]

你:  .env deepseek-flash:1 次调用 | 输入 32 / 输出 9 tokens | 约 ¥0.0001
  .env.sf deepseek-ai/DeepSeek-V4-Flash(现在用的):1 次调用 | 输入 47 / 输出 14 tokens | 约 ¥0.0003
合计约 ¥0.0004

你:已切换到 deepseek-flash(.env),历史 2 轮保留

你:助手:年付套餐是否可退需看具体退款政策，我不确定，建议查看购买时的条款或联系人工客服确认。
  [deepseek-flash | 首字 0.58s | 输入 73(缓存 0) | 输出 26 | ¥0.00035 | 累计 ¥0.0008]

你:  .env deepseek-flash:1 次调用 | 输入 32 / 输出 9 tokens | 约 ¥0.0001
  .env.sf deepseek-ai/DeepSeek-V4-Flash:1 次调用 | 输入 47 / 输出 14 tokens | 约 ¥0.0003
  .env deepseek-flash(现在用的):1 次调用 | 输入 73 / 输出 26 tokens | 约 ¥0.0004
合计约 ¥0.0008

你:
再见。本次运行累计约 ¥0.0008
```

逐段看:第一轮花 ¥0.00014,累计 ¥0.0001。`/env` 单独输入时显示现在用的;`.env.nope` 和 `.env.noprice` 两次切换都被拒绝,而且拒绝以后还在用 `.env`。`/env .env.sf` 成功,历史 1 轮保留,所以硅基流动那边**知道我叫小林**,回答里带着「年付套餐」。它的单价贵一些,47 个输入加 14 个输出花了 ¥0.00027,按硅基流动价格手算:(47 × 3 + 14 × 9) ÷ 1,000,000 = 0.000267,对得上。最后切回 `.env`,账本里这是第三行,`.env` 出现了两次,因为切回来建的是**新**客户端,从零开始记,第一个 `.env` 客户端的账本还在列表里。合计 0.0008 = 0.00014 + 0.00027 + 0.00035,小数位上略有四舍五入。

## 第六步:验证 Ctrl+C 真的被估进了账

Day 152 用一个小脚本代替手按 Ctrl+C,当时没贴代码。今天它是主角,我贴出来。它不是聊天机器人的一部分,只是测试用的脚手架:用 `subprocess` 把聊天机器人当子进程启动,往它的输入里写字,在第二个问题答到一半的时候给它发 SIGINT 信号(Ctrl+C 实际做的就是这件事)。新建 `part02/interrupt_driver.py`:

```python
# agent-zero-lab/part02/interrupt_driver.py
"""代替手按 Ctrl+C:启动 chatbot,第二个问题答到一半发 SIGINT。运行:uv run python -m part02.interrupt_driver"""
import os
import signal
import subprocess
import sys
import threading
import time

env = {**os.environ, "PYTHONUNBUFFERED": "1"}
proc = subprocess.Popen(
    [sys.executable, "-m", "part02.chatbot"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    text=True,
    env=env,
)
assert proc.stdin and proc.stdout
stdin, stdout = proc.stdin, proc.stdout
out: list[str] = []


def pump() -> None:
    while ch := stdout.read(1):
        out.append(ch)


threading.Thread(target=pump, daemon=True).start()


def prompts() -> int:
    return "".join(out).count("你:")


def wait_prompt(n: int) -> None:
    while prompts() < n:
        time.sleep(0.1)


def send(text: str) -> None:
    stdin.write(text + "\n")
    stdin.flush()


wait_prompt(1)
send("我叫小林")
wait_prompt(2)
send("写一份给团队开发票的 10 条操作清单,每条两句话")
time.sleep(1.5)
proc.send_signal(signal.SIGINT)
wait_prompt(3)
send("/cost")
wait_prompt(4)
send("/quit")
proc.wait(timeout=10)
time.sleep(0.2)
print("".join(out))
```

<div class="line-notes">

- `env = {**os.environ, "PYTHONUNBUFFERED": "1"}` 复制一份当前环境变量,再加一项。`PYTHONUNBUFFERED=1` 让子进程的输出不攒缓冲区、立刻吐出来,否则管道里的输出要等缓冲区满才到,我们等不到「你:」提示。`**` 把字典展开,相当于 JS 的 `{...process.env, X: "1"}`。
- `proc = subprocess.Popen(` 启动一个子进程,`Popen` 不等它结束,马上返回一个对象,相当于 Node 的 `child_process.spawn`。
- `[sys.executable, "-m", "part02.chatbot"],` 要运行的命令,拆成列表。`sys.executable` 是当前这个 Python 的路径,保证子进程用同一个虚拟环境,不用再套 `uv run`。
- `stdin=subprocess.PIPE,` 把子进程的输入接成管道,我们能往里写。
- `stdout=subprocess.PIPE,` 输出也接成管道,我们能读。
- `text=True,` 读写的是字符串而不是字节。
- `assert proc.stdin and proc.stdout` 管道有可能是 `None`,类型检查器要求先确认。`assert` 不成立就抛错。
- `stdin, stdout = proc.stdin, proc.stdout` 存成两个变量,下面的函数里用,这样类型检查器知道它们不是 `None`。
- `out: list[str] = []` 子进程输出的每个字符都攒进这里。
- `def pump() -> None:` 一个专门读输出的函数,放进另一个线程里跑,主线程才能同时往输入里写。
- `while ch := stdout.read(1):` 海象运算符 `:=`:读一个字符并赋给 `ch`,读到空字符串(子进程关闭输出)时循环结束。
- `threading.Thread(target=pump, daemon=True).start()` 起一个后台线程跑 `pump`。`daemon=True` 表示主程序结束时它不用等。
- `return "".join(out).count("你:")` 数一数输出里出现过几次「你:」,每出现一次说明聊天机器人又在等输入了。
- `def wait_prompt(n: int) -> None:` 等到出现第 n 个提示符为止,每 0.1 秒看一次。这样不用写死的等待时间,模型快慢都不影响。
- `stdin.write(text + "\n")` 写一行进子进程的输入,等于你在键盘上敲了字再按回车。
- `stdin.flush()` 立刻送出去,不然留在缓冲区里子进程收不到。
- `wait_prompt(1)` 等第一个提示出现。
- `send("我叫小林")` 第一个问题。
- `wait_prompt(2)` 等第一个回答完,第二个提示符出现。
- `send("写一份给团队开发票的 10 条操作清单,每条两句话")` 故意问一个会很长的回答。
- `time.sleep(1.5)` 让回答先流出 1.5 秒。
- `proc.send_signal(signal.SIGINT)` 发 SIGINT,聊天机器人里的 `ask()` 收到后抛 `KeyboardInterrupt`。
- `wait_prompt(3)` 等中断处理完、第三个提示符出现。
- `send("/cost")` 问账单。
- `proc.wait(timeout=10)` 等子进程退出,最多等 10 秒。
- `print("".join(out))` 最后把子进程的全部输出一次打印出来。

</div>

```bash
uv run python -m part02.interrupt_driver
```

我的输出:

```text
已连接 deepseek-flash。输入 /help 查看命令。

你:助手:你好,小林!我是云簿 CloudLedger 的客服助手,有什么可以帮你的吗?
  [deepseek-flash | 首字 0.41s | 输入 26(缓存 0) | 输出 21 | ¥0.00022 | 累计 ¥0.0002]

你:助手:以下是给团队开发票的 10 条操作清单：

1. **确认开票信息**：先向团队收集准确的开票抬头、税号和地址电话。信息不全或错误会导致发票作废重开。

2. **核对开票金额**：根据合同或订单确认本次开票金额与币种。金额不符需在开票前与团队确认清楚。

3. **选择发票类型**：确认需要增值税普通发票还是专用发票。专票需额外提供完整税务资质。

4. **
[已中断] 这一轮没记进历史,但服务端照样收费,估算约 ¥0.00098

你:  .env deepseek-flash(现在用的):1 次调用 | 输入 26 / 输出 21 tokens | 约 ¥0.0002
  被中断的(估算):1 次调用 | 输入 56 / 输出 108 tokens | 约 ¥0.0010
合计约 ¥0.0012

你:
再见。本次运行累计约 ¥0.0012
```

和 Day 152 对比:那天账单是「2 次调用,约 ¥0.0004」,把被打断的那次当作没发生。今天多了一行「被中断的(估算)」:输入约 56、输出约 108 token,约 ¥0.0010。合计 ¥0.0012 里,被打断的那一次占了大头,它只回答了不到一半,却比前面完整的一轮贵 4 倍多。这也说明了为什么要估:长回答被打断一次的花费,比十几个短问答还多。

这里估输入是 56:`sent` 里有 system(30 个汉字左右)、「我叫小林」、上一轮的回答、新问题,一共四条消息的文字;和服务端对上一轮「输入 26」比,56 个看上去合理。

### 零件和大代码的对照

| 零件 | 在 `chatbot.py` 的哪里 | 首次出现 |
| --- | --- | --- |
| `client.last` 的字段(ttft、token、cost) | `turn_line()` | 今天第一步 |
| 每个客户端自带 `ledger` | `show_cost()`、`total_cost()` | 今天第二步 |
| 保管旧账本的列表 | `self.retired` | 今天第二步 |
| `dotenv_values` 检查配置文件 | `switch_env()` 前半 | 今天第三步 |
| 先建临时 `new_client` 再替换 | `switch_env()` 后半 | 今天第三步 |
| 字数换 token 的估算 | `record_aborted()` | 今天第四步 |
| 用 `Ledger` 记估算账 | `self.aborted` | 今天第四步 |
| 流式回答时攒已收到的片段 | `ask()` 里的 `parts` | 今天第五步 |

## 动手练习

三道题加起来调 DeepSeek 和硅基流动约 12 次,不到 ¥0.05。

**练习 1:加 `/think on|off`。** 用子类的办法(像 Day 152 练习那样),不改 `chatbot.py`。DeepSeek 的思考模式靠请求里的 `thinking` 参数控制,`LLMClient` 在 `client.extra_body` 里存着它。命令效果:`/think on` 打开,`/think off` 关闭,其他参数提示用法。然后问一道算术题,对比开关前后成本行里「输出」token 和钱的变化。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/ex154_think.py
from part02.chatbot import ChatBot


class ThinkBot(ChatBot):
    """加 /think on|off:开关思考模式。思考的 token 按输出价收费,每轮那一行能直接看到。"""

    def handle_command(self, line: str) -> bool:
        cmd, _, arg = line.partition(" ")
        if cmd != "/think":
            return super().handle_command(line)
        if arg.strip() not in ("on", "off"):
            print("用法:/think on 或 /think off")
            return True
        kind = "enabled" if arg.strip() == "on" else "disabled"
        self.client.extra_body["thinking"] = {"type": kind}
        print(f"思考模式 {arg.strip()}(只对现在这个厂商生效,/env 切走再切回来会重置)")
        return True


if __name__ == "__main__":
    ThinkBot(None).run()
```

<div class="line-notes">

- `class ThinkBot(ChatBot):` 继承 `ChatBot`,只覆盖 `handle_command`。
- `cmd, _, arg = line.partition(" ")` 和父类一样拆命令。
- `if cmd != "/think":` 不是自己的命令就交还给父类。
- `return super().handle_command(line)` `/env`、`/cost`、`/quit` 都走这里,所以今天的功能在子类里照常用。
- `if arg.strip() not in ("on", "off"):` 元组里放两个合法值,`not in` 判断不在里面。
- `kind = "enabled" if arg.strip() == "on" else "disabled"` 三元表达式,`/think on` 得到 `"enabled"`。
- `self.client.extra_body["thinking"] = {"type": kind}` 直接改客户端的 `extra_body`,之后每次请求都带着。启动时它是 `{'thinking': {'type': 'disabled'}}`,从 `.env` 的 `LLM_EXTRA_BODY` 来。
- `return True` 命令处理完继续聊。
- `ThinkBot(None).run()` `None` 表示用默认 `.env`。

</div>

```bash
printf '一份年付 468 元的套餐,含 13%% 税,不含税价是多少?只给数字\n/think on\n一份年付 468 元的套餐,含 13%% 税,不含税价是多少?只给数字\n再算一遍税额\n/think off\n/cost\n/quit\n' | uv run python -m part02.ex154_think
```

(`printf` 里的 `%%` 才会输出一个 `%`。)我的输出:

```text
已连接 deepseek-flash。输入 /help 查看命令。

你:助手:414.16
  [deepseek-flash | 首字 0.87s | 输入 48(缓存 0) | 输出 3 | ¥0.00012 | 累计 ¥0.0001]

你:思考模式 on(只对现在这个厂商生效,/env 切走再切回来会重置)

你:助手:414.16
  [deepseek-flash | 首字 0.79s | 输入 104(缓存 0) | 输出 54 | ¥0.00064 | 累计 ¥0.0008]

你:助手:53.84
  [deepseek-flash | 首字 1.12s | 输入 115(缓存 0) | 输出 91 | ¥0.00096 | 累计 ¥0.0017]

你:思考模式 off(只对现在这个厂商生效,/env 切走再切回来会重置)

你:  .env deepseek-flash(现在用的):3 次调用 | 输入 267 / 输出 148 tokens | 约 ¥0.0017
合计约 ¥0.0017

你:
再见。本次运行累计约 ¥0.0017
```

同一道题答案都是 414.16,不开思考输出 3 个 token、¥0.00012,开了思考输出 54 个、¥0.00064,贵了 5 倍多,多出来的 51 个 token 是思考过程,按输出价收钱,[Day 124](/blog/agent-zero/day-124-cost/) 说过。第三轮「再算一遍税额」输出 91,¥0.00096,因为它这次把历史和新问题都想了一遍。输入也在涨:48、104、115,每一轮都带着前面的历史,这就是 Day 131 的平方级增长。

最后一行 `/think off` 说明了「只对现在这个厂商生效」:它改的是 `self.client.extra_body`,`/env` 换了新客户端以后,这个设置就回到配置文件里的值。想让它跨 `/env` 保留,要把状态存在 `ChatBot` 上,在 `switch_env()` 后面重新套一遍,这留给你。

</details>

**练习 2:给今天的纯函数写测试。** 不联网。测 `estimate_tokens`、`estimate_cost`、`turn_line`、`missing_keys` 和 `total_cost()`。`total_cost()` 要用到 `ChatBot`,但不想真的请求,怎么办?提示:`LLMClient` 建对象时不发请求,给它一个假的配置文件就行。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/tests/test_chatbot_cost.py
from pathlib import Path

import pytest

from common.llm import ChatResult, Ledger, Price
from part02.chatbot import ChatBot, turn_line
from part02.cost_estimate import estimate_cost, estimate_tokens
from part02.envcheck import missing_keys

FAKE_ENV = """LLM_BASE_URL=https://example.invalid/v1
LLM_API_KEY=sk-fake
LLM_MODEL=fake-model
LLM_PRICE=0.04,2,8
"""


def make_result(ttft: float | None) -> ChatResult:
    return ChatResult(
        content="好",
        reasoning=None,
        finish_reason="stop",
        message={"role": "assistant", "content": "好"},
        prompt_tokens=27,
        completion_tokens=40,
        cache_hit_tokens=0,
        cost=0.000374,
        ttft=ttft,
    )


def test_estimate_tokens_by_class() -> None:
    assert estimate_tokens("") == 0
    assert estimate_tokens("发" * 20) == 13  # 20 × 0.65
    assert estimate_tokens("，" * 10) == 9  # 10 × 0.9
    assert estimate_tokens("a" * 20) == 6  # 20 × 0.3


def test_estimate_cost_matches_hand_calc() -> None:
    price = Price(0.04, 2.0, 8.0)
    p, c, cost = estimate_cost(price, "发" * 20, "好" * 100)
    assert (p, c) == (13, 65)
    assert cost == pytest.approx((13 * 2 + 65 * 8) / 1_000_000)


def test_turn_line_formats_numbers() -> None:
    line = turn_line("deepseek-flash", make_result(0.5029), 0.0012)
    assert line == "  [deepseek-flash | 首字 0.50s | 输入 27(缓存 0) | 输出 40 | ¥0.00037 | 累计 ¥0.0012]"


def test_turn_line_without_ttft() -> None:
    assert "首字 -" in turn_line("m", make_result(None), 0.0)


def test_missing_keys(tmp_path: Path) -> None:
    f = tmp_path / ".env.x"
    f.write_text(FAKE_ENV.replace("LLM_PRICE=0.04,2,8\n", ""), encoding="utf-8")
    assert missing_keys(str(f)) == ["LLM_PRICE"]
    with pytest.raises(FileNotFoundError):
        missing_keys(str(tmp_path / "nope"))


def test_total_cost_adds_three_parts(tmp_path: Path) -> None:
    f = tmp_path / ".env.fake"
    f.write_text(FAKE_ENV, encoding="utf-8")
    bot = ChatBot(str(f))
    bot.retired.append((".env.old", "old-model", Ledger(calls=1, cost=0.001)))
    bot.client.ledger.cost = 0.002
    bot.aborted.cost = 0.0005
    assert bot.total_cost() == pytest.approx(0.0035)
```

<div class="line-notes">

- `from common.llm import ChatResult, Ledger, Price` 测试要手工造这三种对象,所以都导入。
- `FAKE_ENV = """LLM_BASE_URL=https://example.invalid/v1` 假配置。`example.invalid` 是专门保留的、保证解析不出来的域名,万一哪里误发了请求也只会连接失败,不会花钱。
- `def make_result(ttft: float | None) -> ChatResult:` 造一个 `ChatResult`,字段值就是第一步实跑的数:27 输入、40 输出、`cost=0.000374`。`ttft` 作为参数,两个测试各传不同的值。
- `assert estimate_tokens("发" * 20) == 13  # 20 × 0.65` `"发" * 20` 是把字符串重复 20 次。20 × 0.65 = 13.0,`round` 后是 13。
- `assert estimate_tokens("，" * 10) == 9  # 10 × 0.9` 全角逗号 10 个,10 × 0.9 = 9。
- `assert estimate_tokens("a" * 20) == 6  # 20 × 0.3` 20 个字母按 0.3 得 6。
- `p, c, cost = estimate_cost(price, "发" * 20, "好" * 100)` 输入 20 个汉字估 13,输出 100 个汉字估 65。
- `assert cost == pytest.approx((13 * 2 + 65 * 8) / 1_000_000)` 浮点数不能用 `==` 直接比,`pytest.approx` 允许一点点误差。期望值是 (26 + 520) ÷ 1,000,000 = 0.000546。
- `assert line == "  [deepseek-flash | 首字 0.50s | 输入 27(缓存 0)` `0.5029` 被 `.2f` 格式化成 `0.50`,`0.000374` 被 `.5f` 格式化成 `0.00037`,`0.0012` 被 `.4f` 格式化成 `0.0012`。
- `assert "首字 -" in turn_line("m", make_result(None), 0.0)` `ttft` 为 `None` 时显示一个减号。
- `f.write_text(FAKE_ENV.replace("LLM_PRICE=0.04,2,8\n", ""), encoding="utf-8")` 把价格那行删掉再写进临时文件,`tmp_path` 是 pytest 给每个测试的空目录。
- `with pytest.raises(FileNotFoundError):` 断言里面那行必须抛这个异常,没抛就算测试失败。
- `bot = ChatBot(str(f))` 用假配置建一个真的 `ChatBot`,不发任何请求。`load_dotenv(override=True)` 会把假值写进当前进程的环境变量,这个文件里只有这一个测试会建 `ChatBot`,所以不会影响别的测试;如果多个测试都建,要用 `monkeypatch` 隔离。
- `bot.retired.append((".env.old", "old-model", Ledger(calls=1, cost=0.001)))` 手工塞一本旧账。
- `bot.client.ledger.cost = 0.002` 现在客户端的账直接赋值。
- `assert bot.total_cost() == pytest.approx(0.0035)` 0.001 + 0.002 + 0.0005 = 0.0035。

</div>

```bash
uv run pytest -q
```

输出:

```text
......                                                                   [100%]
6 passed in 1.53s
```

六个测试全过,全程不联网,0.1 秒级别就能跑完,改了估算系数或者成本行的格式,马上知道有没有弄坏。

</details>

**练习 3:切走再切回来,缓存还在吗?** 缓存在服务端,不在我们的程序里,所以切到别家再切回来,DeepSeek 那边的缓存应该还在。验证它:写一个子类,把 system 换成一段约 2000 token 的长文字(缓存要前缀够长才命中,[Day 124](/blog/agent-zero/day-124-cost/) 的实验用过 2615 token),然后依次:问一次、再问一次、`/env .env.sf` 问一次、`/env .env` 再问一次,看每轮成本行里的「缓存」数。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/ex154_cache.py
from common.llm import Conversation
from part02.chatbot import DEFAULT_SYSTEM, ChatBot

# 造一段约 1500 token 的 system:前缀够长、每次一模一样,缓存才有机会命中
RULES = [f"第 {i} 条规则:回答客户关于第 {i} 类账单问题时,先确认客户编号,再说明处理时限为 {i % 5 + 1} 个工作日。" for i in range(1, 61)]
LONG_SYSTEM = DEFAULT_SYSTEM + "\n" + "\n".join(RULES)


class CacheBot(ChatBot):
    def __init__(self, env_file: str | None) -> None:
        super().__init__(env_file)
        self.conv = Conversation(LONG_SYSTEM, max_turns=10)


if __name__ == "__main__":
    CacheBot(None).run()
```

<div class="line-notes">

- `RULES = [f"第 {i} 条规则:` 列表推导式生成 60 句规则。`i % 5 + 1` 取余数再加 1,让处理时限在 1 到 5 天里循环,这样每句话不完全一样。`range(1, 61)` 是 1 到 60。
- `LONG_SYSTEM = DEFAULT_SYSTEM + "\n" + "\n".join(RULES)` 原来的人设放最前面,后面接 60 行规则。实测整段约 2000 个输入 token。
- `class CacheBot(ChatBot):` 只改构造函数。
- `super().__init__(env_file)` 先让父类把 `client`、`retired` 等都建好。
- `self.conv = Conversation(LONG_SYSTEM, max_turns=10)` 再把对话换成带长 system 的。

</div>

```bash
printf '你好,一个字回答\n再问一次,一个字回答\n/env .env.sf\n第三次,一个字回答\n/env .env\n第四次,一个字回答\n/quit\n' | uv run python -m part02.ex154_cache
```

我的输出:

```text
已连接 deepseek-flash。输入 /help 查看命令。

你:助手:好
  [deepseek-flash | 首字 0.74s | 输入 2068(缓存 0) | 输出 1 | ¥0.00414 | 累计 ¥0.0041]

你:助手:好
  [deepseek-flash | 首字 0.60s | 输入 2079(缓存 1920) | 输出 1 | ¥0.00040 | 累计 ¥0.0045]

你:已切换到 deepseek-ai/DeepSeek-V4-Flash(.env.sf),历史 2 轮保留

你:助手:好
  [deepseek-ai/DeepSeek-V4-Flash | 首字 0.81s | 输入 2087(缓存 0) | 输出 1 | ¥0.00627 | 累计 ¥0.0108]

你:已切换到 deepseek-flash(.env),历史 3 轮保留

你:助手:好
  [deepseek-flash | 首字 1.01s | 输入 2097(缓存 1920) | 输出 1 | ¥0.00040 | 累计 ¥0.0113]
```

(最后的 `再见` 行略。)四行成本行讲了三件事。第一,第二问缓存命中 1920 个 token,这一轮从 ¥0.00414 降到 ¥0.00040,便宜了 10 倍,手算:1920 × 0.04 + 159 × 2 + 1 × 8 = 402.8,除以一百万是 0.0004028。1920 恰好是 128 的 15 倍,DeepSeek 的缓存按 128 token 的整块命中。第二,切到硅基流动,缓存数是 0:每家的缓存互不相通,而且它的价格是 3 元,这一轮 ¥0.00627,比 DeepSeek 没命中缓存的那轮还贵 50%。第三,切回 DeepSeek,又命中了 1920,缓存还在。

所以「换厂商」有隐性成本:换走的那一轮,长前缀要重新按全价算;换回来如果隔得太久,缓存也会过期(厂商一般只保证尽力保留几分钟到几小时,具体看各家文档)。聊天机器人里偶尔换着玩无所谓,生产环境里按请求随机路由到不同厂商,会把缓存白白打碎。

</details>

**验收标准:** 能说出成本行里每个数从哪个字段来,并手算一轮的钱;能解释为什么切换时 `LLMClient(path)` 要放在检查之后,而且为什么 `retired.append` 放在新建成功之后;能复现「缺 `LLM_PRICE` 的配置文件被拒绝」;能说出估算被打断花费的三个系数从哪来、什么情况下不准;6 个测试全过。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 首字延迟 / TTFT | Time To First Token,从发请求到收到第一段正文的秒数,流式回答里用户感觉到的「它有没有反应」 |
| 账本(`Ledger`) | 记调用次数、输入输出 token 和花费的小对象,`LLMClient` 每次调用都往自己的账本里加一笔 |
| 配置串味 | 新建客户端时,配置文件里缺的变量悄悄沿用了上一个文件留在环境变量里的值,不报错但用错了价格或模型名 |
| `load_dotenv(override=True)` | 把配置文件的变量写进环境变量,同名的覆盖,文件里没有的不动 |
| `dotenv_values` | python-dotenv 的函数,只把配置文件读成字典,不修改环境变量,适合「先检查再决定用不用」 |
| 估算 | 拿不到真实数据时按经验系数推算。今天用字数换 token,只当量级参考,不当账单 |
| 全角标点 | 占一个汉字宽度的标点(，。、「」),和半角的 `,` `.` 不同,token 数也不同 |
| `subprocess.Popen` | 启动子进程并保持联系,可以往它的输入写、从它的输出读,相当于 Node 的 `child_process.spawn` |
| 高峰价 | DeepSeek 在工作日白天按完整价收费,其他时段半价;配置里写高峰价,成本行是上限估计 |

## 常见误区

**切换厂商直接 `LLMClient(新文件)` 就完事。** 文件里缺一个变量,上一家的值就悄悄留下来。价格用错不报错(实测少算了 14%),模型名用错才报 400。先用 `dotenv_values` 检查文件,再新建客户端。

**新建客户端失败了还把旧的账本收走。** 顺序错了会留下半截状态:先 `retired.append`、后 `LLMClient(path)` 抛了异常,`self.client` 还是旧的,账本却被重复收了一遍。正确顺序是先建 `new_client`,成功了才收旧账、换新的。

**以为 `/think off` 切了厂商还生效。** `extra_body` 是客户端上的设置,换客户端就回到配置文件里的值。

**把成本行当账单。** 配置里写的是高峰价,空闲时段实际只收一半;估算的被打断调用只是量级;缓存命中数不是每次都有。对账以控制台为准。

**中断了的调用当作没花钱。** Day 152 那天就是这样。服务端已经在生成,哪怕只收到一半。长回答被打断一次,花的钱可能比十个短问答还多。

**用估算的 token 数做精确判断。** 比如拿它判断「是否超出上下文窗口」。估算中文偏低 10% 左右,英文和代码偏差更大,要判断窗口别用估算,用服务端返回的 `prompt_tokens`。

**以为缓存跟着程序走。** 缓存在服务端,按厂商分开。程序里 `/env` 切走再切回,DeepSeek 那边的缓存还在(练习 3 实测),但换到另一家那一轮要全价。

**在测试里到处建 `ChatBot`。** `LLMClient` 建对象时会 `load_dotenv(override=True)` 改全进程的环境变量,多个测试之间会互相影响,要用 `monkeypatch` 隔离。

## 学习资料

### 文档与文章

- [DeepSeek 文档:模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):中文,今天成本行里的单价出处。看高峰和空闲时段的划法,以及缓存命中价。
- [python-dotenv 文档(README)](https://github.com/theskumar/python-dotenv):英文,README 里有 `dotenv_values` 和 `load_dotenv(override=...)` 的区别,第三步的出处。
- [Python 文档:subprocess](https://docs.python.org/zh-cn/3.12/library/subprocess.html):中文,看 `Popen` 和 `PIPE` 两节,够读懂 `interrupt_driver.py`。
- [Python 文档:signal](https://docs.python.org/zh-cn/3.12/library/signal.html):中文,里面写了默认情况下 Python 把 SIGINT 变成 `KeyboardInterrupt`。
- [Python 文档:time](https://docs.python.org/zh-cn/3.12/library/time.html):中文,`perf_counter()` 一节,`LLMClient` 测首字延迟用的就是它。
- [DeepSeek 文档:查询余额](https://api-docs.deepseek.com/zh-cn/api/get-user-balance):中文,想对账可以用它在一次实验前后各查一次余额,不过余额只显示到分,量不出一次调用的几厘钱。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1uw3M6PE4Z&autoplay=0&high_quality=1" title="输入输出命中缓存，一次讲透AI计费" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>K森动画 · 输入输出命中缓存,一次讲透AI计费 · 4 分 37 秒。把输入、输出、缓存命中三种 token 怎么收费讲了一遍,正好对应今天成本行里的三个数。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1yqnq6NEAp&autoplay=0&high_quality=1" title="为什么调用大模型时，输出token要比输入token贵3-5倍？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IT周瑜 · 为什么调用大模型时,输出token要比输入token贵3-5倍? · 2 分 55 秒。短,讲输出为什么贵,和练习 1 里「开了思考输出多了 51 个 token,钱贵五倍」是同一个原因。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/pffDIMrcknI" title="What Is Prompt Caching and How Does It Reduce LLM Costs? | GenAI Interview Prep" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Chirag Patil · What Is Prompt Caching and How Does It Reduce LLM Costs? · 英文。讲前缀缓存为什么便宜、什么样的请求能命中,配合练习 3 看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/2Fp1N6dof0Y" title="Python Tutorial: Calling External Commands Using the Subprocess Module" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Tutorial: Calling External Commands Using the Subprocess Module · 英文。想弄懂 `interrupt_driver.py` 里 `Popen`、管道和读写输出,看这个。</figcaption>
</figure>

### 书籍

- 今天这组不需要。成本和缓存的细节看上面的价格页就够,Day 155 会推荐第二部分相关的书。

### 开源项目与代码

- [BerriAI/litellm](https://github.com/BerriAI/litellm):一个把一百多家模型厂商统一成 OpenAI 格式的库,带按调用统计花费的功能。看它怎么存每家的价格表,对照我们的 `LLM_PRICE`。
- [simonw/llm](https://github.com/simonw/llm):Day 152 提过的命令行工具,`llm logs` 能看每次调用的 token 用量,可以对照今天的成本行。

## 自测

1. 成本行里的「¥0.00037」是怎么算出来的?它为什么不能当账单?

<details><summary>答案</summary>

用 `LLMClient` 按配置里的 `LLM_PRICE` 算:(命中 × 命中价 + 未命中 × 未命中价 + 输出 × 输出价) ÷ 1,000,000。那一轮输入 27、输出 40:(27 × 2 + 40 × 8) ÷ 1,000,000 = 0.000374,显示成五位小数是 0.00037。配置里写的是高峰价,DeepSeek 空闲时段只收一半,所以是上限估计;而且显示时舍入过。对账以厂商控制台为准。

</details>

2. 为什么 `/env` 切换要新建一个 `LLMClient`,而不是改现有客户端的配置?旧客户端的账本为什么要保管起来?

<details><summary>答案</summary>

`LLMClient` 是共享模块,它的 `base_url`、`price`、`model`、`ledger` 是建对象时定下来的一套,新建一个最省事也最不容易漏改某一项。账本属于客户端,换客户端账本就归零了;不收起来的话,切换前花的钱就从累计里消失了。放进 `retired` 列表后,`total_cost()` 把切走的、现在的、被打断的三份相加,`/cost` 还能按厂商分开列。

</details>

3. 「配置串味」是什么?为什么 `try: LLMClient(path) except KeyError` 防不住它?怎么防?

<details><summary>答案</summary>

配置文件缺了某个变量时,`load_dotenv(override=True)` 不会清除环境里的旧值,新客户端悄悄用了上一个文件留下的价格或模型名。`LLMClient` 读的是 `os.environ["LLM_MODEL"]`,环境里有旧值,取得到,所以不会抛 `KeyError`。防法:新建客户端之前,用 `dotenv_values(path)` 单独解析文件(不碰环境变量),检查必填变量是否齐全,缺了就拒绝切换。

</details>

4. 被 Ctrl+C 打断的调用,为什么只能估算?估算时输入输出分别怎么估?偏差在哪个方向?

<details><summary>答案</summary>

`usage` 在流的最后一块里,被打断时没收到,服务端实际数的 token 数我们拿不到。输入用发出去的所有消息的文字按系数估(汉字 0.65、全角标点 0.9、其他 0.3 个 token),输出用已经收到的那一截估。输入按未命中价算,命中缓存时实际更便宜,偏高;输出只算收到的,服务端可能多生成了一些,偏低。中文偏差在一成左右,英文和代码会差得更多。

</details>

5. 面试题:「你的聊天机器人要接多家模型厂商,怎么统计每家的花费,怎么避免算错?」

<details><summary>答案</summary>

每次调用从响应的 `usage` 里读命中、未命中和输出的 token 数,乘以该厂商该模型的单价得到花费,单价放配置文件里不写死在代码里,因为各家价格和计价维度不同(有的有缓存价,有的按时段浮动)。账本按客户端或按「厂商加模型」分开记,汇总时再相加,这样既能看总数也能看每家占多少。避免算错有几处:切换配置前先校验必填项齐全(不然价格和模型名会悄悄沿用上一家的),价格带上查证日期,成本行标明是估算还是对账用;流式调用被打断拿不到 `usage` 时单独记一本估算账,并和真实账区分开显示;最后定期拿厂商控制台的账单和本地累计对一次,差距大就查哪里漏记了。

</details>

## 明天预告

Day 155 · 小项目(三):保存对话、知识地图和面试题。今天的聊天机器人退出就忘,明天加 `/save` 和 `/load` 把对话存成 JSON 文件下次接着聊,顺手加 `/system` 改系统提示词。存文件会碰到两件事:文件名里带 `../` 会不会写出目录之外,以及手改坏的文件读回来怎么办。然后把第二部分(Day 106–155)整个过一遍,画一张知识地图,整理一份面试题。
