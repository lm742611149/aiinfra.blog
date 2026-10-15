---
title: 'Day 125 · BillSleuth(四):有据可查的解释,不许编数字'
description: '把调查结论写成两份解释:给客户的大白话版和给同事的带证据编号版。写一个数字溯源校验器,检查回答里每个金额和百分比能不能在证据链里找到出处,不过就把问题清单交回模型重写,三次不行用模板兜底。附真实运行里校验器误伤、漏网和抓到问题的几个案例。'
pubDate: 2026-10-15
regime: none
tags: ['grounding', 'hallucination', 'citation', 'billing', 'agent-60']
series: 'agent-60'
day: 125
lang: 'zh'
---

## 今天要解决的问题

昨天的 Agent 能查出「多收了 26.02,原因是时区」,但这只是一份给机器看的结论。客户要的是一段能看懂的话,同事要的是一段能复核的说明。今天把结论变成这两段文字,而且要保证一件事:**里面出现的每一个数字都有出处**。计费场景里,解释写得再漂亮,只要有一个金额是编的,客户就会觉得整段话都不可信。学完你应该能:

1. 说清楚客户版和内部版解释各自的读者、内容和禁忌,写出对应的写作规则。
2. 实现一个数字溯源校验器:从文本里抽出金额和百分比,逐个在证据链里找出处,区分「有出处」「由两条证据推导」「找不到出处」三种情况。
3. 把校验器接进一个「写作 → 校验 → 带着问题清单重写」的循环,最多重写两次,还不过就用模板兜底。
4. 知道这类校验器的边界:它能挡住编造的数字,挡不住「数字是真的、用错了地方」,并用一条针对性检查补上最关键的那个数。
5. 用真实运行的记录说明校验器什么时候误伤、什么时候漏网、什么时候真的帮了忙。

预计用时 4 小时。前置:Day 124 的调查图和证据链。

## 两份解释,两个读者

同一个结论,写给两种人看,要求几乎相反。

**客户版**的读者是客户,可能是财务,可能是老板,不懂计费术语,也不想懂。规则是:先给结论(有没有多收、多收多少),再用一两句大白话讲原因,最后说下一步。不出现英文代码、工具名、根因类别名,不出现证据编号。多收的情况,只能说「已提交更正申请,审核通过后会退回或抵扣」,**不能承诺退款时间和结果**,因为贷记单还要人批(Day 126),Agent 承诺了而主管驳回,公司就失信了。语气平和,不甩锅,也不过度道歉,一句「给您添麻烦了」够了。

**内部版**的读者是处理这单的同事,可能是主管,可能是下一个接手的客服。规则是:写清根因类别、关键证据、算式,每个数字后面跟证据编号。它要能让人在不重查一遍的情况下判断 Agent 说得对不对。

为什么不只写一份,让客户版也带编号?因为客户看到「[E17]」只会困惑。我们的做法是两份都让模型带编号写,两份都过校验,客户版在发出之前再把编号去掉。这样客户版里的每个数字,在去掉编号之前都是经过核对的。

## 数字溯源校验器

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="写作-校验-重写循环:模型写两份解释,校验器逐个检查金额和百分比,不通过则带问题清单重写,三次不通过用模板兜底">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
  <rect x="20" y="30" width="140" height="56" fill="none" stroke="var(--ink-soft)" rx="4"/>
  <text x="90" y="53" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">结论 + 证据链</text>
  <text x="90" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">E1…En</text>
  <line x1="160" y1="58" x2="205" y2="58" stroke="var(--ink-soft)" marker-end="url(#a125)"/>
  <rect x="205" y="30" width="150" height="56" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="280" y="53" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">模型写两份</text>
  <text x="280" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">数字后标 [E#]</text>
  <line x1="355" y1="58" x2="400" y2="58" stroke="var(--ink-soft)" marker-end="url(#a125)"/>
  <rect x="400" y="20" width="220" height="110" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="510" y="40" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">校验器(纯代码)</text>
  <text x="410" y="62" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">金额/百分比 → 在证据里找</text>
  <text x="410" y="80" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">引用编号 → 存在且值对得上</text>
  <text x="410" y="98" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">客户版 → 禁用词、内部用语</text>
  <text x="410" y="116" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">多收金额 → 必须写出来</text>
  <path d="M510 130 L510 170 L280 170 L280 86" fill="none" stroke="var(--compute)" marker-end="url(#a125)"/>
  <text x="300" y="162" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">不通过:问题清单交回重写(最多 2 次)</text>
  <line x1="620" y1="75" x2="630" y2="75" stroke="var(--ink-soft)"/>
  <rect x="400" y="200" width="220" height="44" fill="none" stroke="var(--ink)" rx="4"/>
  <text x="510" y="218" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">通过:客户版去掉编号</text>
  <text x="510" y="235" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">内部版保留编号</text>
  <line x1="580" y1="130" x2="580" y2="200" stroke="var(--ink-soft)" marker-end="url(#a125)"/>
  <rect x="20" y="200" width="220" height="44" fill="none" stroke="var(--ink-faint)" stroke-dasharray="4 3" rx="4"/>
  <text x="130" y="218" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">三稿都不过:模板兜底</text>
  <text x="130" y="235" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">数字只取证据,标记人工复核</text>
  <text x="20" y="280" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">校验器管「有没有出处」,不管「用得对不对」;最关键的多收金额单独检查</text>
  <defs><marker id="a125" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
</svg>
<figcaption>琥珀色的校验器是纯代码,不调模型。这是整个项目里「不信任模型输出」最直接的一处。</figcaption>
</figure>

```python
# billsleuth/billsleuth/grounding.py
"""数字溯源校验器(Day 125):回答里出现的每个金额、每个百分比,都必须能在证据链里找到出处。

规则从严到松:
1. 句子里引用了 [E12],这个金额就必须等于 E12 的值(引用错了比不引用更糟);
2. 没有引用,但金额等于某条证据的值:算有据,提示「建议补引用」;
3. 金额等于两条证据之差或之和:算「推导」,允许,但在内部版里要说明;
4. 以上都不是:编造,打回重写。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from itertools import combinations

AMOUNT = re.compile(r"(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?\s*(美元|美金|USD|元)|(?<![\w.\-])(\d+\.\d{2})(?![\d%])")
PERCENT = re.compile(r"(\d+(?:\.\d+)?)\s*%")
CITE = re.compile(r"\[(E\d+)\]")
SENTENCE = re.compile(r"[^。!?;\n]+[。!?;\n]?")
BANNED = ["保证退款", "一定会退", "已退款", "已经退款", "已经退还", "马上到账", "立即退款", "全额赔偿"]
INTERNAL_WORDS = re.compile(r"\b[a-z]+_[a-z_]+\b|recompute|SubmitFindings|E\d+")


@dataclass
class Report:
    ok: bool
    problems: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    derived: list[str] = field(default_factory=list)


def _dec(s: str) -> Decimal | None:
    try:
        return Decimal(s.replace(",", ""))
    except InvalidOperation:
        return None


def amounts(text: str) -> list[Decimal]:
    out = []
    for m in AMOUNT.finditer(text):
        raw = (m.group(1) + (m.group(2) or "")) if m.group(1) else m.group(4)
        d = _dec(raw)
        if d is not None:
            out.append(d.quantize(Decimal("0.01")))
    return out


def percents(text: str) -> list[Decimal]:
    return [(Decimal(p) / 100).normalize() for p in PERCENT.findall(text)]


def check(text: str, evidence: list[dict], customer_view: bool = False) -> Report:
    by_id = {e["id"]: e for e in evidence}
    values: set[Decimal] = set()
    for e in evidence:
        d = _dec(e["value"])
        if d is not None:
            values.add(d.quantize(Decimal("0.01")) if abs(d) >= 1 or d == 0 else d.normalize())
    money_vals = {v for v in values if v == v.quantize(Decimal("0.01"))}
    rate_vals = {v.normalize() for v in values if abs(v) < 1}
    for e in evidence:
        rate_vals.update(percents(e["claim"]))  # 行描述里写着「(9%)」也算出处
        if "percent" in e["claim"] and (d := _dec(e["value"])) is not None:
            rate_vals.add((d / 100).normalize())  # 百分比优惠券存的是 20,表示 20%
    rep = Report(ok=True)

    for sent in SENTENCE.findall(text):
        cited = CITE.findall(sent)
        for c in cited:
            if c not in by_id:
                rep.problems.append(f"引用了不存在的证据 [{c}]:{sent.strip()}")
        cited_vals = {_dec(by_id[c]["value"]) for c in cited if c in by_id}
        for a in amounts(sent):
            if cited and a not in {v.quantize(Decimal('0.01')) for v in cited_vals if v is not None} and a in money_vals:
                rep.warnings.append(f"{a} 有出处,但不是句中引用的那条证据:{sent.strip()}")
            elif a in money_vals or -a in money_vals:
                if not cited and not customer_view:
                    rep.warnings.append(f"{a} 有出处但没标引用:{sent.strip()}")
            elif any(abs(x - y) == a or x + y == a for x, y in combinations(money_vals, 2)):
                rep.derived.append(f"{a}(由两条证据相减或相加得到):{sent.strip()}")
            else:
                rep.problems.append(f"金额 {a} 在证据里找不到出处:{sent.strip()}")
        for p in percents(sent):
            if p not in rate_vals:
                rep.problems.append(f"百分比 {p * 100:g}% 在证据里找不到对应税率或折扣:{sent.strip()}")

    if customer_view:
        for w in BANNED:
            if w in text:
                rep.problems.append(f"客户版不能出现「{w}」:退款要审批,不能提前承诺")
        if m := INTERNAL_WORDS.search(CITE.sub("", text)):
            rep.problems.append(f"客户版出现了内部用语「{m.group(0)}」")
    rep.ok = not rep.problems
    return rep


def strip_citations(text: str) -> str:
    return re.sub(r"\s*\[E\d+\]", "", text)
```

规则从严到松一共四档,写在文件开头的注释里。挑几处讲实现上的取舍。

**怎么认出一个金额**。`AMOUNT` 正则认两种写法:带单位的(「26 美元」「1,438.44 USD」「30 元」),和不带单位但正好两位小数的(「26.02」)。不带单位的整数不算金额,否则「15 天」「3 个月」「第 2 行」都会被当成金额去找出处,误报满天飞。代价是「多收了 26」这种既没小数也没单位的写法会漏掉,我认为可以接受,因为写作规则要求金额带两位小数,模型基本都会照做。

**引用编号要对得上**。如果一句话里写了「多收 26.02 美元 [E1]」,而 E1 的值是 1412.42,这比不写编号还糟,因为它给人一种「有出处」的错觉。不存在的编号直接算问题;编号存在但值对不上,我只算警告,因为同一个数常常出现在好几条证据里(比如多收金额既在 recompute 的 difference 里,也可能和某张发票的总额相同),模型引了另一条也情有可原。

**允许「由两条证据推导」的数**。客户问「为什么比上个月贵了」,好的回答会说「优惠期内是 156.00,现在是 195.00」,而 156.00 可能不在证据里,它是 195.00 减 39.00。如果一律不许,模型就只能干巴巴地罗列证据里现成的数;如果一律放行,编造的数就混进来了。折中是:等于任意两条证据之和或之差的数算「推导」,允许,但记下来。推导数在内部版里会被同事看到,发现不合理可以追问。这一条规则是我在真实运行里看到模型写出 156.00 之后加的。

**百分比的出处**。税率在证据里是 `0.09`,文本里写「9%」,要换算后再比。这一块我第一版写错了,后面单独讲。

**客户版的额外规则**。禁用词清单挡住「已经退款」「马上到账」这类承诺;`INTERNAL_WORDS` 挡住下划线连接的英文代码(比如 `timezone_change_date`)、工具名和裸露的证据编号。注意它是在去掉方括号引用之后再查的,所以「[E17]」不会被误判,而模型写成「E17」或「(E17)」就会被抓住。

## 写作、校验、重写

```python
# billsleuth/billsleuth/explain.py
"""把调查结论写成两份解释(Day 125):给客户看的(不带内部编号)和给同事看的(每个数字带证据引用)。
写完过一遍数字溯源校验器,不过就把问题清单交回模型重写,最多两次;还不过就用模板兜底。"""
from __future__ import annotations

from pydantic import BaseModel, Field

from billsleuth import grounding
from billsleuth.evidence import render

MAX_REWRITES = 2


class Explanation(BaseModel):
    customer_message: str = Field(description="给客户的中文回复,先给结论,再解释原因和下一步;每个金额后面标证据编号如 [E12]")
    internal_note: str = Field(description="给同事的内部说明:根因、证据链、算式,每个数字后面标证据编号")


WRITER_RULES = """你是云簿 CloudLedger 的计费客服,根据调查结论写两段文字。
硬性规则:
- 所有金额、税率只能来自下面的证据清单,写出来时在数字后面标证据编号,如「多收了 26.02 美元 [E31]」。
- 需要算的数(差额、合计)不要自己算,证据清单里有现成的就用现成的;没有就不要写这个数。
- 客户版:先说结论(有没有多收、多收多少),再用一两句大白话解释原因,最后说下一步。
  多收的情况只能说「已提交更正申请,审核通过后会把多收的金额退回或抵扣」,不能承诺退款时间和结果。
  不要出现英文代码、工具名、根因类别名。语气平和,不甩锅,不过度道歉。
- 内部版:写根因类别、关键证据、算式,给处理同事看。"""


def _fallback(findings: dict, evidence: list[dict]) -> Explanation:
    """模型写不出合格答案时的模板。宁可干巴巴,也不能有错数字。"""
    inv = ", ".join(findings.get("invoice_ids", []))
    over = findings.get("overcharge", "0.00")
    src = next((e["id"] for e in evidence if e["value"] == over and "多收" in e["claim"]), None)
    tag = f" [{src}]" if src else ""
    if findings.get("expected_action") == "credit_note":
        msg = (f"您好,我们核对了发票 {inv},确认多收了 {over} 美元{tag}。"
               "已提交更正申请,审核通过后会把多收的金额退回或抵扣,处理结果会邮件通知您。")
    else:
        msg = f"您好,我们核对了发票 {inv},金额按规则计算没有错误。具体明细我们的同事会再跟您说明。"
    # 注意:不把模型写的 reasoning 拼进来,它没过校验,里面的数字不可信
    return Explanation(customer_message=msg,
                       internal_note=f"模板兜底,模型三次都没写出合格解释,请人工复核。根因 {findings.get('root_cause')},多收 {over}{tag}。")


def explain(llm, question: str, findings: dict, evidence: list[dict]) -> dict:
    writer = llm.with_structured_output(Explanation, method="function_calling")
    prompt = (f"{WRITER_RULES}\n\n客户原话:{question}\n\n调查结论:{findings}\n\n证据清单:\n{render(evidence)}")
    feedback, attempts = "", []
    for attempt in range(MAX_REWRITES + 1):
        exp: Explanation = writer.invoke(prompt + feedback)
        cust = grounding.check(exp.customer_message, evidence, customer_view=True)
        internal = grounding.check(exp.internal_note, evidence)
        # 校验器只管「数字有没有出处」,管不了「数字用对了没有」。最关键的那个数单独查一遍
        over = findings.get("overcharge", "0.00")
        if findings.get("expected_action") == "credit_note" and over not in exp.customer_message:
            cust.problems.append(f"客户版没有写明多收金额 {over}")
            cust.ok = False
        attempts.append({"customer": cust.problems, "internal": internal.problems})
        if cust.ok and internal.ok:
            return {"customer_message": grounding.strip_citations(exp.customer_message),
                    "internal_note": exp.internal_note, "derived": cust.derived + internal.derived,
                    "attempts": attempts, "fallback": False}
        feedback = "\n\n上一版没通过校验,问题如下,请改正后重写:\n- " + "\n- ".join(cust.problems + internal.problems)
    fb = _fallback(findings, evidence)
    return {"customer_message": grounding.strip_citations(fb.customer_message), "internal_note": fb.internal_note,
            "derived": [], "attempts": attempts, "fallback": True}


def overcharge_is_grounded(findings: dict, evidence: list[dict]) -> bool:
    """结论里的多收金额本身也要有出处:0.00 之外,必须等于某条证据的值。"""
    over = findings.get("overcharge")
    return over == "0.00" or any(e["value"] == over for e in evidence)
```

`explain` 的循环很直接:让模型按规则写两份,两份分别过校验,都过了就把客户版的编号去掉返回;有问题就把问题清单拼到提示词后面,让模型重写。最多写三稿(第一稿加两次重写)。

把问题清单原样交给模型,这一招在实践中很好用。模型不知道自己哪句话错了的时候,重写往往换一种措辞又犯同样的错;告诉它「金额 25.80 在证据里找不到出处:多收了 25.80 美元 [E3]」,它几乎总能改对。这和 Day 12 讲的「把错误信息交回给模型」是一个道理,只不过这次的错误信息由我们自己的校验器产生。

`_fallback` 是三稿都不过时的模板。它很干巴,但里面只有两个数字:多收金额和发票号,都直接取自结论和证据。这里有一个我自己犯过的错:第一版模板为了「信息量大一点」,把模型在 `SubmitFindings` 里写的 `reasoning` 原样拼进了内部版。结果一次真实运行里,三稿都没过,兜底的内部版里出现了 `156.00×1.09=170.04` 这样的算式,而这些数字恰恰是没经过校验的。**兜底的意义就是「这里面的东西都可信」,所以它不能包含任何没过校验的内容。**现在的模板只写根因、多收金额和「请人工复核」。

函数末尾的 `overcharge_is_grounded` 检查结论本身:多收金额要么是 0.00,要么必须等于某条证据的值。结论里的金额如果在证据里都找不到,说明调查本身就有问题,不该进入写作环节。

## 校验器管不到的地方

数字溯源校验器只回答一个问题:**这个数是不是从证据里来的**。它回答不了:**这个数是不是用在了对的地方**。

举个例子。证据里有 E17「INV-0011-03 按规则应收 = 1412.42」。模型如果写「这张发票多收了 1412.42 美元 [E17]」,校验器会放行,因为 1412.42 确实在证据里,编号也对得上。但这句话是错的,多收的是 26.02。

这类错误在研究里叫「引用了真实来源但支持了错误的论断」。ALCE 那篇论文专门评测带引用的生成,把「引用是否支持这句话」作为单独的指标;FActScore 把长文本拆成原子事实逐个核对。要全面解决,需要一个模型或一套规则去判断每句话和它引用的证据在语义上是否一致,这就是 Day 127 要用的 LLM judge。

今天先用一条针对性的检查补上最关键的那个数:**结论是要冲正的,客户版里就必须出现结论里的多收金额**。这条写在 `explain` 循环里,不在通用校验器里,因为它依赖调查结论。它挡不住所有语义错误,但能挡住「把应收当多收」这类最伤人的错误里的一大部分:模型如果写错了金额,正确的多收金额就不会出现在文本里。这种「通用检查 + 针对最关键字段的专门检查」的组合,在生产系统里很常见,也很划算。

## 接进调查图

`graph.py` 加一个 `write_up` 节点,放在 `conclude` 之后。状态里加一个 `reply` 字段:

```python
# billsleuth/billsleuth/graph.py(Day 125 的改动)
from billsleuth.explain import explain, overcharge_is_grounded   # 新增的导入

class CaseState(CaseInput, total=False):
    ...
    escalated: bool
    reply: dict                                                    # 新增


    # build_graph 里,conclude 之后新增一个节点:
    def write_up(state: CaseState) -> dict:
        """Day 125 新增:结论里的多收金额先过溯源检查,再写两份解释。"""
        findings, evidence = state.get("findings", {}), state.get("evidence", [])
        if state.get("escalated") or not overcharge_is_grounded(findings, evidence):
            return {"escalated": True, "reply": {}}
        return {"reply": explain(llm, state["question"], findings, evidence)}

    # 注册节点时把 ("write_up", write_up) 加进列表,边改成:
    g.add_edge("conclude", "write_up")
    g.add_edge("write_up", END)
```

`run.py` 里在打印用量之前加几行,把两份解释、每一稿的问题和推导数打出来:

```python
# billsleuth/billsleuth/run.py(Day 125 新增,放在打印模型调用次数之前)
    reply = state.get("reply") or {}
    if reply:
        print(f"  客户版:{reply['customer_message']}")
        print(f"  内部版:{reply['internal_note']}")
        for n, a in enumerate(reply["attempts"], start=1):
            for prob in a["customer"] + a["internal"]:
                print(f"    第 {n} 稿问题:{prob[:110]}")
        print(f"  校验:{len(reply['attempts'])} 次写作,兜底={reply['fallback']},推导数={reply['derived']}")
```

## 测试

校验器的单元测试,每条规则一个:

```python
# billsleuth/tests/test_grounding.py
from decimal import Decimal as D

from billsleuth.grounding import amounts, check, percents, strip_citations

EV = [
    {"id": "E1", "claim": "INV-0011-03 按规则应收", "source_tool": "recompute_invoice", "source_ref": "INV-0011-03", "value": "1412.42"},
    {"id": "E2", "claim": "INV-0011-03 实际开票金额", "source_tool": "recompute_invoice", "source_ref": "INV-0011-03", "value": "1438.44"},
    {"id": "E3", "claim": "INV-0011-03 多收(实际 - 应收)", "source_tool": "recompute_invoice", "source_ref": "INV-0011-03", "value": "26.02"},
    {"id": "E4", "claim": "CN 在 2026-08-14 有效税率 CN-VAT6", "source_tool": "get_tax_rate", "source_ref": "CN-VAT6", "value": "0.06"},
]


def test_amount_and_percent_extraction():
    assert amounts("多收了 26.02 美元,总额 1,438.44 USD,另有 30 元") == [D("26.02"), D("1438.44"), D("30.00")]
    assert percents("税率 6%,折扣 20 %") == [D("0.06"), D("0.2")]


def test_grounded_text_passes():
    r = check("应收 1412.42 [E1],实际 1438.44 [E2],多收 26.02 美元 [E3]。税率 6% [E4]。", EV)
    assert r.ok and not r.warnings


def test_made_up_number_is_rejected():
    r = check("多收了 25.80 美元 [E3]。", EV)
    assert not r.ok and "25.80" in r.problems[0]


def test_wrong_citation_is_flagged():
    r = check("多收了 26.02 美元 [E1]。", EV)
    assert r.ok and "不是句中引用的那条证据" in r.warnings[0]
    r = check("多收了 26.02 美元 [E99]。", EV)
    assert not r.ok


def test_derived_number_is_allowed_but_recorded():
    r = check("两者相差 26.02 美元。", EV[:2])  # E3 不在,但 1438.44 - 1412.42 = 26.02
    assert r.ok and r.derived


def test_customer_view_forbids_promises_and_jargon():
    r = check("多收了 26.02 美元,已经退款到您的卡上。", EV, customer_view=True)
    assert not r.ok and any("已经退款" in p for p in r.problems)
    r = check("根因是 timezone_change_date。", EV, customer_view=True)
    assert not r.ok


def test_strip_citations():
    assert strip_citations("多收 26.02 美元 [E3]。") == "多收 26.02 美元。"


def test_percent_can_come_from_coupon_or_line_description():
    ev = [{"id": "E1", "claim": "优惠券 WELCOME20(percent,3 个月)", "source_tool": "get_subscription_timeline",
           "source_ref": "WELCOME20", "value": "20"},
          {"id": "E2", "claim": "INV-0009-04 第 2 行:税 SG-GST9(9%)", "source_tool": "get_invoice",
           "source_ref": "INV-0009-04#L2", "value": "17.55"}]
    assert check("20% 的优惠券 [E1] 只用 3 个月,税率 9% [E2]。", ev).ok
    assert not check("税率 8% [E2]。", ev).ok


def test_explain_requires_the_overcharge_in_customer_message():
    from billsleuth.explain import Explanation, explain

    class Writer:
        def __init__(self, drafts):
            self.drafts = list(drafts)

        def with_structured_output(self, schema, method=None):
            return self

        def invoke(self, _):
            return self.drafts.pop(0)

    good = Explanation(customer_message="这张发票多收了 26.02 美元 [E3],已提交更正申请。", internal_note="多收 26.02 [E3]。")
    vague = Explanation(customer_message="这张发票确实有问题,已提交更正申请。", internal_note="多收 26.02 [E3]。")
    findings = {"root_cause": "timezone_change_date", "invoice_ids": ["INV-0011-03"], "overcharge": "26.02",
                "expected_action": "credit_note", "reasoning": "x"}
    out = explain(Writer([vague, good]), "为什么多收", findings, EV)
    assert out["fallback"] is False and len(out["attempts"]) == 2
    assert out["attempts"][0]["customer"] == ["客户版没有写明多收金额 26.02"]
    assert out["customer_message"] == "这张发票多收了 26.02 美元,已提交更正申请。"
```

最后一个测试用一个按剧本出稿的假写手,验证「客户版没写多收金额」会被打回,第二稿改对以后通过,并且编号被去掉。

调查图的测试要跟着改:假模型多了一个 `explanation` 参数,正常路径要断言解释没有走兜底;再加一个新测试,假写手三稿都写编造的 170.00,验证最后走模板兜底、而模板里的数字是证据里的 174.90。完整的测试文件:

```python
# billsleuth/tests/test_graph.py
"""不花钱测调查流程:用一个按剧本回话的假模型,验证路由、越权拦截、证据抽取和结论解析。"""
import shutil

import pytest
from langchain_core.messages import AIMessage, ToolMessage

from billsleuth import seed
from billsleuth.explain import Explanation
from billsleuth.graph import Intake, build_graph
from billsleuth.mcp_bridge import BillingMCP


class ScriptedLLM:
    """只实现图里用到的三个方法:bind_tools、with_structured_output、invoke。"""

    def __init__(self, intake: Intake, script: list[AIMessage], explanation=None):
        self.intake, self.script, self.seen = intake, list(script), []
        self.explanation = explanation

    def bind_tools(self, tools):
        return self

    def with_structured_output(self, schema, method=None):
        outer = self

        class _S:
            def invoke(self, _):
                return outer.intake if schema is Intake else outer.explanation
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
    ], explanation=Explanation(
        customer_message="您好,订阅在 9 月到期后不应再开票,这张发票多收了 174.90 美元 [E9]。已提交更正申请,审核通过后会退回或抵扣。",
        internal_note="cancel_not_respected:INV-0001-05 应收 0.00 [E7],实际扣款 174.90 [E10]。"))
    out = run(llm)
    assert out["escalated"] is False
    assert out["findings"]["root_cause"] == "cancel_not_respected"
    assert "INV-0001-05" in out["candidates"]
    assert any(e["claim"].endswith("多收(实际 - 应收)") and e["value"] == "174.90" for e in out["evidence"])
    assert [e["id"] for e in out["evidence"]][:3] == ["E1", "E2", "E3"]  # 编号连续
    assert out["reply"]["fallback"] is False and "[E" not in out["reply"]["customer_message"]


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


def test_reply_is_grounded_and_citations_stripped():
    test = ScriptedLLM(Intake(complaint="取消后仍扣款", amount="174.90", month=9), [
        AIMessage("", tool_calls=[call("recompute_invoice", {"invoice_id": "INV-0001-05"}, 1)]),
        AIMessage("", tool_calls=[call("SubmitFindings", {
            "root_cause": "cancel_not_respected", "invoice_ids": ["INV-0001-05"], "overcharge": "174.90",
            "expected_action": "credit_note", "reasoning": "该周期不应开票"}, 2)]),
    ], explanation=Explanation(customer_message="多收了 170.00 美元。", internal_note="多收 170.00。"))
    out = run(test)
    # 模型三次都写了编造的 170.00,最后用模板兜底,模板里的数字来自证据
    assert out["reply"]["fallback"] is True
    assert "174.90" in out["reply"]["customer_message"] and "[E" not in out["reply"]["customer_message"]
```

```bash
uv run pytest -q
```

一共 230 个测试,全部通过。

## 真实运行里看到的

下面是我用 DeepSeek 跑的真实记录,挑了几个有代表性的。

**一次写对的**。S020(百分比优惠券基数错)的内部版(节选),每个数字都带编号,算式用的全是证据里现成的数:

```text
关键证据:
- INV-0020-03 实际 total 649.88 [E11][E19],按规则应收 636.59 [E18],多收 13.29 [E20]。
- 差异集中在 discount:实收 -93.45 [E29],应收 -105.98 [E28],差额 12.53 [E30];tax:实收 36.79 [E32],应收 36.03 [E31],差额 0.76 [E33]。
- 基数对比:实际 93.45 = 15% × 623.00(仅 recurring,第 3 行 623.00 [E14]);应收 105.98 = 15% × 706.54(含 proration,subtotal 706.54 [E8])。即百分比券漏算折算部分。
- 排除项:recurring 差额 0.00 [E24],proration 差额 0.00 [E27];扣款仅 1 笔 succeeded 649.88 [E21][E45],无重复扣款;同期无其他发票。
```

同一个场景的客户版(编号已去掉):

```text
您好,我们核对后确认,8 月这张发票(649.88)确实多收了 13.29,给您添麻烦了。

原因是这张发票上有一张 15% 的优惠券,计算折扣时只按订阅费部分打折,漏掉了当月套餐升级产生的折算部分,所以折扣少抵了 12.53,对应的税也跟着多算了 0.76,两项合计就是多收的 13.29。……

下一步:我们已提交更正申请,审核通过后会把多收的金额退回或抵扣,后续进展会再同步给您。
```

**校验器误伤**。S009(优惠期结束,账没错)第一次跑的时候,校验器还是第一版,模型写了「您订阅时使用的 20% 优惠券 [E25] 只在前 3 个月有效」和「加 9% 税」,两句都被判成「百分比在证据里找不到对应税率或折扣」。原因是:优惠券在证据里的值是 `20`(表示 20%),不是 `0.2`;这个场景里模型没调 `get_tax_rate`,9% 只出现在发票税行的描述「税 SG-GST9(9%)」里。两处都是合法的出处,是我的校验器太死板。修法就是现在代码里的那几行:证据说明文字里出现的百分比也算出处,说明里带 `percent` 的证据把值除以 100 再比。**写校验器和写测试一样,要拿真实输出去试,第一版几乎一定有误报。**

**校验器抓到真问题**。同一个场景后来又跑了一次,第一稿被打回的原因是「客户版出现了内部用语 E20」:模型在客户版里写了不带方括号的 E20,去掉引用的正则不会处理它,如果放过去,客户会看到一个莫名其妙的「E20」。第二稿改对了。

**推导数**。S009 最近一次运行里,内部版写了「折扣期 195.00 [E26] - 39.00 [E27] = 156.00」,156.00 不在证据里,校验器把它记为推导数放行了。这正是我们想要的效果:算式清楚、两个操作数都有出处,同事一眼就能核对。

**兜底**。第一版校验器下,S009 有一次三稿都没过,走了模板兜底,也就是前面说的那个「兜底里混进了没校验的 reasoning」的 bug 被发现的时候。修了误报以后,我又跑了 13 次(11 个不同场景),只有一次写了两稿(就是上面那个 E20),其余都是一稿通过,没有再走到兜底。这些是我手动跑的几次观察,不是统计结果,Day 127 的评测会给出写作环节的通过率和平均稿数。

## 动手练习

1. 写 `grounding.py` 和 `explain.py`,按上面的改动接进 `graph.py` 和 `run.py`,更新 `tests/test_graph.py`,新建 `tests/test_grounding.py`,跑通 230 个测试。
2. 跑 5 个场景,至少包含一个「账没错」的:`uv run python -m billsleuth.run S009 S011 S017 S020 S004`。读每一份客户版,站在客户的角度挑毛病:有没有看不懂的词,有没有让你更困惑的地方。
3. **故意制造误报**:把 `grounding.py` 里处理百分比出处的那四行注释掉,再跑 S009 和 S006,看校验器怎么误伤,再改回来。
4. **故意制造漏网**:写一个单元测试,文本是「这张发票多收了 1412.42 美元 [E1]」(E1 是应收),确认 `check()` 会放行它;再确认 `explain` 里的多收金额检查能把它拦下来。
5. 选做:加一条规则,客户版里出现的日期(形如 2026-07-15)也必须在证据里能找到。想一想日期和金额相比,误报会多还是少。

**验收标准**:230 个测试全绿;至少一个场景的客户版你认为可以直接发给客户;练习 3 能复现误报;练习 4 写出的测试能说明「校验器放行、针对性检查拦下」这件事。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 溯源 grounding | 回答里的内容能追溯到可靠来源,这里专指数字能在证据链里找到 |
| 数字幻觉 | 模型写出了证据里没有、也推导不出来的数字 |
| 推导数 | 等于两条证据之和或之差的数字,允许出现,但记录下来供人复核 |
| 引用 citation | 数字后面的证据编号,如 [E17] |
| 引用支持度 | 被引用的证据是否真的支持这句话的论断,溯源校验器管不到这一层 |
| 写作-校验-重写 | 生成后用规则检查,把问题清单交回模型重写的循环 |
| 模板兜底 | 重写多次仍不合格时,用只含已验证数字的固定模板输出 |
| 误报 / 漏网 | 校验器把合法内容判错 / 把错误内容放过 |

## 常见误区

**让模型「务必准确,不要编造数字」就够了。** 提示词能降低编造的概率,不能消除。计费场景要的是「编了也发不出去」,那只能靠代码校验。

**校验器越严越安全。** 太严会让模型反复重写、频繁兜底,客户收到的全是干巴巴的模板。第一版校验器一定要拿真实输出试,把误报降下来。

**有出处就等于对。** 引用了真实的数,不代表用在了对的地方。最关键的字段要单独检查,语义层面的一致性要靠 judge 或人工抽检。

**兜底模板写得越详细越好。** 兜底的价值是「里面的东西都可信」,混进任何没过校验的内容都会毁掉它。宁可简短,并标记人工复核。

**客户版也保留证据编号,显得专业。** 客户看不懂,只会更困惑。编号留在内部版,客户版在发出前去掉。

**写给客户的话里承诺退款。** 贷记单还要人批。Agent 先承诺、主管再驳回,客户只会更生气。

## 学习资料

### 文档与文章

- [FActScore 论文](https://arxiv.org/abs/2305.14251):把长文本拆成原子事实、逐个核对来源的评测方法,看第 2 节的定义,知道「事实粒度的核对」怎么做,30 分钟。
- [ALCE:让大模型生成带引用的文本](https://arxiv.org/abs/2305.14627):带引用生成的评测框架,重点看「引用召回」和「引用精确」两个指标,对应我们校验器管到和管不到的部分,30 分钟。
- [Chain-of-Verification 论文](https://arxiv.org/abs/2309.11495):先生成、再自己提出核查问题、逐个回答后修正的方法,和我们「写作-校验-重写」思路相近,区别是我们的核查由代码完成,20 分钟。
- [Anthropic · Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents):回顾「返回有意义的上下文」一节,证据链之所以好抽,是因为 Day 123 的工具返回结构设计得好,10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Uy411i7eQ&autoplay=0&high_quality=1" title="什么是大模型幻觉?为什么会产生幻觉?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI老兵文哲 · 什么是大模型幻觉?为什么会产生幻觉? · 5 分钟,讲幻觉的成因,理解为什么提示词消除不了编造数字。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1HVFLzfEeS&autoplay=0&high_quality=1" title="挑战19分钟搞定,LangGraph快速入门与原理剖析" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>敲代码的码农 · 挑战19分钟搞定,LangGraph快速入门与原理剖析 · 昨天推荐过,今天重点回看条件边和节点返回部分状态的那几分钟,对应我们新加的 write_up 节点。</figcaption>
</figure>

- 萌力相变《RAG为什么有引用也会答错?从检索到评估,讲清原理与工程取舍》(BV1E8pz6vEaB,8 分钟):讲的正是「有引用不等于对」,播放量不高但切题。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Lar3K2gN454" title="Chain-of-Verification (COVE) Reduces Hallucination in Large Language Models - Paper Explained" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>DataMListic · Chain-of-Verification (COVE) Reduces Hallucination in Large Language Models - Paper Explained · 讲 CoVe 的四个步骤,和我们用代码做核查的方案对比着看。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 4 章讲评估标准,其中事实一致性(factual consistency)那一节介绍了用检索和模型做事实核查的几种做法,对应我们校验器之外的那一层。
- John Berryman、Albert Ziegler《Prompt Engineering for LLMs》(O'Reilly, 2024):讲提示词里怎么组织参考资料、让模型引用的章节,对照我们把证据清单交给写手的做法。
- Martin Fowler《Patterns of Enterprise Application Architecture》(Addison-Wesley, 2002):回到第 18 章 Money,想一想如果客户版要显示货币符号和千分位,格式化应该放在哪一层。

### 开源项目与代码

- [shmsw25/FActScore](https://github.com/shmsw25/FActScore):FActScore 的实现,看它怎么拆原子事实、怎么判断支持与否。
- [princeton-nlp/ALCE](https://github.com/princeton-nlp/ALCE):带引用生成的评测代码,看引用精确度是怎么用 NLI 模型判断的。
- [explodinggradients/ragas](https://github.com/explodinggradients/ragas):RAG 评测库里的 faithfulness 指标,和我们的数字溯源是同一类问题的通用版本。

## 自测

1. 客户版和内部版的读者分别是谁?各列两条只适用于其中一份的规则。

<details><summary>答案</summary>

客户版给客户:不出现英文代码、工具名、证据编号;不承诺退款时间和结果。内部版给处理工单的同事:写清根因类别和算式;每个数字带证据编号以便复核。两份都要求数字有出处。

</details>

2. 校验器为什么不把「15 天」「3 个月」当成金额去检查?这个选择的代价是什么?

<details><summary>答案</summary>

不带单位的整数太常见,天数、月数、行号都会被当成金额,误报会多到没法用。所以只认带货币单位的数和两位小数的数。代价是「多收了 26」这种既没小数也没单位的写法会漏检,靠写作规则要求金额写两位小数来弥补。

</details>

3. 「多收了 1412.42 美元 [E17]」,E17 是应收金额。通用校验器会放行吗?项目里怎么拦下它?

<details><summary>答案</summary>

会放行,因为 1412.42 确实在证据里,编号也对得上。拦下它的是 `explain` 里那条针对性检查:结论要冲正时,客户版里必须出现结论的多收金额 26.02。模型把应收当成多收,26.02 就不会出现,于是被打回。

</details>

4. 兜底模板为什么不能包含模型写的 reasoning?

<details><summary>答案</summary>

兜底是在三稿都没通过校验时才用的,它的唯一价值是里面的内容都可信。模型的 reasoning 没经过校验,可能正好包含让三稿失败的那些编造数字。把它拼进兜底,等于绕过了校验器。

</details>

5. 为什么把校验器发现的问题清单原样交回给模型,而不是只说「请重写」?

<details><summary>答案</summary>

只说重写,模型不知道哪里错了,常常换个措辞重复同样的错误。具体到「哪个数字、哪句话、为什么不行」的反馈,模型几乎总能一次改对,重写次数少,也就省钱、少走兜底。

</details>

6. 资深面试题:你的系统要给客户发自动生成的账单解释,法务问「怎么保证 AI 不会说错数」。你怎么回答,方案里哪些是硬保证、哪些不是?

<details><summary>答案</summary>

先分清楚能保证到什么程度。硬保证:每个金额和百分比都经过代码校验,必须能在工具返回的数据里找到出处或由两条数据加减得到,否则不发;最关键的多收金额必须和调查结论一致;客户版禁止退款承诺和内部用语;三次不通过用只含已验证数字的模板,并转人工复核;所有生成内容和校验记录留档可审计。不是硬保证的:数字用在了对的语境里(比如应收和多收没有混淆的其他情况)、原因描述是否准确、语气是否得体,这些靠 LLM judge 抽检、人工抽检和评测集持续监控,并给出量化的错误率和置信区间。上线策略上,先作为客服的草稿工具,人确认后发出,用一段时间的人工修改率证明质量,再逐步对低风险类别放开自动发送。

</details>

## 明天预告

明天(Day 126)处理「动钱」的那一步:结论要冲正时,Agent 起草贷记单,图在审批节点暂停,等主管在命令行或网页上批准或驳回。我们会用显式的幂等键防止重复提交,处理驳回之后怎么跟客户说,并写测试证明 Agent 无论如何都绕不过审批去签发贷记单。
