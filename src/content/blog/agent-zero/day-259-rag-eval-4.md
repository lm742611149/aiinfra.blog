---
title: 'Day 259 · RAG 评估(四):检索评估脚本'
description: '把 Day 256 的指标和 Day 257 的 30 条评估集接成一个脚本 eval_retrieval.py:26 道有答案的题、四种检索方式一次跑完,按题型拆开,列出失败题。实测 hit@1:向量 1.000,混合 0.923,混合+rerank 0.923,BM25 0.846;BM25 的口语题只有 0.333。顺手踩一个不报错的坑:只取 4 块再去重,22 道题凑不够 4 篇,一句两问那道被冤枉成 recall 0.5。'
pubDate: 2026-10-22
regime: none
tags: ['rag-evaluation', 'retrieval', 'python', 'agent-zero']
series: 'agent-zero'
day: 259
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 258](/blog/agent-zero/day-258-week37-review/) 复习了第 37 周:前三天 GraphRAG,后三天 RAG 评估。小项目拿 Day 256 的三个指标重新量了一遍 Day 253 的四道对比题,发现图检索三次运行是 7/9、6/9、6/9,还看到「取 4 块」时有三道题去重后只剩 3 篇文章,分数恰好没受影响。

四道题是手挑的,太少。现在我们有了 [Day 257](/blog/agent-zero/day-257-rag-eval-3/) 的 30 条评估集,今天写一个脚本,把它一次跑完,让「哪种检索好、好在哪类题上」变成一张表。

## 今天要解决的问题

学完你应该能做到:

1. 写出 `part04/eval_retrieval.py`:读评估集,跳过无答案题,对每道题检索、去重、算 hit@1、recall@k、MRR,先按题型、再按总体求平均。
2. 知道检索时为什么要比 k 多取一些块,并用实测说出少取会冤枉哪道题。
3. 读懂四种检索方式的结果:谁在哪类题上输了,输的那道题具体错在哪,哪些结论 26 道题撑不住。

预计用时 2 小时。今天不调大模型,花费 ¥0;向量检索要调 embedding,rerank 要调重排模型,两个都是硅基流动的免费模型。四种方式跑一遍大约 20 秒。

前置:[Day 256](/blog/agent-zero/day-256-rag-eval-2/) 的 `part04/metrics.py`;[Day 257](/blog/agent-zero/day-257-rag-eval-3/) 的 `part04/eval_set.py` 和 `data/eval/rag_eval.jsonl`;[Day 240](/blog/agent-zero/day-240-retrieval-pipeline/) 的 `part04/retrieve.py`(四种 mode,Postgres.app 要开着,索引用 [Day 231](/blog/agent-zero/day-231-pgvector-2/) 的 `pg_sync.py` 建好);[Day 250](/blog/agent-zero/day-250-kg-basics/) 用过的 `defaultdict`;[Day 44](/blog/agent-zero/day-044-notebook-project/) 的 `sys.argv`。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `evaluate()` 函数;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先想清楚脚本要干什么

动手前先在脑子里过一遍流程。前端写过单元测试的话,这个脚本就像一个测试 runner:评估集是一堆测试用例,检索函数是被测代码,`metrics.py` 是断言,区别只是断言不给「通过/失败」,给一个 0 到 1 的分数。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="检索评估脚本的流程:评估集 30 条,跳过 4 条无答案题,剩下 26 条逐条检索至少 10 块,块转文章去重,用三个指标打分,分数同时记进题型分组和总体分组,recall 不满分的进失败清单,最后对每组求平均">
<rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)"/>
<defs><marker id="ev259a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--ink-soft)"/></marker></defs>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="20" width="120" height="48" rx="4" fill="none" stroke="var(--rule)"/>
<text x="76" y="40" fill="var(--ink)" text-anchor="middle">评估集 30 条</text>
<text x="76" y="58" fill="var(--ink-soft)" text-anchor="middle" font-size="11">rag_eval.jsonl</text>
<line x1="136" y1="44" x2="168" y2="44" stroke="var(--ink-soft)" marker-end="url(#ev259a)"/>
<rect x="170" y="20" width="130" height="48" rx="4" fill="none" stroke="var(--rule)"/>
<text x="235" y="40" fill="var(--ink)" text-anchor="middle">跳过无答案 4 条</text>
<text x="235" y="58" fill="var(--ink-soft)" text-anchor="middle" font-size="11">留给 Day 260</text>
<line x1="300" y1="44" x2="332" y2="44" stroke="var(--ink-soft)" marker-end="url(#ev259a)"/>
<rect x="334" y="20" width="140" height="48" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="404" y="40" fill="var(--ink)" text-anchor="middle">检索 ≥10 块</text>
<text x="404" y="58" fill="var(--ink-soft)" text-anchor="middle" font-size="11">四种 mode 之一</text>
<line x1="474" y1="44" x2="506" y2="44" stroke="var(--ink-soft)" marker-end="url(#ev259a)"/>
<rect x="508" y="20" width="116" height="48" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="566" y="40" fill="var(--ink)" text-anchor="middle">块→文章</text>
<text x="566" y="58" fill="var(--ink-soft)" text-anchor="middle" font-size="11">dedup_docs</text>
<line x1="566" y1="68" x2="566" y2="100" stroke="var(--ink-soft)" marker-end="url(#ev259a)"/>
<rect x="430" y="102" width="194" height="48" rx="4" fill="none" stroke="var(--rule)"/>
<text x="527" y="122" fill="var(--ink)" text-anchor="middle">打三个分</text>
<text x="527" y="140" fill="var(--ink-soft)" text-anchor="middle" font-size="11">hit@1 recall@k RR</text>
<line x1="430" y1="126" x2="372" y2="126" stroke="var(--ink-soft)" marker-end="url(#ev259a)"/>
<rect x="190" y="102" width="180" height="48" rx="4" fill="none" stroke="var(--rule)"/>
<text x="280" y="122" fill="var(--ink)" text-anchor="middle">记两份</text>
<text x="280" y="140" fill="var(--ink-soft)" text-anchor="middle" font-size="11">per_type[题型] + ALL</text>
<line x1="527" y1="150" x2="527" y2="190" stroke="var(--ink-soft)" marker-end="url(#ev259a)"/>
<rect x="430" y="192" width="194" height="48" rx="4" fill="none" stroke="var(--compute)" stroke-dasharray="4 3"/>
<text x="527" y="212" fill="var(--compute)" text-anchor="middle">recall 不满分</text>
<text x="527" y="230" fill="var(--ink-soft)" text-anchor="middle" font-size="11">进失败清单,给人看</text>
<line x1="280" y1="150" x2="280" y2="190" stroke="var(--ink-soft)" marker-end="url(#ev259a)"/>
<rect x="160" y="192" width="240" height="48" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="280" y="212" fill="var(--ink)" text-anchor="middle">每组求平均 = 成绩单</text>
<text x="280" y="230" fill="var(--ink-soft)" text-anchor="middle" font-size="11">ALL / policy / colloquial …</text>
</g>
</svg>
<figcaption>一道题走一遍上面这条线。检索和去重在琥珀色框里,和 Day 256 一样;今天新加的是右下角的失败清单,和左下角「按组求平均」那一步。</figcaption>
</figure>

图里只有两样东西是新的:一是按题型分组再求平均,二是失败清单。其他每一步都在 Day 256 和 Day 257 写过。所以今天按老规矩,先写一个只有一种检索、只算一个指标的最小版,再一步步加。

## 第一步:最小版,一种检索算 MRR

新建 `part04/eval_one_mode.py`,只做一件事:用一种检索方式把 26 道题跑完,打出每道题的倒数排名和总的 MRR。

```python
# agent-zero-lab/part04/eval_one_mode.py  最小版:一种检索方式跑完 26 道有答案的题,算 MRR
import sys

from part04.eval_set import load_eval_set
from part04.metrics import dedup_docs, mrr, reciprocal_rank
from part04.retrieve import retrieve

mode = sys.argv[1] if len(sys.argv) > 1 else "bm25"
rrs = []
for row in load_eval_set():
    expected = set(row["expected_docs"])
    if not expected:
        continue
    chunks = [c for c, _ in retrieve(row["question"], k=10, mode=mode)]
    docs = dedup_docs([c.doc_id for c in chunks])
    rr = reciprocal_rank(docs, expected)
    rrs.append(rr)
    print(f"{row['id']} RR={rr:.3f}  {docs[:4]}  {row['question']}")
print(f"{mode}: {len(rrs)} 道题,MRR = {mrr(rrs):.3f}")
```

<div class="line-notes">

- `from part04.eval_set import load_eval_set` Day 257 写的,逐行读 JSONL,返回 30 个字典。
- `from part04.metrics import dedup_docs, mrr, reciprocal_rank` Day 256 写的指标函数,今天一个都不改。
- `from part04.retrieve import retrieve` Day 240 的检索流水线。`import` 这一行就会连 Postgres、加载 42 个块、建好 BM25 索引。
- `mode = sys.argv[1] if len(sys.argv) > 1 else "bm25"` 命令行第一个参数是检索方式,不给就用 BM25。[Day 44](/blog/agent-zero/day-044-notebook-project/) 讲过 `sys.argv`:`sys.argv[0]` 是脚本名,后面才是参数,相当于 Node 的 `process.argv.slice(2)`。
- `expected = set(row["expected_docs"])` JSON 里存的是列表,转成集合才能和检索结果求交集。q01 是 `{'kb-002'}`。
- `if not expected:` 空集合为假。q27 到 q30 四道无答案题在这里跳过,Day 256 演示过它们进分母会除以 0。
- `continue` 跳到下一道题,相当于 JS 循环里的 `continue`。
- `chunks = [c for c, _ in retrieve(row["question"], k=10, mode=mode)]` 取 10 块。为什么是 10 不是 4,下一节专门演示。`_` 是丢掉不用的分数。
- `docs = dedup_docs([c.doc_id for c in chunks])` 块级排名变文章级排名。q02「月付的能退钱吗」BM25 拿回的 10 块全是 kb-002 的,去重后只剩 `['kb-002']` 一篇。
- `rr = reciprocal_rank(docs, expected)` 第一个正确文章排第几,取倒数。
- `print(f"{row['id']} RR={rr:.3f}  {docs[:4]}  {row['question']}")` f-string 里取字典值用单引号 `row['id']`,因为外面是双引号。只打前 4 篇,够看了。
- `print(f"{mode}: {len(rrs)} 道题,MRR = {mrr(rrs):.3f}")` 打出算了几道题。报告里写清分母是 26 不是 30,别人才不会误会。

</div>

在 `agent-zero-lab/` 下跑(`-W ignore` 屏蔽 jieba 的 SyntaxWarning,Day 253 讲过):

```bash
uv run python -W ignore -m part04.eval_one_mode bm25
```

```text
q01 RR=1.000  ['kb-002', 'kb-006', 'kb-001', 'kb-019']  年付专业版用了两个月,想退款可以吗
q02 RR=1.000  ['kb-002']  月付的能退钱吗
q03 RR=1.000  ['kb-002', 'kb-011']  这个月被扣了两次钱
q04 RR=1.000  ['kb-002', 'kb-003', 'kb-008', 'kb-014']  退款多久到账
q05 RR=1.000  ['kb-003', 'kb-008', 'kb-006', 'kb-002']  怎么申请退款
q06 RR=1.000  ['kb-003', 'kb-006', 'kb-002', 'kb-007']  已经开了发票还能退款吗
q07 RR=1.000  ['kb-004', 'kb-002', 'kb-010', 'kb-013']  自动扣款失败了会怎样
q08 RR=1.000  ['kb-005', 'kb-001', 'kb-015', 'kb-019']  降级以后多出来的账本会被删吗
q09 RR=1.000  ['kb-006', 'kb-003', 'kb-001']  能开增值税专用发票吗
q10 RR=1.000  ['kb-008', 'kb-019', 'kb-011', 'kb-001']  优惠码能和别的优惠一起用吗
q11 RR=1.000  ['kb-010', 'kb-009', 'kb-020', 'kb-015']  导入流水报 E1042
q12 RR=1.000  ['kb-011']  E1043 怎么解决
q13 RR=1.000  ['kb-012', 'kb-007', 'kb-006', 'kb-003']  上传发票提示 E2017
q14 RR=1.000  ['kb-013', 'kb-011', 'kb-008', 'kb-002']  付款时出现 E3001
q15 RR=1.000  ['kb-019', 'kb-001']  API 返回 E4029
q16 RR=1.000  ['kb-013', 'kb-004', 'kb-012', 'kb-006']  连续付款失败被锁了,多久能再付
q17 RR=0.000  []  买错了能把钱要回来吗
q18 RR=0.250  ['kb-014', 'kb-009', 'kb-010', 'kb-011']  Excel 存的 csv 传上去说格式不对,好像是乱码
q19 RR=0.000  ['kb-002', 'kb-008', 'kb-003', 'kb-018']  老板想看所有账但不能让他改
q20 RR=1.000  ['kb-016']  换了手机号,收不到验证码登不上
q21 RR=1.000  ['kb-017', 'kb-016', 'kb-019', 'kb-011']  不想用了,怎么把账号删掉
q22 RR=0.000  ['kb-002', 'kb-003']  外币的账怎么记
q23 RR=1.000  ['kb-007', 'kb-006', 'kb-003', 'kb-012']  发票抬头写错了,而且我想退款
q24 RR=1.000  ['kb-014', 'kb-001', 'kb-005', 'kb-015']  免费版能建几个账本,一天能导出几次
q25 RR=1.000  ['kb-005', 'kb-004', 'kb-001', 'kb-002']  扣款失败数据会丢吗,降级后账本还能用吗
q26 RR=1.000  ['kb-009', 'kb-011', 'kb-010', 'kb-020']  导入流水支持哪些银行,文件编码有要求吗
bm25: 26 道题,MRR = 0.856
```

26 道题里 22 道满分,四道不满分全是口语题 q17 到 q22。q17「买错了能把钱要回来吗」一块都没检索到,`docs` 是空列表:jieba 把它切成「买错、能、把、钱、要、回来、吗」,这些词在 20 篇文章里一个都没出现(帮助中心写的是「退款」)。BM25 只认字面,这正是 Day 257 设计口语题想考的东西。

MRR 0.856 这一个数把这些全藏起来了。光看 0.856,你会觉得 BM25 还行,而用户里说话随意的那一拨,有一半根本找不到答案。所以下一步要按题型拆开。不过拆之前,先看一个不报错的坑。

## 故意踩坑:只取 k 块再去重

最小版里我写的是 `k=10`。你可能会想:我只看前 4 名,取 4 块不就够了,还省事。来试一下。新建 `part04/fetch_trap.py`,用混合检索(不带 rerank),分别取 4 块和 10 块,算 recall@4:

```python
# agent-zero-lab/part04/fetch_trap.py  坑:只取 k 块再去重,文章凑不够 k 篇,recall@k 被冤枉
import sys

from part04.eval_set import load_eval_set
from part04.metrics import dedup_docs, recall_at_k
from part04.retrieve import retrieve

mode = sys.argv[1] if len(sys.argv) > 1 else "hybrid"
K = 4
rows = [r for r in load_eval_set() if r["expected_docs"]]
for fetch in (K, 10):
    recalls, short = [], 0
    for row in rows:
        docs = dedup_docs([c.doc_id for c, _ in retrieve(row["question"], k=fetch, mode=mode)])
        if len(docs) < K:
            short += 1
        r = recall_at_k(docs, set(row["expected_docs"]), K)
        recalls.append(r)
        if row["id"] == "q26":
            print(f"  取 {fetch:>2} 块时 q26 去重后 {docs}  recall@{K}={r}")
    print(f"{mode} 取 {fetch:>2} 块:凑不够 {K} 篇的题 {short} 道,平均 recall@{K} = {sum(recalls) / len(recalls):.3f}")
```

<div class="line-notes">

- `K = 4` 我们关心的是文章级的前 4 名。
- `rows = [r for r in load_eval_set() if r["expected_docs"]]` 先把无答案题滤掉,剩 26 道。和最小版里 `continue` 是一个意思,换一种写法。
- `for fetch in (K, 10):` 两轮:第一轮取 4 块,第二轮取 10 块。
- `docs = dedup_docs([c.doc_id for c, _ in retrieve(row["question"], k=fetch, mode=mode)])` 取 `fetch` 块再去重。一篇文章常常有两三块一起排进前几名,4 块去重后可能只剩 2 篇。
- `if len(docs) < K:` 数一数有几道题去重后不到 4 篇,也就是「前 4 名」其实没有 4 个名额。
- `r = recall_at_k(docs, set(row["expected_docs"]), K)` `recall_at_k` 里是 `retrieved[:k]`,列表不够长时切片不会报错,只是拿到的更少。这就是这个坑不报错的原因。
- `if row["id"] == "q26":` 单独打印一句两问的 q26,它是受影响的那一道。
- `print(f"{mode} 取 {fetch:>2} 块:` `:>2` 右对齐占两格,4 和 10 对得齐。

</div>

```bash
uv run python -W ignore -m part04.fetch_trap
```

```text
  取  4 块时 q26 去重后 ['kb-009', 'kb-010']  recall@4=0.5
hybrid 取  4 块:凑不够 4 篇的题 22 道,平均 recall@4 = 0.942
  取 10 块时 q26 去重后 ['kb-009', 'kb-010', 'kb-011', 'kb-020', 'kb-014', 'kb-001', 'kb-016']  recall@4=1.0
hybrid 取 10 块:凑不够 4 篇的题 0 道,平均 recall@4 = 0.962
```

取 4 块时,26 道题里有 22 道去重后不到 4 篇。q26「导入流水支持哪些银行,文件编码有要求吗」最典型:前 4 块是 kb-009 两块、kb-010 两块,去重只剩 2 篇,讲编码的 kb-011 排在第 5 块,就这样被挤出去了,recall@4 算成 0.5。取 10 块,kb-011 排在文章级的第 3 名,recall@4 是 1.0。

这个坑没有报错,也没有异常的数字,0.942 和 0.962 看着都挺正常。可它冤枉的是「一句两问」这类题,恰好是你最想看清楚的那类。我们说的 recall@4 是「前 4 篇文章」,不是「前 4 块」,所以检索时要多取。取多少?至少保证去重后凑得够 k 篇。我们的知识库一篇文章最多 4 块左右,取 10 块时 26 道题全都凑够了,所以脚本里写 `max(k, 10)`。知识库变了,这个数要重新看。

这个坑我在 Day 258 的小项目里就见过一次:四道题里三道取 4 块只剩 3 篇,那次恰好没影响分数。换成 26 道题,冤枉的那道就露出来了。

## 第二步:按题型拆开,列失败清单,四种检索一起跑

现在把最小版扩成正式脚本。比最小版多三样东西:三个指标一起算;分数按题型分组再求平均;recall 不满分的题记进失败清单。新建 `part04/eval_retrieval.py`:

```python
# agent-zero-lab/part04/eval_retrieval.py  检索评估:评估集里有答案的题逐个检索,算 hit@1、recall@k、MRR,按题型拆开,列出失败题
"""用法(在 agent-zero-lab/ 下):
  uv run python -m part04.eval_retrieval                      四种检索都跑,k=4
  uv run python -m part04.eval_retrieval bm25,vector 6        只跑两种,k=6
"""
import sys
import time
from collections import defaultdict

from part04.eval_set import load_eval_set
from part04.metrics import dedup_docs, hit_at_k, recall_at_k, reciprocal_rank
from part04.retrieve import retrieve

FETCH = 10  # 至少取这么多块再去重,保证文章级排名凑得够 k 篇


def evaluate(mode: str, k: int, rows: list[dict]) -> tuple[dict, list[tuple]]:
    per_type: dict[str, list[dict[str, float]]] = defaultdict(list)
    failures = []
    for row in rows:
        expected = set(row["expected_docs"])
        if not expected:
            continue  # 无答案题不进检索层,留给 Day 260 的生成评估
        chunks = [c for c, _ in retrieve(row["question"], k=max(k, FETCH), mode=mode)]
        docs = dedup_docs([c.doc_id for c in chunks])
        m = {
            "hit@1": hit_at_k(docs, expected, 1),
            f"recall@{k}": recall_at_k(docs, expected, k),
            "mrr": reciprocal_rank(docs, expected),
        }
        per_type[row["type"]].append(m)
        per_type["ALL"].append(m)
        if m[f"recall@{k}"] < 1:
            failures.append((row["id"], row["question"], sorted(expected), docs[:k]))
    summary = {}
    for typ, ms in per_type.items():
        avg = {name: round(sum(x[name] for x in ms) / len(ms), 3) for name in ms[0]}
        avg["n"] = len(ms)
        summary[typ] = avg
    return summary, failures


def main() -> None:
    modes = (sys.argv[1] if len(sys.argv) > 1 else "bm25,vector,hybrid,hybrid+rerank").split(",")
    k = int(sys.argv[2]) if len(sys.argv) > 2 else 4
    rows = load_eval_set()
    print(f"评估集 {len(rows)} 条,k={k}")
    for mode in modes:
        start = time.perf_counter()
        summary, failures = evaluate(mode, k, rows)
        print(f"\n== {mode}({time.perf_counter() - start:.1f} 秒)")
        for typ in sorted(summary):
            print(f"  {typ:<11} {summary[typ]}")
        for qid, q, exp, got in failures:
            print(f"  ✗ {qid} {q}  期望 {exp}  实际 {got}")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `"""用法(在 agent-zero-lab/ 下):` 模块 docstring 写用法,半个月后再打开不用读代码就知道怎么跑。
- `import time` 用 `time.perf_counter()` 计时,看每种检索要多久。
- `from collections import defaultdict` [Day 250](/blog/agent-zero/day-250-kg-basics/) 用过:访问不存在的键时自动给一个空列表,省得每次先判断「这个题型第一次出现吗」。
- `FETCH = 10  # 至少取这么多块再去重,保证文章级排名凑得够 k 篇` 上一节那个坑的修法,写成常量放在文件顶上,以后知识库变了好找。
- `def evaluate(mode: str, k: int, rows: list[dict]) -> tuple[dict, list[tuple]]:` 返回两样东西:成绩单和失败清单。拆成函数,练习里可以 import 它换参数跑。
- `per_type: dict[str, list[dict[str, float]]] = defaultdict(list)` 类型标注读法:键是题型名,值是「每道题的分数字典」组成的列表。跑完 BM25 后 `per_type["colloquial"]` 里有 6 个字典。
- `failures = []` 失败清单,每项是一个四元组。
- `chunks = [c for c, _ in retrieve(row["question"], k=max(k, FETCH), mode=mode)]` `max(k, FETCH)`:k=4 时取 10 块;练习 3 里 k=6 也还是 10;k 要是传 12,就取 12 块。
- `m = {` 一道题的三个分数放进一个字典。
- `"hit@1": hit_at_k(docs, expected, 1),` 第一名对不对,0 或 1。平均起来就是「第一名就对了」的题占几成。
- `f"recall@{k}": recall_at_k(docs, expected, k),` 键名里带上 k,k=4 时是 `"recall@4"`,打印出来一看就知道是前几名。
- `"mrr": reciprocal_rank(docs, expected),` 每道题存的是倒数排名,求平均后才是 MRR。键名直接叫 mrr,是因为成绩单里显示的是平均后的值。
- `per_type[row["type"]].append(m)` 记进这道题的题型组。`defaultdict` 让 `per_type["policy"]` 第一次访问时自动是 `[]`。
- `per_type["ALL"].append(m)` 同一个字典再记进总体组。一份分数记两处,总体和分题型的平均就都有了。
- `if m[f"recall@{k}"] < 1:` 只要漏了任何一篇标准答案,就进失败清单。一句两问的题拿到一篇也算失败,这是故意的。
- `failures.append((row["id"], row["question"], sorted(expected), docs[:k]))` `sorted(expected)` 把集合排成列表,打印顺序每次一样;`docs[:k]` 是实际拿到的前 k 篇,方便和期望对比。
- `for typ, ms in per_type.items():` 每个题型(包括 ALL)各算一遍平均。
- `avg = {name: round(sum(x[name] for x in ms) / len(ms), 3) for name in ms[0]}` 这行最绕,从里往外读:`ms[0]` 是第一道题的分数字典,遍历它的键得到三个指标名;对每个指标名,把这组所有题的这个分数加起来除以题数,保留 3 位小数。拆成普通循环就是两层 `for`。
- `avg["n"] = len(ms)` 加上题数。看到 `colloquial` 的 0.333 时,同时看到 `n=6`,就知道这是 6 道里对了 2 道。
- `modes = (sys.argv[1] if len(sys.argv) > 1 else "bm25,vector,hybrid,hybrid+rerank").split(",")` 第一个参数是逗号分隔的检索方式列表,`split(",")` 切成列表,相当于 JS 的 `"a,b".split(",")`。参数再多就该换标准库的 `argparse` 了,今天两个参数手写就够。
- `k = int(sys.argv[2]) if len(sys.argv) > 2 else 4` 命令行参数都是字符串,要 `int()` 转一下,不然切片 `docs[:"4"]` 会报 `TypeError`。
- `start = time.perf_counter()` 记开始时间,下面打印用时。
- `for typ in sorted(summary):` 按题型名字母顺序打印,`ALL` 大写字母排在最前面。
- `for qid, q, exp, got in failures:` 元组解包,相当于 JS 的 `for (const [qid, q, exp, got] of failures)`。

</div>

四种检索一起跑:

```bash
uv run python -W ignore -m part04.eval_retrieval
```

```text
评估集 30 条,k=4

== bm25(0.0 秒)
  ALL         {'hit@1': 0.846, 'recall@4': 0.885, 'mrr': 0.856, 'n': 26}
  colloquial  {'hit@1': 0.333, 'recall@4': 0.5, 'mrr': 0.375, 'n': 6}
  error_code  {'hit@1': 1.0, 'recall@4': 1.0, 'mrr': 1.0, 'n': 6}
  multi       {'hit@1': 1.0, 'recall@4': 1.0, 'mrr': 1.0, 'n': 4}
  policy      {'hit@1': 1.0, 'recall@4': 1.0, 'mrr': 1.0, 'n': 10}
  ✗ q17 买错了能把钱要回来吗  期望 ['kb-002']  实际 []
  ✗ q19 老板想看所有账但不能让他改  期望 ['kb-015']  实际 ['kb-002', 'kb-008', 'kb-003', 'kb-018']
  ✗ q22 外币的账怎么记  期望 ['kb-020']  实际 ['kb-002', 'kb-003']

== vector(3.2 秒)
  ALL         {'hit@1': 1.0, 'recall@4': 0.981, 'mrr': 1.0, 'n': 26}
  colloquial  {'hit@1': 1.0, 'recall@4': 1.0, 'mrr': 1.0, 'n': 6}
  error_code  {'hit@1': 1.0, 'recall@4': 1.0, 'mrr': 1.0, 'n': 6}
  multi       {'hit@1': 1.0, 'recall@4': 0.875, 'mrr': 1.0, 'n': 4}
  policy      {'hit@1': 1.0, 'recall@4': 1.0, 'mrr': 1.0, 'n': 10}
  ✗ q26 导入流水支持哪些银行,文件编码有要求吗  期望 ['kb-009', 'kb-011']  实际 ['kb-009', 'kb-010', 'kb-014', 'kb-020']

== hybrid(2.9 秒)
  ALL         {'hit@1': 0.923, 'recall@4': 0.962, 'mrr': 0.944, 'n': 26}
  colloquial  {'hit@1': 0.667, 'recall@4': 0.833, 'mrr': 0.756, 'n': 6}
  error_code  {'hit@1': 1.0, 'recall@4': 1.0, 'mrr': 1.0, 'n': 6}
  multi       {'hit@1': 1.0, 'recall@4': 1.0, 'mrr': 1.0, 'n': 4}
  policy      {'hit@1': 1.0, 'recall@4': 1.0, 'mrr': 1.0, 'n': 10}
  ✗ q19 老板想看所有账但不能让他改  期望 ['kb-015']  实际 ['kb-002', 'kb-008', 'kb-006', 'kb-004']

== hybrid+rerank(14.1 秒)
  ALL         {'hit@1': 0.923, 'recall@4': 0.981, 'mrr': 0.955, 'n': 26}
  colloquial  {'hit@1': 0.667, 'recall@4': 1.0, 'mrr': 0.806, 'n': 6}
  error_code  {'hit@1': 1.0, 'recall@4': 1.0, 'mrr': 1.0, 'n': 6}
  multi       {'hit@1': 1.0, 'recall@4': 0.875, 'mrr': 1.0, 'n': 4}
  policy      {'hit@1': 1.0, 'recall@4': 1.0, 'mrr': 1.0, 'n': 10}
  ✗ q26 导入流水支持哪些银行,文件编码有要求吗  期望 ['kb-009', 'kb-011']  实际 ['kb-009', 'kb-010', 'kb-014', 'kb-020']
```

BM25 只有 0.0 秒,因为它全在本机算;向量检索要调 26 次 embedding 接口;rerank 再多调 26 次重排接口,最慢。

## 读结果:数字说了什么,没说什么

先把总分整理成一张表:

| 检索方式 | hit@1 | recall@4 | MRR | 口语题 hit@1 | 失败题 |
| --- | --- | --- | --- | --- | --- |
| bm25 | 0.846 | 0.885 | 0.856 | 0.333 | q17 q19 q22 |
| vector | 1.000 | 0.981 | 1.000 | 1.000 | q26 |
| hybrid | 0.923 | 0.962 | 0.944 | 0.667 | q19 |
| hybrid+rerank | 0.923 | 0.981 | 0.955 | 0.667 | q26 |

我写之前的预期是:混合检索两边取长补短,应该最好;rerank 再往上拔一点。实际不是这样,**纯向量四项全是最高的**。这时候不要急着改代码,先去失败清单里看具体的题。

**BM25 输在口语题,而且输得很彻底。** 政策、错误码、一句两问全是满分,口语题 hit@1 只有 6 道里 2 道。q22「外币的账怎么记」,文档里写的是「多币种记账」,BM25 不知道外币和多币种是一回事。光看总分 0.846 是看不出这件事的,按题型拆开的意义就在这。

**混合检索被 BM25 拖了一道题。** q19「老板想看所有账但不能让他改」,向量检索第一名就是 kb-015(成员与权限),可 BM25 把「账」这个字匹配到了 kb-002 退款、kb-008 优惠码。RRF 融合时两路权重一样([Day 240](/blog/agent-zero/day-240-retrieval-pipeline/) 讲过 RRF 只看名次),BM25 那一路的错误名次把 kb-015 挤到了第 5。前端类比一下:两个推荐接口的结果按名次各打一半分,其中一个接口在这类请求上返回的全是噪音,合并后的列表就被噪音拉偏了。

**rerank 把 q19 救回来了,却把 q26 弄丢了。** 混合加 rerank 后 q19 进了前 4,口语题 recall 回到 1.0。可 q26 反而失败了。我把 q26 的块级排名打出来看:混合检索里讲编码的 kb-011#1 排在第 5 块,交给 rerank 重排后,它掉出了前 10。重排模型是拿整句问题去给每一块打分的,「导入流水支持哪些银行,文件编码有要求吗」这句话的前半截全在讲银行,只回答后半截的那一块,得分自然低。一句两问的题,rerank 反而容易吃亏。

**向量检索也没满分。** 它在 q26 上同样只拿到 kb-009,kb-011 不在它的前 10 块里。纯向量和 rerank 在同一道题上失败,原因相似:整句的意思偏向「导入银行流水」那一半。

这些结论哪些靠得住?先算一下分量。26 道题,一道题就是 3.8 个百分点。vector 和 hybrid 的 hit@1 差 0.077,正好就是两道题(q19 和 q22)。两道题的差距,换几道题、多跑几次很可能就变了。所以我从这张表里只敢下两个结论:BM25 不能单独用在口语用户身上,这一点 6 道里错 4 道,够明显;一句两问的题是所有方式的共同弱点,值得往评估集里多加几道再看。至于「纯向量比混合好」,我不会写进周报,只会记成「待验证」。Day 261 会用这个脚本做一次正式的实验,[Day 353](/blog/agent-zero/day-353-stats-intuition/) 再讲差多少才算真的有差别。

还有一件事要说清楚:这张表评的是**文章**找没找到,不是**块**。q17「买错了能把钱要回来吗」在混合加 rerank 下 recall 是 1.0,kb-002 确实在前 4 篇里,可拿到的是 kb-002 讲审批和重复扣款的两块,真正写「年付按剩余整月比例退」的 kb-002#1 并不在里面。按文章标注的好处是切块参数变了不用重标,代价是看不见这种情况。明天的生成评估会从另一头把它抓出来。

## 今天的文件

| 文件 | 干什么 | 谁会用 |
| --- | --- | --- |
| `part04/eval_retrieval.py` | 检索评估主脚本,`evaluate(mode, k, rows)` | Day 261 的实验,练习里 import |
| `part04/eval_one_mode.py` | 最小版,一种检索算 MRR | 只今天 |
| `part04/fetch_trap.py` | 演示只取 k 块的坑 | 只今天 |

## 动手练习

**练习 1:加一列 precision@4。** `evaluate()` 现在算三个指标。不改 `eval_retrieval.py`,另写 `part04/ex259_1.py`,用向量检索按题型算平均 precision@4,并打印四道 multi 题各自的 recall@4 和 precision@4。先猜一下:单答案题的 precision@4 会是多少?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex259_1.py  练习 1:在 evaluate 的基础上多算一列 precision@k
from collections import defaultdict

from part04.eval_retrieval import FETCH
from part04.eval_set import load_eval_set
from part04.metrics import dedup_docs, precision_at_k, recall_at_k
from part04.retrieve import retrieve

k = 4
per_type: dict[str, list[float]] = defaultdict(list)
for row in load_eval_set():
    expected = set(row["expected_docs"])
    if not expected:
        continue
    docs = dedup_docs([c.doc_id for c, _ in retrieve(row["question"], k=max(k, FETCH), mode="vector")])
    p = precision_at_k(docs, expected, k)
    per_type[row["type"]].append(p)
    per_type["ALL"].append(p)
    if row["type"] == "multi":
        print(f"  {row['id']} recall@4={recall_at_k(docs, expected, k):.2f} precision@4={p:.2f} {docs[:k]}")
for typ in sorted(per_type):
    ps = per_type[typ]
    print(f"{typ:<11} precision@{k} = {sum(ps) / len(ps):.3f}  (n={len(ps)})")
```

<div class="line-notes">

- `from part04.eval_retrieval import FETCH` 复用同一个「至少取几块」的常量,不在两个地方各写一个 10。能这样 import,是因为 `eval_retrieval.py` 把主流程放在了 `if __name__ == "__main__"` 下面。
- `per_type: dict[str, list[float]] = defaultdict(list)` 这次每道题只存一个数,所以值是浮点数列表。
- `p = precision_at_k(docs, expected, k)` 分母是 k=4。
- `if row["type"] == "multi":` 一句两问的题单独打出来看。

</div>

```text
  q23 recall@4=1.00 precision@4=0.50 ['kb-007', 'kb-003', 'kb-002', 'kb-012']
  q24 recall@4=1.00 precision@4=0.50 ['kb-014', 'kb-001', 'kb-005', 'kb-020']
  q25 recall@4=1.00 precision@4=0.50 ['kb-005', 'kb-004', 'kb-013', 'kb-002']
  q26 recall@4=0.50 precision@4=0.25 ['kb-009', 'kb-010', 'kb-014', 'kb-020']
ALL         precision@4 = 0.279  (n=26)
colloquial  precision@4 = 0.250  (n=6)
error_code  precision@4 = 0.250  (n=6)
multi       precision@4 = 0.438  (n=4)
policy      precision@4 = 0.250  (n=10)
```

单答案题的 precision@4 全是 0.250,因为 4 个名额里最多只有 1 个有用的。这一列在我们的评估集上几乎没有信息量,所以主脚本没放它。它什么时候有用?在同一批题上比较「k 取 4 还是 2」或者「加不加一个过滤条件」的时候,看塞给模型的资料里废料多不多。

</details>

**练习 2:recall 满分,第一名却不对。** 失败清单只收 recall@4 不满分的题,所以 hybrid+rerank 的口语题 hit@1 是 0.667,失败清单里却一道口语题都没有。写 `part04/ex259_2.py`,对 hybrid 和 hybrid+rerank 列出「hit@1 是 0 但 recall@4 是 1」的题,打印第一个正确文章排第几。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex259_2.py  练习 2:recall 满分但第一名不对的题,失败清单里看不到,单独列出来
from part04.eval_retrieval import FETCH
from part04.eval_set import load_eval_set
from part04.metrics import dedup_docs, hit_at_k, recall_at_k
from part04.retrieve import retrieve

for mode in ["hybrid", "hybrid+rerank"]:
    print(f"== {mode}")
    for row in load_eval_set():
        expected = set(row["expected_docs"])
        if not expected:
            continue
        docs = dedup_docs([c.doc_id for c, _ in retrieve(row["question"], k=FETCH, mode=mode)])
        if hit_at_k(docs, expected, 1) == 0 and recall_at_k(docs, expected, 4) == 1:
            pos = min(docs.index(d) for d in expected) + 1
            print(f"  {row['id']} 第一个正确文章排第 {pos}  {docs[:4]}  {row['question']}")
```

<div class="line-notes">

- `if hit_at_k(docs, expected, 1) == 0 and recall_at_k(docs, expected, 4) == 1:` 两个条件同时满足:第一名不对,但前 4 名里该有的都有。
- `pos = min(docs.index(d) for d in expected) + 1` `docs.index(d)` 是 d 在列表里的下标,相当于 JS 的 `indexOf`;对每篇标准答案取下标,最小的就是最靠前的那篇,加 1 变成名次。这里 recall 是 1,所以每篇都在列表里,`index` 不会报 `ValueError`。

</div>

```text
== hybrid
  q22 第一个正确文章排第 3  ['kb-002', 'kb-003', 'kb-020', 'kb-001']  外币的账怎么记
== hybrid+rerank
  q17 第一个正确文章排第 2  ['kb-003', 'kb-002', 'kb-007', 'kb-004']  买错了能把钱要回来吗
  q19 第一个正确文章排第 3  ['kb-007', 'kb-001', 'kb-015', 'kb-018']  老板想看所有账但不能让他改
```

rerank 把 q19 从第 5 名拉到了第 3 名,够进前 4,但没拉到第 1。q17 第一名是 kb-003《如何申请退款》,严格说也不算错,用户问「能不能退」,讲「怎么退」的文章排第一也说得过去。这类「判错但其实也行」的情况,只有打出来看才知道。主脚本的失败清单可以改成「recall 不满分 或 hit@1 为 0」都收,代价是清单更长。

</details>

**练习 3:k 取 1、2、4、6。** 用 `evaluate()` 给 bm25、vector、hybrid+rerank 三种方式各算 k=1、2、4、6 时总体的 recall@k,排成一张表。写 `part04/ex259_3.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex259_3.py  练习 3:k 取 1、2、4、6,看两种检索的 recall@k 怎么变
from part04.eval_retrieval import evaluate
from part04.eval_set import load_eval_set

rows = load_eval_set()
print("mode            " + "  ".join(f"recall@{k}" for k in (1, 2, 4, 6)))
for mode in ["bm25", "vector", "hybrid+rerank"]:
    cells = []
    for k in (1, 2, 4, 6):
        summary, _ = evaluate(mode, k, rows)
        cells.append(f"{summary['ALL'][f'recall@{k}']:>8.3f}")
    print(f"{mode:<15} " + "  ".join(cells))
```

<div class="line-notes">

- `rows = load_eval_set()` 只读一次文件,四个 k 共用。
- `summary, _ = evaluate(mode, k, rows)` 失败清单这次不要,用 `_` 接住。
- `cells.append(f"{summary['ALL'][f'recall@{k}']:>8.3f}")` f-string 里套 f-string:里面那层算出键名 `recall@2`,外面那层取值并右对齐占 8 格、3 位小数。外层双引号、里层单引号,不能混用同一种。

</div>

```text
mode            recall@1  recall@2  recall@4  recall@6
bm25               0.769     0.827     0.885     0.885
vector             0.923     0.981     0.981     0.981
hybrid+rerank      0.846     0.942     0.981     0.981
```

注意 recall@1 和 hit@1 不一样:vector 的 hit@1 是 1.000,recall@1 只有 0.923。一句两问的题有两篇标准答案,前 1 名最多拿到一篇,recall@1 最多 0.5,四道 multi 题把平均拉低了 2/26。另外 k 从 4 到 6 三种方式都不再涨,剩下的失败不是「名额不够」,而是「根本没排进来」,加大 k 救不了,要换检索方式或者改问题(比如把一句两问拆成两次检索)。

</details>

**练习 4(开放题):给结果记上「用的哪版评估集」。** Day 257 说过,改了评估集,分数就不能直接比。写 `part04/ex259_4.py`,把一次评估的成绩单存成 JSON,里面记上时间、评估集文件名、文件内容的指纹、检索方式和 k;用 Day 257 练习 1 的 `rag_eval_v2.jsonl` 和 v1 各跑一次向量检索。

<details><summary>参考答案</summary>

示范解法:指纹用文件内容的 SHA-1 前 8 位,文件改了一个字,指纹就变。

```python
# agent-zero-lab/part04/ex259_4.py  练习 4:把一次评估的结果连同「用的哪版评估集」存成 JSON,v1 和 v2 各跑一次
import hashlib
import json
from datetime import datetime
from pathlib import Path

from part04.eval_retrieval import evaluate
from part04.eval_set import EVAL_PATH, load_eval_set

RUNS = EVAL_PATH.parent / "runs"


def run_and_save(path: Path, mode: str = "vector", k: int = 4) -> None:
    rows = load_eval_set(path)
    summary, failures = evaluate(mode, k, rows)
    record = {
        "time": datetime.now().isoformat(timespec="seconds"),
        "eval_file": path.name,
        "eval_sha1": hashlib.sha1(path.read_bytes()).hexdigest()[:8],
        "mode": mode,
        "k": k,
        "summary": summary,
        "failures": [f[0] for f in failures],
    }
    RUNS.mkdir(exist_ok=True)
    out = RUNS / f"{path.stem}_{mode}_k{k}.json"
    out.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{path.name} sha1={record['eval_sha1']} ALL={summary['ALL']} 失败={record['failures']} → {out.name}")


run_and_save(EVAL_PATH)
run_and_save(EVAL_PATH.with_name("rag_eval_v2.jsonl"))
```

<div class="line-notes">

- `import hashlib` 标准库,算文件指纹。[Day 231](/blog/agent-zero/day-231-pgvector-2/) 的 `pg_store.py` 用它给每块算 `content_hash`,判断块变没变,这里是同一个用法。
- `from datetime import datetime` 取当前时间。
- `RUNS = EVAL_PATH.parent / "runs"` 结果放在 `data/eval/runs/`,和评估集放一起。
- `rows = load_eval_set(path)` Day 257 给 `load_eval_set` 留了 `path` 参数,今天用上了。
- `"time": datetime.now().isoformat(timespec="seconds"),` 形如 `2026-10-22T19:28:54`,相当于 JS 的 `new Date().toISOString()` 去掉毫秒和时区。
- `"eval_sha1": hashlib.sha1(path.read_bytes()).hexdigest()[:8],` `read_bytes()` 按字节读整个文件,算 SHA-1,转成十六进制字符串取前 8 位。v1 是 `2f801e53`。只记文件名不够,有人改了 v1 却没改名,指纹会变,文件名不会。
- `"failures": [f[0] for f in failures],` 只存失败题的 id,够查了。
- `out = RUNS / f"{path.stem}_{mode}_k{k}.json"` `stem` 是去掉扩展名的文件名,得到 `rag_eval_vector_k4.json`。
- `out.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")` `indent=2` 缩进两格,给人看的文件就格式化一下。

</div>

```text
rag_eval.jsonl sha1=2f801e53 ALL={'hit@1': 1.0, 'recall@4': 0.981, 'mrr': 1.0, 'n': 26} 失败=['q26'] → rag_eval_vector_k4.json
rag_eval_v2.jsonl sha1=a77167c5 ALL={'hit@1': 0.967, 'recall@4': 0.983, 'mrr': 0.983, 'n': 30} 失败=['q26'] → rag_eval_v2_vector_k4.json
```

同样的向量检索,v2 的 hit@1 从 1.000 变成 0.967,不是检索变差了,是 v2 多了 q34「想从专业版升到企业版,差价怎么算,升完能开专票吗」,向量检索第一名给的是 kb-001《套餐与价格》,两篇标准答案排在第 2、3。如果两次结果没记评估集版本,你会以为谁改坏了检索。指纹在这时候就派上用场:两条记录的 `eval_sha1` 不一样,分数就不能直接比。

</details>

**验收标准:** `eval_retrieval.py` 四种方式跑通,数字和上面一致或者能解释差异(换了 embedding 模型或改了评估集,数字会变);能说出为什么要取 `max(k, 10)` 块、BM25 输在哪类题、q26 为什么四种方式里有两种失败;知道 26 道题上差两道题的结论不能写进周报。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 检索评估脚本 | 拿评估集里每道有答案的题去检索,和标准答案比,算出指标的脚本。今天是 `eval_retrieval.py` |
| 成绩单(summary) | 按题型和总体分组求平均后的指标表,每组带题数 n |
| 失败清单(failures) | 某个指标不满分的题,连同期望和实际结果一起列出,给人逐条看 |
| hit@1 | 第一名就是正确文章的题占几成。单答案题上等于 recall@1,多答案题上不等 |
| 取块数(fetch) | 检索时实际拿回的块数。要比 k 多,才能保证去重后凑得够 k 篇文章 |
| 按题型拆开 | 不只看总分,按题型分组各算一遍,防止总分把某类题的短板盖住 |

## 常见误区

**只看总分。** BM25 总 hit@1 是 0.846,拆开看口语题只有 0.333。一个数看着不错,往往是因为它把差的那一类平均掉了。

**取 k 块就当拿到 k 篇。** 取 4 块时 26 道题里 22 道去重后不到 4 篇,q26 被冤枉成 recall 0.5。不报错,数字也不离谱,只能靠你知道这件事。

**只看分数不看失败清单。** vector 比 hybrid 高 0.077,打开清单才知道就是 q19 和 q22 两道题。数字告诉你「哪里不对劲」,清单告诉你「为什么」。

**看到和预期不一样就去改代码。** 我预期混合检索最好,结果纯向量最好。先看具体是哪几道题,再想原因(这次是 RRF 等权重和 rerank 拿整句打分),最后才决定改不改。

**两道题的差距写进结论。** 26 道题里一道是 3.8 个百分点。vector 和 hybrid 差两道题,换一批题很可能就反过来了,记成「待验证」。

**以为 rerank 只会让结果变好。** rerank 救回了 q19,却把 q26 的编码那篇挤出了前 10。一句两问的题,重排模型拿整句打分,只回答半句的块会吃亏。

**评估结果不记评估集版本。** 同样的检索,v1 hit@1 1.000,v2 0.967。不记版本,你会去查一个不存在的退化。

**以为文章级满分就是资料齐了。** q17 在 rerank 下 recall 是 1.0,可写着退款规则的那一块不在前 4 块里。文章级评估看不见这种情况,要靠生成评估从另一头补。

## 学习资料

### 文档与文章

- [Jason Liu · Systematically Improving Your RAG](https://jxnl.co/writing/2024/05/22/systematically-improving-your-rag/):先用评估集算 recall,再按问题类型拆开找短板,和今天的成绩单一个思路,重点读按 segment 拆分那段。
- [Evidently AI · Precision and recall at K](https://www.evidentlyai.com/ranking-metrics/precision-recall-at-k):讲了 precision@k 在单答案场景下的局限,对照练习 1 的 0.250。
- [Pinecone · Evaluation Measures in Information Retrieval](https://www.pinecone.io/learn/offline-evaluation/):英文,把 recall@k、MRR、nDCG 放在一起讲,带图,今天的三个指标都在里面。
- [RAGAS 文档 · Context Recall](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_recall/):RAGAS 的检索层指标。它不按文章 id 比,而是让大模型判断标准答案里的每句话能不能在检索结果里找到,正好能抓到 q17 那种「文章对了、块不对」的情况,Day 261 会细讲。
- [Python 文档 · collections.defaultdict](https://docs.python.org/zh-cn/3.12/library/collections.html):中文,`defaultdict(list)` 的用法和例子。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1jq8RzrEE3&autoplay=0&high_quality=1" title="RAG的评估指标有哪些" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>乐搏软件测试 · RAG的评估指标有哪些 · 13 分钟,从测试工程师的角度讲检索指标和生成指标,前半段对应今天。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1d1DfBWErT&autoplay=0&high_quality=1" title="【有手就行】20分钟教会你基于RAGas自动化评估RAG方案的优劣!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI产品实战 · 20分钟教会你基于RAGas自动化评估RAG方案的优劣 · 24 分钟,用 RAGAS 跑检索和生成评估,今天先看它怎么组织评估数据和比较方案,框架本身留到 Day 261。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/k1yoGGVMpRg" title="RAG Evaluation, Retrieval Metrics Explained: Precision@k, Recall@k, F1, MRR and NDCG" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Slav Kurochkin · RAG Evaluation, Retrieval Metrics Explained · 英文,把 precision@k、recall@k、MRR、nDCG 一个个算一遍,开自动字幕。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/wexpoR1R03A" title="Why Your RAG System Is Broken, and How to Fix It with Jason Liu" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>The TWIML AI Podcast · Why Your RAG System Is Broken, and How to Fix It with Jason Liu · 英文访谈,讲为什么先评检索、怎么按问题类型找短板,通勤时听。</figcaption>
</figure>

### 书籍

- Christopher D. Manning 等《Introduction to Information Retrieval》(Cambridge University Press,2008),中文版《信息检索导论》(王斌译,人民邮电出版社)第 8 章:检索评价的标准做法,包括测试集、相关性判断和各种指标。
- Chip Huyen《AI Engineering》(O'Reilly,2025)第 6 章讲 RAG 的部分:检索质量怎么评、检索和生成为什么分开评。

### 开源项目与代码

- [beir-cellar/beir](https://github.com/beir-cellar/beir):学术界的检索评测框架,它的 `EvaluateRetrieval` 一次算 nDCG、MAP、recall@k、precision@k,和今天的脚本结构一样,只是规模大得多。
- [explodinggradients/ragas](https://github.com/explodinggradients/ragas):RAGAS 源码,看 `metrics/` 目录下 context recall 的实现,对照它和我们按文章 id 比的区别。

## 自测

**1. `evaluate()` 里为什么检索 `max(k, FETCH)` 块,而不是 k 块?用今天的实测说明。**

<details><summary>答案</summary>

指标按文章算,检索返回的是块,同一篇文章的几块常一起排在前面,去重后文章数比块数少。取 4 块时 26 道题有 22 道凑不够 4 篇,q26 的 kb-011 排在第 5 块被挤掉,recall@4 算成 0.5;取 10 块时它是文章级第 3 名,recall@4 是 1.0,混合检索平均 recall@4 从 0.942 变成 0.962。

</details>

**2. 同一个分数字典 `m` 为什么要同时 `append` 进 `per_type[row["type"]]` 和 `per_type["ALL"]`?**

<details><summary>答案</summary>

一份记进题型组,用来按题型算平均;一份记进总体组,用来算总分。这样一次循环就同时得到「每类题怎么样」和「整体怎么样」,不用跑两遍检索。

</details>

**3. 混合检索为什么在 q19 上比纯向量差?**

<details><summary>答案</summary>

q19「老板想看所有账但不能让他改」,向量检索第一名就是 kb-015,BM25 却靠「账」字匹配到 kb-002、kb-008 这些不相关的文章。RRF 两路等权、只看名次,BM25 的错误名次把 kb-015 挤到了第 5,掉出前 4。

</details>

**4. vector 的 hit@1 是 1.000,recall@1 只有 0.923,哪个算错了?**

<details><summary>答案</summary>

都没错。hit@1 问「第一名对不对」,recall@1 问「标准答案有几成进了前 1 名」。四道一句两问的题各有两篇标准答案,前 1 名最多拿到一篇,recall@1 最多 0.5。所以 recall@1 = (22 + 4 × 0.5) / 26 ≈ 0.923。

</details>

**5.(面试题)你的检索评估显示方案 A 比方案 B 的 hit@1 高 7.7 个百分点,评估集 26 道题。你会怎么跟老板汇报?**

<details><summary>答案</summary>

先换算成题数:26 道题里 7.7 个点就是两道题,我会把这两道题的具体问题和两边的检索结果贴出来,说明差在哪(比如 B 的融合被关键词检索拖累)。然后说清结论的边界:两道题的差距可能是噪声,当前只能说「A 在口语类问题上可能更好,待验证」;要下结论,得扩大评估集(尤其补口语和一句两问的题)、多跑几次、在留出的题上复核。汇报时同时附上按题型拆开的表,让老板看到 A 和 B 在哪类问题上各有什么风险,而不只是一个总分。

</details>

## 明天预告

Day 260 · RAG 评估(五):生成评估,让大模型当裁判。今天只量了检索层,还留下一个尾巴:q17 文章找对了,写着规则的那一块却没拿到,检索层的分数看不出来。明天跑完整的 RAG,让大模型当裁判,分别判回答忠不忠于资料、要点全不全、该拒答时拒答没有,从生成那一头把这类问题抓出来。
