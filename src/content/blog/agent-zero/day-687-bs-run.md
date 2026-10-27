---
title: 'Day 687 · BillSleuth(七):不花钱的流程测试和真模型跑'
description: '先写一个按剧本念台词的假模型,把调查图的正常交卷、并行调用、越权被拦、催交、格式不合格转人工、轮数到顶这几条路径一分钱不花地测一遍,再故意删掉一行判断看哪条测试会红。然后写 run.py,用真模型把 16 个场景从头跑到尾,记下每个场景的查账路径、轮数和花费,和 Day 684 的大循环对照。'
pubDate: 2026-10-27
regime: none
tags: ['billsleuth', 'testing', 'langgraph', 'agent-design', 'agent-zero']
series: 'agent-zero'
day: 687
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 686](/blog/agent-zero/day-686-bs-evidence/) 做了两件事:`evidence.py` 把每次工具结果里的金额、日期、税率由代码抽出来编成 E1、E2……;`graph.py` 把 Day 684 定的四段拼成一张图,编译、画图,再用 `interrupt_before` 让真模型只跑了 intake 和 locate。当天当场发现按金额找发票会一次找出四五张,改成金额加月份,100 个场景里 90 个收窄到一张。

但有一半的图一次都没走过:`investigate` 和 `tools` 之间的循环、催交、转人工、轮数到顶。今天先把这些路径用假模型测一遍,再用真模型把整张图从头跑到尾。

## 今天要解决的问题

1. 写一个按剧本念台词的假模型 `ScriptedLLM`,并用它给调查图写 7 条不花钱的测试,覆盖交卷、并行调用、越权被拦、催交、格式不合格转人工、轮数到顶、系统提示每轮重拼。
2. 故意删掉图里一行判断,说清楚是哪条测试变红、为什么;故意把剧本写短一句,看真实报错。
3. 写出 `billsleuth/run.py`,用真模型跑 16 个场景,看每个场景的工具调用顺序、轮数、token 和花费,并和 Day 684 的大循环对一遍账。
4. 能说出「16 个全对」为什么还不能说明 Agent 好用。

预计用时 3 小时。前置:[Day 686](/blog/agent-zero/day-686-bs-evidence/)(`graph.py`、`evidence.py`)、[Day 685](/blog/agent-zero/day-685-week98-review/) 练习 2(`tests/conftest.py`,没做的话先去做,今天的测试要用 `fresh_db`)、[Day 684](/blog/agent-zero/day-684-bs-flow/)(`llm.py`、`mcp_bridge.py`、大循环的数字)、[Day 683](/blog/agent-zero/day-683-bs-tools/)(审计日志)、[Day 73](/blog/agent-zero/day-073-pytest-3/)(conftest 和 fixture)。真模型部分今天一共约 ¥0.67,算式在「今天的文件」一节。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `ScriptedLLM` 的三个方法和 `run_one` 的骨架默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 概念一:不花钱的流程测试

### 为什么不能只靠真模型测

Day 686 末尾我说图的路由、催交、转人工要等今天。先想一个问题:这些路径用真模型能测到吗?

测不到,至少测不稳。真模型大多数时候都很听话:查几个工具,调 `SubmitFindings`,结束。你想看「模型连续两次不交卷会怎样」,得等它哪天恰好犯糊涂,而且一次测试要花几分钱、等十几秒。**出错的路径恰恰是真模型最少走的路径,而这些路径又恰恰是上线以后最容易出事的地方。**

办法是 Day 28 那一套:模型对象换成一个演员,台词是你提前写好的,它念到哪句图就走到哪条路。图本身(路由、防线、证据抽取、结论解析)全是确定的代码,给它同样的台词,每次走同样的路,而且一秒内跑完,一分钱不花。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="调查图里哪些零件是真的、哪个被换掉:intake、investigate 里的模型调用换成 ScriptedLLM,locate、tools、conclude、route、证据抽取和 MCP 桥接都是真代码">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
  <defs><marker id="a687" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="16" y="30" width="86" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)" stroke-dasharray="5 3"/>
    <text x="59" y="50" text-anchor="middle" fill="var(--mem)">intake</text>
    <text x="59" y="65" text-anchor="middle" fill="var(--mem)">假模型念</text>
    <line x1="102" y1="52" x2="128" y2="52" stroke="var(--ink-soft)" marker-end="url(#a687)"/>
    <rect x="130" y="30" width="86" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="173" y="50" text-anchor="middle" fill="var(--compute)">locate</text>
    <text x="173" y="65" text-anchor="middle" fill="var(--compute)">真代码</text>
    <line x1="216" y1="52" x2="242" y2="52" stroke="var(--ink-soft)" marker-end="url(#a687)"/>
    <rect x="244" y="30" width="110" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)" stroke-dasharray="5 3"/>
    <text x="299" y="50" text-anchor="middle" fill="var(--mem)">investigate</text>
    <text x="299" y="65" text-anchor="middle" fill="var(--mem)">假模型念</text>
    <line x1="354" y1="52" x2="380" y2="52" stroke="var(--ink-soft)" marker-end="url(#a687)"/>
    <rect x="382" y="30" width="110" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="437" y="50" text-anchor="middle" fill="var(--compute)">route</text>
    <text x="437" y="65" text-anchor="middle" fill="var(--compute)">真代码</text>
    <line x1="492" y1="52" x2="518" y2="52" stroke="var(--ink-soft)" marker-end="url(#a687)"/>
    <rect x="520" y="30" width="104" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="572" y="50" text-anchor="middle" fill="var(--compute)">tools / nudge</text>
    <text x="572" y="65" text-anchor="middle" fill="var(--compute)">conclude 真代码</text>
    <rect x="16" y="110" width="608" height="58" rx="4" fill="none" stroke="var(--ink-soft)"/>
    <text x="30" y="132" fill="var(--ink)">仍然是真的:check_call 两道防线、BillingMCP(内存连法)、server 里的 8 个工具、</text>
    <text x="30" y="150" fill="var(--ink)">evidence 抽取和编号、SubmitFindings 的 pydantic 校验、SQLite 里的 100 个场景</text>
    <text x="16" y="198" fill="var(--ink-soft)">虚线框是被换掉的两处,只有「模型说什么」是假的</text>
    <text x="16" y="218" fill="var(--ink-faint)">台词写什么,就逼图走哪条路;台词写错,图的反应是真的</text>
  </g>
</svg>
<figcaption>只换掉模型,其余全是真的。所以这类测试测的是「图在各种台词下的反应」,不是「模型聪不聪明」。</figcaption>
</figure>

### ScriptedLLM

图里对模型对象只用了三样东西,Day 686 画图时已经见过:`with_structured_output`(intake 用)、`bind_tools`(investigate 用)、`invoke`(调查每一轮用)。假模型只要有这三个方法就行,这就是鸭子类型。新建 `tests/test_graph.py`,先写假模型和几个小工具,再写测试:

```python
# billsleuth/tests/test_graph.py  不花钱测调查流程:用一个按剧本回话的假模型,走通路由、越权拦截、催交、转人工
import pytest
from langchain_core.messages import AIMessage, SystemMessage, ToolMessage

from billsleuth.graph import MAX_LLM_CALLS, Intake, build_graph
from billsleuth.mcp_bridge import BillingMCP


class ScriptedLLM:
    """只实现图里用到的三个方法:bind_tools、with_structured_output、invoke。回话按剧本一条条出。"""

    def __init__(self, intake: Intake, script: list[AIMessage]):
        self.intake, self.script, self.seen = intake, list(script), []

    def bind_tools(self, tools):
        return self

    def with_structured_output(self, schema, method=None):
        outer = self

        class _S:
            def invoke(self, _):
                return outer.intake
        return _S()

    def invoke(self, messages):
        self.seen.append(messages)
        return self.script.pop(0)


def call(name: str, args: dict, i: int) -> dict:
    return {"name": name, "args": args, "id": f"call_{i}", "type": "tool_call"}


def submit(i: int, **over) -> dict:
    args = {"root_cause": "cancel_not_respected", "invoice_ids": ["INV-0001-05"], "overcharge": "174.90",
            "expected_action": "credit_note", "reasoning": "该周期订阅已取消,不应开票"}
    return call("SubmitFindings", {**args, **over}, i)


INTAKE = Intake(complaint="取消后仍扣款", amount="174.90", month=9)


@pytest.fixture(autouse=True)
def _use_fresh_db(fresh_db):
    """本文件每条测试都用一份干净的库(fixture 定义在 conftest.py)。"""


def run(llm):
    g = build_graph(llm=llm, mcp=BillingMCP(in_process=True))
    return g.invoke({"customer_id": "C-0001", "question": "我们早就取消了,怎么 9 月还扣了 174.90 美元?"},
                    {"recursion_limit": 60})
```

<div class="line-notes">

- `from billsleuth.graph import MAX_LLM_CALLS, Intake, build_graph` 把 `MAX_LLM_CALLS` 也导进来,测试里不写死 12,改了上限测试不用跟着改。
- `class ScriptedLLM:` 演员。没有继承任何类,它不是 `ChatOpenAI`,只是长得像。
- `self.intake, self.script, self.seen = intake, list(script), []` 三样东西:intake 那一步要返回的结构化结果;investigate 每一轮要念的台词(`list(script)` 复制一份,测试里的原列表不会被 `pop` 弄坏);`seen` 记下图每一轮发给模型的完整消息,事后可以检查「模型到底看到了什么」。
- `def bind_tools(self, tools):` 图在建图时调用一次,返回「绑好工具的模型」。假模型什么都不用绑,返回自己。
- `def with_structured_output(self, schema, method=None):` intake 节点建图时调用。它要返回一个有 `invoke` 方法的东西,所以里面临时造了一个小类 `_S`。
- `outer = self` 小类里的 `self` 是 `_S` 自己,要拿外面这个假模型,得先把外面的 `self` 存成另一个名字。这是 Python 里常见的写法,JS 里箭头函数自动带着外层 `this`,Python 要手动存一下。
- `return outer.intake` 不管图问什么,intake 都返回预先写好的那份。
- `self.seen.append(messages)` 记一笔:这一轮发来了哪些消息。
- `return self.script.pop(0)` `pop(0)` 取出并删掉列表第一个元素,相当于 JS 的 `shift()`。念完一句少一句,台词用完再调用就会报错,下面会演示。
- `def call(name: str, args: dict, i: int) -> dict:` 造一个「模型发出的工具调用」。字段名和真模型返回的完全一样:`name`、`args`、`id`、`type`。`id` 里带序号,每个调用唯一。
- `def submit(i: int, **over) -> dict:` 造一个「交卷」的调用。默认值是 S001 的正确结论。`**over` 收下所有额外的关键字参数,测试想改哪个字段就传哪个,相当于 JS 的 `{...defaults, ...overrides}`。
- `return call("SubmitFindings", {**args, **over}, i)` `{**args, **over}` 先展开默认值,再展开覆盖值,后面的同名键赢。
- `INTAKE = Intake(complaint="取消后仍扣款", amount="174.90", month=9)` S001 的 intake。大多数测试用同一份。
- `def _use_fresh_db(fresh_db):` 和 Day 686 的 `test_evidence.py` 同一个写法:autouse 的空 fixture,只是为了让每条测试都拿到一份干净的库。
- `{"recursion_limit": 60})` LangGraph 默认一次调用最多走 25 步,会抛 `GraphRecursionError`。我们的上限是自己管的(`MAX_LLM_CALLS`),把框架的上限放宽到 60,让错误来自我们的逻辑而不是框架的默认值。

</div>

接着是 7 条测试。每一条的名字就是它守的规则:

```python
def test_happy_path_collects_evidence_and_findings():
    llm = ScriptedLLM(INTAKE, [
        AIMessage("", tool_calls=[call("recompute_invoice", {"invoice_id": "INV-0001-05"}, 1)]),
        AIMessage("", tool_calls=[submit(2)]),
    ])
    out = run(llm)
    assert out["escalated"] is False
    assert out["findings"]["root_cause"] == "cancel_not_respected"
    assert out["candidates"] == ["INV-0001-05"]
    assert any(e["claim"].endswith("多收(实际 - 应收)") and e["value"] == "174.90" for e in out["evidence"])
    assert [e["id"] for e in out["evidence"]] == [f"E{i}" for i in range(1, len(out["evidence"]) + 1)]
    assert out["llm_calls"] == 3  # intake 1 次 + investigate 2 次


def test_parallel_calls_each_get_a_tool_message():
    llm = ScriptedLLM(INTAKE, [
        AIMessage("", tool_calls=[call("get_customer", {"customer_id": "C-0001"}, 1),
                                  call("list_payments", {"customer_id": "C-0001"}, 2)]),
        AIMessage("", tool_calls=[submit(3)]),
    ])
    out = run(llm)
    tool_msgs = [m for m in out["messages"] if isinstance(m, ToolMessage)]
    assert [m.tool_call_id for m in tool_msgs] == ["call_1", "call_2"]
    assert out["escalated"] is False


def test_other_customer_and_unknown_invoice_are_blocked():
    llm = ScriptedLLM(Intake(complaint="其他"), [
        AIMessage("", tool_calls=[call("list_payments", {"customer_id": "C-0002"}, 1),
                                  call("get_invoice", {"invoice_id": "INV-0002-01"}, 2),
                                  call("draft_credit_note", {"invoice_id": "INV-0001-05", "amount": "1.00",
                                                             "reason": "不该在调查阶段调用"}, 3)]),
        AIMessage("我查不了,先这样。"),
        AIMessage("还是查不了。"),
    ])
    out = run(llm)
    tool_msgs = [m for m in out["messages"] if isinstance(m, ToolMessage)]
    assert "只能查询客户 C-0001" in tool_msgs[0].content
    assert "不在这个客户的发票列表里" in tool_msgs[1].content
    assert "不能调用 draft_credit_note" in tool_msgs[2].content
    assert out["escalated"] is True  # 没交卷,催了一次也没用,转人工
    assert out["nudged"] is True


def test_nudge_then_submit_is_not_escalated():
    llm = ScriptedLLM(INTAKE, [
        AIMessage("我觉得是取消没生效。"),                    # 没调工具也没交卷
        AIMessage("", tool_calls=[submit(1)]),               # 被催了一次,这回交了
    ])
    out = run(llm)
    assert out["nudged"] is True and out["escalated"] is False
    assert "请用 SubmitFindings 提交结论" in llm.seen[1][-1].content


def test_bad_findings_are_escalated_not_guessed():
    llm = ScriptedLLM(INTAKE, [AIMessage("", tool_calls=[submit(1, overcharge="174.9")])])
    out = run(llm)
    assert out["escalated"] is True and "error" in out["findings"]


def test_round_limit_forces_conclude():
    spin = [AIMessage("", tool_calls=[call("get_customer", {"customer_id": "C-0001"}, i)])
            for i in range(MAX_LLM_CALLS)]
    out = run(ScriptedLLM(INTAKE, spin))
    assert out["llm_calls"] == MAX_LLM_CALLS  # intake 1 次 + investigate 11 次,到顶就停
    assert out["escalated"] is True and out["findings"] == {}


def test_system_prompt_is_rebuilt_each_round_and_tokens_add_up():
    def usage(i, o):
        return {"input_tokens": i, "output_tokens": o, "total_tokens": i + o}
    llm = ScriptedLLM(INTAKE, [
        AIMessage("", tool_calls=[call("get_customer", {"customer_id": "C-0001"}, 1)], usage_metadata=usage(100, 20)),
        AIMessage("", tool_calls=[submit(2)], usage_metadata=usage(300, 40)),
    ])
    out = run(llm)
    assert out["tokens"] == [400, 60]
    assert all(isinstance(m[0], SystemMessage) and "C-0001" in m[0].content for m in llm.seen)
    assert not any(isinstance(m, SystemMessage) for m in out["messages"])  # 系统提示不存进状态
```

<div class="line-notes">

- `def test_happy_path_collects_evidence_and_findings():` 正常路径:查一次复算,然后交卷。台词只有两句。
- `AIMessage("", tool_calls=[call("recompute_invoice", {"invoice_id": "INV-0001-05"}, 1)]),` 第一句台词:内容为空,带一个工具调用。真模型调工具时 `content` 通常也是空的。
- `assert out["candidates"] == ["INV-0001-05"]` locate 是真代码:INTAKE 里金额 174.90、月份 9,C-0001 的 5 张发票里只有 9 月那张对得上。这条间接测了 Day 686 的 `pick_candidates`。
- `assert any(e["claim"].endswith("多收(实际 - 应收)") and e["value"] == "174.90" for e in out["evidence"])` 复算的结果被抽成了证据:S001 取消后仍扣款,应收 0.00,实际 174.90,多收 174.90。
- `assert [e["id"] for e in out["evidence"]] == [f"E{i}" for i in range(1, len(out["evidence"]) + 1)]` 编号从 E1 连到最后一个,locate 的几条和 tools 的几条接得上,没有重号。
- `assert out["llm_calls"] == 3  # intake 1 次 + investigate 2 次` intake 记 1,investigate 每轮加 1,两句台词就是 3。
- `AIMessage("", tool_calls=[call("get_customer", {"customer_id": "C-0001"}, 1),` 一句台词里放两个调用,模拟模型的并行工具调用([Day 162](/blog/agent-zero/day-162-parallel-tools/))。
- `assert [m.tool_call_id for m in tool_msgs] == ["call_1", "call_2"]` 每个调用都要有一条 ToolMessage,id 一一对上,顺序也不乱。少一条,真模型的下一轮会收到 400。
- `llm = ScriptedLLM(Intake(complaint="其他"), [` 这条测试不关心 intake 抽到什么,金额和月份留空。
- `call("list_payments", {"customer_id": "C-0002"}, 1),` 越权:调查的是 C-0001,台词里去查 C-0002。
- `call("get_invoice", {"invoice_id": "INV-0002-01"}, 2),` 发票号格式没问题,但不在 C-0001 的发票列表里。
- `call("draft_credit_note", {"invoice_id": "INV-0001-05", "amount": "1.00",` 调查阶段想起草贷记单。这个工具在 MCP server 里是真有的,所以拦它的只能是图里的白名单。
- `AIMessage("我查不了,先这样。"),` 第二句:没有工具调用,也没交卷。`route` 看到这种情况去 `nudge`。
- `AIMessage("还是查不了。"),` 第三句:被催了还是不交。`route` 看到 `nudged` 已经是 True,直接去 `conclude`,没有结论,转人工。
- `assert "只能查询客户 C-0001" in tool_msgs[0].content` 三个调用三条 ToolMessage,理由各不相同,对应 `check_call` 的三个分支。
- `assert out["nudged"] is True` 确认走过了催交这一步。
- `AIMessage("我觉得是取消没生效。"),                    # 没调工具也没交卷` 台词第一句是纯文字。
- `assert "请用 SubmitFindings 提交结论" in llm.seen[1][-1].content` `seen[1]` 是第二轮 investigate 收到的消息列表,`[-1]` 是最后一条,应该就是 nudge 节点加的那句提醒。这里查的是「模型真的被提醒了」,而不只是「状态里有个 nudged 标记」。
- `submit(1, overcharge="174.9")` 少一位小数,`SubmitFindings` 的正则 `^\d+\.\d{2}$` 会拒绝,`conclude` 转人工,不去猜。
- `spin = [AIMessage("", tool_calls=[call("get_customer", {"customer_id": "C-0001"}, i)])` 一个停不下来的模型:每一轮都调 `get_customer`,从不交卷。
- `for i in range(MAX_LLM_CALLS)]` 给它 12 句台词,比实际能用到的多一句。
- `assert out["llm_calls"] == MAX_LLM_CALLS  # intake 1 次 + investigate 11 次,到顶就停` 图在计数到 12 时强制结束。`route` 在 `llm_calls >= 12` 时直接去 `conclude`,所以第 12 句台词不会被念到。
- `assert out["escalated"] is True and out["findings"] == {}` 到顶没交卷,转人工。
- `def usage(i, o):` 造一份用量。真模型的 `usage_metadata` 是个带三个键的字典。
- `usage_metadata=usage(100, 20)),` 第一轮用了 100 输入 20 输出。
- `assert out["tokens"] == [400, 60]` `[100, 20]` 加 `[300, 40]`,`add_tokens` 这个 reducer 起作用了。
- `assert all(isinstance(m[0], SystemMessage) and "C-0001" in m[0].content for m in llm.seen)` 每一轮发给模型的消息,第一条都是系统提示,里面带着客户号。
- `assert not any(isinstance(m, SystemMessage) for m in out["messages"])` 系统提示每轮现拼,不存进状态。

</div>

```bash
uv run pytest tests/test_graph.py -v
```

```text
tests/test_graph.py::test_happy_path_collects_evidence_and_findings PASSED [ 14%]
tests/test_graph.py::test_parallel_calls_each_get_a_tool_message PASSED  [ 28%]
tests/test_graph.py::test_other_customer_and_unknown_invoice_are_blocked PASSED [ 42%]
tests/test_graph.py::test_nudge_then_submit_is_not_escalated PASSED      [ 57%]
tests/test_graph.py::test_bad_findings_are_escalated_not_guessed PASSED  [ 71%]
tests/test_graph.py::test_round_limit_forces_conclude PASSED             [ 85%]
tests/test_graph.py::test_system_prompt_is_rebuilt_each_round_and_tokens_add_up PASSED [100%]

============================== 7 passed in 4.06s ==============================
```

7 条一次全绿,花了 4 秒(大部分是每条测试复制一份库和起内存里的 MCP)。真模型要花几分钱的路径,这里一分不花。

### 报错先演示一次:剧本太短

假模型有个脾气:台词念完了你还让它念,它会直接炸。写一个只有一句台词的剧本,而图其实需要两轮:

```python
# billsleuth/scratch/short_script.py  剧本比实际需要的短:假模型没台词可念了会怎样
from langchain_core.messages import AIMessage

from billsleuth.graph import Intake, build_graph
from billsleuth.mcp_bridge import BillingMCP
from tests.test_graph import ScriptedLLM, call

llm = ScriptedLLM(Intake(complaint="其他"), [AIMessage("", tool_calls=[call("get_customer", {"customer_id": "C-0001"}, 1)])])
build_graph(llm=llm, mcp=BillingMCP(in_process=True)).invoke({"customer_id": "C-0001", "question": "多扣了"})
```

<div class="line-notes">

- `from tests.test_graph import ScriptedLLM, call` 从测试文件里借假模型,在仓库根目录用 `-m` 跑,`tests` 才能被当成包找到(Day 680 讲过 `-m` 的规矩)。
- `llm = ScriptedLLM(Intake(complaint="其他"), [AIMessage("", tool_calls=[call("get_customer", {"customer_id": "C-0001"}, 1)])])` 只有一句台词:调一次 `get_customer`。调完工具图会回到 investigate 要第二句,剧本里没有了。
- `build_graph(llm=llm, mcp=BillingMCP(in_process=True)).invoke(` 没传 `recursion_limit`,用框架默认的。

</div>

```bash
uv run python -m scratch.short_script
```

```text
  File ".../tests/test_graph.py", line 28, in invoke
    return self.script.pop(0)
           ^^^^^^^^^^^^^^^^^^
IndexError: pop from empty list
During task with name 'investigate' and id '85d2d473-ebf7-ffcf-3cd4-055f55d7b6f3'
```

(前面的调用栈省略。)`IndexError: pop from empty list`,最后一行 LangGraph 补了一句「出错的是 investigate 节点」。这个报错不是 bug,是假模型在告诉你:图比你以为的多走了一轮。写测试时看到它,第一反应该是「我的剧本漏了一句,还是图多跑了一轮」,两种可能都值得想一想。

### 删一行判断,看谁会红

测试的价值在于改坏了会红。拿 `route` 里最容易被人「优化掉」的一行试试:

```python
    return "conclude" if state.get("nudged") else "nudge"
```

改成直接 `return "nudge"`,也就是不管催过几次都继续催。跑测试:

```bash
uv run pytest tests/test_graph.py -q
```

```text
FAILED tests/test_graph.py::test_other_customer_and_unknown_invoice_are_blocked
1 failed, 6 passed in 3.41s
```

只红了一条,而且红法值得看:失败原因是同一个 `IndexError: pop from empty list`。模型不交卷,图就一直催,台词很快念完。**换成真模型,这就是一个烧钱的死循环**,只会停在 LangGraph 的默认上限(25 步)上,或者我们设的 `recursion_limit=60` 上,每一步都是一次付费调用。测试用「台词不够」这种方式把它抓了出来。

另外 6 条没红也有道理:其他测试里模型要么交了卷,要么到顶,不依赖「催过一次就不再催」这一条。这个对照让人心里有数:一条规则只有一条测试守着,删掉那一行,红的就刚好是那一条。测试名要是写成 `test_nudge_only_once`,会比现在这个名字更直白。我留着现在的名字,是想让你体会到,守一条规则的测试可能藏在别的名字下面,改动之前先全部跑一遍比依赖记忆可靠。

改回去,再跑一次全部测试:

```bash
uv run pytest -q
```

```text
266 passed in 7.06s
```

Day 686 结束时是 259 条,今天加了 7 条,266。(我重建的项目和你的可能差一两条练习测试,以 0 failed 为准。)

## 概念二:用真模型跑

### run.py

假模型测的是「图在各种台词下的反应」,真模型要回答另一个问题:它到底怎么查账。写一个脚本,按场景号跑,把过程和结果打印出来,并和标准答案对一下。新建 `billsleuth/run.py`:

```python
# billsleuth/billsleuth/run.py  跑场景并和标准答案对比:uv run python -m billsleuth.run S011 [S017 ...]
import json
import os
import sys
import uuid

from langchain_core.messages import ToolMessage
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver

from billsleuth.db import ROOT
from billsleuth.graph import build_graph
from billsleuth.llm import estimate_cost
from billsleuth.mcp_bridge import BillingMCP


def run_one(sid: str, graph) -> dict:
    sc = json.loads((ROOT / "scenarios" / f"{sid}.json").read_text(encoding="utf-8"))
    os.environ["BILLSLEUTH_SESSION"] = f"{sid}-{uuid.uuid4().hex[:6]}"  # 审计日志按这个号分会话
    print(f"\n=== {sid} {sc['customer_id']}:{sc['question']}")
    cfg: RunnableConfig = {"recursion_limit": 60, "configurable": {"thread_id": os.environ["BILLSLEUTH_SESSION"]}}
    for update in graph.stream({"customer_id": sc["customer_id"], "question": sc["question"]}, cfg,
                               stream_mode="updates"):
        for node, delta in update.items():
            if node == "intake":
                print(f"  [intake] {delta['intake']}")
            elif node == "locate":
                print(f"  [locate] 候选 {delta['candidates']}")
            elif node == "investigate":
                for c in getattr(delta["messages"][-1], "tool_calls", []) or []:
                    print(f"  [investigate] → {c['name']}({json.dumps(c['args'], ensure_ascii=False)[:110]})")
            elif node == "tools":
                for m in delta["messages"]:
                    if isinstance(m, ToolMessage) and str(m.content).startswith("[工具报错]"):
                        print(f"  [tools] 被拒绝或报错:{str(m.content)[:80]}")
    s = graph.get_state(cfg).values
    f, t = s.get("findings") or {}, sc["truth"]
    tin, tout = s.get("tokens") or [0, 0]
    hit = f.get("root_cause") == t["root_cause"] and f.get("overcharge") == t["overcharge"]
    ids_ok = set(f.get("invoice_ids", [])) == set(t["invoice_ids"])
    print(f"  {s.get('llm_calls')} 次模型调用(含 intake),调查阶段输入 {tin} / 输出 {tout} token,约 ¥{estimate_cost(tin, tout):.4f}")
    print(f"  结论:{f.get('root_cause')} {f.get('invoice_ids')} 多收 {f.get('overcharge')}  "
          f"标准答案:{t['root_cause']} {t['invoice_ids']} 多收 {t['overcharge']}  "
          f"{'✓' if hit else '✗'}{'' if ids_ok else '(发票号不一致)'}{'  转人工' if s.get('escalated') else ''}")
    return {"id": sid, "hit": hit, "ids_ok": ids_ok, "escalated": bool(s.get("escalated")),
            "calls": s.get("llm_calls"), "tokens": [tin, tout], "evidence": len(s.get("evidence", []))}


if __name__ == "__main__":
    g = build_graph(mcp=BillingMCP(in_process=True), checkpointer=InMemorySaver())
    results = [run_one(sid, g) for sid in sys.argv[1:]]
    tin = sum(r["tokens"][0] for r in results)
    tout = sum(r["tokens"][1] for r in results)
    print(f"\n{sum(r['hit'] for r in results)}/{len(results)} 命中,发票号一致 {sum(r['ids_ok'] for r in results)}/{len(results)},"
          f"转人工 {sum(r['escalated'] for r in results)},共 ¥{estimate_cost(tin, tout):.4f}(不含 intake)")
```

<div class="line-notes">

- `from langgraph.checkpoint.memory import InMemorySaver` 跑完以后要用 `get_state` 读最终状态(含累计的 token),需要 checkpointer。
- `def run_one(sid: str, graph) -> dict:` 跑一个场景,返回一个汇总字典。图在外面建好、多个场景共用,省得每次重建。
- `sc = json.loads((ROOT / "scenarios" / f"{sid}.json").read_text(encoding="utf-8"))` 读 Day 682 `seed.py` 写出来的场景文件。`sid` 是 `"S011"` 这样的字符串。
- `os.environ["BILLSLEUTH_SESSION"] = f"{sid}-{uuid.uuid4().hex[:6]}"` 每次运行一个新的会话号,形如 `S011-9e7eb7`。Day 683 的审计日志从这个环境变量读会话号。内存桥接下 server 每次调用都现读环境变量,所以这里改了立刻生效;stdio 桥接是构造时复制环境变量的,要用它就得先设再建桥(Day 684 的坑)。`uuid4().hex[:6]` 取随机串的前六位,同一个场景重复跑也不会撞号。
- `cfg: RunnableConfig = {"recursion_limit": 60, "configurable": {"thread_id": os.environ["BILLSLEUTH_SESSION"]}}` 线程号也用会话号,每次运行一个独立线程,`get_state` 取的一定是这一次。
- `for update in graph.stream(` 参数里 `stream_mode="updates"`:`updates` 模式每执行完一个节点吐出一份「这个节点改了什么」。Day 322 前后讲 stream 时见过。
- `for node, delta in update.items():` 一份更新是 `{节点名: 改动}`,通常只有一个键。
- `print(f"  [intake] {delta['intake']}")` intake 节点只改 `intake` 和 `llm_calls`,打印前者。
- `print(f"  [locate] 候选 {delta['candidates']}")` locate 找出的候选发票。
- `for c in getattr(delta["messages"][-1], "tool_calls", []) or []:` investigate 发出的最后一条消息里的工具调用。`getattr(..., [])` 取不到就给空列表,`or []` 再兜一次 None。
- `json.dumps(c['args'], ensure_ascii=False)[:110]` 参数打成 JSON 并截到 110 个字符。`ensure_ascii=False` 让中文原样显示。
- `if isinstance(m, ToolMessage) and str(m.content).startswith("[工具报错]"):` tools 节点回的消息里,以 `[工具报错]` 开头的是被拒绝或工具报错的,单独打一行。正常路径上这行不出现,一出现就说明模型碰了防线。
- `s = graph.get_state(cfg).values` 跑完后取最终状态,里面有累计的 `tokens`、`llm_calls`、`evidence`。
- `tin, tout = s.get("tokens") or [0, 0]` 调查阶段累计的输入输出 token。注意 intake 那一次没有计进来(Day 686 的 `intake` 节点没记用量),它大约 440 输入 70 输出,约 ¥0.0014,下面的总数里要加回来。
- `hit = f.get("root_cause") == t["root_cause"] and f.get("overcharge") == t["overcharge"]` 命中的口径:根因和多收金额都对。金额是字符串,直接比。
- `ids_ok = set(f.get("invoice_ids", [])) == set(t["invoice_ids"])` 发票号单独比,不并进 `hit`。Day 684 说过 S023 的发票号有争议,先分开记,Day 693 再决定算不算对。用 `set` 比较是不看顺序。
- `{'✓' if hit else '✗'}{'' if ids_ok else '(发票号不一致)'}{'  转人工' if s.get('escalated') else ''}` 一行里三个条件表达式,拼出结论后面的标记。
- `return {"id": sid, "hit": hit, "ids_ok": ids_ok, "escalated": bool(s.get("escalated")),` 汇总字典,最后统计用。
- `g = build_graph(mcp=BillingMCP(in_process=True), checkpointer=InMemorySaver())` 不传 `llm`,走 `get_llm()` 读 `.env`。
- `results = [run_one(sid, g) for sid in sys.argv[1:]]` 命令行里写几个场景号就跑几个。

</div>

先跑 S011,就是 Day 684 的大循环也跑过的那个时区场景:

```bash
uv run python -m billsleuth.run S011
```

```text
=== S011 C-0011:8 月这张发票金额 1438.44,我们财务对不上账,麻烦查一下。
  [intake] {'complaint': '金额不对', 'amount': '1438.44', 'month': 8}
  [locate] 候选 ['INV-0011-03']
  [investigate] → get_customer({"customer_id": "C-0011"})
  [investigate] → get_invoice({"invoice_id": "INV-0011-03"})
  [investigate] → recompute_invoice({"invoice_id": "INV-0011-03"})
  [investigate] → get_subscription_timeline({"customer_id": "C-0011"})
  [investigate] → get_tax_rate({"region": "SG", "on": "2026-08-01"})
  [investigate] → SubmitFindings({"root_cause": "timezone_change_date", "invoice_ids": ["INV-0011-03"], "overcharge": "26.02", "expected_action)
  4 次模型调用(含 intake),调查阶段输入 9548 / 输出 776 token,约 ¥0.0253
  结论:timezone_change_date ['INV-0011-03'] 多收 26.02  标准答案:timezone_change_date ['INV-0011-03'] 多收 26.02  ✓

1/1 命中,发票号一致 1/1,转人工 0,共 ¥0.0253(不含 intake)
```

四次模型调用:intake 一次,investigate 三轮。第一轮并行发了两个调用,第二轮三个,第三轮就交卷了。路径和一个熟练的查账员差不多:先看客户和发票,马上复算,发现差在折算,去看订阅事件里的本地日期,顺手排除税率,交卷。注意没有 `list_invoices`:发票列表 locate 已经用代码取过了,模型不用再要一遍,这是拆段省下来的一个调用。

### 16 个场景

12 类故障各挑一个、4 种「账没错」各挑一个,共 16 个,一次跑完:

```bash
uv run python -m billsleuth.run S001 S002 S003 S004 S005 S006 S009 S011 S012 S017 S018 S019 S020 S021 S023 S031
```

结果整理成表(`run.py` 的原始输出每个场景十来行,这里只留汇总。每个场景的完整输出里,`intake` 和 `locate` 两行在 16 个里都是对的):

| 场景 | 标准答案 | 模型调用 | 输入 token | 输出 token | 花费(不含 intake) |
| --- | --- | --- | --- | --- | --- |
| S001 | cancel_not_respected | 4 | 8563 | 639 | ¥0.0222 |
| S002 | proration_missing_credit | 5 | 13599 | 813 | ¥0.0337 |
| S003 | no_error(年付续费) | 5 | 12805 | 855 | ¥0.0324 |
| S004 | no_error(升级折算) | 5 | 14122 | 762 | ¥0.0343 |
| S005 | coupon_not_applied | 5 | 13476 | 909 | ¥0.0342 |
| S006 | no_error(税行) | 4 | 8787 | 745 | ¥0.0235 |
| S009 | no_error(优惠期结束) | 6 | 17115 | 999 | ¥0.0422 |
| S011 | timezone_change_date | 5 | 13929 | 810 | ¥0.0343 |
| S012 | proration_wrong_days | 4 | 9517 | 1176 | ¥0.0284 |
| S017 | duplicate_charge | 4 | 9245 | 573 | ¥0.0231 |
| S018 | quantity_change_ignored | 5 | 13067 | 921 | ¥0.0335 |
| S019 | expired_tax_rate | 4 | 8790 | 681 | ¥0.0230 |
| S020 | coupon_wrong_base | 5 | 14407 | 820 | ¥0.0354 |
| S021 | wrong_plan_price | 5 | 13071 | 832 | ¥0.0328 |
| S023 | duplicate_invoice | 4 | 10064 | 622 | ¥0.0251 |
| S031 | wrong_tax_region | 5 | 12443 | 736 | ¥0.0308 |

最后一行汇总:

```text
16/16 命中,发票号一致 15/16,转人工 0,共 ¥0.4891(不含 intake)
```

16 个场景全部命中根因和多收金额,没有一个转人工,墙钟总共 1 分 56 秒,平均每个场景约 7 秒。发票号一致 15/16,不一致的是 S023,模型交的是 `['INV-0023-04', 'INV-0023-04D']`,标准答案只有重复开出来的 `INV-0023-04D`。

花费算式:调查阶段输入合计 193000、输出合计 12893,193000 × 2 + 12893 × 8 = 489,144,除以一百万是 ¥0.4891(按 `.env` 里 `LLM_PRICE` 的未命中价,是上限)。再加 16 次 intake,每次约 ¥0.0014,合计约 ¥0.022,今天这一跑约 ¥0.51。平均每个场景 4.7 次模型调用、输入约 12000、输出约 800 token,约 ¥0.03。

把 16 个场景里模型调用过的工具数一遍:

| 工具 | 次数 | 说明 |
| --- | --- | --- |
| `get_invoice` | 23 | 最常调,16 个场景里有 5 个看了不止一张发票(对比前后月份) |
| `recompute_invoice` | 17 | 16 个场景都调了,S023 调了两次(原件和重复件各一次) |
| `get_customer` | 16 | 每个场景都调,而且都排在第一位 |
| `SubmitFindings` | 16 | 交卷,每个场景一次 |
| `get_tax_rate` | 14 | 三个场景一次没调:S001、S017、S023(取消后仍扣款、重复扣款、重复开票),都和税无关 |
| `get_subscription_timeline` | 13 | |
| `list_payments` | 12 | |

两个观察。`get_customer` 每个场景第一步都调,一次不落,而且它的内容(税务地区、时区)是固定要看的,这和 Day 684 的第一条理由是同一件事:**确定的步骤还在被模型做**。locate 已经把发票列表挪给代码了,`get_customer` 是下一个候选,练习里可以试试。其次,`recompute_invoice` 在所有场景都被调用,这说明 Day 683 把它设计成「判断账算没算错的唯一依据」,模型确实把它当成了主线。

### 和 Day 684 的大循环对一对账

Day 684 的 `one_loop.py` 跑过 S011、S017、S023。同样三个场景,拆段之后的数字:

| 场景 | 大循环(Day 684)轮数 / 输入 / 输出 / 花费 | 拆段后模型调用 / 输入 / 输出 / 花费 |
| --- | --- | --- |
| S011 | 4 轮 / 10876 / 671 / ¥0.0271 | 4(含 intake)/ 9548 / 776 / ¥0.0253 |
| S017 | 3 轮 / 7483 / 589 / ¥0.0197 | 4(含 intake)/ 9245 / 573 / ¥0.0231 |
| S023 | 3 轮 / 7727 / 678 / ¥0.0209 | 4(含 intake)/ 10064 / 622 / ¥0.0251 |

(S011 取的是上面单独跑的那一次,另外两个取 16 场景那次。拆段版的花费不含 intake,加上约 ¥0.0014。)

说实话,**拆段没有更便宜**,S017 和 S023 反而贵了一点。原因两个:系统提示词变长了(把 13 个根因的说明都写进去,每一轮都要发),以及多了一轮交卷(大循环是在最后一轮直接写一段话,现在要多调一个 `SubmitFindings`)。S011 便宜了一点,是 locate 省掉了 `list_invoices` 的缘故,但这点差别在单次运行的噪声里,Day 684 也说过别拿一次的数下结论。

拆段买到的是另外几样,Day 684 的后三条理由今天都兑现了:结论是结构化的,`run.py` 可以直接逐字段和标准答案比,不用从一段话里抠;图的各个零件可以单独测,今天上午的 7 条测试和 Day 686 的 11 条零件测试都是这么来的;证据链一路攒着,Day 688 写解释时每个数字都有地方查。要的不是省钱,是**可测、可对账、可追溯**。

### 先别高兴

16/16 看着很漂亮,我的第一反应不是「Agent 真厉害」,而是题目太简单。三点理由。

第一,**复算工具直接把差额和差在哪一类给了**。Day 685 的体检脚本不用模型,二十行规则就在 100 个场景上把「哪张发票多收了多少」全找对了。Agent 剩下的活主要是分类和解释。这个数据集上「差额匹配」没有区分度,它的价值要看根因分类准不准、解释对不对、会不会不该冲正的时候冲正。

第二,**这 16 个是我挑的,每类一个,不是随机抽样**,样本也小。16 次全对,用 Wilson 区间算,95% 置信区间的下限大约是 81%,也就是说它真实的命中率放在 81% 到 100% 之间都说得通。这条下限的算法很简单:全对时下限等于 n / (n + 1.96²),这里是 16 / (16 + 3.84) = 0.806。想把下限推到 95% 以上,要全对约 73 次。

第三,**模型每次都没走到坏路径**。16 个场景没有一次被防线拦、没有一次催交、没有一次转人工。今天上午的假模型测试保证了这些路径的代码是对的,但它们在真实场景里发生的频率是多少,今天一个样本也没有,这是评测集(Day 693 起)要回答的。

还有一处留着没处理:S023 的 `invoice_ids`。重复开票时原件和重复件金额一样,模型把两张都写进了结论,标准答案只要重复的那张。练习 3 连跑 3 次,看它是不是稳定地这样。「两张都写」算对还是算错,是业务口径问题,Day 693 决定。

## 今天的文件

| 零件 | 文件 | 新建还是修改 | 后面哪天用到 |
| --- | --- | --- | --- |
| 假模型和流程测试 | `tests/test_graph.py` | 新建 | Day 689、690 每次改图都要跑 |
| 跑场景、对标准答案 | `billsleuth/run.py` | 新建 | Day 689 加解释输出,Day 693 评测的前身 |
| 草稿 | `scratch/short_script.py`、`ex1_fake_invoice.py`、`ex2_audit_replay.py`、`ex3_repeat.py`、`ex4_bad_args.py` | 新建 | |

今天花费:16 场景 ¥0.4891(不含 intake)加 intake 约 ¥0.022,练习 2 跑一个场景约 ¥0.025,练习 3 连跑 3 次 S023(调查部分 10078 + 15014 + 15006 输入、2253 输出)约 ¥0.1,合计约 ¥0.67(S011 单跑约 ¥0.027,算在里面)。

零件对应关系,`run.py` 的每一段用到了哪个零件:

| 零件 | 用在哪 |
| --- | --- |
| `build_graph` + `InMemorySaver` | 建图,保存每个场景的状态 |
| `graph.stream(..., stream_mode="updates")` | 边跑边打印每个节点的动作 |
| `graph.get_state(cfg).values` | 跑完读累计 token 和最终结论 |
| `estimate_cost` | 把 token 换成钱 |
| `BILLSLEUTH_SESSION` | 审计日志分会话 |

## 动手练习

**练习 1:交卷时写一个不存在的发票号,图会拦吗?** 写一段假模型脚本:先复算 `INV-0001-05`,然后交卷时 `invoice_ids` 写成 `["INV-9999-01"]`。跑出来看 `escalated` 是什么。如果没拦住,改 `conclude` 把它拦下来,并补一条测试。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex1_fake_invoice.py  练习 1:模型交卷时写了一个根本不存在的发票号,图会不会拦住
from langchain_core.messages import AIMessage

from billsleuth.graph import Intake, build_graph
from billsleuth.mcp_bridge import BillingMCP
from tests.test_graph import ScriptedLLM, call, submit

llm = ScriptedLLM(Intake(complaint="其他"), [
    AIMessage("", tool_calls=[call("recompute_invoice", {"invoice_id": "INV-0001-05"}, 1)]),
    AIMessage("", tool_calls=[submit(2, invoice_ids=["INV-9999-01"])]),
])
g = build_graph(llm=llm, mcp=BillingMCP(in_process=True))
out = g.invoke({"customer_id": "C-0001", "question": "9 月多扣了"}, {"recursion_limit": 40})
print("escalated:", out["escalated"], " findings.invoice_ids:", out["findings"]["invoice_ids"])
```

<div class="line-notes">

- `from tests.test_graph import ScriptedLLM, call, submit` 复用测试文件里的演员和小工具。
- `AIMessage("", tool_calls=[call("recompute_invoice", {"invoice_id": "INV-0001-05"}, 1)]),` 第一句台词是一次正常的复算。
- `AIMessage("", tool_calls=[submit(2, invoice_ids=["INV-9999-01"])]),` 第二句交卷,把发票号覆盖成一个不存在的。其他字段还是 S001 的正确值。
- `print("escalated:", out["escalated"], " findings.invoice_ids:", out["findings"]["invoice_ids"])` 看图的反应。

</div>

```bash
uv run python -m scratch.ex1_fake_invoice
```

```text
escalated: False  findings.invoice_ids: ['INV-9999-01']
```

没拦住。`check_call` 的第二道防线只管**工具调用的参数**,而交卷用的是伪工具 `SubmitFindings`,`conclude` 只用 pydantic 检查了格式,发票号写什么它不管。一个编出来的发票号会原样进入后面的写解释和起草贷记单。修法是在 `conclude` 里再对一遍已知发票列表:

```python
    def conclude(state: CaseState) -> dict:
        sub = next((c for c in last_calls(state) if c["name"] == "SubmitFindings"), None)
        if sub is None:
            return {"findings": {}, "escalated": True}
        try:
            f = SubmitFindings(**sub["args"])
        except Exception as e:  # 参数不合规就转人工,不硬猜
            return {"findings": {"error": str(e)}, "escalated": True}
        unknown = [i for i in f.invoice_ids if i not in state.get("known_invoices", [])]
        if unknown:
            return {"findings": {"error": f"结论里的发票号不在客户发票列表里:{unknown}"}, "escalated": True}
        return {"findings": f.model_dump(), "escalated": False}
```

<div class="line-notes">

- `unknown = [i for i in f.invoice_ids if i not in state.get("known_invoices", [])]` 结论里的每个发票号都得在 locate 取回的列表里。`known_invoices` 是 locate 写进状态的。
- `return {"findings": {"error": f"结论里的发票号不在客户发票列表里:{unknown}"}, "escalated": True}` 和格式不合格走同一条路:`findings` 里放 `error`,转人工。

</div>

再补一条测试放进 `tests/test_graph.py`:

```python
def test_findings_with_unknown_invoice_are_escalated():
    llm = ScriptedLLM(INTAKE, [AIMessage("", tool_calls=[submit(1, invoice_ids=["INV-9999-01"])])])
    out = run(llm)
    assert out["escalated"] is True and "不在客户发票列表里" in out["findings"]["error"]
```

重跑 `ex1_fake_invoice.py` 得到 `escalated: True`,现有测试里交卷用的都是真实发票号,全部照旧通过。这条改动留在 `graph.py` 里,后面的天不依赖它,但也不会被它影响。

</details>

**练习 2:只凭审计日志还原一次调查。** 跑 S017,然后到 `billing.db` 里按这次的会话号查 `audit_log`,看模型查了哪些工具、顺序如何、有没有失败的调用。和 `run.py` 打印的路径对一下,有什么对不上?

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex2_audit_replay.py  练习 2:跑完一个场景,只凭审计日志把这次调查还原出来
import os

from langgraph.checkpoint.memory import InMemorySaver

from billsleuth.db import connect
from billsleuth.graph import build_graph
from billsleuth.mcp_bridge import BillingMCP
from billsleuth.run import run_one

run_one("S017", build_graph(mcp=BillingMCP(in_process=True), checkpointer=InMemorySaver()))
session = os.environ["BILLSLEUTH_SESSION"]
print(f"\n审计日志,会话 {session}:")
with connect() as conn:
    for r in conn.execute("SELECT at, tool, args_json, ok FROM audit_log WHERE session_id = ? ORDER BY id", (session,)):
        print(f"  {r['at'][11:19]}  {r['tool']:<18} {r['args_json']}  {'成功' if r['ok'] else '失败'}")
```

<div class="line-notes">

- `run_one("S017", build_graph(` 直接复用 `run.py` 里的函数。
- `session = os.environ["BILLSLEUTH_SESSION"]` `run_one` 里设置的会话号还留在环境变量里。
- `with connect() as conn:` Day 680 的 `db.connect()`,默认连 `billing.db`。
- `SELECT at, tool, args_json, ok FROM audit_log WHERE session_id = ? ORDER BY id` 按会话号取、按写入顺序排。问号是占位符,值放在后面的元组里,不拼字符串(SQL 注入的老规矩)。
- `r['at'][11:19]` 时间戳 `2026-10-27T02:03:49+00:00` 取第 11 到 19 位,就是 `02:03:49`。同一行里的 `{r['tool']:<18}` 是左对齐占 18 位,工具名对齐成一列。

</div>

```bash
uv run python -m scratch.ex2_audit_replay
```

```text
审计日志,会话 S017-9e7eb7:
  02:03:49  list_invoices      {"customer_id": "C-0017", "limit": 24}  成功
  02:03:50  get_customer       {"customer_id": "C-0017"}  成功
  02:03:50  list_payments      {"customer_id": "C-0017", "invoice_id": null}  成功
  02:03:51  recompute_invoice  {"invoice_id": "INV-0017-05"}  成功
  02:03:51  get_invoice        {"invoice_id": "INV-0017-05"}  成功
```

(前面是 `run_one` 的正常输出,这里省略。时间是 UTC。)两处对不上,都有道理。第一行 `list_invoices` 是 `locate` 用代码调的,`run.py` 的 `[investigate]` 行里没有它,审计日志却记了:审计记的是「工具被谁调用过」,不分是模型还是代码。没有 `SubmitFindings`,因为它是伪工具,从来没有到过 MCP server,审计日志管不到它。这意味着审计日志能还原「查了什么」,还原不了「交了什么卷」。后者在状态里(`findings`),Day 690 加审批以后,要和贷记单草稿一起落库。

</details>

**练习 3:同一个场景连跑 3 次。** 对 S023 连跑 3 次,看结论、发票号、轮数稳不稳。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex3_repeat.py  练习 3:同一个场景连跑 3 次,看结论、发票号和轮数稳不稳
import sys

from langgraph.checkpoint.memory import InMemorySaver

from billsleuth.graph import build_graph
from billsleuth.mcp_bridge import BillingMCP
from billsleuth.run import run_one

sid, k = sys.argv[1], int(sys.argv[2])
g = build_graph(mcp=BillingMCP(in_process=True), checkpointer=InMemorySaver())
rs = [run_one(sid, g) for _ in range(k)]
print(f"\n{sid} 连跑 {k} 次:命中 {sum(r['hit'] for r in rs)},发票号一致 {sum(r['ids_ok'] for r in rs)},"
      f"模型调用 {[r['calls'] for r in rs]}")
```

<div class="line-notes">

- `sid, k = sys.argv[1], int(sys.argv[2])` 两个命令行参数:场景号和次数。命令行传来的都是字符串,次数要转成整数。
- `rs = [run_one(sid, g) for _ in range(k)]` 同一个场景跑 k 遍。`_` 是「用不到的循环变量」的惯用名。
- `sum(r['hit'] for r in rs)` 布尔值求和就是数 True 的个数。

</div>

```bash
uv run python -m scratch.ex3_repeat S023 3
```

```text
  结论:duplicate_invoice ['INV-0023-04', 'INV-0023-04D'] 多收 139.05  标准答案:duplicate_invoice ['INV-0023-04D'] 多收 139.05  ✓(发票号不一致)
  结论:duplicate_invoice ['INV-0023-04', 'INV-0023-04D'] 多收 139.05  标准答案:duplicate_invoice ['INV-0023-04D'] 多收 139.05  ✓(发票号不一致)
  结论:duplicate_invoice ['INV-0023-04', 'INV-0023-04D'] 多收 139.05  标准答案:duplicate_invoice ['INV-0023-04D'] 多收 139.05  ✓(发票号不一致)

S023 连跑 3 次:命中 3,发票号一致 0,模型调用 [4, 5, 5]
```

(只摘了每次的结论行。)3 次根因和金额都对,3 次发票号都是两张,0 次和标准答案一致;模型调用 4、5、5 次,轮数有波动。这说明「两张都写」是模型稳定的习惯,不是偶然。它的理由也说得通:它查到两张发票金额一样、同一周期,把两张都列出来给人看。这类问题的解法不是让模型改习惯,而是先定业务口径:结论里要的到底是「出问题的那张」还是「相关的所有发票」。我倾向后者作为结论,加一个字段 `duplicate_of` 标出哪张是重复件,但那是 Day 693 评测口径的事,今天只记下来。

</details>

**练习 4:模型少给必填参数,图能照常往下走吗?** 假模型的台词里,让 `get_invoice` 不带参数、`list_payments` 不带 `customer_id`,看每个调用分别在哪一层被拦住、报错长什么样。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex4_bad_args.py  练习 4:模型调工具时少给了必填参数,MCP 在门口拒绝,图能不能照常往下走
from langchain_core.messages import AIMessage, ToolMessage

from billsleuth.graph import Intake, build_graph
from billsleuth.mcp_bridge import BillingMCP
from tests.test_graph import ScriptedLLM, call, submit

llm = ScriptedLLM(Intake(complaint="其他"), [
    AIMessage("", tool_calls=[call("get_invoice", {}, 1), call("list_payments", {}, 3)]),
    AIMessage("", tool_calls=[submit(2)]),
])
g = build_graph(llm=llm, mcp=BillingMCP(in_process=True))
out = g.invoke({"customer_id": "C-0001", "question": "9 月多扣了"}, {"recursion_limit": 40})
for m in out["messages"]:
    if isinstance(m, ToolMessage):
        print(m.content[:150])
print("escalated:", out["escalated"])
```

<div class="line-notes">

- `call("get_invoice", {}, 1), call("list_payments", {}, 3)` 两个调用参数都是空字典。
- `for m in out["messages"]:` 把所有 ToolMessage 打出来看。
- `print(m.content[:150])` 截 150 字符,pydantic 的报错很长。

</div>

```bash
uv run python -m scratch.ex4_bad_args
```

```text
[工具报错] 发票 None 不在这个客户的发票列表里,发票号必须来自 list_invoices
[工具报错] Error executing tool list_payments: 1 validation error for list_paymentsArguments
customer_id
  Field required [type=missing, input_value={}, i
escalated: False
```

两个调用都没把图弄崩,模型下一轮拿到的都是 `[工具报错]` 开头的文字,可以改参数重试,最后照常交卷,`escalated` 是 False。但拦的层不一样:`get_invoice` 是在图里的 `check_call` 被拦的(`args.get("invoice_id")` 取到 None,不在已知列表里),报错文字里写着「发票 None」,模型看得懂,但有点怪;`list_payments` 缺的是 `customer_id`,`check_call` 只检查「有这个参数时它得是本客户」,没有就放行,到了 MCP server 才被 pydantic 的参数校验拒绝,报错是 pydantic 的原文,英文又长。能用,但提示不友好。要改的话,可以在 `check_call` 里对「必填参数缺失」统一返回一句中文,如「缺少参数 customer_id」,让模型少读一段英文堆栈。这是体验上的小优化,不影响正确性,我没有改。

</details>

**验收标准:** `uv run pytest -q` 全绿(加上练习 1 的测试是 267 条左右);`test_graph.py` 的 7 条能不看文章说出每条守的规则;故意删掉 `route` 里那一行判断,能看到 1 条测试变红并说清为什么;`run.py` 至少跑通 5 个场景并打印出完整的工具调用路径;练习 2 能用审计日志还原一次调查并解释为什么日志里没有 `SubmitFindings`;能说出 16/16 为什么还不能说明 Agent 好用。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 假模型(fake / scripted LLM) | 台词提前写好的模型替身,图问什么都按剧本回,例子:`ScriptedLLM` |
| 剧本(script) | 假模型要念的一串消息,一次 `invoke` 念一句,念完再调就报 `IndexError` |
| 路径覆盖 | 测试走到了图里哪几条路,例子:交卷、催交、转人工、轮数到顶各一条 |
| 轮数上限 | `MAX_LLM_CALLS`,调查最多调多少次模型,防止模型一直不交卷烧钱 |
| 会话号(session) | 一次调查的标识,`BILLSLEUTH_SESSION`,审计日志按它分组,例子:`S017-9e7eb7` |
| `stream_mode="updates"` | 图每执行完一个节点就吐出这个节点改了什么,用来边跑边打印 |
| 命中 | 本课的口径:根因和多收金额都和标准答案一致,发票号单独记 |
| Wilson 区间 | 估计「真实命中率」范围的公式,全对时下限是 n / (n + 1.96²),16 次全对约 81% |
| 噪声 | 同样的输入每次跑结果略有不同,例子:S023 连跑 3 次模型调用 4、5、5 |
| 工具调用路径 | 模型一次调查里依次调了哪些工具,例子:get_customer → get_invoice → recompute_invoice → … → SubmitFindings |

## 常见误区

**只用真模型测流程。** 出错的路径是真模型最少走的路径,16 个场景里没有一次被防线拦、一次催交、一次转人工。这些路径只能用假模型逼出来。

**假模型测试绿了,Agent 就没问题。** 假模型测的是图在各种台词下的反应,不是模型会不会说出那些台词。两样都要:今天上午那 7 条保证图的代码对,下午的真模型跑才知道模型的习惯。

**删掉「只催一次」这种判断,觉得没人会注意。** 实测删掉以后只有一条测试红,红法是剧本被念光。换成真模型就是一个一直催、一直烧钱的循环。

**剧本写短了就怀疑假模型有问题。** `IndexError: pop from empty list` 说的是图比你想的多走了一轮,先检查流程为什么多走,再决定补台词还是改图。

**用一次真跑的数下结论。** 同一个场景 S023 连跑 3 次,模型调用 4、5、5 次,输入 token 在 10078 和 15014 之间。比较两个版本的花费和轮数,至少要跑几次再看。

**16 个全对就以为做完了。** 样本是挑的、题目偏简单、没有走过坏路径,真正的评测从 Day 693 开始。

**交卷时只校验格式。** 练习 1 实测,`SubmitFindings` 里写一个根本不存在的发票号,图照样放行。凡是模型能「写」出来的 ID,都要和代码已知的清单再对一遍。

## 学习资料

### 文档与文章

- [LangGraph · Test](https://docs.langchain.com/oss/python/langgraph/test):官方的图测试指南,讲怎么单独测节点、怎么用 checkpointer 从中间状态开始,对照今天的 `ScriptedLLM` 看,15 分钟。
- [LangChain · Test](https://docs.langchain.com/oss/python/langchain/test):用假的聊天模型(`GenericFakeChatModel` 一类)测 Agent,和我们手写演员的做法是同一个思路,10 分钟。
- [pytest · How to use fixtures](https://docs.pytest.org/en/stable/how-to/fixtures.html):今天用的 autouse fixture 和 conftest 共享,看前半部分,10 分钟。
- [Anthropic · Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):回头看「工作流 vs Agent」那一节,对照 Day 684 拆段和今天的对账,20 分钟。
- [Hamel Husain · Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/):为什么要有评测集而不是凭感觉看几个例子,「先别高兴」那一节的延伸阅读,25 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1bY411y7dv&autoplay=0&high_quality=1" title="Python单元测试-08.PyTest框架" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Python单元测试-08.PyTest框架 · 21 分钟,pytest 的基本写法,回看断言和用例组织就够了。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1EC4y1273B&autoplay=0&high_quality=1" title="Python单元测试-10.conftest.py" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Python单元测试-10.conftest.py · 11 分钟,讲 conftest.py 怎么让多个测试文件共用 fixture,对应我们的 `fresh_db`。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/jGg_1h0qzaM" title="LangGraph Complete Course for Beginners – Complex AI Agents with Python" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>freeCodeCamp.org · LangGraph Complete Course for Beginners – Complex AI Agents with Python · 英文长课,挑带工具的 Agent 图那一段,看别人怎么写循环和结束条件,对照我们的 route。</figcaption>
</figure>

### 书籍

- Vladimir Khorikov《Unit Testing Principles, Practices, and Patterns》(Manning, 2020):讲什么该用替身、什么不该,第 5 章区分了替身的几种类型,对照今天只换模型、不换其他零件的取舍。
- Harry Percival、Bob Gregory《Architecture Patterns with Python》(O'Reilly, 2020):用「假的仓库」代替真数据库写测试的做法讲得很清楚,和我们的假模型是同一类手法。
- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 4 章评估方法,「先别高兴」那一节说的样本量和代表性问题在这里有系统讲解。

### 开源项目与代码

- [langchain-ai/langchain](https://github.com/langchain-ai/langchain):看 `libs/core` 里 `language_models/fake_chat_models.py`,官方提供的假聊天模型就是按序号逐条回话的,和我们手写的 `ScriptedLLM` 对照看。
- [pytest-dev/pytest](https://github.com/pytest-dev/pytest):想知道 `parametrize`、`monkeypatch` 怎么实现的,从 `src/_pytest/python.py` 读起。

## 自测

1. 为什么调查图的流程测试要用假模型,而不是直接用真模型?

<details><summary>答案</summary>

出错的路径(越权被拦、催交、格式不合格、轮数到顶)真模型很少走到,想测就得等它碰巧犯错;而且每次测试花钱、要等十几秒、结果每次不同。假模型按剧本念,图每次走同样的路,一秒内跑完,一分钱不花,可以放进每次提交都跑的测试里。

</details>

2. `ScriptedLLM` 为什么只需要 `bind_tools`、`with_structured_output`、`invoke` 三个方法?

<details><summary>答案</summary>

因为 `build_graph` 对模型对象只用了这三样:intake 节点建图时调 `with_structured_output`,investigate 节点建图时调 `bind_tools`、每轮调 `invoke`。Python 不检查类型,只要有这三个方法就能当模型用,这叫鸭子类型。图里用到别的方法时,假模型要跟着补。

</details>

3. 删掉 `route` 里「催过一次就不再催」的判断,哪条测试会红?红的方式是什么?换成真模型会怎样?

<details><summary>答案</summary>

只有 `test_other_customer_and_unknown_invoice_are_blocked` 红,报 `IndexError: pop from empty list`:模型不交卷,图一直催,剧本被念光。换成真模型,模型要是一直不交卷,图会一直催下去,每一步都是一次付费调用,直到撞上递归上限。

</details>

4. 16 个场景全部命中,为什么还不能说 Agent 好用?至少说三点。

<details><summary>答案</summary>

一,复算工具直接给了差额和差在哪一类,数据集上差额匹配没有区分度,Agent 要拿分的是根因、解释和不乱冲正;二,16 个是挑的、每类一个,样本小,全对时 95% 置信下限只有约 81%;三,16 个场景里没有一次走到防线、催交或转人工,坏路径在真实场景里的发生频率没有数据。另外 S023 发票号一致只有 0/3,口径还没定。

</details>

5. 拆段之后真模型并没有更便宜(S017、S023 反而更贵),那拆段买到了什么?

<details><summary>答案</summary>

买到的是可测、可对账、可追溯:结论是结构化的,可以逐字段和标准答案比;图的零件和路径可以不花钱单独测;证据链一路积累,后面写解释时每个数字有出处。贵的原因是系统提示词变长、多了一轮交卷调用,locate 省下的 `list_invoices` 抵不过这两项。

</details>

6. 面试题:你的 Agent 流程用 LangGraph 编排,团队要求每次提交都跑测试,但每次调真模型要花钱、结果还不稳定。你怎么设计测试?

<details><summary>答案</summary>

分层。最底层是纯函数(找候选、参数检查、证据抽取、解析结论),直接单测。中间层把模型换成按剧本回话的假模型,其余(路由、工具层、状态合并、防线)用真的,逼图走每一条路径:正常交卷、并行调用、越权、催交、格式错误、轮数到顶,断言状态和消息,这一层放进每次提交的 CI,秒级、零成本。最上层才是真模型,跑固定评测集,统计命中率和置信区间、轮数、花费,按天或按版本跑,不进每次提交。真模型那层的数字要多跑几次看波动,不拿单次结果下结论。

</details>

## 明天预告

明天是 Day 688 · BillSleuth(八):两份解释两个读者,数字溯源校验器。今天的图能查出「多收 26.02,原因是时区」,但这只是一份给程序看的结论。客户要的是一段看得懂的话,同事要的是一段能复核的说明,而且里面的每个数字都得有出处。明天先让模型按规则写两份解释,再写一个纯代码的校验器,把 Day 686 实验里那 4.84 和 28.71 这种找不到出处的数字拦下来。
