---
title: 'Day 577 · 蒸馏(一):三种蒸馏,规模化打标,学生选多大'
description: '让大模型当老师,给成千上万张工单打标签,再拿这些标签训练一个小模型,这就是最常用的蒸馏。今天先分清三种蒸馏各要什么条件,再用 DeepSeek V4 Pro 给 30 张工单各打三次标签,三票一致才留下,并拿原标签给老师打分:老师一致地错了 7 张,改了口径说明又冒出新的错。最后从 config.json 算出三个候选学生模型的账。'
pubDate: 2026-10-22
regime: none
tags: ['distillation', 'labeling', 'self-consistency', 'small-models', 'agent-zero']
series: 'agent-zero'
day: 577
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 576](/blog/agent-zero/day-576-dpo-2/) 我们把 Day 575 造的偏好对喂给了 DPO:Colab 上用 TRL 的 `DPOTrainer` 训 Qwen3-4B 的脚本写好了(没 GPU,没实跑),本机在 CPU 上手写了一遍 DPO 训练循环,真跑了一个 0.5B 的小模型,看着 `rewards/margins` 一步步拉开,也踩到了「按对留出验证集」造成的泄漏,最后做了训练前后的回归对比。

从 Day 570 到 Day 576,训练数据都是「我们已经有标签」的:Day 570 的分诊记录自带标签,Day 575 的偏好对是规则和 judge 判出来的。真实项目里最缺的恰恰是标签。线上每天进来几千张工单,没人有空一张张标 `urgency`。今天讲最常用的解法:让一个强的大模型当老师,批量打标,再拿这些标签训练小模型。这件事叫**蒸馏**。

## 今天要解决的问题

学完今天你应该能做到:

1. 说清三种蒸馏(序列级、logit 级、在线策略)各需要拿到老师的什么东西,知道为什么调 API 的团队基本只能做第一种。
2. 写出 `label_with_teacher.py`:老师对同一张工单独立判三次,三次完全一致才收,不一致的分出去给人看;并且会用一份有标准答案的样本给老师本身打分。
3. 从模型的 `config.json` 算出候选学生的参数量、显存和一张卡能放多少并发,知道学生尺寸要靠实验选,并且会算打标的钱。

预计用时 2.5 小时。前置:[Day 110](/blog/agent-zero/day-110-sampling-1/)(logprob、温度)、[Day 112](/blog/agent-zero/day-112-sampling-2/)(用 API 拿 `top_logprobs`)、[Day 567](/blog/agent-zero/day-567-self-host-1/)(显存账、KV cache)、[Day 570](/blog/agent-zero/day-570-finetune-1/)(`build_sft_data.py`、`raw_triage.jsonl`)、[Day 572](/blog/agent-zero/day-572-finetune-2/)(`qwen3_params.py`)、[Day 574](/blog/agent-zero/day-574-finetune-3/)(`tickets_hard.jsonl`)。

今天全部在本机跑,打 DeepSeek API 的地方一共花了约 0.40 元,算式在验收标准里。训练学生要 GPU,是 Day 572 那套流程换一份数据,今天不重复。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分(`label_with_teacher.py` 的 `ask` 和 `label`);做练习,做不出再展开参考答案,看完关掉重写一遍。

## 三种蒸馏

「蒸馏」这个词来自 Hinton 等人 2015 年的论文《Distilling the Knowledge in a Neural Network》:让一个小的**学生**模型去学一个大的**老师**模型。放到今天的大模型应用里,常见的有三种做法,区别在于学生能从老师那里拿到什么。

**序列级蒸馏**,也叫数据蒸馏。老师对一大批输入生成输出,把这些输出当成标准答案,用普通的 SFT 训练学生。学生只看到老师最后写出来的文字。这是应用团队最常用的一种,因为它只要老师的文本输出,老师可以是任何一个闭源 API。DeepSeek 在 R1 的论文里就用了这种方式,拿 R1 生成的约 80 万条样本,把推理能力蒸馏到了一系列 Qwen 和 Llama 的小模型上。它的缺点是学生看不到老师的犹豫:老师选 billing 时是 99% 有把握还是 51% 对 49%,学生不知道。

**logit 级蒸馏**。学生不只学老师选了哪个 token,还学老师在每个位置上给**所有** token 的概率分布(logit 是这些概率在 softmax 之前的原始分数)。同样的数据量,学生能学到更多。但它有两个硬条件:你得拿到老师每一步对整个词表的概率,所以老师基本只能是你自己部署的开源模型;老师和学生还要用同一套词表,比如 Qwen3 家族的大小模型之间可以,Qwen 和 Llama 之间就不行,同一个位置的第 1234 号 token 在两边根本不是同一个字。

**在线策略蒸馏**(on-policy distillation)。前两种都是学生模仿老师写好的文字,学生从来没见过「自己写错了一步之后」的局面,上线后一旦走偏就不知道怎么回来。在线策略蒸馏让学生自己写,老师给学生写的每一个 token 打分,学生按分数调整。Thinking Machines 在 2025 年 10 月的博客《On-Policy Distillation》里报告,这种方法在数学推理上用比强化学习少得多的算力达到了相当的效果(这是他们的实验结论,我没有复现)。它同样要拿到老师的逐 token 概率,所以老师也得是自部署的。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="三种蒸馏:学生分别从老师那里拿到什么">
<rect x="10" y="20" width="110" height="230" rx="8" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="65" y="45" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">老师</text>
<text x="65" y="63" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">大模型</text>
<rect x="520" y="20" width="110" height="230" rx="8" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="575" y="45" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">学生</text>
<text x="575" y="63" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">0.6B–4B</text>
<text x="320" y="85" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">① 序列级:老师写好的文字 → SFT</text>
<line x1="120" y1="95" x2="520" y2="95" stroke="var(--rule)" stroke-width="1.5"/>
<text x="320" y="112" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">老师可以是任何 API,今天做的就是这种</text>
<text x="320" y="150" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">② logit 级:每个位置整张词表的概率</text>
<line x1="120" y1="160" x2="520" y2="160" stroke="var(--rule)" stroke-width="1.5"/>
<text x="320" y="177" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">老师要自部署,两边词表要相同</text>
<text x="320" y="212" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">③ 在线策略:学生自己写,老师逐 token 打分</text>
<line x1="520" y1="222" x2="120" y2="222" stroke="var(--rule)" stroke-width="1.5" stroke-dasharray="4 3"/>
<line x1="120" y1="232" x2="520" y2="232" stroke="var(--rule)" stroke-width="1.5"/>
<text x="320" y="247" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">虚线是学生的输出送回老师,同样要自部署 + 同词表</text>
</svg>
<figcaption>越往下,学生从老师那里拿到的信号越细,条件也越苛刻。琥珀色的老师是外部系统,蓝色的学生是我们要训的模型。</figcaption>
</figure>

这三种在 TRL 1.16.0 里都有对应:序列级就是普通的 `SFTTrainer`(Day 572 用 Unsloth 做的同一件事);`DistillationTrainer` 做在线策略蒸馏,文档写明老师「必须和学生共用词表」;还有一个放在 `trl.experimental` 里的 `GKDTrainer`,用 `lmbda` 参数在「学老师的序列」和「学生自己写」之间调比例。

对 SupportPilot 的分诊来说,序列级就够了:输出很短,标签空间是固定的几个值,老师用线上正在用的大模型 API 就行。下面一个小实验说明为什么 API 用户很难做 logit 级。

### 一个小实验:API 能给多少「软标签」

老师给出的完整概率分布叫**软标签**,只给一个答案叫**硬标签**。[Day 112](/blog/agent-zero/day-112-sampling-2/) 用过 `logprobs=True, top_logprobs=3` 拿到前几名 token 的概率。我们让 DeepSeek 只输出类别名,看第一个 token 的前 5 名。

新建 `part10/soft_labels.py`:

```python
# agent-zero-lab/part10/soft_labels.py
"""老师的「软标签」:不只看它选了哪一类,还看它对每一类给了多少概率。用 API 的 logprobs 只能看到前 5 名。
用法:uv run python part10/soft_labels.py
"""
import json
import math
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
SYSTEM = ("把工单分到一个类别,只输出类别名,不要输出别的:"
          "billing refund invoice account technical plan_change api other")
TICKETS = [
    ("被重复扣款了", "同一笔 299 元扣了两次。"),
    ("开错版本了想退", "手滑买成了企业版,才用了两天,差价能退吗?"),
    ("钱不对", "这个月扣了 1188,我们明明是月付 99 的,多出来的能退吗?"),
]

for subject, body in TICKETS:
    resp = client.chat.completions.create(
        model=os.environ["LLM_MODEL"], temperature=1.0, max_tokens=5, extra_body=EXTRA,
        logprobs=True, top_logprobs=5,
        messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": f"{subject}:{body}"}])
    lp = resp.choices[0].logprobs
    assert lp is not None and lp.content
    first = lp.content[0]
    dist = "  ".join(f"{c.token!r} {math.exp(c.logprob):.3f}" for c in first.top_logprobs)
    print(f"{subject:<8} 回答 {resp.choices[0].message.content!r}  第一个 token 的前 5 名: {dist}")
```

<div class="line-notes">

- `SYSTEM = ("把工单分到一个类别,只输出类别名,不要输出别的:"` 只要类别名,这样回答的第一个 token 就是类别的开头,它的概率分布就是老师对类别的「犹豫程度」。
- `("钱不对", "这个月扣了 1188,我们明明是月付 99 的,多出来的能退吗?"),` 故意挑一张两可的:扣错钱是 billing,要退钱又像 refund。
- `model=os.environ["LLM_MODEL"], temperature=1.0, max_tokens=5, extra_body=EXTRA,` 温度用 1.0,Day 112 讲过,这样返回的 logprob 是模型原始的概率,不被温度变形。
- `logprobs=True, top_logprobs=5,` 要每个位置前 5 名 token 的对数概率。
- `assert lp is not None and lp.content` 没开 logprobs 时这里是 None,`assert` 让类型检查和运行时都放心。
- `first = lp.content[0]` 回答里第一个 token 的信息。
- `dist = "  ".join(f"{c.token!r} {math.exp(c.logprob):.3f}" for c in first.top_logprobs)` `math.exp` 把对数概率变回概率。`!r` 用 `repr` 显示 token,能看清它有没有带空格。

</div>

```bash
cd agent-zero-lab
uv run python part10/soft_labels.py
```

实跑输出(2026-10-22,DeepSeek `deepseek-flash`,关闭思考):

```text
被重复扣款了   回答 'billing'  第一个 token 的前 5 名: 'b' 1.000  'other' 0.000  'account' 0.000  '其他' 0.000  'technical' 0.000
开错版本了想退  回答 'billing'  第一个 token 的前 5 名: 'b' 0.995  'other' 0.004  'plan' 0.000  'account' 0.000  '其他' 0.000
钱不对      回答 'billing'  第一个 token 的前 5 名: 'b' 1.000  'other' 0.000  'account' 0.000  '其他' 0.000  'ref' 0.000
```

三件事。第一,`billing` 不是一个 token,它被切成了 `'b'` 加后面的部分,类别和 token 对不上号([Day 107](/blog/agent-zero/day-107-tokens-1/) 讲过分词),想从 logprob 里读出「各类别的概率」还得自己拼。第二,分布非常尖,`'b'` 拿走了 99.5% 以上,连那张两可的「钱不对」都是 1.000,API 给你的软标签和硬标签几乎没区别。第三,只能看前 5 名(OpenAI 兼容接口最多一般给 20 名),整张词表 15 万个 token 的分布拿不到。logit 级蒸馏要的恰恰是整张分布,所以它离不开自部署的老师。

顺带一提,「开错版本了想退」被分成了 billing,按我们的口径它是 refund(明确要退钱)。这个只有一句话的提示词没写口径,老师就会按自己的理解来。下面造标签时,口径说明是第一件要做好的事。

## 第一步:准备一批「没标注」的工单

真实项目里,这批工单从 Langfuse 导出,脱敏后去掉评测集里的题。我们手头有 [Day 570](/blog/agent-zero/day-570-finetune-1/) 造的 `raw_triage.jsonl`,它其实有标签(模板里写死的口径)。正好:把标签藏起来当「没标注的工单」交给老师,原标签另存一份,专门用来**给老师打分**。真实项目里你也该这么做:先拿一两百张人工标好的工单,看老师准不准,再放它去标几万张。

新建 `part10/make_unlabeled.py`:

```python
# agent-zero-lab/part10/make_unlabeled.py
"""从 Day 570 的原始记录里抽 30 张工单,去掉标签当「没标注的线上工单」;原标签另存一份,只用来给老师打分。
用法:uv run python part10/make_unlabeled.py
"""
import json
import random
from pathlib import Path

from build_sft_data import fingerprint, load_eval_blacklist, valid

DATA = Path(__file__).parent / "data"
random.seed(11)

black = load_eval_blacklist(DATA / "tickets_v1.jsonl") | load_eval_blacklist(DATA / "tickets_hard.jsonl")
seen: set[str] = set()
pool = []
for line in (DATA / "raw_triage.jsonl").read_text(encoding="utf-8").splitlines():
    if not line.strip():
        continue
    rec = json.loads(line)
    fp = fingerprint(rec["subject"], rec["body"])
    if valid(rec) and fp not in black and fp not in seen:
        seen.add(fp)
        pool.append(rec)

picked = random.sample(pool, 30)
with open(DATA / "unlabeled.jsonl", "w", encoding="utf-8") as f, \
     open(DATA / "unlabeled_gold.jsonl", "w", encoding="utf-8") as g:
    for i, rec in enumerate(picked):
        tid = f"U{i + 1:03d}"
        f.write(json.dumps({"id": tid, "subject": rec["subject"], "body": rec["body"]}, ensure_ascii=False) + "\n")
        g.write(json.dumps({"id": tid, "triage": rec["triage"]}, ensure_ascii=False) + "\n")
print(f"可用 {len(pool)} 条,抽 {len(picked)} 条 → unlabeled.jsonl")
```

<div class="line-notes">

- `from build_sft_data import fingerprint, load_eval_blacklist, valid` 三个都是 Day 570 写的:算指纹、读评测集黑名单、校验标签。脚本在 `part10/` 里,能直接导入同目录的文件。
- `black = load_eval_blacklist(DATA / "tickets_v1.jsonl") | load_eval_blacklist(DATA / "tickets_hard.jsonl")` 两份评测集的指纹合在一起,集合的 `|` 是并集。要拿去训练的数据,一条都不能和评测集撞。
- `if valid(rec) and fp not in black and fp not in seen:` 跳过坏标签(我们要拿标签打分,坏的没法用)、评测题和重复。
- `picked = random.sample(pool, 30)` 抽 30 张不重复的。真实项目里给老师打分的样本至少一两百张,今天为了省钱和时间用 30 张。
- `with open(DATA / "unlabeled.jsonl", "w", encoding="utf-8") as f, \` 一个 `with` 同时打开两个文件,行尾的 `\` 是续行符,表示下一行接着写。
- `f.write(json.dumps({"id": tid, "subject": rec["subject"], "body": rec["body"]}, ensure_ascii=False) + "\n")` 给老师的那份只有编号、主题、正文,没有标签。
- `g.write(json.dumps({"id": tid, "triage": rec["triage"]}, ensure_ascii=False) + "\n")` 标准答案另存,用编号对上。老师脚本不读这个文件。

</div>

```bash
uv run python part10/make_unlabeled.py
head -2 part10/data/unlabeled.jsonl
```

```text
可用 476 条,抽 30 条 → unlabeled.jsonl
{"id": "U001", "subject": "账单金额看不懂", "body": "我是南山律所的黄涛,客户号 C48123。账单里有一项「超额席位费」1188 元,这是怎么算的?"}
{"id": "U002", "subject": "同步银行流水失败", "body": "我是蓝湾酒店的张伟,客户号 C97226。银行流水同步报错 E1047,从 4 月 6 日开始就同步不了。"}
```

476 条可用,和 Day 570 整理脚本里 `kept` 的总数(去掉坏标签、评测题、重复之后)一致。

## 第二步:老师打标,三票一致才收

序列级蒸馏的天花板就是老师的水平,而且老师的错会被学生原样学走。所以打标这一步要做两件事:让老师尽量准,把老师拿不准的样本挑出来。

**让老师尽量准**:用最强的模型、写最详细的口径说明,不心疼钱,因为打标是一次性的(下面会算,一万张也就几十块)。今天的老师用 `deepseek-v4-pro`,我 2026 年 10 月 22 日调 DeepSeek 的 `/models` 接口,列出来的就两个模型:`deepseek-flash`(V4.1-Flash)和 `deepseek-v4-pro`。价格在 [DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) 查的,v4-pro 高峰时段每百万 token 输入命中缓存 0.3 元、未命中 9 元、输出 27 元,是 flash 的四倍多;北京时间工作日 9–12 点和 14–18 点以外是闲时,打五折。

**挑出拿不准的**:用**自一致性**(self-consistency)。同一张工单,温度 0.7,让老师独立判三次,三次四个字段完全一样才收下;不一样的说明这张工单在口径边界上,老师自己都在摇摆,放进 `disputed` 文件留给人工。被挑出来的这批,恰恰是对学生最有价值的样本,值得花人工去标。

口径说明放在单独的文本文件里,改口径不用改代码。新建 `part10/teacher_guide_v1.txt`(第一行是空行,它会接在 Day 570 那段 `SYSTEM` 后面):

```text

口径:
category:扣费金额不对、重复扣费、看不懂账单归 billing;明确要退钱归 refund;开票、改抬头归 invoice;登录、验证码、子账号归 account;导出、同步、报错、白屏归 technical;升降级归 plan_change;接口、webhook 归 api;其他归 other。
needs_account_data:要查这个客户的账单、扣款、退款、发票、订阅或账号才能回答的为 true;纯操作咨询、通用的页面或接口问题为 false。
needs_human:涉及退钱、重开发票、账号安全、商务合作的为 true,其余 false。
urgency:钱多扣了、登不上、核心功能完全不能用为 high;有影响但能等为 normal;咨询类为 low。
```

然后新建 `part10/label_with_teacher.py`:

```python
# agent-zero-lab/part10/label_with_teacher.py
"""用强模型(老师)给没标注的工单打分诊标签:同一张独立问 3 次,3 次完全一致才留下。
用法:uv run python part10/label_with_teacher.py part10/data/unlabeled.jsonl
换老师或换口径说明:TEACHER_MODEL=deepseek-flash GUIDE_FILE=part10/teacher_guide_v2.txt uv run python ...
"""
import json
import os
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

from build_sft_data import KEYS, SYSTEM, valid

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
TEACHER = os.environ.get("TEACHER_MODEL", "deepseek-v4-pro")
PRICE = {"deepseek-v4-pro": (0.3, 9, 27), "deepseek-flash": (0.04, 2, 8)}[TEACHER]   # 命中/未命中/输出,元每百万
GUIDE_FILE = Path(os.environ.get("GUIDE_FILE", "part10/teacher_guide_v1.txt"))
GUIDE = SYSTEM + GUIDE_FILE.read_text(encoding="utf-8")
usage: Counter[str] = Counter()


def ask(ticket: dict) -> dict | None:
    resp = client.chat.completions.create(
        model=TEACHER, temperature=0.7, max_tokens=100, extra_body=EXTRA,
        response_format={"type": "json_object"},
        messages=[{"role": "system", "content": GUIDE},
                  {"role": "user", "content": f"主题:{ticket['subject']}\n正文:{ticket['body']}"}])
    if resp.usage:
        hit = getattr(resp.usage, "prompt_cache_hit_tokens", 0) or 0
        usage["hit"] += hit
        usage["miss"] += resp.usage.prompt_tokens - hit
        usage["out"] += resp.usage.completion_tokens
    try:
        ans = json.loads(resp.choices[0].message.content or "")
    except json.JSONDecodeError:
        return None
    return {k: ans.get(k) for k in KEYS}


def label(ticket: dict, votes: int = 3) -> tuple[str, dict]:
    answers = [ask(ticket) for _ in range(votes)]
    keys = Counter(json.dumps(a, sort_keys=True) for a in answers if a)
    top, n = keys.most_common(1)[0] if keys else ("null", 0)
    rec = {**ticket, "triage": json.loads(top), "source": "teacher"}
    if n == votes and valid(rec):
        return "ok", rec
    return "disputed", {**ticket, "votes": dict(keys)}


if __name__ == "__main__":
    tickets = [json.loads(x) for x in open(sys.argv[1], encoding="utf-8") if x.strip()]
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(label, tickets))
    out = Path(sys.argv[1]).parent
    with open(out / f"labeled-{TEACHER}-{GUIDE_FILE.stem}.jsonl", "w", encoding="utf-8") as ok, \
         open(out / f"disputed-{TEACHER}-{GUIDE_FILE.stem}.jsonl", "w", encoding="utf-8") as bad:
        for kind, rec in results:
            (ok if kind == "ok" else bad).write(json.dumps(rec, ensure_ascii=False) + "\n")
    stats = Counter(kind for kind, _ in results)
    cost = (usage["hit"] * PRICE[0] + usage["miss"] * PRICE[1] + usage["out"] * PRICE[2]) / 1e6
    print(f"{TEACHER} + {GUIDE_FILE.stem}: 一致 {stats['ok']} 张,有分歧 {stats['disputed']} 张,一致率 {stats['ok'] / len(results):.0%}")
    print(f"输入 命中 {usage['hit']} 未命中 {usage['miss']},输出 {usage['out']} token,约 ¥{cost:.4f}")
```

<div class="line-notes">

- `from concurrent.futures import ThreadPoolExecutor` 线程池,今天第一次用:开几个「工人」同时干活,每个工人一次发一个请求。调 API 的时间几乎都花在等网络上,开 8 个工人能快好几倍。效果相当于 JS 里用 `Promise.all` 同时发 8 个 `fetch`;[Day 68](/blog/agent-zero/day-068-async-3/) 的 `asyncio.gather` 是 async 写法的同一件事,这里用线程池是因为 openai 的同步 client 不用改成 async 就能并发。
- `from build_sft_data import KEYS, SYSTEM, valid` 老师的说明以 Day 570 的 `SYSTEM` 开头,和学生训练、推理时用的那段一字不差,只在后面加口径。`valid` 用来挡住老师偶尔给出的坏标签。
- `TEACHER = os.environ.get("TEACHER_MODEL", "deepseek-v4-pro")` 老师模型名可以用环境变量换,默认 v4-pro。
- `PRICE = {"deepseek-v4-pro": (0.3, 9, 27), "deepseek-flash": (0.04, 2, 8)}[TEACHER]   # 命中/未命中/输出,元每百万` 两个模型的高峰价,按名字取。字典字面量后面直接跟 `[键]`,相当于 JS 的 `({...})[key]`。
- `GUIDE = SYSTEM + GUIDE_FILE.read_text(encoding="utf-8")` 口径说明从文件读。说明很长,而且每次请求都一样,DeepSeek 会把这段前缀缓存起来,第二次起按命中价算([Day 486](/blog/agent-zero/day-486-cost-optimize/) 讲过前缀缓存)。
- `usage: Counter[str] = Counter()` 多个线程会同时往里加数。CPython 里对字典做 `+=` 在这种量级下基本不会出问题,但严格说不是线程安全的;要精确计费,用 Day 485 的账本或者加锁。
- `model=TEACHER, temperature=0.7, max_tokens=100, extra_body=EXTRA,` 温度 0.7:太低三次总是一样,投票没有意义;太高又会引入胡乱的答案。0.7 是自一致性论文和常见做法里的典型值。`EXTRA` 关掉思考模式,v4-pro 同样认这个参数。
- `response_format={"type": "json_object"},` 打标时开 JSON mode,老师的输出一定能解析。注意这和 Day 574 说的「评测微调版时别开」不矛盾:那时要测学生自己会不会只输出 JSON,这里只要拿到标签。
- `hit = getattr(resp.usage, "prompt_cache_hit_tokens", 0) or 0` DeepSeek 在 `usage` 里多给了一个 `prompt_cache_hit_tokens` 字段,SDK 的类型里没有它,所以用 `getattr` 带默认值去取。
- `return {k: ans.get(k) for k in KEYS}` 只留四个字段,按固定顺序。
- `answers = [ask(ticket) for _ in range(votes)]` 同一张工单问 3 次,每次都是独立的一次请求。
- `keys = Counter(json.dumps(a, sort_keys=True) for a in answers if a)` 把每次的答案转成字符串再计数,四个字段完全一样的答案会变成同一个字符串。字典不能直接当 `Counter` 的键(可变对象不能做键),转成字符串是常用的办法。`sort_keys=True` 保证字段顺序一致。
- `top, n = keys.most_common(1)[0] if keys else ("null", 0)` 票数最多的答案和它的票数。三次都解析失败时 `keys` 是空的,给一个兜底。
- `if n == votes and valid(rec):` 三票全一样、而且标签合法,才收。
- `return "disputed", {**ticket, "votes": dict(keys)}` 有分歧的把每种答案各几票都存下来,人工复核时一眼能看出老师在哪个字段上摇摆。`{**ticket, ...}` 相当于 JS 的 `{...ticket, votes}`。
- `results = list(pool.map(label, tickets))` 8 个线程同时跑 `label`,结果按输入顺序返回。
- `with open(out / f"labeled-{TEACHER}-{GUIDE_FILE.stem}.jsonl", "w", encoding="utf-8") as ok, \` 文件名带上老师和口径版本,后面要比较好几组,别互相覆盖。`labeled` 里每条的格式和 `raw_triage.jsonl` 一样(`subject`、`body`、`triage`、`source`),可以直接喂给 `build_sft_data.py`。
- `cost = (usage["hit"] * PRICE[0] + usage["miss"] * PRICE[1] + usage["out"] * PRICE[2]) / 1e6` 命中、未命中、输出分开算钱。

</div>

```bash
uv run python part10/label_with_teacher.py part10/data/unlabeled.jsonl
```

实跑输出(2026-10-22,`deepseek-v4-pro`,关闭思考):

```text
deepseek-v4-pro: 一致 21 张,有分歧 9 张,一致率 70%
输入 命中 20992 未命中 6068,输出 3067 token,约 ¥0.1437
```

(这一次跑的时候,口径说明还写在代码里,输出那一行没有带上 `+ teacher_guide_v1`,文件名也是后来改的;说明的文字和上面的 `teacher_guide_v1.txt` 一字不差。)

90 次调用花了 1 毛 4。输入里 2 万多 token 命中了缓存,只有 6 千多没命中:口径说明那段前缀,除了最开始几次,后面全按 0.3 元算,这就是把固定的长说明放在最前面的好处。30 张里 21 张三票一致,9 张有分歧。

## 第三步:给老师打分

一致率 70% 说明不了老师准不准。三票一致只说明老师**自己很确定**,不说明它**对**。拿藏起来的标准答案比一下。

新建 `part10/teacher_vs_gold.py`:

```python
# agent-zero-lab/part10/teacher_vs_gold.py
"""拿 Day 570 的原标签给老师打分:三票一致的那些准不准,有分歧的那些多数票准不准,错在哪。
用法:uv run python part10/teacher_vs_gold.py deepseek-v4-pro-teacher_guide_v1
"""
import json
import sys
from pathlib import Path

from build_sft_data import KEYS

DATA = Path(__file__).parent / "data"
gold = {r["id"]: r["triage"] for r in map(json.loads, open(DATA / "unlabeled_gold.jsonl", encoding="utf-8"))}


def score(name: str, rows: list[tuple[str, str, dict]]) -> None:
    exact = sum(all(pred.get(k) == gold[i][k] for k in KEYS) for i, _, pred in rows)
    fields = "  ".join(f"{k[:8]}={sum(pred.get(k) == gold[i][k] for i, _, pred in rows)}" for k in KEYS)
    print(f"{name:<8} {len(rows):>2} 张  四字段全对 {exact}/{len(rows)}  {fields}")
    for i, subject, pred in rows:
        diff = {k: (gold[i][k], pred.get(k)) for k in KEYS if pred.get(k) != gold[i][k]}
        if diff:
            print(f"    {i} {subject:<10} (标准, 老师) {diff}")


name = sys.argv[1]
ok = [(r["id"], r["subject"], r["triage"])
      for r in map(json.loads, open(DATA / f"labeled-{name}.jsonl", encoding="utf-8"))]
disputed = []
for r in map(json.loads, open(DATA / f"disputed-{name}.jsonl", encoding="utf-8")):
    top = max(r["votes"], key=r["votes"].get)          # 票数最多的那个答案
    disputed.append((r["id"], r["subject"], json.loads(top)))
score("三票一致", ok)
score("有分歧", disputed)
```

<div class="line-notes">

- `gold = {r["id"]: r["triage"] for r in map(json.loads, open(DATA / "unlabeled_gold.jsonl", encoding="utf-8"))}` 编号 → 标准答案的字典。
- `exact = sum(all(pred.get(k) == gold[i][k] for k in KEYS) for i, _, pred in rows)` 四个字段全对的张数,写法和 Day 574 的 `summarize` 一样。`_` 表示这个位置(主题)这里用不到。
- `fields = "  ".join(f"{k[:8]}={sum(pred.get(k) == gold[i][k] for i, _, pred in rows)}" for k in KEYS)` 每个字段单独数对了几张。
- `diff = {k: (gold[i][k], pred.get(k)) for k in KEYS if pred.get(k) != gold[i][k]}` 错了的字段,值是(标准, 老师)。
- `top = max(r["votes"], key=r["votes"].get)          # 票数最多的那个答案` 对字典用 `max`,比较的是 `key` 函数的返回值,也就是票数,返回的是键(答案字符串)。有分歧的工单也看看「多数票」准不准。

</div>

```bash
uv run python part10/teacher_vs_gold.py deepseek-v4-pro-teacher_guide_v1
```

```text
三票一致     21 张  四字段全对 14/21  category=21  needs_ac=20  needs_hu=15  urgency=18
    U002 同步银行流水失败   (标准, 老师) {'needs_account_data': (True, False), 'urgency': ('high', 'normal')}
    U006 被重复扣款了     (标准, 老师) {'needs_human': (True, False)}
    U012 要开专票       (标准, 老师) {'needs_human': (False, True), 'urgency': ('normal', 'low')}
    U013 被重复扣款了     (标准, 老师) {'needs_human': (True, False)}
    U020 被重复扣款了     (标准, 老师) {'needs_human': (True, False)}
    U021 被重复扣款了     (标准, 老师) {'needs_human': (True, False)}
    U029 退款多久到账     (标准, 老师) {'needs_human': (False, True), 'urgency': ('low', 'normal')}
有分歧       9 张  四字段全对 4/9  category=9  needs_ac=8  needs_hu=6  urgency=6
    U001 账单金额看不懂    (标准, 老师) {'urgency': ('low', 'normal')}
    U004 被重复扣款了     (标准, 老师) {'needs_human': (True, False)}
    U008 被重复扣款了     (标准, 老师) {'needs_human': (True, False)}
    U023 同步银行流水失败   (标准, 老师) {'needs_account_data': (True, False), 'urgency': ('high', 'normal')}
    U026 要开专票       (标准, 老师) {'needs_human': (False, True), 'urgency': ('normal', 'low')}
```

读这份输出,先看大的:三票一致的 21 张全对 14 张(67%),有分歧的 9 张多数票全对 4 张(44%)。自一致性确实把更不靠谱的那批挑出去了,但收下的也只有三分之二是对的。类别 30 张全对,错的全在口径字段上,这和 Day 570 发现的一样。

再看错在哪。「被重复扣款了」出现了 6 次,`needs_human` 每次都错,其中 4 次是三票一致地错。老师很确定,只是确定地错了。原因在我写的口径:「涉及退钱的要转人工」,老师理解成「客户明确说要退钱」,而重复扣款的客户只说「扣了两次」,没说退钱。我们团队的口径是重复扣款要人工核实,这句话我没写进去。

这就是**系统性错误**:老师每次都按同一个错误理解来答,投票再多也投不出来,因为三票是同一个误解的三份拷贝。自一致性只能过滤掉老师「拿不准」的随机错误,过滤不掉老师「理解错了」的系统错误。系统错误只有一个办法发现:像现在这样,拿一份有标准答案的样本给老师打分。

## 第四步:改口径说明,再打一次

照着错的地方把口径写细。新建 `part10/teacher_guide_v2.txt`,只改后三行:

```text

口径:
category:扣费金额不对、重复扣费、看不懂账单归 billing;明确要退钱归 refund;开票、改抬头归 invoice;登录、验证码、子账号归 account;导出、同步、报错、白屏归 technical;升降级归 plan_change;接口、webhook 归 api;其他归 other。
needs_account_data:要查这个客户的账单、扣款、退款、发票、订阅、账号或他绑定的数据(如银行流水同步)才能回答的为 true;纯操作咨询、通用的页面或接口问题为 false。
needs_human:要人工改钱或改单据的为 true,包括重复扣款核实、退差价、重开发票;账号安全(登不上)和商务合作也为 true。查进度、开专票(资料已在后台)这类系统能自助完成的为 false。
urgency:钱多扣了、登不上、核心功能完全不能用(白屏、同步中断)为 high;有影响但能等(开票、扣费疑问)为 normal;纯咨询和查进度为 low。
```

```bash
GUIDE_FILE=part10/teacher_guide_v2.txt uv run python part10/label_with_teacher.py part10/data/unlabeled.jsonl
uv run python part10/teacher_vs_gold.py deepseek-v4-pro-teacher_guide_v2
```

```text
deepseek-v4-pro + teacher_guide_v2: 一致 23 张,有分歧 7 张,一致率 77%
输入 命中 20992 未命中 11918,输出 2946 token,约 ¥0.1931
三票一致     23 张  四字段全对 19/23  category=23  needs_ac=23  needs_hu=23  urgency=19
    U001 账单金额看不懂    (标准, 老师) {'urgency': ('low', 'normal')}
    U010 账单金额看不懂    (标准, 老师) {'urgency': ('low', 'normal')}
    U011 导出报表一直转圈   (标准, 老师) {'urgency': ('normal', 'high')}
    U017 导出报表一直转圈   (标准, 老师) {'urgency': ('normal', 'high')}
有分歧       7 张  四字段全对 2/7  category=7  needs_ac=3  needs_hu=7  urgency=6
    U009 想降级        (标准, 老师) {'urgency': ('low', 'normal')}
    U012 要开专票       (标准, 老师) {'needs_account_data': (True, False)}
    U023 同步银行流水失败   (标准, 老师) {'needs_account_data': (True, False)}
    U026 要开专票       (标准, 老师) {'needs_account_data': (True, False)}
    U030 登录不了       (标准, 老师) {'needs_account_data': (True, False)}
```

三票一致的从 14/21 涨到 19/23,`needs_human` 全对了。可是冒出了新的错:「账单金额看不懂」被标成 normal,因为我在 urgency 里写了「扣费疑问为 normal」,老师把「看不懂账单」也算成了扣费疑问;「导出报表一直转圈」被标成 high,因为我写了「核心功能完全不能用(白屏、同步中断)为 high」,老师觉得导出也算核心功能。修一处、坏一处,这和 Day 570、Day 574 加 few-shot 示例时看到的现象是一回事:口径是一张网,改一个结会牵动别的结。

还要说一句实话:v2 是我看着这 30 张的错误改出来的,再拿同样这 30 张打分,是自己出题自己考,19/23 有一部分是「对着答案改题目」改出来的。正确的做法是像 [Day 481](/blog/agent-zero/day-481-iterate-2/) 说的那样分开:一份样本用来找错、改口径,另一份没看过的样本用来打分。练习 4 会算一算这种样本要多大。

### 有分歧的那几张去哪了

再看 v2 的分歧组:两张「要开专票」都在里面。回头看 `labeled` 文件,收下的 23 张里一张 invoice 都没有。这不是巧合:自一致性挑出去的是边界模糊的工单,而边界模糊往往集中在某几个类别上。只用「三票一致」的数据训练学生,这几类会越来越少,学生在这几类上越来越差。

所以 `disputed` 文件不能扔。正确的流向是:三票一致的进训练集;有分歧的送人工标注,标完再进训练集,而且往往是训练集里最值钱的那部分;人工也拿不准的,说明口径本身没定清楚,拿去找客服主管定口径。

### 一万张要花多少

今天 v2 那一轮 30 张花了 0.1931 元,每张约 0.0064 元。一万张就是 64 元,放在闲时跑再打五折,32 元。如果没有缓存,输入全按未命中价算,要 125 元左右(练习 3 会把这几个数算出来)。和它要替代的线上调用比,这是一次性的小钱:[Day 574](/blog/agent-zero/day-574-finetune-3/) 算过,DeepSeek 零样本分诊每张约 0.0004 元,一天一万张就是每天 4 元,一年一千多元;打标的钱一周就回本了,前提是学生真的干得好。

用 API 的输出训练模型之前,还要做一件和代码无关的事:读你用的那家的服务条款。OpenAI 的使用条款写明不能用它的输出开发与它竞争的模型;DeepSeek 在 2025 年 1 月 20 日发布 R1 的公告里说 R1 遵循 MIT 协议,允许用户通过蒸馏借助 R1 训练其他模型。条款会变,做内部用的分诊小模型通常没问题,但这个判断交给法务,不要工程师自己拍板。

## 学生选多大

学生越小,推理越便宜越快,能力上限也越低。选多大不能拍脑袋,要把几个尺寸都训一遍,让评测结果说话。训练之前,先把每个候选的账算清楚。

[Day 572](/blog/agent-zero/day-572-finetune-2/) 的 `qwen3_params.py` 能从 `config.json` 数出参数量。先把三个候选的 config 下载下来(每个只有一两 KB,不用下权重):

```bash
mkdir -p part10/qwen3_sizes
for m in Qwen3-0.6B Qwen3-1.7B Qwen3-4B-Instruct-2507; do
  curl -sL -o part10/qwen3_sizes/$m.json https://huggingface.co/Qwen/$m/resolve/main/config.json
done
```

`for ... do ... done` 是终端里的循环,三次分别把 `$m` 换成三个模型名。然后新建 `part10/student_sizes.py`:

```python
# agent-zero-lab/part10/student_sizes.py
"""三个候选学生模型的账:参数量、16 位权重多大、每个 token 的 KV cache 多大、一张 T4 能放多少并发。
用法:uv run python part10/student_sizes.py part10/qwen3_sizes/*.json
"""
import json
import sys
from pathlib import Path

from qwen3_params import base_params, lora_params

GPU_GIB = 15.0        # T4 标称 16 GB,扣掉驱动和 CUDA 上下文按 15 GiB 算
SEQ = 512             # 分诊一次请求约 150 token,留足余量按 512 算

for path in sys.argv[1:]:
    cfg = json.load(open(path, encoding="utf-8"))
    n = base_params(cfg)
    weights_gib = n * 2 / 2**30
    kv_per_token = 2 * cfg["num_hidden_layers"] * cfg["num_key_value_heads"] * cfg["head_dim"] * 2
    kv_per_req_gib = kv_per_token * SEQ / 2**30
    slots = int((GPU_GIB * 0.9 - weights_gib) / kv_per_req_gib)
    print(f"{Path(path).stem:<24} 参数 {n / 1e9:.2f}B  权重 {weights_gib:.1f} GiB  "
          f"KV {kv_per_token // 1024} KiB/token  r=16 LoRA {lora_params(cfg, 16) / 1e6:.0f}M  "
          f"T4 上可同时放 {slots} 个 {SEQ} token 的请求")
```

<div class="line-notes">

- `from qwen3_params import base_params, lora_params` Day 572 的两个函数:按 7 个投影矩阵加词表数参数量,以及 LoRA 的参数量。三个模型都是「输入输出共用一份词表」(config 里 `tie_word_embeddings` 是 true),正好符合那个函数的假设。
- `GPU_GIB = 15.0        # T4 标称 16 GB,扣掉驱动和 CUDA 上下文按 15 GiB 算` 粗略值,Day 567 讲过真实可用的显存要扣掉一块。
- `n = base_params(cfg)` Qwen3-0.6B 数出来 6.0 亿。
- `weights_gib = n * 2 / 2**30` 16 位每个参数 2 字节,除以 2 的 30 次方换成 GiB。
- `kv_per_token = 2 * cfg["num_hidden_layers"] * cfg["num_key_value_heads"] * cfg["head_dim"] * 2` Day 567 的 KV cache 公式:K 和 V 两份 × 层数 × KV 头数 × 每头维度 × 2 字节。0.6B 是 2 × 28 × 8 × 128 × 2 = 114,688 字节,即 112 KiB。
- `slots = int((GPU_GIB * 0.9 - weights_gib) / kv_per_req_gib)` vLLM 默认用 90% 显存(`gpu_memory_utilization=0.9`,Day 568),减掉权重,剩下的全给 KV cache,能放下多少个 512 token 的请求。这是上限的粗估,没算激活值和 CUDA graph 的占用。

</div>

```bash
uv run python part10/student_sizes.py part10/qwen3_sizes/*.json
```

```text
Qwen3-0.6B               参数 0.60B  权重 1.1 GiB  KV 112 KiB/token  r=16 LoRA 10M  T4 上可同时放 226 个 512 token 的请求
Qwen3-1.7B               参数 1.72B  权重 3.2 GiB  KV 112 KiB/token  r=16 LoRA 17M  T4 上可同时放 188 个 512 token 的请求
Qwen3-4B-Instruct-2507   参数 4.02B  权重 7.5 GiB  KV 144 KiB/token  r=16 LoRA 33M  T4 上可同时放 85 个 512 token 的请求
```

4B 和 Day 572、Day 574 的数一致(7.5 GiB、r=16 时 LoRA 3,303 万参数)。0.6B 和 1.7B 层数一样、KV 头数一样,所以每个 token 的 KV cache 一样大,区别全在权重和每层的宽度。从 4B 换到 0.6B,权重小了七倍,一张 T4 能同时服务的请求多了一倍半;再加上每个 token 要算的东西少得多,单次延迟也会短很多(这一点要在卡上实测,Day 569 的压测脚本就是干这个的)。

还有一个细节:Qwen3-0.6B 和 1.7B 是带思考模式的混合模型,4B-Instruct-2507 是不带思考的版本。做分诊要关掉思考,训练时用不带思考的模板,推理时在请求里传 `chat_template_kwargs={"enable_thinking": False}`,Qwen 官方文档里有这个用法。

训练三个尺寸、填下面这张表的事要 GPU,我没有实跑,表留空。训练数据就是今天老师打的标签加上人工复核过的分歧样本,训练流程和 Day 572 一模一样,只把 `model_name` 换掉;评测用 Day 574 的 `compare_models.py` 在 `tickets_hard` 上跑:

| 学生 | tickets_hard 全对(区间) | JSON 合法率 | P50 延迟 | 一张 T4 的吞吐 | 每张工单成本 |
| --- | --- | --- | --- | --- | --- |
| Qwen3-0.6B + LoRA | 待填 | 待填 | 待填 | 待填 | 按卡费算 |
| Qwen3-1.7B + LoRA | 待填 | 待填 | 待填 | 待填 | 按卡费算 |
| Qwen3-4B + LoRA | 待填 | 待填 | 待填 | 待填 | 按卡费算 |
| 老师 deepseek-v4-pro | 待填 | 待填 | 待填 | 不适用 | 约 0.0021 元/次 |

最后一格是 v2 那一轮的花费除以 90 次调用(0.1931 ÷ 90 ≈ 0.0021 元),老师上线用的话,不需要投票,一张调一次。

怎么读这张表:准确率一般随尺寸上升,到某个尺寸以后涨得很慢。选那个「再大也涨不了多少」的拐点。如果 0.6B 已经和老师差不多,说明任务本身不难,就选最小的;如果 4B 还离老师很远,先回头看数据和口径,而不是继续加大学生。还有一种情况要警惕:学生在 `tickets_hard` 上的分数**超过**老师。这通常不是学生真比老师强,而是训练数据里有人工复核过的样本、老师没见过,或者评测集泄漏了,要查清楚再高兴。

### 零件和大代码的对照

| 零件 | 在哪学的 | 今天的位置 |
| --- | --- | --- |
| logprob 和 `top_logprobs` | Day 110、Day 112 | `soft_labels.py` |
| 指纹、评测集黑名单、标签校验 | Day 570 | `make_unlabeled.py`、`label_with_teacher.py` 的 `valid` |
| JSON mode | Day 148 | `ask` 里的 `response_format` |
| 并发请求 | Day 68(async 版) | `ThreadPoolExecutor` |
| 前缀缓存 | Day 486 | 口径说明放在 system 最前面 |
| 逐字段打分 | Day 574 | `teacher_vs_gold.py` 的 `score` |
| 参数量和 KV cache | Day 567、Day 572 | `student_sizes.py` |

## 动手练习

1. **换个便宜的老师**:用 `deepseek-flash` 加 v2 口径当老师,跑一遍打标和打分,和 v4-pro 比一致率、准确率、花费。

<details><summary>参考答案</summary>

不用改代码,用环境变量换老师:

```bash
TEACHER_MODEL=deepseek-flash GUIDE_FILE=part10/teacher_guide_v2.txt uv run python part10/label_with_teacher.py part10/data/unlabeled.jsonl
uv run python part10/teacher_vs_gold.py deepseek-flash-teacher_guide_v2 | head -2
```

`| head -2` 只看输出的前两行,也就是两组的总分。

```text
deepseek-flash + teacher_guide_v2: 一致 22 张,有分歧 8 张,一致率 73%
输入 命中 10496 未命中 22684,输出 2121 token,约 ¥0.0628
三票一致     22 张  四字段全对 18/22  category=22  needs_ac=21  needs_hu=22  urgency=19
有分歧       8 张  四字段全对 3/8  category=7  needs_ac=5  needs_hu=8  urgency=4
```

| 老师 | 一致率 | 三票一致的全对 | 30 张花费 |
| --- | --- | --- | --- |
| v4-pro + v2 | 77% | 19/23 | ¥0.193 |
| flash + v2 | 73% | 18/22 | ¥0.063 |

flash 只差一张,花费是三分之一。在这 30 张上,口径从 v1 改到 v2 带来的提升(14/21 到 19/23),比老师从 flash 换到 pro 带来的提升大得多。这符合直觉:分诊的难点在口径,不在推理能力。不过 30 张太少了,差一张说明不了谁更好,Day 574 练习 1 算过,要分辨几个百分点的差别得上百张。还有个细节:flash 的缓存命中只有 pro 的一半。我的猜测是并发的 8 个请求同时到达,前几批还没来得及写进缓存,缓存命中本身就有随机性;具体原因 DeepSeek 没有公开,我没有深究。

</details>

2. **把老师的标签变成训练集**:把 v4-pro + v2 收下的标签喂给 Day 570 的 `build_sft_data.py`,黑名单用 `tickets_hard.jsonl`,看输出的统计。

<details><summary>参考答案</summary>

`labeled` 文件的格式和 `raw_triage.jsonl` 一样,直接用:

```bash
uv run python part10/build_sft_data.py part10/data/labeled-deepseek-v4-pro-teacher_guide_v2.jsonl part10/data/tickets_hard.jsonl part10/out_teacher
```

```text
dropped: {}
kept before cap: {'billing': 13, 'technical': 4, 'refund': 3, 'account': 1, 'api': 2}
after cap: {'billing': 13, 'technical': 4, 'refund': 3, 'api': 2, 'account': 1}
sources: {'teacher': 23}
train=21 val=2
WARNING 这些类别少于 30 条,考虑补数据: ['account', 'api', 'billing', 'invoice', 'other', 'plan_change', 'refund', 'technical']
```

`dropped` 是空的:没有坏标签(老师开了 JSON mode、又经过 `valid`),也没有和 `tickets_hard` 撞的。`sources` 全是 teacher,Day 570 的 `source` 字段在这里派上了用场:以后训练集里混着人工、验证过的、老师打的三种来源,出了问题能按来源查。

类别分布暴露了上面说的问题:invoice、plan_change、other 一条都没有,billing 一家独大。这一方面是 `raw_triage.jsonl` 本来就是 billing 最多,另一方面是 invoice 那两张被自一致性挑去了分歧组。真实项目里,这时候要做的是按类别分层抽样送老师打标,并且优先人工复核分歧组里的少数类。

</details>

3. **算钱**:用今天两次 v2 打标的实测 token 数,算出每张工单的打标成本、一万张多少钱、闲时多少钱,以及假如完全没命中缓存要多少钱。

<details><summary>参考答案</summary>

新建 `part10/label_cost.py`:

```python
# agent-zero-lab/part10/label_cost.py
"""按今天实测的 token 数,估算给 1 万张工单打标要多少钱。"""
RUNS = {  # 名字: (张数, 命中, 未命中, 输出, 价格(命中, 未命中, 输出) 元/百万)
    "v4-pro + v2": (30, 20992, 11918, 2946, (0.3, 9, 27)),
    "flash + v2": (30, 10496, 22684, 2121, (0.04, 2, 8)),
}
for name, (n, hit, miss, out, (p_hit, p_miss, p_out)) in RUNS.items():
    per = (hit * p_hit + miss * p_miss + out * p_out) / 1e6 / n
    no_cache = ((hit + miss) * p_miss + out * p_out) / 1e6 / n
    print(f"{name:<12} 每张 ¥{per:.4f}  1 万张 ¥{per * 1e4:.0f}(闲时半价 ¥{per * 5e3:.0f})  "
          f"假如完全没命中缓存 ¥{no_cache * 1e4:.0f}")
```

<div class="line-notes">

- `"v4-pro + v2": (30, 20992, 11918, 2946, (0.3, 9, 27)),` 数字照抄上面实跑输出的那一行。
- `for name, (n, hit, miss, out, (p_hit, p_miss, p_out)) in RUNS.items():` 解构可以嵌套,和 JS 的 `const [n, hit, miss, out, [pHit, pMiss, pOut]] = ...` 一样。
- `no_cache = ((hit + miss) * p_miss + out * p_out) / 1e6 / n` 把命中的那部分也按未命中价算。

</div>

```bash
uv run python part10/label_cost.py
```

```text
v4-pro + v2  每张 ¥0.0064  1 万张 ¥64(闲时半价 ¥32)  假如完全没命中缓存 ¥125
flash + v2   每张 ¥0.0021  1 万张 ¥21(闲时半价 ¥10)  假如完全没命中缓存 ¥28
```

v4-pro 有没有缓存差一倍:它的未命中价是命中价的 30 倍,口径说明又占了输入的大头。所以打标脚本有两条省钱的规矩:固定的长说明放在最前面、一字不改;大批量放在闲时跑。

</details>

4. **两个老师都同意才收**(开放题):自一致性去不掉系统性错误,那换两个不同的老师呢?把 v4-pro 和 flash(都用 v2 口径)收下的标签取交集,只收两人答案完全一样的,看收下多少张、准确率多少。

<details><summary>参考答案</summary>

新建 `part10/cross_teacher.py`:

```python
# agent-zero-lab/part10/cross_teacher.py
"""两个老师都三票一致、而且两人答案也一样,才收。看收下多少、准不准。
用法:uv run python part10/cross_teacher.py deepseek-v4-pro-teacher_guide_v2 deepseek-flash-teacher_guide_v2
"""
import json
import sys
from pathlib import Path

from build_sft_data import KEYS

DATA = Path(__file__).parent / "data"
gold = {r["id"]: r["triage"] for r in map(json.loads, open(DATA / "unlabeled_gold.jsonl", encoding="utf-8"))}


def load(name: str) -> dict[str, dict]:
    return {r["id"]: r["triage"] for r in map(json.loads, open(DATA / f"labeled-{name}.jsonl", encoding="utf-8"))}


a, b = load(sys.argv[1]), load(sys.argv[2])
both = [i for i in a if i in b and a[i] == b[i]]
clash = [i for i in a if i in b and a[i] != b[i]]
right = sum(all(a[i][k] == gold[i][k] for k in KEYS) for i in both)
print(f"老师 A 收 {len(a)},老师 B 收 {len(b)},两人都收且答案一样 {len(both)},都收但答案不同 {len(clash)}")
print(f"两人一致的 {len(both)} 张里四字段全对 {right}")
for i in clash:
    print(" ", i, {k: (a[i][k], b[i][k]) for k in KEYS if a[i][k] != b[i][k]}, "标准", {k: gold[i][k] for k in KEYS if a[i][k] != b[i][k]})
```

<div class="line-notes">

- `both = [i for i in a if i in b and a[i] == b[i]]` 两人都收了、而且四个字段一模一样。两个字典用 `==` 比较的是内容,不是引用,和 JS 的 `===` 比对象不一样。
- `clash = [i for i in a if i in b and a[i] != b[i]]` 两人各自都很确定(三票一致),但答案不同。这种工单最值得人看。

</div>

```bash
uv run python part10/cross_teacher.py deepseek-v4-pro-teacher_guide_v2 deepseek-flash-teacher_guide_v2
```

```text
老师 A 收 23,老师 B 收 22,两人都收且答案一样 15,都收但答案不同 2
两人一致的 15 张里四字段全对 13
  U027 {'needs_account_data': (False, True)} 标准 {'needs_account_data': False}
  U029 {'urgency': ('low', 'normal')} 标准 {'urgency': 'low'}
```

两个老师都同意的 15 张,全对 13 张(87%),比 v4-pro 单独的 19/23(83%)略高,但收下的数量从 23 张降到 15 张。准确率和数量是一对取舍:要求越严,收下越少,每张越准。

两个老师都三票一致、答案却不同的 2 张,每张都有一个老师是对的。这说明两个模型的系统性错误不完全一样,交叉验证能去掉一部分。但别指望太多:两个老师读的是同一份口径说明,口径没写清的地方,它们会犯同样的错。v4-pro 和 flash 还是同一家的模型,换成两家不同厂商的模型,去相关的效果一般会更好(我没有实测,这是推断)。

至于选哪种策略,看你在乎什么。训练数据少、少数类缺得厉害,宁可多收一点,靠人工复核兜底;训练数据够多,就从严。不管哪种,都要像今天这样留一份有标准答案的样本,定期给老师打分。

</details>

验收标准:`label_with_teacher.py` 能用环境变量切换老师和口径,`teacher_vs_gold.py` 能打印出三票一致组和分歧组的准确率与错例;你能说出「三票一致却全错」的原因,以及为什么分歧组不能扔;`student_sizes.py` 的三行数字和本文一致(只读 config,应该一字不差)。今天实跑花费约 0.40 元:v4-pro 用 v1 口径打标 0.144 元,v4-pro 用 v2 口径 0.193 元,练习 1 的 flash 0.063 元,`soft_labels.py` 3 次调用不到 0.001 元。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 蒸馏(distillation) | 让小的学生模型学大的老师模型,学生上线后更便宜更快 |
| 老师 / 学生 | 蒸馏里提供标签或概率的强模型 / 被训练的小模型 |
| 序列级蒸馏 | 老师生成输出当标准答案,用 SFT 训练学生;老师可以是任何 API |
| logit 级蒸馏 | 学生学老师每个位置对整张词表的概率分布;要自部署老师、同一套词表 |
| logit | 模型在 softmax 之前给每个 token 的原始分数,过 softmax 才变成概率 |
| 在线策略蒸馏 | 学生自己生成,老师对学生生成的每个 token 打分,学生按分数调整 |
| 软标签 / 硬标签 | 老师给出的完整概率分布 / 只给一个答案 |
| 打标 | 给没有标签的数据加上标签,今天由老师模型来做 |
| 自一致性(self-consistency) | 同一个问题独立问多次,多次一致才采信,用来挑出模型拿不准的样本 |
| 系统性错误 | 模型每次都按同一个错误理解来答,投票再多也投不掉 |
| 口径说明 | 写给老师的标注规则,比如什么情况算 high、什么情况要转人工 |
| 分歧样本(disputed) | 老师几次答案不一致的样本,应该送人工标注 |
| 闲时价 | DeepSeek 在工作日 9–12、14–18 点以外打五折 |

## 常见误区

**以为老师三票一致就是对的。** 今天 v1 口径下三票一致的 21 张里错了 7 张,「被重复扣款了」4 次一致地错。自一致性只挡随机错,挡不住系统错。一定要留一份有标准答案的样本给老师打分。

**把分歧样本扔掉。** 被挑出去的往往集中在某几个类别(今天两张「要开专票」都在分歧组,收下的 23 张里没有一张 invoice)。扔掉它们,学生在这几类上会越来越差。分歧样本送人工,是训练集里最值钱的一部分。

**改了口径不重新打分。** v2 修好了 `needs_human`,又让「看不懂账单」和「导出转圈」的 urgency 错了。每改一次口径都要重新给老师打分,而且最好用没看过的样本打分,别自己出题自己考。

**以为调 API 也能做 logit 级蒸馏。** API 最多给前几名的概率,今天看到连两可的工单第一名都是 1.000,和硬标签几乎一样。logit 级和在线策略蒸馏都要自部署老师,而且老师和学生词表要相同。

**温度设成 0 来投票。** 温度 0 时三次几乎一定一样,投票就失去了意义。要让老师有机会摇摆,摇摆的地方才是它拿不准的地方。今天用 0.7。

**一上来就选最大的学生。** 先算账(今天 4B 的权重是 0.6B 的七倍),再三个尺寸都训一遍看评测,选拐点。4B 离老师还很远时,该回头看数据和口径,不是换更大的学生。

**没读条款就拿 API 输出训练模型。** 各家条款不一样而且会变,交给法务确认。

## 学习资料

### 文档与文章

- [Distilling the Knowledge in a Neural Network](https://arxiv.org/abs/1503.02531):Hinton 等,2015,「蒸馏」和「软标签」这两个说法的出处。读摘要和第 2 节,理解为什么软标签比硬标签信息多。
- [Sequence-Level Knowledge Distillation](https://arxiv.org/abs/1606.07947):Kim 和 Rush,2016,序列级蒸馏的出处,读摘要。
- [DeepSeek-R1 论文](https://arxiv.org/abs/2501.12948):找讲 distillation 的那一节,看他们怎么用 R1 生成的数据蒸馏出一系列小模型。
- [Thinking Machines · On-Policy Distillation](https://thinkingmachines.ai/blog/on-policy-distillation/):2025 年 10 月的博客,讲清楚在线策略蒸馏和 SFT、强化学习的关系,图很好懂。
- [Self-Consistency Improves Chain of Thought Reasoning in Language Models](https://arxiv.org/abs/2203.11171):自一致性的出处,原本用于推理题多次采样取多数,今天把它用在了打标上。
- [TRL · Distillation Trainer](https://huggingface.co/docs/trl/main/distillation_trainer):TRL 里做在线策略蒸馏的那个类,文档里写了老师必须和学生共用词表。
- [DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):今天的价格和闲时规则都来自这里,用之前再核对一次。
- [DeepSeek-R1 发布公告](https://api-docs.deepseek.com/zh-cn/news/news250120):里面写了 R1 的开源协议和关于蒸馏的说明。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1PygX6JERg&autoplay=0&high_quality=1" title="10分钟搞懂大模型蒸馏,Kimi、Qwen 到底蒸没蒸?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>一起Vibe · 10分钟搞懂大模型蒸馏,Kimi、Qwen 到底蒸没蒸? · 约 11 分钟,用大白话讲蒸馏是什么、业内说的「蒸馏」指哪几种,适合先看建立概念,对应今天「三种蒸馏」那一节。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV11DtizAEn4&autoplay=0&high_quality=1" title="【大模型蒸馏】手把手教你实现DeepSeek R1蒸馏训练Qwen 3B" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>写代码的阿咪 · 【大模型蒸馏】手把手教你实现DeepSeek R1蒸馏训练Qwen 3B · 约 28 分钟,用老师生成数据再 SFT 学生的完整流程,就是今天的序列级蒸馏,训练那一段我们没跑,可以看这里。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/jrJKRYAdh7I" title="Knowledge Distillation: How LLMs train each other" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Julia Turc · Knowledge Distillation: How LLMs train each other · 从 Hinton 的软标签讲到大模型时代的各种蒸馏,把今天那张三种蒸馏的图讲得更细。英文。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/YH0YXgDWZXA" title="How Small Models Learn to Think Like Giants | On-Policy Distillation" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Jia-Bin Huang · How Small Models Learn to Think Like Giants | On-Policy Distillation · 专讲在线策略蒸馏,为什么学生自己写、老师打分比模仿老师的文字更好。英文。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 8 章讲数据工程,其中有用模型合成和标注数据、以及蒸馏的讨论,和今天的打标流程是同一类问题。
- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly, 2024):第 4 章文本分类,对比了专门训练的小分类模型和直接用生成式大模型分类两条路,读完对「学生和老师各有什么长处」会有直觉。中文版《图解大模型》。

### 开源项目与代码

- [huggingface/trl](https://github.com/huggingface/trl):`trl/trainer/distillation_trainer.py` 是在线策略蒸馏,`trl/experimental/gkd/` 是 GKD。
- [unslothai/notebooks](https://github.com/unslothai/notebooks):学生训练还是 Day 572 那套笔记本,里面有 Qwen3 不同尺寸的版本,换个模型名就能训 0.6B 和 1.7B。
- [Qwen/Qwen3-0.6B](https://huggingface.co/Qwen/Qwen3-0.6B):模型卡里有参数量、思考模式开关 `enable_thinking` 的用法。

## 自测

1. 三种蒸馏里,为什么用闭源 API 当老师的团队基本只能做序列级?

<details><summary>答案</summary>

logit 级和在线策略蒸馏都要老师在每个位置上对整张词表的概率分布,API 最多给前几名的 logprob(今天看到前 5 名里第一名就占了 99.5% 以上),拿不到完整分布;另外这两种还要求老师和学生用同一套词表,闭源模型的词表你不知道,也对不上。序列级只要老师的文字输出,任何 API 都行。

</details>

2. 老师三次投票都一致,标签就一定对吗?今天的例子说明了什么?

<details><summary>答案</summary>

不一定。今天 v1 口径下三票一致的 21 张错了 7 张,「被重复扣款了」的 `needs_human` 4 次一致地错。原因是口径说明没写清,老师每次都按同一个错误理解来答,这是系统性错误,投票去不掉。要发现它,只能拿有标准答案的样本给老师打分。

</details>

3. 为什么老师打标时温度设 0.7,而不是 0?

<details><summary>答案</summary>

自一致性靠的是「让老师有机会摇摆」:温度 0 时三次几乎总是一样,投票等于没投,挑不出拿不准的样本。温度适中时,老师确定的地方三次还是一样,拿不准的地方才会出现不同答案。温度太高又会引入胡乱的答案,0.7 是常见的折中。

</details>

4. 收下的 23 张标签里一张 invoice 都没有,可能是什么原因?怎么办?

<details><summary>答案</summary>

一是原始数据里 invoice 本来就少,二是自一致性把边界模糊的工单挑去了分歧组,而今天两张「要开专票」正好都在分歧组。只用三票一致的数据训练,少数类会越来越少。办法是分歧组送人工标注后放回训练集,并且按类别分层抽样送老师打标,保证每类都有足够的样本。

</details>

5. (面试题)你要把 SupportPilot 的分诊从大模型 API 换成一个蒸馏出来的小模型,数据怎么造、学生怎么选?

<details><summary>答案</summary>

数据:从线上导出脱敏工单,先剔除评测集里的题(按指纹,也按模板、客户等出处)。老师用能拿到的最强模型,写详细的口径说明并放在提示词最前面吃前缀缓存,温度 0.7 独立问三次,三票一致的进训练集,有分歧的送人工。开工前和每次改口径后,用一两百张人工标好的样本给老师打分,区分随机错误和系统性错误;系统性错误靠改口径,不靠投票。按类别分层,保证少数类有样本,每条记录来源。上线前读服务条款。学生:从 config 算出 0.6B、1.7B、4B 的权重、KV cache 和单卡并发,三个都用同样的数据和超参训一遍,在出处隔离的评测集上比准确率、JSON 合法率、延迟和按卡费折算的成本,选准确率不再明显上涨的拐点尺寸。4B 还离老师很远时回头查数据和口径,不急着加大。

</details>

## 明天预告

Day 578 · 蒸馏(二):置信度和阈值曲线,其他路由方式。学生训好了也总有判断不准的工单,怎么知道这一张它拿不准、该交给大模型?明天从学生自己输出的概率里算出置信度,扫一遍阈值,画出准确率和成本的取舍曲线,用数据选工作点,再看看除了置信度还有哪些路由方式。
