---
title: 'Day 369 · 自动优化提示词(二):自己写反思循环,用 DSPy 跑 GEPA'
description: '用昨天的 60 条工单实测两种自动优化。先不用框架,60 行写一个「读错例 → 反思 → 改写 → 验证集验收」的循环:从只有类别名的起点出发,测试集 80% 到 90%,但学到的「钱优先」规则又把一条显示错误带成了 billing。再用 DSPy 3.4.1 的 GEPA 跑同一个任务:验证集涨到 95%,测试集纹丝不动,一看新指令,「重复扣款」四个字被改丢了。'
pubDate: 2026-10-23
regime: none
tags: ['prompt-optimization', 'dspy', 'gepa', 'eval', 'agent-zero']
series: 'agent-zero'
day: 369
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 368](/blog/agent-zero/day-368-prompt-opt-1/) 准备了 60 条 CloudLedger 工单,分诊规范只写在每条的 `why` 理由里,按编号除 3 的余数切成训练、验证、测试各 20 条。`part06/opt_task.py` 里有两个起点:认真写过定义的 BASE(测试集 90%)和只有类别名的 BARE(测试集 80%),还有 `evaluate()` 这把尺子。手调三版的实测是:加一句「钱优先」修好 2 条、带坏 6 条。最后认识了三个名字:DSPy 是框架,GEPA 是读文字反馈改写 prompt 的优化器,ACE 是只增量加条目的思路。

今天把「跑评测、读错例、改写、挑选」这个圈交给程序转。先自己写一遍,知道每一步在干什么;再换成 DSPy 的 GEPA,看框架多做了什么。

## 今天要解决的问题

学完今天你应该能:

1. 不用框架,写出一个反思循环:跑训练集拿错例,让反思模型改写 prompt,在验证集上验收,测试集最后只量一次。
2. 用 DSPy 写一个 Signature 和 `Predict`,用 `inspect_history` 看清 DSPy 实际发给模型的 prompt。
3. 用 `dspy.GEPA` 优化同一个分类任务,写出返回 `score` 和 `feedback` 的评分函数,看懂候选列表、父节点和 Pareto 前沿。
4. 读优化器给的新 prompt,找出它把规则写宽了或者写丢了的地方,并判断分数的变化是真进步还是噪声。

今天两个新概念:**反思循环**和 **DSPy + GEPA**。DSPy 本身是一整个框架,今天只用到它的 Signature、Predict、Evaluate 和 GEPA 四样。

预计用时 3 小时。实跑花费约 0.91 元:反思循环两次 0.145 元,GEPA 两次 0.474 元,读回检查 0.008 元,练习 1–3 约 0.284 元,算式在各段末尾。这是这一部分花钱最多的一天,GEPA 一次就要两毛多,跑之前先确认 `.env` 里的余额。前置:[Day 368](/blog/agent-zero/day-368-prompt-opt-1/) 的 `part06/opt_task.py` 和 `part06/opt_tickets.jsonl`;[Day 136](/blog/agent-zero/day-136-llm-client-2/) 的 `LLMClient`;[Day 143](/blog/agent-zero/day-143-prompt-5/) 用 XML 标签圈出模型输出的写法。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章,把 `reflect()` 和反思循环默写出来,再把 GEPA 的五参数评分函数默写一遍;做练习时先自己写,做不出再展开参考答案,看完关掉重写一遍。

## 第一步:60 行写一个反思循环

先不碰框架。昨天第四步那张循环图,翻成代码就是下面这样。反思这一步要一个 prompt,告诉反思模型它的任务;我们把当前 prompt 和错例(带 `why` 理由)填进去,让它把新版 prompt 放在 `<prompt></prompt>` 标签里,再用正则取出来。

```python
# agent-zero-lab/part06/reflect_loop.py
"""Day 369:不用框架,写一个「读错例 → 反思 → 改 prompt → 验证集验收」的循环。
用法: uv run python -m part06.reflect_loop [bare]"""
from __future__ import annotations

import re
import sys
from typing import Any

from common.llm import LLMClient
from part06.opt_task import BARE_PROMPT, BASE_PROMPT, evaluate, load

REFLECT = """你在维护一个客服工单分类 prompt。下面是当前 prompt 和它在一批工单上分错的例子,
每个例子附有标注员写的理由。请找出这些错误背后的规则,改写 prompt:
- 保留六个类别名不变,可以补充判定规则和优先级
- 写成通用规则,不要逐字抄工单原文
- 不超过 400 字
把新 prompt 放在 <prompt></prompt> 里。

当前 prompt:
{prompt}

分错的例子:
{errors}"""


def reflect(client: LLMClient, prompt: str, errors: list[dict[str, Any]]) -> str:
    lines = [f"- 工单:{e['ticket']}\n  模型答:{e['pred']}  正确:{e['label']}  理由:{e['why']}" for e in errors]
    r = client.chat([{"role": "user", "content": REFLECT.format(prompt=prompt, errors="\n".join(lines))}])
    m = re.search(r"<prompt>(.*?)</prompt>", r.content, re.S)
    return m.group(1).strip() if m else prompt


def main() -> None:
    client = LLMClient()
    train, val = load("train"), load("val")
    start = BARE_PROMPT if "bare" in sys.argv[1:] else BASE_PROMPT
    best = start
    best_val, _ = evaluate(client, best, val)
    print(f"起点 val {best_val:.0%}")
    for step in range(1, 5):
        _, errors = evaluate(client, best, train)
        if not errors:
            print(f"第 {step} 轮:训练集全对,停")
            break
        cand = reflect(client, best, errors)
        cand_val, _ = evaluate(client, cand, val)
        keep = cand_val >= best_val
        print(f"第 {step} 轮:训练集错 {len(errors)} 条 {[e['id'] for e in errors]},候选 val {cand_val:.0%},{'采用' if keep else '丢弃'}")
        if keep:
            best, best_val = cand, cand_val
    test_acc, test_err = evaluate(client, best, load("test"))
    print(f"\n最终 prompt({len(best)} 字):\n{best}\n")
    print(f"test {test_acc:.0%}", [f"{e['id']} {e['label']}→{e['pred']}" for e in test_err])
    print(client.ledger)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `import re` 正则模块,下面用它把新 prompt 从标签里取出来。
- `from part06.opt_task import BARE_PROMPT, BASE_PROMPT, evaluate, load` 全部来自昨天的 `opt_task.py`。数据、起点、尺子都和昨天一样,今天只多了「改写」这一步。
- `REFLECT = """你在维护一个客服工单分类 prompt。下面是当前 prompt 和它在一批工单上分错的例子,` 这就是**反思 prompt**,交给反思模型的任务说明。GEPA 内部也有一个类似的模板,写得更讲究。
- `- 保留六个类别名不变,可以补充判定规则和优先级` 不加这句,模型可能顺手把 `billing` 改成 `payment`,评测函数就全判错了。
- `- 写成通用规则,不要逐字抄工单原文` 不加的话,反思模型最省事的做法是把错的工单原文写进 prompt(「如果客户说注销账号还有 120 块余额,归 refund」),训练集马上全对,对新工单没用。练习 1 会去掉它看看。
- `- 不超过 400 字` 给个长度上限,防止 prompt 越改越长。下面会看到模型并没有严格遵守。
- `把新 prompt 放在 <prompt></prompt> 里。` [Day 143](/blog/agent-zero/day-143-prompt-5/) 讲过的写法:让模型把要取的东西放进标签,代码好取。
- `{errors}"""` 三引号字符串里的 `{prompt}`、`{errors}` 是占位符,下面用 `.format()` 填。相当于 JS 模板字符串,只是填值放在后面。
- `lines = [f"- 工单:{e['ticket']}\n  模型答:{e['pred']}  正确:{e['label']}  理由:{e['why']}" for e in errors]` 每条错例给四样东西:原文、模型答案、正确答案、理由。BASE 第一轮实测是两条:t13(注销退余额,答成 account)和 t22(PAY_TIMEOUT,答成 bug)。
- `r = client.chat([{"role": "user", "content": REFLECT.format(prompt=prompt, errors="\n".join(lines))}])` 反思这一步没传 temperature,用模型默认值,所以同样的输入每次改出来的版本不一样,后面 BARE 那次能看到。
- `m = re.search(r"<prompt>(.*?)</prompt>", r.content, re.S)` `.*?` 是「尽量少地匹配任意字符」,`re.S` 让 `.` 也能匹配换行,新 prompt 是多行的。相当于 JS 的 `/<prompt>([\s\S]*?)<\/prompt>/`。
- `return m.group(1).strip() if m else prompt` `group(1)` 是第一对括号里匹配到的内容。模型偶尔忘了写标签,就当这一轮没改出东西,原样返回。
- `best_val, _ = evaluate(client, best, val)` 先量起点在验证集上的分数,作为门槛。`_` 表示这个返回值(错例列表)不要。
- `for step in range(1, 5):` 最多四轮。`range(1, 5)` 是 1、2、3、4,不含 5。
- `_, errors = evaluate(client, best, train)` 用当前最好的版本跑训练集拿错例。反思只看训练集的错例,验证集的错例不给它看。
- `keep = cand_val >= best_val` 验收规则:候选在验证集上不比当前差就采用。用 `>=`,是因为 20 条上分数常常打平,打平也接受能让循环往前走;代价是可能接受一个只是换了种说法的版本。练习 3 改成 `>` 对比。
- `test_acc, test_err = evaluate(client, best, load("test"))` 测试集只在循环结束后量一次,中途不能拿它决定采不采用。
- `print(client.ledger)` 账本累计了评测和反思的所有调用。

</div>

先从 BASE 起步:

```bash
uv run python -m part06.reflect_loop
```

实测输出:

```text
起点 val 85%
第 1 轮:训练集错 2 条 ['t13', 't22'],候选 val 90%,采用
第 2 轮:训练集错 1 条 ['t31'],候选 val 95%,采用
第 3 轮:训练集全对,停

最终 prompt(506 字):
将客服工单归入唯一类别：refund、billing、invoice、bug、account、other。

判定规则：
refund：核心诉求是把钱退回客户，含退款、重复扣款退回、取消或注销后的余额退回、退款进度与去向。
billing：付款交易是否成功及费用问题，含扣款失败、欠费、价格、套餐计费、支付未成功或未扣款。
invoice：围绕开票本身，含能否开票、抬头、类型、开票信息及流程。
bug：产品或系统可复现的功能异常、报错、页面或功能不工作；须排除退款诉求和付款是否成功问题。
account：登录、验证码、权限、账号信息与注销本身。登录、验证流程失败（含错误码、跳转异常、清缓存无效）均归 account，不归 bug。
other：无法归入以上类别，或信息不足且不涉及退款、付款、开票、明确功能异常、账号操作。

优先级：refund > billing > invoice > account > bug > other。选择最高优先级中匹配的类别；仅当无更高优先级类别匹配时才落入较低类别。注意：凡涉及登录、验证、权限、账号操作的工单优先归 account，除非其核心诉求是退款或付款失败。

test 90% ['t12 bug→invoice', 't57 billing→other']
142 次调用 | 输入 37388 / 输出 1434 tokens | 约 ¥0.0649
```

(新 prompt 里的全角标点是反思模型自己写的,原样保留。)

两轮就停了。第 1 轮看了 t13、t22 两条错例,写出「注销后的余额退回算 refund」「付款没成功不归 bug」;第 2 轮训练集只剩 t31(登录跳转带 E1101),又补了「登录失败含错误码也归 account」。验证集 85% → 90% → 95%,一路涨。

然后看测试集:90%,错 t12 和 t57,和起点 BASE 一模一样。验证集涨了 10 个点,测试集一条都没多对。这不奇怪:验证集被循环拿来挑版本,每一轮「采用」都是因为它在验证集上分数不降,它在这 20 条上好看是被挑出来的。再加上昨天说的,20 条上一条就是 5 个点,t14 那种时对时错的工单就能贡献一次「上涨」。

还有两个细节。一是 506 字,超过了「不超过 400 字」,模型没严格听,但也没失控。二是最后那行优先级 `refund > billing > invoice > account > bug > other`,把钱的问题排在了最前面,而 bug 排在倒数第二。记住这一行,下面马上用得上。

再从 BARE 起步:

```bash
uv run python -m part06.reflect_loop bare
```

实测输出:

```text
起点 val 85%
第 1 轮:训练集错 5 条 ['t01', 't13', 't16', 't22', 't31'],候选 val 80%,丢弃
第 2 轮:训练集错 5 条 ['t01', 't13', 't16', 't22', 't31'],候选 val 85%,采用
第 3 轮:训练集错 2 条 ['t46', 't52'],候选 val 85%,采用
第 4 轮:训练集全对,停

最终 prompt(542 字):
将客服工单归入六类之一：refund、billing、invoice、bug、account、other。先识别工单的核心诉求（客户最想达成的一件事），再按以下规则判定：

refund：核心诉求是把钱退回客户，包括重复/多扣款、取消后仍扣款、注销时退余额等；未明说“退款”也算。refund 优先于 billing 和 account。

billing：与付费本身相关但非退款，包括支付失败/超时、扣款方式异常、订单未成功、付费周期变更（月付改年付）、价格与优惠咨询、套餐计费方式等。付费未成功不归 bug。

account：与账户及访问权限相关，包括登录失败、反复跳登录页、注销、账户信息修改、成员权限与角色设置（如只读/可编辑权限）、账号安全设置等。带错误码的登录问题仍归 account，不归 bug。

invoice：发票开具、发票信息修改、发票下载等。

bug：功能异常，且不涉及退款、付费、登录/账户/权限问题。

other：确实无法归入以上类别。

多类沾边时按 refund > billing > account > invoice > bug > other 选择最贴合核心诉求者；咨询类工单按其主题归入对应业务类别，不因“只是咨询”而归 other。

test 90% ['t12 bug→invoice', 't33 bug→billing']
183 次调用 | 输入 43948 / 输出 2125 tokens | 约 ¥0.0803
```

这一组最有意思,有三处值得看。

第一,第 1 轮和第 2 轮的错例完全一样,第 1 轮的候选被丢弃,第 2 轮的被采用。同样的输入,反思模型两次写出了不同的版本,因为反思那次调用没设 temperature,用的是默认值。这在优化里是好事:一次没改好,再抽一次签。

第二,从一句话的 BARE 出发,测试集 80% → 90%,追平了昨天你认真写的 BASE。看新 prompt 的 refund 一行:「重复/多扣款、取消后仍扣款、注销时退余额」,和昨天第一步那套分诊规范几乎一字不差,全是从 `why` 理由里读出来的。这是自动优化真本事的地方。

第三,测试集新错了一条 t33「订阅页面显示下次扣款日期是 11 月 31 日,这个日期不存在吧?」,答成了 billing,标注员算 bug(页面把日期显示错了)。原因就在最后那行优先级 `refund > billing > account > invoice > bug > other`:t33 里有「扣款」两个字,按这个顺序就落到了 billing。而训练集和验证集里都没有「带扣款字样的显示错误」这种例子,两份数据都惩罚不了这条宽规则。

还有一处你自己审的时候应该能看出来:invoice 那行写着「发票下载」,可昨天的规范是「发票 PDF 打不开算 bug」(t12)。BASE 和 BARE 两次都错在 t12,这条宽写法也有份。

这就是今天要反复看到的现象:**优化器学到的规则在它见过的数据上是对的,但它会把规则写得比真实规范更宽。** 昨天手调时人犯的错(「涉及钱一律 refund」),反思模型也会犯,只是它犯得更体面,还给你排了个优先级。

花费:BASE 那次 142 次调用,输入 37388、输出 1434 token,37388 × 2 / 100 万 + 1434 × 8 / 100 万 ≈ 0.0748 元,账本显示 0.0649 元,差的是缓存命中:`LLMClient` 按 DeepSeek 返回的命中数用 0.04 元每百万算,同一个 system prompt 跑 20 条,后面的请求大半能命中。BARE 那次账本 0.0803 元。

## 第二步:DSPy 最小例子

DSPy 的写法和你前面习惯的不一样。你不再拼 `messages`,而是声明「输入是什么、输出是什么」,由 DSPy 把它渲染成 prompt、再把模型的回复解析回来。先装上:

```bash
uv add dspy
```

2026 年 10 月实测装上的是 dspy 3.4.1、gepa 0.1.4、litellm 1.83.0,和 `LLMClient` 用的 openai SDK 不冲突。**LiteLLM** 是一个「统一调各家模型」的库,DSPy 底层用它发请求,所以 DSPy 的调用不经过我们的 `LLMClient`,花费要另算。

写一个最小例子,只分一条工单,然后让 DSPy 把它拼出来的 prompt 打印出来:

```python
# agent-zero-lab/part06/dspy_hello.py
"""Day 369:DSPy 最小例子。声明输入输出,让 DSPy 自己拼 prompt,再把它拼出来的消息打印出来看。
用法: uv run python -m part06.dspy_hello"""
from __future__ import annotations

import json
import os
from typing import Literal

import dspy
from dotenv import load_dotenv

load_dotenv()
lm = dspy.LM(f"openai/{os.environ['LLM_MODEL']}", api_base=os.environ["LLM_BASE_URL"],
             api_key=os.environ["LLM_API_KEY"], extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY") or "{}"),
             temperature=0, cache=False)
dspy.configure(lm=lm)


class Triage(dspy.Signature):
    """把客服工单分到一个类别。"""

    ticket: str = dspy.InputField(desc="客户工单原文")
    category: Literal["refund", "billing", "invoice", "bug", "account", "other"] = dspy.OutputField()


classify = dspy.Predict(Triage)
pred = classify(ticket="信用卡续费没扣成功,页面提示 card_declined,怎么办?")
print("结果:", pred.category, type(pred.category).__name__)
dspy.inspect_history(n=1)
```

<div class="line-notes">

- `from typing import Literal` `Literal["a", "b"]` 表示「只能是这几个字符串之一」,相当于 TS 的字面量联合类型 `"a" | "b"`。
- `load_dotenv()` 读 `agent-zero-lab/.env`,DSPy 不经过 `LLMClient`,环境变量要自己读。
- `lm = dspy.LM(f"openai/{os.environ['LLM_MODEL']}", api_base=os.environ["LLM_BASE_URL"],` 模型名前加 `openai/`,LiteLLM 就按 OpenAI 兼容协议去调 `api_base`。代入后是 `openai/deepseek-flash` 和 `https://api.deepseek.com`。
- `api_key=os.environ["LLM_API_KEY"], extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY") or "{}"),` `extra_body` 被 LiteLLM 原样转发,这里是关掉思考模式的 `{"thinking": {"type": "disabled"}}`。
- `temperature=0, cache=False)` `cache=False` 关掉 DSPy 的磁盘缓存。不关的话,第二次跑同样的输入会直接读缓存,分数和花费都不真实。
- `dspy.configure(lm=lm)` 设成全局默认模型,后面所有 DSPy 模块不指定就用它。
- `class Triage(dspy.Signature):` Signature 就是这一步的输入输出契约。写法像 pydantic 模型([Day 51](/blog/agent-zero/day-051-pydantic-1/)):类里每个带类型的字段就是一个输入或输出。
- `"""把客服工单分到一个类别。"""` 类的文档字符串就是**指令**,也就是 GEPA 要优化的那段文字。
- `ticket: str = dspy.InputField(desc="客户工单原文")` 输入字段。`desc` 会被写进 prompt。
- `category: Literal["refund", "billing", "invoice", "bug", "account", "other"] = dspy.OutputField()` 输出字段,用 `Literal` 限定六个值。DSPy 会在 prompt 里列出可选值,解析时也会检查。
- `classify = dspy.Predict(Triage)` `Predict` 是最简单的 Module:一次调用直接出答案。
- `pred = classify(ticket="信用卡续费没扣成功,页面提示 card_declined,怎么办?")` 像调函数一样调,参数名就是输入字段名。返回的 `pred` 上有 `category` 属性。
- `dspy.inspect_history(n=1)` 打印最近 1 次调用实际发给模型的消息和模型的回复。想知道框架替你写了什么 prompt,就用它。

</div>

```bash
uv run python -m part06.dspy_hello
```

实测输出(时间戳那行省略了):

```text
结果: billing str

System message:

Your input fields are:
1. `ticket` (str): 客户工单原文
Your output fields are:
1. `category` (Literal['refund', 'billing', 'invoice', 'bug', 'account', 'other']):
All interactions will be structured in the following way, with the appropriate values filled in.

[[ ## ticket ## ]]
{ticket}

[[ ## category ## ]]
{category}        # note: the value you produce must exactly match (no extra characters) one of: refund; billing; invoice; bug; account; other

[[ ## completed ## ]]
In adhering to this structure, your objective is: 
        把客服工单分到一个类别。


User message:

[[ ## ticket ## ]]
信用卡续费没扣成功,页面提示 card_declined,怎么办?

Respond with the corresponding output fields, starting with the field `[[ ## category ## ]]` (must be formatted as a valid Python Literal['refund', 'billing', 'invoice', 'bug', 'account', 'other']), and then ending with the marker for `[[ ## completed ## ]]`.


Response:

[[ ## category ## ]]
billing

[[ ## completed ## ]]
```

这就是 DSPy 替你写的 prompt。它把每个字段渲染成 `[[ ## 字段名 ## ]]` 这种分隔标记,把 `Literal` 的六个可选值写进了说明,你那句指令只是 system 消息末尾的一行。模型照着这个格式回复,DSPy 再按标记把 `billing` 取出来。负责「字段 ↔ prompt 文字」来回翻译的那一层,DSPy 叫 **adapter**(适配器),这里用的是默认的 ChatAdapter。

这一次调用输入、输出加起来几百个 token,不到 1 分钱,账就不单列了。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="DSPy 的分工:你写 Signature(字段和指令)和选 Module,adapter 把它们渲染成带分隔标记的 prompt 发给模型,再把回复解析回字段;GEPA 只改指令那一段">
<rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="30" width="170" height="110" rx="6" fill="none" stroke="var(--ink-soft)"/>
<text x="35" y="52" fill="var(--ink)">你写的</text>
<text x="35" y="76" fill="var(--ink-soft)" font-size="11">Signature:</text>
<text x="45" y="94" fill="var(--ink-soft)" font-size="11">ticket → category</text>
<text x="45" y="112" fill="var(--compute)" font-size="11">指令(docstring)</text>
<text x="35" y="130" fill="var(--ink-soft)" font-size="11">Module: Predict</text>
<rect x="235" y="30" width="170" height="110" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="250" y="52" fill="var(--ink)">adapter</text>
<text x="250" y="76" fill="var(--ink-soft)" font-size="11">渲染成</text>
<text x="250" y="94" fill="var(--ink-soft)" font-size="11">[[ ## ticket ## ]]</text>
<text x="250" y="112" fill="var(--ink-soft)" font-size="11">再从回复里</text>
<text x="250" y="130" fill="var(--ink-soft)" font-size="11">解析出 category</text>
<rect x="450" y="30" width="170" height="110" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="465" y="52" fill="var(--ink)">模型</text>
<text x="465" y="76" fill="var(--ink-soft)" font-size="11">经 LiteLLM 调</text>
<text x="465" y="94" fill="var(--ink-soft)" font-size="11">deepseek-flash</text>
<line x1="190" y1="85" x2="233" y2="85" stroke="var(--ink-soft)"/>
<line x1="405" y1="75" x2="448" y2="75" stroke="var(--ink-soft)"/>
<line x1="448" y1="105" x2="405" y2="105" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
<text x="20" y="180" fill="var(--ink-soft)" font-size="11">GEPA 只改橙色那一行「指令」;字段、格式、可选值由 adapter 管,优化器碰不到。</text>
<text x="20" y="200" fill="var(--ink-faint)" font-size="11">所以同一句指令,放进 DSPy 和放进我们手拼的 messages,分数可能不一样(第四步实测)。</text>
</g>
</svg>
<figcaption>DSPy 里谁管什么。你声明字段和指令,adapter 负责和模型来回翻译,优化器只改指令。</figcaption>
</figure>

## 第三步:先把 GEPA 的三个报错踩一遍

`dspy.GEPA` 有三个参数写错就跑不起来。先故意写错,看清报错长什么样,跑大的时候少花冤枉钱。这个脚本只构造对象,不调模型:

```python
# agent-zero-lab/part06/gepa_errors.py
"""Day 369:故意把 GEPA 的三个参数写错,看它各报什么。只构造对象,不调模型。
用法: uv run python -m part06.gepa_errors"""
from __future__ import annotations

import dspy


def two_args(gold, pred):
    return 1.0


def five_args(gold, pred, trace=None, pred_name=None, pred_trace=None):
    return 1.0


reflection_lm = dspy.LM("openai/deepseek-flash")
tries = {
    "评分函数只有两个参数": lambda: dspy.GEPA(metric=two_args, max_metric_calls=10, reflection_lm=reflection_lm),
    "预算设了两种": lambda: dspy.GEPA(metric=five_args, auto="light", max_metric_calls=10, reflection_lm=reflection_lm),
    "忘了反思模型": lambda: dspy.GEPA(metric=five_args, max_metric_calls=10),
}
for name, make in tries.items():
    try:
        make()
        print(f"{name}: 没报错")
    except (TypeError, AssertionError) as e:
        print(f"{name}: {type(e).__name__}: {str(e)[:120]}")
```

<div class="line-notes">

- `def two_args(gold, pred):` 很多 DSPy 老教程里的评分函数就是两个参数(标准答案、模型预测),别的优化器认,GEPA 不认。
- `def five_args(gold, pred, trace=None, pred_name=None, pred_trace=None):` GEPA 要求的五个参数。后三个是给多步程序用的(哪一步、那一步的轨迹),今天的单步分类用不上,给默认值 None 就行。
- `reflection_lm = dspy.LM("openai/deepseek-flash")` 只构造 LM 对象不会发请求,所以这里连 key 都不用填。
- `tries = {` 字典的值是 `lambda`,把「构造 GEPA」包起来,等到循环里才真正执行,这样每一个的报错都能被 `try` 接住。
- `except (TypeError, AssertionError) as e:` 括号里写多个异常类型,接住其中任何一个。
- `print(f"{name}: {type(e).__name__}: {str(e)[:120]}")` 报错信息很长,只打前 120 个字符。

</div>

```bash
uv run python -m part06.gepa_errors
```

实测输出:

```text
评分函数只有两个参数: TypeError: GEPA metric must accept five arguments: (gold, pred, trace, pred_name, pred_trace). See https://dspy.ai/api/optimizers/G
预算设了两种: AssertionError: Exactly one of max_metric_calls, max_full_evals, auto must be set. You set max_metric_calls=10, max_full_evals=None, aut
忘了反思模型: AssertionError: GEPA requires a reflection language model, or custom instruction proposer to be provided. Typically, you can use `dspy.L
```

三条都在构造时就报了,不会等跑了一半才炸。第二条要记住:预算只能用一种方式给,`auto="light"/"medium"/"heavy"`、`max_full_evals`(把训练加验证集完整跑几遍)、`max_metric_calls`(评分函数最多调几次)三选一。我推荐 `max_metric_calls`,因为一次评分差不多就是一次执行模型调用,最好估钱。

## 第四步:用 GEPA 优化同一个任务

现在把昨天的任务搬进 DSPy,交给 GEPA。

```python
# agent-zero-lab/part06/gepa_opt.py
"""Day 369:用 DSPy 的 GEPA 优化同一个工单分类任务。依赖: uv add dspy
用法: uv run python -m part06.gepa_opt [bare] 2>/dev/null | grep -av "it/s" """
from __future__ import annotations

import json
import logging
import os
import sys
from typing import Any, Literal

import dspy
from dotenv import load_dotenv

from part06.opt_task import BARE_PROMPT, BASE_PROMPT, load

load_dotenv()
logging.getLogger("dspy").setLevel(logging.WARNING)
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY") or "{}")
HIT, MISS, OUT = (float(x) for x in os.environ.get("LLM_PRICE", "0,0,0").split(","))
START = BARE_PROMPT if "bare" in sys.argv[1:] else BASE_PROMPT


def make_lm(**kw) -> dspy.LM:
    return dspy.LM(f"openai/{os.environ['LLM_MODEL']}", api_base=os.environ["LLM_BASE_URL"],
                   api_key=os.environ["LLM_API_KEY"], extra_body=EXTRA, cache=False, **kw)


class Triage(dspy.Signature):
    ticket: str = dspy.InputField(desc="客户工单原文")
    category: Literal["refund", "billing", "invoice", "bug", "account", "other"] = dspy.OutputField()


def to_examples(split: str) -> list[dspy.Example]:
    return [dspy.Example(ticket=r["ticket"], label=r["label"], why=r["why"]).with_inputs("ticket")
            for r in load(split)]


def metric(gold, pred, trace=None, pred_name=None, pred_trace=None):
    if pred.category == gold.label:
        return dspy.Prediction(score=1.0, feedback="分类正确。")
    return dspy.Prediction(score=0.0, feedback=f"应为 {gold.label},模型答 {pred.category}。标注理由:{gold.why}")


def accuracy(program: dspy.Module, split: str) -> float:
    ev = dspy.Evaluate(devset=to_examples(split), metric=lambda g, p, t=None: float(p.category == g.label),
                       num_threads=8, display_progress=False)
    return ev(program).score / 100


def bill(lm: dspy.LM) -> str:
    u = [h.get("usage") or {} for h in lm.history]
    pin = sum(x.get("prompt_tokens", 0) for x in u)
    hit = sum(x.get("prompt_cache_hit_tokens", 0) or 0 for x in u)
    out = sum(x.get("completion_tokens", 0) for x in u)
    yuan = (hit * HIT + (pin - hit) * MISS + out * OUT) / 1_000_000
    return f"{len(u)} 次调用,输入 {pin}(缓存命中 {hit})/ 输出 {out} tokens,约 ¥{yuan:.3f}"


def main() -> None:
    task_lm, reflection_lm = make_lm(temperature=0), make_lm(temperature=1.0)
    dspy.configure(lm=task_lm)
    student = dspy.Predict(Triage.with_instructions(START))
    print(f"起点 val {accuracy(student, 'val'):.0%}  test {accuracy(student, 'test'):.0%}")

    gepa = dspy.GEPA(metric=metric, max_metric_calls=300, reflection_lm=reflection_lm,
                     reflection_minibatch_size=3, num_threads=8, track_stats=True)
    best: Any = gepa.compile(student, trainset=to_examples("train"), valset=to_examples("val"))

    r = best.detailed_results
    for i, (score, parents) in enumerate(zip(r.val_aggregate_scores, r.parents)):
        print(f"候选 {i}:val {score:.0%},父节点 {parents}")
    print(f"选中候选 {r.best_idx}:val {accuracy(best, 'val'):.0%}  test {accuracy(best, 'test'):.0%}")
    print("\n新指令:\n" + best.signature.instructions)
    best.save("part06/triage_gepa.json")
    print(f"\n执行模型:{bill(task_lm)}\n反思模型:{bill(reflection_lm)}")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from typing import Any, Literal` `Any` 用在下面 `best` 上,原因到那一行再说。
- `logging.getLogger("dspy").setLevel(logging.WARNING)` GEPA 每一轮都打 INFO 日志,包括候选 prompt 全文,刷满一屏。先只留警告,想看过程再改回 `logging.INFO`。
- `HIT, MISS, OUT = (float(x) for x in os.environ.get("LLM_PRICE", "0,0,0").split(","))` 把 `.env` 里的 `0.04,2,8` 拆成三个价格,下面 `bill()` 自己算钱。三个变量同时赋值,相当于 JS 的解构 `const [hit, miss, out] = ...`。
- `def make_lm(**kw) -> dspy.LM:` 执行模型和反思模型只差 temperature,用一个函数造,`**kw` 把多出来的参数原样传给 `dspy.LM`。
- `class Triage(dspy.Signature):` 和第二步一样,只是不写 docstring,指令由下面 `with_instructions` 塞进去。
- `return [dspy.Example(ticket=r["ticket"], label=r["label"], why=r["why"]).with_inputs("ticket")` `Example` 像一个字典。`with_inputs("ticket")` 告诉 DSPy 只有 ticket 是输入,label 和 why 是答案,不能喂给模型。数据还是昨天那 60 条、同样的切法。
- `def metric(gold, pred, trace=None, pred_name=None, pred_trace=None):` 第三步说过的五个参数。`gold` 是那条 `Example`,`pred` 是模型的预测。
- `return dspy.Prediction(score=1.0, feedback="分类正确。")` 答对返回 1 分。`Prediction` 也像字典,GEPA 从里面取 `score` 和 `feedback`。
- `return dspy.Prediction(score=0.0, feedback=f"应为 {gold.label},模型答 {pred.category}。标注理由:{gold.why}")` 整个 GEPA 最关键的一行:除了分数,还返回一段文字反馈。比如 t22 答错时反馈是「应为 billing,模型答 bug。标注理由:付款没成功属于 billing,不是 bug」。反思模型读到的就是它,作用和第一步 `lines` 里的「理由」一样。
- `ev = dspy.Evaluate(devset=to_examples(split), metric=lambda g, p, t=None: float(p.category == g.label),` DSPy 自带的评测器,并发跑一批样本取平均分。这里的评分函数只要分数,用不着反馈。
- `return ev(program).score / 100` `Evaluate` 返回的 score 是百分数(比如 95.0),除以 100 和前面的格式统一。
- `u = [h.get("usage") or {} for h in lm.history]` 每个 `dspy.LM` 都把调用记录存在 `history` 列表里,每条有 `usage`。DSPy 不走 `LLMClient`,只能从这里加总。
- `hit = sum(x.get("prompt_cache_hit_tokens", 0) or 0 for x in u)` DeepSeek 在 usage 里返回缓存命中的 token 数。`or 0` 防止它是 None。
- `yuan = (hit * HIT + (pin - hit) * MISS + out * OUT) / 1_000_000` 和 `LLMClient` 一样的算法:命中的按 0.04,没命中的按 2,输出按 8,每百万 token。`1_000_000` 里的下划线只是为了好读。
- `task_lm, reflection_lm = make_lm(temperature=0), make_lm(temperature=1.0)` 执行模型用 0;反思模型用 1.0,让它敢写出不一样的版本。DSPy 的报错提示里还建议反思模型用更强的模型,今天为了省钱两个用同一个。
- `student = dspy.Predict(Triage.with_instructions(START))` `with_instructions` 返回一个指令换成 START 的新 Signature。要被优化的程序,DSPy 习惯叫 student。
- `gepa = dspy.GEPA(metric=metric, max_metric_calls=300, reflection_lm=reflection_lm,` 预算 300 次评分。
- `reflection_minibatch_size=3, num_threads=8, track_stats=True)` 每轮从训练集抽 3 条给反思模型看;`track_stats=True` 才会在结果上挂 `detailed_results`。
- `best: Any = gepa.compile(student, trainset=to_examples("train"), valset=to_examples("val"))` 训练集用来找错例,验证集用来给每个候选打全量分、维护 Pareto 前沿。测试集不传进去。标成 `Any` 是因为 DSPy 的类型标注里没有 `detailed_results` 这些动态加上去的属性,不标的话编辑器会画红线(代码照样能跑)。
- `for i, (score, parents) in enumerate(zip(r.val_aggregate_scores, r.parents)):` 每个候选在验证集上的总分,和它是从哪个候选改出来的。`enumerate` 同时给出下标,相当于 JS 的 `arr.forEach((x, i) => ...)`。
- `print(f"选中候选 {r.best_idx}:val {accuracy(best, 'val'):.0%}  test {accuracy(best, 'test'):.0%}")` GEPA 最后交给你的是验证集总分最高的候选。测试集直到这里才第一次出现。
- `best.save("part06/triage_gepa.json")` 存成 JSON,上线时读回来就能用(第五步)。这个文件要进 git,和代码一起评审。

</div>

GEPA 内部每评一批样本都打一行进度条,几百行刷屏。DSPy 3.4.1 里我没找到关掉它的参数,所以用 `grep -av "it/s"` 把带 `it/s`(每秒几个)的行滤掉;`2>/dev/null` 把标准错误里的警告也扔掉。先从 BARE 起步,跑完把结果文件复制一份留着,再从 BASE 起步:

```bash
uv run python -m part06.gepa_opt bare 2>/dev/null | grep -av "it/s"
cp part06/triage_gepa.json part06/triage_gepa_bare.json
uv run python -m part06.gepa_opt 2>/dev/null | grep -av "it/s"
```

<div class="line-notes">

- `uv run python -m part06.gepa_opt bare 2>/dev/null | grep -av "it/s"` `2>/dev/null` 丢掉标准错误;`|` 把标准输出交给 `grep`;`-v` 是反选(不含 `it/s` 的行才留下),`-a` 让 grep 把输出当文本处理,进度条里有特殊字符时不会被当成二进制。终端课 [Day 5](/blog/agent-zero/day-005-terminal-3/) 讲过管道和 grep。
- `cp part06/triage_gepa.json part06/triage_gepa_bare.json` 两次运行都存到同一个文件名,第二次会覆盖第一次,先复制一份。

</div>

BARE 那次实测输出(每次一分半到两分钟):

```text
起点 val 90%  test 75%
候选 0:val 90%,父节点 [None]
候选 1:val 95%,父节点 [0]
候选 2:val 95%,父节点 [1]
候选 3:val 90%,父节点 [2]
候选 4:val 90%,父节点 [2]
候选 5:val 90%,父节点 [2]
候选 6:val 95%,父节点 [2]
候选 7:val 95%,父节点 [6]
选中候选 1:val 95%  test 75%

新指令:
将客服工单分类到以下类别之一：refund、billing、invoice、bug、account、other。分类时请遵循以下规则：
- 如果工单涉及登录、账户访问、密码重置、权限设置或账户管理问题，归类为 account，即使包含错误码或技术细节。
- 如果工单涉及退款请求或退款流程，归类为 refund。
- 如果工单涉及账单费用、支付问题或扣款异常，归类为 billing。
- 如果工单涉及发票开具、发票作废、发票修改等，归类为 invoice。
- 如果工单涉及软件缺陷、系统错误、功能异常（但登录问题除外），归类为 bug。
- 如果工单无法明确归入以上类别，归类为 other。
请只输出类别名称，不要解释。

执行模型:381 次调用,输入 164575(缓存命中 71296)/ 输出 5138 tokens,约 ¥0.231
反思模型:7 次调用,输入 4938(缓存命中 2176)/ 输出 1926 tokens,约 ¥0.021
```

先读候选列表。候选 0 是起点,父节点 `[None]`。候选 1 从 0 改来,验证集 95%;候选 2 从 1 改来;候选 3 到 6 都从 2 改来;候选 7 从 6 改来。这是一棵演化树。有 4 个候选打平在 95%,GEPA 选了最早出现的候选 1。

再看分数。验证集 90% → 95%,测试集 75% → 75%,一条没多对。

最后读新指令,问题一眼就能看出来:refund 那行写的是「退款请求或退款流程」,billing 那行写着「扣款异常」。**「重复扣款」这四个字没了。** 昨天练习 2 看到 BARE 最大的一类错就是「被扣了两次 → billing」,新指令不但没修好,还把扣款明明白白写进了 billing。这就是 ACE 论文说的简短偏好:反思模型把规则写得干净利落,顺手丢掉了最关键的细节。为什么会丢?每轮反思只看随机抽的 3 条训练样本,抽到的那几批里可能根本没有重复扣款的错例,它就不知道这条有多重要。

花费:执行模型 (71296 × 0.04 + 93279 × 2 + 5138 × 8) / 100 万 ≈ 0.231 元,反思模型约 0.021 元,合计约 0.25 元。381 次执行调用、7 次反思调用:**钱几乎全花在执行模型上**,反思只占一成不到。300 次预算之外多出来的 81 次,是开头结尾我自己量起点和终点分数用的。

BASE 那次:

```text
起点 val 95%  test 95%
候选 0:val 95%,父节点 [None]
候选 1:val 95%,父节点 [0]
候选 2:val 95%,父节点 [1]
候选 3:val 95%,父节点 [2]
选中候选 0:val 95%  test 95%

新指令:
把客服工单分到一个类别。
refund=要求退款/重复扣款/取消后退钱;billing=扣款失败、欠费、价格、升级计费;
invoice=开票、发票抬头、发票类型;bug=报错、功能异常;account=登录、验证码、权限、注销;other=其他

执行模型:382 次调用,输入 242490(缓存命中 162176)/ 输出 5184 tokens,约 ¥0.209
反思模型:3 次调用,输入 2243(缓存命中 768)/ 输出 1274 tokens,约 ¥0.013
```

两个意外。

第一个:同样的 BASE 指令、同样的模型,放进 DSPy,起点就是验证集 95%、测试集 95%,而昨天 `opt_task.py` 里我们手拼的版本是验证集 80–85%、测试集 90%。差别在第二步看到的 adapter:每个字段有分隔标记,六个可选值明确列出,还要求「必须完全匹配其中之一」。**prompt 的格式和字段约束,有时比措辞的影响还大。** 这件事本身就值得记一笔:上优化器之前,先把最便宜的改动做了。

第二个:GEPA 提出 3 个新候选,验证集全是 95%,和起点打平,最后选回了候选 0,也就是原样还给你。起点已经 95% 了,验证集 20 条里只错 1 条,没多少可改的。它没有为了「看起来优化过」硬塞一个版本给你,这是对的行为。花费约 0.22 元,换来「不用改」这个结论。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="Pareto 前沿示意:横向是验证集里的样本,纵向是候选,每格表示该候选在该样本上对或错;GEPA 保留在至少一个样本上不被其他候选全面超越的候选">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="11">
<text x="20" y="24" fill="var(--ink)" font-size="12">验证集样本 →</text>
<text x="150" y="44" fill="var(--ink-soft)">v1</text><text x="190" y="44" fill="var(--ink-soft)">v2</text><text x="230" y="44" fill="var(--ink-soft)">v3</text><text x="270" y="44" fill="var(--ink-soft)">v4</text><text x="310" y="44" fill="var(--ink-soft)">v5</text><text x="350" y="44" fill="var(--ink-soft)">v6</text>
<text x="20" y="72" fill="var(--ink)">候选 A</text>
<rect x="145" y="58" width="24" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/><rect x="185" y="58" width="24" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/><rect x="225" y="58" width="24" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/><rect x="265" y="58" width="24" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/><rect x="305" y="58" width="24" height="20" fill="none" stroke="var(--rule)"/><rect x="345" y="58" width="24" height="20" fill="none" stroke="var(--rule)"/>
<text x="390" y="72" fill="var(--ink-soft)">总分 4/6,v1–v4 做得最好 → 留</text>
<text x="20" y="104" fill="var(--ink)">候选 B</text>
<rect x="145" y="90" width="24" height="20" fill="none" stroke="var(--rule)"/><rect x="185" y="90" width="24" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/><rect x="225" y="90" width="24" height="20" fill="none" stroke="var(--rule)"/><rect x="265" y="90" width="24" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/><rect x="305" y="90" width="24" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/><rect x="345" y="90" width="24" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="390" y="104" fill="var(--ink-soft)">总分 4/6,只有它做对 v5、v6 → 留</text>
<text x="20" y="136" fill="var(--ink)">候选 C</text>
<rect x="145" y="122" width="24" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/><rect x="185" y="122" width="24" height="20" fill="none" stroke="var(--rule)"/><rect x="225" y="122" width="24" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/><rect x="265" y="122" width="24" height="20" fill="none" stroke="var(--rule)"/><rect x="305" y="122" width="24" height="20" fill="none" stroke="var(--rule)"/><rect x="345" y="122" width="24" height="20" fill="none" stroke="var(--rule)"/>
<text x="390" y="136" fill="var(--ink-soft)">它做对的 A 全都做对 → 淘汰</text>
<text x="20" y="176" fill="var(--ink-soft)">只按总分选,A 和 B 打平时随便丢一个,B 学到的「v5、v6 那类规则」就没了。</text>
<text x="20" y="196" fill="var(--ink-soft)">Pareto 前沿把 A、B 都留下,下一轮可能从 B 出发改,也可能把 A、B 合并。</text>
<text x="20" y="216" fill="var(--ink-soft)">最终交给你的,仍然是验证集总分最高的那个(best_idx)。</text>
</g>
</svg>
<figcaption>GEPA 名字里的 P。图里的 v1–v6 和三个候选是示意,不是实测。</figcaption>
</figure>

**Pareto 前沿**这个词来自经济学,意思是「在任何一个维度上都没法不牺牲别的维度而变得更好」的那一组。放到这里,每个验证样本算一个维度:一个候选只要在某个样本上做得比所有别的候选都好(或一样好),就留下。上图里 A 和 B 总分一样,但各自做对了对方做不对的样本,两个都留;C 做对的样本 A 全都做对,C 被淘汰。下一轮从前沿里挑一个接着改。这样不会把所有努力押在一个版本上。BARE 那次的演化树里,候选 3、4、5、6 都从候选 2 长出来,就是候选 2 一直留在前沿上、被反复挑中的结果。

## 第五步:把存下的程序读回来

优化完的东西要能上线用。DSPy 的做法是:建一个同样 Signature 的空程序,`load` 刚才存的 JSON,指令就恢复了。顺便在测试集上逐条看 BARE 那次选中的候选错在哪:

```python
# agent-zero-lab/part06/gepa_check.py
"""Day 369:把 GEPA 存下来的程序读回来,在测试集上逐条看错在哪。
用法: uv run python -m part06.gepa_check [part06/triage_gepa.json]"""
from __future__ import annotations

import sys
from typing import Any

import dspy

from part06.gepa_opt import Triage, bill, load, make_lm

if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "part06/triage_gepa.json"
    lm = make_lm(temperature=0)
    dspy.configure(lm=lm)
    program: Any = dspy.Predict(Triage)
    program.load(path)
    print("指令前 60 字:", program.signature.instructions[:60].replace("\n", " "))
    rows = load("test")
    wrong = []
    for r in rows:
        got = program(ticket=r["ticket"]).category
        if got != r["label"]:
            wrong.append(f"{r['id']} {r['label']}→{got}")
    print(f"test {1 - len(wrong) / len(rows):.0%}", wrong)
    print(bill(lm))
```

<div class="line-notes">

- `from part06.gepa_opt import Triage, bill, load, make_lm` `load` 是 `gepa_opt.py` 从 `opt_task` 导入的,从这里再导入一次也行。`import` 时 `gepa_opt.py` 的 `main()` 不会执行,因为它在 `if __name__ == "__main__":` 下面。
- `program: Any = dspy.Predict(Triage)` 一个空程序,指令是 Triage 默认的(这里是空的)。
- `program.load(path)` 从 JSON 里恢复指令和示例。JSON 里存的是 `signature.instructions` 和字段说明,不存模型和 key。
- `print("指令前 60 字:", program.signature.instructions[:60].replace("\n", " "))` 先确认读回来的是优化后的指令,不是空的。
- `got = program(ticket=r["ticket"]).category` 一条条串行跑,20 条慢一点但不用写并发。

</div>

```bash
uv run python -m part06.gepa_check part06/triage_gepa_bare.json 2>/dev/null
```

实测输出:

```text
指令前 60 字: 将客服工单分类到以下类别之一：refund、billing、invoice、bug、account、other。分类时请
test 80% ['t12 bug→invoice', 't21 refund→billing', 't57 billing→other', 't60 refund→billing']
20 次调用,输入 8044(缓存命中 5120)/ 输出 269 tokens,约 ¥0.008
```

两件事。t21「同一张发票被扣了两笔钱」和 t60「被扣了两次年费,一共 4784」都被答成 billing,正是新指令丢了「重复扣款」的后果。另外,同一个程序、同一份测试集,`gepa_opt.py` 里量出 75%,这里量出 80%,又差了一条。噪声在 DSPy 里一样存在。

## 第六步:把数字放在一起

| 做法 | 起点 | 验证集 | 测试集 | 花费(约) |
| --- | --- | --- | --- | --- |
| 手拼 prompt 不优化(Day 368) | BASE | 80–85% | 90% | 0.018 元/次 |
| 自写反思循环 | BASE | 85% → 95% | 90% | 0.065 元 |
| DSPy 格式不优化 | BASE | 95% | 95% | 几分钱 |
| GEPA(300 次评分) | BASE | 95%(选回起点) | 95% | 0.22 元 |
| 手拼 prompt 不优化(Day 368) | BARE | 85% | 80% | 0.012 元/次 |
| 自写反思循环 | BARE | 85% → 85% | 90% | 0.080 元 |
| DSPy 格式不优化 | BARE | 90% | 75% | 几分钱 |
| GEPA(300 次评分) | BARE | 90% → 95% | 75%(读回再量 80%) | 0.25 元 |

都是单次运行,20 条上一条就是 5 个百分点。按昨天算的,20 条上量出 90%,真实值落在 70% 到 97% 之间都不奇怪。所以这张表能下的结论很有限,我只敢说三件:

**起点写得好的时候,自动优化没让测试集变好。** BASE 两种方法测试集都没动,反思循环在验证集上涨了 10 个点,是被挑出来的。剩下的错误要么本身模棱两可(t57「教育优惠」算价格咨询还是 other),要么需要训练集里根本没有的反例。

**起点很粗的时候,从错例和理由里学规则是真有效。** BARE 加自写循环,测试集 80% → 90%,refund 的定义几乎一字不差地学回来了。同时也学了一条宽规则,带错了 t33。

**GEPA 在这么小的数据上并不比 60 行的循环强。** 它从 BARE 出发,验证集涨了 5 个点,测试集没动,还把最关键的「重复扣款」改丢了;从 BASE 出发它选回了原样。论文里平均高几个到十几个点,是在数据多得多、空间大得多的任务上量的。另一方面,光是换成 DSPy 的结构化格式,BASE 就从 90% 到了 95%。

你在工作里遇到同样的情况,我的建议是:先把格式和字段约束这类便宜的事做了;要上优化器,先把测试集扩到几百条,反馈文字写具体;优化器给出的新 prompt 当成一个同事提的 PR,人逐行审,丢了的规则补回来,宽了的规则收窄,再过测试集门禁。练习 4 就写一个这样的审查脚本。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/OA-Mc60Rboo" title="Beating RL With Reflection: GEPA and Optimize Anything" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · Beating RL With Reflection: GEPA and Optimize Anything(Lakshya A. Agrawal)· 英文,GEPA 作者本人讲反思和 Pareto 前沿为什么比只看分数省样本。重点看前半段的机制,对照今天第四步的候选列表。</figcaption>
</figure>

### 小结

反思循环就是「跑训练集拿错例 → 把 prompt、错例、理由交给反思模型 → 取出新版 → 验证集不降就采用 → 测试集最后量一次」,60 行写完。DSPy 让你声明字段和指令,由 adapter 拼 prompt;GEPA 的评分函数要五个参数,返回分数和文字反馈,它保留 Pareto 前沿上的多个候选,最后选验证集总分最高的。实测两件事最要紧:优化器会把规则写宽(钱优先带错 t33),也会把细节写丢(重复扣款没了);验证集上涨在 20 条上多半是被挑出来的,只信测试集,而且差距在一两条以内时什么都别信。

## 动手练习

### 练习 1:去掉「写成通用规则」

把反思 prompt 里「写成通用规则,不要逐字抄工单原文」那一句去掉,从 BARE 起步只反思一轮,看新 prompt 会不会抄训练集工单的原文,以及三份数据上的分数。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex369_copy.py
"""练习 1:反思 prompt 去掉「写成通用规则」那一句,看反思模型会不会把工单原文抄进 prompt。
用法: uv run python -m part06.ex369_copy"""
from __future__ import annotations

from common.llm import LLMClient
from part06 import reflect_loop
from part06.opt_task import BARE_PROMPT, evaluate, load

reflect_loop.REFLECT = reflect_loop.REFLECT.replace("- 写成通用规则,不要逐字抄工单原文\n", "")


def copied(prompt: str, rows: list[dict], n: int = 8) -> list[str]:
    hits = []
    for r in rows:
        t = r["ticket"]
        if any(t[i:i + n] in prompt for i in range(len(t) - n + 1)):
            hits.append(r["id"])
    return hits


if __name__ == "__main__":
    client = LLMClient()
    train = load("train")
    _, errors = evaluate(client, BARE_PROMPT, train)
    print("训练集错例:", [e["id"] for e in errors])
    cand = reflect_loop.reflect(client, BARE_PROMPT, errors)
    print(f"\n新 prompt({len(cand)} 字):\n{cand}\n")
    print("连续 8 个字和训练集工单一样的:", copied(cand, train))
    for split in ["train", "val", "test"]:
        acc, errs = evaluate(client, cand, load(split))
        print(f"{split}: {acc:.0%}", [e["id"] for e in errs])
    print(client.ledger)
```

<div class="line-notes">

- `from part06 import reflect_loop` 导入整个模块,而不是只导入函数,下一行才能改模块里的变量。
- `reflect_loop.REFLECT = reflect_loop.REFLECT.replace("- 写成通用规则,不要逐字抄工单原文\n", "")` 把模块里的反思 prompt 换掉那一行。`reflect()` 每次调用时才去读 `REFLECT`,所以改了以后它用的就是新的。这种「运行时改别人模块里的值」叫猴子补丁,练习里用用可以,正式代码别这么干。
- `def copied(prompt: str, rows: list[dict], n: int = 8) -> list[str]:` 粗略判断有没有抄:工单里任意连续 8 个字出现在新 prompt 里,就算抄了。
- `if any(t[i:i + n] in prompt for i in range(len(t) - n + 1)):` 在工单原文上滑一个 8 字的窗口,`any` 只要有一个窗口命中就是 True。相当于 JS 的 `.some()`。
- `cand = reflect_loop.reflect(client, BARE_PROMPT, errors)` 只反思一轮,不验收,直接看它写了什么。

</div>

```bash
uv run python -m part06.ex369_copy
```

实测输出:

```text
训练集错例: ['t01', 't13', 't16', 't22', 't31']

新 prompt(465 字):
将客服工单归为六类之一：refund、billing、invoice、bug、account、other。判定规则与优先级如下：

1. refund：涉及把钱退回客户（退款、多扣/重复扣款、取消订阅后仍被扣款、注销时退余额）。即使客户未明确说“退款”，只要涉及资金退回，均归 refund。
2. account：登录/登出异常、账号注销、账号信息与权限问题。登录失败即使带错误码（如 E1101）也归 account，不归 bug。
3. billing：付款/扣款流程本身的问题（如支付超时、支付失败、扣款未成功、订单未生成），以及账单金额疑问但无退款诉求。
4. invoice：发票开具、发票信息、发票下载等票据问题。
5. bug：产品功能异常且不涉及资金、登录、账号的场景（如页面崩溃、功能报错）。
6. other：以上均不适用的其他咨询或投诉。

优先级：refund > account > billing > bug；invoice 独立判定；其余归 other。当工单同时涉及多类时，按上述优先级取最高者。

连续 8 个字和训练集工单一样的: []
train: 95% ['t46']
val: 90% ['t08', 't35']
test: 80% ['t03', 't12', 't39', 't57']
81 次调用 | 输入 19632 / 输出 761 tokens | 约 ¥0.0323
```

这一次没有大段照抄,8 字检查是空的。但仔细看 account 那行:「如 E1101」,这是 t31 工单里的错误码原样搬了进来。模型没抄句子,抄了一个具体的值,这种东西对新工单没有任何帮助(别的登录错误码不叫 E1101)。分数上,训练集 95%、测试集 80%,测试集和 BARE 起点一样,没进步;多错了 t39(报表合计差 0.01)和 t03(问企业版价格),bug 那行「不涉及资金」把 t39 推了出去。

结论:一次实验没看到大段照抄,不代表那句话没用。它挡的是最坏的情况,而且「如 E1101」这种小抄,只靠 8 字检查查不出来,得人读。

</details>

### 练习 2:评分函数只给分数

把 GEPA 的评分函数改成只返回分数(`float`,GEPA 允许),从 BARE 起步跑一次,预算减半到 150 次评分省钱。对比新指令和测试集分数。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex369_nofeedback.py
"""练习 2:评分函数只给分数、不给理由,GEPA 从 BARE 起步还能改出什么。预算减半到 150 次评分。
用法: uv run python -m part06.ex369_nofeedback 2>/dev/null | grep -av "it/s" """
from __future__ import annotations

from typing import Any

import dspy

from part06.gepa_opt import Triage, accuracy, bill, make_lm, to_examples
from part06.opt_task import BARE_PROMPT


def score_only(gold, pred, trace=None, pred_name=None, pred_trace=None):
    return float(pred.category == gold.label)


if __name__ == "__main__":
    task_lm, reflection_lm = make_lm(temperature=0), make_lm(temperature=1.0)
    dspy.configure(lm=task_lm)
    student = dspy.Predict(Triage.with_instructions(BARE_PROMPT))
    gepa = dspy.GEPA(metric=score_only, max_metric_calls=150, reflection_lm=reflection_lm,
                     reflection_minibatch_size=3, num_threads=8, track_stats=True)
    best: Any = gepa.compile(student, trainset=to_examples("train"), valset=to_examples("val"))
    r = best.detailed_results
    for i, (score, parents) in enumerate(zip(r.val_aggregate_scores, r.parents)):
        print(f"候选 {i}:val {score:.0%},父节点 {parents}")
    print(f"选中候选 {r.best_idx}:test {accuracy(best, 'test'):.0%}")
    print("\n新指令:\n" + best.signature.instructions)
    print(f"\n执行模型:{bill(task_lm)}\n反思模型:{bill(reflection_lm)}")
```

<div class="line-notes">

- `def score_only(gold, pred, trace=None, pred_name=None, pred_trace=None):` 参数还得是五个,只是返回值变了。
- `return float(pred.category == gold.label)` 只有 1.0 或 0.0,没有 `why`。反思模型能看到的只剩工单原文、模型答案和这个分数,看不到正确答案的理由。
- `max_metric_calls=150` 预算减半,花费也差不多减半。和正文的 300 次比,候选会少一些。
- `print(f"选中候选 {r.best_idx}:test {accuracy(best, 'test'):.0%}")` 这次没量起点,起点 BARE 在 DSPy 格式下的测试集是第四步量过的 75%。

</div>

```bash
uv run python -m part06.ex369_nofeedback 2>/dev/null | grep -av "it/s"
```

实测输出:

```text
候选 0:val 90%,父节点 [None]
候选 1:val 95%,父节点 [0]
候选 2:val 90%,父节点 [1]
选中候选 1:test 75%

新指令:
将客服工单分类到以下类别之一:refund、billing、invoice、bug、account、other。分类时需要根据工单的主要意图进行判断。如果工单同时涉及多个问题,例如注销账户并要求退款余额,这属于账户注销流程中的退款请求,应归为 refund 类别。其他类别按语义对应:退款/退货 -> refund;支付/扣款/充值/续费问题 -> billing;发票/抬头/开票信息 -> invoice;程序错误/异常/故障 -> bug;账户注册/注销/信息修改/安全 -> account;无法归入以上类别的 -> other。输出格式为 JSON 对象,包含一个键 "category",值为类别名称。

执行模型:173 次调用,输入 67808(缓存命中 20224)/ 输出 2356 tokens,约 ¥0.115
反思模型:11 次调用,输入 7028(缓存命中 3456)/ 输出 3011 tokens,约 ¥0.031
```

没有理由,反思模型还是改出了东西,而且看起来学到了一条:「注销账户并要求退款余额……应归为 refund」。但这一句几乎就是 t13 的原文换了个说法,它是从一个具体错例里「猜」出来的特例,不是规则。扣款类照样写进了 billing(「支付/扣款/充值/续费问题 -> billing」),和有反馈那次犯一样的错。测试集 75%,和起点一样。

还有一个副作用:它在末尾加了「输出格式为 JSON 对象」,而 DSPy 的 adapter 要的是 `[[ ## category ## ]]` 那种格式。这次没出事,但这种和框架格式打架的话,审 diff 时要删掉。

能下的结论:在这么小的数据上,有没有反馈,测试集分数看不出差别(都是 75%);能看出差别的是新指令的写法,有反馈时它写的是 `why` 里的规则,没反馈时写的是错例本身。数据大了以后,前者能推广,后者不能。花费约 0.146 元。

</details>

### 练习 3:打平不采用

把自写循环的验收规则从 `>=` 改成 `>`,从 BASE 起步跑一次,和正文那次比。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex369_strict.py
"""练习 3:验收规则从 >= 改成 >,打平不采用。从 BASE 起步,和原版比。
用法: uv run python -m part06.ex369_strict"""
from __future__ import annotations

from common.llm import LLMClient
from part06.opt_task import BASE_PROMPT, evaluate, load
from part06.reflect_loop import reflect

if __name__ == "__main__":
    client = LLMClient()
    train, val = load("train"), load("val")
    best = BASE_PROMPT
    best_val, _ = evaluate(client, best, val)
    print(f"起点 val {best_val:.0%}")
    for step in range(1, 5):
        _, errors = evaluate(client, best, train)
        if not errors:
            print(f"第 {step} 轮:训练集全对,停")
            break
        cand = reflect(client, best, errors)
        cand_val, _ = evaluate(client, cand, val)
        keep = cand_val > best_val
        print(f"第 {step} 轮:训练集错 {[e['id'] for e in errors]},候选 val {cand_val:.0%},{'采用' if keep else '丢弃'}")
        if keep:
            best, best_val = cand, cand_val
    test_acc, test_err = evaluate(client, best, load("test"))
    print(f"\n最终是{'起点' if best == BASE_PROMPT else '改过的版本'}({len(best)} 字),test {test_acc:.0%}",
          [f"{e['id']} {e['label']}→{e['pred']}" for e in test_err])
    print(client.ledger)
```

<div class="line-notes">

- `from part06.reflect_loop import reflect` 只复用 `reflect()`,循环自己重写一份,方便改那一个符号。
- `keep = cand_val > best_val` 唯一的改动:必须严格更好才采用。
- `print(f"\n最终是{'起点' if best == BASE_PROMPT else '改过的版本'}({len(best)} 字),test {test_acc:.0%}",` 两个字符串用 `==` 比较内容,和 JS 的 `===` 比字符串一样。

</div>

```bash
uv run python -m part06.ex369_strict
```

实测输出:

```text
起点 val 85%
第 1 轮:训练集错 ['t13', 't22'],候选 val 90%,采用
第 2 轮:训练集错 ['t31'],候选 val 90%,丢弃
第 3 轮:训练集错 ['t31'],候选 val 90%,丢弃
第 4 轮:训练集错 ['t31'],候选 val 90%,丢弃

最终是改过的版本(422 字),test 90% ['t12 bug→invoice', 't57 billing→other']
204 次调用 | 输入 53212 / 输出 2368 tokens | 约 ¥0.1055
```

第 1 轮严格更好,采用;之后三轮都是为了修 t31 改出来的候选,验证集都是 90%,打平,全被丢弃,一直卡在 t31 上用满了 4 轮。测试集 90%,和正文 `>=` 那次一样。

两种规则各有代价。`>=` 会接受「换了种说法」的版本,循环走得快,但可能混进没有真实收益的改动;`>` 更保守,可是 20 条的验证集上分数一跳就是 5 个点,很多真实的小改进量不出来,只能被丢掉,还白白多花钱(这次 204 次调用,比正文多 60 多次)。验证集越小,这个两难越明显。根本的解法是扩大验证集,而不是在符号上纠结。

</details>

### 练习 4(开放题):上线前的人审脚本

优化器给的新 prompt 不能直接上线。写一个不调模型的脚本:把新指令和 BASE 逐行 diff,再查一组业务上必须保留的说法还在不在,丢了就以非 0 退出码结束,好放进 CI。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex369_review.py
"""练习 4:上线前人审。把优化器给的新指令和 BASE 逐行 diff,再查几条业务上必须保留的说法还在不在。不调模型。
用法: uv run python -m part06.ex369_review part06/triage_gepa_bare.json"""
from __future__ import annotations

import difflib
import json
import sys
from pathlib import Path

from part06.opt_task import BASE_PROMPT

MUST_KEEP = ["重复扣款", "取消后", "扣款失败", "发票抬头", "注销"]

if __name__ == "__main__":
    new = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))["signature"]["instructions"]
    for line in difflib.unified_diff(BASE_PROMPT.splitlines(), new.splitlines(),
                                     fromfile="BASE", tofile=sys.argv[1], lineterm=""):
        print(line)
    missing = [w for w in MUST_KEEP if w not in new]
    print(f"\n必须保留的说法 {len(MUST_KEEP)} 条,丢了 {len(missing)} 条: {missing}")
    sys.exit(1 if missing else 0)
```

<div class="line-notes">

- `import difflib` 标准库的比较模块,能生成和 `git diff` 一样格式的差异。
- `MUST_KEEP = ["重复扣款", "取消后", "扣款失败", "发票抬头", "注销"]` 业务方确认过、一定要出现在 prompt 里的关键说法。这张表由人维护,不让优化器碰。
- `new = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))["signature"]["instructions"]` 不用 DSPy,直接读 `save()` 出来的 JSON。它的结构是 `{"signature": {"instructions": "...", "fields": [...]}, ...}`。
- `for line in difflib.unified_diff(BASE_PROMPT.splitlines(), new.splitlines(),` 按行比较。`-` 开头是旧版有、新版没有的行,`+` 开头是新加的行。
- `fromfile="BASE", tofile=sys.argv[1], lineterm=""):` 两个文件名只用来打印表头;`lineterm=""` 让每行末尾不再多加换行。
- `sys.exit(1 if missing else 0)` 退出码非 0,CI 就会判这一步失败。[Day 44](/blog/agent-zero/day-044-notebook-project/) 用 `echo $?` 看过退出码。

</div>

```bash
uv run python -m part06.ex369_review part06/triage_gepa_bare.json; echo "退出码 $?"
```

实测输出:

```text
--- BASE
+++ part06/triage_gepa_bare.json
@@ -1,3 +1,8 @@
-把客服工单分到一个类别。
-refund=要求退款/重复扣款/取消后退钱;billing=扣款失败、欠费、价格、升级计费;
-invoice=开票、发票抬头、发票类型;bug=报错、功能异常;account=登录、验证码、权限、注销;other=其他
+将客服工单分类到以下类别之一：refund、billing、invoice、bug、account、other。分类时请遵循以下规则：
+- 如果工单涉及登录、账户访问、密码重置、权限设置或账户管理问题，归类为 account，即使包含错误码或技术细节。
+- 如果工单涉及退款请求或退款流程，归类为 refund。
+- 如果工单涉及账单费用、支付问题或扣款异常，归类为 billing。
+- 如果工单涉及发票开具、发票作废、发票修改等，归类为 invoice。
+- 如果工单涉及软件缺陷、系统错误、功能异常（但登录问题除外），归类为 bug。
+- 如果工单无法明确归入以上类别，归类为 other。
+请只输出类别名称，不要解释。

必须保留的说法 5 条,丢了 5 条: ['重复扣款', '取消后', '扣款失败', '发票抬头', '注销']
退出码 1
```

五条全丢。逐行 diff 在这里帮助有限,因为优化器把整段都重写了,三行全删、八行全加;真正有用的是 `MUST_KEEP` 那张表,它把「重复扣款没了」这件事变成了一个能拦住合并的红灯。这也正好是 ACE 想解决的问题:整段重写让人很难审,只增量加减条目的话,diff 就只有几行。

这张表的局限也要说清楚:它只查字面。优化器把「重复扣款」写成「多次扣费」,表里查不到,但意思没丢;反过来,词还在、意思被改反了(「重复扣款不算 refund」),它也查不出来。所以它只是一道粗筛,最后还是要人读。

</details>

### 验收标准

- `reflect_loop.py`、`gepa_opt.py`、`gepa_check.py` 都能在 `agent-zero-lab` 根目录用 `uv run python -m part06.xxx` 跑通,输出格式和文中一致(分数允许有一两条出入)。
- 能对着 GEPA 的候选列表说出哪个候选是从哪个改来的、最后为什么选它。
- 能在你自己跑出来的新 prompt 里指出至少一处规则写宽了或写丢了,并说出它会把哪条工单带错。
- 练习 2 或 3 有一张「验证集、测试集、花费」的对比,并写一句你的结论。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 反思循环 | 跑训练集拿错例 → 反思模型改写 prompt → 验证集验收 → 重复,测试集最后量一次 |
| 反思 prompt | 交给反思模型的任务说明,里面填当前 prompt 和错例 |
| 验收规则 | 决定候选采不采用的条件,如「验证集分数不降」(`>=`)或「严格更好」(`>`) |
| LiteLLM | 用统一接口调各家模型的 Python 库,DSPy 底层用它发请求 |
| `dspy.LM` | DSPy 里的模型对象,`openai/` 前缀表示按 OpenAI 兼容协议调 |
| `dspy.Predict` | 最简单的 Module:按 Signature 调一次模型直接出答案 |
| adapter | DSPy 里把字段渲染成 prompt、再把回复解析回字段的那一层,默认是 ChatAdapter |
| `inspect_history` | 打印最近几次调用实际发给模型的消息和回复 |
| `dspy.Example` / `with_inputs` | 一条数据;`with_inputs` 标出哪些字段是输入,其余是答案 |
| GEPA 评分函数 | 五个参数,返回 `dspy.Prediction(score=..., feedback=...)` |
| `max_metric_calls` | GEPA 的预算:评分函数最多调几次,和 `auto`、`max_full_evals` 三选一 |
| `reflection_minibatch_size` | GEPA 每轮抽几条训练样本给反思模型看 |
| 候选 / 父节点 | GEPA 产生的每个 prompt 版本 / 它是从哪个版本改出来的 |
| student | DSPy 习惯这么叫被优化的程序 |
| 猴子补丁 | 运行时改掉别的模块里的变量或函数,练习里用,正式代码少用 |

## 常见误区

**把验证集的上涨当成优化成功。** 自写循环从 BASE 起步,验证集 85% → 95%,测试集 90% → 90%;GEPA 从 BARE 起步,验证集 90% → 95%,测试集 75% → 75%。验证集是被优化器拿来挑版本的,它的分数一定往上走,只能当参考。

**以为反思模型写出来的规则就是业务规则。** 它从几条错例里总结,常常写得比真实规范宽:「refund > billing > … > bug」的优先级把 t33 这种「带扣款字样的显示错误」带成了 billing。一定要有人读。

**以为反思模型只会加东西,不会删。** GEPA 那次把「重复扣款」从 refund 的定义里删掉了。整段重写就有这个风险,ACE 说的简短偏好就是它。审 diff 时,删掉的行比加上的行更要看。

**GEPA 的评分函数写两个参数。** 网上很多 DSPy 老教程的评分函数是 `(example, pred)` 或 `(example, pred, trace)`,给 GEPA 用会在构造时报 `GEPA metric must accept five arguments`。

**预算参数设了两个。** `auto` 和 `max_metric_calls` 同时设会报 `Exactly one of ... must be set`,只能三选一。

**忘了 `cache=False`。** DSPy 默认把调用结果缓存到磁盘,第二次跑同样的输入直接读缓存,分数一样、花费几乎为 0,你会以为优化很稳定、很便宜。

**以为 GEPA 的花费主要在反思。** BARE 那次 381 次执行调用、7 次反思调用,反思只占不到一成的钱。花费基本等于预算次数乘以一次执行调用的价格。

**一上来就上优化器。** 光是把 BASE 放进 DSPy 的结构化格式,测试集就从 90% 到了 95%。先把字段、可选值、输出格式这些便宜的事做了。

## 学习资料

### 文档与文章

- [DSPy · GEPA API 文档](https://dspy.ai/api/optimizers/GEPA/overview/):英文。五参数评分函数、返回 `score` 和 `feedback` 的写法、三种预算参数,今天的 `gepa_opt.py` 照着它写,20 分钟。
- [DSPy · GEPA 教程](https://dspy.ai/tutorials/gepa_ai_program/):英文,官方的完整例子,重点看它怎么在评分函数里写有用的反馈,30 分钟。
- [DSPy · inspect_history](https://dspy.ai/api/utils/inspect_history/):英文,看 DSPy 实际发了什么 prompt,第二步用的就是它。
- [GEPA 论文(arXiv 2507.19457)](https://arxiv.org/abs/2507.19457):英文。今天读第 3 节算法和 Pareto 选择那张图,对照第四步的候选列表,1 小时。
- [Python 文档 · difflib](https://docs.python.org/zh-cn/3.12/library/difflib.html):中文,练习 4 的 `unified_diff`。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1iVSeBLEP5&autoplay=0&high_quality=1" title="深入实践 Prompt 自动优化（APO）—— GEPA + DSPY｜录屏精简版" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Koala聊开源 · 深入实践 Prompt 自动优化(APO)—— GEPA + DSPY|录屏精简版 · 15 分钟,中文。讲评分函数怎么写反馈、怎么看优化日志,路线和今天第四步基本一致,适合跟着敲一遍。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1vWt3zCE9j&autoplay=0&high_quality=1" title="Deepractice 社区直播 | DSPy框架技术原理与Prompt自动优化机制" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Ra7ny_ · Deepractice 社区直播|DSPy框架技术原理与Prompt自动优化机制 · 36 分钟,中文直播回放。讲 DSPy 的 adapter 和优化器怎么配合,补第二步那张分工图背后的原理。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/czy7hvXIImE" title="GEPA Explained!" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Weaviate · GEPA Explained! · 英文,用论文里的图把反思改写、Pareto 选择、合并三步过一遍,比读论文快,适合看完今天的代码再看。</figcaption>
</figure>

- 正文里嵌的 AI Engineer 大会 Lakshya A. Agrawal《Beating RL With Reflection》也在这一组。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):第 5 章讲 prompt 工程和自动优化工具的局限,第 4 章讲评测设计,读完会更清楚为什么自动优化离不开测试集,英文。
- John Berryman、Albert Ziegler《Prompt Engineering for LLMs》(O'Reilly,2024):判断「优化器写出的规则合不合理」时可以拿来对照,英文。

### 开源项目与代码

- [stanfordnlp/dspy](https://github.com/stanfordnlp/dspy):`dspy/teleprompt/gepa/gepa.py` 里 `GEPA.__init__` 的参数和断言写得很清楚,第三步那三个报错就是从这里抛的。
- [gepa-ai/gepa](https://github.com/gepa-ai/gepa):不依赖 DSPy 的独立版本,`gepa.optimize()` 能优化任意文本组件,想在自己的 Agent 上用可以看它的 README。

## 自测

1. 反思循环里,训练集、验证集、测试集分别在哪一行被用到?

<details><summary>答案</summary>

训练集在每轮开头 `_, errors = evaluate(client, best, train)`,拿错例给反思模型;验证集在 `cand_val, _ = evaluate(client, cand, val)`,决定候选采不采用(还有循环前量一次起点);测试集只在循环结束后 `evaluate(client, best, load("test"))` 量一次,不参与任何决定。

</details>

2. 从 BARE 起步的反思循环把测试集从 80% 拉到了 90%,为什么 t33 反而错了?

<details><summary>答案</summary>

反思模型从「被扣了钱」那几条错例里总结出钱的问题优先,写了一个全局优先级 `refund > billing > account > invoice > bug > other`。t33 是订阅页面把扣款日期显示成 11 月 31 日,标注员算 bug,但工单里有「扣款」两个字,按这个优先级就落到了 billing。训练集和验证集里都没有「带扣款字样的显示错误」这种反例,所以两份数据都惩罚不了这条宽规则。

</details>

3. GEPA 的评分函数为什么要返回 `feedback`?不返回会怎样?

<details><summary>答案</summary>

反思模型要靠文字反馈知道错在哪、该往哪改,它的作用和自写循环里错例后面的「理由」一样。只返回分数时,反思模型只看得到工单、模型答案和 0 分,只能自己猜;练习 2 实测它会把一个具体错例写成特例(「注销账户并要求退款余额应归为 refund」),而不是从理由里提炼规则。

</details>

4. 同样的 BASE 指令,为什么放进 DSPy 以后起点分数就从 90% 到了 95%?

<details><summary>答案</summary>

DSPy 的 adapter 把输入输出渲染成带 `[[ ## 字段 ## ]]` 分隔标记的结构,明确列出六个可选值,并要求输出必须完全匹配其中之一。格式和字段约束本身就让模型答得更准。这说明上优化器之前,应该先做这类便宜的改动。另外,20 条上 5 个点只是一条工单,也可能有噪声成分。

</details>

5. Pareto 前沿留下的是哪些候选?为什么不只留总分最高的?

<details><summary>答案</summary>

留下在至少一个验证样本上做得不比任何别的候选差的那些候选;做对的样本被另一个候选全部覆盖的,淘汰。只留总分最高的,两个候选打平时会随机丢掉一个,它在某些样本上学到的规则也就丢了,搜索容易卡在一个版本上。

</details>

6. (面试题)「你用过 DSPy 或 GEPA 吗?效果怎么样?」怎么答才不像背论文?

<details><summary>答案</summary>

讲自己的实测和边界,而不是论文里的数字。比如:用 60 条工单分类试过,从只有类别名的起点,自写反思循环把测试集从 80% 提到 90%,GEPA 验证集涨了 5 个点但测试集没动,还把「重复扣款」这条关键规则改丢了;好的起点上两者都没提升。由此得出三条做法:测试集要比验证集大且只量一次,评分函数要返回具体的文字反馈,优化结果当成 PR 由人审 diff、用一张「必须保留的规则」表在 CI 里拦。再补一句:光换成 DSPy 的结构化格式就涨了 5 个点,所以先做便宜的改动。最后说数据量,几十条只能看清机制,想看到论文那种收益要先把测试集扩到几百条。

</details>

## 明天预告

Day 370 · 第 53 周复习:评测与可观测(Day 364–369)。这一周前四天把 trace 接上、看懂、管好,后两天开始让程序自己改 prompt。明天停下来把它们串起来:默写 span 记录器、脱敏函数和反思循环,再给反思循环挂上 span,看一次优化里时间和钱都花在了哪一步。
