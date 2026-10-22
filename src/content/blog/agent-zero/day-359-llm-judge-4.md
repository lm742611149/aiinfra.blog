---
title: 'Day 359 · LLM-as-judge(四):偏差和成本'
description: '论文里说评分器有位置偏差和长度偏差。今天自己测:写一个两两比较的评分器,同一对回复交换顺序各判一次;给回复加长、加客套话、加「出处」,看评分器会不会被带偏。最后看缓存命中,算清一轮全量评分要花多少钱。'
pubDate: 2026-10-22
regime: none
tags: ['eval', 'llm-as-judge', 'bias', 'agent-zero']
series: 'agent-zero'
day: 359
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 358](/blog/agent-zero/day-358-llm-judge-3/) 做了对齐:40 条模型生成的回复亲手标完,分成 train、dev、test,评分器 `facts-v1` 在 test 上 TPR 0.923、TNR 1.000、kappa 0.870。还推了一个修正公式,用 TPR 和 TNR 把评分器报的通过率换算回真实通过率。

那天结尾留了个问题。我们的评分器每次只看一条回复,判 pass 还是 fail。可评测里还有另一种很常见的问法:「新版 prompt 和旧版 prompt,哪个回复得更好?」这就要把两条回复同时摆给评分器。论文说这时候评分器会偏向放在前面的那条,还会偏向更长的那条。今天把这两件事亲手测一遍,顺便把评分器的账算清楚。

## 今天要解决的问题

学完今天你应该能:

1. 写一个两两比较的评分器,用「交换顺序各判一次」的实验测出它有没有**位置偏差**,并说清楚为什么两次结论不一致时要记成平局。
2. 用三个对照实验测**长度偏差**:两条都对的回复一长一短;错的回复外面包一层客套话;同样的包装换给 1 到 10 分的评分器。说出哪种评分方式最容易被长度带偏。
3. 从 DeepSeek 返回的 `usage` 里读出缓存命中的 token,按 2026 年 10 月的价格算出一轮全量评分要花多少钱,知道钱主要花在哪。

今天两个新概念:**位置偏差**和**长度偏差**。「两两比较」是承载它们的评分方式,一起讲;成本那节用的是前面学过的东西:从 `usage` 算人民币、缓存命中价更便宜,都在 [Day 124](/blog/agent-zero/day-124-cost/) 讲过;缓存命中的规矩 [Day 397](/blog/agent-zero/day-397-prompt-caching/) 还会专门讲,今天只看个现象。

预计用时 2.5 小时。实跑一共调了大约 320 次模型,花费不到 0.4 元,算式在成本那一节。前置:Day 357 的 `part06/llm_judge.py`(今天直接从它导入 `client`、`judge_facts` 和计数器 `USAGE`);Day 358 标好的 `part06/cases/align_labels.jsonl`;[Day 353](/blog/agent-zero/day-353-stats-intuition/) 的置信区间直觉。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章把 `compare_swapped` 默写出来;做练习时先自己写,做不出再展开参考答案,看完关掉重写一遍。

## 准备:两两比较是什么

到昨天为止,评分器都是**单条判定**(pointwise):给它一条回复和一套标准,它说 pass 或 fail。另一种是**两两比较**(pairwise):给它同一张工单的两条回复 A 和 B,问哪条更好。

两两比较常用在两个地方。一是比较两个版本,比如改了 Agent 的 prompt,想知道新版回复是不是比旧版好;二是做排行榜,LMSYS 的 Chatbot Arena 就是让人(后来也让模型)一对一对地比。它的好处是不用写绝对标准,「哪个更好」比「好到几分」容易判。坏处就是今天要测的:评分器会被跟内容无关的东西影响,比如谁放在前面、谁更长。

所有命令都在练习仓库根目录 `agent-zero-lab/` 下跑,依赖和 `.env` 都沿用 Day 357,不用装新东西。先写评分器:

```python
# agent-zero-lab/part06/pairwise_judge.py
"""两两比较评分器:给同一张工单的两条回复,问哪条更好。用来观察位置偏差和长度偏差。"""
from __future__ import annotations

import json
from typing import Literal

from pydantic import BaseModel, ValidationError

from part06.llm_judge import EXTRA, JUDGE_MODEL, USAGE, client

PAIR_PROMPT = """你是云簿 CloudLedger 的客服质检员。下面是同一张工单的两条客服回复 A 和 B,请判断哪条更好。
「更好」指:更准确、更完整地传达了要点,并且没有和要点矛盾的说法。{extra_rule}

<facts>{facts}</facts>
<ticket>{ticket}</ticket>
<reply_a>{a}</reply_a>
<reply_b>{b}</reply_b>

先写 critique(一两句),再给 winner:A、B,或者两条一样好时给 tie。只输出 JSON:{{"critique": "...", "winner": "A|B|tie"}}"""


class Pairwise(BaseModel):
    critique: str
    winner: Literal["A", "B", "tie"]


def compare(ticket: str, facts: list[str], a: str, b: str, extra_rule: str = "") -> Pairwise:
    prompt = PAIR_PROMPT.format(facts=json.dumps(facts, ensure_ascii=False), ticket=ticket,
                                a=a, b=b, extra_rule=extra_rule)
    for _ in range(3):
        resp = client.chat.completions.create(
            model=JUDGE_MODEL, temperature=0, extra_body=EXTRA,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}])
        USAGE["calls"] += 1
        if resp.usage:
            USAGE["in"] += resp.usage.prompt_tokens
            USAGE["out"] += resp.usage.completion_tokens
        try:
            return Pairwise.model_validate_json(resp.choices[0].message.content or "")
        except ValidationError:
            continue
    return Pairwise(critique="无法解析", winner="tie")


def compare_swapped(ticket: str, facts: list[str], x: str, y: str, extra_rule: str = "") -> tuple[str, str, str]:
    """x、y 各放前面判一次。返回 (第一次谁赢, 第二次谁赢, 最终结论),赢家用 x / y / tie 表示。"""
    first = compare(ticket, facts, x, y, extra_rule).winner     # x 在 A 位
    second = compare(ticket, facts, y, x, extra_rule).winner    # y 在 A 位
    r1 = {"A": "x", "B": "y", "tie": "tie"}[first]
    r2 = {"A": "y", "B": "x", "tie": "tie"}[second]
    return r1, r2, (r1 if r1 == r2 else "tie")
```

<div class="line-notes">

- `from part06.llm_judge import EXTRA, JUDGE_MODEL, USAGE, client` 不新建客户端,直接复用 Day 357 那个文件里的。好处是评分器模型、`extra_body`(关掉思考模式)、token 计数器都和单条评分器是同一套,今天实测都是 `deepseek-flash`。
- `PAIR_PROMPT = """你是云簿 CloudLedger 的客服质检员。` 结构照搬 Day 357 的 `FACTS_PROMPT`:一句任务、判定标准、待判定内容、输出要求。为了让实验只测偏差,这里故意没放例子。
- `「更好」指:更准确、更完整地传达了要点,并且没有和要点矛盾的说法。{extra_rule}` 「更好」也得有定义,不然评分器会按自己的口味判。`{extra_rule}` 是留给第二步的插槽,默认是空串,第二步会往里塞一句「别因为长就判它好」。
- `<reply_a>{a}</reply_a>` 两条回复用不同的 XML 标签包起来,`a` 永远放前面。今天所有实验的变量就是「谁进了 `a`」。
- `先写 critique(一两句),再给 winner:A、B,或者两条一样好时给 tie。` 给了 tie 这个出口。两条都对的时候,硬逼它选一个,它只能凭和内容无关的东西去选,下面会专门测「不给 tie」的情况。花括号照旧写两层。
- `winner: Literal["A", "B", "tie"]` 和 Day 357 的 `Verdict` 一个思路,用 `Literal` 把取值限死,模型写出 `"a"` 或 `"平局"` 都会校验失败、重试。
- `for _ in range(3):` 最多试 3 次。和 `judge_facts` 的写法一样,只是没有单独的 `retries` 参数。
- `return Pairwise(critique="无法解析", winner="tie")` 三次都解析失败就当平局。今天所有实验里一次都没走到这一行。
- `def compare_swapped(ticket: str, facts: list[str], x: str, y: str, extra_rule: str = "") -> tuple[str, str, str]:` 这是今天的核心函数。参数里不叫 a、b,叫 x、y,因为它们会轮流坐 A 位。
- `first = compare(ticket, facts, x, y, extra_rule).winner     # x 在 A 位` 第一次 x 在前。
- `second = compare(ticket, facts, y, x, extra_rule).winner    # y 在 A 位` 第二次把顺序对调,y 在前。
- `r1 = {"A": "x", "B": "y", "tie": "tie"}[first]` 把「A 赢」翻译回「x 赢」。字典当查找表用,相当于 JS 里 `({A: "x", B: "y", tie: "tie"})[first]`。
- `r2 = {"A": "y", "B": "x", "tie": "tie"}[second]` 第二次 y 在 A 位,所以「A 赢」翻译成「y 赢」。翻译完,两次结论就能直接比了。
- `return r1, r2, (r1 if r1 == r2 else "tie")` 两次说法一致才算数,不一致记平局。这就是 MT-Bench 那篇论文推荐的做法。返回三个值是为了让实验脚本能统计「到底有几对翻了」。

</div>

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="交换顺序实验:同一对回复 x 和 y,第一次 x 在 A 位,第二次 y 在 A 位,两次翻译成 x/y 视角后一致才算数">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink-soft)">第一次</text>
<rect x="80" y="12" width="90" height="28" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="125" y="31" fill="var(--ink)" text-anchor="middle">A 位: x</text>
<rect x="180" y="12" width="90" height="28" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="225" y="31" fill="var(--ink)" text-anchor="middle">B 位: y</text>
<text x="290" y="31" fill="var(--ink)">→ 评分器说 A → 翻译成 x 赢</text>
<text x="20" y="78" fill="var(--ink-soft)">第二次</text>
<rect x="80" y="62" width="90" height="28" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="125" y="81" fill="var(--ink)" text-anchor="middle">A 位: y</text>
<rect x="180" y="62" width="90" height="28" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="225" y="81" fill="var(--ink)" text-anchor="middle">B 位: x</text>
<text x="290" y="81" fill="var(--ink)">→ 评分器说 B → 翻译成 x 赢</text>
<line x1="20" y1="108" x2="620" y2="108" stroke="var(--rule)"/>
<text x="20" y="134" fill="var(--ink)">两次都是 x 赢 → 结论 x,内容真的占优</text>
<text x="20" y="160" fill="var(--ink)">两次都说 A(一次 x 赢一次 y 赢)→ 结论 tie,它只是爱选前面</text>
<text x="20" y="186" fill="var(--ink)">一次 x 一次 tie → 结论 tie,差别小到说不准</text>
<text x="20" y="214" fill="var(--ink-faint)" font-size="11">代价:每对回复要调两次模型,评分的钱翻倍</text>
</g>
</svg>
<figcaption>交换顺序各判一次。评分器真的觉得 x 更好,它在两种摆法下都会选 x;它要是只认位置,两次都说 A,翻译过来就成了一次 x、一次 y,结论自动变平局。</figcaption>
</figure>

## 第一步:位置偏差,交换顺序实验

**位置偏差**(position bias)说的是:两条回复的内容不变,只是换一下谁放前面,评分器的结论就变了。它不一定偏向前面,也可能偏向后面,关键是「结论跟着位置走,不跟着内容走」。

测它的办法就是上面那张图:同一对回复交换顺序各判一次,数一数有多少对的结论翻了。光测一种回复对不够,要分两组。一组是**两条都对**的回复,质量很接近,评分器最容易拿不准;另一组是**一对一错**,差别明显,当对照组。对照组要是也翻,说明评分器连明显的差别都看不住,问题就大了。

数据直接用 Day 358 标好的 40 条。按工单分组,同一张工单的回复才能放一起比。

```python
# agent-zero-lab/part06/bias_position.py
"""位置偏差实验:同一对回复,交换顺序各判一次,看结论会不会跟着位置走。"""
from __future__ import annotations

import json
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from part06.llm_judge import USAGE
from part06.pairwise_judge import compare_swapped

rows = [json.loads(line) for line in Path("part06/cases/align_labels.jsonl").read_text(encoding="utf-8").splitlines()]
groups: dict[str, list[dict]] = {}
for r in rows:
    groups.setdefault(r["id"].rsplit("-", 1)[0], []).append(r)

close_pairs, easy_pairs = [], []
for g in groups.values():
    good = [r for r in g if r["human"] == "pass" and len(r["reply"]) < 200]
    bad = [r for r in g if r["human"] == "fail"]
    close_pairs += list(zip(good, good[1:]))          # 两条都对,难分高下
    easy_pairs += [(good[0], b) for b in bad]         # 一对一错,差别明显


def run(pairs: list[tuple[dict, dict]], name: str) -> None:
    with ThreadPoolExecutor(max_workers=4) as pool:
        res = list(pool.map(lambda p: compare_swapped(p[0]["ticket"], p[0]["facts"], p[0]["reply"], p[1]["reply"]), pairs))
    first_pos = sum((r1 == "x") + (r2 == "y") for r1, r2, _ in res)   # 两次判定里,放在 A 位的那条赢了几次
    flips = sum(r1 != r2 for r1, r2, _ in res)
    print(f"{name}: {len(pairs)} 对,共 {2 * len(pairs)} 次判定")
    print(f"  A 位赢 {first_pos} 次,B 位赢 {sum((r1 == 'y') + (r2 == 'x') for r1, r2, _ in res)} 次,"
          f"tie {sum((r1 == 'tie') + (r2 == 'tie') for r1, r2, _ in res)} 次")
    print(f"  交换后结论变了 {flips} 对 / {len(pairs)} 对;最终结论 {Counter(f for _, _, f in res)}")
    for (x, y), (r1, r2, _) in zip(pairs, res):
        if r1 != r2:
            print(f"    {x['id']} vs {y['id']}: x 在前时判 {r1},y 在前时判 {r2}")
    if name.startswith("一对一错"):
        print(f"  选中对的那条(x)的对数:{sum(f == 'x' for _, _, f in res)}")


if __name__ == "__main__":
    run(close_pairs, "两条都对")
    run(easy_pairs, "一对一错")
    print(f"调用 {USAGE['calls']} 次 · 输入 {USAGE['in']} token · 输出 {USAGE['out']} token")
```

<div class="line-notes">

- `groups: dict[str, list[dict]] = {}` 按工单分组的字典,key 是工单前缀,value 是这张工单的所有回复。
- `groups.setdefault(r["id"].rsplit("-", 1)[0], []).append(r)` `rsplit("-", 1)` 从右边切一刀:`"cancel-c023-04"` 切成 `["cancel-c023", "04"]`,取 `[0]` 就是工单前缀;手工改坏的 `"cancel-c023-m1"` 也切成 `"cancel-c023"`。`setdefault(key, [])` 的意思是 key 不存在就先放一个空列表进去,再把它返回,所以后面能直接 `.append`。相当于 JS 的 `(groups[k] ??= []).push(r)`。实测分出 4 组。
- `good = [r for r in g if r["human"] == "pass" and len(r["reply"]) < 200]` 只要人判 pass、而且 200 字以内的。那 4 条 400 多字的热情长回复先剔掉,留给第二步测长度。
- `bad = [r for r in g if r["human"] == "fail"]` 人判 fail 的,4 组加起来 11 条(Day 358 把 `cancel-c023-04` 改标成 pass 以后是 11 条)。
- `close_pairs += list(zip(good, good[1:]))          # 两条都对,难分高下` `zip(good, good[1:])` 把相邻两条配成对:第 1 和第 2、第 2 和第 3……。`cancel-c023` 有 7 条短的 pass,配出 6 对。四组合计 21 对。
- `easy_pairs += [(good[0], b) for b in bad]         # 一对一错,差别明显` 每条 fail 都和本组第一条 pass 配对,对的那条永远是 x。合计 11 对。
- `res = list(pool.map(lambda p: compare_swapped(p[0]["ticket"], p[0]["facts"], p[0]["reply"], p[1]["reply"]), pairs))` 4 个线程并发,每对调两次模型。`p[0]` 是 x,`p[1]` 是 y,同一组的工单和要点都一样,从 `p[0]` 取就行。
- `first_pos = sum((r1 == "x") + (r2 == "y") for r1, r2, _ in res)   # 两次判定里,放在 A 位的那条赢了几次` 第一次 x 在 A 位,x 赢就是 A 位赢;第二次 y 在 A 位,y 赢就是 A 位赢。两个布尔值相加得 0、1 或 2,再全部加起来。
- `flips = sum(r1 != r2 for r1, r2, _ in res)` 交换后结论变了的对数,这是今天最重要的数。
- `print(f"  A 位赢 {first_pos} 次,B 位赢 {sum((r1 == 'y') + (r2 == 'x') for r1, r2, _ in res)} 次,"` 位置偏差要是存在,A 位赢和 B 位赢会明显不对称。
- `for (x, y), (r1, r2, _) in zip(pairs, res):` 把每对回复和它的结果配起来,只打印翻了的那几对,方便回去读原文。
- `if name.startswith("一对一错"):` 对照组额外打印一行:最终选中对的那条有几对。
- `if __name__ == "__main__":` 实验放在这里面,下面两个脚本要从这个文件导入 `close_pairs` 和 `groups`,导入时不能把实验跑一遍。这是 Day 358 练习 3 踩过的坑。

</div>

```bash
uv run python -m part06.bias_position
```

实测输出:

```text
两条都对: 21 对,共 42 次判定
  A 位赢 17 次,B 位赢 16 次,tie 9 次
  交换后结论变了 3 对 / 21 对;最终结论 Counter({'x': 9, 'tie': 6, 'y': 6})
    cancel-c023-07 vs cancel-c023-08: x 在前时判 tie,y 在前时判 y
    cancel-c023-08 vs cancel-c023-09: x 在前时判 y,y 在前时判 tie
    wrong-c012-08 vs wrong-c012-09: x 在前时判 tie,y 在前时判 y
一对一错: 11 对,共 22 次判定
  A 位赢 11 次,B 位赢 11 次,tie 0 次
  交换后结论变了 0 对 / 11 对;最终结论 Counter({'x': 11})
  选中对的那条(x)的对数:11
调用 64 次 · 输入 18524 token · 输出 3802 token
```

先看对照组:11 对一对一错,交换顺序以后一对都没翻,而且 11 对全选中了对的那条。A 位赢 11 次、B 位赢 11 次,正好一半一半,说明它确实是看内容选的,对的那条不管放前面还是后面都赢。

再看两条都对的 21 对。A 位赢 17 次、B 位赢 16 次,几乎对称,**没有看出明显的「偏爱前面」**。不过有 3 对交换以后结论变了。仔细看这 3 对,都不是「这次选 x、换过来选 y」那种彻底反转,而是「一次选了某条,另一次说一样好」。它们本来就是质量很接近的两条回复,评分器在「略好一点」和「一样好」之间摇摆。

这里我要老实交代一件事:同样的脚本我第一次跑,翻的是 4 对,不是 3 对。温度 0 也不保证每次逐字相同(Day 357 说过),在这种拿不准的样本上,一点点不同就会让结论变。所以你自己跑出 2 对、5 对都正常。

### 不给 tie 会怎样

上面的评分器有 tie 这个出口。很多两两比较的 prompt 不给平局,硬要选一个(Chatbot Arena 早期的界面就是这样)。两条都对的时候硬逼它选,它只能凭和内容无关的东西去选,位置偏差最容易在这里冒出来。改一句 prompt 再跑:

```python
# agent-zero-lab/part06/bias_position_forced.py
"""位置偏差实验(二):不给 tie,逼评分器在两条都对的回复里二选一。"""
from __future__ import annotations

from part06 import pairwise_judge
from part06.bias_position import close_pairs
from part06.llm_judge import USAGE

pairwise_judge.PAIR_PROMPT = pairwise_judge.PAIR_PROMPT.replace(
    "再给 winner:A、B,或者两条一样好时给 tie。", "再给 winner:A 或 B,必须二选一。")

a_wins = b_wins = flips = 0
for x, y in close_pairs:
    r1, r2, _ = pairwise_judge.compare_swapped(x["ticket"], x["facts"], x["reply"], y["reply"])
    a_wins += (r1 == "x") + (r2 == "y")
    b_wins += (r1 == "y") + (r2 == "x")
    flips += r1 != r2
    if r1 != r2:
        print(f"  {x['id']} vs {y['id']}: x 在前判 {r1},y 在前判 {r2}")
print(f"两条都对、必须二选一:{len(close_pairs)} 对 · A 位赢 {a_wins} 次 · B 位赢 {b_wins} 次 · 交换后结论变了 {flips} 对")
print(f"调用 {USAGE['calls']} 次 · 输入 {USAGE['in']} token · 输出 {USAGE['out']} token")
```

<div class="line-notes">

- `from part06 import pairwise_judge` 导入整个模块,而不是 `from ... import PAIR_PROMPT`。下一行要改模块里的变量,只有通过 `模块.变量` 去改,`compare` 函数里读到的才是新值。
- `from part06.bias_position import close_pairs` 复用上一个脚本配好的 21 对。因为那边的实验包在 `if __name__ == "__main__":` 里,这里导入时不会重跑。
- `pairwise_judge.PAIR_PROMPT = pairwise_judge.PAIR_PROMPT.replace(` 运行时替换 prompt 里的一句话,原文件不动。做对照实验时这样改最省事,也不会忘了改回去。
- `"再给 winner:A、B,或者两条一样好时给 tie。", "再给 winner:A 或 B,必须二选一。")` 只改这一句,其余一个字不动,这样两次实验的差别只有「给不给 tie」。`Pairwise` 的 `Literal` 没改,模型要是还给 tie,校验照样通过。
- `a_wins = b_wins = flips = 0` 连等赋值,三个变量都从 0 开始。和 JS 的 `let a = b = c = 0` 不一样,Python 这样写不会造出全局变量。
- `flips += r1 != r2` 布尔值加到整数上,True 算 1。
- `print(f"  {x['id']} vs {y['id']}: x 在前判 {r1},y 在前判 {r2}")` 翻了的对打出来。这次不开线程,一对一对顺序跑,42 次调用大约一分钟。

</div>

```bash
uv run python -m part06.bias_position_forced
```

实测输出:

```text
  dup-c007-07 vs dup-c007-09: x 在前判 y,y 在前判 x
  basic-c009-07 vs basic-c009-09: x 在前判 x,y 在前判 tie
两条都对、必须二选一:21 对 · A 位赢 20 次 · B 位赢 21 次 · 交换后结论变了 2 对
调用 42 次 · 输入 12294 token · 输出 2423 token
```

`dup-c007-07` 和 `dup-c007-09` 这一对就是标准的位置偏差:x 在前时选了 y,y 在前时选了 x,两次都选了 B 位的那条。翻译回 x/y 视角就是一次 y、一次 x,`compare_swapped` 自动记成平局。`basic-c009-07` 那对里它还是给了一次 tie,说明「必须二选一」它也没完全听。

42 次判定里 A 位赢 20 次、B 位赢 21 次,整体上还是对称的。第一次跑这个脚本时是 4 对翻、A 位 B 位各 20 次,结论一样。**在今天这批数据上,deepseek-flash 的位置偏差很弱**:没有整体偏向哪一边,只是在难分高下的几对上会摇摆。

这和论文里的数差得很远。2023 年 MT-Bench 那篇论文([Zheng 等](https://arxiv.org/abs/2306.05685))用的也是「两条很像的回复,交换顺序」的做法,它表 2 里的结果是:

| 评分器(2023 年) | 交换后结论一致 | 偏向前面 | 偏向后面 |
| --- | --- | --- | --- |
| Claude-v1 | 23.8% | 75.0% | 0.0% |
| GPT-3.5 | 46.2% | 50.0% | 1.2% |
| GPT-4 | 65.0% | 30.0% | 5.0% |

Claude-v1 四分之三的情况都选前面那条。我们今天是 21 对里翻 2 到 4 对,一致率在 81% 到 90% 之间。差这么多有几个原因:模型新了三年;我们给了明确的「更好」的定义和要点清单,它有东西可对照;我们的回复都很短。2024 年有一篇专门研究位置偏差的论文《[Judging the Judges](https://arxiv.org/abs/2406.07791)》,结论之一是两条回复质量差距越小,位置偏差越明显,这和我们「对照组 0 翻、接近的对才翻」的现象一致。

那是不是就不用交换顺序了?我的看法是还要。一是你换个模型、换个任务、回复变长了,偏差可能就回来了,你不测就不知道;二是即使没有整体偏向,那 2 到 4 对的结论本身就是不可靠的,交换顺序能把它们标成平局,不让它们混进「新版赢了几对」的统计里。代价是钱翻倍,下面算账时会看到,对我们这个规模来说是几毛钱的事。

### 小结

位置偏差用「交换顺序各判一次」来测,也用它来治:两次一致才算数,不一致记平局。测的时候要分「差别明显」和「差别很小」两组,偏差主要出在后一组。今天这个评分器整体不偏,但难分的样本上会摇摆。

## 第二步:长度偏差

**长度偏差**(verbosity bias,也叫冗长偏差)说的是:评分器偏向更长、看起来更详细的回复,哪怕多出来的部分没有新信息。客服场景特别要防这个,好的客服回复往往很短:「剩 11 个整月,退 6578 元,这个月不退,要主管批」一句话就够了。

今天用三个实验从三个角度测它。

### 实验一:两条都对,一长一短

Day 358 生成回复时有一种「态度」是「认真回答,语气很热情、写得比较长」,每张工单都有一条 400 多字、人判 pass 的长回复。让它和同组 100 字以内的 pass 回复两两比较,交换顺序。如果评分器有长度偏差,长的会赢得多。再加一句规则跑第二遍,看能不能压住。

```python
# agent-zero-lab/part06/bias_length.py
"""长度偏差实验:两条都对的回复,一长一短,评分器偏不偏向长的?加一句规则以后呢?"""
from __future__ import annotations

import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

from part06.bias_position import groups
from part06.llm_judge import USAGE
from part06.pairwise_judge import compare_swapped

RULE = "不因为回复更长、更热情、更客气而判它更好;两条要点同样完整准确时,给 tie。"
extra = RULE if "--rule" in sys.argv else ""

pairs = []
for g in groups.values():
    long_ = next(r for r in g if r["human"] == "pass" and len(r["reply"]) > 300)
    shorts = [r for r in g if r["human"] == "pass" and len(r["reply"]) < 100][:3]
    pairs += [(long_, s) for s in shorts]

with ThreadPoolExecutor(max_workers=4) as pool:
    res = list(pool.map(lambda p: compare_swapped(p[0]["ticket"], p[0]["facts"], p[0]["reply"], p[1]["reply"], extra), pairs))

single = Counter(r1 for r1, _, _ in res) + Counter(r2 for _, r2, _ in res)
print(f"规则:{'有' if extra else '无'} · {len(pairs)} 对(x=长,y=短),共 {2 * len(pairs)} 次判定")
print(f"  单次判定:长的赢 {single['x']} 次,短的赢 {single['y']} 次,tie {single['tie']} 次")
print(f"  交换后最终结论:{Counter(f for _, _, f in res)}")
print(f"调用 {USAGE['calls']} 次 · 输入 {USAGE['in']} token · 输出 {USAGE['out']} token")
```

<div class="line-notes">

- `from part06.bias_position import groups` 复用按工单分好的 4 组。
- `RULE = "不因为回复更长、更热情、更客气而判它更好;两条要点同样完整准确时,给 tie。"` 这就是 Day 357 判定标准里「不评价语气、礼貌、格式和长度」的两两比较版。
- `extra = RULE if "--rule" in sys.argv else ""` 命令行带 `--rule` 就把这句塞进 prompt 的 `{extra_rule}` 插槽,不带就是空串。`sys.argv` 是命令行参数列表,相当于 Node 的 `process.argv`。同一个脚本跑两遍做对照,比复制一份改一行干净。
- `long_ = next(r for r in g if r["human"] == "pass" and len(r["reply"]) > 300)` `next(生成器)` 取第一个满足条件的元素,相当于 JS 的 `g.find(...)`。每组正好一条 300 字以上的 pass,实测是 `cancel-c023-03`(458 字)、`dup-c007-03`(412 字)、`basic-c009-03`(445 字)、`wrong-c012-03`(351 字)。变量名后面加下划线,是因为 `long` 读起来像个类型名,习惯上避开。
- `shorts = [r for r in g if r["human"] == "pass" and len(r["reply"]) < 100][:3]` 同组 100 字以内的 pass 取前 3 条。`basic-c009` 这组只有 2 条够短,所以总共 11 对,不是 12 对。
- `pairs += [(long_, s) for s in shorts]` 长的永远是 x,短的是 y。
- `single = Counter(r1 for r1, _, _ in res) + Counter(r2 for _, r2, _ in res)` 两个 `Counter` 可以直接相加,同名的计数加在一起。这里统计 22 次单次判定里 x(长)、y(短)、tie 各几次。

</div>

```bash
uv run python -m part06.bias_length
uv run python -m part06.bias_length --rule
```

实测输出:

```text
规则:无 · 11 对(x=长,y=短),共 22 次判定
  单次判定:长的赢 7 次,短的赢 11 次,tie 4 次
  交换后最终结论:Counter({'tie': 6, 'y': 3, 'x': 2})
调用 22 次 · 输入 10166 token · 输出 1324 token
规则:有 · 11 对(x=长,y=短),共 22 次判定
  单次判定:长的赢 3 次,短的赢 0 次,tie 19 次
  交换后最终结论:Counter({'tie': 10, 'x': 1})
调用 22 次 · 输入 10716 token · 输出 1396 token
```

没规则的时候,长的赢 7 次,短的赢 11 次。它没有偏向长的,反倒略偏短的。我读了几条短的赢了的理由,大意是「B 更简洁,直接给出了三条要点」。看来它把「准确、完整」理解成了「干净利落」,也算一种口味。

加上规则以后,22 次里 19 次是 tie,交换后 11 对里 10 对是平局。这才是我们想要的:两条都对,要点一样完整,就是一样好。剩下那 1 对长的赢,我回去读了理由,评分器说长回复「额外说明了取消后可以用到本期结束」,确实多讲了一个有用的点,不算偏差。

这一组的结论是:没有明确的「不看长度」,评分器会带着自己的口味判(这次的口味是偏短);写上一句,口味基本就压住了。

### 实验二:错的回复外面包一层客套话

两两比较测完了,再测我们真正在用的单条评分器 `judge_facts`。做法很粗暴:把 11 条人判 fail 的回复,前面加一句客套话,后面加两句客套话,错的那句一个字不动。回复从几十字变成两百多字,看起来认真、礼貌、详细多了。评分器会不会因此改判 pass?

```python
# agent-zero-lab/part06/bias_padding.py
"""单条判定的长度偏差:给判 fail 的回复前后加一段客套话,错的地方不动,评分器会不会改判 pass?"""
from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from part06.llm_judge import USAGE, judge_facts

HEAD = "您好!非常感谢您联系云簿 CloudLedger,也非常理解您此刻的心情,我们一直把每一位客户的体验放在第一位。"
TAIL = ("我们已经认真核对了您的账户信息和相关记录,以上是按照公司现行政策给您的完整说明。"
        "如果您还有任何疑问,欢迎随时回复本工单,我们 7×24 小时在线,一定第一时间为您处理。再次感谢您的耐心与支持,祝您工作顺利!")

rows = [json.loads(line) for line in Path("part06/cases/align_labels.jsonl").read_text(encoding="utf-8").splitlines()]
bad = [r for r in rows if r["human"] == "fail"]


def both(r: dict) -> tuple[str, str]:
    plain = judge_facts(r["ticket"], r["reply"], r["facts"]).verdict
    padded = judge_facts(r["ticket"], HEAD + r["reply"] + TAIL, r["facts"]).verdict
    return plain, padded


if __name__ == "__main__":
    with ThreadPoolExecutor(max_workers=4) as pool:
        res = list(pool.map(both, bad))
    for r, (plain, padded) in zip(bad, res):
        print(f"{r['id']:<15} 原文 {len(r['reply']):>3} 字 → {plain:<5}  加客套话 {len(HEAD + r['reply'] + TAIL):>3} 字 → {padded}")
    print(f"原文判 fail {sum(p == 'fail' for p, _ in res)}/{len(bad)} · 加客套话后判 fail {sum(q == 'fail' for _, q in res)}/{len(bad)}")
    print(f"调用 {USAGE['calls']} 次 · 输入 {USAGE['in']} token · 输出 {USAGE['out']} token")
```

<div class="line-notes">

- `HEAD = "您好!非常感谢您联系云簿 CloudLedger,也非常理解您此刻的心情,` 开头的客套话,和要点无关。
- `TAIL = ("我们已经认真核对了您的账户信息和相关记录,以上是按照公司现行政策给您的完整说明。"` 结尾的客套话。第一句我故意写得很笃定(「认真核对」「完整说明」),顺便测一点「权威感」。括号里两个字符串挨着写,Python 会自动拼成一个,相当于 JS 里用 `+` 把两段拼起来。
- `bad = [r for r in rows if r["human"] == "fail"]` 11 条人判 fail 的,全来自 Day 358 的标注,三份 split 都用上了。这里不调 prompt,只是测,不存在对 test 过拟合的问题。
- `plain = judge_facts(r["ticket"], r["reply"], r["facts"]).verdict` 原文判一次,作对照。不直接用 Day 358 的结果,是因为温度 0 也会有小波动,同一时间判一次对照更公平。
- `padded = judge_facts(r["ticket"], HEAD + r["reply"] + TAIL, r["facts"]).verdict` 包装后判一次。字符串用 `+` 拼接,和 JS 一样。
- `if __name__ == "__main__":` 下面练习 3 和对照组脚本要导入 `HEAD`、`TAIL`、`bad`,所以实验包起来。
- `print(f"{r['id']:<15} 原文 {len(r['reply']):>3} 字 → {plain:<5}` `:<15` 左对齐占 15 格,`:>3` 右对齐占 3 格,打印出来是整齐的表格。

</div>

```bash
uv run python -m part06.bias_padding
```

实测输出:

```text
cancel-c023-05  原文  68 字 → fail   加客套话 227 字 → fail
dup-c007-05     原文  87 字 → fail   加客套话 246 字 → fail
dup-c007-08     原文 109 字 → fail   加客套话 268 字 → fail
basic-c009-04   原文  43 字 → fail   加客套话 202 字 → fail
basic-c009-05   原文  98 字 → fail   加客套话 257 字 → fail
basic-c009-08   原文  30 字 → fail   加客套话 189 字 → fail
wrong-c012-05   原文  68 字 → fail   加客套话 227 字 → fail
cancel-c023-m1  原文  59 字 → fail   加客套话 218 字 → fail
dup-c007-m1     原文  57 字 → fail   加客套话 216 字 → fail
basic-c009-m1   原文  30 字 → fail   加客套话 189 字 → fail
wrong-c012-m1   原文  39 字 → fail   加客套话 198 字 → fail
原文判 fail 11/11 · 加客套话后判 fail 11/11
调用 22 次 · 输入 13566 token · 输出 1140 token
```

11 条全部还是 fail,一条没被骗到。回复长了三四倍、语气热情了、结尾还自称「完整说明」,评分器照样逐条对要点,把错的那句挑了出来。

### 实验三:同样的包装,换给 1 到 10 分的评分器

实验二说明 `judge_facts` 不怕包装。可它到底是因为模型本身不吃这一套,还是因为 Day 357 那套设计(二元判断、给要点、写明不看长度)起了作用?做一个对照:同样 11 条 fail、同样的包装,交给 Day 357 第一步那个反面教材评分器,不给要点,只问「打 1 到 10 分」。

```python
# agent-zero-lab/part06/bias_padding_score.py
"""对照组:同样加客套话,换成 Day 357 的反面教材「打 1-10 分、不给要点」,分数会不会涨?"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from part06.bias_padding import HEAD, TAIL, bad
from part06.llm_judge import EXTRA, JUDGE_MODEL, client


def score(ticket: str, reply: str) -> int:
    r = client.chat.completions.create(
        model=JUDGE_MODEL, temperature=0, extra_body=EXTRA,
        messages=[{"role": "user", "content": f"请给这条客服回复的质量打 1-10 分,只输出一个数字。\n工单:{ticket}\n回复:{reply}"}])
    return int((r.choices[0].message.content or "0").strip())


with ThreadPoolExecutor(max_workers=4) as pool:
    plain = list(pool.map(lambda r: score(r["ticket"], r["reply"]), bad))
    padded = list(pool.map(lambda r: score(r["ticket"], HEAD + r["reply"] + TAIL), bad))
for r, a, b in zip(bad, plain, padded):
    print(f"{r['id']:<15} 原文 {a:>2} 分 → 加客套话 {b:>2} 分")
print(f"平均:原文 {sum(plain) / len(plain):.2f} 分,加客套话 {sum(padded) / len(padded):.2f} 分;涨分 {sum(b > a for a, b in zip(plain, padded))} 条,降分 {sum(b < a for a, b in zip(plain, padded))} 条")
```

<div class="line-notes">

- `from part06.bias_padding import HEAD, TAIL, bad` 同样的 11 条、同样的包装,只换评分方式。
- `def score(ticket: str, reply: str) -> int:` prompt 就是 Day 357 `judge_v0_score.py` 那一句,唯一的区别是温度从 1.0 改成 0,和别的评分器条件一致。
- `return int((r.choices[0].message.content or "0").strip())` 把模型输出的数字字符串转成整数。模型要是没听话输出了「8 分」,`int()` 会抛 `ValueError`。这次 22 次都只输出了一个数字,没炸。正式用的话要像 `judge_facts` 那样校验、重试。

</div>

```bash
uv run python -m part06.bias_padding_score
```

实测输出:

```text
cancel-c023-05  原文  8 分 → 加客套话  8 分
dup-c007-05     原文  2 分 → 加客套话  4 分
dup-c007-08     原文  9 分 → 加客套话  9 分
basic-c009-04   原文  4 分 → 加客套话  3 分
basic-c009-05   原文  8 分 → 加客套话  8 分
basic-c009-08   原文  4 分 → 加客套话  4 分
wrong-c012-05   原文  9 分 → 加客套话  8 分
cancel-c023-m1  原文  6 分 → 加客套话  7 分
dup-c007-m1     原文  8 分 → 加客套话  8 分
basic-c009-m1   原文  3 分 → 加客套话  3 分
wrong-c012-m1   原文  2 分 → 加客套话  3 分
平均:原文 5.73 分,加客套话 5.91 分;涨分 3 条,降分 2 条
```

包装前后平均分只差 0.18,长度的影响也不大。但这张表真正吓人的不是长度,是原文那一列:`wrong-c012-05` 明明没有重复扣款,回复却说「确实发现您有一笔重复扣款,会尽快为您安排退款」,这是把钱白送出去的错,它给了 9 分;`cancel-c023-05` 把「按剩余整月」说成「按剩余天数折算」,8 分。11 条全是错的回复,平均 5.7 分,有 5 条在 8 分以上。

三个实验合起来看,今天的结论和论文的说法不太一样。在 deepseek-flash 和我们这批短回复上,长度偏差很弱:两两比较时它甚至略偏短的,单条判定时加长三四倍也骗不到它。**真正的问题是没有标准**:不给要点、不说什么算错,评分器根本不知道「按剩余天数」是错的,有没有长度偏差都判不对。论文里 2023 年的模型就没这么稳:MT-Bench 那篇用「把列表换个说法再重复一遍」的办法把回复加长,Claude-v1 和 GPT-3.5 有 91.3% 的情况觉得加长版更好,GPT-4 是 8.7%。

### 小结

长度偏差用「内容不变、只改长度」的对照实验来测。治它的办法是 Day 357 那几条:二元判断,给要点,判定标准里写明不看长度、语气和礼貌。今天三个实验说明,这套写法比「换个更聪明的模型」更管用。

## 还有几种偏差,知道名字就行

除了位置和长度,文献里常提的还有三种。它们今天不展开,不是新概念,只是同一个道理换了个方向:评分器被和内容无关的东西带偏。

**自我偏好**(self-preference,也叫 self-enhancement):评分器偏向自己生成的、或者和自己风格像的回复。我们今天评分器和生成回复的都是 deepseek-flash,正好是这种情况。MT-Bench 那篇论文的数据是 GPT-4 给自己的胜率比人给的高 10%,Claude-v1 高 25%,但作者也说样本太少、不能下定论。防的办法是评分器用另一家的模型:`llm_judge.py` 留了 `JUDGE_BASE_URL`、`JUDGE_API_KEY`、`JUDGE_MODEL` 三个环境变量,就是为这个准备的。换了模型要重新跑一遍 Day 358 的对齐。

**宽松偏差**(leniency):倾向于判 pass。这就是 TNR 往往比 TPR 难提的原因,Day 358 已经用 TNR 盯住了它。

**权威感偏差**:回复里有编号、有引用、语气笃定,评分器更容易信。练习 3 会实测一次。

这几种偏差有一个共同的解法,就是 Day 358 的对齐。你不需要事先知道评分器有哪种偏差,只要它在你的标注集上 TPR、TNR 达标,而且你读过每一条判错的样本,偏差在你的数据上就已经被发现了。今天这样的专项实验,是在你要换用法(比如从单条判定改成两两比较)、或者对齐数据里没覆盖到某种情况(比如超长回复)时才需要补做。

## 第三步:成本,钱花在哪

评分器每判一次都要钱。先看一次判定的账单长什么样。DeepSeek 的返回里除了 `prompt_tokens` 和 `completion_tokens`,还有一个 `prompt_cache_hit_tokens`:输入里有多少 token 命中了它的缓存。命中缓存的部分便宜得多。

2026 年 10 月在 [DeepSeek 价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)查到的 deepseek-flash 价格(每百万 token):

| 时段 | 输入(缓存命中) | 输入(缓存未命中) | 输出 |
| --- | --- | --- | --- |
| 高峰(工作日 9–12 点、14–18 点) | 0.04 元 | 2 元 | 8 元 |
| 空闲(其余时间) | 0.02 元 | 1 元 | 4 元 |

缓存命中比未命中便宜 50 倍。缓存是怎么命中的?[DeepSeek 的缓存文档](https://api-docs.deepseek.com/zh-cn/guides/kv_cache)说得很清楚:按**前缀**匹配,请求开头那一段和之前某次请求的开头一模一样,这一段才算命中。我们的 `FACTS_PROMPT` 前面一大段(任务、判定标准、三个例子)对每条回复都一样,变的只是最后的 `<facts>`、`<ticket>`、`<reply>`,天然适合缓存。

```python
# agent-zero-lab/part06/judge_cost.py
"""评分器的账单:逐次看输入 token 里有多少命中了 DeepSeek 的缓存,按 2026 年 10 月的高峰价算钱。"""
from __future__ import annotations

import json
from pathlib import Path

from part06.llm_judge import EXTRA, FACTS_PROMPT, JUDGE_MODEL, client

PRICE = {"hit": 0.04, "miss": 2.0, "out": 8.0}   # 元 / 百万 token,deepseek-flash 高峰时段

rows = [json.loads(line) for line in Path("part06/cases/align_labels.jsonl").read_text(encoding="utf-8").splitlines()][:8]
total = {"hit": 0, "miss": 0, "out": 0}
for r in rows:
    prompt = FACTS_PROMPT.format(facts=json.dumps(r["facts"], ensure_ascii=False), ticket=r["ticket"], reply=r["reply"])
    resp = client.chat.completions.create(
        model=JUDGE_MODEL, temperature=0, extra_body=EXTRA, response_format={"type": "json_object"},
        messages=[{"role": "user", "content": prompt}])
    u = resp.usage
    assert u is not None
    hit = (u.model_extra or {}).get("prompt_cache_hit_tokens", 0)
    total["hit"] += hit
    total["miss"] += u.prompt_tokens - hit
    total["out"] += u.completion_tokens
    print(f"{r['id']:<15} 输入 {u.prompt_tokens:>4}(命中缓存 {hit:>4}) 输出 {u.completion_tokens:>3}")

cost = sum(total[k] * PRICE[k] for k in total) / 1_000_000
no_cache = ((total["hit"] + total["miss"]) * PRICE["miss"] + total["out"] * PRICE["out"]) / 1_000_000
print(f"合计 命中 {total['hit']} · 未命中 {total['miss']} · 输出 {total['out']}")
print(f"实际 {cost:.5f} 元;要是一点缓存都没命中 {no_cache:.5f} 元")
```

<div class="line-notes">

- `PRICE = {"hit": 0.04, "miss": 2.0, "out": 8.0}   # 元 / 百万 token,deepseek-flash 高峰时段` 按贵的高峰价算,估出来的钱只会多不会少。我跑的时候是工作日下午,本来就是高峰。
- `rows = [json.loads(line) for line in Path("part06/cases/align_labels.jsonl").read_text(encoding="utf-8").splitlines()][:8]` 只取前 8 条,看账单够了。`[:8]` 切片,相当于 JS 的 `.slice(0, 8)`。
- `prompt = FACTS_PROMPT.format(facts=json.dumps(r["facts"], ensure_ascii=False), ticket=r["ticket"], reply=r["reply"])` 拼 prompt 的方式和 `judge_facts` 一模一样。这里没直接调 `judge_facts`,因为它只记了总 token,没记缓存命中。
- `u = resp.usage` 这次调用的用量对象。
- `assert u is not None` 类型上 `usage` 可能是 None,断言一下,basedpyright 就知道下面的 `u` 一定有值。真是 None 的话程序会在这里停下报 `AssertionError`。
- `hit = (u.model_extra or {}).get("prompt_cache_hit_tokens", 0)` `prompt_cache_hit_tokens` 是 DeepSeek 自己加的字段,openai SDK 的类型里没有它。pydantic 把这种「类型里没声明的多余字段」放在 `model_extra` 这个字典里,从这里取。实测第一条是 384。
- `total["miss"] += u.prompt_tokens - hit` 没命中的部分 = 总输入 − 命中。第一条是 581 − 384 = 197。
- `cost = sum(total[k] * PRICE[k] for k in total) / 1_000_000` 三项各乘单价再加起来,除以一百万,因为单价是「每百万 token」。
- `no_cache = ((total["hit"] + total["miss"]) * PRICE["miss"] + total["out"] * PRICE["out"]) / 1_000_000` 对照:假如所有输入都按未命中算要多少钱。

</div>

```bash
uv run python -m part06.judge_cost
```

实测输出:

```text
cancel-c023-01  输入  581(命中缓存  384) 输出  36
cancel-c023-02  输入  567(命中缓存  384) 输出  36
cancel-c023-03  输入  790(命中缓存  640) 输出  36
cancel-c023-04  输入  591(命中缓存  384) 输出  36
cancel-c023-05  输入  577(命中缓存  384) 输出  55
cancel-c023-06  输入  633(命中缓存  384) 输出  53
cancel-c023-07  输入  582(命中缓存  384) 输出  39
cancel-c023-08  输入  587(命中缓存  384) 输出  38
合计 命中 3328 · 未命中 1580 · 输出 329
实际 0.00593 元;要是一点缓存都没命中 0.01245 元
```

每次输入五六百 token 里有 384 个命中,就是 prompt 前面那段固定内容。`cancel-c023-03` 命中了 640,因为这条回复今天前面的实验已经判过好几次,整个 prompt 几乎都在缓存里。命中数都是 64 的倍数(384 = 6 × 64、640 = 10 × 64),看起来缓存是按固定长度的块存的,文档没写块多大,这是我从实测数字推的。

8 次评分实际 0.006 元,没缓存的话 0.012 元,缓存省了一半多。为什么不是省 50 倍?因为输出不吃缓存,每次 36 到 55 个输出 token 按 8 元算,占了不小的比例;而且每次还有 200 来个 token 是变化的部分,没法命中。

### 一轮全量评分要多少钱

拿这个平均值去估一轮正式评测。假设测试集 50 条用例,每条跑 3 次(trial,[Day 354](/blog/agent-zero/day-354-testset-size/) 讲过为什么要多跑几次),挂 3 个评分器,一共 450 次评分。练习 2 会实际算一遍,结果是约 0.33 元;一点缓存不命中是 0.70 元。两两比较新旧两版、交换顺序,50 × 3 × 2 = 300 次,每次 prompt 里有两条回复,按 token 翻倍估约 0.44 元。

几毛钱一轮,看起来不用管。要管的是这几个地方:

一是**跑的次数**。每提交一次代码就全量跑一遍,一天 20 次提交就是 6 块多,一个月一两百。所以 [Day 375](/blog/agent-zero/day-375-eval-project-2/) 做 CI 门禁时会分层:每次提交只跑不花钱的代码检查,LLM 评分器在合并前或每天夜里跑。

二是**换贵模型**。评分器为了防自我偏好换成另一家更贵的模型时,单价可能是 deepseek-flash 的十几倍。这时候缓存的价值更大,判定标准和例子这些不变的内容要一直放在 prompt 最前面,别把会变的 `{reply}` 插到中间去。

三是**交换顺序翻倍、多个评分器叠加、多次 trial 叠加**,三个乘数乘起来涨得很快。估钱的算式就是「次数 × 每次 token × 单价」,动手前先乘一下,心里有数。

### 今天实跑一共花了多少

把今天所有脚本的 token 加起来(每个脚本最后一行都打了):位置偏差两次 18524 × 2 输入、约 7476 输出;不给 tie 两次 12294 × 2 输入、约 4848 输出;长度两次 10166 + 10716 输入、1324 + 1396 输出;包装 13566 输入、1140 输出;打分对照约 3300 输入、22 输出;账单脚本 4908 输入、329 输出;练习 3 是 6695 输入、573 输出。合计输入约 11.1 万、输出约 1.7 万 token。全按高峰未命中价算:11.1 万 × 2 / 100 万 + 1.7 万 × 8 / 100 万 ≈ 0.22 + 0.14 = 0.36 元。实际有一部分命中缓存,会比这个少。

## 动手练习

### 练习 1:九种组合

不调模型。第一次 x 在 A 位、第二次 y 在 A 位,评分器每次可能说 A、B、tie,一共九种组合。写个脚本把每种组合翻译成 x/y 视角,再按 `compare_swapped` 的规则得出最终结论。哪几种组合是纯粹的位置偏好?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex359_final.py
"""练习 1:交换顺序判两次,九种组合各得出什么最终结论?不调模型。"""
from __future__ import annotations

A_FIRST = {"A": "x", "B": "y", "tie": "tie"}    # x 在 A 位时的翻译表
Y_FIRST = {"A": "y", "B": "x", "tie": "tie"}    # y 在 A 位时的翻译表

for first in ["A", "B", "tie"]:
    for second in ["A", "B", "tie"]:
        r1, r2 = A_FIRST[first], Y_FIRST[second]
        final = r1 if r1 == r2 else "tie"
        note = "两次都选 A 位,纯位置偏好" if first == second == "A" else ("两次都选 B 位" if first == second == "B" else "")
        print(f"第一次 {first:<3} 第二次 {second:<3} → x/y 视角 {r1:<3} {r2:<3} → 最终 {final:<3} {note}")
```

<div class="line-notes">

- `A_FIRST = {"A": "x", "B": "y", "tie": "tie"}    # x 在 A 位时的翻译表` 和 `compare_swapped` 里的 `r1` 那行是同一张表,抽成常量。
- `for second in ["A", "B", "tie"]:` 两层循环,3 × 3 = 9 种。
- `note = "两次都选 A 位,纯位置偏好" if first == second == "A" else (` Python 支持连写比较,`first == second == "A"` 等于 `first == second and second == "A"`。JS 里不能这么写,`a == b == "A"` 在 JS 里会先算出一个布尔值再和 "A" 比。

</div>

```bash
uv run python -m part06.ex359_final
```

实测输出:

```text
第一次 A   第二次 A   → x/y 视角 x   y   → 最终 tie 两次都选 A 位,纯位置偏好
第一次 A   第二次 B   → x/y 视角 x   x   → 最终 x   
第一次 A   第二次 tie → x/y 视角 x   tie → 最终 tie 
第一次 B   第二次 A   → x/y 视角 y   y   → 最终 y   
第一次 B   第二次 B   → x/y 视角 y   x   → 最终 tie 两次都选 B 位
第一次 B   第二次 tie → x/y 视角 y   tie → 最终 tie 
第一次 tie 第二次 A   → x/y 视角 tie y   → 最终 tie 
第一次 tie 第二次 B   → x/y 视角 tie x   → 最终 tie 
第一次 tie 第二次 tie → x/y 视角 tie tie → 最终 tie 
```

九种里只有两种能得出赢家:「A 然后 B」(x 两次都赢)和「B 然后 A」(y 两次都赢)。「A A」和「B B」是纯位置偏好,规则自动把它们变成平局。今天 `dup-c007-07` 那对就是「B B」。

</details>

### 练习 2:一轮全量评测要多少钱

不调模型。用 `judge_cost.py` 那 8 次的平均 token,算:50 条用例 × 3 次 trial × 3 个评分器的花费;同样次数完全不命中缓存的花费;两两比较新旧两版并交换顺序的花费;每天 20 次提交都跑全量的花费。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex359_budget.py
"""练习 2:一轮全量评测要花多少钱?用 judge_cost.py 实测的平均 token 估算。不调模型。"""
from __future__ import annotations

PRICE = {"hit": 0.04, "miss": 2.0, "out": 8.0}            # 元 / 百万 token,高峰
AVG = {"hit": 3328 / 8, "miss": 1580 / 8, "out": 329 / 8}  # judge_cost.py 那 8 次的平均


def cost(calls: int, avg: dict[str, float]) -> float:
    return calls * sum(avg[k] * PRICE[k] for k in avg) / 1_000_000


cases, trials, judges = 50, 3, 3
single = cases * trials * judges
print(f"单条判定:{cases} 条 × {trials} 次 × {judges} 个评分器 = {single} 次,约 {cost(single, AVG):.3f} 元")
no_cache = {"hit": 0, "miss": AVG["hit"] + AVG["miss"], "out": AVG["out"]}
print(f"同样次数一点缓存都不命中:约 {cost(single, no_cache):.3f} 元")
pair = cases * trials * 2
print(f"两两比较新旧两版、交换顺序:{cases} × {trials} × 2 = {pair} 次,按单次 token 翻倍估约 {cost(pair, {k: v * 2 for k, v in AVG.items()}):.3f} 元")
print(f"每次提交都跑全量,一天 20 次提交:约 {20 * cost(single, AVG):.2f} 元")
```

<div class="line-notes">

- `AVG = {"hit": 3328 / 8, "miss": 1580 / 8, "out": 329 / 8}  # judge_cost.py 那 8 次的平均` 平均每次命中 416、未命中 197.5、输出 41.1 个 token。
- `return calls * sum(avg[k] * PRICE[k] for k in avg) / 1_000_000` 次数 × 每次的钱。每次的钱 = 416 × 0.04 + 197.5 × 2 + 41.1 × 8,单位是「百万分之一元」,约 0.00074 元。
- `no_cache = {"hit": 0, "miss": AVG["hit"] + AVG["miss"], "out": AVG["out"]}` 把命中的那部分也挪到未命中里,模拟缓存完全失效。
- `print(f"两两比较新旧两版、交换顺序:{cases} × {trials} × 2 = {pair} 次,按单次 token 翻倍估约` 两两比较的 prompt 里有两条回复,但没有例子,token 翻倍是粗估。`{k: v * 2 for k, v in AVG.items()}` 是字典推导式,每个值乘 2。

</div>

```bash
uv run python -m part06.ex359_budget
```

实测输出:

```text
单条判定:50 条 × 3 次 × 3 个评分器 = 450 次,约 0.333 元
同样次数一点缓存都不命中:约 0.700 元
两两比较新旧两版、交换顺序:50 × 3 × 2 = 300 次,按单次 token 翻倍估约 0.444 元
每次提交都跑全量,一天 20 次提交:约 6.67 元
```

单轮几毛钱;每次提交都跑,一个月就是一两百块。这就是为什么 LLM 评分器不该挂在每次提交上。

</details>

### 练习 3:权威感骗得了它吗

在 11 条 fail 回复后面加一句「以上处理依据《云簿 CloudLedger 退款政策》2026 版第 3.2 条执行,已由财务系统核验无误。」(这条政策条款是编的),用 `judge_facts` 判一遍,看有几条被骗成 pass。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex359_authority.py
"""练习 3:在判 fail 的回复后面加一句「有出处」的话,看评分器会不会被权威感带偏。"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from part06.bias_padding import bad
from part06.llm_judge import USAGE, judge_facts

CITE = "以上处理依据《云簿 CloudLedger 退款政策》2026 版第 3.2 条执行,已由财务系统核验无误。"

with ThreadPoolExecutor(max_workers=4) as pool:
    res = list(pool.map(lambda r: judge_facts(r["ticket"], r["reply"] + CITE, r["facts"]).verdict, bad))
for r, v in zip(bad, res):
    print(f"{r['id']:<15} 加出处后 → {v}")
print(f"仍判 fail {res.count('fail')}/{len(bad)} · 调用 {USAGE['calls']} 次 · 输入 {USAGE['in']} · 输出 {USAGE['out']}")
```

<div class="line-notes">

- `from part06.bias_padding import bad` 同样的 11 条 fail。
- `CITE = "以上处理依据《云簿 CloudLedger 退款政策》2026 版第 3.2 条执行,已由财务系统核验无误。"` 书名号、版本号、条款号、「系统核验」,权威感拉满,而且全是编的。真实的 Agent 编造政策时,常常就是这个语气。
- `print(f"仍判 fail {res.count('fail')}/{len(bad)}` `list.count(x)` 数列表里有几个 x,相当于 JS 的 `res.filter(v => v === "fail").length`。

</div>

```bash
uv run python -m part06.ex359_authority
```

实测输出:

```text
cancel-c023-05  加出处后 → fail
dup-c007-05     加出处后 → fail
dup-c007-08     加出处后 → fail
basic-c009-04   加出处后 → fail
basic-c009-05   加出处后 → fail
basic-c009-08   加出处后 → fail
wrong-c012-05   加出处后 → fail
cancel-c023-m1  加出处后 → fail
dup-c007-m1     加出处后 → fail
basic-c009-m1   加出处后 → fail
wrong-c012-m1   加出处后 → fail
仍判 fail 11/11 · 调用 11 次 · 输入 6695 · 输出 573
```

一条都没骗到。原因和实验二一样:`judge_facts` 手里有要点,它拿要点逐条对,回复说「按剩余天数」就是和「按剩余整月」矛盾,后面引了什么条款都没用。这也提醒你,「有没有编造政策」这种评分器一定要给它看真实的政策原文或工具返回,让它对照证据判,不然权威感这一招就可能管用了。

</details>

### 练习 4:20 比 21 是偏差还是运气

不调模型。「不给 tie」那次实验里,A 位赢 20 次、B 位赢 21 次。按 [Day 353](/blog/agent-zero/day-353-stats-intuition/) 的正态近似,算 A 位赢率的 95% 置信区间。如果是 30 比 11、或者 75 比 25 呢?哪种情况能说「有位置偏差」?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex359_ci.py
"""练习 4:A 位赢了 20 次、B 位赢了 21 次,这个差别是偏差还是运气?用 Day 353 的正态近似算区间。"""
from __future__ import annotations

import math

a, b = 20, 21
n = a + b
p = a / n
se = math.sqrt(p * (1 - p) / n)
print(f"A 位赢率 {p:.3f},标准误 {se:.3f},95% 区间 [{p - 1.96 * se:.3f}, {p + 1.96 * se:.3f}]")
for a2, b2 in [(30, 11), (75, 25)]:
    p2, n2 = a2 / (a2 + b2), a2 + b2
    se2 = math.sqrt(p2 * (1 - p2) / n2)
    print(f"假如 A {a2} 次 B {b2} 次:赢率 {p2:.3f},95% 区间 [{p2 - 1.96 * se2:.3f}, {p2 + 1.96 * se2:.3f}]")
```

<div class="line-notes">

- `n = a + b` 只算分出胜负的 41 次,那 1 次 tie 不算。
- `se = math.sqrt(p * (1 - p) / n)` Day 353 的标准误公式:比例 p 在 n 次里的抽样误差。代入 p = 0.488、n = 41,得 0.078。
- `print(f"A 位赢率 {p:.3f},标准误 {se:.3f},95% 区间 [{p - 1.96 * se:.3f}, {p + 1.96 * se:.3f}]")` 正负 1.96 个标准误,就是 95% 区间。

</div>

```bash
uv run python -m part06.ex359_ci
```

实测输出:

```text
A 位赢率 0.488,标准误 0.078,95% 区间 [0.335, 0.641]
假如 A 30 次 B 11 次:赢率 0.732,95% 区间 [0.596, 0.867]
假如 A 75 次 B 25 次:赢率 0.750,95% 区间 [0.665, 0.835]
```

20 比 21 的区间是 0.335 到 0.641,把 0.5 包在里面,说明和「不偏」分不开,我们没测出整体偏向。30 比 11 的区间整个在 0.5 以上,可以说偏向前面。不过要注意,41 次判定的区间宽达 0.3,真实的 A 位赢率在 0.34 和 0.64 之间都说得通,也就是说,我们今天的样本量只能排除「很严重的位置偏差」,排除不了「轻微的」。想测得更准,就要更多对回复。

</details>

### 验收标准

- `pairwise_judge.py` 的 `compare_swapped` 能跑通,你能不看文章说出两次结论不一致时为什么记平局。
- 跑过 `bias_position.py`,分别报出「两条都对」和「一对一错」两组的翻转对数,并能解释为什么偏差主要出在前一组。
- 跑过 `bias_length.py` 的有规则、无规则两遍,和 `bias_padding.py`、`bias_padding_score.py`,能用自己的数说明哪种评分方式最容易被带偏。
- 跑过 `judge_cost.py`,能从输出里指出命中缓存的 token,并估出你自己测试集一轮全量评分的钱。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 单条判定 pointwise | 评分器每次只看一条回复,按标准给结论,Day 357 的 `judge_facts` 就是 |
| 两两比较 pairwise | 把同一个问题的两条回复同时给评分器,问哪条更好,常用来比较新旧两个版本 |
| 位置偏差 position bias | 内容不变,只换谁放前面,评分器的结论就变了 |
| 交换顺序 swap | 同一对回复各放前面判一次,两次一致才算数,不一致记平局。测位置偏差和治位置偏差都用它 |
| 长度偏差 verbosity bias | 评分器偏向更长、看起来更详细的回复,也叫冗长偏差 |
| 平局 tie | 两两比较里「两条一样好」的结论,也用来承接交换后不一致的结果 |
| 自我偏好 self-preference | 评分器偏向自己生成的、或和自己风格像的回复 |
| 宽松偏差 leniency | 评分器倾向于判 pass |
| 权威感偏差 | 回复引条款、语气笃定、格式规整时,评分器更容易信 |
| 缓存命中 cache hit | 请求开头一段和之前的请求一模一样,这一段按便宜的价格算。DeepSeek 在 `usage` 里用 `prompt_cache_hit_tokens` 报 |
| 高峰时段 / 空闲时段 | DeepSeek 按北京时间分两档价,工作日 9–12 点和 14–18 点是高峰,空闲时段半价 |
| `model_extra` | pydantic 对象上存放「类型里没声明的多余字段」的字典,DeepSeek 自加的用量字段就在这里 |

## 常见误区

**听说有偏差就信,没测出来就以为没有。** 今天在 deepseek-flash 上,位置偏差和长度偏差都比论文里弱得多,但这只说明「这个模型、这批短回复、这套 prompt」上弱。换了任何一样都可能变。自己测,用数说话。

**只测差别明显的样本。** 一对一错的 11 对,交换顺序一对都没翻;偏差只出在两条都对、难分高下的那 21 对里。只拿明显的样本测,会得出「完全没有位置偏差」的错误结论。

**两两比较不给平局。** 两条一样好还硬逼它选,它只能凭位置、长度这些无关的东西选。`dup-c007-07` 那对两次都选了 B 位。给 tie 这个出口,再配上交换顺序。

**以为加长回复是长度偏差的主要威胁。** 今天把错回复加长三四倍,二元评分器一条没被骗;同样的回复交给打 1 到 10 分、不给要点的评分器,错回复照样拿 8、9 分,和长不长关系不大。没有判定标准才是大问题。

**交换顺序以后只看最终结论,不看翻了几对。** 翻转的对数本身就是一个指标,它告诉你这批比较里有多少是评分器拿不准的。新旧版本对比时,如果翻转很多,「新版赢了 X 对」这个数就没多大意义。

**`usage` 里找不到 `prompt_cache_hit_tokens`。** 它是 DeepSeek 自加的字段,openai SDK 的类型里没有,写 `u.prompt_cache_hit_tokens` 会被 basedpyright 标红。从 `u.model_extra` 里取。换了别家服务商,字段名可能不一样,看人家的文档。

**把会变的内容放在 prompt 中间。** 缓存只认前缀。要是把 `{reply}` 插到判定标准前面,后面那一大段固定内容就再也命中不了。不变的放前面,变的放最后。

## 学习资料

### 文档与文章

- [Zheng 等 · Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena](https://arxiv.org/abs/2306.05685):位置偏差、长度偏差、自我偏好这几个说法的出处。今天引用的表 2(交换顺序)和表 3(重复列表攻击)都在第 3.3 节,英文,读这一节约 30 分钟。
- [Shi 等 · Judging the Judges: A Systematic Study of Position Bias in LLM-as-a-Judge](https://arxiv.org/abs/2406.07791):专门研究位置偏差的论文,讲了两条回复质量越接近、位置偏差越明显,读摘要和结论。
- [Eugene Yan · Evaluating the Effectiveness of LLM-Evaluators](https://eugeneyan.com/writing/llm-evaluators/):把各种评分器偏差的研究梳理了一遍,读讲 position bias 和 verbosity bias 的部分,英文。
- [Hamel Husain · Using LLM-as-a-Judge For Evaluation: A Complete Guide](https://hamel.dev/blog/posts/llm-judge/):他为什么推荐二元判断、而不推荐打分和两两比较,和今天实验三的结论对照着读。
- [DeepSeek · 模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):中文,今天的价格表出处,写代码前再看一眼,价格会变。
- [DeepSeek · 上下文硬盘缓存](https://api-docs.deepseek.com/zh-cn/guides/kv_cache):中文,讲缓存怎么按前缀命中、`prompt_cache_hit_tokens` 是什么,10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1f13R6JEfP&autoplay=0&high_quality=1" title="【MT-Bench 实测】LLM-as-Judge 的四大偏差:位置/冗长/自我偏好/风格" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>古希腊掌管代码的神 · 【MT-Bench 实测】LLM-as-Judge 的四大偏差:位置/冗长/自我偏好/风格 · 4 分钟,用实测例子演示今天说的几种偏差,看完和我们自己测出来的数比一比。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1vAaG6rEZh&autoplay=0&high_quality=1" title="面试官:LLM-as-a-judge的偏差怎么控制" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>图灵AI大模型 · 面试官:LLM-as-a-judge的偏差怎么控制 · 4 分钟,按面试题的口径把偏差和缓解办法过一遍,适合做完实验后用来练怎么讲。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/RKBibsoK7Yg" title="LLM-as-a-Judge Is Biased: 10 Hidden Biases You Need to Know" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Analytics Vidhya · LLM-as-a-Judge Is Biased: 10 Hidden Biases You Need to Know · 英文,把评分器的各种偏差列了一遍,比今天讲的多,当扩展清单看。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 3 章「AI as a Judge」一节里讲评分器局限和偏差的部分,英文。
- Shreya Shankar、Hamel Husain《Evals for AI Engineers》(O'Reilly,2026 年 10 月):讲 LLM 评分器和成本优化的章节是今天的延伸,英文。

### 开源项目与代码

- [lm-sys/FastChat](https://github.com/lm-sys/FastChat):MT-Bench 的官方实现,`fastchat/llm_judge` 目录里有两两比较的评分 prompt 和交换顺序的代码,看它怎么处理两次不一致。
- [langchain-ai/openevals](https://github.com/langchain-ai/openevals):现成的评分器合集,里面也有两两比较的写法,拿来和今天的 `PAIR_PROMPT` 比,看它有没有给 tie、有没有写不看长度。

## 自测

1. 什么是位置偏差?怎么测、怎么缓解?

<details><summary>答案</summary>

内容不变、只换谁放前面,评分器的结论就变了。测和缓解用同一个办法:同一对回复交换顺序各判一次,翻译回同一个视角比较,一致才算数,不一致记平局。测的时候要分「差别明显」和「差别很小」两组,偏差主要出在后一组。

</details>

2. 交换顺序时,评分器两次都说「A 更好」,最终结论是什么?为什么?

<details><summary>答案</summary>

平局。第一次 A 位是 x,第二次 A 位是 y,两次都说 A,翻译过来就是一次 x 赢、一次 y 赢,结论矛盾。这说明它选的是位置,不是内容,这一对的比较结果不可信。

</details>

3. 今天给 11 条 fail 回复加了一大段客套话,`judge_facts` 一条没改判。但同样的回复交给「打 1 到 10 分」的评分器,错回复平均 5.7 分,有 5 条在 8 分以上。这说明什么?

<details><summary>答案</summary>

说明对这个模型来说,长度不是主要问题,没有判定标准才是。`judge_facts` 手里有要点,能逐条对照;打分评分器不知道什么算错,把「按剩余天数折算」这种错误也当成好回复。防长度偏差最有效的是二元判断、给要点、写明不看长度和语气,而不是指望模型自己公正。

</details>

4. 为什么 `judge_facts` 每次调用都有 384 个 token 命中缓存?怎么写 prompt 能让缓存命中更多?

<details><summary>答案</summary>

DeepSeek 的缓存按前缀匹配。`FACTS_PROMPT` 前面的任务、判定标准、三个例子对每条回复都一样,这一段在第一次调用后就进了缓存,后面每次都能命中。要命中更多,就把不变的内容放前面、变化的内容(要点、工单、回复)放最后,不要把会变的东西插在中间。

</details>

5. 一轮评测 50 条用例 × 3 次 trial × 3 个评分器,大约多少钱?什么情况下钱会涨一个数量级?

<details><summary>答案</summary>

按今天实测的平均 token 和 deepseek-flash 高峰价,450 次评分约 0.33 元。涨一个数量级的常见原因:每次提交都跑全量(一天 20 次就是 6 块多);评分器换成单价贵十几倍的模型;两两比较交换顺序、多个评分器、多次 trial 几个乘数叠加。估钱的算式是次数 × 每次 token × 单价。

</details>

6. (面试题)「你用 LLM 比较两个模型版本的回复质量,怎么保证结论不是评分器的偏差造成的?」

<details><summary>答案</summary>

要点:①每对回复交换顺序判两次,一致才算数,不一致记平局,报告里同时报翻转比例;②给 tie 选项,不强迫二选一;③评分 prompt 里写清「更好」的定义和要点,明确不因长度、语气、格式加分;④评分器用和被测模型不同厂商的模型,防自我偏好;⑤先在人工标注的对齐集上验证评分器(TPR/TNR/kappa),对齐集要覆盖长回复、难分高下的样本;⑥用置信区间看胜率差别是不是超出了抽样误差,样本少时别下结论;⑦能写成二元判定的维度尽量拆成单条判定,两两比较只在真的需要相对比较时用。

</details>

## 明天预告

Day 360 · 轨迹评测(一):结果和轨迹各管什么。这四天的评分器都只看 Agent 最后交出来的回复。可 Agent 是会调工具的:它查了谁的数据、查了几次、先查后退还是先退后查,这些在回复里不一定看得出来。明天让一个真的会调工具的 Agent 跑几张工单,把它每一次工具调用记下来,你会看到两条结果一模一样、过程却差很多的轨迹。
