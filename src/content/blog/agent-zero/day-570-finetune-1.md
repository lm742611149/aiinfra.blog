---
title: 'Day 570 · 微调(一):提示词、RAG、微调各管什么,造训练集'
description: '模型表现不好时,先改提示词,再上 RAG,最后才轮到微调。今天先用真实调用看清提示词能解决到哪一步,再写一个本机就能跑的脚本,把 502 条带重复、坏标签、还混进了评测题的原始记录,整理成一份干净的分诊训练集。'
pubDate: 2026-10-22
regime: none
tags: ['fine-tuning', 'sft', 'dataset', 'python', 'agent-zero']
series: 'agent-zero'
day: 570
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 569](/blog/agent-zero/day-569-self-host-3/) 我们写了一个流式压测脚本,用模拟看清了一张卡在批满以后开始排队的拐点,又用 numpy 亲手把权重压成 8 位和 4 位。那一天最后的练习算出来,一张卡自部署一个 4B 模型,每百万输出 token 大约四五块钱,前提是这个小模型能干得了活。可一个没调教过的 4B 模型拿来做 SupportPilot 的分诊,准确率往往不够。要让小模型干好一件固定的事,就轮到微调了。今天先不训练,先回答两个更要紧的问题:这件事真的需要微调吗;如果需要,训练数据怎么造。

## 今天要解决的问题

学完今天你应该能做到:

1. 说清提示词、RAG、微调各自解决哪一类问题,遇到「模型表现不好」时按顺序排查,并且用真实调用证明提示词在分诊任务上能解决到哪一步。
2. 写一个本机就能跑的脚本,把原始记录整理成 SFT 训练集:校验标签、剔除评测集里的题、去重、平衡类别、切出验证集,并读懂它打印的统计。
3. 知道为什么「训练集和评测集严格隔离」是第一条规矩,会用指纹查泄漏。

预计用时 2.5 小时。前置:[Day 25](/blog/agent-zero/day-025-sets/)(集合去重)、[Day 141](/blog/agent-zero/day-141-prompt-3/)(few-shot 示例)、[Day 148](/blog/agent-zero/day-148-structured-2/)(JSON mode)、[Day 476](/blog/agent-zero/day-476-eval-scenarios/)(评测集)、[Day 569](/blog/agent-zero/day-569-self-host-3/)。今天只花几分钱 API 费,不需要 GPU。真正上卡训练是 Day 572 的事。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分(`fingerprint`、`valid`、`to_messages` 三个函数和 `main` 里的过滤循环);做练习,做不出再展开参考答案,看完关掉重写一遍。

## 三样东西各管什么

面试里几乎必问一道题:「你们为什么用 RAG 不用微调?」或者反过来:「效果不好,为什么不微调?」很多人心里对微调的理解是「把公司的知识灌进模型」,这恰好是微调最不擅长的事。

先用前端的经验打个比方。**提示词**像函数调用时传的参数,改了立刻生效,下一次调用就不一样。**RAG**(Retrieval-Augmented Generation,检索增强生成,[第四部分](/blog/agent-zero/day-212-why-vectors/)学的那套)像运行时去 `fetch` 一份最新数据再渲染,数据变了不用重新发版。**微调**(fine-tuning)像改了依赖库的源码重新打包:改动被编译进了产物里,每次想再改,都得重新构建、重新发布,换个新版本的基座模型还得从头再来一遍。

按这个比方,排查的顺序就很自然了,前一层能解决就别动下一层:

**提示词解决「模型不知道你要什么」。** 任务说明含糊、没给示例、输出格式没讲清,这些改提示词就行,成本最低,改完立刻生效。

**RAG 解决「模型不知道某些事实」。** CloudLedger 的退款政策、错误码 E1042 是什么意思、专业版现在多少钱,这些知识会变,而且回答时要能说出出处,放进检索库最合适。帮助中心改一篇文章,下一次回答就用新内容。账单金额这种精确数字更进一步,要用工具查库([第三部分](/blog/agent-zero/day-157-tool-schema/)的工具调用),永远别让模型「记」。

**微调解决「模型知道该做什么,但做得不稳、不够好,或者太贵」。** 具体是三类:输出格式和风格要求非常严,提示词约束了还是偶尔出错;某个固定任务调用量极大,想用小模型替代大模型来省钱、省延迟,或者因为合规必须私有化;判断标准很难用一段话讲清楚,但能拿出大量正确示例,比如「什么样的工单算紧急」。

用几百条问答对训练模型「记住」退款政策,它多半学会了回答的口气,事实却记得半对半错,政策一改还得重训。这类需求交给 RAG。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="提示词、RAG、微调的排查顺序">
<rect x="20" y="20" width="190" height="44" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="115" y="47" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">模型表现不好</text>
<line x1="115" y1="64" x2="115" y2="90" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="20" y="90" width="190" height="44" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="115" y="112" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">不知道你要什么?</text>
<text x="115" y="127" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">改提示词、加示例</text>
<line x1="115" y1="134" x2="115" y2="160" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="20" y="160" width="190" height="44" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="115" y="182" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">不知道某些事实?</text>
<text x="115" y="197" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">RAG、工具查库</text>
<line x1="115" y1="204" x2="115" y2="225" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="20" y="225" width="190" height="36" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="115" y="248" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">知道但不稳/太贵 → 微调</text>
<rect x="250" y="90" width="370" height="171" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="266" y="115" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">SupportPilot 里的例子</text>
<text x="266" y="142" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">分类边界讲不清 → 先加 few-shot</text>
<text x="266" y="167" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">退款政策、错误码 → 帮助中心 + 检索</text>
<text x="266" y="192" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">账单金额 → 工具查库,别让模型记</text>
<text x="266" y="217" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">分诊每单都跑、标签稳定、量大</text>
<text x="266" y="240" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">→ 微调一个小模型来替代</text>
</svg>
<figcaption>排查顺序就是成本顺序。微调放在最后不是因为它不重要,而是它的维护成本最高:数据要持续更新,每次换基座模型都要重训。</figcaption>
</figure>

## 第一步:先证明提示词做到了哪

光讲道理不够,我们用真实调用看一眼。SupportPilot 的分诊节点要输出一个 JSON,四个字段:`category`(8 个类别之一)、`needs_account_data`(要不要查客户的账户数据)、`needs_human`(要不要转人工)、`urgency`(low/normal/high)。

我准备了一份 12 条的小评测集 `part10/data/tickets_v1.jsonl`(下一节的脚本会生成它;真实项目里用的是 Day 476 建的 `supportpilot/evals/datasets/tickets_v1.jsonl`,字段里同样有 `subject` 和 `body`)。同一份评测集跑两遍:一遍只有任务说明(零样本),一遍在前面加 3 个示例([Day 141](/blog/agent-zero/day-141-prompt-3/) 的 few-shot),每个字段单独算对了几条。

先把下一节的数据生成脚本跑一次(代码在下一节,这里先用它的产物),然后新建 `part10/prompt_first.py`:

```python
# agent-zero-lab/part10/prompt_first.py
"""微调之前先试提示词:同一份评测集,零样本和加 3 个示例各跑一遍,逐字段算准确率。
用法:uv run python part10/prompt_first.py
"""
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI
from openai.types.chat import ChatCompletionMessageParam

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
SYSTEM = (
    "你是 CloudLedger 客服分诊员。只输出一个 JSON 对象,字段:"
    "category(billing/refund/invoice/account/technical/plan_change/api/other 之一)、"
    "needs_account_data(布尔)、needs_human(布尔)、urgency(low/normal/high)。不要输出其他文字。"
)
SHOTS = [
    ("被重复扣款了", "同一笔 199 元扣了两次。",
     {"category": "billing", "needs_account_data": True, "needs_human": True, "urgency": "high"}),
    ("怎么加子账号", "想给财务同事开一个只读的子账号。",
     {"category": "account", "needs_account_data": False, "needs_human": False, "urgency": "low"}),
    ("退款多久到账", "上周申请的退款还没到账。",
     {"category": "refund", "needs_account_data": True, "needs_human": False, "urgency": "low"}),
]
KEYS = ("category", "needs_account_data", "needs_human", "urgency")


def classify(subject: str, body: str, few_shot: bool) -> tuple[dict, int, int]:
    messages: list[ChatCompletionMessageParam] = [{"role": "system", "content": SYSTEM}]
    if few_shot:
        for s, b, ans in SHOTS:
            messages.append({"role": "user", "content": f"主题:{s}\n正文:{b}"})
            messages.append({"role": "assistant", "content": json.dumps(ans, ensure_ascii=False)})
    messages.append({"role": "user", "content": f"主题:{subject}\n正文:{body}"})
    resp = client.chat.completions.create(
        model=os.environ["LLM_MODEL"], messages=messages,
        response_format={"type": "json_object"}, temperature=0, extra_body=EXTRA,
    )
    assert resp.usage is not None
    return json.loads(resp.choices[0].message.content or "{}"), resp.usage.prompt_tokens, resp.usage.completion_tokens


def main() -> None:
    cases = [json.loads(x) for x in Path("part10/data/tickets_v1.jsonl").read_text(encoding="utf-8").splitlines()]
    for few_shot in (False, True):
        right = {k: 0 for k in KEYS}
        tok_in = tok_out = 0
        for c in cases:
            pred, i, o = classify(c["subject"], c["body"], few_shot)
            tok_in, tok_out = tok_in + i, tok_out + o
            for k in KEYS:
                right[k] += pred.get(k) == c["expected"][k]
        acc = "  ".join(f"{k}={right[k]}/{len(cases)}" for k in KEYS)
        print(f"{'加示例' if few_shot else '零样本'}  {acc}  输入{tok_in} 输出{tok_out}")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from openai.types.chat import ChatCompletionMessageParam` SDK 里「一条消息」的类型。下面给 `messages` 标上 `list[ChatCompletionMessageParam]`,Zed 里的类型检查才知道列表里装的是合法消息;不标的话它推断成 `list[dict[str, str]]`,传给 `create` 时画红线。相当于 TS 里给数组写 `ChatCompletionMessageParam[]`。
- `SYSTEM = (` 括号里几段字符串挨着写会自动拼成一段,和 JS 里用 `+` 拼一样,只是省了加号。这段说明后面造训练集时会原样复用。
- `SHOTS = [` 3 个示例,每个是(主题, 正文, 标准答案)的元组。挑的是我们口径里容易判错的:「怎么加子账号」不需要查账户数据、紧急度 low。
- `messages.append({"role": "assistant", "content": json.dumps(ans, ensure_ascii=False)})` 示例的写法是一问一答:先放一条 user,再放一条 assistant 当「标准答案」。模型看到的就像自己之前已经这么答过。`ensure_ascii=False` 让中文原样写出,不变成 `\uXXXX`。
- `response_format={"type": "json_object"}, temperature=0,` [Day 148](/blog/agent-zero/day-148-structured-2/) 的 JSON mode,保证返回能被 `json.loads` 解析;温度 0 让输出尽量稳定。
- `return json.loads(resp.choices[0].message.content or "{}")` content 可能是 None,`or "{}"` 兜底。同时返回这次的输入、输出 token 数,用来算钱。
- `right = {k: 0 for k in KEYS}` 字典推导式,每个字段一个计数器,一开始都是 0。
- `tok_in, tok_out = tok_in + i, tok_out + o` 两个变量同时累加,右边先算完再一起赋值,相当于 JS 的 `[a, b] = [a + i, b + o]`。
- `right[k] += pred.get(k) == c["expected"][k]` 比较结果是 True/False,Python 里 True 当 1 用、False 当 0 用,所以能直接累加。`pred.get(k)` 在模型漏了字段时返回 None,算错。
- `acc = "  ".join(` 把四个字段的成绩拼成一行,比如 `category=12/12  needs_account_data=8/12 ...`。

</div>

```bash
cd agent-zero-lab
uv run python part10/prompt_first.py
```

实跑输出(2026-10-22 12:17,DeepSeek `deepseek-flash`,关闭思考):

```text
零样本  category=12/12  needs_account_data=8/12  needs_human=11/12  urgency=6/12  输入1610 输出287
加示例  category=12/12  needs_account_data=8/12  needs_human=9/12  urgency=8/12  输入3458 输出342
```

花费:这一次输入 1,610 + 3,458 = 5,068 token,输出 629 token,高峰价算 5,068 × 2 ÷ 1,000,000 + 629 × 8 ÷ 1,000,000 ≈ 0.010 + 0.005 = 0.015 元。我前后跑了两次,加示例那一行的 `needs_human` 第一次是 10/12,第二次是 9/12,温度 0 也不保证每次一模一样,12 条的评测集差一条就是 8 个百分点,这种波动要心里有数。

这两行数字很有意思。`category` 两遍都是满分:分到哪一类,大模型靠一段说明就做得很好,这一项根本轮不到微调。错的全在另外几个字段上。我把零样本时判错的那几条打出来看,复用 `prompt_first.py` 里的 `classify`:

```bash
uv run python - <<'PY'
import json, sys
sys.path.insert(0, 'part10')
from prompt_first import classify
for l in open('part10/data/tickets_v1.jsonl', encoding='utf-8'):
    c = json.loads(l); p, _, _ = classify(c['subject'], c['body'], False)
    diff = {k: (c['expected'][k], p.get(k)) for k in c['expected'] if c['expected'][k] != p.get(k)}
    if diff: print(c['id'], c['subject'], diff)
PY
```

`uv run python -` 表示从标准输入读代码,`<<'PY'` 到下一个 `PY` 之间的内容就是喂进去的代码(终端的 heredoc 写法)。`sys.path.insert(0, 'part10')` 让 Python 能找到 `part10/prompt_first.py`。一共 10 条有字段不对,下面是其中 5 条(另外 5 条是同一类工单的第二条,错法一样):

```text
T001 账单金额看不懂 {'urgency': ('low', 'normal')}
T003 页面打不开 {'needs_account_data': (False, True)}
T007 发票抬头写错了 {'needs_human': (True, False)}
T009 怎么加子账号 {'needs_account_data': (False, True), 'urgency': ('low', 'normal')}
T011 想降级 {'urgency': ('low', 'normal')}
```

括号里前一个是我们的标注,后一个是模型的回答。「账单金额看不懂」我们的口径是咨询类、low,模型觉得 normal;「怎么加子账号」我们说不用查账户数据,模型觉得要查。你很难说模型错了,这些是**我们团队自己的口径**,在一段说明里写不全。加了 3 个示例,`urgency` 从 6 条涨到 8 条,说明示例在教它口径;但示例不可能把所有情况都覆盖,`needs_account_data` 就没动。

所以对分诊这件事,结论是这样的。类别,提示词已经够了。口径类的字段,few-shot 能救一部分,剩下的要么把口径写成更细的规则,要么拿几百条按口径标好的样本去微调,这正是上一节说的「判断标准难讲清,但能拿出大量示例」。还有一个更现实的理由:今天这些调用,每张工单的成本是 1,610 ÷ 12 ≈ 134 个输入 token 加 24 个输出 token,大约 0.0005 元,几乎可以忽略。只有当量大到成千上万张一天、或者数据不能出内网时,用微调过的小模型自部署替代大模型才划算。别为了「用上微调」而微调。

## 训练样本长什么样

决定要微调以后,接下来全是数据的事。我们要做的这种微调叫 **SFT**(Supervised Fine-Tuning,监督微调):给模型看大量「输入 → 标准答案」的成对样本,让它学着在类似输入下给出类似答案。

每条样本用的就是你已经很熟的 messages 格式,和调用 API 时传的一模一样:

```json
{"messages": [
  {"role": "system", "content": "你是 CloudLedger 客服分诊员。只输出一个 JSON 对象……"},
  {"role": "user", "content": "主题:升级要补多少钱\n正文:我是北辰物流的周颖,客户号 C22635。现在是基础版,月中升级到 企业 版要补多少?"},
  {"role": "assistant", "content": "{\"category\": \"plan_change\", \"needs_account_data\": true, \"needs_human\": false, \"urgency\": \"low\"}"}
], "source": "teacher"}
```

一行一条,存成 **JSONL** 文件(JSON Lines,每行一个独立的 JSON 对象,前面造评测集时用过)。训练时模型读整条对话,但只在 assistant 那一段上「被打分」:模型自己预测的答案和标准答案差多少,这个差距叫**损失**(loss),训练就是不断调整参数让损失变小。system 和 user 部分不打分,因为我们不需要模型学会复述工单。

多出来的 `source` 字段不参与训练,是给人看的:这条标注从哪来。数据来源通常有三种,可靠程度从高到低:

1. `human`:人工标注或人工确认过的,比如客服主管改过分类的工单。
2. `verified`:线上记录里被下游验证过的,比如分诊以后工单没被转回、没被人改过类别。
3. `teacher`:用强模型标注的。本质是用大模型教小模型,Day 577 讲蒸馏时细说。

刚开始数据少,三种混着用没问题,但每条都要记下来源。出了问题(比如某类总判错)能回头查是不是某个来源的标注有毛病;teacher 占比特别高时也要意识到,训出来的小模型上限大概就是那个 teacher。

## 第二步:造一份「像线上导出来的」原始数据

真实项目里,原始数据从 Langfuse([Day 484](/blog/agent-zero/day-484-obs-langfuse/))导出分诊节点的输入输出,再按人工和验证结果打上标签。我们手头没有几个月的线上记录,所以写一个脚本造一份,并且故意把线上数据常见的毛病都放进去:类别严重不平衡、同一张工单被导出两次、几条坏标签、5 条评测集里的题混了进来、文件末尾多一个空行。不调 API,不花钱。

新建 `part10/make_raw_triage.py`:

```python
# agent-zero-lab/part10/make_raw_triage.py
"""造一份「像线上导出来的」分诊原始记录,故意带重复、坏标签和评测集里的题。不调 API。
用法:uv run python part10/make_raw_triage.py
"""
import json
import random
from pathlib import Path

random.seed(7)
OUT = Path(__file__).parent / "data"

# 每个类别几条模板:(主题, 正文, needs_account_data, needs_human, urgency)
TEMPLATES = {
    "billing": [("这个月扣费不对", "我们是 {plan} 版,{month} 月账单扣了 {amt} 元,比上个月多了一截,麻烦查一下。", True, False, "normal"),
                ("被重复扣款了", "{month} 月 {day} 日同一笔 {amt} 元扣了两次,银行流水能看到。", True, True, "high"),
                ("账单金额看不懂", "账单里有一项「超额席位费」{amt} 元,这是怎么算的?", True, False, "low")],
    "refund": [("申请退款", "{month} 月误升级到 {plan} 版,只用了 {day} 天,想退差价 {amt} 元。", True, True, "normal"),
               ("退款多久到账", "上周申请的 {amt} 元退款还没到账,一般要几天?", True, False, "low")],
    "invoice": [("要开专票", "公司需要 {month} 月的增值税专用发票,抬头和税号已经在后台填好了。", True, False, "normal"),
                ("发票抬头写错了", "{month} 月的发票抬头少了「有限公司」四个字,能重开吗?", True, True, "normal")],
    "account": [("登录不了", "换了手机以后收不到验证码,账号登不上,邮箱是 {mail}。", True, True, "high"),
                ("怎么加子账号", "想给财务同事开一个只读的子账号,在哪里设置?", False, False, "low")],
    "technical": [("导出报表一直转圈", "点「导出 Excel」以后一直加载,等了 {day} 分钟也没反应,Chrome 最新版。", False, False, "normal"),
                  ("同步银行流水失败", "银行流水同步报错 E{code},从 {month} 月 {day} 日开始就同步不了。", True, False, "high"),
                  ("页面打不开", "仪表盘白屏,控制台报 500,其他页面正常。", False, False, "high")],
    "plan_change": [("想降级", "团队缩减了,想从 {plan} 版降到基础版,下个账期生效可以吗?", True, False, "low"),
                    ("升级要补多少钱", "现在是基础版,月中升级到 {plan} 版要补多少?", True, False, "low")],
    "api": [("API 返回 429", "调用 /v1/invoices 接口频繁返回 429,我们一分钟才调 {day} 次。", False, False, "normal"),
            ("webhook 收不到", "配置了开票 webhook,但 {month} 月 {day} 日以后一条都没收到。", True, False, "normal")],
    "other": [("有没有发票模板", "想问一下你们有没有适合餐饮行业的发票模板?", False, False, "low"),
              ("合作咨询", "我们是一家代账公司,想谈渠道合作,找谁?", False, True, "low")],
}
COUNTS = {"billing": 150, "technical": 120, "refund": 60, "invoice": 50,
          "account": 40, "plan_change": 30, "api": 12, "other": 20}


COMPANIES = ["青禾餐饮", "北辰物流", "知鱼科技", "南山律所", "小满花店", "远航教育", "木子设计", "蓝湾酒店"]
NAMES = ["王磊", "李娜", "张伟", "刘洋", "陈静", "杨帆", "赵敏", "黄涛", "周颖", "吴昊"]


def fill(text: str) -> str:
    who = f"我是{random.choice(COMPANIES)}的{random.choice(NAMES)},客户号 C{random.randint(10000, 99999)}。"
    return who + text.format(plan=random.choice(["专业", "团队", "企业"]), month=random.randint(1, 12),
                       day=random.randint(1, 28), amt=random.choice([99, 199, 299, 1188, 2376]),
                       mail=f"user{random.randint(100, 999)}@example.com", code=random.randint(1001, 1099))


def make(cat: str) -> dict:
    subject, body, acct, human, urg = random.choice(TEMPLATES[cat])
    source = random.choices(["human", "verified", "teacher"], weights=[2, 5, 3])[0]
    return {"subject": subject, "body": fill(body), "source": source,
            "triage": {"category": cat, "needs_account_data": acct, "needs_human": human, "urgency": urg}}


def main() -> None:
    OUT.mkdir(exist_ok=True)
    records = [make(cat) for cat, n in COUNTS.items() for _ in range(n)]
    # 评测集:另外造 12 条,写进 tickets_v1.jsonl
    eval_cases = [make(cat) for cat in COUNTS for _ in range(2)][:12]
    # 线上数据里混进了 5 条评测题(改了空格和标点,内容一样)
    for c in eval_cases[:5]:
        leaked = dict(c, subject=c["subject"] + " ", body=c["body"].replace(",", ", "))
        records.append(leaked)
    # 15 条重复:同一张工单被导出了两次,只差空格或标点
    for r in random.sample(records, 15):
        records.append(dict(r, body=r["body"].replace("。", "。 ") + "!"))
    # 6 条坏标签
    bad = random.sample(records, 6)
    bad[0]["triage"] = dict(bad[0]["triage"], category="billng")
    bad[1]["triage"] = dict(bad[1]["triage"], urgency="urgent")
    bad[2]["triage"] = dict(bad[2]["triage"], needs_human="yes")
    bad[3]["triage"] = {"category": "refund"}
    bad[4]["triage"] = None
    bad[5]["triage"] = dict(bad[5]["triage"], category="Billing")
    random.shuffle(records)
    with open(OUT / "raw_triage.jsonl", "w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
        f.write("\n")  # 很多导出工具会在末尾多一个空行
    with open(OUT / "tickets_v1.jsonl", "w", encoding="utf-8") as f:
        for i, c in enumerate(eval_cases):
            f.write(json.dumps({"id": f"T{i + 1:03d}", "subject": c["subject"], "body": c["body"],
                                "expected": c["triage"]}, ensure_ascii=False) + "\n")
    print(f"raw_triage.jsonl {len(records)} 条,tickets_v1.jsonl {len(eval_cases)} 条")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `random.seed(7)` 固定种子,你生成的数据和我的一字不差,后面每一步的统计数字都能对上。
- `OUT = Path(__file__).parent / "data"` `__file__` 是这个脚本自己的路径,`.parent` 是它所在的 `part10/`,`/` 拼路径(Path 重载了除号)。不管你在哪个目录运行,数据都写到 `part10/data/`。
- `TEMPLATES = {` 每个类别两三条模板,后三个值是这条模板的「口径」:要不要查账户、要不要转人工、紧急度。真实数据里这些口径是客服主管定的,这里写死在模板里。
- `COUNTS = {"billing": 150,` 故意造得很不平衡:billing 150 条,api 只有 12 条。线上数据天然就是这样,账单问题最多。
- `who = f"我是{random.choice(COMPANIES)}` 每条正文前面加公司、姓名、客户号。我第一版没加这一行,结果模板加随机数字变化太少,大量记录天然撞车,去重一下砍掉了一半多,评测集也被「误伤」了 88 条。造合成数据最常见的问题就是多样性不够。
- `return who + text.format(` `str.format` 把模板里的 `{plan}`、`{month}` 换成随机值,相当于 JS 模板字符串的延后版本。模板里没出现的参数会被忽略。
- `source = random.choices(["human", "verified", "teacher"], weights=[2, 5, 3])[0]` 按 2:5:3 的权重随机挑一个来源。`choices` 返回列表,`[0]` 取第一个。
- `records = [make(cat) for cat, n in COUNTS.items() for _ in range(n)]` 两层推导式:外层每个类别,内层重复 n 次。一共 482 条。
- `eval_cases = [make(cat) for cat in COUNTS for _ in range(2)][:12]` 前 6 个类别各 2 条当评测集。真实项目里评测集是 Day 476 单独建的,这里只是造一个小的替身。
- `leaked = dict(c, subject=c["subject"] + " ", body=c["body"].replace(",", ", "))` `dict(旧字典, 键=新值)` 复制一份再改几个键,相当于 JS 的 `{...c, subject: ...}`。主题后面加个空格、逗号后面加个空格:内容一样,字符串不一样。直接比字符串是抓不到它们的。
- `records.append(dict(r, body=r["body"].replace("。", "。 ") + "!"))` 15 条重复,同样只差空格和一个感叹号。
- `bad[0]["triage"] = dict(bad[0]["triage"], category="billng")` 六种坏标签:拼错的类别、不存在的紧急度、字符串 "yes" 冒充布尔、缺字段、整个 triage 是 null、首字母大写的 "Billing"。最后一种其实能救,练习 1 会处理。
- `f.write("\n")  # 很多导出工具会在末尾多一个空行` 故意留个空行,下面会看到它怎么让朴素的读法崩掉。
- `"expected": c["triage"]}` 评测集的标准答案字段叫 `expected`,`prompt_first.py` 就是拿它比对的。

</div>

```bash
uv run python part10/make_raw_triage.py
```

```text
raw_triage.jsonl 502 条,tickets_v1.jsonl 12 条
```

482 条正常记录,加 5 条泄漏的评测题,加 15 条重复,一共 502 条(坏标签是在已有记录上改的,不增加条数)。

## 第三步:怎么认出「其实是同一条」

去重的难点在于重复的两条往往不是一字不差。上面那 15 条只差空格和标点,直接比字符串、或者 [Day 25](/blog/agent-zero/day-025-sets/) 那样把字符串扔进集合,都认不出来。做法是先**规范化**:转小写、去掉所有空白和标点,剩下的才拿来比;再把它算成一个短的**指纹**(hash,哈希),存进集合里查。

哈希你在前端见过:打包出来的 `main.3f9a1c.js` 里那串字符就是文件内容的哈希,内容不变哈希就不变。这里用 Python 标准库 `hashlib` 里的 MD5,任意长度的文本都变成 32 个十六进制字符。新建 `part10/fp_demo.py`:

```python
# agent-zero-lab/part10/fp_demo.py
"""看看「去掉空白和标点再算哈希」能认出哪些重复。"""
import hashlib
import re


def norm(text: str) -> str:
    return re.sub(r"[\s\W_]+", "", text.lower())


def fingerprint(subject: str, body: str) -> str:
    return hashlib.md5(norm(subject + body).encode()).hexdigest()


a = ("被重复扣款了", "7 月 24 日同一笔 99 元扣了两次,银行流水能看到。")
b = ("被重复扣款了 ", "7月24日 同一笔99元扣了两次, 银行流水能看到!")
c = ("被扣了两次钱", "7 月 24 日 99 元被扣了两遍,流水里有两条。")
for name, (s, body) in {"a": a, "b": b, "c": c}.items():
    print(name, norm(s + body), fingerprint(s, body)[:12])
```

<div class="line-notes">

- `import re` 正则表达式模块,相当于 JS 里的 `RegExp`。
- `return re.sub(r"[\s\W_]+", "", text.lower())` `re.sub(模式, 替换成什么, 原文)` 相当于 JS 的 `text.toLowerCase().replace(/[\s\W_]+/gu, "")`,Python 默认就是全局替换。`\s` 是空白,`\W` 是「非单词字符」,在 Python 里中文字符算单词字符,中文的逗号句号感叹号算 `\W`,所以中文标点也被去掉了;`_` 单独列出来是因为下划线被算作单词字符。前面的 `r` 表示原始字符串,反斜杠不转义。
- `return hashlib.md5(norm(subject + body).encode()).hexdigest()` `.encode()` 把字符串变成 UTF-8 字节(哈希只吃字节),`md5(...)` 算哈希,`.hexdigest()` 输出十六进制字符串。MD5 不能用来做密码,用来判断「内容是否一样」完全够用。
- `b = ("被重复扣款了 ", "7月24日 同一笔99元扣了两次, 银行流水能看到!")` 和 a 比:主题多一个空格,数字两边空格不一样,逗号后多空格,句号换成了感叹号。
- `c = ("被扣了两次钱",` 意思和 a 一样,但换了说法。
- `for name, (s, body) in {"a": a, "b": b, "c": c}.items():` `.items()` 拿到键值对,值是元组,直接在 for 里解包成 `s` 和 `body`。
- `print(name, norm(s + body), fingerprint(s, body)[:12])` 指纹只打印前 12 位,够看出是否一样。

</div>

```bash
uv run python part10/fp_demo.py
```

```text
a 被重复扣款了7月24日同一笔99元扣了两次银行流水能看到 0e091eafe5cd
b 被重复扣款了7月24日同一笔99元扣了两次银行流水能看到 0e091eafe5cd
c 被扣了两次钱7月24日99元被扣了两遍流水里有两条 d76f31c1ae76
```

a 和 b 规范化以后一模一样,指纹也一样,认出来了。c 是「换了说法的同一件事」,指纹完全不同,这种精确去重抓不到。抓 c 这种要用近似去重(按字符片段算相似度,或者用 embedding 算余弦相似度),明天讲工具调用数据时会用 MinHash 做一次。

### 故意踩一次坑:末尾那个空行

读 JSONL 最朴素的写法是每行 `json.loads` 一下。用一个两行的小文件试,第二行是空行:

```bash
printf '{"a": 1}\n\n' > part10/data/two_lines.jsonl
uv run python -c "
import json
for line in open('part10/data/two_lines.jsonl', encoding='utf-8').read().splitlines():
    print(json.loads(line))"
```

```text
{'a': 1}
Traceback (most recent call last):
  ...
  File ".../lib/python3.12/json/decoder.py", line 356, in raw_decode
    raise JSONDecodeError("Expecting value", s, err.value) from None
json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)
```

`Expecting value: line 1 column 1 (char 0)` 就是「这一行是空的,我第一个字符就没找到值」。很多导出工具会在文件末尾多一个换行,`raw_triage.jsonl` 也是。修法是读每行前先判断 `if not line.strip(): continue`,空行(或者只有空格的行)直接跳过。

## 第四步:拼起来,整理出训练集

零件都齐了。整理脚本按这个顺序处理每条记录:先读、跳过空行;校验标签,坏的丢掉;算指纹,在评测集黑名单里的丢掉;已经见过的丢掉;剩下的按类别分桶,每类最多留 60 条(大类下采样);打乱,切出 10% 做验证集;转成 messages 格式写文件。每一步丢了多少都记账,最后打印出来。

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="训练集整理流水线:每一步丢了多少条">
<rect x="10" y="30" width="90" height="50" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="55" y="52" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">原始记录</text>
<text x="55" y="70" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">502 条</text>
<rect x="125" y="30" width="90" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="170" y="52" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">校验标签</text>
<text x="170" y="70" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">−6 坏标签</text>
<rect x="240" y="30" width="90" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="285" y="52" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">评测黑名单</text>
<text x="285" y="70" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">−5 泄漏</text>
<rect x="355" y="30" width="90" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="400" y="52" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">指纹去重</text>
<text x="400" y="70" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">−15 重复</text>
<rect x="470" y="30" width="160" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="550" y="52" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">每类最多 60 条</text>
<text x="550" y="70" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">476 → 329</text>
<line x1="100" y1="55" x2="125" y2="55" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="215" y1="55" x2="240" y2="55" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="330" y1="55" x2="355" y2="55" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="445" y1="55" x2="470" y2="55" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="550" y1="80" x2="550" y2="115" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="400" y="115" width="110" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="455" y="137" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">train</text>
<text x="455" y="155" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">297 条</text>
<rect x="520" y="115" width="110" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="575" y="137" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">val</text>
<text x="575" y="155" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">32 条</text>
<text x="20" y="140" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">评测集 tickets_v1 只拿来做黑名单,</text>
<text x="20" y="158" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">一条都不进训练集。val 用来盯训练过程,</text>
<text x="20" y="176" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">tickets_v1 用来打最终分数,两者别混。</text>
</svg>
<figcaption>build_sft_data.py 的流水线和实跑时每一步的数字。琥珀色的三步只丢不留,蓝色的两步决定最后的分布。</figcaption>
</figure>

新建 `part10/build_sft_data.py`:

```python
# agent-zero-lab/part10/build_sft_data.py
"""整理分诊 SFT 训练集。不需要 GPU,本机就能跑。
用法:uv run python part10/build_sft_data.py part10/data/raw_triage.jsonl part10/data/tickets_v1.jsonl part10/out
"""
import hashlib
import json
import random
import re
import sys
from collections import Counter
from pathlib import Path

SYSTEM = (
    "你是 CloudLedger 客服分诊员。只输出一个 JSON 对象,字段:"
    "category(billing/refund/invoice/account/technical/plan_change/api/other 之一)、"
    "needs_account_data(布尔)、needs_human(布尔)、urgency(low/normal/high)。不要输出其他文字。"
)
CATEGORIES = {"billing", "refund", "invoice", "account", "technical", "plan_change", "api", "other"}
KEYS = ("category", "needs_account_data", "needs_human", "urgency")


def norm(text: str) -> str:
    return re.sub(r"[\s\W_]+", "", text.lower())


def fingerprint(subject: str, body: str) -> str:
    return hashlib.md5(norm(subject + body).encode()).hexdigest()


def load_eval_blacklist(eval_path: Path) -> set[str]:
    bad = set()
    for line in eval_path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            c = json.loads(line)
            bad.add(fingerprint(c["subject"], c["body"]))
    return bad


def valid(rec: dict) -> bool:
    t = rec.get("triage") or {}
    return (t.get("category") in CATEGORIES
            and isinstance(t.get("needs_account_data"), bool)
            and isinstance(t.get("needs_human"), bool)
            and t.get("urgency") in {"low", "normal", "high"})


def to_messages(rec: dict) -> dict:
    answer = {k: rec["triage"][k] for k in KEYS}
    return {"messages": [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": f"主题:{rec['subject']}\n正文:{rec['body']}"},
        {"role": "assistant", "content": json.dumps(answer, ensure_ascii=False)},
    ], "source": rec.get("source", "unknown")}


def main(raw_path: str, eval_path: str, out_dir: str, val_ratio: float = 0.1, cap_per_class: int = 60) -> None:
    random.seed(42)
    blacklist = load_eval_blacklist(Path(eval_path))
    seen: set[str] = set()
    kept: list[dict] = []
    dropped: Counter[str] = Counter()
    for line in Path(raw_path).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        fp = fingerprint(rec["subject"], rec["body"])
        if not valid(rec):
            dropped["invalid"] += 1
        elif fp in blacklist:
            dropped["in_eval_set"] += 1
        elif fp in seen:
            dropped["duplicate"] += 1
        else:
            seen.add(fp)
            kept.append(rec)

    by_cat: dict[str, list[dict]] = {}
    for rec in kept:
        by_cat.setdefault(rec["triage"]["category"], []).append(rec)
    balanced: list[dict] = []
    for recs in by_cat.values():
        random.shuffle(recs)
        balanced.extend(recs[:cap_per_class])
    random.shuffle(balanced)

    n_val = max(1, int(len(balanced) * val_ratio))
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for name, part in (("val", balanced[:n_val]), ("train", balanced[n_val:])):
        with open(out / f"triage_{name}.jsonl", "w", encoding="utf-8") as f:
            for rec in part:
                f.write(json.dumps(to_messages(rec), ensure_ascii=False) + "\n")

    print("dropped:", dict(dropped))
    print("kept before cap:", dict(Counter(r["triage"]["category"] for r in kept)))
    print("after cap:", dict(Counter(r["triage"]["category"] for r in balanced)))
    print("sources:", dict(Counter(r.get("source", "unknown") for r in balanced)))
    print(f"train={len(balanced) - n_val} val={n_val}")
    small = sorted(c for c in CATEGORIES if len(by_cat.get(c, [])) < 30)
    if small:
        print("WARNING 这些类别少于 30 条,考虑补数据:", small)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
```

<div class="line-notes">

- `from collections import Counter` 计数器,一种特殊的字典,访问不存在的键时返回 0,所以可以直接 `dropped["invalid"] += 1`。JS 里要自己写 `(m[k] ?? 0) + 1`。
- `SYSTEM = (` 和 `prompt_first.py` 里的说明一字不差。训练时用什么说明,推理时就得用什么说明,换了措辞模型的表现会打折扣。
- `CATEGORIES = {` 集合,`in` 查找是常数时间。
- `def load_eval_blacklist(eval_path: Path) -> set[str]:` 把评测集每条的指纹放进一个集合。我们的 `tickets_v1.jsonl` 12 条,黑名单就是 12 个指纹。
- `if line.strip():` 评测集文件也可能有空行,一样要跳过。
- `t = rec.get("triage") or {}` triage 是 None(坏标签第 5 种)时 `or {}` 换成空字典,下面的 `.get` 就不会报 `AttributeError`。
- `return (t.get("category") in CATEGORIES` 四个条件全满足才算合法。"billng" 和 "Billing" 都不在集合里,被判为不合法。
- `and isinstance(t.get("needs_account_data"), bool)` 必须是真正的布尔值。字符串 "yes" 在 Python 里是「真值」,`if "yes":` 会进分支,但它不是 bool,这里会拦下来。
- `answer = {k: rec["triage"][k] for k in KEYS}` 只取四个字段、按固定顺序。原始记录里有时会混进多余的字段(比如置信度),不该教给模型。
- `{"role": "user", "content": f"主题:{rec['subject']}\n正文:{rec['body']}"},` 拼法和 `prompt_first.py` 一样。训练和推理的输入格式必须一致。
- `{"role": "assistant", "content": json.dumps(answer, ensure_ascii=False)},` 答案是一段 JSON 字符串,不是字典,因为模型输出的就是一段文字。
- `def main(raw_path: str, eval_path: str, out_dir: str, val_ratio: float = 0.1, cap_per_class: int = 60) -> None:` 后两个参数有默认值:验证集占 10%,每类最多 60 条。60 是为了配合我们这份小数据,真实项目里常用几百。
- `random.seed(42)` 打乱和抽样都可复现。
- `dropped: Counter[str] = Counter()` 记每种丢弃原因各多少条。
- `if not line.strip():` 上一节那个空行坑的修法。
- `if not valid(rec):` 检查的顺序有讲究:先校验,再查黑名单,再去重。坏标签的记录不该占用一个指纹,否则它后面那条好的重复记录会被当成「重复」丢掉。
- `elif fp in blacklist:` 和评测集撞上的丢掉,单独计数。这个数不是 0,说明原始数据里混进了评测题。
- `seen.add(fp)` 第一次见到的留下,并记住指纹。
- `by_cat.setdefault(rec["triage"]["category"], []).append(rec)` `setdefault` 的意思是:键不存在就先放一个空列表,然后返回这个列表。一行完成「按类别分桶」,相当于 JS 的 `(m[k] ??= []).push(rec)`。
- `balanced.extend(recs[:cap_per_class])` 每类先打乱再截前 60 条。billing 149 条只留 60,api 12 条全留。这叫**下采样**:大类砍掉一部分,让模型不至于什么都猜 billing。
- `n_val = max(1, int(len(balanced) * val_ratio))` 329 × 0.1 = 32.9,`int` 向下取整得 32。
- `for name, part in (("val", balanced[:n_val]), ("train", balanced[n_val:])):` 前 32 条写 val,其余写 train。前面已经打乱过,所以切出来的验证集是随机的。
- `small = sorted(c for c in CATEGORIES if len(by_cat.get(c, [])) < 30)` 少于 30 条的类别给出警告,提醒补数据。

</div>

```bash
uv run python part10/build_sft_data.py part10/data/raw_triage.jsonl part10/data/tickets_v1.jsonl part10/out
```

```text
dropped: {'invalid': 6, 'duplicate': 15, 'in_eval_set': 5}
kept before cap: {'invoice': 49, 'billing': 149, 'account': 39, 'refund': 59, 'technical': 118, 'plan_change': 30, 'api': 12, 'other': 20}
after cap: {'invoice': 49, 'technical': 60, 'refund': 59, 'billing': 60, 'plan_change': 30, 'account': 39, 'api': 12, 'other': 20}
sources: {'verified': 171, 'teacher': 92, 'human': 66}
train=297 val=32
WARNING 这些类别少于 30 条,考虑补数据: ['api', 'other']
```

每一行都要读。第一行和我们埋的雷一一对上:6 条坏标签、15 条重复、5 条评测题,一条不多一条不少。真实数据里你不知道埋了多少雷,所以这一行的意义是让你知道「数据有多脏」;如果 `in_eval_set` 不是 0,要回头查导出流程为什么会把评测题混进来。

第二、三行是下采样前后的分布。billing 从 149 砍到 60,technical 从 118 砍到 60,其余不动。下采样后最大类和最小类差 5 倍,下采样前差 12 倍。第四行是来源构成,teacher 占 92 ÷ 329 ≈ 28%。最后的警告说 api 和 other 不到 30 条,这两类训出来大概率不稳,真实项目里要补:人工写一些,或者让强模型照着已有样本改写出新说法(改写出来的也要人看一遍)。

打开 `part10/out/triage_train.jsonl` 看第一行,就是上面「训练样本长什么样」那一节的样子。这里多说一句「看一眼」的重要性:训练前一定要随手抽十几条读一读。脚本只能查格式,查不出「这条工单其实是退款,却被标成了账单」这种错,而这种错才是最伤模型的。

### 多少数据才够

LIMA 那篇论文(Meta 等,2023)只用 1,000 条精挑细选的样本就训出了像样的对话模型,论文标题就叫 Less Is More for Alignment。反过来,一万条带噪声的数据可能把模型教坏。分诊这种分类任务,经验上每个类别几十到一两百条干净样本就能看到明显效果,总量 500 到 2,000 条是个合理的起点。我们这份 297 条偏少,先拿来把 Day 572 的训练流程跑通足够了。

先跑通、看评测结果,再决定要不要扩充数据。和压测一样,决定靠数字,不靠感觉。

### 零件和大代码的对照

| 零件 | 在哪学的 | build_sft_data.py 里的位置 |
| --- | --- | --- |
| 跳过空行 | 今天的空行坑 | `if not line.strip(): continue` |
| 规范化 + 指纹 | `fp_demo.py` | `norm`、`fingerprint` |
| 集合查重 | Day 25 | `seen`、`blacklist` |
| 标签校验 | 今天 | `valid` |
| messages 格式 | `prompt_first.py` 的 few-shot | `to_messages` |
| 计数 | 今天 | `Counter`、`dropped` |
| 分桶 + 下采样 | 今天 | `by_cat`、`cap_per_class` |

## 动手练习

1. **把能救的标签救回来**:坏标签里那条 "Billing" 只是大小写不对,不该丢。写一个 `clean_labels(rec)` 函数,在校验之前把 category 去掉首尾空格并转成小写,其他坏标签照样丢。重跑,`invalid` 应该从 6 变成 5。

<details><summary>参考答案</summary>

复制一份 `build_sft_data.py` 为 `part10/build_sft_data_v2.py`,第一行注释改成新文件名,在 `to_messages` 前面加一个函数:

```python
def clean_labels(rec: dict) -> dict:
    t = rec.get("triage")
    if isinstance(t, dict) and isinstance(t.get("category"), str):
        rec["triage"] = dict(t, category=t["category"].strip().lower())
    return rec
```

<div class="line-notes">

- `t = rec.get("triage")` 先拿出 triage,可能是 None。
- `if isinstance(t, dict) and isinstance(t.get("category"), str):` 只有 triage 是字典、category 是字符串时才处理,None 或缺字段的交给后面的 `valid` 丢掉。
- `rec["triage"] = dict(t, category=t["category"].strip().lower())` 复制一份再改 category,不在原字典上改。"Billing" 变成 "billing"," refund " 也会变成 "refund"。

</div>

再把 `main` 里读记录那一行改成:

```python
        rec = clean_labels(json.loads(line))
```

```bash
uv run python part10/build_sft_data_v2.py part10/data/raw_triage.jsonl part10/data/tickets_v1.jsonl part10/out_v2
```

```text
dropped: {'invalid': 5, 'duplicate': 15, 'in_eval_set': 5}
kept before cap: {'invoice': 49, 'billing': 150, 'account': 39, 'refund': 59, 'technical': 118, 'plan_change': 30, 'api': 12, 'other': 20}
after cap: {'invoice': 49, 'plan_change': 30, 'technical': 60, 'billing': 60, 'account': 39, 'other': 20, 'api': 12, 'refund': 59}
sources: {'verified': 164, 'teacher': 97, 'human': 68}
train=297 val=32
WARNING 这些类别少于 30 条,考虑补数据: ['api', 'other']
```

`invalid` 少了 1,billing 从 149 变成 150。"billng"(拼错)我故意没救:拼写纠错要猜,猜错了比丢掉更糟。清洗的原则是确定能修的修,拿不准的丢。sources 的数字和原版不一样,是因为 billing 多了一条以后,下采样时随机抽中的 60 条变了。

</details>

2. **写一个泄漏检查器**:训练集写好以后再独立查一遍,train 和 val 里有没有评测题、train 和 val 之间有没有重复。然后故意往一份拷贝的 train 里塞一条评测题,确认检查器能抓到。

<details><summary>参考答案</summary>

新建 `part10/check_leak.py`,直接复用 `build_sft_data.py` 里的函数:

```python
# agent-zero-lab/part10/check_leak.py
"""训练集造好以后再查一遍:train/val 里有没有评测集的题,train 和 val 之间有没有重复。"""
import json
import sys
from pathlib import Path

from build_sft_data import fingerprint, load_eval_blacklist


def fps(path: Path) -> list[str]:
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        user = json.loads(line)["messages"][1]["content"]
        subject, body = user.removeprefix("主题:").split("\n正文:", 1)
        out.append(fingerprint(subject, body))
    return out


def main(out_dir: str, eval_path: str) -> None:
    train = fps(Path(out_dir) / "triage_train.jsonl")
    val = fps(Path(out_dir) / "triage_val.jsonl")
    evals = load_eval_blacklist(Path(eval_path))
    print("train∩eval:", len(set(train) & evals))
    print("val∩eval:", len(set(val) & evals))
    print("train∩val:", len(set(train) & set(val)))
    print("train 内部重复:", len(train) - len(set(train)))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
```

<div class="line-notes">

- `from build_sft_data import fingerprint, load_eval_blacklist` 运行 `part10/check_leak.py` 时,Python 会把脚本所在的 `part10/` 加进模块搜索路径,所以能直接导入同目录的 `build_sft_data`。指纹算法必须和造数据时完全一样,复用函数而不是复制一份,就是为了保证这一点。
- `user = json.loads(line)["messages"][1]["content"]` 第 0 条是 system,第 1 条是 user。
- `subject, body = user.removeprefix("主题:").split("\n正文:", 1)` 把 `to_messages` 拼的格式拆回来。`removeprefix` 去掉开头的「主题:」;`split(..., 1)` 只切一刀,正文里就算出现「正文:」也不会被多切。
- `print("train∩eval:", len(set(train) & evals))` `&` 是集合交集(Day 25)。
- `print("train 内部重复:", len(train) - len(set(train)))` 列表长度减去去重后的长度,就是重复了几条。

</div>

```bash
uv run python part10/check_leak.py part10/out part10/data/tickets_v1.jsonl
```

```text
train∩eval: 0
val∩eval: 0
train∩val: 0
train 内部重复: 0
```

再故意塞一条评测题进一份拷贝:

```bash
mkdir -p part10/out_leak && cp part10/out/*.jsonl part10/out_leak/
uv run python -c "
import json
c = json.loads(open('part10/data/tickets_v1.jsonl', encoding='utf-8').readline())
msg = {'messages': [{'role': 'system', 'content': 'x'}, {'role': 'user', 'content': f\"主题:{c['subject']}\n正文:{c['body']}\"}, {'role': 'assistant', 'content': '{}'}]}
open('part10/out_leak/triage_train.jsonl', 'a', encoding='utf-8').write(json.dumps(msg, ensure_ascii=False) + '\n')
"
uv run python part10/check_leak.py part10/out_leak part10/data/tickets_v1.jsonl
```

```text
train∩eval: 1
val∩eval: 0
train∩val: 0
train 内部重复: 0
```

抓到了。这个检查器值得放进 CI:每次重新造训练集,自动跑一遍,`train∩eval` 不是 0 就让流水线失败。

</details>

3. **估一下训练要过多少 token**:`prompt_first.py` 零样本那一遍,12 条工单一共 1,610 个输入 token、287 个输出 token。一条训练样本就是 system + user + assistant,大约等于「一次零样本调用的输入 + 输出」。估算 297 条训练集一轮(epoch)有多少 token,训 3 轮呢?

<details><summary>参考答案</summary>

```bash
uv run python -c "print(1610/12, 287/12, (1610+287)/12*297, (1610+287)/12*297*3)"
```

```text
134.16666666666666 23.916666666666668 46950.75 140852.25
```

每条样本约 134 + 24 ≈ 158 个 token,一轮约 4.7 万 token,3 轮约 14 万 token。这个量对一张 T4 来说不大,Day 572 会在 Colab 上看到真实的训练时间。顺带一提,这是用 DeepSeek 的分词器数的,Qwen 的分词器数出来会有出入,估算够用;要精确就用目标模型的 tokenizer 数。这也说明分诊这类任务的训练成本很低,真正花时间的是造数据和评测。

</details>

4. **归类题**(开放题):下面五个需求,各该用提示词、RAG、工具还是微调?写一句理由。①回答里总是带「亲」这种客服腔,想去掉;②客户问「专业版现在多少钱」;③客户问「我上个月的发票开了没有」;④分诊每天 5 万张,想把延迟从 800 毫秒降到 100 毫秒以内;⑤让模型学会公司最新的退款政策。

<details><summary>参考答案</summary>

示范解法:

① 提示词。在说明里写清语气要求,再给一两个示例,几乎一定能解决,改完立刻生效。

② RAG。价格会变,而且要能引用出处,放帮助中心检索。如果价格在数据库里,也可以用工具查。

③ 工具。这是这个客户自己的数据,要实时查业务库,模型不可能知道,也不该去猜。

④ 微调(加自部署)。任务固定、量大、对延迟要求高,大模型加网络往返做不到 100 毫秒,用一个微调过的小模型部署在内网,配合 Day 569 的压测选工作点。

⑤ RAG,不是微调。政策会改,微调会把旧政策「烤」进模型里,改了还得重训,而且模型记事实不可靠。

这道题没有代码可跑,但第 ① 条可以拿 `prompt_first.py` 的思路自己验证:改说明前后各跑一遍,统计回答里出现「亲」的条数。

</details>

验收标准:`make_raw_triage.py`、`build_sft_data.py` 跑出来的数字和本文一致;`check_leak.py` 对正常训练集输出全 0,对塞了评测题的拷贝输出 `train∩eval: 1`;你能对着 `prompt_first.py` 的输出说出分诊里哪个字段值得微调、为什么。今天的实跑花费约 0.04 元(`prompt_first.py` 跑了两遍,外加一遍打印错题,共约 1.2 万输入 token、1,500 输出 token)。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 微调(fine-tuning) | 拿自己的数据继续训练一个已经训好的模型,改它的参数。像改依赖库源码重新打包 |
| SFT | 监督微调,用「输入 → 标准答案」的成对样本训练 |
| 训练集 / 验证集 | 训练集用来改参数;验证集不参与训练,用来在训练过程中看效果有没有变好 |
| 评测集 | 打最终分数用的尺子,比如 `tickets_v1.jsonl`,一条都不能进训练集 |
| 数据泄漏 | 评测题混进了训练集,测出来的提升是假的。今天抓到 5 条 |
| 损失(loss) | 模型预测和标准答案差多少,训练就是让它变小。只在 assistant 段上算 |
| JSONL | 每行一个 JSON 对象的文件格式 |
| 零样本 / few-shot | 只给说明 / 说明加几个示例。今天 urgency 从 6/12 涨到 8/12 |
| 口径 | 团队自己定的判断标准,比如「咨询类工单紧急度算 low」 |
| 规范化 | 比较前先统一格式:转小写、去空白和标点 |
| 指纹 / 哈希 | 把任意长的内容变成一个短字符串,内容一样指纹就一样。今天用 MD5 |
| 精确去重 / 近似去重 | 规范化以后完全一样才算重复 / 意思差不多就算重复 |
| 下采样 | 大类别砍掉一部分样本,让类别分布更平衡。billing 149 → 60 |
| teacher 标注 | 用强模型给数据打标签,训练出的小模型上限大致是这个 teacher |
| epoch(轮) | 把整个训练集完整过一遍叫一轮 |

## 常见误区

**想靠微调让模型「记住」公司知识。** 微调学到的主要是格式、风格和判断方式,事实记得不可靠,而且知识一改就得重训。政策、价格、错误码交给 RAG,客户自己的数据交给工具。

**还没试提示词就开始造训练集。** 今天的 `category` 用一段说明就拿了满分,根本不用微调。先用评测集证明提示词和 few-shot 做到了哪一步,把剩下的问题圈出来,微调只解决那一块。

**评测题混进了训练集。** 我们的原始数据里就混进了 5 条,只差空格和标点,直接比字符串查不出来。按规范化后的指纹建黑名单,训练集造完再用 `check_leak.py` 独立查一遍。

**直接 `json.loads` 每一行。** 文件末尾的空行会报 `JSONDecodeError: Expecting value: line 1 column 1 (char 0)`,先 `if not line.strip(): continue`。

**合成数据多样性不够。** 我第一版生成脚本没有公司名和客户号,模板变化太少,去重一下砍掉了一半多,还误伤了 88 条「撞上评测题」的正常记录。造数据时就要想清楚变化从哪来。

**不看类别分布就开训。** billing 149 条、api 12 条直接训,模型会倾向于猜大类。大类下采样、小类补数据,最后的警告要当回事。

**训练和推理用的说明不一样。** 训练时 system 是一段话,上线时改了措辞,模型的表现会打折扣。把说明写成常量,训练脚本和推理代码引用同一份。

## 学习资料

### 文档与文章

- [LIMA: Less Is More for Alignment](https://arxiv.org/abs/2305.11206):1,000 条精选样本的那篇论文,读摘要和第 2 节「数据怎么选」,20 分钟。
- [OpenAI · Model optimization](https://platform.openai.com/docs/guides/model-optimization):OpenAI 官方讲什么时候用提示词、什么时候微调,以及怎么准备数据,和今天的排查顺序一致(英文,需浏览器打开)。
- [Hugging Face · Chat templates](https://huggingface.co/docs/transformers/main/en/chat_templating):messages 格式怎么变成模型真正看到的文本,先读前两节,明天会细讲。
- [TRL · SFTTrainer](https://huggingface.co/docs/trl/main/en/sft_trainer):SFT 训练时数据集该是什么格式,「Dataset format support」那一节说明了为什么用 messages 格式最省事。
- [Python 文档 · hashlib](https://docs.python.org/zh-cn/3.12/library/hashlib.html) 和 [re](https://docs.python.org/zh-cn/3.12/library/re.html):今天用到的哈希和正则,中文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1vJ4m1M7qG&autoplay=0&high_quality=1" title="大模型项目选择RAG还是微调:八个判断依据" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI老兵文哲 · 大模型项目选择RAG还是微调:八个判断依据 · 4 分半,把今天第一节的判断标准列成八条,适合读完正文以后复习。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1DQ4y1g7P4&autoplay=0&high_quality=1" title="提示词、RAG、微调哪个会让大模型表现更好?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AIGCLINK · 提示词、RAG、微调哪个会让大模型表现更好? · 约 24 分钟,前半段讲三者怎么选,后半段讲微调的好处和代价,2023 年底的视频,具体工具有点旧,思路不过时。</figcaption>
</figure>

- 狡猾的哈基 · [【中文配音】如何为LLM训练创建、整理与清洗数据](https://www.bilibili.com/video/BV1513t6iEW1):下面 Hamel Husain 那个演讲的中文配音版,英文听着吃力就看这个。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/HEGaei7k0zE" title="Creating, Curating, and Cleaning Data for LLMs" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hamel Husain · Creating, Curating, and Cleaning Data for LLMs · 讲微调数据怎么造、怎么筛、怎么洗,很多坑和今天一样。先看前 20 分钟。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/zYGDpG-pTho" title="RAG vs Fine-Tuning vs Prompt Engineering: Optimizing AI Models" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>IBM Technology · RAG vs Fine-Tuning vs Prompt Engineering · 十来分钟的白板讲解,三样东西各管什么,英文但画得很清楚。</figcaption>
</figure>

### 书籍

- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly, 2024),中文版《图解大模型:生成式AI原理与实战》(人民邮电出版社,2025):第 12 章讲生成模型的微调,先读讲 SFT 数据和流程的部分,图很多,对 0 基础友好。

### 开源项目与代码

- [hiyouga/LLaMA-Factory](https://github.com/hiyouga/LLaMA-Factory):国内用得最多的微调框架,看 `data/README_zh.md` 里各种数据格式的说明,和我们的 messages 格式对一下。
- [ConardLi/easy-dataset](https://github.com/ConardLi/easy-dataset):一个从文档生成微调数据集的工具,有界面,可以看看别人是怎么做数据来源和标注管理的。

## 自测

1. 客户问「专业版多少钱」,模型总答旧价格。同事说「拿新价格微调一下」。你怎么回?

<details><summary>答案</summary>

价格是会变的事实,应该放帮助中心走 RAG,或者从数据库用工具查。微调记事实不可靠,而且下次调价又要重训。微调适合教格式、风格和判断方式。

</details>

2. 为什么校验标签要放在查重之前?

<details><summary>答案</summary>

如果先查重,一条坏标签的记录会先占用指纹,后面同一张工单的好记录就会被当成「重复」丢掉,结果好的丢了、坏的又因为校验不过被丢,这张工单整个没了。先校验,坏记录不进 `seen`,好的那条才能留下。

</details>

3. `build_sft_data.py` 打印 `in_eval_set: 5`,说明什么?该做什么?

<details><summary>答案</summary>

原始数据里有 5 条和评测集内容一样(只差空格标点)的记录,已经被拦下了,训练集是干净的。但要回头查数据从哪来:是不是导出线上记录时把评测运行的流量也导出了,修好导出流程,否则下次换了去重方式就可能漏掉。

</details>

4. 训练样本里 system、user、assistant 三段都参与损失计算吗?为什么?

<details><summary>答案</summary>

一般只有 assistant 段参与。我们要模型学的是「看到工单时怎么回答」,不需要它学会复述 system 说明和工单原文;把这些也算进损失,会浪费训练信号,还可能让模型学着生成工单。

</details>

5. (面试题)你们的客服分诊用大模型 API,准确率 92%,老板想微调一个小模型降成本。你会怎么推进?

<details><summary>答案</summary>

先拆问题:用评测集按字段看错在哪,类别这种提示词就能做好的先优化提示词和 few-shot,确认剩下的错误主要是口径类、示例能教会的。再算账:当前每张工单的 API 成本乘日均量,和自部署小模型的 TCO(压测出的工作点吞吐、卡费、运维)比,确认量大到值得。然后造数据:从线上记录取人工确认和被下游验证过的样本,标明来源,按指纹去重、剔除评测题、平衡类别,训练前抽样人工读。训练后用同一份评测集对比原 API 和小模型,看总分也看各字段、各类别,检查有没有退化,再灰度上线,保留大模型兜底低置信度的工单。

</details>

## 明天预告

Day 571 · 微调(二):工具调用的训练数据格式、chat template 和清洗。今天的分诊样本只有一问一答。Agent 里更常见的需求是让小模型把工具选对、参数填全,这时候样本里多了工具定义和工具往返,格式坑多得多。明天先把一条工具调用样本按 Qwen3 的 chat template 渲染出来,看模型实际学的是哪段文字,再写一个清洗脚本,把调了不存在的工具、参数是坏 JSON、调用没配上结果的样本挑出来。
