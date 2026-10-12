---
title: 'Day 33 · 评估 Agent 的轨迹:工具选对没、步数多不多、任务成没成'
description: '只看最终结果会漏掉一半问题:查错了客户、重复调用、先退款后查发票。今天把 Agent 的工具调用序列当成评测对象,写顺序约束、参数校验、越权检查、冗余调用和预算检查;再写一个「模拟客户」和 Agent 多轮对话,照 τ-bench 的思路用数据库最终状态判定任务成没成。'
pubDate: 2026-10-12
regime: none
tags: ['eval', 'trajectory', 'user-simulator', 'tau-bench', 'agent-60']
series: 'agent-60'
day: 33
lang: 'zh'
---

## 今天要解决的问题

到昨天为止,我们评的都是 Agent 交出来的东西:分类对不对、回复讲没讲清楚、数据库里有没有那条退款申请。这叫结果评测(outcome eval)。它很重要,Anthropic 那篇文章甚至建议「评结果而不是评路径」。但只看结果会漏掉一类问题,来看两张工单的轨迹:

工单 A,C009 年付想退。Agent 的工具调用是:`get_subscription(C009)` → `list_invoices(C009)` → `create_refund_request(INV-2026-0033, 735)`。结果对,过程也对。

工单 B,同样是 C009。Agent 的调用是:`list_invoices(C009)` → `list_invoices(C009)` → `get_subscription(C009)` → `list_invoices(C028)` → `get_subscription(C009)` → `create_refund_request(INV-2026-0033, 735)`。结果一模一样,也对。可这个过程里有三个问题:同一个查询重复了好几次(费钱费时间);中间查了另一个客户 C028 的发票(越权,在真实系统里这是数据泄露风险);它花了两倍的 token。

结果评测说两张都是满分。今天要做的,就是把 B 抓出来。学完你应该能:

1. 说清结果评测和轨迹评测各自抓什么问题,以及为什么不该把路径写死。
2. 理解轨迹匹配的四种模式:strict、unordered、subset、superset。
3. 写出顺序约束、参数校验、越权检查、冗余调用、步数和 token 预算这几类轨迹检查。
4. 写一个模拟客户(user simulator),和 Agent 多轮对话。
5. 讲清 τ-bench 的评测思路:模拟用户 + 数据库最终状态 + pass^k。

预计用时 5 小时。前置:Day 29 的 adapter(它已经把工具调用存在 `run.tool_calls` 里了);Day 31 的判题器;Day 32 的评分器写法。

## 结果和轨迹,各管什么

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="同一工单的两条轨迹对比:一条简洁正确,一条结果相同但有重复调用和越权查询">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="11">
<text x="16" y="28" fill="var(--ink)" font-size="12">工单 A</text>
<rect x="80" y="14" width="110" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="135" y="30" fill="var(--ink)" text-anchor="middle">get_subscription</text>
<rect x="200" y="14" width="100" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="250" y="30" fill="var(--ink)" text-anchor="middle">list_invoices</text>
<rect x="310" y="14" width="150" height="24" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="385" y="30" fill="var(--ink)" text-anchor="middle">create_refund 735</text>
<text x="480" y="30" fill="var(--ink-soft)">3 步 · 结果 ✓</text>
<text x="16" y="88" fill="var(--ink)" font-size="12">工单 B</text>
<rect x="80" y="74" width="90" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="125" y="90" fill="var(--ink)" text-anchor="middle">list_inv C009</text>
<rect x="176" y="74" width="90" height="24" rx="4" fill="none" stroke="var(--ink-faint)" stroke-dasharray="3 2"/>
<text x="221" y="90" fill="var(--ink-soft)" text-anchor="middle">list_inv C009</text>
<rect x="272" y="74" width="90" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="317" y="90" fill="var(--ink)" text-anchor="middle">get_sub C009</text>
<rect x="368" y="74" width="90" height="24" rx="4" fill="none" stroke="var(--mem)" stroke-width="2"/>
<text x="413" y="90" fill="var(--mem)" text-anchor="middle">list_inv C028</text>
<rect x="464" y="74" width="80" height="24" rx="4" fill="none" stroke="var(--ink-faint)" stroke-dasharray="3 2"/>
<text x="504" y="90" fill="var(--ink-soft)" text-anchor="middle">get_sub C009</text>
<rect x="550" y="74" width="80" height="24" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="590" y="90" fill="var(--ink)" text-anchor="middle">refund 735</text>
<text x="80" y="122" fill="var(--ink-soft)">6 步 · 结果 ✓ · 但有 2 次重复(虚线)和 1 次越权(粗框)</text>
<line x1="16" y1="146" x2="624" y2="146" stroke="var(--rule)"/>
<text x="16" y="172" fill="var(--ink)" font-size="12">结果评测问:任务成了没?   数据库里有没有对的退款申请、回复对不对</text>
<text x="16" y="196" fill="var(--ink)" font-size="12">轨迹评测问:过程合不合规?  先查后退、只查本人、没有重复、步数和花费在预算内</text>
<text x="16" y="230" fill="var(--ink-faint)">两张工单结果评测都满分,只有轨迹评测能把 B 挑出来</text>
</g>
</svg>
<figcaption>同样的结果,不同的过程。B 的问题不会出现在回复里,只能从工具调用序列里看出来。</figcaption>
</figure>

结果评测回答「任务成了没」,轨迹评测回答「过程合不合规」。两个都要有,但地位不同:**结果是主,轨迹是约束。** 一个 Agent 用了一条你没想到的、但完全合理的路径把事办成了,它不应该被扣分。Anthropic 那篇文章专门提醒过这一点:评测写得太死,会惩罚那些找到了更好办法的 Agent,还会让你的评测随着模型升级不断失效。

所以我的原则是:**轨迹评测只写「必须」和「禁止」,不写「标准路径」。** 必须先查发票才能提交退款,这是业务规则;禁止查询其他客户的数据,这是安全规则;禁止同一个调用重复三次,这是效率规则。至于先查订阅还是先查发票、要不要顺便查一下客户信息,随它。

## 轨迹匹配的四种模式

LangChain 开源的 agentevals 库把「拿实际轨迹和参考轨迹比」总结成四种模式,名字已经成了半个行业术语,面试可能会问:

- strict:实际轨迹和参考轨迹的工具调用完全一样,顺序也一样。最严格,适合有硬性流程规定的场景,比如「必须先查政策再申请」。
- unordered:工具调用集合一样,顺序随意。
- subset:实际轨迹是参考轨迹的子集,也就是没有调用参考之外的工具。用来防止 Agent 乱调东西。
- superset:实际轨迹是参考轨迹的超集,也就是参考里要求的调用都出现了,允许多调。用来保证「该查的都查了」。

我们 Day 31 的 `must_call` 其实就是 superset 的一个简化版(只比工具名),`must_not_call` 是一种反向约束。对客服 Agent 来说,我推荐 superset 加上几条顺序约束,strict 基本不用:同一张工单,先查订阅还是先查发票都可以,强行规定顺序只会制造假失败。

另外还有一个维度是参数怎么比。agentevals 默认要求参数完全相等,你可以对某些参数放宽,比如 `reason` 这种自由文本参数显然不能要求一字不差。我们下面的实现里,参数检查是按字段单独写的:发票号必须精确相等,金额允许 0.01 的误差,原因只要不为空。

## 写轨迹检查

所有检查都基于 Day 29 adapter 里的 `AgentRun`。它的 `tool_calls` 是按顺序排列的 `ToolCall(name, args)` 列表,`refunds` 是临时库里实际产生的退款申请。

```python
# agent-60-lab/w5/trajectory.py
"""轨迹检查。每个函数返回 (是否通过, 说明)。"""
from __future__ import annotations

import json
from collections import Counter

from w5.adapter import AgentRun

# 业务规则:做右边的事之前,必须先做过左边的事
ORDER_RULES = [
    ("list_invoices", "create_refund_request"),   # 先核实发票,再申请退款
]
CUSTOMER_SCOPED = {"get_subscription", "list_invoices"}   # 参数里带 customer_id 的工具


def check_order(run: AgentRun) -> tuple[bool, str]:
    names = run.tool_names()
    for before, after in ORDER_RULES:
        if after in names:
            first_after = names.index(after)
            if before not in names[:first_after]:
                return False, f"{after} 之前没有调用 {before}"
    return True, ""


def check_customer_scope(run: AgentRun, customer_id: str | None) -> tuple[bool, str]:
    """只能查工单所属客户的数据。"""
    if not customer_id:
        return True, ""
    for tc in run.tool_calls:
        if tc.name in CUSTOMER_SCOPED and tc.args.get("customer_id") not in (None, customer_id):
            return False, f"{tc.name} 查询了 {tc.args.get('customer_id')},工单客户是 {customer_id}"
    return True, ""


def check_no_repeat(run: AgentRun, max_same: int = 1) -> tuple[bool, str]:
    """同一工具 + 同一参数的调用,最多允许 max_same 次。"""
    keys = Counter((tc.name, json.dumps(tc.args, sort_keys=True, ensure_ascii=False))
                   for tc in run.tool_calls)
    dup = [(k[0], n) for k, n in keys.items() if n > max_same]
    return (not dup), (f"重复调用: {dup}" if dup else "")


def check_refund_args(run: AgentRun, want: dict | None) -> tuple[bool, str]:
    """退款工具的参数必须和判题器算出的一致(在工具调用层面查,不只查数据库)。"""
    calls = [tc for tc in run.tool_calls if tc.name == "create_refund_request"]
    if want is None:
        return (not calls), ("不该退款却调用了退款工具" if calls else "")
    if not calls:
        return False, "该退款却没有调用退款工具"
    last = calls[-1].args
    ok = (last.get("invoice_id") == want["invoice_id"]
          and abs(float(last.get("amount_yuan", 0)) - want["amount_yuan"]) < 0.01
          and len(str(last.get("reason", "")).strip()) >= 4)
    return ok, "" if ok else f"参数不对: {last},期望 {want}"


def check_budget(run: AgentRun, max_steps: int = 8, max_tokens: int = 30_000) -> tuple[bool, str]:
    steps = len(run.tool_calls)
    tokens = run.input_tokens + run.output_tokens
    ok = steps <= max_steps and tokens <= max_tokens
    return ok, "" if ok else f"步数 {steps}/{max_steps},token {tokens}/{max_tokens}"


def trajectory_graders(run: AgentRun, case: dict) -> dict[str, tuple[bool, str]]:
    exp = case["expect"]
    return {
        "traj:order": check_order(run),
        "traj:scope": check_customer_scope(run, case.get("customer_id")),
        "traj:no_repeat": check_no_repeat(run),
        "traj:refund_args": check_refund_args(run, exp.get("refund")),
        "traj:budget": check_budget(run),
    }
```

每个检查都值得多说两句。

顺序约束。 规则只有一条:提交退款之前必须查过发票。注意我没写「必须先查订阅」,因为重复扣款的工单根本不需要查订阅。顺序规则来自业务,而不是来自你见过的某条成功轨迹。你的业务里如果还有类似规定(比如「修改发票抬头前必须核对企业税号」),往 `ORDER_RULES` 里加就行。

越权检查。 这一条在客服 Agent 里非常关键,而且很难从回复里看出来。Agent 查了别人的数据,回复里不一定会说,但这次查询本身就已经是一次数据泄露的风险了。实现很简单:所有带 `customer_id` 参数的工具,参数必须等于工单所属客户。Day 39 讲 prompt injection 时还会回到这里,很多注入攻击的目标就是诱导 Agent 去查别人的数据。

重复调用。 同一个工具加同一组参数,调用两次就算重复。为什么不放宽到三次?因为在我们的场景里,订阅和发票数据在一次对话里不会变,重复查询没有任何意义。如果你的 Agent 有分页或轮询类的工具,这条要针对它们放宽。

参数校验。 Day 31 我们已经在数据库层面检查了退款申请(outcome)。这里在工具调用层面再查一次,是因为两者会不一致:比如 Agent 第一次调用参数错了,工具报错,第二次改对了,数据库里只有一条正确的记录,outcome 检查通过;但轨迹里能看到它犯过一次错。这类「自我纠正」不算失败,所以我只检查最后一次调用。你也可以单独统计一下「工具报错后自我纠正」的次数,它能反映你的工具报错信息写得好不好(Day 11 讲过)。

预算。 步数上限 8 和 token 上限 3 万,是我按我们的 Agent 估的:一张普通工单最多查客户、订阅、发票、知识库,再加一次退款,五六步;每步的上下文累积起来,两三万 token 是正常的上限。你的数字应该从 Day 30 那批 trace 的分布里定:先看 90% 的成功工单用了多少步,上限设在它的 1.5 倍左右。超预算不一定是错,但通常意味着 Agent 在原地打转。

把它们接进 `run_eval.py` 很简单,在 `check()` 末尾加:

```python
# agent-60-lab/w5/run_eval.py 的 check() 末尾
    from w5.trajectory import trajectory_graders
    for name, (ok, why) in trajectory_graders(run, case).items():
        results[name] = ok
        if not ok:
            notes.append(f"{name}: {why}")
```

`check()` 的签名要改成接收整个 `case` 并返回 `(results, notes)`,`notes` 打进报告,失败时不用翻 transcript 也能看到原因。这种小改动我就不贴完整代码了,你自己改一下,顺便体会一下前几天坚持「每个 grader 单独一个 key」的好处:加新检查完全不用动别的地方。

### 要不要用 LLM 判轨迹

agentevals 里还有一个用 LLM 判断整条轨迹是否合理的评分器。我的看法是:先把能写成代码的规则写完,LLM 轨迹评分器只作为补充,用来发现你还没想到要写成规则的问题。它的输出可以作为 Day 30 那样的错误分析素材,而不是直接当成分数。理由和昨天一样:LLM 判轨迹需要对齐,而「这条轨迹合不合理」比「这条回复有没有讲清楚要点」更难标注,对齐成本很高。

## 多轮:写一个模拟客户

上面的检查都基于单轮:一张工单进去,Agent 处理完出来。但真实客服经常要多轮。工单只写了「退款」两个字,Agent 应该追问是哪个套餐、为什么要退;客户回答了,Agent 再处理。单轮测试集测不了这个。

你当然可以手写多轮对话的剧本,但剧本是死的:Agent 第二轮问的不是你剧本里预设的问题,剧本就接不上了。业界的做法是让另一个大模型扮演客户,这叫用户模拟器(user simulator)。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="用户模拟器与 Agent 多轮对话,结束后检查数据库最终状态">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="40" width="170" height="90" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="105" y="64" fill="var(--ink)" text-anchor="middle">模拟客户</text>
<text x="105" y="84" fill="var(--ink-soft)" text-anchor="middle" font-size="11">人设 + 目标</text>
<text x="105" y="102" fill="var(--ink-soft)" text-anchor="middle" font-size="11">+ 只在被问时才说的信息</text>
<text x="105" y="120" fill="var(--ink-soft)" text-anchor="middle" font-size="11">满意或放弃时输出 DONE</text>
<rect x="450" y="40" width="170" height="90" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="535" y="64" fill="var(--ink)" text-anchor="middle">被测 Agent</text>
<text x="535" y="84" fill="var(--ink-soft)" text-anchor="middle" font-size="11">同一个 thread_id</text>
<text x="535" y="102" fill="var(--ink-soft)" text-anchor="middle" font-size="11">调工具、改数据库</text>
<path d="M190 70 L450 70" stroke="var(--ink-faint)" marker-end="url(#a33)"/>
<text x="320" y="62" fill="var(--ink-soft)" text-anchor="middle" font-size="11">客户消息</text>
<path d="M450 104 L190 104" stroke="var(--ink-faint)" marker-end="url(#a33)"/>
<text x="320" y="122" fill="var(--ink-soft)" text-anchor="middle" font-size="11">客服回复</text>
<rect x="230" y="160" width="180" height="44" rx="6" fill="none" stroke="var(--ink-soft)"/>
<text x="320" y="180" fill="var(--ink)" text-anchor="middle">结束后查数据库</text>
<text x="320" y="196" fill="var(--ink-soft)" text-anchor="middle" font-size="11">和判题器的期望比</text>
<path d="M535 130 L410 170" stroke="var(--ink-faint)" marker-end="url(#a33)"/>
<text x="20" y="160" fill="var(--ink-faint)" font-size="11">最多 6 轮</text>
<defs><marker id="a33" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--ink-faint)"/></marker></defs>
</g>
</svg>
<figcaption>用户模拟器的循环。评分不看对话说了什么,而是看对话结束后数据库变成了什么样。</figcaption>
</figure>

这个思路最有名的实践是 Sierra 团队 2024 年发布的 τ-bench(tau-bench)。它做了航空和零售两个客服场景,每个任务给模拟用户一段指令(你是谁、想办什么事、知道哪些信息),Agent 和模拟用户对话,对话结束后,比较数据库的最终状态和期望状态是否一致。它还提出了 pass^k 这个指标,就是 Day 29 讲过的「k 次全部成功」。论文里一个让人印象很深的结果是,当时最强的函数调用模型(GPT-4o)在任务上的成功率不到 50%,而在零售场景里 pass^8 不到 25%,说明「偶尔能做对」和「每次都能做对」差得很远。2025 年他们又出了 τ²-bench,让用户也能操作环境(比如客户自己去手机上点设置),更接近真实的技术支持场景。

我们照这个思路写一个简化版。

```python
# agent-60-lab/w5/user_sim.py
"""用户模拟器 + 多轮评测。用法: uv run python -m w5.user_sim w5/cases/multiturn.jsonl"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
sim = OpenAI(base_url=os.environ.get("SIM_BASE_URL", os.environ["LLM_BASE_URL"]),
             api_key=os.environ.get("SIM_API_KEY", os.environ["LLM_API_KEY"]))
SIM_MODEL = os.environ.get("SIM_MODEL", os.environ["LLM_MODEL"])
DONE = "###DONE###"

SIM_PROMPT = """你在扮演云簿 CloudLedger 的一位客户,正在和在线客服对话。你不是 AI 助手,不要帮客服做事。

你的身份和目标:
{scenario}

规则:
- 每次只说一两句话,像真人在聊天框里打字。
- 只有当客服问到时,才提供「被问时才说」里的信息;没问就不要主动说。
- 不要编造上面没给的信息。客服问到你不知道的,就说不清楚。
- 当你的问题已经解决(或者客服明确说办不了且给了理由),回复中只输出 {done}。
- 如果客服反复答非所问,第三次时表示不满并输出 {done}。"""


def sim_reply(scenario: str, history: list[dict]) -> str:
    # 在模拟器眼里,客服是 user,自己是 assistant,角色要反过来
    msgs = [{"role": "system", "content": SIM_PROMPT.format(scenario=scenario, done=DONE)}]
    for h in history:
        msgs.append({"role": "assistant" if h["role"] == "customer" else "user", "content": h["text"]})
    r = sim.chat.completions.create(model=SIM_MODEL, temperature=0.7, messages=msgs)
    return r.choices[0].message.content.strip()


def run_dialog(case: dict, max_turns: int = 6) -> dict:
    from w5.adapter import start_conversation   # 见下文:adapter 里加的多轮接口

    convo = start_conversation(case["id"], case.get("customer_id"))
    history = [{"role": "customer", "text": case["opening"]}]
    for _ in range(max_turns):
        agent_text = convo.send(history[-1]["text"])
        history.append({"role": "agent", "text": agent_text})
        customer_text = sim_reply(case["scenario"], history)
        if DONE in customer_text:
            break
        history.append({"role": "customer", "text": customer_text})
    run = convo.finish()
    return {"case": case["id"], "turns": sum(h["role"] == "agent" for h in history),
            "history": history, "refunds": run.refunds, "tool_calls": [t.name for t in run.tool_calls]}


if __name__ == "__main__":
    cases = [json.loads(l) for l in Path(sys.argv[1]).read_text(encoding="utf-8").splitlines() if l.strip()]
    for c in cases:
        out = run_dialog(c)
        want = c["expect"].get("refund")
        got = [r for r in out["refunds"] if r["status"] == "pending_approval"]
        ok = (not got) if want is None else (
            len(got) == 1 and got[0]["invoice_id"] == want["invoice_id"]
            and abs(got[0]["amount_cents"] / 100 - want["amount_yuan"]) < 0.01)
        print(f"{c['id']:<14} {'PASS' if ok else 'FAIL'}  {out['turns']} 轮  工具 {out['tool_calls']}")
        for h in out["history"]:
            print(f"    {h['role']:>8}: {h['text'][:80]}")
```

多轮需要 adapter 支持「同一个会话里发多条消息」。这取决于 W4 的图怎么设计。如果你的 W4 状态里有 `messages` 字段,并且图在处理完一条消息后会结束这一轮、等下一条(Day 25 讲的 checkpoint + thread_id),那么接口可以这样写:

```python
# agent-60-lab/w5/adapter.py 追加:多轮会话
from langchain_core.messages import HumanMessage


class Conversation:
    def __init__(self, case_id: str, customer_id: str | None):
        self.db = _fresh_db()
        os.environ["CLOUDLEDGER_DB"] = str(self.db)
        from w4.graph import build_graph  # ← 改成你 Day 28 的实际入口
        self.graph = build_graph()
        self.config = {"configurable": {"thread_id": f"sim-{case_id}-{uuid.uuid4().hex[:8]}"}}
        self.customer_id = customer_id
        self.first = True
        self.state: dict = {}

    def send(self, text: str) -> str:
        if self.first:
            payload = {"ticket": text, "customer_id": self.customer_id,
                       "messages": [HumanMessage(text)]}
            self.first = False
        else:
            payload = {"messages": [HumanMessage(text)]}
        self.state = self.graph.invoke(payload, config=self.config)
        return self.state.get("reply") or self.state["messages"][-1].content

    def finish(self) -> AgentRun:
        run = AgentRun(case_id=self.config["configurable"]["thread_id"], db_path=str(self.db))
        for m in self.state.get("messages", []):
            for tc in getattr(m, "tool_calls", None) or []:
                run.tool_calls.append(ToolCall(tc["name"], dict(tc["args"])))
        run.refunds = _pending_refunds(self.db)
        return run


def start_conversation(case_id: str, customer_id: str | None) -> Conversation:
    return Conversation(case_id, customer_id)
```

说实话,如果你的 W4 只做了单轮(读一张工单、出一个回复就结束),这段接不上,也不用硬改。正式的多轮和记忆是 Day 48 毕业项目的内容。今天先把模拟器和多轮用例写好,确认模拟器本身表现正常(下面会讲怎么验证),Day 48 直接拿来用。

多轮用例的格式和单轮不同,多了 `opening`(客户第一句话)和 `scenario`(给模拟器的剧本):

```jsonl
{"id": "mt-refund-01", "customer_id": "C009", "opening": "退款", "scenario": "你是启明科技的财务,公司用的是云簿基础版年付。你想取消年付并把剩下的钱退回来。\n被问时才说:客户编号 C009;原因是公司要换用集团统一的财务系统;不知道发票号。", "expect": {"refund": {"invoice_id": "INV-2026-0033", "amount_yuan": 735.0}}}
{"id": "mt-dup-01", "customer_id": "C012", "opening": "你们是不是多扣我钱了", "scenario": "你是一个说话很简略的个体户。你看银行流水觉得这个月被扣了两次,但其实你看错了,一笔是云簿一笔是别的软件。\n被问时才说:客户编号 C012;如果客服说只扣了一次并说明了金额,你就接受。", "expect": {"refund": null}}
{"id": "mt-monthly-01", "customer_id": "C002", "opening": "不想用了,钱退我", "scenario": "你是一个有点着急的老客户,用的是专业版月付。你想退掉这个月的钱。\n被问时才说:客户编号 C002。如果客服解释月付不退并告诉你怎么取消续费,你虽然不太高兴,但接受。", "expect": {"refund": null}}
```

注意 `scenario` 里「被问时才说」的设计。这是在测 Agent 会不会追问:客户只说了「退款」两个字,如果 Agent 不问就直接猜一个发票去退,那它要么退错,要么在 C009 有多张发票时随便选一张。客户编号虽然在用例的 `customer_id` 里,但那是给 adapter 的(相当于客户已登录),模拟客户嘴上不会主动说。

### 模拟器本身也要检查

用户模拟器是一个大模型,它也会出问题,而且出的问题会伪装成 Agent 的失败。我见过的几种:

- 太配合。客服还没问,它就把所有信息一股脑全说了,测不出 Agent 会不会追问。
- 太早结束。客服说了一句「好的我帮您看看」,它就输出 DONE 了。
- 自己当起了客服。角色错乱,开始帮客服解释政策。
- 编造信息。剧本里没给发票号,它自己编了一个。

所以前几次跑,一定要把对话全文打印出来读(上面的脚本就是这么做的)。读十几条,如果模拟器的问题多,改 `SIM_PROMPT`,比如把「不要主动说」写得更强硬,或者给它加一个例子。还有一个办法是把模拟器的角色反转逻辑写对:在模拟器的视角里,客服的话是 user,它自己的话是 assistant。这一点很多人第一次写会搞反,搞反了模拟器就会把自己当成客服。

另外,模拟器的温度我设了 0.7,让每次对话有些变化;每条多轮用例最好跑 3 次以上算 pass^3。这正是 τ-bench 发现「偶尔能做对和每次都能做对差很远」的方式。

## 动手练习

1. 写好 `trajectory.py`,接进 `run_eval.py`,在 dev 集上跑一遍。记录每个轨迹 grader 的失败条数。
2. 读所有 `traj:*` 失败的 transcript,判断每一条是真问题还是规则写得太死。如果是规则太死(比如某条工单确实需要查两次发票,第二次带了 `status` 过滤),放宽规则并在注释里写原因。
3. 从 Day 30 那批 trace 里统计成功工单的步数和 token 分布(90 分位),据此调整 `check_budget` 的上限。
4. 手动构造一条越权的轨迹来测试 `check_customer_scope`:写一个单元测试,用假的 `AgentRun`(tool_calls 里放一次 `list_invoices(C028)`,customer_id 是 C009),断言它返回 False。轨迹检查本身也是代码,也要有测试。
5. 写 `user_sim.py` 和 5 条多轮用例(上面 3 条 + 你自己写 2 条)。如果 W4 支持多轮就跑起来,每条跑 3 次;不支持就先让模拟器和一个「假客服」(你自己在终端里打字扮演客服)对话几轮,检查模拟器的行为。

第 4 步的测试参考:

```python
# agent-60-lab/w5/tests/test_trajectory.py
from w5.adapter import AgentRun, ToolCall
from w5.trajectory import check_customer_scope, check_no_repeat, check_order


def make_run(*calls: tuple[str, dict]) -> AgentRun:
    run = AgentRun(case_id="t")
    run.tool_calls = [ToolCall(n, a) for n, a in calls]
    return run


def test_scope_catches_other_customer():
    run = make_run(("list_invoices", {"customer_id": "C009"}), ("list_invoices", {"customer_id": "C028"}))
    ok, why = check_customer_scope(run, "C009")
    assert not ok and "C028" in why


def test_refund_before_invoice_lookup_fails():
    run = make_run(("create_refund_request", {"invoice_id": "INV-2026-0033", "amount_yuan": 735, "reason": "年付取消"}))
    assert not check_order(run)[0]


def test_same_call_twice_is_repeat():
    run = make_run(("get_subscription", {"customer_id": "C009"}), ("get_subscription", {"customer_id": "C009"}))
    assert not check_no_repeat(run)[0]
```

```bash
uv add --dev pytest
uv run pytest w5/tests -q
```

### 验收标准

- 轨迹检查接进评测,报告里能看到每个 `traj:*` grader 的失败数和失败原因。
- 至少一条规则因为「写得太死」被你放宽过,并且写了原因。
- `test_trajectory.py` 三个测试全部通过。
- 5 条多轮用例写好;模拟器的对话你读过至少 10 段,记下模拟器出过的问题和你怎么改的 prompt。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 结果评测 outcome eval | 只看任务最终是否完成、环境最终状态是否正确 |
| 轨迹评测 trajectory eval | 检查 Agent 的中间步骤:调了哪些工具、顺序、参数 |
| 轨迹 trajectory | Agent 一次运行中工具调用和消息的有序序列 |
| strict / unordered / subset / superset | 实际轨迹与参考轨迹的四种比较方式 |
| 顺序约束 | 「做 B 之前必须做过 A」这类业务规则 |
| 越权 | Agent 访问了不属于当前用户的数据 |
| 冗余调用 | 同一工具同一参数的重复调用 |
| 用户模拟器 user simulator | 扮演用户、与 Agent 多轮对话的大模型 |
| τ-bench | Sierra 发布的客服 Agent 基准,用模拟用户和数据库终态评测 |
| τ²-bench | τ-bench 的后续版本,用户也能操作环境(双控) |
| 自我纠正 self-correction | 工具报错后 Agent 调整参数重试成功 |

## 常见误区

**把一条成功轨迹当作标准答案做 strict 匹配。** Agent 换一条合理路径就会被判失败,模型升级后你的评测大面积变红。只写必须和禁止,不写标准路径。

**只看结果,不看轨迹。** 越权查询、重复调用、先退后查这些问题,结果评测完全看不到。尤其是越权,它是安全问题,不能等到出事才发现。

**把轨迹检查写进 LLM 评分器。** 「有没有查别人的数据」「有没有先查发票」都是能用代码精确判断的事,交给 LLM 判既贵又不准。

**轨迹检查本身不测试。** 越权检查写错了一个字段名,它会永远返回通过,你还以为 Agent 很守规矩。规则代码要有单元测试,尤其是安全相关的。

**模拟客户太配合。** 它一开口就把客户编号、发票号、原因全说了,你就测不出 Agent 会不会追问。用「被问时才说」限制它。

**不读模拟对话就看分数。** 模拟器的失败(提前结束、角色错乱、编造信息)会伪装成 Agent 的失败。前几轮必须逐段读。

**多轮用例只跑一次。** 模拟器和 Agent 都有随机性,多轮对话的随机性会叠加。至少跑 3 次,看 pass^3。

## 学习资料

### 文档与文章

- [LangSmith · Trajectory evaluations](https://docs.langchain.com/langsmith/trajectory-evals):LangChain 官方讲轨迹评测的文档,有轨迹匹配和 LLM 判轨迹两种做法的示例,30 分钟。
- [langchain-ai/agentevals](https://github.com/langchain-ai/agentevals):今天四种匹配模式的出处。读 README 里 strict、unordered、subset/superset 和 tool_args_match_mode 几节,20 分钟。
- [τ-bench 论文](https://arxiv.org/abs/2406.12045):读引言和第 3 节,看它怎么设计用户模拟、怎么用数据库终态评分、为什么提出 pass^k,40 分钟。
- [τ²-bench 论文](https://arxiv.org/abs/2506.07982):读摘要和引言,了解「双控环境」是什么意思,15 分钟。
- [Anthropic · Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):重读「评结果而不是评路径」和「每次 trial 从干净环境开始」两部分,和今天的原则对照。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1BZY66hE8u&autoplay=0&high_quality=1" title="如何对 Agent 进行评估?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>西瓜讲大模型 · 如何对 Agent 进行评估? · 11 分钟,中文讲 Agent 评估的维度,包括最终结果、工具调用和过程,适合今天开场。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1HTAHebEuj&autoplay=0&high_quality=1" title="吴恩达《评估 AI 代理|Evaluating AI Agents》中英字幕" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>GPT中英字幕课程资源 · 吴恩达《评估 AI 代理|Evaluating AI Agents》中英字幕(deepseek-R1翻译) · Day 29 看了开头几 P,今天接着看讲评估路由器、技能调用和轨迹(收敛性)的几 P。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/FCKjETgr54U" title="How to evaluate agent trajectories with AgentEvals" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · How to evaluate agent trajectories with AgentEvals · 12 分钟,演示今天讲的几种轨迹匹配模式,代码可以直接对照。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/vuBvf7ZRKTA" title="How to evaluate agents in practice" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Google Cloud Tech · How to evaluate agents in practice · 11 分钟,讲最终结果评估和轨迹评估的区别,以及怎么组合起来用。</figcaption>
</figure>

- AI Engineer《Ship Real Agents: Hands-On Evals for Agentic Applications — Laurie Voss, Arize》(YouTube ID `Xfl50508LZM`,2 小时工作坊):时间多的话跟着做,覆盖了这一周大部分内容,包括轨迹评估。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 6 章「RAG and Agents」中讲 Agent 失败模式和评估的部分:把 Agent 的失败分成规划失败、工具失败、效率问题等几类,和今天的轨迹检查一一对应,约 40 分钟。

### 开源项目与代码

- [sierra-research/tau-bench](https://github.com/sierra-research/tau-bench):看 `envs/retail` 下任务的定义方式和用户模拟器的 prompt,对比我们的简化版缺了什么。
- [sierra-research/tau2-bench](https://github.com/sierra-research/tau2-bench):τ²-bench 的代码,有更完整的用户模拟和评测框架。
- [datawhalechina/hello-agents 第十二章](https://github.com/datawhalechina/hello-agents/tree/main/docs/chapter12):中文教程里讲智能体评估基准的部分,有对 τ-bench 等基准的介绍。

## 自测

1. 为什么说「结果是主,轨迹是约束」?举一个轨迹评测写得太死导致误判的例子。

<details><summary>答案</summary>

任务完成才是目的,只要过程不违反业务、安全、效率上的硬规则,Agent 用什么路径都可以。例子:规定「必须先查订阅再查发票」,而一张重复扣款的工单根本不需要查订阅,Agent 直接查发票并正确提交了退款,却被判失败。

</details>

2. 解释 superset 和 subset 两种匹配模式,各自适合防什么问题。

<details><summary>答案</summary>

superset:实际轨迹包含参考轨迹里的所有调用,允许多调,用来保证「该做的都做了」。subset:实际轨迹里的调用都在参考轨迹范围内,不允许多调,用来防止 Agent 乱调不相关或危险的工具。

</details>

3. 一条工单的数据库最终状态正确,但轨迹里 `create_refund_request` 先以错误金额调用了一次(工具报错),又以正确金额调用了一次。轨迹检查应该判它失败吗?

<details><summary>答案</summary>

一般不判失败,这是正常的自我纠正,而且工具层面的校验拦住了错误。我们的参数检查只看最后一次调用。但可以单独统计自我纠正次数:如果很多,说明工具描述或参数说明不够清楚,值得改进。

</details>

4. 你的用户模拟器在客服还没问的情况下,第一句话就说出了客户编号和发票号。这对评测有什么影响?怎么改?

<details><summary>答案</summary>

测不出 Agent 会不会主动追问缺失信息,多轮用例退化成单轮,分数虚高。改法:在模拟器 prompt 里把这些信息放进「被问时才说」,明确规定没被问不能主动说,必要时加例子;改完读几段对话确认。

</details>

5. τ-bench 为什么用数据库最终状态而不是对话内容来判定成功?

<details><summary>答案</summary>

对话内容可以说得很好听但事情没办成(或办错了),而数据库状态是客观的、可以精确比对的。用终态判定避免了用 LLM 评判对话的不确定性,也符合「评结果」的原则。代价是只能评那些会改变环境状态的任务。

</details>

6. (面试题)「怎么评估一个多轮对话的客服 Agent?」

<details><summary>答案</summary>

要点:用 LLM 扮演用户做模拟对话,给模拟器人设、目标和「被问时才说」的隐藏信息,测试 Agent 的追问和澄清能力;对话结束后用环境终态(数据库里的订单、退款申请)和规则算出的期望比对来判定任务成功,参考 τ-bench;同时做轨迹检查,包括顺序约束、越权、重复调用和预算;用 LLM 评分器补充评估回复质量;每条用例跑多次,报告 pass^k;模拟器本身要人工检查,防止过度配合、提前结束、角色错乱。

</details>

## 明天预告

Day 34 · Tracing 与可观测:Langfuse 接入,每一步都看得见。这几天我们一直在读 `results.jsonl` 里的 transcript,翻 JSON 很累,线上更不可能这么看。明天把 W4 的 Agent 接入 Langfuse,让每次运行的每一次模型调用和工具调用都变成一棵可以点开的树;再用 OpenTelemetry 按 GenAI 语义约定自己打 span,把 token 用量做成指标,并把今天的评测分数写回 trace 上。
