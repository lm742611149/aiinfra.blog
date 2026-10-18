---
title: 'Day 18 · 检索质量:混合检索、rerank、query 改写'
description: '纯向量检索遇到 E1042 这种错误码就犯迷糊。今天加上 jieba + BM25 关键词检索,用 RRF 融合两路结果,用 bge-reranker 精排,让大模型改写口语化的问题;最后回到上游,处理 PDF、表格和扫描件的文档解析。'
pubDate: 2026-10-12
regime: none
tags: ['hybrid-search', 'bm25', 'rerank', 'rrf', 'query-rewrite', 'agent-60']
series: 'agent-60'
day: 18
lang: 'zh'
---

## 今天要解决的问题

Day 15 我说过 embedding 有两个短板:对否定词不敏感,对编号和专有名词不敏感。Day 16 和 Day 17 搭好了向量检索,今天来补这两个短板。

先看一个具体的失败。CloudLedger 帮助中心里有两篇长得很像的文章:《错误码 E1042:银行流水导入失败》和《错误码 E1043:文件编码错误》。用户问「导入的时候报 E1043」,向量检索很可能把 E1042 那篇排第一,因为两篇都在讲「导入出错」,话题几乎一样,而「1042」和「1043」在 embedding 眼里差别很小。客服 Agent 拿着 E1042 的解决办法(改日期格式)去回答一个编码问题,用户照着做了,问题没解决,然后投诉。

这就是检索质量的问题。RAG 的回答质量有一个很硬的上限:**检索没找到的东西,模型不可能答对**。所以生产系统里,检索这一层通常不止一步,而是一条流水线:多路召回 → 融合 → 精排。今天把它一块块搭起来。

今天结束时你应该能做到:

1. 解释 BM25 是怎么打分的,为什么它擅长精确匹配,以及中文为什么要先分词。
2. 用 RRF 把向量检索和关键词检索的结果融合,能手算 RRF 分数。
3. 讲清楚 rerank(cross-encoder)和 embedding(bi-encoder)的区别,调通 bge-reranker。
4. 用大模型做 query 改写和多路查询,知道 HyDE 是什么。
5. 对 6 个测试问题,做出「纯向量 / 纯 BM25 / 混合 / 混合 + rerank」的对比表。
6. 把 PDF(含表格和扫描页)解析成适合切块的 Markdown,知道表格怎么切块、什么时候该换 MinerU 这类解析工具。

预计用时 6 小时。前置:Day 16 的切块和数据,Day 17 的 pgvector 检索。

## BM25:老派但好用的关键词检索

BM25 是搜索引擎用了几十年的打分算法,Elasticsearch 默认的相关性算法就是它。它不懂语义,只数词。但「只数词」恰好是向量检索缺的那部分能力。

它的打分逻辑用人话说是三条:

一个词在这篇文档里出现得越多,分越高,但有上限。 「退款」出现 1 次和出现 2 次差别很大,出现 20 次和 21 次差别就很小了。这叫词频饱和,由参数 `k1` 控制。

一个词在所有文档里越少见,越重要。 「的」「是」每篇都有,没有区分度;「E1043」只在一篇里出现,一旦匹配上就是强信号。这叫逆文档频率(IDF)。错误码、订单号、产品型号这些词,IDF 都很高,所以 BM25 对它们特别敏感。这正是我们要的。

文档越长,分数越要打折。 一篇万字长文偶然提到一次「退款」,不应该比一篇专讲退款的短文得分高。这叫长度归一化,由参数 `b` 控制。

公式写出来是这样,不用背,知道每部分对应上面哪一条就行:

```text
score(D, Q) = Σ  IDF(q) × f(q,D) × (k1 + 1) / ( f(q,D) + k1 × (1 - b + b × |D| / avgdl) )
            q∈Q

f(q,D)  : 词 q 在文档 D 里出现的次数          → 第 1 条
IDF(q)  : 包含 q 的文档越少,值越大            → 第 2 条
|D|/avgdl: 文档长度 / 平均长度                 → 第 3 条
k1 通常 1.2–2.0,b 通常 0.75
```

### 中文要先分词

英文天然有空格,BM25 直接按空格切词。中文没有,「企业版年付中途取消能退多少」必须先切成词,BM25 才能数。分词质量直接决定 BM25 的效果。

Python 里最常用的中文分词库是 jieba。我拿它试了几个句子,发现一个典型问题:

```text
jieba.lcut("企业版年付中途取消能退多少")
→ ['企业', '版年付', '中途', '取消', '能', '退', '多少']
```

「版年付」是错的。jieba 不认识「企业版」「年付」这些业务词,于是按统计规律切出了奇怪的组合。解决办法是加自定义词典,把你的业务术语告诉它。加了以后,「企业版」「年付」就能正确切出来。

这件事在真实项目里很重要:每个行业都有自己的术语,通用分词器一定会切错。我做过的项目都会维护一份业务词表,从产品文档里抽,定期更新。

顺带一提,Postgres 自带的全文检索(`tsvector`)默认的解析器不会切中文,一整句中文会被当成一个词。要在 Postgres 里做中文全文检索,得装 [zhparser](https://github.com/amutu/zhparser) 或 [pg_jieba](https://github.com/jaiminpan/pg_jieba) 这类扩展。课程里为了简单,BM25 在 Python 内存里做,42 块数据一瞬间就建好了。生产上几十万块的话,可以用 Elasticsearch/OpenSearch(装 IK 分词插件)或者 Postgres + 中文分词扩展。

### 代码

```bash
uv add jieba rank-bm25
```

```python
# agent-60-lab/w3/bm25_index.py
"""关键词检索:jieba 分词 + BM25。和向量检索互补,专治错误码、专有名词。"""
import logging
import re

import jieba
from rank_bm25 import BM25Okapi

from chunking import Chunk, load_chunks

jieba.setLogLevel(logging.WARNING)
# 业务词典:不加的话 jieba 会把「企业版年付」切成「企业 / 版年付」
for word in ["免费版", "专业版", "企业版", "年付", "月付", "红冲", "自动续费", "宽限期", "两步验证", "多币种", "账本"]:
    jieba.add_word(word)

# 写成集合字面量;写 set("... ".split()) 也能跑,但 Ruff 会报 SIM905 提示改成字面量
STOPWORDS = {
    "的", "了", "是", "吗", "呢", "啊", "吧", "在", "和", "与", "及", "或", "我", "你", "我们", "你们",
    "怎么", "怎么办", "什么", "如何", "可以", "能", "还", "要", "就", "都", "也", "把", "被", "让", "会",
    "有", "没有", "一个", "时候", "报",
}
WORD = re.compile(r"\w+")  # \w 在 Python 里包含汉字、字母、数字,用来去掉标点和空格


def tokenize(text: str) -> list[str]:
    return [t.lower() for t in jieba.lcut(text) if WORD.fullmatch(t) and t not in STOPWORDS]


class BM25Index:
    def __init__(self, chunks: list[Chunk]):
        self.chunks = chunks
        self.bm25 = BM25Okapi([tokenize(c.text) for c in chunks])

    def search(self, query: str, k: int = 20) -> list[tuple[str, float]]:
        scores = self.bm25.get_scores(tokenize(query))
        order = sorted(range(len(scores)), key=lambda i: -scores[i])[:k]
        return [(self.chunks[i].id, float(scores[i])) for i in order if scores[i] > 0]


if __name__ == "__main__":
    idx = BM25Index(load_chunks())
    for q in ["导入流水提示 E1042 怎么办", "E1043 是什么错误", "企业版年付中途取消能退多少"]:
        print(q, tokenize(q))
        for cid, s in idx.search(q, 3):
            print(f"   {s:6.2f}  {cid}")
```

```bash
uv run python w3/bm25_index.py
```

`tokenize()` 那一行是列表推导式,`[输出 for 变量 in 列表 if 条件]`,相当于 TS 的 `.filter(...).map(...)` 合成一行。拆开就是:jieba 切词 → `WORD.fullmatch` 去掉空格和标点 → 去掉停用词 → 转小写。拿「导入的时候报 E1043」走一遍:

```text
jieba.lcut   ['导入', '的', '时候', '报', ' ', 'E1043']
去空格标点   ['导入', '的', '时候', '报', 'E1043']
去停用词     ['导入', 'E1043']
转小写       ['导入', 'e1043']
```

转小写是为了让用户打的 `e1043` 和文档里的 `E1043` 算同一个词。建索引(`BM25Index.__init__`)和查询(`search`)都调同一个 `tokenize`,两边切法才一致。

`BM25Index` 两个方法:

- `__init__` 建索引,只跑一次。传给 `BM25Okapi` 的是「每块分好词的列表」组成的列表(42 个),它在内部把每个词的 IDF、每块长度、平均长度都预先算好。
- `search` 分三步。`get_scores` 返回 42 个分数,第 i 个对应第 i 块;`sorted(range(len(scores)), key=lambda i: -scores[i])[:k]` 排的是下标 0–41,按分数从高到低取前 k 个,相当于 TS 的 `[...Array(n).keys()].sort((a, b) => scores[b] - scores[a]).slice(0, k)`;最后把下标换回 `(块 id, 分数)`,丢掉 0 分的(一个词都没匹配上),`float()` 是把 numpy 的数字转成普通 Python float。纯 BM25 搜「把钱要回来」返回空,就是 42 块全是 0 分、在这一步被全部过滤了。

第一次运行 jieba 会打印两行 `SyntaxWarning: invalid escape sequence`,是 jieba 源码老写法在新版 Python 下的警告,不影响结果,忽略即可。

这段不调任何 API,我在本机跑过,输出是这样的(分数是 BM25 原始分,只在同一个查询内部可比):

```text
导入流水提示 E1042 怎么办 ['导入', '流水', '提示', 'e1042']
     8.26  kb-010#2
     7.00  kb-010#1
     4.03  kb-009#1
E1043 是什么错误 ['e1043', '错误']
     8.06  kb-011#1
     6.31  kb-011#2
企业版年付中途取消能退多少 ['企业版', '年付', '中途', '取消', '退', '多少']
    12.02  kb-002#1
     7.75  kb-002#2
     4.18  kb-006#1
```

E1042 和 E1043 各自精确命中了自己那篇,这就是 BM25 的价值。第三个查询加了业务词典后,「企业版」「年付」都切对了。但查询里的「退」和文档里的「退款」是两个不同的词,BM25 匹配不上。它照样找对了,靠的是「企业版」「年付」「中途」「取消」这些词。这也说明了 BM25 的短板:用户说「退」、文档写「退款」,用户说「把钱要回来」、文档写「退款」,它都无能为力。这部分正好是向量检索擅长的。两者互补,所以要混合。

停用词表里的「时候」「报」是我实测踩坑后加的。最初的表里没有它们,结果「导入的时候报 E1043」这个问题,BM25 把《自动续费与扣款规则》排了第一。拆开看各个词的 IDF:「时候」在 42 块里只出现在 kb-004 一处,IDF 是 3.32;「e1043」出现在 kb-011 的两块里,IDF 只有 2.79。一个口语虚词的权重压过了错误码,原因就是它在语料里碰巧少见。所以 BM25 的停用词表不是网上抄一份就完事,要拿真实的用户问题跑一跑,看哪些口语词在捣乱。

还有一个 `rank_bm25` 的小坑:它的 IDF 计算在文档很少时会出现 0 甚至负数(一个词出现在一半以上的文档里时)。比如你用 2 篇文档测试,分数全是 0,别以为代码写错了。我们有 42 块,大部分词不会碰到这个问题。

## RRF:把两路结果合起来

现在有两份排名:向量检索的 top-20 和 BM25 的 top-20。怎么合成一份?

最直觉的想法是把两边的分数加起来。但这行不通:余弦相似度在 0 到 1 之间,BM25 分数可能是 0 到 20,量纲完全不同。你可以做归一化,但不同查询的分数分布又不一样,很难调。

RRF(Reciprocal Rank Fusion,倒数排名融合)的做法很聪明:不看分数,只看名次。每一路里排第 r 名的结果,得 `1 / (k + r)` 分,k 是常数,通常取 60。一个结果在几路里的得分加起来,就是它的最终得分。

手算一个例子。向量检索结果是 `[kb-011#1, kb-010#1, kb-009#2]`,BM25 结果是 `[kb-010#1, kb-010#2]`:

- kb-010#1:向量第 2 名,得 1/62 = 0.01613;BM25 第 1 名,得 1/61 = 0.01639;合计 0.0325
- kb-011#1:只在向量里,第 1 名,1/61 = 0.0164
- kb-010#2:只在 BM25 里,第 2 名,1/62 = 0.0161
- kb-009#2:只在向量里,第 3 名,1/63 = 0.0159

kb-010#1 在两路里都排得靠前,所以融合后排第一。这正是 RRF 的思想:被多路同时认可的结果更可信。k=60 的作用是把分数压平,让第 1 名和第 5 名的差距没那么夸张,避免某一路的第一名一家独大。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="向量检索和 BM25 两路结果经 RRF 融合,两路都靠前的结果排到第一">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--mem)">向量检索</text>
<rect x="20" y="40" width="150" height="28" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="30" y="58" fill="var(--ink)">1. kb-011#1</text>
<rect x="20" y="74" width="150" height="28" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="30" y="92" fill="var(--ink)">2. kb-010#1</text>
<rect x="20" y="108" width="150" height="28" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="30" y="126" fill="var(--ink)">3. kb-009#2</text>
<text x="20" y="170" fill="var(--compute)">BM25</text>
<rect x="20" y="182" width="150" height="28" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="30" y="200" fill="var(--ink)">1. kb-010#1</text>
<rect x="20" y="216" width="150" height="28" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="30" y="234" fill="var(--ink)">2. kb-010#2</text>
<rect x="250" y="110" width="110" height="44" rx="4" fill="none" stroke="var(--ink-soft)"/>
<text x="305" y="130" fill="var(--ink)" text-anchor="middle">RRF</text>
<text x="305" y="146" fill="var(--ink-faint)" text-anchor="middle" font-size="11">Σ 1/(60+r)</text>
<line x1="170" y1="88" x2="250" y2="125" stroke="var(--ink-faint)"/>
<line x1="170" y1="196" x2="250" y2="140" stroke="var(--ink-faint)"/>
<rect x="420" y="56" width="200" height="28" rx="3" fill="none" stroke="var(--ink)"/><text x="430" y="74" fill="var(--ink)">0.0325 kb-010#1</text>
<rect x="420" y="90" width="200" height="28" rx="3" fill="none" stroke="var(--rule)"/><text x="430" y="108" fill="var(--ink-soft)">0.0164 kb-011#1</text>
<rect x="420" y="124" width="200" height="28" rx="3" fill="none" stroke="var(--rule)"/><text x="430" y="142" fill="var(--ink-soft)">0.0161 kb-010#2</text>
<rect x="420" y="158" width="200" height="28" rx="3" fill="none" stroke="var(--rule)"/><text x="430" y="176" fill="var(--ink-soft)">0.0159 kb-009#2</text>
<line x1="360" y1="132" x2="420" y2="120" stroke="var(--ink-faint)"/>
<text x="420" y="214" fill="var(--ink-soft)" font-size="11">两路都靠前的排第一</text>
<text x="420" y="232" fill="var(--ink-soft)" font-size="11">只看名次,不比原始分数</text>
</g>
</svg>
<figcaption>RRF 融合示意,数字就是正文手算的结果。两路检索各自擅长不同的问题,融合后取长补短。</figcaption>
</figure>

```python
# agent-60-lab/w3/fusion.py
from collections import defaultdict


def rrf(rankings: list[list[str]], k: int = 60) -> list[tuple[str, float]]:
    """Reciprocal Rank Fusion:每一路排名第 r 的结果得 1/(k+r) 分,各路相加。只看名次,不看原始分数。"""
    scores: dict[str, float] = defaultdict(float)
    for ranking in rankings:
        for rank, cid in enumerate(ranking, start=1):
            scores[cid] += 1.0 / (k + rank)
    return sorted(scores.items(), key=lambda kv: -kv[1])


if __name__ == "__main__":
    vector = ["kb-011#1", "kb-010#1", "kb-009#2"]
    keyword = ["kb-010#1", "kb-010#2"]
    for cid, s in rrf([vector, keyword]):
        print(f"{s:.4f}  {cid}")
```

跑一下 `python3 w3/fusion.py`,输出和上面手算的四行一致。

RRF 简单到有点不像「算法」,但它非常好用,Elasticsearch、OpenSearch、各种向量数据库的混合检索默认都是它。它来自 2009 年 Cormack 等人在 SIGIR 发表的论文,论文的结论是这个简单方法打败了当时很多复杂的融合方法。

## Rerank:先粗筛,再精排

混合检索解决了「找得全」的问题,但排序还不够精。这里要引入一个新角色:rerank 模型(重排序模型)。

要理解 rerank,先要分清两种模型结构:

bi-encoder(双塔),也就是 embedding 模型。 问题和文档分别编码成向量,再算余弦。好处是文档向量可以提前算好存起来,检索时只需要编码问题,再做一次向量比较,百万级文档也是毫秒级。坏处是问题和文档在编码时互相「看不见」,只能各自压缩成一个向量再比,细节丢得多。

cross-encoder(交叉编码),也就是 rerank 模型。 把问题和一篇文档拼在一起送进模型,模型同时看两者,直接输出一个相关性分数。因为能逐字对照,它判断得准得多,「E1043」和「E1042」这种差别它能看出来,「支持」和「不支持」也能。坏处是不能提前算,每个(问题,文档)对都要跑一次模型,对 100 万篇文档做 rerank 是不可能的。

所以标准做法是两阶段:先用便宜的方法(向量 + BM25)从全部文档里粗筛出 20–50 个候选,再用贵的 rerank 模型精排,取前 3–5 个给大模型。这和电商搜索、推荐系统的「召回 → 排序」是同一个思路,做过推荐的同学会很熟悉。

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="两阶段检索:向量和BM25粗召回几十个候选,rerank模型精排出前几个">
<rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="70" width="100" height="60" rx="4" fill="none" stroke="var(--compute)"/>
<text x="70" y="96" fill="var(--ink)" text-anchor="middle">全部块</text>
<text x="70" y="114" fill="var(--ink-faint)" text-anchor="middle" font-size="11">几万~几百万</text>
<rect x="160" y="40" width="130" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="225" y="64" fill="var(--ink)" text-anchor="middle">向量 top-20</text>
<rect x="160" y="120" width="130" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="225" y="144" fill="var(--ink)" text-anchor="middle">BM25 top-20</text>
<rect x="320" y="80" width="90" height="40" rx="4" fill="none" stroke="var(--ink-soft)"/>
<text x="365" y="104" fill="var(--ink)" text-anchor="middle">RRF ~30</text>
<rect x="440" y="80" width="90" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="485" y="104" fill="var(--ink)" text-anchor="middle">rerank</text>
<rect x="560" y="80" width="64" height="40" rx="4" fill="none" stroke="var(--ink)"/>
<text x="592" y="104" fill="var(--ink)" text-anchor="middle">top-4</text>
<line x1="120" y1="90" x2="160" y2="62" stroke="var(--ink-faint)"/>
<line x1="120" y1="110" x2="160" y2="140" stroke="var(--ink-faint)"/>
<line x1="290" y1="60" x2="320" y2="95" stroke="var(--ink-faint)"/>
<line x1="290" y1="140" x2="320" y2="105" stroke="var(--ink-faint)"/>
<line x1="410" y1="100" x2="440" y2="100" stroke="var(--ink-faint)"/>
<line x1="530" y1="100" x2="560" y2="100" stroke="var(--ink-faint)"/>
<text x="160" y="190" fill="var(--ink-soft)" font-size="11">召回:便宜、快,要「找得全」</text>
<text x="420" y="190" fill="var(--ink-soft)" font-size="11">精排:贵、慢,要「排得准」</text>
</g>
</svg>
<figcaption>两阶段检索。召回阶段宁可多拿,精排阶段只对几十个候选跑 cross-encoder。</figcaption>
</figure>

我们用的 rerank 模型是 `BAAI/bge-reranker-v2-m3`,和 bge-m3 同一家,中文好。2026-10-12 我查到硅基流动上它的标准版是免费的。API 不是 OpenAI 协议(OpenAI 没有 rerank 接口),而是 Cohere 风格的 `/rerank`,请求体是 `model`、`query`、`documents`、`top_n`,返回 `results` 列表,每项有 `index`(对应你传入的第几篇)和 `relevance_score`。格式以[硅基流动 rerank 文档](https://docs.siliconflow.com/en/api-reference/rerank/create-rerank)为准。

```bash
# agent-60-lab/.env  新增(不填就沿用 EMB_* 那组)
RERANK_BASE_URL=https://api.siliconflow.cn/v1
RERANK_API_KEY=sk-xxxx
RERANK_MODEL=BAAI/bge-reranker-v2-m3
```

```python
# agent-60-lab/w3/rerank.py
"""调 /rerank 接口(Cohere 风格,硅基流动、Jina、Cohere 等都兼容这个形状)。"""
import os

import httpx
from dotenv import load_dotenv

load_dotenv()
BASE = os.environ.get("RERANK_BASE_URL", os.environ["EMB_BASE_URL"]).rstrip("/")
KEY = os.environ.get("RERANK_API_KEY", os.environ["EMB_API_KEY"])
MODEL = os.environ.get("RERANK_MODEL", "BAAI/bge-reranker-v2-m3")


def rerank(query: str, documents: list[str], top_n: int = 4) -> list[tuple[int, float]]:
    """返回 [(原列表下标, 相关性分数), ...],按分数从高到低。"""
    if not documents:
        return []
    resp = httpx.post(
        f"{BASE}/rerank",
        headers={"Authorization": f"Bearer {KEY}"},
        json={"model": MODEL, "query": query, "documents": documents,
              "top_n": min(top_n, len(documents)), "return_documents": False},
        timeout=30,
    )
    resp.raise_for_status()
    results = resp.json()["results"]
    return [(r["index"], float(r["relevance_score"])) for r in results]


if __name__ == "__main__":
    docs = [
        "错误码 E1042:银行流水导入失败。列名和模板不匹配,或者日期格式不是 YYYY-MM-DD。",
        "错误码 E1043:文件编码错误。文件不是 UTF-8 编码,Excel 另存 CSV 默认是 GBK。",
        "导入银行流水:支持 CSV 和 XLSX,单个文件不超过 10 MB。",
    ]
    for i, s in rerank("导入的时候报 E1043 怎么办", docs, top_n=3):
        print(f"{s:.3f}  {docs[i][:20]}")
```

```bash
uv add httpx
uv run python w3/rerank.py
```

你应该看到 E1043 那条排第一,而且分数和第二名拉开明显的差距。我实测的输出:

```text
0.895  错误码 E1043:文件编码错误。文件不
0.038  错误码 E1042:银行流水导入失败。列
0.017  导入银行流水:支持 CSV 和 XLSX
```

embedding 眼里这两篇很像,rerank 直接拉开到 0.895 对 0.038。这就是 cross-encoder「逐字对照」的效果。rerank 分数的另一个用处是做「不相关」判断:如果精排后的最高分都很低,说明知识库里大概率没有答案,可以直接走「转人工」,不用浪费一次大模型调用。阈值同样要在 Day 19 的评估集上定。

rerank 的代价要心里有数。每次查询多一次网络调用,对 20–30 个候选打分,通常增加几十到几百毫秒延迟。如果自己部署 bge-reranker,需要 GPU 才快。客服这种场景,多 200 毫秒换准确率,非常值。

## Query 改写:用户的问题往往不适合直接搜

用户的问题经常是这样的:

- 「那年付的呢?」(依赖上一轮对话,单独拿出来没法搜)
- 「我上周买的那个东西能退不」(口语,关键信息「年付/月付」「专业版/企业版」都没说)
- 「发票开错了,还有导入流水一直报错,怎么弄」(一句话两个问题)

直接拿这些去检索,效果都不好。query 改写就是在检索之前,让大模型把问题处理一下。常见的三种:

补全为独立问题。 结合对话历史,把「那年付的呢?」改写成「年付套餐能不能退款」。多轮对话的 RAG 几乎必做。

多路查询(multi-query)。 让模型从不同角度生成 2–3 个查询,比如「退款政策」「申请退款步骤」「已开发票如何退款」,每个都去检索,结果用 RRF 融合。适合一句话里包含多个问题,或者问题很模糊的情况。

HyDE(Hypothetical Document Embeddings)。 先让模型「假装」写一段答案,用这段假答案去做向量检索。原理是假答案的措辞更像文档,和真文档在向量空间里更近。它来自 2022 年的论文 [Precise Zero-Shot Dense Retrieval without Relevance Labels](https://arxiv.org/abs/2212.10496)。我在实际项目里用得不多,因为它多一次生成调用、增加延迟,而且假答案里编造的细节有时会把检索带偏。知道这个名字,面试能讲出原理和缺点就够了。

```python
# agent-60-lab/w3/rewrite.py
"""用大模型改写查询:补全上下文,拆成 1–3 个适合检索的短查询。"""
import json

from llm import chat

PROMPT = """你负责把用户发给 CloudLedger 客服的话,改写成适合在帮助中心里检索的查询。
要求:
- 结合对话历史补全省略的信息(例如「那年付的呢」要补成完整问题)。
- 如果一句话里有多个问题,拆开,每个问题一条查询。
- 每条查询是简短的陈述或问题,使用帮助中心的说法(例如用「退款」而不是「把钱要回来」)。
- 最多 3 条。只输出 JSON:{"queries": ["...", "..."]}"""


def rewrite(question: str, history: list[dict] | None = None) -> list[str]:
    history_text = "\n".join(f'{m["role"]}: {m["content"]}' for m in (history or [])[-6:])
    user = f"对话历史:\n{history_text or '(无)'}\n\n用户最新的话:{question}"
    raw = chat(
        [{"role": "system", "content": PROMPT}, {"role": "user", "content": user}],
        temperature=0,
        response_format={"type": "json_object"},
    )
    try:
        queries = json.loads(raw).get("queries", [])
        return [q for q in queries if isinstance(q, str) and q.strip()][:3] or [question]
    except json.JSONDecodeError:
        return [question]  # 改写失败就用原问题,检索不能因为改写挂掉


if __name__ == "__main__":
    print(rewrite("发票开错了,还有导入流水一直报 E1043,怎么弄"))
    history = [{"role": "user", "content": "月付的能退款吗"},
               {"role": "assistant", "content": "月付套餐不支持退款……"}]
    print(rewrite("那年付的呢", history))
```

这里用了 Day 6 的 JSON mode(`response_format={"type": "json_object"}`)。DeepSeek 和大部分 OpenAI 兼容服务都支持,如果你用的服务不支持,去掉这个参数,靠 prompt 约束加 `try/except` 兜底。注意兜底逻辑:改写失败就用原问题。检索链路上的任何增强步骤失败了,都应该降级,而不是让整个请求报错。

我用 deepseek-flash 实测的输出(每次措辞会略有不同):

```text
['发票开错了怎么处理', '导入流水报错 E1043 怎么解决']
['年付套餐是否支持退款']
```

改写不是免费的:多一次大模型调用,增加几百毫秒到一两秒的延迟,也多花钱。我的做法是:多轮对话里只要有历史就改写;单轮问题先不改写,等评估数据证明有收益再开。另外改写有时会「改坏」,比如把用户说的「E1043」改成了「编码错误」,错误码丢了,BM25 反而找不到了。所以多路查询里保留原问题作为其中一路,下面的代码就是这么做的。

## 把它们串成一条流水线

```python
# agent-60-lab/w3/retrieve.py
"""完整检索流水线:(改写) → 向量 + BM25 多路召回 → RRF → (rerank) → top-k。"""
from bm25_index import BM25Index
from chunking import Chunk, load_chunks
from embed import embed_one
from fusion import rrf
from pg_store import connect
from pg_store import search as pg_search
from rerank import rerank
from rewrite import rewrite

CHUNKS: dict[str, Chunk] = {c.id: c for c in load_chunks()}
BM25 = BM25Index(list(CHUNKS.values()))
CONN = connect()


def vector_ids(query: str, pool: int) -> list[str]:
    return [h["id"] for h in pg_search(CONN, embed_one(query), k=pool)]


def bm25_ids(query: str, pool: int) -> list[str]:
    return [cid for cid, _ in BM25.search(query, pool)]


def retrieve(question: str, k: int = 4, mode: str = "hybrid+rerank",
             history: list[dict] | None = None, use_rewrite: bool = False,
             pool: int = 20) -> list[tuple[Chunk, float]]:
    queries = [question]
    if use_rewrite:
        queries += [q for q in rewrite(question, history) if q != question]

    if mode == "vector":
        return [(CHUNKS[c], 0.0) for c in vector_ids(question, k)]
    if mode == "bm25":
        return [(CHUNKS[c], s) for c, s in BM25.search(question, k)]

    rankings = []
    for q in queries:
        rankings.append(vector_ids(q, pool))
        rankings.append(bm25_ids(q, pool))
    fused = rrf(rankings)[:pool]

    if mode == "hybrid":
        return [(CHUNKS[c], s) for c, s in fused[:k]]

    candidates = [CHUNKS[c] for c, _ in fused]
    ranked = rerank(question, [c.text for c in candidates], top_n=k)
    return [(candidates[i], s) for i, s in ranked]
```

注意 rerank 用的是原问题而不是改写后的查询。改写是为了召回得更全,但判断「这块资料能不能回答用户」时,应该对照用户的原话。

再写一个对比脚本,把四种模式并排打出来:

```python
# agent-60-lab/w3/compare_retrieval.py
from retrieve import retrieve

CASES = [
    ("导入的时候报 E1043", "kb-011"),
    ("E1042 是什么意思", "kb-010"),
    ("买错了能把钱要回来吗", "kb-002"),
    ("这个月被重复扣了两次钱", "kb-002"),
    ("发票抬头写错了", "kb-007"),
    ("API 调用返回 429", "kb-019"),
]

MODES = ["vector", "bm25", "hybrid", "hybrid+rerank"]

if __name__ == "__main__":
    hits = {m: 0 for m in MODES}
    for q, expect in CASES:
        row = []
        for m in MODES:
            top = retrieve(q, k=1, mode=m)
            got = top[0][0].doc_id if top else "-"
            hits[m] += got == expect
            row.append(f"{m}:{got}{'✓' if got == expect else '✗'}")
        print(f"{q:<16} 期望 {expect}  " + "  ".join(row))
    print("top-1 命中:", hits)
```

跑出来后把结果填进这张表(我不替你填,因为结果取决于你用的 embedding 模型):

| 问题 | 期望 | 纯向量 | 纯 BM25 | 混合 | 混合+rerank |
| --- | --- | --- | --- | --- | --- |
| 导入的时候报 E1043 | kb-011 |  |  |  |  |
| E1042 是什么意思 | kb-010 |  |  |  |  |
| 买错了能把钱要回来吗 | kb-002 |  |  |  |  |
| 这个月被重复扣了两次钱 | kb-002 |  |  |  |  |
| 发票抬头写错了 | kb-007 |  |  |  |  |
| API 调用返回 429 | kb-019 |  |  |  |  |

跑一次要调 18 次 embedding、6 次 rerank,大约 8 秒,费用可以忽略。

我预期的规律是:纯 BM25 在错误码类问题上稳,在「把钱要回来」这种口语问题上容易失手;纯向量反过来;混合两类都不差;rerank 让排序再稳一点。如果你的结果和预期不一致,那就更有意思了,去看具体哪一块排在了前面、为什么。6 个问题太少,说明不了统计意义,这正是明天要建 30 条评估集的原因。

<details><summary>我的实测结果(bge-m3 + bge-reranker-v2-m3,自己跑完再看)</summary>

```text
导入的时候报 E1043   期望 kb-011  vector:kb-011✓  bm25:kb-011✓  hybrid:kb-011✓  hybrid+rerank:kb-011✓
E1042 是什么意思     期望 kb-010  vector:kb-010✓  bm25:kb-010✓  hybrid:kb-010✓  hybrid+rerank:kb-010✓
买错了能把钱要回来吗  期望 kb-002  vector:kb-002✓  bm25:-✗       hybrid:kb-002✓  hybrid+rerank:kb-003✗
这个月被重复扣了两次钱 期望 kb-002  vector:kb-002✓  bm25:kb-002✓  hybrid:kb-002✓  hybrid+rerank:kb-002✓
发票抬头写错了       期望 kb-007  vector:kb-007✓  bm25:kb-007✓  hybrid:kb-007✓  hybrid+rerank:kb-007✓
API 调用返回 429    期望 kb-019  vector:kb-019✓  bm25:kb-019✓  hybrid:kb-019✓  hybrid+rerank:kb-019✓
top-1 命中: {'vector': 6, 'bm25': 5, 'hybrid': 6, 'hybrid+rerank': 5}
```

和「预期规律」不完全一样,有三点值得说:

纯向量 6 题全对。 我们的帮助中心只有 20 篇、42 块,每篇主题差别很大,bge-m3 在这么小的库上几乎不会错。E1042/E1043 这种「近亲」它也分开了,因为块里除了错误码还有「编码」「日期格式」这些区别明显的词。向量检索的短板要在几千篇、主题互相重叠的库上才会明显暴露。

纯 BM25 栽在「把钱要回来」上,返回 `-`。 分词后是「买错」「钱」「要回来」,没有一个词出现在任何文档里,所有块得分都是 0,一个结果都没有。这正是上面说的 BM25 短板。另外如果你的停用词表里没加「时候」,第一题 BM25 也会错(见 BM25 那一节)。

rerank 把「买错了能把钱要回来吗」排成了 kb-003《如何申请退款》,标成了 ✗。 但你读一下这个问题,用户想把钱要回来,《如何申请退款》其实也是对的答案,甚至比《退款政策》更直接。这不是 rerank 错了,是我的标注只写了一个「正确答案」。真实的评估集里,一个问题经常有多篇相关文档,标注要允许多个答案。这也是明天建评估集时要处理的问题。

</details>

## Contextual Retrieval:把上下文写进每一块

最后介绍一个 2024 年很有影响的做法。Day 16 我们在每块前面加了「文章标题 > 小节标题」,Anthropic 把这个思路推进了一大步,叫 [Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval):在建索引时,对每一块,把整篇文档和这一块一起交给大模型,让它写一两句话说明「这一块在整篇文档里讲的是什么」,通常 50 到 100 个 token,然后把这句说明加在块的前面,再去做 embedding 和 BM25。

他们的实验结果(在代码库、小说、论文等多个数据集上,指标是 top-20 检索失败率):只做 contextual embedding,失败率下降 35%(5.7% → 3.7%);加上 contextual BM25,下降 49%;再加 rerank,下降 67%。成本方面,他们算出借助 prompt caching,生成这些上下文的一次性成本大约是每百万文档 token 1.02 美元。

这个方法的本质和我们加标题前缀一样:让每一块「自带上下文」。区别是让大模型来写上下文,比机械地拼标题更聪明,能写出「这一段讲的是年付套餐中途取消时按剩余整月退款的规则」这样的话。代价是建索引时每块多一次大模型调用。对我们 42 块的帮助中心,花不了几分钱,你可以作为练习 4 试试。

## 上游:文档解析(PDF、表格、扫描件)

前面所有的检索技巧,都默认了一个前提:文档已经是干净的文字。CloudLedger 的帮助中心是我们自己造的 Markdown,当然干净。真实项目里几乎从来不是这样。客户给你的知识库,往往是一堆 PDF 格式的产品手册和合同、Excel 价格表、Word 制度文件、扫描的发票和盖章文件,还有截图。国内 Agent 岗的 JD 里,「文档解析」「多格式文档处理」「表格和扫描件」出现得很频繁,原因就在这里:**解析质量是检索质量的上游,解析错了,后面的 embedding、BM25、rerank 都是在垃圾上做功**。

先分清 PDF 的三种情况,处理方法完全不同:

- 文字型 PDF:由 Word 或网页导出,里面有文字层,能直接抽出文字。大部分产品手册是这种。
- 扫描型 PDF:每一页其实是一张图片,没有文字层,抽文字得到空字符串。盖章合同、纸质档案、手机拍的单据都是这种。必须 OCR(光学字符识别)。
- 混合型:大部分页有文字层,夹着几页扫描的附件。要逐页判断。

判断方法很简单:逐页抽文字,抽出来是空的(而且页面上也没有表格),就当作扫描页走 OCR。

文字型 PDF 也有一堆坑,我按踩到的频率排:

表格被抽成散乱的文字。 一张四列的价格表,直接抽文字会变成「专业版 49 468 5」这样一行数字,哪个数是月付、哪个是年付,模型只能猜。表格要单独识别出来,转成 Markdown 表格保留结构。

页眉页脚每页重复。 「CloudLedger 产品手册 v3.2 第 7 页」在每一页都出现,切块后几十个块里都有这句话,BM25 和向量检索都会被它干扰。解析后要识别并去掉每页重复出现的行。

多栏排版的阅读顺序错乱。 双栏的论文或宣传册,按坐标从上到下抽,左栏第一行后面接着右栏第一行,语句全被打乱。需要版面分析(layout analysis)先识别出栏,再按栏的顺序读。

图片和图表里的信息。 流程图、截图里的文字,纯文本抽取拿不到。要么 OCR,要么用多模态模型给图片写一段描述。

下面是一个够用的最小版本:用 pdfplumber 逐页抽正文,识别有边框的表格转成 Markdown,没有文字层的页面渲染成图片交给 RapidOCR。RapidOCR 是基于 PaddleOCR 模型的轻量封装,中文识别不错,CPU 就能跑。

```python
# agent-60-lab/w3/doc_parse.py
"""把 PDF 解析成适合切块的 Markdown:正文按页提取,表格转成 Markdown 表格,没有文字层的扫描页走 OCR。

依赖:uv add pdfplumber
OCR(可选):uv add rapidocr onnxruntime   第一次运行会下载模型
"""
import sys
from pathlib import Path

import pdfplumber


def table_to_markdown(rows: list[list[str | None]]) -> str:
    # 换个变量名:rows 声明的是 str | None,洗成 str 后放进新变量,否则 join 会报类型红线
    clean = [[(c or "").replace("\n", " ").strip() for c in row] for row in rows if row and any(row)]
    if len(clean) < 2:
        return ""
    header, body = clean[0], clean[1:]
    lines = ["| " + " | ".join(header) + " |", "|" + " --- |" * len(header)]
    lines += ["| " + " | ".join(r + [""] * (len(header) - len(r))) + " |" for r in body]
    return "\n".join(lines)


_ocr_engine = None  # 模型加载慢,全局只建一次


def ocr_page(page) -> str:
    """扫描件:把这一页渲染成图片再 OCR。没装 rapidocr 就返回提示文字。"""
    global _ocr_engine
    try:
        import numpy as np
        from rapidocr import RapidOCR  # 没装时编辑器会标黄/红,正常
    except ImportError:
        return "(这一页是扫描图片,没有文字层;安装 rapidocr 后可 OCR)"
    if _ocr_engine is None:
        _ocr_engine = RapidOCR()
    img = page.to_image(resolution=200).original  # PIL 图片
    result = _ocr_engine(np.array(img))
    return "\n".join(result.txts or [])


def parse_pdf(path: Path, title: str | None = None) -> str:
    parts = [f"# {title or path.stem}"]
    with pdfplumber.open(path) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            tables = page.find_tables()
            # 正文里去掉落在表格区域内的字符,避免表格内容被当成散乱的句子再出现一遍
            boxes = [t.bbox for t in tables]

            def outside_tables(obj, boxes=boxes) -> bool:
                if "x0" not in obj:
                    return True
                x, y = (obj["x0"] + obj["x1"]) / 2, (obj["top"] + obj["bottom"]) / 2
                return not any(x0 <= x <= x1 and top <= y <= bottom for x0, top, x1, bottom in boxes)

            text = (page.filter(outside_tables).extract_text() or "").strip()
            if not text and not tables:
                text = ocr_page(page)
            parts.append(f"## 第 {i} 页\n{text}")
            for n, t in enumerate(tables, start=1):
                md = table_to_markdown(t.extract())
                if md:
                    parts.append(f"### 第 {i} 页 表 {n}\n{md}")
    return "\n\n".join(parts)


def table_rows_to_chunks(table_title: str, rows: list[list[str | None]]) -> list[str]:
    """大表格按行切块,每一块都带上表名和表头,单独检索到一行时也看得懂。"""
    clean = [[(c or "").strip() for c in row] for row in rows if row and any(row)]
    header, body = clean[0], clean[1:]
    return [f"{table_title}:" + ";".join(f"{h}={v}" for h, v in zip(header, row) if v) for row in body]


if __name__ == "__main__":
    print(parse_pdf(Path(sys.argv[1])))
```

我用 reportlab 生成了一个带表格的两页测试 PDF,跑出来是这样的(英文内容是因为生成 PDF 时没配中文字体,解析逻辑和中文一样):

```text
# price

## 第 1 页
CloudLedger plans. Annual plans can be refunded within 14 days.

### 第 1 页 表 1
| Plan | Monthly | Annual | Ledgers |
| --- | --- | --- | --- |
| Free | 0 | 0 | 1 |
| Pro | 49 | 468 | 5 |
| Enterprise | 199 | 1908 | unlimited |

## 第 2 页
Second page text about invoices.
```

调这段代码时我踩了两个坑,都值得记下来。第一个:最开始我用 `page.outside_bbox(表格范围)` 去掉表格区域的文字,结果表格上方那一行正文被截成了「CloudLedger plans. Annua」,后半截不见了。原因是这个裁剪方法会把和表格范围有交叠的字符一起裁掉。改成按每个字符的中心点判断是否落在表格内,才正确。第二个:同一张表如果没有画边框线,pdfplumber 默认的表格识别(按线条找表格)根本识别不出来,整张表会被当成普通文字抽出来,又变回「Pro 49 468 5」。真实文档里无框表格非常多,这时候要么调 pdfplumber 的 `table_settings` 改成按文字对齐识别(容易误判),要么换下面说的版面分析工具。

表格怎么切块。 小表格整张作为一块就行。大表格(几十上百行的价格表、对照表)整张放一块,向量会被稀释;按行切又会丢掉表头,单独检索到「专业版 49 468 5」也看不懂。我的做法是按行切,每一块都带上表名和表头,也就是上面 `doc_parse.py` 里的这个函数:

```python
def table_rows_to_chunks(table_title: str, rows: list[list[str | None]]) -> list[str]:
    """大表格按行切块,每一块都带上表名和表头,单独检索到一行时也看得懂。"""
    clean = [[(c or "").strip() for c in row] for row in rows if row and any(row)]
    header, body = clean[0], clean[1:]
    return [f"{table_title}:" + ";".join(f"{h}={v}" for h, v in zip(header, row) if v) for row in body]
```

```text
CloudLedger 套餐价格表:套餐=免费版;月付(元)=0;年付(元)=0;账本数=1
CloudLedger 套餐价格表:套餐=专业版;月付(元)=49;年付(元)=468;账本数=5
CloudLedger 套餐价格表:套餐=企业版;月付(元)=199;年付(元)=1908;账本数=不限
```

这和 Day 16「块前加标题」、Contextual Retrieval 是同一个思想:每一块都要自带足够的上下文。用户问「专业版年付多少钱」,BM25 能精确命中「专业版」「年付」,向量也能匹配上,模型读到这一块也不会搞错是哪一列。如果表格的问题主要是「筛选和计算」(比如「哪些套餐年付低于 1000 元」),那就不该走 RAG,而是把表格导进数据库,做成 SQL 查询工具,这是 W4 的内容。

工具怎么选。 手写的 pdfplumber 版本适合格式规整的文字型 PDF。复杂文档建议直接用成熟的解析工具,我按自己的使用印象整理了一下,具体能力以各项目的文档为准:

| 工具 | 类型 | 适合 |
| --- | --- | --- |
| pdfplumber / PyMuPDF | PDF 文字和表格抽取库 | 格式规整的文字型 PDF,速度快,可控 |
| RapidOCR / PaddleOCR | OCR | 扫描件、图片;中文效果好 |
| MinerU(上海人工智能实验室 OpenDataLab) | 版面分析 + OCR + 表格/公式识别,输出 Markdown | 中文复杂文档、论文、多栏、扫描件 |
| Docling(IBM 开源) | 多格式解析(PDF、Word、PPT、HTML),输出结构化文档 | 多格式混合的企业知识库 |
| Unstructured | 多格式解析和按元素切分 | 已经在用 LangChain/LlamaIndex 生态时 |
| 多模态大模型 | 把页面截图直接交给视觉模型转 Markdown | 极复杂的表格和版式;贵,慢,要抽查 |

我的习惯是:先用最简单的工具跑一遍,抽 20 页人工检查解析结果,尤其是表格和扫描页;哪类页面解析得差,再针对性地换工具。解析结果要和评估集联动,比如评估集里专门加几条「答案在表格里」的问题,解析方式改了就重跑一次检索评估。

## 动手练习

1. 跑 `bm25_index.py`,把输出和上面我贴的对一下。然后去掉自定义词典那几行,再跑一次,看「企业版年付中途取消能退多少」的分词和检索结果有什么变化。
2. 跑 `rerank.py`,确认 E1043 排第一。把查询换成「导入报 E1042」再跑,看排序是否跟着变。
3. 跑 `compare_retrieval.py`,填完上面的对比表。挑一个混合检索也排错的问题,用 `retrieve(q, k=5, mode="hybrid")` 看前 5 名,分析原因。
4. (选做)实现简化版 contextual retrieval:改 `chunking.py`,对每一块调用一次大模型,输入整篇文章和这一块,让它写一句不超过 50 字的上下文说明,拼在块前面;重建 pgvector 和 BM25 索引,再跑一遍对比表。
5. 用 `rewrite.py` 试三个多轮对话的例子,至少找到一个「改写改坏了」的情况(比如丢了错误码),想想 prompt 怎么改。
6. 找一份真实的 PDF(产品说明书、带表格的报价单都行,注意别用含个人信息的文件),用 `doc_parse.py` 解析,人工检查表格和正文的解析质量。再找一张手机拍的文档照片转成 PDF,装上 rapidocr 试试 OCR。如果有时间,用 MinerU 或 Docling 解析同一份文件,对比效果。

**验收标准:** 对比表填完,并能用一两句话解释每一列的规律;`retrieve()` 的四种模式都能跑;能不看资料讲清楚 BM25、RRF、cross-encoder 三者各自解决什么问题。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 稀疏检索 / 关键词检索 | 按词匹配打分,BM25 是代表;向量里大部分维度是 0,所以叫稀疏 |
| 稠密检索 / 向量检索 | 用 embedding 向量的相似度检索 |
| BM25 | 经典的关键词相关性打分算法,考虑词频、逆文档频率和文档长度 |
| IDF | 逆文档频率,一个词越少见权重越高 |
| jieba | 最常用的 Python 中文分词库,支持自定义词典 |
| 混合检索(hybrid search) | 同时做向量检索和关键词检索,再融合结果 |
| RRF | 倒数排名融合,按名次而不是分数融合多路结果 |
| bi-encoder | 问题和文档分别编码再比较,embedding 模型属于这类 |
| cross-encoder | 问题和文档一起送进模型直接打分,rerank 模型属于这类 |
| rerank(重排序) | 用 cross-encoder 对召回的候选重新排序 |
| query 改写 | 检索前用大模型把问题改成更适合检索的形式 |
| multi-query | 生成多个查询分别检索再融合 |
| HyDE | 用模型生成的假设答案去做向量检索 |
| Contextual Retrieval | Anthropic 提出的方法,用大模型给每块生成上下文说明再建索引 |
| 文字层 | PDF 里可以直接抽取的文字;扫描件没有文字层 |
| OCR | 光学字符识别,从图片里识别文字 |
| 版面分析(layout analysis) | 识别页面上的标题、段落、栏、表格、图片区域和阅读顺序 |

## 常见误区

**把余弦相似度和 BM25 分数直接相加。** 两者量纲不同、分布随查询变化,直接加等于随机加权。用 RRF,或者至少做归一化并在评估集上调权重。

**中文直接按字切做 BM25。** 按单字切,「退款」和「退出」都有「退」,噪音很大;按 jieba 默认切,业务词会切错。加业务词典是必须的。

**对全部文档做 rerank。** cross-encoder 不能预先算,对每个候选都要跑一次模型。只对召回的几十个候选做。

**改写后丢掉原问题。** 改写可能丢失关键信息(错误码、订单号)。多路查询里保留原问题作为一路,rerank 也用原问题。

**以为加了 rerank 就能救回召回阶段漏掉的文档。** rerank 只能重新排序它拿到的候选。正确答案没进 top-20,rerank 再强也没用。召回要宽,精排要准,两件事分开优化。

**把 PDF 直接抽成纯文本就入库。** 表格变成散乱的数字,页眉页脚重复几十遍,扫描页是空的。入库前至少人工抽查一部分解析结果。

**大表格按行切块却不带表头。** 检索到一行「专业版 49 468 5」,模型不知道哪个数是什么。每一块都要带表名和表头。

**每加一个技巧都凭感觉判断好坏。** 6 个问题的对比只是演示。真正的判断要靠评估集上的数字,这是明天的事。

## 学习资料

### 文档与文章

- [Anthropic · Introducing Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval):今天最后一节的出处,把实验部分和成本计算读完,40 分钟。里面还附了一份 cookbook,演示了 BM25 + 向量 + rerank 的完整实现。
- [Okapi BM25(维基百科)](https://en.wikipedia.org/wiki/Okapi_BM25):公式和参数的权威解释,10 分钟。
- [Pinecone · Rerankers and Two-Stage Retrieval](https://www.pinecone.io/learn/series/rag/rerankers/):bi-encoder 和 cross-encoder 的区别讲得很清楚,配图好。
- [Elasticsearch · Reciprocal rank fusion](https://www.elastic.co/guide/en/elasticsearch/reference/current/rrf.html):生产级搜索引擎里 RRF 的用法和参数,看看工业界怎么用。
- [Sentence Transformers · Cross-Encoders](https://www.sbert.net/examples/cross_encoder/applications/README.html):想自己本地跑 rerank 模型时看这里。
- [HyDE 论文](https://arxiv.org/abs/2212.10496):读摘要和图 1。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1SafMYFE9j&autoplay=0&high_quality=1" title="RAG 效果不理想 ? “混合搜索” 来帮忙" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Jim大表哥2025 · RAG 效果不理想 ? “混合搜索” 来帮忙 · 6 分钟,快速建立混合检索的直觉。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1r1421R77Y&autoplay=0&high_quality=1" title="ReRank与Embedding模型的区别? 如何选择ReRank模型?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI开发者-就爱瞎鼓捣 · ReRank与Embedding模型的区别? 如何选择ReRank模型? · 8 分钟,对应今天 rerank 那一节,讲了 bge-reranker 等模型的选择。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/XvKiTfd6Xvo" title="The Complete Guide to Hybrid Search in RAG (BM25 + Embeddings + Reranker)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Dave Ebbelaar · The Complete Guide to Hybrid Search in RAG (BM25 + Embeddings + Reranker) · 1 小时,和今天的内容几乎一一对应,用的是英文数据。先看前 20 分钟的原理部分。</figcaption>
</figure>

- Prompt Engineering 频道《The Best RAG Technique Yet? Anthropic's Contextual Retrieval Explained!》(YouTube ID `tmiBae2goJM`,16 分钟):Contextual Retrieval 的讲解。
- Tejas Kumar《BM25 Algorithm and Hybrid Search: AI Explained》(YouTube ID `lD3_VF5bmWg`,10 分钟):BM25 公式的直观讲解。

### 书籍

- Christopher Manning 等《Introduction to Information Retrieval》(剑桥大学出版社,2008),[作者提供免费在线版](https://nlp.stanford.edu/IR-book/)。第 6 章(打分、TF-IDF)和第 11 章(概率模型,BM25 的来历)。信息检索的经典教材,想打牢基础时读,4–6 小时。
- Chip Huyen《AI Engineering》第 6 章检索优化部分,讲了混合检索、rerank、query 改写的取舍。

### 开源项目与代码

- [fxsjy/jieba](https://github.com/fxsjy/jieba):自定义词典、调整词频的用法都在 README 里。
- [dorianbrown/rank_bm25](https://github.com/dorianbrown/rank_bm25):今天用的 BM25 实现,代码只有几百行,值得读一遍。
- [BAAI/bge-reranker-v2-m3](https://huggingface.co/BAAI/bge-reranker-v2-m3):模型卡,有本地运行的示例代码。
- [jsvine/pdfplumber](https://github.com/jsvine/pdfplumber):今天文档解析用的库,README 里表格识别的 `table_settings` 参数值得细看。
- [RapidAI/RapidOCR](https://github.com/RapidAI/RapidOCR) 和 [PaddlePaddle/PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR):中文 OCR。
- [opendatalab/MinerU](https://github.com/opendatalab/MinerU)、[docling-project/docling](https://github.com/docling-project/docling)、[Unstructured-IO/unstructured](https://github.com/Unstructured-IO/unstructured):成熟的文档解析工具,复杂文档直接用它们。
- [langchain-ai/rag-from-scratch](https://github.com/langchain-ai/rag-from-scratch):LangChain 的 RAG 从零系列 notebook,multi-query、HyDE、RAG-Fusion 都有实现,可以对照看框架版写法。

## 自测

**1. 手算 RRF(k=60):向量检索结果 [A, B, C],BM25 结果 [C, D]。融合后的排名是什么?**

<details><summary>答案</summary>

A = 1/61 ≈ 0.01639;B = 1/62 ≈ 0.01613;C = 1/63 + 1/61 ≈ 0.01587 + 0.01639 = 0.03226;D = 1/62 ≈ 0.01613。排名:C > A > B = D(B 和 D 分数相同,顺序取决于实现)。C 在两路里都出现,排第一。

</details>

**2. 为什么 BM25 对错误码 E1043 特别敏感?**

<details><summary>答案</summary>

E1043 只出现在极少数文档里,IDF 很高,一旦查询和文档都包含它,这个词的贡献就很大。BM25 是精确词匹配,E1042 和 E1043 是两个完全不同的词,不会混淆。embedding 则把它们都看作「一个错误码」,向量很接近。

</details>

**3. bi-encoder 和 cross-encoder 的根本区别是什么?为什么不能只用 cross-encoder?**

<details><summary>答案</summary>

bi-encoder 把问题和文档分别编码成向量,文档向量可以提前算好,检索快;cross-encoder 把问题和文档拼在一起送进模型直接打分,更准,但每个(问题, 文档)对都要实时跑一次模型,无法预先计算,对大量文档不可行。所以用 bi-encoder(加 BM25)召回几十个,再用 cross-encoder 精排。

</details>

**4. 你在多路查询里把原问题去掉了,只用改写后的查询,可能出什么问题?**

<details><summary>答案</summary>

改写可能丢失或改变关键信息,比如把「E1043」改成「文件编码错误」,BM25 就失去了最强的匹配信号;或者改写理解错了用户意图。保留原问题作为一路,改写只用来补充召回,是更稳的做法。

</details>

**5. jieba 把「企业版年付」切成了「企业 / 版年付」,对检索有什么影响?怎么修?**

<details><summary>答案</summary>

查询和文档里的「企业版」「年付」都无法作为完整的词匹配,BM25 的匹配信号变弱,甚至匹配到错误的词。修法是用 `jieba.add_word` 或词典文件加入业务术语;并且要保证建索引和查询时用同一套分词配置,否则两边切法不一致,照样匹配不上。

</details>

**6.(面试题)你的 RAG 系统召回率不错,但 top-1 经常不是最相关的那块,导致回答不准。你有哪些手段?怎么验证有效?**

<details><summary>答案</summary>

手段:加 rerank(cross-encoder)做精排,这是最直接的;改进切块,让每块主题更集中、自带上下文(标题前缀、contextual retrieval);混合检索里调整各路权重或候选池大小;对特定类型的查询(错误码、编号)做规则路由,直接走关键词检索。验证:建带标注的检索评估集,对比改动前后的 MRR、hit@1、recall@k,同时看延迟和成本的变化,并做分类型分析(比如错误码类问题和口语类问题分别统计),避免整体分数掩盖局部退化。

</details>

## 明天预告

Day 19 · RAG 怎么评估:召回率、MRR、忠实度,建第一份检索测试集。今天的对比表只有 6 个问题,结论全凭感觉。明天建一份 30 条的评估集(含答案所在的文档、还有几条「知识库里没有」的问题),写脚本算 recall@k 和 MRR,再用大模型当裁判检查回答是否忠于资料。然后用它回答几个今天悬而未决的问题:切块该多大、k 该取几、rerank 到底值不值。
