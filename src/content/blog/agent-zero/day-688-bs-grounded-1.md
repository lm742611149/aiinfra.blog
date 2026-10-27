---
title: 'Day 688 · BillSleuth(八):两份解释两个读者,数字溯源校验器'
description: '同一个调查结论要写给两个读者:客户要看得懂、不能被承诺退款,同事要能复核、每个数字带证据编号。先让真模型按规则各写 16 份,量出 442 个金额里 8 个找不到出处,再写 grounding.py 把这类数字拦下来,途中踩到减号和连字符分不清、符号方向、内部版和客户版对「算出来的数」的不同态度。最后用 13 条测试钉住,并拿 Day 686 实验里那段回答验证 4.84 和 28.71 会被拦。'
pubDate: 2026-10-27
regime: none
tags: ['billsleuth', 'grounding', 'hallucination', 'citation', 'agent-zero']
series: 'agent-zero'
day: 688
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 687](/blog/agent-zero/day-687-bs-run/) 用假模型给调查图写了 7 条不花钱的测试,又用真模型把 16 个场景从头跑到尾:16/16 命中根因和金额,平均 4.7 次模型调用、约 ¥0.03 一个。结论是结构化的,可以直接和标准答案比,但它还只是一份给程序看的结论:`{"root_cause": "timezone_change_date", "overcharge": "26.02", ...}`。

客户要的是一段看得懂的话,同事要的是一段能复核的说明。[Day 686](/blog/agent-zero/day-686-bs-evidence/) 做的证据链就是为今天准备的:模型想写任何一个数字,都得能在证据链里找到它。今天先写这两份解释,再写那个负责「找」的校验器。

## 今天要解决的问题

1. 说清楚客户版和内部版解释各自的读者、内容和禁忌,写成给模型的规则,并用真模型各写 16 份看看效果。
2. 写出 `billsleuth/grounding.py`:从文字里抽出金额和百分比,逐个去证据链里找出处,分「有据」「由两条证据加减得到」「找不到」三种。
3. 把真实运行里遇到的几个坑写进规则:减号和连字符分不清、证据是负数、客户版和内部版对「算出来的数」要求不同、引用编号对不上。
4. 用 13 条测试钉住,并验证 Day 686 实验里那两个模型自己算出来的数(4.84 和 28.71)会被拦下。

预计用时 3.5 小时。前置:[Day 686](/blog/agent-zero/day-686-bs-evidence/)(`evidence.py`、证据的样子)、[Day 687](/blog/agent-zero/day-687-bs-run/)(`run.py`、`tests/test_graph.py`)、[Day 680](/blog/agent-zero/day-680-bs-engine-1/)(Decimal 的规矩)。今天调真模型约 ¥0.50:16 份草稿约 ¥0.16,练习 3 的对比实验 32 次约 ¥0.32,单次写作实测约 ¥0.01(S011 输入 2052 / 输出 576 token,2052 × 2 + 576 × 8 = 8712,除以一百万是 ¥0.0087)。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `scan`、`check` 的骨架和 `_rate_values` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 概念一:两份解释,两个读者

### 同一个结论,要求几乎相反

调查结论只有一份:S011 多收 26.02,原因是改套餐发生在新加坡本地 7 月 15 日凌晨,系统按 UTC 日期算成 14 日,折算多算了一天。但读它的人有两个。

**客户**,可能是对不上账的财务,可能是老板,不懂计费术语也不想懂。他要的是:有没有多收、多收多少、为什么、接下来怎样。他不该看到 `timezone_change_date` 这样的内部代码,不该看到 `[E8]` 这样的编号,更不该看到「已经退款」这类话,因为退款要审批(Day 690 起),Agent 替公司许诺了,主管驳回了,公司就失信了。

**同事**,是接这单的客服或主管。他要的是能复核:根因类别、关键证据、算式,每个数字后面跟一个编号,他想核对哪个就点开哪个。他不需要客气话。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="一个调查结论分成两份文字:客户版给客户看,数字带编号写作、发出前去掉编号,禁止承诺退款和内部用语;内部版给同事看,数字带编号保留,可以出现算式;两份都过数字溯源校验,客户版更严">
  <rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)" rx="6"/>
  <defs><marker id="a688" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="16" y="96" width="130" height="64" rx="4" fill="none" stroke="var(--ink)"/>
    <text x="81" y="120" text-anchor="middle" fill="var(--ink)">结论 + 证据链</text>
    <text x="81" y="140" text-anchor="middle" fill="var(--ink-soft)">findings / E1…En</text>
    <line x1="146" y1="116" x2="196" y2="64" stroke="var(--ink-soft)" marker-end="url(#a688)"/>
    <line x1="146" y1="140" x2="196" y2="196" stroke="var(--ink-soft)" marker-end="url(#a688)"/>
    <rect x="198" y="24" width="426" height="84" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="212" y="46" fill="var(--mem)" font-size="12">客户版:给财务/老板看</text>
    <text x="212" y="66" fill="var(--mem)">先结论再原因再下一步,写时带 [E#],发出前去掉</text>
    <text x="212" y="84" fill="var(--mem)">不许:承诺退款 / 内部代码 / 算出来的数</text>
    <text x="212" y="100" fill="var(--mem)">只能说「已提交更正申请,审核后退回或抵扣」</text>
    <rect x="198" y="152" width="426" height="84" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="212" y="174" fill="var(--compute)" font-size="12">内部版:给接单同事看</text>
    <text x="212" y="194" fill="var(--compute)">根因、关键证据、算式,每个数字带 [E#] 并保留</text>
    <text x="212" y="212" fill="var(--compute)">允许:两条证据加减得到的数(记下来)</text>
    <text x="212" y="228" fill="var(--compute)">不许:证据里没有的数</text>
    <text x="16" y="260" fill="var(--ink-faint)">两份都过同一个校验器,客户版的规矩更严</text>
  </g>
</svg>
<figcaption>两份都让模型带编号写,发给客户之前再把编号去掉。这样客户版里每个数字在去掉编号之前都被核对过。</figcaption>
</figure>

为什么不只写一份、客户版也带编号?客户看到 `[E8]` 只会困惑。为什么不写一份再让模型「改写成客户能懂的」?因为改写一次就多一次出错机会,而且第二次改写的结果没有编号,没法核对。所以两份同时写、同时带编号、同时校验,最后一步由代码把客户版的编号去掉。

### explain.py 第一版:只写一次

先写最小的一版:一个 schema、一段规则、一个写一次就返回的函数。没有校验,没有重写,那是明天的事。新建 `billsleuth/explain.py`:

```python
# billsleuth/billsleuth/explain.py  把调查结论写成两份解释:给客户看的,和给同事看的
from typing import Any

from pydantic import BaseModel, Field

from billsleuth.evidence import render


class Explanation(BaseModel):
    customer_message: str = Field(description="给客户的中文回复:先给结论,再解释原因和下一步;每个金额后面标证据编号,如 [E12]")
    internal_note: str = Field(description="给同事的内部说明:根因、证据、算式;每个数字后面标证据编号")


WRITER_RULES = """你是云簿 CloudLedger 的计费客服,根据调查结论写两段文字。
硬性规则:
- 所有金额、税率只能来自下面的证据清单,写出来时在数字后面标证据编号,如「多收了 26.02 美元 [E8]」。
- 需要算的数(差额、合计)不要自己算,证据清单里有现成的就用现成的;没有就不要写这个数。
- 客户版:先说结论(有没有多收、多收多少),再用一两句大白话解释原因,最后说下一步。
  多收的情况只能说「已提交更正申请,审核通过后会把多收的金额退回或抵扣」,不能承诺退款时间和结果。
  不要出现英文代码、工具名、根因类别名。语气平和,不甩锅,不过度道歉。
- 内部版:写根因类别、关键证据、算式,给处理这单的同事看。"""


def writer_prompt(question: str, findings: dict, evidence: list[dict]) -> str:
    return f"{WRITER_RULES}\n\n客户原话:{question}\n\n调查结论:{findings}\n\n证据清单:\n{render(evidence)}"


def write_once(llm: Any, question: str, findings: dict, evidence: list[dict]) -> Explanation:
    writer = llm.with_structured_output(Explanation, method="function_calling")
    return Explanation.model_validate(writer.invoke(writer_prompt(question, findings, evidence)))
```

<div class="line-notes">

- `from typing import Any` 模型对象的类型写 `Any`,和 `graph.py` 一样,让假模型也能传进来。
- `from billsleuth.evidence import render` Day 686 的 `render`,把证据列表打成一行一条的清单,直接塞进提示词。
- `class Explanation(BaseModel):` 写手的结构化输出,两个字段对应两个读者。用结构化输出而不是让模型写一大段再切开,是因为切分点不可靠,模型可能忘了写分隔符。
- `customer_message: str = Field(description="给客户的中文回复:先给结论,再解释原因和下一步;每个金额后面标证据编号,如 [E12]")` `description` 会变成给模型看的工具参数说明,所以这里就是写作要求的一部分。
- `internal_note: str = Field(description="给同事的内部说明:根因、证据、算式;每个数字后面标证据编号")` 内部版同样要求带编号。
- `WRITER_RULES = """你是云簿 CloudLedger 的计费客服,根据调查结论写两段文字。` 角色加硬性规则。
- `- 所有金额、税率只能来自下面的证据清单,写出来时在数字后面标证据编号,如「多收了 26.02 美元 [E8]」。` 第一条:来源限定。例子里用的是 S011 的真实编号,E8 就是「多收(实际 - 应收)= 26.02」。
- `- 需要算的数(差额、合计)不要自己算,证据清单里有现成的就用现成的;没有就不要写这个数。` Day 686 实验里 4.84 和 28.71 就是模型自己做减法得来的,这一条是针对它写的。练习 3 会把它去掉看看差别。
- `多收的情况只能说「已提交更正申请,审核通过后会把多收的金额退回或抵扣」,不能承诺退款时间和结果。` 不许承诺,并且给出一句可以放心说的话,比光说「不许」有效。
- `不要出现英文代码、工具名、根因类别名。语气平和,不甩锅,不过度道歉。` 客户版的语气要求。
- `def writer_prompt(question: str, findings: dict, evidence: list[dict]) -> str:` 拼提示词:规则、客户原话、调查结论、证据清单。单独成函数是因为明天重写时要在后面追加问题清单。
- `return f"{WRITER_RULES}\n\n客户原话:{question}\n\n调查结论:{findings}\n\n证据清单:\n{render(evidence)}"` `{findings}` 直接把字典打进去,模型读得懂。
- `def write_once(llm: Any, question: str, findings: dict, evidence: list[dict]) -> Explanation:` 写一次。
- `writer = llm.with_structured_output(Explanation, method="function_calling")` 和 intake 一样走 function calling,要求 `.env` 里关了思考(Day 684 实测过)。
- `return Explanation.model_validate(writer.invoke(writer_prompt(question, findings, evidence)))` 调模型,再校验一遍,返回 `Explanation` 对象。

</div>

### 给写手造输入

写作吃两样东西:结论和证据链。真实流程里它们来自调查图,但调查一次要花钱(¥0.03),而今天要反复试写作,所以写一个小工具:不让模型调查,用代码按场景的标准答案造一份。证据来自调查员一般会调的五个工具,结论直接取标准答案:

```python
# billsleuth/scratch/case_kit.py  写解释要吃「结论 + 证据链」。这里不让模型调查,用代码按场景的标准答案造一份,省钱也可复现
import json

from billsleuth import evidence as ev
from billsleuth.db import ROOT
from billsleuth.mcp_bridge import BillingMCP


def load_case(sid: str) -> tuple[str, dict, list[dict]]:
    """返回 (客户原话, 结论, 证据链)。证据来自调查员一般会调的几个工具,结论直接取标准答案。"""
    sc = json.loads((ROOT / "scenarios" / f"{sid}.json").read_text(encoding="utf-8"))
    t, cid = sc["truth"], sc["customer_id"]
    inv = t["invoice_ids"][0]
    mcp = BillingMCP(in_process=True)
    _, cust = mcp.call("get_customer", {"customer_id": cid})
    _, invs = mcp.call("list_invoices", {"customer_id": cid, "limit": 24})
    day = next(i["period_start"] for i in invs if i["id"] == inv)
    calls = [("list_invoices", {"customer_id": cid, "limit": 24}),
             ("recompute_invoice", {"invoice_id": inv}),
             ("list_payments", {"customer_id": cid, "invoice_id": inv}),
             ("get_subscription_timeline", {"customer_id": cid}),
             ("get_tax_rate", {"region": cust["tax_region"], "on": day})]
    chain: list[dict] = []
    for name, args in calls:
        ok, data = mcp.call(name, args)
        if ok:
            chain += ev.number(ev.extract(name, args, data), len(chain) + 1)
    findings = {"root_cause": t["root_cause"], "invoice_ids": t["invoice_ids"], "overcharge": t["overcharge"],
                "expected_action": t["expected_action"], "reasoning": t["detail"]}
    return sc["question"], findings, chain
```

<div class="line-notes">

- `def load_case(sid: str) -> tuple[str, dict, list[dict]]:` 返回三样:客户原话、结论、证据链。
- `sc = json.loads((ROOT / "scenarios" / f"{sid}.json").read_text(encoding="utf-8"))` 读场景文件。
- `t, cid = sc["truth"], sc["customer_id"]` 标准答案和客户号。
- `inv = t["invoice_ids"][0]` 取第一张出问题的发票。
- `_, cust = mcp.call("get_customer", {"customer_id": cid})` 要客户的税务地区,查税率时用。`_` 是不用的成败标志。
- `day = next(i["period_start"] for i in invs if i["id"] == inv)` 查税率要给日期,取这张发票的周期开始日,和调查员的做法一致。
- `calls = [("list_invoices", {"customer_id": cid, "limit": 24}),` 五个工具:发票列表、复算、扣款、订阅事件、税率。
- `chain += ev.number(ev.extract(name, args, data), len(chain) + 1)` Day 686 的抽取和编号,接着往下编。
- `findings = {"root_cause": t["root_cause"],` 结论就是标准答案,`reasoning` 用场景里的 `detail`。注意:这个 `detail` 是造数时写的说明,里面可能有证据链里没有的数字,后面会撞上。

</div>

写一个小脚本让真模型写一份 S011 的,温度调到 1 看它的习惯:

```python
# billsleuth/scratch/try_writer.py  让模型按规则写一次两份解释,不校验,先看它写成什么样
import sys

from billsleuth.explain import write_once
from billsleuth.llm import get_llm
from scratch.case_kit import load_case

sid = sys.argv[1]
question, findings, evidence = load_case(sid)
exp = write_once(get_llm(temperature=1.0), question, findings, evidence)
print(f"--- {sid} 客户版\n{exp.customer_message}\n--- 内部版\n{exp.internal_note}")
```

<div class="line-notes">

- `sid = sys.argv[1]` 命令行给场景号。
- `question, findings, evidence = load_case(sid)` 造输入。
- `exp = write_once(get_llm(temperature=1.0), question, findings, evidence)` 温度 1,故意让它发挥,看最差的习惯。
- `print(f"--- {sid} 客户版\n{exp.customer_message}\n--- 内部版\n{exp.internal_note}")` 两份并排打出来。

</div>

```bash
uv run python -m scratch.try_writer S011
```

```text
--- S011 客户版
您好，这张 8 月发票（2026-08-01 至 2026-09-01）确实多收了 26.02 美元 [E8]。发票总额 1438.44 美元 [E3]，按规则应为 1412.42 美元 [E6]；实际扣款也是 1438.44 美元 [E9]。

原因是：您在本地时间 2026-07-15 凌晨升级套餐 [E31]，系统按国际标准时间取日期时算成了 7 月 14 日 [E23][E24]，于是把套餐变更的按比例折算多算了一天，导致折算部分多收 23.87 美元 [E15]，对应税额也随之多收 2.15 美元 [E18]。固定席位费部分没有差异 [E12]。

下一步：我们已提交更正申请，审核通过后会把多收的金额退回或抵扣。给您对账添了麻烦，抱歉。
--- 内部版
根因类别：timezone_change_date（时区导致变更日期偏移一天）。发票 INV-0011-03（2026-08-01 至 2026-09-01），实际开票 1438.44 [E7]，按规则应收 1412.42 [E6]，多收 26.02 [E8]，实际扣款 1 笔 1438.44 [E9]/[E27]。期望动作：credit_note。

关键证据：upgrade 事件本地日期 2026-07-15 [E31]，系统按 UTC 记为 2026-07-14，proration 区间多算一天。
- 应收第 1 行 未使用时间退还（2026-07-15 至 2026-08-01）= -82.26 [E19]；实收 -87.10 [E23]
- 应收第 2 行 剩余时间（2026-07-15 至 2026-08-01）= 488.06 [E20]；实收 516.77 [E24]
- proration 应收 405.80 [E13]，实收 429.67 [E14]，差额 23.87 [E15]
- tax 应收 116.62 [E16]，实收 118.77 [E17]，差额 2.15 [E18]（税率 9% [E33]/[E35]）
- recurring 应收 890.00 [E10] = 实收 890.00 [E11]，差额 0.00 [E12]（第 3 行 商业版 × 10 席位 [E21]/[E25]）

算式核对：proration 差额 23.87 [E15] + tax 差额 2.15 [E18] = 26.02，与 total 差额 [E8] 一致；也可用 1438.44 - 1412.42 验证。注意 tax 差额本身即按总差额口径已包含，不要重复累加。

处理建议：按 credit_note 出具 26.02（对应 [E8]），proration 行区间修正为 2026-07-15 起算；同时检查同订阅后续月份 INV-0011-04/05 均 970.10 [E2]/[E1] 是否同口径，以及是否存在同类时区边界批处理问题。
```

(这是一次真实输出,温度 1,每次运行会不同。)这份写得相当好:事实全对,多收 26.02,折算差 23.87,税差 2.15,正好是复算工具的三个数;客户版有结论、有原因、有下一步,没有承诺退款;内部版每个数都带编号。

几个值得留意的地方。客户版里 `[E23][E24]` 引在「算成了 7 月 14 日」后面,查一下证据:E23 和 E24 是复算的两条实收行,它们的描述里写着「2026-07-14 至 2026-08-01」,所以引得对,而且很巧,这正是 Day 686 补上实收行的回报。客户版里写了「国际标准时间」,我没有禁它,因为这是人话;但如果写成「UTC」,客户也许就不懂了,规则里没管。内部版里「应收第 1 行 -82.26 [E19];实收 -87.10 [E23]」带着负号,后面校验器要处理这件事。

## 概念二:数字溯源校验器

### 先量一量:草稿里到底有多少数字找不到出处

一份写得好不代表份份写得好。在写校验器之前,先拿真实草稿量一量问题有多大。对 16 个场景(和昨天跑的同一批)各写一份,原样存进 JSON:

```python
# billsleuth/scratch/collect_drafts.py  对一批场景各写一次两份解释,原样存成 JSON,后面拿它们试校验器(只花写作的钱)
import json
import sys

from billsleuth.explain import write_once
from billsleuth.llm import estimate_cost, get_llm
from scratch.case_kit import load_case

out, tin, tout = {}, 0, 0
llm = get_llm(temperature=1.0)
for sid in sys.argv[1:]:
    question, findings, evidence = load_case(sid)
    exp = write_once(llm, question, findings, evidence)
    out[sid] = {"customer": exp.customer_message, "internal": exp.internal_note}
    print(sid, len(exp.customer_message), len(exp.internal_note))
json.dump(out, open("out/drafts.json", "w"), ensure_ascii=False, indent=1)
```

<div class="line-notes">

- `out, tin, tout = {}, 0, 0` `out` 存草稿;后两个是留着统计 token 的,下面没用上,删掉也行。
- `llm = get_llm(temperature=1.0)` 温度 1,更接近「模型状态不好的时候」。
- `for sid in sys.argv[1:]:` 命令行给一串场景号。
- `out[sid] = {"customer": exp.customer_message, "internal": exp.internal_note}` 两份文字各存一份。
- `json.dump(out, open("out/drafts.json", "w"), ensure_ascii=False, indent=1)` 存到 `out/drafts.json`,先 `mkdir -p out`。后面试校验器都读这个文件,不再花钱。

</div>

```bash
mkdir -p out
uv run python -m scratch.collect_drafts S001 S002 S003 S004 S005 S006 S009 S011 S012 S017 S018 S019 S020 S021 S023 S031
```

16 份草稿共 17825 个字符,花了约 ¥0.16。然后写一个 15 行的探针,最朴素的规则:文字里每个「两位小数」的数,看它的绝对值在不在证据里:

```python
# billsleuth/scratch/v1_probe.py  最朴素的校验:每个两位小数的数,绝对值在不在证据里
import json
import re
from decimal import Decimal

from scratch.case_kit import load_case

AMT = re.compile(r"\d+\.\d{2}")
drafts = json.load(open("out/drafts.json"))
tot = bad = 0
for sid, d in drafts.items():
    _, _, ev = load_case(sid)
    known = {abs(Decimal(e["value"])) for e in ev if re.fullmatch(r"-?\d+\.\d{2}", e["value"])}
    for who in ("customer", "internal"):
        for m in AMT.findall(d[who]):
            tot += 1
            if Decimal(m) not in known:
                bad += 1
                print(sid, who, m, "|", [s for s in re.split(r"[。\n]", d[who]) if m in s][0][:90])
print(tot, bad)
```

<div class="line-notes">

- `AMT = re.compile(r"\d+\.\d{2}")` 数字,小数点,恰好两位。最粗的金额正则。
- `known = {abs(Decimal(e["value"])) for e in ev if re.fullmatch(r"-?\d+\.\d{2}", e["value"])}` 证据里所有金额形状的值,取绝对值。`Decimal` 比较的是数值,`Decimal("26.0")` 和 `Decimal("26.00")` 相等。
- `for m in AMT.findall(d[who]):` 文字里每个金额。
- `if Decimal(m) not in known:` 不在证据里就是「孤儿」。
- `[s for s in re.split(r"[。\n]", d[who]) if m in s][0][:90]` 把这个数所在的那句话找出来,截 90 字符。
- `print(tot, bad)` 总数和孤儿数。

</div>

```bash
uv run python -m scratch.v1_probe
```

```text
S017 internal 20.00 | - INV-0017-05(2026-09-14 至 2026-10-14)应收 123.60 [E2][E7],单张账单本身金额正确,多收为 0.00 [E9];明细核对也一致:
S021 internal 6.00 | 根因类别:wrong_plan_price(订阅费单价比价目表每席位多 6.00)
S021 internal 39.00 | - 单价异常:468.00 ÷ 12 = 39.00;540.00 ÷ 12 = 45.00,每席位多 6.00,与调查结论一致
S021 internal 45.00 | - 单价异常:468.00 ÷ 12 = 39.00;540.00 ÷ 12 = 45.00,每席位多 6.00,与调查结论一致
S021 internal 6.00 | 根因类别:wrong_plan_price(订阅费单价比价目表每席位多 6.00)
S021 internal 360.00 | - 税率无异常:本期适用 SG-GST9(9%),有效期 2024-01-01 至今 [E26];SG-GST8(8%)已于 2023-12-31 到期 [E25],税额差 6.4
S021 internal 45.00 | - 单价异常:468.00 ÷ 12 = 39.00;540.00 ÷ 12 = 45.00,每席位多 6.00,与调查结论一致
S021 internal 39.00 | - 单价异常:468.00 ÷ 12 = 39.00;540.00 ÷ 12 = 45.00,每席位多 6.00,与调查结论一致
442 8
```

(每一行是一处出现,同一个数出现几次就列几行。「所在的那句话」是用子串查找的,`20.00` 会先命中含 `120.00` 的那句,所以 S017 那行显示的不是真正出问题的句子,探针够用,不细究。)

442 个金额,只有 8 处找不到出处,全在内部版,客户版 0 处。不多,但每一处都有故事:

- **`6.00`**:来自 `findings["reasoning"]`。我的 `case_kit.py` 把场景的 `detail`(「订阅费单价比价目表每席位多 6.00」)当结论里的 reasoning 交给了写手,模型照抄了。但 6.00 不是任何工具返回的值,它是造数时我自己写的说明。**结论里的 reasoning 不是出处,只有证据链是。**真实流程里 reasoning 是模型写的,里面的数字同样可能没来源。
- **`39.00`、`45.00`**:模型自己做的除法,468.00 ÷ 12、540.00 ÷ 12。算对了,但证据链里没有这两个数。这是 Day 686 实验里 4.84 和 28.71 的同类。
- **`360.00`**:这个最有意思。「税额差 6.48 系订阅基数被抬高所致(360.00 的 9% 的差异)」,而 6.48 = 72.00 × 9%,订阅基数差是 72.00,不是 360.00。这是一个**编出来的数**,而且嵌在一句听上去头头是道的话里,人眼扫过去很容易漏。
- **`20.00`**:单价,8 席位 × 20.00 = 120.00。算对了(120 ÷ 8),但这一次调查员没有调 `get_invoice`,证据里没有单价这一行。

442 分之 8,是 1.8%,而且写手的提示词里已经明确写了「不要自己算」。**就算只有 1.8%,计费场景里也不能让它发出去**,尤其是 360.00 这样的:没有校验器,没人知道它错了。接下来做的就是把这 8 个自动拦下来,同时别误伤剩下的 434 个。

### 规则怎么定

规则从严到松四档,先写在 `grounding.py` 的开头:

1. 金额等于某条证据的值,有据。证据是负数时(退还行)要看符号。
2. 句子里金额后面紧跟着引用 `[E12]` 的话,这个金额最好等于 E12 的值,对不上记**警告**。引用了不存在的编号是**问题**。
3. 金额等于两条证据之和或之差,**内部版允许**(记下来),**客户版不允许**。
4. 其他都是问题。百分比同理,拿税率和优惠券比例去对。

三个地方的取舍值得讲一讲。

**怎么认一个金额。** 带货币单位的(「26 美元」「1,438.44 USD」),和不带单位但恰好两位小数的(「26.02」)。不带单位的整数不算金额,否则「15 天」「3 个月」「第 2 行」都会被拿去找出处,误报满天飞。代价是「多收了 26」这种既没小数也没单位的写法漏掉了。写作规则要求金额带两位小数,模型基本照做,所以我接受这个代价。

**推导数:内部版放行,客户版拦下。** Day 686 的实验里,模型在客户回答里写「多退了 4.84 美元」,4.84 是 87.10 减 82.26。这个数是对的,但客户拿去核对,账单上找不到 4.84,只会更疑惑。内部版不同:同事想看的就是算式,「72.00 + 6.48 = 78.48」每个操作数都带编号,他一眼能核对。所以同一个「算出来的数」,内部版允许并记录,客户版直接打回,要求只写证据里现成的数。注意只认**加减**,乘除不认:除法的操作数往往是个整数(12 个席位),把它们也放进去,可以拼出的数就多得没边,「找不到出处」的判断就松了。练习 2 会试一下放开除法会怎样。

**符号。** Day 686 用 `lstrip("-")` 粗处理过,说「退还 82.26」和「收取 82.26」就分不清了。现在细一点:文字写了负号的(`-82.26`),必须和证据的符号完全一致;文字没写符号,但证据里是负数的,只要句子里有「退、抵、减、折扣、优惠」这类方向词就放行,没有就记一条警告。方向词的清单是我随手列的,不全,所以它只出警告不出问题。

### 先踩一个坑:减号和连字符长得一样

金额前面的 `-` 是负号还是连字符?内部版常常写算式:「1438.44-1412.42 = 26.02」。看一眼最朴素的写法:

```python
# billsleuth/scratch/minus_trap.py  减号和连字符长得一样:金额前面的「-」什么时候算负号
import re

naive = re.compile(r"-?\d+\.\d{2}")
from billsleuth.grounding import amounts  # noqa: E402

for text in ["1438.44-1412.42 = 26.02", "应退 -82.26 美元", "退还 −32.00 美元,收取 189.87 美元", "发票 INV-0011-03 总额 970.10"]:
    print(f"{text!r}\n  朴素写法 {naive.findall(text)}\n  grounding.amounts {[str(a) for a in amounts(text)]}")
```

<div class="line-notes">

- `naive = re.compile(r"-?\d+\.\d{2}")` 最直觉的写法:可选的负号,加金额。
- `from billsleuth.grounding import amounts  # noqa: E402` import 放在中间只是为了让两种写法并排,`# noqa: E402` 告诉 Ruff 这是故意的。`amounts` 是今天要写的函数,先看结果,下面再讲实现。
- `for text in ["1438.44-1412.42 = 26.02", "应退 -82.26 美元", "退还 −32.00 美元,收取 189.87 美元", "发票 INV-0011-03 总额 970.10"]:` 四种情形:算式里的连字符;半角负号;全角负号(U+2212,模型和排版软件常常这样写);发票号里的连字符。
- `print(f"{text!r}\n  朴素写法 {naive.findall(text)}\n  grounding.amounts {[str(a) for a in amounts(text)]}")` `!r` 打出带引号的原样字符串。

</div>

```bash
uv run python -m scratch.minus_trap
```

```text
'1438.44-1412.42 = 26.02'
  朴素写法 ['1438.44', '-1412.42', '26.02']
  grounding.amounts ['1438.44', '1412.42', '26.02']
'应退 -82.26 美元'
  朴素写法 ['-82.26']
  grounding.amounts ['-82.26']
'退还 −32.00 美元,收取 189.87 美元'
  朴素写法 ['32.00', '189.87']
  grounding.amounts ['-32.00', '189.87']
'发票 INV-0011-03 总额 970.10'
  朴素写法 ['970.10']
  grounding.amounts ['970.10']
```

三个差别:朴素写法把算式里的连字符当成了负号(第 1 行 `-1412.42`),漏掉了全角负号(第 3 行,`32.00` 的符号丢了),别的都对。`grounding.amounts` 靠两个设计避开这些:负号前面不许紧挨着字母、数字或小数点(第 1 行 `4-1` 的 `-` 前面是 4,不算负号),负号两种都认(`-` 和 `−`)。

下面是完整的 `grounding.py`:

```python
# billsleuth/billsleuth/grounding.py  数字溯源校验器:文字里的每个金额、每个百分比,都得能在证据链里找到出处
"""规则从严到松:
1. 金额等于某条证据的值:有据。证据是负数(退还行)时,文字写 -82.26 要和证据的符号一致;
2. 句子里写了 [E12],金额最好等于 E12 的值,对不上记警告;引用了不存在的编号是问题;
3. 金额等于两条证据之和或之差:内部版允许(记下来),客户版不允许;
4. 其他都是问题。百分比同理,拿税率、优惠券比例去对。"""
import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from itertools import combinations

NUM = r"(?:\d{1,3}(?:,\d{3})+|\d+)"
AMOUNT = re.compile(rf"(?<![\w.])([-−]?)({NUM}\.\d{{2}}(?!\d)|{NUM}(?=\s*(?:美元|美金|USD|元)))(\s*(?:美元|美金|USD|元))?((?:\s*\[E\d+\])*)")
PERCENT = re.compile(r"(\d+(?:\.\d+)?)\s*%")
CITE = re.compile(r"\[(E\d+)\]")
SENTENCE = re.compile(r"[^。!?;！？；\n]+[。!?;！？；\n]?")
BANNED = ["保证退款", "一定会退", "已退款", "已经退款", "已经退还", "马上到账", "立即退款", "全额赔偿"]
DIRECTION = re.compile("退|抵|减|折扣|优惠|冲|贷记")
INTERNAL_WORDS = re.compile(r"\b[a-z]+_[a-z_]+\b|recompute|SubmitFindings|(?<![A-Za-z])E\d+\b")
CENT = Decimal("0.01")


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


def scan(text: str) -> list[tuple[Decimal, list[str]]]:
    """文字里的金额,带符号,以及紧跟在金额后面的引用编号。认「带货币单位的数」和「恰好两位小数的数」,
    不带单位的整数(15 天、3 个月)不算。"""
    out = []
    for m in AMOUNT.finditer(text):
        d = _dec(m.group(2))
        if d is not None:
            out.append((-d if m.group(1) else d, CITE.findall(m.group(4))))
    return out


def amounts(text: str) -> list[Decimal]:
    return [a for a, _ in scan(text)]


def percents(text: str) -> list[Decimal]:
    return [(Decimal(p) / 100).normalize() for p in PERCENT.findall(text)]


def _money_values(evidence: list[dict]) -> set[Decimal]:
    vals = set()
    for e in evidence:
        d = _dec(e["value"])
        if d is not None and d == d.quantize(CENT):
            vals.add(d.quantize(CENT))
    return vals


def _rate_values(evidence: list[dict]) -> set[Decimal]:
    rates: set[Decimal] = set()
    for e in evidence:
        d = _dec(e["value"])
        if d is not None and 0 < abs(d) < 1:
            rates.add(d.normalize())
        rates.update(percents(e["claim"]))  # 行描述里写着「(9%)」也算出处
        if "percent" in e["claim"] and d is not None:
            rates.add((d / 100).normalize())  # 百分比优惠券存的是 20,表示 20%
    return rates


def check(text: str, evidence: list[dict], customer_view: bool = False) -> Report:
    by_id = {e["id"]: e for e in evidence}
    money = _money_values(evidence)
    rates = _rate_values(evidence)
    rep = Report(ok=True)

    for sent in SENTENCE.findall(text):
        s = sent.strip()
        for c in CITE.findall(sent):
            if c not in by_id:
                rep.problems.append(f"引用了不存在的证据 [{c}]:{s}")
        for a, cites in scan(sent):
            q = a.quantize(CENT)
            if q in money:
                pass  # 带符号完全一致,有据
            elif q < 0:
                rep.problems.append(f"金额 {q} 带负号,证据里只有 {abs(q)}(正数),符号对不上:{s}")
                continue
            elif -q in money:
                if not DIRECTION.search(sent):
                    rep.warnings.append(f"{q} 在证据里是 {-q}(减项),句子没说是退还或抵扣:{s}")
            elif any(abs(x - y) == q or abs(x) + abs(y) == q for x, y in combinations(money, 2)):
                if customer_view:
                    rep.problems.append(f"金额 {q} 是两条证据加减算出来的,客户版只能写证据里现成的数:{s}")
                else:
                    rep.derived.append(f"{q}(两条证据加减得到):{s}")
                continue
            else:
                rep.problems.append(f"金额 {q} 在证据里找不到出处:{s}")
                continue
            cited_vals = {abs(d.quantize(CENT)) for c in cites if c in by_id and (d := _dec(by_id[c]["value"])) is not None}
            if cites and abs(q) not in cited_vals:
                rep.warnings.append(f"{q} 后面引用的是 {'、'.join(cites)},它们的值不是 {q}:{s}")
        for p in percents(sent):
            if p not in rates:
                rep.problems.append(f"百分比 {p * 100:g}% 在证据里找不到对应的税率或折扣:{s}")

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

<div class="line-notes">

- `NUM = r"(?:\d{1,3}(?:,\d{3})+|\d+)"` 一个数的整数部分:要么带千分位逗号(`1,438`),要么是连续数字。`(?:...)` 是不捕获的分组,只为了把「或」框起来。
- `AMOUNT = re.compile(rf"(?<![\w.])([-−]?)(` 金额的正则分四段捕获:负号、数字、单位、紧跟的引用。开头的 `(?<![\w.])` 是「前面不能是字母、数字、下划线或小数点」,它挡住了算式里的连字符,也挡住 `INV-0011-03` 里的 `-0011`(`V` 在前面)。`rf"..."` 是原始字符串加 f 字符串,里面的 `{{2}}` 写成双括号是因为单括号会被当成插值。
- `PERCENT = re.compile(r"(\d+(?:\.\d+)?)\s*%")` 百分比:数字,可以带小数,可以有空格,然后是 `%`。
- `CITE = re.compile(r"\[(E\d+)\]")` 引用编号 `[E12]`,捕获里面的 `E12`。
- `SENTENCE = re.compile(r"[^。!?;！？；\n]+[。!?;！？；\n]?")` 按句号、感叹号、问号、分号、换行切句,中英文标点都算。模型两种标点都会用,切句只认半角的话,全角的问号、感叹号、分号后面的内容会被并进上一句,问题清单指出的「那句话」就变长了。逗号和冒号不切,一句话的长度到句号为止。
- `BANNED = ["保证退款", "一定会退",` 客户版禁用的承诺词。这个清单是手列的,不全,Day 689 讲它的盲区。
- `DIRECTION = re.compile("退|抵|减|折扣|优惠|冲|贷记")` 方向词,用来判断「证据是负数、文字没写符号」的句子有没有说清是退还。
- `INTERNAL_WORDS = re.compile(r"\b[a-z]+_[a-z_]+\b|recompute|SubmitFindings|(?<![A-Za-z])E\d+\b")` 客户版不该出现的内部用语:下划线连接的英文代码(`timezone_change_date`)、工具名、光秃秃的证据编号。`\b` 是单词边界。
- `CENT = Decimal("0.01")` 量化到分用的。
- `class Report:` 上面的 `@dataclass`, 校验结果:`ok`、`problems`(阻断)、`warnings`(记录不阻断)、`derived`(推导数记录)。[Day 50](/blog/agent-zero/day-050-dataclass/) 讲过 dataclass,列表字段必须用 `field(default_factory=list)`。
- `def _dec(s: str) -> Decimal | None:` 字符串转 Decimal,转不了返回 None。证据的值里有日期、套餐名,不是数字,不能让它们炸掉。
- `return Decimal(s.replace(",", ""))` 先去掉千分位逗号。
- `def scan(text: str) -> list[tuple[Decimal, list[str]]]:` 从文字里抽出每个金额,并带上紧跟在它后面的引用编号。返回的是「(金额, 编号列表)」的列表。
- `for m in AMOUNT.finditer(text):` 逐个匹配。
- `out.append((-d if m.group(1) else d, CITE.findall(m.group(4))))` 捕获到负号就取反;第 4 段(紧跟的引用)里再抽编号。`-d if cond else d` 相当于 JS 的 `cond ? -d : d`。
- `def amounts(text: str) -> list[Decimal]:` 只要金额不要编号,测试和 `minus_trap.py` 用。
- `return [(Decimal(p) / 100).normalize() for p in PERCENT.findall(text)]` 百分比换成小数:`9%` 变 `0.09`,`normalize()` 去掉末尾的零。
- `def _money_values(evidence: list[dict]) -> set[Decimal]:` 证据里「形状是金额」的值。
- `if d is not None and d == d.quantize(CENT):` 能转成数,而且量化到分以后不变,说明它本来就是两位小数以内。`0.09` 这个税率也会进来,没关系。
- `def _rate_values(evidence: list[dict]) -> set[Decimal]:` 证据里「可以当税率或折扣比例」的值。
- `if d is not None and 0 < abs(d) < 1:` 绝对值在 0 和 1 之间的,像 `0.09`,当税率。
- `rates.update(percents(e["claim"]))  # 行描述里写着「(9%)」也算出处` 发票税行的描述是「税 SG-GST9(9%)」,模型没调 `get_tax_rate` 时,9% 只在这里。这是 Day 686 之前那版老校验器吃过误报的地方,这次一开始就考虑进来。
- `if "percent" in e["claim"] and d is not None:` 百分比优惠券在证据里存的是 `20`,claim 里写着 `percent`。
- `rates.add((d / 100).normalize())  # 百分比优惠券存的是 20,表示 20%` 除以 100 才是 0.2。
- `def check(text: str, evidence: list[dict], customer_view: bool = False) -> Report:` 总入口。`customer_view` 决定用客户版还是内部版的规矩。
- `by_id = {e["id"]: e for e in evidence}` 编号到证据的字典。字典推导式,相当于 JS 的 `Object.fromEntries`。
- `for sent in SENTENCE.findall(text):` 一句一句查,报告里能指出是哪句话出了问题。
- `for c in CITE.findall(sent):` 句子里每个引用编号。
- `rep.problems.append(f"引用了不存在的证据 [{c}]:{s}")` 编号不存在,直接是问题。
- `for a, cites in scan(sent):` 句子里每个金额和它紧跟的引用。
- `q = a.quantize(CENT)` 统一成两位小数再比,`Decimal("26")` 和 `Decimal("26.00")` 就不会因为位数不同被判不等。
- `if q in money:` 第一档:带符号完全一致。`pass` 表示什么都不做,往下去查引用。
- `elif q < 0:` 文字写了负号,但证据里没有这个负数(上一条已经排除),说明符号对不上。
- `continue` 这个金额已经报了问题,不再往下查引用。
- `elif -q in money:` 文字没写符号(`q` 是正的),证据里是 `-q`:一个减项,比如退还行。
- `if not DIRECTION.search(sent):` 句子里没有方向词就记一条警告,让人看一眼。
- `elif any(abs(x - y) == q or abs(x) + abs(y) == q for x, y in combinations(money, 2)):` 第三档:任取两条证据,差的绝对值或绝对值之和等于它。`combinations(money, 2)` 来自标准库 `itertools`,给出所有不重复的两两组合,比如三个数 a、b、c 给出 (a,b)、(a,c)、(b,c)。
- `rep.problems.append(f"金额 {q} 是两条证据加减算出来的,客户版只能写证据里现成的数:{s}")` 客户版打回。
- `rep.derived.append(f"{q}(两条证据加减得到):{s}")` 内部版放行,记在 `derived` 里供同事复核。
- `rep.problems.append(f"金额 {q} 在证据里找不到出处:{s}")` 第四档:找不到。本课开头的 360.00 就死在这一行。
- `cited_vals = {abs(d.quantize(CENT)) for c in cites if c in by_id and (d := _dec(by_id[c]["value"])) is not None}` 紧跟在这个金额后面的编号对应的证据值。`:=` 是海象运算符,在表达式里一边赋值一边使用,这里在推导式里先算出 `d` 再判断它不是 None,省得写两遍 `_dec(...)`。
- `if cites and abs(q) not in cited_vals:` 写了编号,但编号指向的证据不是这个值,记警告。金额后面没写编号的不管,因为客户版常常不写。
- `rep.warnings.append(f"{q} 后面引用的是 {'、'.join(cites)},它们的值不是 {q}:{s}")` 警告里写出引用了哪几个。
- `for p in percents(sent):` 句子里每个百分比。
- `if p not in rates:` 不在税率、优惠比例里就是问题。
- `rep.problems.append(f"百分比 {p * 100:g}% 在证据里找不到对应的税率或折扣:{s}")` `:g` 让 `9.0` 显示成 `9`。
- `if customer_view:` 下面是客户版的额外规则。
- `for w in BANNED:` 逐个检查承诺词。
- `if m := INTERNAL_WORDS.search(CITE.sub("", text)):` 先去掉方括号引用再查内部用语,所以 `[E8]` 不会被误伤,而模型写成裸的 `E8` 就会被抓住。
- `rep.ok = not rep.problems` 只有问题才阻断,警告和推导数不阻断。
- `def strip_citations(text: str) -> str:` 客户版发出之前去掉编号。`\s*` 把编号前面的空格也吃掉,「26.02 美元 [E8]。」变成「26.02 美元。」。

</div>

### 在 16 份草稿上跑

写一个脚本,对每份草稿的两个版本各过一遍校验:

```python
import json
from collections import Counter
from billsleuth.grounding import check
from scratch.case_kit import load_case
drafts = json.load(open("out/drafts.json"))
c = Counter()
for sid, d in drafts.items():
    _, _, ev = load_case(sid)
    for who, view in (("customer", True), ("internal", False)):
        r = check(d[who], ev, customer_view=view)
        c[(who, "ok" if r.ok else "bad")] += 1; c[(who, "warn")] += len(r.warnings); c[(who, "derived")] += len(r.derived)
        for p in r.problems: print(sid, who, "问题:", p[:130])
        for p in r.warnings: print(sid, who, "警告:", p[:110])
print(dict(c))
```

<div class="line-notes">

- `c = Counter()` 数各种计数。
- `r = check(d[who], ev, customer_view=view)` 客户版和内部版各过一遍,客户版用严的规矩。
- `c[(who, "ok" if r.ok else "bad")] += 1; c[(who, "warn")] += len(r.warnings); c[(who, "derived")] += len(r.derived)` 一行三个计数,分号隔开。
- `for p in r.problems: print(sid, who, "问题:", p[:130])` 问题全打,警告也打。

</div>

```bash
uv run python -m scratch.probe_v2
```

```text
S005 internal 警告: 312.00 后面引用的是 E20、E28,它们的值不是 312.00:- discount:应收 -62.40 [E13](WELCOME20 -20% × 312.00 [E20][E28]),实收 0.00 [E1
S017 internal 问题: 金额 20.00 在证据里找不到出处:- 订阅侧核对:create 事件本地日期 2026-05-14、plan starter、quantity 8 [E23][E24][E25],与 8 席位 × 20.00 = 120.00 相符。
S017 internal 警告: 123.60 后面引用的是 E10,它们的值不是 123.60:结论与处置:overcharge = 123.60 [E10],即实际扣款合计 247.20 [E10] 中超出单张账单应收 123.60 [E7] 的部分
S020 internal 警告: 93.45 在证据里是 -93.45(减项),句子没说是退还或抵扣:- discount:应收 -105.98 [E16](即 -15% [E25][E38]),实收 -93.45 [E30],差额 12.53 [E18
S021 internal 问题: 金额 6.00 在证据里找不到出处:根因类别:wrong_plan_price(订阅费单价比价目表每席位多 6.00)。
S021 internal 问题: 金额 39.00 在证据里找不到出处:- 单价异常:468.00 ÷ 12 = 39.00;
S021 internal 问题: 金额 45.00 在证据里找不到出处:540.00 ÷ 12 = 45.00,每席位多 6.00,与调查结论一致。
S021 internal 问题: 金额 6.00 在证据里找不到出处:540.00 ÷ 12 = 45.00,每席位多 6.00,与调查结论一致。
S021 internal 问题: 金额 360.00 在证据里找不到出处:SG-GST8(8%)已于 2023-12-31 到期 [E25],税额差 6.48 系订阅基数被抬高所致(360.00 的 9% 的差异),非税率错误。
S021 internal 问题: 金额 45.00 在证据里找不到出处:建议同时修正订阅计费单价(45.00 → 39.00)以防下期重复发生。
S021 internal 问题: 金额 39.00 在证据里找不到出处:建议同时修正订阅计费单价(45.00 → 39.00)以防下期重复发生。
{('customer', 'ok'): 16, ('customer', 'warn'): 0, ('customer', 'derived'): 0, ('internal', 'ok'): 14, ('internal', 'warn'): 3, ('internal', 'derived'): 0, ('internal', 'bad'): 2}
```

(每行内容被脚本截了前面一段。)

数一数:客户版 16/16 通过,没有警告;内部版 14/16 通过,2 份不过(S017 的 20.00,S021 的 6.00、39.00、45.00、360.00),另有 3 条警告。**前面探针找到的 8 处孤儿,一个不漏地进了问题清单**,而且没有多出来别的误报:442 个金额里,另外 434 个都认出来了。

3 条警告各有说法。S017 那条最有意思:「overcharge = 123.60 [E10]」,E10 是实际扣款合计 247.20,不是 123.60,**模型把编号引错了**。要点是 123.60 这个数在证据里确实有(是账单应收 [E7]),所以不是编造,只是引用错了位置,警告就是用来抓这种的。S005 那条同类:一个算式里「312.00」后面跟了两个编号,值都不是 312.00。S020 那条是「实收 -93.45」没写退还类的方向词,其实是模型在列行项目,不影响,这条警告基本是噪声,但留着也无害。

### 拿 Day 686 的那段回答再试一次

Day 686 实验里模型写的那段话,里面有 4.84 和 28.71 两个自己算的数,当时我说「Day 688 的校验器会拦下来」。兑现一下:把那段话存成 `scratch/s011_reply.txt`,用两种规矩各过一遍:

```python
# billsleuth/scratch/check_686_reply.py  拿 Day 686 实验里那段回答,过一遍新的校验器(不调模型)
from billsleuth.grounding import check
from scratch.case_kit import load_case

_, _, evidence = load_case("S011")
text = open("scratch/s011_reply.txt", encoding="utf-8").read()
for view, name in ((True, "客户版"), (False, "内部版")):
    r = check(text, evidence, customer_view=view)
    print(f"--- 按{name}的规矩:ok={r.ok},问题 {len(r.problems)} 条,推导 {len(r.derived)} 条")
    for p in r.problems:
        print("  问题:", p[:60])
    for d in r.derived:
        print("  推导:", d[:60])
```

<div class="line-notes">

- `_, _, evidence = load_case("S011")` 只要证据。这一版证据里已经含 Day 686 补上的实收行。
- `text = open("scratch/s011_reply.txt", encoding="utf-8").read()` Day 686 实验里第 1 次的回答原文,一整段话。
- `for view, name in ((True, "客户版"), (False, "内部版")):` 同一段文字,分别按两个版本的规矩检查。
- `print(f"--- 按{name}的规矩:ok={r.ok},问题 {len(r.problems)} 条,推导 {len(r.derived)} 条")` 先看总数。
- `print("  问题:", p[:60])` 每条只打前 60 个字符。

</div>

```bash
uv run python -m scratch.check_686_reply
```

```text
--- 按客户版的规矩:ok=False,问题 2 条,推导 0 条
  问题: 金额 4.84 是两条证据加减算出来的,客户版只能写证据里现成的数:我们系统把您 7 月 15 日的升级错误地从 7 月
  问题: 金额 28.71 是两条证据加减算出来的,客户版只能写证据里现成的数:我们系统把您 7 月 15 日的升级错误地从 7 
--- 按内部版的规矩:ok=True,问题 0 条,推导 2 条
  推导: 4.84(两条证据加减得到):我们系统把您 7 月 15 日的升级错误地从 7 月 14 日开始计算，多算了 1 天：旧
  推导: 28.71(两条证据加减得到):我们系统把您 7 月 15 日的升级错误地从 7 月 14 日开始计算，多算了 1 天：
```

客户版两条问题正好是 4.84 和 28.71;同一段话当内部版看就过了,两个数记成推导数。这就是「同一个数,两个读者两种态度」。这个输出也让我回头看了一眼切句:Day 686 那段回答里一个句子很长,从「我们系统把您 7 月 15 日的升级……」一直到句号,逗号和冒号都不切,所以问题清单里指出的那句话是整整一大句。想要更细的定位可以改成按逗号也切,代价是引用编号和金额可能被切到两句里去,我没改。

## 测试

校验器每条规则一条测试,证据用手写的小样本。新建 `tests/test_grounding.py`:

```python
# billsleuth/tests/test_grounding.py  数字溯源校验器:每条规则一条测试,证据是手写的小样本
from decimal import Decimal as D

import pytest

from billsleuth.grounding import amounts, check, percents, strip_citations

EV = [
    {"id": "E1", "claim": "INV-0011-03 按规则应收", "source_tool": "recompute_invoice", "source_ref": "INV-0011-03", "value": "1412.42"},
    {"id": "E2", "claim": "INV-0011-03 实际开票金额", "source_tool": "recompute_invoice", "source_ref": "INV-0011-03", "value": "1438.44"},
    {"id": "E3", "claim": "INV-0011-03 多收(实际 - 应收)", "source_tool": "recompute_invoice", "source_ref": "INV-0011-03", "value": "26.02"},
    {"id": "E4", "claim": "SG 在 2026-08-01 有效税率 SG-GST9", "source_tool": "get_tax_rate", "source_ref": "SG-GST9", "value": "0.09"},
    {"id": "E5", "claim": "INV-0011-03 应收第 1 行:未使用时间退还", "source_tool": "recompute_invoice", "source_ref": "INV-0011-03", "value": "-82.26"},
    {"id": "E6", "claim": "优惠券 WELCOME20(percent,3 个月)", "source_tool": "get_subscription_timeline", "source_ref": "WELCOME20", "value": "20"},
]


def test_amount_extraction():
    assert amounts("多收了 26.02 美元,总额 1,438.44 USD,另有 30 元,3 个月,15 天") == [D("26.02"), D("1438.44"), D("30")]
    assert amounts("1438.44-1412.42 = 26.02") == [D("1438.44"), D("1412.42"), D("26.02")]  # 连字符不是负号
    assert amounts("退还 -82.26,以及 −32.00 美元") == [D("-82.26"), D("-32.00")]  # 半角、全角负号都认
    assert percents("税率 9%,折扣 20 %") == [D("0.09"), D("0.2")]


def test_grounded_text_passes():
    r = check("应收 1412.42 [E1],实际 1438.44 [E2],多收 26.02 美元 [E3]。税率 9% [E4]。", EV)
    assert r.ok and not r.warnings and not r.derived


def test_made_up_number_is_rejected():
    r = check("多收了 25.80 美元 [E3]。", EV)
    assert not r.ok and "25.80" in r.problems[0]


def test_citation_must_exist_and_should_match():
    assert not check("多收了 26.02 美元 [E99]。", EV).ok
    r = check("多收了 26.02 美元 [E1]。", EV)  # 26.02 有出处,但引用的 E1 是应收
    assert r.ok and "后面引用的是 E1" in r.warnings[0]


def test_sign_is_checked():
    assert check("未使用时间退还 -82.26 美元 [E5]。", EV).ok
    r = check("多收了 -26.02 美元。", EV)  # 证据里 26.02 是正数,文字写成负的
    assert not r.ok and "符号对不上" in r.problems[0]
    r = check("退还了 82.26 美元 [E5]。", EV)  # 证据是 -82.26,文字写成退还,方向说清楚了
    assert r.ok and not r.warnings
    r = check("收取了 82.26 美元。", EV)  # 证据是减项,句子却说收取
    assert r.ok and "减项" in r.warnings[0]


def test_derived_number_internal_ok_customer_blocked():
    internal = check("两者相差 26.02 美元。", EV[:2])  # E3 不在,但 1438.44 - 1412.42 = 26.02
    assert internal.ok and internal.derived
    customer = check("两者相差 26.02 美元。", EV[:2], customer_view=True)
    assert not customer.ok and "算出来的" in customer.problems[0]


def test_multiplication_is_not_derivable():
    r = check("每席位 45.00 美元。", [{**EV[0], "value": "540.00"}])  # 540.00 ÷ 12 只能自己除,不在认可的算法里
    assert not r.ok


def test_percent_from_rate_coupon_or_line_description():
    assert check("税率 9% [E4],优惠券 20% [E6]。", EV).ok
    ev = [{"id": "E1", "claim": "INV-0009-04 第 2 行:税 SG-GST9(9%)", "source_tool": "get_invoice", "source_ref": "x", "value": "17.55"}]
    assert check("税率 9% [E1]。", ev).ok
    r = check("税率 8% [E4]。", EV)
    assert not r.ok and "8%" in r.problems[0]


def test_customer_view_forbids_promises_and_jargon():
    r = check("多收了 26.02 美元,已经退款到您的卡上。", EV, customer_view=True)
    assert not r.ok and any("已经退款" in p for p in r.problems)
    assert not check("根因是 timezone_change_date。", EV, customer_view=True).ok
    assert not check("见证据 E3。", EV, customer_view=True).ok  # 光秃秃的编号
    assert check("多收了 26.02 美元 [E3]。", EV, customer_view=True).ok  # 方括号引用发出前会被去掉,不算


def test_strip_citations():
    assert strip_citations("多收 26.02 美元 [E3][E8]。") == "多收 26.02 美元。"


@pytest.mark.parametrize("text", ["", "您好,已经核对过了。", "这张发票金额没有问题。"])
def test_text_without_numbers_passes(text):
    assert check(text, EV).ok
```

<div class="line-notes">

- `from billsleuth.grounding import amounts, check, percents, strip_citations` 四个公开函数。
- `EV = [` 六条手写证据,覆盖应收、实收、多收、税率、负数的退还行、百分比优惠券。值全是 S011 的真实数字。
- `{"id": "E5"` 负数证据,测符号用。
- `{"id": "E6"` 百分比优惠券,值是 20 不是 0.2。
- `assert amounts("多收了 26.02 美元,总额 1,438.44 USD,另有 30 元,3 个月,15 天") == [D("26.02"), D("1438.44"), D("30")]` 前三个认,「3 个月」「15 天」不认。
- `assert amounts("1438.44-1412.42 = 26.02")` 今天踩的坑,钉死。
- `assert amounts("退还 -82.26,以及 −32.00 美元") == [D("-82.26"), D("-32.00")]  # 半角、全角负号都认` 两种负号。
- `assert percents("税率 9%,折扣 20 %") == [D("0.09"), D("0.2")]` 带空格的 `20 %` 也认。
- `assert r.ok and not r.warnings and not r.derived` 完全合规的文字:通过,没有警告,没有推导。
- `assert not r.ok and "25.80" in r.problems[0]` 编造的数被抓,问题里写出了是哪个数。
- `assert not check("多收了 26.02 美元 [E99]。", EV).ok` 引用不存在的编号:问题。
- `r = check("多收了 26.02 美元 [E1]。", EV)  # 26.02 有出处,但引用的 E1 是应收` 数有出处,引错了:通过但有警告。
- `assert check("未使用时间退还 -82.26 美元 [E5]。", EV).ok` 带负号、和证据一致。
- `r = check("多收了 -26.02 美元。", EV)  # 证据里 26.02 是正数,文字写成负的` 符号反了:问题。
- `r = check("退还了 82.26 美元 [E5]。", EV)  # 证据是 -82.26,文字写成退还,方向说清楚了` 没写符号但有「退」字:放行,没有警告。
- `r = check("收取了 82.26 美元。", EV)  # 证据是减项,句子却说收取` 方向词不对:放行但记警告。
- `internal = check("两者相差 26.02 美元。", EV[:2])  # E3 不在,但 1438.44 - 1412.42 = 26.02` 只给前两条证据(应收和实收),26.02 只能是推导数。
- `assert not customer.ok and "算出来的" in customer.problems[0]` 同样的文字,客户版被打回。
- `r = check("每席位 45.00 美元。", [{**EV[0], "value": "540.00"}])  # 540.00 ÷ 12 只能自己除,不在认可的算法里` 只有一条证据时 `combinations` 配不出对,更不会认除法。
- `assert check("税率 9% [E4],优惠券 20% [E6]。", EV).ok` 税率来自 E4 的值 0.09,优惠券来自 E6 的 20 除以 100。
- `ev = [{"id": "E1", "claim": "INV-0009-04` 税率只出现在行描述里的情形,Day 686 之前的老校验器就是在这里误报的。
- `assert not r.ok and "8%" in r.problems[0]` 8% 找不到:问题。
- `assert not check("根因是 timezone_change_date。", EV, customer_view=True).ok` 客户版出现内部代码。
- `assert not check("见证据 E3。", EV, customer_view=True).ok  # 光秃秃的编号` 不带方括号的编号也抓。
- `assert check("多收了 26.02 美元 [E3]。", EV, customer_view=True).ok  # 方括号引用发出前会被去掉,不算` 方括号里的编号是被允许的,发出前统一去掉。
- `assert strip_citations("多收 26.02 美元 [E3][E8]。") == "多收 26.02 美元。"` 连着两个编号也去干净,编号前的空格一起去。
- `@pytest.mark.parametrize("text", ["", "您好,已经核对过了。", "这张发票金额没有问题。"])` 没有数字的文字不该被误伤。

</div>

```bash
uv run pytest tests/test_grounding.py -q
uv run pytest -q
```

```text
.............                                                            [100%]
13 passed in 0.05s
...............................................................          [100%]
279 passed in 8.34s
```

13 条全绿,全部测试 279 条(Day 687 结束是 266 条)。

## 今天的文件

| 零件 | 文件 | 新建还是修改 | 后面哪天用到 |
| --- | --- | --- | --- |
| 两份解释的 schema、规则、写一次 | `billsleuth/explain.py` | 新建 | Day 689 加重写循环和兜底 |
| 数字溯源校验器 | `billsleuth/grounding.py` | 新建 | Day 689 接进图,Day 693 评测 |
| 校验器测试 | `tests/test_grounding.py` | 新建 | 每次改规则 |
| 给写手造输入、存草稿 | `scratch/case_kit.py`、`collect_drafts.py`、`try_writer.py` | 新建 | Day 689 |
| 探针和验证 | `scratch/v1_probe.py`、`probe_v2.py`、`minus_trap.py`、`check_686_reply.py`、`s011_reply.txt` | 新建 | |

校验器每一段对应的规则:

| 规则 | 代码 | 对应的测试 |
| --- | --- | --- |
| 认哪些是金额 | `AMOUNT` + `scan` | `test_amount_extraction` |
| 符号要一致 | `check` 里 `q in money` / `q < 0` / `-q in money` 三个分支 | `test_sign_is_checked` |
| 推导数 | `combinations(money, 2)` 那一支 | `test_derived_number_internal_ok_customer_blocked` |
| 引用要对得上 | `by_id`、`cited_vals` | `test_citation_must_exist_and_should_match` |
| 百分比出处 | `_rate_values` | `test_percent_from_rate_coupon_or_line_description` |
| 客户版禁用词、内部用语 | `BANNED`、`INTERNAL_WORDS` | `test_customer_view_forbids_promises_and_jargon` |

## 动手练习

**练习 1:去掉金额前面的断言,看谁会红。** 把 `AMOUNT` 开头的 `(?<![\w.])` 删掉。跑 `tests/test_grounding.py`,再跑一遍 16 份草稿的 `probe_v2.py`。红的是哪几条?草稿的结果变了吗?

<details><summary>参考答案</summary>

改完以后:

```bash
uv run pytest tests/test_grounding.py -q
uv run python -m scratch.probe_v2 | tail -1
```

```text
FAILED tests/test_grounding.py::test_amount_extraction - AssertionError: asse...
1 failed, 12 passed in 0.19s
{('customer', 'ok'): 16, ('customer', 'warn'): 0, ('customer', 'derived'): 0, ('internal', 'ok'): 14, ('internal', 'warn'): 3, ('internal', 'derived'): 0, ('internal', 'bad'): 2}
```

只红了 `test_amount_extraction` 一条,而 16 份真实草稿的结果**一个字都没变**。原因是真实草稿里算式写成「72.00 + 6.48」带空格,没有写「1438.44-1412.42」这种紧挨着的减法,这个坑在今天的数据上从来没被踩到。**这就是为什么要为一条规则专门写一条构造出来的测试:真实数据覆盖不到的边角,只有手造的输入能守住。**改回去,13 条重新全绿。

</details>

**练习 2:内部版再认一种推导「证据金额 ÷ 证据里的整数」。** 用 S021 那份内部说明试:认了除法以后,还剩几个问题?剩下的是什么?

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex2_quotient.py  练习 2:内部版再认一种推导「证据金额 ÷ 证据里的整数」,看 S021 的内部说明还剩几个问题
import json
import re
from decimal import Decimal

from billsleuth import grounding
from scratch.case_kit import load_case

d = json.load(open("out/drafts.json"))["S021"]["internal"]
_, _, ev = load_case("S021")
ints = {Decimal(e["value"]) for e in ev if re.fullmatch(r"\d+", e["value"]) and int(e["value"]) > 1}
money = grounding._money_values(ev)  # 约定以下划线开头的是内部函数,这里只为演示借用
quotients = {(m / n).quantize(Decimal("0.01")) for m in money for n in ints}

before = grounding.check(d, ev)
left = [p for p in before.problems if Decimal(re.search(r"金额 (-?[\d.]+)", p).group(1)) not in quotients]  # type: ignore[union-attr]
print(f"原来 {len(before.problems)} 个问题,认了除法以后剩 {len(left)} 个:")
for p in left:
    print(" ", p[:70])
```

<div class="line-notes">

- `d = json.load(open("out/drafts.json"))["S021"]["internal"]` 取 S021 的内部版草稿。
- `ints = {Decimal(e["value"]) for e in ev if re.fullmatch(r"\d+", e["value"]) and int(e["value"]) > 1}` 证据里的整数(席位数 12 之类),大于 1 的才有意义。
- `money = grounding._money_values(ev)` 借用校验器里的内部函数,取证据里的金额。
- `quotients = {(m / n).quantize(Decimal("0.01")) for m in money for n in ints}` 所有「金额 ÷ 整数」的结果,双层推导式。
- `left = [p for p in before.problems if Decimal(re.search(r"金额 (-?[\d.]+)", p).group(1)) not in quotients]` 把原来的问题清单里,金额能由除法得到的剔掉。问题文字里「金额 6.00」的数字用正则捞出来。

</div>

```bash
uv run python -m scratch.ex2_quotient
```

```text
原来 7 个问题,认了除法以后剩 1 个:
  金额 360.00 在证据里找不到出处:SG-GST8(8%)已于 2023-12-31 到期 [E25],税额差 6.48 系订阅基数被抬高所致(360.00 的 9% 的差异),非税率错误。
```

7 个问题里 6 个消失了:39.00 = 468.00 ÷ 12,45.00 = 540.00 ÷ 12,连 6.00 也是 72.00 ÷ 12。剩下的只有 360.00,正是真正编造出来的那个。结论:放开除法能少很多误报,代价是认可的数变多了,「巧合对上」的概率上升(12 个整数乘上几十个金额,能凑出几百个数)。我的取舍是:今天先不放开,让模型重写时自己改成引用现成的数,明天的重写循环会看到这种问题清单对模型多管用。你的业务如果内部说明里除法很常见,放开也是合理的,但要把可用的整数限定为「席位数、月数」这类,不要所有整数都算。

</details>

**练习 3:去掉「不要自己算」那一条,问题变多少?** 把 `WRITER_RULES` 里这一条去掉,16 个场景各写一遍,和保留时对比有问题的份数。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex3_no_calc_rule.py  练习 3:把提示词里「不要自己算」那一条去掉,16 个场景的数字问题变多少
from collections import Counter

from billsleuth import explain
from billsleuth.grounding import check
from billsleuth.llm import get_llm
from scratch.case_kit import load_case

IDS = "S001 S002 S003 S004 S005 S006 S009 S011 S012 S017 S018 S019 S020 S021 S023 S031".split()
LINE = "- 需要算的数(差额、合计)不要自己算,证据清单里有现成的就用现成的;没有就不要写这个数。\n"
assert LINE in explain.WRITER_RULES
llm = get_llm(temperature=1.0)
c: Counter[str] = Counter()
for variant, rules in (("有这条规则", explain.WRITER_RULES), ("去掉这条规则", explain.WRITER_RULES.replace(LINE, ""))):
    explain.WRITER_RULES = rules
    for sid in IDS:
        q, f, ev = load_case(sid)
        exp = explain.write_once(llm, q, f, ev)
        cu, it = check(exp.customer_message, ev, customer_view=True), check(exp.internal_note, ev)
        c[f"{variant} 客户版有问题"] += not cu.ok
        c[f"{variant} 内部版有问题"] += not it.ok
        c[f"{variant} 问题条数"] += len(cu.problems) + len(it.problems)
for k, v in c.items():
    print(k, v)
```

<div class="line-notes">

- `LINE = "- 需要算的数(差额、合计)不要自己算,证据清单里有现成的就用现成的;没有就不要写这个数。\n"` 要去掉的那一行,一字不差,下面 `assert` 确认它真在规则里。
- `for variant, rules in (` 两种提示词各跑一轮,`replace(LINE, "")` 生成去掉那一行的版本。
- `explain.WRITER_RULES = rules` 直接改模块里的全局变量。`writer_prompt` 每次调用时才读它,所以改了立刻生效。
- `c[f"{variant} 客户版有问题"] += not cu.ok` 布尔值加到计数器里,`not cu.ok` 为真就加 1。
- `c[f"{variant} 问题条数"] += len(cu.problems) + len(it.problems)` 两份文字的问题条数合计。

</div>

```bash
uv run python -m scratch.ex3_no_calc_rule
```

```text
有这条规则 客户版有问题 0
有这条规则 内部版有问题 1
有这条规则 问题条数 2
去掉这条规则 客户版有问题 2
去掉这条规则 内部版有问题 3
去掉这条规则 问题条数 8
```

每组 16 份。有这条规则:客户版 0 份有问题、内部版 1 份,共 2 条;去掉以后:客户版 2 份、内部版 3 份,共 8 条。方向清楚:一句提示词让问题少了大约四分之三,但没有清零。这是单次运行、每组 16 个样本,数字有波动,别当成精确的比例(而且这一轮「有这条规则」下内部版只有 1 份有问题,比前面 16 份草稿那次的 2 份还少,正是波动)。结论是两层都要:提示词降低出错率,校验器保证出错了发不出去。花费约 ¥0.32(32 次写作,每次约 ¥0.01)。

</details>

**练习 4:给校验器加一条日期规则之前,先量一量。** 客户版和内部版里的日期也可能写错。在 16 份草稿上数一数:`2026-07-15` 这种写法有多少个、其中多少个在证据里找不到;`7 月 16 日` 这种写法有多少个。想想这条规则值不值得加。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex4_dates.py  练习 4:给校验器加一条日期规则,先在 16 份草稿上量一量会误报多少
import json
import re

from scratch.case_kit import load_case

ISO = re.compile(r"\d{4}-\d{2}-\d{2}")
CN = re.compile(r"(\d{1,2}) 月 (\d{1,2}) 日")
drafts = json.load(open("out/drafts.json"))
iso_total = iso_miss = cn_total = 0
for sid, d in drafts.items():
    _, _, ev = load_case(sid)
    haystack = " ".join(e["claim"] + " " + e["value"] for e in ev)
    for who in ("customer", "internal"):
        for day in ISO.findall(d[who]):
            iso_total += 1
            if day not in haystack:
                iso_miss += 1
                print(f"{sid} {who} 日期 {day} 不在证据里")
        cn_total += len(CN.findall(d[who]))
print(f"ISO 写法 {iso_total} 个,找不到 {iso_miss} 个;「7 月 16 日」写法 {cn_total} 个")
```

<div class="line-notes">

- `ISO = re.compile(r"\d{4}-\d{2}-\d{2}")` 证据里的日期都是这个写法。
- `CN = re.compile(r"(\d{1,2}) 月 (\d{1,2}) 日")` 客户版里模型爱写的写法,没有年份。
- `haystack = " ".join(e["claim"] + " " + e["value"] for e in ev)` 把所有证据的描述和值拼成一大段,下面直接做子串查找。日期有的在 claim 里(「2026-07-15 至 2026-08-01」),有的在 value 里。
- `if day not in haystack:` 找不到的才打印。
- `cn_total += len(CN.findall(d[who]))` 只数,不查:没有年份,没法直接和证据比。

</div>

```bash
uv run python -m scratch.ex4_dates
```

```text
ISO 写法 94 个,找不到 0 个;「7 月 16 日」写法 14 个
```

94 个 ISO 日期一个都没写错,因为模型是直接抄证据里的日期。而 14 个「7 月 16 日」的写法没有年份,校验它要先猜年份、再换算格式,规则复杂得多。结论:日期这条规则在今天的数据上抓不到任何东西,而最好用的写法(中文日期)又最难校验,先不加。更值得做的是把规则写进写作提示词(「日期一律用证据里的写法」),等评测集里真的出现日期错误再回来补。这是「先量再写规则」的一个例子:规则不是越多越好,每条都有维护成本和误报风险。

</details>

**验收标准:** `uv run pytest -q` 全绿(279 条左右);`probe_v2.py` 在 16 份草稿上客户版全过、内部版问题清单里能看到 360.00;`check_686_reply.py` 输出客户版拦下 4.84 和 28.71、内部版记为推导;练习 1 能解释为什么真实草稿没有变化;能说出为什么「推导数」在两个版本里待遇不同。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 客户版 / 内部版 | 同一个结论写给两个读者的两份文字,例子:客户版不能写 `timezone_change_date`,内部版必须写 |
| 溯源 grounding | 文字里的内容能追溯到可靠来源,这里专指金额和百分比能在证据链里找到 |
| 孤儿数字 | 文字里出现、证据链里找不到的数字,例子:S021 里的 360.00 |
| 推导数 | 等于两条证据之和或之差的数字,内部版放行并记录,客户版打回 |
| 引用 citation | 数字后面的证据编号,如 `[E8]` |
| 问题 / 警告 | 问题会阻断(`ok` 变 False),警告只是记录,例子:引错编号是警告,金额找不到是问题 |
| 误报 / 漏网 | 校验器把合法内容判错 / 把错误内容放过 |
| 方向词 | 「退、抵、减、折扣」这类说明金额是减项的词,用来判断负数证据的写法对不对 |
| 全角负号 | `−`(U+2212),和半角连字符 `-` 长得几乎一样,模型和排版软件常用 |
| 后行断言 | 正则里的 `(?<![\w.])`,表示「前面不能是字母、数字、小数点」,用来区分负号和连字符 |
| 海象运算符 | `:=`,在表达式里先赋值再判断,例子:`(d := _dec(...)) is not None` |

## 常见误区

**让模型「务必准确,不要编造数字」就够了。** 实测提示词里有「不要自己算」时,16 份里仍有 2 条数字问题,去掉以后涨到 8 条。提示词降低概率,不能消除。

**结论里的 reasoning 可以当出处。** S021 里的 6.00 来自结论里的说明文字,它不是任何工具返回的值。只有证据链是出处,模型写的 reasoning 不是。

**金额前面的 `-` 都是负号。** 「1438.44-1412.42」里的是减号,朴素正则会把 1412.42 当成负数。今天专门写了一条测试守着它,而 16 份真实草稿里从没出现过这种写法,所以草稿跑不出这个问题。

**不管正负号。** 退还行在证据里是 -82.26,文字写「收取 82.26」就是方向反了。只比绝对值会漏掉。

**客户版和内部版用同一套规矩。** 算式对同事是帮助,对客户是困惑。同一个推导数,内部版要放行并记下来,客户版要打回。

**校验器越严越安全。** 太严会让模型反复重写,最后只剩干巴巴的模板。今天把警告和问题分开,就是为了只阻断确定有问题的,可疑的只记录。

**有出处就等于对。** 引用了真实的数不代表用在对的地方。S017 里「overcharge = 123.60 [E10]」,123.60 是真数,E10 却是 247.20,校验器只能出警告。更深的一层(数字是真的、用错了地方)明天讲。

## 学习资料

### 文档与文章

- [FActScore 论文](https://arxiv.org/abs/2305.14251):把长文本拆成原子事实、逐个核对来源的评测方法,看第 2 节的定义,知道「事实粒度的核对」是什么意思,30 分钟。
- [ALCE:让大模型生成带引用的文本](https://arxiv.org/abs/2305.14627):带引用生成的评测框架,重点看「引用召回」和「引用精确」两个指标,对应我们校验器管到和管不到的部分,30 分钟。
- [Python 文档 · re 正则表达式 HOWTO](https://docs.python.org/zh-cn/3.12/howto/regex.html):中文,看「断言」一节,今天的 `(?<![\w.])` 就是后行否定断言,20 分钟。
- [Python 文档 · decimal](https://docs.python.org/zh-cn/3.12/library/decimal.html):`quantize` 和 `normalize` 的行为,中文,15 分钟。
- [Anthropic · Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents):「返回有意义的上下文」一节,证据之所以好抽,是因为 Day 683 的工具返回结构设计得好,10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Uy411i7eQ&autoplay=0&high_quality=1" title="什么是大模型幻觉?为什么会产生幻觉?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI老兵文哲 · 什么是大模型幻觉?为什么会产生幻觉? · 5 分钟,讲幻觉的成因,理解为什么提示词消除不了编造的数字。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1E8pz6vEaB&autoplay=0&high_quality=1" title="RAG为什么有引用也会答错?从检索到评估,讲清原理与工程取舍" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>萌力相变 · RAG为什么有引用也会答错?从检索到评估,讲清原理与工程取舍 · 8 分钟,讲「有引用不等于对」,对应 S017 里引错编号的那条警告。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Lar3K2gN454" title="Chain-of-Verification (COVE) Reduces Hallucination in Large Language Models - Paper Explained" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>DataMListic · Chain-of-Verification (COVE) Reduces Hallucination in Large Language Models - Paper Explained · 讲 CoVe 的四个步骤,和我们「用代码做核查」的方案对比着看。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 4 章评估方法里讲事实一致性(factual consistency)和怎么检查回答是否有依据,对应今天校验器管的那一层。
- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly, 2024):RAG 那几章讲「回答要能追溯到来源」,我们的证据加编号可以看成一种结构化的引用。
- Jeffrey Friedl《Mastering Regular Expressions》(O'Reilly, 第 3 版 2006):正则的经典,想彻底搞懂断言和回溯可以翻,不用通读。

### 开源项目与代码

- [shmsw25/FActScore](https://github.com/shmsw25/FActScore):FActScore 的实现,看它怎么拆原子事实、怎么判断支持与否。
- [princeton-nlp/ALCE](https://github.com/princeton-nlp/ALCE):带引用生成的评测代码,看引用精确度怎么用 NLI 模型判断。
- [explodinggradients/ragas](https://github.com/explodinggradients/ragas):RAG 评测库里的 faithfulness 指标,是我们这条「数字溯源」的通用版本。

## 自测

1. 客户版和内部版的读者分别是谁?各举两条只适用于其中一份的规则。

<details><summary>答案</summary>

客户版给客户(财务、老板):不出现英文代码、证据编号;不承诺退款时间和结果;不写算出来的数。内部版给接单的同事:写清根因类别和算式;每个数字带证据编号以便复核;允许由两条证据加减得到的数,但要记录。两份都要求数字有出处。

</details>

2. 为什么两份解释都让模型带编号写,而不是让客户版不带?

<details><summary>答案</summary>

不带编号就没法核对客户版里的数字。让两份都带编号写、都过校验,最后一步由代码把客户版的编号去掉,客户版里每个数字在去掉之前都核对过。

</details>

3. 校验器为什么不把「15 天」「3 个月」当成金额?这个选择的代价是什么?

<details><summary>答案</summary>

不带单位的整数太常见(天数、月数、行号),都当金额查会误报满天飞,所以只认带货币单位的数和恰好两位小数的数。代价是「多收了 26」这种既没小数又没单位的写法会漏掉,靠写作规则要求金额写两位小数来弥补。

</details>

4. 「1438.44-1412.42 = 26.02」里,为什么朴素的 `-?\d+\.\d{2}` 会出错?`grounding.py` 怎么避开?

<details><summary>答案</summary>

朴素写法把 `-1412.42` 当成负数,算式里的连字符被误当负号。`AMOUNT` 开头加了后行否定断言 `(?<![\w.])`:负号前面不能紧挨字母、数字、下划线或小数点,`4-1` 里的 `-` 前面是 4,就不会被当成负号。同时负号认 `-` 和 `−` 两种。

</details>

5. 同一个「算出来的数」(比如 4.84),为什么客户版打回、内部版放行?

<details><summary>答案</summary>

客户拿去核对账单,账单上没有这个数,只会更困惑;内部同事要的正是算式,两个操作数都带编号,他能一眼核对。所以内部版放行并记录在 `derived` 里,客户版直接判为问题,要求只写证据里现成的数。

</details>

6. 面试题:你的系统要给客户发自动生成的账单解释,法务问「怎么保证 AI 不会说错数字」。你怎么回答?哪些是硬保证,哪些不是?

<details><summary>答案</summary>

先分清能保证到什么程度。硬保证:每个金额和百分比都经过代码校验,必须能在工具返回的数据里找到出处,否则不发;客户版里不允许出现算出来的数、内部代码和退款承诺;所有生成内容和校验记录留档可审计。不是硬保证:数字用在了对的语境(S017 里把 247.20 当 123.60 引用就是例子)、原因描述是否准确、语气是否得体,这些要靠 LLM judge 抽检、人工抽检和评测集持续监控,并给出量化的错误率。上线策略上先当客服的草稿工具,人确认后再发,用一段时间的人工修改率证明质量,再逐步对低风险类别放开自动发送。

</details>

## 明天预告

明天是 Day 689 · BillSleuth(九):写作-校验-重写,校验器管不到的地方。今天的校验器能发现问题,但发现之后怎么办?明天把问题清单原样交回模型重写,最多两次,三稿都不过就用只含已验证数字的模板兜底,再把这一整套接进调查图的 `write_up` 节点。然后看一个今天已经露出苗头的盲区:数字是真的、编号也存在,但用错了地方,校验器放行了,怎么补。
