---
title: 'Day 253 · GraphRAG(二):local search 和混合检索比一比'
description: '拿昨天模型抽出来的 89 条边第一次回答问题:让模型从实体列表里挑出种子,用 networkx 沿边走两步,把边和原文证据交给模型。枚举题答得好;E4029 那题因为图断开答成了专业版的价格,退款题因为 351 元没进图说「帮助中心没写」。再和 Day 240 的混合检索比找文章,图 6/9,混合检索 8/9。'
pubDate: 2026-10-22
regime: none
tags: ['graphrag', 'knowledge-graph', 'rag', 'networkx', 'agent-zero']
series: 'agent-zero'
day: 253
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 252](/blog/agent-zero/day-252-graphrag-extract/) 让大模型把 20 篇帮助中心文章抽成了三元组:先被 ```` ```json ```` 代码围栏弄崩了一次,不给白名单时三篇文章冒出 28 种关系,给了白名单后类型规则还抓出 32 条可疑的边,把每种关系的头尾类型写进提示词,最后得到一张 89 条边、109 个实体的图,存在 `part04/data/kg_llm.db`。

那一课留了两个伤疤:E4029 的尾实体叫「API 请求」,和「开放 API」不是一个点,图从中间断开;「468 元退 351 元」这种计算规则三元组装不下,没进图。今天第一次拿这张图回答问题,看这两个伤疤怎么发作,再拿 Day 240 的混合检索并排比一次。

## 今天要解决的问题

学完你应该能做到:

1. 用 networkx 把边表装成一张有向多重图,会查一个点的出边、入边、两跳以内的邻居。
2. 写出 local search 的三步:实体链接(从问题找到图里的种子实体)、沿边扩展、带证据回答,并能看着输出说出每一步出了什么问题。
3. 用同一批 4 道题、9 篇标准文章,对比图检索和 Day 240 混合检索「找文章」的召回,解释为什么在小知识库上图输了。
4. 说清楚什么问题该按结构查图,什么问题照旧走混合检索。

预计用时 2.5 小时。API 花费约 ¥0.03(主线 ¥0.012,练习 ¥0.012;embedding 和 rerank 用的硅基流动 bge-m3、bge-reranker-v2-m3 是免费模型)。

前置:[Day 252](/blog/agent-zero/day-252-graphrag-extract/) 的 `part04/kg_store.py` 和 `kg_llm.db`(没跑过的先跑 `uv run python -m part04.kg_extract2`),[Day 250](/blog/agent-zero/day-250-kg-basics/) 的 BFS 和邻接表,[Day 240](/blog/agent-zero/day-240-retrieval-pipeline/) 的 `part04/retrieve.py`(向量 + BM25 → RRF → rerank,要 Postgres.app 开着,索引用 [Day 231](/blog/agent-zero/day-231-pgvector-2/) 的 `pg_sync.py` 建好),[Day 236](/blog/agent-zero/day-236-rrf/) 的 RRF。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `kg_local.py` 的 `neighborhood()` 和 `kg_compare.py` 的 `graph_docs()`;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先把图装进 networkx

Day 250 自己写了邻接表和 BFS,二十来行。今天的图大一点,要做的操作也多(两跳邻居、子图、判断两点之间有没有路),换成现成的库 networkx。它是纯 Python 的图计算库,2026 年 9 月发布了 3.7,几百上千个点的图用它足够,到十万级再考虑 Neo4j 这类图数据库。

在 `agent-zero-lab/` 下装上:

```bash
uv add networkx
```

```python
# agent-zero-lab/part04/kg_graph.py  把 kg_llm.db 里的边装进 networkx,看看这张图长什么样
import networkx as nx

from part04.kg_store import load_edges


def load_graph() -> nx.MultiDiGraph:
    g = nx.MultiDiGraph()
    for e in load_edges():
        g.add_edge(e["head"], e["tail"], rel=e["rel"], evidence=e["evidence"], doc_id=e["doc_id"])
    return g


if __name__ == "__main__":
    G = load_graph()
    print(f"{G.number_of_nodes()} 个点,{G.number_of_edges()} 条边")
    print("连接最多的 5 个点:", sorted(G.degree, key=lambda x: -x[1])[:5])
    print("企业版的出边:")
    for _, t, d in G.out_edges("企业版", data=True):
        print(f"  -{d['rel']}-> {t}  [{d['doc_id']}]")
    print("企业版的入边:")
    for h, _, d in G.in_edges("企业版", data=True):
        print(f"  {h} -{d['rel']}->  [{d['doc_id']}]")
    U = G.to_undirected(as_view=True)
    print("E4029 到 企业版 有路吗:", nx.has_path(U, "E4029", "企业版"))
    print("开放 API 一跳以内:", sorted(nx.ego_graph(U, "开放 API", radius=1)))
    print("开放 API 两跳以内有几个点:", len(nx.ego_graph(U, "开放 API", radius=2)))
```

<div class="line-notes">

- `import networkx as nx` 社区惯例简写成 `nx`,就像 `import numpy as np`。
- `def load_graph() -> nx.MultiDiGraph:` 图有四种:`Graph`(无向)、`DiGraph`(有向)、`MultiGraph`、`MultiDiGraph`。Di 是有方向,Multi 是两个点之间允许有多条边。我们要 Multi,因为「企业版 -包含-> 开放 API」和「开放 API -仅限-> 企业版」连着同一对点。
- `g.add_edge(e["head"], e["tail"], rel=e["rel"], evidence=e["evidence"], doc_id=e["doc_id"])` 边上挂三个属性,关键字参数随便起名。点不用单独加,`add_edge` 会自动建出两端的点。
- `print(f"{G.number_of_nodes()} 个点,{G.number_of_edges()} 条边")` 实测 109 个点、89 条边,和 Day 252 的输出一致。
- `sorted(G.degree, key=lambda x: -x[1])[:5]` `G.degree` 给出每个点的(名字,度),度就是连着几条边,进出都算。`lambda x: -x[1]` 按度从大到小排,相当于 JS 的 `(a, b) => b[1] - a[1]`。
- `for _, t, d in G.out_edges("企业版", data=True):` 出边:企业版是头的那些边。`data=True` 让每条边带上属性字典 `d`。头就是企业版本身,用 `_` 丢掉。
- `for h, _, d in G.in_edges("企业版", data=True):` 入边:企业版是尾的那些边。
- `U = G.to_undirected(as_view=True)` 转成无向图看。`as_view=True` 不复制数据,只是换个角度看同一张图,改了 G,U 跟着变。
- `nx.has_path(U, "E4029", "企业版")` 两个点之间有没有路(不管走几步)。
- `nx.ego_graph(U, "开放 API", radius=1)` ego graph 是「以某个点为中心、半径 k 步以内的所有点」组成的子图。名字来自社会网络分析,ego 指「我」,就是「我」和我身边的人。

</div>

```bash
uv run python -m part04.kg_graph
```

```text
109 个点,89 条边
连接最多的 5 个点: [('企业版', 11), ('专业版', 9), ('免费版', 7), ('退款', 6), ('E2017', 5)]
企业版的出边:
  -月付价格-> 199 元  [kb-001]
  -年付价格-> 1908 元  [kb-001]
  -包含-> 开放 API  [kb-001]
  -包含-> 专属客服  [kb-001]
  -包含-> 增值税专用发票  [kb-001]
  -上限-> 每天导出 20 次  [kb-014]
  -可用于-> 多币种记账  [kb-020]
企业版的入边:
  增值税专用发票 -可用于->  [kb-006]
  优惠码 -不适用于->  [kb-008]
  备份恢复 -仅限->  [kb-018]
  开放 API -仅限->  [kb-019]
E4029 到 企业版 有路吗: False
开放 API 一跳以内: ['企业版', '开放 API']
开放 API 两跳以内有几个点: 10
```

几件事。企业版是图里连接最多的点,度 11,这种点叫**枢纽节点**(hub),后面它会在检索里到处抢分。企业版的出边里有一条 (企业版,可用于,多币种记账),这是 Day 252 类型规则抓到的那条方向写反的边,还留在图里,我没有手工删,今天就带着它跑。

最关键的是第 5 行:`E4029 到 企业版 有路吗: False`。Day 250 手写的图里,E4029 走三步就到 1908 元;模型建的图里,不管多少步都走不到。就因为 Day 252 说的那个名字问题。

再看最后两行,半径从 1 到 2,点从 2 个变成 10 个。开放 API 一步只能到企业版,第二步就把企业版的所有邻居都带进来了。枢纽节点就是这样让「两跳邻居」迅速膨胀的。

## local search 三步走

local search 的流程,微软 GraphRAG 的[官方文档](https://microsoft.github.io/graphrag/query/local_search/)是这么写的:先从问题找到图里相关的实体当入口,再从入口出发把相连的实体、关系、原文块、社区摘要收集起来,按优先级截断到一个上下文窗口装得下的大小,交给模型回答。我们今天做最核心的三步:

1. **实体链接**(entity linking):问题里说的「专票」,对应图里的哪个点?找到的点叫种子实体(seed)。
2. **沿边扩展**:从种子出发,把两步以内的边都拿出来,离种子近的排前面。
3. **带证据回答**:把这些边连同 Day 252 存下的原文证据、出处,交给模型。

<figure>
<svg viewBox="0 0 640 240" role="img" aria-label="local search 三步:实体链接让模型从 109 个实体名里挑种子,沿边扩展用 ego_graph 取两步以内的子图,最多 40 条边,带证据回答把边、原文和 kb 编号交给模型">
<rect x="0" y="0" width="640" height="240" fill="var(--paper-raised)"/>
<defs><marker id="gr253a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--ink-soft)"/></marker></defs>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="30" width="120" height="56" rx="4" fill="none" stroke="var(--ink-soft)"/>
<text x="76" y="54" fill="var(--ink)" text-anchor="middle">问题</text>
<text x="76" y="74" fill="var(--ink-faint)" text-anchor="middle" font-size="11">哪些功能只有企业版</text>
<line x1="136" y1="58" x2="164" y2="58" stroke="var(--ink-soft)" marker-end="url(#gr253a)"/>
<rect x="166" y="30" width="140" height="56" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="236" y="52" fill="var(--ink)" text-anchor="middle">① 实体链接</text>
<text x="236" y="72" fill="var(--ink-soft)" text-anchor="middle" font-size="11">109 个名字里挑 ≤5 个</text>
<line x1="306" y1="58" x2="334" y2="58" stroke="var(--ink-soft)" marker-end="url(#gr253a)"/>
<rect x="336" y="30" width="140" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="406" y="52" fill="var(--ink)" text-anchor="middle">② 沿边扩展</text>
<text x="406" y="72" fill="var(--ink-soft)" text-anchor="middle" font-size="11">ego_graph 半径 2</text>
<line x1="476" y1="58" x2="504" y2="58" stroke="var(--ink-soft)" marker-end="url(#gr253a)"/>
<rect x="506" y="30" width="120" height="56" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="566" y="52" fill="var(--ink)" text-anchor="middle">③ 带证据回答</text>
<text x="566" y="72" fill="var(--ink-soft)" text-anchor="middle" font-size="11">边+原文+kb 号</text>
<text x="236" y="114" fill="var(--ink-soft)" text-anchor="middle" font-size="11">种子:企业版、开放 API</text>
<text x="236" y="132" fill="var(--ink-soft)" text-anchor="middle" font-size="11">专属客服、多币种记账</text>
<text x="406" y="114" fill="var(--ink-soft)" text-anchor="middle" font-size="11">24 条边</text>
<text x="406" y="132" fill="var(--ink-soft)" text-anchor="middle" font-size="11">来自 9 篇文章</text>
<text x="566" y="114" fill="var(--ink-soft)" text-anchor="middle" font-size="11">2 次调用</text>
<text x="566" y="132" fill="var(--ink-soft)" text-anchor="middle" font-size="11">约 ¥0.004</text>
<line x1="16" y1="160" x2="624" y2="160" stroke="var(--rule)"/>
<text x="236" y="186" fill="var(--ink)" text-anchor="middle">错在这一步</text>
<text x="236" y="206" fill="var(--ink-soft)" text-anchor="middle" font-size="11">认错实体、漏认实体</text>
<text x="406" y="186" fill="var(--ink)" text-anchor="middle">错在这一步</text>
<text x="406" y="206" fill="var(--ink-soft)" text-anchor="middle" font-size="11">图断开、枢纽膨胀</text>
<text x="566" y="186" fill="var(--ink)" text-anchor="middle">错在这一步</text>
<text x="566" y="206" fill="var(--ink-soft)" text-anchor="middle" font-size="11">事实不在图里</text>
</g>
</svg>
<figcaption>local search 的三步和今天默认问题的真实数字。蓝框调模型,琥珀框是纯代码。下排是今天实际看到的三种失败,各自出在哪一步。</figcaption>
</figure>

```python
# agent-zero-lab/part04/kg_local.py  local search:问题 → 认出图里的实体 → 沿边扩两跳 → 带着边和原文证据回答
import json
import sys
from typing import Any

import networkx as nx

from common.llm import LLMClient
from part04.kg_graph import load_graph

LINK_PROMPT = """下面是知识图谱里的全部实体名,一行一个。找出和用户问题直接相关的实体,最多 5 个,
只能从列表里原样挑,不要自己造。只输出 JSON:{{"entities": ["..."]}}

实体列表:
{names}"""

ANSWER_PROMPT = """你是 CloudLedger 的客服。只根据下面的「事实」回答,每条结论后面用 [kb-xxx] 标出处。
事实里没有的,直接说帮助中心没写,不要猜。

事实:
{facts}"""

G = load_graph()
client = LLMClient()


def link_entities(question: str) -> list[str]:
    names = "\n".join(sorted(G.nodes))
    r = client.chat(
        [{"role": "system", "content": LINK_PROMPT.format(names=names)},
         {"role": "user", "content": question}],
        response_format={"type": "json_object"},
        temperature=0,
    )
    picked = json.loads(r.content).get("entities", [])
    return [n for n in picked if n in G]


def neighborhood(seeds: list[str], hops: int = 2, max_edges: int = 40) -> list[dict[str, Any]]:
    undirected = G.to_undirected(as_view=True)
    keep: set[str] = set()
    for s in seeds:
        keep |= set(nx.ego_graph(undirected, s, radius=hops))
    edges: list[dict[str, Any]] = []
    for h, t, d in G.subgraph(keep).edges(data=True):
        near = 0 if (h in seeds or t in seeds) else 1
        edges.append({"near": near, "head": h, "tail": t, **d})
    edges.sort(key=lambda e: (e["near"], e["doc_id"]))
    return edges[:max_edges]


def answer(question: str, edges: list[dict[str, Any]]) -> str:
    facts = "\n".join(
        f"- {e['head']} {e['rel']} {e['tail']}(原文:{e['evidence']})[{e['doc_id']}]" for e in edges
    )
    r = client.chat(
        [{"role": "system", "content": ANSWER_PROMPT.format(facts=facts)},
         {"role": "user", "content": question}],
        temperature=0,
    )
    return r.content


if __name__ == "__main__":
    q = sys.argv[1] if len(sys.argv) > 1 else "哪些功能只有企业版才有?"
    seeds = link_entities(q)
    edges = neighborhood(seeds)
    print("种子实体:", seeds)
    print(f"扩展出 {len(edges)} 条边,来自", sorted({e["doc_id"] for e in edges}))
    print(answer(q, edges))
    print("---", client.ledger)
```

<div class="line-notes">

- `LINK_PROMPT = """下面是知识图谱里的全部实体名,一行一个。` 实体链接最朴素的做法:把所有实体名都给模型,让它挑。今天 109 个名字拼起来 731 个字符,放得下。
- `只能从列表里原样挑,不要自己造。只输出 JSON:{{"entities": ["..."]}}` 这里用 `.format()` 填 `{names}`,所以字面量大括号也要写成两个,和 f-string 同一个规则。
- `事实里没有的,直接说帮助中心没写,不要猜。` 拒答规则,Day 227 讲过。后面会看到它把模型逼成了「诚实地答错」。
- `G = load_graph()` 模块一导入就建图,后面的函数都用这个 G。和 Day 240 `retrieve.py` 顶部建 BM25 索引是同一个思路。
- `names = "\n".join(sorted(G.nodes))` 全部实体名一行一个。实体到几千个就塞不下了,那时先用 embedding 或 BM25 在实体名上检索出几十个候选再让模型挑。微软 GraphRAG 的做法是给每个实体写一段描述再做 embedding,用问题的向量去找实体。
- `return [n for n in picked if n in G]` 模型偶尔会「改写」名字,比如写成「增值税专票」,不在图里的直接扔掉,否则下面 `ego_graph` 会报 `NodeNotFound`。`n in G` 就是判断图里有没有这个点。
- `def neighborhood(seeds: list[str], hops: int = 2, max_edges: int = 40) -> list[dict[str, Any]]:` 从一组种子出发,最多走 `hops` 步,最多返回 `max_edges` 条边。
- `undirected = G.to_undirected(as_view=True)` 扩展时不管方向。Day 252 那些方向写反的边,在这里不会造成「走不过去」;但如果你用的是有向的查法(只顺着箭头走),就会走不过去。
- `keep |= set(nx.ego_graph(undirected, s, radius=hops))` 每个种子的两步邻居取并集。`|=` 是集合的「并进来」,相当于 JS 里 `for (const x of b) a.add(x)`。
- `for h, t, d in G.subgraph(keep).edges(data=True):` `subgraph` 只保留这些点之间的边。注意用的是有向的 G,所以拿到的边方向还是原样。
- `near = 0 if (h in seeds or t in seeds) else 1` 直接连着种子的边记 0,隔一步的记 1。
- `edges.append({"near": near, "head": h, "tail": t, **d})` `**d` 把边属性(rel、evidence、doc_id)展开进字典,相当于 JS 的 `{...d}`。
- `edges.sort(key=lambda e: (e["near"], e["doc_id"]))` 按元组排序:先按远近,同样远的按文章编号。
- `return edges[:max_edges]` 最多给模型 40 条。枢纽节点两步就能带出几十条边,不截断的话上下文会被不相关的边塞满。
- `f"- {e['head']} {e['rel']} {e['tail']}(原文:{e['evidence']})[{e['doc_id']}]" for e in edges` 每条事实一行,带原文证据和出处。f-string 里套单引号取字典,外面是双引号,不冲突。
- `q = sys.argv[1] if len(sys.argv) > 1 else "哪些功能只有企业版才有?"` 命令行不带参数时跑默认的枚举题。

</div>

先跑默认问题,也就是 Day 250 开头那道枚举题:

```bash
uv run python -m part04.kg_local
```

```text
种子实体: ['企业版', '开放 API', '专属客服', '多币种记账']
扩展出 24 条边,来自 ['kb-001', 'kb-002', 'kb-006', 'kb-008', 'kb-014', 'kb-015', 'kb-018', 'kb-019', 'kb-020']
只有企业版才有的功能如下：

- **开放 API**：仅对企业版开放 [kb-019]
- **备份恢复**：企业版客户误删数据后，可以申请从备份恢复；其他套餐不提供备份恢复服务 [kb-018]
- **增值税专用发票**：仅限企业版，或年付的专业版 [kb-006]

另外，企业版还包含专属客服 [kb-001]。
--- 2 次调用 | 输入 1472 / 输出 112 tokens | 约 ¥0.0038
```

答得不错。开放 API 和备份恢复对,专属客服单独放在「另外」里,没说它独有,这是对的(kb-001 只说企业版包含专属客服)。有一处小毛病:专票列进了「只有企业版才有」,虽然后面跟着「或年付的专业版」,严格说不该列进来。证据原文就摆在事实里,模型还是被问题的问法带偏了一点。

再跑 Day 250 那道多跳题:

```bash
uv run python -m part04.kg_local "报 E4029 的客户,年付一年多少钱?"
```

```text
种子实体: ['E4029', '年付专业版']
扩展出 7 条边,来自 ['kb-001', 'kb-002', 'kb-006', 'kb-019']
关于 E4029:它发生在 API 请求,超过限制会返回 HTTP 429,错误码 E4029 [kb-019];解决办法是等待一分钟后重试 [kb-019]。

关于年付价格:专业版年付为 468 元(相当于每月 39 元)[kb-001],年付专业版也是 468 元,折合每月 39 元 [kb-002]。

另外,如果这位客户需要增值税专用发票,年付专业版可以开具(增值税专用发票仅限企业版,或年付的专业版)[kb-006]。
--- 2 次调用 | 输入 889 / 输出 139 tokens | 约 ¥0.0021
```

**答错了**,而且错得很有说服力。正确答案是 1908 元:E4029 是开放 API 的错误,开放 API 只有企业版能用,企业版年付 1908 元。模型给的是专业版的 468 元,每一句还都带着出处。

两个原因叠在一起。第一是实体链接:问题里有「年付」,模型挑了「年付专业版」当种子,这个点本来就和问题无关,却把专业版价格的边全带了进来。第二是图断开:从 E4029 出发,两步只能到「API 请求」和「HTTP 429」那一小撮,永远到不了企业版。模型手里只有专业版的价格,只好照着说。这就是 Day 252 那个名字问题的真实后果,练习 2 会把它修好。

第三道题是多条件的退款题:

```bash
uv run python -m part04.kg_local "我用优惠码买了年付专业版,开过增值税专票,第 3 个月想退款,要先做什么、能退多少?"
```

```text
种子实体: ['优惠码', '年付专业版', '增值税专用发票', '退款', '按实际支付的金额退款']
扩展出 25 条边,来自 ['kb-001', 'kb-002', 'kb-003', 'kb-006', 'kb-008', 'kb-014', 'kb-018', 'kb-019', 'kb-020']
根据帮助中心的内容，您的情况需要分两步处理：

**1. 退款前要先做什么**

- 需要先申请**发票红冲（作废）**，红冲完成后才能退款 [kb-003]。
- 退款还需要**客服主管审批**，客服主管会在 1 个工作日内审批 [kb-003]。

**2. 能退多少**

- 使用优惠码的订单退款时，**按实际支付的金额退款，优惠部分不退现金** [kb-008]。

至于“第 3 个月退款”具体能退多少比例、是否按剩余月份折算，帮助中心没有写，我无法确认，建议您联系客服主管审批时一并核实。
--- 2 次调用 | 输入 1547 / 输出 175 tokens | 约 ¥0.0037
```

红冲、审批、优惠部分不退现金都对。错在最后一段:「按剩余月份折算,帮助中心没有写」。kb-002 写得清清楚楚,年付按剩余整月退,还有 468 元退 351 元的例子。Day 252 说过,这种计算规则三元组装不下,图里没有,模型严格遵守了「事实里没有就说没写」,于是诚实地答错了。

三道题对照起来看,local search 的错误可以挨个定位:第二题错在第①步和图本身,第三题错在建图时就丢了的事实。光看最终回答,你只会觉得「答得不准」;把种子、边数、来源文章都打印出来,才知道该修哪一步。这也是 `kg_local.py` 主程序要把中间结果全部打印的原因。

修第三题有个很直接的思路:**图负责定位文章,原文负责回答**。图告诉你该看 kb-002、kb-003、kb-008,回答时把这几篇的原文拼进去,而不是只给边。微软 GraphRAG 的 local search 也会把实体挂着的原始文本块(text units)一起放进上下文。练习 1 就做这件事。不过,它成立的前提是图能把对的文章找出来。下一节就量一量图找文章的本事。

## 和混合检索比一比:谁找文章更准

同 4 道题,每题配一组我读完 20 篇手工标的「应该找到的文章」,一共 9 篇。一边用 Day 240 的 `retrieve()`(向量 + BM25 两路召回,RRF 融合,再 rerank,取 top-4 块,去重成文章),一边用图检索:按每篇文章在扩展出的边里贡献了多少条打分,取前 4 篇。

Day 240 的 `retrieve.py` 要用 Postgres 里的向量索引,先确认 Postgres.app 开着、[Day 231](/blog/agent-zero/day-231-pgvector-2/) 的 `pg_sync.py` 跑过。我在自己新建的库里重新建了一遍索引,42 个块:

```bash
uv run python -m part04.pg_sync
```

```text
{'total': 42, 'embedded': 42, 'deleted': 0}
```

```python
# agent-zero-lab/part04/kg_compare.py  同一批问题:Day 240 的混合检索(hybrid+rerank)vs 今天的图检索,看各找到了哪些文章
from collections import Counter

from part04.kg_local import client, link_entities, neighborhood
from part04.retrieve import retrieve  # Day 240 的检索流水线,要 Postgres 开着

CASES = [
    ("哪些功能只有企业版才有?", {"kb-001", "kb-006", "kb-018", "kb-019"}),
    ("我用优惠码买了年付专业版,开过增值税专票,第 3 个月想退款,要先做什么、能退多少?",
     {"kb-002", "kb-003", "kb-008"}),
    ("月付专业版能开增值税专用发票吗?", {"kb-006"}),
    ("导入的时候报 E1043", {"kb-011"}),
]


def graph_docs(question: str, k: int = 4) -> list[str]:
    edges = neighborhood(link_entities(question))
    score: Counter[str] = Counter()
    for e in edges:
        score[e["doc_id"]] += 2 if e["near"] == 0 else 1
    return [d for d, _ in score.most_common(k)]


def hybrid_docs(question: str, k: int = 4) -> list[str]:
    return list(dict.fromkeys(c.doc_id for c, _ in retrieve(question, k=k)))


def hits(found: list[str], gold: set[str]) -> int:
    return len(gold & set(found))


if __name__ == "__main__":
    total = {"混合检索": 0, "图检索": 0}
    n_gold = sum(len(g) for _, g in CASES)
    for q, gold in CASES:
        print(q[:24])
        for name, fn in [("混合检索", hybrid_docs), ("图检索", graph_docs)]:
            found = fn(q)
            total[name] += hits(found, gold)
            print(f"  {name:<4} {hits(found, gold)}/{len(gold)}  {found}")
    print({k: f"{v}/{n_gold}" for k, v in total.items()})
    print("---", client.ledger)
```

<div class="line-notes">

- `from part04.retrieve import retrieve  # Day 240 的检索流水线,要 Postgres 开着` 一导入就会连 Postgres、建 BM25 索引。Postgres.app 没开,这一行就报 `psycopg.OperationalError: connection failed`。
- `("哪些功能只有企业版才有?", {"kb-001", "kb-006", "kb-018", "kb-019"}),` 每题一个(问题,标准文章集合)。这 4 篇里 kb-006 严格说是「部分相关」(专票年付专业版也能开),但回答这题必须看它,所以算进来。
- `("导入的时候报 E1043", {"kb-011"}),` 一道普通的单篇题当对照,两边都应该答对。
- `edges = neighborhood(link_entities(question))` 图检索:直接复用 local search 的前两步。
- `score[e["doc_id"]] += 2 if e["near"] == 0 else 1` 一篇文章贡献的边越多、越靠近种子,分越高。直接连着种子的边算 2 分,隔一步的算 1 分。这个打分很粗,下面的结果会暴露它的问题。
- `return [d for d, _ in score.most_common(k)]` `most_common(k)` 是 `Counter` 自带的,按次数从大到小取前 k 个。
- `return list(dict.fromkeys(c.doc_id for c, _ in retrieve(question, k=k)))` 4 个块可能来自同一篇,`dict.fromkeys` 按出现顺序去重(Python 3.7 起 dict 保持插入顺序),比 `set` 好在不打乱名次。
- `return len(gold & set(found))` 命中了几篇标准文章。这就是召回(recall)的分子,Day 256 会正式讲。
- `print(f"  {name:<4} {hits(found, gold)}/{len(gold)}  {found}")` 每题打印命中数和找到的文章列表。

</div>

```bash
uv run python -m part04.kg_compare
```

```text
.../jieba/__init__.py:44: SyntaxWarning: invalid escape sequence '\.'
  re_han_default = re.compile("([一-鿕a-zA-Z0-9+#&\._%\-]+)", re.U)
.../jieba/__init__.py:46: SyntaxWarning: invalid escape sequence '\s'
  re_skip_default = re.compile("(\r\n|\s)", re.U)
.../jieba/finalseg/__init__.py:78: SyntaxWarning: invalid escape sequence '\.'
  re_skip = re.compile("([a-zA-Z0-9]+(?:\.\d+)?%?)")
哪些功能只有企业版才有?
  混合检索 3/4  ['kb-019', 'kb-018', 'kb-015', 'kb-001']
  图检索  2/4  ['kb-001', 'kb-014', 'kb-018', 'kb-020']
我用优惠码买了年付专业版,开过增值税专票,第 3
  混合检索 3/3  ['kb-002', 'kb-008', 'kb-003']
  图检索  2/3  ['kb-002', 'kb-001', 'kb-003', 'kb-006']
月付专业版能开增值税专用发票吗?
  混合检索 1/1  ['kb-006', 'kb-001', 'kb-003']
  图检索  1/1  ['kb-001', 'kb-006', 'kb-018', 'kb-020']
导入的时候报 E1043
  混合检索 1/1  ['kb-011', 'kb-009', 'kb-010']
  图检索  1/1  ['kb-011', 'kb-009', 'kb-010']
{'混合检索': '8/9', '图检索': '6/9'}
--- 4 次调用 | 输入 2326 / 输出 102 tokens | 约 ¥0.0025
```

开头那几行 `SyntaxWarning` 是 BM25 用的分词库 jieba 的老代码在 Python 3.12 下的警告,不是错误,不影响结果(常见误区里细说)。

结果:**混合检索 8/9,图检索 6/9**。图在「找文章」这件事上输了,输在前两题。原因有两个,面试时都值得讲出来。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="第一题图检索的文章得分:kb-001 15 分遥遥领先,kb-020 因为多币种记账被选成种子拿了 6 分,标准答案里的 kb-006 只有 3 分、kb-019 只有 2 分,被挤出前 4">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="24" fill="var(--ink-faint)" font-size="11">按边打分:连着种子的边 2 分,隔一步 1 分</text>
<rect x="20" y="40" width="300" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="330" y="56" fill="var(--ink)">kb-001  15 分(枢纽:套餐与价格)</text>
<rect x="20" y="70" width="120" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="150" y="86" fill="var(--ink)">kb-020  6 分(种子挑错:多币种记账)</text>
<rect x="20" y="100" width="80" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="110" y="116" fill="var(--ink)">kb-018  4 分 ✓</text>
<rect x="20" y="130" width="60" height="22" fill="none" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
<text x="90" y="146" fill="var(--ink-soft)">kb-006  3 分 ✓ 被挤出</text>
<rect x="20" y="160" width="60" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="90" y="176" fill="var(--ink)">kb-014  3 分</text>
<rect x="20" y="190" width="40" height="22" fill="none" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
<text x="70" y="206" fill="var(--ink-soft)">kb-019  2 分 ✓ 被挤出</text>
<line x1="20" y1="94" x2="620" y2="94" stroke="var(--rule)"/>
<line x1="20" y1="154" x2="620" y2="154" stroke="var(--rule)" stroke-dasharray="2 4"/>
<text x="600" y="150" fill="var(--ink-faint)" text-anchor="end" font-size="11">前 4 名到这里为止</text>
</g>
</svg>
<figcaption>默认那道题的种子(企业版、开放 API、专属客服、多币种记账)下,每篇文章在扩展出的 24 条边里得了多少分。打勾的是标准答案。kb-001 一篇拿了 15 分;kb-019 是最关键的文章,只贡献了一条边,2 分垫底。</figcaption>
</figure>

一是**枢纽节点抢分**。我拿默认那道题的种子把每篇文章的得分算了出来(`kg_compare.py` 里每题会重新做一次实体链接,种子可能和这里略有不同,所以它那次的前 4 名和图里不完全一样,但格局相同):kb-001 是「套餐与价格」,和企业版、专业版连着一大把边,一篇就拿了 15 分;kb-019 恰恰是最关键的那篇,可它在图里只有一条边连着种子,2 分垫底。按边数打分天然偏向「什么都沾一点」的文章。实体链接也在添乱:「多币种记账」被选成了种子,kb-020 白拿 6 分。第二题同理,kb-001 拿了 7 分,挤到了 kb-008 前面。要修,可以像 BM25 里的 IDF 那样给枢纽降权(练习 3),或者改用 Personalized PageRank 这类从种子出发、走得越远分越低的打分。

二是**知识库太小**。20 篇文章、42 个块,rerank 模型逐块看一遍,很容易就把相关的块挑出来;多跳题的三篇文章各自和问题都有明显的字面重叠(「优惠码」「专票」「退款」都写在问题里)。图检索的优势要在几千篇以上、同一个实体散落在几十篇文章里时才显出来。我在 CloudLedger 上没法证明这一点,这里只能说清楚为什么小库上它不占优。

那第一题图的回答为什么反而不错?因为回答用的是**边**,不是文章:「仅限 企业版」那几条边直接连在种子上,一条不落地进了上下文。看一下按关系精确查,不调模型:

```bash
sqlite3 part04/data/kg_llm.db "SELECT head, doc_id FROM edges WHERE rel = '仅限' AND tail = '企业版'"
```

```text
备份恢复|kb-018
开放 API|kb-019
```

一句 SQL,两项都是真正只有企业版才有的功能,出处清楚,专票也没有被误算进来(Day 252 第二版提示词把它抽成了「可用于」)。这才是图最该干的活:**枚举类、关系类问题按结构查,其余问题照旧走混合检索**。实际系统里常见两种接法:把图检索当成第三路召回,和向量、BM25 一起送进 RRF(Day 236 那个函数直接能用);或者把「按关系查图」做成一个工具交给 Agent,让它自己决定什么时候查图,这是 Day 266 Agentic RAG 的思路。

## 什么时候值得在检索里加一张图

把这两天的实测收拢成几条判断标准,我自己满足两条以上才考虑:

- 问题里经常出现「哪些」「所有」「和……有关的全部」这类枚举、汇总的问法,而且评测集证明混合检索在这类题上掉分。
- 领域里关系本身就是核心数据:药物和禁忌、法规条款之间的引用、公司股权、系统之间的依赖。
- 同一个实体散落在大量文档里,单篇只讲它的一部分。
- 能接受建图成本、更新延迟,并且有人负责抽查抽取质量(Day 252 那套类型规则要一直跑)。

CloudLedger 这种二十篇的帮助中心,四条都不太满足。先把混合检索、Contextual Retrieval(Day 241)做好,性价比高得多。

## 动手练习

**练习 1:图定位,原文回答。** 写 `answer_with_docs()`:用 `graph_docs()` 找出前 3 篇文章,把文章全文(而不是边)交给模型回答退款那道题。看「351 元」能不能出现。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/kg_ex253_1.py  练习 1:图只负责找文章,回答用文章原文
import sys

from part04.kg_compare import graph_docs
from part04.kg_local import client
from part04.kg_store import KB_DIR

PROMPT = """你是 CloudLedger 的客服。只根据下面的帮助中心文章回答,每条结论后面用 [kb-xxx] 标出处。
文章里没有的,直接说帮助中心没写,不要猜。

{docs}"""


def answer_with_docs(question: str, k: int = 3) -> tuple[list[str], str]:
    doc_ids = graph_docs(question, k=k)
    docs = "\n\n".join(f"[{d}]\n{(KB_DIR / f'{d}.md').read_text(encoding='utf-8')}" for d in doc_ids)
    r = client.chat(
        [{"role": "system", "content": PROMPT.format(docs=docs)}, {"role": "user", "content": question}],
        temperature=0,
    )
    return doc_ids, r.content


if __name__ == "__main__":
    q = sys.argv[1] if len(sys.argv) > 1 else "我用优惠码买了年付专业版,开过增值税专票,第 3 个月想退款,要先做什么、能退多少?"
    ids, text = answer_with_docs(q)
    print("图找到的文章:", ids)
    print(text)
    print("---", client.ledger)
```

<div class="line-notes">

- `from part04.kg_compare import graph_docs` 导入它会顺带导入 `retrieve`,所以 Postgres 也要开着。嫌麻烦可以把 `graph_docs` 挪到 `kg_local.py` 里。
- `doc_ids = graph_docs(question, k=k)` 图只负责给出文章编号。
- `docs = "\n\n".join(f"[{d}]\n{(KB_DIR / f'{d}.md').read_text(encoding='utf-8')}" for d in doc_ids)` 每篇前面标上编号,方便模型引用。f-string 里又套了一个 f-string,内层用单引号。
- `return doc_ids, r.content` 返回元组,调用方解包成两个变量。

</div>

```bash
uv run python -W ignore -m part04.kg_ex253_1
```

```text
图找到的文章: ['kb-002', 'kb-001', 'kb-003']
关于你的情况，帮助中心能确认的部分如下：

**先做什么**
- 因为这笔订单已经开具发票，需要先申请发票红冲（作废），红冲完成后才能退款。增值税专用发票需要你方配合退回或开具红字信息表。[kb-003]
- 红冲完成后，进入「设置 → 订阅 → 申请退款」，选择退款原因并提交，客服主管会在 1 个工作日内审批。[kb-003]

**能退多少**
- 年付套餐中途取消，按剩余整月数比例退款，已使用的月份和当前所在月份不退。以年付专业版 468 元、折合每月 39 元为例，第 3 个月中途取消，前 2 个月加当月共 3 个月不退，退剩余 9 个月，即 351 元。[kb-002]
- 注意：这个 351 元是按标准年付价 468 元计算的示例。你提到用了优惠码，实际支付金额可能不同，**帮助中心没有说明优惠码购买时退款金额如何计算**，这一点无法确认，建议提交退款时以客服核算为准。

**到账时间**
- 审批通过后原路退回，支付宝 1 到 3 个工作日到账，银行卡 3 到 7 个工作日到账。[kb-002]
--- 2 次调用 | 输入 1245 / 输出 318 tokens | 约 ¥0.0043
```

351 元出来了,按剩余整月退的算法也讲对了,这是只给边时做不到的。但新的问题冒出来:这次说「优惠码怎么算帮助中心没写」,因为前 3 篇里没有 kb-008,又是枢纽 kb-001 占了一个位置。`-W ignore` 是让 Python 不打印警告,把 jieba 那几行去掉。

图定位加原文回答,效果取决于定位准不准;定位的毛病(枢纽抢分)不修,换成原文也只是把错误从「没写」换成另一种「没写」。

</details>

**练习 2:把「API 请求」并进「开放 API」。** 用 `nx.relabel_nodes` 把这两个点合成一个,再问一次 E4029 那道题。先用默认的两步,再试三步。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/kg_ex253_2.py  练习 2:把「API 请求」并进「开放 API」,让 E4029 和企业版连起来
import networkx as nx

from part04.kg_local import G, answer, client, link_entities, neighborhood

ALIASES = {"API 请求": "开放 API"}

U = G.to_undirected(as_view=True)
print("合并前 E4029 到企业版有路吗:", nx.has_path(U, "E4029", "企业版"))
nx.relabel_nodes(G, ALIASES, copy=False)
print("合并后 E4029 到企业版有路吗:", nx.has_path(G.to_undirected(as_view=True), "E4029", "企业版"))
print("最短路径:", nx.shortest_path(G.to_undirected(as_view=True), "E4029", "1908 元"))

q = "报 E4029 的客户,年付一年多少钱?"
seeds = link_entities(q)
for hops in (2, 3):
    edges = neighborhood(seeds, hops=hops)
    print(f"== hops={hops},种子 {seeds},扩展出 {len(edges)} 条边")
    print(answer(q, edges))
print("---", client.ledger)
```

<div class="line-notes">

- `ALIASES = {"API 请求": "开放 API"}` 别名表:左边的名字改成右边。真实系统里这张表来自 Day 252 练习 3 那种相似度候选加人工确认。
- `nx.relabel_nodes(G, ALIASES, copy=False)` 改点的名字。`copy=False` 是就地修改 `kg_local` 里的那个 G,`link_entities` 和 `neighborhood` 用的是同一个对象,所以改完立刻生效。改名后两个同名的点自动合成一个,边都挂到「开放 API」上。
- `nx.shortest_path(G.to_undirected(as_view=True), "E4029", "1908 元")` 两点之间最短的一条路,返回途经的点。合并前这一行会报 `NetworkXNoPath`。
- `for hops in (2, 3):` 同样的种子,分别走两步和三步。

</div>

```text
合并前 E4029 到企业版有路吗: False
合并后 E4029 到企业版有路吗: True
最短路径: ['E4029', '开放 API', '企业版', '1908 元']
== hops=2,种子 ['E4029', '年付专业版'],扩展出 9 条边
您问的 E4029 和年付价格是两个不同的问题,分别回答:

- **E4029**:发生在开放 API,超过限制会返回 HTTP 429,错误码 E4029 [kb-019];解决办法是等待一分钟后重试 [kb-019]。
- **年付价格**:年付专业版 468 元,折合每月 39 元 [kb-002]。

需要提醒的是,开放 API 仅对企业版开放 [kb-019],所以遇到 E4029 的客户应该是企业版用户;而 468 元是专业版的年付价格 [kb-002]。企业版的年付价格,帮助中心没有写,我无法告知。
== hops=3,种子 ['E4029', '年付专业版'],扩展出 24 条边
E4029 是开放 API 超过限制时返回的错误码，解决办法是等待一分钟后重试 [kb-019]。不过，开放 API 仅对企业版开放 [kb-019]，所以遇到 E4029 的客户应属于企业版。

企业版年付价格是 1908 元 [kb-001]。
--- 3 次调用 | 输入 1852 / 输出 231 tokens | 约 ¥0.0048
```

合并以后路通了,最短路径正是 Day 250 手写图里那条三步路径。但两步还不够:模型推出了「客户是企业版」,却拿不到企业版的价格,只能说没写。走三步,1908 元这条边进了上下文,答对了。

跳数是个真实的取舍。三步时扩展出 24 条边,是两步的两倍多;如果种子是企业版这种枢纽,三步可能把半张图都拉进来。实际系统里一般默认一两步,再用打分和截断(`max_edges`)控制上下文大小。

</details>

**练习 3:给枢纽文章降权。** 把 `graph_docs()` 的打分改成「边分 ÷ log(1 + 这篇文章在整张图里的总边数)」,类似 BM25 里的 IDF。四道题重新算召回。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/kg_ex253_3.py  练习 3:给枢纽文章降权,边分除以 log(1 + 这篇文章的总边数)
import math
from collections import Counter

from part04.kg_compare import CASES, hits
from part04.kg_local import G, client, link_entities, neighborhood

DOC_EDGES = Counter(d["doc_id"] for _, _, d in G.edges(data=True))


def graph_docs_idf(question: str, k: int = 4) -> list[str]:
    score: Counter[str] = Counter()
    for e in neighborhood(link_entities(question)):
        score[e["doc_id"]] += 2 if e["near"] == 0 else 1
    weighted = {d: s / math.log(1 + DOC_EDGES[d]) for d, s in score.items()}
    return sorted(weighted, key=lambda d: -weighted[d])[:k]


if __name__ == "__main__":
    print("每篇文章的总边数(前 5):", DOC_EDGES.most_common(5))
    total = 0
    for q, gold in CASES:
        found = graph_docs_idf(q)
        total += hits(found, gold)
        print(f"{q[:24]}\n  降权后 {hits(found, gold)}/{len(gold)}  {found}")
    print(f"合计 {total}/{sum(len(g) for _, g in CASES)}")
    print("---", client.ledger)
```

<div class="line-notes">

- `DOC_EDGES = Counter(d["doc_id"] for _, _, d in G.edges(data=True))` 每篇文章在整张图里一共贡献了多少条边。kb-001 是 13 条,最多。
- `weighted = {d: s / math.log(1 + DOC_EDGES[d]) for d, s in score.items()}` 总边数越多,除数越大。用 log 是为了降得温和一点:13 条边的 kb-001 除以 log(14) ≈ 2.64,4 条边的文章除以 log(5) ≈ 1.61。
- `return sorted(weighted, key=lambda d: -weighted[d])[:k]` 对 dict 排序得到的是键的列表,按加权分从高到低。

</div>

```text
每篇文章的总边数(前 5): [('kb-001', 13), ('kb-006', 7), ('kb-002', 6), ('kb-004', 5), ('kb-012', 5)]
哪些功能只有企业版才有?
  降权后 2/4  ['kb-001', 'kb-014', 'kb-018', 'kb-020']
我用优惠码买了年付专业版,开过增值税专票,第 3
  降权后 3/3  ['kb-002', 'kb-008', 'kb-001', 'kb-003']
月付专业版能开增值税专用发票吗?
  降权后 1/1  ['kb-001', 'kb-006', 'kb-018', 'kb-020']
导入的时候报 E1043
  降权后 1/1  ['kb-011', 'kb-009', 'kb-010']
合计 7/9
```

从 6/9 升到 7/9,退款题 kb-008 回来了。第一题没变。按上面那组种子算:kb-001 的 15 分除以 log(14) ≈ 2.64 还有 5.7 分,依旧第一;kb-020 的 6 分除以 log(5) ≈ 1.61 是 3.7 分;kb-019 的 2 分除以 log(5) 只有 1.24 分,还是垫底。降权解决不了「一篇文章只贡献一条边」的问题。要更进一步,得看边的**关系类型**和问题是否匹配:问「只有企业版才有」,「仅限」边应该比「上限」边重要得多。这正是 Agent 把「按关系查图」当工具用时自然做到的事。

</details>

**练习 4(开放题):用 SQL 答一道枚举题。** 不调模型,写一条 SQL 回答「哪些东西专业版或免费版用不了,或者只有年付专业版能用」,结果带出处。

<details><summary>参考答案</summary>

示范解法:「可用于」「不适用于」的尾是套餐,按尾过滤就行。

```bash
sqlite3 part04/data/kg_llm.db "SELECT head, rel, tail, doc_id FROM edges WHERE rel IN ('可用于','不适用于','不支持') AND tail IN ('专业版','年付专业版','免费版')"
```

在我的图上的输出:

```text
增值税专用发票|可用于|年付专业版|kb-006
备份恢复|不适用于|专业版|kb-018
备份恢复|不适用于|免费版|kb-018
```

三行都对:专票年付专业版能开,备份恢复专业版和免费版都不行。加上 `'不支持'` 没有多出结果,因为「不支持」的头是套餐或操作、尾是不能做的事(比如「月付套餐 不支持 中途退款」),尾不会是套餐。

这道题的意义是对比:混合检索要把 kb-006、kb-018 两篇都捞上来,还得模型读懂「其他套餐不提供备份恢复服务」;图在建图时已经把这句话变成了两条「不适用于」,查询只是一个 WHERE。代价是这两条边全靠 Day 252 的第二版提示词抽对了,第一版图里 kb-018 那条还是方向反的「企业版 可用于 备份恢复」。

</details>

验收标准:`kg_graph.py`、`kg_local.py`(三道题)、`kg_compare.py` 都跑通;你能对着自己的 E4029 那题输出,说出答错是错在实体链接、图断开还是事实缺失;能说出混合检索和图检索在自己机器上各几分,以及图输掉的两个原因。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| local search | 从问题里的实体出发,沿边扩展几步,把邻近的边和证据交给模型回答 |
| 实体链接(entity linking) | 把问题里的说法对应到图里的点,比如「专票」对应「增值税专用发票」 |
| 种子实体(seed) | 实体链接找到的、作为扩展起点的点 |
| networkx | 纯 Python 的图计算库,今天用它的 `MultiDiGraph`、`ego_graph`、`has_path` |
| `MultiDiGraph` | 有方向、两点之间允许多条边的图 |
| 度(degree) | 一个点连着几条边 |
| 枢纽节点(hub) | 度特别大的点,比如今天的企业版,会在检索里到处抢分 |
| ego graph | 以某个点为中心、半径 k 步以内的子图 |
| 子图(subgraph) | 只保留一部分点和它们之间的边 |
| 召回(recall) | 标准答案里被找到的比例,今天 8/9 和 6/9 |
| 文本块(text unit) | 微软 GraphRAG 里挂在实体上的原文片段,local search 会一起放进上下文 |

## 常见误区

**以为图检索一定比向量检索强。** 今天 4 道题图检索找文章 6/9,混合检索 8/9。图擅长枚举和按关系查,找文章这件事在小知识库上不占优,要看你自己的评测集。

**只看最终回答,不打印中间结果。** E4029 那题的回答句句带出处,看着很专业,其实价格是错的。把种子、边数、来源文章打印出来,才知道是实体链接挑错了「年付专业版」、图又断开了。

**以为「事实里没有就说没写」能防住错误。** 拒答规则防的是编造,防不了图里本来就缺的事实。退款题模型严格遵守规则,诚实地说「帮助中心没写」,可 kb-002 写得清清楚楚。图负责定位,回答要带原文。

**跳数越多越好。** 两步扩展出 9 条边答不出价格,三步 24 条边答对了;但种子是枢纽时,三步可能把半张图拉进来。跳数和 `max_edges` 要一起调。

**把 jieba 的 SyntaxWarning 当成报错。** `invalid escape sequence '\.'` 是 jieba 源码里的正则字符串没写 `r` 前缀,Python 3.12 开始对此发警告。它只是警告,程序照常运行;不想看可以 `uv run python -W ignore -m ...`。千万别为了消警告去改 `.venv` 里的库代码。

**忘了开 Postgres。** `kg_compare.py` 一导入 `retrieve` 就连数据库,Postgres.app 没开会报 `connection failed`。不是代码的问题,打开 Postgres.app 再跑。

**图里的边方向错了,无向扩展就无所谓。** 扩展时确实不管方向,所以方向错的边照样被找到;但交给模型的事实是「企业版 可用于 多币种记账」这种念不通的句子,模型可能照着念出错误结论,按方向查的 SQL 也会漏。

## 学习资料

### 文档与文章

- [Microsoft GraphRAG · Local Search](https://microsoft.github.io/graphrag/query/local_search/):官方的 local search 说明,看它的上下文由哪几部分组成(实体、关系、原文块、社区报告),和今天的三步对照,15 分钟。
- [Microsoft GraphRAG · Query Engine 总览](https://microsoft.github.io/graphrag/query/overview/):local、global、DRIFT、basic 四种查询方式各一句话的说明,10 分钟。
- [networkx · Tutorial](https://networkx.org/documentation/stable/tutorial.html):建图、加边、查邻居、边属性,今天用到的全在前半部分,30 分钟。
- [networkx · ego_graph](https://networkx.org/documentation/stable/reference/generated/networkx.generators.ego.ego_graph.html) 和 [MultiDiGraph](https://networkx.org/documentation/stable/reference/classes/multidigraph.html):今天两个核心 API 的文档。
- [LightRAG 论文(arXiv 2410.05779)](https://arxiv.org/abs/2410.05779):读双层检索那一节,低层检索就是今天的 local search,看它怎么用关键词去匹配实体,40 分钟。
- [Anthropic · Introducing Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval):上 GraphRAG 之前先试的便宜方案,Day 241 读过的可以跳过。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1NahG6ZEbB&autoplay=0&high_quality=1" title="一口气搞懂 LightRAG：分块、建图、向量化、查询全流程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>古道AI · 一口气搞懂 LightRAG:分块、建图、向量化、查询全流程 · 22 分钟。昨天看了建图,今天看查询那段,看 LightRAG 的 local、hybrid、mix 几种模式各把什么放进上下文。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1FtytYeEQM&autoplay=0&high_quality=1" title="如何快速部署和运行lightRag(轻量版的GraphRag), 并且进行知识图谱的可视化。" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Bin_Nong · 如何快速部署和运行 lightRag 并进行知识图谱的可视化 · 12 分钟,播放量 2 万多。看真实工具建出来的图可视化以后长什么样,枢纽节点一眼就能看出来。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/-tgQa8Fzf80" title="HybridRAG: A Fusion of Graph and Vector Retrieval  - Mitesh Patel, NVIDIA" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · Mitesh Patel(NVIDIA)· HybridRAG: A Fusion of Graph and Vector Retrieval · 英文,讲图检索和向量检索怎么合在一起用,和今天「图当第三路召回」的结论是一个方向。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Za7aG-ooGLQ" title="GraphRAG Explained: AI Retrieval with Knowledge Graphs & Cypher" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>IBM Technology · GraphRAG Explained: AI Retrieval with Knowledge Graphs & Cypher · 白板讲解,看它怎么用 Cypher 查图,和今天那条 SQL 枚举对照。</figcaption>
</figure>

### 书籍

- Tomaž Bratanič、Oskar Hane《Essential GraphRAG》(Manning,2025)。讲图检索和向量检索结合的章节,以及 Text2Cypher(让模型把问题翻译成图查询)。目前没查到中译本。
- Chip Huyen《AI Engineering》(O'Reilly,2025)第 6 章 RAG 部分,对比了不同检索方式的取舍,可以和今天的 8/9 对 6/9 对照着读。

### 开源项目与代码

- [HKUDS/LightRAG](https://github.com/HKUDS/LightRAG):想直接用现成框架时首选,查询模式有 local、global、hybrid、naive、mix,存储可以全放 Postgres。
- [microsoft/graphrag](https://github.com/microsoft/graphrag):local search 的实现,看它怎么给上下文里的各部分分配 token 预算。
- [neo4j/neo4j-graphrag-python](https://github.com/neo4j/neo4j-graphrag-python):里面有向量检索加图扩展的检索器(VectorCypherRetriever),就是今天「先找入口再沿边走」的正式版。

## 自测

**1. local search 分哪三步?今天 E4029 那题错在哪几步?**

<details><summary>答案</summary>

实体链接、沿边扩展、带证据回答。E4029 那题错在两处:实体链接多挑了「年付专业版」,把专业版价格的边带进了上下文;沿边扩展时图是断开的(E4029 连的是「API 请求」,不是「开放 API」),走多少步都到不了企业版。最后模型只能照着专业版的 468 元回答。

</details>

**2. 为什么 `link_entities()` 要过滤掉不在图里的名字?不过滤会怎样?**

<details><summary>答案</summary>

模型偶尔会改写实体名,比如把「增值税专用发票」写成「增值税专票」。这种名字图里没有,传给 `nx.ego_graph` 会抛 `NodeNotFound`,整个查询崩掉。`[n for n in picked if n in G]` 把它们挡在门外。

</details>

**3. 今天图检索找文章 6/9,混合检索 8/9。说出两个原因。**

<details><summary>答案</summary>

一是枢纽节点抢分:kb-001 和企业版、专业版连着很多边,按边数打分时不管问什么都排在前面,挤掉了 kb-019、kb-006、kb-008。二是知识库太小:20 篇文章 42 个块,rerank 足以把相关块挑出来,多跳题的几篇文章和问题都有明显的字面重叠,图的优势要在实体散落在大量文档里时才显出来。另外建图时丢掉的事实,图也找不到。

</details>

**4. 「图负责定位,原文负责回答」解决了什么问题,又依赖什么?**

<details><summary>答案</summary>

解决了三元组装不下计算规则和例子的问题:退款题换成原文以后,「351 元」和按剩余整月退的算法都出来了。它依赖图能把对的文章找出来;练习 1 里前 3 篇被 kb-001 占了一个位置,kb-008 没进来,优惠码那部分又变成了「没写」。

</details>

**5.(面试题)面试官问:「你们的 RAG 已经有向量加关键词检索了,要不要加知识图谱?」你怎么回答?**

<details><summary>答案</summary>

参考回答:先看问题分布和评测数字。图最擅长两类:枚举和按关系查(「哪些功能仅限企业版」一条 SQL 就答对),以及要跨文档串起来的多跳题;找相关文章这件事,小知识库上它不如混合检索,我们实测 20 篇的帮助中心,4 道题 9 篇标准文章,混合检索加 rerank 找到 8 篇,图检索 6 篇,输在枢纽节点抢分。而且图的质量完全取决于抽取:实体名不一致会让图断开,我们就遇到过错误码连不到对应功能、模型答错价格的情况;计算规则装不进三元组,回答时必须带原文。所以我的建议是不替换,而是增量接入:把图检索当第三路召回送进 RRF,或者把「按关系查图」做成工具给 Agent,用同一份评测集对比,确实提升再扩大范围。

</details>

## 明天预告

Day 254 · GraphRAG(三):社区摘要和 global search。今天两道题都是问具体事情。还有一类问题 local search 和混合检索都答不了:「帮助中心里所有带时间期限的规则,汇总成一张清单」。答案散在十几篇文章里,任何 top-k 都装不下。明天用 Louvain 把图切成社区,每个社区写一段摘要,再对摘要做 map-reduce。你会看到第一版 map 提示词让 19 个社区全部回答「无」,以及改一句话之后发生了什么。
