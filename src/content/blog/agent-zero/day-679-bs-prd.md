---
title: 'Day 679 · BillSleuth 开题(二):客户会问的问题,PRD、架构、排期、指标'
description: '先补齐优惠券、税、贷记单三个名词,再把客户的抱怨整理成 13 类根因,做个小实验看清「只听客户原话猜不出根因」;然后写一页 PRD(非目标比功能清单更重要)并用自查脚本守住它,画出架构图,排好 Day 680 到 Day 701 的进度,最后用 15 次假运行把六个验收指标各算一遍。'
pubDate: 2026-10-22
regime: none
tags: ['billsleuth', 'prd', 'billing', 'evals', 'agent-zero']
series: 'agent-zero'
day: 679
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 678](/blog/agent-zero/day-678-week97-review/) 是复习日:默写了 Day 677 的 `prorate`,用一个「整数分」的参照算法在 732 组输入上证明它一分不差;又把 Loupe 的评测思路搬到折算函数上,手算期望值、超时单独记账、算 pass^k、逐条比回归,让评测自己抓出了「分母写死 30」那个候选版本。

[Day 677](/blog/agent-zero/day-677-bs-why/) 开题时只讲了「为什么选计费争议」和两个计费基本功。今天把开题做完:客户到底会问什么、我们做什么不做什么、系统长什么样、22 天怎么排、做完以后拿什么证明它靠得住。这些全部落在一页 PRD 里。昨天小项目里那几条规矩(期望值不能从被测代码里来、基础设施错误单独算、pass^k),今天会原样写进验收指标。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说清楚优惠券、税、贷记单是什么,手算一张「先折扣、后算税」的发票,知道多收了以后为什么是开贷记单而不是改发票。
2. 说出 13 类根因里至少 9 类,每类客户通常怎么说、该查哪张表;并用一个真实的小实验解释为什么 Agent 不能从客户原话直接猜根因。
3. 写出 BillSleuth 的一页 PRD(背景、用户故事、功能、非目标、指标、风险),用自查脚本让它缺节、非目标太少、指标改名时都过不去。
4. 用 15 次假运行把六个验收指标各算一遍,说清楚误冲正率的分母为什么只算「账没错」的场景,pass^3 和 pass@3 差在哪。

预计用时 2.5 小时。前置:[Day 677](/blog/agent-zero/day-677-bs-why/)(计费周期、折算、Decimal)、[Day 437](/blog/agent-zero/day-437-prd/)(SupportPilot 的一页 PRD,今天的结构和它一样)、[Day 651](/blog/agent-zero/day-651-loupe-prd/)(Loupe 的 PRD)、[Day 344](/blog/agent-zero/day-344-eval-concepts/)(pass^k)、[Day 147](/blog/agent-zero/day-147-structured-1/)(JSON 输出)。今天调了两次模型,一共不到 1 分钱,算式在「今天的文件」一节。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 13 类根因和六个验收指标的定义默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先补三个名词:优惠券、税、贷记单

下面那张根因表里,一半的根因跟这三样东西有关。Day 677 没来得及讲,先补上。

**优惠券**(coupon)分两种:按百分比打折(八折就是 percent 20),或者直接减一个金额(减 10 美元)。它有有效期,常见写法是「前 3 个月八折」。客户最常问的一类问题是「我没改套餐,怎么这个月突然涨价了」,答案往往就是优惠期结束了。

**税**按客户所在的地区收,而且税率会调整,所以系统里存的不是「某地区税率是多少」,而是「某地区从哪天到哪天的税率是多少」。我们的规则是:**优惠券作用在小计上,税按折扣之后的金额算**,也就是 (小计 − 折扣) × 税率,舍入到分。各国真实的税务规则复杂得多,这里的地区和税率都是虚构的练习数据,不代表任何地方的真实税法。

**贷记单**(credit note)是这个项目的核心动作。发票一旦开出就是会计凭证,不能改。多收了钱,正确的做法是另开一张贷记单:「冲减某张发票多少钱、为什么」,然后把钱退回客户的卡,或者留作余额抵扣下一期。贷记单是会计上的凭证,退款是钱怎么回到客户手里,两者不是一回事。前端类比一下:发票像一条已经发出去的 git commit,你不会去改它的历史,而是再提一个 revert commit;贷记单就是那个 revert。

拿 Day 677 那张 7 月发票算一遍,假设客户还有一张「前 3 个月八折」的券,所在地区税率 6%:

```python
# billsleuth/scratch/coupon_tax.py  优惠券、税的先后顺序,和多收以后怎么冲
from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")


def q(x: Decimal) -> Decimal:
    return x.quantize(CENT, rounding=ROUND_HALF_UP)


subtotal = Decimal("342.00")  # Day 677 那张 7 月发票:-58.50 + 133.50 + 267.00
percent_off = Decimal("20")  # 「前 3 个月八折」的券,7 月还在有效期里
rate = Decimal("0.06")  # 虚构地区 CN 的税率 6%

discount = q(subtotal * percent_off / 100)
tax = q((subtotal - discount) * rate)
total = subtotal - discount + tax
print(f"先折扣后算税:小计 {subtotal} 折扣 -{discount} 税 {tax} 合计 {total}")

wrong_tax = q(subtotal * rate)
wrong_total = subtotal - discount + wrong_tax
print(f"错误顺序(税按折扣前算):税 {wrong_tax} 合计 {wrong_total},多收 {wrong_total - total}")
print(f"发票已开出不能改,开一张贷记单冲减 {wrong_total - total}")
```

<div class="line-notes">

- `def q(x: Decimal) -> Decimal:` 舍入到分的小工具,和 Day 677 的 `quantize(CENT, rounding=ROUND_HALF_UP)` 一样,只是起个短名字。明天它会正式变成 `money.py` 里的 `money()`。
- `subtotal = Decimal("342.00")` 小计就是 Day 677 算出来的那三行之和:两行折算加 7 月整月。
- `percent_off = Decimal("20")` 八折存成「减 20%」,和后面表结构里 `coupons.value` 的约定一致(20 表示 20%)。
- `rate = Decimal("0.06")` 税率存小数,0.06 就是 6%。
- `discount = q(subtotal * percent_off / 100)` 342 × 20 / 100 = 68.40。
- `tax = q((subtotal - discount) * rate)` 先减折扣再乘税率:(342 − 68.40) × 0.06 = 16.416,舍入 16.42。
- `total = subtotal - discount + tax` 342.00 − 68.40 + 16.42 = 290.02。
- `wrong_tax = q(subtotal * rate)` 模拟一个常见 bug:税按折扣前的小计算,342 × 0.06 = 20.52。
- `print(f"发票已开出不能改` 多收的部分不去改发票,而是开贷记单冲减。

</div>

```bash
cd billsleuth
uv run python scratch/coupon_tax.py
```

```text
先折扣后算税:小计 342.00 折扣 -68.40 税 16.42 合计 290.02
错误顺序(税按折扣前算):税 20.52 合计 294.12,多收 4.10
发票已开出不能改,开一张贷记单冲减 4.10
```

顺序错一步多收 4.10,客户可能根本注意不到。这类错误在我们的根因表里没有单列(它可以归到「百分比券算错基数」的近亲),写在这里是想让你感受一下:计费里的错,大多数就是这种「某一步的顺序或基数不对、差额很小」的错。

还有一个今天不展开的概念,**催缴**(dunning):扣款失败后按策略重试、发提醒邮件、最终暂停服务。它带来的争议(「卡里明明有钱怎么说我欠费」)也很常见,但要模拟支付网关的行为,我们放进非目标。

## 客户会问的 13 类问题

我把常见的计费争议整理成 12 类根因,再加一类「账没错,是客户误解」。它们就是 [Day 682](/blog/agent-zero/day-682-bs-faults/) 造数据时要注入的故障,也是 Agent 结论里 `root_cause` 字段的取值。名字用英文蛇形写法,因为它们会直接出现在代码和 JSON 里:

| 根因 | 客户通常怎么说 | 该查哪里 |
| --- | --- | --- |
| `proration_wrong_days` 折算分母写死 30 天 | 「这个月怎么比我算的多一点」 | 发票折算行 + 周期天数 |
| `proration_missing_credit` 升级漏了退还行 | 「升级后这张发票贵得离谱」 | 折算行是否成对出现 |
| `duplicate_charge` 同一张发票扣款两次 | 「卡上有两笔一样的扣款」 | 扣款记录 |
| `duplicate_invoice` 同一周期开了两张发票 | 「收到两张一样的发票」 | 同周期的其他发票 |
| `expired_tax_rate` 用了过期税率 | 「税好像不对」 | 税率表的有效期 |
| `wrong_tax_region` 用了别的地区税率 | 「为什么税这么高」 | 客户的税务地区 |
| `coupon_not_applied` 优惠券没抵扣 | 「说好的八折呢」 | 优惠券有效月份 |
| `coupon_wrong_base` 百分比券算错基数 | 「折扣好像少了」 | 折扣行和小计 |
| `quantity_change_ignored` 减席位没生效 | 「减了席位怎么没便宜」 | 订阅事件 + 订阅费行 |
| `cancel_not_respected` 取消后仍扣款 | 「早就取消了还扣钱」 | 取消事件 + 之后的发票 |
| `timezone_change_date` 时区算错日期 | 「这个月好像多算了一点」 | 事件的本地日期 vs 折算起始日 |
| `wrong_plan_price` 单价不对 | 「价格和官网不一样」 | 订阅费行单价 vs 价目表 |
| `no_error` 账没错 | 以上任何一种说法 | 全部核对一遍才能下这个结论 |

最后一行最容易被忽略。一个只会「找错」的 Agent,看到客户抱怨就往有错的方向想,很容易把正确的折算说成多收,然后起草一张不该有的贷记单。这比漏掉一个错误更糟,因为它会真的把钱退出去。所以验收指标里专门有一项「误冲正率」。

再看第二列和第一列的关系:**客户的说法和根因不是一一对应的**。「这个月怎么比我算的多一点」可能是折算分母错、时区错、税率错、单价错,也可能根本没错。下面用模型做个小实验,看看只给客户原话会发生什么。

### 实验:只听客户原话,模型能猜对根因吗

四个场景,前三个客户说的话一字不差,但我们造数时埋的根因不同;第四个是 Day 677 那张 342 美元的发票,账其实没错。只把客户的话和 13 个取值交给模型,让它选一个:

```bash
cd billsleuth
uv add openai python-dotenv
cp ../agent-zero-lab/.env .env
printf '.env\nbilling.db\n.venv/\n__pycache__/\n' > .gitignore
```

<div class="line-notes">

- `uv add openai python-dotenv` 第一次在 BillSleuth 里调模型,装 openai SDK 和读 `.env` 的库。2026 年 10 月查到 PyPI 上分别是 openai 3.36.1、python-dotenv 1.2.4。BillSleuth 是独立仓库,不 import 课程练习仓库里的 `common/llm.py`,直接用 SDK。
- `cp ../agent-zero-lab/.env .env` 复用课程里的 DeepSeek 配置(`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`、`LLM_EXTRA_BODY`)。假设 `billsleuth/` 和 `agent-zero-lab/` 在同一个父目录下,不在的话改路径。
- `printf '.env\nbilling.db\n.venv/\n__pycache__/\n' > .gitignore` 里面有 key 的 `.env` 一定不能提交,所以复制它的同时就建 `.gitignore`。`printf` 会把 `\n` 变成换行,一次写四行。`billing.db` 明天才会出现,先写上。

</div>

```python
# billsleuth/scratch/guess_root_cause.py  只给客户原话,不给数据,让模型猜根因
import json
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
MODEL = os.environ["LLM_MODEL"]

ROOT_CAUSES = [
    "proration_wrong_days", "proration_missing_credit", "duplicate_charge", "duplicate_invoice",
    "expired_tax_rate", "wrong_tax_region", "coupon_not_applied", "coupon_wrong_base",
    "quantity_change_ignored", "cancel_not_respected", "timezone_change_date", "wrong_plan_price", "no_error",
]
# 三个场景客户说的话一模一样,但我们造数时埋的根因不同
SCENARIOS = [
    ("S1", "这个月怎么比我算的多了一点?", "proration_wrong_days"),
    ("S2", "这个月怎么比我算的多了一点?", "timezone_change_date"),
    ("S3", "这个月怎么比我算的多了一点?", "no_error"),
    ("S4", "我平时每月 117 美元,这个月怎么扣了 342?你们是不是多扣了?", "no_error"),
]
SYSTEM = ("你是 SaaS 计费客服。根据客户的话判断账单问题的根因,只能从下面的取值里选一个:"
          + ", ".join(ROOT_CAUSES)
          + '。只输出 JSON:{"root_cause": "...", "confidence": 0 到 1 之间的小数}')


def main() -> None:
    tokens_in = tokens_out = 0
    for sid, quote, truth in SCENARIOS:
        resp = client.chat.completions.create(
            model=MODEL,
            messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": quote}],
            response_format={"type": "json_object"},
            extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY", "{}")),
        )
        guess = json.loads(resp.choices[0].message.content or "{}")
        assert resp.usage is not None
        tokens_in += resp.usage.prompt_tokens
        tokens_out += resp.usage.completion_tokens
        mark = "对" if guess.get("root_cause") == truth else "错"
        print(f"{sid} 真实根因 {truth:<22} 模型猜 {guess.get('root_cause'):<22} 自信 {guess.get('confidence')}  {mark}")
    print(f"输入 {tokens_in} tokens,输出 {tokens_out} tokens")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `load_dotenv()` 把当前目录 `.env` 里的变量读进 `os.environ`,相当于 Node 的 `require('dotenv').config()`。
- `client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])` openai SDK 走 OpenAI 兼容协议连 DeepSeek,[Day 123](/blog/agent-zero/day-123-openai-compatible/) 讲过。
- `MODEL = os.environ["LLM_MODEL"]` 我的 `.env` 里是 `deepseek-flash`。
- `ROOT_CAUSES = [` 13 个取值,和上面那张表一一对应,顺序也一样。这份列表 Day 682 会挪进正式代码。
- `SCENARIOS = [` 每条是 `(场景编号, 客户原话, 真实根因)`。真实根因只用来判对错,不发给模型。
- `("S4", "我平时每月 117 美元` Day 677 那张 342 美元的发票,账是对的,是升级带来的折算。
- `SYSTEM = (` 系统提示:列出可选值,要求只输出 JSON。括号里几段字符串用 `+` 拼起来,跨行时 Python 要求外面包一层括号。
- `response_format={"type": "json_object"},` 让 DeepSeek 保证输出是合法 JSON,[Day 147](/blog/agent-zero/day-147-structured-1/) 讲过 JSON 模式。
- `extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY", "{}")),` 把 `.env` 里的 `{"thinking": {"type": "disabled"}}` 透传给接口,关掉思考模式,省钱也快。
- `guess = json.loads(resp.choices[0].message.content or "{}")` 取模型回复并解析。`or "{}"` 防止内容是 `None` 时 `json.loads` 报错。
- `assert resp.usage is not None` 告诉类型检查器 `usage` 一定有值,下面两行才不会出红线。运行时 DeepSeek 总会返回 usage。
- `print(f"{sid} 真实根因 {truth:<22}` `:<22` 左对齐补到 22 格,让几行对齐。

</div>

```bash
uv run python scratch/guess_root_cause.py
```

```text
S1 真实根因 proration_wrong_days   模型猜 no_error               自信 0.3  错
S2 真实根因 timezone_change_date   模型猜 no_error               自信 0.3  错
S3 真实根因 no_error               模型猜 no_error               自信 0.3  对
S4 真实根因 no_error               模型猜 duplicate_charge       自信 0.4  错
输入 618 tokens,输出 70 tokens
```

四个只对了一个,而且对的那个也是蒙的:三句一模一样的话,它给了一模一样的答案和一模一样的自信 0.3,只是碰巧有一个场景的真实答案就是 `no_error`。S4 更有意思,客户说「是不是多扣了」,它就顺着往「重复扣款」上猜,而那张发票其实一分不差。

这个实验不是在说模型笨,是在说**这个问题本身不能从原话里答出来**,人也不行。根因藏在数据里:看到周期天数和折算行才知道分母对不对,看到事件的本地时间才知道时区对不对。所以 BillSleuth 必须是一个会查数据的 Agent,而不是一个分类器。练习 2 会把发票行和事件一起交给模型,看看结果有什么变化。

## PRD:做什么,不做什么

PRD(Product Requirements Document,产品需求文档)[Day 437](/blog/agent-zero/day-437-prd/) 给 SupportPilot 写过一次,[Day 651](/blog/agent-zero/day-651-loupe-prd/) 给 Loupe 又写了一次。结构不变:一句话、背景、用户故事、功能清单、非目标、验收指标、风险。我习惯控制在一页,放在仓库的 `docs/prd.md`。下面是 BillSleuth 的完整版本:

```markdown
# BillSleuth PRD

一句话:客户问「为什么这个月多扣了钱」,BillSleuth 自己查订阅、发票、扣款和税,复算金额,给出带证据的解释;需要退钱时起草贷记单,交给人批。

## 背景

云簿 CloudLedger(虚构)的计费客服每天收到几十个「多扣钱了」的工单。熟练客服查一单要 15 到 30 分钟,要在订阅、发票、扣款三个后台之间来回翻,还经常算错折算。约五分之一的工单其实账没错,是客户看不懂折算或优惠期结束。

## 用户故事

- 一线客服:我把客户原话和客户编号交给 BillSleuth,一分钟内拿到结论(有没有多收、多收多少、根因)、一段能直接发给客户的回复、一段给同事看的内部说明,每个数字都能点开看出处。
- 计费主管:Agent 起草的贷记单出现在我的审批列表里,附证据链,我批准或驳回;没有我批准,钱不会动。
- 工程师:每次改提示词、换模型、加工具,跑一遍 100 个场景的评测,拿到六个指标和置信区间,知道这次改动是变好还是变坏。

## 功能清单

- 参考计费引擎:按天折算、锚点日、优惠券、税率有效期,算出每张发票的应收
- 100 个带标准答案的争议场景(12 类根因 + 20 个账没错)
- MCP 工具层:6 个只读工具、复算工具 recompute_invoice、唯一的写工具 draft_credit_note,全部记审计日志
- 调查流程(LangGraph):理解问题 → 定位发票 → 取证 → 复算 → 假设与验证 → 结论
- 证据链和数字溯源校验:回复里的每个金额都必须出自证据
- 客户版和内部版两份解释
- 贷记单草稿、人工审批、幂等签发
- 评测:模拟客户、六个指标、pass^k
- Web 演示:实时调查面板,trace 可导出到 Agent Loupe

## 非目标

- 不接任何真实支付网关,不真的退款;「签发贷记单」就是终点
- 不处理多币种和汇率,国际版统一美元
- 不做催缴(dunning)、用量计费、月付年付互换
- Agent 不能改发票、不能改订阅,唯一能写的是贷记单草稿
- 不承诺退款时间和金额,对客户的措辞只陈述查到的事实
- 不使用任何真实公司的代码、表结构或客户数据,全部虚构

## 验收指标

| 指标 | 定义 | 起点目标 |
| --- | --- | --- |
| 根因准确率 | 结论的 root_cause 等于标准答案的场景占比 | ≥ 85% |
| 差额精确匹配率 | 结论的多收金额和标准答案分毫不差的场景占比 | ≥ 85% |
| 数字幻觉率 | 最终回复里出现证据链找不到出处的金额的场景占比 | 0% |
| 误冲正率 | 账没错却起草了贷记单的场景,占账没错场景的比例 | ≤ 5% |
| pass^k | 同一场景跑 k 次全部答对的场景占比 | 报 k=3 |
| 单场景成本与耗时 | 每个场景的花费和墙钟时间,报中位数和 P95 | 成本中位数 < ¥0.1 |

## 风险

- 评测偏乐观:复算工具几乎直接给出差额,场景要加难度(多张发票混在一起、客户给错月份)
- 标准答案本身算错:造数脚本要有自检测试,对每个场景用引擎重算差额
- 模型抄错数字:证据由代码从工具结果里抽取,回复过数字溯源校验器
- 误冲正把钱退出去:写操作只能起草,必须人批,误冲正率单列

## 里程碑

见仓库 README 的排期表,Day 680 到 Day 701。
```

<div class="line-notes">

- `一句话:客户问「为什么这个月多扣了钱」` 第一行就是电梯演讲,和 Day 676 README 第一屏的要求一样:陌生人只读这一句也知道它是什么。
- `约五分之一的工单其实账没错` 这个比例决定了评测集里「账没错」场景占 20%。背景里的每个数字后面都会变成设计决定,不是随便写的。
- `- 一线客服:` 三类用户,三种完全不同的需要:客服要快和可信,主管要控制权,工程师要可度量。少了任何一类,系统的某一块就没有存在的理由。这一行末尾的「每个数字都能点开看出处」会在 Day 686 变成证据链、Day 688 变成数字溯源校验器。
- `- 100 个带标准答案的争议场景` 为什么是 100 个:每类根因 6 到 7 个,加 20 个账没错。再少,单类的准确率就没有统计意义;再多,一次完整评测的花费和时间都上去了。Day 693 会再算一次账。
- `- 不接任何真实支付网关` 非目标的第一条,也是最重要的一条。BillSleuth 动不了真钱,演示站被人玩坏了最多是一张假贷记单。
- `- 不承诺退款时间和金额` 这一条是 Agent 才需要的:模型很容易在回复里顺嘴写「三个工作日内退款」,而这不是它能决定的。
- `- 不使用任何真实公司的代码、表结构或客户数据` 下面单独讲。
- `| 误冲正率 | 账没错却起草了贷记单的场景,占账没错场景的比例 | ≤ 5% |` 注意分母是「账没错的场景」,不是全部场景,原因在后面「验收指标」一节用数据说明。
- `| pass^k | 同一场景跑 k 次全部答对的场景占比 | 报 k=3 |` 这个指标没有目标值,只要求报出来。第一次跑之前我不知道合理的目标是多少,硬写一个数字反而是在骗自己。
- `## 风险` 每条风险后面都跟着缓解办法。只写风险不写怎么办,等于什么都没写。

</div>

### 非目标比功能清单更重要

功能清单写的是你要花时间的地方,非目标写的是你**不**花时间的地方。后者更难写,也更有价值:一个十天的作品项目最常见的死法就是范围不断膨胀,今天加个多币种,明天加个用量计费,最后哪个都没做完。

写每一条非目标时,我会同时想好面试官问「为什么不做」时怎么答。比如「不做多币种」:国际版统一美元是真实 SaaS 常见的简化,多币种主要增加的是汇率和舍入规则的复杂度,对「Agent 能不能查清账」这个核心问题帮助不大;如果要扩展,改动集中在金额类型和税率表,不影响调查流程。能这样答出来,非目标就从「没做」变成了「想清楚了不做」。

最后一条我想多说几句。你可能在工作里接触过计费系统,手里有现成的真实场景。把它们抽象成「故障类别」放进作品里可以,这是你的经验;但真实的表结构、代码片段、客户名字、金额,一个都不要带进来。一是公司保密要求,二是面试官看到这些会担心你将来也这样对待他们公司的数据。虚构数据还有一个工程上的好处:每个场景都有确定的标准答案,可以反复重跑,这是真实数据给不了的。

### 用脚本守住 PRD

PRD 写完以后最容易出的事,是后面改着改着和代码对不上了:有人把「误冲正率」改叫「错误退款率」,评测脚本还在算旧名字;有人删了两条非目标,范围悄悄变大。Day 676 用自查脚本守 README,今天用同样的办法守 PRD:

```python
# billsleuth/scripts/prd_check.py  PRD 自查:缺节、非目标太少、指标没写目标值,都算不过
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
text = (ROOT / "docs" / "prd.md").read_text(encoding="utf-8")
problems: list[str] = []

for h in ["## 背景", "## 用户故事", "## 功能清单", "## 非目标", "## 验收指标", "## 风险"]:
    if h not in text:
        problems.append(f"缺少「{h}」")


def section(name: str) -> str:
    return text.split(name, 1)[-1].split("\n## ", 1)[0] if name in text else ""


non_goals = re.findall(r"^- ", section("## 非目标"), flags=re.M)
if len(non_goals) < 5:
    problems.append(f"非目标只有 {len(non_goals)} 条,至少写 5 条")

rows = [r for r in section("## 验收指标").splitlines() if r.startswith("|") and "---" not in r][1:]
if len(rows) < 6:
    problems.append(f"验收指标只有 {len(rows)} 个,应该是 6 个")
for r in rows:
    cells = [c.strip() for c in r.strip("|").split("|")]
    if len(cells) < 3 or not cells[2] or cells[2] in {"TBD", "待定"}:
        problems.append(f"指标「{cells[0]}」没有起点目标值")

METRICS = {"根因准确率", "差额精确匹配率", "数字幻觉率", "误冲正率", "pass^k", "单场景成本与耗时"}
names = {r.strip("|").split("|")[0].strip() for r in rows}
for m in sorted(METRICS - names):
    problems.append(f"验收指标里少了「{m}」")
for m in sorted(names - METRICS):
    problems.append(f"验收指标里多了不认识的「{m}」,改名要同步改评测脚本")

print("\n".join(problems) if problems else "PRD 自查通过")
sys.exit(1 if problems else 0)
```

<div class="line-notes">

- `ROOT = pathlib.Path(__file__).resolve().parent.parent` 脚本在 `scripts/` 下,上两级是仓库根。和 Day 676 的 `release_check.py` 同一个写法。
- `for h in ["## 背景"` 六个必须有的小节。「里程碑」不强制,因为它会指向 README。
- `def section(name: str) -> str:` 截出某个二级标题到下一个二级标题之间的文字,Day 678 默写过的 `perf_section` 的通用版。标题不存在时返回空字符串,后面的检查会自然报「太少」。
- `non_goals = re.findall(r"^- ", section("## 非目标"), flags=re.M)` 数非目标一节里以 `- ` 开头的行。`re.M` 是多行模式,让 `^` 匹配每一行的开头而不只是整段的开头,相当于 JS 正则的 `m` 标志。
- `rows = [r for r in section("## 验收指标").splitlines() if r.startswith("|") and "---" not in r][1:]` 取表格行,去掉 `| --- |` 分隔行,`[1:]` 再去掉表头。剩下的就是六行指标。
- `cells = [c.strip() for c in r.strip("|").split("|")]` 去掉首尾的竖线再按竖线切,得到 `["根因准确率", "结论的 ...", "≥ 85%"]`。
- `if len(cells) < 3 or not cells[2] or cells[2] in {"TBD", "待定"}:` 第三列是目标值,空着或者写「待定」都不行。pass^k 那一行写的是「报 k=3」,它不是一个目标数字,但明确说了要报什么,我认为够了。
- `METRICS = {"根因准确率"` 指标名的标准清单。Day 694 的评测脚本会用同样的六个名字,两边对不上就是这里报错。
- `for m in sorted(METRICS - names):` 集合相减:标准清单里有、PRD 里没有的。`sorted` 让输出顺序固定。
- `sys.exit(1 if problems else 0)` 有问题退出码 1,以后可以挂进 CI,和 `release_check.py` 一样。

</div>

```bash
uv run python scripts/prd_check.py
```

```text
PRD 自查通过
```

### 故意改坏三处

为了确认它真的能拦住,我删掉了两条非目标(多币种、催缴),再把「误冲正率」改名叫「错误退款率」、目标值写成「待定」:

```text
非目标只有 4 条,至少写 5 条
指标「错误退款率」没有起点目标值
验收指标里少了「误冲正率」
验收指标里多了不认识的「错误退款率」,改名要同步改评测脚本
```

退出码是 1。一处改名报了三条,这正是我想要的:改名本身不是错,但改名不同步会让评测报告里的某个指标悄悄消失。改回去以后再跑,回到「PRD 自查通过」。

## 架构

<figure>
<svg viewBox="0 0 640 390" role="img" aria-label="BillSleuth 架构:客户问题进入 LangGraph 调查流程,通过 MCP 工具层访问计费库和参考引擎,产出证据链、两份解释和贷记单草稿,评测框架从外部驱动">
  <rect x="0" y="0" width="640" height="390" fill="var(--paper-raised)" rx="6"/>
  <defs><marker id="a679" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="20" y="30" width="130" height="50" fill="none" stroke="var(--ink-soft)" rx="4"/>
    <text x="85" y="52" text-anchor="middle" font-size="12" fill="var(--ink)">客户问题</text>
    <text x="85" y="70" text-anchor="middle" fill="var(--ink-soft)">+ 客户编号</text>
    <line x1="150" y1="55" x2="198" y2="55" stroke="var(--ink-soft)" marker-end="url(#a679)"/>
    <rect x="200" y="20" width="230" height="170" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
    <text x="315" y="40" text-anchor="middle" font-size="12" fill="var(--mem)">调查流程(LangGraph)</text>
    <text x="212" y="64" fill="var(--mem)">intake      读懂在抱怨什么</text>
    <text x="212" y="84" fill="var(--mem)">locate      代码找候选发票</text>
    <text x="212" y="104" fill="var(--mem)">investigate 假设 ⇄ 工具验证</text>
    <text x="212" y="124" fill="var(--mem)">conclude    提交结论</text>
    <text x="212" y="144" fill="var(--mem)">write_up    解释 + 数字溯源</text>
    <text x="212" y="164" fill="var(--mem)">approval    贷记单待审批</text>
    <line x1="430" y1="90" x2="478" y2="90" stroke="var(--compute)" marker-end="url(#a679)"/>
    <rect x="480" y="20" width="140" height="170" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
    <text x="550" y="40" text-anchor="middle" font-size="12" fill="var(--compute)">MCP 工具层</text>
    <text x="490" y="64" fill="var(--compute)">6 个只读工具</text>
    <text x="490" y="84" fill="var(--compute)">recompute_invoice</text>
    <text x="490" y="104" fill="var(--compute)">draft_credit_note</text>
    <text x="490" y="124" fill="var(--compute)">审计日志</text>
    <line x1="550" y1="190" x2="550" y2="228" stroke="var(--compute)" marker-end="url(#a679)"/>
    <rect x="470" y="230" width="150" height="50" fill="none" stroke="var(--compute)" rx="4"/>
    <text x="545" y="252" text-anchor="middle" fill="var(--compute)">billing.db</text>
    <text x="545" y="270" text-anchor="middle" fill="var(--compute)">参考计费引擎</text>
    <rect x="200" y="230" width="230" height="50" fill="none" stroke="var(--ink-soft)" rx="4"/>
    <text x="315" y="252" text-anchor="middle" fill="var(--ink)">证据链 E1, E2, …</text>
    <text x="315" y="270" text-anchor="middle" fill="var(--ink-soft)">由代码从工具结果里抽取</text>
    <line x1="315" y1="190" x2="315" y2="228" stroke="var(--ink-soft)" marker-end="url(#a679)"/>
    <rect x="20" y="230" width="150" height="50" fill="none" stroke="var(--ink-soft)" rx="4"/>
    <text x="95" y="252" text-anchor="middle" fill="var(--ink)">客户版 / 内部版</text>
    <text x="95" y="270" text-anchor="middle" fill="var(--ink-soft)">贷记单草稿 → 人批</text>
    <line x1="200" y1="255" x2="172" y2="255" stroke="var(--ink-soft)" marker-end="url(#a679)"/>
    <rect x="20" y="310" width="600" height="56" fill="none" stroke="var(--rule)" stroke-dasharray="5 4" rx="4"/>
    <text x="320" y="332" text-anchor="middle" fill="var(--ink)">评测:100 个场景 × 模拟客户 → 六个指标</text>
    <text x="320" y="352" text-anchor="middle" fill="var(--ink-faint)">标准答案来自造数脚本,和 Agent 完全隔离</text>
  </g>
</svg>
<figcaption>蓝色是模型侧,琥珀色是工具和数据侧。参考引擎在工具层后面:Agent 自己不算账,只调用 recompute_invoice 让引擎算。</figcaption>
</figure>

几个关键的设计决定,先说结论,理由在对应的那一天展开。

**参考引擎既是「标准答案」,也是 Agent 的工具。** 造数时用它生成正确的账,再注入错误;Agent 查账时通过 `recompute_invoice` 调用同一个引擎,拿「应收」和「实收」逐行对比。好处是 Agent 永远不用自己算钱,上面那个实验已经说明了让模型凭感觉判断有多不靠谱。坏处也很明显:评测会偏乐观,因为工具几乎直接把差额告诉了 Agent。PRD 的风险一节写了这一条,Day 693 会用更难的场景正面处理。

**定位候选发票用代码,不用模型。** 客户说了金额或月份,在发票列表里找对应的那张是一个确定的查找问题,十行代码就能写完,结果稳定、能写单元测试、不花 token。交给模型反而会引入不确定性,它可能看漏、看错行。模型留给真正需要判断的环节:先验证哪个假设,证据够不够下结论。

**证据由代码从工具结果里抽取。** 模型抄数字会抄错,代码不会。每次工具调用成功后,代码把结果里的金额、日期、税率抽出来编号成 E1、E2……,存进状态。最后写给客户的每个数字都必须能在这里找到,找不到就打回重写。Day 677 练习 4「每个数字都来自发票行」就是它的雏形。

**写操作只有一个,而且只能写草稿。** 最小权限,[Day 413](/blog/agent-zero/day-413-least-privilege/) 讲过。Agent 判断错了,代价是一张被驳回的草稿,不是一笔退错的钱。

## 仓库结构和排期

仓库是 Day 677 建的 `billsleuth/`,今天新增了 `docs/prd.md` 和 `scripts/prd_check.py`。正式代码放在里层同名的 `billsleuth/` 包里,从明天开始一天一天加。下面是做完时大致的样子,每个文件后面写了哪天建:

```text
billsleuth/
├── pyproject.toml           # Day 677 建,明天加 pytest
├── .env                     # 今天从 agent-zero-lab 复制,不提交
├── billing.db               # 造数生成,不提交
├── docs/prd.md              # 今天
├── scripts/prd_check.py     # 今天
├── scratch/                 # Day 677–679 的草稿脚本,正式代码不 import
├── scenarios/               # 100 个场景的标准答案,不给 Agent 看(Day 682)
├── billsleuth/
│   ├── money.py  schema.sql  db.py   # 金额规则和建表(Day 680)
│   ├── engine.py  refdata.py         # 参考引擎、价目表、税率(Day 681)
│   ├── faults.py  seed.py            # 12 类故障注入和造数(Day 682)
│   ├── server.py                     # MCP 工具层(Day 683)
│   └── …                             # 调查流程、证据链、审批、评测、面板(Day 684 起)
└── tests/
```

<div class="line-notes">

- `├── .env                     # 今天从 agent-zero-lab 复制,不提交` `.env` 和 `billing.db` 都在今天建的 `.gitignore` 里。Day 676 的发布自查也会再检查一遍。
- `├── scenarios/               # 100 个场景的标准答案,不给 Agent 看(Day 682)` 标准答案和 Agent 完全隔离:Agent 的工具只能读 `billing.db`,读不到这个目录。不然评测就成了开卷考试。
- `│   ├── money.py  schema.sql  db.py   # 金额规则和建表(Day 680)` 里层的 `billsleuth/` 是 Python 包,外层是仓库。这种「仓库名和包名相同、套两层」的结构在 Python 项目里很常见。

</div>

| Day | 内容 | 产出 |
| --- | --- | --- |
| 680 | 金额只走一个函数,表结构 | `money.py`、`schema.sql`、`db.py`,金额和约束的测试 |
| 681 | 参考引擎和规则单测,价目表和税率 | `engine.py`、`refdata.py`,引擎单测 |
| 682 | 故障注入、造数、数据集自检 | `faults.py`、`seed.py`,100 个场景 |
| 683 | MCP 工具层、复算工具、Inspector | `server.py`,工具测试 |
| 684 | 流程为什么拆段,MCP 桥接 | 桥接测试 |
| 685 | 复习 | 默写 |
| 686–687 | 证据链、调查图、真模型跑 | 跑通几个场景 |
| 688–689 | 两份解释、数字溯源校验器、重写循环 | 校验器测试 |
| 690–691 | 贷记单状态机、幂等、审批暂停 | 审批恢复测试 |
| 692 | 复习 | 默写 |
| 693–694 | 100 个场景、模拟客户、判分、跑评测 | 评测报告(六个指标) |
| 695–696 | 错误分析、回归、判断提升是不是真的 | 改进前后对比 |
| 697–698 | 调查面板、导出给 Loupe、部署 | 公网演示 |
| 699 | 复习 | 默写 |
| 700–701 | 案例页、FDE 面试故事 | 案例页、英文讲稿 |

前五天(680–684)全是地基,一行 Agent 代码都没有。这是故意的:Day 682 的数据集自检测试如果不过,后面所有的评测数字都不可信。

## 验收指标:开工前就定死

指标在开工前定,不在做完后挑好看的报。这句话说起来简单,做起来很难:做完以后你一定会想「这个指标不太公平,换一个吧」。所以今天就写进 PRD,并用上面的自查脚本锁住名字。

六个指标的定义在 PRD 里已经写了,光看定义容易理解偏,我们用一份假结果把每个都算一遍。5 个场景,各跑 3 次,一共 15 次运行。这些数字是我编的练习数据,不是 BillSleuth 的真实结果(真实结果 Day 694 跑出来回填):

```python
# billsleuth/scratch/metrics_demo.py  六个验收指标怎么算:5 个场景各跑 3 次的假结果
import math
import statistics
from collections.abc import Sequence
from decimal import Decimal

TRUTH = {  # 场景 -> (根因, 正确差额)
    "S001": ("proration_wrong_days", Decimal("2.58")),
    "S002": ("duplicate_charge", Decimal("117.00")),
    "S003": ("expired_tax_rate", Decimal("7.02")),
    "S004": ("no_error", Decimal("0.00")),
    "S005": ("no_error", Decimal("0.00")),
}
# 每次运行:(场景, 结论根因, 结论差额, 回复里没出处的金额个数, 是否起草了贷记单, 成本元, 秒)
RUNS = [
    ("S001", "proration_wrong_days", "2.58", 0, True, 0.031, 41), ("S001", "proration_wrong_days", "2.58", 0, True, 0.029, 38),
    ("S001", "proration_wrong_days", "2.60", 1, True, 0.035, 52),
    ("S002", "duplicate_charge", "117.00", 0, True, 0.018, 22), ("S002", "duplicate_charge", "117.00", 0, True, 0.017, 20),
    ("S002", "duplicate_charge", "117.00", 0, True, 0.019, 25),
    ("S003", "wrong_tax_region", "7.02", 0, True, 0.044, 61), ("S003", "expired_tax_rate", "7.02", 0, True, 0.040, 57),
    ("S003", "expired_tax_rate", "7.02", 0, True, 0.042, 55),
    ("S004", "no_error", "0.00", 0, False, 0.022, 30), ("S004", "no_error", "0.00", 0, False, 0.021, 28),
    ("S004", "no_error", "0.00", 0, False, 0.020, 27),
    ("S005", "no_error", "0.00", 0, False, 0.026, 33), ("S005", "proration_wrong_days", "5.00", 0, True, 0.090, 88),
    ("S005", "no_error", "0.00", 0, False, 0.025, 31),
]


def correct(r: tuple) -> bool:
    cause, delta = TRUTH[r[0]]
    return r[1] == cause and Decimal(r[2]) == delta


def p95(xs: Sequence[float]) -> float:
    s = sorted(xs)
    return s[math.ceil(0.95 * len(s)) - 1]  # 最近秩法:第 ceil(0.95n) 小的那个


def main() -> None:
    n = len(RUNS)
    print(f"根因准确率   {sum(r[1] == TRUTH[r[0]][0] for r in RUNS)}/{n}")
    print(f"差额精确匹配 {sum(Decimal(r[2]) == TRUTH[r[0]][1] for r in RUNS)}/{n}")
    print(f"数字幻觉率   {sum(r[3] > 0 for r in RUNS)}/{n}")
    no_err = [r for r in RUNS if TRUTH[r[0]][0] == "no_error"]
    print(f"误冲正率     {sum(r[4] for r in no_err)}/{len(no_err)}(只在账没错的运行里数)")
    by_case: dict[str, list[bool]] = {}
    for r in RUNS:
        by_case.setdefault(r[0], []).append(correct(r))
    print(f"pass^3       {sum(all(v) for v in by_case.values())}/{len(by_case)}  " + str({k: v.count(True) for k, v in by_case.items()}))
    costs, secs = [r[5] for r in RUNS], [r[6] for r in RUNS]
    print(f"成本 中位数 ¥{statistics.median(costs):.3f} P95 ¥{p95(costs):.3f};耗时 中位数 {statistics.median(secs)}s P95 {p95(secs)}s")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `TRUTH = {  # 场景 -> (根因, 正确差额)` 标准答案。S001 的 2.58 就是 Day 677 算出来的 7 月多收,S002 是一笔 117 的重复扣款,S004 和 S005 账没错,差额 0。
- `# 每次运行:(场景, 结论根因, 结论差额, 回复里没出处的金额个数, 是否起草了贷记单, 成本元, 秒)` 七个字段对应六个指标需要的全部信息。真实的评测记录会存成 JSON,字段名会更正式,意思一样。
- `("S001", "proration_wrong_days", "2.60", 1, True, 0.035, 52),` S001 第三次:根因对了,差额写成 2.60(差两分钱),回复里还有一个找不到出处的金额。这是典型的「模型自己心算」留下的痕迹。
- `("S003", "wrong_tax_region", "7.02", 0, True, 0.044, 61),` S003 第一次:差额对了,根因错了。税的两类根因很像,差额相同不代表原因相同。
- `("S005", "no_error", "0.00", 0, False, 0.026, 33), ("S005", "proration_wrong_days", "5.00", 0, True, 0.090, 88),` S005 第二次:账没错,Agent 却认定折算有误,还起草了一张 5.00 的贷记单。这就是误冲正。它也是最贵、最慢的一次,在错误方向上越查越深。
- `def correct(r: tuple) -> bool:` 一次运行「答对」= 根因对 **并且** 差额分毫不差。pass^k 用这个标准。
- `return r[1] == cause and Decimal(r[2]) == delta` 差额用 Decimal 比较,`Decimal("2.60") == Decimal("2.58")` 是 False。字符串比较也行,但 `"117.0"` 和 `"117.00"` 会被当成不一样,用 Decimal 更稳。
- `return s[math.ceil(0.95 * len(s)) - 1]` P95 用最近秩法:15 个数里第 ceil(14.25) = 15 小的,也就是最大那个。样本少的时候 P95 基本就是最大值,这是如实反映,不是算错。
- `print(f"根因准确率   {sum(r[1] == TRUTH[r[0]][0] for r in RUNS)}/{n}")` 15 次里根因对的次数。这里按「次」算;正式评测里会先按场景汇总再算,两种口径 Day 694 再讨论。
- `no_err = [r for r in RUNS if TRUTH[r[0]][0] == "no_error"]` 只挑「账没错」的运行,6 次。
- `print(f"误冲正率     {sum(r[4] for r in no_err)}/{len(no_err)}` 分母是这 6 次,不是 15 次。
- `by_case.setdefault(r[0], []).append(correct(r))` 按场景收集每次是否答对。`setdefault` 在键不存在时先放一个空列表再返回它,相当于 JS 的 `(m[k] ??= []).push(...)`。
- `sum(all(v) for v in by_case.values())` pass^3:三次全对的场景数。同一行后面的 `{k: v.count(True) for k, v in by_case.items()}` 顺便打印每个场景三次里对了几次,方便看是哪几个场景不稳。
- `statistics.median(costs)` 标准库求中位数,不用装 numpy。

</div>

```bash
uv run python scratch/metrics_demo.py
```

```text
根因准确率   13/15
差额精确匹配 13/15
数字幻觉率   1/15
误冲正率     1/6(只在账没错的运行里数)
pass^3       2/5  {'S001': 2, 'S002': 3, 'S003': 2, 'S004': 3, 'S005': 2}
成本 中位数 ¥0.026 P95 ¥0.090;耗时 中位数 33s P95 88s
```

逐个看。

**根因准确率和差额精确匹配率都是 13/15,约 87%,但错的不是同两次。** 根因错的是 S003 第一次和 S005 第二次;差额错的是 S001 第三次和 S005 第二次。如果只报一个「准确率」,你会把「原因找对了、钱算错了」和「钱算对了、原因找错了」混在一起,而这两种错的修法完全不同。前一种要查数字从哪来,后一种要查假设验证那一步。

**数字幻觉率 1/15。** 就是那个 2.60。PRD 里它的目标是 0%,因为我们打算用校验器在系统层面挡住编造的数字。

**误冲正率为什么分母是 6。** 如果分母用全部 15 次,得到 1/15 ≈ 7%,看起来还行。但误冲正只可能发生在账没错的场景里,有错的场景起草贷记单是对的。分母用 15,等于拿 9 次「本来就该冲正」的运行去稀释它。按 1/6 ≈ 17% 算,远远超过 5% 的目标,这才是真实的危险程度。**比例的分母要选「这件事有可能发生的那些情况」**,这条原则以后算任何比例都用得上。

**pass^3 只有 2/5,而按次数算的准确率有 87%。** 五个场景里三个都有一次不对。客服场景里,一个十次里偶尔乱冲正一次的 Agent,比一个从不处理退款的 Agent 危险得多。练习 4 会算一下 pass@3 和它差多少。

**成本 P95 ¥0.090,就是那次误冲正。** 中位数 ¥0.026 离 PRD 的目标还很远,但 P95 提醒你:最贵的那几次常常就是走错方向的那几次。

## 今天的文件

| 零件 | 文件 | 后面哪天用到 |
| --- | --- | --- |
| 先折扣后算税、贷记单冲减 | `scratch/coupon_tax.py` | Day 681 引擎的税和优惠券规则 |
| 13 个根因取值 | `scratch/guess_root_cause.py` 里的 `ROOT_CAUSES` | Day 682 故障注入,Day 686 结论结构 |
| PRD | `docs/prd.md` | 全程;Day 700 案例页 |
| PRD 自查 | `scripts/prd_check.py` | Day 694 评测报告的指标名 |
| 六个指标的算法 | `scratch/metrics_demo.py` | Day 694 判分和报告 |
| 练习 | `scratch/ex2_with_lines.py`、`ex3_coupon_end.py`、`ex4_pass_at_k.py` | |

今天调了两次模型:正文的 `guess_root_cause.py`(输入 618 + 输出 70 token)和练习 2 的 `ex2_with_lines.py`(三次请求,输入 993 + 输出 316 token)。2026 年 10 月查 [DeepSeek 价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing),`deepseek-flash` 高峰时段缓存未命中输入 2 元、输出 8 元每百万 token(空闲时段减半),按高峰价算:(618 + 993) × 2 / 1,000,000 + (70 + 316) × 8 / 1,000,000 = 0.0032 + 0.0031 ≈ 0.0063 元。

## 动手练习

**练习 1(开放题):给 PRD 加一条你自己的非目标,并写出面试时的回答。** 要求加完以后 `prd_check.py` 仍然通过。

<details><summary>参考答案</summary>

我加的是:

```markdown
- 不做多语言回复,客户版解释只出中文
```

面试时的回答:「多语言主要考验的是翻译质量,和 BillSleuth 想证明的『多步取证、数字不出错』关系不大;而且每多一种语言,数字溯源校验器就要多认一种数字和货币的写法(比如德语用逗号做小数点),评测的工作量翻倍。如果要扩展,改动集中在解释模板和校验器的数字抽取上,调查流程不用动。」

加到「## 非目标」一节最后,再跑一次:

```bash
uv run python scripts/prd_check.py
```

```text
PRD 自查通过
```

非目标从 6 条变成 7 条,脚本只要求至少 5 条,所以照样通过。(这道题是开放题,脚本只能检查条数,检查不了理由写得好不好,那一半要你自己把关。)好的非目标有两个特征:说得出不做的理由,也说得出以后要做时改哪里。只写「不做多语言」四个字,面试官追问一句你就答不上来了。

</details>

**练习 2:把数据也给模型。** 同样是 S4 那句「这个月怎么扣了 342」,这次把 6 月、7 月两张发票的行、订阅事件、扣款记录一起交给模型,跑 3 次,看它的判断和自信程度有什么变化。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex2_with_lines.py  练习 2:同一句话,附上发票行再让模型判断
import json
import os

from dotenv import load_dotenv
from openai import OpenAI

from guess_root_cause import ROOT_CAUSES

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])

quote = "我平时每月 117 美元,这个月怎么扣了 342?你们是不是多扣了?"
facts = """6 月 5 日发票:团队版 3 席 6/5–7/5 117.00,合计 117.00
订阅事件:2026-06-20 upgrade 团队版 3 席 -> 商业版 3 席(39/席 -> 89/席)
7 月 5 日发票:折算 退团队版 6/20–7/5 -58.50;折算 收商业版 6/20–7/5 133.50;商业版 7/5–8/5 267.00;合计 342.00
扣款:7 月 5 日 342.00 成功 1 笔"""
system = ("你是 SaaS 计费客服。根据客户的话和查到的数据判断根因,只能从这些取值里选一个:" + ", ".join(ROOT_CAUSES)
          + '。只输出 JSON:{"root_cause": "...", "confidence": 0 到 1, "reason": "一句话"}')
for i in range(3):
    resp = client.chat.completions.create(
        model=os.environ["LLM_MODEL"],
        messages=[{"role": "system", "content": system}, {"role": "user", "content": f"客户:{quote}\n\n查到的数据:\n{facts}"}],
        response_format={"type": "json_object"},
        extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY", "{}")),
    )
    assert resp.usage is not None
    print(i + 1, resp.choices[0].message.content, resp.usage.prompt_tokens, resp.usage.completion_tokens)
```

<div class="line-notes">

- `from guess_root_cause import ROOT_CAUSES` 复用正文脚本里的 13 个取值。正文脚本把运行代码放在 `main()` 里、用 `if __name__ == "__main__":` 保护,所以 import 时不会再调一遍模型。
- `facts = """6 月 5 日发票:` 三引号字符串可以跨行,相当于 JS 的模板字符串。这几行就是手工模拟的「工具查回来的数据」,Day 683 以后由 MCP 工具返回。
- `"reason": "一句话"` 这次多要一个理由,方便看它是怎么想的。
- `for i in range(3):` 同一个问题跑三次,看稳不稳定。
- `messages=[{"role": "system", "content": system}, {"role": "user", "content": f"客户:{quote}\n\n查到的数据:\n{facts}"}],` 客户原话和数据一起放进用户消息。
- `print(i + 1, resp.choices[0].message.content, resp.usage.prompt_tokens, resp.usage.completion_tokens)` 每次的原始回复和 token 数都打出来。

</div>

```bash
cd billsleuth/scratch
uv run --project .. python ex2_with_lines.py
```

```text
1 {"root_cause": "no_error", "confidence": 0.92, "reason": "6月20日从团队版升级到商业版，7月5日发票包含按期折算的费用差额和整月商业版费用，342美元计算正确且只扣了一笔，并非多扣。"} 331 65
2 {"root_cause": "proration_wrong_days", "confidence": 0.55, "reason": "6/20 升级的折算期 6/20–7/5 被按 15 天计算(3 席商业版 133.50 = 89×3×(15/30),团队版退款 -58.50 = 39×3×(15/30)),而 6/20 到 7/5 实际仅 15 天边界正确,但按整月折算的比例和 6/5–7/5 计费周期应算 15 天,更可能问题是折算天数按 30 天整月而非按 6/5–7/5 实际计费周期天数计算,导致退款与收费金额偏差,叠加正常整月费 267 后合计 342。"} 331 184
3 {"root_cause": "no_error", "confidence": 0.9, "reason": "6/20升级从团队版到商业版产生按比例折算差额75元,叠加7/5–8/5商业版3席267元,合计342元属正常计费,非多扣。"} 331 67
```

(这段输出里有全角逗号,是模型原样返回的,我没改。)

有了数据,三次里两次答对,自信从 0.4 升到 0.9 左右。但第二次很值得细看:它自己算出了「15/30」,也承认「实际仅 15 天边界正确」,6 月周期本来就是 30 天,分母写 30 完全没错,它却还是绕回了「分母写死 30」。理由越写越长,自信只有 0.55。这是模型在**心算**,而且心算到一半被「客户说多扣了」带偏了。

这个练习说明了两件事。第一,数据是必要的,没有数据它只能蒙。第二,数据还不够:让模型自己根据发票行判断「分母对不对」,它会动摇。所以 BillSleuth 的设计是让模型调 `recompute_invoice`,由引擎逐行算出应收和实收的差,模型只负责解释差额。三次请求一共 993 个输入 token、316 个输出 token。

</details>

**练习 3:优惠期结束那个月。** 客户团队版 3 席(117/月),有一张「前 3 个月八折」的券,税率 6%。算出 6 月到 9 月四张发票的合计,解释客户 9 月为什么会来问「怎么涨价了」。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex3_coupon_end.py  练习 3:「前 3 个月八折」结束那个月,客户看到的涨价
from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")


def q(x: Decimal) -> Decimal:
    return x.quantize(CENT, rounding=ROUND_HALF_UP)


subtotal = Decimal("117.00")  # 团队版 3 席,每月不变
rate = Decimal("0.06")
for i, month in enumerate(["6 月", "7 月", "8 月", "9 月"]):
    discount = q(subtotal * 20 / 100) if i < 3 else Decimal("0.00")  # 券只管前 3 张发票
    tax = q((subtotal - discount) * rate)
    print(f"{month}:小计 {subtotal} 折扣 {discount} 税 {tax} 合计 {subtotal - discount + tax}")
```

<div class="line-notes">

- `for i, month in enumerate(["6 月", "7 月", "8 月", "9 月"]):` `enumerate` 同时给出下标和元素,i 从 0 开始,[Day 18](/blog/agent-zero/day-018-for-range/) 讲过。
- `discount = q(subtotal * 20 / 100) if i < 3 else Decimal("0.00")` 前三张(i 是 0、1、2)打八折,第四张起没有折扣。117 × 20 / 100 = 23.40。
- `tax = q((subtotal - discount) * rate)` 先折扣后算税:(117 − 23.40) × 0.06 = 5.616,舍入 5.62;9 月 117 × 0.06 = 7.02。

</div>

```text
6 月:小计 117.00 折扣 23.40 税 5.62 合计 99.22
7 月:小计 117.00 折扣 23.40 税 5.62 合计 99.22
8 月:小计 117.00 折扣 23.40 税 5.62 合计 99.22
9 月:小计 117.00 折扣 0.00 税 7.02 合计 124.02
```

9 月比前三个月多了 124.02 − 99.22 = 24.80,其中 23.40 是折扣没了,1.40 是税跟着涨了(7.02 − 5.62)。客户什么都没改,账单涨了 25%,来问很正常。这是一个典型的 `no_error`:Agent 应该解释「优惠期在 8 月结束」,而不是起草贷记单。反过来,如果 9 月还该有折扣(比如券是 4 个月)而系统没给,那就是 `coupon_not_applied`。同一个现象,对错取决于券的有效月份,又一次说明必须查数据。

</details>

**练习 4:pass@3 和 pass^3 差多少?** 用 `metrics_demo.py` 的 15 次运行,算「3 次里至少对 1 次」的场景数和「3 次全对」的场景数。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex4_pass_at_k.py  练习 4:pass@3 和 pass^3 差多少
from metrics_demo import RUNS, correct

by_case: dict[str, list[bool]] = {}
for r in RUNS:
    by_case.setdefault(r[0], []).append(correct(r))
print("pass@3(3 次里至少对 1 次):", sum(any(v) for v in by_case.values()), "/", len(by_case))
print("pass^3(3 次全对):", sum(all(v) for v in by_case.values()), "/", len(by_case))
```

<div class="line-notes">

- `from metrics_demo import RUNS, correct` 复用正文的假数据和「答对」的定义。
- `sum(any(v) for v in by_case.values())` `any` 只要有一个 True 就是 True,相当于 JS 的 `arr.some(Boolean)`。
- `sum(all(v) for v in by_case.values())` `all` 要全部 True,相当于 `arr.every(Boolean)`。

</div>

```bash
cd billsleuth/scratch
uv run --project .. python ex4_pass_at_k.py
```

```text
pass@3(3 次里至少对 1 次): 5 / 5
pass^3(3 次全对): 2 / 5
```

同一份数据,pass@3 是满分,pass^3 只有 40%。pass@k 适合「可以让人从几个候选里挑一个」的场景,比如代码生成;客服计费场景里客户只会收到一次回复,一次乱冲正就是一次事故,所以 BillSleuth 报 pass^k。在作品页上只报 pass@3 的 5/5,严格说不算撒谎,但面试官一追问「客户会收到几次回复」就露馅了。

</details>

**验收标准:** `coupon_tax.py` 跑出合计 290.02 和多收 4.10;能说出 13 类根因里至少 9 类和该查的表;`docs/prd.md` 写完,`prd_check.py` 通过,故意改名时能报出「少了」和「多了」两条;`metrics_demo.py` 输出和上面一致,能解释误冲正率为什么是 1/6 而不是 1/15;练习 2 能说出第二次回复错在哪。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 优惠券(coupon) | 百分比折扣或固定减免,有有效月数,作用在小计上 |
| 税率有效期 | 每个税率有生效日和失效日,开票时按日期查 |
| 贷记单(credit note) | 冲减已开发票金额的会计凭证,BillSleuth 只起草,人工签发 |
| 退款(refund) | 把钱退回客户支付方式的资金动作,和贷记单是两回事,不在本项目范围内 |
| 催缴(dunning) | 扣款失败后的重试、提醒和暂停服务流程,本项目不做 |
| 根因(root cause) | 一次计费争议的真正原因,13 个固定取值之一 |
| PRD | 产品需求文档,一页纸说清做什么、不做什么、怎么算做成了([Day 437](/blog/agent-zero/day-437-prd/)) |
| 非目标(non-goal) | 明确写下不做的事和理由,防止范围膨胀 |
| 参考引擎(reference engine) | 按规则算出「应收」的代码,既用来造数,也是 Agent 的复算工具 |
| 证据链(evidence chain) | 代码从工具结果里抽出、带编号的事实清单,回复里的数字必须出自这里 |
| 误冲正(false credit) | 账没错却起草了贷记单 |
| 数字幻觉 | 回复里出现了在证据里找不到出处的金额 |
| P95 | 把一组数从小到大排,第 95% 位置上的那个,看「最慢/最贵的那一小撮」 |
| pass@k | 跑 k 次至少成功一次的比例,和 pass^k 相对 |

## 常见误区

**把发票金额直接改掉来修正多收。** 已开出的发票是会计凭证,改了就对不上之前的扣款和报税记录。开贷记单冲减,留下完整的痕迹。

**以为客户的说法能对应到根因。** 实验里三句一模一样的话对应三个不同的根因,模型只能蒙。必须查数据。

**给了数据就让模型自己判断对错。** 练习 2 第二次回复自己算出了 15/30,还是认定分母写错了。判断账对不对交给引擎复算,模型负责解释。

**只造有错的场景。** 一个「客户一抱怨就说有错」的 Agent 在这种评测集上也能拿高分。要放「账没错」的场景,并单独算误冲正率。

**误冲正率的分母用全部场景。** 1/15 看起来还行,1/6 才是真实的危险程度。分母选「这件事可能发生的那些情况」。

**只报一个「准确率」。** 根因对钱错和钱对根因错是两种完全不同的问题,分成两个指标。

**目标值写不出来就随便写一个。** pass^k 我只写了「报 k=3」。第一次跑之前编一个目标,等于给自己挖坑;写明要报什么,跑完再定。

**做完再定指标。** 做完以后你一定会想换一个好看的。开工前写进 PRD,用脚本锁住名字。

**把能用代码做的步骤交给模型。** 定位候选发票是确定的查找,十行代码就够了。模型留给需要判断的环节。

**拿真实工作里的数据当作品素材。** 抽象成故障类别可以,真实的表结构、代码和客户信息一个都不能带。

## 学习资料

### 文档与文章

- [Stripe · Credit notes](https://docs.stripe.com/invoicing/dashboard/credit-notes):贷记单怎么冲减已开发票、和退款的关系,10 分钟。
- [Stripe · Coupons and promotion codes](https://docs.stripe.com/billing/subscriptions/coupons):优惠券的种类和有效期(`duration` 的几种取值),10 分钟。
- [Stripe · Tax](https://docs.stripe.com/tax):看概览,知道真实系统里税要考虑注册地、商品税码、免税,我们简化掉了多少,10 分钟。
- [Marty Cagan · How To Write a Good PRD](https://www.svpg.com/how-to-write-a-good-prd/):PRD 写法的经典老文,重点看他对「需求」和「方案」的区分,15 分钟。
- [Lenny's Newsletter · PRDs and 1-pagers 模板合集](https://www.lennysnewsletter.com/p/prds-1-pagers-examples):十几家公司的 PRD 模板,翻三四个对照我们的结构,部分内容要订阅,20 分钟。
- [Atlassian · Product requirements](https://www.atlassian.com/agile/product-management/requirements):另一种更偏敏捷团队的 PRD 写法,10 分钟。
- [DeepSeek · 模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):今天算成本用的价格,注意高峰和空闲时段不同。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1kv4y1A7rH&autoplay=0&high_quality=1" title="PRD产品设计文档怎么写？手把手来教你。" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>产品经理毛毛 · PRD产品设计文档怎么写?手把手来教你。 · 20 分钟,从产品经理的角度讲一份 PRD 由哪几块组成,对照我们的一页版,看看完整版多了什么、我们为什么不需要。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1WPnuzPEzD&autoplay=0&high_quality=1" title="为什么AI评估是产品构建者最热门的新技能 | Hamel Husain & Shreya Shankar [附文稿]" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Web3天空之城 · 为什么AI评估是产品构建者最热门的新技能 | Hamel Husain & Shreya Shankar [附文稿] · 106 分钟的长访谈中文字幕版,今天先看前 20 分钟,听他们讲「指标要从看真实失败里来」,和「开工前定指标」放在一起想。</figcaption>
</figure>

- 黑马产品经理《产品经理零基础入门(五)产品需求文档PRD(全16集)》(BV1kY411G7x2):系统的 PRD 课程,想深入时挑第 1 到 3 集看。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/EL2YIn5cLig" title="The Rise of the Forward Deployed Engineer" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>ZAUEY (Claire Zau) · The Rise of the Forward Deployed Engineer · FDE 这个岗位从 Palantir 到 AI 公司的演变。写 PRD 时想着读者是一个 FDE 面试官,非目标会写得更清楚。</figcaption>
</figure>

- Stripe Developers《Stripe Billing 101: APIs, Features, and Revenue Optimization》(YouTube `UaW7Tbmgon4`):Stripe 官方讲订阅计费的整体结构,优惠券、发票、贷记单在真实系统里怎么串起来。

### 书籍

- Marty Cagan《Inspired》(第 2 版,Wiley, 2017;中译本《启示录》):讲产品经理怎么定义问题,今天只需要看讲「产品愿景」和「需求」的那几章,理解一页 PRD 为什么先写背景和用户。
- Tien Tzuo、Gabe Weisert《Subscribed》(Portfolio, 2018;中信出版社有中译本《订阅经济》):Day 677 推荐过,今天回头看讲续费和流失的部分,理解为什么误冲正和多收都伤客户关系。

### 开源项目与代码

- [getlago/lago](https://github.com/getlago/lago):开源的订阅和用量计费系统。看 [它的贷记单文档](https://docs.getlago.com/guide/invoicing/credit-notes),和我们「只起草、人签发」的设计对比。
- [killbill/killbill](https://github.com/killbill/killbill):老牌开源计费平台,订阅变更和账单的边界情况很全,写 Day 682 的故障时可以找灵感。
- [sierra-research/tau-bench](https://github.com/sierra-research/tau-bench):我们 Day 693 的模拟客户和 pass^k 都从它借鉴。

## 自测

1. 一张发票小计 342.00,有八折券,税率 6%。税是多少?如果系统按折扣前的小计算税,多收多少?多收以后怎么处理?

<details><summary>答案</summary>

折扣 68.40,税 = (342.00 − 68.40) × 0.06 = 16.416,舍入 16.42,合计 290.02。按折扣前算税是 342 × 0.06 = 20.52,合计 294.12,多收 4.10。发票已开出不能改,开一张 4.10 的贷记单冲减,签发后由财务流程退款或留作余额。

</details>

2. 客户说「这个月怎么比我算的多了一点」,可能是哪几类根因?为什么 Agent 不能从这句话直接下结论?

<details><summary>答案</summary>

可能是折算分母写死 30、时区算错日期、用了过期税率、用了别的地区税率、单价不对,也可能账没错(比如升级折算或优惠期结束)。同一句话对应多种根因,根因藏在数据里:周期天数、事件本地时间、税率有效期。实验里三句一样的话模型给了一样的答案,只能蒙对一个。

</details>

3. 误冲正率的分母为什么是「账没错的场景」而不是全部场景?用 `metrics_demo.py` 的数字说明。

<details><summary>答案</summary>

误冲正只可能发生在账没错的场景里,有错的场景起草贷记单是正确动作。用全部 15 次做分母得 1/15 ≈ 7%,被 9 次本来就该冲正的运行稀释了;用 6 次账没错的运行做分母得 1/6 ≈ 17%,这才反映 Agent 在「该不该退钱」这件事上的真实表现。

</details>

4. 为什么 PRD 里的非目标比功能清单更重要?「不做多币种」这条在面试时怎么解释?

<details><summary>答案</summary>

功能清单写要花时间的地方,非目标写不花时间的地方,它防止范围膨胀,也说明你想清楚了取舍。「不做多币种」:国际版统一美元是常见简化,多币种主要增加汇率和舍入规则的复杂度,和「Agent 能不能查清账」这个核心问题关系不大;要扩展时改动集中在金额类型和税率表,调查流程不受影响。

</details>

5. 定位候选发票这一步为什么用代码,不交给模型?

<details><summary>答案</summary>

客户提到了金额或月份时,在发票列表里找对应的那张是确定的查找,十行代码就能写完,结果稳定、能写单元测试、不花 token。交给模型会引入不确定性,可能看漏或看错行。模型留给需要判断的环节,比如先验证哪个假设、证据够不够下结论。

</details>

6. 面试题:面试官问「你的 Agent 准确率 90%,剩下 10% 错了怎么办?计费这种场景能接受吗?」

<details><summary>答案</summary>

先把错分类,不同的错代价不同。漏判(有错没查出来)的后果是客户再来一次或转人工,可以接受一定比例;误冲正(没错却要退钱)直接造成资金损失,单独作为指标压到很低,而且写操作只能起草、必须人批;编造数字最不能接受,用证据链和溯源校验器在系统层面挡住,目标是 0。然后讲落地:先做客服的辅助工具,Agent 给结论和证据,人确认后再发;用评测持续跟踪这三类错误,同时报 pass^k 看稳定性,用置信区间说明结论有多可靠;按根因类别逐步放开自动化,比如重复扣款这种证据明确的先放。最后讲成本:人工查一单 15 到 30 分钟,Agent 几十秒加几分钱,只做辅助也有明确的投入产出。

</details>

## 明天预告

明天是 Day 680 · BillSleuth(一):金额只走一个函数,事件是事实订阅是快照。开题结束,开始写正式代码。先把 Day 677 那三条 Decimal 规矩讲透,收进 `money.py` 的三个函数,并用 pytest 钉死;再建今天架构图右下角那个 `billing.db`:十张表,金额为什么存 TEXT 不存 REAL,订阅表为什么只是快照、真相在事件表里,以及让数据库自己拦住脏数据的几个约束。
