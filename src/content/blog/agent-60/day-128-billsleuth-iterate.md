---
title: 'Day 128 · BillSleuth(七):错误分析与迭代'
description: '拿着 Day 127 的评测结果做错误分析：先把失败自动分桶，再逐桶读样例。冒烟的 15 次运行全对，唯一的「失败」是厂商排队超时，但读成功的运行时发现了真问题：重复开票时贷记单开在哪张，取决于模型列发票号的顺序。写一个不调模型的组件级评测把它量出来(160 次判断开错 7 次),在 recompute_invoice 的返回结构上加 overpaid 和 duplicate_of 两个字段后降到 0。再讲一次只改一处、用 McNemar 判断提升、模型对比，以及怎么切留出集防止对评测集过拟合。'
pubDate: 2026-10-15
regime: none
tags: ['error-analysis', 'evaluation', 'iteration', 'billing', 'agent-60']
series: 'agent-60'
day: 128
lang: 'zh'
---

## 今天要解决的问题

昨天跑出了第一份带置信区间的报告。拿到报告之后，最常见的错误做法是直接开始改提示词：「根因准确率只有 70%,我在提示词里强调一下要仔细判断根因。」改完跑一次，涨了 3 个点，很高兴。然后发现这 3 个点在区间里根本分不出来，也不知道涨在哪、为什么涨。

今天按 Day 51 做 SupportPilot 时的顺序来，但所有判断都要有数据：

1. 用脚本把失败自动分桶，桶的划分对应「改哪里」,而不是对应「错在哪个指标」。
2. 逐桶读样例，读到能说出一句具体原因为止。**成功的运行也要读**,今天最有价值的发现就来自一次成功的运行。
3. 对读出来的问题，写一个不调模型的**组件级评测**把它量化，改之前和改之后各跑一次。
4. 一次只改一处，改完跑回归，和上一版做配对比较，用 McNemar 检验判断提升是不是真的。
5. 切出留出集，只看开发集的错例，最后在留出集上验一次，防止对评测集过拟合。

预计用时 4–6 小时。前置:Day 51(SupportPilot 错误分析)、Day 69(配对比较和 McNemar)、Day 123(工具设计)、Day 126(`credit_target`)、Day 127(评测管道)。

## 先读，再分桶，再数

Hamel Husain 把错误分析叫作 AI 工程里投入产出比最高的事。他的做法是先通读几十条记录，边读边写笔记，再从笔记里归纳类别，最后才去数每类有多少。顺序不能反：先定好类别再去数，你只会看到你预想的问题。

但 100 个场景乘 4 次就是 400 条运行，全部手读不现实。我的做法是两步：先用一个粗的规则脚本把失败分桶，知道大头在哪；然后每个桶读三五条样例，读的时候可能会发现规则分错了，或者一个桶里混着两种原因，再回头改规则。

分桶按「修的时候改哪里」排优先级：

```python
# billsleuth/billsleuth/evals/buckets.py
"""Day 128:把失败的运行按「修的时候改哪里」分桶,再每桶列几条样例。
用法:uv run python -m billsleuth.evals.buckets runs/v1.jsonl [--show 2]"""
from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict


def bucket(r: dict) -> str:
    if "crashed" in r:
        return "崩溃/网络"
    if r["hallucinated"]:
        return "编数字"
    if r["wrong_credit"]:
        return "误冲正" if r["root_cause"] == "no_error" else "冲正金额或发票错"
    if r["escalated"]:
        return "转人工(没给出合格结论)"
    if r["missed_credit"]:
        return "该冲正没冲正"
    if not r["root_ok"] and r["overcharge_ok"] and r["action_ok"]:
        return "钱对、标签错"
    if not r["overcharge_ok"]:
        return "多收金额错"
    if not r["root_ok"]:
        return "根因判断错"
    return "发票号或动作错"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("run")
    ap.add_argument("--show", type=int, default=2)
    a = ap.parse_args()
    rows = [json.loads(ln) for ln in open(a.run) if ln.strip()]
    fails = [r for r in rows if not r.get("success")]
    groups: dict[str, list[dict]] = defaultdict(list)
    for r in fails:
        groups[bucket(r)].append(r)
    print(f"失败 {len(fails)}/{len(rows)}")
    for name, items in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        print(f"\n## {name}  {len(items)} 次")
        for pair, n in Counter(f"{r.get('root_cause')} → {r.get('got_root_cause')}" for r in items
                               if "crashed" not in r).most_common():
            print(f"   {pair}  ×{n}")
        for r in items[: a.show]:
            if "crashed" in r:
                print(f"   - {r['scenario']} t{r.get('trial')} {r['crashed'][:120]}")
                continue
            print(f"   - {r['scenario']} t{r.get('trial')} 结论多收 {r.get('got_overcharge')} 发票 {r.get('got_invoices')}"
                  f" 贷记单 {r.get('credit_notes')}")
            print(f"     推理:{(r.get('reasoning') or '')[:160]}")


if __name__ == "__main__":
    main()
```

一次运行可能同时犯好几个错，归到最靠前的那个桶。编数字最优先，不管别的对不对都必须修；误冲正其次，代价最大；「钱对、标签错」单独拎出来，它的修法(改根因的定义，或者合并类别)和「根因判断错」(推理出了问题)完全不同。

对 Day 127 的冒烟跑一下：

```bash
uv run python -m billsleuth.evals.buckets runs/v1.jsonl
```

```text
失败 1/16

## 崩溃/网络  1 次
   - S011 t0 ValueError({'message': 'We were unable to start processing your request within the 900-second timeout limit. Please try
```

16 次里唯一的失败是厂商那边排队超时。这本身就是一个结论，而且在真实项目里很常见：**最大的桶往往不是 Agent 的问题，而是基础设施的问题。** 昨天为它加了超时、每任务一个进程、冻结母版库、断点续跑；如果你没把崩溃单独分出来，它会混进「根因判断错」里，你会去改一个根本没错的提示词。

## 成功的运行也要读

失败的桶里只有网络问题，并不说明 Agent 没问题：样本只有 8 个场景，而且是我挑的。这时候值得做一件很多人跳过的事：**读成功的运行**,看它是不是「对得有道理」。

S023 是重复开票。两次运行都判对了，贷记单都开在多出来的那张 `INV-0023-04D` 上。但读第一次的推理：

```text
9月周期 2026-09-15~2026-10-15 存在两张发票:INV-0023-04 与 INV-0023-04D,内容完全相同(recurring 135.00 + tax 4.05 = 139.05)。
recompute_invoice 对两张都返回 difference 0.00,但各自 other_invoices_same_period 指向对方,提示重复开票。
list_payments 显示 PAY-0023-04 与 PAY-0023-04D 两笔均 succeeded,各扣 139.05,同一周期共扣 278.10,多收 139.05。
```

模型的判断没错。问题在于贷记单开在哪张，是 Day 126 的 `credit_target` 决定的，它的规则是：先在证据里找「多收」类、值等于结论金额的那条，找不到就用结论里的**最后一张**。而在这个场景里，`recompute_invoice` 对两张发票返回的 `difference` 都是 `0.00`:单看任何一张，金额都和参考引擎一致，它只是在 `other_invoices_same_period` 里提示「同周期还有一张」。证据里没有一条写着「多收 139.05」。所以 `credit_target` 走了兜底分支，而模型恰好把 `04` 写在前、`04D` 写在后，贷记单才开对了。

反过来写，就开到原发票上了。这是一个**对得很侥幸**的成功。

S017(重复扣款)也是类似的情况：`difference` 是 `0.00`,多收的 123.60 是模型自己从 `paid_total` 247.20 和 `actual_total` 123.60 推出来的。Day 125 的 `overcharge_is_grounded` 让它通过了，是因为 123.60 碰巧等于证据里的「实际开票金额」,不是因为有一条证据说「多收 123.60」。Day 125 的模板兜底 `_fallback` 也是去找「多收」类的证据来标引用，在这两类场景里会找不到，客户版的数字就没有出处标注。

这两个问题在评测报告里完全看不出来，因为结果是对的。

## 组件级评测：先把问题量出来

吴恩达在 Agentic AI 课的模块 4 里讲过组件级评测：端到端的评测又慢又贵，噪声还大；如果你怀疑问题出在某一个组件，就单独给它建一个评测。这里的组件是「证据链加 `credit_target`」,它完全不需要模型：假设模型的结论全对(根因、金额都对，发票号把相关的几张都列上),只看贷记单会不会开到标准答案那张发票上。列发票号的顺序正着、反着各试一次。

```python
# billsleuth/billsleuth/evals/target_check.py
"""Day 128 新增:组件级评测,不调模型。对每个该冲正的场景,假设模型的结论完全正确
(根因、金额都对,发票号把相关的几张都列上,顺序正着反着各试一次),只看
「证据链 + credit_target」能不能把贷记单开到标准答案那张发票上。
用法:uv run python -m billsleuth.evals.target_check [--without-day128]"""
from __future__ import annotations

import argparse
import json

from billsleuth import evidence as ev
from billsleuth.db import ROOT
from billsleuth.graph import credit_target
from billsleuth.mcp_bridge import BillingMCP

DAY128_CLAIMS = ("付款层多收", "的重复开票")


def check(mcp: BillingMCP, sc: dict, without_day128: bool = False) -> list[dict]:
    t = sc["truth"]
    target = t["invoice_ids"][0]
    ok, rc = mcp.call("recompute_invoice", {"invoice_id": target})
    related = [target] + (rc["other_invoices_same_period"] if ok else [])
    evs: list[dict] = []
    for inv in related:
        ok, data = mcp.call("recompute_invoice", {"invoice_id": inv})
        if ok:
            evs += ev.extract("recompute_invoice", {"invoice_id": inv}, data)
    if without_day128:
        evs = [e for e in evs if not any(c in e["claim"] for c in DAY128_CLAIMS)]
    out = []
    for order in (sorted(related), sorted(related, reverse=True)):
        f = {"overcharge": t["overcharge"], "invoice_ids": order}
        got = credit_target(f, evs)
        grounded = any(e["value"] == t["overcharge"] and "多收" in e["claim"] and e["source_ref"] == target for e in evs)
        out.append({"scenario": sc["id"], "root_cause": t["root_cause"], "order": order, "got": got,
                    "ok": got == target, "grounded_as_overcharge": grounded})
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--without-day128", action="store_true", help="去掉今天新增的两类证据,看改之前的情况")
    a = ap.parse_args()
    mcp = BillingMCP(in_process=True)
    rows = []
    for p in sorted((ROOT / "scenarios").glob("S*.json")):
        sc = json.loads(p.read_text())
        if sc["truth"]["expected_action"] == "credit_note":
            rows += check(mcp, sc, a.without_day128)
    bad = [r for r in rows if not r["ok"]]
    nog = {r["scenario"]: r["root_cause"] for r in rows if not r["grounded_as_overcharge"]}
    print(f"{len(rows)} 次判断({len(rows) // 2} 个场景 × 正反两种顺序),开错发票 {len(bad)} 次")
    for r in bad:
        print(f"  {r['scenario']} {r['root_cause']} 顺序 {r['order']} → 开到了 {r['got']}")
    print(f"「多收」证据里找不到结论金额的场景 {len(nog)} 个:", sorted(set(nog.values())))


if __name__ == "__main__":
    main()
```

`--without-day128` 把今天要加的两类证据过滤掉，相当于改之前的代码。先跑改之前：

```text
160 次判断(80 个场景 × 正反两种顺序),开错发票 7 次
  S023 duplicate_invoice 顺序 ['INV-0023-04D', 'INV-0023-04'] → 开到了 INV-0023-04
  S047 duplicate_invoice 顺序 ['INV-0047-04D', 'INV-0047-04'] → 开到了 INV-0047-04
  S048 duplicate_invoice 顺序 ['INV-0048-05D', 'INV-0048-05'] → 开到了 INV-0048-05
  S064 duplicate_invoice 顺序 ['INV-0064-04D', 'INV-0064-04'] → 开到了 INV-0064-04
  S065 duplicate_invoice 顺序 ['INV-0065-03D', 'INV-0065-03'] → 开到了 INV-0065-03
  S076 duplicate_invoice 顺序 ['INV-0076-04D', 'INV-0076-04'] → 开到了 INV-0076-04
  S088 duplicate_invoice 顺序 ['INV-0088-05D', 'INV-0088-05'] → 开到了 INV-0088-05
「多收」证据里找不到结论金额的场景 14 个: ['duplicate_charge', 'duplicate_invoice']
```

7 个重复开票场景，每一个都是只要模型把多开的那张写在前面，贷记单就开到原发票上；正着写全对。另外重复扣款和重复开票这两类，一共 14 个场景，证据链里没有一条「多收」证据等于结论金额。

这就是组件级评测的价值：端到端冒烟里一次都没暴露的问题，在这里 160 次判断就量出来了，而且一分钱不花、几秒钟跑完。

## 改法：在复算结果上加两个字段

问题的根在 Day 123 的 `recompute_invoice`:它把「差额」只定义在发票行这一层(`difference` = 实际开票 - 应收),付款层多收和重复开票多收都要模型自己去推。修法是让工具把这两个数直接算好返回：

```python
    # Day 128 新增:同一周期有好几张时,编号最小的算原发票,其余是重复开出的
    original = min([invoice_id, *same]) if same else None
    duplicate_of = original if original and original != invoice_id else None
    if exp is None:
        reason = "按订阅事件,这个周期不应该开票(订阅已到期取消或处于暂停)"
    elif duplicate_of:
        reason = f"这张是 {duplicate_of} 的重复开票,整张都是多收"
    elif same:
        reason = f"这个周期还有其他发票:{', '.join(same)},它们是这张的重复开票"
    elif actual_total == expected_total:
        reason = "金额与参考引擎一致"
    else:
        reason = "金额与参考引擎不一致,看 by_kind 找差在哪一类"
```

```python
# billsleuth/billsleuth/server.py(Recompute 结构和返回值,Day 128 新增两个字段)
    overpaid: str                 # Day 128 新增:付款层多收 = 实际扣款合计 - 开票金额(重复扣款看这个)
    duplicate_of: str | None      # Day 128 新增:这张是同周期哪张发票的重复开票;它自己是原发票则为 null

        overpaid=fmt(sum((Decimal(p["amount"]) for p in pays), ZERO) - actual_total),
        duplicate_of=duplicate_of,
```

「哪张是原发票」的规则很朴素：同一周期的几张里编号最小的那张。云簿的发票号按顺序编，多开的那张带 `D` 后缀，排在后面。真实系统里你可能要按开票时间、或者按有没有被引用来判断，规则写在工具里，模型和 `credit_target` 都不用知道。

然后证据链跟着加两条，有了明确的「多收」证据，`credit_target` 第一条规则就能命中，Day 125 的模板兜底也能标上引用：

```python
        # Day 128 新增:付款层和重复开票的多收,各自有一条明确的「多收」证据,不用模型自己减
        if data.get("overpaid") not in (None, "0.00"):
            out.append(_ev(f"{ref} 付款层多收(扣款合计 - 开票金额)", tool, ref, data["overpaid"]))
        if data.get("duplicate_of"):
            out.append(_ev(f"{ref} 是 {data['duplicate_of']} 的重复开票,多收(整张)", tool, ref, data["actual_total"]))
        for d in data["by_kind"]:
            out.append(_ev(f"{ref} {d['kind']} 应收", tool, ref, d["expected"]))
            out.append(_ev(f"{ref} {d['kind']} 实收", tool, ref, d["actual"]))
            out.append(_ev(f"{ref} {d['kind']} 差额", tool, ref, d["difference"]))
        for n, ln in enumerate(data["expected_lines"], start=1):
            out.append(_ev(f"{ref} 应收第 {n} 行:{ln['description']}", tool, ref, ln["amount"]))
```

改完再跑一次组件级评测：

```text
160 次判断(80 个场景 × 正反两种顺序),开错发票 0 次
「多收」证据里找不到结论金额的场景 0 个: []
```

把它写成测试，留在套件里：

```python
# billsleuth/tests/test_target.py
"""Day 128:复算结果的两个新字段,以及贷记单在 80 个该冲正的场景上都开到对的发票。"""
import json

from billsleuth.db import ROOT
from billsleuth.evals.target_check import check
from billsleuth.mcp_bridge import BillingMCP


def sc(sid):
    return json.loads((ROOT / "scenarios" / f"{sid}.json").read_text())


def test_overpaid_and_duplicate_of(billing_db):
    mcp = BillingMCP(in_process=True)
    _, dup_charge = mcp.call("recompute_invoice", {"invoice_id": "INV-0017-05"})
    assert dup_charge["difference"] == "0.00" and dup_charge["overpaid"] == sc("S017")["truth"]["overcharge"]
    _, extra = mcp.call("recompute_invoice", {"invoice_id": "INV-0023-04D"})
    _, orig = mcp.call("recompute_invoice", {"invoice_id": "INV-0023-04"})
    assert extra["duplicate_of"] == "INV-0023-04" and orig["duplicate_of"] is None


def test_credit_target_on_all_credit_scenarios(billing_db):
    mcp = BillingMCP(in_process=True)
    rows = [r for p in sorted((ROOT / "scenarios").glob("S*.json"))
            if (s := json.loads(p.read_text()))["truth"]["expected_action"] == "credit_note"
            for r in check(mcp, s)]
    assert len(rows) == 160 and all(r["ok"] for r in rows)
    assert all(r["grounded_as_overcharge"] for r in rows)


def test_without_day128_reversed_order_hits_original(billing_db):
    rows = check(BillingMCP(in_process=True), sc("S023"), without_day128=True)
    assert [r["ok"] for r in rows] == [True, False]  # 正着列碰巧对,反着列就开到了原发票上
```

最后一个测试把改之前的行为也钉住了：去掉今天的两类证据，S023 正着列对、反着列错。以后谁把这两个字段删了，这个测试会告诉他为什么不能删。

这个改动是在工具的返回结构上做加法，Day 123 的 MCP 客户端和 Day 124 的图都不用改，模型在 `recompute_invoice` 的结果里多看到两个字段。系统提示词里我没加任何话，因为 Day 124 的提示词已经说了「复算是判断账算没算错的唯一依据」。

## 一次只改一处，然后跑回归

上面只改了一处。正确的迭代节奏就是这样：改一处，跑组件级评测(如果有),跑端到端回归，记改动日志，再改下一处。

端到端回归要用同一批场景、同样的试验次数，才能配对。今天这一处只影响重复扣款和重复开票，我先在 S017 和 S023 上各跑 2 次，确认模型看到新字段以后没有被带偏：

```bash
uv run python -m billsleuth.evals.run --trials 2 --only S017,S023 --out runs/v2.jsonl
uv run python -m billsleuth.evals.report runs/v2.jsonl --baseline runs/v1.jsonl
```

我跑这一步的时候，DeepSeek 正好处在排队最严重的时段：两轮断点续跑，4 次运行全部挂在同一个错误上：

```text
S017 0 ✗ ValueError({'message': 'We were unable to start processing your request within the 900-second timeout limit. Please try again later.'})
```

所以这张配对比较表我没能填上，报告里会是「崩溃 4」,配对数 0。这种时候不要拿半截数据下结论，等厂商恢复再跑。同一时段我用 Day 129 的演示服务跑通过一次 S017,用的已经是改过的代码：`recompute_invoice` 的结果里 `overpaid` 是 `123.60`,结论是 `duplicate_charge`、多收 `123.60`,贷记单开在 `INV-0017-05`。这只是一次运行，说明模型看到新字段没有被带偏，不能当回归结果。

这里要说清楚一件事：**这次回归就算跑完了，也证明不了改动有用。** 改之前这两个场景就是全对的，天花板已经顶到了；端到端回归能告诉你的只有「没变坏」。改动有用的证据来自组件级评测，160 次判断从 7 次错降到 0 次。这也是为什么要两种评测都有：端到端评测看整体，组件级评测看你改的那一块。

## 判断提升是不是真的

当你的改动确实会改变端到端结果时，同一批场景上比较两个版本要用配对检验。McNemar 检验只看「旧版对、新版错」和「旧版错、新版对」这两种不一致的配对，两版都对或都错的不关心。报告最后一行就是它。

几件事要注意。

**配对的单位是(场景, 试验)。** 两版的第 0 次配一对，第 1 次配一对，所以 `--only` 和 `--trials` 不能变。

**p 值小不代表提升大。** p 值回答「这个差异是不是噪声」,不回答「差异有多大」。报告里同时打印了差值，两个都要看。

**样本少时 McNemar 很难显著。** 假设 12 对里新版独对 5 次、旧版独对 0 次，差值是 41.7 个点，p 却是 2 × 0.5⁵ ≈ 0.062:5 个不一致的配对不够排除巧合。而且同一场景的几次试验不独立，McNemar 假设配对之间独立。更稳的做法是用 Day 69 的 `cluster_bootstrap_diff`,按场景重抽样算差值的区间。

**看的指标越多，越容易「发现」提升。** 我们有 10 个比例指标加 13 个根因分组。事先定好主指标(成功率)和护栏指标(误冲正率不能涨),其余的只用来定位问题。

## 评测本身的盲点

读运行记录时，除了 Agent 的问题，我还记下了两个评测自己的问题，它们会让你对 Agent 的判断失真。

**追问比例是 0%。** Day 127 说过，15 次运行一次追问都没有。下一处改动应该是给场景加 `customer_goal`,按 variant 写成 Agent 第一轮大概率不会主动回答的诉求：重复扣款的客户想知道「退回原卡还是抵扣」,年付续费的客户想知道「能不能改回月付」,升级折算的客户想知道「下个月开始每月多少」。改完先看追问比例有没有上来，再看成功率；这是对评测的改动，要单独记一行日志，前后分数不能直接比。

**成本只算了一部分。** 报告里的成本只来自 `investigate` 节点的 token,`intake`、`write_up` 和模拟客户都没算。做模型对比时这会偏向「调查轮数少、但写作调用多」的模型。修法是在 `get_llm` 外包一层回调，把所有调用的 token 都记进状态。

这两处我列进了改动日志，但还没做。一次只改一处。

## 模型对比

改完工具和提示词，下一个问题是：换个模型会不会更好？`get_llm` 读 `LLM_MODEL`,同一套场景换模型跑一遍：

```bash
LLM_MODEL=模型A uv run python -m billsleuth.evals.run --trials 4 --split dev --out runs/model-a.jsonl
LLM_MODEL=模型B uv run python -m billsleuth.evals.run --trials 4 --split dev --out runs/model-b.jsonl
uv run python -m billsleuth.evals.report runs/model-b.jsonl --baseline runs/model-a.jsonl
```

模型名用你账户里当前可用的，写之前去厂商文档确认；OpenAI 兼容接口改 `LLM_BASE_URL` 和 `LLM_API_KEY` 就能换厂商。**模拟客户的模型保持不变**,用 `SIM_MODEL` 固定住。

| 模型 | 成功率(95% CI) | 误冲正率 | pass^4 | 单次成本上限 | 耗时 P95 |
| --- | --- | --- | --- | --- | --- |
| 模型 A | | | | | |
| 模型 B | | | | | |
| 模型 C | | | | | |

误冲正率是一票否决的护栏。剩下的在成功率和成本之间权衡：把每个模型画在「成本-成功率」平面上，只保留不被别的模型在两个维度上同时超过的那几个(帕累托前沿),再按业务能接受的单工单成本挑。

## 改动日志

每次改动记一行。这张表是面试里讲这个项目时最有力的材料。

| 版本 | 改动 | 针对什么 | 组件级评测 | 端到端成功率(95% CI) | 对上一版 | 误冲正率 |
| --- | --- | --- | --- | --- | --- | --- |
| v1 | Day 126 基线 | — | 开错 7/160 | 冒烟 15/15(崩溃 1) | — | 0 |
| v2 | 复算加 overpaid、duplicate_of | 读成功运行发现的侥幸 | 开错 0/160 | (厂商超时，待补跑) | | |
| v3 | 场景加 customer_goal(评测改动) | 追问比例 0% | — | | 不可比 | |
| v4 | 记全部 LLM 调用的成本(评测改动) | 成本只算了一部分 | — | | 不可比 | |
| v5 | 换模型 | — | — | | | |

## 防止对评测集过拟合

你盯着同一批场景的错例改了五轮，分数一定会涨。其中一部分是真的变好了，另一部分是你不知不觉针对这批场景调了参数。

做法：按 variant 分层，切出三成做**留出集**,剩下的是**开发集**。错误分析和迭代只看开发集的运行记录，留出集只在最后跑一次，只看分数，不看回复。开发集涨了 15 个点、留出集只涨了 3 个点，说明有一部分改动在过拟合。

```python
# billsleuth/billsleuth/evals/split.py
"""Day 128 新增:按 variant 分层,切出 30% 的留出集,写进 scenarios/split.json(提交进 git,以后不再改)。
场景文件不动(Day 123 的测试按文件名读全部 100 个),评测时用 run.py --split dev / holdout 选。"""
from __future__ import annotations

import json
import random
from collections import defaultdict

from billsleuth.db import ROOT


def split(holdout_ratio: float = 0.3, seed: int = 128) -> dict[str, list[str]]:
    by_variant: dict[str, list[str]] = defaultdict(list)
    for p in sorted((ROOT / "scenarios").glob("S*.json")):
        by_variant[json.loads(p.read_text())["truth"]["variant"]].append(p.stem)
    rng = random.Random(seed)  # 固定种子,切分可复现
    out: dict[str, list[str]] = {"dev": [], "holdout": []}
    for ids in by_variant.values():
        rng.shuffle(ids)
        k = max(1, round(len(ids) * holdout_ratio))
        out["holdout"] += ids[:k]
        out["dev"] += ids[k:]
    return {k: sorted(v) for k, v in out.items()}


if __name__ == "__main__":
    s = split()
    (ROOT / "scenarios" / "split.json").write_text(json.dumps(s, indent=2))
    print(f"开发集 {len(s['dev'])} 个,留出集 {len(s['holdout'])} 个")
```

场景文件不动，切分结果写进 `scenarios/split.json`,因为 Day 123 的测试按文件名读全部 100 个场景。`run.py` 加了一个 `--split dev|holdout` 参数。我这里切出来是开发集 68 个、留出集 32 个：16 个 variant 各自按三成四舍五入，每个至少一个，所以比 30 个多一点。切分结果提交进 git,以后不再改。

<figure>
<svg viewBox="0 0 640 280" role="img" aria-label="错误分析循环：读失败和成功的样例、分桶、找一句话原因、写组件级评测、改一处、跑回归，最后在留出集上验证">
  <rect x="0" y="0" width="640" height="280" fill="var(--paper-raised)" rx="6"/>
  <rect x="20" y="40" width="110" height="50" fill="none" stroke="var(--ink-soft)" rx="4"/>
  <text x="75" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">读样例</text>
  <text x="75" y="80" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">失败的和成功的</text>
  <rect x="150" y="40" width="100" height="50" fill="none" stroke="var(--ink-soft)" rx="4"/>
  <text x="200" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">分桶</text>
  <text x="200" y="80" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">按改哪里分</text>
  <rect x="270" y="40" width="110" height="50" fill="none" stroke="var(--ink-soft)" rx="4"/>
  <text x="325" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">一句话原因</text>
  <text x="325" y="80" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">不能是「模型笨」</text>
  <rect x="400" y="40" width="100" height="50" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="450" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">组件级评测</text>
  <text x="450" y="80" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">先量出来</text>
  <rect x="520" y="40" width="100" height="50" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="570" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">改一处</text>
  <text x="570" y="80" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">工具/定义/流程</text>
  <line x1="130" y1="65" x2="146" y2="65" stroke="var(--ink-soft)" marker-end="url(#a128)"/>
  <line x1="250" y1="65" x2="266" y2="65" stroke="var(--ink-soft)" marker-end="url(#a128)"/>
  <line x1="380" y1="65" x2="396" y2="65" stroke="var(--ink-soft)" marker-end="url(#a128)"/>
  <line x1="500" y1="65" x2="516" y2="65" stroke="var(--ink-soft)" marker-end="url(#a128)"/>
  <rect x="360" y="140" width="260" height="50" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="490" y="162" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">组件级 + 开发集回归</text>
  <text x="490" y="180" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">同样的场景和次数，配对检验</text>
  <line x1="570" y1="90" x2="570" y2="136" stroke="var(--mem)" marker-end="url(#a128)"/>
  <path d="M360 165 C 200 165, 75 150, 75 94" fill="none" stroke="var(--ink-soft)" stroke-dasharray="4 4" marker-end="url(#a128)"/>
  <text x="110" y="150" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">记改动日志，进入下一轮</text>
  <rect x="360" y="220" width="260" height="40" fill="none" stroke="var(--ink-soft)" rx="4"/>
  <text x="490" y="245" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">最后：留出集只跑一次</text>
  <line x1="490" y1="190" x2="490" y2="216" stroke="var(--ink-soft)" marker-end="url(#a128)"/>
  <defs><marker id="a128" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
</svg>
<figcaption>错误分析的循环。琥珀色是用数据判断的地方，蓝色是动手改的地方。成功的运行也在「读样例」里；留出集不进循环。</figcaption>
</figure>

## 提分手段清单

按投入从小到大，你做自己的项目时可以对照：

- **改工具返回结构。** 把模型需要、但只能自己推的数直接返回。今天的 `overpaid` 和 `duplicate_of` 就是这种。
- **写清类别定义和边界。** 针对「钱对、标签错」。Day 122 的 `ROOT_CAUSES` 已经给每类写了一句话定义，如果某两类稳定混淆，就在定义里写边界(「没有失败记录的重复扣款算 duplicate_charge」这种)。
- **改错误信息。** 工具报错写得越具体，模型被打回后改对的概率越高。
- **加专用工具。** 把领域里最容易错的计算交给代码，比如按天折算的逐项拆解。
- **把稳定混淆的判断交给代码。** 定义写清楚后还混淆的那一对，写规则。
- **换模型。** 放最后，影响面最大，而且前面几步做完后，模型之间的差距往往比你想的小。

## 动手练习

1. 把 `buckets.py` 放进 `billsleuth/evals/`,对 Day 127 的 `runs/v1.jsonl` 跑一次，每个桶读三条样例；再挑三条**成功**的运行读推理，各写一句「它为什么对」。
2. 写 `target_check.py`,先带 `--without-day128` 跑一次，记下开错的次数。
3. 给 `recompute_invoice` 加 `overpaid` 和 `duplicate_of`,给证据链加两条，再跑 `target_check`,写 `tests/test_target.py`。
4. 在 S017、S023 上跑端到端回归，和 v1 做配对比较，填改动日志。
5. 用 `split.py` 切出开发集和留出集，提交进 git。
6. 按改动日志的 v3、v4 两行，各做一次评测侧的改动，各跑一次开发集。
7. 选两三个模型，在开发集上用同一个模拟客户模型对比，填模型对比表；最后在留出集上跑一次最终版本。

**验收标准:**每个桶有一句具体原因；`target_check` 改前改后的数字都记在日志里；端到端回归的每一行都有区间和对上一版的配对检验；误冲正率在所有版本里没有上升；留出集的结果和开发集的结果放在一起报告。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 错误分析 | 系统地读运行记录、归类、计数，找出最值得修的问题 |
| 分桶 | 按「修的时候改哪里」把失败分组 |
| 组件级评测 | 只评测系统里的一个组件，不跑完整流程，通常不调模型 |
| 侥幸的成功 | 结果对，但依赖了不该依赖的东西(比如列表顺序) |
| 回归 | 改动后在同一批场景上重跑，和上一版对比 |
| McNemar 检验 | 配对的二元结果比较，只看两版结论不一致的配对 |
| 护栏指标 | 不追求提升、但不允许变差的指标，这里是误冲正率 |
| 帕累托前沿 | 在成本和成功率两个维度上都不被别的方案同时超过的方案集合 |
| 开发集 / 留出集 | 用来迭代的场景，以及只在最后验一次的场景 |
| 分层抽样 | 按类别比例抽样，保证每类在两边都有 |

## 常见误区

**拿到报告直接改提示词。** 不读样例就改，改的是你以为的问题。

**只读失败的运行。** 今天最重要的问题藏在一次成功的运行里。结果对，不代表理由对。

**崩溃算进失败。** 你会去改一个根本没错的提示词。基础设施的问题单独一个桶。

**按指标分桶。** 「根因错」下面可能是分类体系的问题，也可能是推理的问题，修法完全不同。

**什么都靠端到端评测。** 又慢又贵，噪声大，天花板顶到时根本测不出改进。怀疑哪个组件，就单独给它建评测。

**一次改好几处。** 一涨一跌会互相抵消，你看不出哪个改动有问题。

**评测侧的改动和 Agent 的改动混着比。** 换了模拟客户的诉求、换了成本口径，前后分数就不可比了。单独记一行。

**只在开发集上报分数。** 留出集上的数才是你能对外说的。

## 学习资料

### 文档与文章

- [Hamel Husain · A Field Guide to Rapidly Improving AI Products](https://hamel.dev/blog/posts/field-guide/):错误分析的完整方法：先看数据、自己写分类、做标注工具，40 分钟。今天「先读，再分桶，再数」就是从这里来的。
- [Anthropic · Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents):讲工具应该返回什么样的信息，对应今天在复算结果上加字段，30 分钟。
- [Anthropic · Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):附录里讲 agent-computer interface,工具定义值得花和提示词一样多的精力，15 分钟。
- [Evan Miller · Adding Error Bars to Evals](https://arxiv.org/abs/2411.00640):重点读比较两个模型、配对差值的那一节，20 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1aaxyz8ELY&p=20&autoplay=0&high_quality=1" title="(中英双语!)吴恩达最新《Agentic AI》大佬亲授智能体教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>吴恩达机器学习(搬运)· (中英双语!)吴恩达最新《Agentic AI》大佬亲授智能体教程 · 第 20 P「误差分析与确定后续步骤优先级」,9 分钟；接着看第 22 P「组件级评估」(3 分钟)和第 23 P「如何解决你发现的问题」,今天的 target_check 就是第 22 P 讲的那种评测。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/e2i6JbU2R-s" title="Error Analysis: The Highest ROI Technique In AI Engineering" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hamel Husain · Error Analysis: The Highest ROI Technique In AI Engineering · 演示怎么一条条读 trace、写笔记、归类，英文。</figcaption>
</figure>

### 书籍

- Andrew Ng《Machine Learning Yearning》(deeplearning.ai,2018,免费电子书):第 14–19 章讲错误分析，「用 100 个错例估计每类问题的上限」那一套方法放在 Agent 上依然成立，1 小时。
- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 4 章「Evaluate AI Systems」讲评测驱动的迭代，第 10 章讲用户反馈闭环，可以对照今天的改动日志读。

### 开源项目与代码

- [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo):开源的提示词和 Agent 回归测试工具，看 README 里「对比两个版本」的用法，想把回归接进 CI 可以参考，30 分钟。
- [openai/evals](https://github.com/openai/evals):看 `evals/elsuite` 下几个基于规则判分的例子，了解别人怎么组织评测代码。

## 自测

1. Day 127 的冒烟只有一次失败，而且是厂商超时。为什么说这本身就是一个结论？

<details><summary>答案</summary>

它说明当前最大的问题不在 Agent,而在基础设施。真实项目里经常这样。如果没把崩溃单独分桶，它会被算成「根因判断错」之类的失败，你会去改一个没错的提示词。对应的修法在基础设施上：超时、每任务一个进程、冻结母版库、断点续跑。

</details>

2. S023 两次都判对了，为什么说它「对得很侥幸」?

<details><summary>答案</summary>

复算对两张发票返回的 difference 都是 0.00,证据链里没有一条「多收 139.05」。Day 126 的 credit_target 找不到这样的证据，就走兜底：用结论里的最后一张。模型恰好把原发票写在前、多开的写在后，贷记单才开对。反过来写就开到原发票上了，组件级评测量出 7 个重复开票场景都是这样。

</details>

3. 为什么要写组件级评测，而不是多跑几次端到端评测？

<details><summary>答案</summary>

端到端评测慢、贵、噪声大，而且这里的问题只在模型「换个顺序列发票号」时才出现，端到端可能跑很多次都碰不上；改之前这两个场景就已经全对，端到端回归顶到天花板，测不出改进。组件级评测不调模型，几秒钟穷举 80 个场景的两种顺序，改前 7 次错、改后 0 次，证据确定。

</details>

4. 回归时两版的成功率差 41.7 个点,McNemar p = 0.062。可以下结论说新版更好吗？

<details><summary>答案</summary>

还不能说证明了。McNemar 只看不一致的配对，这里只有 5 对，5 对全偏向新版在「两版一样好」的假设下概率约 0.062,不够排除巧合；同一场景的几次试验也不独立。要看配对数和场景数，用按场景聚类的 bootstrap 再算差值区间；看护栏指标误冲正率有没有变差；确认这是事先定好的主指标；在留出集上再验一次。

</details>

5. 资深面试题：你的 Agent 端到端评测全绿，你怎么判断它是不是真的可靠？

<details><summary>答案</summary>

全绿只说明在这批场景、这几次试验上结果对。要做几件事：读成功的运行，看理由是否站得住，有没有依赖顺序、巧合数字、某个兜底分支；对关键组件(这里是贷记单开在哪)写组件级评测，穷举输入的变化(顺序、格式、边界值);检查评测本身的盲点(模拟客户有没有真的追问、成本口径全不全、场景是不是挑的);看样本量和区间，全对时 Wilson 区间下限是多少；再在留出集和更多 trial 上跑 pass^k。还要说明：评测全绿之后的风险在分布外的真实请求，上线要有抽样复核和监控。

</details>

6. 为什么场景文件不搬进 dev/holdout 两个目录，而是写一个 split.json?

<details><summary>答案</summary>

Day 123 的测试按文件名读 scenarios 下的全部 S*.json,验证复算工具能算出每个场景的差额，搬走就会少测一部分；其他工具(run.py 的 --only、selfcheck)也都按文件名找场景。把切分写进 split.json,文件不动，评测时用 --split 选，改动最小，切分也能单独进 git 审查。

</details>

## 明天预告

BillSleuth 现在有了评测、组件级评测和改动日志，该让别人看见了。明天(Day 129)做**在线演示**:FastAPI 加 SSE 把调查图的每个节点实时推给前端，页面上展示步骤、复算对比表、结论和证据链；每次调查在独立子进程和独立库副本里跑；按 IP 限流加每日花费上限；再把每次调查导出成作品一 Agent Loupe 的 JSONL,最后部署上线。
