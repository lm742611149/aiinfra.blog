---
title: 'Day 178 · 推理预算:thinking 档位怎么调、怎么算钱'
description: 'DeepSeek 的思考开关和 reasoning_effort 档位怎么传、几种参数组合到底开没开思考;思考 token 藏在账单的哪个字段、怎么换算成人民币;再用一套云簿计费题实测关思考、low、medium、high、max 五种配置的准确率、token、耗时和花费。'
pubDate: 2026-10-22
regime: none
tags: ['reasoning', 'thinking', 'cost', 'agent-zero']
series: 'agent-zero'
day: 178
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 177](/blog/agent-zero/day-177-todo-reflection/) 给 Agent 加了一个待办清单工具,又让它做完之后回头检查一遍。那一课的结论是:显式规划和反思不是越多越好,任务步骤多、容易漏的时候才值得加。

今天换一个角度问同一个问题。规划和检查是我们在代码里让模型「多想」;推理模型则是在模型内部「多想」,而且有个旋钮能调它想多少。[Day 115](/blog/agent-zero/day-115-reasoning-models/) 讲过思考模式是什么,[Day 175](/blog/agent-zero/day-175-react-3/) 讲过 ReAct 的 Thought 搬进了推理模型的思维链。剩下一个很实际的问题一直没答:这个旋钮拧到几档?拧一档要多花多少钱?

## 今天要解决的问题

学完你应该能:

1. 在 DeepSeek 上用 `thinking` 开关和 `reasoning_effort` 档位控制思考,说清 `medium` 为什么等于 `high`、写错档位名会收到什么报错。
2. 从响应的 `usage` 里找到思考 token(`reasoning_tokens`),按单价把一次请求换算成人民币,手算和程序算的对得上。
3. 用一套带标准答案的题目,量出五种思考配置的准确率、token、耗时和花费,并据此选档。

预计用时 2.5 小时。前置:[Day 115](/blog/agent-zero/day-115-reasoning-models/)(思考模式是什么)、[Day 124](/blog/agent-zero/day-124-cost/)(从 usage 算钱)、[Day 135](/blog/agent-zero/day-135-llm-client-1/) 到 [Day 137](/blog/agent-zero/day-137-llm-client-3/)(`common/llm.py` 里的 `LLMClient`)。今天的代码放在 `agent-zero-lab/part03/`,所有命令都在 `agent-zero-lab/` 根目录下跑。全部实验跑一遍,按高峰价算大约一块钱。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `effort_sweep.py` 的 `run_config` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 旋钮长什么样

先说清楚今天的「预算」指什么。模型开了思考,会先写一段你通常看不到的推理过程,再写正文。这段推理过程也是一个个 token 生成出来的,写得越长,花的时间和钱越多。**推理预算**就是你允许它在这段推理上花多少。不同厂商给的控制方式不一样:有的给档位(低、中、高),有的直接给一个 token 上限。

课程默认用 DeepSeek,我 2026 年 10 月 22 日查了它的[思考模式文档](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode),要点是两个参数:

| 参数 | 写法(OpenAI SDK) | 取值 | 默认 |
| --- | --- | --- | --- |
| 思考开关 | `extra_body={"thinking": {"type": "enabled"}}` 或 `"disabled"` | 开 / 关 | 开 |
| 思考强度 | `reasoning_effort="low"` | 文档写的是 `low` / `high` / `max` | `high` |

`thinking` 不是 OpenAI 标准参数,所以要塞进 `extra_body`。`extra_body` 你在 [Day 123](/blog/agent-zero/day-123-openai-compatible/) 见过:SDK 不认识的字段放在这里,它原样拼进请求体发出去。`reasoning_effort` 是 OpenAI SDK 自带的关键字参数,直接传就行,相当于 JS 里 `fetch` 的 body 多一个字段,不用做任何特殊处理。

文档里还有一张映射表:你传的档位会被换成它真正支持的三档之一。

| 你传 | 实际按 |
| --- | --- |
| `minimal`、`low` | `low` |
| `medium`、`high`、`xhigh` | `high` |
| `max`、`ultra` | `max` |

这张表很重要。它意味着同一份代码从 OpenAI 切到 DeepSeek 不会报错,但你以为的 `medium` 在 DeepSeek 上其实是 `high`。后面的实验会专门放一档 `medium` 看看。

其他几家我也查了一遍,今天只读不跑,写代码前再去看一眼原文(参数名变得很快):

| 厂商 | 档位参数 | 思考内容在哪 | 和 DeepSeek 不一样的地方 |
| --- | --- | --- | --- |
| Claude | `output_config.effort`:`low` / `medium` / `high` / `xhigh` / `max` | content 里的 `thinking` 块 | effort 管的是整个回答的 token,不只是思考;是行为信号,不是硬上限 |
| OpenAI(Responses API) | `reasoning.effort`,支持哪几档看模型 | 默认不返回原文,只给 `reasoning_tokens` 数量 | 思考内容你看不到,但照样按输出计费 |
| 通义(百炼) | `thinking_budget`:一个 token 数 | `reasoning_content` | 最接近字面意义的「预算」,想到这么多就停下写答案 |

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="一次开思考的请求,token 怎么分">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="28" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">一次请求的 usage(开思考 high,实测)</text>
  <rect x="20" y="50" width="60" height="44" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="50" y="70" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">输入</text>
  <text x="50" y="86" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">326</text>
  <rect x="90" y="50" width="490" height="44" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="335" y="70" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">思考 reasoning_tokens 1456</text>
  <text x="335" y="86" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">用户看不到,按输出单价收钱</text>
  <rect x="580" y="50" width="40" height="44" fill="var(--paper)" stroke="var(--mem)"/>
  <text x="600" y="76" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">正文</text>
  <line x1="90" y1="108" x2="620" y2="108" stroke="var(--rule)"/>
  <text x="355" y="126" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">completion_tokens 1465 = 思考 1456 + 正文 9</text>
  <text x="20" y="160" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">花费 = 命中 128×0.04 + 未命中 198×2 + 输出 1465×8  (元/百万 token)</text>
  <text x="20" y="182" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">     = 12121 ÷ 1,000,000 ≈ ¥0.0121</text>
  <text x="20" y="210" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">同一道题关思考:输出 458,花费 ¥0.0040。差的几乎全是那一大块蓝色</text>
</svg>
<figcaption>思考 token 算在 completion_tokens 里,单价和正文一样。图上的数字来自下一节 think_once.py 的第二次实跑:正文只有 9 个 token,思考有 1456 个。</figcaption>
</figure>

## 第一步:同一道题问两次,看账单

先用一道题看清楚思考 token 在哪。`common/llm.py` 的 `ChatResult` 里已经有 `prompt_tokens`、`completion_tokens`、`cache_hit_tokens`,但没有「其中多少是思考」。先给它补一个字段。这是今天唯一一处改 `common/llm.py` 的地方,改三处:

```python
# agent-zero-lab/common/llm.py  (只列出改动的三处,其余不动)
@dataclass
class ChatResult:
    content: str
    reasoning: str | None
    finish_reason: str | None
    message: dict[str, Any]
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cache_hit_tokens: int = 0
    reasoning_tokens: int = 0  # Day 178 新增:输出里有多少是思考
    cost: float = 0.0  # 元
    latency: float = 0.0
    ttft: float | None = None

# ↓ 放在 LLMClient 类里,_cache_hit 的下面
    @staticmethod
    def _reasoning_tokens(usage: Any) -> int:
        # 关思考时 completion_tokens_details 是 None
        details = getattr(usage, "completion_tokens_details", None)
        return (getattr(details, "reasoning_tokens", None) or 0) if details else 0

# ↓ chat() 里构造 ChatResult 的地方,加一行
            cache_hit_tokens=hit,
            reasoning_tokens=self._reasoning_tokens(u),
            cost=self._cost(u.prompt_tokens, u.completion_tokens, hit) if u else 0.0,
```

<div class="line-notes">

- `reasoning_tokens: int = 0  # Day 178 新增` dataclass 字段带默认值 0,所以 `stream()` 里构造 `ChatResult` 的地方不传它也不会报错。这和 TS 里给 interface 字段加 `?` 再给默认值是一个意思。
- `def _reasoning_tokens(usage: Any) -> int:` 写成静态方法,和 Day 136 的 `_cache_hit` 并排放,因为它们干的是同一类事:从 usage 里抠一个厂商字段。
- `details = getattr(usage, "completion_tokens_details", None)` 我实测的响应里,开思考时 `usage.completion_tokens_details` 是一个对象,里面 `reasoning_tokens` 是 28(问的是「17 乘 23」);关思考时整个 `completion_tokens_details` 是 `None`。第一次我直接写了 `usage.completion_tokens_details.reasoning_tokens`,关思考那次立刻报 `AttributeError: 'NoneType' object has no attribute 'reasoning_tokens'`。
- `return (getattr(details, "reasoning_tokens", None) or 0) if details else 0` 两层兜底:没有 details 返回 0;有 details 但字段是 `None` 也返回 0。`x or 0` 相当于 JS 的 `x ?? 0`(严格说更像 `x || 0`,因为 Python 的 `or` 把 0 和 None 都当假)。
- `reasoning_tokens=self._reasoning_tokens(u),` 在 `chat()` 里把它填进结果。`cost` 那一行不用改:思考 token 本来就在 `completion_tokens` 里,按输出单价算,已经算进去了。

</div>

改完用 basedpyright 检查一下,`uv run basedpyright common/llm.py` 应该是 `0 errors`。然后写第一个脚本。题目用的是下一节 `billing_quiz.py` 里的一道难题,先别管它长什么样,知道标准答案是 1500.17 就行(下一节会把题库整个敲出来,你可以先敲那个文件再回来跑这个)。

```python
# agent-zero-lab/part03/think_once.py  同一道题,关思考和开思考各问一次,看账单差在哪
from common.llm import LLMClient
from part03.billing_quiz import QUIZ_HARD, RULES

question, gold = QUIZ_HARD[4]  # 折扣年付 10 月 8 日申请退款,标准答案 1500.17
msgs = [
    {"role": "system", "content": RULES + "\n最后一行只写「答案:金额」。"},
    {"role": "user", "content": question},
]

llm = LLMClient()
off = llm.chat(msgs)  # .env 里 LLM_EXTRA_BODY 默认关思考
on = llm.chat(msgs, extra_body={"thinking": {"type": "enabled"}}, reasoning_effort="high")

for name, r in [("关思考", off), ("开思考 high", on)]:
    print(f"== {name}")
    print("  输入", r.prompt_tokens, "(缓存命中", r.cache_hit_tokens, ") | 输出", r.completion_tokens, "| 其中思考", r.reasoning_tokens)
    print("  思考内容", len(r.reasoning or ""), "字 | 正文", len(r.content), "字")
    print("  最后一行:", r.content.strip().splitlines()[-1])
    print(f"  花费 ¥{r.cost:.5f}  耗时 {r.latency:.1f}s")
print("标准答案", gold, "| 两次合计", llm.ledger)
```

<div class="line-notes">

- `from part03.billing_quiz import QUIZ_HARD, RULES` 从下一节的题库文件里拿题和规则。`part03` 目录下要有空的 `__init__.py`,这样才能用 `part03.xxx` 导入([Day 33](/blog/agent-zero/day-033-packages/) 讲过包)。
- `question, gold = QUIZ_HARD[4]` 列表第 5 个元素(下标从 0 开始),是一个二元组,拆成题目和标准答案两个变量,相当于 JS 的 `const [question, gold] = QUIZ_HARD[4]`。
- `{"role": "system", "content": RULES + "\n最后一行只写「答案:金额」。"},` 规则放进 system,要求最后一行固定格式,方便后面程序判卷。
- `off = llm.chat(msgs)  # .env 里 LLM_EXTRA_BODY 默认关思考` 课程 `.env` 里 `LLM_EXTRA_BODY={"thinking": {"type": "disabled"}}`,不传任何参数就是关着的。
- `on = llm.chat(msgs, extra_body={"thinking": {"type": "enabled"}}, reasoning_effort="high")` 这次传的 `extra_body` 会和 `.env` 里的合并,同名的 `thinking` 以这里为准(Day 136 写 `_kwargs` 时就是这么设计的),所以思考被打开。
- `print("  输入", r.prompt_tokens, "(缓存命中"` 实跑第二次:关思考输入 301、命中 128;开思考输入 326、命中 128。开思考的输入多了 25 个 token,问题和规则一个字没变,多出来的应该是服务端在思考模式下自己加的内容。命中 128 是因为第二次调用和第一次开头一样,DeepSeek 的硬盘缓存(Day 124)接住了前 128 个 token。
- `print("  思考内容", len(r.reasoning or ""), "字 | 正文", len(r.content), "字")` `r.reasoning` 关思考时是 `None`,`or ""` 把它变成空串再取长度。
- `print("  最后一行:", r.content.strip().splitlines()[-1])` `strip()` 去掉首尾空白,`splitlines()` 按行切成列表,`[-1]` 取最后一个,相当于 JS 的 `text.trim().split("\n").at(-1)`。
- `print(f"  花费 ¥{r.cost:.5f}  耗时 {r.latency:.1f}s")` `:.5f` 保留 5 位小数。
- `print("标准答案", gold, "| 两次合计", llm.ledger)` `Ledger` 有 `__str__`,直接 print 就是一行汇总。

</div>

运行 `uv run python -m part03.think_once`。我跑了两次,第二次的输出:

```text
== 关思考
  输入 301 (缓存命中 128 ) | 输出 458 | 其中思考 0
  思考内容 0 字 | 正文 740 字
  最后一行: **答案:1500.17**
  花费 ¥0.00402  耗时 3.1s
== 开思考 high
  输入 326 (缓存命中 128 ) | 输出 1465 | 其中思考 1456
  思考内容 5228 字 | 正文 12 字
  最后一行: 答案:1500.17 元
  花费 ¥0.01212  耗时 7.5s
标准答案 1500.17 | 两次合计 2 次调用 | 输入 627 / 输出 1923 tokens | 约 ¥0.0161
```

第一次跑的时候,关思考输出 791 个 token、正文 1154 个字;开思考输出 1108 个、其中思考 1019 个、正文 128 个字。两次都答对了。

这组数字里有三件事值得停下来看。

**思考 token 就在 `completion_tokens` 里。** 开思考那次输出 1465 个 token,其中 1456 个是思考,正文只有 9 个(12 个字:「答案:1500.17 元」)。用户看到的就是一行字,账单上是一千四百多个输出 token。

**关思考不等于不推理。** 关思考那次正文有 740 个字,它把推导过程直接写进了正文。我们只要求「最后一行只写答案」,没禁止它前面写推导,它就写了。这其实就是 [Day 142](/blog/agent-zero/day-142-prompt-4/) 的「让模型先想再答」:思维链写在正文里,你能看到,也按输出收费。所以「关思考」和「开思考」的差别,在这道题上是推理写在哪、写多长,而不是想不想。

**同一个配置,两次差很多。** 开思考 high 第一次思考 1019 个 token,第二次 1456 个;关思考第一次正文 1154 字,第二次 740 字。评测时只跑一次的数字不可靠,后面的实验每种配置都会跑多道题取平均,难题再多跑几遍。

## 第二步:这些参数组合,到底开没开

文档的映射表看完,我还是想亲手确认几件事:`medium` 会不会报错?`reasoning_effort="none"` 能不能关思考?开关说关、档位说高,听谁的?写错档位名会怎样?下面这个脚本一次试完,问题故意选最简单的,每次几十个 token,五次加起来不到一分钱。

```python
# agent-zero-lab/part03/effort_probe.py  几种参数组合,各自到底开没开思考
from typing import Any

import openai

from common.llm import LLMClient

msgs = [{"role": "user", "content": "17 乘 23 等于几?只写数字。"}]
ON = {"thinking": {"type": "enabled"}}
OFF = {"thinking": {"type": "disabled"}}
cases: list[tuple[str, dict[str, Any]]] = [
    ("开 + low", {"extra_body": ON, "reasoning_effort": "low"}),
    ("开 + medium", {"extra_body": ON, "reasoning_effort": "medium"}),
    ("开 + none", {"extra_body": ON, "reasoning_effort": "none"}),
    ("关 + high", {"extra_body": OFF, "reasoning_effort": "high"}),
    ("开 + extreme", {"extra_body": ON, "reasoning_effort": "extreme"}),
]
llm = LLMClient()
for name, kw in cases:
    try:
        r = llm.chat(msgs, **kw)
        print(f"{name:12} 思考 {r.reasoning_tokens:3} tok | 正文 {r.content!r}")
    except openai.APIStatusError as e:
        print(f"{name:12} 报错 {e.status_code}: {str(e)[:150]}")
```

<div class="line-notes">

- `import openai` 只为了下面 `except` 里用 `openai.APIStatusError`,这是 SDK 里所有「服务端返回了错误状态码」的异常的父类(Day 126 讲错误码时见过它的子类 `AuthenticationError`、`RateLimitError`)。
- `ON = {"thinking": {"type": "enabled"}}` 开关单独存成常量,下面五种组合复用,省得每行都写一长串。
- `cases: list[tuple[str, dict[str, Any]]] = [` 类型标注读法:一个列表,每个元素是「名字 + 参数字典」的二元组。相当于 TS 的 `Array<[string, Record<string, any>]>`。
- `("开 + medium", {"extra_body": ON, "reasoning_effort": "medium"}),` 文档说 medium 会映射成 high,这里看它会不会报错。
- `("开 + none", {"extra_body": ON, "reasoning_effort": "none"}),` 开关说开,档位说 none,看谁赢。
- `("关 + high", {"extra_body": OFF, "reasoning_effort": "high"}),` 反过来:开关说关,档位说 high。
- `("开 + extreme", {"extra_body": ON, "reasoning_effort": "extreme"}),` 故意写一个不存在的档位。
- `r = llm.chat(msgs, **kw)` `**kw` 把字典拆成关键字参数,相当于 JS 里 `chat(msgs, ...kw)` 展开对象([Day 30](/blog/agent-zero/day-030-functions-3/) 讲过)。
- `print(f"{name:12} 思考 {r.reasoning_tokens:3} tok | 正文 {r.content!r}")` `{name:12}` 左对齐占 12 格;`!r` 打印带引号的形式,能看出正文前后有没有多余空格。
- `except openai.APIStatusError as e:` 只接住服务端报错。网络断了之类的别的异常照样往外抛,不吞掉。
- `print(f"{name:12} 报错 {e.status_code}: {str(e)[:150]}")` 报错原文很长,截前 150 个字符。

</div>

运行 `uv run python -m part03.effort_probe`:

```text
开 + low      思考  17 tok | 正文 '391'
开 + medium   思考  24 tok | 正文 '391'
开 + none     思考  15 tok | 正文 '391'
关 + high     思考   0 tok | 正文 '391'
开 + extreme  报错 422: Error code: 422 - {'error': {'message': 'Failed to deserialize the JSON body into the target type: reasoning_effort: unknown variant `extreme`, expect
```

一条一条说。`medium` 不报错,照常思考,和文档的映射表一致。`开 + none` 还是思考了 15 个 token:**开关写了 enabled,档位写 none 关不掉它**。`关 + high` 思考是 0:开关写了 disabled,档位再高也不想。两条合起来就是一句话,**`thinking` 开关说了算**。

`extreme` 被拒,状态码是 422(请求格式对,但内容不合法)。截断的那句后面还有半句,我打印了完整版,原文是 `expected one of none, minimal, low, medium, high, xhigh, ultra, max`。这一句很有用:服务端实际接受的取值比文档表格里多,`none` 也在里面。我另外用裸的 openai 客户端试过不传 `thinking`、只传 `reasoning_effort="none"`,那次思考 token 是空的,也就是说没写开关时 `none` 能关掉思考;但只要你像课程这样在 `.env` 里统一写了开关,就一律以开关为准。

为什么要花一小节确认这些?因为这类参数**写错了不一定报错**。`关 + high` 那种组合,代码看上去开了 high,实际一点没想,你会以为「开了思考也没用」。上线前用一个最便宜的问题把每种组合跑一遍,看 `reasoning_tokens` 是不是你以为的那样,两分钟的事。

## 思考 token 怎么算钱

[Day 124](/blog/agent-zero/day-124-cost/) 的算式不用改,只是要知道思考算在哪一项里。我 2026 年 10 月 22 日查的 [DeepSeek 价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):

| 模型 | 缓存命中输入 | 缓存未命中输入 | 输出 |
| --- | --- | --- | --- |
| `deepseek-flash` | 高峰 0.04 / 空闲 0.02 | 高峰 2 / 空闲 1 | 高峰 8 / 空闲 4 |
| `deepseek-v4-pro` | 高峰 0.30 / 空闲 0.15 | 高峰 9 / 空闲 4.5 | 高峰 27 / 空闲 13.5 |

单位是元每百万 token。高峰时段是北京时间工作日 9:00–12:00 和 14:00–18:00,其余时间(含周末和法定节假日)半价。课程 `.env` 里 `LLM_PRICE=0.04,2,8` 写的是高峰价,所以程序算出来的花费是上限,晚上跑实际只扣一半。

思考 token 按输出单价算。把上面实跑的开思考那次代进去:命中 128 个按 0.04,未命中 326 − 128 = 198 个按 2,输出 1465 个按 8:

128 × 0.04 + 198 × 2 + 1465 × 8 = 5.12 + 396 + 11720 = 12121.12,除以一百万,约 0.01212 元。

和程序打印的 `¥0.01212` 一致。关思考那次是 128 × 0.04 + 173 × 2 + 458 × 8 = 4015.12,约 0.00402 元。这道题开 high 贵了 3 倍。

注意算式里输入那部分几乎可以忽略:输入 326 个 token 只花了 401 个单位,输出花了 11720 个。**思考把钱几乎全花在了输出上**,而输出单价是未命中输入的 4 倍、命中输入的 200 倍。所以控制思考成本,盯的是 `completion_tokens`,不是提示词长度。

放到一天的量上算:一个客服 Agent 每天 2 万次这样的计费问答,关思考每天约 2 万 × 0.004 = 80 元,开 high 约 2 万 × 0.012 = 240 元,一个月差将近五千。这个数够让你上线前认真跑一遍下面的实验。

## 第三步:一套题,五种配置

找一个思考可能有用的任务。云簿 CloudLedger 的计费规则正好合适:升级按天折算、降级下期生效、优惠券先打折后加税、年付退款只退未使用的整月。每条都不难,叠在一起就容易漏。标准答案全部用 Python 按规则算,不手算,判卷交给程序。

```python
# agent-zero-lab/part03/billing_quiz.py
from decimal import ROUND_HALF_UP, Decimal

RULES = """云簿 CloudLedger 计费规则:
1. 月价:基础版 99 元,专业版 299 元,企业版 999 元。按席位计费时,上面是每个席位的月价。年付价 = 月价 × 10。
2. 月中升级(或加席位):立刻生效,补差价 = 月价差 × 剩余天数 ÷ 当月天数,剩余天数包含升级当天。
3. 降级:下个计费周期生效,当期不退款、不补差价。
4. 优惠券打折作用在不含税价上,然后再加 6% 的税。
5. 退款:只有专业版和企业版的年付可以退,退未使用的整月(申请当月不算未使用),退款 = 年付价 ÷ 12 × 未使用整月数,税一并按 6% 退回。基础版年付、所有月付都不退款。
6. 用了优惠券的年付,退款按折后价计算。
7. 只在最后一步四舍五入到分。2026 年 2 月有 28 天。"""


def money(x: float | Decimal) -> float:
    return float(Decimal(str(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


TAX = 1.06
# (问题, 标准答案):答案都用 Python 按上面的规则算出来,不手算
QUIZ: list[tuple[str, float]] = [
    ("客户 2026-03-10 从基础版月付升级到专业版月付,当月要补多少差价(不含税)?", money(200 * 22 / 31)),
    ("客户 2026-02-15 从专业版月付升级到企业版月付,当月补差价含税多少?", money(700 * 14 / 28 * TAX)),
    ("企业版年付,2026-01-01 开始,2026-04-20 申请退款,能退多少(含税)?", money(9990 / 12 * 8 * TAX)),
    ("基础版年付,2026-01-01 开始,2026-06-01 申请退款,能退多少?", 0.0),
    ("专业版月付,用了一张 8 折券,每月含税要付多少?", money(299 * 0.8 * TAX)),
    ("企业版月付客户 2026-03-25 降级到专业版,3 月能退多少?", 0.0),
    ("客户 2026-04-30 从基础版月付升级到企业版月付,当月补差价含税多少?", money(900 * 1 / 30 * TAX)),
    ("专业版月付有 3 个席位,2026-09-11 再加 2 个席位,9 月要补多少(不含税)?", money(2 * 299 * 20 / 30)),
    ("新客户买专业版年付,用一张 85 折券,首年含税要付多少?", money(2990 * 0.85 * TAX)),
    ("专业版年付,2026-01-01 开始,2026-07-15 申请退款,能退多少(含税)?", money(2990 / 12 * 5 * TAX)),
    ("客户 3 月 1 日是专业版月付,当天正常扣了 3 月的月费,2026-03-05 又升级到企业版。3 月一共付了多少(不含税)?", money(299 + 700 * 27 / 31)),
    ("专业版月付,有一张长期 9 折券(对差价也有效),2026-05-16 升级到企业版,当月补差价含税多少?", money(700 * 0.9 * 16 / 31 * TAX)),
]

# 难题:一道题里叠好几条规则,还埋了陷阱(降级不影响当期、申请当月不算未使用)
QUIZ_HARD: list[tuple[str, float]] = [
    ("专业版月付 2 个席位,2026-02-10 全部升级到企业版,2026-02-20 又加 1 个企业版席位。2 月两次补差价合计含税多少?",
     money((2 * 700 * 19 / 28 + 999 * 9 / 28) * TAX)),
    ("企业版年付 3 个席位,2026-01-01 开始,2026-05-31 申请退款,能退多少(含税)?", money(9990 * 3 / 12 * 7 * TAX)),
    ("基础版月付,有长期 8 折券(对差价也有效)。2026-07-20 升级到专业版,2026-07-25 又降级回基础版。7 月因为这两次变更一共补了多少(含税)?",
     money(200 * 0.8 * 12 / 31 * TAX)),
    ("专业版年付,2026-01-01 开始,没用券。2026-03-15 申请降级到基础版年付,2026-03-20 又申请退款。能退多少(含税)?",
     money(2990 / 12 * 9 * TAX)),
    ("企业版年付,首年用了 85 折券,2026-01-01 开始,2026-10-08 申请退款,能退多少(含税)?", money(9990 * 0.85 / 12 * 2 * TAX)),
    ("专业版月付 2 个席位。2026-04-10 申请减掉 1 个席位,2026-04-15 把账号升级到企业版。4 月升级要补多少差价(含税)?",
     money(2 * 700 * 16 / 30 * TAX)),
    ("2026-02-28 客户从基础版月付升级到企业版月付,3 月 1 日正常扣企业版月费。2 月的差价加 3 月月费一共多少(不含税)?",
     money(900 * 1 / 28 + 999)),
    ("专业版月付 3 个席位,有长期 9 折券(对差价也有效)。2026-11-16 同一天:全部升级到企业版,并且再加 2 个企业版席位。当月要补多少(含税)?",
     money((3 * 700 * 15 / 30 + 2 * 999 * 15 / 30) * 0.9 * TAX)),
]

if __name__ == "__main__":
    for q, a in QUIZ + QUIZ_HARD:
        print(f"{a:>10.2f}  {q}")
```

<div class="line-notes">

- `from decimal import ROUND_HALF_UP, Decimal` `Decimal` 是十进制精确小数,算钱用它。JS 里没有内置的对应物,前端算钱一般用 decimal.js 或者全部换成「分」的整数,道理一样。
- `RULES = """云簿 CloudLedger 计费规则:` 三引号是多行字符串,相当于 JS 的反引号模板字符串(但不插值)。规则写进 system prompt,模型每道题都能看到全部规则。
- `5. 退款:只有专业版和企业版的年付可以退,退未使用的整月(申请当月不算未使用)` 陷阱最多的一条。4 月 20 日申请,4 月本身不算,未使用的是 5–12 月共 8 个月。
- `7. 只在最后一步四舍五入到分。` 不写这条,模型可能每一步都四舍五入,答案差几分钱,判卷就算错。
- `return float(Decimal(str(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))` Python 的 `round()` 是银行家舍入(四舍六入五成双),`round(0.125, 2)` 得 0.12,和财务的四舍五入不一样。`quantize(Decimal("0.01"))` 是保留到分,`ROUND_HALF_UP` 是普通的四舍五入。先 `str(x)` 再转 `Decimal`,避免把浮点误差带进来。
- `TAX = 1.06` 税率 6%,乘 1.06 就是含税价。
- `QUIZ: list[tuple[str, float]] = [` 12 道基础题,每道是「题目, 标准答案」。
- `("客户 2026-03-10 从基础版月付升级到专业版月付,` 3 月 31 天,10 号升级,剩余天数含当天 31 − 10 + 1 = 22。200 × 22 ÷ 31 = 141.935…,答案 141.94。
- `("企业版年付,2026-01-01 开始,2026-04-20 申请退款,` 9990 ÷ 12 × 8 × 1.06 = 7059.60。
- `("基础版年付,2026-01-01 开始,2026-06-01 申请退款,能退多少?", 0.0),` 陷阱:基础版年付不退。
- `("企业版月付客户 2026-03-25 降级到专业版,3 月能退多少?", 0.0),` 陷阱:降级下期生效,当期不退。
- `QUIZ_HARD: list[tuple[str, float]] = [` 8 道把三四条规则叠在一起的难题。
- `money((2 * 700 * 19 / 28 + 999 * 9 / 28) * TAX)),` 难题第 1 题:2 月 10 日两个席位各补 700 元月差价的 19/28,20 日新加的企业版席位按 999 元收 9/28,加起来再加税,答案 1347.37。
- `("企业版年付 3 个席位,2026-01-01 开始,2026-05-31 申请退款,` 5 月 31 日申请,5 月不算,未使用 6–12 月 7 个月,答案 18531.45。下面会看到关思考时模型有时把 5 月也算进去。
- `("专业版年付,2026-01-01 开始,没用券。2026-03-15 申请降级到基础版年付,` 陷阱:降级下期才生效,3 月 20 日退款时还是专业版年付,可以退 4–12 月 9 个月,答案 2377.05。
- `("企业版年付,首年用了 85 折券,2026-01-01 开始,2026-10-08 申请退款,` 申请当月 10 月不算,未使用只有 11、12 两个月,答案 1500.17,就是第一步那道题。
- `("专业版月付 2 个席位。2026-04-10 申请减掉 1 个席位,` 陷阱:减席位也是降级,下期生效,15 号升级时仍是 2 个席位,答案 791.47。
- `print(f"{a:>10.2f}  {q}")` `>10.2f` 右对齐占 10 格、两位小数。运行 `uv run python -m part03.billing_quiz` 打印 20 道题和答案,自己先挑两道手算核对。

</div>

运行一下,前三行和后两行是这样:

```text
    141.94  客户 2026-03-10 从基础版月付升级到专业版月付,当月要补多少差价(不含税)?
    371.00  客户 2026-02-15 从专业版月付升级到企业版月付,当月补差价含税多少?
   7059.60  企业版年付,2026-01-01 开始,2026-04-20 申请退款,能退多少(含税)?
   ...
   1031.14  2026-02-28 客户从基础版月付升级到企业版月付,3 月 1 日正常扣企业版月费。2 月的差价加 3 月月费一共多少(不含税)?
   1954.75  专业版月付 3 个席位,有长期 9 折券(对差价也有效)。2026-11-16 同一天:全部升级到企业版,并且再加 2 个企业版席位。当月要补多少(含税)?
```

评测脚本对每种配置把整套题并发跑一遍,统计对几道、平均输出 token、其中思考多少、平均耗时、总花费。

```python
# agent-zero-lab/part03/effort_sweep.py  一套计费题 × 五种思考配置:准确率、token、耗时、花费
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from common.llm import ChatResult, LLMClient
from part03.billing_quiz import QUIZ, QUIZ_HARD, RULES

QUESTIONS = QUIZ_HARD if os.environ.get("QUIZ") == "hard" else QUIZ
SYSTEM = RULES + "\n\n回答计费问题。最后一行只写「答案:金额」,金额是数字,不带单位和千分位,例如「答案:123.45」。"
ANS_RE = re.compile(r"答案[:：]\s*(-?[\d.]+)")
ON = {"thinking": {"type": "enabled"}}

CONFIGS: dict[str, dict[str, Any]] = {
    "关思考": {"extra_body": {"thinking": {"type": "disabled"}}},
    "low": {"extra_body": ON, "reasoning_effort": "low"},
    "medium": {"extra_body": ON, "reasoning_effort": "medium"},
    "high": {"extra_body": ON, "reasoning_effort": "high"},
    "max": {"extra_body": ON, "reasoning_effort": "max"},
}


def parse(text: str) -> float | None:
    found = ANS_RE.findall(text.replace(",", ""))
    return float(found[-1]) if found else None


def is_right(r: ChatResult, gold: float) -> bool:
    got = parse(r.content)
    return got is not None and abs(got - gold) < 0.011


def run_config(name: str, kw: dict[str, Any]) -> None:
    llm = LLMClient()

    def ask(q: str) -> ChatResult:
        return llm.chat([{"role": "system", "content": SYSTEM}, {"role": "user", "content": q}], **kw)

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(ask, [q for q, _ in QUESTIONS]))
    wrong = [i for i, (r, (_, gold)) in enumerate(zip(results, QUESTIONS), 1) if not is_right(r, gold)]
    n = len(QUESTIONS)
    out = sum(r.completion_tokens for r in results) / n
    think = sum(r.reasoning_tokens for r in results) / n
    lat = sum(r.latency for r in results) / n
    print(f"{name:6} 对 {n - len(wrong)}/{n} | 输出 {out:5.0f} tok(思考 {think:5.0f})"
          f" | 耗时 {lat:4.1f}s | ¥{llm.ledger.cost:.4f} | 错题 {wrong}")


if __name__ == "__main__":
    for name in sys.argv[1:] or list(CONFIGS):
        run_config(name, CONFIGS[name])
```

<div class="line-notes">

- `from concurrent.futures import ThreadPoolExecutor` 线程池:开几个线程,让几个请求同时发出去、各等各的。[Day 128](/blog/agent-zero/day-128-rate-limit/) 讲过并发为什么能省时间。一套题 8 到 12 道,一道道串行问要等半分钟,并发 4 个快很多。
- `QUESTIONS = QUIZ_HARD if os.environ.get("QUIZ") == "hard" else QUIZ` 用环境变量切题库,相当于 JS 的三元表达式 `cond ? a : b`,只是 Python 把条件写在中间。命令前面加 `QUIZ=hard` 就跑难题。
- `SYSTEM = RULES + "\n\n回答计费问题。最后一行只写「答案:金额」` 固定输出格式,和前面让分类结果只输出类别名是一个思路。
- `ANS_RE = re.compile(r"答案[:：]\s*(-?[\d.]+)")` 方括号里一个半角冒号、一个全角冒号,两种都认。模型写中文时经常用全角冒号,只写半角会漏掉(明天会专门踩一次这个坑)。`(-?[\d.]+)` 抓可选负号加数字和小数点。
- `"关思考": {"extra_body": {"thinking": {"type": "disabled"}}},` 和 `.env` 默认一样,写出来是为了表格里看得清楚。
- `"medium": {"extra_body": ON, "reasoning_effort": "medium"},` 按映射表它等于 high,放进来验证。
- `found = ANS_RE.findall(text.replace(",", ""))` 先去掉千分位逗号(18,531.45 → 18531.45),再找出所有「答案:」,取最后一个。模型偶尔在推导中间写「初步答案:…」,取最后一个更稳。
- `return float(found[-1]) if found else None` 一个都没找到返回 `None`,判卷时算错。
- `return got is not None and abs(got - gold) < 0.011` 允许一分钱以内的误差。浮点数直接 `==` 比较会因为表示误差误判(JS 里 `0.1 + 0.2 === 0.3` 是 false,同一个问题)。
- `llm = LLMClient()` 每种配置新建一个客户端,这样 `llm.ledger.cost` 正好是这一种配置的总花费。
- `def ask(q: str) -> ChatResult:` 函数里面再定义函数,它能直接用外层的 `llm` 和 `kw`,相当于 JS 的闭包。
- `with ThreadPoolExecutor(max_workers=4) as pool:` 最多 4 个并发。
- `results = list(pool.map(ask, [q for q, _ in QUESTIONS]))` `pool.map` 按输入顺序返回结果,所以下一行能和 `QUESTIONS` 一一对上。`[q for q, _ in QUESTIONS]` 只取题目,`_` 是「这个值我不要」的习惯写法。
- `wrong = [i for i, (r, (_, gold)) in enumerate(zip(results, QUESTIONS), 1) if not is_right(r, gold)]` 拆开读:`zip` 把结果和题目配对;`enumerate(..., 1)` 加上从 1 开始的题号;最后只留答错的题号。
- `think = sum(r.reasoning_tokens for r in results) / n` 用上今天给 `ChatResult` 新加的字段。
- `print(f"{name:6} 对 {n - len(wrong)}/{n} | 输出 {out:5.0f} tok(思考 {think:5.0f})"` 两个 f-string 挨着写会自动拼成一个,和 JS 里两个字符串用 `+` 连起来效果一样。
- `for name in sys.argv[1:] or list(CONFIGS):` 命令行给了配置名就只跑那几个,比如 `uv run python -m part03.effort_sweep 关思考 low`;没给就五种全跑。

</div>

先跑 12 道基础题:`uv run python -m part03.effort_sweep`。2026 年 10 月 22 日中午用 `deepseek-flash` 跑出来是这样:

```text
关思考    对 12/12 | 输出   169 tok(思考     0) | 耗时  1.3s | ¥0.0208 | 错题 []
low    对 12/12 | 输出   354 tok(思考   283) | 耗时  2.1s | ¥0.0392 | 错题 []
medium 对 12/12 | 输出   407 tok(思考   335) | 耗时  2.4s | ¥0.0442 | 错题 []
high   对 12/12 | 输出   408 tok(思考   325) | 耗时  2.4s | ¥0.0443 | 错题 []
max    对 12/12 | 输出   549 tok(思考   479) | 耗时  3.1s | ¥0.0578 | 错题 []
```

全对。我设计了两道陷阱题,关着思考也没掉进去。这就是第一个结论:**你以为难的题,对 2026 年的模型可能不难**。在这套题上开思考只是让每题多花 2 到 3 倍的钱和时间,换不来任何准确率。没跑这一遍、凭感觉默认开 high,就白花了这笔钱。

然后跑难题:`QUIZ=hard uv run python -m part03.effort_sweep`。我跑了两遍完整的,又单独把「关思考」多跑了三遍(思考关闭最便宜,也最容易出错,多看几遍):

```text
# 第一遍
关思考    对 8/8 | 输出   322 tok(思考     0) | 耗时  1.7s | ¥0.0239 | 错题 []
low    对 8/8 | 输出   919 tok(思考   777) | 耗时  4.6s | ¥0.0626 | 错题 []
medium 对 8/8 | 输出  1232 tok(思考  1116) | 耗时  6.2s | ¥0.0826 | 错题 []
high   对 8/8 | 输出  1284 tok(思考  1172) | 耗时  6.7s | ¥0.0859 | 错题 []
max    对 8/8 | 输出  1712 tok(思考  1647) | 耗时  8.8s | ¥0.1133 | 错题 []
# 第二遍
关思考    对 6/8 | 输出   349 tok(思考     0) | 耗时  2.2s | ¥0.0257 | 错题 [2, 6]
low    对 8/8 | 输出  1041 tok(思考   960) | 耗时  5.5s | ¥0.0704 | 错题 []
medium 对 8/8 | 输出  1265 tok(思考  1176) | 耗时  6.4s | ¥0.0847 | 错题 []
high   对 8/8 | 输出  1120 tok(思考  1016) | 耗时  5.7s | ¥0.0754 | 错题 []
max    对 8/8 | 输出  1950 tok(思考  1841) | 耗时  9.7s | ¥0.1285 | 错题 []
# 关思考单独再跑三遍
关思考    对 8/8 | 输出   323 tok(思考     0) | 耗时  2.0s | ¥0.0240 | 错题 []
关思考    对 6/8 | 输出   384 tok(思考     0) | 耗时  2.1s | ¥0.0279 | 错题 [2, 5]
关思考    对 8/8 | 输出   271 tok(思考     0) | 耗时  1.8s | ¥0.0207 | 错题 []
```

汇总成一张表(准确率是几遍合计,其他是范围):

| 配置 | 对 | 平均输出 token | 其中思考 | 平均耗时 | 8 题花费 |
| --- | --- | --- | --- | --- | --- |
| 关思考 | 36/40 | 271–384 | 0 | 1.7–2.2s | ¥0.021–0.028 |
| low | 16/16 | 919–1,041 | 777–960 | 4.6–5.5s | ¥0.063–0.070 |
| medium | 16/16 | 1,232–1,265 | 1,116–1,176 | 6.2–6.4s | ¥0.083–0.085 |
| high | 16/16 | 1,120–1,284 | 1,016–1,172 | 5.7–6.7s | ¥0.075–0.086 |
| max | 16/16 | 1,712–1,950 | 1,647–1,841 | 8.8–9.7s | ¥0.113–0.129 |

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="难题第一遍,五种配置的平均输出 token">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">难题第一遍:每题平均输出 token(蓝 = 思考,白 = 正文)</text>
  <text x="80" y="58" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">关思考</text>
  <rect x="90" y="44" width="80" height="20" fill="var(--paper)" stroke="var(--rule)"/>
  <text x="178" y="58" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">322 · 8/8 · ¥0.024</text>
  <text x="80" y="96" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">low</text>
  <rect x="90" y="82" width="194" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <rect x="284" y="82" width="36" height="20" fill="var(--paper)" stroke="var(--rule)"/>
  <text x="328" y="96" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">919 · 8/8 · ¥0.063</text>
  <text x="80" y="134" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">medium</text>
  <rect x="90" y="120" width="279" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <rect x="369" y="120" width="29" height="20" fill="var(--paper)" stroke="var(--rule)"/>
  <text x="406" y="134" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">1232 · 8/8 · ¥0.083</text>
  <text x="80" y="172" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">high</text>
  <rect x="90" y="158" width="293" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <rect x="383" y="158" width="28" height="20" fill="var(--paper)" stroke="var(--rule)"/>
  <text x="419" y="172" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">1284 · 8/8 · ¥0.086</text>
  <text x="80" y="210" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">max</text>
  <rect x="90" y="196" width="412" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <rect x="502" y="196" width="16" height="20" fill="var(--paper)" stroke="var(--rule)"/>
  <text x="526" y="210" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">1712 · 8/8</text>
  <text x="20" y="240" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">准确率一样,输出从 322 涨到 1712;开思考后正文反而变短,推导搬进了思考里</text>
</svg>
<figcaption>难题第一遍的实测数据,条长按每 4 个 token 一个像素画。medium 和 high 几乎一样长,对上了「medium 映射成 high」。</figcaption>
</figure>

把这些数字读一遍,能得出几条可以直接用的结论。

**思考的收益集中在少数容易漏规则的题上。** 难题上关思考 40 次对了 36 次,90%。错的四次落在第 2、5、6 题,全是「申请当月不算」「减席位下期生效」这类陷阱。开思考把这 10% 补上了,代价是每题花费 3 到 5 倍、耗时 2.5 到 5 倍。值不值,看这 10% 的错有多贵:退款算错一次,客服要道歉、财务要冲正,那就值;给内部看的估算,就不值。

**low 已经拿到全部收益。** 这套题上 low、medium、high、max 都是全对,max 的花费接近 low 的 2 倍。档位越高不等于越好。Claude 的文档在 max 那一档也写了类似的提醒:多数任务上 max 多花了很多 token,质量只多一点点。

**medium 和 high 是同一档。** 两遍难题里 medium 每题思考 1116、1176 个 token,high 是 1172、1016,在同一个区间里来回晃,基础题上更是 335 对 325。映射表说的是真的。

**档位是倾向,不是上限。** 同一个 high,两遍的平均思考差了 150 多个 token;第一步那道题单独问,两次差了四百多。DeepSeek 只给档位,不给精确的 token 上限,想要硬上限得用 `max_tokens`(会把思考一起截断)或者换通义那种 `thinking_budget`。

这些结论只对 `deepseek-flash` 和这套题成立,换个模型、换个任务,数字会完全不同。**真正要带走的是方法**:二十道带标准答案的题、一个判卷函数、几种配置,半小时跑完,上线前在你自己的任务上做一遍。

## 怎么选档

把今天的内容压成一个上线前的判断顺序:

1. 先跑关思考。在你的评测集上准确率够,就关着,这一步最常被跳过,也最省钱。
2. 不够的话,看错在哪类题。像今天这样集中在几道陷阱题上,先想能不能改提示词或者给工具(计费金额能用公式算,给模型一个算差价的工具,准确率一开始就是 100%,这是 [Day 182](/blog/agent-zero/day-182-tool-design-2/) 之后的工具设计和第五部分的事)。
3. 还要开,就从 low 开始往上加,直到准确率不再涨。今天这套题 low 就到顶。
4. 聊天界面还要看首 token 延迟。开思考后用户要先等它想完才看到第一个字,今天表里的平均耗时从 2 秒变成 5 到 10 秒,[Day 133](/blog/agent-zero/day-133-sse-principle/) 讲的首 token 延迟会一起变长。

面试被问「你们的 Agent 开不开思考」,能按这个顺序说,再报一组自己量过的数字,比说「我们用最强的推理模型」有说服力得多。

## 动手练习

### 练习 1:加一列「每答对一题花多少钱」

总花费不好横向比,因为准确率不一样时,便宜的配置可能要重做。复制 `effort_sweep.py` 为 `effort_sweep_ex1.py`,在输出里加一列「每答对一题的花费」= 总花费 ÷ 答对题数。只跑基础题的「关思考」和「low」两档。

<details><summary>参考答案</summary>

只改 `run_config` 里算指标和打印的两段,其余和 `effort_sweep.py` 一样:

```python
# agent-zero-lab/part03/effort_sweep_ex1.py  练习 1:多一列「每答对一题花多少钱」(只列改动的部分)
    lat = sum(r.latency for r in results) / n
    right = n - len(wrong)
    per_right = llm.ledger.cost / right if right else float("inf")
    print(f"{name:6} 对 {n - len(wrong)}/{n} | 输出 {out:5.0f} tok(思考 {think:5.0f})"
          f" | 耗时 {lat:4.1f}s | ¥{llm.ledger.cost:.4f} | 每对一题 ¥{per_right:.4f} | 错题 {wrong}")
```

<div class="line-notes">

- `right = n - len(wrong)` 答对的题数。实跑两档都是 12。
- `per_right = llm.ledger.cost / right if right else float("inf")` 一道都没对时除以 0 会报 `ZeroDivisionError`,这里给无穷大。`float("inf")` 相当于 JS 的 `Infinity`。
- `f" | 耗时 {lat:4.1f}s | ¥{llm.ledger.cost:.4f} | 每对一题 ¥{per_right:.4f} | 错题 {wrong}")` 实跑:关思考 ¥0.0145 ÷ 12 = ¥0.0012,low ¥0.0401 ÷ 12 = ¥0.0033。

</div>

运行 `uv run python -m part03.effort_sweep_ex1 关思考 low`:

```text
关思考    对 12/12 | 输出   104 tok(思考     0) | 耗时  1.1s | ¥0.0145 | 每对一题 ¥0.0012 | 错题 []
low    对 12/12 | 输出   364 tok(思考   286) | 耗时  2.1s | ¥0.0401 | 每对一题 ¥0.0033 | 错题 []
```

顺便注意关思考这次平均输出只有 104 个 token,上一次是 169,同一套题同一个配置,输出长度差了六成。

</details>

### 练习 2:把关思考错的题单独问五遍

难题第二遍里关思考错了第 2 题。写一个 `repeat_one.py`,命令行传题号和次数,用关思考把这道题并发问 N 遍,打印每次解析出的答案。观察:错的时候错成了什么?是随机乱错,还是错在同一条规则上?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/repeat_one.py  同一道难题关思考连问 N 次,看答案稳不稳
import sys
from concurrent.futures import ThreadPoolExecutor

from common.llm import ChatResult, LLMClient
from part03.billing_quiz import QUIZ_HARD
from part03.effort_sweep import SYSTEM, parse

idx = int(sys.argv[1])  # 难题编号,从 1 开始
n = int(sys.argv[2]) if len(sys.argv) > 2 else 3
question, gold = QUIZ_HARD[idx - 1]
llm = LLMClient()


def ask(_: int) -> ChatResult:
    return llm.chat([{"role": "system", "content": SYSTEM}, {"role": "user", "content": question}])


with ThreadPoolExecutor(max_workers=n) as pool:
    answers = [parse(r.content) for r in pool.map(ask, range(n))]
print(f"难题 {idx} 标准答案 {gold} | 关思考 {n} 次: {answers} | {llm.ledger}")
```

<div class="line-notes">

- `from part03.effort_sweep import SYSTEM, parse` 复用评测脚本的 system prompt 和解析函数。导入时不会触发评测,因为评测代码在它的 `if __name__ == "__main__":` 下面。
- `idx = int(sys.argv[1])  # 难题编号,从 1 开始` `sys.argv` 相当于 Node 的 `process.argv.slice(1)`,`[1]` 是第一个参数,是字符串,要 `int()` 转。
- `n = int(sys.argv[2]) if len(sys.argv) > 2 else 3` 第二个参数可选,默认 3 次。
- `question, gold = QUIZ_HARD[idx - 1]` 人数题号从 1 开始,列表下标从 0 开始,所以减 1。
- `def ask(_: int) -> ChatResult:` 参数用不上,但 `pool.map` 一定会传一个进来,用 `_` 接住。
- `answers = [parse(r.content) for r in pool.map(ask, range(n))]` `range(n)` 产生 0 到 n−1,只是为了让 `ask` 被调用 n 次。

</div>

运行 `uv run python -m part03.repeat_one 2 5`:

```text
难题 2 标准答案 18531.45 | 关思考 5 次: [18531.45, 18531.45, 18531.45, 21178.8, 18506.48] | 5 次调用 | 输入 1605 / 输出 831 tokens | 约 ¥0.0086
```

五次里对三次。21178.8 = 9990 × 3 ÷ 12 × 8 × 1.06,正好是把申请当月 5 月也算成未使用,多退了一个月;18506.48 比标准答案少 24.97 元,我没细追它的推导。错法不是均匀乱撒的,至少有一种错是规则读错,而且会反复出现。这就是明天要讲的投票能起作用的前提,也是它会失效的原因。

</details>

### 练习 3:算一笔月账

假设云簿的客服 Agent 每天要回答 2 万个难题级别的计费问题。用上面难题表里关思考和 low 的花费区间(都按 8 题算的),估算两种配置每月(30 天)各多少钱,差多少。再按准确率估算:关思考每月大约多少次答错?

<details><summary>参考答案</summary>

关思考 8 题 ¥0.021–0.028,每题约 ¥0.0026–0.0035;low 8 题 ¥0.063–0.070,每题约 ¥0.0079–0.0088。

每月 60 万题:关思考约 60 万 × 0.0026 ≈ 1,560 元到 60 万 × 0.0035 ≈ 2,100 元;low 约 60 万 × 0.0079 ≈ 4,740 元到 60 万 × 0.0088 ≈ 5,280 元。每月多花 3,000 元上下(这是高峰价,全在空闲时段跑减半)。

关思考 40 次错 4 次,按 10% 估,每月约 6 万次答错。这不是让你选 low 的理由,而是说明光靠模型不行:这种量级的金额计算,应该给工具精确算,再加程序校验。第 7 部分讲人工审批时还会回到这里。

</details>

### 练习 4:开思考时把 temperature 设成 0

[Day 110](/blog/agent-zero/day-110-sampling-1/) 讲过 temperature 越低输出越稳。在开思考 low 的情况下把 `temperature=0`,同一道题问三遍,看思考长度和思考开头是不是每次一样。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/temp_probe.py  练习 4:开思考时把 temperature 设成 0,三次还一样吗
from common.llm import LLMClient
from part03.billing_quiz import QUIZ_HARD
from part03.effort_sweep import SYSTEM, parse

question, gold = QUIZ_HARD[0]
msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": question}]
llm = LLMClient()
for i in range(3):
    r = llm.chat(msgs, temperature=0, extra_body={"thinking": {"type": "enabled"}}, reasoning_effort="low")
    print(f"第 {i + 1} 次 思考 {r.reasoning_tokens} tok | 思考开头 {(r.reasoning or '')[:24]!r} | 答案 {parse(r.content)}")
print("标准答案", gold, "|", llm.ledger)
```

<div class="line-notes">

- `question, gold = QUIZ_HARD[0]` 难题第 1 题,标准答案 1347.37。
- `r = llm.chat(msgs, temperature=0, extra_body={"thinking": {"type": "enabled"}}, reasoning_effort="low")` 温度设成 0,如果它生效,三次输出应该几乎一样。
- `print(f"第 {i + 1} 次 思考 {r.reasoning_tokens} tok | 思考开头 {(r.reasoning or '')[:24]!r}` 只看思考的前 24 个字符,够判断是不是同一条路。实跑三次分别是 646、836、1014 个 token。

</div>

运行 `uv run python -m part03.temp_probe`:

```text
第 1 次 思考 646 tok | 思考开头 '我们需要回答中文计费题。需要计算。最后一行只写答' | 答案 1347.37
第 2 次 思考 836 tok | 思考开头 '我们需要回答中文计费题。需要严格最后一行只写答案' | 答案 1347.37
第 3 次 思考 1014 tok | 思考开头 '我们需要回答中文计费题。需要计算。需要小心规则。' | 答案 1347.37
标准答案 1347.37 | 3 次调用 | 输入 1083 / 输出 2987 tokens | 约 ¥0.0253
```

三次长度差了快一倍,开头第十几个字就分叉了。DeepSeek 文档写明思考模式下 `temperature` 可以传、不报错,但不生效。所以开思考时想靠温度控制稳定性是没用的,明天的投票实验也会因为这个原因用关思考来做。

</details>

**验收标准:** 自己跑出基础题和难题两张表(数字和我的不同很正常,量级应该接近);能对着自己的表说出「在我的模型上关思考、low、high 各值不值」三句话;`effort_probe.py` 的五行输出和本文一致或者能解释为什么不一致。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 推理预算 | 允许模型在回答前的推理过程上花多少 token。有的厂商给档位,有的给精确上限 |
| `thinking` 开关 | DeepSeek 打开或关闭思考模式的参数,放在 `extra_body` 里,默认开启。和档位冲突时以它为准 |
| `reasoning_effort` | 思考强度档位。DeepSeek 实际只有 low / high / max 三档,其他取值会被映射过去 |
| 档位映射 | 厂商把你传的档位换成它支持的档位,比如 DeepSeek 把 medium 当 high。换厂商时同名档位不一定同效果 |
| `reasoning_tokens` | `usage.completion_tokens_details` 里的字段,表示输出 token 里有多少是思考。关思考时整个 details 是 None |
| `thinking_budget` | 通义的思考 token 上限,到了就停下写答案,是字面意义上的预算 |
| effort(Claude) | Claude 的强度参数,管整个回答的 token 花费,不只是思考 |
| 422 | HTTP 状态码,请求格式能解析但内容不合法,比如档位名写错 |
| 高峰价 / 空闲价 | DeepSeek 按北京时间分时计价,空闲时段是高峰的一半 |
| effort sweep | 把同一套题在多个思考档位上各跑一遍,对比准确率和成本的实验 |

## 常见误区

**默认把思考开到最大。** 今天的基础题上 max 和关思考准确率一样,花费 2.8 倍;难题上 low 就到顶了。档位要在自己的题上从低往高试。

**以为思考 token 不要钱,或者只看正文估成本。** 第一步那次正文 9 个 token,账单上输出 1465 个。估算成本用 `completion_tokens`,想知道其中多少是思考看 `reasoning_tokens`,别数正文字数。OpenAI 的思考内容你甚至看不到,账单上照样有。

**参数写了就以为生效了。** `关 + high` 一点都不想,`开 + none` 照样想,都不报错。上线前用最便宜的问题把每种组合跑一遍,看 `reasoning_tokens` 对不对。

**直接读 `usage.completion_tokens_details.reasoning_tokens`。** 关思考时 `completion_tokens_details` 是 `None`,这一行会报 `AttributeError: 'NoneType' object has no attribute 'reasoning_tokens'`。要像 `_reasoning_tokens` 那样先判空。

**跨厂商复用档位名就以为效果一样。** DeepSeek 把 medium 当 high;Claude 的 effort 还会影响正文长度和工具调用次数;OpenAI 有的模型不支持某些档位。换厂商要重跑 sweep。

**只跑一遍就下结论。** 关思考在难题上五遍里有两遍 8/8、三遍不是;同一道题开 high 两次思考差四百多 token。至少跑三遍,看范围不看单个数。

**拿空闲时段的账单去估高峰的成本。** 同样的调用,白天工作时段贵一倍。课程 `.env` 写的是高峰价,估算偏保守是对的。

## 学习资料

### 文档与文章

- [DeepSeek · 思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode):开关、`reasoning_effort` 取值和映射表、思考模式下不生效的参数(temperature 等)。今天必看,10 分钟。
- [DeepSeek · 模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):单价和峰谷时段,算成本前核对一次。
- [Claude · Effort](https://platform.claude.com/docs/en/build-with-claude/effort):五个档位、effort 和思考的关系、各模型的推荐起点。看「How effort works」那一节,20 分钟。
- [OpenAI · Reasoning models](https://developers.openai.com/api/docs/guides/reasoning):`reasoning.effort` 的取值、推理 token 按输出计费、`reasoning_tokens` 字段。
- [阿里云百炼 · 深度思考](https://help.aliyun.com/zh/model-studio/deep-thinking):`enable_thinking`、`thinking_budget` 和计费规则,想对比「档位」和「精确预算」两种设计时读。
- [Scaling LLM Test-Time Compute Optimally](https://arxiv.org/abs/2408.03314):推理时多花算力和换大模型的取舍,只看摘要和第一张图就够,英文论文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1aiADewEBC&p=19&autoplay=0&high_quality=1" title="【已授权】李宏毅2025《机器学习》" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>啥都会一点的研究生 · 【已授权】李宏毅2025《机器学习》 · 第 19 P「第八讲:大型语言模型的推理过程不用太长、够用就好」,24 分钟,正好对应今天「low 就到顶」的结论。有时间再看第 18 P(78 分钟)讲推理模型怎么训出来。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1cV93YGEoy&autoplay=0&high_quality=1" title="万字科普DeepSeek R1底层原理,DeepSeek是从0到1的创新吗?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>新石器公园 · 万字科普DeepSeek R1底层原理,DeepSeek是从0到1的创新吗? · 27 分钟科普,讲模型为什么会「想」,想不清楚思考 token 从哪来的时候看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/xCRvOUykOX0" title="How do thinking and reasoning models work?" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Google for Developers · How do thinking and reasoning models work? · 官方的短讲解,讲思考模型的原理和什么时候该开。英文,可开自动字幕。</figcaption>
</figure>

Karpathy 的 [Deep Dive into LLMs like ChatGPT](https://www.youtube.com/watch?v=7xTGNNLPyMI) 后半部分讲强化学习和 DeepSeek-R1,如果前面没看完,今天可以补那一段。

### 书籍

- Sebastian Raschka《Build a Reasoning Model (From Scratch)》(Manning, 2026):前几章讲怎么给推理模型做评测、怎么在推理时多花算力,和今天的 effort sweep 是同一个思路,英文。
- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 2 章讲采样的部分有 test-time compute 一节,讲推理时多花算力的几种做法和成本。

### 开源项目与代码

- [openai/openai-python](https://github.com/openai/openai-python):在 `src/openai/resources/chat/completions/` 里搜 `reasoning_effort`,能看到它就是一个普通的关键字参数,SDK 原样放进请求体。
- [rasbt/reasoning-from-scratch](https://github.com/rasbt/reasoning-from-scratch):上面那本书的配套代码,有推理评测的完整实现。

## 自测

1. DeepSeek 上,`extra_body={"thinking": {"type": "disabled"}}` 加 `reasoning_effort="high"`,模型会思考吗?反过来开关写 enabled、档位写 none 呢?

<details><summary>答案</summary>

前者不思考,实测 `reasoning_tokens` 为 0;后者照样思考,实测 15 个 token。开关和档位冲突时,以 `thinking` 开关为准。

</details>

2. 一次请求输入 800 token(全部未命中),关思考输出 300 token,开思考输出 1,500 token。按 `deepseek-flash` 高峰价,两种各多少钱?

<details><summary>答案</summary>

关思考:800 × 2 + 300 × 8 = 4,000,除以一百万是 0.004 元。开思考:800 × 2 + 1,500 × 8 = 13,600,约 0.0136 元,贵 3.4 倍。思考 token 按输出单价算,所以钱几乎都花在输出上。

</details>

3. 为什么今天的实验里 medium 和 high 的数字几乎一样?这对跨厂商写代码意味着什么?

<details><summary>答案</summary>

DeepSeek 只支持 low / high / max 三档,传 medium 会被映射成 high。这意味着同一份代码换厂商不会报错,但同名档位效果可能不同,换厂商要重新跑一遍 sweep,不能照搬档位。

</details>

4. 关思考时为什么不能直接写 `r.usage.completion_tokens_details.reasoning_tokens`?

<details><summary>答案</summary>

关思考时 DeepSeek 返回的 `completion_tokens_details` 是 `None`,对 `None` 取属性会报 `AttributeError`。要先判断 details 存不存在,不存在就当 0。

</details>

5. (面试题)产品经理说「计费问题全部开思考 max,保证算对」。你怎么回应?

<details><summary>答案</summary>

要点:①用数据说话,建一套带标准答案的计费题,跑关思考到 max 几档,我们实测难题上关思考 90%、low 起就 100%,max 花费是 low 的近 2 倍,准确率没有更高;②思考按输出计费,max 每题贵 4 到 5 倍,耗时从 2 秒变成 9 秒,聊天界面首字等待明显变长;③就算开到 max,几十次全对也不代表一万次全对,金额这种能用公式算的,应该给工具精确算,再加程序校验;④所以建议是先给工具,剩下工具覆盖不到的难题再开 low。

</details>

## 明天预告

明天是 **Day 179 · 不靠推理模型的老办法:自洽投票和 best-of-N**。今天看到关思考在陷阱题上会错,而且错法有规律。推理模型出现之前,大家已经有别的办法在推理时多花算力:同一道题问五遍投票,或者让一个程序验证器从五个答案里挑。明天把这两种办法写出来,和今天的思考档位比准确率和花费,还会专门踩一次全角冒号让验证器失灵的坑。
