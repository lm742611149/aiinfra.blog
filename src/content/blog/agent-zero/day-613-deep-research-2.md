---
title: 'Day 613 · Deep Research(二):其他实现、工程复盘数字、评测和成本'
description: '昨天的研究报告冒出了假引用。今天先看 GPT Researcher 和 STORM 两种别的做法,读 Anthropic 多 Agent 研究系统复盘里最该记住的几个数字,然后给研究报告搭三层评测:先写一个不调模型的引用核验器(第一版报了 26 处问题,22 处是它自己的误报),再用模型逐句评审,看它抓到规则层漏掉的「把不退说成按比例退」;最后算清一次研究的钱花在哪,做预算上限和按复杂度分配。'
pubDate: 2026-10-22
regime: none
tags: ['deep-research', 'evaluation', 'llm-judge', 'cost', 'agent-zero']
series: 'agent-zero'
day: 613
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 612](/blog/agent-zero/day-612-deep-research-1/) 用一个跨三个主题的问题让 RAG 露了馅:检索一次只读到 8 篇里的 3 篇,最核心的退款政策没读到,回答却每句都有出处,看着挺完整。然后读了 open_deep_research 的图结构,自己写了一条「提纲 → 并行研究 → 写报告」的最小流水线,8 篇读到 7 篇。

昨天结尾留了两个尾巴:报告里出现了 `[资料中未找到]` 这种长得像引用的假引用,还有「资料中未找到」后面却挂着两个真引用的句子。报告越长,这种问题越难靠肉眼找。今天就来回答两个问题:**一份研究报告怎么评**,以及**一次研究的钱怎么控**。

## 今天要解决的问题

学完今天你应该能:

1. 说出 GPT Researcher、STORM 和 open_deep_research 三种做法各自的重点,以及 Anthropic 复盘里「token 用量解释 80% 差异」「多 Agent 用 15 倍 token」这两个数字在设计上意味着什么。
2. 写出一个不调模型的引用核验器 `verify.py`,能抓假引用、引用没读过的资料、数字对不上、有数字没引用四类问题,并说清它抓不到什么。
3. 写出一个逐句的模型评审 `judge.py`,只判「支持 / 不支持」,用它抓到规则层漏掉的错误,并看懂它为什么会把分析句判成不支持。
4. 写出一次研究的成本算式,给流水线加一个总花费上限,并按问题复杂度决定拆几个子问题。

今天两个新概念:**研究报告的三层评测**(规则、模型评审、人工抽查)和**研究成本的控制**。用到的旧东西:正则(`re` 模块,前面用过多次;今天会多用「不捕获组」和「后行断言」两个写法,遇到时单独讲)、LLM 当裁判([Day 355](/blog/agent-zero/day-355-llm-judge-1/) 起)、`asyncio.to_thread` 和信号量(Day 612)、JSON mode([Day 148](/blog/agent-zero/day-148-structured-2/))。

预计用时 3 小时。前置:Day 612 的 `part10/research/` 下 `make_kb.py`、`local_search.py`、`research.py`(修过主管提示词的那一版)都能跑。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `verify.py` 里的 `split_sentences` 和 `verify` 两个函数默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 另外两个值得看的实现

昨天读的 open_deep_research 是「主管 + 研究员 + 最后一次写完」的结构。这不是唯一的做法,再看两个,能帮你分清哪些是这类系统的共性,哪些只是某一家的选择。

**GPT Researcher**(`assafelovic/gpt-researcher`,2026 年 10 月查 GitHub 有 3 万多星,PyPI 最新 0.16.1,9 月 26 日发布)是比较早的开源项目,有两种模式。单 Agent 模式的能力拆在 `gpt_researcher/skills/` 下,我列了一下当前的文件:`researcher.py`(查资料)、`curator.py`(挑来源)、`writer.py`(写报告)、`deep_research.py`(深度模式,递归地往下追问)、`context_manager.py`、`browser.py` 等。多 Agent 模式在 `multi_agents/agents/` 下,像一个编辑部:`editor.py` 定提纲,`researcher.py` 查资料,`reviewer.py` 和 `reviser.py` 审稿改稿,`fact_checker.py` 核事实,`publisher.py` 出版,还有 `human.py` 让人插进来审提纲。

这种角色化设计很好懂,读文件名就知道流程。代价是角色越多,协调的轮次和 token 越多。我的看法是:编辑部模式适合「报告格式固定、要人审」的场景(比如每周行业简报);问题千变万化的研究,open_deep_research 那种简单结构更省心。

**STORM**(斯坦福,论文 [arXiv 2402.14207](https://arxiv.org/abs/2402.14207),NAACL 2024)关心的是写长文之前的准备阶段。它的流水线分三步:先找出这个主题可以从哪些视角看(一个历史学者、一个工程师、一个政策研究者);再让每个视角的「作者」去向一个基于检索的「专家」连续提问,模拟一场采访;最后把这些对话整理成提纲,才开始写。源码里这几步对应 `knowledge_storm/storm_wiki/modules/` 下的 `persona_generator.py`、`knowledge_curation.py`、`outline_generation.py`、`article_generation.py`。

论文里拿它和「按提纲检索再写」的基线比,有经验的维基百科编辑认为 STORM 写的文章「组织得好」的比例高了 25 个百分点,「覆盖面广」的比例高了 10 个百分点。它说明的道理和昨天练习 1 碰到的一样:**提纲决定了报告能覆盖到哪**。昨天主管想不到「降级差价」这个方向,`kb-plan` 就怎么也读不到;STORM 让不同视角各问各的,本质上就是在提纲阶段逼自己多想几个方向。

还有一件 2026 年的事要知道:我今天查 GitHub,`langchain-ai/open_deep_research` 仓库已经被标成 archived(只读,不再接受改动),最后一次提交还是 8 月 10 日 Day 612 读的那个 `1b7d2e80`。代码照样能读,架构照样是最清楚的教材,但别把它当成会持续更新的依赖。LangChain 作者 Lance Martin 写过一篇[博客](https://rlancemartin.github.io/2025/07/30/bitter_lesson/),讲这个项目从早期版本演进到现在的结构,读完能理解为什么最后定成这样。

| | open_deep_research | GPT Researcher 多 Agent | STORM |
| --- | --- | --- | --- |
| 核心想法 | 主管派研究员,各自压缩,最后一次写完 | 编辑部分工:定提纲、查、审、改、核事实、出版 | 多视角提问生成提纲,再写 |
| 并行在哪 | 研究员之间 | 各章节的研究 | 不同视角的采访 |
| 提纲谁定 | 主管写 research brief | editor | 多视角对话整理出来 |
| 适合 | 问题多变的研究 | 格式固定、要人审的报告 | 百科式长文 |
| 2026-10 状态 | 仓库 archived | 活跃,0.16.1 | 最后提交 2025-09,PyPI `knowledge-storm` 1.1.1 |

三家的共性其实就两条:**先有提纲再查**,**查到的东西压缩后再写**。差别都在「提纲怎么来」和「谁来把关」上。

## Anthropic 复盘里最该记住的数字

Anthropic 在 2025 年 6 月 13 日发过一篇复盘 [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system),讲 Claude 的 Research 功能怎么做的。昨天只看了架构,今天看数字。下面每一条我都回原文核对过:

- 主 Agent 用 Claude Opus 4、子 Agent 用 Claude Sonnet 4 的多 Agent 系统,在他们内部的研究评测上比单 Agent 的 Claude Opus 4 **好 90.2%**。
- 在 BrowseComp(测浏览 Agent 找难找信息能力的评测集)上,三个因素解释了 95% 的效果差异:token 用量、工具调用次数、模型选择。其中 **token 用量一项就解释了 80%**。
- 代价:Agent 一般比普通聊天多用约 **4 倍** token,多 Agent 系统多用约 **15 倍**。
- 按复杂度分配力气的规则直接写在提示词里:简单的查事实,1 个 Agent、3 到 10 次工具调用;直接比较,2 到 4 个子 Agent、每个 10 到 15 次调用;复杂研究可以超过 10 个子 Agent。
- 两种并行(主 Agent 同时派 3 到 5 个子 Agent,子 Agent 同时调 3 个以上工具)让复杂查询的研究时间**缩短了最多 90%**。
- 人工测试发现,早期的 Agent 总是挑 SEO 优化过的内容农场,而不是排名靠后但更权威的学术 PDF 或个人博客。后来在提示词里加了判断来源质量的规则才好转。
- 评测一开始只用了**大约 20 条**来自真实使用的问题。改动早期效果差别很大,20 条足够看出方向。
- 发版用**彩虹部署**(rainbow deployment):新旧版本同时跑,流量一点点切过去,不打断正在跑的长任务。

这几个数字放在一起读,意思很直接:多 Agent 之所以效果好,很大程度上是因为它能把更多 token 花在问题上,而花更多 token 就是花更多钱。所以「要不要上多 Agent」本质上是一道经济题:**任务值不值 15 倍的钱**。Day 612 我们实测的是 6 倍多(RAG ¥0.0031,流水线 ¥0.0204),量级是对得上的。

「大约 20 条」这个数字也值得记住。很多人觉得评测集要几百上千条才算数,结果迟迟不开始评。早期你改一次提示词,效果可能从 30% 跳到 80%,这种差别 20 条就看得出来;等系统成熟了、改动带来的差别变小了,才需要更大的集合,这时再回头按 [Day 348](/blog/agent-zero/day-348-testcase-structure/) 的格式把用例补齐。

最后一条彩虹部署,和 [Day 535](/blog/agent-zero/day-535-durable-1/) 起讲的持久化执行是同一个问题:任务跑二十分钟,你发版时它还在跑,不能一刀切掉。

## 怎么评测一份研究报告

一份研究报告可能有几千字、几十个引用。评它要回答好几个不同的问题:事实对不对、引用对不对、该覆盖的覆盖了没有、用的来源靠不靠谱、为这份报告花的力气合不合理。

Anthropic 的做法是用模型当评审(LLM-as-judge,[Day 355](/blog/agent-zero/day-355-llm-judge-1/) 学过),评分表(rubric)五项:**事实准确**(结论和来源对得上吗)、**引用准确**(引用的来源真的支持这句话吗)、**完整性**(问题的各个方面都覆盖了吗)、**来源质量**(一手资料还是二手转述)、**工具效率**(工具用得合不合理、次数多不多)。他们试过好几种评审方式,最后效果最好的是一次调用、一个提示词,给出 0.0 到 1.0 的分数加一个通过 / 不通过的结论。

学术界有专门的基准。**DeepResearch Bench**([arXiv 2506.11763](https://arxiv.org/abs/2506.11763),2025 年 6 月)请各领域专家出了 100 个博士水平的研究任务,覆盖 22 个领域,配了两套评测方法:RACE 拿参考报告和按任务生成的评分标准给报告质量打分;FACT 专门评引用,看有效引用有多少条、引用准确率多高。它的仓库到 2026 年还在更新,9 月刚换过评审模型。README 里有一个很说明问题的数字:在他们人工标注的子集上,**两个人类标注员之间的一致率只有 68.78%**。连人都只有七成一致,你就知道「报告写得好不好」有多难评,也知道为什么不能只靠一个总分。

对你自己的系统,我建议分三层,越往下越贵,也越能抓到细的错:

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="研究报告的三层评测:规则层最便宜最确定,抓假引用和编数字;模型评审层逐句判断支持与否;人工抽查最贵,找前两层漏掉的问题">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
  <rect x="24" y="24" width="240" height="56" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="144" y="46" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">规则层 verify.py</text>
  <text x="144" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">¥0,每次结果一样,每份都跑</text>
  <rect x="24" y="98" width="240" height="56" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="144" y="120" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">模型评审 judge.py</text>
  <text x="144" y="140" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">每句一次调用,约 ¥0.0006/句</text>
  <rect x="24" y="172" width="240" height="56" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="144" y="194" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">人工抽查</text>
  <text x="144" y="214" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">每周抽几份,领域专家看</text>
  <line x1="264" y1="52" x2="300" y2="52" stroke="var(--rule)"/>
  <line x1="264" y1="126" x2="300" y2="126" stroke="var(--rule)"/>
  <line x1="264" y1="200" x2="300" y2="200" stroke="var(--rule)"/>
  <text x="306" y="46" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">抓:假引用、没读过的引用、</text>
  <text x="306" y="62" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">数字对不上、有数字没引用</text>
  <text x="306" y="120" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">抓:意思说反、资料没说的、</text>
  <text x="306" y="136" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">没有数字的编造</text>
  <text x="306" y="194" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">抓:漏掉的方向、来源偏差、</text>
  <text x="306" y="210" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">分析站不站得住</text>
  <text x="520" y="52" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">便宜</text>
  <line x1="530" y1="60" x2="530" y2="196" stroke="var(--rule)" stroke-dasharray="4 3"/>
  <text x="520" y="214" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">贵、细</text>
</svg>
<figcaption>三层评测。规则层每份报告都跑,零成本;模型评审逐句判断;人工抽查找前两层都看不出来的问题。下面的实测数字来自今天的 run1。</figcaption>
</figure>

下面一层一层做。

## 第 1 步:先把一次运行存下来

Day 612 的 `research.py` 只把报告打印到屏幕上。要评测,得先把每次运行的全部东西存成文件:提纲、每个研究员的笔记和读了哪几篇、报告、花费。以后改了提示词再跑一次,两份文件放在一起就能比。

```bash
cd agent-zero-lab
mkdir -p part10/research/runs
```

```python
# agent-zero-lab/part10/research/save_run.py
"""跑一次 Day 612 的研究流水线,把提纲、笔记、报告和花费存成 JSON,后面的核验和评审都读这个文件。"""
import asyncio
import json
import sys
from dataclasses import asdict
from pathlib import Path

from common.llm import LLMClient
from part10.research.local_search import LocalSearch
from part10.research.research import Budget, plan, research_all, write

HERE = Path(__file__).parent
QUESTION = "整理云簿关于退款、发票和账户注销的规则,指出其中容易让客户误解的地方。"


def save_run(out: Path, q: str = QUESTION) -> None:
    budget, llm = Budget(), LLMClient()
    search = LocalSearch(HERE / "kb")
    brief, subqs = plan(q, llm, budget)
    notes = asyncio.run(research_all(subqs, llm, search, budget))
    report = write(brief, notes, llm)
    data = {
        "question": q,
        "brief": brief,
        "notes": [asdict(n) for n in notes],
        "report": report,
        "ledger": asdict(llm.ledger),
    }
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"存到 {out.relative_to(HERE.parent.parent)}:{len(notes)} 条笔记,报告 {len(report)} 字,{llm.ledger}")


if __name__ == "__main__":
    name = sys.argv[1] if len(sys.argv) > 1 else "run1"
    save_run(HERE / "runs" / f"{name}.json")
```

<div class="line-notes">

- `from dataclasses import asdict` `asdict` 把 dataclass 实例变成普通字典,字典才能被 `json.dumps` 序列化。相当于 JS 里把一个 class 实例展开成 `{...obj}`。
- `from part10.research.research import Budget, plan, research_all, write` 直接复用 Day 612 的四个零件,一行流水线代码都不重写。
- `HERE = Path(__file__).parent` 就是 `part10/research/`,kb 和 runs 都在它下面。
- `def save_run(out: Path, q: str = QUESTION) -> None:` 把「跑一次」包成函数,练习里会换问题再调用。
- `"notes": [asdict(n) for n in notes],` 每条 `Note` 变成 `{"subquestion": ..., "text": ..., "source_ids": [...], "seconds": ...}`。`source_ids` 是后面核验「引用的是不是研究员真读过的资料」的依据。
- `"ledger": asdict(llm.ledger),` 账本也存下来:调用次数、token、花费。评测不只评质量,也评花了多少。
- `out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")` `ensure_ascii=False` 让中文原样写进文件,不变成 `退` 这种转义;`indent=2` 方便人读。
- `name = sys.argv[1] if len(sys.argv) > 1 else "run1"` 命令行第一个参数当文件名,不给就叫 `run1`。`sys.argv` 相当于 Node 的 `process.argv.slice(1)`。

</div>

```bash
uv run python -m part10.research.save_run run1
```

```text
存到 part10/research/runs/run1.json:4 条笔记,报告 2435 字,6 次调用 | 输入 2371 / 输出 2451 tokens | 约 ¥0.0244
```

打开 `runs/run1.json` 看一眼。这次主管拆了 4 个子问题,第 4 个是「云簿的用户协议、帮助中心或公告中,围绕退款、发票、账户注销存在哪些容易被客户误解的表述」。昨天明明在提示词里写了「分析类不要拆成子问题」,它这次还是拆了一个半分析的出来,模型不会每次都听话。研究员合起来读了 6 篇,`kb-coupon` 和 `kb-plan` 都没读到。你那次跑出来的内容会不一样,这正是要把运行存下来的原因:**评测要对着一份固定的文件做,不能对着屏幕上一闪而过的输出**。

报告有 2,435 字,我截两段有代表性的:

```text
### 3.1 可开票类型

现有资料中仅提及"电子发票"，未提及其他发票类型 [id=kb-invoice]。
...
### 2.3 资料缺口

关于退款申请的具体条件、不予退款的具体情形，现有资料中未找到 [资料中未找到]。
```

注意第一段的引用写成了 `[id=kb-invoice]`,比提示词要求的 `[kb-invoice]` 多了 `id=`。第二段又是昨天那种假引用。

## 第 2 步:规则层,一个不调模型的引用核验器

规则层回答四个问题,每个都能用代码确定地判断:

1. **假引用**:方括号里的 id 在资料库里根本不存在,比如 `[资料中未找到]`。
2. **引用没读过的资料**:id 存在,但没有任何研究员读过它。模型不可能从没读过的资料里得出结论,这说明它在凭印象补。
3. **数字对不上**:句子里的数字,在它引用的那几篇资料里找不到。编数字是最常见、后果最重的错。
4. **有数字没引用**:带数字的句子没挂引用,读者没法核对。

先说切句子。报告是一段 markdown,要按句号、问号、叹号切开,一句一句查。这里有个坑昨天的输出里就有:有时候模型把引用写在句号**后面**,「当月不退。[kb-refund] 月付套餐……」,按句号一切,`[kb-refund]` 就跑到下一句的开头去了,上一句变成「没引用」,下一句白捡一个不属于它的引用。所以切完要检查:如果一句话以引用开头,把这串引用挪回上一句。

```python
# agent-zero-lab/part10/research/verify.py
"""规则层引用核验:不调模型,逐句检查引用和数字。便宜、确定、每次结果一样。"""
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

from part10.research.local_search import LocalSearch

HERE = Path(__file__).parent
CITE = re.compile(r"\[(?:id=)?([^\[\]]+)\]")
NUM = re.compile(r"\d+(?:\.\d+)?")


@dataclass
class Problem:
    kind: str
    sentence: str
    detail: str


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
            lead = re.match(r"^((?:\[[^\[\]]+\])+)\s*", s)
            if lead and out:
                out[-1] += lead.group(1)
                s = s[lead.end():]
            if s:
                out.append(s)
    return out


def verify(report: str, kb: dict[str, str], read_ids: set[str]) -> list[Problem]:
    problems: list[Problem] = []
    for s in split_sentences(report):
        ids = CITE.findall(s)
        nums = NUM.findall(CITE.sub("", s))
        if not ids:
            if nums:
                problems.append(Problem("有数字没引用", s, f"数字 {nums}"))
            continue
        fake = [i for i in ids if i not in kb]
        if fake:
            problems.append(Problem("假引用", s, f"不存在的来源 {fake}"))
        unread = [i for i in ids if i in kb and i not in read_ids]
        if unread:
            problems.append(Problem("引用没读过的资料", s, f"{unread} 不在任何研究员的笔记里"))
        corpus = " ".join(kb[i] for i in ids if i in kb)
        bad = [n for n in nums if n not in corpus]
        if corpus and bad:
            problems.append(Problem("数字对不上", s, f"{bad} 在被引用的资料里找不到"))
    return problems


def load(run_file: Path) -> tuple[str, dict[str, str], set[str]]:
    run = json.loads(run_file.read_text(encoding="utf-8"))
    kb = {d.id: d.text for d in LocalSearch(HERE / "kb").docs}
    read_ids = {i for n in run["notes"] for i in n["source_ids"]}
    return run["report"], kb, read_ids


if __name__ == "__main__":
    name = sys.argv[1] if len(sys.argv) > 1 else "run1"
    report, kb, read_ids = load(HERE / "runs" / f"{name}.json")
    sentences = split_sentences(report)
    problems = verify(report, kb, read_ids)
    cited = sum(1 for s in sentences if CITE.search(s))
    print(f"{len(sentences)} 句,带引用 {cited} 句,发现问题 {len(problems)} 处")
    for p in problems:
        print(f"[{p.kind}] {p.detail}\n    {p.sentence[:60]}")
```

<div class="line-notes">

- `CITE = re.compile(r"\[(?:id=)?([^\[\]]+)\]")` 匹配方括号引用。`[^\[\]]+` 是「一个或多个不是方括号的字符」,括号把它捕获出来当 id。`(?:id=)?` 是一个**不捕获**的可选组:有 `id=` 前缀就吃掉,捕获到的 id 里不带它。`[id=kb-invoice]` 和 `[kb-invoice]` 都得到 `kb-invoice`。这个组是第一版没有的,下面会演示没有它会怎样。
- `NUM = re.compile(r"\d+(?:\.\d+)?")` 整数或小数。「3到5个工作日」得到 `['3', '5']`。
- `class Problem:` 一条问题:哪一类、哪一句、细节。比返回一堆字典好读,类型检查也能帮你查拼写。
- `for line in report.splitlines():` 先按行切。markdown 的标题、列表项都是单独一行。
- `if not line or line.startswith("#"):` 空行和标题行跳过。标题「### 2.1 适用场景」里有 `2.1`,不跳过就会被当成「有数字没引用」,第一版就栽在这。
- `for s in re.split(r"(?<=[。！？!?])", line):` 按句末标点切。`(?<=...)` 是「后行断言」,意思是在这些字符的**后面**切,标点本身留在前一句里,不会被切掉。中英文的问号叹号都列上了。
- `lead = re.match(r"^((?:\[[^\[\]]+\])+)\s*", s)` 看这一句是不是以一串引用开头。`(?:...)+` 允许连着好几个,比如 `[kb-close][kb-export]`。
- `if lead and out:` 以引用开头,而且前面已经有句子,就把这串引用补回上一句。`out[-1]` 是列表最后一个元素,和 JS 的 `out.at(-1)` 一样。
- `s = s[lead.end():]` 把挪走的引用从这一句里切掉,剩下的才是这句自己的内容。
- `nums = NUM.findall(CITE.sub("", s))` 先把引用删掉再找数字,不然 `[kb-002]` 这种 id 里的数字会被当成正文数字。
- `if not ids:` 没有引用的句子只查一件事:有没有数字。没数字的普通句子(过渡句、标题下的导语)放过。
- `fake = [i for i in ids if i not in kb]` 不在资料库里的 id。run1 里抓到的全是 `资料中未找到`。
- `unread = [i for i in ids if i in kb and i not in read_ids]` 资料库里有、但研究员没读过的。写报告的模型只看笔记,它引用一篇没人读过的资料,只能是从训练数据里凭印象补的。
- `corpus = " ".join(kb[i] for i in ids if i in kb)` 把这句话引用的几篇资料拼在一起,数字要在这里面找得到。
- `bad = [n for n in nums if n not in corpus]` 这是**子串**判断,`"5" in "15 天"` 也算找到。所以它只能抓「资料里压根没出现过的数字」,抓不住「把 14 天写成 15 天、恰好 15 在别处出现过」的错。便宜的代价。
- `read_ids = {i for n in run["notes"] for i in n["source_ids"]}` 所有研究员读过的资料 id,用集合去重。
- `cited = sum(1 for s in sentences if CITE.search(s))` 数一下多少句带引用,让你对报告的「引用密度」有个数。

</div>

### 第一版的误报

上面是改过两处的版本。我第一版写的时候,`CITE` 没有 `(?:id=)?`,`split_sentences` 也没跳过标题行。拿它跑 run1,输出按问题类型数一下是这样的:

```text
53 句,带引用 24 句,发现问题 26 处
   1 [假引用] 不存在的来源 ['id=kb-duplicate']
   3 [假引用] 不存在的来源 ['id=kb-invoice']
   3 [假引用] 不存在的来源 ['id=kb-redflush']
   1 [假引用] 不存在的来源 ['资料中未找到', 'id=kb-invoice', '资料中未找到', '资料中未找到']
   3 [假引用] 不存在的来源 ['资料中未找到']
   1 [数字对不上] ['30'] 在被引用的资料里找不到
  14 [有数字没引用] 数字 ['2.1'] / ['2.2'] / … / ['5.3']
```

26 处里,14 处是标题里的小节编号,7 处是 `id=` 前缀导致的,还有 1 处「30 找不到」也是因为那句的 `[id=kb-redflush]` 没认出来,30 天红冲窗口明明就在 kb-redflush 里。真问题只有 4 处。

**核验器误报多,比没有核验器还糟**:看的人会很快学会忽略它,真问题就跟着被忽略了。所以每写一条规则,都要拿真实报告跑一遍,把误报一条条看过去。`id=` 这个前缀该算模型的错还是核验器的错?我的选择是核验器宽容一点(认出它),但如果你想让报告格式统一,可以另加一条「格式不规范」的警告,和「假引用」分开报,别混在一起。

改完再跑:

```bash
uv run python -m part10.research.verify run1
```

```text
32 句,带引用 24 句,发现问题 4 处
[假引用] 不存在的来源 ['资料中未找到']
    关于退款申请的具体条件、不予退款的具体情形，现有资料中未找到 [资料中未找到]。
[假引用] 不存在的来源 ['资料中未找到']
    关于账户恢复、重新注册、发票相关限制等其他注销后限制，资料中未找到 [资料中未找到]。
[假引用] 不存在的来源 ['资料中未找到']
    此外，笔记明确记载，关于发票开具流程、退款申请入口（除重复扣款外）、默认勾选、费用扣除规则的具体表述，资料中未找到 [资
[假引用] 不存在的来源 ['资料中未找到']
    综合各节，现有笔记中未覆盖的内容包括：退款申请条件与不予退款的具体情形 [资料中未找到]；发票类型中电子发票以外的其他类
```

剩下的 4 处都是真的:模型把「没找到」写成了引用的样子。修法不在核验器,在写报告的提示词:明确说「资料里没有的内容,单独放在『资料缺口』一节,不加引用」。数字这一项 run1 一处问题都没有,24 句带引用的句子里的数字全能在被引用的资料里找到。

### 它抓不到什么

规则层零成本、每次结果一样,但它的盲区很大。手写一份埋了 5 句的小报告看看:

```python
# agent-zero-lab/part10/research/verify_demo.py
"""手写一份埋了错的小报告,看规则层能抓到几个。"""
from pathlib import Path

from part10.research.local_search import LocalSearch
from part10.research.verify import verify

KB = {d.id: d.text for d in LocalSearch(Path(__file__).parent / "kb").docs}
READ = {"kb-refund", "kb-invoice", "kb-close"}  # 假设研究员只读了这三篇

REPORT = """年付套餐购买后 14 天内可全额退款 [kb-refund]。
电子发票在付款成功后 48 小时内开具 [kb-invoice]。
注销申请提交后有 15 天冷静期。
降级后差价不退,也不折算成余额 [kb-plan]。
月付套餐取消后,按未使用天数比例退款 [kb-refund]。"""

for p in verify(REPORT, KB, READ):
    print(f"[{p.kind}] {p.detail}  <- {p.sentence}")
```

<div class="line-notes">

- `READ = {"kb-refund", "kb-invoice", "kb-close"}` 假装研究员只读了这三篇,`kb-plan` 不在里面。
- `年付套餐购买后 14 天内可全额退款 [kb-refund]。` 第 1 句是对的,用来确认核验器不误报。
- `电子发票在付款成功后 48 小时内开具 [kb-invoice]。` 第 2 句编了数字,资料里是 24 小时。
- `注销申请提交后有 15 天冷静期。` 第 3 句内容对,但带数字没挂引用。
- `降级后差价不退,也不折算成余额 [kb-plan]。` 第 4 句内容对,但引用了一篇没人读过的资料。
- `月付套餐取消后,按未使用天数比例退款 [kb-refund]。` 第 5 句**意思说反了**:资料写的是月付不支持退款。句子里没有数字,引用的 id 也真实存在。

</div>

```bash
uv run python -m part10.research.verify_demo
```

```text
[数字对不上] ['48'] 在被引用的资料里找不到  <- 电子发票在付款成功后 48 小时内开具 [kb-invoice]。
[有数字没引用] 数字 ['15']  <- 注销申请提交后有 15 天冷静期。
[引用没读过的资料] ['kb-plan'] 不在任何研究员的笔记里  <- 降级后差价不退,也不折算成余额 [kb-plan]。
```

第 2、3、4 句抓到了,第 1 句没误报。第 5 句它看不出来:没有数字,引用存在,读过,一切「合规」,可意思完全反了。客户看到「月付按比例退款」去申请,客服说不退,这就是一次投诉。这种错只能靠理解意思才能发现,也就是第二层。

## 第 3 步:模型评审层,逐句判断支不支持

做法是 [Day 355](/blog/agent-zero/day-355-llm-judge-1/) 起学过的 LLM 当裁判,只是粒度改成**一句一次**:把这句话和它引用的那几篇资料交给模型,问「资料支不支持这句话」,只要「是」或「否」,外加一句理由。

为什么一句一次,而不是把整份报告扔进去问「有哪些错」?整份扔进去,模型要在两千多字里自己找,长了就会漏,而且每次漏的不一样;一句一次,每次只看几百字,判断又是二元的,稳定得多。代价是调用次数多,好在每次都很短。Anthropic 用的是 0.0 到 1.0 打分加通过 / 不通过;我们这里每句只要通过 / 不通过,统计时直接数「不支持」有几句,比平均分好解释。

```python
# agent-zero-lab/part10/research/judge.py
"""模型评审层:每个带引用的句子单独问一次「被引用的资料支不支持这句话」,只要是或否。"""
import asyncio
import json
import sys
from pathlib import Path

from common.llm import LLMClient
from part10.research.verify import CITE, load, split_sentences

HERE = Path(__file__).parent
JUDGE_PROMPT = """判断「句子」里的每个事实是否都能从「资料」中直接得到。资料没说的、和资料矛盾的、把资料说反了的,都算不支持。
只输出 JSON:{{"supported": true 或 false, "reason": "不超过 30 字"}}
资料:
{docs}
句子:{sentence}"""


def judge_one(sentence: str, kb: dict[str, str], llm: LLMClient) -> dict[str, object]:
    ids = [i for i in CITE.findall(sentence) if i in kb]
    docs = "\n\n".join(f'<doc id="{i}">\n{kb[i]}\n</doc>' for i in dict.fromkeys(ids))
    r = llm.chat([{"role": "user", "content": JUDGE_PROMPT.format(docs=docs, sentence=CITE.sub("", sentence))}],
                 response_format={"type": "json_object"}, temperature=0)
    try:
        data = json.loads(r.content)
        return {"supported": bool(data["supported"]), "reason": str(data.get("reason", ""))}
    except (json.JSONDecodeError, KeyError):
        return {"supported": False, "reason": "评审输出无法解析"}


async def judge_all(sentences: list[str], kb: dict[str, str], llm: LLMClient, limit: int = 4) -> list[dict[str, object]]:
    sem = asyncio.Semaphore(limit)

    async def guarded(s: str) -> dict[str, object]:
        async with sem:
            return await asyncio.to_thread(judge_one, s, kb, llm)

    return list(await asyncio.gather(*(guarded(s) for s in sentences)))


if __name__ == "__main__":
    name = sys.argv[1] if len(sys.argv) > 1 else "run1"
    report, kb, _ = load(HERE / "runs" / f"{name}.json")
    planted = ["月付套餐取消后,按未使用天数比例退款 [kb-refund]。",
               "冷静期内登录不影响注销进度 [kb-close]。"]
    todo = [s for s in split_sentences(report) if any(i in kb for i in CITE.findall(s))] + planted
    llm = LLMClient()
    results = asyncio.run(judge_all(todo, kb, llm))
    bad = [(s, r) for s, r in zip(todo, results) if not r["supported"]]
    print(f"评审 {len(todo)} 句(含埋的 {len(planted)} 句),不支持 {len(bad)} 句")
    for s, r in bad:
        print(f"  ✗ {s[:50]}\n    理由:{r['reason']}")
    print(llm.ledger)
```

<div class="line-notes">

- `from part10.research.verify import CITE, load, split_sentences` 切句子和读文件都复用规则层的,保证两层看到的是同一批句子。
- `JUDGE_PROMPT = """判断「句子」里的每个事实` 评审提示词把「不支持」的三种情况写明:资料没说的、矛盾的、说反了的。不写清楚,模型容易把「资料没说」判成支持,觉得「也不算错」。
- `{{"supported": true 或 false, "reason": "不超过 30 字"}}` 只要二元结论和一句理由。理由不是给程序用的,是给你复核时看的。
- `ids = [i for i in CITE.findall(sentence) if i in kb]` 只把真实存在的引用对应的资料交给评审。假引用已经被规则层抓过了。
- `for i in dict.fromkeys(ids)` 同一句里同一个 id 出现两次时去重,又保持原来的顺序。集合也能去重,但不保证顺序;`dict.fromkeys` 是 Python 里「保序去重」的惯用写法,相当于 JS 的 `[...new Set(ids)]`。
- `sentence=CITE.sub("", sentence)` 交给评审的句子去掉引用标记,免得它被 `[kb-close]` 这种字样干扰。
- `response_format={"type": "json_object"}, temperature=0)` JSON mode 加温度 0。[Day 112](/blog/agent-zero/day-112-sampling-2/) 讲过 DeepSeek 温度 0 也不保证每次一样,但能少一点抖动。
- `return {"supported": False, "reason": "评审输出无法解析"}` 评审自己出错时,按「不支持」算,让人去看。评测代码宁可多报,不能悄悄放过。
- `async def judge_all(` 和 Day 612 的 `research_all` 一个写法:信号量限并发,`to_thread` 把同步的 `chat` 丢到线程里。
- `planted = [` 在真实报告后面加两句埋的错:第 1 句是规则层漏掉的那句,第 2 句把「登录即撤销注销」说反。用来确认评审确实抓得到。
- `todo = [s for s in split_sentences(report) if any(i in kb for i in CITE.findall(s))] + planted` 只评有真实引用的句子;只挂了假引用的句子交给规则层处理就够了。
- `bad = [(s, r) for s, r in zip(todo, results) if not r["supported"]]` 句子和结果按位置配对,挑出不支持的。

</div>

```bash
uv run python -m part10.research.judge run1
```

```text
评审 23 句(含埋的 2 句),不支持 6 句
  ✗ ** 注销提交后有15天冷静期，冷静期内登录即视为撤销注销 [kb-close]，客户容易将"提交申
    理由:后半句客户容易误解为已完成，资料未提及
  ✗ ** 冷静期结束后数据永久删除、不能恢复，且冷静期结束前仍可导出全部账单数据（CSV，单次最多5万行
    理由:资料未提及客户可能误以为可随时取回数据
  ✗ 从表述层面看，以下设计值得关注：注销规则中"冷静期内登录即视为撤销注销" [kb-close]属于以
    理由:资料未涉及表述层面设计评价及客户预期冲突等分析
  ✗ 综合各节，现有笔记中未覆盖的内容包括：退款申请条件与不予退款的具体情形 [资料中未找到]；发票类型中
    理由:资料未涉及退款、账户注销、发票类型等笔记覆盖情况
  ✗ 月付套餐取消后,按未使用天数比例退款 [kb-refund]。
    理由:资料称月付套餐不支持退款，句子与之矛盾
  ✗ 冷静期内登录不影响注销进度 [kb-close]。
    理由:资料说冷静期内登录即视为撤销注销，句子说反了
23 次调用 | 输入 4880 / 输出 496 tokens | 约 ¥0.0130
```

最后两句是埋的,都抓到了,理由也说到点子上。规则层看不出的「说反了」,这一层能看出来。

前四句才是今天最值得想的。它们都不是事实错误,而是**分析句**:「客户容易将提交申请误解为注销已完成」「属于以行为默示撤销的机制」。资料当然不会写「客户容易误解」,评审按提示词的字面意思判了不支持,它没判错。可这些分析恰恰是用户要的东西(「指出容易误解的地方」),总不能因为评审不通过就删掉。

问题出在评分标准上:**事实句和分析句要用不同的尺子量**。事实句问「资料支不支持」;分析句该问的是「它依据的那条事实对不对,推理站不站得住」。实际做法有两种:让写报告的模型把分析放在单独的小节里,不挂引用,评审只评事实小节;或者给评审再加一个类别,输出 `fact_supported / fact_unsupported / analysis` 三选一,分析句另外抽给人看。Anthropic 那张评分表把「事实准确」和「完整性」分成两项,也是同一个意思:一份报告好不好,不是一个分数能说清的。

第一、二句开头的 `**` 是 markdown 的加粗符号,报告里写的是「**其一,……错觉。**」,句号在加粗里面,切句子时 `**` 就被留到了下一句开头。不影响判断,但如果你要把句子展示给人复核,最好先去掉 markdown 符号再切。

花费 ¥0.0130,是生成这份报告(¥0.0244)的一半多。**评测本身也要钱**,而且评审调用次数随报告长度线性增长。每份都跑规则层,模型评审可以抽样跑,或者只对规则层报了问题、或者用户反馈不好的报告跑。

第三层人工抽查,今天没有代码可写。它要找的是前两层原理上看不到的东西:这份报告漏掉了哪个方向(比如 run1 完全没提优惠券和降级),来源是不是偏向某一类,分析是不是牵强。每周抽几份给懂业务的人看,看出来的问题变成新的评测题,加进那 20 条里。

## 第 4 步:钱花在哪,怎么控

一次研究的成本可以拆成这样一个算式:

```text
成本 ≈ 主管调用次数 × 每次 token
     + 研究员数 × 每个研究员的工具调用次数 × 每次读入的 token
     + 写报告的输入 token(提纲 + 全部笔记)+ 写报告的输出 token
     (+ 评测的调用)
```

拿 run1 算一下:6 次调用,输入 2,371、输出 2,451 tokens。按 `.env` 里的价格(输入未命中缓存 ¥2 / 百万,输出 ¥8 / 百万),输入 2,371 × 2 / 1,000,000 ≈ ¥0.0047,输出 2,451 × 8 / 1,000,000 ≈ ¥0.0196,合计约 ¥0.024,和账本的 ¥0.0244 一致(缓存命中那一点差额忽略)。**今天八成的钱花在输出上**,也就是写报告和写笔记。

这是因为我们的资料很短,每篇几十个字。换成真实网页,情况完全反过来。粗算一下:5 个研究员,每人 10 次工具调用,每次读入一篇约 3,000 token 的网页,输入就是 5 × 10 × 3,000 = 150,000 tokens,按同样的价格是 ¥0.30,比整个 run1 贵十几倍,而且大头变成了输入。这就是 open_deep_research 要用小模型先总结网页、Anthropic 要按复杂度定子 Agent 数和调用次数的原因。

能用的控制手段有这么几个,前两个在代码里做,后面的在提示词和架构里做:

- **硬性的总花费上限**:到了就停止研究,用已有的笔记写报告,并在报告里写明「因预算限制,以下方面未研究」。宁可交一份明说有缺口的报告,也别悄悄超支。练习 2 做这个。
- **按复杂度分配**:简单问题 1 个子问题,复杂的 3 到 4 个,甚至干脆不走流水线,直接 RAG。练习 3 做这个。
- 读网页用小模型先总结,大模型只看总结。
- 同一个来源在一次任务里只抓一次、只总结一次,做个缓存。
- 评测分层:规则层全跑,模型评审抽样跑。

## 动手练习

**练习 1:抓「嘴上说没找到、身上挂着真引用」的句子。** Day 612 的报告里有一句「资料中未找到」后面挂着 `[kb-invoice][kb-redflush]`。规则层现在抓不到这种:引用是真的,读过,也没有数字。写一个函数 `gap_with_real_cite(report, kb)`,找出含「未找到 / 未覆盖 / 未提及」这类字眼、同时挂了真实引用的句子,在 run1 上跑一下,看结果全是真问题吗。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/research/ex613_gap.py
"""练习 1:嘴上说「没找到」、身上却挂着真引用的句子,单独标出来。"""
import re
from pathlib import Path

from part10.research.verify import CITE, load, split_sentences

GAP_WORDS = re.compile(r"未找到|未覆盖|未提及|没有提到|无相关")


def gap_with_real_cite(report: str, kb: dict[str, str]) -> list[tuple[str, list[str]]]:
    hits: list[tuple[str, list[str]]] = []
    for s in split_sentences(report):
        real = [i for i in CITE.findall(s) if i in kb]
        if real and GAP_WORDS.search(CITE.sub("", s)):
            hits.append((s, real))
    return hits


if __name__ == "__main__":
    report, kb, _ = load(Path(__file__).parent / "runs" / "run1.json")
    for s, ids in gap_with_real_cite(report, kb):
        print(f"{ids}  <- {s[:70]}")
```

<div class="line-notes">

- `GAP_WORDS = re.compile(r"未找到|未覆盖|未提及|没有提到|无相关")` 表示「资料里没有」的几种说法,`|` 是「或」。你可以按自己系统里模型的习惯往里加。
- `real = [i for i in CITE.findall(s) if i in kb]` 只看真实存在的引用。假引用已经由规则层管了。
- `if real and GAP_WORDS.search(CITE.sub("", s)):` 两个条件同时满足才算。先删掉引用再搜字眼,免得 `[资料中未找到]` 这个假引用本身就命中「未找到」。

</div>

```bash
uv run python -m part10.research.ex613_gap
```

```text
['kb-invoice']  <- 现有资料中仅提及"电子发票"，未提及其他发票类型 [id=kb-invoice]。
['kb-invoice']  <- 综合各节，现有笔记中未覆盖的内容包括：退款申请条件与不予退款的具体情形 [资料中未找到]；发票类型中电子发票以外的其他类型 [id=kb-i
```

抓到两句,但**只有第二句是真问题**。第二句是「资料缺口汇总」,本身在说没覆盖什么,挂 `kb-invoice` 不合适。第一句其实是对的:kb-invoice 确实只提到电子发票,引用它来证明「只提及电子发票」完全合理,「未提及其他类型」是从这篇资料得出的结论。

这就是关键词规则的典型局限:同一个「未提及」,可以是在说「资料缺口」,也可以是在准确描述某篇资料的内容。所以这条规则适合报成「警告」交给人看,不适合当成「错误」自动拦截。还有一个改进方向:句子太长时(第二句一口气列了四个缺口,用分号隔开),先按分号再切一次,每一小段单独判断。

</details>

**练习 2:给研究加一个总花费上限。** 写 `run_with_cap(q, max_cost)`:子问题一个一个研究,每研究一个之前看一眼账本,超过上限就不再研究,把跳过的子问题告诉写报告的模型,让它在报告末尾写一节「未研究」。用 `max_cost=0.004` 跑一次,看总花费是不是真的在上限以内。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/research/ex613_cap.py
"""练习 2:给一次研究设总花费上限。超了就不再派研究员,报告里写明哪些子问题没研究。"""
import asyncio
from pathlib import Path

from common.llm import LLMClient
from part10.research.local_search import LocalSearch
from part10.research.research import Budget, Note, plan, research_all, write
from part10.research.save_run import QUESTION


def run_with_cap(q: str, max_cost: float) -> None:
    budget, llm = Budget(), LLMClient()
    search = LocalSearch(Path(__file__).parent / "kb")
    brief, subqs = plan(q, llm, budget)
    notes: list[Note] = []
    skipped: list[str] = []
    for sq in subqs:
        if llm.ledger.cost >= max_cost:
            skipped.append(sq)
            continue
        notes += asyncio.run(research_all([sq], llm, search, budget))
        print(f"  研究完「{sq[:14]}…」,累计 ¥{llm.ledger.cost:.4f}")
    if skipped:
        brief += "\n因预算上限,以下子问题没有研究,请在报告末尾单独列出「未研究」一节:" + ";".join(skipped)
    report = write(brief, notes, llm)
    print(f"上限 ¥{max_cost},研究了 {len(notes)} 个、跳过 {len(skipped)} 个;{llm.ledger}")
    print("报告最后 150 字:", report[-150:].replace("\n", " "))


if __name__ == "__main__":
    run_with_cap(QUESTION, max_cost=0.004)
```

<div class="line-notes">

- `from part10.research.save_run import QUESTION` 问题字符串复用第 1 步的,保证和 run1 是同一个问题。
- `for sq in subqs:` 为了能在中间停下,这里一个一个研究,不再一次全部并行。代价是慢,练习后面会讨论。
- `if llm.ledger.cost >= max_cost:` 每派一个研究员之前看账本。账本是 Day 136 `LLMClient` 自带的,每次调用后自动累加。
- `notes += asyncio.run(research_all([sq], llm, search, budget))` 只给 `research_all` 一个子问题,复用它而不是另写一个单个研究的函数。
- `brief += "\n因预算上限,以下子问题没有研究` 跳过的子问题写进提纲,写报告的模型才会知道,在报告里明说缺口。

</div>

```bash
uv run python -m part10.research.ex613_cap
```

```text
  研究完「云簿官方公布的退款规则是什么…」,累计 ¥0.0041
上限 ¥0.004,研究了 1 个、跳过 2 个;3 次调用 | 输入 890 / 输出 1772 tokens | 约 ¥0.0160
报告最后 150 字: 分析。  ## 七、未研究  受预算上限限制，以下子问题未进行研究，本报告未涵盖其内容：  1. 云簿的发票规则是什么（可开票类型、开具条件与时限、与退款/注销的关系）？ 2. 云簿的账户注销规则是什么（申请条件、注销流程、注销后数据与费用的处理）？  上述两项的结论有待后续补充研究后纳入最终报告。
```

缺口写明了,「未研究」一节列得清清楚楚,这一半做对了。可是**上限 ¥0.004,实际花了 ¥0.0160,超了 4 倍**。

原因有两个。第一,检查是在「派活之前」做的,派第一个研究员时账本里只有规划那一次的钱,没到上限,放行;它研究完,账本到了 ¥0.0041,已经越线。第二,也是大头:**写报告那一步根本不受上限管**。全程 ¥0.0160 减去研究阶段结束时的 ¥0.0041,写报告这一次就花了约 ¥0.012,占全程的四分之三。

正确的做法是**给写报告预留预算**:开跑前估一下写报告要多少(比如按历史运行取平均,run1 的写报告大约 ¥0.012 到 ¥0.017),研究阶段的上限 = 总上限 − 预留;同时给写报告的调用设 `max_tokens`,让它的花费有一个硬顶。另外,一个一个研究丢掉了并行,实际系统里更常见的是「一批一批派」:每批并行跑,批与批之间检查账本。

</details>

**练习 3:按复杂度分配。** 在 `plan()` 之前加一步,让模型把问题分成 simple、compare、complex 三档,分别最多拆 1、3、4 个子问题。用一个简单问题和 run1 的大问题各跑一次,比较调用次数和花费。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/research/ex613_route.py
"""练习 3:先判断问题复杂度,再决定拆几个子问题。简单题别上整条流水线。"""
import asyncio
import json
from pathlib import Path

from common.llm import LLMClient
from part10.research.local_search import LocalSearch
from part10.research.research import Budget, plan, research_all, write
from part10.research.save_run import QUESTION

LEVEL_PROMPT = """判断这个问题的复杂度,只输出 JSON:{{"level": "simple" 或 "compare" 或 "complex"}}
simple:一两篇资料就能回答的单个事实;compare:比较两三样东西;complex:跨多个主题、要归纳分析。
问题:{q}"""
SUBQS_BY_LEVEL = {"simple": 1, "compare": 3, "complex": 4}


def routed(q: str) -> None:
    llm = LLMClient()
    r = llm.chat([{"role": "user", "content": LEVEL_PROMPT.format(q=q)}],
                 response_format={"type": "json_object"}, temperature=0)
    level = json.loads(r.content).get("level", "complex")
    budget = Budget(max_subquestions=SUBQS_BY_LEVEL.get(level, 4))
    search = LocalSearch(Path(__file__).parent / "kb")
    brief, subqs = plan(q, llm, budget)
    notes = asyncio.run(research_all(subqs, llm, search, budget))
    report = write(brief, notes, llm)
    print(f"{q[:16]}… -> {level},子问题 {len(subqs)} 个,报告 {len(report)} 字,{llm.ledger}")


if __name__ == "__main__":
    routed("年付套餐买了 20 天还能退款吗?")
    routed(QUESTION)
```

<div class="line-notes">

- `LEVEL_PROMPT = """判断这个问题的复杂度` 三档的定义照搬 Anthropic 提示词里的思路:查事实、直接比较、复杂研究。
- `SUBQS_BY_LEVEL = {"simple": 1, "compare": 3, "complex": 4}` 每档最多拆几个。数字是我按 8 篇资料的规模定的,真实系统要按评测结果调。
- `level = json.loads(r.content).get("level", "complex")` 模型没给 `level` 时按最复杂的算。拿不准时宁可多花一点,也别把复杂问题当简单的答漏了。
- `budget = Budget(max_subquestions=SUBQS_BY_LEVEL.get(level, 4))` 模型给了一个不在表里的值(比如 "medium")时,`.get` 的默认值 4 兜底。
- `routed("年付套餐买了 20 天还能退款吗?")` 简单问题:答案就在 kb-refund 一篇里,超过 14 天按剩余整月退。

</div>

```bash
uv run python -m part10.research.ex613_route
```

```text
年付套餐买了 20 天还能退款吗… -> simple,子问题 1 个,报告 801 字,4 次调用 | 输入 725 / 输出 652 tokens | 约 ¥0.0067
整理云簿关于退款、发票和账户注销… -> complex,子问题 3 个,报告 2583 字,6 次调用 | 输入 1735 / 输出 2180 tokens | 约 ¥0.0209
```

分档起作用了:简单问题 4 次调用、¥0.0067,复杂问题 6 次、¥0.0209,差了 3 倍。复杂那档允许 4 个,主管这次只拆了 3 个,上限是上限,不是必须用满。

但简单问题还是走完了「判断、规划、研究、写报告」四步,写出一份 801 字的报告。用户问的是「20 天还能退吗」,一句话就够了。更好的设计是 simple 档**直接走 RAG**:检索一次、答一次,和 Day 612 的 `rag_once.py` 一样,1 次调用,大约 ¥0.003。分档的意义不只是「少拆几个子问题」,而是「不同档走不同的流程」。

</details>

**验收标准**:`save_run.py` 存出 `runs/run1.json`;`verify.py` 在你自己的 run1 上没有标题编号、`id=` 前缀这类误报,你能说出剩下每一条是不是真问题;`verify_demo.py` 的 5 句里规则层抓到 3 句,你能说清第 5 句为什么抓不到;`judge.py` 抓到埋的两句,你能说清为什么分析句会被判不支持、该怎么改评分标准;练习 2 跑完能说出上限为什么没守住。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 规则层核验 | 不调模型,用代码确定地检查报告:引用存不存在、数字在不在被引资料里。零成本,每次结果一样 |
| 假引用 | 长得像引用、实际指向不存在的来源,比如 `[资料中未找到]` |
| 误报(false positive) | 核验器把没问题的地方报成问题。今天第一版的 26 处里有 22 处是误报 |
| 逐句评审 | 每个带引用的句子单独调一次模型,判断被引资料支不支持这句话 |
| 事实句 / 分析句 | 事实句复述资料里的内容,能用资料直接核对;分析句是基于事实的判断(「客户容易误解」),要另用一把尺子 |
| 评分表(rubric) | 评审时逐项打分的标准。Anthropic 的是事实准确、引用准确、完整性、来源质量、工具效率五项 |
| DeepResearch Bench | 100 个博士水平研究任务、22 个领域的 Deep Research 评测基准,用 RACE 评报告质量、FACT 评引用 |
| BrowseComp | 测浏览 Agent 找难找信息能力的评测集 |
| STORM | 斯坦福的长文写作系统,用多视角模拟提问来生成提纲 |
| 彩虹部署(rainbow deployment) | 新旧版本同时运行、流量逐步切换,不打断正在跑的长任务 |
| 后行断言 `(?<=...)` | 正则里「这个位置的前面必须是……」,用来在标点后面切句子而不吃掉标点 |

## 常见误区

**有引用就以为可信。** 今天 run1 有 24 句带引用,规则层查下来数字全对,看着很干净;埋一句「月付按比例退款 [kb-refund]」进去,规则层照样放行。引用存在、读过、数字对,都不等于这句话对。

**核验器写完不看误报。** 第一版 26 处问题里 22 处是误报(标题编号、`id=` 前缀)。看的人很快就会学会忽略它。每条规则都要拿真实报告跑一遍,把误报一条条看完再上线。

**用同一把尺子量事实和分析。** 评审把「客户容易误解」这类分析句判成不支持,它没判错,是评分标准没分清。要么让分析单独成节不挂引用,要么让评审多一个「分析」类别交给人看。

**以为评测不花钱。** 23 句逐句评审花了 ¥0.0130,是生成报告的一半多。规则层全跑,模型评审抽样跑或按需跑。

**只给研究阶段设上限。** 练习 2 设了 ¥0.004 的上限,实际花了 ¥0.0160,因为写报告那一步不受管,而它占了全程的四分之三。上限要给写报告预留,写报告的调用本身也要有 `max_tokens`。

**评测集等攒够几百条再开始。** Anthropic 一开始只用了大约 20 条。早期改一次提示词差别很大,20 条就看得出方向。

## 学习资料

### 文档与文章

- [Anthropic:How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system):今天所有工程数字的出处。重点读「Effective evaluation of agents」和「Production reliability」两节,40 分钟。英文。
- [DeepResearch Bench(arXiv 2506.11763)](https://arxiv.org/abs/2506.11763):读第 3 节两套评测框架 RACE 和 FACT 的设计,40 分钟。英文。
- [STORM 论文(arXiv 2402.14207)](https://arxiv.org/abs/2402.14207):读第 3 节多视角提问怎么生成提纲,30 分钟。英文。
- [GPT Researcher 文档](https://docs.gptr.dev/):看单 Agent 和多 Agent 两种模式的说明,20 分钟。英文。
- [STORM 在线演示](https://storm.genie.stanford.edu/):输入一个主题,看它生成的视角、对话和提纲,15 分钟。
- [Lance Martin:Learning the Bitter Lesson](https://rlancemartin.github.io/2025/07/30/bitter_lesson/):open_deep_research 作者讲架构怎么一步步演进到现在的样子,20 分钟。英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1RdgU6sEf7&autoplay=0&high_quality=1" title="Deep Research怎么选？4个商业工具、3个开源项目和2个Skill实测" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Double6玩转Agent · Deep Research 怎么选?4 个商业工具、3 个开源项目和 2 个 Skill 实测 · 15 分钟。和今天「另外两个实现」那节对照看,留意他怎么比较各家报告的引用质量。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1mNSMBREqb&autoplay=0&high_quality=1" title="Claude（deep research）主agent提示词全景拆解" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>慢学AI · Claude(deep research)主 agent 提示词全景拆解 · 11 分钟。看 Anthropic 那套「按复杂度分配子 Agent 数」的规则在提示词里是怎么写的。</figcaption>
</figure>

- 偷星九月333《[Agent][01] 练习两天半,从零开始实现Deep Research》:[BV1RyZZY3E7n](https://www.bilibili.com/video/BV1RyZZY3E7n/),35 分钟,用 DeepSeek 从零写一个,适合和自己的 `research.py` 对照。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/0HljLKVdtjo" title="Anthropic: How to Build Multi Agent Systems" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Alejandro AO · Anthropic: How to Build Multi Agent Systems · 38 分钟,逐段讲 Anthropic 那篇复盘。英文原文读着吃力的话先看这个,重点听按复杂度分配和评测那两段。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 3 章「Evaluation Methodology」讲 AI 当裁判的做法和局限,第 4 章「Evaluate AI Systems」讲怎么设计评测流程,和今天的三层评测对照读,2 小时。英文原版。

### 开源项目与代码

- [assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher):读 `gpt_researcher/skills/curator.py`(怎么挑来源)和 `multi_agents/agents/fact_checker.py`(怎么核事实),和今天的 `verify.py` 比一比,40 分钟。
- [stanford-oval/storm](https://github.com/stanford-oval/storm):读 `knowledge_storm/storm_wiki/modules/persona_generator.py`,看「视角」是怎么生成的,20 分钟。
- [Ayanami0730/deep_research_bench](https://github.com/Ayanami0730/deep_research_bench):README 里 RACE、FACT 两节,以及人类标注一致率 68.78% 那段,15 分钟。

## 自测

**1. Anthropic 的复盘说「token 用量解释了 80% 的效果差异」,又说多 Agent 系统比聊天多用约 15 倍 token。这两个数字放在一起,对设计意味着什么?**

<details><summary>答案</summary>

多 Agent 效果好,很大程度上是因为它能把更多 token 花在问题上;而 token 就是钱。所以要不要上多 Agent 是一道经济题:任务值不值十几倍的成本。高价值的复杂研究值得,简单的查事实就该少花,甚至直接用 RAG。设计上要按复杂度分配预算(子 Agent 数、每个的工具调用次数),并且有硬性的总花费上限。

</details>

**2. 你的规则层核验器能抓到哪几类错?举一个它一定抓不到的错。**

<details><summary>答案</summary>

能抓:假引用(id 不存在)、引用没读过的资料、句子里的数字在被引资料里找不到、带数字却没引用。抓不到:没有数字的意思错误,比如今天埋的「月付套餐取消后按未使用天数比例退款 [kb-refund]」,引用存在、读过、没有数字,可资料写的是月付不退。还抓不到漏掉的方向和来源质量问题。另外数字检查是子串判断,「把 14 天写成 15 天」只要 15 在被引资料别处出现过,也抓不到。

</details>

**3. 第一版核验器报了 26 处问题,22 处是误报。误报为什么危险?今天是哪两个原因造成的?**

<details><summary>答案</summary>

误报多了,看结果的人会学会忽略核验器,真问题就跟着被忽略,比没有核验器还糟。今天的两个原因:没跳过 markdown 标题行,「### 2.1」这种小节编号被当成「有数字没引用」,一共 14 处;引用正则没处理模型写的 `[id=kb-invoice]` 前缀,7 处被当成假引用,还连带让一句的「30」被判成数字对不上。

</details>

**4. 逐句评审把「客户容易将提交申请误解为注销已完成 [kb-close]」判成不支持。评审错了吗?你会怎么改?**

<details><summary>答案</summary>

按提示词的字面意思,评审没错:资料里确实没写「客户容易误解」。问题在评分标准没区分事实句和分析句。改法:让写报告的模型把分析放进单独的小节且不挂引用,评审只评事实小节;或者让评审多输出一个类别(事实支持 / 事实不支持 / 分析),分析句另外交给人看,检查它依据的事实对不对、推理站不站得住。

</details>

**5. 面试题:你负责的研究 Agent 上线一个月,老板说「每份报告平均花 ¥3,太贵了,降一半,质量不能掉」。你怎么做?**

<details><summary>答案</summary>

先拆账,别猜:按「主管、研究员读网页、写报告、评测」四块统计每份报告的 token 和花费,看大头在哪。真实网页场景通常是研究员读网页的输入最大。然后按大头下手:读网页先用小模型总结,大模型只看总结;同一来源一次任务里只抓一次;按问题复杂度分档,简单问题直接走 RAG,不进流水线;研究阶段设总上限并给写报告预留,写报告设 `max_tokens`;模型评审改成抽样。每改一项,用固定的评测集(哪怕先 20 条)跑规则层 + 逐句评审,对比改前改后的不支持句数和完整性,质量没掉才保留。最后要在报告里写明因预算没研究的部分,不能悄悄截断。

</details>

## 明天预告

[Day 614](/blog/agent-zero/day-614-a2a-1/) 讲 Agent 互联(一):三层协议,A2A 走到哪一步。这两天的研究员都是你自己写的函数,互相调用就是一行代码。明天换个问题:如果研究员是别的团队、别的公司做的 Agent,你看不到它的提示词和工具,它可能要跑十分钟、中途还要问你问题,该怎么调用它?先分清 MCP、A2A、ACP 三个协议各管哪一段,再看 A2A 到 2026 年 10 月走到了哪一步。
