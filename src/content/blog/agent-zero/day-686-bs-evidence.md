---
title: 'Day 686 · BillSleuth(六):证据链由代码抽取,调查图'
description: '先做一个小实验:让模型看着工具结果给客户写解释,14 个金额里有 5 个在证据里找不到,拆开看是三种来源。据此写出 evidence.py,每次工具调用成功后由代码把金额、日期、税率编号成 E1、E2……;再把 Day 684 定的四段拼成 LangGraph 调查图,编译、画图,用 interrupt_before 让真模型只跑 intake 就停下,当场发现按金额找发票会一次找出四张,改成金额加月份。'
pubDate: 2026-10-23
regime: none
tags: ['billsleuth', 'langgraph', 'evidence', 'agent-design', 'agent-zero']
series: 'agent-zero'
day: 686
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 685](/blog/agent-zero/day-685-week98-review/) 是复习日:默写了 `money.py` 和桥接的 `_run`、`call`,发现把拆包条件写松了一条测试都不会红;做了一个不调模型的体检脚本,二十行规则在 100 个场景上把「哪张发票多收了多少」全找对了。结论是差额匹配这个指标在我们的数据集上没有区分度,Agent 要拿分的地方在根因、解释和不乱冲正。复习日的练习 2 还把两个测试文件里重复的 fixture 挪进了 `tests/conftest.py`,今天的测试直接用它。

[Day 684](/blog/agent-zero/day-684-bs-flow/) 定下了调查流程的四段,写好了模型对象和 MCP 桥接。今天做两件事:先写证据链,让后面写给客户的每个数字都有出处;再把四段拼成一张 LangGraph 图,编译出来,用真模型跑前两段看看。

## 今天要解决的问题

1. 用一个真实的小实验说清楚「为什么证据要由代码抽,不让模型自己记」,并能说出回答里找不到出处的数字有哪三种来源。
2. 写出 `billsleuth/evidence.py`:`extract` 按工具名从结构化结果里抽事实,`number` 编号,`render` 打成清单;用测试证明每条证据的值都原样出现在工具结果里。
3. 写出 `billsleuth/graph.py`:状态里每个字段怎么合并、`Intake` 和 `SubmitFindings` 两个 schema、找候选发票和两道防线这两个纯函数、六个节点和一个路由函数;编译出图并画出来。
4. 用 `interrupt_before` 让图只跑到调查之前,检查 intake 和 locate 的结果,并修掉今天当场发现的一个找发票问题。

预计用时 3 小时。前置:[Day 684](/blog/agent-zero/day-684-bs-flow/)(`llm.py`、`mcp_bridge.py`、拆段)、[Day 685](/blog/agent-zero/day-685-week98-review/) 练习 2(`tests/conftest.py`,没做的话先去做)、[Day 683](/blog/agent-zero/day-683-bs-tools/)(8 个工具的返回结构)、[Day 304](/blog/agent-zero/day-304-lg-reducer/)(reducer 和 `add_messages`)、[Day 306](/blog/agent-zero/day-306-lg-conditional/)(条件边)、[Day 310](/blog/agent-zero/day-310-lg-send-draw/)(画图)、[Day 319](/blog/agent-zero/day-319-lg-interrupt/)(interrupt)、[Day 322](/blog/agent-zero/day-322-lg-time-travel/)(`update_state`)。今天调真模型一共约 ¥0.17,其中 ¥0.14 是练习 3 跑了 100 次 intake,算式在各处。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `CaseState` 的字段和 reducer、`route` 函数、`tools` 节点默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 概念一:证据链由代码抽取

### 先做个实验:模型写的数字从哪来

Day 679 的验收指标里有一项「数字幻觉率」:最终回复里出现证据链找不到出处的金额,这个场景就算一次。为什么要专门盯数字?先看模型在拿到正确工具结果的情况下,写出来的解释里数字都从哪来。

实验很简单:把 S011 的复算结果和订阅时间线原样交给模型,让它给客户写一段解释,要求「每一项多了多少钱,数字要具体」。然后用正则把回答里所有两位小数抓出来,和工具结果里抽出来的值对一遍。这一步要用到下面才写的 `evidence.py`,它的第一版和后面的完整代码只差三行,我先跑了实验才发现要补那三行,所以这里照实验的顺序讲。

```python
# billsleuth/scratch/numbers_without_source.py  让模型看着工具结果给客户写解释,数一数里面有几个数字在工具结果里找不到
import json
import re

from billsleuth import evidence as ev
from billsleuth.llm import estimate_cost, get_llm
from billsleuth.mcp_bridge import BillingMCP

mcp = BillingMCP(in_process=True)
results, chain = [], []
for name, args in [("recompute_invoice", {"invoice_id": "INV-0011-03"}),
                   ("get_subscription_timeline", {"customer_id": "C-0011"})]:
    ok, data = mcp.call(name, args)
    results.append(f"{name} 的结果:{json.dumps(data, ensure_ascii=False)}")
    chain += ev.number(ev.extract(name, args, data), len(chain) + 1)
known = {e["value"] for e in chain}

llm = get_llm(temperature=1.0)
prompt = ("\n".join(results) + "\n\n客户问:8 月这张发票金额 1438.44,我们财务对不上账。"
          "请用三四句话给客户解释哪里多收了、为什么、每一项多了多少钱,数字要具体。")
for i in range(3):
    reply = llm.invoke(prompt)
    text = str(reply.content)
    nums = re.findall(r"\d+\.\d{2}", text)
    orphan = [n for n in nums if n not in known]
    u = reply.usage_metadata or {}
    print(f"--- 第 {i + 1} 次:{len(nums)} 个金额,找不到出处的 {orphan},¥{estimate_cost(u.get('input_tokens', 0), u.get('output_tokens', 0)):.4f}")
    print(text)
```

<div class="line-notes">

- `for name, args in [("recompute_invoice", {"invoice_id": "INV-0011-03"}),` 两次工具调用,和一个查账员查 S011 时最关键的两步一样。
- `results.append(f"{name} 的结果:{json.dumps(data, ensure_ascii=False)}")` 工具结果原样拼进提示词。模型看到的信息是完整的,不存在「它不知道」。
- `chain += ev.number(ev.extract(name, args, data), len(chain) + 1)` 用第一版 `evidence.py` 抽证据并编号。
- `known = {e["value"] for e in chain}` 所有证据的值放进一个集合,下面查「这个数有没有出处」。集合推导式,相当于 `new Set(chain.map(e => e.value))`。
- `llm = get_llm(temperature=1.0)` 温度调高到 1,让三次回答各不相同,看得出模型写数字的习惯,而不是一次的偶然。
- `nums = re.findall(r"\d+\.\d{2}", text)` 抓所有「数字 + 小数点 + 两位数字」,也就是金额。
- `orphan = [n for n in nums if n not in known]` 找不到出处的金额。

</div>

```bash
uv run python -m scratch.numbers_without_source
```

```text
--- 第 1 次:14 个金额,找不到出处的 ['4.84', '82.26', '87.10', '28.71', '516.77'],¥0.0041
您好，这张 8 月发票多收了 26.02 美元，问题出在升级按比例计费的起始时间算错了。我们系统把您 7 月 15 日的升级错误地从 7 月 14 日开始计算，多算了 1 天：旧入门版的退款因此多退了 4.84 美元（应退 -82.26，实际退 -87.10），新商业版的补收也多收了 28.71 美元（应收 488.06，实际收 516.77），两项相抵后比例计费部分净多收 23.87 美元。基于这个偏高的金额，9% 的税又多收了 2.15 美元（应为 116.62，实际 118.77）。加上固定订阅费 890.00 完全正确，合计就是多收的 26.02 美元，正确总额应为 1412.42 美元，我们会为您更正并退回差额。
--- 第 2 次:13 个金额,找不到出处的 ['4.84', '87.10', '82.26', '28.71', '516.77'],¥0.0039
(正文略)
--- 第 3 次:16 个金额,找不到出处的 ['82.26', '87.10', '4.84', '516.77', '28.71'],¥0.0045
(正文略)
```

三次的解释都写得不错,事实也都对:多收 26.02,折算起始日差了一天,税跟着多了 2.15。可每次都有 5 个金额在证据里找不到,而且三次是同样的 5 个。三次一共花了 ¥0.0125。

一个个看它们是从哪来的:

- **87.10 和 516.77**:在工具结果里,`recompute_invoice` 的 `actual_lines` 里就有,是实际发票上的两行折算。我的第一版 `extract` 只抽了应收的行,没抽实收的行。**这是抽取漏了**,改代码就行。
- **82.26**:证据里有,但存的是 `-82.26`(退还行是负数),模型写成了「应退 -82.26」,正则只抓到了数字部分。**这是符号的问题**,校验时要把正负号考虑进去。
- **4.84 和 28.71**:工具结果里根本没有。87.10 − 82.26 = 4.84,516.77 − 488.06 = 28.71,是模型自己算的。这次算对了,但它们没有出处。

最后一类是要害。模型这次算对了,下次呢?更重要的是,**你没法自动知道它算没算对**。客户看到「多退了 4.84 美元」,财务去核,发现工具结果里没有这个数,只能人工重算一遍。在计费场景里,这种「看起来很合理、但找不到出处」的数字,和编出来的数字一样麻烦。

所以 BillSleuth 的做法分两步:今天由代码从工具结果里抽出所有可以引用的事实,编号成证据链;Day 688 写一个校验器,回答里的每个金额都必须能在证据链里找到,找不到就打回去重写。模型想说「多退了 4.84」,要么去调一个能给出这个数的工具,要么别说。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="证据链的位置:工具结果先经过 extract 抽出事实,number 编号成 E1 到 En,存进状态的 evidence;Day 688 的校验器拿最终回答里的数字和证据链逐个比对">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)" rx="6"/>
  <defs><marker id="a686" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="16" y="30" width="150" height="60" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="91" y="54" text-anchor="middle" font-size="12" fill="var(--compute)">工具结果</text>
    <text x="91" y="74" text-anchor="middle" fill="var(--compute)">结构化 JSON</text>
    <line x1="166" y1="60" x2="200" y2="60" stroke="var(--ink-soft)" marker-end="url(#a686)"/>
    <rect x="202" y="30" width="200" height="60" rx="4" fill="none" stroke="var(--ink)"/>
    <text x="302" y="54" text-anchor="middle" font-size="12" fill="var(--ink)">extract → number</text>
    <text x="302" y="74" text-anchor="middle" fill="var(--ink-soft)">纯代码,按工具名抽</text>
    <line x1="402" y1="60" x2="436" y2="60" stroke="var(--ink-soft)" marker-end="url(#a686)"/>
    <rect x="438" y="20" width="186" height="80" rx="4" fill="none" stroke="var(--ink-soft)"/>
    <text x="450" y="40" fill="var(--ink)">state["evidence"]</text>
    <text x="450" y="60" fill="var(--ink-soft)">E8 多收 = 26.02</text>
    <text x="450" y="78" fill="var(--ink-soft)">E15 proration 差额 = 23.87</text>
    <text x="450" y="94" fill="var(--ink-faint)">……</text>
    <rect x="16" y="150" width="250" height="60" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="141" y="174" text-anchor="middle" font-size="12" fill="var(--mem)">模型写的解释</text>
    <text x="141" y="194" text-anchor="middle" fill="var(--mem)">「多收 26.02,其中折算 23.87」</text>
    <line x1="266" y1="180" x2="370" y2="180" stroke="var(--ink-soft)" marker-end="url(#a686)"/>
    <rect x="372" y="150" width="252" height="60" rx="4" fill="none" stroke="var(--ink)" stroke-dasharray="5 3"/>
    <text x="498" y="174" text-anchor="middle" font-size="12" fill="var(--ink)">数字溯源校验(Day 688)</text>
    <text x="498" y="194" text-anchor="middle" fill="var(--ink-soft)">每个金额都要找到 E 编号</text>
    <line x1="530" y1="100" x2="530" y2="148" stroke="var(--ink-soft)" marker-end="url(#a686)"/>
    <text x="16" y="240" fill="var(--ink-faint)">今天写上面一行;虚线框是 Day 688 的事</text>
  </g>
</svg>
<figcaption>证据链夹在工具结果和最终回答之间。抽取完全由代码做,值是工具返回的原字符串,一个字符都不会变。</figcaption>
</figure>

### evidence.py

先写第一版,也就是上面实验用的那一版。新建 `billsleuth/evidence.py`:

```python
# billsleuth/billsleuth/evidence.py  证据链:每次工具调用成功后,由代码从结构化结果里抽出可引用的事实,编号存进状态
"""为什么由代码抽、不让模型自己记:模型抄数字会抄错,代码不会。
Day 688 写解释时,回答里的每个金额都必须能在这里找到出处。"""
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
    """从一次成功的工具结果里抽证据(还没编号)。认识的工具才抽,不认识的返回空列表。"""
    out: list[dict] = []
    if tool == "get_customer":
        out.append(_ev("客户税务地区", tool, data["id"], data["tax_region"]))
        out.append(_ev("客户时区", tool, data["id"], data["timezone"]))
    elif tool == "list_invoices":
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
    return out


def number(evs: list[dict], start: int) -> list[dict]:
    """给还没编号的证据按顺序编号,从 E{start} 开始。"""
    return [{"id": f"E{start + i}", **e} for i, e in enumerate(evs)]


def render(evs: list[dict], limit: int = 400) -> str:
    """给人(和后面写解释的模型)看的证据清单,一行一条。"""
    return "\n".join(f"[{e['id']}] {e['claim']} = {e['value']}  ({e['source_tool']} {e['source_ref']})"
                     for e in evs[-limit:])
```

<div class="line-notes">

- `class Evidence(TypedDict):` 一条证据长什么样。[Day 47](/blog/agent-zero/day-047-type-hints-3/) 学过 TypedDict,相当于 TS 的 `type Evidence = {...}`,运行时就是普通字典。这个类型主要是写给人看的说明,下面的函数为了简单都用 `dict`。
- `claim: str         # 这条事实说的是什么` 一句人话,比如「INV-0011-03 多收(实际 - 应收)」。Day 688 写内部版解释时会引用它。
- `source_ref: str    # 哪张发票 / 哪笔扣款 / 哪个事件` 出处精确到对象。发票行用 `INV-0011-03#L2` 这种写法,第 2 行。
- `value: str         # 金额、日期、税率等,一律字符串` 和工具层的约定一样,金额不变成数字。
- `def _ev(claim: str, tool: str, ref: str, value: Any) -> dict:` 造一条证据的小工具。`str(value)` 把整数席位数 `10` 也变成字符串 `"10"`,所有值类型统一。
- `def extract(tool: str, args: dict, data: Any) -> list[dict]:` 按工具名分支,每个工具抽哪些字段是手写的。不写一个「递归遍历 JSON、见数字就抽」的通用版,是因为那样抽出来的证据没有 `claim`,没人知道 `"890.00"` 说的是什么。
- `out.append(_ev("客户税务地区", tool, data["id"], data["tax_region"]))` 不是金额也抽:税务地区、时区、日期,解释里都可能引用。
- `out.append(_ev(f"{inv['id']} 总额({inv['period_start']} 至 {inv['period_end']})", tool, inv["id"], inv["total"]))` 发票列表只抽每张的总额,周期写进 claim。
- `for k in ("subtotal", "discount", "tax", "total"):` 一张发票的四个汇总数各一条。
- `for n, ln in enumerate(data["lines"], start=1):` `enumerate` 同时给出序号和元素,`start=1` 让序号从 1 开始,相当于 JS 的 `lines.forEach((ln, i) => { const n = i + 1; ... })`。
- `if ln["kind"] == "recurring":` 订阅费行多抽一个单价。「每席位 89.00」这种话在解释里很常见。
- `out.append(_ev(f"扣款 {p['id']}({p['status']},{p['attempted_at']})", tool, p["invoice_id"], p["amount"]))` 每笔扣款一条,状态和时间写进 claim。重复扣款的场景,两笔 123.60 会是两条证据。
- `out.append(_ev(f"{ref} 按规则应收", tool, ref, data["expected_total"]))` 复算结果是证据最多的来源:应收、实收、差额、扣款合计四个总数。
- `for d in data["by_kind"]:` 每一类的应收、实收、差额各一条。S011 的 23.87 和 2.15 就是从这里来的。
- `for n, ln in enumerate(data["expected_lines"], start=1):` 应收的每一行。第一版只抽了这个,**没抽 `actual_lines`**,实验里 87.10 和 516.77 就是这么漏的。
- `out.append(_ev(f"{e['region']} 在 {args.get('on')} 有效税率 {e['code']}", tool, e["code"], e["rate"]))` 这里用到了 `args`:查的是哪一天的税率,在调用参数里,不在结果里。这也是 `extract` 要收 `args` 的原因。
- `out.append(_ev(f"税率 {h['code']} 有效期 {h['valid_from']} 至 {h['valid_to'] or '今'}", tool, h["code"], h["rate"]))` 税率历史每条一条证据。`valid_to` 是 None 时写「今」。
- `out.append(_ev(f"事件 {e['type']} 本地日期", tool, e["id"], e["effective_local_date"]))` 事件只抽本地日期,不抽 UTC 时间。计费规则按本地日期算,给客户解释时也该说本地日期。
- `for k, v in e["payload"].items():` 事件内容(套餐、席位数)每个字段一条。`.items()` 同时取键和值,相当于 `Object.entries`。
- `if data.get("coupon"):` 有券才抽,`get` 取不到返回 None 不报错。
- `return out` 不认识的工具(比如 `draft_credit_note`)走不进任何分支,返回空列表。
- `def number(evs: list[dict], start: int) -> list[dict]:` 编号单独一个函数,因为编号要接着状态里已有的证据往下编,只有调用方知道从几开始。
- `return [{"id": f"E{start + i}", **e} for i, e in enumerate(evs)]` `{"id": ..., **e}` 新建一个字典,先放 id 再展开原来的字段,相当于 JS 的 `{ id: ..., ...e }`。原来的字典没被改。
- `def render(evs: list[dict], limit: int = 400) -> str:` 打成一行一条的清单。`evs[-limit:]` 只取最后 400 条,防止证据太多撑爆上下文,负数下标从末尾数,[Day 15](/blog/agent-zero/day-015-strings-1/) 讲过切片。

</div>

拿 S011 的几次真实工具调用试一下,最后一次故意用一个不存在的发票号:

```python
# billsleuth/scratch/try_evidence.py  拿 S011 的四次真实工具结果抽证据,看编号和清单长什么样
from billsleuth import evidence as ev
from billsleuth.mcp_bridge import BillingMCP

mcp = BillingMCP(in_process=True)
calls = [("list_invoices", {"customer_id": "C-0011", "limit": 6}),
         ("recompute_invoice", {"invoice_id": "INV-0011-03"}),
         ("get_subscription_timeline", {"customer_id": "C-0011"}),
         ("get_invoice", {"invoice_id": "INV-0011-09"})]
chain: list[dict] = []
for name, args in calls:
    ok, data = mcp.call(name, args)
    found = ev.extract(name, args, data) if ok else []
    chain += ev.number(found, len(chain) + 1)
    print(f"{name}: 成功={ok},抽出 {len(found)} 条")
print(ev.render(chain))
```

<div class="line-notes">

- `("get_invoice", {"invoice_id": "INV-0011-09"})]` 不存在的发票,工具会报错。
- `found = ev.extract(name, args, data) if ok else []` 失败的调用不抽证据。报错文字不是事实,不能被引用。
- `chain += ev.number(found, len(chain) + 1)` 接着已有的编号往下编。`+=` 对列表是原地追加,相当于 `chain.push(...arr)`。

</div>

```bash
uv run python -m scratch.try_evidence
```

```text
list_invoices: 成功=True,抽出 5 条
recompute_invoice: 成功=True,抽出 17 条
get_subscription_timeline: 成功=True,抽出 5 条
get_invoice: 成功=False,抽出 0 条
[E1] INV-0011-05 总额(2026-10-01 至 2026-11-01) = 970.10  (list_invoices INV-0011-05)
[E2] INV-0011-04 总额(2026-09-01 至 2026-10-01) = 970.10  (list_invoices INV-0011-04)
[E3] INV-0011-03 总额(2026-08-01 至 2026-09-01) = 1438.44  (list_invoices INV-0011-03)
[E4] INV-0011-02 总额(2026-07-01 至 2026-08-01) = 163.50  (list_invoices INV-0011-02)
[E5] INV-0011-01 总额(2026-06-01 至 2026-07-01) = 163.50  (list_invoices INV-0011-01)
[E6] INV-0011-03 按规则应收 = 1412.42  (recompute_invoice INV-0011-03)
[E7] INV-0011-03 实际开票金额 = 1438.44  (recompute_invoice INV-0011-03)
[E8] INV-0011-03 多收(实际 - 应收) = 26.02  (recompute_invoice INV-0011-03)
[E9] INV-0011-03 实际扣款合计(1 笔) = 1438.44  (recompute_invoice INV-0011-03)
[E10] INV-0011-03 recurring 应收 = 890.00  (recompute_invoice INV-0011-03)
[E11] INV-0011-03 recurring 实收 = 890.00  (recompute_invoice INV-0011-03)
[E12] INV-0011-03 recurring 差额 = 0.00  (recompute_invoice INV-0011-03)
[E13] INV-0011-03 proration 应收 = 405.80  (recompute_invoice INV-0011-03)
[E14] INV-0011-03 proration 实收 = 429.67  (recompute_invoice INV-0011-03)
[E15] INV-0011-03 proration 差额 = 23.87  (recompute_invoice INV-0011-03)
[E16] INV-0011-03 tax 应收 = 116.62  (recompute_invoice INV-0011-03)
[E17] INV-0011-03 tax 实收 = 118.77  (recompute_invoice INV-0011-03)
[E18] INV-0011-03 tax 差额 = 2.15  (recompute_invoice INV-0011-03)
[E19] INV-0011-03 应收第 1 行:未使用时间退还:入门版 × 10(2026-07-15 至 2026-08-01) = -82.26  (recompute_invoice INV-0011-03)
[E20] INV-0011-03 应收第 2 行:剩余时间:商业版 × 10(2026-07-15 至 2026-08-01) = 488.06  (recompute_invoice INV-0011-03)
[E21] INV-0011-03 应收第 3 行:商业版 × 10 席位 = 890.00  (recompute_invoice INV-0011-03)
[E22] INV-0011-03 应收第 4 行:税 SG-GST9(9%) = 116.62  (recompute_invoice INV-0011-03)
[E23] 事件 create 本地日期 = 2026-06-01  (get_subscription_timeline EV-0011-1)
[E24] 事件 create 的 plan_id = starter  (get_subscription_timeline EV-0011-1)
[E25] 事件 create 的 quantity = 10  (get_subscription_timeline EV-0011-1)
[E26] 事件 upgrade 本地日期 = 2026-07-15  (get_subscription_timeline EV-0011-2)
[E27] 事件 upgrade 的 plan_id = business  (get_subscription_timeline EV-0011-2)
```

四次调用,27 条证据,编号连续,失败的那次一条都没抽。E8 就是那个 26.02,E15 和 E18 是它拆成的 23.87 和 2.15,E26 是升级的本地日期 7 月 15 日。

### 补上实收行,再对一遍

按实验的发现,在 `recompute_invoice` 分支里、应收行的循环后面加两行,把实际发票的每一行也抽出来:

```python
        for n, ln in enumerate(data["actual_lines"], start=1):
            out.append(_ev(f"{ref} 实收第 {n} 行:{ln['description']}", tool, ref, ln["amount"]))
```

<div class="line-notes">

- `for n, ln in enumerate(data["actual_lines"], start=1):` 实际发票的行。给客户解释「我们多收在哪一行」时,要引用的正是这些。
- `out.append(_ev(f"{ref} 实收第 {n} 行:{ln['description']}", tool, ref, ln["amount"]))` 描述里带着日期区间,S011 实收折算行写的是「2026-07-14 至 2026-08-01」,和应收行的 15 日一对比,差一天就摆在证据里了。

</div>

然后拿第 1 次的回答(我存成了 `scratch/s011_reply.txt`)离线再对一遍,不用再花钱调模型。这次比对时把正负号去掉,看每个数对上了哪条证据:

```python
# billsleuth/scratch/orphans_again.py  补上实收行以后,把第 1 次的回答再对一遍证据(不调模型)
import re

from billsleuth import evidence as ev
from billsleuth.mcp_bridge import BillingMCP

mcp = BillingMCP(in_process=True)
chain: list[dict] = []
for name, args in [("recompute_invoice", {"invoice_id": "INV-0011-03"}),
                   ("get_subscription_timeline", {"customer_id": "C-0011"})]:
    ok, data = mcp.call(name, args)
    chain += ev.number(ev.extract(name, args, data), len(chain) + 1)
known = {e["value"].lstrip("-") for e in chain}

text = open("scratch/s011_reply.txt", encoding="utf-8").read()
for n in re.findall(r"\d+\.\d{2}", text):
    hit = [e["id"] for e in chain if e["value"].lstrip("-") == n]
    print(f"{n:>8}  {'→ ' + ', '.join(hit) if hit else '找不到出处'}")
print(f"证据一共 {len(chain)} 条,不同的值 {len(known)} 个")
```

<div class="line-notes">

- `known = {e["value"].lstrip("-") for e in chain}` `lstrip("-")` 去掉开头的负号,`-82.26` 变 `82.26`。这只是今天的粗处理:去掉符号以后,「退还 82.26」和「收取 82.26」就分不清了,Day 688 的校验器要做得更细。
- `text = open("scratch/s011_reply.txt", encoding="utf-8").read()` 第 1 次实验回答的原文。
- `hit = [e["id"] for e in chain if e["value"].lstrip("-") == n]` 一个数可能对上好几条证据,全列出来。
- `print(f"{n:>8}  {'→ ' + ', '.join(hit) if hit else '找不到出处'}")` `:>8` 右对齐占 8 位。

</div>

```bash
uv run python -m scratch.orphans_again
```

```text
   26.02  → E3
    4.84  找不到出处
   82.26  → E14
   87.10  → E18
   28.71  找不到出处
  488.06  → E15
  516.77  → E19
   23.87  → E10
    2.15  → E13
  116.62  → E11, E17
  118.77  → E12, E21
  890.00  → E5, E6, E16, E20
   26.02  → E3
 1412.42  → E1
证据一共 26 条,不同的值 20 个
```

(这里只调了两个工具,所以编号和上面 `try_evidence.py` 的不一样。)补上实收行、处理了符号以后,只剩 4.84 和 28.71 两个找不到出处,正是模型自己做的两次减法。这两个数 Day 688 的校验器会拦下来。

还有一个现象值得留意:890.00 对上了四条证据,116.62 对上了两条。同一个数在好几个地方出现很正常,校验器只要找到一条就算有出处;但如果以后要求「解释里引用证据编号」,就得决定引用哪一条更合适。

### 用测试钉住「代码不会抄错」

证据的意义全在「值是原样搬过来的」。写一个测试,对每个工具真调一次,检查抽出来的每条证据的值都原样出现在结果的 JSON 里。新建 `tests/test_evidence.py`,fixture 用 Day 685 练习 2 挪进 `conftest.py` 的 `fresh_db`:

```python
# billsleuth/tests/test_evidence.py  证据抽取:每条证据的值都原样出现在工具结果里,编号连续,不认识的工具不抽
import json

import pytest

from billsleuth import evidence as ev
from billsleuth.mcp_bridge import BillingMCP

CALLS = [
    ("get_customer", {"customer_id": "C-0011"}),
    ("list_invoices", {"customer_id": "C-0011"}),
    ("get_invoice", {"invoice_id": "INV-0011-03"}),
    ("list_payments", {"customer_id": "C-0017", "invoice_id": "INV-0017-05"}),
    ("recompute_invoice", {"invoice_id": "INV-0011-03"}),
    ("get_tax_rate", {"region": "US", "on": "2026-09-14"}),
    ("get_subscription_timeline", {"customer_id": "C-0020"}),
]


@pytest.fixture(autouse=True)
def _use_fresh_db(fresh_db):
    """本文件每条测试都用一份干净的库(fixture 定义在 conftest.py)。"""


@pytest.fixture
def mcp():
    return BillingMCP(in_process=True)


@pytest.mark.parametrize("name,args", CALLS, ids=[c[0] for c in CALLS])
def test_every_value_is_copied_verbatim(mcp, name, args):
    ok, data = mcp.call(name, args)
    assert ok
    found = ev.extract(name, args, data)
    assert found, f"{name} 一条证据都没抽出来"
    raw = json.dumps(data, ensure_ascii=False)
    for e in found:
        assert f'"{e["value"]}"' in raw or f": {e['value']}" in raw, e  # 字符串值带引号,整数不带


def test_numbering_is_continuous(mcp):
    chain: list[dict] = []
    for name, args in CALLS:
        ok, data = mcp.call(name, args)
        chain += ev.number(ev.extract(name, args, data), len(chain) + 1)
    assert [e["id"] for e in chain] == [f"E{i}" for i in range(1, len(chain) + 1)]


def test_unknown_or_write_tool_gives_nothing():
    assert ev.extract("draft_credit_note", {}, {"credit_note_id": "CN-0001", "amount": "26.02"}) == []


def test_recompute_has_both_sides_of_every_line(mcp):
    ok, data = mcp.call("recompute_invoice", {"invoice_id": "INV-0011-03"})
    claims = [e["claim"] for e in ev.extract("recompute_invoice", {}, data)]
    assert sum("应收第" in c for c in claims) == len(data["expected_lines"])
    assert sum("实收第" in c for c in claims) == len(data["actual_lines"])


def test_render_one_line_per_evidence():
    evs = ev.number([ev._ev("INV-0011-03 多收(实际 - 应收)", "recompute_invoice", "INV-0011-03", "26.02")], 8)
    assert ev.render(evs) == "[E8] INV-0011-03 多收(实际 - 应收) = 26.02  (recompute_invoice INV-0011-03)"
```

<div class="line-notes">

- `CALLS = [` 7 个只读工具各一次。客户挑得有讲究:C-0017 有重复扣款(两笔扣款),C-0020 带优惠券(时间线里会抽券),US 的税率有历史记录。
- `def _use_fresh_db(fresh_db):` 和 Day 685 练习 2 一样的「本文件自动用干净库」开关。没做那道练习的话,这里会报 `fixture 'fresh_db' not found`。
- `@pytest.mark.parametrize("name,args", CALLS, ids=[c[0] for c in CALLS])` 一个工具一条测试,`ids` 让测试名显示工具名,哪个红一眼就知道。
- `assert found, f"{name} 一条证据都没抽出来"` 防止某个分支的工具名写错,悄悄什么都不抽。
- `raw = json.dumps(data, ensure_ascii=False)` 工具结果原样转成 JSON 文本。
- `assert f'"{e["value"]}"' in raw or f": {e['value']}" in raw, e  # 字符串值带引号,整数不带` 证据的值必须一字不差地出现在原文里。字符串在 JSON 里带引号(`"26.02"`),整数(席位数 `10`)不带,两种都认。断言失败时打印那条证据。
- `assert [e["id"] for e in chain] == [f"E{i}" for i in range(1, len(chain) + 1)]` 7 次调用下来,编号从 E1 连到最后,一个不跳。
- `assert ev.extract("draft_credit_note", {}, {"credit_note_id": "CN-0001", "amount": "26.02"}) == []` 写工具的结果不是「事实」,不进证据链。
- `assert sum("应收第" in c for c in claims) == len(data["expected_lines"])` 应收几行就抽几条。布尔值求和就是数 True 的个数。
- `assert sum("实收第" in c for c in claims) == len(data["actual_lines"])` 今天补的那两行守在这里,以后有人删掉,这条会红。
- `evs = ev.number([ev._ev("INV-0011-03 多收(实际 - 应收)", "recompute_invoice", "INV-0011-03", "26.02")], 8)` 从 E8 开始编号,看 `render` 的格式。

</div>

```bash
uv run pytest tests/test_evidence.py -v
```

```text
tests/test_evidence.py::test_every_value_is_copied_verbatim[get_customer] PASSED [  9%]
tests/test_evidence.py::test_every_value_is_copied_verbatim[list_invoices] PASSED [ 18%]
tests/test_evidence.py::test_every_value_is_copied_verbatim[get_invoice] PASSED [ 27%]
tests/test_evidence.py::test_every_value_is_copied_verbatim[list_payments] PASSED [ 36%]
tests/test_evidence.py::test_every_value_is_copied_verbatim[recompute_invoice] PASSED [ 45%]
tests/test_evidence.py::test_every_value_is_copied_verbatim[get_tax_rate] PASSED [ 54%]
tests/test_evidence.py::test_every_value_is_copied_verbatim[get_subscription_timeline] PASSED [ 63%]
tests/test_evidence.py::test_numbering_is_continuous PASSED              [ 72%]
tests/test_evidence.py::test_unknown_or_write_tool_gives_nothing PASSED  [ 81%]
tests/test_evidence.py::test_recompute_has_both_sides_of_every_line PASSED [ 90%]
tests/test_evidence.py::test_render_one_line_per_evidence PASSED         [100%]

============================== 11 passed in 2.62s ==============================
```

11 条全绿。

## 概念二:调查图

证据有了,现在把 Day 684 的四段拼成一张图。LangGraph 的每个零件第五部分都学过,今天没有新 API,难点在**状态怎么设计**:每个节点只返回自己改了的字段,LangGraph 按字段的 reducer 把它们合并进状态。字段合并方式选错,就是 [Day 303](/blog/agent-zero/day-303-lg-overwrite/) 那种「后一个节点把前一个的结果覆盖掉」。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="CaseState 的字段按合并方式分三组:覆盖的有 intake、candidates、known_invoices、nudged、findings、escalated、llm_calls;追加的有 evidence 用 operator.add,messages 用 add_messages;按位相加的有 tokens">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
  <g font-family="var(--font-mono)" font-size="11">
    <text x="20" y="28" font-size="12" fill="var(--ink)">CaseState:每个字段怎么合并</text>
    <rect x="20" y="44" width="190" height="200" rx="4" fill="none" stroke="var(--ink-soft)"/>
    <text x="34" y="66" font-size="12" fill="var(--ink)">覆盖(默认)</text>
    <text x="34" y="92" fill="var(--ink-soft)">intake</text>
    <text x="34" y="112" fill="var(--ink-soft)">candidates</text>
    <text x="34" y="132" fill="var(--ink-soft)">known_invoices</text>
    <text x="34" y="152" fill="var(--ink-soft)">llm_calls</text>
    <text x="34" y="172" fill="var(--ink-soft)">nudged</text>
    <text x="34" y="192" fill="var(--ink-soft)">findings / escalated</text>
    <text x="34" y="226" fill="var(--ink-faint)">新值直接替换旧值</text>
    <rect x="226" y="44" width="200" height="200" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="240" y="66" font-size="12" fill="var(--compute)">追加</text>
    <text x="240" y="92" fill="var(--compute)">messages</text>
    <text x="240" y="110" fill="var(--compute)">  add_messages</text>
    <text x="240" y="140" fill="var(--compute)">evidence</text>
    <text x="240" y="158" fill="var(--compute)">  operator.add</text>
    <text x="240" y="226" fill="var(--compute)">新列表接在旧列表后面</text>
    <rect x="442" y="44" width="180" height="200" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="456" y="66" font-size="12" fill="var(--mem)">按位相加</text>
    <text x="456" y="92" fill="var(--mem)">tokens</text>
    <text x="456" y="110" fill="var(--mem)">  add_tokens</text>
    <text x="456" y="140" fill="var(--mem)">[输入, 输出]</text>
    <text x="456" y="158" fill="var(--mem)">[100,20]+[300,40]</text>
    <text x="456" y="176" fill="var(--mem)">= [400,60]</text>
    <text x="456" y="226" fill="var(--mem)">每轮用量累计</text>
    <text x="20" y="276" fill="var(--ink-faint)">输入只有 customer_id 和 question(CaseInput),其余字段由节点逐步填上</text>
  </g>
</svg>
<figcaption>三种合并方式。llm_calls 是覆盖:investigate 节点自己读旧值加一再写回去,所以不需要 reducer。</figcaption>
</figure>

### graph.py

文件比较长,分三段讲。第一段是 schema 和状态:

```python
# billsleuth/billsleuth/graph.py  调查流程:intake → locate → investigate ⇄ tools → conclude,对外只暴露 build_graph()
import operator
from typing import Annotated, Any, Literal, TypedDict

from langchain_core.messages import AIMessage, AnyMessage, HumanMessage, SystemMessage, ToolCall, ToolMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from pydantic import BaseModel, Field

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


def add_tokens(a: list[int] | None, b: list[int]) -> list[int]:
    """[输入, 输出] 两个数按位相加。"""
    return [x + y for x, y in zip(a or [0, 0], b)]


class CaseState(CaseInput, total=False):
    intake: dict
    candidates: list[str]
    known_invoices: list[str]
    messages: Annotated[list[AnyMessage], add_messages]
    evidence: Annotated[list[dict], operator.add]
    llm_calls: int
    tokens: Annotated[list[int], add_tokens]
    nudged: bool
    findings: dict
    escalated: bool
```

<div class="line-notes">

- `import operator` 标准库,`operator.add` 就是函数版的 `+`,两个列表相加就是拼接。[Day 304](/blog/agent-zero/day-304-lg-reducer/) 用它当过 reducer。
- `from langgraph.graph.message import add_messages` 消息专用的 reducer:新消息追加,id 相同的替换。
- `from billsleuth.faults import ROOT_CAUSES` Day 682 的 13 个根因字典,结论只能从这里面选。
- `MAX_LLM_CALLS = 12` 一次调查最多调 12 次模型(含 intake),到了就强制结束。
- `READ_TOOLS = {"get_customer", "list_invoices", "get_invoice", "list_payments",` 调查阶段能用的 7 个只读工具。`draft_credit_note` 不在里面,起草贷记单是 Day 690 审批流程的事。
- `INVOICE_TOOLS = {"get_invoice", "recompute_invoice"}` 参数里有发票号的两个工具,要过「发票号必须来自列表」那道检查。
- `RootCause = Literal[tuple(ROOT_CAUSES)]  # type: ignore[valid-type]` 把字典的 13 个键变成一个 `Literal` 类型,pydantic 据此生成 `enum`,模型只能选这 13 个值。`Literal[...]` 里本该直接写字面量,这里在运行时动态生成,类型检查器看不懂,所以压掉警告。好处是根因只在 `faults.py` 定义一次。
- `class Intake(BaseModel):` intake 节点的结构化输出。docstring 会变成给模型看的工具描述。
- `complaint: Literal["金额不对", "重复扣款", "取消后仍扣款", "看不懂账单", "其他"]` 五种抱怨,用中文值,模型更不容易选错。
- `amount: str | None = Field(default=None, description="客户提到的金额,两位小数字符串,如 '362.52';没提到填 null")` 金额也是字符串,下面找发票时和 `list_invoices` 返回的 `total` 直接比较字符串。
- `month: int | None = Field(default=None, ge=1, le=12, description="客户提到的月份;没提到填 null")` 月份限定 1 到 12。
- `class SubmitFindings(BaseModel):` 调查的「交卷」格式。它会和 7 个 MCP 工具一起绑给模型,模型调用它就是交卷,这种只为了让模型交出结构化结果的工具叫伪工具。
- `overcharge: str = Field(pattern=r"^\d+\.\d{2}$", description="客户多付的金额(含税),直接用工具返回的数;没多付填 0.00")` 正则限定两位小数,`"26.0"` 会被拒绝。描述里叮嘱「直接用工具返回的数」。
- `expected_action: Literal["credit_note", "explain_only"] = Field(description="多收了就 credit_note,否则 explain_only")` 要不要冲正。Day 679 的误冲正率就是看这个字段。
- `reasoning: str = Field(description="内部说明:查了什么、哪个数和哪个数对不上、算式。只用工具返回过的数字")` 给同事看的说明,Day 688 写内部版解释时会用到。
- `class CaseInput(TypedDict):` 图的输入只有两个字段。下面 `StateGraph(..., input_schema=CaseInput)` 会用它。
- `def add_tokens(a: list[int] | None, b: list[int]) -> list[int]:` 自定义 reducer:两个 `[输入, 输出]` 按位相加。第一次合并时旧值还不存在,`a` 是 None,用 `[0, 0]` 兜底。旧课这里写的是一个 lambda,拆成具名函数好读也好测。
- `return [x + y for x, y in zip(a or [0, 0], b)]` `zip` 把两个列表按位置配对,`[100, 20]` 和 `[300, 40]` 配成 `(100, 300)`、`(20, 40)`。
- `class CaseState(CaseInput, total=False):` 完整状态继承输入的两个字段。`total=False` 表示下面这些字段都可以没有,一开始状态里只有输入的两个。
- `messages: Annotated[list[AnyMessage], add_messages]` `Annotated[类型, reducer]` 是 LangGraph 标记 reducer 的写法。
- `evidence: Annotated[list[dict], operator.add]` 证据只追加,不覆盖。练习 2 会把这个 reducer 去掉,看会发生什么。
- `llm_calls: int` 没有 reducer,覆盖。
- `tokens: Annotated[list[int], add_tokens]` 用上面的自定义 reducer,每一轮 investigate 只返回这一轮的用量,累计交给 reducer。
- `nudged: bool` 有没有催过一次交卷。

</div>

第二段是两个不调模型的纯函数和系统提示词。我把它们从节点里拎出来放在模块顶层,是 Day 684 拆段的第三条理由:**能单独测**。

```python
def pick_candidates(invs: list[dict], amount: str | None, month: int | None) -> list[str]:
    """不用模型:先按金额精确匹配,再按开票月份,都没有就取最新一张。"""
    cands = [i["id"] for i in invs if amount and i["total"] == amount]
    if not cands and month:
        cands = [i["id"] for i in invs if int(i["issued_at"][5:7]) == month]
    return cands or [invs[0]["id"]]


def check_call(name: str, args: dict, customer_id: str, known: list[str]) -> str | None:
    """编排层的两道防线。返回拒绝理由,放行返回 None。"""
    if name not in READ_TOOLS:
        return f"不能调用 {name}"
    if "customer_id" in args and args["customer_id"] != customer_id:
        return f"只能查询客户 {customer_id} 的数据"
    if name in INVOICE_TOOLS and args.get("invoice_id") not in known:
        return f"发票 {args.get('invoice_id')} 不在这个客户的发票列表里,发票号必须来自 list_invoices"
    return None


def system_prompt(customer_id: str) -> str:
    causes = "\n".join(f"- {k}:{v}" for k, v in ROOT_CAUSES.items())
    return f"""你是云簿 CloudLedger 的计费调查员,处理客户 {customer_id} 的账单争议。你只负责查清事实,不直接回复客户。

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
```

<div class="line-notes">

- `def pick_candidates(invs: list[dict], amount: str | None, month: int | None) -> list[str]:` locate 的核心,纯函数:给发票列表和 intake 的两个字段,返回候选发票号。这是第一版,下面跑起来会发现它的问题。
- `cands = [i["id"] for i in invs if amount and i["total"] == amount]` 金额精确匹配。`amount and ...` 先确认客户提了金额,没提就是 None,整个条件为假。
- `cands = [i["id"] for i in invs if int(i["issued_at"][5:7]) == month]` 按开票月份。`"2026-09-14"[5:7]` 是 `"09"`,`int` 变成 9。
- `return cands or [invs[0]["id"]]` 都没找到就给最新一张(列表是最新在前)。`or` 在左边是空列表时取右边,相当于 JS 的 `cands.length ? cands : [...]`。
- `def check_call(name: str, args: dict, customer_id: str, known: list[str]) -> str | None:` 每次工具调用前的检查,返回拒绝理由,放行返回 None。也是纯函数。
- `if name not in READ_TOOLS:` 不在白名单的工具一律拒绝,包括 `draft_credit_note` 和模型编出来的工具名。
- `if "customer_id" in args and args["customer_id"] != customer_id:` 第一道防线:只能查本次调查的客户。MCP 工具本身不知道「这次调查是谁」,只有编排层知道。
- `if name in INVOICE_TOOLS and args.get("invoice_id") not in known:` 第二道防线:发票号必须出现在 locate 拿到的发票列表里。防模型编发票号,也防它查别的客户的发票(`get_invoice` 只要发票号,不带客户号)。
- `def system_prompt(customer_id: str) -> str:` 只收客户号。旧课收整个 state,只用了这一个字段,收得少一点更好测。
- `"""你是云簿 CloudLedger 的计费调查员,处理客户 {customer_id} 的账单争议。你只负责查清事实,不直接回复客户。` 第一句定角色和边界:只查不答。回复客户是 Day 688 的另一个步骤。
- `- 判断某张发票算没算错,唯一依据是 recompute_invoice,不要自己心算金额。` 今天开头的实验说明了心算的数为什么麻烦。
- `- 金额有差异时,看 by_kind 差在哪一类,再顺着查:` 写的是**查账的方法**,不是「proration 差就是时区问题」这种答案。同样是折算差,可能是分母错、时区错、漏退还行,要模型自己顺着线查。
- `根因类别:` 13 个根因和中文说明,从 `ROOT_CAUSES` 生成,和 `SubmitFindings` 的取值永远一致。

</div>

第三段是 `build_graph`,六个节点、一个路由函数和连线:

```python
def build_graph(llm: Any = None, mcp: BillingMCP | None = None, checkpointer: Any = None, interrupt_before: Any = None):
    llm = llm or get_llm()
    mcp = mcp or BillingMCP()
    intake_llm = llm.with_structured_output(Intake, method="function_calling")

    def intake(state: CaseState) -> dict:
        r = Intake.model_validate(intake_llm.invoke(f"客户原话:{state['question']}"))
        return {"intake": r.model_dump(), "llm_calls": 1}

    def locate(state: CaseState) -> dict:
        cid = state["customer_id"]
        ok, invs = mcp.call("list_invoices", {"customer_id": cid, "limit": 24})
        if not ok:
            return {"candidates": [], "known_invoices": [], "messages": [HumanMessage(f"查不到发票:{invs}")]}
        info = state.get("intake", {})
        cands = pick_candidates(invs, info.get("amount"), info.get("month"))
        brief = (f"客户原话:{state['question']}\n"
                 f"初步理解:{info}\n"
                 f"这个客户的发票(最新在前):\n" + "\n".join(
                     f"- {i['id']} 周期 {i['period_start']} 至 {i['period_end']} 总额 {i['total']} {i['currency']}" for i in invs)
                 + f"\n候选发票:{', '.join(cands)}。开始调查。")
        return {"candidates": cands, "known_invoices": [i["id"] for i in invs],
                "evidence": ev.number(ev.extract("list_invoices", {}, invs), 1), "messages": [HumanMessage(brief)]}

    specs = [s for s in mcp.tool_specs() if s["function"]["name"] in READ_TOOLS]
    investigator = llm.bind_tools(specs + [SubmitFindings])

    def investigate(state: CaseState) -> dict:
        reply = investigator.invoke([SystemMessage(system_prompt(state["customer_id"]))] + state.get("messages", []))
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

    def tools(state: CaseState) -> dict:
        msgs, new_ev = [], []
        for c in last_calls(state):
            args = c.get("args") or {}
            why = check_call(c["name"], args, state["customer_id"], state.get("known_invoices", []))
            ok, data = (False, why) if why else mcp.call(c["name"], args)
            msgs.append(ToolMessage(content=to_text(ok, data), tool_call_id=c["id"]))
            if ok:
                new_ev += ev.extract(c["name"], args, data)
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

    g = StateGraph(CaseState, input_schema=CaseInput)
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
    return g.compile(checkpointer=checkpointer, interrupt_before=interrupt_before)
```

<div class="line-notes">

- `def build_graph(llm: Any = None, mcp: BillingMCP | None = None, checkpointer: Any = None, interrupt_before: Any = None):` 模型、桥接、checkpointer 都能从外面传进来,这就是依赖注入:测试时传假模型和内存桥,上线时用默认值。`interrupt_before` 是今天为了「跑一半停下来看」加的。
- `mcp = mcp or BillingMCP()` 默认 stdio 连接,部署形态。测试和评测要显式传 `BillingMCP(in_process=True)`。
- `intake_llm = llm.with_structured_output(Intake, method="function_calling")` 在建图时就准备好,每个案子复用。Day 684 实测过,这一行要求 `.env` 里关掉思考。
- `r = Intake.model_validate(intake_llm.invoke(f"客户原话:{state['question']}"))` `with_structured_output` 返回的已经是 `Intake` 对象,再 `model_validate` 一次是保险,也让类型检查器知道它的类型。
- `return {"intake": r.model_dump(), "llm_calls": 1}` 节点只返回自己改的字段。`model_dump()` 把 pydantic 对象变成普通字典,存进状态才能被 checkpointer 序列化。intake 是第一次调模型,计数直接写 1。
- `ok, invs = mcp.call("list_invoices", {"customer_id": cid, "limit": 24})` locate 用桥接调工具,不经过模型。
- `return {"candidates": [], "known_invoices": [], "messages": [HumanMessage(f"查不到发票:{invs}")]}` 查不到发票就把原因告诉调查节点,让模型决定怎么办(多半是直接交「转人工」)。
- `info = state.get("intake", {})` 读 intake 的结果。
- `cands = pick_candidates(invs, info.get("amount"), info.get("month"))` 调上面的纯函数。
- `brief = (f"客户原话:{state['question']}\n"` 调查的开场白:原话、初步理解、全部发票、候选发票。Day 684 练习 3 用的就是这个思路。
- `"evidence": ev.number(ev.extract("list_invoices", {}, invs), 1), "messages": [HumanMessage(brief)]}` 发票列表本身也是证据,从 E1 开始编。
- `specs = [s for s in mcp.tool_specs() if s["function"]["name"] in READ_TOOLS]` 8 个工具里挑 7 个只读的。
- `investigator = llm.bind_tools(specs + [SubmitFindings])` 绑定 7 个 MCP 工具(字典格式)加 1 个 pydantic 类。LangChain 两种都认,会把 `SubmitFindings` 也转成工具定义。
- `reply = investigator.invoke([SystemMessage(system_prompt(state["customer_id"]))] + state.get("messages", []))` 系统提示词不存进状态,每轮现拼在最前面。好处是 `messages` 里只有对话本身,系统提示改了也不用迁移历史。
- `usage = getattr(reply, "usage_metadata", None) or {}` 假模型返回的消息可能没有这个属性,用 `getattr` 带默认值。
- `"tokens": [usage.get("input_tokens", 0), usage.get("output_tokens", 0)]}` 只返回这一轮的用量,累计交给 `add_tokens`。
- `def last_calls(state: CaseState) -> list[ToolCall]:` 取最后一条消息里的工具调用。`route`、`tools`、`conclude` 三处都要用。
- `return last.tool_calls if isinstance(last, AIMessage) else []` 最后一条不是模型消息(比如是 nudge 加的用户消息)就当没有调用。
- `def route(state: CaseState) -> Literal["tools", "nudge", "conclude"]:` 条件边的路由函数,返回值类型写成 `Literal`,LangGraph 画图时能据此画出三条虚线。
- `if any(c["name"] == "SubmitFindings" for c in calls) or state.get("llm_calls", 0) >= MAX_LLM_CALLS:` 交卷了,或者轮数用完了,都去 conclude。`any(...)` 有一个为真就为真,相当于 `calls.some(...)`。
- `return "conclude" if state.get("nudged") else "nudge"` 既没调工具也没交卷:第一次去 nudge 催一下,催过了还这样就结束(没有结论,会转人工)。
- `return {"nudged": True, "messages": [HumanMessage("请用 SubmitFindings 提交结论;如果还缺证据,先调用工具。")]}` 只催一次。连续两次不按要求交卷,多半是卡住了,再催只是浪费钱。
- `why = check_call(c["name"], args, state["customer_id"], state.get("known_invoices", []))` 每次调用先过两道防线。
- `ok, data = (False, why) if why else mcp.call(c["name"], args)` 被拒绝的调用不去碰 MCP,直接构造一个失败结果,拒绝理由当作报错文字。这样模型看到的格式和工具真报错一样,都是 `[工具报错] ...`。
- `msgs.append(ToolMessage(content=to_text(ok, data), tool_call_id=c["id"]))` 每个调用都要回一条 ToolMessage,哪怕被拒绝了。OpenAI 协议要求模型发出的每个 tool_call 都有对应的结果,少一个下一轮就报 400。
- `new_ev += ev.extract(c["name"], args, data)` 成功的调用才抽证据。
- `start = len(state.get("evidence", [])) + 1` 接着已有证据的编号往下编。
- `return {"messages": msgs, "evidence": ev.number(new_ev, start)}` 返回的只是**新增**的证据,`operator.add` 会把它接到旧列表后面。
- `sub = next((c for c in last_calls(state) if c["name"] == "SubmitFindings"), None)` 找交卷的那个调用,没有就是 None。`next(生成器, 默认值)` 取第一个,相当于 `calls.find(...) ?? null`。
- `return {"findings": {}, "escalated": True}` 没交卷(轮数用完或催了也不交)就转人工。
- `f = SubmitFindings(**sub["args"])` 用 pydantic 再校验一遍模型交上来的参数。`**dict` 把字典展开成关键字参数。
- `except Exception as e:  # 参数不合规就转人工,不硬猜` 格式不对不去猜模型想说什么,计费场景的底线。
- `g = StateGraph(CaseState, input_schema=CaseInput)` `input_schema` 声明图的输入只有两个字段,调用时多传了别的字段会被忽略。
- `g.add_conditional_edges("investigate", route, ["tools", "nudge", "conclude"])` 第三个参数列出所有可能的去处,[Day 306](/blog/agent-zero/day-306-lg-conditional/) 讲过 path_map。
- `g.add_edge("tools", "investigate")` 工具执行完回到调查,这就是那个循环。
- `return g.compile(checkpointer=checkpointer, interrupt_before=interrupt_before)` 编译。`interrupt_before=["investigate"]` 表示每次要进入 investigate 之前暂停,[Day 319](/blog/agent-zero/day-319-lg-interrupt/) 讲过,暂停要靠 checkpointer 存状态,所以两个一起传。

</div>

### 编译出来,画一张图

编译图不需要真模型:建图时只会调模型对象的 `with_structured_output` 和 `bind_tools`,真正的 `invoke` 要等跑起来才调。写一个什么都不做的假对象就能编译:

```python
# billsleuth/scratch/draw_graph.py  编译调查图,打印节点、边和 mermaid 源码(不调模型)
from billsleuth.graph import build_graph
from billsleuth.mcp_bridge import BillingMCP


class NoLLM:
    """编译图只需要这两个方法能被调用,真正调模型的时候才会用到 invoke。"""

    def with_structured_output(self, schema, method=None):
        return self

    def bind_tools(self, tools):
        print("绑定的工具:", [t["function"]["name"] if isinstance(t, dict) else t.__name__ for t in tools])
        return self


graph = build_graph(llm=NoLLM(), mcp=BillingMCP(in_process=True))
print(type(graph).__name__)
g = graph.get_graph()
print("节点:", list(g.nodes))
for e in g.edges:
    print(f"  {e.source} -> {e.target}{'  (条件)' if e.conditional else ''}")
print(g.draw_mermaid())
```

<div class="line-notes">

- `class NoLLM:` 只实现建图时会用到的两个方法。Python 不检查「它是不是 ChatOpenAI」,只要有这两个方法就能用,这叫鸭子类型,[Day 49](/blog/agent-zero/day-049-type-hints-4/) 讲 Protocol 时提过。
- `print("绑定的工具:", [t["function"]["name"] if isinstance(t, dict) else t.__name__ for t in tools])` 看看 `bind_tools` 收到了什么:字典格式的工具取名字,pydantic 类取类名。
- `graph = build_graph(llm=NoLLM(), mcp=BillingMCP(in_process=True))` 内存桥接,`tool_specs()` 会真去取一次工具清单。
- `g = graph.get_graph()` 拿到图的结构描述,用来打印和画图。
- `print(f"  {e.source} -> {e.target}{'  (条件)' if e.conditional else ''}")` 每条边的起点、终点、是不是条件边。
- `print(g.draw_mermaid())` 生成 mermaid 源码,[Day 310](/blog/agent-zero/day-310-lg-send-draw/) 用过。贴进 mermaid.live 或者 Zed 的 markdown 预览就能看到图。

</div>

```bash
uv run python -m scratch.draw_graph
```

```text
绑定的工具: ['get_customer', 'list_invoices', 'get_invoice', 'list_payments', 'get_subscription_timeline', 'get_tax_rate', 'recompute_invoice', 'SubmitFindings']
CompiledStateGraph
节点: ['__start__', 'intake', 'locate', 'investigate', 'tools', 'nudge', 'conclude', '__end__']
  __start__ -> intake
  intake -> locate
  investigate -> conclude  (条件)
  investigate -> nudge  (条件)
  investigate -> tools  (条件)
  locate -> investigate
  nudge -> investigate
  tools -> investigate
  conclude -> __end__
---
config:
  flowchart:
    curve: linear
---
graph TD;
	__start__([<p>__start__</p>]):::first
	intake(intake)
	locate(locate)
	investigate(investigate)
	tools(tools)
	nudge(nudge)
	conclude(conclude)
	__end__([<p>__end__</p>]):::last
	__start__ --> intake;
	intake --> locate;
	investigate -.-> conclude;
	investigate -.-> nudge;
	investigate -.-> tools;
	locate --> investigate;
	nudge --> investigate;
	tools --> investigate;
	conclude --> __end__;
	classDef default fill:#f2f0ff,line-height:1.2
	classDef first fill-opacity:0
	classDef last fill:#bfb6fc
```

8 个工具(7 个 MCP 工具加 `SubmitFindings`)绑上了;6 个业务节点加首尾;三条条件边都从 investigate 出发,mermaid 里画成虚线 `-.->`。这和 Day 684 那张拆段图一一对应。

### 跑一半:真模型只跑 intake

完整跑一次调查要等后天。今天用 `interrupt_before=["investigate"]` 让图跑完 intake 和 locate 就停下:intake 调一次真模型,locate 是代码,停下以后用 `get_state` 看状态里有什么。

```python
# billsleuth/scratch/run_until_investigate.py  真模型只跑 intake,locate 是代码,停在 investigate 之前看状态
import json
import sys

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver

from billsleuth.db import ROOT
from billsleuth.graph import build_graph
from billsleuth.mcp_bridge import BillingMCP

graph = build_graph(mcp=BillingMCP(in_process=True), checkpointer=InMemorySaver(),
                    interrupt_before=["investigate"])
brief = ""
for sid in sys.argv[1:]:
    sc = json.loads((ROOT / "scenarios" / f"{sid}.json").read_text(encoding="utf-8"))
    cfg: RunnableConfig = {"configurable": {"thread_id": sid}}
    graph.invoke({"customer_id": sc["customer_id"], "question": sc["question"]}, cfg)
    snap = graph.get_state(cfg)
    s = snap.values
    print(f"=== {sid} 下一站 {snap.next}")
    print("  intake:", s["intake"])
    print("  候选:", s["candidates"], " 标准答案:", sc["truth"]["invoice_ids"])
    print("  证据:", len(s["evidence"]), "条,第一条", s["evidence"][0])
    brief = s["messages"][-1].content
print("\n最后一个场景的开场白:\n" + brief)
```

<div class="line-notes">

- `from langchain_core.runnables import RunnableConfig` 配置字典的类型。不标注的话,basedpyright 会说 `dict[str, dict[str, str]]` 不能赋给 `RunnableConfig`。
- `graph = build_graph(mcp=BillingMCP(in_process=True), checkpointer=InMemorySaver(),` 不传 `llm`,用 `get_llm()` 的真模型。`InMemorySaver` 把状态存在内存里,[Day 316](/blog/agent-zero/day-316-lg-checkpointer/) 用过。
- `interrupt_before=["investigate"])` 进 investigate 之前停。
- `brief = ""` 先给个空字符串,下面循环一次都没跑时最后那行 print 也不会出错。
- `cfg: RunnableConfig = {"configurable": {"thread_id": sid}}` 每个场景一个线程,用场景号当 thread_id。
- `graph.invoke({"customer_id": sc["customer_id"], "question": sc["question"]}, cfg)` 跑到暂停点就返回。
- `snap = graph.get_state(cfg)` 取这个线程的最新快照,[Day 317](/blog/agent-zero/day-317-lg-state-history/) 讲过。
- `print(f"=== {sid} 下一站 {snap.next}")` `snap.next` 是下一步要跑的节点,暂停在 investigate 之前就是 `('investigate',)`。
- `print("  候选:", s["candidates"], " 标准答案:", sc["truth"]["invoice_ids"])` 候选发票和标准答案并排,看 locate 找得准不准。标准答案只在这里打印对照,没有进图。

</div>

挑四个场景:S011(说了金额)、S017(重复扣款)、S023(重复开票)、S003(账没错的年付):

```bash
uv run python -m scratch.run_until_investigate S011 S017 S023 S003
```

```text
=== S011 下一站 ('investigate',)
  intake: {'complaint': '金额不对', 'amount': '1438.44', 'month': 8}
  候选: ['INV-0011-03']  标准答案: ['INV-0011-03']
  证据: 5 条,第一条 {'id': 'E1', 'claim': 'INV-0011-05 总额(2026-10-01 至 2026-11-01)', 'source_tool': 'list_invoices', 'source_ref': 'INV-0011-05', 'value': '970.10'}
=== S017 下一站 ('investigate',)
  intake: {'complaint': '重复扣款', 'amount': '123.60', 'month': 9}
  候选: ['INV-0017-06', 'INV-0017-05', 'INV-0017-04', 'INV-0017-03']  标准答案: ['INV-0017-05']
  证据: 6 条,第一条 {'id': 'E1', 'claim': 'INV-0017-06 总额(2026-10-14 至 2026-11-14)', 'source_tool': 'list_invoices', 'source_ref': 'INV-0017-06', 'value': '123.60'}
=== S023 下一站 ('investigate',)
  intake: {'complaint': '金额不对', 'amount': '139.05', 'month': 9}
  候选: ['INV-0023-05', 'INV-0023-04D', 'INV-0023-04', 'INV-0023-03', 'INV-0023-02']  标准答案: ['INV-0023-04D']
  证据: 6 条,第一条 {'id': 'E1', 'claim': 'INV-0023-05 总额(2026-10-15 至 2026-11-15)', 'source_tool': 'list_invoices', 'source_ref': 'INV-0023-05', 'value': '139.05'}
=== S003 下一站 ('investigate',)
  intake: {'complaint': '金额不对', 'amount': '4017.00', 'month': None}
  候选: ['INV-0003-02']  标准答案: ['INV-0003-02']
  证据: 2 条,第一条 {'id': 'E1', 'claim': 'INV-0003-02 总额(2026-10-06 至 2027-10-06)', 'source_tool': 'list_invoices', 'source_ref': 'INV-0003-02', 'value': '4017.00'}

最后一个场景的开场白:
客户原话:今天突然扣了我们 4017.00 美元,金额这么大,是不是扣错了?
初步理解:{'complaint': '金额不对', 'amount': '4017.00', 'month': None}
这个客户的发票(最新在前):
- INV-0003-02 周期 2026-10-06 至 2027-10-06 总额 4017.00 USD
- INV-0003-01 周期 2025-10-06 至 2026-10-06 总额 4095.00 USD
候选发票:INV-0003-02。开始调查。
```

四次 intake 一共不到半分钱。intake 都抽对了:S017 认出是「重复扣款」,金额 123.60、9 月;S003「今天突然扣了」没有说月份,month 是 None。四个场景都停在了 investigate 之前,证据从 E1 开始,是发票列表那几条。

问题出在 S017 和 S023 的候选上:**一次找出了四五张**。月付客户每个月金额一样,123.60 能对上四张发票,139.05 能对上五张。第一版 `pick_candidates` 只要金额对上了就不看月份,而客户明明说了「9 月」。候选给太多,就等于没给,模型还是要自己挑。

### 修 pick_candidates

改成「金额和月份都对上的优先,其次只对上金额,再次只对上月份,都没有就取最新一张」:

```python
def pick_candidates(invs: list[dict], amount: str | None, month: int | None) -> list[str]:
    """不用模型:金额和月份都对上的优先,其次只对上金额,再次只对上月份,都没有就取最新一张。"""
    by_amount = [i for i in invs if amount and i["total"] == amount]
    by_month = [i for i in invs if month and int(i["issued_at"][5:7]) == month]
    both = [i for i in by_amount if i in by_month]
    return [i["id"] for i in (both or by_amount or by_month or invs[:1])]
```

<div class="line-notes">

- `by_amount = [i for i in invs if amount and i["total"] == amount]` 金额对上的发票(留整个字典,不只是号)。
- `by_month = [i for i in invs if month and int(i["issued_at"][5:7]) == month]` 开票月份对上的。
- `both = [i for i in by_amount if i in by_month]` 两个都对上的,求交集。`i in by_month` 比较的是字典内容,两个列表里的字典来自同一个 `invs`,内容一样就算在。
- `return [i["id"] for i in (both or by_amount or by_month or invs[:1])]` 四个候选列表按优先级用 `or` 串起来,取第一个非空的。客户金额说错了(对不上任何发票)但月份说对了,会退到 `by_month`;这是旧版做不到的。`invs[:1]` 是只含最新一张的列表,列表为空时也不会报错。

</div>

替换掉旧函数,再跑那两个场景:

```bash
uv run python -m scratch.run_until_investigate S017 S023
```

```text
=== S017 下一站 ('investigate',)
  候选: ['INV-0017-05']  标准答案: ['INV-0017-05']
=== S023 下一站 ('investigate',)
  候选: ['INV-0023-04D', 'INV-0023-04']  标准答案: ['INV-0023-04D']
```

(只摘了候选那两行。)S017 收窄到了一张,正好是答案。S023 剩两张,原件和重复的那张金额一样、月份一样,代码分不出来,留给模型去查,这正是该交给判断的地方。练习 3 会在全部 100 个场景上量一下新版 locate 的命中率。

### 零件的测试

两个纯函数和图的形状,都能不花钱地测。新建 `tests/test_graph_parts.py`:

```python
# billsleuth/tests/test_graph_parts.py  调查图里不调模型的零件:找候选发票、两道防线、图的形状
import pytest

from billsleuth.graph import build_graph, check_call, pick_candidates
from billsleuth.mcp_bridge import BillingMCP

INVS = [  # 最新在前,和 list_invoices 的顺序一样
    {"id": "INV-0017-06", "issued_at": "2026-10-14", "total": "123.60"},
    {"id": "INV-0017-05", "issued_at": "2026-09-14", "total": "123.60"},
    {"id": "INV-0017-04", "issued_at": "2026-08-14", "total": "123.60"},
    {"id": "INV-0017-03", "issued_at": "2026-07-14", "total": "150.20"},
]


@pytest.mark.parametrize("amount,month,want", [
    ("150.20", None, ["INV-0017-03"]),                                  # 金额唯一
    ("123.60", 9, ["INV-0017-05"]),                                     # 金额有三张,月份收窄到一张
    ("123.60", None, ["INV-0017-06", "INV-0017-05", "INV-0017-04"]),   # 没说月份,只能都给
    (None, 8, ["INV-0017-04"]),                                         # 只说了月份
    ("999.99", 9, ["INV-0017-05"]),                                     # 金额说错了,退回按月份
    (None, None, ["INV-0017-06"]),                                      # 什么都没说,取最新
])
def test_pick_candidates(amount, month, want):
    assert pick_candidates(INVS, amount, month) == want


KNOWN = ["INV-0011-03", "INV-0011-02"]


@pytest.mark.parametrize("name,args,reason", [
    ("get_invoice", {"invoice_id": "INV-0011-03"}, None),
    ("list_payments", {"customer_id": "C-0002"}, "只能查询客户 C-0011"),
    ("recompute_invoice", {"invoice_id": "INV-0002-01"}, "不在这个客户的发票列表里"),
    ("draft_credit_note", {"invoice_id": "INV-0011-03", "amount": "26.02"}, "不能调用"),
])
def test_check_call(name, args, reason):
    got = check_call(name, args, "C-0011", KNOWN)
    assert got is None if reason is None else (got is not None and reason in got)


def test_graph_shape(fresh_db):
    class NoLLM:
        def with_structured_output(self, schema, method=None):
            return self

        def bind_tools(self, tools):
            return self

    g = build_graph(llm=NoLLM(), mcp=BillingMCP(in_process=True)).get_graph()
    assert set(g.nodes) == {"__start__", "intake", "locate", "investigate", "tools", "nudge", "conclude", "__end__"}
    cond = {(e.source, e.target) for e in g.edges if e.conditional}
    assert cond == {("investigate", "tools"), ("investigate", "nudge"), ("investigate", "conclude")}
```

<div class="line-notes">

- `INVS = [  # 最新在前,和 list_invoices 的顺序一样` 手写的四张发票,只留 `pick_candidates` 用到的三个字段。三张金额一样,模仿 S017。
- `("123.60", 9, ["INV-0017-05"]),                                     # 金额有三张,月份收窄到一张` 今天当场发现的那个问题,用测试钉住。把函数换回第一版,这条会红。
- `("123.60", None, ["INV-0017-06", "INV-0017-05", "INV-0017-04"]),   # 没说月份,只能都给` 客户没说月份时,代码确实分不出来,全给模型。
- `("999.99", 9, ["INV-0017-05"]),                                     # 金额说错了,退回按月份` 客户记错金额很常见。
- `(None, None, ["INV-0017-06"]),                                      # 什么都没说,取最新` 「我的账单看不懂」这种话,先看最新一张。
- `KNOWN = ["INV-0011-03", "INV-0011-02"]` 假设这是 locate 拿到的 C-0011 的发票列表。
- `("list_payments", {"customer_id": "C-0002"}, "只能查询客户 C-0011"),` 越权查别的客户。
- `("recompute_invoice", {"invoice_id": "INV-0002-01"}, "不在这个客户的发票列表里"),` 发票号格式对,但不是本客户的。
- `("draft_credit_note", {"invoice_id": "INV-0011-03", "amount": "26.02"}, "不能调用"),` 调查阶段想写草稿,拒绝。
- `assert got is None if reason is None else (got is not None and reason in got)` 期望放行就要求返回 None,期望拒绝就要求拒绝理由里包含关键字。
- `def test_graph_shape(fresh_db):` 建图要取一次工具清单,用一份干净库。
- `assert set(g.nodes) == {"__start__", "intake", "locate", "investigate", "tools", "nudge", "conclude", "__end__"}` 节点一个不多一个不少。
- `cond = {(e.source, e.target) for e in g.edges if e.conditional}` 只看条件边,三条都从 investigate 出发。

</div>

```bash
uv run pytest tests/test_graph_parts.py -q
uv run pytest -q
```

```text
11 passed in 4.55s
259 passed in 17.22s
```

今天新增 22 条(证据 11 条、零件 11 条),全部测试 259 条全绿(我这里的总数比 Day 683 的验收数少两条练习测试,见 Day 684 的说明,以 0 failed 为准)。图本身的路由、催交、转人工这几条路径,要用一个按剧本回话的假模型才能测,那是明天的内容。

## 今天的文件

| 零件 | 文件 | 新建还是修改 | 后面哪天用到 |
| --- | --- | --- | --- |
| 证据抽取、编号、清单 | `billsleuth/evidence.py` | 新建 | Day 688 数字溯源 |
| 状态和两个 schema | `billsleuth/graph.py` 第一段 | 新建 | Day 687 起 |
| `pick_candidates`、`check_call`、系统提示 | `graph.py` 第二段 | 新建 | Day 687、693 |
| 六个节点、路由、编译 | `graph.py` 第三段 `build_graph` | 新建 | Day 687 真跑、Day 690 加审批 |
| 证据测试 | `tests/test_evidence.py` | 新建 | 每次改工具或证据 |
| 零件测试 | `tests/test_graph_parts.py` | 新建 | 每次改图 |
| 草稿 | `scratch/numbers_without_source.py`、`try_evidence.py`、`orphans_again.py`、`s011_reply.txt`、`draw_graph.py`、`run_until_investigate.py` | 新建 | |

`build_graph` 里每个节点用到了哪个零件:

| 零件 | 用在哪个节点 |
| --- | --- |
| `Intake` + `get_llm()` | intake |
| `BillingMCP.call` + `pick_candidates` + `ev.extract/number` | locate |
| `BillingMCP.tool_specs` + `SubmitFindings` + `system_prompt` | investigate |
| `check_call` + `BillingMCP.call` + `to_text` + `ev.extract/number` | tools |
| `SubmitFindings` | conclude |

今天花费:实验三次 ¥0.0125,`run_until_investigate.py` 跑了 6 次 intake 不到 ¥0.01,练习 3 的 100 次 intake ¥0.1427(输入 43973、输出 6844 token,43973 × 2 + 6844 × 8 再除以一百万),合计约 ¥0.17。

## 动手练习

**练习 1:重复开票的事实也要进证据链。** `recompute_invoice` 的 `other_invoices_same_period` 不是数字,`extract` 没抽它。可 S023 这种场景,给客户解释时最关键的一句就是「同一周期还有另一张发票 INV-0023-04」。在 `recompute_invoice` 分支末尾加上它,每张其他发票一条证据,然后对 `INV-0023-04D` 抽一次看看。改完跑 `tests/test_evidence.py`,还能全绿吗?

<details><summary>参考答案</summary>

在 `recompute_invoice` 分支里实收行的循环后面加两行:

```python
        for other in data["other_invoices_same_period"]:
            out.append(_ev(f"{ref} 同一周期的另一张发票", tool, ref, other))
```

<div class="line-notes">

- `for other in data["other_invoices_same_period"]:` 一般是空列表,只有重复开票时有值。
- `out.append(_ev(f"{ref} 同一周期的另一张发票", tool, ref, other))` 每张一条,值是发票号。不把几个号拼成一个字符串,是为了让「值原样出现在工具结果里」那条测试继续成立。

</div>

```python
# billsleuth/scratch/ex1_same_period.py  练习 1:重复开票的那条事实,现在也进了证据链
from billsleuth import evidence as ev
from billsleuth.mcp_bridge import BillingMCP

ok, data = BillingMCP(in_process=True).call("recompute_invoice", {"invoice_id": "INV-0023-04D"})
for e in ev.number(ev.extract("recompute_invoice", {}, data), 1):
    if "同一周期" in e["claim"] or "多收" in e["claim"]:
        print(ev.render([e]))
```

<div class="line-notes">

- `if "同一周期" in e["claim"] or "多收" in e["claim"]:` 只打印两条最能说明问题的证据。

</div>

```bash
uv run python -m scratch.ex1_same_period
uv run pytest tests/test_evidence.py -q
```

```text
[E3] INV-0023-04D 多收(实际 - 应收) = 0.00  (recompute_invoice INV-0023-04D)
[E15] INV-0023-04D 同一周期的另一张发票 = INV-0023-04  (recompute_invoice INV-0023-04D)
11 passed in 2.62s
```

E3 说这张发票本身多收 0.00,E15 说同一周期还有 INV-0023-04。两条放在一起,才讲得清「这张发票金额没错,但它根本不该存在」。测试照样全绿:`CALLS` 里复算的是 S011,没有同周期发票,新加的分支没走到。想让测试也覆盖到,可以在 `CALLS` 里加一项 `("recompute_invoice", {"invoice_id": "INV-0023-04D"})`,注意 `ids` 会出现两个同名的 `recompute_invoice`,pytest 会自动加后缀区分。这两行改动留在 `evidence.py` 里,后面要用。

</details>

**练习 2:观察会发生什么。** 不让模型调查,手写一条「模型发出的工具调用」塞进状态,让图从 tools 节点接着跑:一个是正常的 `recompute_invoice`,一个是别的客户的发票号。看证据从几号编到几号、两条 ToolMessage 写了什么。然后把 `CaseState` 里 `evidence` 的 reducer 去掉(改成 `evidence: list[dict]`),再跑一次,对比。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex2_fake_turn.py  练习 2:不让模型调查,手写一轮「模型的工具调用」塞进状态,看 tools 节点怎么接证据
from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver

from billsleuth.graph import build_graph
from billsleuth.mcp_bridge import BillingMCP

graph = build_graph(mcp=BillingMCP(in_process=True), checkpointer=InMemorySaver(),
                    interrupt_before=["investigate"])
cfg: RunnableConfig = {"configurable": {"thread_id": "fake-1"}}
graph.invoke({"customer_id": "C-0011", "question": "8 月这张发票金额 1438.44,我们财务对不上账,麻烦查一下。"}, cfg)
print("locate 之后:", [e["id"] for e in graph.get_state(cfg).values["evidence"]])

fake = AIMessage("", tool_calls=[
    {"name": "recompute_invoice", "args": {"invoice_id": "INV-0011-03"}, "id": "call_1", "type": "tool_call"},
    {"name": "get_invoice", "args": {"invoice_id": "INV-0002-01"}, "id": "call_2", "type": "tool_call"},
])
graph.update_state(cfg, {"messages": [fake]}, as_node="investigate")
graph.invoke(None, cfg)
s = graph.get_state(cfg).values
print("tools 之后:", s["evidence"][0]["id"], "...", s["evidence"][-1]["id"], f"共 {len(s['evidence'])} 条")
for m in s["messages"][-2:]:
    print(" ", type(m).__name__, str(m.content)[:70])
```

<div class="line-notes">

- `graph.invoke({"customer_id": "C-0011", "question":` 先正常跑到 investigate 之前(intake 调一次真模型)。
- `fake = AIMessage("", tool_calls=[` 手写一条模型消息,带两个工具调用。字段和真模型返回的一样:名字、参数、id、`type: "tool_call"`。
- `{"name": "get_invoice", "args": {"invoice_id": "INV-0002-01"}, "id": "call_2", "type": "tool_call"},` 别的客户的发票号,应该被 `check_call` 拦下。
- `graph.update_state(cfg, {"messages": [fake]}, as_node="investigate")` 假装这条消息是 investigate 节点产出的,[Day 322](/blog/agent-zero/day-322-lg-time-travel/) 讲过 `update_state` 和 `as_node`。LangGraph 会从 investigate 之后接着走:跑 `route`,发现有工具调用,去 tools。
- `graph.invoke(None, cfg)` 传 None 表示「不加新输入,从暂停的地方继续」。tools 跑完回到 investigate 前,又被 `interrupt_before` 停住。
- `for m in s["messages"][-2:]:` 最后两条就是 tools 节点回的两条 ToolMessage。

</div>

```bash
uv run python -m scratch.ex2_fake_turn
```

```text
locate 之后: ['E1', 'E2', 'E3', 'E4', 'E5']
tools 之后: E1 ... E26 共 26 条
  ToolMessage {"invoice_id": "INV-0011-03", "period_start": "2026-08-01", "period_en
  ToolMessage [工具报错] 发票 INV-0002-01 不在这个客户的发票列表里,发票号必须来自 list_invoices
```

locate 留下 E1 到 E5,tools 接着编到 E26,一共 26 条:复算抽了 21 条(补了实收行以后),被拒绝的那次一条没抽。第二条 ToolMessage 是 `check_call` 的拒绝理由,格式和真工具报错一样。

去掉 reducer 再跑:

```text
locate 之后: ['E1', 'E2', 'E3', 'E4', 'E5']
tools 之后: E6 ... E26 共 21 条
  ToolMessage {"invoice_id": "INV-0011-03", "period_start": "2026-08-01", "period_en
  ToolMessage [工具报错] 发票 INV-0002-01 不在这个客户的发票列表里,发票号必须来自 list_invoices
```

E1 到 E5 没了,证据从 E6 开始。没有 reducer 的字段是覆盖:tools 返回的 21 条新证据直接替换了旧的 5 条。编号还是从 6 开始,因为 tools 节点里 `start` 是按**旧状态**的长度算的,这让问题更隐蔽:清单看上去编号整齐,其实前五条丢了。没报任何错。改回 `Annotated[list[dict], operator.add]`。

</details>

**练习 3:locate 在 100 个场景上准不准。** 不跑完整的图,只对 100 个场景各做一次 intake(真模型),再用新版 `pick_candidates` 找候选,统计候选里包含标准答案发票的场景有几个、候选张数的分布,顺便算一下 100 次 intake 花了多少钱。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex3_locate_hit.py  练习 3:100 个场景只跑 intake + locate,数候选发票里有没有标准答案
import json
from collections import Counter

from billsleuth.db import ROOT
from billsleuth.graph import Intake, pick_candidates
from billsleuth.llm import estimate_cost, get_llm
from billsleuth.mcp_bridge import BillingMCP

mcp = BillingMCP(in_process=True)
intake_llm = get_llm().with_structured_output(Intake, method="function_calling", include_raw=True)
sizes, miss, tin, tout = Counter(), [], 0, 0
for i in range(1, 101):
    sc = json.loads((ROOT / "scenarios" / f"S{i:03d}.json").read_text(encoding="utf-8"))
    out = intake_llm.invoke(f"客户原话:{sc['question']}")
    u = out["raw"].usage_metadata or {}
    tin, tout = tin + u.get("input_tokens", 0), tout + u.get("output_tokens", 0)
    info = Intake.model_validate(out["parsed"])
    _, invs = mcp.call("list_invoices", {"customer_id": sc["customer_id"], "limit": 24})
    cands = pick_candidates(invs, info.amount, info.month)
    sizes[len(cands)] += 1
    if not set(sc["truth"]["invoice_ids"]) & set(cands):
        miss.append((sc["id"], sc["question"], info.model_dump(), cands, sc["truth"]["invoice_ids"]))
print("候选张数分布:", dict(sorted(sizes.items())))
print(f"候选里有标准答案:{100 - len(miss)}/100")
for m in miss:
    print("  没命中:", m)
print(f"intake 100 次:输入 {tin} / 输出 {tout} token,约 ¥{estimate_cost(tin, tout):.4f}")
```

<div class="line-notes">

- `from collections import Counter` 计数用的字典,`sizes[2] += 1` 不存在的键自动从 0 开始。
- `intake_llm = get_llm().with_structured_output(Intake, method="function_calling", include_raw=True)` `include_raw=True` 让返回值变成 `{"raw": 原始消息, "parsed": 解析结果, ...}`,这样才拿得到用量。图里的 intake 节点没要用量,所以没加。
- `u = out["raw"].usage_metadata or {}` 原始 AIMessage 上的用量。
- `info = Intake.model_validate(out["parsed"])` 解析好的 `Intake`。
- `if not set(sc["truth"]["invoice_ids"]) & set(cands):` 两个集合求交集,`&` 相当于取共同元素。交集为空就是没命中。
- `print(f"intake 100 次:输入 {tin} / 输出 {tout} token,约 ¥{estimate_cost(tin, tout):.4f}")` 用 Day 684 的估算函数。

</div>

```bash
uv run python -m scratch.ex3_locate_hit
```

```text
候选张数分布: {1: 90, 2: 10}
候选里有标准答案:100/100
intake 100 次:输入 43973 / 输出 6844 token,约 ¥0.1427
```

100 个场景,候选里全有标准答案;90 个只给一张,10 个给两张(重复开票那种原件和重复件分不出来的,加上几个没说月份的)。每次 intake 平均输入 440 token,大头是 `Intake` 的 schema 和描述,不是客户原话。花费 43973 × 2 + 6844 × 8 = 142,698,除以一百万是 ¥0.1427。

这一步没有一次失手,而且它不需要判断力,这正是 Day 684 说「确定的步骤交给代码」的底气。顺便留意一下:这是单次运行的结果,intake 用的是 temperature=0 但 Day 112 实测过 DeepSeek 关思考后 temperature=0 也不保证每次一样,真要报数要跑几次。

</details>

**验收标准:** `uv run pytest -q` 全绿,其中 `test_evidence.py` 和 `test_graph_parts.py` 各 11 条;`draw_graph.py` 打印出 8 个节点、三条条件边和 mermaid 源码;`run_until_investigate.py` 至少跑通两个场景并停在 `('investigate',)`;能说出实验里找不到出处的数字的三种来源;练习 2 能解释为什么去掉 reducer 以后编号从 E6 开始却不报错。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 证据链(evidence) | 由代码从工具结果里抽出、编了号的事实清单,例子:`[E8] INV-0011-03 多收(实际 - 应收) = 26.02` |
| 出处(provenance) | 一个数字是从哪个工具、哪个对象来的;找不到出处的数字不能写给客户 |
| 数字幻觉 | 回答里出现了证据链找不到的数字,可能是编的,也可能是模型自己算的,例子:实验里的 4.84 |
| claim | 证据里那句「这个值说的是什么」的人话 |
| 伪工具(pseudo tool) | 不对应真实操作、只用来让模型交出结构化结果的工具,例子:`SubmitFindings` |
| 交卷 | 模型调用 `SubmitFindings` 提交结论,路由看到它就去 conclude |
| nudge | 模型没调工具也没交卷时,追加一句提醒;只催一次 |
| 转人工(escalate) | 没有结论或结论格式不合格时,不猜,标记 `escalated` 交给人 |
| 自定义 reducer | 自己写的状态合并函数,例子:`add_tokens` 把每轮用量按位相加 |
| `input_schema` | `StateGraph` 的参数,声明图的输入只有哪几个字段 |
| `interrupt_before` | 编译时指定在哪些节点之前暂停,需要配合 checkpointer |
| `update_state(..., as_node=...)` | 以某个节点的名义往状态里写东西,图从那个节点之后接着走 |
| `include_raw=True` | 结构化输出同时返回原始消息,用来拿用量 |
| 鸭子类型 | 不看对象是什么类,只看它有没有需要的方法,例子:`NoLLM` 冒充模型对象 |

## 常见误区

**模型拿到了正确的工具结果,写出来的数字就都有出处。** 实验里三次回答每次都有 5 个金额在证据里找不到,其中两个是模型自己做的减法。算对了也不行,因为没法自动核对。

**证据抽取写一个通用的「见数字就抽」。** 抽出来的证据没有 claim,没人知道 `"890.00"` 说的是什么;也会把 `limit: 24` 这种参数当成事实。按工具手写抽哪些字段。

**只抽应收不抽实收。** 第一版就是这样,实验里实际发票上的 87.10 和 516.77 找不到出处。给客户解释「多收在哪一行」引用的正是实收的行。

**比对数字时忽略正负号。** 退还行是 -82.26,回答里写「退了 82.26」。今天先用 `lstrip("-")` 粗处理,但这样「退」和「收」就分不清了,校验器要更细。

**按金额找发票就够了。** 月付客户每个月金额一样,实测 S017 找出四张、S023 找出五张。金额和月份一起用,实测 100 个场景 90 个收窄到一张。

**状态字段忘了写 reducer。** 练习 2 实测:证据被覆盖,前五条丢了,编号还从 E6 开始,看上去一切正常,不报任何错。

**被拒绝的工具调用不回 ToolMessage。** OpenAI 协议要求每个 tool_call 都有对应结果,少一个下一轮就报 400。拒绝也要回一条,内容写拒绝理由。

**编译图非要真模型。** 建图只调 `with_structured_output` 和 `bind_tools`,一个有这两个方法的假对象就能编译和画图。

## 学习资料

### 文档与文章

- [LangGraph · Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api):State、reducer、`input_schema`、条件边的官方说明,对照今天的 `CaseState` 读,20 分钟。
- [LangGraph · Use the graph API](https://docs.langchain.com/oss/python/langgraph/use-graph-api):里面有自定义 reducer 和画图的例子,15 分钟。
- [LangChain · Structured output](https://docs.langchain.com/oss/python/langchain/structured-output):`with_structured_output` 的几种 method 和 `include_raw`,15 分钟。
- [Anthropic · Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents):「返回有意义的上下文」一节,对照今天「工具结果里有、证据里没抽」的问题,15 分钟。
- [Python 文档 · operator](https://docs.python.org/zh-cn/3.12/library/operator.html):`operator.add` 是什么,中文,5 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Uy411i7eQ&autoplay=0&high_quality=1" title="什么是大模型幻觉?为什么会产生幻觉?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI老兵文哲 · 什么是大模型幻觉?为什么会产生幻觉? · 5 分钟,讲幻觉的几种来源。对照今天的实验想一想:模型自己算出的 4.84 算不算幻觉?</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1z3NY66EY1&autoplay=0&high_quality=1" title="尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>尚硅谷 · 尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战 · 很长的合集,今天只挑讲 State 和 reducer、讲条件边的那几集看,忘了的复习一下。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/jGg_1h0qzaM" title="LangGraph Complete Course for Beginners – Complex AI Agents with Python" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>freeCodeCamp.org · LangGraph Complete Course for Beginners – Complex AI Agents with Python · 英文长课,看讲 state 和 reducer、讲带工具的 Agent 图的两段,和今天的 CaseState、tools 节点对照。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 4 章讲评测时专门讨论了事实一致性(factual consistency)和怎么检查回答是否有依据,和今天的证据链、Day 688 的校验器是一回事。
- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly, 2024):RAG 那几章讲「回答要能追溯到来源」,我们的证据链可以看成一种结构化的引用。

### 开源项目与代码

- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):看 `libs/langgraph/langgraph/graph/message.py` 里 `add_messages` 的实现,只有几十行,看完就知道它和 `operator.add` 差在哪(按 id 替换)。
- [sierra-research/tau-bench](https://github.com/sierra-research/tau-bench):看它的 Agent 实现怎么判断一次任务结束,对照我们的 `SubmitFindings` 交卷。

## 自测

1. 实验里模型的回答有 5 个金额找不到出处,分别是哪三种来源?各怎么处理?

<details><summary>答案</summary>

一是工具结果里有、但抽取漏了(87.10、516.77 在 `actual_lines` 里),补抽取代码;二是证据里有、但符号不同(证据是 -82.26,回答写 82.26),校验时处理正负号;三是工具结果里根本没有、模型自己算的(4.84、28.71 是两次减法),这类要由 Day 688 的校验器拦下,让模型要么去调能给出这个数的工具,要么别写。

</details>

2. 为什么证据由代码按工具名逐个字段抽,而不是让模型在回答里自己写出处,也不是写一个通用的「见数字就抽」?

<details><summary>答案</summary>

模型写出处会抄错,而且没法自动核对;代码抽取是确定的,值就是工具返回的原字符串,测试证明了一字不差。通用抽取抽出来的证据没有 claim,不知道每个数说的是什么,还会把参数之类的东西也当成事实。手写按工具抽,每条证据都有「说的是什么、来自哪个工具、哪个对象」。

</details>

3. `CaseState` 里哪几个字段有 reducer?为什么 `llm_calls` 没有?

<details><summary>答案</summary>

`messages` 用 `add_messages`(追加,id 相同替换),`evidence` 用 `operator.add`(追加),`tokens` 用自定义的 `add_tokens`(按位相加)。`llm_calls` 是覆盖:investigate 节点自己读旧值加一再写回去,每次只有一个节点在改它,不需要 reducer。如果写成「每次返回 1、用 operator.add 累加」也行,两种都对,但不能两种混用。

</details>

4. tools 节点里被 `check_call` 拒绝的调用,为什么还要回一条 ToolMessage?为什么拒绝和真报错用同样的格式?

<details><summary>答案</summary>

OpenAI 协议要求模型发出的每个 tool_call 都有一条对应的 tool 结果,少一个下一轮请求就报 400。用同样的 `[工具报错] ...` 格式,模型只需要学会一种处理方式:读报错,改参数或换工具。拒绝理由写清楚「发票号必须来自 list_invoices」,模型下一轮通常就改正了。

</details>

5. 今天跑 S017 时第一版 `pick_candidates` 找出了四张候选,原因是什么?怎么修的?修完在 100 个场景上效果如何?

<details><summary>答案</summary>

月付客户每个月金额一样,123.60 能对上四张发票,第一版只要金额对上就不再看月份。改成金额和月份都对上的优先,其次只看金额,再次只看月份,都没有取最新一张。练习 3 实测 100 个场景候选里都有标准答案,90 个只给一张,10 个给两张(多是重复开票分不出原件和重复件)。

</details>

6. 面试题:「你的 Agent 给客户的回复里有金额,你怎么保证这些数字不是编的?」

<details><summary>答案</summary>

我把「找数字」和「写数字」分开。Agent 每次调工具成功后,由代码从结构化结果里把金额、日期、税率按工具逐字段抽出来,编号成证据链,每条有说明、来源工具、来源对象和原始值,测试保证值和工具返回的一字不差。最后写回复时,用一个校验器把回复里的每个金额和证据链比对,找不到出处的就把问题清单交回模型重写,几次不行就用模板兜底。我做过一个实验:模型拿到完整的工具结果,写的解释里 14 个金额有 5 个找不到出处,其中两个是它自己做的减法,算对了,但没法自动核对。所以规则是:模型想说一个数,要么这个数在证据里,要么去调能给出它的工具。工具层的设计也配合这一点,差额、按类别的差额都由复算工具算好返回,模型不需要做算术。

</details>

## 明天预告

明天是 Day 687 · BillSleuth(七):不花钱的流程测试和真模型跑。今天的图编译出来了,也让真模型跑了前两段,但 investigate 循环、催交、转人工这几条路径一次都没走过。明天先写一个按剧本回话的假模型,把正常交卷、越权被拦、格式不合格转人工这几条路径一分钱不花地测一遍;再用真模型把几个场景从头跑到尾,看它的查账路径、轮数和花费,和 Day 684 那个大循环比一比。
