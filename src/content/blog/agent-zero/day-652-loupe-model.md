---
title: 'Day 652 · Loupe(一):两个数据模型,字段一个个想清楚'
description: '从 Day 649 手写的那份 steps 列表出发,一个字段一个字段地问「它从哪来、谁要用它」,用 pydantic 写出 Loupe 的 Run 和 Step 两个模型:kind 只许五种,时间必须带时区并统一成 UTC,步骤按开始时间重新编号。最后把 Day 649 那次真实运行装进新模型,用测试把这些约定钉住。'
pubDate: 2026-10-23
regime: none
tags: ['agent-loupe', 'pydantic', 'data-model', 'agent-zero']
series: 'agent-zero'
day: 652
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 651](/blog/agent-zero/day-651-loupe-prd/) 写了 Loupe 的 PRD,用 `prd_check.py` 把第一稿里的七个问题挑了出来;画了三层两进程的架构;建好了 `agent-loupe/` 仓库的空骨架,`server/` 里只有一个 `/api/health`,`web/` 通过 Vite 代理拿到了它的回答。

架构图里有一句话:三种格式的 trace 进来以后都要先变成 `Run` 和 `Step` 两种东西,后面的数据库、前端、对比、重跑只认这两种。今天就把这两个模型定下来。它们是整个项目的地基,后面二十多天不再改名,所以今天走慢一点,每个字段都要说得出为什么在这里。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说出 `Run` 和 `Step` 每个字段从哪来、后面哪一天的哪个功能要用它,尤其是为什么用 `idx`(第几步)而不是原始的 span ID 当编号。
2. 用 pydantic 写出 `server/loupe/models.py`:`kind` 只能是五种之一,时间必须带时区并统一转成 UTC,写错了在导入那一刻就报错。
3. 写出 `normalize()`:把乱序的步骤按开始时间排好、重新编号、改好父子指向、补齐整次运行的汇总数字,并说出它保证的那条约定「父步骤的编号一定比子步骤小」。
4. 把 Day 649 那次真实运行的记录装进新模型,用 `tests/test_models.py` 把以上约定钉住。

预计用时 2.5 小时:字段讨论一小时,写代码和跑脚本一小时,测试和练习半小时。今天不调模型,花费 0。

前置:[Day 649](/blog/agent-zero/day-649-loupe-why/)(`traced_agent.py` 和它存下的 `weather_run.json`)、[Day 651](/blog/agent-zero/day-651-loupe-prd/)(仓库骨架)、[Day 51](/blog/agent-zero/day-051-pydantic-1/)(pydantic 入门)、[Day 71](/blog/agent-zero/day-071-pytest-1/)(pytest)。

学法提示:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `Step` 的十四个字段和 `normalize` 默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先看 Day 649 那份记录缺什么

Day 649 的 `traced_agent.py` 给每一步记了一条字典。为了今天有真实数据,我在 `agent-zero-lab/` 里把它重新跑了一次(调了两次 DeepSeek,约 ¥0.0025),存下的 `part11/runs/weather_run.json` 是这样的(只截了前两步和最后一步):

```json
{
  "answer": "现在三个城市的气温如下：…平均气温 = (9.1 + 17.3 + 24.4) ÷ 3 = 50.8 ÷ 3 ≈ **16.9°C**",
  "steps": [
    {"idx": 0, "kind": "llm", "name": "deepseek-flash", "start": 0.0, "end": 1.04,
     "input_tokens": 310, "output_tokens": 106},
    {"idx": 1, "kind": "tool", "name": "get_weather(Beijing)", "start": 1.04, "end": 5.52},
    {"idx": 4, "kind": "llm", "name": "deepseek-flash", "start": 16.59, "end": 17.34,
     "input_tokens": 489, "output_tokens": 86}
  ]
}
```

那天用它画瀑布图够用了。可要把它当成调试器的数据,拿 PRD 里的用户故事一条条去问,马上就卡住:

| 用户故事想做的事 | 这份记录能回答吗 | 缺的是什么 |
| --- | --- | --- |
| 列表里显示「10 月 22 日晚上 11 点 48 分跑的那次」 | 不能,`start` 是离起点几秒 | 带日期和时区的绝对时间 |
| 一次导入好几条运行,分得清谁是谁 | 不能 | 运行的编号 `id` |
| 点开第 0 步看完整 messages 和工具定义(Day 665) | 不能 | 每一步的输入和输出 |
| 看「工具这一步报错了」 | 不能 | 错误信息 |
| 嵌套的步骤画成树(Agent 套 Agent,Agent 套工具) | 不能 | 父步骤是谁 |
| 列表页显示总 token、总花费、用的哪个模型 | 要自己从步骤里加 | 整次运行的汇总 |
| 从第 3 步重跑出一条新运行,记住它是从哪来的(Day 670) | 不能 | 来源运行和分叉的步号 |

缺的东西分成两类:属于「一步」的(时间、输入输出、错误、父步骤),和属于「整次运行」的(编号、汇总、状态、来源)。这就是两个模型:**Run**(一次运行)和 **Step**(运行里的一步)。

为什么只有两层?OpenTelemetry 的数据是三层(resource → scope → span),Langfuse 也是三层(session → trace → observation)。调试器的用户关心的单位只有两个:这一次运行,和这一次里的每一步。「会话」(一段多轮对话串起来的好几次运行)用标签就能表达,不值得多一张表、前端多一层页面。层数越少,后面每一天都越省事。

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="Run 和 Step 两个模型的字段,以及后面哪一天用到它们">
<rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)" rx="6"/>
<rect x="20" y="20" width="250" height="290" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="145" y="42" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--mem)">Run(一次运行)</text>
<text x="34" y="68" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">id, name</text>
<text x="34" y="90" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">started_at, ended_at</text>
<text x="34" y="112" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">status: ok | error</text>
<text x="34" y="134" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">model</text>
<text x="34" y="156" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">total_input_tokens</text>
<text x="34" y="178" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">total_output_tokens</text>
<text x="34" y="200" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">total_cost_usd</text>
<text x="34" y="222" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">tags</text>
<text x="34" y="244" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">parent_run_id</text>
<text x="34" y="266" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">forked_from_step</text>
<text x="34" y="296" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">列表页、筛选、重跑来源</text>
<rect x="370" y="20" width="250" height="290" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="495" y="42" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--compute)">Step(一步)</text>
<text x="384" y="68" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">run_id, idx, parent_idx</text>
<text x="384" y="90" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">kind: llm|tool|agent|</text>
<text x="384" y="108" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">      retrieval|other</text>
<text x="384" y="130" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">name</text>
<text x="384" y="152" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">started_at, ended_at</text>
<text x="384" y="174" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">input, output, error</text>
<text x="384" y="196" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">input_tokens, output_tokens</text>
<text x="384" y="218" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">cost_usd, model</text>
<text x="384" y="296" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">时间轴、详情、对比、重跑</text>
<line x1="270" y1="68" x2="368" y2="68" stroke="var(--ink-soft)" marker-end="url(#a652)"/>
<text x="319" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">1 对多</text>
<text x="319" y="150" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">主键</text>
<text x="319" y="168" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">(run_id, idx)</text>
<defs><marker id="a652" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
</svg>
<figcaption>一次运行有很多步。灰色的两个字段平时是空的,只有 Day 670 从某一步重跑出来的新运行才会填。一步由「哪次运行 + 第几步」唯一确定。</figcaption>
</figure>

## 准备:草稿目录

今天要写好几个十几行的小脚本试东西,它们不属于 Loupe 本体。在 `server/` 下建一个 `scratch/` 放它们,并在仓库根目录的 `.gitignore` 末尾加一行 `server/scratch/`,不提交:

```bash
cd /Users/你/agent-loupe/server
mkdir -p scratch
touch scratch/__init__.py
echo "server/scratch/" >> ../.gitignore
```

pydantic 是 FastAPI 的依赖,Day 651 装 FastAPI 时已经顺带装上了。今天的代码直接 import 它,所以把它写进依赖里,别靠「别人顺带装的」:

```bash
uv add pydantic
```

我这里装到的是 `pydantic 2.14.1`(2026 年 10 月)。所有脚本都在 `server/` 目录下用 `uv run python -m scratch.xxx` 跑,`-m` 的原因 Day 649 讲过:这样 Python 从 `server/` 这一层找模块,`from loupe.models import ...` 才找得到。

## 第一步:kind 只许五种

先写一个只有五个字段的 `Step`,只想清楚一件事:**一步是什么类型**。

```python
# agent-loupe/server/scratch/s1_step.py
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ValidationError

StepKind = Literal["llm", "tool", "agent", "retrieval", "other"]


class Step(BaseModel):
    idx: int
    kind: StepKind
    name: str
    started_at: datetime
    ended_at: datetime


s = Step.model_validate({"idx": 0, "kind": "llm", "name": "deepseek-flash",
                         "started_at": "2026-10-22T07:41:03.120Z", "ended_at": "2026-10-22T07:41:04.160Z"})
print(repr(s.started_at))
print("耗时", (s.ended_at - s.started_at).total_seconds(), "秒")
print(s.model_dump_json())

try:
    Step.model_validate({"idx": 1, "kind": "LLM", "name": "deepseek-flash",
                         "started_at": "2026-10-22T07:41:03Z", "ended_at": "2026-10-22T07:41:04Z"})
except ValidationError as e:
    print(e)
```

<div class="line-notes">

- `from typing import Literal` `Literal` 是「只能是这几个具体值之一」的类型。
- `StepKind = Literal["llm", "tool", "agent", "retrieval", "other"]` 相当于 TS 的 `type StepKind = 'llm' | 'tool' | 'agent' | 'retrieval' | 'other'`。区别在于 TS 的联合类型只在编译时检查,pydantic 会在运行时真的拦下不在列表里的值。
- `class Step(BaseModel):` [Day 51](/blog/agent-zero/day-051-pydantic-1/) 学过:继承 `BaseModel`,类里写「字段名: 类型」,pydantic 帮你校验和转换。
- `started_at: datetime` 类型写的是 `datetime`,传进来的却是字符串。pydantic 会把 ISO 8601 格式的字符串解析成 `datetime` 对象。
- `s = Step.model_validate({"idx": 0, "kind": "llm", "name": "deepseek-flash",` 用 `model_validate` 从一个字典建对象,这是「数据从外面来」的正规入口,导入器读 JSON 文件就是这种情况。为什么不直接写 `Step(idx=0, ..., started_at="...")`,下面「编辑器里的红线」一段讲。
- `"started_at": "2026-10-22T07:41:03.120Z", "ended_at": "2026-10-22T07:41:04.160Z"})` 结尾的 `Z` 表示 UTC(零时区),≈ JS 里 `new Date().toISOString()` 打出来的那种格式。这两个时间差 1.04 秒,和 Day 649 第 0 步一样长。
- `print(repr(s.started_at))` 打出来是 `datetime.datetime(2026, 10, 22, 7, 41, 3, 120000, tzinfo=TzInfo(0))`,字符串已经变成了带时区的日期对象,`120000` 是微秒。
- `print("耗时", (s.ended_at - s.started_at).total_seconds(), "秒")` 两个 `datetime` 相减得到一个时间间隔(`timedelta`),`.total_seconds()` 换成秒,这里是 `1.04`。≈ JS 里两个 `Date` 相减得到毫秒数。
- `print(s.model_dump_json())` 转回 JSON 字符串,≈ `JSON.stringify`。时间又变回 ISO 字符串,前端拿到可以直接 `new Date(...)`。
- `Step.model_validate({"idx": 1, "kind": "LLM", "name": "deepseek-flash",` 故意写成大写的 `LLM`。
- `except ValidationError as e:` 校验不通过时 pydantic 抛 `ValidationError`,打印它能看到是哪个字段、错在哪。

</div>

```bash
cd /Users/你/agent-loupe/server
uv run python -m scratch.s1_step
```

```text
datetime.datetime(2026, 10, 22, 7, 41, 3, 120000, tzinfo=TzInfo(0))
耗时 1.04 秒
{"idx":0,"kind":"llm","name":"deepseek-flash","started_at":"2026-10-22T07:41:03.120000Z","ended_at":"2026-10-22T07:41:04.160000Z"}
1 validation error for Step
kind
  Input should be 'llm', 'tool', 'agent', 'retrieval' or 'other' [type=literal_error, input_value='LLM', input_type=str]
    For further information visit https://errors.pydantic.dev/2.14/v/literal_error
```

大写的 `LLM` 在导入那一刻就被拦下来了。这正是我们想要的:如果它混进数据库,前端的 `if (step.kind === 'llm')` 会悄悄地不成立,这一步在时间轴上就成了灰色的「其他」,你得花半天才查到原因。

**为什么是这五种。** 明天会看到,OpenTelemetry 的 GenAI 约定里 `gen_ai.operation.name` 有十几种取值,Langfuse 的 observation 类型也有十种左右。如果原样保留,前端每一处都要处理一长串情况。调试器真正要回答的问题只需要分清:这是一次模型调用吗(`llm`)?是一次工具调用吗(`tool`)?是一个把别的步骤包起来的容器吗(`agent`,整次 Agent 运行、一个子 Agent、一个工作流都算)?是检索吗(`retrieval`)?其余一律 `other`。分得粗,前端好写;哪天真的不够用了再细分,加一个值比合并两个值容易得多。

### 编辑器里的红线

我第一次写的时候,是直接调构造函数的:`Step(idx=0, kind="llm", name="x", started_at="2026-10-22T07:41:03Z", ...)`。跑起来完全没问题,pydantic 照样把字符串转成了时间。可 Zed 在 `started_at=` 下面画了红线,用 basedpyright 一查:

```text
error: Argument of type "Literal['2026-10-22T07:41:01Z']" cannot be assigned to parameter "ended_at" of type "UtcDatetime" in function "__init__"
    "Literal['2026-10-22T07:41:01Z']" is not assignable to "datetime" (reportArgumentType)
```

(这是我后面写完 `models.py` 以后查出来的,所以类型名是 `UtcDatetime`。)类型检查器只看签名:构造函数要的是 `datetime`,你给的是 `str`,它不知道 pydantic 在运行时会帮你转。全课的约定是文章里的代码 0 报错,所以分两种情况写:**数据从外面来**(JSON 文件、接口请求体),用 `Model.model_validate(字典)` 或 `Model.model_validate_json(字符串)`;**在代码里自己造**,就给真正的 `datetime` 对象。后面的导入器全是前一种。

## 第二步:时间必须带时区

时间是这两个模型里最容易出事的字段,值得单独一步。三种来源的时间格式都不一样:OTLP 是一个纳秒整数(Day 654 会看到),Langfuse 导出是带 `Z` 的 ISO 字符串,有些自己写的日志是不带时区的 `2026-10-22 15:41:03`。最后这种叫**naive datetime**(不带时区的时间,中文常叫「朴素时间」):它没说自己是哪个时区的 15 点。北京时间?UTC?读的人只能猜。

先看混进来会怎样:

```python
# agent-loupe/server/scratch/s2_naive.py
from datetime import datetime

from pydantic import BaseModel


class Span(BaseModel):
    started_at: datetime
    ended_at: datetime


a = Span.model_validate({"started_at": "2026-10-22 15:41:03", "ended_at": "2026-10-22T07:41:04Z"})
print(repr(a.started_at))
print(repr(a.ended_at))
print(a.ended_at - a.started_at)
```

<div class="line-notes">

- `class Span(BaseModel):` 只留两个时间字段,专门看时间。
- `a = Span.model_validate({"started_at": "2026-10-22 15:41:03", "ended_at": "2026-10-22T07:41:04Z"})` 开始时间是北京时间 15:41:03,但没写时区;结束时间是 UTC 的 07:41:04,也就是北京时间 15:41:04。按真实时间算,两者差 1 秒。
- `print(a.ended_at - a.started_at)` 相减。

</div>

```bash
uv run python -m scratch.s2_naive
```

```text
datetime.datetime(2026, 10, 22, 15, 41, 3)
datetime.datetime(2026, 10, 22, 7, 41, 4, tzinfo=TzInfo(0))
Traceback (most recent call last):
  ...
    print(a.ended_at - a.started_at)
          ~~~~~~~~~~~^~~~~~~~~~~~~~
TypeError: can't subtract offset-naive and offset-aware datetimes
```

第一行没有 `tzinfo`,第二行有。pydantic 两个都收了,`datetime` 类型并不要求带时区。等到相减时才炸:Python 拒绝在「不知道时区的时间」和「知道时区的时间」之间做运算。这还算运气好。更糟的情况是两个都不带时区但其实来自不同时区,减出来差 8 小时,不报任何错,瀑布图上一个工具调用拉成八个小时长。

所以 Loupe 的规矩是:**进门时必须带时区,进来以后一律转成 UTC**。pydantic 有现成的 `AwareDatetime` 类型(aware datetime,带时区的时间),不带时区直接拒收;再接一个「校验通过后转成 UTC」的小函数:

```python
# agent-loupe/server/scratch/s3_utc.py
from datetime import UTC, datetime
from typing import Annotated

from pydantic import AfterValidator, AwareDatetime, BaseModel, ValidationError


def to_utc(d: datetime) -> datetime:
    return d.astimezone(UTC)


UtcDatetime = Annotated[AwareDatetime, AfterValidator(to_utc)]


class Span(BaseModel):
    started_at: UtcDatetime
    ended_at: UtcDatetime


b = Span.model_validate({"started_at": "2026-10-22T15:41:03+08:00", "ended_at": "2026-10-22T07:41:04Z"})
print(b.model_dump_json())
print("耗时", (b.ended_at - b.started_at).total_seconds(), "秒")
print(sorted(["2026-10-22T15:41:03+08:00", "2026-10-22T07:41:04Z"]))

try:
    Span.model_validate({"started_at": "2026-10-22 15:41:03", "ended_at": "2026-10-22T07:41:04Z"})
except ValidationError as e:
    print(e)
```

<div class="line-notes">

- `from datetime import UTC, datetime` `UTC` 是 Python 3.11 起才有的常量,等于 `timezone.utc`。本机系统自带的 python3 是 3.10,没有它;我们用 uv 钉的 3.12,没问题。
- `def to_utc(d: datetime) -> datetime:` 一个普通函数:收一个带时区的时间,换算成 UTC 返回。
- `return d.astimezone(UTC)` `astimezone` 是「同一个时刻,换一个时区来表示」。`15:41:03+08:00` 换成 UTC 就是 `07:41:03+00:00`,时刻没变,写法变了。
- `UtcDatetime = Annotated[AwareDatetime, AfterValidator(to_utc)]` `Annotated[类型, 附加信息]` 给一个类型挂上额外说明。这里的意思是:先按 `AwareDatetime` 校验(必须带时区),通过以后再调一次 `to_utc`。≈ 给字段挂一个 transform。起个名字叫 `UtcDatetime`,后面所有时间字段都用它。
- `started_at: UtcDatetime` 字段类型换成新的这个。
- `b = Span.model_validate({"started_at": "2026-10-22T15:41:03+08:00", "ended_at": "2026-10-22T07:41:04Z"})` 开始时间这次带了 `+08:00`,写的是北京时间。
- `print(b.model_dump_json())` 输出 `{"started_at":"2026-10-22T07:41:03Z","ended_at":"2026-10-22T07:41:04Z"}`,两个时间都变成了 UTC 的写法。
- `print("耗时", (b.ended_at - b.started_at).total_seconds(), "秒")` 得到 `1.0` 秒,对了。
- `print(sorted(["2026-10-22T15:41:03+08:00", "2026-10-22T07:41:04Z"]))` 当成字符串排序会怎样?输出是 `['2026-10-22T07:41:04Z', '2026-10-22T15:41:03+08:00']`,先开始的那个反而排到了后面。Day 658 时间要存进 SQLite 的文本列、按它排序,如果库里混着不同时区的写法,排序就是错的。统一成 UTC 以后,字符串顺序就是时间顺序。
- `Span.model_validate({"started_at": "2026-10-22 15:41:03", "ended_at": "2026-10-22T07:41:04Z"})` 再喂一次不带时区的时间。

</div>

```bash
uv run python -m scratch.s3_utc
```

```text
{"started_at":"2026-10-22T07:41:03Z","ended_at":"2026-10-22T07:41:04Z"}
耗时 1.0 秒
['2026-10-22T07:41:04Z', '2026-10-22T15:41:03+08:00']
1 validation error for Span
started_at
  Input should have timezone info [type=timezone_aware, input_value='2026-10-22 15:41:03', input_type=str]
    For further information visit https://errors.pydantic.dev/2.14/v/timezone_aware
```

不带时区的时间在门口就被拒了,错误信息直接告诉你「应该带时区」。这样导入器写错的时候,你在测试里第一时间就知道,而不是三天后在时间轴上看到一根八小时长的横条。

那 Day 649 那种「离起点几秒」的相对时间怎么办?导入器自己负责把它变成绝对时间(起点时间加上秒数),模型只收绝对时间。待会儿把 Day 649 的记录装进来时就会这么做。

## 第三步:Step 的其余字段

类型和时间想清楚了,剩下的字段一个个过。我先把完整的 `models.py` 摆出来,再挑重要的展开。这个文件今天写完,后面的导入器、数据库、接口都 import 它。

```python
# agent-loupe/server/loupe/models.py
from collections import Counter
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, AwareDatetime, BaseModel, Field


def _to_utc(d: datetime) -> datetime:
    return d.astimezone(UTC)


UtcDatetime = Annotated[AwareDatetime, AfterValidator(_to_utc)]
StepKind = Literal["llm", "tool", "agent", "retrieval", "other"]


class Run(BaseModel):
    id: str
    name: str
    started_at: UtcDatetime
    ended_at: UtcDatetime
    status: Literal["ok", "error"] = "ok"
    model: str | None = None
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_cost_usd: float = 0.0
    tags: list[str] = Field(default_factory=list)
    parent_run_id: str | None = None
    forked_from_step: int | None = None


class Step(BaseModel):
    run_id: str
    idx: int
    parent_idx: int | None = None
    kind: StepKind
    name: str
    started_at: UtcDatetime
    ended_at: UtcDatetime
    input: Any = None
    output: Any = None
    error: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    cost_usd: float | None = None
    model: str | None = None


class Trace(BaseModel):
    run: Run
    steps: list[Step]


def normalize(run: Run, steps: list[Step]) -> Trace:
    ordered = sorted(steps, key=lambda s: (s.started_at, s.idx))
    new_idx = {s.idx: i for i, s in enumerate(ordered)}
    fixed: list[Step] = []
    for i, s in enumerate(ordered):
        parent = new_idx.get(s.parent_idx) if s.parent_idx is not None else None
        fixed.append(s.model_copy(update={"idx": i, "parent_idx": parent, "run_id": run.id}))

    models = [s.model for s in fixed if s.kind == "llm" and s.model]
    update: dict[str, Any] = {
        "total_input_tokens": run.total_input_tokens or sum(s.input_tokens or 0 for s in fixed),
        "total_output_tokens": run.total_output_tokens or sum(s.output_tokens or 0 for s in fixed),
        "total_cost_usd": run.total_cost_usd or round(sum(s.cost_usd or 0 for s in fixed), 6),
        "model": run.model or (Counter(models).most_common(1)[0][0] if models else None),
    }
    if fixed:
        update["started_at"] = min(run.started_at, fixed[0].started_at)
        update["ended_at"] = max(run.ended_at, max(s.ended_at for s in fixed))
    return Trace(run=run.model_copy(update=update), steps=fixed)
```

<div class="line-notes">

- `from collections import Counter` 计数器,`Counter(["a", "b", "a"]).most_common(1)` 得到 `[("a", 2)]`,用来找「用得最多的模型」。
- `def _to_utc(d: datetime) -> datetime:` 就是 `s3_utc.py` 里的 `to_utc`。名字前加下划线,表示「这个模块内部用的,别从外面 import」,≈ 不 export 的函数。
- `UtcDatetime = Annotated[AwareDatetime, AfterValidator(_to_utc)]` 第二步的成果,六个时间字段都用它。
- `StepKind = Literal["llm", "tool", "agent", "retrieval", "other"]` 第一步的成果。导入器要 import 它来标注自己的映射表。
- `class Run(BaseModel):` 一次运行,下一节专门讲。
- `id: str` 运行编号。OTLP 来的是 32 位十六进制的 traceId,Langfuse 来的是 UUID,自研 SDK 自己生成。都当字符串存,不解析。
- `status: Literal["ok", "error"] = "ok"` 只有两种。「跑到一半崩了」「被用户中断」都算 error,细节放在出错那一步的 `error` 里。
- `total_input_tokens: int = 0` 汇总字段默认 0,由 `normalize` 补。
- `tags: list[str] = Field(default_factory=list)` 每个 Run 一个新的空列表。为什么写 `default_factory`,下一节说。
- `parent_run_id: str | None = None` 重跑出来的运行指向原运行,Day 670 才会填。`str | None` ≈ TS 的 `string | null`,`= None` 表示可以不传。
- `forked_from_step: int | None = None` 从原运行的第几步分叉,也是 Day 670 用。
- `class Step(BaseModel):` 一步。
- `run_id: str` 属于哪次运行。导入器建 Step 时可能还不知道运行编号,先填空字符串,`normalize` 统一改。
- `idx: int` 第几步,从 0 开始。和 `run_id` 一起唯一确定一步,数据库主键就是 `(run_id, idx)`。
- `parent_idx: int | None = None` 父步骤的 `idx`。根步骤(最外层的那一步)没有父步骤,是 `None`。
- `kind: StepKind` 五选一。
- `name: str` 给人看的名字,比如 `chat deepseek-flash`、`execute_tool get_weather`。
- `input: Any = None` 这一步的输入,类型是 `Any`(什么都行),下面专门讲。
- `output: Any = None` 这一步的输出。
- `error: str | None = None` 出错时的错误信息,没出错是 `None`。
- `input_tokens: int | None = None` 只有 llm 步有。不是 llm 步、或者来源没记,都是 `None`。注意默认值是 `None` 不是 0,下面讲为什么。
- `cost_usd: float | None = None` 这一步花了多少美元。来源记了就用来源的;没记的话 Day 660 按价格表补。
- `model: str | None = None` 这一步用的模型。放在 Step 上而不只放在 Run 上,是因为一次运行里可能用好几个模型(便宜模型做路由、贵模型写回答)。
- `class Trace(BaseModel):` 一个 Run 加它的全部 Step,打包成一个对象。导入器的返回值就是它,也是存 JSON 文件的格式。
- `def normalize(run: Run, steps: list[Step]) -> Trace:` 三个导入器共用的收尾,第五步专门讲。

</div>

### `idx` 而不是 span ID

OTLP 的 spanId 是 16 位十六进制字符串,Langfuse 的 observation id 是 UUID。照理说直接拿它们当编号也行,为什么还要重新编一个 `idx`?

因为调试器里几乎所有操作说的都是「第几步」。时间轴的行号是第几步;Day 668 对比两条运行,要说「从第 7 步开始不一样」;Day 670 重跑,要说「从第 5 步分叉」;Day 660 分段加载,要说「给我第 200 到 299 步」。如果主键是随机的 span ID,这些地方全都要先把 ID 转成序号,转错一次就是一个难查的 bug。所以在导入时就转好:按开始时间排序,编成 0、1、2……,父步骤也指向编号。原始的 span ID 就不要了吗?需要的话可以塞进 `input` 里,到目前为止我没碰到要用它的地方。

### `input` 和 `output` 为什么是 `Any`

不同类型的步骤,输入输出长得完全不一样。工具步的输入是参数字典 `{"city": "Beijing"}`,输出是工具返回值;检索步的输入是查询文本,输出是一组文档;Agent 步可能根本没有输入输出。硬要给它们定一个统一的类型,要么定得很复杂,要么定得没意义。

所以模型层只说「什么都行」,但对最重要的 llm 步我们做一个约定,写在这里,后面好几天都要遵守:

- llm 步的 `input` 是 `{"messages": [...], "tools": [...]}`,`messages` 用全课从 [Day 121](/blog/agent-zero/day-121-api-request/) 起一直用的 OpenAI 消息格式(工具调用那几个字段是 [Day 159](/blog/agent-zero/day-159-tool-roundtrip/) 学的)(`role`、`content`、`tool_calls`、`tool_call_id`)。
- llm 步的 `output` 是一条 assistant 消息,同样的格式,包括 `tool_calls` 和 DeepSeek 的 `reasoning_content`。
- 来源没有记录内容时,`input` 和 `output` 都是 `None`,界面显示「这一步没有记录内容」。

Day 665 渲染消息、Day 666 算上下文里每块占多少、Day 668 比较两次的消息、Day 669 重建消息再发给模型,全都依赖这个约定。明天你会看到,OpenTelemetry 的消息格式和它不一样,要在导入器里转过来。

### `None` 和 0 不是一回事

`input_tokens` 默认 `None`,而 Run 的 `total_input_tokens` 默认 0。这两个默认值是故意不一样的。

一个工具步没有 token,它的 `input_tokens` 是「不适用」;一个 llm 步来源没记 token,它的 `input_tokens` 是「不知道」。这两种都不是「0 个 token」。如果默认写 0,前端在详情面板里会显示「输入 0 tokens」,用户以为模型什么都没收到。写 `None`,前端就能显示一个横杠。

Run 的汇总不一样,它是「加起来的结果」,一个都没有时加起来就是 0,写 0 没有歧义。`normalize` 里那句 `sum(s.input_tokens or 0 for s in fixed)` 就是把每一步的 `None` 当 0 去加。

## 第四步:Run 的字段

Run 的字段大半是给**列表页**用的。列表页要一次显示几十上百条运行,不可能为了显示「总 token」去把每条运行的一万步都读出来,所以汇总数字要算好存在 Run 上。`model` 是用得最多的那个模型,列表上显示一个就够,详情页里每一步有自己的。

`tags` 是筛选用的:`otlp`、`langfuse`、`day649` 这种来源标签导入器会自动加,用户自己也可以加 `prod`、`bug-123`。前面说的「会话」就靠它:同一段对话的几次运行打上同一个会话标签。

`parent_run_id` 和 `forked_from_step` 平时都是空的,只给 Day 670 的重跑用。现在就放进模型里,是因为改模型的代价会越来越高:Day 658 建表、Day 661 写前端类型以后再加字段,要同时改三处。早一点想到的字段,宁可先空着。

**`Field(default_factory=list)` 是怎么回事。** 前端同学可能听说过 Python 的一个经典坑:函数参数默认值写 `def f(x=[])`,这个列表只在定义时建一次,所有调用共用,改一次全变。pydantic 对字段默认值其实做了保护,写 `tags: list[str] = []` 也会给每个对象复制一份。但我还是写 `default_factory=list`:它明明白白地说「每次调用 `list()` 造一个新的」,读代码的人不用知道 pydantic 的内部行为,换到 dataclass([Day 50](/blog/agent-zero/day-050-dataclass/))里也同样正确。测试里有一条专门验证两个 Run 的 tags 互不影响。

**Run 的状态谁说了算。** 一步报错,整次运行是不是就是 error?不一定。Agent 调工具超时、重试一次成功了,这次运行是成功的,只是中间有一步报过错。所以 `normalize` 不根据步骤去改 `status`,由导入器根据来源的信息决定:OTLP 看根 span 的状态,自研 SDK 看有没有正常结束。练习 4 让你自己想这个问题。

## 第五步:normalize,排序、编号、补汇总

三种来源给的步骤顺序都不可靠。OTLP 文件里 span 的顺序取决于导出时机,往往是子 span 先结束先写出来,根 span 在最后;Langfuse 接口返回的顺序不保证;我们自己的 SDK(Day 655)也是一步结束了才写一行,父步骤比子步骤晚写。所以每个导入器最后都调同一个函数收尾:

- 按开始时间排序,重新编号成 0、1、2……
- 把 `parent_idx` 从旧编号翻译成新编号;
- 把每一步的 `run_id` 填成这次运行的 id;
- 补齐 Run 的汇总:总 token、总花费、主要模型、最早开始和最晚结束。

先用一个故意打乱的小例子看它做了什么:

```python
# agent-loupe/server/scratch/s4_normalize.py
from datetime import UTC, datetime

from loupe.models import Run, Step, normalize


def at(sec: int) -> datetime:
    return datetime(2026, 10, 22, 7, 41, sec, tzinfo=UTC)


run = Run(id="r1", name="weather", started_at=at(0), ended_at=at(0))
steps = [
    Step(run_id="", idx=7, parent_idx=3, kind="tool", name="get_weather(Beijing)",
         started_at=at(2), ended_at=at(6)),
    Step(run_id="", idx=3, kind="agent", name="weather_agent", started_at=at(0), ended_at=at(9)),
    Step(run_id="", idx=5, parent_idx=3, kind="llm", name="chat", model="deepseek-flash",
         started_at=at(1), ended_at=at(2), input_tokens=310, output_tokens=106),
]
trace = normalize(run, steps)
for s in trace.steps:
    print(s.idx, s.parent_idx, s.kind, s.name, s.run_id)
r = trace.run
print(r.started_at, r.ended_at, r.total_input_tokens, r.total_output_tokens, r.model)
print(steps[0].idx, steps[0].run_id == "")
```

<div class="line-notes">

- `def at(sec: int) -> datetime:` 造时间的小帮手,`at(2)` 就是 UTC 07:41:02。在代码里自己造对象,给真正的 `datetime`,类型检查不报错。
- `run = Run(id="r1", name="weather", started_at=at(0), ended_at=at(0))` 开始和结束先随便填同一个时间,`normalize` 会按步骤改。
- `Step(run_id="", idx=7, parent_idx=3, kind="tool", name="get_weather(Beijing)",` 编号故意是乱的(7、3、5),顺序也是乱的:工具步排第一,根步骤 agent 排第二。这就是 OTLP 文件里常见的样子。
- `Step(run_id="", idx=3, kind="agent", name="weather_agent", started_at=at(0), ended_at=at(9)),` 根步骤从 0 秒到 9 秒,包住其他两步。
- `trace = normalize(run, steps)` 收尾。
- `print(s.idx, s.parent_idx, s.kind, s.name, s.run_id)` 看新的编号和父子关系。
- `print(steps[0].idx, steps[0].run_id == "")` 原来的列表有没有被改?

</div>

```bash
uv run python -m scratch.s4_normalize
```

```text
0 None agent weather_agent r1
1 0 llm chat r1
2 0 tool get_weather(Beijing) r1
2026-10-22 07:41:00+00:00 2026-10-22 07:41:09+00:00 310 106 deepseek-flash
7 True
```

agent 排到了第 0 步,原来指向「3 号」的两个子步骤现在都指向 0;运行的结束时间被补成了 9 秒;总 token 和模型从 llm 步里加了出来。最后一行说明原来那个列表里的对象没被改,`idx` 还是 7。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="normalize 把乱序的三步按开始时间排好并重新编号,父步骤指向跟着翻译">
<rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)" rx="6"/>
<text x="20" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">导入器给的(乱序)</text>
<rect x="20" y="40" width="250" height="34" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="30" y="62" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">idx 7 · tool · parent 3 · 2s</text>
<rect x="20" y="82" width="250" height="34" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="30" y="104" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">idx 3 · agent · 根 · 0s</text>
<rect x="20" y="124" width="250" height="34" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="30" y="146" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">idx 5 · llm · parent 3 · 1s</text>
<line x1="275" y1="99" x2="365" y2="99" stroke="var(--ink-soft)" marker-end="url(#b652)"/>
<text x="320" y="90" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">normalize</text>
<text x="370" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">之后(按开始时间)</text>
<rect x="370" y="40" width="250" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="380" y="62" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">idx 0 · agent · 根</text>
<rect x="370" y="82" width="250" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="380" y="104" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">idx 1 · llm · parent 0</text>
<rect x="370" y="124" width="250" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="380" y="146" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">idx 2 · tool · parent 0</text>
<text x="320" y="196" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">旧→新编号表 {3: 0, 5: 1, 7: 2},parent 3 翻译成 0</text>
<defs><marker id="b652" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
</svg>
<figcaption>排序以后建一张「旧编号 → 新编号」的表,父步骤的指向查表翻译。排完以后,父步骤的编号一定比子步骤小。</figcaption>
</figure>

回到 `models.py` 里 `normalize` 那几行,逐行看(上面的 line-notes 只讲了字段,这里把函数体补上):

```python
    ordered = sorted(steps, key=lambda s: (s.started_at, s.idx))
    new_idx = {s.idx: i for i, s in enumerate(ordered)}
    fixed: list[Step] = []
    for i, s in enumerate(ordered):
        parent = new_idx.get(s.parent_idx) if s.parent_idx is not None else None
        fixed.append(s.model_copy(update={"idx": i, "parent_idx": parent, "run_id": run.id}))

    models = [s.model for s in fixed if s.kind == "llm" and s.model]
    update: dict[str, Any] = {
        "total_input_tokens": run.total_input_tokens or sum(s.input_tokens or 0 for s in fixed),
        "model": run.model or (Counter(models).most_common(1)[0][0] if models else None),
    }
    if fixed:
        update["started_at"] = min(run.started_at, fixed[0].started_at)
        update["ended_at"] = max(run.ended_at, max(s.ended_at for s in fixed))
    return Trace(run=run.model_copy(update=update), steps=fixed)
```

<div class="line-notes">

- `ordered = sorted(steps, key=lambda s: (s.started_at, s.idx))` `sorted` 返回一个新列表,不动原来的,≈ JS 的 `[...steps].sort(...)`。排序键是一个元组 `(开始时间, 原编号)`:先比开始时间,相同再比原编号。`lambda s: ...` 是一行的匿名函数,≈ `s => ...`。
- `new_idx = {s.idx: i for i, s in enumerate(ordered)}` 字典推导式,建「旧编号 → 新编号」的表。上面的例子里是 `{3: 0, 5: 1, 7: 2}`。`enumerate` 同时给出位置和元素,≈ `ordered.map((s, i) => ...)`。
- `parent = new_idx.get(s.parent_idx) if s.parent_idx is not None else None` 有父步骤就查表翻译。父步骤不在这批数据里(trace 被截断了)时,`.get` 返回 `None`,这一步就变成了一个新的根。
- `fixed.append(s.model_copy(update={"idx": i, "parent_idx": parent, "run_id": run.id}))` `model_copy(update=...)` 复制一个对象并改掉几个字段,≈ `{...s, idx: i, ...}`。原对象不变,所以上面输出的最后一行 `idx` 还是 7。注意它**不做校验**,练习 2 会让你亲眼看到。
- `models = [s.model for s in fixed if s.kind == "llm" and s.model]` 列表推导式加条件,≈ `fixed.filter(...).map(...)`。收集每个 llm 步的模型名。
- `"total_input_tokens": run.total_input_tokens or sum(s.input_tokens or 0 for s in fixed),` `a or b`:a 是「假」(0、None、空字符串)就取 b,≈ JS 的 `a || b`。来源自己给了总数就用来源的(比如 Langfuse 的 trace 上有总成本),没给就把每一步加起来。完整文件里输出 token 和花费也是同样的写法。
- `"model": run.model or (Counter(models).most_common(1)[0][0] if models else None),` 用得最多的模型。`most_common(1)` 返回 `[("deepseek-flash", 1)]`,`[0][0]` 取出名字。
- `update["started_at"] = min(run.started_at, fixed[0].started_at)` 排过序,第一步就是最早开始的。
- `update["ended_at"] = max(run.ended_at, max(s.ended_at for s in fixed))` 结束时间要扫一遍取最大:最后开始的那一步不一定最后结束,根步骤往往开始得最早、结束得最晚。

</div>

**这个函数保证了一条约定:父步骤的 `idx` 一定比子步骤小。** 原因很直接:父步骤包着子步骤,一定先开始,排序后就在前面。有一种边界情况,父子两步开始时间完全相同(时钟精度不够、或者框架在同一微秒里开了两个 span),这时排序键的第二项 `s.idx` 起作用,保持导入器给的原顺序;所以导入器在给原编号时要让父步骤在前,明天和后天写 OTLP 导入器时会注意这一点。

这条约定看着不起眼,后面好几处代码都靠它:Day 662 算树的缩进深度,Day 666 把子步骤的成本累加到父步骤上,都只需要从头到尾扫一遍数组,不用递归。练习 1 写一个检查器专门验证它。

## 第六步:把 Day 649 的那次运行装进来

模型写好了,拿真实数据试一次。把 Day 649 存下的记录复制到 Loupe 的 `samples/` 里:

```bash
cp /Users/你/agent-zero-lab/part11/runs/weather_run.json /Users/你/agent-loupe/samples/weather_run_day649.json
```

它是 Day 649 自己随手定的格式,不属于 Day 654 到 656 要支持的三种格式之一,所以不写正式的导入器,在草稿目录里写个一次性脚本:

```python
# agent-loupe/server/scratch/from_day649.py
import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

from loupe.models import Run, Step, normalize

src = Path(sys.argv[1])
data = json.loads(src.read_text(encoding="utf-8"))
raw = data["steps"]
total = max(s["end"] for s in raw)
t0 = datetime.fromtimestamp(src.stat().st_mtime, UTC) - timedelta(seconds=total)

steps = [
    Step(run_id="", idx=s["idx"], kind=s["kind"], name=s["name"],
         started_at=t0 + timedelta(seconds=s["start"]),
         ended_at=t0 + timedelta(seconds=s["end"]),
         input_tokens=s.get("input_tokens"), output_tokens=s.get("output_tokens"),
         model=s["name"] if s["kind"] == "llm" else None)
    for s in raw
]
run = Run(id=src.stem, name="weather_agent", started_at=t0, ended_at=t0, tags=["day649"])
trace = normalize(run, steps)
out = src.with_suffix(".trace.json")
out.write_text(trace.model_dump_json(indent=2), encoding="utf-8")
r = trace.run
print(f"{r.id}: {len(trace.steps)} 步,{(r.ended_at - r.started_at).total_seconds():.2f} 秒,"
      f"输入 {r.total_input_tokens} / 输出 {r.total_output_tokens} tokens,模型 {r.model}")
print(f"存到 {out}")
```

<div class="line-notes">

- `src = Path(sys.argv[1])` 从命令行拿文件路径。
- `total = max(s["end"] for s in raw)` 最后结束的时间,这次是 `17.34` 秒。
- `t0 = datetime.fromtimestamp(src.stat().st_mtime, UTC) - timedelta(seconds=total)` Day 649 的记录里没有绝对时间,只能猜:文件最后修改的时刻大约就是运行结束的时刻,往前推 17.34 秒当起点。`st_mtime` 是文件的修改时间(从 1970 年起的秒数),`fromtimestamp(..., UTC)` 把它变成带时区的时间。这一行就是「缺了绝对时间」要付的代价:我用 `cp` 复制过文件,修改时间变成了复制的那一刻,起点就偏了。
- `Step(run_id="", idx=s["idx"], kind=s["kind"], name=s["name"],` `kind` 来自字典,类型检查器只知道它是某个值,不知道是不是那五种之一;pydantic 在运行时会校验。Day 649 只用了 `llm` 和 `tool`,能通过。
- `started_at=t0 + timedelta(seconds=s["start"]),` 相对时间变绝对时间:起点加上秒数。`timedelta` 是时间间隔,能和 `datetime` 相加。
- `input_tokens=s.get("input_tokens"), output_tokens=s.get("output_tokens"),` 工具步没有这两个键,`.get` 返回 `None`,正好是我们要的「不适用」。
- `model=s["name"] if s["kind"] == "llm" else None)` Day 649 把模型名写在了 `name` 里,llm 步就从那里拿。
- `run = Run(id=src.stem, name="weather_agent", started_at=t0, ended_at=t0, tags=["day649"])` `src.stem` 是去掉扩展名的文件名 `weather_run_day649`,当运行编号。
- `out.write_text(trace.model_dump_json(indent=2), encoding="utf-8")` `model_dump_json(indent=2)` 转成带缩进的 JSON,嵌套的 Run 和 Step 都会展开。
- `print(f"{r.id}: {len(trace.steps)} 步,{(r.ended_at - r.started_at).total_seconds():.2f} 秒,"` 打一行摘要,和 Day 649 的瀑布图对一下。

</div>

```bash
cd /Users/你/agent-loupe/server
uv run python -m scratch.from_day649 ../samples/weather_run_day649.json
```

```text
weather_run_day649: 5 步,17.34 秒,输入 799 / 输出 192 tokens,模型 deepseek-flash
存到 ../samples/weather_run_day649.trace.json
```

17.34 秒和 Day 649 瀑布图最后一行一致;输入 310 + 489 = 799,输出 106 + 86 = 192,`normalize` 加对了。打开生成的文件看第 0 步:

```json
{
  "run_id": "weather_run_day649",
  "idx": 0,
  "parent_idx": null,
  "kind": "llm",
  "name": "deepseek-flash",
  "started_at": "2026-10-22T15:48:47.407175Z",
  "ended_at": "2026-10-22T15:48:48.447175Z",
  "input": null,
  "output": null,
  "error": null,
  "input_tokens": 310,
  "output_tokens": 106,
  "cost_usd": null,
  "model": "deepseek-flash"
}
```

`input` 和 `output` 是 `null`。字段都有了,数据没有,因为 Day 649 根本没记。这条记录在 Loupe 里能画时间轴,但点开任何一步都只能看到「这一步没有记录内容」。要让每一步的 messages 都在,得在记录时就存下来:明天开始看 OpenTelemetry 怎么记,Day 656 给我们自己的 Agent 加上完整的记录。

`total_cost_usd` 是 0.0,因为 Day 649 没记花费,Day 660 的价格表会补上。

## 用测试钉住约定

今天定下的每条规矩都写成一个测试。以后谁(包括三周后的你)改了 `models.py`,破坏了哪条约定,测试立刻红。

```python
# agent-loupe/server/tests/test_models.py
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from loupe.models import Run, Step, normalize

T = "2026-10-22T07:41:0{}Z"


def at(sec: int) -> datetime:
    return datetime(2026, 10, 22, 7, 41, sec, tzinfo=UTC)


def make_step(idx: int, start: int, end: int, **kw: object) -> Step:
    return Step.model_validate({"run_id": "", "idx": idx, "kind": "tool", "name": f"s{idx}",
                                "started_at": T.format(start), "ended_at": T.format(end), **kw})


def test_kind_must_be_one_of_five() -> None:
    with pytest.raises(ValidationError):
        make_step(0, 0, 1, kind="LLM")


def test_naive_time_rejected_and_offset_converted_to_utc() -> None:
    with pytest.raises(ValidationError):
        Step.model_validate({"run_id": "r", "idx": 0, "kind": "llm", "name": "x",
                             "started_at": "2026-10-22 15:41:03", "ended_at": T.format(4)})
    s = make_step(0, 0, 1, started_at="2026-10-22T15:41:03+08:00")
    assert s.started_at.isoformat() == "2026-10-22T07:41:03+00:00"


def test_normalize_sorts_renumbers_and_remaps_parents() -> None:
    run = Run(id="r1", name="w", started_at=at(0), ended_at=at(0))
    steps = [make_step(7, 2, 6, parent_idx=3),
             make_step(3, 0, 9, kind="agent"),
             make_step(5, 1, 2, parent_idx=3, kind="llm", model="m", input_tokens=310, output_tokens=106)]
    trace = normalize(run, steps)
    assert [(s.idx, s.parent_idx, s.kind) for s in trace.steps] == [(0, None, "agent"), (1, 0, "llm"), (2, 0, "tool")]
    assert all(s.run_id == "r1" for s in trace.steps)
    assert all(s.parent_idx is None or s.parent_idx < s.idx for s in trace.steps)
    assert (trace.run.total_input_tokens, trace.run.total_output_tokens, trace.run.model) == (310, 106, "m")
    assert trace.run.ended_at.second == 9


def test_normalize_keeps_status_and_given_totals() -> None:
    run = Run(id="r1", name="w", started_at=at(0), ended_at=at(1), total_input_tokens=999)
    trace = normalize(run, [make_step(0, 0, 1, error="ConnectTimeout", input_tokens=5)])
    assert trace.run.status == "ok"
    assert trace.run.total_input_tokens == 999


def test_tags_not_shared_between_runs() -> None:
    a = Run(id="a", name="a", started_at=at(0), ended_at=at(1))
    b = Run(id="b", name="b", started_at=at(0), ended_at=at(1))
    a.tags.append("x")
    assert b.tags == []
```

<div class="line-notes">

- `T = "2026-10-22T07:41:0{}Z"` 时间模板,`T.format(3)` 得到 `"2026-10-22T07:41:03Z"`。`format` 把 `{}` 换成参数,≈ 模板字符串。
- `def make_step(idx: int, start: int, end: int, **kw: object) -> Step:` 造一个步骤,大部分字段有默认值,想改哪个就传哪个。`**kw` 收集所有额外的关键字参数成一个字典,≈ JS 的 `...rest`。
- `return Step.model_validate({"run_id": "", "idx": idx, "kind": "tool", "name": f"s{idx}",` 这里的时间是字符串(模拟从 JSON 来),所以用 `model_validate`。
- `"started_at": T.format(start), "ended_at": T.format(end), **kw})` 字典里的 `**kw` 把额外参数展开合并进来,后写的覆盖前写的,≈ `{...defaults, ...kw}`。传 `kind="agent"` 就覆盖了默认的 `"tool"`。
- `with pytest.raises(ValidationError):` 断言里面的代码**一定**抛这个异常,不抛测试就失败。
- `assert s.started_at.isoformat() == "2026-10-22T07:41:03+00:00"` 北京时间 15:41:03 进来,出来是 UTC 07:41:03。
- `assert all(s.parent_idx is None or s.parent_idx < s.idx for s in trace.steps)` 「父编号比子编号小」这条约定。`all(...)` 全部为真才为真,≈ `steps.every(...)`。
- `assert trace.run.ended_at.second == 9` 运行的结束时间被补成了根步骤的结束时间。
- `def test_normalize_keeps_status_and_given_totals() -> None:` 两件事:有一步报错,运行状态照样是 ok;来源给了总数 999,不被步骤的 5 覆盖。
- `a.tags.append("x")` 改 a 的标签,b 不受影响。

</div>

```bash
cd /Users/你/agent-loupe/server
uv run pytest -q
```

```text
......                                                                   [100%]
6 passed in 1.91s
```

6 个:Day 651 的健康检查 1 个,今天 5 个。我也用 basedpyright(standard 档)查过 `loupe/`、`tests/`、`scratch/`,0 个错误。

## 零件和成品的对照

| 今天的小脚本 | 进了 `models.py` 的哪一段 |
| --- | --- |
| `s1_step.py` 的 `StepKind` 和五个字段 | `StepKind`、`Step` 的前几个字段 |
| `s2_naive.py` 的报错 | 没有代码,换来了「时间必须带时区」这条规矩 |
| `s3_utc.py` 的 `to_utc` 和 `UtcDatetime` | `_to_utc`、`UtcDatetime`,六个时间字段 |
| `s4_normalize.py` | 演示 `normalize`,也是测试 `test_normalize_sorts_renumbers_and_remaps_parents` 的原型 |
| `from_day649.py` | 不进 `models.py`,是第一个「把外部格式变成 Trace」的脚本,Day 654 起的导入器都是这个形状 |

## 今天的文件

| 文件 | 干什么 | 新建还是修改 |
| --- | --- | --- |
| `server/loupe/models.py` | Run、Step、Trace 和 normalize | 新建 |
| `server/tests/test_models.py` | 五条约定的测试 | 新建 |
| `server/pyproject.toml`、`uv.lock` | 加了 pydantic | 修改 |
| `.gitignore` | 加 `server/scratch/` | 修改 |
| `samples/weather_run_day649.json` | Day 649 的原始记录 | 复制 |
| `samples/weather_run_day649.trace.json` | 装进新模型以后的样子 | 生成 |
| `server/scratch/s1_step.py` 到 `s4_normalize.py`、`from_day649.py` | 今天的小实验 | 新建,不提交 |
| `server/scratch/ex652_*.py`(练习) | 练习参考答案 | 新建,不提交 |

今天不调模型,花费 0(开头重跑 Day 649 的脚本那一次约 ¥0.0025,不算今天的)。

## 动手练习

**练习 1:写一个 Trace 自检器。** 写 `scratch/ex652_check.py`:读一个 `.trace.json` 文件,检查四条约定:每一步的 `idx` 等于它在列表里的位置;`run_id` 都等于运行的 id;父编号在 0 和自己的编号之间;结束不早于开始。对今天生成的 `weather_run_day649.trace.json` 跑一遍,再故意改坏一份跑一遍。

<details><summary>参考答案</summary>

```python
# agent-loupe/server/scratch/ex652_check.py
import sys
from pathlib import Path

from loupe.models import Trace


def check(trace: Trace) -> list[str]:
    problems: list[str] = []
    for i, s in enumerate(trace.steps):
        if s.idx != i:
            problems.append(f"第 {i} 个步骤的 idx 是 {s.idx}")
        if s.run_id != trace.run.id:
            problems.append(f"步骤 {s.idx} 的 run_id 是 {s.run_id!r}")
        if s.parent_idx is not None and not 0 <= s.parent_idx < s.idx:
            problems.append(f"步骤 {s.idx} 的父步骤 {s.parent_idx} 不在它前面")
        if s.ended_at < s.started_at:
            problems.append(f"步骤 {s.idx} 结束早于开始")
    return problems


if __name__ == "__main__":
    for name in sys.argv[1:]:
        trace = Trace.model_validate_json(Path(name).read_text(encoding="utf-8"))
        found = check(trace)
        print(f"{Path(name).name}: {len(found)} 个问题")
        for p in found:
            print("  -", p)
```

<div class="line-notes">

- `for i, s in enumerate(trace.steps):` 同时拿到位置 `i` 和步骤 `s`。
- `if s.idx != i:` 编号必须连续,从 0 开始。Day 660 分段加载「第 200 到 299 步」靠的就是这一条。
- `problems.append(f"步骤 {s.idx} 的 run_id 是 {s.run_id!r}")` `{x!r}` 用 `repr` 显示,字符串会带上引号,空字符串显示成 `''`,一眼能看出来。
- `if s.parent_idx is not None and not 0 <= s.parent_idx < s.idx:` 连写比较 `0 <= p < idx`,≈ `p >= 0 && p < idx`。
- `if s.ended_at < s.started_at:` 两个 `datetime` 可以直接比大小。
- `trace = Trace.model_validate_json(Path(name).read_text(encoding="utf-8"))` 从 JSON 字符串直接建对象,嵌套的 Run 和 Step 一起校验,时间字符串也一起转回 `datetime`。

</div>

造一份坏的:

```python
# agent-loupe/server/scratch/ex652_break.py
import json
from pathlib import Path

d = json.loads(Path("../samples/weather_run_day649.trace.json").read_text(encoding="utf-8"))
d["steps"][2]["ended_at"] = "2026-10-22T15:48:40Z"
d["steps"][3]["parent_idx"] = 4
d["steps"][4]["idx"] = 9
Path("scratch/broken.trace.json").write_text(json.dumps(d, indent=2), encoding="utf-8")
```

<div class="line-notes">

- `d["steps"][2]["ended_at"] = "2026-10-22T15:48:40Z"` 第 2 步开始于 15:48:52 左右,结束时间改到它之前。
- `d["steps"][3]["parent_idx"] = 4` 让第 3 步的父步骤是后面的第 4 步。
- `d["steps"][4]["idx"] = 9` 编号跳号。

</div>

```bash
uv run python -m scratch.ex652_break
uv run python -m scratch.ex652_check ../samples/weather_run_day649.trace.json scratch/broken.trace.json
```

```text
weather_run_day649.trace.json: 0 个问题
broken.trace.json: 3 个问题
  - 步骤 2 结束早于开始
  - 步骤 3 的父步骤 4 不在它前面
  - 第 4 个步骤的 idx 是 9
```

三处改坏都被抓到了。注意模型本身没拦住它们:pydantic 只检查单个字段的类型,「结束不早于开始」「父在子前」是跨字段、跨步骤的规则。这种规则可以写成 pydantic 的模型校验器,但我放在单独的函数里,因为 `normalize` 之前的数据本来就不满足它们(编号是乱的),只有 `normalize` 之后才该成立。Day 654 的导入测试会用它检查导入结果。

</details>

**练习 2:`model_copy` 不校验。** 写一个脚本,对一个合法的 Step 用 `model_copy(update={"kind": "LLM", "idx": "3"})`,看看能不能成功、得到的对象长什么样;再把它 `model_dump()` 出来交给 `Step.model_validate` 会怎样。

<details><summary>参考答案</summary>

```python
# agent-loupe/server/scratch/s5_copy.py
from datetime import UTC, datetime

from loupe.models import Step

t = datetime(2026, 10, 22, 7, 41, 0, tzinfo=UTC)
s = Step(run_id="r1", idx=0, kind="llm", name="chat", started_at=t, ended_at=t)
bad = s.model_copy(update={"kind": "LLM", "idx": "3"})
print(repr(bad.kind), repr(bad.idx))
try:
    Step.model_validate(bad.model_dump())
except Exception as e:
    print(type(e).__name__, str(e).splitlines()[0])
```

<div class="line-notes">

- `bad = s.model_copy(update={"kind": "LLM", "idx": "3"})` 大写的 kind、字符串的 idx。`update` 的类型是普通字典,类型检查器也管不到里面的值。
- `print(repr(bad.kind), repr(bad.idx))` 看它们到底存成了什么。
- `Step.model_validate(bad.model_dump())` 转成字典再正规地校验一次。

</div>

```bash
uv run python -m scratch.s5_copy
```

```text
UserWarning: Pydantic serializer warnings:
  PydanticSerializationUnexpectedValue(Expected `int` - serialized value may not be as expected [field_name='idx', input_value='3', input_type=str])
'LLM' '3'
ValidationError 1 validation error for Step
```

`model_copy` 一声不吭地造出了一个 `kind` 是 `'LLM'`、`idx` 是字符串 `'3'` 的对象,只有在序列化时 pydantic 打了一条警告。这就是 `normalize` 里用 `model_copy` 时要小心的地方:它只适合填我们自己算出来、类型肯定对的值(新编号、运行 id)。从外部数据来的值,一定走 `model_validate`。

</details>

**练习 3:给前端导出 JSON Schema。** Day 661 要写前端的 TypeScript 类型。先用 `Trace.model_json_schema()` 把模型导出成 JSON Schema 存到 `docs/trace.schema.json`,看看 `kind`、`started_at`、`parent_idx`、`input` 四个字段分别变成了什么。

<details><summary>参考答案</summary>

```python
# agent-loupe/server/scratch/ex652_schema.py
import json
from pathlib import Path

from loupe.models import Trace

schema = Trace.model_json_schema()
out = Path("../docs/trace.schema.json")
out.write_text(json.dumps(schema, ensure_ascii=False, indent=2), encoding="utf-8")
step = schema["$defs"]["Step"]["properties"]
for name in ("kind", "started_at", "parent_idx", "input"):
    print(name, json.dumps(step[name], ensure_ascii=False))
print("必填:", schema["$defs"]["Step"]["required"])
```

<div class="line-notes">

- `schema = Trace.model_json_schema()` pydantic 根据类型标注生成 JSON Schema,一个描述 JSON 长什么样的标准格式。
- `step = schema["$defs"]["Step"]["properties"]` 嵌套的模型放在 `$defs` 里,`Trace` 里用 `$ref` 引用它们。
- `print("必填:", schema["$defs"]["Step"]["required"])` 没有默认值的字段就是必填。

</div>

```bash
uv run python -m scratch.ex652_schema
```

```text
kind {"enum": ["llm", "tool", "agent", "retrieval", "other"], "title": "Kind", "type": "string"}
started_at {"format": "date-time", "title": "Started At", "type": "string"}
parent_idx {"anyOf": [{"type": "integer"}, {"type": "null"}], "default": null, "title": "Parent Idx"}
input {"default": null, "title": "Input"}
必填: ['run_id', 'idx', 'kind', 'name', 'started_at', 'ended_at']
```

对着它就能写出 TS 类型:`kind` 是五个字符串的联合类型;`started_at` 是 `string`(JSON 里没有日期类型,前端拿到是 ISO 字符串);`parent_idx` 是 `number | null`;`input` 什么约束都没有,对应 TS 的 `unknown`。必填的六个字段在 TS 里不加问号。Day 661 会决定是手写这些类型还是用工具从 schema 生成。

</details>

**练习 4:运行状态该不该跟着步骤变。** 我们的 `normalize` 不会因为某一步有 `error` 就把运行改成 error。举一个例子说明这样做对,再举一个例子说明只看根步骤会漏掉问题,最后说说你会怎么在界面上弥补。

<details><summary>参考答案</summary>

这样做对的例子:天气 Agent 查广州时 Open-Meteo 超时,工具步记了 `ConnectTimeout`,Agent 按 [Day 170](/blog/agent-zero/day-170-agent-full/) 的错误处理重试一次成功了,最后给出了正确的平均气温。这次运行是成功的,标成 error 会让「失败率」虚高,真正失败的运行反而被淹没。

只看根步骤会漏的例子:Agent 把工具报错吞掉了,自己编了一个广州的气温,根步骤正常结束,状态 ok。数据上它是成功,实际上答错了。

我的弥补:不改 `status` 的含义(它只回答「运行有没有正常结束」),在列表页另加一个「有 N 步报错」的小标记,数字由步骤的 `error` 数出来;Day 660 的接口可以在运行列表里顺带返回这个数。「答没答对」是评测的事,Day 672 把这种运行存成评测用例。一个字段只回答一个问题,比让 `status` 身兼数职好查得多。

</details>

**验收标准**:`server/` 下 `uv run pytest -q` 6 passed;`from_day649.py` 打出 5 步、和你自己 Day 649 瀑布图一致的总时长和 token 合计;`ex652_check.py` 对正常文件 0 个问题、对改坏的文件报出三处;能不看文章说出 `Step` 的十四个字段,以及 `idx`、`UtcDatetime`、`None` 默认值、`normalize` 各自为什么这样设计。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| Run | Loupe 里的「一次运行」,一个 Agent 从收到任务到给出结果的全过程 |
| Step | 运行里的一步:一次模型调用、一次工具调用、一个子 Agent 等 |
| StepKind | 步骤类型,只有 llm、tool、agent、retrieval、other 五种 |
| Literal | Python 的类型,表示「只能是这几个值之一」,≈ TS 的字符串字面量联合类型 |
| naive datetime | 不带时区的时间,不知道是哪个时区的几点 |
| aware datetime | 带时区的时间,比如 `07:41:03+00:00`;pydantic 里对应 `AwareDatetime` |
| UTC | 协调世界时,零时区;北京时间 = UTC + 8 小时 |
| ISO 8601 | 时间的标准文本写法,如 `2026-10-22T07:41:03Z`,结尾 `Z` 表示 UTC |
| timedelta | Python 的时间间隔,两个时间相减得到它,也能和时间相加 |
| Annotated | 给类型挂附加信息的写法,pydantic 用它挂额外的校验和转换 |
| AfterValidator | pydantic 的校验器,在类型校验通过以后再调一个函数处理值 |
| model_validate | pydantic 从字典建对象并校验,外部数据的正规入口;`model_validate_json` 从 JSON 字符串建 |
| model_copy | 复制一个 pydantic 对象并改几个字段,不做校验 |
| normalize | Loupe 导入器的统一收尾:排序、重新编号、翻译父指向、补汇总 |
| JSON Schema | 描述 JSON 数据结构的标准格式,可以由 pydantic 模型生成 |

## 常见误区

**用原始的 span ID 当编号。** 能用,但对比、重跑、分页说的全是「第几步」,到时候到处要把 ID 转成序号。入口处转一次,后面全省事。

**时间字段只写 `datetime`。** 它不拒绝不带时区的时间。混进来以后,要么相减时报 `TypeError: can't subtract offset-naive and offset-aware datetimes`,要么两边都不带时区但来自不同时区,差 8 小时还不报错。用 `AwareDatetime` 在门口拦,进来统一转 UTC。

**时区不统一就存成字符串排序。** `"2026-10-22T15:41:03+08:00"` 和 `"2026-10-22T07:41:04Z"` 按字符串排,先发生的排在了后面。统一成 UTC 以后字符串顺序才等于时间顺序。

**没有 token 就写 0。** 0 是「零个」,`None` 是「不适用」或「不知道」。工具步写 0 tokens,详情面板会误导人。

**用构造函数传字符串时间。** 运行没问题,编辑器画红线:类型检查器不知道 pydantic 会转换。外部数据用 `model_validate`,代码里自己造就给 `datetime` 对象。

**以为 `model_copy` 会校验。** 它不会,`kind="LLM"` 也能塞进去。只用它改自己算出来的、类型确定的值。

**一步报错就把运行标成失败。** Agent 重试成功的运行会被算成失败,失败率虚高。`status` 只回答「有没有正常结束」,报错步数单独统计。

**为了一个暂时用不上的信息改模型。** 模型是地基,改一个字段要连带改表、接口、前端类型。能放进 `input`/`output` 的扩展信息先放进去,确定稳定了再升级成正式字段;反过来,像 `parent_run_id` 这种确定会用、只是晚几天用的字段,今天就加上。

## 学习资料

### 文档与文章

- [pydantic:Models](https://docs.pydantic.dev/latest/concepts/models/):`model_validate`、`model_copy`、`model_dump_json` 的官方说明,重点看 model_copy 那一段里「不校验」的提示,20 分钟。
- [pydantic:Validators](https://docs.pydantic.dev/latest/concepts/validators/):`AfterValidator` 和 `Annotated` 的写法,还有 Before/Wrap 几种校验器的区别,15 分钟。
- [pydantic:Types](https://docs.pydantic.dev/latest/api/types/):在页面里搜 `AwareDatetime`,看它和 `NaiveDatetime`、`PastDatetime` 这一组类型,5 分钟。
- [pydantic:JSON Schema](https://docs.pydantic.dev/latest/concepts/json_schema/):练习 3 用到的 `model_json_schema`,10 分钟。
- [Python 文档:datetime](https://docs.python.org/3/library/datetime.html):读开头 Aware and Naive Objects 一节,把今天那个 `TypeError` 的来历弄清楚,10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1JKmeY9ED2&autoplay=0&high_quality=1" title="[Python] Pydantic 让数据结构与验证融为一体" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>隔壁的程序员老王 · [Python] Pydantic 让数据结构与验证融为一体 · 10 分钟。快速过一遍 BaseModel、类型校验和报错长什么样,忘了 Day 51 的内容就先看这个。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1wm421G7Go&autoplay=0&high_quality=1" title="Pydantic教程：解决Python的最大问题 - pixegami" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>黑纹白斑马(搬运 pixegami)· Pydantic教程:解决Python的最大问题 · 11 分钟,中文字幕。讲为什么动态类型的 Python 需要运行时校验,正好对应今天 kind 写错在导入时就被拦下的那一幕。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/i4jespFbA1c" title="Pydantic Introduction - Models, Fields, Constrained Types, Validator Functions and Model Exports" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>BugBytes · Pydantic Introduction - Models, Fields, Constrained Types, Validator Functions and Model Exports · 英文。看 Field、校验器函数和导出那几段,和今天的 default_factory、AfterValidator、model_dump_json 对照。</figcaption>
</figure>

### 书籍

- **Robust Python**,Patrick Viafore,O'Reilly,2021。第 14 章 Runtime Checking With pydantic 专讲 pydantic,包括「校验和解析的区别」,正好解释今天字符串被转成时间这件事;前面讲类型标注和 Literal 的几章也值得翻。
- **Designing Data-Intensive Applications**,Martin Kleppmann,O'Reilly,2017。第 4 章 Encoding and Evolution 讲数据格式变了以后新旧代码怎么兼容,对应今天「模型是地基、改字段代价高」的判断,读前半章,约 40 分钟。

### 开源项目与代码

- [pydantic/pydantic](https://github.com/pydantic/pydantic):在仓库里搜 `AwareDatetime` 看它的实现和测试,看一个成熟项目怎么测「拒收不带时区的时间」。
- [langfuse/langfuse](https://github.com/langfuse/langfuse):Langfuse 的数据模型里 trace 和 observation 有哪些字段,和我们的 Run/Step 对照,看看它多了哪些、我们为什么不要。

## 自测

1. `Step` 的主键为什么是 `(run_id, idx)`,而不是来源里的 span ID?

<details><summary>答案</summary>

调试器的操作几乎都以「第几步」为单位:时间轴行号、对比时「从第 7 步开始不同」、重跑时「从第 5 步分叉」、分页加载「第 200 到 299 步」。用 span ID 当主键,这些地方都要在 ID 和序号之间来回转换。导入时按开始时间排序、编成连续的 0、1、2……,一劳永逸。

</details>

2. 一条来自日志的时间是 `2026-10-22 15:41:03`,导入 Loupe 时会怎样?为什么这样设计?

<details><summary>答案</summary>

被 `AwareDatetime` 拒收,报 `Input should have timezone info`。不带时区的时间不知道是哪个时区的,和带时区的时间相减会抛 `TypeError`;更糟的是两个都不带时区但来自不同地方,差 8 小时不报错。在门口拦下,让导入器负责补上正确的时区。带时区的时间进来以后统一转成 UTC,这样存成字符串排序时顺序也对。

</details>

3. 工具步的 `input_tokens` 为什么是 `None` 而不是 0?Run 的 `total_input_tokens` 为什么又默认 0?

<details><summary>答案</summary>

工具步没有 token 是「不适用」,llm 步来源没记是「不知道」,都不是「零个」。写 0 会让详情面板显示「输入 0 tokens」,误导人以为模型什么都没收到。Run 的汇总是加出来的结果,一个都没有时总和就是 0,没有歧义;`normalize` 加的时候把每一步的 `None` 当 0。

</details>

4. `normalize` 保证了一条什么约定?它在什么情况下可能被破坏,怎么防?

<details><summary>答案</summary>

父步骤的 `idx` 一定小于子步骤,因为父步骤先开始,排序后在前面。父子开始时间完全相同时,排序键的第二项(原编号)决定先后,所以要求导入器给原编号时父在前。后面算树深度、自底向上累加成本都依赖它,只扫一遍数组。练习 1 的检查器可以在导入测试里验证这条约定。

</details>

5. 面试题:你的调试器要支持三种来源格式,而且其中一种(OpenTelemetry GenAI 约定)还在变。你怎么设计数据模型,让格式变化不至于牵动整个系统?

<details><summary>答案</summary>

定一个自己的内部模型(Run/Step),外部格式只在导入器里出现,导入时就转换成内部模型;数据库、接口、前端、对比、重跑全都只依赖内部模型。外部规范改了字段名,只改一个导入器,内部模型不动。内部模型本身要稳:字段少而必要,类型严格(kind 只许五种、时间必须带时区),对暂时说不清的数据留开放字段(input/output 是 Any,只对 llm 步约定格式),先放进去观察,确定稳定了再升级成正式字段。最后用测试把约定钉住,规范升级时先跑测试就知道哪里断了。

</details>

6. 面试题:「一步报错,整次运行就算失败」这个规则有什么问题?

<details><summary>答案</summary>

Agent 经常重试或绕过失败的工具,中间有报错不等于结果失败。按这个规则,失败率会虚高,真正失败的运行被淹没。反过来,Agent 吞掉错误编了个答案,所有步骤都没报错,也不代表成功。所以我把三件事分开:`status` 只回答有没有正常结束;报错步数单独统计显示;答没答对交给评测。

</details>

## 明天预告

明天是 Day 653,Loupe(二):OTel GenAI 语义约定。今天的 `Step` 里 `kind` 只有五种,llm 步的 `input` 约定成 OpenAI 消息格式。可是别人用 OpenTelemetry 记下的 trace,操作名有十八种,消息是一种叫 `parts` 的结构,很多时候根本没记消息原文。明天把 2026 年 10 月这份约定读一遍,用 DeepSeek 真跑一次自动埋点,看它到底记了什么、没记什么,写出把它映射到 Run/Step 的那张表和转换函数。
