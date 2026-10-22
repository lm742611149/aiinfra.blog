---
title: 'Day 463 · 主工作流(六):不花钱的单测和端到端 10 张工单'
description: '用假 LLM、假检索、假工具把 SupportPilot 主工作流的每条路测一遍:退款停在审批再恢复、转人工时作废申请、质检两次不过、违规承诺被正则拦下,11 个测试 1.5 秒跑完不花钱;再接真模型和真库在终端跑 10 张演示工单,合计 0.17 元,把发现的问题记进清单。'
pubDate: 2026-10-22
regime: none
tags: ['pytest', 'langgraph', 'testing', 'supportpilot', 'python', 'agent-zero']
series: 'agent-zero'
day: 463
lang: 'zh'
draft: true
---

## 上一课回顾

昨天(Day 462)写完了 `agent/graph.py`:三个路由函数决定分支,`build_graph()` 把九个节点连成一张图,编译后打印出 11 个节点、15 条边。你还故意写错了三次路由,知道了 `add_conditional_edges` 的去处列表为什么必须写;最后跑了一次 `create_agent` 预置 agent,对比了自己写 act 循环的理由。

但这张图到现在一张工单都没跑过。今天让它真正跑起来,分两步:先用假零件跑,验证「流程对不对」,不连库、不花钱;再用真模型、真数据库跑 10 张演示工单,看「效果好不好」。这两件事分开做,是今天最重要的思路。

## 今天要解决的问题

学完今天你应该能做到:

1. 写出 `tests/fakes.py`:一个假 LLM、一个假检索器、一个假工具层,组装成 `Deps`,让任何一个节点都能在没有网络和数据库的情况下运行。
2. 写出 `tests/test_graph_smoke.py` 的 11 个测试,覆盖政策问答、退款审批停下再恢复、转人工时作废待审批申请、投诉直接转人工、质检两次不过、违规承诺被拦,`uv run pytest` 1.5 秒全绿。
3. 写出 `scripts/run_tickets.py`,在终端里端到端跑 10 张演示工单,遇到退款审批时停下来问你 y/N,最后打印每张的结局和花费。
4. 看着 10 张工单的输出,写一份「问题清单」,说清楚哪些是模型的问题、哪些是规则的问题。

预计用时 3 小时(端到端那一步要等模型,10 张跑完大约 3 分钟)。前置:Day 71–74(pytest 入门、配置、fixture 和 parametrize、假对象)、Day 316(checkpointer 和 thread_id)、Day 319(interrupt 和 Command(resume))、Day 323(stream_mode)、Day 457–462(LLMClient、状态、提示词、依赖注入、九个节点、图)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `FakeLLM` 和退款审批那个测试默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 两种测试,测的是两件事

一张工单从进来到回复,中间有两类东西会出错。

一类是**流程**:投诉单有没有直接转人工?退款申请建了以后图有没有停在审批?质检打回以后有没有回去重写?重写两次还不过有没有转人工?这些是我们写的代码决定的,答案是确定的,对就是对,错就是错。

另一类是**能力**:分诊分得准不准?检索到的文章对不对?草稿写得好不好、有没有编事实?这些是模型决定的,每次跑结果都可能不一样,只能用一批样本统计着看,这是 Day 476 开始的评测要干的事。

把两类混在一起测,结果会很糟:每次跑测试都要花钱、要等十几秒,而且同一个测试今天过明天不过,你分不清是代码坏了还是模型今天发挥不好。所以流程用假零件测,确定、免费、几秒钟;能力用评测测。

前端你应该很熟这个分法:组件逻辑用 vitest 配 mock 的 fetch 测(Day 74 的 `monkeypatch` 就相当于 `vi.mock`),接口真不真能用,交给 e2e 或者 Playwright 去跑。今天的单测相当于前者,端到端脚本相当于后者。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="单测和端到端用的是同一张图,只是 Deps 里装的东西不同">
<g font-family="var(--font-mono)" font-size="12">
<rect x="230" y="20" width="180" height="40" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="320" y="44" text-anchor="middle" fill="var(--ink)">build_graph(deps)</text>
<rect x="230" y="100" width="180" height="40" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="320" y="124" text-anchor="middle" fill="var(--ink)">九个节点(同一份代码)</text>
<rect x="20" y="180" width="270" height="64" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="155" y="202" text-anchor="middle" fill="var(--ink)">单测:make_deps(FakeLLM, FakeTools)</text>
<text x="155" y="222" text-anchor="middle" fill="var(--ink-soft)">不联网 · 不连库 · 1.5 秒</text>
<text x="155" y="238" text-anchor="middle" fill="var(--ink-soft)">测「流程对不对」</text>
<rect x="350" y="180" width="270" height="64" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="485" y="202" text-anchor="middle" fill="var(--ink)">端到端:Deps.from_conn(conn)</text>
<text x="485" y="222" text-anchor="middle" fill="var(--ink-soft)">真模型 · 真 Postgres · 约 3 分钟</text>
<text x="485" y="238" text-anchor="middle" fill="var(--ink-soft)">看「效果好不好」,10 张 0.17 元</text>
</g>
<g stroke="var(--ink-faint)" stroke-width="1.3" fill="none">
<line x1="320" y1="60" x2="320" y2="98"/>
<path d="M280 140 L 170 178"/>
<path d="M360 140 L 470 178"/>
</g>
</svg>
<figcaption>同一张图、同一份节点代码,只是 Deps 里装的零件不同。这就是 Day 459 做依赖注入的回报:测试不需要改一行产品代码。</figcaption>
</figure>

## 第一步:假 LLM,按系统提示认出是谁在调它

Day 459 的 `Deps` 里有 `llm` 和 `small_llm` 两个字段,节点只会调它们的三个方法:`structured()`(分诊、质检)、`chat()`(act 的工具循环)、`stream()`(起草),外加读一下 `ledger` 算花费。所以假 LLM 只要有这三个方法和一个 `ledger` 属性就能冒充真的,这叫鸭子类型(走起来像鸭子、叫起来像鸭子,就当它是鸭子),TS 里叫结构类型,`interface` 只看形状不看出身,是一个道理。

`structured()` 要分清自己是被分诊还是被质检调用的。办法很土但很稳:看第一条消息的内容是不是 `prompts.CLASSIFY`(Day 458 集中放的提示词)。

新建 `tests/fakes.py`:

```python
# supportpilot/tests/fakes.py
"""假的 LLM / 检索 / 工具,让工作流的单测不连数据库、不花钱、结果确定。"""

import json
from typing import Any, cast

from supportpilot.agent import prompts
from supportpilot.agent.deps import Deps
from supportpilot.config import Settings
from supportpilot.kb.retriever import Hit
from supportpilot.llm import ChatResult, LLMClient, Usage


class FakeLLM:
    def __init__(self, triage: dict, act_script: list[list[tuple[str, dict]]], draft: str,
                 review_ok: bool = True):
        self.triage = triage
        self.act_script = list(act_script)   # 复制一份,pop 时不改到测试文件里的常量
        self.draft_text = draft
        self.review_ok = review_ok
        self.ledger = Usage()

    def structured(self, messages: list[dict], schema: Any, **_: Any) -> Any:
        self.ledger.add(Usage(100, 20, 1))
        if messages[0]["content"] == prompts.CLASSIFY:
            return schema(**self.triage)
        return schema(passed=self.review_ok, problems=[] if self.review_ok else ["金额没有依据"])

    def chat(self, messages: list[dict], tools: list[dict] | None = None, **_: Any) -> ChatResult:
        self.ledger.add(Usage(300, 50, 1))
        if not self.act_script:
            return ChatResult(content="调查结论:- 已查清")
        calls = [{"id": f"c{i}", "name": n, "arguments": json.dumps(a)}
                 for i, (n, a) in enumerate(self.act_script.pop(0))]
        raw = {"role": "assistant", "content": "", "tool_calls": [
            {"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": c["arguments"]}}
            for c in calls]}
        return ChatResult(content="", tool_calls=calls, raw_message=raw)

    def stream(self, messages: list[dict], on_token: Any = None, **_: Any) -> ChatResult:
        self.ledger.add(Usage(800, 150, 1))
        for piece in (self.draft_text[:10], self.draft_text[10:]):
            if on_token:
                on_token(piece)
        return ChatResult(content=self.draft_text)


class FakeRetriever:
    def search(self, query: str, k: int = 5) -> list[Hit]:
        return [Hit(1, "KB-refund-002", "年付 14 天无理由退款", "条件", "首次购买的年付订阅 14 天内全额退款。",
                    "/help/refund/002", "refund", 0.03, ["vector", "bm25"])]


class FakeTools:
    def __init__(self, customer: dict | None = None):
        self.customer = customer
        self.calls: list[str] = []
        self.decided: list[tuple[str, bool]] = []
        self.escalated: list[str] = []
        self.finished: list[tuple] = []

    def __call__(self, name: str, arguments: str | dict, *, ticket_id: str,
                 customer_id: str | None = None) -> tuple[str, bool]:
        self.calls.append(name)
        args = json.loads(arguments) if isinstance(arguments, str) else arguments
        if name == "get_customer":
            return (json.dumps(self.customer), False) if self.customer else ("没有找到客户", True)
        if name == "list_invoices":
            return json.dumps({"total": 1, "returned": 1, "invoices": [{"id": "INV-202609-0001"}]}), False
        if name == "check_refund_eligibility":
            return json.dumps({"invoice_id": args["invoice_id"], "eligible": True, "refund_amount_cny": 950.0,
                               "rule": "annual_first_14_days"}), False
        if name == "create_refund_request":
            return json.dumps({"id": f"RF-{ticket_id}-{args['invoice_id']}", "status": "pending",
                               "amount_cny": 950.0, "rule": "annual_first_14_days"}), False
        return "未知工具", True

    def decide_refund(self, rid: str, ok: bool, who: str, note: str) -> dict:
        self.decided.append((rid, ok))
        return {"status": "executed" if ok else "rejected"}


def make_deps(llm: FakeLLM, tools: FakeTools) -> Deps:
    fake = cast(LLMClient, llm)   # 告诉类型检查器:把它当 LLMClient 用,它该有的方法都有
    return Deps(llm=fake, small_llm=fake, retriever=FakeRetriever(), call_tool=tools,
                escalate=lambda tid, reason: tools.escalated.append(tid),
                decide_refund=tools.decide_refund,
                finish_ticket=lambda *a: tools.finished.append(a), settings=Settings())
```

<div class="line-notes">

- `from typing import Any, cast` `Any` 表示「什么类型都行」,`cast` 下面讲。
- `from supportpilot.agent import prompts` 假 LLM 要拿 `prompts.CLASSIFY` 和收到的系统提示做比较。
- `from supportpilot.llm import ChatResult, LLMClient, Usage` Day 457 写的三个类。`ChatResult` 是节点认识的返回格式,`Usage` 是记账单位,`LLMClient` 只用来做 cast。
- `class FakeLLM:` 没有继承 LLMClient,只是长得像它。
- `def __init__(self, triage: dict, act_script: list[list[tuple[str, dict]]], draft: str,` 三份剧本:分诊结果、act 每一轮调哪些工具、草稿全文。`list[list[tuple[str, dict]]]` 读作「列表,每个元素是一轮;每轮是一个列表,里面是(工具名, 参数)二元组」。
- `review_ok: bool = True):` 质检过不过。默认过,测质检打回时传 False。
- `self.act_script = list(act_script)` 复制一份新列表。这一行很关键,第五步会演示不复制会出什么事。
- `self.ledger = Usage()` 和真 LLMClient 一样有一本账,节点用 `deps.spent()` 读它算花费。
- `def structured(self, messages: list[dict], schema: Any, **_: Any) -> Any:` `**_` 收下所有用不上的关键字参数(真 LLMClient 会传 retries、model),名字叫 `_` 表示「我不用它」。
- `self.ledger.add(Usage(100, 20, 1))` 每次结构化调用假装花了 100 输入、20 输出 token,1 次调用。数字取整,方便心算。
- `if messages[0]["content"] == prompts.CLASSIFY:` 系统提示是分诊的,就返回分诊剧本。
- `return schema(**self.triage)` `**字典` 把字典展开成关键字参数,等于 `Triage(category="refund", needs_account_data=True, ...)`。pydantic 照样会校验,剧本写错字段会直接报错。
- `return schema(passed=self.review_ok, problems=[] if self.review_ok else ["金额没有依据"])` 不是分诊就是质检。不过时固定给一条问题。
- `def chat(self, messages: list[dict], tools: list[dict] | None = None, **_: Any) -> ChatResult:` act 节点每一轮调一次。
- `if not self.act_script:` 剧本用完了,返回没有工具调用的结果,act 循环看到 `tool_calls` 为空就 break。
- `calls = [{"id": f"c{i}", "name": n, "arguments": json.dumps(a)}` 把剧本的一轮变成和真 LLMClient 一样格式的工具调用。`arguments` 是 JSON 字符串,真模型给的也是字符串。
- `for i, (n, a) in enumerate(self.act_script.pop(0))]` `pop(0)` 取出并删掉第一轮,下一次调用就轮到下一轮。`enumerate` 给每个调用编号,得到 id c0、c1。
- `raw = {"role": "assistant", "content": "", "tool_calls": [` 按 OpenAI 协议拼一条 assistant 消息,act 会把它原样放进 messages,Day 161 讲过漏了它下一轮会报 400。
- `def stream(self, messages: list[dict], on_token: Any = None, **_: Any) -> ChatResult:` 起草用的流式接口。
- `self.ledger.add(Usage(800, 150, 1))` 起草输入最长(资料都在里面),假装 800 / 150。
- `for piece in (self.draft_text[:10], self.draft_text[10:]):` 切片:前 10 个字一段,剩下的一段,模拟流式推两次 token。
- `class FakeRetriever:` 不管查什么都返回同一条资料。
- `return [Hit(1, "KB-refund-002"` 按位置依次是 chunk_id、doc_id、title、heading、text、url_path、category、score、via(Day 448–451 的 Hit 数据类)。草稿里引用 `[KB-refund-002]` 才能过引用检查。
- `class FakeTools:` 冒充工具层,同时当「记录员」,测试拿这些列表做断言。
- `self.decided: list[tuple[str, bool]] = []` 每次审批决定记一条(申请号, 是否通过)。
- `def __call__(self, name: str, arguments: str | dict, *, ticket_id: str,` 定义了 `__call__` 的对象可以像函数一样被调用(Day 43 讲过魔术方法),所以 `FakeTools` 实例能直接塞进 `Deps.call_tool`。`*` 后面的参数只能用关键字传,和真的 `call_tool` 一致。
- `args = json.loads(arguments) if isinstance(arguments, str) else arguments` load_customer 传字典,act 传模型给的 JSON 字符串,两种都接。
- `return (json.dumps(self.customer), False) if self.customer else ("没有找到客户", True)` 返回(文本, 是否出错)。有客户返回档案,没有就返回错误。
- `return json.dumps({"id": f"RF-{ticket_id}-{args['invoice_id']}", "status": "pending",` 申请号拼法和 Day 452 的真实业务函数一致:`RF-工单号-账单号`。
- `return "未知工具", True` 剧本里写了没模拟的工具,会以「出错」返回,act 会把错误喂回假模型。
- `def decide_refund(self, rid: str, ok: bool, who: str, note: str) -> dict:` 审批执行函数,真的那个会改库,假的只记一笔。
- `fake = cast(LLMClient, llm)` `cast` 运行时什么都不做,原样返回 llm;它只是告诉 basedpyright「这里把它当 LLMClient 看」。不加的话 Zed 会在下一行画红线 `"FakeLLM" is not assignable to "LLMClient"`。相当于 TS 的 `llm as unknown as LLMClient`。
- `return Deps(llm=fake, small_llm=fake, retriever=FakeRetriever(), call_tool=tools,` 大模型、小模型都用同一个假的。Deps 本身是真的,一个字段没改。
- `escalate=lambda tid, reason: tools.escalated.append(tid),` lambda 就是 JS 的箭头函数(Day 30),转人工时记下工单号。
- `finish_ticket=lambda *a: tools.finished.append(a), settings=Settings())` `*a` 把所有位置参数收成一个元组。`Settings()` 用默认配置(max_revisions=1、max_act_steps=5),不读 `.env` 里的密钥也能构造。

</div>

不建图,先直接调一个节点试试,确认假零件能用:

```python
# supportpilot/scratch/try_fake_classify.py
"""不建图:用假 LLM 组装 Deps,直接调 classify 节点。"""

import sys

sys.path.insert(0, "tests")

from fakes import FakeLLM, FakeTools, make_deps

from supportpilot.agent.nodes import make_nodes

triage = {"category": "refund", "needs_account_data": True, "needs_human": False, "urgency": "normal",
          "summary": "年付首购想退款", "search_query": "年付 退款"}
llm = FakeLLM(triage, [], "草稿")
nodes = make_nodes(make_deps(llm, FakeTools()))
ticket = {"id": "T000900", "customer_email": "lina@example.com", "subject": "想退款", "body": "请帮我退款。"}
print(nodes["classify"]({"ticket": ticket}))
print(llm.ledger)
```

<div class="line-notes">

- `sys.path.insert(0, "tests")` fakes.py 在 tests/ 下,不是 supportpilot 包的一部分。在 scratch 里跑时手动把 tests 目录加进模块搜索路径,相当于 Node 里改 `NODE_PATH`。pytest 跑测试时 Day 446 的 `conftest.py` 已经替你做了这件事。
- `from fakes import FakeLLM, FakeTools, make_deps` 必须写在上一行之后,否则找不到 fakes。
- `llm = FakeLLM(triage, [], "草稿")` act 剧本是空的,草稿随便写,这次只调分诊。
- `nodes = make_nodes(make_deps(llm, FakeTools()))` 拿到九个节点函数,不需要建图。
- `print(nodes["classify"]({"ticket": ticket}))` 节点就是一个普通函数:给它状态,它返回要更新的字段。
- `print(llm.ledger)` 看假账本记了多少。

</div>

```bash
uv run python scratch/try_fake_classify.py
```

真实输出:

```text
{'triage': {'category': 'refund', 'needs_account_data': True, 'needs_human': False, 'urgency': 'normal', 'summary': '年付首购想退款', 'search_query': '年付 退款'}, 'cost_cny': 0.00036}
Usage(prompt_tokens=100, completion_tokens=20, calls=1)
```

`cost_cny` 是 0.00036 元:默认单价输入 2 元/百万 token、输出 8 元/百万 token(Day 442 的 Settings 默认值,2026 年 10 月查到的 deepseek-flash 高峰价),100 × 2 / 1,000,000 + 20 × 8 / 1,000,000 = 0.0002 + 0.00016 = 0.00036。钱是假的,但算钱的代码是真的,这个测试顺带就把 Day 457 的记账逻辑也覆盖了。

小结:假 LLM 只要实现节点真正用到的那几个方法,不用实现 LLMClient 的全部;靠系统提示区分调用方,剧本决定返回什么。

## 第二步:第一个测试,最简单的那条路

先测最短的路:客户问「专票怎么开」,不需要查账户。预期是 load_customer → classify → retrieve → draft → check → finalize,工具只调过一次 get_customer,不进 act。

新建 `tests/test_graph_smoke.py`,先放公共数据和第一个测试:

```python
# supportpilot/tests/test_graph_smoke.py(开头和第一个测试)
"""用假零件把整张图跑通:路由、审批停顿、转人工、质检打回。不连库、不花钱。"""

import pytest
from fakes import FakeLLM, FakeTools, make_deps
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from supportpilot.agent.graph import build_graph
from supportpilot.agent.nodes import PROMISE_RE
from supportpilot.agent.state import Ticket

TICKET: Ticket = {"id": "T000900", "customer_email": "lina@example.com", "subject": "想退款",
                  "body": "上周买的专业版年付,用不上,请帮我退款。"}
REFUND_TRIAGE = {"category": "refund", "needs_account_data": True, "needs_human": False, "urgency": "normal",
                 "summary": "年付首购想退款", "search_query": "年付 退款"}
ACT = [[("list_invoices", {"customer_id": "C0002"})],
       [("check_refund_eligibility", {"invoice_id": "INV-202609-0001"})],
       [("create_refund_request", {"invoice_id": "INV-202609-0001", "reason": "首购 7 天不需要"})]]
DRAFT = "您好,您的年付订阅在 14 天内,符合全额退款条件 [KB-refund-002]。已提交退款申请,审核通过后会原路退回。"
LINA = {"id": "C0002", "email": "lina@example.com"}


def test_policy_question_skips_tools():
    triage = {**REFUND_TRIAGE, "category": "invoice", "needs_account_data": False, "summary": "专票怎么开"}
    tools = FakeTools(customer={"id": "C0001"})
    graph = build_graph(make_deps(FakeLLM(triage, [], DRAFT), tools))
    out = graph.invoke({"ticket": {**TICKET, "body": "专票怎么开"}})
    assert tools.calls == ["get_customer"]                 # 没进 act
    assert out["outcome"] == "resolved"
```

<div class="line-notes">

- `from langchain_core.runnables import RunnableConfig` 运行配置的类型。下面写 `cfg: RunnableConfig = {...}`,basedpyright 才不会对 `invoke(..., cfg)` 报类型错。它是 langgraph 的依赖,不用另装。
- `from langgraph.checkpoint.memory import InMemorySaver` 内存版存档,审批停下以后状态存在这里。
- `from langgraph.types import Command` 恢复被 interrupt 暂停的图时用(Day 319)。
- `from supportpilot.agent.nodes import PROMISE_RE` Day 460 质检节点里那条「违规承诺」正则,最后一个测试单独测它。
- `TICKET: Ticket = {"id": "T000900"` 标上 Ticket 类型,传给 invoke 时类型检查才认得它是工单。T000900 这种编号种子数据里不会出现,和真实工单撞不上。
- `REFUND_TRIAGE = {"category": "refund"` 退款工单的分诊剧本。别的测试用 `{**REFUND_TRIAGE, 键: 新值}` 改一两个字段派生出来。
- `ACT = [[("list_invoices"` 三轮剧本,每轮一个工具调用:查账单、查资格、建申请。
- `DRAFT = "您好,您的年付订阅在 14 天内` 一份合规草稿:引用了假检索给的 KB-refund-002,说的是「已提交申请」而不是「已退款」。
- `def test_policy_question_skips_tools():` pytest 会自动收集 `test_` 开头的函数(Day 71)。
- `triage = {**REFUND_TRIAGE, "category": "invoice", "needs_account_data": False` 字典展开再覆盖,相当于 JS 的 `{...REFUND_TRIAGE, category: "invoice"}`。
- `graph = build_graph(make_deps(FakeLLM(triage, [], DRAFT), tools))` 不传 checkpointer:这条路不会停,用不着存档。
- `out = graph.invoke({"ticket": {**TICKET, "body": "专票怎么开"}})` 跑完整张图,返回最终状态。
- `assert tools.calls == ["get_customer"]` 只调了 load_customer 那一次工具,证明 `after_retrieve` 把它送去了 draft 而不是 act。
- `assert out["outcome"] == "resolved"` 走的是 finalize 出口。

</div>

```bash
uv run pytest tests/test_graph_smoke.py -k policy -v
```

`-k policy` 只跑名字里带 policy 的测试(Day 72 讲过)。真实输出:

```text
collecting ... collected 11 items / 10 deselected / 1 selected
tests/test_graph_smoke.py::test_policy_question_skips_tools PASSED       [100%]
======================= 1 passed, 10 deselected in 2.60s =======================
```

这是我把整个文件写完以后跑的,所以显示收集到 11 个、跳过 10 个。你现在文件里只有一个测试,那两处数字会是 1 和 0。

2.6 秒里大部分是导入 langgraph 和 jieba 的时间,图本身跑完只要几毫秒。

## 第三步:退款审批,停下来再接着跑

这是全图最重要的一条路:钱。预期行为:

1. 第一次 `invoke`,图跑到 approval 节点里的 `interrupt()` 停下,返回值里有 `__interrupt__`。
2. 停下时 act 已经建了退款申请(status 是 pending),但 `decided` 是空的:人还没点,钱一分没动。
3. 用 `Command(resume={...})` 带着同一个 thread_id 再 invoke,图从 approval 接着跑,执行审批、定稿。

Day 319 你在玩具图上做过这件事,今天在真图上再来一遍。在文件里接着写:

```python
# supportpilot/tests/test_graph_smoke.py(第二个测试)
def test_refund_goes_through_approval_then_resumes():
    tools = FakeTools(customer=LINA)
    graph = build_graph(make_deps(FakeLLM(REFUND_TRIAGE, ACT, DRAFT), tools), checkpointer=InMemorySaver())
    cfg: RunnableConfig = {"configurable": {"thread_id": TICKET["id"]}}

    out = graph.invoke({"ticket": TICKET}, cfg)
    assert "__interrupt__" in out                          # 停在审批节点
    payload = out["__interrupt__"][0].value
    assert payload["request"]["status"] == "pending"
    assert tools.calls == ["get_customer", "list_invoices", "check_refund_eligibility", "create_refund_request"]
    assert tools.decided == []                              # 人还没点,钱一分没动

    out = graph.invoke(Command(resume={"approved": True, "approver": "finance-amy"}), cfg)
    assert out["outcome"] == "resolved"
    assert tools.decided == [("RF-T000900-INV-202609-0001", True)]
    assert "[1]" in out["reply"] and "参考文章" in out["reply"]
    assert out["cost_cny"] > 0
```

<div class="line-notes">

- `graph = build_graph(make_deps(FakeLLM(REFUND_TRIAGE, ACT, DRAFT), tools), checkpointer=InMemorySaver())` 这条路会停,必须有存档。
- `cfg: RunnableConfig = {"configurable": {"thread_id": TICKET["id"]}}` thread_id 用工单号,同一张工单停下和恢复要用同一个(Day 316)。
- `out = graph.invoke({"ticket": TICKET}, cfg)` 实测停下时返回的键有 `__interrupt__`、`approval`、`cost_cny`、`customer`、`draft`、`findings`、`hits`、`refund_request`、`review`、`revisions`、`ticket`、`tool_log`、`triage`,还没有 `outcome` 和 `reply`。
- `payload = out["__interrupt__"][0].value` `__interrupt__` 是一个列表(一次可能有多个中断),`.value` 是 approval 节点传给 `interrupt()` 的那个字典。实测它的键是 type、ticket_id、request、draft、needs_finance_review,其中 needs_finance_review 是 False(950 没超过 1000 元的复核线)。
- `assert tools.calls == ["get_customer", "list_invoices", "check_refund_eligibility", "create_refund_request"]` 实测完全一致。这时假 LLM 一共被调了 7 次:分诊 1、act 4(三轮工具加一轮结论)、起草 1、质检 1。
- `assert tools.decided == []` 这一行是整个测试的灵魂:申请建了,但在人点头之前,执行函数一次都没被调。
- `out = graph.invoke(Command(resume={"approved": True, "approver": "finance-amy"}), cfg)` resume 的字典会成为 approval 节点里 `interrupt()` 的返回值。
- `assert tools.decided == [("RF-T000900-INV-202609-0001", True)]` 人点了通过,执行函数才被调用一次。
- `assert "[1]" in out["reply"] and "参考文章" in out["reply"]` finalize 把 `[KB-refund-002]` 渲染成 `[1]`,文末加了参考文章。
- `assert out["cost_cny"] > 0` 实测是 0.00752。恢复之后 approval 和 finalize 都不调模型,花费没变。

</div>

花费 0.00752 怎么来的:7 次调用里分诊和质检各一次 structured(100/20)、act 四次 chat(300/50)、起草一次 stream(800/150),输入 100×2 + 300×4 + 800 = 2200,输出 20×2 + 50×4 + 150 = 390。2200 × 2 / 1,000,000 + 390 × 8 / 1,000,000 = 0.0044 + 0.00312 = 0.00752。

实测恢复后的 `reply` 全文:

```text
您好,您的年付订阅在 14 天内,符合全额退款条件 [1]。已提交退款申请,审核通过后会原路退回。

参考文章:
[1] 年付 14 天无理由退款 https://help.cloudledger.example/help/refund/002

补充:您的退款申请已审核通过,950.00 元将原路退回,到账时间以支付渠道为准。
```

### 故意犯错:不给 checkpointer 会怎样

把 `checkpointer=InMemorySaver()` 删掉再跑这条路,会发生什么?我以为第一次 invoke 就会报错,实际上不会:

- 第一次 `invoke({"ticket": TICKET})` 照样返回,里面照样有 `__interrupt__`,看起来一切正常。
- 第二次 `invoke(Command(resume=...))` 才报错,报错的最后一行:

```text
RuntimeError: Cannot use Command(resume=...) without checkpointer
```

即使你给第二次 invoke 带上 thread_id,报的也是同一句。没有存档,停下时的状态根本没地方放,恢复就无从谈起。这个坑的危险在于第一步不报错:如果你的服务只写了「停下」那一半,上线后要等到第一个财务人员点「通过」才炸。所以这个测试把「停下」和「恢复」写在同一个函数里,两半一起验。

## 第四步:剩下四条路

接着在文件里写完剩下的测试:

```python
# supportpilot/tests/test_graph_smoke.py(后面五个测试)
def test_handoff_withdraws_pending_refund():
    tools = FakeTools(customer=LINA)
    out = build_graph(make_deps(FakeLLM(REFUND_TRIAGE, ACT, DRAFT, review_ok=False), tools)).invoke(
        {"ticket": TICKET})
    assert out["outcome"] == "escalated"
    assert tools.decided == [("RF-T000900-INV-202609-0001", False)]   # 申请被作废,不会留在审批列表里


def test_angry_customer_goes_to_human():
    triage = {**REFUND_TRIAGE, "needs_human": True}
    tools = FakeTools(customer=LINA)
    out = build_graph(make_deps(FakeLLM(triage, [], DRAFT), tools)).invoke({"ticket": TICKET})
    assert out["outcome"] == "escalated" and tools.escalated == ["T000900"]


def test_failed_review_twice_escalates():
    triage = {**REFUND_TRIAGE, "needs_account_data": False}
    tools = FakeTools(customer={"id": "C0001"})
    out = build_graph(make_deps(FakeLLM(triage, [], DRAFT, review_ok=False), tools)).invoke({"ticket": TICKET})
    assert out["outcome"] == "escalated"
    assert out["revisions"] == 2


def test_promise_rule_blocks_draft_without_llm():
    triage = {**REFUND_TRIAGE, "needs_account_data": False}
    llm = FakeLLM(triage, [], "您好,已为您退款,马上到账 [KB-refund-002]。")
    out = build_graph(make_deps(llm, FakeTools(customer={"id": "C0001"}))).invoke({"ticket": TICKET})
    assert out["outcome"] == "escalated"
    assert any("承诺" in p for p in out["review"]["problems"])
    assert llm.ledger.calls == 3                            # 分诊 1 + 起草 2,模型质检一次都没花


@pytest.mark.parametrize("text,bad", [
    ("已为您退款,马上到账", True), ("退款已到账", True), ("已为您完成退款", True),
    ("已为您提交退款申请,审核通过后原路退回", False), ("已为您办理退款申请", False),
])
def test_promise_regex(text: str, bad: bool):
    assert bool(PROMISE_RE.search(text)) is bad
```

<div class="line-notes">

- `def test_handoff_withdraws_pending_refund():` 退款剧本照走,但质检永远不过:申请已经建了,草稿却过不了关。
- `out = build_graph(make_deps(FakeLLM(REFUND_TRIAGE, ACT, DRAFT, review_ok=False), tools)).invoke(` 没传 checkpointer:质检不过就不会走到 approval,这条路不会停。
- `assert tools.decided == [("RF-T000900-INV-202609-0001", False)]` handoff 节点转人工前用 False 调了一次 decide_refund,把 pending 申请作废。没有 Day 460 handoff 里那几行的话,这里会是空列表,申请会一直挂在审批列表上,有人点通过时却没有图可以恢复。
- `triage = {**REFUND_TRIAGE, "needs_human": True}` 投诉、威胁、要求人工都会被分诊成 needs_human。
- `assert out["outcome"] == "escalated" and tools.escalated == ["T000900"]` classify 之后直接走 handoff,escalate 被调了一次。
- `def test_failed_review_twice_escalates():` 不查账、质检永远不过。实测假 LLM 被调 5 次:分诊、起草、质检、起草、质检。
- `assert out["revisions"] == 2` revisions 0 → 1 → 2,第二次不过时 2 > max_revisions=1,转人工。实测 handoff_reason 是「草稿多次未通过质检:金额没有依据」。
- `llm = FakeLLM(triage, [], "您好,已为您退款,马上到账 [KB-refund-002]。")` 一份违规草稿:说退款已经办了,还承诺马上到账。
- `assert any("承诺" in p for p in out["review"]["problems"])` `any(...)` 只要有一个为真就是真,相当于 JS 的 `problems.some(p => p.includes("承诺"))`。
- `assert llm.ledger.calls == 3` 两次质检都被正则拦下,规则查出问题就不再花钱调模型质检,所以模型只被调了 3 次。这一行证明了 Day 460「先规则后模型」的省钱设计真的生效了。
- `@pytest.mark.parametrize("text,bad", [` 一个测试函数配 5 组数据,pytest 展开成 5 个测试(Day 73)。
- `("已为您提交退款申请,审核通过后原路退回", False),` 合规的话也要测:正则写得太宽会误伤好草稿,白花一次重写的钱。
- `assert bool(PROMISE_RE.search(text)) is bad` `search` 找到返回 Match 对象,没找到返回 None,`bool()` 转成真假再和期望比。

</div>

全部跑一遍:

```bash
uv run pytest tests/test_graph_smoke.py -v
```

真实输出(参数化测试的名字里中文被转义成了 `\u` 编码,这是 pytest 的默认行为,不是乱码):

```text
tests/test_graph_smoke.py::test_policy_question_skips_tools PASSED       [  9%]
tests/test_graph_smoke.py::test_refund_goes_through_approval_then_resumes PASSED [ 18%]
tests/test_graph_smoke.py::test_handoff_withdraws_pending_refund PASSED  [ 27%]
tests/test_graph_smoke.py::test_angry_customer_goes_to_human PASSED      [ 36%]
tests/test_graph_smoke.py::test_failed_review_twice_escalates PASSED     [ 45%]
tests/test_graph_smoke.py::test_promise_rule_blocks_draft_without_llm PASSED [ 54%]
tests/test_graph_smoke.py::test_promise_regex[已为您退款,马上到账-True] PASSED [ 63%]
tests/test_graph_smoke.py::test_promise_regex[退款已到账-True] PASSED [ 72%]
tests/test_graph_smoke.py::test_promise_regex[已为您完成退款-True] PASSED [ 81%]
tests/test_graph_smoke.py::test_promise_regex[已为您提交退款申请,审核通过后原路退回-False] PASSED [ 90%]
tests/test_graph_smoke.py::test_promise_regex[已为您办理退款申请-False] PASSED [100%]
============================== 11 passed in 1.53s ==============================
```

11 个测试 1.53 秒,一分钱没花。Day 446 的 `make test` 跑的是 `pytest -m "not db and not llm"`,这 11 个测试没有打 db 或 llm 标记,会被一起跑进去,以后每次提交前都会跑。

### 故意犯错:剧本被上一个测试吃掉了

`FakeLLM.__init__` 里那行 `self.act_script = list(act_script)`,我第一版写的是 `self.act_script = act_script`,少了 `list(...)`。改回这样再跑:

```text
E       AssertionError: assert [] == [('RF-T000900...0001', False)]
E         Right contains one more item: ('RF-T000900-INV-202609-0001', False)
FAILED tests/test_graph_smoke.py::test_handoff_withdraws_pending_refund - Ass...
1 failed, 10 passed in 1.89s
```

单独跑这个测试它是过的,和别的测试一起跑就挂。原因:Python 的赋值不复制列表,`self.act_script` 和模块里的常量 `ACT` 是同一个列表对象。第二个测试(退款审批)跑的时候 `pop(0)` 了三次,把 `ACT` 掏空了;轮到第三个测试,它拿到的剧本是空的,act 第一轮就没调工具,申请根本没建,自然也就没得作废。

前端里这叫「共享可变状态」,和你在 vitest 里忘了在 `beforeEach` 里重置一个模块级数组是同一种 bug。「单独跑过、一起跑挂」这个症状,十有八九就是测试之间共享了可变的东西。`list(x)` 相当于 JS 的 `[...x]`,浅复制一层就够了,因为剧本里每一轮的内层列表我们只读不改。

## 第五步:端到端,真模型跑 10 张工单

流程验完了,现在看效果。端到端要的东西都是前面几天准备好的:Postgres 里的业务库(Day 443、445)、知识库的 62 篇文章和向量(Day 444、448–449)、`.env` 里的 DeepSeek 和 embedding 密钥(Day 442)。

先准备 10 张演示工单。新建 `data/seed/demo_tickets.jsonl`,一行一个 JSON(这种格式叫 JSONL,方便逐行追加和读取):

```json
{"customer_email": "zhangwei@example.com", "subject": "怎么开专票", "body": "我们公司要增值税专用发票,需要准备什么?"}
{"customer_email": "zhangwei@example.com", "subject": "导入失败", "body": "导入凭证一直提示 E2001,文件是从老系统导出的 xls。"}
{"customer_email": "lina@example.com", "subject": "想退款", "body": "上周买的专业版年付,发现用不上,请帮我退款。"}
{"customer_email": "lina@example.com", "subject": "能退吗", "body": "如果我现在不想用了,年付能退多少?先问问。"}
{"customer_email": "wangfang@example.com", "subject": "申请退款", "body": "5 月份买的专业版年付,现在用不上了,请退款。"}
{"customer_email": "liuyang@example.com", "subject": "扣了两次", "body": "9 月 12 号被扣了两次 39 元,请把多的退给我。"}
{"customer_email": "chenjing@example.com", "subject": "月费退款", "body": "这个月的 39 元请退给我,我不用了。"}
{"customer_email": "yanglei@example.com", "subject": "账套变只读了", "body": "为什么突然不能新增凭证了?"}
{"customer_email": "nobody@example.com", "subject": "退款", "body": "请把我的年费退了。"}
{"customer_email": "chenjing@example.com", "subject": "投诉", "body": "你们乱扣费,再不处理我就去 12315 投诉。"}
```

10 张覆盖了主要路径:政策问答、报错码、退款要求、只是咨询、按比例退款、重复扣款、月付退款被拒、扣款失败导致只读、找不到客户、投诉转人工。客户邮箱都是 Day 445 种子数据里设计好的「剧情客户」,比如李娜(C0002)是 9 月 24 日首购的专业版年付,第 7 天,在 14 天全额退款期内。

然后写脚本 `scripts/run_tickets.py`:

```python
# supportpilot/scripts/run_tickets.py
"""端到端跑 data/seed/demo_tickets.jsonl 里的 10 张工单,终端里看每一步。遇到退款审批会停下来问你。
uv run python scripts/run_tickets.py            # 全部
uv run python scripts/run_tickets.py 3          # 只跑第 3 张
"""

import json
import sys
from pathlib import Path

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from supportpilot.agent.deps import Deps
from supportpilot.agent.graph import build_graph
from supportpilot.db import connect
from supportpilot.tools import business as biz

DEMO = Path(__file__).resolve().parent.parent / "data" / "seed" / "demo_tickets.jsonl"


def show(graph, payload, cfg: RunnableConfig) -> None:
    for mode, chunk in graph.stream(payload, cfg, stream_mode=["updates", "custom"]):
        if mode == "custom":
            if chunk["type"] == "token":
                print(chunk["text"], end="", flush=True)
            elif chunk["type"] == "tool":
                print(f"\n  [tool] {chunk['name']}({chunk['args']}){' ✗' if chunk['error'] else ''}")
            elif chunk["type"] == "step":
                info = {k: v for k, v in chunk.items() if k not in ("type", "node")}
                print(f"\n  [step] {chunk['node']} {info}")
        elif "__interrupt__" in chunk:
            req = chunk["__interrupt__"][0].value["request"]
            print(f"\n  [pause] 退款审批:{req['id']} ¥{req['amount_cny']:.2f} 规则={req['rule']}")


def main() -> None:
    tickets = [json.loads(x) for x in DEMO.read_text(encoding="utf-8").splitlines() if x.strip()]
    if len(sys.argv) > 1:
        tickets = [tickets[int(sys.argv[1]) - 1]]
    conn = connect()
    graph = build_graph(Deps.from_conn(conn), checkpointer=InMemorySaver())
    for t in tickets:
        tid = biz.create_ticket(conn, t["customer_email"], t["subject"], t["body"])
        cfg: RunnableConfig = {"configurable": {"thread_id": tid}}
        print(f"\n===== {tid} · {t['customer_email']} · {t['subject']} =====")
        show(graph, {"ticket": {"id": tid, **t}}, cfg)
        while graph.get_state(cfg).next:  # 停在审批节点
            ok = input("\n  通过这笔退款吗?[y/N] ").strip().lower() == "y"
            show(graph, Command(resume={"approved": ok, "approver": "cli", "note": "" if ok else "演示驳回"}), cfg)
        final = graph.get_state(cfg).values
        print(f"\n----- 最终回复({final.get('outcome')},¥{final.get('cost_cny', 0):.4f})-----\n{final.get('reply')}")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from supportpilot.tools import business as biz` Day 452 的业务函数模块,这里只用 `create_ticket` 在库里建工单。
- `DEMO = Path(__file__).resolve().parent.parent / "data" / "seed" / "demo_tickets.jsonl"` `__file__` 是这个脚本自己的路径,往上两级是项目根。pathlib 用 `/` 拼路径(Day 37),不管你在哪个目录运行都能找到文件。
- `def show(graph, payload, cfg: RunnableConfig) -> None:` 跑图并实时打印过程。第一次启动和审批后恢复都用它,只是 payload 不同。
- `for mode, chunk in graph.stream(payload, cfg, stream_mode=["updates", "custom"]):` stream_mode 传列表时,每次产出一个(模式名, 数据)二元组(Day 323)。custom 是节点里 `_emit` 推出来的事件,updates 是每个节点返回的状态更新。
- `print(chunk["text"], end="", flush=True)` 起草节点推的 token 一段一段连着打,`end=""` 不换行,`flush=True` 让字立刻出现,打字机效果。
- `print(f"\n  [tool] {chunk['name']}({chunk['args']}){' ✗' if chunk['error'] else ''}")` act 每调一次工具打一行,出错的在末尾标个叉。
- `info = {k: v for k, v in chunk.items() if k not in ("type", "node")}` 字典推导式(Day 26),去掉两个固定键,剩下的原样打印。
- `elif "__interrupt__" in chunk:` updates 模式下,图停在 interrupt 时会产出一个带 `__interrupt__` 键的更新。
- `print(f"\n  [pause] 退款审批:{req['id']} ¥{req['amount_cny']:.2f}` `:.2f` 保留两位小数,498.75 不会变成 498.75000001。
- `tickets = [json.loads(x) for x in DEMO.read_text(encoding="utf-8").splitlines() if x.strip()]` 逐行解析 JSONL,`if x.strip()` 跳过空行(文件末尾常有一个)。
- `tickets = [tickets[int(sys.argv[1]) - 1]]` 命令行写 3,取下标 2,也就是第 3 张。
- `graph = build_graph(Deps.from_conn(conn), checkpointer=InMemorySaver())` 真模型、真库、内存存档。和单测相比,只换了 Deps。
- `tid = biz.create_ticket(conn, t["customer_email"], t["subject"], t["body"])` 先在库里建工单拿编号。种子数据有 152 张历史工单,所以第一张演示工单是 T000153。
- `show(graph, {"ticket": {"id": tid, **t}}, cfg)` `{"id": tid, **t}` 把工单号和 JSON 里的三个字段拼成一个 Ticket。
- `while graph.get_state(cfg).next:` `next` 是接下来要跑的节点,跑完是空元组 `()`,停在审批前是 `('approval',)`。用 while 不用 if,是为了以后一张工单里可能有多次审批。
- `ok = input("\n  通过这笔退款吗?[y/N] ").strip().lower() == "y"` 只有输入 y 才通过,直接回车算驳回。`[y/N]` 里大写的 N 是默认值的惯例写法。
- `show(graph, Command(resume={"approved": ok, "approver": "cli", "note": "" if ok else "演示驳回"}), cfg)` 恢复时也用 stream,能看到 approval 和 finalize 的过程。
- `final = graph.get_state(cfg).values` 从存档里取最终状态。
- `print(f"\n----- 最终回复({final.get('outcome')},¥{final.get('cost_cny', 0):.4f})-----` 花费保留四位小数,一张工单通常是几分钱。

</div>

先只跑第 3 张(李娜要退款),在 `supportpilot/` 根目录:

```bash
uv run python scripts/seed_db.py          # 每次端到端前重新造数,保证起点一样(Day 445)
uv run python scripts/run_tickets.py 3
```

为什么要先重新造数:端到端会真的改库。第 3 张批准以后,李娜那张账单就变成了 refunded,再跑一次第 3 张,资格检查会判「已退款,不能再退」,结果完全不同。每次从同一个起点跑,结果才能比较。

我实际跑的是全部 10 张,审批时依次输入了 y(第 3 张)、n(第 5 张)、n(第 6 张)。第 3 张的真实输出:

```text
===== T000155 · lina@example.com · 想退款 =====

  [step] load_customer {'found': True}

  [step] classify {'category': 'refund'}

  [step] retrieve {'docs': ['KB-refund-003', 'KB-refund-001', 'KB-refund-001', 'KB-refund-003', 'KB-refund-001']}

  [tool] list_subscriptions({"customer_id": "C0002"})

  [tool] list_invoices({"customer_id": "C0002", "limit": 10})

  [tool] check_refund_eligibility({"invoice_id": "INV-202609-0002"})

  [tool] create_refund_request({"invoice_id": "INV-202609-0002", "reason": "年付首购第 7 天,客户表示专业版用不上,申请全额退款"})
您好，您的专业版年付属于首次购买，目前在第 7 天，处于 14 天无理由全额退款期内，符合全额退款条件 [KB-refund-001]。我们已为您提交退款申请（金额 950 元），审核通过后会原路退回。退款完成后订阅将立即取消，账户降为免费版 [KB-refund-003]。审核进度如需了解，可随时联系我们。
  [step] check {'passed': True, 'problems': []}

  [pause] 退款审批:RF-T000155-INV-202609-0002 ¥950.00 规则=annual_first_14_days

  通过这笔退款吗?[y/N] 
----- 最终回复(resolved,¥0.0249)-----
您好，您的专业版年付属于首次购买，目前在第 7 天，处于 14 天无理由全额退款期内，符合全额退款条件 [1]。我们已为您提交退款申请（金额 950 元），审核通过后会原路退回。退款完成后订阅将立即取消，账户降为免费版 [2]。审核进度如需了解，可随时联系我们。

参考文章:
[1] 退款政策总览 https://help.cloudledger.example/help/refund/001
[2] 年付超过 14 天怎么退 https://help.cloudledger.example/help/refund/003

补充:您的退款申请已审核通过,950.00 元将原路退回,到账时间以支付渠道为准。
```

工单号是 T000155 而不是 T000153,因为全部跑时它排第 3。这张单子每一步都和单测里假剧本的走法一样:查订阅、查账单、查资格、建申请、起草、质检通过、停下等审批、y 之后定稿。区别是这次每个决定都是真模型做的,而且模型自己多查了一次 `list_subscriptions`。回复里的标点是全角的,那是模型自己的输出习惯,我们的提示词没规定。

10 张的结局和花费(真实数字):

| # | 工单 | 结局 | 花费(元) | 说明 |
| --- | --- | --- | --- | --- |
| 1 | 怎么开专票 | resolved | 0.0047 | 不查账,直接检索起草 |
| 2 | E2001 导入失败 | resolved | 0.0057 | 引用了 KB-error-003 |
| 3 | 李娜想退款(y) | resolved | 0.0249 | 950 元,审批通过 |
| 4 | 李娜「先问问」 | escalated | 0.0205 | 没建申请,两版草稿都被正则拦下 |
| 5 | 王芳按比例退(n) | resolved | 0.0256 | 498.75 元,审批驳回 |
| 6 | 重复扣款(n) | resolved | 0.0360 | 39 元,第一版被模型质检打回,第二版通过 |
| 7 | 月费退款 | resolved | 0.0199 | 解释月付不退,建议关自动续费 |
| 8 | 账套变只读 | resolved | 0.0209 | 查到 9 月账单扣款失败 |
| 9 | 找不到客户 | resolved | 0.0097 | 第一版被打回,第二版请客户给注册邮箱 |
| 10 | 投诉 12315 | escalated | 0.0017 | 分诊后直接转人工 |

10 张合计 0.1696 元。最贵的是第 6 张,act 五次工具调用加两版草稿;最便宜的是投诉单,只调了一次分诊。

## 第六步:不完美的地方,记进问题清单

今天的目标是「整条流程通了」,不是「每张都完美」。但看到的问题要记下来,Day 476 会把它们变成评测用例,Day 480 开始系统地修。我从这次输出里挑了四条:

**第 4 张:描述状态被当成了违规承诺。** 第 3 张批准以后,李娜那张账单已经是 refunded。第 4 张她问「能退多少」,草稿如实写了「目前账单状态为已退款」,质检的 `PROMISE_RE` 命中了里面的「已退款」三个字,真实输出是:

```text
  [step] check {'passed': False, 'problems': ['草稿承诺了退款已完成/马上到账,退款必须经过人工审核']}
```

两版草稿都这么写,于是转了人工,花了 0.0205 元却没给客户一个答案。正则测试里的 5 组样例全是「承诺」句式,没有「描述状态」的句式,所以单测没抓到。这是规则的问题。

**第 1 张:找到了客户却让客户提供注册邮箱。** 专票这张客户是张伟,load_customer 找到了他,但分诊判 needs_account_data=false,没进 act,调查结论是「(没有查询客户数据)」,模型就在末尾加了一句「请提供您的注册邮箱」。这是提示词的问题,DRAFT 提示词里「没查到客户账户」和「这单不需要查」没区分开。

**第 6 张:驳回以后回复前后矛盾。** 草稿写「审核通过后会原路退回」,审批驳回后 finalize 又在末尾追加「很抱歉,您的退款申请经审核未通过」。两句话都对,但放在一封信里,客户要读两遍才明白。可以考虑驳回时重新起草,而不是只加补充。这是流程设计的问题。

**第 9 张:质检看不到 draft 拿到的提示。** 第一版草稿写「我们未查询到该邮箱对应的客户账户」,质检判「调查结论为『无』,没有任何依据支持这一说法」。原因是 draft 节点额外加了一块「【注意】没有找到这个邮箱对应的客户账户」,但 check 节点拼给质检模型的材料里没有这一块。两个节点看到的材料不一致。

这四条只有第 2 条和模型的「能力」有关,其余三条都是我们自己代码和提示词的问题,修起来比换模型便宜得多。这也是为什么端到端一定要人亲眼看:单测只能证明「按设计走了」,看不出「设计本身有毛病」。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1fykHY6EAF&autoplay=0&high_quality=1" title="LangGraph Interrupt:Human-In-The-Loop 人机交互手到擒来!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>沧海九粟 · LangGraph Interrupt:Human-In-The-Loop 人机交互手到擒来! · 22 分钟,把 interrupt 停下、Command 恢复、节点重跑的规则在玩具图上演示一遍,对照今天第三步的审批测试看。</figcaption>
</figure>

## 零件和大代码的对照

| 零件 | 在哪个文件 | 守住的底线 |
| --- | --- | --- |
| `FakeLLM` 按系统提示认调用方 | `tests/fakes.py` | 不联网、结果确定 |
| `FakeTools` 兼当记录员 | `tests/fakes.py` | 能断言「调了什么工具」「批了什么」 |
| `make_deps` + `cast` | `tests/fakes.py` | 不改产品代码,只换 Deps |
| `test_policy_question_skips_tools` | `tests/test_graph_smoke.py` | 不需要查账就不进 act |
| `test_refund_goes_through_approval_then_resumes` | 同上 | 人没点头前钱不动;恢复后才执行 |
| `test_handoff_withdraws_pending_refund` | 同上 | 转人工时不留悬空的 pending 申请 |
| `test_angry_customer_goes_to_human` | 同上 | 投诉直接转人工 |
| `test_failed_review_twice_escalates` | 同上 | 最多重写一次 |
| `test_promise_rule_blocks_draft_without_llm` + `test_promise_regex` | 同上 | 违规承诺被拦,且不花模型质检的钱 |
| `run_tickets.py` | `scripts/` | 人眼看效果,记问题清单 |

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/EIV_ixKGPmc" title="How to Write Great Unit Tests in Python" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>ArjanCodes · How to Write Great Unit Tests in Python · 讲怎么把依赖抽出来再用假对象替换,和今天的 make_deps 是一个思路;英文,开字幕看前半段就够。</figcaption>
</figure>

## 动手练习

**练习 1:再补两条路。** 在 `tests/test_graph_more.py` 里写两个测试:① 发件邮箱查不到客户,分诊说要查账,验证不进 act、工具只调了 get_customer、最后 resolved;② 退款审批被驳回(note 写「已超过 14 天」),验证 decided 里是 False,回复里有「未通过,原因:已超过 14 天」。

<details><summary>参考答案</summary>

```python
# supportpilot/tests/test_graph_more.py
"""练习:再补两条路径。没找到客户、审批被驳回。"""

from fakes import FakeLLM, FakeTools, make_deps
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command
from test_graph_smoke import ACT, DRAFT, LINA, REFUND_TRIAGE, TICKET

from supportpilot.agent.graph import build_graph


def test_unknown_customer_skips_act():
    tools = FakeTools(customer=None)                         # get_customer 查不到
    out = build_graph(make_deps(FakeLLM(REFUND_TRIAGE, ACT, DRAFT), tools)).invoke(
        {"ticket": {**TICKET, "customer_email": "nobody@example.com"}})
    assert out["customer"] is None
    assert tools.calls == ["get_customer"]                   # 要查账,但没客户,不进 act
    assert out["outcome"] == "resolved"


def test_rejected_refund_says_so():
    tools = FakeTools(customer=LINA)
    graph = build_graph(make_deps(FakeLLM(REFUND_TRIAGE, ACT, DRAFT), tools), checkpointer=InMemorySaver())
    cfg: RunnableConfig = {"configurable": {"thread_id": TICKET["id"]}}
    graph.invoke({"ticket": TICKET}, cfg)
    out = graph.invoke(Command(resume={"approved": False, "approver": "finance-amy", "note": "已超过 14 天"}), cfg)
    assert tools.decided == [("RF-T000900-INV-202609-0001", False)]
    assert "未通过,原因:已超过 14 天" in out["reply"]
    print(out["reply"].splitlines()[-1])
```

<div class="line-notes">

- `from test_graph_smoke import ACT, DRAFT, LINA, REFUND_TRIAGE, TICKET` 测试文件之间也能互相导入常量,conftest 已经把 tests/ 放进搜索路径。
- `tools = FakeTools(customer=None)` 不给客户,get_customer 返回(「没有找到客户」, True)。
- `{"ticket": {**TICKET, "customer_email": "nobody@example.com"}})` 改一下邮箱,和端到端第 9 张一样的情况。
- `assert out["customer"] is None` 判断 None 用 `is`,不用 `==`。
- `assert tools.calls == ["get_customer"]` 剧本里明明写了三轮工具,但 act 根本没被调用,剧本一轮都没用上。
- `out = graph.invoke(Command(resume={"approved": False` 这次驳回。
- `assert "未通过,原因:已超过 14 天" in out["reply"]` approval 节点把 note 拼进了补充说明。
- `print(out["reply"].splitlines()[-1])` 打印最后一行看看,要配合 `-s` 参数 pytest 才不吞掉 print。

</div>

```bash
uv run pytest tests/test_graph_more.py -q -s
```

```text
.补充:很抱歉,您的退款申请经审核未通过,原因:已超过 14 天。如有疑问可以直接回复这个工单。
.
2 passed in 3.71s
```

再跑一次整个项目的测试,确认没把别的弄坏:`uv run pytest -q`,实测 `34 passed in 10.09s`(包含 Day 441–460 写的那些)。

</details>

**练习 2:同一张工单跑两次,看措辞。** 只跑第 2 张(E2001),和上面全部跑时的第 2 张对比回复,说说哪些一样、哪些不一样,这对写测试意味着什么。

<details><summary>参考答案</summary>

```bash
uv run python scripts/run_tickets.py 2
```

我单独跑的这次花了 0.0056 元,回复开头是「您好，E2001 表示导入文件格式不支持，系统只支持 .xlsx 和 .csv」;全部跑时那次花了 0.0057 元,开头是「您好,关于导入凭证提示 E2001 的问题,该报错表示"导入文件格式不支持"」。

一样的:分诊都是 technical,检索到的五个块完全相同(四个 KB-error-003 加一个 KB-technical-001),引用的文章一样,关键事实(.xlsx/.csv、10MB、三档行数上限)一样,质检都一次通过。不一样的:措辞、标点(一次全角一次半角)、句子顺序。

这意味着断言只能写在结构化的东西上:路由走向、工具调用、引用编号、outcome。「回复里有没有说清 .xlsx」这种事要用 Day 477 的规则检查或 Day 478 的 LLM 评审,而且要多跑几次看比例。

</details>

**练习 3:给 PROMISE_RE 补一个反例用例。** 问题清单第一条说正则会把「账单状态为已退款」当成承诺。先给 `test_promise_regex` 加一组 `("目前账单状态为已退款", False)`,跑一下看它挂不挂。先别改正则。

<details><summary>参考答案</summary>

在 parametrize 列表里加一行:

```python
    ("目前账单状态为已退款", False),
```

跑 `uv run pytest tests/test_graph_smoke.py -k promise_regex -q`,实测:

```text
FAILED tests/test_graph_smoke.py::test_promise_regex[\u76ee\u524d\u8d26\u5355\u72b6\u6001\u4e3a\u5df2\u9000\u6b3e-False]
1 failed, 5 passed, 6 deselected in 5.13s
```

新加的这一组失败了(正则里的 `已(经)?(为您|给您)?(办理|完成)?退款(?!申请)` 能匹配到「已退款」),其余 5 组照样通过。

这就是「先写一个会失败的测试,再去修」。今天先把失败用例留着,或者把那一行改成 `pytest.param("目前账单状态为已退款", False, marks=pytest.mark.xfail(reason="Day 480 修")),` 标成「已知会失败」,免得 make test 变红。改完实测输出 `5 passed, 6 deselected, 1 xfailed in 6.01s`。修正则的时候要同时保证原来 5 组还过,这正是 Day 481 讲的「一次改一处」。

</details>

**练习 4(开放题):算一笔账。** 照今天的单价,如果每天有 300 张工单,分布和这 10 张一样,一个月(30 天)模型花费大概多少?哪张类型的工单最值得优化?

<details><summary>参考答案</summary>

10 张合计 0.1696 元,平均每张约 0.017 元。300 张 × 30 天 = 9000 张,9000 × 0.017 ≈ 153 元/月。

最值得优化的是退款类(第 3–6 张,每张 0.020–0.036 元),它们占了 10 张里 4 张、花费里 0.107 元,约 63%。贵在 act 多轮调用,每一轮都带着越来越长的工具结果。第 4 张尤其冤:花了 0.0205 元最后还转了人工,修好正则误判就能把这笔钱变成一个答案。这个估算只是数量级,Day 485 会建真正的成本账本,Day 486 再看前缀缓存(缓存命中单价只有 0.04 元/百万 token)能省多少。

</details>

验收标准:`uv run pytest tests/test_graph_smoke.py` 11 个全过、2 秒内;你亲手复现过「不复制剧本」和「不给 checkpointer」两个错误;10 张工单端到端跑完一遍,总花费在 0.3 元以内;你写出了至少 3 条问题清单,每条说清是规则、提示词、流程还是模型的问题。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 假对象(fake) | 冒充真依赖的简化实现,有真实逻辑但很简单。例:`FakeLLM` 按剧本返回分诊结果。 |
| 剧本(script) | 预先写好的、假对象按顺序吐出的返回值。例:`ACT` 三轮工具调用。 |
| 鸭子类型 | 只看对象有没有需要的方法,不看它是哪个类。FakeLLM 没继承 LLMClient,但方法齐了就能用。 |
| cast | `typing.cast(类型, 值)`,运行时原样返回,只告诉类型检查器「把它当这个类型」。 |
| `__call__` | 定义了它的对象可以像函数一样被调用,`tools("get_customer", ...)`。 |
| 冒烟测试(smoke test) | 跑一遍主要路径,确认「没冒烟」、基本能用。`test_graph_smoke.py` 名字就是这么来的。 |
| 端到端(end-to-end) | 从输入到输出全链路用真依赖跑,这里是真模型 + 真 Postgres + 真知识库。 |
| JSONL | 一行一个 JSON 对象的文本格式,适合逐行读写的数据集。 |
| 共享可变状态 | 多个地方引用同一个可变对象(列表、字典),一处改了别处跟着变。测试「单独过、一起挂」的常见原因。 |
| 问题清单 | 端到端时人眼看到的问题列表,写清现象、原因归类,后面变成评测用例。 |
| xfail | pytest 的「预期会失败」标记,已知 bug 的用例先标上,不让整套测试变红。 |

## 常见误区

**用真模型写单测。** 真模型的单测每次都要钱、要等,而且同一个测试今天过明天不过。今天练习 2 里同一张工单两次措辞都不一样。流程用假零件测,效果用评测测。

**假对象写得太聪明。** 假 LLM 如果真的去「理解」消息内容、按关键词决定返回什么,它自己就成了需要测试的代码。剧本式的假对象最好:测试里写死它返回什么,一眼看得懂。

**测试之间共享可变常量。** 第四步演示过:剧本不复制,上一个测试 `pop` 掉了,下一个测试拿到空剧本,报 `assert [] == [('RF-T000900...0001', False)]`。症状是「单独跑过、一起跑挂」。可变的东西进假对象时先复制。

**以为停在 interrupt 就说明 checkpointer 配好了。** 不传 checkpointer,第一次 invoke 照样返回 `__interrupt__`,恢复时才报 `RuntimeError: Cannot use Command(resume=...) without checkpointer`。停下和恢复要在同一个测试里一起验。

**端到端前不重新造数。** 端到端会真的执行退款、改账单状态。不重新 `seed_db.py`,第二次跑第 3 张时资格检查会判「已退款」,结果和第一次完全不同,你会以为代码坏了。

**看到不完美就马上改提示词。** 今天的目标是流程通了。边看边改,改完下一张又坏,你分不清是哪次改动起的作用。先记进问题清单,等 Day 476 有了评测集再一次改一处。

**断言写在模型的原话上。** `assert "已为您提交退款申请" in reply` 这种断言今天过、明天模型换个说法就挂。断言写在 outcome、工具调用顺序、引用编号这些结构化的东西上。

## 学习资料

### 文档与文章

- [LangGraph 测试指南](https://docs.langchain.com/oss/python/langgraph/test):官方讲怎么测图、怎么单独测某个节点、怎么配 checkpointer 测中断,和今天的做法互相印证,20 分钟。
- [LangGraph Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts):interrupt 和 `Command(resume)` 的官方文档,重点看「节点恢复时从头重跑」那段规则,15 分钟。
- [pytest 参数化](https://docs.pytest.org/en/stable/how-to/parametrize.html):`parametrize` 和 `pytest.param(..., marks=xfail)` 的写法,做练习 3 时查。
- [Martin Fowler · Mocks Aren't Stubs](https://martinfowler.com/articles/mocksArentStubs.html):经典文章,把 dummy、fake、stub、spy、mock 五种「替身」分清楚。我们的 FakeTools 既是 fake 又兼当 spy(记录调用)。英文长文,看前三分之一就够。
- [Martin Fowler · Test Pyramid](https://martinfowler.com/bliki/TestPyramid.html):为什么快的单测要多、慢的端到端要少,短文 10 分钟。

### B 站视频

- 沧海九粟《LangGraph Interrupt:Human-In-The-Loop 人机交互手到擒来!》:上面嵌入的那个,复习 interrupt 和恢复。
- GPT中英字幕课程资源《LangChain Academy · LangGraph 基础 | Introduction to LangGraph》:官方课程的中英字幕搬运,39 集,看讲 Breakpoints 和 Human-in-the-loop 的那几集(标题里带 breakpoints / human 的)。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ZMtq6zEw3&autoplay=0&high_quality=1" title="LangChain Academy《LangGraph 基础 | Introduction to LangGraph - Python》中英字幕" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>GPT中英字幕课程资源 · LangChain Academy《LangGraph 基础》中英字幕 · 39 集的官方课程,今天只挑 Human-in-the-loop 模块那几集看,对照审批测试里停下、检查状态、恢复的三步。</figcaption>
</figure>

### 其他经典视频

- ArjanCodes《How to Write Great Unit Tests in Python》:上面嵌入的那个。
- LangChain《LangGraph interrupt: Making it easier to build human-in-the-loop agents》:官方讲 interrupt 的设计取舍,为什么恢复时节点要从头重跑。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/6t7YJcEFUIY" title="LangGraph interrupt: Making it easier to build human-in-the-loop agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · LangGraph interrupt: Making it easier to build human-in-the-loop agents · 官方讲 interrupt 和 Command(resume) 的设计,看完能理解为什么 approval 节点里 interrupt 之前不能写库。</figcaption>
</figure>

### 书籍

- Brian Okken《Python Testing with pytest》第 2 版(Pragmatic Bookshelf, 2022):读第 4 章(Builtin Fixtures)和第 10 章(Mocking),看 pytest 里替身对象的几种写法,和我们手写 FakeTools 的方式对比。
- Vladimir Khorikov《Unit Testing: Principles, Practices, and Patterns》(Manning, 2020):第 5 章讲 mock 和测试脆弱性的关系,解释了为什么「断言模型原话」这类测试会很脆。

### 开源项目与代码

- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):在仓库里搜 `InMemorySaver`,看 `libs/checkpoint` 下内存版存档的实现,不到两百行,能看清楚「存档」到底存了什么。
- [datawhalechina/hello-agents](https://github.com/datawhalechina/hello-agents):中文 Agent 教程,里面评测和测试相关的章节可以对照「流程测试和能力评测分开」这个思路。

## 自测

1. 为什么单测要用假 LLM,而不是调真模型再把 temperature 设成 0?

<details><summary>答案</summary>

temperature=0 也不能保证每次输出一样(Day 462 的预置 agent、今天练习 2 的第 2 张工单都实测到措辞变化),而且每次跑测试都要花钱、等十几秒。单测要验证的是「我们的代码按设计走了」,和模型能力无关,用剧本式的假 LLM 结果确定、免费、1.5 秒跑完。模型能力交给评测。

</details>

2. FakeLLM 的 `structured()` 是怎么知道自己被分诊调用还是被质检调用的?这样做有什么风险?

<details><summary>答案</summary>

看 `messages[0]["content"]` 是不是等于 `prompts.CLASSIFY`。风险是:哪天 classify 节点改了消息顺序(比如把系统提示放到第二条)或者在提示词后面拼了别的内容,假 LLM 就认不出来了,会把分诊当成质检返回 `Review`,测试以奇怪的校验错误失败。好在这种失败会很响亮,改一下判断条件就行。

</details>

3. 退款审批测试里,`assert tools.decided == []` 那一行验证的是什么?为什么它是整个测试最重要的一行?

<details><summary>答案</summary>

验证的是:图停在审批节点时,执行退款的函数一次都没被调用,钱一分没动。SupportPilot 最不能出的错就是「模型自己把钱退了」,这一行把「退款必须经过人」这条产品底线变成了每次提交都会自动检查的断言。

</details>

4. 面试题:你的 Agent 怎么测?测试花不花钱?

<details><summary>答案</summary>

示范回答:分两层。流程层用假 LLM、假检索、假工具注入到同一张图里,覆盖每条分支,包括退款停在审批、人没点前钱不动、恢复后才执行、转人工时作废悬空申请、质检两次不过转人工、违规承诺被规则拦下且不花模型质检的钱。11 个测试 1.5 秒,一分钱不花,每次提交都跑。能力层用评测集,真模型跑一批场景,用规则检查加 LLM 评审打分,看分数变化,这层要花钱,在改提示词或换模型时跑。另外上线前会人工端到端看一批工单,10 张大概 0.17 元,把看到的问题记成清单,再变成评测用例。

</details>

5. 端到端跑第 4 张工单(「先问问」)为什么最后转了人工?这算模型的问题吗?

<details><summary>答案</summary>

不算。模型没有建退款申请(做对了),草稿如实写了「账单状态为已退款」(也对),但质检的 `PROMISE_RE` 正则命中了「已退款」三个字,把描述状态误判成违规承诺,两版都被拦,revisions 到 2 转了人工。这是规则写得太宽的问题,单测里正则的样例只有「承诺」句式,没覆盖「描述状态」句式,所以没抓到。

</details>

## 明天预告

明天是 Day 464,记忆(一):工单内的对话状态。今天的图是「一问一答」:客户发一张工单,处理完就结束。真实客服不是这样,客户看完回复会追问「重新授权了还是不行」,隔天还会回来问「刚才说到哪了」。明天给状态加一个 `turns` 对话记录,每轮开头把上一轮的临时字段清干净,再把 checkpoint 从内存换成 Postgres,让进程重启以后工单还能接着聊。
