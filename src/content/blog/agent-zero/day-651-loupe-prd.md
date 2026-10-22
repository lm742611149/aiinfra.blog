---
title: 'Day 651 · Loupe 开题(二):PRD、架构、仓库、里程碑'
description: '把 Day 649 的竞品结论写成一份能被脚本检查的 PRD:一句话、目标用户、标了演示日期的用户故事、不许写「以后做」的非目标、目标带数字的验收指标。然后画出三层两进程的架构,用 uv 和 pnpm 建好 agent-loupe 仓库的空骨架,让 Vite 把 /api 转发给 FastAPI 跑通,最后排出 Day 652 到 Day 676 的里程碑,想清楚招聘方点开仓库那五分钟会看什么。'
pubDate: 2026-10-22
regime: none
tags: ['agent-loupe', 'portfolio', 'prd', 'fastapi', 'vite', 'agent-zero']
series: 'agent-zero'
day: 651
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 650](/blog/agent-zero/day-650-week93-review/) 是第 93 周的复习日。默写 `pass_hat_k` 时我写成了 `(c / n) ** k`,穷举脚本在 440 组输入里查出 284 组不一致;默写薪资正则漏了小写 k,4 条样本悄悄变成 `None`。小项目从 Day 649 的竞品表生成「为什么不直接用 LangSmith」的 30 秒回答,两版都过了检查,念出来才发现一句话说错了意思、长版其实要 32 秒。

那段 30 秒回答把 Loupe 和别人的区别说清楚了。今天把它变成一份正式的 PRD,再把仓库搭起来。后面二十多天每一天都照着今天的东西施工,所以今天写的每一条都要经得起追问:这个功能哪天能演示?这件事为什么不做?「快」是多快?

## 今天要解决的问题

学完今天,你应该能做到:

1. 写出一份 Loupe 的 PRD,六个部分齐全,并用 `prd_check.py` 检查它:用户故事每条标了哪天能演示、非目标里没有「以后做」、验收指标的目标都有数字。
2. 画出 Loupe 的架构,说出三个关键决定(统一数据模型、SQLite、列表只返回轻步骤)各自为什么。
3. 建好 `agent-loupe/` 仓库的空骨架:`server/` 用 uv 起 FastAPI、`web/` 用 pnpm 起 Vite + React,浏览器那边的 `/api/health` 经过 Vite 代理拿到后端的回答。
4. 排出 Day 652 到 Day 676 的里程碑,说出进度落后时先砍什么。

预计用时 3 小时:PRD 一小时,骨架一个半小时(第一次装前端依赖会慢一点),里程碑和招聘方那一节半小时。今天不调模型,花费 0。

前置:[Day 649](/blog/agent-zero/day-649-loupe-why/)(痛点和竞品表)、[Day 650](/blog/agent-zero/day-650-week93-review/)(30 秒回答)、[Day 79](/blog/agent-zero/day-079-fastapi-1/)(FastAPI 第一个接口)、[Day 71](/blog/agent-zero/day-071-pytest-1/)(pytest 和 `pythonpath`)、[Day 640](/blog/agent-zero/day-640-design-docs-1/)(设计文档和 `doc_lint.py`)、[Day 491](/blog/agent-zero/day-491-readme-arch/)(面试官的 5 分钟)。

学法提示:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 PRD 的六个小节名和 `prd_check.py` 的四条规则默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## PRD:写给两个读者

**PRD**(Product Requirements Document,产品需求文档)说的是做给谁、做什么、不做什么、怎么算做完。前端同学多半在需求评审会上见过产品经理写的那种。我们自己写的这一份不用长,但它有两个读者:一个是十几天后进度落后、想偷偷加功能或者想放弃的你,另一个是面试时问「这个项目的目标用户是谁、为什么这么设计」的面试官。

它和 [Day 640](/blog/agent-zero/day-640-design-docs-1/) 的设计文档是两回事:设计文档讲「怎么做」,PRD 讲「做什么、做到什么程度」。设计取舍以后会写成 ADR(Day 676),今天不碰。

我这份 PRD 定了六个小节,每一节回答一个问题:

| 小节 | 回答什么 |
| --- | --- |
| 一句话 | 它是什么,一口气说完 |
| 目标用户 | 谁会用,他手里已经有什么,想解决什么 |
| 用户故事 | 用户会做的具体动作,每条对应一个能演示的功能,标上哪天能演示 |
| 非目标 | 明确不做的事 |
| 验收指标 | 怎么算做完,目标写数字,实测等测完再填 |
| 只能做三个功能 | 进度落后时保哪三个 |

**用户故事**(user story)是从用户角度写的一句话需求,常见格式是「作为某某,我想做某事,以便得到某结果」。我们省掉前半句,因为用户只有一种人,直接写「我做了什么、我想看到什么」。**非目标**(non-goals)是这份文档里最重要的一节,它挡住的是范围蔓延:做着做着觉得「顺手加个告警吧」,三天就没了。

### 第一稿长什么样

先演示一次我自己写的第一稿,存成 `agent-loupe/docs/prd_v0.md`。它看起来像模像样,问题全在细节里:

```markdown
# Agent Loupe PRD(第一稿)

## 一句话
Agent Loupe 是一个功能强大的 Agent 调试平台,支持导入各种格式的运行记录,提供时间轴、对比、重跑、评测、监控、告警、团队协作等一站式能力,帮助开发者全方位提升 Agent 质量。

## 目标用户
开发 Agent 的工程师。

## 用户故事
- 作为开发者,我导入一个 trace 文件,看到时间轴。
- [Day 665] 我点开任意一步,看到完整的 messages 和工具定义。
- [Day 668] 我改了提示词跑两次,想知道从第几步开始不一样。

## 非目标
- 暂不支持多用户,以后做。
- 不做实时监控。

## 验收指标
| 指标 | 目标 | 实测 |
| --- | --- | --- |
| 打开一万步 trace | 要快 | |
| 两次运行对比 | 1 秒内 | 很快 |
```

和 [Day 646](/blog/agent-zero/day-646-open-source-1/) 的 `pr_lint.py`、Day 640 的 `doc_lint.py` 一样,格式要求交给脚本查。仓库根目录下建 `scripts/`,写 `scripts/prd_check.py`,`split_sections` 还是照搬那两个文件里的:

```python
# agent-loupe/scripts/prd_check.py
import re
import sys
from pathlib import Path

SECTIONS = ["一句话", "目标用户", "用户故事", "非目标", "验收指标", "只能做三个功能"]
STORY = re.compile(r"^- \[Day (\d+)\] ")
SOFT = re.compile(r"以后|暂不|后续|TODO")
CJK = re.compile(r"[一-鿿]")


def split_sections(text: str) -> dict[str, str]:
    sections: dict[str, str] = {}
    current = ""
    for line in text.splitlines():
        if line.startswith("## "):
            current = line[3:].strip()
            sections[current] = ""
        elif current:
            sections[current] += line + "\n"
    return sections


def bullets(body: str) -> list[str]:
    return [line for line in body.splitlines() if line.startswith("- ")]


def lint(text: str) -> list[str]:
    s = split_sections(text)
    problems = [f"缺少一节:{name}" for name in SECTIONS if name not in s]
    pitch = s.get("一句话", "").strip()
    if len(CJK.findall(pitch)) > 80:
        problems.append(f"[一句话] {len(CJK.findall(pitch))} 个汉字,超过 80")
    stories = bullets(s.get("用户故事", ""))
    if len(stories) < 5:
        problems.append(f"[用户故事] 只有 {len(stories)} 条,至少 5 条")
    for line in stories:
        m = STORY.match(line)
        if not m:
            problems.append(f"[用户故事] 没标哪天能演示:{line[:20]}…")
        elif not 652 <= int(m.group(1)) <= 676:
            problems.append(f"[用户故事] Day {m.group(1)} 不在 652–676 里")
    goals = bullets(s.get("非目标", ""))
    if len(goals) < 4:
        problems.append(f"[非目标] 只有 {len(goals)} 条,至少 4 条")
    for line in goals:
        if SOFT.search(line):
            problems.append(f"[非目标] 写成了「以后做」:{line[:24]}…")
    for line in s.get("验收指标", "").splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) != 3 or cells[0] in ("指标", "---"):
            continue
        name, target, measured = cells
        if not re.search(r"\d", target):
            problems.append(f"[验收指标] {name}:目标没有数字")
        if measured and not re.search(r"\d", measured):
            problems.append(f"[验收指标] {name}:实测一栏写的不是数字")
    return problems


if __name__ == "__main__":
    path = Path(sys.argv[1])
    found = lint(path.read_text(encoding="utf-8"))
    for p in found:
        print("-", p)
    print(f"{path.name}: {len(found)} 个问题")
    sys.exit(1 if found else 0)
```

<div class="line-notes">

- `SECTIONS = ["一句话", "目标用户", "用户故事", "非目标", "验收指标", "只能做三个功能"]` 六个小节名,要求和文档里的 `## ` 标题完全一致,检查最简单。
- `STORY = re.compile(r"^- \[Day (\d+)\] ")` 用户故事必须以 `- [Day 662] ` 这种格式开头。`\[` 是方括号本身,方括号在正则里有特殊含义,要转义。括号里的 `(\d+)` 把天数抓出来。
- `SOFT = re.compile(r"以后|暂不|后续|TODO")` 非目标里出现这几个词,说明你其实想做,只是现在没时间。这种写法面试官一定会追问「那什么时候做」。
- `CJK = re.compile(r"[一-鿿]")` 数汉字,和 Day 647 的 `talk_time.py` 一样。
- `def split_sections(text: str) -> dict[str, str]:` 和 Day 640 `doc_lint.py`、Day 646 `pr_lint.py` 一字不差:遇到 `## ` 开一个新小节,后面的行都归它。
- `def bullets(body: str) -> list[str]:` 挑出 `- ` 开头的列表行,只有它们算条目。
- `problems = [f"缺少一节:{name}" for name in SECTIONS if name not in s]` 第一稿没有「只能做三个功能」,在这里被抓出来。
- `if len(CJK.findall(pitch)) > 80:` 一句话超过 80 个汉字就不是一句话了。按 Day 647 的语速大约 22 秒,电梯里说不完。
- `elif not 652 <= int(m.group(1)) <= 676:` Python 可以连着写比较,`652 <= x <= 676` ≈ JS 的 `x >= 652 && x <= 676`。标的天数要落在 Loupe 的施工期里。
- `cells = [c.strip() for c in line.strip().strip("|").split("|")]` 把表格一行切成格子,和 Day 648 `self_check.py` 同一个写法。
- `if len(cells) != 3 or cells[0] in ("指标", "---"):` 跳过表头、分隔行和不是表格的行。
- `name, target, measured = cells` 三个格子拆成三个变量,≈ JS 的数组解构。
- `if not re.search(r"\d", target):` 目标里至少有一个数字。「要快」不是目标,「2 秒内」才是。
- `if measured and not re.search(r"\d", measured):` 实测一栏允许空着(还没测),但只要写了就必须是数字。「很快」比空着更糟,它假装测过。
- `sys.exit(1 if found else 0)` 有问题退出码 1,以后可以放进 CI。

</div>

我们还没有给仓库根目录建 Python 项目,先借 `server/` 的环境跑(下一节会建它;这个脚本只用标准库,用系统自带的 `python3` 跑也行):

```bash
cd /Users/你/agent-loupe
uv run --project server python scripts/prd_check.py docs/prd_v0.md
```

```text
- 缺少一节:只能做三个功能
- [用户故事] 只有 3 条,至少 5 条
- [用户故事] 没标哪天能演示:- 作为开发者,我导入一个 trace …
- [非目标] 只有 2 条,至少 4 条
- [非目标] 写成了「以后做」:- 暂不支持多用户,以后做。…
- [验收指标] 打开一万步 trace:目标没有数字
- [验收指标] 两次运行对比:实测一栏写的不是数字
prd_v0.md: 7 个问题
```

七个问题,每一个都是真会出事的地方。不过最大的问题脚本没查出来:**那句「一句话」**。它 62 个汉字,没超过 80,所以通过了;可它写了「监控、告警、团队协作」,和非目标里的「不做实时监控」自相矛盾,「一站式」「全方位」是 Day 649 竞品调研之后最不该出现的词。脚本只能查形式,意思要你自己读。练习 1 会给它补一条规则。

### 改好的 PRD

下面是我改好的版本,存成 `docs/prd.md`。你可以直接从它改成自己的。

```markdown
# Agent Loupe PRD

## 一句话
Agent Loupe 是一个本地运行的 Agent 调试器:导入 trace 文件,按时间轴看每一步,两次运行逐步对比,从任意一步改参数重跑,把失败步骤存成评测用例。

## 目标用户
正在开发 Agent 的工程师,自己写循环或用轻量框架,手里已经有 trace(Langfuse 导出、OpenTelemetry,或者自己记的 JSON),想搞清楚「这一次为什么慢、为什么贵、为什么答偏了」。

## 用户故事
- [Day 662] 我把一个 trace 文件导进来,马上看到时间轴,哪一步最慢、哪一步报错一眼可见。
- [Day 665] 我点开任意一步,看到这次模型调用收到的完整 messages、工具定义,以及它返回的 tool_calls 和思考内容。
- [Day 666] 我看到每次模型调用的输入里系统提示词、工具定义、历史、工具结果各占多少 token,以及上下文在哪一步突然变大。
- [Day 668] 我改了系统提示词又跑了一次,想知道两次运行从第几步开始不一样、每一步差在哪。
- [Day 670] 我想从第 5 步开始换个模型重跑,前 4 步的工具结果直接回放,不要真的再查一遍。
- [Day 673] 我发现第 7 步答错了,一键把它存成评测用例,以后每次改代码都跑一遍。
- [Day 674] 我想把它公开给别人试用,但不能让陌生人用我的 key 跑出一大笔账单。

## 非目标
- 不做生产环境的实时监控和告警,那是 Langfuse、LangSmith 的事,我们只处理已经存下来的 trace。
- 不做多用户、权限和团队协作:一个人本地用,或者公开一个只读演示。
- 不做 prompt 管理、数据集管理和在线打分,评测只做到导出成评测集文件。
- 不做流式输出的逐 token 回放。
- 只支持三种 trace 格式:OTLP JSON、Langfuse 导出、自带 SDK 写的 JSONL。

## 验收指标
| 指标 | 目标 | 实测 |
| --- | --- | --- |
| 一万步 trace 首屏可交互 | 本机 2 秒内 | |
| 一万步时间轴滚动 | Performance 面板里没有超过 50ms 的长任务 | |
| 两条 30 步运行对比 | 1 秒内出结果,和人工对齐判断一致 | |
| 从第 N 步重跑 | 前 N-1 步工具调用 100% 走回放,0 个真实请求 | |
| 公开演示 | 每日花费有硬上限,超出后重跑接口返回 429 | |
| 测试 | 后端 pytest 全绿,前端 tsc 和 build 0 报错 | |

## 只能做三个功能
时间轴(没有它什么都看不见)、上下文构成(五家竞品都没做)、从第 N 步重跑(工具回放是我们和 Laminar 相反的取舍)。对比和评测用例可以降级:对比先只标第一处分歧,评测用例先只导出 JSON。
```

```bash
uv run --project server python scripts/prd_check.py docs/prd.md
```

```text
prd.md: 0 个问题
```

几处我想多说一句。

**一句话**里五个动词(导入、看、对比、重跑、存成用例),每个对应后面一个用户故事。读的人不用往下翻就知道它做什么。「本地运行」四个字是 Day 649 竞品调研的结果:五家都是平台,我们不是。

**用户故事**比第一稿多了三条,每条前面的日期是后面那一天结束时能演示的东西。它们后面会变成里程碑表,还会变成 Day 676 README 里的功能清单。第三条(上下文构成)是 Day 649 发现的真空白,写得最具体:不光要「各占多少」,还要「在哪一步突然变大」。

**非目标**每条都写了「为什么不做」或「谁来做」。「不做实时监控,那是 Langfuse、LangSmith 的事」比「暂不支持监控」干脆得多,面试官问起来你也有话说。

**验收指标**的实测一栏全空着,这是对的。Day 675 会回填性能那几行,Day 676 的 README 也有一张同样留空的表;没测之前编数字,一问就露馅。我写「本机 2 秒内」,是因为性能数字离开机器就没意义:我的机器是 2019 款 13 寸 Intel MacBook Pro,它能达标,招聘方的电脑一般也没问题。

**只能做三个功能**是第一稿缺的那一节,也是我觉得最有用的一节。现在写下来,等你第 663 天发现进度只有一半的时候,不用当场纠结。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1kv4y1A7rH&autoplay=0&high_quality=1" title="PRD产品设计文档怎么写?手把手来教你。" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>产品经理毛毛 · PRD产品设计文档怎么写?手把手来教你。 · 20 分钟。产品经理视角的完整 PRD,比我们这份正式得多。看视频里怎么写需求背景和功能范围,对照我们的「目标用户」和「非目标」两节,想想哪些是工程师自己的项目可以省的。</figcaption>
</figure>

## 架构:三层,两个进程

<figure>
<svg viewBox="0 0 640 360" role="img" aria-label="Agent Loupe 架构图:三种 trace 来源经导入器进入 SQLite,FastAPI 提供接口,React 前端展示时间轴、详情、对比和重跑">
<rect x="0" y="0" width="640" height="360" fill="var(--paper-raised)" rx="6"/>
<text x="20" y="26" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">trace 来源</text>
<rect x="20" y="38" width="150" height="34" fill="none" stroke="var(--rule)"/>
<text x="95" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">loupe_sdk JSONL</text>
<rect x="20" y="80" width="150" height="34" fill="none" stroke="var(--rule)"/>
<text x="95" y="102" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">OTLP JSON</text>
<rect x="20" y="122" width="150" height="34" fill="none" stroke="var(--rule)"/>
<text x="95" y="144" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">Langfuse 导出</text>
<line x1="170" y1="97" x2="213" y2="97" stroke="var(--ink-soft)" marker-end="url(#a651)"/>
<rect x="215" y="38" width="200" height="190" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="315" y="58" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">server/(FastAPI)</text>
<text x="230" y="84" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">importers → Run/Step</text>
<text x="230" y="106" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">pricing → 补成本</text>
<text x="230" y="128" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">db → SQLite loupe.db</text>
<text x="230" y="150" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">diff → 步骤对齐</text>
<text x="230" y="172" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">replay → 回放重跑</text>
<text x="230" y="194" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">evalcases → 用例</text>
<text x="230" y="216" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">/api/* JSON 接口</text>
<line x1="415" y1="133" x2="458" y2="133" stroke="var(--ink-soft)" marker-end="url(#a651)"/>
<line x1="460" y1="150" x2="417" y2="150" stroke="var(--ink-soft)" marker-end="url(#a651)"/>
<rect x="460" y="38" width="160" height="190" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="540" y="58" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">web/(React)</text>
<text x="472" y="84" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">运行列表</text>
<text x="472" y="106" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">时间轴 + 详情</text>
<text x="472" y="128" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">上下文构成</text>
<text x="472" y="150" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">对比页</text>
<text x="472" y="172" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">重跑对话框</text>
<text x="472" y="194" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">评测用例页</text>
<rect x="215" y="262" width="200" height="40" fill="none" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
<text x="315" y="287" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">LLM_BASE_URL(只在重跑时用)</text>
<line x1="315" y1="228" x2="315" y2="260" stroke="var(--ink-soft)" stroke-dasharray="3 3" marker-end="url(#a651)"/>
<text x="320" y="335" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">开发时两个进程:uvicorn :8000 + vite :5173,vite 把 /api 转发给后端</text>
<defs><marker id="a651" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
</svg>
<figcaption>琥珀色的后端负责「把各种格式变成同一种数据并存起来」,蓝色的前端负责「看」。只有重跑和评测会去调模型,其他功能完全离线。</figcaption>
</figure>

三层是:**来源**(三种 trace 文件)→ **后端**(把它们变成同一种数据、存起来、算对比和重跑)→ **前端**(看)。两个进程是开发时同时开着的 uvicorn 和 Vite。几个关键决定,每一个我都写一下为什么,它们后面会写成 ADR。

**统一数据模型,导入时转换。** 三种来源格式差别很大:OTLP 的属性是一个 key-value 数组;Langfuse 的 observation 用 `parentObservationId` 指向父节点;我们自己的 SDK 一行一条记录(就是 Day 649 那种 `steps` 列表)。如果前端要同时认识三种格式,每个组件都会塞满 if-else。所以导入器负责把它们统一成两种东西:`Run`(一次运行)和 `Step`(其中一步),前端只认这一种。这两个模型明天 [Day 652](/blog/agent-zero/day-652-loupe-model/) 一个字段一个字段地定。

**SQLite,不用 Postgres。** 这是一个单人工具,数据是导入的,写少读多。SQLite 是一个文件、零配置,`git clone` 下来就能跑,对想试用的招聘方最友好。以后真要多人用,把 `db.py` 换成 Postgres 实现,接口不变。

**列表接口只返回「轻」步骤。** 一条一万步的 trace,如果每一步都带着完整的 messages,前端一次要拉几十上百 MB。所以步骤列表默认只返回名字、类型、时间、token 这些小字段,点开某一步再单独请求完整内容。Day 675 实测过这个差距:同样 5000 步,轻步骤 278 KB,带完整内容 5295 KB。

**前端自己画时间轴,不用图表库。** 时间轴本质上是一堆按时间比例定位的长条,Day 649 的 `waterfall.py` 用字符画过一遍,换成 CSS 百分比定位就是网页版。难点在一万行的虚拟滚动,交给 `@tanstack/react-virtual`。

**重跑时工具回放、模型真跑。** 这是 Day 649 竞品表里和 Laminar 相反的那个取舍,Day 669 专门讲。

技术栈和全课一致:后端 Python 3.12 + uv + FastAPI;前端 React 18 + TypeScript + Vite,包管理 pnpm,状态用 Zustand;重跑调模型沿用 `LLM_BASE_URL / LLM_API_KEY / LLM_MODEL` 三个环境变量。

## 仓库结构

Loupe 是独立仓库,不放在 `agent-zero-lab/` 里面。它最后会公开到 GitHub,练习仓库里那些 `.env` 和几百个练习文件不该跟着出去。下面是最终会长成的样子,带括号的是哪一天建;今天只建骨架,其余文件名以那一天为准:

```text
agent-loupe/
├── server/                  # Python 后端,uv 项目
│   ├── pyproject.toml       # 今天
│   ├── prices.json          # 价格表(Day 660)
│   ├── loupe_sdk.py         # 单文件轻量 SDK,复制到任何 Agent 项目里就能记 trace(Day 655)
│   ├── loupe/
│   │   ├── app.py           # FastAPI 接口,今天先有一个 /api/health
│   │   ├── models.py        # Run / Step(Day 652)
│   │   ├── importers/       # otlp / langfuse / sdk_jsonl(Day 654–656)
│   │   ├── db.py            # SQLite 读写(Day 658–660)
│   │   ├── diff.py          # 步骤对齐(Day 667–668)
│   │   ├── replay.py        # 回放重跑(Day 669–670)
│   │   ├── evalcases.py     # 评测用例(Day 672–673)
│   │   └── guard.py         # 演示模式:只读、限流、花费上限(Day 674)
│   ├── scripts/start.sh     # 线上启动入口(Day 675)
│   └── tests/
├── web/                     # React 前端,pnpm 项目
│   ├── package.json         # 今天
│   ├── vite.config.ts       # 今天
│   └── src/
├── samples/                 # 样例 trace 和造数脚本(Day 656、663)
├── scripts/                 # 仓库级脚本:prd_check.py(今天)、dev.sh、release_check.py(Day 676)
└── docs/                    # prd.md(今天)、adr/、perf.md
```

`server/` 和 `web/` 各自是独立的项目,有各自的依赖文件,没有用 monorepo 工具串起来。这个规模下,两个终端各跑一个命令最简单,也最不容易出怪问题。Day 676 会写一个 `scripts/dev.sh` 一条命令起两个。

### 建后端骨架

```bash
cd /Users/你
mkdir -p agent-loupe/{server/loupe/importers,server/tests,web/src,samples,docs,scripts}
cd agent-loupe
git init
cd server
uv init --bare --name loupe-server --python 3.12
uv python pin 3.12
uv add fastapi uvicorn
uv add --dev pytest httpx2
touch loupe/__init__.py loupe/importers/__init__.py
```

`uv init --bare` 只生成一个最小的 `pyproject.toml`,不建示例文件,≈ `npm init -y`。`uv python pin 3.12` 写一个 `.python-version` 文件把项目钉在 3.12:只写 `requires-python = ">=3.12"` 时,uv 第一次可能会用本机最新的 3.14,Day 677 的写手就踩过。`httpx2` 是给 FastAPI 的 `TestClient` 用的,下面会说为什么不是 `httpx`。

装完 `pyproject.toml` 长这样(版本号是 2026 年 10 月 22 日装到的):

```toml
[project]
name = "loupe-server"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.159.1",
    "uvicorn>=0.54.0",
]

[dependency-groups]
dev = [
    "httpx2>=2.16.0",
    "pytest>=9.1.1",
]
```

再写一个只有健康检查的 `loupe/app.py`,和一个测它的测试:

```python
# agent-loupe/server/loupe/app.py(Day 651 骨架版)
from fastapi import FastAPI

app = FastAPI(title="Agent Loupe")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": "0.0.1"}
```

<div class="line-notes">

- `app = FastAPI(title="Agent Loupe")` 创建应用,`title` 会显示在自动生成的 `/docs` 页面上。[Day 79](/blog/agent-zero/day-079-fastapi-1/) 写过第一个接口。
- `@app.get("/api/health")` 所有接口都放在 `/api` 前缀下。这样前端开发时只要把 `/api` 这一个前缀转发给后端,部署时也只要配这一条规则。
- `return {"status": "ok", "version": "0.0.1"}` 健康检查返回一个固定的小 JSON。Day 675 的 `smoke.py` 上线后第一个就查它。

</div>

```python
# agent-loupe/server/tests/test_health.py
from fastapi.testclient import TestClient

from loupe.app import app


def test_health() -> None:
    r = TestClient(app).get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
```

<div class="line-notes">

- `from fastapi.testclient import TestClient` 不用真起服务器,在进程里直接调接口,≈ 前端用 supertest 测 Express。
- `r = TestClient(app).get("/api/health")` 发一个假的 GET 请求,`r` 和 `httpx` 的响应用法一样。
- `assert r.json()["status"] == "ok"` 只断言最关键的一个字段,版本号以后会变,不写死。

</div>

### 故意制造一次:pytest 找不到 `loupe`

我第一次在这里跑测试,用的是 `httpx` 而且没配 pytest:

```bash
uv run pytest -q
```

```text
E   ModuleNotFoundError: No module named 'loupe'
...
StarletteDeprecationWarning: Using `httpx` with `starlette.testclient` is deprecated; install `httpx2` instead.
...
1 warning, 1 error in 2.64s
```

两件事。报错是 pytest 不知道要从 `server/` 这一层找 `loupe` 包,[Day 71](/blog/agent-zero/day-071-pytest-1/) 讲过,用 `pythonpath` 告诉它。警告是新版 Starlette 的 `TestClient` 改用 `httpx2` 了,装 `httpx` 能用但会一直提醒,所以上面的命令装的是 `httpx2`。在 `pyproject.toml` 末尾加上:

```toml
[tool.pytest]
pythonpath = ["."]
testpaths = ["tests"]
```

```bash
uv run pytest -q
```

```text
.                                                                        [100%]
1 passed in 1.61s
```

`[tool.pytest]` 是 pytest 9 的写法,老教程里的 `[tool.pytest.ini_options]` 也还能用,全课统一用前者。

### 建前端骨架

前端需要 Node 22 以上和 pnpm。我本机是 Node 24,pnpm 没有全局装,用 `npx pnpm@12.10.1` 临时跑,效果一样;你也可以 `npm i -g pnpm@12.10.1`。`web/package.json` 手写,版本号写死:

```json
{
  "name": "loupe-web",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "typecheck": "tsc --noEmit",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@tanstack/react-virtual": "3.14.13",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "react-router-dom": "6.30.6",
    "zustand": "5.0.15"
  },
  "devDependencies": {
    "@types/react": "18.3.31",
    "@types/react-dom": "18.3.7",
    "@vitejs/plugin-react": "6.1.2",
    "typescript": "7.0.2",
    "vite": "8.3.3"
  }
}
```

为什么写死成这几个版本,而不是 `^` 加最新版:

React 和 react-router 固定在 18 和 6 两个大版本,`pnpm` 会提示有 19 和 7,不用理。后面二十多天的前端代码按这两个版本写,跟着做不会碰到升级带来的破坏性改动。

其余几个我挑的都是**发布满两周**的版本。我第一次写的是查到的最新版,其中 zustand 5.0.16 是当天上午才发布的。pnpm 从 v11 起有个默认设置 `minimumReleaseAge` 是 1440 分钟,[文档](https://pnpm.io/settings/dependency-resolution) 说发布不满一天的版本默认不装;我在 `package.json` 里写死了那个版本,pnpm 就在 `web/` 下自动生成了一个 `pnpm-workspace.yaml`,里面写着 `minimumReleaseAgeExclude: - zustand@5.0.16`,等于替我开了个例外。这个设计是防供应链攻击的:一个包被投毒后,通常几个小时到一两天内会被发现下架。所以别追当天的新版,我把它换成了 8 月发布的 5.0.15,vite 也从前一天刚发的 8.3.5 换成了 10 月 6 日的 8.3.3,删掉那个 yaml 重装。

`typescript` 7 是用 Go 重写的那一版,`tsc` 命令用法不变,类型检查快得多。

`web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`strict`、`noUnusedLocals` 这几个严格选项一开始就打开,后面不会攒下一堆类型债。这些你做前端都熟,不展开。

`web/vite.config.ts` 是今天前端唯一和 Agent 后端有关的一段:

```ts
// agent-loupe/web/vite.config.ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
});
```

<div class="line-notes">

- `proxy: { '/api': 'http://127.0.0.1:8000' },` 开发时浏览器请求 `http://localhost:5173/api/health`,Vite 在服务端把它转发给 `127.0.0.1:8000` 上的 FastAPI。对浏览器来说页面和接口同源,不会碰到跨域(CORS)。前端代码里只写相对路径 `/api/...`,部署时也不用改代码。线上怎么处理跨域是 Day 674 的事。

</div>

`web/index.html` 和一个占位的入口 `web/src/main.tsx`,入口会去请求一次健康检查,把结果显示出来:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Agent Loupe</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

```tsx
// agent-loupe/web/src/main.tsx(Day 651 占位版,Day 662 换成正式的)
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  const [status, setStatus] = useState('连接后端中…');
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d: { status: string; version: string }) => setStatus(`后端 ${d.status},版本 ${d.version}`))
      .catch((e: unknown) => setStatus(`后端没连上:${String(e)}`));
  }, []);
  return (
    <main>
      <h1>Agent Loupe</h1>
      <p>{status}</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
```

<div class="line-notes">

- `fetch('/api/health')` 相对路径,开发时走上面的 Vite 代理。
- `.then((d: { status: string; version: string }) =>` 先手写一个内联类型。Day 661 会把前后端共用的类型集中写进 `types.ts`。

</div>

```bash
cd /Users/你/agent-loupe/web
npx pnpm@12.10.1 install
npx pnpm@12.10.1 typecheck    # 不输出任何错误就是通过
npx pnpm@12.10.1 build
```

```text
Done in 3.8s using pnpm v12.10.1
$ tsc --noEmit
dist/assets/index-DYbt4XSU.js  140.86 kB │ gzip: 45.87 kB

✓ built in 169ms
```

(第一次装要下载,我这里花了二十多秒;上面是换版本以后重装的输出,缓存都在了。)

### 两个进程一起跑

开两个终端。先只开前端,看看后端不在时会怎样:

```bash
# 终端一
cd /Users/你/agent-loupe/web
npx pnpm@12.10.1 dev --port 5173 --strictPort
```

```bash
# 终端三(随便哪个目录)
curl -i http://localhost:5173/api/health
```

```text
HTTP/1.1 502 Bad Gateway
```

终端一里 Vite 打出了原因:

```text
[vite] http proxy error: /api/health
Error: connect ECONNREFUSED 127.0.0.1:8000
```

`ECONNREFUSED` 是「8000 端口没人在听」。浏览器里你会看到 `fetch` 拿到一个 502,页面显示「后端没连上」。以后在 Loupe 的前端看到 502,第一反应就是去看后端起没起。然后起后端:

```bash
# 终端二
cd /Users/你/agent-loupe/server
uv run uvicorn loupe.app:app --port 8000
```

```bash
# 终端三
curl http://localhost:8000/api/health
curl http://localhost:5173/api/health
```

```text
{"status":"ok","version":"0.0.1"}
{"status":"ok","version":"0.0.1"}
```

第二行是经过 Vite 转发的,终端二的 uvicorn 日志里能看到两次 `"GET /api/health HTTP/1.1" 200 OK`。用浏览器打开 `http://localhost:5173` 会看到标题和「后端 ok,版本 0.0.1」。我是用 `curl` 验证的接口和页面 HTML,没有截浏览器的图。

最后建 `.gitignore`,不然第一个提交会把 `.venv/` 和 `node_modules/` 全带进去(练习 2 会量一下差多少)。

## 里程碑:Day 652 到 Day 676

每天结束时都要有能演示的东西。中途哪一天卡住了,宁可砍功能也要保证当天能演示:你随时可能被工作、面试或者生活打断,手里有一个能跑的版本最重要。

| 周 | Day | 做完以后能演示什么 |
| --- | --- | --- |
| 第 94 周 | 652–656 | Run/Step 两个模型;OTel GenAI 约定映射表;OTLP、Langfuse、自研 SDK 三个导入器各有测试;统一入口自动识别格式;Day 649 那种 Agent 加几行就能产出 trace |
| | 657 | 复习 |
| 第 95 周 | 658–660 | SQLite 表、导入事务、游标分页、轻步骤、价格表;`curl` 上传一个文件能分页查到运行和步骤 |
| | 661–663 | 前后端契约类型;浏览器里看到运行列表和时间轴;一万步样例的测量方法 |
| | 664 | 复习 |
| 第 96 周 | 665–666 | 点开任意一步看完整消息;上下文构成五块、增长图、成本冰柱 |
| | 667–668 | 步骤签名、LCS 对齐、并排对比页 |
| | 669–670 | 从任意一步改参数重跑,工具走回放,DeepSeek 实测非确定性 |
| | 671 | 复习 |
| 第 97 周 | 672–673 | 失败步骤存成评测用例,导出成评测集 |
| | 674–675 | 只读演示、脱敏、限流、每日花费上限;部署前后端,性能表,上线清单 |
| | 676 | README、ADR、发布前自查、开源发布 |

和 PRD 对一下:七条用户故事标的 662、665、666、668、670、673、674 都在表里,每一条都落在某一天的「能演示」上。如果某天的内容在用户故事里找不到对应,要么是基础设施(数据模型、表、类型),要么就是你在偷偷加需求。

**进度落后时砍什么。** 回到 PRD 最后一节:时间轴、上下文构成、从第 N 步重跑这三个保住。对比可以先只做「标出第一处分歧」,不做并排逐词 diff;评测用例可以先只导出 JSON,不做批量重跑看通过率;公开部署可以先只部署前端加只读样例。砍掉的部分写进 README 的「已知局限」,不藏着。

## 招聘方点开仓库的五分钟

[Day 491](/blog/agent-zero/day-491-readme-arch/) 讲过面试官看 SupportPilot 的五分钟,Loupe 一样。站在他们的位置想一想,这五分钟里会看什么:

**能不能马上用起来。** 有在线演示最好;没有的话,README 第一屏要有一张动图和三行以内的启动命令。要先装 Docker、再配五个环境变量的项目,大多数人直接关掉。所以 Day 674–675 的只读演示站很重要。

**有没有判断。** README 里有没有写「为什么不直接用 LangSmith」,有没有非目标,有没有 ADR 记录关键取舍。这是区分「跟着教程做了一遍」和「自己想清楚了」的地方。今天的 PRD 和 Day 649 的竞品表就是这些内容的原料。

**有没有数字。** 一万步多久打开,对比在什么情况下会对错,重跑一次花多少钱。数字可以不漂亮,但要真实,写清怎么测的。今天验收指标里留空的那一列,就是给这些数字留的位置。

**代码干不干净。** 类型写全没有,测试有没有,提交历史是不是一天一个巨型提交。今天就有第一个测试,`tsconfig` 一开始就是 strict。

对前端出身的人,这个项目还有一个额外的好处:做 Agent 的岗位里,能把复杂数据做成好用界面的人不多。面试时你可以从 Agent 一次调用的输入构成,一路讲到虚拟滚动和渲染性能,这个跨度本身就是记忆点。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Cdxn1yPdz24" title="How to write a great PRD (Product Requirement Document)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Enoverlab · How to write a great PRD (Product Requirement Document) · 英文。和上面 B 站那个对照着看,留意它怎么讲成功指标,再回头检查我们验收指标表里每一条目标是不是都能量。</figcaption>
</figure>

## 今天的文件

| 文件 | 干什么 | 新建还是修改 |
| --- | --- | --- |
| `docs/prd_v0.md` | 第一稿,留着当反面例子 | 新建 |
| `docs/prd.md` | 正式 PRD | 新建 |
| `scripts/prd_check.py` | 检查 PRD 的六节和四条规则 | 新建 |
| `server/pyproject.toml`、`.python-version`、`uv.lock` | 后端项目,钉 3.12 | 新建 |
| `server/loupe/__init__.py`、`loupe/importers/__init__.py` | 空的包标记 | 新建 |
| `server/loupe/app.py` | 只有 `/api/health` | 新建 |
| `server/tests/test_health.py` | 第一个测试 | 新建 |
| `web/package.json`、`tsconfig.json`、`vite.config.ts`、`index.html`、`src/main.tsx` | 前端骨架和 `/api` 代理 | 新建 |
| `.gitignore` | 不让依赖和数据库进仓库 | 新建 |
| `scripts/prd_scope.py`(练习) | 检查一句话里有没有越界的词 | 新建 |

今天不调模型,花费 0。

## 动手练习

**练习 1:给 PRD 检查补一条规则。** `prd_check.py` 放过了第一稿那句写着「监控、告警、团队协作、一站式」的一句话。写 `scripts/prd_scope.py`:列一组越界的词,只看「一句话」那一节,出现了就报出来,对两版 PRD 都跑一遍。

<details><summary>参考答案</summary>

```python
# agent-loupe/scripts/prd_scope.py
import re
import sys
from pathlib import Path

OUT_OF_SCOPE = ["监控", "告警", "团队", "协作", "多用户", "权限", "prompt 管理", "一站式", "平台"]
PITCH = re.compile(r"^## 一句话\n(.*?)(?=^## )", re.S | re.M)

text = Path(sys.argv[1]).read_text(encoding="utf-8")
m = PITCH.search(text)
pitch = m.group(1) if m else ""
hits = [w for w in OUT_OF_SCOPE if w in pitch]
print(f"{Path(sys.argv[1]).name}:一句话里有 {len(hits)} 个越界的词" + (f":{'、'.join(hits)}" if hits else ""))
sys.exit(1 if hits else 0)
```

<div class="line-notes">

- `OUT_OF_SCOPE = ["监控", "告警", "团队", "协作", "多用户", "权限", "prompt 管理", "一站式", "平台"]` 前几个来自非目标,后两个是 Day 649 之后不该再出现的定位词:我们不是平台。这组词是手写的,你的非目标不同,词也要换。
- `PITCH = re.compile(r"^## 一句话\n(.*?)(?=^## )", re.S | re.M)` 抓「## 一句话」到下一个 `## ` 之间的内容。`re.S` 让 `.` 能匹配换行,`re.M` 让 `^` 匹配每一行的开头。`(?=^## )` 是「后面紧跟着下一个标题」,只看不吃。这样写就不用 import `prd_check.py` 里的 `split_sections`,文件自己就能跑。
- `hits = [w for w in OUT_OF_SCOPE if w in pitch]` 字符串的 `in` 是子串判断,≈ JS 的 `pitch.includes(w)`。

</div>

```bash
cd /Users/你/agent-loupe
uv run --project server python scripts/prd_scope.py docs/prd_v0.md
uv run --project server python scripts/prd_scope.py docs/prd.md
```

```text
prd_v0.md:一句话里有 6 个越界的词:监控、告警、团队、协作、一站式、平台
prd.md:一句话里有 0 个越界的词
```

这条规则很粗:「平台」两个字在别的语境里可能没问题。它的作用是把可疑的地方指给你,判断还是你自己做。

</details>

**练习 2:`.gitignore` 到底挡掉了多少。** 在建 `.gitignore` 之前和之后各跑一次 `git status --porcelain --untracked-files=all | wc -l`,看看差多少;再写出你的 `.gitignore`。

<details><summary>参考答案</summary>

建之前(依赖已经装好、`dist/` 已经 build 过):

```bash
cd /Users/你/agent-loupe
git status --porcelain --untracked-files=all | wc -l
```

```text
    1208
```

`.gitignore`:

```text
# Python
.venv/
__pycache__/
.pytest_cache/
# 前端
node_modules/
dist/
# 数据和密钥
*.db
.env
```

建之后再跑一次:

```text
      18
```

从 1208 个文件降到 18 个,剩下的正好是今天手写的那些(加上 `uv.lock`、`pnpm-lock.yaml` 和 `.gitignore` 本身)。`*.db` 和 `.env` 现在还没有,先写上:Day 658 会生成 `loupe.db`,Day 670 会有 `.env`,[Day 647](/blog/agent-zero/day-647-open-source-2/) 演示过 key 进了历史有多麻烦,事后再加就晚了。两个锁文件要提交,它们保证别人装到和你一样的版本,≈ 你熟悉的 `package-lock.json`。

</details>

**练习 3:写你自己的 PRD。** 把 `docs/prd.md` 改成你自己的版本:目标用户写你真实想服务的人(比如你们团队里调 Agent 的同事),用户故事至少一条是你自己踩过的坑。让 `prd_check.py` 和 `prd_scope.py` 都返回 0 个问题。最后在「只能做三个功能」里写下你的选择和理由。

<details><summary>参考答案</summary>

这道题因人而异,我给一个改法示范。比如你在公司里调过一个要查五六个内部接口的客服 Agent,最痛的是「它每次都把同一个订单查三遍」,那就加一条:

```markdown
- [Day 666] 我想看出哪一步重复调了同样参数的工具,以及这些重复结果在上下文里占了多少 token。
```

它挂在 Day 666(上下文构成)上,因为重复的工具结果就是上下文变大的来源之一。跑两个检查:

```bash
uv run --project server python scripts/prd_check.py docs/prd.md
uv run --project server python scripts/prd_scope.py docs/prd.md
```

两个都要是 0。然后自己再读一遍「一句话」,问自己一个问题:一个没听过 Loupe 的人听完这一句,能不能说出它和 Langfuse 有什么不一样?说不出来就回去改。

</details>

**练习 4:进度只有一半。** 假设你做到 Day 663,发现计划里 664 之后的东西一样都还没开始,只剩下原计划一半的时间。按 PRD 写一份调整后的计划:保什么、砍什么、降级成什么,砍掉的写进哪里。

<details><summary>参考答案</summary>

一个示范:

- **保住**:时间轴(已经有了)、上下文构成(Day 666,真空白,是面试时最能说的一点)、从第 N 步重跑(Day 669–670,工具回放是我们的取舍)。
- **降级**:对比只做「两条运行的第一处分歧在第几步、差在哪个字段」,不做并排视图和逐词 diff,省下 Day 668 的大半;评测用例只做「把这一步存成 JSON 文件」,不做批量重跑和通过率。
- **砍掉**:公开部署推后,先只放一个 30 秒的录屏和本机启动命令。
- **写进哪里**:README 的「已知局限」一条条写清楚:「对比只标第一处分歧」「评测用例只能导出」「暂无在线演示」;PRD 的「只能做三个功能」那一节不用改,它就是为这一天准备的。

判断依据只有一条:面试时最能让人记住什么,缺了哪一块整个项目就讲不通。上下文构成和工具回放重跑是 Day 649、650 讲出来的差异点,它们在,项目就讲得通。

</details>

**验收标准**:`prd_check.py docs/prd.md` 和 `prd_scope.py docs/prd.md` 都是 0 个问题,而对 `prd_v0.md` 能报出问题;`server/` 下 `uv run pytest -q` 1 passed;`web/` 下 `typecheck` 和 `build` 通过;两个进程都起来时 `curl http://localhost:5173/api/health` 返回 `{"status":"ok",...}`,只开前端时返回 502;`.gitignore` 生效后 `git status` 只剩你手写的文件;能说出 PRD 六个小节各回答什么问题,以及进度落后时先砍什么。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| PRD | 产品需求文档,写清楚做给谁、做什么、不做什么、怎么算做完 |
| 用户故事(user story) | 从用户角度写的一句需求,我们的格式是「[Day N] 我做了什么、想看到什么」 |
| 非目标(non-goals) | 明确不做的事,用来挡住范围蔓延 |
| 范围蔓延(scope creep) | 做着做着不断加需求,最后什么都没做完 |
| 验收指标 | 怎么算做完,目标写数字,实测等量完再填 |
| 里程碑(milestone) | 一个时间点上能演示的东西,今天的表按天排 |
| 开发代理(dev proxy) | 开发服务器把某个路径前缀转发给另一个服务,今天是 Vite 把 `/api` 转给 FastAPI |
| ECONNREFUSED | 连接被拒绝,通常是目标端口上没有程序在听 |
| 502 Bad Gateway | 代理自己没问题,但它转发的目标没回应或连不上 |
| minimumReleaseAge | pnpm 的设置,发布时间不满这么多分钟的版本默认不装,v11 起默认 1440 分钟 |
| 锁文件 | `uv.lock`、`pnpm-lock.yaml`,记下装到的确切版本,让别人装到一样的 |

## 常见误区

**一上来就写代码。** 二十多天的项目,第一天花两三个小时写 PRD 和看竞品,后面能省下不止这么多。最常见的结局是做到一半发现别人早就有这个功能,或者发现数据模型撑不起对比,只能推倒重来。

**一句话里什么都想要。** 第一稿的「一站式、全方位、监控告警团队协作」读起来很厉害,但和非目标自相矛盾,也和 Day 649 的竞品结论对不上。一句话只写你真的会做完的那几件事。

**把非目标写成「以后做」。** 「暂不支持多用户,以后做」会被追问「那什么时候做」。直接写「不做,这是谁谁的事」。

**验收指标写形容词。** 「要快」「很快」没法验收。目标写数字,实测没量就空着,`prd_check.py` 两种都会拦。

**依赖追最新版。** 我第一次写的 zustand 5.0.16 是当天上午才发的。新发布的版本是供应链攻击最容易得手的窗口,pnpm 默认就不装发布不满一天的版本。写死一个发布了两周以上的版本。

**以为 502 是前端的 bug。** Vite 代理返回 502、终端里写着 `ECONNREFUSED 127.0.0.1:8000`,意思是后端没起,或者起在了别的端口。先 `curl` 后端本身。

**pytest 报 `No module named 'loupe'` 就去改 import。** 不是 import 写错了,是 pytest 不知道从哪一层找包。在 `pyproject.toml` 里配 `[tool.pytest] pythonpath = ["."]`。

**把 Loupe 放进练习仓库里。** 它要开源,练习仓库里有 `.env` 和几百个练习文件。独立仓库,从第一天开始就按要公开的标准写。

## 学习资料

### 文档与文章

- [Shape Up](https://basecamp.com/shapeup):Basecamp 的 Ryan Singer 写的产品开发方法,免费在线读。看第 3 章 Set Boundaries 讲的「appetite」(愿意为一件事花多少时间),和我们「只能做三个功能」是同一个思路,20 分钟。
- [Atlassian:Product requirements](https://www.atlassian.com/agile/product-management/requirements):Atlassian 讲 PRD 一般包含哪几部分,和我们的六个小节对照,看看工程师自己的项目省掉了哪些,10 分钟。
- [Vite:server.proxy](https://vite.dev/config/server-options):今天 `vite.config.ts` 里那一行的完整配置项,10 分钟。
- [pnpm:minimumReleaseAge](https://pnpm.io/settings/dependency-resolution):为什么新发布的版本默认不装,以及 `minimumReleaseAgeExclude` 怎么用,10 分钟。
- [uv:Creating projects](https://docs.astral.sh/uv/concepts/projects/init/):`uv init` 的几种模式,`--bare` 是哪一种,10 分钟。
- [pytest:Configuration](https://docs.pytest.org/en/stable/reference/customize.html):`pyproject.toml` 里 `[tool.pytest]` 的写法,5 分钟。

### B 站视频

- 产品经理毛毛《PRD产品设计文档怎么写?手把手来教你。》已经嵌在正文里。
- 老纪的技术唠嗑局《Agent 可观测性全解:Run、Trace、Thread 与生产评估闭环》(BV1EFtd6ZEVH),Day 649 嵌过。写 PRD 的「目标用户」一节前再看一遍,想想你的用户手里有的是哪一层的数据。

### 其他经典视频

- Enoverlab《How to write a great PRD (Product Requirement Document)》已经嵌在正文里。

### 书籍

- **Inspired: How to Create Tech Products Customers Love**,Marty Cagan,Wiley,第 2 版 2017。讲产品团队怎么找到值得做的东西。挑讲需求文档和产品发现的章节读,作者并不推崇靠厚厚的需求文档驱动开发,可以和我们这份一页长的 PRD 对照着想。
- **Shape Up: Stop Running in Circles and Ship Work that Matters**,Ryan Singer,Basecamp,2019。上面那个免费在线版就是这本书,有空通读。

### 开源项目与代码

- [langfuse/langfuse](https://github.com/langfuse/langfuse):看它仓库根目录怎么组织前后端和文档,和我们的结构对照。
- [lmnr-ai/lmnr](https://github.com/lmnr-ai/lmnr):Laminar 的仓库。看 README 第一屏怎么写定位,我们 Day 676 写 README 时可以对照。

## 自测

1. PRD 里「非目标」为什么比功能清单还重要?举一个本项目的例子。

<details><summary>答案</summary>

功能清单写的是你想做的,非目标写的是你承诺不做的,它挡住范围蔓延。一个人二十多天的项目,最常见的失败是不断加功能。比如「不做生产环境的实时监控和告警,那是 Langfuse、LangSmith 的事」:做到第十几天想加个告警的时候,这一条会拦住你;面试官问「为什么没有告警」,你也有现成的回答。写成「暂不支持,以后做」就失去了这个作用。

</details>

2. 验收指标表里的实测一栏为什么要先空着?`prd_check.py` 对它怎么检查?

<details><summary>答案</summary>

还没测就没有数字,编出来的数字一问就露馅。空着表示「还没量」,等 Day 675 量完再填。`prd_check.py` 允许实测为空,但只要写了就必须含数字;像第一稿那样写「很快」会被拦下,因为它假装测过。目标一栏则必须有数字,「要快」不能验收。

</details>

3. 开发时为什么让 Vite 把 `/api` 转发给 FastAPI,而不是前端直接请求 `http://127.0.0.1:8000`?

<details><summary>答案</summary>

直接请求另一个端口是跨域请求,浏览器会要求后端配 CORS。用 Vite 代理以后,浏览器只和 5173 打交道,页面和接口同源,不会碰到跨域;前端代码里只写相对路径 `/api/...`,部署时也不用改。代理把请求转给后端时,后端没起会得到 502,Vite 终端里有 `ECONNREFUSED 127.0.0.1:8000`。

</details>

4. 为什么 Loupe 用 SQLite 不用 Postgres?什么情况下会换?

<details><summary>答案</summary>

单人调试工具,数据是导入的,写少读多;SQLite 是一个文件、零配置,别人 clone 下来就能跑,对试用的招聘方最友好。要支持多人同时写入、要横向扩展,或者部署环境的磁盘重启就丢(某些无状态容器平台),就换 Postgres。所有数据库访问都封装在 `db.py` 里,换的时候只动这一个文件。

</details>

5. 面试题:你的项目计划二十多天,做到一半发现进度只有一半,你会怎么调整?说出依据。

<details><summary>答案</summary>

先看哪些是项目存在的理由:对 Loupe 是时间轴、上下文构成(竞品都没做)、从第 N 步重跑(工具回放是和别人相反的取舍),这三个保住。对比降级成「只标第一处分歧」,评测用例降级成「只能导出 JSON」,公开部署先推后。依据是演示时最能让人记住什么、缺了哪块项目就讲不通。砍掉的部分写进 README 的「已知局限」,不藏着。这个顺序我在 PRD 的「只能做三个功能」里第一天就写好了,所以落后时不用临场纠结。

</details>

6. 面试题:为什么你的 `package.json` 不写最新版本?

<details><summary>答案</summary>

两个原因。一是兼容:React 固定在 18、react-router 固定在 6,后面的代码按这两个大版本写和验证,避免中途升级带来破坏性改动。二是供应链安全:我挑的都是发布满两周的版本。新发布的版本是被投毒最容易得手的窗口,通常一两天内会被发现下架;pnpm v11 起默认不装发布不满 1440 分钟的版本。我第一次写了一个当天上午才发布的 zustand,pnpm 自动生成了一个例外配置,我就换成了两个月前的版本。锁文件提交进仓库,保证别人装到的和我一样。

</details>

## 明天预告

明天是 Day 652,Loupe(一):两个数据模型,字段一个个想清楚。今天的架构图里,三种格式的 trace 都要先变成 `Run` 和 `Step` 两种东西,前端只认它们。明天写 `server/loupe/models.py`,从 Day 649 那份手写的 `steps` 列表出发,一个字段一个字段地问:它从哪来、前端拿它干什么、重跑和对比时需不需要它。这两个模型定下来以后,后面二十多天不再改名。
