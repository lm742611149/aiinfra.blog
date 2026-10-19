---
title: 'Day 19 · RAG 怎么评估:召回率、MRR、忠实度,建第一份检索测试集'
description: '昨天的对比只有 6 个问题,结论全凭感觉。今天建一份 30 条的评估集,分检索和生成两层打分:检索看 hit@1、recall@k、MRR,生成用大模型当裁判看忠实、完整、该拒答时拒答。然后用它回答「切块多大、k 取几、rerank 值不值」。'
pubDate: 2026-10-12
regime: none
tags: ['rag-evaluation', 'recall', 'mrr', 'llm-as-judge', 'ragas', 'agent-60']
series: 'agent-60'
day: 19
lang: 'zh'
---

## 今天要解决的问题

过去三天你改了很多东西:加了标题前缀,换了切块大小,加了 BM25,加了 rerank,试了 query 改写。每次改完,你是怎么判断「变好了」的?

如果答案是「问了几个问题,看着回答挺对的」,那你和大部分做 RAG 的人一样。这也是大部分 RAG 项目停在 demo 阶段的原因:没有数字,就不知道改动是进步还是退步,也说服不了任何人上线。

今天建 CloudLedger RAG 的第一份评估集,然后写两个脚本:一个评检索,一个评生成。W5 整整一周都会讲评测,今天是一个针对 RAG 的提前实战。

今天结束时你应该能做到:

1. 说清楚 RAG 为什么要分两层评估,以及每层看哪些指标。
2. 手算 hit@k、recall@k、MRR,并知道 nDCG 大概在衡量什么。
3. 建一份 30 条、覆盖五种问题类型的评估集,知道「无答案问题」为什么必须有。
4. 跑通检索评估脚本,得到按问题类型拆开的分数和失败清单。
5. 用大模型当裁判,评估回答的忠实度、完整度和拒答行为。
6. 用评估集做一次参数实验,用数字回答一个工程问题。

预计用时 5 小时。前置:Day 16 的数据和切块,Day 18 的 BM25、RRF、rerank。

## 为什么要分两层

RAG 是两段式的:先检索,再生成。答错一道题,原因只有两类:

- 检索错了:正确答案所在的文档根本没进 top-k,模型手里没有正确资料。这时候换再好的大模型、改再多 prompt 也没用。
- 生成错了:正确资料已经在 top-k 里,但模型没用好,比如漏了条件、张冠李戴、或者自己编了一句。

如果只看最终回答对不对,你没法区分这两类。改了检索,最终分数没变,可能是检索确实没提升,也可能是检索提升了但被生成的问题掩盖了。所以要分开评:

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="RAG 评估分两层:检索层看召回指标,生成层用裁判看忠实、完整和拒答">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="95" width="100" height="44" rx="4" fill="none" stroke="var(--rule)"/>
<text x="70" y="121" fill="var(--ink)" text-anchor="middle">问题</text>
<rect x="160" y="95" width="120" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="220" y="121" fill="var(--ink)" text-anchor="middle">检索 top-k</text>
<rect x="320" y="95" width="120" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="380" y="121" fill="var(--ink)" text-anchor="middle">大模型生成</text>
<rect x="480" y="95" width="130" height="44" rx="4" fill="none" stroke="var(--rule)"/>
<text x="545" y="121" fill="var(--ink)" text-anchor="middle">回答</text>
<line x1="120" y1="117" x2="160" y2="117" stroke="var(--ink-faint)"/>
<line x1="280" y1="117" x2="320" y2="117" stroke="var(--ink-faint)"/>
<line x1="440" y1="117" x2="480" y2="117" stroke="var(--ink-faint)"/>
<rect x="140" y="20" width="160" height="56" rx="4" fill="none" stroke="var(--compute)" stroke-dasharray="4 3"/>
<text x="220" y="40" fill="var(--compute)" text-anchor="middle">检索层评估</text>
<text x="220" y="58" fill="var(--ink-soft)" text-anchor="middle" font-size="11">hit@1 recall@k MRR</text>
<text x="220" y="71" fill="var(--ink-faint)" text-anchor="middle" font-size="11">纯规则,不花钱</text>
<rect x="330" y="165" width="290" height="62" rx="4" fill="none" stroke="var(--mem)" stroke-dasharray="4 3"/>
<text x="475" y="185" fill="var(--mem)" text-anchor="middle">生成层评估(LLM 裁判)</text>
<text x="475" y="203" fill="var(--ink-soft)" text-anchor="middle" font-size="11">忠实:每句话有依据吗</text>
<text x="475" y="219" fill="var(--ink-soft)" text-anchor="middle" font-size="11">完整:要点都覆盖了吗 / 拒答:该说不知道时说了吗</text>
<line x1="220" y1="76" x2="220" y2="95" stroke="var(--compute)" stroke-dasharray="3 3"/>
<line x1="475" y1="139" x2="475" y2="165" stroke="var(--mem)" stroke-dasharray="3 3"/>
</g>
</svg>
<figcaption>两层评估。检索层只需要标注「答案在哪篇文章」,用规则就能算分;生成层要判断语义,需要人或大模型来打分。</figcaption>
</figure>

检索层的好处是便宜、确定、快:只要标注好每个问题的答案在哪篇文档,算分就是纯代码,不调大模型(除了 embedding 和 rerank),跑一遍几秒钟。所以检索层的实验可以做得很频繁。生成层要调大模型生成,再调大模型打分,慢而且花钱,而且裁判本身也会犯错,适合在检索调好之后做。

## 检索指标:手算三个

假设一个问题的标准答案在 `kb-010`,检索返回的文档排名是 `[kb-011, kb-010, kb-009, kb-002]`。

hit@k(命中率):前 k 个里有没有正确文档,有就是 1,没有就是 0。这个例子里 hit@1 = 0(第一名是 kb-011),hit@2 = 1。对整份评估集取平均,就是「有多少比例的问题在前 k 个里找到了答案」。

recall@k(召回率):正确文档里,有多少比例进了前 k 个。只有一篇正确文档时,它和 hit@k 一样。差别出现在需要多篇文档的问题上:「发票抬头写错了,而且想退款」需要 kb-007 和 kb-003,如果前 4 个里只有 kb-007,recall@4 = 1/2 = 0.5,而 hit@4 = 1。对多跳、多问题的查询,recall 比 hit 更能反映「资料够不够」。

MRR(Mean Reciprocal Rank,平均倒数排名):第一个正确文档排第几,取倒数。排第 1 得 1,排第 2 得 0.5,排第 3 得 0.33,没找到得 0,再对所有问题取平均。这个例子里 MRR = 1/2 = 0.5。MRR 同时反映了「找没找到」和「排得多靠前」,很适合衡量 rerank 这类排序改进。

还有一个你会在论文和面试里听到的 nDCG。它考虑的是:相关文档可以有不同的相关程度(非常相关、有点相关),而且排得越靠后,贡献按对数衰减。客服场景里我们的标注是二元的(这篇能不能回答),用 MRR 和 recall 就够了。面试被问到,能说出「nDCG 支持分级相关性、对排名位置做对数折扣」就行。

有个细节:我们的检索结果是块级的(kb-010#1、kb-010#2),而标注是文档级的(kb-010)。同一篇文章的两个块都排在前面,不应该算成两个结果。所以先把块级排名「去重」成文档级排名,保留每篇文档第一次出现的位置,再算指标。

```python
# agent-60-lab/w3/metrics.py
"""检索指标。retrieved 是按排名排好的文档 id 列表(已去重),expected 是标准答案所在的文档 id 集合。"""


def dedup_docs(chunk_doc_ids: list[str]) -> list[str]:
    """块级结果 → 文档级排名:同一篇文章的多个块只保留排名最靠前的那个。"""
    seen: list[str] = []
    for d in chunk_doc_ids:
        if d not in seen:
            seen.append(d)
    return seen


def hit_at_k(retrieved: list[str], expected: set[str], k: int) -> float:
    return 1.0 if expected & set(retrieved[:k]) else 0.0


def recall_at_k(retrieved: list[str], expected: set[str], k: int) -> float:
    return len(expected & set(retrieved[:k])) / len(expected)


def reciprocal_rank(retrieved: list[str], expected: set[str]) -> float:
    for rank, d in enumerate(retrieved, start=1):
        if d in expected:
            return 1.0 / rank
    return 0.0


if __name__ == "__main__":
    r = dedup_docs(["kb-011", "kb-011", "kb-010", "kb-009"])
    print(r)                                          # ['kb-011', 'kb-010', 'kb-009']
    print(hit_at_k(r, {"kb-010"}, 1), hit_at_k(r, {"kb-010"}, 3))   # 0.0 1.0
    print(recall_at_k(r, {"kb-010", "kb-003"}, 3))    # 0.5
    print(reciprocal_rank(r, {"kb-010"}))             # 0.5
```

这几个函数短得可笑,但我建议你每个都手写一遍,别直接调库。面试里「手写一个 recall@k」不少见,更重要的是你得对每个数字的含义有把握,才敢拿它做决定。

## 建评估集:30 条,五种类型

评估集是今天最有价值的产出,比任何代码都值钱。它的质量决定了你所有后续判断的质量。几条原则:

问题要像真实用户。 用户不会说「请告诉我年付套餐的退款政策」,他们会说「买错了能把钱要回来吗」「Excel 存的 csv 传上去说格式不对」。评估集如果全是文档里的原话改写,分数会虚高,上线后一塌糊涂。最好的来源是真实的客服记录和搜索日志;没有的话,就自己扮演三种用户写:急躁的、不懂行的、描述很绕的。

覆盖不同类型。 我把 CloudLedger 的问题分成五类,每类都对应前几天发现的一个风险点:

| 类型 | 条数 | 考什么 | 例子 |
| --- | --- | --- | --- |
| policy | 10 | 基本的政策查询 | 降级以后多出来的账本会被删吗 |
| error_code | 6 | 精确编号匹配(Day 15/18 的短板) | 导入流水报 E1042 |
| colloquial | 6 | 口语和文档措辞差很远 | 老板想看所有账但不能让他改 |
| multi | 4 | 一句话两个问题,需要两篇文档 | 发票抬头写错了,而且我想退款 |
| unanswerable | 4 | 知识库里没有,该说不知道 | 客服电话是多少 |

分类型的意义在于:总分 85% 可能掩盖「口语类只有 30%」这种严重问题。改动之后也要按类型看,防止「错误码类涨了 10 分,口语类跌了 20 分」这种拆东墙补西墙。

**一定要有无答案的问题。** 这类问题在检索层不算分(没有正确文档),但在生成层专门考模型会不会老实说「不知道」。客服场景里,编一个不存在的电话号码或者说「支持微信支付」,比回答「我不知道」危害大得多。

标注答案要点,而不是标准答案全文。 每个问题标两三个「好回答必须包含的要点」,比如「月付的能退钱吗」的要点是「月付不支持退款」「当前周期结束后停止服务」。比对整段标准答案太死板,措辞不同就判错;比对要点,LLM 裁判容易判,人工复核也快。

```python
# agent-60-lab/w3/make_eval_set.py
"""CloudLedger 帮助中心的第一份 RAG 评估集,30 条,写到 data/eval/rag_eval.jsonl。

字段:
  question       用户问题(尽量用真实用户的说法)
  expected_docs  能回答这个问题的文章 id;空列表表示帮助中心里没有答案
  type           policy / error_code / colloquial / multi / unanswerable
  answer_points  一个好回答必须包含的要点,给 LLM 裁判对照用
"""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "eval" / "rag_eval.jsonl"

CASES = [
    # policy:直接问政策
    ("年付专业版用了两个月,想退款可以吗", ["kb-002"], "policy", ["按剩余整月比例退款", "已用月份和当月不退"]),
    ("月付的能退钱吗", ["kb-002"], "policy", ["月付不支持退款", "当前周期结束后停止服务"]),
    ("这个月被扣了两次钱", ["kb-002"], "policy", ["重复的那一笔全额退还", "3 个工作日内原路退回"]),
    ("退款多久到账", ["kb-002"], "policy", ["客服主管审批后原路退回", "支付宝 1–3 个工作日、银行卡 3–7 个工作日"]),
    ("怎么申请退款", ["kb-003"], "policy", ["设置 → 订阅 → 申请退款", "客服主管 1 个工作日内审批"]),
    ("已经开了发票还能退款吗", ["kb-003"], "policy", ["先红冲发票", "红冲完成后才能退款"]),
    ("自动扣款失败了会怎样", ["kb-004"], "policy", ["每 24 小时重试,最多 3 次", "7 天宽限期"]),
    ("降级以后多出来的账本会被删吗", ["kb-005"], "policy", ["不会删除", "变成只读"]),
    ("能开增值税专用发票吗", ["kb-006"], "policy", ["企业版或年付专业版可以开专票"]),
    ("优惠码能和别的优惠一起用吗", ["kb-008"], "policy", ["不能叠加", "每笔订单一个优惠码"]),
    # error_code:带错误码
    ("导入流水报 E1042", ["kb-010"], "error_code", ["列名不匹配或日期格式不是 YYYY-MM-DD", "下载模板,日期列设为文本"]),
    ("E1043 怎么解决", ["kb-011"], "error_code", ["文件不是 UTF-8", "另存为 CSV UTF-8 或上传 XLSX"]),
    ("上传发票提示 E2017", ["kb-012"], "error_code", ["图片模糊、分辨率低于 1000 像素或 PDF 加密", "重新拍摄或上传原始 PDF"]),
    ("付款时出现 E3001", ["kb-013"], "error_code", ["支付渠道拒绝", "换卡或用支付宝"]),
    ("API 返回 E4029", ["kb-019"], "error_code", ["超过每分钟 60 次限制", "等待一分钟后重试"]),
    ("连续付款失败被锁了,多久能再付", ["kb-013"], "error_code", ["连续 5 次失败锁定 1 小时"]),
    # colloquial:口语化,和文档措辞差得远
    ("买错了能把钱要回来吗", ["kb-002"], "colloquial", ["年付按剩余整月比例退款,当月不退", "月付不退当期"]),
    ("Excel 存的 csv 传上去说格式不对,好像是乱码", ["kb-011"], "colloquial", ["编码问题,需要 UTF-8", "另存为 CSV UTF-8"]),
    ("老板想看所有账但不能让他改", ["kb-015"], "colloquial", ["设为只读成员"]),
    ("换了手机号,收不到验证码登不上", ["kb-016"], "colloquial", ["旧手机号不能用可以提交人工审核", "2 个工作日"]),
    ("不想用了,怎么把账号删掉", ["kb-017"], "colloquial", ["设置 → 账号 → 注销账号", "30 天冷静期"]),
    ("外币的账怎么记", ["kb-020"], "colloquial", ["专业版及以上支持多币种", "汇率每天 8 点更新"]),
    # multi:一句话两个问题,需要两篇文章
    ("发票抬头写错了,而且我想退款", ["kb-007", "kb-003"], "multi", ["30 天内可红冲重开一次", "退款前需先红冲发票"]),
    ("免费版能建几个账本,一天能导出几次", ["kb-001", "kb-014"], "multi", ["1 个账本", "每天导出 1 次"]),
    ("扣款失败数据会丢吗,降级后账本还能用吗", ["kb-004", "kb-005"], "multi", ["超出额度的数据保留 90 天", "超出的账本只读"]),
    ("导入流水支持哪些银行,文件编码有要求吗", ["kb-009", "kb-011"], "multi", ["工行、招行、建行自动识别", "需要 UTF-8 编码"]),
    # unanswerable:帮助中心里没有,正确行为是说不知道或转人工
    ("你们支持微信支付吗", [], "unanswerable", ["没有找到相关说明或建议转人工,不能编造支持微信支付"]),
    ("有没有手机 App", [], "unanswerable", ["没有找到相关说明或建议转人工"]),
    ("有学生优惠吗", [], "unanswerable", ["没有找到相关说明或建议转人工"]),
    ("客服电话是多少", [], "unanswerable", ["没有找到相关说明或建议转人工,不能编造电话号码"]),
]


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8") as f:
        for i, (q, docs, typ, points) in enumerate(CASES, start=1):
            row = {"id": f"q{i:02d}", "question": q, "expected_docs": docs, "type": typ, "answer_points": points}
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"写入 {len(CASES)} 条到 {OUT}")


if __name__ == "__main__":
    main()
```

用 JSONL(一行一个 JSON)存评估集,是业界的习惯:方便追加、方便 `git diff` 看改了哪条、方便用 `jq` 筛选。评估集要进 git,和代码一起做版本管理。改了评估集,之前的分数就不可比了,所以每次实验记录里要写「评估集版本」。

30 条够吗?作为第一版够了,它能抓住大问题。但要知道它的局限:30 条里一条的变化就是 3.3 个百分点,两个方案差 3 分可能只是噪音。W5 讲测试集时会讨论样本量;实际项目里,我会从 30 条起步,每发现一个线上 bug 就加一条,几个月后自然长到几百条。

## 检索评估脚本

为了能一次试好几种切块参数,我写了一个只在内存里建索引的检索器。它和 Day 18 的 `retrieve.py` 逻辑一样,但不依赖 pgvector:改切块参数时不需要重建数据库。

```python
# agent-60-lab/w3/mem_retriever.py
"""评估专用的内存检索器:给定切块参数,在内存里建向量 + BM25 索引,支持四种模式。

和 retrieve.py 的逻辑一样,但不依赖 pgvector,方便一次试好几种切块大小。
"""
import numpy as np

from bm25_index import BM25Index
from chunking import Chunk, load_chunks
from fusion import rrf


class MemRetriever:
    def __init__(self, max_chars: int = 300, overlap: int = 50):
        self.chunks: list[Chunk] = load_chunks(max_chars, overlap)
        self.by_id = {c.id: c for c in self.chunks}
        self.bm25 = BM25Index(self.chunks)
        self._vecs: np.ndarray | None = None
        self._qcache: dict[str, np.ndarray] = {}

    def _vectors(self) -> np.ndarray:
        if self._vecs is None:  # 只有用到向量检索时才去调 embedding 接口
            from embed import embed
            self._vecs = embed([c.text for c in self.chunks])
        return self._vecs

    def _qvec(self, q: str) -> np.ndarray:
        if q not in self._qcache:
            from embed import embed_one
            self._qcache[q] = embed_one(q)
        return self._qcache[q]

    def vector_ids(self, q: str, n: int) -> list[str]:
        scores = self._vectors() @ self._qvec(q)
        return [self.chunks[i].id for i in np.argsort(-scores)[:n]]

    def bm25_ids(self, q: str, n: int) -> list[str]:
        return [cid for cid, _ in self.bm25.search(q, n)]

    def search(self, q: str, mode: str, k: int = 10, pool: int = 20) -> list[Chunk]:
        if mode == "vector":
            ids = self.vector_ids(q, k)
        elif mode == "bm25":
            ids = self.bm25_ids(q, k)
        else:
            fused = [cid for cid, _ in rrf([self.vector_ids(q, pool), self.bm25_ids(q, pool)])][:pool]
            if mode == "hybrid":
                ids = fused[:k]
            else:  # hybrid+rerank
                from rerank import rerank
                ranked = rerank(q, [self.by_id[c].text for c in fused], top_n=k)
                ids = [fused[i] for i, _ in ranked]
        return [self.by_id[c] for c in ids]
```

两个小设计:embedding 是懒加载的,只跑 BM25 模式时完全不调接口;问题向量有缓存,同一个检索器跑多种模式时,每个问题只 embed 一次。评估脚本会被反复运行,这种省钱省时间的小处理值得做。

```python
# agent-60-lab/w3/eval_retrieval.py
"""检索评估:对评估集里有答案的问题,算 hit@1、recall@k、MRR,并按问题类型拆开看。

用法:
  uv run python w3/eval_retrieval.py --modes bm25,vector,hybrid,hybrid+rerank --k 4 --chunk 300
"""
import argparse
import json
from collections import defaultdict
from pathlib import Path

from mem_retriever import MemRetriever
from metrics import dedup_docs, hit_at_k, recall_at_k, reciprocal_rank

EVAL = Path(__file__).resolve().parent.parent / "data" / "eval" / "rag_eval.jsonl"


def load_eval() -> list[dict]:
    return [json.loads(line) for line in EVAL.read_text(encoding="utf-8").splitlines() if line.strip()]


def evaluate(retriever: MemRetriever, mode: str, k: int, rows: list[dict]) -> dict:
    per_type: dict[str, list[dict]] = defaultdict(list)
    failures = []
    for row in rows:
        expected = set(row["expected_docs"])
        if not expected:
            continue  # 无答案的问题不算检索指标,留给生成评估
        chunks = retriever.search(row["question"], mode, k=max(k, 10))
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
    summary = {t: {name: round(sum(x[name] for x in ms) / len(ms), 3) for name in ms[0]} | {"n": len(ms)}
               for t, ms in per_type.items()}
    return {"summary": summary, "failures": failures}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--modes", default="bm25,vector,hybrid,hybrid+rerank")
    ap.add_argument("--k", type=int, default=4)
    ap.add_argument("--chunk", type=int, default=300)
    ap.add_argument("--overlap", type=int, default=50)
    args = ap.parse_args()

    rows = load_eval()
    retriever = MemRetriever(args.chunk, args.overlap)
    print(f"切块 max_chars={args.chunk} overlap={args.overlap},共 {len(retriever.chunks)} 块")
    for mode in args.modes.split(","):
        result = evaluate(retriever, mode, args.k, rows)
        print(f"\n== {mode} ==")
        for t, s in sorted(result["summary"].items()):
            print(f"  {t:<11} {s}")
        for qid, q, exp, got in result["failures"]:
            print(f"  ✗ {qid} {q}  期望 {exp}  实际 {got}")


if __name__ == "__main__":
    main()
```

先只跑 BM25,因为它不需要任何 API key,结果完全确定。下面是我在本机实际跑出来的输出:

```text
$ uv run python w3/eval_retrieval.py --modes bm25
切块 max_chars=300 overlap=50,共 42 块

== bm25 ==
  ALL         {'hit@1': 0.846, 'recall@4': 0.885, 'mrr': 0.856, 'n': 26}
  colloquial  {'hit@1': 0.333, 'recall@4': 0.5, 'mrr': 0.375, 'n': 6}
  error_code  {'hit@1': 1.0, 'recall@4': 1.0, 'mrr': 1.0, 'n': 6}
  multi       {'hit@1': 1.0, 'recall@4': 1.0, 'mrr': 1.0, 'n': 4}
  policy      {'hit@1': 1.0, 'recall@4': 1.0, 'mrr': 1.0, 'n': 10}
  ✗ q17 买错了能把钱要回来吗  期望 ['kb-002']  实际 []
  ✗ q19 老板想看所有账但不能让他改  期望 ['kb-015']  实际 ['kb-002', 'kb-008', 'kb-003', 'kb-018']
  ✗ q22 外币的账怎么记  期望 ['kb-020']  实际 ['kb-002', 'kb-003']
```

这组数字很能说明问题。总分 hit@1 是 0.846,看起来还行。但拆开看,错误码类是满分,口语类只有 0.333。「买错了能把钱要回来吗」一个结果都没有,因为分词后没有任何一个词出现在文档里。「外币的账怎么记」,文档里写的是「多币种」,BM25 不知道外币和多币种是一回事。如果只看总分,这个短板就被掩盖了。这正是要按类型拆开看的原因,也印证了 Day 18 的判断:BM25 擅长精确匹配,对口语无能为力。

现在配好 `.env`,跑全部四种模式,把结果填进下表:

| 模式 | ALL hit@1 | ALL recall@4 | ALL MRR | colloquial hit@1 | error_code hit@1 |
| --- | --- | --- | --- | --- | --- |
| bm25 | 0.846 | 0.885 | 0.856 | 0.333 | 1.0 |
| vector |  |  |  |  |  |
| hybrid |  |  |  |  |  |
| hybrid+rerank |  |  |  |  |  |

我对另外三行的预期是:vector 在 colloquial 上明显好于 bm25,在 error_code 上可能掉分;hybrid 两类都不差;rerank 主要提升 hit@1 和 MRR,对 recall@4 帮助有限(rerank 只能重排已经召回的候选)。你的数字如果和预期不一样,先看失败清单里具体是哪几条,再下结论。

<details><summary>我的实测结果(bge-m3 + bge-reranker-v2-m3,自己跑完再看)</summary>

三种模式一起跑大约 23 秒。

| 模式 | ALL hit@1 | ALL recall@4 | ALL MRR | colloquial hit@1 | error_code hit@1 |
| --- | --- | --- | --- | --- | --- |
| bm25 | 0.846 | 0.885 | 0.856 | 0.333 | 1.0 |
| vector | 1.0 | 0.981 | 1.0 | 1.0 | 1.0 |
| hybrid | 0.923 | 0.962 | 0.944 | 0.667 | 1.0 |
| hybrid+rerank | 0.923 | 0.981 | 0.955 | 0.667 | 1.0 |

失败清单:

```text
vector         ✗ q26 导入流水支持哪些银行,文件编码有要求吗  期望 ['kb-009', 'kb-011']  实际 ['kb-009', 'kb-010', 'kb-014', 'kb-020']
hybrid         ✗ q19 老板想看所有账但不能让他改  期望 ['kb-015']  实际 ['kb-002', 'kb-008', 'kb-006', 'kb-004']
hybrid+rerank  ✗ q26 导入流水支持哪些银行,文件编码有要求吗  期望 ['kb-009', 'kb-011']  实际 ['kb-009', 'kb-010', 'kb-014', 'kb-020']
```

结果和我的预期不一样:**纯向量是四种里最好的,混合反而比纯向量差。**

- bge-m3 在错误码上没掉分。Day 15 那个反例里,向量把 E1043 排在了 E1042 前面,但那个问题是故意写成和 E1043 文章几乎一样的说法。评估集里的 6 条错误码问题都很短,没有这种干扰,所以没暴露出来。想测出这个短板,就得往评估集里加这类「措辞像 A、问的是 B」的问题,练习 3 正好可以加一条。
- 混合把口语类拉低了。RRF 给两路同样的权重,BM25 在「老板想看所有账但不能让他改」上召回的全是不相关的文章(kb-002、kb-008),和向量的正确结果一平均,正确答案就被挤出了前 4。
- rerank 把 colloquial 的 recall@4 从 0.833 拉回 1.0,但 hit@1 没变。rerank 只能在 RRF 给的 20 个候选里重排,而 q26 的 kb-011 在向量那一路就没排进来。

这就是验收标准里说的「数字告诉我的、和我直觉不一样」的发现。但别马上得出「BM25 没用」的结论:26 条问题、42 块文档太少了,错误码类也只有 6 条。合理的下一步是给 RRF 加权重(比如向量 1.0、BM25 0.5),或者多加 10 条错误码和型号类问题再比。

</details>

## 生成评估:让大模型当裁判

检索评估回答的是「资料对不对」,生成评估回答「回答好不好」。人工逐条看当然最准,但 30 条看一遍要半小时,每改一次 prompt 都看一遍不现实。所以我们让大模型来当裁判(LLM-as-judge),人工只抽查。

我们评三件事,每件事都是二元判断(是/否),而不是 1 到 10 分:

- 忠实(faithful):回答里的每一个事实,都能在检索到的资料里找到依据吗?这一项抓的是幻觉,比如资料说当月不退,回答说按天退;或者资料没提微信支付,回答说支持。
- 完整(complete):回答覆盖了评估集里标注的要点吗?这一项抓的是漏答,比如只说了「可以退款」没说「按剩余整月比例退,当月不退」。
- 拒答(refused):对无答案的问题,回答有没有老实说不知道、并且没编造内容?

为什么用二元判断?因为让模型打 1 到 10 分,它打的分数很不稳定,同一个回答这次 7 分下次 8 分,而且你也说不清 7 分和 8 分的区别。二元判断更稳定、更容易和人工对齐、也更容易追问「为什么判否」。这是 Hamel Husain 等人反复强调的经验,Day 32 会专门讲。

```python
# agent-60-lab/w3/prompts.py
"""RAG 回答用的 prompt。从 rag_numpy.py 挪出来,避免 import 时顺带读索引文件。"""

SYSTEM = """你是云簿 CloudLedger 的客服助手。
只根据 <资料> 里的内容回答用户问题,不要用你自己的常识补充 CloudLedger 的规则。
每一个事实性的句子后面,用方括号标注出处,例如 [kb-002#1]。一句话用到多块资料就都标上。
如果资料里没有足够的信息回答,就直接说「帮助中心里没有找到这个问题的说明,建议转人工客服」,不要猜。
回答用简洁的中文,先给结论,再给条件和步骤。"""


def build_messages(question: str, chunks: list) -> list[dict]:
    """chunks 里的元素要有 id、title、text 三个属性(chunking.Chunk 就满足)。"""
    docs = "\n\n".join(f'<doc id="{c.id}" title="{c.title}">\n{c.text}\n</doc>' for c in chunks)
    return [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": f"<资料>\n{docs}\n</资料>\n\n用户问题:{question}"},
    ]
```

Day 17 留的那个小重构顺手做了:prompt 单独放进 `prompts.py`,以后 W4 的工单 Agent 也从这里导入。

```python
# agent-60-lab/w3/eval_generation.py
"""生成评估:跑完整 RAG,再让大模型当裁判,检查三件事:
  faithful    回答里的每个事实是否都能在检索到的资料里找到依据
  complete    是否覆盖了 answer_points 里的要点
  refused     对无答案的问题,是否老实说了不知道/转人工
"""
import argparse
import json
from pathlib import Path

from eval_retrieval import load_eval
from llm import chat
from mem_retriever import MemRetriever
from prompts import build_messages

OUT = Path(__file__).resolve().parent.parent / "data" / "eval" / "generation_results.jsonl"

JUDGE_FAITHFUL = """你是严格的审核员。下面有一段【资料】和一个客服【回答】。
逐句检查回答中的事实性陈述(规则、数字、步骤、时限),判断它们是否都能在资料中找到明确依据。
礼貌用语和「建议转人工」这类话不算事实陈述。
只输出 JSON:{"faithful": true 或 false, "unsupported": ["没有依据的陈述", ...]}"""

JUDGE_COMPLETE = """你是严格的审核员。下面有一个用户【问题】、一份【必须包含的要点】和客服【回答】。
判断回答是否覆盖了每一个要点(意思一致即可,不要求字面相同)。
只输出 JSON:{"complete": true 或 false, "missing": ["缺失的要点", ...]}"""

JUDGE_REFUSED = """下面是用户【问题】和客服【回答】。帮助中心里其实没有这个问题的答案。
判断回答是否老实表示没有找到相关信息或建议转人工,并且没有编造具体的规则、数字或联系方式。
只输出 JSON:{"refused": true 或 false, "reason": "一句话理由"}"""


def judge(system: str, user: str) -> dict:
    raw = chat([{"role": "system", "content": system}, {"role": "user", "content": user}],
               temperature=0, response_format={"type": "json_object"})
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"error": raw[:200]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default="hybrid+rerank")
    ap.add_argument("--k", type=int, default=4)
    args = ap.parse_args()

    retriever = MemRetriever()
    results = []
    for row in load_eval():
        chunks = retriever.search(row["question"], args.mode, k=args.k)
        answer = chat(build_messages(row["question"], chunks), temperature=0)
        context = "\n\n".join(c.text for c in chunks)
        r = {"id": row["id"], "type": row["type"], "question": row["question"], "answer": answer}
        if row["expected_docs"]:
            r |= judge(JUDGE_FAITHFUL, f"【资料】\n{context}\n\n【回答】\n{answer}")
            r |= judge(JUDGE_COMPLETE, f"【问题】{row['question']}\n【必须包含的要点】{row['answer_points']}\n\n【回答】\n{answer}")
        else:
            r |= judge(JUDGE_REFUSED, f"【问题】{row['question']}\n\n【回答】\n{answer}")
        results.append(r)
        flags = " ".join(f"{k}={r[k]}" for k in ("faithful", "complete", "refused") if k in r)
        print(f"{r['id']} {flags}  {row['question']}")

    OUT.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in results), encoding="utf-8")
    answerable = [r for r in results if "faithful" in r]
    unanswerable = [r for r in results if "refused" in r]
    rate = lambda rs, key: sum(bool(r.get(key)) for r in rs) / max(len(rs), 1)  # noqa: E731
    print(f"\n忠实率 {rate(answerable, 'faithful'):.0%}  完整率 {rate(answerable, 'complete'):.0%}  "
          f"拒答正确率 {rate(unanswerable, 'refused'):.0%}  明细见 {OUT}")


if __name__ == "__main__":
    main()
```

几点说明。

裁判 prompt 里给了明确的判断标准,比如「礼貌用语不算事实陈述」。不写这条,裁判会把「建议您联系客服」也判成「资料里没有依据」。我第一版就是这样,忠实率低得离谱,一看明细全是这种误判。

每个裁判只判一件事。 把忠实、完整、拒答放进一个 prompt 让模型一次判完,省钱,但准确率会下降,出了问题也不好排查。

一定要人工看明细。 跑完打开 `generation_results.jsonl`,至少抽 10 条看:裁判判「不忠实」的,是回答真编了,还是裁判误判?判「完整」的,是真的完整吗?裁判本身也会错,在你确认它和你的判断大体一致之前,别太信它给的百分比。这件事叫「对齐裁判」,Day 32 详细讲。

成本。 30 条问题,每条 1 次生成 + 1 到 2 次裁判,总共大约 85 次调用。每次输入大约 1,000 到 1,500 token,总输入约 10 万 token,按 DeepSeek 这类模型的价位,一次完整评估几毛钱。价格以你用的厂商当前价格页为准,但量级就是这样:评估是很便宜的,不做评估才贵。

| 配置 | 忠实率 | 完整率 | 拒答正确率 | 备注 |
| --- | --- | --- | --- | --- |
| hybrid+rerank, k=4 |  |  |  |  |
| vector, k=4 |  |  |  |  |
| hybrid+rerank, k=8 |  |  |  |  |
| 去掉 SYSTEM 里「不知道就说不知道」 |  |  |  |  |

<details><summary>我的实测结果(deepseek-flash 关思考模式,自己跑完再看)</summary>

hybrid+rerank、k=4,30 条跑了 1 分 44 秒:

```text
忠实率 100%  完整率 92%  拒答正确率 100%
```

两条判成不完整的,刚好一条是检索的问题、一条是生成的问题,正好说明为什么要分两层看:

- **q26「导入流水支持哪些银行,文件编码有要求吗」:是检索的问题。** 上面检索评估里,它就是 hybrid+rerank 的失败项,kb-011(编码)没进前 4。模型手里没有资料,老实回答了「关于文件编码:帮助中心里没有找到这个问题的说明,建议转人工客服」。所以忠实是 True,完整是 False。这时候去改 prompt 没用,要改检索。
- **q17「买错了能把钱要回来吗」:是生成的问题。** 检索是对的,kb-002 和 kb-003 都在前 4。但模型只答了退款的操作步骤和到账时间,没说「年付按剩余整月比例退,当月不退」「月付不退当期」这两条最关键的规则。用户其实是在问「能不能退」,模型却回答了「怎么退」。要修这一层,得改 prompt(比如「先回答能不能、有什么条件,再给步骤」)。

忠实率 100% 也别太当真。去 `generation_results.jsonl` 抽几条看看,裁判是不是把「每 24 小时重试,最多 3 次」这类数字都对照过资料了。

</details>

## 用评估集做一次实验

有了评估集,之前悬而未决的问题都可以用数字回答了。挑一个最实际的:切块多大?

```bash
for c in 100 300 800; do
  uv run python w3/eval_retrieval.py --modes hybrid --chunk $c --overlap 20
done
```

这里我要坦白一个情况。我先用 BM25 模式跑了 100、300、800 三档,三档的分数完全一样,块数分别是 45、42、42。原因是 CloudLedger 的文章太短了,大部分小节本来就不到 100 字,切块参数基本没起作用。这不是实验失败,而是一个有用的结论:**在这份数据上,切块大小不是瓶颈,别在这上面浪费时间。** 真正拉开差距的是检索方式(BM25 在口语类上的短板)。

这正是评估集的价值。如果没有它,你可能会花一下午调切块参数,凭感觉觉得「好像好一点」。有了它,五分钟就知道该把精力放在哪。等 W7 毕业项目把帮助中心扩充到 60 多篇、加入几千字的长文档后,切块大小的影响才会显现,到时候再用同一个脚本测。

做实验时要守几条纪律:

- 一次只改一个变量。 同时改切块和 k,分数变了你不知道是谁的功劳。
- 记实验日志。 日期、评估集版本、改了什么、各项分数、结论。一张表格就够,但必须有。几周后你会感谢自己。
- 看失败清单,不只看分数。 分数从 0.85 涨到 0.88,具体是哪几条变对了?有没有原来对的变错了?
- 小心对评估集过拟合。 反复针对评估集里那几条失败的问题改 prompt,分数会越来越高,但真实效果未必。办法是定期补充新问题,特别是从线上真实反馈里来的。

## RAGAS 和其他评估框架

你会在 JD 和面试里听到 RAGAS 这个名字。它是一个开源的 RAG 评估框架,提出了几个流行的指标:faithfulness(忠实度)、answer relevancy(回答相关性)、context precision(上下文精确率)、context recall(上下文召回率)。它的 faithfulness 做法和我们差不多:先把回答拆成一条条陈述,再逐条判断能否从上下文推出。

我的建议是:先像今天这样自己写,把每个指标的含义吃透;然后去看 [RAGAS 的指标文档](https://docs.ragas.io/en/stable/concepts/metrics/),对照它的定义,你会发现很容易理解。生产上用不用框架,看团队习惯。框架的好处是指标标准、和社区可比;坏处是黑盒,出了奇怪的分数不好排查,而且版本更新时 API 变化很快。面试时能说出「RAGAS 的 faithfulness 是怎么算的」以及「我们为什么自己写/为什么用它」,比单纯说「我们用了 RAGAS」强得多。

## 动手练习

1. 跑 `make_eval_set.py`,然后 `eval_retrieval.py --modes bm25`,对照我贴的输出,确认完全一致(BM25 是确定性的,数字应该一模一样;如果你改过帮助中心文章或分词词典,会有差异)。
2. 配好 API 后跑四种模式,填完检索对比表。找出 hybrid+rerank 仍然失败的问题,逐条分析原因。
3. 给评估集加 5 条你自己写的问题,至少包含 1 条无答案问题和 1 条多问题。重新跑,看分数变化。记得这时候评估集版本变了。
4. 跑 `eval_generation.py`,打开结果文件,人工检查 10 条裁判的判断,记录裁判和你意见不一致的次数。
5. 删掉 SYSTEM 里「没有就说不知道」那句,只重跑生成评估,看拒答正确率的变化。

**验收标准:** 检索对比表填完;生成评估跑通并人工抽查过;实验日志里至少有 3 行记录(配置、分数、结论);能讲出一个「数字告诉我的、和我直觉不一样」的发现。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 评估集(eval set) | 一组带标注的测试问题,用来给系统打分 |
| hit@k | 前 k 个结果里是否包含正确文档 |
| recall@k | 正确文档中有多少比例出现在前 k 个结果里 |
| MRR | 平均倒数排名,第一个正确结果排名的倒数的平均值 |
| nDCG | 支持分级相关性、按排名位置做对数折扣的排序指标 |
| 忠实度(faithfulness) | 回答里的事实是否都有资料依据,衡量幻觉 |
| 完整度 | 回答是否覆盖了必须包含的要点 |
| 拒答 | 资料不足时回答「不知道」或转人工 |
| LLM-as-judge | 用大模型给另一个模型的输出打分 |
| JSONL | 每行一个 JSON 对象的文件格式,评估集常用 |
| RAGAS | 开源 RAG 评估框架,提出了 faithfulness、context recall 等指标 |
| 过拟合评估集 | 针对评估集里的具体问题反复调优,分数升高但真实效果不变 |

## 常见误区

**只看最终回答,不分检索和生成。** 出了错不知道该改哪一层,改了也不知道是哪一层起的作用。

**评估集问题照抄文档原文。** 分数会虚高。用户的真实说法和文档措辞差得很远,口语类问题必须有。

**没有无答案的问题。** 系统最危险的行为(编造)完全没被测到。

**只看总分。** 总分可能掩盖某一类问题的严重短板,BM25 的口语类只有 0.333 就是例子。

**完全相信 LLM 裁判。** 裁判会误判,尤其是标准写得含糊的时候。要人工抽查,确认它和人的判断一致。

**评估集一成不变。** 它应该随着线上发现的问题持续增长。一份半年没更新的评估集,大概率已经不能代表真实流量了。

**差 2 分就宣布胜利。** 30 条评估集,一条就是 3.3 分。小幅差异要多跑几次、扩大样本再下结论。

## 学习资料

### 文档与文章

- [Hamel Husain · Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/):讲评估为什么是 AI 产品迭代的核心,W5 会精读,今天先读前半部分建立观念,30 分钟。
- [Hamel Husain · Creating a LLM-as-a-Judge That Drives Business Results](https://hamel.dev/blog/posts/llm-judge/):二元判断、裁判对齐的方法论,今天裁判 prompt 的设计思路来自这里。
- [Jason Liu · Systematically Improving Your RAG](https://jxnl.co/writing/2024/05/22/systematically-improving-your-rag/):从合成评估数据、分类型分析到迭代改进的完整方法,非常实战,1 小时。
- [RAGAS 指标文档](https://docs.ragas.io/en/stable/concepts/metrics/) 和论文 [Ragas: Automated Evaluation of Retrieval Augmented Generation](https://arxiv.org/abs/2309.15217):对照今天自己写的指标看。
- [Evidently AI · RAG evaluation guide](https://www.evidentlyai.com/llm-guide/rag-evaluation):一篇把检索和生成指标整理得很全的指南。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1b69gB5E3h&autoplay=0&high_quality=1" title="面试官问:如何评估RAG系统的效果?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI深度幻觉 · 面试官问:如何评估RAG系统的效果? · 12 分钟,从面试回答的角度梳理 RAG 评估,看完对照今天的两层框架,检查自己能不能讲得更好。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Jz421Q7Lw&autoplay=0&high_quality=1" title="如何利用RAGAs评估RAG系统的好坏" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>果粒奶优有果粒 · 如何利用RAGAs评估RAG系统的好坏 · 25 分钟,演示 RAGAS 的用法。注意视频是 2024 年的,RAGAS 的 API 后来变过,以官方文档为准。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/RrDBV6odPKo" title="Systematically improving RAG applications" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hamel Husain · Systematically improving RAG applications · 69 分钟,Hamel 和 Jason Liu 的对谈,讲怎么用评估驱动 RAG 迭代。前 30 分钟最有价值。</figcaption>
</figure>

- Evidently AI《6.1 How to evaluate a RAG system: methods and metrics》(YouTube ID `qI2qQfOG0Js`,7 分钟):指标的快速梳理。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 3 章「Evaluation Methodology」和第 4 章「Evaluate AI Systems」:评估方法论讲得最系统的一本书,今天先读第 3 章里关于 AI as a judge 的部分,W5 再通读,约 2 小时。
- Christopher Manning 等《Introduction to Information Retrieval》[免费在线版](https://nlp.stanford.edu/IR-book/)第 8 章「Evaluation in information retrieval」:precision、recall、MRR、nDCG 的经典定义。

### 开源项目与代码

- [explodinggradients/ragas](https://github.com/explodinggradients/ragas):RAGAS 源码,看 faithfulness 指标的实现,和今天的裁判 prompt 对比。
- [datawhalechina/llm-universe](https://github.com/datawhalechina/llm-universe):里面有评估与优化 RAG 的中文章节。

## 自测

**1. 检索结果文档排名是 `[kb-003, kb-007, kb-002]`,标准答案是 `{kb-007, kb-002}`。求 hit@1、recall@2、MRR。**

<details><summary>答案</summary>

hit@1 = 0(第一名 kb-003 不在答案里)。recall@2 = 1/2 = 0.5(前两名里只有 kb-007)。MRR:第一个正确结果 kb-007 排第 2,倒数是 0.5。

</details>

**2. 为什么检索结果要先按文档去重,再算指标?**

<details><summary>答案</summary>

检索是块级的,标注是文档级的。同一篇文章的多个块排在前面,如果不去重,会挤占 top-k 的名额,也会让 recall 计算混乱。去重时保留每篇文档第一次出现的位置,代表这篇文档的排名。

</details>

**3. 评估集里为什么要有无答案的问题?它们在检索层怎么处理?**

<details><summary>答案</summary>

它们测试系统在资料不足时会不会编造,这是客服场景危害最大的错误。检索层没有正确文档,不计入 hit/recall/MRR;在生成层专门用「拒答」裁判判断回答是否老实说不知道、有没有编造。

</details>

**4. BM25 的总 hit@1 是 0.846,但口语类只有 0.333。这说明了什么?你会怎么做?**

<details><summary>答案</summary>

说明 BM25 擅长精确词匹配,对和文档措辞不同的口语问题无能为力,总分掩盖了这个短板。应该引入向量检索做混合,或者加 query 改写把口语转成文档用语;改完按类型重新评估,确认口语类上升的同时错误码类没有下降。

</details>

**5. 为什么 LLM 裁判用「是/否」判断,而不是 1–10 分?**

<details><summary>答案</summary>

1–10 分的打分不稳定,同一个回答多次打分会波动,而且分数之间的界限说不清;二元判断标准更清晰,更稳定,更容易和人工判断对齐和核对,也更容易从「判否」的理由里找到可操作的问题。

</details>

**6.(面试题)你们的 RAG 系统上线前,老板问「准确率有多少」,你怎么回答?怎么得出这个数字?**

<details><summary>答案</summary>

不给一个笼统的数字,而是分层分类型回答:检索层在 N 条标注问题上 recall@4 是多少、MRR 是多少;生成层忠实率、完整率多少,无答案问题的正确拒答率多少;按问题类型(政策、错误码、口语、多问题)分别是多少,哪一类最弱、计划怎么补。说明评估集的构成和规模(来源、条数、版本)、裁判经过人工抽查的一致率。再说上线后的计划:收集线上反馈和点踩案例补充评估集,定期回归。体现的是「数字有来源、有拆解、有局限说明」。

</details>

## 明天预告

Day 20 · 上下文工程与记忆:窗口预算、压缩、长期记忆、Agentic RAG。到今天,RAG 还是一个「每次都检索」的固定流程。明天把视角拉高到整个 Agent:上下文窗口里到底该放什么,对话越来越长怎么压缩,用户上次说过的事怎么记住,以及把「检索」做成一个工具,让 Agent 自己决定什么时候查、查几次。
