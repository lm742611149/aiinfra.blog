---
title: 'Day 153 · 第 22 周复习:大模型与 API(Day 147–152)'
description: '这一周前五天讲结构化输出:求它、JSON mode、schema 约束三个层次,pydantic 一个类管 schema 和校验,校验失败把报错喂回去,字段顺序、null 出口和原文核对;最后一天拼出了命令行聊天机器人的骨架。今天画一张图串起来,用一个不联网的检查脚本验收默写的三段核心代码,再做一个「工单分拣」小工具:抽字段、核对原文、决定自动处理还是转人工。'
pubDate: 2026-10-23
regime: none
tags: ['structured-output', 'review', 'agent-zero']
series: 'agent-zero'
day: 153
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 152](/blog/agent-zero/day-152-chatbot-1/) 把第二部分的零件拼成了一个命令行聊天机器人:`input()` 循环、流式打印、`Conversation` 管多轮、四个斜杠命令。最要紧的是 `ask()` 里的回滚:请求出错或者用户按 Ctrl+C,就把刚加进历史的那一轮删掉。练习 2 去掉回滚以后,被取消的问题在下一轮「复活」,模型把已经取消的清单又写了一遍。

今天是第 22 周的复习日,不学新东西。前五天的结构化输出是 Agent 工程里用得最多的一块(第三部分的工具调用本质上就是结构化输出),值得停下来把它理一遍。

## 今天要解决的问题

学完今天你应该能做到:

1. 不看文章,说出结构化输出三个层次各保证什么、管不了什么,以及这周遇到的每一类错误该在哪一层解决。
2. 默写 `extract()`、`grounding_problems()` 和 `ChatBot.ask()`,用今天的检查脚本验收,全部打勾。
3. 用本周的东西做一个工单分拣工具:抽字段、核对原文、按规则分到「自动处理」「人工复核」「转一线客服」三条路。

预计用时:3 小时(小项目调 DeepSeek 16 次左右,不到 2 分钱)。前置:[Day 147](/blog/agent-zero/day-147-structured-1/) 到 [Day 152](/blog/agent-zero/day-152-chatbot-1/) 的全部文件,都在 `agent-zero-lab/part02/` 和 `common/structured.py` 里。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把「默写」那一节的三段代码再默写一次,跑检查脚本;做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 本周知识地图

这一周其实在回答一个问题:**模型的输出要交给程序用,怎么保证程序拿到的东西能用、而且是对的。**「能用」是格式问题,「是对的」是内容问题,这周的每样东西都落在其中一边。

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="第 22 周知识地图:左边是格式三层次,中间是 pydantic 和重试,右边是内容上的坑和对策,底部是聊天机器人">
<rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink)">格式:能不能用</text>
<rect x="20" y="38" width="190" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="60" fill="var(--ink)">求它:提示词写清格式</text>
<rect x="20" y="80" width="190" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="102" fill="var(--ink)">约束它:JSON mode</text>
<rect x="20" y="122" width="190" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="144" fill="var(--ink)">逼它:json_schema</text>
<text x="20" y="176" fill="var(--ink-soft)" font-size="11">147、148</text>
<line x1="210" y1="97" x2="240" y2="97" stroke="var(--ink-faint)"/>
<text x="240" y="26" fill="var(--ink)">本地兜底</text>
<rect x="240" y="38" width="180" height="50" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="250" y="58" fill="var(--ink)">pydantic 一个类:</text>
<text x="250" y="76" fill="var(--ink)">schema + 校验 + 对象</text>
<rect x="240" y="98" width="180" height="58" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="250" y="118" fill="var(--ink)">extract():校验失败</text>
<text x="250" y="136" fill="var(--ink)">把报错喂回去重试</text>
<text x="250" y="152" fill="var(--ink-soft)" font-size="11">截断翻倍/空内容重发</text>
<text x="240" y="176" fill="var(--ink-soft)" font-size="11">149、150、151 instructor</text>
<line x1="420" y1="97" x2="450" y2="97" stroke="var(--ink-faint)"/>
<text x="450" y="26" fill="var(--ink)">内容:对不对</text>
<rect x="450" y="38" width="170" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="460" y="60" fill="var(--ink)">推理字段放前面</text>
<rect x="450" y="80" width="170" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="460" y="102" fill="var(--ink)">可能缺的给 null</text>
<rect x="450" y="122" width="170" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="460" y="144" fill="var(--ink)">原文核对+业务规则</text>
<text x="450" y="176" fill="var(--ink-soft)" font-size="11">150、151</text>
<line x1="20" y1="196" x2="620" y2="196" stroke="var(--rule)"/>
<text x="20" y="222" fill="var(--ink)">聊天机器人骨架(152)</text>
<rect x="20" y="234" width="140" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="30" y="256" fill="var(--ink)">input 循环</text>
<rect x="170" y="234" width="140" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="180" y="256" fill="var(--ink)">stream 流式</text>
<rect x="320" y="234" width="140" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="330" y="256" fill="var(--ink)">Conversation</text>
<rect x="470" y="234" width="150" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="480" y="256" fill="var(--ink)">出错回滚一轮</text>
<text x="20" y="300" fill="var(--ink-faint)" font-size="11">共同点:模型给的东西先别信,本地检查过了再往下走;检查不过就重试、回滚或转人工</text>
</g>
</svg>
<figcaption>左边三层解决「格式」,中间 pydantic 和 extract() 在本地兜底,右边三条对策解决「内容」。聊天机器人看起来是另一件事,其实也是同一个思路:历史只在请求成功后才算数。</figcaption>
</figure>

用一句话串起来:**格式靠层次,内容靠设计和检查,两者都要在本地再验一遍。**

这周最容易混的一点是「格式全对」和「答案对」的距离。Day 148 用 schema 约束,格式 18 次全过,日期照样填错;Day 150 加了业务规则,小模型为了满足规则把 2023 改成了 2027;Day 151 必填字段逼得模型用 `0` 填金额。三次都是格式合法、内容错误,而且没有任何地方报错。

## 本周每天一句话

- [Day 147](/blog/agent-zero/day-147-structured-1/):Agent 的输出是给程序用的;随口要 JSON 18 次全部解析失败,写清格式(求它)18 次全对,JSON mode(约束它)保证是合法 JSON 却管不了键名,`response_format` 要求消息里出现「json」这个词。
- [Day 148](/blog/agent-zero/day-148-structured-2/):JSON Schema 逐个关键字读懂,本地用 jsonschema 检查;DeepSeek 官方不收 `json_schema`,换到硅基流动实跑第三层,格式全对,但字母序先写 `asked` 导致日期填错。
- [Day 149](/blog/agent-zero/day-149-structured-3/):一个 pydantic 类 `RefundFields` 同时管 schema(`model_json_schema()`)、校验(`model_validate_json()`)和拿到能直接用的对象;`schema_prompt()` 把 schema 写进提示词,在 DeepSeek 上 18 次全过。
- [Day 150](/blog/agent-zero/day-150-structured-4/):`model_validator` 写 schema 表达不了的业务规则;原样重试三次错三次,把报错喂回去就能改;写成通用的 `common/structured.py` 里的 `extract()`,截断、空内容、校验失败分开处理,超过上限抛 `ExtractionError`。
- [Day 151](/blog/agent-zero/day-151-structured-5/):推理字段放前面 9/24 变 24/24;各家输出键的顺序不一样;必填字段会逼出占位值,给 `null` 出口;抽出来的编号要在原文里找得到;instructor 做的就是 `extract()` 那一套。
- [Day 152](/blog/agent-zero/day-152-chatbot-1/):命令行聊天机器人骨架,`import readline` 修方向键,`Conversation` 记多轮,`ask()` 出错就删掉这一轮,不然被取消的问题会复活。

## 默写三段核心代码

这周要能默写的是三段:`common/structured.py` 的 `extract()`(Day 150)、`part02/grounding.py` 的 `grounding_problems()`(Day 151)、`part02/chatbot.py` 的 `ChatBot.ask()`(Day 152)。

先合上前面的文章,在新文件里把这三段写出来(可以先把原文件改名备份,比如 `structured.py.bak`,默写完放回原位置)。写完别急着对答案,跑下面这个检查脚本。它用假客户端测每个分支,**不联网、不花钱**,哪条打叉就回去看哪一段。

新建 `part02/review153_check.py`:

```python
# agent-zero-lab/part02/review153_check.py
"""默写完 extract()、grounding_problems()、ChatBot.ask() 后跑这个脚本,不联网、不花钱。"""
import logging
from collections.abc import Iterator
from typing import Any

from common.structured import ExtractionError, extract
from part02.chatbot import ChatBot
from part02.extract_fake import CUT, EARLY, GOOD, FakeClient
from part02.grounding import grounding_problems
from part02.pitfall_models import TicketNullable
from part02.refund_rules import RefundChecked

logging.getLogger("common.structured").setLevel(logging.ERROR)


def check(name: str, ok: bool) -> None:
    print("✓" if ok else "✗", name)


def check_extract() -> None:
    fake = FakeClient([(EARLY, "stop"), (GOOD, "stop")])
    info = extract(fake, RefundChecked, "抽字段", "工单")
    check("extract:业务规则错一次,第二次带着报错改对", str(info.asked) == "2026-10-20" and fake.calls[1]["n_messages"] == 4)
    fake = FakeClient([(CUT, "length"), (GOOD, "stop")])
    extract(fake, RefundChecked, "抽字段", "工单")
    check("extract:截断时 max_tokens 翻倍、不加消息", fake.calls[1] == {"n_messages": 2, "max_tokens": 1000})
    fake = FakeClient([(EARLY, "stop")] * 3)
    try:
        extract(fake, RefundChecked, "抽字段", "工单")
        check("extract:一直错要抛 ExtractionError,一共调 3 次", False)
    except ExtractionError:
        check("extract:一直错要抛 ExtractionError,一共调 3 次", len(fake.calls) == 3)


def check_grounding() -> None:
    src = "订单 CL-20261020-0000731942 申请退款"
    bad = TicketNullable(order_id="", email=None, amount=0, summary="x")
    good = TicketNullable(order_id="CL-20261020-0000731942", email=None, amount=None, summary="x")
    check("grounding:空字符串和 0 都要报", len(grounding_problems(bad, src)) == 2)
    check("grounding:None 和原文里有的值不报", grounding_problems(good, src) == [])


class InterruptingClient:
    """假的 LLMClient:吐两段字以后模拟用户按 Ctrl+C。"""

    model = "fake"

    def stream(self, messages: list[dict[str, Any]], **kw: Any) -> Iterator[str]:
        yield "好的,"
        yield "第一条"
        raise KeyboardInterrupt


def check_rollback() -> None:
    bot = ChatBot(None)
    bot.client = InterruptingClient()  # pyright: ignore[reportAttributeAccessIssue]
    bot.ask("写一份长清单")
    check("ask:中断后这一轮被删掉", bot.conv.turns == [])


if __name__ == "__main__":
    check_extract()
    check_grounding()
    check_rollback()
```

<div class="line-notes">

- `from part02.extract_fake import CUT, EARLY, GOOD, FakeClient` 直接复用 Day 150 的假客户端和三段假回复:`GOOD` 是正确的四个字段,`EARLY` 是申请日期写成 2023 的那份,`CUT` 是被截断的半截 JSON。`FakeClient` 按顺序吐回复,并在 `calls` 里记下每次请求的消息条数和 `max_tokens`。
- `logging.getLogger("common.structured").setLevel(logging.ERROR)` `extract()` 每次校验失败都会打 WARNING,这里只想看打勾打叉,把这个模块的日志级别调高,WARNING 就不显示了。Day 150 讲过每个模块一个 logger,名字就是模块路径,所以能单独调它。
- `def check(name: str, ok: bool) -> None:` 最简单的「断言」:对了打 ✓,错了打 ✗,不会因为一条失败就停下(和 `assert` 不同),一次能看到全部结果。正式项目用 pytest([Day 71](/blog/agent-zero/day-071-pytest-1/)),这里为了一个文件跑完就用最朴素的写法。
- `fake = FakeClient([(EARLY, "stop"), (GOOD, "stop")])` 剧本:第一次给错日期,第二次给对的。
- `check("extract:业务规则错一次,第二次带着报错改对", str(info.asked) == "2026-10-20" and fake.calls[1]["n_messages"] == 4)` 两个条件:最后拿到的是对的日期;第二次请求有 4 条消息(system、user、模型的错误回答、纠错消息)。如果你默写时忘了 `messages.append(r.message)`,第二次就只有 3 条,这一条会打叉。
- `check("extract:截断时 max_tokens 翻倍、不加消息", fake.calls[1] == {"n_messages": 2, "max_tokens": 1000})` 截断后第二次请求:消息还是 2 条,`max_tokens` 从默认 500 翻到 1000。
- `fake = FakeClient([(EARLY, "stop")] * 3)` 列表乘 3,三次都给错的,测重试上限。
- `check("extract:一直错要抛 ExtractionError,一共调 3 次", False)` 走到 `try` 里这一行说明没抛异常,直接判错。
- `check("extract:一直错要抛 ExtractionError,一共调 3 次", len(fake.calls) == 3)` 默认 `max_retries=2`,加第一次一共 3 次。写成 `range(max_retries)` 的话只会调 2 次。
- `bad = TicketNullable(order_id="", email=None, amount=0, summary="x")` 用关键字参数直接建 pydantic 对象,`''` 和 `0` 是 Day 151 小模型真实填过的占位值。
- `check("grounding:空字符串和 0 都要报", len(grounding_problems(bad, src)) == 2)` 忘了单独判断空字符串的话,`"" in src` 是 `True`,只会报 1 条。
- `class InterruptingClient:` 一个只有 `model` 属性和 `stream()` 方法的假客户端,够 `ask()` 用。
- `raise KeyboardInterrupt` 在生成器里抛出,`ask()` 的 `for piece in ...` 那一行就会收到这个异常,和真按 Ctrl+C 一样。
- `bot = ChatBot(None)` 正常建一个机器人。`LLMClient` 构造时只读 `.env`,不联网。
- `bot.client = InterruptingClient()  # pyright: ignore[reportAttributeAccessIssue]` 把真客户端换成假的。类型不一样(`InterruptingClient` 不是 `LLMClient`),类型检查器会画红线,用注释压掉。测试里这样换零件很常见,Day 137 也这么做过。
- `check("ask:中断后这一轮被删掉", bot.conv.turns == [])` 中断前 `add_user` 加了一轮,回滚后应该是空列表。

</div>

在 `agent-zero-lab` 根目录跑(`-u` 让 `ask()` 打印的字和打勾的顺序对得上):

```bash
cd ~/agent-zero-lab
uv run python -u -m part02.review153_check
```

原版代码的输出:

```text
✓ extract:业务规则错一次,第二次带着报错改对
✓ extract:截断时 max_tokens 翻倍、不加消息
✓ extract:一直错要抛 ExtractionError,一共调 3 次
✓ grounding:空字符串和 0 都要报
✓ grounding:None 和原文里有的值不报
助手:好的,第一条
[已中断] 这一轮没记进历史
✓ ask:中断后这一轮被删掉
```

为了确认检查脚本真能抓到错,我把 `ChatBot` 换成 Day 152 练习 2 里去掉回滚的 `NoRollbackBot` 再跑最后一项:

```bash
uv run python -c "
from part02 import review153_check as r
from part02.ex152_no_rollback import NoRollbackBot
r.ChatBot = NoRollbackBot
r.check_rollback()"
```

```text
助手:好的,第一条
[已中断] 但这一轮留在了历史里
✗ ask:中断后这一轮被删掉
```

打叉了。一个检查脚本只有在你见过它失败之后才值得信,这条习惯第六部分做评测时还会反复用到。

## 小项目:工单分拣

需求:云簿每天收到一批工单,要先抽出关键信息,再决定怎么处理。三条路:

- **自动处理**:诉求是退款或开票,抽出来的东西原文核对没问题,而且能确定是哪个客户。
- **人工复核**:抽取失败、原文核对有问题、或者退款工单里既没有订单号也没有邮箱。
- **转一线客服**:不是退款也不是开票,比如问功能怎么用。

只用本周的东西:pydantic 类、推理字段放前面、`null` 出口、`extract()`、`grounding_problems()`。

### 第 1 步:定义抽取的类,先踩一个继承的坑

Day 151 的 `TicketNullable` 已经有 `order_id`、`email`、`amount`、`summary` 四个字段,现在要加两个:`analysis`(先分析)和 `intent`(诉求)。第一反应是继承它,加两个字段。先看看继承出来的字段顺序。新建 `part02/triage_models.py`:

```python
# agent-zero-lab/part02/triage_models.py
from typing import Literal

from pydantic import BaseModel, Field

from part02.pitfall_models import TicketNullable


class TriageByInherit(TicketNullable):
    analysis: str = Field(description="先用一两句话分析客户要做什么、原文给了哪些编号、邮箱、金额")
    intent: Literal["退款", "开票", "其他"] = Field(description="客户诉求")


class TicketTriage(BaseModel):
    analysis: str = Field(description="先用一两句话分析客户要做什么、原文给了哪些编号、邮箱、金额")
    intent: Literal["退款", "开票", "其他"] = Field(description="客户诉求:退款、开票,或者其他")
    order_id: str | None = Field(description="客户要处理的那张发票号或订单号,逐字符原样抄写;没有就填 null")
    email: str | None = Field(description="客户邮箱,原文里没有就填 null")
    amount: int | None = Field(description="客户明确写出的退款金额,单位元;原文没写数字就填 null,不要推算")
    summary: str = Field(description="一句话概括客户的原话,20 字以内,不要补充原文没有的信息")

    def as_nullable(self) -> TicketNullable:
        return TicketNullable(order_id=self.order_id, email=self.email, amount=self.amount, summary=self.summary)


if __name__ == "__main__":
    print("继承版字段顺序:", list(TriageByInherit.model_fields))
    print("独立版字段顺序:", list(TicketTriage.model_fields))
```

<div class="line-notes">

- `class TriageByInherit(TicketNullable):` 继承版,只为了看字段顺序,后面不用它。
- `analysis: str = Field(description="先用一两句话分析` 推理字段,按 Day 151 的结论应该排第一。
- `intent: Literal["退款", "开票", "其他"] = Field(description="客户诉求")` `Literal` 限定三个取值([Day 47](/blog/agent-zero/day-047-type-hints-3/)),schema 里变成 `enum`。给一个「其他」兜底,不然问功能的工单模型只能硬塞进退款或开票。
- `class TicketTriage(BaseModel):` 独立版,六个字段按我们要的顺序从头写。
- `summary: str = Field(description="一句话概括客户的原话,20 字以内` 比 Day 151 多了长度要求,那天的 `summary` 基本是把原文抄一遍。
- `def as_nullable(self) -> TicketNullable:` 转成 `TicketNullable`,好直接交给 Day 151 的 `grounding_problems()`(它的参数类型只认 `TicketStrict | TicketNullable`)。不继承,但用一个小方法转换,这就是 [Day 42](/blog/agent-zero/day-042-classes-2/) 说的「组合优先」。
- `print("继承版字段顺序:", list(TriageByInherit.model_fields))` 打印两个类的字段顺序对比。

</div>

```bash
uv run python -m part02.triage_models
```

```text
继承版字段顺序: ['order_id', 'email', 'amount', 'summary', 'analysis', 'intent']
独立版字段顺序: ['analysis', 'intent', 'order_id', 'email', 'amount', 'summary']
```

继承版里 `analysis` 跑到了最后:pydantic 先放父类的字段,再放子类新加的。推理字段在最后就是 Day 151 那个「先报数再写理由」,白写。这是本周两个知识点撞在一起的坑,不打印一次根本看不出来。

### 第 2 步:抽取、核对、分路

八张工单:Day 151 那四张专挑的,再加四张新的(一张月付退款、一张改发票抬头、一张写了金额的退款、一张问功能的)。新建 `part02/triage_extract.py`:

```python
# agent-zero-lab/part02/triage_extract.py
import json
import logging
import sys
from pathlib import Path

from common.llm import LLMClient
from common.structured import ExtractionError, extract
from part02.grounding import grounding_problems
from part02.pitfall_tickets import PITFALL
from part02.triage_models import TicketTriage

logging.basicConfig(level=logging.WARNING, format="  %(levelname)s %(message)s")
INSTRUCTIONS = "你是云簿 CloudLedger 的工单分拣员。从客户工单里抽取信息,只抽原文里有的。"
TICKETS = PITFALL + [
    "月付 199 那个,2026 年 10 月 1 日开的,3 号就不想用了,能退吗",
    "INV-2026-005120 这张票的抬头写错了,应该是「上海云簿信息科技有限公司」,麻烦重开,发到 fin@shyunbu.cn",
    "我上个月充了 299 的年付,结果被扣了两次,把多的那 299 退给我",
    "你们的导出功能怎么老是卡住?",
]
OUT = Path("part02/data/triage_153.jsonl")


def route(info: TicketTriage | None, problems: list[str]) -> str:
    if info is None or problems:
        return "人工复核"
    if info.intent == "其他":
        return "转一线客服"
    return f"自动:{info.intent}"


def main(env_file: str | None = None, model: str | None = None) -> None:
    client = LLMClient(env_file, **({"model": model} if model else {}))
    OUT.parent.mkdir(exist_ok=True)
    rows: list[dict[str, object]] = []
    for ticket in TICKETS:
        try:
            info = extract(client, TicketTriage, INSTRUCTIONS, ticket, max_tokens=600)
            problems = grounding_problems(info.as_nullable(), ticket)
        except ExtractionError as e:
            info, problems = None, [f"抽取失败:{str(e).splitlines()[0]}"]
        where = route(info, problems)
        print(f"[{where}] {ticket[:26]}")
        if info:
            print(f"    {info.intent} | order_id={info.order_id} email={info.email} amount={info.amount} | {info.summary}")
        for p in problems:
            print(f"    ! {p}")
        rows.append({"ticket": ticket, "route": where, "fields": info.model_dump() if info else None, "problems": problems})
    with OUT.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"写入 {OUT}({len(rows)} 行)|", client.ledger)


if __name__ == "__main__":
    main(*sys.argv[1:3])
```

<div class="line-notes">

- `import sys` 用 `sys.argv` 从命令行接可选的配置文件和模型名([Day 44](/blog/agent-zero/day-044-notebook-project/)),练习 2 要换小模型跑。
- `INSTRUCTIONS = "你是云簿 CloudLedger 的工单分拣员。` 指令很短,要求都在字段说明里。「只抽原文里有的」再强调一次。
- `TICKETS = PITFALL + [` 两个列表用 `+` 拼成一个新列表,相当于 JS 的 `[...PITFALL, ...]`。
- `OUT = Path("part02/data/triage_153.jsonl")` 结果存成 JSONL:一行一个 JSON 对象。比一个大 JSON 数组好处是能一行行追加,坏了一行不影响别的行,日志和评测数据常用这种格式。
- `def route(info: TicketTriage | None, problems: list[str]) -> str:` 分路规则单独写成一个纯函数,不调模型,好测、好改。
- `if info is None or problems:` 抽取失败,或者原文核对有问题(非空列表是真值),一律转人工。
- `if info.intent == "其他":` 不是退款、开票的转一线。
- `client = LLMClient(env_file, **({"model": model} if model else {}))` 有模型名就作为 `model=` 传进去覆盖 `.env` 里的,没有就传空字典。`**` 把字典展开成关键字参数([Day 30](/blog/agent-zero/day-030-functions-3/)),相当于 JS 的 `...(model ? {model} : {})`。
- `OUT.parent.mkdir(exist_ok=True)` 确保 `part02/data/` 目录存在([Day 37](/blog/agent-zero/day-037-pathlib/))。
- `rows: list[dict[str, object]] = []` 每张工单一条记录,最后统一写文件。
- `info = extract(client, TicketTriage, INSTRUCTIONS, ticket, max_tokens=600)` 多了一个 `analysis` 字段,`max_tokens` 给宽一点。
- `problems = grounding_problems(info.as_nullable(), ticket)` 转成 `TicketNullable` 交给 Day 151 的核对函数。
- `info, problems = None, [f"抽取失败:{str(e).splitlines()[0]}"]` 抽取失败时两个变量一起赋值,问题清单里只放报错的第一行。
- `print(f"[{where}] {ticket[:26]}")` 每张工单先打印去向和原文前 26 个字。
- `rows.append({"ticket": ticket, "route": where, "fields": info.model_dump() if info else None, "problems": problems})` `model_dump()` 转成普通字典才能 `json.dumps`。
- `with OUT.open("w", encoding="utf-8") as f:` 写文件([Day 38](/blog/agent-zero/day-038-files-with/)),每行一个 `json.dumps(..., ensure_ascii=False)` 加换行。
- `main(*sys.argv[1:3])` `sys.argv[1:3]` 取命令行的第 1、2 个参数(可能没有,就是空列表),`*` 展开传给 `main`。不带参数运行就是 `main()`,用默认的 `.env`。

</div>

```bash
uv run python -u -m part02.triage_extract
```

我的输出(2026-10-23,DeepSeek `deepseek-flash`):

```text
[自动:退款] 发票 INV-2026-004417 被重复扣款了两
    退款 | order_id=INV-2026-004417 email=None amount=None | 发票被重复扣款两次，要求处理
[自动:退款] 上个月被扣了两次钱,我只要退多扣的那一次。账号是 l
    退款 | order_id=None email=lin.wei@cloudmail.cn amount=None | 上个月被扣两次钱，要求退多扣的一次
[自动:退款] 订单 CL-20261020-0000731942 
    退款 | order_id=CL-20261020-0000731942 email=None amount=None | 申请订单 CL-20261020-0000731942 退款
[自动:开票] 你好,我想问一下年付能不能开专票?
    开票 | order_id=None email=None amount=None | 询问年付能否开专票
[自动:退款] 月付 199 那个,2026 年 10 月 1 日开
    退款 | order_id=None email=None amount=None | 月付199元开通两天后想退款
[自动:开票] INV-2026-005120 这张票的抬头写错了,
    开票 | order_id=INV-2026-005120 email=fin@shyunbu.cn amount=None | 发票抬头写错，要求重开并发送邮箱
[自动:退款] 我上个月充了 299 的年付,结果被扣了两次,把多的
    退款 | order_id=None email=None amount=299 | 年付被扣两次，要求退多扣的299
[转一线客服] 你们的导出功能怎么老是卡住?
    其他 | order_id=None email=None amount=None | 客户反馈导出功能经常卡住
写入 part02/data/triage_153.jsonl(8 行)| 8 次调用 | 输入 3309 / 输出 580 tokens | 约 ¥0.0077
```

抽取本身挺干净:没有占位值,原文核对一条问题都没有,「开专票」这次没被改成「开发票」,问功能的那张正确地分到了「其他」。8 次调用,一次重试都没有,不到 1 分钱。

### 第 3 步:看结果,发现规则漏了

先别高兴,逐条看去向。第 5 张(月付 199)和第 7 张(299 扣两次)都是「自动:退款」,可它们的 `order_id` 和 `email` 都是 `None`。**退款要退给谁?** 系统拿着一张没有订单号、没有邮箱的退款工单,根本找不到是哪个客户。自动处理只能失败,或者更糟,退错人。

这不是模型的错,模型老老实实填了 `null`。是我们的分路规则漏了一条业务约束。这和 Day 145 「规则没写清谁也算不对」、Day 150 「业务规则要写在 pydantic 这一侧」是同一类问题:模型负责抽,**判断能不能自动走,是程序的事**。

### 第 4 步:把规则补上

在 `route()` 里「转一线客服」那个判断后面加两行:

```python
# agent-zero-lab/part02/triage_extract.py 里 route() 的新版本
def route(info: TicketTriage | None, problems: list[str]) -> str:
    if info is None or problems:
        return "人工复核"
    if info.intent == "其他":
        return "转一线客服"
    if info.intent == "退款" and info.order_id is None and info.email is None:
        return "人工复核(找不到是哪个客户)"
    return f"自动:{info.intent}"
```

<div class="line-notes">

- `if info.intent == "退款" and info.order_id is None and info.email is None:` 退款工单,订单号和邮箱一个都没有,就没法定位客户。开票工单(比如问能不能开专票)没订单号可以先回答政策,所以只对退款加这条。
- `return "人工复核(找不到是哪个客户)"` 把原因写进去向里,复核的人一眼知道要先去问客户是谁。

</div>

再跑一次(只看去向那几行):

```text
[自动:退款] 发票 INV-2026-004417 被重复扣款了两
[自动:退款] 上个月被扣了两次钱,我只要退多扣的那一次。账号是 l
[自动:退款] 订单 CL-20261020-0000731942 
[自动:开票] 你好,我想问一下年付能不能开专票?
[人工复核(找不到是哪个客户)] 月付 199 那个,2026 年 10 月 1 日开
[自动:开票] INV-2026-005120 这张票的抬头写错了,
[人工复核(找不到是哪个客户)] 我上个月充了 299 的年付,结果被扣了两次,把多的
[转一线客服] 你们的导出功能怎么老是卡住?
写入 part02/data/triage_153.jsonl(8 行)| 8 次调用 | 输入 3309 / 输出 579 tokens | 约 ¥0.0072
```

两张找不到客户的退款转了人工,其余不变。两次运行一共 16 次调用,约 1.5 分钱。

这个小工具很粗糙(规则只有几行,也没有评测集),但它的形状和真实系统一样:**模型抽、程序核对、规则分路、拿不准的交给人**。第三部分做工单分流 Agent、第八部分做 SupportPilot,都是在这个骨架上加东西。

## 本周错题与坑清单

| 坑 | 在哪天踩的 | 一句话对策 |
| --- | --- | --- |
| 随口要 JSON,模型套上 markdown 代码块 | 147 | 提示词写清「不要代码块」,开 JSON mode |
| JSON mode 请求里没出现「json」这个词 | 147 | 消息里一定写上 json |
| JSON mode 只保证合法 JSON,键名随模型 | 147 | 提示词写清键名,或用 schema |
| DeepSeek 官方不收 `json_schema`(400) | 148、151 | 用硅基流动或 JSON mode + schema 写进提示词 |
| 硅基流动按字母序输出键,`asked` 先写,日期填错 | 148 | 字段名起清楚,换厂商先看原始输出的键顺序 |
| 思考模式和 schema 放一起写出空白 | 148 | 抽取任务关掉思考 |
| pydantic 类给了默认值,schema 里就不再必填 | 149 | 可能缺的字段写 `X \| None`,不给默认值 |
| 原样重试,`temperature=0` 下三次一样错 | 150 | 把模型的错误回答和报错原文一起追加 |
| 业务规则太宽,模型改出 2027 满足规则 | 150 | 规则贴近真实约束,最终正确率靠评测集 |
| 答案字段在推理字段前面,理由对、答案错 | 151 | 推理字段放第一位,并设成必填 |
| 必填字段被逼出 `''`、`0`、`'未提及'` | 151 | 给 `null` 出口,原文核对 |
| 子串核对放过空串和截尾编号 | 151 | 空串单独判,编号用正则整串比较 |
| instructor 和新版 openai 依赖冲突 | 151 | 单独建试用项目,别降级主项目 |
| 脚本里方向键打出 `^[[D` | 152 | `import readline` |
| 出错不回滚,被取消的问题复活 | 152 | `ask()` 里三个 `except` 都 `turns.pop()` |
| 中断的流式调用没进本地账单 | 152 | 记住服务端照样计费,Day 154 处理 |
| 继承让推理字段跑到最后 | 153 | 字段顺序重要的类不继承,单独写 |
| 模型填了 `null`,分路规则却照样自动处理 | 153 | 能不能自动走由程序的业务规则决定 |

## 动手练习

练习 1 调 DeepSeek 3 次左右;练习 2 调硅基流动的小模型 8 次;练习 3 不调 API。合计约 2 分钱。

**练习 1:给聊天机器人加一个 `/extract` 命令。** 用 Day 152 练习里的子类写法,不改 `chatbot.py`:输入 `/extract` 时,把历史里所有 user 消息拼成一段,用 `extract()` 抽成 `TicketTriage`,打印 JSON 和原文核对结果。抽取这次调用不进对话历史。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/ex153_extract_cmd.py
import json

from common.structured import ExtractionError, extract
from part02.chatbot import ChatBot
from part02.grounding import grounding_problems
from part02.triage_extract import INSTRUCTIONS
from part02.triage_models import TicketTriage


class ExtractBot(ChatBot):
    def handle_command(self, line: str) -> bool:
        if line != "/extract":
            return super().handle_command(line)
        users = [turn[0]["content"] for turn in self.conv.turns]
        if not users:
            print("还没有可以抽取的话")
            return True
        text = "\n".join(users)
        try:
            info = extract(self.client, TicketTriage, INSTRUCTIONS, text)
        except ExtractionError as e:
            print("抽取失败:", e)
            return True
        print(json.dumps(info.model_dump(), ensure_ascii=False, indent=2))
        print("原文核对:", grounding_problems(info.as_nullable(), text) or "没问题")
        return True


if __name__ == "__main__":
    ExtractBot(None).run()
```

<div class="line-notes">

- `from part02.triage_extract import INSTRUCTIONS` 复用小项目的指令。`triage_extract.py` 有 `if __name__ == "__main__":`,导入时不会跑那 8 张工单。
- `if line != "/extract":` 不是这个命令就交给父类,其余命令照常。
- `users = [turn[0]["content"] for turn in self.conv.turns]` 每一轮的第 0 条是 user 消息,只要客户说的话,不要助手的回答(助手的话里会复述编号,原文核对就不准了)。
- `text = "\n".join(users)` 多轮拼成一段,一张工单常常是客户分几句说完的。
- `info = extract(self.client, TicketTriage, INSTRUCTIONS, text)` `LLMClient` 有 `chat()` 方法,满足 `extract()` 要的 `ChatClient` 协议,直接传。这次调用记进 `ledger`,但没碰 `self.conv`,所以不进对话历史。
- `print(json.dumps(info.model_dump(), ensure_ascii=False, indent=2))` 缩进 2 格打印,中文原样。

</div>

```bash
printf '你好,我的发票 INV-2026-004417 被扣了两次\n邮箱是 lin.wei@cloudmail.cn,多扣的 2388 退给我就行\n/extract\n/history\n/quit\n' | uv run python -m part02.ex153_extract_cmd
```

我的输出:

```text
已连接 deepseek-flash。输入 /help 查看命令。

你:助手:你好，我这边无法直接查询账户或发票记录，所以不能确认扣款情况。建议你提供发票号 INV-2026-004417 联系人工客服核实处理。

你:助手:明白，但我这边无法直接操作退款，也不能确认这笔扣款。请把发票号 INV-2026-004417 和邮箱 lin.wei@cloudmail.cn 一并提交给人工客服，由他们核实后处理退款。

你:{
  "analysis": "客户反映发票 INV-2026-004417 被重复扣款，要求退还多扣的 2388 元，并提供了邮箱 lin.wei@cloudmail.cn。",
  "intent": "退款",
  "order_id": "INV-2026-004417",
  "email": "lin.wei@cloudmail.cn",
  "amount": 2388,
  "summary": "发票被扣两次，要求退多扣的2388元"
}
原文核对: 没问题

你:记着 2 轮,最多发最近 10 轮给模型

你:
再见。 3 次调用 | 输入 569 / 输出 178 tokens | 约 ¥0.0021
```

信息分两句给的,抽取把它们合在了一起;`/history` 还是 2 轮,抽取没混进对话。这其实就是客服 Agent 的雏形:一边聊,一边把聊出来的信息变成结构化的工单。

</details>

**练习 2:换 7B 小模型跑小项目,看分拣结果变成什么样。** `triage_extract.py` 接受两个命令行参数(配置文件、模型名)。用硅基流动的 `Qwen/Qwen2.5-7B-Instruct` 跑一次,对比 DeepSeek 的结果,找出小模型出的错,判断哪些被规则或核对拦住了、哪些没拦住。

<details><summary>参考答案</summary>

```bash
uv run python -u -m part02.triage_extract .env.sf Qwen/Qwen2.5-7B-Instruct
```

我的输出(2026-10-23):

```text
[人工复核(找不到是哪个客户)] 发票 INV-2026-004417 被重复扣款了两
    退款 | order_id=None email=None amount=None | 发票 INV-2026-004417 被重复扣款两次
[自动:退款] 上个月被扣了两次钱,我只要退多扣的那一次。账号是 l
    退款 | order_id=None email=lin.wei@cloudmail.cn amount=None | 上个月被多扣钱,要求退款
[自动:退款] 订单 CL-20261020-0000731942 
    退款 | order_id=CL-20261020-0000731942 email=None amount=None | 订单CL-20261020-0000731942申请退款
[自动:开票] 你好,我想问一下年付能不能开专票?
    开票 | order_id=None email=None amount=None | 询问年付能否开专票
[人工复核] 月付 199 那个,2026 年 10 月 1 日开
    退款 | order_id=20261001 email=None amount=None | 2026年10月1日的月付199订单,10月3日不想用了,能退吗？
    ! order_id='20261001' 在原文里找不到
[自动:开票] INV-2026-005120 这张票的抬头写错了,
    开票 | order_id=INV-2026-005120 email=fin@shyunbu.cn amount=None | 需要重开抬头错误的发票，新的抬头是上海云簿信息科技有限公司，发到指定邮箱。
[人工复核(找不到是哪个客户)] 我上个月充了 299 的年付,结果被扣了两次,把多的
    退款 | order_id=None email=None amount=299 | 上个月充了299元年付，被扣了两次，要求退多扣的299元。
[转一线客服] 你们的导出功能怎么老是卡住?
    其他 | order_id=None email=None amount=None | 反馈导出功能经常卡住
写入 part02/data/triage_153.jsonl(8 行)| 8 次调用 | 输入 3225 / 输出 662 tokens | 约 ¥0.0156
```

小模型出了三类错:

- **漏抽**:第 1 张工单明明写着 `INV-2026-004417`,它填了 `null`(`summary` 里却写出了这个号)。原文核对查不出漏抽,因为 `None` 是合法的;但第 4 步补的规则把它拦进了人工复核。规则本来是为「客户没给」写的,对「模型没抽到」同样有效。
- **编造**:第 5 张工单把日期 `2026 年 10 月 1 日` 拼成了 `order_id=20261001`。原文里没有这串字符,原文核对拦住了。
- **没守长度**:好几条 `summary` 超过 20 字。这一条没有任何检查,要拦就得在 pydantic 里加 `max_length`,或者在 `route()` 前检查。

没拦住的呢?这一次没有。但只要漏抽的是 `email` 而 `order_id` 抽到了,或者反过来,规则就会放行,而工单其实少了信息。这说明同一套代码,换个便宜模型,错误率会变,检查和规则能挡住一部分,挡不住的要用评测集量出来。DeepSeek 那次 8 张全干净,小模型 8 张里 2 张出错被拦,1 张漏抽被规则顺带拦住。

注意:这次运行会覆盖 `part02/data/triage_153.jsonl`。做练习 3 前,先不带参数用 DeepSeek 再跑一次,或者把文件名改了再跑小模型。

</details>

**练习 3:统计分拣结果。** 读 `part02/data/triage_153.jsonl`(DeepSeek 第 4 步那次的结果),统计每条路各多少张、占比多少,算出自动处理率。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/ex153_report.py
import json
from collections import Counter
from pathlib import Path

rows = [json.loads(line) for line in Path("part02/data/triage_153.jsonl").read_text(encoding="utf-8").splitlines()]
routes = Counter(row["route"] for row in rows)
print(f"共 {len(rows)} 张")
for route, n in routes.most_common():
    print(f"  {route}: {n} 张 ({n / len(rows):.0%})")
auto = sum(n for route, n in routes.items() if route.startswith("自动"))
print(f"自动处理率 {auto / len(rows):.0%}")
```

<div class="line-notes">

- `from collections import Counter` 专门用来计数的字典,传一个可迭代对象,它数出每个值出现几次。相当于 JS 里 `reduce` 出一个 `{值: 次数}` 对象。
- `rows = [json.loads(line) for line in Path(...).read_text(encoding="utf-8").splitlines()]` JSONL 的读法:读全文,按行切开,每行 `json.loads` 一次。
- `routes = Counter(row["route"] for row in rows)` 括号里是生成器表达式,不用先建列表。
- `for route, n in routes.most_common():` 按次数从多到少排好返回 `(值, 次数)` 列表。
- `print(f"  {route}: {n} 张 ({n / len(rows):.0%})")` `:.0%` 把小数格式化成不带小数位的百分数,0.375 显示成 `38%`。
- `auto = sum(n for route, n in routes.items() if route.startswith("自动"))` 「自动:退款」「自动:开票」加起来。

</div>

```bash
uv run python -m part02.ex153_report
```

```text
共 8 张
  自动:退款: 3 张 (38%)
  自动:开票: 2 张 (25%)
  人工复核(找不到是哪个客户): 2 张 (25%)
  转一线客服: 1 张 (12%)
自动处理率 62%
```

8 张里 5 张自动处理。这个数单独看没意义,要和「自动处理里有多少是错的」放在一起看:自动率高、错得多,不如自动率低一点。怎么量后者,是第六部分评测的内容。

</details>

**验收标准:** 检查脚本 6 项全打勾;能对着知识地图讲清三个层次和三条内容对策;小项目跑通并能解释第 3 步为什么要补规则;练习 2 能分清哪类错被核对拦住、哪类被规则拦住、哪类没人管。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 三个层次 | 结构化输出的三种做法:求它(提示词写清格式)、约束它(JSON mode)、逼它(服务端 schema 约束解码) |
| JSONL | 每行一个 JSON 对象的文本文件,适合一条条追加,日志和评测数据常用 |
| 分路 / 路由(route) | 根据抽取结果和规则决定一条工单走哪条处理流程,比如自动处理或转人工 |
| 人工复核队列 | 程序拿不准的工单交给人看的地方,是自动化系统的兜底 |
| 自动处理率 | 不经人工就处理完的工单占比,要和自动处理的出错率一起看 |
| `Counter` | 标准库 `collections` 里的计数字典,`most_common()` 按次数排序 |
| 漏抽 | 原文里有的信息,模型填了 `null`。原文核对查不出来 |

本周其余的术语都在当天的名词解释里:schema、JSON mode、`model_validator`、带错误重试、推理字段、占位值、原文核对、instructor、REPL、回滚等。

## 常见误区

**以为用了 schema 约束就不用本地校验了。** schema 管格式不管值,业务规则 schema 也写不出来。不管走哪一层,本地都要 `model_validate_json` 一次。

**以为校验通过就是答对了。** 2027 年的日期、`0` 元的金额、错选的那张订单号,全都能通过校验。

**改类的时候随手继承。** 子类新加的字段排在父类字段后面,推理字段会跑到最后。字段顺序重要的类单独写,用一个小方法转换。

**让模型决定能不能自动处理。** 模型负责抽,能不能自动走要由程序里写死的业务规则决定(比如退款必须能定位到客户),规则可以测,模型的判断测不全。

**默写完不跑检查就算过关。** 漏掉 `messages.append(r.message)`、写成 `range(max_retries)`、忘了单独判空字符串,这些肉眼很难看出来,检查脚本一跑就打叉。

**检查脚本没见它失败过就相信它。** 今天专门用去掉回滚的版本让它打一次叉,确认它真能抓到问题。

**换便宜模型只看能不能跑通。** 练习 2 里 7B 模型同样跑完了 8 张,但漏抽一张、编造一张。换模型后要重新看错例,最好有评测集。

## 学习资料

### 文档与文章

- [pydantic:Validators](https://docs.pydantic.dev/latest/concepts/validators/):英文,复习 `model_validator` 的 after 模式,以及 Day 151 练习 3 用到的 `ValidationInfo.context`。
- [OpenAI:Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs):英文,从头读一遍,对照这周学的三个层次,看它怎么描述 JSON mode 和 Structured Outputs 的区别。
- [instructor:Re-asking with validation](https://python.useinstructor.com/concepts/reask_validation/):英文,和自己写的 `extract()` 对照复习。
- [DeepSeek 文档:多轮对话](https://api-docs.deepseek.com/zh-cn/guides/multi_round_chat):中文,复习 Day 152 的多轮历史。
- [Python 文档:collections.Counter](https://docs.python.org/zh-cn/3.12/library/collections.html#collections.Counter):中文,练习 3 用的计数字典。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV191TY6KEJX&autoplay=0&high_quality=1" title="面试官问：大模型如何稳定地输出JSON？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Agent开发实战 · 面试官问:大模型如何稳定地输出JSON? · 5 分半,2026 年 7 月。把提示词、JSON mode、schema、校验重试按面试回答的顺序串一遍,看完对照自测第 6 题,看看你的回答比它多了哪些实测数字。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1F8NazDEGZ&autoplay=0&high_quality=1" title="大模型输出JSON：3法从能用至100%可靠" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>酌沧 · 大模型输出JSON:3法从能用至100%可靠 · 2 分半,2025 年 6 月。很短,三种方法正好对应这周的三个层次。标题里的「100% 可靠」指格式,不指内容,看的时候想想这周哪几次是格式全对、内容错的。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/yKk5rsOKmxg" title="Structured Outputs and Constrained Decoding for LLMs" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Multi-Agent Academy · Structured Outputs and Constrained Decoding for LLMs · 英文。把约束解码在每一步怎么屏蔽 token 讲了一遍,复习 Day 147 那个玩具模拟和 Day 148 的服务端约束。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 2 章「Structured Outputs」一节,这周学的内容在书里差不多两三页,读完能看出我们多做了哪些实测。
- John Berryman & Albert Ziegler《Prompt Engineering for LLMs》(O'Reilly,2024),讲提示词怎么组织、输出格式怎么设计,和上周、这周都相关,挑「输出格式」相关的章节看。

### 开源项目与代码

- [567-labs/instructor](https://github.com/567-labs/instructor):本周结构化输出部分的「标准答案」,有时间翻一下它的 `examples/` 目录,看别人用 pydantic 抽什么。
- [simonw/llm](https://github.com/simonw/llm):Day 152 推荐过的命令行工具,它的 `--schema` 参数把结构化输出和命令行聊天放在了一起,正好对应今天练习 1。

## 自测

1. 三个层次各保证什么、管不了什么?DeepSeek 官方能用到第几层?

<details><summary>答案</summary>

求它(提示词写清格式)什么都不保证,只是提高概率;约束它(JSON mode)保证输出是合法 JSON,不管键名和类型;逼它(`json_schema` 约束解码)保证键名、类型、枚举、必填都符合 schema,但管不了值对不对,也表达不了跨字段的业务规则。DeepSeek 官方到第二层,第三层要换支持的厂商(比如硅基流动)或把 schema 写进提示词再本地校验。

</details>

2. `extract()` 遇到截断、空内容、校验失败分别怎么处理?为什么不一样?

<details><summary>答案</summary>

截断:`max_tokens` 翻倍,不往 messages 里加东西,因为是空间不够,不是模型理解错了。空内容:原样重发,这是偶发的。校验失败:把模型的错误回答和报错原文追加进 messages 让它改,这是模型输出有错,告诉它错在哪才能改。三种都计入重试次数,到上限抛 `ExtractionError`。

</details>

3. 今天小项目里 `TriageByInherit` 为什么不能用?

<details><summary>答案</summary>

pydantic 子类的字段排在父类字段后面,`analysis` 跑到了最后。推理字段在最后,模型写 `intent` 等字段时还没分析过,等于 Day 151 的「先报数再写理由」。字段顺序重要的类要单独写,需要复用时写一个转换方法。

</details>

4. 原文核对能拦住哪些错,拦不住哪些?今天的分路规则又补上了哪一类?

<details><summary>答案</summary>

原文核对能拦住编造和抄错的值(占位值、拼出来的 `20261001`、少抄一位的编号)。拦不住漏抽(`None` 合法)、选错候选值、概括里的过度推断。今天补的规则「退款必须有订单号或邮箱」,不管是客户没给还是模型漏抽,都会把没法定位客户的退款转给人工。

</details>

5. 聊天机器人的 `ask()` 为什么要在三个 `except` 里都 `pop()`?

<details><summary>答案</summary>

`ask()` 一开始就 `add_user` 了,请求失败、断网、用户中断时这一轮只有 user 没有 assistant。不删的话,下一轮会发出两条连续的 user,模型会把被取消的问题一起回答(Day 152 实测把取消的清单又写了一遍),有的厂商直接 400。删掉才能保证历史永远是完整的问答轮次。

</details>

6. 面试题:「你要从客服工单里自动抽取订单号、邮箱、金额并决定是否自动退款,怎么设计才能放心上线?」

<details><summary>答案</summary>

分四层。格式:用 pydantic 类定义输出,厂商支持就用 schema 约束,不支持用 JSON mode 加把 schema 写进提示词,本地一律再校验,失败把报错喂回去重试两三次,截断和空内容单独处理,超上限转人工。字段设计:推理字段放第一位且必填;可能缺的字段写成可空,说明里写「原文没有填 null,不要推算」,否则会出现 0 元这种占位值;字段名起清楚,换厂商先看输出键的顺序。内容核对:订单号、邮箱这类抄写型字段必须能在原文里整串找到,金额必须是原文出现过的数。分路:能不能自动退由程序里的业务规则决定,比如退款必须能定位到客户、金额在阈值内,拿不准的进人工复核队列。最后用带标准答案的评测集量自动处理率和自动处理里的错误率,换模型或改提示词都要重跑。我实测过:7B 模型在 8 张工单里漏抽一张、编造一张,核对和规则都拦住了。

</details>

## 明天预告

Day 154 · 小项目(二):切换厂商和每轮成本统计。今天复习完,明天接着做 Day 152 的聊天机器人:加 `/env` 命令在 DeepSeek 和硅基流动之间切换,每轮回答后打印首 token 延迟、输入输出 token 和这一轮花了多少钱,再加 `/cost` 看累计账单。Day 152 发现的「中断的调用没进账单」也要在那天处理。
