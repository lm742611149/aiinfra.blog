---
title: 'Day 519 · 进阶开学(二):进阶地图和学习方式,第一份 ADR'
description: '进阶篇 131 天的地图写成一段能跑的数据,再用昨天的八维度自评算出哪几块该多花时间;然后换学法:读一手资料用三遍法加三行笔记,脚本检查笔记够不够具体;最后写第一份 ADR,理由里的数字全来自本机实测(不建索引时 5 万行检索 P95 是 436 毫秒,建了 HNSW 是 20 毫秒),并用脚本检查「什么时候推翻这个决定」是不是写成了能检查的条件。练习里还有一个反转:我想写「模型会算错」,测了 20 次全对,这条理由就被删了。'
pubDate: 2026-10-27
regime: none
tags: ['adr', 'learning', 'senior', 'pgvector', 'agent-zero']
series: 'agent-zero'
day: 519
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 518](/blog/agent-zero/day-518-senior-gap/) 用招聘数据看了「资深」贵多少,又给了一张八个维度的能力表(设计、评测、规模、平台、模型、稳定性、信息源、影响力),让你写 `ladder.json`、跑 `ladder.py` 找出最低的三项。那天的模拟学员小林有一条自评证据是「SupportPilot 选 pgvector 当时没写原因」,设计这一项只拿了 2 分。今天先把进阶篇的整张地图摆出来,再换一种学法,最后就拿小林这条没写原因的决定,补写成这门课的第一份 ADR。

## 今天要解决的问题

学完这一课你应该能:

1. 说出进阶篇 131 天分哪几块、每块产出什么,并且用自己的 `ladder.json` 算出哪几块该多花时间、哪几块可以快速过。
2. 用三遍法读一篇一手资料,留下一份三行笔记,并用 `note.py` 检查笔记是不是够具体。
3. 写出第一份 ADR,理由里的每个数字都能指到一次测量,重新评估的条件每一条都能被检查,并用 `adr_check.py` 验证。
4. 说出 ADR 和普通技术说明的区别,以及为什么「理由」必须是测出来的。

预计用时 3 小时,一半在读和写,一半在跑脚本。前置:[Day 518](/blog/agent-zero/day-518-senior-gap/)(`part09/senior/ladder.py` 和 `me/ladder.json`)、[Day 443](/blog/agent-zero/day-443-database/)(`kb.chunks` 表和 HNSW 索引)、[Day 438](/blog/agent-zero/day-438-architecture/)(SupportPilot 的几个设计决定)、[Day 225](/blog/agent-zero/day-225-numpy-index/) 和 [Day 226](/blog/agent-zero/day-226-retrieve-answer/) 用 numpy 做过的内存检索。

实跑花费约 ¥0.003:只有练习 2 里让模型算 20 次算术题,输入 1380 token、输出 60 token,按 `LLM_PRICE=0.04,2,8`(元每百万 token)是 ¥0.0032。其余全是本机脚本和本机 Postgres,花费为 0。

今天的新代码放在 `agent-zero-lab/part10/adr_demo/`。学法提示:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `adr_check.py` 里的 `problems` 函数;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 进阶篇的地图

进阶篇从 Day 518 到 Day 648,一共 131 天。普通篇教你把东西做出来,进阶篇教的是判断:选哪个、证据是什么、什么时候该换。内容分十二块,下面的图里宽度和天数成正比:

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="进阶篇 131 天的时间线,从 Day 518 到 Day 648,分十二块,宽度和天数成正比">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="10" text-anchor="middle">
    <rect x="20.0" y="90" width="9.2" height="36" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <line x1="24.6" y1="78" x2="24.6" y2="90" stroke="var(--rule)"/>
    <text x="24.6" y="72" fill="var(--ink)">开学</text>
    <text x="24.6" y="60" fill="var(--ink-faint)">518–519</text>
    <rect x="29.2" y="90" width="27.5" height="36" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <line x1="42.9" y1="126" x2="42.9" y2="138" stroke="var(--rule)"/>
    <text x="42.9" y="150" fill="var(--ink)">Harness</text>
    <text x="42.9" y="162" fill="var(--ink-faint)">520–525</text>
    <rect x="56.6" y="90" width="27.5" height="36" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <line x1="70.4" y1="78" x2="70.4" y2="90" stroke="var(--rule)"/>
    <text x="70.4" y="72" fill="var(--ink)">上下文</text>
    <text x="70.4" y="60" fill="var(--ink-faint)">526–531</text>
    <rect x="84.1" y="90" width="13.7" height="36" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <line x1="91.0" y1="126" x2="91.0" y2="138" stroke="var(--rule)"/>
    <text x="91.0" y="150" fill="var(--ink)">记忆</text>
    <text x="91.0" y="162" fill="var(--ink-faint)">532–534</text>
    <rect x="97.9" y="90" width="41.2" height="36" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <line x1="118.5" y1="78" x2="118.5" y2="90" stroke="var(--rule)"/>
    <text x="118.5" y="72" fill="var(--ink)">持久化·设计文档</text>
    <text x="118.5" y="60" fill="var(--ink-faint)">535–543</text>
    <rect x="139.1" y="90" width="87.0" height="36" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <line x1="182.6" y1="126" x2="182.6" y2="138" stroke="var(--rule)"/>
    <text x="182.6" y="150" fill="var(--ink)">评测科学</text>
    <text x="182.6" y="162" fill="var(--ink-faint)">544–562</text>
    <rect x="226.1" y="90" width="18.3" height="36" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <line x1="235.3" y1="78" x2="235.3" y2="90" stroke="var(--rule)"/>
    <text x="235.3" y="72" fill="var(--ink)">选模型</text>
    <text x="235.3" y="60" fill="var(--ink-faint)">563–566</text>
    <rect x="244.4" y="90" width="73.3" height="36" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <line x1="281.1" y1="126" x2="281.1" y2="138" stroke="var(--rule)"/>
    <text x="281.1" y="150" fill="var(--ink)">模型层</text>
    <text x="281.1" y="162" fill="var(--ink-faint)">567–582</text>
    <rect x="317.7" y="90" width="96.2" height="36" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <line x1="365.8" y1="78" x2="365.8" y2="90" stroke="var(--rule)"/>
    <text x="365.8" y="72" fill="var(--ink)">平台化与规模</text>
    <text x="365.8" y="60" fill="var(--ink-faint)">583–603</text>
    <rect x="413.9" y="90" width="91.6" height="36" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <line x1="459.7" y1="126" x2="459.7" y2="138" stroke="var(--rule)"/>
    <text x="459.7" y="150" fill="var(--ink)">前沿形态</text>
    <text x="459.7" y="162" fill="var(--ink-faint)">604–623</text>
    <rect x="505.5" y="90" width="73.3" height="36" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <line x1="542.1" y1="78" x2="542.1" y2="90" stroke="var(--rule)"/>
    <text x="542.1" y="72" fill="var(--ink)">AgentOps</text>
    <text x="542.1" y="60" fill="var(--ink-faint)">624–639</text>
    <rect x="578.8" y="90" width="41.2" height="36" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <line x1="599.4" y1="126" x2="599.4" y2="138" stroke="var(--rule)"/>
    <text x="599.4" y="150" fill="var(--ink)">求职</text>
    <text x="599.4" y="162" fill="var(--ink-faint)">640–648</text>
  </g>
  <text x="320" y="210" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">宽度和天数成正比。复习日穿插在每块里,没有单独列</text>
</svg>
<figcaption>进阶篇 131 天的十二块。评测科学(19 天)、平台化与规模(21 天)、前沿形态(20 天)、模型层(16 天)、AgentOps(16 天)占了大头。</figcaption>
</figure>

每一块在做什么,用一句话讲:

| 块 | Day | 要做出来的东西 |
| --- | --- | --- |
| 开学 | 518–519 | 能力表、第一份 ADR |
| Harness | 520–525 | 读三家源码,给 AgentOps 写 harness |
| 上下文进阶 | 526–531 | 上下文腐烂的实验、缓存友好的设计、分层上下文管理器 |
| 记忆系统 | 532–534 | 给 SupportPilot 写客户记忆并评测 |
| 持久化、编排取舍、设计文档 | 535–543 | 持久化运行器、四种架构的对比实验、AgentOps 运行时设计文档和两份 ADR |
| 评测科学 | 544–562 | 通过率区间、配对比较、bootstrap、样本量,CloudLedger-Bench,评测平台设计 |
| 选模型 | 563–566 | 用自己的评测集对比模型,路由和总拥有成本 |
| 模型层 | 567–582 | 自部署、微调、DPO、蒸馏、强化学习,训练一个路由小模型 |
| 平台化与规模 | 583–603 | 多租户、模型网关、MCP 网关、Agent 身份、规模化可观测、合规、事故复盘 |
| 前沿形态 | 604–623 | Coding Agent 内部、Computer Use、语音、Deep Research、A2A、支付、产品交互、选型报告 |
| AgentOps 项目 | 624–639 | 把前面的零件拼成一个平台 |
| 资深求职与影响力 | 640–648 | 设计文档、Staff 系统设计面试、带人、开源、结业 |

**贯穿的项目是 AgentOps。** 设想云簿公司的 SupportPilot 做成功以后,销售、财务、运维几个团队都想要自己的 Agent。每个团队从头写一遍模型调用、工具鉴权、评测和监控,三个月后公司里会有五套互不兼容的轮子。AgentOps 就是把这些共性收到一个平台里。它在 Day 624 才正式开题,前面每一块都在给它准备零件。仓库 Day 625 才建,但**今天先建一个目录 `agentops/docs/adr/`**,进阶篇每做一个重要决定,就往这里放一份 ADR,下面会讲怎么写。

### 把地图写成数据,算出哪几块该多花时间

地图只是一张表,但写成数据有个好处:可以检查它。`senior_map.py` 把十二块写成列表,用一个断言确认 Day 518 到 Day 648 每一天恰好属于一个块,再拿 Day 518 的八维度自评,算每一块「最低分」,也就是它训练的维度里你自评最低的那个。

```python
# agent-zero-lab/part10/adr_demo/senior_map.py
"""进阶篇 131 天的地图写成数据,并用 Day 518 的八维度自评,算出哪几块要多花时间。
用法: uv run python -m part10.adr_demo.senior_map ../me/ladder.json"""
import json
import sys
from dataclasses import dataclass
from pathlib import Path

from part09.senior.ladder import DIMS, effective


@dataclass
class Block:
    name: str
    first: int
    last: int
    output: str
    dims: tuple[str, ...]  # 这一块主要训练 Day 518 八维度里的哪几个


BLOCKS = [
    Block("开学", 518, 519, "能力表、第一份 ADR", ("信息源", "设计")),
    Block("Harness", 520, 525, "mini_harness、给 AgentOps 的 harness", ("设计", "平台")),
    Block("上下文进阶", 526, 531, "分层上下文管理器和对比实验", ("设计", "规模")),
    Block("记忆系统", 532, 534, "给 SupportPilot 写客户记忆并评测", ("设计",)),
    Block("持久化、编排取舍、设计文档", 535, 543, "持久化运行器、运行时设计文档、两份 ADR", ("稳定性", "设计")),
    Block("评测科学", 544, 562, "统计工具、CloudLedger-Bench、评测平台设计", ("评测",)),
    Block("选模型", 563, 566, "多模型路由和总拥有成本", ("模型",)),
    Block("模型层", 567, 582, "自部署、微调、DPO、蒸馏、强化学习、路由小模型", ("模型",)),
    Block("平台化与规模", 583, 603, "多租户、网关、MCP 网关、身份、可观测、合规、事故", ("平台", "规模", "稳定性")),
    Block("前沿形态", 604, 623, "Coding Agent、Computer Use、语音、Deep Research、A2A、支付、产品", ("信息源", "设计")),
    Block("AgentOps 项目", 624, 639, "把前面的零件拼成平台", ("平台", "规模", "稳定性")),
    Block("资深求职与影响力", 640, 648, "设计文档、Staff 系统设计面试、带人、开源、结业", ("影响力",)),
]


def check_coverage() -> None:
    """Day 518 到 Day 648 每一天恰好属于一个块,不漏不重。"""
    days = [d for b in BLOCKS for d in range(b.first, b.last + 1)]
    assert days == list(range(518, 649)), "地图有漏天或重叠"


def plan(mine: dict[str, dict[str, object]]) -> list[tuple[str, int, int]]:
    """每块的「最低分」= 它训练的维度里自评最低的那个;越低越该多花时间。"""
    rows = [(b.name, min(effective(mine.get(d, {})) for d in b.dims), b.last - b.first + 1) for b in BLOCKS]
    return sorted(rows, key=lambda r: r[1])


if __name__ == "__main__":
    check_coverage()
    print(f"地图共 {sum(b.last - b.first + 1 for b in BLOCKS)} 天,{len(BLOCKS)} 块,覆盖 Day 518–648 无遗漏")
    mine = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    print("八维度:", list(DIMS))
    print("块 | 最低分 | 天数 | 建议")
    for name, low, n in plan(mine):
        tip = "多花时间,练习都做" if low <= 1 else "认真做" if low == 2 else "快速过,做自测" if low >= 4 else "正常"
        print(f"{name} | {low} | {n} | {tip}")
```

<div class="line-notes">

- `from part09.senior.ladder import DIMS, effective` 这是 Day 518 建的 `part09/senior/ladder.py`。`DIMS` 是八个维度的字典,`effective` 是「没写证据最多算 2 分」那条规矩。直接复用,不重写。
- `class Block:` 一个块的数据袋:名字、起止天、产出、训练哪些维度。
- `dims: tuple[str, ...]  # 这一块主要训练 Day 518 八维度里的哪几个` `tuple[str, ...]` 是「任意长度的字符串元组」。这个对应关系是我手填的:比如平台化与规模训练平台、规模、稳定性三项。
- `BLOCKS = [` 十二块,和上面的图、表一致。
- `days = [d for b in BLOCKS for d in range(b.first, b.last + 1)]` 把所有块展开成一个天数列表。双层推导式,相当于 JS 的 `BLOCKS.flatMap(b => range(b.first, b.last))`。
- `assert days == list(range(518, 649)), "地图有漏天或重叠"` 展开后必须正好是 518 到 648。有漏天或重叠,列表就对不上。`range(518, 649)` 不含 649。
- `rows = [(b.name, min(effective(mine.get(d, {})) for d in b.dims), b.last - b.first + 1) for b in BLOCKS]` 每块算三样:名字、训练的维度里最低的有效分、天数。`mine.get(d, {})` 取不到的维度按空字典算,`effective` 会给它默认 1 分(没证据)。
- `return sorted(rows, key=lambda r: r[1])` 按最低分升序,最低的排最前面。`sorted` 是稳定排序,分数相同的保持原来的天数顺序。
- `tip = "多花时间,练习都做" if low <= 1 else "认真做" if low == 2 else "快速过,做自测" if low >= 4 else "正常"` 连续的三元表达式,从左往右判断。3 分落到最后的「正常」。

</div>

```bash
uv run python -m part10.adr_demo.senior_map ../me/ladder.json
```

用 Day 518 小林的 `ladder.json`,真实输出:

```text
地图共 131 天,12 块,覆盖 Day 518–648 无遗漏
八维度: ['设计', '评测', '规模', '平台', '模型', '稳定性', '信息源', '影响力']
块 | 最低分 | 天数 | 建议
Harness | 1 | 6 | 多花时间,练习都做
平台化与规模 | 1 | 21 | 多花时间,练习都做
AgentOps 项目 | 1 | 16 | 多花时间,练习都做
资深求职与影响力 | 1 | 9 | 多花时间,练习都做
开学 | 2 | 2 | 认真做
上下文进阶 | 2 | 6 | 认真做
记忆系统 | 2 | 3 | 认真做
持久化、编排取舍、设计文档 | 2 | 9 | 认真做
选模型 | 2 | 4 | 认真做
模型层 | 2 | 16 | 认真做
前沿形态 | 2 | 20 | 认真做
评测科学 | 4 | 19 | 快速过,做自测
```

第一行是断言通过:131 天、12 块,没有漏天。然后小林的建议:Harness、平台化与规模、AgentOps 项目、资深求职与影响力四块的最低分是 1(他的平台和影响力都是 1 分),要多花时间;评测科学是 4 分,快速过。**注意有 7 块是 2 分,几乎没有可以跳过的**,这是小林的真实水平。这张表不是让你挑着学,课还是从 Day 518 一天天往下走;它告诉你在哪里要放慢、练习一道不落,在哪里可以只做自测。

## 学习方式要换了

普通篇每天有一段能照着敲的代码。进阶篇也有,但多了四种做法。

**读一手资料。** Anthropic、OpenAI、LangChain、Cognition、Manus 这几家的工程博客,是目前 Agent 工程最好的教材,比二手解读准确得多。论文也要开始读。但「读」要有方法,不然一周读了十篇什么也没留下。

**读源码。** 文档告诉你怎么用,源码告诉你它怎么取舍。后天的 [Day 521](/blog/agent-zero/day-521-harness-sources/) 就是读三家 Agent SDK 的源码,方法是带着问题去找答案,不从头读到尾。

**做实验,而不是看结论。** 网上关于「哪种方案更好」的结论多半是在别人的任务上测的。今天的 ADR 就是一例:理由里的数字都是我在本机量的,马上讲。评测统计学从 [Day 547](/blog/agent-zero/day-547-eval-stats-1/) 起会系统地教怎么让这种实验靠得住。

**写文档。** 每个重要决定留一页纸。资深工程师写文档的时间往往比写代码多,因为一页好文档能让五个人少走一个月弯路。今天先学最短的一种:ADR。

### 读一手资料:三遍法加三行笔记

论文这件事,我用 S. Keshav 2007 年那篇《How to Read a Paper》里的三遍法(我读了原文 PDF,下面的时间是它写的):

- **第一遍,五到十分钟**,只看标题、摘要、引言、各级小标题和结论,不读细节。目的是决定值不值得读第二遍。
- **第二遍,最多一小时**,读正文但先跳过证明之类的细节,看图表,结束时你应该能向别人概括这篇的主要论点和证据。
- **第三遍,新手四五个小时、熟手约一小时**,在脑子里把它复现一遍,每个假设都挑战一下。

不是每篇都要读到第三遍。大部分资料读到第一遍就够了,少数值得读第二遍,只有直接影响你系统的才读第三遍。**最重要的是读完之后留下东西。** 我的习惯是每篇三行:它说了什么;证据是什么;我的系统要不要跟着改。再加一行「读到哪」,诚实地标出自己读到第几遍,免得过两个月自己都分不清是读透了还是扫过。

`note.py` 做两件事:建一个有四个字段的骨架,检查已有的笔记够不够具体。检查规则很简单,但每一条都是在防一种偷懒。

```python
# agent-zero-lab/part10/adr_demo/note.py
"""读一手资料的「三行笔记」:建骨架、查格式。
用法: uv run python -m part10.adr_demo.note new <名字> <链接>
      uv run python -m part10.adr_demo.note check"""
import re
import sys
from pathlib import Path

DIR = Path("notes/papers")
FIELDS = ("读到哪", "说了什么", "证据", "要不要改我的系统")
DEPTH = ("摘要", "第一遍", "第二遍", "第三遍")  # 对应 Keshav 的三遍法,外加只读了摘要
DECISION = ("改", "不改", "待实验")


def new(name: str, url: str) -> Path:
    path = DIR / f"{name}.md"
    DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(f"# {name}\n\n链接:{url}\n\n读到哪:\n说了什么:\n证据:\n要不要改我的系统:\n", encoding="utf-8")
    return path


def problems(text: str) -> list[str]:
    got = {k: v.strip() for k, v in re.findall(r"^(读到哪|说了什么|证据|要不要改我的系统):(.*)$", text, re.M)}
    out = [f"缺「{k}」或内容为空" for k in FIELDS if not got.get(k)]
    if got.get("读到哪") and not any(got["读到哪"].startswith(d) for d in DEPTH):
        out.append(f"「读到哪」要以 {'/'.join(DEPTH)} 之一开头,拿到:{got['读到哪'][:12]}")
    if got.get("证据") and not (re.search(r"\d", got["证据"]) or "「" in got["证据"]):
        out.append("「证据」里没有数字,也没有「原文引用」")
    if got.get("要不要改我的系统") and not any(got["要不要改我的系统"].startswith(d) for d in DECISION):
        out.append(f"「要不要改我的系统」要以 {'/'.join(DECISION)} 之一开头")
    return out


if __name__ == "__main__":
    if sys.argv[1] == "new":
        print("建好了:", new(sys.argv[2], sys.argv[3]))
    else:
        bad = 0
        for f in sorted(DIR.glob("*.md")):
            ps = problems(f.read_text(encoding="utf-8"))
            bad += bool(ps)
            print(f"{f.name}: {'OK' if not ps else '; '.join(ps)}")
        sys.exit(1 if bad else 0)
```

<div class="line-notes">

- `FIELDS = ("读到哪", "说了什么", "证据", "要不要改我的系统")` 四个字段,前三个是「三行」,多出来的「读到哪」是我自己加的诚实标记。
- `DEPTH = ("摘要", "第一遍", "第二遍", "第三遍")  # 对应 Keshav 的三遍法,外加只读了摘要` 「读到哪」必须以这四个词之一开头。多一个「摘要」,因为很多时候你只读了摘要,硬说成第一遍不诚实。
- `DECISION = ("改", "不改", "待实验")` 「要不要改我的系统」只有三种答案。写「可能吧」不算。
- `path.write_text(f"# {name}\n\n链接:{url}\n\n读到哪:\n说了什么:\n证据:\n要不要改我的系统:\n", encoding="utf-8")` 建骨架,四个字段留空等你填。
- `got = {k: v.strip() for k, v in re.findall(r"^(读到哪|说了什么|证据|要不要改我的系统):(.*)$", text, re.M)}` 用正则把四个字段读成字典。`re.M` 让 `^` 和 `$` 匹配每一行的开头结尾。`re.findall` 返回的每项是两个括号捕获的元组,正好拆成键和值。
- `out = [f"缺「{k}」或内容为空" for k in FIELDS if not got.get(k)]` 缺字段、字段为空,都算缺。
- `if got.get("读到哪") and not any(got["读到哪"].startswith(d) for d in DEPTH):` 「读到哪」的开头必须是那四个词之一。`startswith` 接受单个字符串,所以用 `any(... for d in DEPTH)` 逐个试。
- `if got.get("证据") and not (re.search(r"\d", got["证据"]) or "「" in got["证据"]):` 证据里必须有数字,或者有一段原文引用(用「」标出来)。这条防的是写「写得很好」「很有启发」这种空话。
- `if got.get("要不要改我的系统") and not any(got["要不要改我的系统"].startswith(d) for d in DECISION):` 开头必须是改、不改、待实验。注意「不改」也满足 `startswith("不改")`。
- `sys.exit(1 if bad else 0)` 有问题就以非零状态退出,以后可以挂进 CI。

</div>

我用 ReAct 那篇论文(arXiv 2210.03629,[链接](https://arxiv.org/abs/2210.03629))做一个例子。**我只读了标题和摘要,所以「读到哪」写的是「摘要」**,这是诚实标记的用处:

```bash
uv run python -m part10.adr_demo.note new react-2022 https://arxiv.org/abs/2210.03629
```

编辑 `notes/papers/react-2022.md` 成这样:

```text
# react-2022

链接:https://arxiv.org/abs/2210.03629

读到哪:摘要(只读了标题和摘要,没读正文)
说了什么:ReAct 让模型交替写出「推理」和「动作」,动作的结果再喂回去,用在需要查外部信息的任务上。
证据:摘要称在 ALFWorld 和 WebShop 两个基准上,绝对成功率比模仿学习和强化学习方法分别高 34% 和 10%,而且只用了一两个示例提示。
要不要改我的系统:不改。SupportPilot 的 act 节点本来就是「想一步、调工具、看结果」的循环(Day 266),这篇是它的出处;数字来自 2022 年的任务和模型,不能直接当今天的收益。
```

(34% 和 10% 是摘要里的原话数字:我用 WebFetch 查证了摘要。)再写一份故意糊弄的 `notes/papers/bad.md` 看检查脚本怎么说:

```text
# bad

读到哪:看了一下
说了什么:很有启发。
证据:写得很好。
要不要改我的系统:可能吧
```

```bash
uv run python -m part10.adr_demo.note check
```

我把 `bad.md` 和另外两份笔记(ReAct 和下面练习 3 的那份)放一起跑,真实输出:

```text
bad.md: 「读到哪」要以 摘要/第一遍/第二遍/第三遍 之一开头,拿到:看了一下; 「证据」里没有数字,也没有「原文引用」; 「要不要改我的系统」要以 改/不改/待实验 之一开头
building-effective-agents-2024.md: OK
react-2022.md: OK
```

`bad.md` 被抓了三处:「读到哪」不是规定的开头、「证据」既没数字也没引用、「要不要改」不是三种答案之一。「很有启发」「写得很好」这类话一条也过不了。查完把 `bad.md` 删掉。

最后一句「数字来自 2022 年的任务和模型,不能直接当今天的收益」是我故意写进笔记的。**一手资料的数字有时效和范围**,这一点在 Day 541 讲「架构不是一次性的决定」时会再回来。

## 第一份 ADR:SupportPilot 知识库为什么用 pgvector

### ADR 是什么,和 README 有什么区别

ADR(Architecture Decision Record,架构决策记录)记**一个**决定,一页纸,写完只追加不修改。它和技术说明的区别是它记的不是「系统现在是什么样」,而是「当时为什么这么选、什么情况下该改主意」。三个月后有人问「为什么不用 Milvus」,你不用凭记忆现编,翻出那页纸就行。

格式我用六块:状态、背景、考虑过的方案、决定、理由、代价和重新评估的条件。**最后一块是 ADR 和普通技术说明的分界线。** 没有它,你写的是一份说明书;有了它,你写的是一个可以被检验、可以被推翻的判断。

### 先做实验:找到「重新评估的条件」里的数字

昨天小林的自评证据是「选 pgvector 当时没写原因」。补写的时候,最容易的写法是:「数据量小,pgvector 够用;数据超过 500 万向量再考虑 Milvus。」这句话读起来合理,但「500 万」是哪来的?是我随口编的一个常见数字,没有任何测量支撑。

所以先量。问题是:**向量检索在我们的机器上,随行数增长会慢到什么程度,索引有没有用?** 在本机 Postgres 里自己新建一个临时库,造不同行数的向量,量检索耗时。向量是随机造的(不是真 embedding),这一点很重要:**全表扫描的耗时只取决于行数和维度,和向量内容无关,所以可信;HNSW 的召回率取决于数据分布,随机数据上不可信,所以今天只量延迟,不量召回。**

准备:

```bash
uv add "psycopg[binary]" pgvector
psql postgres -c "create database agentzero_adr_demo"
psql agentzero_adr_demo -c "create extension vector"
```

(本机的 Postgres.app 带 pgvector,我这里是 0.8.6;自己新建的库,用完删掉。Postgres 17.11。)

```python
# agent-zero-lab/part10/adr_demo/pgvector_scale.py
"""给 ADR 的「重新评估条件」找数字:在本机 Postgres 的临时库里,量一量向量检索随行数怎么变慢。
向量是随机造的(不是真 embedding),所以「全表扫描」的耗时可信(只看行数×维度),HNSW 的召回率不可信,这里不测。
用法: uv run python -m part10.adr_demo.pgvector_scale"""
import statistics
import time

import psycopg

DSN = "postgresql://minliu@localhost:5432/agentzero_adr_demo"
DIM = 1024  # 和 SupportPilot 用的 bge-m3 一致
QUERIES = 30


def p(xs: list[float], q: float) -> float:
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(q * len(xs)))]


def timings(cur: psycopg.Cursor, table: str) -> list[float]:
    out = []
    for _ in range(QUERIES):
        cur.execute(f"select array_agg(random()::real) from generate_series(1,{DIM})")
        row = cur.fetchone()
        assert row is not None
        qv = "[" + ",".join(f"{x:.4f}" for x in row[0]) + "]"
        t0 = time.perf_counter()
        cur.execute(f"select id from {table} order by embedding <=> %s::vector limit 5", (qv,))
        cur.fetchall()
        out.append((time.perf_counter() - t0) * 1000)
    return out


with psycopg.connect(DSN, autocommit=True) as conn, conn.cursor() as cur:
    print(f"{'行数':>8} {'索引':<6} {'建表+造数据':>10} {'P50 ms':>8} {'P95 ms':>8}")
    have = 0
    for n in (1_000, 10_000, 50_000):
        t0 = time.perf_counter()
        cur.execute("create table if not exists v (id int primary key, embedding vector(1024))")
        cur.execute(
            f"insert into v select g, (select array_agg(random()::real) from generate_series(1,{DIM}) s where s > g*0)::vector "
            f"from generate_series({have + 1},{n}) g")
        have = n
        cur.execute("analyze v")
        build = time.perf_counter() - t0
        ts = timings(cur, "v")
        print(f"{n:>8} {'无':<6} {build:>9.1f}s {statistics.median(ts):>8.1f} {p(ts, 0.95):>8.1f}")
    t0 = time.perf_counter()
    cur.execute("create index on v using hnsw (embedding vector_cosine_ops)")
    ib = time.perf_counter() - t0
    ts = timings(cur, "v")
    print(f"{have:>8} {'HNSW':<6} 建索引 {ib:>5.1f}s {statistics.median(ts):>8.1f} {p(ts, 0.95):>8.1f}")
```

<div class="line-notes">

- `DSN = "postgresql://minliu@localhost:5432/agentzero_adr_demo"` 连接串。用户名换成你自己的(Postgres.app 默认用你的系统用户名,无密码),库名就是上面新建的那个。
- `DIM = 1024  # 和 SupportPilot 用的 bge-m3 一致` 维度要和真实使用的一致,因为扫描耗时和维度成正比。
- `def p(xs: list[float], q: float) -> float:` 取分位数。排序后取第 `q * 长度` 个。`q=0.95` 就是 P95:95% 的查询比这个快。
- `xs[min(len(xs) - 1, int(q * len(xs)))]` 30 个样本的 P95 下标是 `int(0.95*30)=28`,第 29 快的。`min(...)` 防下标越界。
- `cur.execute(f"select array_agg(random()::real) from generate_series(1,{DIM})")` 让数据库自己造一个 1024 维的随机向量当查询。`generate_series(1,1024)` 生成 1 到 1024,`array_agg(random()::real)` 把 1024 个随机数收成数组。
- `qv = "[" + ",".join(f"{x:.4f}" for x in row[0]) + "]"` 拼成 pgvector 认的字面量 `[0.1234,0.5678,...]`。
- `cur.execute(f"select id from {table} order by embedding <=> %s::vector limit 5", (qv,))` 真正被计时的查询:按余弦距离(`<=>`)排序取前 5。`%s` 是参数占位,值通过元组传,不拼进字符串。
- `out.append((time.perf_counter() - t0) * 1000)` 计时只包住这条查询,单位换成毫秒。`perf_counter` 是 Python 里最适合测短时间的计时器。
- `autocommit=True` 每条语句自己提交,`create index` 之类不用手动 commit。
- `for n in (1_000, 10_000, 50_000):` 数据量逐步加到 1000、1 万、5 万。`1_000` 里的下划线是数字分隔符,只给人看。
- `f"insert into v select g, (select array_agg(random()::real) from generate_series(1,{DIM}) s where s > g*0)::vector "` 造数据。关键是 `where s > g*0`:这个条件永远为真,但它引用了外层的 `g`,逼数据库**每一行都重新算一遍**随机数组。不加这个条件,子查询只和 `g` 无关,会被算一次、所有行共用同一个向量,那样的测量是假的。
- `have = n` 记下已经有多少行,下一轮只补插新增的部分。
- `cur.execute("create index on v using hnsw (embedding vector_cosine_ops)")` 最后给 5 万行建 HNSW 索引,单独计时,再量一次查询。

</div>

```bash
uv run python -m part10.adr_demo.pgvector_scale
```

这个脚本在我的机器上总共跑了二十多分钟,其中建 HNSW 索引就占了 21 分钟。真实输出:

```text
      行数 索引         建表+造数据   P50 ms   P95 ms
    1000 无            0.2s      4.9      6.0
   10000 无            1.6s     45.5     48.2
   50000 无            7.5s    349.1    436.3
   50000 HNSW   建索引 1272.3s     10.4     20.3
```

怎么读这张表?不建索引的时候,1000 行 P95 是 6.0 ms,1 万行 48.2 ms,5 万行 436.3 ms,基本和行数成正比,这就是全表扫描。我们只有两三百块,6 ms 都用不到。如果将来涨到几万块不建索引,就会超过 200 ms 这种用户能感觉到卡的程度。建了 HNSW 之后,5 万行 P95 降到 20.3 ms,差 20 多倍,代价是建索引花了 1272 秒(约 21 分钟)。

这些数字有边界,我先写在这里,ADR 里也会写:**一台机器、一次运行、随机向量、30 次查询。** 换机器、换数据分布数字都会变。它们够当「重新评估的触发线」,但不能当「性能保证」。

### 写 ADR

数字有了,写 `agentops/docs/adr/0001-supportpilot-kb-pgvector.md`。(`agentops/` 仓库 Day 625 才正式建,到时整个目录搬过去;编号 0002 起已经预留给 [Day 543](/blog/agent-zero/day-543-design-doc-2/) 的两份。)

```markdown
# 0001 · SupportPilot 知识库的向量存在业务库里,用 pgvector

- 状态:已采纳(2026-10-27 补记;决定本身是 Day 438 做的)
- 数据来源:`part10/adr_demo/pgvector_scale.py` 在本机跑的实测,2026-10-27

## 背景

SupportPilot 的知识库是 CloudLedger 帮助中心的 60 多篇文章,按二级小节切块,每节一块,估计两三百块(Day 448 切完才有准确数字)。向量是 bge-m3 的 1024 维。业务数据(客户、订阅、发票)本来就在同一个 Postgres 里。维护这个系统的只有一个人。

## 考虑过的方案

1. pgvector:在业务库里加 `kb.chunks` 表,向量列加 HNSW 索引,按余弦距离检索。
2. 内存里用 numpy 算:Day 225、226 做过的写法,不用任何数据库。
3. Milvus 这类专用向量库:单独部署一个服务。

## 决定

知识库向量存在业务库的 `kb.chunks` 表里,用 pgvector 的 HNSW 索引检索。

## 理由

- 数据量小两个数量级。本机实测(Postgres 17.11、pgvector 0.8.6、1024 维随机向量、30 次查询):不建索引时,1000 行 P95 是 6.0 ms,1 万行 48.2 ms,5 万行 436.3 ms。我们的几百块连索引都不急着要,用不上专用库的优势。
- 但数据涨到几万块,不建索引就会超过 200 ms。5 万行建 HNSW 之后 P95 是 20.3 ms,所以索引要留着(Day 443 的建表语句里已经建了)。
- 检索结果要和业务表一起查(哪个客户、哪个套餐能看哪篇文章),放在同一个库里一条 SQL 就能 join,不用在应用里拼。
- 一个人维护,少一个服务就少一份备份、升级和值班。

## 代价和重新评估的条件

- 向量检索和业务查询抢同一个库的 CPU 和连接;HNSW 索引占内存。
- 换 embedding 模型、换维度,整张表要重新算一遍向量。
- 向量行数超过 5 万:重新测一遍。我只测到 5 万行,再往上没有数据。
- 带 HNSW 索引时检索 P95 超过 100 ms(5 万行时是 20.3 ms):重新评估专用向量库。
- 建 HNSW 索引耗时超过 30 分钟(5 万行随机向量在我这台机器上花了 1272 秒,约 21 分钟;真实数据的数字会不同)。
- 要做多租户之间的隔离检索时,重新评估。
```

对着看几处写法的取舍:

标题写的是**决定本身**:「知识库的向量存在业务库里,用 pgvector」。以后 `ls agentops/docs/adr/` 只看文件名就知道每份说了什么。「状态」里写「补记」,诚实说明这是事后补的,决定是 Day 438 做的。「考虑过的方案」列了三个,被放弃的两个(numpy、Milvus 一类)都是真实的候选:numpy 是 Day 225、226 自己写过的,专用向量库是面试官一定会问的。我**没有**写「Milvus 的多副本和权限控制弱」这种话,因为我没测过 Milvus,写了就是在说别人没验证的事。写的只是「它要单独部署一个服务」,这是方案本身的性质,和我们的约束(一个人维护)直接相关。

理由里每一个数字都指向上面那张表。「5 万行」「100 ms」「30 分钟」这三条重新评估的条件,都是从实测数字推出来的,并且各自带着括号标明「当前是多少」,读的人一眼就能判断条件到没到。最后一条「多租户隔离」没有数字,它是一个事件(出现了这种需求),也能被检查。

### 用脚本检查 ADR

ADR 最容易写成的样子是「以后有需要再评估」。这句话看着像条件,其实什么也没说:谁来判断「有需要」?什么时候算?`adr_check.py` 把这些偷懒的写法变成红灯:

```python
# agent-zero-lab/part10/adr_demo/adr_check.py
"""给 ADR 做格式体检:结构齐不齐、被放弃的方案有没有、理由有没有数字、「什么时候推翻」是不是可检查的。
用法: uv run python -m part10.adr_demo.adr_check agentops/docs/adr/*.md"""
import re
import sys
from pathlib import Path

SECTIONS = ["背景", "考虑过的方案", "决定", "理由", "代价和重新评估的条件"]
VAGUE = ("以后有需要", "视情况", "再说", "如有必要", "有需要再", "必要时")


def split_sections(text: str) -> dict[str, str]:
    parts = re.split(r"^## (.+)$", text, flags=re.M)
    return {parts[i].strip(): parts[i + 1].strip() for i in range(1, len(parts) - 1, 2)}


def problems(text: str) -> list[str]:
    out: list[str] = []
    if not re.match(r"# \d{4} · \S", text):
        out.append("第一行要写成「# 0001 · 一句话的决定」")
    m = re.search(r"^- 状态:(.*)$", text, re.M)
    if not m or not m.group(1).startswith(("提议", "已采纳", "已被取代")):
        out.append("缺「- 状态:」,或不是 提议/已采纳/已被取代")
    secs = split_sections(text)
    names = list(secs)
    missing = [s for s in SECTIONS if s not in secs]
    if missing:
        out.append("缺这几节:" + "、".join(missing))
    elif [n for n in names if n in SECTIONS] != SECTIONS:
        out.append("几节的顺序不对,应该是:" + " → ".join(SECTIONS))
    if "考虑过的方案" in secs:
        n = len(re.findall(r"^\d+\. ", secs["考虑过的方案"], re.M))
        if n < 3:
            out.append(f"「考虑过的方案」只有 {n} 项,至少要 3 项(选中的 1 个加至少 2 个被放弃的)")
    if "决定" in secs and len(secs["决定"]) > 80:
        out.append(f"「决定」有 {len(secs['决定'])} 个字符,超过 80:一句话说清做什么,理由放到「理由」里")
    if "理由" in secs and not re.search(r"\d", secs["理由"]):
        out.append("「理由」里一个数字都没有")
    if "代价和重新评估的条件" in secs:
        sec = secs["代价和重新评估的条件"]
        bullets = [b for b in re.findall(r"^- (.+)$", sec, re.M)]
        if not any(re.search(r"\d", b) for b in bullets):
            out.append("「重新评估的条件」里没有一条带数字:读的人没法检查「条件到了没有」")
        for v in VAGUE:
            if v in sec:
                out.append(f"「重新评估的条件」里有模糊说法「{v}」")
    return out


if __name__ == "__main__":
    bad = 0
    for arg in sys.argv[1:]:
        ps = problems(Path(arg).read_text(encoding="utf-8"))
        bad += bool(ps)
        print(f"{arg}: {'OK' if not ps else ''}")
        for p in ps:
            print("  -", p)
    sys.exit(1 if bad else 0)
```

<div class="line-notes">

- `SECTIONS = ["背景", "考虑过的方案", "决定", "理由", "代价和重新评估的条件"]` 五个必需的二级标题,顺序固定。
- `VAGUE = ("以后有需要", "视情况", "再说", "如有必要", "有需要再", "必要时")` 模糊说法的黑名单。这几个词出现在「重新评估的条件」里,就说明这一节没写具体。
- `parts = re.split(r"^## (.+)$", text, flags=re.M)` 按二级标题切开。因为正则里有一个括号捕获组,切出来的列表是「标题前的内容、标题1、内容1、标题2、内容2……」交替排列。
- `return {parts[i].strip(): parts[i + 1].strip() for i in range(1, len(parts) - 1, 2)}` 从下标 1 开始每隔两个取一个(标题),它后面一个就是内容,拼成字典。
- `if not re.match(r"# \d{4} · \S", text):` 第一行必须是 `# 0001 · 一句话`。`\d{4}` 是四位数字。`re.match` 只从开头匹配。
- `if not m or not m.group(1).startswith(("提议", "已采纳", "已被取代")):` 状态必须是三种之一。`startswith` 可以直接传元组。
- `elif [n for n in names if n in SECTIONS] != SECTIONS:` 五节都在时,按出现的顺序比较。多出来的别的二级标题会被过滤掉再比。
- `n = len(re.findall(r"^\d+\. ", secs["考虑过的方案"], re.M))` 数「1. 」「2. 」这样的编号项。
- `if n < 3:` 至少三项:选中的一个,加至少两个被放弃的。只有一项的 ADR 是在给已经做好的决定背书。
- `if "决定" in secs and len(secs["决定"]) > 80:` 「决定」一节超过 80 个字符,说明在里面塞了理由。
- `if "理由" in secs and not re.search(r"\d", secs["理由"]):` 理由里一个数字都没有,就是常识和感觉。
- `bullets = [b for b in re.findall(r"^- (.+)$", sec, re.M)]` 把「代价和重新评估的条件」里的每个短横线条目取出来。
- `if not any(re.search(r"\d", b) for b in bullets):` 至少有一条带数字。这是整个脚本最重要的一条:没有数字,读的人没法检查「条件到了没有」。
- `for v in VAGUE:` 逐个检查黑名单里的模糊词。

</div>

对着上面那份 ADR 和一份故意写烂的草稿各跑一次。草稿 `bad-draft.md` 的内容:

```markdown
# ADR: 用 pgvector

- 状态:想用

## 背景

我们需要向量库。

## 决定

用 pgvector,因为它很好用,社区也很活跃,而且和 Postgres 集成得很好,团队也比较熟悉这个东西。

## 理由

性能不错。

## 代价和重新评估的条件

- 以后有需要再评估。
```

```bash
uv run python -m part10.adr_demo.adr_check agentops/docs/adr/0001-supportpilot-kb-pgvector.md agentops/docs/adr/bad-draft.md
```

真实输出(我分两次跑的,这里拼在一起):

```text
agentops/docs/adr/0001-supportpilot-kb-pgvector.md: OK
```

```text
agentops/docs/adr/bad-draft.md: 
  - 第一行要写成「# 0001 · 一句话的决定」
  - 缺「- 状态:」,或不是 提议/已采纳/已被取代
  - 缺这几节:考虑过的方案
  - 「理由」里一个数字都没有
  - 「重新评估的条件」里没有一条带数字:读的人没法检查「条件到了没有」
  - 「重新评估的条件」里有模糊说法「以后有需要」
  - 「重新评估的条件」里有模糊说法「有需要再」
```

好的那份 `OK`。草稿被抓了六处:标题格式不对、状态不是规定的值、缺「考虑过的方案」、理由里没数字、重新评估的条件没有数字、还有两个模糊词(「以后有需要」和「有需要再」,同一句话命中了两个)。这和一份普通的技术说明相比,差别就在这里:草稿说了「用什么」,但没有一个字可以被检验。查完把 `bad-draft.md` 删掉,别留在 `adr/` 里。

**ADR 的三条规矩,记下来:** 一个决定一份;写完不改,决定变了就写新的一份并把旧的标成「已被取代」(Day 543 和 Day 640 会再讲);理由里的数字要来自测量。第三条我在练习 2 里让你亲眼看一次它为什么重要。

## 动手练习

### 练习 1:换一个人的自评,看地图怎么变

Day 518 的 `ladder_b.json` 是一个做了五年后端、刚转 Agent 的人:设计、规模、平台都是 4 分,稳定性 5 分,评测 2 分,模型 1 分,信息源 2 分,影响力 3 分。写出完整的 `me/ladder_b.json`(每一项要有证据,没证据按 2 分算),跑 `senior_map.py`,看这个人的进阶篇该怎么走。

<details><summary>参考答案</summary>

`me/ladder_b.json`:

```json
{
 "设计": {"score": 4, "evidence": "两份 ADR,docs/adr/0001、0002"},
 "评测": {"score": 2, "evidence": "30 条测试集,没做过显著性检验"},
 "规模": {"score": 4, "evidence": "压测报告 loadtest/report.md"},
 "平台": {"score": 4, "evidence": "内部模型网关,三个团队在用"},
 "模型": {"score": 1},
 "稳定性": {"score": 5, "evidence": "一份事故复盘 postmortem/2026-03.md"},
 "信息源": {"score": 2, "evidence": "偶尔看看"},
 "影响力": {"score": 3, "evidence": "带过一个实习生"}
}
```

```bash
uv run python -m part10.adr_demo.senior_map ../me/ladder_b.json
```

真实输出:

```text
地图共 131 天,12 块,覆盖 Day 518–648 无遗漏
八维度: ['设计', '评测', '规模', '平台', '模型', '稳定性', '信息源', '影响力']
块 | 最低分 | 天数 | 建议
选模型 | 1 | 4 | 多花时间,练习都做
模型层 | 1 | 16 | 多花时间,练习都做
开学 | 2 | 2 | 认真做
评测科学 | 2 | 19 | 认真做
前沿形态 | 2 | 20 | 认真做
资深求职与影响力 | 3 | 9 | 正常
Harness | 4 | 6 | 快速过,做自测
上下文进阶 | 4 | 6 | 快速过,做自测
记忆系统 | 4 | 3 | 快速过,做自测
持久化、编排取舍、设计文档 | 4 | 9 | 快速过,做自测
平台化与规模 | 4 | 21 | 快速过,做自测
AgentOps 项目 | 4 | 16 | 快速过,做自测
```

和小林完全反过来:小林要多花时间的 Harness、平台、AgentOps,这个人是 4 分,可以快速过、只做自测;他要多花时间的是选模型和模型层(模型只有 1 分)共 20 天,其次是评测科学、开学、前沿形态(2 分)。「资深求职与影响力」是 3 分,正常学。**同一张地图,不同的人该花的时间完全不同。** 这个人的 21 天平台化与规模可以快速过,省出的时间给 16 天的模型层。

注意 `senior_map.py` 里有一个简化:一块的最低分取的是它训练的维度里最低的那个,只要有一个短板整块就是短板。这会让「开学」「前沿形态」这类训练两个维度的块偏向被判成「认真做」。如果你觉得这不合理,可以改成取平均,看排序怎么变,这是练习之外的小实验。

</details>

### 练习 2:写第二份 ADR,并让实验推翻你的直觉

[Day 438](/blog/agent-zero/day-438-architecture/) 里 SupportPilot 有一个决定:退款规则写在 `tools/business.py` 的纯函数里,不放进提示词让模型算。把它写成 ADR(放在 `agentops/docs/adr-practice/`,不占 0002 起的编号)。**写之前先做一个实验**:我本来想把「模型会偶尔算错」当主要理由,请你先测一测。用 `deepseek-flash`,同一道题(月费 950 元,按年付费,已用 5 个月,剩余 7 个月,退款 = 月费 × 剩余月数 ÷ 12 × 0.9),温度 1.0,算 20 次,和 Python 的结果比。

<details><summary>参考答案</summary>

实验脚本 `part10/adr_demo/model_math.py`:

```python
# agent-zero-lab/part10/adr_demo/model_math.py
"""给 ADR 找数字:同一道退款算术题,让模型算 20 次,和 Python 的结果比。"""
import re

from common.llm import LLMClient

PROMPT = ("按下面的规则算退款金额。月费 950 元,按年付费,已用 5 个月,剩余 7 个月。"
          "规则:退款 = 月费 × 剩余月数 ÷ 12 × 0.9。只回答金额数字,保留两位小数,不要别的字。")
EXPECTED = round(950 * 7 / 12 * 0.9, 2)

client = LLMClient()
right, wrong = 0, []
for _ in range(20):
    r = client.chat([{"role": "user", "content": PROMPT}], temperature=1.0)
    nums = re.findall(r"\d+(?:\.\d+)?", r.content.replace(",", ""))
    got = float(nums[-1]) if nums else None
    if got == EXPECTED:
        right += 1
    else:
        wrong.append(r.content.strip()[:30])
print(f"Python 的答案: {EXPECTED}")
print(f"模型 20 次,答对 {right} 次;答错的: {wrong}")
print(client.ledger)
```

<div class="line-notes">

- `PROMPT = ("按下面的规则算退款金额。月费 950 元,按年付费,已用 5 个月,剩余 7 个月。"` 题目写清所有数字和公式,只要求回答金额。
- `EXPECTED = round(950 * 7 / 12 * 0.9, 2)` 用 Python 算标准答案:950×7÷12×0.9 = 498.75。
- `r = client.chat([{"role": "user", "content": PROMPT}], temperature=1.0)` 温度开到 1.0,让模型的随机性尽量大,更容易暴露「偶尔算错」。
- `nums = re.findall(r"\d+(?:\.\d+)?", r.content.replace(",", ""))` 从回答里抠出所有数字。先去掉千分位逗号。`(?:...)` 是不捕获的分组,只用来表示「小数部分可有可无」。
- `got = float(nums[-1]) if nums else None` 取最后一个数字当模型的答案;一个数字都没有就是 `None`,算错。
- `if got == EXPECTED:` 严格相等才算对。

</div>

```bash
uv run python -m part10.adr_demo.model_math
```

真实输出:

```text
Python 的答案: 498.75
模型 20 次,答对 20 次;答错的: []
20 次调用 | 输入 1380 / 输出 60 tokens | 约 ¥0.0032
```

**20 次全对。** 我原本打算写的理由「模型会算错」,在这道题上不成立。这是一个真实的反转,我把它留在文章里,是因为它正好示范了「理由必须是测出来的」:如果没有这个实验,我就会把一条凭感觉的理由写进 ADR,三个月后有人拿同样的题测一遍发现全对,整份 ADR 的可信度就塌了。

局限要说清楚:一道题,一个模型,一个提示。换成 7 条规则串起来、换个小模型、换个更长的上下文,结果可能不同。所以 ADR 里不写「模型算不对」,写的是我测过什么、没测过什么。

`agentops/docs/adr-practice/refund-rules-in-code.md`:

```markdown
# 0001 · 退款规则写在代码里,不放进提示词

- 状态:已采纳(练习示范;决定本身是 Day 438 做的)

## 背景

SupportPilot 的退款有 7 条规则(按剩余月数折算、手续费折扣、超过 1000 元转人工之类)。规则会随运营政策变,每次变动要保证老案例的结果不变。金额是要打到客户账上的钱。

## 考虑过的方案

1. 规则写成 Python 纯函数(`tools/business.py`),模型只负责理解客户要什么、选对工具、把结果讲清楚。
2. 规则写进系统提示词,让模型自己算金额。
3. 规则放进数据库配置表,运行时读出来,由运营在后台改。

## 决定

退款规则写成代码里的纯函数,模型不参与计算。

## 理由

- 我先测了「模型会不会算错」:同一道题(月费 950、剩余 7 个月、乘 0.9 折扣,答案 498.75),`deepseek-flash` 温度 1.0 下算了 20 次,20 次全对。所以「模型会算错」这条理由在这道题上不成立,我没有把它写进来。
- 真正的理由是可锁定:7 条规则配 7 个单元测试,改一条规则,测试立刻告诉你哪几个老案例变了。提示词里的规则没法这样一条条锁。
- 金额要可审计:同一张发票任何时候重算都是同一个数,出了争议能拿代码和输入复现。

## 代价和重新评估的条件

- 改规则要改代码、走合并请求,运营不能自己改。
- 规则条数超过 20 条时,重新评估放进配置表(方案 3):纯函数里的 if 会难读。
- 运营每月要改规则超过 3 次时,重新评估方案 3:每次都等发版太慢。
- 只测了一道题一个模型,换模型或换成多步规则后,用 `model_math.py` 的写法重测 20 次,模型全对且审计不再是要求时,才考虑让模型参与计算。
```

```bash
uv run python -m part10.adr_demo.adr_check agentops/docs/adr-practice/refund-rules-in-code.md
```

```text
agentops/docs/adr-practice/refund-rules-in-code.md: OK
```

「7 条规则 7 个单元测试」是 Day 438 里写的,我没有重数。「20 条」和「每月 3 次」是我设的触发线,没有测量依据,ADR 里它们的作用是让条件可检查,**不是**声称这个数是对的;真实项目里,这两个数该从规则的实际增长速度来定,所以我写在「条件」里,不写在「理由」里。

</details>

### 练习 3:读一篇一手资料,写三行笔记

读 Anthropic 的《Building effective agents》(2024 年 12 月 19 日发布,[链接](https://www.anthropic.com/engineering/building-effective-agents)),至少读到第一遍,写一份 `notes/papers/building-effective-agents-2024.md`,通过 `note.py check`。「读到哪」要诚实。

<details><summary>参考答案</summary>

我只做了第一遍:核对了文中两句关键原文,没有通读全文,所以「读到哪」写「第一遍」,并且写明范围:

```text
# building-effective-agents-2024

链接:https://www.anthropic.com/engineering/building-effective-agents

读到哪:第一遍(只核对了两句原文,没有通读)
说了什么:先用最简单的办法,确实不够再加复杂度;workflow 是代码决定路径,agent 是模型决定路径。
证据:「we recommend finding the simplest solution possible, and only increasing complexity when needed.」
要不要改我的系统:待实验。拿 Day 541 的架构对比实验,看混合架构比单 Agent 省的那部分成本,是不是真的值得多出来的代码。
```

文中还有一句定义:「Workflows are systems where LLMs and tools are orchestrated through predefined code paths.」我没有放进证据栏,证据栏一条够用。

你自己读完全文以后,「读到哪」应该写「第二遍」,「说了什么」可以展开成它列的几种 workflow 模式。「要不要改」写成「待实验」是合理的:一篇文章的建议不是你系统里的证据,得用自己的评测去验([Day 541](/blog/agent-zero/day-541-orch-2/) 就是这个实验)。

这份笔记和上面 ReAct 那份一起过了 `note.py check`(前面输出里已经有它们的两行 `OK`)。

</details>

**验收标准**:`part10/adr_demo/` 下有 `senior_map.py`、`note.py`、`pgvector_scale.py`、`adr_check.py`、`model_math.py`,都能跑;`agentops/docs/adr/0001-supportpilot-kb-pgvector.md` 过了 `adr_check`,理由里的每个数字你都能指到 `pgvector_scale.py` 的输出;`notes/papers/` 下至少有两份通过检查的笔记,「读到哪」都诚实;你能说出为什么「以后有需要再评估」不算一个重新评估的条件。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| ADR | Architecture Decision Record,架构决策记录。一页纸记一个决定的背景、方案、理由、代价和推翻条件。例:`0001-supportpilot-kb-pgvector.md` |
| 重新评估的条件 | ADR 里「什么情况下推翻这个决定」。必须可检查(带数字或明确的事件),「以后有需要」不算 |
| 三遍法 | Keshav 的读论文方法:第一遍 5 到 10 分钟看大意,第二遍最多一小时看内容,第三遍几小时到能复现 |
| 一手资料 | 工程博客、论文、官方文档这类原作者写的材料,和别人转述的文章相对 |
| P95 | 95% 的请求比这个数快。30 次查询里排第 29 快的耗时。比平均数更能反映「偶尔很慢」 |
| 全表扫描 | 没有索引时,检索要把每一行都算一遍距离。耗时和行数成正比 |
| HNSW | 一种向量索引(分层的近邻图),用近似换速度。查得快,建索引慢、占内存、结果是近似的 |
| `<=>` | pgvector 里的余弦距离运算符。`order by embedding <=> 查询向量 limit 5` 取最近的 5 个 |
| 补记 | 决定已经做了,事后补写 ADR。状态里要诚实标出,别假装是当时写的 |
| 被放弃的方案 | ADR 里认真考虑过、最后没选的方案。没有它的 ADR 是在给已经做好的决定背书 |

## 常见误区

**把 ADR 写成说明书。** 「我们用 pgvector,它是 Postgres 的向量扩展」是说明书。ADR 要写的是「为什么不是别的」和「什么时候该换」。判断办法:删掉最后一节,如果剩下的内容还能自圆其说,说明这份文档在讲系统是什么,不是在记一个决定。

**重新评估的条件写成一句空话。** 「以后有需要再评估」「视情况而定」都是黑名单里的词。要写「向量行数超过 5 万」「P95 超过 100 ms」这种别人拿着监控能判断的条件。

**数字是编的。** 我最初想写的是「超过 500 万向量重新评估」,这个数字常见,但跟我们的系统毫无关系。要么自己测,要么明说「这是我设的触发线,没有测量依据」(练习 2 的「20 条」「每月 3 次」就是这么标的)。

**理由是感觉。** 「模型会算错」「Milvus 太重」听着都对,但没测过就不能写成证据。练习 2 里我测了,20 次全对,理由就得换。

**读论文时没有「读到哪」。** 过两个月你分不清自己是读透了还是扫过,于是拿一篇只读过摘要的论文去支撑一个设计决定。笔记第一栏就是防这个。

**把一台机器、一次运行的数字当通用结论。** 今天的延迟数是我这台机器、随机向量、30 次查询的结果。它够当「该重新测的触发线」,不能写成「pgvector 在 5 万行内 P95 一定低于 20 ms」。

## 学习资料

### 文档与文章

- [Michael Nygard《Documenting Architecture Decisions》](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions)(2011):ADR 这个做法的出处,短,一篇就读完。
- [ADR 社区站](https://adr.github.io/) 和 [ADR 模板合集](https://github.com/joelparkerhenderson/architecture-decision-record):挑一个模板用,不用纠结哪个最好。我用的六块是从常见模板里取的子集。
- [Design Docs at Google](https://www.industrialempathy.com/posts/design-docs-at-google/):设计文档为什么存在、写什么、不写什么。ADR 是设计文档的小兄弟,[Day 542](/blog/agent-zero/day-542-design-doc-1/) 讲设计文档会用到。
- [S. Keshav《How to Read a Paper》](http://ccr.sigcomm.org/online/files/p83-keshavA.pdf)(ACM SIGCOMM CCR,2007):三遍法的原文,两页多。
- [Anthropic《Building effective agents》](https://www.anthropic.com/engineering/building-effective-agents):今天练习 3 读的那篇,2024 年 12 月 19 日发布。
- [Lilian Weng《LLM Powered Autonomous Agents》](https://lilianweng.github.io/posts/2023-06-23-agent/):2023 年的老文章,但规划、记忆、工具三块的框架搭得很清楚。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1H44y1t75x&autoplay=0&high_quality=1" title="如何读论文【论文精读·1】" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>跟李沐学AI · 如何读论文【论文精读·1】 · 约 7 分钟(2021 年),讲的是同一套三步法,中文,先看这个再读 Keshav 原文。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ymjN6YE4Z&autoplay=0&high_quality=1" title="【IT老齐899.59】架构决策记录ADR最佳实践" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IT老齐 · 架构决策记录ADR最佳实践 · 约 11 分钟(2026 年 6 月),中文讲 ADR 的目录、编号和写法,可以和今天的六块格式对照。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1zWdfBTEyx&autoplay=0&high_quality=1" title="我们如何构建高效的智能体:How We Build Effective Agents: Barry Zhang, Anthropic" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>全球AI情报局 · 我们如何构建高效的智能体 · 约 15 分钟,带中文字幕的搬运。重点听「什么时候不该做 Agent」,就是资深的思维方式。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/D7_ipDqhtwk" title="How We Build Effective Agents: Barry Zhang, Anthropic" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · How We Build Effective Agents: Barry Zhang, Anthropic · 上面搬运的原版,英文好的直接看这个。</figcaption>
</figure>

### 书籍

- Will Larson《Staff Engineer: Leadership beyond the management track》(2021),[作者官网](https://staffeng.com/book):讲 Staff 工程师的几种类型和日常工作,看清楚资深之后的路长什么样。
- Tanya Reilly《The Staff Engineer's Path》(O'Reilly,2022):比上一本更偏实操,讲怎么看全局、怎么推动跨团队的事。
- Mark Richards、Neal Ford《Fundamentals of Software Architecture》(O'Reilly,2020):讲架构决策怎么做、怎么记录的一整章就是 ADR,今天的格式和它是一路的。

### 开源项目与代码

- [humanlayer/12-factor-agents](https://github.com/humanlayer/12-factor-agents):把生产级 Agent 的原则写成 12 条,进阶篇后面的很多天会逐条用到。
- 你自己的 `agentops/docs/adr/`:今天建好,进阶篇每个重要决定往里放一份。

## 自测

1. ADR 里哪一节是它和普通技术说明的分界线?为什么?

<details><summary>答案</summary>

「代价和重新评估的条件」。普通说明讲系统现在是什么,ADR 讲为什么这么选,以及什么情况下该改主意。没有可检查的推翻条件,它就是一份不会过期的说明书;有了,它是一个可以被验证、可以被推翻的判断。

</details>

2. 为什么「向量超过 500 万再考虑 Milvus」这句话不适合直接写进 ADR?今天的 ADR 是怎么处理的?

<details><summary>答案</summary>

「500 万」没有测量依据,是一个常见的数字,和我们的系统无关。今天的做法是先在本机量:1000、1 万、5 万行不建索引的 P95 是 6.0、48.2、436.3 ms,5 万行建 HNSW 后是 20.3 ms、建索引花 21 分钟;然后把触发线设在实测范围内(5 万行、P95 100 ms、建索引 30 分钟),并且标明「我只测到 5 万行」。

</details>

3. `pgvector_scale.py` 里造数据的 SQL 为什么要写 `where s > g*0`?

<details><summary>答案</summary>

这个条件永远为真,但它引用了外层的 `g`,让数据库对每一行都重新计算一遍随机数组。不加的话子查询和 `g` 无关,会只算一次,所有行共用同一个向量,测出来的耗时就是假的。

</details>

4. 练习 2 里,为什么我把「模型会算错」从 ADR 的理由里删了?这件事说明了什么?

<details><summary>答案</summary>

我先测了:同一道算术题让 `deepseek-flash` 温度 1.0 算 20 次,20 次全对。这条理由在这道题上不成立,留着就是把凭感觉的话写成了证据。说明 ADR 的理由要来自测量,而且要诚实标出范围(一道题、一个模型),真正站得住的理由(可以逐条锁成单元测试、金额可审计)才是该写的。

</details>

5. 面试题:「你们的 RAG 为什么用 pgvector,不用专用向量库?」用今天的材料,给一个 60 秒的回答。

<details><summary>答案</summary>

要点:先说约束(几百块、业务数据本来在 Postgres、一个人维护);再说测过什么(本机 1024 维随机向量,不建索引 1000 行 6 ms、5 万行 436 ms,建 HNSW 后 5 万行 20 ms,所以几百块根本用不上专用库,涨到几万块靠索引也能撑);再说代价(抢业务库资源、换 embedding 要整表重算);最后说什么时候会改主意(超过 5 万行重测,P95 超过 100 ms,建索引超过 30 分钟,或要做多租户隔离检索)。别忘了加一句「这是我机器上的随机向量,真数据数字会变」。面试官追问的时候,能说出「没测的范围是什么」是加分项。

</details>

6. `note.py` 里「读到哪」这一栏为什么要有「摘要」这个选项?

<details><summary>答案</summary>

很多时候只读了摘要,硬写成「第一遍」不诚实。过两个月你会拿这篇去支撑一个设计决定,而你其实没读过正文。标出「摘要」是为了不骗以后的自己。

</details>

## 明天预告

明天是 Day 520,Harness(一):harness 包了哪些东西。「harness」这个词你在 [Day 267](/blog/agent-zero/day-267-subagent-isolation/) 见过一次,明天认真拆开:从 25 行的 `loop()` 出发,一层一层补,循环的刹车、工具层、上下文裁剪、权限、钩子、子 Agent、状态持久化,每一层都先看缺了它怎么坏。地图里它排在最前面,因为后面五个块(上下文、记忆、持久化、编排、平台)讲的都是 harness 里的某一层。
