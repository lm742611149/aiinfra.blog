---
title: 'Day 265 · 第 38 周复习:RAG 与上下文(Day 259–264)'
description: '这一周前三天把 RAG 评估做完整(检索评估、生成评估、做实验),后三天开始做上下文工程(预算、压缩、记忆)。今天画知识地图、逐天回顾,然后用 Day 261 的实验方法去量 Day 262 到 264 的手段:同一段 78 条的长对话,按轮裁、清工具结果、总结压缩、长期记忆,哪种还记得客户早先说过的话。按轮裁 0/6,总结压缩和长期记忆 6/6,输入 token 少 60% 到 85%。'
pubDate: 2026-10-23
regime: none
tags: ['review', 'rag-evaluation', 'context-engineering', 'python', 'agent-zero']
series: 'agent-zero'
day: 265
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 264](/blog/agent-zero/day-264-memory-short-long/) 把「记忆」拆成两种:短期记忆是同一个会话的 `messages`,按 `thread_id` 存取;长期记忆跨会话,存进 Postgres 的 `user_memories` 表,有抽取、去重、召回、删除四个动作。实测里最扎心的一条是向量相似度分不开「说法不同的同一件事」和「事不同」(两个都是 0.894),所以去重要请模型当裁判。

这是第 38 周的最后一天。这一周的两段内容看起来是两件事:前三天在给 RAG 造评估的尺子和实验流程,后三天在管「放进窗口里的东西」。但它们其实是接着的,Day 261 里「k 从 4 改成 8,输入 token 多了 46%」那句话,就是 Day 262 的开头。今天把两段焊在一起:拿前三天的实验方法,去量后三天的手段到底有没有用。

## 今天要解决的问题

1. 能对着一张图说出本周六天各干了什么,以及评估和上下文两段是怎么接上的。
2. 不看文章默写出两段核心代码并跑通:Day 262 的 `split_turns`、`trim_by_turn`、`check_pairs`,和 Day 264 的 `recall`。
3. 完成一个只用本周知识的小项目 `part04/review38_experiment.py`:同一段 78 条的长对话、两道只有最早几轮才答得出的题,比较「按轮裁、清工具结果加按轮裁、总结压缩、长期记忆加按轮裁」和「全塞」,按 Day 261 的纪律先测噪声、再记日志、再看变对变错。
4. 能解释这次实验里三个容易看错的地方:同样的输入 token,两次花的钱差一倍多(缓存);清理工具结果几乎没省(预算是定死的);总结压缩最贵(每次都重新压了一遍)。

预计用时 3 小时。花费约 ¥0.07:小项目一次完整运行 6 组合计 ¥0.0675(0.0130 + 0.0053 + 0.0079 + 0.0079 + 0.0225 + 0.0109),写记忆一次 ¥0.0023;练习 4 只用硅基流动的免费 embedding,其余练习不调大模型。价格按 2026 年 10 月 [DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)查到的高峰价:deepseek-flash 输入缓存命中 0.04 元、未命中 2 元、输出 8 元每百万 token。

前置:本周的 [Day 259](/blog/agent-zero/day-259-rag-eval-4/) 到 [Day 264](/blog/agent-zero/day-264-memory-short-long/)。小项目要用到 Day 262 的 `ctx_blocks.py`(`make_history`)、`ctx_budget.py`、`trim_turns.py`,Day 263 的 `convo.py`、`tool_clearing.py`、`compaction.py`,Day 264 的 `memory_store.py`、`pg_store.py`、`session_store.py`;Postgres.app 要开着,`.env` 里 `PG_DSN` 指向你自己的库。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。复习日的默写特别重要,练习 1、2、4 请真的合上文章写。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="第 38 周知识地图:上排 RAG 评估三天,检索评估脚本、生成评估用大模型当裁判、做实验和 RAGAS;下排上下文工程三天,预算、压缩、记忆;上排实验里 k 从 4 改成 8 输入 token 多 46% 的发现引出下排,今天的小项目用上排的实验方法去量下排的手段">
<rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)"/>
<defs><marker id="rv265a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--ink-soft)"/></marker></defs>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink-soft)">RAG 评估:造尺子,做实验</text>
<rect x="20" y="38" width="180" height="60" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="110" y="60" fill="var(--ink)" text-anchor="middle">259 检索评估脚本</text>
<text x="110" y="80" fill="var(--ink-soft)" text-anchor="middle" font-size="11">hit@1 recall MRR;失败清单</text>
<line x1="200" y1="68" x2="228" y2="68" stroke="var(--ink-soft)" marker-end="url(#rv265a)"/>
<rect x="230" y="38" width="180" height="60" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="60" fill="var(--ink)" text-anchor="middle">260 生成评估</text>
<text x="320" y="80" fill="var(--ink-soft)" text-anchor="middle" font-size="11">三个裁判:忠实 完整 拒答</text>
<line x1="410" y1="68" x2="438" y2="68" stroke="var(--ink-soft)" marker-end="url(#rv265a)"/>
<rect x="440" y="38" width="180" height="60" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="530" y="60" fill="var(--ink)" text-anchor="middle">261 做实验</text>
<text x="530" y="80" fill="var(--ink-soft)" text-anchor="middle" font-size="11">测噪声;改一处;日志;RAGAS</text>
<text x="320" y="136" fill="var(--ink-faint)" text-anchor="middle" font-size="11">k=8 多 46% 输入 token,窗口里到底该放什么?</text>
<line x1="530" y1="98" x2="530" y2="116" stroke="var(--ink-soft)"/>
<line x1="530" y1="116" x2="110" y2="116" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
<line x1="110" y1="116" x2="110" y2="172" stroke="var(--ink-soft)" stroke-dasharray="4 3" marker-end="url(#rv265a)"/>
<text x="20" y="166" fill="var(--ink-soft)">上下文工程:管窗口里的东西</text>
<rect x="20" y="178" width="180" height="60" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="110" y="200" fill="var(--ink)" text-anchor="middle">262 预算</text>
<text x="110" y="220" fill="var(--ink-soft)" text-anchor="middle" font-size="11">六块上限;按轮裁</text>
<line x1="200" y1="208" x2="228" y2="208" stroke="var(--ink-soft)" marker-end="url(#rv265a)"/>
<rect x="230" y="178" width="180" height="60" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="200" fill="var(--ink)" text-anchor="middle">263 压缩</text>
<text x="320" y="220" fill="var(--ink-soft)" text-anchor="middle" font-size="11">清工具结果;总结</text>
<line x1="410" y1="208" x2="438" y2="208" stroke="var(--ink-soft)" marker-end="url(#rv265a)"/>
<rect x="440" y="178" width="180" height="60" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="530" y="200" fill="var(--ink)" text-anchor="middle">264 记忆</text>
<text x="530" y="220" fill="var(--ink-soft)" text-anchor="middle" font-size="11">短期;长期;串号;投毒</text>
<line x1="320" y1="238" x2="320" y2="268" stroke="var(--ink-soft)" marker-end="url(#rv265a)"/>
<rect x="140" y="270" width="360" height="44" rx="4" fill="none" stroke="var(--rule)"/>
<text x="320" y="290" fill="var(--ink)" text-anchor="middle">今天:用上排的实验方法,量下排的手段</text>
<text x="320" y="306" fill="var(--ink-soft)" text-anchor="middle" font-size="11">review38_experiment.py</text>
</g>
</svg>
<figcaption>本周六天。上排是评估,把「好不好」变成能反复跑的数字;下排是上下文工程,管模型每次调用时能看到什么。虚线是 Day 261 到 Day 262 的接口:做实验时看到 k 变大输入 token 变多,才有了「窗口里该放什么」这个问题。今天的小项目把两排接在一起。</figcaption>
</figure>

图里最该记住的是那条虚线。评估这三天让你有能力说「这个改动让 q17 变对了,代价是输入多了 46%」,上下文这三天给你一批改动可以试:裁、压、记。两边缺一边都不行,只有手段没有尺子,你不知道哪个手段有用;只有尺子没有手段,你只能量不能改。

## 本周每天一句话

- [Day 259 · RAG 评估(四):检索评估脚本](/blog/agent-zero/day-259-rag-eval-4/):`eval_retrieval.py` 把 26 道有答案的题、四种检索方式一次跑完,按题型拆开。hit@1 向量 1.000、混合 0.923、混合加 rerank 0.923、BM25 0.846;BM25 的口语题只有 0.333。不报错的坑:只取 4 块再去重,22 道题凑不够 4 篇文章,一句两问的 q26 被冤枉成 recall 0.5。
- [Day 260 · RAG 评估(五):生成评估](/blog/agent-zero/day-260-rag-eval-5/):三个裁判各判一件事,忠实、完整、拒答,每个只回答是或否。30 道题 86 次调用约七分钱,结果忠实 26/26、完整 24/26、拒答 4/4。判「不完整」的两道题,打开明细里的 `chunks` 一看都是检索的锅:q26 是讲编码的 kb-011 整篇没被检索到,q17 是写着退款规则的那几块没进前 4 块。
- [Day 261 · RAG 评估(六):用评估集做实验](/blog/agent-zero/day-261-rag-eval-6/):实验四条纪律,先测噪声、一次只改一个变量、记日志、看失败清单。原样跑两次基线,总分一样,回答措辞却有 16 道不同;只把 k 从 4 改成 8,q17 变对,输入 token 多 46%。RAGAS 0.4.3 的 `context_recall` 能抓到 q17,它的 `faithfulness` 比我们的裁判严得多,同一题五次在 0.25 和 0.8 之间跳。
- [Day 262 · 上下文工程(一):窗口大不等于该塞满,做预算](/blog/agent-zero/day-262-context-budget/):2.8 万 token 里找一条公告 15 次全对,让它数有几条错 15% 到 26%。一次调用拆成六块,每块定上限出预算表;历史超了要按「轮」裁,按条裁会留下孤零零的 `tool` 消息,接口直接返回 400;最后和 API 返回的 `prompt_tokens` 对账差 4.3%。
- [Day 263 · 上下文工程(二):压缩](/blog/agent-zero/day-263-compaction/):三档手段按代价排。清理旧工具结果不花钱,24 轮历史从 3176 降到 2078 token;总结压缩要一次调用,16 条消息压成 5 条。用七条事实给摘要打分,旧课里「随手总结会丢年付」的结论在 deepseek-flash 上没复现。
- [Day 264 · 上下文工程(三):短期记忆和长期记忆](/blog/agent-zero/day-264-memory-short-long/):抽取、去重、召回、删除四个动作。去重靠模型裁判而不是相似度阈值;召回距离上限定 0.5;SQL 里漏掉 `WHERE user_id` 不报错只串号;用户编的权限和折扣不能被记成事实;写记忆放在会话结束后,一次要 1.6 到 4.0 秒。

## 本周小项目:用实验的办法量上下文的手段

先说问题。Day 263 的结论是「清旧工具结果够用就别总结」,Day 264 的结论是「跨会话要靠长期记忆」。这些话当时是在各自的小例子上说的,没有放在同一场比赛里比过。今天比一次,而且按 Day 261 的纪律来:

- **先测噪声。** 基线(全塞)原样跑两次,看两次差多少。
- **一次只改一个变量。** 变量只有一个:怎么处理那 78 条历史。系统提示词、问题、`temperature=0` 全都一样。
- **记日志。** 每种办法一行 JSON 追加进 `out/review38.jsonl`,和基线比,看变对了哪些、变错了哪些。
- **看失败清单。** 不只是答对几个,还要看是哪一道、第几次。

场景是 Day 263 的客服对话:客户在最早的四轮里说清了身份(星河记账,年付企业版,10 个席位,招商银行流水导入报 E1043),后面接了 24 轮不相干的确认(`make_history(24)`,每三轮里有一轮调了工具,带一大块工具结果)。一共 78 条消息,按 Day 262 的分词器数是 3865 token,其中最早四轮占 689。然后问两道只有最早四轮才答得出的题:「我们现在是什么套餐来着?几个席位?」和「我最开始是哪个报错码来着?」。每道题每种办法跑 3 次。

五种办法对应本周学的东西:

| 名字 | 做法 | 来自 |
| --- | --- | --- |
| 全塞 | 78 条原样发,当基线 | 没有处理 |
| 按轮裁 | `trim_by_turn`,历史最多留 1500 token | Day 262 |
| 清工具结果+按轮裁 | 先 `clear_old_tool_results`(留最近 2 个),再按轮裁 | Day 263 + 262 |
| 总结压缩 | `compact`,留最近 3 轮原文,更早的总结成一条摘要 | Day 263 |
| 长期记忆+按轮裁 | 会话结束后把早期对话写进 `user_memories`,提问时 `recall` 召回,历史照样按轮裁 | Day 264 + 262 |

新建 `part04/review38_experiment.py`:

```python
# agent-zero-lab/part04/review38_experiment.py  第 38 周小项目:一次实验,五种处理长对话历史的办法,哪种还记得客户早先说过的话
import json
import re
import time
from pathlib import Path
from typing import Any

import psycopg

from common.llm import LLMClient
from part04.compaction import compact
from part04.convo import CONVO, SYSTEM_LINE
from part04.ctx_blocks import make_history
from part04.memory_store import forget, init, recall, remember
from part04.pg_store import connect
from part04.tool_clearing import clear_old_tool_results
from part04.trim_turns import check_pairs, trim_by_turn

LOG = Path("out/review38.jsonl")
USER_ID = "u-review38"
BUDGET = 1500   # 历史最多留多少 token(Day 262 的预算)
RUNS = 3        # 每道题每种办法跑几次(Day 261:有一步调模型,就别只看一次)

# 两道只有最早那四轮才答得出的题,各配一条判分规则
PROBES = {
    "plan": ("对了,我们现在是什么套餐来着?几个席位?", [r"年付", r"企业", r"10"]),
    "code": ("我最开始是哪个报错码来着?", [r"E1043"]),
}
HISTORY = [*CONVO, *make_history(24)]  # 四轮早期对话 + 24 轮不相干的确认,共 78 条


def passed(answer: str, patterns: list[str]) -> bool:
    return all(re.search(p, answer) for p in patterns)


def build(strategy: str, client: LLMClient, memories: list[str]) -> list[dict[str, Any]]:
    """五种办法:把 78 条历史处理成真正要发的 messages(不含最后那条问题)。"""
    system = [{"role": "system", "content": SYSTEM_LINE}]
    if strategy == "全塞":
        return [*system, *HISTORY]
    if strategy == "按轮裁":
        return [*system, *trim_by_turn(HISTORY, BUDGET)]
    if strategy == "清工具结果+按轮裁":
        return [*system, *trim_by_turn(clear_old_tool_results(HISTORY, keep_recent=2), BUDGET)]
    if strategy == "总结压缩":
        return compact(client, [*system, *HISTORY], keep_last_turns=3, trigger_tokens=BUDGET)
    if strategy == "长期记忆+按轮裁":
        note = "【关于这位客户的记忆】\n" + "\n".join(f"- {m}" for m in memories)
        return [{"role": "system", "content": SYSTEM_LINE + "\n\n" + note}, *trim_by_turn(HISTORY, BUDGET)]
    raise ValueError(strategy)


def run_strategy(conn: psycopg.Connection, name: str, strategy: str) -> dict[str, Any]:
    client = LLMClient()  # 一种办法一个客户端,账本分开
    start = time.perf_counter()
    failed: list[str] = []
    tokens: list[int] = []
    for pid, (question, patterns) in PROBES.items():
        memories = recall(conn, USER_ID, question) if strategy == "长期记忆+按轮裁" else []
        for n in range(RUNS):
            messages = build(strategy, client, memories)
            assert check_pairs(messages[1:]) is None, "历史被拆坏了"
            answer = client.chat([*messages, {"role": "user", "content": question}], temperature=0)
            tokens.append(answer.prompt_tokens)
            if not passed(answer.content, patterns):
                failed.append(f"{pid}-{n}")
    total = len(PROBES) * RUNS
    return {"name": name, "strategy": strategy, "right": total - len(failed), "total": total, "failed": failed,
            "avg_input_tokens": round(sum(tokens) / len(tokens)), "calls": client.ledger.calls,
            "cost": round(client.ledger.cost, 4), "seconds": round(time.perf_counter() - start, 1)}


if __name__ == "__main__":
    conn = connect()
    init(conn)
    forget(conn, USER_ID)
    writer = LLMClient()
    for line in remember(conn, writer, USER_ID, CONVO):  # 会话结束后写一次长期记忆(Day 264),这笔钱单独记
        print("写入记忆:", line)
    print(f"写记忆花了 {writer.ledger}\n")

    plan = [("baseline-1", "全塞"), ("baseline-2", "全塞"), ("trim", "按轮裁"), ("clear+trim", "清工具结果+按轮裁"),
            ("compact", "总结压缩"), ("memory+trim", "长期记忆+按轮裁")]
    results: list[dict[str, Any]] = []
    for name, strategy in plan:
        entry = run_strategy(conn, name, strategy)
        results.append(entry)
        LOG.parent.mkdir(exist_ok=True)
        with LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        print(f"{name:<12} 答对 {entry['right']}/{entry['total']}  平均输入 {entry['avg_input_tokens']:>5} token  "
              f"{entry['calls']:>2} 次调用  ¥{entry['cost']:.4f}  答错 {entry['failed']}")

    base = results[1]
    print(f"\n和 baseline-2 比(输入 token {base['avg_input_tokens']}):")
    for e in results[2:]:
        saved = 1 - e["avg_input_tokens"] / base["avg_input_tokens"]
        now_ok = sorted(set(base["failed"]) - set(e["failed"]))
        now_bad = sorted(set(e["failed"]) - set(base["failed"]))
        print(f"  {e['name']:<12} 输入 token 少 {saved:.0%}  变对 {now_ok}  变错 {now_bad}")
    forget(conn, USER_ID)
```

<div class="line-notes">

- `from part04.compaction import compact` Day 263 写的总结压缩,`compact(client, messages, keep_last_turns, trigger_tokens)`,总量没超 `trigger_tokens` 就原样返回。
- `from part04.convo import CONVO, SYSTEM_LINE` Day 263 手写的四轮客服对话,14 条消息(前三轮各带一次工具调用,第四轮没有),`SYSTEM_LINE` 是一句「你是云簿 CloudLedger 的客服助手。」
- `from part04.ctx_blocks import make_history` Day 262 造历史的函数,`make_history(24)` 是 64 条:24 个 user、24 个 assistant、8 组工具调用(每组 2 条)。
- `from part04.memory_store import forget, init, recall, remember` Day 264 的四个函数,这一周两头(压缩和记忆)的东西今天同时用上。
- `from part04.pg_store import connect` 连 `.env` 里 `PG_DSN` 指向的库。我是单独新建的库,跑完删掉。
- `from part04.trim_turns import check_pairs, trim_by_turn` Day 262 的按轮裁和成对检查,`check_pairs` 在下面当断言用。
- `LOG = Path("out/review38.jsonl")` 实验日志。JSONL 一行一个实验,追加写,和 Day 261 的 `experiments.jsonl` 一样。
- `BUDGET = 1500` 历史最多留多少 token。总历史 3865,所以按轮裁一定要丢东西,而且丢的是最前面的。
- `RUNS = 3` 每道题每种办法跑 3 次。Day 261 的教训:`temperature=0` 也不保证两次一样,流程里只要有一步调模型,就别只看一次。
- `PROBES = {` 两道题,字典的键是题的代号,值是 (问题, 判分正则列表)。
- `"plan": ("对了,我们现在是什么套餐来着?几个席位?", [r"年付", r"企业", r"10"]),` 回答里「年付」「企业」「10」三个都要出现才算对。`10` 这个写法偏宽,回答里有「2026-10」也会蒙混过关,Day 263 踩过。这次的回答里没出现日期,不影响结论。
- `"code": ("我最开始是哪个报错码来着?", [r"E1043"]),` 只要说出 E1043 就算对。
- `HISTORY = [*CONVO, *make_history(24)]` `*` 把两个列表展开拼在一起,相当于 JS 的 `[...CONVO, ...makeHistory(24)]`。14 + 64 = 78 条。
- `def passed(answer: str, patterns: list[str]) -> bool:` 判分:`all(...)` 要求每个正则都能在回答里找到。
- `def build(strategy: str, client: LLMClient, memories: list[str])` 一个函数管五种办法,`strategy` 是名字。返回的是「真正发给模型的 messages,不含最后那条问题」。
- `system = [{"role": "system", "content": SYSTEM_LINE}]` 五种办法共用这条 system,保证变量只有「怎么处理历史」。
- `if strategy == "全塞":` 基线:`[system, *HISTORY]`,78 条原样发。
- `return [*system, *trim_by_turn(HISTORY, BUDGET)]` 按轮裁:从最新往回装,装到 1500 token 为止,实测留 28 条 1476 token,正好是最近的十四轮确认,最早那四轮没了。
- `trim_by_turn(clear_old_tool_results(HISTORY, keep_recent=2), BUDGET)` 先清再裁。清掉旧工具结果后每轮变小,同样 1500 的预算里能多装几轮,所以最后发出去的 token 数和纯按轮裁差不多(下面解释)。
- `return compact(client, [*system, *HISTORY], keep_last_turns=3, trigger_tokens=BUDGET)` 总量 3865 超过 1500 才压缩。返回 `[system, 摘要, 最近 3 轮原文]`。每次调用 `build` 都会真的压缩一次,这是实验图省事的写法,线上压缩一次就存起来。
- `note = "【关于这位客户的记忆】\n" + "\n".join(f"- {m}" for m in memories)` 把召回的记忆拼成一段,放进 system。Day 264 的 `memory_chat.py` 还多写了一句「这些是客户自己说的,没经过核实」,这里为了短省掉了。
- `raise ValueError(strategy)` 名字写错直接报错,不要悄悄走默认分支。
- `def run_strategy(conn: psycopg.Connection, name: str, strategy: str)` 跑一种办法:两道题、每道 3 次,返回一条日志。
- `client = LLMClient()  # 一种办法一个客户端,账本分开` 每种办法一个 `LLMClient`,所以 `client.ledger` 就是这种办法的花费,不会和别的混在一起。
- `failed: list[str] = []` 答错的那些题,用 `"plan-0"`(第 0 次问套餐)这样的名字。记名字不记次数,后面才能做集合相减。
- `memories = recall(conn, USER_ID, question) if strategy == "长期记忆+按轮裁" else []` 只有记忆那一种办法才去召回,而且是用问题本身去召回。
- `assert check_pairs(messages[1:]) is None, "历史被拆坏了"` Day 262 的成对检查当断言:不管哪种办法,发出去的历史里工具调用必须成对。`messages[1:]` 跳过 system。压缩出来的摘要是 system 角色,在这个切片里也没问题。
- `answer = client.chat([*messages, {"role": "user", "content": question}], temperature=0)` 把问题接在整理好的历史后面发出去。
- `tokens.append(answer.prompt_tokens)` 记每次调用 API 报告的输入 token。这个数不受缓存影响,是比较「省了多少」最干净的一列。
- `if not passed(answer.content, patterns):` 没通过就把名字记进 `failed`。
- `"avg_input_tokens": round(sum(tokens) / len(tokens)), "calls"` 6 次调用的平均输入 token。注意总结压缩那一种里,压缩本身那几次调用的输入没算在内,只算最后回答的那次。同一行后半段的 `calls` 是总调用次数,总结压缩是 12(6 次压缩加 6 次回答),别的是 6。
- `"cost": round(client.ledger.cost, 4),` 钱。这一列有缓存的影响,下面专门讲。
- `conn = connect()` 以下是主流程,只有直接运行时才执行。
- `forget(conn, USER_ID)` 清场,每次从空表开始。
- `for line in remember(conn, writer, USER_ID, CONVO):` Day 264 的 `remember`:会话结束后,把早期那四轮抽成记忆写进表。实测写入 6 条(3 条 profile、3 条 event),花了 1 次调用 ¥0.0023。这笔钱不算在记忆那一种办法里,因为它是会话结束后一次性的。
- `plan = [("baseline-1", "全塞"), ("baseline-2", "全塞"), ` 六次运行,基线跑两次测噪声。名字是日志里的名字,策略是上面 `build` 认的名字。
- `with LOG.open("a", encoding="utf-8") as f:` `"a"` 追加。每跑完一种办法立刻写一行,中途挂了也不丢前面的。
- `base = results[1]` 和第二次基线比,不和第一次比(第一次的缓存是冷的,下面会看到钱差很多;token 数两次一样)。
- `saved = 1 - e["avg_input_tokens"] / base["avg_input_tokens"]` 比基线少了几成输入 token。
- `now_ok = sorted(set(base["failed"]) - set(e["failed"]))` Day 261 的写法:基线答错、这次答对的,是「变对了」。
- `now_bad = sorted(set(e["failed"]) - set(base["failed"]))` 反过来是「变错了」。这一行比总分重要。
- `forget(conn, USER_ID)` 跑完把测试数据删掉。

</div>

在 `agent-zero-lab/` 下跑:

```bash
uv run python -m part04.review38_experiment
```

```text
写入记忆: 新增[profile]: 公司名称：星河记账
写入记忆: 新增[profile]: 使用年付企业版，10 个席位
写入记忆: 新增[profile]: 使用招商银行流水导入
写入记忆: 新增[event]: 2026-10 前后导入招商银行流水持续报 E1043，改用 XLSX 后仍报错，尚未解决
写入记忆: 新增[event]: 曾咨询将席位从 10 个增加到 15 个的补差价方式
写入记忆: 新增[event]: 考虑下个月起降级到专业版，咨询过年付退款比例，但明确表示先不提交退款申请
写记忆花了 1 次调用 | 输入 498 / 输出 163 tokens | 约 ¥0.0023

baseline-1   答对 6/6  平均输入  4222 token   6 次调用  ¥0.0130  答错 []
baseline-2   答对 6/6  平均输入  4222 token   6 次调用  ¥0.0053  答错 []
trim         答对 0/6  平均输入  1630 token   6 次调用  ¥0.0079  答错 ['plan-0', 'plan-1', 'plan-2', 'code-0', 'code-1', 'code-2']
clear+trim   答对 0/6  平均输入  1612 token   6 次调用  ¥0.0079  答错 ['plan-0', 'plan-1', 'plan-2', 'code-0', 'code-1', 'code-2']
compact      答对 6/6  平均输入   616 token  12 次调用  ¥0.0225  答错 []
memory+trim  答对 6/6  平均输入  1690 token   6 次调用  ¥0.0109  答错 []

和 baseline-2 比(输入 token 4222):
  trim         输入 token 少 61%  变对 []  变错 ['code-0', 'code-1', 'code-2', 'plan-0', 'plan-1', 'plan-2']
  clear+trim   输入 token 少 62%  变对 []  变错 ['code-0', 'code-1', 'code-2', 'plan-0', 'plan-1', 'plan-2']
  compact      输入 token 少 85%  变对 []  变错 []
  memory+trim  输入 token 少 60%  变对 []  变错 []
```

先看噪声。两次基线一样,都是 6/6,平均输入 4222 token。答案这一列稳,钱那一列却是 ¥0.0130 和 ¥0.0053,差了一倍多。

**钱差一倍多是缓存。** DeepSeek 的前缀缓存会把相同的开头记下来,命中的输入按 0.04 元每百万 token 算,没命中的按 2 元。第一次基线跑的时候这 4222 token 的前缀是冷的,只有后几次才命中;第二次基线时前缀已经热了,六次基本全命中。token 数一样,单价差了 50 倍,所以钱就差了。Day 263 练习 3 讲过缓存,这里是它在一个真实实验里冒头:**比较「省了多少」,看 `avg_input_tokens` 这一列;`cost` 这一列受缓存影响,别拿来直接比。**

再看五种办法:

**按轮裁 0/6,而且是 6 次全错。** 输入从 4222 降到 1630,少了 61%,可是 `plan` 和 `code` 两道题 3 次全答错。原因不用猜:最早那四轮在 78 条里排最前面,按轮裁从最新往回装,装到 1500 就停,它们早就在界外了。模型手里没有这条信息,答错是应该的。它省的 token 是真的,丢的也是真的。

**清工具结果加按轮裁也是 0/6,输入只比纯按轮裁少 18 个 token(1612 对 1630)。** 这个结果乍一看奇怪:清掉旧工具结果不是能省一大截吗?省是省了,可预算是定死的 1500。工具结果换成一行占位以后,每一轮变小,同样的 1500 里就能多装几轮最近的确认,正好把省出来的地方填满。**预算固定时,压缩只会让你多留几轮「也没用」的近期历史,留不住更早的。** 要让早期信息留住,得让预算跟着变大,或者换一条路。

**总结压缩 6/6,输入只剩 616 token,比基线少 85%。** 压缩把前 25 轮总结成一条摘要,最近 3 轮原文,总共才 600 多 token,却保住了「年付企业版 10 席位」和「E1043」。代价在调用次数和钱上:12 次调用,¥0.0225 是六组里最高的。这里要小心读:实验为了每次独立,把压缩重复做了 6 次,每次都要把 3865 token 的历史读一遍写成摘要。线上的做法是压缩一次、把摘要存回会话,后面每一轮都在 616 token 的短历史上问,压缩那一次的钱几轮就摊回来了(Day 263 练习 3 算过几步回本)。

**长期记忆加按轮裁 6/6,输入 1690 token,比基线少 60%,只花 6 次调用 ¥0.0109。** 它和按轮裁的历史一模一样(1500 预算,早期四轮同样不在了),区别只是 system 里多了几行召回的记忆,大约 60 个 token。两道题都答对,因为答案在记忆里:profile 里有「使用年付企业版,10 个席位」,event 里有「E1043」。它比总结压缩便宜,代价是前面要有一次写入(¥0.0023),而且**写进去的记忆本身要靠得住**:Day 264 的投毒、串号、去重三件事,在这个实验里都没发生,不代表上线后不会。

最后一段是和 baseline-2 的对比。总结压缩和长期记忆变错了 0 个,两种按轮裁变错了全部 6 个。这就是 Day 261 那一行「变对了、变错了」的用处:看总分你只知道 0/6 和 6/6,看变对变错你知道是同一批题全挂,而且两种按轮裁挂的是同一批。

**这次实验量到了什么,没量到什么。** 量到的:在这一段对话、这两道题上,只靠按轮裁救不回早期信息,总结压缩和长期记忆都能。没量到的有不少。第一,两道题都是「复述一条明说过的事实」,换成「根据早期说过的偏好改写回答」这种需要整体印象的题,总结可能丢细节;第二,每种办法只有 6 次观察,摘要写得好不好、召回准不准,都要更多题才有统计意义;第三,总结压缩那一种每次压出来的摘要不同,6 次都对只说明这六份摘要都保住了事实,不说明永远保得住;第四,记忆那一种的几条记忆是我们自己的抽取提示词写出来的,换一段更乱的对话,抽取可能漏。这些都是「下一步该量什么」,和 Day 261 那句「噪声大小是这一次量出来的,换模型、换题目都要重新量」是一回事。

零件对照表,看看小项目的每一段来自哪一天:

| 零件 | 来自 | 在小项目里是 |
| --- | --- | --- |
| 实验四条纪律:测噪声、改一处、记日志、看变对变错 | Day 261 | `baseline-1/2`、`plan`、`LOG`、`now_ok/now_bad` |
| 一次调用拆六块、预算、按轮裁、`check_pairs` | Day 262 | `BUDGET`、`trim_by_turn`、`assert check_pairs` |
| 清旧工具结果、`compact` 总结压缩 | Day 263 | 两种办法的 `build` 分支 |
| 抽取、写入、召回 | Day 264 | `remember`、`recall`、`build` 里的 `note` |
| 缓存让钱不能直接比 | Day 263 练习 3 | `cost` 列 |

## 本周错题与坑清单

这一周我自己踩过、或者在实跑里看到的坑,按天列出来。复习时一条条问自己:这个坑我还会不会踩?

- **只取 k 块就当拿到 k 篇文章。** Day 259 取 4 块去重后 22 道题凑不够 4 篇,q26 被冤枉成 recall 0.5。不报错,数字也不离谱。
- **两道题的差距写进结论。** 26 道题里一道是 3.8 个百分点,vector 和 hybrid 差两道题,记成「待验证」。
- **开了 JSON 模式,提示词里不写 JSON。** Day 260 DeepSeek 直接 400:`Prompt must contain the word 'json' in some form`。
- **判出「不完整」就去改提示词。** q17 看着像答非所问,打开 `chunks` 才知道规则块根本没进来。先看模型手里有什么,再怪检索还是怪生成。
- **裁判出错的题不单独数。** 比率照样算得出来,只是分母悄悄少了几道。
- **不测噪声就比较。** Day 261 两次基线总分一样,16 道回答其实变了。
- **k 变了还拿 recall 比。** 基线存 recall@4,k=8 那次存 recall@8,名字一样意思不同。
- **总是和上一次比。** 日志上一行不一定是你的基线。今天的小项目里特意写成和 `baseline-2` 比。
- **RAGAS 的 faithfulness 平均分当结论。** 同一道题五次在 0.25 和 0.8 之间跳。
- **以为窗口有多大就能放多少。** Day 262 找一条 15 次全对,数几百条错 15% 到 26%。
- **按条裁历史。** 留下孤零零的 `tool` 消息,接口 400:`Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`。
- **只数系统提示词和历史,忘了工具定义。** 四个工具 599 个 token,是系统提示词的 3.5 倍。
- **`[:-keep_recent]` 在 0 上出错。** Day 263 `[:-0]` 是空列表,「保留 0 个」变成「一个都不清」。今天练习 2 会再撞一次。
- **总结压缩当第一选择。** 它要一次调用、会丢细节、会让缓存失效。先清工具结果。
- **用向量相似度阈值去重。** Day 264 「说法不同的同一件事」0.894,「两家银行」0.894,没有阈值能分开。
- **写 SQL 忘了 `WHERE user_id`。** 不报错,只是串号。要写成断言。
- **用户编的权限和折扣被记成事实。** 抽取时要把关,召回时也要写明「用户自己说的,没有核实」。
- **今天新增:拿 `cost` 列比省了多少。** 同样的 4222 token,第一次 ¥0.0130,第二次 ¥0.0053,差的是缓存。
- **今天新增:预算定死,压缩只是把空位填满。** 清理工具结果后输入 token 几乎没变,多留下的是更多没用的近期历史。

## 动手练习

**练习 1:默写 `trim_by_turn`。** 合上文章,在 `part04/ex265_1.py` 里写出 `split_turns`、`trim_by_turn`、`check_pairs` 三个函数,然后拿 Day 262 的原版(`part04/trim_turns.py`)对答案:`make_history(24)` 在预算 100 到 4000(每 50 一档,共 79 档)上,你的结果要和原版一模一样,而且每一档都不拆坏工具调用。再试预算小到 10 时它留几条,和故意拆坏历史时 `check_pairs` 说什么。

<details><summary>参考答案</summary>

写完和 Day 262 的 `trim_turns.py` 对一遍:

```python
# agent-zero-lab/part04/ex265_1.py  练习 1:默写 Day 262 的 split_turns、trim_by_turn、check_pairs,和原版逐档对答案
from part04.ctx_blocks import make_history
from part04.ctx_budget import message_tokens
from part04 import trim_turns  # 原版,只用来对答案


def split_turns(history: list[dict]) -> list[list[dict]]:
    turns: list[list[dict]] = []
    for m in history:
        if m["role"] == "user" or not turns:
            turns.append([m])
        else:
            turns[-1].append(m)
    return turns


def trim_by_turn(history: list[dict], budget: int) -> list[dict]:
    kept: list[list[dict]] = []
    used = 0
    for turn in reversed(split_turns(history)):
        cost = sum(message_tokens(m) for m in turn)
        if used + cost > budget and kept:
            break
        kept.append(turn)
        used += cost
    return [m for turn in reversed(kept) for m in turn]


def check_pairs(messages: list[dict]) -> str | None:
    pending: set[str] = set()
    for i, m in enumerate(messages):
        if m["role"] == "tool":
            if m["tool_call_id"] not in pending:
                return f"第 {i} 条是 tool 消息,但前面没有对应的 tool_calls"
            pending.discard(m["tool_call_id"])
        elif pending:
            return f"第 {i} 条之前还有 {len(pending)} 个工具调用没等到结果"
        if m.get("tool_calls"):
            pending = {c["id"] for c in m["tool_calls"]}
    return f"最后还有 {len(pending)} 个工具调用没等到结果" if pending else None


if __name__ == "__main__":
    history = make_history(24)
    for budget in range(100, 4001, 50):
        mine = trim_by_turn(history, budget)
        assert mine == trim_turns.trim_by_turn(history, budget), f"预算 {budget} 和原版不一样"
        assert check_pairs(mine) is None, f"预算 {budget} 拆坏了工具调用"
    print(f"{len(range(100, 4001, 50))} 档预算全部和原版一致,而且没有一档拆坏工具调用")
    for budget in (300, 1000, 2000):
        kept = trim_by_turn(history, budget)
        print(f"预算 {budget}: 留 {len(kept)} 条 / {sum(message_tokens(m) for m in kept)} token,第一条是 {kept[0]['content'][:12]!r}")
    print("最新一轮自己就超预算时(预算 10):", len(trim_by_turn(history, 10)), "条,仍然留着最新一轮")
    broken = [m for m in history if not m.get("tool_calls")]  # 把「发起工具调用」的那几条删掉,留下孤零零的 tool 结果
    print("故意拆坏:", check_pairs(broken))
```

<div class="line-notes">

- `from part04 import trim_turns  # 原版,只用来对答案` 把 Day 262 的文件当模块导入,只在 `__main__` 里拿来断言一致,函数本身是自己默写的。
- `def split_turns(history: list[dict]) -> list[list[dict]]:` 把平铺的消息切成「轮」,返回列表的列表。
- `turns: list[list[dict]] = []` 先放一个空的「轮的列表」。
- `if m["role"] == "user" or not turns:` 遇到 user 消息就开新的一轮;`or not turns` 处理历史不是 user 开头的情况(第一条也得有个地方放),不然 `turns[-1]` 会 `IndexError`。
- `turns.append([m])` 开新一轮,里面先放这条 user 消息。
- `turns[-1].append(m)` 其余的(assistant、tool)接在最近一轮后面。`make_history(24)` 切出来是 24 轮,每三轮里有一轮有 4 条(user、带 `tool_calls` 的 assistant、tool、assistant),共 285 token,其余是 2 条,各 56 token。
- `def trim_by_turn(history: list[dict], budget: int) -> list[dict]:` 从最新往回装,整轮要么全留要么全丢。
- `for turn in reversed(split_turns(history)):` `reversed` 从第 24 轮开始。
- `cost = sum(message_tokens(m) for m in turn)` 这一轮占多少 token。第 24 轮是带工具结果的,285。
- `if used + cost > budget and kept:` 装不下就停。`and kept` 是关键:`kept` 为空时(最新一轮自己就超预算)不停,强行留下,否则就会返回空历史。预算 10 时留 4 条,就是第 24 轮。
- `return [m for turn in reversed(kept) for m in turn]` `kept` 是从新到旧装的,这里 `reversed` 再翻回来,时间顺序才对;嵌套的推导式把「轮的列表」压平成消息列表。
- `def check_pairs(messages: list[dict]) -> str | None:` 检查工具调用是否成对,没问题返回 `None`,有问题返回一句话。
- `pending: set[str] = set()` 已经发出、还在等结果的 `tool_call` 的 id。
- `if m["tool_call_id"] not in pending:` 来了一条 tool 消息,但前面没有对应的调用,这就是按条裁会造出来的坏历史。
- `pending.discard(m["tool_call_id"])` 对上了就划掉。用 `discard` 不用 `remove`,不存在时不抛异常。
- `elif pending:` 不是 tool 消息、但还有调用没等到结果,说明调用和结果被别的消息隔开了。
- `if m.get("tool_calls"):` 这条是发起调用的,记下它的所有 id。
- `for budget in range(100, 4001, 50):` 从 100 到 4000,每 50 一档,79 档。
- `assert mine == trim_turns.trim_by_turn(history, budget)` 和原版逐档比,有一档不一样就报出是哪一档。
- `print("最新一轮自己就超预算时(预算 10):"` 预算 10 时仍然留下最新一轮(4 条:user、带工具调用的 assistant、tool、assistant),这是 `and kept` 的效果,也是 Day 262 练习 4 讲过的「裁完要再数一遍」的原因。
- `broken = [m for m in history if not m.get("tool_calls")]` 把发起工具调用的那 8 条删掉,留下 8 条没头没尾的 tool 结果。
- `print("故意拆坏:", check_pairs(broken))` 第 5 条(从 0 数)就是第一条孤零零的 tool 消息,和 Day 262 里接口返回 400 的是同一种坏。

</div>

```bash
uv run python -m part04.ex265_1
```

```text
79 档预算全部和原版一致,而且没有一档拆坏工具调用
预算 300: 留 4 条 / 285 token,第一条是 '第 24 个问题:我们星'
预算 1000: 留 16 条 / 794 token,第一条是 '第 19 个问题:我们星'
预算 2000: 留 40 条 / 1985 token,第一条是 '第 10 个问题:我们星'
最新一轮自己就超预算时(预算 10): 4 条,仍然留着最新一轮
故意拆坏: 第 5 条是 tool 消息,但前面没有对应的 tool_calls
```

如果有一档不一致,八成是 `reversed(kept)` 漏了(顺序反了)或者 `and kept` 漏了(预算很小时返回空)。

</details>

**练习 2:默写 `clear_old_tool_results`,再亲手写一个「看着对」的错版本。** 在 `part04/ex265_2.py` 里写出清理函数(只保留最近 `keep_recent` 条工具结果的原文,更早且超过 200 个字符的换成占位),和原版比 `keep_recent` 取 0、1、2、8、99。再写第二版,把「更早的」写成 `tool_idx[:-keep_recent]`,看它在哪个取值上和原版不一样。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex265_2.py  练习 2:默写 clear_old_tool_results,再试一个「看着对其实错」的写法
from typing import Any

from part04.ctx_blocks import make_history
from part04.tool_clearing import PLACEHOLDER, clear_old_tool_results


def clear_mine(messages: list[dict[str, Any]], keep_recent: int = 2, min_chars: int = 200) -> list[dict[str, Any]]:
    tool_idx = [i for i, m in enumerate(messages) if m["role"] == "tool"]
    old = set(tool_idx[: len(tool_idx) - keep_recent]) if keep_recent < len(tool_idx) else set()
    return [{**m, "content": PLACEHOLDER} if i in old and len(str(m.get("content") or "")) > min_chars else m
            for i, m in enumerate(messages)]


def clear_slice_bug(messages: list[dict[str, Any]], keep_recent: int = 2, min_chars: int = 200) -> list[dict[str, Any]]:
    tool_idx = [i for i, m in enumerate(messages) if m["role"] == "tool"]
    old = set(tool_idx[:-keep_recent])  # 少了 keep_recent < len 的判断
    return [{**m, "content": PLACEHOLDER} if i in old and len(str(m.get("content") or "")) > min_chars else m
            for i, m in enumerate(messages)]


if __name__ == "__main__":
    history = make_history(24)  # 8 条工具结果
    n_tools = sum(m["role"] == "tool" for m in history)
    print(f"历史 {len(history)} 条,其中工具结果 {n_tools} 条")
    for keep in (0, 1, 2, 8, 99):
        want = clear_old_tool_results(history, keep_recent=keep)
        got = clear_mine(history, keep_recent=keep)
        cleared = sum(m.get("content") == PLACEHOLDER for m in got)
        buggy = sum(m.get("content") == PLACEHOLDER for m in clear_slice_bug(history, keep_recent=keep))
        print(f"keep_recent={keep:<2} 和原版一致:{got == want}  清了 {cleared} 条;切片写法清了 {buggy} 条")
```

<div class="line-notes">

- `from part04.tool_clearing import PLACEHOLDER, clear_old_tool_results` 占位文字和原版函数。默写版自己写,原版拿来对答案。
- `def clear_mine(messages: list[dict[str, Any]], keep_recent: int = 2, min_chars: int = 200)` 参数和原版一样。`min_chars=200`:太短的工具结果清了也省不了多少,留着。
- `tool_idx = [i for i, m in enumerate(messages) if m["role"] == "tool"]` 所有 tool 消息的下标。`make_history(24)` 里是 8 条。
- `old = set(tool_idx[: len(tool_idx) - keep_recent]) if keep_recent < len(tool_idx) else set()` 更早的那些。`keep_recent=2` 时是 `tool_idx[:6]`,前 6 条;`keep_recent=0` 时是 `tool_idx[:8]`,全部。`if` 的另一半处理 `keep_recent` 不小于总数的情况,这时一条都不清。
- `return [{**m, "content": PLACEHOLDER} if i in old and len(str(m.get("content") or "")) > min_chars else m` `{**m, "content": ...}` 复制一份再改 `content`,不动原消息;`tool_calls` 和 `tool_call_id` 都保留,所以成对关系不会破。
- `old = set(tool_idx[:-keep_recent])  # 少了 keep_recent < len 的判断` 错版本。`[:-2]` 是「去掉最后 2 个」没问题,但 `[:-0]` 等于 `[:0]`,是空列表。
- `for keep in (0, 1, 2, 8, 99):` 0 是边界,8 是「正好等于工具结果总数」,99 是「比总数还大」。
- `want = clear_old_tool_results(history, keep_recent=keep)` 原版的答案。
- `got = clear_mine(history, keep_recent=keep)` 默写版,下面比较 `got == want`。
- `cleared = sum(m.get("content") == PLACEHOLDER for m in got)` 数有几条被换成了占位。`keep_recent=2` 时是 6:8 条里留最近 2 条,清 6 条。
- `buggy = sum(m.get("content") == PLACEHOLDER for m in clear_slice_bug(history, keep_recent=keep))` 错版本清了几条。只有 `keep_recent=0` 这一行不一样:原版清 8 条,错版本清 0 条。

</div>

```bash
uv run python -m part04.ex265_2
```

```text
历史 64 条,其中工具结果 8 条
keep_recent=0  和原版一致:True  清了 8 条;切片写法清了 0 条
keep_recent=1  和原版一致:True  清了 7 条;切片写法清了 7 条
keep_recent=2  和原版一致:True  清了 6 条;切片写法清了 6 条
keep_recent=8  和原版一致:True  清了 0 条;切片写法清了 0 条
keep_recent=99 和原版一致:True  清了 0 条;切片写法清了 0 条
```

`keep_recent=0` 那一行最危险:参数写的是「一条都不留」,切片却悄悄变成「一条都不清」,不报错,只是该省的 token 没省。这是 Day 263 讲过的坑,默写时又写出来了的话,说明要多练一次。

</details>

**练习 3:默写「变对、变错」。** 合上文章,在 `part04/ex265_3.py` 里写出 `load_log()`(读 JSONL,跳过空行)和 `diff_runs(prev, cur)`(返回变对了的和变错了的两个列表),用今天小项目写出的 `out/review38.jsonl` 验证:拿 `baseline-2` 当基线,和另外几种办法比;再拿 `baseline-1` 和 `baseline-2` 互比,看噪声。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex265_3.py  练习 3:默写「这次实验比上一次变对了哪些、变错了哪些」,拿本周小项目的日志验证
import json
from pathlib import Path

LOG = Path("out/review38.jsonl")


def load_log(path: Path = LOG) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def diff_runs(prev: dict, cur: dict) -> tuple[list[str], list[str]]:
    """返回 (变对了的, 变错了的)。failed 里放的是答错的那些项。"""
    now_ok = sorted(set(prev["failed"]) - set(cur["failed"]))
    now_bad = sorted(set(cur["failed"]) - set(prev["failed"]))
    return now_ok, now_bad


if __name__ == "__main__":
    entries = {e["name"]: e for e in load_log()}
    print("日志里有:", list(entries))
    base = entries["baseline-2"]
    for name, e in entries.items():
        if name == "baseline-2":
            continue
        ok, bad = diff_runs(base, e)
        print(f"{name:<12} 变对 {ok}  变错 {bad}")
    print("用 baseline-1 和 baseline-2 互比(噪声):", diff_runs(entries["baseline-1"], entries["baseline-2"]))
    print("手造两条验证:", diff_runs({"failed": ["a", "b"]}, {"failed": ["b", "c"]}))
```

<div class="line-notes">

- `LOG = Path("out/review38.jsonl")` 今天小项目写出来的日志,路径要对得上。
- `def load_log(path: Path = LOG) -> list[dict]:` 默认参数是模块级的 `LOG`。
- `return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]` 一行一个 JSON。`if line.strip()` 跳过空行,Day 257 讲过不能对整个 JSONL 文件用 `json.loads`(`Extra data: line 2 column 1`)。
- `def diff_runs(prev: dict, cur: dict) -> tuple[list[str], list[str]]:` 返回 `(变对, 变错)`。
- `now_ok = sorted(set(prev["failed"]) - set(cur["failed"]))` 集合相减:上次错、这次不错。`sorted` 让输出顺序固定。
- `now_bad = sorted(set(cur["failed"]) - set(prev["failed"]))` 反过来。
- `entries = {e["name"]: e for e in load_log()}` 把列表变成「名字到那一行」的字典,方便按名字取基线。
- `base = entries["baseline-2"]` 基线。
- `if name == "baseline-2":` 自己不和自己比。
- `print("手造两条验证:", diff_runs({"failed": ["a", "b"]}, {"failed": ["b", "c"]}))` 手造的两条:上次错 a、b,这次错 b、c,所以 a 变对了,c 变错了,输出 `(['a'], ['c'])`。写日志脚本之前先这样用假数据验一下。

</div>

```bash
uv run python -m part04.ex265_3
```

```text
日志里有: ['baseline-1', 'baseline-2', 'trim', 'clear+trim', 'compact', 'memory+trim']
baseline-1   变对 []  变错 []
trim         变对 []  变错 ['code-0', 'code-1', 'code-2', 'plan-0', 'plan-1', 'plan-2']
clear+trim   变对 []  变错 ['code-0', 'code-1', 'code-2', 'plan-0', 'plan-1', 'plan-2']
compact      变对 []  变错 []
memory+trim  变对 []  变错 []
用 baseline-1 和 baseline-2 互比(噪声): ([], [])
手造两条验证: (['a'], ['c'])
```

两次基线互比,变对变错都是空,这就是噪声的下限:这次实验里,同样的办法跑两次,答对的题完全一样。反过来,按轮裁和清工具结果各有 6 个「变错」,不是噪声能解释的。

</details>

**练习 4:默写 `recall`,写一条「A 用户召回不到 B 用户记忆」的断言。** 合上文章,在 `part04/ex265_4.py` 里写出 `recall_mine(conn, user_id, query, k=3, max_dist=0.5)`:profile 类的最多带 5 条,非 profile 的按距离取最近 k 条且距离小于 `max_dist`;再给 `u-a`、`u-b` 两个用户各写两条记忆,用四个问题断言 `u-a` 一条 `u-b` 的记忆都召回不到。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex265_4.py  练习 4:默写 recall,再写一个断言「A 用户永远召回不到 B 用户的记忆」
import psycopg

from common.embed import embed, embed_one
from part04.memory_store import forget, init, recall
from part04.pg_store import connect


def recall_mine(conn: psycopg.Connection, user_id: str, query: str, k: int = 3, max_dist: float = 0.5) -> list[str]:
    profile = [r[0] for r in conn.execute(
        "SELECT content FROM user_memories WHERE user_id = %s AND kind = 'profile' ORDER BY updated_at DESC LIMIT 5",
        (user_id,)).fetchall()]
    q = embed_one(query)
    related = [r[0] for r in conn.execute(
        "SELECT content FROM user_memories WHERE user_id = %s AND kind <> 'profile' AND embedding <=> %s < %s "
        "ORDER BY embedding <=> %s LIMIT %s", (user_id, q, max_dist, q, k)).fetchall()]
    return profile + related


def put(conn: psycopg.Connection, user_id: str, rows: list[tuple[str, str]]) -> None:
    vectors = embed([c for _, c in rows])
    for (kind, content), v in zip(rows, vectors):
        conn.execute("INSERT INTO user_memories (user_id, kind, content, embedding) VALUES (%s, %s, %s, %s)",
                     (user_id, kind, content, v))


if __name__ == "__main__":
    conn = connect()
    init(conn)
    for u in ("u-a", "u-b"):
        forget(conn, u)
    put(conn, "u-a", [("profile", "使用年付企业版,10 个席位"), ("event", "2026-10 导入报 E1043,已解决")])
    put(conn, "u-b", [("profile", "使用免费版,1 名成员"), ("event", "2026-10 导入报 E1043,尚未解决")])

    for u in ("u-a", "u-b"):
        mine, orig = recall_mine(conn, u, "导入又报错了"), recall(conn, u, "导入又报错了")
        print(f"{u}: 我的 {mine}\n     原版 {orig}  一致:{mine == orig}")

    all_b = {"使用免费版,1 名成员", "2026-10 导入报 E1043,尚未解决"}
    for q in ("导入又报错了", "我们是什么套餐", "帮我查下发票", "免费版"):
        assert not set(recall_mine(conn, "u-a", q)) & all_b, f"u-a 召回到了 u-b 的记忆:{q}"
    print("4 个问题,u-a 一条 u-b 的记忆都没召回到")
    for u in ("u-a", "u-b"):
        forget(conn, u)
```

<div class="line-notes">

- `from part04.memory_store import forget, init, recall` 原版 `recall` 拿来对答案,`forget`、`init` 清场建表。
- `def recall_mine(conn: psycopg.Connection, user_id: str, query: str, k: int = 3, max_dist: float = 0.5)` 签名和原版一样。
- `profile = [r[0] for r in conn.execute(` 第一条 SQL:这个用户的 profile 类记忆。`r[0]` 是每行的第一列,也就是 `content`。
- `"SELECT content FROM user_memories WHERE user_id = %s AND kind = 'profile' ORDER BY updated_at DESC LIMIT 5",` **`WHERE user_id = %s` 是整个函数最要紧的一句**,漏了不报错,只是把所有人的 profile 都召回出来。`ORDER BY updated_at DESC LIMIT 5` 取最近更新的 5 条。
- `q = embed_one(query)` 把问题变成向量,走硅基流动的免费 embedding。
- `"SELECT content FROM user_memories WHERE user_id = %s AND kind <> 'profile' AND embedding <=> %s < %s "` 第二条 SQL 也要 `user_id`。`<=>` 是 pgvector 的余弦距离,`< %s` 把距离大于 `max_dist` 的挡掉,没有这一句,再不相关的记忆也会被塞回来凑数。
- `"ORDER BY embedding <=> %s LIMIT %s", (user_id, q, max_dist, q, k)).fetchall()]` 按距离从近到远取 `k` 条。参数元组的顺序要和 SQL 里的五个 `%s` 一一对上:`user_id`、`q`、`max_dist`、`q`、`k`(第二个 `q` 是排序用的)。
- `return profile + related` profile 在前,相关的在后。
- `def put(conn: psycopg.Connection, user_id: str, rows: list[tuple[str, str]]) -> None:` 造测试数据用的小函数:一次 `embed` 算完所有向量,再逐条 `INSERT`。
- `put(conn, "u-a", [("profile", "使用年付企业版,10 个席位"), ("event", "2026-10 导入报 E1043,已解决")])` A 用户:年付企业版,E1043 已解决。
- `put(conn, "u-b", [("profile", "使用免费版,1 名成员"), ("event", "2026-10 导入报 E1043,尚未解决")])` B 用户故意写了一条和 A 几乎一样的事件,只有「已解决」和「尚未解决」不同,最容易串号。
- `mine, orig = recall_mine(conn, u, "导入又报错了"), recall(conn, u, "导入又报错了")` 默写版和原版各召回一次。
- `all_b = {"使用免费版,1 名成员", "2026-10 导入报 E1043,尚未解决"}` B 用户所有记忆的集合。
- `assert not set(recall_mine(conn, "u-a", q)) & all_b, f"u-a 召回到了 u-b 的记忆:{q}"` 集合交集 `&` 必须为空。四个问题里有一个是「免费版」,故意往 B 的记忆上凑。

</div>

```bash
uv run python -m part04.ex265_4
```

```text
u-a: 我的 ['使用年付企业版,10 个席位', '2026-10 导入报 E1043,已解决']
     原版 ['使用年付企业版,10 个席位', '2026-10 导入报 E1043,已解决']  一致:True
u-b: 我的 ['使用免费版,1 名成员', '2026-10 导入报 E1043,尚未解决']
     原版 ['使用免费版,1 名成员', '2026-10 导入报 E1043,尚未解决']  一致:True
4 个问题,u-a 一条 u-b 的记忆都没召回到
```

两个用户各自召回的都是自己的两条,和原版完全一致,四个问题没有串号。把两条 SQL 里任意一个 `user_id = %s` 删掉再跑,断言就会红(Day 264 练习 3 做过)。

</details>

**练习 5(开放题):只用按轮裁,预算要多大才能保住早期信息?** 小项目里按轮裁用的预算是 1500,答错了。预算涨到多少才答得对?不调模型,写 `part04/ex265_5.py`:对 1500 到 4000 的几档预算,看按轮裁留下的消息里还有没有「年付、企业版、10 个席位」和「E1043」,再说说这个答案能不能直接当结论。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex265_5.py  练习 5(开放题):只用「按轮裁」,预算要多大才能保住那四轮早期对话?不调模型,先看消息里还剩什么
from part04.review38_experiment import HISTORY
from part04.ctx_budget import message_tokens
from part04.trim_turns import trim_by_turn

total = sum(message_tokens(m) for m in HISTORY)
print(f"全部历史 {len(HISTORY)} 条 / {total} token,最早四轮占前 {sum(message_tokens(m) for m in HISTORY[:14])} token")
for budget in (1500, 2000, 2500, 3000, 3500, 4000):
    kept = trim_by_turn(HISTORY, budget)
    text = " ".join(str(m.get("content") or "") for m in kept)
    has_plan = all(p in text for p in ("年付", "企业版", "10 个席位"))
    has_code = "E1043" in text
    print(f"预算 {budget}: 留 {len(kept):>2} 条 {sum(message_tokens(m) for m in kept):>4} token  留住套餐信息:{has_plan}  留住报错码:{has_code}")
```

<div class="line-notes">

- `from part04.review38_experiment import HISTORY` 复用小项目里的 78 条历史。导入它不会触发实验,因为实验在 `if __name__ == "__main__":` 里。
- `total = sum(message_tokens(m) for m in HISTORY)` 3865。
- `sum(message_tokens(m) for m in HISTORY[:14])` 最早 14 条(四轮)占 689 token,是总量的 18%。
- `for budget in (1500, 2000, 2500, 3000, 3500, 4000):` 六档预算。
- `kept = trim_by_turn(HISTORY, budget)` 按轮裁一次,留下消息列表。
- `text = " ".join(str(m.get("content") or "") for m in kept)` 把留下的消息的正文拼成一个大字符串,方便用 `in` 查。带 `tool_calls` 的 assistant 消息 `content` 是 `None`,`or ""` 防止 `str(None)` 变成 `"None"`。
- `has_plan = all(p in text for p in ("年付", "企业版", "10 个席位"))` 三个词都要在。
- `has_code = "E1043" in text` 报错码在不在。

</div>

```bash
uv run python -m part04.ex265_5
```

```text
全部历史 78 条 / 3865 token,最早四轮占前 689 token
预算 1500: 留 28 条 1476 token  留住套餐信息:False  留住报错码:False
预算 2000: 留 40 条 1985 token  留住套餐信息:False  留住报错码:False
预算 2500: 留 48 条 2382 token  留住套餐信息:False  留住报错码:False
预算 3000: 留 56 条 2779 token  留住套餐信息:False  留住报错码:False
预算 3500: 留 66 条 3233 token  留住套餐信息:False  留住报错码:False
预算 4000: 留 78 条 3865 token  留住套餐信息:True  留住报错码:True
```

结论很直白:预算 3500 都留不住,**要到 4000(比全部 3865 还大)才全留下**。按轮裁是从后往前装,最早的四轮永远最后才进来,所以想靠调大预算保住早期信息,就等于把预算调到「几乎全塞」,和没裁一样。这能不能当结论?只能说在这一段对话上成立:它是「早期信息一定排在最前面」的特例。真实对话里早期那句「我们是年付企业版」可能在第 3 轮,也可能在第 30 轮,预算够不够取决于对话有多长,**不能靠调一个数字来保**。这就是要用压缩(留要点)或记忆(存起来再取)的原因:它们是按「重要不重要」留,不是按「新不新」留。

</details>

**验收标准:** 练习 1、2、4 合上文章写出来,输出和上面一致;小项目跑通,能说清为什么两次基线钱差一倍、为什么清工具结果几乎没省、为什么按轮裁 0/6;能对着知识地图讲出六天各干了什么。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 实验日志 | 每次实验追加一行 JSON,记下名字、配置、分数、答错的题、花费。以后问「为什么现在是这个配置」就查它 |
| 变对了、变错了 | 和基线比,答错的题集合相减得到的两个列表。比总分更能说明一个改动到底干了什么 |
| 基线(baseline) | 一切改动之前的配置跑出来的结果,所有改动都跟它比。要跑两次测噪声 |
| 前缀缓存 | 大模型服务商把输入开头相同的部分记下来,下次命中按低价算。同样的 token,第一次和之后的钱可以差几十倍 |
| 摊销 | 压缩、写记忆这类「做一次、后面很多轮都受益」的花费,要除以受益的轮数再比。单次看总是贵的 |

本周其他术语(hit@1、recall@k、忠实、完整、拒答、LLM 当裁判、RAGAS、上下文工程、token 预算、按轮裁剪、总结压缩、短期记忆、长期记忆、profile、preference、event、串号、记忆投毒)第一次出现时已在对应那天的名词表里,复习时回去看。

## 常见误区

**拿 `cost` 列比省了多少。** 同样的 4222 个输入 token,第一次基线 ¥0.0130,第二次 ¥0.0053,差的全是缓存。比省不省,看 token 数;比花不花钱,要把缓存、摊销都算进去。

**以为预算定死时压缩就能多留早期信息。** 清工具结果后每轮变小,同一个 1500 的预算只是多装了几轮近期的确认,早期那四轮还是进不来。省下的空位被无关的近期历史填满了。

**一种办法 6/6 就当「它永远好」。** 总结压缩 6 次都对,只说明这六份摘要保住了两条事实。换一段更长更乱的对话、换更细的题,要重新量。

**把压缩的钱单次看。** 实验里总结压缩最贵(12 次调用 ¥0.0225),是因为每次都重新压。线上压一次存起来,后面每轮都在 616 token 的短历史上问,几轮就回本。反过来,触发阈值设太低、每轮都压,就真的会比不压更贵。

**以为长期记忆是免费的。** 查询时多 60 来个 token,看着几乎没成本,可前面有一次抽取(这次 ¥0.0023),还有去重、串号、投毒三件事要守。便宜的是读,贵的是写和管。

**复习日只看不写。** 默写 `trim_by_turn` 时最容易漏的是 `and kept`,默写 `clear_old_tool_results` 时最容易写成 `[:-keep_recent]`。不亲手写一遍发现不了。

## 学习资料

### 文档与文章

- [Anthropic · Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents):本周后三天的总纲。复习时对照里面的几类手段(压缩、笔记、子 Agent、即时检索),看每一类在本周哪一天用过。
- [Hamel Husain · Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/):英文,讲为什么评估是 AI 产品迭代的发动机,以及从看真实数据开始。对应 Day 257 到 Day 261。
- [RAGAS 文档](https://docs.ragas.io/en/stable/):Day 261 用的框架的官方文档,复习时看指标列表,对照我们自己写的三个裁判。
- [Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory(arXiv 2504.19413)](https://arxiv.org/abs/2504.19413):Day 264 提到的记忆库的论文,看它的抽取加更新流程,对照 `remember`。
- [Lost in the Middle: How Language Models Use Long Contexts(arXiv 2307.03172)](https://arxiv.org/abs/2307.03172):长上下文里模型对中间位置的信息用得最差,和 Day 262「窗口大不等于该塞满」是一类现象。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1b69gB5E3h&autoplay=0&high_quality=1" title="面试官问:如何评估RAG系统的效果?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI深度幻觉 · 面试官问:如何评估RAG系统的效果? · 12 分钟,按面试回答的角度把检索指标、生成指标、评估框架串一遍,复习本周前三天时用,看完试着自己先说出每一句。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1w3GNzeEHb&autoplay=0&high_quality=1" title="上下文工程:优化 Agent 效能的关键技术" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>沧海九粟 · 上下文工程:优化 Agent 效能的关键技术 · 22 分钟,把上下文工程的概念和几类手段过一遍,复习后三天时对照知识地图下排。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/MJScoDgIcXg" title="Context Engineering Episode 3 - Lance Martin - LangChain" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Chroma · Context Engineering Episode 3 - Lance Martin - LangChain · 英文,四类手段那篇文章的作者本人讲,开自动字幕。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/aYfZN8t6AQs" title="Agent Memory EXPLAINED - Complete Architecture" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hugging Face · Agent Memory EXPLAINED - Complete Architecture · 英文,讲 Agent 记忆的整体架构,复习 Day 264 时开自动字幕看。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):评估一章对应本周前三天,讲评估方法和流程怎么设计;讲 RAG 和 Agent 的一章里有上下文构造和记忆,对应后三天。
- Christopher D. Manning、Prabhakar Raghavan、Hinrich Schütze《Introduction to Information Retrieval》(Cambridge University Press,2008),中文版《信息检索导论》(王斌译,人民邮电出版社):检索评价指标的经典出处,第 8 章,斯坦福 NLP 组网站有免费英文在线版(按书名搜索)。

### 开源项目与代码

- [mem0ai/mem0](https://github.com/mem0ai/mem0):看它的抽取提示词和更新逻辑,和 Day 264 的 `EXTRACT_PROMPT`、`judge` 对着读。
- [letta-ai/letta](https://github.com/letta-ai/letta):让 Agent 自己决定把什么换进换出上下文,前身是 MemGPT,和我们手写的「系统帮你管」是两条路。

## 自测

**1. 小项目里「按轮裁」和「清工具结果加按轮裁」都是 0/6,为什么后者没有比前者好?**

<details><summary>答案</summary>

预算固定在 1500 token。清理旧工具结果让每一轮变小,同样的预算里能多装几轮最近的确认,正好把省出来的空位填满(输入 1612 对 1630 token,只差 18)。最早那四轮在历史最前面,按轮裁从最新往回装,仍然进不来,所以两道题照样答错。

</details>

**2. 两次基线输入 token 都是 4222,钱却是 ¥0.0130 和 ¥0.0053。这个差别是不是说明第二次「变好了」?**

<details><summary>答案</summary>

不是。差别来自前缀缓存:第一次的 4222 token 前缀没命中缓存,按未命中价算;第二次基本全命中,按命中价算。比较「省了多少」要看 token 数那一列,比较钱要考虑缓存和摊销。

</details>

**3. 总结压缩在实验里最贵(¥0.0225),这是不是说明线上它也最贵?**

<details><summary>答案</summary>

不一定。实验为了每次独立,把压缩重复做了 6 次,每次都要读一遍 3865 token 的历史。线上做法是压缩一次、把摘要存回会话,之后每一轮都在 616 token 左右的短历史上问,压缩那一次几轮就摊回来了。反过来如果触发阈值太低、几乎每轮都压,才会真的更贵。

</details>

**4. 长期记忆加按轮裁在两道题上都对了,但它的「答对」依赖哪两件事?**

<details><summary>答案</summary>

一是写入时抽取得对:早期对话里的「年付企业版 10 席位」和 E1043 被抽成了 profile 和 event 记忆(写入 6 条,花 ¥0.0023)。二是召回时取得到:`recall` 用问题当查询,profile 全带,event 按距离小于 0.5 取最近的。抽取漏了、距离上限设太紧、SQL 漏了 `user_id`,任何一处出问题,答案就不在 system 里了。

</details>

**5.(面试题)同事说「我们的 Agent 用了按轮裁剪,超预算就丢最老的,够用了」。你会怎么评估这句话?**

<details><summary>答案</summary>

先问「够用」是怎么量的:有没有一批只有早期对话才答得出的题(身份、套餐、偏好、已经做过的决定)。没有的话,自己造:选一段长对话,在最早几轮放关键事实,到最后再问,看答不答得对。我们自己的实验里,同一段 78 条的对话、预算 1500,按轮裁 0/6;预算要涨到 4000(比总量还大)才保得住,等于没裁。然后问替代方案的账:总结压缩(输入少 85%,要多一次调用、摘要要量)、长期记忆(输入少 60%,要写入、去重、防串号投毒)各自多花什么。最后问比较方法:有没有测噪声、有没有看变对变错、是不是只比了总分、有没有把缓存算进成本。

</details>

## 明天预告

Day 266 · Agentic RAG:让 Agent 自己决定查不查。本周所有的 RAG 都是固定流水线:不管用户说什么,先检索、再生成。Day 259 的失败清单里,一句话问两件事的题(q26 问银行和编码)一次检索只能照顾一半;Day 262 又看到每次检索都会往窗口里塞几千 token。明天把检索做成一个工具,交给 Agent 循环,让模型自己决定查不查、查什么、查几次,然后用十道题量一量它比固定流水线好在哪、贵在哪。
