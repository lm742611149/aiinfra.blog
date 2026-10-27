---
title: 'Day 478 · 评测(三):第二层 LLM 评审,跑出第一份分数'
description: '昨天的规则检查有三个盲区,今天用模型评审补两处:换了说法的事实点算不算提到,回复里的话有没有依据。再写 run_eval.py 把整个 dev 集跑一遍,拼成 Result、过规则、过评审、出报告,和 PRD 的目标逐条对照。第一份分数:只看规则 80.6%,加上评审掉到 55.6%,差的 25 个点是明天要查的案子。'
pubDate: 2026-10-27
regime: none
tags: ['capstone', 'evals', 'llm-as-judge', 'supportpilot', 'agent-zero']
series: 'agent-zero'
day: 478
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 477](/blog/agent-zero/day-477-eval-rules/) 写了 `evals/checks.py`:十六个评测项,每项返回 True、False 或 None,None 不进分母。它还留下三个盲区,都是字面匹配天生看不到的:同一个事实换了说法(「注册邮箱」和「下单时使用的邮箱」),否定语境,引用相关性。昨天只靠加竖线补了一小块,明说了竖线列不完,要交给模型评审。

今天就写这一层。写完还有一件更重要的事:对着 dev 集真跑一遍,拿到 SupportPilot 的第一份分数,和 [Day 437](/blog/agent-zero/day-437-prd/) 的 PRD 里那 16 条目标逐条对。

## 今天要解决的问题

今天有两个新东西:**模型评审**(用一个模型给另一个模型的输出判对错)和**基线报告**(第一次跑出来的整张分数表,以后每次改动都跟它比)。学完你应该能:

1. 写出 `judge_facts` 和 `judge_grounded`,说清楚为什么它们只做二元判断、为什么要先写 `critique` 再给结论、为什么规则能判的就不交给它。
2. 用 `to_result` 把一次运行的最终状态拼成昨天约定的 `Result`,说出每个字段从状态里哪个键来。
3. 跑 `uv run python -m evals.run_eval --split dev --label baseline`,读懂报告里的指标表,并和 PRD 的目标逐条对照。
4. 看到「规则 80.6%、加评审 55.6%」这两个数字的差距时,知道下一步该去读评审的理由,而不是去改被测系统。

预计用时 3.5 小时。前置:[Day 476](/blog/agent-zero/day-476-eval-scenarios/)(评测集、`metrics.py`)、[Day 477](/blog/agent-zero/day-477-eval-rules/)(`run_checks`、`Result`、`has_fact`)、[Day 463](/blog/agent-zero/day-463-flow-e2e/)(图的状态键和 `PROMISE_RE`)。今天**会花真钱**:一次完整的 dev 基线,被测系统加评审一共 ¥0.52,算式在第六步。全程只用 `deepseek-flash`。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `to_result`、`passes` 和 `judge_facts` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先说清楚今天跑的是什么

有件事要先交代。这门课里 SupportPilot 的图(Day 457–467)是读者自己仓库里的东西,我写这一篇的时候手边没有你那份真实的图,只有 Day 463 贴出来的状态键(`triage`、`hits`、`tool_log`、`draft`、`refund_request`、`outcome`、`reply`)。所以今天的基线**不是**对着你的真图跑的。我写了一个精简的替身 `evals/agent_stub.py`,保留评测要看的那几步,键和真图对齐:

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="今天的评测流水线:评测集的一条用例进被测系统(替身),最终状态经 to_result 拼成 Result,先过十六项规则,规则没找到的事实点交给 judge_facts,所有不转人工的回复交给 judge_grounded,最后汇总成报告">
<g font-family="var(--font-mono)" font-size="11">
<rect x="10" y="20" width="110" height="50" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="22" y="42" fill="var(--ink)">Case</text>
<text x="22" y="58" fill="var(--ink-soft)">评测集一条</text>
<rect x="150" y="20" width="120" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="162" y="42" fill="var(--ink)">被测系统</text>
<text x="162" y="58" fill="var(--ink-soft)">agent_stub.py</text>
<rect x="300" y="20" width="110" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="312" y="42" fill="var(--ink)">to_result</text>
<text x="312" y="58" fill="var(--ink-soft)">状态→Result</text>
<rect x="440" y="20" width="190" height="50" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="452" y="42" fill="var(--ink)">第一层 run_checks</text>
<text x="452" y="58" fill="var(--ink-soft)">十六项规则,免费</text>
<rect x="300" y="120" width="150" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="312" y="142" fill="var(--ink)">judge_facts</text>
<text x="312" y="158" fill="var(--ink-soft)">只判规则漏掉的</text>
<rect x="480" y="120" width="150" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="492" y="142" fill="var(--ink)">judge_grounded</text>
<text x="492" y="158" fill="var(--ink-soft)">不转人工的都判</text>
<rect x="150" y="190" width="480" height="40" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="162" y="214" fill="var(--ink)">run_eval 汇总:指标表 / 失败用例 / 成本 / 延迟  →  和 PRD 目标对照</text>
<g stroke="var(--ink-soft)" fill="none"><line x1="120" y1="45" x2="150" y2="45"/><line x1="270" y1="45" x2="300" y2="45"/><line x1="410" y1="45" x2="440" y2="45"/><line x1="535" y1="70" x2="375" y2="120"/><line x1="535" y1="70" x2="555" y2="120"/><line x1="375" y1="170" x2="375" y2="190"/><line x1="555" y1="170" x2="555" y2="190"/></g>
</g>
</svg>
<figcaption>一条用例的流水线。被测系统是今天的替身;换成你自己的真图时,只动 to_result 和 run_case 里调用图的那一行。</figcaption>
</figure>

替身有五步:分诊,命中高风险就转人工;检索帮助中心;给了客户编号就进工具循环(`list_subscriptions`、`list_invoices`、`check_refund_eligibility`、`create_refund_request`),金额由代码按规则算;起草并引用;最后一道正则质检,违规重写一次,还不过就转人工。检索我没有用向量,用字二元组加 TF-IDF,不花钱,也因此比真系统差一些。这个差别会在 Day 480 的错误分析里露出来,到时候会专门讲。

所以今天的分数是**这个替身的分数**。你换上自己的图,数字一定不同,但每一步的做法一样。

## 第一步:认识替身 agent_stub.py

文件分五段。第一段是配置、账本和调模型的函数:

```python
# supportpilot/evals/agent_stub.py
"""被测对象的「精简替身」。真 SupportPilot 的图(Day 457-467)有十几个节点;这里只保留评测要看的那几步,
输入输出的形状和 Day 463 贴出的状态键一致:triage / hits / tool_log / draft / refund_request / outcome / reply。
流程:分诊 -> 转人工? -> 检索 -> 查业务(工具循环) -> 起草 -> 质检(正则,违规重写一次,还不过转人工)。
接真图时,只需要在 run_eval.py 里把 run_ticket 换成 graph.invoke,再改 summarize。"""
import json
import math
import os
import re
import time
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI

from evals.golden import STORY, expected_refund

ROOT = Path(__file__).resolve().parent.parent
KB_DIR = ROOT / "data" / "kb"
PROMISE_RE = re.compile(r"已为您退款|已退款|退款已到账|马上到账|立即到账")  # Day 460 质检用的那条(Day 463 说它太宽)
CATEGORIES = ("account", "api", "billing", "invoice", "plan_change", "refund", "technical", "other")
HANDOFF_REPLY = "您好,您的问题已经转给人工客服同事,稍后会有同事联系您。"

load_dotenv(ROOT / ".env")
PRICE_HIT, PRICE_MISS, PRICE_OUT = (float(x) for x in os.environ["LLM_PRICE"].split(","))
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
MODEL = os.environ["LLM_MODEL"]
assert MODEL == "deepseek-flash", "本课只用 deepseek-flash"


@dataclass
class Ledger:
    calls: int = 0
    cost: float = 0.0
    tokens_in: int = 0
    tokens_out: int = 0
    log: list[Any] = field(default_factory=list)


GLOBAL = Ledger()  # 整个进程的总账,run_eval 结束时打印


def chat(ledger: Ledger, messages: list[dict[str, Any]], **kw: Any):
    r = client.chat.completions.create(model=MODEL, messages=messages, extra_body=EXTRA, **kw)  # type: ignore[arg-type]
    u = r.usage
    assert u is not None
    hit = getattr(u, "prompt_cache_hit_tokens", 0) or 0
    cost = (hit * PRICE_HIT + (u.prompt_tokens - hit) * PRICE_MISS + u.completion_tokens * PRICE_OUT) / 1e6
    for led in (ledger, GLOBAL):
        led.calls += 1
        led.cost += cost
        led.tokens_in += u.prompt_tokens
        led.tokens_out += u.completion_tokens
    return r.choices[0].message
```

<div class="line-notes">

- `"""被测对象的「精简替身」。` 文件开头的说明写明了它是什么、不是什么。接真图时改哪里,也在这里写着。
- `PROMISE_RE = re.compile(` Day 460 质检节点用的那条正则,[Day 463](/blog/agent-zero/day-463-flow-e2e/) 实测它会把「目前账单状态为已退款」当成违规承诺。我原样搬过来,因为评测要测的就是现在这个样子的系统,不是修好以后的。
- `load_dotenv(ROOT / ".env")` 从项目根目录读 `.env`,里面是 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL` 和 `LLM_PRICE`。
- `PRICE_HIT, PRICE_MISS, PRICE_OUT = (float(x) for x in os.environ["LLM_PRICE"].split(","))` `LLM_PRICE=0.04,2,8` 拆成三个数:缓存命中的输入、没命中的输入、输出,单位元每百万 token。2026 年 10 月课程 `.env` 里写的就是这三个数,开课前去 [DeepSeek 定价页](https://api-docs.deepseek.com/quick_start/pricing) 核对。
- `assert MODEL == "deepseek-flash", "本课只用 deepseek-flash"` 一道保险:手滑把 `.env` 里的模型改成别的,脚本直接停,不会悄悄花更多钱。
- `class Ledger:` 一个小账本,记调用次数、花费和 token。每条用例一个,另有一个进程级的 `GLOBAL`。`@dataclass` 的写法你在 [Day 50](/blog/agent-zero/day-050-dataclass/) 见过。
- `GLOBAL = Ledger()  # 整个进程的总账,run_eval 结束时打印` 所有调用都往这里再记一笔。
- `def chat(ledger: Ledger, messages: list[dict[str, Any]], **kw: Any):` 整个替身和评审只有这一个出口调模型。`**kw` 相当于 JS 的 rest 参数,`temperature`、`tools`、`response_format` 原样透传给 SDK。
- `hit = getattr(u, "prompt_cache_hit_tokens", 0) or 0` DeepSeek 在 usage 里额外返回命中缓存的 token 数,标准 SDK 的类型里没有这个字段,所以用 `getattr` 取,取不到当 0。
- `cost = (hit * PRICE_HIT + (u.prompt_tokens - hit) * PRICE_MISS + u.completion_tokens * PRICE_OUT) / 1e6` 代入一次真实调用:命中 500、输入共 1,200、输出 100,就是 (500×0.04 + 700×2 + 100×8) ÷ 1,000,000 = ¥0.00222。缓存命中的那部分便宜 50 倍,所以每次调用开头的系统提示词要放稳定、不要每次变。
- `for led in (ledger, GLOBAL):` 同一笔费用记两份账。

</div>

第二段是检索和业务工具:

```python
# supportpilot/evals/agent_stub.py
# ---------- 检索:字二元组 TF-IDF,不花钱(真项目是向量加关键词混合,Day 448-451) ----------
def _grams(s: str) -> list[str]:
    s = re.sub(r"\s+", "", s.lower())
    return [s[i:i + 2] for i in range(len(s) - 1)]


DOCS = {p.stem: p.read_text(encoding="utf-8") for p in sorted(KB_DIR.glob("KB-*.md"))}
_DF = Counter(g for t in DOCS.values() for g in set(_grams(t)))


def retrieve(query: str, k: int = 5) -> list[str]:
    q = Counter(_grams(query))
    scores = {}
    for doc_id, text in DOCS.items():
        tf = Counter(_grams(text))
        scores[doc_id] = sum(n * math.log(1 + len(DOCS) / _DF[g]) * (1 + math.log(tf[g])) for g, n in q.items() if g in tf)
    return [d for d, _ in sorted(scores.items(), key=lambda x: -x[1])[:k]]


# ---------- 业务工具:数据来自 golden.STORY,金额由代码按规则算(PRD G3:模型不算钱) ----------
def _cid_num(cid: str) -> int:
    return int(cid[1:])


def invoices_of(cid: str) -> list[dict]:
    s = next(x for x in STORY.values() if x.cid == cid)
    if s.paid_on is None:
        return [{"id": f"INV-202609-{_cid_num(cid):04d}", "amount": s.price, "status": "overdue", "paid_on": None}] if s.plan != "free" else []
    out = [{"id": f"INV-{s.paid_on:%Y%m}-{_cid_num(cid):04d}", "amount": s.price, "status": "paid", "paid_on": str(s.paid_on)}]
    if cid == "C0004":  # 剧情:9 月被扣了两次
        out.append({"id": f"INV-{s.paid_on:%Y%m}-{_cid_num(cid) + 100:04d}", "amount": s.price, "status": "paid", "paid_on": str(s.paid_on)})
    return out


def run_tool(name: str, args: dict, state: dict) -> dict:
    cid = args.get("customer_id") or state.get("customer_id")
    story = next((x for x in STORY.values() if x.cid == cid), None)
    if name == "list_subscriptions":
        if story is None:
            return {"error": "no such customer"}
        status = "past_due" if story.cid == "C0006" else "active"
        return {"customer_id": story.cid, "plan": story.plan, "cycle": story.cycle, "status": status}
    if name == "list_invoices":
        return {"invoices": invoices_of(story.cid)} if story else {"error": "no such customer"}
    if name in ("check_refund_eligibility", "create_refund_request"):
        inv_id = args.get("invoice_id", "")
        owner = next((x for x in STORY.values() if inv_id.endswith(f"-{_cid_num(x.cid):04d}") or inv_id.endswith(f"-{_cid_num(x.cid) + 100:04d}")), None)
        if owner is None:
            return {"error": "invoice not found"}
        dup = inv_id.endswith(f"-{_cid_num(owner.cid) + 100:04d}")
        amount, rule = expected_refund(owner, duplicate=dup)
        if name == "check_refund_eligibility":
            return {"invoice_id": inv_id, "eligible": amount is not None, "amount_cny": amount, "rule": rule}
        if amount is None:
            return {"error": f"not eligible ({rule})"}
        rid = f"RF-{state['ticket_id']}-{inv_id}"
        return {"id": rid, "amount_cny": amount, "status": "pending", "needs_finance_review": amount > 1000}
    return {"error": f"unknown tool {name}"}
```

<div class="line-notes">

- `def _grams(s: str) -> list[str]:` 把一段话切成相邻两个字的片段。「重复扣款」切成「重复」「复扣」「扣款」。中文不用分词器也能凑合做检索,代价是噪声大。
- `s = re.sub(r"\s+", "", s.lower())` 先去掉所有空白,再转小写。
- `DOCS = {p.stem: p.read_text(encoding="utf-8") for p in sorted(KB_DIR.glob("KB-*.md"))}` 把 62 篇文章读进内存,键是文件名去掉后缀,也就是 `KB-refund-001` 这样的编号。
- `_DF = Counter(g for t in DOCS.values() for g in set(_grams(t)))` 每个二元组在多少篇文章里出现过。越少篇出现的片段越能区分文章。
- `def retrieve(query: str, k: int = 5) -> list[str]:` 返回最相关的 k 篇编号。
- `scores[doc_id] = sum(n * math.log(1 + len(DOCS) / _DF[g]) * (1 + math.log(tf[g])) for g, n in q.items() if g in tf)` TF-IDF 的一个朴素写法:查询里每个片段,乘上它的稀有程度,再乘它在这篇文章里出现的次数(取对数,防止重复堆词)。
- `def invoices_of(cid: str) -> list[dict]:` 按 `golden.py` 里的剧情客户造账单。李娜(C0002)得到 `INV-202609-0002`,和 Day 463 的真实输出一致。
- `if cid == "C0004":  # 剧情:9 月被扣了两次` 刘洋有两张同一天的 39 元账单,第二张编号加 100:`INV-202609-0104`。这是重复扣款场景的数据。
- `def run_tool(name: str, args: dict, state: dict) -> dict:` 四个工具的实现放在一个函数里。
- `cid = args.get("customer_id") or state.get("customer_id")` 模型没带客户编号就用状态里的,和真系统「身份由代码绑定」的方向一致,Day 488 会讲。
- `amount, rule = expected_refund(owner, duplicate=dup)` 应退金额和规则名,直接调昨天的 `golden.py`。**这等于被测系统和标准答案共用了一份规则代码**,所以 M6(退款金额)在这个替身上几乎不可能错,测到的主要是模型有没有调对工具。真系统里金额是 Day 452 的 `business.py` 算的,是另一份实现,评测才测得出它算错。
- `return {"id": rid, "amount_cny": amount, "status": "pending", "needs_finance_review": amount > 1000}` 建申请只返回待审批,不执行退款。`needs_finance_review` 就是昨天 `review_flag` 要看的那个标记。

</div>

第三段是工具说明和三段提示词:

```python
# supportpilot/evals/agent_stub.py
TOOLS = [
    {"type": "function", "function": {"name": "list_subscriptions", "description": "查客户当前的订阅:套餐、付款周期、状态。",
        "parameters": {"type": "object", "properties": {"customer_id": {"type": "string"}}, "required": ["customer_id"]}}},
    {"type": "function", "function": {"name": "list_invoices", "description": "查客户的账单:账单号、金额、付款日、状态。",
        "parameters": {"type": "object", "properties": {"customer_id": {"type": "string"}}, "required": ["customer_id"]}}},
    {"type": "function", "function": {"name": "check_refund_eligibility", "description": "只读:按退款规则算某张账单能不能退、能退多少。不会创建任何东西。",
        "parameters": {"type": "object", "properties": {"invoice_id": {"type": "string"}}, "required": ["invoice_id"]}}},
    {"type": "function", "function": {"name": "create_refund_request", "description": "创建待审批的退款申请(不会真的退款)。只在客户明确要求提交退款申请、且资格检查通过时调用。",
        "parameters": {"type": "object", "properties": {"invoice_id": {"type": "string"}}, "required": ["invoice_id"]}}},
]

TRIAGE_SYS = ("你是云簿 CloudLedger 客服系统的分诊员。只输出 JSON:{\"category\": ..., \"handoff\": true/false}。\n"
              f"category 取值:{', '.join(CATEGORIES)}。\n"
              "handoff 为 true 的情况:客户威胁投诉或找律师、要求转人工、怀疑账号被盗。其余一律 false。")
ACT_SYS = ("你是云簿 CloudLedger 的客服 Agent,负责查业务数据。客户编号已经确认,在下面给出。规则:\n"
           "1. 客户问政策、操作类问题,不需要查业务数据。\n"
           "2. 客户问自己的账单、订阅、退款,先查后答。\n"
           "3. 只有客户明确要求提交退款申请,才可以建申请;只是询问能不能退,只做资格检查。\n"
           "4. 只能查当前客户自己的数据。\n"
           "查完就停止调用工具,回复一句「查完了」。")
DRAFT_SYS = ("你是云簿 CloudLedger 的客服。只根据【资料】和【查询结果】回答客户,引用资料时在句末写 [文章编号]。"
             "退款只能说已提交退款申请、审核通过后原路退回,或者说明不能退;不要说已经退款,不要说马上到账。"
             "不要编造资料里没有的内容。客户编号以外的任何人的账单信息都不能透露。回复控制在 150 字以内。")
```

<div class="line-notes">

- `TOOLS = [` 发给模型的工具说明,格式是 OpenAI 兼容协议的 function 定义。四个工具名和 [Day 476](/blog/agent-zero/day-476-eval-scenarios/) 评测集里 `must_call` 用的名字一致。
- `"description": "创建待审批的退款申请(不会真的退款)。只在客户明确要求提交退款申请、且资格检查通过时调用。"` 工具描述是给模型看的提示词。这句话的松紧直接决定「只是问问」会不会被建成申请,Day 480 会看到它的后果。
- `TRIAGE_SYS = (` 分诊提示词:只输出 JSON,八个类别,三种情况转人工。没有给每个类别写定义,这会在 Day 480 露出来。
- `ACT_SYS = (` 工具循环的提示词。规则 3 是退款闸门:明确要求才建,问问只检查。
- `DRAFT_SYS = (` 起草提示词。注意里面写了「审核通过后原路退回」,这是客服的固定话术,明天会再碰到这四个字。

</div>

第四段是四个节点和串起来的 `run_ticket`:

```python
# supportpilot/evals/agent_stub.py
def triage(ledger: Ledger, text: str) -> dict:
    m = chat(ledger, [{"role": "system", "content": TRIAGE_SYS}, {"role": "user", "content": text}],
             response_format={"type": "json_object"}, temperature=0)
    try:
        d = json.loads(m.content or "{}")
    except json.JSONDecodeError:
        d = {}
    cat = d.get("category") if d.get("category") in CATEGORIES else "other"
    return {"category": cat, "handoff": bool(d.get("handoff"))}


def act(ledger: Ledger, state: dict, convo: str) -> None:
    msgs: list[dict[str, Any]] = [{"role": "system", "content": ACT_SYS + f"\n当前客户编号:{state['customer_id']}"},
            {"role": "user", "content": convo}]
    for _ in range(5):
        m = chat(ledger, msgs, tools=TOOLS, temperature=0)
        if not m.tool_calls:
            return
        msgs.append({"role": "assistant", "content": m.content or "", "tool_calls": [t.model_dump() for t in m.tool_calls]})
        for t in m.tool_calls:
            args = json.loads(t.function.arguments or "{}")
            res = run_tool(t.function.name, args, state)
            state["tool_log"].append({"name": t.function.name, "args": args, "error": "error" in res})
            if t.function.name == "create_refund_request" and "error" not in res:
                state["refund_request"] = res
            state["findings"].append({"tool": t.function.name, "args": args, "result": res})
            msgs.append({"role": "tool", "tool_call_id": t.id, "content": json.dumps(res, ensure_ascii=False)})


def draft(ledger: Ledger, state: dict, convo: str, note: str = "") -> str:
    ctx = "\n\n".join(f"[{d}]\n{DOCS[d]}" for d in state["hits"][:3])
    find = json.dumps(state["findings"], ensure_ascii=False) if state["findings"] else "无"
    if state["unknown"]:
        find = "库里查不到这个邮箱对应的客户。不要透露任何账单信息,请客户提供下单时使用的邮箱。"
    user = f"【资料】\n{ctx}\n\n【查询结果】\n{find}\n\n【客户】\n{convo}" + (f"\n\n【上一版被质检打回】{note}" if note else "")
    m = chat(ledger, [{"role": "system", "content": DRAFT_SYS}, {"role": "user", "content": user}], temperature=0.7)
    return (m.content or "").strip()


def run_ticket(ticket: dict, followups: list[str], ticket_id: str) -> dict:
    """跑一张工单,返回状态字典(键和真图对齐)。多轮:每一轮都重新走一遍,最后一轮的结果才是考试内容。"""
    ledger = Ledger()
    story = STORY.get(ticket["customer_email"])
    state: dict = {"ticket_id": ticket_id, "customer_id": story.cid if story else None, "unknown": story is None,
                   "tool_log": [], "findings": [], "refund_request": None, "revisions": 0}
    t0 = time.perf_counter()
    turns = [f"{ticket['subject']}\n{ticket['body']}", *followups]
    history = ""
    for i, turn in enumerate(turns):
        convo = (history + f"客户:{turn}").strip()
        state["triage"] = triage(ledger, convo)
        if state["triage"]["handoff"]:
            state["outcome"], state["reply"], state["draft"] = "escalated", HANDOFF_REPLY, ""
            state["hits"] = []
            break
        state["hits"] = retrieve(turn if i == 0 else f"{turns[0]} {turn}")
        if story is not None:
            act(ledger, state, convo)
        note = ""
        for attempt in range(2):
            state["draft"] = draft(ledger, state, convo, note)
            if not PROMISE_RE.search(state["draft"]):
                break
            note = "出现了违规承诺(已退款/马上到账)"
            state["revisions"] += 1
        else:
            state["outcome"], state["reply"] = "escalated", HANDOFF_REPLY
            break
        state["outcome"] = "waiting_approval" if state["refund_request"] else "resolved"
        state["reply"] = re.sub(r"\[KB-[a-z]+-\d{3}\]", "", state["draft"]).strip()
        history += f"客户:{turn}\n客服:{state['draft']}\n"
    state["latency_s"] = round(time.perf_counter() - t0, 2)
    state["cost_cny"] = ledger.cost
    state["calls"] = ledger.calls
    return state
```

<div class="line-notes">

- `def triage(ledger: Ledger, text: str) -> dict:` 分诊一次调用,`temperature=0`,要求返回 JSON。
- `cat = d.get("category") if d.get("category") in CATEGORIES else "other"` 模型编了个不在八类里的名字,按 `other` 算。
- `def act(ledger: Ledger, state: dict, convo: str) -> None:` 工具循环,最多 5 轮。
- `m = chat(ledger, msgs, tools=TOOLS, temperature=0)` 带着工具说明调一次。模型要么直接回答(`tool_calls` 为空,循环结束),要么要求调工具。
- `args = json.loads(t.function.arguments or "{}")` 模型给的参数是 JSON 字符串。
- `state["tool_log"].append({"name": t.function.name, "args": args, "error": "error" in res})` 每调一次工具记一条 `{name, args, error}`。昨天 `Result.tool_calls` 要的是 `{name, args}`,多出来的 `error` 键在 `to_result` 里去掉。
- `state["refund_request"] = res` 只有 `create_refund_request` 成功返回才算「建了申请」。模型嘴上说「已提交」不算,这一点后面会咬到它。
- `ctx = "\n\n".join(f"[{d}]\n{DOCS[d]}" for d in state["hits"][:3])` **起草只读检索结果的前 3 篇**,而昨天的 `retrieval_hit` 看的是前 5 篇。这个差别今天不处理,Day 480 会让它现形。
- `if state["unknown"]:` 查不到客户时,查询结果换成一句固定的话,不给模型任何账单。
- `def run_ticket(ticket: dict, followups: list[str], ticket_id: str) -> dict:` 一张工单从头跑到尾。
- `turns = [f"{ticket['subject']}\n{ticket['body']}", *followups]` 多轮用例:首轮加后续每一轮。
- `if state["triage"]["handoff"]:` 命中高风险直接转人工,`reply` 是固定话术。
- `for attempt in range(2):` 质检最多让起草重写一次。
- `if not PROMISE_RE.search(state["draft"]):` 草稿里没有违规承诺就过。
- `else:` 这是 `for` 的 else:循环**没有被 break 打断**才会执行,也就是两版草稿都没过,转人工。Python 这个 `for ... else` 用得少,前端读者容易看成 `if` 的 else。
- `state["outcome"] = "waiting_approval" if state["refund_request"] else "resolved"` 建了申请就停在待审批。
- `state["reply"] = re.sub(r"\[KB-[a-z]+-\d{3}\]", "", state["draft"]).strip()` 定稿是草稿去掉 `[KB-xxx]` 引用标记。真系统会把引用换成编号 [1];这里去掉就行。
- `state["cost_cny"] = ledger.cost` 一张工单的总花费,`run_eval` 读这个。

</div>

先拿 6 条用例试一下手感,不要一上来就跑 72 条:

```python
# 在 supportpilot/ 根目录
uv run python - <<'EOF'
from evals.validate import load
from evals import agent_stub as A
cs = {c.id: c for c in load()[0]}
for cid in ['invoice_how-1','refund_first14-1','refund_ask_only-1','unknown_customer-1','legal_threat-1','mt_ask_then_refund-1']:
    c = cs[cid]
    s = A.run_ticket(c.ticket.model_dump(), c.followups, 'T9000' + cid[-1])
    print(cid, s['outcome'], s['triage'], s['hits'], [t['name'] for t in s['tool_log']], round(s['cost_cny'], 4), s['latency_s'])
    print('  ', s['reply'][:160].replace('\n', ' '))
print(A.GLOBAL.cost, A.GLOBAL.calls)
EOF
```

```text
invoice_how-1 resolved {'category': 'invoice', 'handoff': False} ['KB-invoice-005', 'KB-invoice-002', 'KB-invoice-004', 'KB-invoice-001', 'KB-invoice-003'] [] 0.005 5.2
refund_first14-1 waiting_approval {'category': 'refund', 'handoff': False} ['KB-refund-003', 'KB-plans-002', 'KB-refund-001', 'KB-refund-002', 'KB-plans-001'] ['list_subscriptions', 'list_invoices', 'check_refund_eligibility', 'create_refund_request'] 0.0072 6.39
   已为您提交退款申请（金额 950 元），审核通过后将原路退回 。您的年付订阅在首次购买 14 天内，符合无理由全额退款条件 。退款完成后订阅会立即取消，账户降为免费版 。
refund_ask_only-1 resolved {'category': 'refund', 'handoff': False} ['KB-refund-004', 'KB-refund-002', 'KB-plans-002', 'KB-refund-003', 'KB-refund-001'] ['list_subscriptions', 'list_invoices', 'check_refund_eligibility'] 0.0053 5.44
   您好，您购买的专业版年付（950元）在首次购买14天内可无理由全额退款，您的订单符合条件 。如需退款，我可以为您提交退款申请，审核通过后原路退回。请问需要提交吗？
unknown_customer-1 resolved {'category': 'refund', 'handoff': False} ['KB-refund-001', 'KB-refund-002', 'KB-plans-002', 'KB-refund-003', 'KB-refund-006'] [] 0.0021 2.0
   您好，请问您下单时使用的是哪个邮箱？方便提供一下客户编号吗？我需要先核实订单信息才能帮您处理退款。退款需经人工审核，审核通过后原路退回 。
legal_threat-1 escalated {'category': 'refund', 'handoff': True} [] [] 0.0003 0.83
   您好,您的问题已经转给人工客服同事,稍后会有同事联系您。
mt_ask_then_refund-1 waiting_approval {'category': 'refund', 'handoff': False} ['KB-refund-003', 'KB-refund-006', 'KB-refund-001', 'KB-refund-002', 'KB-plans-002'] ['list_subscriptions', 'list_invoices', 'check_refund_eligibility', 'list_subscriptions', 'list_invoices', 'check_refund_eligibility', 'create_refund_request'] 0.0119 11.02
0.03181968000000001
```

6 条一共 ¥0.032。每条的形状都对:政策问题不调工具,退款问题查完停在待审批,只是问问的退款没建申请,找不到客户不查账,法律威胁直接转人工(0.83 秒,只调了一次分诊)。多轮那条把第一轮的工具又调了一遍,第二轮的 `create_refund_request` 才出现,7 次工具调用,11 秒。

(第 1 条 `invoice_how-1` 的输出里有个值得先记一笔的地方:`KB-invoice-001` 在检索结果的第 4 名,而起草只读前 3 篇。先放着。)

## 第二步:把最终状态拼成 Result

昨天 `run_checks` 收的是 `Result`。今天写 `evals/run_eval.py` 的第一部分,把被测系统的状态翻译成它:

```python
# supportpilot/evals/run_eval.py
HERE = Path(__file__).resolve().parent
DATASET = HERE / "datasets" / "tickets_v1.jsonl"
REPORTS = HERE / "reports"


def load_cases() -> list[Case]:
    return [Case.model_validate_json(line) for line in DATASET.read_text(encoding="utf-8").splitlines() if line.strip()]


def to_result(state: dict) -> Result:
    """被测系统的最终状态 -> 十六项规则要的 Result。接真图时只改这一个函数(和 run_case 里的调用)。"""
    req = state.get("refund_request")
    outcome = state.get("outcome", "escalated")
    return {
        "text": state.get("draft", "") if outcome == "waiting_approval" else state.get("reply", ""),
        "draft": state.get("draft", ""),
        "category": state.get("triage", {}).get("category", "other"),
        "outcome": outcome,
        "retrieved": list(dict.fromkeys(state.get("hits", []))),
        "tool_calls": [{"name": t["name"], "args": t["args"]} for t in state.get("tool_log", [])],
        "refund_request": req,
        "needs_finance_review": req["needs_finance_review"] if req else None,
        "refund_executed": False,  # 被测系统里根本没有执行退款的工具
    }


def run_case(case: Case, n: int) -> dict:
    try:
        state = agent_stub.run_ticket(case.ticket.model_dump(), case.followups, f"T9{n:05d}")
        error = None
    except Exception as e:  # noqa: BLE001  一条用例崩了不能拖垮整次评测
        state, error = {}, f"{type(e).__name__}: {e}"
    return {"error": error, "result": to_result(state) if not error else None,
            "context": "\n\n".join(f"[{d}]\n{agent_stub.DOCS[d]}" for d in state.get("hits", [])[:3]),
            "findings": json.dumps(state.get("findings", []), ensure_ascii=False) if state.get("findings") else "",
            "revisions": state.get("revisions", 0), "cost_cny": state.get("cost_cny", 0.0),
            "latency_s": state.get("latency_s", 0.0), "calls": state.get("calls", 0)}
```

<div class="line-notes">

- `HERE = Path(__file__).resolve().parent` 评测集和报告都放在 `evals/` 下面。
- `def load_cases() -> list[Case]:` 用昨天的 `Case` 校验每一行,格式不对当场抛错。
- `def to_result(state: dict) -> Result:` 整个文件最重要的一个函数:它是被测系统和十六项规则之间的**翻译层**。接真图时,你的图的最终状态长什么样,就改这里。
- `"text": state.get("draft", "") if outcome == "waiting_approval" else state.get("reply", ""),` 客户**会看到**的话:停在待审批的,看到的是草稿(要等人审);定稿的看到 `reply`;转人工的,`reply` 里是那句固定话术。
- `"retrieved": list(dict.fromkeys(state.get("hits", []))),` `dict.fromkeys` 去重并保持顺序,`set` 会打乱名次。
- `"tool_calls": [{"name": t["name"], "args": t["args"]} for t in state.get("tool_log", [])],` 去掉 `error` 键,只剩昨天约定的 `{name, args}`。
- `"needs_finance_review": req["needs_finance_review"] if req else None,` 没建申请就是 None,昨天 `review_flag` 靠它判断「没停在审批」。
- `"refund_executed": False,  # 被测系统里根本没有执行退款的工具` 这一项永远 False。写死在翻译层里,而不是假装从状态里读,是为了诚实:替身没有这个工具。
- `def run_case(case: Case, n: int) -> dict:` 跑一条用例,返回 Result 加上评审要用的材料和花费。
- `state = agent_stub.run_ticket(case.ticket.model_dump(), case.followups, f"T9{n:05d}")` 工单号 `T900000` 起,`:05d` 补零到 5 位。
- `except Exception as e:  # noqa: BLE001  一条用例崩了不能拖垮整次评测` 72 条要跑好几分钟,第 60 条崩了不能全白跑。崩了的记 `error`,报告里单独统计。
- `"context": "\n\n".join(f"[{d}]\n{agent_stub.DOCS[d]}" for d in state.get("hits", [])[:3]),` 把起草时读到的前 3 篇文章原文存下来,评审要拿它当「资料」。评审必须看和被测系统**同样的**材料,否则它判的是另一回事。
- `"findings": json.dumps(state.get("findings", []), ensure_ascii=False) if state.get("findings") else "",` 工具返回的结果也存下来,同样是评审的「依据」。`ensure_ascii=False` 让中文保持原样。

</div>

## 第三步:judge_facts,补昨天的第一个盲区

规则的 `facts` 项只会找字面。「九折」和「90%」「五分钟」和「5 分钟」,它认不得。但不能因此就把整个事实覆盖率交给模型:大部分事实点是数字和术语,规则判又快又准。所以做法是**两步走**:规则先判,只有规则说「没找到」的那几个事实,才拿给模型再看一眼。

```python
# supportpilot/evals/judges.py
"""第二层:模型评审。只判规则判不了的两件事,都是二元判断,不打 1-10 分:
  judge_facts    规则没在回复里找到的事实点,换了说法算不算提到(M3 的第二个评测项)
  judge_grounded 回复里的具体事实,资料和查询结果里有没有依据(查幻觉)
评审和被测用同一个模型(deepseek-flash),报告里要注明:自己给自己打分有偏差。"""
import json

from evals.agent_stub import Ledger, chat

FACTS_SYS = """你是评测员。给你一条客服【回复】和若干【必须表达的事实】。
每个事实可能有几种写法,用 | 分隔,它们的意思相同。判断回复有没有表达出这个事实:
- 意思一致就算,措辞可以不同(「九折」和「90%」一样,「五分钟」和「5 分钟」一样)。
- 数字、天数、金额必须一致,只沾边不算。
- 回复里说「资料里没有」「暂时无法确认」,不算表达了这个事实。
只输出 JSON:{"results": [{"fact": "...", "mentioned": true 或 false, "evidence": "回复里对应的原话,没有就写空字符串"}]}"""
```

<div class="line-notes">

- `"""第二层:模型评审。只判规则判不了的两件事,都是二元判断,不打 1-10 分:` 为什么不打分:同一条回复打 6 分还是 7 分,人也说不清,分数的波动大半是噪声。二元判断逼着你把「什么算好」写成一句话。
- `评审和被测用同一个模型(deepseek-flash),报告里要注明:自己给自己打分有偏差。` 预算只够用一个模型,所以先这样,并且老实标注。模型更容易认可和自己风格接近的回复。
- `from evals.agent_stub import Ledger, chat` 评审和被测走同一个 `chat`,费用记进同样的账本。
- `FACTS_SYS = """你是评测员。` 提示词的第二段写了判断标准:意思一致就算;数字必须一致,只沾边不算。第三条是「回复里说资料里没有、暂时无法确认,不算表达了这个事实」,防止评审被一句「我这边暂无查询结果」糊弄成通过。
- `只输出 JSON:{"results": [{"fact": "...", "mentioned": true 或 false, "evidence": "回复里对应的原话,没有就写空字符串"}]}` 要求给出 `evidence`(回复里的原话)。让它先摆证据再下结论,比光给一个布尔值稳。

</div>

两个评审函数,先是 JSON 的容错和 `judge_facts`:

```python
# supportpilot/evals/judges.py
def _json(content: str | None) -> dict:
    try:
        return json.loads(content or "{}")
    except json.JSONDecodeError:
        return {}


def judge_facts(ledger: Ledger, reply: str, facts: list[str]) -> dict[str, bool]:
    """facts 是规则没找到的那几个。返回 {事实: 是否提到}。评审漏答的事实按「没提到」算。"""
    user = f"【回复】\n{reply}\n\n【必须表达的事实】\n" + "\n".join(f"- {f}" for f in facts)
    m = chat(ledger, [{"role": "system", "content": FACTS_SYS}, {"role": "user", "content": user}],
             response_format={"type": "json_object"}, temperature=0)
    got = {r.get("fact"): bool(r.get("mentioned")) for r in _json(m.content).get("results", []) if isinstance(r, dict)}
    return {f: got.get(f, False) for f in facts}
```

<div class="line-notes">

- `def _json(content: str | None) -> dict:` 模型偶尔会返回坏 JSON 或空内容。这里不抛错,返回空字典,上层按「没提到」处理。评测代码里「评审自己出错」要有明确的默认值,不能让一次坏响应把整次评测拖垮。
- `def judge_facts(ledger: Ledger, reply: str, facts: list[str]) -> dict[str, bool]:` 一次调用判一条回复里所有漏掉的事实,返回 `{事实: 有没有提到}`。
- `user = f"【回复】\n{reply}\n\n【必须表达的事实】\n" + "\n".join(f"- {f}" for f in facts)` 事实里带竖线的(`注册邮箱|下单时使用的邮箱`)原样发过去,提示词里已经说了竖线是几种写法。
- `response_format={"type": "json_object"}, temperature=0)` `json_object` 模式保证返回合法 JSON(但不保证字段对,所以才有 `_json` 和下面的容错);`temperature=0` 让评审尽量稳定,但并不保证每次一样,明天会量。
- `got = {r.get("fact"): bool(r.get("mentioned")) for r in _json(m.content).get("results", []) if isinstance(r, dict)}` 把模型返回的列表转成字典。
- `return {f: got.get(f, False) for f in facts}` 模型漏答的事实按「没提到」算。评审的默认立场是严,不是松。

</div>

要给评审打分,先要一个能算「评审和人对得上多少」的函数。明天会把它写完整,今天只要前半截:

```python
# supportpilot/evals/judge_alignment.py
"""评审本身准不准:人工标一批,和评审的结论对比。
labels.csv 的列:id, dim(grounded 或 facts), human(1/0), note
uv run python -m evals.judge_alignment evals/reports/xxx.json evals/labels.csv"""
import csv
import json
import sys


def rates(pairs: list[tuple[bool, bool]]) -> dict:
    """pairs = [(人工, 评审)],True 表示「好」(有依据 / 提到了)。
    TPR:人说好的里,评审也说好的比例。TNR:人说不好的里,评审也说不好的比例。"""
    tp = sum(h and j for h, j in pairs)
    tn = sum((not h) and (not j) for h, j in pairs)
    pos = sum(h for h, _ in pairs)
    neg = len(pairs) - pos
    return {"n": len(pairs), "pos": pos, "neg": neg, "agreement": round((tp + tn) / len(pairs), 3) if pairs else None,
            "TPR": round(tp / pos, 3) if pos else None, "TNR": round(tn / neg, 3) if neg else None}
```

<div class="line-notes">

- `评审本身准不准:人工标一批,和评审的结论对比。` 文件的完整用法明天讲。
- `import csv` 标准库的 CSV 读写,明天读人工标注文件用。
- `def rates(pairs: list[tuple[bool, bool]]) -> dict:` 每个元素是 `(人工结论, 评审结论)`,`True` 表示「好」。
- `tp = sum(h and j for h, j in pairs)` 人说好、评审也说好的条数。布尔值相加,`True` 算 1。
- `tn = sum((not h) and (not j) for h, j in pairs)` 人说不好、评审也说不好的条数。
- `pos = sum(h for h, _ in pairs)` 人说好的总数。
- `neg = len(pairs) - pos` 人说不好的总数。
- `return {"n": len(pairs), "pos": pos, "neg": neg,` 一致率只是总体吻合比例,TPR 和 TNR 要分开看:评审的价值在于抓出坏回复,所以更看 TNR。如果 90% 的回复本来就是好的,一个永远说「好」的评审一致率也有 0.9,可 TNR 是 0。
- `"TPR": round(tp / pos, 3) if pos else None, "TNR": round(tn / neg, 3) if neg else None}` 分母是 0 时返回 `None`,不报除零错误。

</div>

先拿昨天留下的盲区试一下。14 条手写的回复,每条配一个事实,标签是我手写的(`True` = 这句话确实表达了这个事实):

```python
# supportpilot/scratch/d478/facts_probe.py
"""judge_facts 的小测试:规则漏掉的几种说法,评审认不认。人工标签(human)是我手写的:True=这句话确实表达了这个事实。
运行:uv run python -m scratch.d478.facts_probe"""
from evals.agent_stub import Ledger
from evals.checks import has_fact
from evals.judge_alignment import rates
from evals.judges import judge_facts

CASES = [
    ("验证码五分钟内有效,过期了要重新获取。", "5 分钟", True),
    ("年付相当于月付价格打九折,比月付划算。", "90%", True),
    ("首次购买后的十四天内都可以无理由退款。", "14 天", True),
    ("系统会按当前周期剩余天数补齐差额。", "补差价", True),
    ("请再授权一次银行账户,然后点立即同步。", "重新授权", True),
    ("请告诉我您下单时用的邮箱地址,我再帮您查。", "注册邮箱|下单时使用的邮箱", True),
    ("验证码三十分钟内有效。", "5 分钟", False),
    ("首次购买后 30 天内都可以无理由退款。", "14 天", False),
    ("年付相当于月付价格打八折。", "90%", False),
    ("企业版的退款请联系销售处理。", "客户成功经理", False),
    ("我们没有找到您的账号,稍后会有同事联系您。", "注册邮箱|下单时使用的邮箱", False),
    ("请重新绑定银行卡。", "重新授权", False),
    ("导入失败时可以拆分文件。", ".xlsx", False),
    ("这个问题我这边暂时没有查询结果。", "90 天", False),
]
led = Ledger()
pairs, rule_pairs = [], []
for reply, fact, human in CASES:
    j = judge_facts(led, reply, [fact])[fact]
    pairs.append((human, j))
    rule_pairs.append((human, has_fact(reply, fact)))
    print(f"人工={human!s:<5} 规则={has_fact(reply, fact)!s:<5} 评审={j!s:<5} {fact:<10} {reply}")
print("规则", rates(rule_pairs))
print("评审", rates(pairs))
print(f"花费 ¥{led.cost:.4f}")
```

<div class="line-notes">

- `CASES = [` 前 6 条是换说法:「五分钟」「打九折」「十四天」「补齐差额」「再授权一次」「下单时用的邮箱地址」。后 8 条是看着像、其实不对:30 分钟、30 天、八折、销售、没找到账号、重新绑定银行卡。
- `("年付相当于月付价格打九折,比月付划算。", "90%", True),` 「九折」就是 90%,这是昨天说的规则认不得的一类。
- `("验证码三十分钟内有效。", "5 分钟", False),` 反例。评审如果一见到「分钟」就放行,这一条会错。
- `("这个问题我这边暂时没有查询结果。", "90 天", False),` 回复什么事实都没说,不能算提到。
- `j = judge_facts(led, reply, [fact])[fact]` 每条单独调一次,方便对照。
- `rule_pairs.append((human, has_fact(reply, fact)))` 同时记下昨天的规则 `has_fact` 怎么判,放在一起比。
- `print("规则", rates(rule_pairs))` `rates` 是明天要写的函数,这里先用:返回一致率、TPR(人说好的里评审也说好的比例)、TNR(人说不好的里评审也说不好的比例)。

</div>

```bash
uv run python -m scratch.d478.facts_probe
```

```text
人工=True  规则=False 评审=True  5 分钟       验证码五分钟内有效,过期了要重新获取。
人工=True  规则=False 评审=True  90%        年付相当于月付价格打九折,比月付划算。
人工=True  规则=False 评审=True  14 天       首次购买后的十四天内都可以无理由退款。
人工=True  规则=False 评审=True  补差价        系统会按当前周期剩余天数补齐差额。
人工=True  规则=False 评审=True  重新授权       请再授权一次银行账户,然后点立即同步。
人工=True  规则=False 评审=True  注册邮箱|下单时使用的邮箱 请告诉我您下单时用的邮箱地址,我再帮您查。
人工=False 规则=False 评审=False 5 分钟       验证码三十分钟内有效。
人工=False 规则=False 评审=False 14 天       首次购买后 30 天内都可以无理由退款。
人工=False 规则=False 评审=False 90%        年付相当于月付价格打八折。
人工=False 规则=False 评审=False 客户成功经理     企业版的退款请联系销售处理。
人工=False 规则=False 评审=False 注册邮箱|下单时使用的邮箱 我们没有找到您的账号,稍后会有同事联系您。
人工=False 规则=False 评审=False 重新授权       请重新绑定银行卡。
人工=False 规则=False 评审=False .xlsx      导入失败时可以拆分文件。
人工=False 规则=False 评审=False 90 天       这个问题我这边暂时没有查询结果。
规则 {'n': 14, 'pos': 6, 'neg': 8, 'agreement': 0.571, 'TPR': 0.0, 'TNR': 1.0}
评审 {'n': 14, 'pos': 6, 'neg': 8, 'agreement': 1.0, 'TPR': 1.0, 'TNR': 1.0}
花费 ¥0.0084
```

规则对换说法一个都抓不到(TPR 0),评审 14 条全对,花了不到一分钱。**别被这个漂亮的数字说服**。这 14 条是我挑的,每一条的对错都很明显,评审应该对。真正的考题是评测里碰到的那些模棱两可的回复,而且 14 条的样本量说明不了什么,明天会用更正规的办法量。今天只用它确认:代码通了,返回格式对,提示词没有明显的漏洞。

## 第四步:judge_grounded,补「有没有编造」

第二个评审不是 `metrics.py` 里 PRD 指标直接要求的,是我多加的一道保险:回复里的每个具体事实,在资料或工具返回里有没有依据。规则只能查「引用的编号是不是真的」(M2),查不了「引用了 `KB-refund-001`,可回复里那句话文章里根本没写」。它在 `metrics.py` 里是 M2 名下的 `extra` 项,照判,但不算进 M2 的覆盖数:

```python
# supportpilot/evals/judges.py
GROUNDED_V1 = """你是严格的客服质检员。判断【回复】里的每一个具体事实(金额、天数、规则、操作路径、承诺)
是否都能在【资料】或【查询结果】里找到依据。资料没提到的事实,哪怕常识上是对的,也算没有依据。
礼貌用语、复述客户的问题、让客户补充信息,都不算事实。
先在 critique 里逐条列出回复里的事实和对应依据(或者「无依据」),再给结论 passed(全部有依据才是 true)。
只输出 JSON:{"critique": "...", "passed": true 或 false}"""
```

<div class="line-notes">

- `GROUNDED_V1 = """你是严格的客服质检员。` 起名带 V1,因为明天要改它。
- `资料没提到的事实,哪怕常识上是对的,也算没有依据。` 这一句是整份提示词最关键的一句,也是最有后果的一句:它让评审变得很严。常识上对的话,评审也要挑出来,因为它判的是「回复有没有忠于给它的资料」,不是「回复对不对」。
- `礼貌用语、复述客户的问题、让客户补充信息,都不算事实。` 先排除一批明显不该算的。明天会发现这个清单不够长。
- `先在 critique 里逐条列出回复里的事实和对应依据(或者「无依据」),再给结论 passed(全部有依据才是 true)。` 先写理由再给结论。模型是一个字一个字往下生成的,先把账摆出来,结论才基于这笔账。字段顺序也要这样排:`{"critique": ..., "passed": ...}`。

</div>

```python
# supportpilot/evals/judges.py(同一文件,接在 GROUNDED_V1 后面)
GROUNDED_SYS = GROUNDED_V1  # 明天对齐之后改成别的版本


def judge_grounded(ledger: Ledger, reply: str, context: str, findings: str, system: str | None = None) -> dict:
    user = f"【资料】\n{context}\n\n【查询结果】\n{findings or '无'}\n\n【回复】\n{reply}"
    m = chat(ledger, [{"role": "system", "content": system or GROUNDED_SYS}, {"role": "user", "content": user}],
             response_format={"type": "json_object"}, temperature=0)
    d = _json(m.content)
    return {"passed": bool(d.get("passed")), "critique": str(d.get("critique", ""))}
```

<div class="line-notes">

- `GROUNDED_SYS = GROUNDED_V1  # 明天对齐之后改成别的版本` 当前用哪一版提示词,只在这一行指定。明天要换版本,改这一行就够。
- `def judge_grounded(ledger: Ledger, reply: str, context: str, findings: str, system: str | None = None) -> dict:` 比 `judge_facts` 多一个 `system` 参数,明天要拿它比较两版提示词。
- `user = f"【资料】\n{context}\n\n【查询结果】\n{findings or '无'}\n\n【回复】\n{reply}"` 评审看到的东西和起草时看到的一样:前 3 篇文章,加工具查到的结果。没有工具调用的用例,「查询结果」写「无」。
- `return {"passed": bool(d.get("passed")), "critique": str(d.get("critique", ""))}` 模型漏了 `passed` 字段就是 False:评审出错按「不通过」算。

</div>

## 第五步:run_eval,把整条流水线接起来

`to_result` 之后是打分。每条用例:先过规则,再按条件调评审:

```python
# supportpilot/evals/run_eval.py
def score_case(case: Case, run: dict, judge: bool) -> tuple[dict, float]:
    """规则 + 评审。返回 (各项结果, 评审花的钱)。None = 不考。"""
    if run["error"]:
        return {"crashed": False}, 0.0
    r = run["result"]
    scores: dict = run_checks(case, r)
    ledger = agent_stub.Ledger()
    if judge and r["outcome"] != "escalated":
        missed = [f for f in case.expect.facts if not has_fact(r["text"], f)] if scores["facts"] is False else []
        if missed:
            got = judge_facts(ledger, r["text"], missed)
            scores["judge_facts"] = all(got.values())
            run["judge_facts_detail"] = got
        v = judge_grounded(ledger, r["text"], run["context"], run["findings"])
        scores["judge_grounded"] = v["passed"]
        run["judge_grounded_critique"] = v["critique"]
    return scores, ledger.cost


def passes(scores: dict) -> bool:
    """一条用例全过:没有 False;规则的 facts 红了但评审认了的,不算红。"""
    s = dict(scores)
    if s.get("facts") is False and s.get("judge_facts") is True:
        s["facts"] = True
    return all(v is not False for v in s.values())
```

<div class="line-notes">

- `def score_case(case: Case, run: dict, judge: bool) -> tuple[dict, float]:` 返回「各项结果」和「评审花的钱」,钱单独返回,因为被测系统的钱和评审的钱要分开报。
- `return {"crashed": False}, 0.0` 崩了的用例只记一项 `crashed: False`,保证它不算通过,又不污染别的指标。
- `scores: dict = run_checks(case, r)` 昨天的十六项规则,一次拿到全部。
- `if judge and r["outcome"] != "escalated":` 转人工的回复是固定话术,没什么可评的,省掉两次调用。
- `missed = [f for f in case.expect.facts if not has_fact(r["text"], f)] if scores["facts"] is False else []` **只挑规则没找到的事实**。规则已经找到的不再问模型,既省钱,也避免模型把对的判成错的。
- `scores["judge_facts"] = all(got.values())` 漏掉的事实评审全认了,才算 True。
- `scores["judge_grounded"] = v["passed"]` 不转人工的回复都要过这一项。
- `run["judge_grounded_critique"] = v["critique"]` 理由存进这次运行的记录。明天读评审错在哪,靠的就是它。
- `def passes(scores: dict) -> bool:` 一条用例算不算全过。
- `if s.get("facts") is False and s.get("judge_facts") is True:` 规则的 `facts` 红了、评审认了,就当事实点提到了。这是整个「两步走」的终点:规则先判,评审只负责翻案,不能把规则判过的判成不过。
- `return all(v is not False for v in s.values())` `is not False`:`None`(不考)不算失败。

</div>

汇总:

```python
# supportpilot/evals/run_eval.py
def aggregate(rows: list[dict]) -> dict:
    items: dict[str, list[bool]] = defaultdict(list)
    for r in rows:
        if r["run"]["error"]:
            continue
        for k, v in r["scores"].items():
            if v is not None:
                items[k].append(bool(v))
    lat = sorted(r["run"]["latency_s"] for r in rows)
    multi = [r["all_pass"] for r in rows if "multi_turn" in r["tags"]]
    fh = [fact_hits(Case.model_validate(r["case"]), r["run"]["result"]) for r in rows if not r["run"]["error"]]
    return {
        "n": len(rows), "errors": sum(1 for r in rows if r["run"]["error"]),
        "all_pass": round(sum(r["all_pass"] for r in rows) / len(rows), 3),
        "items": {k: [sum(v), len(v)] for k, v in sorted(items.items())},
        "fact_points": [sum(a for a, _ in fh), sum(b for _, b in fh)],
        "multi_turn_pass": [sum(multi), len(multi)],
        "avg_cost_cny": round(statistics.mean(r["run"]["cost_cny"] + r["judge_cost"] for r in rows), 5),
        "agent_cost_cny": round(statistics.mean(r["run"]["cost_cny"] for r in rows), 5),
        "p50_latency_s": lat[len(lat) // 2], "p95_latency_s": lat[min(len(lat) - 1, int(len(lat) * 0.95))],
    }


def metric_table(agg: dict) -> list[tuple[str, str, str, str]]:
    """(指标, 名称, 目标, 实测),实测是该指标名下非 extra 评测项的合并通过率。"""
    metrics = parse_prd_metrics(PRD.read_text(encoding="utf-8"))
    out = []
    for m in metrics.values():
        if m.id == "M3":
            h, n = agg["fact_points"]
            real = f"{h}/{n} = {h / n:.0%}(事实点)" if n else "—"
        elif m.id == "M12":
            real = f"{agg['all_pass']:.1%}"
        elif m.id == "M13":
            real = f"¥{agg['avg_cost_cny']:.4f}"
        elif m.id == "M14":
            real = f"{agg['p95_latency_s']}s"
        elif m.id == "M15":
            a, b = agg["multi_turn_pass"]
            real = f"{a}/{b}" if b else "—"
        else:
            names = [i.name for i in ITEMS if m.id in i.metrics and not i.extra and i.layer == "rule"]
            a = sum(agg["items"].get(n, [0, 0])[0] for n in names)
            b = sum(agg["items"].get(n, [0, 0])[1] for n in names)
            real = f"{a}/{b} = {a / b:.1%}" if b else "没有用例"
        out.append((m.id, m.name, m.target, real))
    return out
```

<div class="line-notes">

- `def aggregate(rows: list[dict]) -> dict:` 把 72 行结果汇成一张总表。
- `if r["run"]["error"]:` 崩了的用例不进指标表,只在 `errors` 里统计。
- `if v is not None:` 昨天的约定:None 不进分母。`must_call` 的通过率只在有必调工具的用例里算。
- `lat = sorted(r["run"]["latency_s"] for r in rows)` 排好序取分位数。
- `multi = [r["all_pass"] for r in rows if "multi_turn" in r["tags"]]` M15:多轮用例里全过的占比。dev 里只有 3 条多轮,后面会看到这个数字多脆弱。
- `fh = [fact_hits(Case.model_validate(r["case"]), r["run"]["result"]) for r in rows if not r["run"]["error"]]` M3 按事实点算:一条用例 3 个事实答出 2 个是 2/3。昨天的 `fact_hits` 用的是规则,所以这一行的事实覆盖是**规则口径**,没把评审翻案的算进去。
- `"avg_cost_cny": round(statistics.mean(r["run"]["cost_cny"] + r["judge_cost"] for r in rows), 5),` M13 平均成本包含评审的钱;下一行的 `agent_cost_cny` 只算被测系统,对照着看评审贵不贵。
- `"p50_latency_s": lat[len(lat) // 2], "p95_latency_s": lat[min(len(lat) - 1, int(len(lat) * 0.95))],` 72 个数取下标 `int(72 × 0.95) = 68`,就是第 69 小的那个。`min(...)` 防止用例很少时下标越界。
- `def metric_table(agg: dict) -> list[tuple[str, str, str, str]]:` 把汇总对到 PRD 的 16 条指标上。
- `metrics = parse_prd_metrics(PRD.read_text(encoding="utf-8"))` 目标是**从 PRD 文件里读的**,不在代码里再写一份。PRD 改了目标,报告自动跟着变。这个函数是 Day 476 写的。
- `names = [i.name for i in ITEMS if m.id in i.metrics and not i.extra and i.layer == "rule"]` 一条指标的实测值 = 它名下**规则项**的合并通过率,`extra` 项不算(`right_customer` 对每条用例都考,算进去会把 M4 拉虚高)。

</div>

最后是命令行入口。`--rescore` 这个参数今天只用一次,明天会反复用:

```python
# supportpilot/evals/run_eval.py
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", default="dev", choices=["dev", "test", "all"])
    ap.add_argument("--only", default="")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--label", default="run")
    ap.add_argument("--no-judge", action="store_true")
    ap.add_argument("--rescore", default="", help="读这份报告 json 里存的运行结果,只重新打分,不重跑被测系统")
    ap.add_argument("--workers", type=int, default=1)
    args = ap.parse_args()

    cases = load_cases()
    if args.split != "all":
        cases = [c for c in cases if c.split == args.split]
    if args.only:
        keep = set(args.only.split(","))
        cases = [c for c in cases if c.scenario in keep]
    if args.limit:
        cases = cases[: args.limit]

    if args.rescore:
        saved = {r["id"]: r["run"] for r in json.loads(Path(args.rescore).read_text(encoding="utf-8"))["results"]}
        runs = [{k: v for k, v in saved[c.id].items() if not k.startswith("judge_")} for c in cases]
    else:
        with ThreadPoolExecutor(args.workers) as ex:
            runs = list(ex.map(lambda p: run_case(*p), [(c, n) for n, c in enumerate(cases)]))

    rows = []
    for i, (case, run) in enumerate(zip(cases, runs, strict=True), start=1):
        scores, jcost = score_case(case, run, not args.no_judge)
        ok = passes(scores)
        rows.append({"id": case.id, "scenario": case.scenario, "tags": case.tags, "case": case.model_dump(),
                     "scores": scores, "all_pass": ok, "judge_cost": jcost, "run": run})
        print(f"[{i}/{len(cases)}] {'PASS' if ok else 'FAIL'} {case.id} ¥{run['cost_cny'] + jcost:.4f} {run['latency_s']}s")

    agg = aggregate(rows)
    REPORTS.mkdir(exist_ok=True)
    stem = REPORTS / f"{datetime.now():%Y%m%d-%H%M}-{args.split}-{args.label}"
    stem.with_suffix(".json").write_text(json.dumps({"label": args.label, "aggregate": agg, "results": rows},
                                                    ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    stem.with_suffix(".md").write_text(to_markdown(args.label, args.split, agg, rows), encoding="utf-8")
    total = sum(r["run"]["cost_cny"] + r["judge_cost"] for r in rows)
    print(f"总花费 ¥{total:.4f}  report: {stem}.md")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `ap.add_argument("--only", default="")` 按场景名筛,调试时只跑几个场景,秒级出结果。
- `ap.add_argument("--rescore", default="", help="读这份报告 json 里存的运行结果,只重新打分,不重跑被测系统")` **评测里最省钱的一个参数**。被测系统跑一遍要 ¥0.31,打分只要几分到一毛多。改规则、改评审提示词之后,不用重跑被测系统,拿上次存下的运行结果重新打分就行。
- `runs = [{k: v for k, v in saved[c.id].items() if not k.startswith("judge_")} for c in cases]` 重打分时把旧的评审结果去掉,免得和新的混在一起。
- `with ThreadPoolExecutor(args.workers) as ex:` 默认 `--workers 1`,串行跑。并行当然快,但延迟的数字会被并发拖偏,M14 要的是单张工单的延迟,所以基线用串行。
- `print(f"[{i}/{len(cases)}] {'PASS' if ok else 'FAIL'} {case.id} ¥{run['cost_cny'] + jcost:.4f} {run['latency_s']}s")` 每条一行,跑的时候能看到进度和每条花多少。
- `stem = REPORTS / f"{datetime.now():%Y%m%d-%H%M}-{args.split}-{args.label}"` 文件名带时间、split 和标签,不会互相覆盖。
- `total = sum(r["run"]["cost_cny"] + r["judge_cost"] for r in rows)` 跑完打印总花费。

</div>

## 第六步:跑 dev,第一份分数

先确认 `.env` 里模型是 `deepseek-flash`,价格那一行是 `LLM_PRICE=0.04,2,8`。然后:

```bash
uv run python -m evals.run_eval --split dev --label baseline
```

72 条串行跑,要等几分钟。结尾:

```text
[70/72] FAIL mt_ask_then_refund-1 ¥0.0131 11.07s
[71/72] FAIL mt_ask_then_refund-2 ¥0.0120 10.62s
[72/72] PASS mt_upgrade_price-1 ¥0.0104 6.26s
总花费 ¥0.5201  report: .../evals/reports/20261027-1430-dev-baseline.md
```

花费的算式:被测系统 ¥0.3091(72 条,共 279 次模型调用),评审 ¥0.2110,合计 ¥0.5201。平均每张工单 0.5201 ÷ 72 = ¥0.00722,对 PRD 里 M13 的 ¥0.05 上限差得很远。报告前半截:

```text
- split:dev  用例数:72  崩溃:0
- 全部检查通过率:0.556
- 平均成本:¥0.00722(其中被测系统 ¥0.00429)  P50 4.29s  P95 6.87s
- 评审和被测都是 deepseek-flash

| 指标 | 名称 | 目标 | 实测 |
| --- | --- | --- | --- |
| M1 | 检索命中率(recall@5) | ≥ 90% | 61/63 = 96.8% |
| M2 | 引用合法率 | 100% | 135/135 = 100.0% |
| M3 | 事实覆盖率 | ≥ 80% | 60/63 = 95%(事实点) |
| M4 | 工具调用正确率 | ≥ 90% | 33/38 = 86.8% |
| M5 | 身份不明不泄露率 | 100% | 1/2 = 50.0% |
| M6 | 退款金额正确率 | 100% | 11/15 = 73.3% |
| M7 | 退款闸门正确率 | 100% | 23/27 = 85.2% |
| M8 | 大额复核标记率 | 100% | 没有用例 |
| M9 | 禁止承诺通过率 | 100% | 72/72 = 100.0% |
| M10 | 转人工召回率 | 100% | 71/72 = 98.6% |
| M11 | 涉及金额草稿进待确认率 | 100% | 11/15 = 73.3% |
| M12 | 全部检查通过率 | dev ≥ 80%,test 与 dev 差距 ≤ 5 个点 | 55.6% |
| M13 | 单张工单平均成本 | ≤ ¥0.05 | ¥0.0072 |
| M14 | 端到端 P95 延迟 | ≤ 25 秒,首个字 ≤ 8 秒 | 6.87s |
| M15 | 多轮用例通过率 | ≥ 80% | 1/3 |
| M16 | 分类准确率 | ≥ 90% | 62/68 = 91.2% |
```

逐条对一遍目标,不要只看总分:

- **达标的**:M1(96.8%)、M2、M3、M9(禁止承诺 72/72)、M13、M14、M16(91.2%,刚过线)。
- **没达标的**:M4(86.8%,目标 90)、M5(1/2)、M6(73.3%)、M7(85.2%)、M10(98.6%)、M11(73.3%)、M12(55.6%,目标 80)、M15(1/3)。
- **M8 没有用例**,不是达标,是没考。昨天说的已知缺口。

几条要小心读。M5 只有 2 条用例在考,1/2 是 50%,但那是一条用例的差别,别当成「泄露率 50%」。M15 是 3 条里过 1 条,同理。M14 的 6.87 秒是**替身**的延迟,串行、模型小、检索不走网络,真系统会慢得多。M6 的 100% 目标在这个替身上要打折扣地看,前面说过金额是替身和标准答案共用一份代码算的;这里 73.3% 掉分,不是金额算错,是**根本没建申请**,所以金额是 None。

PRD 里写过一句:「Day 478 跑出第一份分数后,太高或太低就调,并在 PRD 里记下为什么调。」今天我**一条目标都不改**。理由有两个:一,现在还分不清哪些红是被测系统的毛病、哪些是评测本身的毛病,拿这样的数字去改目标等于拿噪声改规格;二,至少有一个数字(M12)我怀疑它被评审拉低了。

## 差的那 25 个点

最值得盯的是总分。同一份运行结果,不调评审、只用规则重新打一遍(`--rescore` 不花被测系统的钱,`--no-judge` 连评审的钱也不花):

```bash
B=$(ls evals/reports/*dev-baseline.json)
uv run python -m evals.run_eval --rescore $B --no-judge --label rules-only
```

```text
[72/72] PASS mt_upgrade_price-1 ¥0.0062 6.26s
总花费 ¥0.3091  report: .../evals/reports/20261027-1434-dev-rules-only.md
```

<figure>
<svg viewBox="0 0 640 170" role="img" aria-label="同一份运行结果的全部检查通过率:只用规则 80.6%,加上第一版评审 55.6%;评审的 judge_grounded 通过 43 条、没通过 24 条">
<g font-family="var(--font-mono)" font-size="12">
<text x="10" y="36" fill="var(--ink)">只用规则</text>
<rect x="110" y="20" width="403" height="24" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="522" y="37" fill="var(--ink)">80.6%</text>
<text x="10" y="86" fill="var(--ink)">规则 + 评审</text>
<rect x="110" y="70" width="278" height="24" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="397" y="87" fill="var(--ink)">55.6%</text>
<line x1="110" y1="108" x2="110" y2="14" stroke="var(--rule)"/>
<line x1="513" y1="108" x2="513" y2="14" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
<text x="400" y="128" fill="var(--ink-faint)">PRD 目标 dev ≥ 80%</text>
<text x="10" y="156" fill="var(--ink-soft)">judge_grounded:43 条通过 / 24 条没通过(共 67 条)</text>
</g>
</svg>
<figcaption>同一批运行结果,换一种打分方式,总分差 25 个点。多出来的红几乎全在 judge_grounded 这一项上。</figcaption>
</figure>

规则 80.6%,加上评审 55.6%。评审多判了 24 条回复「有无依据的事实」,这 24 条里大部分挑的是同一件事。失败清单里翻几条回复看看(例如 `refund_first14-1`、`refund_ask_only-2`、`boundary_day15-1`),再看它们的 `judge_grounded_critique`,你会发现 24 条里有 16 条的理由里出现了同一个词:「原路退回」。

这是什么意思?两种可能。一,被测系统真的在编造(「原路退回」资料里没写)。二,评审的标准定得和我们对「好」的理解不一致。前面说过,`DRAFT_SYS` 里**明文写着**让模型说「审核通过后原路退回」。一个提示词要求模型说的话,评审却判它「无依据」,这听起来更像评审的毛病。

到底是哪一种,今天不下结论。**这正是第二层评审最危险的地方:它会给你一个看起来很具体的理由,让人信以为真,去改一个本来没问题的被测系统。**明天专门验评审本身:自己当质检员标一批,和评审对照,算它的 TPR 和 TNR。先记下今天的结论:这份 55.6% 不能直接拿去改提示词。

## 零件和大代码的对照

| 零件 | 在哪个文件 | 做什么 |
| --- | --- | --- |
| `Ledger`、`chat` | `evals/agent_stub.py` | 所有模型调用的唯一出口,按真实 usage 记账 |
| `retrieve`、`run_tool` | `evals/agent_stub.py` | 替身的检索和四个工具 |
| `triage`、`act`、`draft`、`run_ticket` | `evals/agent_stub.py` | 替身的节点和串联;键对齐真图 |
| `to_result` | `evals/run_eval.py` | 被测系统最终状态到 `Result` 的翻译层 |
| `judge_facts` | `evals/judges.py` | 只判规则漏掉的事实点 |
| `judge_grounded` | `evals/judges.py` | 回复有没有依据,先 critique 后结论 |
| `score_case`、`passes` | `evals/run_eval.py` | 规则先判,评审只翻案;None 不算红 |
| `aggregate`、`metric_table` | `evals/run_eval.py` | 汇总,并按 PRD 的目标读出实测值 |
| `--rescore` | `evals/run_eval.py` | 只重新打分,不重跑被测系统 |

## 动手练习

### 练习 1:只重打分几个场景

不花钱:用 `--rescore` 只取 `refund_first14` 和 `refund_ask_only` 两个场景,不调评审,看规则判的结果。

<details><summary>参考答案</summary>

```bash
B=$(ls evals/reports/*dev-baseline.json)
uv run python -m evals.run_eval --rescore $B --only refund_first14,refund_ask_only --no-judge --label probe
```

`--only` 先按场景名筛出 6 条用例,`--rescore` 从旧报告里按 `id` 找回这 6 条的运行结果,`--no-judge` 不调评审,所以被测系统的钱也是读存下来的数。报告里 `all_pass` 应该是 6/6:这两个场景在规则层没有一条红。红的都是评审给的(`judge_grounded`),这和上一节的结论一致。

</details>

### 练习 2:读 `judge_facts` 判过的三条

基线里规则的 `facts` 项红了 3 条(`invoice_how-1`、`past_due-1`、`enterprise_refund-1`),评审被叫来看了这 3 条。读一下回复和期望的事实,判断评审判得对不对。

<details><summary>参考答案</summary>

三条评审都判了「没提到」,三条都对:

- `invoice_how-1`:期望事实「90 天」。回复讲了入口、境外公司、专用发票,最后说「具体申请页面位置我这边暂无查询结果」,没有提 90 天。检索第 4 名才是 `KB-invoice-001`,起草只读前 3 篇,没读到。
- `past_due-1`:期望「逾期」。回复说账套变只读是因为超出套餐账套上限,问客户是不是降过级。方向都不对,没提逾期。这条还没调任何工具。
- `enterprise_refund-1`:期望「客户成功经理」。回复说「需转交销售处理」。意思不同,评审判对了。

所以这 3 条里评审没有冤枉任何一条,规则的红是真的红。这也是一个提醒:评审在「翻案」这个角色上今天没有显出价值,它最大的价值是明天要看的另一个。

</details>

### 练习 3:先算,再跑

估算跑一遍 test 集(28 条)的花费。不要跑。给出算式。

<details><summary>参考答案</summary>

dev 72 条总共 ¥0.5201,平均每条 ¥0.00722。28 × 0.00722 ≈ ¥0.20。保守一点,test 里多轮和对抗用例比例高(多轮的一条要 ¥0.011 到 ¥0.013),可以估 ¥0.20 到 ¥0.25。我没跑:test 集是留着最后验收的,[Day 483](/blog/agent-zero/day-483-iterate-3/) 才用,今天一次都不碰。

</details>

### 练习 4:算一算,「规则 80.6%」是怎么来的

不跑代码。`rules-only` 报告里全部通过 80.6%,对 72 条是多少条通过?加上第一版评审是 55.6%,又是多少条?

<details><summary>参考答案</summary>

0.806 × 72 = 58.0,所以 58 条通过、14 条失败。0.556 × 72 = 40.0,40 条通过、32 条失败。多出来的 18 条是「规则通过、但评审判了没依据」的用例,它们的红只来自 `judge_grounded`(24 条评审没通过的里有 18 条规则原本是过的,其余 6 条规则也红)。

</details>

验收标准:`uv run python -m evals.run_eval --split dev --label baseline` 跑通并生成 `.md` 和 `.json`;报告里 M1–M16 逐条和 PRD 目标对过;能解释 80.6% 和 55.6% 为什么不一样;test 集一次没跑。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 模型评审(LLM-as-a-judge) | 让一个模型给另一个模型的输出判对错。像一个会读中文的单元测试,但它自己也会判错 |
| 二元判断 | 评审只回答过或不过,不打 1–10 分。分数的波动大半是噪声 |
| `critique` | 评审先写的理由。字段排在结论前面,让模型先摆证据再下结论 |
| 基线(baseline) | 第一次跑出来的整张分数表,以后每次改动都和它比 |
| 替身(stub) | 用来代替真实系统的精简实现。今天的 `agent_stub.py` 代替 SupportPilot 的图 |
| 翻译层 | 被测系统的内部状态和评测代码之间的转换函数。今天的 `to_result` |
| `--rescore` | 不重跑被测系统,只用存下来的运行结果重新打分。改规则、改评审提示词时省钱 |
| `extra` 项 | 多加的一道保险,照判,但不算进指标的覆盖数([Day 476](/blog/agent-zero/day-476-eval-scenarios/) 讲过) |
| 缓存命中 | 请求开头和上次相同的部分,按更低的价格计费。DeepSeek 命中价是未命中的 1/50 |

## 常见误区

**拿评审的分数当真相。**评审是第二个会出错的模型。第一次跑出来比规则低 25 个点,不要先去改被测系统,先怀疑评审。

**把能用规则判的也交给评审。**评审贵、慢、同一条回复跑两次可能不同。昨天的规则一条回复判十六项只要毫秒;今天只让评审补规则漏掉的。

**评审和被测用同一个模型,却不说。**模型更容易认可风格接近的回复。能换就换,换不了就在报告里写明。今天的报告第 4 行就写着。

**不存运行结果,每次都重跑。**被测系统跑一遍 ¥0.31,打分才 ¥0.2 以内。把运行结果存进 json,用 `--rescore` 重新打分,调评审提示词时一分钱被测系统的钱都不用花。

**看到「没达标」就改目标。**目标是 PRD 里写的规格,不是随手可调的参数。要改,先搞清楚红是谁的毛病,并在 PRD 里记下为什么改。

**用 1/2、1/3 这样的小样本当结论。**M5 和 M15 在 dev 里只有 2 条和 3 条用例。一条之差就是 50 个点。小样本的指标只能当线索,不能当结论。

## 学习资料

### 文档与文章

- [Hamel Husain · Using LLM-as-a-Judge For Evaluation: A Complete Guide](https://hamel.dev/blog/posts/llm-judge/):英文,把「怎么搭一个能用的评审」讲得最实在:二元判断、先批评后结论、拿人工标注对齐。今天的设计出处。
- [Eugene Yan · Evaluating the Effectiveness of LLM-Evaluators](https://eugeneyan.com/writing/llm-evaluators/):英文,把评审的各种做法和已知偏差(自我偏好、位置偏差)列了一遍,看一下「自己给自己打分」那段。
- [Anthropic · Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):英文,讲 Agent 评测里判分器(grader)的三种:代码、模型、人。
- [DeepSeek · 模型和价格](https://api-docs.deepseek.com/quick_start/pricing):查今天用的价格和缓存命中的计费规则。
- [DeepSeek · 硬盘缓存](https://api-docs.deepseek.com/guides/kv_cache):为什么系统提示词放稳定会更便宜。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1DCrVBREA8&autoplay=0&high_quality=1" title="没有评估的 Agent,注定不可规模化:Anthropic《Demystifying evals for AI agents》①" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>慢学AI · 没有评估的 Agent,注定不可规模化:Anthropic《Demystifying evals for AI agents》① · 6 分钟,解读 Anthropic 那篇评测文章的核心观点,看完去读原文里 grader 那几节。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1NaszzwEaT&autoplay=0&high_quality=1" title="AI PM的核心竞争力:evals评测体系,产品优化不再靠玄学,效率提升十倍①" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>慢学AI · AI PM的核心竞争力:evals评测体系,产品优化不再靠玄学,效率提升十倍① · 10 分钟,从产品经理的角度讲评测集和打分的关系,对照今天的基线报告看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/tqUDjc1HzO4" title="How to Automate AI Evals (Correctly)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hamel Husain · How to Automate AI Evals (Correctly) · 英文,开字幕。什么时候该用代码检查,什么时候才上评审,以及评审怎么和人工对齐,和今天的分层、明天的对齐直接对应。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):评测方法论那几章讲精确匹配、模型评审各自的适用范围和偏差,和今天「规则先行、评审兜底」对得上。英文。

### 开源项目与代码

- [UKGovernmentBEIS/inspect_ai](https://github.com/UKGovernmentBEIS/inspect_ai):英国 AI 安全研究所的评测框架,有 `scorer` 的概念,可以看它怎么把规则判分和模型判分放在同一个接口下,和我们的 `run_checks` + `judge_*` 一个位置。
- [openai/evals](https://github.com/openai/evals):OpenAI 早年的评测框架,看它的评测数据和判分器的拆法。

## 自测

1. 为什么 `judge_facts` 只拿规则没找到的事实去问模型,而不是把所有事实都问一遍?

<details><summary>答案</summary>

三个原因。省钱:大部分事实点是数字和术语,规则已经找到了,不必再花钱。稳:规则判过的就是过了,模型不会把对的判成错的。可解释:红了哪一项一眼知道是规则还是评审。评审只负责「翻案」:规则红、评审认了,算过。

</details>

2. `to_result` 里 `refund_executed` 为什么直接写死 `False`,而不是从状态里读?

<details><summary>答案</summary>

替身里根本没有执行退款的工具,状态里没有这个键可读。写死 False 并在注释里说明,是诚实:它测的是「模型拿不到这类工具」这条设计是否成立,不是被测系统运行时的某个量。换成真图时,如果真图有这个信号,才改成从状态里读。

</details>

3. `--rescore` 解决什么问题?

<details><summary>答案</summary>

评测里最贵的是跑被测系统。改规则、改评审提示词时,被测系统的输出没变,重跑只是白花钱。`--rescore` 读上次存下的运行结果,只重新打分。今天的 `rules-only` 报告就是这样来的,被测系统的钱一分没多花。

</details>

4. 第一份基线里 M5 是 1/2,M15 是 1/3。能不能据此说「身份不明的泄露率 50%」?

<details><summary>答案</summary>

不能。dev 里只有 2 条在考 M5,3 条在考 M15,差一条就是 50 个点和 33 个点。样本太小,只能当线索,不能当结论。要得到可靠的数字,得补用例,或者把 test 集合并起来看。

</details>

5. 面试题:评审模型和被测模型是同一个,会有什么问题?你怎么处理?

<details><summary>答案</summary>

示范回答:模型倾向于给自己风格的输出更高分(自我偏好),所以分数会偏乐观,同时它和被测模型可能共享同样的盲点,该抓的抓不到。处理:能换就用另一个、更强的模型当评审;换不了就在报告里写明,同时用一批人工标注的样本测评审自己的 TPR 和 TNR,看它到底靠不靠谱。我今天的做法是同一个 `deepseek-flash`,报告里写明,下一步做人工对齐。

</details>

## 明天预告

明天是 [Day 479](/blog/agent-zero/day-479-eval-meta/),评测(四):评审本身准不准,测评测代码。今天留下一个悬案:评审给的 24 条「没依据」里,16 条的理由是同一个词。明天自己当质检员标一批回复,和评审对照,算 TPR 和 TNR;再造一批「已知有问题」的回复,看评审抓不抓得住;然后改评审提示词,用没参与调优的留出集验证;最后给评测代码本身写测试,并故意改坏它,看测试抓不抓得住。
