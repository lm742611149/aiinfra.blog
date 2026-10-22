---
title: 'Day 256 · RAG 评估(二):手算三个检索指标'
description: '昨天检索层只有「对」和「错」。今天把它拆成三个数:recall@k 看该找的找到了几成,precision@k 看拿到的里面几成有用,MRR 看第一个有用的排第几。先拿三道真题在纸上手算,再写成 metrics.py 验算:向量检索 MRR 1.000,混合+rerank 0.778,BM25 0.667;顺手踩三个坑,两个直接 ZeroDivisionError,一个不报错但永远算出 0。'
pubDate: 2026-10-22
regime: none
tags: ['rag-evaluation', 'recall', 'mrr', 'python', 'agent-zero']
series: 'agent-zero'
day: 256
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 255](/blog/agent-zero/day-255-rag-eval-1/) 把 RAG 评估拆成了两层:检索层看「该用的文章进没进 top-k」,生成层看「回答对不对、有没有依据、该拒答时拒答没有」。6 道题跑三套配置,BM25 那套和宽松提示词那套端到端都是 3/6,一个病在检索、一个病在生成。

可昨天的检索层只给了一个是非题。「年付企业版第 3 个月想退」要两篇文章,拿到一篇,和一篇都没拿到,都记「检索错」;答案排第 1 名和排第 4 名,都记「检索对」。是非题分不出好坏程度,也就比不出两套检索谁更好一点。今天把它拆成三个能比大小的数。

## 今天要解决的问题

学完你应该能做到:

1. 拿一份排好序的检索结果和标准答案,在纸上手算 recall@k、precision@k 和倒数排名,再对多道题求 MRR。
2. 说清楚三个数各自在看什么:recall 管「该找的找全没有」,precision 管「拿到的有多少是废料」,MRR 管「第一个有用的排得多靠前」。
3. 写出 `part04/metrics.py`,知道检索结果为什么要先从块转成文章、无答案题为什么不能进分母。
4. 看着三种检索方式的三个数,说出各自输在哪一题。

预计用时 2 小时。今天不调大模型,花费 ¥0;只调 embedding 和 rerank(硅基流动免费模型)。

前置:[Day 255](/blog/agent-zero/day-255-rag-eval-1/) 的两层划分;[Day 240](/blog/agent-zero/day-240-retrieval-pipeline/) 的 `part04/retrieve.py`(Postgres.app 要开着);[Day 185](/blog/agent-zero/day-185-tool-search-2/) 在工具检索里第一次用过 recall@k;[Day 25](/blog/agent-zero/day-025-sets/) 的集合交集 `&`;[Day 18](/blog/agent-zero/day-018-for-range/) 的 `enumerate`。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,在纸上把今天三道题的 recall@4、precision@4、MRR 重算一遍,再默写 `metrics.py` 的五个函数;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先在纸上算,不写代码

为什么先手算?这几个指标的代码每个只有一两行,真正难的是对每个数的含义有把握。以后你会拿这些数决定「切块用 300 还是 500 字」「要不要上 rerank」,数字算错了或者理解错了,决定就跟着错。面试里让你白板写一个 recall@k 也不少见。

拿一道真题。用户问「导入流水支持哪些银行,文件编码有要求吗」,一句话两个问题:支持哪些银行在 kb-009《导入银行流水》,编码要求在 kb-011《错误码 E1043:文件编码错误》。所以标准答案是两篇:**{kb-009, kb-011}**。

用 Day 240 的混合检索 + rerank 取前 6 块,实际拿到的是:

```text
kb-009#1, kb-009#2, kb-010#1, kb-010#2, kb-014#1, kb-020#1
```

标注是按文章标的(Day 255 练习 1 讨论过为什么),检索结果却是按块排的。同一篇文章的两块排在前面,不应该算成两个结果,所以第一步先把块排名变成文章排名:每篇文章只留它第一次出现的位置。

```text
第 1 名 kb-009   ← 答案
第 2 名 kb-010
第 3 名 kb-014
第 4 名 kb-020
```

6 块变成了 4 篇。kb-011 不在里面。下面三个指标都在这份 4 篇的名单上算。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="手算示例:标准答案 kb-009 和 kb-011,检索出的文章排名 kb-009、kb-010、kb-014、kb-020,只有第 1 名命中;recall@4 等于 1/2,precision@4 等于 1/4,倒数排名等于 1/1">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink-soft)">标准答案 {kb-009, kb-011}</text>
<text x="20" y="52" fill="var(--ink-soft)">检索出的文章排名(top-4)</text>
<rect x="20" y="64" width="130" height="36" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="85" y="87" fill="var(--ink)" text-anchor="middle">1 kb-009 ✓</text>
<rect x="20" y="106" width="130" height="36" rx="4" fill="none" stroke="var(--rule)"/>
<text x="85" y="129" fill="var(--ink-faint)" text-anchor="middle">2 kb-010</text>
<rect x="20" y="148" width="130" height="36" rx="4" fill="none" stroke="var(--rule)"/>
<text x="85" y="171" fill="var(--ink-faint)" text-anchor="middle">3 kb-014</text>
<rect x="20" y="190" width="130" height="36" rx="4" fill="none" stroke="var(--rule)"/>
<text x="85" y="213" fill="var(--ink-faint)" text-anchor="middle">4 kb-020</text>
<rect x="20" y="240" width="130" height="36" rx="4" fill="none" stroke="var(--compute)" stroke-dasharray="4 3"/>
<text x="85" y="263" fill="var(--compute)" text-anchor="middle">kb-011 没找到</text>
<rect x="190" y="64" width="430" height="60" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="206" y="88" fill="var(--ink)">recall@4 = 找到的答案 / 答案总数</text>
<text x="206" y="110" fill="var(--ink-soft)">= 1 / 2 = 0.50    该找的找到了几成</text>
<rect x="190" y="134" width="430" height="60" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="206" y="158" fill="var(--ink)">precision@4 = 找到的答案 / k</text>
<text x="206" y="180" fill="var(--ink-soft)">= 1 / 4 = 0.25    拿到的里面几成有用</text>
<rect x="190" y="204" width="430" height="60" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="206" y="228" fill="var(--ink)">RR = 1 / 第一个答案的名次</text>
<text x="206" y="250" fill="var(--ink-soft)">= 1 / 1 = 1.00    多道题平均 → MRR</text>
</g>
</svg>
<figcaption>三个指标的分子都来自同一件事「前 k 名里有几个是答案」,区别在分母和看的角度。</figcaption>
</figure>

### recall@k:该找的找到了几成

**recall**(召回率)问的是:标准答案里的文章,有几成出现在前 k 名里。读作「recall at k」。

```text
recall@4 = 前 4 名里的答案数 / 答案总数 = 1 / 2 = 0.50
```

前 4 名里只有 kb-009 一篇是答案,答案总共两篇,所以 0.5。意思是:这道题需要的资料,模型只拿到了一半,编码那一半没有。生成层再厉害也只能答一半。

[Day 185](/blog/agent-zero/day-185-tool-search-2/) 选工具时也用过 recall@k,那时每道题只有一个正确工具,recall@k 只可能是 0 或 1。只有一个答案时,recall@k 和另一个常听到的指标 **hit@k**(命中率,前 k 名里有没有任何一个答案)完全一样。差别出现在多答案的题上:这道题 hit@4 是 1(命中了 kb-009),recall@4 是 0.5。对 RAG 来说,recall 更有用,它告诉你「资料够不够」,hit 只告诉你「沾没沾边」。

把 k 改成 1 再算一次:前 1 名是 kb-009,recall@1 = 1/2 = 0.5。k 从 1 加到 4,recall 没涨,因为 kb-011 根本不在前 6 块里。k 越大 recall 只会涨或不变,不会跌,这是它的一个性质。

### precision@k:拿到的里面几成有用

**precision**(精确率)反过来问:前 k 名里,有几成是答案。

```text
precision@4 = 前 4 名里的答案数 / k = 1 / 4 = 0.25
```

4 篇里 1 篇有用,另外 3 篇(导入失败 E1042、导出数据、多币种)是废料。

为什么 RAG 要关心废料?两个原因。一是钱:这些块都要拼进提示词,按 token 收费。二是会把模型带偏:Day 255 的「买错了能把钱要回来吗」,拿到的 4 块全是申请流程和到账时间,模型就答了一篇申请流程。废料不是中性的。

k 越大,recall 只会涨,precision 通常会跌,这是一对此消彼长的数(练习 2 会把 k 从 1 加到 6 看一遍)。所以说 precision 一定要带着 k 说,单说「精确率 0.25」没有意义。

分母这里有个细节:检索结果不够 k 篇时怎么办?比如 BM25 只返回了 1 篇。我们用 k 当分母(信息检索的教科书定义),有的框架用实际返回的篇数。两种都有人用,同一份报告里统一就行,练习 4 会两种都算出来对比。

### 倒数排名和 MRR:第一个有用的排第几

**倒数排名**(reciprocal rank,RR)只看一件事:第一个答案排第几名,取倒数。排第 1 得 1,排第 2 得 0.5,排第 3 得 0.333,前面都没找到得 0。

这道题第一个答案 kb-009 排第 1,RR = 1/1 = 1.0。

单道题的 RR 用处不大,把很多道题的 RR 求平均,就是 **MRR**(Mean Reciprocal Rank,平均倒数排名)。再拿两道题:

- 「老板想看所有账但不能让他改」,答案 {kb-015}。混合 + rerank 的文章排名是 kb-007、kb-001、kb-015、kb-018、kb-017,kb-015 排第 3,RR = 1/3 ≈ 0.333。
- 「免费版能建几个账本,一天能导出几次」,答案 {kb-001, kb-014}。排名 kb-014、kb-001、kb-005……第一个答案 kb-014 排第 1,RR = 1。

```text
MRR = (1 + 0.333 + 1) / 3 = 0.778
```

为什么取倒数而不是直接平均名次?倒数把「排得靠前」的差距放大了:第 1 名和第 2 名差 0.5,第 9 名和第 10 名只差 0.011。用户和模型都主要看前几名,第 9 和第 10 的区别确实不重要。而且没找到可以直接记 0,平均名次就没法处理「没找到」。

MRR 特别适合衡量 rerank 这种「不改变拿到哪些、只改变排序」的改进,recall@k 对这种改动不敏感(只要都在前 k 里,换顺序 recall 不变),MRR 会变。

它也有盲点:只看**第一个**答案。「免费版」那题需要两篇,第二篇排第几它不管。所以多答案的题要和 recall@k 一起看。

### 三个数各看一眼,还有一个 nDCG

| 指标 | 问的问题 | 这道题(导入流水 + 编码) | 只看它会漏掉什么 |
| --- | --- | --- | --- |
| recall@4 | 该找的找全没有 | 0.50 | 废料多不多、排得前不前 |
| precision@4 | 拿到的有几成有用 | 0.25 | 答案找没找全 |
| RR | 第一个答案排第几 | 1.00 | 第二个答案的情况 |

RR 是 1,看着完美,recall 却只有一半。这就是为什么三个要一起看。

你在论文和面试里还会听到 **nDCG**(归一化折损累计增益)。它比上面三个多两样东西:相关性可以分等级(非常相关 3 分、有点相关 1 分),而且每个名次的贡献按对数打折。我们的标注只有「能答 / 不能答」两档,用 recall 和 MRR 就够了。面试被问到,说出「nDCG 支持分级相关、按名次做对数折扣」就行,今天不展开。

## 第一步:把手算写成 metrics.py

纸上算明白了,把它写成函数。在 `agent-zero-lab/` 下新建 `part04/metrics.py`,纯 Python,不用装任何东西:

```python
# agent-zero-lab/part04/metrics.py  三个检索指标:recall@k、precision@k、MRR(外加 hit@k 和块转文章)
"""retrieved 是按排名排好、已经去重的文章 id 列表;expected 是标准答案所在的文章 id 集合。"""


def dedup_docs(chunk_doc_ids: list[str]) -> list[str]:
    """块级排名 → 文章级排名:同一篇文章的多个块只留排得最靠前的那个。"""
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

- `"""retrieved 是按排名排好、已经去重的文章 id 列表;expected 是标准答案所在的文章 id 集合。"""` 模块开头的三引号字符串叫模块 docstring,写这个文件的约定。后面四个指标函数全靠这个约定:传进来的必须是**文章 id**、**已去重**、**按名次排好**。传块 id(`kb-009#1`)进来不会报错,但会算出全错的数,下面会演示。
- `def dedup_docs(chunk_doc_ids: list[str]) -> list[str]:` 输入是每一块所属的文章 id,按检索名次排好,比如 `["kb-009", "kb-009", "kb-010", ...]`。
- `seen: list[str] = []` 用列表不用集合,因为要**保持顺序**,顺序就是名次。集合不保证顺序。
- `for d in chunk_doc_ids:` 拿 `__main__` 的例子走一遍:<br>第 1 个 kb-009:不在 seen 里,加入 → `['kb-009']`<br>第 2 个 kb-009:已经在了,跳过<br>第 3 个 kb-010:加入 → `['kb-009', 'kb-010']`<br>第 4 个 kb-010:跳过<br>第 5 个 kb-014:加入<br>第 6 个 kb-020:加入 → `['kb-009', 'kb-010', 'kb-014', 'kb-020']`
- `if d not in seen:` 在列表上用 `in` 是从头逐个比较,列表长了会慢。这里每次最多十来个,无所谓。数据多的时候可以一行 `list(dict.fromkeys(ids))`,dict 保持插入顺序,效果一样。
- `def recall_at_k(retrieved: list[str], expected: set[str], k: int) -> float:` 三个参数:排名、答案集合、k。
- `return len(expected & set(retrieved[:k])) / len(expected)` 从里往外读:`retrieved[:k]` 取前 k 名(切片,[Day 15](/blog/agent-zero/day-015-strings-1/) 的写法对列表一样能用,k 比列表长也不报错,有几个取几个);`set(...)` 转成集合;`expected & 集合` 求交集,两边都有的才留下,相当于 JS 的 `[...expected].filter(x => top.has(x))`;`len(...)` 数一下有几个。代入 k=2:前 2 名 `{'kb-009', 'kb-010'}` 和 `{'kb-009', 'kb-011'}` 的交集是 `{'kb-009'}`,1 个;除以答案总数 2,得 `0.5`。Python 3 里 `/` 永远是小数除法,`1 / 2` 就是 `0.5`,不会像某些语言那样变成 0。
- `return len(expected & set(retrieved[:k])) / k` precision 和 recall 只差分母:recall 除以答案总数,precision 除以 k。k=2 时 1 / 2 = `0.5`。
- `return 1.0 if expected & set(retrieved[:k]) else 0.0` hit@k:交集非空就是 1。空集合在 `if` 里算假,所以不用写 `len(...) > 0`。返回 1.0/0.0 而不是 True/False,是为了方便求平均。k=2 时交集 `{'kb-009'}` 非空 → `1.0`。
- `for rank, d in enumerate(retrieved, start=1):` `enumerate` 遍历时同时给出序号和元素,相当于 JS 的 `retrieved.forEach((d, i) => ...)`。`start=1` 让序号从 1 开始,因为名次从第 1 名算起。默认从 0 开始,第一名会算出 `1 / 0`,下面会演示这个报错。
- `if d in expected:` 遇到第一个答案就停。<br>例子一 `['kb-009', ...]`:rank=1,kb-009 在答案里 → 返回 `1.0`<br>例子二 `['kb-007', 'kb-001', 'kb-015']`:rank=1 kb-007 不是,rank=2 kb-001 不是,rank=3 kb-015 是 → 返回 `1/3`
- `return 1.0 / rank` 找到就立刻 `return`,后面的不看了。这正是「只看第一个答案」的意思。
- `return 0.0` 循环走完都没遇到答案,记 0。
- `def mrr(rrs: list[float]) -> float:` 把每道题的 RR 求平均。`sum()` 求和,相当于 JS 的 `rrs.reduce((a, b) => a + b, 0)`。传空列表进来会除以 0,调用方要保证至少有一道题。
- `print(round(mrr([1.0, 1 / 3, 1.0]), 3))` 手算的那三道题。`round(x, 3)` 保留 3 位小数,结果 `0.778`。

</div>

```bash
uv run python -m part04.metrics
```

```text
['kb-009', 'kb-010', 'kb-014', 'kb-020']
0.5 0.5 1.0
1.0 0.3333333333333333
0.778
```

和纸上算的逐个对:去重后 4 篇,对;k=2 时 recall 0.5、precision 0.5(前 2 名 1 个答案 / 2)、hit 1.0;RR 1.0 和 0.333;MRR 0.778。`1/3` 打印出来是 `0.3333333333333333`,这是小数在计算机里存不精确的正常现象,显示时用 `round()` 或 f-string 的 `:.3f` 截一下就好。

`metrics.py` 留着,Day 259 的检索评估脚本会直接 import 这几个函数。

## 第二步:三道题 × 三种检索,真跑一遍

函数写对了,拿 Day 240 的三种检索方式各跑一遍手算的三道题,看三个数怎么区分它们。新建 `part04/hand_calc.py`:

```python
# agent-zero-lab/part04/hand_calc.py  三道题 × 三种检索,算 recall@4、precision@4、倒数排名,和手算的对一对
from part04.metrics import dedup_docs, mrr, precision_at_k, recall_at_k, reciprocal_rank
from part04.retrieve import retrieve

QUESTIONS = [
    ("导入流水支持哪些银行,文件编码有要求吗", {"kb-009", "kb-011"}),
    ("老板想看所有账但不能让他改", {"kb-015"}),
    ("免费版能建几个账本,一天能导出几次", {"kb-001", "kb-014"}),
]
K = 4

for mode in ["vector", "bm25", "hybrid+rerank"]:
    print(f"== {mode}")
    rrs: list[float] = []
    for q, expected in QUESTIONS:
        chunks = [c for c, _ in retrieve(q, k=6, mode=mode)]
        docs = dedup_docs([c.doc_id for c in chunks])
        rr = reciprocal_rank(docs, expected)
        rrs.append(rr)
        r, p = recall_at_k(docs, expected, K), precision_at_k(docs, expected, K)
        print(f"  {q}")
        print(f"    文章 {docs}")
        print(f"    recall@{K}={r:.2f}  precision@{K}={p:.2f}  RR={rr:.3f}")
    print(f"  MRR = {mrr(rrs):.3f}")
```

<div class="line-notes">

- `QUESTIONS = [` 每道题是(问题,答案集合)二元组。三道题一道多答案、一道单答案、一道多答案。
- `K = 4` 全大写表示常量,和 JS 的 `const K = 4` 习惯一样。Python 不会真的阻止你改它,只是约定。
- `for mode in ["vector", "bm25", "hybrid+rerank"]:` Day 240 的三种模式:只用向量、只用 BM25、两路 RRF 融合后 rerank。
- `rrs: list[float] = []` 每种模式单独收集三道题的 RR,最后求 MRR。放在外层循环里面,换模式时清空。
- `chunks = [c for c, _ in retrieve(q, k=6, mode=mode)]` 取 6 块而不是 4 块:去重后文章会变少,多取几块,保证大多数时候能凑够 4 篇。
- `docs = dedup_docs([c.doc_id for c in chunks])` 块 → 文章 id → 去重。第一题混合检索实测 `['kb-009', 'kb-010', 'kb-014', 'kb-020']`,和手算用的一样。
- `rr = reciprocal_rank(docs, expected)` RR 不需要 k,看整份排名。
- `r, p = recall_at_k(docs, expected, K), precision_at_k(docs, expected, K)` 右边两个值,左边两个变量,一次赋值。
- `print(f"    recall@{K}={r:.2f}  precision@{K}={p:.2f}  RR={rr:.3f}")` `:.2f` 保留两位小数。
- `print(f"  MRR = {mrr(rrs):.3f}")` 三道题的平均倒数排名。

</div>

```bash
uv run python -m part04.hand_calc
```

```text
== vector
  导入流水支持哪些银行,文件编码有要求吗
    文章 ['kb-009', 'kb-010', 'kb-014']
    recall@4=0.50  precision@4=0.25  RR=1.000
  老板想看所有账但不能让他改
    文章 ['kb-015', 'kb-007', 'kb-005', 'kb-001', 'kb-012', 'kb-018']
    recall@4=1.00  precision@4=0.25  RR=1.000
  免费版能建几个账本,一天能导出几次
    文章 ['kb-014', 'kb-001', 'kb-005', 'kb-020', 'kb-015']
    recall@4=1.00  precision@4=0.50  RR=1.000
  MRR = 1.000
== bm25
  导入流水支持哪些银行,文件编码有要求吗
    文章 ['kb-009', 'kb-011', 'kb-010']
    recall@4=1.00  precision@4=0.50  RR=1.000
  老板想看所有账但不能让他改
    文章 ['kb-002', 'kb-008', 'kb-003', 'kb-018', 'kb-006', 'kb-017']
    recall@4=0.00  precision@4=0.00  RR=0.000
  免费版能建几个账本,一天能导出几次
    文章 ['kb-014', 'kb-001', 'kb-005', 'kb-015']
    recall@4=1.00  precision@4=0.50  RR=1.000
  MRR = 0.667
== hybrid+rerank
  导入流水支持哪些银行,文件编码有要求吗
    文章 ['kb-009', 'kb-010', 'kb-014', 'kb-020']
    recall@4=0.50  precision@4=0.25  RR=1.000
  老板想看所有账但不能让他改
    文章 ['kb-007', 'kb-001', 'kb-015', 'kb-018', 'kb-017']
    recall@4=1.00  precision@4=0.25  RR=0.333
  免费版能建几个账本,一天能导出几次
    文章 ['kb-014', 'kb-001', 'kb-005', 'kb-015']
    recall@4=1.00  precision@4=0.50  RR=1.000
  MRR = 0.778
```

混合检索那一组和纸上手算的完全对上。三种方式放在一起,有几件事只有拆成三个数才看得出来。

**BM25 的 MRR 最低,却是唯一把第一题找全的。** 第一题它拿到了 kb-009 和 kb-011,recall@4 = 1.00,向量和混合都只有 0.50。问题里的「银行」「编码」是文档里原样出现的词,BM25 正好擅长这个。但「老板想看所有账」这种口语题它全军覆没,RR = 0,把 MRR 拉到了 0.667。

**混合 + rerank 在第二题上把答案排到了第 3。** recall@4 是 1.00,说明 kb-015 在前 4 名里,模型拿得到;RR 0.333 说明它排在 kb-007《修改发票抬头》和 kb-001《套餐与价格》后面。如果你把 k 从 4 降到 2 省 token,这道题就会掉出去。只看 recall 看不到这个风险,MRR 看得到。

**precision@4 三种方式都很低,0.25 到 0.50。** 单答案的题,precision@4 最高也只能是 0.25(4 篇里最多 1 篇是答案),这不是检索的错,是 k 定大了的必然结果。所以单看 precision 比较不同的题没意义,它适合在同一批题上比较「k 取几」「要不要加过滤」。

这只是 3 道题。3 道题的 MRR,一道题就占三分之一,向量 1.000 和混合 0.778 的差别完全可能是这三道题挑得巧。Day 257 建一份 30 道题的评估集,Day 259 才在整份上算正式的分数。

## 故意踩三个坑

这几个函数短,坑都在调用的方式上。新建 `part04/metric_traps.py`,三个坑放一个文件:

```python
# agent-zero-lab/part04/metric_traps.py  三个坑:不转文章、enumerate 从 0 开始、无答案题当分母
from part04.metrics import recall_at_k

chunk_ids = ["kb-009#1", "kb-009#2", "kb-010#1", "kb-010#2"]
print("坑 1 拿块 id 比文章 id:", recall_at_k(chunk_ids, {"kb-009", "kb-011"}, 4))


def rr_wrong(retrieved: list[str], expected: set[str]) -> float:
    for rank, d in enumerate(retrieved):
        if d in expected:
            return 1.0 / rank
    return 0.0


try:
    print("坑 2:", rr_wrong(["kb-015", "kb-007"], {"kb-015"}))
except ZeroDivisionError as e:
    print("坑 2 enumerate 从 0 开始:", type(e).__name__, e)

print("坑 3:", recall_at_k(["kb-016", "kb-018"], set(), 4))
```

<div class="line-notes">

- `chunk_ids = ["kb-009#1", "kb-009#2", "kb-010#1", "kb-010#2"]` 直接拿块 id 当排名,忘了转成文章 id。
- `print("坑 1 拿块 id 比文章 id:", recall_at_k(chunk_ids, {"kb-009", "kb-011"}, 4))` `"kb-009#1"` 和 `"kb-009"` 是两个不同的字符串,交集永远是空。
- `for rank, d in enumerate(retrieved):` 故意漏了 `start=1`,序号从 0 开始。
- `return 1.0 / rank` 答案排第一时 `rank` 是 0,`1.0 / 0` 报错。
- `try:` 先把报错接住,让第 3 个坑也能跑到。`try/except` 是 [Day 35](/blog/agent-zero/day-035-exceptions-1/) 学的,相当于 JS 的 `try/catch`。
- `except ZeroDivisionError as e:` 只接住除以零这一种错误。`type(e).__name__` 取出错误类型的名字。
- `print("坑 3:", recall_at_k(["kb-016", "kb-018"], set(), 4))` 无答案题直接算 recall,`len(expected)` 是 0。这次没有 `try`,让它把完整报错打出来。

</div>

```bash
uv run python -m part04.metric_traps
```

```text
坑 1 拿块 id 比文章 id: 0.0
坑 2 enumerate 从 0 开始: ZeroDivisionError float division by zero
Traceback (most recent call last):
  File "<frozen runpy>", line 198, in _run_module_as_main
  File "<frozen runpy>", line 88, in _run_code
  File "/Users/你/agent-zero-lab/part04/metric_traps.py", line 20, in <module>
    print("坑 3:", recall_at_k(["kb-016", "kb-018"], set(), 4))
                   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/你/agent-zero-lab/part04/metrics.py", line 15, in recall_at_k
    return len(expected & set(retrieved[:k])) / len(expected)
           ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~^~~~~~~~~~~~~~~
ZeroDivisionError: division by zero
```

坑 1 最阴险:不报错,recall 是 0.0。如果你整份评估集都这么算,会看到一个全是 0 的报告,第一反应是「检索全坏了」,然后去改检索,其实检索没毛病。看到全 0 或全 1 的指标,先怀疑算法,再怀疑系统。

坑 2 和坑 3 都是 `ZeroDivisionError`,好歹会报错。读 traceback 从下往上:最后一行是错误类型,倒数第二段指出出事的是 `metrics.py` 第 15 行的那个 `/`,`~~~^~~~` 正好标在除号上。

坑 3 就是 [Day 255](/blog/agent-zero/day-255-rag-eval-1/) 那个空集合的兄弟。昨天空集合当子集判断,悄悄给了个 True;今天空集合当分母,直接崩。修法一样:无答案题不进检索层的分数,在算之前就跳过(练习 3)。为什么不让 `recall_at_k` 自己遇到空集合返回 0 或 1?返回 0 会冤枉检索,返回 1 会白送分数,哪个都会让平均数失真。不该算的题就不算,这比给一个假数字诚实。

## 动手练习

**练习 1:纸上手算。** 检索出的文章排名是 `[kb-003, kb-007, kb-002]`,标准答案 `{kb-007, kb-002}`。算 k=1、2、3 时的 recall 和 precision,以及 RR。算完写 `part04/ex256_1.py` 验算。

<details><summary>参考答案</summary>

手算:k=1 前 1 名 {kb-003},没有答案,recall 0/2 = 0,precision 0/1 = 0。k=2 前 2 名有 kb-007,recall 1/2 = 0.5,precision 1/2 = 0.5。k=3 两篇都在,recall 2/2 = 1,precision 2/3 ≈ 0.67。第一个答案 kb-007 排第 2,RR = 0.5。

```python
# agent-zero-lab/part04/ex256_1.py  练习 1:先手算,再用 metrics.py 验算
from part04.metrics import precision_at_k, recall_at_k, reciprocal_rank

docs = ["kb-003", "kb-007", "kb-002"]
expected = {"kb-007", "kb-002"}
for k in (1, 2, 3):
    print(f"k={k}  recall={recall_at_k(docs, expected, k):.2f}  precision={precision_at_k(docs, expected, k):.2f}")
print("RR =", reciprocal_rank(docs, expected))
```

<div class="line-notes">

- `docs = ["kb-003", "kb-007", "kb-002"]` 已经是文章 id、已经去重,直接用,不需要 `dedup_docs`。
- `for k in (1, 2, 3):` 遍历一个元组,和遍历列表一样。
- `print(f"k={k}  recall={recall_at_k(docs, expected, k):.2f}  precision={precision_at_k(docs, expected, k):.2f}")` f-string 的花括号里可以直接调函数,再接格式说明。
- `print("RR =", reciprocal_rank(docs, expected))` rank=1 kb-003 不是,rank=2 kb-007 是 → `1/2`。

</div>

```text
k=1  recall=0.00  precision=0.00
k=2  recall=0.50  precision=0.50
k=3  recall=1.00  precision=0.67
RR = 0.5
```

和手算一致。注意 k=3 时 recall 到了 1,precision 却只有 0.67,两个数一个涨一个不涨。

</details>

**练习 2:k 从 1 加到 6。** 拿「发票抬头写错了,而且我想退款」(答案 {kb-007, kb-003}),混合 + rerank 取 10 块转成文章排名,打印 k=1 到 6 的 recall 和 precision,看两个数怎么变。写 `part04/ex256_2.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex256_2.py  练习 2:k 从 1 加到 6,看 recall 和 precision 怎么此消彼长
from part04.metrics import dedup_docs, precision_at_k, recall_at_k
from part04.retrieve import retrieve

q, expected = "发票抬头写错了,而且我想退款", {"kb-007", "kb-003"}
docs = dedup_docs([c.doc_id for c, _ in retrieve(q, k=10)])
print("文章排名:", docs)
for k in range(1, 7):
    print(f"k={k}  recall={recall_at_k(docs, expected, k):.2f}  precision={precision_at_k(docs, expected, k):.2f}")
```

<div class="line-notes">

- `q, expected = "发票抬头写错了,而且我想退款", {"kb-007", "kb-003"}` 一行给两个变量赋值。改抬头在 kb-007,退款前要先红冲发票在 kb-003。
- `docs = dedup_docs([c.doc_id for c, _ in retrieve(q, k=10)])` 取 10 块,去重后实测剩 6 篇,够 k 加到 6。
- `for k in range(1, 7):` `range(1, 7)` 是 1 到 6,不含 7,和 [Day 18](/blog/agent-zero/day-018-for-range/) 讲的一样。

</div>

```text
文章排名: ['kb-007', 'kb-003', 'kb-006', 'kb-002', 'kb-012', 'kb-010']
k=1  recall=0.50  precision=1.00
k=2  recall=1.00  precision=1.00
k=3  recall=1.00  precision=0.67
k=4  recall=1.00  precision=0.50
k=5  recall=1.00  precision=0.40
k=6  recall=1.00  precision=0.33
```

这道题两篇答案排在第 1、2 名,k=2 时两个数都是 1,最理想。k 再往上加,recall 已经到顶,precision 一路往下掉,多出来的全是废料。对这道题 k=2 最好;可「老板」那题答案排第 3,k=2 就漏了。k 取几要在整份评估集上看,这是 Day 261 做实验时要回答的问题。

</details>

**练习 3:无答案题不进分母。** 三道题里放一道无答案题「有没有手机 App」,算 recall@4 平均和 MRR 时跳过它,并打印跳过了几道。写 `part04/ex256_3.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex256_3.py  练习 3:无答案题不进分母,MRR 只对有答案的题求平均
from part04.metrics import dedup_docs, mrr, recall_at_k, reciprocal_rank
from part04.retrieve import retrieve

QUESTIONS = [
    ("E1043 怎么解决", {"kb-011"}),
    ("有没有手机 App", set()),
    ("老板想看所有账但不能让他改", {"kb-015"}),
]
rrs: list[float] = []
recalls: list[float] = []
skipped = 0
for q, expected in QUESTIONS:
    if not expected:
        skipped += 1
        continue
    docs = dedup_docs([c.doc_id for c, _ in retrieve(q, k=6)])
    rrs.append(reciprocal_rank(docs, expected))
    recalls.append(recall_at_k(docs, expected, 4))
print(f"算分 {len(rrs)} 题,跳过无答案题 {skipped} 题")
print(f"recall@4 平均 {sum(recalls) / len(recalls):.3f}  MRR {mrr(rrs):.3f}")
```

<div class="line-notes">

- `("有没有手机 App", set()),` 无答案题,答案是空集合。
- `if not expected:` 空集合在 `if` 里算假,`not` 一下就是真,进来跳过。
- `continue` 跳过这一轮剩下的代码,直接进下一道题,和 JS 的 `continue` 一样。
- `rrs.append(reciprocal_rank(docs, expected))` 只有有答案的题才会走到这里。
- `print(f"recall@4 平均 {sum(recalls) / len(recalls):.3f}  MRR {mrr(rrs):.3f}")` 分母是 2 不是 3。

</div>

```text
算分 2 题,跳过无答案题 1 题
recall@4 平均 1.000  MRR 0.667
```

E1043 那题 RR 是 1,老板那题混合检索排第 3,RR 0.333,平均 0.667。报告里要写清楚「检索层分数基于 2 道有答案的题」,不然读的人会以为是 3 道。无答案题去哪了?去生成层考拒答,Day 260 处理。

</details>

**练习 4:precision 的分母用 k 还是用返回数?** BM25 搜「E1043 怎么解决」只返回 1 篇文章。分别用 k 和实际返回的篇数当分母算 precision@4。写 `part04/ex256_4.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex256_4.py  练习 4:返回不足 k 篇时,precision 的分母用 k 还是用实际返回数
from part04.metrics import dedup_docs, precision_at_k
from part04.retrieve import retrieve


def precision_returned(retrieved: list[str], expected: set[str], k: int) -> float:
    top = retrieved[:k]
    return len(expected & set(top)) / len(top) if top else 0.0


q, expected = "E1043 怎么解决", {"kb-011"}
docs = dedup_docs([c.doc_id for c, _ in retrieve(q, k=4, mode="bm25")])
print("BM25 文章:", docs)
print("分母用 k:     ", precision_at_k(docs, expected, 4))
print("分母用返回数:", precision_returned(docs, expected, 4))
```

<div class="line-notes">

- `top = retrieved[:k]` 先把前 k 个取出来,返回不够 k 个时就是全部。
- `return len(expected & set(top)) / len(top) if top else 0.0` 分母换成实际个数;一个都没返回时直接给 0,免得除以 0。
- `docs = dedup_docs([c.doc_id for c, _ in retrieve(q, k=4, mode="bm25")])` BM25 只在至少一个词对得上的块里打分,这题只有 2 块含 E1043,都是 kb-011 的。

</div>

```text
BM25 文章: ['kb-011']
分母用 k:      0.25
分母用返回数: 1.0
```

同一个结果,一个说 0.25,一个说 1.0。用 k 当分母,意思是「给了你 4 个位置,你只填对 1 个」;用返回数当分母,意思是「你给出的东西全对」。BM25 没返回废料,对这道题后者更公平;但比较不同检索方式时,一个返回 1 篇一个返回 4 篇,用返回数当分母会奖励「少返回」。我们统一用 k,在报告里写清楚口径。

</details>

**验收标准:** 合上文章,能在纸上把今天三道题在混合检索下的 recall@4、precision@4、RR 和 MRR 算出来,和 `hand_calc.py` 的输出一致;`metrics.py` 五个函数能默写出来;能说出 `hand_calc.py` 里 BM25 为什么 MRR 最低却把第一题找全了。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| recall@k(召回率) | 标准答案里有几成出现在前 k 名里。今天第一题混合检索 1/2 = 0.50 |
| precision@k(精确率) | 前 k 名里有几成是答案。今天第一题 1/4 = 0.25 |
| hit@k(命中率) | 前 k 名里有没有任何一个答案,有就是 1。只有一个答案时和 recall@k 相等 |
| 倒数排名(RR) | 第一个答案名次的倒数,第 3 名是 1/3,没找到是 0 |
| MRR | 平均倒数排名,多道题 RR 的平均。今天混合检索三道题 0.778 |
| nDCG | 支持分级相关、按名次做对数折扣的排序指标,今天只认识名字 |
| 块级 / 文章级 | 检索按块(`kb-009#1`)排名,标注按文章(`kb-009`)标,算指标前要先把块转成文章并去重 |
| top-k | 检索结果的前 k 名,k 是你决定拼进提示词的数量 |
| `ZeroDivisionError` | Python 除以 0 时抛的错误,今天 RR 从 0 数名次和无答案题算 recall 都会触发 |

## 常见误区

**拿块 id 和文章 id 比。** `"kb-009#1"` 和 `"kb-009"` 不相等,recall 永远是 0.0,而且不报错。看到全是 0 的指标,先查算法再查系统。

**`enumerate` 忘了 `start=1`。** 名次从 0 开始,答案排第一时 `1.0 / 0` 直接 `ZeroDivisionError: float division by zero`。

**无答案题进了检索层的分母。** `len(expected)` 是 0,`ZeroDivisionError: division by zero`。别让函数返回一个假数字糊过去,在调用前跳过,报告里写清楚算了几道。

**只看一个指标。** 第一题混合检索 RR 是满分 1.00,recall@4 只有 0.50,编码那篇根本没拿到。三个数一起看。

**单答案题嫌 precision 低。** 单答案题 precision@4 最高就是 0.25,不是检索的错。precision 用来在同一批题上比较 k 和过滤条件,不用来跨题比较。

**3 道题就下结论。** 今天向量检索 MRR 1.000 比混合 0.778 高,可一道题就占三分之一,换三道题可能就反过来。要在几十道题的评估集上比,这是明天的事。

## 学习资料

### 文档与文章

- [Evidently AI · A complete guide to RAG evaluation](https://www.evidentlyai.com/llm-guide/rag-evaluation):检索指标那一节讲了 precision@k、recall@k 和 nDCG,和今天的手算对照,20 分钟。
- [Wikipedia · Mean reciprocal rank](https://en.wikipedia.org/wiki/Mean_reciprocal_rank):MRR 的定义只有一屏,下面那张三道题的例子表很适合做练习 1 之后再算一遍。
- [Google 机器学习速成课 · Accuracy, precision, recall](https://developers.google.com/machine-learning/crash-course/classification/accuracy-precision-recall):分类问题里的 precision 和 recall,和检索里的意思一样,有交互小图,有中文界面。
- [Anthropic · Introducing Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval):Anthropic 评检索改进时用的就是 recall@20(文中写成「检索失败率 = 1 - recall@20」),看真实团队怎么用今天的指标报告结果。
- [BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of Information Retrieval Models(arXiv 2104.08663)](https://arxiv.org/abs/2104.08663):检索模型最常用的评测基准之一,主指标是 nDCG@10,读摘要和第 4 节的指标说明,知道业界榜单上的数是怎么来的。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1iBVMziEaq&autoplay=0&high_quality=1" title="05-1:RAG效果评估. 召回效果评估 | 回答效果评估 | 命中率 | MRR" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>大小寒学AI · 05-1:RAG效果评估,召回效果评估、回答效果评估、命中率、MRR · 6 分钟,中文讲命中率和 MRR,正好对应今天的 hit@k 和 MRR,看完自己再手算一道。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/BD9TkvEsKwM" title="Evaluation Measures for Search and Recommender Systems" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>James Briggs · Evaluation Measures for Search and Recommender Systems · 英文,用图一步步算 recall@k、MRR、MAP@k、nDCG@k,最后用 Python 实现,和今天的 metrics.py 对照着看,开自动字幕。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/k1yoGGVMpRg" title="RAG Evaluation, Retrieval Metrics Explained: Precision@k, Recall@k, F1, MRR and NDCG" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Slav Kurochkin · RAG Evaluation, Retrieval Metrics Explained: Precision@k, Recall@k, F1, MRR and NDCG · 英文,专门讲 RAG 场景下的检索指标,F1 和 nDCG 今天不要求,当扩展看。</figcaption>
</figure>

### 书籍

- Christopher Manning、Prabhakar Raghavan、Hinrich Schütze《Introduction to Information Retrieval》(Cambridge University Press,2008),中译本《信息检索导论》(王斌译,人民邮电出版社)。第 8 章「信息检索的评价」是 precision、recall 和排序指标的经典出处。斯坦福 NLP 组网站有免费在线版(按书名搜索,国内访问可能要多试几次)。
- Chip Huyen《AI Engineering》(O'Reilly,2025)第 6 章讲 RAG 的部分,有检索评估指标的一小节,和今天的定义对照。

### 开源项目与代码

- [AmenRa/ranx](https://github.com/AmenRa/ranx):一个专门算检索指标的 Python 库,recall、precision、MRR、nDCG 都有。今天先别用,等 Day 259 的脚本跑通后,用它验算一遍自己的数字。
- [terrierteam/ir_measures](https://github.com/terrierteam/ir_measures):学术界常用的检索指标统一接口,看它的指标列表,知道 `RR@10`、`nDCG@10` 这些写法是什么意思。
- [beir-cellar/beir](https://github.com/beir-cellar/beir):BEIR 基准的代码,`evaluation.py` 里能看到它怎么批量算 nDCG 和 recall。

## 自测

**1. 文章排名 `[kb-011, kb-010, kb-009, kb-002]`,答案 `{kb-010, kb-003}`。求 recall@3、precision@3、RR。**

<details><summary>答案</summary>

前 3 名 {kb-011, kb-010, kb-009} 里只有 kb-010 是答案。recall@3 = 1/2 = 0.5;precision@3 = 1/3 ≈ 0.333;第一个答案 kb-010 排第 2,RR = 0.5。kb-003 没找到,只影响 recall,不影响 RR。

</details>

**2. 为什么算指标前要把块排名转成文章排名,而且要保留第一次出现的位置?**

<details><summary>答案</summary>

标注是按文章标的,块 id 和文章 id 字符串不同,直接比交集永远为空。同一篇文章的几块如果都算,会重复占名次;保留第一次出现的位置,代表这篇文章在检索里最好的名次,和「模型最早在第几块看到它」一致。

</details>

**3. 把 rerank 加进流水线后,recall@4 没变,MRR 从 0.70 升到 0.85。说明什么?**

<details><summary>答案</summary>

rerank 没有改变「前 4 名里有哪些答案」,只是把答案往前排了。recall@4 对这种只改顺序的改动不敏感,MRR 敏感。这意味着可以考虑把 k 调小(比如 4 降到 2)省 token,但要先在评估集上验证 recall@2 不掉太多。

</details>

**4. 一道单答案题,precision@4 最高能是多少?这说明 precision 适合拿来做什么?**

<details><summary>答案</summary>

最高 1/4 = 0.25,4 个位置里最多只有 1 个答案。所以 precision 不适合跨题比较好坏,适合在同一批题上比较不同的 k、不同的过滤条件,看废料多了还是少了。

</details>

**5.(面试题)手写一个 recall@k 和 MRR,并说出你写的时候要注意的两个边界情况。**

<details><summary>答案</summary>

```python
def recall_at_k(retrieved: list[str], expected: set[str], k: int) -> float:
    return len(expected & set(retrieved[:k])) / len(expected)


def mrr(results: list[tuple[list[str], set[str]]]) -> float:
    total = 0.0
    for retrieved, expected in results:
        for rank, d in enumerate(retrieved, start=1):
            if d in expected:
                total += 1.0 / rank
                break
    return total / len(results)
```

边界一:`expected` 为空(无答案题)时 recall 会除以 0,这类题应该在调用前跳过,不进检索层分数。边界二:名次要从 1 开始数,`enumerate` 默认从 0,第一名会除以 0。另外可以补一句:检索结果是块级时要先去重成文章级再算,否则 recall 恒为 0。

</details>

## 明天预告

Day 257 · RAG 评估(三):建 30 条评估集,五种题型。今天三个指标都会算了,可用来算的只有手挑的三道题,一道题就能把 MRR 拉动三分之一。明天正式建 CloudLedger 帮助中心的第一份评估集:30 道题,分政策、错误码、口语、一句两问、无答案五类,每道题标好答案在哪几篇文章和回答必须包含的要点,存成 JSONL。今天的 `metrics.py` 到 Day 259 就在这 30 道题上跑。
