---
title: 'Day 134 · 推理模型与 test-time compute:thinking 预算、自洽投票、树搜索'
description: '推理模型是怎么来的、各家(DeepSeek、Claude、OpenAI、通义)怎么开关和调思考强度、思考 token 怎么计费;用一套 CloudLedger 计费题实测思考关闭、low、high、max 和五次投票的准确率、token、延迟和花费;再讲自洽投票、best-of-N、树搜索这些「多花推理时间换准确率」的老办法,以及在 Agent 里什么时候值得开思考。'
pubDate: 2026-10-22
regime: none
tags: ['reasoning', 'thinking', 'test-time-compute', 'self-consistency', 'agent-60']
series: 'agent-60'
day: 134
lang: 'zh'
---

## 今天要解决的问题

这是专题篇的一篇,**建议在 [Day 10 · ReAct 与规划](/blog/agent-60/day-10-react-and-planning/) 之后读**。Day 1 告诉过你「思考模式」是个成本和效果的权衡,Day 10 说 ReAct 的 Thought 搬进了推理模型的思维链里。但一直没回答一个很实际的问题:**我的任务到底该不该开思考?开到多大?**

这个问题面试会问,上线前也必须回答。答错的代价有两种:该开没开,复杂的计费计算或多步规划就会错;不该开却开了,每次请求慢 5 秒、贵 4 倍,用户在聊天框前干等。今天我们用实测数据来回答,而不是凭感觉。

学完你应该能:

1. 用三五句话讲清推理模型是怎么训练出来的、「test-time compute」指什么。
2. 在 DeepSeek、Claude、OpenAI、通义四家的 API 里打开、关闭和调节思考强度,知道思考 token 怎么计费。
3. 自己搭一个小评测,量出不同思考强度在你的任务上的准确率、token、延迟和花费,并据此做选择。
4. 实现自洽投票(self-consistency),说清 best-of-N 加验证器、思维树(Tree of Thoughts)、LATS 的思路和适用场景。
5. 知道在 Agent 循环里用推理模型要注意什么:思考内容回传、交错思考、规划步和执行步分开定强度。

预计用时 3–4 小时。今天的代码放在 `agent-60-lab/topics/reasoning/`,目录下放一个空的 `__init__.py`(`topics/` 下也要有)。实测全部跑完大约花两三毛钱。

## 推理模型是怎么来的

先用最短的话讲原理,细节留给进阶篇的 Day 80。

普通的指令模型被训练成「看完问题直接给答案」。它当然也能一步一步推,前提是你在提示词里要求它这么做,这就是 2022 年那篇思维链(Chain-of-Thought)论文的发现:让模型先写推理过程,数学题准确率大幅上升。

推理模型把这件事从提示技巧变成了训练目标。2024 年 9 月 OpenAI 的 o1 是第一个大规模商用的,2025 年 1 月 DeepSeek-R1 的论文把方法公开了:拿大量**答案能被程序自动判对错**的题目(数学、代码),让模型自己生成长长的推理过程再给答案,答对给奖励、答错不给,用强化学习反复训练。这类训练叫 RLVR(可验证奖励的强化学习)。训练到后来,模型自己学会了在推理中途检查、回退、换个思路,R1 论文里管这叫「aha moment」。

于是出现了一个新的旋钮。以前想要更好的效果,只能换更大的模型,也就是在训练时多花算力。推理模型让你可以在**推理时**多花算力:让同一个模型想得更久,效果就更好。这就是 **test-time compute**(测试时计算,也叫推理时计算)。2024 年伯克利和 Google DeepMind 的一篇论文(Snell 等)专门研究过这个取舍,结论是在不少任务上,让小模型多想一会儿,比换一个大十几倍的模型更划算。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="两种花算力的方式">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
  <text x="160" y="30" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">训练时多花:换更大的模型</text>
  <text x="480" y="30" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">推理时多花:让模型多想</text>
  <line x1="320" y1="15" x2="320" y2="215" stroke="var(--rule)" stroke-dasharray="4 4"/>
  <rect x="50" y="60" width="60" height="40" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="80" y="85" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">小模型</text>
  <rect x="170" y="50" width="110" height="60" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="225" y="85" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">大模型</text>
  <line x1="110" y1="80" x2="170" y2="80" stroke="var(--ink-soft)"/>
  <text x="160" y="145" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">每个请求都更贵</text>
  <text x="160" y="165" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">不管题难不难</text>
  <rect x="360" y="60" width="60" height="40" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="390" y="85" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">同一个</text>
  <rect x="440" y="65" width="30" height="30" fill="var(--compute-wash)" stroke="var(--compute)" rx="3"/>
  <rect x="480" y="65" width="60" height="30" fill="var(--compute-wash)" stroke="var(--compute)" rx="3"/>
  <rect x="550" y="65" width="70" height="30" fill="var(--compute-wash)" stroke="var(--compute)" rx="3"/>
  <text x="455" y="84" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">low</text>
  <text x="510" y="84" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">high</text>
  <text x="585" y="84" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">max</text>
  <text x="480" y="145" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">思考 token 按需花</text>
  <text x="480" y="165" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">难题多想,简单题少想或不想</text>
  <text x="320" y="205" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">另一条路:同一个模型答 N 次再挑(投票、best-of-N、树搜索)</text>
</svg>
<figcaption>提升效果的两种花钱方式。左边是在训练时多花,换来的是每个请求都贵;右边是在推理时多花,由思考强度控制,可以按任务难度调。底下那行是另一类不依赖推理模型的推理时计算,本课后半段讲。</figcaption>
</figure>

对 Agent 工程师来说,原理到这里就够了。你需要记住两个推论:**思考只在「能一步步推出对错」的题上明显有用**(计算、逻辑、规划、代码),闲聊和简单分类上帮助很小;**思考是要付钱的输出 token**,而且会推迟第一个字出现的时间。

## 各家怎么开关、怎么调

2026 年 10 月我查了四家的官方文档,接口差别很大,下面这张表是最常用的部分。参数名变得很快,写代码前再去看一眼原文(链接在学习资料里)。

| 厂商 | 开关 | 强度 | 思考内容在哪 | 备注 |
| --- | --- | --- | --- | --- |
| DeepSeek(`deepseek-flash`、`deepseek-v4-pro`) | `extra_body={"thinking": {"type": "enabled" 或 "disabled"}}`,**默认开启** | `reasoning_effort`:`low` / `high` / `max`,默认 `high` | 响应里的 `reasoning_content`,和 `content` 同级 | 带 `tools` 的对话,历史轮次的 `reasoning_content` 必须完整回传,否则 400 |
| Claude(Messages API) | 新模型是自适应思考(adaptive thinking),模型自己决定想不想、想多少 | `output_config.effort`:`low` / `medium` / `high` / `xhigh` / `max`,默认值因模型而异 | content 里的 `thinking` 块 | 部分模型在高强度下不能关思考,`max_tokens` 包含思考,要留够 |
| OpenAI(Responses API) | 推理模型一直会推理,`none` 档可以关(不是所有模型都支持) | `reasoning.effort`:`none` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`,具体支持哪些看模型 | 默认不返回原文,`usage.output_tokens_details.reasoning_tokens` 给数量 | 推理 token 不可见但按输出计费 |
| 通义(百炼) | `extra_body={"enable_thinking": True/False}`,默认值因模型而异 | `thinking_budget`:思考 token 上限,到了就立刻开始写回答 | 响应里的 `reasoning_content` | 有些开源版模型开思考时只支持流式调用 |

有几个容易踩的地方单独说。

DeepSeek 的 `reasoning_effort` 是 OpenAI SDK 原生支持的参数,直接作为关键字参数传就行;`thinking` 开关不是 OpenAI 标准字段,要放进 `extra_body`。DeepSeek 文档还写了一张映射表:你传 `medium` 会被当成 `high`,传 `minimal` 会被当成 `low`,所以用同一份代码切厂商不会报错,但效果档位不一定是你以为的那个。

Claude 的 `effort` 不只管思考,它管**整个回答的所有 token**,包括正文长度和工具调用的数量。文档的说法是低强度会合并操作、少调工具、少说废话。另外 effort 是「行为信号」,不是严格的 token 上限,低强度遇到真正难的题它照样会想,只是想得少一些。

通义的 `thinking_budget` 是最接近「预算」这个词的:给一个 token 数,想到这么多就停下来写答案。OpenAI 和 DeepSeek 都只给档位,不给精确预算。

## 思考 token 怎么算钱

四家的规则其实一样:**思考 token 按输出 token 计费**。OpenAI 文档原话是推理 token「are billed as output tokens」;DeepSeek 的价格页写按输入和输出的总 token 数计费,实测响应里的 `completion_tokens` 已经包含了思考部分;通义还多了一条,混合思考模型只要输出了思考过程,整个回答(思考加正文)都按思考模式的输出单价算。

输出 token 通常是输入的 4 倍价。按课程 Day 3 查到的 `deepseek-flash` 高峰价(输入未命中每百万 2 元、输出每百万 8 元)算一笔账:一次请求输入 600 token,关思考时输出 250 token,花费是 600 × 2 + 250 × 8 = 3,200,再除以一百万,约 0.0032 元;开思考 high 时输出 1,200 token,600 × 2 + 1,200 × 8 = 10,800,约 0.0108 元,贵了 3 倍多。一天十万次请求,差的就是七百多元。

所以「默认开到最大」在原型阶段无所谓,上了量就是一笔明确的成本。下面用数据说话。

## 实验:一套计费题,五种配置

找一个思考可能有用的任务。CloudLedger 的计费规则正好合适:升级按天折算、降级下期生效、优惠券先打折后加税、年付退款只退未使用的整月。规则不复杂,但几条叠在一起很容易漏一条。题目的标准答案全部用 Python 按规则算出来,这样判卷不靠人眼。

```python
# agent-60-lab/topics/reasoning/billing_quiz.py
from decimal import ROUND_HALF_UP, Decimal

RULES = """云簿 CloudLedger 计费规则:
1. 月价:基础版 99 元,专业版 299 元,企业版 999 元。按席位计费时,上面是每个席位的月价。年付价 = 月价 × 10。
2. 月中升级(或加席位):立刻生效,补差价 = 月价差 × 剩余天数 ÷ 当月天数,剩余天数包含升级当天。
3. 降级:下个计费周期生效,当期不退款、不补差价。
4. 优惠券打折作用在不含税价上,然后再加 6% 的税。
5. 退款:只有专业版和企业版的年付可以退,退未使用的整月(申请当月不算未使用),退款 = 年付价 ÷ 12 × 未使用整月数,税一并按 6% 退回。基础版年付、所有月付都不退款。
6. 用了优惠券的年付,退款按折后价计算。
7. 只在最后一步四舍五入到分。2026 年 2 月有 28 天。"""


def money(x: float | Decimal) -> float:
    return float(Decimal(str(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


TAX = 1.06
# (问题, 标准答案):答案都用 Python 按上面的规则算出来,不手算
QUIZ: list[tuple[str, float]] = [
    ("客户 2026-03-10 从基础版月付升级到专业版月付,当月要补多少差价(不含税)?", money(200 * 22 / 31)),
    ("客户 2026-02-15 从专业版月付升级到企业版月付,当月补差价含税多少?", money(700 * 14 / 28 * TAX)),
    ("企业版年付,2026-01-01 开始,2026-04-20 申请退款,能退多少(含税)?", money(9990 / 12 * 8 * TAX)),
    ("基础版年付,2026-01-01 开始,2026-06-01 申请退款,能退多少?", 0.0),
    ("专业版月付,用了一张 8 折券,每月含税要付多少?", money(299 * 0.8 * TAX)),
    ("企业版月付客户 2026-03-25 降级到专业版,3 月能退多少?", 0.0),
    ("客户 2026-04-30 从基础版月付升级到企业版月付,当月补差价含税多少?", money(900 * 1 / 30 * TAX)),
    ("专业版月付有 3 个席位,2026-09-11 再加 2 个席位,9 月要补多少(不含税)?", money(2 * 299 * 20 / 30)),
    ("新客户买专业版年付,用一张 85 折券,首年含税要付多少?", money(2990 * 0.85 * TAX)),
    ("专业版年付,2026-01-01 开始,2026-07-15 申请退款,能退多少(含税)?", money(2990 / 12 * 5 * TAX)),
    ("客户 3 月 1 日是专业版月付,当天正常扣了 3 月的月费,2026-03-05 又升级到企业版。3 月一共付了多少(不含税)?", money(299 + 700 * 27 / 31)),
    ("专业版月付,有一张长期 9 折券(对差价也有效),2026-05-16 升级到企业版,当月补差价含税多少?", money(700 * 0.9 * 16 / 31 * TAX)),
]

# 难题:一道题里叠好几条规则,还埋了陷阱(降级不影响当期、申请当月不算未使用)
QUIZ_HARD: list[tuple[str, float]] = [
    ("专业版月付 2 个席位,2026-02-10 全部升级到企业版,2026-02-20 又加 1 个企业版席位。2 月两次补差价合计含税多少?",
     money((2 * 700 * 19 / 28 + 999 * 9 / 28) * TAX)),
    ("企业版年付 3 个席位,2026-01-01 开始,2026-05-31 申请退款,能退多少(含税)?", money(9990 * 3 / 12 * 7 * TAX)),
    ("基础版月付,有长期 8 折券(对差价也有效)。2026-07-20 升级到专业版,2026-07-25 又降级回基础版。7 月因为这两次变更一共补了多少(含税)?",
     money(200 * 0.8 * 12 / 31 * TAX)),
    ("专业版年付,2026-01-01 开始,没用券。2026-03-15 申请降级到基础版年付,2026-03-20 又申请退款。能退多少(含税)?",
     money(2990 / 12 * 9 * TAX)),
    ("企业版年付,首年用了 85 折券,2026-01-01 开始,2026-10-08 申请退款,能退多少(含税)?", money(9990 * 0.85 / 12 * 2 * TAX)),
    ("专业版月付 2 个席位。2026-04-10 申请减掉 1 个席位,2026-04-15 把账号升级到企业版。4 月升级要补多少差价(含税)?",
     money(2 * 700 * 16 / 30 * TAX)),
    ("2026-02-28 客户从基础版月付升级到企业版月付,3 月 1 日正常扣企业版月费。2 月的差价加 3 月月费一共多少(不含税)?",
     money(900 * 1 / 28 + 999)),
    ("专业版月付 3 个席位,有长期 9 折券(对差价也有效)。2026-11-16 同一天:全部升级到企业版,并且再加 2 个企业版席位。当月要补多少(含税)?",
     money((3 * 700 * 15 / 30 + 2 * 999 * 15 / 30) * 0.9 * TAX)),
]

if __name__ == "__main__":
    for q, a in QUIZ + QUIZ_HARD:
        print(f"{a:>10.2f}  {q}")
```

<div class="line-notes">

- `RULES = """云簿 CloudLedger 计费规则:` 规则写进 system prompt,模型每道题都能看到全部规则。规则 5 和 Day 23 造数脚本里的退款政策一致:年付只有专业版和企业版能退。
- `5. 退款:只有专业版和企业版的年付可以退,退未使用的整月(申请当月不算未使用)` 这一句是陷阱最多的地方。4 月 20 日申请,4 月本身不算未使用,未使用的是 5–12 月共 8 个月。
- `7. 只在最后一步四舍五入到分。` 不写这条,模型可能每一步都四舍五入,答案差几分钱,判卷时就算错。
- `return float(Decimal(str(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))` Python 的 `round()` 是「银行家舍入」(四舍六入五成双),和财务上的四舍五入不一样。用 `Decimal` 加 `ROUND_HALF_UP` 才是我们要的规则。先 `str(x)` 再转 `Decimal`,避免把浮点误差带进来。
- `("客户 2026-03-10 从基础版月付升级到专业版月付,` 3 月有 31 天,10 号升级,剩余天数含当天是 31 − 10 + 1 = 22 天。差价 200 × 22 ÷ 31 = 141.935…,答案 141.94。
- `("企业版年付,2026-01-01 开始,2026-04-20 申请退款,` 9990 ÷ 12 × 8 × 1.06 = 7059.60。
- `("基础版年付,2026-01-01 开始,2026-06-01 申请退款,能退多少?", 0.0),` 陷阱题:基础版年付不退。
- `("企业版月付客户 2026-03-25 降级到专业版,3 月能退多少?", 0.0),` 陷阱题:降级下期生效,当期不退。
- `QUIZ_HARD: list[tuple[str, float]] = [` 第一批 12 题后来发现太简单(下面有数据),于是加了 8 道把三四条规则叠在一起的。
- `money((2 * 700 * 19 / 28 + 999 * 9 / 28) * TAX)),` 难题第 1 题:2 月 10 日两个席位各补 700 元月差价的 19/28,20 日新加的企业版席位按 999 元的 9/28 收,两笔加起来再加税。实测标准答案 1347.37。
- `("专业版年付,2026-01-01 开始,没用券。2026-03-15 申请降级到基础版年付,` 陷阱:降级下个周期才生效,3 月 20 日申请退款时还是专业版年付,可以退 4–12 月 9 个月,答案 2377.05。模型容易被「降级到基础版」带偏,以为基础版不能退。
- `("企业版年付,首年用了 85 折券,2026-01-01 开始,2026-10-08 申请退款,` 申请当月 10 月不算,未使用的只有 11、12 两个月。9990 × 0.85 ÷ 12 × 2 × 1.06 = 1500.17。下面会看到,思考关闭时模型有时把 10 月也算进去,得到 2250.25。
- `("专业版月付 2 个席位。2026-04-10 申请减掉 1 个席位,` 陷阱:减席位也是降级,下期生效,15 号升级时仍是 2 个席位。答案 791.47。
- `print(f"{a:>10.2f}  {q}")` 运行 `uv run python -m topics.reasoning.billing_quiz` 打印 20 道题和答案,自己先核对一遍规则,再拿去考模型。

</div>

评测脚本对每种配置把一套题并发跑一遍,统计对了几道、平均输出 token、平均耗时和总花费。自洽投票单独写成一个函数。

```python
# agent-60-lab/topics/reasoning/effort_sweep.py
import os
import re
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from common.llm import LLMClient
from topics.reasoning.billing_quiz import QUIZ, QUIZ_HARD, RULES

QUESTIONS = QUIZ_HARD if os.environ.get("QUIZ") == "hard" else QUIZ  # QUIZ=hard 跑难题

SYSTEM = RULES + "\n\n回答计费问题。最后一行只写「答案:金额」,金额是数字,不带单位和千分位,例如「答案:123.45」。"
ANS_RE = re.compile(r"答案[::]\s*(-?[\d.]+)")

# 每种配置 = 传给 chat() 的额外参数
CONFIGS: dict[str, dict[str, Any]] = {
    "思考关闭": {"extra_body": {"thinking": {"type": "disabled"}}},
    "思考 low": {"extra_body": {"thinking": {"type": "enabled"}}, "reasoning_effort": "low"},
    "思考 high": {"extra_body": {"thinking": {"type": "enabled"}}, "reasoning_effort": "high"},
    "思考 max": {"extra_body": {"thinking": {"type": "enabled"}}, "reasoning_effort": "max"},
}


def parse(text: str) -> float | None:
    found = ANS_RE.findall(text.replace(",", ""))
    return float(found[-1]) if found else None


def ask(llm: LLMClient, question: str, **kw: Any) -> tuple[float | None, int, float]:
    t0 = time.perf_counter()
    r = llm.chat([{"role": "system", "content": SYSTEM}, {"role": "user", "content": question}], **kw)
    return parse(r.content), r.completion_tokens, time.perf_counter() - t0


def run_config(name: str, kw: dict[str, Any]) -> None:
    llm = LLMClient()
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda qa: ask(llm, qa[0], **kw), QUESTIONS))
    right = sum(1 for (got, _, _), (_, gold) in zip(results, QUESTIONS) if got is not None and abs(got - gold) < 0.011)
    wrong = [i + 1 for i, ((got, _, _), (_, gold)) in enumerate(zip(results, QUESTIONS)) if got is None or abs(got - gold) >= 0.011]
    out_tok = sum(r[1] for r in results) / len(results)
    lat = sum(r[2] for r in results) / len(results)
    print(f"{name:10} 对 {right}/{len(QUESTIONS)} | 平均输出 {out_tok:6.0f} tok | 平均耗时 {lat:5.1f}s | 共 ¥{llm.ledger.cost:.4f} | 错题 {wrong}")


def self_consistency(n: int = 5) -> None:
    """思考关闭,每题采样 n 次(temperature=1),按答案投票。"""
    llm = LLMClient()
    kw = {"extra_body": {"thinking": {"type": "disabled"}}, "temperature": 1.0}
    right, wrong = 0, []
    t0 = time.perf_counter()
    for i, (q, gold) in enumerate(QUESTIONS, 1):
        with ThreadPoolExecutor(max_workers=n) as pool:
            votes = [g for g, _, _ in pool.map(lambda _: ask(llm, q, **kw), range(n)) if g is not None]
        best = Counter(round(v, 2) for v in votes).most_common(1)
        if best and abs(best[0][0] - gold) < 0.011:
            right += 1
        else:
            wrong.append(i)
    lat = (time.perf_counter() - t0) / len(QUESTIONS)
    print(f"{'投票 x' + str(n):10} 对 {right}/{len(QUESTIONS)} | 每题 {n} 次调用        | 每题耗时 {lat:5.1f}s | 共 ¥{llm.ledger.cost:.4f} | 错题 {wrong}")


if __name__ == "__main__":
    picked = sys.argv[1:] or list(CONFIGS) + ["投票"]
    for name in picked:
        if name == "投票":
            self_consistency()
        else:
            run_config(name, CONFIGS[name])
```

<div class="line-notes">

- `QUESTIONS = QUIZ_HARD if os.environ.get("QUIZ") == "hard" else QUIZ` 用环境变量切题库:`uv run python -m topics.reasoning.effort_sweep` 跑 12 道基础题,前面加 `QUIZ=hard` 跑 8 道难题。
- `SYSTEM = RULES + "\n\n回答计费问题。最后一行只写「答案:金额」` 规定输出格式方便程序判卷,思路和 Day 5 让分类结果只输出类别名一样。
- `ANS_RE = re.compile(r"答案[::]\s*(-?[\d.]+)")` 冒号全角半角都认。实测模型有时会写成加粗的 `**答案:1500.17**`,这个正则照样能抠出数字,因为它不要求「答案」在行首。
- `"思考关闭": {"extra_body": {"thinking": {"type": "disabled"}}},` 和课程 `.env` 里 `LLM_EXTRA_BODY` 的默认值一样。`LLMClient._kwargs` 会把这里的 `extra_body` 和 `.env` 里的合并,同名的 `thinking` 以这里为准,所以下面几档能把思考打开。
- `"思考 low": {"extra_body": {"thinking": {"type": "enabled"}}, "reasoning_effort": "low"},` `reasoning_effort` 是 OpenAI SDK 自带的参数(实测 openai 3.29 的 `chat.completions.create` 签名里有它),不用放进 `extra_body`。
- `found = ANS_RE.findall(text.replace(",", ""))` 先去掉千分位逗号,再找所有「答案:」,取最后一个。模型偶尔会在推导中间写一句「初步答案:…」,取最后一个更稳。
- `return parse(r.content), r.completion_tokens, time.perf_counter() - t0` 只解析 `content`,不看 `reasoning_content`。`completion_tokens` 是 DeepSeek 返回的输出 token 数,开思考时包含思考部分,实测一次 high 调用 `completion_tokens` 是 871,其中思考内容 1096 个字符、正文 174 个字符。
- `with ThreadPoolExecutor(max_workers=6) as pool:` 6 个并发,12 道题两轮就跑完。Day 3 说过 DeepSeek 的并发上限很高,这点量碰不到限速。
- `results = list(pool.map(lambda qa: ask(llm, qa[0], **kw), QUESTIONS))` `pool.map` 保持输入顺序返回,所以下面能和 `QUESTIONS` 一一 zip 起来判卷。
- `abs(got - gold) < 0.011` 允许一分钱以内的误差。金额是两位小数,严格相等比较浮点数会因为表示误差误判。
- `kw = {"extra_body": {"thinking": {"type": "disabled"}}, "temperature": 1.0}` 自洽投票需要每次采样不一样,所以把温度调到 1。开了思考模式很多厂商会忽略 temperature(Day 1 提过),这也是投票这一档用思考关闭的原因之一。
- `votes = [g for g, _, _ in pool.map(lambda _: ask(llm, q, **kw), range(n)) if g is not None]` 同一道题并发问 5 次,抠不出答案的那次直接丢掉。
- `best = Counter(round(v, 2) for v in votes).most_common(1)` 按金额计票,取票数最多的那个。`most_common(1)` 返回 `[(金额, 票数)]`,投票全部失败时是空列表,所以下一行先判断 `best`。

</div>

先跑 12 道基础题:`uv run python -m topics.reasoning.effort_sweep`。我 2026 年 10 月用 `deepseek-flash` 跑出来是这样:

| 配置 | 对 | 平均输出 token | 平均耗时 | 12 题总花费 |
| --- | --- | --- | --- | --- |
| 思考关闭 | 12/12 | 108 | 1.1s | ¥0.0160 |
| 思考 low | 12/12 | 340 | 2.1s | ¥0.0389 |
| 思考 high | 12/12 | 424 | 2.5s | ¥0.0470 |
| 思考 max | 12/12 | 534 | 3.1s | ¥0.0576 |
| 投票 x5 | 12/12 | 每题 5 次 | 1.4s | ¥0.0756 |

全对。我一开始是有点失望的:设计了两个陷阱题,结果关着思考也全答对了。但这本身就是第一个结论:**你以为难的题,对 2026 年的模型可能不难**。在这套题上,开思考只是让每题多花 2 到 3 倍的钱和时间,换不来任何准确率。如果没跑这一遍、凭感觉默认开 high,就白花了这笔钱。

然后跑难题:`QUIZ=hard uv run python -m topics.reasoning.effort_sweep`。我连跑了三遍,汇总如下(准确率是三遍合计,其他是三遍的范围):

| 配置 | 对(三遍合计) | 平均输出 token | 平均耗时 | 8 题总花费 |
| --- | --- | --- | --- | --- |
| 思考关闭 | 23/24 | 265–293 | 1.9–2.6s | ¥0.021–0.022 |
| 思考 low | 24/24 | 946–1,036 | 5.1–5.4s | ¥0.066–0.070 |
| 思考 high | 24/24 | 1,212–1,384 | 6.0–7.1s | ¥0.081–0.092 |
| 思考 max | 24/24 | 1,806–2,064 | 9.3–10.4s | ¥0.119–0.136 |
| 投票 x5 | 24/24 | 每题 5 次 | 2.7–3.1s | ¥0.125–0.135 |

思考关闭错的那一题是难题第 5 题(折扣年付在 10 月 8 日申请退款)。我单独把这题用思考关闭问了 3 次,两次答对 1500.17,一次答成 2250.25,正好是把申请当月 10 月也算成未使用、多退了一个月。同一道题开思考 high 时答对,思考内容里能看到它专门确认了「申请当月不算」。

把这两张表合起来看,能得出几条可以直接用的结论。

**思考的收益集中在少数「容易漏规则」的题上。** 难题里思考关闭也有 96% 的正确率,开思考把剩下那 4% 补上了,代价是 3 到 6 倍的花费和 2 到 5 倍的延迟。值不值,取决于这 4% 的错误有多贵。退款金额算错一次,客服要人工道歉、财务要冲正,那显然值;如果只是给内部看的估算,就不值。

**low 已经拿到了全部收益。** 在这套题上 low、high、max 准确率一样,max 的花费是 low 的近 2 倍。档位越高不等于越好,Claude 的文档在 `max` 那一档也写了类似的提醒:多数任务上 max 花了很多钱、质量只多一点点,结构化输出这类任务还可能想过头。

**投票是另一种花法。** 五次投票的花费和 max 差不多,但耗时只有 max 的三分之一左右,因为 5 次调用是并发的。延迟敏感、预算够的场景,它是开思考的替代方案。

这些结论只对 `deepseek-flash` 和这套题成立。换个模型、换个任务,数字会完全不同。**这一节真正要你带走的是方法**:20 道题、一个判卷函数、五种配置,半小时就能跑完,上线前在你自己的任务上做一遍。

## 延迟:第一个字要等多久

上面的「平均耗时」是整个请求的时间。对聊天界面,用户更在乎的是第一个字什么时候出现(首 token 延迟,TTFT,Day 4 讲过)。开了思考,模型要先想完才开始写正文,这段时间用户看到的是一个转圈。

```python
# agent-60-lab/topics/reasoning/ttft.py
from common.llm import LLMClient
from topics.reasoning.billing_quiz import QUIZ_HARD
from topics.reasoning.effort_sweep import SYSTEM

question = QUIZ_HARD[0][0]
msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": question}]
for label, kw in [
    ("思考关闭", {"extra_body": {"thinking": {"type": "disabled"}}}),
    ("思考 high", {"extra_body": {"thinking": {"type": "enabled"}}, "reasoning_effort": "high"}),
]:
    llm = LLMClient()
    for _ in llm.stream(msgs, **kw):
        pass
    r = llm.last
    print(f"{label}: 首个正文 token {r.ttft:.1f}s,总耗时 {r.latency:.1f}s,输出 {r.completion_tokens} tok,"
          f"思考 {len(r.reasoning or '')} 字")
```

<div class="line-notes">

- `from topics.reasoning.effort_sweep import SYSTEM` 复用同一份 system prompt。import 这个模块不会触发评测,因为评测代码在它的 `if __name__ == "__main__":` 下面。
- `question = QUIZ_HARD[0][0]` 难题第 1 题(两次升级加席位那道),标准答案 1347.37。
- `for _ in llm.stream(msgs, **kw):` Day 4 的 `stream()` 是个生成器,逐段 yield 正文。这里不打印,只是把它消费完,让它把 `ttft` 和 `latency` 记下来。
- `r = llm.last` 流式结束后,`LLMClient` 把完整结果放在 `last` 上。`ttft` 只在流式时有值,算的是第一段**正文**出现的时间,思考内容(`reasoning_content`)不算。
- `f"思考 {len(r.reasoning or '')} 字")` 思考关闭时 `reasoning` 是 `None`,`or ''` 让它变成空串,长度 0。实测三次开 high 的思考长度分别是 2013、1219、4984 个字符,同一道题波动很大。

</div>

运行 `uv run python -m topics.reasoning.ttft`。我跑了三次:思考关闭时首个正文 token 在 0.7–1.1 秒出现;思考 high 时是 4.0、7.1、8.5 秒,而且这几秒里用户什么也看不到,正文一出来没多久就结束了。

工程上有两个常见的处理办法。一是把思考过程流式展示出来(DeepSeek 流式响应里 `reasoning_content` 是一段一段来的,可以显示成灰色的「正在思考…」折叠区),用户看到东西在动,等待感会好很多,DeepSeek 自己的网页版和 Claude 的应用都是这么做的。二是不让用户等:对话里先用不思考的快速回答顶上,复杂计算丢给后台任务(Day 37 的队列),算完再推送结果。

## 不靠推理模型的老办法

推理模型出现之前,大家已经发明了好几种「推理时多花算力」的办法。它们现在仍然有用,原因是:它们可以叠加在任何模型上,而且有些场景比单纯开思考更合适。

**自洽投票(Self-Consistency)。** 2022 年 Google 的论文。同一个问题让模型带着思维链答 N 次(温度调高,让每次推理路径不同),最后按答案投票。直觉是:正确答案可以从很多条路推出来,错误答案往往各错各的,所以正确答案更容易得票最多。上面的实验里它就是「投票 x5」那一行。它的前提是**答案能比较是否相同**:数字、选项、类别都可以,开放式的长文本就没法直接投票(得先让另一个模型判断哪些回答意思相同,成本又上去了)。

**best-of-N 加验证器。** 也是答 N 次,但不投票,而是用一个验证器给每个答案打分,选最高的。验证器可以是规则(格式对不对、金额是不是负数、退款有没有超过实付)、可以是单元测试(代码题直接跑测试)、可以是另一个模型(Day 32 的 LLM-as-judge),也可以是专门训练的奖励模型。OpenAI 2023 年的论文《Let's Verify Step by Step》比较过只看最终答案的验证器和逐步检查推理过程的验证器,后者效果更好。代码 Agent 里最常见的就是这个模式:生成几个补丁,哪个能让测试通过就用哪个。

**思维树(Tree of Thoughts)。** 2023 年普林斯顿和 Google DeepMind 的论文。把推理拆成若干步,每一步让模型提出几个候选「想法」,再让模型(或规则)评估每个候选有没有前途,只保留最好的几个继续往下展开,走进死胡同就回退。本质是在推理步骤上做广度优先或深度优先搜索。论文里的例子是「24 点」游戏,普通思维链成功率很低,思维树高得多。

**LATS(Language Agent Tree Search)。** 2023 年 UIUC 的论文,把蒙特卡洛树搜索用到 Agent 上:每个节点是一个「执行了某些动作之后的状态」,模型提议下一步动作,环境返回真实的观察,模型评估这个状态的价值,失败时写反思,再回到树上别的分支继续试。它比思维树多了一样关键的东西:**真实环境的反馈**。

思维树的骨架大概是这样(伪代码,只为说明结构,不用跑):

```text
frontier = [初始状态]
for depth in range(最大步数):
    candidates = []
    for state in frontier:
        for idea in 模型提议下一步(state, k=3):        # 每个状态展开 3 个想法
            candidates.append(state + idea)
    scored = [(模型或规则打分(c), c) for c in candidates]
    frontier = 取分数最高的 b 个(scored)               # 束宽 b,其余剪掉
    if 有任何 c 已经是完整答案且通过检查: return c
return frontier 里分数最高的
```

这四种办法有个共同的代价:**调用次数成倍增加**。投票和 best-of-N 是 N 倍;思维树每层展开 k 个、保留 b 个,深度 d,大约要 d × b × k 次生成加同样多次评估。所以它们只用在「答对的价值远大于多花的钱」而且「答案能验证」的地方。

在 2026 年,我的经验是这样分工:**单次推理够难就开思考模式**,这是最便宜的推理时计算;**答案能被程序验证**(代码能跑测试、金额能复算)就用 best-of-N 加程序验证器,验证器比模型可靠得多;**需要和环境交互、走错了能回退**的任务(浏览器操作、复杂排查)才考虑树搜索,而且通常是在离线评测或者生成训练数据时用,很少直接放在线上请求的路径上。

这里顺便回扣一下专题篇的 [Day 132](/blog/agent-60/day-132-code-as-action/):计费这种能写成公式的计算,最可靠的做法根本不是让模型多想,而是让模型写代码去算,或者直接给它一个算差价的工具。思考强度是在你没有更好的工具时才用的手段。

## 在 Agent 里用推理模型

前面的实验都是单轮问答。放进 Agent 循环,还有几件事要注意。

**思考内容要按厂商的规则回传。** DeepSeek 带工具调用时,历史上每一轮 assistant 消息里的 `reasoning_content` 都必须原样带回去,少一个就 400。Day 9 的 `_assistant_dict` 和 Day 4 的 `LLMClient.chat`(用 `model_dump` 保留全部字段)已经处理了这一点,自己写循环时别把它丢了。Claude 那边是 `thinking` 块要原样回传,而且带着签名,不能改内容。

**交错思考。** Claude 支持在两次工具调用之间再思考,也就是每拿到一个工具结果都能先想一想再决定下一步,Day 10 提过这几乎就是 ReAct 的原生实现。DeepSeek 带工具时也会在每轮重新思考。好处是每一步决策都更稳,代价是每一轮都有思考 token,一个 10 步的任务思考 token 可能比正文多好几倍。

**规划步和执行步分开定强度。** Agent 里的调用并不一样难。Day 10 的 plan-and-execute 里,列计划那一次决定了整个任务的方向,值得开高强度;后面执行每一步、把工具结果整理成一句话,开低强度甚至关掉就够了。同一个对话里切强度,Claude 2026 年有一个 beta 功能叫 per-message effort,可以在对话中间用一条只带 `output_config` 的 system 消息改后续回合的强度,还不破坏 prompt cache;别的厂商可以直接在每次请求里传不同的参数,代价是 prompt cache 可能失效,要实测。

**低强度也能变得「更用心」。** Claude 的文档提到一个技巧:如果为了延迟必须用低强度,但又发现它在复杂问题上推理太浅,可以在提示词里加一句「这个任务需要多步推理,回答前仔细想清楚」。这本质上就是回到 2022 年的思维链提示。

**思考内容不是给用户看的答案。** 思考过程里会出现被否定的错误思路、内部规则的原文、甚至它对用户的揣测。展示给用户前要想清楚:给专业用户看推理过程能增加信任,给普通客户看可能制造困惑,还可能泄露你的 system prompt。

## 什么时候值得开

把今天的内容压缩成一个判断流程:

1. **任务能不能用工具或代码精确算?** 能,就给工具,别靠思考(Day 132)。
2. **在你的评测集上,关思考的准确率够不够?** 跑一遍 effort sweep。够,就关。这一步最常被跳过,也最省钱。
3. **不够的话,错在哪类题?** 如果集中在少数复杂题,考虑路由:先用便宜的分类器判断难度,难题才开思考(Day 38 的模型路由思路)。
4. **开的话从最低档开始往上加**,直到准确率不再涨。我们这套题 low 就到顶了。
5. **对延迟敏感的界面**,要么流式展示思考,要么并发投票代替长思考,要么把计算放到后台。
6. **答案能程序验证、错误代价又很高**,再考虑 best-of-N 加验证器,或者树搜索。

面试时被问「你们的 Agent 开不开思考模式」,能按这个流程说,再报一组自己量过的数字,比说「我们用的是最强的推理模型」有说服力得多。

## 动手练习

### 练习 1:复现实验

1. 建 `topics/reasoning/__init__.py`,放入 `billing_quiz.py`、`effort_sweep.py`、`ttft.py` 三个文件。
2. 运行 `uv run python -m topics.reasoning.billing_quiz`,对照规则手算两道题,确认标准答案没写错。
3. 运行基础题和难题两套 sweep,难题跑三遍。
4. 运行 `ttft.py` 三次。

验收:填出你自己的两张表和首 token 延迟数字,写三句话结论,说清在你的模型上关思考、low、high 各自值不值。

### 练习 2:把题出难,找到思考的拐点

往 `QUIZ_HARD` 里再加 5 道题,要求每道题至少叠 4 条规则,比如「年付企业版 3 个席位,用 9 折券,年中加 2 个席位,9 月申请退款」。规则里没有写清楚的情况(比如加席位后年付怎么算)要先在 RULES 里补一条规则,再用 Python 算标准答案。

验收:找到至少 1 道「思考关闭三次里错两次以上、思考 low 能答对」的题,把它和模型的错误答案记下来,分析错在哪条规则。

### 练习 3:best-of-N 加规则验证器

在 `effort_sweep.py` 里加一个 `best_of_n(n=5)` 配置:思考关闭、温度 1,每题采样 5 次,然后用一个规则验证器过滤:退款题的答案不能超过实付总额、不能是负数,升级补差价不能超过一个整月的月价差乘席位数再加税。通过验证的答案里再投票,一个都没通过就取原始投票结果。

验收:和「投票 x5」比较准确率和花费。想一想:验证器如果能写得足够完整,它和 Python 直接算标准答案还有什么区别?(这个问题的答案就是为什么 Day 132 的做法更好。)

### 练习 4:换一家厂商

如果你有阿里云百炼的 key,在 `.env.qwen` 里配上通义的模型,把 `CONFIGS` 改成用 `extra_body={"enable_thinking": True, "thinking_budget": 200}`、`500`、`2000` 三档,再跑难题。注意:有的开源版模型开思考只支持流式,遇到 `only support stream call` 的报错就换成商业版模型,或者把 `ask()` 改成用 `llm.stream()`。

验收:得到一张通义的表,和 DeepSeek 对比;说明 `thinking_budget` 这种精确预算和 `reasoning_effort` 档位各自的好处。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 推理模型(reasoning model) | 用强化学习训练过、回答前会先生成长推理过程的模型,如 DeepSeek 思考模式、OpenAI o 系列和 GPT-5 以后的推理、Claude 的思考 |
| 思维链(Chain-of-Thought, CoT) | 让模型先写出中间推理步骤再给答案,最早是提示技巧,后来成了推理模型的训练目标 |
| RLVR | 可验证奖励的强化学习,用能被程序判对错的题目训练模型推理,DeepSeek-R1 的核心方法 |
| test-time compute | 推理时计算,在回答时多花算力(想得更久、答多次再挑)来换效果,和训练时加大模型相对 |
| reasoning_effort / effort | 控制思考强度的档位参数,各家取值不同,是行为信号而不是严格上限 |
| thinking_budget | 通义的思考 token 上限,到了就立刻开始写答案 |
| 自适应思考(adaptive thinking) | Claude 新模型的模式,模型自己决定想不想、想多少,由 effort 引导 |
| 交错思考(interleaved thinking) | 在两次工具调用之间也能思考,每拿到工具结果先想再决定下一步 |
| 自洽投票(self-consistency) | 同一问题高温采样多次,按最终答案投票 |
| best-of-N | 生成 N 个候选,用验证器打分选最好的 |
| 验证器(verifier) | 判断答案好坏的东西,可以是规则、测试、另一个模型或奖励模型 |
| 思维树(ToT) | 把推理拆成多步,每步展开多个候选并评估剪枝,在步骤上做搜索 |
| LATS | 把蒙特卡洛树搜索用在 Agent 上,节点是执行动作后的真实环境状态 |
| 首 token 延迟(TTFT) | 从发出请求到第一个正文 token 出现的时间,开思考时会明显变长 |

## 常见误区

**默认把思考开到最大。** 我们的基础题上,max 和关闭准确率一样,花费是 3.6 倍;难题上 low 就到顶了。档位要在自己的评测集上从低往高试。

**以为思考 token 不要钱,或者只算正文。** 四家都按输出 token 计费,OpenAI 的思考内容你甚至看不到,账单上照样有。估算成本时用响应里的 `completion_tokens`(或 `reasoning_tokens`),别只数正文字数。

**用思考模式代替工具。** 计费金额、日期差、汇总求和,能用代码精确算的,让模型调工具或者写代码算。思考能把正确率从 96% 拉到 100%,工具一开始就是 100%,还更便宜。

**只看总耗时,不看首 token 延迟。** 后台任务看总耗时就够了,聊天界面要看首 token。开思考时首个正文 token 可能晚 4 到 8 秒,这是用户最能感知的部分。

**以为开了思考就不会犯规则类错误。** 思考降低了漏规则的概率,但不是零。我们的实验每档只跑了 24 次,24 次全对不代表第 1000 次也对。重要的金额计算仍然要有程序校验和人工审批(Day 40)。

**在 Agent 循环里丢了思考内容。** DeepSeek 带工具时不回传 `reasoning_content` 会直接 400;Claude 的 thinking 块被改动会校验失败。自己拼 messages 时用 SDK 返回的完整消息,不要只取 `content`。

**跨厂商复用同一个档位名就以为效果一样。** DeepSeek 把 `medium` 映射成 `high`;Claude 的 `medium` 在不同模型上是不同的默认值;OpenAI 有的模型不支持 `none`。换厂商要重新跑一遍 sweep。

## 学习资料

### 文档与文章

- [DeepSeek · 思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode):开关、`reasoning_effort` 的取值和映射、带工具时回传 `reasoning_content` 的规则。**必看**,10 分钟。
- [Claude · Effort](https://platform.claude.com/docs/en/build-with-claude/effort):五个档位、各模型的推荐起点、effort 和 thinking 的关系、对话中途改强度。看「How effort works」和你用的模型那一节。
- [OpenAI · Reasoning models](https://developers.openai.com/api/docs/guides/reasoning):`reasoning.effort` 的取值、推理 token 计费和 `reasoning_tokens` 字段。
- [阿里云百炼 · 深度思考](https://help.aliyun.com/zh/model-studio/deep-thinking):`enable_thinking`、`thinking_budget`、计费规则和只支持流式的模型。
- [DeepSeek · 模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):算成本前核对当前单价。
- [DeepSeek-R1 论文](https://arxiv.org/abs/2501.12948):看第 2 节的训练方法和「aha moment」那段,半小时,了解推理模型是怎么训出来的。
- [Self-Consistency 论文](https://arxiv.org/abs/2203.11171):看第 2 节方法图就够。
- [Tree of Thoughts 论文](https://arxiv.org/abs/2305.10601):看 24 点那个例子和搜索算法的伪代码。
- [LATS 论文](https://arxiv.org/abs/2310.04406):看方法总图,理解它和思维树的区别是「有真实环境反馈」。
- [Let's Verify Step by Step](https://arxiv.org/abs/2305.20050):OpenAI 关于逐步验证和结果验证的对比,看摘要和主图。
- [Scaling LLM Test-Time Compute Optimally](https://arxiv.org/abs/2408.03314):推理时计算和加大模型的取舍,看摘要和第一张图。
- [Lilian Weng · Why We Think](https://lilianweng.github.io/posts/2025-05-01-thinking/):2025 年 5 月的长综述,把思维链、并行采样、序列修正、RL 训练串成一张图,两小时,适合想系统了解的同学。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1aiADewEBC&p=18&autoplay=0&high_quality=1" title="【已授权】李宏毅2025《机器学习》" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>啥都会一点的研究生 · 【已授权】李宏毅2025《机器学习》 · 第 18 P「DeepSeek-R1 这类大型语言模型是如何进行深度思考的」(78 分钟)讲推理模型的几种做法;接着看第 19 P「推理过程不用太长、够用就好」(24 分钟),正好对应今天「档位不是越高越好」的结论。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1cV93YGEoy&autoplay=0&high_quality=1" title="万字科普DeepSeek R1底层原理,DeepSeek是从0到1的创新吗?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>新石器公园 · 万字科普DeepSeek R1底层原理,DeepSeek是从0到1的创新吗? · 27 分钟的科普,讲 R1 的强化学习训练和它为什么会「想」,适合先建立直觉。</figcaption>
</figure>

思维树的论文讲解看 ranchlai 的 [10分钟理解Tree of Thoughts思维树](https://www.bilibili.com/video/BV1Gz4y1p7Du/),15 分钟,配合上面的伪代码看;自洽投票的论文讲解可以看 B 站 mardinff 的 [SELF-CONSISTENCY IMPROVES CHAIN OF THOUGHT REASONING IN LANGUAGE MODELS](https://www.bilibili.com/video/BV1aP411b7V3/),12 分钟。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/xCRvOUykOX0" title="How do thinking and reasoning models work?" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Google for Developers · How do thinking and reasoning models work? · 短的官方讲解,讲思考模型的原理和什么时候用。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/MG9oqntiJKg" title="AI Won't Plateau — if We Give It Time To Think" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>TED · Noam Brown · AI Won't Plateau — if We Give It Time To Think · o1 的核心研究者之一讲「让模型多想一会儿」这个想法从扑克 AI 到大模型的来历,十几分钟,讲 test-time compute 最好的入门。</figcaption>
</figure>

Karpathy 的 [Deep Dive into LLMs like ChatGPT](https://www.youtube.com/watch?v=7xTGNNLPyMI) 后半部分讲强化学习和 DeepSeek-R1,如果前面课程里没看完,今天可以补上那一段。

### 书籍

- Sebastian Raschka《Build a Reasoning Model (From Scratch)》(Manning, 2026):从一个基础模型开始,依次实现评测、思维链和自洽投票这类不改权重的推理增强,再到 RLVR、GRPO 和蒸馏。和今天最相关的是讲推理时增强的那几章,想理解训练那一半就接着读后面的章节。
- Chip Huyen《AI Engineering》(O'Reilly, 2025),第 2 章讲采样的部分,其中有 test-time compute 一节,讲多次采样再挑选的各种做法。

### 开源项目与代码

- [rasbt/reasoning-from-scratch](https://github.com/rasbt/reasoning-from-scratch):上面那本书的配套代码,有自洽投票、验证器和 GRPO 的实现。
- [princeton-nlp/tree-of-thought-llm](https://github.com/princeton-nlp/tree-of-thought-llm):思维树官方实现,看 `src/tot/methods/bfs.py`,一百来行就是那个搜索循环。
- [lapisrocks/LanguageAgentTreeSearch](https://github.com/lapisrocks/LanguageAgentTreeSearch):LATS 官方代码,有 HotpotQA 和编程任务的例子。

## 自测

1. 用三句话解释推理模型是怎么训练出来的,以及「test-time compute」是什么意思。

<details><summary>答案</summary>

拿大量能被程序判对错的题(数学、代码),让模型先生成推理过程再答题,答对给奖励,用强化学习反复训练(RLVR),模型就学会了在回答前长时间推理、自我检查和回退。test-time compute 指在推理阶段多花算力换效果,比如让模型想得更久,或者答多次再挑,和在训练阶段换更大的模型相对。

</details>

2. 在 DeepSeek 上,怎么关闭思考?怎么把思考强度调到最低?带工具调用时有什么额外要求?

<details><summary>答案</summary>

关闭:`extra_body={"thinking": {"type": "disabled"}}`(默认是开启的)。调强度:打开思考后传 `reasoning_effort="low"`(取值 low / high / max,medium 会映射成 high)。带 tools 时,历史每一轮 assistant 消息的 `reasoning_content` 都要原样回传,否则返回 400。

</details>

3. 一次请求输入 800 token,关思考输出 300 token,开思考输出 1,500 token。按输入每百万 2 元、输出每百万 8 元,两种各多少钱?一天 5 万次请求,差多少?

<details><summary>答案</summary>

关思考:800 × 2 + 300 × 8 = 4,000,除以一百万是 0.004 元。开思考:800 × 2 + 1,500 × 8 = 13,600,约 0.0136 元。每次差 0.0096 元,一天 5 万次差 480 元。

</details>

4. 自洽投票为什么能提高准确率?它在什么样的任务上用不了?

<details><summary>答案</summary>

正确答案可以从多条不同的推理路径得到,错误答案往往各错各的、比较分散,所以多次采样后正确答案更可能得票最多。它要求答案可以直接比较是否相同(数字、选项、类别);开放式长文本(写一段客服回复)没法直接投票,得额外让模型判断语义是否相同,成本和误差都会上升。

</details>

5. (面试题)你们的客服 Agent 要计算升级差价和退款金额,产品经理建议「全部换成推理模型、开最高档,保证算对」。你怎么回应?

<details><summary>答案</summary>

要点:①能用公式算的金额,应该给 Agent 一个计费计算工具(或让它写代码算),准确率接近 100%,比任何思考档位都便宜可靠;②思考模式按输出计费,高档位成本是关闭时的几倍,首 token 延迟多几秒,对聊天体验影响大;③用评测数据说话:建一套带标准答案的计费题,跑关闭、low、high、max 几档,看准确率在哪档到顶,我们的实测是 low 就到顶;④真正复杂、工具覆盖不到的情况,用难度路由只给难题开思考;⑤退款这种写操作不管模型多准,都要有程序校验和人工审批兜底。

</details>

6. 思维树和 LATS 的核心区别是什么?为什么它们很少直接放在线上请求的路径上?

<details><summary>答案</summary>

思维树在模型自己的推理步骤上搜索,评估靠模型或规则判断「这个想法有没有前途」;LATS 的节点是执行了真实动作之后的环境状态,有真实的观察反馈,还会在失败时写反思。两者的调用次数都是深度乘束宽乘展开数的量级,成本和延迟比单次调用高一到两个数量级,所以通常用在离线评测、生成训练数据或者高价值的离线任务里,很少放在要求秒级响应的线上请求里。

</details>

## 明天预告

专题篇可以跳着读,按顺序的下一篇是 **Day 135 · 用 Coding Agent 干活:AGENTS.md、hooks、无人值守与规格驱动开发**。今天讲的是怎么调模型想多少,明天换个角度,讲你自己作为工程师怎么用 Claude Code、Codex 这类 coding agent 干活:仓库里的指令文件怎么写、hooks 和权限怎么配、怎么让它在 CI 里无人值守地跑,以及怎么验收它写的代码。
