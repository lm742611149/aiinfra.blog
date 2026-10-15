---
title: 'Day 124 · BillSleuth(三):LangGraph 调查流程与证据链'
description: '用 LangGraph 把调查流程搭起来:先用结构化输出读懂客户在抱怨什么,用代码定位候选发票,再进入「提出假设、调工具验证」的循环,最后通过 SubmitFindings 提交结构化结论。工具结果由代码自动抽成带编号的证据链。用 DeepSeek 实跑 16 个场景,覆盖全部 12 类根因和 4 种「账没错」。'
pubDate: 2026-10-15
regime: none
tags: ['langgraph', 'agent-design', 'evidence', 'billing', 'agent-60']
series: 'agent-60'
day: 124
lang: 'zh'
---

## 今天要解决的问题

工具有了,今天把 Agent 接上。Day 28 的工单分流 Agent 是「分类 → 检索 → 循环调工具 → 审批 → 回复」,今天的调查流程结构类似,但有两个新要求:一是结论必须是结构化的(根因类别、发票号、多收金额、期望动作),因为后面要拿它和标准答案逐字段比;二是 Agent 看到的每个事实都要有编号、有出处,因为明天要用这些编号校验它写给客户的每一个数字。学完你应该能:

1. 讲清楚为什么调查流程要拆成 intake、locate、investigate、conclude 几段,而不是一个大循环从头跑到尾。
2. 用结构化输出读懂客户的抱怨(类型、金额、月份),用代码而不是模型去定位候选发票。
3. 把「提交结论」做成一个伪工具 `SubmitFindings`,用 pydantic 校验结论的格式,校验不过就转人工而不是硬猜。
4. 在工具层之外再加两道防线:只能查本客户,发票号必须来自 `list_invoices` 的结果。
5. 写一个证据抽取模块,把每次工具结果里的金额、日期、税率自动编号存进状态。
6. 用假模型写不花钱的流程测试,再用真模型跑一批场景,看它的查账路径、步数和成本。

预计用时 4–5 小时。前置:Day 24–25(LangGraph 和 checkpoint)、Day 28(工单分流 Agent 的桥接写法)、Day 123(MCP server)。

## 流程为什么要拆段

最省事的写法是 Day 9 那种:一个系统提示词、一组工具、一个循环,让模型从头查到尾。我一开始也是这么写的,跑了几个场景,问题很明显:模型每次都要先花一两轮去 `list_invoices`、把发票列表从头读到尾,再决定看哪张;有时候客户说的是「8 月那张」,它却先去查了 10 月的。这些步骤不需要判断力,却每次都要消耗一轮推理和几千 token。

所以我把流程拆成四段,每段只做一件事,能用代码的就用代码:

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="BillSleuth 调查流程状态图:intake、locate、investigate 与 tools 循环、nudge、conclude">
  <rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)" rx="6"/>
  <rect x="20" y="40" width="100" height="44" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="70" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">intake</text>
  <text x="70" y="76" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">结构化输出</text>
  <line x1="120" y1="62" x2="155" y2="62" stroke="var(--ink-soft)" marker-end="url(#a124)"/>
  <rect x="155" y="40" width="100" height="44" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="205" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">locate</text>
  <text x="205" y="76" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">纯代码</text>
  <line x1="255" y1="62" x2="290" y2="62" stroke="var(--ink-soft)" marker-end="url(#a124)"/>
  <rect x="290" y="40" width="130" height="44" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="355" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">investigate</text>
  <text x="355" y="76" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">假设 → 选工具</text>
  <line x1="340" y1="84" x2="340" y2="140" stroke="var(--compute)" marker-end="url(#a124)"/>
  <line x1="370" y1="140" x2="370" y2="84" stroke="var(--compute)" marker-end="url(#a124)"/>
  <rect x="290" y="140" width="130" height="50" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="355" y="160" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">tools</text>
  <text x="355" y="178" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">权限检查+抽证据</text>
  <line x1="420" y1="62" x2="480" y2="62" stroke="var(--ink-soft)" marker-end="url(#a124)"/>
  <text x="450" y="52" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">Submit</text>
  <rect x="480" y="40" width="130" height="44" fill="none" stroke="var(--ink)" rx="4"/>
  <text x="545" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">conclude</text>
  <text x="545" y="76" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">pydantic 校验</text>
  <path d="M420 75 Q470 120 470 220" fill="none" stroke="var(--ink-faint)" marker-end="url(#a124)"/>
  <rect x="420" y="220" width="110" height="40" fill="none" stroke="var(--ink-faint)" rx="4"/>
  <text x="475" y="245" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">nudge(一次)</text>
  <path d="M420 240 L300 240 L300 84" fill="none" stroke="var(--ink-faint)" marker-end="url(#a124)"/>
  <rect x="20" y="140" width="235" height="120" fill="none" stroke="var(--rule)" rx="4"/>
  <text x="35" y="162" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">状态 CaseState</text>
  <text x="35" y="184" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">customer_id  question  intake</text>
  <text x="35" y="202" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">candidates  known_invoices</text>
  <text x="35" y="220" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">messages  evidence[E1..En]</text>
  <text x="35" y="238" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">llm_calls  tokens  findings</text>
  <text x="20" y="300" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">没调工具也没提交:先 nudge 催一次;还不提交,或者轮数用完,都进 conclude 转人工</text>
  <defs><marker id="a124" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
</svg>
<figcaption>蓝色节点调模型,琥珀色节点只跑代码。只有 investigate 是开放式的循环,其他段都是确定的一步。</figcaption>
</figure>

**intake** 用结构化输出把客户原话拆成三个字段:抱怨类型、提到的金额、提到的月份。这一步只看原话,不调工具。

**locate** 是纯代码:调一次 `list_invoices`,先按金额精确匹配,匹配不到再按月份,都没有就取最新一张。然后把客户原话、intake 的结果、完整的发票列表和候选发票拼成一条消息,作为调查的开场白。模型一进入调查就知道「这个客户有哪几张发票、最可能是哪张」。

**investigate ⇄ tools** 是唯一开放式的部分,也就是 Agent 真正发挥作用的地方:提出假设,选工具验证,看结果,决定下一步。

**conclude** 解析 `SubmitFindings` 的参数,格式不对就转人工。

这种「固定的前后段 + 中间一段开放循环」的结构,Anthropic 在《Building effective agents》里叫 workflow 和 agent 的组合。我的经验是,**生产系统里纯粹的自主 Agent 很少,大部分是这种混合体**:能确定的步骤写死,只在需要判断的地方放手。好处不只是省钱,还有可测试:intake 和 locate 都能单独写单元测试,出了问题也容易定位是哪一段。

## 模型对象和 MCP 桥接

先是两个基础模块。`llm.py` 和 Day 24 的 `get_llm` 差不多,多了三样东西:

```python
# billsleuth/billsleuth/llm.py
"""模型对象。走 OpenAI 兼容协议,换厂商只改 .env。LLM_EXTRA_BODY 用来传厂商私有参数(比如关掉 DeepSeek 的思考模式)。"""
import json
import os

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from pydantic import SecretStr

load_dotenv()


def get_llm(temperature: float = 0) -> ChatOpenAI:
    extra = os.environ.get("LLM_EXTRA_BODY")
    return ChatOpenAI(
        model=os.environ["LLM_MODEL"],
        base_url=os.environ["LLM_BASE_URL"],
        api_key=SecretStr(os.environ["LLM_API_KEY"]),
        temperature=temperature,
        max_retries=5,  # 厂商偶尔返回 503「太忙」,SDK 会指数退避重试
        extra_body=json.loads(extra) if extra else None,
    )


def estimate_cost(input_tokens: int, output_tokens: int) -> float:
    """按 .env 里的 LLM_PRICE(缓存命中,未命中,输出;元/百万 token)粗算,输入一律按未命中算,是上限。"""
    _, miss, out = (float(x) for x in os.environ.get("LLM_PRICE", "0,0,0").split(","))
    return (input_tokens * miss + output_tokens * out) / 1_000_000
```

`LLM_EXTRA_BODY` 是你 Day 3 就在 `.env` 里写过的变量,用来传厂商私有参数。用 DeepSeek 时我们关掉思考模式,原因有两个:Day 8 说过,DeepSeek 思考模式下指定 `tool_choice` 会直接报 400,而结构化输出在 function calling 模式下需要指定工具;另外思考模式要求多轮工具调用时回传 `reasoning_content`,LangChain 的消息转换不一定帮你带上。关掉最省心,查账这种任务也不需要长链思考。

`max_retries=5` 是被真实情况逼出来的:我跑这批场景时,DeepSeek 好几次返回 503「Service is too busy」,默认重试次数用完就整个调查失败了。`api_key` 用 `SecretStr` 包一层,是为了让编辑器的类型检查不报红线,顺便避免 key 被打印进日志。

`estimate_cost` 按 `.env` 里的 `LLM_PRICE` 粗算花费,输入一律按「缓存未命中」的价格算,所以是上限。DeepSeek 对重复的前缀有缓存折扣,我们的系统提示词每轮都一样,实际花费会更低。

然后是桥接。思路和 Day 28 的 `mcp_bridge.py` 一样,LangGraph 节点写成同步函数,MCP 客户端是异步的,中间用 `asyncio.run` 桥接。这次加了一个 `in_process` 选项:

```python
# billsleuth/billsleuth/mcp_bridge.py
"""同步地调用 BillSleuth MCP server。LangGraph 节点写成同步函数,MCP 客户端是异步的,这里做桥接。

两种连法:
- stdio(默认):起一个子进程跑 server,和部署时把 server 放在另一台机器上的形态一致;
- in_process=True:直接把 server 对象交给 Client,同进程内走完整协议,快,测试和评测用。
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from mcp import Client, StdioServerParameters

from billsleuth.db import ROOT


def _run(coro):
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result()


class BillingMCP:
    def __init__(self, in_process: bool = False) -> None:
        if in_process:
            from billsleuth.server import mcp
            self.target: Any = mcp
        else:
            # 构造时读环境变量(BILLSLEUTH_DB、BILLSLEUTH_SESSION),评测时先设好再建图
            self.target = StdioServerParameters(command=sys.executable, args=["-m", "billsleuth.server"],
                                                env={**os.environ}, cwd=str(ROOT))
        self._specs: list[dict] | None = None

    def tool_specs(self) -> list[dict]:
        """MCP 工具清单 → OpenAI 兼容的 tools 格式,只取一次。"""
        if self._specs is None:
            async def fetch():
                async with Client(self.target) as c:
                    return (await c.list_tools()).tools
            self._specs = [{"type": "function", "function": {
                "name": t.name, "description": t.description or "", "parameters": t.input_schema}}
                for t in _run(fetch())]
        return self._specs

    def call(self, name: str, args: dict) -> tuple[bool, Any]:
        """返回 (是否成功, 结构化结果或报错文字)。"""
        async def go():
            async with Client(self.target) as c:
                return await c.call_tool(name, args)
        r = _run(go())
        if r.is_error:
            return False, "\n".join(getattr(x, "text", "") for x in r.content)
        data = r.structured_content
        if isinstance(data, dict) and set(data) == {"result"}:  # 返回 list 时 SDK 会包一层 {"result": [...]}
            data = data["result"]
        return True, data


def to_text(ok: bool, data: Any) -> str:
    return json.dumps(data, ensure_ascii=False) if ok else f"[工具报错] {data}"
```

默认的 stdio 方式会起一个子进程跑 server,和部署时把工具层放在另一台机器上的形态一致。`in_process=True` 则直接把 server 对象交给 `Client`,同一个进程里走完整的 MCP 协议,省掉每次调用几百毫秒的进程启动时间。测试和评测用后者,一次评测上百个场景、每个场景十来次工具调用,差别很明显。`call` 返回 `(是否成功, 数据)`,顺手把 SDK 给列表包的那层 `{"result": [...]}` 拆掉了,昨天说过的那个小坑就在这里处理。

## 证据链:由代码抽取,不让模型自己记

```python
# billsleuth/billsleuth/evidence.py
"""证据链。每次工具调用成功后,从结构化结果里自动抽出「可以引用的事实」,存进状态。

为什么由代码抽、不让模型自己记:模型抄数字会抄错,代码不会。
后面写解释时(Day 125),回答里的每个金额都必须能在这里找到出处。
"""
from __future__ import annotations

from typing import Any, TypedDict


class Evidence(TypedDict):
    id: str            # E1、E2……,按出现顺序编号
    claim: str         # 这条事实说的是什么
    source_tool: str   # 来自哪个工具
    source_ref: str    # 哪张发票 / 哪笔扣款 / 哪个事件
    value: str         # 金额、日期、税率等,一律字符串


def _ev(claim: str, tool: str, ref: str, value: Any) -> dict:
    return {"claim": claim, "source_tool": tool, "source_ref": ref, "value": str(value)}


def extract(tool: str, args: dict, data: Any) -> list[dict]:
    """从一次成功的工具结果里抽证据(还没编号)。"""
    out: list[dict] = []
    if tool == "list_invoices":
        for inv in data:
            out.append(_ev(f"{inv['id']} 总额({inv['period_start']} 至 {inv['period_end']})", tool, inv["id"], inv["total"]))
    elif tool == "get_invoice":
        ref = data["id"]
        for k in ("subtotal", "discount", "tax", "total"):
            out.append(_ev(f"{ref} 的 {k}", tool, ref, data[k]))
        for n, ln in enumerate(data["lines"], start=1):
            out.append(_ev(f"{ref} 第 {n} 行:{ln['description']}", tool, f"{ref}#L{n}", ln["amount"]))
            if ln["kind"] == "recurring":
                out.append(_ev(f"{ref} 第 {n} 行单价", tool, f"{ref}#L{n}", ln["unit_amount"]))
    elif tool == "list_payments":
        for p in data:
            out.append(_ev(f"扣款 {p['id']}({p['status']},{p['attempted_at']})", tool, p["invoice_id"], p["amount"]))
    elif tool == "recompute_invoice":
        ref = data["invoice_id"]
        out.append(_ev(f"{ref} 按规则应收", tool, ref, data["expected_total"]))
        out.append(_ev(f"{ref} 实际开票金额", tool, ref, data["actual_total"]))
        out.append(_ev(f"{ref} 多收(实际 - 应收)", tool, ref, data["difference"]))
        out.append(_ev(f"{ref} 实际扣款合计({data['successful_payments']} 笔)", tool, ref, data["paid_total"]))
        for d in data["by_kind"]:
            out.append(_ev(f"{ref} {d['kind']} 应收", tool, ref, d["expected"]))
            out.append(_ev(f"{ref} {d['kind']} 实收", tool, ref, d["actual"]))
            out.append(_ev(f"{ref} {d['kind']} 差额", tool, ref, d["difference"]))
        for n, ln in enumerate(data["expected_lines"], start=1):
            out.append(_ev(f"{ref} 应收第 {n} 行:{ln['description']}", tool, ref, ln["amount"]))
    elif tool == "get_tax_rate":
        e = data["effective"]
        out.append(_ev(f"{e['region']} 在 {args.get('on')} 有效税率 {e['code']}", tool, e["code"], e["rate"]))
        for h in data["history"]:
            out.append(_ev(f"税率 {h['code']} 有效期 {h['valid_from']} 至 {h['valid_to'] or '今'}", tool, h["code"], h["rate"]))
    elif tool == "get_subscription_timeline":
        for e in data["events"]:
            out.append(_ev(f"事件 {e['type']} 本地日期", tool, e["id"], e["effective_local_date"]))
            for k, v in e["payload"].items():
                out.append(_ev(f"事件 {e['type']} 的 {k}", tool, e["id"], v))
        if data.get("coupon"):
            c = data["coupon"]
            out.append(_ev(f"优惠券 {c['id']}({c['kind']},{c['duration_months']} 个月)", tool, c["id"], c["value"]))
    elif tool == "get_customer":
        out.append(_ev("客户税务地区", tool, data["id"], data["tax_region"]))
        out.append(_ev("客户时区", tool, data["id"], data["timezone"]))
    return out


def number(evs: list[dict], start: int) -> list[dict]:
    return [{"id": f"E{start + i}", **e} for i, e in enumerate(evs)]


def render(evs: list[dict], limit: int = 400) -> str:
    """给模型看的证据清单,一行一条。"""
    return "\n".join(f"[{e['id']}] {e['claim']} = {e['value']}  ({e['source_tool']} {e['source_ref']})"
                     for e in evs[-limit:])
```

每次工具调用成功后,`extract` 根据工具名,从结构化结果里抽出值得引用的事实:发票的每个总额和每一行、扣款的每一笔、复算的应收实收和各类差额、税率和它的有效期、订阅事件的本地日期。每条证据有一句说明(claim)、来源工具、来源对象(哪张发票、哪笔扣款)和值。`number` 给它们按顺序编号 E1、E2……

为什么要由代码来抽?你可以让模型在回答里自己写「根据 recompute_invoice 的结果,应收是 1412.42」,但模型抄数字是会抄错的,而且你没法自动验证它抄得对不对。代码抽取则是确定的:E17 的值就是工具返回的那个字符串,一个字符都不会变。明天的数字溯源校验器,就是拿回答里的数字和这个清单逐一比对。

证据会越来越多,一个场景下来通常有四五十条。我们不把证据清单塞回给调查中的模型看(工具结果本身已经在消息里了),它只在写解释时才用到。

## 调查图

```python
# billsleuth/billsleuth/graph.py
"""BillSleuth 调查流程(Day 124):
intake(读懂客户在抱怨什么)→ locate(代码定位候选发票)→ investigate ⇄ tools(假设-验证循环)→ conclude。

对外只暴露 build_graph()。输入 {"customer_id", "question"},输出状态里有 findings、evidence、escalated。
"""
from __future__ import annotations

import operator
import re
from typing import Annotated, Literal

from langchain_core.messages import (
    AIMessage,
    AnyMessage,
    HumanMessage,
    SystemMessage,
    ToolCall,
    ToolMessage,
)
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from pydantic import BaseModel, Field
from typing_extensions import TypedDict

from billsleuth import evidence as ev
from billsleuth.faults import ROOT_CAUSES
from billsleuth.llm import get_llm
from billsleuth.mcp_bridge import BillingMCP, to_text

MAX_LLM_CALLS = 12
READ_TOOLS = {"get_customer", "list_invoices", "get_invoice", "list_payments",
              "get_subscription_timeline", "get_tax_rate", "recompute_invoice"}
INVOICE_TOOLS = {"get_invoice", "recompute_invoice"}
RootCause = Literal[tuple(ROOT_CAUSES)]  # type: ignore[valid-type]


class Intake(BaseModel):
    """客户在抱怨什么。只从客户原话里抽,原话没有就留空。"""
    complaint: Literal["金额不对", "重复扣款", "取消后仍扣款", "看不懂账单", "其他"]
    amount: str | None = Field(default=None, description="客户提到的金额,两位小数字符串,如 '362.52';没提到填 null")
    month: int | None = Field(default=None, ge=1, le=12, description="客户提到的月份;没提到填 null")


class SubmitFindings(BaseModel):
    """调查结束时调用,提交结论。只有拿到 recompute_invoice 或扣款记录的证据后才能提交。"""
    root_cause: RootCause = Field(description="根因类别,含义见系统提示;账没错填 no_error")  # type: ignore[valid-type]
    invoice_ids: list[str] = Field(description="出问题(或客户问的)那张发票号")
    overcharge: str = Field(pattern=r"^\d+\.\d{2}$", description="客户多付的金额(含税),直接用工具返回的数;没多付填 0.00")
    expected_action: Literal["credit_note", "explain_only"] = Field(description="多收了就 credit_note,否则 explain_only")
    reasoning: str = Field(description="内部说明:查了什么、哪个数和哪个数对不上、算式。只用工具返回过的数字")


class CaseInput(TypedDict):
    customer_id: str
    question: str


class CaseState(CaseInput, total=False):
    intake: dict
    candidates: list[str]
    known_invoices: list[str]
    messages: Annotated[list[AnyMessage], add_messages]
    evidence: Annotated[list[dict], operator.add]
    llm_calls: int
    tokens: Annotated[list[int], lambda a, b: [x + y for x, y in zip(a or [0, 0], b)]]
    nudged: bool
    findings: dict
    escalated: bool


def system_prompt(state: CaseState) -> str:
    causes = "\n".join(f"- {k}:{v}" for k, v in ROOT_CAUSES.items())
    return f"""你是云簿 CloudLedger 的计费调查员,处理客户 {state['customer_id']} 的账单争议。你只负责查清事实,不直接回复客户。

工作方式:先提出一两个可能的原因,再用工具验证,验证不了就换一个假设。不要凭感觉下结论。
- 判断某张发票算没算错,唯一依据是 recompute_invoice,不要自己心算金额。
- 客户说「扣了两次」:看 list_payments 里同一张发票有几笔 succeeded,也看 recompute_invoice 的 other_invoices_same_period。
- 金额有差异时,看 by_kind 差在哪一类,再顺着查:proration 差 → get_subscription_timeline 看事件的本地日期和折算行日期对不对;
  tax 差 → get_tax_rate 看税率和有效期;discount 差 → 看优惠券和有效月份;recurring 差 → 看席位和单价。
- recompute_invoice 说金额一致、也没有重复扣款,就是账没错(no_error),要准备给客户解释清楚。
- 只能查这个客户的数据。发票号必须来自 list_invoices 的结果。
- 查清楚后调用 SubmitFindings 提交结论,overcharge 直接用工具返回的数。最多 {MAX_LLM_CALLS} 轮。

根因类别:
{causes}"""


def build_graph(llm=None, mcp: BillingMCP | None = None, checkpointer=None):
    llm = llm or get_llm()
    mcp = mcp or BillingMCP()
    intake_llm = llm.with_structured_output(Intake, method="function_calling")

    def intake(state: CaseState) -> dict:
        r = Intake.model_validate(intake_llm.invoke(f"客户原话:{state['question']}"))
        return {"intake": r.model_dump(), "llm_calls": 1}

    def locate(state: CaseState) -> dict:
        """不用模型:按客户提到的金额和月份,在发票列表里找候选。便宜、确定、可测。"""
        cid = state["customer_id"]
        ok, invs = mcp.call("list_invoices", {"customer_id": cid, "limit": 24})
        if not ok:
            return {"candidates": [], "known_invoices": [], "messages": [HumanMessage(f"查不到发票:{invs}")]}
        found = ev.extract("list_invoices", {}, invs)
        info = state.get("intake", {})
        amount, month = info.get("amount"), info.get("month")
        cands = [i["id"] for i in invs if amount and i["total"] == amount]
        if not cands and month:
            cands = [i["id"] for i in invs if int(i["issued_at"][5:7]) == month]
        cands = cands or [invs[0]["id"]]
        brief = (f"客户原话:{state['question']}\n"
                 f"初步理解:{info}\n"
                 f"这个客户的发票(最新在前):\n" + "\n".join(
                     f"- {i['id']} 周期 {i['period_start']} 至 {i['period_end']} 总额 {i['total']} {i['currency']}" for i in invs)
                 + f"\n候选发票:{', '.join(cands)}。开始调查。")
        return {"candidates": cands, "known_invoices": [i["id"] for i in invs],
                "evidence": ev.number(found, 1), "messages": [HumanMessage(brief)]}

    specs = [s for s in mcp.tool_specs() if s["function"]["name"] in READ_TOOLS]
    investigator = llm.bind_tools(specs + [SubmitFindings])

    def investigate(state: CaseState) -> dict:
        reply = investigator.invoke([SystemMessage(system_prompt(state))] + state.get("messages", []))
        usage = getattr(reply, "usage_metadata", None) or {}
        return {"messages": [reply], "llm_calls": state.get("llm_calls", 0) + 1,
                "tokens": [usage.get("input_tokens", 0), usage.get("output_tokens", 0)]}

    def last_calls(state: CaseState) -> list[ToolCall]:
        last = state.get("messages", [])[-1]
        return last.tool_calls if isinstance(last, AIMessage) else []

    def route(state: CaseState) -> Literal["tools", "nudge", "conclude"]:
        calls = last_calls(state)
        if any(c["name"] == "SubmitFindings" for c in calls) or state.get("llm_calls", 0) >= MAX_LLM_CALLS:
            return "conclude"
        if calls:
            return "tools"
        return "conclude" if state.get("nudged") else "nudge"

    def nudge(state: CaseState) -> dict:
        return {"nudged": True, "messages": [HumanMessage("请用 SubmitFindings 提交结论;如果还缺证据,先调用工具。")]}

    def execute(call: ToolCall, state: CaseState) -> tuple[bool, object]:
        name, args = call["name"], call.get("args") or {}
        if name not in READ_TOOLS:
            return False, f"不能调用 {name}"
        if "customer_id" in args and args["customer_id"] != state["customer_id"]:
            return False, f"只能查询客户 {state['customer_id']} 的数据"
        if name in INVOICE_TOOLS and args.get("invoice_id") not in state.get("known_invoices", []):
            return False, f"发票 {args.get('invoice_id')} 不在这个客户的发票列表里,发票号必须来自 list_invoices"
        return mcp.call(name, args)

    def tools(state: CaseState) -> dict:
        msgs, new_ev = [], []
        for c in last_calls(state):
            ok, data = execute(c, state)
            msgs.append(ToolMessage(content=to_text(ok, data), tool_call_id=c["id"]))
            if ok:
                new_ev += ev.extract(c["name"], c.get("args") or {}, data)
        start = len(state.get("evidence", [])) + 1
        return {"messages": msgs, "evidence": ev.number(new_ev, start)}

    def conclude(state: CaseState) -> dict:
        sub = next((c for c in last_calls(state) if c["name"] == "SubmitFindings"), None)
        if sub is None:
            return {"findings": {}, "escalated": True}
        try:
            f = SubmitFindings(**sub["args"])
        except Exception as e:  # 参数不合规就转人工,不硬猜
            return {"findings": {"error": str(e)}, "escalated": True}
        return {"findings": f.model_dump(), "escalated": False}

    g = StateGraph(CaseState)
    for name, fn in [("intake", intake), ("locate", locate), ("investigate", investigate),
                     ("tools", tools), ("nudge", nudge), ("conclude", conclude)]:
        g.add_node(name, fn)
    g.add_edge(START, "intake")
    g.add_edge("intake", "locate")
    g.add_edge("locate", "investigate")
    g.add_conditional_edges("investigate", route, ["tools", "nudge", "conclude"])
    g.add_edge("tools", "investigate")
    g.add_edge("nudge", "investigate")
    g.add_edge("conclude", END)
    return g.compile(checkpointer=checkpointer)


def amounts_in(text: str) -> list[str]:
    return re.findall(r"\d+\.\d{2}", text)
```

这段代码比 Day 28 的 `graph.py` 短一些,因为没有审批节点(Day 126 再加)。挑几处讲。

### SubmitFindings:用工具来交卷

调查结束时,模型要交一份结构化结论。我没有在循环结束后再用 `with_structured_output` 让模型总结一遍,而是把 `SubmitFindings` 这个 pydantic 类和 MCP 工具一起绑给模型,让「交卷」本身就是一次工具调用。这样做有三个好处:模型自己决定什么时候证据够了;交卷和查账在同一个上下文里,不用再花一轮去总结;`route` 只要看最后一条消息里有没有 `SubmitFindings` 就知道该结束了。

`SubmitFindings` 的字段设计也有讲究。`root_cause` 是 13 个取值的 `Literal`,含义写在系统提示词里;`overcharge` 用正则限定两位小数字符串,「26.0」这样的值会被拒绝;`reasoning` 要求「只用工具返回过的数字」。`conclude` 节点用 `SubmitFindings(**args)` 再校验一遍,不合格就把错误存进 `findings["error"]` 并标记 `escalated`。**格式不对就转人工,不去猜模型想说什么**,这是计费场景的底线。

### 两道额外的防线

`execute` 里在调用 MCP 工具之前做了两个检查。第一个和 Day 28 一样:带 `customer_id` 参数的调用,参数必须等于本次调查的客户。第二个是新的:`get_invoice` 和 `recompute_invoice` 的发票号,必须出现在 `locate` 阶段 `list_invoices` 返回的列表里。这一条防的是模型编造发票号,也防它去查别的客户的发票(工具层本身不知道「本次调查是哪个客户」)。被拒绝的调用会以 ToolMessage 的形式告诉模型原因,模型通常下一轮就改正了。

### 只催一次

模型有时候查完以后直接输出一段文字结论,不调用 `SubmitFindings`。`route` 遇到这种情况,第一次走 `nudge` 节点,追加一句「请用 SubmitFindings 提交结论」再回到调查;第二次还这样就直接 conclude,因为没有结构化结论,会转人工。只催一次是有意的:模型连续两次不按要求交卷,通常说明它卡住了,再催下去只会浪费钱。

### 系统提示词:写查账的方法,不写答案

系统提示词里我没有写「如果 proration 差了就是时区问题」这种对应关系,因为同样是折算差额,可能是分母错、可能是时区错、可能是漏了退还行。我写的是**查账的方法**:recompute 是判断有没有算错的唯一依据;差在哪一类就顺着查哪条线;客户说扣了两次就看扣款记录和同周期发票;recompute 一致且没有重复扣款,就是账没错。这和你带一个新来的客服时教他的东西是一样的。

## 不花钱的流程测试

和 Day 28 一样,先用一个按剧本回话的假模型把流程跑通。假模型只实现图里用到的三个方法:

```python
# billsleuth/tests/test_graph.py
"""不花钱测调查流程:用一个按剧本回话的假模型,验证路由、越权拦截、证据抽取和结论解析。"""
import shutil

import pytest
from langchain_core.messages import AIMessage, ToolMessage

from billsleuth import seed
from billsleuth.graph import Intake, build_graph
from billsleuth.mcp_bridge import BillingMCP


class ScriptedLLM:
    """只实现图里用到的三个方法:bind_tools、with_structured_output、invoke。"""

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


def call(name, args, i):
    return {"name": name, "args": args, "id": f"call_{i}", "type": "tool_call"}


@pytest.fixture(scope="module")
def master_db(tmp_path_factory):
    path = tmp_path_factory.mktemp("db") / "master.db"
    mp = pytest.MonkeyPatch()
    mp.setenv("BILLSLEUTH_DB", str(path))
    seed.main()
    mp.undo()
    return path


@pytest.fixture(autouse=True)
def fresh_db(master_db, tmp_path, monkeypatch):
    path = tmp_path / "billing.db"
    shutil.copy(master_db, path)
    monkeypatch.setenv("BILLSLEUTH_DB", str(path))


def run(llm):
    g = build_graph(llm=llm, mcp=BillingMCP(in_process=True))
    return g.invoke({"customer_id": "C-0001", "question": "我们早就取消了,怎么 9 月还扣了 174.90 美元?"},
                    {"recursion_limit": 40})


def test_happy_path_collects_evidence_and_findings():
    llm = ScriptedLLM(Intake(complaint="取消后仍扣款", amount="174.90", month=9), [
        AIMessage("", tool_calls=[call("recompute_invoice", {"invoice_id": "INV-0001-05"}, 1)]),
        AIMessage("", tool_calls=[call("SubmitFindings", {
            "root_cause": "cancel_not_respected", "invoice_ids": ["INV-0001-05"], "overcharge": "174.90",
            "expected_action": "credit_note", "reasoning": "recompute 显示该周期不应开票,实际扣款 174.90"}, 2)]),
    ])
    out = run(llm)
    assert out["escalated"] is False
    assert out["findings"]["root_cause"] == "cancel_not_respected"
    assert "INV-0001-05" in out["candidates"]
    assert any(e["claim"].endswith("多收(实际 - 应收)") and e["value"] == "174.90" for e in out["evidence"])
    assert [e["id"] for e in out["evidence"]][:3] == ["E1", "E2", "E3"]  # 编号连续


def test_other_customer_and_unknown_invoice_are_blocked():
    llm = ScriptedLLM(Intake(complaint="其他"), [
        AIMessage("", tool_calls=[call("list_payments", {"customer_id": "C-0002"}, 1),
                                  call("get_invoice", {"invoice_id": "INV-0002-01"}, 2)]),
        AIMessage("我查不了,先这样。"),
        AIMessage("还是查不了。"),
    ])
    out = run(llm)
    tool_msgs = [m for m in out["messages"] if isinstance(m, ToolMessage)]
    assert "只能查询客户 C-0001" in tool_msgs[0].content
    assert "不在这个客户的发票列表里" in tool_msgs[1].content
    assert out["escalated"] is True  # 没提交结论,催了一次也没用,转人工


def test_bad_findings_are_escalated_not_guessed():
    llm = ScriptedLLM(Intake(complaint="金额不对"), [
        AIMessage("", tool_calls=[call("SubmitFindings", {
            "root_cause": "cancel_not_respected", "invoice_ids": ["INV-0001-05"], "overcharge": "174.9",
            "expected_action": "credit_note", "reasoning": "x"}, 1)]),
    ])
    out = run(llm)
    assert out["escalated"] is True and "error" in out["findings"]
```

三个测试分别验证:正常路径能收集证据、证据编号连续、结论被正确解析;越权查询和编造的发票号会被拦下,模型两次不交卷会转人工;结论格式不合格(`"174.9"` 少一位小数)会转人工。

```bash
uv run pytest -q
```

加上前两天的测试一共 220 个,全部通过。

## 用真模型跑起来

```python
# billsleuth/billsleuth/run.py
"""跑一个场景并和标准答案对比:uv run python -m billsleuth.run S001 [S002 ...]"""
import json
import sys
import uuid

from billsleuth.db import ROOT
from billsleuth.graph import build_graph
from billsleuth.llm import estimate_cost
from billsleuth.mcp_bridge import BillingMCP


def run_one(sid: str, graph) -> dict:
    sc = json.loads((ROOT / "scenarios" / f"{sid}.json").read_text())
    print(f"\n=== {sid} {sc['customer_id']}:{sc['question']}")
    final: dict = {}
    cfg = {"recursion_limit": 60, "configurable": {"thread_id": str(uuid.uuid4())}}
    for update in graph.stream({"customer_id": sc["customer_id"], "question": sc["question"]}, cfg,
                               stream_mode="updates"):
        for node, delta in update.items():
            if node == "investigate":
                msg = delta["messages"][-1]
                for c in getattr(msg, "tool_calls", []) or []:
                    print(f"  [{node}] → {c['name']}({json.dumps(c['args'], ensure_ascii=False)[:120]})")
            elif node == "intake":
                print(f"  [intake] {delta['intake']}")
            elif node == "locate":
                print(f"  [locate] 候选 {delta['candidates']}")
            final.update(delta)
    f, t = final.get("findings") or {}, sc["truth"]
    state = graph.get_state(cfg).values
    tin, tout = state.get("tokens") or [0, 0]
    print(f"  {state.get('llm_calls')} 次模型调用,输入 {tin} / 输出 {tout} token,约 ¥{estimate_cost(tin, tout):.4f}")
    hit = f.get("root_cause") == t["root_cause"] and f.get("overcharge") == t["overcharge"]
    print(f"  结论:{f.get('root_cause')} 多收 {f.get('overcharge')}  标准答案:{t['root_cause']} 多收 {t['overcharge']}  "
          f"{'✓' if hit else '✗'}")
    return {"id": sid, "hit": hit, "findings": f, "truth": t}


if __name__ == "__main__":
    from langgraph.checkpoint.memory import InMemorySaver
    g = build_graph(mcp=BillingMCP(in_process=True), checkpointer=InMemorySaver())
    results = [run_one(s, g) for s in sys.argv[1:]]
    print(f"\n{sum(r['hit'] for r in results)}/{len(results)} 命中")
```

```bash
uv run python -m billsleuth.run S011
```

下面是 S011(时区那个场景)的一次真实运行,模型是 DeepSeek 的 `deepseek-flash`,关闭思考模式:

```text
=== S011 C-0011:8 月这张发票金额 1438.44,我们财务对不上账,麻烦查一下。
  [intake] {'complaint': '金额不对', 'amount': '1438.44', 'month': 8}
  [locate] 候选 ['INV-0011-03']
  [investigate] → get_customer({"customer_id": "C-0011"})
  [investigate] → get_invoice({"invoice_id": "INV-0011-03"})
  [investigate] → recompute_invoice({"invoice_id": "INV-0011-03"})
  [investigate] → get_subscription_timeline({"customer_id": "C-0011"})
  [investigate] → get_tax_rate({"region": "SG", "on": "2026-08-01"})
  [investigate] → list_payments({"customer_id": "C-0011", "invoice_id": "INV-0011-03"})
  [investigate] → SubmitFindings({"root_cause": "timezone_change_date", "invoice_ids": ["INV-0011-03"], "overcharge": "26.02", …)
  4 次模型调用,输入 11147 / 输出 999 token,约 ¥0.0303
  结论:timezone_change_date 多收 26.02  标准答案:timezone_change_date 多收 26.02  ✓
```

7 次工具调用只用了 3 轮调查(加上 intake 一共 4 次模型调用),因为模型在一轮里并行发出了好几个工具调用,Day 8 讲的并行工具调用在这里派上了用场。它的路径和一个熟练客服差不多:先看客户和发票,复算发现差在折算和税,去看订阅事件,发现升级的本地日期是 7 月 15 日而折算行从 7 月 14 日开始,顺手排除了税率和重复扣款,然后交卷。

我一共跑了 16 个场景,12 类根因每类至少一个,4 种「账没错」也各一个,**全部命中**:根因类别和多收金额都和标准答案一致,有几个场景重复跑了两三次,结论没有变。下面是其中 8 个打印了用量的场景:

| 场景 | 根因 / 变体 | 模型调用 | 输入 token | 输出 token | 花费上限 |
| --- | --- | --- | --- | --- | --- |
| S005 | coupon_not_applied | 6 | 23698 | 1254 | ¥0.0574 |
| S018 | quantity_change_ignored | 4 | 10260 | 972 | ¥0.0283 |
| S020 | coupon_wrong_base | 4 | 11577 | 924 | ¥0.0305 |
| S021 | wrong_plan_price | 5 | 13506 | 1061 | ¥0.0355 |
| S031 | wrong_tax_region | 5 | 13162 | 825 | ¥0.0329 |
| S003 | no_error / 年费续费 | 4 | 9371 | 834 | ¥0.0254 |
| S006 | no_error / 税 | 5 | 12656 | 798 | ¥0.0317 |
| S009 | no_error / 优惠期结束 | 5 | 16383 | 1027 | ¥0.0410 |

花费按 `.env` 里的价格(输入未命中缓存 2 元、输出 8 元,每百万 token)算,输入全部按未命中计,是上限。每个场景墙钟时间 15 到 30 秒,大部分花在等模型。

先别高兴。16 个全对,我的第一反应不是「Agent 真厉害」,而是**题目太简单了**。原因昨天就说了:复算工具直接给出了差额和差在哪一类,Agent 剩下的工作主要是分类。而且这 16 个是我挑的、每类一个,不是随机抽样,样本也太小,用 Day 69 的方法算,16 次全对的 95% 置信区间下限大约在 80% 左右。真正的评测在 Day 127:100 个场景全跑、每个跑多次算 pass^k、加上会说错话的模拟客户。还有一处我注意到了但今天没处理:S023(重复开票)的结论里 `invoice_ids` 写了原发票和重复的那张两个号,标准答案只有重复的那张。今天的「命中」只比根因和金额,Day 127 要决定发票号怎么算对。

## 动手练习

1. 写 `llm.py`、`mcp_bridge.py`、`evidence.py`、`graph.py`、`run.py` 和 `tests/test_graph.py`,`uv run pytest -q` 全部通过。
2. 挑 5 个场景跑一遍:`uv run python -m billsleuth.run S001 S002 S011 S017 S023`。记下每个场景的工具调用顺序,看看和你自己查账的顺序有什么不同。
3. 打开审计日志,确认能按会话追溯 Agent 查过什么:在 `build_graph` 之前设置 `os.environ["BILLSLEUTH_SESSION"] = "S011-run1"`,跑完以后 `SELECT tool, args_json FROM audit_log WHERE session_id = 'S011-run1'`。
4. **对比实验**:按昨天练习 4 的方法,把 `recompute_invoice` 的 `difference` 和 `by_kind` 去掉,再跑同样 5 个场景,对比命中数、模型调用次数和花费。把结果记在一张小表里,Day 128 讨论工具设计时会用到。
5. **去掉 locate**:把 `locate` 节点改成只把客户原话交给模型,不给发票列表和候选,对比步数和花费。

**验收标准**:220 个测试全绿;至少 5 个真实场景跑通并打印出完整的工具调用路径;能用审计日志按会话还原一次调查;练习 4 和 5 至少做一个,并能用数字说明那一段设计带来的差别。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| workflow + agent 混合 | 确定的步骤写成固定节点,只在需要判断的地方放开式循环 |
| intake | 读懂请求的第一步,这里用结构化输出抽抱怨类型、金额、月份 |
| 伪工具 pseudo tool | 不对应真实操作、只用来让模型交出结构化结果的工具,这里是 SubmitFindings |
| 证据链 evidence | 由代码从工具结果抽取并编号的事实清单,回答里的数字必须出自这里 |
| nudge | 模型没按要求交卷时追加一次提醒 |
| 转人工 escalate | 结论缺失或格式不合格时,不猜测,交给人处理 |
| in-process MCP | 把 server 对象直接交给 Client,同进程内走完整协议,测试和评测用 |
| SecretStr | pydantic 的敏感字符串类型,打印时显示星号 |

## 常见误区

**一个大循环从头跑到尾最灵活。** 灵活的代价是每次都要模型重新做那些不需要判断的步骤,花钱、变慢、不可测。能写死的步骤就写死。

**让模型最后用一段文字总结结论,再用正则解析。** 文字结论没法可靠解析,金额格式、根因名称都会飘。让模型通过工具调用交结构化结论,用 schema 校验。

**结论格式不对就让模型重试到对为止。** 计费场景里,反复重试可能得到一个格式正确但内容是瞎猜的结论。格式不合格说明这次调查有问题,转人工更安全。

**工具层做了权限检查,编排层就不用管了。** 工具层不知道「这次调查是哪个客户」。发票号必须来自本客户列表这种检查,只有编排层能做。

**真模型跑几个场景全对,就说准确率 100%。** 样本小、非随机、题目可能偏简单。要报置信区间,要用完整评测集,要多次运行。

**评测时也用 stdio 起子进程。** 每次工具调用几百毫秒的开销,一百个场景乘以十几次调用就是十几分钟。评测用 in-process,部署再换成远程。

## 学习资料

### 文档与文章

- [LangGraph · Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api):State、reducer、条件边的官方说明,复习用,20 分钟。
- [LangGraph · Thinking in LangGraph](https://docs.langchain.com/oss/python/langgraph/thinking-in-langgraph):官方讲怎么把一个业务流程拆成节点,和今天「拆段」的思路一致,20 分钟。
- [LangChain · Structured output](https://docs.langchain.com/oss/python/langchain/structured-output):`with_structured_output` 的几种 method 和它们的差别,15 分钟。
- [Anthropic · Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):workflow 和 agent 的区分,以及什么时候该用哪种,重读一遍,20 分钟。
- [τ-bench 论文](https://arxiv.org/abs/2406.12045):看它怎么定义「任务成功」(数据库最终状态和标准答案一致),对照我们怎么定义「命中」,30 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1HVFLzfEeS&autoplay=0&high_quality=1" title="挑战19分钟搞定,LangGraph快速入门与原理剖析" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>敲代码的码农 · 挑战19分钟搞定,LangGraph快速入门与原理剖析 · 19 分钟,快速复习 State、节点、条件边,忘了 LangGraph 基本概念的先看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1z3NY66EY1&autoplay=0&high_quality=1" title="尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>尚硅谷 · 尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战 · Day 24 推荐过的长教程,今天挑讲结构化输出和工具调用的几集看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/aHCDrAbH_go" title="Building Effective Agents with LangGraph" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Building Effective Agents with LangGraph · 32 分钟,官方把 workflow 和 agent 的几种模式在 LangGraph 里逐个实现,看 routing 和 evaluator-optimizer 两段。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 6 章 Agents 部分讲规划和工具调用的失败模式(选错工具、参数错、目标没达成),对照我们的三道防线读。
- John Berryman、Albert Ziegler《Prompt Engineering for LLMs》(O'Reilly, 2024):第 8 章 Conversational Agency,讲工具调用时提示词怎么组织,和我们「写查账的方法而不是写答案」的系统提示词思路接近。
- 黄佳《大模型应用开发 动手做AI Agent》(人民邮电出版社, 2024):中文书,看讲 Agent 工作流编排的项目章节,对比它和我们的拆段方式。

### 开源项目与代码

- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):看 `examples` 目录里的多步骤 Agent 示例,对比它们怎么处理「何时结束」。
- [sierra-research/tau-bench](https://github.com/sierra-research/tau-bench):看它的 agent 实现里怎么组织系统提示词和工具,以及怎么判断一次任务结束。
- [modelcontextprotocol/python-sdk](https://github.com/modelcontextprotocol/python-sdk):想把 in-process 和 stdio 两种连接方式看得更透,看 `Client` 的构造逻辑。

## 自测

1. 调查流程里哪些节点调模型、哪些只跑代码?为什么 locate 不交给模型?

<details><summary>答案</summary>

intake 和 investigate 调模型,locate、tools、nudge、conclude 只跑代码(tools 调的是 MCP 工具,不是模型)。locate 是在发票列表里按金额和月份找对应发票,确定性的查找用代码做更便宜、更稳定、能单元测试;交给模型反而可能看漏或看错,还每次都要花一轮推理。

</details>

2. 为什么用 `SubmitFindings` 伪工具交结论,而不是循环结束后再调一次 `with_structured_output`?

<details><summary>答案</summary>

伪工具让模型自己决定什么时候证据够了,交卷和查账在同一个上下文里,不需要额外一轮总结;路由只要看最后一条消息有没有这个工具调用就知道该结束。事后再结构化一次,要多花一次模型调用,而且总结的模型可能和查账时的理解不一致。

</details>

3. 「发票号必须来自 list_invoices 的结果」这条检查为什么要放在编排层,而不是 MCP 工具里?

<details><summary>答案</summary>

MCP 工具不知道这次调查是哪个客户,它只看到一个发票号;同一个 server 可能被多个调查、多个客户共用。只有编排层持有「本次调查的客户」和「这个客户有哪些发票」这两条信息,才能判断一个发票号是不是编造的或越权的。

</details>

4. 为什么证据由代码抽取,而不是让模型在回答里自己写出处?

<details><summary>答案</summary>

模型抄数字会抄错,而且你没法自动检查它抄得对不对。代码抽取是确定的,每条证据的值就是工具返回的原始字符串,有编号、有来源。这样后面才能用程序把回答里的每个数字和证据逐一比对。

</details>

5. 16 个场景全部命中,能说明什么、不能说明什么?

<details><summary>答案</summary>

能说明流程是通的,每类根因都至少能被查出一次。不能说明准确率:样本只有 16 个而且是挑的不是随机抽的;复算工具很强,题目偏简单;每个场景只跑了一两次,不知道稳定性。16 次全对的 95% 置信区间下限大约 80%,真实准确率可能比这低不少。要用完整的 100 个场景、多次运行、加上模拟客户来评测。

</details>

6. 资深面试题:你的调查 Agent 平均每个场景 4 到 6 次模型调用、十几次工具调用,产品经理说太慢了,要求 5 秒内出结果。你怎么分析和优化?

<details><summary>答案</summary>

先拆时间:用 trace 看墙钟时间花在哪,模型调用、工具调用、排队重试各占多少。然后从三个方向优化。一是减少轮数:把确定的步骤从模型手里拿走(比如 locate 已经做了),把常用的组合查询合并成一个工具(比如复算时顺带返回扣款记录和订阅事件),鼓励并行工具调用。二是降低每轮的延迟:换更快的模型或者用小模型做 intake,系统提示词前缀保持稳定以命中缓存,工具层用常驻连接而不是每次起进程。三是改变交互方式:先秒回一个「正在核对」并流式展示进度,把完整结论放在后台完成。最后用评测集确认优化没有降低准确率,特别是误冲正率,快但错的计费 Agent 比慢更糟。

</details>

## 明天预告

明天(Day 125)让 Agent 把结论写成两份解释:给客户看的大白话版本,和给同事看的带证据编号的内部版本。我们会写一个数字溯源校验器,检查回答里的每个金额和百分比能不能在证据链里找到出处,找不到就把问题清单交回模型重写,三次不行就用模板兜底。这一天你会看到校验器第一版太严、误伤了合法内容的真实案例。
