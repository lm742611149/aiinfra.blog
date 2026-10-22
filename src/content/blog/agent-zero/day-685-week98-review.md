---
title: 'Day 685 · 第 98 周复习:作品(Day 679–684)'
description: 'BillSleuth 的地基周复习:一张图串起 PRD、金额规则、十张表、参考引擎、故障注入、MCP 工具层和桥接;默写 money.py 和桥接的两个核心函数并用测试验收;小项目是一个不调模型的账单体检脚本,20 行规则在 100 个场景上和标准答案 100/100 一致,这个结果本身就是这周最重要的发现。'
pubDate: 2026-10-23
regime: none
tags: ['billsleuth', 'review', 'mcp', 'agent-zero']
series: 'agent-zero'
day: 685
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 684](/blog/agent-zero/day-684-bs-flow/) 讲了调查流程为什么拆成 intake、locate、investigate、conclude 四段,写了两个地基模块:`llm.py` 的 `get_llm()` 和 `estimate_cost()`(顺手实测开着思考做结构化输出会 400),`mcp_bridge.py` 的 `_run` 和 `BillingMCP`(实测 `asyncio.run` 在事件循环里会炸、stdio 每次调用 1.5 秒)。最后用桥接拼了一个不拆段的大循环,真跑三个场景,三个都查到了点子上,但结论是一段没法被程序比对的中文。

这一周(Day 679 到 684)一行 Agent 代码都还没写,全在打地基。今天停一下,把这六天串起来,默写最核心的两段,再用这周的零件做一个不调模型的小工具。这个小工具会告诉我们一件有点扎心的事。

## 今天要解决的问题

1. 不看文章,能画出 BillSleuth 从客户问题到工具层的数据流,说出每个文件是哪天建的、管什么。
2. 默写 `money.py` 的三个函数和 `mcp_bridge.py` 的 `_run`、`BillingMCP.call`,用现成的测试验收。
3. 只用这周的零件写一个不调模型的账单体检脚本,在 100 个场景上和标准答案对一遍,并能解释这个结果对后面的评测意味着什么。
4. 把这周的坑过一遍,能各说出一个真实报错或真实现象。

预计用时 3 到 4 小时。前置:Day 679 到 Day 684 全部做完,`billsleuth/` 仓库里有 `billing.db` 和 `scenarios/`。今天不调模型,花费 0 元。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把默写的两段再写一次;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 380" role="img" aria-label="第 98 周知识地图:PRD 定下 13 类根因和六个指标;money.py 和十张表是地基;参考引擎算应收;faults 和 seed 造出 100 个场景和标准答案;server.py 的 8 个工具读库并调引擎;llm.py 和 mcp_bridge.py 把模型和工具接到一起">
  <rect x="0" y="0" width="640" height="380" fill="var(--paper-raised)" rx="6"/>
  <defs><marker id="a685" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="16" y="16" width="608" height="40" rx="4" fill="none" stroke="var(--ink-soft)"/>
    <text x="30" y="34" fill="var(--ink)">679 PRD:13 类根因 · 先折扣后算税 · 多收开贷记单</text>
    <text x="30" y="50" fill="var(--ink-faint)">六个指标:根因准确率 差额匹配 数字幻觉 误冲正 pass^k 成本</text>
    <rect x="16" y="76" width="190" height="70" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="28" y="96" fill="var(--compute)">680 money.py</text>
    <text x="28" y="114" fill="var(--compute)">Decimal 只舍入一次</text>
    <text x="28" y="132" fill="var(--compute)">十张表 · 事件存 UTC</text>
    <rect x="226" y="76" width="190" height="70" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="238" y="96" fill="var(--compute)">681 engine.py</text>
    <text x="238" y="114" fill="var(--compute)">先开账再处理事件</text>
    <text x="238" y="132" fill="var(--compute)">expected_for_period</text>
    <rect x="436" y="76" width="188" height="70" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="448" y="96" fill="var(--compute)">682 faults + seed</text>
    <text x="448" y="114" fill="var(--compute)">改行项目再重新结账</text>
    <text x="448" y="132" fill="var(--compute)">100 场景 → scenarios/</text>
    <line x1="206" y1="111" x2="224" y2="111" stroke="var(--ink-soft)" marker-end="url(#a685)"/>
    <line x1="416" y1="111" x2="434" y2="111" stroke="var(--ink-soft)" marker-end="url(#a685)"/>
    <rect x="120" y="176" width="400" height="64" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="134" y="196" fill="var(--compute)">683 server.py:6 只读 + recompute + draft</text>
    <text x="134" y="214" fill="var(--compute)">repo.py 读回对象 · @audited · 金额全是字符串</text>
    <text x="134" y="232" fill="var(--compute)">可解性测试:100 个场景都算得出答案</text>
    <line x1="320" y1="146" x2="320" y2="174" stroke="var(--ink-soft)" marker-end="url(#a685)"/>
    <rect x="16" y="270" width="290" height="64" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="30" y="290" fill="var(--mem)">684 llm.py</text>
    <text x="30" y="308" fill="var(--mem)">get_llm · 关思考 · max_retries=5</text>
    <text x="30" y="326" fill="var(--mem)">estimate_cost 算上限</text>
    <rect x="334" y="270" width="290" height="64" rx="4" fill="none" stroke="var(--compute)"/>
    <text x="348" y="290" fill="var(--compute)">684 mcp_bridge.py</text>
    <text x="348" y="308" fill="var(--compute)">_run:有循环就换线程</text>
    <text x="348" y="326" fill="var(--compute)">call → (ok, data),拆 result</text>
    <line x1="420" y1="240" x2="460" y2="268" stroke="var(--ink-soft)" marker-end="url(#a685)"/>
    <line x1="306" y1="302" x2="332" y2="302" stroke="var(--ink-soft)" marker-end="url(#a685)"/>
    <text x="16" y="364" fill="var(--ink-faint)">标准答案 scenarios/ 只给评测和测试读,工具层碰不到</text>
  </g>
</svg>
<figcaption>琥珀色是数据和工具侧,蓝色是模型侧。上半部分(680–683)全是确定的代码,下半部分(684)是把模型接进来的两块地基。</figcaption>
</figure>

## 本周每天一句话

- [Day 679](/blog/agent-zero/day-679-bs-prd/):补了优惠券、税、贷记单三个名词(先折扣后算税,多收了开贷记单而不是改发票),把客户的抱怨整理成 13 类根因,小实验证明只听原话模型只能蒙;写了一页 PRD,用 `prd_check.py` 守住,定了六个验收指标。
- [Day 680](/blog/agent-zero/day-680-bs-engine-1/):金额只走 `money()`、`prorate()`、`fmt()` 三个函数,拒收 float,只在最后舍入一次;建了十张表,金额存 TEXT,事件时间存 UTC,订阅表是快照、事件表是事实。
- [Day 681](/blog/agent-zero/day-681-bs-engine-2/):参考计费引擎 `build_invoices` 一期一期往前走,先开本期的账,再处理本期里的事件,折算留给下一张;`expected_for_period` 回答「某一期应该是什么样」;规则测试的期望值全部手算。
- [Day 682](/blog/agent-zero/day-682-bs-faults/):12 个注入函数按真实 bug 的机制改行项目再重新结账;固定种子造 100 个场景(80 有错 20 没错),标准答案进 `scenarios/`;自检不信注入函数,拿引擎重算再用实付去减。
- [Day 683](/blog/agent-zero/day-683-bs-tools/):MCP 工具层 8 个工具,按查账动作切、金额全是字符串、报错告诉模型下一步、能在工具里算的别让模型算;`@audited` 失败也记;可解性测试证明 100 个场景都算得出答案。
- [Day 684](/blog/agent-zero/day-684-bs-flow/):流程拆四段的理由;`llm.py` 和 `mcp_bridge.py`;不拆段的大循环能查对,但结论没法被程序比对。

## 默写一:money.py

打开一个新文件 `scratch/recall_money.py`,不看文章,写出 `CENT`、`ZERO` 两个常量和 `money`、`prorate`、`fmt` 三个函数。写完和 `billsleuth/money.py` 对照。我自己默写时最容易漏的是两处:`money` 里拒收 float 的那个 `isinstance` 检查,和 `prorate` 里「整个分数算完才舍入一次」。

对照完以后,把你默写的版本整个覆盖到 `billsleuth/money.py`(先 `cp billsleuth/money.py scratch/money_backup.py` 备份),跑 Day 680 的测试:

```bash
cp billsleuth/money.py scratch/money_backup.py
uv run pytest tests/test_money.py -q
```

<div class="line-notes">

- `cp billsleuth/money.py scratch/money_backup.py` 先备份正确版本,默写错了好恢复。
- `uv run pytest tests/test_money.py -q` Day 680 的金额测试,专门放了 58.505、16.665 这种落在半分上的数,舍入方式写错一定红。

</div>

全绿才算默写过关。正确版本跑出来是:

```text
..........                                                               [100%]
10 passed in 0.12s
```

红了的话看是哪一条:半分那几条红,是 `ROUND_HALF_UP` 写成了别的(Python 默认的舍入是「逢五取偶」);`test_rejects_float` 之类的红,是漏了 float 检查。改对以后再跑一遍。

## 默写二:桥接的两个核心函数

这是 Day 684 学法提示里要求默写的两段。新开一个文件,写出 `_run` 和 `BillingMCP` 类(`__init__`、`tool_specs`、`call` 三个方法)以及 `to_text`。写的时候心里过一遍三个问题:外面已经有事件循环怎么办?stdio 子进程的环境变量从哪来?SDK 给列表包的那层什么时候拆?

写完覆盖 `billsleuth/mcp_bridge.py`(同样先备份),跑桥接测试:

```bash
cp billsleuth/mcp_bridge.py scratch/bridge_backup.py
uv run pytest tests/test_bridge.py -q
```

<div class="line-notes">

- `uv run pytest tests/test_bridge.py -q` Day 684 的 7 条桥接测试。

</div>

我故意默写了一个「偷懒版」来看测试能抓到什么:`_run` 只写一行 `return asyncio.run(coro)`,拆包条件写成 `"result" in data`。结果:

```text
>           raise RuntimeError(
E           RuntimeError: asyncio.run() cannot be called from a running event loop
FAILED tests/test_bridge.py::test_works_inside_running_loop - RuntimeError: a...
1 failed, 6 passed in 4.47s
```

`_run` 偷懒被 `test_works_inside_running_loop` 当场抓住。可拆包条件写松了,**没有任何一条测试红**。原因是现在 8 个工具里没有一个的返回结构带 `result` 字段,松的写法和严的写法在今天的数据上表现完全一样。这是测试的盲区,不是写松了就没问题。它提醒我们:默写的验收不能只看测试绿不绿,还要和原文逐行对一遍。恢复正确版本:`cp scratch/bridge_backup.py billsleuth/mcp_bridge.py`,再跑一遍,`7 passed`。

## 本周小项目:不用模型的账单体检

这周造了一个会算账的引擎、一套能复算的工具、一个能同步调工具的桥。只用这三样,不调模型,能做到什么程度?写一个脚本:给一个客户,把他的每张发票都复算一遍,按几条硬规则标出可疑的发票和多收金额,再拿 100 个场景的标准答案对一遍。

规则从 Day 683 的 `recompute_invoice` 返回结构里来,一共三条:同一周期有别的发票,且这张是后开的那张,算重复开票,多收整张;实际扣款合计比应收多,按 `should_exist` 和 `successful_payments` 细分成「不该开票」「重复扣款」「金额与应收不一致」;其余不报。

```python
# billsleuth/scripts/checkup.py  第 98 周小项目:不用模型的账单体检。每张发票都复算一遍,按规则标出可疑的地方
import json
import sys
from decimal import Decimal

from billsleuth.db import ROOT
from billsleuth.mcp_bridge import BillingMCP
from billsleuth.money import ZERO, fmt


def check_customer(mcp: BillingMCP, cid: str) -> list[dict]:
    """返回这个客户每张有问题的发票:发票号、多收金额、规则给的理由。"""
    ok, invs = mcp.call("list_invoices", {"customer_id": cid, "limit": 24})
    if not ok:
        return []
    flags = []
    for inv in invs:
        ok, r = mcp.call("recompute_invoice", {"invoice_id": inv["id"]})
        if not ok:
            continue
        paid, expected = Decimal(r["paid_total"]), Decimal(r["expected_total"])
        if r["other_invoices_same_period"] and inv["id"].endswith("D"):
            flags.append({"invoice": inv["id"], "over": fmt(Decimal(r["actual_total"])), "why": "同周期重复开票"})
        elif paid - expected > ZERO:
            why = "不该开票" if not r["should_exist"] else (
                "重复扣款" if r["successful_payments"] > 1 else "金额与应收不一致")
            flags.append({"invoice": inv["id"], "over": fmt(paid - expected), "why": why})
    return flags


if __name__ == "__main__":
    mcp = BillingMCP(in_process=True)
    ids = sys.argv[1:] or [f"S{i:03d}" for i in range(1, 101)]
    hit = 0
    for sid in ids:
        sc = json.loads((ROOT / "scenarios" / f"{sid}.json").read_text(encoding="utf-8"))
        truth = sc["truth"]
        flags = check_customer(mcp, sc["customer_id"])
        found = [(f["invoice"], f["over"]) for f in flags]
        want = [(i, truth["overcharge"]) for i in truth["invoice_ids"]] if truth["overcharge"] != "0.00" else []
        ok = found == want
        hit += ok
        if len(ids) <= 5 or not ok:
            print(f"{sid} {truth['root_cause']:<24} 规则:{flags}  {'✓' if ok else '✗ 标准答案 ' + str(want)}")
    print(f"{hit}/{len(ids)} 和标准答案完全一致")
```

<div class="line-notes">

- `from billsleuth.mcp_bridge import BillingMCP` Day 684 的桥接,同步地调工具。
- `from billsleuth.money import ZERO, fmt` Day 680 的金额规则,比较和输出都走它。
- `def check_customer(mcp: BillingMCP, cid: str) -> list[dict]:` 体检一个客户。不需要知道客户在抱怨什么,所有发票都查。
- `ok, invs = mcp.call("list_invoices", {"customer_id": cid, "limit": 24})` 最多 24 张,一个客户的全部发票。拆包是桥接做的,`invs` 直接是列表。
- `ok, r = mcp.call("recompute_invoice", {"invoice_id": inv["id"]})` 每张都复算。一个客户五六张发票,内存连接每次十几毫秒。
- `paid, expected = Decimal(r["paid_total"]), Decimal(r["expected_total"])` 工具返回的是字符串,这里变回 Decimal 才能比较大小。字符串 `"9.00" > "10.00"` 是 True,Day 680 讲过的坑。
- `if r["other_invoices_same_period"] and inv["id"].endswith("D"):` 规则一:重复开票。两张都和应收一致,difference 都是 0,只能靠「同周期还有别的发票」认出来。`endswith("D")` 用的是 Day 682 造数时给重复发票加的后缀,**这是作弊**,练习 1 改掉它。
- `flags.append({"invoice": inv["id"], "over": fmt(Decimal(r["actual_total"])), "why": "同周期重复开票"})` 多开的那张整张都是多收。
- `elif paid - expected > ZERO:` 规则二:扣的比该收的多。用 `paid_total` 而不是 `actual_total`,重复扣款时发票本身没错,多出来的在扣款上(Day 683 练习 1)。
- `why = "不该开票" if not r["should_exist"] else (` 再细分理由。Python 的条件表达式 `A if 条件 else B` 相当于 JS 的 `条件 ? A : B`,这里嵌了两层。
- `"重复扣款" if r["successful_payments"] > 1 else "金额与应收不一致")` 成功扣了两笔以上就是重复扣款,否则是金额本身算错了(折算、税、券、单价都归这一类)。
- `ids = sys.argv[1:] or [f"S{i:03d}" for i in range(1, 101)]` 命令行给了场景号就只跑那几个,没给就跑全部 100 个。`{i:03d}` 补零到三位,`S001`。
- `want = [(i, truth["overcharge"]) for i in truth["invoice_ids"]] if truth["overcharge"] != "0.00" else []` 标准答案换成同样的形状:有错的场景是「发票号 + 多收金额」的列表,账没错的场景应该什么都不报。
- `ok = found == want` 列表逐项比较,顺序、发票号、金额都要一样才算对。
- `hit += ok` 布尔值加到整数上,True 算 1,和 JS 一样。
- `if len(ids) <= 5 or not ok:` 场景少时全打印,跑全量时只打印不一致的。

</div>

先跑四个,三类特殊的加一个没错的:

```bash
uv run python scripts/checkup.py S011 S017 S023 S003
```

```text
Traceback (most recent call last):
  File "/Users/你/billsleuth/scripts/checkup.py", line 6, in <module>
    from billsleuth.db import ROOT
ModuleNotFoundError: No module named 'billsleuth'
```

Day 680 就踩过的坑又来了:用文件路径运行时,Python 只把 `scripts/` 加进模块搜索路径,找不到 `billsleuth` 包。在仓库根目录用 `-m`:

```bash
uv run python -m scripts.checkup S011 S017 S023 S003
```

```text
S011 timezone_change_date     规则:[{'invoice': 'INV-0011-03', 'over': '26.02', 'why': '金额与应收不一致'}]  ✓
S017 duplicate_charge         规则:[{'invoice': 'INV-0017-05', 'over': '123.60', 'why': '重复扣款'}]  ✓
S023 duplicate_invoice        规则:[{'invoice': 'INV-0023-04D', 'over': '139.05', 'why': '同周期重复开票'}]  ✓
S003 no_error                 规则:[]  ✓
4/4 和标准答案完全一致
```

四个全对。跑全量:

```bash
uv run python -m billsleuth.seed
time uv run python -m scripts.checkup
```

<div class="line-notes">

- `uv run python -m billsleuth.seed` 先重置库。体检会调很多次工具,每次都写审计日志,跑之前重置一下,库保持干净。
- `time uv run python -m scripts.checkup` 命令前加 `time`,结束时打印用了多久,[Day 4](/blog/agent-zero/day-004-terminal-2/) 前后用过。

</div>

```text
100/100 和标准答案完全一致
uv run python -m scripts.checkup  26.68s user 1.86s system 69% cpu 41.273 total
```

**100 个场景,发票号和多收金额全部和标准答案一致**,40 秒,0 元,没有调一次模型。

### 这个结果意味着什么

我第一次看到 100/100 时有点愣。我们花了一周搭的是一个让 Agent 来调查的系统,结果二十行规则就把「哪张发票多收了多少」全找出来了。

冷静下来想,这不奇怪。Day 682 的「这份数据集的局限」和 Day 683 第五步都写过:复算工具把差额直接算好了,题目偏简单。今天只是把这句话变成了一个数。它带来三个后果。

第一,**「差额精确匹配率」这个指标在这份数据集上没有区分度**。Day 679 定的六个指标里,它的起点目标是 85%。一个不调模型的脚本就是 100%,Agent 做到 85% 不值得高兴,做不到 100% 才说明它在什么地方把事情搞复杂了。这个脚本以后就是 Day 693 评测时的**规则基线**:Agent 在这个指标上至少要追平它。

第二,**Agent 真正要做的,是规则做不了的部分**。看 S011 那一行,规则给的理由是「金额与应收不一致」,而标准答案的根因是 `timezone_change_date`。从「金额不一致」到「是时区让改套餐日期早了一天」,要去看时间线、对比本地日期和折算行日期,这是判断;再往后,还要把它讲成客户听得懂的话、决定要不要起草贷记单。13 类根因里,规则能直接认出的只有重复扣款、重复开票、取消后仍开票三类,剩下十类都被它归成了一句「金额与应收不一致」。根因准确率、数字幻觉率、误冲正率,这三个指标才是 Agent 要拿分的地方。

第三,**数据集要变难**。真实世界里不会有一个完美的复算工具,参考引擎本身也可能有 bug,客户说的金额可能是错的,一张发票可能同时有两个问题。Day 693 会正面处理这件事。

做作品的时候,这种「先写一个笨基线」的习惯很值钱。面试官问「你的 Agent 比规则强在哪」,你手里有一个数。

## 本周错题与坑清单

| 坑 | 真实现象 | 哪天 |
| --- | --- | --- |
| 只听客户原话判断根因 | 三句一样的话对应三个不同根因,模型只能蒙 | 679 |
| 误冲正率的分母用全部场景 | 1/15 看着还行,1/6 才是真实危险程度 | 679 |
| TEXT 列用 SQL 的 `SUM` | SQLite 先转浮点再加,得到 0.30000000000000004 | 680 |
| 每一步都舍入到分 | 39 美元折算 10 天,先算日价得 12.60,只舍入一次得 12.58 | 680 |
| 事务里才开外键检查 | 不报错,也不生效 | 680 |
| 先处理事件再开账 | 6 月那张从 124.02 变成 362.52,四条测试变红 | 681 |
| 先 `.date()` 再换时区 | 上海凌晨的升级多折算一天 | 681 |
| dataclass 里写 `lines: list = []` | `ValueError: mutable default ... use default_factory` | 681 |
| 先扣款再注入 | 客户实付等于正确金额,80 个场景全部失败 | 682 |
| 分母写死 30 的故障放进 30 天的周期 | 差额是 0,根本不是争议 | 682 |
| 装饰器顺序写反 | SDK 注册的是没审计的函数,审计表永远是空的 | 683 |
| Inspector CLI 里用 `python -m` | `-m` 被吞,子进程变成交互解释器,15 秒超时 | 683 |
| 金额参数收数字 | Inspector CLI 把 26.02 当 float 发过来,被 schema 拒绝 | 683 |
| 以为审计日志记下了所有调用 | schema 校验失败的那次到不了函数,审计表里没有 | 683 |
| 开着思考做结构化输出 | `Thinking mode does not support this tool_choice`,400 | 684 |
| 事件循环里直接 `asyncio.run` | `asyncio.run() cannot be called from a running event loop` | 684 |
| 评测用 stdio 连 MCP | 每次调用 1572 毫秒,内存连接 15 毫秒 | 684 |
| 用文件路径跑包里的脚本 | `ModuleNotFoundError: No module named 'billsleuth'` | 680、今天 |

如果只能记三条,我选:**存用 TEXT、算用 Decimal、最后舍入一次**;**先注入再扣款,自检不信注入函数**;**能在工具里算的别让模型算**。这三条决定了后面所有分数可不可信。

## 动手练习

**练习 1:不靠 D 后缀认重复开票。** 小项目的规则一用了 `endswith("D")`,这是知道造数细节才写得出的作弊。先把这个条件删掉跑一遍全量,看会发生什么;再想一个不靠后缀的办法,存成 `scratch/ex1_checkup_first.py`。

<details><summary>参考答案</summary>

复制 `scripts/checkup.py` 为 `scratch/ex1_noD.py`,只删 `and inv["id"].endswith("D")`,跑全量 `uv run python -m scratch.ex1_noD`,最后几行:

```text
S048 duplicate_invoice        规则:[{'invoice': 'INV-0048-05D', 'over': '71.40', 'why': '同周期重复开票'}, {'invoice': 'INV-0048-05', 'over': '71.40', 'why': '同周期重复开票'}]  ✗ 标准答案 [('INV-0048-05D', '71.40')]
S064 duplicate_invoice        规则:[{'invoice': 'INV-0064-04D', 'over': '163.50', 'why': '同周期重复开票'}, {'invoice': 'INV-0064-04', 'over': '163.50', 'why': '同周期重复开票'}]  ✗ 标准答案 [('INV-0064-04D', '163.50')]
S065 duplicate_invoice        规则:[{'invoice': 'INV-0065-03D', 'over': '180.20', 'why': '同周期重复开票'}, {'invoice': 'INV-0065-03', 'over': '180.20', 'why': '同周期重复开票'}]  ✗ 标准答案 [('INV-0065-03D', '180.20')]
S076 duplicate_invoice        规则:[{'invoice': 'INV-0076-04D', 'over': '139.23', 'why': '同周期重复开票'}, {'invoice': 'INV-0076-04', 'over': '139.23', 'why': '同周期重复开票'}]  ✗ 标准答案 [('INV-0076-04D', '139.23')]
S088 duplicate_invoice        规则:[{'invoice': 'INV-0088-05D', 'over': '281.19', 'why': '同周期重复开票'}, {'invoice': 'INV-0088-05', 'over': '281.19', 'why': '同周期重复开票'}]  ✗ 标准答案 [('INV-0088-05D', '281.19')]
93/100 和标准答案完全一致
```

(上面是最后 5 行,前面还有 S023、S047 两行一样的失败,一共 7 个重复开票场景全错。)两张发票都被标了,多收金额算了两遍。客户只多付了一张的钱,却要冲正两张,这就是误冲正。

两张一模一样的发票,哪张是多出来的?会计上的习惯是「先开的那张是原件」。真实系统里看创建时间,我们的库里两张的 `issued_at` 一样,只能退一步看编号:同一周期里编号最小的算原件,比它大的才算重复。把条件改成:

```python
        if r["other_invoices_same_period"] and inv["id"] > min(r["other_invoices_same_period"]):
```

<div class="line-notes">

- `inv["id"] > min(r["other_invoices_same_period"])` `other_invoices_same_period` 是同周期**其他**发票的号。当前这张比其他里最小的那张还大,说明它不是最早的,算重复。字符串比较:`"INV-0048-05" < "INV-0048-05D"`,短的那个是长的前缀时短的更小。

</div>

```bash
uv run python -m scratch.ex1_checkup_first
```

```text
100/100 和标准答案完全一致
```

又回到 100/100,而且不再依赖 `D` 这个造数细节。不过它依赖「编号按创建顺序递增」,这在真实系统里不一定成立,所以 Day 683 的复算工具只说「可能重复开票」,不替你决定哪张是多的。我把这个版本存成了 `scratch/ex1_checkup_first.py`。

</details>

**练习 2:把重复的 fixture 挪进 conftest.py。** Day 683 的 `test_server.py` 和 Day 684 的 `test_bridge.py` 开头有一模一样的 `master_db` 和 `fresh_db` 两个 fixture。把它们挪到 `tests/conftest.py`,两个测试文件里删掉,全部测试仍然要绿。[Day 73](/blog/agent-zero/day-073-pytest-3/) 讲过 conftest。

<details><summary>参考答案</summary>

```python
# billsleuth/tests/conftest.py  练习 2:两份测试文件里一模一样的造库 fixture 挪到这里,所有测试文件自动可用
import shutil

import pytest

from billsleuth import seed


@pytest.fixture(scope="session")
def master_db(tmp_path_factory):
    path = tmp_path_factory.mktemp("db") / "master.db"
    mp = pytest.MonkeyPatch()
    mp.setenv("BILLSLEUTH_DB", str(path))
    seed.main()
    mp.undo()
    return path


@pytest.fixture
def fresh_db(master_db, tmp_path, monkeypatch):
    path = tmp_path / "billing.db"
    shutil.copy(master_db, path)
    monkeypatch.setenv("BILLSLEUTH_DB", str(path))
    return path
```

<div class="line-notes">

- `# billsleuth/tests/conftest.py` 文件名必须是 `conftest.py`,pytest 会自动加载它,里面的 fixture 对同目录及子目录的所有测试文件可见,不用 import。
- `@pytest.fixture(scope="session")` 从 `module` 改成了 `session`:整个测试会话只造一次库,两个文件共用。原来每个文件各造一次。
- `@pytest.fixture` `fresh_db` 去掉了 `autouse=True`。放在 conftest 里还 autouse 的话,`test_money.py` 这种纯函数测试也会去造库、复制库,白白变慢。

</div>

两个测试文件里,把那两个 fixture 换成一个 3 行的「本文件自动使用」开关,`test_bridge.py` 开头变成:

```python
# billsleuth/tests/test_bridge.py  桥接测试:工具清单的格式、列表拆包、报错变文字、在事件循环里也能调、stdio 也通
import asyncio

import pytest

from billsleuth.mcp_bridge import BillingMCP, to_text


@pytest.fixture(autouse=True)
def _use_fresh_db(fresh_db):
    """本文件每条测试都用一份干净的库(fixture 定义在 conftest.py)。"""
```

<div class="line-notes">

- `import asyncio` 原来的 `import shutil` 和 `from billsleuth import seed` 删掉了,它们挪去了 conftest。
- `def _use_fresh_db(fresh_db):` 一个什么都不做的 fixture,只是「依赖」`fresh_db`。它是 autouse 的,所以本文件每条测试都会先拿到一份干净的库。下划线开头表示别的地方不该直接用它。

</div>

`test_server.py` 同样处理(它的 `SCENARIOS` 还要用 `seed.SCENARIO_DIR`,所以 `from billsleuth import seed` 留着,只删 `import shutil`)。

```bash
uv run pytest -q
uv run basedpyright tests
```

```text
237 passed in 11.31s
0 errors, 0 warnings, 0 notes
```

条数没变,时间差不多。后天写调查图的测试时,直接用 conftest 里的 `fresh_db`,不用再抄一遍。

</details>

**练习 3:体检报告加一列「差在哪一类」。** 规则把十类根因都归成了「金额与应收不一致」。用复算结果里的 `by_kind`,把这一类的理由细化成「差在 proration」「差在 tax」这样,跑 S011、S020、S031 三个场景,对照标准答案的根因,说说规则还差什么。

<details><summary>参考答案</summary>

复制 `scripts/checkup.py` 为 `scratch/ex3_checkup_kind.py`,只改 `why` 那两行:

```python
            if not r["should_exist"]:
                why = "不该开票"
            elif r["successful_payments"] > 1:
                why = "重复扣款"
            else:
                diffs = [d["kind"] for d in r["by_kind"] if Decimal(d["difference"]) != ZERO]
                why = "差在 " + "+".join(diffs)
```

<div class="line-notes">

- `diffs = [d["kind"] for d in r["by_kind"] if Decimal(d["difference"]) != ZERO]` 只留差额不为 0 的类别。字符串 `"0.00"` 先变 Decimal 再比较,不要拿字符串和 `"0"` 比。
- `why = "差在 " + "+".join(diffs)` 好几类都有差就用加号连起来,比如 `proration+tax`。

</div>

```bash
uv run python -m scratch.ex3_checkup_kind S011 S020 S031
```

```text
S011 timezone_change_date     规则:[{'invoice': 'INV-0011-03', 'over': '26.02', 'why': '差在 proration+tax'}]  ✓
S020 coupon_wrong_base        规则:[{'invoice': 'INV-0020-03', 'over': '13.29', 'why': '差在 discount+tax'}]  ✓
S031 wrong_tax_region         规则:[{'invoice': 'INV-0031-05', 'over': '19.20', 'why': '差在 tax'}]  ✓
3/3 和标准答案完全一致
```

S020 的标准答案是「百分比券只按订阅费那一行算」,差在折扣,税跟着差;S031 是「客户在 US,发票用了 DE-VAT19」,只差在税。

细化以后能看出「差在哪」,但还是到不了根因:`proration+tax` 可能是时区算错日期,也可能是分母写死 30、漏了退还行;`tax` 可能是过期税率,也可能是别的地区的税率。要分清,得去看时间线、看税率历史,这正是 investigate 那一段要模型做的事。规则把调查范围缩小了,但下不了结论。

</details>

**验收标准:** 两段默写覆盖原文件后测试全绿(`test_money.py` 10 条、`test_bridge.py` 7 条);`scripts/checkup.py` 全量跑出 100/100,并能解释为什么这个结果说明「差额精确匹配率」没有区分度;练习 1 去掉 D 后缀后仍是 100/100;练习 2 挪完 fixture 后 `uv run pytest -q` 全绿;不看表格能说出本周至少 8 个坑和它们的真实现象。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 规则基线 | 不用模型、只用确定规则做同一件事的程序,用来给 Agent 的分数定一个下限,例子:`checkup.py` 在差额匹配上 100/100 |
| 区分度 | 一个指标能不能把好系统和差系统分开;人人都满分的指标没有区分度 |
| 默写验收 | 合上文章重写核心代码,再用原来的测试检查;测试绿只说明「测到的地方对」,还要逐行对照 |
| 测试盲区 | 代码写错了但没有任何测试会红的地方,例子:拆包条件写成 `"result" in data` |
| conftest.py | pytest 自动加载的文件,里面的 fixture 对同目录所有测试可见,不用 import |
| `scope="session"` | fixture 在整个测试会话里只执行一次,多个测试文件共用 |
| 原件 / 重复件 | 同一周期两张发票里先开的那张和多开的那张;真实系统靠创建时间区分 |

## 常见误区

**规则基线满分,说明 Agent 没必要。** 规则只找得到「哪张多收了多少」,13 类根因里只认得出 3 类,也写不了解释、不会决定要不要冲正。满分说明这个指标太容易,不说明 Agent 没用。

**测试全绿就说明默写对了。** 实测把拆包条件写松,7 条桥接测试一条都不红。默写完要和原文逐行对。

**用造数时的命名规律写规则。** `endswith("D")` 能拿满分,但它知道的是答案的形状,不是账的规律。去掉以后实测掉到 93/100。

**复习日跳过不做。** 这周的东西是后面 17 天所有分数的地基。今天的 100/100 就是复习时才发现的,不复习,Day 693 才会知道「差额匹配」这个指标早就没有区分度了。

**fixture 挪进 conftest 时顺手加 autouse。** 纯函数的测试也会去造库、复制库,白白变慢。只在需要的文件里用一个 autouse 的小开关引用它。

## 学习资料

### 文档与文章

- [Anthropic · Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents):重读「返回有意义的上下文」一节,对照今天的发现:工具返回得越好,评测越容易,需要你主动让题目变难,20 分钟。
- [Anthropic · Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):开头那句「先找最简单的方案,只在需要时才增加复杂度」,今天的规则基线就是最简单的方案,10 分钟。
- [τ-bench 论文](https://arxiv.org/abs/2406.12045):看它怎么定义任务成功、怎么报 pass^k,Day 693 的评测会参考,30 分钟。
- [Python 文档 · decimal](https://docs.python.org/zh-cn/3.12/library/decimal.html):默写 `money.py` 前翻一下 `quantize` 和舍入方式那几节,中文,15 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1vu4y1j79r&autoplay=0&high_quality=1" title="Python单元测试-09.PyTest fixture基础" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>跟峰哥学编程 · Python单元测试-09.PyTest fixture基础 · 14 分钟,讲 fixture 的作用域和 conftest,做练习 2 之前看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1UQnP61E3S&autoplay=0&high_quality=1" title="大模型里的浮点数(1)0.1+0.2为什么不等于0.3?为什么模型参数全都是近似值?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>作者武辰 · 大模型里的浮点数(1)0.1+0.2为什么不等于0.3?为什么模型参数全都是近似值? · 11 分钟,把 Day 680 那个 0.30000000000000004 的来历讲清楚,默写 money.py 之前看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1HVFLzfEeS&autoplay=0&high_quality=1" title="挑战19分钟搞定,LangGraph快速入门与原理剖析" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>敲代码的码农 · 挑战19分钟搞定,LangGraph快速入门与原理剖析 · 19 分钟,明天开始写调查图,LangGraph 的 State、节点、条件边忘了的先看这个。</figcaption>
</figure>

### 其他经典视频

今天这组不需要。Day 684 推荐的 Barry Zhang 那场演讲没看的话,今天补上。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 4 章讲评测方法,其中「先建一个简单基线再比较」的建议,和今天的规则基线是一回事。
- Martin Kleppmann《Designing Data-Intensive Applications》(O'Reilly, 2017;中国电力出版社中译本《数据密集型应用系统设计》):第 2 章讲数据模型,对照「订阅表是快照、事件表是事实」读。

### 开源项目与代码

- [sierra-research/tau-bench](https://github.com/sierra-research/tau-bench):看它的任务定义和判分,想想它的「规则基线」会是什么样。
- [modelcontextprotocol/python-sdk](https://github.com/modelcontextprotocol/python-sdk):默写桥接时对不上的地方,去看 `Client.call_tool` 的返回类型。

## 自测

1. 从客户问题到 `billing.db`,BillSleuth 中间经过哪几层?每层是哪天写的?

<details><summary>答案</summary>

客户问题 → 调查流程(Day 686 起写,Day 684 定了拆成 intake、locate、investigate、conclude 四段)→ 模型侧用 `llm.py` 拿模型、工具侧用 `mcp_bridge.py` 同步调 MCP(Day 684)→ MCP server 的 8 个工具,经 `@audited` 记审计(Day 683)→ `repo.py` 把库里的行读回对象,交给参考引擎复算(Day 683、681)→ `billing.db` 十张表(Day 680),数据由 `faults.py` 和 `seed.py` 造(Day 682)。标准答案 `scenarios/` 只给测试和评测读,工具层碰不到。

</details>

2. 为什么 `money()` 要在运行时拒收 float,有了类型标注还不够?

<details><summary>答案</summary>

类型标注只在编辑器和类型检查器里起作用,运行时不检查。从 JSON 读出来的小数、从别的库拿来的数,运行时就是 float,照样能传进来。一旦 float 进了 Decimal,0.1 就变成 0.1000000000000000055511151231257827……,误差带进了账里。运行时检查是第二道闸。

</details>

3. 不调模型的体检脚本 100/100,对 Day 693 的评测有什么影响?

<details><summary>答案</summary>

一是「差额精确匹配率」在这份数据集上没有区分度,规则就能满分,Agent 在这个指标上至少要追平规则,做不到说明它把事情搞复杂了;脚本可以当规则基线写进评测报告。二是 Agent 的价值要看规则做不了的指标:根因准确率(规则只认得出 3 类)、数字幻觉率、误冲正率,以及给客户的解释。三是数据集偏简单,需要更难的场景,比如复算工具不完美、一张发票有两个问题。

</details>

4. 默写 `_run` 时只写 `return asyncio.run(coro)`,哪条测试会红?为什么?

<details><summary>答案</summary>

`test_works_inside_running_loop`。它在一个 async 函数里调 `bridge.call`,这时当前线程已经有一个事件循环在跑,`asyncio.run` 不能再新建一个,抛 `RuntimeError: asyncio.run() cannot be called from a running event loop`。正确的 `_run` 先用 `get_running_loop` 判断,有循环就换到新线程里跑。

</details>

5. 面试题:「你怎么知道你的 Agent 比一个简单的规则系统强?」

<details><summary>答案</summary>

我在 BillSleuth 里专门写过一个不调模型的规则基线:每张发票都用参考引擎复算,按「扣款比应收多」「同周期有别的发票」「本不该开票」三条规则标出问题。它在 100 个场景上「哪张发票多收了多少」和标准答案 100/100 一致,40 秒、0 元。这让我意识到两件事:一是差额匹配这个指标在我的数据集上没有区分度,Agent 只能追平不能超越;二是 Agent 的价值在规则做不到的地方,13 类根因里规则只认得出 3 类,其余十类它只能说「金额不一致」,而 Agent 要通过查时间线、税率历史给出根因,还要写出客户能看懂、每个数字都有出处的解释。所以我的评测报告里每个指标旁边都放了规则基线的分数,Agent 在根因准确率上比规则高多少,才是它的价值。同时我也承认数据集偏简单,后来加了更难的场景。

</details>

## 明天预告

明天是 Day 686 · BillSleuth(六):证据链由代码抽取,调查图。地基打完了,开始写调查本身:先写证据抽取模块,把每次工具结果里的金额、日期、税率自动编号成 E1、E2……,模型抄数字会抄错,代码不会;再把 Day 684 定下的四段拼成一张 LangGraph 图,编译出来看看它长什么样。今天的体检脚本说明了「找到多收多少」不难,明天的证据链是为了让后面写给客户的每个数字都有出处。
