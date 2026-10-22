---
title: 'Day 151 · 结构化输出(五):字段顺序、抽取的坑和 instructor'
description: '同一道退款计算题,只把 reasoning 字段从最后挪到最前,DeepSeek 的正确率从 9/24 变成 24/24;让 7B 小模型从「没写邮箱、没写金额」的工单里抽字段,它填空字符串、填 0、填「未提及」,一个都不肯说没有。再写一个「抽出来的值必须在原文里找得到」的核对函数,最后用 instructor 这个库把 Day 150 手写的 extract() 换成一行,顺带撞上一次真实的依赖冲突。'
pubDate: 2026-10-23
regime: none
tags: ['structured-output', 'pydantic', 'instructor', 'agent-zero']
series: 'agent-zero'
day: 151
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 150](/blog/agent-zero/day-150-structured-4/) 把「生成、校验、带错误重试」写成了 `common/structured.py` 里的 `extract()`:JSON mode 加上写进提示词的 schema,pydantic 校验不过就把报错原文追加进 messages 让模型改,截断时把 `max_tokens` 翻倍,空内容原样重发,超过上限抛 `ExtractionError`。在 7B 小模型上,它把一个会让客户多退 517 元的日期错误挡住了。

但那几天一直有个问题没正面回答:[Day 148](/blog/agent-zero/day-148-structured-2/) 硅基流动按字母序先写 `asked`,日期填错了;[Day 149](/blog/agent-zero/day-149-structured-3/) DeepSeek 照着 schema 的顺序先写 `bought`,就没错。字段的先后到底有多大影响?另外,前几天的工单信息都是齐的,真实工单常常缺东西,缺了模型会怎样?今天把这两件事讲清楚,最后看看有没有现成的库能替我们写 `extract()`。

## 今天要解决的问题

学完今天你应该能做到:

1. 用一个实验说明字段顺序怎么影响结果,能给一份 schema 排出合理的顺序(推理字段在前、判断在后),并说出 OpenAI、Claude、硅基流动、DeepSeek 四家各按什么顺序输出键。
2. 说出抽取任务最常见的三个坑(编造占位值、抄错编号、过度推断),并写一个「抽出来的值必须能在原文里找到」的核对函数。
3. 用 instructor 完成和 `extract()` 一样的事,看懂它实际发出去的提示词和纠错消息,知道它在 DeepSeek 上该用哪种 mode。

预计用时:2.5–3 小时。前置:[Day 150](/blog/agent-zero/day-150-structured-4/)(`common/structured.py` 的 `extract()`)、[Day 149](/blog/agent-zero/day-149-structured-3/)(`RefundFields`、`schema_prompt()`)、[Day 148](/blog/agent-zero/day-148-structured-2/)(`.env.sf`、`schema_format()`、字母序那次事故)、[Day 142](/blog/agent-zero/day-142-prompt-4/)(先想再答)、[Day 106](/blog/agent-zero/day-106-next-token/)(模型一个 token 一个 token 往后猜)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `order_models.py` 的三个类和 `grounding.py` 的核对函数;再做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 第一步:同一道题,只挪一个字段

先回忆 [Day 106](/blog/agent-zero/day-106-next-token/):模型生成文字时,每次只猜下一个 token,猜出来就写下去,写下去就改不了。JSON 也是这么一个字一个字写出来的。所以 JSON 里**先出现的字段,决定了后面字段写的时候「已经想过什么」**。

[Day 142](/blog/agent-zero/day-142-prompt-4/) 用 `<thinking>` 标签让模型先算再答,退款题的正确率明显上去了。结构化输出里也能这么做:在 schema 里放一个 `reasoning` 字段,让模型在里面写计算过程。问题是这个字段放在哪儿。

拿 Day 145 的 8 道退款题(`part02/refund_cases.py` 里的 `CASES`,题目是固定格式的,不考抽取,只考按规则算钱),让模型直接输出应退金额。准备三种 schema:

| 类名 | 字段顺序 | 相当于 |
| --- | --- | --- |
| `AnswerOnly` | `refund` | 直接报数 |
| `AnswerThenReason` | `refund`、`reasoning` | 先报数,再写理由 |
| `ReasonThenAnswer` | `reasoning`、`refund` | 先算,再报数 |

新建 `part02/order_models.py`:

```python
# agent-zero-lab/part02/order_models.py
from pydantic import BaseModel, Field


class AnswerOnly(BaseModel):
    refund: int = Field(description="应退金额,整数,单位元")


class AnswerThenReason(BaseModel):
    refund: int = Field(description="应退金额,整数,单位元")
    reasoning: str = Field(description="计算过程:套餐、相差天数、已用月数、金额、手续费")


class ReasonThenAnswer(BaseModel):
    reasoning: str = Field(description="计算过程:套餐、相差天数、已用月数、金额、手续费")
    refund: int = Field(description="应退金额,整数,单位元")
```

<div class="line-notes">

- `class AnswerOnly(BaseModel):` 只有一个字段,模型写完 `{"refund": ` 就得马上给出数字,中间没有任何计算的机会。
- `refund: int = Field(description="应退金额,整数,单位元")` 三个类里 `refund` 的写法一模一样,唯一变量是它前面有没有 `reasoning`。
- `class AnswerThenReason(BaseModel):` 理由写在答案后面。很多人第一反应是这么排的:「先给结论,再解释」,人写报告也这么写。
- `reasoning: str = Field(description="计算过程:套餐、相差天数、已用月数、金额、手续费")` description 里列出要算的五步,和 Day 142 `<thinking>` 标签里要求的一样,让三组只差顺序。
- `class ReasonThenAnswer(BaseModel):` 两个字段一个不少,只是换了位置。pydantic 生成 schema 时 `properties` 的顺序就是类里写的顺序,Day 149 看过。

</div>

再写跑实验的脚本。每种 schema 在 8 道题上各跑 3 轮,用 Day 150 的 `extract()` 抽,对比 `refund` 和人算的标准答案。新建 `part02/field_order.py`:

```python
# agent-zero-lab/part02/field_order.py
import logging

from common.llm import LLMClient
from common.structured import ExtractionError, extract
from part02.order_models import AnswerOnly, AnswerThenReason, ReasonThenAnswer
from part02.refund_cases import CASES, POLICY

logging.basicConfig(level=logging.WARNING, format="  %(levelname)s %(message)s")
ROUNDS = 3


def main() -> None:
    client = LLMClient()
    for model in (AnswerOnly, AnswerThenReason, ReasonThenAnswer):
        print(f"== {model.__name__}: {list(model.model_fields)}")
        before_cost = client.ledger.cost
        before_out = client.ledger.completion_tokens
        right = 0
        for _ in range(ROUNDS):
            for ticket, gold in CASES:
                try:
                    info = extract(client, model, POLICY, ticket, max_tokens=800)
                except ExtractionError:
                    info = None
                got = info.refund if info else None
                if got == gold:
                    right += 1
                elif _ == 0:
                    print(f"  [{model.__name__}] {ticket[:24]}… 应为 {gold},得到 {got}")
                    if isinstance(info, AnswerThenReason):
                        print(f"      reasoning 结尾: …{info.reasoning[-60:]}")
        out = client.ledger.completion_tokens - before_out
        cost = client.ledger.cost - before_cost
        print(f"{model.__name__}: 对 {right}/{ROUNDS * len(CASES)}  输出 {out} token  ¥{cost:.4f}")
    print(client.ledger)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from common.structured import ExtractionError, extract` Day 150 写的通用抽取函数,今天第一次在别的任务上用它。它不关心类里是退款字段还是计算结果,传什么类就按什么类的 schema 抽。
- `from part02.refund_cases import CASES, POLICY` `POLICY` 是 Day 142 写的四条退款规则原文,`CASES` 是 8 道题和人手算的答案,比如第 1 题「年付,实付 2388 元,2026-09-01 购买,2026-10-20 申请退款」答案 1871。
- `logging.basicConfig(level=logging.WARNING, format="  %(levelname)s %(message)s")` `extract()` 里截断、校验失败会打 WARNING 日志,这里配好格式,前面加两个空格,和其他输出对齐。
- `client = LLMClient()` 用默认的 `.env`,也就是 DeepSeek 官方的 `deepseek-flash`,思考模式关着(`LLM_EXTRA_BODY` 里写的)。思考模式开着的话模型会在 `reasoning_content` 里先想,schema 里的顺序就看不出差别了。
- `for model in (AnswerOnly, AnswerThenReason, ReasonThenAnswer):` 三个类轮流上。
- `print(f"== {model.__name__}: {list(model.model_fields)}")` `model_fields` 是 pydantic 类上的字典,键是字段名,按定义顺序排。`list()` 只取键,实跑打印 `['reasoning', 'refund']` 这样的列表,确认顺序没写反。
- `before_cost = client.ledger.cost` 三组共用一个客户端,记下开始前的花费和输出 token,结束时相减就是这一组的。
- `info = extract(client, model, POLICY, ticket, max_tokens=800)` 指令就是退款规则原文,工单当 user 消息。`max_tokens` 给 800,因为 `reasoning` 要写一段计算过程,Day 150 默认的 500 不一定够。
- `except ExtractionError:` 重试 2 次还不行就记成 `None`,算错。今天这一轮没有走到这里。
- `got = info.refund if info else None` 三元表达式,相当于 JS 的 `info ? info.refund : null`。三个类都有 `refund`,所以编辑器不会画红线。
- `elif _ == 0:` 循环变量 `_` 是第几轮(0、1、2)。只在第一轮打印错题,不然同一道题会打三遍。
- `if isinstance(info, AnswerThenReason):` 只给「先报数再写理由」这组多打一行,看它的理由最后算出了什么。
- `print(f"      reasoning 结尾: …{info.reasoning[-60:]}")` `[-60:]` 取最后 60 个字符(Day 15 的切片),计算结论通常在最后。

</div>

在 `agent-zero-lab` 根目录运行(`-u` 让 print 立刻输出,日志和结果的先后顺序才对得上):

```bash
cd ~/agent-zero-lab
uv run python -u -m part02.field_order
```

我的输出(2026-10-23,DeepSeek 官方 `deepseek-flash`,关思考):

```text
== AnswerOnly: ['refund']
  [AnswerOnly] 年付,实付 2388 元,2026-09-01 … 应为 1871,得到 2388
  [AnswerOnly] 年付,实付 2188 元,2026-01-15 … 应为 1200,得到 913
  [AnswerOnly] 年付,实付 3588 元,2026-02-20 … 应为 2811,得到 3588
  [AnswerOnly] 年付,实付 960 元,2025-12-05 购… 应为 226,得到 280
  [AnswerOnly] 年付,实付 1788 元,2026-04-12 … 应为 1261,得到 1341
AnswerOnly: 对 9/24  输出 170 token  ¥0.0085
== AnswerThenReason: ['refund', 'reasoning']
  [AnswerThenReason] 年付,实付 2388 元,2026-09-01 … 应为 1871,得到 2388
      reasoning 结尾: …1990元；扣6%手续费：1990×6%=119.4元，1990−119.4=1870.6元，四舍五入到元为1871元。
  [AnswerThenReason] 年付,实付 2188 元,2026-01-15 … 应为 1200,得到 1274
      reasoning 结尾: …已用月数5，退款金额2188/12*7=1276.33，手续费6%即76.58，实退1199.75，四舍五入1200元。
  [AnswerThenReason] 年付,实付 3588 元,2026-02-20 … 应为 2811,得到 3588
      reasoning 结尾: …0元。扣6%手续费：2990×6%=179.4元，退款=2990−179.4=2810.6元，四舍五入到元为2811元。
  [AnswerThenReason] 年付,实付 960 元,2025-12-05 购… 应为 226,得到 280
      reasoning 结尾: …计算：960/12=80，80*(12-9)=240，240*0.94=225.6，四舍五入为226。因此退款226元。
  [AnswerThenReason] 年付,实付 1788 元,2026-04-12 … 应为 1261,得到 1341
      reasoning 结尾: …元。扣6%手续费：1341×6%=80.46元，退款=1341−80.46=1260.54元，四舍五入到元为1261元。
AnswerThenReason: 对 9/24  输出 3530 token  ¥0.0375
== ReasonThenAnswer: ['reasoning', 'refund']
ReasonThenAnswer: 对 24/24  输出 2681 token  ¥0.0307
72 次调用 | 输入 21846 / 输出 6381 tokens | 约 ¥0.0767
```

三组的差别一目了然。

**直接报数:9/24。** 第 1 题 49 天,早过了 30 天全额退的线,模型报了全额 2388。第 2 题报了 913,这个数和任何一步计算都对不上,就是猜的。只靠「一眼看过去」,8 道题里稳定答对的只有月付、30 天内这几道简单的。

**先报数再写理由:还是 9/24。** 这组最值得看。打印出来的 `reasoning` 结尾,五道错题里**每一道的理由都算出了正确答案**:1871、1200、2811、226、1261,和标准答案一个不差。可 `refund` 字段早就写好了 2388、1274、3588……模型先猜了一个数,再一步步算出正确的数,但前面那个数已经写下去改不回来了。理由和答案自相矛盾,程序只读 `refund`,错的那个。

**先算再报数:24/24。** 写到 `refund` 的时候,前面 `reasoning` 里已经算出了 1871,接着往下写的最可能的 token 就是 1871。

花费也有意思:先报数再写理由那组输出 3530 token,比先算再报数的 2681 还多,钱多花了,结果一点没变好。理由放在后面,只是给错误答案配了一段「解释」,对答案本身没有任何帮助。

我前后跑了三次这个脚本(前两次是调格式),三组的成绩分别是 9、9、9 / 9、10、9 / 24、24、24。中间那组有一次是 10/24,差别来自 temperature=0 下 DeepSeek 也不完全确定([Day 112](/blog/agent-zero/day-112-sampling-2/) 讲过),不影响结论。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="字段顺序影响生成:先写 refund 时还没算,先写 reasoning 时已经算过">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<text x="20" y="28" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">AnswerThenReason:先报数</text>
<rect x="20" y="40" width="120" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="62" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">{"refund":</text>
<rect x="150" y="40" width="70" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="162" y="62" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">2388</text>
<rect x="230" y="40" width="390" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="240" y="62" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">,"reasoning":"49 天…已用 2 个月…1871"}</text>
<text x="150" y="94" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">↑ 写这里时还一步没算,只能猜</text>
<text x="400" y="94" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">↑ 算对了,但已经晚了</text>
<line x1="20" y1="118" x2="620" y2="118" stroke="var(--rule)"/>
<text x="20" y="146" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">ReasonThenAnswer:先算</text>
<rect x="20" y="158" width="400" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="180" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">{"reasoning":"49 天…已用 2 个月…1871",</text>
<rect x="430" y="158" width="100" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="440" y="180" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">"refund":</text>
<rect x="540" y="158" width="80" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="555" y="180" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">1871}</text>
<text x="20" y="214" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">从左往右生成 →  写到 refund 时,前面已经有算好的 1871 可以「照抄」</text>
<text x="20" y="236" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">实测:前者 9/24,后者 24/24(DeepSeek deepseek-flash,关思考)</text>
</svg>
<figcaption>模型从左往右一个 token 一个 token 写 JSON。答案字段在前,写它的时候什么都还没算;推理字段在前,答案字段就能接着推理的结论写。</figcaption>
</figure>

这和 Day 148 的字母序事故是同一回事,只是换了个方向:那次是 `asked` 排在 `bought` 前面,模型还没「意识到」有两个日期,就把第一个看到的日期填进去了。**模型写某个字段时,只能用到它前面已经写出来的东西。**

## 第二步:谁决定键的顺序

上面的实验之所以能按我们排的顺序走,是因为 `extract()` 把 schema 写进了提示词,DeepSeek 照着提示词里的顺序写。换一种方式、换一家厂商,顺序就不一定由你说了算。这几天查到和测到的:

| 厂商 / 方式 | 输出键的顺序 | 出处 |
| --- | --- | --- |
| OpenAI Structured Outputs | 按 schema 里的顺序 | 官方文档「Key ordering」一节 |
| Claude 结构化输出 | 按 schema 顺序,但**必填字段先出,可选字段后出** | 官方文档「Property ordering」一节 |
| 硅基流动 `json_schema` | 字母序 | 文档没写,Day 148 练习 3 实测 |
| DeepSeek JSON mode + schema 写进提示词 | 模型自己照着提示词写,今天这个实验里都按 schema 顺序 | 实测 |

OpenAI 文档的原话是「outputs will be produced in the same order as the ordering of keys in the schema」。Claude 文档的原话是「required properties appear first, followed by optional properties」,还专门建议:顺序重要的话就把字段都设成必填。

所以排字段时有几条可以直接照做的规矩:

- **推理、分析类字段放最前面,而且设成必填。** 必填是为了 Claude 那种「可选的挪到后面」的规则不把它挪走。
- **综合性的字段放在具体字段后面。** 比如 `summary`(一句话概括)放在 `order_id`、`email`、`amount` 后面,模型先把细节一个个抽出来,写概括时就有东西可依。
- **字段名本身就是提示。** [Day 148](/blog/agent-zero/day-148-structured-2/) 练习 3 里,字段叫 `apple`、说明写「随便写一个城市」,模型照样填了「苹果」。`refund_requested_date` 比 `asked` 清楚得多,名字长一点无所谓。
- **换厂商、换方式后,先打印一次原始输出看键的顺序。** 动手练习 1 就是一个例子:同样的 `AnswerThenReason`,拿到硅基流动用 schema 约束跑,因为字母序 `reasoning` 排在 `refund` 前面,反而「歪打正着」。

还有一个取舍:推理字段会多花输出 token(上面每题多了 100 多个),而且推理内容通常没人看。如果模型本身就有思考模式(DeepSeek 的 thinking、Claude 的 extended thinking),可以让它在思考里想,schema 里就不用放 `reasoning`。但思考模式的 token 一般更多,Day 148 关掉思考省了三倍多的钱。哪个划算,用你自己的评测集量一下。

有一篇论文值得知道:Tam 等人 2024 年的《Let Me Speak Freely?》测了格式限制对推理任务的影响,结论是限制格式会让推理变差;后来做约束解码的 .txt 团队写了《Say What You Mean》反驳,说主要差别来自提示词写法和字段设计。两边各有道理,今天的实验至少说明一点:**只要留出先推理的位置,结构化输出照样能推理对**。

## 第三步:信息不全时,模型会怎么填

前几天的工单信息都是全的。真实工单经常缺东西:没写邮箱、没写金额、根本不是退款。这时候模型最常见的毛病不是格式,而是不肯说「没有」。

换一组专门挑的工单,新建 `part02/pitfall_tickets.py`:

```python
# agent-zero-lab/part02/pitfall_tickets.py
# 专门挑会让模型「编」和「抄错」的工单
PITFALL: list[str] = [
    "发票 INV-2026-004417 被重复扣款了两次,麻烦处理一下。",
    "上个月被扣了两次钱,我只要退多扣的那一次。账号是 lin.wei@cloudmail.cn",
    "订单 CL-20261020-0000731942 申请退款,另一张 CL-20261020-0000731924 不用动。",
    "你好,我想问一下年付能不能开专票?",
]
```

<div class="line-notes">

- `"发票 INV-2026-004417 被重复扣款了两次` 有发票号,没有邮箱,没有金额。
- `"上个月被扣了两次钱,我只要退多扣的那一次。` 有邮箱,没有订单号,金额也没写,只说「多扣的那一次」。模型很容易自己推一个金额出来。
- `"订单 CL-20261020-0000731942 申请退款,` 两个长编号只差最后两位顺序(`42` 和 `24`),一个要退一个不要动。
- `"你好,我想问一下年付能不能开专票?"` 根本不是退款,订单号、邮箱、金额全都没有。「专票」是增值税专用发票,和普通发票不是一回事。

</div>

两个版本的 schema。第一个是很多人第一次写的样子,四个字段全必填、类型写死;第二个允许 `null`,说明里写清「没有就填 null」。新建 `part02/pitfall_models.py`:

```python
# agent-zero-lab/part02/pitfall_models.py
from pydantic import BaseModel, Field


class TicketStrict(BaseModel):
    order_id: str = Field(description="工单里提到的发票号或订单号")
    email: str = Field(description="客户邮箱")
    amount: int = Field(description="客户要求退款的金额,单位元")
    summary: str = Field(description="一句话概括客户诉求")


class TicketNullable(BaseModel):
    order_id: str | None = Field(description="客户要处理的那张发票号或订单号,逐字符原样抄写;没有就填 null")
    email: str | None = Field(description="客户邮箱,原文里没有就填 null")
    amount: int | None = Field(description="客户明确写出的退款金额,单位元;原文没写数字就填 null,不要推算")
    summary: str = Field(description="一句话概括客户的原话,不要补充原文没有的信息")
```

<div class="line-notes">

- `class TicketStrict(BaseModel):` 四个字段都是必填,类型里没有 `None`,模型没有任何办法表达「没有」。
- `order_id: str = Field(description="工单里提到的发票号或订单号")` 发票号、订单号合成一个字段,省得字段太多。
- `amount: int = Field(description="客户要求退款的金额,单位元")` 「要求退款的金额」没说「原文写的」,给了模型推算的空间。
- `summary: str = Field(description="一句话概括客户诉求")` 按第二步说的规矩,概括放在最后。
- `class TicketNullable(BaseModel):` 字段名和顺序都不变,只改类型和说明。
- `order_id: str | None = Field(description="客户要处理的那张发票号或订单号,逐字符原样抄写;没有就填 null")` `str | None` 相当于 TS 的 `string | null`。没给默认值,所以它仍然是必填:模型必须写出 `order_id` 这个键,值可以是 `null`([Day 149](/blog/agent-zero/day-149-structured-3/) 练习 3 讲过这种写法)。「客户要处理的那张」是为第 3 张工单写的。
- `amount: int | None = Field(description="客户明确写出的退款金额,单位元;原文没写数字就填 null,不要推算")` 把「明确写出」「不要推算」写死。
- `summary: str = Field(description="一句话概括客户的原话,不要补充原文没有的信息")` `summary` 总能写出来,不需要 `None`。

</div>

用 Day 150 的小模型跑,它更容易露出毛病。新建 `part02/pitfall_run.py`:

```python
# agent-zero-lab/part02/pitfall_run.py
from common.llm import LLMClient
from common.structured import ExtractionError, extract
from part02.pitfall_models import TicketNullable, TicketStrict
from part02.pitfall_tickets import PITFALL

ASK = "从客户工单里抽取信息。"


def main() -> None:
    client = LLMClient(env_file=".env.sf", model="Qwen/Qwen2.5-7B-Instruct")
    for model in (TicketStrict, TicketNullable):
        print(f"== {model.__name__}")
        for ticket in PITFALL:
            try:
                info = extract(client, model, ASK, ticket)
            except ExtractionError as e:
                print("  放弃:", e)
                continue
            print(" ", info.model_dump())
    print(client.ledger)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `ASK = "从客户工单里抽取信息。"` 指令故意写得很短,要求全放在字段说明里,看两种 schema 的差别。
- `client = LLMClient(env_file=".env.sf", model="Qwen/Qwen2.5-7B-Instruct")` 和 Day 150 一样,硅基流动上的 70 亿参数小模型,`model=` 覆盖 `.env.sf` 里的模型名。钱还是按 `.env.sf` 里 V4 Flash 的价格记,只会算多。
- `info = extract(client, model, ASK, ticket)` 默认最多重试 2 次。
- `print(" ", info.model_dump())` `model_dump()` 把 pydantic 对象转成普通字典,打印出来能直接看到 `None`、`''`、`0` 这些值。

</div>

```bash
uv run python -m part02.pitfall_run
```

我的输出(2026-10-23,硅基流动 Qwen2.5-7B-Instruct):

```text
== TicketStrict
  {'order_id': 'INV-2026-004417', 'email': '', 'amount': 0, 'summary': '请求处理发票重复扣款问题'}
  {'order_id': '未提及', 'email': 'lin.wei@cloudmail.cn', 'amount': 0, 'summary': '客户只希望退款被多扣的一次费用'}
  {'order_id': 'CL-20261020-0000731942', 'email': '', 'amount': 0, 'summary': '只申请一张订单退款'}
第 1 次校验失败:['Field required', 'Field required', 'Field required', 'Field required']
第 2 次校验失败:['Field required', 'Field required', 'Field required', 'Field required']
  {'order_id': '', 'email': '', 'amount': 0, 'summary': '询问年付是否能开发票'}
== TicketNullable
  {'order_id': 'INV-2026-004417', 'email': None, 'amount': None, 'summary': '发票 INV-2026-004417 被重复扣款了两次,麻烦处理一下'}
  {'order_id': None, 'email': 'lin.wei@cloudmail.cn', 'amount': None, 'summary': '上个月被扣了两次钱,我只要退多扣的那一次'}
  {'order_id': 'CL-20261020-0000731942', 'email': None, 'amount': None, 'summary': '订单 CL-20261020-0000731942 申请退款,另一张 CL-20261020-0000731924 不用动'}
  {'order_id': None, 'email': None, 'amount': None, 'summary': '我想问一下年付能不能开专票'}
10 次调用 | 输入 3009 / 输出 392 tokens | 约 ¥0.0126
```

(两行「校验失败」没有 `WARNING` 前缀,因为这个脚本没配 `logging.basicConfig`,Python 只把消息原文打出来,Day 150 练习 2 见过。)

**必填版每一张都「填满」了,而且全是假的。** 没有邮箱就填 `''`,没有金额就填 `0`,没有订单号就填 `'未提及'`。格式全对,pydantic 一个都没拦住:`''` 是合法的 `str`,`0` 是合法的 `int`,`'未提及'` 也是合法的 `str`。

这里最危险的是 `amount: 0`。空字符串至少一眼能看出是空的,0 却是一个正常的金额。下游代码拿到 `amount=0`,很可能真的发起一笔 0 元退款,或者在报表里记一条「客户要求退 0 元」。

**第 4 张工单重试了两次。** 两次「Field required」,四个字段全缺。我单独把这张工单发了一次,看它第一次到底写了什么,原始输出是:

```text
{}
```

一个空对象。这其实是模型最诚实的回答:工单里什么都没有,它就什么都不写。可 schema 要求四个字段必填,校验失败,`extract()` 把报错喂回去,模型只好用 `''` 和 `0` 把坑填上。**带错误重试在这里帮了倒忙**:它把一个诚实的「没有」改成了一个看起来合法的假答案。

**`summary` 里也有一处小走样**:「开专票」被概括成了「开发票」。专票和普票在财务上是两件事,客服按「开发票」回复就答偏了。这就是「过度概括」:模型用一个更常见的词替换了原文里的关键信息。

**允许 null 的版本好得多。** 四张工单里,没写的字段全是 `None`,一次重试都没有。第 2 张工单「我只要退多扣的那一次」,`amount` 也老老实实是 `None`,没有推出一个 199 或 299。代价是 `summary` 基本就是把原文抄了一遍,因为说明里写了「概括客户的原话,不要补充」。想要更短的概括,要在说明里写长度要求。

两个版本对比下来,结论很直接:**schema 里一定要给模型说「没有」的出口**,也就是把可能缺的字段写成 `X | None`,说明里写「原文没有就填 null」。这比写多少句「请不要编造」都管用。

## 第四步:抽出来的值,原文里得找得到

允许 null 能挡住一大类编造,但挡不住全部。还有一种情况是模型抄错了:订单号少一个 0、两位数字换了位置。[Day 107](/blog/agent-zero/day-107-tokens-1/) 讲过,长编号会被切成很多个 token,模型是一段一段「抄」的,中间错一个 token 就错了。

说句实话:这个坑我这次没能稳定复现。我另外拿 5 个更长、更乱的编号(28 位的流水号、带 `0OO1-L1I7` 这种易混字符的工单号等)让 7B 小模型抽了 15 次,一次都没抄错。但「这次没错」不等于「不会错」,而且检查它几乎不花钱:**抽出来的编号、邮箱这类「抄写型」字段,必须能在原文里原样找到**。找不到就说明它是编的或者抄错的。

金额也能查个大概:原文里出现过的数字就那么几个,抽出来的金额不在里面,就是推算出来的。

新建 `part02/grounding.py`:

```python
# agent-zero-lab/part02/grounding.py
import re

from part02.pitfall_models import TicketNullable, TicketStrict
from part02.pitfall_tickets import PITFALL


def grounding_problems(info: TicketStrict | TicketNullable, source: str) -> list[str]:
    """抽出来的值必须能在原文里找到;返回问题清单,空列表表示没问题。"""
    problems: list[str] = []
    for name in ("order_id", "email"):
        value = getattr(info, name)
        if value is None:
            continue
        if value == "" or value not in source:
            problems.append(f"{name}={value!r} 在原文里找不到")
    numbers = [int(n) for n in re.findall(r"\d+", source.replace(",", ""))]
    if info.amount is not None and info.amount not in numbers:
        problems.append(f"amount={info.amount} 原文里没有这个数")
    return problems


if __name__ == "__main__":
    # Day 151 第三步 pitfall_run.py 实跑时 TicketStrict 的前三条输出
    strict_outputs = [
        {"order_id": "INV-2026-004417", "email": "", "amount": 0, "summary": "请求处理发票重复扣款问题"},
        {"order_id": "未提及", "email": "lin.wei@cloudmail.cn", "amount": 0, "summary": "客户只希望退款被多扣的一次费用"},
        {"order_id": "CL-20261020-0000731942", "email": "", "amount": 0, "summary": "只申请一张订单退款"},
    ]
    for ticket, raw in zip(PITFALL, strict_outputs):
        info = TicketStrict.model_validate(raw)
        print(ticket[:20], "→", grounding_problems(info, ticket) or "没问题")
    ok = TicketNullable.model_validate(
        {"order_id": "CL-20261020-0000731942", "email": None, "amount": None, "summary": "订单申请退款"}
    )
    print("Nullable 第 3 张 →", grounding_problems(ok, PITFALL[2]) or "没问题")
    typo = ok.model_copy(update={"order_id": "CL-20261020-000731942"})
    print("少抄一个 0 →", grounding_problems(typo, PITFALL[2]))
```

<div class="line-notes">

- `import re` 正则([Day 1](/blog/agent-zero/day-001-salary-honest/) 用 JS 写过,Python 的 `re` 模块用法类似)。这里只用 `re.findall`。
- `def grounding_problems(info: TicketStrict | TicketNullable, source: str) -> list[str]:` 两个类都能传,字段名一样。返回问题清单而不是 `True/False`,出问题时能直接打印、写日志,或者像 Day 150 那样喂回给模型。
- `for name in ("order_id", "email"):` 只查「抄写型」字段。`summary` 是概括,本来就不会在原文里原样出现,没法这么查。
- `value = getattr(info, name)` 按名字取属性,`getattr(info, "email")` 就是 `info.email`,相当于 JS 的 `info[name]`。
- `if value is None:` `None` 是「原文没有」的合法回答,不算问题。
- `if value == "" or value not in source:` 空字符串单独拦一下:`"" in "任何字符串"` 在 Python 里永远是 `True`(空串是任何字符串的子串),不单独判断就会被放过。`not in` 是子串检查,相当于 JS 的 `!source.includes(value)`。
- `problems.append(f"{name}={value!r} 在原文里找不到")` `!r` 打印 `repr`,字符串带引号,空字符串会显示成 `''`,一眼能看出来。
- `numbers = [int(n) for n in re.findall(r"\d+", source.replace(",", ""))]` 先去掉千分位逗号(Day 147 的工单里有 `¥3,588`),再找出所有连续数字,转成整数列表。第 1 张工单得到 `[2026, 4417]`(`004417` 转成整数是 4417)。
- `if info.amount is not None and info.amount not in numbers:` 金额不在原文数字里,就是推出来或编出来的。这只是粗查:原文写「两千三百八十八」这种中文数字就会误报,真实项目要再加一步中文数字转换。
- `strict_outputs = [` 直接用第三步实跑出来的结果当数据,不再调模型,这个脚本不花钱。
- `for ticket, raw in zip(PITFALL, strict_outputs):` `zip` 把两个列表按位置配对,相当于同时遍历两个数组,三条输出配前三张工单(第 4 张多出来,`zip` 按短的那个停)。
- `info = TicketStrict.model_validate(raw)` 从字典建对象,Day 149 学过。
- `ok = TicketNullable.model_validate(` 第三步允许 null 版本第 3 张工单的结果(`summary` 缩短了)。
- `typo = ok.model_copy(update={"order_id": "CL-20261020-000731942"})` `model_copy(update=...)` 复制一份对象并改掉指定字段,原对象不变。这里人为造一个「少抄一个 0」的错误,看核对能不能抓到。

</div>

```bash
uv run python -m part02.grounding
```

输出:

```text
发票 INV-2026-004417 被 → ["email='' 在原文里找不到", 'amount=0 原文里没有这个数']
上个月被扣了两次钱,我只要退多扣的那一次 → ["order_id='未提及' 在原文里找不到", 'amount=0 原文里没有这个数']
订单 CL-20261020-00007 → ["email='' 在原文里找不到", 'amount=0 原文里没有这个数']
Nullable 第 3 张 → 没问题
少抄一个 0 → ["order_id='CL-20261020-000731942' 在原文里找不到"]
```

必填版的三条输出,每条都查出两个问题,`''`、`0`、`'未提及'` 一个没漏;允许 null 的版本没问题;人为少抄一个 0 也抓到了。

这个检查能接到哪里?最省事的是放在 `extract()` 返回之后:有问题就把这条工单标成「待人工复核」,不让它自动走下去。也可以像 Day 150 那样,把问题清单当报错喂回给模型重试,但要小心第三步那个教训:如果 schema 没给 `null` 的出口,重试只会逼它换一个假值。练习 3 用 instructor 做了这件事。

它也有管不到的地方。第 3 张工单里两个订单号都在原文里,模型如果抽成了「不用动」的那张 `...0731924`,原文核对照样通过。**原文核对只能证明「这个值不是编的」,证明不了「选对了」**。哪张要退、哪张不动,是语义判断,要靠评测集去量(第六部分)。

### schema 太大也是坑

最后一个坑没做实验,说一下经验。一次抽二十个字段,每个字段都要模型分心照顾,准确率会往下掉,输出也更长、更贵、更容易被截断。我的做法是:先问下游真正要用哪几个字段,只抽这几个;字段确实多,就按主题拆成两三次调用(比如「客户身份」一次、「诉求和金额」一次),每次的 schema 都短。拆了以后每次调用的输入里都要带一遍原文,输入 token 会多,这是用钱换准确率,值不值看量出来的数。

## 第五步:用 instructor 一行搞定

Day 150 手写的 `extract()` 一共四十来行。这套「pydantic 类 → schema → 调模型 → 校验 → 带错误重试」太常用了,社区早就做成了库,最有名的是 **instructor**,作者 Jason Liu,GitHub 上在 `567-labs/instructor`。2026 年 10 月查到 PyPI 上最新版是 1.17.0(9 月发布)。

### 先撞一次依赖冲突

按习惯在 `agent-zero-lab` 里装:

```bash
cd ~/agent-zero-lab
uv add instructor
```

我这里直接报错:

```text
  × No solution found when resolving dependencies:
  ╰─▶ Because openai>=3.36.1 depends on jiter>=0.16.0,<1 and instructor>=1.17.0 depends on jiter>=0.6.1,<0.15, we can conclude that instructor>=1.17.0 and openai>=3.36.1 are incompatible.
      And because your project depends on instructor>=1.17.0 and openai>=3.36.1, we can conclude that your project's requirements are unsatisfiable.
```

(报错框线和换行我照终端里的样子整理了一下,文字是原文。)

翻译一下:我们的练习仓库要求 `openai>=3.36.1`(Day 120 装的是当时的最新版),新版 openai 依赖 `jiter` 0.16 以上;而 instructor 1.17.0 要求 `jiter` 低于 0.15。`jiter` 是 pydantic 团队写的 JSON 解析库,两边都依赖它,但要的版本区间没有交集,uv 找不到一组能同时满足的版本,只好报错。

这在前端也常见:npm 装一个插件,它的 `peerDependencies` 要求 React 18,你的项目是 React 19,装不上。uv 比 npm 严格,不会给你装一个「凑合能用」的版本,而是直接拒绝。这其实是好事,装上了运行时才出错更难查。

怎么办?有三个选择:

1. 把练习仓库的 openai 降级到 instructor 能接受的版本。前面所有脚本都要重新验证,不划算。
2. 等 instructor 发新版放宽限制。
3. **单独建一个试用项目**,只在那里装 instructor。

我选第 3 个。instructor 今天只是认识一下,练习仓库的主线还是自己写的 `extract()`。在家目录建一个新项目(和 Day 10 建练习仓库一样的命令):

```bash
cd ~
uv init --no-package instructor-try --python 3.12
cd instructor-try
uv add instructor python-dotenv
cp ~/agent-zero-lab/.env ~/agent-zero-lab/.env.sf .
```

`uv add` 的输出里能看到它为了满足 instructor,选了 `openai==3.3.0` 和 `jiter==0.14.0`,比练习仓库里的老一些,在这个独立项目里互不影响。两份 `.env` 是复制过来的,里面有 key,别忘了 `.gitignore` 也要加上它们([Day 53](/blog/agent-zero/day-053-env-secrets/))。

### 跑一遍 Day 150 的老问题

拿 Day 150 那张让小模型把申请日期写成 2023 年的工单,用 instructor 抽一次,看它会不会自动重试。新建 `~/instructor-try/try_instructor.py`:

```python
# instructor-try/try_instructor.py
import os
from datetime import date
from typing import Literal, Self

import instructor
from dotenv import load_dotenv
from openai import OpenAI
from pydantic import BaseModel, Field, model_validator

load_dotenv(".env.sf")


class RefundChecked(BaseModel):
    """从一张退款工单里抽出的四个字段。"""

    plan: Literal["年付", "月付"] = Field(description="套餐类型")
    paid: int = Field(description="实付金额,单位元")
    bought: date = Field(description="购买日期")
    asked: date = Field(description="申请退款的日期")

    @model_validator(mode="after")
    def asked_not_before_bought(self) -> Self:
        if self.asked < self.bought:
            raise ValueError(f"申请日期 asked={self.asked} 早于购买日期 bought={self.bought},不可能,请对照工单原文重新确认两个日期")
        return self


client = instructor.from_openai(
    OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"]),
    mode=instructor.Mode.JSON,
)


def show_request(*args, **kwargs) -> None:
    msgs = kwargs["messages"]
    print(f"  发出请求:{len(msgs)} 条消息,最后一条 {msgs[-1]['role']}: {msgs[-1]['content'][:70]!r}")


client.on("completion:kwargs", show_request)
client.on("completion:response", lambda r: print("  本次 usage:", r.usage.prompt_tokens, r.usage.completion_tokens))
client.on("parse:error", lambda e: print("  校验失败,instructor 准备重试:", type(e).__name__))

info, completion = client.chat.completions.create_with_completion(
    model="Qwen/Qwen2.5-7B-Instruct",
    response_model=RefundChecked,
    max_retries=2,
    temperature=0,
    messages=[
        {"role": "system", "content": "把客户工单里的套餐类型、实付金额、购买日期、申请日期整理成 JSON。"},
        {"role": "user", "content": "我 2026 年 9 月 1 号买的年费会员,花了 2388,今天 10 月 20 号,想退掉"},
    ],
)
print(repr(info))
u = completion.usage
assert u is not None
print(f"completion.usage:输入 {u.prompt_tokens} 输出 {u.completion_tokens}")
```

<div class="line-notes">

- `import instructor` 整个库的入口。
- `from openai import OpenAI` instructor 不自己发请求,它包住你给的 openai 客户端。
- `load_dotenv(".env.sf")` 这个试用项目里没有 `common/llm.py`,直接用 python-dotenv 读硅基流动的配置([Day 53](/blog/agent-zero/day-053-env-secrets/))。
- `class RefundChecked(BaseModel):` 就是 Day 149 的 `RefundFields` 加上 Day 150 的业务规则,合在一个类里。试用项目没法 import 练习仓库的代码,所以抄了一份。
- `def asked_not_before_bought(self) -> Self:` Day 150 的 `model_validator`,一字未改。instructor 对 pydantic 的 validator 没有任何特殊要求,写的是什么就校验什么。
- `client = instructor.from_openai(` 把 openai 客户端包一层,返回的 `client` 用法和原来几乎一样,只是 `create` 多了 `response_model` 等参数。
- `mode=instructor.Mode.JSON,` 用 JSON mode 加「把 schema 写进提示词」,和我们的 `extract()` 是同一个路子。后面会说为什么不用默认的 mode。
- `def show_request(*args, **kwargs) -> None:` 一个「钩子」函数。instructor 在发请求前会把请求参数传给它,我们只打印消息条数和最后一条消息。`*args, **kwargs` 是 [Day 30](/blog/agent-zero/day-030-functions-3/) 学的可变参数,来什么都接住。
- `client.on("completion:kwargs", show_request)` 注册钩子:每次发请求前调用。`on` 的用法和前端 `addEventListener` / Node 的 `emitter.on` 一样。
- `client.on("completion:response", lambda r: print(` 每次收到响应后调用,打印这一次的 token。
- `client.on("parse:error", lambda e: print(` 每次校验失败时调用。
- `info, completion = client.chat.completions.create_with_completion(` 普通的 `create` 只返回校验好的对象;`create_with_completion` 多返回一个原始响应,能看 usage。
- `response_model=RefundChecked,` 告诉 instructor 要什么类。它负责生成 schema、写进提示词、校验、重试。
- `max_retries=2,` 和 `extract()` 的默认值一样:最多重试 2 次。instructor 自己的默认值是 3。
- `print(repr(info))` 拿到的就是校验过的 `RefundChecked` 对象。
- `u = completion.usage` 下面实跑会看到,这是每次调用加起来的总数。
- `assert u is not None` openai 的类型里 `usage` 可能是 `None`,不加这一行编辑器会在下一行画红线。

</div>

```bash
cd ~/instructor-try
uv run python -u try_instructor.py
```

我的输出(2026-10-23,硅基流动 Qwen2.5-7B-Instruct):

```text
  发出请求:2 条消息,最后一条 user: '我 2026 年 9 月 1 号买的年费会员,花了 2388,今天 10 月 20 号,想退掉'
  本次 usage: 346 54
  校验失败,instructor 准备重试: ValidationError
  发出请求:4 条消息,最后一条 user: 'Correct your JSON ONLY RESPONSE, based on the following errors:\n1 vali'
  本次 usage: 536 54
RefundChecked(plan='年付', paid=2388, bought=datetime.date(2026, 9, 1), asked=datetime.date(2026, 10, 20))
completion.usage:输入 882 输出 108
```

和 Day 150 的 `extract()` 几乎一模一样:第一次 2 条消息,小模型写了 2023 年,校验失败;第二次 4 条消息(多了模型的错误回答和一条纠错消息),改对了。`completion.usage` 是 346 + 536 = 882,两次加起来的。

我又加了一个钩子,把第二次发出去的完整消息存下来看(这个脚本没贴,做法就是在 `completion:kwargs` 钩子里把 `kwargs["messages"]` 写进文件)。system 消息是我们的那句指令,后面被 instructor 拼上了这样一段:

```text
            As a genius expert, your task is to understand the content and provide
            the parsed objects in json that match the following json_schema:


            {
  "description": "从一张退款工单里抽出的四个字段。",
  "properties": {
  ...(中间是完整的 schema,省略)...
  "title": "RefundChecked",
  "type": "object"
}

            Make sure to return an instance of the JSON, not the schema itself
```

第 4 条纠错消息是:

```text
Correct your JSON ONLY RESPONSE, based on the following errors:
1 validation error for RefundChecked
  Value error, 申请日期 asked=2023-10-20 早于购买日期 bought=2026-09-01,不可能,请对照工单原文重新确认两个日期 [type=value_error, input_value={'plan': '年付', 'paid'..., 'asked': '2023-10-20'}, input_type=dict]
    For further information visit https://errors.pydantic.dev/2.14/v/value_error
```

拆开看,instructor 做的和我们的 `extract()` 是同一件事:schema 写进 system(它的措辞是英文的「As a genius expert」),错误回答放回去,再加一条带 pydantic 报错原文的 user 消息。区别只在措辞,以及它把 schema 用 `indent` 排版了,输入 token 比我们的紧凑版多一些。

**这就是今天学 instructor 最重要的收获:库不神秘。** 你 Day 150 自己写过一遍,现在打开它的源码、看它的请求,每一步都认得。面试官问「instructor 是怎么工作的」,你能说出 mode、重试消息长什么样、token 怎么累计,比只会调库的人强很多。

### 选对 mode

instructor 支持很多种 mode,决定「怎么让模型输出 JSON」。在 DeepSeek 官方上我试了三种(脚本就是把上面的 `.env.sf` 换成 `.env`、模型名换成 `deepseek-flash`、再改 `mode=` 那一行):

| mode | 做法 | DeepSeek 官方实测 |
| --- | --- | --- |
| `Mode.JSON` | JSON mode + schema 写进提示词 | 成功,一次过,输入 354 / 输出 30 token |
| `Mode.TOOLS` | 把 schema 包装成一个工具,让模型「调用」它 | 成功,一次过,输入 453 / 输出 94 token |
| `Mode.JSON_SCHEMA` | `response_format` 传 `json_schema` | 报错 400:`This response_format type is unavailable now` |

第三行和 [Day 148](/blog/agent-zero/day-148-structured-2/) 的结论一致:DeepSeek 官方不支持 `json_schema`。`Mode.TOOLS` 能用,它借用的是工具调用(function calling)的通道,模型把参数当 JSON 写出来,第三部分会专门讲。在 DeepSeek 上我选 `Mode.JSON`,token 最少;在 OpenAI 这种支持 strict schema 的厂商上,选 `Mode.JSON_SCHEMA` 或 `Mode.TOOLS` 能让服务端约束格式。

### 自己写还是用库

| | 我们的 `extract()` | instructor |
| --- | --- | --- |
| 代码量 | 四十来行,自己维护 | 一行 `create(...)` |
| 重试的消息 | 中文,自己定措辞 | 英文固定措辞,可以改但要读源码 |
| 截断、空内容 | 分开处理(翻倍 `max_tokens`、原样重发) | 都当成校验失败重试 |
| 支持的厂商 | 只要是 OpenAI 兼容协议 | 十几家,包括 Anthropic、Gemini 原生接口 |
| 依赖 | 只有 openai、pydantic | 多一个库,今天就撞上了版本冲突 |
| 流式出半截对象、批处理 | 没有 | 有 |

我的看法:这门课里继续用自己的 `extract()`,因为每一行都看得见、改得动,后面工具调用、Agent 循环也要用同样的思路。工作中如果团队已经在用 instructor,或者要对接很多家厂商,用它省事;但一定要像今天这样把钩子打开看一次它到底发了什么,别让它在你看不见的地方替你多花钱。

## 动手练习

练习 1 调 8 次硅基流动的 V4 Flash,约 2 分钱;练习 2 不调 API;练习 3 调硅基流动的小模型 20 次左右,约 2 分钱。

**练习 1:同一个 `AnswerThenReason`,换到硅基流动用 schema 约束跑。** 用 Day 148 的 `schema_format()` 把 `AnswerThenReason` 的 schema 包成 `json_schema` 发给硅基流动(`.env.sf`,V4 Flash),8 道退款题各跑一次。先猜:正确率和第一步 DeepSeek 上的 9/24 比会怎样?为什么?打印每次输出的前 14 个字符验证你的猜测。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/ex151_sf_order.py
from common.llm import LLMClient
from part02.order_models import AnswerThenReason
from part02.refund_cases import CASES, POLICY
from part02.schema_edge import schema_format


def main() -> None:
    client = LLMClient(env_file=".env.sf")
    schema = AnswerThenReason.model_json_schema()
    schema["additionalProperties"] = False
    right = 0
    for ticket, gold in CASES:
        r = client.chat(
            [{"role": "system", "content": POLICY}, {"role": "user", "content": ticket}],
            temperature=0,
            max_tokens=800,
            response_format=schema_format(schema),
        )
        info = AnswerThenReason.model_validate_json(r.content)
        right += info.refund == gold
        print(f"键顺序 {r.content[:14]!r}…  应为 {gold} 得到 {info.refund}")
    print(f"对 {right}/{len(CASES)}", client.ledger)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from part02.schema_edge import schema_format` Day 148 写的小函数,把一个 schema 字典包成 `{"type": "json_schema", "json_schema": {"name": ..., "strict": True, "schema": ...}}`。
- `schema["additionalProperties"] = False` strict 模式要求每个对象都写这一条。`AnswerThenReason` 没设 `extra="forbid"`,生成的 schema 里没有,这里手动补上(Day 149 讲过两者的对应关系)。
- `response_format=schema_format(schema),` 这次不用 `extract()`,直接走服务端的 schema 约束,键的顺序由硅基流动决定。
- `right += info.refund == gold` 比较结果是 `True/False`,加到整数上会当成 1/0,和 JS 里 `true + 0 === 1` 一样。
- `print(f"键顺序 {r.content[:14]!r}…` 前 14 个字符刚好能看到第一个键是谁。

</div>

```bash
uv run python -u -m part02.ex151_sf_order
```

我的输出(2026-10-23,硅基流动 V4 Flash,白天调用比较慢,8 次跑了两分多钟):

```text
键顺序 '{"reasoning": '…  应为 1871 得到 1871
键顺序 '{"reasoning": '…  应为 0 得到 0
键顺序 '{"reasoning": '…  应为 1188 得到 1188
键顺序 '{"reasoning": '…  应为 1200 得到 1200
键顺序 '{"reasoning": '…  应为 2811 得到 3092
键顺序 '{"reasoning": '…  应为 226 得到 226
键顺序 '{"reasoning": '…  应为 2388 得到 2388
键顺序 '{"reasoning": '…  应为 1261 得到 1261
对 7/8 8 次调用 | 输入 1342 / 输出 1817 tokens | 约 ¥0.0204
```

8 次全是 `reasoning` 打头。类里明明写的是 `refund` 在前,但硅基流动按字母序输出,`rea` 排在 `ref` 前面,模型就先写了推理,正确率从 9/24 那个水平跳到 7/8。错的那道(3588 元、33 天)得到 3092,是推理里算错了已用月数,和顺序无关。

这个结果说明:同一个类,在不同厂商上效果可能完全不同,原因可能只是键的顺序。换厂商以后先打印原始输出看一眼顺序,别假设它按你写的来。

</details>

**练习 2:子串检查的漏洞。** `grounding.py` 用 `value not in source` 判断编号在不在原文里。构造一个明明抄错了、却能通过子串检查的订单号(提示:抄少最后一位)。再写一个更严格的检查:先用正则把原文里所有「像编号的东西」找出来,要求抽出来的编号必须和其中某一个**完全相等**。拿第 3 张工单的四个候选值对比两种检查。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/ex151_exact_id.py
import re

from part02.pitfall_tickets import PITFALL

ID_PATTERN = re.compile(r"[A-Z]{2,4}-[0-9A-Z-]*[0-9]")


def ids_in(text: str) -> set[str]:
    return set(ID_PATTERN.findall(text))


def id_ok(value: str, source: str) -> bool:
    return value in ids_in(source)


if __name__ == "__main__":
    source = PITFALL[2]
    print("原文里的编号:", sorted(ids_in(source)))
    for value in ("CL-20261020-0000731942", "CL-20261020-000073194", "CL-20261020-0000731924", "CL-20261020-000731942"):
        print(f"{value:<24} 子串检查 {value in source!s:<5}  整串检查 {id_ok(value, source)}")
```

<div class="line-notes">

- `ID_PATTERN = re.compile(r"[A-Z]{2,4}-[0-9A-Z-]*[0-9]")` 2 到 4 个大写字母开头、一个短横线,后面是数字、大写字母、短横线的组合,最后必须以数字结尾。`re.compile` 先编译好,反复用时快一点。正则是贪婪的,会一直吃到不能再吃为止,所以能拿到完整的编号。
- `return set(ID_PATTERN.findall(text))` 找出所有匹配,放进集合([Day 25](/blog/agent-zero/day-025-sets/))去重。第 3 张工单得到两个编号。
- `return value in ids_in(source)` 注意这里的 `in` 是「集合里有没有这个元素」,要求完全相等;上面 `value in source` 是「字符串里有没有这一段」。同一个 `in`,左右两边类型不同,意思就不同。
- `print(f"{value:<24} 子串检查 {value in source!s:<5}` `:<24` 左对齐占 24 格,让几行对齐;`!s` 先把 `True/False` 转成字符串,再按 `:<5` 补空格。

</div>

```bash
uv run python -m part02.ex151_exact_id
```

输出:

```text
原文里的编号: ['CL-20261020-0000731924', 'CL-20261020-0000731942']
CL-20261020-0000731942   子串检查 True   整串检查 True
CL-20261020-000073194    子串检查 True   整串检查 False
CL-20261020-0000731924   子串检查 True   整串检查 True
CL-20261020-000731942    子串检查 False  整串检查 False
```

第 2 行是答案:少抄了最后一位 `2`,它是原文的一个前缀,子串检查放过了,整串检查拦住了。第 4 行少了一个 0,两种都能拦。

第 3 行是另一个提醒:`...0731924` 是客户说「不用动」的那张,两种检查都通过。原文核对证明不了「选对了」,这一点在第四步说过。

</details>

**练习 3:用 instructor 做原文核对,让它自动重试。** pydantic 的 validator 可以拿到一个「校验上下文」:`model_validator` 的方法多写一个参数 `info: ValidationInfo`,`info.context` 就是调用方传进来的字典。instructor 的 `create()` 有一个 `context=` 参数,会原样传给它。用这个机制写一个 validator:`order_id` 和 `email` 必须在原文里找得到,找不到就报错,让 instructor 带着报错重试。分别用「全必填」和「允许 null」两个版本,在 `PITFALL` 前两张工单上跑,数每张工单调了几次模型。

<details><summary>参考答案</summary>

在 `~/instructor-try` 里新建 `grounded.py`(`PITFALL` 的前两张直接抄过来):

```python
# instructor-try/grounded.py
import os
from typing import Self

import instructor
from dotenv import load_dotenv
from instructor.core.exceptions import InstructorRetryException
from openai import OpenAI
from pydantic import BaseModel, Field, ValidationInfo, model_validator

load_dotenv(".env.sf")

TICKETS = [
    "发票 INV-2026-004417 被重复扣款了两次,麻烦处理一下。",
    "上个月被扣了两次钱,我只要退多扣的那一次。账号是 lin.wei@cloudmail.cn",
]


class Grounded(BaseModel):
    order_id: str = Field(description="工单里提到的发票号或订单号")
    email: str = Field(description="客户邮箱")

    @model_validator(mode="after")
    def must_be_in_source(self, info: ValidationInfo) -> Self:
        source = (info.context or {}).get("source", "")
        for name in ("order_id", "email"):
            value = getattr(self, name)
            if not value or value not in source:
                raise ValueError(f"{name}={value!r} 在工单原文里找不到,只能填原文中逐字出现的内容")
        return self


class GroundedNullable(Grounded):
    order_id: str | None = Field(description="工单里提到的发票号或订单号,没有就填 null")  # pyright: ignore[reportIncompatibleVariableOverride]
    email: str | None = Field(description="客户邮箱,没有就填 null")  # pyright: ignore[reportIncompatibleVariableOverride]

    @model_validator(mode="after")
    def must_be_in_source(self, info: ValidationInfo) -> Self:
        source = (info.context or {}).get("source", "")
        for name in ("order_id", "email"):
            value = getattr(self, name)
            if value is not None and value not in source:
                raise ValueError(f"{name}={value!r} 在工单原文里找不到,原文没有就填 null")
        return self


client = instructor.from_openai(
    OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"]),
    mode=instructor.Mode.JSON,
)
calls = 0


def count(*args: object, **kwargs: object) -> None:
    global calls
    calls += 1


client.on("completion:kwargs", count)

for model in (Grounded, GroundedNullable):
    for ticket in TICKETS:
        calls = 0
        try:
            info = client.chat.completions.create(
                model="Qwen/Qwen2.5-7B-Instruct",
                response_model=model,
                max_retries=2,
                temperature=0,
                context={"source": ticket},
                messages=[
                    {"role": "system", "content": "从客户工单里抽取信息。"},
                    {"role": "user", "content": ticket},
                ],
            )
            print(f"{model.__name__}: {info.model_dump()}  调用 {calls} 次")
        except InstructorRetryException as e:
            print(f"{model.__name__}: 放弃,{e.n_attempts} 次尝试都没过,调用 {calls} 次")
```

<div class="line-notes">

- `from instructor.core.exceptions import InstructorRetryException` 重试用完还没过时 instructor 抛的异常,相当于我们的 `ExtractionError`。它没从 `instructor` 顶层导出,要从这个子模块导入(我第一次写 `instructor.core.InstructorRetryException`,报了 `AttributeError`)。
- `from pydantic import BaseModel, Field, ValidationInfo, model_validator` `ValidationInfo` 是 validator 能拿到的「这次校验的附加信息」,我们只用它的 `context`。
- `def must_be_in_source(self, info: ValidationInfo) -> Self:` 比 Day 150 的 validator 多一个参数。pydantic 看到这个参数,就会把校验信息传进来。
- `source = (info.context or {}).get("source", "")` 调用方没传 `context` 时它是 `None`,`or {}` 兜底成空字典,再取 `source`。
- `if not value or value not in source:` 必填版:空字符串和原文里找不到的都算错。
- `class GroundedNullable(Grounded):` 继承必填版,把两个字段改成可以为 `None`,validator 也重写。
- `# pyright: ignore[reportIncompatibleVariableOverride]` 子类把 `str` 改成 `str | None`,类型检查器认为这违反了「子类能当父类用」的原则(父类保证不是 None,子类却可能是),会画红线。这里是故意的,用注释告诉它别管这一行。更规矩的写法是两个类都从一个只有 validator 的基类继承,练习里先这样。
- `if value is not None and value not in source:` 允许 null 版:`None` 合法,只有「写了值却在原文里找不到」才算错。
- `calls = 0` 用一个全局计数器数每张工单调了几次模型。
- `global calls` 函数里要改外面的变量,必须先声明 `global`,否则 Python 会当成新建一个局部变量。JS 里闭包能直接改外层变量,Python 不行。
- `context={"source": ticket},` instructor 把它原样交给 pydantic 的 `model_validate`,validator 里的 `info.context` 就是它。
- `except InstructorRetryException as e:` `e.n_attempts` 是一共尝试了几次。

</div>

```bash
cd ~/instructor-try
uv run python -u grounded.py
```

我的输出(2026-10-23,硅基流动 Qwen2.5-7B-Instruct):

```text
Max retries exceeded. Total attempts: 3, Last error: 1 validation error for Grounded
  Value error, email='' 在工单原文里找不到,只能填原文中逐字出现的内容 [type=value_error, input_value={'order_id': 'INV-2026-004417', 'email': ''}, input_type=dict]
    For further information visit https://errors.pydantic.dev/2.14/v/value_error
Grounded: 放弃,3 次尝试都没过,调用 3 次
Max retries exceeded. Total attempts: 3, Last error: 1 validation error for Grounded
  Value error, order_id='未提及具体的订单号' 在工单原文里找不到,只能填原文中逐字出现的内容 [type=value_error, input_value={'order_id': '未提及... 'lin.wei@cloudmail.cn'}, input_type=dict]
    For further information visit https://errors.pydantic.dev/2.14/v/value_error
Grounded: 放弃,3 次尝试都没过,调用 3 次
GroundedNullable: {'order_id': 'INV-2026-004417', 'email': None}  调用 1 次
GroundedNullable: {'order_id': None, 'email': 'lin.wei@cloudmail.cn'}  调用 1 次
```

「Max retries exceeded」那几行不是我们打印的,是 instructor 放弃时自己写的日志(走 stderr),里面带着最后一次的报错。

**全必填版两张都放弃了,各调了 3 次。** 原文核对确实起作用了:`email=''`、`order_id='未提及具体的订单号'` 都被拦下来,instructor 带着报错重试了两次。可模型换来换去还是填不出原文里有的值,因为原文里本来就没有。3 次调用的钱花了,什么都没拿到。

**允许 null 的版本两张都一次过。** 没有的字段填 `None`,validator 放行。

这个练习把第三步和第四步连起来了:原文核对加自动重试是好东西,但前提是 schema 给了「没有」的出口。否则重试只是在逼模型从「填占位值」换成「放弃」,花三倍的钱。

</details>

**验收标准:** 能说出第一步三组实验的结果和原因,特别是「理由算对了、答案却错了」那组;能说出四家厂商各按什么顺序输出键;能解释第三步为什么带错误重试会把 `{}` 逼成 `''` 和 `0`,以及允许 null 为什么能解决;能写出 `grounding_problems()` 并说出它管不到的情况;能说清 instructor 的 `Mode.JSON` 实际发出了什么消息。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 字段顺序 | JSON 里各个键被生成的先后。模型从左往右生成,写后面的字段时能用到前面写过的内容,写前面的字段时用不到后面的 |
| 推理字段(reasoning field) | schema 里专门让模型写分析或计算过程的字段,放在判断类字段前面,相当于把 Day 142 的「先想再答」搬进 JSON |
| 占位值 | 模型在不知道答案时填的假值,比如 `''`、`0`、`'未提及'`、`'N/A'`。格式合法,校验拦不住 |
| 原文核对(grounding check) | 检查抽出来的值能不能在原文里找到,用来发现编造和抄错,对编号、邮箱这类「抄写型」字段最有效 |
| 过度推断 / 过度概括 | 模型在原文没说的地方自己补了信息(推出一个金额),或者用更常见的词替换了原文的关键信息(「专票」变「发票」) |
| instructor | 一个 Python 库,把「pydantic 类 → schema → 调模型 → 校验 → 带错误重试」打包成一个 `create(response_model=...)` 调用 |
| mode(instructor) | instructor 让模型输出 JSON 的方式,常用的有 `JSON`(JSON mode + 提示词)、`TOOLS`(借工具调用)、`JSON_SCHEMA`(服务端 schema 约束) |
| 钩子(hook) | 在某个事件发生时被调用的函数。instructor 的 `client.on("completion:kwargs", f)` 在每次发请求前调用 `f`,用法同前端的 `addEventListener` |
| 依赖冲突 | 两个包对同一个依赖要求的版本区间没有交集,包管理器找不到可行解。今天是 openai 要 `jiter>=0.16`、instructor 要 `jiter<0.15` |
| `ValidationInfo.context` | pydantic 校验时调用方额外传进来的字典,validator 可以用它拿到「原文」这种不属于模型字段的信息 |

## 常见误区

**以为「先给结论再解释」对模型也是好习惯。** 人写报告这么写没问题,模型这么写就是先猜一个数。今天「先报数再写理由」那组 5 道错题,理由全算对了,答案全是错的。推理字段放前面。

**以为加了推理字段就一定在前面输出。** Claude 会把可选字段挪到必填字段后面,硅基流动按字母序。推理字段要设成必填,换厂商后打印一次原始输出确认顺序。

**所有字段都设成必填,类型里不留 `None`。** 模型拿不到「没有」的出口,就会填 `''`、`0`、`'未提及'`。`0` 最危险,它是一个合法的金额。可能缺的字段写成 `X | None`,说明里写「原文没有就填 null」。

**以为带错误重试总是好的。** 第 4 张工单模型先诚实地给了 `{}`,被「Field required」逼着重试,最后交出了一份全是占位值的答案。重试之前先想想:schema 有没有给它说「没有」的路。

**用 `value in source` 做编号核对就完事了。** 空字符串是任何字符串的子串,截掉尾巴的编号也是原文的子串。空值单独判断,编号用正则找出来后要求完全相等(练习 2)。

**以为原文核对能证明抽对了。** 它只能证明「这个值原文里有」。两张订单都在原文里时,选错了照样通过。

**看到依赖冲突就去降级主项目的库。** 练习仓库的 openai 一降级,前面几十个脚本都要重新验证。只是试用一个库,单独建一个项目装它。

**用了 instructor 就不管它发了什么。** 它会在 system 里加一段英文提示、用缩进排版的 schema,重试时 token 照样累加。用钩子打印一次请求,知道钱花在哪。

**在 DeepSeek 官方上用 `Mode.JSON_SCHEMA`。** 实测 400「This response_format type is unavailable now」。DeepSeek 用 `Mode.JSON` 或 `Mode.TOOLS`。

## 学习资料

### 文档与文章

- [OpenAI:Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs):英文,页面后半「Key ordering」一节就一句话,说输出按 schema 里键的顺序生成。
- [Claude:结构化输出](https://platform.claude.com/docs/en/build-with-claude/structured-outputs):英文,搜「Property ordering」,看必填在前、可选在后的规则和它给的例子。
- [instructor 文档首页](https://python.useinstructor.com/):英文,首页的例子和今天的 `try_instructor.py` 差不多,先看它。
- [instructor:Hooks](https://python.useinstructor.com/concepts/hooks/):英文,今天用到的 `completion:kwargs`、`completion:response`、`parse:error` 几个事件都在这里。
- [instructor:Re-asking with validation](https://python.useinstructor.com/concepts/reask_validation/):英文,讲 validator 报错怎么变成重试消息,还有用 `context` 把原文传给 validator 的例子,对应练习 3。
- [instructor:DeepSeek 集成](https://python.useinstructor.com/integrations/deepseek/):英文,官方给 DeepSeek 的推荐写法,和今天实测的 mode 结论对照着看。
- [Let Me Speak Freely?(arXiv 2408.02442)](https://arxiv.org/abs/2408.02442):英文论文,测格式限制对推理的影响,看摘要和第一张图就够。
- [.txt:Say What You Mean](https://blog.dottxt.ai/say-what-you-mean.html):英文,做约束解码的团队对上面那篇论文的反驳,讲提示词和字段设计的影响,和今天第一步的实验结论接近。
- [uv:依赖解析](https://docs.astral.sh/uv/concepts/resolution/):英文,讲 uv 怎么找一组能同时满足所有要求的版本,看懂今天那条冲突报错。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ppjF6LEnr&autoplay=0&high_quality=1" title="如何让模型稳定地输出JSON结构？——数据模型 Pydantic" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>懂点AI的H先生 · 如何让模型稳定地输出JSON结构?——数据模型 Pydantic · 8 分钟,2026 年 6 月。用 pydantic 定义输出结构再校验,把 Day 149 到今天的思路串一遍,适合当复习看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1rJ4m1s7Nm&autoplay=0&high_quality=1" title="基于大模型做信息抽取方法介绍" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI大实话 · 基于大模型做信息抽取方法介绍 · 27 分钟,2024 年。讲大模型做信息抽取的几种做法和常见问题,年份早一些,模型名有些过时,但「抽取会编、会漏」的问题今天还在。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/yj-wSRJwrrc" title="Pydantic is all you need: Jason Liu" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · Pydantic is all you need: Jason Liu · 英文。instructor 作者第一次在 AI Engineer 大会上讲这套思路,里面专门讲了用字段顺序和推理字段提升准确率。Day 150 推荐的是他第二年的续篇,两个可以连着看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/xpvFinvqRCA" title="Structured Output from LLMs: Grammars, Regex, and State Machines" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Efficient NLP · Structured Output from LLMs: Grammars, Regex, and State Machines · 英文。讲服务端 schema 约束是怎么在每一步把不合格的 token 划掉的,看完能理解为什么键的顺序是由约束引擎决定的。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 2 章「Structured Outputs」一节,讲到约束采样、后处理和微调几种做法的取舍。O'Reilly 网站对命令行访问返回 403,需浏览器打开。
- 今天这组不需要再加别的书。

### 开源项目与代码

- [567-labs/instructor](https://github.com/567-labs/instructor):今天用的库。源码里搜 `Correct your JSON ONLY RESPONSE` 能找到它拼纠错消息的地方,搜 `As a genius expert` 能找到 `Mode.JSON` 的提示词模板。
- [dottxt-ai/outlines](https://github.com/dottxt-ai/outlines):开源的约束解码库,自己部署模型时用它在本地实现 schema 约束(第十部分自部署时会再见到)。

## 自测

1. 第一步「先报数再写理由」那组,理由都算出了正确答案,为什么 `refund` 还是错的?

<details><summary>答案</summary>

模型从左往右生成,`refund` 在 `reasoning` 前面。写 `refund` 时还一步没算,只能猜一个数;后面在 `reasoning` 里算出了正确答案,但前面写下去的 token 改不回来。程序读的是 `refund`,所以错。

</details>

2. 你给 Claude 写了一个 schema,`reasoning` 是可选字段、放在第一位,`category` 是必填。输出时谁在前?怎么改?

<details><summary>答案</summary>

`category` 在前。Claude 的结构化输出会把必填字段排在可选字段前面。把 `reasoning` 也设成必填,它就会按 schema 里的顺序第一个输出。

</details>

3. 一个字段写成 `amount: int`,工单里没写金额,模型最可能填什么?为什么危险?怎么改?

<details><summary>答案</summary>

最可能填 `0`(今天实测四张工单全是 0)。`0` 是合法的整数,pydantic 拦不住,而且看起来像一个正常金额,下游可能真的按 0 元处理。改成 `amount: int | None`,说明里写「原文没写数字就填 null,不要推算」,并在下游区分 `None` 和 `0`。

</details>

4. `grounding_problems()` 能发现哪些问题,发现不了哪些?

<details><summary>答案</summary>

能发现:抄写型字段(编号、邮箱)填了空字符串、占位词或原文里没有的值;金额不是原文里出现过的数字。发现不了:原文里有多个候选值时选错了一个(两张订单号都在原文里);`summary` 这类概括字段里的过度推断;中文数字写的金额会误报。另外用子串检查时,抄掉尾巴的编号也能通过,要用正则找出完整编号再比较。

</details>

5. 在练习仓库里 `uv add instructor` 报依赖冲突,你会怎么处理?为什么?

<details><summary>答案</summary>

先读报错,找到冲突的是哪个依赖(今天是 openai 新版要 `jiter>=0.16`,instructor 要 `jiter<0.15`)。只是试用的话,单独建一个项目装它,不动主项目;真要在主项目用,就看能不能等 instructor 新版放宽限制,或者评估把 openai 降到兼容版本要重新验证多少代码。不要为了装一个库随手降级主项目的核心依赖。

</details>

6. 面试题:「你用过 instructor 吗?它是怎么保证输出符合 pydantic 模型的?」

<details><summary>答案</summary>

用过,而且自己实现过同样的东西。它包住 openai 客户端,按 mode 决定怎么让模型输出 JSON:`JSON` 是 JSON mode 加把 schema 写进 system 提示词,`TOOLS` 是把 schema 包成一个工具让模型调用,`JSON_SCHEMA` 是用服务端的 schema 约束。拿到回复后用 `response_model` 的 `model_validate` 校验,失败了把模型的错误回答和 pydantic 报错原文作为新消息追加进去,重试到 `max_retries`,还不行就抛 `InstructorRetryException`;usage 是多次调用累加的。它本身不保证值正确,只保证通过校验,所以业务规则要写成 validator,原文核对可以通过 `context` 传原文给 validator。模型选择上要注意厂商支持,比如 DeepSeek 官方不支持 `json_schema`,只能用 `JSON` 或 `TOOLS`。另外我会用它的 hooks 把实际请求打出来,确认 token 花在哪。

</details>

## 明天预告

Day 152 · 小项目(一):命令行聊天机器人,多轮和流式。结构化输出这五天到此为止,明天换个节奏,把第二部分学过的东西拼成一个能用的小工具:用 Day 134 的流式输出一段一段打印回答,用 `Conversation` 管多轮历史,再加几个斜杠命令和出错时的处理。它不需要新知识,难点在于把零件拼起来,并且在 Ctrl+C、断网、key 错这些情况下不把历史弄乱。
