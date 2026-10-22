---
title: 'Day 32 · LLM-as-judge:写评分 prompt、与人工对齐、偏差校准'
description: '代码断言查不了「回复有没有讲清楚政策」「有没有编造」。今天写一个只判一件事、只给 pass/fail 的 LLM 评分器,用你的人工标注去校准它:算 TPR、TNR 和 Cohen kappa,而不是只看准确率;再用这两个数修正评分器报出来的通过率,最后过一遍位置、冗长、自我偏好这些偏差。'
pubDate: 2026-10-12
regime: none
tags: ['eval', 'llm-as-judge', 'calibration', 'agent-60']
series: 'agent-60'
day: 32
lang: 'zh'
---

## 今天要解决的问题

昨天的测试集里有一个字段一直没人检查:`facts`。比如 C023(企业版年付想退)那条用例,我们要求回复里讲清楚「按剩余整月退款」「当月和已使用的月份不退」「需要主管审批」。这三件事,Agent 可能换着各种说法讲,也可能漏讲一条,还可能讲错(比如说成「按剩余天数退」)。`if "按剩余整月" in reply` 显然不行。

这时候就轮到金字塔的第二层:让另一个大模型来判。这个做法叫 LLM-as-judge。它很好用,也很容易用错。最常见的错法是:写一个「请给这条回复的质量打 1–10 分」的 prompt,跑出平均 7.8 分,然后就相信了。这个 7.8 分和你的产品质量之间是什么关系,没人知道。

今天的目标是做一个**你有理由相信的**评分器。学完你应该能:

1. 说出什么时候该用 LLM 评分器,什么时候不该用。
2. 写一个只判一个失败模式、输出 pass/fail 加理由的评分 prompt。
3. 准备一份人工标注的对齐数据,分成三份用于写 prompt、调 prompt 和最终验收。
4. 算评分器的 TPR、TNR 和 Cohen kappa,解释为什么不能只看准确率。
5. 用 TPR、TNR 修正评分器报出的通过率。
6. 说出评分器的几种常见偏差和对应的缓解办法。

预计用时 5 小时,其中一个多小时是标注。前置:Day 30 的 trace 和标注;Day 31 的测试集和 `facts` 字段;Day 6 的结构化输出。

## 什么时候需要 LLM 评分器

先泼一盆冷水:能用代码判断的,别用模型判。代码断言免费、确定、毫秒级,模型评分器每次调用都要花钱、有随机性、自己还会错。Day 30 我们说过,规格问题直接改 prompt,不需要评测;到了今天,剩下那些泛化问题里,能写成代码断言的也已经在 Day 31 写成断言了。

真正需要模型来判的,是「理解语义才能判断」的东西。对我们的工单 Agent,我会挑这三个:

- **要点覆盖**(facts):回复是否准确传达了用例里列出的每一条要点,并且没有说出和它们矛盾的话。
- **有依据**(grounded):回复里的每个事实性说法(金额、期限、流程),是否都能在知识库检索结果或工具返回里找到依据。这一条专门抓编造。
- **全部回答**(complete):工单里如果问了多件事,是否每一件都回应了。这是 Day 30 示例里最大的失败类别。

注意每个评分器只判一件事。我见过有人写一个评分 prompt 同时检查准确性、完整性、语气、格式、安全,最后输出一个总分。这种评分器几乎没法校准:它说 fail 了,你都不知道是哪一项 fail。一个评分器对应一个失败模式,出了问题一眼就知道是哪个。

今天我们完整做第一个(要点覆盖),另外两个你照着写。

## 评分 prompt 怎么写

先看完整的 prompt,再逐段解释。

```python
# agent-60-lab/w5/judge.py
"""LLM 评分器:要点覆盖(facts)。只判一件事,只给 pass/fail。"""
from __future__ import annotations

import json
import os
from typing import Literal

from dotenv import load_dotenv
from openai import OpenAI
from pydantic import BaseModel, ValidationError

load_dotenv()
# 评分器单独一组环境变量,方便用和被测 Agent 不同家的模型
client = OpenAI(base_url=os.environ.get("JUDGE_BASE_URL", os.environ["LLM_BASE_URL"]),
                api_key=os.environ.get("JUDGE_API_KEY", os.environ["LLM_API_KEY"]))
JUDGE_MODEL = os.environ.get("JUDGE_MODEL", os.environ["LLM_MODEL"])
JUDGE_VERSION = "facts-v3"   # 改了 prompt 就改版本号,报告里记下来

FACTS_PROMPT = """你是云簿 CloudLedger 客服质检员。你只检查一件事:客服回复是否准确传达了下面列出的每一条要点。

## 判定标准
pass:每一条要点都在回复中被表达出来(换说法可以),且回复中没有任何与要点矛盾的说法。
fail:至少一条要点没有表达,或者被说错,或者回复中有与要点矛盾的说法。
unknown:回复为空、或者信息不足以判断(比如回复只说「已转人工处理」)。

不要评价语气、格式、长度,也不要因为回复多说了要点之外的内容而判 fail,除非多说的内容和要点矛盾。

## 例子
<example>
要点:["按剩余整月退款", "当月不退", "需要主管审批"]
回复:您好,年付套餐中途取消的话,我们会按剩下的整月数给您退款,本月就不退了。我已经帮您提交了退款申请,主管审核通过后 3 个工作日内原路退回。
判定:{{"critique": "三条都表达了:剩下的整月数、本月不退、主管审核。", "verdict": "pass"}}
</example>
<example>
要点:["按剩余整月退款", "当月不退", "需要主管审批"]
回复:您好,已为您办理退款,剩余费用会按天数折算退回到您的账户。
判定:{{"critique": "说成了按天数折算,与「按剩余整月」矛盾;没提当月不退;说「已办理」暗示无需审批,与要点矛盾。", "verdict": "fail"}}
</example>
<example>
要点:["查询后未发现重复扣款", "不需要退款"]
回复:您好,我们核对了您最近的账单,10 月只有一笔 98 元的扣款,没有重复扣费的情况。如果您在银行流水里看到两笔,可能有一笔是预授权,通常几天内会自动撤销。
判定:{{"critique": "说明了没有重复扣款;虽然没直接写「不需要退款」,但「没有重复扣费」已经传达了这层意思,且没有提交退款的说法。", "verdict": "pass"}}
</example>

## 待判定
<facts>{facts}</facts>
<ticket>{ticket}</ticket>
<reply>{reply}</reply>

先写 critique(一两句,指出每条要点是否被表达),再给 verdict。只输出 JSON:{{"critique": "...", "verdict": "pass|fail|unknown"}}"""


class Verdict(BaseModel):
    critique: str
    verdict: Literal["pass", "fail", "unknown"]


def judge_facts(ticket: str, reply: str, facts: list[str], retries: int = 2) -> Verdict:
    if not facts:
        return Verdict(critique="没有要点需要检查", verdict="pass")
    prompt = FACTS_PROMPT.format(facts=json.dumps(facts, ensure_ascii=False),
                                 ticket=ticket, reply=reply or "(空)")
    last_err = ""
    for _ in range(retries + 1):
        resp = client.chat.completions.create(
            model=JUDGE_MODEL, temperature=0,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}])
        try:
            return Verdict.model_validate_json(resp.choices[0].message.content)
        except ValidationError as e:
            last_err = str(e)
    return Verdict(critique=f"评分器输出无法解析: {last_err[:200]}", verdict="unknown")
```

<div class="line-notes">

- `"""LLM 评分器:要点覆盖(facts)。只判一件事,只给 pass/fail。"""` 一个评分器只负责一个标准。要查「有没有回答全部问题」,就再写一个 `judge_complete`,不要往这个 prompt 里塞。
- `from pydantic import BaseModel, ValidationError` 模型返回的 JSON 用 pydantic 校验,不合格就重试。
- `client = OpenAI(base_url=os.environ.get("JUDGE_BASE_URL", os.environ["LLM_BASE_URL"]),` `os.environ.get("JUDGE_BASE_URL", 默认值)`:设置了 `JUDGE_*` 就用评分器专用的模型,没设置就退回被测 Agent 用的那个。我实测时没设,所以评分器和 Agent 都是 `deepseek-flash`,也就是后面「偏差」一节提醒要避免的自我偏好情况。
- `JUDGE_MODEL = os.environ.get("JUDGE_MODEL", os.environ["LLM_MODEL"])` 实测值是 `deepseek-flash`。
- `JUDGE_VERSION = "facts-v3"` 版本号要随 prompt 一起改。align 的输出第一行会打印 `facts-v3 · deepseek-flash · split=dev`,三周后你还能说清楚那个分数是哪一版评分器给的。
- `FACTS_PROMPT = """你是云簿 CloudLedger 客服质检员。` 整个 prompt 是一个 `str.format` 模板,约 1020 个字符,填入一条要点、一句工单、一句回复后,实测输入是 581 token。
- `pass:每一条要点都在回复中被表达出来(换说法可以),` 「换说法可以」很重要。不写的话,评分器会要求回复逐字出现要点。
- `unknown:回复为空、或者信息不足以判断` 实测传入空回复(下面会被换成「(空)」),评分器返回 `unknown`,理由是「回复为空,没有任何内容,无法判断是否表达了『按剩余整月退款』这一要点」。
- `不要评价语气、格式、长度,` 明确划出不判的范围。
- `判定:{{"critique": "三条都表达了:剩下的整月数、本月不退、主管审核。", "verdict": "pass"}}` 例子里的花括号写成双层。`str.format` 会把 `{{` 还原成 `{`,单个 `{` 则会被当成占位符。实测 `"{a}{{x}}{\"critique\"}".format(a=1)` 报的正是 `KeyError: '"critique"'`。
- `<facts>{facts}</facts>` 三个真正的占位符。用 XML 风格的标签把各段内容框起来,模型分得清哪段是要点、哪段是回复,回复里出现「判定:」之类的字样也不会搞混。
- `先写 critique(一两句,指出每条要点是否被表达),再给 verdict。` 实测模型输出的 JSON 也是 critique 在前、verdict 在后,比如 `{"critique": "要点「月付不支持中途退款」已在回复中表达为「月付，中途取消不退」……无矛盾说法。", "verdict": "pass"}`。
- `class Verdict(BaseModel):` 评分结果的结构。
- `verdict: Literal["pass", "fail", "unknown"]` 模型写成 `"PASS"` 或 `"通过"` 都会校验失败,进而触发重试。
- `def judge_facts(ticket: str, reply: str, facts: list[str], retries: int = 2) -> Verdict:` 默认最多调 3 次:第一次加两次重试。
- `if not facts:` 用例没写要点,就没什么可判的,直接 pass,也不花这次调用的钱。实测返回 `critique='没有要点需要检查' verdict='pass'`。
- `prompt = FACTS_PROMPT.format(facts=json.dumps(facts, ensure_ascii=False),` 要点用 JSON 数组的格式填进去,实测是 `["按剩余整月退款", "当月不退", "需要主管审批"]`,每一条的边界很清楚。
- `ticket=ticket, reply=reply or "(空)")` 空回复换成「(空)」,模型才看得出来是空的,而不是 prompt 被截断了。
- `last_err = ""` 记下最后一次解析失败的原因,三次都失败时放进 critique 里。
- `for _ in range(retries + 1):` `_` 表示循环变量用不到。
- `model=JUDGE_MODEL, temperature=0,` 温度 0,同一条输入尽量得到同一个结论。注意是「尽量」:温度 0 也不保证每次输出逐字相同,所以对齐时看的是一批样本上的比例,不要看单次结果。
- `return Verdict.model_validate_json(resp.choices[0].message.content)` 直接从 JSON 字符串构造并校验。实测正文的三种情况各判一次:「整月 + 本月不退 + 主管审核」→ pass,用时 0.7 秒;「按天数折算 + 已办理」→ fail,理由列出了三处矛盾,用时 1.1 秒;空回复 → unknown,用时 0.5 秒。
- `except ValidationError as e:` 只捕获校验失败。网络错误不在这里处理,让它往外抛,评测脚本自己会记成 error。
- `return Verdict(critique=f"评分器输出无法解析: {last_err[:200]}", verdict="unknown")` 三次都失败就算 unknown,不让一条坏输出拖垮整批评测。`[:200]` 截短,pydantic 的报错可能很长。

</div>

只判一件事,并且明说不判什么。 「不要评价语气、格式、长度」这一句很重要。模型天然喜欢顺手挑点毛病,不明说的话,它会因为「回复有点长」判 fail。

二元判断加一个 unknown。 pass/fail 的理由和 Day 30 标注时一样:1–10 分的边界说不清,模型打分时也会集中在 7、8 分,区分度很差。unknown 这个选项是 Anthropic 那篇评测文章里建议的:给评分器一个「我判断不了」的出口,能减少它在信息不足时硬编一个结论。unknown 单独计数,不算 pass 也不算 fail,数量多了说明你的数据或 prompt 有问题。

先写理由,再给结论。 JSON 里 `critique` 排在 `verdict` 前面。模型是按顺序一个 token 一个 token 生成的,先写理由等于让它先思考再下结论;反过来,先给结论再补理由,理由就成了为结论找借口。另一个好处是,评分器判错时你能看到它是怎么想的,方便改 prompt。

few-shot 例子要包含难的情况。 三个例子里,第一个是标准的 pass,第二个是明显的 fail,第三个最重要:回复没逐字说出要点,但意思传达到了,应该判 pass。这种边界例子才是 few-shot 真正的价值所在。光给几个一眼就能看出对错的例子,对评分器帮助不大。这些例子从哪来?从你的人工标注里挑,下面会讲。

温度设 0,输出用 JSON 模式,解析失败就重试。 都是 Day 6 学过的东西。重试几次还失败就返回 unknown,不让一条坏输出拖垮整批评测。顺便提醒一个我第一次写就踩了的坑:prompt 是用 `str.format` 填空的,所以例子里 JSON 的花括号必须写成 `{{` 和 `}}`,不然运行时直接 `KeyError: '"critique"'`,报错信息还挺让人摸不着头脑。

评分器和被测 Agent 尽量用不同家的模型。 环境变量 `JUDGE_*` 单独一组就是为这个。原因在后面的偏差部分讲。

## 对齐:你凭什么相信这个评分器

prompt 写好了,接下来是今天的重点。一个没校准过的评分器,和一个随手写的单元测试差不多,它说过了,你不知道是真过了还是测试本身写错了。校准的方法是:拿你人工标注过的数据,让评分器也判一遍,看它和你的判断有多一致。

### 准备对齐数据

Day 30 你标过一遍 pass/fail,但那是对整条 trace 的总体判断。现在要针对「要点覆盖」这一个标准再标一遍。做法:

1. 从 Day 30 的 trace 里挑 60 条有退款或政策解释的(这些最容易出现要点问题)。
2. 给每条补上 `facts`(可以从 Day 31 的同类用例里拿)。
3. 你自己按评分 prompt 里的同一套标准,判 pass/fail,写一句理由。

一定要保证 fail 的数量不能太少。如果 60 条里只有 3 条 fail,你根本没法衡量评分器抓 fail 的能力。fail 太少就去 trace 里专门找一些,或者手动改坏几条回复(把「整月」改成「天数」、删掉审批那句),做出一些 fail 样本。我会让 fail 占到三分之一左右。

然后把这 60 条分成三份,这是 Hamel 推荐的做法,和机器学习的训练、验证、测试划分一个道理:

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="对齐数据划分为三份:few-shot 来源、调 prompt 用的开发集、最终验收用的测试集">
<rect x="0" y="0" width="640" height="200" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="30" fill="var(--ink-soft)">60 条人工标注(约 1/3 fail)</text>
<rect x="20" y="44" width="120" height="44" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="80" y="64" fill="var(--ink)" text-anchor="middle">train 12</text>
<text x="80" y="80" fill="var(--ink-soft)" text-anchor="middle" font-size="11">挑 few-shot</text>
<rect x="140" y="44" width="240" height="44" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="260" y="64" fill="var(--ink)" text-anchor="middle">dev 24</text>
<text x="260" y="80" fill="var(--ink-soft)" text-anchor="middle" font-size="11">反复跑、看错例、改 prompt</text>
<rect x="380" y="44" width="240" height="44" fill="none" stroke="var(--ink-soft)"/>
<text x="500" y="64" fill="var(--ink)" text-anchor="middle">test 24</text>
<text x="500" y="80" fill="var(--ink-soft)" text-anchor="middle" font-size="11">定稿后只跑一次</text>
<text x="20" y="124" fill="var(--ink)">循环:改 prompt → 跑 dev → 看 TPR/TNR → 读判错的样本 → 再改</text>
<text x="20" y="148" fill="var(--ink)">dev 上 TPR、TNR 都过线后,跑一次 test,报告 test 上的数</text>
<text x="20" y="176" fill="var(--ink-faint)" font-size="11">few-shot 例子只能从 train 里挑,否则 dev/test 上的分数会虚高</text>
</g>
</svg>
<figcaption>对齐数据三分法。最容易犯的错是从 dev 或 test 里挑 few-shot 例子,评分器等于提前看过答案。</figcaption>
</figure>

### 不能只看准确率

假设你的 60 条里 40 条 pass、20 条 fail,评分器判完之后,对照你的标注得到这样一张表(混淆矩阵):

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="评分器与人工标注的混淆矩阵示例">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="250" y="28" fill="var(--ink-soft)" text-anchor="middle">评分器说 pass</text>
<text x="390" y="28" fill="var(--ink-soft)" text-anchor="middle">评分器说 fail</text>
<text x="100" y="74" fill="var(--ink-soft)" text-anchor="end">人说 pass</text>
<text x="100" y="144" fill="var(--ink-soft)" text-anchor="end">人说 fail</text>
<rect x="180" y="44" width="140" height="56" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="250" y="70" fill="var(--ink)" text-anchor="middle">TP 37</text>
<text x="250" y="88" fill="var(--ink-soft)" text-anchor="middle" font-size="11">都说 pass</text>
<rect x="320" y="44" width="140" height="56" fill="none" stroke="var(--rule)"/>
<text x="390" y="70" fill="var(--ink)" text-anchor="middle">FN 3</text>
<text x="390" y="88" fill="var(--ink-soft)" text-anchor="middle" font-size="11">冤枉了好回复</text>
<rect x="180" y="114" width="140" height="56" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="250" y="140" fill="var(--ink)" text-anchor="middle">FP 5</text>
<text x="250" y="158" fill="var(--ink-soft)" text-anchor="middle" font-size="11">放过了坏回复</text>
<rect x="320" y="114" width="140" height="56" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="390" y="140" fill="var(--ink)" text-anchor="middle">TN 15</text>
<text x="390" y="158" fill="var(--ink-soft)" text-anchor="middle" font-size="11">都说 fail</text>
<text x="480" y="74" fill="var(--ink)">TPR = 37/40 = 0.925</text>
<text x="480" y="144" fill="var(--ink)">TNR = 15/20 = 0.75</text>
<text x="180" y="200" fill="var(--ink-soft)">准确率 = (37+15)/60 = 0.867 · kappa ≈ 0.69</text>
</g>
</svg>
<figcaption>示例数字。准确率 87% 看着不错,但 TNR 只有 0.75:人判 fail 的 20 条里,评分器放过了 5 条。</figcaption>
</figure>

准确率 86.7%,听起来还行。但看 TNR(true negative rate,真负率):人判为 fail 的 20 条里,评分器只抓到 15 条,放过了四分之一。评测里我们最关心的恰恰是抓 fail 的能力。

准确率的问题在于它会被类别比例骗。极端一点:如果 60 条里 54 条 pass、6 条 fail,一个永远说 pass 的「评分器」准确率高达 90%,而它一条 fail 都抓不到。所以要分开看两个数:

- TPR(true positive rate,真正率):人判 pass 的里面,评分器也判 pass 的比例。低了说明评分器太严,会冤枉好回复。
- TNR(true negative rate,真负率):人判 fail 的里面,评分器也判 fail 的比例。低了说明评分器太松,会放过坏回复。

我的经验目标是两个都在 0.9 以上。上面的例子 TPR 达标,TNR 不达标,下一步就是去读那 5 条被放过的,看评分器为什么觉得它们没问题,然后改 prompt(加一条针对性的 few-shot,或者把判定标准写得更明确)。

另一个常用指标是 Cohen's kappa,它衡量的是「扣除碰巧一致之后的一致程度」。上面这个例子:

- 观察一致率 po = 52/60 ≈ 0.867
- 碰巧一致率 pe = P(人 pass)×P(评分器 pass) + P(人 fail)×P(评分器 fail) = (40/60)×(42/60) + (20/60)×(18/60) ≈ 0.467 + 0.100 = 0.567
- kappa = (po − pe) / (1 − pe) = (0.867 − 0.567) / 0.433 ≈ 0.69

kappa 一般认为 0.6–0.8 是较好的一致,0.8 以上是很好。顺便提一下,你也可以找一位同事按同一标准独立标这 60 条,算你们两人之间的 kappa。如果人和人之间都只有 0.6,说明标准本身写得不清楚,这时候怪评分器没用,先把标准改清楚。

### 对齐脚本

```python
# agent-60-lab/w5/align.py
"""评分器对齐。用法: uv run python -m w5.align w5/cases/align_facts.jsonl dev
align_facts.jsonl 每行: {"id","ticket","reply","facts","human":"pass|fail","split":"train|dev|test"}"""
from __future__ import annotations

import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from w5.judge import JUDGE_MODEL, JUDGE_VERSION, judge_facts


def metrics(pairs: list[tuple[str, str]]) -> dict:
    tp = sum(h == "pass" and j == "pass" for h, j in pairs)
    fn = sum(h == "pass" and j == "fail" for h, j in pairs)
    fp = sum(h == "fail" and j == "pass" for h, j in pairs)
    tn = sum(h == "fail" and j == "fail" for h, j in pairs)
    n = tp + fn + fp + tn
    tpr = tp / (tp + fn) if tp + fn else float("nan")
    tnr = tn / (tn + fp) if tn + fp else float("nan")
    po = (tp + tn) / n
    pe = ((tp + fn) / n) * ((tp + fp) / n) + ((fp + tn) / n) * ((fn + tn) / n)
    kappa = (po - pe) / (1 - pe) if pe < 1 else float("nan")
    return {"n": n, "tp": tp, "fn": fn, "fp": fp, "tn": tn,
            "tpr": tpr, "tnr": tnr, "acc": po, "kappa": kappa}


def main() -> None:
    path, split = Path(sys.argv[1]), sys.argv[2]
    rows = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
    rows = [r for r in rows if r["split"] == split]

    with ThreadPoolExecutor(max_workers=4) as pool:
        verdicts = list(pool.map(lambda r: judge_facts(r["ticket"], r["reply"], r["facts"]), rows))

    pairs, unknown = [], 0
    for r, v in zip(rows, verdicts):
        if v.verdict == "unknown":
            unknown += 1
            continue
        pairs.append((r["human"], v.verdict))
        if r["human"] != v.verdict:
            print(f"\n[{r['id']}] 人:{r['human']}  评分器:{v.verdict}\n  回复: {r['reply'][:120]}\n  理由: {v.critique}")

    m = metrics(pairs)
    print(f"\n{JUDGE_VERSION} · {JUDGE_MODEL} · split={split} · unknown={unknown}")
    print(f"TP {m['tp']}  FN {m['fn']}  FP {m['fp']}  TN {m['tn']}")
    print(f"TPR {m['tpr']:.3f}  TNR {m['tnr']:.3f}  准确率 {m['acc']:.3f}  kappa {m['kappa']:.3f}")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `"""评分器对齐。用法:` 输入文件每行要有 id、ticket、reply、facts、你的判断 human,以及 split。我实测用了 7 条,其中 6 条 dev:4 条回复来自前面真实跑出来的 trace,另外 2 条是按正文建议「手动改坏」的,比如把「月付套餐不支持中途退款」改成「可以按天数退款」。
- `from w5.judge import JUDGE_MODEL, JUDGE_VERSION, judge_facts` 直接复用评分器。对齐测的就是你要真正拿去用的那一个。
- `def metrics(pairs: list[tuple[str, str]]) -> dict:` 输入是 `(人的判断, 评分器的判断)` 二元组的列表。
- `tp = sum(h == "pass" and j == "pass" for h, j in pairs)` `h == "pass" and j == "pass"` 是布尔值,`sum` 把 True 当成 1 加起来,就是满足条件的条数。下面三行同理。拿正文混淆矩阵的数字代入:37 对 (pass, pass)、3 对 (pass, fail)、5 对 (fail, pass)、15 对 (fail, fail)。
- `fn = sum(h == "pass" and j == "fail" for h, j in pairs)` 人判 pass、评分器判 fail:冤枉了好回复。代入后 fn = 3。
- `fp = sum(h == "fail" and j == "pass" for h, j in pairs)` 人判 fail、评分器判 pass:放过了坏回复。代入后 fp = 5。
- `tpr = tp / (tp + fn) if tp + fn else float("nan")` 37 / 40 = 0.925。分母为 0 时(没有人判 pass 的样本)返回 `nan`,不会抛 `ZeroDivisionError`。
- `tnr = tn / (tn + fp) if tn + fp else float("nan")` 15 / 20 = 0.75。实测如果数据里一条 fail 都没有,只喂 3 对 (pass, pass),tnr 就是 `nan`。这正好说明 fail 样本太少时,你根本没法评估评分器抓 fail 的能力。
- `po = (tp + tn) / n` 观察到的一致率,也就是准确率:52 / 60 = 0.867。
- `pe = ((tp + fn) / n) * ((tp + fp) / n) + ((fp + tn) / n) * ((fn + tn) / n)` 两边各凭自己的比例瞎猜时,碰巧一致的概率:(40/60)×(42/60) + (20/60)×(18/60) = 0.567。
- `kappa = (po - pe) / (1 - pe) if pe < 1 else float("nan")` (0.867 − 0.567) / 0.433 = 0.692。实测 `metrics` 的输出是 `{'tpr': 0.925, 'tnr': 0.75, 'acc': 0.8667, 'kappa': 0.6923}`,和正文的手算一致。全是 pass 的时候 pe = 1,kappa 返回 `nan`。
- `rows = [r for r in rows if r["split"] == split]` 只跑指定的那一份。调 prompt 时跑 dev,定稿后跑一次 test。实测 7 条里过滤出 6 条 dev。
- `with ThreadPoolExecutor(max_workers=4) as pool:` 评分器调用之间互不依赖,4 个线程并发。
- `verdicts = list(pool.map(lambda r: judge_facts(r["ticket"], r["reply"], r["facts"]), rows))` `pool.map` 按输入顺序返回结果,下面才能用 `zip` 把每条数据和它的结论一一配对。`list(...)` 等所有调用都完成。
- `if v.verdict == "unknown":` unknown 不算进混淆矩阵,单独计数。
- `pairs.append((r["human"], v.verdict))` 把人和评分器的判断配成一对,交给 `metrics`。
- `if r["human"] != v.verdict:` 只打印不一致的样本,而且带上评分器的理由,改 prompt 就靠读这些。实测 6 条全部一致,没有打印任何一条。我改坏的 a03(「月付可以按天数退款」),评分器的理由是:「『月付不支持中途退款』被说错成『月付套餐可以按天数退款』,与要点矛盾,虽然紧接着又说当期费用不退……但前面的说法已经构成矛盾表述」。
- `print(f"\n{JUDGE_VERSION} · {JUDGE_MODEL} · split={split} · unknown={unknown}")` 实测输出 `facts-v3 · deepseek-flash · split=dev · unknown=0`。
- `print(f"TPR {m['tpr']:.3f}  TNR {m['tnr']:.3f}` 实测 `TP 3  FN 0  FP 0  TN 3`,`TPR 1.000  TNR 1.000  准确率 1.000  kappa 1.000`。6 条太少,而且我改坏的地方都很明显,所以全对不说明什么。真要对齐还是得按正文准备 60 条,每份里 fail 约占三分之一。

</div>

它会把每一条评分器和你判断不一致的样本打印出来,连同评分器的理由。改 prompt 的灵感几乎全部来自读这些不一致的样本。有时候你读完会发现是自己标错了,那就改标注,这很正常,标注也会有错。

### 用 TPR 和 TNR 修正通过率

评分器校准完了,TPR 0.95、TNR 0.90,很不错。你拿它去判测试集,它报告说 80% 的回复 pass。那真实的 pass 率是 80% 吗?不完全是,因为评分器自己有误差。

可以修正一下。设真实通过率为 θ,评分器观察到的通过率 p_obs 由两部分组成:真的 pass 被判 pass(θ × TPR),加上真的 fail 被误判成 pass((1 − θ) × (1 − TNR))。解出 θ:

θ = (p_obs + TNR − 1) / (TPR + TNR − 1)

代入 p_obs = 0.80、TPR = 0.95、TNR = 0.90:θ = (0.80 + 0.90 − 1) / (0.95 + 0.90 − 1) = 0.70 / 0.85 ≈ 0.82。

如果换一个 TNR 只有 0.75 的松评分器,同样报 80%:θ = (0.80 + 0.75 − 1) / (0.95 + 0.75 − 1) = 0.55 / 0.70 ≈ 0.79。看起来差别不大,但评分器越松,这个修正量越大;更重要的是,TNR 低意味着它放过的那些 fail 你根本看不见。这个公式在汇报时很有用:「评分器报 80%,按它在留出标注集上的 TPR/TNR 修正后约 82%」,比直接报 80% 严谨得多。注意分母 TPR + TNR − 1 接近 0 时(评分器和瞎猜差不多)公式会失效,这时候该做的是重新写评分器。

## 偏差:评分器会在哪里系统性地出错

研究 LLM-as-judge 的论文已经很多了,最有名的是 2023 年 LMSYS 团队的《Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena》。他们总结的几种偏差到今天依然存在:

位置偏差(position bias)。 让评分器比较两个回复哪个更好时,它倾向于选放在前面(或后面)的那个,和内容无关。缓解:交换顺序各判一次,两次结论一致才算数,不一致记为平局。我们今天的评分器是单条判定,不是两两比较,基本不受影响,但 Day 51 迭代时如果你想比较两个版本的回复,就要注意这个。

冗长偏差(verbosity bias)。 评分器倾向于给更长、看起来更详细的回复更高评价。客服场景特别要小心,因为好的客服回复往往是短的。缓解:在判定标准里明确说「不因长度判定」;few-shot 里放一个短而正确的 pass 例子和一个长而错误的 fail 例子。

自我偏好(self-preference bias)。 评分器倾向于给和自己风格相近的输出更高评价,包括自己生成的输出。如果你的 Agent 和评分器用同一个模型,评分器可能对 Agent 的特定错误「视而不见」,因为它自己也会那样想。缓解:评分器用不同厂商的模型,比如 Agent 用 DeepSeek,评分器用通义千问或 Claude。

宽松偏差(leniency)。 很多模型做评分器时天然偏宽松,倾向于判 pass。这就是为什么 TNR 往往比 TPR 更难提上去。缓解:few-shot 里多放有代表性的 fail;判定标准里把 fail 的条件写得具体。

格式和权威感偏差。 回复里有编号列表、有引用标记、语气笃定,评分器更容易觉得它对。编造政策的回复往往恰恰语气最笃定。缓解:「有依据」评分器要给它看检索结果和工具返回,让它对照证据判断,而不是凭感觉。

这些偏差的共同解法其实就是上一节的对齐:你不需要提前知道评分器有哪种偏差,只要 TPR、TNR 在你的标注集上达标,并且你读过那些判错的样本,偏差就已经被你发现并处理了。反过来,没对齐过的评分器,上面每一条都可能在悄悄影响你的分数。

## 成本

评分器是要花钱的,心里要有数。评分 prompt 加上工单、回复、要点,一次大约 1,500 输入 token、100 输出 token。测试集 70 条 × 每条 3 次 trial × 3 个评分器 = 630 次调用,约 95 万输入 token、6 万输出 token。按国内主流模型 2026 年 10 月每百万输入 token 几元人民币的价格量级,一轮全量评分是几元钱的事。真正要注意的是两个地方:一是别在 CI 里每次提交都跑全量 L2(Day 35 会讲怎么分层触发);二是如果你用 Claude 或 GPT 这类更贵的模型做评分器,成本会高一个数量级,这时候 prompt caching(Day 38)能帮上忙,因为评分 prompt 的前面一大段是不变的。

## 动手练习

1. 准备 `w5/cases/align_facts.jsonl`:60 条,每条有 ticket、reply、facts、你的人工判定 human、split(train 12 / dev 24 / test 24,每份里 fail 都约占三分之一)。
2. 从 train 里挑 3–4 个例子替换 `FACTS_PROMPT` 里的示例,至少一个是「没逐字说但意思到了」的 pass,一个是「说错了」的 fail。
3. 跑 `uv run python -m w5.align w5/cases/align_facts.jsonl dev`,读每一条不一致的样本,改 prompt,改一次 `JUDGE_VERSION` 加一版。直到 dev 上 TPR、TNR 都 ≥ 0.9,或者改了三四版之后不再提升。
4. 定稿后跑一次 test,把 test 上的 TPR、TNR、kappa 记到 `w5/notes.md`,连同评分器版本号和模型名。
5. 如果你能用两家不同的模型,用另一家模型做评分器再跑一次 test,比较两者的 TPR、TNR。
6. 仿照 `judge_facts` 写 `judge_complete`(全部回答)。不用今天就完成它的对齐,但要准备 20 条标注留到 Day 35。
7. 把 `judge_facts` 接进 `run_eval.py`:用例有 `facts` 且回复非空时调用,结果作为一个 grader 记录,unknown 单独统计。

### 验收标准

- `align.py` 在 test 集上输出 TPR、TNR、kappa,TNR 不低于 0.85(达不到也行,但要在笔记里写清楚原因和你的判断)。
- `notes.md` 里有评分器的版本迭代记录:每一版改了什么、dev 上的 TPR/TNR 怎么变。
- `run_eval.py` 的输出里出现 `facts` 这个 grader,并且你能用修正公式算出修正后的通过率。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| LLM-as-judge | 用大模型按给定标准评判另一个模型的输出 |
| 评分器 judge / grader | 这里指基于 LLM 的打分逻辑 |
| critique | 评分器在给出结论前写的判断理由 |
| 对齐 alignment | 用人工标注检验并调整评分器,使其判断与人一致 |
| 混淆矩阵 confusion matrix | TP、FN、FP、TN 四格计数表 |
| TPR 真正率 | 人判 pass 的样本中评分器也判 pass 的比例 |
| TNR 真负率 | 人判 fail 的样本中评分器也判 fail 的比例 |
| Cohen's kappa | 扣除随机一致后的一致性指标,1 为完全一致,0 为与随机无异 |
| 位置偏差 position bias | 两两比较时偏向某个位置的回答 |
| 冗长偏差 verbosity bias | 偏向更长的回答 |
| 自我偏好 self-preference bias | 偏向和自己风格相近或自己生成的回答 |
| 宽松偏差 leniency | 倾向于判 pass |
| few-shot | 在 prompt 里给出的少量示例 |

## 常见误区

**用 1–10 分打分。** 分数集中在 7、8 分,区分度低;「7 分」和「8 分」的差别谁都说不清,没法对齐。用 pass/fail,需要程度时拆成多个二元评分器。

**一个评分器判所有维度。** 判 fail 时不知道是哪一维出问题,对齐也无从下手。一个评分器只判一个失败模式。

**只看准确率。** 类别不平衡时准确率会骗人,永远说 pass 的评分器也能拿高准确率。分开看 TPR 和 TNR,尤其是 TNR。

**few-shot 例子从测试数据里挑。** 评分器提前见过答案,对齐出来的数字虚高。few-shot 只从 train 里挑。

**评分器用和 Agent 同一个模型。** 自我偏好会让它对 Agent 的某些错误视而不见。条件允许就换一家。

**对齐一次就一劳永逸。** 改了评分 prompt、换了评分模型、或者 Agent 的输出风格大变,都要在 test 集上重新跑一次对齐。所以评分器要有版本号,报告里要记。

**拿评分器判能写成代码的东西。** 「回复里有没有 6578 这个数字」「有没有调用退款工具」,用代码判。评分器留给真正需要理解语义的东西。

## 学习资料

### 文档与文章

- [Hamel Husain · Using LLM-as-a-Judge For Evaluation: A Complete Guide](https://hamel.dev/blog/posts/llm-judge/):今天的方法大部分出自这篇:二元判断、先 critique 后结论、和领域专家对齐、迭代 prompt。今天必读,约 1 小时。
- [Eugene Yan · Evaluating the Effectiveness of LLM-Evaluators](https://eugeneyan.com/writing/llm-evaluators/):把 LLM 评分器的研究文献梳理了一遍,哪些场景好用、哪些偏差需要注意,读讲偏差的部分,40 分钟。
- [Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena](https://arxiv.org/abs/2306.05685):位置偏差、冗长偏差、自我偏好这几个概念的出处。读第 3 节,30 分钟。
- [Who Validates the Validators?](https://arxiv.org/abs/2404.12272):Shreya Shankar 等人的论文,讲人在定义评分标准时也会「边看边变」(criteria drift),所以对齐要迭代。读摘要和引言。
- [G-Eval](https://arxiv.org/abs/2303.16634):早期用 LLM 做评估的代表性方法,先生成评估步骤再打分。了解即可,我们没用它的打分方式。
- [Langfuse · LLM-as-a-Judge](https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge):Day 34 接入 Langfuse 后,可以在平台上配置评分器对线上 trace 自动打分,先看看它的设计。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1L14y127ye&autoplay=0&high_quality=1" title="【10分钟论文】使用LLM作为裁判 Judging LLM-as-a-judge with MT-Bench and Chatbot Arena" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>ranchlai · 【10分钟论文】使用LLM作为裁判 Judging LLM-as-a-judge with MT-Bench and Chatbot Arena · 11 分钟,中文讲 MT-Bench 那篇论文,今天偏差部分的出处。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1f13R6JEfP&autoplay=0&high_quality=1" title="【MT-Bench 实测】LLM-as-Judge 的四大偏差:位置/冗长/自我偏好/风格" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>古希腊掌管代码的神 · 【MT-Bench 实测】LLM-as-Judge 的四大偏差:位置/冗长/自我偏好/风格 · 4 分钟,用实测例子演示几种偏差,短,看完对偏差会有直观印象。</figcaption>
</figure>

- 酌沧《怎样设计LLM-as-Judge才能让评分可信》(BV1rAbp66Eyi,7 分钟):讲评分 prompt 的设计要点,可以和今天的 prompt 对照。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/trfUBIDeI1Y" title="LLM as a Judge: Scaling AI Evaluation Strategies" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>IBM Technology · LLM as a Judge: Scaling AI Evaluation Strategies · 6 分钟白板讲解,适合开场建立概念。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/tqUDjc1HzO4" title="How to Automate AI Evals (Correctly)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hamel Husain · How to Automate AI Evals (Correctly) · 27 分钟,讲怎么从人工标注走到自动评分器,包括 TPR/TNR 对齐和修正,和今天的内容几乎一一对应。</figcaption>
</figure>

- Hamel Husain《A Deep Dive on LLM Evaluation》(YouTube ID `IsZVCnViwhk`,49 分钟):更早的一次长讲座,时间多的话看讲评分器的部分。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 3 章「Evaluation Methodology」后半部分「AI as a Judge」:系统讲 AI 评分的原理、局限和使用建议,读完这一节,约 1 小时。
- Shreya Shankar、Hamel Husain《Evals for AI Engineers》(O'Reilly,2026):讲自动评分器的章节是今天的延伸。

### 开源项目与代码

- [langchain-ai/openevals](https://github.com/langchain-ai/openevals):LangChain 开源的一组现成评分器 prompt,看它们怎么写判定标准,但别直接拿来用,通用评分器没有经过你的数据对齐。
- [confident-ai/deepeval](https://github.com/confident-ai/deepeval):里面的 G-Eval 实现和各种现成指标,对比它们和「为你的失败模式定制的二元评分器」有什么不同。
- [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo):支持 `llm-rubric` 断言,用配置文件写评分标准,可以作为 Day 35 做 CI 时的另一种选择。

## 自测

1. 下面这些检查,哪些应该用 LLM 评分器,哪些不该?(a) 回复里是否出现了退款金额 6578 (b) 回复是否讲清楚了「当月不退」 (c) 回复是否回答了工单里的全部问题 (d) 回复是否泄露了其他客户的邮箱

<details><summary>答案</summary>

(a) 不该,字符串包含检查即可。(b) 该,同一个意思有很多说法,也可能被说错,需要理解语义。(c) 该,需要理解工单里有几个问题、回复是否都回应了。(d) 主要用代码:用正则找邮箱,再比对是否属于当前客户;代码判断不了的变体再交给评分器兜底。

</details>

2. 一个评分器在 60 条对齐数据上的准确率是 90%,你能说它很好吗?还需要什么信息?

<details><summary>答案</summary>

不能。需要知道类别比例和 TPR、TNR。如果 60 条里 54 条 pass,永远判 pass 的评分器准确率也是 90%,TNR 却是 0。要看混淆矩阵,分别看 TPR 和 TNR,最好再看 kappa。

</details>

3. 为什么让评分器先写 critique 再给 verdict?

<details><summary>答案</summary>

模型按顺序生成,先写理由相当于先推理再下结论,判断更准确;先给结论再写理由,理由会变成为结论找借口。此外,有理由才能在评分器判错时看出它错在哪,方便改 prompt。

</details>

4. 评分器 TPR = 0.9、TNR = 0.8,它报告测试集通过率 70%。修正后的真实通过率大约是多少?

<details><summary>答案</summary>

θ = (0.70 + 0.80 − 1) / (0.90 + 0.80 − 1) = 0.50 / 0.70 ≈ 0.714,约 71%。

</details>

5. 你的 Agent 用 DeepSeek,评分器也用 DeepSeek,TPR、TNR 都很高。还有什么隐患?

<details><summary>答案</summary>

对齐数据如果来自同一个模型生成的回复,自我偏好的影响可能已经被「对齐」掩盖了:你标 fail 的那些是你看得出的错误,而模型和评分器共有的盲点,你的标注数据里可能没有足够样本暴露。更稳妥的做法是用另一家模型做评分器,或至少用另一家模型在 test 集上交叉验证一次。另外,换 Agent 模型或评分模型后要重新对齐。

</details>

6. (面试题)「你用 LLM 做评估,怎么保证评估结果可靠?」

<details><summary>答案</summary>

要点:评分器只用在代码判断不了的语义问题上,每个评分器只判一个失败模式,输出二元结论加理由,并给出 unknown 选项;用领域专家的人工标注做对齐,数据分成 few-shot 来源、调 prompt 用的开发集和最终验收的测试集,在测试集上报告 TPR、TNR 和 kappa,目标两者都在 0.9 左右;读评分器和人不一致的样本来迭代 prompt;评分器用和被测系统不同厂商的模型,缓解自我偏好;明确处理位置、冗长等偏差;评分器 prompt 和模型有版本号,变更后重新对齐;汇报时可以用 TPR、TNR 修正观察到的通过率。

</details>

## 明天预告

Day 33 · 评估 Agent 的轨迹:工具选对没、步数多不多、任务成没成。到今天为止,我们评的基本都是「最后的结果」:分类、回复、数据库里的退款申请。明天要打开过程看:Agent 调了哪些工具、顺序对不对、参数对不对、有没有绕远路。我们还会写一个「模拟客户」,让 Agent 和它多轮对话,评估那些一轮解决不了的工单。
