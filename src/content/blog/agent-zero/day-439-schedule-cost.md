---
title: 'Day 439 · 排期和成本估算'
description: '把昨天的方块表排成 Day 441 到 497 的日历,再让脚本检查日历自己:它一跑就抓到我定的两处顺序错误(用到的东西排在被用的东西前面)。然后讲落后时先砍哪几天、砍了会让 PRD 里哪个指标没处落地;最后先量真实的 token 比例,再用算式估一张工单、一次评测、整个后半程要花多少钱,拿 M13 的红线 ¥0.05 验一遍它是不是拍脑袋。'
pubDate: 2026-10-27
regime: none
tags: ['capstone', 'supportpilot', 'schedule', 'cost-estimation', 'tokens', 'agent-zero']
series: 'agent-zero'
day: 439
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 438](/blog/agent-zero/day-438-architecture/) 把架构图写成了一张「方块 → 文件 → 哪天建」的表,`part08/arch.py` 里 52 个方块各有天数,`check_arch.py` 会检查方块有文件、文件有归属、依赖方向没有反过来。那张表末尾留了一句话:每个方块的「哪天建」,就是后面 60 天的施工顺序,今天从这里取。

施工顺序有了,还有两个问题没回答。第一,**这个顺序本身对不对**:架构表是按「层」想出来的,日子是后来一个个填的,会不会有哪个文件被排在它要用的文件前面?第二,**要花多少钱**:[Day 437](/blog/agent-zero/day-437-prd/) 的 PRD 里写了 M13「单张工单平均成本 ≤ ¥0.05」,这条是我凭感觉写的,今天第一次拿算式去验它。

## 今天要解决的问题

今天两件事:**给排期做检查**,以及**用算式估 token 成本**。学完你应该能:

1. 把方块表按周排成日历,说出每个阶段结束时能当场演示什么。
2. 写一个脚本检查日历自己:方块不能落在复习日,文件不能排在它依赖的文件之前;并且看懂它为什么在我自己定的排期上报了两处错。
3. 落后时知道先砍哪几天,用脚本查出「砍掉这些天,PRD 里哪个指标就没地方落地了」。
4. 先量出中文、JSON、英文各自多少字符一个 token,再据此估一张工单的 token 数,换算成钱,和 M13 的 ¥0.05 对账;并且知道这种估算准到什么程度、错在哪个方向没关系。

今天只有 5 次很小的模型调用(量 token 比例,花了约 ¥0.0013),其余都是算术。预计用时 2.5 小时。前置:[Day 438](/blog/agent-zero/day-438-architecture/) 的 `part08/arch.py` 和 `check_arch.py`;[Day 437](/blog/agent-zero/day-437-prd/) 的 PRD 指标表;`common/llm.py` 里的 `LLMClient`(Day 135–137 建的);[Day 50](/blog/agent-zero/day-050-dataclass/) 的 dataclass 和 [Day 32](/blog/agent-zero/day-032-modules/) 讲的模块导入。

学法照旧:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把「排期检查的两条规则」和「成本算式的三步」默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先从前端看:你估过的工期

你大概估过这样的工期:「这个页面两天」,实际做了六天。回头看原因很少是「写代码慢」,多半是估的时候漏了东西:接口还没好、设计稿改了、那个组件要先重构、测试环境起不来。有经验的人估工期会多做一步,**不是估工作量,是列依赖**:这件事要先等哪件事。

前端里还有一个更接近今天的对照:performance budget(性能预算)。团队会规定「首屏 JS 不超过 170KB」,然后在 CI 里量,超了就红。预算先于实现存在,你不是做完才看大小。Agent 的 token 成本也是这样:先用算式估一个量级,定一条红线,开工后用账本量,对得上就继续,对不上就去查是哪一段膨胀了。

今天的两件事,一件是排期里的「列依赖」,一件是成本里的「预算」。

## 第一步:把方块表排成日历

大纲里 Day 441 到 497 是 57 天,按「六个内容日加一个复习日」的节奏走,复习日每七天一个:447、454、461……496。先画出来:

<figure>
<svg viewBox="0 0 640 362" role="img" aria-label="Day 441 到 497 的日历:每周六个内容日加一个复习日,共九周,按阶段分色">
  <g font-family="var(--font-mono)" font-size="12">
    <text x="20" y="24" fill="var(--ink)">毕业项目 Day 441–497,每行一周,每格一天</text>
    <text x="20" y="69" fill="var(--ink-soft)">第 64 周</text>
    <rect x="90" y="52" width="34" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="107" y="68" text-anchor="middle" fill="var(--ink)">441</text>
    <rect x="128" y="52" width="34" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="145" y="68" text-anchor="middle" fill="var(--ink)">442</text>
    <rect x="166" y="52" width="34" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="183" y="68" text-anchor="middle" fill="var(--ink)">443</text>
    <rect x="204" y="52" width="34" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="221" y="68" text-anchor="middle" fill="var(--ink)">444</text>
    <rect x="242" y="52" width="34" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="259" y="68" text-anchor="middle" fill="var(--ink)">445</text>
    <rect x="280" y="52" width="34" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="297" y="68" text-anchor="middle" fill="var(--ink)">446</text>
    <rect x="318" y="52" width="34" height="24" rx="3" fill="var(--paper-raised)" stroke="var(--ink-faint)" stroke-dasharray="3 2"/>
    <text x="335" y="68" text-anchor="middle" fill="var(--ink-faint)">447</text>
    <text x="372" y="68" fill="var(--ink-soft)">搭骨架</text>
    <text x="20" y="99" fill="var(--ink-soft)">第 65 周</text>
    <rect x="90" y="82" width="34" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="107" y="98" text-anchor="middle" fill="var(--ink)">448</text>
    <rect x="128" y="82" width="34" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="145" y="98" text-anchor="middle" fill="var(--ink)">449</text>
    <rect x="166" y="82" width="34" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="183" y="98" text-anchor="middle" fill="var(--ink)">450</text>
    <rect x="204" y="82" width="34" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="221" y="98" text-anchor="middle" fill="var(--ink)">451</text>
    <rect x="242" y="82" width="34" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="259" y="98" text-anchor="middle" fill="var(--ink)">452</text>
    <rect x="280" y="82" width="34" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="297" y="98" text-anchor="middle" fill="var(--ink)">453</text>
    <rect x="318" y="82" width="34" height="24" rx="3" fill="var(--paper-raised)" stroke="var(--ink-faint)" stroke-dasharray="3 2"/>
    <text x="335" y="98" text-anchor="middle" fill="var(--ink-faint)">454</text>
    <text x="372" y="98" fill="var(--ink-soft)">知识库 + 业务函数</text>
    <text x="20" y="129" fill="var(--ink-soft)">第 66 周</text>
    <rect x="90" y="112" width="34" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="107" y="128" text-anchor="middle" fill="var(--ink)">455</text>
    <rect x="128" y="112" width="34" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="145" y="128" text-anchor="middle" fill="var(--ink)">456</text>
    <rect x="166" y="112" width="34" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="183" y="128" text-anchor="middle" fill="var(--ink)">457</text>
    <rect x="204" y="112" width="34" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="221" y="128" text-anchor="middle" fill="var(--ink)">458</text>
    <rect x="242" y="112" width="34" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="259" y="128" text-anchor="middle" fill="var(--ink)">459</text>
    <rect x="280" y="112" width="34" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="297" y="128" text-anchor="middle" fill="var(--ink)">460</text>
    <rect x="318" y="112" width="34" height="24" rx="3" fill="var(--paper-raised)" stroke="var(--ink-faint)" stroke-dasharray="3 2"/>
    <text x="335" y="128" text-anchor="middle" fill="var(--ink-faint)">461</text>
    <text x="372" y="128" fill="var(--ink-soft)">审批通知、MCP、节点</text>
    <text x="20" y="159" fill="var(--ink-soft)">第 67 周</text>
    <rect x="90" y="142" width="34" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="107" y="158" text-anchor="middle" fill="var(--ink)">462</text>
    <rect x="128" y="142" width="34" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="145" y="158" text-anchor="middle" fill="var(--ink)">463</text>
    <rect x="166" y="142" width="34" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="183" y="158" text-anchor="middle" fill="var(--ink)">464</text>
    <rect x="204" y="142" width="34" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="221" y="158" text-anchor="middle" fill="var(--ink)">465</text>
    <rect x="242" y="142" width="34" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="259" y="158" text-anchor="middle" fill="var(--ink)">466</text>
    <rect x="280" y="142" width="34" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="297" y="158" text-anchor="middle" fill="var(--ink)">467</text>
    <rect x="318" y="142" width="34" height="24" rx="3" fill="var(--paper-raised)" stroke="var(--ink-faint)" stroke-dasharray="3 2"/>
    <text x="335" y="158" text-anchor="middle" fill="var(--ink-faint)">468</text>
    <text x="372" y="158" fill="var(--ink-soft)">图、记忆、接口</text>
    <text x="20" y="189" fill="var(--ink-soft)">第 68 周</text>
    <rect x="90" y="172" width="34" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="107" y="188" text-anchor="middle" fill="var(--ink)">469</text>
    <rect x="128" y="172" width="34" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="145" y="188" text-anchor="middle" fill="var(--ink)">470</text>
    <rect x="166" y="172" width="34" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="183" y="188" text-anchor="middle" fill="var(--ink)">471</text>
    <rect x="204" y="172" width="34" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="221" y="188" text-anchor="middle" fill="var(--ink)">472</text>
    <rect x="242" y="172" width="34" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="259" y="188" text-anchor="middle" fill="var(--ink)">473</text>
    <rect x="280" y="172" width="34" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="297" y="188" text-anchor="middle" fill="var(--ink)">474</text>
    <rect x="318" y="172" width="34" height="24" rx="3" fill="var(--paper-raised)" stroke="var(--ink-faint)" stroke-dasharray="3 2"/>
    <text x="335" y="188" text-anchor="middle" fill="var(--ink-faint)">475</text>
    <text x="372" y="188" fill="var(--ink-soft)">工作台、TS 写 Agent</text>
    <text x="20" y="219" fill="var(--ink-soft)">第 69 周</text>
    <rect x="90" y="202" width="34" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="107" y="218" text-anchor="middle" fill="var(--ink)">476</text>
    <rect x="128" y="202" width="34" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="145" y="218" text-anchor="middle" fill="var(--ink)">477</text>
    <rect x="166" y="202" width="34" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="183" y="218" text-anchor="middle" fill="var(--ink)">478</text>
    <rect x="204" y="202" width="34" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="221" y="218" text-anchor="middle" fill="var(--ink)">479</text>
    <rect x="242" y="202" width="34" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="259" y="218" text-anchor="middle" fill="var(--ink)">480</text>
    <rect x="280" y="202" width="34" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="297" y="218" text-anchor="middle" fill="var(--ink)">481</text>
    <rect x="318" y="202" width="34" height="24" rx="3" fill="var(--paper-raised)" stroke="var(--ink-faint)" stroke-dasharray="3 2"/>
    <text x="335" y="218" text-anchor="middle" fill="var(--ink-faint)">482</text>
    <text x="372" y="218" fill="var(--ink-soft)">评测和迭代</text>
    <text x="20" y="249" fill="var(--ink-soft)">第 70 周</text>
    <rect x="90" y="232" width="34" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="107" y="248" text-anchor="middle" fill="var(--ink)">483</text>
    <rect x="128" y="232" width="34" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="145" y="248" text-anchor="middle" fill="var(--ink)">484</text>
    <rect x="166" y="232" width="34" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="183" y="248" text-anchor="middle" fill="var(--ink)">485</text>
    <rect x="204" y="232" width="34" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="221" y="248" text-anchor="middle" fill="var(--ink)">486</text>
    <rect x="242" y="232" width="34" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="259" y="248" text-anchor="middle" fill="var(--ink)">487</text>
    <rect x="280" y="232" width="34" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="297" y="248" text-anchor="middle" fill="var(--ink)">488</text>
    <rect x="318" y="232" width="34" height="24" rx="3" fill="var(--paper-raised)" stroke="var(--ink-faint)" stroke-dasharray="3 2"/>
    <text x="335" y="248" text-anchor="middle" fill="var(--ink-faint)">489</text>
    <text x="372" y="248" fill="var(--ink-soft)">可观测、安全</text>
    <text x="20" y="279" fill="var(--ink-soft)">第 71 周</text>
    <rect x="90" y="262" width="34" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="107" y="278" text-anchor="middle" fill="var(--ink)">490</text>
    <rect x="128" y="262" width="34" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="145" y="278" text-anchor="middle" fill="var(--ink)">491</text>
    <rect x="166" y="262" width="34" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="183" y="278" text-anchor="middle" fill="var(--ink)">492</text>
    <rect x="204" y="262" width="34" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="221" y="278" text-anchor="middle" fill="var(--ink)">493</text>
    <rect x="242" y="262" width="34" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="259" y="278" text-anchor="middle" fill="var(--ink)">494</text>
    <rect x="280" y="262" width="34" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="297" y="278" text-anchor="middle" fill="var(--ink)">495</text>
    <rect x="318" y="262" width="34" height="24" rx="3" fill="var(--paper-raised)" stroke="var(--ink-faint)" stroke-dasharray="3 2"/>
    <text x="335" y="278" text-anchor="middle" fill="var(--ink-faint)">496</text>
    <text x="372" y="278" fill="var(--ink-soft)">上线、包装</text>
    <text x="20" y="309" fill="var(--ink-soft)">第 72 周</text>
    <rect x="90" y="292" width="34" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="107" y="308" text-anchor="middle" fill="var(--ink)">497</text>
    <text x="372" y="308" fill="var(--ink-soft)">第二作品</text>
    <text x="20" y="332" fill="var(--ink-soft)">蓝:Agent 本身的逻辑(知识库、业务函数、工作流、评测)</text><text x="20" y="350" fill="var(--ink-soft)">琥珀:围绕它的工程(骨架、界面、可观测、安全、上线);虚线框:复习日</text>
  </g>
</svg>
<figcaption>六个内容日加一个复习日,一共 9 行。第 72 周只有 Day 497 一天,后面接第九部分求职。</figcaption>
</figure>

这个节奏是大纲定好的,我不改。今天要做的是在上面标注两样东西:每个阶段叫什么,阶段结束时**能当场演示什么**。后一个很重要。后面 57 天你会有很多天觉得「今天写了一堆,看不出进展」,阶段末的演示是你给自己定的路标:到了这个日子,打开终端或浏览器,真的做一遍,做不出来就说明哪里落了。

下面是 `schedule.py` 的第一段。它新建在 `part08/` 里,在 `~/agent-zero-lab` 根目录运行。

```bash
cd ~/agent-zero-lab
```

```python
# agent-zero-lab/part08/schedule.py(接着上一段,追加在文件里)
# agent-zero-lab/part08/schedule.py
"""把 Day 438 的方块表排成日程,并检查日程本身:有没有把「用到的」排在「被用的」前面。"""
import ast
from collections import defaultdict
from pathlib import Path

from part08.arch import BOXES, DESIGN_IMPORTS
from part08.check_arch import resolve

FIRST_DAY, LAST_DAY = 441, 497
REVIEW_DAYS = set(range(447, LAST_DAY + 1, 7))  # 复习日每 7 天一个:447、454、461……496

# 阶段:(起, 止, 名字, 阶段末能当场演示什么)。起止来自大纲,「演示」是我给自己定的验收
PHASES = [
    (441, 446, "搭骨架", "make test 全绿;一条命令把库和 62 篇文章造好"),
    (448, 453, "知识库 + 业务函数", "问一个政策问题,返回 5 段带出处的资料;退款金额由代码算对"),
    (455, 460, "审批通知、MCP、节点", "九个节点各自能单测;审批消息推到群里"),
    (462, 467, "图、记忆、接口", "终端里 10 张工单端到端;重启进程后会话还在;接口能流式"),
    (469, 474, "工作台、TS 写 Agent", "浏览器里看着 Agent 一步步干活;财务点审批"),
    (476, 481, "评测和迭代", "第一份评测报告;改动日志里每次分数变化"),
    (483, 488, "可观测、安全", "每张工单花多少钱一目了然;注入测试集有分数"),
    (490, 495, "上线、包装", "公网 demo 能打开;README 五分钟看懂"),
    (497, 497, "第二作品", "代码审查机器人能在 PR 上留意见"),
]


def per_day() -> dict[int, list[str]]:
    by_day: dict[int, list[str]] = defaultdict(list)
    for b in BOXES:
        by_day[b.day].append(b.name)
    return by_day


def print_weeks() -> None:
    print(f"{'周':<4}{'内容日':<10}{'复习日':<6}阶段 → 阶段末演示")
    for week, (start, end, name, demo) in enumerate(PHASES, start=64):
        review = next((d for d in range(start, end + 3) if d in REVIEW_DAYS), "-")
        span = f"{start}–{end}" if start != end else str(start)
        print(f"{week:<4}{span:<10}{review!s:<6}{name} → {demo}")
    heavy = {d: len(n) for d, n in per_day().items() if len(n) >= 4}
    print("一天里方块 ≥ 4 个的:", heavy)
```

<div class="line-notes">

- `import ast` 第二步才会用到,先写在这里,免得下一步再回头改文件开头。`ast` 是 Python 自带的「把源码读成语法树」的模块,[Day 438](/blog/agent-zero/day-438-architecture/) 用它检查过依赖方向。
- `from collections import defaultdict` 字典的变种:取一个不存在的键时自动建一个默认值。`defaultdict(list)` 相当于 JS 里「`map[k] ??= []`」那种写法的内置版。
- `from part08.arch import BOXES, DESIGN_IMPORTS` 昨天的方块表和「每个文件按设计要 import 什么」的表,今天原样用。
- `from part08.check_arch import resolve` 昨天写的相对 import 换算函数:`resolve("supportpilot.kb.ingest", 2, "llm")` 返回 `supportpilot.llm`。今天直接复用,这是为什么昨天把它单独写成函数。
- `FIRST_DAY, LAST_DAY = 441, 497` 毕业项目从搭骨架到第二作品的第一天和最后一天。
- `REVIEW_DAYS = set(range(447, LAST_DAY + 1, 7))` 从 447 开始,每隔 7 天一个,到 497 为止:`{447, 454, 461, 468, 475, 482, 489, 496}`。Day 440 属于第 63 周,不在这份排期里。
- `PHASES = [` 九个阶段,每个是一个四元组 `(起, 止, 名字, 演示)`。起止照大纲抄的。像 `(441, 446, "搭骨架", ...)` 就是「Day 441 到 446 做搭骨架,结束时 `make test` 要全绿」。
- `def per_day() -> dict[int, list[str]]:` 把方块表按天数分组:`{443: ['数据库连接', '表结构'], ...}`。
- `by_day: dict[int, list[str]] = defaultdict(list)` 先声明类型再建空的分组表。
- `by_day[b.day].append(b.name)` 第一次遇到某个 `day` 时,`defaultdict` 自动建一个空列表,所以可以直接 `append`。
- `for week, (start, end, name, demo) in enumerate(PHASES, start=64):` 一次解开两层:`enumerate` 给每个阶段编号(从 64 开始,因为 Day 441–446 是第 64 周),括号里把四元组拆成四个变量。
- `review = next((d for d in range(start, end + 3) if d in REVIEW_DAYS), "-")` 在这个阶段的日子往后多看两天,找第一个复习日;找不到就用 `"-"`。`next(生成器, 默认值)` 的第二个参数就是「找不到时返回什么」。第 72 周只有 Day 497,后面没有复习日,所以显示 `-`。
- `span = f"{start}–{end}" if start != end else str(start)` 起止相同的(只有 Day 497)就只写一个数字。
- `heavy = {d: len(n) for d, n in per_day().items() if len(n) >= 4}` 字典推导式:一天里方块数不少于 4 个的才收进来。后面解释为什么要看这个数。

</div>

跑一下(不写 `__main__`,先用 `-c` 调用):

```bash
uv run python -c "from part08 import schedule; schedule.print_weeks()"
```

```text
周   内容日       复习日   阶段 → 阶段末演示
64  441–446   447   搭骨架 → make test 全绿;一条命令把库和 62 篇文章造好
65  448–453   454   知识库 + 业务函数 → 问一个政策问题,返回 5 段带出处的资料;退款金额由代码算对
66  455–460   461   审批通知、MCP、节点 → 九个节点各自能单测;审批消息推到群里
67  462–467   468   图、记忆、接口 → 终端里 10 张工单端到端;重启进程后会话还在;接口能流式
68  469–474   475   工作台、TS 写 Agent → 浏览器里看着 Agent 一步步干活;财务点审批
69  476–481   482   评测和迭代 → 第一份评测报告;改动日志里每次分数变化
70  483–488   489   可观测、安全 → 每张工单花多少钱一目了然;注入测试集有分数
71  490–495   496   上线、包装 → 公网 demo 能打开;README 五分钟看懂
72  497       -     第二作品 → 代码审查机器人能在 PR 上留意见
一天里方块 ≥ 4 个的: {460: 9}
```

输出是九个阶段、复习日位置、阶段末演示,最后一行 `{460: 9}` 说的是:**全表里只有 Day 460 一天塞了 4 个以上的方块,而且是 9 个**。它们是 `nodes.py` 里的九个节点,九个函数写在同一个文件、同一天。这和大纲一致:Day 457–459 铺垫状态、提示词和依赖注入,Day 460 一口气写九个节点。要写的东西多,但每个节点只有二三十行,相互独立。我的判断是**不拆,但留一条后路**:如果那天做到一半是晚上,就先写 `load_customer`、`classify`、`retrieve`、`draft` 四个,让主干能走通,`act`、`check`、`approval`、`handoff`、`finalize` 放到复习日(Day 461)上午补,复习日的内容不是新知识,有余量。

方块数只是个粗尺子。Day 445 造业务库、Day 448 切块这类天,工作量不在「几个方块」里,而在调试数据。用它是为了第一眼找出「明显塞太满」的日子,不是为了精确估时。

## 第二步:检查日历自己

日历画好了,现在要问:这个顺序成立吗?

我的做法是把「成立」拆成两条能检查的规则。

**规则一**,方块不能排在复习日,也不能排在 Day 437 之前或 497 之后。听起来太明显,但手工改表的时候最容易出这种笔误,「448 改成 454」只差一个数字。

**规则二**,文件 A 的设计里要 import 文件 B,那 B 必须在 A 最后一次被改动之前建好。这条更值钱:Day 438 的 `DESIGN_IMPORTS` 已经写了「每个文件按设计会 import 什么」,现在把它和天数对照,就知道有没有排反。

```python
# agent-zero-lab/part08/schedule.py(接着上一段,追加在文件里)
def file_days() -> dict[str, tuple[int, int]]:
    """每个路径 → (最早哪天建, 最晚哪天还在往里加东西)。nodes.py 的方块分散在 460、465、466。"""
    days: dict[str, list[int]] = defaultdict(list)
    for b in BOXES:
        days[b.path].append(b.day)
    return {p: (min(d), max(d)) for p, d in days.items()}


def target_files(current_path: str, line: str) -> list[str]:
    """把 'from ..kb import retriever' 这样一行,换算成它真正依赖的文件路径。"""
    node = ast.parse(line).body[0]
    assert isinstance(node, ast.ImportFrom)
    current = Path(current_path).relative_to("src").with_suffix("").as_posix().replace("/", ".")
    base = resolve(current, node.level, node.module)  # 例如 supportpilot.kb
    out = []
    for alias in node.names:
        for candidate in (f"{base}.{alias.name}", base):
            path = "src/" + candidate.replace(".", "/") + ".py"
            if path in file_days():
                out.append(path)
                break
    return out


def check_order() -> list[str]:
    """文件 A 的设计里 import 了文件 B,B 必须在 A 最后一次改动之前建好。"""
    days = file_days()
    problems = []
    for path, lines in DESIGN_IMPORTS.items():
        for line in lines:
            for dep in target_files(path, line):
                if days[dep][0] > days[path][1]:
                    problems.append(f"{path}(Day {days[path][1]})要用 {dep},它要到 Day {days[dep][0]} 才建")
    return problems


def check_days() -> list[str]:
    """每个方块的天数必须是内容日:在 441–497 之内,不能落在复习日上。"""
    problems = []
    for b in BOXES:
        if not FIRST_DAY - 4 <= b.day <= LAST_DAY or b.day in REVIEW_DAYS:
            problems.append(f"方块「{b.name}」排在 Day {b.day},不是一个能写代码的日子")
    return problems
```

<div class="line-notes">

- `def file_days() -> dict[str, tuple[int, int]]:` 返回「路径 → (最早哪天建, 最晚哪天还在往里加东西)」。一个文件可能被多个方块指向,所以要两个数。
- `days: dict[str, list[int]] = defaultdict(list)` 路径 → 这个文件所有方块的天数列表。
- `days[b.path].append(b.day)` 比如 `agent/nodes.py` 会收进 `[460, 460, ..., 465, 466]`。
- `return {p: (min(d), max(d)) for p, d in days.items()}` 取最小和最大。`nodes.py` 得到 `(460, 466)`:Day 460 建,Day 466 还在改(读画像)。
- `def target_files(current_path: str, line: str) -> list[str]:` 把「`from ..kb import retriever`」这样一行文字,换算成它依赖的**文件**。
- `node = ast.parse(line).body[0]` 把这一行当成一段独立的 Python 代码解析,取第一条语句。`ast.parse` 不会运行它,只是读成树。
- `assert isinstance(node, ast.ImportFrom)` 确认它是 `from ... import ...` 这种形状。别的写法(`import x`)在设计表里没有出现,出现了就让它报错,别悄悄跳过。
- `current = Path(current_path).relative_to("src").with_suffix("").as_posix().replace("/", ".")` 从路径算出模块名:`src/supportpilot/kb/ingest.py` → 去掉 `src/` → 去掉 `.py` → 斜杠换成点 → `supportpilot.kb.ingest`。
- `base = resolve(current, node.level, node.module)` `node.level` 是开头有几个点(`..` 就是 2),`node.module` 是点后面的模块名。对 `from ..kb import retriever`,从 `supportpilot.kb.ingest` 往上退两级到 `supportpilot`,再接 `kb`,得到 `supportpilot.kb`。
- `for alias in node.names:` `import` 后面可能不止一个名字:`from ..memory import compress, profile` 有两个。
- `for candidate in (f"{base}.{alias.name}", base):` 先试「名字是不是一个子模块」(`supportpilot.memory.compress`),不是再退一步当成「名字是模块里的东西」(`from .config import Settings`,`Settings` 是类,不是文件)。
- `path = "src/" + candidate.replace(".", "/") + ".py"` 换回文件路径,再看方块表里有没有这个文件;有就收进结果。
- `def check_order() -> list[str]:` 规则二本体。
- `for path, lines in DESIGN_IMPORTS.items():` 每个文件和它设计里的 import 行。
- `if days[dep][0] > days[path][1]:` 被依赖的文件**最早**哪天建,晚于依赖它的文件**最后**一次改动,就是排反了。比较时一边用最小一边用最大,是故意偏严:只要 A 的任何一次改动需要 B,就得 B 先有。
- `problems.append(f"{path}(Day {days[path][1]})要用 {dep},它要到 Day {days[dep][0]} 才建")` 报错信息直接写出两个天数,看一眼就知道该动哪个。
- `def check_days() -> list[str]:` 规则一本体。
- `if not FIRST_DAY - 4 <= b.day <= LAST_DAY or b.day in REVIEW_DAYS:` `FIRST_DAY - 4` 是 437,因为 `docs/` 这个方块是 Day 437 建的(PRD)。Python 允许把比较连着写,`a <= x <= b` 等于 JS 里的 `a <= x && x <= b`。

</div>

先给文件末尾加一个入口,把两条规则和日历一起跑出来(昨天的 `arch.py` 一个字没改,这是我定的排期的真实体检结果):

```python
# agent-zero-lab/part08/schedule.py(接着上一段,追加在文件末尾)
if __name__ == "__main__":
    print_weeks()
    print("\n天数合法性:", check_days() or "通过")
    problems = check_order()
    print("先后顺序:", "通过" if not problems else f"{len(problems)} 个问题")
    for p in problems:
        print("  -", p)
```

<div class="line-notes">

- `if __name__ == "__main__":` 只有直接用 `python -m part08.schedule` 运行时才执行,被别的文件 `import` 时不执行。`test_schedule.py` 就是 import 它,不会触发打印。
- `print_weeks()` 先打印日历。
- `print("\n天数合法性:", check_days() or "通过")` 规则一的结果:列表空就写「通过」,非空就把问题列表整个打印出来。
- `problems = check_order()` 规则二的结果存起来,下面要用两次。
- `print("先后顺序:", "通过" if not problems else f"{len(problems)} 个问题")` 通过就写通过,不通过写出个数。
- `for p in problems:` 再逐条打印具体问题,每条前面加一个短横线。

</div>


```bash
uv run python -m part08.schedule
```

```text
周   内容日       复习日   阶段 → 阶段末演示
64  441–446   447   搭骨架 → make test 全绿;一条命令把库和 62 篇文章造好
65  448–453   454   知识库 + 业务函数 → 问一个政策问题,返回 5 段带出处的资料;退款金额由代码算对
66  455–460   461   审批通知、MCP、节点 → 九个节点各自能单测;审批消息推到群里
67  462–467   468   图、记忆、接口 → 终端里 10 张工单端到端;重启进程后会话还在;接口能流式
68  469–474   475   工作台、TS 写 Agent → 浏览器里看着 Agent 一步步干活;财务点审批
69  476–481   482   评测和迭代 → 第一份评测报告;改动日志里每次分数变化
70  483–488   489   可观测、安全 → 每张工单花多少钱一目了然;注入测试集有分数
71  490–495   496   上线、包装 → 公网 demo 能打开;README 五分钟看懂
72  497       -     第二作品 → 代码审查机器人能在 PR 上留意见
一天里方块 ≥ 4 个的: {460: 9}

天数合法性: 通过
先后顺序: 3 个问题
  - src/supportpilot/kb/ingest.py(Day 449)要用 src/supportpilot/llm.py,它要到 Day 457 才建
  - src/supportpilot/kb/retriever.py(Day 450)要用 src/supportpilot/llm.py,它要到 Day 457 才建
  - src/supportpilot/agent/nodes.py(Day 465)要用 src/supportpilot/memory/profile.py,它要到 Day 466 才建
```

天数合法性通过了,先后顺序报了 3 处。我把它们一条条看。

**第一条和第二条是同一个原因:`llm.py`。** Day 438 的表把 `llm.py` 排在 Day 457,理由写在图的说明里:「`llm.py` 在最下层,却是 Day 457 才建」。当时我觉得这是个有趣的事实,今天才发现它其实是个错。`kb/ingest.py`(Day 449)和 `kb/retriever.py`(Day 450)都要用 `LLMClient`,Day 448 给每块戴帽子、Day 449 向量化、Day 450 混合检索,都要调模型或 embedding。Day 457 的标题是「LLMClient 加三样东西」,是**加**东西,不是**建**它。`llm.py` 的底子就是你在 Day 135–137 写的 `common/llm.py`,复制进项目就行。所以它真正该排的日子,是第一个需要它的那天,Day 448。

**第三条是 `nodes.py`。** 方块表里 `load_customer` 是 Day 460 建的,但 Day 466 要把它整个换掉(读客户画像),并在 `_ticket_text` 里插画像段,这两处都在 `nodes.py` 里。方块表漏记了这次改动,所以检查认为 `nodes.py` 最晚 Day 465 就定稿了,却发现它 import 了 Day 466 才建的 `memory/profile.py`。修法是在表里补一个方块,让天数如实。

这是我想让你记住的:**这三处我自己定的时候都没觉得有问题。** 方块表里每一行单独看都合理。顺序问题是「行与行之间」的关系,人眼看表很难发现,让脚本去比,一秒钟就出来了。

改 `part08/arch.py` 两处。`llm.py` 那行把 457 改成 448;在「图和路由」前面补一个方块:

```python
# agent-zero-lab/part08/arch.py(第 1 处:只改这一行里的天数)
    Box("LLM 调用", f"{SRC}/llm.py", 448, "LLMClient"),
# agent-zero-lab/part08/arch.py(第 2 处:新增第一行,放在「图和路由」前面)
    Box("画像进节点", f"{SRC}/agent/nodes.py", 466, "_ticket_text"),
    Box("图和路由", f"{SRC}/agent/graph.py", 462, "build_graph"),
```

<div class="line-notes">

- `Box("LLM 调用", f"{SRC}/llm.py", 448, "LLMClient"),` 只改天数,从 457 改成 448。`Day 448` 的文章会在「给每块戴帽子」之前,先把 `common/llm.py` 复制进 `src/supportpilot/llm.py`,Day 457 再往里加东西。
- `Box("画像进节点", f"{SRC}/agent/nodes.py", 466, "_ticket_text"),` 新增的一行:Day 466 往 `nodes.py` 里的 `_ticket_text` 加画像段。`symbol` 填 `_ticket_text`,检查会真的去文件里找这个名字,所以到了 Day 466 如果函数改了名,这里会报警。
- `Box("图和路由", f"{SRC}/agent/graph.py", 462, "build_graph"),` 只是用来定位插入点,这一行本身不变。

</div>

再跑一次:

```bash
uv run python -m part08.schedule | tail -3
uv run python -m part08.arch | head -1
```

```text
一天里方块 ≥ 4 个的: {460: 9}

天数合法性: 通过
先后顺序: 通过
53 个方块,涉及 43 个路径
```

方块数从昨天的 52 变成 53,多了刚补的那一个,路径数不变(新方块指向已有的 `nodes.py`)。

### 故意弄坏它

检查函数自己对不对,要弄坏一次才知道。下面这个脚本做两件事:把「混合检索」挪到复习日 454,再把 `db.py` 推迟到 Day 451(它被 Day 449 的 `ingest.py` 和 Day 450 的 `retriever.py` 用到)。

```python
# agent-zero-lab/part08/schedule_break.py
"""故意弄坏排期:把一个方块挪到复习日,再把 db.py 推迟到 Day 451。"""
from dataclasses import replace

from part08 import arch, schedule

original = list(arch.BOXES)


def move(name: str, day: int) -> None:
    arch.BOXES[:] = [replace(b, day=day) if b.name == name else b for b in arch.BOXES]


move("混合检索", 454)  # 454 是第 65 周复习日
print("1)", schedule.check_days())
arch.BOXES[:] = original

move("数据库连接", 451)  # db.py 本来 Day 443
for p in schedule.check_order():
    print("2)", p)
arch.BOXES[:] = original
print("还原后:", schedule.check_days() or "天数通过", schedule.check_order() or "顺序通过")
```

<div class="line-notes">

- `from dataclasses import replace` `Box` 是 `frozen=True` 的 dataclass,创建后不能改字段。`replace(b, day=454)` 返回一份「只有 day 不同」的新副本,原来那个不动。
- `original = list(arch.BOXES)` 先存一份原始列表。后面每次实验完用它还原。
- `def move(name: str, day: int) -> None:` 把名字叫 `name` 的方块换成新天数。
- `arch.BOXES[:] = [replace(b, day=day) if b.name == name else b for b in arch.BOXES]` 切片赋值 `[:] =` 是原地改列表,而不是让 `arch.BOXES` 指向一个新列表。这很重要:`schedule.py` 开头 `from part08.arch import BOXES` 拿到的是同一个列表对象,只有原地改,它才看得见。如果写成 `arch.BOXES = [...]`,`schedule` 里的 `BOXES` 还指着旧的,检查就是对着旧数据做的。
- `move("混合检索", 454)  # 454 是第 65 周复习日` 触发规则一。
- `print("1)", schedule.check_days())` 只看规则一的结果。
- `move("数据库连接", 451)  # db.py 本来 Day 443` 触发规则二:`db.py` 要到 451 才建,可是 449 的 `ingest.py` 就要用它。
- `for p in schedule.check_order():` 逐条打印规则二报的问题。
- `print("还原后:", schedule.check_days() or "天数通过", schedule.check_order() or "顺序通过")` `列表 or "文字"`:空列表是假值,取右边;非空取左边。是 [Day 14](/blog/agent-zero/day-014-bool-none/) 讲过的短路求值。

</div>

```bash
uv run python -m part08.schedule_break
```

```text
1) ['方块「混合检索」排在 Day 454,不是一个能写代码的日子']
2) src/supportpilot/kb/ingest.py(Day 449)要用 src/supportpilot/db.py,它要到 Day 451 才建
2) src/supportpilot/kb/retriever.py(Day 450)要用 src/supportpilot/db.py,它要到 Day 451 才建
还原后: 天数通过 顺序通过
```

规则一抓到了 454 这个位置;规则二抓到两处:`ingest.py`(449)和 `retriever.py`(450)都在 `db.py` 之前开工。而且 `business.py`(452)没报,因为 `db.py` 推到 451 还赶得上它。检查报的是「真的排反了」的,不是「看着不顺」的。

把它们变成测试,以后每次改表都会跑:

```python
# agent-zero-lab/part08/test_schedule.py
"""把「排期不自相矛盾」变成每次改 arch.py 都会跑的测试。"""
from part08 import schedule


def test_every_box_lands_on_a_content_day():
    assert schedule.check_days() == []


def test_nothing_is_used_before_it_is_built():
    assert schedule.check_order() == []


def test_cutting_the_workbench_loses_m11():
    lost, weak = schedule.cut_effect(set(range(470, 473)))
    assert lost == ["M11"] and weak == []
```

<div class="line-notes">

- `from part08 import schedule` 从包里导入模块,调用时写 `schedule.check_days()`。
- `def test_every_box_lands_on_a_content_day():` 名字以 `test_` 开头,pytest 才会收([Day 71](/blog/agent-zero/day-071-pytest-1/) 讲过命名约定)。
- `assert schedule.check_days() == []` 检查函数返回问题列表,空列表就是通过。
- `assert schedule.check_order() == []` 规则二。出问题时 pytest 会把列表内容打出来,所以不用额外写失败信息。
- `lost, weak = schedule.cut_effect(set(range(470, 473)))` 下一节才讲 `cut_effect`,这里先用。砍掉 Day 470–472 三天(工作台界面)。
- `assert lost == ["M11"] and weak == []` 工作台那三天砍掉,指标 M11「涉及金额的草稿进待确认」就没有地方落地了,而且没有别的指标受影响。这条测试把一个**设计结论**钉成了代码:以后谁改 `METRIC_DAYS`,这条会提醒他。

</div>

```bash
uv add --dev pytest
uv run pytest part08/test_schedule.py -q
```

```text
...                                                                      [100%]
3 passed in 0.02s
```

验证它真的会失败:把 `arch.py` 里 `llm.py` 那行临时改回 457,再跑,失败信息是:

```text
FAILED part08/test_schedule.py::test_nothing_is_used_before_it_is_built - Ass...
1 failed, 2 passed in 0.05s
```

改回 448,又是 `3 passed`。(这个 pytest 是 `agent-zero-lab` 里的,Day 441 会给 SupportPilot 自己的仓库再装一份。)

## 第三步:落后了,先砍什么

57 天的排期,你大概率会落后。排期很少一路顺风。所以排期里要有一张「落后时的砍法」,**在没落后的时候就定好**。落后时人会慌,慌的时候做的决定通常是砍掉最难的,而最难的常常是最该保留的。

砍的依据是 PRD 的指标:一个指标在哪几天落地,是 Day 437 末尾那张「指标由谁来测」表。如果一段日子被砍掉后,某个指标一天都没留下,那条指标就成了空话,PRD 就得改,这是大事。如果只是少了一部分落地的天,指标还能做,只是弱一点。

```python
# agent-zero-lab/part08/schedule.py(接着上一段,追加在文件里)
# 每个 PRD 指标在哪几段日子里落地(Day 437 末尾那张表)
METRIC_DAYS = {
    "M1": [(448, 451)], "M2": [(448, 451)], "M3": [(478, 478)], "M4": [(452, 453), (477, 477)],
    "M5": [(477, 477), (487, 488)], "M6": [(452, 453), (477, 477)], "M7": [(452, 453), (477, 477)],
    "M8": [(452, 453), (477, 477)], "M9": [(477, 477), (487, 488)], "M10": [(477, 477), (487, 488)],
    "M11": [(470, 472)], "M12": [(478, 478)], "M13": [(485, 486)], "M14": [(478, 478)],
    "M15": [(464, 466), (476, 476)], "M16": [(478, 478)],
}


def expand(ranges: list[tuple[int, int]]) -> set[int]:
    return {d for a, b in ranges for d in range(a, b + 1)}


def cut_effect(cut: set[int]) -> tuple[list[str], list[str]]:
    """砍掉一批天以后:哪些指标彻底没处落地,哪些只剩一部分。"""
    lost, weak = [], []
    for m, ranges in METRIC_DAYS.items():
        days = expand(ranges)
        if days <= cut:
            lost.append(m)
        elif days & cut:
            weak.append(m)
    return lost, weak
```

<div class="line-notes">

- `METRIC_DAYS = {` 指标 → 落地的日子段。`"M4": [(452, 453), (477, 477)]` 的意思是:M4「工具调用正确率」在 Day 452–453(写业务函数和注册表)和 Day 477(规则检查)落地。一个指标可以有好几段。
- `"M11": [(470, 472)],` M11 只有一段:工作台那三天。这就是为什么砍工作台会让它彻底没有着落。
- `"M15": [(464, 466), (476, 476)],` 多轮用例通过率:记忆三天加评测集那一天。
- `def expand(ranges: list[tuple[int, int]]) -> set[int]:` 把 `[(452, 453), (477, 477)]` 展开成天数集合 `{452, 453, 477}`。
- `return {d for a, b in ranges for d in range(a, b + 1)}` 集合推导式,两层 for:先取每一段的 `a, b`,再展开成每一天。
- `def cut_effect(cut: set[int]) -> tuple[list[str], list[str]]:` 输入「要砍的天」,输出「彻底落空的指标」和「只剩一部分的指标」。
- `if days <= cut:` 集合的 `<=` 是「子集」:这个指标的所有落地日,全都在要砍的天里面,它就一天都不剩了。
- `elif days & cut:` `&` 是交集。有交集但不是子集,说明砍掉了一部分,指标还有别的天可以做,只是弱了。

</div>

把文件末尾的 `__main__` 换成下面这个版本:有命令行参数时,把参数当成「要砍的天」,只打印砍法的结果;没有参数时和刚才一样。

```python
# agent-zero-lab/part08/schedule.py(接着上一段,追加在文件里)
if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1:  # 用法:python -m part08.schedule 456 473-474 494-497
        cut: set[int] = set()
        for arg in sys.argv[1:]:
            a, _, b = arg.partition("-")
            cut |= set(range(int(a), int(b or a) + 1))
        lost, weak = cut_effect(cut)
        print(f"砍掉 {len(cut)} 天:没处落地的指标 {lost or '无'};只剩一部分的指标 {weak or '无'}")
        sys.exit(0)
    print_weeks()
    print("\n天数合法性:", check_days() or "通过")
    problems = check_order()
    print("先后顺序:", "通过" if not problems else f"{len(problems)} 个问题")
    for p in problems:
        print("  -", p)
```

<div class="line-notes">

- `import sys` 放在 `__main__` 里面,只有直接运行时才需要读命令行。
- `if len(sys.argv) > 1:  # 用法:python -m part08.schedule 456 473-474 494-497` `sys.argv` 是命令行参数列表,第 0 项是脚本名,所以长度大于 1 就是带了参数。
- `cut: set[int] = set()` 要砍的天,先是空集合。
- `a, _, b = arg.partition("-")` `"473-474".partition("-")` 返回 `("473", "-", "474")`;`"456".partition("-")` 返回 `("456", "", "")`。中间那个下划线变量用不到,按惯例叫 `_`。
- `cut |= set(range(int(a), int(b or a) + 1))` `b` 是空字符串(假值)时 `b or a` 取 `a`,单独一天就变成 `range(456, 457)`;有 `b` 时是 `range(473, 475)`。`|=` 是集合的并集更新。
- `lost, weak = cut_effect(cut)` 调第三步的函数。
- `print(f"砍掉 {len(cut)} 天:没处落地的指标 {lost or '无'};只剩一部分的指标 {weak or '无'}")` 空列表写成「无」。
- `sys.exit(0)` 打印完就结束,不再往下跑日历和检查。

</div>

试几种砍法:

```bash
uv run python -m part08.schedule 456 473-474 494-497
uv run python -m part08.schedule 465-466
uv run python -m part08.schedule 470-472
uv run python -m part08.schedule 448-451
```

```text
$ uv run python -m part08.schedule 456 473-474 494-497
砍掉 7 天:没处落地的指标 无;只剩一部分的指标 无
$ uv run python -m part08.schedule 465-466
砍掉 2 天:没处落地的指标 无;只剩一部分的指标 ['M15']
$ uv run python -m part08.schedule 470-472
砍掉 3 天:没处落地的指标 ['M11'];只剩一部分的指标 无
$ uv run python -m part08.schedule 448-451
砍掉 4 天:没处落地的指标 ['M1', 'M2'];只剩一部分的指标 无
```

读这四条:

- 砍掉 MCP server(456)、TypeScript 写 Agent(473–474)、第二作品(494–497)一共 7 天,**没有任何指标受影响**。PRD 的目标里没有一条要求「对外提供 MCP」,也没有一条要求「用 TS 重写」。这几天是简历上的加分项,不是 PRD 的承诺。
- 砍掉记忆压缩和画像(465–466),M15 只剩一部分:Day 464 的会话状态和 Day 476 的评测集还在,多轮的基本能力保留,压缩和跨工单画像没了。G7(来自课程,不来自访谈)就弱了。
- 砍掉工作台(470–472),M11 彻底没有着落。这是**不能砍**的信号:涉及金额的草稿由客服点确认才发出,是 PRD 里 G5 的核心,界面没了,这条只能嘴上说。
- 砍掉知识库(448–451),M1 和 M2 都落空,G1 整个没了。

所以落后时的顺序是:**先砍第二作品,再砍 TS,再砍 MCP,再砍 Langfuse 接入(Day 484,账本 485 还在)**。到这四样都砍完还不够,说明排期本身有问题,该回到 PRD 改范围,而不是继续往下砍代码。这个顺序我现在就写进 README 的「如果落后了」一节,不等到慌的时候再想。

## 第四步:一张工单要花多少钱

接下来是钱。思路是三步:**量一个换算比例,按比例估一张工单,再乘上张数**。

第一步,中文、JSON、英文一个 token 对应多少字符,是估算的地基。网上常见的说法是「一个汉字约 0.6 个 token」「英文一个单词约 1.3 个 token」,但不同模型的分词器不一样,DeepSeek 自己的文档也只给了粗略的换算(见学习资料)。我不想靠记忆,直接量:发一条消息,`max_tokens=1`(只要一个 token 的回答,几乎不花钱),读返回里的 `prompt_tokens`。

```python
# agent-zero-lab/part08/token_ratio.py
"""量一量:同样多的字符,换成 token 是多少。每个样本只发一次请求,max_tokens=1,不要回答。"""
import json
import re

from common.llm import LLMClient

ARTICLE = (
    "年付订阅在首次购买后的 14 天内可以申请全额退款,含第 14 天。超过 14 天后,系统按剩余完整月份折算,"
    "并扣除 10% 的手续费。申请入口在「设置 → 订阅与账单 → 申请退款」。提交后客服会在一个工作日内核对,"
    "金额超过 1000 元的申请还需要财务复核。退款原路退回,到账时间取决于支付渠道,银行卡一般需要 3 到 7 个工作日。"
    "月付订阅不支持退款,但可以随时关闭自动续费,当期结束后不再扣款。企业版为合同订单,退款条款以合同为准,"
    "请联系您的客户成功经理。优惠券订单按实际支付金额计算退款,优惠券本身不退还。"
)
INVOICES = json.dumps(
    [
        {"invoice_id": "INV-202609-0002", "customer_id": "C0002", "amount": 950.0, "currency": "CNY",
         "status": "paid", "paid_at": "2026-09-12", "plan": "专业版年付", "period_start": "2026-09-12"},
        {"invoice_id": "INV-202608-0007", "customer_id": "C0002", "amount": 79.0, "currency": "CNY",
         "status": "paid", "paid_at": "2026-08-12", "plan": "基础版月付", "period_start": "2026-08-12"},
        {"invoice_id": "INV-202607-0004", "customer_id": "C0002", "amount": 79.0, "currency": "CNY",
         "status": "failed", "paid_at": None, "plan": "基础版月付", "period_start": "2026-07-12"},
    ],
    ensure_ascii=False,
)
SYSTEM = (
    "你是云簿 CloudLedger 的客服助手。规则:1. 只根据【资料】和【工具结果】回答,没有依据就说不知道。"
    "2. 回复里引用资料时写文章编号,例如 [KB-refund-001]。3. 涉及退款金额,必须使用 check_refund_eligibility 的结果,"
    "不要自己计算。4. 不要承诺「已退款」「马上到账」,退款必须经过人工审核。5. 客户提到投诉、律师、12315、"
    "账号被盗,或者明确要求人工,立刻转人工。6. 语气礼貌简短,先给结论再给步骤。"
)
SQL = (
    "CREATE TABLE biz.invoices (id text PRIMARY KEY, customer_id text NOT NULL REFERENCES biz.customers(id), "
    "subscription_id text, amount numeric(10,2) NOT NULL, currency text DEFAULT 'CNY', status text NOT NULL, "
    "issued_at timestamptz NOT NULL, paid_at timestamptz, period_start date, period_end date); "
    "SELECT id, amount, status FROM biz.invoices WHERE customer_id = 'C0002' ORDER BY issued_at DESC LIMIT 10;"
)
SAMPLES = {"帮助中心文章": ARTICLE, "工具结果 JSON": INVOICES, "系统提示词": SYSTEM, "SQL 和英文": SQL}


def han(s: str) -> int:
    return len(re.findall(r"[一-鿿]", s))


if __name__ == "__main__":
    llm = LLMClient()
    base = llm.chat([{"role": "user", "content": "好"}], max_tokens=1).prompt_tokens
    print(f"空壳(一个字的消息)占 {base} 个 token,下面每个样本都先减掉它")
    print(f"{'样本':<10}{'字符数':>6}{'汉字数':>6}{'token':>7}{'字符/token':>10}")
    for name, text in SAMPLES.items():
        r = llm.chat([{"role": "user", "content": text}], max_tokens=1)
        tokens = r.prompt_tokens - base + 1
        print(f"{name:<10}{len(text):>6}{han(text):>6}{tokens:>7}{len(text) / tokens:>10.2f}")
    print(llm.ledger)
```

<div class="line-notes">

- `import json` 下面造样本时要把 Python 对象转成 JSON 字符串。
- `import re` 数汉字用的正则。
- `from common.llm import LLMClient` Day 135–137 写的客户端。今天只用它的 `chat()` 读 `prompt_tokens`。
- `ARTICLE = (` 一段 258 个字符的帮助中心文章。括号里的几个字符串字面量相邻写,Python 会自动拼成一个字符串。我是仿 Day 444 要生成的那种退款说明写的,不是真文章。
- `INVOICES = json.dumps(` 三张账单的 JSON,模拟一次 `list_invoices` 工具返回。`ensure_ascii=False` 让中文保持原样,不转成 `\uXXXX`:转义后每个汉字变六个字符,既不是模型真正看到的,token 数也会失真。
- `SYSTEM = (` 一段仿真的系统提示词,六条规则,231 个字符。
- `SQL = (` 一段建表加查询的 SQL,全英文,403 个字符。
- `SAMPLES = {` 四种样本,每种代表一类会发给模型的内容。
- `def han(s: str) -> int:` 数一个字符串里有几个汉字。
- `return len(re.findall(r"[一-鿿]", s))` `一-鿿` 是常用汉字的 Unicode 范围。和 Day 435 的练习里统计汉字用的是同一个写法。
- `llm = LLMClient()` 从 `.env` 读 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`。
- `base = llm.chat([{"role": "user", "content": "好"}], max_tokens=1).prompt_tokens` 先发一条只有一个字的消息,看「空壳」占多少 token。每条消息即使内容为空,也有角色标记、结束标记这些固定开销,实测是 5 个(包含那一个「好」)。
- `tokens = r.prompt_tokens - base + 1` 样本的 `prompt_tokens` 减去空壳,再加回那个「好」自己占的 1 个,才是样本内容本身的 token 数。
- `print(f"{name:<10}` `:<10` 左对齐占 10 格,`:>6` 右对齐占 6 格。汉字在终端里占两格宽,所以第一列没有严格对齐,不影响数字。最后一列 `len(text) / tokens` 是每个 token 平均对应多少字符,保留两位小数。
- `print(llm.ledger)` `LLMClient` 的账本:总共几次调用、多少 token、多少钱。

</div>

```bash
uv run python -m part08.token_ratio
```

```text
空壳(一个字的消息)占 5 个 token,下面每个样本都先减掉它
样本           字符数   汉字数  token  字符/token
帮助中心文章       258   202    161      1.60
工具结果 JSON    547    15    227      2.41
系统提示词        231   126    133      1.74
SQL 和英文      403     0    103      3.91
5 次调用 | 输入 645 / 输出 5 tokens | 约 ¥0.0013
```

三个结论。**中文文章是 1.6 个字符一个 token**(258 字符 161 个 token)。DeepSeek 文档里给的粗略换算是「一个汉字约 0.6 个 token」,我这段文章里有 202 个汉字,折下来每个汉字约 0.8 个,比文档说的高三分之一(文章里还有标点和数字,也占 token)。官方自己也写了换算因模型而异,以返回的 `usage` 为准,这正是今天要量一次的原因。**JSON 是 2.4**:key、引号、冒号这些符号被分词器合并得比较好,一个 token 能装得下更多字符。**英文和 SQL 是 3.9**,最省。

实验花了 ¥0.0013,5 次调用共 645 个输入 token。这三个比例就是下面算式里 `RATIO` 的来源,在 `cost.py` 开头注明了是 2026 年 10 月 27 日在 DeepSeek 上量的。换别的模型要重量,几十秒的事。

第二步,价格。2026 年 10 月 27 日我去 [DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) 看到的 deepseek-flash 是这样:

| 类别 | 高峰时段 | 非高峰时段 |
| --- | --- | --- |
| 输入,缓存命中 | 0.04 元/百万 token | 0.02 |
| 输入,缓存未命中 | 2 元/百万 token | 1 |
| 输出 | 8 元/百万 token | 4 |

高峰时段是北京时间工作日 9–12 点和 14–18 点(法定节假日除外),其他时间价格减半。所以你晚上和周末写代码、跑评测,实际只花一半。我下面所有数字都按**高峰价**算,这样是偏贵的一侧,留余量。

第三步,把一张工单拆成几次模型调用,每次调用的输入由哪几段拼成。SupportPilot 的工作流是 Day 438 图上那些节点:`classify`、`act`(可能多轮)、`draft`、`check`。按类型分:

- 政策类(约一半):分诊 → 检索 → 起草 → 质检,不调工具。
- 账户类:多一两轮 `act` 查订阅和账单。
- 退款类:多四轮 `act`(查订阅、查账单、查资格、建申请)。
- 投诉类:分诊后直接转人工,只调一次模型。

每次调用的输入我拆成这几块:系统提示词(500 字左右)、客户原话(100 字)、六个工具的 JSON schema(约 1800 字符)、检索回来的 5 段资料(约 2000 字)、前面工具返回的结果(每次约 550 字符)。**`act` 每多一轮,上下文里就多一份工具结果,而且前面所有结果都要再发一遍**,所以一轮比一轮长。

<figure>
<svg viewBox="0 0 640 332" role="img" aria-label="一张退款工单的七次模型调用,每次的输入 token 数;act 每多一轮,上下文里多一份工具结果">
  <g font-family="var(--font-mono)" font-size="12">
    <text x="20" y="24" fill="var(--ink)">退款类工单:7 次调用的输入 token(估算)</text>
    <text x="20" y="61" fill="var(--ink)">classify</text>
    <rect x="90" y="44" width="45" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="143" y="61" fill="var(--ink-soft)">357 输入 / 40 输出</text>
    <text x="20" y="95" fill="var(--ink)">act1</text>
    <rect x="90" y="78" width="132" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="230" y="95" fill="var(--ink-soft)">1048 输入 / 60 输出</text>
    <text x="20" y="129" fill="var(--ink)">act2</text>
    <rect x="90" y="112" width="132" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <rect x="222" y="112" width="29" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="259" y="129" fill="var(--ink-soft)">1277 输入 / 60 输出</text>
    <text x="20" y="163" fill="var(--ink)">act3</text>
    <rect x="90" y="146" width="132" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <rect x="222" y="146" width="58" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="288" y="163" fill="var(--ink-soft)">1506 输入 / 60 输出</text>
    <text x="20" y="197" fill="var(--ink)">act4</text>
    <rect x="90" y="180" width="132" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <rect x="222" y="180" width="87" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="317" y="197" fill="var(--ink-soft)">1735 输入 / 60 输出</text>
    <text x="20" y="231" fill="var(--ink)">draft</text>
    <rect x="90" y="214" width="210" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <rect x="300" y="214" width="116" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="423" y="231" fill="var(--ink-soft)">2582 输入 / 188 输出</text>
    <text x="20" y="265" fill="var(--ink)">check</text>
    <rect x="90" y="248" width="214" height="24" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <rect x="304" y="248" width="116" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="428" y="265" fill="var(--ink-soft)">2619 输入 / 60 输出</text>
    <text x="20" y="306" fill="var(--ink-soft)">蓝:提示词、工具定义、客户原话、检索资料;琥珀:前面几轮工具返回的结果</text>
    <text x="20" y="324" fill="var(--ink-faint)">act 每多一轮,就把前面所有工具结果再发一遍,所以一轮比一轮长</text>
  </g>
</svg>
<figcaption>数字来自 part08/cost.py 的估算。到 Day 463 用真工单对账。</figcaption>
</figure>

这张图说明了为什么退款类比政策类贵 2.7 倍:不是因为调用次数,是因为 `act` 的四轮输入在不断变长,加上起草和质检都要带着全部工具结果。

下面写成代码。先是零件:价格常量、`Call` 记录一次调用、换算函数。

```python
# agent-zero-lab/part08/cost.py(接着上一段,追加在文件里)
# agent-zero-lab/part08/cost.py
"""用算式估一张工单、一次评测要花多少钱。不调模型,只做算术。"""
from dataclasses import dataclass

# 价格:元 / 百万 token。2026 年 10 月 27 日查 DeepSeek 定价页,deepseek-flash 高峰价
PRICE_IN = 2.0  # 输入,缓存未命中
PRICE_HIT = 0.04  # 输入,缓存命中
PRICE_OUT = 8.0  # 输出
OFF_PEAK = 0.5  # 非高峰时段(工作日 9–12、14–18 点以外)价格减半

# 字符 → token:part08/token_ratio.py 在 2026-10-27 实测,字符数 ÷ 比例 = token 数
RATIO = {"zh": 1.6, "sys": 1.7, "json": 2.4, "en": 3.9}


@dataclass(frozen=True)
class Call:
    name: str
    parts: tuple[tuple[int, str], ...]  # (字符数, 种类),输入由几段拼成
    out_tokens: int
    cacheable_chars: int = 0  # 输入开头不变的那部分(提示词和工具定义),Day 486 才会用到

    def in_tokens(self) -> int:
        return round(sum(n / RATIO[k] for n, k in self.parts))


def price(in_tokens: int, out_tokens: int, hit_tokens: int = 0) -> float:
    miss = in_tokens - hit_tokens
    return (miss * PRICE_IN + hit_tokens * PRICE_HIT + out_tokens * PRICE_OUT) / 1_000_000
```

<div class="line-notes">

- `PRICE_IN = 2.0  # 输入,缓存未命中` 三个价格常量,单位都是元/百万 token。写成模块级常量,是为了练习里能一行改掉。
- `PRICE_HIT = 0.04  # 输入,缓存命中` 前缀缓存命中的输入价格,是未命中的 1/50。Day 486 会专门讲它值不值。
- `OFF_PEAK = 0.5` 非高峰时段是半价,用来算「晚上跑评测」的预算。
- `RATIO = {"zh": 1.6, "sys": 1.7, "json": 2.4, "en": 3.9}` 刚才量出来的四个换算比例。`sys` 是系统提示词,1.74 取到 1.7。
- `@dataclass(frozen=True)` 一次调用的记录,创建后不改。
- `parts: tuple[tuple[int, str], ...]  # (字符数, 种类),输入由几段拼成` 类型 `tuple[tuple[int, str], ...]` 的意思是「若干个 `(整数, 字符串)` 对」,末尾的 `...` 表示个数不定。
- `cacheable_chars: int = 0` 输入开头固定不变的那部分字符数。今天只是把它记着,`cache=True` 时才会用,给 Day 486 留好位置。
- `return round(sum(n / RATIO[k] for n, k in self.parts))` 每一段「字符数 ÷ 比例」,加起来取整。一段 500 字符的系统提示词是 500 / 1.7 ≈ 294 个 token。
- `def price(in_tokens: int, out_tokens: int, hit_tokens: int = 0) -> float:` 输入、输出、命中的输入各多少 token,返回多少元。
- `miss = in_tokens - hit_tokens` 命中的部分单独算,剩下的是未命中。
- `return (miss * PRICE_IN + hit_tokens * PRICE_HIT + out_tokens * PRICE_OUT) / 1_000_000` 价格是「每百万 token」,所以最后除以一百万。数字里的下划线是 Python 允许的分隔符,`1_000_000` 就是 `1000000`,读起来不容易数错零。

</div>

再是各个调用怎么拼:

```python
# agent-zero-lab/part08/cost.py(接着上一段,追加在文件里)
TICKET = (100, "zh")  # 客户原话,约 100 字
TOOLDEFS = (1800, "json")  # 六个工具的 JSON schema
SYS_CLASSIFY = (500, "sys")
SYS_ACT = (400, "sys")
SYS_DRAFT = (600, "sys")
SYS_CHECK = (450, "sys")
KB_CHUNKS = (2000, "zh")  # 检索回来的 5 段,每段约 400 字
TOOL_RESULT = 550  # 一次工具返回,约 550 字符 JSON
DRAFT_CHARS = 300  # 回复草稿的字数


ROUNDS = {"policy": 0, "account": 2, "refund": 4, "complaint": 0}  # act 节点每种工单调几轮工具;退款 4 轮来自旧课的实跑


def act_calls(rounds: int) -> list[Call]:
    """act 节点每多调一轮,上下文里就多一份工具结果,所以每轮的输入比上一轮长。"""
    base = (SYS_ACT, TICKET, TOOLDEFS)
    return [
        Call(f"act{i + 1}", (*base, (TOOL_RESULT * i, "json")), 60, cacheable_chars=400 + 1800)
        for i in range(rounds)
    ]


def ticket_calls(kind: str) -> list[Call]:
    classify = Call("classify", (SYS_CLASSIFY, TICKET), 40, 500)
    rounds = ROUNDS[kind]
    if kind == "complaint":  # 投诉分诊后直接转人工
        return [classify]
    evidence = (TOOL_RESULT * rounds, "json")
    draft = Call("draft", (SYS_DRAFT, TICKET, KB_CHUNKS, evidence), round(DRAFT_CHARS / 1.6), 600)
    check = Call("check", (SYS_CHECK, (DRAFT_CHARS, "zh"), KB_CHUNKS, evidence), 60, 450)
    return [classify, *act_calls(rounds), draft, check]


def ticket_cost(kind: str, cache: bool = False) -> tuple[int, int, float]:
    tin = tout = 0
    money = 0.0
    for c in ticket_calls(kind):
        n_in = c.in_tokens()
        hit = round(c.cacheable_chars / RATIO["sys"]) if cache else 0
        tin += n_in
        tout += c.out_tokens
        money += price(n_in, c.out_tokens, min(hit, n_in))
    return tin, tout, money
```

<div class="line-notes">

- `TICKET = (100, "zh")` 客户原话约 100 字,当作中文。后面每次调用都带它。
- `TOOLDEFS = (1800, "json")` 六个工具的 schema,约 1800 字符。工具定义每次调用都要发,这是 `act` 贵的原因之一。
- `KB_CHUNKS = (2000, "zh")` 检索回来 5 段,每段约 400 字。
- `TOOL_RESULT = 550` 一次工具返回的 JSON,约 550 字符。我按上面 `INVOICES` 样本(三张账单 547 字符)取的。
- `DRAFT_CHARS = 300` 回复草稿 300 字。输出 token 按 `300 / 1.6` 估。
- `ROUNDS = {` 每种工单 `act` 调几轮工具。退款类 4 轮,按退款的四步流程估:查订阅、查账单、查资格、建申请。
- `def act_calls(rounds: int) -> list[Call]:` 生成 `rounds` 次 `act` 调用。
- `Call(f"act{i + 1}", (*base, (TOOL_RESULT * i, "json")), 60, cacheable_chars=400 + 1800)` 第 `i` 轮的输入 = 基础三段 + `i` 份工具结果(第一轮 `i=0`,没有结果)。`(*base, 新的一段)` 的 `*` 把元组展开,和 JS 里 `[...base, x]` 一回事。输出固定 60 个 token(一个工具调用的 JSON)。
- `classify = Call("classify", (SYS_CLASSIFY, TICKET), 40, 500)` 分诊:一段提示词加客户原话,输出 40 个 token 的 JSON(类别、紧急度)。
- `rounds = ROUNDS[kind]` 取这种工单的轮数。
- `if kind == "complaint":  # 投诉分诊后直接转人工` 投诉只调一次模型。
- `evidence = (TOOL_RESULT * rounds, "json")` 到起草和质检时,所有工具结果都已经在上下文里了,总共 `rounds` 份。
- `draft = Call("draft", (SYS_DRAFT, TICKET, KB_CHUNKS, evidence), round(DRAFT_CHARS / 1.6), 600)` 起草:提示词、客户原话、检索资料、工具结果;输出是 300 字草稿折算的 token 数 188。
- `check = Call("check", (SYS_CHECK, (DRAFT_CHARS, "zh"), KB_CHUNKS, evidence), 60, 450)` 质检:要看草稿、资料和证据三样,输出只是「通过/不通过 + 原因」,60 个 token。规则检查是代码,不花钱,这里估的是规则过了之后那次便宜模型核对。
- `return [classify, *act_calls(rounds), draft, check]` 把这些调用按顺序排成一张工单的完整清单。`*act_calls(rounds)` 展开成零个或多个元素,政策类就是零个。
- `def ticket_cost(kind: str, cache: bool = False) -> tuple[int, int, float]:` 一张某类工单的总输入 token、总输出 token、总钱数。
- `hit = round(c.cacheable_chars / RATIO["sys"]) if cache else 0` 打开缓存时,把开头不变的那部分当作命中。这是个乐观估计,Day 486 要实测。
- `money += price(n_in, c.out_tokens, min(hit, n_in))` 每次调用单独算钱再累加。`min(hit, n_in)` 防止「命中数大于输入总数」这种不可能的情况。

</div>

最后是加权和评测:

```python
# agent-zero-lab/part08/cost.py(接着上一段,追加在文件里)
MIX = {"policy": 0.5, "account": 0.2, "refund": 0.2, "complaint": 0.1}  # 工单类型占比,按 PRD 背景估的
JUDGE = Call("judge", ((450, "sys"), (100, "zh"), (DRAFT_CHARS, "zh"), (2000, "zh"), (550, "json")), 120)


def avg_ticket(cache: bool = False) -> float:
    return sum(share * ticket_cost(k, cache)[2] for k, share in MIX.items())


def eval_run(cases: int, judged: float = 1.0, cache: bool = False) -> float:
    """一次评测 = 每个用例跑一遍工作流 + 一次 LLM 评审(规则检查是代码,不花钱)。"""
    j = price(JUDGE.in_tokens(), JUDGE.out_tokens)
    return cases * (avg_ticket(cache) + j * judged)
```

<div class="line-notes">

- `MIX = {` 四类工单的占比。PRD 背景里写「一半以上是帮助中心里已有答案的重复问题」,政策类取 50%;其余按我的猜测分:账户 20%、退款 20%、投诉 10%。这是整个估算里**最主观**的一组数,评测集建出来以后用真实分布替换。
- `JUDGE = Call("judge", ((450, "sys"), (100, "zh"), (DRAFT_CHARS, "zh"), (2000, "zh"), (550, "json")), 120)` 第二层评审(Day 478)的一次调用:评分标准、客户原话、草稿、参考资料、工具结果;输出 120 个 token 的评分和理由。
- `def avg_ticket(cache: bool = False) -> float:` 按占比加权平均:每类的单张成本乘以它占的比例,再加起来。
- `def eval_run(cases: int, judged: float = 1.0, cache: bool = False) -> float:` 一次评测的总花费。`judged` 控制有多少比例的用例要过评审(1.0 是全部)。
- `j = price(JUDGE.in_tokens(), JUDGE.out_tokens)` 评审一次多少钱。
- `return cases * (avg_ticket(cache) + j * judged)` 每个用例 = 跑一遍工作流 + 一次评审。规则检查是代码,不收钱,所以不在这个式子里。

</div>

跑一下:

```bash
uv run python -m part08.cost | head -7
```

```text
类型          调用    输入tok    输出tok      元/张
policy       3     3724      288   0.0098
account      5     6967      408   0.0172
refund       7    11124      528   0.0265
complaint    1      357       40   0.0010
按占比 {'policy': 0.5, 'account': 0.2, 'refund': 0.2, 'complaint': 0.1} 加权平均 ¥0.0137/张;评审一次 ¥0.0049
M13 口径(工作流+评审)/用例 = ¥0.0187,红线 ¥0.05
```

对着看:

- 政策类 ¥0.0098,账户类 ¥0.0172,退款类 ¥0.0265,投诉类 ¥0.0010。投诉类是便宜的极端:一次分诊,357 个输入 token、40 个输出,约一分钱的十分之一。
- 按占比加权,**平均每张工单 ¥0.0137**。评审一次 ¥0.0049。
- M13 的口径是「一次评测的总花费 ÷ 用例数」,包括工作流和评审,所以是 0.0137 + 0.0049 = **¥0.0187**。红线是 ¥0.05,有 2.7 倍的余量。

M13 不是拍脑袋,至少数量级对得上。但它的余量是「估算」给的,下面看看这个估算靠不靠谱。

### 这个估算准吗:拿真数据对账

我要诚实说明一件事:今天的估算是**在没有真实提示词的情况下**做的,系统提示词是多长、检索回来几段、模型自己多调几轮工具,都是我按旧课经验猜的。猜错了会怎样?Day 463 会用真模型跑 10 张真实工单(那时提示词已经写完),这里先把那组实测数字拿来对账,每一类取我估的和实测的:

| 类型 | 今天的估算 | Day 463 实测 | 差别 |
| --- | --- | --- | --- |
| 政策类 | 0.0098 | 0.0047、0.0057 | 我估高了约 2 倍 |
| 账户类 | 0.0172 | 0.0097(找不到客户)、0.0209(账套变只读) | 落在区间里 |
| 退款类 | 0.0265 | 0.0199 到 0.0360(5 张) | 落在区间里 |
| 投诉类 | 0.0010 | 0.0017 | 同一个数量级 |

两点。第一,**政策类我估高了一倍**:我假设检索回来 5 段、每段 400 字,提示词也按几百字估;实际用的片段比我想的短。这是我的推测,没有逐段核实。第二,**退款类的区间很宽**(0.0199 到 0.0360),最贵的那张里模型自己多调了几轮工具、质检还打回重写了一次,一张就拉高了平均。

这个误差我能接受,原因是估算的任务不是算准,是**在动手前判断量级,并且知道错在哪个方向**。偏高 2 倍没关系,预算宽松;偏低 5 倍才危险,说明某个环节没算进去。今天的估算偏差在 0.5 到 2 倍之内,够用。到 Day 485 账本建起来以后,每次评测都有真实总花费,会回来改这几个常量。

还有一点要补:**不要回头改参数去凑实测数**。如果我今天看到实测 0.0047 就把 `KB_CHUNKS` 改成 800 字,估算和实测对上了,但这个估算就失去了「事先判断」的意义。留着偏差,下次换一个项目估算时,你会知道自己习惯往哪边偏。

## 第五步:一次评测、整个后半程要花多少

先算一次评测。Day 476 起要建评测集,先假设 dev 集 100 条用例、test 集 50 条。

```bash
uv run python -m part08.cost | sed -n 8,9p
```

```text
100 个用例一次评测 ¥1.87;非高峰 ¥0.93;前缀缓存 ¥1.42
150 个用例一次评测 ¥2.80;非高峰 ¥1.40;前缀缓存 ¥2.12
```

100 条用例一次完整评测约 **¥1.87**。晚上或周末跑(非高峰)是 ¥0.93;如果前缀缓存真能命中开头不变的部分,约 ¥1.42。注意这是「工作流 + 评审」两部分,如果只跑规则检查,只花工作流那一半。

然后把后半程的每一步列出来,次数是我的**计划**,不是实测:

```python
# agent-zero-lab/part08/cost.py(接着上一段,追加在文件里)
def budget() -> list[tuple[str, str, float]]:
    """毕业项目后半程的预算:(哪一步, 怎么算, 元)。次数是我的计划,不是实测。"""
    j = price(JUDGE.in_tokens(), JUDGE.out_tokens)
    return [
        ("Day 462–466 手动跑工单", "40 张 × 平均每张", 40 * avg_ticket()),
        ("Day 478 第一份分数", "dev 100 例 × 1 次", eval_run(100)),
        ("Day 479 验评审器", "只跑评审,100 例 × 3 次", 100 * 3 * j),
        ("Day 480–483 迭代", "dev 100 例 × 15 次", 15 * eval_run(100)),
        ("Day 481–483 test 集", "test 50 例 × 3 次", 3 * eval_run(50)),
        ("Day 486 缓存和路由对比", "dev 100 例 × 2 次", 2 * eval_run(100)),
        ("Day 487–488 注入集", "60 例 × 3 次", 3 * eval_run(60)),
    ]
```

<div class="line-notes">

- `def budget() -> list[tuple[str, str, float]]:` 返回「哪一步、怎么算的、多少钱」的三元组列表。
- `j = price(JUDGE.in_tokens(), JUDGE.out_tokens)` 评审一次的钱,下面「验评审器」这一步只跑评审,不跑工作流,要单独用到它。
- `("Day 462–466 手动跑工单", "40 张 × 平均每张", 40 * avg_ticket()),` 记忆那几天会反复手动跑工单,按 40 张估。
- `("Day 478 第一份分数", "dev 100 例 × 1 次", eval_run(100)),` 第一次跑完整评测。
- `("Day 479 验评审器", "只跑评审,100 例 × 3 次", 100 * 3 * j),` Day 479 要检查「评审本身准不准」,拿人工标注对比,评审要跑好几遍。
- `("Day 480–483 迭代", "dev 100 例 × 15 次", 15 * eval_run(100)),` 一次改一处,每改一次全量跑一遍。15 次是我估的,是整个预算里最大的一项。
- `("Day 481–483 test 集", "test 50 例 × 3 次", 3 * eval_run(50)),` test 集只在里程碑跑,所以次数少。
- `("Day 486 缓存和路由对比", "dev 100 例 × 2 次", 2 * eval_run(100)),` 对比开关前后各一次。
- `("Day 487–488 注入集", "60 例 × 3 次", 3 * eval_run(60)),` 攻击样本集,多次迭代防御。

</div>

```bash
uv run python -m part08.cost | tail -9
```

```text
预算:
  Day 462–466 手动跑工单     40 张 × 平均每张             ¥  0.55
  Day 478 第一份分数         dev 100 例 × 1 次         ¥  1.87
  Day 479 验评审器          只跑评审,100 例 × 3 次        ¥  1.48
  Day 480–483 迭代        dev 100 例 × 15 次        ¥ 27.99
  Day 481–483 test 集    test 50 例 × 3 次         ¥  2.80
  Day 486 缓存和路由对比       dev 100 例 × 2 次         ¥  3.73
  Day 487–488 注入集       60 例 × 3 次              ¥  3.36
  合计 ¥41.78;留 50% 余量 ¥63
```

合计约 ¥42,留 50% 余量,**预算定 ¥65**。其中迭代那一项就占了 28 块,是最大头。这个结果带来三个具体的决定:

1. **规则检查先跑,过了再调评审。** 规则检查是代码,不花钱。如果一条用例的规则检查已经不过,评审也不用跑了。`eval_run` 的 `judged` 参数就是留给这个的。
2. **迭代时先在 20 条的小子集上跑,有改进再跑全量。** 全量一次 ¥1.87,小集一次不到 ¥0.4。15 次全量变成「15 次小集加 5 次全量」,能省近一半。
3. **评测放在晚上或周末跑。** 同样的跑法,价格减半。

价格会变,所有单价都写在 `cost.py` 开头三行里,换厂商或遇到调价只改那三行。

## 写进文档的一段话

今天的结论要落到文档里,不然就是只在你脑子里。我加进 PRD 的风险一栏、K4 那一行(「评测太贵,不敢常跑」)后面,写成这样:

> 成本估算(2026-10-27,deepseek-flash 高峰价):平均每张工单约 ¥0.014,含评审约 ¥0.019,低于 M13 的 ¥0.05。100 条用例一次评测约 ¥1.9;毕业项目后半程总预算约 ¥42,留余量取 ¥65。依据:`part08/cost.py`。估算偏差在 0.5–2 倍,Day 485 用账本实测后修正。

PRD 里的 K4 原来的「在哪里验证」是 `Day 439 成本算式,M13`,今天这一格兑现了。

## 动手练习

### 练习 1:从 Day 455 起落后了 3 天

你在 Day 455 的时候发现自己落后了整整三天,不想动评测、安全和上线。请用 `schedule.py` 选出三天整天砍掉,并且保证:没有任何指标彻底落空。再问自己一句:如果再多砍一天(Day 485,账本),会怎样?

<details><summary>参考答案</summary>

按上一节的顺序,先砍离 PRD 最远的:MCP server(Day 456)、TypeScript 写 Agent 的两天(Day 473、474)。验证:

```text
$ uv run python -m part08.schedule 456 473-474
砍掉 3 天:没处落地的指标 无;只剩一部分的指标 无
$ uv run python -m part08.schedule 456 473-474 485
砍掉 4 天:没处落地的指标 无;只剩一部分的指标 ['M13']
```

三天砍掉,没有指标落空也没有变弱。第四行是「再多砍 Day 485」:`M13`(单张成本)只剩 Day 486 一天落地,变弱,但不是落空,说明账本和前缀缓存那两天里,**只做账本一天**也勉强够用。不过我不建议这么砍,因为成本是面试官爱问的数字,Day 485 的账本就是你回答它的证据。

要点是:这个选择是脚本给出的**依据**,不是拍脑袋。如果你想砍别的天,先跑一次看会不会有指标落空。

</details>

### 练习 2:拧两个成本旋钮

写 `part08/ex2_knobs.py`:先把检索回来的资料砍半(`KB_CHUNKS` 从 2000 字改成 1000 字),再还原,把退款类的 `act` 轮数从 4 改成 6。分别打印退款类单张成本和加权平均。预测一下哪个旋钮影响更大,再跑。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part08/ex2_knobs.py
"""练习 2:拧两个旋钮,看每张工单的成本怎么变。"""
from part08 import cost

print(f"改之前   退款类 ¥{cost.ticket_cost('refund')[2]:.4f} | 平均 ¥{cost.avg_ticket():.4f}")

cost.KB_CHUNKS = (1000, "zh")  # 检索回来的资料砍半:5 段,每段只带 200 字
print(f"资料砍半 退款类 ¥{cost.ticket_cost('refund')[2]:.4f} | 平均 ¥{cost.avg_ticket():.4f}")

cost.KB_CHUNKS = (2000, "zh")  # 还原
cost.ROUNDS["refund"] = 6  # 退款类多查两轮工具
print(f"多查两轮 退款类 ¥{cost.ticket_cost('refund')[2]:.4f} | 平均 ¥{cost.avg_ticket():.4f}")
```

<div class="line-notes">

- `from part08 import cost` 导入整个模块而不是单个名字,这样下面 `cost.KB_CHUNKS = ...` 改的是模块里的那个变量。如果写成 `from part08.cost import KB_CHUNKS`,拿到的是一份拷贝,改它不会影响 `cost` 内部的计算。
- `print(f"改之前   退款类 ¥{cost.ticket_cost('refund')[2]:.4f} | 平均 ¥{cost.avg_ticket():.4f}")` `ticket_cost` 返回三元组,`[2]` 取第三个(钱)。f-string 里用单引号 `'refund'`,是因为外面已经是双引号。
- `cost.KB_CHUNKS = (1000, "zh")  # 检索回来的资料砍半:5 段,每段只带 200 字` 改模块级变量。`ticket_calls` 每次被调用时才去读它,所以马上生效。
- `cost.KB_CHUNKS = (2000, "zh")  # 还原` 一个旋钮试完就还原,不然两个旋钮的效果混在一起。
- `cost.ROUNDS["refund"] = 6  # 退款类多查两轮工具` `ROUNDS` 是字典,原地改一项。

</div>

```text
改之前   退款类 ¥0.0265 | 平均 ¥0.0137
资料砍半 退款类 ¥0.0240 | 平均 ¥0.0115
多查两轮 退款类 ¥0.0376 | 平均 ¥0.0159
```

资料砍半,退款类从 ¥0.0265 降到 ¥0.0240,平均从 ¥0.0137 降到 ¥0.0115;多查两轮,退款类从 ¥0.0265 升到 ¥0.0376,平均升到 ¥0.0159。我预测的是「砍资料省得多」,**错了**:资料砍半只省 9%(因为资料只在起草和质检两次调用里出现),多两轮工具却贵 42%(因为每多一轮,后面每次调用的上下文都跟着长)。结论:要控成本,先盯 `act` 的轮数,不是先压资料长度。这也是 Day 463 实测里「退款类占 63% 花费」的原因。

</details>

### 练习 3:方块表里少了一个文件,检查会怎样

把 `arch.py` 里「客户画像」(`memory/profile.py`)那个方块临时删掉,再跑 `check_order()`。会发生什么?如果它崩了,改一个版本让它说人话:指出「设计里有这个文件,方块表里没有」。

<details><summary>参考答案</summary>

先猜一下:我原来以为它会「悄悄通过」,因为依赖的文件找不到,`target_files` 返回空列表,就当没这条依赖。写出来跑了才发现不是这样,下面是实跑:

```python
# agent-zero-lab/part08/ex3_known.py
"""练习 3:表里少了一个文件时,check_order 不该崩,要说人话。"""
import ast

from part08 import arch, schedule


def check_order_safe() -> list[str]:
    days = schedule.file_days()
    problems = []
    for path, lines in schedule.DESIGN_IMPORTS.items():
        if path not in days:
            problems.append(f"设计里有 {path},方块表里没有它")
            continue
        for line in lines:
            node = ast.parse(line).body[0]
            assert isinstance(node, ast.ImportFrom)
            found = schedule.target_files(path, line)
            if len(found) < len(node.names):
                problems.append(f"{path} 的 `{line}` 里有名字对不上任何方块")
            for dep in found:
                if days[dep][0] > days[path][1]:
                    problems.append(f"{path}(Day {days[path][1]})要用 {dep},它要到 Day {days[dep][0]} 才建")
    return problems


if __name__ == "__main__":
    print("原表:", check_order_safe() or "通过")
    arch.BOXES[:] = [b for b in arch.BOXES if b.name != "客户画像"]  # 删掉 memory/profile.py 的方块
    try:
        schedule.check_order()
    except KeyError as e:
        print("原来的 check_order 直接崩了:KeyError", e)
    for p in check_order_safe():
        print("check_order_safe:", p)
```

<div class="line-notes">

- `import ast` 要再读一遍 import 行,数 `import` 后面有几个名字。
- `from part08 import arch, schedule` 这次要同时用方块表(删方块)和排期模块(查依赖)。
- `def check_order_safe() -> list[str]:` 和 `check_order` 同样的检查,多几道防护。
- `days = schedule.file_days()` 重用第二步的函数。
- `if path not in days:` 设计表里有这个文件,方块表里没有它。原来的代码在这里会 `days[path]` 直接抛 `KeyError`。
- `problems.append(f"设计里有 {path},方块表里没有它")` 把崩溃变成一条人话。
- `continue` 这个文件的 import 没法比天数了(不知道它哪天建),跳到下一个文件。
- `found = schedule.target_files(path, line)` 这一行 import 能对应到几个方块。
- `if len(found) < len(node.names):` `from ..memory import compress, profile` 有两个名字,如果只找到一个对应方块,说明另一个名字找不到,要报。
- `for dep in found:` 找到的才去比天数,逻辑和原来一样。
- `arch.BOXES[:] = [b for b in arch.BOXES if b.name != "客户画像"]` 原地删掉一个方块。再次用切片赋值,理由和 `schedule_break.py` 里一样。
- `except KeyError as e:` 先演示原来的 `check_order` 遇到这种情况的样子。

</div>

```text
原表: 通过
原来的 check_order 直接崩了:KeyError 'src/supportpilot/memory/profile.py'
check_order_safe: 设计里有 src/supportpilot/memory/profile.py,方块表里没有它
check_order_safe: src/supportpilot/agent/nodes.py 的 `from ..memory import compress, profile` 里有名字对不上任何方块
```

原来的 `check_order` 不是悄悄通过,是**直接崩了**,报 `KeyError: 'src/supportpilot/memory/profile.py'`。崩比悄悄通过好,至少你知道出事了;但这条报错只告诉你缺的是哪个键,没告诉你为什么缺、该去改哪里。`check_order_safe` 报了两条:缺的文件是谁、哪一行 import 因此对不上。

我这次在预期上错了,值得记一下:我预判「悄悄通过」,实际是崩。写检查时最怕的是**漏报**(该报没报),崩溃反而是安全的那一侧;所以对「悄悄通过」要多问一句,能不能构造一个输入让它真的通过却不该通过。这次没构造出来,但值得问。

</details>

### 练习 4:M13 超标的三种情形

假设你实跑后发现单张成本不是 ¥0.0187,而是翻了几倍。写出可能的三种原因,并用 `cost.py` 各模拟一次,看哪种会真的突破红线 ¥0.05。

<details><summary>参考答案</summary>

三种原因:模型打开思考模式(输出 token 放大)、`act` 的轮数增加、两件事同时发生。我再加一个对照:同样两件事,放到非高峰时段。

```python
# agent-zero-lab/part08/ex4_levers.py
"""练习 4:如果 M13 超标,有哪几个杠杆,各能省多少?"""
from part08 import cost


def m13() -> float:
    return cost.avg_ticket() + cost.price(cost.JUDGE.in_tokens(), cost.JUDGE.out_tokens)


print(f"基线                 ¥{m13():.4f}")
cost.PRICE_OUT = 24.0  # 假设思考模式把输出 token 放大 3 倍,等价于输出单价乘 3
print(f"输出放大 3 倍(思考)  ¥{m13():.4f}  {'超标' if m13() > 0.05 else '仍在红线内'}")
cost.PRICE_OUT = 8.0
cost.ROUNDS.update({"account": 4, "refund": 8})  # 再假设 act 的轮数翻倍
print(f"工具轮数翻倍         ¥{m13():.4f}  {'超标' if m13() > 0.05 else '仍在红线内'}")
cost.PRICE_OUT = 24.0
print(f"两件事同时发生       ¥{m13():.4f}  {'超标' if m13() > 0.05 else '仍在红线内'}")
cost.PRICE_IN, cost.PRICE_HIT, cost.PRICE_OUT = 1.0, 0.02, 12.0  # 同样两件事,但在非高峰
print(f"同上,非高峰价        ¥{m13():.4f}  {'超标' if m13() > 0.05 else '仍在红线内'}")
```

<div class="line-notes">

- `def m13() -> float:` 按 PRD 的口径算:工作流平均成本加一次评审。
- `return cost.avg_ticket() + cost.price(cost.JUDGE.in_tokens(), cost.JUDGE.out_tokens)` 每次调用都重新读 `cost` 模块里最新的价格和轮数,所以下面改了常量,这个函数自动跟着变。
- `cost.PRICE_OUT = 24.0  # 假设思考模式把输出 token 放大 3 倍,等价于输出单价乘 3` 偷了个懒:没改输出 token 数,而是把输出单价乘 3,效果等价。`24` 是 8 的 3 倍。
- `cost.ROUNDS.update({"account": 4, "refund": 8})  # 再假设 act 的轮数翻倍` 账户类 2 轮变 4 轮,退款类 4 轮变 8 轮。
- `cost.PRICE_IN, cost.PRICE_HIT, cost.PRICE_OUT = 1.0, 0.02, 12.0` 一行同时改三个:非高峰价是高峰价的一半,但输出还带着 3 倍的放大,所以 `8 × 3 ÷ 2 = 12`。
- `{'超标' if m13() > 0.05 else '仍在红线内'}` f-string 里放一个条件表达式,每行末尾直接给结论。

</div>

```text
基线                 ¥0.0187
输出放大 3 倍(思考)  ¥0.0259  仍在红线内
工具轮数翻倍         ¥0.0253  仍在红线内
两件事同时发生       ¥0.0338  仍在红线内
同上,非高峰价        ¥0.0169  仍在红线内
```

没有一种情形突破红线。输出放大 3 倍是 ¥0.0259,工具轮数翻倍是 ¥0.0253,两件事同时发生是 ¥0.0338,仍然在 ¥0.05 以内,非高峰价下更是只有 ¥0.0169。M13 的红线给得比较宽。这对你意味着:**成本不是这个项目的主要风险**,准确率和延迟才是。后面真遇到成本问题,先看 `act` 轮数(练习 2),再看是不是误开了思考模式,通常是这两处。

要再提醒一次:这些数字是 `cost.py` 的模拟,假设「输出放大 3 倍」是我随手定的,不是实测。Day 465 压缩那一课里有「思考模式打开」的真实对比,到时回来核对。

</details>

**验收标准**:`schedule.py` 跑出九个阶段和「先后顺序:通过」;`schedule_break.py` 报出 1 处天数错误和 2 处顺序错误;`test_schedule.py` 3 个测试通过;练习 3 的 `check_order_safe` 能把缺方块说成人话;能不看文章说出「排期检查的两条规则」;`token_ratio.py` 跑出你自己的三个换算比例;`cost.py` 跑出每类工单的成本,并且你能解释为什么退款类比政策类贵;PRD 的 K4 后面写上了成本估算那一段。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 排期 | 把要做的事按天排到日历上,同时看清谁依赖谁。不是估「这件事要几天」,是定「这件事哪天做,做完能演示什么」 |
| 里程碑 | 一个阶段结束时能当场验证的结果,比如「终端里 10 张工单端到端跑通」。比「完成了某某模块」可靠,因为它要真的跑 |
| 依赖顺序 | A 要用 B,就必须 B 先有。排期里最常见的错,是把依赖别人的事排在被依赖的事前面 |
| 复习日 | 每六个内容日后面的一天,不写新功能,做汇总和默写。也是落后时的缓冲 |
| 集合的子集 `<=` | `a <= b` 为真,表示 `a` 里每个元素都在 `b` 里。今天用它判断「一个指标的所有落地日,是不是全被砍掉了」 |
| 切片赋值 `list[:] = ...` | 原地替换列表内容,列表还是同一个对象。别处通过 `import` 拿到这个列表,就能看到改动 |
| token | 模型计费和切分文本的单位。中文约 1.6 个字符一个,JSON 约 2.4,英文约 3.9(2026-10-27 在 DeepSeek 上实测) |
| 高峰/非高峰 | DeepSeek 按北京时间分时段计价:工作日 9–12、14–18 点是高峰,其他时间价格减半 |
| 缓存命中 | 请求的开头部分和之前的请求一样时,模型厂商可以复用上次的计算,这部分输入按更低的价格收费(deepseek-flash 的命中价是未命中的 1/50) |
| 估算 | 动手前用算式判断量级。目标不是准,是知道偏差在哪个方向,以及错多少会出事 |
| 预算(成本红线) | 先于实现定下的上限。超了不是「花多了」,是该去查哪一段膨胀了 |
| 数量级 | 差不多是 10 倍一档。「0.014 和 0.019 差不多」是同一个数量级,「0.014 和 0.14」不是 |

## 常见误区

**把排期当成估时间。** 「这个模块三天」听着像排期,其实只是估算。排期要回答的是「它依赖什么、它被谁依赖、做完怎么验收」。今天的检查抓到的两处错,没有一处是「估得不准」,都是「顺序排反」。

**只看每一行合不合理,不看行与行之间的关系。** `llm.py` 排在 Day 457、`ingest.py` 排在 Day 449,每一行单独看都说得通。排反的是它们之间的关系,人眼看表几乎看不出来,所以要让脚本去比。

**落后时才想砍什么。** 慌的时候会砍最难的,而最难的往往最重要。先定好顺序,而且依据是 PRD 的指标,不是「哪个看着最麻烦」。

**用别人的 token 比例估自己的账。** 「一个汉字 0.6 个 token」换个模型可能是 0.8 或 1.0,JSON 和英文的比例差得更多。花 ¥0.001 量一次,比猜准确得多。

**把估算调到和实测一致。** 估算的价值在事先判断。拿到实测数就回头改参数,估算和实测永远对得上,也永远没有信息量。留着偏差,看它往哪边偏。

**只估单价,忘了上下文会变长。** `act` 每多一轮,前面所有工具结果都要再发一遍,所以 4 轮不是「4 倍」,是更多。今天的练习 2 里,多两轮工具比砍掉一半资料影响大得多。

**以为成本是第一风险。** 今天的估算说 M13 有 2.7 倍余量。准确率和延迟更可能是项目卡住的地方。把担心放在真正可能出问题的地方。

## 学习资料

### 文档与文章

- [DeepSeek · 模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):今天所有单价的出处,2026 年 10 月 27 日查的。看「高峰/空闲时段」那一段,决定你什么时候跑评测。5 分钟。
- [DeepSeek · Token 用量计算](https://api-docs.deepseek.com/zh-cn/quick_start/token_usage):官方对 token 和字符换算的说明和离线分词器的下载。今天我用实测代替它,你可以对照一下官方给的比例和我量出来的差多少。10 分钟。
- [Joel Spolsky · Evidence Based Scheduling](https://www.joelonsoftware.com/2007/10/26/evidence-based-scheduling/):用你过去的实际用时给未来排期的方法,讲「为什么每个人都低估自己」。和今天「留着偏差、记下往哪边偏」是同一个思路。英文,20 分钟。
- [Python 文档 · ast](https://docs.python.org/3/library/ast.html):今天用 `ast.parse` 把 import 语句读成树,看 `ImportFrom` 那一节就够。15 分钟。
- [Anthropic · Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):Day 438 看过。今天带着「每多一步多花多少钱」重读一遍「agent 要在成本和延迟上换性能」那几段。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1SxEV6qETL&autoplay=0&high_quality=1" title="token是什么?| AI是怎样计费的?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>哈基米学知识_ · token是什么?| AI是怎样计费的? · 3 分钟,播放 9 万多。把 token 和计费讲成人话,看完能说出输入和输出为什么分开收费。今天的估算算式就建在这个基础上。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/zduSFxRajkE" title="Let's build the GPT Tokenizer" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Andrej Karpathy · Let's build the GPT Tokenizer · 英文,2 小时多,可开自动字幕。不用全看,看开头讲「为什么中文、日文、代码比英文更费 token」的那一段,就是今天 `token_ratio.py` 量出三个不同比例的原因。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/wUGiIdqjDdk" title="TECH IN 5 MINUTES | HOW TO ESTIMATE SOFTWARE DEVELOPMENT PROJECTS" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Jelvix · TECH IN 5 MINUTES: How to Estimate Software Development Projects · 英文,5 分钟。一家外包公司讲怎么估软件项目,偏商业,但「先拆任务、再看依赖、留缓冲」这几步和今天的做法一致。</figcaption>
</figure>

### 书籍

- Fred Brooks《The Mythical Man-Month》(Addison-Wesley,1975 年首版,1995 年周年纪念版):软件项目排期的经典,「往落后的项目里加人只会更晚」就出自这里。中文版《人月神话》有清华大学出版社的版本,具体版次请按书名搜索。读第 2、3 章即可。
- Steve McConnell《Software Estimation: Demystifying the Black Art》(Microsoft Press,2006):专讲估算,重点是「给范围、不给单点」和「估算要用历史数据校准」。我只确认了英文版存在,没有查到可靠的中译本信息,所以只写原版。
- Chip Huyen《AI Engineering》(O'Reilly,2025):讲 AI 应用的成本、延迟和评测怎么权衡,和今天的 M13 是同一类问题。

### 开源项目与代码

- [openai/tiktoken](https://github.com/openai/tiktoken):OpenAI 的分词库,能离线数 token。它对应的是 OpenAI 的分词规则,不能直接代表 DeepSeek 的,但「用代码数 token」这件事可以先试。今天我选了更直接的做法:调一次 API 读 `usage`。

## 自测

1. 排期检查的两条规则是什么?各举一个今天抓到(或故意弄坏时抓到)的例子。

<details><summary>答案</summary>

规则一:每个方块必须落在内容日上,不能是复习日,也不能越界。故意把「混合检索」挪到 Day 454(复习日)时,被它抓到。规则二:文件 A 设计里 import 了 B,B 必须在 A 最后一次改动之前建好。今天抓到的真实例子是 `kb/ingest.py`(Day 449)要用 `llm.py`,但 `llm.py` 被排在 Day 457;故意弄坏时,把 `db.py` 推迟到 Day 451,`ingest.py` 和 `retriever.py` 都被抓到。

</details>

2. 为什么 `check_order` 比较时一边用「最早建」、一边用「最晚改」?

<details><summary>答案</summary>

要偏严。一个文件可能分几天写,比如 `nodes.py` 在 Day 460 建、Day 466 还在改。只要它的任何一次改动要用到另一个文件,那个文件就得先存在。用最晚的一次改动去对比被依赖文件最早出现的时间,才能抓到「改动发生在被依赖文件之前」。

</details>

3. 落后时先砍哪几天?依据是什么?

<details><summary>答案</summary>

顺序是第二作品、TypeScript 写 Agent、MCP server、Langfuse 接入。依据是 PRD 的指标:跑 `schedule.py` 看砍掉这些天之后,有没有指标彻底落空。前三项砍掉不影响任何指标;而砍工作台(Day 470–472)会让 M11 落空,砍知识库(Day 448–451)会让 M1 和 M2 落空,所以那些不能砍。

</details>

4. 今天为什么不直接用「一个汉字约 0.6 个 token」,而要自己量?量出来的结果是什么?

<details><summary>答案</summary>

分词器因模型而异,不同内容类型的比例差得更多。花 ¥0.0013 发 5 次 `max_tokens=1` 的请求,读 `prompt_tokens`,减去固定的空壳开销,得到:中文文章 1.6 字符/token,JSON 2.4,系统提示词 1.7,英文和 SQL 3.9。比一个「汉字 0.6 个」的口诀更适合今天这类混合内容的估算。

</details>

5. 今天估的平均每张工单 ¥0.0137,和 Day 463 的实测对比,偏差怎么看,为什么不回头改参数?

<details><summary>答案</summary>

政策类估高约 2 倍,账户类和退款类落在实测区间里,投诉类同一数量级。整体偏差在 0.5–2 倍,用来做预算够用。不改参数是因为估算的价值在「事先判断」:回头凑实测数,估算永远和实测一致,也就永远没有信息量。留着偏差,下次估算时就知道自己习惯往哪边偏。

</details>

6. **面试题**:「你的 Agent 每张工单大概花多少钱?你是怎么知道的?」

<details><summary>答案</summary>

我分两步答。开工前我用算式估:先实测了模型的 token 换算比例(中文 1.6 字符/token、JSON 2.4),把一张工单拆成分诊、若干轮工具调用、起草、质检几次调用,每次的输入拆成提示词、工具定义、检索资料、前面的工具结果,按价格算出政策类约 ¥0.01、退款类约 ¥0.027,加权平均约 ¥0.014,含评审约 ¥0.019,比我定的 ¥0.05 红线有 2.7 倍余量。然后开工后用账本实测对账:政策类我估高了约 2 倍,其余几类落在实测范围里,整体偏差在 0.5–2 倍。我发现成本的主要来源是 `act` 的工具轮数:每多一轮,后面每次调用的上下文都更长,多两轮比把检索资料砍半影响大得多。所以如果要降本,我先看工具轮数和是不是误开了思考模式,再考虑缓存和小模型路由。

</details>

## 明天预告

明天是 Day 440 · 第 63 周复习:毕业项目(Day 434–439)。这周六天的内容零散:部署和故障演练、选题、访谈、PRD、架构、排期和成本。明天把它们收成一张知识地图,每天一句话回顾,默写两段本周的核心代码(滑动窗口限流和相对 import 的换算),再写一个只用本周知识的小脚本 `review63.py`,把 PRD、架构表、排期、成本四份文件做一次交叉对账,看它们互相之间有没有对不上的地方。
