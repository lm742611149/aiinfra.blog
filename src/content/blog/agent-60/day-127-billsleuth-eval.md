---
title: 'Day 127 · BillSleuth(六):100 个场景的评测与模拟客户'
description: '给 BillSleuth 建一套能复现的评测:Day 122 造的 100 个场景(12 类根因 80 个，四种「账其实没错」20 个),一个会着急、会记错数字、会追问的 LLM 模拟客户，一组纯规则的判分(根因、多收金额、发票号、动作、数字幻觉、误冲正、漏冲正、转人工),每次试验在独立进程里从干净的库副本开始，结果带置信区间和 pass^k。顺便回答 Day 124 留下的问题：结论多写了原发票号算不算对。'
pubDate: 2026-10-15
regime: none
tags: ['evaluation', 'user-simulation', 'pass-k', 'billing', 'agent-60']
series: 'agent-60'
day: 127
lang: 'zh'
---

## 今天要解决的问题

昨天 BillSleuth 学会了起草贷记单、在审批节点暂停。到现在为止，我们对它好不好用的判断来自 Day 124 手挑的 16 个场景：每类根因一个，全对。Day 124 当时就说了，这不说明什么：样本是挑的，每个只跑了一次，客户原话是造数脚本写死的模板。

今天把评测搭起来。和 Day 50 给 SupportPilot 做的评测相比，有三点不同。第一，所有指标都是**确定性规则**,不用 LLM 评审：计费场景有标准答案，根因是哪一类、多收多少分钱、贷记单开在哪张发票上，全都能精确比对。第二，客户不再是一句写死的原话，而是一个 LLM 扮演的**模拟客户**,有人设，会记错数字，会追问，这是 Day 73 拆 τ-bench 时学到的做法。第三，每个数字都带**置信区间**,用 Day 69 的统计工具。

学完今天，你应该能：

1. 说清楚 100 个场景怎么分布，场景文件里哪些字段给模拟客户看、哪些只给判分器看。
2. 写出模拟客户：按人设生成开场白、故意带错误信息、根据回复决定追问还是结束，并知道模拟客户本身会带来哪些偏差。
3. 实现判分函数，以及「一次运行算成功」的定义，包括 S023 那种多写了发票号的情况怎么判。
4. 写出能断点续跑、每次在独立进程里从库副本开始、对 503 和超时有韧性的评测脚本。
5. 读懂一份带 Wilson 区间、聚类区间和 pass^k 的报告，知道什么时候结论还不能下。

预计用时 5–6 小时，其中跑全量评测要一两个小时，可以挂着先做别的。前置:Day 29(pass^k)、Day 33(模拟用户)、Day 69(评测统计)、Day 73(benchmark 设计)、Day 122(场景造数)、Day 124–126。

## 评测集：100 个场景

Day 122 的造数脚本已经把场景写好了，在 `scenarios/S001.json` 到 `S100.json`。一个场景长这样：

```json
{
  "id": "S001",
  "customer_id": "C-0001",
  "as_of": "2026-10-15",
  "question": "我们早就申请取消订阅了,怎么 9 月还扣了 174.90 美元?",
  "truth": {
    "root_cause": "cancel_not_respected",
    "variant": "cancel_not_respected",
    "invoice_ids": ["INV-0001-05"],
    "overcharge": "174.90",
    "expected_action": "credit_note",
    "detail": "订阅已在 2026-09-25 到期取消,INV-0001-05 不应该开出"
  }
}
```

`question` 是客户能说出来的话。`truth` 整个是标准答案，只给判分器看，绝不能出现在 Agent 或模拟客户的输入里，也不能出现在演示接口的返回里，Day 129 会专门写测试保证这一点。尤其注意 `detail`:它写的就是根因，泄露一句，评测就失真了。

分布是 Day 122 定好的：80 个有错，12 类根因轮流分配，前 8 类各 7 个、后 4 类各 6 个；20 个 `no_error`,分四种 variant(`upgrade_proration`、`tax_line`、`coupon_ended`、`annual_renewal`)各 5 个。

为什么要两成「账其实没错」?因为这是误冲正的主战场。一个「客户说多收了，那就冲吧」的讨好型 Agent,在 80 个有错的场景上可能表现不差，在这 20 个上会全军覆没。这四种 variant 也是真实客服里最常见的误解：升级后多了两行看不懂的折算、发现多了一笔税、优惠券到期以后账单变贵、年付续费一次扣了一大笔。

Day 73 讲过，任务要有「参考解必须过、空 Agent 必须挂」的自检。复算工具能不能把每个场景的差额算出来，Day 123 的 `tests/test_server.py` 已经对 100 个场景逐个测过了。今天补判分器这一侧的自检：

```python
# billsleuth/billsleuth/evals/selfcheck.py
"""Day 127:评测集自检。照抄标准答案的「参考解」必须全判成功,永远说「账没错」的空 Agent 必须在有错的场景上全挂。
(复算工具能不能算出每个场景的差额,Day 123 的 tests/test_server.py 已经对 100 个场景逐个测过。)
用法:uv run python -m billsleuth.evals.selfcheck"""
from __future__ import annotations

import json

from billsleuth.db import ROOT
from billsleuth.evals.grade import grade


def reference_state(sc: dict) -> tuple[dict, list[dict]]:
    t = sc["truth"]
    ev = [{"id": "E1", "claim": "多收", "source_tool": "ref", "source_ref": t["invoice_ids"][0], "value": t["overcharge"]}]
    st = {"findings": {"root_cause": t["root_cause"], "invoice_ids": t["invoice_ids"], "overcharge": t["overcharge"],
                       "expected_action": t["expected_action"]},
          "evidence": ev, "reply": {"customer_message": f"多收了 {t['overcharge']} 美元。"}, "escalated": False}
    cns = ([{"id": "CN-REF", "invoice_id": t["invoice_ids"][0], "amount": t["overcharge"], "status": "draft"}]
           if t["expected_action"] == "credit_note" else [])
    return st, cns


NULL_STATE = {"findings": {"root_cause": "no_error", "invoice_ids": [], "overcharge": "0.00",
                           "expected_action": "explain_only"}, "evidence": [], "reply": {}, "escalated": False}


def main() -> None:
    scs = [json.loads(p.read_text()) for p in sorted((ROOT / "scenarios").glob("S*.json"))]
    problems, null_pass = [], 0
    for sc in scs:
        if not grade(sc, *reference_state(sc))["success"]:
            problems.append(f"{sc['id']}: 参考解没通过判分,检查场景字段或判分器")
        g = grade(sc, NULL_STATE, [])
        null_pass += g["success"]
        if g["success"] and sc["truth"]["root_cause"] != "no_error":
            problems.append(f"{sc['id']}: 空 Agent 居然过了一个有错的场景")
    n_err = sum(1 for s in scs if s["truth"]["root_cause"] != "no_error")
    print(f"{len(scs)} 个场景,{n_err} 个有错;空 Agent 通过 {null_pass} 个")
    print("\n".join(problems) or "自检通过")


if __name__ == "__main__":
    main()
```

`uv run python -m billsleuth.evals.selfcheck` 的输出：

```text
100 个场景,80 个有错;空 Agent 通过 0 个
自检通过
```

空 Agent 在 20 个「账没错」的场景上也没通过，这一点值得想一下：它说对了「没多收」,但没指出客户问的是哪张发票(`invoice_ids` 是空的)。我们要求即使账没错，也要说清楚是哪张发票、为什么是这个数，所以这样判是对的。

## 模拟客户

客户原话如果写死，你测的是「Agent 能不能答对这一句话」,而不是「能不能处理这类问题」。Day 122 的 `question` 是从几个模板里挑的，措辞很规整，还都带着准确的金额。真实客户不是这样说话的。

```python
# billsleuth/billsleuth/evals/customer.py
"""Day 127:模拟客户。只知道客户自己看得到的东西(场景里的原话),不知道根因;按人设说话,会记错、会着急、会追问。"""
from __future__ import annotations

import os
import random

from billsleuth.llm import get_llm

PERSONAS = [
    "说话简短、有点着急的小企业老板,只说结论不说细节",
    "很客气、会把自己看到的数字都贴出来的财务人员",
    "记性不太好的客户,会把月份或金额记错一点",
    "情绪激动、怀疑公司在乱扣钱的客户,会要求立刻退款",
]

OPENING = """你在扮演 SaaS 产品「云簿」的客户,给客服写第一条消息。
人设:{persona}
你知道的事实(你只知道自己看到的,不知道系统内部原因):{facts}
要求:一到三句话,中文,像真人发消息;{twist}不要提「系统 bug」「根因」这类词。只输出消息本身。"""

FOLLOW = """你在扮演同一个客户。客服刚回复你:
---
{reply}
---
你的真实诉求:{goal}
如果回复已经回答了你的诉求,只输出 DONE。否则用一句话追问。只输出追问或 DONE。"""


def _llm(temperature: float):
    llm = get_llm(temperature)
    if os.environ.get("SIM_MODEL"):  # 模拟客户的模型要固定;换了它就等于换了一套 benchmark
        llm.model_name = os.environ["SIM_MODEL"]
    return llm


def opening(sc: dict, trial: int) -> str:
    rng = random.Random(f"{sc['id']}-{trial}")  # 同一场景同一 trial 人设固定,方便复现
    persona = rng.choice(PERSONAS)
    twist = "故意把月份或金额说错一点;" if "记错" in persona else ""
    facts = sc.get("customer_facts") or sc["question"]  # 绝不能把 truth 里的 detail 给它,那是根因
    return str(_llm(0.9).invoke(OPENING.format(persona=persona, facts=facts, twist=twist)).content).strip()


def follow_up(sc: dict, reply: str) -> str | None:
    goal = sc.get("customer_goal") or "搞清楚为什么扣了这么多;如果多扣了,要知道钱怎么退回来"
    out = str(_llm(0.3).invoke(FOLLOW.format(reply=reply, goal=goal)).content).strip()
    return None if out.upper().startswith("DONE") else out
```

几个设计点。

**人设决定说话方式，不决定事实。** 四种人设：着急的老板、会贴数字的财务、记性不好的、情绪激动要求立刻退款的。事实只来自场景里客户能看到的东西，默认就是 `question`。可以给场景加一个可选字段 `customer_facts` 补充客户看得到的事实(比如「银行流水里同一天两笔」),但**永远不要把 `truth.detail` 给它**。

**同一个场景、同一次试验，人设固定。** `random.Random(f"{sc['id']}-{trial}")` 保证你重跑第 0 次试验时拿到的还是那个人设。开场白本身用 0.9 的温度生成，措辞每次会变，这正是我们想要的方差。

**模拟客户的模型要固定。** 环境变量 `SIM_MODEL` 单独配。换了模拟客户的模型，就等于换了一套 benchmark,前后分数不能比。

**追问由模拟客户自己判断。** Agent 回复以后，模拟客户拿着回复和自己的诉求(可选字段 `customer_goal`,默认是「搞清楚为什么扣这么多；多扣了要知道钱怎么退」),决定输出 `DONE` 还是一句追问。有追问的话，评测脚本把「开场白、上一轮回复、追问」拼成新的客户原话，开一个新的 thread 再跑一次调查。第二轮在同一个库副本上跑，第一轮起草的草稿还在，Day 123 的去重会返回同一张，正好测到昨天的幂等设计。

我用 DeepSeek 跑了 8 个场景、每个 2 次的冒烟(下面会给报告),模拟客户的表现有两点值得说。

好的一面是开场白确实变了，而且「记错」真的发生了。S004 的原话是「7 月的账单里多了两行……金额 895.97」,有一次模拟客户写成了「我看 6 月账单里突然多了『未使用时间退还』和『剩余时间』两项，一共收了八百五十多」,月份和金额都记错了。S001 的模拟客户还自己加戏，说「我们 8 月就申请取消订阅了」,原话里没有这个时间。Agent 在这两次里都还是查到了正确的发票，结论也对。

不好的一面是：15 次跑完的运行里**一次追问都没有**。Day 125 的客户版写得很完整，结论、原因、下一步都有，模拟客户每次都回 `DONE`。说明默认的 `customer_goal` 太宽松，一条像样的回复就能满足。要让追问真的发生，得给一部分场景写更具体的诉求，比如「要退回原卡，不要进余额」「要知道下个月还会不会再扣」,这些是 Agent 第一轮大概率不会主动回答的。这也提醒我们：**模拟客户本身也要评测。** 你以为在测多轮能力，其实追问根本没发生过。报告里我加了一行「有追问」的比例，是最便宜的检查。

## 判分

```python
# billsleuth/billsleuth/evals/grade.py
"""Day 127:逐条判分。全部是确定性规则,不用 LLM 评审。
输入:场景(含 truth)、调查图跑完时的状态、跑完后库里这张发票相关的贷记单。"""
from __future__ import annotations

from billsleuth import grounding
from billsleuth.llm import estimate_cost


def grade(sc: dict, st: dict, credit_notes: list[dict]) -> dict:
    t, f = sc["truth"], st.get("findings") or {}
    got_ids = f.get("invoice_ids") or []
    # 发票号怎么算对(Day 124 留下的问题,S023):标准答案里的发票都要在结论里;多写的不扣分,单独记下来。
    # 真正要求精确的是「贷记单开在哪张」,那一条在 credit_ok 里判。
    invoice_ok = set(t["invoice_ids"]) <= set(got_ids)
    live = [c for c in credit_notes if c["status"] != "rejected"]
    want = t["expected_action"] == "credit_note"
    credit_ok = (want and len(live) == 1 and live[0]["invoice_id"] in t["invoice_ids"]
                 and live[0]["amount"] == t["overcharge"])
    reply = st.get("reply") or {}
    msg = reply.get("customer_message", "")
    rep = grounding.check(msg, st.get("evidence", [])) if msg else None
    tin, tout = st.get("tokens") or [0, 0]
    row = {
        "scenario": sc["id"], "root_cause": t["root_cause"], "variant": t["variant"],
        "got_root_cause": f.get("root_cause"), "got_overcharge": f.get("overcharge"),
        "got_action": f.get("expected_action"), "got_invoices": got_ids,
        "root_ok": int(f.get("root_cause") == t["root_cause"]),
        "overcharge_ok": int(f.get("overcharge") == t["overcharge"]),
        "action_ok": int(f.get("expected_action") == t["expected_action"]),
        "invoice_ok": int(invoice_ok),
        "extra_invoices": sorted(set(got_ids) - set(t["invoice_ids"])),
        "hallucinated": int(bool(rep and rep.problems)),
        "wrong_credit": int(bool(live) and not credit_ok),   # 不该冲的冲了,或者金额、发票不对
        "missed_credit": int(want and not live),
        "escalated": int(bool(st.get("escalated"))),
        "fallback": int(bool(reply.get("fallback"))),
        "credit_notes": [{k: c[k] for k in ("id", "invoice_id", "amount", "status")} for c in credit_notes],
        "llm_calls": st.get("llm_calls", 0), "tokens_in": tin, "tokens_out": tout,
        "cost_cny": estimate_cost(tin, tout),
    }
    row["success"] = int(row["root_ok"] and row["overcharge_ok"] and row["action_ok"] and row["invoice_ok"]
                         and not row["hallucinated"] and not row["wrong_credit"] and not row["missed_credit"]
                         and not row["escalated"])
    return row
```

| 指标 | 怎么算 | 为什么要它 |
| --- | --- | --- |
| 根因 `root_ok` | 结论的类别等于标准答案 | 根因错了，修复动作会找错地方 |
| 多收金额 `overcharge_ok` | 两位小数字符串完全相等 | 差一分钱也是错，不给近似分 |
| 动作 `action_ok` | `credit_note` / `explain_only` 对得上 | 该冲的冲，不该冲的只解释 |
| 发票号 `invoice_ok` | 标准答案的发票都在结论里 | 见下面 S023 的讨论 |
| 数字幻觉 `hallucinated` | 客户版里有证据链里找不到出处的金额或百分比 | Day 125 的校验器在运行时拦，这里独立再查一遍 |
| 误冲正 `wrong_credit` | 库里有未驳回的贷记单，但不该冲，或金额、发票不对 | 代价最大的错误，单独盯 |
| 漏冲正 `missed_credit` | 该冲却没起草 | 客户会再来，代价小一些 |
| 转人工 `escalated` | 没提交合格结论，或结论金额溯源失败 | 不算错，但不算成功 |
| 兜底 `fallback` | Day 125 的写作三次都没过校验，用了模板 | 只统计，不影响成功 |

**成功**要求根因、多收金额、动作、发票号全对，没编数字，没误冲正、没漏冲正，没转人工。这个定义很严，严是故意的。「钱算对了、处理也对了，只是根因标签选了个相近的」在这里算失败，但明天的错误分析会把它单独分一个桶，这样你既不会因为标签问题误判 Agent 很差，也不会因为宽松的定义掩盖真正的问题。

**S023 那个问题：发票号怎么算对。** Day 124 跑 S023(重复开票)时，模型的结论写了原发票 `INV-0023-04` 和多开的 `INV-0023-04D` 两个号，标准答案只有多开的那张。我的判法是分两层：

- 结论里的 `invoice_ids`:标准答案里的发票必须都在，多写的不扣分，但记在 `extra_invoices` 里。理由是重复开票时提到原发票是合理的，客户本来就会问「哪两张」;解释里说清楚「04 是正常的、04D 是多开的」,比只提一张更好。
- **贷记单开在哪张**:必须精确。贷记单开在原发票上就是误冲正，哪怕金额对。这是真正会让账出错的地方，所以严格判。昨天的 `credit_target` 就是为了让这一层对上。

`test_extra_original_invoice_is_ok_but_credit_must_hit_the_duplicate` 把这两层都钉住了。

误冲正的判断看的是**库里的贷记单**,不是结论里的 `expected_action` 字段。Agent 嘴上说什么不重要，库里发生了什么才重要，这是 Day 73 讲的「按最终状态判分」。被驳回的不算，因为它不会变成钱；评测时图停在审批节点，没人批，贷记单都是 `draft`。

数字幻觉为什么运行时拦过了还要再查？两层不互相信任。运行时的校验器可能有 bug,可能被将来的改动绕过；评测时独立再跑一遍，用的是客户最终看到的那段话。

## 跑评测：进程、快照和断点续跑

```python
# billsleuth/billsleuth/evals/run.py
"""Day 127:跑评测。每个 (场景, trial) 在独立进程里、从干净的库副本开始,结果一行一条写进 JSONL,可断点续跑。
用法:uv run python -m billsleuth.evals.run --trials 4 --out runs/v1.jsonl [--only S001,S017] [--no-sim] [--workers 2]"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

from billsleuth.db import ROOT, db_path


def one(sc: dict, trial: int, master_db: str, use_sim: bool) -> dict:
    """在子进程里跑。库路径和会话号都是环境变量,所以并发只能用进程,不能用线程。"""
    from langgraph.checkpoint.memory import InMemorySaver

    from billsleuth.evals import customer
    from billsleuth.evals.grade import grade
    from billsleuth.graph import build_graph
    from billsleuth.mcp_bridge import BillingMCP

    with tempfile.TemporaryDirectory() as d:
        db = Path(d) / "billing.db"
        shutil.copy(master_db, db)  # 每次都从快照开始:上一次起草的贷记单不能影响这一次
        os.environ["BILLSLEUTH_DB"] = str(db)
        os.environ["BILLSLEUTH_SESSION"] = f"{sc['id']}-t{trial}"
        g = build_graph(mcp=BillingMCP(in_process=True), checkpointer=InMemorySaver())
        t0 = time.perf_counter()
        first = customer.opening(sc, trial) if use_sim else sc["question"]
        cfg = {"recursion_limit": 60, "configurable": {"thread_id": f"{sc['id']}-t{trial}"}}
        g.invoke({"customer_id": sc["customer_id"], "question": first}, cfg)
        st = g.get_state(cfg).values
        follow, turns = None, 1
        msg = (st.get("reply") or {}).get("customer_message")
        if use_sim and msg:
            follow = customer.follow_up(sc, msg)
            if follow:
                cfg2 = {**cfg, "configurable": {"thread_id": cfg["configurable"]["thread_id"] + "-turn2"}}
                transcript = f"{first}\n\n(客服上一轮的回复)\n{msg}\n\n(客户追问)\n{follow}"
                g.invoke({"customer_id": sc["customer_id"], "question": transcript}, cfg2)
                st2 = g.get_state(cfg2).values
                st2["tokens"] = [a + b for a, b in zip(st.get("tokens") or [0, 0], st2.get("tokens") or [0, 0])]
                st2["llm_calls"] = st.get("llm_calls", 0) + st2.get("llm_calls", 0)
                st, turns = st2, 2
        conn = sqlite3.connect(db)
        conn.row_factory = sqlite3.Row
        cns = [dict(r) for r in conn.execute("SELECT c.* FROM credit_notes c JOIN invoices i ON i.id = c.invoice_id "
                                             "WHERE i.customer_id = ?", (sc["customer_id"],))]
        conn.close()
    row = grade(sc, st, cns)
    row.update(trial=trial, turns=turns, opening=first, follow_up=follow, seconds=time.perf_counter() - t0,
               reply=(st.get("reply") or {}).get("customer_message", ""),
               reasoning=(st.get("findings") or {}).get("reasoning", ""),
               tools=[c["name"] for m in st.get("messages", []) for c in (getattr(m, "tool_calls", None) or [])])
    return row


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--trials", type=int, default=1)
    ap.add_argument("--only", default="", help="逗号分隔的场景号,不填就是全部 100 个")
    ap.add_argument("--split", choices=["dev", "holdout"], help="Day 128 新增:只跑开发集或留出集")
    ap.add_argument("--workers", type=int, default=2)  # DeepSeek 高峰期并发高了会回 503
    ap.add_argument("--no-sim", action="store_true", help="不用模拟客户,直接用场景里的原话")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    scs = [json.loads(p.read_text()) for p in sorted((ROOT / "scenarios").glob("S*.json"))]
    if a.split:
        keep_ids = set(json.loads((ROOT / "scenarios" / "split.json").read_text())[a.split])
        scs = [s for s in scs if s["id"] in keep_ids]
    if a.only:
        keep = set(a.only.split(","))
        scs = [s for s in scs if s["id"] in keep]
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    done: set[tuple[str, int]] = set()
    if out.exists():  # 断点续跑:已有结果且不是崩溃的跳过,崩溃的重跑
        keep_lines = [ln for ln in out.read_text().splitlines() if ln.strip() and "crashed" not in json.loads(ln)]
        done = {(json.loads(ln)["scenario"], json.loads(ln)["trial"]) for ln in keep_lines}
        out.write_text("".join(ln + "\n" for ln in keep_lines))
    jobs = [(sc, t) for sc in scs for t in range(a.trials) if (sc["id"], t) not in done]
    print(f"{len(scs)} 个场景 × {a.trials} 次,已完成 {len(done)},本次跑 {len(jobs)}", flush=True)
    # 先把母版库冻结一份:评测跑一两个小时,这期间你可能在同一个 billing.db 上开案件、审批,
    # 子进程如果每次都从 billing.db 复制,后面的场景就会带着别人起草的贷记单开始
    master = str(out.with_suffix(".master.db"))
    if not Path(master).exists():
        shutil.copy(db_path(), master)
    # 每个任务一个新进程:环境变量、内存、崩溃都不会带到下一个场景
    with out.open("a") as f, ProcessPoolExecutor(a.workers, max_tasks_per_child=1) as pool:
        futs = {pool.submit(one, sc, t, master, not a.no_sim): (sc["id"], t) for sc, t in jobs}
        for fut in as_completed(futs):
            sid, t = futs[fut]
            try:
                row = fut.result()
            except Exception as e:  # noqa: BLE001  网络错误之类,记下来,不拖垮整批
                row = {"scenario": sid, "trial": t, "success": 0, "crashed": repr(e)[:300]}
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
            f.flush()
            print(sid, t, "✓" if row.get("success") else "✗", row.get("got_root_cause", row.get("crashed")), flush=True)


if __name__ == "__main__":
    main()
```

**为什么用进程不用线程。** Day 122 和 123 的设计里，库路径是环境变量 `BILLSLEUTH_DB`,审计的会话号是 `BILLSLEUTH_SESSION`,MCP server 每次调工具时现读。环境变量是整个进程共享的，两个线程同时跑两个场景，会互相改掉对方的库路径。用 `ProcessPoolExecutor`,每个子进程有自己的环境变量。这也是 `one()` 里那几个 import 写在函数内部的原因：子进程用 spawn 启动，要在子进程里导入。

`max_tasks_per_child=1` 让每个任务都用一个新进程。我第一次冒烟没加它，有一个子进程中途异常退出，`ProcessPoolExecutor` 随即把整个池标成坏的，剩下 12 个还没跑的任务全部报 `BrokenProcessPool`。一个任务一个进程，环境变量和内存都不会带到下一个场景；就算哪个进程挂了，重跑一次也只补那几个。

**先冻结母版库。** 子进程复制的不是 `billing.db` 本身，而是评测开始时冻结下来的一份 `runs/v1.master.db`。这一条也是吃了亏才加的：评测在后台跑的时候，我在同一个 `billing.db` 上开了两个审批演示的案件，起草了两张贷记单，后面开始的场景就带着它们出发了。Day 126 末尾讲过这件事。

**每次试验从快照开始。** `shutil.copy(master_db, db)` 很关键。如果几次试验共用一个库，第一次起草的贷记单会留在表里，第二次跑同一个场景时 Day 123 的去重会直接返回那张，或者额度检查会拦住，你会看到莫名其妙的结果。τ-bench 也是每个任务从初始数据库状态开始的。

**断点续跑。** 输出文件已经存在时，读出所有没崩溃的结果，跳过这些(场景, 试验)组合，只跑剩下的和崩溃的。全量 400 次运行要一两个小时，中间网络断一次很正常。

**超时。** Day 124 的 `get_llm` 设了 `max_retries=5`,但没设超时。openai SDK 的默认超时是 600 秒，一个请求挂住，这个子进程就停在那里十分钟。今天在 `llm.py` 里加了一行：

```python
        timeout=float(os.environ.get("LLM_TIMEOUT", "60")),  # Day 127 新增:默认 600 秒,一个请求挂住整批评测就停了
```

这一行是我冒烟时吃了亏才加的，下面会讲。

## 读报告

```python
# billsleuth/billsleuth/evals/report.py
"""Day 127:把 JSONL 汇总成带置信区间的报告;给 --baseline 时做配对比较(Day 128 用)。
用法:uv run python -m billsleuth.evals.report runs/v2.jsonl [--baseline runs/v1.jsonl]"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict

import numpy as np

from billsleuth.evals.stats import Z95, clustered_se, mcnemar, pass_hat_k, wilson_ci

RATES = ["success", "root_ok", "overcharge_ok", "action_ok", "invoice_ok", "hallucinated",
         "wrong_credit", "missed_credit", "escalated", "fallback"]


def load(path: str) -> list[dict]:
    return [json.loads(ln) for ln in open(path) if ln.strip()]


def summarize(rows: list[dict]) -> dict:
    ok = [r for r in rows if "crashed" not in r]
    out: dict = {"n_runs": len(rows), "n_scenarios": len({r["scenario"] for r in rows}), "crashed": len(rows) - len(ok)}
    for m in RATES:
        k = sum(r[m] for r in ok)
        out[m] = (k / len(ok) if ok else 0.0, *wilson_ci(k, len(ok)))
    s = [r["success"] for r in ok]
    if s:
        se = clustered_se(s, [r["scenario"] for r in ok])  # 同一场景的几次 trial 不独立,按场景聚类
        mean = float(np.mean(s))
        out["success_clustered_ci"] = (max(0.0, mean - Z95 * se), min(1.0, mean + Z95 * se))
    by_sc: dict[str, list[int]] = defaultdict(list)
    for r in ok:
        by_sc[r["scenario"]].append(r["success"])
    n_min = min((len(v) for v in by_sc.values()), default=0)
    out["pass_hat"] = {k: pass_hat_k(by_sc, k) for k in (1, 2, 4, 8) if k <= n_min}
    if ok:
        cost, secs = np.array([r["cost_cny"] for r in ok]), np.array([r["seconds"] for r in ok])
        out["cost"] = (float(cost.mean()), float(np.percentile(cost, 95)))
        out["secs"] = (float(np.percentile(secs, 50)), float(np.percentile(secs, 95)))
        out["turns2"] = sum(1 for r in ok if r.get("turns") == 2) / len(ok)
    by_cause: dict[str, list[int]] = defaultdict(list)
    for r in ok:
        by_cause[r["root_cause"]].append(r["success"])
    out["by_cause"] = {c: (sum(v), len(v)) for c, v in sorted(by_cause.items())}
    return out


def compare(base: list[dict], new: list[dict]) -> dict:
    key = lambda r: (r["scenario"], r["trial"])  # noqa: E731
    b = {key(r): r["success"] for r in base if "crashed" not in r}
    pairs = [(b[key(r)], r["success"]) for r in new if "crashed" not in r and key(r) in b]
    return {"n_pairs": len(pairs), **mcnemar([p[0] for p in pairs], [p[1] for p in pairs]),
            "diff": float(np.mean([y - x for x, y in pairs])) if pairs else 0.0}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("run")
    ap.add_argument("--baseline")
    a = ap.parse_args()
    s = summarize(load(a.run))
    print(f"运行 {s['n_runs']} 次 / 场景 {s['n_scenarios']} 个 / 崩溃 {s['crashed']}")
    for m in RATES:
        p, lo, hi = s[m]
        print(f"{m:14s} {p:6.1%}  95% CI [{lo:.1%}, {hi:.1%}]")
    if "success_clustered_ci" in s:
        lo, hi = s["success_clustered_ci"]
        print(f"success 按场景聚类的 CI [{lo:.1%}, {hi:.1%}](截到 0–100%)")
    print("pass^k", {k: round(v, 3) for k, v in s["pass_hat"].items()})
    if "cost" in s:
        print(f"单次成本上限 均值 ¥{s['cost'][0]:.4f} P95 ¥{s['cost'][1]:.4f};耗时 P50 {s['secs'][0]:.1f}s "
              f"P95 {s['secs'][1]:.1f}s;有追问 {s['turns2']:.0%}")
    for c, (k, n) in s["by_cause"].items():
        print(f"  {c:26s} {k}/{n}")
    if a.baseline:
        c = compare(load(a.baseline), load(a.run))
        print(f"配对比较 {c['n_pairs']} 对:新版独对 {c['b_only']},旧版独对 {c['a_only']},"
              f"差 {c['diff']:+.1%},McNemar p={c['p_value']:.3f}")


if __name__ == "__main__":
    main()
```

统计函数是从 Day 69 的 `stats.py` 拷过来的子集(`wilson_ci`、`clustered_se`、`mcnemar`、`pass_hat_k`),放在 `billsleuth/evals/stats.py`,代码不重复贴。依赖 `uv add numpy scipy`。聚类区间用的是正态近似，比例接近 0 或 1、样本又少时上下限会跑出 0–100% 之外，报告里截掉了。

`estimate_cost` 来自 Day 124 的 `llm.py`,按 `LLM_PRICE` 的未命中价格算，是上限；而且图里只有 `investigate` 节点记了 token,`intake` 和 `write_up` 的调用没记，所以报告里的成本只能当量级看。

冒烟我挑了 8 个场景：S001(取消后仍开票)、S017(重复扣款)、S023(重复开票)、S011(时区)、S019(过期税率)、S020(优惠券算错基数)、S003 和 S004(两种账没错)。每个跑 2 次，带模拟客户，2 个并发。

这次冒烟正赶上 DeepSeek 很忙。我先用 curl 直接打了三次接口，每次都要整整 60 秒才返回；还收到过 503「Service is too busy」。第一次跑的时候 `get_llm` 还没设超时，两个子进程卡了十几分钟一动不动，CPU 是 0。加上 60 秒超时以后，开始出现 `OpenAITimeoutError`,接着一个子进程异常退出，进程池整个坏掉，剩下的任务全报 `BrokenProcessPool`(所以才有了 `max_tasks_per_child=1`)。最后我把超时临时调到 180 秒(`LLM_TIMEOUT=180`),循环跑断点续跑，补了三轮。即便如此,S011 的第 0 次还是没跑成，三轮都挂在同一个错误上：

```text
S011 0 ✗ ValueError({'message': 'We were unable to start processing your request within the 900-second timeout limit. Please try again later.'})
```

这是 DeepSeek 服务端自己的排队超时，不是我们的代码。报告把它记成 1 次崩溃，不进成功率的分母：

```text
运行 16 次 / 场景 8 个 / 崩溃 1
success        100.0%  95% CI [79.6%, 100.0%]
root_ok        100.0%  95% CI [79.6%, 100.0%]
overcharge_ok  100.0%  95% CI [79.6%, 100.0%]
action_ok      100.0%  95% CI [79.6%, 100.0%]
invoice_ok     100.0%  95% CI [79.6%, 100.0%]
hallucinated     0.0%  95% CI [0.0%, 20.4%]
wrong_credit     0.0%  95% CI [0.0%, 20.4%]
missed_credit    0.0%  95% CI [0.0%, 20.4%]
escalated        0.0%  95% CI [0.0%, 20.4%]
fallback         0.0%  95% CI [0.0%, 20.4%]
success 按场景聚类的 CI [100.0%, 100.0%](截到 0–100%)
pass^k {1: 1.0}
单次成本上限 均值 ¥0.0297 P95 ¥0.0407;耗时 P50 25.3s P95 36.6s;有追问 0%
  cancel_not_respected       2/2
  coupon_wrong_base          2/2
  duplicate_charge           2/2
  duplicate_invoice          2/2
  expired_tax_rate           2/2
  no_error                   4/4
  timezone_change_date       1/1
```

这份报告能读出几件事。

**15 次全对，区间下限 79.6%。** 这和 Day 124 的 16 个全对是一个意思：样本小，而且场景是挑的。Wilson 区间告诉你，就算真实成功率只有八成，15 次全对也不算稀奇。

**聚类区间退化成了 [100%, 100%]。** 所有运行都成功，方差是 0,正态近似给不出宽度。这不说明我们很确定，恰恰说明这个方法在全对或全错的时候没用。这种时候看 Wilson 区间，或者用按场景重抽样的 bootstrap。

**pass^k 只有 k=1。** S011 少了一次，最少的场景只有 1 次试验，pass^2 算不出来。正式评测要等崩溃补跑到 0 再出报告。

**S023 的两次，结论都多写了原发票。** 两次的 `extra_invoices` 都是 `['INV-0023-04']`,贷记单都开在 `INV-0023-04D` 上。按上面的判法算对；如果当初判成「发票号必须完全一致」,这两次就是失败，你会去改一个其实没问题的地方。

**成本和耗时。** 每次调查的成本上限均值 ¥0.0297,P50 耗时 25 秒。成本只算了 `investigate` 节点的 token,没算 `intake`、`write_up` 和模拟客户；耗时受 DeepSeek 当时的排队影响很大，别拿它当基准。

正式跑 100 个场景之前，先粗算一下：

```text
运行次数 = 100 场景 × 4 次试验 = 400 次
调查成本 ≈ 400 × ¥0.03 ≈ ¥12(investigate 节点的上限;加上没记的调用，按 ¥20 准备)
耗时 ≈ 400 × 30 秒 ÷ 2 并发 ≈ 1.7 小时(厂商排队时会长得多)
```

场景数够不够，用 Day 69 的方法算：配对差值方差按 0.1 估，100 个场景能可靠发现的最小提升大约是 9 个点(`mde(100, 0.1)` 约 0.089);想可靠发现 5 个点，大约要 314 道独立题。这件事要写进报告，不然别人会拿 3 个点的差距跟你争论哪个版本更好。

## 正式结果(留空，跑完回填)

| 指标 | v1 | 95% CI |
| --- | --- | --- |
| 成功率(pass^1) | | |
| pass^2 | | — |
| pass^4 | | — |
| 根因准确率 | | |
| 多收金额精确匹配 | | |
| 发票号 | | |
| 数字幻觉率 | | |
| 误冲正率 | | |
| 漏冲正率 | | |
| 转人工率 | | |
| 兜底率 | | |
| 单次成本上限 均值 / P95 | | — |
| 耗时 P50 / P95 | | — |
| 有追问的运行占比 | | — |

按根因分组的成功数也贴一张，13 行(12 类加 no_error)。分组样本很小，每组 6–7 个场景乘 4 次，只用来找「哪一类明显不行」,不用来比较两类谁更好。

## 测评测代码

判分和汇总写错了，你会对着一份假报告优化好几天。评测代码本身也要有测试，用假状态，不调模型：

```python
# billsleuth/tests/test_eval.py
"""Day 127:判分和汇总本身的测试。用假状态,不调模型。"""
import json

from billsleuth.db import ROOT
from billsleuth.evals import report
from billsleuth.evals.grade import grade
from billsleuth.evals.selfcheck import NULL_STATE, reference_state

S023 = json.loads((ROOT / "scenarios" / "S023.json").read_text())   # 重复开票:标准答案只有多开的那张
S003 = json.loads((ROOT / "scenarios" / "S003.json").read_text())   # 账没错


def test_reference_passes_and_null_agent_fails():
    assert grade(S023, *reference_state(S023))["success"] == 1
    assert grade(S023, NULL_STATE, [])["success"] == 0


def test_extra_original_invoice_is_ok_but_credit_must_hit_the_duplicate():
    st, cns = reference_state(S023)
    dup = S023["truth"]["invoice_ids"][0]
    orig = dup[:-1]  # INV-0023-04D → INV-0023-04
    st["findings"]["invoice_ids"] = [orig, dup]
    g = grade(S023, st, cns)
    assert g["success"] == 1 and g["extra_invoices"] == [orig]
    wrong = [{**cns[0], "invoice_id": orig}]          # 贷记单开到了原发票上
    assert grade(S023, st, wrong)["wrong_credit"] == 1


def test_invented_number_fails():
    st, cns = reference_state(S023)
    st["reply"] = {"customer_message": f"多收了 {S023['truth']['overcharge']} 美元,另外补偿您 5.00 美元。"}
    g = grade(S023, st, cns)
    assert g["hallucinated"] == 1 and g["success"] == 0


def test_credit_on_no_error_is_wrong_credit_and_rejected_does_not_count():
    st, _ = reference_state(S003)
    inv = S003["truth"]["invoice_ids"][0]
    assert grade(S003, st, [{"id": "CN-1", "invoice_id": inv, "amount": "10.00", "status": "draft"}])["wrong_credit"] == 1
    assert grade(S003, st, [{"id": "CN-1", "invoice_id": inv, "amount": "10.00", "status": "rejected"}])["success"] == 1


def test_report_pass_hat_and_compare():
    base = {m: 0 for m in report.RATES} | {"root_cause": "x", "cost_cny": 0.01, "seconds": 10, "turns": 1}
    rows = []
    for t in range(4):
        rows.append({**base, "scenario": "a", "trial": t, "success": 1})
        rows.append({**base, "scenario": "b", "trial": t, "success": int(t < 2)})
    s = report.summarize(rows)
    assert s["pass_hat"][1] == 0.75 and abs(s["pass_hat"][2] - (1 + 1 / 6) / 2) < 1e-9
    c = report.compare(rows, [{**r, "success": 1} for r in rows])
    assert c["b_only"] == 2 and c["a_only"] == 0
```

第三个测试：客户版里多了一句「另外补偿您 5.00 美元」,其他都对，判失败。Agent 自作主张许诺补偿，比算错一个数还危险。第四个测试：账没错的场景里起草了贷记单是误冲正；但如果那张被驳回了，就不算。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="评测流水线：场景文件拆成客户可见和标准答案两部分，模拟客户生成开场白，调查图在独立进程和库副本上运行，判分器按标准答案和库的最终状态打分">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
  <rect x="20" y="40" width="130" height="90" fill="none" stroke="var(--ink-soft)" rx="4"/>
  <text x="85" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">S001…S100</text>
  <text x="32" y="84" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">question</text>
  <text x="32" y="100" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">customer_id</text>
  <text x="32" y="120" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">truth(隐藏)</text>
  <rect x="200" y="40" width="120" height="44" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="260" y="67" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">模拟客户</text>
  <line x1="150" y1="70" x2="196" y2="62" stroke="var(--ink-soft)" marker-end="url(#a127)"/>
  <rect x="200" y="130" width="120" height="44" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="260" y="157" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">调查图</text>
  <line x1="255" y1="84" x2="255" y2="126" stroke="var(--mem)" marker-end="url(#a127)"/>
  <text x="262" y="110" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">开场白 / 追问</text>
  <path d="M320 150 C 360 150, 360 70, 322 64" fill="none" stroke="var(--mem)" stroke-dasharray="3 3" marker-end="url(#a127)"/>
  <text x="352" y="104" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">回复</text>
  <rect x="200" y="220" width="120" height="44" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="260" y="241" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">子进程 + 库副本</text>
  <text x="260" y="256" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">BILLSLEUTH_DB</text>
  <line x1="260" y1="174" x2="260" y2="216" stroke="var(--compute)" marker-end="url(#a127)"/>
  <rect x="440" y="130" width="180" height="90" fill="none" stroke="var(--ink-soft)" rx="4"/>
  <text x="530" y="155" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">判分器(纯规则)</text>
  <text x="452" y="178" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">结论 vs truth</text>
  <text x="452" y="196" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">库里贷记单开在哪</text>
  <text x="452" y="212" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">客户版数字 vs 证据</text>
  <line x1="320" y1="155" x2="436" y2="168" stroke="var(--ink-soft)" marker-end="url(#a127)"/>
  <line x1="320" y1="240" x2="436" y2="200" stroke="var(--compute)" marker-end="url(#a127)"/>
  <path d="M150 120 C 300 290, 420 290, 510 222" fill="none" stroke="var(--ink-faint)" stroke-dasharray="4 4" marker-end="url(#a127)"/>
  <text x="330" y="292" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">truth 只走这条虚线</text>
  <defs><marker id="a127" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
</svg>
<figcaption>标准答案只流向判分器。模拟客户和调查图在蓝色一侧，判分器同时看结论和库的最终状态。</figcaption>
</figure>

## 动手练习

1. 把 `selfcheck.py`、`customer.py`、`grade.py`、`run.py`、`report.py` 和从 Day 69 拷来的 `stats.py` 放进 `billsleuth/evals/`,`uv add numpy scipy`。
2. 在 `llm.py` 里加上超时。
3. 跑 `uv run python -m billsleuth.evals.selfcheck` 和 `uv run pytest -q tests/test_eval.py`。
4. 冒烟：挑 8 个覆盖不同根因和 no_error 的场景，`uv run python -m billsleuth.evals.run --trials 2 --only S001,S017,... --out runs/smoke.jsonl`,再出报告。确认崩溃数为 0(有崩溃就再执行一次同样的命令补跑)。
5. 给至少 15 个场景写 `customer_goal`,写成 Agent 第一轮大概率不会主动回答的诉求(比如「要退回原卡，不要进余额」),再冒烟一次，看追问比例有没有上来。
6. 正式跑:`uv run python -m billsleuth.evals.run --trials 4 --out runs/v1.jsonl`。中途可以 Ctrl+C,再执行同一条命令会接着跑。
7. 把报告填进结果表，并用 Day 69 的 `mde` 算出这套评测能可靠发现的最小提升，写在表下面。

**验收标准:**自检和判分测试全过；正式结果表填满，每个比例带 95% 区间；崩溃运行数为 0;能说出追问比例，以及这个比例对「多轮能力」的结论意味着什么；能说出 S023 那类情况你是怎么判的、为什么。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 模拟客户(user simulator) | 用 LLM 扮演客户，按人设和诉求与 Agent 对话 |
| truth / 标准答案 | 场景的根因、多收金额、发票、期望动作，只给判分器 |
| variant | 场景的具体类型；有错的场景等于根因，no_error 分四种 |
| 库快照 | 每次试验开始时复制的初始数据库 |
| 误冲正 | 起草了不该起草、或者金额、发票不对的贷记单 |
| 漏冲正 | 该起草贷记单却没起草 |
| pass^k | 同一题连续 k 次都成功的概率，衡量稳定性 |
| Wilson 区间 | 比例的置信区间，接近 0 或 1、样本少时比正态近似可靠 |
| 聚类标准误 | 把同一场景的多次试验当作一组，考虑组内相关后的标准误 |
| 冒烟测试 | 用很少的样本快速检查整条管道能不能跑通 |

## 常见误区

**把 truth.detail 给模拟客户。** 那句话就是根因。泄露进开场白，Agent 顺着答就能拿分。

**模拟客户跟着被测模型一起换。** 模拟客户也是 benchmark 的一部分，换了它，前后分数就不能比。

**以为开了模拟客户就测到了多轮。** 跑完先看追问比例。

**用线程并发跑评测。** 库路径和会话号是环境变量，线程之间会互相覆盖。用进程。

**试验之间共用一个库。** 上一次起草的贷记单会影响下一次。每次从快照开始。

**网络错误算进失败。** 503 和超时不是 Agent 的问题，混进分母会冤枉它；悄悄丢掉又会少一批运行。单独计数，重跑到 0。

**不设超时。** 默认 600 秒，一个请求挂住，整批就停了。

**看着点估计下结论。** 8 个场景的聚类区间宽到几乎什么也说明不了。先看区间。

## 学习资料

### 文档与文章

- [τ-bench 论文(Yao 等，2024)](https://arxiv.org/abs/2406.12045):用户模拟、按最终数据库状态判分、pass^k 三个做法都出自这里，重点读第 3 节，40 分钟。
- [τ²-bench 论文(Barres 等，2025)](https://arxiv.org/abs/2506.07982):加了用户和 Agent 都能改环境的「双控」场景，读摘要和第 3 节，30 分钟。
- [Anthropic · Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):Agent 评测怎么设计、怎么判分、什么时候用模型评审，30 分钟。
- [Evan Miller · Adding Error Bars to Evals](https://arxiv.org/abs/2411.00640):聚类标准误和样本量计算的出处，Day 69 用过，对照今天的报告再看一遍，20 分钟。
- [Hamel Husain · LLM Evals FAQ](https://hamel.dev/blog/posts/evals-faq/):挑「要不要用 LLM 评审」「评测集多大」两节，20 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1aaxyz8ELY&p=19&autoplay=0&high_quality=1" title="(中英双语!)吴恩达最新《Agentic AI》大佬亲授智能体教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>吴恩达机器学习(搬运)· (中英双语!)吴恩达最新《Agentic AI》大佬亲授智能体教程 · 第 19 P「模块 4 评估(evals)」,15 分钟，讲怎么先建小评测集再一点点加，和今天先冒烟再全量的节奏一样。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/lTwnhgZ0-qQ" title="τ-bench: Evaluating Real-World Tool-Agent-User Interaction" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Andriy Batutin · τ-bench: Evaluating Real-World Tool-Agent-User Interaction · 论文讲解，重点听用户模拟和 pass^k 两段，英文。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/GL0XhAj5LPE" title="LLM Evals: Common Mistakes" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hamel Husain · LLM Evals: Common Mistakes · 评测里最常见的几个坑，和今天的「常见误区」对照着看，英文。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 3 章「Evaluation Methodology」和第 4 章「Evaluate AI Systems」,尤其是精确匹配和「AI as a judge」两节，讲清楚什么时候能用规则判分、什么时候不得不用模型评审。

### 开源项目与代码

- [sierra-research/tau-bench](https://github.com/sierra-research/tau-bench):看 `tau_bench/envs/user.py` 里用户模拟器的几种策略，以及每个任务结束时怎么比对数据库状态，40 分钟。
- [sierra-research/tau2-bench](https://github.com/sierra-research/tau2-bench):新版，任务和用户模拟器都做了改进。

## 自测

1. 场景文件里哪些内容能给模拟客户看？为什么 `truth.detail` 尤其危险？

<details><summary>答案</summary>

只有客户能看到的东西：`question`,以及可选的 `customer_facts`、`customer_goal`。`truth` 整个都只给判分器。`detail` 是用自然语言写的根因(比如「订阅已到期取消，这张发票不应该开出」),给了模拟客户，它会在开场白里说出来，Agent 顺着答就能拿分。

</details>

2. 为什么要有 20 个「账其实没错」的场景？空 Agent 在这 20 个上为什么也没通过？

<details><summary>答案</summary>

它们专门测误冲正：讨好型 Agent 在有错的场景上可能不差，在这里才会暴露。空 Agent 虽然说对了「没多收」,但没指出客户问的是哪张发票，发票号这一项不过。我们要求即使账没错，也要说清楚是哪张发票、为什么是这个数。

</details>

3. S023 的结论写了原发票和多开的那张两个号，标准答案只有多开的。你怎么判？为什么？

<details><summary>答案</summary>

分两层。结论里的发票号：标准答案的都在就算对，多写的不扣分但记下来；重复开票时提到原发票是合理的。贷记单开在哪张：必须精确，开在原发票上就是误冲正，哪怕金额对，因为这是真正会让账出错的地方。

</details>

4. 评测为什么用进程池而不是线程池？

<details><summary>答案</summary>

库路径 `BILLSLEUTH_DB` 和审计会话号 `BILLSLEUTH_SESSION` 是环境变量，MCP server 每次调工具时现读。环境变量整个进程共享，两个线程同时跑会互相改掉对方的库路径。每个子进程有自己的环境变量，互不影响。

</details>

5. 资深面试题：你给一个退款 Agent 做了评测，pass^1 是 85%。业务方问「能不能上线」,你怎么回答？还需要哪些数？

<details><summary>答案</summary>

不能只凭 85% 回答。要补：区间(按场景聚类，样本多大，能可靠发现多大的差异);pass^k,客服场景要的是每次都对；按错误类型拆，误冲正率决定能不能上，哪怕总成功率很高，误冲正 1% 乘以每天的工单量就是实际损失，要和业务方一起定上限；漏冲正、标签错、转人工的代价各不相同。还要说明评测集的覆盖面(哪些根因、有没有账没错的场景、模拟客户的人设)和已知盲区(比如追问比例很低，多轮能力没测到)。上线方案：先只开放解释，贷记单全部人工审批(我们的设计本来就是这样),线上抽样复核，再逐步放开。

</details>

6. 评测脚本里有哪几处是为了「网络不稳定」而写的？各防什么？

<details><summary>答案</summary>

`get_llm` 的 `max_retries=5`(Day 124)防 503 和 429;今天加的 `timeout=60` 防一个请求挂 600 秒；并发默认 2,防高峰期并发高了触发 503;崩溃单独记 `crashed`、不进成功率分母、报告第一行打印崩溃数；断点续跑，重跑同一条命令只补没完成和崩溃的。

</details>

## 明天预告

冒烟已经露出了几类失败。明天(Day 128)做**错误分析与迭代**:先把失败自动分桶，再逐桶读样例找出一句话能说清的原因，一次只改一处，每次改完跑回归，用 McNemar 检验判断提升是不是真的，最后留出一部分场景防止对评测集过拟合。
