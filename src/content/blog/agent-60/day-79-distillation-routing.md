---
title: 'Day 79 · 蒸馏与路由:让小模型接住八成流量'
description: '大模型准但贵,小模型快但会犯错。今天用大模型给成千上万张工单打标签,蒸馏出一个专做分诊的小模型;再从 logprobs 里算出它对每个判断的置信度,低于阈值就回退大模型。最后扫一遍阈值,画出成本和准确率的取舍曲线,用数据选工作点。'
pubDate: 2026-10-12
regime: none
tags: ['distillation', 'routing', 'cascade', 'logprobs', 'small-models', 'agent-60']
series: 'agent-60'
day: 79
lang: 'zh'
---

## 今天要解决的问题

Day 77 你训练了一个 4B 的分诊 LoRA,用的训练数据是混合来源的几百条。今天把这件事推到规模化,同时回答一个更实际的问题:小模型总会有判断不准的时候,怎么知道它这次不准,把这一单交给大模型?

学完今天,你应该能做到:

1. 区分三种蒸馏:用大模型输出当标签训练小模型(序列级)、让小模型匹配大模型的输出分布(logit 级)、以及 2025 年开始流行的在线策略蒸馏,知道各自的条件和适用场景。
2. 搭一条「大模型批量打标 → 一致性过滤 → 训练小模型」的流水线,并比较 0.6B、1.7B、4B 三个尺寸的学生模型。
3. 从 vLLM 返回的 logprobs 里算出分诊类别的置信度,写一个「低置信度回退大模型」的路由器。
4. 扫置信度阈值,画出准确率和成本的取舍曲线,检查置信度是否校准,然后选工作点。
5. 设计一个能说服别人的实验:证明「小模型接住了大部分流量,同时质量没有掉到容忍线以下」。

预计用时 5–7 小时。前置:Day 52(按节点路由)、Day 75(选型与 TCO)、Day 76(vLLM)、Day 77(LoRA SFT)。

## 三种蒸馏

蒸馏(distillation)这个词来自 Hinton 2015 年的论文:让一个小的学生模型去学大的老师模型。在大模型应用里,它有三种常见做法,条件和效果差别很大。

序列级蒸馏,也叫数据蒸馏。老师模型对大量输入生成输出,把这些输出当成标准答案,用普通的 SFT 训练学生。这是应用团队最常用的做法,因为它只需要老师模型的文本输出,老师可以是任何闭源 API。DeepSeek 在 R1 论文里就是用这种方式,把 R1 的推理能力蒸馏到了一系列 Qwen 和 Llama 小模型上。缺点是学生只看到老师的「最终答案」,看不到老师对其他选项的犹豫程度。

logit 级蒸馏。学生不只学老师选了哪个 token,还学老师在每个位置上对所有 token 的概率分布。信号更丰富,同样的数据量学得更多。但它有两个硬条件:你要能拿到老师每一步的完整概率分布,所以老师基本只能是你自己部署的开源模型;老师和学生要共用同一套词表,比如 Qwen3 家族的大小模型之间可以,Qwen 和 Llama 之间不行。TRL 里的 GKDTrainer、Unsloth 的蒸馏笔记本走的都是这条路。

在线策略蒸馏(on-policy distillation)。前两种都是学生模仿老师生成的序列,学生没见过自己犯错之后的局面。在线策略蒸馏让学生自己生成,老师对学生生成的每个 token 打分(用两者概率的反向 KL),相当于给了强化学习一个逐 token 的稠密奖励。Thinking Machines 在 2025 年 10 月的博客里报告,这种方法在数学推理上用远少于强化学习的算力达到了更好的效果。它同样需要能拿到老师的逐 token 概率。

对 SupportPilot 的分诊来说,序列级蒸馏就足够了:输出很短,标签空间固定,老师用你现在线上的大模型 API 就行。今天主要做这一种,另外两种知道原理、知道什么时候该考虑就好。

用 API 的输出训练模型之前,先读一遍你所用厂商的服务条款。有的厂商限制用其输出训练与之竞争的模型,做内部的分诊小模型通常没问题,但这个判断应该让法务确认,而不是工程师自己拍板。

## 规模化打标:老师也会错

序列级蒸馏的天花板就是老师的水平,而且老师的错误会被学生忠实地学过去。所以打标这一步要做两件事:让老师尽量准,把老师不确定的样本筛掉。

让老师尽量准的办法:给老师用最强的模型和最详细的提示词,不用在乎成本,因为打标是一次性的。可以在分诊说明里加上每个类别的边界定义和十几个正反例,甚至让老师先写一段判断理由再给标签(理由不用进训练集)。

筛掉不确定样本的办法是自一致性:对同一张工单让老师独立判断三次(temperature 设到 0.7 左右),三次类别一致才留下。更严格一点,可以让两个不同厂商的强模型各判一次,两者一致才留。被筛掉的那些,恰恰是边界模糊的工单,可以单独拿出来让人工标注,它们对学生最有价值。

```python
# agentops-lab/w12/label_with_teacher.py
"""用强模型给无标签工单打分诊标签,三次一致才保留。
输入:unlabeled.jsonl,每行 {"id", "subject", "body"}(来自脱敏后的线上工单,不能含评测集)
输出:labeled.jsonl(一致的)和 disputed.jsonl(不一致的,留给人工)
用法:LLM_BASE_URL=... LLM_API_KEY=... TEACHER_MODEL=deepseek-v4-pro python label_with_teacher.py unlabeled.jsonl
"""
import json
import os
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

from openai import OpenAI

from build_sft_data import SYSTEM, valid   # Day 77 的分诊说明和校验函数
from confidence import parse_triage

TEACHER_GUIDE = SYSTEM + (
    "\n\n类别边界:扣款金额不对、重复扣费归 billing;客户明确要求退钱归 refund;"
    "开票、红冲、专票归 invoice;登录、密码、权限归 account;导入导出、同步、报错码 E2xxx/E3xxx 归 technical;"
    "升级降级换套餐归 plan_change;接口、Key、限流、E5xxx 归 api;都不是归 other。"
)
cli = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
MODEL = os.environ.get("TEACHER_MODEL", "deepseek-v4-pro")


def ask(ticket: dict) -> dict | None:
    r = cli.chat.completions.create(
        model=MODEL, temperature=0.7,
        messages=[{"role": "system", "content": TEACHER_GUIDE},
                  {"role": "user", "content": f"主题:{ticket['subject']}\n正文:{ticket['body']}"}])
    return parse_triage(r.choices[0].message.content or "")


def label(ticket: dict, votes: int = 3):
    answers = [a for a in (ask(ticket) for _ in range(votes)) if a]
    cats = Counter(a.get("category") for a in answers)
    top, n = cats.most_common(1)[0] if cats else (None, 0)
    if n == votes:
        winner = next(a for a in answers if a.get("category") == top)
        rec = {**ticket, "triage": winner, "source": "teacher"}
        if valid(rec):
            return "ok", rec
    return "disputed", {**ticket, "votes": dict(cats)}


def main(path):
    tickets = [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(label, tickets))
    stats = Counter(kind for kind, _ in results)
    with open("labeled.jsonl", "w", encoding="utf-8") as ok, open("disputed.jsonl", "w", encoding="utf-8") as bad:
        for kind, rec in results:
            (ok if kind == "ok" else bad).write(json.dumps(rec, ensure_ascii=False) + "\n")
    print(dict(stats), f"一致率={stats['ok'] / max(1, len(results)):.0%}")


if __name__ == "__main__":
    main(sys.argv[1])
```

打标成本好估:每张工单三次调用,每次输入约 1,200 token(详细的分诊说明加工单)、输出约 60 token。按 Day 52 里查到的 deepseek-v4-pro 高峰价(输入未命中 9 元/百万、输出 27 元/百万)算,一万张工单大约 3 × 10,000 × (1,200 × 9 + 60 × 27) / 1,000,000 ≈ 373 元。分诊说明是固定前缀,缓存命中后实际会便宜不少;空闲时段跑再打五折。和省下来的线上调用费比,这是一次性的小钱。

`labeled.jsonl` 的格式和 Day 77 的 `raw_triage.jsonl` 一样,直接喂给 `build_sft_data.py` 就能生成训练集,它会帮你再挡一次评测集泄漏。

## 学生选多大

学生模型越小,推理越便宜越快,但能力上限越低。不要拍脑袋,三个尺寸都训一遍,让数据说话。同一份训练集、同样的超参数(Day 77 的配置),分别训练:

| 学生模型 | 参数量 | bf16 权重 | 每 token KV(按 config 算) |
| --- | --- | --- | --- |
| Qwen3-0.6B | 0.75B | 约 1.5 GB | 28 层 × 8 头 × 128 维 → 112 KB |
| Qwen3-1.7B | 2.0B | 约 4.1 GB | 同上,112 KB |
| Qwen3-4B-Instruct-2507 | 4.0B | 约 8.0 GB | 36 层 → 144 KB |

参数量取自 Hugging Face 的 safetensors 统计,和名字里的数字略有出入,以模型卡为准。Qwen3-0.6B 和 1.7B 是带思考模式的混合模型,做分诊时要关掉思考:训练时用不带思考的模板,推理时在请求里传 `chat_template_kwargs={"enable_thinking": False}`,Qwen 官方文档里有这个用法。

评测结果填进下表(我没有替你训练,留空)。除了准确率,还要记录在你的 GPU 上的单次延迟,因为小模型的优势最终体现在成本和延迟上:

| 学生 | dev 准确率 | test 准确率 | JSON 合法率 | 单次 P50 延迟 | 一张 24GB 卡的吞吐 |
| --- | --- | --- | --- | --- | --- |
| Qwen3-0.6B + LoRA | | | | | |
| Qwen3-1.7B + LoRA | | | | | |
| Qwen3-4B + LoRA | | | | | |
| 老师(deepseek-v4-pro) | | | | | |

预期的规律是准确率随尺寸上升、在某个尺寸之后上升变缓。选那个「再大也涨不了多少」的拐点尺寸。如果 0.6B 已经和老师差不多,说明这个任务本身不难,选最小的;如果 4B 还离老师很远,先回头看数据和提示词,而不是继续加大学生。

## 置信度:小模型什么时候该说「我不确定」

学生再好,也会有判断不准的工单。路由的关键是让它能区分「这单我有把握」和「这单我拿不准」。最直接的信号是模型自己给出的概率。

vLLM 的 OpenAI 兼容接口支持 `logprobs=True`,返回每个输出 token 的对数概率。分诊输出是一段 JSON,我们关心的是 `"category": "refund"` 里 refund 那几个 token 的概率。把这几个 token 的对数概率相加再取指数,就是模型选这个类别的概率:

```python
# agentops-lab/w12/confidence.py
"""从 logprobs 里算出「category 这个字段取值」的概率,当作分诊置信度。"""
import json
import math
import re


def category_confidence(tokens: list[str], logprobs: list[float]) -> tuple[str | None, float]:
    """tokens / logprobs 是模型输出的逐 token 文本和对数概率(同长度)。
    找到 "category": "xxx" 里 xxx 对应的那几个 token,把它们的对数概率相加再取 exp。"""
    text = "".join(tokens)
    m = re.search(r'"category"\s*:\s*"([a-z_]+)"', text)
    if not m:
        return None, 0.0
    start, end = m.span(1)
    pos, total = 0, 0.0
    for tok, lp in zip(tokens, logprobs):
        tok_start, tok_end = pos, pos + len(tok)
        if tok_end > start and tok_start < end:   # 这个 token 和取值区间有重叠
            total += lp
        pos = tok_end
    return m.group(1), math.exp(total)


def parse_triage(text: str) -> dict | None:
    s = text.strip()
    if s.startswith("`"):                      # 有的模型会把 JSON 包在代码块标记里
        s = s.strip("`").removeprefix("json").strip()
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        return None
```

这里有个细节:一个类别名可能被切成好几个 token(比如 `ref` 和 `und`),也可能有一个 token 横跨引号和类别名的开头,所以按字符区间找重叠的 token,而不是假设一个类别就是一个 token。这个函数我写了单元测试,对拆开的 token 和找不到字段的情况都测过。

有了置信度,路由器就很简单了:先问小模型,置信度够就用它的结果,不够就问大模型。

```python
# agentops-lab/w12/router.py
"""分诊路由:小模型先判,置信度低于阈值回退大模型。"""
import os
import time

from openai import OpenAI

from build_sft_data import SYSTEM
from confidence import category_confidence, parse_triage

SMALL = OpenAI(base_url=os.environ["SMALL_BASE_URL"], api_key=os.environ["SMALL_API_KEY"])
BIG = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
SMALL_MODEL = os.environ.get("SMALL_MODEL", "triage")           # vLLM 里挂的 LoRA 名
BIG_MODEL = os.environ.get("LLM_MODEL", "deepseek-v4-pro")
THRESHOLD = float(os.environ.get("TRIAGE_THRESHOLD", "0.9"))


def _messages(ticket):
    return [{"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"主题:{ticket['subject']}\n正文:{ticket['body']}"}]


def triage(ticket: dict) -> dict:
    t0 = time.perf_counter()
    r = SMALL.chat.completions.create(model=SMALL_MODEL, temperature=0, logprobs=True,
                                      messages=_messages(ticket), max_tokens=120)
    content = r.choices[0].logprobs.content or []
    cat, conf = category_confidence([c.token for c in content], [c.logprob for c in content])
    result = parse_triage(r.choices[0].message.content or "")
    if result and cat and conf >= THRESHOLD:
        return {**result, "_route": "small", "_conf": conf, "_ms": (time.perf_counter() - t0) * 1000}

    r2 = BIG.chat.completions.create(model=BIG_MODEL, temperature=0, messages=_messages(ticket))
    result = parse_triage(r2.choices[0].message.content or "") or {"category": "other", "needs_human": True}
    return {**result, "_route": "big", "_conf": conf, "_ms": (time.perf_counter() - t0) * 1000}
```

把它接进 SupportPilot,就是让 Day 47 的分诊节点调 `triage()` 而不是直接调模型。`_route` 和 `_conf` 两个字段要写进 Langfuse 的 trace(Day 52 的 metadata),上线后你才能统计回退率,以及回退的那些工单都是什么类型。

## 扫阈值,画取舍曲线

阈值定多少?不要拍脑袋,扫一遍。做法是在评测集上把小模型和大模型各跑一遍,记录每条用例:小模型对不对、置信度多少、花多少钱;大模型对不对、花多少钱。然后对每个候选阈值,模拟「置信度够就用小模型、不够就回退大模型」,算出整体的准确率、成本和回退率。这个模拟是纯离线计算,改阈值不用重新调模型:

```python
# agentops-lab/w12/sweep.py
"""扫置信度阈值,算「小模型 + 低置信度回退大模型」在每个阈值下的准确率、成本和回退率。
输入两个逐条结果文件(同一批评测用例,用 id 对齐):
  small.jsonl:{"id", "correct": bool, "conf": float, "cost": float}
  big.jsonl:  {"id", "correct": bool, "cost": float}
用法:python sweep.py small.jsonl big.jsonl
"""
import json
import sys


def load(path):
    return {r["id"]: r for r in (json.loads(l) for l in open(path, encoding="utf-8") if l.strip())}


def sweep(small: dict, big: dict, thresholds=None):
    ids = sorted(set(small) & set(big))
    thresholds = thresholds or [0.0, 0.5, 0.7, 0.8, 0.9, 0.95, 0.99, 1.01]
    rows = []
    for t in thresholds:
        correct = cost = fallback = 0
        for i in ids:
            s = small[i]
            cost += s["cost"]                      # 小模型每条都要先跑
            if s["conf"] >= t:
                correct += s["correct"]
            else:
                fallback += 1
                correct += big[i]["correct"]
                cost += big[i]["cost"]             # 回退的要再付一次大模型的钱
        n = len(ids)
        rows.append({"threshold": t, "acc": correct / n, "cost_per_1k": 1000 * cost / n,
                     "fallback_rate": fallback / n})
    big_only = {"acc": sum(big[i]["correct"] for i in ids) / len(ids),
                "cost_per_1k": 1000 * sum(big[i]["cost"] for i in ids) / len(ids)}
    return rows, big_only


def calibration(small: dict, bins=(0.0, 0.5, 0.7, 0.8, 0.9, 0.95, 1.0001)):
    """按置信度分桶,看每个桶里的真实准确率,检查置信度靠不靠谱。"""
    out = []
    for lo, hi in zip(bins, bins[1:]):
        xs = [r for r in small.values() if lo <= r["conf"] < hi]
        if xs:
            out.append((lo, hi, len(xs), sum(r["correct"] for r in xs) / len(xs)))
    return out


if __name__ == "__main__":
    small, big = load(sys.argv[1]), load(sys.argv[2])
    rows, big_only = sweep(small, big)
    print(f"只用大模型: acc={big_only['acc']:.3f} 元/千次={big_only['cost_per_1k']:.2f}")
    print(f"{'阈值':>6}{'准确率':>8}{'元/千次':>10}{'回退率':>8}")
    for r in rows:
        print(f"{r['threshold']:>6.2f}{r['acc']:>8.3f}{r['cost_per_1k']:>10.2f}{r['fallback_rate']:>8.0%}")
    print("\n置信度校准(区间, 条数, 真实准确率):")
    for lo, hi, n, acc in calibration(small):
        print(f"  [{lo:.2f}, {min(hi, 1):.2f})  n={n:<4} acc={acc:.2f}")
```

阈值 0 等于全用小模型,阈值大于 1 等于每条都回退(而且多付了小模型那一次的钱,所以比「只用大模型」还贵一点)。中间每个阈值是一个点,把它们画在「横轴成本、纵轴准确率」的图上,就是一条取舍曲线。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="成本与准确率的取舍曲线示意:不同阈值对应曲线上的点">
<line x1="70" y1="250" x2="600" y2="250" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="70" y1="250" x2="70" y2="30" stroke="var(--rule)" stroke-width="1.5"/>
<text x="335" y="285" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)" text-anchor="middle">每千次分诊成本(元)→</text>
<text x="30" y="140" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)" text-anchor="middle" transform="rotate(-90 30 140)">准确率 →</text>
<path d="M 110 190 C 170 110, 230 80, 330 68 S 480 60, 560 58" fill="none" stroke="var(--mem)" stroke-width="2"/>
<circle cx="110" cy="190" r="5" fill="var(--mem)"/>
<text x="118" y="210" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">阈值 0:全用小模型</text>
<circle cx="230" cy="83" r="5" fill="var(--mem)"/>
<circle cx="330" cy="68" r="7" fill="var(--compute)"/>
<text x="338" y="95" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">工作点:拐点附近</text>
<circle cx="560" cy="58" r="5" fill="var(--mem)"/>
<text x="470" y="45" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">阈值 >1:全回退</text>
<line x1="70" y1="75" x2="600" y2="75" stroke="var(--compute)" stroke-dasharray="4 4"/>
<text x="590" y="88" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="end">容忍线</text>
</svg>
<figcaption>示意图,不是实测数据。曲线先陡后平:提高阈值一开始能用很少的回退换来大幅提升,过了拐点就是花大钱换小提升。工作点选在容忍线以上、成本最低的那个阈值。</figcaption>
</figure>

选工作点的规则要事先写下来,不要看了结果再编理由:准确率不低于 Day 43 定的容忍线,满足这个条件的阈值里选成本最低的。如果最低成本的那个阈值回退率很高(比如 50%),说明小模型没训好,省钱效果有限,回头改进学生模型。

`calibration()` 那一段是在检查置信度靠不靠谱。理想情况下,置信度 0.9 到 0.95 的那一桶,真实准确率也应该在 0.9 左右。如果高置信度的桶里准确率反而很低,说明模型「自信地犯错」,这种情况下按置信度路由会失效。微调过的小模型常常过度自信,对策有两个:用验证集做温度缩放校准;或者干脆不依赖它的绝对数值,只用它排序,阈值完全由扫描结果决定。

还要单独看回退的那部分。整体准确率达标,不代表每个类别都达标。按类别统计回退率和最终准确率,如果 refund 类的回退率特别高,说明小模型在这个高风险类别上不行,可以干脆给它定规则:refund 和 billing 一律交给大模型,不走置信度判断。这和 Day 75 讲的「按风险路由」是同一个思路,只不过现在有数据支撑了。

## 其他路由方式,知道就好

用小模型自己的置信度做级联,是最简单的一种。还有两种你在资料里会看到:

学出来的路由器。训练一个独立的轻量分类器,输入是请求,输出是「小模型能不能搞定这个请求」的概率。RouteLLM 用人类偏好数据训练这类路由器,在强弱两个模型之间分流。好处是路由器很小、判断很快,而且不需要先跑一遍小模型;坏处是要额外维护一个模型和它的训练数据。

基于规则和特征的路由。工单长度、是否包含金额、客户等级、是否带附件,这些特征和难度相关,可以写成规则。听起来土,但很多线上系统第一版就是这样,可解释、好调试。

资深的做法通常是组合:规则先处理明确的情况(高风险类别直接走大模型),剩下的用置信度级联,上线后用回退率和人工改判率持续调整。

## 动手练习

今天的产出物是一个蒸馏出来的分诊学生模型、一个带回退的路由器,和一张取舍曲线。

1. 准备至少 3,000 张无标签工单(脱敏后的线上数据,或者用 Day 31 的方法合成),确认不含评测集内容。
2. 跑 `label_with_teacher.py`,记录一致率和打标总花费;从 `disputed.jsonl` 里抽 30 条自己判断,看老师们在哪类工单上意见不一。
3. 用 `build_sft_data.py` 生成训练集,按 Day 77 的方法训练 0.6B 和 1.7B 两个学生(有余力再加 4B),填尺寸对比表。
4. 选一个学生挂到 vLLM,用 `router.py` 在 dev 集上跑一遍,同时让大模型单独跑一遍,生成 `small.jsonl` 和 `big.jsonl`;跑 `sweep.py`,画取舍曲线,检查校准表。
5. 写选型结论:选哪个学生、阈值多少、预计回退率多少、相比全用大模型每月省多少钱(用 Day 52 账本的月调用量算),以及哪些类别你决定不走小模型、理由是什么。
6. 在 test 集上用选定的配置跑一次最终验证。test 集只在这一步用一次,不能拿它来调阈值。

验收标准:取舍曲线至少有 6 个阈值点;结论里的工作点满足事先写下的选择规则;test 集结果单独报告,并且和 dev 集结果的差距在你能解释的范围内。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 蒸馏 | 让小的学生模型学习大的老师模型的行为 |
| 序列级蒸馏 | 用老师生成的文本当标签做 SFT,只需要老师的文本输出 |
| logit 级蒸馏 | 学生匹配老师每一步的完整概率分布,需要共用词表和白盒老师 |
| 在线策略蒸馏 | 学生自己生成,老师对学生的每个 token 打分,提供稠密的训练信号 |
| 自一致性 | 同一问题多次独立回答,用一致程度判断可靠性 |
| 级联 | 先用便宜模型,不达标再交给贵模型 |
| 置信度 | 模型对某个判断的确信程度,这里用类别 token 的概率表示 |
| 校准 | 置信度和真实准确率相符的程度,0.9 置信度的判断应该大约 90% 是对的 |
| 回退率 | 被路由到大模型的请求比例 |
| 工作点 | 根据事先定好的规则在取舍曲线上选出的具体配置 |

## 常见误区

**以为学生能超过老师。** 序列级蒸馏的上限就是老师在这批数据上的水平,而且老师的系统性错误会被学生学去。想超过老师,需要人工标注的高质量数据,或者强化学习这类能利用外部反馈的方法。

**用评测集调阈值再用评测集报结果。** 阈值是在 dev 集上选出来的,报最终效果要用没参与过任何决策的 test 集,否则数字是偏乐观的。

**直接相信小模型的置信度。** 微调后的小模型经常过度自信。上线前一定看校准表,高置信度的桶里准确率不达标,就别用这个置信度做路由。

**只看整体准确率。** 整体达标可能掩盖某个高风险类别的退化。按类别拆开看回退率和准确率,高风险类别宁可规则强制走大模型。

**忘了回退的成本和延迟。** 回退的请求要付两次钱、等两次延迟。回退率 40% 时,P95 延迟可能比全用大模型还差。成本、准确率、延迟三个一起看。

## 学习资料

### 文档与文章

- [Hinton 等 · Distilling the Knowledge in a Neural Network](https://arxiv.org/abs/1503.02531):蒸馏的原始论文,读第 1、2 节理解「软标签」,30 分钟。
- [On-Policy Distillation of Language Models(GKD)](https://arxiv.org/abs/2306.13649):让学生在自己生成的序列上学习老师分布,TRL 的 GKDTrainer 就是它,读摘要和方法。
- [Thinking Machines · On-Policy Distillation](https://thinkingmachines.ai/blog/on-policy-distillation/):2025 年 10 月,讲清楚三种后训练方式的区别和在线策略蒸馏的成本优势,1 小时,强烈推荐。
- [DeepSeek-R1 论文](https://arxiv.org/abs/2501.12948):看蒸馏那一节,用大模型的推理数据训练 Qwen 和 Llama 小模型,序列级蒸馏的代表案例。
- [FrugalGPT](https://arxiv.org/abs/2305.05176)和 [RouteLLM](https://arxiv.org/abs/2406.18665):级联和学习型路由器的两篇代表论文,各读方法部分。
- [TRL · GKD Trainer](https://huggingface.co/docs/trl/main/en/gkd_trainer):logit 级蒸馏的实现和参数。
- [vLLM 快速开始](https://docs.vllm.ai/en/latest/getting_started/quickstart.html):OpenAI 兼容接口支持 `logprobs` 和 `top_logprobs` 参数,今天的置信度计算就靠它。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1VP411h7kn&autoplay=0&high_quality=1" title="知识蒸馏:小模型向大模型学习" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI大实话 · 知识蒸馏:小模型向大模型学习 · 11 分钟,讲清楚软标签和温度的作用,对应正文 logit 级蒸馏的部分。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ZFzXB6E3V&autoplay=0&high_quality=1" title="基于大模型蒸馏小模型全流程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>西瓜讲大模型 · 基于大模型蒸馏小模型全流程 · 约 1 小时 50 分,2026 年 1 月,从造数据到训练评测完整走一遍,挑数据构造和评测两段看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/jrJKRYAdh7I" title="Knowledge Distillation: How LLMs train each other" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Julia Turc · Knowledge Distillation: How LLMs train each other · 把蒸馏在大模型时代的几种形态讲得很清楚,和正文三种蒸馏对照看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/V_K6PCmdtRg" title="What is an LLM Router?" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Sam Witteveen · What is an LLM Router? · 讲 RouteLLM 的思路和几种路由器,对应正文最后一节。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 8 章 Dataset Engineering 里讲数据合成和模型蒸馏的部分,1 小时。

### 开源项目与代码

- [lm-sys/RouteLLM](https://github.com/lm-sys/RouteLLM):学习型路由器的实现,看 README 里的路由器类型和评测方法。
- [unslothai/notebooks · Qwen3 (0.6B) Knowledge Distillation](https://github.com/unslothai/notebooks/blob/main/nb/Qwen3_%280.6B%29-Knowledge_Distillation.ipynb):用 GKD 把 Qwen3-1.7B 蒸馏到 0.6B 的笔记本,想试 logit 级蒸馏的从这里开始,注意它要求师生共用词表。
- [huggingface/trl](https://github.com/huggingface/trl):在仓库里搜 `GKDTrainer` 找到实现,看它怎么同时加载老师和学生两个模型。

## 自测

1. 老师是闭源 API,学生是 Qwen3-1.7B。三种蒸馏里你能用哪种?为什么?

<details><summary>答案</summary>

只能用序列级蒸馏。logit 级蒸馏需要老师每一步的完整概率分布并且和学生共用词表,在线策略蒸馏也需要老师对学生生成的 token 给出概率,闭源 API 一般拿不到完整分布,词表也不同。

</details>

2. 老师三次投票的一致率只有 70%,剩下 30% 进了 disputed。你怎么看,下一步做什么?

<details><summary>答案</summary>

30% 的工单老师都拿不准,说明类别边界定义不清或者工单本身模糊。先抽样看这些工单,是边界定义问题就补充分诊说明里的边界和例子,重新打标;是工单本身多意图(既要退款又要开票),可能需要调整分类体系(比如允许多标签)。disputed 里的样本人工标注后加进训练集,对学生最有价值。

</details>

3. 置信度校准表显示,[0.95, 1.0) 这一桶有 400 条,真实准确率 0.82。这对路由意味着什么?

<details><summary>答案</summary>

模型过度自信:它说 95% 以上把握的判断,实际只有 82% 是对的。直接用 0.95 当阈值会让大量错误绕过回退。可以用验证集做温度缩放校准,或者不看置信度的绝对值,只用阈值扫描的结果选工作点;对高风险类别用规则强制回退。

</details>

4. 为什么阈值大于 1(全部回退)时的成本比「只用大模型」还高?

<details><summary>答案</summary>

每条请求都先调了一次小模型,置信度不够再调大模型,相当于每条都付了两次钱。所以级联只有在大部分请求能被小模型接住时才省钱。

</details>

5. (资深面试题)你给公司设计了「小模型分诊 + 置信度回退」的方案,上线两周后回退率从离线评测的 15% 涨到了 35%。你怎么分析和处理?

<details><summary>答案</summary>

先按维度拆开回退的请求:按类别、渠道、时间、工单长度,看是不是某类新出现的工单(新产品功能、新错误码、促销活动带来的新问题)在拉高回退,这是线上分布漂移。再检查校准:新分布上置信度是否整体偏低。处理分短期和长期:短期保持回退兜底(质量没坏,只是成本上升),必要时临时调整阈值并评估影响;长期把这批新工单打标(老师加人工抽检)加入训练集重训,并把新类型加进评测集。同时把回退率做成监控指标和告警,建立定期重训的流程,而不是等它涨了才发现。

</details>

6. 你只有一张 24 GB 的卡,想在上面同时服务分诊学生模型和起草用的 4B 模型,有什么办法?

<details><summary>答案</summary>

如果两个任务都基于同一个基座(比如都是 Qwen3-4B-Instruct-2507),用 vLLM 的多 LoRA 功能,一个基座挂两个适配器,通过不同的模型名访问。如果学生是更小的独立模型,可以起两个 vLLM 进程,用 `--gpu-memory-utilization` 给每个分配一部分显存,并按 Day 76 的显存账确认 KV cache 够用。

</details>

## 明天预告

Day 80 · 强化学习与 Agent:RLVR、GRPO 和工具使用训练。蒸馏的上限是老师,想超过老师,就要让模型从结果的对错里学习。明天讲 2025 年以来推理模型和 Agent 能力为什么越来越靠强化学习提升,GRPO 是怎么工作的,怎么给 Agent 设计奖励,再跑一个最小的 GRPO 玩具实验。
