---
title: 'Day 92 · Deep Research Agent:长链路检索、规划和写作'
description: 'Deep Research 是一类跑几分钟到几十分钟的 Agent:澄清问题、写研究提纲、并行派出子 Agent 搜索阅读、压缩成笔记、写成带引用的报告。今天对照 open_deep_research、GPT Researcher、STORM 和 Anthropic 的工程复盘,讲清架构、评测和成本,最后实现一条可替换模型和搜索的流水线,外加一个不靠模型的引用核验器。'
pubDate: 2026-10-12
regime: none
tags: ['deep-research', 'multi-agent', 'citations', 'langgraph', 'evals', 'cost', 'agent-60']
series: 'agent-60'
day: 92
lang: 'zh'
---

## 今天要解决的问题

Day 16 做 RAG 时,流程是「检索一次、拼进提示词、回答一次」。这对「年付怎么退款」这种问题够用。换一个问题:「对比国内三家主流云厂商今年的大模型 API 价格变化,给我们选型建议」,一次检索就不够了。你要先想清楚该查哪几个方面,每个方面搜好几轮、读十几篇,把读到的东西记成笔记,最后写一份有结构、有出处的报告。人做这件事要半天,Deep Research Agent 想把它压到几分钟到几十分钟。

OpenAI、Google、Anthropic 都把这做成了产品,开源实现也很多。资深岗会在两个层面上碰到它:一是公司要做行业研究、竞品分析、尽调这类内部工具;二是它几乎集齐了长任务 Agent 的所有难点(规划、并行、上下文爆炸、引用可信、成本失控),面试官很爱拿它出系统设计题。

学完今天你应该能:

1. 画出 Deep Research 的典型架构,说清每一步解决什么问题。
2. 在 open_deep_research 的源码里找到规划、并发控制、压缩这几处,读懂它的默认参数为什么这么设。
3. 说出 Anthropic 多 Agent 研究系统复盘里的几条关键数据和工程经验。
4. 给 Deep Research 设计评测:事实准确、引用准确、覆盖度、来源质量、工具效率。
5. 实现一条可替换模型和搜索的研究流水线,以及一个不用模型的引用核验器。

预计用时 4 到 5 小时。前置:Day 16 到 19(RAG 和检索评测)、Day 20(上下文工程)、Day 26(多 Agent)、Day 66(编排模式取舍)。

## 和 RAG 差在哪

RAG 是「检索增强的一次回答」,Deep Research 是「为了写一份报告而做的研究项目」。差别在四个地方:

- **问题要先澄清**。用户说「帮我研究一下 Agent 市场」,范围太大,先问清楚关心哪个地区、哪类客户、要多深。
- **检索是多轮的**。每读完一批资料,根据读到的内容决定下一步搜什么,而不是一次把所有关键词都搜了。
- **资料量远超上下文**。几十篇网页加起来几十万字,不可能全塞给写报告的那个模型,中间必须压缩成笔记。
- **输出是长文,而且每句话要有出处**。读者要能点开引用核对,引用错了比没有引用还糟糕。

## 典型架构

<figure>
<svg viewBox="0 0 640 280" role="img" aria-label="Deep Research Agent 的典型架构">
  <rect x="0" y="0" width="640" height="280" fill="var(--paper-raised)"/>
  <rect x="20" y="24" width="100" height="44" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="70" y="44" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">澄清问题</text>
  <text x="70" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">问用户</text>
  <rect x="140" y="24" width="110" height="44" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="195" y="44" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">研究提纲</text>
  <text x="195" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">research brief</text>
  <rect x="270" y="24" width="120" height="44" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="330" y="44" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">主管 Agent</text>
  <text x="330" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">拆题、派活、判断够不够</text>
  <rect x="200" y="110" width="110" height="60" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="255" y="134" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">研究员 1</text>
  <text x="255" y="152" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">搜 → 读 → 再搜</text>
  <rect x="330" y="110" width="110" height="60" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="385" y="134" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">研究员 2</text>
  <text x="385" y="152" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">搜 → 读 → 再搜</text>
  <rect x="460" y="110" width="110" height="60" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="515" y="134" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">研究员 N</text>
  <text x="515" y="152" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">并行,上限可配</text>
  <rect x="300" y="196" width="170" height="34" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="385" y="217" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">压缩成带出处的笔记</text>
  <rect x="500" y="230" width="120" height="40" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="560" y="254" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">写报告 + 核验</text>
  <line x1="120" y1="46" x2="140" y2="46" stroke="var(--rule)"/>
  <line x1="250" y1="46" x2="270" y2="46" stroke="var(--rule)"/>
  <line x1="330" y1="68" x2="255" y2="110" stroke="var(--rule)"/>
  <line x1="330" y1="68" x2="385" y2="110" stroke="var(--rule)"/>
  <line x1="330" y1="68" x2="515" y2="110" stroke="var(--rule)"/>
  <line x1="385" y1="170" x2="385" y2="196" stroke="var(--rule)"/>
  <line x1="470" y1="213" x2="560" y2="230" stroke="var(--rule)"/>
  <text x="20" y="130" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">主管可以多轮派活:</text>
  <text x="20" y="148" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">看完第一批笔记觉得</text>
  <text x="20" y="166" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">不够,再派第二批</text>
</svg>
<figcaption>蓝色是模型做判断的地方,琥珀色是大量调用搜索和阅读工具的地方。研究员之间互相看不到对方的上下文,只把压缩后的笔记交回去,这是控制上下文的关键。</figcaption>
</figure>

**澄清问题**:范围不清时先问用户,别闷头查。**研究提纲**:把用户的问题改写成一份明确的研究任务说明。**主管 Agent**:根据提纲拆成几个子问题,派给研究员,收回笔记后判断够不够,不够就再派一轮。**研究员**:每人负责一个子问题,用搜索工具做一个小的 ReAct 循环。**压缩**:研究员读完的原文不交回,只交一份带出处的笔记。**写报告**:根据所有笔记写成长文,每句带引用。

研究员之间上下文隔离,这一点很重要。Day 26 讲多 Agent 的真实收益时说过,上下文隔离是少数几个实打实的好处之一:每个研究员可以读几万字,但只有几百字的笔记进到主管和写作模型的上下文里。

## 读 open_deep_research 的源码

LangChain 的 open_deep_research 是这个架构最清楚的开源实现。整个图在 `src/open_deep_research/deep_researcher.py` 里,不长,建议整个读一遍。节点和上面的图一一对应:`clarify_with_user`、`write_research_brief`、`supervisor` 加 `supervisor_tools`、`researcher` 加 `researcher_tools`、`compress_research`,最后生成报告。

几个值得注意的实现细节:

- **并发上限是硬限制**。在 `supervisor_tools` 里,如果主管一次想派的研究任务超过 `max_concurrent_research_units`,多出来的那些不会执行,而是返回一条错误消息告诉主管「你最多只能同时派 N 个,请重试」。用工具返回值来约束模型,而不是指望提示词里一句「不要派太多」。
- **主管的迭代次数也有上限**,超过 `max_researcher_iterations` 就直接结束研究阶段。研究员单独有 `max_react_tool_calls` 限制工具调用次数。
- **压缩有重试**。`compress_research` 在压缩时如果超出模型的 token 上限,会裁掉一部分消息再试。

再看 `src/open_deep_research/configuration.py` 里的默认值:最多 5 个并发研究单元、主管最多迭代 6 轮、每个研究员最多 10 次工具调用、单篇内容最多 5 万字符。模型也是分层配置的:总结网页用便宜的小模型,研究和写报告用大模型。这个分层你在 Day 79 讲路由时会再看到,是 Deep Research 控成本最有效的手段。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1aXg5zzExm&autoplay=0&high_quality=1" title="🦜🕸️ Open Deep Research V2：新架构！上下文工程最新实践 📋" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>沧海九粟 · Open Deep Research V2:新架构!上下文工程最新实践 · 26 分钟,对着源码讲 open_deep_research 的图结构和压缩策略,和今天这节正好配套。</figcaption>
</figure>

## 另外两个值得看的实现

**GPT Researcher**(`assafelovic/gpt-researcher`)是比较早的开源项目,有两种模式。单 Agent 模式的核心在 `gpt_researcher/agent.py`,技能拆在 `gpt_researcher/skills/` 下(`researcher.py`、`curator.py` 挑来源、`writer.py`、`deep_research.py`)。多 Agent 模式在 `multi_agents/agents/` 下,模拟了一个编辑部:`editor.py` 定提纲,`researcher.py` 查资料,`reviewer.py` 和 `reviser.py` 审稿改稿,`fact_checker.py` 核事实,`publisher.py` 出版。这种「角色化」设计好理解,但角色越多,协调成本和 token 越高,不一定比 open_deep_research 那种简单结构效果好。

**STORM**(斯坦福,论文 2402.14207)关注的是写维基百科式长文前的「准备阶段」。它的做法有意思:先发现这个主题可以从哪些视角看(比如一个历史学者、一个工程师、一个政策研究者),再模拟不同视角的作者去向一个基于检索的「专家」提问,把这些对话整理成提纲,最后才写。它说明了一件事:**提纲的质量决定报告的质量**,多视角提问能让提纲更全面。

## Anthropic 的工程复盘里值得记住的数字

Anthropic 写过一篇他们自己的多 Agent 研究系统的复盘(How we built our multi-agent research system),里面有几条数据和经验,资深面试时可以直接引用:

- 主 Agent 用 Claude Opus 4、子 Agent 用 Claude Sonnet 4 的多 Agent 系统,在他们内部的研究评测上比单 Agent 的 Claude Opus 4 好 90.2%。
- 在 BrowseComp 评测里,三个因素解释了 95% 的效果差异,其中**光是 token 用量就解释了 80%**,另外两个是工具调用次数和模型选择。换句话说,多 Agent 有效,很大程度上是因为它能把更多 token 花在问题上。
- 代价是贵:Agent 一般比普通聊天多用约 4 倍 token,多 Agent 系统多用约 15 倍。所以只有任务价值足够高时才划算。
- **按问题复杂度分配力气**,他们把规则直接写进了提示词:简单的事实查找 1 个 Agent、3 到 10 次工具调用;直接对比 2 到 4 个子 Agent、每个 10 到 15 次调用;复杂研究可以超过 10 个子 Agent,分工要清楚。
- 两种并行(主 Agent 同时派 3 到 5 个子 Agent,子 Agent 同时调 3 个以上工具)把复杂查询的研究时间缩短了最多 90%。
- 人工测试发现早期的 Agent 总是偏好 SEO 优化过的内容农场,而不是排名靠后但更权威的学术 PDF 或个人博客,后来在提示词里加了来源质量的规则才解决。
- 上线时用彩虹部署(rainbow deployment):新旧版本同时运行,逐步切流量,避免把正在跑的长任务中途打断。

最后一条和 Day 65 的持久化执行是同一个问题:任务跑几十分钟,你发版时它还在跑。

## 怎么评测一份研究报告

Anthropic 用 LLM 评审,评分表(rubric)包含五项:事实准确(结论和来源对得上吗)、引用准确(引用的来源真的支持这句话吗)、完整性(问题的各个方面都覆盖了吗)、来源质量(用的是一手资料还是二手转述)、工具效率(工具用得合理吗,次数多不多)。

学术界也有专门的基准。DeepResearch Bench(论文 2506.11763)找各领域专家出了 100 个博士水平的研究任务,覆盖 22 个领域,并提出了两套评测方法:一套用参考报告和自适应标准给报告质量打分,另一套专门评引用的准确性和有效引用数量。

对你自己的系统,我建议分三层:

1. **规则层,最便宜**:引用的 id 是否存在、句子里的数字是否能在被引用的资料里找到、有没有带数字却不带引用的句子。今天的练习就实现这一层。它抓不住所有错误,但能把最常见的「编数字」抓出来,而且确定、可重复、几乎零成本。
2. **模型评审层**:用 Day 32 的方法,按上面五项评分表让 judge 打分,判断是二元的「支持 / 不支持」,别用 1 到 10 分。
3. **人工抽查**:每周抽一些报告让领域专家看,专门找规则和 judge 都漏掉的问题,比如来源偏差。

## 成本怎么控

一次研究的成本大致是:

主管调用次数 × 主管每次 token + 研究员数 × 每个研究员的工具调用次数 × 每次读入的网页 token + 写报告的 token。

网页读入那一项通常是大头。几个有效手段:读网页用小模型先总结,大模型只看总结;按问题复杂度分配预算(上面那条规则);同一个网页在一次任务里只抓一次、只总结一次;设置硬性的总 token 或总花费上限,到了就停止研究、用已有笔记写报告,并在报告里写明「因预算限制,以下方面未充分研究」。宁可交一份明说有缺口的报告,也别悄悄超支。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/2mSNIX-l_Zc" title="Open Deep Research" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Open Deep Research · 13 分钟,作者讲架构演进,为什么从单 Agent 改成主管加研究员的结构。</figcaption>
</figure>

## 动手练习

**目标**:实现一条可替换模型和搜索的研究流水线(规划、并行研究、写报告),以及一个纯规则的引用核验器;先在离线语料上跑通,再接真实模型。

**第 1 步:建目录。**

```bash
mkdir -p agentops/research && cd agentops/research
uv init --python 3.12 && uv add --dev pytest
```

**第 2 步:写流水线和核验器。** 模型和搜索都是注入的函数,方便测试,也方便以后换成公司内部的搜索服务。

```python
# agentops/research/research.py
"""一个最小的 Deep Research 流水线:规划 -> 并行研究 -> 压缩成笔记 -> 写报告 -> 核验引用。
模型通过一个 llm(prompt) -> str 的函数注入,搜索通过 search(query, k) -> list[Source] 注入,
所以既能接真实的模型和搜索 API,也能在测试里换成假的。"""
from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass, field
from typing import Awaitable, Callable

LLM = Callable[[str], Awaitable[str]]


@dataclass(frozen=True)
class Source:
    id: str
    title: str
    text: str
    url: str = ""


@dataclass
class Budget:
    max_subquestions: int = 4      # 规划最多拆几个子问题
    max_concurrency: int = 3       # 同时跑几个研究子任务
    docs_per_query: int = 3        # 每个子问题读几篇
    max_chars_per_doc: int = 4000  # 每篇最多给模型看多少字
    llm_calls: int = 0


@dataclass
class Note:
    subquestion: str
    findings: str                  # 压缩后的笔记,每条结论后面带 [来源id]
    source_ids: list[str] = field(default_factory=list)


PLAN_PROMPT = """把下面的研究问题拆成不超过 {n} 个互不重叠的子问题,只输出 JSON 数组,每项是一个字符串。
问题:{q}"""

NOTE_PROMPT = """你在研究子问题:{sq}
下面是检索到的资料,每篇有一个 id。只根据资料回答,写成 3 到 6 条要点,每条结尾用 [id] 标注出处。
资料里没有的就写「资料中未找到」,不要编。
{docs}"""

WRITE_PROMPT = """根据下面的研究笔记写一份中文报告,回答问题:{q}
要求:每个事实性句子结尾用 [id] 标注出处,id 只能用笔记里出现过的;笔记里没有的内容不要写。
{notes}"""


async def _call(llm: LLM, budget: Budget, prompt: str) -> str:
    budget.llm_calls += 1
    return await llm(prompt)


async def plan(q: str, llm: LLM, budget: Budget) -> list[str]:
    raw = await _call(llm, budget, PLAN_PROMPT.format(n=budget.max_subquestions, q=q))
    try:
        items = json.loads(raw[raw.index("["): raw.rindex("]") + 1])
    except ValueError:
        items = [q]                                  # 规划失败就退化成单问题,别让整个任务挂掉
    return [str(x) for x in items][: budget.max_subquestions]


async def research_one(sq: str, llm: LLM, search, budget: Budget, sem: asyncio.Semaphore) -> Note:
    async with sem:
        docs = search(sq, budget.docs_per_query)
        block = "\n\n".join(f"<doc id=\"{d.id}\" title=\"{d.title}\">\n{d.text[: budget.max_chars_per_doc]}\n</doc>" for d in docs)
        findings = await _call(llm, budget, NOTE_PROMPT.format(sq=sq, docs=block))
        return Note(sq, findings, [d.id for d in docs])


async def run(q: str, llm: LLM, search, budget: Budget | None = None) -> tuple[str, list[Note]]:
    budget = budget or Budget()
    subqs = await plan(q, llm, budget)
    sem = asyncio.Semaphore(budget.max_concurrency)
    notes = await asyncio.gather(*(research_one(sq, llm, search, budget, sem) for sq in subqs))
    notes_text = "\n\n".join(f"## {n.subquestion}\n{n.findings}" for n in notes)
    report = await _call(llm, budget, WRITE_PROMPT.format(q=q, notes=notes_text))
    return report, list(notes)


# ---------- 引用核验:不靠模型,纯规则,便宜且确定 ----------

CITE = re.compile(r"\[([A-Za-z0-9_\-#]+)\]")
NUM = re.compile(r"\d+(?:\.\d+)?")


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[。!?!?])\s*|\n+", text) if s.strip()]


def verify_citations(report: str, sources: dict[str, Source]) -> list[dict]:
    """逐句检查:引用的 id 是否存在;句子里的数字是否都能在被引用的资料里找到。
    返回问题列表,空列表表示没发现问题(不等于全对,只是没抓到明显的编造)。"""
    problems = []
    for s in split_sentences(report):
        ids = CITE.findall(s)
        body = CITE.sub("", s)
        nums = NUM.findall(body)
        if not ids:
            if nums:
                problems.append({"sentence": s, "issue": "有数字但没有引用"})
            continue
        missing = [i for i in ids if i not in sources]
        if missing:
            problems.append({"sentence": s, "issue": f"引用了不存在的来源 {missing}"})
            continue
        corpus = " ".join(sources[i].text for i in ids)
        bad = [n for n in nums if n not in corpus]
        if bad:
            problems.append({"sentence": s, "issue": f"数字 {bad} 在被引用的资料里找不到"})
    return problems
```

**第 3 步:写一个离线搜索。** 没有搜索 API 也能跑。语料直接用 Day 16 生成的 CloudLedger 帮助中心文章(`data/helpcenter/*.md`)。

```python
# agentops/research/local_search.py
"""离线搜索:在本地文档目录上做一个简单的字符二元组打分。没有网络、没有搜索 API 也能把流水线跑通。
接真实搜索时,换成调用 Tavily、Bing 或公司内部搜索的函数,签名保持 search(query, k) -> list[Source]。"""
from __future__ import annotations

from collections import Counter
from pathlib import Path

from research import Source


def _grams(s: str) -> Counter:
    s = "".join(s.split()).lower()
    return Counter(s[i: i + 2] for i in range(len(s) - 1))


class LocalSearch:
    def __init__(self, folder: str):
        self.docs = [
            Source(id=p.stem, title=p.stem, text=p.read_text(encoding="utf-8"), url=str(p))
            for p in sorted(Path(folder).glob("*.md"))
        ]
        self.grams = [_grams(d.text) for d in self.docs]

    def __call__(self, query: str, k: int = 3) -> list[Source]:
        q = _grams(query)
        scored = sorted(
            ((sum(min(c, g[t]) for t, c in q.items()), d) for d, g in zip(self.docs, self.grams)),
            key=lambda x: -x[0],
        )
        return [d for score, d in scored[:k] if score > 0]
```

**第 4 步:写测试。** 第一个测试专门构造三种错误(编造的数字、没有引用的数字、引用不存在的来源),看核验器能不能都抓到;第二个用假模型跑通整条流水线,并检查调用次数。

```python
# agentops/research/test_research.py
import asyncio
import json
from research import Budget, Source, run, verify_citations
from local_search import LocalSearch

SRC = {
    "kb-002": Source("kb-002", "退款政策", "年付按剩余整月退款,当月不退。重复扣款 3 个工作日内全额退回。"),
    "kb-007": Source("kb-007", "发票", "电子发票在付款后 24 小时内开具。"),
}


def test_verify_flags_fabricated_number_and_missing_source():
    report = ("重复扣款会在 3 个工作日内全额退回 [kb-002]。"
              "电子发票在付款后 48 小时内开具 [kb-007]。"
              "年付用户还能获得 10% 补偿。"
              "退款需要主管审批 [kb-099]。")
    issues = verify_citations(report, SRC)
    kinds = [i["issue"] for i in issues]
    assert any("48" in k for k in kinds)
    assert any("没有引用" in k for k in kinds)
    assert any("kb-099" in k for k in kinds)
    assert len(issues) == 3


def test_pipeline_with_fake_llm(tmp_path):
    (tmp_path / "kb-002.md").write_text(SRC["kb-002"].text, encoding="utf-8")
    (tmp_path / "kb-007.md").write_text(SRC["kb-007"].text, encoding="utf-8")
    search = LocalSearch(str(tmp_path))
    seen = []

    async def fake_llm(prompt: str) -> str:
        seen.append(prompt[:6])
        if prompt.startswith("把下面的研究问题"):
            return json.dumps(["重复扣款怎么退", "发票多久开", "年付怎么退"], ensure_ascii=False)
        if prompt.startswith("你在研究子问题"):
            return "- 重复扣款 3 个工作日内全额退回 [kb-002]"
        return "重复扣款会在 3 个工作日内全额退回 [kb-002]。"

    budget = Budget(max_concurrency=2)
    report, notes = asyncio.run(run("CloudLedger 的退款和发票规则", fake_llm, search, budget))
    assert len(notes) == 3 and budget.llm_calls == 5
    assert verify_citations(report, SRC) == []
```

```bash
uv run pytest -q
```

输出大致长这样:`2 passed`。

**第 5 步:接真实模型跑一次。** 用 Day 4 的 `LLMClient` 包一个异步函数 `async def llm(prompt) -> str`,搜索用 `LocalSearch("data/helpcenter")`。研究问题:「整理 CloudLedger 关于退款、发票和账户注销的规则,指出其中容易让客户误解的地方」。跑完后用 `verify_citations` 核验报告,填表:

| 指标 | 结果 |
| --- | --- |
| 子问题数 | |
| LLM 调用次数 | |
| 报告字数 | |
| 核验出的问题数 | |
| 人工复核:核验器漏掉的错误数 | |
| 总 token / 估算花费 | |

**第 6 步:按复杂度分配预算。** 在 `plan()` 前面加一个「判断复杂度」的步骤,让模型把问题分成简单、对比、复杂三档,分别对应 1、3、5 个子问题。对一个简单问题和一个复杂问题各跑一次,比较调用次数和报告质量。

**验收标准**:2 个测试通过;第 5 步的表格填完,并人工核对至少 10 句带引用的句子,写下核验器漏掉了哪类错误;第 6 步的两次运行有对比数据。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| Deep Research Agent | 为写一份带出处的研究报告而进行多轮检索、阅读和综合的长任务 Agent |
| research brief | 把用户的模糊需求改写成的明确研究任务说明 |
| 主管 / 研究员 | 多 Agent 研究系统里负责拆题派活的 Agent,和负责具体子问题的 Agent |
| 压缩(compress) | 研究员把读过的大量原文整理成带出处的短笔记,只把笔记交回 |
| 并发研究单元 | 同时进行的研究子任务数量,是控制成本和速度的主要参数 |
| 引用准确 | 被引用的来源确实支持这句话,不只是「有引用」 |
| 来源质量 | 优先一手资料、权威来源,而不是内容农场和转述 |
| 彩虹部署 | 新旧版本同时运行、逐步切流量的发布方式,避免打断正在跑的长任务 |
| BrowseComp | 测试浏览 Agent 寻找难找信息能力的评测集 |
| DeepResearch Bench | 由各领域专家出题的 Deep Research 评测基准 |

## 常见误区

**把全部原文交给写报告的模型。** 上下文爆掉,成本暴涨,而且写作模型在海量原文里更容易找错依据。研究员必须先压缩。

**有引用就以为可信。** 模型很会编一个看起来对的引用。至少要做规则层核验,关键报告还要 judge 和人工抽查。

**所有问题都派一堆子 Agent。** 简单问题用多 Agent 是纯烧钱。按复杂度分配预算,并把规则写进提示词。

**只用搜索引擎排序。** 排名靠前的常常是内容农场。要有来源质量规则,比如优先官方文档、论文、原始数据。

**预算到了悄悄截断。** 应该在报告里明说哪些方面因预算没研究完,让读者知道缺口在哪。

## 学习资料

### 文档与文章

- [Anthropic:How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system):今天引用的所有数据和工程经验的出处,资深必读,1 小时。
- [STORM 论文(arXiv 2402.14207)](https://arxiv.org/abs/2402.14207):多视角提问生成提纲的方法,读第 3 节,40 分钟。
- [DeepResearch Bench(arXiv 2506.11763)](https://arxiv.org/abs/2506.11763):评测方法,读两套评测框架的设计,40 分钟。
- [GPT Researcher 文档](https://docs.gptr.dev/):单 Agent 和多 Agent 两种模式的说明,30 分钟。
- [STORM 在线演示](https://storm.genie.stanford.edu/):可以直接体验多视角提问生成文章,15 分钟。

### B 站视频

- 沧海九粟《Open Deep Research V2:新架构!上下文工程最新实践》:已嵌入正文。
- 偷星九月333《[Agent][01] 练习两天半,从零开始实现Deep Research》:35 分钟,从零写一个 Deep Research,适合对照自己的实现看思路差异。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1RyZZY3E7n&autoplay=0&high_quality=1" title="[Agent][01] 练习两天半，从零开始实现Deep Research（DeepSeek自动生成带插图的markdown报告），原理讲解到代码实现" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>偷星九月333 · [Agent][01] 练习两天半,从零开始实现Deep Research · 35 分钟,用 DeepSeek 做的完整实现,看它怎么组织搜索和写作。</figcaption>
</figure>

### 其他经典视频

- LangChain《Open Deep Research》:已嵌入正文。
- Alejandro AO《Anthropic: How to Build Multi Agent Systems》:38 分钟,逐段讲解 Anthropic 那篇复盘,英文读起来吃力的话看这个。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/0HljLKVdtjo" title="Anthropic: How to Build Multi Agent Systems" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Alejandro AO · Anthropic: How to Build Multi Agent Systems · 38 分钟,重点听按复杂度分配资源和评测那两段。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 6 章「RAG and Agents」,检索和 Agent 规划两部分合起来就是 Deep Research 的理论基础,1.5 小时。英文原版。

### 开源项目与代码

- [langchain-ai/open_deep_research](https://github.com/langchain-ai/open_deep_research):读 `src/open_deep_research/deep_researcher.py` 和 `configuration.py`,1 小时。
- [assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher):读 `gpt_researcher/skills/curator.py`(来源筛选)和 `multi_agents/agents/editor.py`。
- [stanford-oval/storm](https://github.com/stanford-oval/storm):看 README 里的流水线说明,了解多视角提问怎么落地。

## 自测

**1. Deep Research 为什么要让研究员把原文压缩成笔记再交回,而不是直接交回原文?**

<details><summary>答案</summary>

原文量远超上下文,全交回会撑爆主管和写作模型的上下文,成本也会暴涨;写作模型在海量原文里更容易找错依据。压缩成带出处的笔记后,每个研究员可以读很多,但进入后续上下文的只有精华,这就是多 Agent 上下文隔离的价值。

</details>

**2. open_deep_research 怎么防止主管一次派出太多研究任务?这种做法好在哪?**

<details><summary>答案</summary>

在 supervisor_tools 里检查一次派出的研究任务数,超过 max_concurrent_research_units 的部分不执行,而是返回一条错误消息告诉主管上限是多少。好处是约束在代码里是硬的,不依赖模型听不听提示词;而且错误信息能让模型知道怎么改,下一轮会自己调整。

</details>

**3. Anthropic 的复盘说 token 用量解释了 80% 的效果差异,这对系统设计意味着什么?**

<details><summary>答案</summary>

效果很大程度上取决于能在问题上花多少 token,多 Agent 并行是一种有效扩大 token 投入的方式。但这也意味着成本和效果强相关,设计时要按任务价值和复杂度分配预算:高价值的复杂研究值得多花,简单问题就该少花。不能只看效果不看成本。

</details>

**4. 你的引用核验器能抓住哪些错误?抓不住哪些?**

<details><summary>答案</summary>

能抓住:引用了不存在的来源;句子里的数字在被引用的资料里找不到(编造或抄错数字);带数字却没有引用的句子。抓不住:没有数字的错误陈述(比如把「不退」说成「可以退」);来源确实存在但并不支持这个结论;重要内容的遗漏;来源本身质量差。这些需要 LLM judge 和人工抽查。

</details>

**5. 资深面试题:设计一个给投资团队用的「公司尽调研究 Agent」,输入公司名,输出一份 20 页的尽调报告。说说架构、质量保障和成本控制。**

<details><summary>答案</summary>

架构用主管加研究员:先根据尽调模板(业务、财务、团队、竞争、风险、法律诉讼等)生成研究提纲,用户确认后,主管按章节派研究员并行研究,每个研究员有自己的搜索和阅读工具,来源分级:工商和财报等一手数据优先,新闻次之,论坛和内容农场默认降权或排除。研究员交回带出处的笔记,写作模型按模板逐章写,每句带引用。

质量保障三层:规则核验(引用存在、数字可在来源中找到、敏感结论必须有一手来源);LLM judge 按事实准确、引用准确、完整性、来源质量打分;投资经理人工复核关键章节,并把发现的错误加进评测集。报告里明确标注每个结论的置信度和数据截止时间。

成本控制:网页总结用小模型,规划和写作用大模型;同一来源在任务内只抓一次;按公司规模和报告深度设置总预算,到上限就停止研究并在报告中写明未覆盖的部分。长任务用持久化执行,支持断点续跑,发版用彩虹部署。上线前用历史上人工做过的尽调报告做对比评测。

</details>

## 明天预告

Day 93 讲 Agent 互联:A2A、MCP 与 Agent 间协作的协议之争。今天的研究员都是你自己写的,明天要回答另一个问题:如果研究员是别的团队、别的公司做的 Agent,怎么发现它、怎么调用它、怎么信任它?我们会读 A2A 1.0 规范,看它和 MCP 怎么分工,然后手写一个最小的 A2A 服务端,把 SupportPilot 包成一个能被别的 Agent 调用的 Agent。
