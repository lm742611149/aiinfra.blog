---
title: 'Day 546 · 评测是产品(二):分工、钉进流程、预算和 registry'
description: '昨天讲了一条用例的一生,今天讲谁来管它。先把评测的活分给平台组、业务团队和领域专家,再把分工钉进需求评审、代码评审、CODEOWNERS 和事故复盘四个固定动作里;然后用实测的单次成本算一笔评测预算,分三层跑;最后写一个给用例上户口的 registry 工具,缺负责人和需求号的用例进不了仓库。'
pubDate: 2026-10-27
regime: none
tags: ['eval', 'process', 'ownership', 'budget', 'python', 'agent-zero']
series: 'agent-zero'
day: 546
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 545](/blog/agent-zero/day-545-week78-review/) 是复习日,把持久化方案、编排取舍、设计文档和评测生命周期串成了一个门禁小项目。[Day 544](/blog/agent-zero/day-544-eval-org/) 讲的是被管理的那个东西:一条用例从提议、入库、进能力集、毕业进回归集到退役,每一步要满足什么条件,写成了 `case_lifecycle.py` 里的一张状态表。

那天最后留了一个问题:状态机只能拦住「不合规的操作」,但谁来提议用例、谁来评审、谁来点退役、分数掉了谁去看,代码不会回答。今天讲这些。一个团队的评测会不会烂,看的就是这一圈。

## 今天要解决的问题

学完今天你应该能做到:

1. 说清评测里「怎么评」「评什么」「什么是对」三件事分别归谁,并画出一张责任表。这是今天的第一个新概念:**评测所有权**。分工写在 wiki 上不算数,要钉进四个每天都会发生的动作里,今天逐个讲。
2. 用实测的单次成本给评测算预算,把评测分成 MR、夜间、发版三层跑。这是第二个新概念:**评测预算**。
3. 跑通 `part10/registry.py`:`lint` 抓出缺负责人、缺需求号、集合名写错、id 重复的用例并让 CI 变红,`health` 报告回归集有没有挂的、哪些能力用例可以毕业了(用 Day 544 的 `ready_to_graduate`)。
4. 亲手踩一次「检查数据质量的工具自己被脏数据弄崩」。

预计用时 3 小时。花费约 2 分钱:只有量评审成本那一步调模型(40 次调用,约 ¥0.023),其余脚本都不调模型。前置:[Day 544](/blog/agent-zero/day-544-eval-org/)(`case_lifecycle.py`)、[Day 541](/blog/agent-zero/day-541-orch-2/)(`arch_bench.py` 和它的结果)、[Day 543](/blog/agent-zero/day-543-design-doc-2/)(设计文档里的目标和评测与上线一节)、[Day 348](/blog/agent-zero/day-348-testcase-structure/)(用例 JSONL)、[Day 375](/blog/agent-zero/day-375-eval-project-2/)(CI 门禁)、[Day 50](/blog/agent-zero/day-050-dataclass/)(dataclass)。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `lint` 函数和三层评测各自的目的;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 谁来管:三类人,三个问题

[Day 544](/blog/agent-zero/day-544-eval-org/) 引过 Anthropic 2026 年 1 月那篇《Demystifying evals for AI agents》。我这次回原文核对了它讲分工的句子:团队可以设立专门的评测团队负责核心基础设施,而**领域专家和产品团队贡献大部分评测任务,并且自己跑评测**;它还说,对做 AI 产品的团队,维护评测应该像维护单元测试一样日常,产品经理、客户成功甚至销售都可以用 Claude Code 把一条评测任务提成 PR。

这段话里有个很实用的切法:评测的活可以按三个问题拆开,每个问题的答案住在不同的人那里。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="三类人各管一块:评测平台组管怎么评,业务团队管评什么,领域专家管什么是对;三者共同产出评测集,业务团队处在中间,最容易两头都以为是别人的事">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12">
    <rect x="20" y="30" width="180" height="120" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="32" y="54" fill="var(--ink)">评测平台组</text>
    <text x="32" y="78" fill="var(--ink-soft)">问题:怎么评</text>
    <text x="32" y="100" fill="var(--ink-soft)">跑评测的设施</text>
    <text x="32" y="118" fill="var(--ink-soft)">judge 版本与校准</text>
    <text x="32" y="136" fill="var(--ink-soft)">统计、耗时、成本</text>
    <rect x="230" y="30" width="180" height="120" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="242" y="54" fill="var(--ink)">业务团队</text>
    <text x="242" y="78" fill="var(--ink-soft)">问题:评什么</text>
    <text x="242" y="100" fill="var(--ink-soft)">需求、事故变用例</text>
    <text x="242" y="118" fill="var(--ink-soft)">回归挂了谁修</text>
    <text x="242" y="136" fill="var(--ink-soft)">毕业与退役</text>
    <rect x="440" y="30" width="180" height="120" rx="6" fill="var(--paper)" stroke="var(--ink-soft)"/>
    <text x="452" y="54" fill="var(--ink)">领域专家</text>
    <text x="452" y="78" fill="var(--ink-soft)">问题:什么是对</text>
    <text x="452" y="100" fill="var(--ink-soft)">确认期望答案</text>
    <text x="452" y="118" fill="var(--ink-soft)">每周读 10–20 条 trace</text>
    <text x="452" y="136" fill="var(--ink-soft)">不一定会写代码</text>
    <line x1="110" y1="150" x2="110" y2="190" stroke="var(--ink-soft)"/>
    <line x1="320" y1="150" x2="320" y2="190" stroke="var(--ink-soft)"/>
    <line x1="530" y1="150" x2="530" y2="190" stroke="var(--ink-soft)"/>
    <line x1="110" y1="190" x2="530" y2="190" stroke="var(--ink-soft)"/>
    <line x1="320" y1="190" x2="320" y2="206" stroke="var(--ink-soft)"/>
    <rect x="200" y="206" width="240" height="30" rx="6" fill="var(--paper)" stroke="var(--ink-soft)"/>
    <text x="320" y="226" text-anchor="middle" fill="var(--ink)">一套可信、有人维护的评测</text>
  </g>
</svg>
<figcaption>三个问题三类人。平台组和专家各自的边界比较清楚,最容易出事的是中间:业务团队觉得「评测是平台组的事」,平台组觉得「用例是业务的事」,最后没人写。</figcaption>
</figure>

**评测平台组**管「怎么评」。一般一两个人,也可以是某个工程师的一部分职责。他们负责跑评测的基础设施、judge 的版本和校准、统计方法和报告格式(下面几天的内容)、评测的耗时和花费、CI 门禁的规则。平台组不替业务写用例,也不替业务决定什么叫答对。

**业务团队**管「评什么」。谁改了 Agent 的某个行为,谁负责它的用例,和「谁改代码谁改测试」是同一个道理。需求变用例、事故变用例、回归挂了谁修、用例什么时候毕业和退役,都在这一块。

**领域专家**管「什么是对」。客服主管知道退款话术怎么说才合规,财务知道折算规则,法务知道哪些承诺不能做。他们不需要会写代码,但需要一个顺手的地方去确认期望答案、给样本打标签。Hamel Husain 的 Evals FAQ 里把这个人叫作「quality decision maker」,括号里写的是 benevolent dictator(仁慈的独裁者):标准由一个懂业务的人定,比一群工程师投票靠谱。FAQ 里还有一条我很喜欢的建议:大的分析之间,每周随手读 10 到 20 条 trace,盯着离群的那几条看。评测集没覆盖到的新问题,基本只有这个渠道能发现。

把这些落到一张表上,可以直接贴进团队 wiki,按实际情况改。

| 事项 | 负责 | 参与 | 知会 |
| --- | --- | --- | --- |
| 新需求对应的用例 | 需求所在的业务团队 | 产品经理、领域专家 | 平台组 |
| 事故复盘后补用例 | 事故责任团队 | 值班工程师 | 全组 |
| 确认期望答案 | 领域专家 | 业务团队 | |
| judge 改动与重新校准 | 平台组 | 领域专家(出标注) | 所有业务团队 |
| CI 门禁阈值 | 平台组 | 技术负责人 | 全组 |
| 回归集挂了 | 提交改动的人 | 用例负责人 | |
| 用例退役 | 用例负责人 | 需求方(确认) | 平台组 |
| 评测成本超预算 | 平台组 | 技术负责人 | |

「用例退役」那一行和 [Day 544](/blog/agent-zero/day-544-eval-org/) 练习 2 是一回事:负责人提,需求方确认,不能自己批自己。

## 钉进流程:四个每天都会发生的动作

分工写在 wiki 上没有用,三个月后没人记得。要让它活下来,得挂在每天都会发生、而且有人会卡你一下的动作上。我知道真正管用的有四个。

**钉子一:需求评审时问「用例在哪」。** 产品需求文档(PRD)的模板里加一节「验收评测」,列出这个需求对应的用例 id 或者用例草稿。评审会上这一节是空的,需求就不算评审通过。[Day 544](/blog/agent-zero/day-544-eval-org/) 说过,「Agent 要能妥善处理退款」这种需求,一写用例就得说清楚什么叫妥善。这个动作坚持两三个月,产品经理会自己先想好。

```markdown
## 验收评测

- 对应用例:EVAL-REFUND-014、EVAL-REFUND-015(草稿见附件)
- 期望答案由谁确认:财务(周)
- 属于能力集还是回归集:能力集,上线两个版本后评估毕业
```

**钉子二:代码评审时看用例。** 改了提示词、工具定义或者路由逻辑的 MR(合并请求),如果没有带用例的改动,评审人要问一句「这个改动的效果你是怎么验证的」。评审人要看的不是总分,而是「哪几条新挂了、哪几条新修好了」,[Day 545](/blog/agent-zero/day-545-week78-review/) 的 `ex545_diff.py` 就是这个报告的雏形。

**钉子三:CODEOWNERS 管到评测目录。** CODEOWNERS 是代码托管平台的一个文件:哪个目录归哪个人或团队,改这个目录的 MR 必须有他们批准。把评测目录也分下去:

```text
# CODEOWNERS(GitHub 和 GitLab 的基本写法一样,GitLab 另有 [分组] 语法,见各自文档)
/evals/suites/billing/   @acme/billing-team
/evals/suites/support/   @acme/support-team
/evals/                  @acme/eval-platform
```

这样可以防止一件在评测压力大的团队里真会发生的事:有人为了让 CI 变绿,去改另一个团队的期望答案。做的人往往不是故意的,只是觉得「这条期望好像写错了」。有了 CODEOWNERS,他要先说服那个团队。练习 2 会写一个小函数,判断一个 MR 现在能不能合。

**钉子四:事故复盘模板加一栏。** 复盘里固定有一栏:「本次问题对应的评测用例:已补(用例 id)/ 计划补(负责人、日期)/ 无法用评测覆盖(原因)」。第三种也是合法的,有些问题更适合用监控和告警去兜,但要写理由。

这四个钉子不需要任何新工具,只改模板和评审习惯。资深工程师在团队里能起的作用,很多时候就是推动这种看起来不起眼的改动,并且坚持到它变成习惯。

还有一个钉子不是动作,是工具:下面的 registry 会把「每条用例都有负责人和需求号」从一句口号变成 CI 里的一个红叉。

## 评测的预算

评测被团队抛弃,另一个常见原因是又慢又贵。跑一次要一个小时,每个 MR 都要等,大家很快会想办法绕过它。所以平台组要像对待线上服务一样盯评测的耗时和花费。

先得有一个数:一次评测运行到底多少钱、多少秒。这个数不要凭印象,量出来。[Day 541](/blog/agent-zero/day-541-orch-2/) 的 `arch_bench.py` 每次运行都记了成本和耗时,留在 `part10/arch_bench_raw.json` 里。如果你的机器上这个文件是 Day 541 用 3 遍跑出来的也行,想和我对上数字就重新跑一次混合第二版(要花大约 ¥0.06):

```bash
cd agent-zero-lab
uv run python -m part10.arch_bench 5 hybrid2
```

再量一下「请模型当裁判」的单价。[Day 358](/blog/agent-zero/day-358-llm-judge-3/) 讲的 LLM judge 每条用例要多调一次模型,这笔钱要算进去。下面这个脚本拿 `arch_bench_raw.json` 里 40 条真实的回复,让模型按「客服质检员」的角色判一遍,同时和 Day 541 的代码判题对一下:

```python
# agent-zero-lab/part10/judge_cost.py
"""量一量「请模型当裁判」每次多少钱、多少秒。用 arch_bench_raw.json 里真实的回复当样本。"""
import json
from pathlib import Path

from common.llm import LLMClient
from part10.bench_tasks import TASKS

HERE = Path(__file__).parent
SYSTEM = (
    "你是客服质检员。给你一张工单和客服的回复,判断回复有没有把事情处理对:"
    "该退款的退了、不该退款的没有退、没有编造退款单号。只输出 JSON:{\"pass\": true 或 false, \"reason\": \"一句话\"}。"
)

raw = json.loads((HERE / "arch_bench_raw.json").read_text())
ticket_of = {t["id"]: t["ticket"] for t in TASKS}
sample = [r for r in raw if r["arch"] in ("single", "hybrid2")][:40]  # 取 40 条

llm = LLMClient()
agree, costs, secs = 0, [], []
for r in sample:
    res = llm.chat(
        [{"role": "system", "content": SYSTEM},
         {"role": "user", "content": f"工单:{ticket_of[r['task_id']]}\n回复:{r['reply']}"}],
        temperature=0, response_format={"type": "json_object"},
    )
    j = json.loads(res.content)
    verdict = j["pass"]
    if verdict != r["ok"]:
        print(f"  不一致 {r['task_id']} 代码判 {r['ok']} 裁判判 {verdict}:{j['reason']}")
    agree += verdict == r["ok"]
    costs.append(res.cost)
    secs.append(res.latency)

out = {"n": len(sample), "cost_per_call": sum(costs) / len(costs), "seconds_per_call": sum(secs) / len(secs)}
(HERE / "data" / "judge_cost.json").write_text(json.dumps(out))
print(f"{out['n']} 次评审:每次 {out['cost_per_call']:.5f} 元、{out['seconds_per_call']:.2f} 秒;"
      f"和代码判题结果一致 {agree}/{len(sample)}")
print(llm.ledger)
```

<div class="line-notes">

- `SYSTEM = (` 裁判的提示词放在文件顶上。只输出 JSON,键是 `pass` 和 `reason`,方便后面 `json.loads`。
- `raw = json.loads((HERE / "arch_bench_raw.json").read_text())` 读 Day 541 留下的原始结果。每条里有 `arch`(哪种架构)、`task_id`、`ok`(代码判题的结果)、`reply`(客户收到的回复)。
- `ticket_of = {t["id"]: t["ticket"] for t in TASKS}` 工单 id 到工单原文的字典,等会儿把工单原文也交给裁判。
- `sample = [r for r in raw if r["arch"] in ("single", "hybrid2")][:40]` 取前 40 条。原始文件里先是 workflow,再是 single,所以这 40 条实际全是 single 的回复(8 张工单 × 5 遍),这一点下面讲结果时要用到。
- `llm = LLMClient()` Day 135 的客户端,读 `.env`,自带 `ledger` 记账。
- `res = llm.chat(` 一次调用。`temperature=0` 让裁判尽量稳定,`response_format={"type": "json_object"}` 打开 DeepSeek 的 JSON 模式(Day 148),提示词里必须出现「JSON」这个词,否则接口会报错。
- `j = json.loads(res.content)` 把裁判的回答解析成字典。
- `if verdict != r["ok"]:` 只把和代码判题不一致的打印出来,下面能看到全部 11 条。
- `agree += verdict == r["ok"]` 布尔值能直接加,`True` 当 1。
- `costs.append(res.cost)` 每次调用的花费,单位元,由 `LLMClient` 按 `.env` 里的 `LLM_PRICE` 算好。
- `out = {"n": len(sample), "cost_per_call": sum(costs) / len(costs), "seconds_per_call": sum(secs) / len(secs)}` 求平均,等会儿预算脚本读这个文件。
- `(HERE / "data" / "judge_cost.json").write_text(json.dumps(out))` 写成 JSON,`part10/data/` 是 Day 547 要用的目录,这里先建好。

</div>

```bash
uv run python -m part10.judge_cost
```

```text
  不一致 T6 代码判 True 裁判判 False:工单要求退掉9月份全部扣重款项，回复只退了两笔，未处理全部，且未核实是否还有其他重复扣款。
  不一致 T6 代码判 True 裁判判 False:客户要求退掉9月份全部多笔重复扣款，回复只退了两笔，未处理全部，且未核实是否还有其他重复扣款。
  不一致 T6 代码判 True 裁判判 False:工单要求退掉9月份全部多笔重复扣款，回复只退了两笔，未处理全部，处理不完整。
  不一致 T6 代码判 True 裁判判 False:工单要求退9月份全部重复扣款，回复只退了两笔，未处理其余扣重订单，处理不完整。
  不一致 T6 代码判 True 裁判判 False:工单要求退掉9月份全部多笔重复扣款，回复只退了两笔，未处理全部，且未核实是否还有其他重复扣款。
  不一致 T7 代码判 False 裁判判 True:确认重复扣款并退款468元，退款单号RF-1与发票INV-2602对应，处理正确。
  不一致 T8 代码判 True 裁判判 False:工单要求退一笔重复扣款，客服未退款且未核实是否重复扣款，仅以金额不同拒绝，处理不当。
  不一致 T8 代码判 True 裁判判 False:客户要求退一笔重复扣款，客服以金额不同为由拒绝退款，但未核实是否属于重复扣款，处理不当。
  不一致 T8 代码判 True 裁判判 False:客户要求退一笔重复扣款，客服未退款且未核实具体扣款，直接以金额不同拒绝，未处理对。
  不一致 T8 代码判 True 裁判判 False:工单要求退一笔，客服以金额不同为由拒绝退款，未按工单处理退款。
  不一致 T8 代码判 True 裁判判 False:工单要求退一笔，客服以金额不同为由拒绝退款，未按工单处理退款。
40 次评审:每次 0.00057 元、0.83 秒;和代码判题结果一致 29/40
40 次调用 | 输入 6077 / 输出 1321 tokens | 约 ¥0.0227
```

先看钱和时间:每次评审 0.00057 元、0.83 秒,按 `.env` 里的 DeepSeek 高峰价(2026 年 10 月查官网:`deepseek-flash` 缓存命中输入 0.04 元、未命中输入 2 元、输出 8 元,每百万 token)算,40 次一共 ¥0.0227。

再看那 11 条不一致,这是我没想到的。5 条是 T6,裁判说「客户要求全部退掉,只退了两笔,没处理完」;5 条是 T8,裁判说「客户要退一笔重复扣款,客服以金额不同为由拒绝,处理不当」。可 Day 541 的发票数据里,C033 在 9 月只有两张重复的(INV-2502、INV-2504),退两笔恰恰是对的;C055 的两张发票金额一个 468 一个 99,不是重复扣款,不退才是对的。**代码判题是对的,裁判错了**,因为裁判只看到了工单和回复,没看到发票数据,只能猜。另一条 T7 是反过来的:裁判认可了「8 月和 9 月各扣 468 算重复」,而代码判它错(不同月不算重复)。我把这个脚本一共跑了三次,一致数分别是 30、30、29,`temperature=0` 也不能让它完全稳。

这件事今天只用来说明成本数字的来历,不展开。它留下的问题是:评审要想可靠,得把标准答案或者规则交给裁判,并且用人工标注核对它。这是 [Day 551](/blog/agent-zero/day-551-judge-scale-1/) 起「大规模评审」几天的内容。

现在有了两个单价,可以算账了。

```python
# agent-zero-lab/part10/eval_budget.py
"""评测要花多少钱、多少时间:用实测的单次成本算三层评测的账。"""
import argparse
import json
import statistics
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).parent
WORKERS = 8          # 假设:同时发 8 个请求(受限于接口限流,用前先查你们的额度)
MR_PER_DAY = 20      # 假设:团队一天合并 20 个 MR

ap = argparse.ArgumentParser()
ap.add_argument("--scale", type=float, default=1.0, help="真实工单比玩具工单重多少倍(成本和耗时同时放大)")
SCALE = ap.parse_known_args()[0].scale

raw = json.loads((HERE / "arch_bench_raw.json").read_text())
sut = [r for r in raw if r["arch"] == "hybrid2"]            # 被测系统:Day 541 选的混合第二版
SUT_COST = SCALE * statistics.mean(r["cost"] for r in sut)   # 元/次
SUT_SEC = SCALE * statistics.mean(r["seconds"] for r in sut) # 秒/次
judge = json.loads((HERE / "data" / "judge_cost.json").read_text())
JUDGE_COST, JUDGE_SEC = judge["cost_per_call"], judge["seconds_per_call"]


@dataclass
class Tier:
    name: str
    cases: int
    repeats: int
    use_judge: bool

    @property
    def runs(self) -> int:
        return self.cases * self.repeats

    @property
    def cost(self) -> float:
        return self.runs * (SUT_COST + (JUDGE_COST if self.use_judge else 0))

    @property
    def minutes(self) -> float:
        per_run = SUT_SEC + (JUDGE_SEC if self.use_judge else 0)
        return self.runs * per_run / WORKERS / 60


def show(title: str, tiers: list[Tier]) -> None:
    print(title)
    print(f"{'层':<16}{'用例':>5}{'×遍':>4}{'评审':>5}{'次数':>7}{'花费(元)':>10}{'耗时(分)':>9}")
    for t in tiers:
        print(f"{t.name:<14}{t.cases:>5}{t.repeats:>4}{'开' if t.use_judge else '关':>5}"
              f"{t.runs:>7}{t.cost:>10.2f}{t.minutes:>9.1f}")


if __name__ == "__main__":
    print(f"实测单价:被测 {SUT_COST:.5f} 元/次、{SUT_SEC:.2f} 秒/次;评审 {JUDGE_COST:.5f} 元/次、{JUDGE_SEC:.2f} 秒/次;"
          f"并发 {WORKERS},工单放大 {SCALE:g} 倍\n")
    all_cases = 500
    show("每个 MR 都全量跑:", [Tier("全量×3遍+评审", all_cases, 3, True)])
    full = Tier("全量×3遍+评审", all_cases, 3, True)
    print(f"  一天 {MR_PER_DAY} 个 MR:{full.cost * MR_PER_DAY:.0f} 元,等待 {full.minutes:.0f} 分钟/次\n")
    layered = [
        Tier("MR:P0 回归", 100, 1, False),
        Tier("夜间:全量", all_cases, 3, True),
        Tier("发版:全量", all_cases, 5, True),
    ]
    show("分三层:", layered)
    day = layered[0].cost * MR_PER_DAY + layered[1].cost
    print(f"  一天(20 个 MR + 1 次夜间):{day:.0f} 元")
```

<div class="line-notes">

- `ap.add_argument("--scale", type=float, default=1.0, help=` 命令行参数,和 JS 里 commander 的 `.option('--scale <n>')` 差不多。`--scale` 表示「真实工单比玩具工单重多少倍」,下面解释为什么需要它。
- `SCALE = ap.parse_known_args()[0].scale` 用 `parse_known_args` 而不是 `parse_args`:别的脚本 import 这个文件时,命令行里可能有它不认识的参数,不能报错退出。练习 3 就是这么 import 的。
- `sut = [r for r in raw if r["arch"] == "hybrid2"]` 被测系统选 Day 541 选中的混合第二版,它的 40 次运行就是单价的来源。
- `SUT_COST = SCALE * statistics.mean(r["cost"] for r in sut)` 平均每次 0.00137 元。乘 `SCALE`:放大 30 倍就是 0.041 元。
- `SUT_SEC = SCALE * statistics.mean(r["seconds"] for r in sut)` 平均每次 1.99 秒。
- `judge = json.loads((HERE / "data" / "judge_cost.json").read_text())` 读上一个脚本量出来的评审单价。评审不放大,它只看一小段回复。
- `class Tier:` 一层评测:多少条用例、每条跑几遍、开不开评审。三个数决定一切。
- `def runs(self) -> int:` `@property` 让 `t.runs` 不加括号就能读,和 JS 的 `get runs()` 一样。`500 × 3 = 1500` 次。
- `return self.runs * (SUT_COST + (JUDGE_COST if self.use_judge else 0))` 每次运行的钱 = 被测的钱,开评审再加评审的钱。1500 × (0.00137 + 0.00057) = 2.90 元。
- `return self.runs * per_run / WORKERS / 60` 耗时 = 总秒数 ÷ 并发数 ÷ 60。1500 × (1.99 + 0.83) / 8 / 60 = 8.8 分钟。`WORKERS = 8` 是我假设的并发数,接口的限流额度你得自己去查。
- `all_cases = 500` 假设评测集有 500 条。Day 544 里 40 条的评测集是演示用的,真实团队半年后到这个量级不奇怪。
- `Tier("MR:P0 回归", 100, 1, False),` MR 那层只跑 100 条 P0 回归用例,每条跑一遍,不开评审(用代码判题)。
- `Tier("夜间:全量", all_cases, 3, True),` 夜里跑全量,每条 3 遍,评审全开。
- `Tier("发版:全量", all_cases, 5, True),` 发版前跑全量,每条 5 遍。Day 544 的毕业规则就是每版跑 5 遍。

</div>

```bash
uv run python -m part10.eval_budget
```

```text
实测单价:被测 0.00137 元/次、1.99 秒/次;评审 0.00057 元/次、0.83 秒/次;并发 8,工单放大 1 倍

每个 MR 都全量跑:
层                  用例  ×遍   评审     次数     花费(元)    耗时(分)
全量×3遍+评审        500   3    开   1500      2.90      8.8
  一天 20 个 MR:58 元,等待 9 分钟/次

分三层:
层                  用例  ×遍   评审     次数     花费(元)    耗时(分)
MR:P0 回归        100   1    关    100      0.14      0.4
夜间:全量           500   3    开   1500      2.90      8.8
发版:全量           500   5    开   2500      4.84     14.6
  一天(20 个 MR + 1 次夜间):6 元
```

玩具工单上这笔账几乎是零:每个 MR 全量跑一次也才 ¥2.90、9 分钟。但这是 Day 541 那 8 张两三次调用就答完的工单。真实的 SupportPilot 工单要翻发票、查订阅、走六轮工具调用,我没有测过,凭经验猜重 20 到 50 倍。`--scale 30` 就是为了看这个量级(**30 是我假设的**,换成你自己测出来的值):

```bash
uv run python -m part10.eval_budget --scale 30
```

```text
实测单价:被测 0.04100 元/次、59.55 秒/次;评审 0.00057 元/次、0.83 秒/次;并发 8,工单放大 30 倍

每个 MR 都全量跑:
层                  用例  ×遍   评审     次数     花费(元)    耗时(分)
全量×3遍+评审        500   3    开   1500     62.35    188.7
  一天 20 个 MR:1247 元,等待 189 分钟/次

分三层:
层                  用例  ×遍   评审     次数     花费(元)    耗时(分)
MR:P0 回归        100   1    关    100      4.10     12.4
夜间:全量           500   3    开   1500     62.35    188.7
发版:全量           500   5    开   2500    103.91    314.5
  一天(20 个 MR + 1 次夜间):144 元
```

这下问题就出来了。每个 MR 全量跑一遍要 188.7 分钟、¥62.35,一天 20 个 MR 是 ¥1247,而且每个人每次等三个多小时。没人会忍受这个,大家会开始绕过它。分三层之后:MR 那层 12.4 分钟、¥4.10,夜间一次 ¥62.35,一整天 ¥144。钱一下降到原来的九分之一,等待时间从三小时变成十几分钟。

三层各有各的目的,别混:

- **MR 层**:只回答「这个改动有没有弄坏已经做到的事」。所以只跑回归集里最要紧的 P0 用例,用代码判题,不开评审。目标是 5 分钟左右。上面 12.4 分钟还超标,练习 3 来解决。
- **夜间层**:全量,多跑几遍,评审全开,产出完整报告。回答「整体状态怎么样,有没有慢慢漂」。
- **发版层**:全量加更多遍数,再加红队回归和统计对比(后面几天)。回答「这个版本能不能上」。

成本公式和 Day 541 一样,没有新东西:用例数 × 遍数 × 单次成本,再加评审。有一条习惯值得养:**每周把这个数贴出来**。团队看到「合成用例占 45%,占了一半的钱」,自然会讨论哪些可以砍。

## registry:给用例上户口

前面说了那么多「每条用例要有负责人、需求号」,光靠评审时记得检查不现实,写一个小工具挂在 CI 里。

用例文件还是 [Day 348](/blog/agent-zero/day-348-testcase-structure/) 的 JSONL,每行一条,每条多了几个元数据字段。先用 `make_cases.py` 造一份「有人维护了半年」的评测集:40 条用例,每条还带着最近 5 个版本、每版跑 5 遍的结果。里面全是虚构数据,**故意留了四处毛病**,给工具抓:

```python
# agent-zero-lab/part10/make_cases.py
"""造一份「有人维护了半年」的评测集:40 条用例 + 每条用例最近 5 个版本、每版跑 5 遍的结果。
全部是虚构数据,故意留了几处毛病,给明天的 registry 工具抓。"""
import json
import random
from pathlib import Path

DATA = Path(__file__).parent / "data"
rng = random.Random(11)

TOPICS = ["改发票抬头", "重复扣款", "年付退款", "补开发票", "改账单邮箱", "换套餐", "取消续费", "查扣款记录"]
OWNERS = ["dev-li"] * 4 + ["cs-chen", "finance-zhou", "dev-wang"]  # dev-li 一个人占大头
SOURCES = ["incident", "prd", "error_analysis", "synthetic", "synthetic"]

cases = []
for i in range(1, 41):
    cases.append({
        "id": f"T{i:03d}",
        "suite": "regression" if i <= 25 else "capability",
        "owner": rng.choice(OWNERS),
        "requirement": f"PRD-{rng.randint(10, 30)}",
        "severity": rng.choice(["P0", "P1", "P2"]),
        "source": rng.choice(SOURCES),
        "input": f"客户问:{rng.choice(TOPICS)}(变体 {i})",
    })

# 故意留的四处毛病
del cases[2]["owner"]            # T003 没有负责人
cases[11]["requirement"] = ""    # T012 需求号是空的
cases[29]["suite"] = "smoke"     # T030 集合名写错
cases[39]["id"] = "T039"         # 最后一条的 id 和倒数第二条重复

# 每条用例 5 个版本 × 每版跑 5 遍的 0/1 结果
runs: dict[str, list[list[int]]] = {}
for c in cases:
    cid = c["id"]
    if cid in runs:                      # 重复 id 只留第一份结果
        continue
    if c["suite"] == "regression":
        runs[cid] = [[1] * 5 for _ in range(5)]
    else:
        runs[cid] = [[int(rng.random() < q) for _ in range(5)] for q in (0.3, 0.5, 0.7, 0.8, 0.85)]
for cid in ("T007", "T019"):             # 两条回归用例在最新版本挂了
    runs[cid][-1] = [1, 0, 1, 1, 0]
for cid in ("T026", "T031", "T034", "T035", "T038"):  # 五条能力用例最近三版都稳了
    runs[cid][-3:] = [[1] * 5 for _ in range(3)]
for cid in ("T036", "T037"):             # 这两条:最近三版里有一版是 4/5,差一点
    runs[cid][-3:] = [[1] * 5, [1, 1, 1, 1, 0], [1] * 5]

(DATA / "eval_cases.jsonl").write_text("\n".join(json.dumps(c, ensure_ascii=False) for c in cases) + "\n")
(DATA / "eval_runs.json").write_text(json.dumps(runs))
print(f"写了 {len(cases)} 条用例、{len(runs)} 条用例的运行结果")
```

<div class="line-notes">

- `rng = random.Random(11)` 自己的随机数发生器,种子固定,每个人跑出来的数据一样。不用全局的 `random.seed`,避免影响别的代码。
- `OWNERS = ["dev-li"] * 4 + ["cs-chen", "finance-zhou", "dev-wang"]` 列表乘 4 是把 `"dev-li"` 重复 4 次。抽签时 dev-li 有 4/7 的概率,他会成为「评测集的单点」,health 要抓这个。
- `SOURCES = ["incident", "prd", "error_analysis", "synthetic", "synthetic"]` 合成占 2/5,和 Day 544 说的「别让合成占大头」对着看。
- `"suite": "regression" if i <= 25 else "capability",` 前 25 条是回归集,后 15 条是能力集。
- `"requirement": f"PRD-{rng.randint(10, 30)}",` 需求号随便造,`randint(10, 30)` 两头都包含。
- `del cases[2]["owner"]            # T003 没有负责人` 第一处毛病:整个键删掉。注意是「键不存在」,不是空字符串,下面的坑就出在这里。
- `cases[11]["requirement"] = ""    # T012 需求号是空的` 第二处:键在,值是空字符串。
- `cases[29]["suite"] = "smoke"     # T030 集合名写错` 第三处:取值不在允许的两个里。
- `cases[39]["id"] = "T039"         # 最后一条的 id 和倒数第二条重复` 第四处:id 重复,T039 出现了两次。
- `runs[cid] = [[1] * 5 for _ in range(5)]` 回归用例:5 个版本都是 5/5。`[1] * 5` 是五个 1。
- `runs[cid] = [[int(rng.random() < q) for _ in range(5)] for q in (0.3, 0.5, 0.7, 0.8, 0.85)]` 能力用例:五个版本的通过概率从 0.3 慢慢涨到 0.85。
- `for cid in ("T007", "T019"):             # 两条回归用例在最新版本挂了` 把这两条在最新版里改成 `[1, 0, 1, 1, 0]`(3/5),health 应该点名它们。
- `runs[cid][-3:] = [[1] * 5 for _ in range(3)]` 切片赋值:把最近三个版本全改成 5/5。T026、T031、T034、T035、T038 这五条应该被建议毕业。
- `for cid in ("T036", "T037"):             # 这两条:最近三版里有一版是 4/5,差一点` 这两条故意差一点点:中间那版 4/5 = 80%,不到 95%,不该毕业。

</div>

```bash
uv run python -m part10.make_cases
```

```text
写了 40 条用例、39 条用例的运行结果
```

写了 40 条用例,运行结果只有 39 条:因为那条重复的 id 只留第一份。现在写工具本身。它做两件事:`lint` 检查字段齐不齐、取值合不合法、id 有没有重复,不合格就让 CI 失败;`health` 结合最近的运行结果出一份状态报告。毕业判断直接 import [Day 544](/blog/agent-zero/day-544-eval-org/) 的 `ready_to_graduate`,规则只写一处。

```python
# agent-zero-lab/part10/registry.py
"""评测用例的户口检查。lint:字段齐不齐、取值对不对;health:当前评测集的状态。"""
import argparse
import json
import sys
from collections import Counter
from pathlib import Path

from part10.case_lifecycle import Case, ready_to_graduate

REQUIRED = ("id", "suite", "owner", "requirement", "severity", "source")
ENUMS = {
    "suite": ("capability", "regression"),
    "severity": ("P0", "P1", "P2"),
    "source": ("incident", "prd", "error_analysis", "synthetic"),
}
CONCENTRATION = 0.4  # 一个人名下的用例超过这个比例,health 提醒一句


def load(path: str) -> list[dict]:
    lines = Path(path).read_text().splitlines()
    return [json.loads(line) for line in lines if line.strip()]


def lint(cases: list[dict]) -> list[str]:
    """返回问题列表,空列表代表全部合格。不假设数据是干净的:缺字段的用例也要能检查完。"""
    problems: list[str] = []
    seen: set[str] = set()
    for n, c in enumerate(cases, start=1):
        cid = c.get("id") or f"第 {n} 行"
        for field in REQUIRED:
            if not c.get(field):
                problems.append(f"{cid}: 缺字段 {field}(没写或是空的)")
        for field, allowed in ENUMS.items():
            if c.get(field) and c[field] not in allowed:
                problems.append(f"{cid}: {field} 只能是 {allowed},现在是 {c[field]!r}")
        if cid in seen:
            problems.append(f"{cid}: id 重复")
        seen.add(cid)
    return problems


def health(cases: list[dict], runs: dict[str, list[list[int]]]) -> list[str]:
    """给人看的状态报告:一条一行。"""
    out: list[str] = []
    regression = [c for c in cases if c.get("suite") == "regression"]
    capability = [c for c in cases if c.get("suite") == "capability"]
    out.append(f"回归集 {len(regression)} 条,能力集 {len(capability)} 条,"
               f"集合名不对的 {len(cases) - len(regression) - len(capability)} 条")

    broken = [c["id"] for c in regression if c["id"] in runs and 0 in runs[c["id"]][-1]]
    out.append(f"回归集最新一版没全过的:{broken or '无'}")

    cands = []
    for c in capability:
        run = runs.get(c["id"], [])
        case = Case(c["id"], source=c.get("source", ""), owner=c.get("owner", ""), runs=run)
        if ready_to_graduate(case):          # Day 544 的毕业规则,原样用
            cands.append(c["id"])
    out.append(f"能力集里可以毕业的:{cands or '无'}")

    owners = Counter(c.get("owner", "(无)") for c in cases)
    top, cnt = owners.most_common(1)[0]
    if cnt / len(cases) > CONCENTRATION:
        out.append(f"提醒:{top} 名下 {cnt}/{len(cases)} 条,超过 {CONCENTRATION:.0%},他一走评测就悬了")

    syn = sum(c.get("source") == "synthetic" for c in cases)
    out.append(f"合成用例占 {syn}/{len(cases)} = {syn / len(cases):.0%}")
    return out


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="registry")
    ap.add_argument("cmd", choices=["lint", "health"])
    ap.add_argument("cases")
    ap.add_argument("--runs")
    args = ap.parse_args(argv)

    cases = load(args.cases)
    problems = lint(cases)
    for p in problems:
        print(p)
    if args.cmd == "lint":
        print(f"检查了 {len(cases)} 条,{len(problems)} 处问题")
        return 1 if problems else 0   # 非 0 的退出码,CI 才会变红
    runs = json.loads(Path(args.runs).read_text()) if args.runs else {}
    if problems:
        print(f"(先有 {len(problems)} 处户口问题,下面的统计可能不全)")
    for line in health(cases, runs):
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

<div class="line-notes">

- `from part10.case_lifecycle import Case, ready_to_graduate` Day 544 的状态机文件。毕业规则(连续 3 个版本、每版通过率 ≥95%)只在那里写一次,这里原样用。
- `REQUIRED = ("id", "suite", "owner", "requirement", "severity", "source")` 六个必填字段。比 Day 544 的状态机多了严重级别 `severity`,上线后 P0 用例挂了和 P2 挂了处理方式不一样。
- `"suite": ("capability", "regression"),` 每个枚举字段列出允许的取值。元组(tuple)是不能改的列表,正好用来放常量。
- `CONCENTRATION = 0.4` 一个人名下的用例超过 40%,`health` 提醒一句。阈值写在文件顶上,团队想调一眼能看到。
- `lines = Path(path).read_text().splitlines()` 读整个文件,按行切开。JSONL 的好处是一行一条,坏了一行不影响别的行。
- `return [json.loads(line) for line in lines if line.strip()]` 跳过空行,每行解析成字典。
- `def lint(cases: list[dict]) -> list[str]:` 返回问题列表,空列表就是全部合格。不抛异常、不打印,方便测试和复用。
- `cid = c.get("id") or f"第 {n} 行"` 连 id 都缺的用例,用行号当名字报问题。`c.get("id")` 键不存在时返回 `None` 而不是报错。
- `if not c.get(field):` 键不存在和值为空字符串,在这里一起算「缺」。T003(没有键)和 T012(空字符串)都会被抓到。
- `if c.get(field) and c[field] not in allowed:` 先确认有值再看取值对不对,缺字段的上一行已经报过,不重复报。T030 的 `smoke` 在这里被抓。
- `if cid in seen:` 第二次见到同一个 id 就报重复。`seen` 是集合,查找是 O(1)。T039 第二次出现时被抓。
- `regression = [c for c in cases if c.get("suite") == "regression"]` 用 `.get` 而不是 `c["suite"]`:`health` 也不能假设数据是干净的。
- `broken = [c["id"] for c in regression if c["id"] in runs and 0 in runs[c["id"]][-1]]` 回归用例里,最新一个版本(`[-1]`)的 5 遍里有 0 的,就是「没全过」。输出里是 T007 和 T019。
- `case = Case(c["id"], source=c.get("source", ""), owner=c.get("owner", ""), runs=run)` 临时造一个 Day 544 的 `Case` 对象,只为了调 `ready_to_graduate`。`Case` 必填的只有 `id` 和 `source`。
- `if ready_to_graduate(case):          # Day 544 的毕业规则,原样用` 5 条返回真:T026、T031、T034、T035、T038。T036、T037 因为中间有一版 4/5 不在里面。
- `owners = Counter(c.get("owner", "(无)") for c in cases)` 数每个人名下几条,缺负责人的归到「(无)」。
- `top, cnt = owners.most_common(1)[0]` 最多的那位:`dev-li`,26 条。
- `if cnt / len(cases) > CONCENTRATION:` 26/40 = 65% > 40%,提醒。
- `syn = sum(c.get("source") == "synthetic" for c in cases)` 合成用例的数量,布尔值求和。18 条,占 45%。
- `return 1 if problems else 0   # 非 0 的退出码,CI 才会变红` 进程的退出码:0 是成功,非 0 是失败。CI 只看这个数,不看你打印了什么。这一行就是「红叉」的来源。
- `sys.exit(main(sys.argv[1:]))` `sys.argv[1:]` 是命令行参数(去掉脚本名自己),相当于 JS 的 `process.argv.slice(2)`。`sys.exit(n)` 以 n 为退出码结束进程。

</div>

跑一遍 `lint`,再看退出码:

```bash
uv run python -m part10.registry lint part10/data/eval_cases.jsonl
echo "exit=$?"
```

```text
T003: 缺字段 owner(没写或是空的)
T012: 缺字段 requirement(没写或是空的)
T030: suite 只能是 ('capability', 'regression'),现在是 'smoke'
T039: id 重复
检查了 40 条,4 处问题
```

```text
exit=1
```

四处毛病全抓到了,退出码是 1。在 CI 配置里加一步 `uv run python -m part10.registry lint evals/cases.jsonl`,这一步红了,MR 就合不进去(CI 具体怎么配是 [Day 375](/blog/agent-zero/day-375-eval-project-2/) 的事,这里不重复)。取前两行,没有毛病的话:

```bash
head -n 2 part10/data/eval_cases.jsonl > part10/data/two.jsonl
uv run python -m part10.registry lint part10/data/two.jsonl
echo "exit=$?"
```

```text
检查了 2 条,0 处问题
```

```text
exit=0
```

再跑 `health`:

```bash
uv run python -m part10.registry health part10/data/eval_cases.jsonl --runs part10/data/eval_runs.json
```

```text
T003: 缺字段 owner(没写或是空的)
T012: 缺字段 requirement(没写或是空的)
T030: suite 只能是 ('capability', 'regression'),现在是 'smoke'
T039: id 重复
(先有 4 处户口问题,下面的统计可能不全)
回归集 25 条,能力集 14 条,集合名不对的 1 条
回归集最新一版没全过的:['T007', 'T019']
能力集里可以毕业的:['T026', 'T031', 'T034', 'T035', 'T038']
提醒:dev-li 名下 26/40 条,超过 40%,他一走评测就悬了
合成用例占 18/40 = 45%
```

这份报告是给人看的。回归集有两条在最新版本没全过,点名了;能力集里有五条可以毕业,下一步就是用 Day 544 的 `graduate` 把它们挪过去;dev-li 一个人名下 26 条,他一走,三分之二的评测就没有负责人了;合成用例占 45%,是个要讨论的数字。

### 踩一个坑:检查数据质量的工具,自己被脏数据弄崩

我写 `health` 的第一版,统计负责人那一行是这样写的:

```python
# agent-zero-lab/part10/ex546_keyerror_demo.py
"""第一版 health 的写法:假设每条用例都有 owner。"""
from collections import Counter

from part10.registry import load

cases = load("part10/data/eval_cases.jsonl")
owners = Counter(c["owner"] for c in cases)
print(owners.most_common(1))
```

```bash
uv run python -m part10.ex546_keyerror_demo
```

```text
Traceback (most recent call last):
  ...
    owners = Counter(c["owner"] for c in cases)
                     ~^^^^^^^^^
KeyError: 'owner'
```

中间的调用栈我省略了。原因很直接:T003 压根没有 `owner` 这个键,`c["owner"]` 在字典里找不到键就抛 `KeyError`。结果是 lint 的四条问题还没来得及报,程序先崩了。检查脏数据的工具不能假设数据是干净的,否则它在最需要的时候不工作。改成 `c.get("owner", "(无)")`,取不到就给个默认值,正是上面最终版里的写法。

这个坑和 [Day 545](/blog/agent-zero/day-545-week78-review/) 默写里「子 Agent 没交回 JSON 也要当失败」是同一类:对输入的假设越少,工具越稳。

## 评测平台要给用户什么

最后从「评测是产品」的角度列一张清单。设计这类内部平台,先列用户和他们的任务,再决定功能,和设计任何产品一样。

| 用户 | 要什么 | 后面哪几天 |
| --- | --- | --- |
| 业务工程师 | 一条命令跑自己模块的评测;MR 里看到新挂了哪几条、分数的区间多大 | Day 547 起(统计),Day 553 |
| 领域专家 | 不写代码就能确认期望答案、给样本打标签的界面 | Day 358 的标注工具 |
| 平台组 | judge 的版本管理、校准和漂移监控 | Day 551、553 |
| 产品经理和管理者 | 能回答「这次改版到底好不好」的实验结果 | 统计几天、线上实验 |
| 安全负责人 | 红队结果和回归 | 红队几天 |

这张表里的「客户」大部分不是写 Agent 的人。很多评测平台做得没人用,是因为只服务了写代码的人。

## 动手练习

**练习 1:P0 用例要有第二双眼睛。** 给 `lint` 加一条规则:严重级别是 P0 的用例必须有 `reviewer` 字段,而且不能是负责人自己。新建 `part10/ex546_lint_reviewer.py`,在 `registry.lint` 的基础上加这一条,用 `eval_cases.jsonl` 里的 P0 用例试:第一条 P0 把 reviewer 填成负责人自己,第二条填别人,其余不填。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex546_lint_reviewer.py
"""练习 1:P0 用例要多一个 reviewer 字段,而且不能是负责人自己。"""
from part10.registry import lint, load


def lint_strict(cases: list[dict]) -> list[str]:
    problems = lint(cases)
    for c in cases:
        if c.get("severity") != "P0":
            continue
        cid = c.get("id", "?")
        if not c.get("reviewer"):
            problems.append(f"{cid}: P0 用例缺 reviewer")
        elif c["reviewer"] == c.get("owner"):
            problems.append(f"{cid}: P0 用例的 reviewer 不能是负责人自己({c['owner']})")
    return problems


if __name__ == "__main__":
    cases = load("part10/data/eval_cases.jsonl")
    p0 = [c for c in cases if c.get("severity") == "P0"]
    p0[0]["reviewer"] = p0[0].get("owner", "")  # 第一条 P0:reviewer 填成负责人自己
    p0[1]["reviewer"] = "finance-zhou"          # 第二条 P0:填了别人,合格
    new = [p for p in lint_strict(cases) if "reviewer" in p]  # 其余 P0 都没填
    print(f"P0 用例共 {len(p0)} 条,reviewer 相关问题 {len(new)} 处,前 3 处:")
    for p in new[:3]:
        print(" ", p)
```

<div class="line-notes">

- `problems = lint(cases)` 先拿到 registry 原来的问题,新规则追加在后面,不改 `lint` 本身。
- `if c.get("severity") != "P0":` 只管 P0,其他级别跳过。
- `if not c.get("reviewer"):` 没写 reviewer 或者是空的。
- `elif c["reviewer"] == c.get("owner"):` reviewer 和负责人是同一个人。`elif` 保证没写的情况不会走到这里再报一遍。
- `p0[0]["reviewer"] = p0[0].get("owner", "")  # 第一条 P0:reviewer 填成负责人自己` 造一个违规样例。第一条 P0 是 T004,负责人 cs-chen。
- `p0[1]["reviewer"] = "finance-zhou"          # 第二条 P0:填了别人,合格` 造一个合格样例。
- `new = [p for p in lint_strict(cases) if "reviewer" in p]  # 其余 P0 都没填` 只留 reviewer 相关的问题,免得被前面那四处毛病淹没。

</div>

```bash
uv run python -m part10.ex546_lint_reviewer
```

```text
P0 用例共 15 条,reviewer 相关问题 14 处,前 3 处:
  T004: P0 用例的 reviewer 不能是负责人自己(cs-chen)
  T013: P0 用例缺 reviewer
  T015: P0 用例缺 reviewer
```

15 条 P0,一条违规(自己审自己)、一条合格、13 条没填,共 14 处。注意这条规则和 Day 544 练习 2 的「负责人不能自己批退役」是同一个思路:最有动机放水的人,不能是唯一的把关人。规则也不是万能的,随便填一个同事的名字就能绕过去,所以它是兜底,不是替代评审。

</details>

**练习 2:这个 MR 现在能合吗?** 把 CODEOWNERS 的规则写成函数:给一个 MR 改动的文件列表和已经批准的团队,返回还缺哪些团队的批准。目录规则用最长前缀优先。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex546_codeowners.py
"""练习 2:改了哪个目录下的用例,就要那个目录的负责团队批准。判断一个 MR 现在能不能合。"""

OWNERS = {                      # 目录前缀 -> 负责团队(最长前缀优先)
    "evals/suites/billing/": "billing-team",
    "evals/suites/support/": "support-team",
    "evals/": "eval-platform",   # 其余评测目录归平台组
}


def owner_of(path: str) -> str:
    for prefix in sorted(OWNERS, key=len, reverse=True):
        if path.startswith(prefix):
            return OWNERS[prefix]
    return "nobody"


def missing_approvals(changed: list[str], approved_by: set[str]) -> set[str]:
    needed = {owner_of(p) for p in changed}
    return needed - approved_by


if __name__ == "__main__":
    mr = ["evals/suites/billing/refund.jsonl", "evals/suites/support/invoice.jsonl", "evals/report.py"]
    print("需要:", sorted({owner_of(p) for p in mr}))
    print("只有 billing 批了,还缺:", sorted(missing_approvals(mr, {"billing-team"})))
    print("三个都批了,还缺:", sorted(missing_approvals(mr, {"billing-team", "support-team", "eval-platform"})) or "无")
```

<div class="line-notes">

- `OWNERS = {                      # 目录前缀 -> 负责团队(最长前缀优先)` 字典的键是目录前缀,值是团队名。和上面 CODEOWNERS 文件的三行一一对应。
- `for prefix in sorted(OWNERS, key=len, reverse=True):` 先试最长的前缀。`sorted(..., key=len, reverse=True)` 按长度从大到小排。如果不这样排,`evals/` 会先匹配上,`evals/suites/billing/` 下的文件就都归平台组了。
- `if path.startswith(prefix):` 路径以这个前缀开头就算归它。
- `return "nobody"` 没人认领的路径返回一个明显的占位。生产上这应该是个告警:没有负责人的目录是个洞。
- `needed = {owner_of(p) for p in changed}` 集合推导式,改动涉及的每个团队只记一次。
- `return needed - approved_by` 集合相减:需要的减去已经批准的,剩下就是缺的。
- `mr = ["evals/suites/billing/refund.jsonl", "evals/suites/support/invoice.jsonl", "evals/report.py"]` 一个同时改了三个地方的 MR:两个团队的用例加平台组的报告脚本。

</div>

```bash
uv run python -m part10.ex546_codeowners
```

```text
需要: ['billing-team', 'eval-platform', 'support-team']
只有 billing 批了,还缺: ['eval-platform', 'support-team']
三个都批了,还缺: 无
```

三个团队都要批,只有 billing 批了还缺两个。这个例子也说明了为什么**一个 MR 最好只改一个团队的用例**:跨团队的 MR 要等三个人,而且谁都可能是瓶颈。

</details>

**练习 3:MR 那层怎么压到 5 分钟。** `--scale 30` 时 MR 层 100 条 P0 要 12.4 分钟。在并发数和单条耗时不变的前提下,算出 5 分钟内最多能放几条 P0 用例,再说说怎么选这几条。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex546_mr_fit.py
"""练习 3:MR 那一层要控制在 5 分钟内,真实工单是玩具工单的 30 倍重时,最多能放几条 P0 用例?"""
import sys

sys.argv = [sys.argv[0], "--scale", "30"]  # 让 eval_budget 按 30 倍算

from part10.eval_budget import SUT_COST, SUT_SEC, WORKERS, Tier  # noqa: E402

LIMIT_MIN = 5
n = int(LIMIT_MIN * 60 * WORKERS / SUT_SEC)  # 每条规则断言只跑一遍、不开评审
t = Tier("MR:P0 回归", n, 1, False)
print(f"{LIMIT_MIN} 分钟 × {WORKERS} 并发 / {SUT_SEC:.1f} 秒每次 -> 最多 {n} 条")
print(f"这一层:{t.runs} 次、{t.cost:.2f} 元、{t.minutes:.1f} 分钟")
```

<div class="line-notes">

- `sys.argv = [sys.argv[0], "--scale", "30"]  # 让 eval_budget 按 30 倍算` 在 import 之前直接改命令行参数,让 `eval_budget` 里的 argparse 读到 30。这是个取巧的写法,只适合一次性脚本。
- `from part10.eval_budget import SUT_COST, SUT_SEC, WORKERS, Tier  # noqa: E402` import 写在代码中间,Ruff 会警告 E402(import 没放在文件顶),这里加 `noqa` 表示故意的。
- `n = int(LIMIT_MIN * 60 * WORKERS / SUT_SEC)` 5 × 60 × 8 / 59.6 = 40.26,取整 40。总预算秒数除以每次耗时。
- `t = Tier("MR:P0 回归", n, 1, False)` 用 40 条代入原来的 `Tier`,验证一下总耗时。

</div>

```bash
uv run python -m part10.ex546_mr_fit
```

```text
5 分钟 × 8 并发 / 59.6 秒每次 -> 最多 40 条
这一层:40 次、1.64 元、5.0 分钟
```

最多 40 条。怎么选:不是随便挑 40 条,而是按「最不能坏」排序。我的顺序是:严重级别 P0 优先;其中来自线上事故的优先(它们真出过事);再看最近几个版本挂过的,挂过的更容易再挂;最后才是随机补满。选好以后写进 CI,而不是每次手选。另一个办法是只跑和本次改动相关的模块,比如改了退款工具,就只跑退款相关的 P0,这要求用例有模块标签。

</details>

**练习 4(开放题):给 AgentOps 写分工说明。** AgentOps 要接入五个团队(销售、财务、研发、客服、法务)。写一页「评测分工说明」:按上面责任表的格式写每类事项谁负责;再写一段 PRD 模板里的「验收评测」小节和一栏事故复盘模板。

<details><summary>参考答案</summary>

一个示范(你的版本可以不同,标准是每一行都有一个具体的负责人,没有「各团队」「相关同学」这种说法):

| 事项 | 负责 | 参与 | 知会 |
| --- | --- | --- | --- |
| 运行时本身的回归用例 | 运行时开发(平台组) | 值班工程师 | 五个接入团队 |
| 各团队 Agent 的业务用例 | 各团队的技术负责人 | 本团队领域专家 | 平台组 |
| 退款金额、折算类期望答案 | 财务的周 | 客服的陈 | 平台组 |
| 合同和承诺类期望答案 | 法务的吴 | 销售的李 | 平台组 |
| judge 改动与重新校准 | 平台组的评测负责人 | 提供标注的两位专家 | 五个团队 |
| CI 门禁阈值 | 平台组的评测负责人 | 技术总监 | 全组 |
| 评测成本超预算 | 平台组的评测负责人 | 技术总监 | 全组 |

PRD 模板「验收评测」:列出用例 id 或草稿;写明谁确认期望答案;写明属于能力集还是回归集、几个版本后评估毕业;写明预期的评测增量(多少条、每遍多少钱)。

事故复盘一栏:「对应评测用例:已补 EVAL-xxx / 计划补(负责人、日期)/ 无法用评测覆盖(原因,例如:属于基础设施故障,用监控告警覆盖)」。

写完用一个检验:拿一件具体的事,比如「期望答案过时了」,在表里能不能一眼找到谁来处理。找不到,说明分工还没落到人头上。

</details>

**验收标准**:`registry.py` 的 `lint` 抓出 4 处毛病并以退出码 1 结束,`health` 输出和正文一致;能解释为什么 `health` 里要用 `.get` 而不是 `[]`;能说出三层评测各自回答的问题,并说出放大 30 倍时分层省了多少钱和时间;四个钉子能不看文章说出来;练习 4 的表里每一行都是具体的人。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 评测所有权 | 评测的每一件事(用例、期望答案、judge、门禁、成本)都有一个具体的人或团队负责 |
| 评测平台组 | 负责怎么评:跑评测的设施、judge、统计、成本。不替业务决定什么叫答对 |
| 领域专家 | 懂业务对错的人,比如客服主管、财务、法务,负责确认期望答案 |
| benevolent dictator | 直译「仁慈的独裁者」,指标准由一个懂业务的人说了算,而不是投票 |
| PRD | 产品需求文档(Product Requirements Document) |
| CODEOWNERS | 代码托管平台上的一个文件,规定哪个目录归谁,改这个目录的 MR 需要他们批准 |
| MR | 合并请求(Merge Request),GitLab 的叫法,GitHub 叫 Pull Request |
| 评测预算 | 跑评测花的钱和时间,要像线上服务一样被盯着 |
| 分层跑 | 把评测按目的分成 MR、夜间、发版三层,每层跑不同的量 |
| 并发 | 同时发出多少个请求。耗时 = 总秒数 ÷ 并发数,但受接口限流的限制 |
| registry | 登记册。这里指评测用例的元数据登记和检查工具 |
| lint | 静态检查,不运行业务逻辑,只检查格式和规则。前端的 ESLint 就是 lint |
| 退出码 | 进程结束时返回的数字,0 表示成功,非 0 表示失败,CI 靠它判断红绿 |
| JSONL | 每行一个 JSON 的文本文件,[Day 348](/blog/agent-zero/day-348-testcase-structure/) 讲过 |
| argparse | Python 标准库里解析命令行参数的模块,相当于 Node 里的 commander |

## 常见误区

**以为评测是平台组的事。** 平台组能提供工具,不知道你的业务什么叫答对。用例的内容必须由离业务最近的人负责,平台组只管怎么跑。

**分工只写在 wiki 里。** 没有钉进需求评审、代码评审、CODEOWNERS 和事故复盘,三个月后没人记得。流程靠固定动作兜底,不靠自觉。

**每个 MR 都全量跑。** 玩具工单上不觉得,真实工单放大 30 倍后,一次 189 分钟、¥62。大家会开始绕过它,评测形同虚设。分层跑,MR 层只放最不能坏的那几十条。

**用玩具工单的成本估真实评测的预算。** 今天的单价来自 8 张两三次调用的工单。放大倍数 30 是我假设的,你要用自己的真实工单量一遍。

**以为请模型当裁判就不用代码判题了。** 今天 40 条里裁判和代码判题有 11 条不一致,而错的是裁判:它没看到发票数据。给裁判的材料要带上标准答案或规则,并且用人工标注核对。

**检查数据的工具假设数据是干净的。** `c["owner"]` 遇到缺字段直接 `KeyError`,lint 还没报完就崩了。用 `.get`,缺了给默认值。

**规则当成万能的。** reviewer 不能是负责人自己,随便填个同事名字就绕过去了。规则是兜底,评审人该真的去看。

## 学习资料

### 文档与文章

- [Anthropic · Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):今天分工那几句的出处,以及能力集、回归集和毕业的说法。我回原文核对过。40 分钟。
- [Hamel Husain · LLM Evals FAQ](https://hamel.dev/blog/posts/evals-faq/):页面很长,今天看「谁来定标准」和每周读 trace 的那几条就够。挑着读,30 分钟。
- [Hamel Husain · A Field Guide to Rapidly Improving AI Products](https://hamel.dev/blog/posts/field-guide/):讲为什么要让领域专家参与、为什么要有看数据的界面。第二遍读时注意他怎么描述团队协作。40 分钟。
- [Eugene Yan · An LLM-as-Judge Won't Save The Product, Fixing Your Process Will](https://eugeneyan.com/writing/eval-process/):核心观点是评测首先是流程问题,和今天的主题一致。20 分钟。
- [GitHub 文档:About code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) 和 [GitLab 文档:Code Owners](https://docs.gitlab.com/ee/user/project/codeowners/):CODEOWNERS 的完整语法和「必须批准」怎么在平台上设置。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Qg411M7oW&autoplay=0&high_quality=1" title="2分钟讲解|项目管理与团队管理分工矩阵RACI神器" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>丽大贝卡 · 2分钟讲解|项目管理与团队管理分工矩阵 RACI 神器 · 5 分钟以内。今天那张责任表(负责、参与、知会)就是 RACI 矩阵的简化版,视频讲清了四个字母各代表什么。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1c24y1E7DM&autoplay=0&high_quality=1" title="阿里工程师带你学如何玩转代码评审" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>阿里技术_AlibabaTech · 阿里工程师带你学如何玩转代码评审 · 27 分钟。今天的钉子二和钉子三都是代码评审流程的一部分,看评审在团队里怎么运转,再想评测怎么挂上去。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/XueTa4qrMpg" title="How Engineers and PMs should collaborate on Evals" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hamel Husain · How Engineers and PMs should collaborate on Evals · 英文。讲工程师和产品经理在评测上怎么分工,正好对应今天责任表里的「业务团队」和「领域专家」。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 4 章「Evaluate AI Systems」:讲怎么为应用定义评估标准、设计评估流水线,和今天的流程部分互相补充。
- Ron Kohavi、Diane Tang、Ya Xu《Trustworthy Online Controlled Experiments》(Cambridge University Press,2020):第 4 章讲实验平台和实验文化怎么在组织里建立。讲的是 A/B 测试,但「让数据驱动决策变成组织习惯」的经验对评测完全适用。

### 开源项目与代码

- 你自己的 `part10/registry.py`:后面统计几天会往里加区间和对比,Day 547 的练习 4 就会改它。
- [promptfoo](https://www.promptfoo.dev/docs/intro/):很多团队直接拿它的配置文件当评测用例的格式。看它怎么组织用例和断言,以及怎么放进 CI。

## 自测

1. 评测里的三个问题「怎么评」「评什么」「什么是对」分别归谁?为什么平台组不该替业务写用例?

<details><summary>答案</summary>

怎么评归评测平台组,评什么归业务团队,什么是对归领域专家。平台组不知道业务上什么叫答对,替业务写的用例要么脱离真实场景,要么期望答案有误;而且谁改了 Agent 的行为谁最清楚哪里会坏,用例应该跟着改动走,和「谁改代码谁改测试」一样。

</details>

2. 把分工钉进流程的四个钉子是什么?挑一个说说它拦住的是什么。

<details><summary>答案</summary>

需求评审问「用例在哪」、代码评审看用例改动、CODEOWNERS 管评测目录、事故复盘加「对应用例」一栏。以 CODEOWNERS 为例:它拦住「为了让 CI 变绿去改别人团队的期望答案」,改别人目录下的用例必须有对方批准。

</details>

3. 今天的预算表里,每个 MR 全量跑和分三层,差在哪?用 `--scale 30` 的数字说。

<details><summary>答案</summary>

每个 MR 全量跑(500 条 × 3 遍 + 评审)要 188.7 分钟、¥62.35,一天 20 个 MR 是 ¥1247。分三层后 MR 层只跑 100 条 P0 回归、不开评审,12.4 分钟、¥4.10;夜间全量一次 ¥62.35;一整天约 ¥144,钱降到约九分之一,每个人的等待从三个多小时变成十几分钟。放大倍数 30 是假设的。

</details>

4. `health` 里为什么用 `c.get("owner", "(无)")` 而不是 `c["owner"]`?

<details><summary>答案</summary>

T003 压根没有 `owner` 这个键,`c["owner"]` 会抛 `KeyError`,程序在报出 lint 问题之前就崩了。检查脏数据的工具不能假设数据干净,`.get` 在键不存在时返回默认值,工具才能把问题报完。

</details>

5. 面试题:「团队有 8 个工程师、3 条产品线,评测集 600 条,CI 跑一次 50 分钟,最近大家开始跳过评测直接合并。你怎么处理?」

<details><summary>答案</summary>

先诊断:慢和贵是表面,通常还伴随用例过时、没人负责、分数不可信。处理分几块。一,分层跑:MR 只跑相关模块的回归 P0 用例,用代码判题,控制在几分钟;全量放夜间;发版前跑全量加统计对比。二,清理评测集:用 registry 给每条用例补负责人和需求号,让各产品线认领,过时的带理由退役,合成用例砍到够用。三,分开能力集和回归集,MR 门禁只看回归集。四,把评测钉进流程:需求评审要有验收评测、代码评审看用例、CODEOWNERS 管评测目录、事故复盘补用例。五,平台组对耗时和成本负责,每周公布。最后用一两个月的数据证明:MR 等待时间降到多少,回归问题在合并前被拦住几次。

</details>

6. 今天 40 条回复里 LLM 裁判和代码判题有 11 条不一致,错的是哪一边?为什么?

<details><summary>答案</summary>

错的是裁判。T6、T8 里裁判说「只退两笔没处理完」「拒绝退款处理不当」,但发票数据显示 T6 只有两张重复发票、T8 的两张金额不同不算重复,代码判题对。裁判只看到工单和回复,没看到发票数据,只能猜。给裁判的材料要带标准答案或规则,并用人工标注核对它,这是 Day 551 起的内容。

</details>

## 明天预告

Day 547 · 评测统计学(一):通过率区间,别再用 p±1.96·SE。今天的 `health` 报告里写着「回归集最新一版 121/125」这样的数,但这个数有多可信?[Day 543](/blog/agent-zero/day-543-design-doc-2/) 的设计文档里 G4 写「成功率差异不显著」,第 8 节却只写「迁移前后各跑一次」,模型预审指出这没法判断。明天先从最基本的一步做起:一个通过率带多大的误差,为什么 Day 354 那个公式在通过率接近 100% 时会给出超过 100% 的区间,Wilson 区间怎么修。
