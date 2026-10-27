---
title: 'Day 200 · 模式四:编排者-工作者'
description: '第四种 workflow 模式:一个编排者模型看了输入再决定拆成几个子任务,一批工作者并行去做,综合者合成结果。和并行的区别只有一处,子任务有几个由模型定。同一份代码,一件事的工单拆 2 个,五件事的拆 5 个;实测里编排者比「一个提示词写完」贵 3 到 4 倍、慢一倍多,漏项两边都是 0,多件事的工单过回复门 26/32 对 5/32(多出来的那道综合者把承诺句滤掉了);改文档这类「改哪几个文件取决于需求」的任务里,8 遍 × 3 个需求全对,调用数 64 次对写死并行的 120 次。'
pubDate: 2026-10-27
regime: none
tags: ['workflow', 'orchestrator', 'multi-task', 'agent-zero']
series: 'agent-zero'
day: 200
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 199](/blog/agent-zero/day-199-parallelization/) 学了并行的两个变体:分段(回答和护栏同时跑,护栏掉线按有风险处理)和投票(同一个判断问 n 遍,代码数票)。实测里投票把单次 97.8% 的准确率抬到 3 票 99.5%,但对「一致地错」的那张工单 5 票全错。

两个变体有个共同点:开几路、各做什么,全写死在代码里。今天要解决一个写死解决不了的情形:你**事先不知道**要拆成几块。一张工单可能只有一件事,也可能夹着五件事。今天这个模式叫**编排者-工作者**,由模型看了输入再决定拆法。

## 今天要解决的问题

学完今天,你应该能:

1. 说出编排者-工作者和并行的区别,以及它为什么是最接近 agent 的 workflow 模式。
2. 写出编排者那一步:让模型输出子任务列表,代码做一道「计划门」,计划不合格就转人工。
3. 写出工作者(并行、各查各的资料、一个失败不连累别人)和综合者(把几段合成一封),并用 Day 197 的回复门收尾。
4. 用实测判断什么时候该用它:什么情形下「一个提示词」就够了,什么情形下它才真正划算。

今天两个新概念:**编排者-工作者**(orchestrator-workers)和**综合者**(synthesizer)。

预计用时 3 小时。前置:[Day 196](/blog/agent-zero/day-196-workflow-vs-agent/)(`wf_common.py`、`ticket_tools.py` 里的 `search_help`)、[Day 197](/blog/agent-zero/day-197-chaining/)(`wf1_gates.py` 里的 `check_reply`、`ORDER_RE`)、[Day 199](/blog/agent-zero/day-199-parallelization/)(`gather` 加 `return_exceptions=True`)、[Day 68](/blog/agent-zero/day-068-async-3/)(`asyncio`)、[Day 74](/blog/agent-zero/day-074-pytest-4/)(monkeypatch)。代码在 `agent-zero-lab/part03/` 和 `tests/`,命令都在 `agent-zero-lab/` 根目录跑。今天不用装新东西。真调模型,按文中命令跑一遍约 ¥0.3,算法见文末「花费」。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `parse_plan`(计划门)和 `orchestrate` 的主干;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 编排者-工作者是什么

并行里,子任务是代码写死的:回答加护栏,永远是这两路。编排者-工作者里,子任务是模型临时拆的。一个角色拆(编排者),一批角色做(工作者),一个角色合(综合者)。

Anthropic 那篇文章给的例子是编程:要改哪几个文件、每个文件怎么改,取决于具体需求,没法提前写成固定的几路。客服里也有:一张工单里客户列了几件事,没法提前知道。

<br>

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="编排者-工作者:编排者读工单拆出 N 个子任务,N 个工作者并行各做一个,综合者合成一封回复,最后过代码做的门">
  <rect x="14" y="110" width="66" height="38" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="47" y="133" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">工单</text>
  <rect x="112" y="102" width="104" height="54" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="164" y="124" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">编排者</text>
  <text x="164" y="142" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">拆几个由它定</text>
  <rect x="112" y="170" width="104" height="26" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="164" y="187" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">计划门(代码)</text>
  <rect x="270" y="30" width="110" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="325" y="51" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">工作者 1</text>
  <rect x="270" y="86" width="110" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="325" y="107" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">工作者 2</text>
  <rect x="270" y="142" width="110" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="325" y="163" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">工作者 …N</text>
  <text x="325" y="205" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">各查各的资料,互相看不见</text>
  <rect x="432" y="86" width="86" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="475" y="110" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">综合者</text>
  <rect x="548" y="86" width="78" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="587" y="110" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">回复门</text>
  <line x1="80" y1="129" x2="112" y2="129" stroke="var(--rule)"/>
  <line x1="216" y1="118" x2="270" y2="47" stroke="var(--rule)"/><line x1="216" y1="125" x2="270" y2="103" stroke="var(--rule)"/><line x1="216" y1="135" x2="270" y2="159" stroke="var(--rule)"/>
  <line x1="380" y1="47" x2="432" y2="100" stroke="var(--rule)"/><line x1="380" y1="103" x2="432" y2="106" stroke="var(--rule)"/><line x1="380" y1="159" x2="432" y2="116" stroke="var(--rule)"/>
  <line x1="518" y1="106" x2="548" y2="106" stroke="var(--rule)"/>
  <text x="14" y="245" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">蓝色 = 模型调用,琥珀色 = 代码。和并行的区别只有一处:工作者有几个,是编排者看了这张工单才定的。</text>
</svg>
<figcaption>编排者-工作者。一件事的工单拆 1 到 2 个子任务,五件事的拆 5 个,同一份代码,人数不一样。计划不合格(空的、太多、重复)的由代码门拦下转人工。</figcaption>
</figure>

这个模式有两个特点要提前说清楚,后面的实测会反复印证。

**第一,它比并行多一次模型调用(拆的那一次),综合还要一次。** 一张三件事的工单:1 次拆、3 次做、1 次合,共 5 次调用。一个提示词写完只要 1 次。所以它能不能赢,要看那「多出来的几次」换来了什么。

**第二,它离 agent 只差一步。** 今天的编排者一次拆完就不管了。如果编排者看完工作者的结果、再决定下一步做什么,它就是 agent 了。Anthropic 后来那篇《How we built our multi-agent research system》讲的就是升级版,第五部分会学。今天严格停在 workflow 这一侧:拆一次、做一轮、合一次。

## 先造三张工单

要看「拆几个由模型定」,得有诉求数不一样的工单。新建 `part03/wf4_tickets.py`,三张都是我编的,用的是 Day 196 起一直在用的陈先生(`customer_id 10086`)。

```python
# agent-zero-lab/part03/wf4_tickets.py  Day 200:三张「诉求数量不一样」的工单(自己编的,云簿场景)
from part03.wf_common import TICKET

TICKET_ONE = TICKET  # Day 196 起一直用的那张:一件事(重复扣费)

TICKET_THREE = """客户:陈先生(customer_id 10086,专业版年付)
主题:几件事一起问
内容:
1) 我 9 月 28 号被扣了两次 1188 元,订单号 CL-20931 和 CL-20932,请退多扣的那笔;
2) 你们上次给我开的发票,抬头少了「有限」两个字,想重开;
3) 报表导出一直转圈,等了十分钟都没下来,Chrome 浏览器。"""

TICKET_FIVE = """客户:陈先生(customer_id 10086,专业版年付)
主题:一堆问题
内容:
1) 9 月 28 号被扣了两次 1188 元,订单号 CL-20931 和 CL-20932,退多扣的;
2) 发票抬头少了「有限」两个字,想重开;
3) 报表导出一直转圈;
4) 我换了手机,双重验证的验证码收不到了,登不进去;
5) 明年想续年付,有没有折扣?"""

TICKETS = {"一件事": TICKET_ONE, "三件事": TICKET_THREE, "五件事": TICKET_FIVE}
```

<div class="line-notes">

- `from part03.wf_common import TICKET` [Day 196](/blog/agent-zero/day-196-workflow-vs-agent/) 的共用工单:重复扣费,要求退款加一个解释,三天内没处理就投诉。
- `TICKET_ONE = TICKET  # Day 196 起一直用的那张:一件事(重复扣费)` 我叫它「一件事」。后面会发现编排者不这么看。
- `TICKET_THREE = """客户:陈先生(customer_id 10086,专业版年付)` 三引号字符串可以跨行,里面的换行原样保留。
- `1) 我 9 月 28 号被扣了两次 1188 元,订单号 CL-20931 和 CL-20932,请退多扣的那笔;` 第一件事,带两个订单号。订单号后面要靠回复门检查有没有丢。
- `2) 你们上次给我开的发票,抬头少了「有限」两个字,想重开;` 第二件事,帮助中心有一篇《怎么开发票》能对上。
- `3) 报表导出一直转圈,等了十分钟都没下来,Chrome 浏览器。` 第三件事,帮助中心里没有任何一篇讲导出的,专门用来测「没有资料时工作者会不会编」。
- `TICKET_FIVE = """客户:陈先生(customer_id 10086,专业版年付)` 五件事的版本,在三件事后面加了双重验证和年付折扣。
- `TICKETS = {"一件事": TICKET_ONE, "三件事": TICKET_THREE, "五件事": TICKET_FIVE}` 一个字典,后面的脚本遍历它。字典保持插入顺序,所以打印的顺序就是这里写的顺序。

</div>

## 编排者:拆任务,拆出来的计划要过门

编排者是一次模型调用,输出一个子任务列表。它的输出是模型生成的 JSON,所以和前面每一天一样:先过门,不合格的不往下传。新建 `part03/wf4_plan.py`:

```python
# agent-zero-lab/part03/wf4_plan.py  Day 200:编排者这一步单独跑,看它按输入拆出几个子任务;拆出来的计划要过一道门
import json
from dataclasses import dataclass
from typing import Any

from part03.wf4_tickets import TICKETS
from part03.wf_common import llm_json

MAX_SUBTASKS = 5

PLAN_PROMPT = (
    "你是云簿客服主管。下面是一张客户工单,里面可能有一个或几个互相独立的诉求。\n"
    "把它拆成子任务,每个诉求一个,同一件事不要拆成两个,工单里的每个诉求都要有,不要遗漏。\n"
    "输出 JSON:{\"subtasks\": [{\"title\": \"4 到 10 个字的标题\", \"need\": \"客户具体要什么,一句话\"}]}\n\n工单:\n"
)


@dataclass
class Subtask:
    title: str
    need: str


class PlanError(Exception):
    """编排者给的计划不能用。"""


def parse_plan(raw: dict[str, Any]) -> list[Subtask]:
    """门:计划必须是 1 到 MAX_SUBTASKS 个有标题有内容的子任务,标题不能重复。不合格就抛 PlanError。"""
    items = raw.get("subtasks")
    if not isinstance(items, list) or not items:
        raise PlanError("没有 subtasks 或者是空的")
    if len(items) > MAX_SUBTASKS:
        raise PlanError(f"拆出了 {len(items)} 个子任务,超过上限 {MAX_SUBTASKS}")
    plan: list[Subtask] = []
    for it in items:
        if not isinstance(it, dict) or not isinstance(it.get("title"), str) or not isinstance(it.get("need"), str):
            raise PlanError(f"子任务格式不对:{it!r}")
        title, need = it["title"].strip(), it["need"].strip()
        if not title or not need:
            raise PlanError(f"子任务有空字段:{it!r}")
        if any(title == p.title for p in plan):
            raise PlanError(f"子任务标题重复:{title}")
        plan.append(Subtask(title, need))
    return plan


def make_plan(ticket: str, extra: str = "") -> list[Subtask]:
    """调编排者拿计划。extra 是追加在提示词末尾的话(重拆时用)。模型回的不是合法 JSON,也算计划不合格。"""
    try:
        raw = llm_json(PLAN_PROMPT + ticket + extra)
    except json.JSONDecodeError as e:
        raise PlanError(f"计划不是合法 JSON:{e}") from e
    return parse_plan(raw)


if __name__ == "__main__":
    for name, ticket in TICKETS.items():
        plan = make_plan(ticket)
        print(f"[{name}] 编排者拆出 {len(plan)} 个:")
        print(json.dumps([p.title for p in plan], ensure_ascii=False))
```

<div class="line-notes">

- `import json` 下面 `make_plan` 要捕获 `json.JSONDecodeError`。
- `from part03.wf4_tickets import TICKETS` 只有最下面的 `__main__` 要用。
- `MAX_SUBTASKS = 5` 一张工单最多拆 5 个。上限不是越大越好:拆得越多,调用越多,而且真有 20 件事的工单多半是别的问题(粘贴错了、在测试你)。
- `PLAN_PROMPT = (` 编排者的提示词。注意第三行「工单里的每个诉求都要有,不要遗漏」:我的第一版写的是「最多 5 个」,后面的练习 2 会讲为什么改掉了。
- `"输出 JSON:{\"subtasks\": [{\"title\": \"4 到 10 个字的标题\", \"need\": \"客户具体要什么,一句话\"}]}\n\n工单:\n"` 每个子任务两个字段:`title` 做标题(也用来判重),`need` 说客户要什么(给工作者看)。末尾是「工单:」加换行,工单内容接在后面。
- `@dataclass` 紧接着是 `Subtask`。
- `class Subtask:` 一个子任务,两个字段,后面所有函数传来传去的就是它。相当于 TS 的 `interface Subtask { title: string; need: string }`。
- `class PlanError(Exception):` 自己定义的异常类,继承内置的 `Exception`。只是个「标签」,类体里只有一行文档字符串。用它的好处是调用方可以 `except PlanError` 只接住计划不合格,别的错误照常往外抛。
- `def parse_plan(raw: dict[str, Any]) -> list[Subtask]:` 计划门:把模型给的 dict 变成 `Subtask` 列表,不合格就抛 `PlanError`。
- `items = raw.get("subtasks")` 缺字段得到 `None`。
- `if not isinstance(items, list) or not items:` 两种情况都拦:不是列表(比如模型给了个字符串),或者是空列表。
- `if len(items) > MAX_SUBTASKS:` 超过上限。8 件事的工单会在这里被拦下,错误信息是「拆出了 8 个子任务,超过上限 5」(练习 2 的真实输出)。
- `plan: list[Subtask] = []` 已通过检查的子任务。
- `for it in items:` 逐个检查。
- `if not isinstance(it, dict) or not isinstance(it.get("title"), str) or not isinstance(it.get("need"), str):` 每项必须是字典,且 `title` 和 `need` 都必须是字符串。三个条件用 `or` 连着,任何一个不满足就进分支。`or` 短路:前面为真,后面不再算,所以 `it` 不是字典时不会去调 `it.get`。
- `title, need = it["title"].strip(), it["need"].strip()` 去掉首尾空白。上面已经确认是字符串,所以放心调 `.strip()`。
- `if not title or not need:` 全是空格的字段,`strip` 之后变成空字符串,在这里拦。
- `if any(title == p.title for p in plan):` 标题重复。`any(...)` 里的生成器遍历已收下的子任务,任何一个同名就为真。
- `plan.append(Subtask(title, need))` 通过全部检查才收下。
- `def make_plan(ticket: str, extra: str = "") -> list[Subtask]:` 调编排者。`extra` 默认空字符串,练习 2 里用它追加一句话。
- `raw = llm_json(PLAN_PROMPT + ticket + extra)` 调 [Day 196](/blog/agent-zero/day-196-workflow-vs-agent/) 的 `llm_json`,JSON 模式。
- `except json.JSONDecodeError as e:` 模型输出了没法解析的 JSON(Day 196 说过 `llm_json` 遇到这种情况会抛)。我在练习 2 里真的碰到过一次,列表里少了个逗号。
- `raise PlanError(f"计划不是合法 JSON:{e}") from e` 换成 `PlanError`,调用方只需要处理一种异常。`from e` 保留原始异常的链条,调试时能看到根因。
- `plan = make_plan(ticket)` 最下面的演示,对三张工单各拆一次。
- `print(f"[{name}] 编排者拆出 {len(plan)} 个:")` 打印数量。
- `print(json.dumps([p.title for p in plan], ensure_ascii=False))` 打印标题。`ensure_ascii=False` 让中文原样显示,不转成 `\u` 开头的转义。

</div>

```bash
uv run python -m part03.wf4_plan
```

我实跑的输出:

```text
[一件事] 编排者拆出 2 个:
["退回重复扣费", "解释重复扣费原因"]
[三件事] 编排者拆出 3 个:
["重复扣款退款", "发票抬头重开", "报表导出卡住"]
[五件事] 编排者拆出 5 个:
["重复扣款退款", "发票抬头重开", "报表导出转圈", "双重验证收不到", "续费折扣咨询"]
```

三张工单拆出 2、3、5 个,同一份代码,数量跟着输入走。

我叫它「一件事」的那张拆成了两个:客户确实提了两个要求(「退回多扣的那笔」和「要一个解释」)。我当时没数出两件,是模型数出来了。这也说明「几个子任务」本身就是一个模型判断,会随措辞浮动,重跑一遍可能是 1 个也可能是 2 个。门只管计划合不合格,不管拆得对不对。

## 工作者和综合者

拆好了,下一步是工作者。每个工作者只拿到两样东西:整张工单(上下文)和它负责的那一个子任务。它还要自己去帮助中心查资料,查什么由子任务的 `need` 决定,这是「一个提示词写完」做不到的:单个提示词只有一次检索机会。

工作者彼此看不见。这既是优点(并行、互不干扰),也是缺点(各写各的,语气可能不统一,可能重复同一句客套话)。所以后面要有综合者:把几段合成一封完整的回复。最后再过一次 [Day 197](/blog/agent-zero/day-197-chaining/) 的回复门:订单号不能丢,不能有承诺。综合者是一次新的模型生成,门必须再过,不能因为每一段单独看都没问题就放过合成后的结果。

新建 `part03/wf4_orchestrator.py`:

```python
# agent-zero-lab/part03/wf4_orchestrator.py  Day 200 模式四:编排者拆任务,工作者并行做,综合者合成一封回复,最后过 Day 197 的回复门
import asyncio
import time
from dataclasses import dataclass, field

from part03.ticket_tools import search_help
from part03.wf1_gates import ORDER_RE, check_reply
from part03.wf4_plan import PlanError, Subtask, make_plan
from part03.wf4_tickets import TICKET_THREE
from part03.wf_common import allm, llm, total_calls, total_cost

WORKER_PROMPT = (
    "你是云簿客服,正在帮同事写一封多件事回复信里的其中一段。整张工单是:\n{ticket}\n\n"
    "你只负责这一件事:{title}。客户要的是:{need}\n"
    "帮助中心里查到的资料(可能为空):\n{help}\n\n"
    "写 2 到 3 句话给客户看。只依据上面的资料,资料里没有的操作步骤不要编,"
    "没有资料就写「这一项我们会转给对应的同事跟进」。不要写问候和落款,不要承诺任何到账日期或处理时限。"
)

SYNTH_PROMPT = (
    "下面是同事分别写的几段,对应客户工单里的几件事。请合成一封完整的回复信:\n"
    "先一句道歉和问候,然后按原来的顺序逐件回应,保留所有订单号,"
    "语气统一用「您」,删掉重复的客套话,不要承诺任何到账日期或处理时限,不要新增同事没写的事实。\n\n"
    "客户工单:\n{ticket}\n\n同事写的几段:\n{parts}"
)


@dataclass
class Result:
    action: str  # "reply" / "human"
    text: str
    plan: list[Subtask] = field(default_factory=list)
    parts: list[str] = field(default_factory=list)  # 工作者写的各段,方便事后看
    seconds: float = 0.0
    calls: int = 0
    cost: float = 0.0


async def work(ticket: str, sub: Subtask) -> str:
    hits = search_help(sub.need)
    help_text = "\n".join(f"《{a['title']}》{a['body']}" for a in hits) or "(没有查到相关文章)"
    return await allm(WORKER_PROMPT.format(ticket=ticket, title=sub.title, need=sub.need, help=help_text))


async def orchestrate(ticket: str) -> Result:
    t0, c0, n0 = time.perf_counter(), total_cost(), total_calls()

    def done(action: str, text: str, plan: list[Subtask], parts: list[str] | None = None) -> Result:
        return Result(action, text, plan, parts or [], time.perf_counter() - t0, total_calls() - n0, total_cost() - c0)

    try:
        plan = await asyncio.to_thread(make_plan, ticket)  # 编排者:同步函数丢进线程里跑
    except PlanError as e:
        return done("human", f"计划不合格:{e}", [])

    outputs = await asyncio.gather(*[work(ticket, s) for s in plan], return_exceptions=True)  # 工作者:并行
    parts = []
    for sub, out in zip(plan, outputs):
        body = "(这一项处理失败,回复里说明会有同事单独跟进)" if isinstance(out, BaseException) else out
        parts.append(f"【{sub.title}】{body}")

    reply = await allm(SYNTH_PROMPT.format(ticket=ticket, parts="\n".join(parts)))  # 综合者
    order_ids = ORDER_RE.findall(ticket)
    problem = check_reply(reply, order_ids)  # 门:订单号不能丢,不能有承诺
    if problem:
        return done("human", f"综合出的回复没过门:{problem}", plan, parts)
    return done("reply", reply, plan, parts)


async def main() -> None:
    r = await orchestrate(TICKET_THREE)
    print(f"{r.action},{len(r.plan)} 个子任务,{r.calls} 次调用,{r.seconds:.1f} 秒,¥{r.cost:.4f}")
    for p in r.parts:
        print(" ", p)
    print(r.text)


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `from part03.ticket_tools import search_help` [Day 196](/blog/agent-zero/day-196-workflow-vs-agent/) 的朴素检索:数 query 里的字有多少出现在文章里。三篇帮助中心文章:重复扣费、退款多久到账、怎么开发票。
- `from part03.wf1_gates import ORDER_RE, check_reply` [Day 197](/blog/agent-zero/day-197-chaining/) 的两个零件:订单号的正则,和回复门。
- `from part03.wf4_plan import PlanError, Subtask, make_plan` 上一节的计划。
- `from part03.wf_common import allm, llm, total_calls, total_cost` `allm` 是异步调用,`total_calls` 和 `total_cost` 用来算这次流程总共发了几次调用、花了多少。`llm` 这个文件里没用到,留着也不影响,可以删掉。
- `WORKER_PROMPT = (` 工作者的提示词。用 `{ticket}`、`{title}`、`{need}`、`{help}` 四个占位符,后面用 `.format` 填。
- `"你只负责这一件事:{title}。客户要的是:{need}\n"` 这是「分工」的关键:整张工单给它看(知道上下文),但只许它写自己那一件。
- `"写 2 到 3 句话给客户看。只依据上面的资料,资料里没有的操作步骤不要编,"` 防止它没有资料时胡编。第三件事(报表导出)正好没有资料,实测它老老实实写了「这一项我们会转给对应的同事跟进」。
- `SYNTH_PROMPT = (` 综合者的提示词。要求:一句道歉问候、按顺序逐件回应、保留所有订单号、统一用「您」、不承诺时限、「不要新增同事没写的事实」。最后一条是防止综合者在合并时自己发挥。
- `class Result:` 一次编排的完整结果。
- `action: str  # "reply" / "human"` 和前面几天一样的两种出口。
- `plan: list[Subtask] = field(default_factory=list)` 可变默认值(列表)必须用 `field(default_factory=list)`,不能直接写 `= []`,否则所有实例共用同一个列表。这是 Python 的经典坑,JS 没有对应的。
- `parts: list[str] = field(default_factory=list)  # 工作者写的各段,方便事后看` 留着每一段原文。事后要查「综合者到底加了什么」,对着它看。
- `seconds: float = 0.0` 后面三个有默认值的字段是统计用的:耗时、调用数、花费。
- `async def work(ticket: str, sub: Subtask) -> str:` 一个工作者。
- `hits = search_help(sub.need)` 用**子任务的 `need`** 去检索,而不是整张工单。「重开发票抬头」去搜,命中发票那篇的机会比用整张工单搜大得多。这是编排者-工作者的一个实打实的好处。
- `help_text = "\n".join(f"《{a['title']}》{a['body']}" for a in hits) or "(没有查到相关文章)"` 把命中的文章拼成一段文字;一篇都没命中时 `join` 得到空字符串,是假值,`or` 取右边的提示。
- `return await allm(WORKER_PROMPT.format(ticket=ticket, title=sub.title, need=sub.need, help=help_text))` 填占位符并调用,返回这一段的文字。
- `async def orchestrate(ticket: str) -> Result:` 主流程。
- `t0, c0, n0 = time.perf_counter(), total_cost(), total_calls()` 一次记下三个起点:时间、花费、调用数,最后相减得到本次流程的数。
- `def done(action: str, text: str, plan: list[Subtask], parts: list[str] | None = None) -> Result:` 嵌套函数,每个出口都用它造 `Result`,统一在这里算耗时、调用数和花费,省得每个 return 重复写。它能直接用外层的 `t0`、`c0`、`n0`(闭包)。
- `return Result(action, text, plan, parts or [], time.perf_counter() - t0, total_calls() - n0, total_cost() - c0)` 位置参数按字段顺序填。`parts or []`:`None` 变空列表。
- `plan = await asyncio.to_thread(make_plan, ticket)  # 编排者:同步函数丢进线程里跑` `make_plan` 是同步函数(内部用 `llm_json`),用 `to_thread` 放进线程,不阻塞事件循环,[Day 196](/blog/agent-zero/day-196-workflow-vs-agent/) 讲过。
- `except PlanError as e:` 只接住计划不合格。
- `return done("human", f"计划不合格:{e}", [])` 转人工,文本带原因,计划是空的。
- `outputs = await asyncio.gather(*[work(ticket, s) for s in plan], return_exceptions=True)  # 工作者:并行` N 个工作者同时发。`*[...]` 展开成 N 个参数。`return_exceptions=True` 沿用 [Day 199](/blog/agent-zero/day-199-parallelization/) 的做法:一个工作者失败不连累别人。
- `parts = []` 准备收集各段。
- `for sub, out in zip(plan, outputs):` `zip` 把子任务和它的结果配成对,`gather` 保证顺序一致。
- `body = "(这一项处理失败,回复里说明会有同事单独跟进)" if isinstance(out, BaseException) else out` 失败的工作者,用一句话顶替。综合者会照着它在回复里写「会有同事单独跟进」,而不是假装这件事没发生。
- `parts.append(f"【{sub.title}】{body}")` 每段前面加上标题,综合者靠它对应原工单。
- `reply = await allm(SYNTH_PROMPT.format(ticket=ticket, parts="\n".join(parts)))  # 综合者` 把所有段拼起来交给综合者。
- `order_ids = ORDER_RE.findall(ticket)` 从工单里找出所有订单号。`TICKET_THREE` 里是 `['CL-20931', 'CL-20932']`。
- `problem = check_reply(reply, order_ids)  # 门:订单号不能丢,不能有承诺` [Day 197](/blog/agent-zero/day-197-chaining/) 的回复门。返回 `None` 表示通过,否则是原因字符串。
- `return done("human", f"综合出的回复没过门:{problem}", plan, parts)` 没过门,转人工,连同原因和各段一起带走。
- `return done("reply", reply, plan, parts)` 过了才算「回复」。
- `for p in r.parts:` `main` 里把各段打印出来,方便看工作者各自写了什么。

</div>

运行:

```bash
uv run python -m part03.wf4_orchestrator
```

我实跑的输出:

```text
reply,3 个子任务,5 次调用,3.8 秒,¥0.0059
  【重复扣款退款】已为您核实订单 CL-20931 与 CL-20932 存在重复扣款，我们将提交退款申请，多扣的 1188 元将原路退回。退款到账时间取决于发卡银行，一般需 5 到 10 个工作日，具体到账日期无法保证。
  【发票抬头重开】关于发票抬头缺少「有限」二字需要重开的问题，这一项我们会转给对应的同事跟进。
  【报表导出卡住】关于报表导出一直转圈、在 Chrome 里等了十分钟都没响应的问题，目前帮助中心没有对应的排查资料，这一项我们会转给对应的同事跟进。
陈先生您好，很抱歉给您带来不便，感谢您的来信。针对您提出的几件事，我们按顺序回复如下：

1）关于重复扣款退款：已为您核实订单 CL-20931 与 CL-20932 存在重复扣款，我们将提交退款申请，多扣的 1188 元将原路退回。退款到账时间取决于发卡银行。

2）关于发票抬头重开：关于发票抬头缺少「有限」二字需要重开的问题，这一项我们会转给对应的同事跟进。

3）关于报表导出卡住：关于报表导出一直转圈、在 Chrome 里等了十分钟都没响应的问题，目前帮助中心没有对应的排查资料，这一项我们会转给对应的同事跟进。
```

5 次调用:1 次拆、3 次工作者、1 次综合。3.8 秒,¥0.0059。逐项看这封回复:

- 订单号两个都在,没有承诺具体到账日期,过了门。
- 第三件事帮助中心没有资料,工作者没有编步骤,老实写了转同事。这正是 `WORKER_PROMPT` 里那句「没有资料就写转给同事」起的作用。
- 综合者把工作者写的「一般需 5 到 10 个工作日」删掉了,回复里只剩「取决于发卡银行」。我没要求它删,是它自己判断那是承诺性质的数字。这一点不稳定:我另一次实跑里它留了「一般 5 到 10 个工作日」,结果被回复门当成承诺拦下转了人工(下面实测表里的「过门」那一列有一部分就是这个原因)。
- 注意第一段开头的「已为您核实订单……」。客服并没有查过系统,「已核实」是工作者写的,综合者照抄,回复门也没拦(回复门只查订单号和承诺,不查这种说法)。这是一个真实的漏洞,Day 201 的评估者-优化者专门要对付它。
- 「关于发票抬头重开:关于发票抬头缺少……」重复了两遍「关于」,是综合者按「【标题】+ 工作者原文」拼出来的痕迹。小毛病,但说明综合者不是完美的。

## 实测:编排者比「一个提示词写完」强吗

到这里最该问的是:5 次调用换来了什么?拿一个公平的对照组:「一个提示词写完」,而且给它同样的帮助中心资料(整张工单检索一次,取前两篇),同样的提示限制,同样过回复门。三张工单各跑 5 遍。每次记录调用数、耗时、花费,过门几次(过了才算能发),通过的里面有没有漏项(回复里必须出现的关键词缺了几个)。

新建 `part03/wf4_compare.py`:

```python
# agent-zero-lab/part03/wf4_compare.py  Day 200:编排者-工作者 vs 一个提示词写完,三张工单各跑 N 遍,比调用数、耗时、花费、漏项、过门率
import asyncio
import statistics
import time

from part03.ticket_tools import search_help
from part03.wf1_gates import ORDER_RE, check_reply
from part03.wf4_orchestrator import orchestrate
from part03.wf4_tickets import TICKETS
from part03.wf_common import allm, total_calls, total_cost

N = 5
MUST_MENTION = {  # 回复里必须出现的关键词,出现不了就算漏项
    "一件事": ["CL-20931", "CL-20932"],
    "三件事": ["CL-20931", "CL-20932", "发票", "导出"],
    "五件事": ["CL-20931", "CL-20932", "发票", "导出", "验证", "折扣"],
}
SINGLE_SYSTEM = (
    "你是云簿客服,回复这张工单里的每一件事,保留订单号,不要承诺到账日期或处理时限。"
    "只依据给你的帮助中心资料,资料里没有的操作步骤不要编,没有资料就写「这一项我们会转给对应的同事跟进」。"
)


async def single(ticket: str) -> tuple[str, str, float, int, float]:
    t0, c0, n0 = time.perf_counter(), total_cost(), total_calls()
    hits = search_help(ticket)  # 整张工单拿去检索一次,只有这一次机会
    help_text = "\n".join(f"《{a['title']}》{a['body']}" for a in hits) or "(没有查到相关文章)"
    reply = await allm(f"{ticket}\n\n帮助中心资料:\n{help_text}", system=SINGLE_SYSTEM)
    action = "human" if check_reply(reply, ORDER_RE.findall(ticket)) else "reply"
    return action, reply, time.perf_counter() - t0, total_calls() - n0, total_cost() - c0


async def multi(ticket: str) -> tuple[str, str, float, int, float]:
    r = await orchestrate(ticket)
    return r.action, r.text, r.seconds, r.calls, r.cost


async def main() -> None:
    print(f"{'工单':<4} {'做法':<7} {'调用':>4} {'平均秒':>6} {'平均¥':>8} {'过门':>5} {'漏项':>5}")
    for name, ticket in TICKETS.items():
        for label, fn in [("一提示词", single), ("编排者", multi)]:
            rows = [await fn(ticket) for _ in range(N)]
            passed = sum(r[0] == "reply" for r in rows)
            missed = sum(any(k not in r[1] for k in MUST_MENTION[name]) for r in rows if r[0] == "reply")
            print(f"{name:<4} {label:<7} {statistics.mean(r[3] for r in rows):>4.1f} {statistics.mean(r[2] for r in rows):>6.1f} "
                  f"{statistics.mean(r[4] for r in rows):>8.4f} {passed}/{N:>3} {missed}/{max(passed, 1):>3}")


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `from part03.ticket_tools import search_help` 对照组也要检索,所以导入。
- `N = 5` 每种做法每张工单跑 5 遍。
- `MUST_MENTION = {  # 回复里必须出现的关键词,出现不了就算漏项` 按工单列出必须出现的词。「一件事」只要求两个订单号;「五件事」要求订单号加发票、导出、验证、折扣。
- `SINGLE_SYSTEM = (` 对照组的系统提示词,和 `WORKER_PROMPT` 同样的限制:不编步骤,没资料就转同事,不承诺。这样比的是「架构」,不是提示词写得好坏。
- `async def single(ticket: str) -> tuple[str, str, float, int, float]:` 一个提示词的做法。返回五个值:动作、文本、耗时、调用数、花费。
- `hits = search_help(ticket)  # 整张工单拿去检索一次,只有这一次机会` 整张工单作为 query。`search_help` 是按字数打分的,整张工单很长,几乎每篇都有字命中,取前两篇。
- `reply = await allm(f"{ticket}\n\n帮助中心资料:\n{help_text}", system=SINGLE_SYSTEM)` 工单加资料作为用户消息。
- `action = "human" if check_reply(reply, ORDER_RE.findall(ticket)) else "reply"` 同一道回复门:有问题字符串(真值)就转人工。
- `async def multi(ticket: str) -> tuple[str, str, float, int, float]:` 编排者的做法,直接用上一节的 `orchestrate`,把 `Result` 摊成同样的五元组。
- `rows = [await fn(ticket) for _ in range(N)]` 列表推导里用 `await` 是合法的(在 `async def` 里),所以是一遍接一遍串行跑,保证每遍的耗时和花费不互相串。
- `passed = sum(r[0] == "reply" for r in rows)` 过门的遍数。
- `missed = sum(any(k not in r[1] for k in MUST_MENTION[name]) for r in rows if r[0] == "reply")` 过门的遍数里,有几遍缺了必须出现的词。只统计过门的,因为没过门的转人工了,不会发给客户。
- `print(f"{name:<4} {label:<7}` `statistics.mean` 求平均;`:>4.1f` 右对齐、占 4 格、一位小数。`{passed}/{N:>3}` 打印「过门遍数/总遍数」。

</div>

```bash
uv run python -m part03.wf4_compare
```

我实跑的输出(「过门」是 5 遍里过了回复门的遍数,「漏项」是过门的遍数里缺了关键词的遍数):

```text
工单   做法        调用    平均秒      平均¥    过门    漏项
一件事  一提示词     1.0    1.8   0.0023 4/  5 0/  4
一件事  编排者      4.0    2.9   0.0054 2/  5 0/  2
三件事  一提示词     1.0    1.4   0.0017 1/  5 0/  1
三件事  编排者      5.0    3.1   0.0065 5/  5 0/  5
五件事  一提示词     1.0    1.6   0.0022 0/  5 0/  1
五件事  编排者      7.0    3.5   0.0091 4/  5 0/  4
```

同样的命令我跑了两批,每批的数字都有出入(下面是第二批)。再加上一次单独数失败原因的实验(三件事、五件事各 6 遍),三份数据合起来看规律。

**调用数、耗时、花费很稳。** 一个提示词永远是 1 次调用,1.2 到 1.8 秒,约 ¥0.002;编排者 4 到 7 次调用,2.9 到 3.5 秒,¥0.005 到 ¥0.009。贵三到四倍,慢一倍多。

**漏项一直是 0。** 五件事的工单,一个提示词也一件不落地回应了。所以「模型一次装不下这么多件事」在这个规模上并不成立。

**过门率有一个很清楚的规律。** 三件事和五件事这两张工单,三份数据合起来:编排者 32 遍里过门 26 遍,一个提示词 32 遍里只过门 5 遍。一件事那张反过来,一个提示词(5 遍里 4 到 5 遍)比编排者(2 到 3 遍)好。

为什么多件事的工单一个提示词过不了门?我专门把一个提示词的 6 遍失败原因数出来:三件事 6 遍里 5 遍是同一个原因,回复里写了「10 个工作日到账」,被 Day 197 的承诺正则拦了(另 1 遍通过);五件事 6 遍里 5 遍同样的原因。原因是帮助中心那两篇文章里写着「一般 5 到 10 个工作日」,模型把它抄进了回复。我给它的提示词明明写了「不要承诺到账日期」,它还是抄了,因为那句话来自资料,它觉得是在陈述事实。

编排者那边,综合者的提示词同样写了不承诺,同时它拿到的是工作者已经写好的几段,是「改写」而不是「从资料里现写」,所以更容易把带数字的那句压成「取决于发卡银行」。同样的 6 遍实测里,编排者三件事和五件事都是 6/6 过门。

换句话说,编排者在这里多出来的价值,不是「拆得细」,而是**多了一道改写**:工作者先写,综合者再写一遍并且再次被约束,第二遍把第一遍留下的毛病滤掉了一部分。这和 Day 197 的提示链是同一个道理。这个价值是真的,但也说明一件事:如果只是想要「不带承诺的回复」,在一个提示词的后面加一道回复门、过不了就带着原因重写一次(Day 197 的做法),也能达到同样的效果,而且比编排者便宜。

那编排者还有什么用?它真正拉开差距的地方是三种:

1. **每个子任务需要不同的资料或工具。** 这次的工作者各自用自己的 `need` 检索,而对照组只有一次检索机会。如果每件事要查的是不同的数据库、调不同的接口,这个差别会变成质量差别。今天的帮助中心只有三篇文章,这个优势没发挥出来。
2. **任务大到一个提示词装不下。** 输入或输出太长、一次生成写不完,必须拆开。
3. **哪几个子任务要做,取决于输入,而且每个子任务的成本不低。** 下一节就是这个情形。

## 编排者真正划算的地方:改哪几个文件取决于需求

这是文章里的编程例子的缩小版。帮助中心有五份文档(放在内存里,不碰真实文件):

| 文件 | 讲什么 |
| --- | --- |
| `refund_faq.md` | 退款多久到账,写着「5 到 10 个工作日」 |
| `duplicate_charge.md` | 重复扣费,也写着「5 到 10 个工作日」 |
| `cs_script.md` | 客服话术,也写着「5 到 10 个工作日」 |
| `invoice_howto.md` | 怎么开发票,写着「1 个工作日内」 |
| `password_reset.md` | 忘记密码,写着「30 分钟内有效」 |

三个修改需求:到账时间改成「3 到 7 个工作日」(要改前三个文件);发票时间改成「2 个工作日内」(只改一个);密码链接有效期改成 15 分钟(只改一个)。每个需求要改哪几个文件,取决于需求本身,没法写死。

两种做法:**编排者**把五份文档全贴给模型,问「哪些文件要改、各改什么」,再对每个要改的文件派一个工作者;**写死并行**不问,每份文档都派一个工作者,让它自己判断要不要改。新建 `part03/wf4_docs.py`:

```python
# agent-zero-lab/part03/wf4_docs.py  Day 200:编排者的真正用武之地,「改哪几个文件」取决于需求。五份文档放在内存里,不碰真实文件
import asyncio
from typing import Any

from part03.wf_common import allm, llm_json, total_calls, total_cost

DOCS: dict[str, str] = {
    "refund_faq.md": "# 退款多久到账\n退款申请审核通过后,款项原路退回。到账时间取决于发卡银行,一般 5 到 10 个工作日。云簿不能保证具体到账日期。",
    "duplicate_charge.md": "# 重复扣费怎么处理\n同一张订单 10 分钟内被扣款两次,算重复扣费。客服核实后提交退款申请,多扣的一笔原路退回,银行通常需要 5 到 10 个工作日到账。",
    "cs_script.md": "# 客服话术:退款\n向客户说明:退款提交后会原路退回,到账一般 5 到 10 个工作日,具体看发卡银行,不要承诺具体日期。",
    "invoice_howto.md": "# 怎么开发票\n在「账单」页点订单右侧的「申请发票」,填写抬头和税号,电子发票 1 个工作日内发到注册邮箱。",
    "password_reset.md": "# 忘记密码\n在登录页点「忘记密码」,输入注册邮箱,重置链接 30 分钟内有效,过期要重新申请。",
}

# (需求, 应该被改的文件集合, 新文字必须出现, 旧文字必须消失)
REQUESTS: list[tuple[str, set[str], str, str]] = [
    ("银行退款到账时间的说法,从「5 到 10 个工作日」改成「3 到 7 个工作日」。", {"refund_faq.md", "duplicate_charge.md", "cs_script.md"}, "3 到 7 个工作日", "5 到 10 个工作日"),
    ("电子发票的发送时间,从「1 个工作日内」改成「2 个工作日内」。", {"invoice_howto.md"}, "2 个工作日内", "1 个工作日内"),
    ("密码重置链接的有效期,从 30 分钟缩短成 15 分钟。", {"password_reset.md"}, "15 分钟", "30 分钟"),
]

PLAN_PROMPT = (
    "下面是帮助中心的几份文档。根据修改需求,判断哪些文件需要改、每个文件具体改什么。不需要改的文件不要列。\n"
    "输出 JSON:{{\"edits\": [{{\"file\": \"文件名\", \"change\": \"这个文件里具体要改的一处\"}}]}}\n\n修改需求:{request}\n\n{docs}"
)
EDIT_PROMPT = "按要求修改下面这份文档,只改要求里说的那一处,其余字一个都不要动。只输出修改后的完整文档,不要解释。\n\n要求:{change}\n\n文档:\n{doc}"
FIXED_PROMPT = "下面是一份帮助中心文档和一个修改需求。如果这份文档需要按需求修改,就只改相关的一处;如果不需要改,原样输出。只输出完整文档,不要解释。\n\n需求:{request}\n\n文档:\n{doc}"


def docs_text() -> str:
    return "\n\n".join(f"=== {name} ===\n{body}" for name, body in DOCS.items())


def parse_edits(raw: dict[str, Any]) -> dict[str, str]:
    """门:每条修改必须指向真实存在的文件,不能指同一个文件两次。返回 {文件名: 改什么}。"""
    items = raw.get("edits")
    if not isinstance(items, list):
        raise ValueError("没有 edits 列表")
    edits: dict[str, str] = {}
    for it in items:
        if not isinstance(it, dict) or it.get("file") not in DOCS or not isinstance(it.get("change"), str):
            raise ValueError(f"这条修改不合格:{it!r}")
        if it["file"] in edits:
            raise ValueError(f"同一个文件被改两次:{it['file']}")
        edits[it["file"]] = it["change"]
    return edits


async def run_orchestrated(request: str) -> dict[str, str]:
    """编排者决定改哪几个文件,再各派一个工作者。返回 {文件名: 改完的全文},没改的文件不在里面。"""
    edits = parse_edits(await asyncio.to_thread(llm_json, PLAN_PROMPT.format(request=request, docs=docs_text())))
    names = list(edits)
    new_texts = await asyncio.gather(*[allm(EDIT_PROMPT.format(change=edits[n], doc=DOCS[n])) for n in names])
    return dict(zip(names, (t.strip() for t in new_texts)))


async def run_fixed(request: str) -> dict[str, str]:
    """写死的并行:每份文档都派一个工作者,让它自己判断要不要改。"""
    names = list(DOCS)
    new_texts = await asyncio.gather(*[allm(FIXED_PROMPT.format(request=request, doc=DOCS[n])) for n in names])
    return {n: t.strip() for n, t in zip(names, new_texts) if t.strip() != DOCS[n].strip()}  # 和原文不同才算「改了」


def judge(changed: dict[str, str], expected: set[str], new: str, old: str) -> str:
    """对答案:该改的改了吗(新文字在、旧文字不在)?不该改的动了吗?"""
    missed = [n for n in expected if n not in changed or new not in changed[n] or old in changed[n]]
    extra = [n for n in changed if n not in expected]
    return "全对" if not missed and not extra else f"漏改/没改对 {missed},多改 {extra}"


async def main() -> None:
    for request, expected, new, old in REQUESTS:
        for label, fn in [("编排者", run_orchestrated), ("写死并行", run_fixed)]:
            n0, c0 = total_calls(), total_cost()
            changed = await fn(request)
            print(f"[{request[:14]}] {label}: {total_calls() - n0} 次调用 ¥{total_cost() - c0:.4f} 改了 {sorted(changed)} → {judge(changed, expected, new, old)}")


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `DOCS: dict[str, str] = {` 文件名到内容的字典,一份文档两三句话,够演示了。
- `"cs_script.md": "# 客服话术:退款\n向客户说明:退款提交后会原路退回,到账一般 5 到 10 个工作日` 同一个数字出现在三个文件里,而且位置、措辞各不相同,不是简单的全局替换能搞定的。
- `REQUESTS: list[tuple[str, set[str], str, str]] = [` 每项四个值:需求、应该被改的文件集合(`set` 是集合,相当于 JS 的 `Set`)、新文字必须出现的片段、旧文字必须消失的片段。后两项用来自动判分。
- `("电子发票的发送时间,从「1 个工作日内」改成「2 个工作日内」。", {"invoice_howto.md"}, "2 个工作日内", "1 个工作日内"),` 只涉及一个文件,编排者应该只派一个工作者。
- `PLAN_PROMPT = (` 编排者的提示词。里面的 `{{` 和 `}}` 是 `.format` 的转义:字面的花括号要写成两个,不然会被当成占位符。
- `EDIT_PROMPT = "按要求修改下面这份文档,只改要求里说的那一处,其余字一个都不要动。` 工作者的提示词:给的是编排者拆出来的具体修改要求 `change`。
- `FIXED_PROMPT = "下面是一份帮助中心文档和一个修改需求。如果这份文档需要按需求修改,就只改相关的一处;如果不需要改,原样输出。` 写死并行那一路的提示词:让每个工作者自己判断。
- `def docs_text() -> str:` 把五份文档拼成一大段,给编排者看。
- `return "\n\n".join(f"=== {name} ===\n{body}" for name, body in DOCS.items())` `.items()` 同时给出键和值。每份文档前面加一行 `=== 文件名 ===` 做分隔。
- `def parse_edits(raw: dict[str, Any]) -> dict[str, str]:` 这一场景的「计划门」,返回 `{文件名: 要改什么}`。
- `if not isinstance(it, dict) or it.get("file") not in DOCS or not isinstance(it.get("change"), str):` 文件名必须是真实存在的。模型可能编一个不存在的文件名,代码在这里拦住,不让工作者去改一份不存在的东西。
- `if it["file"] in edits:` 同一个文件不能出现两次,否则两个工作者改同一份,后写的会盖掉先写的。
- `async def run_orchestrated(request: str) -> dict[str, str]:` 编排者的做法。
- `edits = parse_edits(await asyncio.to_thread(llm_json, PLAN_PROMPT.format(request=request, docs=docs_text())))` 一行里做了三件事:填提示词、放进线程调用 `llm_json`、过门。读法是从最里面往外:`PLAN_PROMPT.format(...)` 最先,`llm_json` 其次,`parse_edits` 最后。
- `names = list(edits)` 对字典取 `list` 得到所有键,即要改的文件名。
- `new_texts = await asyncio.gather(*[allm(EDIT_PROMPT.format(change=edits[n], doc=DOCS[n])) for n in names])` 每个要改的文件一个工作者,并行。
- `return dict(zip(names, (t.strip() for t in new_texts)))` 文件名和改完的全文配成字典。`dict(zip(...))` 是 Python 把两个列表变成字典的惯用写法。
- `async def run_fixed(request: str) -> dict[str, str]:` 写死并行的做法。
- `new_texts = await asyncio.gather(*[allm(FIXED_PROMPT.format(request=request, doc=DOCS[n])) for n in names])` 五份文档各一个工作者,不管需不需要改。
- `return {n: t.strip() for n, t in zip(names, new_texts) if t.strip() != DOCS[n].strip()}  # 和原文不同才算「改了」` 字典推导式加条件:只保留和原文不一样的。模型如果「原样输出」时多加了个空格或换行,`strip` 之后相同,不算改动。
- `def judge(changed: dict[str, str], expected: set[str], new: str, old: str) -> str:` 判分。
- `missed = [n for n in expected if n not in changed or new not in changed[n] or old in changed[n]]` 漏改或没改对:应该改的文件没出现在 `changed` 里,或者改后的文本里没有新文字,或者旧文字还在。
- `extra = [n for n in changed if n not in expected]` 多改:不该改的文件被改了。
- `return "全对" if not missed and not extra else f"漏改/没改对 {missed},多改 {extra}"` 两个列表都空就全对。
- `print(f"[{request[:14]}] {label}: {total_calls() - n0} 次调用 ¥{total_cost() - c0:.4f} 改了 {sorted(changed)} → {judge(changed, expected, new, old)}")` 每个需求、每种做法打印一行:调用数、花费、改了哪些文件、判分结果。`sorted(changed)` 对字典排序得到排好序的键列表,方便对照。

</div>

```bash
uv run python -m part03.wf4_docs
```

我实跑的输出:

```text
[银行退款到账时间的说法,从「] 编排者: 4 次调用 ¥0.0034 改了 ['cs_script.md', 'duplicate_charge.md', 'refund_faq.md'] → 全对
[银行退款到账时间的说法,从「] 写死并行: 5 次调用 ¥0.0029 改了 ['cs_script.md', 'duplicate_charge.md', 'refund_faq.md'] → 全对
[电子发票的发送时间,从「1 ] 编排者: 2 次调用 ¥0.0014 改了 ['invoice_howto.md'] → 全对
[电子发票的发送时间,从「1 ] 写死并行: 5 次调用 ¥0.0028 改了 ['invoice_howto.md'] → 全对
[密码重置链接的有效期,从 3] 编排者: 2 次调用 ¥0.0012 改了 ['password_reset.md'] → 全对
[密码重置链接的有效期,从 3] 写死并行: 5 次调用 ¥0.0028 改了 ['password_reset.md'] → 全对
```

两种做法都全对。差别在调用数:需求改三个文件,编排者 4 次(1 次拆加 3 次改),写死并行 5 次;需求只改一个文件,编排者 2 次,写死并行还是 5 次。五份文档的规模太小,花费上差别只有零点几分钱,而且改三个文件时编排者反而略贵(¥0.0034 对 ¥0.0029),因为拆那一次要把五份文档全部读进去。

把规模放大再想:如果有 500 份文档,每个需求只涉及 3 份,写死并行要发 500 次调用,编排者是 1 次拆(要读 500 份,输入很长)加 3 次改。编排者的优势随着「文档数 ÷ 要改的文档数」的比值变大而变大。反过来如果每个需求几乎涉及所有文档,编排者就是白多一次调用。

练习 1 把每种做法在三个需求上各跑 8 遍,看稳不稳。

## 用剧本测试计划门和编排流程

计划门和编排主流程里的几个出口,不需要真调模型。新建 `tests/test_wf4.py`,用 `monkeypatch` 换掉 `orchestrate` 里的 `make_plan`、`work` 和 `allm`:

```python
# agent-zero-lab/tests/test_wf4.py  Day 200:不调真模型,测计划那道门和编排流程的几个出口
import asyncio

import pytest

from part03 import wf4_orchestrator
from part03.wf4_docs import parse_edits
from part03.wf4_plan import MAX_SUBTASKS, PlanError, Subtask, parse_plan
from part03.wf4_tickets import TICKET_THREE


def sub(n: int) -> dict[str, str]:
    return {"title": f"事项{n}", "need": f"要求{n}"}


def test_plan_ok():
    plan = parse_plan({"subtasks": [sub(1), sub(2)]})
    assert [p.title for p in plan] == ["事项1", "事项2"]


@pytest.mark.parametrize(
    "raw",
    [
        {},
        {"subtasks": []},
        {"subtasks": "退款"},
        {"subtasks": [sub(i) for i in range(MAX_SUBTASKS + 1)]},  # 超过上限
        {"subtasks": [{"title": "只有标题"}]},
        {"subtasks": [{"title": " ", "need": "x"}]},
        {"subtasks": [sub(1), sub(1)]},  # 标题重复
    ],
)
def test_plan_rejected(raw):
    with pytest.raises(PlanError):
        parse_plan(raw)


def test_edits_must_point_to_real_files():
    assert parse_edits({"edits": [{"file": "cs_script.md", "change": "改一处"}]}) == {"cs_script.md": "改一处"}
    with pytest.raises(ValueError):
        parse_edits({"edits": [{"file": "不存在.md", "change": "x"}]})
    with pytest.raises(ValueError):
        parse_edits({"edits": [{"file": "cs_script.md", "change": "x"}, {"file": "cs_script.md", "change": "y"}]})


def patch(monkeypatch, plan, worker, synth):
    """plan 是 Subtask 列表或异常;worker(sub) 返回文字或抛异常;synth 是综合者返回的文字。"""

    def fake_make_plan(ticket):
        if isinstance(plan, BaseException):
            raise plan
        return plan

    async def fake_work(ticket, s):
        return worker(s)

    async def fake_allm(prompt, system="", model=None):
        return synth

    monkeypatch.setattr(wf4_orchestrator, "make_plan", fake_make_plan)
    monkeypatch.setattr(wf4_orchestrator, "work", fake_work)
    monkeypatch.setattr(wf4_orchestrator, "allm", fake_allm)


GOOD = "您好,订单 CL-20931 和 CL-20932 我们会处理。"


def test_happy_path(monkeypatch):
    patch(monkeypatch, [Subtask("a", "x"), Subtask("b", "y")], lambda s: f"处理{s.title}", GOOD)
    r = asyncio.run(wf4_orchestrator.orchestrate(TICKET_THREE))
    assert r.action == "reply" and r.parts == ["【a】处理a", "【b】处理b"]


def test_bad_plan_goes_human(monkeypatch):
    patch(monkeypatch, PlanError("拆出了 9 个"), lambda s: "", GOOD)
    r = asyncio.run(wf4_orchestrator.orchestrate(TICKET_THREE))
    assert r.action == "human" and "计划不合格" in r.text


def test_one_worker_fails_but_others_survive(monkeypatch):
    def worker(s):
        if s.title == "b":
            raise RuntimeError("500")
        return "ok"

    patch(monkeypatch, [Subtask("a", "x"), Subtask("b", "y")], worker, GOOD)
    r = asyncio.run(wf4_orchestrator.orchestrate(TICKET_THREE))
    assert r.action == "reply"
    assert "处理失败" in r.parts[1] and r.parts[0] == "【a】ok"


def test_synth_dropping_order_id_is_caught(monkeypatch):
    patch(monkeypatch, [Subtask("a", "x")], lambda s: "ok", "您好,我们会处理您的订单 CL-20931。")  # 漏了 CL-20932
    r = asyncio.run(wf4_orchestrator.orchestrate(TICKET_THREE))
    assert r.action == "human" and "CL-20932" in r.text


def test_synth_promise_is_caught(monkeypatch):
    patch(monkeypatch, [Subtask("a", "x")], lambda s: "ok", "订单 CL-20931 和 CL-20932 将在 3 个工作日内退回。")
    r = asyncio.run(wf4_orchestrator.orchestrate(TICKET_THREE))
    assert r.action == "human" and "承诺" in r.text


def test_plan_not_json_counts_as_plan_error(monkeypatch):
    import json

    from part03 import wf4_plan

    def boom(prompt, **kw):
        raise json.JSONDecodeError("bad", "{", 1)

    monkeypatch.setattr(wf4_plan, "llm_json", boom)
    with pytest.raises(PlanError, match="不是合法 JSON"):
        wf4_plan.make_plan("x")
```

<div class="line-notes">

- `from part03 import wf4_orchestrator` 导入模块,测试里才能改模块里的名字。
- `def sub(n: int) -> dict[str, str]:` 造一个假子任务字典:`sub(1)` 是 `{"title": "事项1", "need": "要求1"}`。
- `def test_plan_ok():` 最基本的:两个合格的子任务,标题都在。
- `@pytest.mark.parametrize(` 下面七组「不合格的计划」共用一个测试函数。
- `{"subtasks": [sub(i) for i in range(MAX_SUBTASKS + 1)]},  # 超过上限` 6 个子任务,比上限 5 多一个。
- `{"subtasks": [sub(1), sub(1)]},  # 标题重复` 两个标题都是「事项1」。
- `def test_plan_rejected(raw):` 对每一组都断言抛 `PlanError`。`with pytest.raises(PlanError):` 是「这段代码必须抛这种异常,否则测试失败」。
- `def test_edits_must_point_to_real_files():` 改文档那一场景的门:不存在的文件名、同一文件重复,都要拦。
- `def patch(monkeypatch, plan, worker, synth):` 辅助函数:把编排流程里三个会真调模型的地方都换成假的。
- `def fake_make_plan(ticket):` 假编排者:`plan` 是异常对象就抛它,否则返回这个计划。
- `async def fake_work(ticket, s):` 假工作者:调用传进来的 `worker` 函数,它可以返回文字,也可以抛异常。
- `async def fake_allm(prompt, system="", model=None):` 假综合者:直接返回 `synth` 这段文字。
- `GOOD = "您好,订单 CL-20931 和 CL-20932 我们会处理。"` 一段能过回复门的综合结果:两个订单号都在,没承诺。
- `def test_happy_path(monkeypatch):` 一切正常:`action` 是 `reply`,各段的格式是 `【a】处理a`。
- `def test_bad_plan_goes_human(monkeypatch):` 计划不合格转人工,文本里有「计划不合格」。
- `def test_one_worker_fails_but_others_survive(monkeypatch):` 一个工作者抛 `RuntimeError`,另一个正常。整体仍然是 `reply`,失败的那段是「处理失败」的占位文字,正常的那段原样保留。钉住的是 `return_exceptions=True` 的行为。
- `def test_synth_dropping_order_id_is_caught(monkeypatch):` 综合者漏了订单号 `CL-20932`:转人工,原因里有这个订单号。
- `def test_synth_promise_is_caught(monkeypatch):` 综合者写了「3 个工作日内退回」:转人工,原因里有「承诺」。
- `def test_plan_not_json_counts_as_plan_error(monkeypatch):` 编排者输出非法 JSON:包装成 `PlanError`。`json.JSONDecodeError("bad", "{", 1)` 的三个参数是错误信息、出错的文本和位置,随便填就行。
- `with pytest.raises(PlanError, match="不是合法 JSON"):` `match` 用正则检查异常信息里有这几个字。

</div>

```bash
uv run pytest -q tests/test_wf4.py
```

```text
...............                                                          [100%]
15 passed in 1.35s
```

15 个全绿(参数化的那 7 组各算一个)。其中三个钉住了今天最重要的出口:计划不合格、一个工作者失败、综合者合成之后门依然要查。

## 动手练习

### 练习 1:稳不稳,跑 8 遍

把改文档的两种做法,三个需求各跑 8 遍(共 24 次判分),数「全对」几次、总共调用多少次、花多少钱。

<details><summary>参考答案</summary>

新建 `part03/ex200_repeat.py`:

```python
# agent-zero-lab/part03/ex200_repeat.py  Day 200 练习 1:改文档的两种做法各跑 8 遍,数「全对」几次,再看花费
import asyncio
from collections import Counter

from part03.wf4_docs import REQUESTS, judge, run_fixed, run_orchestrated
from part03.wf_common import total_calls, total_cost

N = 8


async def main() -> None:
    for label, fn in [("编排者", run_orchestrated), ("写死并行", run_fixed)]:
        n0, c0 = total_calls(), total_cost()
        results: Counter[str] = Counter()
        for request, expected, new, old in REQUESTS:
            for _ in range(N):
                try:
                    verdict = judge(await fn(request), expected, new, old)
                except ValueError as e:  # 编排者的计划没过门
                    verdict = f"计划不合格:{e}"
                results["全对" if verdict == "全对" else "有问题"] += 1
                if verdict != "全对":
                    print("   ", label, request[:10], verdict[:70])
        print(f"{label}: {dict(results)},共 {total_calls() - n0} 次调用,¥{total_cost() - c0:.4f}")


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `from part03.wf4_docs import REQUESTS, judge, run_fixed, run_orchestrated` 复用上一节的两种做法和判分函数。
- `results: Counter[str] = Counter()` 数「全对」和「有问题」各几次。
- `for _ in range(N):` 每个需求每种做法跑 `N=8` 遍。
- `except ValueError as e:  # 编排者的计划没过门` `parse_edits` 不合格时抛的是 `ValueError`,也算一次「有问题」,不能让它把整个脚本炸掉。
- `results["全对" if verdict == "全对" else "有问题"] += 1` 先决定键是哪个,再给 `Counter` 里这个键加 1。
- `print("   ", label, request[:10], verdict[:70])` 有问题的才打印,正常的不吵。
- `print(f"{label}: {dict(results)},共 {total_calls() - n0} 次调用,¥{total_cost() - c0:.4f}")` 一种做法跑完打印汇总。

</div>

```bash
uv run python -m part03.ex200_repeat
```

```text
编排者: {'全对': 24},共 64 次调用,¥0.0477
写死并行: {'全对': 24},共 120 次调用,¥0.0682
```

两种做法 24 次全对,没有一次出问题,没有任何「有问题」的打印行。差别全在成本:调用数 64 对 120(编排者 8×(4+2+2)=64,写死并行 24×5=120),花费 ¥0.0477 对 ¥0.0682,编排者省约 30%。成本差别不到一半,是因为拆那一步要把五份文档全读一遍,输入 token 不少。

</details>

### 练习 2:八件事的工单,门拦住了怎么办

构造一张有 8 件事的工单,上限是 5。先观察计划门怎么处理,然后加一个「合并重拆一次」的补救:门拦下之后,把原因告诉编排者,让它合并相近的诉求再拆一次。

<details><summary>参考答案</summary>

新建 `part03/ex200_cap.py`:

```python
# agent-zero-lab/part03/ex200_cap.py  Day 200 练习 2:工单里有 8 件事,超过上限 5 个。门拦住以后,让编排者合并重拆一次
from part03.wf4_plan import MAX_SUBTASKS, PlanError, Subtask, make_plan

TICKET_EIGHT = """客户:陈先生(customer_id 10086)
内容:1) 退重复扣的 1188;2) 发票抬头重开;3) 报表导出转圈;4) 双重验证收不到码;
5) 想问年付折扣;6) 想把管理员转给同事;7) 新同事要加报表只读权限;8) 想开通 API 并问调用限额。"""


def make_plan_with_merge(ticket: str) -> list[Subtask]:
    try:
        return make_plan(ticket)
    except PlanError as first_error:
        print("第一次计划被门拦住:", first_error)
        extra = f"\n\n上一次的计划被拒绝了,原因:{first_error}。请把相近的诉求合并,最多 {MAX_SUBTASKS} 个子任务。"
        return make_plan(ticket, extra)  # 第二次再不合格就让 PlanError 往外抛,调用方转人工


if __name__ == "__main__":
    try:
        plan = make_plan_with_merge(TICKET_EIGHT)
        print(f"合并后 {len(plan)} 个:", [p.title for p in plan])
    except PlanError as e:
        print("第二次也不合格,转人工:", e)
```

<div class="line-notes">

- `from part03.wf4_plan import MAX_SUBTASKS, PlanError, Subtask, make_plan` 用的就是上面的 `make_plan`,它的 `extra` 参数这里派上用场。
- `TICKET_EIGHT = """客户:陈先生(customer_id 10086)` 八件事:退款、发票、导出、双重验证、折扣、转管理员、加权限、开 API。
- `def make_plan_with_merge(ticket: str) -> list[Subtask]:` 第一次拆不合格,带着原因再拆一次。
- `except PlanError as first_error:` 接住第一次的计划不合格。
- `print("第一次计划被门拦住:", first_error)` 打印原因,实跑里是「拆出了 8 个子任务,超过上限 5」。
- `extra = f"\n\n上一次的计划被拒绝了,原因:{first_error}。请把相近的诉求合并,最多 {MAX_SUBTASKS} 个子任务。"` 把原因原文告诉编排者,并明确要求合并。这里才出现「最多 5 个」,而且是在被门拦住之后。
- `return make_plan(ticket, extra)  # 第二次再不合格就让 PlanError 往外抛,调用方转人工` 第二次不再兜底:再不行就让异常往外抛,由调用方转人工。重试一次就够了,不要写成无限循环。

</div>

```bash
uv run python -m part03.ex200_cap
```

```text
第一次计划被门拦住: 拆出了 8 个子任务,超过上限 5
合并后 5 个: ['退重复扣款与发票重开', '修复报表导出与验证码', '咨询年付折扣', '转移管理员权限', '开通API与报表权限']
```

门拦住了 8 个,合并后拆成 5 个,八件事都还在(「退款+发票」、「导出+验证码」、「管理员」、「权限+API」各自合并了)。

这个练习背后有一个我真实踩过的坑:我的编排者提示词第一版写的是「至少 1 个,最多 5 个」。拿这张八件事的工单去跑,门一次都没触发,因为模型很听话,只拆了 5 个。拆出来的标题是:

```text
['退款重复扣费', '发票抬头重开', '报表导出卡顿', '双重验证收不到码', '咨询年付折扣']
```

后面三件事(转管理员、加权限、开 API)悄悄没了。没有报错,没有提示,一个看起来完全合格的计划,悄悄丢了三件事。把「最多 5 个」从提示词里拿掉,换成「不要遗漏」,上限交给代码的门去卡,门才看得见「拆出了 8 个」。

原则:**限制写在代码里,别写在提示词里**。提示词里的限制,模型会用「丢东西」的方式去满足它,而你看不见;代码里的限制,超了会报错,你看得见。

</details>

### 练习 3:不要综合者,直接拼

去掉综合者,把工作者的三段按顺序直接拼起来(加上序号),看和综合过的回复差在哪。

<details><summary>参考答案</summary>

新建 `part03/ex200_no_synth.py`:

```python
# agent-zero-lab/part03/ex200_no_synth.py  Day 200 练习 3:不要综合者,工作者的段落直接拼起来,看和综合过的差在哪
import asyncio

from part03.wf4_orchestrator import work
from part03.wf4_plan import make_plan
from part03.wf4_tickets import TICKET_THREE


async def main() -> None:
    plan = make_plan(TICKET_THREE)
    parts = await asyncio.gather(*[work(TICKET_THREE, s) for s in plan])
    print("\n\n".join(f"{i}. {p}" for i, p in enumerate(parts, 1)))
    print("---")
    print("含「你」(不是「您」)的段落:", [i for i, p in enumerate(parts, 1) if "你" in p.replace("您", "")])


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `from part03.wf4_orchestrator import work` 复用工作者。
- `plan = make_plan(TICKET_THREE)` 拆一次。
- `parts = await asyncio.gather(*[work(TICKET_THREE, s) for s in plan])` 三个工作者并行,不加 `return_exceptions`,这个练习不测失败。
- `print("\n\n".join(f"{i}. {p}" for i, p in enumerate(parts, 1)))` `enumerate(parts, 1)` 从 1 开始给每段编号。
- `print("含「你」(不是「您」)的段落:", [i for i, p in enumerate(parts, 1) if "你" in p.replace("您", "")])` 检查称呼是不是统一:先把「您」都删掉,再看有没有残留的「你」。空列表表示没有。

</div>

```bash
uv run python -m part03.ex200_no_synth
```

```text
1. 关于您 9 月 28 日被扣两次 1188 元的问题，我们会核实订单 CL-20931 和 CL-20932 的扣款情况，确认属于同一订单 10 分钟内重复扣费的，将提交退款申请，多扣的一笔原路退回。退款审核通过后到账时间取决于发卡银行，一般需要 5 到 10 个工作日，具体到账日期无法保证。

2. 发票抬头需要补上「有限」二字后重开，这一项我们会转给对应的同事跟进。

3. 关于报表导出在 Chrome 浏览器下长时间无响应的问题，目前帮助中心没有对应的排查步骤可参考，这一项我们会转给对应的同事跟进。
---
含「你」(不是「您」)的段落: []
```

直接拼和综合过的回复比:

- 没有问候和道歉,没有结尾。读起来像三条记录,不像一封信。
- 第 1 段保留了「一般需要 5 到 10 个工作日」,这句如果直接发出去,会被回复门当作承诺拦下;综合者有时会顺手删掉它,有时不会。
- 第 2 段和第 3 段都以「这一项我们会转给对应的同事跟进」收尾,重复。
- 称呼这次碰巧统一(都是「您」),没有出现「你」和「您」混用。我在更早的一次实跑里见过工作者之间称呼不一致,所以这个检查值得留着,但不能说它每次都会出问题。

结论:综合者的价值是「把三份记录变成一封信」,代价是多一次调用和多一次编造事实的机会。需要它的前提是最终的成品要给人读;如果成品是三个结构化字段交给别的程序,就不需要综合者。

</details>

验收标准:`tests/test_wf4.py` 的 15 个测试全绿;你能不看文章写出 `parse_plan`;能说出「为什么限制要写在代码里而不是提示词里」,以及「编排者在什么情况下才比一个提示词划算」。

## 花费

文中命令跑一遍的大致花费:`wf4_plan` 一遍约 ¥0.003,`wf4_orchestrator` 一遍 ¥0.0059,`wf4_compare`(三张工单 × 两种做法 × 5 遍,编排者按 4 到 7 次调用算)¥0.14(一批),`wf4_docs` 一遍约 ¥0.015,练习 1(`ex200_repeat`)¥0.0477 + ¥0.0682,练习 2 约 ¥0.003,练习 3 约 ¥0.005,测试不调模型。我写这篇时另外还试过几个版本的提示词和对照方式,多花了约 ¥0.2(主要是 `wf4_compare` 另外跑了两批,以及单独数失败原因的 24 次)。合计约 ¥0.5。价格按 `.env` 里的 `LLM_PRICE=0.04,2,8`(deepseek-flash 缓存命中、未命中、输出,元每百万 token),2026 年 10 月查过 DeepSeek 价格页。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 编排者(orchestrator) | 看了输入、决定拆成哪些子任务的那个模型调用。例:把五件事的工单拆成 5 个子任务 |
| 工作者(worker) | 只负责一个子任务的模型调用,彼此看不见。例:一个只写「重开发票」那一段 |
| 综合者(synthesizer) | 把几个工作者的输出合成一份完整成品的模型调用。例:把三段合成一封回复信 |
| 子任务(subtask) | 编排者拆出来的一小块任务,包含标题和要求。今天用 `Subtask` 表示 |
| 计划门 | 检查编排者的计划是否合格的代码:数量、格式、重复。不合格就转人工 |
| `PlanError` | 自定义异常,表示编排者的计划不能用。继承内置的 `Exception` |
| 闭包 | 嵌套函数可以直接使用外层函数的变量。`orchestrate` 里的 `done` 用到外层的 `t0`、`c0`、`n0` |
| 集合(set) | 不重复元素的容器,相当于 JS 的 `Set`。例:`{"refund_faq.md", "cs_script.md"}` |
| 可变默认值 | 把列表之类可变对象写成默认参数或字段默认值,会被所有实例共用。数据类里必须用 `field(default_factory=list)` |
| 全局替换 | 把文本里所有出现的某个字符串换成另一个。今天的三份文档里同一个数字措辞各不相同,所以简单的全局替换不够 |

## 常见误区

**以为编排者-工作者比一个提示词高级。** 今天的实测里,三张工单一个提示词都能一件不落地回应,而且快一倍、便宜三到四倍;编排者多出来的好处只是过门率,而那个靠一道回复门加重写也能拿到。拆开做是有成本的:多一次拆、多一次合、每一次都可能出新错。只有任务大、子任务需要不同的资料或工具、或者要改的东西取决于输入时才划算。

**把子任务数量的限制写进提示词。** 我写过「最多 5 个」,八件事的工单被悄悄合并成五个,三件事消失了,一个报错都没有。限制放在代码的门里,超了会报错,你才看得见。

**工作者之间没有共享信息却指望它们保持一致。** 工作者互相看不见,各自会写同样的客套话,有的用「您」有的用「你」。要么加综合者,要么用同一个很具体的模板限制它们。

**综合者当成「润色」不再检查。** 综合者是一次新的模型生成,可能漏掉订单号、可能加进承诺。每一段单独看都没问题,不代表合起来也没问题,回复门要放在综合者**之后**。

**一个工作者失败就整体失败。** `gather` 不加 `return_exceptions=True`,一个工作者超时,整个流程都炸了,其余几个白干。要用占位文字顶替失败的那一段,让综合者在回复里说明那一项会另行跟进。

**以为计划拆得对。** 门只管格式和数量,不管拆得对不对。「一件事」那张拆成了两个,换一次可能是一个。拆得对不对要靠评测集去量,第六部分会学。

**对改文档这类任务用写死并行也没错。** 五份文档、需求只涉及一两份时,两种做法都全对,差别只在调用数。文档越多,编排者的优势才越明显。别为了「看起来高级」就上编排者。

## 学习资料

### 文档与文章

- [Anthropic · Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):读「Workflow: Orchestrator-workers」一节,编程和多文件搜索两个例子。英文。
- [claude-cookbooks · orchestrator_workers.ipynb](https://github.com/anthropics/claude-cookbooks/blob/main/patterns/agents/orchestrator_workers.ipynb):官方的参考实现,编排者输出 XML 格式的任务列表,和今天 JSON 加计划门的写法对照看。英文。
- [Anthropic · How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system):编排者-工作者的「会循环」的升级版,看他们怎么应对「子任务数量由模型定」带来的失控问题。第五部分会精读,现在看个大概。英文。
- [Python 文档 · dataclasses](https://docs.python.org/zh-cn/3.12/library/dataclasses.html):中文,找 `field(default_factory=...)` 的说明,对照今天 `Result` 里的写法。
- [Python 文档 · 协程与任务(asyncio.gather)](https://docs.python.org/zh-cn/3.12/library/asyncio-task.html):中文,`return_exceptions` 参数。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1PWBYB8Eii&autoplay=0&high_quality=1" title="Workflow 模式之:协调器—工作器模式|精读《Building Effective Agents》⑦" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>慢学AI · Workflow 模式之:协调器—工作器模式 · 3 分半,讲这个模式和并行的区别,看完对照今天的「编排者-工作者是什么」一节。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/D7_ipDqhtwk" title="How We Build Effective Agents: Barry Zhang, Anthropic" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · How We Build Effective Agents: Barry Zhang, Anthropic · 文章作者之一的演讲,讲什么时候该保持简单、什么时候才上复杂的结构,英文。</figcaption>
</figure>

### 书籍

- Antonio Gulli《Agentic Design Patterns: A Hands-On Guide to Building Intelligent Systems》(Springer, 2025):有一章讲多智能体协作与规划(Planning),和编排者拆任务是同一类问题,带代码,英文。
- Chip Huyen《AI Engineering》(O'Reilly, 2025):讲 Agent 的规划与失败模式,今天「计划门」要防的几类错(空的、太多、重复)可以对着读,英文。

### 开源项目与代码

- [anthropics/claude-cookbooks](https://github.com/anthropics/claude-cookbooks):`patterns/agents/` 目录,官方对几种 workflow 模式的实现。
- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):第五部分会学。LangGraph 里的 `Send` 用来动态地派出数量不定的并行节点,就是今天编排者-工作者的图版本。

## 自测

1. 编排者-工作者和并行,区别在哪?为什么说它离 agent 只有一步?

<details><summary>答案</summary>

并行里,开几路、各做什么由代码写死;编排者-工作者里,拆成几个子任务由模型根据输入决定。但今天的编排者只拆一次、做一轮、合一次,整个流程的形状还是代码定的,所以仍是 workflow。如果编排者在看到工作者的结果之后,再决定下一步拆什么、要不要再派人,流程的形状就由模型在运行时决定了,那就是 agent。

</details>

2. 为什么「最多 5 个」写在提示词里会出问题,写在代码里就好?

<details><summary>答案</summary>

模型会想办法满足提示词里的限制,方式可能是悄悄丢掉一部分内容,而且输出看起来完全合格,你发现不了。代码里的限制是对输出做检查,超出就抛异常,是看得见、能记录、能转人工的。实测八件事的工单,在提示词限制下被悄悄合并成 5 个,丢了 3 件;改成代码的门之后,门报出「拆出了 8 个子任务」,再触发合并重拆。

</details>

3. 实测里一个提示词比编排者便宜三到四倍还快一倍。那编排者的价值到底在哪?

<details><summary>答案</summary>

在三种情形下:(1)每个子任务需要不同的资料或工具,一个提示词只有一次检索机会,工作者能各查各的;(2)任务大到一个提示词装不下或写不完;(3)哪些子任务要做取决于输入,而且每个子任务成本不低,如改文档例子里的「500 份文档只改 3 份」,编排者只派 3 个工作者,写死并行要派 500 个。今天的三张工单任务小、资料少,三种情形都不沾,所以编排者只是更贵。

</details>

4. 一个工作者超时了,你的 `orchestrate` 怎么处理?

<details><summary>答案</summary>

`gather` 加了 `return_exceptions=True`,所以那个工作者的异常对象会出现在结果列表的对应位置,别的工作者正常返回。代码把异常对象换成一句占位文字「这一项处理失败,回复里说明会有同事单独跟进」,连同其它段一起交给综合者,最终回复里会说明那一项另行跟进。测试里有一个用例专门钉住这个行为。

</details>

5. 面试题:让你设计一个能自动改一批代码文件的系统,需求是自然语言(比如「把所有调用旧 API 的地方换成新 API」)。你会怎么用编排者-工作者?要注意什么?

<details><summary>答案</summary>

编排者读需求,加上文件列表或代码搜索的结果,决定哪些文件要改、每个文件改什么,输出结构化计划;代码做计划门:文件必须真实存在、不重复、数量有上限、路径限制在仓库内。工作者各改一个文件,输入只含这个文件加具体修改要求,输出改后的全文或补丁;代码再检查每个输出:语法能解析(比如 AST 解析、编译)、改动范围和计划一致、旧 API 的调用确实消失了。综合这一步在代码任务里往往不是模型,而是代码:把补丁应用到仓库、跑测试。要注意的事:同一个文件不能被两个工作者同时改(计划门里判重);文件之间有依赖(改了函数签名,调用方也要改)时,拆分可能出错,所以编排者要看到依赖关系,或者改完跑全量测试兜底;计划的数量要有上限和人工确认,尤其是写操作;工作者要在沙箱或分支里改,不直接动主分支;失败的文件要明确标出,不能悄悄跳过。最后要有评测:用一批已知答案的需求,量「该改的改了、不该改的没动」的比例,就像今天的 `judge`。

</details>

## 明天预告

明天是 **Day 201 · 模式五:评估者-优化者**。今天的流程里有一个漏洞:「已为您核实订单……」这种客服根本没查过的说法,工作者会写,综合者会抄,回复门也拦不住。明天换一个思路:让一个评估者按标准给回复挑刺,优化者带着问题重写,循环到过关。这是 workflow 里唯一有「循环」的模式,所以会多出新问题:评估者靠不靠谱、怎么停、会不会兜圈子。
