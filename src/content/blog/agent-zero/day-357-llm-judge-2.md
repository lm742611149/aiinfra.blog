---
title: 'Day 357 · LLM-as-judge(二):评分 prompt 怎么写'
description: '先让模型给客服回复打 1 到 10 分,亲眼看它把一条违反审批政策的回复打成 9 分;再一步一步改:只判一件事、只给 pass/fail/unknown、写清判定标准和不判什么、放进带边界情况的例子、先写理由再给结论、用 pydantic 校验。最后拼出 part06/llm_judge.py。'
pubDate: 2026-10-22
regime: none
tags: ['eval', 'llm-as-judge', 'prompt', 'agent-zero']
series: 'agent-zero'
day: 357
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 356](/blog/agent-zero/day-356-week51-review/) 是复习日:默写了判题器的退款规则、维度组合和抛硬币模拟,又拼了一个测试集体检脚本,它能用判题器抓出写错的期望值。那天的结论是,能用代码判的都已经用代码判了。

剩下的是 [Day 348](/blog/agent-zero/day-348-testcase-structure/) 用例结构里那个 `facts` 字段。C023 那条用例要求回复讲清楚三件事:按剩余整月退款、当月不退、需要主管审批。Agent 会换着各种说法讲,可能漏一条,也可能讲错。`if "按剩余整月" in reply` 判不了,[Day 355](/blog/agent-zero/day-355-llm-judge-1/) 说过,这种「得理解意思才能判」的东西就交给 LLM 评分器。今天写它的 prompt。

## 今天要解决的问题

学完今天你应该能:

1. 用实跑结果说明为什么不让评分器打 1 到 10 分。
2. 写出一个评分 prompt 的两块核心内容:**判定标准**(pass、fail、unknown 各是什么,以及明确不判什么)和**例子**(至少一个边界情况)。
3. 让评分器先写理由再给结论,输出 JSON,用 pydantic 校验,解析失败就重试,三次都失败返回 unknown。
4. 认出并修好 `str.format` 遇到花括号时报的 `KeyError: '"verdict"'`。

今天只讲两个新概念:判定标准和例子。其余用到的东西都是前面学过的:pydantic 校验([Day 51](/blog/agent-zero/day-051-pydantic-1/))、few-shot([Day 141](/blog/agent-zero/day-141-prompt-3/))、XML 标签分隔([Day 143](/blog/agent-zero/day-143-prompt-5/))、JSON mode([Day 148](/blog/agent-zero/day-148-structured-2/))、校验失败重试([Day 150](/blog/agent-zero/day-150-structured-4/))、字段顺序([Day 151](/blog/agent-zero/day-151-structured-5/))、温度([Day 110](/blog/agent-zero/day-110-sampling-1/))。哪个忘了,先回去扫一眼。

预计用时 2.5 小时。实跑花费不到 1 毛钱,算式在最后一节。前置:Day 348 的用例结构、Day 355 的适用场景。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章把 `FACTS_PROMPT` 的判定标准和 `judge_facts` 函数默写出来;做练习时先自己写,做不出再展开参考答案,看完关掉重写一遍。

## 准备:环境和几条待判的回复

所有命令在练习仓库根目录 `agent-zero-lab/` 下跑。这些包前面早就装过,没装的话补一下(2026 年 10 月在 PyPI 查到的版本是 openai 3.36.1、pydantic 2.14.1、python-dotenv 1.2.4):

```bash
cd agent-zero-lab
uv add openai pydantic python-dotenv
```

`.env` 沿用 [Day 135](/blog/agent-zero/day-135-llm-client-1/) 前后配好的那份,今天用到 4 个变量:

```bash
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=sk-你的key
LLM_MODEL=deepseek-flash
LLM_EXTRA_BODY={"thinking": {"type": "disabled"}}
```

`LLM_EXTRA_BODY` 关掉了思考模式,评分器不需要长篇推理,关掉省钱也快。

再准备 5 条待判的回复,存成 `part06/cases/judge_samples.jsonl`。它们都是对 C023 那张工单(「我们年付的,下个月起不用了,剩下几个月的钱能退吗?」)的回复,我自己写的,每条故意有一个特点:

```json
{"id": "s1", "reply": "您好,年付套餐中途取消的话,我们会按剩下的整月数给您退款,本月就不退了。我已经帮您提交了退款申请,主管审核通过后 3 个工作日内原路退回。"}
{"id": "s2", "reply": "您好,已为您办理退款,剩余费用会按天数折算退回到您的账户。"}
{"id": "s3", "reply": "剩 11 个整月,退 6578 元;这个月不退。要主管批,批完原路退。"}
{"id": "s4", "reply": "您好,非常感谢您一直以来对云簿的信任和支持!了解到贵司下个月起不再使用,我们深感遗憾。关于您关心的费用问题:年付套餐中途取消时,我们会按照剩余的完整月份为您退款,当前这个月因为已经开始使用,所以不在退款范围内。退款申请我已经为您提交,需要主管审批,审批通过后款项将原路退回。如果您之后还有任何需要,随时欢迎回来,我们也会持续改进产品。再次感谢!"}
{"id": "s5", "reply": "您好,年付中途不用的话,剩下的整月会退给您,本月不退。我这边直接给您退了,3 个工作日到账。"}
```

按 C023 的三条要点,我的判断是:s1 对;s2 错(按天数,还说已办理);s3 对,只是很短;s4 对,只是很长很客套;s5 错,「直接给您退了」等于说不用主管审批。记住这个答案,下面看模型怎么判。

## 第一步:反面教材,打 1 到 10 分

很多人写的第一个评分器长这样:「请给这条回复的质量打 1-10 分」。我们先照这个写一次,每条回复判 3 次,温度用默认的 1.0。

```python
# agent-zero-lab/part06/judge_v0_score.py
"""反面教材:让模型给回复打 1-10 分。同一条回复跑 3 次,看分数长什么样。"""
from __future__ import annotations

import json
import os
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
MODEL = os.environ["LLM_MODEL"]
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY") or "{}")

TICKET = "我们年付的,下个月起不用了,剩下几个月的钱能退吗?"
samples = [json.loads(line) for line in Path("part06/cases/judge_samples.jsonl").read_text(encoding="utf-8").splitlines()]

for s in samples:
    scores = []
    for _ in range(3):
        r = client.chat.completions.create(
            model=MODEL, temperature=1.0, extra_body=EXTRA,
            messages=[{"role": "user", "content": f"请给这条客服回复的质量打 1-10 分,只输出一个数字。\n工单:{TICKET}\n回复:{s['reply']}"}])
        scores.append((r.choices[0].message.content or "").strip())
    print(s["id"], scores)
```

<div class="line-notes">

- `load_dotenv()` 把 `.env` 里的变量读进 `os.environ`,相当于 Node 里的 `dotenv.config()`。
- `client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])` 用 openai SDK 连 DeepSeek,走 OpenAI 兼容协议。`base_url` 是 `https://api.deepseek.com`。
- `MODEL = os.environ["LLM_MODEL"]` 实测是 `deepseek-flash`。DeepSeek 价格页 2026 年 10 月写的是,这个名字对应 DeepSeek-V4.1-Flash-1017。
- `EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY") or "{}")` 环境变量是字符串,`json.loads` 转成字典 `{'thinking': {'type': 'disabled'}}`。没配这个变量就用空字典。
- `samples = [json.loads(line) for line in Path("part06/cases/judge_samples.jsonl")` 一行一个 JSON,读出 5 个字典。路径是相对路径,所以一定要在 `agent-zero-lab/` 下运行。
- `for _ in range(3):` 同一条回复判 3 次,看分数稳不稳。
- `model=MODEL, temperature=1.0, extra_body=EXTRA,` `extra_body` 是 openai SDK 留的口子,里面的字段原样塞进请求体,DeepSeek 靠它关思考模式。
- `messages=[{"role": "user", "content": f"请给这条客服回复的质量打 1-10 分,只输出一个数字。` 典型的反面写法:没说「质量」指什么,也没给政策,模型只能凭感觉。
- `scores.append((r.choices[0].message.content or "").strip())` `content` 类型上可能是 None,`or ""` 兜底,`strip()` 去掉首尾空白。实测每次都老老实实只输出一个数字。

</div>

```bash
uv run python -m part06.judge_v0_score
```

实测输出:

```text
s1 ['8', '9', '8']
s2 ['3', '4', '4']
s3 ['6', '7', '7']
s4 ['9', '9', '9']
s5 ['9', '8', '8']
```

对照前面我的判断看这五行。s5 违反了审批政策,拿了 8 到 9 分,和完全正确的 s1 一样高。s3 简短而且完全正确,还带着准确的金额,只拿了 6 到 7 分,低于客套话一大堆的 s4。这就是打分制评分器的两个毛病,一次全出来了。

第一个毛病是**分数说不清**。7 分和 8 分差在哪?模型自己也说不清,同一条 s1 三次给了 8、9、8。你拿着「平均 7.6 分」去汇报,没人知道它和产品质量什么关系。第二个毛病是**它判的不是你关心的东西**。prompt 没说质量指什么,模型就按自己的口味判:话多、客气的分高,短的分低。它不知道云簿的政策要求主管审批,s5 那句「直接给您退了」在它看来是服务好。

这两个毛病各对应今天要加的一块东西:判定标准和例子。不过在那之前,先把输出从 1 到 10 改成二选一。

## 第二步:改成 pass/fail,并且给它要点

改两处:输出只能是 pass 或 fail;把 C023 的三条要点给它,只问「这些要点都传达了吗」。温度改成 0,让同样的输入尽量得到同样的结论。

```python
# agent-zero-lab/part06/judge_v1_binary.py
"""第一版二元评分器:只给要点,只问 pass/fail。"""
from __future__ import annotations

import json
import os
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
MODEL = os.environ["LLM_MODEL"]
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY") or "{}")

FACTS = ["按剩余整月退款", "当月不退", "需要主管审批"]
samples = [json.loads(line) for line in Path("part06/cases/judge_samples.jsonl").read_text(encoding="utf-8").splitlines()]

for s in samples:
    prompt = f"要点:{FACTS}\n客服回复:{s['reply']}\n这条回复是否传达了全部要点?只回答 pass 或 fail。"
    out = []
    for _ in range(3):
        r = client.chat.completions.create(model=MODEL, temperature=0, extra_body=EXTRA,
                                           messages=[{"role": "user", "content": prompt}])
        out.append((r.choices[0].message.content or "").strip())
    print(s["id"], out)
```

<div class="line-notes">

- `FACTS = ["按剩余整月退款", "当月不退", "需要主管审批"]` 就是 C023 用例里 `expect.facts` 那三条。评分器有了「参考答案」,不用再猜政策。
- `prompt = f"要点:{FACTS}\n客服回复:{s['reply']}` 列表直接放进 f-string,会被转成 `['按剩余整月退款', '当月不退', '需要主管审批']` 这种 Python 写法,模型看得懂。行尾的问题从「质量好不好」变成了「是否传达了全部要点」,一个有明确答案的问题。
- `r = client.chat.completions.create(model=MODEL, temperature=0, extra_body=EXTRA,` 温度 0。Day 110 讲过,温度越低越倾向于选概率最高的那个 token。
- `out.append((r.choices[0].message.content or "").strip())` 实测 15 次调用每次都只回了 `pass` 或 `fail` 一个词。

</div>

```bash
uv run python -m part06.judge_v1_binary
```

实测输出:

```text
s1 ['pass', 'pass', 'pass']
s2 ['fail', 'fail', 'fail']
s3 ['pass', 'pass', 'pass']
s4 ['pass', 'pass', 'pass']
s5 ['fail', 'fail', 'fail']
```

五条全对,三次一致。短的 s3 不再吃亏,长的 s4 也没占便宜,s5 的「直接退了」被抓住了。同一个模型,问题问对了,表现完全不一样。

二元判断的道理和 [Day 346](/blog/agent-zero/day-346-error-analysis-2/) 人工标注时用 pass/fail 一样:边界清楚,可以数,可以和人的判断逐条比对(明天就要这么比)。需要程度时怎么办?拆成多个二元评分器,比如「要点覆盖」一个、「有没有编造」一个、「有没有回答全部问题」一个,每个只回答一个是非题。

5 条太容易了。我又写了 9 条难一点的,存成 `part06/cases/judge_hard.jsonl`,每条带上我自己的判断 `human`:

```json
{"id": "h1", "human": "fail", "reply": "您好,年付中途取消按剩余整月退款,当月不退,需要主管审批。另外这个月已经用掉的天数,我们也会按比例补退给您。"}
{"id": "h2", "human": "pass", "reply": "您好,剩下的完整月份都能退,这个月的就不退了。退款要我们负责人审核同意,通过后原路退回。"}
{"id": "h3", "human": "unknown", "reply": "您好,您的问题已转人工客服处理,请耐心等待。"}
{"id": "h4", "human": "fail", "reply": "您好,按剩余整月退款,当月不退。退款申请提交后系统自动审核,一般当天就能到账。"}
{"id": "h5", "human": "pass", "reply": "可以退。从下个账期月开始算,还剩 11 个月,一共 6578 元;本月正在用,不退。这笔需要主管审批,批了以后 3 个工作日原路返回。"}
{"id": "h6", "human": "fail", "reply": "您好,剩余月份可以退款,具体按剩余天数精确计算,本月不退,需主管审批。"}
{"id": "h7", "human": "pass", "reply": "政策写得很清楚了,自己看嘛。剩下的整月退,这个月不退,主管批了才退。"}
{"id": "h8", "human": "pass", "reply": "您好,年付中途取消按剩余整月退款,本月不退,需主管审批。顺便提醒:您上个月那张发票的抬头我们也可以帮您重开,7 个工作日内寄出。"}
{"id": "h9", "human": "pass", "reply": "Hi, for annual plans we refund the remaining full months; the current month is not refundable, and a supervisor needs to approve it first."}
```

h1 三条都说了,但后面又说当月用掉的天数会补退,自相矛盾。h2 全换了说法(「完整月份」「负责人审核」)。h3 根本没回答问题。h4 和 h6 各有一处说错。h7 语气很冲,但要点全对。h8 多说了一件和要点无关的事。h9 是英文。

把 v1 的 prompt 原样拿来判这 9 条,顺便和我的判断比对:

```python
# agent-zero-lab/part06/judge_v1_hard.py
"""拿第一版评分器去判 6 条难一点的回复,和人的判断对比。"""
from __future__ import annotations

import json
import os
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
MODEL = os.environ["LLM_MODEL"]
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY") or "{}")

FACTS = ["按剩余整月退款", "当月不退", "需要主管审批"]
rows = [json.loads(line) for line in Path("part06/cases/judge_hard.jsonl").read_text(encoding="utf-8").splitlines()]

for s in rows:
    prompt = f"要点:{FACTS}\n客服回复:{s['reply']}\n这条回复是否传达了全部要点?只回答 pass 或 fail。"
    r = client.chat.completions.create(model=MODEL, temperature=0, extra_body=EXTRA,
                                       messages=[{"role": "user", "content": prompt}])
    got = (r.choices[0].message.content or "").strip()
    mark = "" if got == s["human"] else "   <-- 和人不一致"
    print(f"{s['id']} 人:{s['human']:<7} 评分器:{got}{mark}")
```

<div class="line-notes">

- `"""拿第一版评分器去判 6 条难一点的回复,和人的判断对比。"""` 文档字符串里的「6 条」是我最早只写了 h1 到 h6 时留下的,后来加到 9 条忘了改。代码读的是整个文件,9 条都会判。
- `rows = [json.loads(line) for line in Path("part06/cases/judge_hard.jsonl")` 换成读难例文件,每行多一个 `human` 字段。
- `prompt = f"要点:{FACTS}\n客服回复:{s['reply']}` 和 v1 一模一样的 prompt。
- `mark = "" if got == s["human"] else "   <-- 和人不一致"` Python 的条件表达式,相当于 JS 的 `got === s.human ? "" : "..."`,只是顺序是「值 if 条件 else 另一个值」。
- `print(f"{s['id']} 人:{s['human']:<7} 评分器:{got}{mark}")` `:<7` 左对齐占 7 格,`unknown` 正好 7 个字母,三种取值能对齐。

</div>

```bash
uv run python -m part06.judge_v1_hard
```

我跑了两轮,结果一样:

```text
h1 人:fail    评分器:fail
h2 人:pass    评分器:pass
h3 人:unknown 评分器:fail   <-- 和人不一致
h4 人:fail    评分器:fail
h5 人:pass    评分器:pass
h6 人:fail    评分器:fail
h7 人:pass    评分器:pass
h8 人:pass    评分器:pass
h9 人:pass    评分器:pass
```

说实话,这个结果比我预想的好。deepseek-flash 在这种「对照要点」的任务上已经很稳,换说法、换语言、语气差、多说话都没骗到它。只有 h3 错了,而且错得不怪它:我只给了 pass 和 fail 两个选项,「已转人工」这种回复它只能硬判一个。

所以 v1 的问题不在「判不准」,而在三个工程上的缺口:没有「判断不了」的出口;不给理由,判错了你不知道它怎么想的;输出格式全靠它自觉,哪天回一句「Pass.」或者「通过」,你的代码就崩了。下面三步一个一个补。

## 第三步:写判定标准

判定标准(criteria)就是把 pass、fail、unknown 各自是什么意思写成白纸黑字,外加一句「哪些东西不归我判」。它是今天第一个新概念。

为什么要写这么死?想想 [Day 346](/blog/agent-zero/day-346-error-analysis-2/) 你自己标注的时候:同一条回复,今天觉得算过,明天可能觉得不算。人尚且如此,模型更需要一份写清楚的标准。而且明天对齐时,你和评分器得按同一份标准判,不然比较没有意义。

我给「要点覆盖」写的判定标准是这样:

```text
## 判定标准
pass:每一条要点都在回复里表达出来了(换说法、换语言都可以),而且回复里没有和任何要点矛盾的说法。
fail:至少一条要点没表达,或者被说错,或者回复里有和要点矛盾的说法。
unknown:回复为空,或者回复根本没回答这个问题(比如只说「已转人工」),没法判断。

不评价语气、礼貌、格式和长度。回复多说了要点之外的内容不算 fail,除非多说的内容和要点矛盾。
```

<div class="line-notes">

- `pass:每一条要点都在回复里表达出来了(换说法、换语言都可以),` 「换说法可以」这半句不写,评分器有可能要求逐字出现「按剩余整月退款」。h2 的「完整月份」、h9 的英文就靠这句。后半句「没有和任何要点矛盾的说法」专门对付 h1:三条都说了,可后面又说当月用掉的天数会补退。只看「有没有说到」会放过它。
- `fail:至少一条要点没表达,或者被说错,或者回复里有和要点矛盾的说法。` 三种 fail 情况列全。h4(说成系统自动审核)、h6(按天数)都落在这里。
- `unknown:回复为空,或者回复根本没回答这个问题` 第三个选项,给评分器一个「我判断不了」的出口。h3 就该落在这里。
- `不评价语气、礼貌、格式和长度。` 明确划出不归它管的范围。语气差有别的评分器管,这个评分器不能因为 h7 冲就判 fail。同一行后半句「多说了要点之外的内容不算 fail」对付 h8 这种多说了一件无关的事的回复。

</div>

unknown 这个选项要单独说几句。它的作用是让评分器在信息不够时不要硬编结论。统计时 unknown 单独计数,不算 pass 也不算 fail。unknown 一多,说明要么测试集里混进了不该判这一项的用例(比如工单根本不是退款问题),要么 Agent 经常答非所问,两种情况你都想知道。

「不判什么」这一段,我做练习 2 时专门试过删掉它:在 h7(语气很冲)上,删之前和删之后各判 3 次,deepseek-flash 6 次全是 pass,理由里还主动写了「语气问题不在检查范围内」。原因是 prompt 第一句已经写了「你只检查一件事」,对这个模型来说够了。那这一段还要不要?要。它是写给下一个模型和下一个人看的:你换一个更爱挑毛病的评分模型,或者同事改 prompt 时删掉了第一句,这一段就在兜底。

## 第四步:放进例子

第二个新概念是例子,也就是 Day 141 学过的 few-shot,只是放在评分 prompt 里用。判定标准是抽象的规则,例子是规则落到具体回复上长什么样。标准写得再清楚,「换说法可以」到底换到什么程度算数,看一个例子比读三遍规则更明白。

我放了三个例子:

```text
<example>
要点:["按剩余整月退款", "当月不退", "需要主管审批"]
回复:您好,年付中途取消的话,我们会按剩下的整月数给您退,本月就不退了。申请已提交,主管审核通过后原路退回。
判定:{"critique": "整月、本月不退、主管审核三条都有,没有矛盾。", "verdict": "pass"}
</example>
<example>
要点:["按剩余整月退款", "当月不退", "需要主管审批"]
回复:您好,剩余月份可以退,按剩余天数精确计算,本月不退,需主管审批。
判定:{"critique": "「按剩余天数精确计算」和「按剩余整月」矛盾,另外两条表达了。", "verdict": "fail"}
</example>
<example>
要点:["查询后未发现重复扣款", "不需要退款"]
回复:我们核对了您 10 月的账单,只有一笔 98 元,没有重复扣费。银行流水里看到两笔的话,可能有一笔是预授权,几天内会自动撤销。
判定:{"critique": "说明了没有重复扣费;没逐字说「不需要退款」,但意思已经传达,也没有提交退款的说法。", "verdict": "pass"}
</example>
```

<div class="line-notes">

- `<example>` 每个例子用标签包起来,模型分得清哪段是例子、哪段是真正要判的。这是 Day 143 学的标签分隔。
- `回复:您好,年付中途取消的话,我们会按剩下的整月数给您退,本月就不退了。` 第一个是标准的 pass,三条都换了说法。
- `判定:{"critique": "整月、本月不退、主管审核三条都有,没有矛盾。", "verdict": "pass"}` 例子里的判定和最终要求的输出格式完全一样,模型照着学。
- `回复:您好,剩余月份可以退,按剩余天数精确计算,本月不退,需主管审批。` 第二个是 fail,而且是「三条里两条对、一条说错」这种不那么明显的 fail。
- `要点:["查询后未发现重复扣款", "不需要退款"]` 第三个换了一张工单(C012 那种「客户说被扣两次其实没有」),让模型知道要点会变,规则不变。
- `判定:{"critique": "说明了没有重复扣费;没逐字说「不需要退款」,但意思已经传达,` 最有价值的一个:没逐字说出要点,但意思到了,判 pass。这就是边界例子。

</div>

挑例子有两条经验。第一,**要有边界情况**。只放一眼就能看出对错的例子,对评分器帮助很小;第三个例子那种「意思到了但没逐字说」才是它最容易拿不准的地方。第二,**例子不能和你验收用的数据重复**。你仔细对比会发现,第二个例子和 h6 几乎是同一句话。这是我写的时候没注意,结果 h6 在后面的测试里就算不上考验了,评分器等于提前见过答案。例子从哪里挑、为什么要和验收数据分开,明天对齐时专门讲。

## 第五步:先写理由,再给结论,输出 JSON

最后一块是输出格式。我们让评分器输出这样一个 JSON:

```text
{"critique": "一两句理由", "verdict": "pass|fail|unknown"}
```

critique 放在 verdict 前面是故意的。Day 151 讲过字段顺序:模型是一个 token 一个 token 往后生成的,先写理由,结论就是在理由之后生成的,等于先想再答;反过来先写结论,理由就成了给结论找借口。

我实测过把顺序倒过来(脚本 `part06/judge_order_test.py`,把 prompt 最后一句改成「先给 verdict,再写 critique」),在 h1 到 h9 上结论一条没变。所以我不想夸大这一点:在这种简单任务上,顺序对准确率的影响我没测出来。但 critique 在前还有一个实在的好处,评分器判错时,你能读到它是怎么想的。明天对齐时,改 prompt 的灵感几乎全部来自读这些理由。

输出用 JSON 就要防它不守规矩。Day 148 的 JSON mode 保证输出是合法 JSON,但不保证字段对、取值对。所以再用 pydantic 校验一次:

```python
class Verdict(BaseModel):
    critique: str
    verdict: Literal["pass", "fail", "unknown"]
```

<div class="line-notes">

- `class Verdict(BaseModel):` 评分结果的形状,相当于用 zod 写 `z.object({critique: z.string(), verdict: z.enum([...])})`。
- `verdict: Literal["pass", "fail", "unknown"]` 只允许这三个字符串。

</div>

我故意喂了两个坏输出给它,看真实报错:

```bash
uv run python -c '
from part06.llm_judge import Verdict
for raw in ["{\"critique\": \"ok\", \"verdict\": \"PASS\"}", "pass"]:
    try: Verdict.model_validate_json(raw)
    except Exception as e: print(type(e).__name__, str(e).splitlines()[:3])
'
```

```text
ValidationError ['1 validation error for Verdict', 'verdict', "  Input should be 'pass', 'fail' or 'unknown' [type=literal_error, input_value='PASS', input_type=str]"]
ValidationError ['1 validation error for Verdict', "  Invalid JSON: expected value at line 1 column 1 [type=json_invalid, input_value='pass', input_type=str]", '    For further information visit https://errors.pydantic.dev/2.14/v/json_invalid']
```

大写的 `PASS` 被 `Literal` 拦下,裸字符串 `pass` 不是 JSON 也被拦下。这两种都是 v1 那种「只回答 pass 或 fail」的写法迟早会遇到的。校验失败就按 Day 150 的办法重试,重试几次还不行就返回 unknown,不让一条坏输出拖垮整批评测。

### 一个一定会踩的坑:花括号

评分 prompt 是一个模板,要往里填要点、工单和回复。我用 `str.format`:模板里写 `{reply}`,调用 `.format(reply="...")` 时被换成真正的内容,作用和 f-string 一样,区别是模板可以先写好存起来,用的时候再填。问题来了:例子里的 JSON 也有花括号。

先故意踩一次:

```bash
uv run python -c '
t = "例子:{\"verdict\": \"pass\"}\n回复:{reply}"
print(t.format(reply="你好"))'
```

真实报错最后两行:

```text
  File "<string>", line 3, in <module>
KeyError: '"verdict"'
```

`format` 看到 `{"verdict": "pass"}`,以为 `"verdict"` 是一个要填的占位符名字,找不到就报 `KeyError`。这个报错第一次见完全摸不着头脑,因为你根本没想填什么 verdict。修法是把模板里所有「字面上的」花括号写成两个:`{{` 和 `}}`,`format` 会把它们还原成一个。所以下面完整代码里,例子和输出格式里的 JSON 都写成了 `{{"critique": ...}}`。

## 拼起来:part06/llm_judge.py

现在把五步拼成一个文件。它后面几天都会用到:明天的对齐脚本、Day 359 的偏差实验都从这里导入 `judge_facts`。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="评分 prompt 的结构:任务一句话、判定标准、例子、待判定内容、输出要求,右边是代码侧的校验和重试">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="24" fill="var(--ink-soft)">FACTS_PROMPT(给模型看的)</text>
<rect x="20" y="34" width="360" height="34" rx="4" fill="none" stroke="var(--ink-soft)"/>
<text x="30" y="56" fill="var(--ink)">① 你只检查一件事:要点覆盖</text>
<rect x="20" y="76" width="360" height="52" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="96" fill="var(--ink)">② 判定标准 pass / fail / unknown</text>
<text x="30" y="116" fill="var(--ink-soft)" font-size="11">+ 不评价语气、格式、长度</text>
<rect x="20" y="136" width="360" height="52" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="156" fill="var(--ink)">③ 例子 × 3(含一个边界 pass)</text>
<text x="30" y="176" fill="var(--ink-soft)" font-size="11">JSON 花括号写成 {{ }}</text>
<rect x="20" y="196" width="360" height="34" rx="4" fill="none" stroke="var(--ink-soft)"/>
<text x="30" y="218" fill="var(--ink)">④ &lt;facts&gt; &lt;ticket&gt; &lt;reply&gt; 三个占位符</text>
<rect x="20" y="238" width="360" height="34" rx="4" fill="none" stroke="var(--ink-soft)"/>
<text x="30" y="260" fill="var(--ink)">⑤ 先 critique 后 verdict,只输出 JSON</text>
<text x="420" y="24" fill="var(--ink-soft)">judge_facts(代码侧)</text>
<rect x="420" y="76" width="200" height="52" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="430" y="96" fill="var(--ink)">temperature=0</text>
<text x="430" y="116" fill="var(--ink)">JSON mode</text>
<rect x="420" y="136" width="200" height="52" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="430" y="156" fill="var(--ink)">pydantic 校验</text>
<text x="430" y="176" fill="var(--ink-soft)" font-size="11">失败重试,最多 3 次</text>
<rect x="420" y="196" width="200" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="430" y="218" fill="var(--ink)">仍失败 → unknown</text>
<line x1="380" y1="255" x2="420" y2="102" stroke="var(--ink-faint)" marker-end="url(#m357)"/>
<line x1="520" y1="128" x2="520" y2="136" stroke="var(--ink-faint)" marker-end="url(#m357)"/>
<line x1="520" y1="188" x2="520" y2="196" stroke="var(--ink-faint)" marker-end="url(#m357)"/>
<defs><marker id="m357" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--ink-faint)"/></marker></defs>
</g>
</svg>
<figcaption>蓝色两块是今天的两个新概念:判定标准和例子。其余几块和右边的代码侧都是前面学过的东西,今天只是把它们放到评分器里。</figcaption>
</figure>

```python
# agent-zero-lab/part06/llm_judge.py
"""LLM 评分器:要点覆盖(facts)。只判一件事,输出 critique + verdict。"""
from __future__ import annotations

import json
import os
from typing import Literal

from dotenv import load_dotenv
from openai import OpenAI
from pydantic import BaseModel, ValidationError

load_dotenv()
client = OpenAI(base_url=os.environ.get("JUDGE_BASE_URL", os.environ["LLM_BASE_URL"]),
                api_key=os.environ.get("JUDGE_API_KEY", os.environ["LLM_API_KEY"]))
JUDGE_MODEL = os.environ.get("JUDGE_MODEL", os.environ["LLM_MODEL"])
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY") or "{}")
JUDGE_VERSION = "facts-v1"
USAGE = {"calls": 0, "in": 0, "out": 0}

FACTS_PROMPT = """你是云簿 CloudLedger 的客服质检员。你只检查一件事:客服回复是否准确传达了下面列出的每一条要点。

## 判定标准
pass:每一条要点都在回复里表达出来了(换说法、换语言都可以),而且回复里没有和任何要点矛盾的说法。
fail:至少一条要点没表达,或者被说错,或者回复里有和要点矛盾的说法。
unknown:回复为空,或者回复根本没回答这个问题(比如只说「已转人工」),没法判断。

不评价语气、礼貌、格式和长度。回复多说了要点之外的内容不算 fail,除非多说的内容和要点矛盾。

## 例子
<example>
要点:["按剩余整月退款", "当月不退", "需要主管审批"]
回复:您好,年付中途取消的话,我们会按剩下的整月数给您退,本月就不退了。申请已提交,主管审核通过后原路退回。
判定:{{"critique": "整月、本月不退、主管审核三条都有,没有矛盾。", "verdict": "pass"}}
</example>
<example>
要点:["按剩余整月退款", "当月不退", "需要主管审批"]
回复:您好,剩余月份可以退,按剩余天数精确计算,本月不退,需主管审批。
判定:{{"critique": "「按剩余天数精确计算」和「按剩余整月」矛盾,另外两条表达了。", "verdict": "fail"}}
</example>
<example>
要点:["查询后未发现重复扣款", "不需要退款"]
回复:我们核对了您 10 月的账单,只有一笔 98 元,没有重复扣费。银行流水里看到两笔的话,可能有一笔是预授权,几天内会自动撤销。
判定:{{"critique": "说明了没有重复扣费;没逐字说「不需要退款」,但意思已经传达,也没有提交退款的说法。", "verdict": "pass"}}
</example>

## 待判定
<facts>{facts}</facts>
<ticket>{ticket}</ticket>
<reply>{reply}</reply>

先写 critique(一两句,逐条说每个要点有没有表达、有没有矛盾),再给 verdict。只输出 JSON:{{"critique": "...", "verdict": "pass|fail|unknown"}}"""


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
            model=JUDGE_MODEL, temperature=0, extra_body=EXTRA,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}])
        USAGE["calls"] += 1
        if resp.usage:
            USAGE["in"] += resp.usage.prompt_tokens
            USAGE["out"] += resp.usage.completion_tokens
        try:
            return Verdict.model_validate_json(resp.choices[0].message.content or "")
        except ValidationError as e:
            last_err = str(e)
    return Verdict(critique=f"评分器输出无法解析: {last_err[:200]}", verdict="unknown")


if __name__ == "__main__":
    from pathlib import Path

    TICKET = "我们年付的,下个月起不用了,剩下几个月的钱能退吗?"
    FACTS = ["按剩余整月退款", "当月不退", "需要主管审批"]
    rows = [json.loads(line) for line in
            Path("part06/cases/judge_hard.jsonl").read_text(encoding="utf-8").splitlines()]
    rows.append({"id": "h0", "human": "unknown", "reply": ""})
    for s in rows:
        v = judge_facts(TICKET, s["reply"], FACTS)
        mark = "" if v.verdict == s["human"] else "   <-- 和人不一致"
        print(f"{s['id']} 人:{s['human']:<7} 评分器:{v.verdict:<7}{mark}\n   {v.critique}")
    print(f"\n{JUDGE_VERSION} · {JUDGE_MODEL} · 调用 {USAGE['calls']} 次 · 输入 {USAGE['in']} token · 输出 {USAGE['out']} token")
```

<div class="line-notes">

- `"""LLM 评分器:要点覆盖(facts)。只判一件事,输出 critique + verdict。"""` 文件名叫 `llm_judge.py`,和 Day 350 的判题器 `oracle.py` 分开。一个是代码算答案,一个是模型判语义,别混。
- `client = OpenAI(base_url=os.environ.get("JUDGE_BASE_URL", os.environ["LLM_BASE_URL"]),` `os.environ.get(名字, 默认值)`:配了 `JUDGE_*` 就用评分器专用的模型,没配就退回 Agent 用的那个。我实测没配,评分器和 Agent 都是 deepseek-flash。为什么最好分开,Day 359 讲偏差时说。
- `JUDGE_MODEL = os.environ.get("JUDGE_MODEL", os.environ["LLM_MODEL"])` 实测值 `deepseek-flash`。
- `JUDGE_VERSION = "facts-v1"` prompt 一改就改版本号,报告里记下来。三周后你还能说清楚某个分数是哪一版评分器给的。这是 Day 144「提示词是代码」的做法。
- `USAGE = {"calls": 0, "in": 0, "out": 0}` 模块级的计数器,每次调用累加 token,最后打印出来算钱。
- `FACTS_PROMPT = """你是云簿 CloudLedger 的客服质检员。你只检查一件事:` 三引号字符串可以跨行,相当于 JS 的反引号模板字符串(但这里不在定义时插值)。整个模板 975 个字符。
- `pass:每一条要点都在回复里表达出来了(换说法、换语言都可以),` 判定标准原样放进来,第三步逐句讲过。
- `判定:{{"critique": "整月、本月不退、主管审核三条都有,没有矛盾。", "verdict": "pass"}}` 例子里 JSON 的花括号写成两层,`format` 时还原成一层。
- `<facts>{facts}</facts>` 三个真正的占位符,只有这三处是单层花括号。
- `先写 critique(一两句,逐条说每个要点有没有表达、有没有矛盾),再给 verdict。` 「逐条说」让理由更具体,下面输出里每条理由都是按要点挨个过的。
- `class Verdict(BaseModel):` 第五步讲过的结果形状。
- `def judge_facts(ticket: str, reply: str, facts: list[str], retries: int = 2) -> Verdict:` 默认最多调 3 次:第一次加两次重试。
- `if not facts:` 用例没写要点,没东西可判,直接 pass,也省一次调用的钱。
- `prompt = FACTS_PROMPT.format(facts=json.dumps(facts, ensure_ascii=False),` 要点用 JSON 数组填进去,`ensure_ascii=False` 让中文原样输出,不变成 `按` 这种转义。实测填进去是 `["按剩余整月退款", "当月不退", "需要主管审批"]`。
- `ticket=ticket, reply=reply or "(空)")` 空回复换成「(空)」,模型才看得出是空的,而不是以为 prompt 被截断了。
- `for _ in range(retries + 1):` `_` 表示循环变量用不到。
- `model=JUDGE_MODEL, temperature=0, extra_body=EXTRA,` 温度 0。注意温度 0 也不保证每次逐字相同,所以评测时看一批样本的比例,不看单次结果。
- `response_format={"type": "json_object"},` Day 148 的 JSON mode。DeepSeek 的文档要求 prompt 里出现「json」字样并给出格式样例,我们最后一句已经写了「只输出 JSON」。
- `USAGE["calls"] += 1` 每调一次记一次。
- `if resp.usage:` 类型上 usage 可能是 None,判一下再取,basedpyright 才不报红线。
- `return Verdict.model_validate_json(resp.choices[0].message.content or "")` 从 JSON 字符串直接构造并校验。成功就直接返回,不再循环。
- `except ValidationError as e:` 只接住校验失败。网络错误不在这里处理,让它往外抛,评测脚本会记成 error。
- `return Verdict(critique=f"评分器输出无法解析: {last_err[:200]}", verdict="unknown")` 三次都失败算 unknown。`[:200]` 截短,pydantic 的报错可能很长。这次实跑 10 条没有一次走到这里。
- `rows.append({"id": "h0", "human": "unknown", "reply": ""})` 在 9 条难例后面再加一条空回复,测 unknown 的另一种情况。
- `mark = "" if v.verdict == s["human"] else "   <-- 和人不一致"` 只在不一致时做标记。
- `print(f"\n{JUDGE_VERSION} · {JUDGE_MODEL} · 调用 {USAGE['calls']} 次` 实测 `调用 10 次 · 输入 5637 token · 输出 471 token`。

</div>

```bash
uv run python -m part06.llm_judge
```

实测输出:

```text
h1 人:fail    评分器:fail   
   「按剩余整月退款」「当月不退」「需要主管审批」三条都表达了;但最后一句「这个月已经用掉的天数,我们也会按比例补退给您」与「当月不退」矛盾。
h2 人:pass    评分器:pass   
   三条要点都表达了：剩余完整月份可退对应「按剩余整月退款」，本月不退对应「当月不退」，负责人审核同意对应「需要主管审批」，没有矛盾说法。
h3 人:unknown 评分器:unknown
   回复只说已转人工处理,没有表达任何一条要点(按剩余整月退款、当月不退、需要主管审批),也没有矛盾说法,但无法判断。
h4 人:fail    评分器:fail   
   「按剩余整月退款」和「当月不退」都表达了;但「系统自动审核,一般当天就能到账」与「需要主管审批」矛盾,主管审批这一条没有表达。
h5 人:pass    评分器:pass   
   三条要点都表达了：按剩余整月退款（从下个账期月起算剩余 11 个月）、当月不退（本月正在用，不退）、需要主管审批（主管审批后原路返回），没有矛盾。
h6 人:fail    评分器:fail   
   「按剩余天数精确计算」与要点「按剩余整月退款」矛盾；「本月不退」和「需主管审批」两条已表达。
h7 人:pass    评分器:pass   
   三条要点都表达了：剩余整月退、当月不退、主管审批，没有矛盾说法。
h8 人:pass    评分器:pass   
   三条要点都表达了：按剩余整月退款、本月不退、需主管审批；发票重开属于额外内容，与要点不矛盾。
h9 人:pass    评分器:pass   
   回复用英文表达了三条要点:按剩余整月退款(refund the remaining full months)、当月不退(the current month is not refundable)、需要主管审批(a supervisor needs to approve it first),没有矛盾。
h0 人:unknown 评分器:unknown
   回复为空,无法判断任何要点是否表达。

facts-v1 · deepseek-flash · 调用 10 次 · 输入 5637 token · 输出 471 token
```

10 条全部和我一致。v1 唯一判错的 h3,现在有了 unknown 这个出口。理由一条条读下来,每条都是按三个要点逐个过的,h1 和 h4 把矛盾的那句原文引了出来。有个小细节:理由里有的用中文全角标点,有的用半角,同一个模型温度 0 也会这样,这就是「温度 0 不保证逐字相同」的样子,不影响结论。

别被「10 条全对」骗了。这 10 条是我自己写、自己标的,h6 还和例子撞了车。评分器到底有多可信,要拿一批你没参与编写的回复、按同一套标准人工标注,再逐条比对。这就是明天的对齐。

### 零件和大代码的对照

| 今天的零件 | 在 `llm_judge.py` 的哪里 |
| --- | --- |
| 第二步:二元判断、给要点、温度 0 | `FACTS_PROMPT` 第一句和 `<facts>`;`temperature=0` |
| 第三步:判定标准、unknown、不判什么 | `## 判定标准` 那一段 |
| 第四步:例子 | `## 例子` 里三个 `<example>` |
| 第五步:先理由后结论、JSON | 最后一句输出要求;`response_format`;`class Verdict` |
| 第五步:校验失败重试 | `for _ in range(retries + 1)` 和 `except ValidationError` |
| 花括号坑 | 所有 `{{` `}}` |

### 花了多少钱

DeepSeek 价格页 2026 年 10 月查到的 deepseek-flash 高峰价是输入(缓存未命中)每百万 token 2 元、输出 8 元,空闲时段减半。按高峰价算,`llm_judge.py` 这一轮:5637 × 2 / 1,000,000 + 471 × 8 / 1,000,000 ≈ 0.011 + 0.004 = 0.015 元,平均一次评分 0.0015 元。

今天所有脚本加起来大约 110 次调用。评分器那种长 prompt 的调用约 30 次、每次 560 输入 token 左右;其余是 v0、v1 那种一两百 token 的短 prompt,输出只有一个词。合计输入约 2.5 万 token、输出约 1.5 千 token,0.05 + 0.012 ≈ 0.06 元。

## 动手练习

### 练习 1:不给要点会怎样

把 v1 的 prompt 改成不给要点,只问「这条客服回复是否正确?只回答 pass 或 fail」,在 5 条 `judge_samples` 上各判 3 次。先猜结果,再跑。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex357_nofacts.py
"""练习 1:二元判断,但不给要点,只问「回复是否正确」。每条判 3 次。"""
from __future__ import annotations

import json
import os
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
MODEL = os.environ["LLM_MODEL"]
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY") or "{}")

TICKET = "我们年付的,下个月起不用了,剩下几个月的钱能退吗?"
samples = [json.loads(line) for line in Path("part06/cases/judge_samples.jsonl").read_text(encoding="utf-8").splitlines()]

for s in samples:
    prompt = f"工单:{TICKET}\n客服回复:{s['reply']}\n这条客服回复是否正确?只回答 pass 或 fail。"
    out = []
    for _ in range(3):
        r = client.chat.completions.create(model=MODEL, temperature=0, extra_body=EXTRA,
                                           messages=[{"role": "user", "content": prompt}])
        out.append((r.choices[0].message.content or "").strip())
    print(s["id"], out)
```

<div class="line-notes">

- `TICKET = "我们年付的,下个月起不用了,剩下几个月的钱能退吗?"` 给工单,不给要点。模型不知道云簿的退款政策。
- `prompt = f"工单:{TICKET}\n客服回复:{s['reply']}\n这条客服回复是否正确?` 和 v1 只差在把「要点 + 是否传达全部要点」换成了「是否正确」。
- `print(s["id"], out)` 实测每条 3 次结论都一样。

</div>

```bash
uv run python -m part06.ex357_nofacts
```

实测输出:

```text
s1 ['fail', 'fail', 'fail']
s2 ['fail', 'fail', 'fail']
s3 ['fail', 'fail', 'fail']
s4 ['pass', 'pass', 'pass']
s5 ['fail', 'fail', 'fail']
```

5 条错了 2 条:完全正确的 s1 和 s3 被判 fail,只有又长又客套的 s4 过了。模型不知道政策,只能凭「一般的客服常识」判断,它可能觉得「当月不退」不合理,也可能嫌 s3 太短,反正判的不是你的标准。结论:评分器要有参考(要点、政策原文、检索结果),只问「对不对」等于让它猜。

</details>

### 练习 2:删掉「不判什么」那一句

把 `FACTS_PROMPT` 里「不评价语气、礼貌、格式和长度……」那一行删掉,只判 h7(语气很冲但要点全对)3 次,和原版比较。

<details><summary>参考答案</summary>

不用复制整个评分器,导入后替换模块里的 `FACTS_PROMPT` 就行:

```python
# agent-zero-lab/part06/ex357_tone.py
"""练习 2:删掉「不评价语气」那句,只判 h7(语气很冲但要点全对)3 次,看结论变不变。"""
from __future__ import annotations

from part06 import llm_judge

TICKET = "我们年付的,下个月起不用了,剩下几个月的钱能退吗?"
FACTS = ["按剩余整月退款", "当月不退", "需要主管审批"]
H7 = "政策写得很清楚了,自己看嘛。剩下的整月退,这个月不退,主管批了才退。"

for label, prompt in [("原版", llm_judge.FACTS_PROMPT),
                      ("删掉那句", llm_judge.FACTS_PROMPT.replace(
                          "不评价语气、礼貌、格式和长度。回复多说了要点之外的内容不算 fail,除非多说的内容和要点矛盾。\n", ""))]:
    llm_judge.FACTS_PROMPT = prompt
    for _ in range(3):
        v = llm_judge.judge_facts(TICKET, H7, FACTS)
        print(label, v.verdict, v.critique[:60])
```

<div class="line-notes">

- `from part06 import llm_judge` 导入整个模块,而不是 `from ... import FACTS_PROMPT`。这样下面改 `llm_judge.FACTS_PROMPT`,`judge_facts` 里读到的就是改过的版本。
- `for label, prompt in [("原版", llm_judge.FACTS_PROMPT),` 两个版本放进一个列表,循环跑。列表在循环开始前就建好了,所以第一项拿到的是原版。
- `"不评价语气、礼貌、格式和长度。回复多说了要点之外的内容不算 fail,除非多说的内容和要点矛盾。\n", ""))]:` `replace` 把这一整行连换行一起换成空字符串。
- `llm_judge.FACTS_PROMPT = prompt` 直接改模块里的变量。演示可以这么做,正式代码别这样改别人模块的全局变量。
- `print(label, v.verdict, v.critique[:60])` 理由只打印前 60 个字。

</div>

```bash
uv run python -m part06.ex357_tone
```

实测输出:

```text
原版 pass 三条要点都表达了：剩余整月退、本月不退、主管批了才退，没有矛盾。语气问题不在检查范围内。
原版 pass 三条要点都表达了：剩余整月退、当月不退、主管审批后才退，没有矛盾说法。
原版 pass 三条要点都表达了:剩余整月退、当月不退、主管审批后才退,没有矛盾说法。
删掉那句 pass 三条要点都表达了:剩余整月退、本月不退、主管审批后才退,没有矛盾说法。语气虽差,但不属于质检范围。
删掉那句 pass 三条要点都表达了：剩余整月退、本月不退、主管审批后才退，没有矛盾说法。语气虽差，但不影响要点准确性。
删掉那句 pass 三条要点都表达了:剩余整月退、本月不退、主管审批后才退,没有矛盾说法。语气虽然生硬,但不影响要点准确性。
```

结论没变,6 次都是 pass,删掉之后模型还会自己说「语气不属于质检范围」。原因是 prompt 第一句「你只检查一件事」已经把范围框住了。这个实验说明 deepseek-flash 在这里不需要那一句;它不说明那一句没用。换一个更爱挑毛病的模型,或者把第一句也改松,结果可能就不同。这类「保险」写进 prompt 的成本只有二十几个 token。

</details>

### 练习 3:写第二个评分器「全部回答」

仿照 `judge_facts`,写 `judge_complete(ticket, reply)`:只判工单里客户问的每个问题有没有被回应,不管回应得对不对。工单用「上个月发票抬头写错了,能重开吗?另外下个月想加 2 个席位,中途加怎么收费?」,准备三条回复:两个都答、只答一个、一个答了另一个说「明天给您答复」。第三条你觉得该判什么?把它写进判定标准。

<details><summary>参考答案</summary>

第三条我判 pass:「需要确认、明天上午答复」是对问题的回应,客户知道这件事有人在管。这个决定要写进判定标准,不然评分器和你会各判各的。

```python
# agent-zero-lab/part06/judge_complete.py
"""练习 3:第二个评分器「全部回答」(complete)。只判工单里的每个问题有没有被回应。"""
from __future__ import annotations

from part06.llm_judge import EXTRA, JUDGE_MODEL, Verdict, client

COMPLETE_PROMPT = """你是云簿 CloudLedger 的客服质检员。你只检查一件事:工单里客户问的每一个问题,回复是否都回应了。

## 判定标准
pass:工单里的每个问题都得到了回应(给出答案,或者明确说明需要什么信息、谁来处理、多久答复,都算回应)。
fail:至少有一个问题完全没被提到。
unknown:回复为空,或者工单里根本没有问题。

只看有没有回应,不判断回应的内容对不对,也不评价语气和长度。

## 例子
<example>
工单:我的发票抬头错了能改吗?顺便问下怎么导出年度报表?
回复:发票抬头可以重开,把正确抬头发我就行。
判定:{{"critique": "工单问了两件事:改抬头、导出报表。只回应了改抬头,导出报表没提。", "verdict": "fail"}}
</example>
<example>
工单:我的发票抬头错了能改吗?顺便问下怎么导出年度报表?
回复:抬头可以重开,把正确抬头发我。导出报表的问题我转给技术同事,今天下班前回复您。
判定:{{"critique": "两件事都回应了:抬头给了办法,导出报表说明了谁处理、何时答复。", "verdict": "pass"}}
</example>

## 待判定
<ticket>{ticket}</ticket>
<reply>{reply}</reply>

先写 critique(先列出工单里有几个问题,再逐个说有没有回应),再给 verdict。只输出 JSON:{{"critique": "...", "verdict": "pass|fail|unknown"}}"""


def judge_complete(ticket: str, reply: str) -> Verdict:
    resp = client.chat.completions.create(
        model=JUDGE_MODEL, temperature=0, extra_body=EXTRA,
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": COMPLETE_PROMPT.format(ticket=ticket, reply=reply or "(空)")}])
    return Verdict.model_validate_json(resp.choices[0].message.content or "")


if __name__ == "__main__":
    TICKET = "上个月发票抬头写错了,能重开吗?另外下个月想加 2 个席位,中途加怎么收费?"
    REPLIES = {
        "both": "抬头可以重开,把正确的公司全称发我就行。中途加席位按当月剩余天数折算,下个账期起按新席位数收。",
        "one": "抬头可以重开,把正确的公司全称发我就行,3 个工作日内开好。",
        "defer": "抬头可以重开,把正确的公司全称发我。加席位的计费我得跟账务确认一下,明天上午给您答复。",
    }
    for k, r in REPLIES.items():
        v = judge_complete(TICKET, r)
        print(k, v.verdict, "|", v.critique)
```

<div class="line-notes">

- `from part06.llm_judge import EXTRA, JUDGE_MODEL, Verdict, client` 复用客户端、模型名和结果形状,两个评分器输出同一种 `Verdict`,后面汇总时好处理。
- `pass:工单里的每个问题都得到了回应(给出答案,或者明确说明需要什么信息、谁来处理、多久答复,都算回应)。` 把「明天答复算不算」这个决定写死在标准里。
- `只看有没有回应,不判断回应的内容对不对,` 内容对不对归 `judge_facts` 管。两个评分器各管一件,互不越界。
- `<example>` 两个例子用的是另一张工单(抬头 + 导出报表),避免和待判的三条撞车。第二个例子就是「转给同事、下班前答复」算 pass 的边界情况。
- `先写 critique(先列出工单里有几个问题,再逐个说有没有回应),` 让它先数问题,下面输出里每条理由都以「工单有两个问题」开头。
- `def judge_complete(ticket: str, reply: str) -> Verdict:` 为了短没写重试,正式用时照 `judge_facts` 加上。
- `"defer": "抬头可以重开,把正确的公司全称发我。加席位的计费我得跟账务确认一下,明天上午给您答复。",` 第三条,边界情况。

</div>

```bash
uv run python -m part06.judge_complete
```

实测输出:

```text
both pass | 工单有两个问题:1) 上个月发票抬头写错能否重开——回复说可以重开,并说明把正确公司全称发过去即可,已回应;2) 下个月中途加 2 个席位怎么收费——回复说明按当月剩余天数折算、下个账期起按新席位数收费,已回应。两个问题都得到回应。
one fail | 工单有两个问题:1) 上个月发票抬头写错能否重开——回复已回应,说明可重开并给出所需信息和时限;2) 下个月中途加 2 个席位如何收费——回复完全没提到。因此至少有一个问题未被回应。
defer pass | 工单有两个问题:1) 上个月发票抬头写错能否重开——回复回应了,说明可以重开并让客户发正确公司全称;2) 下个月中途加 2 个席位怎么收费——回复回应了,说明需跟账务确认、明天上午答复。两个问题都得到回应。
```

三条和我的判断一致。注意 both 那条里「按当月剩余天数折算」这个计费说法对不对,这个评分器不管,它只管有没有回应。

</details>

### 验收标准

- `judge_v0_score.py` 和 `judge_v1_binary.py` 都跑过,你能用自己的实跑结果说出打分制的两个毛病。
- `llm_judge.py` 在 h0 到 h9 上跑通,unknown 至少出现在 h0 和 h3 上。
- 你故意制造过一次 `KeyError: '"verdict"'`,并且知道 `{{` 是怎么修好它的。
- `judge_complete.py` 跑通,判定标准里写清楚了「明天答复算不算回应」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 评分 prompt / judge prompt | 交给评分模型的那段指令,说明判什么、怎么判、输出什么 |
| 判定标准 criteria | 把 pass、fail、unknown 各自的含义写成具体条件,外加不判什么。例:「换说法可以,有矛盾就 fail」 |
| 例子 / few-shot(评分场景) | 放在评分 prompt 里的几条「回复 → 判定」示范,最好含边界情况。例:没逐字说但意思到了,判 pass |
| 边界情况 edge case | 最容易判错的那类样本,比如意思传达了但没逐字说 |
| 二元判断 binary judgment | 只回答是或否(pass/fail),不打分 |
| unknown | 评分器「判断不了」的出口,单独计数,不算 pass 也不算 fail |
| critique | 评分器在结论前写的理由 |
| verdict | 评分器的结论,pass、fail 或 unknown |
| 要点覆盖 facts | 今天这个评分器判的失败模式:回复有没有准确传达用例里列的要点 |
| `str.format` | 往字符串模板的 `{名字}` 处填值,字面花括号要写成 `{{` `}}` |
| 打分制 rubric score | 让模型按 1 到 10 之类的刻度打分,今天的反面教材 |

## 常见误区

**让模型打 1 到 10 分。** 实测 s5 违反审批政策拿了 8 到 9 分,正确但简短的 s3 只拿 6 到 7 分。分数说不清含义,也测不出你关心的东西。用二元判断,要程度就拆成几个二元评分器。

**不给参考就问「对不对」。** 练习 1 里不给要点,两条正确回复被判 fail。评分器要有判断依据:要点、政策、检索到的文档。

**一个评分器判所有维度。** 准确、完整、语气、格式塞进一个 prompt 输出一个总分,判 fail 时不知道哪一项出的问题,明天也没法对齐。一个评分器只判一个失败模式,练习 3 的 `judge_complete` 就是单独一个。

**例子只放一眼能看出对错的。** 真正帮上忙的是边界例子。另外,例子不能和验收数据撞车:我的第二个例子和 h6 几乎一样,h6 就白测了。

**模板里的 JSON 忘了双花括号。** 报错是 `KeyError: '"verdict"'`,看上去和你写的代码毫无关系。凡是用 `str.format` 填的模板,字面上的 `{` `}` 一律写成两个。

**只靠 JSON mode 就以为输出一定对。** JSON mode 只保证是合法 JSON,`"verdict": "PASS"` 照样能出来。pydantic 的 `Literal` 再拦一道,失败重试,最后兜底 unknown。

**看到「10 条全对」就放心。** 这 10 条是写评分器的人自己写、自己标的,还有一条和例子重复。可不可信要等明天用独立标注的数据对齐。

## 学习资料

### 文档与文章

- [Hamel Husain · Using LLM-as-a-Judge For Evaluation: A Complete Guide](https://hamel.dev/blog/posts/llm-judge/):今天的做法大多出自这篇:二元判断、先写 critique、例子从标注里挑。英文,约 1 小时,今天读讲 prompt 的前半部分。
- [Eugene Yan · Evaluating the Effectiveness of LLM-Evaluators](https://eugeneyan.com/writing/llm-evaluators/):把 LLM 评分器的研究梳理了一遍,读里面比较「打分」和「二选一」的那部分。
- [Anthropic · Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):讲给模型评分器留一个「判断不了」的出口,今天的 unknown 就是这个意思。
- [DeepSeek 文档 · JSON Output](https://api-docs.deepseek.com/zh-cn/guides/json_mode):中文,`response_format` 的用法和注意事项(prompt 里要出现 json 字样、要给格式样例)。
- [DeepSeek 文档 · 模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):中文,今天的花费按这里 2026 年 10 月的价格算。
- [pydantic 文档 · JSON](https://docs.pydantic.dev/latest/concepts/json/):`model_validate_json` 的说明,英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1rAbp66Eyi&autoplay=0&high_quality=1" title="怎样设计LLM-as-Judge才能让评分可信" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>酌沧 · 怎样设计LLM-as-Judge才能让评分可信 · 7 分钟。中文讲评分 prompt 的设计要点,看完和今天的 FACTS_PROMPT 逐条对照。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1L14y127ye&autoplay=0&high_quality=1" title="【10分钟论文】使用LLM作为裁判 Judging LLM-as-a-judge with MT-Bench and Chatbot Arena" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>ranchlai · 【10分钟论文】使用LLM作为裁判 Judging LLM-as-a-judge with MT-Bench and Chatbot Arena · 11 分钟。LLM-as-judge 这个说法的出处,今天看前半段它怎么设计评分方式,偏差部分留到 Day 359。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/trfUBIDeI1Y" title="LLM as a Judge: Scaling AI Evaluation Strategies" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>IBM Technology · LLM as a Judge: Scaling AI Evaluation Strategies · 约 6 分钟白板讲解,英文,适合开场先建立概念。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/tqUDjc1HzO4" title="How to Automate AI Evals (Correctly)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hamel Husain · How to Automate AI Evals (Correctly) · 27 分钟。从人工标注走到自动评分器,前半段讲怎么写评分 prompt,后半段是明天的对齐。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 3 章「Evaluation Methodology」里「AI as a Judge」一节:讲 AI 评分的原理、局限和 prompt 写法,英文,约 1 小时。
- Shreya Shankar、Hamel Husain《Evals for AI Engineers》(O'Reilly,2026 年 10 月):讲 LLM-as-a-judge 的章节是今天的延伸。

### 开源项目与代码

- [langchain-ai/openevals](https://github.com/langchain-ai/openevals):一组现成的评分器 prompt,看它们怎么写判定标准。别直接拿来用,通用评分器没经过你的数据对齐。
- [confident-ai/deepeval](https://github.com/confident-ai/deepeval):里面有 G-Eval 等打分式指标的实现,对比它和今天这种「为一个失败模式定制的二元评分器」有什么不同。
- [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo):`llm-rubric` 断言可以在配置文件里写评分标准,做 CI 时的另一种选择。

## 自测

1. 实跑里 s5(「我这边直接给您退了」)在打分制下拿了 8 到 9 分,在 v1 二元评分器下被判 fail。两次的差别来自哪两处改动?

<details><summary>答案</summary>

一是给了要点(参考),评分器知道「需要主管审批」是必须传达的;二是把问题从「质量好不好」改成「是否传达了全部要点」这个是非题。打分制下模型按自己的口味判,会觉得「直接退了」是服务好。

</details>

2. 判定标准里为什么要写「换说法、换语言都可以」和「不评价语气、格式、长度」?各举一条今天的样本说明。

<details><summary>答案</summary>

前一句防止评分器要求逐字出现要点,h2(「完整月份」「负责人审核」)和 h9(英文)靠它判 pass。后一句划出不归这个评分器管的范围,h7 语气很冲但要点全对,应该判 pass;语气该由别的评分器管。练习 2 里 deepseek-flash 删掉这句也没变,但它是给换模型、改 prompt 时兜底的。

</details>

3. 下面这段代码运行会怎样?怎么修?

```python
t = '判定:{"verdict": "pass"}\n回复:{reply}'
print(t.format(reply="你好"))
```

<details><summary>答案</summary>

报 `KeyError: '"verdict"'`。`format` 把 `{"verdict": "pass"}` 当成了名叫 `"verdict"` 的占位符。修法是把字面花括号写成两层:`'判定:{{"verdict": "pass"}}\n回复:{reply}'`。

</details>

4. unknown 和 fail 有什么区别?unknown 多了说明什么?

<details><summary>答案</summary>

fail 是「判断了,不合格」;unknown 是「没法判断」,比如回复为空或者根本没回答这个问题。unknown 单独计数,不算进通过率的分子也不算进分母。unknown 一多,说明测试集里混进了不该用这个评分器判的用例,或者 Agent 经常答非所问,都值得去看。

</details>

5. 为什么例子里要有「没逐字说出要点但意思到了」这种?为什么例子不能和验收数据重复?

<details><summary>答案</summary>

一眼能看出对错的例子模型本来就会判,边界例子才是它最拿不准、最需要示范的地方。例子和验收数据重复,评分器等于提前看过答案,验收分数会虚高。今天我的第二个例子和 h6 几乎相同,h6 就失去了检验作用。

</details>

6. (面试题)「你会怎么写一个 LLM-as-judge 的 prompt?」

<details><summary>答案</summary>

要点:先确认这一项代码判不了;一个评分器只判一个失败模式;给评分器参考信息(要点、政策、检索结果),不让它凭常识猜;输出二元结论 pass/fail,外加 unknown 作为判断不了的出口;写清判定标准,包括什么算 pass、什么算 fail、明确不判什么(语气、长度);放几个例子,其中要有边界情况,例子从标注数据的训练部分挑,不和验收数据重复;用标签分隔例子和待判内容;让它先写理由再给结论,输出 JSON,温度 0;代码侧用 schema 校验,失败重试,最后兜底 unknown;prompt 有版本号,改了就要重新和人工标注对齐。

</details>

## 明天预告

Day 358 · LLM-as-judge(三):和人工对齐,TPR、TNR 和 kappa。今天的评分器在我自己写的 10 条上全对,可这 10 条是我写的、我标的,还有一条和例子撞车,说明不了什么。明天拿一批模型生成、你没参与编写的回复,先用一个终端标注工具亲手标 40 条,分成三份;再让评分器判一遍,画混淆矩阵,算 TPR、TNR 和 kappa,看它到底和你有多一致。
