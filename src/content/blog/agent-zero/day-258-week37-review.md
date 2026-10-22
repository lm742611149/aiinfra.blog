---
title: 'Day 258 · 第 37 周复习:RAG 与上下文(Day 252–257)'
description: '这一周前三天做 GraphRAG,后三天开始做 RAG 评估。今天画一张知识地图,每天一句话回顾,然后做一个只用本周知识的小项目:拿 Day 256 的三个指标重新量一遍 Day 253 的「图检索 vs 混合检索」。同样四道题,「6/9 对 8/9」换成 recall、precision、MRR 三个数以后,混合检索 MRR 1.000、图检索 0.875;图检索连跑三次是 7/9、6/9、6/9。'
pubDate: 2026-10-22
regime: none
tags: ['review', 'rag-evaluation', 'graphrag', 'python', 'agent-zero']
series: 'agent-zero'
day: 258
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 257](/blog/agent-zero/day-257-rag-eval-3/) 给 CloudLedger 帮助中心建了第一份正式评估集:30 道题,政策、错误码、口语、一句两问、无答案五类,存成 `data/eval/rag_eval.jsonl`,旁边配了一个检查脚本 `eval_set.py`,故意改坏三条它都能抓出来。最后实测了一件很扎心的事:同一个意思换成口语问,BM25 的倒数排名从 1 掉到 0。

这是第 37 周的最后一天。这一周两段内容看起来不相干,前三天在建图、走图、给社区写摘要,后三天在算分、出题。其实后三天就是在给前三天补课:GraphRAG 那几天的 6/9、8/9、15/20 都是临时手标几道题量出来的,量法本身靠不靠得住,当时没法回答。今天把这两段接起来。

## 今天要解决的问题

1. 能对着一张图说出本周六天各干了什么,以及前三天的数字为什么需要后三天的工具来复核。
2. 不看文章默写出两段核心代码并跑通:Day 256 的 `metrics.py` 五个函数、Day 257 的 `load_eval_set()` 和 `check_eval_set()`。
3. 完成一个只用本周知识的小项目 `part04/review37_rescore.py`:用 recall@4、precision@4、MRR 重新给 Day 253 的图检索和混合检索打分,看懂「合在一起数」和「每题算完再平均」差在哪。
4. 默写 Day 252 的类型规则检查,在模型建的图上跑一遍。

预计用时 3 小时。花费约 ¥0.0073:小项目每跑一次是 4 次 `link_entities` 调用(输入 2326、输出约 100 token),按 DeepSeek 高峰价输入 2 元、输出 8 元每百万 token 算,2326 × 2 / 10⁶ + 100 × 8 / 10⁶ ≈ ¥0.0055,`LLMClient` 按缓存命中折算后记的是 ¥0.0024,我跑了三次。其余练习不调大模型;embedding 和 rerank 用硅基流动的免费模型。价格 2026 年 10 月在 [DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)查到,空闲时段减半。

前置:本周的 [Day 252](/blog/agent-zero/day-252-graphrag-extract/) 到 [Day 257](/blog/agent-zero/day-257-rag-eval-3/)。小项目要用到 Day 252 建好的 `part04/data/kg_llm.db`、Day 253 的 `kg_local.py` 和 `kg_compare.py`、Day 240 的 `retrieve.py`(Postgres.app 要开着)、Day 256 的 `metrics.py`。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。复习日的默写特别重要,练习 1、2、4 请真的合上文章写。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="第 37 周知识地图:上排 GraphRAG 三天,抽三元组、local search、社区摘要和 global search;下排 RAG 评估三天,分两层、三个检索指标、30 条评估集;上排的临时数字指向下排的正式量法,下排再指向 Day 259 和 Day 260">
<rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)"/>
<defs><marker id="rv258a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--ink-soft)"/></marker></defs>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink-soft)">GraphRAG:换一种找法</text>
<rect x="20" y="38" width="180" height="60" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="110" y="60" fill="var(--ink)" text-anchor="middle">252 抽三元组</text>
<text x="110" y="80" fill="var(--ink-soft)" text-anchor="middle" font-size="11">JSON 模式;白名单;方向</text>
<line x1="200" y1="68" x2="228" y2="68" stroke="var(--ink-soft)" marker-end="url(#rv258a)"/>
<rect x="230" y="38" width="180" height="60" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="60" fill="var(--ink)" text-anchor="middle">253 local search</text>
<text x="320" y="80" fill="var(--ink-soft)" text-anchor="middle" font-size="11">种子→两跳;图 6/9 混合 8/9</text>
<line x1="410" y1="68" x2="438" y2="68" stroke="var(--ink-soft)" marker-end="url(#rv258a)"/>
<rect x="440" y="38" width="180" height="60" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="530" y="60" fill="var(--ink)" text-anchor="middle">254 global search</text>
<text x="530" y="80" fill="var(--ink-soft)" text-anchor="middle" font-size="11">社区摘要;map-reduce</text>
<text x="320" y="136" fill="var(--ink-faint)" text-anchor="middle" font-size="11">这些数字是手标几道题临时量的,量法靠不靠得住?</text>
<line x1="320" y1="98" x2="320" y2="172" stroke="var(--ink-soft)" stroke-dasharray="4 3" marker-end="url(#rv258a)"/>
<text x="20" y="166" fill="var(--ink-soft)">RAG 评估:造一把尺子</text>
<rect x="20" y="178" width="180" height="60" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="110" y="200" fill="var(--ink)" text-anchor="middle">255 分两层</text>
<text x="110" y="220" fill="var(--ink-soft)" text-anchor="middle" font-size="11">检索错 / 生成错</text>
<line x1="200" y1="208" x2="228" y2="208" stroke="var(--ink-soft)" marker-end="url(#rv258a)"/>
<rect x="230" y="178" width="180" height="60" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="200" fill="var(--ink)" text-anchor="middle">256 三个指标</text>
<text x="320" y="220" fill="var(--ink-soft)" text-anchor="middle" font-size="11">recall precision MRR</text>
<line x1="410" y1="208" x2="438" y2="208" stroke="var(--ink-soft)" marker-end="url(#rv258a)"/>
<rect x="440" y="178" width="180" height="60" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="530" y="200" fill="var(--ink)" text-anchor="middle">257 30 条评估集</text>
<text x="530" y="220" fill="var(--ink-soft)" text-anchor="middle" font-size="11">五种题型;检查脚本</text>
<line x1="530" y1="238" x2="530" y2="270" stroke="var(--ink-soft)" marker-end="url(#rv258a)"/>
<rect x="330" y="272" width="290" height="44" rx="4" fill="none" stroke="var(--rule)"/>
<text x="475" y="292" fill="var(--ink)" text-anchor="middle">下周:259 检索评估脚本</text>
<text x="475" y="308" fill="var(--ink-soft)" text-anchor="middle" font-size="11">260 生成评估,大模型当裁判</text>
</g>
</svg>
<figcaption>本周六天。上排是 GraphRAG,用图代替向量去找资料;下排是评估,给「找得好不好、答得好不好」造一把能反复用的尺子。中间那条虚线就是今天的小项目:用下排的尺子回头量上排。</figcaption>
</figure>

图里最该记住的是中间那条虚线。Day 253 的结论「图检索找文章 6/9,混合检索 8/9」是我手写四道题、写个 `hits()` 函数数出来的,那时候还没有 recall、precision、MRR 这些词,也没有评估集。数字本身没错,但它只回答了「一共找到几篇」,没回答「排得靠不靠前」「每道题各自怎么样」「再跑一次还是这个数吗」。这三个问题,后三天的工具都能回答。

## 本周每天一句话

- [Day 252 · GraphRAG(一):用大模型抽三元组](/blog/agent-zero/day-252-graphrag-extract/):不开 JSON 模式,模型交回的是带 ```` ```json ```` 围栏的一段文字,`json.loads` 直接崩;不给关系白名单,三篇文章造出 28 种关系;白名单加上「头和尾各是什么类型」写进提示词,可疑的边从 32 条降到 3 条,全程一毛多钱。
- [Day 253 · GraphRAG(二):local search 和混合检索比一比](/blog/agent-zero/day-253-graphrag-local/):让模型从实体列表里挑种子,沿边走两步,把边和原文证据交给模型回答;枚举题答得好,E4029 那题因为图断开答错了价格;找文章图检索 6/9,混合检索 8/9。
- [Day 254 · GraphRAG(三):社区摘要和 global search](/blog/agent-zero/day-254-graphrag-global/):「所有带时间期限的规则」这种全局问题,混合检索 top-4 只覆盖 20 条里的 5 条;Louvain 切社区、每个社区写摘要再 map-reduce,改一句 map 提示词升到 15 条,把小社区捡回来升到 18 条,同样的代码跑三轮是 17、20、18。
- [Day 255 · RAG 评估(一):为什么分两层](/blog/agent-zero/day-255-rag-eval-1/):RAG 答错只有两类原因,资料没拿到或者拿到了没用好;BM25 配置和宽松提示词配置端到端都是 3/6,一个病在检索,一个病在生成,修法完全相反。
- [Day 256 · RAG 评估(二):手算三个检索指标](/blog/agent-zero/day-256-rag-eval-2/):recall@k 看该找的找到了几成,precision@k 看拿到的里面几成有用,MRR 看第一个有用的排第几;块 id 要先转成文章 id 再比,无答案题不能进分母。
- [Day 257 · RAG 评估(三):建 30 条评估集,五种题型](/blog/agent-zero/day-257-rag-eval-3/):每条有 id、question、expected_docs、type、answer_points 五个字段,存成 JSONL;一定要有口语题和无答案题;一道题占检索层分数的 3.8%。

## 本周小项目:用本周的尺子重新量 Day 253

先回忆 Day 253 那个对比脚本 `part04/kg_compare.py` 是怎么打分的。它对每道题数「标准答案里的文章被找到了几篇」,四道题加起来,混合检索 8 篇,图检索 6 篇,分母是四道题标准答案的总篇数 9。

这个数法有两个问题,用这周学的东西一眼就能看出来。

第一,它只管「找没找到」,不管排第几。Day 256 讲过,用户最先看到的是第一名,答案排第 1 和排第 4 差别很大,这正是 MRR 要量的东西。

第二,它是把四道题的命中数**合在一起数**,而 Day 256 的 recall@k 是**每道题算完再平均**。这两种平均法在信息检索里各有名字:前者叫微平均(micro average),后者叫宏平均(macro average)。差别在于,微平均里标准答案篇数多的题分量重。Day 253 的第一道题「哪些功能只有企业版才有」有 4 篇标准答案,一道题就占了 9 篇里的 4 篇;「导入的时候报 E1043」只有 1 篇,只占九分之一。宏平均里每道题都是四分之一,一样重。

用前端的话说:你在统计一个页面所有接口的成功率。微平均是把所有请求的成功数加起来除以总请求数,调得多的接口说了算;宏平均是每个接口先算自己的成功率,再取平均,冷门接口和热门接口一样重要。两种都对,看你想回答什么问题。评估集里我们关心的是「每类用户问题都照顾到了没有」,所以 Day 256 和以后的脚本都用宏平均。

今天的小项目就是把 Day 253 的对比换成这周的量法重跑一遍,再顺手看一个 Day 259 要讲的坑:先取 4 块再去重,文章可能凑不够 4 篇。新建 `part04/review37_rescore.py`:

```python
# agent-zero-lab/part04/review37_rescore.py  第 37 周小项目:用 Day 256 的三把尺子,重新量一遍 Day 253 的「图检索 vs 混合检索」
from part04.kg_compare import CASES, graph_docs
from part04.kg_local import client
from part04.metrics import dedup_docs, mrr, precision_at_k, recall_at_k, reciprocal_rank
from part04.retrieve import retrieve

K = 4


def hybrid_docs(question: str, n_chunks: int) -> list[str]:
    return dedup_docs([c.doc_id for c, _ in retrieve(question, k=n_chunks)])


SYSTEMS = {
    "混合(取4块)": lambda q: hybrid_docs(q, 4),
    "混合(取10块)": lambda q: hybrid_docs(q, 10),
    "图检索": lambda q: graph_docs(q, k=K),
}

if __name__ == "__main__":
    for name, fn in SYSTEMS.items():
        recalls, precisions, rrs = [], [], []
        hit_total = 0
        for q, gold in CASES:
            docs = fn(q)
            recalls.append(recall_at_k(docs, gold, K))
            precisions.append(precision_at_k(docs, gold, K))
            rrs.append(reciprocal_rank(docs, gold))
            hit_total += len(gold & set(docs[:K]))
            print(f"  {name} {q[:10]:<10} 拿到 {docs[:K]}  R={recalls[-1]:.2f} P={precisions[-1]:.2f} RR={rrs[-1]:.2f}")
        n_gold = sum(len(g) for _, g in CASES)
        print(f"{name}: 合在一起数 {hit_total}/{n_gold}  平均recall@4 {sum(recalls)/len(recalls):.3f}"
              f"  平均precision@4 {sum(precisions)/len(precisions):.3f}  MRR {mrr(rrs):.3f}\n")
    print("---", client.ledger)
```

<div class="line-notes">

- `from part04.kg_compare import CASES, graph_docs` 直接复用 Day 253 的四道题和图检索函数,题和找法一个字不改,只换打分方式。这样比出来的差别只来自量法。`CASES` 是 `(问题, 标准答案文章集合)` 的列表,比如第三道是 `("月付专业版能开增值税专用发票吗?", {"kb-006"})`。
- `from part04.kg_local import client` 图检索里挑种子要调模型,`client` 是 Day 253 那个模块里建好的 `LLMClient`,最后打印它的账本看花了多少钱。
- `from part04.metrics import dedup_docs, mrr, precision_at_k, recall_at_k, reciprocal_rank` Day 256 写的五个函数全用上了。
- `from part04.retrieve import retrieve` Day 240 的检索流水线,默认 `mode="hybrid+rerank"`。一导入就会连 Postgres,Postgres.app 没开会报 `connection failed`。
- `K = 4` 和 Day 253 一样只看前 4 名。
- `def hybrid_docs(question: str, n_chunks: int) -> list[str]:` 和 Day 253 的 `hybrid_docs` 几乎一样,只是把「取几块」变成参数。Day 253 写的是 `list(dict.fromkeys(...))`,效果和 `dedup_docs` 相同,都是保序去重。
- `return dedup_docs([c.doc_id for c, _ in retrieve(question, k=n_chunks)])` `retrieve` 返回 `(块, 分数)` 的列表,只要块的 `doc_id`,再去重成文章级排名。第三道题取 4 块时,块是 `kb-006` 两块加 `kb-001`、`kb-003` 各一块,去重后只剩 3 篇。
- `SYSTEMS = {` 三套找法放进一个字典,键是名字,值是「给问题、返回文章列表」的函数。相当于 JS 的 `{ "图检索": q => graphDocs(q, 4) }`。
- `"混合(取4块)": lambda q: hybrid_docs(q, 4),` Day 253 原来的做法。`lambda` 是一行的匿名函数,相当于箭头函数 `q => hybridDocs(q, 4)`。
- `"混合(取10块)": lambda q: hybrid_docs(q, 10),` 先多取一些块再去重,保证凑得够 4 篇文章。这一行是为 Day 259 埋的伏笔。
- `"图检索": lambda q: graph_docs(q, k=K),` 图检索按「边离种子多近」给文章打分,取前 4 篇。
- `recalls, precisions, rrs = [], [], []` 三个空列表,每道题算完往里放一个数,最后求平均,这就是宏平均。
- `hit_total = 0` 另外按 Day 253 的老办法累加命中篇数,这就是微平均的分子。
- `for q, gold in CASES:` 四道题依次跑。
- `recalls.append(recall_at_k(docs, gold, K))` 第一道题混合检索拿到 `['kb-019', 'kb-018', 'kb-015', 'kb-001']`,标准答案 4 篇里中了 kb-019、kb-018、kb-001 三篇,recall@4 = 3/4 = 0.75。
- `precisions.append(precision_at_k(docs, gold, K))` 同一道题 4 个名额里 3 个有用,precision@4 = 0.75。第三道题只有 1 篇标准答案,precision@4 最多 0.25,这不是检索的错,Day 256 讲过。
- `rrs.append(reciprocal_rank(docs, gold))` 第一个有用的排第几,取倒数。图检索第三道题拿到 `['kb-001', 'kb-006', ...]`,kb-006 排第 2,RR = 0.5。
- `hit_total += len(gold & set(docs[:K]))` 集合交集 `&` 的大小就是这道题中了几篇,和 Day 253 的 `hits()` 一样。
- `print(f"  {name} {q[:10]:<10} 拿到 {docs[:K]}  R={recalls[-1]:.2f} P={precisions[-1]:.2f} RR={rrs[-1]:.2f}")` `q[:10]` 只打问题前 10 个字,`:<10` 左对齐占 10 格;`recalls[-1]` 是刚放进去的最后一个数,`-1` 下标相当于 JS 的 `.at(-1)`。
- `n_gold = sum(len(g) for _, g in CASES)` 四道题标准答案篇数之和,4 + 3 + 1 + 1 = 9。
- `print(f"{name}: 合在一起数 {hit_total}/{n_gold}  平均recall@4 {sum(recalls)/len(recalls):.3f}"` 同一行里同时打微平均(`hit_total/n_gold`)和宏平均(`sum(recalls)/len(recalls)`),方便对比。
- `f"  平均precision@4 {sum(precisions)/len(precisions):.3f}  MRR {mrr(rrs):.3f}\n")` 两段 f-string 挨着写会自动拼成一个字符串,和 JS 里用 `+` 拼一样,只是不用写加号。
- `print("---", client.ledger)` 只有图检索调了模型,四道题四次。

</div>

在 `agent-zero-lab/` 下跑(`-W ignore` 是为了不看 jieba 那条 SyntaxWarning,Day 253 讲过它只是警告):

```bash
uv run python -W ignore -m part04.review37_rescore
```

```text
  混合(取4块) 哪些功能只有企业版才 拿到 ['kb-019', 'kb-018', 'kb-015', 'kb-001']  R=0.75 P=0.75 RR=1.00
  混合(取4块) 我用优惠码买了年付专 拿到 ['kb-002', 'kb-008', 'kb-003']  R=1.00 P=0.75 RR=1.00
  混合(取4块) 月付专业版能开增值税 拿到 ['kb-006', 'kb-001', 'kb-003']  R=1.00 P=0.25 RR=1.00
  混合(取4块) 导入的时候报 E10 拿到 ['kb-011', 'kb-009', 'kb-010']  R=1.00 P=0.25 RR=1.00
混合(取4块): 合在一起数 8/9  平均recall@4 0.938  平均precision@4 0.500  MRR 1.000

  混合(取10块) 哪些功能只有企业版才 拿到 ['kb-019', 'kb-018', 'kb-015', 'kb-001']  R=0.75 P=0.75 RR=1.00
  混合(取10块) 我用优惠码买了年付专 拿到 ['kb-002', 'kb-008', 'kb-003', 'kb-006']  R=1.00 P=0.75 RR=1.00
  混合(取10块) 月付专业版能开增值税 拿到 ['kb-006', 'kb-001', 'kb-003', 'kb-002']  R=1.00 P=0.25 RR=1.00
  混合(取10块) 导入的时候报 E10 拿到 ['kb-011', 'kb-009', 'kb-010', 'kb-016']  R=1.00 P=0.25 RR=1.00
混合(取10块): 合在一起数 8/9  平均recall@4 0.938  平均precision@4 0.500  MRR 1.000

  图检索 哪些功能只有企业版才 拿到 ['kb-001', 'kb-020', 'kb-018', 'kb-006']  R=0.75 P=0.75 RR=1.00
  图检索 我用优惠码买了年付专 拿到 ['kb-002', 'kb-001', 'kb-003', 'kb-006']  R=0.67 P=0.50 RR=1.00
  图检索 月付专业版能开增值税 拿到 ['kb-001', 'kb-006', 'kb-018', 'kb-020']  R=1.00 P=0.25 RR=0.50
  图检索 导入的时候报 E10 拿到 ['kb-011', 'kb-009', 'kb-010']  R=1.00 P=0.25 RR=1.00
图检索: 合在一起数 7/9  平均recall@4 0.854  平均precision@4 0.438  MRR 0.875

--- 4 次调用 | 输入 2326 / 输出 100 tokens | 约 ¥0.0024
```

先看最后一组。Day 253 说图检索 6/9,今天跑出来是 7/9。区别在第一道题:今天图检索拿到了 kb-006,Day 253 那次拿到的是 kb-014。我又跑了两次:

```text
  图检索 哪些功能只有企业版才 拿到 ['kb-001', 'kb-014', 'kb-018', 'kb-020']  R=0.50 P=0.50 RR=1.00
图检索: 合在一起数 6/9  平均recall@4 0.792  平均precision@4 0.375  MRR 0.875
```

两次都是这个结果。三次分别是 7/9、6/9、6/9。原因在挑种子那一步:`link_entities` 每次让模型从实体列表里挑最多 5 个,`temperature=0` 也不保证每次挑的一样(Day 252 抽三元组时就见过 121 条和 123 条),种子不同,走出来的邻域就不同。混合检索三次结果完全一样,它没有调模型这一步。这和 Day 254 global search 跑三轮 17、20、18 是同一件事:**流程里只要有一步调模型,评测就得多跑几次看分布**,Day 253 那个 6/9 只是三次里的一次。

再看三个数。混合检索的 MRR 是 1.000,四道题第一名都是有用的文章;图检索 0.875,输在第三道题,把 kb-001(套餐与价格)排在了 kb-006(发票)前面。「合在一起数」的 8/9 是 0.889,而平均 recall@4 是 0.938,差的就是微平均和宏平均:第一道题 recall 0.75,在微平均里它的 4 篇占了 9 篇的大头,把总分拉得更低。

最后看「取 4 块」和「取 10 块」。分数一模一样,但第二到第四题,取 4 块时只拿到 3 篇文章,`docs[:4]` 其实只有 3 个元素。这四道题恰好没受影响,因为漏掉的位置上本来也不是标准答案。换一批题就不一定了,Day 259 会在 26 道题上实测到一道被冤枉的。

零件对照表,看看小项目的每一段来自哪一天:

| 零件 | 来自 | 在小项目里是 |
| --- | --- | --- |
| 四道题和图检索 `graph_docs` | Day 253 `kg_compare.py` | `CASES`、`SYSTEMS["图检索"]` |
| 挑种子要调模型,结果会变 | Day 252、Day 254 | 三次 7/9、6/9、6/9 |
| 块转文章、保序去重 | Day 256 `dedup_docs` | `hybrid_docs` |
| recall@k、precision@k、倒数排名、MRR | Day 256 `metrics.py` | 循环里的三个 `append` 和最后的 `mrr` |
| 一道题占多少分量 | Day 257「30 条够不够」 | 微平均 vs 宏平均 |

## 本周错题与坑清单

这一周我自己踩过、或者在实跑里看到的坑,按天列出来。复习时一条条问自己:这个坑我还会不会踩?

- **不开 JSON 模式,自己去剥代码围栏。** Day 252 第一次让模型输出三元组,交回来的是 ```` ```json ```` 开头的文字,`json.loads` 报 `JSONDecodeError`。开 `response_format={"type": "json_object"}`。
- **白名单只写在提示词里,代码里不查。** 模型今天守规矩,不代表明天也守。`if rel not in RELATIONS` 一行代码,写上。
- **关系只给名字不给意思。** 「发生在」被乱用了 17 次。名字只是标签,要告诉模型头和尾各是什么类型。
- **以为 `temperature=0` 每次都一样。** Day 252 两次抽取 121 和 123 条,今天图检索三次 7/9、6/9、6/9。
- **只看最终回答,不打印中间结果。** Day 253 的 E4029 那题回答句句带出处,价格却是错的,打印种子和边数才看出图断开了。
- **以为图能代替原文。** 「468 元退 351 元」这种计算规则三元组装不下,图负责定位,回答要带原文。
- **map 提示词照着普通问答写。** Day 254 第一版 19 个社区全回答「无」,要告诉 map 它只负责一小块,沾边就列。
- **扔掉小社区。** 漏掉的五条规则里四条在小社区里,并成一个零散社区就捡回来了。
- **只看端到端对错。** Day 255 两套配置都是 3/6,一个病在检索、一个病在生成。不分层,你会去修错的那一层。
- **空集合是任何集合的子集。** Day 255 判检索层时用 `expected <= got`,无答案题的空集合永远判「检索对」。
- **拿块 id 和文章 id 比。** `"kb-009#1" != "kb-009"`,recall 永远是 0.0,而且不报错。
- **`enumerate` 忘了 `start=1`。** 名次从 0 开始,`1.0 / 0` 直接 `ZeroDivisionError`。
- **无答案题进了检索层分母。** `len(expected)` 是 0,`ZeroDivisionError: division by zero`。
- **评估集里的题都照着文档问。** 口语式问法 BM25 倒数排名直接掉到 0。
- **用 `json.loads` 读整个 JSONL。** `Extra data: line 2 column 1`,要一行一行读。
- **合在一起数和每题平均混着比。** 今天的 8/9(0.889)和 0.938 是同一批结果的两种平均法,写报告时要说清楚用的哪种。

## 动手练习

**练习 1:默写 `metrics.py`。** 合上文章,在一个新文件 `part04/review37_metrics.py` 里写出 `dedup_docs`、`recall_at_k`、`precision_at_k`、`hit_at_k`、`reciprocal_rank`、`mrr` 六个函数,然后用 Day 256 那道手算题验算:块级排名 `kb-009, kb-009, kb-010, kb-010, kb-014, kb-020`,标准答案 `{kb-009, kb-011}`,算 k=2 时的三个数和倒数排名,再算 `[1.0, 1/3, 1.0]` 的 MRR。

<details><summary>参考答案</summary>

写完和 Day 256 的 `metrics.py` 对一遍,应该一模一样:

```python
# agent-zero-lab/part04/review37_metrics.py  默写 Day 256 的检索指标
def dedup_docs(chunk_doc_ids: list[str]) -> list[str]:
    seen: list[str] = []
    for d in chunk_doc_ids:
        if d not in seen:
            seen.append(d)
    return seen


def recall_at_k(retrieved: list[str], expected: set[str], k: int) -> float:
    return len(expected & set(retrieved[:k])) / len(expected)


def precision_at_k(retrieved: list[str], expected: set[str], k: int) -> float:
    return len(expected & set(retrieved[:k])) / k


def hit_at_k(retrieved: list[str], expected: set[str], k: int) -> float:
    return 1.0 if expected & set(retrieved[:k]) else 0.0


def reciprocal_rank(retrieved: list[str], expected: set[str]) -> float:
    for rank, d in enumerate(retrieved, start=1):
        if d in expected:
            return 1.0 / rank
    return 0.0


def mrr(rrs: list[float]) -> float:
    return sum(rrs) / len(rrs)


if __name__ == "__main__":
    r = dedup_docs(["kb-009", "kb-009", "kb-010", "kb-010", "kb-014", "kb-020"])
    print(r)
    exp = {"kb-009", "kb-011"}
    print(recall_at_k(r, exp, 2), precision_at_k(r, exp, 2), hit_at_k(r, exp, 2))
    print(reciprocal_rank(r, exp), reciprocal_rank(["kb-007", "kb-001", "kb-015"], {"kb-015"}))
    print(round(mrr([1.0, 1 / 3, 1.0]), 3))
```

<div class="line-notes">

- `seen: list[str] = []` 用列表而不是集合存「见过的」,因为要保住顺序。集合不保证顺序,排名就丢了。
- `if d not in seen:` 第一次见到才放进去,所以同一篇文章只留排得最靠前的那块。`kb-009, kb-009, kb-010, kb-010, kb-014, kb-020` 变成 `kb-009, kb-010, kb-014, kb-020`。
- `return len(expected & set(retrieved[:k])) / len(expected)` recall 的分母是标准答案篇数。k=2 时前两篇是 kb-009、kb-010,中了 kb-009 一篇,1/2 = 0.5。
- `return len(expected & set(retrieved[:k])) / k` precision 的分母是 k。同样中 1 篇,1/2 = 0.5。
- `return 1.0 if expected & set(retrieved[:k]) else 0.0` 交集非空就是命中。这里中了,1.0。
- `for rank, d in enumerate(retrieved, start=1):` 名次从 1 开始。忘了 `start=1`,第一名的倒数就是 `1.0 / 0`。
- `return 1.0 / rank` kb-009 排第 1,RR = 1.0;第二个例子 kb-015 排第 3,RR = 0.333…。
- `return 0.0` 一篇都没找到,倒数排名记 0。
- `return sum(rrs) / len(rrs)` (1 + 0.333 + 1) / 3 = 0.778。

</div>

```bash
uv run python -m part04.review37_metrics
```

```text
['kb-009', 'kb-010', 'kb-014', 'kb-020']
0.5 0.5 1.0
1.0 0.3333333333333333
0.778
```

和 Day 256 纸上算的一样。如果你写出来 recall 是 0.0,八成是忘了先 `dedup_docs`、拿块 id 去比了。

</details>

**练习 2:默写 `eval_set.py` 的两个函数。** 合上文章写出 `load_eval_set()`(逐行读 JSONL、跳过空行)和 `check_eval_set()`(id 重复、未知题型、文章不存在、无答案题和文章列表对不上、multi 少于两篇、没有要点,六条检查)。写完不要另起文件名,直接覆盖 `part04/eval_set.py` 前先备份一份原文件,跑 `eval_set` 和 `check_broken` 两个脚本。

<details><summary>参考答案</summary>

先 `cp part04/eval_set.py part04/eval_set.bak.py` 备份,再写:

```python
# agent-zero-lab/part04/eval_set.py  读评估集,并检查它有没有低级错误(第 37 周默写版)
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EVAL_PATH = ROOT / "data" / "eval" / "rag_eval.jsonl"
KB_DIR = ROOT / "data" / "kb"
TYPES = {"policy", "error_code", "colloquial", "multi", "unanswerable"}


def load_eval_set(path: Path = EVAL_PATH) -> list[dict]:
    rows = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def check_eval_set(rows: list[dict]) -> list[str]:
    known_docs = {p.stem for p in KB_DIR.glob("kb-*.md")}
    problems = []
    ids = Counter(r["id"] for r in rows)
    problems += [f"{i}: id 重复 {n} 次" for i, n in ids.items() if n > 1]
    for r in rows:
        rid, docs, typ = r["id"], r["expected_docs"], r["type"]
        if typ not in TYPES:
            problems.append(f"{rid}: 未知题型 {typ}")
        for d in docs:
            if d not in known_docs:
                problems.append(f"{rid}: 文章 {d} 不存在")
        if (typ == "unanswerable") != (len(docs) == 0):
            problems.append(f"{rid}: 题型 {typ} 和 expected_docs={docs} 对不上")
        if typ == "multi" and len(docs) < 2:
            problems.append(f"{rid}: multi 题至少要两篇文章")
        if not r["answer_points"]:
            problems.append(f"{rid}: 没有 answer_points")
    return problems


if __name__ == "__main__":
    rows = load_eval_set()
    print(f"共 {len(rows)} 条")
    for typ, n in Counter(r["type"] for r in rows).most_common():
        print(f"  {typ:<13}{n}")
    problems = check_eval_set(rows)
    print("检查结果:", problems or "没有问题")
```

<div class="line-notes">

- `ROOT = Path(__file__).resolve().parent.parent` 从 `part04/eval_set.py` 退两层到 `agent-zero-lab/`,从哪个目录运行都能找到数据。
- `def load_eval_set(path: Path = EVAL_PATH) -> list[dict]:` 默认读 v1,Day 259 练习 4 会传 v2 的路径进来。
- `for line in f:` 逐行读,每行单独 `json.loads`。一口气 `json.loads(整个文件)` 会报 `Extra data`。
- `if line.strip():` 文件末尾多一个空行很常见,不跳过就是 `Expecting value`。
- `known_docs = {p.stem for p in KB_DIR.glob("kb-*.md")}` 合法文章名单从真实文件来,20 个。
- `ids = Counter(r["id"] for r in rows)` 数每个 id 出现几次,大于 1 就是重复。
- `if (typ == "unanswerable") != (len(docs) == 0):` 两个布尔值应该同真同假,不相等就是标错了:无答案题标了文章,或者普通题忘了标。
- `if not r["answer_points"]:` 空列表为假。没有要点,Day 260 的完整裁判就没东西可对照。
- `print("检查结果:", problems or "没有问题")` 空列表为假,所以打印「没有问题」。

</div>

```bash
uv run python -m part04.eval_set
uv run python -m part04.check_broken
```

```text
共 30 条
  policy       10
  error_code   6
  colloquial   6
  multi        4
  unanswerable 4
检查结果: 没有问题
q12: 文章 kb-0111 不存在
q23: multi 题至少要两篇文章
q30: 题型 unanswerable 和 expected_docs=['kb-016'] 对不上
```

和 Day 257 的输出一样就算默写对了。对不上的话用 `diff part04/eval_set.py part04/eval_set.bak.py` 看差在哪,确认没问题后可以删掉备份。

</details>

**练习 3:把 Day 253 的四道题写成评估集格式。** 小项目里那四道题还只是 `(问题, 集合)` 元组。按 Day 257 的五个字段把它们写成四条用例(id 用 g01–g04),要点对着帮助中心原文写,然后交给 `check_eval_set` 检查。故意按你的直觉给第一道题起一个题型名,看检查脚本怎么说。写 `part04/ex258_3.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex258_3.py  练习 3:把 Day 253 的 4 道对比题写成评估集格式,交给 Day 257 的检查脚本
from part04.eval_set import check_eval_set

GRAPH4 = [
    {"id": "g01", "question": "哪些功能只有企业版才有?", "expected_docs": ["kb-001", "kb-006", "kb-018", "kb-019"],
     "type": "enumerate", "answer_points": ["开放 API", "误删数据可从备份恢复", "专属客服"]},
    {"id": "g02", "question": "我用优惠码买了年付专业版,开过增值税专票,第 3 个月想退款,要先做什么、能退多少?",
     "expected_docs": ["kb-002", "kb-003", "kb-008"], "type": "multi", "answer_points": ["先红冲发票", "按剩余整月比例退", "优惠部分不退现金"]},
    {"id": "g03", "question": "月付专业版能开增值税专用发票吗?", "expected_docs": ["kb-006"], "type": "policy", "answer_points": []},
    {"id": "g04", "question": "导入的时候报 E1043", "expected_docs": ["kb-011"], "type": "error_code", "answer_points": ["文件不是 UTF-8"]},
]

for p in check_eval_set(GRAPH4):
    print(p)
```

<div class="line-notes">

- `"type": "enumerate", "answer_points": ["开放 API", "误删数据可从备份恢复", "专属客服"]},` 「哪些功能只有企业版有」是枚举题,直觉上想起名 enumerate。要点对着原文:kb-019「开放 API 仅对企业版开放」、kb-018「企业版客户误删数据后,可以申请从备份恢复」、kb-001「企业版……包含开放 API、专属客服和增值税专用发票」。注意专票不算「只有企业版」,kb-006 写的是「仅限企业版,或年付的专业版」。
- `"expected_docs": ["kb-002", "kb-003", "kb-008"], "type": "multi",` 一句话里问了「先做什么」和「能退多少」,还牵扯优惠码,三篇文章。
- `"type": "policy", "answer_points": []},` 故意留空,看检查脚本能不能抓到。
- `for p in check_eval_set(GRAPH4):` `check_eval_set` 只要求传进来的是字典列表,不在乎它是从文件读的还是在代码里写的。

</div>

```bash
uv run python -m part04.ex258_3
```

```text
g01: 未知题型 enumerate
g03: 没有 answer_points
```

两条都抓到了。g03 补上要点「月付专业版不能开专票」就好;g01 要想一下:是把 `enumerate` 加进 `TYPES`,还是归到现有的某一类?我的看法是加。枚举题恰好是 Day 253 里图检索擅长、向量检索容易漏的那一类,单独成一类,以后才能按题型看出两种检索的差别。加题型就是改评估集的「规矩」,之后的分数要标成新版本,不能和 v1 直接比。

</details>

**练习 4:默写 Day 252 的类型规则检查。** 合上文章,写一个 `problems(h, r, t)`,对一条三元组返回问题描述或 `None`,规则是:关系不在白名单;「仅限 / 可用于 / 不适用于」的头是套餐而尾不是(头尾颠倒);这三种关系的尾不是套餐;「包含」的头不是套餐;「发生在」的头不是 E 加四位数字的错误码。在 `kg_llm.db` 的边上跑一遍,统计每种问题几条,再用三条手写的三元组测一下。写 `part04/ex258_4.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex258_4.py  练习 4:默写 Day 252 的类型规则检查,数一数模型建的图里有几条可疑的边
import re
from collections import Counter

from part04.kg_store import RELATIONS, load_edges

PLANS = {"免费版", "专业版", "企业版", "年付专业版"}
TAIL_IS_PLAN = {"仅限", "可用于", "不适用于"}
HEAD_IS_PLAN = {"包含"}
ERROR_CODE = re.compile(r"E\d{4}")


def problems(h: str, r: str, t: str) -> str | None:
    if r not in RELATIONS:
        return "不在白名单"
    if r in TAIL_IS_PLAN and h in PLANS and t not in PLANS:
        return "头尾颠倒"
    if r in TAIL_IS_PLAN and t not in PLANS:
        return "尾不是套餐"
    if r in HEAD_IS_PLAN and h not in PLANS:
        return "头不是套餐"
    if r == "发生在" and not ERROR_CODE.fullmatch(h):
        return "头不是错误码"
    return None


edges = load_edges()
found = Counter()
for e in edges:
    why = problems(e["head"], e["rel"], e["tail"])
    if why:
        found[why] += 1
        print(f"  {why}  ({e['head']}, {e['rel']}, {e['tail']})  {e['doc_id']}")
print(f"{len(edges)} 条边,可疑 {sum(found.values())} 条:", dict(found))
print("测试:", problems("企业版", "仅限", "开放 API"), problems("E1043", "发生在", "导入银行流水"), problems("专业版", "便宜", "免费版"))
```

<div class="line-notes">

- `from part04.kg_store import RELATIONS, load_edges` Day 252 的 13 种关系白名单和读边函数。白名单从同一个地方 import,提示词和检查用的是同一份,不会一处改了另一处忘改。
- `TAIL_IS_PLAN = {"仅限", "可用于", "不适用于"}` 这三种关系约定「头是功能或单据,尾是套餐」,比如(开放 API,仅限,企业版)。
- `ERROR_CODE = re.compile(r"E\d{4}")` E 后面四位数字。`r"..."` 是原始字符串,反斜杠不转义。
- `if r not in RELATIONS:` Day 252 原版没有这条,因为抽取时已经在代码里过滤过;默写时加上,检查函数自己也能挡住白名单外的关系。
- `if r in TAIL_IS_PLAN and h in PLANS and t not in PLANS:` 头是套餐、尾不是,八成是写反了。顺序很重要:这条要放在「尾不是套餐」前面,不然头尾颠倒的边会先被归成「尾不是套餐」。
- `if r == "发生在" and not ERROR_CODE.fullmatch(h):` `fullmatch` 要求整串都匹配,`"E1043 报错"` 这种多了字的也不算。
- `found = Counter()` 按问题类型计数。
- `print("测试:", problems("企业版", "仅限", "开放 API")` 三条手写的:第一条故意写反,第二条是对的,第三条用了白名单外的「便宜」。

</div>

```bash
uv run python -m part04.ex258_4
```

```text
  尾不是套餐  (电子普通发票, 可用于, 所有付费订单)  kb-006
  头尾颠倒  (专业版, 可用于, 多币种记账)  kb-020
  头尾颠倒  (企业版, 可用于, 多币种记账)  kb-020
89 条边,可疑 3 条: {'尾不是套餐': 1, '头尾颠倒': 2}
测试: 头尾颠倒 None 不在白名单
```

89 条边、3 条可疑,和 Day 252 第二版提示词的结果一样。第一条其实不算错,「所有付费订单」确实不是套餐,只是这条规则管不到这种说法;后两条是真的写反了。类型规则只能抓「形状不对」的边,抓不到「形状对、内容错」的边,那要靠标准答案去对。

</details>

**验收标准:** 练习 1、2 合上文章写出来,输出和 Day 256、Day 257 一致;小项目跑通,能说清为什么图检索三次结果不同、8/9 和 0.938 为什么不一样;能对着知识地图讲出六天各干了什么。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 微平均(micro average) | 把所有题的命中数加起来,除以所有题的标准答案总数。标准答案多的题分量重。Day 253 的 8/9 就是 |
| 宏平均(macro average) | 每道题先算自己的分数,再对题数求平均,每道题一样重。Day 256 以后的 recall@k、MRR 都是 |
| 复核(re-scoring) | 不改系统,只换一种量法,把旧结果重新打分,看结论变不变 |
| 结果分布 | 同一份代码跑多次得到的一串数字,比如今天图检索的 7/9、6/9、6/9。流程里有模型调用时,要看分布而不是一次 |

本周其他术语(三元组、local search、global search、社区、map-reduce、recall@k、precision@k、MRR、评估集、JSONL)第一次出现时已在对应那天的名词表里,复习时回去看。

## 常见误区

**以为换个量法只是换个说法。** Day 253 的 6/9 对 8/9 只说明「找到的篇数」,换成 MRR 才看出图检索在第三道题把答案排到了第二。不同的指标回答不同的问题,结论可能跟着变。

**拿一次运行的数字下结论。** 图检索三次 7/9、6/9、6/9,Day 253 恰好拿到其中一次。只要流程里有一步调模型,就至少跑三次。

**微平均和宏平均混着比。** 8/9 是 0.889,平均 recall@4 是 0.938,同一批结果。拿上周报告里的 0.889 和这周脚本算的 0.938 比,会以为系统变好了。

**以为取 4 块就是拿到 4 篇。** 今天第二到第四题取 4 块去重后都只剩 3 篇。分数这次没受影响是运气,Day 259 会看到被冤枉的那道题。

**评估集里只有 v1 那五种题型。** 练习 3 的枚举题装不进去。题型是你自己定的规矩,发现新的用户问法就加一类,但要记版本。

**复习日只看不写。** 默写 `metrics.py` 时最容易写错的是 `start=1` 和先 `dedup_docs`,不亲手写一遍是发现不了的。

## 学习资料

### 文档与文章

- [From Local to Global: A Graph RAG Approach to Query-Focused Summarization(arXiv 2404.16130)](https://arxiv.org/abs/2404.16130):本周前三天的出处。复习时读第 3 节(社区摘要和 map-reduce)和评估那一节,注意论文的评估也是让大模型当裁判两两比较,这正是 Day 260 要讲的。
- [Microsoft GraphRAG 文档](https://microsoft.github.io/graphrag/):官方实现的说明,看「Query」下 local search 和 global search 两页,对照自己写的 `kg_local.py`。
- [Evidently AI · Precision and recall at K](https://www.evidentlyai.com/ranking-metrics/precision-recall-at-k):英文,带图讲 recall@k 和 precision@k,复习 Day 256 用。
- [Evidently AI · Mean Reciprocal Rank (MRR)](https://www.evidentlyai.com/ranking-metrics/mean-reciprocal-rank-mrr):MRR 的图解,还讲了它只看第一个正确结果的局限。
- [Jason Liu · Systematically Improving Your RAG](https://jxnl.co/writing/2024/05/22/systematically-improving-your-rag/):先建检索评估、再按题型拆开找短板,和 Day 257、Day 259 的路子一样。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1zoKuzoENM&autoplay=0&high_quality=1" title="AI知识图谱 GraphRAG 是怎么回事?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>隔壁的程序员老王 · AI知识图谱 GraphRAG 是怎么回事? · 14 分钟,把抽实体、建图、社区摘要、local 和 global 两种查法串一遍,正好用来复习本周前三天。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1b69gB5E3h&autoplay=0&high_quality=1" title="面试官问:如何评估RAG系统的效果?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI深度幻觉 · 面试官问:如何评估RAG系统的效果? · 12 分钟,检索层和生成层分开评、测试集怎么来,复习后三天时完整听一遍,看看自己能不能先说出下一句。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/cRz0BWkuwHg" title="Key Metrics and Evaluation Methods for RAG" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>What's AI by Louis-François Bouchard · Key Metrics and Evaluation Methods for RAG · 英文,把检索指标和生成指标放在一张图里讲,开自动字幕。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/JTVx6i6MzVw" title="GraphRAG: Building a Smarter AI System (full walkthrough)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Thu Vu · GraphRAG: Building a Smarter AI System (full walkthrough) · 英文,用微软官方 GraphRAG 从建索引到查询跑一遍,和我们手写的版本对照着看。</figcaption>
</figure>

### 书籍

- Christopher D. Manning、Prabhakar Raghavan、Hinrich Schütze《Introduction to Information Retrieval》(Cambridge University Press,2008),中文版《信息检索导论》(王斌译,人民邮电出版社)。第 8 章「信息检索的评价」讲 precision、recall 和微平均、宏平均,斯坦福 NLP 组网站上有免费的英文在线版(按书名搜索)。
- Chip Huyen《AI Engineering》(O'Reilly,2025)第 4 章「Evaluate AI Systems」:按切片看分数、评估流程怎么设计,对应 Day 257。

### 开源项目与代码

- [microsoft/graphrag](https://github.com/microsoft/graphrag):官方实现,读 `graphrag/prompts/` 目录下抽取和社区摘要的提示词,和 Day 252、Day 254 自己写的比一比。
- [beir-cellar/beir](https://github.com/beir-cellar/beir):检索评测基准,看它怎么用 qrels 存「哪道题对应哪篇文档」、怎么算 recall@k 和 MRR。

## 自测

**1. Day 253 的「图检索 6/9」是微平均还是宏平均?换成宏平均,图检索今天第一次运行的平均 recall@4 是多少?**

<details><summary>答案</summary>

微平均:四道题命中的篇数加起来除以 9 篇。今天第一次运行图检索四道题的 recall@4 是 0.75、0.67、1.00、1.00,宏平均是 (0.75 + 0.667 + 1 + 1) / 4 ≈ 0.854。

</details>

**2. 图检索三次运行是 7/9、6/9、6/9,混合检索三次都是 8/9。为什么一个会变一个不会?**

<details><summary>答案</summary>

图检索第一步 `link_entities` 要调大模型从实体列表里挑种子,即使 `temperature=0` 每次挑的也可能不同,种子不同走出来的邻域就不同。混合检索只有 embedding、BM25 和 rerank,没有生成这一步,同样的输入得到同样的排名。

</details>

**3. 「取 4 块」和「取 10 块」今天分数一样,能不能说明取几块不重要?**

<details><summary>答案</summary>

不能。取 4 块时有三道题去重后只剩 3 篇文章,只是这四道题第 4 名的位置上本来也不是标准答案,所以分数没变。换一批题、尤其是一句两问的题,第二篇答案可能就排在第 5 到第 10 块里,取 4 块会被冤枉。

</details>

**4. 写 `metrics.py` 时,哪两处写错会直接报 `ZeroDivisionError`,哪一处写错不报错但永远是 0?**

<details><summary>答案</summary>

`enumerate` 忘了 `start=1`(答案排第一时 `1.0 / 0`),和无答案题进了 recall 的分母(`len(expected)` 是 0)会报错。拿块 id(`kb-009#1`)去和文章 id(`kb-009`)比,集合交集永远是空,recall 永远是 0.0,不报错。

</details>

**5.(面试题)你同事说「我们试了 GraphRAG,比向量检索差,6/9 对 8/9」,你会追问哪些问题?**

<details><summary>答案</summary>

先问量法:几道题,题从哪来,有没有覆盖图擅长的枚举和多跳题;6/9 是合在一起数还是每题平均,排名看了没有,MRR 和 recall 各是多少。再问稳定性:图检索里挑种子、抽三元组都调模型,跑了几次,分布是什么样。最后问分层:比的是找文章还是最终回答,如果是回答,错在检索还是生成。我们自己的实测里,四道题图检索三次是 7/9、6/9、6/9,MRR 0.875 对混合检索的 1.000,题太少,只能说在这个小知识库上找文章不占优,不能说 GraphRAG 没用。

</details>

## 明天预告

Day 259 · RAG 评估(四):检索评估脚本。这周有了尺子(三个指标)和题库(30 条评估集),今天还只在 Day 253 的四道题上手动量了一下。明天把它们接成一个脚本 `eval_retrieval.py`:26 道有答案的题、四种检索方式一次跑完,按题型拆开,列出失败题,也会在 26 道题上碰到今天提到的「取 4 块被冤枉」那一道。
