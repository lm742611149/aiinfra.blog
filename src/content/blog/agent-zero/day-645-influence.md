---
title: 'Day 645 · 带人和推动:一页纸、让别人自愿迁移、带新人、回应「AI 不靠谱」'
description: '资深工程师没有行政权力,却要让老板拍板、让别的团队迁移、让新人把 Agent 做对。今天用脚本做四件事:从回本测算和试点数据生成一页纸并检查它,按调用量量化平台采用率找出卡住的团队,检查带新人的每周任务能不能验收,再用 Wilson 区间和人工基线比较,回应「AI 不靠谱」。最后让模型扮演多疑的 CTO 给一页纸挑刺。'
pubDate: 2026-10-22
regime: none
tags: ['leadership', 'influence', 'roi', 'mentoring', 'staff-engineer', 'python', 'agent-zero']
series: 'agent-zero'
day: 645
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 644](/blog/agent-zero/day-644-staff-sd-2/) 练了两道 Staff 系统设计题。真题二用两次利特尔定律算出十万并发客服 Agent 需要 3.3 万个在途模型请求、人工坐席只扛得住 6% 的转人工率;真题三讲了 pass@k 和 pass^k,以及为什么两个版本比较要用配对而不是比两个百分比。最后用八条追问练了 30 秒快答。

系统设计面试是在 45 分钟里说服一个面试官。入职以后的事更难:要在几周甚至几个月里说服一群人,而且他们没有义务听你讲完。今天讲的就是这件事。它不像前几天那样有明确的「正确答案」,但很多部分依然能落到数字和脚本上,这也是我想让你学会的:**影响力不是口才,大部分是把别人担心的东西提前算清楚。**

## 今天要解决的问题

学完今天,你应该能做到:

1. 说清资深工程师「没有权力但要有影响力」的具体含义,知道 Will Larson 讲的四种 Staff 角色各靠什么产生影响。
2. 用 [Day 641](/blog/agent-zero/day-641-build-vs-buy/) 的回本测算加试点数据生成一页纸,并用一个小检查器保证第一句是要的决定、每个数字有来源、篇幅在一页以内。
3. 设计一个让业务团队自愿迁移的平台推广计划,并按调用量量化采用率,找出卡住的团队。
4. 给新人排四周任务,每个任务都能用一个指标验收;面对「AI 不靠谱」,用 Wilson 区间和人工基线给出诚实的回应。

预计用时:3 小时,一半时间在写自己的一页纸和推广计划。前置:[Day 641](/blog/agent-zero/day-641-build-vs-buy/)(回本测算)、[Day 547](/blog/agent-zero/day-547-eval-stats-1/)(Wilson 区间)、[Day 583](/blog/agent-zero/day-583-platform-1/)(什么时候该做平台)、[Day 345](/blog/agent-zero/day-345-error-analysis-1/)(错误分析)、[Day 640](/blog/agent-zero/day-640-design-docs-1/)(数字标签)。

学法提示:先对照文章逐行敲一遍代码(不复制粘贴)并跑通;第二天合上文章,把一页纸的三段结构和回应质疑的三步默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 没有权力的影响力

先说一个很多人升资深时很难受的事实:职级变高了,你能直接命令的人并没有变多。你不能让产品经理改需求,不能让另一个团队的工程师改代码,也不能让老板批预算。你能做的,是让他们自己愿意这么做。

前端的经验里其实有类似的东西。你大概经历过推一个团队统一换组件库、或者统一接一个新的埋点 SDK:你没法命令别的业务线的前端改代码,最后能推下去的,往往是因为新组件库确实更好用、迁移脚本一行命令跑完、有人在群里随时答疑。今天讲的是同一件事,范围从一个前端组件库变成了整个公司的 Agent 平台。

Will Larson 在《Staff Engineer》这本书里把 Staff 工程师分成四种角色(这四种在他的网站 staffeng.com 上有免费的原文):

| 角色 | 主要工作 | 影响力从哪来 |
| --- | --- | --- |
| Tech Lead | 带一个团队完成一个方向 | 和团队的日常协作,技术判断被反复验证 |
| Architect | 负责一个关键领域的技术方向 | 对领域的深度理解,设计文档和评审 |
| Solver | 被派去解决最难的问题 | 解决问题的记录,一个接一个 |
| Right Hand | 作为高层管理者的延伸 | 和管理层的信任,能代表他们做判断 |

做 Agent 平台的资深工程师,大多数时候是 Tech Lead 和 Architect 的混合。不管哪种,影响力的来源都差不多:**你的判断被验证过很多次。** 所以前期最重要的是挑几件能快速验证的事做成,用结果攒信用。一上来就推动一个半年才见效的大改造,很容易在中途失去支持,因为半年里没有任何一个时间点能证明你是对的。

国内公司还多一层现实:很多决定是在周会、周报和 OKR 对齐里做出来的。把你的方案放进老板已经关心的目标里(降本、提效、风险),比单独讲技术价值有效得多。这不是迎合,是翻译,把技术语言翻译成决策者的语言。

动手推任何一件事之前,我会先画一张干系人地图(stakeholder map):把相关的人按「对决策的影响力」和「对这件事的关注度」放进四个格子,精力按格子分配。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="干系人地图:按决策影响力和关注度分成四格">
<line x1="80" y1="195" x2="600" y2="195" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="80" y1="195" x2="80" y2="20" stroke="var(--rule)" stroke-width="1.5"/>
<text x="340" y="220" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">对这件事的关注度 →</text>
<text x="40" y="108" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)" transform="rotate(-90 40 108)">决策影响力 →</text>
<rect x="340" y="25" width="250" height="78" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="465" y="56" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">重点经营</text>
<text x="465" y="76" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">客服总监、你的老板</text>
<rect x="90" y="25" width="240" height="78" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="210" y="56" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">保持满意</text>
<text x="210" y="76" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">CTO、安全合规负责人</text>
<rect x="340" y="112" width="250" height="72" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="465" y="143" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">及时告知</text>
<text x="465" y="163" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">客服坐席、业务团队工程师</text>
<rect x="90" y="112" width="240" height="72" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="210" y="143" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">定期同步</text>
<text x="210" y="163" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">其他部门</text>
</svg>
<figcaption>干系人地图。右上角的人要在写设计文档之前就单独聊过,这和 Day 640 说的「评审前私下预沟通」是一回事。</figcaption>
</figure>

## 第一步:给管理层写一页纸

管理层看方案,通常只有十分钟,并且会问三个问题:这件事值多少钱?要花多少钱和多少人?最坏会怎样?一页纸就是围绕这三个问题写的。

结构借芭芭拉·明托《金字塔原理》的思路:**结论先行,论据分组,每组再往下展开。** 第一句话就写需要对方做的决定和资源,下面三段分别回答三个问题,技术细节一律放附录,链到设计文档。

这一节的数字都现成:回本测算是 Day 641 的 `roi.py`,试点数据的置信区间用 [Day 547](/blog/agent-zero/day-547-eval-stats-1/) 讲过的 Wilson 区间。Wilson 区间一句话复习:通过率的 95% 置信区间,比课本上的「p ± 1.96 × 标准误」在样本少或者比例接近 0、1 时准得多。先把它写成一个可复用的小模块 `part10/wilson.py`,今天要用两次:

```python
# agent-zero-lab/part10/wilson.py
from math import sqrt

def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    p = k / n
    center = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return center - half, center + half

if __name__ == "__main__":
    lo, hi = wilson(2542, 4100)
    print(f"试点独立解决 2542/4100 = {2542 / 4100:.1%},95% 区间 {lo:.1%} ~ {hi:.1%}")
```

<div class="line-notes">

- `def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:` `k` 是成功次数,`n` 是总数,`z = 1.96` 对应 95% 置信度。返回区间的上下界。
- `p = k / n` 观察到的比例,`2542 / 4100 = 0.62`。
- `center = (p + z * z / (2 * n)) / (1 + z * z / n)` Wilson 区间的中心不是 p 本身,会往 0.5 方向拉一点点。n 很大时几乎没区别,n 小、p 接近 0 时区别很大,下面算错误率时就能看到。
- `half = z * sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)` 区间的半宽。公式不用背,知道它比 `p ± 1.96 × sqrt(p(1-p)/n)` 多了几个修正项就行。
- `lo, hi = wilson(2542, 4100)` 假设的试点数据:8 周 4100 张工单,Agent 独立解决了 2542 张。

</div>

```bash
uv run python -m part10.wilson
```

```text
试点独立解决 2542/4100 = 62.0%,95% 区间 60.5% ~ 63.5%
```

然后是一页纸生成器 `part10/onepager.py`。它把回本测算和试点数据填进固定的三段结构,再用一个小检查器检查三件事:第一段是不是要的决定、每个数字有没有标来源、总长度有没有超过一页。

```python
# agent-zero-lab/part10/onepager.py
from pathlib import Path

from part10.roi import Assumptions, monthly, payback_months
from part10.wilson import wilson

SOLVED, TOTAL = 2542, 4100        # 试点 8 周独立解决的工单(假设的试点数据)
ENGINEERS, MONTHS = 2, 1          # 要的资源

def build(a: Assumptions) -> str:
    m = monthly(a)
    lo, hi = wilson(SOLVED, TOTAL)
    return "\n".join([
        "# 提议:CloudLedger 客服 Agent 从试点扩大到全部文字渠道",
        "",
        f"**需要的决定**:批准 {ENGINEERS} 名工程师 × {MONTHS} 个月,外加每月约 {a.tickets * a.model_per_ticket:,.0f} 元模型费(假设)。",
        "",
        "## 值多少",
        f"- 试点独立解决率 {SOLVED / TOTAL:.0%}(实测,{TOTAL} 张工单,95% 区间 {lo:.1%}~{hi:.1%})。",
        f"- 测算按保守的 {a.auto_rate:.0%} 自动解决算,每月净省 {m['净收益']:,.0f} 元(假设,算式见附录)。",
        "## 花多少",
        f"- 一次性 {a.build_cost:,.0f} 元,之后每月维护 {a.maintain:,.0f} 元(假设)。",
        f"- 回本 {payback_months(a):.1f} 个月(假设)。",
        "## 最坏会怎样",
        f"- 每月答错损失约 {m['其中答错']:,.0f} 元(假设),退款一律人工确认。",
        "- 止损:任一周差评率比人工基线高 2 个百分点,自动退回试点范围。",
    ])

def check(text: str) -> list[str]:
    lines = [x for x in text.splitlines() if x.strip()]
    problems = []
    if not lines[1].startswith("**需要的决定**"):
        problems.append("第一段不是要的决定")
    for x in lines:
        has_num = any(ch.isdigit() for ch in x) and not x.startswith("#")
        if has_num and not any(t in x for t in ("预期", "实测", "假设", "止损")):
            problems.append(f"数字没标来源:{x[:30]}")
    if len(text) > 800:
        problems.append(f"太长了:{len(text)} 字,一页纸控制在 800 字以内")
    return problems

if __name__ == "__main__":
    text = build(Assumptions(auto_rate=0.5))
    Path("part10/samples/onepager.md").write_text(text + "\n", encoding="utf-8")
    print(text)
    print("\n检查:", check(text) or "通过", f"({len(text)} 字)")
```

<div class="line-notes">

- `from part10.roi import Assumptions, monthly, payback_months` Day 641 的回本测算。一页纸里的钱数全部从这里算出来,不手抄,改一个假设一页纸跟着变。
- `SOLVED, TOTAL = 2542, 4100` 试点数据是我编的示例数字,注释里写明了。你写自己的一页纸时,这里是从客服系统导出的真实数字。
- `ENGINEERS, MONTHS = 2, 1` 要的资源。一页纸第一句话就要写它。
- `f"**需要的决定**:批准 {ENGINEERS} 名工程师 × {MONTHS} 个月,` 第一句话直接说要什么。很多工程师写方案像写论文,背景铺垫三段才说到请求,管理层读到第三段可能已经去开下一个会了。后半句的模型费是每月 `3000 × 0.0244 = 73` 元。这个数小得有点滑稽,下面会说它为什么还要写进第一句。
- `f"- 试点独立解决率 {SOLVED / TOTAL:.0%}(实测,{TOTAL} 张工单,95% 区间 {lo:.1%}~{hi:.1%})。",` 数字带样本量和区间。「解决率 62%」和「4100 张工单上 62%,区间 60.5% 到 63.5%」在老板眼里可信度差很多。
- `f"- 测算按保守的 {a.auto_rate:.0%} 自动解决算,` 试点实测 62%,测算却按 50% 算。故意保守一点,给扩大范围后的效果下降留余量,也让「数字被挑战」时你有退路。
- `f"- 每月答错损失约 {m['其中答错']:,.0f} 元(假设),退款一律人工确认。",` 主动写风险。按 50% 自动解决算,答错损失是 `3000 × 0.5 × 0.02 × 200 = 6,000` 元。
- `"- 止损:任一周差评率比人工基线高 2 个百分点,自动退回试点范围。",` 止损点必须是能自动判断的指标阈值,而不是「如果效果不好我们会评估」。
- `def check(text: str) -> list[str]:` 一页纸的检查器,思路和 Day 640 的 `doc_lint.py` 一样,只是规则换成一页纸的。
- `lines = [x for x in text.splitlines() if x.strip()]` 去掉空行。`lines[0]` 是标题,`lines[1]` 应该就是「需要的决定」。
- `has_num = any(ch.isdigit() for ch in x) and not x.startswith("#")` 这一行有没有数字,标题行不查。`ch.isdigit()` 判断一个字符是不是数字,≈ JS 的 `/\d/.test(ch)`。
- `if has_num and not any(t in x for t in ("预期", "实测", "假设", "止损")):` 有数字就必须标来源。止损那行的数字是规则不是估计,所以「止损」也算豁免词,和 Day 640 豁免「目标」一节是同一个道理。
- `if len(text) > 800:` 中文一页 A4 大概七八百字,超过就不叫一页纸了。
- `text = build(Assumptions(auto_rate=0.5))` 只改自动解决率,其余用 Day 641 的基准假设。
- `print("\n检查:", check(text) or "通过", f"({len(text)} 字)")` `print` 接多个参数时用空格隔开打印,≈ `console.log(a, b, c)`。

</div>

```bash
uv run python -m part10.onepager
```

```text
# 提议:CloudLedger 客服 Agent 从试点扩大到全部文字渠道

**需要的决定**:批准 2 名工程师 × 1 个月,外加每月约 73 元模型费(假设)。

## 值多少
- 试点独立解决率 62%(实测,4100 张工单,95% 区间 60.5%~63.5%)。
- 测算按保守的 50% 自动解决算,每月净省 9,927 元(假设,算式见附录)。
## 花多少
- 一次性 60,000 元,之后每月维护 7,500 元(假设)。
- 回本 6.0 个月(假设)。
## 最坏会怎样
- 每月答错损失约 6,000 元(假设),退款一律人工确认。
- 止损:任一周差评率比人工基线高 2 个百分点,自动退回试点范围。

检查: 通过 (318 字)
```

几个写法上的细节值得停下来看。

**收益要换算成老板的单位。** 「转人工率下降 18%」对客服总监有意义,对 CEO 没感觉。换成「每月净省约 1 万元」或者「少招两个坐席」。CloudLedger 这个规模,每月省一万不算大钱,所以真实提案里我还会写次要收益:夜间响应从第二天早上变成一分钟以内。

**每月 73 元模型费为什么还写进第一句。** 因为老板听到「AI 项目」,脑子里的第一个担心经常是「模型费会不会失控」。第一句就把它写出来,等于提前回答了一个他没问出口的问题,后面他会把注意力放到真正的大头(两个工程师一个月、每月 7,500 维护)上。

**Agent 和人工的算式要诚实。** [Day 396](/blog/agent-zero/day-396-cost-1/) 和 Day 641 都讲过:Agent 的成本不只是 token,还有人工复核、答错补救、维护人力。只算 token 得出的 ROI 一定虚高,懂行的老板一眼就能看穿,被拆穿一次,你后面所有的数字都会被打折听。

**主动写风险和止损点。** 工程师常常怕写风险会让方案被否掉,实际情况相反:你不写,老板会自己想,而且想得比实际更坏。你写了并给出能自动触发的止损,等于告诉他「最坏的情况我已经替你兜住了」。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1pK4y1e71B&autoplay=0&high_quality=1" title="【汇报技巧】十分钟掌握方案汇报技巧" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>KKLAout · 【汇报技巧】十分钟掌握方案汇报技巧 · 10 分钟,不是技术视频,讲方案汇报的结构和节奏,和上面的三段结构对照着看,写自己的一页纸之前看。</figcaption>
</figure>

## 让模型扮演多疑的 CTO

一页纸写完,最好找个人从反方向挑一遍。没人的时候,让模型扮演一个上一个 AI 项目失败过、对 AI 持怀疑态度的 CTO。`part10/skeptic.py`,用 [Day 136](/blog/agent-zero/day-136-llm-client-2/) 的 `LLMClient`,读的是上一步写出来的 `part10/samples/onepager.md`:

```python
# agent-zero-lab/part10/skeptic.py
import json
from pathlib import Path

from common.llm import LLMClient

CTO = """你是一家 SaaS 公司的 CTO,对 AI 项目持怀疑态度,上一个 AI 项目失败过。
读下面这份一页纸提案,提出 5 个最尖锐的问题,每个问题针对提案里的一句具体的话。
每个问题标一类:数据可信度、成本、风险、责任、组织。
只输出 JSON:{"questions": [{"type": "...", "quote": "提案原句", "question": "..."}]}"""

doc = Path("part10/samples/onepager.md").read_text(encoding="utf-8")
llm = LLMClient()
r = llm.chat([{"role": "system", "content": CTO}, {"role": "user", "content": doc}],
             temperature=0, response_format={"type": "json_object"})
for i, q in enumerate(json.loads(r.content)["questions"], start=1):
    print(f"{i}. [{q['type']}] {q['question']}\n   针对:{q['quote'][:30]}")
print(llm.ledger)
```

<div class="line-notes">

- `CTO = """你是一家 SaaS 公司的 CTO,对 AI 项目持怀疑态度,上一个 AI 项目失败过。` 角色要具体到有立场。「上一个 AI 项目失败过」这半句会让它的问题明显更尖锐,我试过去掉这半句,问题变得很客气。
- `每个问题针对提案里的一句具体的话。` 逼它引用原文,问题才能落到你能改的地方。
- `每个问题标一类:数据可信度、成本、风险、责任、组织。` 五类正好对应老板常见的五种担心,你回头看哪一类问题最多,就知道一页纸哪里最薄。
- `response_format={"type": "json_object"}` JSON mode,提示词里有「JSON」字样。
- `for i, q in enumerate(json.loads(r.content)["questions"], start=1):` 编号从 1 开始打印。
- `print(f"{i}. [{q['type']}] {q['question']}\n   针对:{q['quote'][:30]}")` 引用原句只打前 30 个字,够定位就行。

</div>

```bash
uv run python -m part10.skeptic
```

实跑输出(模型每次的问题可能不同):

```text
1. [数据可信度] 试点期间工单的分布和复杂度是否与全渠道一致？62% 的解决率是否只适用于简单咨询，而全渠道包含更多复杂问题？
   针对:试点独立解决率 62%(实测,4100 张工单,95% 区间
2. [成本] 这个净节省是否考虑了工程师维护时间、模型调用量增长、以及人工复核退款等隐性成本？如果自动解决率只有 50%，净节省是否还成立？
   针对:每月净省 9,927 元(假设,算式见附录)。
3. [风险] 答错损失仅按退款金额计算，是否忽略了品牌声誉损失、客户流失和客服额外处理时间？这些隐性损失如何量化？
   针对:每月答错损失约 6,000 元(假设),退款一律人工确认。
4. [责任] 差评率是滞后指标，在触发止损前可能已造成大量客户不满。谁对扩大后 AI 错误回答导致的客户纠纷和合规问题负责？是否有明确的责任归属和赔偿机制？
   针对:止损:任一周差评率比人工基线高 2 个百分点,自动退回试点范
5. [组织] 2 名工程师 1 个月就能完成全渠道部署和持续维护？他们是否具备必要的 AI 运维技能？现有团队是否已超负荷，抽调后是否影响其他关键项目？
   针对:批准 2 名工程师 × 1 个月,外加每月约 73 元模型费
1 次调用 | 输入 325 / 输出 418 tokens | 约 ¥0.0040
```

一次调用 ¥0.0040,算式 `325 × 2 + 418 × 8 = 3994`,除以一百万。

五个问题里,我会把它们分成两堆。第 1 题和第 4 题是真问题,要补数据或者改方案:试点用的是哪些渠道、哪类工单,和全渠道的分布差多少,这个必须在提案里写一句;差评率确实是滞后指标,止损应该再加一个能当天看到的指标,比如转人工率或者人工抽检的严重错误率。第 2 题和第 3 题提案里其实已经回答了(维护成本 7,500 已经算进去,测算已经按 50% 而不是 62%;答错损失 200 元一次本来就包括了补偿、流失折算和善后时间),说明一页纸写得不够显眼,附录里的算式要链出来。第 5 题是组织问题,不是技术问题,得在会前和你的老板单独对一下人手。

模型的问题不全对,第 2 题问的「如果自动解决率只有 50%」恰恰就是我已经用的数字。但五个里有两个真问题,花四厘钱很值。

## 第二步:推动平台落地,让别人自愿迁移

[Day 583](/blog/agent-zero/day-583-platform-1/) 讨论过什么时候该做平台,之后十几天你把 AgentOps 做了出来。设计得再好,业务团队不迁移,它就只是一个没人用的内部项目。这是平台工程最常见的失败方式。我见过的成功推广,大概都遵循这几条:

**先找两个早期用户深度共建。** 挑最痛、最愿意尝试的两个团队,你的人直接帮他们迁移,甚至帮他们写代码。他们成功了,就是最好的宣传;他们踩的坑,就是平台的第一批改进。Day 642 真题一的演进部分说「每个季度找两个业务团队深度共建」,就是这个意思。

**做成「铺好的路」,不是「唯一的路」。** 这个思路在业界有两个常见叫法,Netflix 讲 paved road(铺好的路),Spotify 讲 golden path(黄金路径):平台提供的方式最省事,默认就带监控、评测、权限,但不禁止团队自己做。大多数团队会自己选省事的路。强制迁移只在安全和合规这类底线问题上用,比如「所有调用必须经过网关」可以强制,因为它关系到 Day 642 说的成本归因和数据出境。

**迁移成本低到一个下午。** 写好迁移指南、提供脚本、准备一个完整的示例项目。每多一步手动操作,迁移意愿就掉一截。前端的类比是 codemod:你推一个 API 变更时附一个自动改代码的脚本,和只发一篇「请大家手动改」的文档,迁移速度能差一个数量级。

**设一个固定的答疑时间。** 每周一小时的 office hours(固定答疑时间),任何团队都可以来问。很多迁移卡住不是技术问题,是没人回答一个小问题。

**处理反对意见时先听。** 一个团队不愿意迁移,背后往往有合理的理由:平台缺他们需要的功能、迁移时间撞上他们的大版本、或者之前被别的内部平台坑过。先搞清楚理由,能解决的解决,不能解决的写进路线图并告诉他们什么时候能有。

**量化采用情况,公开出来。** 这一条可以用脚本做,而且有个容易犯的错。`part10/adoption.py`:

```python
# agent-zero-lab/part10/adoption.py
MONTHS = ["7月", "8月", "9月", "10月"]
# 每个团队每月经过平台网关的调用占它全部模型调用的比例(假设的数据)
TEAMS = {
    "账单":   [0.00, 0.60, 0.95, 0.98],
    "工单":   [0.00, 0.30, 0.80, 0.97],
    "搜索":   [0.00, 0.00, 0.10, 0.12],
    "营销":   [0.00, 0.00, 0.00, 0.00],
    "数据":   [0.00, 0.00, 0.40, 0.85],
}
CALLS = {"账单": 120, "工单": 300, "搜索": 900, "营销": 80, "数据": 200}  # 每月万次调用(假设)

for i, month in enumerate(MONTHS):
    on = sum(1 for s in TEAMS.values() if s[i] >= 0.8)
    share = sum(TEAMS[t][i] * CALLS[t] for t in TEAMS) / sum(CALLS.values())
    print(f"{month}:接入团队 {on}/{len(TEAMS)},经过网关的调用 {share:.0%}")

stuck = [t for t, s in TEAMS.items() if 0 < s[-1] < 0.8 and s[-1] - s[-2] < 0.05]
never = [t for t, s in TEAMS.items() if s[-1] == 0]
print("开始迁了但卡住:", stuck, "| 还没开始:", never)
```

<div class="line-notes">

- `TEAMS = {` 五个团队,每个团队四个月的「经过网关的调用占比」。这个数平台自己就能算:网关记了每个团队走网关的调用量,供应商账单上有每个团队的总调用量(各团队一般用自己的 key,账单能分开)。
- `"搜索":   [0.00, 0.00, 0.10, 0.12],` 搜索团队 9 月开始迁,10 月只涨了 2 个点。
- `CALLS = {"账单": 120,` 每个团队每月的调用量,单位万次。搜索团队 900 万次,一个团队占了总量 1600 万的一半多。
- `on = sum(1 for s in TEAMS.values() if s[i] >= 0.8)` 第 i 个月占比到 80% 的算「已接入」,数一数有几个。
- `share = sum(TEAMS[t][i] * CALLS[t] for t in TEAMS) / sum(CALLS.values())` 按调用量加权的总占比。10 月:`(0.98×120 + 0.97×300 + 0.12×900 + 0×80 + 0.85×200) / 1600 ≈ 43%`。
- `stuck = [t for t, s in TEAMS.items() if 0 < s[-1] < 0.8 and s[-1] - s[-2] < 0.05]` 卡住的定义:已经开始迁(大于 0)、还没迁完(小于 80%)、最近一个月涨了不到 5 个点。`s[-1]` 是最后一个月,`s[-2]` 是倒数第二个月。
- `never = [t for t, s in TEAMS.items() if s[-1] == 0]` 一点都还没迁的。

</div>

```bash
uv run python -m part10.adoption
```

```text
7月:接入团队 0/5,经过网关的调用 0%
8月:接入团队 0/5,经过网关的调用 10%
9月:接入团队 2/5,经过网关的调用 33%
10月:接入团队 3/5,经过网关的调用 43%
开始迁了但卡住: ['搜索'] | 还没开始: ['营销']
```

10 月份「5 个团队接入 3 个」,听起来过半了;按调用量算只有 43%。差别全在搜索团队:它一个团队占了一半多的调用,而它卡在 12%。如果你在周报里只写「已接入 3/5」,管理层会觉得推得不错,可平台要解决的成本归因和数据出境问题,一半多的调用还没管到。**采用率要按调用量算,而且最该先去聊的是量最大、又卡住的那个团队。**

搜索团队为什么卡住,脚本回答不了,要去问。可能是网关多出来的那几毫秒延迟他们不能接受(搜索对延迟敏感),可能是他们用了平台还不支持的 embedding 接口。问清楚以后,这就是下个月平台路线图的第一条。营销团队一点没动,但只有 80 万次调用,优先级反而靠后。

把这几个数放进每月的周报,让管理层看到平台的价值,也让还没迁移的团队感受到一点压力。注意分寸:数字公开是为了让大家看到进展,不要做成「点名批评」的红榜,那会把共建关系变成对立关系。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Z9ftpRhRiJE" title="The engineering mindset | Will Larson (Carta, Stripe, Uber, Calm, Digg)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Lenny's Podcast · The engineering mindset | Will Larson · 英文播客,Will Larson 讲工程策略、怎么和管理层沟通、Staff 工程师怎么产生影响。可以开 YouTube 自动翻译字幕,重点听讲 engineering strategy 和 executives 的部分。</figcaption>
</figure>

## 第三步:带新人做 Agent 项目

资深工程师的另一半影响力来自带人。带人做 Agent 项目有几个和普通后端不一样的地方。

**任务按「能独立评测」来拆。** 普通后端按模块拆就行。Agent 的模块之间耦合很深:改了检索会影响回答,改了提示词会影响工具调用。所以每个子任务都要有自己的评测指标。「把退款类问题的检索 recall@5 从 0.85 提到 0.92」是一个好任务,「优化一下检索」不是。recall@5 你在第四部分学过,意思是正确的文档有没有出现在检索结果前 5 条里。

这一条可以写成一个检查器,排计划时先过一遍。`part10/mentee_plan.py`,给一个有两年后端经验、没做过 Agent 的新人排前四周:

```python
# agent-zero-lab/part10/mentee_plan.py
import re

PLAN = {
    "第 1 周": "读 100 条失败 trace,按 Day 345 的方法分类,交一张失败类型表",
    "第 2 周": "优化一下检索",
    "第 3 周": "把退款类问题的检索 recall@5 从 0.85 提到 0.92,不让其他类掉超过 1 个点",
    "第 4 周": "给工具描述补充例子,让工具选错率从 8% 降到 5% 以下,周会上讲 10 分钟",
}
MEASURABLE = re.compile(r"(从\s*[\d.]+%?\s*(提|降)到\s*[\d.]+%?)|(\d+\s*条)")

for week, task in PLAN.items():
    ok = MEASURABLE.search(task)
    print(f"{week} {'有指标' if ok else '没有可验收的指标'}:{task}")
```

<div class="line-notes">

- `"第 1 周": "读 100 条失败 trace,` 第一周先做错误分析。[Day 345](/blog/agent-zero/day-345-error-analysis-1/) 讲的读 trace、给失败分类,是新人理解一个 Agent 系统最快的方式。读 100 条 trace,比读一周代码理解得更深。
- `"第 2 周": "优化一下检索",` 故意写一条差的,看检查器能不能抓到。
- `"第 3 周": "把退款类问题的检索 recall@5 从 0.85 提到 0.92,不让其他类掉超过 1 个点",` 好任务有起点、终点,还有一条护栏(别的类别不能变差),和 Day 644 说的护栏指标是一个意思。
- `"第 4 周": "给工具描述补充例子,` 第四周要有一个能拿出手的成果,并且在周会上讲。新人成长了,你的影响力也跟着放大。
- `MEASURABLE = re.compile(r"(从\s*[\d.]+%?\s*(提|降)到\s*[\d.]+%?)|(\d+\s*条)")` 两种算「能验收」:「从 X 提到/降到 Y」,或者「N 条」这种有明确数量的交付物。`[\d.]+` 是一串数字或小数点,`%?` 是可有可无的百分号,`|` 是「或」。这个正则很粗,真用的时候规则可以按团队习惯改。
- `ok = MEASURABLE.search(task)` 找到返回匹配对象,找不到返回 `None`,在 `if` 里分别当真和假。
- `print(f"{week} {'有指标' if ok else '没有可验收的指标'}:{task}")` f-string 里嵌条件表达式,外层双引号,里面的字符串用单引号。

</div>

```bash
uv run python -m part10.mentee_plan
```

```text
第 1 周 有指标:读 100 条失败 trace,按 Day 345 的方法分类,交一张失败类型表
第 2 周 没有可验收的指标:优化一下检索
第 3 周 有指标:把退款类问题的检索 recall@5 从 0.85 提到 0.92,不让其他类掉超过 1 个点
第 4 周 有指标:给工具描述补充例子,让工具选错率从 8% 降到 5% 以下,周会上讲 10 分钟
```

第 2 周被抓到了。改法很简单,但要先做功课:你得先跑一遍评测,知道检索现在在哪一类问题上最差、差多少,才能给出一个有起点有终点的任务。**给新人一个模糊的任务,其实是把「定义问题」这个最难的部分甩给了他。**

其他几条:

**用评测做 code review 的一部分。** 新人的 MR,除了看代码,还要看评测报告:总分变了多少、哪些用例变好了、哪些变差了。这能把 review 从「我觉得这样写不好」变成「这个改动让退款类问题的准确率掉了 4 个点,我们一起看看这几条 trace」。对新人来说,后者更具体,也更不伤人。

**约定团队使用编程 Agent 的规则。** 新人会大量用 Claude Code、Cursor、Codex 这类工具写代码。资深工程师要定规则:仓库里放好 `CLAUDE.md` 或 `AGENTS.md`(给编程 Agent 读的项目说明,写代码规范和禁止事项);AI 生成的代码同样要过评测和 review;提交说明里写清哪些部分是 AI 生成的、你是怎么验证的。规则的目的不是限制使用,是让产出可审查。

**反馈具体、及时、私下。** 「这个 MR 质量不太好」没用。「这三个工具的描述写得太短,模型分不清什么时候用哪个」有用。批评私下说,表扬公开说。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV13Q9RByEis&autoplay=0&high_quality=1" title="为什么优秀的开发人员升职负责人后,反而越做越累?如何从高级开发走向技术Leader" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>大秦的勤 · 为什么优秀的开发人员升职负责人后,反而越做越累?如何从高级开发走向技术Leader · 94 分钟,很长,挑讲「自己干还是让别人干」和带人那几段听,和上面的四周计划对照。</figcaption>
</figure>

## 第四步:回应「AI 不靠谱」

推动 Agent 项目一定会碰到这类质疑:「大模型会胡说八道」「出了事谁负责」「上次那个 AI 项目就失败了」。这些质疑有合理的部分,不能当成对方不懂技术而绕过去。我的回应分三步。

**第一步,承认问题,把它变成能度量的问题。** 「AI 会出错」是对的,人也会出错。问题不是会不会错,而是错误率多少、错了影响多大、能不能发现和纠正。把一个模糊的担心变成三个能回答的问题。

**第二步,和人工基线比。** **人工基线**是同一件事由人来做时的错误率、耗时、成本。很多团队从来没量过人工的错误率,量出来常常让人意外。比的时候要诚实,样本量不大时两个错误率的区间经常是重叠的。`part10/baseline.py`,复用上面的 `wilson`:

```python
# agent-zero-lab/part10/baseline.py
from part10.wilson import wilson

SAMPLES = {                     # 抽检结果(假设的数据):严重错误数 / 抽检数
    "Agent 独立回复": (4, 1000),
    "人工坐席回复": (6, 500),
}

for name, (bad, n) in SAMPLES.items():
    lo, hi = wilson(bad, n)
    print(f"{name}:{bad}/{n} = {bad / n:.1%},95% 区间 {lo:.2%} ~ {hi:.2%}")

(a_bad, a_n), (h_bad, h_n) = SAMPLES.values()
a_hi = wilson(a_bad, a_n)[1]
h_lo = wilson(h_bad, h_n)[0]
if a_hi < h_lo:
    print("结论:Agent 严重错误率明显低于人工")
else:
    print(f"结论:两个区间重叠(Agent 上限 {a_hi:.2%} ≥ 人工下限 {h_lo:.2%}),只能说没看出 Agent 更差")
```

<div class="line-notes">

- `SAMPLES = {` 两组抽检数据,都是我编的示例:Agent 抽检 1000 条有 4 条严重错误,人工抽检 500 条有 6 条。「严重错误」要事先定义清楚,比如「给出了错误的金额或政策」,两边用同一个定义、同一批抽检员。
- `for name, (bad, n) in SAMPLES.items():` 解构可以嵌套:`items()` 给出 `(名字, (错误数, 总数))`,一次拆成三个变量,≈ JS 的 `for (const [name, [bad, n]] of Object.entries(SAMPLES))`。
- `lo, hi = wilson(bad, n)` Agent 那组代入 `wilson(4, 1000)`,区间 0.16% 到 1.02%。错误率接近 0 时,普通的 `p ± 1.96 × 标准误` 算出来下界会是负数,Wilson 不会,这就是 Day 547 推荐它的原因。
- `(a_bad, a_n), (h_bad, h_n) = SAMPLES.values()` 字典保持插入顺序,所以第一个是 Agent、第二个是人工。
- `a_hi = wilson(a_bad, a_n)[1]` 取 Agent 区间的上界。`[1]` 是元组的第二个元素。
- `if a_hi < h_lo:` 只有 Agent 的上界比人工的下界还低,才能说 Agent 明显更好。这是一个保守的判断方法:区间不重叠一定有差别,区间重叠不一定没差别,但重叠时你就不该说「明显更好」。

</div>

```bash
uv run python -m part10.baseline
```

```text
Agent 独立回复:4/1000 = 0.4%,95% 区间 0.16% ~ 1.02%
人工坐席回复:6/500 = 1.2%,95% 区间 0.55% ~ 2.59%
结论:两个区间重叠(Agent 上限 1.02% ≥ 人工下限 0.55%),只能说没看出 Agent 更差
```

点估计看,Agent 0.4%、人工 1.2%,Agent 好像好三倍。可两个区间是重叠的,诚实的说法只能是:「在这次抽检的样本量下,没看出 Agent 比人工更容易犯严重错误。」这句话听起来没那么漂亮,但它经得起追问。如果你拿着「好三倍」去说服一个多疑的 CTO,他只要问一句「抽了多少条」,你的信用就没了。想把结论说得更硬,办法是扩大抽检量,练习 2 算一下要抽多少。

**第三步,讲清爆炸半径和兜底。** **爆炸半径**(blast radius)是一个错误最多能影响到的范围。哪些操作 Agent 可以独立做(查询、解答),哪些必须人工确认(退款、改订单),出错了怎么发现(抽检、用户反馈、监控),发现了怎么回滚(开关、降级)。对方明白最坏情况是有上限的,担心通常就降下来了。Day 642 的三层权限加金额阈值,本质上就是在限制爆炸半径。

至于「出了事谁负责」,答案要在设计阶段就定好:Agent 的行为由负责它的团队负责,写进上线审批流程。不要回避这个问题,回避会被理解成没想过。上面 CTO 模型挑的第 4 题就是这个,它是个真问题。

## 今天的文件

| 文件 | 干什么 | 花钱吗 |
| --- | --- | --- |
| `part10/wilson.py` | Wilson 区间,今天复用两次 | 不花 |
| `part10/onepager.py` | 从回本测算和试点数据生成一页纸并检查 | 不花 |
| `part10/skeptic.py` | 模型扮演多疑的 CTO 提 5 个问题 | 一次 ¥0.0040 |
| `part10/adoption.py` | 按调用量算平台采用率,找出卡住的团队 | 不花 |
| `part10/mentee_plan.py` | 检查新人每周任务能不能验收 | 不花 |
| `part10/baseline.py` | Agent 和人工严重错误率的区间比较 | 不花 |
| `part10/ex645_*.py`(练习) | 练习的参考答案 | 不花 |

## 动手练习

**练习 1:让检查器抓一份「论文式」的一页纸。** 把 `onepager.py` 的 `build()` 改一版,第一段写成「背景:CloudLedger 客服每天处理大量账单类工单……」,把「需要的决定」挪到最后;再把回本那一行的「(假设)」删掉。跑 `check()`,看它报什么。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex645_bad_onepager.py
from part10.onepager import build, check
from part10.roi import Assumptions

good = build(Assumptions(auto_rate=0.5)).splitlines()
title, decision = good[0], good[2]
body = [x for x in good[3:] if x]
body = [x.replace("个月(假设)", "个月") for x in body]
bad = "\n".join([title, "", "**背景**:CloudLedger 客服每天处理大量账单类工单,人工压力大。", *body, decision])
for p in check(bad):
    print("-", p)
```

<div class="line-notes">

- `good = build(Assumptions(auto_rate=0.5)).splitlines()` 拿到正确版本的每一行,`good[0]` 是标题,`good[2]` 是「需要的决定」那行(`good[1]` 是空行)。
- `body = [x.replace("个月(假设)", "个月") for x in body]` 只有回本那一行带「个月(假设)」,删掉标签。
- `bad = "\n".join([title, "",` `*body` 把列表展开塞进另一个列表,≈ JS 的 `[title, "", bg, ...body, decision]`。决定被挪到了最后。

</div>

```bash
uv run python -m part10.ex645_bad_onepager
```

```text
- 第一段不是要的决定
- 数字没标来源:- 回本 6.0 个月。
```

两条都抓到了。注意「背景」那一行没有数字,所以不会报数字问题;如果你写了「每天处理 100 多张工单」,也会被报。检查器只能抓格式问题,「背景写得太长」「收益没换算成老板的单位」这种,还得靠你自己读。

</details>

**练习 2:要抽检多少条,才能说 Agent 明显比人工好?** 假设真实的严重错误率就是 Agent 0.4%、人工 1.2%,两边抽检数量一样。用 `wilson` 从 500 条开始、每次加 500 条,找出第一个让「Agent 区间上界 < 人工区间下界」的抽检量。错误数按真实错误率乘抽检量四舍五入。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex645_sample.py
from part10.wilson import wilson

AGENT_RATE, HUMAN_RATE = 0.004, 0.012

for n in range(500, 20001, 500):
    a_hi = wilson(round(n * AGENT_RATE), n)[1]
    h_lo = wilson(round(n * HUMAN_RATE), n)[0]
    if a_hi < h_lo:
        print(f"每边抽 {n} 条:Agent 上界 {a_hi:.2%} < 人工下界 {h_lo:.2%}")
        break
else:
    print("抽到 2 万条还分不开")
```

<div class="line-notes">

- `for n in range(500, 20001, 500):` `range(起点, 终点, 步长)`,终点不包含,所以写 20001 才能取到 20000。≈ JS 的 `for (let n = 500; n <= 20000; n += 500)`。
- `a_hi = wilson(round(n * AGENT_RATE), n)[1]` 假设抽出来的错误数正好等于期望值,`round` 四舍五入。真实抽检会有随机波动,这是一个理想化的估计。
- `break` 找到第一个满足的就停。
- `else:` 这是 Python 特有的 `for ... else`:循环正常跑完、没有被 `break` 打断时才执行 `else`。JS 没有这个语法,一般用一个 `found` 变量代替。

</div>

```bash
uv run python -m part10.ex645_sample
```

```text
每边抽 2000 条:Agent 上界 0.79% < 人工下界 0.81%
```

每边抽 2000 条,两个区间刚刚分开,而且只差 0.02 个百分点。这个结论很实用:如果你想在评审会上说「Agent 的严重错误率明显低于人工」,抽检预算要按每边两千条以上准备,而且 Agent 和人工都要抽。抽检是人工做的,四千条大概是几个人几天的工作量,这本身也是一页纸里「花多少」要写的一项。

</details>

**练习 3:给卡住的团队写一封邮件。** 根据 `adoption.py` 的输出,给搜索团队的负责人写一封不超过 150 字的邮件,目的是约一次 30 分钟的会,搞清楚他们为什么卡在 12%。

<details><summary>参考答案</summary>

这道是写作题,给一个示范:

> 张三你好,我是平台组的李四。搜索这边 9 月开始接网关,现在走网关的调用大约 12%。你们的量占全公司一半多,所以我很想知道剩下的部分卡在哪:是延迟、缺接口,还是排期撞上了。想约你下周找 30 分钟聊一下,我们这边可以直接派人帮你们迁一部分。你看周二或周四下午哪个时间合适?

写法上的几个要点:第一句说你是谁;第二句给事实,不评价(「12%」,而不是「你们迁得很慢」);第三句说为什么找他,把他放在「重要」的位置上;然后主动猜几个原因,降低他解释的成本;最后给出你能提供的帮助和两个具体时间。用 [Day 640](/blog/agent-zero/day-640-design-docs-1/) 评审意见的分类说,你现在还不知道这是「事实错误」(比如平台真的缺接口)还是「方案分歧」(他们觉得不该走网关),所以先问,不要先下结论。

</details>

**练习 4:写你自己的一页纸。** 选 SupportPilot 扩量或者 AgentOps 平台立项中的一个,改 `onepager.py` 里的数字和文字,生成你自己的版本,`check()` 要通过;再用 `skeptic.py` 挑一遍刺,把五个问题分成「提案里已经回答了但不够显眼」「真问题要补」「要会前单独对齐」三类,真问题至少补一个。

<details><summary>参考答案</summary>

示范一个 AgentOps 平台立项的改法:标题改成「提议:Q1 上线 AgentOps 模型网关和工具中心」;「需要的决定」改成「批准 4 名工程师 × 3 个月」;「值多少」那段换成 Day 642 真题一的数(每月约 82 万模型费、成本归因从零到百分之百、两次注入事故的损失);「最坏会怎样」写网关单点故障和紧急旁路。数字的来源标签照写,`check()` 会帮你确认。

跑 `skeptic.py` 时,我预计最可能被问到的真问题是「15 个团队凭什么愿意迁」,补法就是今天第二步:在一页纸里加一句「第一季度只要求两个早期用户迁移,其余团队自愿,采用率按调用量每月公开」。这道题没有唯一答案,验收看两点:`check()` 通过;五个问题都分了类,并且至少一个真问题落到了提案的修改里。

</details>

**验收标准**:六个脚本都跑出和文中一致的结果(模型输出允许不同);你自己的一页纸 `check()` 通过,读一遍不超过 3 分钟;一张干系人地图,右上角每个人写了「他最关心什么、我准备怎么回应」;一份新人四周计划,每周任务都能过 `mentee_plan.py`;能不看稿说出回应「AI 不靠谱」的三步,并解释为什么 0.4% 对 1.2% 不能说「好三倍」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| Staff 四种角色 | Will Larson 归纳的 Tech Lead、Architect、Solver、Right Hand 四种 Staff 工程师的工作方式 |
| 干系人地图 | 按决策影响力和关注度把相关的人分进四格,决定沟通精力怎么分配 |
| 一页纸 | 给决策者的简短提案,第一句写要的决定,下面回答值多少、花多少、最坏会怎样 |
| 金字塔原理 | 芭芭拉·明托提出的写作方法:结论在上,论据分组在下 |
| 止损点 | 写进提案的、能自动判断的回退条件,比如差评率比人工基线高 2 个百分点 |
| paved road / golden path | 平台提供默认最省事的路径但不强制,用便利性引导采用 |
| 早期用户 | 平台推广时最先深度共建的两三个团队 |
| office hours | 每周固定时间的公开答疑 |
| 按调用量的采用率 | 经过平台的调用占全部调用的比例,比「接入了几个团队」更真实 |
| 人工基线 | 同一件事由人来做时的错误率、耗时、成本,用来和 Agent 对比 |
| 爆炸半径 | 一个错误最多能影响到的范围,用权限、金额阈值、人工确认来限制 |
| AGENTS.md / CLAUDE.md | 放在仓库里给编程 Agent 读的项目说明,写代码规范和禁止事项 |

## 常见误区

**把技术先进性当说服理由。** 「这个方案用了最新的多 Agent 架构」对老板没有意义,他关心的是钱、时间和风险。技术细节放附录。

**一页纸先写背景。** 背景铺三段才说到要什么,读者看完还不知道你要他干什么,决定就会被推迟。练习 1 的检查器第一条就查这个。

**ROI 只算 token。** CloudLedger 的模型费每月 73 元,维护人力 7,500 元。只算 token 的 ROI 一定虚高,被拆穿一次,你后面所有的数字都会被打折听。

**只报点估计。** 0.4% 对 1.2% 看起来好三倍,两个区间却是重叠的。没有样本量和区间的数字,遇到一个会问「抽了多少条」的人就站不住。

**按团队数报采用率。** 「接入 3/5」和「43% 的调用经过平台」说的是同一个月。量最大的团队没迁,前一个数字是在自我安慰。

**用行政命令推平台。** 让老板下一道「所有团队下季度必须迁移」,看起来最快,实际会制造大量应付式迁移和怨气。命令只留给安全合规这类底线问题。

**给新人模糊的任务。** 「优化一下检索」等于把最难的定义问题甩给了新人。先跑评测,给出起点、终点和护栏。

**把质疑当成对方不懂。** 「AI 不靠谱」背后常常有真实的经历和合理的担心。今天 CTO 模型挑的五个问题里有两个是真问题,先听完,再用数据回应。

## 学习资料

### 文档与文章

- [Staff archetypes](https://staffeng.com/guides/staff-archetypes/):Will Larson 讲四种 Staff 角色,英文,15 分钟。
- [Present to executives](https://staffeng.com/guides/present-to-executives/):怎么给管理层汇报,讲得非常具体,今天的一页纸结构和它的建议一致。
- [Staying aligned with authority](https://staffeng.com/guides/staying-aligned-with-authority/):怎么和管理层保持方向一致,避免做了半天发现老板不要。
- [Engineering strategy](https://staffeng.com/guides/engineering-strategy/):推动的不是一个项目而是一个方向时,怎么写工程策略。
- [Spotify Engineering:How We Use Golden Paths](https://engineering.atspotify.com/2020/08/how-we-use-golden-paths-to-solve-fragmentation-in-our-software-ecosystem):golden path 这个说法的出处之一,讲 Spotify 怎么用「推荐的路」解决内部技术栈碎片化。
- [Hamel Husain:Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/):回应「AI 不靠谱」最有用的思路来源:用评测把模糊的担心变成具体的数字。
- [Anthropic:Claude Code best practices](https://www.anthropic.com/engineering/claude-code-best-practices):给团队定编程 Agent 使用规则时的参考,特别是 CLAUDE.md 怎么写。
- [agents.md](https://agents.md/):AGENTS.md 这个约定的说明页,多家编程 Agent 都认这个文件名。

### B 站视频

- KKLAout《十分钟掌握方案汇报技巧》和大秦的勤《如何从高级开发走向技术Leader》已经嵌在正文里。
- 程序员土汪,《#8 Heng: 在科技大厂从Staff Engineer转职Engineering Manager》(BV1k5JrzXE6T),65 分钟播客。一位大厂 Staff 工程师讲 Staff 的日常和影响力从哪来,通勤时听。
- yaopengue,《金字塔原理-工作汇报篇》(BV1Kb411P71z),48 分钟。想系统学结论先行的写法可以看。

### 其他经典视频

- Lenny's Podcast 的 Will Larson 访谈已经嵌在正文里。
- Book Overflow,《Discussing Staff Engineer by Will Larson》(YouTube ID -m8CDR_lHXo)。两个工程师逐章讨论《Staff Engineer》这本书,没时间读书可以先听这个。

### 书籍

- Will Larson,《Staff Engineer: Leadership beyond the management track》,2021,自出版。我没查到简体中文版。四种角色和 Staff 日常工作的章节大部分在 staffeng.com 上免费公开。
- Camille Fournier,《The Manager's Path》,O'Reilly,2017。中文版《技术为径:带领公司走向卓越的工程师》,电子工业出版社,2023。读讲 Tech Lead 和带人的前几章,即使不打算转管理,带新人那部分也很有用。
- 芭芭拉·明托,《金字塔原理》,南海出版公司有多个版本。读讲结论先行和论据分组的前几章,够写一页纸用了。
- Tanya Reilly,《The Staff Engineer's Path》,O'Reilly,2022。Day 640 和 Day 642 都引用过,讲大项目推动和「没有权力的影响力」的部分和今天最相关。

### 开源项目与代码

- [joelparkerhenderson/architecture-decision-record](https://github.com/joelparkerhenderson/architecture-decision-record):推广平台时,把关键决定写成 ADR 公开出来,能少很多重复解释。你在 Day 640 已经写过自己的 ADR 工具。
- [openai/agents.md](https://github.com/openai/agents.md):AGENTS.md 约定的仓库,里面有示例文件,给团队写编程 Agent 规则时可以照着改。

## 自测

1. 一页纸的第一句话应该写什么?为什么不先写背景?

<details><summary>答案</summary>

写需要对方做的决定和需要的资源,比如「批准 2 名工程师 × 1 个月」。管理层时间很少,可能只读第一段。先写背景,读者看完三段还不知道你要什么,决定就会被推迟。背景和细节放后面或附录。

</details>

2. 你算出 Agent 每张工单的成本是人工的十分之一,老板不信。可能是哪里出了问题?

<details><summary>答案</summary>

很可能只算了 token 成本。完整的 Agent 成本包括模型费、人工复核或抽检的人力、答错的补救成本、平台维护的工程人力。CloudLedger 的账里模型费 73 元,维护 7,500 元、答错 4,800 到 6,000 元。另外收益只应该按 Agent 能独立解决的那部分算。补齐以后再给出样本量和区间,可信度会高很多。

</details>

3. 平台周报写「5 个团队已接入 3 个」,你觉得哪里有问题?应该怎么报?

<details><summary>答案</summary>

团队数不反映调用量。`adoption.py` 的例子里,同一个月按团队数是 3/5,按调用量只有 43%,因为调用量最大的搜索团队卡在 12%。应该按「经过平台的调用占全部调用的比例」报,并单独列出量大又卡住的团队,作为下个月要重点沟通的对象。

</details>

4. Agent 抽检 1000 条有 4 条严重错误,人工抽检 500 条有 6 条。你能对 CTO 说「Agent 比人工好三倍」吗?应该怎么说?

<details><summary>答案</summary>

不能。点估计 0.4% 对 1.2%,但 Wilson 区间分别是 0.16% 到 1.02% 和 0.55% 到 2.59%,是重叠的。诚实的说法是「在这次的样本量下,没看出 Agent 比人工更容易犯严重错误」。想把结论说硬,要扩大抽检量,练习 2 算出每边大约要两千条。

</details>

5. 资深面试题:你推动过一个别人一开始不认同的技术决策吗?你是怎么做的?最后结果如何?

<details><summary>答案</summary>

答题要点:讲一个真实案例,用 STAR 结构(情境、任务、行动、结果)。突出几点:你先搞清楚了反对者的顾虑,而不是急着说服;你把讨论从观点之争变成数据之争(做了试点、评测、和人工基线比较);你给了能自动触发的止损机制,降低了对方接受的风险;决策后你用结果验证,如果结果不如预期,你主动调整了。面试官想看的是你在没有权力时推动事情的方法,以及你能不能承认自己错了。没有现成案例的话,AgentOps 里「网关紧急旁路从直连供应商改成第二个网关实例」这种被评审推翻又改好的决定,就是可以讲的素材。

</details>

6. 新人的 MR 代码写得很干净,但你担心效果有问题。你怎么 review?

<details><summary>答案</summary>

要求 MR 附上评测报告:总分变化、按类别的变化、变好和变差的具体用例。重点看变差的用例,和新人一起读这些 trace 找原因。这样反馈是具体的(「退款类准确率掉了 4 个点,这几条 trace 里模型选错了工具」),而不是主观的。如果两个版本跑的是同一批用例,用 Day 644 的配对比较判断变化是不是真的。顺便检查评测集有没有覆盖这次改动影响的场景。

</details>

## 明天预告

明天是 Day 646 · 开源影响力(一):JD 怎么说,第一个 PR,贡献阶梯,AI 生成的 PR。今天讲的是公司内部的影响力,明天往外走:海外和国内的 Agent 岗位 JD 怎么写开源经历,怎么给 Agent 框架或 MCP 生态提第一个能被合并的 PR,从修文档到当维护者的贡献阶梯怎么爬,以及现在维护者们怎么看 AI 生成的 PR。
