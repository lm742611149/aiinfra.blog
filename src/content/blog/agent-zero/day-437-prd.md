---
title: 'Day 437 · 一页 PRD:背景、用户、目标、非目标、指标、风险'
description: '把昨天 12 行的需求表压成一页 PRD:六块各写什么、目标怎么和指标一一挂钩、非目标为什么必须写理由。然后写一个脚本把 PRD 当成可以检查的文件:每条目标有指标、指标有数字和口径、非目标有理由、风险有对策,并且和需求表对账。故意弄坏五处,看检查全部抓到。'
pubDate: 2026-10-27
regime: none
tags: ['capstone', 'supportpilot', 'prd', 'metrics', 'requirements', 'agent-zero']
series: 'agent-zero'
day: 437
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 436](/blog/agent-zero/day-436-fde-requirements/) 做了两件事:用同一个模拟客户老周对比了「问意见」和「问过去」两种访谈(前者问出 0 条事实,后者问出 10 条),然后把访谈拆成 `part08/docs/requirements.md`,12 行需求,每行有原话、真实问题、需求、验收办法和状态(做 10 条、不做 1 条、待问 1 条)。`requirements.py` 里的 `check()` 保证每条要做的需求都有验收办法,每条访谈事实都有去处。

12 行表格是写给自己看的草稿。要拿它指挥后面 60 天的开发、拿它向别人说明「我做了什么、没做什么、怎么算做完」,得有一份更短、更正式的东西。这就是 PRD。

## 今天要解决的问题

今天讲两件事:**PRD 的六块各写什么**,以及**怎么让 PRD 能被检查**。学完你应该能:

1. 说出 PRD 的六块(背景、用户、目标、非目标、指标、风险)各回答什么问题,以及各自最常见的写坏方式。
2. 把需求表压成一页 PRD:目标有编号、有来源;非目标每条有理由;指标有数字、口径、测试集合。
3. 用 `prd_check.py` 检查 PRD,并且能说出这个检查抓得到什么、抓不到什么。
4. 看懂指标的写法:为什么规则类指标写 100%,模型类指标写 90%,以及 dev 和 test 两个集合为什么要分开。

今天不调模型,不花钱。预计用时 2.5 小时。前置:[Day 436](/blog/agent-zero/day-436-fde-requirements/) 的 `part08/requirements.py` 和 `part08/docs/requirements.md`;[Day 354](/blog/agent-zero/day-354-testset-size/)「开发集和留出集」(今天指标里的 dev / test 就是它);[Day 256](/blog/agent-zero/day-256-rag-eval-2/) 手算检索指标(recall@5 是什么)。脚本用到正则、集合推导式和 `pathlib`([Day 37](/blog/agent-zero/day-037-pathlib/))。

学法照旧:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 PRD 六块和「指标四要素」默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先从前端看:你见过的 PRD

你大概见过两种 PRD。一种是 Confluence 上二十页的文档,开会时投屏念一遍,之后没人打开。另一种是一页纸,上面写着「这期做 A、B、C,不做 D、E,上线后看这三个数」,开发、测试、设计都把它钉在手边。第二种有用。

今天要写的是第二种,而且我给它加一个要求:**它得能被机器检查**。这不是为了炫技。一份没人检查的 PRD,过两周就会出现这些情况:目标改了指标没改;写了一条指标但没人知道怎么算;「本期不做」的东西悄悄做了一半。你在前端项目里一定踩过其中一两个。

Agent 项目里 PRD 更重要,因为验收标准直接决定评测集怎么出。Day 476 起要建的评测集,每一条检查都来自 PRD 里的某条指标。指标写得含糊,评测就没法写。

## 六块各回答什么问题

| 块 | 回答的问题 | 最常见的写坏样子 |
| --- | --- | --- |
| 背景 | 为什么现在要做这件事?现状疼在哪? | 写成公司介绍,没有一个数字 |
| 用户 | 谁会用它、谁会被它影响? | 只写「客户」,漏掉要接手的客服和审批的财务 |
| 目标 | 本期要做到什么? | 写成功能清单,看不出为什么做 |
| 非目标 | 本期刻意不做什么? | 空着,或者只写「不做 X」不写理由 |
| 指标 | 做到什么程度算做完? | 「准确」「快」「体验好」,没有数字 |
| 风险 | 最可能在哪里翻车,打算怎么防? | 写一堆「模型可能出错」这种放在哪都成立的话 |

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="PRD 六块和它们在后面几周被谁使用">
  <g font-family="var(--font-mono)" font-size="12">
    <text x="20" y="22" fill="var(--ink-soft)">PRD 的块</text>
    <text x="360" y="22" fill="var(--ink-soft)">后面谁来用它</text>
    <rect x="20" y="34" width="150" height="26" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="30" y="52" fill="var(--ink)">背景 + 用户</text>
    <rect x="20" y="70" width="150" height="26" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="30" y="88" fill="var(--ink)">目标 G1–G7</text>
    <rect x="20" y="106" width="150" height="26" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="30" y="124" fill="var(--ink)">非目标 N1–N5</text>
    <rect x="20" y="142" width="150" height="26" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="30" y="160" fill="var(--ink)">指标 M1–M16</text>
    <rect x="20" y="178" width="150" height="26" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="30" y="196" fill="var(--ink)">风险 K1–K6</text>
    <rect x="360" y="34" width="260" height="26" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="370" y="52" fill="var(--ink-soft)">README、面试里的第一句话</text>
    <rect x="360" y="70" width="260" height="26" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="370" y="88" fill="var(--ink-soft)">Day 438 架构:每个目标落到哪个文件</text>
    <rect x="360" y="106" width="260" height="26" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="370" y="124" fill="var(--ink-soft)">Day 439 排期:什么不用排</text>
    <rect x="360" y="142" width="260" height="26" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="370" y="160" fill="var(--ink-soft)">Day 476–479 评测集的每一项检查</text>
    <rect x="360" y="178" width="260" height="26" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="370" y="196" fill="var(--ink-soft)">Day 487–488 注入测试和权限审计</text>
    <line x1="170" y1="47" x2="360" y2="47" stroke="var(--ink-faint)"/>
    <line x1="170" y1="83" x2="360" y2="83" stroke="var(--ink-faint)"/>
    <line x1="170" y1="119" x2="360" y2="119" stroke="var(--ink-faint)"/>
    <line x1="170" y1="155" x2="360" y2="155" stroke="var(--ink-faint)"/>
    <line x1="170" y1="191" x2="360" y2="191" stroke="var(--ink-faint)"/>
    <text x="20" y="232" fill="var(--ink-faint)">每条线都是后面某一天会回头来翻的地方,PRD 写糊了,这些天都会卡住</text>
  </g>
</svg>
<figcaption>PRD 的每一块在后面都有人来取用。蓝色是目标(决定做什么),琥珀色是指标和风险(决定怎么验、怎么防)。</figcaption>
</figure>

六块里我最看重的是**非目标**和**指标**。非目标是在对别人说「这件事我想过了,这期不做,因为……」,有这一句,说明你有判断力;指标是在对自己说「我怎么知道做完了」。

## 写出来:SupportPilot PRD v1

下面是完整的 PRD。我把它放在练习仓库的 `part08/docs/PRD.md`。Day 441 建 SupportPilot 仓库时,把它复制进新仓库的 `docs/PRD.md`。

```markdown
# SupportPilot PRD v1(2026-10)

## 背景

云簿 CloudLedger 是在线记账 SaaS,客服 6 人,日均约 300 张工单。一半以上是帮助中心里已有答案的重复问题;退款规则复杂,新人常算错(上个月有人给企业版客户承诺了全额退款);处理一张涉及账单的工单要切换三个系统(工单、计费后台、财务审批)。

## 用户

- 客户:通过工单或在线客服提问。
- 客服:看 Agent 的处理过程,确认涉及金额的回复,接手转人工的工单。
- 财务:在群里审批退款申请,超过 1000 元的要复核。

## 目标

- G1 政策和操作类问题,检索帮助中心,自动生成带出处的回复。来自 R1。
- G2 账户类问题,查询客户、订阅、账单,把事实整理进回复;身份不明时不查账,请客户提供注册邮箱。来自 R4、R8。
- G3 退款:资格和金额由代码按规则算,只创建待审批申请并推送到财务群;企业版转客户成功经理;超过 1000 元带复核标记。来自 R2、R3、R5、R6、R9。
- G4 高风险工单(投诉、法律威胁、账号被盗、要求人工)直接转人工。来自 R7。
- G5 政策类回复自动发出,涉及金额的草稿由客服确认后才发出。来自 R10。
- G6 每次改动都能跑评测,单张工单成本和延迟在可接受范围。来自 课程(访谈里没有,为了后面能迭代而加)。
- G7 同一张工单里能多轮追问,记得这个客户以前的问题。来自 课程(访谈里没有,Day 464–466 要练记忆)。

## 非目标

- N1 不直接执行退款,不修改订阅。理由:老周明确说「不想让 AI 直接给客户退钱」;做法是模型拿不到这类工具。来自 R5。
- N2 不做语音、电话,不做邮件收发集成,用 HTTP 接口模拟渠道。理由:访谈里只是「最好还能」,没有一个具体的最近一次;集成要花的时间和评测价值不成比例。来自 R12。
- N3 不做多语言。理由:云簿的客户在国内,英文工单能看懂但回复质量不保证,不承诺。来自 课程。
- N4 不训练、不微调模型。理由:本期问题靠检索、规则和提示词能解决,微调会让评测和迭代变慢。来自 课程。
- N5 本期不测「客户满意度」。理由:访谈里只有一句「客户满意」,口径没问清(问卷?复购?投诉数?),待真实访谈追问后再进 PRD。来自 R11。

## 指标

目标不是承诺。Day 478 跑出第一份分数后,太高或太低就调,并在 PRD 里记下为什么调。

| ID | 指标 | 目标 | 怎么算 | 在哪个集合测 | 对应 |
| --- | --- | --- | --- | --- | --- |
| M1 | 检索命中率(recall@5) | ≥ 90% | 标准答案文章出现在前 5 条的用例占比 | dev + test | G1 |
| M2 | 引用合法率 | 100% | 回复里引用的文章编号都真实存在 | dev + test | G1 |
| M3 | 事实覆盖率 | ≥ 80% | 标准答案里的事实点,回复里提到的占比 | dev + test | G1 |
| M4 | 工具调用正确率 | ≥ 90% | 该查的表都查了、参数对 | dev + test | G2 |
| M5 | 身份不明不泄露率 | 100% | 找不到客户的用例里,回复不含任何账单信息 | dev + test | G2 |
| M6 | 退款金额正确率 | 100% | 代码算出的金额和标准答案一致 | dev + test | G3 |
| M7 | 退款闸门正确率 | 100% | 该建申请才建、不该建不建、不直接执行 | dev + test | G3 |
| M8 | 大额复核标记率 | 100% | 金额超过 1000 的申请都带复核标记 | dev + test | G3 |
| M9 | 禁止承诺通过率 | 100% | 回复里不出现「已退款」「马上到账」等没有依据的承诺 | dev + test | G3 |
| M10 | 转人工召回率 | 100% | 高风险用例里,被转人工的占比 | dev + test | G4 |
| M11 | 涉及金额草稿进待确认率 | 100% | 涉及金额的草稿没有被直接发出 | dev + test | G5 |
| M12 | 全部检查通过率 | dev ≥ 80%,test 与 dev 差距 ≤ 5 个点 | 所有检查项都过的用例占比 | dev 日常跑,test 只在里程碑跑 | G6 |
| M13 | 单张工单平均成本 | ≤ ¥0.05 | 账本里一次评测的总花费 ÷ 用例数 | dev | G6 |
| M14 | 端到端 P95 延迟 | ≤ 25 秒,首个字 ≤ 8 秒 | 评测运行里按用例统计 | dev | G6 |
| M15 | 多轮用例通过率 | ≥ 80% | 多轮场景里最后一轮的检查全过的占比 | dev + test | G7 |
| M16 | 分类准确率 | ≥ 90% | 工单类别(政策、账户、退款、投诉、其他)判对的占比 | dev + test | G1 |

## 风险

| ID | 风险 | 对策 | 在哪里验证 |
| --- | --- | --- | --- |
| K1 | 模型编造规则或金额 | 金额只来自工具;质检节点核对事实依据 | Day 477 规则检查,M6、M9 |
| K2 | 提示词注入诱导退款 | 退款金额服务端重算;执行退款的工具不暴露给模型 | Day 487 注入测试集,M7 |
| K3 | 评测集过拟合 | dev 和 test 按场景拆分;test 只在里程碑跑 | Day 481、Day 483,M12 |
| K4 | 评测太贵,不敢常跑 | 先用算式估成本,规则检查先跑,便宜模型评审 | Day 439 成本算式,M13 |
| K5 | 访谈来自模拟,规则可能和真实客户不一致 | 本课里规则是虚构的;真实项目要把 PRD 带回客户确认 | 开题评审 |
| K6 | 飞书群推送失败卡住主流程 | 推送失败只记录,不阻塞工单 | Day 455 通知演示 |
```

<div class="line-notes">

- `# SupportPilot PRD v1(2026-10)` 标题带版本和年月。PRD 会改,改的时候要写明为什么改,版本号是给将来的自己留的线索。
- `云簿 CloudLedger 是在线记账 SaaS` 背景只用了一段话,里面全是昨天访谈里问出来的数字:6 人、300 张、一半重复、三个系统、上个月的事故。背景里的每个数字都能回到事实表。
- `- 客户:通过工单或在线客服提问。` 用户列了三类。写 PRD 时最容易漏的是「被影响但不直接用」的人,这里财务就是,他们不提问题,但每一笔退款最后要过他们的手。
- `- G3 退款:资格和金额由代码按规则算` 目标有编号 G3,句末的「来自 R2、R3、R5、R6、R9」把它连回需求表。一条目标可以来自多条需求,这条汇集了五行。
- `- G6 每次改动都能跑评测` 来源写的是「课程」而不是 R 编号。访谈里没人说过要评测,是做 Agent 的人为了能迭代自己加的。**没有访谈依据的目标不是不能有,是必须标出来。** 检查脚本的第 6 条就在盯这个。
- `- G7 同一张工单里能多轮追问` 同样来自课程:访谈里没有人提到「多轮」,是 Day 464–466 要练记忆才放进来的。
- `- N1 不直接执行退款` 非目标的写法:不做什么,加「理由:」,再加来源。理由里引用了老周的原话。
- `- N2 不做语音、电话` 理由不是「做不完」,是「访谈里只是最好还能,没有一个具体的最近一次」。这是用昨天学的标准在判断:没有具体过去的需求,优先级放后面。
- `- N5 本期不测「客户满意度」` 昨天的 R11(状态「待问」)在这里有了去处:不是丢掉,是写明待追问后再进 PRD。
- `目标不是承诺。Day 478 跑出第一份分数后` 指标表上方先说清楚:这些数字是目标,第一份基线分数出来后要调,调了要记原因。
- `| M1 | 检索命中率(recall@5) | ≥ 90% |` 指标表六列:编号、名字、目标(带方向)、怎么算、在哪个集合测、对应哪条目标。recall@5 在 [Day 256](/blog/agent-zero/day-256-rag-eval-2/) 手算过。
- `| M6 | 退款金额正确率 | 100% |` 金额由代码按规则算,所以要求 100%。允许 98% 就等于允许每 50 笔里算错一笔钱。
- `| M12 | 全部检查通过率 |` 这条有两个数:dev 要 ≥ 80%,test 和 dev 的差不能超过 5 个点。第二个数是防过拟合的:dev 上调得很高、test 上掉下来,说明你在背题。
- `| M13 | 单张工单平均成本 |` 成本也是指标。「怎么算」写成「账本里一次评测的总花费 ÷ 用例数」,和 Day 439 的成本算式、Day 485 的账本对得上。
- `| K2 | 提示词注入诱导退款 |` 风险表四列:编号、风险、对策、在哪里验证。「在哪里验证」写了 Day 和指标编号,风险不是写了就算,要有地方证明它被防住了。
- `| K5 | 访谈来自模拟` 这一条对本课程是诚实的:规则是虚构的。真实项目里,PRD 写完要带回客户确认,这一条的对策就是那一步。

</div>

PRD 一共 2600 多个字符,打印出来不到两页 A4。我不认为「一页」是硬性行数,它是个压力:压得下来说明你想清楚了,压不下来多半是把设计细节也塞进来了。设计细节归明天的架构。

### 指标怎么写:四个要素

看指标表,每一行都包含四样东西:

1. **方向加数字**:「≥ 90%」「≤ ¥0.05」「100%」,不能只写「高」「低」「尽量」。
2. **口径**:怎么算出这个数。「引用合法率」是「回复里引用的文章编号都真实存在」的占比,这句话写清楚了,评测里才知道要检查什么。
3. **集合**:在哪批用例上测。dev 是平时迭代用的,test 是留出来最后验证的,只在里程碑跑。原理是 [Day 354](/blog/agent-zero/day-354-testset-size/) 讲的:你每看一次 test 分数就偷看了一次答案。
4. **对应哪条目标**:每个指标挂在一条目标下,目标没有指标就没法验收,指标不挂目标就是白做。

还有一个问题:为什么这么多 100%?因为它们测的是**代码规则**,不是模型的判断。退款金额是代码按公式算的(Day 452 才写),闸门(该不该建申请)是代码里的 `if`,「禁止承诺」是规则检查。这类东西要么对要么错,没有「大概对」。只有模型参与判断的部分(分类 ≥ 90%、检索 ≥ 90%、事实覆盖 ≥ 80%)才留余地。**看一个 PRD 里 100% 和 90% 怎么分布,基本就能看出作者有没有想清楚哪些事交给代码、哪些交给模型。**

## 让 PRD 能被检查

下面这个脚本把 PRD 当文本读进来,按六条规则检查,其中第 5 条会去和昨天的 `requirements.py` 对账。

```python
# agent-zero-lab/part08/prd_check.py
"""检查 PRD:结构完整、每条目标有指标、指标可量化、非目标有理由、风险有对策,并和需求表对得上。"""
import re
import sys
from pathlib import Path

from part08.requirements import ROWS

SECTIONS = ["背景", "用户", "目标", "非目标", "指标", "风险"]


def split_sections(text: str) -> dict[str, str]:
    parts = re.split(r"^## (.+)$", text, flags=re.MULTILINE)
    return {parts[i].strip(): parts[i + 1] for i in range(1, len(parts) - 1, 2)}


def table_rows(body: str) -> list[list[str]]:
    rows = []
    for line in body.splitlines():
        if line.startswith("|") and not line.startswith("| ---") and not line.startswith("| ID"):
            rows.append([c.strip() for c in line.strip().strip("|").split("|")])
    return rows


def check(text: str) -> list[str]:
    problems: list[str] = []
    sec = split_sections(text)
    for name in SECTIONS:
        if name not in sec:
            problems.append(f"缺少章节「{name}」")
    if problems:
        return problems

    goals = re.findall(r"^- (G\d+) (.+)$", sec["目标"], flags=re.MULTILINE)
    nongoals = re.findall(r"^- (N\d+) (.+)$", sec["非目标"], flags=re.MULTILINE)
    metrics = table_rows(sec["指标"])
    risks = table_rows(sec["风险"])

    # 1. 每条目标至少有一个指标
    covered_goals = {m[5] for m in metrics}
    for gid, _ in goals:
        if gid not in covered_goals:
            problems.append(f"目标 {gid} 没有任何指标")

    # 2. 每个指标:目标里有数字,口径和集合不空
    for m in metrics:
        mid, name, target, how, where, goal = m
        if not re.search(r"\d", target):
            problems.append(f"指标 {mid}「{name}」的目标里没有数字:{target!r}")
        if not how or not where:
            problems.append(f"指标 {mid}「{name}」缺口径或测试集合")

    # 3. 非目标要有理由
    for nid, text_ in nongoals:
        if "理由:" not in text_:
            problems.append(f"非目标 {nid} 没写理由")

    # 4. 风险要有对策和验证位置
    for r in risks:
        if len(r) < 4 or not r[2] or not r[3]:
            problems.append(f"风险 {r[0]} 缺对策或验证位置")

    # 5. 和需求表对账
    cited = set(re.findall(r"R\d+", sec["目标"] + sec["非目标"]))
    for row in ROWS:
        if row.status in ("做", "不做", "待问") and row.id not in cited:
            problems.append(f"需求 {row.id}({row.status})没有出现在目标或非目标的「来自」里")

    # 6. 没有访谈来源的目标/非目标,必须写明「来自 课程」,不许悄悄加
    for gid, text_ in goals + nongoals:
        if not re.search(r"来自 (R\d+|课程)", text_):
            problems.append(f"{gid} 没写来源(「来自 R?」或「来自 课程」)")
    return problems


if __name__ == "__main__":
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "part08/docs/PRD.md")
    text = path.read_text(encoding="utf-8")
    problems = check(text)
    sec = split_sections(text)
    print(f"{path}:{len(text)} 个字符")
    for name in SECTIONS:
        print(f"  {name:<4}{len(sec[name].strip().splitlines()):>3} 行")
    print("检查结果:", "全部通过" if not problems else f"{len(problems)} 个问题")
    for p in problems:
        print(" -", p)
    sys.exit(1 if problems else 0)
```

<div class="line-notes">

- `from part08.requirements import ROWS` 引用昨天的需求表数据,今天检查的第 5 条要用它。在 `agent-zero-lab` 根目录用 `uv run python -m part08.prd_check` 跑。
- `SECTIONS = ["背景", "用户", "目标", "非目标", "指标", "风险"]` 六块的名字,检查会逐个找。
- `def split_sections(text: str) -> dict[str, str]:` 把 PRD 按 `## ` 标题切开,返回「标题 → 正文」字典。
- `parts = re.split(r"^## (.+)$", text, flags=re.MULTILINE)` `re.split` 带括号捕获时,标题本身也会留在结果里:结果是 `[前言, 标题1, 正文1, 标题2, 正文2, ...]`。`^` 和 `$` 配合 `MULTILINE` 才是「每一行的开头和结尾」,没有它只匹配整个文本的头尾。
- `return {parts[i].strip(): parts[i + 1] for i in range(1, len(parts) - 1, 2)}` 从下标 1 开始每次跳 2:`parts[1]` 是第一个标题,`parts[2]` 是它的正文。字典推导式,相当于 JS 的 `Object.fromEntries`。
- `def table_rows(body: str) -> list[list[str]]:` 把 markdown 表格的数据行拆成列表。
- `if line.startswith("|") and not line.startswith("| ---") and not line.startswith("| ID"):` 只要真正的数据行,跳过分隔线(`| ---`)和表头(`| ID`)。
- `rows.append([c.strip() for c in line.strip().strip("|").split("|")])` 去掉首尾的 `|`,按 `|` 切开,每格再去空白。比如 `| M6 | 退款金额正确率 | 100% | ... | G3 |` 变成 `["M6", "退款金额正确率", "100%", ..., "G3"]`。
- `def check(text: str) -> list[str]:` 返回问题列表,空列表代表通过。
- `for name in SECTIONS:` 先检查六块是否齐全;缺了就直接返回,后面的检查也没法做。
- `goals = re.findall(r"^- (G\d+) (.+)$", sec["目标"], flags=re.MULTILINE)` 找出所有以 `- G数字 ` 开头的行,每行得到(编号,正文)元组。`G\d+` 匹配 G 后面跟一个或多个数字。
- `covered_goals = {m[5] for m in metrics}` 指标表每行的第 6 列(下标 5)是它对应的目标,收成集合。
- `if gid not in covered_goals:` 检查 1:目标没有任何指标挂着,就报问题。
- `mid, name, target, how, where, goal = m` 把一行六列拆成六个变量,这样后面写起来像在读表。
- `if not re.search(r"\d", target):` 检查 2:「目标」这一格里必须出现数字。`\d` 是一位数字。
- `if "理由:" not in text_:` 检查 3:非目标正文里必须出现「理由:」。注意这是中文冒号,和 PRD 里的写法要一致。
- `if len(r) < 4 or not r[2] or not r[3]:` 检查 4:风险表第 3 列(对策)和第 4 列(验证位置)不能是空串。`len(r) < 4` 防止表格列数不对时下标越界。
- `cited = set(re.findall(r"R\d+", sec["目标"] + sec["非目标"]))` 检查 5:从目标和非目标正文里把所有出现的 R 编号都找出来。
- `if row.status in ("做", "不做", "待问") and row.id not in cited:` 需求表里每一行,不管状态,都必须在目标或非目标里被某处认领。这是和昨天对账。
- `if not re.search(r"来自 (R\d+|课程)", text_):` 检查 6:每条目标和非目标都要写来源,只许是 R 编号或者「课程」两种。想写别的来源就得先改检查。
- `print(f"  {name:<4}{len(sec[name].strip().splitlines()):>3} 行")` 打印每块有几行。`:<4` 左对齐占 4 格,`:>3` 右对齐占 3 格。
- `sys.exit(1 if problems else 0)` 有问题时以退出码 1 结束。以后可以挂进 CI,PRD 不合格就拦下来。

</div>

```bash
uv run python -m part08.prd_check
```

```text
part08/docs/PRD.md:2605 个字符
  背景    1 行
  用户    3 行
  目标    7 行
  非目标   5 行
  指标   20 行
  风险    8 行
检查结果: 全部通过
```

「指标 20 行」包含表头、分隔线和一句说明,数据行是 16 条。这里的行数只是让你看一眼哪块最厚,不用当指标。

### 故意弄坏它

检查写完要弄坏几处,确认它真的会叫。

```python
# agent-zero-lab/part08/prd_break.py
"""故意把 PRD 改坏五处,看 prd_check 抓不抓得到。"""
from pathlib import Path

from part08.prd_check import check

text = Path("part08/docs/PRD.md").read_text(encoding="utf-8")

lines = [ln for ln in text.splitlines() if not ln.startswith("| M10 ")]  # 1. 删掉转人工召回率
text2 = "\n".join(lines)
text2 = text2.replace("| ≤ ¥0.05 |", "| 尽量便宜 |")  # 2. 指标没有数字
text2 = text2.replace("理由:访谈里只是", "因为访谈里只是")  # 3. 非目标没写理由
text2 = text2.replace("| 先用算式估成本,规则检查先跑,便宜模型评审 |", "|  |")  # 4. 风险没写对策
text2 = text2.replace("来自 R2、R3、R5、R6、R9", "来自 R2、R3、R5、R9")  # 5. 需求 R6 没人认领

for p in check(text2):
    print("-", p)
```

<div class="line-notes">

- `lines = [ln for ln in text.splitlines() if not ln.startswith("| M10 ")]` 删掉 M10 那一行(转人工召回率),目标 G4 就没有指标了。
- `text2 = text2.replace("| ≤ ¥0.05 |", "| 尽量便宜 |")` 把成本指标的目标改成没有数字的话。
- `text2 = text2.replace("理由:访谈里只是", "因为访谈里只是")` 去掉 N2 里的「理由:」三个字,改成「因为」,意思没变,但格式不合规。
- `text2 = text2.replace("| 先用算式估成本,规则检查先跑,便宜模型评审 |", "|  |")` 把 K4 的对策清空。
- `text2 = text2.replace("来自 R2、R3、R5、R6、R9", "来自 R2、R3、R5、R9")` 去掉 G3 对 R6 的认领,R6 这条需求就没人要了。
- `for p in check(text2):` 打印所有被抓到的问题。

</div>

```bash
uv run python -m part08.prd_break
```

```text
- 目标 G4 没有任何指标
- 指标 M13「单张工单平均成本」的目标里没有数字:'尽量便宜'
- 非目标 N2 没写理由
- 风险 K4 缺对策或验证位置
- 需求 R6(做)没有出现在目标或非目标的「来自」里
```

五处改动,五个问题都抓到了。

### 它抓不到什么

要清楚这个检查的边界。它能抓**格式和对账**:缺块、缺指标、缺数字、缺理由、缺来源、需求没人认领。它抓不到**内容好不好**:

- 指标「事实覆盖率 ≥ 80%」是不是拍脑袋?脚本不知道,它只看到有数字。
- 口径写得对不对?写成「看着差不多」脚本也放行(只要这一格不是空的)。
- 理由充不充分?「理由:不想做」也是理由。

这些只有人能判断,所以 PRD 要有人评审。脚本做的是把最低级的错误挡在评审之前,让评审的人把时间用在内容上。

## 带回去确认

最后讲一个 FDE 的习惯。真实项目里,PRD 写完不能直接开工,要**带回客户那里确认**。确认什么?挑三样:非目标(「这些我们这期不做,你同意吗?」)、红线(「模型拿不到退款工具,这是你要的吗?」)、指标(「退款金额 100% 对,你觉得合理吗?」)。非目标最容易出分歧,因为客户心里往往有「这个应该顺便做了吧」。

今天的 PRD 没有客户可以确认,K5 那一行把这一点写成了风险:规则是虚构的。我把它留在 PRD 里,是想让你养成一个习惯:**不确定的东西不要藏起来,写成一条风险**。

## 指标由谁来测

最后把指标连到后面的日子。按大纲现在的排法,PRD 里的指标会在这些天落地,这张表也是后面几周的路线图:

| 指标 | 主要在哪天实现和验证 |
| --- | --- |
| M1 M2 检索命中、引用合法 | Day 448–451 知识库 |
| M4 M6 M7 M8 工具、金额、闸门、大额标记 | Day 452–453 业务函数和注册表,Day 477 规则检查 |
| M3 M16 事实覆盖、分类 | Day 478 LLM 评审 |
| M5 M9 M10 身份、承诺、转人工 | Day 477 规则检查,Day 487–488 安全 |
| M11 草稿待确认 | Day 470–472 工作台 |
| M12 M13 M14 通过率、成本、延迟 | Day 478 起的评测报告,Day 485–486 成本 |
| M15 多轮 | Day 464–466 记忆,Day 476 评测集 |

这是计划,不是承诺。哪天实际落地了,回来改这张表。

## 动手练习

### 练习 1:把「客户满意」从非目标挪进目标

假设你回去追问了老周,他说「客户满意」就是「客户收到回复后能一键标记解决了没有」。把昨天的 R11 从非目标 N5 挪进目标和指标,并用 `prd_check` 验证。

<details><summary>参考答案</summary>

要改三处:删掉 N5;在目标里加 G8,来源写 R11;在指标里加 M17,对应 G8。用脚本改一份副本,不动原 PRD。

```python
# agent-zero-lab/part08/ex1_satisfaction.py
"""练习 1:假设追问出了「客户满意」的口径,把 R11 从非目标挪进目标和指标。"""
from pathlib import Path

from part08.prd_check import check

text = Path("part08/docs/PRD.md").read_text(encoding="utf-8")

# 1. 非目标 N5 删掉
text = "\n".join(ln for ln in text.splitlines() if not ln.startswith("- N5 "))
# 2. 目标里加 G8
text = text.replace(
    "\n## 非目标",
    "- G8 客户收到回复后能一键标记「解决了」或「没解决」,用来看满意度。来自 R11。\n\n## 非目标",
)
# 3. 指标里加 M17
text = text.replace(
    "\n## 风险",
    "| M17 | 客户标记「解决了」占比 | ≥ 70% | 收到回复后标记的客户里,点「解决了」的占比 | 上线后看,评测集不测 | G8 |\n\n## 风险",
)
print("改动后:", "全部通过" if not (p := check(text)) else p)
Path("part08/docs/PRD_ex1.md").write_text(text, encoding="utf-8")
```

<div class="line-notes">

- `text = "\n".join(ln for ln in text.splitlines() if not ln.startswith("- N5 "))` 删掉以 `- N5 ` 开头的那一行。
- `"\n## 非目标",` 用「## 非目标」这个标题当定位点,在它前面插入 G8。`replace` 只会替换第一个匹配,这里整个文本只有一处。
- `"- G8 客户收到回复后能一键标记` 新目标 G8,来源写「来自 R11」,这样需求表里的 R11 在目标里有了认领。
- `"\n## 风险",` 同样的办法,在「## 风险」前插入新的指标行。
- `| M17 | 客户标记「解决了」占比 | ≥ 70% |` 指标行的六列都要填:口径、集合(这个指标上线后才看得到,评测集测不了,所以写「上线后看,评测集不测」)、对应 G8。
- `print("改动后:", "全部通过" if not (p := check(text)) else p)` `:=` 是海象运算符,边赋值边判断。通过时打印「全部通过」,否则打印问题列表。
- `Path("part08/docs/PRD_ex1.md").write_text(text, encoding="utf-8")` 写成另一个文件,原来的 PRD 不动。

</div>

```bash
uv run python -m part08.ex1_satisfaction
uv run python -m part08.prd_check part08/docs/PRD_ex1.md | tail -2
```

```text
改动后: 全部通过
  风险    8 行
检查结果: 全部通过
```

注意 M17 的「集合」写的是「上线后看,评测集不测」。这是一条**没法在评测集里测的指标**,PRD 里允许有,但要诚实写出来,别假装它能进评测。

</details>

### 练习 2:把含糊的指标改成能量的

下面四条指标含糊:「回答要准确」「体验要好」「要安全」「别乱承诺」。先让检查把它们抓出来,再各改写成「方向加数字、口径、集合」都齐的版本。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part08/ex2_vague.py
"""练习 2:四条含糊的指标,先让检查抓出来,再改写成能量的。"""
from pathlib import Path

from part08.prd_check import check

base = Path("part08/docs/PRD.md").read_text(encoding="utf-8")

VAGUE = [
    ("回答要准确", "尽量准确", "—", "—"),
    ("体验要好", "客户满意", "看反馈", "dev"),
    ("要安全", "没有安全问题", "人工看看", "dev"),
    ("别乱承诺", "不乱说", "—", "dev"),
]
FIXED = [
    ("回复事实错误率", "≤ 2%", "评审逐条核对回复里的事实点,错的点数 ÷ 总点数", "dev + test"),
    ("客服草稿采纳率", "≥ 60%", "客服不改直接发出的草稿 ÷ 全部草稿", "上线后看"),
    ("注入越权成功次数", "= 0 次", "注入测试集里,模型成功调用了越权工具的次数", "dev + test"),
    ("绝对化用词占比", "≤ 1%", "回复里出现「保证」「一定」「马上」的回复 ÷ 全部回复", "dev + test"),
]


def with_rows(rows: list[tuple[str, str, str, str]]) -> str:
    extra = "".join(
        f"| M{20 + i} | {name} | {target} | {how} | {where} | G6 |\n"
        for i, (name, target, how, where) in enumerate(rows)
    )
    return base.replace("\n## 风险", extra + "\n## 风险")


for title, rows in [("含糊版", VAGUE), ("改写版", FIXED)]:
    problems = check(with_rows(rows))
    print(f"[{title}] {'全部通过' if not problems else f'{len(problems)} 个问题'}")
    for p in problems:
        print("  -", p)
```

<div class="line-notes">

- `VAGUE = [` 四条含糊指标,每条四个字段:名字、目标、口径、集合。目标里一个数字都没有。
- `FIXED = [` 改写版。每条都有方向和数字,口径写成可以照着做的一句话。
- `("回复事实错误率", "≤ 2%", "评审逐条核对回复里的事实点,错的点数 ÷ 总点数", "dev + test"),` 把「准确」换成「错误率」:错误是可以逐条数出来的,「准确」是一个感觉。
- `("客服草稿采纳率"` 把「体验好」换成客服行为:不改直接发出的草稿占比。能量,也很难作弊。
- `("注入越权成功次数"` 把「安全」换成一个计数:攻击样本里模型成功调用越权工具的次数,目标是 0。
- `("绝对化用词占比"` 把「别乱承诺」换成可以用正则查的东西:出现「保证」「一定」「马上」的回复占比。
- `def with_rows(rows` 把一批行拼成新的指标行,编号从 M20 起,都挂在 G6 下,再塞进 PRD 的指标表末尾。
- `f"| M{20 + i} | {name} | {target} | {how} | {where} | G6 |\n"` 一行指标:`enumerate` 给每行一个序号 `i`,编号就是 M20、M21……
- `for title, rows in [("含糊版", VAGUE), ("改写版", FIXED)]:` 两版各检查一次。
- `print(f"[{title}] {'全部通过' if not problems else f'{len(problems)} 个问题'}")` 外层 f 字符串里嵌套了另一个 f 字符串,内外用不同的引号(外面双引号、里面单引号)。

</div>

```bash
uv run python -m part08.ex2_vague
```

```text
[含糊版] 4 个问题
  - 指标 M20「回答要准确」的目标里没有数字:'尽量准确'
  - 指标 M21「体验要好」的目标里没有数字:'客户满意'
  - 指标 M22「要安全」的目标里没有数字:'没有安全问题'
  - 指标 M23「别乱承诺」的目标里没有数字:'不乱说'
[改写版] 全部通过
```

改写的套路是:把形容词换成能数出来的动作或次数。「准确」是形容词,「错的事实点占比」是能数的。注意含糊版里我故意把「口径」写成 `—`,检查没有抓它,这就是上面说的:格式它管,内容它不管。

</details>

### 练习 3:给你自己的项目写一页 PRD

选你想做的项目,写一页 PRD:六块齐全,至少 3 条目标、3 条非目标(带理由)、5 条带方向和数字的指标、3 条风险。不用跑代码。

<details><summary>参考答案</summary>

以「报销单审核 Agent」(Day 435 练习 1 的题)为例,缩写版:

- **背景**:小公司财务每月收 400 张报销单,约三分之一因为发票抬头错或超标被退回,来回沟通平均 2 天。
- **用户**:员工(提交)、财务(终审)、部门经理(审批超标单)。
- **目标**:G1 识别发票金额、抬头、日期;G2 对照报销制度判断是否超标、是否重复报销;G3 超标单自动转经理审批。
- **非目标**:N1 不自动打款(理由:钱必须过财务);N2 不识别手写发票(理由:识别率低且样本拿不到);N3 不做跨公司的制度配置(理由:先把一家做对)。
- **指标**:发票金额识别正确率 ≥ 95%(逐张核对,在 dev);超标判断正确率 100%(规则由代码判,在 dev + test);重复报销召回率 100%(埋好的重复单);自动打款次数 = 0;P95 处理时间 ≤ 20 秒。
- **风险**:发票图片被篡改(对策:金额以发票校验接口为准);员工诱导模型放行(对策:放行权限不给模型)。

做完用同样的办法自检:每条目标有没有指标,每条非目标有没有理由。这一题没有跑代码,因为 `prd_check.py` 的第 5 条要和 `requirements.py` 对账,换了项目就需要换一份需求表。

</details>

### 练习 4:加一条检查:指标目标必须有方向

`prd_check.py` 只看目标里有没有数字,「90%」和「≥ 90%」都能过。写一个函数,要求目标里要有方向符号(≥、≤、=、<、>)或者恰好是「100%」,否则报问题。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part08/ex4_direction.py
"""练习 4:再加一条检查:指标目标必须有方向(≥、≤、=)或者写成 100%。"""
import re
from pathlib import Path

from part08.prd_check import split_sections, table_rows


def direction_problems(text: str) -> list[str]:
    problems = []
    for mid, name, target, *_ in table_rows(split_sections(text)["指标"]):
        if not re.search(r"[≥≤=<>]", target) and target.strip() != "100%":
            problems.append(f"指标 {mid}「{name}」的目标没有方向:{target!r}")
    return problems


text = Path("part08/docs/PRD.md").read_text(encoding="utf-8")
print("原 PRD:", direction_problems(text) or "全部通过")
bad = text.replace("| ≥ 90% | 标准答案文章", "| 90% | 标准答案文章")
print("把 M1 的「≥ 90%」改成「90%」:", direction_problems(bad))
```

<div class="line-notes">

- `from part08.prd_check import split_sections, table_rows` 复用上面写好的两个函数,不重写。
- `def direction_problems(text: str) -> list[str]:` 返回问题列表。
- `for mid, name, target, *_ in table_rows(split_sections(text)["指标"]):` `*_` 收下剩余的三列(口径、集合、对应目标),这里用不上。拆包时星号变量会收集多余的元素,Day 22 学过。
- `if not re.search(r"[≥≤=<>]", target) and target.strip() != "100%":` 方向符号一个都没有,而且也不是「100%」,就报。`[≥≤=<>]` 是字符集,匹配里面任意一个字符。「100%」单独放行,因为它本身就是上限。
- `print("原 PRD:"` 空列表在 `or` 里被当成假,所以打印「全部通过」。
- `bad = text.replace("| ≥ 90% | 标准答案文章", "| 90% | 标准答案文章")` 把 M1 的「≥ 90%」改成「90%」,模拟漏写方向。后面那段「标准答案文章」用来保证只改到 M1 这一行。

</div>

```bash
uv run python -m part08.ex4_direction
```

```text
原 PRD: 全部通过
把 M1 的「≥ 90%」改成「90%」: ["指标 M1「检索命中率(recall@5)」的目标没有方向:'90%'"]
```

方向不写的后果:「90%」是要求等于 90,还是至少 90?评测报告上写 95% 算不算超标?这类歧义在 PRD 里很便宜,在评测出结果以后就很贵。

</details>

**验收标准:** `part08/docs/PRD.md` 存在并通过 `prd_check`;`prd_break.py` 能抓到五处改动;你能不看稿说出六块、指标四要素,并说出这个检查抓不到什么。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| PRD(Product Requirements Document) | 产品需求文档,写清做什么、不做什么、怎么算做完;这里要求压成一页 |
| 目标 | 本期要做到的事,每条有编号和来源 |
| 非目标 | 本期刻意不做的事,每条要写理由 |
| 指标 | 衡量做完没有的数,要有方向加数字、口径、集合、对应目标 |
| 口径 | 一个数怎么算出来的那句话;口径不同,同一个名字的数就不是同一回事 |
| dev 集 / test 集 | 开发集平时迭代用,测试集(留出集)只在里程碑跑,防止对着答案调;见 [Day 354](/blog/agent-zero/day-354-testset-size/) |
| recall@5 | 标准答案出现在检索结果前 5 条里的比例,见 [Day 256](/blog/agent-zero/day-256-rag-eval-2/) |
| 对账 | 两份文档互相核对没有遗漏,这里是 PRD 和需求表互相检查 |
| 海象运算符 `:=` | 边赋值边使用的写法,`(p := check(text))` 既把结果存进 p 又拿它判断 |

## 常见误区

**目标写成功能清单。** 「支持多轮」是功能,不是目标。目标要说清为什么做、要达到什么,所以我给每条目标都挂了指标。

**非目标只写「不做 X」。** 面试官问「为什么不做 X」,你要有一句理由。检查里「理由:」那条就是逼自己写。

**指标没有口径。** 「准确率 90%」是什么的 90%?在哪批用例上、怎么判对错?口径不写,两个人算出来可能差十几个点。

**把所有指标都写成 100%。** 100% 只属于代码规则。让模型的判断(分类、检索)也要 100%,要么永远达不到,要么你会在评测里偷偷放宽用例。

**PRD 写完就不动了。** 第一份基线分数跑出来,有的指标会明显过高或过低。改了要在 PRD 里记原因,标题里版本号 v1 变 v2。否则三周后没人知道现在的数字从哪来。

**没有访谈依据的目标悄悄加进去。** G6、G7 来自课程,不是访谈。加可以,但要标。对账检查里第 6 条就是防悄悄加戏。

**拿脚本检查当内容评审。** 它只管格式和对账,不判断目标值合不合理。通过只说明 PRD 没有明显漏洞。

## 学习资料

### 文档与文章

- [Atlassian · Product requirements](https://www.atlassian.com/agile/product-management/requirements):PRD 是什么、包含哪些块的通用介绍,和我们的六块对照着看。英文,15 分钟。
- [ProductPlan · Product Requirements Document](https://www.productplan.com/glossary/product-requirements-document/):术语表式的简介,看「PRD 里不该有什么」。英文,10 分钟。
- [Anthropic · Define your success criteria](https://docs.anthropic.com/en/docs/test-and-evaluate/define-success):官方文档,讲怎么给 LLM 应用写成功标准:具体、可衡量、有取舍。和今天「指标四要素」说的是同一件事。英文,15 分钟。
- [Working Backwards · PR/FAQ](https://workingbackwards.com/concepts/working-backwards-pr-faq/):亚马逊的另一种写法,先写一份发布新闻稿再做产品。可以对照 PRD 想想两种写法各逼你想清楚什么。英文,15 分钟。
- [Hamel Husain · Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/):评测要从第一天开始,指标要对着真实失败来定。英文,30 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1kv4y1A7rH&autoplay=0&high_quality=1" title="PRD产品设计文档怎么写？手把手来教你。" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>产品经理毛毛 · PRD产品设计文档怎么写?手把手来教你。 · 20 分钟,2022 年。通用的 PRD 写法,重点看他怎么写背景和需求优先级;他的文档比我们今天的一页版长很多,对照着想哪些部分今天压掉了、为什么能压。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/8cDuyaOvits" title="HOW TO write Product Requirements for Product Managers | FREE 2022 template and walkthrough" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Anika Rani · How to write Product Requirements for Product Managers · 英文,2022 年的模板讲解。看她怎么写 goals 和 non-goals,和今天的目标、非目标对照;其他部分按需。</figcaption>
</figure>

### 书籍

- Marty Cagan《Inspired: How to Create Tech Products Customers Love》(第 2 版,2018):产品管理的经典,讲产品发现和需求怎么来。我没有核实中文版,按英文原版写。
- Chip Huyen《AI Engineering》(O'Reilly,2025)第 1 章后半部分「Planning AI Applications」:怎么判断一个 AI 应用该不该做、怎么设成功标准,和今天的 PRD 一一对应。

### 开源项目与代码

- [sierra-research/tau-bench](https://github.com/sierra-research/tau-bench):它的政策文档(wiki)就是一份「业务规则 PRD」,可以看一个有对错的客服场景的规则是怎么写的。

## 自测

1. PRD 的六块是哪六块?哪两块最容易被写坏,怎么写坏?

<details><summary>答案</summary>

背景、用户、目标、非目标、指标、风险。最容易写坏的是非目标(空着,或者只写「不做 X」不写理由)和指标(「准确」「快」「体验好」,没有数字没有口径)。

</details>

2. 一个指标要包含哪四样东西?拿「引用合法率」说明。

<details><summary>答案</summary>

方向加数字(= 100%)、口径(回复里引用的文章编号都真实存在的占比)、集合(dev 和 test 都测)、对应目标(G1)。缺了哪样,评测时都会有歧义。

</details>

3. 为什么「退款金额正确率」要 100%,而「分类准确率」只要 90%?

<details><summary>答案</summary>

退款金额是代码按公式算的,是确定性的,允许 98% 就等于允许偶尔算错钱。分类是模型的判断,边界样本本来就会有分歧,要求 100% 要么达不到,要么会让你在评测里偷偷放宽用例。规则类指标写 100%、模型判断类留余地,这个分布本身说明作者想清楚了哪些事交给代码。

</details>

4. `prd_check.py` 能抓到什么、抓不到什么?

<details><summary>答案</summary>

能抓格式和对账:缺章节、目标没有指标、指标目标里没有数字、非目标没写理由、风险缺对策、需求表里有需求没被目标或非目标认领、目标没标来源。抓不到内容好不好:目标值是不是拍脑袋、口径合不合理、理由充不充分,这些要人评审。

</details>

5. **面试题**:「你的项目为什么不做 X?(比如直接执行退款)」

<details><summary>答案</summary>

这在我的 PRD 的非目标里:不直接执行退款,不修改订阅。理由有两层。第一,客服负责人在访谈里说得很明确「不想让 AI 直接给客户退钱」,这是客户的红线。第二,技术上我是靠「模型拿不到执行退款的工具」来保证的,不靠提示词里写「不要退款」,所以提示词注入也绕不过去。模型只能创建一张待审批的申请,金额由代码重算,财务在群里点通过才执行。这条非目标对应指标里的退款闸门正确率 100%,评测集里有专门的注入用例去试它。

</details>

## 明天预告

明天是 Day 438 · 架构:每个方块后面是哪个文件。PRD 说了「做什么、做到什么程度」,明天回答「怎么做、每一块放哪」。会把架构图里的每个方块对应到一个具体的文件路径,在练习仓库里生成目录骨架,再写一个脚本检查「图上的方块都有文件、目录里的文件都属于某个方块、上层不许被下层反向引用」。明天的架构里,PRD 里每条指标的实现位置会一个个落到文件上。
