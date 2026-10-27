---
title: 'Day 692 · 第 99 周复习:作品(Day 686–691)'
description: '本周从证据链、调查图一路做到写作校验和人工审批,347 条测试、六种真实踩过的坑。今天画一张知识地图把六天串起来,做一个只用本周知识的小项目:不信流程代码、只看库里结果的贷记单体检,用假模型把 6 个场景完整跑一遍,再故意做 7 种破坏,体检抓到 6 种、漏了 1 种(金额被改小),补上第 7 条检查。最后默写 decide,用 19 条测试判卷,并整理本周的错题清单。'
pubDate: 2026-10-27
regime: none
tags: ['billsleuth', 'review', 'audit', 'testing', 'agent-zero']
series: 'agent-zero'
day: 692
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 691](/blog/agent-zero/day-691-bs-credit-2/) 把审批流接通了:`draft_credit_note` 加了幂等键和 `BEGIN IMMEDIATE`,调查图在 `await_approval` 用 `interrupt` 暂停,checkpoint 存进磁盘,审批人用命令行批。写测试时抓出两个 bug(失败路径漏了出口、节点里抛错会毒化恢复值),真模型跑案件时又发现 `credit_target` 在重复开票上选错了发票,改成「证据不能唯一确定就转人工」。347 条测试全绿。

今天是第 99 周的复习日。本周六天(Day 686–691)代码量不小:`evidence.py`、`graph.py`、`explain.py`、`grounding.py`、`credit.py`、`approval.py`、`cases.py`、`approve.py`,还有一路积累下来的测试。今天不学新概念,做三件事:把六天串成一张图,做一个只用本周知识的小项目,整理本周踩过的坑。

## 今天要解决的问题

1. 画出本周的知识地图,能对着图说出每一天守住了哪一类错误,以及哪一类错误是前一天守不住、后一天才补上的。
2. 做一个小项目:贷记单体检脚本。它不信任流程代码,只看库里的结果,逐条检查贷记单有没有违反规矩;再用假模型把 6 个场景完整跑一遍,故意做 7 种破坏,看体检抓得到几种。
3. 合上文章默写 `approval.decide`,用 `tests/test_approval.py` 的 19 条测试判卷;再故意默错一处,看哪几条测试红。
4. 整理一份本周的错题和坑清单,每一条说清楚怎么发现的、怎么防。

预计用时 4 小时。前置:Day 686–691 六篇(今天会逐篇链接回去),[Day 685](/blog/agent-zero/day-685-week98-review/) 的复习日写法(默写加体检)。今天不调真模型,花费 ¥0:所有场景用「照标准答案念台词的假模型」。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通小项目;第二天合上文章,把 `audit()` 里的六条检查默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="第 99 周知识地图:六天依次为证据链和调查图、假模型测试和真模型跑、两份解释和溯源校验器、重写循环和专门检查、三种处理和状态机、幂等键和审批暂停;下方一行标出每一天守住的错误类型">
  <rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">一次调查从头到尾,六天各接一段</text>
  <rect x="15" y="45" width="190" height="62" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="110" y="68" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">686 证据链 + 调查图</text>
  <text x="110" y="88" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">evidence.py graph.py</text>
  <rect x="225" y="45" width="190" height="62" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="320" y="68" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">687 假模型测试 + 真跑</text>
  <text x="320" y="88" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">ScriptedLLM run.py</text>
  <rect x="435" y="45" width="190" height="62" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="530" y="68" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">688 两份解释 + 溯源</text>
  <text x="530" y="88" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">explain.py grounding.py</text>
  <line x1="530" y1="107" x2="530" y2="135" stroke="var(--ink-soft)" marker-end="url(#a692)"/>
  <rect x="435" y="140" width="190" height="62" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="530" y="163" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">689 重写 + 兜底 + 专门检查</text>
  <text x="530" y="183" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">write_up key_fact_problems</text>
  <line x1="435" y1="171" x2="420" y2="171" stroke="var(--ink-soft)" marker-end="url(#a692)"/>
  <rect x="225" y="140" width="190" height="62" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="320" y="163" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">690 三种处理 + 状态机</text>
  <text x="320" y="183" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">credit.py approval.py</text>
  <line x1="225" y1="171" x2="210" y2="171" stroke="var(--ink-soft)" marker-end="url(#a692)"/>
  <rect x="15" y="140" width="190" height="62" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="110" y="163" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">691 幂等 + 暂停审批</text>
  <text x="110" y="183" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">interrupt cases.py</text>
  <line x1="205" y1="76" x2="220" y2="76" stroke="var(--ink-soft)" marker-end="url(#a692)"/>
  <line x1="415" y1="76" x2="430" y2="76" stroke="var(--ink-soft)" marker-end="url(#a692)"/>
  <text x="20" y="232" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">每一段守住的错误</text>
  <text x="20" y="254" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">686 数字不能让模型抄,由代码抽 · 687 路径不能只靠真模型测</text>
  <text x="20" y="272" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">688 每个金额要有出处 · 689 数是真的也可能用错地方,要专门查</text>
  <text x="20" y="290" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">690 动钱的规矩写成一张表 · 691 重放、并发、暂停恢复、人的错都不能弄出两张单</text>
  <text x="20" y="316" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">蓝色:模型参与的部分。琥珀色:只有代码和人。越往钱靠近,模型的参与越少。</text>
  <defs><marker id="a692" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
</svg>
<figcaption>图里的箭头是一次调查的先后。蓝色的几段(调查、写解释)有模型,琥珀色的两段(起草、审批)只有代码和人:越靠近钱,模型的参与越少。</figcaption>
</figure>

### 每天一句话

- [Day 686](/blog/agent-zero/day-686-bs-evidence/):做实验发现模型写的解释里 14 个金额有 5 个在工具结果里找不到出处,所以证据由代码从结构化结果里抽出来编号(E1、E2……),再把四段拼成 LangGraph 调查图,当场发现「按金额找发票」一次找出好几张,改成金额加月份。
- [Day 687](/blog/agent-zero/day-687-bs-run/):用一个按剧本念台词的假模型,不花钱测完路由、越权拦截、催交、转人工;用真模型跑 16 个场景 16/16 命中,但发票号一致只有 15/16(S023),也说明「全对」不等于好用。
- [Day 688](/blog/agent-zero/day-688-bs-grounded-1/):写给客户和写给同事的两份解释;`grounding.py` 把文字里的每个金额拿去证据链找出处,16 份草稿里抓出 8 处孤儿数字,其中一个是模型编出来的 360.00。
- [Day 689](/blog/agent-zero/day-689-bs-grounded-2/):校验没过就带着问题清单重写,三稿不过用模板兜底;加压发现 `grounding.py` 把两笔同样金额的证据当成一条;盲区实验证明「数是真的但用错了地方」通用校验器拦不住,补上专门检查。
- [Day 690](/blog/agent-zero/day-690-bs-credit-1/):贷记单、退款、作废重开各管什么;实验里模型起草 80/80 全对,但仍选代码起草(结果可证明);状态机写成 4×3 的 `RULES` 表,12 个格子逐个测。
- [Day 691](/blog/agent-zero/day-691-bs-credit-2/):幂等键加写锁挡住重放和并发,图在审批节点暂停、审批人命令行恢复;写测试抓出失败路径漏出口和节点抛错毒化恢复值两个 bug,真模型跑案件又发现重复开票时代码选错发票,改成证据不唯一就转人工。

### 本周的数字

| 天 | 测试总数 | 本天真模型花费 | 这一天最该记住的一个数 |
| --- | --- | --- | --- |
| 686 | 259 | 约 ¥0.17 | 14 个金额里 5 个没出处 |
| 687 | 266 | 约 ¥0.67 | 16/16 命中,发票号 15/16 |
| 688 | 279 | 约 ¥0.50 | 442 个金额里 8 个孤儿 |
| 689 | 294 | 约 ¥0.50 | 盲区:通用校验器 10 份全放行,专门检查 10 份全拦下 |
| 690 | 323 | 约 ¥0.37 | 73 贷记单 / 20 只解释 / 7 退款;模型起草 80/80 |
| 691 | 347 | 约 ¥0.33 | 普通 BEGIN 十轮里 5 轮 `database is locked` |
| 692 | 348 | ¥0 | 体检 7 种破坏抓到 6 种 |

(各天花费按各天文章里的估算,686–689 是当天预计数。)

## 小项目:贷记单体检

### 为什么要写体检

Day 690 的 19 条测试证明了「走正门」的路径守规矩:从 `decide` 进去,不可能签发一张没人批的单子。但库就是一个 SQLite 文件,有人直接改库、将来加了另一条写入路径、某次迁移改坏了数据,这些都绕过了 `decide`。所以需要另一种检查:**不信流程代码,只看库里的结果**,逐条核对规矩是不是被守住了。

这是评测里一个常见的区分:测试检查「代码会不会做错」,体检检查「库里现在有没有错」。两者缺一不可。

体检要有东西可查,先用假模型把 6 个场景完整跑一遍。`scratch/week99_flow.py` 不调真模型,把假模型的台词按每个场景的标准答案写好:先复算那张发票、再查扣款、再交卷,解释里只写结论里的金额(保证过得了 Day 688 的溯源校验)。

```python
# billsleuth/scratch/week99_flow.py  第 99 周小项目(上):不调模型,用「照标准答案念台词的假模型」把 6 个场景走完整条审批流
import json
import os

from langchain_core.messages import AIMessage
from langgraph.types import Command

from billsleuth import cases
from billsleuth.db import ROOT
from billsleuth.explain import Explanation
from billsleuth.graph import Intake
from tests.test_graph import ScriptedLLM, call


def scripted_llm(sc: dict) -> ScriptedLLM:
    """照标准答案写台词:先复算、再查扣款、再交卷。解释里只写结论里的金额,保证过得了溯源校验。"""
    t, cid = sc["truth"], sc["customer_id"]
    inv = t["invoice_ids"][0]
    over, ok = t["overcharge"], t["expected_action"] == "credit_note"
    script = [AIMessage("", tool_calls=[call("recompute_invoice", {"invoice_id": inv}, 1),
                                        call("list_payments", {"customer_id": cid, "invoice_id": inv}, 2)]),
              AIMessage("", tool_calls=[call("SubmitFindings", {
                  "root_cause": t["root_cause"], "invoice_ids": t["invoice_ids"], "overcharge": over,
                  "expected_action": t["expected_action"], "reasoning": t["detail"]}, 3)])]
    if ok:
        exp = Explanation(customer_message=f"您好,这张发票多收了 {over} 美元。已提交更正申请,审核通过后会把多收的金额退回或抵扣。",
                          internal_note=f"{t['root_cause']}:多收 {over}。")
    else:
        exp = Explanation(customer_message="您好,我们核对了这张发票,金额按规则计算没有错误。", internal_note="no_error。")
    return ScriptedLLM(Intake(complaint="金额不对"), script, drafts=[exp] * 3)


def run_scenario(sid: str, approvers: list[tuple[str, str, str]]) -> dict:
    """approvers:[(谁, approve/reject, 备注)],按顺序交给暂停的图。"""
    sc = json.loads((ROOT / "scenarios" / f"{sid}.json").read_text(encoding="utf-8"))
    case_id, st = cases.open_case(sc["customer_id"], sc["question"], llm=scripted_llm(sc))
    for who, decision, comment in approvers:
        st = cases.resume_case(case_id, who, decision, comment)
    a = st.get("approval") or {}
    return {"sid": sid, "case": case_id, "cn": a.get("credit_note_id"), "status": a.get("status"),
            "escalated": bool(st.get("escalated")), "error": a.get("error")}


PLAN = {
    "S001": [("alice", "approve", "")],                           # 174.90,一个人批
    "S017": [("alice", "approve", "")],                           # 123.60 重复扣款
    "S024": [("alice", "approve", ""), ("bob", "approve", "")],   # 444.14,两个人批
    "S002": [("alice", "reject", "客户取消记录待客服确认")],         # 321.36,驳回
    "S023": [],                                                   # 重复开票:代码不替人选,转人工
    "S003": [],                                                   # 账没错:不进审批
}

if __name__ == "__main__":
    os.environ.setdefault("BILLSLEUTH_CHECKPOINTS", str(ROOT / "week99_checkpoints.db"))
    for sid, who in PLAN.items():
        r = run_scenario(sid, who)
        print(f"{sid}  案件 {r['case']}  贷记单 {str(r['cn']):<8} 状态 {str(r['status']):<9} {'转人工' if r['escalated'] else ''}")
```

<div class="line-notes">

- `from tests.test_graph import ScriptedLLM, call` 复用 Day 687 的假模型,今天不再重写。脚本放在 `scratch/` 里但能 import `tests/`,因为都是从项目根目录用 `-m` 运行的。
- `def scripted_llm(sc: dict) -> ScriptedLLM:` 按场景的标准答案造一个假模型。
- `t, cid = sc["truth"], sc["customer_id"]` 比如 S024:`t` 里根因是 `duplicate_charge`,多收 444.14,发票 `INV-0024-03`。
- `inv = t["invoice_ids"][0]` 台词里要复算的那张发票。
- `over, ok = t["overcharge"], t["expected_action"] == "credit_note"` `ok` 为真表示这个场景该冲正。
- `script = [AIMessage("", tool_calls=[call("recompute_invoice", {"invoice_id": inv}, 1),` 第一句台词:一轮里并行调两个工具,和真模型的习惯一样。
- `call("list_payments", {"customer_id": cid, "invoice_id": inv}, 2)]),` 第二个工具,查这张发票的扣款。重复扣款的场景靠它拿到扣款证据。
- `AIMessage("", tool_calls=[call("SubmitFindings", {` 第二句台词:交卷,字段全取标准答案。
- `exp = Explanation(customer_message=f"您好,这张发票多收了 {over} 美元。已提交更正申请,审核通过后会把多收的金额退回或抵扣。",` 要冲正时的客户版:只写结论里的金额,不写任何别的数,所以过得了溯源校验和 `key_fact_problems`。
- `exp = Explanation(customer_message="您好,我们核对了这张发票,金额按规则计算没有错误。", internal_note="no_error。")` 账没错时的解释:一个数字也没有。
- `return ScriptedLLM(Intake(complaint="金额不对"), script, drafts=[exp] * 3)` 三份相同的稿子备着,万一要重写也有台词。
- `def run_scenario(sid: str, approvers: list[tuple[str, str, str]]) -> dict:` 开案件、按顺序让审批人批。
- `case_id, st = cases.open_case(sc["customer_id"], sc["question"], llm=scripted_llm(sc))` Day 691 的 `open_case`,案件落在磁盘 checkpoint 里。
- `for who, decision, comment in approvers:` 每个元组是一次审批动作,比如 `("alice", "approve", "")`。
- `st = cases.resume_case(case_id, who, decision, comment)` 恢复暂停的图。
- `"S024": [("alice", "approve", ""), ("bob", "approve", "")],   # 444.14,两个人批` 444.14 达到门槛,两个人。
- `"S002": [("alice", "reject", "客户取消记录待客服确认")],         # 321.36,驳回` 驳回一张,321.36 也达到门槛,但一个人驳回就够了。
- `"S023": [],                                                   # 重复开票:代码不替人选,转人工` 不会进入审批,不需要人批。
- `os.environ.setdefault("BILLSLEUTH_CHECKPOINTS", str(ROOT / "week99_checkpoints.db"))` 小项目的 checkpoint 单独放一个文件,不和命令行审批的混在一起。

</div>

```bash
cd /Users/你/billsleuth
rm -f week99_checkpoints.db && uv run python -m billsleuth.seed
uv run python -m scratch.week99_flow
```

```text
写入 100 个场景 → billing.db,标准答案在 scenarios/
S001  案件 case-63131b9d  贷记单 CN-0001  状态 issued    
S017  案件 case-976dc0d7  贷记单 CN-0002  状态 issued    
S024  案件 case-b5afe710  贷记单 CN-0003  状态 issued    
S002  案件 case-dc42e2ff  贷记单 CN-0004  状态 rejected  
S023  案件 case-ae1a9e60  贷记单 None     状态 blocked   转人工
S003  案件 case-fcba45bb  贷记单 None     状态 None      
```

6 个场景走完了:3 张签发(其中 S024 两个人批)、1 张驳回、S023 转人工、S003 账没错。库里一共 4 张贷记单。

### 体检脚本

`scripts/audit_credit.py` 六条检查,每一条都是一个「不该出现」的结果:

```python
# billsleuth/scripts/audit_credit.py  第 99 周小项目(下):不信流程代码,只看库里的结果,逐条检查贷记单有没有违反规矩
import sqlite3
import sys
from decimal import Decimal

from billsleuth import approval
from billsleuth.db import connect

AGENTS = ("agent", "billsleuth")


def audit(conn: sqlite3.Connection) -> list[str]:
    bad: list[str] = []
    notes = conn.execute("SELECT * FROM credit_notes").fetchall()
    for cn in notes:
        yes = [a for a in approval.approvals_of(conn, cn["id"]) if a["decision"] == "approve"]
        names = [a["approver"] for a in approval.approvals_of(conn, cn["id"])]
        # 1 签发的必须批够人数
        if cn["status"] == "issued" and len(yes) < approval.approvals_needed(cn["amount"]):
            bad.append(f"{cn['id']} 已签发但只有 {len(yes)} 个人批准(需要 {approval.approvals_needed(cn['amount'])})")
        # 2 批准人里不能有 Agent,同一个人不能出现两次
        if any(n.strip().lower() in AGENTS for n in names) or len(set(names)) != len(names):
            bad.append(f"{cn['id']} 的审批人里有 Agent 或同一个人批了两次:{names}")
        # 3 rejected 的必须有一条驳回记录(谁驳回的、为什么)
        if cn["status"] == "rejected" and not any(a["decision"] == "reject" for a in approval.approvals_of(conn, cn["id"])):
            bad.append(f"{cn['id']} 是 rejected 但没有驳回记录")
        # 4 草稿必须有幂等键记录(都是案件起草的)
        if not conn.execute("SELECT 1 FROM credit_note_requests WHERE credit_note_id = ?", (cn["id"],)).fetchone():
            bad.append(f"{cn['id']} 没有幂等键记录,不是图起草的")
    # 5 同一张发票上,已批准加已签发的合计不能超过实际扣款
    for inv in {cn["invoice_id"] for cn in notes}:
        paid = sum((Decimal(p["amount"]) for p in conn.execute(
            "SELECT amount FROM payments WHERE invoice_id = ? AND status = 'succeeded'", (inv,))), Decimal("0"))
        credited = sum((Decimal(r["amount"]) for r in conn.execute(
            "SELECT amount FROM credit_notes WHERE invoice_id = ? AND status IN ('approved', 'issued')", (inv,))), Decimal("0"))
        if credited > paid:
            bad.append(f"{inv} 已批准或已签发的贷记合计 {credited} 超过实际扣款 {paid}")
    # 6 同一个案件、同一张发票,不能有两张还活着(非 rejected)的贷记单
    for r in conn.execute("SELECT q.case_id, c.invoice_id, COUNT(*) n FROM credit_note_requests q JOIN credit_notes c "
                          "ON c.id = q.credit_note_id WHERE c.status != 'rejected' GROUP BY 1, 2 HAVING n > 1"):
        bad.append(f"案件 {r['case_id']} 在 {r['invoice_id']} 上有 {r['n']} 张未驳回的贷记单")
    return bad


if __name__ == "__main__":
    with connect() as c:
        total = c.execute("SELECT COUNT(*) FROM credit_notes").fetchone()[0]
        problems = audit(c)
    for p in problems:
        print("违规:", p)
    print(f"体检 {total} 张贷记单,违规 {len(problems)} 条")
    sys.exit(1 if problems else 0)
```

<div class="line-notes">

- `AGENTS = ("agent", "billsleuth")` 和 `approval.py` 里的黑名单一样。体检里再写一份是有意的:如果有人把流程代码里的黑名单改松了,体检里这份还在。
- `def audit(conn: sqlite3.Connection) -> list[str]:` 返回违规描述的列表,空列表表示干净。
- `notes = conn.execute("SELECT * FROM credit_notes").fetchall()` 全部贷记单,不看状态,体检要看的是所有。
- `yes = [a for a in approval.approvals_of(conn, cn["id"]) if a["decision"] == "approve"]` 这张单子的批准记录。
- `if cn["status"] == "issued" and len(yes) < approval.approvals_needed(cn["amount"]):` 检查 1:已签发的必须批够人数。比如 CN-0003 金额 444.14,需要 2 个人。
- `if any(n.strip().lower() in AGENTS for n in names) or len(set(names)) != len(names):` 检查 2:审批人里不能有 Agent(`strip` 和 `lower` 是 Day 690 练习 3 的教训),同一个人不能出现两次(`set` 去重后变短就是有重复)。
- `if cn["status"] == "rejected" and not any(a["decision"] == "reject" for a in approval.approvals_of(conn, cn["id"])):` 检查 3:被驳回的必须有一条驳回记录,谁驳回的、为什么,都在里面。
- `if not conn.execute("SELECT 1 FROM credit_note_requests WHERE credit_note_id = ?", (cn["id"],)).fetchone():` 检查 4:每张贷记单都必须有幂等键记录,也就是必须是图起草的。手工塞的单子没有。
- `for inv in {cn["invoice_id"] for cn in notes}:` 检查 5:按发票分组,集合推导去重。
- `if credited > paid:` 已批准加已签发的合计超过实际扣款。比如 `INV-0001-05` 扣款 174.90,已签发 174.90,有人再塞一张 50.00,合计 224.90 就违规。
- `"ON c.id = q.credit_note_id WHERE c.status != 'rejected' GROUP BY 1, 2 HAVING n > 1"):` 检查 6:同一个案件、同一张发票上,不能有两张还活着(没被驳回)的贷记单。这是幂等键该保证的事,体检不信它。
- `sys.exit(1 if problems else 0)` 有违规就以非零状态退出,可以放进定时任务或者 CI。

</div>

```bash
uv run python -m scripts.audit_credit
```

```text
体检 4 张贷记单,违规 0 条
```

### 给体检找茬

体检脚本本身也是代码,会有漏洞。办法是**故意破坏**:在库的副本上手工做 7 种破坏,看每种能不能被抓住。破坏全部是直接写库,绕过 `decide` 和 `issue`,正是体检想防的。

```python
# billsleuth/scratch/week99_sabotage.py  给体检脚本找茬:在库的副本上手工做 6 种破坏,每种体检能不能抓出来
import os
import shutil
import tempfile

from billsleuth.db import ROOT, connect
from scripts.audit_credit import audit

SABOTAGE = {
    "有人直接改库,把 CN-0003(444.14)的 bob 那条批准删了": "DELETE FROM approvals WHERE credit_note_id = 'CN-0003' AND approver = 'bob'",
    "把驳回的 CN-0004 直接改成已签发": "UPDATE credit_notes SET status = 'issued' WHERE id = 'CN-0004'",
    "手工塞一条 Agent 的批准记录": "INSERT INTO approvals (credit_note_id, approver, decision, comment, decided_at) VALUES ('CN-0001','agent ','approve','','t')",
    "同一张发票再塞一张已签发的贷记单": "INSERT INTO credit_notes VALUES ('CN-9001','INV-0001-05','50.00','手工补录的一张已签发','issued')",
    "删掉 CN-0002 的幂等键记录": "DELETE FROM credit_note_requests WHERE credit_note_id = 'CN-0002'",
    "把 CN-0004 的驳回记录改成批准": "UPDATE approvals SET decision = 'approve' WHERE credit_note_id = 'CN-0004'",
    "把已签发的 CN-0001 金额从 174.90 改小成 100.00": "UPDATE credit_notes SET amount = '100.00' WHERE id = 'CN-0001'",
}
tmp = tempfile.mkdtemp()
for name, sql in SABOTAGE.items():
    shutil.copy(ROOT / "billing.db", f"{tmp}/b.db")
    os.environ["BILLSLEUTH_DB"] = f"{tmp}/b.db"
    with connect() as c:
        c.execute(sql)
        found = audit(c)
    print(f"{'抓到' if found else '漏了'}  {name}")
    for f in found:
        print("       ", f)
shutil.rmtree(tmp)
```

<div class="line-notes">

- `SABOTAGE = {` 每一项:一句话描述破坏,加上一条直接执行的 SQL。
- `"有人直接改库,把 CN-0003(444.14)的 bob 那条批准删了": "DELETE FROM approvals WHERE credit_note_id = 'CN-0003' AND approver = 'bob'",` 破坏 1:两人审批的单子,只剩一个人的批准,但状态仍是已签发。检查 1 应该抓到。
- `"把驳回的 CN-0004 直接改成已签发": "UPDATE credit_notes SET status = 'issued' WHERE id = 'CN-0004'",` 破坏 2:被驳回的单子起死回生,而且没有人批准它。
- `"手工塞一条 Agent 的批准记录": "INSERT INTO approvals (credit_note_id, approver, decision, comment, decided_at) VALUES ('CN-0001','agent ','approve','','t')",` 破坏 3:名字是 `agent `(末尾有空格),用的就是 Day 690 练习 3 里那个漏洞的写法。
- `"同一张发票再塞一张已签发的贷记单": "INSERT INTO credit_notes VALUES ('CN-9001','INV-0001-05','50.00','手工补录的一张已签发','issued')",` 破坏 4:这一条会同时触发好几条检查。
- `"把已签发的 CN-0001 金额从 174.90 改小成 100.00": "UPDATE credit_notes SET amount = '100.00' WHERE id = 'CN-0001'",` 破坏 7:状态、审批、额度全都合规,只是金额被悄悄改了。这是体检的盲区,看看它漏不漏。
- `shutil.copy(ROOT / "billing.db", f"{tmp}/b.db")` 每种破坏都从干净的库重新来,互不影响。
- `found = audit(c)` 破坏之后立刻体检。
- `print(f"{'抓到' if found else '漏了'}  {name}")` 有违规就是抓到,空列表就是漏了。

</div>

```bash
uv run python -m scratch.week99_sabotage
```

```text
抓到  有人直接改库,把 CN-0003(444.14)的 bob 那条批准删了
        CN-0003 已签发但只有 1 个人批准(需要 2)
抓到  把驳回的 CN-0004 直接改成已签发
        CN-0004 已签发但只有 0 个人批准(需要 2)
抓到  手工塞一条 Agent 的批准记录
        CN-0001 的审批人里有 Agent 或同一个人批了两次:['alice', 'agent ']
抓到  同一张发票再塞一张已签发的贷记单
        CN-9001 已签发但只有 0 个人批准(需要 1)
        CN-9001 没有幂等键记录,不是图起草的
        INV-0001-05 已批准或已签发的贷记合计 224.90 超过实际扣款 174.90
抓到  删掉 CN-0002 的幂等键记录
        CN-0002 没有幂等键记录,不是图起草的
抓到  把 CN-0004 的驳回记录改成批准
        CN-0004 是 rejected 但没有驳回记录
漏了  把已签发的 CN-0001 金额从 174.90 改小成 100.00
```

7 种里抓到 6 种。第 4 种一次触发了三条检查,说明规矩之间有重叠,这是好事:漏掉一条还有别的兜着。漏掉的是最后一种:金额被悄悄改小。状态、审批人数、额度都合规(100.00 小于 174.90),体检不知道这张单子「本来是多少」。

有一条线索一直躺在库里:幂等键是 `案件号:发票号:金额`,**起草时的金额就记在键里**。拿键里的金额和单子现在的金额对一下,就能发现被改过(练习 2)。这个盲区是写体检时没想到的,靠故意破坏才暴露,也是为什么每次加规则都要配一次破坏。

## 本周错题与坑清单

按天整理,每一条都是真踩过的,不是编的。

| 天 | 坑 | 怎么发现的 | 怎么防 |
| --- | --- | --- | --- |
| 686 | 模型写的解释里金额抄错或自己算出来 | 实验:14 个金额里 5 个在工具结果里找不到出处 | 证据由代码从结构化结果里抽,编号,模型只能引用编号 |
| 686 | 按客户说的金额找发票,一次找出好几张 | 用 `interrupt_before` 让真模型只跑前两段,看候选发票 | 金额加月份一起匹配 |
| 687 | 路由、催交、转人工这些出错路径,真模型很少走 | 想测「连续两次不交卷」测不到 | 假模型按剧本念台词,一分钱不花走通每条路径 |
| 687 | 16/16 命中看着漂亮 | 发票号一致只有 15/16(S023),题目也偏简单 | 全对不等于好用,评测集要有难题(Day 693) |
| 688 | 减号和连字符长得一样,金额前面的「-」不好认 | 写校验器时拿真草稿试 | 规则里分开处理,并写测试 |
| 688 | 模型编出了证据里没有的 360.00 | 16 份草稿 442 个金额里 8 个孤儿 | 数字溯源校验器,抓出来交回重写 |
| 689 | 校验器把两笔同样金额的证据合成一条 | 加压后 S023 三稿都没过,查原因 | 用列表保留重复,按证据配对,补一条测试 |
| 689 | 数字是真的、用错了地方,通用校验器全放行 | 盲区实验:10 份改过的草稿通用校验器放行 10 份 | 专门检查 `key_fact_problems` 看结论里最要紧的那个数 |
| 690 | 以为「模型会错」所以要代码起草,实验里模型一次没错 | 80 次调用全对 | 理由换成「结果可证明、工具表里没有写工具」 |
| 690 | 审批人名字黑名单只比大小写 | 练习 3 试 `"agent "` | 先 `strip()`,身份应该来自登录态 |
| 691 | 老去重只看 draft,批准后重放多出一张 | `dedupe_gap` 实验:部分冲正两张,全额冲正贷记 349.8 | 幂等键 + 查键和插入同一把写锁 + 额度算上已批准的 |
| 691 | 普通 `BEGIN` 并发时 `database is locked` | 8 线程并发 10 轮,5 轮报错 | `BEGIN IMMEDIATE` |
| 691 | 起草失败时图仍进审批节点,`KeyError` | 写测试时 3 条红 | 条件边:失败的路径不进下一个节点 |
| 691 | 节点里抛审批人的错,下一个审批人收到上一个人的错 | 两人审批的测试里 bob 那步红了 | 接住用户输入错误,写进状态,回到原地继续等 |
| 691 | `credit_target` 在重复开票上选错发票 | 真模型开案件,`show` 里复算差额 0.00 | 证据不能唯一确定就返回 `None`,转人工 |
| 692 | 体检没抓到「金额被改小」 | 第 7 种破坏 | 键里的金额和现在的金额对一下 |

这张表本身也是一份很好的面试素材。每一行都是「我遇到过什么,怎么发现的,怎么防」,比空讲原则有说服力得多。

## 默写

合上文章,默写 `approval.decide`:四项前置检查(decision 合法、审批人不是 Agent、驳回有原因)、事务里查表、同一个人不能批两次、插入审批记录、算新状态、带旧状态更新。写在 `scratch/recall_decide.py`,然后用判卷脚本把你的 `decide` 换进 `approval` 模块,跑 `tests/test_approval.py`:

```python
# billsleuth/scratch/check_recall_decide.py  把默写的 decide 换进 approval 模块,跑 tests/test_approval.py 那 19 条
import sys

import pytest

from billsleuth import approval
from scratch import recall_decide

approval.decide = recall_decide.decide      # 测试里调的是 approval.decide,这里换成默写版
sys.exit(pytest.main(["tests/test_approval.py", "-q", "-p", "no:cacheprovider"]))
```

<div class="line-notes">

- `approval.decide = recall_decide.decide      # 测试里调的是 approval.decide,这里换成默写版` 测试文件里调的是 `approval.decide(...)`,这个名字在调用时才去模块里查,换掉就生效。
- `sys.exit(pytest.main(["tests/test_approval.py", "-q", "-p", "no:cacheprovider"]))` 在同一个进程里直接跑 pytest,`pytest.main` 的返回值就是退出码。`-p no:cacheprovider` 不写 `.pytest_cache`。

</div>

参考答案(你的写法不必一样,过测试就行):

```python
# billsleuth/scratch/recall_decide.py  默写:approval.decide。合上文章写,写完用 check_recall_decide.py 对照 19 条测试
import sqlite3
from datetime import datetime, timezone

from billsleuth import approval
from billsleuth.db import immediate


def decide(conn: sqlite3.Connection, cn_id: str, approver: str, decision: str, comment: str) -> dict:
    approver = approver.strip()
    if decision not in ("approve", "reject"):
        raise ValueError("decision 只能是 approve 或 reject")
    if not approver or approver.lower() in ("agent", "billsleuth"):
        raise PermissionError("Agent 不能审批自己起草的贷记单")
    if decision == "reject" and not comment.strip():
        raise ValueError("驳回必须写原因")
    with immediate(conn):
        cn = conn.execute("SELECT * FROM credit_notes WHERE id = ?", (cn_id,)).fetchone()
        if cn is None:
            raise LookupError(f"没有贷记单 {cn_id}")
        rule = approval.RULES[(cn["status"], decision)]
        if rule == "deny":
            raise PermissionError(f"{cn_id} 现在是 {cn['status']},不能 {decision}")
        if rule == "noop":
            return {"credit_note_id": cn_id, "status": cn["status"], "note": "已经处理过,这次不变"}
        done = approval.approvals_of(conn, cn_id)
        if any(a["approver"] == approver for a in done):
            raise PermissionError(f"{approver} 已经审过这张,需要另一个人")
        conn.execute("INSERT INTO approvals (credit_note_id, approver, decision, comment, decided_at) VALUES (?,?,?,?,?)",
                     (cn_id, approver, decision, comment, datetime.now(timezone.utc).isoformat(timespec="seconds")))
        if decision == "reject":
            status = "rejected"
        else:
            yes = sum(1 for a in done if a["decision"] == "approve") + 1
            status = "approved" if yes >= approval.approvals_needed(cn["amount"]) else "draft"
        conn.execute("UPDATE credit_notes SET status = ? WHERE id = ? AND status = 'draft'", (status, cn_id))
        return {"credit_note_id": cn_id, "status": status}
```

<div class="line-notes">

- `approver = approver.strip()` 清洗放在最前面,Day 690 练习 3 的修法。
- `if decision not in ("approve", "reject"):` 动作合法。
- `if not approver or approver.lower() in ("agent", "billsleuth"):` Agent 或空名字拒绝。
- `if decision == "reject" and not comment.strip():` 驳回要写原因。
- `with immediate(conn):` 后面的读和写都在同一把写锁里。
- `rule = approval.RULES[(cn["status"], decision)]` 查表,表放在 `approval` 模块里,这里直接用。
- `done = approval.approvals_of(conn, cn_id)` 已有的审批记录,这时还没插入新的。
- `yes = sum(1 for a in done if a["decision"] == "approve") + 1` 注意最后的 `+ 1`:`done` 是插入之前取的,不含这一次,所以要加上。漏了这个 `+ 1` 就是下面要故意默错的那一处。
- `status = "approved" if yes >= approval.approvals_needed(cn["amount"]) else "draft"` 够人数才变 `approved`。
- `conn.execute("UPDATE credit_notes SET status = ? WHERE id = ? AND status = 'draft'", (status, cn_id))` 带旧状态做条件。

</div>

```bash
uv run python -m scratch.check_recall_decide
```

```text
...................                                                      [100%]
19 passed in 0.48s
```

故意默错一处,把 `+ 1` 去掉(也就是忘了把这一次的批准算进去):

```text
tests/test_approval.py:87: AssertionError
=========================== short test summary info ============================
FAILED tests/test_approval.py::test_state_machine_cell[draft-approve-do-approved]
FAILED tests/test_approval.py::test_two_person_rule_and_same_person_twice - A...
2 failed, 17 passed in 0.42s
```

红两条:最基本的「草稿被批准后变 `approved`」和两人审批那条。点名的是格子 `draft-approve`,一眼能看出错在批准这个动作的计数上。Day 685 默写时说过,写松一条测试不一定会红,所以默写完要故意改错一处,确认判卷的测试真的能抓到。

## 今天的文件

| 文件 | 做什么 |
| --- | --- |
| `scratch/week99_flow.py` | 假模型把 6 个场景完整跑一遍(含审批) |
| `scripts/audit_credit.py` | 贷记单体检,六条检查 |
| `scratch/week99_sabotage.py` | 7 种破坏,看体检抓不抓得到 |
| `scratch/recall_decide.py`、`scratch/check_recall_decide.py` | 默写和判卷 |
| `scratch/ex2_key_check.py`、`scratch/ex3_no_draft_call.py` | 练习 2、3 |
| `tests/test_week99.py` | 练习 4:小项目变成回归测试 |

测试总数 348 条(347 加练习 4 的 1 条)。今天真模型花费 ¥0。

## 动手练习

1. 默写 `decide` 并判卷(上面已经做了一遍,参考答案里再做一件事:故意默错两种不同的写法,各看红几条)。
2. 补体检的第 7 条:拿幂等键里的发票号和金额,和贷记单现在的发票号、金额对一下,抓住「金额被改小」。
3. 用审计日志回答:哪些案件调过 `draft_credit_note`,哪些一次都没调,和你预期的对得上吗?
4. 把小项目变成一条回归测试:6 个场景走完整条流程,体检必须 0 违规。

<details><summary>参考答案</summary>

**练习 1**

再默错一种:`RULES` 查了,却忘了处理 `noop`,让它落到后面继续执行。把 `if rule == "noop":` 那两行删掉再判卷:

```text
FAILED tests/test_approval.py::test_state_machine_cell[approved-approve-noop-approved]
FAILED tests/test_approval.py::test_state_machine_cell[issued-approve-noop-issued]
FAILED tests/test_approval.py::test_state_machine_cell[rejected-reject-noop-rejected]
3 failed, 16 passed in 0.58s
```

这是我把 `noop` 那两行从默写版里删掉以后实际跑出来的:`noop` 的三个格子都会往 `approvals` 里多插一条记录,测试里 `n_approvals` 那一行抓到的就是这个。

**练习 2**

```python
# billsleuth/scratch/ex2_key_check.py  练习 2:体检漏了「金额被改小」。幂等键里记着起草时的金额,拿它和现在的金额对一下
import os
import shutil
import sqlite3
import tempfile

from billsleuth.db import ROOT, connect


def key_mismatch(conn: sqlite3.Connection) -> list[str]:
    """键是 案件号:发票号:金额。起草之后贷记单的发票号、金额不该再变。"""
    bad = []
    for r in conn.execute("SELECT q.idempotency_key, c.id, c.invoice_id, c.amount FROM credit_note_requests q "
                          "JOIN credit_notes c ON c.id = q.credit_note_id"):
        _, inv, amount = r["idempotency_key"].rsplit(":", 2)
        if (inv, amount) != (r["invoice_id"], r["amount"]):
            bad.append(f"{r['id']} 起草时是 {inv} {amount},现在是 {r['invoice_id']} {r['amount']}")
    return bad


if __name__ == "__main__":
    tmp = tempfile.mkdtemp()
    shutil.copy(ROOT / "billing.db", f"{tmp}/b.db")
    os.environ["BILLSLEUTH_DB"] = f"{tmp}/b.db"
    with connect() as c:
        print("原库:", key_mismatch(c) or "对得上")
        c.execute("UPDATE credit_notes SET amount = '100.00' WHERE id = 'CN-0001'")
        print("改小以后:", key_mismatch(c))
    shutil.rmtree(tmp)
```

<div class="line-notes">

- `def key_mismatch(conn: sqlite3.Connection) -> list[str]:` 和 `audit` 一样返回违规描述的列表。写成独立函数,验证通过后可以并进 `audit`。
- `for r in conn.execute("SELECT q.idempotency_key, c.id, c.invoice_id, c.amount FROM credit_note_requests q "` 把键和它对应的贷记单现在的样子连起来。
- `_, inv, amount = r["idempotency_key"].rsplit(":", 2)` 从右边切两刀。键是 `case-63131b9d:INV-0001-05:174.90`,切完是 `case-63131b9d`、`INV-0001-05`、`174.90`;用 `rsplit` 从右切,是为了案件号里将来万一出现冒号也不影响。`_` 是不要的那一项。
- `if (inv, amount) != (r["invoice_id"], r["amount"]):` 元组整体比较:发票号和金额只要有一个变了就违规。金额存的是字符串 `"174.90"`,键里切出来的也是字符串,所以能直接比,这也是 Day 680 把金额存成 TEXT 的好处。
- `c.execute("UPDATE credit_notes SET amount = '100.00' WHERE id = 'CN-0001'")` 复现破坏 7。

</div>

```text
原库: 对得上
改小以后: ['CN-0001 起草时是 INV-0001-05 174.90,现在是 INV-0001-05 100.00']
```

原库对得上,改小以后被抓住。这个检查也有局限:如果有人同时改了贷记单金额和键里的金额(两处一起改),它就漏了,所以体检从来不是「万无一失」,是尽量多设几道独立的关卡,而且最终要靠权限把直接改库的路堵上。

**练习 3**

```python
# billsleuth/scratch/ex3_no_draft_call.py  练习 3:审计日志里,哪些案件调过 draft_credit_note,哪些一次都没调
from billsleuth.db import connect

SQL = """
SELECT session_id,
       SUM(tool = 'draft_credit_note') AS drafts,
       COUNT(*) AS calls
FROM audit_log
WHERE session_id LIKE 'case-%'
GROUP BY session_id
ORDER BY MIN(id)
"""
with connect() as c:
    for r in c.execute(SQL):
        print(f"{r['session_id']}  工具调用 {r['calls']:>2} 次,起草 {r['drafts']} 次")
```

<div class="line-notes">

- `SUM(tool = 'draft_credit_note') AS drafts,` SQLite 里布尔表达式的结果是 0 或 1,对它求和就是「满足条件的行数」。
- `COUNT(*) AS calls` 这个案件一共调了几次工具。
- `WHERE session_id LIKE 'case-%'` 只看图开出来的案件,不看审批人 `show` 时记的 `approver:alice`。
- `GROUP BY session_id` 一个案件一行。
- `ORDER BY MIN(id)` 按每个案件第一次调用的先后排序,和跑的顺序一致。

</div>

```text
case-63131b9d  工具调用  4 次,起草 1 次
case-976dc0d7  工具调用  4 次,起草 1 次
case-b5afe710  工具调用  4 次,起草 1 次
case-dc42e2ff  工具调用  4 次,起草 1 次
case-ae1a9e60  工具调用  3 次,起草 0 次
case-fcba45bb  工具调用  3 次,起草 0 次
```

和预期对得上:前四个案件(S001、S017、S024、S002)各起草 1 次,S023(转人工)和 S003(账没错)起草 0 次。工具调用 4 次是 `list_invoices`(locate 节点)加 `recompute_invoice`、`list_payments`、`draft_credit_note`;后两个少了起草那一次,是 3 次。审计日志是体检之外的第二个独立证据来源:库里的结果和日志里的调用对得上,才说得通。

**练习 4**

```python
# billsleuth/tests/test_week99.py  练习 4:把第 99 周小项目变成回归测试:6 个场景走完整条流程,体检必须 0 违规
import pytest

from billsleuth.db import connect
from scratch.week99_flow import PLAN, run_scenario
from scripts.audit_credit import audit


@pytest.fixture(autouse=True)
def _env(fresh_db, tmp_path, monkeypatch):
    monkeypatch.setenv("BILLSLEUTH_CHECKPOINTS", str(tmp_path / "cp.db"))


def test_six_scenarios_end_to_end_then_audit_is_clean():
    results = {sid: run_scenario(sid, who) for sid, who in PLAN.items()}
    assert [results[s]["status"] for s in PLAN] == ["issued", "issued", "issued", "rejected", "blocked", None]
    assert results["S023"]["escalated"] and not results["S003"]["escalated"]
    with connect() as c:
        assert audit(c) == []
        assert c.execute("SELECT COUNT(*) FROM credit_notes").fetchone()[0] == 4   # S023 和 S003 一张都没开
```

<div class="line-notes">

- `def _env(fresh_db, tmp_path, monkeypatch):` 一个 fixture 里同时用到三个:干净的库(`conftest.py`)、临时目录、环境变量替换。`autouse=True` 让本文件每条测试自动用上。
- `monkeypatch.setenv("BILLSLEUTH_CHECKPOINTS", str(tmp_path / "cp.db"))` checkpoint 放进临时目录,不污染项目里的 `checkpoints.db`。
- `results = {sid: run_scenario(sid, who) for sid, who in PLAN.items()}` 字典推导式,`PLAN` 里 6 个场景依次跑完。
- `assert [results[s]["status"] for s in PLAN] == ["issued", "issued", "issued", "rejected", "blocked", None]` 六个场景最后的状态,按 `PLAN` 的顺序:S001、S017、S024 签发,S002 驳回,S023 卡住,S003 没有审批所以是 `None`。
- `assert results["S023"]["escalated"] and not results["S003"]["escalated"]` S023 转人工,S003 不转:账没错不是需要人看的事。
- `assert audit(c) == []` 体检 0 违规。
- `assert c.execute("SELECT COUNT(*) FROM credit_notes").fetchone()[0] == 4` 库里只有 4 张:转人工和账没错的都没有贷记单。

</div>

```bash
uv run pytest tests/test_week99.py -q
uv run pytest -q
```

```text
.                                                                        [100%]
1 passed in 10.53s
...
348 passed in 41.25s
```

一条测试 10 秒,是这周最慢的,因为跑了 6 个完整的案件(每个都要开 checkpoint 库、过几十次工具调用)。它抓的是「几个零件各自都对,拼在一起不对」:比如有人改了 `graph.py` 里一条边,单测都过,这条会红。

</details>

**验收标准:** `week99_flow` 和 `audit_credit` 能跑通,体检 0 违规;`week99_sabotage` 抓到 6 种、漏 1 种,并能说清漏的是哪种、为什么漏;默写的 `decide` 过 19 条测试,故意默错能看到红;练习 2 补上第 7 条;`uv run pytest -q` 全绿(348 条);能对着知识地图说出六天各守住哪类错误。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 体检(audit) | 不信流程代码,只看库里的结果,逐条核对规矩有没有被违反 |
| 破坏性测试 | 故意做坏事,看防线抓不抓得住。相当于给检查脚本做的测试 |
| 回归测试 | 以前对过的行为,每次改动后自动再验一遍,防止改坏 |
| 端到端测试 | 从入口走到出口的整条流程测试,不拆零件 |
| 盲区 | 现有检查看不到的那一类错误,要靠故意构造才能发现 |
| 独立关卡 | 不依赖同一份代码或同一份数据的检查。关卡越独立,一起失效的可能越小 |
| 错题清单 | 把踩过的坑按「现象、发现方式、预防办法」整理成表 |

## 常见误区

**测试全绿就等于库里是对的。** 测试证明代码走正门不会出错,库里的数据可能来自别的路径:直接改库、迁移、别的服务。体检看结果,测试看过程,两样都要。

**体检写完就不管了。** 体检本身也是代码,也有盲区。每加一条规则,就配一种能触发它的破坏;每种新想到的破坏,先看现有规则漏不漏。

**检查逻辑直接复用流程代码里的常量。** 体检里的 `AGENTS` 黑名单我故意又写了一份。要是体检直接 import 流程代码里的那份,流程里改松了,体检跟着松,什么也没守住。(`approvals_needed` 是个例外,复用它是因为门槛本来就该只有一个出处。)

**复习日只重读。** 重读容易觉得「我都会」。默写、故意默错、做体检,是把「看懂」变成「能写出来」。

**错题清单只写结论,不写怎么发现的。** 「要加幂等键」谁都会说,「我用 8 个线程跑了 10 轮,5 轮报 database is locked」才能让人信服,也才能让下一次遇到类似问题时知道从哪里入手。

## 学习资料

### 文档与文章

- [Hamel Husain · Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/):怎么用评测集持续监控 Agent,体检和评测是同一个思路在不同层上的应用,25 分钟。
- [pytest · 参数化](https://docs.pytest.org/en/stable/how-to/parametrize.html):今天和前几天都用了 `parametrize`,系统看一遍它的用法,15 分钟。
- [pytest · monkeypatch](https://docs.pytest.org/en/stable/how-to/monkeypatch.html):`setenv`、`setattr` 的用法,本周测试里到处都是,15 分钟。
- [SQLite · CREATE TABLE](https://www.sqlite.org/lang_createtable.html):`CHECK`、`PRIMARY KEY`、`REFERENCES` 的约束写法,看它们在数据库层挡住哪些脏数据,20 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Yt376TEUC&autoplay=0&high_quality=1" title="03.让Agent可审批、可恢复、可重放,LangGraph进阶" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>是的iamrio · 03.让Agent可审批、可恢复、可重放,LangGraph进阶 · 11 分钟,把本周 Day 691 的暂停、恢复、重放串起来再看一遍。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ACAuzdE5U&autoplay=0&high_quality=1" title="订单状态机怎么设计？90%后端都写错，架构师标准方案来了！" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>java架构师百里 · 订单状态机怎么设计?90%后端都写错,架构师标准方案来了! · 3 分钟,回看 Day 690 的「状态 × 动作」表格式设计。</figcaption>
</figure>

### 其他经典视频

今天这组不需要:复习日不引入新的概念,上面两个视频是本周内容的回看。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):评估相关的章节,对应下一周的评测集和模拟客户。
- Martin Kleppmann《Designing Data-Intensive Applications》(O'Reilly, 2017;中文版《数据密集型应用系统设计》,中国电力出版社,2018):第 7 章「事务」和第 11 章,本周幂等、并发、重放那些坑的理论底子。

### 开源项目与代码

- [pytest-dev/pytest](https://github.com/pytest-dev/pytest):本周用到的 fixture、`parametrize`、`monkeypatch` 都在里面,有兴趣可以读 `monkeypatch` 的实现,几百行。

## 自测

1. 测试和体检各自检查什么?为什么两样都要?

<details><summary>答案</summary>

测试检查流程代码「会不会做错」,走的是正门,比如从 `decide` 进去不可能签发没人批的单子。体检检查库里「现在有没有错」,不管数据是怎么来的,能抓到直接改库、别的写入路径、迁移改坏数据这类绕过流程代码的情况。只有测试,绕过正门的错抓不到;只有体检,等发现时错已经发生了。

</details>

2. 体检抓到 7 种破坏里的 6 种。漏掉的是哪种,为什么漏,怎么补?

<details><summary>答案</summary>

漏的是「已签发的贷记单金额被悄悄改小」。状态是 `issued`、批准人数够、合计没超过实际扣款、有幂等键记录,六条检查都合规,体检不知道这张单子「本来是多少」。补法是利用幂等键里记着的起草时金额,和现在的金额对比,不一致就违规。局限是如果两处同时被改就漏;所以要多设独立的关卡,并从权限上堵住直接改库。

</details>

3. 本周有两个 bug 是「写测试时才发现的」,是哪两个?它们说明了什么?

<details><summary>答案</summary>

一是起草失败(兜底、没证据、超额度)时,图仍无条件进了 `await_approval`,`KeyError`:失败的路径漏了出口。二是审批人的错(同一个人批两次)在节点里抛出异常,恢复值被存进 checkpoint,下一个审批人收到上一个人的错。共同点是:正常路径上看不出来,只有把失败路径、两人审批这类「不顺」的情形也各写一条测试,才会暴露。

</details>

4. Day 690 实验里模型起草 80 次全对,为什么还选代码起草?这个选择会在什么情况下被推翻?

<details><summary>答案</summary>

理由不是准确率:输入是用标准答案造的干净数据,真实结论可能带错的发票号,代码起草前可以再用证据核对;代码的行为可以用测试钉住,模型会随换模型、改提示词而变;模型工具表里没有写工具,就不存在被诱导调用它的问题。可能被推翻的情形:如果有大规模评测集证明模型起草在真实证据链上同样可靠,而且代码的核对逻辑变成了维护负担(比如发票选择规则越来越复杂),可以考虑让模型起草、代码只做校验。但推翻也要靠评测数据,不是靠感觉。

</details>

5. 面试题:你负责一个会动钱的 Agent。上线前领导问「怎么保证不会出事故」。结合本周内容,你怎么回答?

<details><summary>答案</summary>

分层回答,每层对应一种具体机制,并且说明怎么验证。第一,模型不碰写操作:工具表里只有只读工具,起草由代码做,金额只能是过了溯源检查的结论值。第二,每一步都有独立的检查:数字溯源校验、结论里最要紧的数的专门检查、证据不唯一就转人工。第三,动钱的规矩写成状态机表,12 个格子逐个测试;人的规则(Agent 不能批、同一人不能批两次、大额两人批)有代码也有测试。第四,重放和并发:幂等键、写锁、唯一约束,并发测试一直留在套件里。第五,上线后有体检:每天扫库,看有没有绕过流程的结果,有违规就告警。最后要说明没覆盖的:模型把原因讲错这类语义错误,靠评测集和人工抽检,以及审批人是「看复算证据」而不是「看 Agent 结论」。每一条我都能给出本周对应的实验或测试作为证据。

</details>

6. 为什么体检里的 `AGENTS` 黑名单要和 `approval.py` 里各写一份,而不是 import 同一份?

<details><summary>答案</summary>

体检是独立关卡,价值在于不依赖被检查的代码。如果 import 流程里的同一份,流程里有人把黑名单改松了(比如删掉了某个名字),体检跟着松,两道关卡一起失效。各写一份,改动流程代码不会自动改动体检,体检就还能抓到。代价是要维护两份,所以体检里的规则要尽量少、尽量简单,并在改流程规则时人工想一下要不要同步。

</details>

## 明天预告

明天是 Day 693 · BillSleuth(十二):100 个场景和模拟客户。本周把「一次调查从头到尾走通」做完了,可是「它到底好不好」还没有答案:16/16 命中是因为题目简单,S023 的发票号口径还没定,贷记单开在哪张发票上、有没有误冲正都要单独算。下周从评测集开始:100 个场景怎么分层,模拟客户怎么追问,再把今天体检用到的「破坏」思路带进评测,看哪些场景最容易把 Agent 难住。
