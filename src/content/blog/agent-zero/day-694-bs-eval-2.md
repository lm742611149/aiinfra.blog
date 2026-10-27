---
title: 'Day 694 · BillSleuth(十三):判分、跑评测、断点续跑、读报告'
description: '昨天备好了评测集和模拟客户,今天让 BillSleuth 真的被打分。先把「成功」写成规则(根因、金额、动作、发票号四项对,数字编造、误冲正、漏冲正、转人工四项无),定下 S023 发票号写了两张的口径;再写每次在独立进程里、从干净库副本开始、能断点续跑的评测脚本。第一次跑 5 个场景就踩了两个坑:母版库里有旧演示留下的贷记单,进程池被一个传不回来的异常整个弄坏。按 ¥2 预算只跑了 20 个场景,成功率 75%,95% 区间 [53%, 89%],全量留空回填。'
pubDate: 2026-10-27
regime: none
tags: ['billsleuth', 'evaluation', 'grading', 'agent-zero']
series: 'agent-zero'
day: 694
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 693](/blog/agent-zero/day-693-bs-eval-1/) 把评测的两个原料备好了:100 个场景拆成「客户看得到」和「标准答案」两半,读场景只有 `scenarios.py` 一个白名单入口;模拟客户有四种人设,每种人设带着自己的诉求,同一个场景同一次试验人设固定;还用 `usage.py` 的计数器数 token。数评测集时发现 100 个场景只有 11 种问法、客户话里的金额 100/100 能对上,以及 S041 和 S083 的标准答案比发票本身还大,代码根本不让 Agent 开那么大的贷记单。

可是 Agent 还一次没有被打过分。今天补上剩下的一半:怎么判一次运行算成功、怎么把几十上百次运行跑完又不怕中途断掉、怎么读出一份报告。

## 今天要解决的问题

学完今天你应该能:

1. 把「一次运行算成功」写成确定性规则,不用模型评审;说清楚每一项指标为什么要有,并把 S023「发票号多写了原发票」的口径定下来。
2. 写出判分器的自检:参考解必须全判成功、永远说「账没错」的空 Agent 必须全判失败,再用「故意把判分器改松」检验自己的测试到底守不守得住。
3. 写出评测脚本:每个(场景, 试验)在独立进程里、从干净的库副本开始;结果一行一条追加进 JSONL;崩溃的行下次重跑;冻结的母版库先验干净。
4. 先跑 5 个场景估出单价,再按预算决定跑多少;读懂一份带 Wilson 区间的报告,知道样本这么小的时候哪些话能说、哪些不能说。

今天有两个新概念:**判分**(怎么定义成功)和**断点续跑**(怎么让一次要跑几十分钟的批处理能中途断掉)。Wilson 区间 [Day 547](/blog/agent-zero/day-547-eval-stats-1/) 学过,今天只用不推导;pass^k 是 [Day 344](/blog/agent-zero/day-344-eval-concepts/) 的内容,今天每个场景只跑 1 次,算不了 pass^2,留给回填。

预计用时 4 小时(今天偏重,如果觉得太满可以拆成「判分和自检」「跑评测和读报告」两天)。前置:[Day 693](/blog/agent-zero/day-693-bs-eval-1/)(`scenarios.py`、`customer.py`、`usage.py`)、[Day 691](/blog/agent-zero/day-691-bs-credit-2/)(调查图的审批节点和 `credit_target`)、[Day 689](/blog/agent-zero/day-689-bs-grounded-2/)(`grounding.check`)、[Day 685](/blog/agent-zero/day-685-week98-review/) 的 `fresh_db`。今天调真模型全部用 `deepseek-flash`,**花费约 ¥1.74**,算式在「今天的文件」一节;连 Day 693 一起,三天的预算上限 ¥2 已经用掉 ¥1.89,所以今天只跑了 20 个场景,不是 100 个。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `is_success` 和 `read_done` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 成功是什么

先定义,再写代码。一次运行里,Agent 要交出三样东西:一份结论(根因、发票号、多收金额、动作)、一段给客户看的话、一张(可能的)贷记单草稿。评测要问的问题是:这三样对不对?对错的标准全部来自标准答案和库里的最终状态,不用模型评审,原因有两个。一是计费场景有精确答案,根因是哪一类、多收多少分钱、贷记单开在哪张发票上,都能直接比对;二是用模型评审模型,评审者自己的偏差会混进分数里,[Day 357](/blog/agent-zero/day-357-llm-judge-2/) 起讲过。

| 指标 | 怎么算 | 为什么要它 |
| --- | --- | --- |
| `root_ok` 根因 | 结论的类别等于标准答案 | 根因错了,修复会找错地方 |
| `overcharge_ok` 多收金额 | 两位小数字符串完全相等 | 差一分钱也是错,不给近似分 |
| `action_ok` 动作 | `credit_note` 或 `explain_only` 对得上 | 该冲的冲,不该冲的只解释 |
| `invoice_ok` 发票号 | 标准答案的发票都在结论里 | 口径见下 |
| `bad_reply` 客户版有问题 | 客户版没过 `grounding.check(customer_view=True)` | 运行时校验器可能被改动绕过,评测时独立再查一遍 |
| `wrong_credit` 误冲正 | 库里有没驳回的贷记单,但不该冲,或者金额、发票不对 | 代价最大的错误,单独盯 |
| `missed_credit` 漏冲正 | 该冲却没有草稿 | 客户会再来 |
| `escalated` 转人工 | 图没有交出合格结论或起草失败 | 不算错,但也不算成功 |
| `fallback` 兜底 | 写作三稿没过校验,用了模板 | 只统计,不影响成功 |

**成功**要求前四项全对,后面四项(`bad_reply`、`wrong_credit`、`missed_credit`、`escalated`)一个都没有。`fallback` 只统计。这个定义很严:「根因和金额都对,只是图转了人工」算失败。严是故意的,明天的错误分析会把这种运行单独分出一个桶,让你看清到底是 Agent 差还是流程把它拦了。

**S023 的发票号问题。** [Day 687](/blog/agent-zero/day-687-bs-run/) 跑 S023(重复开票)时,模型的结论写了原发票 `INV-0023-04` 和多开的 `INV-0023-04D` 两个号,标准答案只有多开的那张,当时说口径留给今天。我的判法分两层:

- 结论里的 `invoice_ids`:标准答案里的发票必须都在,多写的不扣分,单独记在 `extra_invoices` 里。理由是重复开票时提到原发票是合理的,客户本来就会问「哪两张」,解释里说清楚「04 是正常的、04D 是多开的」比只提一张更好。
- 贷记单开在哪张:必须精确。开在原发票上就是误冲正,哪怕金额对。这是真正会让账出错的地方。

这个口径的代价后面会看到:练习 1 会把口径改成「发票号必须完全相等」重新数一遍。

误冲正看的是**库里的贷记单**,不是结论里的 `expected_action` 字段。Agent 嘴上说什么不重要,库里发生了什么才重要,这是 τ-bench 的做法:按最终状态判分。被驳回的贷记单不算,因为它不会变成钱。评测时图停在审批节点,没人批,贷记单都是 `draft`。

```python
# billsleuth/billsleuth/evals/grade.py  逐条判分。全部是确定性规则,不用模型评审
from billsleuth import grounding
from billsleuth.evals.scenarios import UNCASHABLE, truth


GOOD = ("root_ok", "overcharge_ok", "action_ok", "invoice_ok")      # 这四项必须都是 1
BAD = ("bad_reply", "wrong_credit", "missed_credit", "escalated")   # 这四项必须都是 0


def is_success(row: dict) -> int:
    """一次运行算成功:该对的四项全对,不该有的四项一个没有。"""
    return int(all(row[k] for k in GOOD) and not any(row[k] for k in BAD))


def grade(sc: dict, st: dict, credit_notes: list[dict]) -> dict:
    """sc:完整场景(含 truth);st:调查图跑完时的状态;credit_notes:跑完后库里这个客户的贷记单。"""
    t, f = truth(sc), st.get("findings") or {}
    got_ids = f.get("invoice_ids") or []
    # 发票号:标准答案里的发票都要在结论里,多写的不扣分、单独记下来(重复开票时提原发票是合理的)
    invoice_ok = set(t["invoice_ids"]) <= set(got_ids)
    live = [c for c in credit_notes if c["status"] != "rejected"]
    want = t["expected_action"] == "credit_note"
    # 钱的这一层严格:必须恰好一张,开在标准答案那张发票上,金额分毫不差
    credit_ok = want and len(live) == 1 and live[0]["invoice_id"] in t["invoice_ids"] and live[0]["amount"] == t["overcharge"]
    reply = st.get("reply") or {}
    msg = reply.get("customer_message", "")
    rep = grounding.check(msg, st.get("evidence", []), customer_view=True) if msg else None
    row = {
        "scenario": sc["id"], "root_cause": t["root_cause"], "variant": t["variant"],
        "uncashable": int(sc["id"] in UNCASHABLE),
        "got_root_cause": f.get("root_cause"), "got_overcharge": f.get("overcharge"),
        "got_action": f.get("expected_action"), "got_invoices": got_ids,
        "root_ok": int(f.get("root_cause") == t["root_cause"]),
        "overcharge_ok": int(f.get("overcharge") == t["overcharge"]),
        "action_ok": int(f.get("expected_action") == t["expected_action"]),
        "invoice_ok": int(invoice_ok),
        "extra_invoices": sorted(set(got_ids) - set(t["invoice_ids"])),
        "bad_reply": int(bool(rep and rep.problems)),
        "wrong_credit": int(bool(live) and not credit_ok),
        "missed_credit": int(want and not live),
        "escalated": int(bool(st.get("escalated"))),
        "fallback": int(bool(reply.get("fallback"))),
        "credit_notes": [{k: c[k] for k in ("id", "invoice_id", "amount", "status")} for c in credit_notes],
        "llm_calls": st.get("llm_calls", 0),
    }
    row["success"] = is_success(row)
    return row
```

<div class="line-notes">

- `from billsleuth.evals.scenarios import UNCASHABLE, truth` 只能通过 `truth()` 拿标准答案,判分器是唯一的使用者。
- `GOOD = ("root_ok", "overcharge_ok", "action_ok", "invoice_ok")` 成功必须全是 1 的四项。
- `BAD = ("bad_reply", "wrong_credit", "missed_credit", "escalated")` 成功必须全是 0 的四项。把「成功」写成两张清单,而不是一串 `and`,是练习 4 吃了亏以后的改法。
- `return int(all(row[k] for k in GOOD) and not any(row[k] for k in BAD))` `all` 相当于 JS 的 `every`,`any` 相当于 `some`。`int(...)` 把布尔值变成 1 或 0,方便后面直接求和。
- `t, f = truth(sc), st.get("findings") or {}` `t` 是标准答案,`f` 是 Agent 交的结论。交卷失败时 `findings` 可能是空字典甚至不存在,`or {}` 兜底。
- `invoice_ok = set(t["invoice_ids"]) <= set(got_ids)` 集合的 `<=` 是「子集」:标准答案里的发票号是结论的子集。S023 的结论是 `{INV-0023-04, INV-0023-04D}`,标准答案 `{INV-0023-04D}`,是子集,算对。
- `live = [c for c in credit_notes if c["status"] != "rejected"]` 没被驳回的贷记单,`draft`、`approved`、`issued` 都算。
- `want = t["expected_action"] == "credit_note"` 标准答案要不要冲正。
- `credit_ok = want and len(live) == 1` 钱这一层的严格判法:要冲正、恰好一张、开在标准答案那张发票上、金额分毫不差。
- `rep = grounding.check(msg, st.get("evidence", []), customer_view=True) if msg else None` 拿客户最终看到的那段话,再按客户版的规则查一遍:金额有没有出处、有没有承诺时限或退款。没有回复(转人工了)就跳过。
- `"uncashable": int(sc["id"] in UNCASHABLE),` 记下这是不是 S041、S083 那种兑现不了的场景,报告里单独算。
- `"extra_invoices": sorted(set(got_ids) - set(t["invoice_ids"])),` 多写的发票号,集合差。
- `"bad_reply": int(bool(rep and rep.problems)),` 有报告并且报告里有问题,记 1。
- `"wrong_credit": int(bool(live) and not credit_ok),` 库里有贷记单,但不是「恰好那一张」,记 1。账没错的场景里只要有贷记单就走到这里。
- `"missed_credit": int(want and not live),` 该冲却一张都没有。
- `"escalated": int(bool(st.get("escalated"))),` 图自己标了转人工。
- `row["success"] = is_success(row)` 最后一步:四个对的和四个错的汇总成一个成功标志。

</div>

## 先证明判分器没坏

判分器写错了,你会对着一份假报告优化好几天。所以评测代码本身也要有自检:一个**参考解**(照抄标准答案的假 Agent)必须在 100 个场景上全判成功,一个**空 Agent**(永远说「账没错」、不指发票)必须在 100 个场景上全判失败。前者证明判分器不会冤枉对的答案、标准答案自己自洽;后者证明不能靠什么都不做拿分。

```python
# billsleuth/billsleuth/evals/selfcheck.py  评测集自检:照抄标准答案的「参考解」必须全判成功,永远说「账没错」的空 Agent 必须全挂
"""用法:uv run python -m billsleuth.evals.selfcheck"""
from billsleuth.evals.grade import grade
from billsleuth.evals.scenarios import load_all, truth


def reference_state(sc: dict) -> tuple[dict, list[dict]]:
    t = truth(sc)
    ev = [{"id": "E1", "claim": "多收", "source_tool": "ref", "source_ref": t["invoice_ids"][0], "value": t["overcharge"]}]
    st = {"findings": {"root_cause": t["root_cause"], "invoice_ids": t["invoice_ids"], "overcharge": t["overcharge"],
                       "expected_action": t["expected_action"]},
          "evidence": ev, "reply": {"customer_message": f"多收了 {t['overcharge']} 美元。"}, "escalated": False}
    cns = ([{"id": "CN-REF", "invoice_id": t["invoice_ids"][0], "amount": t["overcharge"], "status": "draft"}]
           if t["expected_action"] == "credit_note" else [])
    return st, cns


NULL_STATE = {"findings": {"root_cause": "no_error", "invoice_ids": [], "overcharge": "0.00", "expected_action": "explain_only"},
              "evidence": [], "reply": {}, "escalated": False}


def main() -> None:
    scs = load_all()
    problems, null_pass = [], 0
    for sc in scs:
        if not grade(sc, *reference_state(sc))["success"]:
            problems.append(f"{sc['id']}: 参考解没通过判分,检查场景字段或判分器")
        g = grade(sc, NULL_STATE, [])
        null_pass += g["success"]
        if g["success"] and truth(sc)["root_cause"] != "no_error":
            problems.append(f"{sc['id']}: 空 Agent 居然过了一个有错的场景")
    n_err = sum(1 for s in scs if truth(s)["root_cause"] != "no_error")
    print(f"{len(scs)} 个场景,{n_err} 个有错;空 Agent 通过 {null_pass} 个")
    print("\n".join(problems) or "自检通过")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `def reference_state(sc: dict) -> tuple[dict, list[dict]]:` 参考解:根据标准答案造一个「图跑完以后的状态」和一份贷记单列表。
- `ev = [{"id": "E1", "claim": "多收", "source_tool": "ref", "source_ref": t["invoice_ids"][0], "value": t["overcharge"]}]` 一条假证据,值就是多收金额,这样客户版里写这个金额能通过溯源检查。
- `"evidence": ev, "reply": {"customer_message": f"多收了 {t['overcharge']} 美元。"}, "escalated": False}` 客户版只有一句话,金额来自证据。
- `cns = ([{"id": "CN-REF"` 该冲正的场景给一张开在标准发票上、金额对的草稿;账没错的场景不给。
- `NULL_STATE = {"findings": {"root_cause": "no_error"` 空 Agent:永远回「账没错」,发票号是空的,没有证据,没有回复。
- `if not grade(sc, *reference_state(sc))["success"]:` `*` 把返回的元组展开成 `grade` 的后两个参数。参考解没过,说明判分器或场景有毛病。
- `g = grade(sc, NULL_STATE, [])` 空 Agent 交卷,库里没有贷记单。
- `if g["success"] and truth(sc)["root_cause"] != "no_error":` 空 Agent 过了一个有错的场景,是判分器太松。

</div>

```bash
uv run python -m billsleuth.evals.selfcheck
```

```text
100 个场景,80 个有错;空 Agent 通过 0 个
自检通过
```

空 Agent 在 20 个「账没错」的场景上也没通过:它说对了「没多收」,但没指出客户问的是哪张发票(`invoice_ids` 是空的)。我们要求即使账没错,也要说清楚是哪张发票,所以这样判是对的。

## 跑评测:进程、快照和断点续跑

一次评测要跑几十上百个场景,每个要十几秒到一分钟。下面这个脚本要同时解决四件事。

**每个任务一个新进程。** [Day 683](/blog/agent-zero/day-683-bs-tools/) 的设计里,库路径是环境变量 `BILLSLEUTH_DB`,审计的会话号是 `BILLSLEUTH_SESSION`,工具层每次调用时现读。环境变量是整个进程共享的,两个线程同时跑两个场景,会互相改掉对方的库路径。用 `ProcessPoolExecutor`,每个子进程有自己的环境变量;`max_tasks_per_child=1` 再让每个任务用一个新进程,内存和环境都不会带到下一个场景。(这和 Day 693 里线程池丢掉计数器是同一类问题的另一面:线程什么都共享,进程什么都不共享。)

**每次从快照开始。** 子进程复制的不是 `billing.db`,而是评测开始时冻结下来的一份 `runs/v1.master.db`,再复制到临时目录里跑。一次运行起草的贷记单不能留给下一次。

**断点续跑。** 结果一行一条追加进 JSONL。再次运行同一条命令时,已经有结果的(场景, 试验)跳过,崩溃的从文件里删掉重跑。

**崩溃也是一行数据。** 网络错误、认证失败、超时,在子进程里捕获,变成一行 `{"crashed": ...}`,不拖垮整批。

```python
# billsleuth/billsleuth/evals/run.py  跑评测:每个 (场景, 试验) 在独立进程里、从干净的库副本开始,结果一行一条写进 JSONL,可断点续跑
"""用法:uv run python -m billsleuth.evals.run --out runs/v1.jsonl [--trials 1] [--only S001,S017] [--per-group 2] [--no-sim] [--workers 2]"""
import argparse
import json
import os
import random
import shutil
import sqlite3
import tempfile
import time
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

from langchain_core.runnables import RunnableConfig

from billsleuth.db import db_path
from billsleuth.evals.scenarios import load_all, truth


def one(sc: dict, trial: int, master_db: str, use_sim: bool) -> dict:
    """在子进程里跑。库路径和会话号都是环境变量,所以并发只能用进程,不能用线程。"""
    from langgraph.checkpoint.memory import InMemorySaver

    from billsleuth.evals import customer
    from billsleuth.evals.grade import grade
    from billsleuth.evals.scenarios import visible
    from billsleuth.evals.usage import meter
    from billsleuth.graph import build_graph
    from billsleuth.mcp_bridge import BillingMCP

    v = visible(sc)
    with tempfile.TemporaryDirectory() as d, meter() as m:
        db = Path(d) / "billing.db"
        shutil.copy(master_db, db)  # 每次从快照开始:上一次起草的贷记单不能影响这一次
        os.environ["BILLSLEUTH_DB"] = str(db)
        thread = f"{v['id']}-t{trial}"
        os.environ["BILLSLEUTH_SESSION"] = thread
        g = build_graph(mcp=BillingMCP(in_process=True), checkpointer=InMemorySaver())
        t0 = time.perf_counter()
        first = customer.opening(sc, trial) if use_sim else v["question"]
        cfg: RunnableConfig = {"recursion_limit": 60, "configurable": {"thread_id": thread}}
        g.invoke({"customer_id": v["customer_id"], "question": first}, cfg)
        st = g.get_state(cfg).values
        follow, turns = None, 1
        msg = (st.get("reply") or {}).get("customer_message")
        if use_sim and msg:
            follow = customer.follow_up(sc, trial, msg)
            if follow:  # 客户追问:把前面的对话拼成新的客户原话,开一个新案件。同一张发票已有草稿时起草会返回原来那张
                cfg2: RunnableConfig = {"recursion_limit": 60, "configurable": {"thread_id": thread + "-turn2"}}
                g.invoke({"customer_id": v["customer_id"],
                          "question": f"{first}\n\n(客服上一轮的回复)\n{msg}\n\n(客户追问)\n{follow}"}, cfg2)
                st, turns = g.get_state(cfg2).values, 2
        conn = sqlite3.connect(db)
        conn.row_factory = sqlite3.Row
        cns = [dict(r) for r in conn.execute(
            "SELECT c.* FROM credit_notes c JOIN invoices i ON i.id = c.invoice_id WHERE i.customer_id = ?",
            (v["customer_id"],))]
        conn.close()
    row = grade(sc, st, cns)
    row.update(trial=trial, turns=turns, persona=customer.persona_for(v["id"], trial) if use_sim else None,
               opening=first, follow_up=follow, seconds=time.perf_counter() - t0,
               tokens_in=m.tokens[0], tokens_out=m.tokens[1], cost_cny=m.cost,
               reply=(st.get("reply") or {}).get("customer_message", ""),
               internal=(st.get("reply") or {}).get("internal_note", ""),
               reasoning=(st.get("findings") or {}).get("reasoning", ""),
               approval_error=(st.get("approval") or {}).get("error"),
               tools=[c["name"] for msg_ in st.get("messages", []) for c in (getattr(msg_, "tool_calls", None) or [])])
    return row


def run_job(sc: dict, trial: int, master_db: str, use_sim: bool) -> dict:
    """子进程的入口。异常在子进程里就变成一行普通字典,只有字符串能安全地传回主进程。"""
    try:
        return one(sc, trial, master_db, use_sim)
    except Exception as e:  # noqa: BLE001  网络错误、认证失败、超时……记下来,不拖垮整批
        return {"scenario": sc["id"], "trial": trial, "success": 0, "crashed": f"{type(e).__name__}: {str(e)[:200]}"}


def read_done(out: Path) -> set[tuple[str, int]]:
    """断点续跑:已有结果且不是崩溃的算做完了,崩溃的行从文件里删掉,等着重跑。"""
    if not out.exists():
        return set()
    kept = [ln for ln in out.read_text().splitlines() if ln.strip() and "crashed" not in json.loads(ln)]
    out.write_text("".join(ln + "\n" for ln in kept))
    return {(json.loads(ln)["scenario"], json.loads(ln)["trial"]) for ln in kept}


def check_master(path: Path) -> None:
    """冻结的母版必须是刚造好的干净库:贷记单、审批、幂等键三张表都是空的。否则前面某次演示留下的草稿会污染所有场景。"""
    conn = sqlite3.connect(path)
    dirty = {t: n for t in ("credit_notes", "approvals", "credit_note_requests")
             if (n := conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0])}
    conn.close()
    if dirty:
        raise SystemExit(f"母版库 {path} 不干净:{dirty}。先用 seed 重新造一份再跑评测。")


def pick_subset(scs: list[dict], per_group: int, seed: int = 0) -> list[dict]:
    """分层抽样:按 (根因, variant) 分组,每组随机抽 per_group 个。种子固定,每次抽到同一批。"""
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for s in scs:
        groups[(truth(s)["root_cause"], truth(s)["variant"])].append(s)
    rng, out = random.Random(seed), []
    for key in sorted(groups):
        out += rng.sample(groups[key], min(per_group, len(groups[key])))
    return sorted(out, key=lambda s: s["id"])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--trials", type=int, default=1)
    ap.add_argument("--only", default="", help="逗号分隔的场景号;不填就是全部")
    ap.add_argument("--per-group", type=int, default=0, help="分层抽样:每个(根因, variant)抽几个;0 表示不抽")
    ap.add_argument("--workers", type=int, default=2)  # DeepSeek 高峰期并发高了会回 503
    ap.add_argument("--no-sim", action="store_true", help="不用模拟客户,直接用场景里的原话")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    scs = load_all()
    if a.per_group:
        scs = pick_subset(scs, a.per_group)
    if a.only:
        keep = set(a.only.split(","))
        scs = [s for s in scs if s["id"] in keep]
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    done = read_done(out)
    jobs = [(sc, t) for sc in scs for t in range(a.trials) if (sc["id"], t) not in done]
    print(f"{len(scs)} 个场景 × {a.trials} 次,已完成 {len(done)},本次跑 {len(jobs)}", flush=True)
    # 先把母版库冻结一份:评测一跑就是一两个小时,这期间别人可能在 billing.db 上开案件、审批
    master = str(out.with_suffix(".master.db"))
    if not Path(master).exists():
        shutil.copy(db_path(), master)
    check_master(Path(master))
    # 每个任务一个新进程:环境变量、内存、崩溃都不会带到下一个场景
    with out.open("a") as f, ProcessPoolExecutor(a.workers, max_tasks_per_child=1) as pool:
        futs = {pool.submit(run_job, sc, t, master, not a.no_sim): (sc["id"], t) for sc, t in jobs}
        for fut in as_completed(futs):
            sid, t = futs[fut]
            try:
                row = fut.result()
            except Exception as e:  # noqa: BLE001  进程被系统杀掉之类,子进程里的 try 接不住的
                row = {"scenario": sid, "trial": t, "success": 0, "crashed": f"{type(e).__name__}: {str(e)[:200]}"}
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
            f.flush()
            print(sid, t, "ok" if row.get("success") else "fail", row.get("got_root_cause", row.get("crashed")), flush=True)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `def one(sc: dict, trial: int, master_db: str, use_sim: bool) -> dict:` 在子进程里跑一次。参数全是能序列化的普通值:字典、整数、字符串、布尔,因为它们要从主进程传到子进程。
- `from langgraph.checkpoint.memory import InMemorySaver` 这些 import 写在函数里面:子进程是新启动的 Python,在子进程里才导入。
- `v = visible(sc)` 后面传给模拟客户和图的,只用这个白名单版本。
- `with tempfile.TemporaryDirectory() as d, meter() as m:` 一个临时目录加一个计数器。出了这个块临时目录自动删除,里面的库副本也就没了。
- `shutil.copy(master_db, db)  # 每次从快照开始` 把母版库复制到临时目录。S001 的母版里没有任何贷记单,这次运行起草的那张只存在于这个副本。
- `os.environ["BILLSLEUTH_DB"] = str(db)` 让后面所有的工具调用指向这个副本。环境变量只影响这个子进程。
- `os.environ["BILLSLEUTH_SESSION"] = thread` 审计日志按这个号分会话,例如 `S001-t0`。
- `g = build_graph(mcp=BillingMCP(in_process=True), checkpointer=InMemorySaver())` Day 691 的调查图。传了 checkpointer,所以图会走到审批节点并暂停,这正是我们要的:评测不批,贷记单停在 `draft`。
- `first = customer.opening(sc, trial) if use_sim else v["question"]` 用模拟客户生成开场白,或者直接用场景里的原话(`--no-sim`)。
- `cfg: RunnableConfig = {"recursion_limit": 60, "configurable": {"thread_id": thread}}` `thread_id` 同时是案件号。
- `g.invoke({"customer_id": v["customer_id"], "question": first}, cfg)` 跑到结束,或者停在审批节点。
- `st = g.get_state(cfg).values` 取出图停下来时的状态。
- `follow = customer.follow_up(sc, trial, msg)` 客服的回复出来了,让模拟客户决定追不追问。
- `cfg2: RunnableConfig = {` 追问开一个新案件,thread 号加 `-turn2`。
- `"question": f"{first}\n\n(客服上一轮的回复)\n{msg}\n\n(客户追问)\n{follow}"}, cfg2)` 把前面的对话拼成新的客户原话。图本身只吃一段文字,所以第二轮是一次「带上下文的新调查」,不是真正的多轮会话。同一张发票已有草稿时,`draft_credit_note` 会返回原来那张,不会重复创建。
- `st, turns = g.get_state(cfg2).values, 2` 有追问时,最终状态以第二轮为准。
- `"SELECT c.* FROM credit_notes c JOIN invoices i ON i.id = c.invoice_id WHERE i.customer_id = ?",` 取这个客户名下所有的贷记单,按最终状态判分。
- `row = grade(sc, st, cns)` 交给判分器。
- `tokens_in=m.tokens[0], tokens_out=m.tokens[1], cost_cny=m.cost,` 一次运行里所有模型调用的用量:`intake`、调查、写解释、模拟客户的开场白和追问,全在里面。
- `def run_job(sc: dict, trial: int, master_db: str, use_sim: bool) -> dict:` 子进程的真正入口,包了一层 `try`。
- `except Exception as e:  # noqa: BLE001` 异常在子进程里就变成一行字典。为什么不在主进程里接,下面「报错先演示」讲。
- `kept = [ln for ln in out.read_text().splitlines() if ln.strip() and "crashed" not in json.loads(ln)]` 读已有结果,丢掉空行和崩溃行。
- `out.write_text("".join(ln + "\n" for ln in kept))` 把崩溃行从文件里真的删掉,这样重跑完文件里没有重复。
- `def check_master(path: Path) -> None:` 冻结的母版必须是干净的,否则拒绝开跑。下面「报错先演示」解释它是怎么来的。
- `if (n := conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0])` 海象运算符 `:=` 把计数存进 `n` 的同时判断它是不是非零。三张表里只要有一张非空就记进 `dirty`。
- `def pick_subset(scs: list[dict], per_group: int, seed: int = 0) -> list[dict]:` 分层抽样:按(根因, variant)分组,每组抽 `per_group` 个。
- `rng, out = random.Random(seed), []` 固定种子的随机数生成器,每次运行抽到同一批,结果可比较。
- `ap.add_argument("--per-group"` 命令行参数:`0` 表示不抽样,全部跑。
- `master = str(out.with_suffix(".master.db"))` 母版库放在结果文件旁边:`v1.jsonl` 对应 `v1.master.db`。
- `if not Path(master).exists():` 已经冻结过就不再覆盖。同一份结果文件的所有运行共用同一份母版。
- `with out.open("a") as f, ProcessPoolExecutor(a.workers, max_tasks_per_child=1) as pool:` 以追加模式打开结果文件;进程池每个任务用一个新进程。
- `futs = {pool.submit(run_job, sc, t, master, not a.no_sim): (sc["id"], t) for sc, t in jobs}` 全部提交,用字典记下每个 future 对应哪个任务。
- `for fut in as_completed(futs):` 谁先跑完先处理谁,所以结果文件里的顺序是完成顺序,不是场景号顺序。
- `f.write(json.dumps(row, ensure_ascii=False) + "\n")` 每跑完一个立刻写一行并 `flush()`,中途断电最多丢正在跑的那几个。

</div>

<figure>
<svg viewBox="0 0 640 310" role="img" aria-label="评测脚本的流程:billing.db 冻结成母版库,每个任务一个新进程先复制母版到临时目录,跑调查图,按最终状态判分,一行追加进结果文件;重跑时已完成的跳过、崩溃的重跑">
  <rect x="0" y="0" width="640" height="310" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">一次评测:每个任务从同一份母版出发</text>
  <rect x="20" y="48" width="110" height="46" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="75" y="68" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">billing.db</text>
  <text x="75" y="85" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">seed 刚造好</text>
  <line x1="130" y1="71" x2="165" y2="71" stroke="var(--ink-soft)" marker-end="url(#a694)"/>
  <rect x="170" y="48" width="130" height="46" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="235" y="68" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">v1.master.db</text>
  <text x="235" y="85" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">check_master 验干净</text>
  <rect x="340" y="40" width="280" height="150" fill="none" stroke="var(--rule)" stroke-dasharray="5 4" rx="4"/>
  <text x="352" y="58" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">每个(场景, 试验)一个新进程</text>
  <rect x="352" y="68" width="116" height="40" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="410" y="92" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">复制母版到临时目录</text>
  <rect x="490" y="68" width="118" height="40" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="549" y="92" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">模拟客户 + 调查图</text>
  <rect x="352" y="130" width="116" height="40" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="410" y="154" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">读库里的贷记单</text>
  <rect x="490" y="130" width="118" height="40" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="549" y="154" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">grade() 判分</text>
  <line x1="468" y1="88" x2="486" y2="88" stroke="var(--ink-soft)" marker-end="url(#a694)"/>
  <line x1="549" y1="108" x2="549" y2="126" stroke="var(--ink-soft)" marker-end="url(#a694)"/>
  <line x1="490" y1="150" x2="472" y2="150" stroke="var(--ink-soft)" marker-end="url(#a694)"/>
  <line x1="300" y1="71" x2="336" y2="71" stroke="var(--ink-soft)" marker-end="url(#a694)"/>
  <line x1="480" y1="190" x2="480" y2="222" stroke="var(--ink-soft)" marker-end="url(#a694)"/>
  <rect x="340" y="226" width="280" height="50" fill="var(--paper-raised)" stroke="var(--ink-soft)" rx="4"/>
  <text x="480" y="248" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">v1.jsonl 一行一个运行</text>
  <text x="480" y="266" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">完成一个写一个,立刻 flush</text>
  <text x="20" y="140" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">再跑一次同样的命令:</text>
  <text x="20" y="160" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">已有结果的跳过</text>
  <text x="20" y="178" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">crashed 的行删掉重跑</text>
  <path d="M340 251 C 200 251, 120 230, 100 192" fill="none" stroke="var(--ink-soft)" stroke-dasharray="3 3" marker-end="url(#a694)"/>
  <text x="20" y="300" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">蓝色:有模型的部分。琥珀色:只有代码和数据库。</text>
  <defs><marker id="a694" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
</svg>
<figcaption>评测脚本的流程。每个任务都从同一份冻结的母版出发,在自己的临时副本里跑,结果追加进一个文件;同样的命令再跑一遍,只补没跑完的。</figcaption>
</figure>

## 报告和统计

结果文件有了,要汇总成几个数。每个比例都带 95% 置信区间,用的是 Wilson 区间([Day 547](/blog/agent-zero/day-547-eval-stats-1/) 讲过为什么不用「p ± 1.96·SE」):

```python
# billsleuth/billsleuth/evals/stats.py  评测报告要用的两个统计函数
from collections.abc import Mapping, Sequence
from math import comb, sqrt

Z95 = 1.96


def wilson_ci(k: int, n: int, z: float = Z95) -> tuple[float, float]:
    """成功 k 次、共 n 次,真实成功率的 95% 区间(Wilson)。n=0 返回 (0, 1):什么都不知道。"""
    if n == 0:
        return 0.0, 1.0
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, centre - half), min(1.0, centre + half)


def pass_hat_k(by_scenario: Mapping[str, Sequence[int]], k: int) -> float:
    """pass^k:一个场景连跑 k 次全对的概率,用「n 次里有 c 次成功」无偏估计 C(c,k)/C(n,k),再对场景取平均。"""
    vals = [comb(sum(v), k) / comb(len(v), k) for v in by_scenario.values() if len(v) >= k]
    return sum(vals) / len(vals) if vals else 0.0
```

<div class="line-notes">

- `Z95 = 1.96` 95% 置信水平对应的 z 值。
- `def wilson_ci(k: int, n: int, z: float = Z95) -> tuple[float, float]:` 成功 `k` 次、共 `n` 次,返回真实成功率 95% 区间的下限和上限。
- `if n == 0:` `return 0.0, 1.0` 一次都没跑,什么都不知道,区间是整个 0 到 1。
- `centre = (p + z * z / (2 * n)) / denom` Wilson 区间的中心不是 `p`,而是被往 0.5 拉了一点。16 次全对时 `p = 1`,中心会比 1 小。
- `half = z * sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom` 半宽。注意全对的时候 `p * (1 - p)` 是 0,区间也不会退化成一个点,这正是不用正态近似的原因。
- `return max(0.0, centre - half), min(1.0, centre + half)` 截到 0 到 1 之间。
- `def pass_hat_k(by_scenario: Mapping[str, Sequence[int]], k: int) -> float:` pass^k:一个场景连跑 k 次全对的概率。输入是 `{场景号: [每次试验的成功标志]}`。
- `vals = [comb(sum(v), k) / comb(len(v), k) for v in by_scenario.values() if len(v) >= k]` 一个场景跑了 n 次、成功 c 次,「随便抽 k 次全是成功」的概率是 `C(c,k) / C(n,k)`,`comb` 是组合数。试验次数不到 k 的场景算不了,跳过。
- `return sum(vals) / len(vals) if vals else 0.0` 对场景取平均。今天每个场景只跑了 1 次,`k=1` 以外都是空的。

</div>

```python
# billsleuth/billsleuth/evals/report.py  把 JSONL 汇总成带置信区间的报告
"""用法:uv run python -m billsleuth.evals.report runs/v1.jsonl"""
import argparse
import json
from collections import defaultdict

from billsleuth.evals.stats import pass_hat_k, wilson_ci

RATES = ["success", "root_ok", "overcharge_ok", "action_ok", "invoice_ok", "bad_reply",
         "wrong_credit", "missed_credit", "escalated", "fallback"]


def load(path: str) -> list[dict]:
    return [json.loads(ln) for ln in open(path, encoding="utf-8") if ln.strip()]


def pct(rows: list[dict], key: str) -> tuple[float, float, float, int, int]:
    k, n = sum(r[key] for r in rows), len(rows)
    lo, hi = wilson_ci(k, n)
    return (k / n if n else 0.0), lo, hi, k, n


def summarize(rows: list[dict]) -> dict:
    ok = [r for r in rows if "crashed" not in r]
    out: dict = {"n_runs": len(rows), "n_scenarios": len({r["scenario"] for r in rows}), "crashed": len(rows) - len(ok)}
    for m in RATES:
        out[m] = pct(ok, m)
    out["success_cashable"] = pct([r for r in ok if not r["uncashable"]], "success")
    by_sc: dict[str, list[int]] = defaultdict(list)
    for r in ok:
        by_sc[r["scenario"]].append(r["success"])
    n_min = min((len(v) for v in by_sc.values()), default=0)
    out["pass_hat"] = {k: pass_hat_k(by_sc, k) for k in (1, 2, 4) if k <= n_min}
    if ok:
        costs, secs = sorted(r["cost_cny"] for r in ok), sorted(r["seconds"] for r in ok)
        q = lambda xs, p: xs[min(len(xs) - 1, int(p * len(xs)))]  # noqa: E731
        out["cost"] = (sum(costs) / len(costs), q(costs, 0.95), sum(costs))
        out["secs"] = (q(secs, 0.5), q(secs, 0.95))
        out["turns2"] = sum(1 for r in ok if r.get("turns") == 2) / len(ok)
    by_cause: dict[str, list[int]] = defaultdict(list)
    for r in ok:
        by_cause[r["root_cause"]].append(r["success"])
    out["by_cause"] = {c: (sum(v), len(v)) for c, v in sorted(by_cause.items())}
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("run")
    s = summarize(load(ap.parse_args().run))
    print(f"运行 {s['n_runs']} 次 / 场景 {s['n_scenarios']} 个 / 崩溃 {s['crashed']}")
    for m in RATES:
        p, lo, hi, k, n = s[m]
        print(f"{m:14s} {p:6.1%} ({k}/{n})  95% CI [{lo:.1%}, {hi:.1%}]")
    p, lo, hi, k, n = s["success_cashable"]
    print(f"{'success(去掉兑现不了的)':14s} {p:6.1%} ({k}/{n})  95% CI [{lo:.1%}, {hi:.1%}]")
    print("pass^k", {k: round(v, 3) for k, v in s["pass_hat"].items()} or "只有 1 次试验,算不了")
    if "cost" in s:
        print(f"单次成本 均值 ¥{s['cost'][0]:.4f} P95 ¥{s['cost'][1]:.4f} 合计 ¥{s['cost'][2]:.4f};"
              f"耗时 P50 {s['secs'][0]:.1f}s P95 {s['secs'][1]:.1f}s;有追问 {s['turns2']:.0%}")
    for c, (k, n) in s["by_cause"].items():
        print(f"  {c:26s} {k}/{n}")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `RATES = ["success"` 要汇总的十个指标名,和判分器输出的字段一一对应。
- `def pct(rows: list[dict], key: str) -> tuple[float, float, float, int, int]:` 一个指标的比例、区间下限、上限、成功数、总数。
- `lo, hi = wilson_ci(k, n)` 区间用上面的函数算。
- `ok = [r for r in rows if "crashed" not in r]` 崩溃的运行不进分母:它没有产生结论,算成功或失败都不对,单独报崩溃数。
- `out["success_cashable"] = pct([r for r in ok if not r["uncashable"]], "success")` 去掉 S041、S083 这类兑现不了的场景再算一次成功率,两个数并排报。
- `by_sc: dict[str, list[int]] = defaultdict(list)` `defaultdict(list)` 访问不存在的键时自动建一个空列表,相当于 JS 里 `map.get(k) ?? []`。
- `n_min = min((len(v) for v in by_sc.values()), default=0)` 每个场景至少跑了几次。只有 `k <= n_min` 的 pass^k 才算得出来。
- `q = lambda xs, p: xs[min(len(xs) - 1, int(p * len(xs)))]  # noqa: E731` 取已排序列表的第 p 分位数:P50 是中位数,P95 是「95% 的运行不比这个更贵」。
- `out["turns2"] = sum(1 for r in ok if r.get("turns") == 2) / len(ok)` 有追问的运行占比,Day 693 说过,这是最便宜的「模拟客户有没有在工作」的检查。
- `print(f"{m:14s} {p:6.1%} ({k}/{n})  95% CI [{lo:.1%}, {hi:.1%}]")` `:6.1%` 是按百分比、保留一位小数、占 6 格宽。

</div>

## 先跑 5 个场景估单价

先别全跑。第一件事是跑 5 个,看每一次要花多少钱、多久,再按预算决定跑多少。我挑的 5 个有意覆盖几种情况:S001 取消后仍开票(普通)、S023 重复开票(Day 687 留下口径的)、S041 兑现不了的、S055 账没错、S064 另一个重复开票。

```bash
cd /Users/你/billsleuth
uv run python -m billsleuth.evals.run --out runs/v1.jsonl --only S001,S023,S041,S055,S064 --workers 2
```

```text
5 个场景 × 1 次,已完成 0,本次跑 5
S001 0 fail cancel_not_respected
S023 0 fail duplicate_invoice
S041 0 fail quantity_change_ignored
S064 0 fail duplicate_invoice
S055 0 ok no_error
```

5 个全跑完花了 47 秒,只有 S055(账没错)成功,5 个里 4 个失败。我没有马上相信这个数,先看 S001 为什么失败。这是一个很规矩的取消订阅场景,Day 687 里它每次都对。读结果行里的 `approval_error`:

```text
Error executing tool draft_credit_note: 冲正金额 174.90 加上已批准或已签发的 174.90,超过了这张发票的实际扣款合计 174.90。
```

「已批准或已签发的 174.90」。这个场景里本来没人签发过贷记单,这笔 174.90 是哪来的?原因是我的 `billing.db` 是从 Day 690 的工作目录复制来的,里面有前几天审批演示留下的 4 张贷记单(`CN-0001` 就是 `INV-0001-05` 上的 174.90,状态 `issued`),冻结母版时一并冻进去了。每一次运行都从这份有污染的母版出发,S001 的工具调用被拦住,转了人工。

更糟的是,这份污染还会制造假的成功:判分器看库里的贷记单,看到 `INV-0001-05` 上有一张金额对的,会以为是 Agent 起草的。这一次因为转了人工,没走到那一步;换一个场景,说不定就假过了。

这正是「冻结母版」一节里警告过的情况,我自己还是中招了。修法有两处:

1. 用 seed 重新造一份干净的库(`uv run python -m billsleuth.seed` 会重建 `billing.db` 和 100 个场景文件,场景文件内容完全一样,我用 `diff -r` 对过),把污染的放到一边。
2. 在 `run.py` 里加 `check_master`:冻结之后,先查贷记单、审批、幂等键三张表是不是空的,不是就拒绝开跑。

先给 `check_master` 写一条测试。测试用 `fresh_db`,先验证干净的库通过,再往里插一条「演示留下的草稿」,看它拒绝:

```python
def test_check_master_refuses_a_dirty_db(fresh_db):
    import sqlite3

    import pytest

    from billsleuth.evals.run import check_master
    check_master(fresh_db)                                     # 刚造好的库:通过
    conn = sqlite3.connect(fresh_db)
    conn.execute("INSERT INTO credit_notes VALUES ('CN-X', 'INV-0001-05', '1.00', '演示留下的草稿', 'draft')")
    conn.commit()
    conn.close()
    with pytest.raises(SystemExit, match="不干净"):
        check_master(fresh_db)
```

把它拿去对真正的污染库,看到的是:

```text
母版库 out/dirty_check.db 不干净:{'credit_notes': 4, 'approvals': 5, 'credit_note_requests': 4}。先用 seed 重新造一份再跑评测。
```

污染的这 5 次运行花了 ¥0.3059,白花了。重新用干净的母版再跑同样的 5 个:

```text
5 个场景 × 1 次,已完成 0,本次跑 5
S001 0 ok cancel_not_respected
S023 0 fail duplicate_invoice
S041 0 fail quantity_change_ignored
S064 0 fail duplicate_invoice
S055 0 ok no_error
```

S001 这回成功了(2/5)。污染前后的差别就在这一个场景上。

## 报错先演示:进程池被一个传不回来的异常弄坏

上面 `run.py` 里的 `run_job` 一开始并不存在,我最初的 `main` 是这样接异常的:

```python
            try:
                row = fut.result()
            except Exception as e:
                row = {"scenario": sid, "trial": t, "success": 0, "crashed": repr(e)[:300]}
```

想法很合理:子进程里出了任何异常,`fut.result()` 会把它重新抛出来,主进程接住记一行。为了验证崩溃行和续跑真的能用,我故意把 `LLM_API_KEY` 设成假的,跑一个场景:

```bash
LLM_API_KEY=sk-bad uv run python -m billsleuth.evals.run --out runs/crash_demo.jsonl --only S001 --workers 1
```

```text
1 个场景 × 1 次,已完成 0,本次跑 1
S001 0 fail BrokenProcessPool('A process in the process pool was terminated abruptly while the future was running or pending.')
```

我预期看到 `AuthenticationError`,看到的却是 `BrokenProcessPool`:进程池说子进程「被突然终止了」。可子进程明明只是抛了个异常。在主进程里直接调用 `one(...)`,看到的是正常的 `OpenAIAuthenticationError: Error code: 401`。

原因是子进程里的异常要先序列化(pickle),才能传回主进程。openai 的异常类构造时要几个关键字参数,序列化后反序列化时重建不出来,结果就是整个进程池被标记成坏的。如果还有 50 个任务排着队,它们全都会报 `BrokenProcessPool`。这和旧课里 Day 127 冒烟时撞上的是同一个现象,当时我没搞明白原因,只知道加 `max_tasks_per_child=1` 能缓解。

正确的做法是**在子进程里就把异常变成普通字典**,只让字符串穿过进程边界,也就是上面的 `run_job`。改完再演示一遍,这次崩溃行里是真正的原因:

```text
1 个场景 × 1 次,已完成 0,本次跑 1
S001 0 fail OpenAIAuthenticationError: Error code: 401 - Authentication Fails, Your api key: ****-bad is invalid (request_id: 0e1b9483-e4e6-4ccd-ac3f-71ae50eccabd)
```

再用同样的假 key 跑一遍,仍然是「已完成 0,本次跑 1」:崩溃行不算完成,每次都重跑。换回真 key 再跑同一条命令:

```text
1 个场景 × 1 次,已完成 0,本次跑 1
S001 0 ok cancel_not_respected
```

结果文件里只剩一行,是成功的那行,崩溃的那行被 `read_done` 删掉了。再跑一次同样的命令,提示变成「已完成 1,本次跑 0」,什么都不会再调用。这个重跑花了 ¥0.0343。

## 按预算决定跑多少

现在有了干净母版上 5 个场景的数:总花费 ¥0.3863,均值 ¥0.0773/个。算全量:

```text
100 场景 × 1 次 × ¥0.07 ≈ ¥7
100 场景 × 4 次 × ¥0.07 ≈ ¥28
```

课程的 API 预算是三天共 ¥2,Day 693 已经用了约 ¥0.16,今天还剩不到 ¥1.85。所以全量不可能跑完,只能跑一个子集:用 `--per-group 1` 做分层抽样(12 类根因加 4 种账没错,共 16 组,每组抽 1 个),先跑一批 8 个,看花费,再决定第二批:

```bash
uv run python -m billsleuth.evals.run --out runs/v1.jsonl --per-group 1 --only S013,S017,S028,S034,S039,S048,S050,S057 --workers 2
```

```text
8 个场景 × 1 次,已完成 5,本次跑 8
S017 0 ok duplicate_charge
S013 0 ok proration_missing_credit
S028 0 ok quantity_change_ignored
S039 0 ok cancel_not_respected
S034 0 ok wrong_plan_price
S048 0 fail duplicate_invoice
S050 0 ok no_error
S057 0 fail proration_wrong_days
```

这一批 8 个花了 ¥0.50,均值 ¥0.063。累计 ¥0.89。接着再跑 6 个(`S060,S069,S072,S073,S080,S096`),花费约 ¥0.51,没有去跑 S061 和 S075(这两组留空),给后面留余地。还有一次手滑:有一回我想看「已完成 19」的提示,命令里忘了带 `--only`,用 `head -1` 截断输出,结果进程已经开跑了,多跑完一个 S002(¥0.049)才被我 `pkill` 掉。这一行我没有删,算作第 20 个运行,也记进下面的花费里。

结论:**今天跑了 20 个场景(每个 1 次),覆盖 14 个组,全量 100 个留空回填。**

## 读报告

```bash
uv run python -m billsleuth.evals.report runs/v1.jsonl
```

```text
运行 20 次 / 场景 20 个 / 崩溃 0
success         75.0% (15/20)  95% CI [53.1%, 88.8%]
root_ok        100.0% (20/20)  95% CI [83.9%, 100.0%]
overcharge_ok  100.0% (20/20)  95% CI [83.9%, 100.0%]
action_ok      100.0% (20/20)  95% CI [83.9%, 100.0%]
invoice_ok     100.0% (20/20)  95% CI [83.9%, 100.0%]
bad_reply        0.0% (0/20)  95% CI [0.0%, 16.1%]
wrong_credit     0.0% (0/20)  95% CI [0.0%, 16.1%]
missed_credit   25.0% (5/20)  95% CI [11.2%, 46.9%]
escalated       25.0% (5/20)  95% CI [11.2%, 46.9%]
fallback        15.0% (3/20)  95% CI [5.2%, 36.0%]
success(去掉兑现不了的)  78.9% (15/19)  95% CI [56.7%, 91.5%]
pass^k {1: 0.75}
单次成本 均值 ¥0.0698 P95 ¥0.1754 合计 ¥1.3969;耗时 P50 14.5s P95 42.2s;有追问 30%
  cancel_not_respected       2/2
  coupon_not_applied         1/1
  duplicate_charge           1/1
  duplicate_invoice          0/3
  no_error                   5/5
  proration_missing_credit   2/2
  proration_wrong_days       0/1
  quantity_change_ignored    1/2
  timezone_change_date       1/1
  wrong_plan_price           1/1
  wrong_tax_region           1/1
```

先看每个场景的明细(完成顺序,不是场景号顺序):

```bash
uv run python -m scripts.show_runs runs/v1.jsonl
```

```text
S001 cancel_not_respected     hurry     1轮 成功  ¥0.032   10s  
S023 duplicate_invoice        finance   1轮 失败  ¥0.039   10s  missed_credit,escalated
S041 quantity_change_ignored  forgetful 1轮 失败  ¥0.100   26s  missed_credit,escalated,fallback
S064 duplicate_invoice        angry     1轮 失败  ¥0.039   11s  missed_credit,escalated
S055 no_error                 forgetful 2轮 成功  ¥0.175   42s  fallback
S017 duplicate_charge         angry     1轮 成功  ¥0.034    9s  
S013 proration_missing_credit angry     2轮 成功  ¥0.088   20s  
S028 quantity_change_ignored  angry     1轮 成功  ¥0.047   11s  
S039 cancel_not_respected     hurry     1轮 成功  ¥0.034    9s  
S034 wrong_plan_price         angry     2轮 成功  ¥0.098   22s  
S048 duplicate_invoice        forgetful 1轮 失败  ¥0.056   11s  missed_credit,escalated
S050 no_error                 hurry     1轮 成功  ¥0.049   13s  
S057 proration_wrong_days     forgetful 1轮 失败  ¥0.095   23s  missed_credit,escalated,fallback
S069 wrong_tax_region         hurry     1轮 成功  ¥0.035   12s  
S060 no_error                 angry     1轮 成功  ¥0.055   14s  
S073 no_error                 finance   2轮 成功  ¥0.101   25s  
S072 no_error                 finance   2轮 成功  ¥0.107   29s  
S080 timezone_change_date     finance   1轮 成功  ¥0.061   18s  
S096 coupon_not_applied       angry     2轮 成功  ¥0.102   25s  
S002 proration_missing_credit angry     1轮 成功  ¥0.049   14s  
```

这份报告能读出几件事,也有几件事不能读。

**能说的:Agent 的判断本身没出错。** 根因、多收金额、动作、发票号四项都是 20/20,区间下限 83.9%。20 次里没有一次判断错、没有一次编数字(`bad_reply` 0/20)、没有一次误冲正(`wrong_credit` 0/20)。

**能说的:失败全部是「判断对了,但没能成功」。** 5 个失败里,`missed_credit` 和 `escalated` 同时是 5/20:它们都在流程的后半段被拦下来转了人工。先分三类看:

- S023、S064、S048(都是重复开票)三个都是 `approval_error: 没有证据能说明贷记单该开在哪张发票上`。Day 691 为了不让重复开票开错发票,改成了「证据不唯一就转人工」,这三个场景的 `credit_target` 都返回了 `None`。重复开票 3 个场景 0/3。
- S041 是兑现不了的场景,预料之中。
- S057 和 S041 都是 `解释由模板兜底,转人工`:写作三稿都没通过校验,用了模板,图就不自动起草了。

**不能说的:「成功率 75%」。** 20 次里成功 15 次,Wilson 区间是 [53.1%, 88.8%]。样本太小,真实成功率在五成到近九成之间都说得过去。如果把 S041 这个兑现不了的拿掉,是 15/19(78.9%),区间 [56.7%, 91.5%],还是宽。而且这 20 个是分层抽样的 14 个组,不是全部 100 个的随机样本,所以这个比例不能直接推到全量。

**不能说的:「哪一类根因最弱」。** 按根因分组,每组只有 1 到 3 个。`duplicate_invoice` 0/3 看起来最差,但原因是上面那个具体的 `credit_target` 设计,不是模型的判断力;`no_error` 5/5 看起来最好,也只有 5 个。分组数据只用来找「哪一类明显不行」,不用来比较两类谁更好。

**能说的:追问有在发生。** 20 次里 6 次有追问(30%),追问的话和 Day 693 实验里写的诉求一一对应:财务要「哪张发票、差在哪一项」,激动的客户问「钱到底退不退、退到哪里」。模拟客户在工作。

**能说的:花费和耗时。** 单次均值 ¥0.0698,P95 ¥0.1754(那是 S055:账没错、还有追问、两轮都写了解释,用了 5.9 万输入 token);耗时 P50 14.5 秒,P95 42.2 秒。有追问的运行花费大约是没追问的两倍。

**一个先记下、明天读的线索:兜底。** 兜底的 3 次(S041、S055、S057)在人设上有个共同点,全是「记性不好」那一档。四次这个人设的运行里有三次兜底。今天只记下,不下结论,明天做错误分析时读。

## 正式结果(留空,跑完回填)

下面这张表是全量评测要填的。今天填的是「子集 20 个」这一栏;「全量」栏留空,等有预算再跑 100 个场景、每个至少 4 次后回填。

| 指标 | 子集 20 个 × 1 次 | 95% CI | 全量(留空回填) |
| --- | --- | --- | --- |
| 成功率(pass^1) | 75.0%(15/20) | [53.1%, 88.8%] | |
| 成功率,去掉兑现不了的 | 78.9%(15/19) | [56.7%, 91.5%] | |
| pass^2、pass^4 | 算不了(只有 1 次试验) | — | |
| 根因准确率 | 100%(20/20) | [83.9%, 100%] | |
| 多收金额精确匹配 | 100%(20/20) | [83.9%, 100%] | |
| 发票号 | 100%(20/20) | [83.9%, 100%] | |
| 客户版有问题 | 0%(0/20) | [0%, 16.1%] | |
| 误冲正率 | 0%(0/20) | [0%, 16.1%] | |
| 漏冲正率 | 25%(5/20) | [11.2%, 46.9%] | |
| 转人工率 | 25%(5/20) | [11.2%, 46.9%] | |
| 兜底率 | 15%(3/20) | [5.2%, 36.0%] | |
| 单次成本 均值 / P95 | ¥0.0698 / ¥0.1754 | — | |
| 耗时 P50 / P95 | 14.5 秒 / 42.2 秒 | — | |
| 有追问的运行占比 | 30%(6/20) | — | |

想在 100 个场景上可靠地看出一个差距,可以先算算要多少样本:成功率在 75% 左右时,Wilson 区间的半宽是 8.4%(100 个场景),想压到 ±5 个点大约要 285 个独立样本(练习 2 会算)。100 个场景每个跑 4 次不是 400 个独立样本:同一个场景的几次运行互相相关,[Day 548](/blog/agent-zero/day-548-eval-stats-2/) 讲过用例不独立、要按场景聚类,样本量怎么估在 [Day 550](/blog/agent-zero/day-550-eval-stats-4/)。所以 100 个场景最多能分辨约 8 个点的差距,明天、后天做改动前后对比时,别拿 3 个点的变化当结论。

## 测评测代码

评测代码本身的测试都不调模型,用假状态:

```python
# billsleuth/tests/test_eval.py  判分、统计、汇总本身的测试:用假状态,不调模型
import json

from billsleuth.evals import report
from billsleuth.evals.grade import grade, is_success
from billsleuth.evals.run import pick_subset
from billsleuth.evals.scenarios import load_all, truth
from billsleuth.evals.selfcheck import NULL_STATE, reference_state
from billsleuth.evals.stats import pass_hat_k, wilson_ci

BY_ID = {s["id"]: s for s in load_all()}
S023, S003, S041 = BY_ID["S023"], BY_ID["S003"], BY_ID["S041"]   # 重复开票 / 账没错 / 兑现不了


def test_reference_passes_and_null_agent_fails_everywhere():
    for sc in BY_ID.values():
        assert grade(sc, *reference_state(sc))["success"] == 1, sc["id"]
        assert grade(sc, NULL_STATE, [])["success"] == 0, sc["id"]


def test_extra_original_invoice_is_ok_but_credit_must_hit_the_duplicate():
    st, cns = reference_state(S023)
    dup = truth(S023)["invoice_ids"][0]
    orig = dup[:-1]                                   # INV-0023-04D → INV-0023-04
    st["findings"]["invoice_ids"] = [orig, dup]
    g = grade(S023, st, cns)
    assert g["success"] == 1 and g["extra_invoices"] == [orig]
    on_orig = [{**cns[0], "invoice_id": orig}]        # 贷记单开到了原发票上
    assert grade(S023, st, on_orig)["wrong_credit"] == 1


def test_invented_number_fails():
    st, cns = reference_state(S023)
    st["reply"] = {"customer_message": f"多收了 {truth(S023)['overcharge']} 美元,另外补偿您 5.00 美元。"}
    g = grade(S023, st, cns)
    assert g["bad_reply"] == 1 and g["success"] == 0


def test_time_promise_in_reply_fails():
    st, cns = reference_state(S023)
    st["reply"] = {"customer_message": f"多收了 {truth(S023)['overcharge']} 美元,3 个工作日内退回。"}
    assert grade(S023, st, cns)["bad_reply"] == 1


def test_credit_on_no_error_is_wrong_credit_and_rejected_does_not_count():
    st, _ = reference_state(S003)
    inv = truth(S003)["invoice_ids"][0]
    assert grade(S003, st, [{"id": "CN-1", "invoice_id": inv, "amount": "10.00", "status": "draft"}])["wrong_credit"] == 1
    assert grade(S003, st, [{"id": "CN-1", "invoice_id": inv, "amount": "10.00", "status": "rejected"}])["success"] == 1


def test_missed_credit_and_escalation_are_not_success():
    st, cns = reference_state(S023)
    assert grade(S023, st, [])["missed_credit"] == 1
    assert grade(S023, {**st, "escalated": True}, cns)["success"] == 0


def test_uncashable_scenario_is_flagged_and_blocked_run_fails():
    st, _ = reference_state(S041)
    g = grade(S041, {**st, "escalated": True}, [])     # 代码拒绝起草,图转人工
    assert g["uncashable"] == 1 and g["success"] == 0 and g["missed_credit"] == 1


def test_wilson_and_pass_hat():
    lo, hi = wilson_ci(16, 16)
    assert abs(lo - 16 / (16 + 1.96 ** 2)) < 1e-9 and hi == 1.0
    assert wilson_ci(0, 0) == (0.0, 1.0)
    assert pass_hat_k({"a": [1, 1, 1, 1], "b": [1, 1, 0, 0]}, 1) == 0.75
    assert abs(pass_hat_k({"a": [1, 1, 1, 1], "b": [1, 1, 0, 0]}, 2) - (1 + 1 / 6) / 2) < 1e-9


def test_pick_subset_is_stratified_and_stable():
    scs = list(BY_ID.values())
    a, b = pick_subset(scs, 2), pick_subset(scs, 2)
    assert [s["id"] for s in a] == [s["id"] for s in b]
    assert len(a) == 32                                 # 12 类根因 + 4 种账没错 = 16 组,每组 2 个
    assert {truth(s)["root_cause"] for s in a} == {truth(s)["root_cause"] for s in scs}


def test_report_summarize_skips_crashes_and_splits_uncashable():
    base = {m: 0 for m in report.RATES} | {"root_cause": "x", "cost_cny": 0.05, "seconds": 20.0, "turns": 1, "uncashable": 0}
    rows = [{**base, "scenario": "a", "trial": 0, "success": 1},
            {**base, "scenario": "b", "trial": 0, "success": 0},
            {**base, "scenario": "S041", "trial": 0, "success": 0, "uncashable": 1},
            {"scenario": "d", "trial": 0, "success": 0, "crashed": "timeout"}]
    s = report.summarize(rows)
    assert s["n_runs"] == 4 and s["crashed"] == 1
    assert s["success"][3:] == (1, 3) and s["success_cashable"][3:] == (1, 2)
    json.dumps(s, default=str)


def test_check_master_refuses_a_dirty_db(fresh_db):
    import sqlite3

    import pytest

    from billsleuth.evals.run import check_master
    check_master(fresh_db)                                     # 刚造好的库:通过
    conn = sqlite3.connect(fresh_db)
    conn.execute("INSERT INTO credit_notes VALUES ('CN-X', 'INV-0001-05', '1.00', '演示留下的草稿', 'draft')")
    conn.commit()
    conn.close()
    with pytest.raises(SystemExit, match="不干净"):
        check_master(fresh_db)


def test_read_done_skips_finished_and_drops_crashed(tmp_path):
    """练习 3:断点续跑只认「没崩溃」的行;崩溃的行从文件里删掉,让它重跑。"""
    from billsleuth.evals.run import read_done
    out = tmp_path / "v.jsonl"
    out.write_text(json.dumps({"scenario": "S001", "trial": 0, "success": 1}) + "\n"
                   + json.dumps({"scenario": "S002", "trial": 0, "success": 0, "crashed": "timeout"}) + "\n\n")
    assert read_done(out) == {("S001", 0)}
    assert [json.loads(ln)["scenario"] for ln in out.read_text().splitlines()] == ["S001"]
    assert read_done(tmp_path / "nothing.jsonl") == set()


def test_every_single_flag_blocks_success():
    """练习 4:把判分器偷偷改松,原来的测试一条都不红;这条逐个标志检查:单独一项出问题就必须判失败。
    标志名在这里重写一遍,不从 grade 里 import:从被测的代码里取清单,清单被改松时测试也跟着松,等于没测。"""
    good = ("root_ok", "overcharge_ok", "action_ok", "invoice_ok")
    bad = ("bad_reply", "wrong_credit", "missed_credit", "escalated")
    row = {k: 1 for k in good} | {k: 0 for k in bad}
    assert is_success(row) == 1
    for k in good:
        assert is_success({**row, k: 0}) == 0, k
    for k in bad:
        assert is_success({**row, k: 1}) == 0, k
```

<div class="line-notes">

- `BY_ID = {s["id"]: s for s in load_all()}` 100 个场景按场景号索引,字典推导式,相当于 JS 里 `Object.fromEntries`。
- `S023, S003, S041 = BY_ID["S023"], BY_ID["S003"], BY_ID["S041"]` 三个有代表性的:重复开票(标准答案只有多开的那张)、账没错、兑现不了。
- `def test_reference_passes_and_null_agent_fails_everywhere():` 自检写成测试:参考解在每个场景上都成功、空 Agent 在每个场景上都失败。`assert ..., sc["id"]` 逗号后面是断言失败时显示的信息,告诉你是哪个场景。
- `orig = dup[:-1]` 字符串切片去掉最后一个字符,得到原发票号。
- `st["findings"]["invoice_ids"] = [orig, dup]` 把参考解的结论改成「两张都写」,模拟 Day 687 里模型的做法。
- `assert g["success"] == 1 and g["extra_invoices"] == [orig]` 成功,并且多写的那张被记了下来。
- `on_orig = [{**cns[0], "invoice_id": orig}]        # 贷记单开到了原发票上` 把贷记单的发票号换成原发票,模拟误冲正。
- `st["reply"] = {"customer_message": f"多收了 {truth(S023)['overcharge']} 美元,另外补偿您 5.00 美元。"}` 客户版里编了一个 5.00 的补偿,证据里找不到。Agent 自作主张许诺补偿,比算错一个数还危险。
- `3 个工作日内退回` 客户版里承诺了时限,`grounding.check` 的客户版规则会抓。
- `"status": "draft"}])["wrong_credit"] == 1` 账没错的场景里起草了贷记单,是误冲正。
- `"status": "rejected"}])["success"] == 1` 同一张如果是被驳回的,不算。
- `assert grade(S023, {**st, "escalated": True}, cns)["success"] == 0` 图转了人工,哪怕别的都对,也不算成功。
- `g = grade(S041, {**st, "escalated": True}, [])     # 代码拒绝起草,图转人工` 兑现不了的场景:标记为 `uncashable`,而且失败,漏冲正 1。
- `assert abs(lo - 16 / (16 + 1.96 ** 2)) < 1e-9 and hi == 1.0` 16 次全对,Wilson 下限的公式是 `n / (n + z²)`。这个等式 Day 687 提过,这里用它验证实现对不对。
- `assert wilson_ci(0, 0) == (0.0, 1.0)` 一次都没跑,区间是 0 到 1。
- `assert pass_hat_k({"a": [1, 1, 1, 1], "b": [1, 1, 0, 0]}, 1) == 0.75` 场景 a 次次对(1.0),场景 b 一半对(0.5),平均 0.75。
- `assert abs(pass_hat_k(` b 里任取两次都成功的概率是 `C(2,2)/C(4,2) = 1/6`。
- `assert len(a) == 32` 12 类根因加 4 种账没错一共 16 组,每组 2 个。
- `assert s["success"][3:] == (1, 3) and s["success_cashable"][3:] == (1, 2)` 元组切片取最后两个数,成功数和总数:崩溃的不进分母(3 个有效),拿掉兑现不了的以后是 2 个。
- `def test_check_master_refuses_a_dirty_db(fresh_db):` 前面「先跑 5 个」里讲过的那条。
- `with pytest.raises(SystemExit, match="不干净"):` 断言这段代码会以 `SystemExit` 退出,并且信息里包含「不干净」。
- `def test_read_done_skips_finished_and_drops_crashed(tmp_path):` 练习 3 的测试:断点续跑只认没崩溃的行,崩溃的行被删掉。`tmp_path` 是 pytest 提供的临时目录。
- `assert read_done(tmp_path / "nothing.jsonl") == set()` 文件不存在时,算「什么都没完成」。
- `def test_every_single_flag_blocks_success():` 练习 4 的测试:逐个标志检查。
- `good = ("root_ok", "overcharge_ok", "action_ok", "invoice_ok")` 标志名在测试里重写一遍,不从 `grade` 里 import。
- `row = {k: 1 for k in good} | {k: 0 for k in bad}` 字典合并运算符 `|`,相当于 JS 的 `{...a, ...b}`。
- `assert is_success({**row, k: 0}) == 0, k` 四项该对的里,任何一项变成 0,都不能成功。
- `assert is_success({**row, k: 1}) == 0, k` 四项不该有的里,任何一项变成 1,也不能成功。

</div>

```bash
uv run pytest -q
```

```text
369 passed in 19.10s
```

## 今天的文件

| 文件 | 做什么 |
| --- | --- |
| `billsleuth/evals/grade.py` | 判分:`GOOD`、`BAD`、`is_success`、`grade` |
| `billsleuth/evals/selfcheck.py` | 参考解和空 Agent 的自检 |
| `billsleuth/evals/stats.py` | `wilson_ci`、`pass_hat_k` |
| `billsleuth/evals/run.py` | 跑评测:进程池、母版、断点续跑、分层抽样 |
| `billsleuth/evals/report.py` | 汇总成带区间的报告 |
| `billsleuth/llm.py` | `get_llm` 里加了一行 `timeout`(`LLM_TIMEOUT`,默认 60 秒) |
| `scripts/show_runs.py` | 一行一个场景扫一眼结果 |
| `tests/test_eval.py` | 13 条测试,不调模型 |
| `scratch/ex1_strict_invoice.py`、`ex2_interval_width.py` | 练习 1、2 |
| `runs/v1.jsonl` | 20 次运行,明天的错误分析要读它 |

`llm.py` 里那一行是:

```python
        timeout=float(os.environ.get("LLM_TIMEOUT", "60")),  # Day 694 新增:SDK 默认 600 秒,一个请求挂住整批评测就停了
```

测试总数 369 条(Day 693 的 356 加今天的 13 条),全绿,basedpyright 对新文件 0 报错。

今天真模型花费(全部 `deepseek-flash`,按 `LLM_PRICE=0.04,2,8`,输入按未命中价算,是上限):

| 项目 | 花费 |
| --- | --- |
| 母版有污染的 5 次运行(白花) | ¥0.3059 |
| 干净母版上的 20 次运行(含手滑多跑的 S002 ¥0.0489) | ¥1.3969 |
| 崩溃演示后真 key 重跑 1 次 | ¥0.0343 |
| 合计 | ¥1.7371 |

加上 Day 693 的 ¥0.1555,两天合计 ¥1.8926,距离三天 ¥2 的预算只剩约 ¥0.11。所以明天的错误分析不再调模型,只读今天的 `runs/v1.jsonl`。

## 动手练习

**练习 1:发票号口径改成「必须完全一致」,20 次运行会变成几个成功?** 写脚本读 `runs/v1.jsonl`,比较两种口径:现在的「标准答案的发票都在就行」和严格的「集合必须相等」。找出被翻转的运行。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex1_strict_invoice.py  练习 1:发票号口径改成「必须完全一致」,20 次运行的成功数会变成几?
import json

rows = [json.loads(ln) for ln in open("runs/v1.jsonl", encoding="utf-8")]
flipped = [r for r in rows if r["success"] and r["extra_invoices"]]   # 现在算成功,但多写了发票号
loose = sum(r["success"] for r in rows)
print(f"现口径(标准答案的发票都在就行): {loose}/{len(rows)}")
print(f"严格口径(发票号集合必须相等):   {loose - len(flipped)}/{len(rows)}")
for r in flipped:
    print(f"  {r['scenario']} {r['root_cause']} 结论 {r['got_invoices']} 多写了 {r['extra_invoices']}")
print("多写了发票号的运行一共", sum(bool(r["extra_invoices"]) for r in rows), "次,其中失败的:",
      [r["scenario"] for r in rows if r["extra_invoices"] and not r["success"]])
```

<div class="line-notes">

- `rows = [json.loads(ln) for ln in open("runs/v1.jsonl", encoding="utf-8")]` 读 20 行 JSON,每行一次运行。
- `flipped = [r for r in rows if r["success"] and r["extra_invoices"]]` 「现在成功」并且「多写了发票号」的运行。严格口径下它们会从成功变成失败。`extra_invoices` 是空列表时为假。
- `loose = sum(r["success"] for r in rows)` 现口径下的成功数,15。
- `print(f"严格口径` 严格口径的成功数 = 现成功数 − 被翻转的个数。
- `print("多写了发票号的运行一共"` 不管成败,多写发票号的一共几次。

</div>

```bash
uv run python -m scratch.ex1_strict_invoice
```

```text
现口径(标准答案的发票都在就行): 15/20
严格口径(发票号集合必须相等):   14/20
  S055 no_error 结论 ['INV-0055-03', 'INV-0055-04'] 多写了 ['INV-0055-04']
多写了发票号的运行一共 4 次,其中失败的: ['S023', 'S064', 'S048']
```

被翻转的只有 S055,而它是个「账没错」的场景:客户问「升级后账单里多了两行」,Agent 把相关的两张发票都写进了结论,解释了为什么没有错。这一次本来就是对的,严格口径把它判成了失败,是冤枉。多写了发票号的 4 次里 3 次(S023、S064、S048,全是重复开票)失败的原因是转了人工,和发票号口径无关。所以发票号这一项在这批数据上区分不出好坏,口径宽严最多影响一个场景。但如果口径写成严格,你会去「修」一个根本没错的行为。

</details>

**练习 2:成功率大约 75%,要多少个场景,95% 区间半宽才能降到 5 个点?** 用 `wilson_ci`,从 20 个场景开始往上试。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex2_interval_width.py  练习 2:成功率大约 75%,要跑多少个场景,95% 区间才能窄到 ±5 个点?
from billsleuth.evals.stats import wilson_ci

p = 0.75


def half_width(n: int) -> float:
    lo, hi = wilson_ci(round(p * n), n)
    return (hi - lo) / 2


for n in (20, 40, 100, 200, 300, 400):
    k = round(p * n)
    lo, hi = wilson_ci(k, n)
    print(f"n={n:3d}  成功 {k:3d}  区间 [{lo:.1%}, {hi:.1%}]  半宽 {(hi - lo) / 2:.1%}")
n = 20
while half_width(n) > 0.05:
    n += 1
print(f"半宽第一次 ≤ 5 个点的场景数: {n}")
```

<div class="line-notes">

- `p = 0.75` 假设真实成功率就是今天测到的 75%。
- `def half_width(n: int) -> float:` 给定场景数,算这个成功率下 95% 区间的半宽。
- `lo, hi = wilson_ci(round(p * n), n)` 在 n 个独立场景里,按 75% 应该成功的个数是 `round(p * n)`,n=100 时是 75。区间用今天写的函数。
- `return (hi - lo) / 2` 半宽,「正负多少个点」的那个数。
- `while half_width(n) > 0.05:` 只要半宽还大于 5 个点就让 `n` 加一,停下来的那个 `n` 就是答案。

</div>

```bash
uv run python -m scratch.ex2_interval_width
```

```text
n= 20  成功  15  区间 [53.1%, 88.8%]  半宽 17.8%
n= 40  成功  30  区间 [59.8%, 85.8%]  半宽 13.0%
n=100  成功  75  区间 [65.7%, 82.5%]  半宽 8.4%
n=200  成功 150  区间 [68.6%, 80.5%]  半宽 6.0%
n=300  成功 225  区间 [69.8%, 79.6%]  半宽 4.9%
n=400  成功 300  区间 [70.5%, 79.0%]  半宽 4.2%
半宽第一次 ≤ 5 个点的场景数: 285
```

20 个场景时区间 [53%, 89%],半宽近 18 个点,和今天的报告一致。到 100 个场景(每个只算一次独立运行)半宽还有 8.4 个点;要压到 5 个点以内需要大约 285 个独立样本。这还是乐观的:同一场景多跑几次并不增加独立样本,只有加场景才行。所以评测集规模决定了你能分辨多小的差距,这个数要写进报告。

</details>

**练习 3:写一条测试,保证断点续跑只认没崩溃的行。** 提示:`main` 里那几行读文件的逻辑先拆成 `read_done(out)` 函数,再测。

<details><summary>参考答案</summary>

先把 `main` 里的读文件逻辑拆成函数(上面 `run.py` 里已经是拆好的版本):

```python
def read_done(out: Path) -> set[tuple[str, int]]:
    """断点续跑:已有结果且不是崩溃的算做完了,崩溃的行从文件里删掉,等着重跑。"""
    if not out.exists():
        return set()
    kept = [ln for ln in out.read_text().splitlines() if ln.strip() and "crashed" not in json.loads(ln)]
    out.write_text("".join(ln + "\n" for ln in kept))
    return {(json.loads(ln)["scenario"], json.loads(ln)["trial"]) for ln in kept}
```

测试在 `tests/test_eval.py` 末尾:

```python
def test_read_done_skips_finished_and_drops_crashed(tmp_path):
    """练习 3:断点续跑只认「没崩溃」的行;崩溃的行从文件里删掉,让它重跑。"""
    from billsleuth.evals.run import read_done
    out = tmp_path / "v.jsonl"
    out.write_text(json.dumps({"scenario": "S001", "trial": 0, "success": 1}) + "\n"
                   + json.dumps({"scenario": "S002", "trial": 0, "success": 0, "crashed": "timeout"}) + "\n\n")
    assert read_done(out) == {("S001", 0)}
    assert [json.loads(ln)["scenario"] for ln in out.read_text().splitlines()] == ["S001"]
    assert read_done(tmp_path / "nothing.jsonl") == set()
```

<div class="line-notes">

- `out.write_text(json.dumps({"scenario": "S001"` 造一个结果文件:S001 完成,S002 崩溃,末尾多一个空行。空行是为了验证 `ln.strip()` 能忽略它。
- `assert read_done(out) == {("S001", 0)}` 返回的「已完成」集合里只有 S001 的第 0 次试验,崩溃的 S002 不算。
- `assert [json.loads(ln)["scenario"] for ln in out.read_text().splitlines()] == ["S001"]` 读完以后文件里只剩 S001 一行,崩溃行和空行都被清掉了。重跑完文件里就不会有 S002 的两行。
- `assert read_done(tmp_path / "nothing.jsonl") == set()` 文件不存在:第一次跑,什么都没完成。

</div>

```text
12 passed in 0.26s
```

</details>

**练习 4:偷偷把判分器改松,原来的测试会不会红?** 把 `is_success` 里的「误冲正必须为 0」去掉(`BAD` 里删掉 `wrong_credit`),跑 `tests/test_eval.py` 和自检,看有没有红。再写一条测试把它抓住。

<details><summary>参考答案</summary>

改动(先在没有新测试的时候做):

```python
BAD = ("bad_reply", "missed_credit", "escalated")   # 删掉了 wrong_credit
```

我一开始的测试里,专门盯误冲正的那条是这样写的:

```python
def test_credit_on_no_error_is_wrong_credit_and_rejected_does_not_count():
    ...
    assert grade(S003, st, [{"id": "CN-1", ..., "status": "draft"}])["wrong_credit"] == 1
```

断言的是 `wrong_credit` 这个字段等于 1,没有断言「因此 success 等于 0」。判分器改松以后,字段照样是 1,测试照样绿:

```text
12 passed in 0.24s
100 个场景,80 个有错;空 Agent 通过 0 个
自检通过
```

12 条测试和自检,一条都没红。「漏冲正」那一项也一样,只断言了字段,没断言它让运行失败。判分器最该被守住的地方恰恰是「哪几项一出现就判失败」。补一条测试,逐个标志检查,单独一项出问题就必须判失败(`tests/test_eval.py` 里的 `test_every_single_flag_blocks_success`,上面「测评测代码」里已经贴过)。

再做一次破坏。第一次我偷懒,让测试从 `grade.py` 里 `import` 那两张清单,结果清单被改松时测试也跟着松,还是绿。所以测试里的标志名要自己重写一遍,不从被测的代码里取。这样再把 `BAD` 里的 `wrong_credit` 删掉:

```text
FAILED tests/test_eval.py::test_every_single_flag_blocks_success
E           AssertionError: wrong_credit
E           assert 1 == 0
```

红了,并且直接告诉你是哪一项被放过了。改回去,369 条全绿。

</details>

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 判分 | 按标准答案和库的最终状态,给一次运行打「成功或失败」。本课全部用规则,例子:`is_success` |
| 参考解 | 照抄标准答案的假 Agent,必须在所有场景上都判成功,用来验判分器和标准答案自己 |
| 空 Agent | 永远说「账没错」、什么都不指的假 Agent,必须在所有场景上都判失败 |
| 最终状态判分 | 不看 Agent 说了什么,看库里最后变成了什么。例子:库里有没有多出一张不该有的贷记单 |
| 误冲正 | 不该冲正的冲了,或者金额、发票不对。代价最大的错误 |
| 漏冲正 | 该冲正却没有起草。客户会再来,代价较小 |
| 兜底 | 写作三稿都没通过校验,用模板代替。只统计不影响成功 |
| 母版库 | 评测开始时冻结的数据库快照,每次运行都从它复制一份。必须是干净的 |
| 污染 | 母版库里带着前面演示留下的贷记单、审批记录,会改变每个场景的结果 |
| 断点续跑 | 结果一行一行追加,再跑时跳过做完的、重跑崩溃的。批处理中途断掉不用从头来 |
| 进程池(`ProcessPoolExecutor`) | 开几个子进程并发跑任务,各有各的环境变量和内存。`max_tasks_per_child=1` 是一个任务一个新进程 |
| 序列化(pickle) | 把对象变成字节,才能在进程之间传。有的异常对象序列化后重建不出来 |
| JSONL | 一行一个 JSON 的文本文件,适合追加写。例子:`runs/v1.jsonl` |
| 分层抽样 | 先按类别分组,每组抽几个,保证每类都有。例子:`pick_subset` 每个(根因, variant)抽 1 个 |
| Wilson 区间 | 估计「真实成功率」范围的公式,小样本、全对时也给出合理的区间 |
| 单价 | 一次运行的平均花费,按这个估全量要多少钱。本课 ¥0.07 每次 |

## 常见误区

**判分器写完不测,直接跑评测。** 判分器错了,你会对着一份假报告优化好几天。参考解必须全过、空 Agent 必须全挂,而且要测「判分器改松时测试会不会红」(练习 4:12 条测试一条都没红)。

**测试里的标志清单从被测代码里 import。** 清单被改松时,测试跟着松。测试里重写一遍。

**拿污染的库当母版。** 今天第一次跑 5 个场景白花了 ¥0.3059:母版里有前几天审批演示留下的 `issued` 贷记单,S001 被工具拦下转了人工。更糟的是这样的贷记单还会让判分器把它当成 Agent 自己起草的,制造假的成功。冻结前先验干净。

**让异常穿过进程边界。** openai 的异常对象序列化后重建不出来,整个进程池会被弄坏,后面排队的任务全部变成 `BrokenProcessPool`。在子进程里捕获,变成字典,只让字符串穿过。

**手滑多跑了也不记账。** 一条忘了 `--only` 的命令多花了 ¥0.049。每次花钱的命令都先确认参数,花完把算式写下来。

**拿 20 个场景的 75% 当「成功率」。** 区间是 [53%, 89%],而且是分层抽样的子集,不是随机样本,推不到全量。

**拿每组一两个场景的成功数比较哪类根因更弱。** `duplicate_invoice` 0/3 看起来最差,其实是 `credit_target` 的一个具体设计,不是模型判断力。分组数据只用来找「哪一类明显不行」。

**一个失败了就改提示词。** 今天 5 个失败里,没有一个是模型判断错,全部是流程后半段把它拦下来了。动手改之前先分桶,明天做。

**发票号口径定得太严。** 严格口径会把 S055 这种「解释时提了相关发票」的正确运行判成失败,你会去修一个没问题的行为。

## 学习资料

### 文档与文章

- [τ-bench 论文(Yao 等,2024)](https://arxiv.org/abs/2406.12045):按最终数据库状态判分、pass^k 的出处,重点读第 3 节,40 分钟。
- [Anthropic · Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):Agent 评测怎么设计、怎么判分、什么时候用模型评审,30 分钟。
- [Evan Miller · Adding Error Bars to Evals](https://arxiv.org/abs/2411.00640):评测里的误差棒,聚类标准误和样本量,读摘要和第 2、3 节,20 分钟。
- [Hamel Husain · LLM Evals FAQ](https://hamel.dev/blog/posts/evals-faq/):挑「评测集多大」和「要不要用模型评审」两节,20 分钟。
- [Python 文档 · concurrent.futures](https://docs.python.org/3/library/concurrent.futures.html):`ProcessPoolExecutor` 的 `max_tasks_per_child` 和 `BrokenProcessPool`,10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1aaxyz8ELY&p=19&autoplay=0&high_quality=1" title="(中英双语!)吴恩达最新《Agentic AI》大佬亲授智能体教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>(中英双语!)吴恩达最新《Agentic AI》大佬亲授智能体教程,附示例代码!_deeplearning.ai · 第 19 P「模块 4 · 1-评估(evals)」,15 分钟,讲怎么先建小评测集再一点点加,和今天先跑 5 个再放大的节奏一样。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/GL0XhAj5LPE" title="LLM Evals: Common Mistakes" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hamel Husain · LLM Evals: Common Mistakes · 评测里最常见的几个坑,对照今天的「常见误区」看,英文。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):评估方法的几章,讲什么时候用规则判分、什么时候用模型评审,以及评测集的代表性和样本量。

### 开源项目与代码

- [sierra-research/tau-bench](https://github.com/sierra-research/tau-bench):看每个任务结束后怎么比对数据库状态,以及并发跑任务和断点续跑的写法,40 分钟。
- [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo):开源的提示词和 Agent 回归测试工具,看 README 里「对比两个版本」的用法,30 分钟。

## 自测

1. 为什么「成功」用规则判定,不用模型评审?

<details><summary>答案</summary>

计费场景有精确答案:根因是哪一类、多收多少分钱、贷记单开在哪张发票上都能直接比对。用模型评审会把评审者自己的偏差混进分数,而且又慢又花钱。规则判分是确定性的,同一份结果判多少次都一样,判分器本身还能写测试。

</details>

2. 误冲正为什么要看「库里的贷记单」,不看结论里的 `expected_action`?

<details><summary>答案</summary>

Agent 嘴上说什么不重要,库里发生了什么才重要,这是按最终状态判分。结论里说「只解释」但库里多了一张贷记单,真实世界里钱已经出去了。被驳回的贷记单不算,因为它不会变成钱。

</details>

3. 判分器改松以后,12 条测试和自检一条都没红。这说明什么?怎么补?

<details><summary>答案</summary>

原来的测试只断言「某个标志等于 1」,没有断言「这个标志一出现,运行就必须判失败」。补一条测试,逐个标志检查:四项该对的任何一项为 0、四项不该有的任何一项为 1,`is_success` 都必须返回 0。标志名要在测试里重写,不从被测代码里 import,否则清单被改松时测试跟着松。

</details>

4. 评测脚本为什么每个任务用一个新进程,而不是线程?

<details><summary>答案</summary>

库路径和会话号是环境变量,整个进程共享,两个线程同时跑两个场景会互相改掉对方的库路径。进程各有各的环境变量和内存。`max_tasks_per_child=1` 再保证一个任务一个新进程,环境和内存不会带到下一个场景。

</details>

5. 子进程里认证失败,为什么主进程看到的是 `BrokenProcessPool`?怎么修?

<details><summary>答案</summary>

子进程里的异常要序列化才能传回主进程,openai 的异常类构造需要几个关键字参数,反序列化时重建不出来,进程池被整个标记成坏的,后面排队的任务全报同一个错。修法是在子进程里的入口函数捕获异常,变成普通字典(只放字符串),主进程拿到的就是「崩溃」那一行,而不是一个传不回来的异常对象。

</details>

6. 面试题:你的 Agent 评测一次要跑 40 分钟、花几十块,中间网络断了一次。你怎么设计才能不从头来,又保证结果可信?

<details><summary>答案</summary>

结果一行一条追加写、写一行 flush 一次;崩溃也写成一行带 `crashed` 的数据,续跑时已完成的跳过、崩溃的删掉重跑;每个任务在独立进程里、从冻结的库快照复制出的副本开始,任务之间不互相影响;快照先验干净,冻结后评测期间别人改库不影响;崩溃不进成功率的分母,但要单独报数量;报告带置信区间,样本不足时明说。另外每次花钱的命令先按小批量估算单价,再决定规模,超预算就跑分层抽样子集并写明跑了多少。

</details>

## 明天预告

明天是 Day 695 · BillSleuth(十四):先读再分桶再数,成功的运行也要读。今天的报告把 20 次运行分成了 15 个成功和 5 个失败,可是「为什么失败」我只是粗粗读了几眼,而且四项判断全对的情况下,成功的运行里有没有「对得很侥幸」的也没读。明天不再调模型,只读今天的 `runs/v1.jsonl`:先写一个脚本把失败按「修的时候改哪里」自动分桶,再每桶读几条原文,看规则分得对不对;再读几个成功的运行;最后数一数哪个桶最大,为后天动手改什么提供依据。今天留下的线索也一并带上:重复开票为什么 0/3、「记性不好」那一档为什么三次兜底。
