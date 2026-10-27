---
title: 'Day 551 · 大规模评审(一):校准集差评太少,校正后的通过率带区间'
description: '请模型当裁判,裁判会判错,而且错得很偏心:今天造了 480 条有标准答案的退款回复,两个裁判一个报 100%、一个报 80%,真实通过率是 69.8%。用一小份人工标注当校准集,估出裁判的 TPR 和 TNR,把报出来的通过率校正回去,再用 bootstrap 把校准集自己的误差也算进区间。差评样本随机抽只有 34 条,差评多抽能有 50 条,区间窄了三个点;校准集里没有的工单类型,校正会悄悄失效。'
pubDate: 2026-10-27
regime: none
tags: ['eval', 'llm-as-judge', 'calibration', 'confidence-interval', 'python', 'agent-zero']
series: 'agent-zero'
day: 551
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 550](/blog/agent-zero/day-550-eval-stats-4/) 把评测统计学四天的零件拼成了 `compare_report.py`,最后一条规矩是:数字后面一定带区间,区间跨过 0 一定带上 MDE。可那四天有一个共同的前提:每条用例的「通过」是**代码**判的,准确无误,不确定性只来自「用例抽样」和「Agent 自己在抖」。

[Day 546](/blog/agent-zero/day-546-eval-process/) 量裁判单价的时候已经漏过一次口风:40 条回复里,LLM 裁判和代码判题有 11 条不一致,错的是裁判,因为它没看到发票数据。[Day 358](/blog/agent-zero/day-358-llm-judge-3/) 给过一个修正公式,用评分器的 TPR 和 TNR 把它报出来的通过率修回去,当时的例子是 80% 修成 87%,我还补了一句「这个修正值本身也带着不小的误差」,因为那次 fail 样本只有 5 条。今天回头把这句话说清楚:这个误差有多大、怎么算、怎么压小。

## 今天要解决的问题

SupportPilot 上线以后,每天几千张工单,不可能人人看一遍,只能让裁判看,再从裁判的结果里抽一小份请专家复核。这时候「通过率」这个数字就有两层不确定性:一层是用例抽样(Day 547 那些),另一层是**裁判自己判得准不准**。学完今天你应该能做到:

1. 造一批带标准答案的回复,用 `deepseek-flash` 当裁判跑两个不同的 prompt,看到一个事实:裁判的偏心可以大到「全判通过」,这时候根本没法校正;给它发票数据以后,才有校正的余地。
2. 用一小份人工标注的**校准集**,算出裁判的 TPR 和 TNR(各带 Wilson 区间),用 Rogan–Gladen 公式把裁判报出来的通过率校正回去,并解释为什么只用 Wilson 画区间是错的。这是今天的第一个新概念:**校准集**,包括它为什么要「差评多抽」。
3. 用 bootstrap 把线上样本和校准集两边的误差一起算进去,给校正后的通过率画区间,这是第二个新概念:**带区间的校正**。
4. 反复抽 300 次,对比「随机抽校准集」和「pass、fail 各抽一半」,看区间宽度和包住率;算出想把 TNR 估到 ±5 个点,需要多少条人判 fail。
5. 说出校正什么时候会悄悄失效:校准集里没有的新类型工单。

预计用时 3.5 小时。实跑花费约 ¥0.69(480 次裁判调用 × 3 种 prompt,外加试跑,算式在文末),其余脚本不调模型。前置:[Day 547](/blog/agent-zero/day-547-eval-stats-1/)(`stats.py` 里的 `wilson_ci`、`fmt_rate`)、[Day 549](/blog/agent-zero/day-549-eval-stats-3/)(bootstrap)、[Day 358](/blog/agent-zero/day-358-llm-judge-3/)(TPR、TNR、修正公式)、[Day 148](/blog/agent-zero/day-148-structured-2/)(JSON 模式)、[Day 135](/blog/agent-zero/day-135-llm-client-1/)(`LLMClient`)。今天要装一个依赖:`uv add numpy`(Day 549 已经装过就不用)。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `rates` 和 `corrected_rate`,再口述「为什么校准集要差评多抽」;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先造一批「知道标准答案」的回复

要研究裁判准不准,手里得有标准答案。真实项目里标准答案来自专家一条条标,一天标不了几百条。为了让每个读者跑出同一份数据,今天换个办法:用代码**造**回复,同时造出标准答案,代码判对错,相当于一位永远不累的专家。这一点要说在前头,下面所有「人工标注」四个字,今天都是这份代码判的标准答案。

造的是 CloudLedger 的重复扣款退款工单。每张工单配一份这位客户的发票清单,有两种:

- **真重复**(kind 是 dup):同一个月、同一个套餐、同一个金额扣了两次。正确的处理是退后一张的全额。
- **不是重复**(nodup):同一个月两张发票,一张是套餐费,一张是加购席位费,金额和项目都不一样。客户以为扣重了,正确的处理是不退款并解释。

回复也有好有坏。真重复的工单有四种回复:退对了(ok_refund)、退款金额错了(wrong_amount)、引用了另一个月的发票(wrong_invoice)、不该拒绝却拒绝了(refuse)。不是重复的工单有两种:解释清楚不退(ok_refuse)、错退了加购费(wrong_refund)。两种里「对」的回复一共约占 70%。

```python
# agent-zero-lab/part10/judge_data.py
"""造一批「退款工单 + 客服回复」,每条带发票数据和代码判的标准答案。Day 551 起评审实验都用它。"""
import json
import random
from pathlib import Path

OUT = Path(__file__).parent / "data" / "judge_pool.json"
MONTHS = ["2026-06", "2026-07", "2026-08", "2026-09"]


def invoice(no: int, month: str, plan: str, amount: int, day: int) -> dict:
    return {"id": f"INV-{no}", "date": f"{month}-{day:02d}", "plan": plan, "amount": amount}


def make_case(i: int, rng: random.Random) -> dict:
    base = rng.choice([199, 299, 468, 599, 888])
    addon = rng.choice([49, 99, 129])
    no = rng.randint(2000, 8000)
    month = rng.choice(MONTHS[1:])
    other = [m for m in MONTHS if m != month]
    kind = "dup" if rng.random() < 0.55 else "nodup"
    invs = [invoice(no, other[0], "专业版", base, 3), invoice(no + 1, other[1], "专业版", base, 3)]
    if kind == "dup":
        # 同月同套餐同金额扣了两次:真重复,该退后一笔
        a = invoice(no + 2, month, "专业版", base, 3)
        b = invoice(no + 3, month, "专业版", base, 3)
        invs += [a, b]
        right_inv, right_amt = b["id"], base
        cats = ["ok_refund"] * 62 + ["wrong_amount"] * 14 + ["wrong_invoice"] * 12 + ["refuse"] * 12
    else:
        # 同月两张发票,一张套餐一张加购包:金额不同、项目不同,不是重复
        a = invoice(no + 2, month, "专业版", base, 3)
        b = invoice(no + 3, month, "加购:额外席位", addon, 9)
        invs += [a, b]
        right_inv, right_amt = None, 0
        cats = ["ok_refuse"] * 75 + ["wrong_refund"] * 25
    cat = rng.choice(cats)
    mm = int(month[-2:])
    if kind == "dup":
        ticket = rng.choice([
            f"{mm} 月我好像被重复扣款了,麻烦查一下,多扣的退给我。",
            f"账单里 {mm} 月有两笔一样的扣款,请把重复的那笔退掉。",
            f"{mm} 月的订阅费扣了两次,帮我退一次。",
        ])
    else:
        ticket = rng.choice([
            f"{mm} 月我被扣了两次钱,请把多扣的退给我。",
            f"账单里 {mm} 月出现两笔扣款,应该是重复扣费吧,请退款。",
            f"{mm} 月扣款两次,帮我退掉其中一笔。",
        ])
    if cat == "ok_refund":
        r = f"已核对,{mm} 月的 {right_inv} 确实是重复扣款,已为您退款 {right_amt} 元(退款单 RF-{rng.randint(100, 999)})。"
    elif cat == "wrong_amount":
        wrong = right_amt + rng.choice([addon, 100, -50]) if right_amt > 60 else right_amt + 100
        r = f"已核对,{mm} 月的 {right_inv} 确实是重复扣款,已为您退款 {wrong} 元(退款单 RF-{rng.randint(100, 999)})。"
    elif cat == "wrong_invoice":
        wrong_inv = invs[1]["id"]
        r = f"已核对,您 {mm} 月重复扣了一次,已退款 {right_amt} 元,对应发票 {wrong_inv}(退款单 RF-{rng.randint(100, 999)})。"
    elif cat == "refuse":
        r = f"我们查了您的账单,{mm} 月只有一笔正常的订阅扣款,没有重复,所以不能退款,抱歉。"
    elif cat == "ok_refuse":
        r = f"已核对,您 {mm} 月的两笔分别是专业版订阅费和额外席位加购费,金额和项目都不同,不属于重复扣款,所以不能退款。如果不需要额外席位,可以在后台取消。"
    else:  # wrong_refund
        r = f"已核对,{mm} 月两笔里有一笔多收了,已为您退款 {addon} 元(退款单 RF-{rng.randint(100, 999)})。"
    ok = cat in ("ok_refund", "ok_refuse")
    return {"id": f"C{i:03d}", "kind": kind, "cat": cat, "ticket": ticket, "reply": r,
            "invoices": invs, "ok": int(ok)}


def make_pool(n: int = 480, seed: int = 551) -> list[dict]:
    rng = random.Random(seed)
    return [make_case(i, rng) for i in range(n)]


if __name__ == "__main__":
    pool = make_pool()
    OUT.write_text(json.dumps(pool, ensure_ascii=False))
    from collections import Counter
    print(len(pool), "条,通过", sum(c["ok"] for c in pool))
    print(Counter(c["cat"] for c in pool))
    print(json.dumps(pool[0], ensure_ascii=False, indent=1))
```

<div class="line-notes">

- `OUT = Path(__file__).parent / "data" / "judge_pool.json"` 输出到 `part10/data/judge_pool.json`,和 Day 547 的 `runs.json` 同一个目录。
- `MONTHS = ["2026-06", "2026-07", "2026-08", "2026-09"]` 四个月的账期,够造「同一个月」和「别的月份」。
- `def invoice(no: int, month: str, plan: str, amount: int, day: int) -> dict:` 造一张发票:编号、日期、套餐名、金额。返回值是普通字典,相当于 JS 里的对象字面量。
- `def make_case(i: int, rng: random.Random) -> dict:` 造一条用例。`rng` 是外面传进来的随机数发生器,用法和 Day 547 的 `make` 一样,种子固定就能复现。
- `base = rng.choice([199, 299, 468, 599, 888])` 套餐月费随机挑一个,`choice` 相当于从数组里随机取一个元素。
- `kind = "dup" if rng.random() < 0.55 else "nodup"` 55% 是真重复,45% 不是。
- `invs = [invoice(no, other[0], "专业版", base, 3), invoice(no + 1, other[1], "专业版", base, 3)]` 先放两张别的月份的正常发票。后面的 `wrong_invoice` 要引用其中一张。
- `a = invoice(no + 2, month, "专业版", base, 3)` 真重复的第一张。
- `b = invoice(no + 3, month, "专业版", base, 3)` 第二张:同月、同套餐、同金额,这张就是该退的。
- `right_inv, right_amt = b["id"], base` 标准答案:退发票 b,金额是 `base`。以 `C000` 为例,发票 INV-7502,金额 888。
- `cats = ["ok_refund"] * 62 + ["wrong_amount"] * 14 + ["wrong_invoice"] * 12 + ["refuse"] * 12` 一个有 100 个元素的列表,里面 62 个 `ok_refund`,从里面 `rng.choice` 就是按 62%、14%、12%、12% 的概率抽。
- `"加购:额外席位", addon, 9` 不是重复扣款的分支(`else`)里,第二张换成加购费:项目是额外席位,金额 `addon` 是 49、99 或 129,日期也不同。
- `cat = rng.choice(cats)` 这条用例属于哪种回复。
- `ticket = rng.choice([` 工单有三种说法。注意**工单里没有写金额,也没有写发票编号**,所以裁判不看发票清单的话,没法核对回复里的数字。这是故意的。
- `if cat == "ok_refund":` 开始按类别拼回复。
- `r = f"已核对,{mm} 月的 {right_inv} 确实是重复扣款,已为您退款 {right_amt} 元(退款单 RF-{rng.randint(100, 999)})。"` 正确的退款回复,发票号和金额都对。
- `wrong = right_amt + rng.choice([addon, 100, -50]) if right_amt > 60 else right_amt + 100` 退款金额错的回复:多退加购费、多退 100,或者少退 50。
- `wrong_inv = invs[1]["id"]` 引用了别的月份的那张发票。回复读起来很顺,错在发票编号。
- `ok = cat in ("ok_refund", "ok_refuse")` 标准答案:两种「对」的类别记 1,其余记 0。
- `return {"id": f"C{i:03d}", "kind": kind, "cat": cat, "ticket": ticket, "reply": r,` 一条用例带齐:工单、回复、发票、标准答案 `ok`。
- `def make_pool(n: int = 480, seed: int = 551) -> list[dict]:` 默认造 480 条,种子 551。
- `from collections import Counter` 只在直接运行时才用,所以放在 `if __name__` 里面。

</div>

```bash
cd agent-zero-lab
uv run python -m part10.judge_data
```

```text
480 条,通过 335
Counter({'ok_refuse': 169, 'ok_refund': 166, 'wrong_amount': 45, 'wrong_refund': 36, 'refuse': 32, 'wrong_invoice': 32})
{
 "id": "C000",
 "kind": "dup",
 "cat": "ok_refund",
 "ticket": "账单里 7 月有两笔一样的扣款,请把重复的那笔退掉。",
 "reply": "已核对,7 月的 INV-7502 确实是重复扣款,已为您退款 888 元(退款单 RF-516)。",
 "invoices": [
  {
   "id": "INV-7499",
   "date": "2026-06-03",
   "plan": "专业版",
   "amount": 888
  },
  {
   "id": "INV-7500",
   "date": "2026-08-03",
   "plan": "专业版",
   "amount": 888
  },
  {
   "id": "INV-7501",
   "date": "2026-07-03",
   "plan": "专业版",
   "amount": 888
  },
  {
   "id": "INV-7502",
   "date": "2026-07-03",
   "plan": "专业版",
   "amount": 888
  }
 ],
 "ok": 1
}
```

480 条里 335 条是对的,69.8%。这个数是上帝视角,线上永远看不到。第一条 `C000` 是 7 月的真重复,回复把发票号和 888 元都写对了,标准答案是 1。

## 请裁判判一遍

`deepseek-flash` 当裁判,每条只输出 `{"pass": true 或 false}`,不要理由,省输出的钱。先写一个只给工单和回复的版本,思路和 Day 546 的裁判一样(下面叫 A);再写一个把发票清单一起交给它、并且写明规则的版本(C);最后写一个只给发票清单、不写规则的版本(M),后面主要拿它做实验。

```python
# agent-zero-lab/part10/judge_run.py
"""让 deepseek-flash 当裁判,给 judge_pool.json 里的回复打 pass/fail,结果存进 data/。"""
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from common.llm import LLMClient

HERE = Path(__file__).parent

BASE = (
    "你是客服质检员。给你一张工单和客服的回复,判断回复有没有把事情处理对:"
    "该退款的退了、退的金额和发票对、不该退款的没有退。"
)
PROMPTS = {
    # A:只看工单和回复,和 Day 546 的裁判一样
    "A": BASE + '只输出 JSON:{"pass": true 或 false}。',
    # C:把这位客户的发票也交给裁判。规则:同月、同套餐、同金额的两张才算重复扣款,该退后一张
    "C": BASE + "下面还会给你这位客户的发票清单。规则:同一个月、同一个套餐、同一个金额的两张发票才算重复扣款,"
        "应当退后一张的全额;套餐费和加购费不是重复。"
        '只输出 JSON:{"pass": true 或 false}。',
    # M:给发票清单,但不写规则,只让裁判自己判断(Day 551 起主要用它)
    "M": "你是客服质检员。给你一张工单、客服的回复和这位客户的发票清单,判断客服的回复处理得对不对。"
        '只输出 JSON:{"pass": true 或 false}。',
}


def user_message(case: dict, prompt: str) -> str:
    text = f"工单:{case['ticket']}\n回复:{case['reply']}"
    if prompt in ("C", "M"):
        lines = "\n".join(f"{v['id']} {v['date']} {v['plan']} {v['amount']} 元" for v in case["invoices"])
        text += f"\n发票清单:\n{lines}"
    return text


def judge_one(llm: LLMClient, case: dict, prompt: str) -> dict:
    res = llm.chat(
        [{"role": "system", "content": PROMPTS[prompt]}, {"role": "user", "content": user_message(case, prompt)}],
        temperature=0, response_format={"type": "json_object"}, max_tokens=30,
    )
    try:
        verdict = int(bool(json.loads(res.content)["pass"]))
    except (ValueError, KeyError, TypeError):
        verdict = -1  # 解析不出来,单独记
    return {"id": case["id"], "judge": verdict, "cost": res.cost, "tokens": res.prompt_tokens}


def run(prompt: str, limit: int | None = None) -> None:
    pool = json.loads((HERE / "data" / "judge_pool.json").read_text())[:limit]
    llm = LLMClient()
    with ThreadPoolExecutor(max_workers=8) as ex:
        rows = list(ex.map(lambda c: judge_one(llm, c, prompt), pool))
    name = f"judge_{prompt}.json" if limit is None else f"judge_{prompt}_pilot.json"
    (HERE / "data" / name).write_text(json.dumps(rows))
    bad = sum(r["judge"] == -1 for r in rows)
    truth = {c["id"]: c["ok"] for c in pool}
    agree = sum(r["judge"] == truth[r["id"]] for r in rows)
    print(f"裁判 {prompt}:{len(rows)} 条,和标准答案一致 {agree},解析失败 {bad},"
          f"花费 ¥{sum(r['cost'] for r in rows):.4f},平均输入 {sum(r['tokens'] for r in rows) / len(rows):.0f} tokens")


if __name__ == "__main__":
    run(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else None)
```

<div class="line-notes">

- `from common.llm import LLMClient` Day 135 建的客户端,读 `.env`,每次调用算好花费。
- `HERE = Path(__file__).parent` 取这个脚本所在目录,下面读写 `data/` 用。
- `BASE = (` 三个 prompt 共用的开头:客服质检员,判断「该退的退了、金额和发票对、不该退的没退」。
- `"A": BASE + '只输出 JSON:{"pass": true 或 false}。',` A 只有工单和回复。`'...'` 单引号里有双引号,不用转义。提示词里必须出现「JSON」这个词,JSON 模式才不会报错(Day 148)。
- `"C": BASE + "下面还会给你这位客户的发票清单。规则:` C 把规则写明:同月、同套餐、同金额的两张才算重复扣款,该退后一张全额;套餐费和加购费不是重复。
- `# M:给发票清单,但不写规则,只让裁判自己判断(Day 551 起主要用它)` M 是「让裁判自己琢磨」的版本。
- `def user_message(case: dict, prompt: str) -> str:` 把一条用例拼成发给裁判的文字。
- `if prompt in ("C", "M"):` C 和 M 要把发票清单拼上去,A 不拼。
- `lines = "\n".join(f"{v['id']} {v['date']} {v['plan']} {v['amount']} 元" for v in case["invoices"])` 每张发票一行,形如 `INV-7502 2026-07-03 专业版 888 元`,再用换行连起来。
- `def judge_one(llm: LLMClient, case: dict, prompt: str) -> dict:` 判一条。
- `temperature=0, response_format={"type": "json_object"}, max_tokens=30,` 温度 0 让裁判尽量稳定;JSON 模式;最多输出 30 个 token,足够写 `{"pass": true}`。
- `verdict = int(bool(json.loads(res.content)["pass"]))` 解析出 `pass` 的值,变成 0 或 1。
- `verdict = -1  # 解析不出来,单独记` 解析失败也不要让整批崩,记成 −1,最后统计有几条。今天三批都是 0 条。
- `return {"id": case["id"], "judge": verdict, "cost": res.cost, "tokens": res.prompt_tokens}` 每条记下裁判的判断、花费和输入 token 数。
- `with ThreadPoolExecutor(max_workers=8) as ex:` 同时发 8 个请求。裁判之间互不相干,可以并发(Day 179 用过线程池,这里当成「一次发 8 个」就行)。
- `rows = list(ex.map(lambda c: judge_one(llm, c, prompt), pool))` `map` 按原顺序返回结果,所以 `rows[i]` 对应 `pool[i]`。
- `name = f"judge_{prompt}.json" if limit is None else f"judge_{prompt}_pilot.json"` 试跑(给了 limit)存成 `_pilot` 文件,不覆盖正式结果。
- `agree = sum(r["judge"] == truth[r["id"]] for r in rows)` 和标准答案一致的条数。
- `run(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else None)` 命令行第一个参数是 prompt 名,第二个(可选)是只跑前几条。

</div>

先小样本试跑,看花费和有没有解析失败。这一步一定要做:裁判 prompt 写坏了,480 次调用就白烧了。

```bash
uv run python -m part10.judge_run A 20
uv run python -m part10.judge_run C 20
```

```text
裁判 A:20 条,和标准答案一致 13,解析失败 0,花费 ¥0.0062,平均输入 136 tokens
裁判 C:20 条,和标准答案一致 19,解析失败 0,花费 ¥0.0109,平均输入 260 tokens
```

20 条花了不到 2 分钱,没有解析失败,放大。A 和 C 各跑全部 480 条:

```bash
uv run python -m part10.judge_run A
uv run python -m part10.judge_run C
```

```text
裁判 A:480 条,和标准答案一致 335,解析失败 0,花费 ¥0.1501,平均输入 136 tokens
裁判 C:480 条,和标准答案一致 464,解析失败 0,花费 ¥0.2449,平均输入 261 tokens
```

A 的一致条数正好是 335,和标准答案里「对」的条数一样。这不是巧合,下一步看。

M 也先试跑 120 条再放大(试跑的文件存成 `judge_M_pilot.json`,不会覆盖正式结果):

```bash
uv run python -m part10.judge_run M 120
uv run python -m part10.judge_run M
```

```text
裁判 M:120 条,和标准答案一致 106,解析失败 0,花费 ¥0.0544,平均输入 207 tokens
裁判 M:480 条,和标准答案一致 431,解析失败 0,花费 ¥0.2185,平均输入 208 tokens
```

今天裁判一共花了 0.0062 + 0.0109 + 0.0544 + 0.1501 + 0.2449 + 0.2185 = ¥0.6850,约 ¥0.69,其中三次试跑 ¥0.07。单价按 Day 359 查到的 deepseek-flash 高峰价(2026 年 10 月,缓存命中 0.04、未命中 2、输出 8 元每百万 token),`LLMClient` 按 `.env` 里的 `LLM_PRICE` 算好。几乎所有的钱都花在输入上:A 平均 136 个输入 token,C 和 M 带了发票清单,多出一百多个。

## 看裁判错在哪

把 480 条全部拿来和标准答案对一遍,算 TPR 和 TNR。这是 Day 358 的老办法,但这次一并带上 Wilson 区间。先写今天第一个模块 `judge_stats.py`,里面两个函数:`rates` 数四种情况、算 TPR 和 TNR;`corrected_rate` 是 Day 358 的校正公式,多了一个防呆。

```python
# agent-zero-lab/part10/judge_stats.py
"""裁判有多准、校正后的通过率是多少(Day 551 建)。"""
import numpy as np

from part10.stats import wilson_ci


def rates(human: list[int], judge: list[int]) -> dict:
    """人工标注 human 和裁判 judge(都是 0/1 列表)对比,算 TPR、TNR 和各自的 Wilson 区间。"""
    tp = sum(1 for h, j in zip(human, judge) if h == 1 and j == 1)
    fn = sum(1 for h, j in zip(human, judge) if h == 1 and j == 0)
    tn = sum(1 for h, j in zip(human, judge) if h == 0 and j == 0)
    fp = sum(1 for h, j in zip(human, judge) if h == 0 and j == 1)
    return {
        "tp": tp, "fn": fn, "tn": tn, "fp": fp,
        "tpr": tp / (tp + fn), "tpr_ci": wilson_ci(tp, tp + fn),
        "tnr": tn / (tn + fp), "tnr_ci": wilson_ci(tn, tn + fp),
    }


def corrected_rate(observed: float, tpr: float, tnr: float) -> float:
    """Rogan-Gladen 校正:裁判报 observed 的通过率,真实通过率大概是多少。"""
    denom = tpr + tnr - 1
    if denom <= 0:
        raise ValueError(f"TPR+TNR-1={denom:.2f},裁判不比瞎猜强,校正没意义")
    return float(np.clip((observed + tnr - 1) / denom, 0.0, 1.0))
```

<div class="line-notes">

- `import numpy as np` 后面的 bootstrap 要用,先导入。
- `from part10.stats import wilson_ci` 区间用 Day 547 的 Wilson,不是 Day 354 的 Wald。TPR、TNR 常常接近 1,Wald 在那里会越界。
- `def rates(human: list[int], judge: list[int]) -> dict:` `human` 和 `judge` 是两列 0/1,同一个位置是同一条用例。
- `tp = sum(1 for h, j in zip(human, judge) if h == 1 and j == 1)` 人判通过、裁判也判通过。
- `fn = sum(1 for h, j in zip(human, judge) if h == 1 and j == 0)` 人判通过、裁判判不通过:冤枉了好回复。
- `tn = sum(1 for h, j in zip(human, judge) if h == 0 and j == 0)` 人判不通过、裁判也判不通过:抓到了坏回复。
- `fp = sum(1 for h, j in zip(human, judge) if h == 0 and j == 1)` 人判不通过、裁判判通过:放过了坏回复。这一格最危险,看不见。
- `"tpr": tp / (tp + fn), "tpr_ci": wilson_ci(tp, tp + fn),` TPR 是在「人判通过」的那些条里算的,分母是 `tp + fn`。区间宽窄看的就是这个分母有多大。
- `"tnr": tn / (tn + fp), "tnr_ci": wilson_ci(tn, tn + fp),` TNR 是在「人判不通过」的条里算的,分母是 `tn + fp`。坏回复少的时候,这个分母就小,区间就宽。今天的主角。
- `def corrected_rate(observed: float, tpr: float, tnr: float) -> float:` 输入裁判报的通过率和它的 TPR、TNR,返回校正后的通过率。
- `denom = tpr + tnr - 1` 分母。裁判不看内容、一律判通过时,TPR = 1、TNR = 0,分母正好是 0。
- `raise ValueError(f"TPR+TNR-1={denom:.2f},裁判不比瞎猜强,校正没意义")` 主动报错,不要让 `ZeroDivisionError` 吓人。
- `return float(np.clip((observed + tnr - 1) / denom, 0.0, 1.0))` 公式是 Day 358 推过的 `(p_obs + TNR − 1) / (TPR + TNR − 1)`。`np.clip` 把结果夹在 0 到 1 之间,因为抽样误差会让算出来的数偶尔超界。

</div>

再写一个脚本,对三个裁判逐个算:

```python
# agent-zero-lab/part10/judge_confusion.py
"""把 480 条全部拿来对一遍(上帝视角:每条的标准答案我们都有),看两个裁判到底有多准。"""
import json
from pathlib import Path

from part10.judge_stats import corrected_rate, rates

HERE = Path(__file__).parent
pool = json.loads((HERE / "data" / "judge_pool.json").read_text())
human = [c["ok"] for c in pool]
print(f"标准答案:通过 {sum(human)}/{len(human)} = {sum(human) / len(human):.1%}")

for name in ("A", "C", "M"):
    rows = {r["id"]: r["judge"] for r in json.loads((HERE / "data" / f"judge_{name}.json").read_text())}
    judge = [rows[c["id"]] for c in pool]
    r = rates(human, judge)
    obs = sum(judge) / len(judge)
    print(f"\n裁判 {name}:报通过率 {obs:.1%}")
    print(f"  人判 pass 的 {r['tp'] + r['fn']} 条,裁判判对 {r['tp']} 条:TPR {r['tpr']:.3f} [{r['tpr_ci'][0]:.3f}, {r['tpr_ci'][1]:.3f}]")
    print(f"  人判 fail 的 {r['tn'] + r['fp']} 条,裁判判对 {r['tn']} 条:TNR {r['tnr']:.3f} [{r['tnr_ci'][0]:.3f}, {r['tnr_ci'][1]:.3f}]")
    try:
        print(f"  校正后通过率 {corrected_rate(obs, r['tpr'], r['tnr']):.1%}")
    except ValueError as e:
        print(f"  校正失败:{e}")
```

<div class="line-notes">

- `human = [c["ok"] for c in pool]` 480 个标准答案,0 或 1。
- `print(f"标准答案:通过 {sum(human)}/{len(human)} = {sum(human) / len(human):.1%}")` 先打真实通过率,335/480。
- `for name in ("A", "C", "M"):` 三个裁判各来一遍。
- `rows = {r["id"]: r["judge"] for r in json.loads(` 读裁判的结果,变成 id 到判断的字典。
- `judge = [rows[c["id"]] for c in pool]` 按 `pool` 的顺序取出来,和 `human` 同一个顺序。
- `r = rates(human, judge)` 数四种情况。
- `obs = sum(judge) / len(judge)` 裁判报出来的通过率。
- `print(f"  人判 fail 的 {r['tn'] + r['fp']} 条,裁判判对 {r['tn']} 条:` TNR 那一行,最该看的一行。
- `print(f"  校正后通过率 {corrected_rate(obs, r['tpr'], r['tnr']):.1%}")` 校正一下。
- `except ValueError as e:` A 会走到这里,`e` 就是上面 `raise` 的那句话。

</div>

```bash
uv run python -m part10.judge_confusion
```

```text
标准答案:通过 335/480 = 69.8%

裁判 A:报通过率 100.0%
  人判 pass 的 335 条,裁判判对 335 条:TPR 1.000 [0.989, 1.000]
  人判 fail 的 145 条,裁判判对 0 条:TNR 0.000 [0.000, 0.026]
  校正失败:TPR+TNR-1=0.00,裁判不比瞎猜强,校正没意义

裁判 C:报通过率 73.1%
  人判 pass 的 335 条,裁判判对 335 条:TPR 1.000 [0.989, 1.000]
  人判 fail 的 145 条,裁判判对 129 条:TNR 0.890 [0.828, 0.931]
  校正后通过率 69.8%

裁判 M:报通过率 80.0%
  人判 pass 的 335 条,裁判判对 335 条:TPR 1.000 [0.989, 1.000]
  人判 fail 的 145 条,裁判判对 96 条:TNR 0.662 [0.582, 0.734]
  校正后通过率 69.8%
```

三个裁判的样子差别很大。

**裁判 A 对 480 条全判通过。**报 100%,真实是 69.8%。TPR 是 1.000,TNR 是 0,145 条坏回复一条没抓住。它只看工单和回复,工单里没有金额也没有发票号,回复读起来又都有模有样,它没法核对,于是一律放行。这里就是「报错先演示一次」:校正函数当场报 `TPR+TNR-1=0.00,裁判不比瞎猜强,校正没意义`。公式救不了一个根本没有判别力的裁判,校正是给「有点准但有偏」的裁判用的。这件事在 Day 546 就露过头:裁判没看到发票数据,只能猜。

**裁判 C 和 M 看了发票清单**,有了判别力。C 的 prompt 里写了规则,TNR 0.890,报 73.1%;M 没写规则,让它自己判断,TNR 只有 0.662,报 80.0%。两个裁判 TPR 都是 1.000:好回复它们从来不冤枉。错都错在同一个方向,放过坏回复,也就是「宽松」。这是 LLM 裁判最常见的偏心,Day 359 讲过,今天的数据里它又出现了。

最后一行还有一个值得停一下的现象:M 报 80.0%,TPR 1.000、TNR 0.662,校正后得到 69.8%,和真实通过率一模一样。这里的 TPR、TNR 是拿全部 480 条的标准答案算的,校正等于把同一份数据又倒推了一遍,所以对得严丝合缝。现实里没有 480 条标准答案,只有一小份。**真正的问题从这里开始:只有一小份标注,估出来的 TPR、TNR 本身就是抽样来的,会抖。**

<figure>
<svg viewBox="0 0 640 262" role="img" aria-label="校正的两条数据线:线上大批回复只有裁判的判断,报出一个偏高的通过率;校准集是一小份人工标注加裁判判断,估出 TPR 和 TNR,两边合起来校正出带区间的通过率">
<rect x="0" y="0" width="640" height="262" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="30" width="150" height="56" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="26" y="52" fill="var(--ink)">线上 380 条</text>
<text x="26" y="70" fill="var(--ink-faint)">只有裁判的判断</text>
<line x1="166" y1="58" x2="212" y2="58" stroke="var(--rule)"/>
<rect x="212" y="30" width="150" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="222" y="52" fill="var(--ink)">裁判报 83.7%</text>
<text x="222" y="70" fill="var(--ink-faint)">偏高,放过坏回复</text>
<rect x="16" y="130" width="150" height="56" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="26" y="152" fill="var(--ink)">校准集 100 条</text>
<text x="26" y="170" fill="var(--ink-faint)">人判 + 裁判判</text>
<line x1="166" y1="158" x2="212" y2="158" stroke="var(--rule)"/>
<rect x="212" y="130" width="150" height="56" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="222" y="152" fill="var(--ink)">TPR 1.00 TNR 0.68</text>
<text x="222" y="170" fill="var(--ink-faint)">各带 Wilson 区间</text>
<line x1="362" y1="58" x2="410" y2="104" stroke="var(--rule)"/>
<line x1="362" y1="158" x2="410" y2="112" stroke="var(--rule)"/>
<rect x="410" y="80" width="214" height="56" rx="6" fill="var(--paper)" stroke="var(--ink-soft)"/>
<text x="420" y="102" fill="var(--ink)">校正 76.0%</text>
<text x="420" y="120" fill="var(--ink-faint)">区间 [67.8%, 82.1%]</text>
<text x="16" y="222" fill="var(--ink-soft)">区间里有两个来源:线上 380 条的抽样误差,以及校准集 100 条估 TPR、TNR 的误差。</text>
<text x="16" y="242" fill="var(--ink-soft)">后者通常是大头,因为 TNR 只在校准集里人判 fail 的那几十条上算。</text>
</g>
</svg>
<figcaption>校正用两份数据:线上一大批只有裁判的判断,校准集一小份有人工标注。线上那份给出偏高的数,校准集给出裁判有多偏,两边合起来才能校正。图里的数字是下面 calib_demo.py 分层抽样那一次的结果。</figcaption>
</figure>


## 手里只有 100 条标注

线上每天几千条,专家一天标不了几百条。假设预算只够标 100 条,从这 480 条里挑 100 条当**校准集**:有人工标注,也有裁判的判断,用它们估 TPR 和 TNR。剩下 380 条假装是线上,只有裁判的判断。

这 100 条怎么挑,有两种办法:按自然比例**随机抽**,或者让 pass 和 fail 各占一半(**分层抽样**,也叫差评多抽)。先写一个小模块把切分做好,今天后面几个脚本都从这里取数据:

```python
# agent-zero-lab/part10/judge_split.py
"""把 480 条切成「校准集」和「线上集」:随机抽,或者 pass、fail 各抽一半(分层)。"""
import json
import random
from pathlib import Path

HERE = Path(__file__).parent
pool = json.loads((HERE / "data" / "judge_pool.json").read_text())
judge = {r["id"]: r["judge"] for r in json.loads((HERE / "data" / "judge_M.json").read_text())}
human = [c["ok"] for c in pool]                     # 标准答案(真实项目里来自专家标注)
verdict = [judge[c["id"]] for c in pool]            # 裁判 M 的判断


def draw(n_cal: int, stratified: bool, seed: int) -> tuple[list[int], list[int]]:
    """返回 (校准集下标, 线上集下标)。分层:pass 和 fail 各抽一半;随机:按自然比例随便抽。"""
    rng = random.Random(seed)
    idx = list(range(len(pool)))
    rng.shuffle(idx)
    if stratified:
        cal = [i for i in idx if human[i] == 1][: n_cal // 2] + [i for i in idx if human[i] == 0][: n_cal // 2]
    else:
        cal = idx[:n_cal]
    chosen = set(cal)
    return cal, [i for i in idx if i not in chosen]
```

<div class="line-notes">

- `pool = json.loads((HERE / "data" / "judge_pool.json").read_text())` 480 条用例。
- `judge = {r["id"]: r["judge"] for r in json.loads((HERE / "data" / "judge_M.json").read_text())}` 先选裁判 M 当被校准的对象。M 报 80.0%,比真实值高 10 个点,偏得够明显,看得出校正的效果。
- `human = [c["ok"] for c in pool]` 标准答案,下标和 `pool` 对齐。
- `verdict = [judge[c["id"]] for c in pool]` 裁判 M 的判断,下标也对齐。以后写 `human[i]` 和 `verdict[i]`,指的是同一条用例。
- `def draw(n_cal: int, stratified: bool, seed: int) -> tuple[list[int], list[int]]:` 返回两个下标列表:校准集和线上集。种子固定,同一个种子永远抽出同一批。
- `rng.shuffle(idx)` 把 0 到 479 的下标洗牌。`shuffle` 原地打乱,没有返回值,这是 Python 和 JS `sort` 一样的「改原数组」风格。
- `cal = [i for i in idx if human[i] == 1][: n_cal // 2] + [i for i in idx if human[i] == 0][: n_cal // 2]` 分层:从洗过牌的下标里,先挑出人判通过的取前一半,再挑出人判不通过的取前一半。`//` 是整除,100 // 2 = 50。
- `cal = idx[:n_cal]` 随机:洗过牌以后直接取前 100 个,通过和不通过按自然比例混着来。
- `return cal, [i for i in idx if i not in chosen]` 其余的就是线上集。

</div>

分别抽一次(种子都是 3),算 TPR、TNR,再对线上那 380 条校正。校正区间的函数下一节才写,这里先把它当黑盒用:

```python
# agent-zero-lab/part10/calib_demo.py
"""只拿 100 条做校准、其余 380 条当「线上」:随机抽 vs 差评多抽,各算一次校正后的通过率和区间。"""
from part10.judge_split import draw, human, verdict
from part10.judge_stats import corrected_rate_ci, rates
from part10.stats import fmt_rate

for stratified in (False, True):
    cal, prod = draw(100, stratified, seed=3)
    hc, jc = [human[i] for i in cal], [verdict[i] for i in cal]
    jp = [verdict[i] for i in prod]
    r = rates(hc, jc)
    point, (lo, hi) = corrected_rate_ci(jp, hc, jc)
    print("分层抽样" if stratified else "随机抽样", f"校准集 {len(cal)} 条,其中人判 fail {r['tn'] + r['fp']} 条")
    print(f"  TPR {r['tpr']:.3f} [{r['tpr_ci'][0]:.3f}, {r['tpr_ci'][1]:.3f}]   TNR {r['tnr']:.3f} [{r['tnr_ci'][0]:.3f}, {r['tnr_ci'][1]:.3f}]")
    print(f"  线上 {len(prod)} 条:裁判报 {fmt_rate(sum(jp), len(jp))}")
    print(f"  校正后 {point:.1%},95% 区间 [{lo:.1%}, {hi:.1%}],宽 {hi - lo:.1%}")
    print(f"  上帝视角:线上集真实通过率 {sum(human[i] for i in prod) / len(prod):.1%}")
```

<div class="line-notes">

- `for stratified in (False, True):` 先随机、后分层各做一遍。
- `cal, prod = draw(100, stratified, seed=3)` 校准集 100 条,线上集 380 条。
- `hc, jc = [human[i] for i in cal], [verdict[i] for i in cal]` 校准集里每条的人判和裁判判。
- `jp = [verdict[i] for i in prod]` 线上集里**只有**裁判的判断,没有人判。
- `r = rates(hc, jc)` 在校准集上数四种情况,算 TPR、TNR。
- `point, (lo, hi) = corrected_rate_ci(jp, hc, jc)` 校正后的通过率和 95% 区间。右边返回的是 `(点估计, (下限, 上限))`,左边直接拆开。
- `print(f"  线上 {len(prod)} 条:裁判报 {fmt_rate(sum(jp), len(jp))}")` 裁判直接报的通过率,带 Day 547 的 Wilson 区间。
- `print(f"  上帝视角:线上集真实通过率 {sum(human[i] for i in prod) / len(prod):.1%}")` 模拟里我们知道线上集的真实通过率,拿来对答案。

</div>

```bash
uv run python -m part10.calib_demo
```

```text
随机抽样 校准集 100 条,其中人判 fail 34 条
  TPR 1.000 [0.945, 1.000]   TNR 0.706 [0.538, 0.832]
  线上 380 条:裁判报 308/380 = 81.1% [76.8%, 84.7%]
  校正后 73.2%,95% 区间 [62.9%, 80.0%],宽 17.2%
  上帝视角:线上集真实通过率 70.8%
分层抽样 校准集 100 条,其中人判 fail 50 条
  TPR 1.000 [0.929, 1.000]   TNR 0.680 [0.542, 0.792]
  线上 380 条:裁判报 318/380 = 83.7% [79.6%, 87.1%]
  校正后 76.0%,95% 区间 [67.8%, 82.1%],宽 14.2%
  上帝视角:线上集真实通过率 75.0%
```

看三个地方。

**差评条数。**随机抽的 100 条里只有 34 条人判 fail,分层抽的有 50 条。TNR 只能在这些条上算,34 条时 TNR 是 0.706,区间 [0.538, 0.832],宽 29 个点;50 条时是 0.680,[0.542, 0.792],宽 25 个点。TPR 这边反过来,分层抽样的 pass 条数少了(66 变 50),区间略宽,但 TPR 本来就是 1.0 附近,宽一点无所谓。我们最在乎的是 TNR,因为放过的坏回复没人看得见。

**直接报的区间是错的。**裁判报 81.1%,Wilson 区间 [76.8%, 84.7%],线上集真实通过率是 70.8%,根本不在里面。分层那次也一样:报 83.7%,区间 [79.6%, 87.1%],真值 75.0%。Wilson 只管「380 条是抽出来的」这一种误差,管不了「裁判系统性偏高」。区间画得再精确,中心是歪的。(两次线上集不一样,真实通过率才从 70.8% 变成 75.0%,因为分层抽样把更多 fail 拿走去做了校准集。)

**校正后的区间包住了真值。**随机那次 73.2%,[62.9%, 80.0%];分层那次 76.0%,[67.8%, 82.1%],两个区间都包住了各自的真值。区间也比直接报的宽很多,宽 17.2 和 14.2 个点,这是诚实的代价:同样的 380 条,你以为的精度是 ±4 个点,把裁判的不确定性算进去以后是 ±7 到 ±9。

分层抽样为什么不会把 TPR、TNR 带歪?因为这两个数是**条件概率**:TPR 是「人判通过的里面,裁判也判通过的比例」,TNR 是「人判不通过的里面,裁判判不通过的比例」。分母分别只看一类样本,两类样本在校准集里各占多少,对这两个比例没有影响,只影响它们估得准不准。代价是一个限制:**分层抽出来的校准集,不能拿来直接算通过率**,它里面通过率被你人为设成了 50%。

## 校正后的区间怎么来

上面用的 `corrected_rate_ci` 是今天第二个新概念。想一想校正后的数里有几处在抖:

1. 线上那 380 条是抽样来的,裁判报出的通过率 `p_obs` 本身会抖。
2. 校准集那 100 条也是抽样来的,算出的 TPR、TNR 会抖。校正公式里它们在分母和分子上,抖动被放大。

Day 549 的 bootstrap 正好对付这种「多个来源、没有现成公式」的情况:每一轮**同时**把线上集和校准集各重抽一遍,用重抽的校准集重新估 TPR、TNR,用重抽的线上集重新算 `p_obs`,再校正一次;重复几千轮,取校正结果的 2.5% 和 97.5% 分位数。两个来源的抖动就都在这几千个数的离散程度里了。

```python
# agent-zero-lab/part10/judge_stats.py(新增)
def corrected_rate_ci(judge_prod: list[int], human_cal: list[int], judge_cal: list[int],
                      n_boot: int = 4000, seed: int = 0) -> tuple[float, tuple[float, float]]:
    """校正后的通过率 + bootstrap 区间。线上样本和校准集两边的误差一起算进去。"""
    rng = np.random.default_rng(seed)
    jp = np.asarray(judge_prod)
    hc, jc = np.asarray(human_cal), np.asarray(judge_cal)
    r = rates(human_cal, judge_cal)
    point = corrected_rate(float(jp.mean()), r["tpr"], r["tnr"])
    out = []
    for _ in range(n_boot):
        p = jp[rng.integers(0, len(jp), len(jp))].mean()   # 线上样本重抽
        i = rng.integers(0, len(hc), len(hc))                # 校准集重抽
        h, j = hc[i], jc[i]
        tpr = ((h == 1) & (j == 1)).sum() / max((h == 1).sum(), 1)
        tnr = ((h == 0) & (j == 0)).sum() / max((h == 0).sum(), 1)
        if tpr + tnr - 1 > 0.05:                             # 这一轮裁判接近瞎猜,丢掉
            out.append(corrected_rate(float(p), float(tpr), float(tnr)))
    lo, hi = np.percentile(out, [2.5, 97.5])
    return point, (float(lo), float(hi))
```

<div class="line-notes">

- `def corrected_rate_ci(judge_prod: list[int], human_cal: list[int], judge_cal: list[int],` 三份输入:线上的裁判判断、校准集的人判、校准集的裁判判。返回点估计和区间。
- `rng = np.random.default_rng(seed)` numpy 自己的随机数发生器,种子固定,同样的输入每次得到同样的区间。
- `jp = np.asarray(judge_prod)` 列表变成 numpy 数组,这样才能用整数数组当下标一次取一批。
- `hc, jc = np.asarray(human_cal), np.asarray(judge_cal)` 校准集的两列也变成数组。
- `r = rates(human_cal, judge_cal)` 先用原始的校准集算一次,得到点估计。
- `point = corrected_rate(float(jp.mean()), r["tpr"], r["tnr"])` 线上的 `p_obs` 就是 `jp.mean()`(0/1 的平均就是比例)。
- `p = jp[rng.integers(0, len(jp), len(jp))].mean()   # 线上样本重抽` `rng.integers(0, 380, 380)` 生成 380 个 0 到 379 的随机下标(有放回),`jp[...]` 一次取出这 380 条,再求平均。这是 Day 549 的重抽。
- `i = rng.integers(0, len(hc), len(hc))                # 校准集重抽` 校准集也重抽,**用同一组下标**取 `hc` 和 `jc`,保证人判和裁判判还是配对的。
- `tpr = ((h == 1) & (j == 1)).sum() / max((h == 1).sum(), 1)` 重抽出来的校准集上重新算 TPR。`max(..., 1)` 防止某一轮碰巧没抽到任何 pass 条而除以零。
- `tnr = ((h == 0) & (j == 0)).sum() / max((h == 0).sum(), 1)` 同理算 TNR。fail 条本来就少,重抽后 TNR 波动最大。
- `if tpr + tnr - 1 > 0.05:                             # 这一轮裁判接近瞎猜,丢掉` 偶尔某一轮重抽出来的校准集让裁判看起来接近瞎猜,分母接近 0,校正结果会飞到天上去。丢掉这一轮。这个门槛 0.05 是我定的,真遇到大量被丢的轮次,说明裁判本身就不行,别去调门槛。
- `lo, hi = np.percentile(out, [2.5, 97.5])` 取中间 95%。

</div>

三件事注意。一,区间的宽度主要由校准集里 fail 的条数决定,线上多看几千条几乎改变不了它(练习里可以验证)。二,TPR、TNR 在这个问题里是「一大一小」两个比例,协方差不好手算,这正是 bootstrap 派用场的地方。三,线上那些工单如果来自同一个客户或同一个场景,Day 548 的聚类问题又会回来,线上集应该按簇重抽;今天的 480 条是独立造的,不存在这个问题,我没有处理。

## 随机抽和差评多抽,到底差多少

一次抽样说明不了什么,运气成分太大。把「抽校准集、校正、画区间」重复 300 次,每次换一个种子,统计区间宽度的中位数,以及区间包住线上集真实通过率的比例。校准集分别取 60、100、160 条:

```python
# agent-zero-lab/part10/cal_size.py
"""校准集随机抽、还是差评多抽?同一个池子反复抽 300 次,看校正后区间的宽度和包住率。"""
import statistics

from part10.judge_split import draw, human, verdict
from part10.judge_stats import corrected_rate_ci


def one_trial(n_cal: int, stratified: bool, seed: int) -> tuple[float, bool, int]:
    cal, prod = draw(n_cal, stratified, seed)
    hc, jc = [human[i] for i in cal], [verdict[i] for i in cal]
    jp = [verdict[i] for i in prod]
    true_prod = sum(human[i] for i in prod) / len(prod)   # 线上集的真实通过率(上帝视角)
    _, (lo, hi) = corrected_rate_ci(jp, hc, jc, n_boot=800, seed=seed)
    return hi - lo, lo <= true_prod <= hi, sum(1 - x for x in hc)


if __name__ == "__main__":
    print(f"{'校准集':>6} {'抽法':<5} {'平均差评数':>9} {'区间宽度(中位)':>14} {'包住真值':>8}")
    for n_cal in (60, 100, 160):
        for strat in (False, True):
            res = [one_trial(n_cal, strat, s) for s in range(300)]
            width = statistics.median(r[0] for r in res)
            cover = sum(r[1] for r in res) / len(res)
            fails = statistics.mean(r[2] for r in res)
            print(f"{n_cal:>6} {'分层' if strat else '随机':<5} {fails:>9.1f} {width:>14.1%} {cover:>8.1%}")
```

<div class="line-notes">

- `from part10.judge_split import draw, human, verdict` 切分函数不用重写。
- `def one_trial(n_cal: int, stratified: bool, seed: int) -> tuple[float, bool, int]:` 做一次完整的试验,返回(区间宽度、有没有包住真值、校准集里人判 fail 的条数)。
- `true_prod = sum(human[i] for i in prod) / len(prod)   # 线上集的真实通过率(上帝视角)` 每次切分,线上集不同,真实通过率也略不同,所以每次单独算。
- `_, (lo, hi) = corrected_rate_ci(jp, hc, jc, n_boot=800, seed=seed)` 试验里 bootstrap 用 800 轮不用 4000,省时间。点估计不要,用下划线占位。
- `return hi - lo, lo <= true_prod <= hi, sum(1 - x for x in hc)` Python 允许 `lo <= x <= hi` 连着写,相当于 JS 的 `lo <= x && x <= hi`。
- `for n_cal in (60, 100, 160):` 三种校准集大小。分层最多用到 160 条,要 80 条 fail,池子里一共 145 条 fail,够。
- `res = [one_trial(n_cal, strat, s) for s in range(300)]` 300 次试验,种子是 0 到 299。
- `width = statistics.median(r[0] for r in res)` 区间宽度取中位数。

</div>

```bash
uv run python -m part10.cal_size
```

(300 × 6 组 × 800 轮 bootstrap,我这台 2019 款 MacBook 上跑了约一分半。)

```text
   校准集 抽法        平均差评数       区间宽度(中位)     包住真值
    60 随机         18.0          26.6%    96.3%
    60 分层         30.0          18.7%    96.3%
   100 随机         30.3          20.6%    95.7%
   100 分层         50.0          15.7%    97.3%
   160 随机         48.5          18.3%    96.3%
   160 分层         80.0          13.1%    98.3%
```

差评多抽之后,每一档校准集大小下区间都窄了 5 到 8 个点:60 条时从 26.6% 降到 18.7%,100 条时从 20.6% 降到 15.7%,160 条时从 18.3% 降到 13.1%。同样标 100 条,分层抽样比随机抽窄 5 个点。随机抽标到 160 条,区间还有 18.3%,比分层 100 条的 15.7% 还宽,等于多花六成人力还没追上。

包住率全部在 95.7% 以上,比 95% 还高,这个要诚实地解释一下,别当成「方法特别准」。我的池子只有 480 条,校准集是从里面不放回地抽的,线上集就是剩下的,两边都是有限的总体。bootstrap 假设的是「从无穷多条里有放回地抽」,对有限的小池子会多算一点方差,区间偏保守。真正线上的数据流源源不断,更接近 bootstrap 的假设,包住率应当更靠近 95%,但这一点我没有另外验证。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="校准集 60、100、160 条时,随机抽和分层抽样的区间宽度对比:60 条 26.6% 对 18.7%,100 条 20.6% 对 15.7%,160 条 18.3% 对 13.1%">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="24" fill="var(--ink-soft)">校正后通过率的 95% 区间宽度(中位数,300 次试验)</text>
<line x1="150" y1="40" x2="150" y2="200" stroke="var(--rule)"/>
<text x="20" y="62" fill="var(--ink)">60 条</text>
<rect x="150" y="46" width="266" height="16" fill="var(--compute)"/><text x="422" y="59" fill="var(--ink)">随机 26.6%</text>
<rect x="150" y="66" width="187" height="16" fill="var(--mem)"/><text x="343" y="79" fill="var(--ink)">分层 18.7%</text>
<text x="20" y="122" fill="var(--ink)">100 条</text>
<rect x="150" y="106" width="206" height="16" fill="var(--compute)"/><text x="362" y="119" fill="var(--ink)">随机 20.6%</text>
<rect x="150" y="126" width="157" height="16" fill="var(--mem)"/><text x="313" y="139" fill="var(--ink)">分层 15.7%</text>
<text x="20" y="182" fill="var(--ink)">160 条</text>
<rect x="150" y="166" width="183" height="16" fill="var(--compute)"/><text x="339" y="179" fill="var(--ink)">随机 18.3%</text>
<rect x="150" y="186" width="131" height="16" fill="var(--mem)"/><text x="287" y="199" fill="var(--ink)">分层 13.1%</text>
</g>
</svg>
<figcaption>琥珀色是随机抽,蓝色是差评多抽(各一半)。校准集越大区间越窄,但同样的条数下,分层总是更窄,因为 TNR 是在 fail 条上算的,分层让 fail 条多了 12 到 32 条。</figcaption>
</figure>

## 想把 TNR 估到 ±5 个点,要多少条差评

反过来问:我想要的精度是多少,校准集里至少要放几条人判 fail?用 Wilson 区间倒推,从 10 条开始一条条加,直到半宽不超过目标:

```python
# agent-zero-lab/part10/fails_needed.py
"""想让 TNR 的 95% 区间半宽不超过 target,校准集里至少要有多少条人判 fail?"""
from part10.stats import wilson_ci


def fails_needed(tnr: float, target: float = 0.05) -> int:
    n = 10
    while True:
        k = round(tnr * n)
        lo, hi = wilson_ci(k, n)
        if (hi - lo) / 2 <= target:
            return n
        n += 1


if __name__ == "__main__":
    for tnr in (0.66, 0.80, 0.90):
        print(f"TNR 约 {tnr:.2f}:半宽 ±5 点要 {fails_needed(tnr)} 条 fail,±10 点要 {fails_needed(tnr, 0.10)} 条")
```

<div class="line-notes">

- `def fails_needed(tnr: float, target: float = 0.05) -> int:` 给一个假设的 TNR 和目标半宽,返回需要的 fail 条数。
- `n = 10` 从 10 条开始试。
- `k = round(tnr * n)` 假设 n 条 fail 里裁判抓住了 `tnr * n` 条(四舍五入成整数),`n = 100`、`tnr = 0.8` 时就是 80。
- `lo, hi = wilson_ci(k, n)` Day 547 的 Wilson。
- `if (hi - lo) / 2 <= target:` 半宽,也就是区间宽度的一半,达标就返回。
- `n += 1` 没达标,多加一条再试。
- `if __name__ == "__main__":` 直接运行才打印,被别的文件 import 时不打印。

</div>

```bash
uv run python -m part10.fails_needed
```

```text
TNR 约 0.66:半宽 ±5 点要 342 条 fail,±10 点要 83 条
TNR 约 0.80:半宽 ±5 点要 245 条 fail,±10 点要 60 条
TNR 约 0.90:半宽 ±5 点要 141 条 fail,±10 点要 34 条
```

TNR 越低,要的条数越多:0.66 的裁判想估到 ±5 个点要 342 条 fail,校准集总共要近 700 条;换成 TNR 0.90 的裁判只要 141 条。**裁判越准,校准它越便宜。**所以顺序应该是先把裁判改好(给发票数据、写清规则),再去标校准集,而不是反过来。放宽到 ±10 个点,83 条就够。

这些数的一个现实意义:Day 358 留出的 18 条里 fail 只有 5 条,就算 5 条全抓住,TNR 1.000 的 Wilson 下限也只有 0.57 左右。校准集的 fail 条数不够,是评测里最常被偷偷省掉的一环。

## 给它写测试

统计函数一定要有测试,而且要有「已知答案」的那种。`corrected_rate` 有一个现成的已知答案:先假设裁判的 TPR、TNR 和真实通过率,正着算出裁判会报多少,再用校正倒推,应该回到原来的真实通过率。

```python
# agent-zero-lab/tests/test_judge_stats.py
import random

import pytest

from part10.judge_stats import corrected_rate, corrected_rate_ci, rates


def test_rates_counts():
    r = rates([1, 1, 1, 1, 0, 0, 0, 0], [1, 1, 1, 0, 0, 0, 1, 1])
    assert (r["tp"], r["fn"], r["tn"], r["fp"]) == (3, 1, 2, 2)
    assert r["tpr"] == 0.75 and r["tnr"] == 0.5


def test_corrected_rate_roundtrip():
    tpr, tnr, p = 1.0, 0.66, 0.70
    observed = p * tpr + (1 - p) * (1 - tnr)
    assert corrected_rate(observed, tpr, tnr) == pytest.approx(p)


def test_corrected_rate_rejects_always_pass_judge():
    with pytest.raises(ValueError, match="瞎猜"):
        corrected_rate(1.0, 1.0, 0.0)


def test_corrected_rate_clips_to_0_1():
    assert corrected_rate(0.99, 0.9, 0.5) == 1.0   # 算出来大于 1,裁成 1
    assert corrected_rate(0.01, 0.9, 0.5) == 0.0   # 算出来小于 0,裁成 0


def test_ci_is_reproducible_and_contains_point():
    rng = random.Random(1)
    human = [int(rng.random() < 0.7) for _ in range(300)]
    judge = [int(rng.random() < (0.95 if h else 0.3)) for h in human]
    prod = [int(rng.random() < 0.8) for _ in range(500)]
    a = corrected_rate_ci(prod, human, judge, n_boot=500, seed=0)
    b = corrected_rate_ci(prod, human, judge, n_boot=500, seed=0)
    assert a == b
    point, (lo, hi) = a
    assert lo <= point <= hi


def test_more_fail_samples_gives_narrower_interval():
    rng = random.Random(2)

    def width(n_pass: int, n_fail: int) -> float:
        human = [1] * n_pass + [0] * n_fail
        judge = [int(rng.random() < 0.95) for _ in range(n_pass)] + [int(rng.random() < 0.3) for _ in range(n_fail)]
        prod = [int(rng.random() < 0.8) for _ in range(500)]
        _, (lo, hi) = corrected_rate_ci(prod, human, judge, n_boot=800, seed=0)
        return hi - lo

    assert width(50, 50) < width(80, 20)
```

<div class="line-notes">

- `def test_rates_counts():` 手工构造 8 条:人判 4 过 4 不过,裁判判对 3 个过、2 个不过。`tp, fn, tn, fp` 应该是 3, 1, 2, 2。
- `observed = p * tpr + (1 - p) * (1 - tnr)` 正向公式。真通过的 70% 里裁判报 100%,真不通过的 30% 里裁判放过 34%。算出 `0.70 + 0.30 × 0.34 = 0.802`。
- `assert corrected_rate(observed, tpr, tnr) == pytest.approx(p)` 倒推回来必须是 0.70。`approx` 容忍浮点误差。
- `with pytest.raises(ValueError, match="瞎猜"):` 永远判通过的裁判(TPR 1、TNR 0)必须报错,而且报错信息里要有「瞎猜」。
- `assert corrected_rate(0.99, 0.9, 0.5) == 1.0   # 算出来大于 1,裁成 1` 抽样噪声会让结果超出 0 到 1,必须夹住。(0.99 + 0.5 − 1) / 0.4 = 1.225。
- `assert a == b` 同样的输入、同样的种子,区间必须一模一样,否则以后没法复现数字。
- `assert lo <= point <= hi` 点估计应当落在自己的区间里。
- `assert width(50, 50) < width(80, 20)` 同样 100 条,fail 多的那份区间必须更窄。这是今天最重要的那个结论,写成了测试。

</div>

```bash
uv run pytest tests/test_judge_stats.py -q
```

```text
......                                                                   [100%]
6 passed in 0.33s
```

## 校正什么时候悄悄失效

公式有一个前提:**裁判在校准集上的表现,和它在线上的表现一样。**TPR 和 TNR 是校准集里估出来的,用到线上才有意义。如果线上出现了校准集里没有的工单类型,裁判在那一类上的 TPR、TNR 可能完全不同,校正就会给出一个看起来很严谨、其实偏了的数。练习 3 把它做出来:校准集里只放「真有重复扣款」的工单,线上却混着「不是重复」的。

还有一个同样的道理:裁判的 prompt、模型版本变了,TPR、TNR 也跟着变,旧的校准集就过期了。这是 [Day 553](/blog/agent-zero/day-553-judge-scale-2/) 的内容(评审漂移)。

## 今天往 `judge_stats.py` 里加了什么

| 函数 | 做什么 | 哪一节 |
| --- | --- | --- |
| `rates(human, judge)` | 数 tp/fn/tn/fp,算 TPR、TNR 和 Wilson 区间 | 看裁判错在哪 |
| `corrected_rate(observed, tpr, tnr)` | Rogan–Gladen 校正,裁判不比瞎猜强时报错 | 看裁判错在哪 |
| `corrected_rate_ci(...)` | 校准集和线上集一起 bootstrap,校正后的区间 | 校正后的区间怎么来 |
| `draw(n_cal, stratified, seed)`(在 `judge_split.py`) | 切校准集和线上集 | 手里只有 100 条标注 |
| `fails_needed(tnr, target)` | 要多少条 fail 才够精度 | 想把 TNR 估到 ±5 个点 |

## 动手练习

1. **校准集加到 200 条。**用 `cal_size.py` 里的 `one_trial` 比较 200 条时随机抽和分层抽的区间宽度、平均 fail 条数,各做 200 次试验。想想为什么分层 200 条能用,300 条不能用。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex551_1.py
"""练习 1:校准集加到 200 条,分层 vs 随机,区间宽度怎么变。"""
import statistics

from part10.cal_size import one_trial

for strat in (False, True):
    res = [one_trial(200, strat, s) for s in range(200)]
    print("分层" if strat else "随机", f"平均差评 {statistics.mean(r[2] for r in res):.1f} 条,"
          f"区间宽度(中位) {statistics.median(r[0] for r in res):.1%},包住 {sum(r[1] for r in res) / len(res):.1%}")
```

<div class="line-notes">

- `from part10.cal_size import one_trial` 直接用上面的单次试验。
- `for strat in (False, True):` 先随机、再分层。
- `res = [one_trial(200, strat, s) for s in range(200)]` 校准集 200 条,200 次试验。
- `statistics.mean(r[2] for r in res)` 每次试验的第三项是校准集里人判 fail 的条数,取平均。
- `statistics.median(r[0] for r in res)` 第一项是区间宽度,取中位数。同一行最后的 `sum(r[1] for r in res) / len(res)`:第二项是布尔值,求和就是包住的次数,除以试验次数就是包住率。

</div>

```text
随机 平均差评 60.7 条,区间宽度(中位) 18.4%,包住 97.0%
分层 平均差评 100.0 条,区间宽度(中位) 11.8%,包住 99.5%
```

随机抽 200 条,平均 60.7 条 fail,区间宽 18.4%;分层抽 200 条,fail 正好 100 条,区间宽 11.8%。对照上一节的表,随机 160 条是 18.3%,随机 200 条是 18.4%,几乎没有再窄,差别淹没在噪声里(这次只做了 200 次试验,线上集也从 320 条缩到 280 条);分层从 160 条到 200 条,fail 从 80 涨到 100,宽度从 13.1% 降到 11.8%。池子里一共只有 145 条 fail,分层 300 条要 150 条 fail,不够用,所以 300 条做不了。真实项目里这个限制来自专家的时间,不来自池子,但道理一样:**能抽到的差评有上限,加校准集到某个点以后,先撞上的是差评不够。**包住率 99.5%,依然是有限池子带来的偏保守。

</details>

2. **换裁判 C 做同样的校准。**同一份分层 100 条校准集(种子 3),裁判 M 和裁判 C 各自校正出的区间。哪个更窄?为什么?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex551_2.py
"""练习 2:同一份校准集(分层 100 条),裁判 M 和裁判 C 各自校正出来的区间。"""
import json
from pathlib import Path

from part10.judge_split import draw, human
from part10.judge_stats import corrected_rate_ci, rates

HERE = Path(__file__).parent
pool = json.loads((HERE / "data" / "judge_pool.json").read_text())
cal, prod = draw(100, True, seed=3)
print(f"线上集真实通过率 {sum(human[i] for i in prod) / len(prod):.1%}")
for name in ("M", "C"):
    rows = {r["id"]: r["judge"] for r in json.loads((HERE / "data" / f"judge_{name}.json").read_text())}
    v = [rows[c["id"]] for c in pool]
    hc, jc, jp = [human[i] for i in cal], [v[i] for i in cal], [v[i] for i in prod]
    r = rates(hc, jc)
    point, (lo, hi) = corrected_rate_ci(jp, hc, jc)
    print(f"裁判 {name}:报 {sum(jp) / len(jp):.1%};TNR {r['tnr']:.2f};校正后 {point:.1%} [{lo:.1%}, {hi:.1%}] 宽 {hi - lo:.1%}")
```

<div class="line-notes">

- `cal, prod = draw(100, True, seed=3)` 同一份分层校准集,保证两个裁判是公平对比。
- `for name in ("M", "C"):` 依次换裁判。
- `rows = {r["id"]: r["judge"] for r in json.loads((HERE / "data" / f"judge_{name}.json").read_text())}` 读对应裁判的结果文件。
- `v = [rows[c["id"]] for c in pool]` 按 `pool` 的顺序排好。
- `hc, jc, jp = [human[i] for i in cal], [v[i] for i in cal], [v[i] for i in prod]` 校准集的人判、校准集的裁判判、线上的裁判判。
- `point, (lo, hi) = corrected_rate_ci(jp, hc, jc)` 默认 4000 轮,和 `calib_demo.py` 一致。

</div>

```text
线上集真实通过率 75.0%
裁判 M:报 83.7%;TNR 0.68;校正后 76.0% [67.8%, 82.1%] 宽 14.2%
裁判 C:报 77.1%;TNR 0.84;校正后 72.7% [66.0%, 78.2%] 宽 12.2%
```

C 比 M 窄两个点(12.2% 对 14.2%),原因是 C 的 TNR 更高(这份校准集上 0.84 对 0.68):裁判更准,校正公式的分母 `TPR + TNR − 1` 更大,校准集上 TNR 估计误差被放大得更少。真实通过率 75.0%,M 校正出 76.0%,C 校正出 72.7%,都在各自区间里。C 报的数(77.1%)本来就离真值近,校正修得少。**能直接把裁判改准,比靠校准集救一个差裁判划算。**

</details>

3. **校准集里缺一类工单。**只用 `kind == "dup"` 的前 100 条当校准集,线上集是剩下的 dup 加全部 nodup。校正还准吗?分类看一下裁判在两类 fail 上各抓住多少。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex551_3.py
"""练习 3:校准集里没有「不是重复扣款」这一类工单,线上却有。校正会怎样?"""
from part10.judge_split import human, pool, verdict
from part10.judge_stats import corrected_rate_ci, rates

dup = [i for i, c in enumerate(pool) if c["kind"] == "dup"]
nodup = [i for i, c in enumerate(pool) if c["kind"] == "nodup"]
cal = dup[:100]                                    # 校准集只来自「真有重复扣款」的工单
prod = dup[100:] + nodup                            # 线上两类都有
hc, jc, jp = [human[i] for i in cal], [verdict[i] for i in cal], [verdict[i] for i in prod]
r = rates(hc, jc)
print(f"校准集 {len(cal)} 条:TPR {r['tpr']:.2f} TNR {r['tnr']:.2f}(fail {r['tn'] + r['fp']} 条)")
point, (lo, hi) = corrected_rate_ci(jp, hc, jc)
print(f"线上 {len(prod)} 条:裁判报 {sum(jp) / len(jp):.1%},校正后 {point:.1%} [{lo:.1%}, {hi:.1%}]")
print(f"真实通过率 {sum(human[i] for i in prod) / len(prod):.1%}")
for kind, idx in (("dup", dup[100:]), ("nodup", nodup)):
    fails = [i for i in idx if human[i] == 0]
    print(f"  线上 {kind} 类里人判 fail {len(fails)} 条,裁判抓住 {sum(1 for i in fails if verdict[i] == 0)} 条")
```

<div class="line-notes">

- `dup = [i for i, c in enumerate(pool) if c["kind"] == "dup"]` 所有真重复的工单下标。`enumerate` 同时给下标和元素。
- `nodup = [i for i, c in enumerate(pool) if c["kind"] == "nodup"]` 所有「不是重复」的工单下标。
- `cal = dup[:100]                                    # 校准集只来自「真有重复扣款」的工单` 校准集的 100 条全部来自 dup。
- `prod = dup[100:] + nodup                            # 线上两类都有` 线上有 dup 剩下的,也有全部 nodup。两个列表用 `+` 拼接。
- `print(f"校准集 {len(cal)} 条:TPR {r['tpr']:.2f} TNR {r['tnr']:.2f}(fail {r['tn'] + r['fp']} 条)")` 先看校准集上裁判的成绩。
- `for kind, idx in (("dup", dup[100:]), ("nodup", nodup)):` 最后分两类,各数线上的 fail 里裁判抓住几条。
- `fails = [i for i in idx if human[i] == 0]` 这一类里人判 fail 的下标。
- `sum(1 for i in fails if verdict[i] == 0)` 其中裁判也判 fail 的条数。

</div>

```text
校准集 100 条:TPR 1.00 TNR 0.85(fail 41 条)
线上 380 条:裁判报 83.9%,校正后 81.2% [75.8%, 85.8%]
真实通过率 72.6%
  线上 dup 类里人判 fail 68 条,裁判抓住 56 条
  线上 nodup 类里人判 fail 36 条,裁判抓住 5 条
```

校准集里裁判的 TNR 是 0.85,看着还行。线上 380 条,裁判报 83.9%,校正出 81.2%,区间 [75.8%, 85.8%],可真实通过率是 72.6%,在区间外面。分类一数就明白了:dup 类的 68 条 fail 抓住 56 条(0.82,和校准集里的 0.85 差不多);nodup 类的 36 条 fail 只抓住 5 条(0.14)。裁判在「加购费被错退」这类回复上几乎完全看不出来,而校准集里没有这一类,TNR 就被高估了。区间画得很窄,结论错得很安静,这种失效不会报错。**校准集要覆盖线上有的每一类工单,至少是每一类高风险的。**

</details>

4. **(开放题)给你的下一个裁判排一个校准计划。**假设专家标一条平均 2 分钟。给出三种目标(TNR 0.80 精度 ±10、TNR 0.80 精度 ±5、TNR 0.90 精度 ±5)的校准集大小和标注时间。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex551_4.py
"""练习 4 的示范:给一个新裁判排校准集计划。数字是假设的,算式是真的。"""
from part10.fails_needed import fails_needed

MIN_PER_LABEL = 2.0      # 假设:专家标一条平均 2 分钟(要读工单、回复和发票)
PASS_SHARE = 0.5         # 分层抽样:pass 和 fail 各一半
print(f"{'假设的 TNR':>10} {'目标半宽':>8} {'要 fail 条数':>12} {'校准集总数':>10} {'标注时间':>8}")
for tnr, target in ((0.80, 0.10), (0.80, 0.05), (0.90, 0.05)):
    n_fail = fails_needed(tnr, target)
    total = round(n_fail / (1 - PASS_SHARE))
    print(f"{tnr:>10.2f} {'±' + format(target * 100, '.0f') + ' 点':>8} {n_fail:>12} {total:>10} {total * MIN_PER_LABEL / 60:>7.1f} 小时")
```

<div class="line-notes">

- `from part10.fails_needed import fails_needed` 直接用上面写的函数。
- `MIN_PER_LABEL = 2.0      # 假设:专家标一条平均 2 分钟(要读工单、回复和发票)` 这个数是我假设的,换成你们专家的真实速度。
- `PASS_SHARE = 0.5         # 分层抽样:pass 和 fail 各一半` 分层各一半,所以校准集总数是 fail 条数的两倍。
- `n_fail = fails_needed(tnr, target)` 每种目标要的 fail 条数。
- `total = round(n_fail / (1 - PASS_SHARE))` 总数 = fail 条数 ÷ 0.5。
- `total * MIN_PER_LABEL / 60` 总数乘每条分钟数,再除以 60 得小时。

</div>

```text
   假设的 TNR     目标半宽    要 fail 条数      校准集总数     标注时间
      0.80    ±10 点           60        120     4.0 小时
      0.80     ±5 点          245        490    16.3 小时
      0.90     ±5 点          141        282     9.4 小时
```

TNR 0.80 的裁判,要 ±10 个点只要标 120 条、4 小时;要 ±5 个点要 490 条、16 小时,一个专家两天。如果裁判能改到 TNR 0.90,同样 ±5 个点只要 282 条、9.4 小时。方案里还应该写清楚:校准集覆盖哪几类工单(练习 3 的教训)、多久补一次新样本(Day 553)、标注指南有没有版本号(Day 553 的多人标注)。

</details>

**验收标准**:`judge_stats.py` 的 6 个测试全过;练习 1 到 3 的输出和文中的数字量级一致(随机数种子相同时应当一模一样);练习 3 能说出「校正为什么看起来没毛病、实际偏了」;练习 4 的计划里有时间算式。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 裁判(LLM-as-judge) | 让大模型读工单和回复,判断「对不对」,代替人看大批回复。Day 357 起讲过 |
| 校准集 | 一小份有人工标注的样本,同时也让裁判判一遍,用来估裁判有多准。通常和线上数据分开 |
| TPR(真正率) | 人判通过的回复里,裁判也判通过的比例。医学里叫灵敏度。Day 358 讲过 |
| TNR(真负率) | 人判不通过的回复里,裁判也判不通过的比例。医学里叫特异度。裁判偏松时它是第一个掉的 |
| Rogan–Gladen 校正 | 用 TPR 和 TNR 把裁判报的通过率反推成真实通过率的公式,1978 年流行病学里用来修正筛查结果。Day 358 里叫「修正通过率」 |
| 分层抽样(差评多抽) | 抽样时按类别规定数量,不按自然比例。这里是 pass 和 fail 各抽一半,让 fail 条数够 |
| 条件概率 | 「在某个前提下,发生某件事的概率」。TPR 的前提是「人判通过」,TNR 的前提是「人判不通过」 |
| bootstrap | 把手里的样本当成整个世界,有放回地重抽很多次,看统计量怎么波动。Day 549 讲过 |
| 宽松偏差 | 裁判倾向判通过,把坏回复放过去。TNR 低就是它的表现 |
| 包住率 | 用这种办法画区间,重复很多次,有多大比例的区间包住真值。Day 547 讲过 |

## 常见误区

**校准集按线上比例随机抽。**线上差评少,随机抽出来的校准集里 fail 也少。今天 100 条里随机抽只有 34 条 fail,分层有 50 条,区间宽度差了 5 个点。TNR 只能在 fail 条上估,fail 要多抽。

**把分层抽样的校准集当成线上的缩影,用它直接算通过率。**它的通过率是你人为设成的 50%。TPR、TNR 是条件概率,不受影响,但「这批有多少通过」不能从它里面读。

**报裁判的通过率,附一个 Wilson 区间。**区间只有抽样误差。今天裁判 M 报 83.7%,Wilson 区间 [79.6%, 87.1%],真值 75.0%,在区间外。区间画得再精确,中心是歪的。

**只报校正后的点估计。**同样 380 条线上数据,校正出的数区间宽 14 到 17 个点,比你以为的 ±4 个点宽得多。点估计不带区间,等于假装校准集是完美的。

**裁判全判通过也想校正。**裁判 A 对 480 条全判通过,TPR+TNR−1 正好是 0,公式没法用。校正救不了没有判别力的裁判,先把裁判改好。

**裁判越偏,越要加校准集。**反过来:TNR 0.66 的裁判要 342 条 fail 才能估到 ±5 个点,TNR 0.90 的只要 141 条。裁判越准校准越便宜,优先把 prompt 和输入材料改好。

**校准集一劳永逸。**校准集里没有的工单类型,校正会悄悄失效(练习 3)。裁判换了模型或 prompt 也一样。校准集要有覆盖面、要定期补。

## 学习资料

### 文档与文章

- [Lee 等 · How to Correctly Report LLM-as-a-Judge Evaluations](https://arxiv.org/abs/2511.21140):2025 年 11 月的论文,讲的就是今天这件事:裁判的灵敏度和特异度不完美,会让通过率有偏;用校准集校正,并把测试集和校准集两边的不确定性都算进置信区间;还讨论怎么分配校准样本。读摘要和引言,约 20 分钟。我只读了摘要,没有逐条核对论文里的公式和今天的实现是否一样。
- [Rogan & Gladen · Estimating prevalence from the results of a screening test](https://pubmed.ncbi.nlm.nih.gov/623091/):1978 年的原始论文(Am J Epidemiol),今天的校正公式出处,讲的是医学筛查。只看摘要,知道公式来自流行病学就行。
- [Miller · Adding Error Bars to Evals](https://arxiv.org/abs/2411.00640):Day 547 起用到的那篇,把评测当统计问题写区间,今天的区间是它思路的延伸。
- [Hamel Husain · Using LLM-as-a-Judge For Evaluation: A Complete Guide](https://hamel.dev/blog/posts/llm-judge/):怎么从人工标注开始造一个可信的裁判,和今天的校准集是同一个出发点。
- [Anthropic · Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):Anthropic 工程博客,Agent 评测里评分器的类型和怎么和人工对齐,读评分器那几节。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV14PtwziE6S&autoplay=0&high_quality=1" title="人话统计学概念:置信区间!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>DataCafe · 人话统计学概念:置信区间! · 5 分钟。今天的区间是「两份数据一起算」的置信区间,统计基础薄的同学先建立「区间在说什么」的直觉。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1rAbp66Eyi&autoplay=0&high_quality=1" title="怎样设计LLM-as-Judge才能让评分可信" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>酌沧 · 怎样设计LLM-as-Judge才能让评分可信 · 7 分钟。中文讲评分 prompt 的设计要点,对照今天 A、C、M 三个 prompt 的差别。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/vP06aMoz4v8" title="Machine Learning Fundamentals: Sensitivity and Specificity" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>StatQuest with Josh Starmer · Machine Learning Fundamentals: Sensitivity and Specificity · 英文。Sensitivity 就是 TPR,Specificity 就是 TNR,医学和统计里用这两个名字。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/tqUDjc1HzO4" title="How to Automate AI Evals (Correctly)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hamel Husain · How to Automate AI Evals (Correctly) · 27 分钟。从人工标注走到自动评分器,后半段讲怎么和人工对齐,对应今天的校准集。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):第 3 章讲评估方法,包含 AI 当裁判的局限,英文原版。我没有逐章核对页码,按章名找。
- Peter Bruce、Andrew Bruce、Peter Gedeck《Practical Statistics for Data Scientists》(第 2 版,O'Reilly,2020):bootstrap、置信区间和分类评估指标,英文原版,统计基础薄的读者当工具书。

### 开源项目与代码

- [scipy.stats.bootstrap](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html):现成的 bootstrap 实现,Day 549 对过答案。今天的双来源重抽它不直接支持,所以自己写。
- [Langfuse](https://github.com/langfuse/langfuse):开源的 LLM 可观测平台,有评测和人工标注队列,Day 553 会再提。

## 自测

1. 为什么裁判 A 对 480 条全判通过,校正公式会报错?

<details><summary>答案</summary>

A 的 TPR 是 1.000、TNR 是 0,分母 `TPR + TNR − 1` 等于 0。分母衡量裁判比瞎猜强多少,等于 0 说明它的判断和真实情况无关,没法反推。要先把裁判改好。

</details>

2. 为什么分层抽样得到的 TPR、TNR 不会被带歪,却不能拿来直接算通过率?

<details><summary>答案</summary>

TPR 和 TNR 是条件概率,各自只在「人判通过」或「人判不通过」的那类样本里算,两类样本各占多少对它们没有影响。但「通过率」是整体里通过的比例,分层抽样把 pass 和 fail 人为设成了一半一半,不再代表线上。

</details>

3. 裁判报 83.7%,Wilson 区间 [79.6%, 87.1%],真值 75.0%。区间为什么没包住真值?

<details><summary>答案</summary>

Wilson 区间只描述「线上 380 条是抽样来的」带来的误差。裁判本身系统性偏高(宽松偏差,TNR 0.68)是另一种误差,区间看不见它。要用校准集校正,并把校准集的误差也算进区间。

</details>

4. 校正后的区间里有哪两个误差来源?哪个通常更大?

<details><summary>答案</summary>

线上样本的抽样误差,和校准集估 TPR、TNR 的抽样误差。后者通常更大,因为 TNR 只在校准集里人判 fail 的那几十条上算,条数少。

</details>

5. (面试题)你们的线上评测用 LLM 裁判,裁判报通过率 85%。产品经理问「真的有 85% 吗」,你怎么回答,需要做什么?

<details><summary>答案</summary>

不能直接说有。要先拿一份人工标注的校准集,估出裁判的 TPR 和 TNR:TNR 偏低说明裁判偏松,85% 是高估。校准集要差评多抽,覆盖线上每一类工单。然后用 Rogan–Gladen 公式校正,并用 bootstrap 把线上样本和校准集两边的误差都算进区间,汇报「校正后约 X%,区间 [a, b]」。再补一句边界:校正假设裁判在校准集和线上表现一致,换了裁判版本或出现新类型工单,要重新校准。

</details>

6. 想把 TNR 估到 ±5 个点,TNR 0.66 和 TNR 0.90 的裁判各需要多少条人判 fail?这说明什么?

<details><summary>答案</summary>

0.66 要 342 条,0.90 要 141 条。裁判越准,校准它需要的差评条数越少。所以先把裁判改好(给输入材料、写清规则),再标校准集。

</details>

## 明天预告

Day 552 · 第 79 周复习:进阶(Day 546–551)。这一周从评测流程和分工,到四天的评测统计,再到今天的裁判校准,线索是同一条:每个数字都要说清它有多可信。明天不学新东西,画一张六天的知识地图,默写 Wilson 区间和校正公式,再用一个小项目 `report79.py` 把「v1 对 v2 的比较」和「裁判判的线上通过率」拼成一份周报。
