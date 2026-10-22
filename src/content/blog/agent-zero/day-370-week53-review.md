---
title: 'Day 370 · 第 53 周复习:评测与可观测(Day 364–369)'
description: '这一周前四天把 trace 接上、看懂、管好,后两天让程序自己改 prompt。今天默写三段:span 记录器、脱敏函数、反思循环,各自和原版对一遍;默写记录器时还踩到一个坑:去掉 finally 以后,我写的检查一开始居然没发现。小项目给反思循环挂上 span,画瀑布图算视图:最慢的一步是反思,最贵的却是评测,反思只占 7% 的钱。'
pubDate: 2026-10-23
regime: none
tags: ['eval', 'observability', 'review', 'agent-zero']
series: 'agent-zero'
day: 370
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 369](/blog/agent-zero/day-369-prompt-opt-2/) 用 60 条工单实测了两种自动优化。60 行的自写反思循环从只有类别名的 BARE 出发,测试集 80% 到 90%,refund 的定义几乎一字不差地从 `why` 理由里学了回来,同时学了一条「钱优先」的宽规则,把 t33 带成了 billing。DSPy 的 GEPA 从 BARE 出发,验证集涨了 5 个点,测试集没动,新指令里「重复扣款」四个字被改丢了;从 BASE 出发它选回了原样。另外,光是把 BASE 放进 DSPy 的结构化格式,测试集就从 90% 到了 95%。

这一周的六课分两半:前四天是 tracing,后两天是自动优化提示词。看起来不相干,其实是一条线:trace 告诉你 Agent 每一步干了什么、花了多少;评测分数告诉你它干得对不对;优化器拿着分数去改 prompt,而优化器自己也是一个要花钱、要被观察的程序。今天把这条线串起来。

## 今天要解决的问题

学完今天,你应该能:

1. 说出这一周每一课在「看清 Agent → 改进 Agent」这件事里管哪一块。
2. 合上文章默写 Day 364 的 span 记录器,在同一段嵌套代码上和原版的父子关系完全一致,并说清楚 `finally` 为什么不能少。
3. 合上文章默写 Day 367 的 `mask`,在 6 个正反样本上和原版 0 个不一致。
4. 合上文章默写 Day 369 的反思循环,从 BARE 起步跑通。
5. 用本周知识拼一个小项目:给反思循环挂上 span,画瀑布图,算出最慢、最贵的步骤和每类步骤的花费占比。

预计用时 3.5 小时:三段默写各 30 分钟,小项目 1 小时,剩下的做练习和自测。前置:[Day 364](/blog/agent-zero/day-364-tracing-concepts/) 的 `part06/mini_trace.py`、[Day 367](/blog/agent-zero/day-367-tracing-views/) 的 `part06/pii_mask.py`、[Day 368](/blog/agent-zero/day-368-prompt-opt-1/) 的 `part06/opt_task.py` 和 `opt_tickets.jsonl`、[Day 369](/blog/agent-zero/day-369-prompt-opt-2/) 的 `part06/reflect_loop.py`。默写一和二不调模型;默写三、小项目和练习 4 调模型,今天实跑合计约 0.18 元(0.081 + 0.040 + 0.056),算式在各段末尾。

学法和平时一样:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章把三段默写代码再写一遍;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 320" role="img" aria-label="第 53 周知识地图:一次 Agent 运行被 span 记录器记成 trace,Langfuse 和 OpenTelemetry 是记录和发送的两种方式,数据离开进程前要脱敏,在一批 trace 上看五个视图;评测分数和错例交给反思循环或 GEPA 去改 prompt,新 prompt 再回到 Agent">
<rect x="0" y="0" width="640" height="320" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="20" width="150" height="52" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="91" y="42" fill="var(--ink)" text-anchor="middle">一次 Agent 运行</text>
<text x="91" y="60" fill="var(--ink-soft)" text-anchor="middle" font-size="11">prompt 决定行为</text>
<path d="M166 46 L216 46" stroke="var(--ink-faint)" marker-end="url(#m370)"/>
<rect x="220" y="20" width="190" height="52" rx="5" fill="none" stroke="var(--ink-soft)"/>
<text x="315" y="42" fill="var(--ink)" text-anchor="middle">span → trace</text>
<text x="315" y="60" fill="var(--ink-soft)" text-anchor="middle" font-size="11">364 手写记录器</text>
<path d="M410 46 L460 46" stroke="var(--ink-faint)" marker-end="url(#m370)"/>
<rect x="464" y="20" width="160" height="52" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="544" y="42" fill="var(--ink)" text-anchor="middle">发出去</text>
<text x="544" y="60" fill="var(--ink-soft)" text-anchor="middle" font-size="11">365 Langfuse · 366 OTel</text>
<path d="M544 72 L544 108" stroke="var(--ink-faint)" marker-end="url(#m370)"/>
<rect x="464" y="112" width="160" height="52" rx="5" fill="none" stroke="var(--ink-soft)"/>
<text x="544" y="134" fill="var(--ink)" text-anchor="middle">离开进程前</text>
<text x="544" y="152" fill="var(--ink-soft)" text-anchor="middle" font-size="11">367 mask 脱敏</text>
<path d="M464 138 L414 138" stroke="var(--ink-faint)" marker-end="url(#m370)"/>
<rect x="220" y="112" width="190" height="52" rx="5" fill="none" stroke="var(--ink-soft)"/>
<text x="315" y="134" fill="var(--ink)" text-anchor="middle">一批 trace + 分数</text>
<text x="315" y="152" fill="var(--ink-soft)" text-anchor="middle" font-size="11">367 五个视图</text>
<path d="M315 164 L315 200" stroke="var(--ink-faint)" marker-end="url(#m370)"/>
<rect x="220" y="204" width="190" height="52" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="315" y="226" fill="var(--ink)" text-anchor="middle">错例 + 理由 → 改 prompt</text>
<text x="315" y="244" fill="var(--ink-soft)" text-anchor="middle" font-size="11">368 尺子 · 369 反思/GEPA</text>
<path d="M220 230 L91 230 L91 76" stroke="var(--ink-faint)" fill="none" marker-end="url(#m370)"/>
<text x="20" y="276" fill="var(--ink-soft)" font-size="11">左上到右上:看清它做了什么(trace)。右下到左下:按分数改它(优化)。</text>
<text x="20" y="296" fill="var(--ink-faint)" font-size="11">今天的小项目:把优化循环本身也记成 trace,看它的时间和钱花在哪。</text>
<defs><marker id="m370" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--ink-faint)"/></marker></defs>
</g>
</svg>
<figcaption>这一周是一个圈。上半圈把一次运行变成可以看、可以统计、不泄露个人信息的 trace;下半圈拿分数和错例去改 prompt,新 prompt 再回到 Agent 里。</figcaption>
</figure>

图里最值得记住的是两半圈的共同点:**都不能只看一个数。** trace 那半圈,平均成本会被几个死循环拉高,要看 P95、要点进去读;优化那半圈,验证集分数是被挑出来的,要看测试集、要读新 prompt。视图和分数告诉你看哪,读原文才知道为什么。

## 本周每天一句话

- [Day 364](/blog/agent-zero/day-364-tracing-concepts/) · trace、span 和概念对齐:用一个栈加上下文管理器,二十几行写出 span 记录器,进入压栈、离开出栈,栈顶就是父亲;一张工单 3.6 秒几乎全花在模型上;trace、span、session、score 和 OpenTelemetry、Langfuse、LangSmith 的叫法一一对上。
- [Day 365](/blog/agent-zero/day-365-langfuse/) · 接入 Langfuse:云版和自托管各要什么;`@observe` 两处、一行 import 接上;没有账号就用标准库写一个假收件箱,接住 SDK 真正发出去的数据;评测结果作为 score 写回 trace;短脚本最后写一行 flush。
- [Day 366](/blog/agent-zero/day-366-otel-spans/) · 自己用 OpenTelemetry 打 span:TracerProvider + Batch 处理器 + OTLP 出口,按 GenAI 语义约定写 `invoke_agent`、`chat`、`execute_tool`,发进本机的 Jaeger;忘了 `set_tracer_provider` 时 trace_id 全是 0 也不报错。
- [Day 367](/blog/agent-zero/day-367-tracing-views/) · 视图、隐私和合规:每周固定看最慢、最贵、各项评测失败率、点踩、成本分布五个视图;客户说一次的手机号在 trace 里存了 5 遍;`mask` 要在第一个建的客户端上传;合规问存在哪、存多久、谁能看。
- [Day 368](/blog/agent-zero/day-368-prompt-opt-1/) · 手调的天花板:60 条工单按编号切三份,规则只写在 `why` 里;手调加一句「钱优先」修好 2 条带坏 6 条;20 条上一条就是 5 个点;DSPy 是框架、GEPA 是读反馈改写的优化器、ACE 是只加条目的思路。
- [Day 369](/blog/agent-zero/day-369-prompt-opt-2/) · 反思循环和 GEPA:60 行的循环 BARE 起步测试集 80% → 90%,但学了宽规则;GEPA 验证集涨、测试集不动,还删掉了「重复扣款」;评分函数五个参数、返回分数和反馈;优化结果要人审。

## 默写一:span 记录器

这是本周最短、也最能考出你是否真懂父子关系的一段。先在空文件里自己写 `Tracer`,写完和 Day 364 的 `mini_trace.Tracer` 跑同一段嵌套代码。span 编号是随机的,没法直接比,所以把每个 span 变成「(名字, 父亲的名字)」再比结构。

```python
# agent-zero-lab/part06/drill_tracer.py
"""默写一:Day 364 的 span 记录器。写完和原版 mini_trace.Tracer 跑同一段嵌套代码,比父子关系。不调模型。
用法: uv run python -m part06.drill_tracer"""
from __future__ import annotations

import secrets
import time
from collections.abc import Iterator
from contextlib import contextmanager

from part06.mini_trace import Tracer as Original


class Tracer:
    def __init__(self) -> None:
        self.spans: list[dict] = []
        self._stack: list[dict] = []

    @contextmanager
    def span(self, name: str, **attrs: object) -> Iterator[dict]:
        parent = self._stack[-1] if self._stack else None
        s = {"trace_id": parent["trace_id"] if parent else secrets.token_hex(16),
             "span_id": secrets.token_hex(8),
             "parent_id": parent["span_id"] if parent else None,
             "name": name, "start": time.time(), "end": 0.0, "attrs": dict(attrs)}
        self._stack.append(s)
        try:
            yield s
        finally:
            s["end"] = time.time()
            self._stack.pop()
            self.spans.append(s)


def shape(tracer) -> list[tuple[str, str | None]]:
    """把 span 列表变成 (名字, 父亲的名字),编号是随机的,只能比结构。"""
    with tracer.span("loop"):
        for i in (1, 2):
            with tracer.span("round", step=i):
                with tracer.span("eval_train"):
                    pass
                with tracer.span("reflect"):
                    pass
    try:
        with tracer.span("boom"):
            raise ValueError("故意的")
    except ValueError:
        pass
    with tracer.span("after"):
        pass
    names = {s["span_id"]: s["name"] for s in tracer.spans}
    return [(s["name"], names.get(s["parent_id"], "<没记下来的 span>") if s["parent_id"] else None)
            for s in tracer.spans]


if __name__ == "__main__":
    mine, theirs = shape(Tracer()), shape(Original())
    for row in mine:
        print(row)
    print("和原版一致" if mine == theirs else f"不一致:\n{theirs}")
    assert ("after", None) in mine, "出异常后栈没弹干净,after 挂到了别人下面"
```

<div class="line-notes">

- `from part06.mini_trace import Tracer as Original` 原版改名叫 `Original`,和自己默写的 `Tracer` 同时存在。`as` 相当于 JS 的 `import { Tracer as Original }`。
- `self._stack: list[dict] = []` 正在进行、还没结束的 span 排成栈,最后一个是「当前」。
- `parent = self._stack[-1] if self._stack else None` 默写时最该先写出来的一行:栈顶就是父亲,栈空说明是根。
- `s = {"trace_id": parent["trace_id"] if parent else secrets.token_hex(16),` 有父亲就沿用父亲的 trace_id,一棵树共用一个;没有就新生成 32 个十六进制字符。
- `"parent_id": parent["span_id"] if parent else None,` 树就靠这一个字段连起来。
- `self._stack.append(s)` 进入:压栈。
- `try:` 默写时最容易漏的就是这个 `try ... finally`。下面会实测漏了会怎样。
- `yield s` `with` 块里的代码在这里执行。
- `finally:` 不管 `with` 块正常结束还是抛异常,下面三行都执行。
- `self._stack.pop()` 离开:出栈。出了异常也必须出栈,否则后面所有 span 的父亲都挂错。
- `def shape(tracer) -> list[tuple[str, str | None]]:` 一段固定的嵌套代码,两层循环、一个故意抛的异常、异常之后再开一个 span。
- `raise ValueError("故意的")` 在 `boom` 这个 span 里抛异常,外面接住。考的就是出异常后栈有没有弹干净。
- `with tracer.span("after"):` 异常之后开的 span,它应该是根(父亲为 None)。如果 `boom` 没出栈,它就会挂到 `boom` 下面。
- `names = {s["span_id"]: s["name"] for s in tracer.spans}` 编号到名字的字典,用来把 parent_id 翻译成父亲的名字。
- `return [(s["name"], names.get(s["parent_id"], "<没记下来的 span>") if s["parent_id"] else None)` 有父亲的,去字典里查父亲的名字;父亲压根没被记下来(不在 spans 里)的,写成 `<没记下来的 span>`。这个默认值是我踩了坑才加的,下面讲。
- `print("和原版一致" if mine == theirs else f"不一致:\n{theirs}")` 两个列表逐个元素比,元组也逐个比,和原版顺序、结构完全一样才算一致。
- `assert ("after", None) in mine, "出异常后栈没弹干净,after 挂到了别人下面"` 再单独断言最关键的一条。`assert 条件, 信息` 条件为假时抛 `AssertionError`,相当于测试里的 `expect(...).toBe(...)`。

</div>

```bash
uv run python -m part06.drill_tracer
```

实测输出:

```text
('eval_train', 'round')
('reflect', 'round')
('round', 'loop')
('eval_train', 'round')
('reflect', 'round')
('round', 'loop')
('loop', None)
('boom', None)
('after', None)
和原版一致
```

顺序是「结束的顺序」:孩子先结束,所以排在父亲前面;`loop` 最后结束,排在它那棵树的最后。`boom` 抛了异常也被记了下来,`after` 是根。

### 去掉 finally 会怎样,以及我第一版的检查为什么没抓到

把 `try ... finally` 拿掉,写成 `yield s` 后面直接跟三行收尾,另存为 `part06/drill_tracer_nofinally.py` 跑一下。我第一版的 `shape` 最后一行写的是 `names.get(s["parent_id"])`,没有默认值。结果断言**通过了**,只打印了「不一致」。

原因要绕一下才想得通。没有 `finally` 时,`boom` 里抛异常,`yield` 后面那三行根本不执行:`boom` 没出栈,也没进 `spans` 列表。接着开 `after`,栈顶还是 `boom`,所以 `after` 的 parent_id 是 `boom` 的编号。可 `boom` 不在 `spans` 里,`names.get(...)` 查不到,返回 None,于是 `after` 看起来「父亲是 None」,和正确答案一模一样。错误被检查本身掩盖了。

加上 `"<没记下来的 span>"` 这个默认值后,再跑没有 `finally` 的版本:

```bash
uv run python -m part06.drill_tracer_nofinally
```

实测输出(只留最后几行):

```text
('loop', None)
('after', '<没记下来的 span>')
不一致:
[('eval_train', 'round'), ('reflect', 'round'), ('round', 'loop'), ('eval_train', 'round'), ('reflect', 'round'), ('round', 'loop'), ('loop', None), ('boom', None), ('after', None)]
Traceback (most recent call last):
  ...
AssertionError: 出异常后栈没弹干净,after 挂到了别人下面
```

这次两处都抓到了:`boom` 整个从结果里消失,`after` 挂在一个不存在的 span 下面。真实的 tracing 后端里,这种 span 叫「孤儿」,瀑布图上要么不显示,要么单独飘在一边。这个坑值得记两遍:一遍是 `finally` 不能少,一遍是**写检查时,「查不到」不能默认当成「没有」**。

## 默写二:脱敏函数

Day 367 的 `mask` 只有十来行,但正则的边界最容易写错。默写完和原版在 6 个样本上比:两个该换的、两个不该换的、一个嵌套的字典、一个元组。

```python
# agent-zero-lab/part06/drill_mask.py
"""默写二:Day 367 的脱敏函数。写完和原版 pii_mask.mask 在一组正反样本上逐个比。不调模型。
用法: uv run python -m part06.drill_mask"""
from __future__ import annotations

import re
from typing import Any

from part06.pii_mask import mask as original

PHONE = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")


def mask(*, data: Any, **kwargs: Any) -> Any:
    if isinstance(data, str):
        return EMAIL.sub("<email>", PHONE.sub("<phone>", data))
    if isinstance(data, dict):
        return {k: mask(data=v) for k, v in data.items()}
    if isinstance(data, (list, tuple)):
        return [mask(data=v) for v in data]
    return data


SAMPLES: list[Any] = [
    "有问题打我电话 13812345678",                     # 该换
    "手机13912345678,邮箱 a.b+1@corp.example.cn",    # 两样都该换
    "订单号 20261008123456789 别动",                  # 不该换:长数字里的一段
    "金额 2392 元,发票 INV-0012",                     # 不该换
    {"messages": [{"role": "user", "content": "回电 15000000000"}], "tokens": 120},
    ("元组里 18600000000", 3.5, None),
]

if __name__ == "__main__":
    bad = 0
    for s in SAMPLES:
        mine, theirs = mask(data=s), original(data=s)
        same = mine == theirs
        bad += not same
        print("一致" if same else "不一致", repr(mine))
    print(f"\n{len(SAMPLES)} 个样本,不一致 {bad} 个")
```

<div class="line-notes">

- `PHONE = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")` 1 开头、第二位 3 到 9、后面 9 位,共 11 位;`(?<!\d)` 前面不是数字、`(?!\d)` 后面不是数字,这两个环视是默写时最容易忘的。
- `EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")` @ 后面至少一个「点加一段」。`(?:...)` 不捕获,只把「点加一段」当成整体重复。
- `def mask(*, data: Any, **kwargs: Any) -> Any:` `*` 后面的参数只能用关键字传,Langfuse 就是 `mask(data=...)` 这样调的;`**kwargs` 兜住 SDK 以后可能多传的参数。
- `return EMAIL.sub("<email>", PHONE.sub("<phone>", data))` 先换手机号再换邮箱,一行写完 Day 367 的 `mask_text`。
- `return {k: mask(data=v) for k, v in data.items()}` 字典递归处理每个值。
- `return [mask(data=v) for v in data]` 列表和元组都递归,结果统一成列表。
- `"手机13912345678,邮箱 a.b+1@corp.example.cn",    # 两样都该换` 手机号前面紧挨着汉字「机」,环视只管数字,汉字不影响;邮箱带点、带加号、域名两段。
- `"订单号 20261008123456789 别动",                  # 不该换:长数字里的一段` 这串数字里有 11 位以 1 开头的片段,没有环视就会被误伤。
- `("元组里 18600000000", 3.5, None),` 元组里混着数字和 None,`return data` 那一行负责原样放过它们。
- `bad += not same` `not same` 是布尔,加到整数上 True 算 1。

</div>

```bash
uv run python -m part06.drill_mask
```

实测输出:

```text
一致 '有问题打我电话 <phone>'
一致 '手机<phone>,邮箱 <email>'
一致 '订单号 20261008123456789 别动'
一致 '金额 2392 元,发票 INV-0012'
一致 {'messages': [{'role': 'user', 'content': '回电 <phone>'}], 'tokens': 120}
一致 ['元组里 <phone>', 3.5, None]

6 个样本,不一致 0 个
```

如果你默写时漏了环视,第三个样本会变成 `订单号 2026100<phone>456789 别动` 之类,和原版不一致;如果漏了 `tuple`,最后一个会原样返回元组,手机号没换。Day 367 练习 3 实测过这两种写法的差别。

## 默写三:反思循环

Day 369 的核心是反思循环。数据和评测函数直接用 `opt_task.py`,只默写反思 prompt、`reflect()` 和循环本身。反思 prompt 不用逐字一样,把四个要求写全就行:保留类别名、写成通用规则、限制字数、放进标签。

```python
# agent-zero-lab/part06/drill_reflect.py
"""默写三:Day 369 的反思循环。只默写反思 prompt、reflect() 和循环本身,数据和评测函数用 Day 368 的 opt_task。
用法: uv run python -m part06.drill_reflect"""
from __future__ import annotations

import re
from typing import Any

from common.llm import LLMClient
from part06.opt_task import BARE_PROMPT, evaluate, load

REFLECT = """你在维护一个客服工单分类 prompt。下面是当前 prompt 和它分错的工单,每条附标注员的理由。
找出错误背后的规则,改写 prompt:保留六个类别名;写成通用规则,不要抄工单原文;不超过 400 字。
新 prompt 放在 <prompt></prompt> 里。

当前 prompt:
{prompt}

分错的例子:
{errors}"""


def reflect(client: LLMClient, prompt: str, errors: list[dict[str, Any]]) -> str:
    lines = [f"- 工单:{e['ticket']}\n  模型答:{e['pred']}  正确:{e['label']}  理由:{e['why']}" for e in errors]
    r = client.chat([{"role": "user", "content": REFLECT.format(prompt=prompt, errors="\n".join(lines))}])
    m = re.search(r"<prompt>(.*?)</prompt>", r.content, re.S)
    return m.group(1).strip() if m else prompt


if __name__ == "__main__":
    client = LLMClient()
    train, val = load("train"), load("val")
    best = BARE_PROMPT
    best_val, _ = evaluate(client, best, val)
    for step in range(1, 4):
        _, errors = evaluate(client, best, train)
        if not errors:
            print(f"第 {step} 轮:训练集全对,停")
            break
        cand = reflect(client, best, errors)
        cand_val, _ = evaluate(client, cand, val)
        keep = cand_val >= best_val
        print(f"第 {step} 轮:训练错 {len(errors)},val {best_val:.0%} → 候选 {cand_val:.0%},{'采用' if keep else '丢弃'}")
        if keep:
            best, best_val = cand, cand_val
    acc, errs = evaluate(client, best, load("test"))
    print(f"test {acc:.0%}", [e["id"] for e in errs])
    print(client.ledger)
```

<div class="line-notes">

- `REFLECT = """你在维护一个客服工单分类 prompt。下面是当前 prompt 和它分错的工单,每条附标注员的理由。` 比 Day 369 原版压缩成了三行,四个要求都在。
- `lines = [f"- 工单:{e['ticket']}\n  模型答:{e['pred']}  正确:{e['label']}  理由:{e['why']}" for e in errors]` 四样东西缺一不可,最容易忘的是「理由」,而它恰恰最重要。
- `m = re.search(r"<prompt>(.*?)</prompt>", r.content, re.S)` 非贪婪 `.*?` 加 `re.S`,多行也能取出来。
- `return m.group(1).strip() if m else prompt` 没写标签就当这轮没改出东西。
- `for step in range(1, 4):` 默写版最多三轮,省一点钱。
- `_, errors = evaluate(client, best, train)` 错例只从训练集来。
- `keep = cand_val >= best_val` 验证集不降就采用。
- `acc, errs = evaluate(client, best, load("test"))` 测试集在循环外面,只量一次。

</div>

```bash
uv run python -m part06.drill_reflect
```

实测输出:

```text
第 1 轮:训练错 5,val 85% → 候选 85%,采用
第 2 轮:训练错 1,val 85% → 候选 85%,采用
第 3 轮:训练错 1,val 85% → 候选 90%,采用
test 90% ['t12', 't33']
163 次调用 | 输入 44979 / 输出 1911 tokens | 约 ¥0.0812
```

测试集 90%,错的正好又是 t12 和 t33,和 Day 369 BARE 起步那次一模一样。两次反思写出的 prompt 字面不同,犯的错却相同:t33 被「钱优先」带走,t12 被「发票下载算 invoice」带走。这说明这两条宽规则几乎是这批错例必然诱导出来的,换一次随机性也躲不开。花费 0.081 元。

## 小项目:给反思循环挂上 span

这一周的前半段学了怎么看一个 Agent 的时间和钱花在哪,后半段写了一个优化循环。优化循环本身也是一个反复调模型的程序,它的时间和钱花在哪?用本周的东西回答:用默写一的 `Tracer` 给循环的每一步开 span,每个 span 上记下这一步调了几次模型、多少 token、多少钱;跑完用 Day 364 的 `print_tree` 画瀑布图,再按 Day 367 的思路算视图。

记钱的办法是:进入一步之前记下账本的数,离开时再看一次,两次相减就是这一步花的。这个「前后各看一眼」的动作正好又是一个上下文管理器。

```python
# agent-zero-lab/part06/week53_traced_opt.py
"""第 53 周小项目:给反思循环挂上 span,画瀑布图,再按 Day 367 的思路看最慢、最贵的步骤。
用法: uv run python -m part06.week53_traced_opt"""
from __future__ import annotations

import json
from collections import defaultdict
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from common.llm import LLMClient
from part06.drill_reflect import reflect
from part06.drill_tracer import Tracer
from part06.mini_trace import print_tree
from part06.opt_task import BARE_PROMPT, evaluate, load

client = LLMClient()
tracer = Tracer()


@contextmanager
def step(name: str, **attrs: object) -> Iterator[dict]:
    before = (client.ledger.calls, client.ledger.prompt_tokens, client.ledger.completion_tokens, client.ledger.cost)
    with tracer.span(name, **attrs) as s:
        yield s
        led = client.ledger
        s["attrs"].update(calls=led.calls - before[0], tokens_in=led.prompt_tokens - before[1],
                          tokens_out=led.completion_tokens - before[2], cost=round(led.cost - before[3], 5))


if __name__ == "__main__":
    train, val = load("train"), load("val")
    best = BARE_PROMPT
    with step("optimize", start="BARE"):
        with step("eval_val", version=0):
            best_val, _ = evaluate(client, best, val)
        for i in range(1, 4):
            with step("round", round=i) as r:
                with step("eval_train"):
                    _, errors = evaluate(client, best, train)
                r["attrs"]["train_errors"] = [e["id"] for e in errors]
                if not errors:
                    break
                with step("reflect") as rf:
                    cand = reflect(client, best, errors)
                    rf["attrs"]["prompt_chars"] = len(cand)
                with step("eval_val", version=i):
                    cand_val, _ = evaluate(client, cand, val)
                r["attrs"]["kept"] = cand_val >= best_val
                if cand_val >= best_val:
                    best, best_val = cand, cand_val
        with step("eval_test"):
            test_acc, _ = evaluate(client, best, load("test"))

    print_tree(tracer.spans)
    print(f"\ntest {test_acc:.0%}  {client.ledger}")

    leaves = [s for s in tracer.spans if s["name"] not in ("optimize", "round")]
    print("\n最慢的 3 步")
    for s in sorted(leaves, key=lambda s: s["end"] - s["start"], reverse=True)[:3]:
        print(f"  {s['name']:<10} {s['end'] - s['start']:5.1f}s  调用 {s['attrs']['calls']} 次")
    print("最贵的 3 步")
    for s in sorted(leaves, key=lambda s: s["attrs"]["cost"], reverse=True)[:3]:
        print(f"  {s['name']:<10} ¥{s['attrs']['cost']:.4f}  输入 {s['attrs']['tokens_in']} token")
    by_name: dict[str, float] = defaultdict(float)
    for s in leaves:
        by_name[s["name"]] += s["attrs"]["cost"]
    total = sum(by_name.values())
    print("按步骤汇总钱", {k: f"{v / total:.0%}" for k, v in sorted(by_name.items(), key=lambda kv: -kv[1])})

    out = Path("part06/week53_spans.jsonl")
    out.write_text("".join(json.dumps(s, ensure_ascii=False) + "\n" for s in tracer.spans), encoding="utf-8")
    print(f"\n{len(tracer.spans)} 个 span 写进 {out}")
```

<div class="line-notes">

- `from collections import defaultdict` 取不存在的键时自动给默认值的字典。`defaultdict(float)` 的默认值是 0.0,累加时不用先判断键在不在。
- `from part06.drill_reflect import reflect` 用默写三的 `reflect()`,不用 Day 369 的原版。默写的东西要能真的被用起来。
- `from part06.drill_tracer import Tracer` 同理,用默写一的记录器;画图的 `print_tree` 没默写,还是用 Day 364 的。
- `client = LLMClient()` 放在模块顶层,下面 `step()` 和主程序共用同一个账本。
- `def step(name: str, **attrs: object) -> Iterator[dict]:` 在 `tracer.span` 外面再包一层上下文管理器,专门负责「前后各看一眼账本」。
- `before = (client.ledger.calls, client.ledger.prompt_tokens, client.ledger.completion_tokens, client.ledger.cost)` 进入前的四个数。`Ledger` 是 Day 136 的 `LLMClient` 自带的账本,每次 `chat` 都往里加。
- `with tracer.span(name, **attrs) as s:` 真正开 span。`**attrs` 把关键字参数原样传下去,比如 `round=1`。
- `yield s` `with step(...)` 块里的代码在这里执行。
- `s["attrs"].update(calls=led.calls - before[0], tokens_in=led.prompt_tokens - before[1],` 离开时减一下,就是这一步的增量。父 span 的增量包含所有孩子的,比如 `round` 的花费 = 它下面三步之和。这里没写 `try/finally`,出异常时这一步的花费不会记下,练习 1 会补。
- `tokens_out=led.completion_tokens - before[2], cost=round(led.cost - before[3], 5))` `round(x, 5)` 保留 5 位小数,浮点相减会有 0.000000001 这种尾巴。
- `with step("optimize", start="BARE"):` 根 span,整个优化过程。
- `with step("eval_val", version=0):` 先量起点在验证集上的分数,`version=0` 表示这是起点。
- `with step("round", round=i) as r:` 每一轮一个 span,它下面挂三个孩子。`as r` 拿到 span 字典,下面往里补属性。
- `r["attrs"]["train_errors"] = [e["id"] for e in errors]` 把这一轮的训练集错例编号记在 span 上,事后不用重跑就知道每轮在修什么。
- `if not errors:` 训练集全对就跳出循环。`break` 在 `with` 块里也没问题,`with` 会照常收尾。
- `rf["attrs"]["prompt_chars"] = len(cand)` 记下新 prompt 多长,能看出它是不是越改越长。
- `r["attrs"]["kept"] = cand_val >= best_val` 这一轮的候选采没采用,也记到 span 上。
- `leaves = [s for s in tracer.spans if s["name"] not in ("optimize", "round")]` 只看叶子节点。父 span 的时间和钱是孩子们的和,放在一起排序会重复计算。
- `for s in sorted(leaves, key=lambda s: s["end"] - s["start"], reverse=True)[:3]:` Day 367 的「最慢的 N 个」视图,只是从 trace 换成了 span。
- `for s in sorted(leaves, key=lambda s: s["attrs"]["cost"], reverse=True)[:3]:` 「最贵的 N 个」。
- `by_name[s["name"]] += s["attrs"]["cost"]` 按步骤名字汇总,两次 `eval_val` 加在一起。
- `print("按步骤汇总钱", {k: f"{v / total:.0%}" for k, v in sorted(by_name.items(), key=lambda kv: -kv[1])})` 算每类步骤占总花费的百分比,按从多到少排。`key=lambda kv: -kv[1]` 用负号实现从大到小。
- `out.write_text("".join(json.dumps(s, ensure_ascii=False) + "\n" for s in tracer.spans), encoding="utf-8")` 每个 span 一行 JSON 写进文件,和 Day 365 假收件箱存数据的格式一样。`ensure_ascii=False` 让中文原样写,不变成 `\u` 转义。

</div>

```bash
uv run python -m part06.week53_traced_opt
```

实测输出:

```text
|████████████████████████████████████████| optimize                        20733 ms
|███████                                 |   eval_val                       4071 ms
|       ███████████████████████          |   round                         11587 ms
|       █████                            |     eval_train                   2467 ms
|            ████████████                |     reflect                      6060 ms
|                        ██████          |     eval_val                     3060 ms
|                              ████      |   round                          2433 ms
|                              ████      |     eval_train                   2433 ms
|                                  █████ |   eval_test                      2641 ms

test 85%  101 次调用 | 输入 22885 / 输出 921 tokens | 约 ¥0.0398

最慢的 3 步
  reflect      6.1s  调用 1 次
  eval_val     4.1s  调用 20 次
  eval_val     3.1s  调用 20 次
最贵的 3 步
  eval_val   ¥0.0111  输入 6525 token
  eval_train ¥0.0091  输入 6537 token
  eval_test  ¥0.0091  输入 6544 token
按步骤汇总钱 {'eval_val': '38%', 'eval_train': '33%', 'eval_test': '23%', 'reflect': '7%'}

9 个 span 写进 part06/week53_spans.jsonl
```

这次只跑了一轮半:第 1 轮反思后候选被采用,第 2 轮训练集已经全对,直接停了。测试集 85%,比默写三那次的 90% 低一条,同样从 BARE 出发,反思抽的签不一样,结果就差 5 个点。

瀑布图和两个视图说的是同一件事,而且结论和直觉相反:

**最慢的一步是反思**,6.1 秒,只调了 1 次模型。反思模型要读几条错例、写四五百字的新 prompt,输出长,所以慢。评测虽然调了 20 次,但线程池 8 个并发,3 秒左右就跑完了。

**最贵的却是评测**。反思只占 7% 的钱,评测(三份数据加起来)占了 93%。原因看 token:一次评测是 20 条 × 每条三百来个 token 的输入;一次反思只有一次调用。这和 Day 369 里 GEPA 的账对得上:381 次执行调用、7 次反思调用,钱几乎都花在执行上。所以优化器的预算参数数的是评分次数,不是反思次数。

想省钱,该砍的是评测次数(比如验证集不是每轮都全量跑),而不是换便宜的反思模型。想省时间,反而是反思那一步值得优化。如果只看总花费 0.04 元,这两件事都看不出来,这就是给一个程序挂 span 的价值。

`week53_spans.jsonl` 里每个 span 带着属性,比如 `round` 那两行:

```text
round {'round': 1, 'train_errors': ['t01', 't13', 't16', 't22', 't31'], 'kept': True, 'calls': 41, 'tokens_in': 8339, 'tokens_out': 537, 'cost': 0.01771}
round {'round': 2, 'train_errors': [], 'calls': 20, 'tokens_in': 6537, 'tokens_out': 129, 'cost': 0.00909}
```

(这两行是我用一行 Python 从文件里挑出来打印的,只看 `name` 和 `attrs`。)

第 1 轮修的是哪 5 条、采没采用、花了多少,都在 span 上。下次优化结果不好,不用重跑,读这个文件就能复盘。这些 span 一旦要发到 Langfuse 这类外部平台,就要想 Day 367 的问题:span 里有没有客户的原文。练习 2 处理这件事。

## 本周错题与坑清单

把这一周真实踩过的坑按「现象 → 原因 → 怎么防」排一遍。前五条是 tracing,后五条是优化,最后一条是今天的。

| 现象 | 原因 | 怎么防 |
| --- | --- | --- |
| span 出异常后,后面的 span 都挂错了父亲 | 记录器里没有 `try/finally`,异常时没出栈(364) | 收尾代码放 `finally`;今天默写一实测过 |
| 短脚本跑完,Langfuse 里少数据 | 进程被强杀时后台批次没发完(365) | 短脚本最后写 `flush()` |
| OTel 的 trace_id 全是 0,什么都不报 | 忘了 `set_tracer_provider` 或调晚了(366) | 初始化放在进程最前面;看到全 0 先查它 |
| 每个失败 span 有两条异常事件 | 自己 `record_exception` 了,又没关自动记录(366) | 二选一 |
| 写了 `mask`,发出去的数据里还有手机号 | 带 mask 的客户端不是第一个建的(367) | 入口最前面建;定期扫描真实发出的数据 |
| 手调一版,60 条上分数涨了,不可信 | 看着全部数据改,没有干净的测试集(368) | 先切三份,测试集最后只量一次 |
| 验证集涨了 5 个点 | 20 条上一条就是 5 个点,t14 这种时对时错(368) | 差距在一两条以内当作没差别 |
| 优化后的 prompt 把 t33 带成 billing | 反思模型写了「钱优先」的全局优先级,规则写宽(369) | 人读新 prompt,宽规则要写清例外 |
| GEPA 把「重复扣款」改丢了 | 整段重写的简短偏好,每轮只看 3 条样本(369) | 用「必须保留」清单在 CI 里拦 |
| GEPA 构造时 `TypeError` | 评分函数不是五个参数(369) | `(gold, pred, trace, pred_name, pred_trace)` |
| 默写的记录器明明错了,检查却通过 | 父亲查不到时 `get` 返回 None,冒充了「没有父亲」(370) | 查不到要显式标出来,不能默认当成没有 |

最后一条是今天新加的,也是这周最隐蔽的一个:**检查代码本身也会有 bug,而且它的 bug 会让你以为被检查的代码没 bug。** Day 369 的 8 字抄袭检查查不出「如 E1101」,今天的 `names.get` 查不出孤儿 span,都是同一类问题。写完检查,先故意喂一个错的版本,确认它会红。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1EFtd6ZEVH&autoplay=0&high_quality=1" title="Agent 可观测性全解：Run、Trace、Thread 与生产评估闭环" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>老纪的技术唠嗑局 · Agent 可观测性全解:Run、Trace、Thread 与生产评估闭环 · 9 分钟,中文。Day 364 推荐过,复习时再看一遍:它讲的「评估闭环」就是今天知识地图里那个圈,trace 和评分最后要回到改进上。</figcaption>
</figure>

## 动手练习

### 练习 1:span 记下异常

小项目里 `step()` 没写 `try/finally`。先在记录器这一层解决:写一个 `ErrTracer`,继承默写一的 `Tracer`,span 里出了异常就在属性上记 `status="error"` 和异常信息,正常结束记 `status="ok"`,异常照样往外抛。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex370_error.py
"""练习 1:span 里出了异常,记下 status 和 error,异常照样往外抛。不调模型。
用法: uv run python -m part06.ex370_error"""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from part06.drill_tracer import Tracer


class ErrTracer(Tracer):
    @contextmanager
    def span(self, name: str, **attrs: object) -> Iterator[dict]:
        with super().span(name, **attrs) as s:
            try:
                yield s
                s["attrs"]["status"] = "ok"
            except Exception as e:
                s["attrs"]["status"] = "error"
                s["attrs"]["error"] = f"{type(e).__name__}: {e}"
                raise


if __name__ == "__main__":
    t = ErrTracer()
    try:
        with t.span("round", round=1):
            with t.span("reflect"):
                raise TimeoutError("调反思模型超时")
    except TimeoutError:
        print("异常照样抛出来了")
    for s in t.spans:
        print(s["name"], s["attrs"])
```

<div class="line-notes">

- `class ErrTracer(Tracer):` 继承,只重写 `span` 一个方法,栈和列表都沿用父类的。和 JS 的 `class ErrTracer extends Tracer` 一样。
- `with super().span(name, **attrs) as s:` 先让父类开 span、管压栈出栈和 `finally`,自己只在里面加一层异常处理。`super()` 相当于 JS 的 `super`。
- `yield s` 用户的 `with` 块在这里执行。
- `s["attrs"]["status"] = "ok"` 只有 `yield` 正常回来才走到这一行。
- `except Exception as e:` 接住 `with` 块里抛出的任何异常。
- `s["attrs"]["error"] = f"{type(e).__name__}: {e}"` 记下异常类型和信息,代入是 `TimeoutError: 调反思模型超时`。
- `raise` 不带参数的 `raise` 把刚才接住的异常原样再抛出去。记下来不等于吞掉,调用方该知道的还得知道。
- `raise TimeoutError("调反思模型超时")` 模拟反思那一步超时。

</div>

```bash
uv run python -m part06.ex370_error
```

实测输出:

```text
异常照样抛出来了
reflect {'status': 'error', 'error': 'TimeoutError: 调反思模型超时'}
round {'round': 1, 'status': 'error', 'error': 'TimeoutError: 调反思模型超时'}
```

`reflect` 先结束,所以排在前面;`round` 原有的属性在前,`status` 和 `error` 是后加的。异常从 `reflect` 冒到 `round`,两层都记了 error,这正是 Day 366 练习 1 说的「异常会被记两遍」的另一种样子:每一层都有自己的 status,看瀑布图时从最深的那个 error 往上找就是根因。小项目里要用,把 `week53_traced_opt.py` 的 `tracer = Tracer()` 换成 `tracer = ErrTracer()`,并在 `step()` 的 `yield s` 外面也包一层 `try/finally`,让出异常时花费照样记下。

</details>

### 练习 2:span 写出进程之前先脱敏

小项目只把错例编号记进了 span。假设你为了排查方便,在 `reflect` 的 span 上记下了错例原文,而某条工单里有客户的手机号和邮箱。写一个 `export(spans, path)`:用默写二的 `mask` 处理每个 span 后再写文件,返回一共换掉了几处。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex370_export.py
"""练习 2:span 写出进程之前先脱敏。reflect 这一步如果把错例原文记进 span,客户的手机号就跟着出去了。不调模型。
用法: uv run python -m part06.ex370_export"""
from __future__ import annotations

import json
from pathlib import Path

from part06.drill_mask import mask
from part06.drill_tracer import Tracer


def export(spans: list[dict], path: Path) -> int:
    lines = [json.dumps(mask(data=s), ensure_ascii=False) for s in spans]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return sum(line.count("<phone>") + line.count("<email>") for line in lines)


if __name__ == "__main__":
    t = Tracer()
    with t.span("reflect", errors=[{"id": "t99", "ticket": "退款没到账,打我 13812345678 或发 li@example.com"}]):
        pass
    out = Path("part06/ex370_spans.jsonl")
    n = export(t.spans, out)
    text = out.read_text(encoding="utf-8")
    print(f"换掉 {n} 处;文件里还有手机号吗:{'13812345678' in text};trace_id 还在吗:{t.spans[0]['trace_id'] in text}")
    print(text[:200])
```

<div class="line-notes">

- `from part06.drill_mask import mask` 默写二的 `mask`,它会递归进 span 字典、`attrs` 字典、`errors` 列表、每条错例字典,一直走到字符串。
- `lines = [json.dumps(mask(data=s), ensure_ascii=False) for s in spans]` 先脱敏,再序列化。顺序反过来(先 `json.dumps` 再对整串字符串 mask)也能换掉手机号,但那样会对整段 JSON 跑正则,编号、时间戳这些也一起过了一遍,更容易误伤。
- `return sum(line.count("<phone>") + line.count("<email>") for line in lines)` 数一下换了几处,写进日志,脱敏规则哪天失效了能从这个数上看出来。
- `with t.span("reflect", errors=[{"id": "t99", "ticket": "退款没到账,打我 13812345678 或发 li@example.com"}]):` 编造的一条工单,手机号和邮箱都是假的。
- `print(f"换掉 {n} 处;文件里还有手机号吗:{'13812345678' in text};trace_id 还在吗:{t.spans[0]['trace_id'] in text}")` 三件事一起验:换了几处、原号码还在不在、编号有没有被误伤。

</div>

```bash
uv run python -m part06.ex370_export
```

实测输出(trace_id 是随机的):

```text
换掉 2 处;文件里还有手机号吗:False;trace_id 还在吗:True
{"trace_id": "9a54ad67bcd10534204634106ceff5e8", "span_id": "28340f5e4082dc61", "parent_id": null, "name": "reflect", "start": 1792685080.781986, "end": 1792685080.781992, "attrs": {"errors": [{"id": 
```

手机号和邮箱都换掉了,trace_id 没被误伤。`start`、`end` 是浮点数不是字符串,`mask` 原样放过。

还有一个理论上的风险值得知道:trace_id 是十六进制字符串,前后是字母时环视不会拦。如果某个编号里碰巧出现「1 开头、第二位 3–9 的连续 11 位数字」,它会被换成 `<phone>`,trace 就对不上了。概率很低,但不是零。稳妥的做法是只对 `attrs` 里的值做脱敏,编号字段不碰;或者像 Day 367 那样,只在 SDK 的 `mask` 钩子里处理输入输出,不处理 trace 结构本身。

</details>

### 练习 3:20 条上能量出多少

一个 prompt 的真实准确率是 90%。在 20 条上量一次,会量出多少?用模拟回答:重复 1 万次「20 条里每条以 90% 的概率答对」,画出分数的分布,并算出量出 95% 以上、85% 以下的概率。不调模型。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex370_noise_sim.py
"""练习 3:一个真实准确率 90% 的 prompt,在 20 条上量一次,会量出多少?模拟 1 万次。不调模型。
用法: uv run python -m part06.ex370_noise_sim"""
from __future__ import annotations

import random
from collections import Counter

random.seed(368)
TRUE_ACC, N, TRIALS = 0.90, 20, 10_000

if __name__ == "__main__":
    scores = Counter(sum(random.random() < TRUE_ACC for _ in range(N)) for _ in range(TRIALS))
    for right in sorted(scores):
        print(f"{right / N:>4.0%}  {scores[right] / TRIALS:6.1%}  {'#' * (scores[right] * 100 // TRIALS)}")
    high = sum(v for k, v in scores.items() if k >= 19) / TRIALS
    low = sum(v for k, v in scores.items() if k <= 17) / TRIALS
    print(f"量出 ≥95% 的概率 {high:.1%},量出 ≤85% 的概率 {low:.1%}")
```

<div class="line-notes">

- `random.seed(368)` 固定随机种子,每次运行结果一样,你跑出来的数字会和下面完全相同。
- `TRUE_ACC, N, TRIALS = 0.90, 20, 10_000` 真实准确率、每次量几条、模拟几次。
- `scores = Counter(sum(random.random() < TRUE_ACC for _ in range(N)) for _ in range(TRIALS))` 从里往外读:`random.random()` 给一个 0 到 1 的随机数,小于 0.9 就算这条答对;20 条加起来是这一次答对几条;重复 1 万次,用 `Counter` 数每个答对条数出现了几次。[Day 353](/blog/agent-zero/day-353-stats-intuition/) 抛硬币模拟是同一个写法。
- `print(f"{right / N:>4.0%}  {scores[right] / TRIALS:6.1%}  {'#' * (scores[right] * 100 // TRIALS)}")` 每行:量出的分数、出现的比例、一条用 `#` 画的横条(每 1% 一个 `#`)。
- `high = sum(v for k, v in scores.items() if k >= 19) / TRIALS` 答对 19 条以上,就是量出 95% 或 100%。
- `low = sum(v for k, v in scores.items() if k <= 17) / TRIALS` 答对 17 条以下,就是量出 85% 或更低。

</div>

```bash
uv run python -m part06.ex370_noise_sim
```

实测输出:

```text
 55%    0.0%  
 60%    0.1%  
 65%    0.2%  
 70%    1.0%  #
 75%    3.0%  ###
 80%    8.9%  ########
 85%   19.2%  ###################
 90%   27.8%  ###########################
 95%   27.6%  ###########################
100%   12.4%  ############
量出 ≥95% 的概率 39.9%,量出 ≤85% 的概率 32.3%
```

真实 90% 的 prompt,量一次能量出 90% 的机会只有 27.8%。有四成的机会量出 95% 以上,三成的机会量出 85% 以下。也就是说,两个**完全一样好**的 prompt 各量一次,一个 95%、一个 85% 是很常见的事。

拿这个去看 Day 369 那张表:验证集 85% → 95% 这种「涨了 10 个点」,在这个分布下一点都不稀奇。这也是为什么我说验证集上涨只能当参考,差距在一两条以内什么都别信。要想把 90% 和 95% 分清楚,需要的样本量远大于 20,Day 354 的样本量算式可以算出具体要多少。

</details>

### 练习 4(开放题):给反思循环加预算闸门

真实项目里优化器会被放在夜里跑,你不希望它一晚上花掉几百块。给默写三的循环加一个预算:每轮开始前看一眼账本,花超了就停,用当前最好的版本收尾。预算设 0.03 元跑一次,看实际花了多少。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex370_budget.py
"""练习 4:给反思循环加预算闸门。每轮开始前看账本,花超了就停,用当前最好的版本收尾。
用法: uv run python -m part06.ex370_budget [预算元,默认 0.03]"""
from __future__ import annotations

import sys

from common.llm import LLMClient
from part06.drill_reflect import reflect
from part06.opt_task import BARE_PROMPT, evaluate, load

if __name__ == "__main__":
    budget = float(sys.argv[1]) if len(sys.argv) > 1 else 0.03
    client = LLMClient()
    train, val = load("train"), load("val")
    best = BARE_PROMPT
    best_val, _ = evaluate(client, best, val)
    for step in range(1, 5):
        if client.ledger.cost >= budget:
            print(f"第 {step} 轮开始前已花 ¥{client.ledger.cost:.4f} ≥ 预算 ¥{budget},停")
            break
        _, errors = evaluate(client, best, train)
        if not errors:
            print(f"第 {step} 轮:训练集全对,停")
            break
        cand = reflect(client, best, errors)
        cand_val, _ = evaluate(client, cand, val)
        if cand_val >= best_val:
            best, best_val = cand, cand_val
        print(f"第 {step} 轮:候选 val {cand_val:.0%},累计 ¥{client.ledger.cost:.4f}")
    acc, _ = evaluate(client, best, load("test"))
    print(f"test {acc:.0%}  {client.ledger}")
```

<div class="line-notes">

- `budget = float(sys.argv[1]) if len(sys.argv) > 1 else 0.03` 预算从命令行读,不给就是 0.03 元。
- `if client.ledger.cost >= budget:` 闸门放在每轮开头:看账本累计花了多少,到了就停。
- `print(f"第 {step} 轮开始前已花 ¥{client.ledger.cost:.4f} ≥ 预算 ¥{budget},停")` 停的时候写清楚为什么停,事后看日志才知道是预算到了还是收敛了。
- `acc, _ = evaluate(client, best, load("test"))` 不管为什么停,都用当前最好的版本量一次测试集。

</div>

```bash
uv run python -m part06.ex370_budget
```

实测输出:

```text
第 1 轮:候选 val 85%,累计 ¥0.0209
第 2 轮:候选 val 85%,累计 ¥0.0453
第 3 轮开始前已花 ¥0.0453 ≥ 预算 ¥0.03,停
test 90%  122 次调用 | 输入 30695 / 输出 1350 tokens | 约 ¥0.0559
```

闸门生效了,但预算是 0.03 元,实际花了 0.056 元,超了将近一倍。原因有两个:闸门只在每轮**开始前**检查,第 2 轮开始时才花了 0.021 元,放行了,这一轮自己又花了 0.024 元;最后量测试集的 0.01 元在闸门外面。

这是所有「检查后执行」式预算的通病:超支最多能到「一整轮的花费」。要更严格,有几种改法:把每轮的花费估出来(这里约 0.024 元),检查条件改成「已花 + 一轮的估计 > 预算就停」;或者把闸门下沉到 `LLMClient.chat` 里,每次调用前都检查,超了就抛异常,配合练习 1 的 `ErrTracer` 记下是在哪一步被拦住的。GEPA 的 `max_metric_calls` 是另一种思路:不数钱,数次数,次数到了就停,因为一次评分的价格基本固定,数次数更稳。

</details>

### 验收标准

- 三段默写都能合上文章写出来,`drill_tracer` 打印「和原版一致」,`drill_mask` 不一致 0 个,`drill_reflect` 从 BARE 跑通并打印测试集分数。
- 能解释 `drill_tracer_nofinally.py` 为什么在没有默认值的检查下会蒙混过关。
- `week53_traced_opt.py` 跑出瀑布图和三个视图,你能说出在你那次运行里最慢和最贵的步骤分别是什么、为什么不是同一个。
- 能不看文章说出这一周的十条坑里至少六条的原因。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 孤儿 span | parent_id 指向一个没被记录下来的 span,瀑布图上挂不到树里 |
| 叶子 span | 下面没有孩子的 span,算视图时只用叶子,避免父子重复计算 |
| 增量记账 | 进入一步前记下账本,离开时再看一次,两次相减就是这一步的花费 |
| `defaultdict` | 取不存在的键时自动给默认值的字典,累加计数常用 |
| `super()` | 在子类里调用父类的同名方法,和 JS 的 `super` 一样 |
| 不带参数的 `raise` | 在 `except` 里把刚接住的异常原样再抛出去 |
| `random.seed` | 固定随机数种子,让模拟每次结果一样 |
| 预算闸门 | 每轮开始前检查累计花费,超了就停;最多超支一轮的花费 |

## 常见误区

**以为复习日的默写只要「能跑」就行。** 默写一第一版能跑、断言也过,却漏掉了「孤儿 span」这种错。默写完一定要和原版在同一组输入上逐个比,而且要故意喂一个错的版本,确认检查会红。

**检查里用 `dict.get` 的默认 None。** 「查不到」和「本来就是 None」被混成一个值,今天的孤儿 span 就是这么溜过去的。查不到要显式标出来。

**看到总花费小就不细看。** 小项目一次才 4 分钱,但分步骤一看,评测占 93%、反思占 7%,这个比例决定了省钱该砍哪里。规模放大一百倍,比例不变。

**把最慢和最贵当成同一件事。** 反思最慢(输出长),评测最贵(调用多、输入多)。优化时间和优化钱是两件事,要分开看。

**以为脱敏只发生在 SDK 里。** 自己往 span 里塞的属性(错例原文、客户的话)一样会被导出,写文件、发平台之前都要过一遍 `mask`。

**以为预算闸门能卡在预算上。** 每轮开始前检查,最多会超支一整轮。要么算上一轮的估计,要么把检查下沉到每次调用。

## 学习资料

### 文档与文章

- [OpenTelemetry · Traces](https://opentelemetry.io/docs/concepts/signals/traces/):英文,trace、span、parent、span status 的官方定义,和默写一、练习 1 对照着读,20 分钟。
- [Langfuse · Masking](https://langfuse.com/docs/observability/features/masking):英文,Day 367 的出处,复习时再读一遍「mask 要在哪里传」那一段。
- [Langfuse · Prompt Management](https://langfuse.com/docs/prompt-management/overview):英文。优化器产出的 prompt 版本要有地方存、能回滚,Langfuse 的 prompt 管理把版本和 trace 关联起来,把这一周的两半圈接上了,20 分钟。
- [DSPy · GEPA API 文档](https://dspy.ai/api/optimizers/GEPA/overview/):英文,复习五参数评分函数和预算参数。
- [Hamel Husain · Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/):英文,评测、trace、改进三件事怎么连成一个循环,和今天的知识地图是同一张图,20 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1hg1vBaETP&autoplay=0&high_quality=1" title="三张图带你理解数据脱敏" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Data老毕 · 三张图带你理解数据脱敏 · 3 分钟,中文。Day 367 推荐过,做练习 2 之前再看一遍,注意它讲的「静态脱敏」和「动态脱敏」,今天写文件前脱敏属于哪一种。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1NwNVemEyE&autoplay=0&high_quality=1" title="【IT老齐695】OpenTelemetry日志、指标、链路一站解决方案" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IT老齐 · 【IT老齐695】OpenTelemetry日志、指标、链路一站解决方案 · 23 分钟,中文。Day 366 推荐过,复习 OTel 的三类数据和 Collector,今天只用了链路这一类。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/THfB4p2xCFY" title="Langfuse Walkthrough - Full Demo of Agent Tracing, Evals, Experiments and Prompt Management" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Langfuse 官方 · Langfuse Walkthrough - Full Demo of Agent Tracing, Evals, Experiments and Prompt Management · 英文。Day 365 推荐过,复习时重点看后半段的 Experiments 和 Prompt Management:一个平台里把 trace、评测、prompt 版本串起来,就是这一周的那个圈。</figcaption>
</figure>

- Day 369 嵌的 AI Engineer 大会《Beating RL With Reflection: GEPA and Optimize Anything》,复习时可以再看前半段。

### 书籍

- Charity Majors、Liz Fong-Jones、George Miranda《Observability Engineering》(O'Reilly,2022):讲为什么要用 trace 和高基数事件去「问没想到的问题」,今天给优化循环挂 span 就是一个小例子,英文。
- Chip Huyen《AI Engineering》(O'Reilly,2025):第 4 章评测、第 5 章 prompt 工程、第 10 章反馈和监控,正好覆盖这一周的三块,英文。

### 开源项目与代码

- [langfuse/langfuse-python](https://github.com/langfuse/langfuse-python):Langfuse 的 Python SDK,复习时看 `mask` 参数在客户端初始化里是怎么被存下来、在哪里被调用的。
- [stanfordnlp/dspy](https://github.com/stanfordnlp/dspy):`dspy/teleprompt/gepa/` 目录,看 GEPA 怎么记录每个候选的父节点,和今天 span 上的 `kept` 属性对照。

## 自测

1. 这一周的六课,哪几课在「看清 Agent 做了什么」,哪几课在「按分数改它」?两半的共同教训是什么?

<details><summary>答案</summary>

Day 364–367 在看清:手写 span、接 Langfuse、用 OTel 发 Jaeger、看视图和脱敏。Day 368–369 在改:准备尺子、手调、反思循环和 GEPA。共同教训是不能只看一个数:trace 那边平均成本会被极端值拉高,要看分布、要点进去读;优化那边验证集分数是被挑出来的,要看测试集、要读新 prompt。

</details>

2. 默写 span 记录器时,`finally` 不写会怎样?今天第一版的检查为什么没发现?

<details><summary>答案</summary>

`with` 块里抛异常时,`yield` 后面的收尾代码不执行:这个 span 不出栈、不进列表,之后开的 span 都会把它当父亲,成为孤儿。第一版检查用 `names.get(parent_id)` 把父亲编号翻成名字,孤儿的父亲不在列表里,查不到返回 None,看起来和「本来就是根」一样,于是断言通过。改成查不到时显式返回 `<没记下来的 span>` 就抓到了。

</details>

3. 小项目里,为什么最慢的一步是反思,最贵的却是评测?

<details><summary>答案</summary>

反思只调 1 次模型,但要输出四五百字的新 prompt,输出 token 多,生成慢,一次 6 秒。评测一次调 20 次模型,线程池并发跑,3 秒左右就完了,但 20 次调用的输入 token 加起来是反思的好几倍,所以钱多。实测评测占 93% 的花费,反思占 7%。

</details>

4. 一个真实准确率 90% 的 prompt,在 20 条上量一次,量出 95% 以上的概率大约多少?这对读 Day 369 那张表有什么影响?

<details><summary>答案</summary>

练习 3 模拟 1 万次,约 40%;量出 85% 以下约 32%。所以两个一样好的 prompt 各量一次,差 10 个点很常见。Day 369 表里验证集的上涨、测试集一两条的差别,都落在这个噪声范围里,不能当作优化有效的证据。

</details>

5. 预算 0.03 元的闸门,为什么实际花了 0.056 元?怎么改得更严?

<details><summary>答案</summary>

闸门只在每轮开始前检查,第 2 轮开始时累计 0.021 元没超,放行后这一轮又花了约 0.024 元;最后量测试集的 0.01 元也在闸门外。改法:检查时加上一轮的估计花费;或者把检查下沉到每次调模型之前;或者像 GEPA 那样数调用次数而不是数钱。

</details>

6. (面试题)「你怎么知道一次 prompt 优化值不值?」

<details><summary>答案</summary>

要点:①先看效果:只信从头到尾没参与挑选的测试集,而且测试集要够大,20 条上一条就是 5 个点,真实 90% 的 prompt 量一次有四成机会量出 95% 以上;②再看新 prompt 本身:人逐行审,找写宽的规则和被删掉的规则,用一张「必须保留」清单在 CI 里拦;③再看成本:给优化循环本身挂 trace,按步骤记调用次数、token 和钱,我实测评测占 93%、反思占 7%,所以省钱要砍评测次数而不是换反思模型;④最后设预算闸门,夜里跑也不会失控。值不值 = 测试集上可信的提升,扣掉人审和跑优化的成本,对比手调或者先把格式改好这些更便宜的办法。

</details>

## 明天预告

Day 371 · 自动优化提示词(三):ACE 和怎么上生产。这一周看到整段重写的两个毛病:规则会写宽,也会把「重复扣款」这种关键细节写丢,而且整段重写的 diff 很难审。明天换 ACE 的思路:不重写,只往手册里一条条加规则,每条记下帮了几次、害了几次;再把三种做法放进一张对比表,讲真要上生产时怎么把优化器当成一个提 PR 的同事来用。
