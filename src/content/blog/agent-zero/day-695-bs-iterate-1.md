---
title: 'Day 695 · BillSleuth(十四):先读再分桶再数,成功的运行也要读'
description: '昨天的报告是 15 成功 5 失败,四项判断 20/20 全对。今天不再动 Agent,只读那 20 次运行:先把 5 个失败分桶(第一遍 5 个全进「转人工」,桶太粗,读了原文才拆开),再逐桶读原文。重复开票两张发票在数据上一模一样,标准答案要的那张只靠号码后缀 D 区分;写作兜底的 3 次全是客户把金额记错的那几次,校验器把客户口述的数当成了编造。最后读成功的运行,发现 15 个里有 3 个并不好:2 个在客户追问后承诺了退款方式,1 个收到的是模板。'
pubDate: 2026-10-27
regime: none
tags: ['billsleuth', 'error-analysis', 'evaluation', 'agent-zero']
series: 'agent-zero'
day: 695
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 694](/blog/agent-zero/day-694-bs-eval-2/) 把评测跑起来了:判分器把「成功」写成四项该对、四项不该有的规则,评测脚本每次在独立进程里从干净母版出发、能断点续跑。按预算只跑了 20 个场景,成功率 75%,95% 区间 [53%, 89%]。报告里有一个地方要先看:根因、金额、动作、发票号四项 20/20 全对,5 个失败全是 `escalated` 和 `missed_credit`,也就是判断对了,流程后半段把它拦下来转了人工。

当时我只粗粗读了几眼。拿到一份报告以后最常见的错误做法是直接开始改提示词:「失败率 25%,我在提示词里强调一下要仔细。」改完再跑,涨了几个点,很高兴,然后发现这几个点在区间里根本分不出来,也不知道涨在哪。今天不改任何东西,只做一件事:读。

## 今天要解决的问题

学完今天你应该能:

1. 说清楚「先读再分桶再数」为什么顺序不能反,并写一个脚本把失败按「修的时候改哪里」自动分桶,知道桶分粗了怎么发现、怎么拆。
2. 逐桶读原文,读到能说出一句具体原因为止;用不花钱的脚本去验证读出来的猜测(今天一共验证了三个)。
3. 读成功的运行:判分器说成功不等于做得好,今天 15 个成功里读出了 3 个不好的。
4. 把读出来的东西汇成一张分桶表,每一行写清楚「是谁的问题」(Agent、校验器、评测定义还是数据),并诚实地说这 20 个样本能支持什么结论。

今天只有一个新概念:**错误分析**(先读、再分类、最后才数)。[Day 345](/blog/agent-zero/day-345-error-analysis-1/) 到 [Day 347](/blog/agent-zero/day-347-error-analysis-3/) 在 SupportPilot 上讲过完整流程,[Day 480](/blog/agent-zero/day-480-iterate-1/) 讲过四个坑,今天把它用在 BillSleuth 自己的评测结果上。

预计用时 3 小时。前置:[Day 694](/blog/agent-zero/day-694-bs-eval-2/)(`runs/v1.jsonl`、`grade.py`、`report.py`)、[Day 689](/blog/agent-zero/day-689-bs-grounded-2/)(`explain.py` 的写作循环和兜底)、[Day 691](/blog/agent-zero/day-691-bs-credit-2/)(`credit_target`)。今天**几乎不花钱**:只有一次重放写作步骤用了真模型,约 ¥0.04,其余全是读文件和查库。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `bucket()` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先读,再分桶,再数

Hamel Husain 把错误分析叫作 AI 工程里投入产出比最高的事。他的做法是先通读几十条记录,边读边写笔记,再从笔记里归纳出类别,最后才去数每类有几个。顺序不能反:先定好类别再去数,你只会看到你预想的问题,看不到预想之外的。

今天只有 20 条运行,全部手读也不累。但评测的目的是以后跑 400 条、上千条,所以我还是写一个粗的规则脚本把失败分桶,知道大头在哪;然后每个桶读几条原文,读的时候可能发现规则分错了,或者一个桶里混着两种原因,再回头改规则。

分桶按「修的时候改哪里」排优先级,不按「错在哪个指标」:

```python
# billsleuth/billsleuth/evals/buckets.py  把失败的运行按「修的时候改哪里」分桶,再每桶列几条样例
"""用法:uv run python -m billsleuth.evals.buckets runs/v1.jsonl [--show 2] [--flags-only]"""
import argparse
import json
from collections import Counter, defaultdict


def bucket(r: dict, use_reason: bool = True) -> str:
    """优先级从上往下:前面的桶是更严重、或者改法更明确的。一次运行只进一个桶。"""
    if "crashed" in r:
        return "崩溃/网络"
    if not (r["root_ok"] and r["overcharge_ok"] and r["action_ok"]):
        return "判断错(根因、金额或动作)"
    if r["bad_reply"]:
        return "客户版有问题(编数字、承诺)"
    if r["wrong_credit"]:
        return "误冲正"
    if r["escalated"]:
        if not use_reason:
            return "转人工"
        err = r.get("approval_error") or ""
        if r["uncashable"]:
            return "转人工:标准答案兑现不了"
        if "没有证据能说明" in err:
            return "转人工:证据不能唯一定出该冲哪张"
        if "模板兜底" in err:
            return "转人工:写作三稿没过,兜底"
        if "超过了这张发票" in err:
            return "转人工:金额超过实际扣款"
        return "转人工:其他原因"
    if not r["invoice_ok"]:
        return "发票号不全"
    return "其他"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("run")
    ap.add_argument("--show", type=int, default=2)
    ap.add_argument("--flags-only", action="store_true", help="只看判分标志,不读 approval_error,桶会粗很多")
    a = ap.parse_args()
    rows = [json.loads(ln) for ln in open(a.run, encoding="utf-8") if ln.strip()]
    fails = [r for r in rows if not r.get("success")]
    groups: dict[str, list[dict]] = defaultdict(list)
    for r in fails:
        groups[bucket(r, not a.flags_only)].append(r)
    print(f"失败 {len(fails)}/{len(rows)}")
    for name, items in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        print(f"\n## {name}  {len(items)} 次  {Counter(r['root_cause'] for r in items if 'crashed' not in r).most_common()}")
        for r in items[: a.show]:
            if "crashed" in r:
                print(f"   - {r['scenario']} t{r['trial']} {r['crashed'][:120]}")
                continue
            print(f"   - {r['scenario']} 人设 {r['persona']} 结论 {r['got_root_cause']} 多收 {r['got_overcharge']}"
                  f" 发票 {r['got_invoices']} 兜底={r['fallback']}")
            print(f"     原因:{(r.get('approval_error') or '')[:90]}")
            print(f"     推理:{(r.get('reasoning') or '')[:110]}")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `def bucket(r: dict, use_reason: bool = True) -> str:` 输入一次运行的结果行,返回它所在的桶名。`use_reason` 控制要不要读 `approval_error` 那段原因文字,后面第一遍分桶时会关掉它。
- `if "crashed" in r:` `return "崩溃/网络"` 最先判断:崩溃的行没有别的字段,不能往下走。
- `if not (r["root_ok"] and r["overcharge_ok"] and r["action_ok"]):` 根因、金额、动作任何一项错了,是「判断错」。这是 Agent 本身的问题,优先级最高。
- `if r["bad_reply"]:` 客户版有问题(编数字、承诺时限)。
- `if r["wrong_credit"]:` 误冲正,代价最大的错误,单独一桶。
- `if r["escalated"]:` 转人工是今天的大头,里面再按原因拆开。
- `if not use_reason:` `return "转人工"` 只看判分标志的时候,所有转人工都进同一个桶。
- `err = r.get("approval_error") or ""` 图在起草贷记单那一步留下的原因文字。运行时没起草就没有这个字段,`or ""` 兜底。
- `if r["uncashable"]:` 先判断是不是 S041、S083 那种标准答案本身兑现不了的。放在兜底之前,是因为兑现不了的修了别的也没用。
- `if "没有证据能说明" in err:` Day 691 的 `credit_target` 返回 `None` 时留下的原因。
- `if "模板兜底" in err:` 写作三稿都没过校验。
- `if "超过了这张发票" in err:` 起草被金额上限拦下。
- `if not r["invoice_ok"]:` 前面都没中,但发票号不全。
- `groups: dict[str, list[dict]] = defaultdict(list)` 桶名到运行列表。
- `for r in fails:` `groups[bucket(r, not a.flags_only)].append(r)` 失败的每一行放进一个桶。`--flags-only` 打开时 `use_reason` 是假。
- `for name, items in sorted(groups.items(), key=lambda kv: -len(kv[1])):` 桶按大小从大到小排,`-len` 是倒序的小技巧。
- `Counter(r['root_cause'] for r in items if 'crashed' not in r).most_common()` 桶里各根因各有几个。

</div>

一次运行可能同时犯好几个毛病,这里只归到最靠前的那个桶。这是一个有损的简化,练习 1 会补上「身上所有的毛病」。

先用最偷懒的方式分:只看判分标志,不读原因文字。

```bash
cd /Users/你/billsleuth
uv run python -m billsleuth.evals.buckets runs/v1.jsonl --flags-only
```

```text
失败 5/20

## 转人工  5 次  [('duplicate_invoice', 3), ('quantity_change_ignored', 1), ('proration_wrong_days', 1)]
   - S023 人设 finance 结论 duplicate_invoice 多收 139.05 发票 ['INV-0023-04', 'INV-0023-04D'] 兜底=0
     原因:没有证据能说明贷记单该开在哪张发票上
     推理:9 月周期 2026-09-15~2026-10-15 存在两张发票 INV-0023-04 与 INV-0023-04D，行项目完全相同（入门版 9 席位 × 15.00 = 135.00，税 US-DST3 3% =
   - S041 人设 forgetful 结论 quantity_change_ignored 多收 134.56 发票 ['INV-0041-03'] 兜底=1
     原因:解释由模板兜底,转人工
     推理:客户问的 7 月发票 INV-0041-02(2026-07-15~08-15)经 recompute_invoice 复算:recurring 90.00、tax 2.70、合计 92.70,与实际完全一致,diffe
```

5 个失败全进了一个桶,「转人工」。这个桶对「改哪里」毫无帮助:转人工是结果,不是原因。桶分得太粗,说明规则里缺了一层信息,这一层信息就是图在转人工时留下的 `approval_error`。同样的 5 个,读了原因再分:

```bash
uv run python -m billsleuth.evals.buckets runs/v1.jsonl --show 1
```

```text
失败 5/20

## 转人工:证据不能唯一定出该冲哪张  3 次  [('duplicate_invoice', 3)]
   - S023 人设 finance 结论 duplicate_invoice 多收 139.05 发票 ['INV-0023-04', 'INV-0023-04D'] 兜底=0
     原因:没有证据能说明贷记单该开在哪张发票上
     推理:9 月周期 2026-09-15~2026-10-15 存在两张发票 INV-0023-04 与 INV-0023-04D，行项目完全相同（入门版 9 席位 × 15.00 = 135.00，税 US-DST3 3% =

## 转人工:标准答案兑现不了  1 次  [('quantity_change_ignored', 1)]
   - S041 人设 forgetful 结论 quantity_change_ignored 多收 134.56 发票 ['INV-0041-03'] 兜底=1
     原因:解释由模板兜底,转人工
     推理:客户问的 7 月发票 INV-0041-02(2026-07-15~08-15)经 recompute_invoice 复算:recurring 90.00、tax 2.70、合计 92.70,与实际完全一致,diffe

## 转人工:写作三稿没过,兜底  1 次  [('proration_wrong_days', 1)]
   - S057 人设 forgetful 结论 proration_wrong_days 多收 16.64 发票 ['INV-0057-02'] 兜底=1
     原因:解释由模板兜底,转人工
     推理:客户说 7 月扣了 1860.34，但 7 月发票 INV-0057-03 总额 1164.12，recompute 显示 difference 0.00、successful_payments=1、无同期其他发票，7 
```

三个桶:证据不能唯一定出该冲哪张(3 次,全是 `duplicate_invoice`)、标准答案兑现不了(1 次)、写作三稿没过(1 次)。同时,没有一个失败落在「判断错」「客户版有问题」「误冲正」这三个最该担心的桶里。这是好消息,但先别急着高兴,每个桶都要读原文,看规则分得对不对。

## 崩溃和网络:0 次

旧课里的 Day 128 在这一步有一个小节叫「崩溃/网络 1 次」:冒烟的 16 次运行里唯一的失败是厂商排队超时,它说明**最大的桶往往不是 Agent 的问题,而是基础设施的问题**。今天这 20 次运行没有一次崩溃(报告里「崩溃 0」),所以这个桶是空的。昨天故意制造的两次崩溃(假 key、`BrokenProcessPool`)是演示用的,记录在 `runs/crash_demo.jsonl`,没有混进 `v1.jsonl`。

但这个桶仍然留在 `bucket()` 的第一行。如果它有一天出现了,不把崩溃单独分出来,它会混进「根因判断错」里,你会去改一个根本没错的提示词。

## 读桶一:重复开票,三个场景全是转人工

S023、S064、S048 的推理(`reasoning`)都读下来,模型的判断都是对的。S023 的是这样:

```text
9 月周期 2026-09-15~2026-10-15 存在两张发票 INV-0023-04 与 INV-0023-04D,行项目完全相同……
recompute_invoice 对两张都返回 difference 0.00,但 other_invoices_same_period 互相指向对方,提示重复开票。
list_payments 显示 PAY-0023-04 与 PAY-0023-04D 均为 succeeded、各 139.05、同一时间 2026-09-15T02:00:00Z,即该周期被扣款两次。多收金额 = 139.05(重复的那一张)。
```

根因、金额、两张发票、动作全对,客户版也写得清楚(「9 月这个计费周期被重复开票并重复扣款,多收金额为 139.05 美元」)。失败的原因在后面:图要起草贷记单,`credit_target` 要决定开在哪张发票上,返回了 `None`,`approval_error` 写着「没有证据能说明贷记单该开在哪张发票上」。

为什么是 `None`?Day 691 的 `credit_target` 有两条规则:一是某张发票有「多收」证据且值等于结论金额;二是重复扣款(`duplicate_charge`)时,同一张发票有两笔以上成功扣款。读到这里我先有一个猜测:重复开票(`duplicate_invoice`)两条都不满足。写个脚本,拿 S023 的证据对一遍,不调模型:

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="重复开票的两张发票并排比较:INV-0023-04 和 INV-0023-04D 的开具日期、状态、行项目、扣款时间都相同,只有发票号末尾的 D 不同">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">S023:数据看不出哪张是多开的</text>
  <rect x="20" y="42" width="250" height="150" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="32" y="64" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">INV-0023-04</text>
  <text x="32" y="88" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">issued_at 2026-09-15</text>
  <text x="32" y="108" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">status paid</text>
  <text x="32" y="128" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">135.00 + 税 4.05 = 139.05</text>
  <text x="32" y="148" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">扣款 02:00:00Z succeeded</text>
  <text x="32" y="176" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">多收(复算) 0.00</text>
  <rect x="370" y="42" width="250" height="150" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="382" y="64" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">INV-0023-04D</text>
  <text x="382" y="88" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">issued_at 2026-09-15</text>
  <text x="382" y="108" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">status paid</text>
  <text x="382" y="128" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">135.00 + 税 4.05 = 139.05</text>
  <text x="382" y="148" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">扣款 02:00:00Z succeeded</text>
  <text x="382" y="176" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">多收(复算) 0.00</text>
  <text x="320" y="116" text-anchor="middle" font-family="var(--font-mono)" font-size="22" fill="var(--ink-soft)">=</text>
  <text x="320" y="140" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">一模一样</text>
  <text x="20" y="216" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">只有末尾的 D 不同,那是造数脚本的内部约定,真实系统里没有这个信息。</text>
  <text x="20" y="236" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">标准答案要冲 04D:Agent 没有任何依据,只能转人工。</text>
</svg>
<figcaption>S023 的两张发票并排。复算、开具日期、状态、行项目和扣款时间戳全部一样,标准答案却要求贷记单开在带 D 的那张上。</figcaption>
</figure>

```python
# billsleuth/scratch/why_none.py  重复开票:为什么 credit_target 返回 None?用 S023 的证据对一遍
import json
import sys

from billsleuth import evidence as ev
from billsleuth.credit import credit_target
from billsleuth.evals.scenarios import load_all, truth
from billsleuth.mcp_bridge import BillingMCP

sid = sys.argv[1] if len(sys.argv) > 1 else "S023"
sc = next(s for s in load_all() if s["id"] == sid)
t, cid, mcp, items = truth(sc), sc["customer_id"], BillingMCP(in_process=True), []
target = t["invoice_ids"][0]
related = [target[:-1], target]                              # 原发票和多开的那张:INV-0023-04, INV-0023-04D
for inv_id in related:
    ok, data = mcp.call("recompute_invoice", {"invoice_id": inv_id})
    items += ev.extract("recompute_invoice", {"invoice_id": inv_id}, data)
ok, pays = mcp.call("list_payments", {"customer_id": cid})
items += ev.extract("list_payments", {}, [p for p in pays if p["invoice_id"] in related])
evidence = ev.number(items, 1)
print("和「多收」有关的证据:")
for e in evidence:
    if "多收" in e["claim"] or e["claim"].startswith("扣款"):
        print(f"  {e['id']:4s} {e['claim'][:60]:60s} 值 {e['value']}")
f = {"root_cause": "duplicate_invoice", "invoice_ids": related, "overcharge": t["overcharge"]}
print("credit_target →", credit_target(f, evidence), "  标准答案要冲的是", target)
for inv_id in related:
    ok, inv = mcp.call("get_invoice", {"invoice_id": inv_id})
    print(f"  {inv_id}: issued_at={inv['issued_at']} status={inv.get('status')} 行数={len(inv['lines'])}")
```

<div class="line-notes">

- `sid = sys.argv[1] if len(sys.argv) > 1 else "S023"` 命令行第一个参数当场景号,不给就是 S023。`sys.argv` 相当于 Node 的 `process.argv`。
- `t, cid, mcp, items = truth(sc), sc["customer_id"], BillingMCP(in_process=True), []` 标准答案、客户号、进程内的工具层、证据列表,一行解构赋值。
- `related = [target[:-1], target]` 标准答案里的发票是多开的那张 `INV-0023-04D`,去掉最后一个字符得到原发票 `INV-0023-04`,两张都要查。
- `ok, data = mcp.call("recompute_invoice", {"invoice_id": inv_id})` 和图里 `tools` 节点调的是同一个工具,结果一样。
- `items += ev.extract("recompute_invoice", {"invoice_id": inv_id}, data)` 把复算结果抽成证据,和调查图里一模一样的抽法。
- `ok, pays = mcp.call("list_payments", {"customer_id": cid})` 查这个客户全部扣款,下一行只留这两张发票的。
- `evidence = ev.number(items, 1)` 从 E1 开始编号。
- `if "多收" in e["claim"] or e["claim"].startswith("扣款"):` 只打印和多收、扣款有关的证据,太多会看不过来。
- `f = {"root_cause": "duplicate_invoice", "invoice_ids": related, "overcharge": t["overcharge"]}` 假设模型的结论完全正确:根因对、两张发票都写上、金额对。只看 `credit_target` 能不能定出一张。
- `print("credit_target →"` 直接调 Day 691 的函数。
- `ok, inv = mcp.call("get_invoice", {"invoice_id": inv_id})` 再看两张发票本身有没有可以区分的地方。

</div>

```bash
uv run python -m scratch.why_none
```

```text
和「多收」有关的证据:
  E3   INV-0023-04 多收(实际 - 应收)                                      值 0.00
  E18  INV-0023-04D 多收(实际 - 应收)                                     值 0.00
  E31  扣款 PAY-0023-04(succeeded,2026-09-15T02:00:00+00:00)          值 139.05
  E32  扣款 PAY-0023-04D(succeeded,2026-09-15T02:00:00+00:00)         值 139.05
credit_target → None   标准答案要冲的是 INV-0023-04D
  INV-0023-04: issued_at=2026-09-15 status=paid 行数=2
  INV-0023-04D: issued_at=2026-09-15 status=paid 行数=2
```

猜测对了一半,另一半比猜测更有意思。对了的一半:两张发票的「多收」证据(`E3`、`E18`)值都是 0.00,因为单看任何一张,金额都和参考引擎一致;没有一条证据写着「多收 139.05」。没对的一半:我原来以为证据里至少有某些细节能区分两张发票。没有。两张发票的 `issued_at` 都是 `2026-09-15`,状态都是 `paid`,行项目一样,两笔扣款的时间戳也一样,精确到秒。唯一的区别是发票号末尾多了一个 `D`,那是造数脚本用来标记「这张是我多开的」的约定,真实系统里没有这个信息。

也就是说,标准答案要求「贷记单开在 `INV-0023-04D` 上」,可数据里没有任何东西能告诉 Agent 哪张是多的。Agent 拿到的是两张一模一样的发票,**冲哪一张在数据上是等价的**。Day 691 把规则改成「证据不唯一就转人工」是对的,换成「随便选一张」才是赌博。

所以这三个失败的真正归属是:**评测定义的问题,不是 Agent 的问题**。判分器说「转人工不算成功」,图说「证据不唯一就必须转人工」,两条规则对 `duplicate_invoice` 这一类场景直接冲突:不管 Agent 多聪明,都不可能成功。100 个场景里这一类有 7 个。怎么改(接受两张中的任何一张?把「转人工」算成对的结果?)是明天的事,今天只记下来。

## 读桶二:写作兜底,为什么三稿都没过

S057 的推理读到这里很容易让人高兴:

```text
客户说 7 月扣了 1860.34,但 7 月发票 INV-0057-03 总额 1164.12,recompute 显示 difference 0.00 ……7 月账目无误。
客户记的 1680.34 实际是 6 月发票 INV-0057-02……difference 16.64……实际折算按 30 天分母……多收合计 16.64。
```

客户把 1680.34 记成了 1860.34(两个数字对调),月份也记错了。Agent 先查了客户说的 7 月,没问题,又顺着金额猜出客户记混了,找到了 6 月那张,判断完全正确。可是最终客户看到的是:

```text
您好,我们核对了发票 INV-0057-02,确认多收了 16.64 美元。已提交更正申请,审核通过后会把多收的金额退回或抵扣,处理结果会邮件通知您。
```

这是模板,内部说明写着「模板兜底:模型 3 稿都没写出合格解释」。写作循环最多写 3 稿,每稿过 `grounding.check`,三稿都没过才兜底。为什么没过?`runs/v1.jsonl` 没有保存每一稿的问题,我不知道。猜测:客户原话里有 1860.34,写作的提示词里带着客户原话,模型想礼貌地回应「您提到的 1860.34」,而这个数在证据里不存在,溯源检查把它当成编造的数字。

这个猜测可以验证,但需要重放写作这一步。我写了个脚本:用运行记录里的客户原话和结论,重新从库里抽证据(近似还原,和当时的证据不完全一样),再调用同一个 `explain`,把每一稿的问题打印出来。这是今天唯一花钱的地方:

```python
# billsleuth/scratch/replay_writer.py  只重放「写解释」这一步:用运行记录里的客户原话和结论,重新抽证据,看三稿各自卡在哪
import json
import sys

from billsleuth import evidence as ev
from billsleuth.evals.usage import meter
from billsleuth.explain import explain
from billsleuth.graph import Intake  # noqa: F401  (确认和调查图用的是同一套模块)
from billsleuth.llm import get_llm
from billsleuth.mcp_bridge import BillingMCP
from billsleuth.evals.scenarios import load_all

sid = sys.argv[1]
row = next(json.loads(ln) for ln in open("runs/v1.jsonl", encoding="utf-8") if json.loads(ln)["scenario"] == sid)
sc = next(s for s in load_all() if s["id"] == sid)
cid, mcp, items = sc["customer_id"], BillingMCP(in_process=True), []
ok, invs = mcp.call("list_invoices", {"customer_id": cid, "limit": 24})
items += ev.extract("list_invoices", {}, invs)
for inv_id in row["got_invoices"] + [i["id"] for i in invs[:2]]:       # 结论里的发票,加最新两张
    ok, data = mcp.call("recompute_invoice", {"invoice_id": inv_id})
    items += ev.extract("recompute_invoice", {"invoice_id": inv_id}, data) if ok else []
evidence = ev.number(items, 1)
findings = {"root_cause": row["got_root_cause"], "invoice_ids": row["got_invoices"], "overcharge": row["got_overcharge"],
            "expected_action": row["got_action"], "reasoning": row["reasoning"]}
print(f"客户原话:{row['opening']}\n证据 {len(evidence)} 条")
with meter() as m:
    out = explain(get_llm(), row["opening"], findings, evidence)
print(f"兜底={out['fallback']},写了 {len(out['attempts'])} 稿,约 ¥{m.cost:.4f}")
for n, a in enumerate(out["attempts"], start=1):
    for p in a["problems"]:
        print(f"  第 {n} 稿:{p[:150]}")
print("最终客户版:", out["customer_message"][:200])
```

<div class="line-notes">

- `sid = sys.argv[1]` 场景号,今天用 S057。
- `row = next(json.loads(ln) for ln in open("runs/v1.jsonl", encoding="utf-8") if json.loads(ln)["scenario"] == sid)` 在结果文件里找到这个场景那一行。`next(生成器)` 取第一个满足条件的。
- `sc = next(s for s in load_all() if s["id"] == sid)` 同样的写法找场景。场景里只用 `customer_id`,不碰标准答案。
- `ok, invs = mcp.call("list_invoices", {"customer_id": cid, "limit": 24})` 和图里 `locate` 节点一样先取发票列表。
- `for inv_id in row["got_invoices"] + [i["id"] for i in invs[:2]]:` 结论里的发票加上最新两张,各做一次复算。S057 是 6 月的 `INV-0057-02` 加最新的两张(其中有 7 月那张)。
- `evidence = ev.number(items, 1)` 编号。输出里显示 55 条。真实运行当时的证据可能略有出入,所以这是「近似还原」。
- `findings = {"root_cause": row["got_root_cause"]` 结论直接用运行记录里 Agent 当时交的。
- `with meter() as m:` 数这一步花多少钱。
- `out = explain(get_llm(), row["opening"], findings, evidence)` 调 Day 689 的写作循环。`row["opening"]` 就是那段带着错误金额的客户原话。
- `for n, a in enumerate(out["attempts"], start=1):` 逐稿打印校验器报的问题。`enumerate(…, start=1)` 让序号从 1 开始。

</div>

```bash
uv run python -m scratch.replay_writer S057
```

```text
客户原话:你好，我们 7 月账单扣了 1860.34 美元，比我预想的多不少，能帮我看看是不是算错了吗？
证据 55 条
兜底=True,写了 3 稿,约 ¥0.0402
  第 1 稿:金额 1860.34 在证据里找不到出处:需要先说明一下账单期：您提到的 1860.34 美元，我们账上 7 月这一期的发票金额是 1164.12 美元 [E4]，这一期核对下来没有多收 [E30]。
  第 1 稿:金额 1860.34 在证据里找不到出处:- 客户口述 1860.34 与账上不符；
  第 1 稿:金额 1860.34 在证据里找不到出处:注意客户口述的 1860.34 与任何发票都不匹配，回复中已澄清为 6 月期 1680.34 [E5]，避免按 1860.34 计算。
  第 1 稿:金额 1860.34 在证据里找不到出处:注意客户口述的 1860.34 与任何发票都不匹配，回复中已澄清为 6 月期 1680.34 [E5]，避免按 1860.34 计算。
  第 2 稿:金额 1860.34 在证据里找不到出处:先说明一下账单期：您提到的 1860.34 美元，我们账上 7 月这一期的发票金额是 1164.12 美元 [E4]，这一期核对下来没有多收 [E30]。
  第 2 稿:金额 1860.34 在证据里找不到出处:关键点：客户口述 1860.34 与任何发票都不匹配，勿按其计算。
  第 3 稿:金额 1860.34 在证据里找不到出处:- 客户口述「7 月扣 1860.34」与任何发票均不匹配，勿按其计算。
最终客户版: 您好,我们核对了发票 INV-0057-02,确认多收了 16.64 美元。已提交更正申请,审核通过后会把多收的金额退回或抵扣,处理结果会邮件通知您。
```

读这几行,猜测被证实了,而且比猜测更具体:

- 三稿的每一条问题都是同一个数:`金额 1860.34 在证据里找不到出处`。
- 第 1 稿写的是「您提到的 1860.34 美元,我们账上 7 月这一期的发票金额是 1164.12 美元 [E4],这一期核对下来没有多收 [E30]」。**这是一句好话**:先复述客户说的数,再澄清账上是多少。校验器拦了它。
- 校验器连**内部说明**里写的「客户口述 1860.34 与任何发票都不匹配,勿按其计算」也拦了。这句话没有断言 1860.34 是真的,恰恰是在说它不是。
- 三稿都带着问题清单重写,但模型每次还是要复述客户说的数,因为这样才回答得了客户,所以三稿都没过,落到兜底。

这是校验器的问题,不是模型的问题。Day 688 写 `grounding.check` 的时候,规则是「文字里的每个金额都要有出处」,没想过客户自己说的数也会出现在回复里。

这个问题在全部 20 次运行里是孤立的,还是有规律?再写一个不花钱的脚本:对每次运行,看客户开场白里出现的金额有没有哪个在这个客户的账里根本不存在(发票总额和行项目金额),再和「兜底」对一对:

```python
# billsleuth/scratch/opening_vs_books.py  客户开场白里的金额,有几个在这个客户的账里根本不存在?和「写作兜底」对一对
import json
import re
import sqlite3

conn = sqlite3.connect("runs/v1.master.db")
rows = [json.loads(ln) for ln in open("runs/v1.jsonl", encoding="utf-8")]
tally = {True: [0, 0], False: [0, 0]}          # {开场白有账里没有的金额: [运行数, 兜底数]}
for r in rows:
    cid = "C-" + r["scenario"][1:].zfill(4)    # S057 → C-0057(造数时一个场景一个客户)
    books = {x[0] for x in conn.execute(
        "SELECT total FROM invoices WHERE customer_id = ? UNION SELECT l.amount FROM invoice_lines l "
        "JOIN invoices i ON i.id = l.invoice_id WHERE i.customer_id = ?", (cid, cid))}
    said = re.findall(r"\d+\.\d{2}", r["opening"])
    ghost = [a for a in said if a not in books]
    tally[bool(ghost)][0] += 1
    tally[bool(ghost)][1] += r["fallback"]
    if ghost:
        print(f"{r['scenario']} {r['persona']:9s} 开场白里的 {ghost} 在账里不存在  兜底={r['fallback']}")
print(f"开场白里有「账里没有的金额」: {tally[True][0]} 次运行,其中兜底 {tally[True][1]} 次")
print(f"开场白里的金额都对得上:        {tally[False][0]} 次运行,其中兜底 {tally[False][1]} 次")
```

<div class="line-notes">

- `conn = sqlite3.connect("runs/v1.master.db")` 直接用评测冻结的母版库,那就是 Agent 当时看到的账。
- `tally = {True: [0, 0], False: [0, 0]}` 两个分组:开场白里「有账里没有的金额」(True)和「没有」(False),每组记两个数:运行次数、其中兜底的次数。
- `cid = "C-" + r["scenario"][1:].zfill(4)    # S057 → C-0057` 造数时一个场景一个客户,客户号和场景号数字相同。`"057".zfill(4)` 在左边补零补到 4 位,`"0057"`。
- `books = {x[0] for x in conn.execute(` 这个客户所有发票总额和所有行项目金额的集合。`UNION` 把两个查询的结果合在一起并去重,集合推导式相当于 JS 的 `new Set(rows.map(...))`。
- `said = re.findall(r"\d+\.\d{2}", r["opening"])` 开场白里所有带两位小数的数。
- `ghost = [a for a in said if a not in books]` 客户说了、账里却不存在的金额,我叫它「幽灵金额」。
- `tally[bool(ghost)][1] += r["fallback"]` 按有没有幽灵金额分组,累加兜底次数。

</div>

```bash
uv run python -m scratch.opening_vs_books
```

```text
S041 forgetful 开场白里的 ['97.20'] 在账里不存在  兜底=1
S055 forgetful 开场白里的 ['1201.13'] 在账里不存在  兜底=1
S057 forgetful 开场白里的 ['1860.34'] 在账里不存在  兜底=1
开场白里有「账里没有的金额」: 3 次运行,其中兜底 3 次
开场白里的金额都对得上:        17 次运行,其中兜底 0 次
```

3 次运行的开场白里有幽灵金额,3 次全部兜底;另外 17 次开场白金额都对得上,没有一次兜底。S041 的 97.20、S055 的 1201.13、S057 的 1860.34,都是「记性不好」那个人设把金额改了的。这个相关性在 20 个样本里是 3/3 对 0/17,很强,但样本小,而且这个人设本来就是故意制造幽灵金额的,所以只能说:**客户把金额记错的时候,写作循环几乎一定会兜底**,至于真实客户记错金额有多常见,今天没有数据。

这里还有一层要注意。S055 也兜底了,但它是「账没错」的场景,判分器认为成功,所以不在失败里,在今天后面「成功的运行也要读」里再说。

## 读桶三:S041,兜底下面还藏着一层

S041 进了「标准答案兑现不了」桶,而不是「兜底」桶,这是 `bucket()` 里把 `uncashable` 放在 `模板兜底` 之前的结果。但它身上其实有两个毛病,`approval_error` 只记了先碰到的那个:

- 兜底:客户说「7 月收了我 97.20」,账里没有这个数,和 S057 同一个原因。
- 兑现不了:就算兜底修好了,往下走到起草贷记单,134.56 超过发票总额 92.70,Day 693 在 S041 上试过,代码会拒绝。

所以修好校验器以后,S041 仍然不会成功。这就是分桶优先级的意义:把「修了也没用」的原因排前面,不会让你以为修好某处就能涨一分。练习 1 会把每个失败身上所有的毛病都列出来。

## 成功的运行也要读

失败的桶读完了,没有一个是模型判断错。这不说明 Agent 没问题:样本只有 20 个,而且判分器看的是结论、金额、贷记单和客户版里的数字,它**看不见的东西**才是成功的运行里最值得读的。

读成功的运行,我先用关键词捞(客户版里有没有「会退」「原路」「保证」这类结果承诺),再人工读捞出来的:

```python
# billsleuth/scratch/read_successes.py  成功的运行也要读:判分器看不见的措辞问题,先用关键词捞出来再人工读
import json
import re

PROMISE = re.compile(r"会退|原路|退给您|退到您|一定|确保|保证")      # 客户版里不该有的结果承诺
rows = [json.loads(ln) for ln in open("runs/v1.jsonl", encoding="utf-8")]
hits = [(r, m) for r in rows for m in PROMISE.finditer(r["reply"])]
seen = set()
for r, m in hits:
    if r["scenario"] in seen:
        continue
    seen.add(r["scenario"])
    ctx = r["reply"][max(0, m.start() - 24): m.end() + 36].replace("\n", " ")
    print(f"{r['scenario']} {'成功' if r['success'] else '失败'} {r['turns']}轮 人设 {r['persona']}:...{ctx}...")
ok = [r for r in rows if r["success"]]
bad_ok = {r["scenario"] for r, _ in hits if r["success"]}
print(f"\n15 个成功的运行里,客户版出现结果承诺的 {len(bad_ok)} 个:{sorted(bad_ok)}")
print("成功但客户版是模板兜底的:", [r["scenario"] for r in ok if r["fallback"]])
print("追问之后才出现承诺的:", sorted(s for s in bad_ok if next(r for r in rows if r["scenario"] == s)["turns"] == 2))
```

<div class="line-notes">

- `PROMISE = re.compile(r"会退|原路|退给您|退到您|一定|确保|保证")` 客户版里不该有的结果承诺。Day 688 的写作规则是只能说「已提交更正申请,审核通过后会退回或抵扣」,不能承诺结果和方式。`|` 是「或」。
- `hits = [(r, m) for r in rows for m in PROMISE.finditer(r["reply"])]` 每一行的客户版里所有匹配,两层循环写在一个列表推导式里。
- `seen = set()` 一个场景只打印一次,避免同一段话命中好几个词重复刷屏。
- `ctx = r["reply"][max(0, m.start() - 24): m.end() + 36].replace("\n", " ")` 取匹配位置前 24 个字、后 36 个字当上下文,`max(0, …)` 防止开头越界。
- `ok = [r for r in rows if r["success"]]` 成功的运行。
- `bad_ok = {r["scenario"] for r, _ in hits if r["success"]}` 成功、但客户版里有承诺措辞的场景集合。
- `next(r for r in rows if r["scenario"] == s)["turns"] == 2` 看这些承诺是不是出在有追问的运行里。

</div>

```bash
uv run python -m scratch.read_successes
```

```text
S064 失败 1轮 人设 angry:...核实结果：确实多收了您 163.50 美元，这笔会退还给您。  原因是 9 月那个计费周期（2026-09-02 至 202...
S013 成功 2轮 人设 angry:...心的两点：这笔钱确实多收了 125.15 美元，会退给您；退款方式是按原路退回您当时付款的那张卡对应的账户，如果原路退回不成...
S096 成功 2轮 人设 angry:...关心的三点：这笔钱确实多收了 10.30 美元，会退；退到您原来的付款账户，以退回或抵扣账单的形式；具体到账时间要看审核进度...

15 个成功的运行里,客户版出现结果承诺的 2 个:['S013', 'S096']
成功但客户版是模板兜底的: ['S055']
追问之后才出现承诺的: ['S013', 'S096']
```

读 S013 的客户版:

```text
您好,先回答您最关心的两点:这笔钱确实多收了 125.15 美元,会退给您;退款方式是按原路退回您当时付款的那张卡对应的账户,如果原路退回不成功,会改为在后续账单里抵扣,具体以审核结果为准。
```

「会退给您」是承诺结果,「按原路退回……那张卡」是承诺方式,系统其实根本不知道钱会走哪条路。这段话出现在**客户追问**之后:激动的客户问「多收的钱到底退不退、退到哪个账户」,Agent 想给一个「明确说法」,就越界了。S096 同样:「会退;退到您原来的付款账户」。而 S034 在同样的追问下(客户问「审核通过要多久,钱具体退到哪个账户」)答得很好:「这些我这边确实无法给出具体时间,也不能指定退到哪个账户,需要以审核结果和系统实际处理为准」。

为什么判分器没抓到?`grounding.check` 的客户版规则里有一张禁用词清单(`BANNED`),里面有「一定会退」「已退款」,没有「会退」「原路」。这不是模型的问题,是清单漏了。这两个都判成功了,但客户版其实违反了 Day 688 的写作规则。

再读 S055(成功,账没错,有追问)。客户追问「你们说金额没错,但具体明细还没给我」,最终客户收到的是:

```text
您好,我们核对了发票 INV-0055-03、INV-0055-04,金额按规则计算没有错误。具体明细我们的同事会再跟您说明。
```

这是模板。这次兜底也是因为开场白里那个幽灵金额 1201.13(实际是 1021.13)。判分器说成功,因为账确实没错、也确实说了没错;可客户追问的是明细,得到的却是「同事会再跟您说明」。对比同一批里 S073,客户追问「请给我一份能拿去对账的说明」,Agent 答了发票号、两个行项目、小计和税,清清楚楚。

还要补一句我查过但没问题的:S001 的客户版说「取消申请在 2026-09-08 已经生效」。判分器和溯源校验器只查金额和百分比,不查日期,我就去库里查了订阅事件,`cancel` 事件确实是 `2026-09-08T03:50:00+00:00`,对。这一条是对的,但日期没有任何自动检查,这是另一个盲区,今天先记下。

数一下:15 个成功里,有 3 个并不好(S013、S096 承诺了退款方式,S055 收到模板),都是判分器看不见的。

## 数:汇成一张分桶表

读完了,才数。下面这张表是今天的产物,每一行要回答三件事:几个、改哪里、是谁的问题。

| 桶 | 次数 | 场景 | 改哪里 | 是谁的问题 |
| --- | --- | --- | --- | --- |
| 转人工:证据不能唯一定出该冲哪张 | 3 | S023、S064、S048 | 评测定义:两张发票数据上等价,标准答案要的那张只靠号码后缀 | 评测定义和标准答案 |
| 转人工:写作三稿没过 | 1(S057) | S057,S041 也有 | `grounding.check`:客户自己说的金额不该算编造 | 校验器 |
| 转人工:标准答案兑现不了 | 1 | S041(100 个里还有 S083) | 数据:标准答案的金额超过发票总额 | 数据 |
| 成功但客户版承诺了退款方式 | 2 | S013、S096(追问后) | `BANNED` 清单加词,或加一条语义检查 | 校验器 |
| 成功但客户版是模板 | 1 | S055 | 同「写作三稿没过」 | 校验器 |
| 崩溃/网络 | 0 | — | — | — |
| 判断错、误冲正、编数字 | 0 | — | — | — |

从这张表里读出几件事。

**5 个失败里 0 个是 Agent 判断的问题。** 3 个是评测定义(重复开票),1 个是数据(兑现不了),1 个是校验器(S057)。如果这三类都修好,按今天的读法预测:S057 会成功,3 个重复开票如果改成接受两张中的任何一张也会成功,S041 仍然失败,15 加 4 等于 19/20。这是**预测,不是实测**,明天改完要重跑才知道。

**成功的 15 个里 3 个有问题。** 严格一点,只数我读过之后认为「真的好」的,是 12/20 = 60%,95% 区间 [38.7%, 78.1%]。注意这个 12 是我人工读出来的,不是自动判出来的,区间也很宽。

**按现在的成功定义,100 个场景里有多少个根本不可能成功?** 重复开票 7 个加兑现不了的 2 个,共 9 个,成功率上限是 91%(练习 4)。这个上限比报告里的任何数字都值得先知道。

**样本局限。** 这 20 个是分层抽样的 14 组,每个只跑了 1 次;「记性不好」这一档的 4 次运行里 3 次兜底、成功 1 次,但这一档只有 4 次;比较各桶的大小更没有意义,3 次 `duplicate_invoice` 只有一个原因,不是三个独立的证据。今天读出来的是**原因**,不是**比例**。比例要等全量评测。

**为什么只读了不改。** 今天读出了三类问题(评测定义、校验器、数据),它们的改法互相独立。一次只改一处,改完再跑,明天开始。

## 今天的文件

| 文件 | 做什么 |
| --- | --- |
| `billsleuth/evals/buckets.py` | 失败分桶,`bucket()` 和命令行 |
| `scratch/why_none.py` | 重复开票为什么 `credit_target` 返回 `None` |
| `scratch/replay_writer.py` | 重放写作步骤,看每一稿的问题(花钱,约 ¥0.04) |
| `scratch/opening_vs_books.py` | 开场白金额和账对一对,与兜底做相关 |
| `scratch/read_successes.py` | 成功的运行里捞结果承诺措辞 |
| `scratch/ex1_all_flags.py`、`ex3_cost_by_turns.py`、`ex4_ceiling.py` | 练习 1、3、4 |
| `tests/test_buckets.py` | 3 条测试(练习 2) |

测试总数 372 条(Day 694 的 369 加 3 条),全绿。

今天真模型花费(`deepseek-flash`):只有 `replay_writer.py` 重放 S057 写作步骤,3 稿,输出里写的 ¥0.0402。三天合计:Day 693 约 ¥0.1555,Day 694 ¥1.7371,Day 695 ¥0.0402,总共 ¥1.9328,在 ¥2 预算内。

## 动手练习

**练习 1:一个失败可能不止一个毛病,把每个失败身上所有的毛病都列出来。** 对 5 个失败,除了 `bucket()` 给的那个桶,再列出所有成立的毛病(标准答案兑现不了、写作兜底、证据不能唯一定出该冲哪张)。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex1_all_flags.py  练习 1:一个失败可能不止一个问题。把每个失败身上所有的毛病都列出来,不只看进了哪个桶
import json

from billsleuth.evals.buckets import bucket

for ln in open("runs/v1.jsonl", encoding="utf-8"):
    r = json.loads(ln)
    if r["success"]:
        continue
    problems = []
    if r["uncashable"]:
        problems.append("标准答案兑现不了")
    if r["fallback"]:
        problems.append("写作兜底")
    if "没有证据能说明" in (r["approval_error"] or ""):
        problems.append("证据不能唯一定出该冲哪张")
    print(f"{r['scenario']} 进的桶:{bucket(r)}")
    print(f"      身上的毛病:{problems}")
```

<div class="line-notes">

- `from billsleuth.evals.buckets import bucket` 复用今天写的分桶函数。
- `if r["success"]:` `continue` 只看失败的行,成功的跳过。
- `if r["uncashable"]:` 数据层面的标记,和流程无关,不看原因文字就能知道。
- `if r["fallback"]:` 兜底的标志是 `fallback`,不是 `approval_error` 里的文字,因为 S041 的 `approval_error` 先记了兜底,但 `uncashable` 在 `bucket()` 里排在前面。
- `if "没有证据能说明" in (r["approval_error"] or ""):` 注意 `approval_error` 可能是 `None`,先 `or ""` 再用 `in`,否则 `None` 上做 `in` 会报 `TypeError`。
- `print(f"{r['scenario']} 进的桶:{bucket(r)}")` 一个失败打两行:进了哪个桶、身上有哪些毛病。

</div>

```bash
uv run python -m scratch.ex1_all_flags
```

```text
S023 进的桶:转人工:证据不能唯一定出该冲哪张
      身上的毛病:['证据不能唯一定出该冲哪张']
S041 进的桶:转人工:标准答案兑现不了
      身上的毛病:['标准答案兑现不了', '写作兜底']
S064 进的桶:转人工:证据不能唯一定出该冲哪张
      身上的毛病:['证据不能唯一定出该冲哪张']
S048 进的桶:转人工:证据不能唯一定出该冲哪张
      身上的毛病:['证据不能唯一定出该冲哪张']
S057 进的桶:转人工:写作三稿没过,兜底
      身上的毛病:['写作兜底']
```

只有 S041 身上有两个毛病,其余各一个。这就是为什么 `bucket()` 优先级要把「修了也没用」的原因排在前面:S041 的写作兜底修好以后,它还会被「金额超过实际扣款」拦下来。如果只看桶,你不知道它还藏着一层。

</details>

**练习 2:给 `bucket()` 写测试,每个桶造一行假数据;再把「兑现不了」的判断挪到「兜底」后面,看哪条红。**

<details><summary>参考答案</summary>

```python
# billsleuth/tests/test_buckets.py  分桶函数:每个桶造一行假数据,再测优先级
from billsleuth.evals.buckets import bucket

OK = {"root_ok": 1, "overcharge_ok": 1, "action_ok": 1, "invoice_ok": 1, "bad_reply": 0, "wrong_credit": 0,
      "missed_credit": 0, "escalated": 0, "fallback": 0, "uncashable": 0, "approval_error": None}


def row(**kw) -> dict:
    return {**OK, **kw}


def test_each_bucket_has_a_row_that_lands_in_it():
    assert bucket({"crashed": "timeout"}) == "崩溃/网络"
    assert bucket(row(root_ok=0)) == "判断错(根因、金额或动作)"
    assert bucket(row(bad_reply=1)) == "客户版有问题(编数字、承诺)"
    assert bucket(row(wrong_credit=1)) == "误冲正"
    assert bucket(row(escalated=1, approval_error="没有证据能说明贷记单该开在哪张发票上")) == "转人工:证据不能唯一定出该冲哪张"
    assert bucket(row(escalated=1, approval_error="解释由模板兜底,转人工")) == "转人工:写作三稿没过,兜底"
    assert bucket(row(escalated=1, approval_error="冲正金额 1.00 加上……超过了这张发票的实际扣款合计 0.50")) == "转人工:金额超过实际扣款"
    assert bucket(row(escalated=1, approval_error="别的")) == "转人工:其他原因"
    assert bucket(row(invoice_ok=0)) == "发票号不全"


def test_priority_wrong_judgement_beats_everything_and_uncashable_beats_fallback():
    assert bucket(row(root_ok=0, escalated=1, bad_reply=1)) == "判断错(根因、金额或动作)"
    assert bucket(row(escalated=1, uncashable=1, approval_error="解释由模板兜底,转人工")) == "转人工:标准答案兑现不了"


def test_flags_only_mode_lumps_all_escalations():
    assert bucket(row(escalated=1, approval_error="解释由模板兜底,转人工"), use_reason=False) == "转人工"
```

<div class="line-notes">

- `OK = {"root_ok": 1` 一行「全好」的数据:判断都对、没有任何坏标志。其他测试在它的基础上只改一两项。
- `def row(**kw) -> dict:` `**kw` 把传入的关键字参数收成字典,`row(root_ok=0)` 的 `kw` 是 `{"root_ok": 0}`,相当于 JS 里 `(overrides) => ({...OK, ...overrides})`。
- `return {**OK, **kw}` 后面的覆盖前面的。
- `assert bucket({"crashed": "timeout"}) == "崩溃/网络"` 崩溃的行只有几个字段,`bucket` 必须在访问别的字段前就返回。
- `assert bucket(row(root_ok=0)) == "判断错(根因、金额或动作)"` 一次只改一项,检查进的是哪个桶。
- `assert bucket(row(root_ok=0, escalated=1, bad_reply=1))` 一行同时犯三个毛病,必须进优先级最高的「判断错」。
- `assert bucket(row(escalated=1, uncashable=1, approval_error="解释由模板兜底,转人工")) == "转人工:标准答案兑现不了"` 今天读 S041 时定下的规则:兑现不了排在兜底前面。
- `use_reason=False) == "转人工"` 只看标志时,所有转人工都进一个桶,正是第一遍分桶时看到的那个。

</div>

```text
3 passed in 0.02s
```

再破坏一次:把 `bucket()` 里 `if r["uncashable"]:` 那两行挪到 `if "超过了这张发票" in err:` 前面(在兜底判断之后)。跑测试:

```text
E       AssertionError: assert '转人工:写作三稿没过,兜底' == '转人工:标准答案兑现不了'
FAILED tests/test_buckets.py::test_priority_wrong_judgement_beats_everything_and_uncashable_beats_fallback
1 failed, 2 passed in ...
```

只有专门测优先级的那条红,而且直接告诉你 S041 这样的行会被分到错的桶。改回去,372 条全绿。

</details>

**练习 3:有追问的运行是不是真的比没追问的贵一倍?** 按 `turns` 分组,算平均花费、耗时和输入 token。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex3_cost_by_turns.py  练习 3:有追问的运行,是不是真的比没追问的贵一倍?
import json

rows = [json.loads(ln) for ln in open("runs/v1.jsonl", encoding="utf-8")]
for turns in (1, 2):
    sub = [r for r in rows if r["turns"] == turns]
    cost = sum(r["cost_cny"] for r in sub) / len(sub)
    secs = sum(r["seconds"] for r in sub) / len(sub)
    tok = sum(r["tokens_in"] for r in sub) / len(sub)
    print(f"{turns} 轮:{len(sub):2d} 次运行  平均 ¥{cost:.4f}  {secs:4.1f} 秒  输入 {tok:6.0f} token")
one = [r["cost_cny"] for r in rows if r["turns"] == 1]
two = [r["cost_cny"] for r in rows if r["turns"] == 2]
print(f"2 轮 / 1 轮 = {(sum(two) / len(two)) / (sum(one) / len(one)):.2f} 倍")
```

<div class="line-notes">

- `for turns in (1, 2):` 对一轮和两轮各算一遍。
- `sub = [r for r in rows if r["turns"] == turns]` 按轮数分组。`turns` 是 `run.py` 里记的:有追问就是 2。
- `cost = sum(r["cost_cny"] for r in sub) / len(sub)` 平均花费。`cost_cny` 是 Day 694 的计数器记下来的,包括这次运行里所有模型调用。
- `{len(sub):2d}` 格式化,整数占 2 格宽。
- `print(f"2 轮 / 1 轮 =` 两个平均数相除。

</div>

```bash
uv run python -m scratch.ex3_cost_by_turns
```

```text
1 轮:14 次运行  平均 ¥0.0518  13.8 秒  输入  17897 token
2 轮: 6 次运行  平均 ¥0.1119  27.1 秒  输入  38610 token
2 轮 / 1 轮 = 2.16 倍
```

2.16 倍。原因很直白:追问不是在原来的对话上接着聊,而是把整段对话拼成新的客户原话,**整条调查流水线重跑一遍**(`intake`、查证据、写两份解释)。这个数还有一个含义:模拟客户的追问率每涨 10 个点,全量评测的成本就涨约 11%。报全量预算时要把追问率算进去。另外这 6 个 2 轮的样本很小,「2.16」只代表量级。

</details>

**练习 4:按现在的成功定义,100 个场景里有多少个怎么做都成功不了?成功率上限是多少?**

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex4_ceiling.py  练习 4:按现在的成功定义,100 个场景里有多少个「怎么做都成功不了」?成功率上限是多少?
from billsleuth.evals.scenarios import UNCASHABLE, load_all, truth

scs = load_all()
dup = [s["id"] for s in scs if truth(s)["root_cause"] == "duplicate_invoice"]
stuck = set(dup) | set(UNCASHABLE)
print(f"重复开票 {len(dup)} 个(两张发票数据上一模一样,只有号码后缀 D 不同)")
print(f"兑现不了 {len(UNCASHABLE)} 个:{sorted(UNCASHABLE)}")
print(f"现定义下不可能成功的场景:{len(stuck)} 个,成功率上限 {(len(scs) - len(stuck)) / len(scs):.0%}")
print("重复开票的标准答案要冲的发票:", sorted({truth(s)["invoice_ids"][0][-1] for s in scs if s["id"] in dup}), "(末位字符)")
```

<div class="line-notes">

- `dup = [s["id"] for s in scs if truth(s)["root_cause"] == "duplicate_invoice"]` 所有重复开票的场景号,7 个。
- `stuck = set(dup) | set(UNCASHABLE)` 集合并集:重复开票的 7 个加兑现不了的 2 个,两组没有交集。
- `(len(scs) - len(stuck)) / len(scs)` 剩下的占比,就是理论上能成功的最大比例。
- `{truth(s)["invoice_ids"][0][-1] for s in scs if s["id"] in dup}` 重复开票场景里,标准答案要冲的那张发票号的最后一个字符。集合推导式,如果全是同一个字符就只有一个元素。

</div>

```bash
uv run python -m scratch.ex4_ceiling
```

```text
重复开票 7 个(两张发票数据上一模一样,只有号码后缀 D 不同)
兑现不了 2 个:['S041', 'S083']
现定义下不可能成功的场景:9 个,成功率上限 91%
重复开票的标准答案要冲的发票: ['D'] (末位字符)
```

9 个场景,上限 91%。最后一行说明了 7 个重复开票的标准答案**全都**是后缀 `D` 那张,Agent 要想「蒙对」只能靠号码里的字母,不是靠任何数据。这个上限要写进报告:现在每次跑出来的成功率都带着这个天花板,任何「成功率 95%」的说法,在这个定义下都是不可能的。

</details>

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 错误分析 | 先读失败的记录、再分类、最后才数每类有多少,用来决定该改哪里。例子:今天读 5 个失败 |
| 开放式阅读 | 读的时候不带预设类别,边读边记笔记。顺序反了就只能看到你预想的问题 |
| 分桶 | 把失败的运行按「修的时候改哪里」分成几类。例子:`bucket()` |
| 桶分得太粗 | 一个桶里混着几种不同的改法,对「改哪里」没帮助。例子:5 个失败全是「转人工」 |
| 评测定义的问题 | 判分器的规则让某些场景不可能成功,不是 Agent 的问题。例子:重复开票两张数据等价 |
| 校验器的问题 | 校验规则过严或有漏洞,把对的拦了或把不对的放了。例子:客户口述的金额被当成编造 |
| 幽灵金额 | 客户开场白里的金额,在这个客户的账里根本不存在(客户记错了) |
| 近似还原 | 没保存当时的中间数据,用同样的方法重新算一遍,结果可能略有不同,要写明 |
| 结果承诺 | 客户版里承诺退不退、怎么退、什么时候到。Agent 没有权限,不能说 |
| 假成功 | 判分器判成功,但读原文发现不好。例子:追问后承诺了退款方式 |
| 成功率上限 | 按现在的定义,哪怕 Agent 完美也达不到的最高成功率。今天是 91% |
| 优先级 | 一个失败有多个毛病时,先归哪个桶。原则:先放「修了也没用」的 |

## 常见误区

**读了一遍报告,就开始改提示词。** 今天 5 个失败没有一个是模型判断错。如果直接去改调查的提示词,你会改一个根本没错的地方。

**桶分得太粗还以为分好了。** 第一遍只看判分标志,5 个失败全进「转人工」。转人工是结果,原因要去读图留下的 `approval_error`。

**只读失败,不读成功。** 15 个成功里有 3 个不好:2 个承诺了退款方式、1 个收到模板。判分器看不见的东西,只有读原文才发现。

**读到一个猜测就当结论。** 兜底我猜是客户口述的金额被当编造,只是猜测,重放写作一步、打印每一稿的问题,才证实;再用 20 次运行里 3/3 对 0/17 做了一次相关检查。每个猜测都要有一个能证伪它的小脚本。

**只记录最先碰到的原因。** S041 的 `approval_error` 只记了兜底,可它后面还有金额超限。分桶优先级把「修了也没用」的排前面,同时再列出身上所有的毛病。

**把评测定义的问题当成 Agent 的问题。** 重复开票两张发票在数据上一模一样,标准答案只靠号码后缀 `D` 区分,任何 Agent 都不可能系统性地对。这类场景 100 个里有 7 个,不处理,成功率有天花板。

**拿 20 个样本里的桶大小当比例。** 3 个 `duplicate_invoice` 只有一个原因;「记性不好」4 次里 3 次兜底,只有 4 次。今天读出来的是原因,不是比例。

**读完就动手一起改。** 今天读出三类互相独立的问题,改法也互相独立。一次只改一处,改完再跑,才知道每一处各自值多少。

**没保存中间数据,事后只能猜。** `runs/v1.jsonl` 没存每一稿写作的问题和调查用的证据列表,所以重放只能「近似还原」。评测脚本应该把写作的 `attempts` 和证据一起存下来,明天加上。

## 学习资料

### 文档与文章

- [Hamel Husain · A Field Guide to Rapidly Improving AI Products](https://hamel.dev/blog/posts/field-guide/):错误分析的完整方法:先看数据、自己写分类、做标注工具,40 分钟。今天「先读,再分桶,再数」就是从这里来的。
- [Hamel Husain · Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/):为什么要有评测集而不是凭感觉看几个例子,25 分钟。
- [Anthropic · Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents):讲工具应该返回什么样的信息,今天重复开票的问题归根到底是「工具没给出能区分两张发票的信息」,30 分钟。
- [Anthropic · Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):读「读转录」那部分,30 分钟。
- [Evan Miller · Adding Error Bars to Evals](https://arxiv.org/abs/2411.00640):今天的「样本局限」那一节的延伸阅读,20 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1aaxyz8ELY&p=20&autoplay=0&high_quality=1" title="(中英双语!)吴恩达最新《Agentic AI》大佬亲授智能体教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>(中英双语!)吴恩达最新《Agentic AI》大佬亲授智能体教程,附示例代码!_deeplearning.ai · 第 20 P「2-误差分析与确定后续步骤优先级」,9 分钟;接着看第 21 P「3-更多误差分析示例」(5 分钟)和第 22 P「4-组件级评估」(3 分钟),讲怎么先数每一类错误占多少、再决定先改哪里。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/e2i6JbU2R-s" title="Error Analysis: The Highest ROI Technique In AI Engineering" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hamel Husain · Error Analysis: The Highest ROI Technique In AI Engineering · 演示怎么一条条读 trace、写笔记、归类,英文。</figcaption>
</figure>

### 书籍

- Andrew Ng《Machine Learning Yearning》(deeplearning.ai,2018,免费电子书):讲错误分析的几章,「用 100 个错例估计每类问题的上限」那一套放在 Agent 上依然成立,1 小时。
- Chip Huyen《AI Engineering》(O'Reilly, 2025):评估和迭代的几章,可以对照今天的分桶表读。

### 开源项目与代码

- [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo):开源的提示词和 Agent 回归测试工具,看 README 里「对比两个版本」的用法,30 分钟。
- [sierra-research/tau-bench](https://github.com/sierra-research/tau-bench):看它的结果文件怎么保存每一次运行的完整轨迹,对照我们今天「没存中间数据」的教训。

## 自测

1. 为什么错误分析要「先读、再分类、最后才数」,顺序不能反?

<details><summary>答案</summary>

先定好类别再去数,你只会看到你预想的问题,看不到预想之外的。先读几十条,边读边写笔记,再从笔记里归纳类别,类别才是从数据里长出来的。今天第一遍分桶 5 个全进「转人工」,读了每一条的原因才拆成三类,其中两类是读之前没想到的(评测定义冲突、校验器过严)。

</details>

2. 桶要按「修的时候改哪里」分,不按「错在哪个指标」分。为什么?今天哪里体现了?

<details><summary>答案</summary>

指标告诉你错在哪项,桶要告诉你该动哪块代码。今天 5 个失败按指标看全是 `escalated` 和 `missed_credit`,按改哪里分是三个桶:评测定义、数据、校验器,三者改的是完全不同的地方,而且没有一个要改调查提示词。

</details>

3. S041 的 `approval_error` 只写了「模板兜底」,可修好兜底它还是不会成功。分桶时怎么处理这种情况?

<details><summary>答案</summary>

优先级把「修了也没用」的原因排前面:`uncashable` 放在 `模板兜底` 之前,S041 进「标准答案兑现不了」桶。同时单独写一个脚本列出一个失败身上所有的毛病(练习 1),避免只看到最先碰到的那个。

</details>

4. 判分器说 15 个成功,为什么你读完以后说只有 12 个真的好?剩下 3 个是什么问题?

<details><summary>答案</summary>

S013、S096 在客户追问「钱退不退、退到哪里」之后,客户版写了「会退」「按原路退回」,违反了不能承诺结果和方式的规则,而校验器的禁用词清单里没有这几个词;S055 因为客户开场白里的金额记错,写作三稿都没过校验,客户追问明细时收到的是模板。这三个判分器都看不见。注意 12 是我人工读出来的,区间 [38.7%, 78.1%] 很宽。

</details>

5. 重复开票 3 次失败是 Agent 的问题吗?

<details><summary>答案</summary>

不是。两张发票的行项目、状态、开具日期、扣款时间戳全部一样,只有发票号末尾的 `D` 不同,那是造数脚本的内部约定,真实数据里没有。数据上两张等价,Agent 只能随便选一张,Day 691 改成「证据不唯一就转人工」是对的。问题在评测定义:判分器说转人工不算成功,图说必须转人工,两条规则冲突,这一类场景(100 个里 7 个)不可能成功。

</details>

6. 面试题:你的 Agent 评测成功率 75%,老板问「怎么把它提到 90%」。你第一步做什么?

<details><summary>答案</summary>

不改提示词,先读失败的运行,再分桶再数。把失败按「修的时候改哪里」分桶,每桶读原文,用小脚本验证每个猜测;同时读一部分成功的运行,看判分器看不见的问题。把桶汇成一张表,每一行写清楚几个、改哪里、是谁的问题(Agent、校验器、评测定义、数据)。很可能一部分「失败」根本不是 Agent 的问题,先修评测本身再谈提升。给老板的回答要带样本量和区间,不能只报一个数,并且说明按现在的定义成功率上限是多少。

</details>

## 明天预告

明天是 Day 696 · BillSleuth(十五):组件级评测、改法、回归、判断提升是不是真的。今天读出了三类互相独立的问题:重复开票的评测定义(7 个场景不可能成功)、校验器对客户口述金额的误拦,以及客户版结果承诺的漏检。明天先拿不调模型的组件级评测把每个问题单独量出来(比如把重放写作那一步固定下来),然后一次只改一处、改完跑回归,再讲怎么判断一个提升是不是真的,以及怎么切开发集和留出集,防止对评测集过拟合。预算只剩约 ¥0.07,所以明天的对比以不调模型的组件评测为主,调模型的全量对比留空回填。
