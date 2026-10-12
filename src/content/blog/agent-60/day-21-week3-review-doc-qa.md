---
title: 'Day 21 · W3 复习 + 小项目:带引用出处的文档问答 Agent'
description: 'W3 收官。一页知识地图串起 embedding、切块、pgvector、混合检索、rerank、评估、上下文和记忆;把这一周的代码拼成一个多轮、带引用、会拒答、能一键评估的文档问答 Agent;再过一遍 W3 面试题和踩坑清单。'
pubDate: 2026-10-12
regime: none
tags: ['rag', 'review', 'project', 'interview', 'agent-60']
series: 'agent-60'
day: 21
lang: 'zh'
---

## 今天要解决的问题

这一周信息量很大。Day 15 从「两个向量的夹角」讲起,到 Day 20 已经在讨论 Agent 的长期记忆了。今天不学新东西,做三件事:

1. 用一张图把 W3 的所有概念串起来,确认每一块你都能讲清楚它解决什么问题。
2. 把散落在七八个文件里的代码拼成一个完整可用的小项目:CloudLedger 文档问答 Agent。它支持多轮对话、回答带引用、资料不足时拒答、有一键运行的评估。W4 的工单 Agent 会直接把它当作知识库模块。
3. 过一遍 W3 的面试题和踩坑清单。RAG 是 Agent 岗位面试里被问得最多的话题,没有之一。

今天结束时你应该能做到:

- 不看笔记画出 RAG 的完整架构图,并说出每一层的关键参数和评估指标。
- 跑通 `docqa.py`,完成一段至少 5 轮的对话,其中包含一个多问题、一个追问、一个无答案问题。
- 用评估脚本拿到这个项目的检索和生成分数,并写一段两三百字的「项目说明」,能直接放进简历或 README。
- 对着面试题清单(16 道),每道题能用两三分钟讲清楚。

预计用时 5–7 小时。项目部分如果前几天的代码都跑通了,两三个小时就能完成;如果中间有卡住的,今天正好补上。

## 一页知识地图

<figure>
<svg viewBox="0 0 640 400" role="img" aria-label="W3 知识地图:离线索引、在线检索、生成、评估、上下文与记忆五个区域及对应的天数">
<rect x="0" y="0" width="640" height="400" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="16" width="290" height="150" rx="6" fill="none" stroke="var(--compute)"/>
<text x="28" y="38" fill="var(--compute)">离线:建索引</text>
<text x="28" y="60" fill="var(--ink)">文章 + 元数据(Day 16)</text>
<text x="28" y="80" fill="var(--ink)">按标题切块,块前加标题(Day 16)</text>
<text x="28" y="100" fill="var(--ink)">embedding,归一化(Day 15)</text>
<text x="28" y="120" fill="var(--ink)">pgvector + HNSW,内容哈希增量(Day 17)</text>
<text x="28" y="140" fill="var(--ink)">BM25 + jieba 业务词典(Day 18)</text>
<text x="28" y="158" fill="var(--ink-faint)" font-size="11">上游:文档解析(PDF/表格/OCR);可选 Contextual Retrieval</text>
<rect x="334" y="16" width="290" height="150" rx="6" fill="none" stroke="var(--mem)"/>
<text x="346" y="38" fill="var(--mem)">在线:检索</text>
<text x="346" y="60" fill="var(--ink)">query 改写 / 多路查询(Day 18)</text>
<text x="346" y="80" fill="var(--ink)">向量 top-20 + BM25 top-20</text>
<text x="346" y="100" fill="var(--ink)">RRF 融合(k=60)</text>
<text x="346" y="120" fill="var(--ink)">rerank 精排 → top-4</text>
<text x="346" y="140" fill="var(--ink)">分数低于阈值 → 拒答</text>
<text x="346" y="158" fill="var(--ink-faint)" font-size="11">过滤:分类、权限、租户(Day 17)</text>
<rect x="16" y="184" width="290" height="110" rx="6" fill="none" stroke="var(--mem)"/>
<text x="28" y="206" fill="var(--mem)">生成</text>
<text x="28" y="228" fill="var(--ink)">只依据资料,标注 [kb-xxx#n]</text>
<text x="28" y="248" fill="var(--ink)">资料不足就说不知道</text>
<text x="28" y="268" fill="var(--ink)">引用校验(今天)</text>
<text x="28" y="286" fill="var(--ink-faint)" font-size="11">固定 RAG vs Agentic RAG(Day 20)</text>
<rect x="334" y="184" width="290" height="110" rx="6" fill="none" stroke="var(--ink-soft)"/>
<text x="346" y="206" fill="var(--ink)">评估(Day 19)</text>
<text x="346" y="228" fill="var(--ink)">检索:hit@1 recall@k MRR</text>
<text x="346" y="248" fill="var(--ink)">生成:忠实 完整 拒答(LLM 裁判)</text>
<text x="346" y="268" fill="var(--ink)">按问题类型拆开看</text>
<text x="346" y="286" fill="var(--ink-faint)" font-size="11">一次只改一个变量,记实验日志</text>
<rect x="16" y="312" width="608" height="72" rx="6" fill="none" stroke="var(--rule)"/>
<text x="28" y="334" fill="var(--ink)">上下文与记忆(Day 20)</text>
<text x="28" y="356" fill="var(--ink-soft)">预算:系统/工具/记忆/资料/历史/输出   历史:按轮裁剪 → 摘要压缩</text>
<text x="28" y="374" fill="var(--ink-soft)">清理工具结果 · 子 Agent 隔离 · 长期记忆(抽取 → 去重 → 召回 → 可删除)· Harness</text>
</g>
</svg>
<figcaption>W3 的五个区域。面试画 RAG 架构图时,按「离线 → 检索 → 生成 → 评估」的顺序讲,再补上下文和记忆,基本不会漏。</figcaption>
</figure>

对着这张图做一次自测:遮住右边的「在线检索」区域,看自己能不能说出每一步为什么存在、去掉会怎样。比如「为什么要 rerank?」你的回答应该是「召回阶段用的 bi-encoder 和 BM25 便宜但排序粗糙,rerank 用 cross-encoder 逐对打分更准,但只能对几十个候选做」,而不是「因为加了效果好」。如果哪一块讲不顺,回到对应那天重读。

把这周的东西压成几句话,大概是这样的:

RAG 的上限由检索决定,检索没找到的,模型不可能答对。embedding 擅长语义,BM25 擅长精确匹配,两者用 RRF 融合,再用 rerank 精排。切块要带上下文,元数据在导入时就带上。所有「感觉变好了」都要用评估集上的数字确认,而且检索和生成分开评、按问题类型拆开看。上下文是稀缺资源,按代价从低到高用清理工具结果、裁剪、摘要压缩,探索量大的子任务交给子 Agent 隔离,记忆要有写入规则和删除能力。这些再加上 Agent 循环、工具加载、状态持久化、沙箱和可观测,就是 JD 里常说的 Agent Harness。文档进库之前还有一道解析关,表格和扫描件处理不好,后面全白搭。能用固定流程解决的,不要急着上 Agentic。

## 小项目:CloudLedger 文档问答 Agent

### 目录结构

到今天,你的 `agent-60-lab/w3/` 应该长这样。每个文件对应的天数写在后面,缺哪个回去补:

```text
agent-60-lab/
├── .env                      # LLM_* / EMB_* / RERANK_* / PG_DSN / MIN_RERANK_SCORE
├── data/
│   ├── helpcenter/           # make_helpcenter.py 生成的 20 篇文章
│   └── eval/
│       ├── rag_eval.jsonl    # make_eval_set.py 生成的 30 条评估集
│       └── generation_results.jsonl
└── w3/
    ├── embed.py              # Day 15  embedding 封装
    ├── llm.py                # Day 16/20  chat / chat_raw
    ├── make_helpcenter.py    # Day 16  造数据
    ├── chunking.py           # Day 16  切块
    ├── prompts.py            # Day 19  回答 prompt
    ├── pg_store.py           # Day 17  pgvector 建表、增量同步、检索
    ├── pg_sync.py            # Day 17  离线同步入口
    ├── doc_parse.py          # Day 18  PDF/表格/扫描件解析
    ├── bm25_index.py         # Day 18  jieba + BM25
    ├── fusion.py             # Day 18  RRF
    ├── rerank.py             # Day 18  rerank 接口
    ├── rewrite.py            # Day 18  query 改写
    ├── retrieve.py           # Day 18  完整检索流水线
    ├── metrics.py            # Day 19  检索指标
    ├── make_eval_set.py      # Day 19  评估集
    ├── mem_retriever.py      # Day 19  评估用内存检索器
    ├── eval_retrieval.py     # Day 19  检索评估
    ├── eval_generation.py    # Day 19  生成评估
    ├── context_budget.py     # Day 20  token 估算与裁剪
    ├── compaction.py         # Day 20  对话压缩
    ├── tool_clearing.py      # Day 20  清理旧工具结果
    ├── subagent.py           # Day 20  子 Agent 隔离上下文
    ├── memory_store.py       # Day 20  长期记忆
    ├── agentic_rag.py        # Day 20  Agentic RAG
    ├── calibrate_threshold.py  # 今天  拒答阈值校准
    └── docqa.py              # 今天  主程序
```

`rag_numpy.py`、`build_index.py`、`ask.py`、`rag_pg.py`、`compare_retrieval.py` 是学习过程中的中间版本,可以留着对照,主程序不再依赖它们。

### 主流程

一轮对话里,`docqa.py` 依次做这些事:

1. 压缩历史。历史超过 2,000 token 时,把旧对话总结成摘要(Day 20)。
2. 改写查询。有历史时,用大模型把「那年付的呢」补全成独立问题,并拆分多问题;原问题保留为其中一路(Day 18)。
3. 多路召回 + 融合 + 精排。每个查询各做一次向量检索和 BM25,RRF 融合,rerank 取 top-4(Day 17/18)。
4. 拒答判断。rerank 最高分低于阈值,直接回答「没找到,建议转人工」,不调用生成模型。省钱,也从源头上避免了编造。
5. 生成。system prompt + 历史 + 本轮资料和问题。
6. 引用校验。检查回答里的 `[kb-xxx#n]` 是否都来自本轮提供的资料,模型编出来的引用要标出来。
7. 更新历史。历史里只存问答文本,不存检索资料。

第 7 点值得解释一下。检索资料每轮都会重新取,如果也存进历史,上下文会被几轮前的旧资料迅速占满,而且旧资料可能和本轮问题无关,反而干扰回答。所以历史只记「说了什么」,资料每轮按需重新检索。

第 6 点是我在做客服项目时加上的。模型偶尔会引用一个不存在的块,比如资料里只有 `kb-002#1`,它写了 `[kb-002#4]`。用户点进去发现对不上,对整个系统的信任会大打折扣。一个正则加一次集合比较就能抓住这种情况,成本几乎为零。

```python
# agent-60-lab/w3/docqa.py
"""W3 小项目:带引用出处的 CloudLedger 文档问答 Agent(命令行,多轮)。

一轮的流程:
  压缩历史 → (有历史时)改写查询 → 向量 + BM25 召回 → RRF → rerank
  → 最高分低于阈值直接拒答 → 拼 prompt 生成 → 校验引用 → 打印来源

运行:uv run python w3/docqa.py
命令:/sources 看上一轮的完整来源   /reset 清空对话   /quit 退出
"""
import os
import re

from compaction import compact
from llm import chat
from prompts import build_messages
from retrieve import CHUNKS, retrieve

MIN_RERANK = float(os.environ.get("MIN_RERANK_SCORE", "0.05"))  # 用 calibrate_threshold.py 校准
CITE = re.compile(r"\[(kb-\d{3}#\d+)\]")
REFUSAL = "帮助中心里没有找到这个问题的说明,建议转人工客服。"


def answer_turn(question: str, history: list[dict]) -> tuple[str, list]:
    hits = retrieve(question, k=4, mode="hybrid+rerank", history=history, use_rewrite=bool(history))
    if not hits or hits[0][1] < MIN_RERANK:
        return REFUSAL, []
    chunks = [c for c, _ in hits]
    system, user = build_messages(question, chunks)
    reply = chat([system, *history, user], temperature=0)

    # 引用校验:只允许引用本轮提供的资料,编出来的 id 要标出来
    given = {c.id for c in chunks}
    bad = [cid for cid in CITE.findall(reply) if cid not in given]
    if bad:
        reply += f"\n(注意:回答里的引用 {', '.join(sorted(set(bad)))} 不在本轮资料中,请人工核对)"
    return reply, hits


def main() -> None:
    history: list[dict] = []
    last_hits: list = []
    print("CloudLedger 帮助中心问答。/sources 看来源,/reset 清空,/quit 退出。")
    while True:
        try:
            q = input("\n你:").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not q:
            continue
        if q == "/quit":
            break
        if q == "/reset":
            history, last_hits = [], []
            print("(对话已清空)")
            continue
        if q == "/sources":
            for c, s in last_hits:
                print(f"  {s:.3f}  [{c.id}] {c.title} > {c.section}\n         {c.text.splitlines()[-1][:60]}…")
            continue

        reply, last_hits = answer_turn(q, history)
        print(f"\n客服:{reply}")
        cited = sorted(set(CITE.findall(reply)))
        if cited:
            print("来源:" + ";".join(f"{cid} {CHUNKS[cid].title}" for cid in cited if cid in CHUNKS))

        # 历史里只存问答文本,不存检索资料,资料每轮重新检索
        history += [{"role": "user", "content": q}, {"role": "assistant", "content": reply}]
        history = compact(history, keep_last_turns=3, trigger_tokens=2000)


if __name__ == "__main__":
    main()
```

注意 `compact` 我今天改了一处:Day 20 的版本在第二次压缩时,会把第一次的摘要原样保留,再加一段新摘要,聊得越久摘要叠得越多。现在的版本会把旧摘要也交给模型一起总结,永远只保留一段。Day 20 的代码我已经同步更新了,如果你是先抄了旧版,记得改过来。这种「用了一阵才发现的问题」,在真实项目里太常见了,所以要有长对话的测试用例。

### 校准拒答阈值

`MIN_RERANK_SCORE` 默认给的 0.05 只是一个占位值。rerank 分数的分布和 embedding 相似度一样依赖模型,必须在自己的数据上校准。办法是用评估集里「有答案」和「无答案」两类问题,分别看 rerank 最高分落在哪:

```python
# agent-60-lab/w3/calibrate_threshold.py
"""看评估集里「有答案」和「无答案」两类问题的 rerank 最高分分布,帮你定拒答阈值。"""
from eval_retrieval import load_eval
from retrieve import retrieve

if __name__ == "__main__":
    rows = load_eval()
    scores = {"有答案": [], "无答案": []}
    for row in rows:
        hits = retrieve(row["question"], k=1, mode="hybrid+rerank")
        top = hits[0][1] if hits else 0.0
        group = "有答案" if row["expected_docs"] else "无答案"
        scores[group].append(top)
        print(f"{top:.3f}  {group}  {row['question']}")
    for g, s in scores.items():
        s.sort()
        print(f"{g}: 最低 {s[0]:.3f}  最高 {s[-1]:.3f}  共 {len(s)} 条")
    print("阈值应落在「无答案的最高分」和「有答案的最低分」之间;两者重叠时,宁可偏低(少拒答),再靠 prompt 兜底。")
```

理想情况下,两组分数之间有一道清晰的缝,阈值放在缝里。现实中经常会重叠,比如「你们支持微信支付吗」和《错误码 E3001:支付失败》有一定相关性,rerank 分数不会太低。重叠时我倾向于把阈值设得偏低,只拦住明显无关的;剩下的交给 prompt 里「资料不足就说不知道」那条规则兜底。两道防线比一道稳。只有 4 条无答案问题当然太少,这也是给评估集加题的理由。

### 跑起来

按顺序执行一遍完整的流程(Postgres 容器已经起着):

```bash
cd agent-60-lab
uv run python w3/make_helpcenter.py          # 造数据(改了文章就重跑)
uv run python w3/pg_sync.py                  # 增量同步到 pgvector
uv run python w3/make_eval_set.py            # 生成评估集
uv run python w3/eval_retrieval.py           # 检索评估,四种模式
uv run python w3/calibrate_threshold.py      # 看分数分布,把阈值写进 .env
uv run python w3/eval_generation.py          # 生成评估(会花几毛钱)
uv run python w3/docqa.py                    # 开聊
```

试一段这样的对话,观察每一轮的行为:

```text
你:我们是年付的专业版,买了十天,能退吗
你:那退款前要做什么准备吗          ← 追问,依赖上一轮;看改写是否补全成「年付退款前准备」
你:发票抬头也写错了,一起处理       ← 多问题;看是否同时检索到发票和退款
你:/sources                        ← 看来源
你:你们有学生优惠吗                ← 无答案;看是被阈值拦住,还是模型自己说不知道
你:好的谢谢
```

### 项目分数和说明

把评估结果填进这张表,它就是这个项目的「成绩单」:

| 指标 | 数值 | 说明 |
| --- | --- | --- |
| 检索 hit@1(hybrid+rerank) |  | 26 条有答案问题 |
| 检索 recall@4 |  |  |
| 检索 MRR |  |  |
| 口语类 hit@1 |  | 最弱的一类,对比纯 BM25 的 0.333 |
| 生成忠实率 |  | LLM 裁判,已人工抽查 10 条 |
| 生成完整率 |  |  |
| 无答案拒答正确率 |  | 4 条 |
| 单次问答平均耗时 |  | 自己用 `time` 粗测 |

然后写一段项目说明。这段话以后会出现在你的简历、GitHub README 和面试的自我介绍里,值得花半小时打磨。我给一个骨架,数字换成你自己的:

> 为一个 SaaS 产品的帮助中心搭建了多轮问答 Agent。离线侧用 pgvector 存储向量,按内容哈希做增量更新;在线侧用向量 + BM25(jieba 加业务词典)双路召回,RRF 融合后用 bge-reranker 精排,对 rerank 低分问题直接拒答,回答带引用并做引用校验。建了 30 条分类型评估集,检索和生成分层评估:混合检索 + rerank 把口语类问题的 hit@1 从纯 BM25 的 0.33 提升到 X,整体 MRR 达到 Y;生成层忠实率 Z%,无答案问题拒答正确率 W%。多轮场景用查询改写和历史摘要压缩控制上下文长度。

注意这段话的结构:做了什么、用了什么技术、为什么这么选、用什么方法验证、结果是什么数字。面试官最想听的是后两部分。「用了 RAG 和 pgvector」谁都会写,「口语类 hit@1 从 0.33 提到 X」才是你独有的。

## W3 面试题汇总

下面这些题,我按「被问到的频率」从高到低排。每题先自己讲两三分钟,再展开看要点。

**1. 介绍一下 RAG 的原理和完整流程。**

<details><summary>要点</summary>

离线:文档清洗、切块(带元数据和上下文)、embedding、写入向量库并建索引;在线:query 处理(改写)、多路召回(向量 + 关键词)、融合、rerank、拼 prompt、生成并引用、拒答。最后补一句评估:检索和生成分层评估。用 CloudLedger 举例更好。

</details>

**2. 切块策略怎么选?块大小怎么定?**

<details><summary>要点</summary>

有结构按结构切(标题、段落),无结构用固定长度加重叠;块前加文档标题等上下文;大小没有标准答案,中文客服文档几百字起步,用评估集比较几档的 recall 再定。举出「块太小信息被切散、太大向量被稀释」的具体例子。

</details>

**3. 向量检索有什么缺点?怎么弥补?**

<details><summary>要点</summary>

对编号、错误码、专有名词、否定词不敏感;用户措辞和文档差别大时也会失败。弥补:BM25 混合检索、RRF 融合、rerank、query 改写、contextual retrieval。举 E1042/E1043 的例子。

</details>

**4. 召回率高但最终回答不准,怎么排查?**

<details><summary>要点</summary>

先分层:看正确资料是否在 top-k 里,在就是生成问题(prompt、资料冲突、k 过大引入噪音),不在就是检索问题(排序靠后、被截断)。召回率高但 top-1 不准,加 rerank;生成问题看忠实度评估和具体 bad case。改完回归评估集。

</details>

**5. 怎么评估一个 RAG 系统?**

<details><summary>要点</summary>

检索层 hit@k、recall@k、MRR,需要标注答案所在文档;生成层忠实度、完整度、相关性,用 LLM 裁判加人工抽查;必须有无答案问题测拒答;按问题类型拆分;评估集来自真实用户问题,持续增长并版本化。提一句 RAGAS 的指标和你自己实现的区别。

</details>

**6. rerank 和 embedding 模型有什么区别?**

<details><summary>要点</summary>

bi-encoder 分别编码、可预计算、快、粗;cross-encoder 联合编码、实时计算、慢、准。所以两阶段:召回几十个再精排。

</details>

**7. 向量数据库怎么选?为什么用 pgvector?**

<details><summary>要点</summary>

按规模、是否已有基础设施、是否要和业务数据联查、过滤需求、运维能力来选。pgvector 适合百万到千万级、已有 Postgres、要事务和权限过滤;上亿规模、高并发再考虑 Milvus 等。讲 HNSW 原理、ef_search,以及过滤导致结果变少和迭代扫描。

</details>

**8. 知识库更新了怎么办?**

<details><summary>要点</summary>

增量更新:按内容哈希判断哪些块变了,只重算变化的部分,删除消失的块;upsert 放在事务里;换 embedding 模型时必须全量重建,可以双写灰度切换。

</details>

**9. 多轮对话的 RAG 有什么难点?**

<details><summary>要点</summary>

追问依赖上下文(「那年付的呢」),要做查询改写补全;历史越来越长,要裁剪和压缩,压缩 prompt 要保留业务关键信息;检索资料不要存进历史,每轮重新检索。

</details>

**10. 怎么减少幻觉?**

<details><summary>要点</summary>

检索层提高召回和排序质量;prompt 要求只依据资料、资料不足就说不知道;rerank 低分直接拒答;要求引用并做引用校验;用忠实度评估量化幻觉率并持续监控;高风险场景人工审核。

</details>

**11. 什么是 Agentic RAG?什么时候用?**

<details><summary>要点</summary>

把检索做成工具,由 Agent 决定是否检索、检索什么、几次。适合多问题、需要追查、问题多样的场景;代价是延迟和成本不可控、调试难。默认用固定流程,按条件升级。

</details>

**12. 什么是上下文工程?和提示词工程有什么区别?**

<details><summary>要点</summary>

提示词工程关注怎么写指令;上下文工程关注每次调用时窗口里放什么、放多少。手段:写出去(记忆、笔记)、选进来(检索)、压缩(摘要、清理工具结果)、隔离(子 Agent)。原因是 context rot:上下文越长模型越难用好信息。

</details>

**13.(手写题)写一个函数计算 recall@k 和 MRR。**

<details><summary>要点</summary>

参考 Day 19 的 `metrics.py`。注意先把块级结果按文档去重,保留首次出现的位置;expected 为空的样本要跳过;MRR 是第一个相关结果排名的倒数。

</details>

**14.(手写题)实现 RRF。**

<details><summary>要点</summary>

参考 Day 18 的 `fusion.py`。每一路排名第 r 的结果加 1/(k+r),k 通常取 60,按总分降序。追问「为什么不直接加分数」:量纲不同、分布随查询变化。

</details>

**15. 知识库里有大量 PDF、Excel 和扫描件,你怎么处理?**

<details><summary>要点</summary>

先分类型:文字型 PDF 直接抽,扫描页(抽不出文字)走 OCR,逐页判断;表格单独识别转 Markdown,大表按行切块并带表名和表头,需要筛选计算的表格进数据库做成 SQL 工具;去掉每页重复的页眉页脚;多栏和复杂版式用版面分析工具(MinerU、Docling 等);图片用 OCR 或多模态模型描述。入库前人工抽查解析结果,评估集里加「答案在表格里」的问题,解析方式变了就重跑检索评估。

</details>

**16. 你怎么理解 Agent Harness?上下文管理在里面做什么?**

<details><summary>要点</summary>

Harness 是模型之外让 Agent 能干活的整套工程:Agent 循环和步数预算、工具/MCP/Skills 的注册与按需加载、上下文组装、状态持久化与恢复、沙箱与权限、可观测。上下文管理是其中最核心的一块:每一轮组装 system、工具定义、记忆、检索结果和历史;按代价从低到高用工具结果清理(不调模型,只换旧 tool 消息的 content)、按轮裁剪、摘要压缩(压缩 prompt 列明必须保留的业务信息,旧摘要合并);探索量大的子任务交给子 Agent 隔离,只回传结论,代价是总 token 增加。最好每一点都指着自己的代码讲。

</details>

## W3 踩坑清单

这些坑我和身边的人都实实在在踩过,每一条都值得写在你自己的笔记里:

| 坑 | 症状 | 怎么发现/避免 |
| --- | --- | --- |
| DeepSeek 没有 embedding 接口 | 调用 404 | embedding 单独配一组 EMB_* |
| 索引和查询用了不同 embedding 模型 | 检索结果像随机的,不报错 | 换模型必须全量重建;表上 `vector(维度)` 能挡住部分错误 |
| 依赖相似度绝对阈值 | 换模型后全部召回不到 | 用 top-k;阈值必须在评估集上校准 |
| 维度超过 2000 建不了 HNSW | 建索引报错 | 用 halfvec 或降低维度 |
| 索引 ops 和查询操作符不匹配 | 建了索引还是慢 | `EXPLAIN` 看是否走索引 |
| HNSW 加过滤结果变少 | LIMIT 5 只返回 2 行 | 迭代扫描、调大 ef_search、部分索引 |
| `from embed import total_tokens` | 计数永远是 0 | 用 `import embed as emb; emb.total_tokens` |
| jieba 切错业务词 | BM25 匹配不上「企业版」 | 加业务词典,索引和查询用同一套 |
| 改写后丢了原问题 | 错误码查询变差 | 原问题始终保留为一路 |
| 按条裁剪历史 | 400:tool 消息没有对应 tool_calls | 按轮裁剪 |
| 多次压缩叠出多段摘要 | 上下文越来越乱 | 旧摘要一起总结 |
| 记忆查询忘了 user_id | 串号 | 所有记忆 SQL 带 user_id,写测试 |
| 只看总分 | 口语类 0.33 被掩盖 | 按类型拆分 |
| LLM 裁判把礼貌用语判为无依据 | 忠实率低得离谱 | 裁判 prompt 写清判断标准,人工抽查 |
| `outside_bbox` 去表格区域 | 表格上方的正文被截断 | 按字符中心点判断是否在表格内 |
| 无边框表格 | pdfplumber 识别不出,变成散乱数字 | 调 table_settings 或换 MinerU/Docling |
| 清理工具结果时连 tool_calls 一起删 | 400 报错 | 只换旧 tool 消息的 content |
| 什么都开子 Agent | token 成本暴涨 | 只给探索量大、结论短的任务 |

## 动手练习

1. 按「跑起来」一节的顺序完整跑一遍,所有脚本无报错。
2. 跑 `calibrate_threshold.py`,根据两组分数定 `MIN_RERANK_SCORE`,写进 `.env`,说明你的理由。
3. 用 `docqa.py` 完成上面那段 6 轮对话,截图或复制保存。逐轮记录:改写成了什么、检索到了哪几块、有没有被阈值拦住、引用是否正确。
4. 填完「项目分数」表,写好项目说明。
5. 给评估集补 10 条新问题,其中至少 3 条无答案、2 条多轮追问(多轮的可以先只记录问题和期望,W5 会讲多轮评估怎么做)。
6. (选做)在 `docqa.py` 里接入 Day 20 的长期记忆:会话结束时调用 `remember`,新会话开始时把 `recall` 的结果放进 system prompt。

**验收标准:** 完整流程跑通;阈值有数据依据;6 轮对话的每一轮行为符合预期,或者你能解释为什么不符合;项目说明里有至少三个具体数字;面试题清单里 1–12 题和 15、16 题每题都能讲两分钟。

## 名词解释

本周的核心术语汇总,每个都应该能用一句话解释:

| 名词 | 意思 |
| --- | --- |
| embedding | 把文字变成向量,意思近的文字向量方向近(Day 15) |
| 余弦相似度 | 两个向量夹角的余弦,归一化后等于点积(Day 15) |
| RAG | 先检索资料再让模型依据资料回答(Day 16) |
| chunk | 切块后的检索单位,块前加标题上下文(Day 16) |
| pgvector / HNSW | Postgres 向量扩展 / 分层图近似最近邻索引(Day 17) |
| ef_search | HNSW 查询候选数,决定召回和速度(Day 17) |
| BM25 | 基于词频、IDF、长度归一化的关键词打分(Day 18) |
| RRF | 按名次融合多路检索结果(Day 18) |
| rerank / cross-encoder | 问题和文档一起打分的精排模型(Day 18) |
| hit@k / recall@k / MRR | 检索评估指标(Day 19) |
| 忠实度 | 回答是否都有资料依据(Day 19) |
| 上下文工程 | 管理每次调用时窗口里放什么(Day 20) |
| 压缩(compaction) | 旧对话总结成摘要(Day 20) |
| 长期记忆 | 跨会话保存的用户信息(Day 20) |
| Agentic RAG | 检索作为工具,由 Agent 决定何时使用(Day 20) |
| 引用校验 | 检查回答引用的 id 是否来自本轮资料(Day 21) |

## 常见误区

**把这周学的技巧全部堆上去。** 改写、多路查询、HyDE、contextual retrieval、Agentic RAG,每一个都增加延迟和成本。只加评估数据证明有用的。今天的项目里,改写只在有历史时开启,就是这个考虑。

**项目说明只写技术栈。** 「使用 RAG、pgvector、BM25」没有区分度。写清楚你解决了什么问题、怎么验证的、数字是多少。

**觉得 30 条评估集分数高就万事大吉。** 30 条只能发现大问题。上线后真实用户的问法会远远超出你的想象,评估集要持续从线上补充。

**复习只看不讲。** 面试是讲出来的。对着面试题清单,至少录一次音或者讲给朋友听,你会发现很多「我懂」其实讲不清楚。

**跳过踩坑清单。** 面试官很喜欢问「你遇到过什么坑」,真实踩过的坑加上你的解决办法,是最有说服力的经验证明。

## 学习资料

### 文档与文章

- 本周所有文章的「学习资料」里,如果有读到一半的,今天补完。最值得精读的三篇:[Anthropic · Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval)、[Anthropic · Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)、[Jason Liu · Systematically Improving Your RAG](https://jxnl.co/writing/2024/05/22/systematically-improving-your-rag/)。
- [pgvector README](https://github.com/pgvector/pgvector) 的 Filtering 和 Iterative Index Scans 两节,面试前再看一遍。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1zeMD6hEab&autoplay=0&high_quality=1" title="【中文配音】吴恩达RAG检索增强生成|从检索到生产落地完整课" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>名校课程-顶级中配 · 【中文配音】吴恩达RAG检索增强生成|从检索到生产落地完整课 · 48 集。今天用它做系统复习:第 17–31 集(信息检索、BM25、嵌入、向量库、ANN、分块、混合检索、重排序、查询解析、元数据过滤)对应 Day 15–18;第 33–39 集(评估、幻觉)对应 Day 19;第 47 集是 Agentic RAG。第 40–46 集讲生产环境的成本、延迟、监控、安全,W6 再看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1JLN2z4EZQ&autoplay=0&high_quality=1" title="RAG 工作机制详解——一个高质量知识库背后的技术全流程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>马克的技术工作坊 · RAG 工作机制详解——一个高质量知识库背后的技术全流程 · Day 16 看过的这个视频今天再看一遍,你会发现每一步都能对上自己写过的代码,这就是一周的进步。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/sVcwVQRHIc8" title="Learn RAG From Scratch – Python AI Tutorial from a LangChain Engineer" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>freeCodeCamp.org · Learn RAG From Scratch – Python AI Tutorial from a LangChain Engineer · 2.5 小时。LangChain 工程师用框架实现了本周几乎所有技巧(multi-query、RAG-Fusion、HyDE、路由、索引策略)。你已经手写过一遍了,看框架版会很快,而且 W4 要开始用框架,正好过渡。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 6 章「RAG and Agents」:本周的内容在这一章都有系统的论述,今天通读 RAG 部分,作为一周的总结,约 2 小时。
- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly,2024)第 8 章;中文版《图解大模型:生成式AI原理与实践》(人民邮电出版社图灵,2025)。没看过的今天补上,图很多,一小时能看完。

### 开源项目与代码

- [langchain-ai/rag-from-scratch](https://github.com/langchain-ai/rag-from-scratch):上面那个视频的配套 notebook。
- [datawhalechina/llm-universe](https://github.com/datawhalechina/llm-universe):中文的个人知识库项目,和你今天的项目对比一下架构差异。
- [datawhalechina/hello-agents](https://github.com/datawhalechina/hello-agents):为 W4 预热,翻一下目录。

## 自测

**1. 你的文档问答 Agent 一轮对话依次经过哪些步骤?哪一步是为了省钱?**

<details><summary>答案</summary>

压缩历史 → 改写查询(有历史时)→ 向量 + BM25 多路召回 → RRF 融合 → rerank → 低于阈值直接拒答 → 拼 prompt 生成 → 引用校验 → 更新历史。rerank 低分直接拒答这一步不调用生成模型,省钱也避免编造;历史压缩控制输入 token,也是在省钱。

</details>

**2. 为什么检索资料不存进对话历史?**

<details><summary>答案</summary>

资料每轮按当前问题重新检索。如果把旧资料存进历史,上下文会被迅速占满,成本上升;旧资料和当前问题可能无关,会干扰回答,还会让模型引用过期的块 id。历史只保存问答文本,信息量足够做改写和理解上下文。

</details>

**3. 拒答阈值怎么定?为什么建议宁可偏低?**

<details><summary>答案</summary>

用评估集里有答案和无答案两类问题的 rerank 最高分分布来定,阈值放在两组之间。两组重叠时偏低设置,只拦住明显无关的问题,避免把能回答的问题误拒;剩下的由 prompt 里「资料不足就说不知道」兜底,两道防线。

</details>

**4. 引用校验发现回答里有一个不在本轮资料中的 id,可能是什么原因?**

<details><summary>答案</summary>

模型编造了引用(比如把 kb-002#1 写成 kb-002#4);或者历史里有上一轮的回答带了旧 id,模型照抄了;或者模型用了自己的常识但套了一个看起来合理的 id。处理:标注提醒人工核对,统计这类事件的频率作为监控指标,必要时加强 prompt 或在后处理中删除无效引用。

</details>

**5. 你的项目说明里写「口语类 hit@1 从 0.33 提升到 X」。面试官追问「这个数字可信吗」,你怎么回答?**

<details><summary>答案</summary>

如实说明评估集的规模和构成:口语类只有 6 条,一条就是 17 个百分点,所以这个数字能说明方向,不能说明精确幅度;说明评估集怎么来的(按真实用户说法编写)、检索指标是规则计算没有主观性;再说后续计划:从线上日志补充口语类问题扩大样本。主动说出局限,比硬撑数字更让人信服。

</details>

**6.(面试题)如果让你把这个文档问答 Agent 上线给真实客户用,还缺哪些东西?**

<details><summary>答案</summary>

服务化(HTTP 接口、流式输出、并发、会话存储,W6);可观测(每一步的 trace、延迟、token 和成本、用户反馈,W5);安全(prompt injection 防护、知识库内容审核、按租户和权限过滤,W6);评估体系(更大的评估集、CI 回归门禁、线上抽样评估,W5);运营(知识库更新流程、bad case 回流、转人工的交接);成本控制(prompt caching、模型路由)。能按「服务、观测、安全、评估、运营、成本」分类回答,说明有完整的工程视角。

</details>

## 明天预告

Day 22 · MCP 是什么:为什么大家都在接 MCP,协议里有什么。W3 解决了「让 Agent 读懂文档」,但客服还要查订单、查账单、发起退款,这些数据在业务系统里。W4 从 MCP 开始:一个让 Agent 用统一方式接入各种工具和数据源的开放协议。明天先搞清楚它解决什么问题、host/client/server 三个角色、tools/resources/prompts 三种能力,以及它和 W2 学的 function calling 到底是什么关系。
