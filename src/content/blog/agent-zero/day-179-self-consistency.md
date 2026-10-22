---
title: 'Day 179 · 不靠推理模型的老办法:自洽投票和 best-of-N'
description: '同一道题问五遍按答案投票(自洽投票),或者用程序验证器先筛再投(best-of-N 加验证器)。用一套专挑陷阱的云簿退款题实测单次、投票、验证加投票三种挑法,和昨天的思考档位比准确率和花费;顺带踩一次全角冒号让验证器失灵的坑,最后讲在 Agent 循环里怎么用这些办法。'
pubDate: 2026-10-22
regime: none
tags: ['self-consistency', 'best-of-n', 'verifier', 'agent-zero']
series: 'agent-zero'
day: 179
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 178](/blog/agent-zero/day-178-thinking-budget/) 量了 DeepSeek 的五种思考配置:在云簿计费难题上,关思考 40 次对 36 次,low 起全对,max 比 low 贵将近一倍却没有更准。练习 2 里还看到一件事:关思考错的时候不是乱错,难题第 2 题五次里有一次错成 21178.8,正好是把申请当月也算成未使用。

错法有规律,就有一个很老的办法可以用:同一道题多问几遍,看哪个答案出现得最多。推理模型出现之前,大家就是这么在「推理时多花算力」的。今天把它写出来,再加一个程序验证器,和昨天的思考档位放在一起比。

## 今天要解决的问题

学完你应该能:

1. 写出自洽投票:同一题采样 N 次、按最终答案计票,说清它为什么有效、什么时候失效。
2. 写出一个规则验证器,把 best-of-N 做成「先验证、再投票」,并说清验证器只管得了它检查的那一条规则。
3. 用同一批采样比较「只用第一个」「投票」「验证加投票」三种挑法,再和思考档位比每道题的花费,给出选择。

预计用时 2.5 小时。前置:[Day 178](/blog/agent-zero/day-178-thinking-budget/)(`billing_quiz.py`、`effort_sweep.py`,今天都会改一点)、[Day 110](/blog/agent-zero/day-110-sampling-1/)(temperature)、[Day 142](/blog/agent-zero/day-142-prompt-4/)(让模型先想再答)。命令都在 `agent-zero-lab/` 根目录跑。今天的实验加练习按高峰价一共花了一块四左右,只跑正文的部分大约八毛。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `vote_sweep.py` 里的 `majority` 和 `solve` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 投票为什么会有用

先讲直觉。一道计费题,正确答案只有一个,但能从很多条推导路线走到它:先算月差价再乘天数,或者先算日价再乘天数,结果一样。错误答案则各错各的:漏了税是一个数,多算一个月是另一个数,四舍五入早了又是一个数。所以让模型独立地答五遍,对的那个数更容易凑到一起,错的散开。挑出现次数最多的那个,就比只问一次更可能对。

这个办法有名字,叫**自洽投票**(Self-Consistency),2022 年 Google 的一篇论文提出的。论文里的做法和今天一模一样:带着思维链答 N 次,温度调高让每次走不同的路,最后按最终答案计票。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="自洽投票:同一题采样五次,按答案计票">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
  <rect x="20" y="100" width="110" height="44" fill="var(--paper)" stroke="var(--rule)" rx="4"/>
  <text x="75" y="120" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">同一道题</text>
  <text x="75" y="136" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">temperature=1</text>
  <rect x="190" y="20" width="150" height="30" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="265" y="40" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">第 1 次 → 792.35</text>
  <rect x="190" y="65" width="150" height="30" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="265" y="85" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">第 2 次 → 792.35</text>
  <rect x="190" y="110" width="150" height="30" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="265" y="130" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">第 3 次 → 1056.47</text>
  <rect x="190" y="155" width="150" height="30" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="265" y="175" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">第 4 次 → 792.35</text>
  <rect x="190" y="200" width="150" height="30" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="265" y="220" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">第 5 次 → 792.35</text>
  <line x1="130" y1="122" x2="190" y2="35" stroke="var(--rule)"/>
  <line x1="130" y1="122" x2="190" y2="80" stroke="var(--rule)"/>
  <line x1="130" y1="122" x2="190" y2="125" stroke="var(--rule)"/>
  <line x1="130" y1="122" x2="190" y2="170" stroke="var(--rule)"/>
  <line x1="130" y1="122" x2="190" y2="215" stroke="var(--rule)"/>
  <rect x="400" y="90" width="120" height="64" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="460" y="112" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Counter 计票</text>
  <text x="460" y="130" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">792.35: 4</text>
  <text x="460" y="146" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">1056.47: 1</text>
  <line x1="340" y1="122" x2="400" y2="122" stroke="var(--rule)"/>
  <line x1="520" y1="122" x2="550" y2="122" stroke="var(--rule)"/>
  <text x="555" y="118" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">792.35</text>
  <text x="555" y="134" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">多数票</text>
</svg>
<figcaption>一次真实摸底的结果:同一道退款题问 5 遍,4 次 792.35(对),1 次 1056.47(把申请当月 11 月也算成未使用)。蓝色是模型做的事,琥珀色是我们自己的代码。</figcaption>
</figure>

它有两个前提,写代码前先记住。第一,**答案要能比较是不是同一个**:金额、选项、分类标签都行,一段客服回复就不行,两段话意思一样字面不同,没法直接计票。第二,**每次采样要真的不一样**:温度太低,五次走同一条路,错也错得一模一样,投票就没意义了。昨天练习 4 看到 DeepSeek 开思考时 temperature 不生效,所以今天的投票全部在关思考下做。

## 第一步:先出一套更容易错的题

昨天的难题对 `deepseek-flash` 来说还是太容易,关思考 90% 都对。投票要有发挥的余地,题目得让单次回答经常错。我先按昨天的思路另编了 6 道多规则叠加的题,每道问 5 遍摸底,结果 30 次几乎全对,没用。

于是换个方向,专挑昨天看到的那个弱点:「申请当月不算未使用」。昨天的退款题年付都从 1 月 1 日开始,算未使用月数只要拿 12 减申请月份。如果年付从 3 月、7 月开始,跨年了,就得真的数月份。再加上「降级下期生效」和「最后一个月申请」这两个陷阱,凑出 6 道。这 6 道我同样每道问了 5 遍摸底,30 次里对 25 次,第 5 题 5 次里错了 3 次。够用了,把它们加进 `billing_quiz.py`:

```python
# agent-zero-lab/part03/billing_quiz.py  (Day 178 建的,在 QUIZ_HARD 后面加一个列表,main 里也加上)
# Day 179 新增:专挑「申请当月不算」「降级下期生效」这两个坑的退款题,年付不从 1 月开始
QUIZ_TRAP: list[tuple[str, float]] = [
    ("专业版年付,2026-03-01 开始,2026-11-15 申请退款,能退多少(含税)?", money(2990 / 12 * 3 * TAX)),
    ("企业版年付,2026-07-01 开始,2027-01-10 申请退款,能退多少(含税)?", money(9990 / 12 * 5 * TAX)),
    ("专业版年付 2 个席位,首年用了 85 折券,2026-05-01 开始,2026-05-20 申请退款,能退多少(含税)?",
     money(2990 * 2 * 0.85 / 12 * 11 * TAX)),
    ("企业版年付,2026-10-01 开始,2027-09-30 申请退款,能退多少(含税)?", 0.0),
    ("专业版年付,用了 9 折券,2026-01-01 开始,2026-12-05 申请退款,能退多少(含税)?", 0.0),
    ("企业版年付 2 个席位,2026-04-01 开始。2026-08-31 申请降级到专业版年付,2026-09-02 又申请退款。能退多少(含税)?",
     money(9990 * 2 / 12 * 6 * TAX)),
]

if __name__ == "__main__":
    for q, a in QUIZ + QUIZ_HARD + QUIZ_TRAP:
        print(f"{a:>10.2f}  {q}")
```

<div class="line-notes">

- `("专业版年付,2026-03-01 开始,2026-11-15 申请退款,` 年付覆盖 2026 年 3 月到 2027 年 2 月。11 月申请,11 月不算,未使用的是 12、1、2 三个月,2990 ÷ 12 × 3 × 1.06 = 792.35。摸底时错的那次答 1056.47,就是数成了 4 个月。
- `("企业版年付,2026-07-01 开始,2027-01-10 申请退款,` 覆盖到 2027 年 6 月,1 月申请,未使用 2–6 月 5 个月,答案 4412.25。
- `money(2990 * 2 * 0.85 / 12 * 11 * TAX)),` 5 月开始、5 月申请,用了不到 20 天,未使用 11 个月,两个席位、85 折,答案 4938.98。
- `("企业版年付,2026-10-01 开始,2027-09-30 申请退款,能退多少(含税)?", 0.0),` 9 月是最后一个月,申请当月又不算,一个月都不剩,退 0。
- `("专业版年付,用了 9 折券,2026-01-01 开始,2026-12-05 申请退款,能退多少(含税)?", 0.0),` 同样的陷阱。摸底时 5 次错了 3 次,全答 237.71 = 2990 × 0.9 ÷ 12 × 1 × 1.06,把 12 月当成了未使用。
- `money(9990 * 2 / 12 * 6 * TAX)),` 8 月 31 日申请降级,下个周期才生效,9 月 2 日退款时还是企业版年付;覆盖到 2027 年 3 月,9 月不算,未使用 10 月到 3 月 6 个月,答案 10589.40。
- `for q, a in QUIZ + QUIZ_HARD + QUIZ_TRAP:` 三个列表用 `+` 拼起来再遍历,相当于 JS 的 `[...QUIZ, ...QUIZ_HARD, ...QUIZ_TRAP]`。

</div>

运行 `uv run python -m part03.billing_quiz`,最后 6 行是新题:

```text
    792.35  专业版年付,2026-03-01 开始,2026-11-15 申请退款,能退多少(含税)?
   4412.25  企业版年付,2026-07-01 开始,2027-01-10 申请退款,能退多少(含税)?
   4938.98  专业版年付 2 个席位,首年用了 85 折券,2026-05-01 开始,2026-05-20 申请退款,能退多少(含税)?
      0.00  企业版年付,2026-10-01 开始,2027-09-30 申请退款,能退多少(含税)?
      0.00  专业版年付,用了 9 折券,2026-01-01 开始,2026-12-05 申请退款,能退多少(含税)?
  10589.40  企业版年付 2 个席位,2026-04-01 开始。2026-08-31 申请降级到专业版年付,2026-09-02 又申请退款。能退多少(含税)?
```

顺手让昨天的 `effort_sweep.py` 也能跑这套题。把文件开头选题库的那两行改成一个字典:

```python
# agent-zero-lab/part03/effort_sweep.py  (Day 178 建的,只改这两行)
from part03.billing_quiz import QUIZ, QUIZ_HARD, QUIZ_TRAP, RULES

BANKS = {"basic": QUIZ, "hard": QUIZ_HARD, "trap": QUIZ_TRAP}  # Day 179 加了 trap
QUESTIONS = BANKS[os.environ.get("QUIZ", "basic")]
```

<div class="line-notes">

- `from part03.billing_quiz import QUIZ, QUIZ_HARD, QUIZ_TRAP, RULES` 多导入一个 `QUIZ_TRAP`。
- `BANKS = {"basic": QUIZ, "hard": QUIZ_HARD, "trap": QUIZ_TRAP}` 三套题放进字典,名字对题库,相当于 JS 的对象字面量。以后再加题库只加一项。
- `QUESTIONS = BANKS[os.environ.get("QUIZ", "basic")]` 没设环境变量时默认 `"basic"`。昨天的 `QUIZ=hard` 用法不变;如果写错成 `QUIZ=hrad`,这里会报 `KeyError: 'hrad'`,比昨天那种「不认识就悄悄用基础题」更好发现。

</div>

## 第二步:25 行的自洽投票

先用一道题看清楚投票是什么样子。

```python
# agent-zero-lab/part03/vote_min.py  最小的自洽投票:同一道题问 5 次,按答案计票
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

from common.llm import ChatResult, LLMClient
from part03.billing_quiz import QUIZ_TRAP
from part03.effort_sweep import SYSTEM, parse

question, gold = QUIZ_TRAP[0]  # 专业版年付 3 月开始、11 月 15 日退款,标准答案 792.35
msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": question}]
llm = LLMClient()


def sample(_: int) -> ChatResult:
    return llm.chat(msgs, temperature=1.0)  # 关思考 + 温度 1,每次走不同的路


with ThreadPoolExecutor(max_workers=5) as pool:
    answers = [parse(r.content) for r in pool.map(sample, range(5))]
votes = Counter(a for a in answers if a is not None)
winner, count = votes.most_common(1)[0]
print("5 次答案:", answers)
print("计票:", dict(votes))
print(f"多数票 {winner}({count} 票)| 标准答案 {gold} | {'对' if abs(winner - gold) < 0.011 else '错'}")
print(llm.ledger)
```

<div class="line-notes">

- `from collections import Counter` `Counter` 是专门用来计数的字典:键是东西,值是出现了几次。JS 里你会写 `arr.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map())`,`Counter(arr)` 一步做完。
- `from part03.effort_sweep import SYSTEM, parse` 复用昨天的 system prompt(规则加「最后一行只写答案」)和解析函数。
- `question, gold = QUIZ_TRAP[0]` 新题库第 1 题,摸底时 5 次对 4 次。
- `return llm.chat(msgs, temperature=1.0)  # 关思考 + 温度 1,每次走不同的路` 不传 `extra_body`,用 `.env` 里默认的关思考。温度 1 让每次采样有差异,写出来也是为了读代码的人知道这是故意的。
- `with ThreadPoolExecutor(max_workers=5) as pool:` 5 次并发发出去,总耗时约等于最慢的那一次,不是五次加起来。
- `answers = [parse(r.content) for r in pool.map(sample, range(5))]` 每次的正文用昨天的 `parse` 抠出最后一个「答案:」后面的数字,抠不出来是 `None`。
- `votes = Counter(a for a in answers if a is not None)` 括号里是生成器表达式([Day 99](/blog/agent-zero/day-099-generators/) 讲过生成器,写法就是把列表推导式的方括号换成圆括号),把 `None` 过滤掉再计票。
- `winner, count = votes.most_common(1)[0]` `most_common(1)` 返回票数最多的一项,形如 `[(792.35, 5)]`,取 `[0]` 再拆成两个变量。五次全是 `None` 时这一行会报 `IndexError`,最小版先不管,下一个脚本会处理。
- `print("计票:", dict(votes))` 转成普通字典打印,输出更干净。

</div>

运行 `uv run python -m part03.vote_min`:

```text
5 次答案: [792.35, 792.35, 792.35, 792.35, 792.35]
计票: {792.35: 5}
多数票 792.35(5 票)| 标准答案 792.35 | 对
5 次调用 | 输入 1580 / 输出 935 tokens | 约 ¥0.0094
```

这次五票全对,投票没机会发挥。摸底那次是 4 比 1(上面的图),也是多数票对。只跑一题看不出投票值不值,要跑整套题、和只问一次比,而且要多跑几遍。在那之前先把验证器写出来,因为最后要三种挑法一起比。

## 第三步:验证器,用程序检查一条规则

投票的弱点昨天就埋下了:如果模型在某道题上**大多数时候**都犯同一个错,多数票就是错的。第 5 题摸底时 5 次错 3 次,全错成 237.71,投票会把错误答案选出来,而且票数还挺高,看着很可信。

另一种挑法叫 **best-of-N**:还是生成 N 个候选,但不靠「谁人多」,而是用一个**验证器**(verifier)给每个候选打分或判对错,选通过的那个。验证器可以是规则、单元测试、另一个模型,也可以是专门训练出来打分的模型。对计费题来说,最便宜可靠的是规则:我们知道开始日期和申请日期,「未使用整月」可以用程序精确数出来。

让模型在答案上面多写一行「未使用月数:N」,程序算一遍 N 对不对。对了才算通过。

```python
# agent-zero-lab/part03/verifier.py  退款题的规则验证器:用程序数一遍「未使用整月」
import re

DATE_RE = re.compile(r"(\d{4})-(\d{2})-\d{2}")
MONTHS_RE = re.compile(r"未使用月数[:：]\s*(\d+)")


def month_index(year: int, month: int) -> int:
    return year * 12 + (month - 1)  # 把年月压成一个整数,相减就是差几个月


def unused_months(question: str) -> int:
    dates = [(int(y), int(m)) for y, m in DATE_RE.findall(question)]
    start, apply = dates[0], dates[-1]  # 第一个日期是开始,最后一个是申请退款
    end = month_index(*start) + 12  # 年付覆盖 12 个月,end 是下一年同月(不含)
    return max(0, end - month_index(*apply) - 1)  # 申请当月不算


def check(question: str, text: str) -> bool:
    found = MONTHS_RE.findall(text)
    return bool(found) and int(found[-1]) == unused_months(question)


if __name__ == "__main__":
    from part03.billing_quiz import QUIZ_TRAP

    for q, gold in QUIZ_TRAP:
        print(unused_months(q), gold, q[:30])
    q5 = QUIZ_TRAP[4][0]
    print(check(q5, "未使用月数:0\n答案:0"), check(q5, "未使用月数:1\n答案:237.71"), check(q5, "答案:0"))
```

<div class="line-notes">

- `DATE_RE = re.compile(r"(\d{4})-(\d{2})-\d{2}")` 匹配 `2026-03-01` 这样的日期,只捕获年和月两组,日子用不上。正则的写法和 JS 一样,`r"..."` 是原始字符串,反斜杠不用写两遍。
- `MONTHS_RE = re.compile(r"未使用月数[:：]\s*(\d+)")` 方括号里一个半角冒号一个全角冒号。我第一版只写了半角,下一节会看到它出的事。
- `return year * 12 + (month - 1)  # 把年月压成一个整数` 2026 年 3 月 → 2026 × 12 + 2 = 24314。所有年月变成一条数轴上的点,跨年的减法就不用特殊处理了。
- `dates = [(int(y), int(m)) for y, m in DATE_RE.findall(question)]` `findall` 有两个捕获组时返回 `[("2026", "03"), ("2026", "11")]` 这样的元组列表,再转成整数。
- `start, apply = dates[0], dates[-1]` 第 6 题有三个日期(开始、申请降级、申请退款),取第一个和最后一个正好是开始和退款,中间那个降级日期本来就不影响退款。
- `end = month_index(*start) + 12` `*start` 把元组 `(2026, 3)` 拆成两个参数传进去,相当于 JS 的 `month_index(...start)`。3 月开始,end = 24314 + 12 = 24326,代表 2027 年 3 月(不含)。
- `return max(0, end - month_index(*apply) - 1)  # 申请当月不算` 11 月申请:24326 − 24322 − 1 = 3,正是 12、1、2 月。第 4 题 2027 年 9 月申请、end 是 2027 年 10 月,算出 0。`max(0, ...)` 防止申请日期在年付结束后时算出负数。
- `return bool(found) and int(found[-1]) == unused_months(question)` 模型没写这一行,直接不通过;写了就取最后一个和程序算的比。
- `print(check(q5, "未使用月数:0\n答案:0"), check(q5, "未使用月数:1\n答案:237.71"), check(q5, "答案:0"))` 三个手写的例子:写对了月数、写错了月数、根本没写月数。

</div>

这一步不调模型,运行 `uv run python -m part03.verifier`:

```text
3 792.35 专业版年付,2026-03-01 开始,2026-11-15
5 4412.25 企业版年付,2026-07-01 开始,2027-01-10
11 4938.98 专业版年付 2 个席位,首年用了 85 折券,2026-05
0 0.0 企业版年付,2026-10-01 开始,2027-09-30
0 0.0 专业版年付,用了 9 折券,2026-01-01 开始,20
6 10589.4 企业版年付 2 个席位,2026-04-01 开始。2026
True False False
```

程序数出的月数和前面手算的 3、5、11、0、0、6 一致。三个例子一个通过、两个不通过,符合预期。

注意这个验证器**只检查一条规则**。模型月数写对、但忘了加税,它照样放行。这一点下面的实验会实打实地看到。

## 第四步:同一批采样,三种挑法

现在把三种挑法放在一起比。关键是**用同一批采样**:每道题采 5 次,然后「只用第 1 个」「5 个投票」「先验证再投票」三种方式各挑一次。这样三种挑法的差别只来自挑法本身,不会被「这次运气好」干扰,花的钱也只是一份。

```python
# agent-zero-lab/part03/vote_sweep.py  同一批采样,比三种挑法:只用第 1 个、投票、验证器 + 投票
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

from common.llm import LLMClient
from part03.billing_quiz import QUIZ_TRAP
from part03.effort_sweep import SYSTEM, parse
from part03.verifier import check

N = 5
MONTHS_LINE = "倒数第二行写「未使用月数:N」(不是退款题就写 0)。"
if "terse" in sys.argv:  # 第一版:只加了一行格式要求
    SYSTEM_V = SYSTEM + "\n" + MONTHS_LINE
else:  # 第二版:要求先写推导
    SYSTEM_V = SYSTEM + "\n先一步一步写出推导过程,再按格式收尾。" + MONTHS_LINE
llm = LLMClient()


def majority(answers: list[float | None]) -> float | None:
    votes = Counter(round(a, 2) for a in answers if a is not None)
    return votes.most_common(1)[0][0] if votes else None


def solve(question: str) -> tuple[float | None, float | None, float | None, str]:
    msgs = [{"role": "system", "content": SYSTEM_V}, {"role": "user", "content": question}]
    texts = [llm.chat(msgs, temperature=1.0).content for _ in range(N)]
    answers = [parse(t) for t in texts]
    passed = [a for t, a in zip(texts, answers) if check(question, t)]
    best = majority(passed) if passed else majority(answers)  # 一个都没过就退回普通投票
    return answers[0], majority(answers), best, f"{answers} 通过验证 {len(passed)}/{N}"


if __name__ == "__main__":
    with ThreadPoolExecutor(max_workers=6) as pool:
        rows = list(pool.map(solve, [q for q, _ in QUIZ_TRAP]))

    score = {"单次": 0, f"投票x{N}": 0, f"验证+投票x{N}": 0}
    for i, ((_, gold), (one, vote, best, detail)) in enumerate(zip(QUIZ_TRAP, rows), 1):
        for key, got in zip(score, (one, vote, best)):
            score[key] += got is not None and abs(got - gold) < 0.011
        print(f"第 {i} 题 标准 {gold} | {detail}")
    print(" | ".join(f"{k} 对 {v}/{len(QUIZ_TRAP)}" for k, v in score.items()), "|", llm.ledger)
```

<div class="line-notes">

- `MONTHS_LINE = "倒数第二行写「未使用月数:N」(不是退款题就写 0)。"` 要求模型多写一行给验证器看。括号里那句是给通用性留的:以后混进非退款题,它也知道写什么。
- `if "terse" in sys.argv:  # 第一版:只加了一行格式要求` 命令行带 `terse` 就用第一版提示词。为什么有两版,看下面的实验。`in` 判断列表里有没有这个元素,相当于 JS 的 `argv.includes("terse")`。
- `SYSTEM_V = SYSTEM + "\n先一步一步写出推导过程,再按格式收尾。" + MONTHS_LINE` 第二版多了一句「先写推导」,就是 Day 142 的思维链提示。
- `def majority(answers: list[float | None]) -> float | None:` 把上一个脚本的计票抽成函数,三种挑法里有两种要用。
- `votes = Counter(round(a, 2) for a in answers if a is not None)` 先 `round(a, 2)` 再计票。模型有时写 4938.98,有时写 4938.980,解析出来都是同一个浮点数;`round` 是为了防止 4938.9800000001 这类浮点尾巴把同一个答案拆成两票。
- `return votes.most_common(1)[0][0] if votes else None` 全是 `None` 时返回 `None`,不再像最小版那样报 `IndexError`。还有一个容易忽略的细节:**票数打平时,`most_common` 按第一次出现的顺序排**,五个答案各不相同时它就返回第 1 个。下面的结果里会看到这种「靠运气投对」。
- `texts = [llm.chat(msgs, temperature=1.0).content for _ in range(N)]` 一道题里 5 次是串行的;下面 6 道题之间是并发的。这样同时在飞的请求最多 6 个。
- `passed = [a for t, a in zip(texts, answers) if check(question, t)]` 只留下通过验证器的答案。`zip` 把每次的原文和解析出的答案配对,验证要看原文(找「未使用月数」那一行)。
- `best = majority(passed) if passed else majority(answers)  # 一个都没过就退回普通投票` 验证器一票都不放行时,与其交白卷,不如退回普通投票。这是 best-of-N 里很常见的兜底。
- `return answers[0], majority(answers), best, f"{answers} 通过验证 {len(passed)}/{N}"` 返回三种挑法各自的结果,外加一行明细方便看。`answers[0]` 就是「只问一次」会拿到的答案。
- `score = {"单次": 0, f"投票x{N}": 0, f"验证+投票x{N}": 0}` 三个计分器。
- `score[key] += got is not None and abs(got - gold) < 0.011` 比较表达式的结果是 `True` / `False`,在 Python 里 `True` 加到整数上就是 1,所以可以直接累加。JS 里 `0 + true` 也是 1,一样的道理。
- `print(" | ".join(f"{k} 对 {v}/{len(QUIZ_TRAP)}" for k, v in score.items()), "|", llm.ledger)` `" | ".join(...)` 相当于 JS 的 `arr.join(" | ")`,只是 Python 把分隔符写在前面。

</div>

### 第一版提示词:只加一行格式要求

先跑第一版:`uv run python -m part03.vote_sweep terse`。我跑了三遍,第一遍的明细:

```text
第 1 题 标准 792.35 | [792.35, 2093.0, 822.38, 747.5, 598.0] 通过验证 3/5
第 2 题 标准 4412.25 | [4162.5, 4162.5, 4412.25, 4162.5, 5994.0] 通过验证 4/5
第 3 题 标准 4938.98 | [4938.98, 4880.68, 4938.98, 4938.91, 4646.2] 通过验证 4/5
第 4 题 标准 0.0 | [0.0, 10989.0, 0.0, 0.0, 0.0] 通过验证 4/5
第 5 题 标准 0.0 | [0.0, 2960.1, 1533.74, 0.0, 2960.1] 通过验证 2/5
第 6 题 标准 10589.4 | [4995.0, 10589.4, 3169.4, 10589.4, 10589.4] 通过验证 4/5
单次 对 4/6 | 投票x5 对 5/6 | 验证+投票x5 对 5/6 | 30 次调用 | 输入 10295 / 输出 3599 tokens | 约 ¥0.0419
```

另外两遍只看最后一行:

```text
单次 对 2/6 | 投票x5 对 5/6 | 验证+投票x5 对 6/6 | 30 次调用 | 输入 10295 / 输出 4081 tokens | 约 ¥0.0457
单次 对 2/6 | 投票x5 对 3/6 | 验证+投票x5 对 3/6 | 30 次调用 | 输入 10295 / 输出 3107 tokens | 约 ¥0.0379
```

三遍合计:单次 8/18,投票 13/18,验证加投票 14/18。先别急着高兴投票把 44% 拉到了 72%,看一眼这些答案有多散。摸底时(只用昨天的 `SYSTEM`)30 次对 25 次,现在单次连一半都不到。

问题出在输出长度。30 次调用一共只输出了 3,107 到 4,081 个 token,平均每次 100 到 136 个。昨天关思考做难题,每次输出 300 个左右,里面大部分是推导。**我只是多要了一行「未使用月数」,模型就把推导省了**,直接报数,错误率一下子上去。747.5、4162.5 这种数一眼能看出来:2990 ÷ 12 × 3 = 747.5,9990 ÷ 12 × 5 = 4162.5,月数都对,只是没乘 1.06,忘了加税。

再看验证器在这里管了多少。第 2 题五个答案里三个是 4162.5,它们的月数都写对了(5 个月),所以都通过验证,多数票还是 4162.5,验证器救不了。第 1 题五个答案各不相同,投票是「打平取第一个」,恰好第一个是 792.35,这一票是运气。验证器真正起作用的是第 5 题这种:2960.1 这类答案连月数都写错了,被筛掉,剩下的 0 被选出来。

所以第一版的结论有两条。验证器只管它查的那条规则,漏税这种错它看不见。投票能把散的错压下去,但前提是对的答案本来就占多数。

### 第二版之前,先踩一个坑

第二版加了一句「先一步一步写出推导过程」。我第一次跑第二版时看到的是这样(那时 `MONTHS_RE` 方括号里只有一个半角冒号):

```text
第 1 题 标准 792.35 | [792.35, 792.35, 792.35, 792.35, 792.35] 通过验证 2/5
第 2 题 标准 4412.25 | [4412.25, 4412.25, 4412.25, 4412.25, None] 通过验证 3/5
第 3 题 标准 4938.98 | [4938.98, 4938.98, 4938.98, 4938.98, 4938.98] 通过验证 3/5
```

答案五个全对,验证器却只放行两三个。答案都对了月数还能错?我把第 3 题单独问了 4 遍,打印每次的最后三行:

```text
True '未使用月数:11\n\n答案:4938.98'
True '\n未使用月数:11  \n答案:4938.98'
False '**未使用月数：11**  \n\n答案:4938.98'
True '\n未使用月数:11  \n答案:4938.98'
```

第三次月数也是 11,可它用的是**全角冒号**「：」,还加了 markdown 加粗。肉眼几乎分不出两个冒号,对程序来说是两个完全不同的字符:

```python
# 在 agent-zero-lab/ 下跑:uv run python -c "...",把下面几行贴进引号里
import re
text = '**未使用月数：11**  \n\n答案:4938.98'
old = re.compile(r'未使用月数[:]\s*(\d+)')
new = re.compile(r'未使用月数[:：]\s*(\d+)')
print('只认半角:', old.findall(text))
print('全角半角都认:', new.findall(text))
print(repr('：'), hex(ord('：')), repr(':'), hex(ord(':')))
```

<div class="line-notes">

- `text = '**未使用月数：11**  \n\n答案:4938.98'` 直接用模型那次的原文。
- `old = re.compile(r'未使用月数[:]\s*(\d+)')` 第一版的写法,只认半角冒号。
- `new = re.compile(r'未使用月数[:：]\s*(\d+)')` 改好的写法,方括号里两个冒号。
- `print(repr('：'), hex(ord('：')), repr(':'), hex(ord(':')))` `ord` 取字符的 Unicode 码点,相当于 JS 的 `"：".codePointAt(0)`。全角冒号是 0xff1a,半角是 0x3a。

</div>

```text
只认半角: []
全角半角都认: ['11']
'：' 0xff1a ':' 0x3a
```

验证器把对的答案当成错的拒掉,这叫**假阴性**。它比放过错答案更隐蔽:你看到「通过验证 2/5」,第一反应是模型不行,不会怀疑是验证器的正则写窄了。昨天 `effort_sweep.py` 的 `ANS_RE` 我也顺手查了,同样的问题,所以昨天的代码里那个方括号已经是两个冒号。**这一类坑的通用解法是看原文**:任何时候验证结果和你的直觉对不上,先把被拒的那几条原文打出来看一眼。

### 第二版提示词:先写推导

修好之后重跑第二版:`uv run python -m part03.vote_sweep`。跑了两遍,第一遍明细:

```text
第 1 题 标准 792.35 | [792.35, 792.35, 792.35, 792.35, 792.35] 通过验证 5/5
第 2 题 标准 4412.25 | [4412.25, 4412.25, 4412.25, 4412.25, 4412.25] 通过验证 5/5
第 3 题 标准 4938.98 | [4938.98, 4938.98, 4938.98, 4938.98, 4938.98] 通过验证 4/5
第 4 题 标准 0.0 | [0.0, 0.0, 0.0, 0.0, 0.0] 通过验证 5/5
第 5 题 标准 0.0 | [0.0, 0.0, 0.0, 237.71, 0.0] 通过验证 4/5
第 6 题 标准 10589.4 | [10589.4, 10589.4, 10589.4, 10589.4, 10589.4] 通过验证 5/5
单次 对 6/6 | 投票x5 对 6/6 | 验证+投票x5 对 6/6 | 30 次调用 | 输入 10655 / 输出 15021 tokens | 约 ¥0.1340
```

第二遍几乎一样,最后一行是 `单次 对 6/6 | 投票x5 对 6/6 | 验证+投票x5 对 6/6 | 30 次调用 | 输入 10655 / 输出 16858 tokens | 约 ¥0.1486`。

30 次采样里只错了一次(还是第 5 题的 237.71),单次就是全对,投票和验证都没有东西可救。输出从每次一百出头涨到每次 500 多个 token:**模型把推导写出来,准确率就回来了**。

## 和思考档位放在一起比

最后把昨天的思考档位也拉到这套题上。用改好的 `effort_sweep.py`:`QUIZ=trap uv run python -m part03.effort_sweep 关思考 low`,跑了两遍:

```text
关思考    对 6/6 | 输出   442 tok(思考     0) | 耗时  2.6s | ¥0.0236 | 错题 []
low    对 6/6 | 输出   667 tok(思考   582) | 耗时  3.6s | ¥0.0347 | 错题 []
关思考    对 6/6 | 输出   243 tok(思考     0) | 耗时  1.8s | ¥0.0141 | 错题 []
low    对 6/6 | 输出   921 tok(思考   804) | 耗时  4.7s | ¥0.0469 | 错题 []
```

把今天所有数字换算成「每道题」,放进一张表:

| 做法 | 对 | 每题调用次数 | 每题花费 |
| --- | --- | --- | --- |
| 第一版提示词,单次 | 8/18 | 1 | 约 ¥0.0014 |
| 第一版提示词,投票 ×5 | 13/18 | 5 | ¥0.0063–0.0076 |
| 第一版提示词,验证 + 投票 ×5 | 14/18 | 5 | 同上(同一批采样) |
| 第二版提示词(先写推导),单次 | 12/12 | 1 | ¥0.0045–0.0050 |
| 第二版提示词,投票 ×5 | 12/12 | 5 | ¥0.022–0.025 |
| 昨天的 SYSTEM,关思考 | 12/12(摸底时 25/30) | 1 | ¥0.0024–0.0039 |
| 昨天的 SYSTEM,思考 low | 12/12 | 1 | ¥0.0058–0.0078 |

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="三种花算力的方式,在同一套题上的效果">
  <rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">同一套陷阱题,准确率 vs 每题花费(实测)</text>
  <line x1="60" y1="170" x2="620" y2="170" stroke="var(--rule)"/>
  <line x1="60" y1="40" x2="60" y2="170" stroke="var(--rule)"/>
  <text x="56" y="48" text-anchor="end" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">100%</text>
  <text x="56" y="174" text-anchor="end" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">40%</text>
  <text x="340" y="195" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">每题花费(元),横轴每格 0.005</text>
  <circle cx="86" cy="158" r="6" fill="var(--paper)" stroke="var(--ink-soft)"/>
  <text x="98" y="162" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">v1 单次</text>
  <circle cx="186" cy="105" r="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="198" y="109" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">v1 投票 / 验证+投票</text>
  <circle cx="113" cy="45" r="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="76" y="64" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">关思考</text>
  <circle cx="153" cy="45" r="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="138" y="36" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">v2 单次</text>
  <circle cx="196" cy="45" r="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="208" y="49" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">思考 low</text>
  <circle cx="530" cy="45" r="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="520" y="64" text-anchor="end" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">v2 投票 ×5</text>
</svg>
<figcaption>按上表取中间值画的。蓝点是「让模型自己多写/多想一次」,琥珀点是「问五次再挑」。在这套题上,让它把推导写出来比问五遍便宜得多;投票只在第一版那种「单次很差」的情况下才把准确率往上拉了一截。</figcaption>
</figure>

这张表最值钱的结论不是「投票有用」,而是**花算力的地方有先后**。第一版提示词把推导逼没了,我们用 5 倍的钱投票,把准确率从 44% 拉到 72%;而只要加一句「先写推导」,一次调用就到了 100%,每题花费还比投票便宜。昨天的思考 low 也一样,一次就够。

那投票什么时候值得?今天这套题上它没有赢过任何一种「单次多想」。在三种情况下它仍然有用:你用的模型或接口没法开思考、而且推导写在正文里会影响产品(比如必须只输出一个标签);任务答案能比较但单次准确率实在上不去;或者你要的不只是答案,还要一个**置信度**:5 票全中和 3 比 2 是两种完全不同的信号,后者可以转人工。这一条在客服场景里特别实用,第六部分做评测时会用到。

验证器则比投票更值得投入,前提是它查的规则是真的、写得对。今天它检查的「未使用月数」恰好是模型最容易错的地方,但漏税它就看不见,写窄的正则还会误杀。验证器写得越全,就越接近「用程序把整道题算一遍」;真到那一步,不如直接给模型一个算退款的工具。这就是后面几天讲好工具设计的原因。

## 更复杂的两种:思维树和 LATS

投票和 best-of-N 都是「把整道题从头答 N 遍」。还有两种更精细的办法,今天只认识一下名字和结构,面试可能被问到,实际 Agent 开发里很少用。

**思维树**(Tree of Thoughts,2023 年普林斯顿和 Google DeepMind 的论文)把推理拆成若干步,每一步让模型提几个候选想法,再评估哪个有前途,只保留最好的几个继续往下展开,走进死胡同就回退。说白了是在推理步骤上做搜索。结构大概是这样(伪代码,不用跑):

```text
frontier = [初始状态]
for depth in range(最大步数):
    candidates = []
    for state in frontier:
        for idea in 模型提议下一步(state, k=3):
            candidates.append(state + idea)
    scored = [(模型或规则打分(c), c) for c in candidates]
    frontier = 取分数最高的 b 个(scored)
    if 有任何 c 已经是完整答案且通过检查: return c
return frontier 里分数最高的
```

<div class="line-notes">

- `frontier = [初始状态]` frontier 是「当前还活着的几条路」,一开始只有题目本身。
- `for idea in 模型提议下一步(state, k=3):` 每条路让模型提 3 个下一步,一层就变成 3 倍。
- `scored = [(模型或规则打分(c), c) for c in candidates]` 每个候选打分。这里的「打分」就是今天的验证器,只不过检查的是半成品。
- `frontier = 取分数最高的 b 个(scored)` 只留 b 个(叫束宽),其余剪掉,防止指数爆炸。
- `if 有任何 c 已经是完整答案且通过检查: return c` 和 best-of-N 一样,最终还是靠检查器决定收不收。

</div>

**LATS**(Language Agent Tree Search,2023 年 UIUC 的论文)把同样的搜索用到 Agent 上:树上的每个节点是「执行了某些工具调用之后的真实状态」,评估时有环境的真实反馈,失败了还会写一段反思(就是 [Day 177](/blog/agent-zero/day-177-todo-reflection/) 讲的那种),再回到别的分支继续试。

这两种的共同代价是调用次数:深度 d、束宽 b、每步展开 k,大约要 d × b × k 次生成再加同样多次评估,比单次贵一到两个数量级。所以它们一般用在离线评测或者生成训练数据上,很少放在用户等着的线上请求里。

## 在 Agent 循环里怎么用

前面都是单轮问答。放进 Agent 循环,有几件事要注意。

**投票不要套在整个 Agent 上。** 一个 Agent 跑一次可能调五六次工具,其中有写操作(退款、发邮件)。让它整个跑五遍再投票,写操作就执行了五遍。投票只能用在**没有副作用**的那一步:比如「这张工单该分到哪个队列」「这笔退款金额是多少」这种只算不做的决策。

**规划步和执行步可以分开定强度。** [Day 176](/blog/agent-zero/day-176-plan-execute/) 的 plan-and-execute 里,列计划那一次决定了整个任务的方向,值得开思考或者用投票;后面每一步把工具结果整理成一句话,关思考就够了。`LLMClient.chat` 每次都可以传不同的 `extra_body` 和 `reasoning_effort`,改起来就是在 planner 那次调用里多传两个参数。

**开思考时要原样回传思考内容。** DeepSeek 在带工具的对话里,历史上每一轮 assistant 消息的 `reasoning_content` 都必须带回去,少了就 400。[Day 163](/blog/agent-zero/day-163-tool-choice/) 踩过这个坑。`LLMClient.chat` 返回的 `r.message` 是 SDK 消息原样 `model_dump` 出来的,里面带着 `reasoning_content`,追加进 messages 时用它,别自己只拼 `content`。

**思考内容和投票明细都不是给用户看的。** 思考过程里有被否定的错思路、system prompt 里的规则原文;投票明细里有错误金额。给用户看的只有最终答案,置信度低的时候说一句「这笔我帮您转给账务同事确认」。

## 动手练习

### 练习 1:让验证器再查一条「加税」规则

第一版提示词下,漏税的答案能通过月数检查。给验证器加一条:让模型在倒数第三行写「不含税:金额」,程序检查「不含税 × 1.06 四舍五入到分」等于最终答案。写成 `verifier_ex1.py` 和 `vote_sweep_ex1.py`,在第一版提示词的基础上比较「只投票」「验证月数」「验证月数和税」三种挑法。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/verifier_ex1.py  练习 1:验证器再多查一条规则「先算不含税,再乘 1.06」
import re

from part03.billing_quiz import TAX, money
from part03.effort_sweep import parse
from part03.verifier import check

PRETAX_RE = re.compile(r"不含税[:：]\s*(-?[\d.]+)")


def check_tax(text: str) -> bool:
    found = PRETAX_RE.findall(text.replace(",", ""))
    answer = parse(text)
    if not found or answer is None:
        return False
    return abs(money(float(found[-1]) * TAX) - answer) < 0.011


def check_both(question: str, text: str) -> bool:
    return check(question, text) and check_tax(text)


if __name__ == "__main__":
    from part03.billing_quiz import QUIZ_TRAP

    q1 = QUIZ_TRAP[0][0]
    print(check_both(q1, "不含税:747.50\n未使用月数:3\n答案:792.35"))
    print(check_both(q1, "不含税:747.50\n未使用月数:3\n答案:747.5"))
    print(check_both(q1, "未使用月数:3\n答案:747.5"))
```

<div class="line-notes">

- `PRETAX_RE = re.compile(r"不含税[:：]\s*(-?[\d.]+)")` 吸取教训,一开始就两种冒号都认。
- `found = PRETAX_RE.findall(text.replace(",", ""))` 先去掉千分位逗号再找,和 `parse` 一致。
- `return abs(money(float(found[-1]) * TAX) - answer) < 0.011` 747.50 × 1.06 = 792.35,和答案一致才通过。用 `money` 四舍五入,和标准答案的算法相同。
- `return check(question, text) and check_tax(text)` 两条规则都过才算过。
- `print(check_both(q1, "不含税:747.50\n未使用月数:3\n答案:792.35"))` 手写的三个例子:全对;月数对但漏了税;没写不含税那行。

</div>

```python
# agent-zero-lab/part03/vote_sweep_ex1.py  练习 1:第一版提示词 + 两条规则的验证器
from concurrent.futures import ThreadPoolExecutor

from common.llm import LLMClient
from part03.billing_quiz import QUIZ_TRAP
from part03.effort_sweep import SYSTEM, parse
from part03.verifier import check
from part03.verifier_ex1 import check_both
from part03.vote_sweep import N, majority

SYSTEM_X = SYSTEM + "\n倒数第三行写「不含税:金额」,倒数第二行写「未使用月数:N」(不是退款题就写 0)。"
llm = LLMClient()


def solve(question: str) -> tuple[float | None, float | None, float | None]:
    msgs = [{"role": "system", "content": SYSTEM_X}, {"role": "user", "content": question}]
    texts = [llm.chat(msgs, temperature=1.0).content for _ in range(N)]
    answers = [parse(t) for t in texts]
    one = [a for t, a in zip(texts, answers) if check(question, t)]
    two = [a for t, a in zip(texts, answers) if check_both(question, t)]
    return majority(answers), majority(one) if one else majority(answers), majority(two) if two else majority(answers)


with ThreadPoolExecutor(max_workers=6) as pool:
    rows = list(pool.map(solve, [q for q, _ in QUIZ_TRAP]))
score = [0, 0, 0]
for (_, gold), row in zip(QUIZ_TRAP, rows):
    for k, got in enumerate(row):
        score[k] += got is not None and abs(got - gold) < 0.011
print(f"投票 对 {score[0]}/6 | 验证月数 对 {score[1]}/6 | 验证月数+税 对 {score[2]}/6 | {llm.ledger}")
```

<div class="line-notes">

- `from part03.vote_sweep import N, majority` 复用 `vote_sweep.py` 的常量和计票函数。导入时会执行它顶层的 `SYSTEM_V` 和 `llm = LLMClient()`,不会发请求,评测部分在 `__main__` 下面不会跑。
- `SYSTEM_X = SYSTEM + "\n倒数第三行写「不含税:金额」,倒数第二行写「未使用月数:N」` 和第一版一样不要求写推导,只多要一行。
- `one = [a for t, a in zip(texts, answers) if check(question, t)]` 只查月数。
- `two = [a for t, a in zip(texts, answers) if check_both(question, t)]` 月数和税都查。
- `return majority(answers), majority(one) if one else majority(answers), majority(two) if two else majority(answers)` 三种挑法用同一批 5 个采样。

</div>

先跑 `uv run python -m part03.verifier_ex1`,三行是 `True`、`False`、`False`。再跑两遍 `uv run python -m part03.vote_sweep_ex1`:

```text
投票 对 6/6 | 验证月数 对 6/6 | 验证月数+税 对 5/6 | 30 次调用 | 输入 10625 / 输出 7515 tokens | 约 ¥0.0738
投票 对 6/6 | 验证月数 对 6/6 | 验证月数+税 对 6/6 | 30 次调用 | 输入 10625 / 输出 8736 tokens | 约 ¥0.0836
```

结果和我预想的不一样,有两个意外。第一,只是多要了一行「不含税」,模型每次输出从一百多涨到 250 到 290 个 token,它为了写出不含税金额,自己把计算过程补上了,于是光投票就 6/6。第二,更严的验证器有一遍反而少对了一道:检查越多,模型写错其中任何一行(比如不含税那行四舍五入写早了)都会被拒,对的答案被误杀,剩下的票里选错了。我没去追是哪一道,但道理清楚:**验证器本身也会错,规则加得越多,假阴性的机会越多**。加规则之后要像今天这样,拿同一批采样比一比,确认它真的在帮忙。

</details>

### 练习 2:提前停止的投票

投 5 票时,如果前 3 票已经一样,后 2 票不管是什么都改变不了结果。写一个 `vote_early(sample, n_max=5, need=3)`:每次调用 `sample()` 拿一个答案,某个答案先拿到 `need` 票就立刻返回,同时返回实际调用了几次。不调模型,用实跑里出现过的答案序列测试。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/vote_early.py  练习 2:有一个答案先拿到 need 票就停,不用每次都问满 n_max 次
from collections import Counter
from collections.abc import Callable


def vote_early(sample: Callable[[], float | None], n_max: int = 5, need: int = 3) -> tuple[float | None, int]:
    votes: Counter[float] = Counter()
    for calls in range(1, n_max + 1):
        a = sample()
        if a is not None:
            votes[round(a, 2)] += 1
            if votes[round(a, 2)] >= need:
                return round(a, 2), calls  # 已经过半,剩下的票改变不了结果
    best = votes.most_common(1)
    return (best[0][0] if best else None), n_max


if __name__ == "__main__":
    # 不调模型:用实跑里出现过的答案序列假装是 5 次采样
    runs = {
        "全对": [792.35, 792.35, 792.35, 792.35, 792.35],
        "一错": [792.35, 1056.47, 792.35, 792.35, 792.35],
        "错的多": [0.0, 237.71, 237.71, 0.0, 237.71],
        "全散": [747.5, 1196.0, 792.35, 1056.47, None],
    }
    for name, seq in runs.items():
        it = iter(seq)
        print(f"{name:4} -> {vote_early(lambda: next(it))}")
```

<div class="line-notes">

- `from collections.abc import Callable` 函数类型的标注。`Callable[[], float | None]` 读作「不带参数、返回 float 或 None 的函数」,相当于 TS 的 `() => number | null`。
- `votes: Counter[float] = Counter()` 空计数器,后面逐票往里加。
- `for calls in range(1, n_max + 1):` `calls` 从 1 数到 5,正好是「已经调了几次」。
- `votes[round(a, 2)] += 1` `Counter` 里不存在的键默认是 0,可以直接 `+= 1`,不用先判断。普通 dict 这样写会报 `KeyError`。
- `return round(a, 2), calls  # 已经过半,剩下的票改变不了结果` 5 票里 3 票就是过半,后面 2 票全投给别人也追不上。
- `return (best[0][0] if best else None), n_max` 问满 5 次还没人到 3 票,退回普通多数票。
- `it = iter(seq)` 把列表变成迭代器,每次 `next(it)` 取下一个,相当于 JS 的 `seq[Symbol.iterator]()` 再 `.next().value`。
- `print(f"{name:4} -> {vote_early(lambda: next(it))}")` `lambda: next(it)` 是一个不带参数的小函数,相当于 `() => it.next().value`,假装它就是 `sample`。

</div>

运行 `uv run python -m part03.vote_early`:

```text
全对   -> (792.35, 3)
一错   -> (792.35, 4)
错的多  -> (237.71, 5)
全散   -> (747.5, 5)
```

「全对」只花了 3 次调用就停了,省了 40%。「错的多」用的是摸底时第 5 题的真实答案(3 次 237.71、2 次 0),提前停止照样选出了错的 237.71,这是投票本身的局限,和停不停没关系。「全散」问满 5 次,打平取第一个 747.5,也是错的。真用的时候,问满 5 次还没人过半,这本身就是一个「该转人工」的信号。

</details>

### 练习 3:算一笔账,投票什么时候比开思考划算

用今天表里的数字回答:一个每天 2 万次的计费问答,按「第一版提示词 + 投票 ×5」「第二版提示词单次」「思考 low 单次」三种做法,每天各多少钱?如果产品要求回答里**不能出现推导过程**(只能输出一个数字),你会选哪种?

<details><summary>参考答案</summary>

按每题花费的中间值估:第一版投票约 ¥0.007 × 2 万 = 140 元;第二版单次约 ¥0.0047 × 2 万 = 94 元;思考 low 约 ¥0.0068 × 2 万 = 136 元。都是高峰价,空闲时段减半。

不能在正文里出现推导时,第二版就不能用了(推导就在正文里)。剩下两种:思考 low 把推导放在用户看不到的思考里,正文只输出数字,准确率实测 12/12,每天 136 元;第一版投票每天 140 元,准确率 72%。选思考 low。投票能额外给出票数当置信度,如果你需要这个信号,可以在思考 low 的基础上对低置信的少数题再投票,而不是全量投票。

</details>

**验收标准:** 自己跑出 `vote_sweep.py` 两个版本各至少两遍的结果,能指着明细说出哪几个错答案是漏税、哪几个是多数了一个月;验证器能识别全角冒号;能用一句话说清「投票在什么前提下有效」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 自洽投票(Self-Consistency) | 同一题高温采样多次,按最终答案计票,取票数最多的。2022 年 Google 的论文 |
| best-of-N | 生成 N 个候选,用验证器打分或判对错,选最好的 |
| 验证器(verifier) | 判断一个答案好不好的东西:规则、单元测试、另一个模型或训练出来的打分模型 |
| 规则验证器 | 用程序检查答案是否满足某条确定的规则,今天检查的是「未使用整月数」 |
| 假阴性 | 验证器把对的答案判成错的。今天全角冒号就造成了假阴性 |
| `Counter` | Python 标准库里专门计数的字典,`most_common(k)` 返回出现最多的 k 项,打平时按首次出现顺序 |
| 置信度 | 对答案有多确定。投票里 5 票全中和 3 比 2 可以当成两个不同的置信度 |
| 全角 / 半角 | 中文输入法下的「：」是全角(U+FF1A),英文的「:」是半角(U+003A),程序眼里是两个字符 |
| 思维树(ToT) | 把推理拆成多步,每步展开多个候选、打分剪枝,在推理步骤上搜索 |
| LATS | 把树搜索用在 Agent 上,节点是执行工具后的真实环境状态,失败时写反思 |
| 束宽 | 树搜索每一层保留几条路 |

## 常见误区

**以为投票越多越准。** 投票有效的前提是对的答案单次就占多数。第 5 题摸底时 5 次错 3 次,而且错成同一个数,投 50 票也只会更确定地选错。

**在思考模式下用投票。** DeepSeek 开思考时 temperature 不生效(Day 178 练习 4 实测过),采样的差异只能靠模型自己的随机性,不受你控制。今天的投票全部在关思考下做。

**用了验证器就觉得万无一失。** 今天的验证器只查月数,漏税的答案照样放行;第 2 题三个漏税答案全部通过验证,多数票还是错的。验证器查哪条规则,就只管那一条。

**正则只写半角冒号。** 中文场景下模型经常输出全角「：」,还会加 `**` 加粗。验证结果和直觉对不上时,先把被拒的原文打出来看。

**改格式要求不重跑评测。** 只是多要一行「未使用月数」,单次准确率就从摸底时的 83% 掉到 44%,因为模型把推导省了。提示词里任何一句改动都可能改变模型写多少,改完要重跑。

**把整个 Agent 跑 N 遍投票。** Agent 里有写操作,跑五遍就退了五次款。投票只用在没有副作用的那一步决策上。

**打平时以为投票「选出了」答案。** 五个答案各不相同时,`most_common` 返回的是第一个,这不是投票,是只问了一次。打平应该当成低置信度处理。

## 学习资料

### 文档与文章

- [Self-Consistency 论文](https://arxiv.org/abs/2203.11171):看第 2 节的方法图就够,一张图讲清楚「采样多次、按答案投票」,英文。
- [Let's Verify Step by Step](https://arxiv.org/abs/2305.20050):OpenAI 2023 年的论文,比较只看最终答案的验证器和逐步检查推理过程的验证器,看摘要和主图,英文。
- [Tree of Thoughts 论文](https://arxiv.org/abs/2305.10601):看「24 点」那个例子和搜索算法的伪代码,英文。
- [LATS 论文](https://arxiv.org/abs/2310.04406):看方法总图,理解它和思维树的区别是「有真实环境反馈」,英文。
- [Python 文档 · collections.Counter](https://docs.python.org/zh-cn/3/library/collections.html):中文,看 `Counter` 和 `most_common` 那一段,10 分钟。
- [Python 文档 · re 正则表达式](https://docs.python.org/zh-cn/3/library/re.html):中文,今天用到的 `findall`、方括号字符集都在这里,遇到问题再查。
- [Lilian Weng · Why We Think](https://lilianweng.github.io/posts/2025-05-01-thinking/):2025 年的长综述,把思维链、并行采样、序列修正、强化学习串成一张图,想系统了解时再读,两小时,英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV18opC6YEkD&autoplay=0&high_quality=1" title="思维链CoT的增强方案,Self-Consistency怎么做?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>图灵AI大模型 · 思维链CoT的增强方案,Self-Consistency怎么做? · 5 分钟,中文讲自洽投票的做法,适合先看一遍再敲今天的代码。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Gz4y1p7Du&autoplay=0&high_quality=1" title="10分钟理解Tree of Thoughts思维树" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>ranchlai · 10分钟理解Tree of Thoughts思维树 · 15 分钟,配合今天的伪代码看,理解「每步展开、打分、剪枝」。</figcaption>
</figure>

自洽投票论文的逐段讲解可以看 B 站 mardinff 的 [SELF-CONSISTENCY IMPROVES CHAIN OF THOUGHT REASONING IN LANGUAGE MODELS](https://www.bilibili.com/video/BV1aP411b7V3/),12 分钟。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/MG9oqntiJKg" title="AI Won't Plateau — if We Give It Time To Think" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>TED · Noam Brown · AI Won't Plateau — if We Give It Time To Think · OpenAI o1 的研究者之一讲「让模型多想一会儿」从扑克 AI 到大模型的来历,十几分钟,讲推理时多花算力最好的入门,英文可开字幕。</figcaption>
</figure>

想看思维树论文的完整精读,Yannic Kilcher 有一期 [Tree of Thoughts (Full Paper Review)](https://www.youtube.com/watch?v=ut5kp56wW_4),英文,较长,挑方法部分看。

### 书籍

- Sebastian Raschka《Build a Reasoning Model (From Scratch)》(Manning, 2026):有专门讲推理时增强的章节,自洽投票和验证器都从零实现了一遍,英文。
- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 2 章 test-time compute 一节讲多次采样再挑选的各种做法,以及怎么用验证器或打分模型挑。

### 开源项目与代码

- [rasbt/reasoning-from-scratch](https://github.com/rasbt/reasoning-from-scratch):上面那本书的配套代码,搜 `self_consistency` 能找到投票的实现。
- [princeton-nlp/tree-of-thought-llm](https://github.com/princeton-nlp/tree-of-thought-llm):思维树官方实现,看 `src/tot/methods/bfs.py`,一百来行就是那个搜索循环。
- [lapisrocks/LanguageAgentTreeSearch](https://github.com/lapisrocks/LanguageAgentTreeSearch):LATS 官方代码,知道有这个仓库就行。

## 自测

1. 自洽投票为什么能提高准确率?它有哪两个前提?

<details><summary>答案</summary>

正确答案能从多条推导路线得到,错误答案各错各的、比较分散,所以多次独立采样后对的答案更可能得票最多。前提一:答案要能直接比较是否相同(数字、选项、标签);前提二:每次采样要真的有差异(温度要够高,且接口真的让温度生效)。还有一个隐含前提:单次准确率本身要过半。

</details>

2. 今天第一版提示词下,第 2 题五个答案里三个是 4162.5,验证器全部放行。为什么?

<details><summary>答案</summary>

4162.5 = 9990 ÷ 12 × 5,月数 5 是对的,只是漏乘了 1.06 的税。验证器只检查「未使用月数」,不检查税,所以这三个答案都通过,多数票仍然是错的。验证器只管它检查的那条规则。

</details>

3. 验证器报「通过 2/5」,但五个答案全对,可能是什么原因?怎么排查?

<details><summary>答案</summary>

验证器出现了假阴性:规则对,但解析写窄了。今天的原因是模型用了全角冒号「：」,正则只认半角。排查办法是把被拒的那几条原文打印出来看,而不是只看通过率。

</details>

4. `Counter([747.5, 1196.0, 792.35, 1056.47]).most_common(1)` 返回什么?这对投票意味着什么?

<details><summary>答案</summary>

返回 `[(747.5, 1)]`。四个答案各一票打平,`most_common` 按首次出现的顺序排,返回第一个。这时的「多数票」其实就是第一次的答案,不代表任何共识,应该当成低置信度处理(比如转人工)。

</details>

5. (面试题)你们的客服 Agent 偶尔算错退款金额。同事提议「每次让 Agent 整个跑 5 遍,结果投票」。你怎么看?

<details><summary>答案</summary>

要点:①Agent 里有写操作,整个跑 5 遍会把退款执行 5 次,投票只能用在没有副作用的那一步(算金额),不能套在整个循环外面;②先看错在哪:我们实测错误集中在「申请当月不算」和「漏税」两类,而且让模型先写推导或开思考 low,单次就到了 100%,比投票便宜;③投票的前提是对的答案单次占多数,系统性错误投多少票都没用;④金额能用公式算,最可靠的是给 Agent 一个计算退款的工具,再加程序校验;⑤投票的票数可以当置信度,低置信的转人工,这是它在客服场景里真正有用的地方。

</details>

6. 思维树和自洽投票的区别是什么?为什么思维树很少放在线上请求里?

<details><summary>答案</summary>

自洽投票是把整道题从头答 N 遍再按最终答案投票;思维树把推理拆成多步,每一步展开多个候选、打分、只留最好的几个继续,是在中间步骤上搜索。思维树的调用次数大约是深度 × 束宽 × 展开数再加评估,比单次贵一到两个数量级,延迟也高,所以一般用在离线评测和生成训练数据上。

</details>

## 明天预告

明天是 **Day 180 · 好工具(一):工具不是 API,使用者变了**。今天两次得出同一个结论:能用程序精确算的东西,与其让模型多想、多投几票,不如给它一个好工具。那什么样的工具算「好」?明天先反过来,写一组功能完全没问题、但模型用起来很痛苦的工具,让 Agent 真的去用,量一量一次查询要吃掉多少 token,把「难用」具体到一条条能改的地方。
