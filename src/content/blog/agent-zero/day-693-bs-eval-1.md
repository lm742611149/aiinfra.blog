---
title: 'Day 693 · BillSleuth(十二):100 个场景和模拟客户'
description: '到 Day 692 为止,BillSleuth 的好坏只有 16 个手挑场景的「全对」。今天把评测集立起来:先数清 100 个场景手里有什么(只有 11 种问法,两个场景的标准答案比发票本身还大),再把场景拆成客户看得到和只给判分器看的两半,最后写一个会着急、会记错、会追问的模拟客户。实测四种人设、故意泄露标准答案的后果(48 条里 10 条把根因说漏了),以及追问怎么才会真的发生。'
pubDate: 2026-10-27
regime: none
tags: ['billsleuth', 'evaluation', 'user-simulation', 'agent-zero']
series: 'agent-zero'
day: 693
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 692](/blog/agent-zero/day-692-week99-review/) 是第 99 周的复习日。六天的代码串成了一次调查从头到尾:证据链、调查图、两份解释加溯源校验、重写循环、三种处理的状态机、幂等键和审批暂停。我们还写了一个不信流程代码、只看库里结果的体检脚本,故意做 7 种破坏,抓到 6 种。测试到 348 条,全绿。

可是「它到底好不好用」我们还没有答案。[Day 687](/blog/agent-zero/day-687-bs-run/) 手挑 16 个场景、每类根因一个,16/16 命中,当时就说过这不说明什么:样本是挑的,每个只跑一次,客户的话是造数脚本写死的模板,而且 S023 发票号写了两张算不算对,口径一直没定。今天开始搭评测。下周的重点会放在「跑起来看数字」,今天先把评测的两个原料准备好:**评测集**(100 个场景,谁能看什么)和**模拟客户**(代替写死的原话)。

## 今天要解决的问题

学完今天你应该能:

1. 用脚本数清楚一份评测集的家底:根因分布、客户的问法有几种、标准答案和库对不对得上,并读出这份数据集的毛病(今天会找到两个标准答案兑现不了的场景)。
2. 把场景文件拆成「客户看得到的」和「标准答案」两半,用白名单而不是黑名单,并写测试保证新加的字段默认看不见。
3. 写出模拟客户:四种人设、会记错月份和金额、能根据客服的回复决定追问还是结束;并用实验说清楚它的三个毛病(措辞变了但也会系统性地偏、泄露标准答案会毁掉评测、诉求写松了就一次追问都不会发生)。
4. 算清楚一次模型调用花多少钱,并用计数器统计一段代码里所有模型调用的 token(包括线程里的)。

今天有两个新概念:**评测集**和**模拟客户**。置信区间、pass^k 这些统计工具后天跑完才用得上,今天只数数。[Day 344](/blog/agent-zero/day-344-eval-concepts/) 讲过 pass^k,[Day 354](/blog/agent-zero/day-354-testset-size/) 讲过测试集要多大、开发集和留出集怎么分,[Day 362](/blog/agent-zero/day-362-simulated-user/) 在 SupportPilot 上第一次写过模拟客户,今天把它搬到 BillSleuth,并且把当时没处理的几个毛病处理掉。

预计用时 3 小时。前置:[Day 682](/blog/agent-zero/day-682-bs-faults/)(造数:`seed.py` 和 `scenarios/S001.json` 到 `S100.json`)、[Day 686](/blog/agent-zero/day-686-bs-evidence/)(`graph.py` 里的 `Intake`、`pick_candidates`)、[Day 687](/blog/agent-zero/day-687-bs-run/)(`run.py`)。今天调真模型的部分全部用 `deepseek-flash`,合计约 ¥0.16,算式在「今天的文件」一节。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `scenarios.py` 和 `customer.py` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先数一数手里有什么

评测集不是「一堆题」,是一份你要为它负责的数据。拿到手第一件事是数一遍。Day 682 已经造好了 100 个场景,每个场景是 `scenarios/` 目录下一个 JSON。随便翻一个:

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

`question` 是客户说得出来的话,`truth` 是标准答案。后者里最危险的是 `detail`:它直接写着根因。写一个脚本把全部 100 个数一遍,顺便把标准答案拿去和 Day 682 造的库对账。

```python
# billsleuth/scripts/eval_set_stats.py  数一数评测集:分布、问法有几种、标准答案在库里对不对得上
import re
from collections import Counter

from billsleuth.db import connect
from billsleuth.evals.scenarios import load_all, truth, visible

scs = load_all()
print(f"场景 {len(scs)} 个,客户 {len({s['customer_id'] for s in scs})} 个")

causes = Counter(truth(s)["root_cause"] for s in scs)
print("根因分布:", dict(sorted(causes.items(), key=lambda kv: -kv[1])))
print("动作分布:", dict(Counter(truth(s)["expected_action"] for s in scs)))
print("账没错的四种:", dict(Counter(truth(s)["variant"] for s in scs if truth(s)["root_cause"] == "no_error")))

# 问法有几种:把数字换成 N 再数
shapes = Counter(re.sub(r"\d+(\.\d+)?", "N", visible(s)["question"]) for s in scs)
print(f"\n不同的问法 {len(shapes)} 种,最常见的三种占 {sum(n for _, n in shapes.most_common(3))} 个场景")
for text, n in shapes.most_common(3):
    print(f"  {n:2d} 个  {text}")

# 标准答案对不对得上库:发票存在、属于这个客户、金额不超过发票总额
conn = connect()
bad = []
for s in scs:
    t = truth(s)
    for inv_id in t["invoice_ids"]:
        row = conn.execute("SELECT customer_id, total FROM invoices WHERE id = ?", (inv_id,)).fetchone()
        if row is None or row["customer_id"] != s["customer_id"]:
            bad.append(f"{s['id']}: 发票 {inv_id} 不存在或不属于 {s['customer_id']}")
        elif t["expected_action"] == "credit_note" and float(t["overcharge"]) > float(row["total"]):
            bad.append(f"{s['id']}: 多收 {t['overcharge']} 超过发票总额 {row['total']}")
print("\n标准答案和库对账:", "全部对得上" if not bad else "\n  ".join(bad))
```

<div class="line-notes">

- `scs = load_all()` 这是 `billsleuth/evals/scenarios.py` 里的函数(下一节写),一次读进 100 个场景字典。
- `causes = Counter(truth(s)["root_cause"] for s in scs)` 按根因计数。`Counter` 相当于 JS 里手写一个 `{}` 然后 `counts[k] = (counts[k] ?? 0) + 1`。
- `shapes = Counter(re.sub(r"\d+(\.\d+)?", "N", visible(s)["question"]) for s in scs)` 把句子里所有数字换成 `N` 再数。`S001` 的「9 月」「174.90」变成「N 月」「N」,金额不同、月份不同的句子就合并成同一种问法。
- `for text, n in shapes.most_common(3):` 取出现次数最多的三种问法。
- `row = conn.execute("SELECT customer_id, total FROM invoices WHERE id = ?", (inv_id,)).fetchone()` 去库里找标准答案指的那张发票;`?` 是占位符,值放在后面的元组里。
- `if row is None or row["customer_id"] != s["customer_id"]:` 发票不存在,或者属于别的客户,都是标准答案写错了。
- `elif t["expected_action"] == "credit_note" and float(t["overcharge"]) > float(row["total"]):` 该冲正的场景里,多收的钱不能比这张发票本身还多。这一条是今天加的,下面解释为什么。

</div>

```bash
cd /Users/你/billsleuth
uv run python -m scripts.eval_set_stats
```

```text
场景 100 个,客户 100 个
根因分布: {'no_error': 20, 'proration_missing_credit': 7, 'coupon_not_applied': 7, 'proration_wrong_days': 7, 'duplicate_charge': 7, 'expired_tax_rate': 7, 'coupon_wrong_base': 7, 'duplicate_invoice': 7, 'wrong_tax_region': 7, 'cancel_not_respected': 6, 'timezone_change_date': 6, 'quantity_change_ignored': 6, 'wrong_plan_price': 6}
动作分布: {'credit_note': 80, 'explain_only': 20}
账没错的四种: {'annual_renewal': 5, 'upgrade_proration': 5, 'tax_line': 5, 'coupon_ended': 5}

不同的问法 11 种,最常见的三种占 63 个场景
  28 个  N 月这张发票金额 N,我们财务对不上账,麻烦查一下。
  18 个  你好,我们 N 月的账单扣了 N 美元,比我预想的多,能帮忙看看是不是算错了吗?
  17 个  为什么 N 月收了我 N?感觉不对。

标准答案和库对账: S041: 多收 134.56 超过发票总额 92.70
  S083: 多收 285.30 超过发票总额 244.16
```

四件事要读出来。

**分布和 Day 682 设计的一致。** 80 个有错,12 类根因每类 6 到 7 个;20 个「账其实没错」,分四种(升级折算、税行、优惠到期、年付续费)各 5 个。为什么要留两成没错的?因为客服场景里最常见的坑就是「客户说多收了,那就冲吧」。一个讨好型的 Agent 在 80 个有错的场景上也许不差,在这 20 个上会全军覆没。没有这两成,你量不出它会不会乱冲正。

**100 个场景只有 11 种问法。** 最常见的三种占了 63 个:「N 月这张发票金额 N,我们财务对不上账」一句话就占 28 个。这些句子里没有任何线索指向根因,这一点没问题。问题在另一头:100 个场景里,Agent 面对的「客户怎么开口」其实只有 11 种。真实客户不会这么说话。这是今天要写模拟客户的第一个理由。

**客户的话里总是带着对的金额。** 这一条要写个小脚本才看得见(练习 2 会做):100 句话里,金额 100/100 能对上标准答案那张发票的总额,月份 95/100 能对上。也就是说,只要照着金额去发票列表里找,每个场景都能一步定位到那张发票。Day 687 的 16/16 有一部分是这么来的。真实客户会记错月份、金额只说个大概,这是写模拟客户的第二个理由。

**有两个标准答案兑现不了。** S041 和 S083 的标准答案是「多收 134.56」和「多收 285.30」,可对应的发票只有 92.70 和 244.16。原因在 Day 682 就提过:`quantity_change_ignored` 这类注入把席位从 6 降到 1,引擎重算出来的应收是负数(S041 是 -41.86),差额 = 实际 92.70 − (−41.86) = 134.56,比整张发票还大。可是 Day 690 起的 `draft_credit_note` 拒绝开比实际扣款还大的贷记单。我用 S041 的发票直接试了一次(在库的副本上):

```text
(False, 'Error executing tool draft_credit_note: 冲正金额 134.56 加上已批准或已签发的 0.00,超过了这张发票的实际扣款合计 92.70。')
```

所以这两个场景里 Agent 就算把根因和金额都说对,代码也不会让它冲 134.56,图里 `request_approval` 会把它转人工。

怎么处理这两个场景?有三种做法:改造数脚本重新生成(会让 Day 682 之后的所有数字都变)、直接从评测集里删掉、留着但单独标出来。我选第三种。删掉等于假装没看见;重新造数会让前面七天的文章全部对不上。留着并标注,报告里可以分开算「含这两个」和「不含这两个」,这两个场景最后落进哪个桶,本身就是后天错误分析的一道题。

```python
# 追加到 billsleuth/evals/scenarios.py 末尾,完整文件见下一节
UNCASHABLE = frozenset({"S041", "S083"})
```

## 场景分成两半

数完之后第二件事是**把谁能看什么写进代码**。场景里有两半:`question`、`customer_id`、`as_of` 是客户说得出来的,给 Agent 和模拟客户看;`truth` 是标准答案,只给判分器看。只要标准答案漏进了 Agent 或模拟客户的输入,评测就失真了:Agent 在抄答案,你以为在量它的本事。

最容易漏的方式不是故意传,而是顺手:以后有人给场景文件加一个 `internal_note` 字段,某个函数写成「把场景除了 truth 之外的都传给客户」,新字段就悄悄漏进去了。所以**读场景只有一个入口,而且用白名单**。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="评测集的两半:场景文件通过 visible 白名单把 question 等四个字段交给模拟客户和 Agent,truth 只经 truth 函数交给判分器,中间一道墙不能穿过">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">S001.json 的两半,各走各的路</text>
  <rect x="20" y="44" width="170" height="100" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="32" y="66" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">客户说得出来的</text>
  <text x="32" y="88" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">id customer_id</text>
  <text x="32" y="106" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">as_of question</text>
  <text x="32" y="128" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">visible() 白名单</text>
  <rect x="20" y="170" width="170" height="100" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="32" y="192" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">truth 标准答案</text>
  <text x="32" y="214" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">root_cause invoice_ids</text>
  <text x="32" y="232" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">overcharge detail</text>
  <text x="32" y="254" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">truth() 唯一出口</text>
  <line x1="190" y1="94" x2="270" y2="94" stroke="var(--ink-soft)" marker-end="url(#a693)"/>
  <rect x="274" y="60" width="150" height="68" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="349" y="86" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">模拟客户</text>
  <text x="349" y="106" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">人设 + 开场白 + 追问</text>
  <line x1="424" y1="94" x2="474" y2="94" stroke="var(--ink-soft)" marker-end="url(#a693)"/>
  <rect x="478" y="60" width="142" height="68" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="549" y="86" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">BillSleuth 调查图</text>
  <text x="549" y="106" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">Day 686-691</text>
  <line x1="190" y1="220" x2="474" y2="220" stroke="var(--ink-soft)" marker-end="url(#a693)"/>
  <rect x="478" y="190" width="142" height="60" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="549" y="216" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">判分器</text>
  <text x="549" y="236" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">明天写</text>
  <line x1="20" y1="157" x2="620" y2="157" stroke="var(--rule)" stroke-dasharray="5 4"/>
  <text x="205" y="178" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">这条线以下的内容,不准出现在线以上任何一个箭头里</text>
  <defs><marker id="a693" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
</svg>
<figcaption>一个场景文件两半用途。蓝色是模型能看到的,琥珀色是只有代码和判分器能碰的。虚线就是白名单入口守住的那道墙。</figcaption>
</figure>

```python
# billsleuth/billsleuth/evals/scenarios.py  评测集:读场景文件,把「谁能看」分开
"""场景文件里有两半:客户说得出来的(给 Agent 和模拟客户看),和标准答案 truth(只给判分器看)。
所有读场景的代码都走这里,别的地方不准自己 json.load 场景文件。"""
import json
from pathlib import Path

from billsleuth.db import ROOT

SCENARIO_DIR = ROOT / "scenarios"
VISIBLE_KEYS = ("id", "customer_id", "as_of", "question")


def load_all(directory: Path = SCENARIO_DIR) -> list[dict]:
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(directory.glob("S*.json"))]


def visible(sc: dict) -> dict:
    """白名单:只放行客户看得到的字段。以后场景里加了新字段,默认是看不见的。"""
    return {k: sc[k] for k in VISIBLE_KEYS}


def truth(sc: dict) -> dict:
    return sc["truth"]


# 标准答案里「多收」比发票本身还大的场景。降席位的注入让引擎算出负数的应收,差额就超过了实际开出的金额。
# 代码起草贷记单时会拒绝「金额超过实际扣款」,所以这两个场景 Agent 再聪明也只能转人工。留在评测集里,报告里单独标出来。
UNCASHABLE = frozenset({"S041", "S083"})


def uncashable(sc: dict, conn) -> bool:
    t = truth(sc)
    if t["expected_action"] != "credit_note":
        return False
    row = conn.execute("SELECT total FROM invoices WHERE id = ?", (t["invoice_ids"][0],)).fetchone()
    return float(t["overcharge"]) > float(row["total"])
```

<div class="line-notes">

- `SCENARIO_DIR = ROOT / "scenarios"` `ROOT` 是 Day 682 `db.py` 里定义的项目根目录,`/` 是 `pathlib.Path` 的拼路径运算符,相当于 Node 的 `path.join`。
- `VISIBLE_KEYS = ("id", "customer_id", "as_of", "question")` 白名单。只有这四个字段客户看得到。
- `def load_all(directory: Path = SCENARIO_DIR) -> list[dict]:` 一次读完 `S*.json`,`sorted` 保证顺序固定,S001 一定在 S002 前面。
- `return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(directory.glob("S*.json"))]` `glob("S*.json")` 相当于 Node 里 `fs.readdirSync` 加正则过滤,列表推导式相当于 `.map()`。
- `return {k: sc[k] for k in VISIBLE_KEYS}` 字典推导式:只从场景里取白名单里那四个键。场景里将来多出十个字段,它们也进不来。要给客户看新字段,必须回来改 `VISIBLE_KEYS`,这一步就是一次人工确认。
- `return sc["truth"]` 标准答案也只有一个出口。判分器用它,别的地方要用就得 import `truth`,代码评审时一眼能看到。
- `UNCASHABLE = frozenset({"S041", "S083"})` 兑现不了的两个场景,`frozenset` 是不能改的集合。这个常数写死,靠下面的测试保证它和库里的实际情况一致。
- `def uncashable(sc: dict, conn) -> bool:` 判断一个场景是不是兑现不了:该冲正,并且多收金额大于发票总额。

</div>

为什么不用黑名单(「除了 truth 都给」)?因为黑名单的默认是「新字段可见」,白名单的默认是「新字段不可见」。出错时的后果不一样:白名单出错,是模拟客户少说了一句话,你很快会发现;黑名单出错,是标准答案悄悄漏了,你可能一直不知道。

测试把这个保证钉住。今天的测试都不调模型,模型换成一个只会回固定字符串的假对象:

```python
# billsleuth/tests/test_scenarios.py  评测集的接口和模拟客户:不调模型
import json
from types import SimpleNamespace

from billsleuth.evals import customer
from billsleuth.evals.scenarios import VISIBLE_KEYS, load_all, truth, visible
from billsleuth.faults import ROOT_CAUSES

SCS = load_all()


class FakeLLM:
    def __init__(self, text: str):
        self.text, self.prompts = text, []

    def invoke(self, prompt: str):
        self.prompts.append(prompt)
        return SimpleNamespace(content=self.text)


def test_hundred_scenarios_80_wrong_20_fine():
    assert len(SCS) == 100
    assert sum(1 for s in SCS if truth(s)["root_cause"] == "no_error") == 20
    assert {truth(s)["root_cause"] for s in SCS} == set(ROOT_CAUSES) | {"no_error"}


def test_visible_is_a_whitelist():
    v = visible(SCS[0])
    assert tuple(v) == VISIBLE_KEYS and "truth" not in v
    assert "truth" not in json.dumps(visible({**SCS[0], "secret": "x", "truth": {"detail": "d"}}))


def test_visible_never_contains_truth_text():
    for s in SCS:
        text = json.dumps(visible(s), ensure_ascii=False)
        assert truth(s)["detail"] not in text
        assert truth(s)["root_cause"] not in text and truth(s)["variant"] not in text


def test_persona_is_stable_per_scenario_and_trial():
    assert customer.persona_for("S001", 0) == customer.persona_for("S001", 0)
    assert len({customer.persona_for(f"S{i:03d}", 0) for i in range(1, 40)}) == 4


def test_opening_prompt_has_question_but_not_truth():
    fake = FakeLLM("你好")
    customer.opening(SCS[0], 0, llm=fake)
    assert SCS[0]["question"] in fake.prompts[0]
    assert truth(SCS[0])["detail"] not in fake.prompts[0] and "truth" not in fake.prompts[0]


def test_follow_up_done_means_none():
    assert customer.follow_up(SCS[0], 0, "已处理", llm=FakeLLM("DONE")) is None
    assert customer.follow_up(SCS[0], 0, "已处理", llm=FakeLLM("什么时候到账?")) == "什么时候到账?"


def test_uncashable_list_matches_the_database(fresh_db):
    from billsleuth.db import connect
    from billsleuth.evals.scenarios import UNCASHABLE, uncashable
    conn = connect()
    assert {s["id"] for s in SCS if uncashable(s, conn)} == set(UNCASHABLE)


def test_new_field_in_scenario_is_invisible_by_default():
    """练习 1:场景文件以后加了新字段(比如 internal_note),默认也不能出现在客户看得到的那一半。"""
    sc = {**SCS[0], "internal_note": "内部备注:这是重复扣款"}
    assert "internal_note" not in visible(sc)
    assert "内部备注" not in json.dumps(visible(sc), ensure_ascii=False)
```

<div class="line-notes">

- `SCS = load_all()` 模块加载时读一次 100 个场景,所有测试共用。
- `class FakeLLM:` 假模型:`invoke(prompt)` 把收到的提示词记下来,返回一个带 `.content` 的对象。模拟客户只用了 `invoke` 一个方法,假对象就只要实现它。[Day 687](/blog/agent-zero/day-687-bs-run/) 的 `ScriptedLLM` 是同一个思路。
- `self.text, self.prompts = text, []` 把要回的文本和收到的提示词都存起来,测试里可以检查「提示词里有没有某段话」。
- `return SimpleNamespace(content=self.text)` `SimpleNamespace` 是随手造一个有属性的对象,相当于 JS 里的 `{ content: "..." }`。
- `def test_hundred_scenarios_80_wrong_20_fine():` 100 个、80 个有错、12 类根因加 `no_error` 都在。以后有人删了场景,这条先红。
- `assert tuple(v) == VISIBLE_KEYS and "truth" not in v` `tuple(v)` 取字典所有的键,必须正好是四个白名单键。
- `assert "truth" not in json.dumps(visible({**SCS[0], "secret": "x", "truth": {"detail": "d"}}))` 往场景里硬塞一个 `secret` 和 `truth`,`visible` 出来的字符串里不能有 `truth`。`{**a, "k": v}` 是字典展开,相当于 JS 的 `{...a, k: v}`。
- `assert truth(s)["detail"] not in text` 对全部 100 个场景:标准答案的 `detail` 文本、根因名和 variant 名都不能出现在客户可见的那一半里,包括 `question` 本身。这一条查的是造数时有没有把根因写进客户的话。
- `assert len({customer.persona_for(f"S{i:03d}", 0) for i in range(1, 40)}) == 4` 39 个场景里四种人设都会出现,说明人设分配没有偏。
- `assert SCS[0]["question"] in fake.prompts[0]` 开场白的提示词里有客户原话。
- `assert truth(SCS[0])["detail"] not in fake.prompts[0] and "truth" not in fake.prompts[0]` 提示词里没有标准答案,连「truth」这个词都没有。
- `assert customer.follow_up(SCS[0], 0, "已处理", llm=FakeLLM("DONE")) is None` 模型回 `DONE` 表示满意,`follow_up` 返回 `None`;回别的话就是追问。
- `def test_uncashable_list_matches_the_database(fresh_db):` 用 Day 685 练习 2 放进 `conftest.py` 的 `fresh_db` fixture(一份干净的库副本),拿库里的真实数字重新算一遍哪些场景兑现不了,必须正好是写死的那两个。造数一变,这条就红。
- `def test_new_field_in_scenario_is_invisible_by_default():` 练习 1 的测试:场景里多出任意字段,`visible` 的结果里都不该有。

</div>

```bash
uv run pytest -q tests/test_scenarios.py
```

```text
........                                                                 [100%]
8 passed in 1.01s
```

再确认这些测试真的守得住。把 `visible` 偷偷改成黑名单,看哪条红:

```python
    return {k: v for k, v in sc.items() if k != "truth"}   # 黑名单:除了 truth 都放行
```

```text
FAILED tests/test_scenarios.py::test_new_field_in_scenario_is_invisible_by_default
1 failed, 7 passed in 1.07s
```

只有一条红,就是专门盯新字段的那条。其他 7 条都不管新字段,黑名单在今天的 100 个场景上看不出区别,因为场景文件里现在恰好没有多余字段。所以那一条测试不能省。改回白名单,全部 8 条回到绿。

## 模拟客户

场景里的 `question` 是造数脚本从 11 个模板里挑出来的,措辞规整,还都带着准确的金额。拿它直接喂 Agent,你测的是「Agent 能不能答对这一句话」,不是「能不能处理这一类问题」。模拟客户(user simulator)是让另一个模型扮演客户:拿到场景里客户知道的事实,按人设说话,Agent 回复以后再决定追问还是满意。τ-bench 的评测就是这么做的,[Day 362](/blog/agent-zero/day-362-simulated-user/) 在 SupportPilot 上写过一个,今天这个多了三样:人设带诉求、人设固定可复现、白名单只读场景。

```python
# billsleuth/billsleuth/evals/customer.py  模拟客户:只看得到 visible(场景),按人设说话,会记错,会追问
import os
import random
from typing import Any

from billsleuth.evals.scenarios import visible
from billsleuth.llm import get_llm

PERSONAS: dict[str, dict[str, str]] = {
    "hurry": {"desc": "说话简短、有点着急的小企业老板,只说结论不说细节",
              "goal": "只要一句话说清楚有没有多收、接下来会发生什么,不想看长篇解释", "twist": ""},
    "finance": {"desc": "很客气、会把自己看到的数字都贴出来的财务人员",
                "goal": "要一份能拿去对账的说明:哪张发票、差在哪一项、差多少", "twist": ""},
    "forgetful": {"desc": "记性不太好的客户,会把月份或金额记错一点",
                  "goal": "搞清楚到底有没有多收;如果多收了,钱怎么回来", "twist": "故意把月份或金额说错一点;"},
    "angry": {"desc": "情绪激动、怀疑公司在乱扣钱的客户,会要求立刻退款",
              "goal": "要一个明确的说法:钱退不退、退到哪里;含糊其辞就继续追问", "twist": ""},
}

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


def persona_for(sc_id: str, trial: int) -> str:
    """同一场景同一次试验,人设固定,重跑能复现。"""
    return random.Random(f"{sc_id}-{trial}").choice(sorted(PERSONAS))


def _llm(temperature: float) -> Any:
    llm = get_llm(temperature)
    if os.environ.get("SIM_MODEL"):  # 模拟客户的模型要固定:换了它就等于换了一套评测
        llm.model_name = os.environ["SIM_MODEL"]
    return llm


def opening(sc: dict, trial: int, llm: Any = None, facts: str | None = None) -> str:
    """sc 传完整场景也行,函数里先过一遍 visible。facts 参数只给实验用,正式评测不传。"""
    v = visible(sc)
    p = PERSONAS[persona_for(v["id"], trial)]
    prompt = OPENING.format(persona=p["desc"], facts=facts or v["question"], twist=p["twist"])
    return str((llm or _llm(0.9)).invoke(prompt).content).strip()


def follow_up(sc: dict, trial: int, reply: str, llm: Any = None) -> str | None:
    p = PERSONAS[persona_for(sc["id"], trial)]
    out = str((llm or _llm(0.3)).invoke(FOLLOW.format(reply=reply, goal=p["goal"])).content).strip()
    return None if out.upper().startswith("DONE") else out
```

<div class="line-notes">

- `PERSONAS: dict[str, dict[str, str]] = {` 四种人设,每种有三样东西:`desc` 怎么说话,`goal` 想从回复里得到什么,`twist` 额外的指令。
- `"hurry": {"desc": "说话简短、有点着急的小企业老板,只说结论不说细节",` 着急的老板。`goal` 是「只要一句话说清楚有没有多收、接下来会发生什么」,这个诉求写得比较容易满足,下面的实验会说为什么这么改。
- `"finance": {"desc": "很客气、会把自己看到的数字都贴出来的财务人员",` 财务。诉求是一份能对账的说明:哪张发票、差在哪一项、差多少。
- `"twist": "故意把月份或金额说错一点;"` 这是「记性不好」那一档特有的指令:开场白里要记错。
- `"angry": {"desc": "情绪激动、怀疑公司在乱扣钱的客户,会要求立刻退款",` 激动的客户,诉求是一个明确说法:退不退、退到哪里,含糊就继续追问。
- `OPENING = """你在扮演 SaaS 产品「云簿」的客户,给客服写第一条消息。` 开场白提示词。`{persona}`、`{facts}`、`{twist}` 三个占位符稍后用 `.format` 填。
- `你知道的事实(你只知道自己看到的,不知道系统内部原因):{facts}` 这句话告诉模型「别替系统找原因」,同时 `{facts}` 里只会放 `question`。
- `FOLLOW = """你在扮演同一个客户。客服刚回复你:` 追问提示词:拿着客服的回复和自己的诉求,二选一:回 `DONE`,或者追问一句。
- `def persona_for(sc_id: str, trial: int) -> str:` 同一场景、同一次试验永远抽到同一种人设。
- `return random.Random(f"{sc_id}-{trial}").choice(sorted(PERSONAS))` 用「场景号-试验号」这个字符串当随机数种子。Python 的 `random.Random("S001-0")` 用字符串当种子是确定的(它不像 `hash()` 每次启动都变),`S001-0` 今天抽到 `finance`,明天、换一台电脑还是 `finance`。`sorted(PERSONAS)` 先排序,是为了抽之前顺序固定。
- `llm.model_name = os.environ["SIM_MODEL"]` 想固定模拟客户用哪个模型,就设环境变量 `SIM_MODEL`。换模拟客户的模型等于换了一套评测,前后两次分数不能比。本课只用 `deepseek-flash`,所以今天没设它。
- `def opening(sc: dict, trial: int, llm: Any = None, facts: str | None = None) -> str:` `sc` 可以传完整场景,函数里第一件事就过一遍 `visible`。`facts` 参数只给后面的泄露实验用,正式评测不传。
- `v = visible(sc)` 第一道关:不管调用方传什么进来,下面只用 `v`。
- `prompt = OPENING.format(persona=p["desc"], facts=facts or v["question"], twist=p["twist"])` 事实默认就是客户原话,那 11 种模板之一。
- `return str((llm or _llm(0.9)).invoke(prompt).content).strip()` 温度 0.9,让措辞每次不一样。测试时传 `FakeLLM`,不传就用真模型。
- `def follow_up(sc: dict, trial: int, reply: str, llm: Any = None) -> str | None:` 客服回复一出来就调它。返回 `None` 表示客户满意,返回字符串是追问的话。
- `return None if out.upper().startswith("DONE") else out` 模型回 `DONE`(不分大小写)算满意。追问的温度是 0.3,比开场白低,判断要稳,措辞不用花哨。

</div>

几个设计取舍说清楚。

**人设决定怎么说话和想要什么,不决定事实。** 事实只有一个来源:`question`。我没给场景加 `customer_facts` 这样的补充字段,因为这样一来每个场景要多写一份,而且一写就容易把根因写进去。诉求(`goal`)挂在人设上而不是挂在场景上,有两个好处:不需要改 100 个文件;诉求只取决于「这个人想要什么」,和「真相是什么」无关,所以不会泄露。

**同一个场景、同一次试验,人设固定。** 重跑一次评测,S001 的第 0 次试验拿到的还是同一个人设。开场白本身温度 0.9,每次措辞会变,这是我们想要的方差。人设固定而措辞可变,比较两个版本的 Agent 时,人设这一层的随机性就被抵消掉了。

**模拟客户的模型要固定。** 后面会反复强调:换一个更会演的模拟客户,所有分数都会变。

## 实验一:四种人设说同一件事

挑 12 个场景,每类根因大致一个,再加两种账没错的,每个场景让四种人设各说一遍:48 条开场白。注意脚本里绕开了 `persona_for`,而是把四种人设都遍历一次,这样每个场景能看到四种说法。

```python
# billsleuth/scratch/sim_openings.py  同一批场景、四种人设各说一遍,看开场白和写死的 question 差多少、记错有没有真发生
import contextvars
import json
import re
from concurrent.futures import ThreadPoolExecutor

from billsleuth.evals import customer
from billsleuth.evals.scenarios import load_all, truth
from billsleuth.evals.usage import meter

IDS = ["S001", "S010", "S011", "S012", "S019", "S028", "S037", "S055", "S064", "S073", "S091", "S100"]
scs = {s["id"]: s for s in load_all()}
NUM = re.compile(r"\d+\.\d{2}|\d+(?:,\d{3})*(?:\.\d+)?")


def amounts(text: str) -> set[str]:
    return {m.replace(",", "") for m in NUM.findall(text) if "." in m or len(m) >= 3}


def one(sid_persona: tuple[str, str]) -> dict:
    sid, persona = sid_persona
    sc = scs[sid]
    # 为了每个人设都跑一遍,绕开 persona_for:直接用该人设的参数拼 prompt
    p = customer.PERSONAS[persona]
    prompt = customer.OPENING.format(persona=p["desc"], facts=sc["question"], twist=p["twist"])
    text = str(customer._llm(0.9).invoke(prompt).content).strip()
    orig = amounts(sc["question"])
    return {"id": sid, "persona": persona, "question": sc["question"], "opening": text,
            "keeps_amount": bool(orig & amounts(text)), "has_amount": bool(amounts(text)),
            "root_cause": truth(sc)["root_cause"]}


with meter() as m:
    jobs = [(s, p) for s in IDS for p in customer.PERSONAS]
    with ThreadPoolExecutor(4) as ex:
        # 线程不会自动继承「计数器」,每个任务要带上当前的上下文副本
        rows = [f.result() for f in [ex.submit(contextvars.copy_context().run, one, j) for j in jobs]]
    print(f"{len(rows)} 条开场白,输入 {m.tokens[0]} 输出 {m.tokens[1]} token,约 ¥{m.cost:.4f}")
json.dump(rows, open("out/sim_openings.json", "w"), ensure_ascii=False, indent=1)
for persona in customer.PERSONAS:
    sub = [r for r in rows if r["persona"] == persona]
    print(f"{persona:9s} 保留了原金额 {sum(r['keeps_amount'] for r in sub)}/{len(sub)};完全没提金额 {sum(not r['has_amount'] for r in sub)}")
print("不同的开场白文本:", len({r["opening"] for r in rows}), "/", len(rows))
for r in rows[:8]:
    print(f"\n{r['id']} {r['persona']}\n  原问法:{r['question']}\n  开场白:{r['opening']}")
```

<div class="line-notes">

- `IDS = ["S001"` 12 个场景:S001 取消后仍扣费、S010 折算缺失、S011 时区、S012 折算天数、S019 税率过期、S028 降席位、S037 优惠券没生效、S055 和 S073 是账没错的两种、S064 重复开票、S091 重复扣款、S100 税区错。
- `NUM = re.compile(r"\d+\.\d{2}|\d+(?:,\d{3})*(?:\.\d+)?")` 抓数字:带两位小数的金额,或者带千分位逗号的整数。
- `def amounts(text: str) -> set[str]:` 只保留有小数点或者至少 3 位的数,避免把「9 月」的 9 当成金额。
- `p = customer.PERSONAS[persona]` 直接取这个人设,不通过 `persona_for` 抽签。
- `prompt = customer.OPENING.format(persona=p["desc"], facts=sc["question"], twist=p["twist"])` 和 `opening()` 里拼的提示词完全一样。
- `"keeps_amount": bool(orig & amounts(text)),` `&` 是集合交集:原问法里的金额有没有出现在开场白里。
- `with meter() as m:` 进入计数器,出了这个块之前所有模型调用的 token 都会被记下来(下一节解释)。
- `with ThreadPoolExecutor(4) as ex:` 4 个线程并发,48 个请求排队跑。
- `rows = [f.result() for f in [ex.submit(contextvars.copy_context().run, one, j) for j in jobs]]` 每个任务提交时带上当前上下文的一份拷贝。这一行是吃了亏才加的,下一节「报错先演示」会讲。
- `print(f"{len(rows)} 条开场白,输入 {m.tokens[0]} 输出 {m.tokens[1]} token,约 ¥{m.cost:.4f}")` 汇报用量和花费。

</div>

```bash
uv run python -m scratch.sim_openings
```

```text
48 条开场白,输入 5156 输出 1510 token,约 ¥0.0224
hurry     保留了原金额 12/12;完全没提金额 0
finance   保留了原金额 12/12;完全没提金额 0
forgetful 保留了原金额 6/12;完全没提金额 0
angry     保留了原金额 12/12;完全没提金额 0
不同的开场白文本: 48 / 48

S001 hurry
  原问法:我们早就申请取消订阅了,怎么 9 月还扣了 174.90 美元?
  开场白:我们早就申请取消订阅了，怎么9月还扣了174.90美元？赶紧给我处理一下。

S001 finance
  原问法:我们早就申请取消订阅了,怎么 9 月还扣了 174.90 美元?
  开场白:您好，麻烦帮我看一下，我们早就申请取消订阅了，怎么 9 月还扣了 174.90 美元？我这边账单上显示的就是 174.90 美元，麻烦帮忙核对一下，谢谢。

S001 forgetful
  原问法:我们早就申请取消订阅了,怎么 9 月还扣了 174.90 美元?
  开场白:你好，我们之前就申请取消订阅了，怎么8月还扣了174.90美元？麻烦帮我查一下。

S001 angry
```

**第一个发现:措辞确实变了。** 48 条开场白没有一条重复。着急的老板把话压到一句,激动的客户加上了「乱扣钱」「马上退款」,财务把金额重复了两遍。Agent 面前不再是同一句话。

**第二个发现:「记错」是系统性的,不是随机的。** 「记性不好」的 12 条里,月份全部说错了,而且几乎全是往前说错一个月(10 月说成 9 月,8 月说成 7 月)。金额只有一半保持原样,另一半改了:`157.50` 变成 `175块`,`139.23` 变成 `129 块多`,`1549.03` 变成 `1594.03`(两位数字对调)。这不是偶然,模型理解「记错一点」的方式就是把月份往前挪一个月。真实客户记错月份的方式更杂:前后都有、写错、记成账单日而不是扣款日。所以用这个人设测出来的「月份容错能力」,只代表「月份往前错一个月」这一种情况,不能当成客户记性不好的全部。

第一次我跑这个脚本时,记性不好的人设有 12 条里只有 2 条保留了金额,第二次是 6 条。温度 0.9 的采样波动大,所以别拿一次跑的比例当结论。练习 4 会把这个波动量一遍。

**第三个发现:金额不精确了。** 「175块」「129 块多」「1200 多」,这些话里没有两位小数。[Day 686](/blog/agent-zero/day-686-bs-evidence/) 写的 `Intake` 要求金额是「两位小数字符串」,客户只说个大概的时候它会怎么处理,后面实跑才知道。练习 3 会在这 12 条开场白上直接试一遍。

## 报错先演示:线程里的 token 计数是 0

上面脚本里那行 `contextvars.copy_context().run` 不是一开始就有的。我最初写的是最直白的:

```python
    with ThreadPoolExecutor(4) as ex:
        rows = list(ex.map(one, jobs))
```

跑完汇报的是:

```text
48 条开场白,输入 0 输出 0 token,约 ¥0.0000
```

48 次调用,0 个 token,0 元。这当然不对。先看计数器怎么写的:

```python
# billsleuth/billsleuth/evals/usage.py  数一段代码里所有模型调用用了多少 token、花了多少钱
from collections.abc import Iterator
from contextlib import contextmanager

from langchain_core.callbacks import UsageMetadataCallbackHandler

from billsleuth.llm import estimate_cost


class Meter:
    def __init__(self, handler: UsageMetadataCallbackHandler):
        self._h = handler

    @property
    def tokens(self) -> tuple[int, int]:
        u = self._h.usage_metadata.values()
        return sum(x["input_tokens"] for x in u), sum(x["output_tokens"] for x in u)

    @property
    def cost(self) -> float:
        return estimate_cost(*self.tokens)


@contextmanager
def meter() -> Iterator[Meter]:
    from langchain_core.callbacks import get_usage_metadata_callback
    with get_usage_metadata_callback() as cb:
        yield Meter(cb)
```

<div class="line-notes">

- `from langchain_core.callbacks import UsageMetadataCallbackHandler` LangChain 自带的计数处理器:每次模型调用结束,把用量按模型名累加起来。
- `class Meter:` 把处理器包一层,对外只给 `tokens` 和 `cost` 两个属性。
- `u = self._h.usage_metadata.values()` 处理器里按模型名存了一个字典,我们只用 `deepseek-flash` 一个模型,但不依赖这一点:把所有模型的用量加起来。
- `return sum(x["input_tokens"] for x in u), sum(x["output_tokens"] for x in u)` 输入和输出分别求和。
- `return estimate_cost(*self.tokens)` `*` 把元组展开成两个参数。`estimate_cost` 是 Day 684 的 `llm.py` 里按 `.env` 里 `LLM_PRICE` 算钱的函数。
- `with get_usage_metadata_callback() as cb:` 进入之后,这个线程里发起的所有 LangChain 模型调用都会把用量报给 `cb`。
- `yield Meter(cb)` `@contextmanager` 的写法:`yield` 之前是进入时做的事,`yield` 之后是退出时做的事。使用者写 `with meter() as m:` 就拿到 `Meter`。

</div>

原因在「进入之后这个线程里」这几个字。LangChain 的计数器是靠 Python 的 `contextvars`(上下文变量)传递的,可以想成「当前执行流的隐形背包」。`ThreadPoolExecutor` 新开的线程有自己的空背包,并没有继承主线程背包里那个计数器,所以 48 次调用都发生了,但没有一个报给 `cb`。(JS 里类似的东西是 `AsyncLocalStorage`:跨 `setTimeout` 能传,换到 `worker_threads` 里就没有了。)

修法就是上面脚本里那一行:提交任务时 `contextvars.copy_context().run`,先拷一份背包,让线程在拷贝里运行。修好之后同一个脚本报出来:

```text
48 条开场白,输入 5156 输出 1510 token,约 ¥0.0224
```

算一下:输入 5156 token × ¥2 / 百万 = ¥0.0103,输出 1510 × ¥8 / 百万 = ¥0.0121,合计 ¥0.0224,对得上。单价取自 `.env` 的 `LLM_PRICE=0.04,2,8`(缓存命中输入、未命中输入、输出,每百万 token,单位元),`estimate_cost` 按未命中价算,是上限。DeepSeek 官方文档页 2026 年 10 月我没能从页面正文里直接读出价格表(页面把价格放在另一个页面里),所以这组单价沿用前几天的配置,没有重新核实。

这个坑的教训比 token 本身重要:**计数器没报数,不代表没花钱。** 评测要跑好几百次调用,费用统计一旦悄悄漏掉,账单月底才暴露。所以我给每个实验都加了一条自检:调用次数乘以每次的大概 token,和计数器的数量级对不对得上。

## 实验二:故意泄露标准答案

前面说标准答案绝不能给模拟客户。到底会坏到什么程度?故意做一次。把每个场景的 `detail` 作为「客户其实还知道」拼进事实,其余不变,同样的 12 个场景、四种人设:

```python
# billsleuth/scratch/sim_leak.py  实验:把标准答案里的 detail 递给模拟客户,开场白会泄露多少
import contextvars
import json
from concurrent.futures import ThreadPoolExecutor

from billsleuth.evals import customer
from billsleuth.evals.scenarios import load_all, truth
from billsleuth.evals.usage import meter

scs = {s["id"]: s for s in load_all()}
base = json.load(open("out/sim_openings.json"))  # 正常条件:只给 question


def grams(text: str, n: int = 3) -> set[str]:
    t = "".join(ch for ch in text if ch.isalnum())
    return {t[i:i + n] for i in range(len(t) - n + 1)}


def overlap(opening: str, detail: str, question: str) -> float:
    """detail 里有、question 里没有的三字片段,有多少出现在开场白里。"""
    new = grams(detail) - grams(question)
    return len(new & grams(opening)) / len(new) if new else 0.0


def leaky(r: dict) -> dict:
    sc = scs[r["id"]]
    p = customer.PERSONAS[r["persona"]]
    facts = sc["question"] + f"\n(客户其实还知道:{truth(sc)['detail']})"  # 故意泄露
    text = str(customer._llm(0.9).invoke(customer.OPENING.format(persona=p["desc"], facts=facts, twist=p["twist"])).content).strip()
    return {**r, "opening": text}


def mean(rows: list[dict]) -> float:
    return sum(overlap(r["opening"], truth(scs[r["id"]])["detail"], scs[r["id"]]["question"]) for r in rows) / len(rows)


with meter() as m:
    rows = [f.result() for f in [ThreadPoolExecutor(4).submit(contextvars.copy_context().run, leaky, r) for r in base]]
    print(f"泄露条件 {len(rows)} 条,约 ¥{m.cost:.4f}")
print(f"正常条件:开场白里出现 detail 新信息的比例 {mean(base):.1%}")
print(f"泄露条件:{mean(rows):.1%}")
hits = [r for r in rows if overlap(r["opening"], truth(scs[r["id"]])["detail"], scs[r["id"]]["question"]) > 0.15]
print(f"泄露条件下重叠超过 15% 的开场白 {len(hits)}/{len(rows)}")
for r in hits[:4]:
    print(f"\n{r['id']} detail:{truth(scs[r['id']])['detail']}\n  开场白:{r['opening']}")
json.dump(rows, open("out/sim_leak.json", "w"), ensure_ascii=False, indent=1)
```

<div class="line-notes">

- `base = json.load(open("out/sim_openings.json"))` 上一个实验存下来的 48 条正常开场白,当对照组。
- `def grams(text: str, n: int = 3) -> set[str]:` 把文本拆成相邻 3 个字的片段(trigram),比如「重复扣款」变成「重复扣」「复扣款」。用来粗略比较两段话共享了多少内容。
- `t = "".join(ch for ch in text if ch.isalnum())` 先去掉标点和空格,只留字和数字。
- `new = grams(detail) - grams(question)` `detail` 里有、`question` 里没有的片段,也就是「只有看过标准答案才会知道的信息」。集合差。
- `return len(new & grams(opening)) / len(new) if new else 0.0` 这些「新信息」片段有多少比例出现在开场白里。0 表示一点没泄露,越高越多。
- `facts = sc["question"] + f"\n(客户其实还知道:{truth(sc)['detail']})"  # 故意泄露` 唯一的区别:事实里多了标准答案。
- `text = str(customer._llm(0.9).invoke(` 其余和正常条件完全一样。
- `print(f"正常条件:开场白里出现 detail 新信息的比例 {mean(base):.1%}")` 对照组的平均重叠。
- `hits = [r for r in rows if overlap(` 重叠超过 15% 的开场白,算明显泄露。

</div>

```bash
uv run python -m scratch.sim_leak
```

```text
泄露条件 48 条,约 ¥0.0273
正常条件:开场白里出现 detail 新信息的比例 0.0%
泄露条件:12.1%
泄露条件下重叠超过 15% 的开场白 10/48

S010 detail:升级后的发票只收了新套餐剩余天数,没有退还旧套餐未使用的天数
  开场白:你好，我们8月的账单扣了1549.03美元，比我预想的多不少，能帮忙看看是不是算错了吗？另外我注意到升级后的发票只收了新套餐剩余天数，旧套餐没用完的天数好像没退，麻烦一起核对下，谢谢。

S012 detail:2026-07-05 开始的周期有 31 天,折算却按 30 天算
  开场白:您好，麻烦帮我看一下，8 月这张发票金额是 2292.42，我们财务这边对不上账。另外 2026-07-05 开始的这个周期有 31 天，折算的时候好像是按 30 天算的，能帮忙核对一下吗？谢谢！

S028 detail:席位已从 10 调到 6,INV-0028-03 仍按 10 席位收费且没有折算
  开场白:你好，我想请教一下账单的事：我们上个月把席位从 10 减到了 6，但 8 月账单 INV-0028-03 还是 144.20，看起来仍按 10 个席位收费，也没看到折算，麻烦帮忙看一下，谢谢。

S028 detail:席位已从 10 调到 6,INV-0028-03 仍按 10 席位收费且没有折算
  开场白:你们这账单怎么回事？我上个月明明把席位从10个减到6个了，8月账单还是144.20，一分没少！INV-0028-03还按10个席位收，多出来的钱赶紧退给我。
```

正常条件下重叠是 0.0%,泄露条件下 12.1%,48 条里有 10 条超过 15%。看那几条:S028 的开场白里出现了发票号 `INV-0028-03` 和「按 10 个席位收费」,S012 的客户说「2026-07-05 开始的这个周期有 31 天,折算按 30 天算」。真实客户不可能知道这些。这样的开场白一旦喂给 Agent,Agent 的第一步就是照着客户的话抄,根因判断变成了阅读理解。

10/48 是大约五分之一。这个比例不大,所以危险:你看几条开场白,多半看不出来,而五分之一的场景悄悄变简单了,成功率就被抬高了。泄露不是「全有或全无」,它是一小部分样本被污染。防它只有一个办法,就是前面那个白名单入口加测试,而不是靠读样本。

## 实验三:追问到底有没有发生

模拟客户的另一半是追问。Day 127 的旧课里有过一个教训:默认的诉求「搞清楚为什么扣了这么多,多扣了要知道怎么退」太宽松,15 次运行没有一次追问,所以多轮能力根本没有被测到。今天对照看一下:同一条标准客服回复,一次用宽松的诉求,一次用人设自带的诉求。

回复我是用标准格式写死的:该冲正的场景说「确认多收了 X 美元,已提交更正申请,审核通过后会把多收的金额退回或抵扣」,账没错的场景说「按规则计算金额没有错误」。这等于 Agent 在最理想的情况下的样子(真实 Agent 的回复后天才能收集)。

```python
# billsleuth/scratch/sim_followup.py  追问有没有真的发生:同一条标准客服回复,宽松的诉求 vs 按人设写的诉求
import contextvars
import json
from concurrent.futures import ThreadPoolExecutor

from billsleuth.evals import customer
from billsleuth.evals.scenarios import load_all, truth
from billsleuth.evals.usage import meter

IDS = ["S001", "S010", "S011", "S012", "S019", "S028", "S037", "S055", "S064", "S073", "S091", "S100"]
scs = {s["id"]: s for s in load_all()}
GENERIC = "搞清楚为什么扣了这么多;如果多扣了,要知道钱怎么退回来"  # Day 127 旧课用的诉求

REPLY = ("您好,我们核对了您提到的发票,确认多收了 {amt} 美元。原因是系统在计费时出现了偏差。"
         "已提交更正申请,审核通过后会把多收的金额退回或抵扣,处理结果会邮件通知您。")
REPLY_OK = ("您好,我们核对了您提到的发票,按规则计算金额没有错误,多出来的部分是正常的计费项目。"
            "如果还有疑问,可以回复这封邮件。")


def one(job: tuple[str, str, str]) -> dict:
    sid, persona, which = job
    sc, p = scs[sid], customer.PERSONAS[persona]
    t = truth(sc)
    reply = (REPLY.format(amt=t["overcharge"]) if t["expected_action"] == "credit_note" else REPLY_OK)
    goal = GENERIC if which == "generic" else p["goal"]
    out = str(customer._llm(0.3).invoke(customer.FOLLOW.format(reply=reply, goal=goal)).content).strip()
    return {"id": sid, "persona": persona, "goal": which, "follow": None if out.upper().startswith("DONE") else out}


with meter() as m:
    jobs = [(s, p, w) for s in IDS for p in customer.PERSONAS for w in ("generic", "persona")]
    ctx = contextvars.copy_context
    with ThreadPoolExecutor(4) as ex:
        rows = [f.result() for f in [ex.submit(ctx().run, one, j) for j in jobs]]
    print(f"{len(rows)} 次判断,约 ¥{m.cost:.4f}")
for w in ("generic", "persona"):
    sub = [r for r in rows if r["goal"] == w]
    print(f"{w:8s} 追问 {sum(r['follow'] is not None for r in sub)}/{len(sub)}")
for persona in customer.PERSONAS:
    sub = [r for r in rows if r["goal"] == "persona" and r["persona"] == persona]
    print(f"  {persona:9s} 追问 {sum(r['follow'] is not None for r in sub)}/{len(sub)}")
for r in [r for r in rows if r["goal"] == "persona" and r["follow"]][:5]:
    print(f"  {r['id']} {r['persona']}:{r['follow']}")
json.dump(rows, open("out/sim_followup.json", "w"), ensure_ascii=False, indent=1)
```

<div class="line-notes">

- `GENERIC = "搞清楚为什么扣了这么多;如果多扣了,要知道钱怎么退回来"` 旧课用的宽松诉求,所有人设共用。
- `REPLY = ("您好,我们核对了您提到的发票,确认多收了 {amt} 美元。原因是系统在计费时出现了偏差。"` 标准回复,多收的场景用。`{amt}` 填标准答案里的金额,这是实验里的假设,不是真实 Agent 会做的事。
- `REPLY_OK = (` 账没错的场景用的回复。
- `reply = (REPLY.format(amt=t["overcharge"]) if t["expected_action"] == "credit_note" else REPLY_OK)` 按场景选回复。这里读了 `truth`,因为我们在**造回复**,不是在给模拟客户喂信息。模拟客户只看到这条回复文本。
- `goal = GENERIC if which == "generic" else p["goal"]` 两组对照:宽松诉求和人设诉求。
- `out = str(customer._llm(0.3).invoke(customer.FOLLOW.format(reply=reply, goal=goal)).content).strip()` 和 `follow_up()` 里一样的调用。
- `"follow": None if out.upper().startswith("DONE") else out}` 回 `DONE` 记成 `None`(没追问)。
- `jobs = [(s, p, w) for s in IDS for p in customer.PERSONAS for w in ("generic", "persona")]` 12 个场景 × 4 人设 × 2 种诉求 = 96 次判断。

</div>

```bash
uv run python -m scratch.sim_followup
```

```text
96 次判断,约 ¥0.0280
generic  追问 8/48
persona  追问 26/48
  hurry     追问 0/12
  finance   追问 12/12
  forgetful 追问 2/12
  angry     追问 12/12
  S001 finance:请把具体是哪张发票、差在哪个计费项、差多少写成一份可用于对账的说明发我。
  S001 angry:你们只说“退回或抵扣”，到底退不退、退到哪里？请给明确说法。
  S010 finance:哪张发票、具体差在哪一项、差多少，请给我一份能直接对账的书面说明。
  S010 angry:请明确告诉我：这笔 296.19 美元到底退不退、退到哪里（原支付卡还是账户抵扣）？
  S011 finance:请把具体是哪张发票、差在哪个计费项、差额多少写成一份可用于对账的说明发我。
```

宽松诉求下 48 次里只有 8 次追问(17%),换成人设自带的诉求涨到 26/48(54%)。更有意思的是分人设:

- 财务 12/12 都追问。回复里没有写「差在哪一项」,而财务要的就是对账说明。这是真的缺口:Day 688 的客户版解释故意不出现工具名和根因类别名,可是它也没写「哪张发票的哪一行」。
- 激动的客户 12/12 都追问。「退回或抵扣」是 Agent 被要求只能说的话(Day 688 写进 `WRITER_RULES` 的规则:只能说「已提交更正申请」,不能承诺退款时间和结果),所以激动的客户永远得不到一个「明确说法」。这不是模拟客户的毛病,是产品规则和客户诉求之间真实的张力,多轮评测能把它暴露出来。
- 着急的老板 0/12。回复已经一句话说完了。
- 记性不好的 2/12。他的诉求就是「到底多没多收」,标准回复直接回答了。

我第一次写着急老板的诉求是「要知道大概多久能处理完」,结果他 12/12 全追问(总计 38/48)。可是 Agent 被规则禁止承诺时间,这样的追问永远得不到满足,变成一个固定的噪声。把诉求改成「说清楚有没有多收、接下来会发生什么」之后,这个人设才有了「满意」的可能。写诉求的原则是:一个合理的客服回复要有可能满足它,否则追问率 100% 反而说明不了什么。

这些数字都是用**我写死的标准回复**得来的,不代表真实 Agent 会被追问多少次。真实比例要等后天真跑才有。今天只证明一件事:诉求写得具体,追问才会发生。

## 今天的文件

| 文件 | 做什么 |
| --- | --- |
| `billsleuth/evals/__init__.py` | 空文件,让 `evals` 成为包 |
| `billsleuth/evals/scenarios.py` | 读场景的唯一入口,`visible` 白名单、`truth`、`UNCASHABLE` |
| `billsleuth/evals/customer.py` | 模拟客户:四种人设、`opening`、`follow_up` |
| `billsleuth/evals/usage.py` | 数 token 和花费的计数器 |
| `scripts/eval_set_stats.py` | 数评测集,和库对账 |
| `tests/test_scenarios.py` | 8 条测试,不调模型 |
| `scratch/sim_openings.py`、`sim_leak.py`、`sim_followup.py` | 三个实验 |
| `scratch/ex2_question_info.py`、`ex3_intake_forgetful.py`、`ex4_forgetful_variance.py` | 练习 2、3、4 |

测试总数 356 条(348 加今天的 8 条),全绿。

今天真模型花费(全部 `deepseek-flash`,价格按 `LLM_PRICE`,输入按未命中价算,是上限):

| 项目 | 花费 |
| --- | --- |
| 实验一 48 条开场白(第二次,有计数) | ¥0.0224 |
| 实验一第一次(计数器漏记,按同样规模估) | 约 ¥0.022 |
| 实验二泄露对照 48 条 | ¥0.0273 |
| 实验三 96 次追问判断(最终版) | ¥0.0280 |
| 实验三第一版诉求(96 次) | ¥0.0280 |
| 练习 3(12 次 intake) | ¥0.0173 |
| 练习 4(24 条开场白) | ¥0.0105 |
| 合计 | 约 ¥0.155 |

整个三天(Day 693–695)的 API 预算上限是 ¥2。明天跑评测要用掉大头,所以今天特意把花费压在 ¥0.16。

## 动手练习

**练习 1:场景文件以后多出一个字段,会不会漏给客户?** 给场景字典加一个 `internal_note`,写一条测试保证它不会出现在 `visible()` 的结果里。再把 `visible` 偷偷改成黑名单(除了 `truth` 都放行),确认这条测试变红。

<details><summary>参考答案</summary>

```python
# billsleuth/tests/test_scenarios.py  追加在文件末尾
def test_new_field_in_scenario_is_invisible_by_default():
    """练习 1:场景文件以后加了新字段(比如 internal_note),默认也不能出现在客户看得到的那一半。"""
    sc = {**SCS[0], "internal_note": "内部备注:这是重复扣款"}
    assert "internal_note" not in visible(sc)
    assert "内部备注" not in json.dumps(visible(sc), ensure_ascii=False)
```

<div class="line-notes">

- `sc = {**SCS[0], "internal_note": "内部备注:这是重复扣款"}` 拿 S001 做底,加一个原本没有的字段。字典展开后面写的键会覆盖或新增,相当于 JS 的 `{...SCS[0], internal_note: "..."}`。
- `assert "internal_note" not in visible(sc)` 键本身不能在。`in` 对字典检查的是键。
- `assert "内部备注" not in json.dumps(visible(sc), ensure_ascii=False)` 值也不能在。`ensure_ascii=False` 让中文保持原样,不转成 `\uXXXX`,否则这句断言永远为真,等于没测。

</div>

先用白名单版本跑:

```text
8 passed in 1.01s
```

然后把 `visible` 里那一行改成 `return {k: v for k, v in sc.items() if k != "truth"}`:

```text
FAILED tests/test_scenarios.py::test_new_field_in_scenario_is_invisible_by_default
1 failed, 7 passed in 1.07s
```

只有这一条红。一开始我把这条测试写成「新字段不能出现在模拟客户的提示词里」,结果黑名单版本也是绿的,因为 `opening()` 的提示词只用了 `question`,新字段压根没往提示词里去。测试要对准**会出错的那个函数**(`visible`),而不是对准下游。改回白名单后恢复全绿。

</details>

**练习 2:客户的话里,金额和月份能和库对上多少?** 写脚本,对 100 个场景统计:`question` 里的金额等于标准答案那张发票总额的有几个,月份等于发票开具月份的有几个,两样都没有的有几个。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex2_question_info.py  练习 2:100 句 question 里,金额和月份有多少能和库对上?
import re

from billsleuth.db import connect
from billsleuth.evals.scenarios import load_all, truth, visible

conn = connect()
rows = {"金额对上标准答案那张发票": 0, "月份对上那张发票": 0, "金额月份都没有": 0}
for s in load_all():
    q, inv_id = visible(s)["question"], truth(s)["invoice_ids"][0]
    inv = conn.execute("SELECT total, issued_at FROM invoices WHERE id = ?", (inv_id,)).fetchone()
    amts = re.findall(r"\d+\.\d{2}", q)
    month = re.search(r"(\d+) 月", q)
    if amts and inv["total"] in amts:
        rows["金额对上标准答案那张发票"] += 1
    if month and int(month.group(1)) == int(inv["issued_at"][5:7]):
        rows["月份对上那张发票"] += 1
    if not amts and not month:
        rows["金额月份都没有"] += 1
for k, v in rows.items():
    print(f"{k}: {v}/100")
```

<div class="line-notes">

- `conn = connect()` Day 682 `db.py` 里的连接函数,默认连项目根目录的 `billing.db`,返回的行可以按列名取值。
- `q, inv_id = visible(s)["question"], truth(s)["invoice_ids"][0]` 客户的话用 `visible` 取,标准答案的发票号用 `truth` 取。S001 里是 `INV-0001-05`。
- `inv = conn.execute("SELECT total, issued_at FROM invoices WHERE id = ?", (inv_id,)).fetchone()` S001 取回 `total='174.90'`、`issued_at='2026-09-25'`。库里金额是字符串,和 `re.findall` 取出来的字符串可以直接比。
- `amts = re.findall(r"\d+\.\d{2}", q)` 抓「两位小数」的数。S001 的 `question` 里只有 `174.90`。
- `month = re.search(r"(\d+) 月", q)` 抓「N 月」。S001 的是 `9 月`;注意要空格,所有 question 都是「9 月」这种写法。
- `if amts and inv["total"] in amts:` 句子里有金额,并且发票总额在其中。S001:`'174.90' in ['174.90']` 为真。
- `int(inv["issued_at"][5:7])` 字符串切片 `[5:7]` 取 `2026-09-25` 的第 6、7 个字符 `09`,转成整数 9。
- `if not amts and not month:` 两样都没有的,问法里完全没有定位线索。

</div>

```bash
uv run python -m scratch.ex2_question_info
```

```text
金额对上标准答案那张发票: 100/100
月份对上那张发票: 95/100
金额月份都没有: 0/100
```

金额 100/100,月份 95/100。另外 5 个月份对不上的是「今天突然扣了我们 N 美元」那种问法,里面本来没有月份,不是写错。结论:评测集里的客户话全部带着准确的金额,这是造数脚本的习惯,不是真实客户的习惯。只要按金额去找发票,定位这一步在评测集上几乎不会失败,所以评测集上的成功率很难反映「客户记错了怎么办」。

</details>

**练习 3:客户把月份和金额记错了,`intake` 加 `pick_candidates` 还找得到那张发票吗?** 拿实验一里「记性不好」的 12 条开场白,走 Day 686 的 `Intake` 抽取和 `pick_candidates`,看候选里有没有标准答案那张发票。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex3_intake_forgetful.py  练习 3:客户把月份金额记错,intake + pick_candidates 还能不能找到那张发票?
import json

from billsleuth.evals.scenarios import load_all, truth
from billsleuth.evals.usage import meter
from billsleuth.graph import Intake, pick_candidates
from billsleuth.llm import get_llm
from billsleuth.mcp_bridge import BillingMCP

scs = {s["id"]: s for s in load_all()}
rows = [r for r in json.load(open("out/sim_openings.json")) if r["persona"] == "forgetful"]
mcp = BillingMCP(in_process=True)
intake_llm = get_llm(0).with_structured_output(Intake, method="function_calling")
hit = 0
with meter() as m:
    for r in rows:
        sc = scs[r["id"]]
        info = Intake.model_validate(intake_llm.invoke(f"客户原话:{r['opening']}"))
        ok, invs = mcp.call("list_invoices", {"customer_id": sc["customer_id"], "limit": 24})
        cands = pick_candidates(invs, info.amount, info.month)
        target = truth(sc)["invoice_ids"][0]
        hit += target in cands
        print(f"{r['id']} 抽到 金额={info.amount} 月份={info.month} → 候选 {cands} {'✓' if target in cands else '✗ 应该是 ' + target}")
print(f"\n候选里有标准发票:{hit}/{len(rows)};约 ¥{m.cost:.4f}")
```

<div class="line-notes">

- `rows = [r for r in json.load(open("out/sim_openings.json")) if r["persona"] == "forgetful"]` 读实验一存下来的开场白,只留「记性不好」那 12 条。
- `intake_llm = get_llm(0).with_structured_output(Intake, method="function_calling")` 和 `graph.py` 里 `intake` 节点同样的写法,温度 0。
- `info = Intake.model_validate(intake_llm.invoke(f"客户原话:{r['opening']}"))` 对一条开场白抽 `complaint`、`amount`、`month`。S001 的开场白是「怎么 8 月还扣了 174.90 美元」,抽到金额 `174.90`、月份 `8`。
- `ok, invs = mcp.call("list_invoices", {"customer_id": sc["customer_id"], "limit": 24})` 和 `locate` 节点一样,用工具取 C-0001 的发票列表,5 张。
- `cands = pick_candidates(invs, info.amount, info.month)` 不用模型的找候选函数,金额和月份同时对上的优先。
- `hit += target in cands` 布尔值可以直接加到整数上,`True` 当 1。
- `print(f"{r['id']} 抽到` 每个场景打一行:抽出来的金额月份、候选发票、对不对。

</div>

```bash
uv run python -m scratch.ex3_intake_forgetful
```

```text
S001 抽到 金额=174.90 月份=8 → 候选 ['INV-0001-04'] ✗ 应该是 INV-0001-05
S010 抽到 金额=1594.03 月份=7 → 候选 ['INV-0010-02'] ✗ 应该是 INV-0010-03
S011 抽到 金额=1483.44 月份=7 → 候选 ['INV-0011-02'] ✗ 应该是 INV-0011-03
S012 抽到 金额=2292.42 月份=7 → 候选 ['INV-0012-03'] ✓
S019 抽到 金额=175.00 月份=9 → 候选 ['INV-0019-05'] ✗ 应该是 INV-0019-06
S028 抽到 金额=144.20 月份=7 → 候选 ['INV-0028-02'] ✗ 应该是 INV-0028-03
S037 抽到 金额=47.70 月份=6 → 候选 ['INV-0037-04', 'INV-0037-02'] ✓
S055 抽到 金额=None 月份=6 → 候选 ['INV-0055-02'] ✗ 应该是 INV-0055-03
S064 抽到 金额=163.50 月份=8 → 候选 ['INV-0064-05', 'INV-0064-04D', 'INV-0064-04'] ✓
S073 抽到 金额=196.35 月份=9 → 候选 ['INV-0073-04'] ✗ 应该是 INV-0073-05
S091 抽到 金额=129.00 月份=7 → 候选 ['INV-0091-03'] ✗ 应该是 INV-0091-04
S100 抽到 金额=168.00 月份=9 → 候选 ['INV-0100-05'] ✗ 应该是 INV-0100-06

候选里有标准发票:3/12;约 ¥0.0173
```

候选里只有标准发票的只有 3/12。读几个例子就知道为什么:

- S001:客户说「8 月扣了 174.90」。C-0001 的 5 张发票金额全是 174.90(每月一样),`pick_candidates` 先找「金额和月份都对上」的,8 月那张 `INV-0001-04` 满足,直接返回它,而真正出问题的是 9 月的 `INV-0001-05`。金额对了,月份记错一个月,反而被月份带到了错的发票上。
- S055:客户说「扣了 1200 多」,`amount` 抽出来是 `None`(要求两位小数字符串,抽不出),只剩月份 6,候选就是 6 月那张。
- S012、S037、S064 命中了,S037 和 S064 是因为候选不止一张(候选里有多张时命中率自然高)。

注意这只是「候选」,不是最终结论。Day 686 的 `locate` 节点把客户的**全部发票**都列给模型看了,候选只是「建议先看这几张」,模型可以自己改看别的。所以 3/12 不等于 Agent 3/12 找得到,它只说明提示给的是错的时候,Agent 要靠自己纠正。纠正得了多少,后天跑评测才知道。一件今天能确定的事:这 12 条开场白里,「金额准确的」场景(S012、S028、S037、S064、S073)里,S028、S073 也没命中,因为金额一样的发票不止一张,而月份错了一个月。花费约 ¥0.0173。

</details>

**练习 4:「记错」每次都一样吗?** 同一个场景、同一种人设(记性不好)连说 8 次,统计金额不变的次数和提到的月份。选 S001、S019、S064 三个场景。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex4_forgetful_variance.py  练习 4:同一场景、同一人设连说 8 次,「记错」是不是每次都一样
import contextvars
import re
from concurrent.futures import ThreadPoolExecutor

from billsleuth.evals import customer
from billsleuth.evals.scenarios import load_all
from billsleuth.evals.usage import meter

scs = {s["id"]: s for s in load_all()}
p = customer.PERSONAS["forgetful"]


def month_of(text: str) -> str:
    m = re.search(r"(\d+) ?月", text)
    return m.group(1) if m else "?"


def say(sid: str) -> str:
    prompt = customer.OPENING.format(persona=p["desc"], facts=scs[sid]["question"], twist=p["twist"])
    return str(customer._llm(0.9).invoke(prompt).content).strip()


with meter() as m, ThreadPoolExecutor(4) as ex:
    for sid in ("S001", "S019", "S064"):
        outs = [f.result() for f in [ex.submit(contextvars.copy_context().run, say, sid) for _ in range(8)]]
        orig = re.findall(r"\d+\.\d{2}", scs[sid]["question"])[0]
        months = [month_of(o) for o in outs]
        print(f"{sid} 原问法:{scs[sid]['question']}")
        print(f"   8 次里金额不变 {sum(orig in o for o in outs)} 次;提到的月份 {months}")
    print(f"约 ¥{m.cost:.4f}")
```

<div class="line-notes">

- `p = customer.PERSONAS["forgetful"]` 固定用「记性不好」这个人设。
- `def month_of(text: str) -> str:` 取出文字里提到的月份。正则 `(\d+) ?月` 里的 ` ?` 表示「月」前面的空格可有可无。
- `return m.group(1) if m else "?"` 没提月份就返回 `?`。先判断 `m` 是不是 `None` 再 `.group`,这样类型检查不会报红线。
- `def say(sid: str) -> str:` 说一次开场白。每次调用都是一次独立的采样,温度 0.9。
- `with meter() as m, ThreadPoolExecutor(4) as ex:` 一个 `with` 同时进两个上下文,先计数器后线程池。
- `outs = [f.result() for f in [ex.submit(contextvars.copy_context().run, say, sid) for _ in range(8)]]` 提交 8 个任务,每个带上下文拷贝(原因见前面「报错先演示」),取回 8 条开场白。
- `orig = re.findall(r"\d+\.\d{2}", scs[sid]["question"])[0]` 原问法里的第一个金额,S001 是 `174.90`。
- `months = [month_of(o) for o in outs]` 8 条开场白各取一个月份。S001 的原月份是 9。
- `sum(orig in o for o in outs)` 数有几条里还含着原金额字符串。`orig in o` 是子串判断。

</div>

```bash
uv run python -m scratch.ex4_forgetful_variance
```

```text
S001 原问法:我们早就申请取消订阅了,怎么 9 月还扣了 174.90 美元?
   8 次里金额不变 3 次;提到的月份 ['8', '10', '8', '8', '10', '8', '10', '8']
S019 原问法:为什么 10 月收了我 157.50?感觉不对。
   8 次里金额不变 1 次;提到的月份 ['9', '9', '9', '9', '9', '9', '9', '9']
S064 原问法:9 月我好像收到了两张一样的发票,钱也扣了两次,每次 163.50。
   8 次里金额不变 0 次;提到的月份 ['8', '8', '8', '8', '8', '8', '10', '8']
约 ¥0.0105
```

三个观察。第一,S001 的月份在 8 和 10 之间摆(原来是 9),往前往后都有;S019 的 8 次全是 9,没有一次是别的数。**同样的人设,在不同场景里「记错」的方式很不一样**,取决于模型怎么理解那句话。第二,金额不变的次数 3、1、0:S064 的 8 次全都改了金额,可能是把「163.50」说成「160 多」。第三,所以「记性不好」这一档是真的在扰动输入,但扰动的分布不均匀,没法声称它代表了真实客户的记错。想测得更均匀,可以把「怎么记错」写成确定性规则(比如 `S001-0` 固定月份 −1、金额四舍五入到整数),让模型只负责措辞。这是一个取舍:规则版可控,模型版自然。花费 ¥0.0105。

</details>

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 评测集 | 一批有标准答案的题,用来量 Agent 做得好不好。本课是 100 个计费场景,例子:`S001` |
| 场景 | 评测集里的一道题:一个客户、一句话、一份标准答案。例子:`scenarios/S001.json` |
| 标准答案(`truth`) | 这道题的正确结论,只给判分器看,绝不能给 Agent 或模拟客户 |
| 白名单 | 只放行列出来的几项,其余默认拒绝。例子:`VISIBLE_KEYS` 只放行四个字段 |
| 黑名单 | 只拦截列出来的几项,其余默认放行。新增的字段会不小心放行,所以这里不用 |
| 泄露 | 标准答案的信息进了 Agent 或模拟客户的输入。例子:实验二里 48 条中有 10 条重叠超过 15% |
| 模拟客户 | 用另一个模型扮演的客户,代替写死的原话,能追问。例子:`customer.py` |
| 人设(persona) | 模拟客户的说话方式加诉求。例子:`hurry` 着急的老板 |
| 追问 | 客户看完客服回复后再问一句。模拟客户回 `DONE` 表示不追问 |
| 诉求(`goal`) | 客户想从回复里得到什么,追问与否由它决定。例子:财务要「能对账的说明」 |
| 兑现不了的场景 | 标准答案要求的贷记金额超过发票本身,代码不会让 Agent 开这张单。例子:S041、S083 |
| 随机数种子 | 随机数生成器的初始值,同样的种子每次抽同样的结果。例子:`random.Random("S001-0")` |
| 上下文变量(`contextvars`) | 当前执行流的隐形背包,线程池新开的线程不会自动带上它 |
| 计数器(callback handler) | 挂在模型调用上记录用量的对象。例子:`UsageMetadataCallbackHandler` |
| 三字片段(trigram) | 把文本拆成相邻三个字的小块,用来粗略比较两段话有多像 |

## 常见误区

**模拟客户知道标准答案,这样它回复更真实。** 反了。实验二里给了 `detail`,48 条开场白里 10 条把根因说漏了,发票号都出现了。客户只知道客户看得到的东西,所有读场景的代码走白名单入口。

**场景里加了字段,在代码里「除了 truth 都传」最省事。** 黑名单的默认是新字段可见。今天的 8 条测试里,有 7 条在黑名单下仍然全绿,只有专门盯新字段的那一条会红。

**把「记性不好」写成一句提示词,就以为测了客户记错。** 实测 12/12 的月份都说错了,而且几乎总是往前错一个月;金额错不错因场景而异,8 次里金额不变的次数在 0 到 3 之间。它测的只是模型想象中的记错。

**诉求写得宽松,追问也会发生。** 宽松诉求下 48 次只追问 8 次(17%),换成按人设写的诉求是 26/48。多轮能力要靠具体的诉求才测得到。

**诉求写得太苛刻,追问率高就算多轮测得好。** 着急老板第一版诉求是「要知道多久能处理完」,12/12 全追问,可 Agent 规则禁止承诺时间,永远答不上。追问率 100% 说明诉求写坏了,不说明 Agent 差。

**线程池里的模型调用,计数器照样能数。** 不能。计数器靠上下文变量传递,线程池新开的线程是空背包。第一次跑出来 48 次调用、输入输出 0 token、¥0。提交任务时用 `contextvars.copy_context().run`。

**标准答案造出来就一定对。** 100 个里有两个(S041、S083)的多收金额比发票本身还大,代码不会让 Agent 冲这么多。评测集上线前要拿库、拿工具把标准答案对一遍。

**随机种子用 `hash()`。** Python 的字符串 `hash()` 每次启动结果不同,拿它当种子重跑会换人设。用 `random.Random("S001-0")` 这样的字符串种子是确定的。

## 学习资料

### 文档与文章

- [τ-bench 论文(Yao 等,2024)](https://arxiv.org/abs/2406.12045):用户模拟、按最终数据库状态判分、pass^k 三个做法都出自这里,重点读第 3 节,40 分钟。
- [τ²-bench 论文(Barres 等,2025)](https://arxiv.org/abs/2506.07982):加了用户和 Agent 都能改环境的「双控」场景,读摘要和第 3 节,30 分钟。
- [Anthropic · Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):Agent 评测怎么设计、怎么判分、什么时候用模型评审,30 分钟。
- [Hamel Husain · LLM Evals FAQ](https://hamel.dev/blog/posts/evals-faq/):挑「评测集多大」「要不要用模型评审」两节,20 分钟。
- [Python 文档 · contextvars](https://docs.python.org/3/library/contextvars.html):今天线程里计数为 0 的原理,看开头两节和 `copy_context`,10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1aaxyz8ELY&p=19&autoplay=0&high_quality=1" title="(中英双语!)吴恩达最新《Agentic AI》大佬亲授智能体教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>(中英双语!)吴恩达最新《Agentic AI》大佬亲授智能体教程,附示例代码!_deeplearning.ai · 第 19 P「模块 4:构建智能体 AI 的实用技巧 1-评估(evals)」,15 分钟,讲怎么先建一个小评测集再一点点加,和今天先数、先测再放大的节奏一样。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/lTwnhgZ0-qQ" title="τ-bench: Evaluating Real-World Tool-Agent-User Interaction" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Andriy Batutin · τ-bench: Evaluating Real-World Tool-Agent-User Interaction · 论文讲解,重点听用户模拟那一段,英文。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/GL0XhAj5LPE" title="LLM Evals: Common Mistakes" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hamel Husain · LLM Evals: Common Mistakes · 评测里最常见的几个坑,对照今天的「常见误区」看,英文。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):评估方法那几章,讲清楚什么时候能用规则判分、什么时候不得不用模型评审,以及评测集怎么设计才有代表性。

### 开源项目与代码

- [sierra-research/tau-bench](https://github.com/sierra-research/tau-bench):看 `tau_bench/envs/user.py` 里用户模拟器的几种策略,40 分钟。
- [sierra-research/tau2-bench](https://github.com/sierra-research/tau2-bench):新版,任务和用户模拟器都做了改进。

## 自测

1. 为什么读场景只留一个入口,而且用白名单?

<details><summary>答案</summary>

标准答案一旦漏进 Agent 或模拟客户的输入,评测就失真,而且很难发现(实验二里 10/48 的开场白被污染,人读几条看不出来)。入口唯一,代码评审时一眼能看到谁在读 `truth`;白名单让新增字段默认不可见,出错的后果是客户少说一句话,很快会发现,而不是答案悄悄漏出去。

</details>

2. 评测集里客户的话「100 个场景只有 11 种问法」「100/100 金额能对上」各说明评测集的什么问题?

<details><summary>答案</summary>

前者说明客户怎么开口的多样性不够,Agent 只见过 11 种说法;后者说明定位发票这一步在评测集上几乎不会失败(按金额找就行),而真实客户会记错月份、只说个大概的金额。两者都会让成功率偏高,模拟客户就是为了补这两处。

</details>

3. 「记性不好」的人设为什么不能代表真实客户的记错?

<details><summary>答案</summary>

实测 12 条里月份全部说错,而且几乎总是往前错一个月;金额则因场景而异(S019 的月份 8 次全是 9)。这是模型对「记错一点」的一种固定理解,真实客户可能前后都错、记成账单日、只说个大概。想测得均匀,可以把怎么记错写成确定性规则,让模型只负责措辞。

</details>

4. 同一条客服回复,宽松诉求追问 8/48,人设诉求追问 26/48。这说明什么?反过来追问率 100% 一定是好事吗?

<details><summary>答案</summary>

说明多轮能力要靠具体的诉求才测得到,宽松的诉求一条像样的回复就能满足,追问不会发生。追问率 100% 不一定是好事:着急老板第一版诉求是「知道多久处理完」,12/12 追问,但 Agent 被规则禁止承诺时间,永远答不上,这个人设就变成了固定噪声。写诉求要保证一个合理的回复有可能满足它。

</details>

5. 线程池里用 LangChain 的计数器,为什么会得到 0?怎么修?

<details><summary>答案</summary>

计数器靠上下文变量(`contextvars`)找到当前该报给谁,线程池新开的线程是空上下文,拿不到主线程的计数器,48 次调用都发生了但没人记账。提交任务时用 `contextvars.copy_context().run` 在上下文拷贝里运行。更重要的是别信 0:调用次数乘以每次大概 token,要能和计数器对上数量级。

</details>

6. 面试题:你要给一个客服 Agent 建评测集,你怎么保证标准答案不会污染 Agent,以及评测集本身没问题?

<details><summary>答案</summary>

污染方面:场景拆成客户可见和标准答案两半,读场景只留一个入口、用白名单,新增字段默认不可见,再用测试逐个场景检查标准答案文本不在可见部分里;模拟客户只拿可见的那一半,诉求挂在人设上不挂在场景上。评测集本身:用脚本数分布(根因、问法多样性),拿标准答案去库里和工具里对账(比如这次发现两个金额比发票还大的场景),并给「参考解必须全过、空 Agent 必须全挂」的自检(明天加上判分器后做)。发现毛病不要默默改数据,留着并标注,报告里分开算。

</details>

## 明天预告

明天是 Day 694 · BillSleuth(十三):判分、跑评测、断点续跑、读报告。今天只准备了原料,Agent 还一次没跑。明天先写判分器:根因、多收金额、发票号、动作、数字幻觉、误冲正、漏冲正,全部用规则,不用模型评审,并把 S023「发票号写了两张算不算对」的口径定下来;再写能断点续跑、每次在独立进程里从干净库副本开始的评测脚本,先跑 5 个场景估单价,再决定今天的预算跑多少个,最后出一份带置信区间的报告。全量 100 个跑不跑得完,明天按花费说话。
