---
title: 'Day 615 · 第 88 周复习:进阶(Day 609–614)'
description: '这一周讲了四种新形态:WebMCP、语音 Agent、Deep Research 和 Agent 互联。今天不学新东西:一张知识地图把六天串成「Agent 和外界怎么接」「长任务怎么交付」两条线,默写 Day 613 的引用核验器和 Day 614 的任务状态规则,用随机检查脚本证明默写对了(顺带揪出 Day 614 代码里一个重复派活的 bug),再拼一个研究报告交付闸门:研究、核验、带着问题清单重写、用任务状态交付。'
pubDate: 2026-10-23
regime: none
tags: ['review', 'deep-research', 'a2a', 'python', 'agent-zero']
series: 'agent-zero'
day: 615
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 614](/blog/agent-zero/day-614-a2a-1/) 先用一个本地模拟看清「对面是工具」和「对面是 Agent」的区别:Agent 不透明、任务有状态会跑很久、会反过来问你;然后分清 MCP 连工具、A2A 连别的 Agent、ACP 连编辑器;最后用 PyPI 和 GitHub 的公开接口查到 A2A 规范 1.0 在 2026 年 3 月 12 日发布,`a2a-sdk` 1.2.3 实现的是规范 1.0,8 月 17 日 A2A 加入了 AAIF。

这一周的六天看起来是四个不相干的话题:网页给 Agent 暴露工具、打电话的 Agent、写研究报告的 Agent、Agent 之间怎么互相调用。今天把它们串起来,默写两段最容易写错的代码,再做一个把本周零件拼在一起的小项目。

## 今天要解决的问题

复习日不加新概念。今天结束时你应该能:

1. 不看文章画出本周知识地图,说出每一天在「Agent 和外界怎么接」「长任务怎么交付」两条线里的位置。
2. 默写 [Day 613](/blog/agent-zero/day-613-deep-research-2/) 的 `split_sentences` 和 `verify`、[Day 614](/blog/agent-zero/day-614-a2a-1/) 的 `FinanceAgent.send`,并用检查脚本证明默写版和原版在几百上千组随机输入上结果一致。
3. 跑通本周小项目 `part10/review88/research_gate.py`:研究、核验、带着问题清单重写一次、用任务状态交付,并说清它为什么有时会越修越差。
4. 说出本周最容易犯的六个错。

预计用时 3 到 4 小时,大头在默写和小项目。默写部分不调模型;小项目每跑一次约 ¥0.02 到 ¥0.04,练习 2 跑两次约 ¥0.06。前置:[Day 609](/blog/agent-zero/day-609-webmcp/) 到 [Day 614](/blog/agent-zero/day-614-a2a-1/) 全部。

学法和平时一样:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="第 88 周知识地图:上一行是 Agent 和外界怎么接,609 WebMCP、610 和 611 语音、614 A2A;下一行是长任务怎么交付,612 和 613 Deep Research,以及 614 的任务状态">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <text x="20" y="24" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">第 88 周:Agent 的新形态,和外界怎么接、长任务怎么交付</text>
  <rect x="20" y="40" width="180" height="104" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="110" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">接网页</text>
  <text x="32" y="86" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">609 modelContext</text>
  <text x="32" y="104" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">609 命令式 / 声明式</text>
  <text x="32" y="122" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">609 两个方向都不可信</text>
  <rect x="220" y="40" width="190" height="104" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="315" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">接声音</text>
  <text x="232" y="86" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">610 延迟预算表</text>
  <text x="232" y="104" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">611 打断只写听到的</text>
  <text x="232" y="122" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">611 看 P95 不看平均</text>
  <rect x="430" y="40" width="190" height="104" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="525" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">接别的 Agent</text>
  <text x="442" y="86" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">614 工具 vs Agent</text>
  <text x="442" y="104" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">614 MCP/A2A/ACP</text>
  <text x="442" y="122" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">614 任务状态和终态</text>
  <rect x="20" y="180" width="390" height="80" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="215" y="202" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">长任务怎么交付:Deep Research</text>
  <text x="32" y="226" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">612 提纲 → 并行研究 → 压缩 → 写报告</text>
  <text x="32" y="244" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">613 规则核验 / 逐句评审 / 成本上限</text>
  <rect x="430" y="180" width="190" height="80" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="525" y="202" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">今天的小项目</text>
  <text x="442" y="226" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">research_gate.py</text>
  <text x="442" y="244" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">研究+核验+任务状态</text>
  <line x1="410" y1="220" x2="430" y2="220" stroke="var(--ink-soft)" stroke-width="1.5"/>
  <line x1="525" y1="144" x2="525" y2="180" stroke="var(--rule)" stroke-dasharray="4 3"/>
  <text x="320" y="288" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">上一行是三种「接口」,下一行是一种「交付」;小项目把下一行和 614 的任务状态接起来</text>
</svg>
<figcaption>本周知识地图。上一行三块讲 Agent 怎么和外面的东西接:网页、声音、别人的 Agent;下一行讲一个要跑几分钟的任务怎么交付得让人放心。今天的小项目用 612、613 的零件,结果用 614 的任务状态表示。</figcaption>
</figure>

两条线的交叉点,说一个具体的场景。客户打电话问:「我们公司这一年在云簿上的退款、发票、注销问题能不能帮我整理一下?」这一通电话把本周全用上了。语音那一侧,问题太大不可能在电话里当场答,机器人要先说一句过渡语(Day 611)让客户知道没断线,把整理工作作为一个**任务**派出去;任务这一侧,它就是一次 Deep Research(Day 612),交付前要过引用核验(Day 613),做完的结果用任务状态告诉调用方:completed 就发报告,核验不过就是 input-required,交给人工看(Day 614)。如果做研究的是财务团队的 Agent,派活就走 A2A。如果客户是在网页后台点「生成报告」按钮,那就是 WebMCP 的场景(Day 609)。

## 本周每天一句话

- [Day 609](/blog/agent-zero/day-609-webmcp/) · WebMCP:网站自己用 `document.modelContext` 给浏览器 Agent 注册工具,命令式写 `execute` 函数、声明式标在表单上;2026 年 10 月还是 W3C 社区组草案、Chrome 在试用期;注解只是提示,后果重大的操作要页面自己确认、后端全量校验,工具描述本身也可能是注入。
- [Day 610](/blog/agent-zero/day-610-voice-1/) · 语音 Agent(一):人和人接话中位数约 100 毫秒;把「说完到听见第一个字」拆成六段做延迟预算表,最大的一块是 VAD 静音等待而不是 LLM;用模拟器一次改一个参数,首音频从 1.58 秒压到 0.79 秒。
- [Day 611](/blog/agent-zero/day-611-voice-2/) · 语音 Agent(二):打断要停播放、取消生成、历史只写用户真正听到的字(写全文时模型以为说过退款金额,直接道别);分清附和和插话;过渡语把 500 通模拟电话的首音频 P95 从 2.74 秒压到 1.97 秒。
- [Day 612](/blog/agent-zero/day-612-deep-research-1/) · Deep Research(一):RAG 检索一次只读到 8 篇里的 3 篇;研究流水线是提纲、主管派活、研究员并行搜读并压缩成笔记、最后一次写完;读了 open_deep_research 的并发上限写法;子问题只放能查的,分析留给写报告。
- [Day 613](/blog/agent-zero/day-613-deep-research-2/) · Deep Research(二):GPT Researcher 的编辑部和 STORM 的多视角提问;Anthropic 复盘里 token 用量解释 80% 差异、多 Agent 多花约 15 倍;规则层核验第一版 26 处问题 22 处是误报;逐句评审抓到「月付按比例退」,也把分析句判成不支持;成本上限要给写报告预留。
- [Day 614](/blog/agent-zero/day-614-a2a-1/) · Agent 互联(一):对面是 Agent 时多出不透明、有状态、会反问三件事;MCP 连工具、A2A 连 Agent、ACP 连编辑器,IBM 的同名 ACP 已并入 A2A;A2A 1.0 于 2026-03-12 发布,8 月加入 AAIF。

六句话里反复出现一件事:**对外面来的东西不能全信,自己这边要有程序写死的检查**。WebMCP 的工具描述可能是注入,所以后端全量校验;语音里模型生成的全文不等于用户听到的,所以按播放进度截断;研究报告每句都挂着引用,可引用可能是假的,所以要有核验器;对面的 Agent 说任务完成了,终态之后就不能再改,所以状态规则写在代码里。上周的结论是「模型负责想,程序负责拦」,这周换了四个场景,还是这句话。

## 准备环境

今天的文件放在 `agent-zero-lab/part10/review88/` 下,只用标准库和本周已经写好的模块,不需要 `uv add` 新东西。

```bash
cd agent-zero-lab        # 换成你自己的练习仓库路径
mkdir -p part10/review88 && touch part10/review88/__init__.py
ls part10/research/verify.py part10/research/research.py part10/research/kb part10/a2a/tool_vs_agent.py
```

```text
part10/a2a/tool_vs_agent.py
part10/research/research.py
part10/research/verify.py

part10/research/kb:
kb-close.md	kb-coupon.md	kb-duplicate.md	kb-export.md	kb-invoice.md	kb-plan.md	kb-redflush.md	kb-refund.md
```

`research.py` 和 `kb/` 是 Day 612 建的(`research.py` 要是修过主管提示词的那一版),`verify.py` 是 Day 613 建的,`tool_vs_agent.py` 是 Day 614 建的。哪个没有,回到那一天把它敲出来再继续,今天的检查脚本要拿它们当「标准答案」。

## 默写一:引用核验 `split_sentences()` 和 `verify()`

先合上 Day 613,新建 `part10/review88/recall_verify.py`。`Problem` 和两个正则 `CITE`、`NUM` 直接从原文件导入,只默写两个函数的逻辑。下面是我默写的版本,你默写完再对照:

```python
# agent-zero-lab/part10/review88/recall_verify.py
"""默写一:Day 613 的 split_sentences() 和 verify()。Problem 和两个正则直接从原文件导入,只默写逻辑。"""
import re

from part10.research.verify import CITE, NUM, Problem


def split_sentences(report: str) -> list[str]:
    out: list[str] = []
    for line in report.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        for s in re.split(r"(?<=[。！？!?])", line):
            s = s.strip()
            if not s:
                continue
            m = re.match(r"^((?:\[[^\[\]]+\])+)\s*", s)
            if m and out:
                out[-1] += m.group(1)
                s = s[m.end():]
            if s:
                out.append(s)
    return out


def verify(report: str, kb: dict[str, str], read_ids: set[str]) -> list[Problem]:
    found: list[Problem] = []
    for s in split_sentences(report):
        ids = CITE.findall(s)
        nums = NUM.findall(CITE.sub("", s))
        if not ids:
            if nums:
                found.append(Problem("有数字没引用", s, f"数字 {nums}"))
            continue
        fake = [i for i in ids if i not in kb]
        if fake:
            found.append(Problem("假引用", s, f"不存在的来源 {fake}"))
        unread = [i for i in ids if i in kb and i not in read_ids]
        if unread:
            found.append(Problem("引用没读过的资料", s, f"{unread} 不在任何研究员的笔记里"))
        corpus = " ".join(kb[i] for i in ids if i in kb)
        bad = [n for n in nums if n not in corpus]
        if corpus and bad:
            found.append(Problem("数字对不上", s, f"{bad} 在被引用的资料里找不到"))
    return found
```

<div class="line-notes">

- `from part10.research.verify import CITE, NUM, Problem` 正则不默写,直接借原版的。`CITE` 里那个 `(?:id=)?` 是 Day 613 修误报时加的,你要能说出它为什么在那里。
- `if not line or line.startswith("#"):` 跳过空行和标题行。不跳过,「### 2.1」里的 2.1 会被当成「有数字没引用」,Day 613 第一版 14 处误报都来自这里。
- `for s in re.split(r"(?<=[。！？!?])", line):` 后行断言:在句末标点**后面**切,标点留在前一句。默写时容易写成 `re.split(r"[。！？!?]", line)`,那样标点会被切掉,打印出来给人复核的句子就不完整了。
- `m = re.match(r"^((?:\[[^\[\]]+\])+)\s*", s)` 原版变量叫 `lead`,我默写成了 `m`。名字不同没关系,检查脚本只比结果。
- `if m and out:` **这是这道题的考点**:句号后面的引用要挪回上一句。下面会演示漏了这几行会怎样。`and out` 防的是报告第一句就以引用开头、前面没有句子可挂的情况。
- `nums = NUM.findall(CITE.sub("", s))` 先删引用再找数字,不然 `[kb-002]` 里的 002 会被当成正文数字。
- `if corpus and bad:` `corpus` 为空说明这句只挂了假引用,假引用已经报过了,没必要再报一次数字问题。

</div>

检查脚本随机拼 2000 份小报告,每份 1 到 6 行,混着标题行、带数字和不带数字的句子、0 到 2 个引用(有真有假,有 `id=` 前缀),引用有时在句号前、有时在句号后:

```python
# agent-zero-lab/part10/review88/check_verify.py
"""随机拼 2000 份小报告,比较默写版和原版的核验结果,任何一份不同就打印出来。"""
import random
from pathlib import Path

from part10.research import verify as original
from part10.research.local_search import LocalSearch
from part10.review88 import recall_verify as mine

KB = {d.id: d.text for d in LocalSearch(Path("part10/research/kb")).docs}
READ = {"kb-refund", "kb-invoice", "kb-close", "kb-export"}
CITES = list(KB) + ["资料中未找到", "id=kb-refund"]
NUMS = ["3", "5", "14", "15", "24", "30", "48"]


def fake_sentence(rng: random.Random) -> str:
    body = f"规则{rng.choice(['', '在 ' + rng.choice(NUMS) + ' 天内'])}生效"
    cite = "".join(f"[{rng.choice(CITES)}]" for _ in range(rng.randint(0, 2)))
    end = rng.choice(["。", "!", "?"])
    return body + cite + end if rng.random() < 0.5 else body + end + cite


def fake_report(rng: random.Random) -> str:
    lines = []
    for _ in range(rng.randint(1, 6)):
        if rng.random() < 0.2:
            lines.append(f"### {rng.randint(1, 5)}.{rng.randint(1, 4)} 小节")
        lines.append(" ".join(fake_sentence(rng) for _ in range(rng.randint(1, 3))))
    return "\n".join(lines)


rng = random.Random(88)
diff = hits = 0
for n in range(2000):
    report = fake_report(rng)
    a = [(p.kind, p.detail) for p in original.verify(report, KB, READ)]
    b = [(p.kind, p.detail) for p in mine.verify(report, KB, READ)]
    hits += bool(a)
    if a != b:
        diff += 1
        if diff == 1:
            print(f"第 {n} 份不一致:\n{report}\n  原版 {a}\n  默写 {b}")
print(f"2000 份里不一致 {diff} 份;原版报出问题的有 {hits} 份")
```

<div class="line-notes">

- `from part10.research import verify as original` 原版整个模块导入成 `original`,默写版导入成 `mine`,两边都有叫 `verify` 的函数,用模块名区分。
- `KB = {d.id: d.text for d in LocalSearch(Path("part10/research/kb")).docs}` 用 Day 612 的真资料,数字检查才有意义。路径是相对仓库根目录写的,所以必须在 `agent-zero-lab` 下用 `-m` 跑。
- `READ = {"kb-refund", "kb-invoice", "kb-close", "kb-export"}` 假装只读了 4 篇,另外 4 篇被引用时会触发「引用没读过的资料」。
- `CITES = list(KB) + ["资料中未找到", "id=kb-refund"]` 8 个真 id 加一个假引用、一个带前缀的写法,Day 613 见过的三种情况都覆盖到。
- `NUMS = ["3", "5", "14", "15", "24", "30", "48"]` 有的在资料里出现过(14、24、30),有的没有(48),有的是子串陷阱(5 在「15 天」里也算找到)。
- `return body + cite + end if rng.random() < 0.5 else body + end + cite` 一半引用在句号前,一半在句号后。后者就是专门用来测「挪回上一句」那段逻辑的。
- `lines.append(f"### {rng.randint(1, 5)}.{rng.randint(1, 4)} 小节")` 两成概率插一个带编号的标题,测「跳过标题行」。
- `rng = random.Random(88)` 用独立的随机数生成器并固定种子,每次跑抽到的报告都一样,结果可复现。
- `a = [(p.kind, p.detail) for p in original.verify(report, KB, READ)]` 只比问题类型和细节,不比整个 `Problem`,这样默写版的句子切得稍有不同(比如末尾空格)也不会被误判,但问题报得不一样一定会被抓到。
- `hits += bool(a)` 数一下原版报出问题的报告有多少份。如果是 0,说明随机数据没测到任何分支,「0 份不一致」就没有意义。

</div>

```bash
uv run python -m part10.review88.check_verify
```

真实输出:

```text
2000 份里不一致 0 份;原版报出问题的有 1943 份
```

1943 份报出问题,说明各个分支都被测到了(随机拼的句子大多不合规,这是故意的)。再故意把「挪回上一句」那 4 行删掉,也就是默写时最容易漏的那一段,跑一次:

```text
第 1 份不一致:
规则生效。 规则在 3 天内生效[kb-plan]?
规则在 3 天内生效![kb-plan][id=kb-refund] 规则在 24 天内生效! 规则在 15 天内生效。[kb-refund]
  原版 [('引用没读过的资料', "['kb-plan'] 不在任何研究员的笔记里"), ('数字对不上', "['3'] 在被引用的资料里找不到"), ('引用没读过的资料', "['kb-plan'] 不在任何研究员的笔记里"), ('有数字没引用', "数字 ['24']"), ('数字对不上', "['15'] 在被引用的资料里找不到")]
  默写 [('引用没读过的资料', "['kb-plan'] 不在任何研究员的笔记里"), ('数字对不上', "['3'] 在被引用的资料里找不到"), ('有数字没引用', "数字 ['3']"), ('引用没读过的资料', "['kb-plan'] 不在任何研究员的笔记里"), ('数字对不上', "['24'] 在被引用的资料里找不到"), ('有数字没引用', "数字 ['15']")]
2000 份里不一致 1424 份
```

看第二行。「规则在 3 天内生效!」后面跟着的 `[kb-plan][id=kb-refund]` 本该属于它;漏了挪回的逻辑,这串引用就被算到了下一句「规则在 24 天内生效!」头上。结果一错错两句:前一句变成「有数字没引用」,后一句的 24 被拿去 kb-plan 和 kb-refund 里找,找不到,变成「数字对不上」。2000 份里 1424 份结果不同,这一段逻辑漏了,核验器基本就不能用了。DeepSeek 写报告时确实会把引用放在句号后面(Day 612 的输出里就有),这不是检查脚本故意刁难。

## 默写二:任务状态 `FinanceAgent.send()`

第二段默写 Day 614 对账 Agent 的 `send`。`Task`、`_reconcile`、`get` 都直接继承原版,只默写状态规则:

```python
# agent-zero-lab/part10/review88/recall_agent.py
"""默写二:Day 614 的 FinanceAgent.send()。Task、_reconcile、get 直接继承原版,只默写 send 的状态规则。"""
import asyncio

from part10.a2a.tool_vs_agent import FinanceAgent, Task

TERMINAL = ("completed", "failed", "canceled", "rejected")


class RecallAgent(FinanceAgent):
    def send(self, text: str, task_id: str | None = None) -> Task:
        task = self.tasks[task_id] if task_id else Task(id=f"task-{next(self._ids)}")
        if task.state in TERMINAL:
            raise ValueError(f"{task.id} 已经是终态 {task.state},不能再发消息")
        self.tasks[task.id] = task
        task.history.append(text)
        if any("INV-" in h for h in task.history):
            task.state, task.question = "working", ""
            job = asyncio.get_running_loop().create_task(self._reconcile(task))
            self._running.add(job)
            job.add_done_callback(self._running.discard)
        else:
            task.state, task.question = "input-required", "请提供发票号(INV- 开头)"
        return task
```

<div class="line-notes">

- `TERMINAL = ("completed", "failed", "canceled", "rejected")` 四个终态。默写时最常漏的是 `rejected`,因为第 1 步的演示里没出现,只在练习 1 里出现过。
- `class RecallAgent(FinanceAgent):` 继承原版,只覆盖 `send`。这样 `_reconcile` 的 0.3 秒延迟、`get`、`_running` 集合都和原版一模一样,比较的只有状态规则。
- `if task.state in TERMINAL:` **这道题的考点**:终态检查要在追加历史**之前**。Day 614 我第一版就写反了,先 `append` 再检查,结果报错了,可那条消息已经被写进了一个已完成任务的历史。
- `if any("INV-" in h for h in task.history):` 我默写时把 if/else 两支对调了(原版是 `if not any(...)` 先处理缺发票号)。逻辑等价,检查脚本会证明这一点。
- `self._running.add(job)` 存一份引用防止后台任务被垃圾回收,这一行默写时很容易忘,而且忘了也不会马上出错,是那种「偶尔丢一个任务」的坑。

</div>

检查脚本随机生成 300 段对话,每段 1 到 5 条消息,七成接着上一个任务说、三成开新任务,每条消息后随机等 0、0.05 或 0.35 秒(对账要 0.3 秒,等 0.35 秒就能看到 completed),记下每一步之后的任务状态。300 段对话用 `asyncio.gather` 同时跑,3 秒左右跑完:

```python
# agent-zero-lab/part10/review88/check_agent.py
"""300 段随机对话分别发给原版和默写版,比较每一步之后的任务状态。所有对话同时跑,两秒左右跑完。"""
import asyncio
import random

from part10.a2a.tool_vs_agent import FinanceAgent
from part10.review88.recall_agent import RecallAgent

MESSAGES = ["帮忙核对扣款", "发票号 INV-0042-03", "是上个月的", "INV-0042-04 也看看"]
Script = list[tuple[str, bool, float]]


async def play(agent: FinanceAgent, script: Script) -> list[str]:
    trace: list[str] = []
    last: str | None = None
    for text, same_task, wait in script:
        try:
            last = agent.send(text, task_id=last if same_task else None).id
            trace.append(agent.get(last).state)
        except ValueError:
            trace.append("拒收")
        await asyncio.sleep(wait)
        if last:
            trace.append(agent.get(last).state)
    return trace


async def main() -> None:
    rng = random.Random(614)
    scripts: list[Script] = [
        [(rng.choice(MESSAGES), rng.random() < 0.7, rng.choice([0, 0.05, 0.35])) for _ in range(rng.randint(1, 5))]
        for _ in range(300)
    ]
    originals = await asyncio.gather(*(play(FinanceAgent(), s) for s in scripts))
    recalls = await asyncio.gather(*(play(RecallAgent(), s) for s in scripts))
    bad = [(s, a, b) for s, a, b in zip(scripts, originals, recalls) if a != b]
    for s, a, b in bad[:1]:
        print(f"不一致的一段:{[(t, same) for t, same, _ in s]}\n  原版 {a}\n  默写 {b}")
    refused = sum("拒收" in a for a in originals)
    print(f"300 段里不一致 {len(bad)} 段;原版里出现过「终态拒收」的有 {refused} 段")


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `MESSAGES = ["帮忙核对扣款", "发票号 INV-0042-03", "是上个月的", "INV-0042-04 也看看"]` 两条不带发票号、两条带。随机组合能走到 input-required、working、completed 和终态拒收四种情况。
- `Script = list[tuple[str, bool, float]]` 类型别名:一段对话是若干个(消息, 是否接着上一个任务, 发完等几秒)。相当于 TS 的 `type Script = [string, boolean, number][]`。
- `last = agent.send(text, task_id=last if same_task else None).id` 接着上一个任务说,还是开新任务。第一条消息时 `last` 是 `None`,所以一定是新任务。
- `except ValueError:` 发给终态任务会被拒,记成「拒收」。不记任务 id,因为两个类共用一个 id 计数器,同时跑时 id 会交错,比 id 没意义。
- `if last:` 等完以后再看一次状态。这一步能看到后台对账有没有跑完。
- `originals = await asyncio.gather(*(play(FinanceAgent(), s) for s in scripts))` 300 段对话同时跑,每段一个独立的 Agent 实例。我第一版是一段一段顺序跑,算下来要好几分钟,终端超时了才改成这样。等待时间多的检查,能并行就并行。
- `refused = sum("拒收" in a for a in originals)` 原版里有多少段走到了「终态拒收」。这个数是 0 的话,终态检查那条分支就没被测到。

</div>

```bash
uv run python -m part10.review88.check_agent
```

```text
300 段里不一致 0 段;原版里出现过「终态拒收」的有 68 段
```

再把终态检查那两行删掉跑一次:

```text
不一致的一段:[('发票号 INV-0042-03', True), ('帮忙核对扣款', True), ('帮忙核对扣款', True)]
  原版 ['working', 'working', 'working', 'completed', '拒收', 'completed']
  默写 ['working', 'working', 'working', 'completed', 'working', 'working']
300 段里不一致 68 段;原版里出现过「终态拒收」的有 68 段
```

68 段全抓到了。看这一段:任务已经 completed,第三条消息进来,原版拒收,删了检查的版本又把它改回 working,重新开始对账。放在真实系统里,就是一个已经发起过退款的任务又被跑了一遍。

### 顺带揪出的一个 bug

仔细看上面那段的前四个状态:第一条带发票号,working;第二条「帮忙核对扣款」发进来时任务还在 working,状态还是 working。看着没问题,可原版 `send` 里只要历史里有 `INV-` 就会 `create_task` 一次,所以**第二条消息又派了一份对账**。原版和默写版行为一致,所以检查脚本不会报,它只证明「默写对了」,不证明「原版对」。练习 1 专门修它。

## 本周小项目:研究报告交付闸门

现在把本周的零件拼起来。需求是这样的:Deep Research 跑出来的报告不能直接发给用户,要先过 Day 613 的规则核验;有问题就把问题清单交给写报告的模型重写一次;再核验,通过了就交付(completed),还不通过就停下来交给人(input-required,Day 614 的任务状态);每一段花了多少时间记一张账(Day 610 延迟预算表的思路,只是这里的单位是秒不是毫秒)。

```python
# agent-zero-lab/part10/review88/research_gate.py
"""本周小项目:研究报告交付闸门。研究(612)-> 规则核验(613)-> 有问题就带着问题清单重写一次 -> 再核验,
结果用任务状态(614)表示,每段耗时记成一张时间账(610 的预算表思路)。"""
import asyncio
import re
import time
from dataclasses import dataclass, field
from pathlib import Path

from common.llm import LLMClient
from part10.research.local_search import LocalSearch
from part10.research.research import WRITE_PROMPT, Budget, Note, plan, research_all
from part10.research.verify import CITE, Problem, verify

KB_DIR = Path(__file__).parent.parent / "research" / "kb"
REPAIR_RULES = """
另外必须遵守:引用只能写成 [id] 形式,id 只能是笔记里出现过的;资料里没有的内容放进最后一节「资料缺口」,这一节不加任何引用。
上一版报告有这些问题,这一版必须避免:
{issues}"""


def gate_problems(report: str, kb: dict[str, str], read_ids: set[str]) -> list[Problem]:
    """「资料缺口」之前的正文用 verify 查;缺口那一节只查一件事:不许挂引用。"""
    m = re.search(r"^#+.*资料缺口.*$", report, re.M)
    body, gap = (report[: m.start()], report[m.start():]) if m else (report, "")
    body = re.sub(r"^\s*\d+\.\s+", "", body, flags=re.M)
    problems = verify(body, kb, read_ids)
    if CITE.search(gap):
        problems.append(Problem("缺口节挂了引用", gap[:60], f"{CITE.findall(gap)}"))
    return problems


@dataclass
class GateResult:
    state: str  # completed:核验通过;input-required:修过一次还有问题,要人看
    report: str
    problems: list[Problem]
    timings: dict[str, float] = field(default_factory=dict)


def write_report(brief: str, notes: list[Note], llm: LLMClient, issues: str = "") -> str:
    notes_text = "\n\n".join(f"## {n.subquestion}\n{n.text}" for n in notes)
    prompt = WRITE_PROMPT.format(brief=brief, notes=notes_text)
    if issues:
        prompt += REPAIR_RULES.format(issues=issues)
    return llm.chat([{"role": "user", "content": prompt}]).content


def run_gate(q: str, llm: LLMClient) -> GateResult:
    timings: dict[str, float] = {}
    kb = {d.id: d.text for d in LocalSearch(KB_DIR).docs}
    t = time.perf_counter()
    brief, subqs = plan(q, llm, Budget())
    notes = asyncio.run(research_all(subqs, llm, LocalSearch(KB_DIR), Budget()))
    read_ids = {i for n in notes for i in n.source_ids}
    timings["规划+研究"] = time.perf_counter() - t

    t = time.perf_counter()
    report = write_report(brief, notes, llm)
    timings["写报告"] = time.perf_counter() - t
    problems = gate_problems(report, kb, read_ids)
    print(f"第一版:{len(problems)} 处问题", [f"{p.kind} {p.detail}" for p in problems])
    if not problems:
        return GateResult("completed", report, problems, timings)

    t = time.perf_counter()
    issues = "\n".join(f"- {p.kind}:{p.detail}" for p in problems)
    report = write_report(brief, notes, llm, issues)
    timings["重写"] = time.perf_counter() - t
    problems = gate_problems(report, kb, read_ids)
    print(f"重写后:{len(problems)} 处问题")
    return GateResult("completed" if not problems else "input-required", report, problems, timings)


if __name__ == "__main__":
    llm = LLMClient()
    result = run_gate("整理云簿关于退款、发票和账户注销的规则,指出其中容易让客户误解的地方。", llm)
    print("任务状态:", result.state)
    for p in result.problems:
        print(f"  [{p.kind}] {p.detail}")
    total = sum(result.timings.values())
    for stage, sec in result.timings.items():
        print(f"  {stage:<6} {sec:5.1f}s  {sec / total:4.0%}")
    (Path(__file__).parent / "gate_report.md").write_text(result.report, encoding="utf-8")
    print("报告最后一节:", result.report[result.report.rfind("##"):][:200].replace("\n", " "))
    print(llm.ledger)
```

<div class="line-notes">

- `from part10.research.research import WRITE_PROMPT, Budget, Note, plan, research_all` Day 612 的零件。`write` 函数没导入,因为要往提示词后面追加问题清单,自己写了一个 `write_report`,但提示词正文 `WRITE_PROMPT` 还是用原版的。
- `KB_DIR = Path(__file__).parent.parent / "research" / "kb"` 从 `review88/` 往上一级再进 `research/kb`。
- `REPAIR_RULES = """` 重写时追加的要求。前半是格式规则(Day 613 发现的 `id=` 前缀、假引用),后半是上一版的具体问题清单。只说「请修正」效果很差,把问题逐条列出来模型才知道改哪。
- `资料里没有的内容放进最后一节「资料缺口」,这一节不加任何引用。` 这条规则和核验器要配套,下面 `gate_problems` 专门处理这一节。
- `m = re.search(r"^#+.*资料缺口.*$", report, re.M)` 找「资料缺口」那个标题。`re.M` 让 `^` `$` 匹配每一行的开头结尾,不只是整个字符串的开头结尾。
- `body, gap = (report[: m.start()], report[m.start():]) if m else (report, "")` 标题之前是正文,之后是缺口节。没有这一节就整篇都当正文。
- `body = re.sub(r"^\s*\d+\.\s+", "", body, flags=re.M)` 去掉行首的「1. 」「2. 」列表编号,不然编号会被当成「有数字没引用」。这一行和上面两行都是跑出问题以后加的,下面说。
- `if CITE.search(gap):` 缺口节只查一件事:不许有引用。说「没找到」又挂一个引用,就是 Day 612 那种「引用和内容对不上」。
- `state: str  # completed:核验通过;input-required:修过一次还有问题,要人看` 借 Day 614 的任务状态。核验不过不叫 failed,因为任务没失败,只是需要人补一手。
- `timings: dict[str, float] = field(default_factory=dict)` 每一段耗时。可变的默认值必须用 `default_factory`,写成 `= {}` dataclass 会直接报错。
- `prompt += REPAIR_RULES.format(issues=issues)` 第一次写不加,重写时才加。
- `if not problems:` 第一版就干净,直接交付,省一次调用。
- `issues = "\n".join(f"- {p.kind}:{p.detail}" for p in problems)` 把问题清单拼成几行文字交给模型。
- `return GateResult("completed" if not problems else "input-required", report, problems, timings)` 只重写一次。重写次数要有上限,练习 2 会看为什么。
- `print(f"  {stage:<6} {sec:5.1f}s  {sec / total:4.0%}")` `:4.0%` 把小数格式化成百分比,0.34 显示成 34%。这就是一张小小的时间预算表。
- `(Path(__file__).parent / "gate_report.md").write_text(result.report, encoding="utf-8")` 每次把交付的报告存下来,人工复核时要看全文。这一行也是我吃了亏才加的。

</div>

```bash
uv run python -m part10.review88.research_gate
```

最后一次跑的真实输出:

```text
第一版:1 处问题 ["缺口节挂了引用 ['kb-invoice', 'kb-redflush', 'kb-redflush', 'kb-close', 'kb-close', 'kb-close', 'kb-close', 'kb-export', 'kb-close', 'kb-close', 'kb-duplicate', 'kb-invoice', 'kb-refund', 'kb-duplicate', 'kb-invoice', 'kb-redflush', 'kb-close', 'kb-export', 'kb-refund', 'kb-duplicate', 'kb-redflush', 'kb-invoice', 'kb-close']"]
重写后:0 处问题
任务状态: completed
  规划+研究    4.6s   34%
  写报告      4.7s   35%
  重写       4.1s   31%
报告最后一节: ## 五、资料缺口  - 退款申请的具体操作入口。 - 退款手续费规则。 - 除年付超 14 天按剩余整月退款、月付不支持退款、重复扣款自动退款之外的 other 例外情形。 - 除电子发票外的其他发票类型。 - 电子发票之外的其他开具条件。 - 完整的开票流程说明。 - 除红冲重开外的换开规则。 - 退款与开票之间的其他关系。 - 单独的注销办理时限。 - 注销后已购服务的处理规则。 - 注销后
7 次调用 | 输入 3419 / 输出 3205 tokens | 约 ¥0.0307
```

第一版正文是干净的,问题出在「资料缺口」那一节挂了 23 个引用。带着清单重写一次,缺口节变成了纯列表,0 处问题,completed。时间账三段差不多各占三分之一,重写让总时长多了约 45%。还有一个小瑕疵:缺口节第三条冒出一个英文单词「other」,中文报告里夹英文是 DeepSeek 偶尔会有的毛病,规则层管不到这种事,这就是人工抽查那一层的活。

### 它并不总是这么顺

上面是我跑的第四次。前三次的经历,比最后这次成功更值得讲。

**第一次**,`gate_problems` 还不存在,直接用 `verify` 查全文。第一版 1 处问题,重写后变成 **7 处**,任务状态 input-required。7 处全是「有数字没引用」,数字是 1、2、3、4、5、6 和 14:重写时我要求「资料缺口单独成节、不加引用」,模型照做了,缺口节写成了「1. 退款申请时限(除年付 14 天外)的完整规定。2. ……」这样的编号列表。列表编号和「14 天」都没有引用,核验器全报了。**写报告的规则和核验的规则打架了**:一边说缺口节不许挂引用,一边说有数字就得挂引用。于是加了「缺口节之前的正文才用 `verify` 查」和「去掉行首编号」。

**第二次**,只跳过了缺口节,没加「缺口节不许挂引用」那条检查。第一版 0 处问题,直接 completed。可打开报告一看,缺口节写着「发票类型 [kb-invoice];注销后能否补开发票 [kb-invoice]」:说没找到,又挂着引用。我为了消除误报跳过了一整节,这一节就成了盲区。这正是 Day 613 练习 1 抓的那种句子。于是加了 `if CITE.search(gap)` 那条。

**第三次**,两条都加了。第一版 3 处问题(两句带 24 小时、一句带 30 天和 1 次,都没挂引用);重写后变成 **12 处**,input-required。这次我没有存报告,看不到全文,从数字(1、2、3、4 反复出现)猜,多半是重写版把内容改成了「1)」「(1)」这类编号,不是 `1. ` 的格式,没被去掉。这次之后加了 `gate_report.md` 那一行:**闸门判了 input-required,交给人的时候必须附上全文**,不然人也没法看。

四次跑下来,这个闸门的价值不在于「让报告一定合格」,而在于**它让「不合格」变成一个看得见的状态**。修一次可能变好,也可能更糟,模型输出就是不稳定的([Day 112](/blog/agent-zero/day-112-sampling-2/));闸门做不到保证质量,但能保证不合格的报告不会悄悄发出去。

### 零件和小项目的对照

| 小项目里的哪一段 | 来自哪一天的哪个零件 |
| --- | --- |
| `plan`、`research_all`、`WRITE_PROMPT` | Day 612 `research.py`,修过主管提示词的版本 |
| `verify`、`CITE`、`Problem` | Day 613 `verify.py` |
| 缺口节挂引用的检查 | Day 613 练习 1 的 `gap_with_real_cite` 思路 |
| 带问题清单重写一次 | Day 613「修法不在核验器,在写报告的提示词」 |
| `completed` / `input-required` | Day 614 的任务状态 |
| 时间账 | Day 610 延迟预算表 |
| `asyncio.run`、`to_thread`(在 `research_all` 里) | Day 612 |

## 本周错题与坑清单

**1. WebMCP 的注解当成安全保证(Day 609)。** `consequentialHint: true` 只是给守规矩的 Agent 的提示,浏览器不保证弹确认。后果重大的操作页面自己确认,业务规则后端全量校验。

**2. 打断后把模型写出来的全文写进历史(Day 611)。** 用户只听到「查到了,您九月三号」,历史里却写着整段退款说明,模型以为说过了金额,直接道别。历史只能写到真正播出去的位置,播放进度按实际播出的音频算,不能按时钟算。

**3. 把分析题拆成搜索题(Day 612)。** 「哪些条款容易误解」派给研究员只会得到「资料中未找到」。Day 613 第 1 步又看到一次:提示词里写了规则,模型这次还是拆了一个半分析的子问题。规则写了不等于会被遵守,所以才要有核验。

**4. 核验器只看漏报不看误报(Day 613)。** 第一版 26 处问题 22 处是误报。今天的小项目第一次跑又是同一个坑:编号列表被当成「有数字没引用」。每加一条规则,都要拿真实输出跑一遍看误报。

**5. 为了消除误报跳过一整块,留下盲区(今天)。** 跳过「资料缺口」那一节,误报没了,缺口节挂假引用也没人查了。跳过一块的同时,要为这一块定一条它自己的规则。

**6. 检查脚本证明的是「默写和原版一样」,不是「原版对」(今天)。** Day 614 的 `send` 在 working 时收到消息会再派一份对账,原版和默写版一样有这个 bug,检查脚本发现不了。比较「两版是否一致」和验证「是否符合需求」是两件事,后者要另写针对需求的测试。

## 动手练习

**练习 1:修掉重复派活。** Day 614 的 `FinanceAgent` 在任务 working 时再收到消息,会再 `create_task` 一次,同一张发票对账两次。写一个子类修掉它:working 时收到的消息记进历史,但不再派活。用「发一条带发票号的,紧接着再发两条」数一下后台同时在跑几份对账。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/review88/ex615_working.py
"""练习 1:Day 614 的 FinanceAgent 在 working 时再收到消息,会再派一次对账。修掉它。"""
import asyncio

from part10.a2a.tool_vs_agent import FinanceAgent, Task


class FixedAgent(FinanceAgent):
    def send(self, text: str, task_id: str | None = None) -> Task:
        if task_id and self.tasks[task_id].state == "working":
            self.tasks[task_id].history.append(text)  # 记下来,但不再开一份对账
            return self.tasks[task_id]
        return super().send(text, task_id)


async def count_jobs(agent: FinanceAgent) -> int:
    t = agent.send("核对 INV-0042-03")
    agent.send("补充:是九月那笔", task_id=t.id)
    agent.send("INV-0042-03 麻烦快点", task_id=t.id)
    return len(agent._running)


async def main() -> None:
    print("原版同时在跑的对账:", await count_jobs(FinanceAgent()))
    print("修好后同时在跑的对账:", await count_jobs(FixedAgent()))


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `if task_id and self.tasks[task_id].state == "working":` 只拦「接着一个正在跑的任务说话」这一种情况,其他情况全交给原版处理。
- `self.tasks[task_id].history.append(text)  # 记下来,但不再开一份对账` 消息不丢,对方以后可能用得上(比如「补充:是九月那笔」),但不重复干活。
- `return len(agent._running)` 三条消息发完、对账还没跑完(要 0.3 秒),此时后台有几份对账在跑。

</div>

```bash
uv run python -m part10.review88.ex615_working
```

```text
原版同时在跑的对账: 3
修好后同时在跑的对账: 1
```

原版发三条消息派了三份对账,三份都会去「发起退款」。修好后只有一份。真实的 A2A 里,对方 Agent 在 working 时收到新消息该怎么处理,是它自己的设计决定(合并进当前工作、排队、或者拒绝),但无论哪种,都不能是「再干一遍有副作用的事」。这条修复也该补进 Day 614 的原文件;改完以后重跑默写二的检查脚本,默写版会和新原版不一致,你得把默写版也改了,检查才会重新变成 0。

</details>

**练习 2:允许修多次,但越修越差就停。** 小项目只重写一次。改成最多重写 `max_repairs` 次,每一版的问题数都记下来;如果新一版的问题数不比上一版少,就停下来,保留上一版,交给人。跑两次看看。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/review88/ex615_rounds.py
"""练习 2:闸门允许最多修 max_repairs 次,每一版的问题数都记下来;问题数不降反升就提前停。"""
import asyncio

from common.llm import LLMClient
from part10.research.local_search import LocalSearch
from part10.research.research import Budget, plan, research_all
from part10.review88.research_gate import KB_DIR, gate_problems, write_report


def gate_rounds(q: str, max_repairs: int = 2) -> tuple[str, list[int]]:
    llm = LLMClient()
    kb = {d.id: d.text for d in LocalSearch(KB_DIR).docs}
    brief, subqs = plan(q, llm, Budget())
    notes = asyncio.run(research_all(subqs, llm, LocalSearch(KB_DIR), Budget()))
    read_ids = {i for n in notes for i in n.source_ids}
    best = write_report(brief, notes, llm)
    problems = gate_problems(best, kb, read_ids)
    counts = [len(problems)]
    for _ in range(max_repairs):
        if not problems:
            break
        issues = "\n".join(f"- {p.kind}:{p.detail}" for p in problems)
        report = write_report(brief, notes, llm, issues)
        new = gate_problems(report, kb, read_ids)
        counts.append(len(new))
        if len(new) >= len(problems):
            break  # 越修越多,保留上一版,交给人
        best, problems = report, new
    state = "completed" if not problems else "input-required"
    print(f"每一版的问题数:{counts},最后交付的那版 {len(problems)} 处,状态 {state};{llm.ledger}")
    return state, counts


if __name__ == "__main__":
    for _ in range(2):
        gate_rounds("整理云簿关于退款、发票和账户注销的规则,指出其中容易让客户误解的地方。")
```

<div class="line-notes">

- `from part10.review88.research_gate import KB_DIR, gate_problems, write_report` 复用小项目的零件,只重写循环。
- `best = write_report(brief, notes, llm)` `best` 永远指向「目前问题最少的那一版」,最后交付的是它,不一定是最新的那版。
- `counts = [len(problems)]` 每一版的问题数,事后看这一串数字就知道修复有没有用。
- `for _ in range(max_repairs):` 修复次数有硬上限。没有上限的「修到通过为止」,碰上模型一直修不好,就是一个停不下来的循环,和 Day 612 主管轮数要有上限是一个道理。
- `if len(new) >= len(problems):` 新一版没有变好(包括持平),就不再修了。今天第一、三次跑都是越修越多,这条规则能让它们早一步停,并且交付的是问题更少的那一版。
- `best, problems = report, new` 只有真的变好了,才把新版本当成最佳版本。

</div>

```bash
uv run python -m part10.review88.ex615_rounds
```

```text
每一版的问题数:[1, 0],最后交付的那版 0 处,状态 completed;6 次调用 | 输入 2637 / 输出 3526 tokens | 约 ¥0.0322
每一版的问题数:[1, 0],最后交付的那版 0 处,状态 completed;6 次调用 | 输入 2476 / 输出 2960 tokens | 约 ¥0.0274
```

这两次运气好,都是修一次就通过,`max_repairs=2` 的第二次修复没用上。如果碰上小项目第一次那种 `[1, 7]`,这个版本会在第一次修复后就停,交付问题只有 1 处的第一版,状态 input-required,比原来交付 7 处问题的重写版强。两次花费合计 ¥0.0596。

</details>

**练习 3(思考题):把本周串成一个产品。** 客户在电话里说「帮我整理一下我们公司这一年在云簿上的退款、发票和注销问题」。不写代码,按顺序说出这通电话从接起到客户拿到报告,会用到本周哪几天的哪些东西,每一步可能出什么错。

<details><summary>参考答案</summary>

一个示范答案,按时间顺序:

1. **听清问题**(Day 610):VAD 等客户说完,ASR 转文字。问题很长,静音等待设短了会把客户的话截成两半。
2. **判断不能当场答**(Day 613 练习 3 的分档思路):这是 complex 档,跨三个主题,电话里不可能几秒内答完。
3. **先说过渡语,再派任务**(Day 611、614):机器人说「这个需要整理几分钟,整理好发到您的账单邮箱,可以吗?」,同时把研究作为一个任务派出去,拿到任务 id。如果研究是财务团队的 Agent 做的,这一步走 A2A。可能出的错:过渡语说完客户插话「不用发邮件,我在线等」,打断处理要把历史截到客户真正听到的地方(Day 611)。
4. **研究**(Day 612):主管拆子问题,研究员并行查。可能出的错:把「哪些容易误解」拆成搜索题;想不到「降级差价」这类边角方向。
5. **交付闸门**(Day 613、今天的小项目):规则核验、必要时带清单重写、记花费。可能出的错:核验规则和写报告规则打架,跳过一节留下盲区。
6. **交付**(Day 614):completed 就发邮件;input-required 就转人工,附全文和问题清单。可能出的错:调用方只认 completed,碰上 input-required 一直等。
7. **如果客户之后在网页后台点「重新生成」**(Day 609):那是 WebMCP 的场景,后台页面把「生成报告」注册成一个工具,写操作要页面自己确认。

这道题没有唯一答案,关键是每一步你都能说出它属于哪一天、最可能在哪里出错。

</details>

**验收标准**:`check_verify.py` 和 `check_agent.py` 都输出 0 处不一致,而且「报出问题」「终态拒收」两个数都不是 0;你能说出默写一、默写二各自最容易漏的那一段,以及漏了会怎样;`research_gate.py` 跑通至少一次,你能说出 `gate_problems` 里三处特殊处理(跳过缺口节、去掉列表编号、缺口节不许挂引用)各是为了什么;练习 1 跑出「3 → 1」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 交付闸门 | 结果交给用户之前必须通过的一道自动检查,不通过就不发,转成需要人处理的状态 |
| 默写检查脚本 | 用大量随机输入同时跑原版和默写版,比较结果是否一致。证明的是「两版一致」,不是「原版正确」 |
| 盲区 | 为了消除误报跳过的那部分内容,如果不给它单独定规则,就没人查了 |
| 修复上限 | 「发现问题→让模型重写」最多做几轮。没有上限可能停不下来,有上限还要防止越修越差 |
| 类型别名 | `Script = list[tuple[str, bool, float]]`,给一个复杂类型起个名字,相当于 TS 的 `type` |

本周其他名词都在各天的表里:WebMCP、`modelContext`、命令式与声明式工具(Day 609);VAD、TTFT、级联与端到端(Day 610);打断、附和、过渡语、P95(Day 611);研究提纲、主管、研究员、压缩(Day 612);规则层核验、假引用、逐句评审、事实句与分析句(Day 613);A2A、不透明、任务状态、终态、ACP、AAIF(Day 614)。

## 常见误区

**以为检查脚本 0 处不一致就说明代码没 bug。** 今天默写二 0 处不一致,可原版本身就有重复派活的 bug。检查脚本只证明默写和原版一样。

**以为重写一定会变好。** 今天四次跑小项目,有两次重写后问题从 1 处变 7 处、从 3 处变 12 处。重写要有上限,而且要保留问题最少的那一版。

**判了 input-required 却不附全文。** 第三次跑时我没存报告,12 处问题到底是怎么来的只能猜。交给人的东西要完整:全文、问题清单、花费。

**写报告的规则和核验的规则各写各的。** 一边要求「缺口节不加引用」,一边要求「有数字就得有引用」,两边打架,修复越修越错。两套规则要放在一起看。

**复习日只看不敲。** 默写一里漏掉「挪回上一句」那 4 行,2000 份里 1424 份结果不同。只读文章时觉得这 4 行无关紧要,自己默写一遍才知道它有多重要。

## 学习资料

### 文档与文章

- [Anthropic:How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system):复习「Production reliability and engineering challenges」一节,对照今天的交付闸门和修复上限,20 分钟。英文。
- [A2A 规范(latest)](https://a2a-protocol.org/latest/specification/):找到任务状态的定义,对照默写二的 `TERMINAL`,看看规范里还有哪些状态是我们的模拟没有的,15 分钟。英文。
- [Python 文档:asyncio.create_task](https://docs.python.org/3/library/asyncio-task.html#asyncio.create_task):读那段「Important: Save a reference to the result of this function」的提醒,对照默写二里 `_running` 那一行,5 分钟。英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1RyZZY3E7n&autoplay=0&high_quality=1" title="[Agent][01] 练习两天半，从零开始实现Deep Research（DeepSeek自动生成带插图的markdown报告），原理讲解到代码实现" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>偷星九月333 · [Agent][01] 练习两天半,从零开始实现 Deep Research · 35 分钟,用 DeepSeek 从零写一个。复习日看它正合适:对照你这一周写的 research.py 和今天的交付闸门,看他的实现在哪些地方没做核验。</figcaption>
</figure>

- 技术蛋老师《Function Calling、MCP 和 A2A 的核心原理与区别》:[BV1XFhPzoEBx](https://www.bilibili.com/video/BV1XFhPzoEBx/),Day 614 看过,没看完的今天补上。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/ks4M8b9Ul6E" title="Stop using MCP for everything! (RAG vs. A2A vs. Sub-agents)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Google Cloud Tech · Stop using MCP for everything! (RAG vs. A2A vs. Sub-agents) · Google 官方频道讲什么时候用 RAG、什么时候用 A2A、什么时候用子 Agent,正好对照 Day 614 的 which_protocol 和本周 Deep Research 的取舍。英文。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 4 章「Evaluate AI Systems」里讲评测流水线怎么设计,复习时对照今天的交付闸门,想一想规则层、模型评审、人工抽查在你的系统里各放在哪,1 小时。英文原版。

### 开源项目与代码

- [langchain-ai/open_deep_research](https://github.com/langchain-ai/open_deep_research):复习时再读一遍 `supervisor_tools` 里超额任务回错误信息那段,和今天「越修越差就停」比一比:两个都是给循环加硬约束,20 分钟。

## 自测

**1. 本周四个话题(WebMCP、语音、Deep Research、Agent 互联)有什么共同点?**

<details><summary>答案</summary>

都是 Agent 和外面的东西接:网页、声音、别人的 Agent,以及一份要交给人的长报告。共同的做法是对外面来的东西不全信,自己这边用程序写死检查:WebMCP 后端全量校验、语音按播放进度截断历史、研究报告过引用核验、任务到了终态就拒收。模型负责想,程序负责拦。

</details>

**2. 默写一里,如果漏掉「以引用开头的句子把引用挪回上一句」那几行,会出什么错?**

<details><summary>答案</summary>

句号后面的引用会被算到下一句头上,一错错两句:上一句变成「有数字没引用」,下一句白捡了不属于它的引用,数字拿去错误的资料里找,变成「数字对不上」。检查脚本 2000 份里 1424 份结果不同。DeepSeek 写报告时确实会把引用放在句号后面,所以这几行不是可有可无的。

</details>

**3. `check_agent.py` 输出 0 处不一致,能不能说明 Day 614 的 `FinanceAgent` 没有 bug?**

<details><summary>答案</summary>

不能。它只证明默写版和原版行为一致。原版在 working 时收到消息会再派一份对账,默写版也一样,所以检查脚本发现不了。要发现这类 bug,要针对需求写测试,比如练习 1 的「发三条消息后台只能有一份对账」。

</details>

**4. 交付闸门第一次跑时,重写后问题从 1 处变成 7 处,原因是什么?你从中学到了什么?**

<details><summary>答案</summary>

重写时要求「资料缺口单独成节、不加引用」,模型照做了,写成了「1. ……14 天……」这样的编号列表,列表编号和 14 都没引用,核验器报了「有数字没引用」。写报告的规则和核验规则打架。学到的:两套规则要放在一起设计;为消除误报跳过某一块时,要给这一块定单独的规则(否则留下盲区,第二次跑就是这样);修复要有上限,越修越差要停下来保留更好的那版。

</details>

**5. 面试题:你们的研究 Agent 要上线,产品经理问「怎么保证发给客户的报告没有编造」。你怎么答?**

<details><summary>答案</summary>

先说实话:保证不了百分之百,能做的是让不合格的报告发不出去,并且把剩下的风险降到可控。具体做三层:规则层每份都跑,查假引用、引用没读过的资料、数字在被引资料里找不到、有数字没引用,零成本、结果确定;模型逐句评审,抽样或者对规则层有疑点的报告跑,抓意思说反这类规则层看不到的错,事实句和分析句分开评;人工每周抽查,找漏掉的方向和来源偏差,发现的问题加进评测集。交付时过一道闸门:不通过就带着问题清单重写,最多修两次,越修越差就停,保留问题最少的那版,状态标成需要人工处理,附全文和问题清单。上线前用固定的评测集(先 20 条起步)测闸门的误报和漏报,上线后盯着「需要人工处理」的比例和人工复核发现的问题。

</details>

## 明天预告

[Day 616](/blog/agent-zero/day-616-a2a-2/) 讲 Agent 互联(二):五个核心对象、传输绑定、身份与信任。Day 614 只用本地模拟感受了任务状态,状态的确切名字和规范细节都留到了明天;明天读 A2A 1.0 规范里的 Agent Card、Task、Message、Artifact、Part,看三种传输绑定和版本协商,用官方 `a2a-sdk` 跑通一个真的 A2A 服务,再讲对面的 Agent 凭什么可信。
