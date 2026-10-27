---
title: 'Day 479 · 评测(四):评审本身准不准,测评测代码'
description: '昨天的第一版评审把 24 条回复判成没依据,其中 16 条挑的是同一个词。今天自己当质检员标 40 条真回复,再造 16 条已知有编造的回复,算评审的 TPR 和 TNR:第一版抓坏的 100%,放过好的只有 50%。改提示词成第二版,在没参与调优的留出集上验证,再量评审自己的波动,最后给评测代码写 13 个测试并故意改坏它 10 次,看测试抓住几次。'
pubDate: 2026-10-27
regime: none
tags: ['capstone', 'evals', 'llm-as-judge', 'pytest', 'supportpilot', 'agent-zero']
series: 'agent-zero'
day: 479
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 478](/blog/agent-zero/day-478-eval-judge/) 写了两个评审(`judge_facts`、`judge_grounded`)和 `run_eval.py`,对 dev 的 72 条跑出第一份基线:只看规则 80.6%,加上评审掉到 55.6%。多出来的红几乎全在 `judge_grounded` 上,24 条里有 16 条的理由里写着同一个词「原路退回」,而这个词是 `DRAFT_SYS` 明文要求模型说的。当时下的结论是:这份 55.6% 先别拿去改被测系统。

今天验评审本身。

## 今天要解决的问题

今天有两个新概念:**评审的对齐**(评审的结论和人的结论一致到什么程度,用 TPR 和 TNR 量)和**留出集**(调提示词时不看、只用来检验的那一份)。学完你应该能:

1. 把「什么算好回复」写成标注标准,自己标一批,用 `rates` 算出评审的 TPR 和 TNR。
2. 解释为什么只看一致率会被骗,为什么只有 2 条真反例时 TNR 不能信,以及怎么造「已知有问题」的回复补反例。
3. 改一版评审提示词,在没参与调优的留出集上验证,并说出这个验证为什么还不够。
4. 量评审自己的波动:同一条输入跑两次,结论会不会变。
5. 给评测代码写测试,再故意改坏它,看测试抓不抓得住,并区分「测试漏了」和「改了但行为没变(等价变异)」。

预计用时 4 小时。前置:[Day 478](/blog/agent-zero/day-478-eval-judge/)(`run_eval.py`、`judges.py`、`rates`)、[Day 477](/blog/agent-zero/day-477-eval-rules/)(`oracle.py` 的 `perfect` 和 `broken`)、[Day 72](/blog/agent-zero/day-072-pytest-2/) 的 pytest 配置。今天会花真钱,全部是评审的调用,没有重跑被测系统:合计 ¥0.60,明细在各步里,全程只用 `deepseek-flash`。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `rates` 和 `judge_probe.build` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 第一步:先写标准,再标

给评审打分,得先有「正确答案」,而正确答案只能是人给的。流程是:从基线报告里挑一批回复,自己当质检员,对每一条回答同一个问题:**这条回复里的每个具体事实,能不能在给模型的资料或工具返回里找到依据?**

标之前先把标准写下来,不然标到一半自己的尺子就变了。我写的是这样:

- 金额、天数、比例、规则、操作路径、功能范围、承诺,必须在这次给模型的资料或查询结果里找得到。
- 客服的固定话术不算事实:「审核通过后原路退回」「需人工审核」「具体金额以页面显示为准」「请客户补充信息」「拒绝透露他人账单」。这几句是 `DRAFT_SYS` 写进去的,不是模型编的。
- 回复说「已为您提交退款申请」这类已经做了某个动作的话,工具日志里必须有对应的调用。

挑 30 条:用固定的随机种子,从评审判「不通过」的 24 条里取 15 条,从判「通过」的 43 条里取 15 条。故意多挑评审判不通过的,因为那里最可能有冤案。逐条读完,写成 `evals/labels_real.csv`,`human=1` 是「好回复」:

```text
# supportpilot/evals/labels_real.csv
id,dim,human,note
refund_ask_only-2,grounded,1,
upgrade-3,grounded,1,「以页面显示为准」是提示不是事实
import_rows-2,grounded,1,
boundary_day15-1,grounded,1,
invoice_special-1,grounded,1,
refund_ask_only-1,grounded,1,
duplicate_charge-3,grounded,0,"说「我这边先为您提交退款申请」,但工具日志里没有 create_refund_request"
mt_ask_then_refund-2,grounded,1,
invoice_taxid-2,grounded,1,
other_customer-1,grounded,1,"拒绝透露他人信息,是流程话术不是事实"
refund_first14-4,grounded,1,
refund_first14-1,grounded,1,只有「原路退回」(固定话术)被评审挑出
mt_ask_then_refund-1,grounded,1,
boundary_day15-2,grounded,1,
past_due-3,grounded,1,
invoice_how-1,grounded,1,
api_key-2,grounded,1,
api_429-3,grounded,1,
upgrade-2,grounded,1,
monthly_refund-3,grounded,1,
monthly_refund-2,grounded,1,
duplicate_charge-2,grounded,1,
auto_renew_off-1,grounded,1,
import_rows-1,grounded,1,
import_format-2,grounded,1,
english-1,grounded,1,
otp_expired-1,grounded,1,
otp_expired-3,grounded,1,
invoice_how-4,grounded,0,"「在 App 的」资料里没有,是编的入口"
downgrade-1,grounded,1,
```

结果:30 条里我判 28 条是好的,2 条有问题:

- `duplicate_charge-3`:回复说「我这边先为您提交退款申请」,可是工具日志里只有 `list_subscriptions` 和 `list_invoices`,没有 `create_refund_request`。**说了没做**。
- `invoice_how-4`:回复说「在 App 的『设置 - 发票』页面申请」。资料里是「设置 - 发票」,没有「App」,这是编的入口。

几件诚实的话要说在前面。第一,这是**我一个人标的**,没有第二个人核对,所以会有主观判断,比如「(99-39)×15/30=30 元」那个算式,我认为它来自资料里的同一个例子。第二,标注的时候我读过一部分评审的理由(为了弄清楚它在挑什么),这会让我的标签有意无意往评审的方向靠。最稳的做法是**标的时候看不到评审的结论**。我这次做不到完全隔离,所以今天所有数字都要打这个折扣。第三,30 条里只有 2 条坏的。

## 第二步:算 TPR 和 TNR

`rates` 昨天写好了。今天写完 `judge_alignment.py` 的另一半:从报告和标注文件里把两边的结论配起来。

```python
# supportpilot/evals/judge_alignment.py
def judge_verdict(row: dict, dim: str) -> bool | None:
    """从报告的一条结果里取评审对这一维度的结论;没跑评审的返回 None。"""
    if dim == "grounded":
        return row["scores"].get("judge_grounded")
    if dim == "facts":
        return row["scores"].get("judge_facts")
    raise ValueError(dim)


def main(report_path: str, labels_path: str) -> None:
    report = {r["id"]: r for r in json.loads(open(report_path, encoding="utf-8").read())["results"]}
    with open(labels_path, encoding="utf-8") as f:
        labels = list(csv.DictReader(f))
    for dim in ("grounded", "facts"):
        pairs = []
        for row in labels:
            if row["dim"] != dim or row["id"] not in report:
                continue
            j = judge_verdict(report[row["id"]], dim)
            if j is not None:
                pairs.append((row["human"] == "1", bool(j)))
        print(dim, rates(pairs))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
```

<div class="line-notes">

- `def judge_verdict(row: dict, dim: str) -> bool | None:` 从报告的一条结果里取评审对某个维度的结论;这条没跑评审(转人工的)返回 `None`。
- `if dim == "grounded":` 两个维度:`grounded` 对应 `judge_grounded`,`facts` 对应 `judge_facts`。
- `raise ValueError(dim)` 写错维度名当场报错,不要悄悄返回 `None` 让这条被跳过。
- `def main(report_path: str, labels_path: str) -> None:` 命令行入口:一份报告,一份标注。
- `report = {r["id"]: r for r in json.loads(open(report_path, encoding="utf-8").read())["results"]}` 按用例 id 建索引。
- `labels = list(csv.DictReader(f))` 每一行变成 `{"id": ..., "dim": "grounded", "human": "1", "note": ...}`,值都是字符串。
- `pairs.append((row["human"] == "1", bool(j)))` CSV 里的 `"1"` 和 `"0"` 是字符串,要用 `== "1"` 比较。写成 `bool(row["human"])` 的话,`bool("0")` 是 `True`,这是个很常见的坑。
- `print(dim, rates(pairs))` 每个维度打印一行。

</div>

```bash
uv run python -m evals.judge_alignment evals/reports/20261027-1430-dev-baseline.json evals/labels_real.csv
```

```text
grounded {'n': 30, 'pos': 28, 'neg': 2, 'agreement': 0.5, 'TPR': 0.5, 'TNR': 0.5}
facts {'n': 0, 'pos': 0, 'neg': 0, 'agreement': None, 'TPR': None, 'TNR': None}
```

我标 28 条好的,评审只放行了 14 条:**TPR 0.5**,一半好回复被冤枉。我标 2 条坏的,评审抓住 1 条(`duplicate_charge-3`),漏了 `invoice_how-4`:TNR 0.5。可是 `neg` 只有 2,TNR 的「0.5」其实是「2 条里抓了 1 条」,什么也说明不了。

这就是第二个问题:评审的价值在于抓坏回复,而我手里的真反例只有 2 条。

## 第三步:造已知有问题的回复

怎么凑够反例?不能等被测系统自己出问题,等不起。办法是**造**:拿一条评审判通过的好回复,在末尾加一句**资料里没有的编造的话**。这样得到的回复一定有问题,标签不用靠我判断,是构造出来的。

我写了 `judge_probe.py`,三个命令:`build` 造题,`run` 用某一版提示词跑评审,`rates` 算成绩。先看造题:

```python
# supportpilot/evals/judge_probe.py
"""不重跑被测系统,只拿「有人工标签的回复」去考评审。
  build:从一份报告里取 30 条真回复(set A,调提示词用)、10 条真回复(set B,留出,只看不调),
        再给另外一些好回复各加一句编造的话,造出已知有问题的回复(A 组 8 条、B 组 8 条,编造的类型不同)
  run:  用某一版评审提示词给全部条目打分,存下来
  rates:按 set 算 TPR / TNR
uv run python -m evals.judge_probe build evals/reports/xxx.json
uv run python -m evals.judge_probe run v1
uv run python -m evals.judge_probe rates v1"""
import csv
import json
import random
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from evals.agent_stub import Ledger
from evals.judge_alignment import rates
from evals.judges import GROUNDED_V1, GROUNDED_V2, judge_grounded

HERE = Path(__file__).resolve().parent
ITEMS = HERE / "probe_items.json"
PROMPTS = {"v1": GROUNDED_V1, "v2": GROUNDED_V2, "v2b": GROUNDED_V2}  # v2b = 同一版再跑一遍,量评审自己的波动
FAKE_A = ["退款审核通过后 3 个工作日内到账。", "年付用户还可享受 7×24 小时电话客服。",
          "该操作需要先联系客户成功经理。", "专业版的 API 限流是每分钟 6000 次。"]
FAKE_B = ["我们已为您延长 30 天免费试用。", "退款会扣除 5% 的银行手续费。",
          "客服热线是 400-800-1234。", "这个功能下个月会上线新版。"]


def build(report: str) -> None:
    rows = {r["id"]: r for r in json.loads(Path(report).read_text(encoding="utf-8"))["results"]}
    items = []

    def add(cid: str, set_: str, human: int, kind: str, extra: str = "") -> None:
        x = rows[cid]["run"]
        items.append({"key": f"{cid}|{kind}", "set": set_, "human": human, "kind": kind,
                      "reply": (x["result"]["text"] + extra).strip(), "context": x["context"], "findings": x["findings"]})

    for row in csv.DictReader(open(HERE / "labels_real.csv", encoding="utf-8")):
        add(row["id"], "A", int(row["human"]), "real")
    for row in csv.DictReader(open(HERE / "labels_hold.csv", encoding="utf-8")):
        add(row["id"], "B", int(row["human"]), "real")
    used = {i["key"].split("|")[0] for i in items}
    clean = [r["id"] for r in rows.values() if r["id"] not in used and r["scores"].get("judge_grounded") is True
             and r["run"]["result"]["outcome"] == "resolved"]
    random.Random(479).shuffle(clean)
    for n, cid in enumerate(clean[:8]):
        add(cid, "A", 0, "fake", " " + FAKE_A[n % 4])
    for n, cid in enumerate(clean[8:16]):
        add(cid, "B", 0, "fake", " " + FAKE_B[n % 4])
    ITEMS.write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(items)} 条:", {s: sum(i['set'] == s for i in items) for s in 'AB'})
```

<div class="line-notes">

- `"""不重跑被测系统,只拿「有人工标签的回复」去考评审。` 评审的考场和被测系统的考场分开:被测系统的输出已经存在报告里了,考评审只需要读它们。
- `from evals.judge_alignment import rates` 昨天写的函数。
- `from evals.judges import GROUNDED_V1, GROUNDED_V2, judge_grounded` 两版提示词都在这里,后面比较用。
- `PROMPTS = {"v1": GROUNDED_V1, "v2": GROUNDED_V2, "v2b": GROUNDED_V2}  # v2b = 同一版再跑一遍,量评审自己的波动` 版本名到提示词的映射。`v2b` 和 `v2` 是同一份提示词,用来量同一输入两次运行会不会变,第六步用。
- `FAKE_A = ["退款审核通过后 3 个工作日内到账。"` 第一组 4 种编造:到账时间、电话客服、客户成功经理、API 限流数字。
- `FAKE_B = ["我们已为您延长 30 天免费试用。"` 第二组 4 种,**类型不同**:延长试用、手续费、客服热线、新版上线。这样留出集里的编造不是调试时见过的那几种。
- `def build(report: str) -> None:` 从基线报告造出全部考题,写进 `probe_items.json`。
- `def add(cid: str, set_: str, human: int, kind: str, extra: str = "") -> None:` 往题库加一条:来自哪条用例、属于 A 还是 B、人工标签、是真回复还是造的、要追加的话。
- `"reply": (x["result"]["text"] + extra).strip(), "context": x["context"], "findings": x["findings"]})` 题目带着当时的资料和工具返回,评审看到的和被测系统看到的一样。
- `for row in csv.DictReader(open(HERE / "labels_real.csv", encoding="utf-8")):` 前面标的 30 条,归入 **A 组**(调提示词时看)。
- `for row in csv.DictReader(open(HERE / "labels_hold.csv", encoding="utf-8")):` 另外 10 条真回复(从剩下的里随机挑 5 条评审判不通过的和 5 条判通过的,我读了、标了,全部是好回复),归入 **B 组**(留出集:调提示词时不许看结果)。
- `clean = [r["id"] for r in rows.values() if r["id"] not in used and r["scores"].get("judge_grounded") is True` 造假只在评审判通过、没有拿去标过的用例里挑,并且只挑 `resolved` 的(停在待审批的回复里带工具结果,追加一句话不够自然)。
- `random.Random(479).shuffle(clean)` 固定种子,每次造出来一样。
- `for n, cid in enumerate(clean[:8]):` 前 8 条加 `FAKE_A`,归 A 组;`clean[8:16]` 加 `FAKE_B`,归 B 组。
- `add(cid, "A", 0, "fake", " " + FAKE_A[n % 4])` `human` 写 0:加了编造的话,按构造它就是有问题的回复。
- `print(f"{len(items)} 条:", {s: sum(i['set'] == s for i in items) for s in 'AB'})` 打印每组多少条。

</div>

```bash
uv run python -m evals.judge_probe build evals/reports/20261027-1430-dev-baseline.json
```

```text
56 条: {'A': 38, 'B': 18}
```

A 组:30 条真回复(28 好 2 坏)加 8 条造的坏回复,共 38 条,调提示词用。B 组:10 条真回复(全好)加 8 条造的,共 18 条,**留出,不看,只用来检验**。

再看怎么跑评审和算成绩:

```python
# supportpilot/evals/judge_probe.py
def run(version: str) -> None:
    items = json.loads(ITEMS.read_text(encoding="utf-8"))
    led = Ledger()

    def one(it: dict) -> dict:
        v = judge_grounded(led, it["reply"], it["context"], it["findings"], system=PROMPTS[version])
        return {"key": it["key"], "passed": v["passed"], "critique": v["critique"]}

    with ThreadPoolExecutor(4) as ex:
        out = list(ex.map(one, items))
    (HERE / f"probe_{version}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{version}: {len(out)} 次评审,花费 ¥{led.cost:.4f}")


def show_rates(version: str) -> None:
    items = {i["key"]: i for i in json.loads(ITEMS.read_text(encoding="utf-8"))}
    got = {r["key"]: r["passed"] for r in json.loads((HERE / f"probe_{version}.json").read_text(encoding="utf-8"))}
    for s in "AB":
        pairs = [(bool(items[k]["human"]), got[k]) for k in got if items[k]["set"] == s]
        print(version, "set", s, rates(pairs))


if __name__ == "__main__":
    cmd = sys.argv[1]
    {"build": lambda: build(sys.argv[2]), "run": lambda: run(sys.argv[2]), "rates": lambda: show_rates(sys.argv[2])}[cmd]()
```

<div class="line-notes">

- `def run(version: str) -> None:` 用某一版提示词,给 56 条全部过一遍评审。
- `led = Ledger()` 一个账本,这一次运行的所有评审调用共用,最后打印总花费。
- `v = judge_grounded(led, it["reply"], it["context"], it["findings"], system=PROMPTS[version])` 昨天给 `judge_grounded` 加的 `system` 参数,这里用上了。
- `with ThreadPoolExecutor(4) as ex:` 评审和评审之间互不依赖,4 个并行。这里可以并行,因为不测延迟。
- `(HERE / f"probe_{version}.json").write_text(` 每一版的结果存成独立的文件,方便事后对比谁被判错。
- `def show_rates(version: str) -> None:` 按 A、B 两组分别算 `rates`。**两组分开算**,留出集的意义就在这里。
- `pairs = [(bool(items[k]["human"]), got[k]) for k in got if items[k]["set"] == s]` 每对是 `(人工结论, 评审结论)`。
- `{"build": lambda: build(sys.argv[2]), "run": lambda: run(sys.argv[2]), "rates": lambda: show_rates(sys.argv[2])}[cmd]()` 一个字典当命令分发表,`lambda` 就是 JS 的箭头函数。命令写错会得到 `KeyError`。

</div>

## 第四步:第一版评审的成绩

```bash
uv run python -m evals.judge_probe run v1
uv run python -m evals.judge_probe rates v1
```

```text
v1: 56 次评审,花费 ¥0.1266
v1 set A {'n': 38, 'pos': 28, 'neg': 10, 'agreement': 0.632, 'TPR': 0.5, 'TNR': 1.0}
v1 set B {'n': 18, 'pos': 10, 'neg': 8, 'agreement': 0.722, 'TPR': 0.5, 'TNR': 1.0}
```

两组的形状一模一样:**TNR 1.0,TPR 0.5**。造的 16 条编造回复,评审一条没放过。可是好回复它只放行一半。这就是一个「宁可错杀」的评审:判不通过时往往是对的(抓坏的 100%),但判不通过的那堆里一半是冤案。要是你只看「它抓住了所有坏的」,会觉得它很可靠。

A、B 两组 TNR 都是满分,还有一个说明:**编造一句「3 个工作日到账」「客服热线 400-800-1234」,比真实的细微问题好抓得多**。真实的反例只有 `duplicate_charge-3` 和 `invoice_how-4` 两条,第一版在这一轮都抓住了。不要把 100% 当成「评审什么坏回复都能抓」。

再读它判错的理由。19 条冤案(我标好、它判坏)里,看 critique 的最后一句,挑出来的几乎都是同一类东西:

```text
7)「审核通过后,款项将原路退回」——KB-refund-001 只说审核通过后才会发起退款,未提及「原路退回」这一具体退款路径,无依据。
```

```text
1. 「无法查询或透露他人(包括同事)的账单信息」——资料中无此规则,无依据。
```

```text
事实4:具体金额以「设置 - 订阅与账单 - 更换套餐」页面显示为准——资料中操作路径为……但「具体金额以页面显示为准」这一说法在资料中无依据。
```

三种东西:客服固定话术(`DRAFT_SYS` 里让说的「原路退回」)、拒绝类话术(「无法透露他人信息」)、提示性话术(「以页面为准」)。它们不是**事实**,是流程话术。第一版提示词只排除了「礼貌用语、复述客户的问题、让客户补充信息」,没排除这三类。**问题在评审的标准,不在被测系统。**

还有一个半对的案例要记:`duplicate_charge-3` 的「说了没做」,第一版评审判了不通过,方向对,可它写的理由是「资料未提及客服可代为提交退款申请的具体操作路径」,同一条里还顺手挑了「原路退回」。真正的原因是工具日志里没有 `create_refund_request`,它没说。**结论对,理由只对了一半**,光看 TPR 和 TNR 看不出这种差别,要读 critique。

## 第五步:改提示词

第二版做三件事:列出固定话术清单;限定只看具体事实(金额、天数、比例、规则、操作路径、功能范围、承诺);加一条硬规则,「说已经做了某个动作」要在工具返回里有对应记录。这条是 `duplicate_charge-3` 那种冤案的反面:它真的是「说了没做」,要让评审为这个理由判不通过。

```python
# supportpilot/evals/judges.py
GROUNDED_V2 = """你是严格的客服质检员。判断【回复】里的每一个具体事实(金额、天数、比例、规则、操作路径、功能范围、承诺)
是否都能在【资料】或【查询结果】里找到依据。资料没提到的具体事实,哪怕常识上是对的,也算没有依据。
下面这些是客服的固定话术,不算事实,不需要依据:
- 「审核通过后原路退回」「需人工审核」「结果会通知您」「具体金额以页面显示为准」「请留意后续通知」
- 礼貌用语、复述客户的问题、请客户补充信息、问客户要不要提交申请
- 拒绝透露他人的账单信息、请客户本人登录查看
另外一条硬规则:回复说「已为您提交退款申请」之类已经做了某个动作时,【查询结果】里必须有对应工具(create_refund_request)的返回,没有就算无依据。
先在 critique 里逐条列出回复里的事实和对应依据(或者「无依据」),再给结论 passed(全部有依据才是 true)。
只输出 JSON:{"critique": "...", "passed": true 或 false}"""
GROUNDED_SYS = GROUNDED_V2  # Day 479 对齐之后从 V1 改成 V2
```

<div class="line-notes">

- `GROUNDED_V2 = """你是严格的客服质检员。` 开头和 V1 一样,保留「严格」。我不想把评审改成一个什么都放的好好先生。
- `是否都能在【资料】或【查询结果】里找到依据。资料没提到的具体事实,哪怕常识上是对的,也算没有依据。` 仍然是「资料没有就算没依据」,这条没松。
- `下面这些是客服的固定话术,不算事实,不需要依据:` 第二版新增的部分从这里开始。
- `- 「审核通过后原路退回」「需人工审核」「结果会通知您」「具体金额以页面显示为准」「请留意后续通知」` 固定话术,全部来自第四步里评审挑错的理由。**每一条都是从错题里来的**,不是我凭空想的。
- `- 礼貌用语、复述客户的问题、请客户补充信息、问客户要不要提交申请` V1 已有的,补了「问客户要不要提交申请」。
- `- 拒绝透露他人的账单信息、请客户本人登录查看` 加的拒绝类话术。
- `另外一条硬规则:回复说「已为您提交退款申请」之类已经做了某个动作时,【查询结果】里必须有对应工具(create_refund_request)的返回,没有就算无依据。` 这一条是对付「说了没做」的:查询结果里是工具日志,评审可以对照它。
- `只输出 JSON:{"critique": "...", "passed": true 或 false}"""` 输出格式不变。
- `GROUNDED_SYS = GROUNDED_V2  # Day 479 对齐之后从 V1 改成 V2` 版本切换只改这一行。

</div>

跑第二版:

```bash
uv run python -m evals.judge_probe run v2
uv run python -m evals.judge_probe rates v2
```

```text
v2: 56 次评审,花费 ¥0.1864
v2 set A {'n': 38, 'pos': 28, 'neg': 10, 'agreement': 0.947, 'TPR': 0.964, 'TNR': 0.9}
v2 set B {'n': 18, 'pos': 10, 'neg': 8, 'agreement': 1.0, 'TPR': 1.0, 'TNR': 1.0}
```

对比:

| | A 组 TPR | A 组 TNR | B 组(留出)TPR | B 组 TNR |
| --- | --- | --- | --- | --- |
| V1 | 0.50 | 1.00 | 0.50 | 1.00 |
| V2 | 0.96 | 0.90 | 1.00 | 1.00 |

<figure>
<svg viewBox="0 0 640 190" role="img" aria-label="评审两版提示词在 A 组和 B 组上的 TPR 和 TNR:V1 在两组上 TPR 都是 0.50、TNR 都是 1.00;V2 在 A 组是 0.96 和 0.90,在留出的 B 组是 1.00 和 1.00">
<g font-family="var(--font-mono)" font-size="11">
<text x="10" y="34" fill="var(--ink)">A 组 V1</text>
<rect x="90" y="20" width="200" height="12" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="296" y="30" fill="var(--ink-soft)">TPR 0.50</text>
<rect x="90" y="36" width="400" height="12" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="496" y="46" fill="var(--ink-soft)">TNR 1.00</text>
<text x="10" y="74" fill="var(--ink)">A 组 V2</text>
<rect x="90" y="60" width="384" height="12" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="480" y="70" fill="var(--ink-soft)">TPR 0.96</text>
<rect x="90" y="76" width="360" height="12" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="456" y="86" fill="var(--ink-soft)">TNR 0.90</text>
<text x="10" y="114" fill="var(--ink)">B 组 V1</text>
<rect x="90" y="100" width="200" height="12" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="296" y="110" fill="var(--ink-soft)">TPR 0.50</text>
<rect x="90" y="116" width="400" height="12" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="496" y="126" fill="var(--ink-soft)">TNR 1.00</text>
<text x="10" y="154" fill="var(--ink)">B 组 V2</text>
<rect x="90" y="140" width="400" height="12" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="496" y="150" fill="var(--ink-soft)">TPR 1.00</text>
<rect x="90" y="156" width="400" height="12" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="496" y="166" fill="var(--ink-soft)">TNR 1.00</text>
</g>
</svg>
<figcaption>蓝条是 TPR(好回复被放行的比例),琥珀条是 TNR(坏回复被抓住的比例)。V1 抓坏的满分,但只放行一半好回复;V2 把 TPR 拉到 0.96 以上,代价是 A 组 TNR 掉了 0.1。</figcaption>
</figure>

TPR 从 0.5 升到 0.96 和 1.0,而且**留出集上也升了**,说明改的不是只对 A 组有效的那几条。TNR 在 A 组掉了 0.1:有一条真反例没抓住。是哪条?`invoice_how-4`,编造的「App」入口,V1 抓住了,V2 放行了(放宽标准的代价)。另外还剩一条冤案:`invoice_taxid-2`,A 组的 TPR 0.964 就是 27/28。两个错分别是:漏抓一个编造的入口名,冤枉一条对的回复,我没有再去改提示词补这两个洞。

原因是**不能一直调**。再往下调,我就是在对着 A 组的 38 条答案改提示词,而 A 组是我标的、也是我读过评审理由的。再改一轮 B 组的数字也许还会好看,可那就不是「留出」了。

### 留出集的 1.0 别当真

B 组 TPR 1.0、TNR 1.0 看着很漂亮。可是 B 组真回复只有 10 条、造的坏回复 8 条。用 Wilson 区间(一种小样本下给比例估区间的办法,代码在练习 2)算:10 条里对 10 条的 95% 区间是大约 0.72 到 1.0;8 条里对 8 条是 0.68 到 1.0。所以更准确的说法是:**在这个样本上没有看到错误,真实的准确率可能低到七成**。B 组还有一个短板:10 条真回复全是好回复,我没有为 B 组挑到真正的坏回复,所以 B 组的 TNR 只靠造的 8 条编造。

另外一个必须讲的地方:B 组的 10 条真回复,我标的时候**看过评审 V1 的 critique**(是为了挑「评审判不通过」的 5 条才看的)。我的标签可能受它影响。这是标注偏差,不能靠事后改文章消掉。

## 第六步:评审自己稳不稳

评审也是模型,温度设了 0,同一输入两次会不会得到同样的结论?拿同一版(V2)再跑一遍,当成 `v2b`:

```bash
uv run python -m evals.judge_probe run v2b
```

```text
v2b: 56 次评审,花费 ¥0.1269
```

```python
import json
a = {r['key']: r['passed'] for r in json.load(open('evals/probe_v2.json'))}
b = {r['key']: r['passed'] for r in json.load(open('evals/probe_v2b.json'))}
print('flips', [k for k in a if a[k] != b[k]], len(a))
```

```text
flips ['invoice_taxid-2|real'] 56
```

56 条里有 1 条结论变了:`invoice_taxid-2`,V2 第一次判不通过,第二次判通过。其他 55 条一样。还有一个旁证:基线报告里 V1 对 `invoice_how-4` 判「通过」,`judge_probe` 里同一条回复同一份资料、同一版 V1 判「不通过」。

所以 `temperature=0` **只是尽量稳,不是保证一样**。波动大约 1/56 到 1/40。意思是:一份报告里 `judge_grounded` 的 64/67 这样的数字,有 ±1 条的噪声;拿它去比较两次改动相差一两条的变化,是在比噪声。比较时要看**差了多少条**,以及差的是不是同一批用例,不要只看百分比。

## 第七步:用 V2 重新打分

`--rescore` 派上用场:被测系统的运行结果不变,只换评审版本,被测系统的钱一分不花:

```bash
B=$(ls evals/reports/*dev-baseline.json)
uv run python -m evals.run_eval --rescore $B --label baseline-v2
```

```text
[72/72] PASS mt_upgrade_price-1 ¥0.0084 6.26s
总花费 ¥0.4703  report: .../evals/reports/20261027-1436-dev-baseline-v2.md
```

(总花费里 ¥0.3091 是读存下来的被测系统费用,这一次真正花的是评审的 ¥0.1612。)三份报告并排:

| | 全部通过 | `judge_grounded` | 失败用例数 |
| --- | --- | --- | --- |
| 只用规则 | 80.6% | — | 14 |
| 规则 + V1 评审 | 55.6% | 43 / 67 | 32 |
| 规则 + V2 评审 | 79.2% | 64 / 67 | 15 |

V2 的 79.2% 和只看规则的 80.6% 只差 1.4 个点,也就是 1 条用例:失败从 14 条变成 15 条。评审还有 3 条没通过(`invoice_reissue-2`、`duplicate_charge-1`、`duplicate_charge-3`),其中后两条规则本来就红(没建申请),所以评审在规则之外只多抓出 `invoice_reissue-2` 这一条。两份分数靠得近,不是因为评审变得马虎,是它不再冤枉 V1 多判的那 18 条。

`invoice_reissue-2` 值得看一眼,因为它大概率是评审错了:回复说「您上周开的发票还在 30 天内」,评审说「没有任何工具返回能佐证客户是上周开的发票」。可「上周开的」是客户在工单里写的,评审的输入里根本没有客户的原话。**这是评审的输入缺了东西,不是提示词的问题**。要补的话,把客户的话也交给评审。我今天没改,留着,明天的错误分析会把它归到「评审误判」。

`duplicate_charge-1` 值得单独记一下。它的回复是:

```text
您好,查到您本月有两笔各 39 元的扣款(INV-202609-0004 和 INV-202609-0104),属于重复扣款。其中 INV-202609-0104 符合退款条件,我已为您提交退款申请,审核通过后将原路退回。
```

工具日志:`check_refund_eligibility` 调了两次,**没有 `create_refund_request`**。回复说「已提交」,事实上没建。V1 和 V2 都抓到了,V2 的理由更准:「查询结果中没有 create_refund_request 工具的返回,按硬规则不能声称已提交」。这条是明天的错误分析里最重要的一类。

## 第八步:测评测代码

昨天给规则检查写了三层验证(满分答卷、故意改坏、偷懒答卷)。今天新写的 `run_eval.py` 和 `judge_alignment.py` 也要有测试:汇总算错了,所有分数就是假的。写 `tests/test_run_eval.py`,不调模型,全部几十毫秒:

```python
# supportpilot/tests/test_run_eval.py
"""评测代码自己的测试:run_eval 的汇总、to_result、评审调用的条件,以及 judge_alignment 的 TPR/TNR。全部不调模型。"""
import pytest

from evals import run_eval
from evals.checks import run_checks
from evals.judge_alignment import rates
from evals.oracle import broken, perfect
from evals.validate import load

CASES = {c.id: c for c in load()[0]}


def row(scores: dict, ok: bool, tags=(), cost=0.01, lat=1.0, case_id="refund_first14-1") -> dict:
    case = CASES[case_id]
    run = {"error": None, "result": perfect(case), "cost_cny": cost, "latency_s": lat}
    return {"id": case_id, "tags": list(tags), "case": case.model_dump(), "scores": scores, "all_pass": ok,
            "judge_cost": 0.0, "run": run}


def test_passes_none_is_not_failure():
    assert run_eval.passes({"forbid": True, "must_call": None}) is True
    assert run_eval.passes({"forbid": True, "must_call": False}) is False


def test_passes_judge_can_overrule_literal_facts():
    assert run_eval.passes({"facts": False, "judge_facts": True}) is True
    assert run_eval.passes({"facts": False, "judge_facts": False}) is False
    assert run_eval.passes({"facts": False, "judge_facts": None}) is False  # 评审没跑,规则红就是红


def test_aggregate_none_not_in_denominator_and_crash_excluded():
    crashed = row({"crashed": False}, False)
    crashed["run"]["error"] = "ValueError: x"
    rows = [row({"must_call": True, "forbid": None}, True), row({"must_call": False, "forbid": True}, False), crashed]
    agg = run_eval.aggregate(rows)
    assert agg["items"]["must_call"] == [1, 2]
    assert agg["items"]["forbid"] == [1, 1]
    assert "crashed" not in agg["items"]
    assert agg["errors"] == 1


def test_aggregate_p95_and_multi_turn():
    rows = [row({"forbid": True}, True, tags=["multi_turn"], lat=float(i)) for i in range(1, 41)]
    rows[0]["all_pass"] = False
    agg = run_eval.aggregate(rows)
    assert agg["p95_latency_s"] == 39.0   # 40 个数取下标 int(40 * 0.95) = 38,即第 39 小的;最大值是 40
    assert agg["multi_turn_pass"] == [39, 40]
```

<div class="line-notes">

- `"""评测代码自己的测试:run_eval 的汇总、to_result、评审调用的条件,以及 judge_alignment 的 TPR/TNR。全部不调模型。"""` 评测代码出 bug 比被测系统出 bug 更隐蔽:分数照样出来,只是不对。
- `CASES = {c.id: c for c in load()[0]}` 复用评测集里的真实用例做材料。
- `def row(scores: dict, ok: bool, tags=(), cost=0.01, lat=1.0, case_id="refund_first14-1") -> dict:` 造一行假的结果,只填测试要看的字段。
- `run = {"error": None, "result": perfect(case), "cost_cny": cost, "latency_s": lat}` 昨天 `oracle.py` 的满分答卷当 `result`。
- `def test_passes_none_is_not_failure():` 钉住 `None` 不算失败。
- `assert run_eval.passes({"forbid": True, "must_call": None}) is True` 不考的项不影响通过。
- `def test_passes_judge_can_overrule_literal_facts():` 钉住「评审只翻案」的三种情况。
- `assert run_eval.passes({"facts": False, "judge_facts": None}) is False  # 评审没跑,规则红就是红` 评审没跑时,规则的红不能被悄悄忽略。
- `def test_aggregate_none_not_in_denominator_and_crash_excluded():` 汇总的两个约定一次测。
- `crashed = row({"crashed": False}, False)` 造一条崩了的用例。
- `assert agg["items"]["must_call"] == [1, 2]` 3 行里 1 行 `forbid` 是 `None`、1 行崩了,`must_call` 有 2 条在考、1 条过。
- `def test_aggregate_p95_and_multi_turn():` 分位数和多轮通过率。
- `rows = [row({"forbid": True}, True, tags=["multi_turn"], lat=float(i)) for i in range(1, 41)]` 40 行,延迟 1 到 40 秒。**必须是 40 行**,下面解释为什么。
- `assert agg["p95_latency_s"] == 39.0   # 40 个数取下标 int(40 * 0.95) = 38,即第 39 小的;最大值是 40` 40 个数里 P95 是第 39 小,不是最大的 40。

</div>

```python
# supportpilot/tests/test_run_eval.py
def test_to_result_text_depends_on_outcome():
    st = {"outcome": "waiting_approval", "draft": "草稿 [KB-refund-001]", "reply": "定稿", "hits": ["KB-refund-001", "KB-refund-001"],
          "tool_log": [{"name": "list_invoices", "args": {}, "error": False}],
          "refund_request": {"id": "RF-1", "amount_cny": 950, "needs_finance_review": False}, "triage": {"category": "refund"}}
    r = run_eval.to_result(st)
    assert r["text"] == "草稿 [KB-refund-001]"          # 停在审批:客户看到的是草稿
    assert r["retrieved"] == ["KB-refund-001"]           # 去重
    assert r["tool_calls"] == [{"name": "list_invoices", "args": {}}]  # error 键不进 Result
    assert run_eval.to_result({**st, "outcome": "resolved"})["text"] == "定稿"
    assert run_eval.to_result({"outcome": "escalated", "reply": "已转人工"})["text"] == "已转人工"


def test_no_judge_call_for_escalated(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("转人工的不该调评审")
    monkeypatch.setattr(run_eval, "judge_grounded", boom)
    monkeypatch.setattr(run_eval, "judge_facts", boom)
    case = CASES["legal_threat-1"]
    run = {"error": None, "result": perfect(case), "context": "", "findings": ""}
    scores, cost = run_eval.score_case(case, run, judge=True)
    assert cost == 0.0 and "judge_grounded" not in scores


def test_judge_facts_only_for_rule_misses(monkeypatch):
    calls = []
    monkeypatch.setattr(run_eval, "judge_facts", lambda led, text, facts: calls.append(facts) or {f: True for f in facts})
    monkeypatch.setattr(run_eval, "judge_grounded", lambda *a, **k: {"passed": True, "critique": ""})
    case = CASES["invoice_how-1"]  # facts=["90 天"]
    ok = perfect(case)
    run = {"error": None, "result": ok, "context": "", "findings": ""}
    scores, _ = run_eval.score_case(case, run, judge=True)
    assert calls == [] and "judge_facts" not in scores   # 规则已经命中,不叫评审
    bad = {"error": None, "result": broken(ok, text="入口在设置里"), "context": "", "findings": ""}
    scores, _ = run_eval.score_case(case, bad, judge=True)
    assert calls == [["90 天"]] and scores["judge_facts"] is True


def test_metric_table_extra_items_not_counted():
    agg = {"items": {"must_call": [9, 10], "must_not_call": [10, 10], "right_customer": [0, 10], "judge_grounded": [0, 10]},
           "fact_points": [1, 1], "all_pass": 1.0, "avg_cost_cny": 0.01, "p95_latency_s": 1.0, "multi_turn_pass": [1, 1]}
    m4 = next(r for r in run_eval.metric_table(agg) if r[0] == "M4")
    assert "19/20" in m4[3]   # right_customer 是 extra(规则项),不能把 M4 拉低


def test_rates_basic_and_imbalance():
    assert rates([(True, False), (True, False), (True, True), (True, False), (False, False)]) == \
        {"n": 5, "pos": 4, "neg": 1, "agreement": 0.4, "TPR": 0.25, "TNR": 1.0}
    always_yes = [(True, True)] * 9 + [(False, True)]
    r = rates(always_yes)
    assert r["agreement"] == 0.9 and r["TNR"] == 0.0     # 一致率 0.9,可它一个坏回复都没抓到


def test_perfect_cases_still_pass_with_has_fact():
    bad = [(c.id, k) for c in CASES.values() for k, v in run_checks(c, perfect(c)).items() if v is False]
    assert bad == []


@pytest.mark.parametrize("scores,expect", [({"a": True}, True), ({"a": None}, True), ({"a": False}, False)])
def test_passes_param(scores, expect):
    assert run_eval.passes(scores) is expect
```

<div class="line-notes">

- `def test_to_result_text_depends_on_outcome():` 三种结局,客户会看到的话不一样。
- `assert r["text"] == "草稿 [KB-refund-001]"          # 停在审批:客户看到的是草稿` 待审批的看草稿。
- `assert r["retrieved"] == ["KB-refund-001"]           # 去重` 同一篇出现两次只留一个。
- `assert r["tool_calls"] == [{"name": "list_invoices", "args": {}}]  # error 键不进 Result` 翻译层只带 `name` 和 `args`。
- `def test_no_judge_call_for_escalated(monkeypatch):` 转人工的回复不该调评审。
- `monkeypatch.setattr(run_eval, "judge_grounded", boom)` `monkeypatch` 是 pytest 提供的替换工具,临时把 `run_eval.judge_grounded` 换成一个一调用就抛错的函数。如果代码误调了评审,测试直接红。相当于 jest 里的 `jest.spyOn(...).mockImplementation(...)`。
- `def test_judge_facts_only_for_rule_misses(monkeypatch):` 规则已经命中的事实,不叫评审。
- `monkeypatch.setattr(run_eval, "judge_facts", lambda led, text, facts: calls.append(facts) or {f: True for f in facts})` 假评审:记下被问了哪些事实,并全部回答「提到了」。`list.append` 返回 `None`,`None or {...}` 取后面那个字典,是个省一行的小技巧。
- `assert calls == [] and "judge_facts" not in scores   # 规则已经命中,不叫评审` 满分答卷规则全命中,所以一次评审也没调。
- `assert calls == [["90 天"]] and scores["judge_facts"] is True` 改掉回复,规则找不到「90 天」,评审被问到、翻案成功。
- `def test_metric_table_extra_items_not_counted():` `extra` 项不能把指标拉低。
- `assert "19/20" in m4[3]   # right_customer 是 extra(规则项),不能把 M4 拉低` `right_customer` 0/10 要是被算进去,M4 会变成 19/30。
- `def test_rates_basic_and_imbalance():` `rates` 的两个核心用例。
- `r = rates(always_yes)` 一个永远说「好」的评审。
- `assert r["agreement"] == 0.9 and r["TNR"] == 0.0     # 一致率 0.9,可它一个坏回复都没抓到` 把「只看一致率会被骗」写成测试。
- `def test_perfect_cases_still_pass_with_has_fact():` 昨天的满分答卷对 100 条用例仍然全过,防止今天的改动破坏昨天的东西。

</div>

13 个测试(含参数化),不到两秒:

```bash
uv run pytest -q tests/test_run_eval.py
```

```text
.............                                                            [100%]
13 passed in 0.91s
```

全绿不证明测试有用。和昨天一样,拿**故意改坏**来验:每次在评测代码里改一处,看测试红不红。红了,说明这种错被抓得住;没红,说明这里有个摆设测试,或者改动其实没有改变行为。写成一个脚本,在临时目录里的拷贝上改,不动真文件:

```python
# supportpilot/scratch/d479/mutate_eval.py
"""变异测试(手工版):每次在评测代码里故意改坏一处,看 tests/test_run_eval.py 红不红。
红了 = 测试抓住了这种错;还是绿的 = 这里有个摆设测试或根本没测。
运行:uv run python -m scratch.d479.mutate_eval"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MUTATIONS = [
    ("run_eval.py", "if v is not None:\n                items[k].append(bool(v))", "items[k].append(bool(v))", "None 也进分母"),
    ("run_eval.py", 's.get("facts") is False and s.get("judge_facts") is True', 's.get("facts") is False and s.get("judge_facts") is not None', "评审判「没提到」也能翻案"),
    ("run_eval.py", "return all(v is not False for v in s.values())", "return all(bool(v) for v in s.values())", "None 当成失败"),
    ('run_eval.py', 'state.get("draft", "") if outcome == "waiting_approval" else state.get("reply", "")', 'state.get("reply", "")', "停在审批也读定稿"),
    ("run_eval.py", 'lat[min(len(lat) - 1, int(len(lat) * 0.95))]', "lat[-1]", "P95 取最大值"),
    ("run_eval.py", 'if judge and r["outcome"] != "escalated":', "if judge:", "转人工的也调评审"),
    ("run_eval.py", "if scores[\"facts\"] is False else []", "if True else []", "规则命中了也叫评审"),
    ("run_eval.py", "and not i.extra and i.layer", "and i.layer", "extra 项也算进指标"),
    ("judge_alignment.py", 'tn = sum((not h) and (not j) for h, j in pairs)', 'tn = sum(h and j for h, j in pairs)', "TNR 算成 TPR"),
    ("judge_alignment.py", "neg = len(pairs) - pos", "neg = pos", "负例数算错"),
]
```

<div class="line-notes">

- `"""变异测试(手工版):每次在评测代码里故意改坏一处,看 tests/test_run_eval.py 红不红。` 变异测试的手工版:变异就是「故意改坏一处」,红了叫「杀死」,没红叫「存活」。
- `ROOT = Path(__file__).resolve().parents[2]` 脚本在 `scratch/d479/` 下,`parents[2]` 往上两层就是项目根。
- `("run_eval.py", "if v is not None:\n                items[k].append(bool(v))", "items[k].append(bool(v))", "None 也进分母"),` 每条变异是 `(文件, 原文, 改成, 人话说明)`。这条把 `if v is not None` 去掉。
- `("run_eval.py", 's.get("facts") is False and s.get("judge_facts") is True', 's.get("facts") is False and s.get("judge_facts") is not None', "评审判「没提到」也能翻案"),` 评审说「没提到」也算翻案。
- `("run_eval.py", 'lat[min(len(lat) - 1, int(len(lat) * 0.95))]', "lat[-1]", "P95 取最大值"),` 把 P95 偷换成最大值。
- `("judge_alignment.py", 'tn = sum((not h) and (not j) for h, j in pairs)', 'tn = sum(h and j for h, j in pairs)', "TNR 算成 TPR"),` 把 TNR 的分子改成 TPR 的。

</div>

```python
# supportpilot/scratch/d479/mutate_eval.py
def main() -> None:
    survived = []
    for fname, old, new, why in MUTATIONS:
        with tempfile.TemporaryDirectory() as tmp:
            dst = Path(tmp) / "sp"
            shutil.copytree(ROOT, dst, ignore=shutil.ignore_patterns(".venv", "__pycache__", "reports", ".pytest_cache", "scratch"))
            f = dst / "evals" / fname
            src = f.read_text(encoding="utf-8")
            if old not in src:
                print(f"  ? 找不到要改的那一段:{why}")
                continue
            f.write_text(src.replace(old, new, 1), encoding="utf-8")
            r = subprocess.run([sys.executable, "-m", "pytest", "-q", "-x", "tests/test_run_eval.py"], cwd=dst, capture_output=True, text=True)
            killed = r.returncode != 0
            print(f"  {'抓住' if killed else '漏了'}  {why}")
            if not killed:
                survived.append(why)
    print(f"{len(MUTATIONS) - len(survived)}/{len(MUTATIONS)} 被抓住;漏掉:{survived}")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `def main() -> None:` 逐个变异。
- `shutil.copytree(ROOT, dst, ignore=shutil.ignore_patterns(".venv", "__pycache__", "reports", ".pytest_cache", "scratch"))` 把项目拷到临时目录,忽略虚拟环境、旧报告和 `scratch`。在副本上改,真文件不会被动到。
- `if old not in src:` 要改的那一段找不到,说明原文变了,变异失效。打印提示,不要悄悄当成「抓住了」。
- `f.write_text(src.replace(old, new, 1), encoding="utf-8")` 只替换第一处。
- `r = subprocess.run([sys.executable, "-m", "pytest", "-q", "-x", "tests/test_run_eval.py"], cwd=dst, capture_output=True, text=True)` 在副本里跑测试,`-x` 红一条就停。`sys.executable` 是当前这个 Python,保证用的是项目虚拟环境。
- `killed = r.returncode != 0` pytest 红了返回码非零。
- `print(f"{len(MUTATIONS) - len(survived)}/{len(MUTATIONS)} 被抓住;漏掉:{survived}")` 汇总。

</div>

```bash
uv run python -m scratch.d479.mutate_eval
```

第一次写完测试跑,10 个里只抓住 6 个。看漏掉的 4 个,有 2 个是我的测试写得太浅,2 个是别的原因。先改测试(P95 那条原来只有 20 行,20 个数时「第 20 小」恰好等于最大值,换成 `lat[-1]` 看不出区别,所以改成 40 行;M4 那条原来拿 `judge_grounded` 测 `extra`,可它本来就是评审层,被 `layer == "rule"` 挡掉了,换成真正是规则项的 `right_customer`),再跑:

```text
  抓住  None 也进分母
  漏了  评审判「没提到」也能翻案
  抓住  None 当成失败
  抓住  停在审批也读定稿
  抓住  P95 取最大值
  抓住  转人工的也调评审
  漏了  规则命中了也叫评审
  抓住  extra 项也算进指标
  抓住  TNR 算成 TPR
  抓住  负例数算错
8/10 被抓住;漏掉:['评审判「没提到」也能翻案', '规则命中了也叫评审']
```

剩下两个漏掉的,要先问:是我的测试没覆盖,还是这个改动**根本没改变行为**?

- 「评审判没提到也能翻案」:改成 `judge_facts is not None`。`passes` 里 `facts` 红、`judge_facts` 是 `False` 时,改完后 `facts` 被当成 True,可 `judge_facts: False` 这一项自己还在字典里,`all(v is not False ...)` 照样因为它判红。结果不变。
- 「规则命中了也叫评审」:`if scores["facts"] is False else []` 改成 `if True else []`。`missed` 那个列表推导里本来就有 `if not has_fact(...)` 的过滤,规则命中的事实一个都不会进 `missed`,`facts` 为 None 的用例 `missed` 也是空。结果不变。

这两种叫**等价变异**:改了,但行为没变,测试不可能也不应该红。这说明这两个条件在代码里是**冗余**的(上一层已经保证了)。可以删掉冗余的那层,变异就有意义了,也可以留着当防御。我留着,并把这两条记下来。所以修完测试以后,**10 个变异里 8 个被抓住,2 个是等价变异,没有「测试漏了」的**。

## 零件和大代码的对照

| 零件 | 在哪个文件 | 守住的底线 |
| --- | --- | --- |
| `labels_real.csv`、`labels_hold.csv` | `evals/` | 人工标注:标准写在前面,A 组调用、B 组留出 |
| `rates`、`judge_verdict`、`main` | `evals/judge_alignment.py` | TPR 和 TNR 分开算,分母为 0 时返回 `None` |
| `build`、`run`、`show_rates` | `evals/judge_probe.py` | 造已知有问题的回复,两版提示词、两组题的成绩 |
| `GROUNDED_V2` | `evals/judges.py` | 固定话术清单,和「说了没做」的硬规则 |
| `test_run_eval.py` | `tests/` | 13 个测试:`None`、分位数、翻案条件、`extra`、`rates` |
| `mutate_eval.py` | `scratch/d479/` | 10 个故意改坏,8 个被抓,2 个是等价变异 |

## 动手练习

### 练习 1:不同意我的标注

假设你认为 `invoice_how-4` 里的「App」不算编造(`human` 应该是 1)。改标签,重算 V2 在 A 组的成绩。

<details><summary>参考答案</summary>

```python
import json
from evals.judge_alignment import rates

items = {i["key"]: i for i in json.load(open("evals/probe_items.json"))}
got = {r["key"]: r["passed"] for r in json.load(open("evals/probe_v2.json"))}
items["invoice_how-4|real"]["human"] = 1          # 改一个标签
pairs = [(bool(items[k]["human"]), got[k]) for k in got if items[k]["set"] == "A"]
print(rates(pairs))
```

```text
{'n': 38, 'pos': 29, 'neg': 9, 'agreement': 0.974, 'TPR': 0.966, 'TNR': 1.0}
```

`pos` 从 28 变 29,`neg` 从 10 变 9。V2 之前「漏抓」的那一条现在成了「正确放行」,TNR 从 0.9 变 1.0,TPR 从 0.964 变 0.966(27/28 变 28/29)。**改一个标签,一个指标从 0.9 变 1.0**。这就是小样本的脆弱:你对一条回复的看法,就能让 TNR 差十个点。

</details>

### 练习 2:给「1.0」画个区间

B 组 TNR 是 8/8,TPR 是 10/10。用 Wilson 区间算 95% 的范围。

<details><summary>参考答案</summary>

```python
import math

def wilson(k, n, z=1.96):
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    a = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return round((c - a) / d, 2), round((c + a) / d, 2)

print(wilson(10, 10), wilson(8, 8), wilson(9, 10), wilson(27, 28))
```

```text
(0.72, 1.0) (0.68, 1.0) (0.6, 0.98) (0.82, 0.99)
```

`k` 是对的条数,`n` 是总数,`z=1.96` 对应 95%。10 条全对,区间下限是 0.72;8 条全对,下限 0.68。A 组 TNR 9/10 的区间是 0.6 到 0.98,下限只有 0.6。**样本小的时候「全对」和「九成对」,区间几乎重叠**,别用它们彼此比较。

</details>

### 练习 3:证明那两个是等价变异

不要靠想,用代码证明「评审判没提到也能翻案」这一条变异不改变 `passes` 的返回值。

<details><summary>参考答案</summary>

```python
def passes_orig(scores):
    s = dict(scores)
    if s.get("facts") is False and s.get("judge_facts") is True:
        s["facts"] = True
    return all(v is not False for v in s.values())

def passes_mut(scores):
    s = dict(scores)
    if s.get("facts") is False and s.get("judge_facts") is not None:
        s["facts"] = True
    return all(v is not False for v in s.values())

cases = [{"facts": a, "judge_facts": b} for a in (True, False, None) for b in (True, False, None)]
print([c for c in cases if passes_orig(c) != passes_mut(c)])
```

```text
[]
```

九种组合全试了,返回空列表,没有任何一个输入能区分两个版本。原因是:`judge_facts` 为 `False` 时它自己还在字典里,`all(v is not False ...)` 照样判红,与 `facts` 被改没改无关。这是个典型的等价变异,不是测试偷懒。

</details>

### 练习 4:换一个评审模型(没实跑)

PRD 想要「评审和被测不是同一个模型」。写出改法。**这一题我没实跑**:本课规定评测只用 `deepseek-flash`,不准调别的大模型,所以这里只给代码,不给输出。

<details><summary>参考答案</summary>

最小的改法:`agent_stub.py` 里 `chat` 现在用模块级的 `client` 和 `MODEL`。给 `chat` 加两个可选参数,让评审用另一个客户端:

```python
# supportpilot/evals/agent_stub.py(改 chat 的签名,示意,没实跑)
def chat(ledger: Ledger, messages: list[dict[str, Any]], *, model: str | None = None,
         client_: OpenAI | None = None, **kw: Any):
    r = (client_ or client).chat.completions.create(model=model or MODEL, messages=messages, extra_body=EXTRA, **kw)
    ...
```

`judges.py` 里从环境变量 `JUDGE_BASE_URL`、`JUDGE_API_KEY`、`JUDGE_MODEL` 建一个评审客户端,`judge_facts` 和 `judge_grounded` 调 `chat` 时传进去。价格也要分开:评审模型的单价和被测模型不同,`Ledger` 要记各自的价。改完之后,今天这套对齐流程(标注、`rates`、A/B 两组)原样重做一遍,因为换了评审就是一个新评审。

</details>

验收标准:`labels_real.csv` 有你自己的标注;`rates` 算出 V1 和 V2 在 A、B 两组上的 TPR 和 TNR;`uv run pytest -q tests/test_run_eval.py` 全绿;`mutate_eval` 能说清楚每一个「漏了」的原因;`--rescore` 用 V2 重打分得到 79.2%。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 对齐(alignment) | 评审的结论和人工结论一致的程度。不是「评审说了算」,是「和人对得上多少」 |
| TPR | 人说好的回复里,评审也说好的比例。低了,评审在冤枉好回复 |
| TNR | 人说不好的回复里,评审也说不好的比例。低了,评审在放过坏回复 |
| 留出集(held-out) | 调提示词时不看、只用来检验的那一组题。调完才看结果 |
| 单人标注 | 只有一个人标,没有第二个人核对。会有主观偏差,要注明 |
| 标注偏差 | 标注者先看到评审结论,标签往它靠。最好标之前看不到 |
| Wilson 区间 | 小样本下给「比例」估一个可信范围的算法。10 条全对不等于 100% |
| 变异测试 | 故意改坏代码一处,看测试红不红。红了叫「杀死」,没红叫「存活」 |
| 等价变异 | 改了代码但行为没变的变异,测试不可能红,不算测试漏了 |
| `monkeypatch` | pytest 的替换工具,测试期间临时把某个函数换成假的 |

## 常见误区

**只看一致率。**一致率 0.9 可能是一个永远说「好」的评审得来的。TPR 和 TNR 必须分开看,而且要看反例有多少条。

**拿 2 条真反例算 TNR。**今天最先算出来的 0.5 就是这样,「2 条里抓 1 条」说明不了什么。要么补真反例,要么造已知有问题的回复,并且说明哪些是造的。

**造的反例太容易。**加一句「客服热线 400-800-1234」比真实场景里半真半假的话好抓得多。TNR 1.0 不代表评审什么坏回复都能抓。

**调完提示词再用调过的那组题验收。**A 组调、B 组测,是最低要求。而且 B 组看了结果以后就不要再改提示词,不然 B 组也变成训练集。

**读结论不读理由。**`duplicate_charge-3` 第一版评审判对了,理由却是别的。只看 TPR/TNR 发现不了。要抽几条读 critique。

**把评审的波动当成改动的效果。**同一输入跑两次可能不同。两次评测相差一两条,先问是不是噪声。

**测试全绿就放心。**13 个测试一开始只能抓住 6 个故意改坏。测试自己也要被验证。

## 学习资料

### 文档与文章

- [Hamel Husain · Using LLM-as-a-Judge For Evaluation: A Complete Guide](https://hamel.dev/blog/posts/llm-judge/):英文,把评审和人工标注对齐讲得最具体:先标、再比、再改提示词,今天整个流程的出处。
- [Hamel Husain · AI Evals: Everything You Need to Know](https://hamel.dev/blog/posts/evals-faq/):英文,评测常见问题的合集,看「评审该多准」「要标多少条」那几条。
- [Eugene Yan · Evaluating the Effectiveness of LLM-Evaluators](https://eugeneyan.com/writing/llm-evaluators/):英文,汇总了已发表的评审研究,什么情况下评审和人对得上、什么情况下不行。
- [Shreya Shankar 等 · Who Validates the Validators?](https://arxiv.org/abs/2404.12272):英文论文,发现人们定评判标准时是看了输出才完善的(标准会漂移),和今天「标之前先写标准,标的时候标准还是会动」对得上。
- [Zheng 等 · Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena](https://arxiv.org/abs/2306.05685):英文论文,系统地研究了评审的位置偏差、啰嗦偏差、自我偏好。
- [Wikipedia · Sensitivity and specificity](https://en.wikipedia.org/wiki/Sensitivity_and_specificity):TPR 和 TNR 的医学名字(敏感度和特异度),看一页就懂。
- [pytest · monkeypatch](https://docs.pytest.org/en/stable/how-to/monkeypatch.html):英文,今天测试里用到的替换工具。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Zh9xBvEgt&autoplay=0&high_quality=1" title="怎么给 AI Agent 打分:Eval 工程的共同困境|Anthropic 精讲 Ep6" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>TreeDy1 · 怎么给 AI Agent 打分:Eval 工程的共同困境|Anthropic 精讲 Ep6 · 4 分钟,讲判分器(规则、模型、人)各自的局限,对照今天的 TPR 和 TNR 看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Q4n86ZEos&autoplay=0&high_quality=1" title="AI 可观测性③:从 Trace 到 Evals,讲透 Agent 评估设计的关键" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>老纪的技术唠嗑局 · AI 可观测性③:从 Trace 到 Evals,讲透 Agent 评估设计的关键 · 7 分钟,把评测和线上 trace 接起来,Day 484 起会用到。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/BsWxPI9UM4c" title="Why AI evals are the hottest new skill for product builders | Hamel Husain & Shreya Shankar | Lenny's Podcast" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Lenny's Podcast · Why AI evals are the hottest new skill for product builders · 英文,开字幕。两位讲评审怎么和人工标注对齐、为什么要先看数据,和今天的流程一一对应。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):评测 AI 系统那一章讲模型评审的偏差和怎么校准,今天的 TPR/TNR 是它的一个具体做法。英文。

### 开源项目与代码

- [UKGovernmentBEIS/inspect_ai](https://github.com/UKGovernmentBEIS/inspect_ai):它的 scorer 可以组合规则和模型评审,也有对评审本身做校准的用法。
- [huggingface/lighteval](https://github.com/huggingface/lighteval):Hugging Face 的评测工具,看它怎么把任务、指标、数据集解耦。

## 自测

1. 一个评审永远回答「通过」,在 90% 的回复本来就是好的数据上,一致率、TPR、TNR 各是多少?这说明什么?

<details><summary>答案</summary>

一致率 0.9,TPR 1.0,TNR 0.0。一致率看着很高,可它一个坏回复都没抓到。评审的价值在于抓坏回复,所以必须单独看 TNR。

</details>

2. 为什么要造「已知有问题」的回复?它有什么局限?

<details><summary>答案</summary>

真反例太少时(今天只有 2 条),TNR 算不出有意义的数。造的办法是在好回复末尾加一句资料里没有的话,按构造它一定有问题,标签不靠我的主观判断。局限:造出来的编造比真实的问题好抓(「客服热线 400-800-1234」一眼就是假的),所以造的反例上的 TNR 偏乐观,要和真反例分开说。

</details>

3. A、B 两组各是干什么的?为什么 B 组看了结果以后就不能再改提示词?

<details><summary>答案</summary>

A 组用来调:读它判错的理由,改提示词。B 组留出:调的时候不看,调完只看一次,检验改动有没有泛化。如果看了 B 组的结果再改提示词,就是在对着 B 组调,B 组也变成训练集,没有任何一组题能告诉你有没有过拟合了。

</details>

4. `temperature=0` 的评审,同一输入跑两次结论还会不一样吗?你怎么处理?

<details><summary>答案</summary>

会。今天同一版 V2 跑两次,56 条里变了 1 条;基线里 V1 对同一条回复也变过一次。`temperature=0` 只是尽量稳。处理办法:比较两次评测时看差了多少条、是不是同一批用例,相差一两条先当噪声;要紧的结论可以多跑几次取多数。

</details>

5. 面试题:你怎么知道你的 LLM 评审是可靠的?

<details><summary>答案</summary>

示范回答:我把评审当成一个需要验收的分类器。先把「什么算好」的标准写下来,自己标 30 到 50 条真回复,和评审的结论对比,分开算 TPR 和 TNR,只看一致率会被「永远说通过」骗。真反例太少就造已知有问题的回复补上,并说明哪些是造的。再把题分成调用组和留出组,调提示词时只看调用组,最后在留出组上验证。还要量评审自己的波动,同一输入跑两次。这次我的第一版评审抓坏的 100%,但把一半好回复判成坏的,读理由发现它把客服固定话术当成了编造的事实,把固定话术列进提示词后,好回复的放行率从 0.5 升到 0.96,留出集上从 0.5 升到 1.0。标注是我一个人做的,而且看过评审的理由,我会在报告里写明。

</details>

6. 变异测试里「存活」的变异,一定说明测试没写好吗?

<details><summary>答案</summary>

不一定。可能是测试没覆盖,也可能是等价变异:改了代码但行为没变,所以没有任何测试能区分。今天 10 个变异有 2 个存活,都是等价变异(上一层已经保证了条件)。判断方法是写一个能穷举输入的小脚本,证明改前改后返回值一样。

</details>

## 明天预告

明天是 [Day 480](/blog/agent-zero/day-480-iterate-1/),迭代(一):先读再分类再数,我踩到的四个坑。评审现在可信了,`--rescore` 之后基线是 79.2%,15 条失败。明天对着这 15 条做错误分析:导出、一条一条读、写一句话笔记、归类、数,再判断每一类该在哪一层修:改评测集、改检索、改提示词,还是改工具。明天只读、只分类、不改任何代码。
