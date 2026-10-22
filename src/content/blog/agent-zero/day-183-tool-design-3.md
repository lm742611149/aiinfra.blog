---
title: 'Day 183 · 好工具(三):改造前后实测'
description: '凭感觉说「工具改好了」不算数。准备五个带程序判卷的任务,给注册表套一个计数器,让 Agent 拿 Day 180 的坏工具和 Day 182 的好工具各跑两遍,比成功率、模型和工具调用次数、报错、输入 token 和花费;再读一遍好工具的轨迹,改两句描述,用一个没参与调优的留出任务检查有没有改过头。'
pubDate: 2026-10-22
regime: none
tags: ['tool-design', 'evaluation', 'aci', 'agent-zero']
series: 'agent-zero'
day: 183
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 182](/blog/agent-zero/day-182-tool-design-2/) 按六条原则把会议纪要工具改了六遍:拆成 `notes_search` 和 `notes_read`,加命名空间,描述写四句话,参数用 `Annotated` 写说明、用 `Literal` 做枚举,返回值加 `limit`、`total`、`hint`、`next_start_line`,报错里写「你是不是想找」。探针显示搜「退款」的单次返回从 70,454 个字符降到了 454 个。

但探针是直接调用工具,不经过模型。单次返回小了,整次任务是不是真的便宜了?成功率会不会因为返回少了而下降?模型会不会因为被截断而多搜好几轮,反而更贵?这些问题只能让 Agent 真的去跑一批任务才回答得了。今天就做这件事。

## 今天要解决的问题

学完你应该能:

1. 设计一小批带「程序判卷」的任务,说清每个任务考的是工具的哪一部分,并留出一个调优时不看的任务。
2. 写一个套在注册表外面的计数器,不改 Agent 循环就能统计工具调用次数和报错;理解「包一层」时为什么要把调用交给被包的对象。
3. 跑出坏工具和好工具在同一批任务上的成功率、调用次数、token 和花费,读懂这张表说明了什么、没说明什么。
4. 走一遍「读轨迹 → 改描述 → 重跑 → 用留出任务验证」的循环。

预计用时 2.5 小时。前置:[Day 180](/blog/agent-zero/day-180-tool-design-1/)(坏工具 `notes_tools_bad.py`、`run_agent` 每步打印 token)、[Day 182](/blog/agent-zero/day-182-tool-design-2/)(好工具 `notes_tools_good.py`)、[Day 179](/blog/agent-zero/day-179-self-consistency/)(用程序判卷)。代码在 `agent-zero-lab/part03/`,命令都在 `agent-zero-lab/` 根目录跑。正文实验按高峰价约 ¥0.68,其中坏工具就占了 ¥0.55;练习约 ¥0.04。我自己多花了 ¥0.29,是练习 1 第一次写错了、白跑了四遍,后面会讲。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `Counted` 和 `run_once` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 为什么不能凭感觉

Day 180 已经见过一次:同一个问题、同一组坏工具,三遍的输入 token 是 78,708、74,588、15,474,差了五倍。如果你改完工具只跑一遍,碰巧碰上 15,474 那一遍,你会以为「也没差多少」;碰巧碰上 78,708,又会以为改造效果惊人。模型的行为有随机性,三次成功也可能只是运气。

Anthropic 在[《Writing effective tools for agents》](https://www.anthropic.com/engineering/writing-tools-for-agents)里推荐的是一个**评测驱动**的流程,大意是:

1. 准备一批贴近真实使用的任务,**每个任务配一个可以验证的结果**;
2. 每个任务用一个简单的 Agent 循环跑;
3. 记录准确率之外,还要记录总的工具调用次数、总 token 消耗、工具报错、运行时间;
4. 读轨迹,找规律:同一个工具被反复调用,通常是分页或返回数量有问题;某个参数总填错,通常是描述不清楚;
5. 改完再跑,并且**留一部分任务不参与调优**(他们叫 held-out test set),防止你把工具调成只适合那几个任务。

他们还提到一个做法:把评测的轨迹拼起来,直接交给 Claude Code,让它分析并改写工具描述。今天的练习 2 会做一个最小的版本。

这个流程你其实见过雏形:[Day 178](/blog/agent-zero/day-178-thinking-budget/) 的 `effort_sweep.py` 就是「一套带标准答案的题 × 几种配置 × 统计」,只不过那时比的是思考档位,今天比的是工具。区别是 Agent 任务一次要跑好几步,所以除了对不对,还要看它走了几步、调了几次工具。

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="评测驱动改工具的循环">
  <rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)" rx="6"/>
  <rect x="20" y="40" width="120" height="50" fill="var(--paper)" stroke="var(--rule)" rx="4"/>
  <text x="80" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">任务 + 判卷</text>
  <text x="80" y="79" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">T1–T4 调优用</text>
  <line x1="140" y1="65" x2="170" y2="65" stroke="var(--rule)"/>
  <rect x="170" y="40" width="130" height="50" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="235" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Agent 跑 N 遍</text>
  <text x="235" y="79" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">run_agent</text>
  <line x1="300" y1="65" x2="330" y2="65" stroke="var(--rule)"/>
  <rect x="330" y="40" width="130" height="50" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="395" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">记指标 + 轨迹</text>
  <text x="395" y="79" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">Counted 计数器</text>
  <line x1="460" y1="65" x2="490" y2="65" stroke="var(--rule)"/>
  <rect x="490" y="40" width="130" height="50" fill="var(--paper)" stroke="var(--rule)" rx="4"/>
  <text x="555" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">读轨迹找规律</text>
  <text x="555" y="79" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">哪一步多走了</text>
  <line x1="555" y1="90" x2="555" y2="130" stroke="var(--rule)"/>
  <line x1="555" y1="130" x2="235" y2="130" stroke="var(--rule)"/>
  <line x1="235" y1="130" x2="235" y2="92" stroke="var(--rule)"/>
  <text x="395" y="122" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">改描述 / 改返回值,再跑</text>
  <rect x="20" y="150" width="600" height="40" fill="var(--paper)" stroke="var(--rule)" rx="4"/>
  <text x="320" y="167" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">留出任务 T5:调优时不看,只在最后检查有没有改过头</text>
  <text x="320" y="182" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">它变好了,说明改动是通用的;它变差了,说明你在给那几个任务「开小灶」</text>
</svg>
<figcaption>今天的整个流程。蓝色是模型那一侧,琥珀色是我们包在工具外面的计数器。上面一圈可以转很多次,下面那个留出任务只在最后看。</figcaption>
</figure>

## 第一步:五个任务和程序判卷

任务要满足两个条件:像真实用户会问的话,而且答案能用程序判对错。判卷不能交给人看,否则跑二十遍你就不想看了;也先不交给模型判,那是第六部分 LLM-as-judge 的内容。最简单可靠的是**检查回答里有没有出现标准答案的关键信息**。

我挑了五个任务,每个考工具的不同部分。标准答案都先用 Day 180 学的 `grep`、`head` 在终端里查出来:

```bash
# 在 agent-zero-lab/ 下跑,查标准答案
head -3 workspace/notes/meeting-03.md
grep -c '^- 第' workspace/notes/meeting-07.md
grep -l '^# 客户迁移' workspace/notes/*
for f in $(grep -l '^# 退款流程' workspace/notes/*); do echo "$f $(sed -n 2p $f)"; done
```

<div class="line-notes">

- `head -3 workspace/notes/meeting-03.md` 第 3 次周会的负责人和日期就在前三行。
- `grep -c '^- 第' workspace/notes/meeting-07.md` `-c` 只数匹配的行数;`^- 第` 匹配以「- 第」开头的行,也就是每一条讨论。决定那一行以「- 决定」开头,不会被数进去。
- `grep -l '^# 客户迁移' workspace/notes/*` 标题行以「# 客户迁移」开头的笔记,`-l` 只列文件名。
- `for f in $(grep -l '^# 退款流程' workspace/notes/*); do echo "$f $(sed -n 2p $f)"; done` 主题是退款流程的每篇,打印文件名和第 2 行(负责人)。`$(...)` 是把命令的输出塞进这里,`sed -n 2p` 只打印第 2 行。这是一行 shell 循环,看不懂可以一篇篇 `head -2` 代替。

</div>

```text
# 订阅升级 周会纪要 #3
负责人: 陈静
日期: 2026-08-11
65
workspace/notes/meeting-06.md
workspace/notes/meeting-10.md
workspace/notes/meeting-27.md
workspace/notes/meeting-11.md 负责人: 张伟
workspace/notes/meeting-17.md 负责人: 李娜
workspace/notes/meeting-21.md 负责人: 张伟
workspace/notes/meeting-26.md 负责人: 陈静
workspace/notes/meeting-22.md 负责人: 王磊
workspace/notes/meeting-23.md 负责人: 刘洋
```

(`grep -l` 的文件顺序取决于系统,你的可能不一样,内容是一样的。)

于是五个任务和它们各自考的东西:

| 任务 | 问题 | 标准答案 | 主要考工具的哪一部分 |
| --- | --- | --- | --- |
| T1 | 之前开会对超过 30 天的订单退款是怎么定的?谁负责的那次会? | 财务主管审批;张伟 | 搜索返回值大小(Day 180、182 一直用的那题) |
| T2 | 第 3 次周会是谁负责的?哪天开的? | 陈静;2026-08-11 | 按编号直接读、读前三行 |
| T3 | 第 7 次周会纪要里一共记了多少条讨论? | 65 | 读整篇、分页 |
| T4 | 主题是客户迁移的周会有哪几次? | 6、10、27 | 按主题找(「客户迁移」在正文里也到处出现) |
| T5 | 张伟负责过哪几次退款流程的周会? | 11、21 | 留出任务:组合两个条件 |

T1 到 T4 是「调优集」,读轨迹、改工具都看它们;T5 是**留出任务**,改工具的时候不看它的轨迹,只在最后检查。

## 第二步:给注册表套一个计数器

`run_agent` 每一步会打印输入输出 token,`llm.ledger` 能告诉我们模型调了几次、一共多少 token、花了多少钱。还缺两个数:**工具一共被调了几次,其中几次报错**。

最直接的办法是去改 `run_agent`,但那样每加一个统计项都要改循环。更好的办法是在注册表外面**包一层**:做一个看起来和 `ToolRegistry` 一样的对象,`run_agent` 照常调它的 `schemas` 和 `call`,它在 `call` 里先交给真正的注册表执行,再顺手记个数。这和前端里给 `fetch` 包一层加日志是一回事:调用方不知道,也不用改。

```python
# agent-zero-lab/part03/compare_tools.py  (第一段:任务、判卷和计数器)
import contextlib
import io
import re
import sys
from collections.abc import Callable
from pathlib import Path

from part03.agent_loop import ToolRegistry, run_agent
from part03.notes_tools_bad import bad
from part03.notes_tools_good import good

SYSTEM = "你是团队助理,可以用工具查会议纪要。回答要说出依据在哪篇纪要。"


def has_all(*nums: int) -> Callable[[str], bool]:
    return lambda a: all(re.search(rf"(?<!\d)0?{n}(?!\d)", a) for n in nums)


TASKS: list[tuple[str, str, Callable[[str], bool]]] = [
    ("T1", "之前开会对超过 30 天的订单退款是怎么定的?谁负责的那次会?", lambda a: "财务主管" in a and "张伟" in a),
    ("T2", "第 3 次周会是谁负责的?哪天开的?", lambda a: "陈静" in a and ("08-11" in a or "8月11" in a or "8 月 11" in a)),
    ("T3", "第 7 次周会纪要里一共记了多少条讨论?", lambda a: "65" in a),
    ("T4", "主题是客户迁移的周会有哪几次?列出编号。", has_all(6, 10, 27)),
    ("T5", "张伟负责过哪几次退款流程的周会?", has_all(11, 21)),  # 留出任务:改工具时不看它
]


class Counted(ToolRegistry):
    """套在已有注册表外面,数一下工具调用次数和报错次数。"""

    def __init__(self, base: ToolRegistry) -> None:
        super().__init__()
        self.base, self.schemas = base, base.schemas
        self.calls = self.errors = 0

    def call(self, name: str, arguments: str) -> str:
        out = self.base.call(name, arguments)  # 交给被包的那个注册表去执行
        self.calls += 1
        self.errors += out.startswith('{"error"')
        return out
```

<div class="line-notes">

- `import contextlib` 和 `import io` 下面要把 `run_agent` 的打印收进一个字符串里,存成轨迹文件。
- `from collections.abc import Callable` 函数的类型标注,`Callable[[str], bool]` 表示「接收一个字符串、返回布尔值的函数」,相当于 TS 的 `(a: string) => boolean`。
- `SYSTEM = "你是团队助理,可以用工具查会议纪要。回答要说出依据在哪篇纪要。"` 和 Day 180 一字不差,两组工具用同一个 system prompt,唯一的变量是工具。
- `def has_all(*nums: int) -> Callable[[str], bool]:` 一个造判卷函数的函数:`has_all(6, 10, 27)` 返回一个新函数,检查回答里这三个数是不是都出现了。`*nums` 收下任意多个位置参数,相当于 JS 的 `(...nums)`。
- `return lambda a: all(re.search(rf"(?<!\d)0?{n}(?!\d)", a) for n in nums)` `lambda a: ...` 是一行的匿名函数,相当于 JS 的 `a => ...`。正则里 `(?<!\d)` 和 `(?!\d)` 要求数字前后都不是数字,所以找 `6` 时不会被 `26` 骗过;`0?` 允许写成 `06`。
- `("T1", "之前开会对超过 30 天的订单退款是怎么定的?谁负责的那次会?", lambda a: "财务主管" in a and "张伟" in a),` 每个任务是「编号、问题、判卷函数」三元组。判卷只查关键信息,不管措辞。
- `lambda a: "陈静" in a and ("08-11" in a or "8月11" in a or "8 月 11" in a)),` 日期三种写法都算对。写判卷时先想好模型可能的合理写法,这一步偷懒会冤枉对的答案,和 Day 179 验证器的全角冒号是同一类坑。
- `("T5", "张伟负责过哪几次退款流程的周会?", has_all(11, 21)),  # 留出任务` 注释是写给自己看的提醒:后面读轨迹时别去翻 T5 的。
- `class Counted(ToolRegistry):` 继承 `ToolRegistry`,只是为了让类型检查认它是一个注册表,`run_agent` 的参数类型是 `ToolRegistry`。
- `super().__init__()` 先把父类的初始化跑一遍,父类会建空的 `funcs` 和 `schemas`。相当于 JS class 里的 `super()`。
- `self.base, self.schemas = base, base.schemas` 记住被包的那个注册表;`schemas` 直接用它的,模型看到的工具定义和不包时完全一样。
- `self.calls = self.errors = 0` 两个计数器都从 0 开始。连等号把同一个值赋给两个变量。
- `out = self.base.call(name, arguments)  # 交给被包的那个注册表去执行` 这一行是关键。必须调 `self.base.call`,不能调 `super().call`:后者用的是父类自己的实现和自己的 `funcs`,如果被包的那个也是一层包装(比如练习 1 的截断器),它的逻辑就被整个绕过了。练习 1 我就是这样白跑了四遍。
- `self.errors += out.startswith('{"error"')` 两组工具出错时都返回 `{"error": ...}`:坏工具是注册表捕获的异常,好工具是自己写的报错。布尔值加到整数上,`True` 算 1。

</div>

## 第三步:跑起来

第二段是跑一次任务的函数和主程序:

```python
# agent-zero-lab/part03/compare_tools.py  (第二段,接在上一段后面)
def run_once(tools: ToolRegistry, question: str) -> tuple[str, str, Counted, int, float, int]:
    reg = Counted(tools)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):  # run_agent 每步都 print,先收起来存成轨迹文件
        answer, llm = run_agent(reg, SYSTEM, question, max_steps=8)
    return answer, buf.getvalue(), reg, llm.ledger.calls, llm.ledger.cost, llm.ledger.prompt_tokens


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    labels = sys.argv[2].split(",") if len(sys.argv) > 2 else ["坏", "好"]
    tids = sys.argv[3].split(",") if len(sys.argv) > 3 else [t for t, _, _ in TASKS]
    traces = Path("workspace/traces")
    traces.mkdir(parents=True, exist_ok=True)
    total_cost = 0.0
    for label, tools in [("坏", bad), ("好", good)]:
        if label not in labels:
            continue
        for tid, question, check in TASKS:
            if tid not in tids:
                continue
            for k in range(1, n + 1):
                answer, trace, reg, steps, cost, tokens = run_once(tools, question)
                total_cost += cost
                ok = check(answer)
                (traces / f"{label}-{tid}-{k}.txt").write_text(trace + "== 回答\n" + answer, encoding="utf-8")
                print(f"{label} {tid}#{k} {'对' if ok else '错'} | 模型 {steps} 次 | 工具 {reg.calls} 次"
                      f"(报错 {reg.errors})| 输入 {tokens:6} tok | ¥{cost:.4f}")
    print(f"合计 ¥{total_cost:.4f}")
```

<div class="line-notes">

- `def run_once(tools: ToolRegistry, question: str) -> tuple[str, str, Counted, int, float, int]:` 跑一次任务,返回六样东西:回答、轨迹文本、计数器、模型调用次数、花费、输入 token。
- `reg = Counted(tools)` 每次任务新包一层,计数从 0 开始。
- `buf = io.StringIO()` 一个内存里的「文件」,写进去的东西可以用 `getvalue()` 拿回来,相当于前端里拿一个数组收集 `console.log` 的内容。
- `with contextlib.redirect_stdout(buf):` 这个 `with` 块里所有 `print` 都写进 `buf`,不出现在终端上。块结束后自动恢复。
- `answer, llm = run_agent(reg, SYSTEM, question, max_steps=8)` Day 180 的 `run_agent` 原样不动,传进去的是包了一层的 `reg`。
- `return answer, buf.getvalue(), reg, llm.ledger.calls, llm.ledger.cost, llm.ledger.prompt_tokens` 模型调用次数就是 Agent 走了几步,`prompt_tokens` 是这次任务所有步骤的输入 token 之和。
- `n = int(sys.argv[1]) if len(sys.argv) > 1 else 2` 第一个命令行参数是每个任务跑几遍,默认 2。
- `labels = sys.argv[2].split(",") if len(sys.argv) > 2 else ["坏", "好"]` 第二个参数选跑哪组工具,比如只写 `好`。
- `tids = sys.argv[3].split(",") if len(sys.argv) > 3 else [t for t, _, _ in TASKS]` 第三个参数选任务,比如 `T1,T2`。这三个参数是为了重跑时省钱:改完好工具不用再把坏工具跑一遍。
- `traces = Path("workspace/traces")` 轨迹文件放这里,一个任务一遍一个文件。
- `ok = check(answer)` 用任务自己的判卷函数判对错。
- `(traces / f"{label}-{tid}-{k}.txt").write_text(trace + "== 回答\n" + answer, encoding="utf-8")` 文件名像 `好-T3-1.txt`。注意同名文件会被覆盖,第二轮跑之前想留着第一轮的轨迹,先把目录复制一份(我第一次就没留,后面要对比时只能重跑)。
- `print(f"{label} {tid}#{k} {'对' if ok else '错'}` 每次任务一行汇总,`{tokens:6}` 补宽到 6 位对齐。

</div>

先跑 T1 到 T4,两组工具各两遍。坏工具那组比较贵,这一条命令大约五毛钱,跑之前确认 `.env` 里是 `deepseek-flash`:

```bash
# 在 agent-zero-lab/ 下跑
uv run python -m part03.compare_tools 2 坏,好 T1,T2,T3,T4
```

<div class="line-notes">

- `uv run python -m part03.compare_tools 2 坏,好 T1,T2,T3,T4` 三个参数之间用空格分开,参数内部用逗号分开、不要加空格。整条大约跑一分钟。

</div>

```text
坏 T1#1 对 | 模型 4 次 | 工具 5 次(报错 0)| 输入  78721 tok | ¥0.0809
坏 T1#2 对 | 模型 4 次 | 工具 5 次(报错 0)| 输入  78714 tok | ¥0.0803
坏 T2#1 对 | 模型 3 次 | 工具 2 次(报错 0)| 输入   8750 tok | ¥0.0109
坏 T2#2 对 | 模型 3 次 | 工具 2 次(报错 0)| 输入   8762 tok | ¥0.0111
坏 T3#1 对 | 模型 3 次 | 工具 2 次(报错 0)| 输入   9242 tok | ¥0.0121
坏 T3#2 对 | 模型 3 次 | 工具 2 次(报错 0)| 输入   9226 tok | ¥0.0121
坏 T4#1 对 | 模型 4 次 | 工具 4 次(报错 0)| 输入 132268 tok | ¥0.1363
坏 T4#2 对 | 模型 3 次 | 工具 3 次(报错 0)| 输入  40165 tok | ¥0.0744
好 T1#1 对 | 模型 3 次 | 工具 3 次(报错 0)| 输入   3485 tok | ¥0.0058
好 T1#2 对 | 模型 3 次 | 工具 3 次(报错 0)| 输入   3468 tok | ¥0.0059
好 T2#1 对 | 模型 2 次 | 工具 1 次(报错 0)| 输入   1524 tok | ¥0.0017
好 T2#2 对 | 模型 3 次 | 工具 3 次(报错 0)| 输入   2608 tok | ¥0.0037
好 T3#1 对 | 模型 4 次 | 工具 4 次(报错 0)| 输入   6170 tok | ¥0.0078
好 T3#2 对 | 模型 3 次 | 工具 3 次(报错 0)| 输入   6589 tok | ¥0.0093
好 T4#1 对 | 模型 4 次 | 工具 6 次(报错 0)| 输入  14084 tok | ¥0.0155
好 T4#2 对 | 模型 3 次 | 工具 4 次(报错 0)| 输入   5938 tok | ¥0.0087
合计 ¥0.4765
```

再把留出任务 T5 也跑一遍。这时候还没有读任何轨迹、没有改任何东西,所以这是 T5 的「改之前」:

```bash
uv run python -m part03.compare_tools 2 坏,好 T5
```

<div class="line-notes">

- `uv run python -m part03.compare_tools 2 坏,好 T5` 只跑 T5,两组各两遍。跑完把 `workspace/traces` 整个复制成 `workspace/traces_r1`,留作第一轮的存档:`cp -r workspace/traces workspace/traces_r1`。

</div>

```text
坏 T5#1 对 | 模型 3 次 | 工具 8 次(报错 0)| 输入  17914 tok | ¥0.0338
坏 T5#2 对 | 模型 4 次 | 工具 9 次(报错 0)| 输入 122888 tok | ¥0.1027
好 T5#1 对 | 模型 4 次 | 工具 5 次(报错 0)| 输入   9091 tok | ¥0.0107
好 T5#2 对 | 模型 3 次 | 工具 4 次(报错 0)| 输入   6333 tok | ¥0.0091
合计 ¥0.1564
```

### 读这张表

先汇总成每组十次任务的平均值:

| 工具组 | 答对 | 平均模型调用 | 平均工具调用 | 报错 | 平均输入 token(范围) | 十次总花费 |
| --- | --- | --- | --- | --- | --- | --- |
| 坏(Day 180) | 10/10 | 3.4 | 4.2 | 0 | 50,665(8,750–132,268) | ¥0.555 |
| 好(Day 182) | 10/10 | 3.2 | 3.6 | 0 | 5,929(1,524–14,084) | ¥0.078 |

再按任务看平均输入 token:

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="五个任务上坏工具和好工具的平均输入 token">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">每个任务两遍的平均输入 token(琥珀 = 坏工具,蓝 = 好工具)</text>
  <text x="50" y="58" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">T1</text>
  <rect x="60" y="46" width="315" height="12" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="383" y="57" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">78,718</text>
  <rect x="60" y="60" width="14" height="12" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="82" y="71" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">3,477</text>
  <text x="50" y="100" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">T2</text>
  <rect x="60" y="88" width="35" height="12" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="103" y="99" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">8,756</text>
  <rect x="60" y="102" width="8" height="12" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="76" y="113" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">2,066</text>
  <text x="50" y="142" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">T3</text>
  <rect x="60" y="130" width="37" height="12" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="105" y="141" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">9,234</text>
  <rect x="60" y="144" width="26" height="12" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="94" y="155" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">6,380</text>
  <text x="50" y="184" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">T4</text>
  <rect x="60" y="172" width="345" height="12" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="413" y="183" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">86,217</text>
  <rect x="60" y="186" width="40" height="12" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="108" y="197" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">10,011</text>
  <text x="50" y="226" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">T5</text>
  <rect x="60" y="214" width="282" height="12" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="350" y="225" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">70,401(留出)</text>
  <rect x="60" y="228" width="31" height="12" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="99" y="239" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">7,712</text>
</svg>
<figcaption>条长按每 250 个 token 1 像素画。T1、T4、T5 这三个要「搜」的任务差了 9 到 23 倍;T2、T3 这两个「按编号读」的任务差得少,T3 只差 1.4 倍。</figcaption>
</figure>

能从这张表里读出四件事。

**成功率一样,都是 10/10。** 这个结果要老实承认:我们的任务都不难,坏工具虽然又贵又啰嗦,但功能是对的,DeepSeek 也足够聪明,能从三万多 token 的 grep 结果里把那一行找出来。所以今天这批任务**测不出成功率的差别**。想测出来,要么任务更难(要翻很多篇、要组合很多条件),要么像真实框架那样给工具返回加一个上限,练习 1 会试一下后者。

**省下的钱集中在「搜」的任务上。** T1、T4、T5 都要在全库里搜关键词,坏工具一搜就是几万字符,好工具的 `limit` 和 `hint` 把它压在一千字符以内,差了 9 到 23 倍。T2、T3 是按编号读一篇,坏工具的 `cat` 读整篇也就一两千字符,好工具还要分两段读,差距只有 1.4 到 4 倍。所以工具改造的收益和任务分布有关:你的用户问的如果大多是「读某一篇」,改搜索的收益就没那么大。

**坏工具的波动大得多。** 坏工具 T4 两遍是 132,268 和 40,165,T5 两遍是 17,914 和 122,888,同一个任务差三到七倍;好工具最大的是 T4 的 14,084 和 5,938,差两倍多。这正是 Day 180 清单上最后一条「成本随用法剧烈波动」,现在有了数字:好工具不但便宜,而且**可预测**。上线后按平均值做预算,可预测比便宜还重要。

**调用次数没少多少。** 平均模型调用 3.4 对 3.2,工具调用 4.2 对 3.6。好工具的每一步都很便宜,但步数差不多,说明还有可以改的地方。下一步就去轨迹里找。

## 第四步:读轨迹,找好工具的毛病

只读 T1 到 T4 的,T5 不看。好工具里步数最多的是 `好-T3-1`(4 次模型调用)和 `好-T4-1`(6 次工具调用),打开 `workspace/traces/好-T3-1.txt`:

```text
[step 1] 输入 688 tok | 输出 41 tok
    调用 notes_search({"query": "第7次周会"}) -> 返回 70 字符
[step 2] 输入 779 tok | 输出 85 tok
    调用 notes_search({"query": "meeting-07"}) -> 返回 75 字符
    调用 notes_search({"query": "周会", "limit": 20}) -> 返回 1305 字符
[step 3] 输入 1542 tok | 输出 57 tok
    调用 notes_read({"note": "meeting-07", "max_lines": 200}) -> 返回 2468 字符
[step 4] 输入 3161 tok | 输出 96 tok
```

模型先去搜「第7次周会」,搜不到(70 字符就是带 hint 的空结果);再搜「meeting-07」,原文里当然没有这个字符串;最后搜「周会」拿到前 20 条标题,才确认 `meeting-07` 就是第 7 次。三次搜索都是在回答一个问题:**「第 7 次周会」对应哪个笔记名?** 我们的 `notes_read` 明明接受数字 `7`,可模型不知道。参数说明里只写了「用 notes_search 返回的 note 字段」,反而把它往搜索那边推。

再看 `workspace/traces/好-T4-1.txt`:

```text
[step 1] 输入 686 tok | 输出 140 tok
    调用 notes_search({"query": "客户迁移", "limit": 20, "response_format": "detailed"}) -> 返回 2843 字符
    调用 notes_search({"query": "迁移", "limit": 20, "response_format": "detailed"}) -> 返回 2843 字符
[step 2] 输入 3688 tok | 输出 225 tok
    调用 notes_read({"note": "meeting-01", "start_line": 1, "max_lines": 21}) -> 返回 742 字符
    调用 notes_read({"note": "meeting-02", "start_line": 1, "max_lines": 9}) -> 返回 306 字符
[step 3] 输入 4573 tok | 输出 160 tok
    调用 notes_search({"query": "客户迁移 周会纪要", "limit": 20, "response_format": "detailed"}) -> 返回 395 字符
    调用 notes_search({"query": "迁移 周会纪要 #", "limit": 20, "response_format": "detailed"}) -> 返回 395 字符
[step 4] 输入 5137 tok | 输出 271 tok
```

「客户迁移」在正文里到处出现(每篇都有「关于客户迁移的细节」这种讨论条目),搜出来 368 条,前 20 条全是正文。模型读了两篇确认这些不是主题,第三步才想到搜「客户迁移 周会纪要」,只命中三个标题行。它最后答对了,还在回答里专门提醒「判断会议主题要看标题,不能看正文命中」,可这个经验是它花了两步自己摸出来的。**标题行的格式,工具描述里一个字都没提。**

两个毛病都是同一类:**工具知道、模型不知道的约定**。笔记名和会议编号的对应关系、标题行的格式,写工具的人心里清清楚楚,描述里没写。这正是 Day 182 原则三说的「写给不了解背景的新同事」,我当时以为写够了。

## 第五步:改两句描述,再跑

只改两处描述,代码一行不动。改之前先把 Day 182 的版本存一份,练习 2 要用:

```bash
cp part03/notes_tools_good.py part03/notes_tools_good_day182.py
```

<div class="line-notes">

- `cp part03/notes_tools_good.py part03/notes_tools_good_day182.py` 复制一份。它里面也有一个叫 `good` 的注册表,但我们不会把两份同时挂给同一个 Agent,所以不会撞名。

</div>

然后在 `notes_tools_good.py` 里改这两处:

```python
# agent-zero-lab/part03/notes_tools_good.py  (Day 182 建的,只改两处描述)
# ↓ notes_search 的 docstring,在「不要用它列出全部笔记」之前加一句
    每篇第 1 行是标题,格式是「# 主题 周会纪要 #编号」:按主题找会议时搜「主题 周会纪要」,只会命中标题行。
# ↓ notes_read 的 note 参数说明,整句换掉
    note: Annotated[str, "笔记名,例如 'meeting-03'。第 N 次周会就是 meeting-N,也可以直接传数字 N"],
```

<div class="line-notes">

- `每篇第 1 行是标题,格式是「# 主题 周会纪要 #编号」` 把标题格式告诉模型,并直接给出「按主题找」的搜法。这一句针对的是 T4 的轨迹。
- `note: Annotated[str, "笔记名,例如 'meeting-03'。第 N 次周会就是 meeting-N,也可以直接传数字 N"],` 把编号和笔记名的对应关系写进参数说明,针对的是 T3 的轨迹。原来那句「用 notes_search 返回的 note 字段」删掉了,因为它在 T3 里把模型引向了不必要的搜索。

</div>

改完重跑好工具。坏工具不用再跑,它没变:

```bash
uv run python -m part03.compare_tools 2 好
```

<div class="line-notes">

- `uv run python -m part03.compare_tools 2 好` 第三个参数不写,五个任务全跑,包括留出的 T5。一共大约四分钱。

</div>

```text
好 T1#1 对 | 模型 3 次 | 工具 3 次(报错 0)| 输入   3890 tok | ¥0.0066
好 T1#2 对 | 模型 3 次 | 工具 3 次(报错 0)| 输入   3591 tok | ¥0.0050
好 T2#1 对 | 模型 2 次 | 工具 1 次(报错 0)| 输入   1664 tok | ¥0.0027
好 T2#2 对 | 模型 2 次 | 工具 1 次(报错 0)| 输入   1635 tok | ¥0.0022
好 T3#1 对 | 模型 3 次 | 工具 2 次(报错 0)| 输入   4883 tok | ¥0.0057
好 T3#2 对 | 模型 3 次 | 工具 2 次(报错 0)| 输入   4859 tok | ¥0.0056
好 T4#1 对 | 模型 2 次 | 工具 1 次(报错 0)| 输入   1676 tok | ¥0.0026
好 T4#2 对 | 模型 2 次 | 工具 2 次(报错 0)| 输入   2030 tok | ¥0.0044
好 T5#1 对 | 模型 2 次 | 工具 2 次(报错 0)| 输入   2049 tok | ¥0.0041
好 T5#2 对 | 模型 2 次 | 工具 2 次(报错 0)| 输入   2058 tok | ¥0.0047
合计 ¥0.0436
```

(我这一轮是分两次跑的,T1 单独补跑了一次,合计是两次加起来的数。)

看一下改后的 `好-T4-1.txt`:

```text
[step 1] 输入 737 tok | 输出 91 tok
    调用 notes_search({"query": "客户迁移 周会纪要", "limit": 20, "response_format": "concise"}) -> 返回 207 字符
[step 2] 输入 939 tok | 输出 127 tok
```

第一步就用了描述里教的搜法,一次命中三个标题,两步答完。T3 也不再搜索了,第一步直接 `notes_read({"note": "meeting-7"})`(注意它写的是 `meeting-7`,Day 182 的宽进把它规范成了 `meeting-07`,这两条原则在这里配合上了),分两段读完数出 65 条。

三轮放在一起:

| | 答对 | 平均模型调用 | 平均工具调用 | 平均输入 token(范围) | 十次花费 |
| --- | --- | --- | --- | --- | --- |
| 坏工具 | 10/10 | 3.4 | 4.2 | 50,665(8,750–132,268) | ¥0.555 |
| 好工具 · Day 182 版 | 10/10 | 3.2 | 3.6 | 5,929(1,524–14,084) | ¥0.078 |
| 好工具 · 改两句描述后 | 10/10 | 2.4 | 1.9 | 2,834(1,635–4,883) | ¥0.044 |

最后再单独看留出任务 T5,这是今天最重要的一行:

| T5(调优时没看过) | 两遍的输入 token | 两遍的模型调用 |
| --- | --- | --- |
| 坏工具 | 17,914 / 122,888 | 3 / 4 |
| 好工具 · Day 182 版 | 9,091 / 6,333 | 4 / 3 |
| 好工具 · 改两句描述后 | 2,049 / 2,058 | 2 / 2 |

T5 也跟着变好了,而且两遍几乎一样。我改那两句话时只看了 T3、T4 的轨迹,没为 T5 做任何事。它变好,说明这两句话补的是**通用的知识**(标题格式、编号规则),不是给某个任务开的小灶。反过来,如果 T5 变差了或者没变,就要怀疑改动是不是只对调优集有效。

说到底要的是**真实任务分布上的表现**,不是调优集上的分数。今天只有一个留出任务,说服力有限;真实项目里留出集至少要和调优集差不多大,而且要定期换新的,第六部分做评测时会系统地讲。

## 怎么知道工具改好了

把今天的做法压成一个可以照着做的清单:

1. **任务要带判卷。** 五到二十个像真实用户会问的任务,每个都能用程序判对错。先用 `grep` 之类的办法把标准答案查实,再写判卷函数,并想好模型可能的几种合理写法。
2. **每个任务跑多遍。** 至少两三遍,看范围不看单次。坏工具同一个任务差七倍,只跑一遍什么都说明不了。
3. **指标不只是对错。** 模型调用次数、工具调用次数、报错次数、输入 token、花费,都记下来。今天成功率完全一样,差别全在后面几列。
4. **读轨迹找规律。** 同一个工具连着调好几次、搜索结果被反复缩小范围、参数总是换着写,都是工具在告诉你「模型不知道某件事」。
5. **一次改一点,改完重跑。** 今天只改了两句描述,所以能确定是这两句起的作用。
6. **留出任务最后看。** 调优只看调优集,留出任务用来判断改动是不是通用的。
7. **轨迹存档。** 每一轮的轨迹另存一份,不然下一轮会覆盖掉,想对比时只能重跑花钱。

## 动手练习

### 练习 1:给工具返回加一个上限,坏工具还答得对吗

真实框架通常会给单次工具返回设上限,比如 Claude Code 默认 25,000 token。写一个 `Capped` 包装:超过 8,000 字符的返回截断,并在末尾注明原长。用 `Counted(Capped(bad))` 跑一遍 T1,看坏工具在截断下还能不能答对、花多少。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/capped.py  练习 1:像真实框架那样,把每次工具返回截到 8000 字符,坏工具还答得对吗
from part03.agent_loop import ToolRegistry
from part03.compare_tools import TASKS, run_once
from part03.notes_tools_bad import bad

CAP = 8000


class Capped(ToolRegistry):
    def __init__(self, base: ToolRegistry) -> None:
        super().__init__()
        self.base, self.schemas = base, base.schemas

    def call(self, name: str, arguments: str) -> str:
        out = self.base.call(name, arguments)
        return out if len(out) <= CAP else out[:CAP] + f"…(已截断,原长 {len(out)} 字符)"


if __name__ == "__main__":
    tid, question, check = TASKS[0]
    answer, trace, reg, steps, cost, tokens = run_once(Capped(bad), question)
    print(f"{tid} {'对' if check(answer) else '错'} | 模型 {steps} 次 | 工具 {reg.calls} 次 | 输入 {tokens} tok | ¥{cost:.4f}")
    print(trace)
```

<div class="line-notes">

- `CAP = 8000` 8,000 个字符,中文大约四五千 token,比 Claude Code 的默认值紧得多,为的是让截断真的发生。
- `self.base, self.schemas = base, base.schemas` 和 `Counted` 一样记住被包的对象。
- `out = self.base.call(name, arguments)` 交给被包的对象执行,再截断。
- `return out if len(out) <= CAP else out[:CAP] + f"…(已截断,原长 {len(out)} 字符)"` 截断时告诉模型原来有多长,这是 Day 182 原则五的最低要求。
- `tid, question, check = TASKS[0]` 只跑 T1,三元组直接拆成三个变量。
- `answer, trace, reg, steps, cost, tokens = run_once(Capped(bad), question)` `run_once` 里面会再包一层 `Counted`,所以实际是 `Counted(Capped(bad))` 两层。

</div>

运行 `uv run python -m part03.capped`(路径我缩短了):

```text
T1 对 | 模型 4 次 | 工具 4 次 | 输入 20241 tok | ¥0.0199
[step 1] 输入 368 tok | 输出 25 tok
    调用 ls({}) -> 返回 7679 字符
[step 2] 输入 3720 tok | 输出 67 tok
    调用 grep({"p": "30 天"}) -> 返回 180 字符
    调用 grep({"p": "退款"}) -> 返回 8018 字符
[step 3] 输入 7634 tok | 输出 93 tok
    调用 cat({"f": "/…/workspace/notes/meeting-21.md"}) -> 返回 1187 字符
[step 4] 输入 8519 tok | 输出 156 tok
```

截断生效了:`grep("退款")` 只回了 8,018 个字符(8,000 加上那句说明),输入 token 从七万多降到两万。这一遍还是答对了,因为模型同时搜了「30 天」,那一条才是真正命中决定的。如果它只搜「退款」,被截掉的 412 行里恰好包括 meeting-21 第 42 行,它就看不到了。**截断能控制成本,但会让坏工具在某些用法下直接失败**,这是框架替你兜底和工具自己设计好上限的区别:前者是硬砍,后者会告诉模型「还有 407 条,加个关键词」。

再说我踩的坑。我第一次写 `Counted` 和 `Capped` 时,两个类都是这样写的:

```python
# 第一次写错的版本(不要照抄)
    def __init__(self, base: ToolRegistry) -> None:
        super().__init__()
        self.funcs, self.schemas = base.funcs, base.schemas

    def call(self, name: str, arguments: str) -> str:
        out = super().call(name, arguments)
```

<div class="line-notes">

- `self.funcs, self.schemas = base.funcs, base.schemas` 把被包对象的函数表直接抄过来。
- `out = super().call(name, arguments)` 调父类 `ToolRegistry.call`,它会用 `self.funcs` 去执行。

</div>

单独用没问题。可 `Counted(Capped(bad))` 时,外层的 `Counted` 抄到的是 `Capped` 的 `funcs`,也就是 `bad` 的原始函数表,然后调父类的 `call` 直接执行,`Capped.call` 里的截断逻辑一次都没被调到。我跑了 T1 和 T5 各两遍,轨迹里 `grep({"p": "退款"}) -> 返回 70454 字符` 明晃晃地写着,白花了 ¥0.29 才发现。**包装器要把调用交给被包的对象(`self.base.call`),而不是绕过它直接去执行**,这样才能一层套一层。前端里给 `fetch` 包两层中间件,每层都要调下一层的 `fetch`,不能直接调原生的,是一个道理。

</details>

### 练习 2:让模型读轨迹提改法

把第一轮好工具 T3 和 T4 的轨迹放进 `workspace/traces_r1/`(文件名 `好-T3.txt`、`好-T4.txt`),连同 Day 182 版工具的定义一起交给模型,让它指出工具定义的问题,最多三条。看它说得对不对,和我们第四步自己读出来的比一比。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/trace_review.py  练习 2:把轨迹和工具定义交给模型,让它提改法
import json
from pathlib import Path

from common.llm import LLMClient
from part03.notes_tools_good_day182 import good

traces = "\n\n".join(f"### {p.name}\n{p.read_text(encoding='utf-8')}" for p in sorted(Path("workspace/traces_r1").glob("*.txt")))
schemas = json.dumps([s["function"] for s in good.schemas], ensure_ascii=False, indent=1)
prompt = f"""下面是两个工具的定义,和 Agent 用它们做任务的轨迹。
只根据轨迹里看得到的现象,指出工具定义的问题:哪一步多走了、为什么会这样走。
每个问题给出一句改后的描述或参数说明。最多 3 条,每条不超过 80 字。

## 工具定义
{schemas}

## 轨迹
{traces}"""
llm = LLMClient()
r = llm.chat([{"role": "user", "content": prompt}])
print(r.content)
print(llm.ledger)
```

<div class="line-notes">

- `from part03.notes_tools_good_day182 import good` 用第五步之前存的 Day 182 版,轨迹是这个版本跑出来的,定义要对得上。
- `traces = "\n\n".join(` 每个轨迹文件前面加一个标题,拼成一大段文本。
- `schemas = json.dumps([s["function"] for s in good.schemas], ensure_ascii=False, indent=1)` 只取名字、描述、参数,`indent=1` 让模型读起来清楚一点。
- `只根据轨迹里看得到的现象` 这句是在限制它别泛泛而谈,只说证据。
- `最多 3 条,每条不超过 80 字。` 限制长度,省钱也逼它挑重点。

</div>

我放进去的两份轨迹是 Day 182 版又跑的一遍,和第四步那次不完全一样:T3 这次没去搜,直接 `notes_read("meeting-07")` 分两段读;T4 还是先搜「客户迁移」,换了三次说法才搜到标题行。运行 `uv run python -m part03.trace_review`:

```text
1. 好-T3: notes_read 未限制 max_lines，默认40行导致需二次读第41行起；应在工具说明中提示长笔记按需设 max_lines=200 一次读完，避免分段。
2. 好-T4: notes_search 无法按标题/主题精确匹配，Agent 反复换 query（"客户迁移"→"迁移 周会"→"客户迁移 周会纪要"→"# 客户迁移"）仍靠人工判断；应增加 search 参数如 field:"title" 仅匹配标题行。
3. 好-T4: 搜"客户迁移"命中368条但 limit 上限20，工具未提示总量/截断；应返回 total 命中数并在 description 说明 limit 上限会截断，提示缩小词或加 field 过滤。
1 次调用 | 输入 1297 / 输出 177 tokens | 约 ¥0.0040
```

三条一条一条核对:

- 第 1 条**有道理**。T3 分两段读,是因为默认 40 行。不过「一次读完」不一定对,大多数任务只需要读命中附近几行,默认值小是故意的。可以在描述里加一句「要数条数或通读全篇时把 max_lines 设到 200」。
- 第 2 条**说中了根子**,和我们第四步的发现是同一件事,只是它给的方案是加一个 `field` 参数,我们是在描述里教搜法。它的方案更彻底,代价是多一个参数;我们的方案零代码。两种都可以,要用重跑来决定。
- 第 3 条**是错的**。工具明明返回了 `total` 和 `hint`,轨迹里只是没打印返回内容(我们的轨迹只记了返回多少字符)。模型看不到的东西它就会猜,猜错了还说得很笃定。

所以让模型读轨迹是一个很好的「第二双眼睛」,几毛钱就能拿到几条线索,但**每一条都要回到轨迹里核实**。也可以反过来理解第 3 条:我们的轨迹格式信息不够,值得把每次工具返回的前一两百个字符也记进去。

</details>

### 练习 3:按工具名分别统计

`Counted` 只有总数。给它加两个按工具名分的计数:每个工具调了几次、一共返回了多少字符。为了不花钱,用 Day 180 第一遍和今天 `好-T1-1` 轨迹里的工具调用原样「重放」一遍,不调模型。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/tool_stats.py  练习 3:按工具名分别记调用次数和返回字符数
import json
from collections import Counter

from part03.agent_loop import ToolRegistry
from part03.compare_tools import Counted
from part03.notes_tools_bad import ROOT as BAD_ROOT, bad
from part03.notes_tools_good import good


class Stats(Counted):
    def __init__(self, base: ToolRegistry) -> None:
        super().__init__(base)
        self.by_tool: Counter[str] = Counter()
        self.chars: Counter[str] = Counter()

    def call(self, name: str, arguments: str) -> str:
        out = super().call(name, arguments)
        self.by_tool[name] += 1
        self.chars[name] += len(out)
        return out


if __name__ == "__main__":
    # 不调模型:把 Day 180 第一遍和今天好工具第一轮 T1 的工具调用原样重放一遍
    replays = {
        "坏": (bad, [("ls", {}), ("grep", {"p": "30天"}), ("grep", {"p": "退款"}), ("grep", {"p": "超过.*天"}),
                     ("cat", {"f": str(BAD_ROOT / "meeting-21.md")})]),
        "好": (good, [("notes_search", {"query": "30天 退款", "limit": 20, "response_format": "detailed"}),
                      ("notes_search", {"query": "退款 审批", "limit": 20, "response_format": "detailed"}),
                      ("notes_read", {"note": "meeting-21", "start_line": 1, "max_lines": 60})]),
    }
    for label, (tools, calls) in replays.items():
        s = Stats(tools)
        for name, args in calls:
            s.call(name, json.dumps(args, ensure_ascii=False))
        print(label, "调用", dict(s.by_tool), "| 返回字符", dict(s.chars), "| 报错", s.errors)
```

<div class="line-notes">

- `from part03.notes_tools_bad import ROOT as BAD_ROOT, bad` `as` 起别名,因为好工具文件里也有一个 `ROOT`,相当于 JS 的 `import { ROOT as BAD_ROOT }`。坏工具的 `cat` 要绝对路径,得用它拼。
- `class Stats(Counted):` 在 `Counted` 的基础上再继承一层,总数、报错数照样有。
- `super().__init__(base)` 这次的父类是 `Counted`,要把 `base` 传上去。
- `self.by_tool: Counter[str] = Counter()` `Counter` 访问不存在的键时当成 0,所以下面可以直接 `+= 1`,不用先判断键在不在。JS 的 `Map` 得写 `(m.get(k) ?? 0) + 1`。
- `out = super().call(name, arguments)` 这里用 `super()` 是对的:父类 `Counted.call` 会再交给 `self.base.call`,一层层传下去,截断器之类的包装也不会被绕过。和练习 1 的错误写法区别在于,`Counted.call` 本身是「交给下一层」,而不是「自己执行」。
- `self.chars[name] += len(out)` 累加每个工具的返回字符数,哪个工具在灌水一眼就看出来。
- `("grep", {"p": "30天"}), ("grep", {"p": "退款"}), ("grep", {"p": "超过.*天"}),` Day 180 第一遍轨迹里的三次 grep,参数原样抄过来。
- `("notes_read", {"note": "meeting-21", "start_line": 1, "max_lines": 60})` 今天 `好-T1-1` 里模型第二步的调用,它一次要了 60 行。
- `s.call(name, json.dumps(args, ensure_ascii=False))` 走和 Agent 循环一样的入口,只是参数是我们给的,不是模型给的。

</div>

运行 `uv run python -m part03.tool_stats`:

```text
坏 调用 {'ls': 1, 'grep': 3, 'cat': 1} | 返回字符 {'ls': 7679, 'grep': 70648, 'cat': 1187} | 报错 0
好 调用 {'notes_search': 2, 'notes_read': 1} | 返回字符 {'notes_search': 316, 'notes_read': 1469} | 报错 0
```

坏工具的大头一眼就看出来是 `grep`(70,648 个字符,三次里 70,454 来自搜「退款」那一次)。好工具反过来,最大的一笔变成了 `notes_read`:模型要了 60 行,把整篇都读了,其实它只需要第 1 到 3 行和第 42 行。这又是一条可以改的线索:在描述里提醒「知道行号时只读那一行附近」。按工具拆开看,下一轮该改哪个工具就清楚了。

重放这个办法本身也值得记住:**轨迹里有参数,就能不调模型、零成本地复现工具那一侧的行为**。改了工具的返回格式,先用重放看大小变化,确认没问题再花钱跑 Agent。

</details>

**验收标准:** 你的 `compare_tools.py` 能跑出坏、好两组各十次的结果,并整理出和文中同样结构的汇总表;能指着一份轨迹说出「哪一步多走了、因为模型不知道什么」;改完描述后留出任务 T5 的 token 和步数没有变差。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 评测驱动 | 先准备带判卷的任务和指标,改动前后都跑一遍,用数字决定改得好不好,而不是凭感觉 |
| 判卷函数 | 检查回答对不对的程序,今天是检查关键信息有没有出现,比如 `has_all(6, 10, 27)` |
| 调优集 | 改工具时会去读轨迹、照着改的那批任务,今天是 T1–T4 |
| 留出任务(held-out) | 调优时不看,只在最后用来检查改动是不是通用的任务,今天是 T5 |
| 过拟合 | 改动只让调优集变好,换一批任务就不灵了,相当于给那几个任务「开小灶」 |
| 包装器 | 套在一个对象外面、对外看起来和它一样的对象,调用时先交给被包的对象,再加自己的逻辑,今天的 `Counted`、`Capped` |
| `redirect_stdout` | `contextlib` 里的工具,`with` 块里的 `print` 都写进你给的对象里,不出现在终端 |
| `io.StringIO` | 内存里的文本「文件」,可以往里写,再用 `getvalue()` 拿出全部内容 |
| 重放(replay) | 把轨迹里记录的工具调用参数原样再执行一遍,不调模型就能复现工具那一侧的行为 |
| 可预测性 | 同一个任务多跑几遍,花费和步数的波动有多大。今天坏工具同一任务差七倍,好工具改完后两遍几乎一样 |

## 常见误区

**只跑一遍就说改好了。** 坏工具 T5 两遍是 17,914 和 122,888 token,碰上哪一遍结论完全不同。每个任务至少两三遍,看范围。

**只看成功率。** 今天三轮都是 10/10,只看这一列会觉得白改了。差别全在调用次数、token、花费和波动上。

**任务太简单就说「两种工具一样好」。** 成功率没差别,是因为任务不够难、模型够聪明,不是因为坏工具没问题。练习 1 加了一个返回上限,坏工具就到了随时可能失败的边上。想测出成功率的差别,要有翻很多篇、组合很多条件的难任务。

**调优时偷看留出任务。** 一旦照着 T5 的轨迹去改,它就成了调优集,再也说明不了改动是不是通用的。

**包装器绕过了被包的对象。** 写 `super().call` 加上抄 `funcs`,单层用没问题,两层一套,里面那层的逻辑就被整个跳过了,而且不报错。练习 1 我因此白花了 ¥0.29。包装器的 `call` 一律交给 `self.base.call`。

**第二轮把第一轮的轨迹覆盖了。** 同名文件直接覆盖。每轮跑完先 `cp -r workspace/traces workspace/traces_r1`,否则想对比时只能重跑。

**模型提的改法照单全收。** 练习 2 里三条建议有一条是错的,它说工具没返回 `total`,其实返回了,只是轨迹里没记。模型的分析是线索,每条都要回到轨迹里核实。

## 学习资料

### 文档与文章

- [Anthropic · Writing effective tools for agents — with agents](https://www.anthropic.com/engineering/writing-tools-for-agents):今天的流程就来自它「How to write tools」下的「Running an evaluation」一节,特别是「Analyzing results」,重点看他们记哪些指标、怎么用留出集、怎么让 Claude 读轨迹,30 分钟,英文。
- [Anthropic · Introducing advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use):2025 年 11 月,讲工具多了以后定义和结果怎么吃掉上下文、Tool Search 和 Programmatic Tool Calling,是 Day 184 起「工具多了怎么办」的预习,英文。
- [SWE-agent 论文](https://arxiv.org/abs/2405.15793):看消融实验(ablation,一次去掉一个设计看效果掉多少)那部分,比如去掉编辑后的 linter 检查解决率从 18.0% 掉到 15.0%,这就是「一次改一点、改完重跑」的论文版,英文。
- [Python 文档 · contextlib.redirect_stdout](https://docs.python.org/3/library/contextlib.html#contextlib.redirect_stdout):今天收集轨迹用的工具,看例子就行,英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1BZY66hE8u&autoplay=0&high_quality=1" title="如何对 Agent 进行评估？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>西瓜讲大模型 · 如何对 Agent 进行评估? · 11 分钟,讲 Agent 评测看哪些指标,今天只用到了最简单的几个,第六部分会全部用上,先听个全貌。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1xBuG6MEuX&autoplay=0&high_quality=1" title="[134]. SWE-agent：Agent处理GitHub issue的经典论文，论文精读【每天一个宝藏论文】" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>海安雨 · SWE-agent:Agent 处理 GitHub issue 的经典论文,论文精读 · 9 分钟中文导读,ACI 的出处,看他们怎么用对比实验证明界面设计有效。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/BsWxPI9UM4c" title="Why AI evals are the hottest new skill for product builders | Hamel Husain &amp; Shreya Shankar" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Lenny's Podcast · Why AI evals are the hottest new skill for product builders · Hamel Husain 和 Shreya Shankar 谈怎么做评测,核心观点是「先去看数据(轨迹)」,和今天第四步是同一个习惯。英文,时间较长,可以只听前半段。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 3、4 章讲评测方法和怎么搭评测流水线,今天的判卷函数和留出集在那里有更系统的讲法,英文。

### 开源项目与代码

- [anthropics/claude-cookbooks](https://github.com/anthropics/claude-cookbooks):官方示例集,里面有工具调用和评测相关的 notebook,可以看他们怎么组织一批测试任务。
- [SWE-agent/mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent):一百来行的 Agent,它会把每次运行的轨迹存成文件,对照今天的 `workspace/traces/` 看他们记了哪些字段(比我们多了每次工具返回的内容,正好补上练习 2 发现的缺口)。

## 自测

1. 为什么每个任务至少要跑两三遍?举今天的一个数字说明。

<details><summary>答案</summary>

模型行为有随机性,同一个任务的成本和步数会波动。坏工具 T5 两遍的输入 token 是 17,914 和 122,888,差将近七倍;T4 是 132,268 和 40,165。只跑一遍,碰上哪一遍结论就完全不同。

</details>

2. 今天三轮成功率都是 10/10,能不能说明坏工具和好工具在「准确率」上一样好?

<details><summary>答案</summary>

不能。只能说明今天这批任务太简单,测不出差别:坏工具功能是对的,模型也能从三万多 token 里找到那一行。换成更难的任务(要翻很多篇、组合多个条件),或者给工具返回加上限(练习 1),坏工具就可能失败。评测集测不出差别时,结论是「这批任务区分不开」,不是「两者一样」。

</details>

3. 留出任务 T5 是用来干什么的?如果改完描述后 T5 变差了,说明什么?

<details><summary>答案</summary>

T5 调优时不看,只在最后检查改动是不是通用的。今天改那两句描述只看了 T3、T4 的轨迹,T5 也从 9,091 / 6,333 token 降到 2,049 / 2,058,说明改的是通用的知识。如果 T5 变差或没变,就要怀疑改动只对调优集有效(过拟合),比如描述里写了只对那几个任务有用的特殊说明。

</details>

4. `Counted` 的 `call` 为什么要写 `self.base.call`,而不是 `super().call`?

<details><summary>答案</summary>

`super().call` 会用父类 `ToolRegistry` 自己的逻辑和 `funcs` 直接执行函数。如果被包的对象本身也是一层包装(比如截断器 `Capped`),它的 `call` 就被整个绕过了,而且不报错。`self.base.call` 把调用交给被包的对象,每一层都会被执行,才能一层套一层。练习 1 第一次就是这么错的,截断没生效。

</details>

5. (面试题)你改了一个工具的描述,说「效果更好了」。面试官问:你怎么证明?

<details><summary>答案</summary>

要点:①有一批带判卷的真实任务,改动前后用同一个模型、同一个 system prompt 各跑多遍;②报的不只是成功率,还有平均步数、工具调用次数、报错次数、token、花费和它们的波动范围;③改动来自读轨迹发现的具体问题(比如模型不知道编号和文件名的对应关系,多搜了三次),而且一次只改一处,能说清是哪一处起的作用;④有留出任务,调优时不看,最后验证改动是通用的;⑤举数字,比如「十次任务平均输入 token 从 5,929 降到 2,834,步数从 3.2 降到 2.4,留出任务也同步下降,成功率不变」。

</details>

## 明天预告

明天是 **Day 184 · 工具多了怎么办(一):先量一下 60 个工具有多贵**。这三天一直只有两三个工具,Day 180 练习 1 量过 3 个工具的定义就占了 328 个 token。可真实的 Agent 接一个 MCP server 就是几十个工具,再接几个系统就上百个,光工具定义每一步都要发一遍。明天先造 60 个工具,把这笔账量出来,再试几种最便宜的办法。
