---
title: 'Day 254 · GraphRAG(三):社区摘要和 global search'
description: '「帮助中心里所有带时间期限的规则,汇总成一张清单」这种全局问题,混合检索 top-4 只覆盖 20 条里的 5 条。今天用 Louvain 把图切成社区,每个社区写一段摘要,再对摘要做 map-reduce:第一版 map 提示词让 19 个社区全部回答「无」,改一句话后 11 个有内容,覆盖到 15 条;把被扔掉的小社区捡回来,升到 18 条。'
pubDate: 2026-10-22
regime: none
tags: ['graphrag', 'knowledge-graph', 'rag', 'networkx', 'agent-zero']
series: 'agent-zero'
day: 254
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 253](/blog/agent-zero/day-253-graphrag-local/) 第一次拿模型抽出来的图回答问题。local search 从问题里认出种子实体,沿边走两步,把边和原文证据交给模型:枚举题答得不错;E4029 那题因为图断开答成了专业版的价格;退款题因为「351 元」没进图,模型说帮助中心没写。和 Day 240 的混合检索比找文章,图 6/9,混合检索 8/9。

那两天的问题都是问具体事情。Day 250 开头列过的第三类问题一直没碰:全局问题。「帮助中心里所有带时间期限的规则,汇总成一张清单」,答案散在十几篇文章里,任何 top-k 都装不下,local search 也不知道从哪个实体出发。今天讲 GraphRAG 论文标题里那个「Global」:社区摘要和 global search。

## 今天要解决的问题

学完你应该能做到:

1. 说清楚什么是图的社区,用 networkx 的 Louvain 把图切成社区,并能看出这张图切得好不好。
2. 给每个社区写摘要,再用 map-reduce 回答全局问题;知道 map 提示词为什么会让所有社区都说「无」,怎么改。
3. 用 20 条人工标注的标准答案给全局回答打分,对比混合检索,并能定位漏掉的规则死在了哪一步。

预计用时 2.5 小时。API 花费约 ¥0.1(主线 ¥0.055,练习约 ¥0.05,算式在后面)。

前置:[Day 252](/blog/agent-zero/day-252-graphrag-extract/) 的 `kg_store.py` 和 `kg_llm.db`,[Day 253](/blog/agent-zero/day-253-graphrag-local/) 的 `kg_graph.py`(`load_graph()`)和 networkx,[Day 240](/blog/agent-zero/day-240-retrieval-pipeline/) 的 `retrieve.py`(对照组要用,Postgres.app 要开着),[Day 249](/blog/agent-zero/day-249-rlm/) 讲过的「长上下文数数会数错」。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `kg_global.py` 的 `global_search()` 和两版 `MAP_PROMPT`;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 全局问题,检索为什么答不了

先看看 Day 240 的混合检索能做到什么程度。我读完 20 篇文章,把所有带时间期限的规则列成了 20 条标准答案(后面的 `kg_global_eval.py` 里有完整清单),然后让混合检索取 top-4 块、交给模型回答,再数它覆盖了几条。结果先放这:

```text
混合检索 top-4: 覆盖 5/20
```

这不是检索做得不好,是这类问题本身和 top-k 不对付。答案在十几篇文章里各有一两句,问题「所有带时间期限的规则」和任何一块都不怎么像;就算把 k 调到 20,块里还混着大量和时限无关的内容,而 Day 249 已经见过,长上下文里让模型「数全」本来就容易漏。

微软 GraphRAG 的思路是事先把知识库分成若干块「主题」,每块写一段摘要,问全局问题时让每段摘要各答一次,最后合并。这里的「块」不是 Day 224 按字数切的文本块,而是图上关系紧密的一团实体,叫社区。

## 第一步:社区是什么,先不调模型看一眼

图的社区(community)是一团点:团内部的边很多,团和团之间的边很少。用前端的东西打比方,一个大型 React 项目的 import 依赖图里,`components/billing/` 下的文件互相引用很密,和 `components/auth/` 之间只有寥寥几条引用,这两个目录在依赖图上就是两个社区。社区发现(community detection)就是不看目录名,只看边,把这种团自动找出来。

最常用的算法叫 Louvain(2008 年比利时鲁汶大学的几位作者提出,名字就来自这个城市)。它的直觉是这样的:先让每个点自己一团,然后反复尝试把一个点挪到邻居的团里,如果挪过去以后「团内部的边比随机情况下多出来的部分」变大了,就挪;挪不动了,把每个团缩成一个点,再来一轮。那个「比随机多出来的部分」有个名字叫模块度(modularity),Louvain 就是在贪心地让它变大。微软 GraphRAG 用的是它的改进版 Leiden,还会切出好几层(大社区里套小社区)。

networkx 里一行就有。新建 `part04/kg_louvain.py`,今天第一个脚本不调模型:

```python
# agent-zero-lab/part04/kg_louvain.py  不调模型:先看 Louvain 把图切成了哪几团
import networkx as nx

from part04.kg_graph import load_graph

G = load_graph()
simple = nx.Graph(G.to_undirected())
groups = nx.community.louvain_communities(simple, seed=42)
groups = sorted(groups, key=len, reverse=True)
print(f"{simple.number_of_nodes()} 个点切成 {len(groups)} 个社区,大小:", [len(g) for g in groups])
for i, nodes in enumerate(groups[:6]):
    docs = sorted({d["doc_id"] for _, _, d in G.subgraph(nodes).edges(data=True)})
    print(f"社区 {i}({len(nodes)} 个点,文章 {docs}):", "、".join(sorted(nodes)[:8]), "…" if len(nodes) > 8 else "")
print("连通块个数:", nx.number_connected_components(simple))
```

<div class="line-notes">

- `G = load_graph()` Day 253 写的函数,从 `kg_llm.db` 读出 89 条边建成 `MultiDiGraph`。
- `simple = nx.Graph(G.to_undirected())` Louvain 要普通的无向图:把多重有向图压平,两点之间不管几条边、什么方向,都只算一条。这里没加 `as_view=True`,因为 `nx.Graph(...)` 本来就要复制一份。
- `groups = nx.community.louvain_communities(simple, seed=42)` 返回一个列表,每项是一个社区(点名字的集合)。Louvain 每次挪点的顺序是随机的,`seed=42` 固定随机数,保证每次切法一样。
- `groups = sorted(groups, key=len, reverse=True)` 按社区大小从大到小排。`key=len` 就是拿每个集合的长度排序。
- `docs = sorted({d["doc_id"] for _, _, d in G.subgraph(nodes).edges(data=True)})` 这个社区内部的边来自哪几篇文章。用原来的 G 取子图,边上的 `doc_id` 属性还在。
- `"…" if len(nodes) > 8 else ""` 只打印前 8 个点,多了就加省略号。
- `nx.number_connected_components(simple)` 连通块:彼此之间有路相通的一团点。不同的连通块之间一条边都没有。

</div>

```bash
uv run python -m part04.kg_louvain
```

```text
109 个点切成 29 个社区,大小: [17, 9, 6, 6, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]
社区 0(17 个点,文章 ['kb-001', 'kb-002', 'kb-006', 'kb-008', 'kb-014', 'kb-015', 'kb-019', 'kb-020']): 1908 元、199 元、3 名成员、30 种货币、468 元、49 元、5 个账本、专业版 …
社区 1(9 个点,文章 ['kb-002', 'kb-003', 'kb-008']): 1 个工作日、1 到 3 个工作日、3 个工作日、3 到 7 个工作日、发票红冲、客服主管审批、按实际支付的金额退款、申请退款 …
社区 2(6 个点,文章 ['kb-001', 'kb-005', 'kb-014', 'kb-015', 'kb-018']): 1 个账本、1 名成员、200 条流水、免费版、备份恢复、每天导出 1 次 
社区 3(6 个点,文章 ['kb-012']): E2017、上传发票原始 PDF、去掉 PDF 密码、发票识别、手动录入发票、重新拍摄清晰的照片 
社区 4(4 个点,文章 ['kb-004', 'kb-014', 'kb-015']): 7 天、宽限期、超过 10 万行的导出、邀请链接 
社区 5(4 个点,文章 ['kb-010']): E1042、下载最新的导入模板、把日期列的单元格格式设置为「文本」、银行流水导入 
连通块个数: 28
```

先看好的一面。社区 0 是套餐与价格,社区 1 是退款流程(审批、红冲、到账时间,来自 kb-002、003、008 三篇),社区 3 是 E2017 发票识别失败。没告诉算法任何主题,它只看边就把同一个主题的事实聚到了一起,而且社区 1 跨了三篇文章,这是按文章分组做不到的。

再看两个问题,这两个问题今天后面都会咬人。

第一,**社区 4 是被一个值粘起来的**。宽限期(kb-004)、导出链接(kb-014)、邀请链接(kb-015)三件毫无关系的事,只因为尾实体都是「7 天」,就成了同一个点的邻居,被切成一团。Day 252 我们让模型把「7 天」「30 天」这种值也当成实体,好处是能查,坏处就在这:值是很多事实共享的,它像一个假枢纽,把不相干的事实连在一起。

第二,**29 个社区里有 10 个只有 2 个点**,而且连通块就有 28 个。连通块之间一条边都没有,Louvain 不可能把它们合起来,所以这张图的社区数下限就是 28。说白了,这张 89 条边、109 个点的图非常稀,大部分「社区」其实就是一两条孤零零的边,比如(汇率,时限,每天早上 8 点)。这是 Day 252 那句「实体比边还多」的直接后果。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="三种社区:社区 1 是真正的主题,退款流程跨三篇文章;社区 4 被值节点 7 天粘在一起,宽限期、导出链接、邀请链接互不相干;两个点的小社区如汇率和每天早上 8 点,孤立在外">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="12" y="20" width="200" height="210" rx="8" fill="none" stroke="var(--mem)"/>
<text x="112" y="40" fill="var(--mem)" text-anchor="middle">社区 1:真主题</text>
<rect x="62" y="60" width="100" height="28" rx="14" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="112" y="79" fill="var(--ink)" text-anchor="middle">退款</text>
<rect x="24" y="130" width="84" height="26" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="66" y="148" fill="var(--ink)" text-anchor="middle">发票红冲</text>
<rect x="116" y="130" width="88" height="26" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="160" y="148" fill="var(--ink)" text-anchor="middle">主管审批</text>
<rect x="62" y="190" width="100" height="26" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="112" y="208" fill="var(--ink)" text-anchor="middle">3 到 7 工作日</text>
<line x1="112" y1="88" x2="66" y2="130" stroke="var(--ink-soft)"/>
<line x1="112" y1="88" x2="160" y2="130" stroke="var(--ink-soft)"/>
<line x1="112" y1="88" x2="112" y2="190" stroke="var(--ink-soft)"/>
<text x="112" y="245" fill="var(--ink-faint)" text-anchor="middle" font-size="11">kb-002/003/008</text>
<rect x="222" y="20" width="200" height="210" rx="8" fill="none" stroke="var(--compute)"/>
<text x="322" y="40" fill="var(--compute)" text-anchor="middle">社区 4:被值粘住</text>
<rect x="282" y="110" width="80" height="30" rx="15" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="322" y="130" fill="var(--ink)" text-anchor="middle">7 天</text>
<rect x="234" y="60" width="80" height="26" rx="4" fill="none" stroke="var(--ink-soft)"/>
<text x="274" y="78" fill="var(--ink)" text-anchor="middle">宽限期</text>
<rect x="330" y="60" width="84" height="26" rx="4" fill="none" stroke="var(--ink-soft)"/>
<text x="372" y="78" fill="var(--ink)" text-anchor="middle">邀请链接</text>
<rect x="262" y="180" width="120" height="26" rx="4" fill="none" stroke="var(--ink-soft)"/>
<text x="322" y="198" fill="var(--ink)" text-anchor="middle">10 万行的导出</text>
<line x1="274" y1="86" x2="310" y2="110" stroke="var(--ink-soft)"/>
<line x1="372" y1="86" x2="336" y2="110" stroke="var(--ink-soft)"/>
<line x1="322" y1="140" x2="322" y2="180" stroke="var(--ink-soft)"/>
<text x="322" y="245" fill="var(--ink-faint)" text-anchor="middle" font-size="11">kb-004/014/015,互不相干</text>
<rect x="432" y="20" width="196" height="210" rx="8" fill="none" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
<text x="530" y="40" fill="var(--ink-soft)" text-anchor="middle">10 个两点小社区</text>
<rect x="452" y="70" width="60" height="26" rx="4" fill="none" stroke="var(--ink-soft)"/>
<text x="482" y="88" fill="var(--ink)" text-anchor="middle">汇率</text>
<rect x="520" y="70" width="100" height="26" rx="4" fill="none" stroke="var(--ink-soft)"/>
<text x="570" y="88" fill="var(--ink)" text-anchor="middle">每天早上 8 点</text>
<line x1="512" y1="83" x2="520" y2="83" stroke="var(--ink-soft)"/>
<rect x="452" y="130" width="60" height="26" rx="4" fill="none" stroke="var(--ink-soft)"/>
<text x="482" y="148" fill="var(--ink)" text-anchor="middle">自动续费</text>
<rect x="520" y="130" width="100" height="26" rx="4" fill="none" stroke="var(--ink-soft)"/>
<text x="570" y="148" fill="var(--ink)" text-anchor="middle">到期前 3 天</text>
<line x1="512" y1="143" x2="520" y2="143" stroke="var(--ink-soft)"/>
<text x="530" y="200" fill="var(--ink-soft)" text-anchor="middle" font-size="11">一条边一个社区</text>
<text x="530" y="245" fill="var(--ink-faint)" text-anchor="middle" font-size="11">下一步会被扔掉</text>
</g>
</svg>
<figcaption>Louvain 在这张图上切出的三种社区。左边是我们想要的「主题」;中间是被「7 天」这个值节点粘起来的假主题;右边是孤立的两点小社区。下一步只给 3 个点以上的社区写摘要,右边这些会全部被扔掉,今天后面要为此付出代价。</figcaption>
</figure>

## 第二步:每个社区写一段摘要

global search 要先离线做一件事:每个社区让模型写一段摘要,存进库里。这一步和建图一样是一次性的,问问题时不再调。

```python
# agent-zero-lab/part04/kg_communities.py  global search 的准备:切社区,每个社区让大模型写一段摘要,存进 kg_llm.db
import networkx as nx

from common.llm import LLMClient
from part04.kg_graph import load_graph
from part04.kg_store import connect

SUMMARY_PROMPT = """下面是知识图谱里一组关系紧密的事实。用 3~5 句话总结这一组在讲什么,
保留所有具体数字和限制条件,每句话后面用 [kb-xxx] 标出处(只用事实里出现过的编号)。

事实:
{facts}"""


def main() -> None:
    G = load_graph()
    client = LLMClient()
    groups = nx.community.louvain_communities(nx.Graph(G.to_undirected()), seed=42)
    groups = [g for g in sorted(groups, key=len, reverse=True) if len(g) >= 3]
    with connect() as conn:
        conn.execute("DROP TABLE IF EXISTS communities")
        conn.execute("CREATE TABLE communities (id INTEGER PRIMARY KEY, size INTEGER, summary TEXT)")
        for i, nodes in enumerate(groups):
            facts = "\n".join(
                f"- {h} {d['rel']} {t}(原文:{d['evidence']})[{d['doc_id']}]"
                for h, t, d in G.subgraph(nodes).edges(data=True)
            )
            r = client.chat([{"role": "user", "content": SUMMARY_PROMPT.format(facts=facts)}], temperature=0)
            conn.execute("INSERT INTO communities VALUES (?, ?, ?)", (i, len(nodes), r.content))
            print(f"社区 {i:>2}({len(nodes):>2} 个点):{r.content.replace(chr(10), ' ')[:46]}…")
    print(client.ledger)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `保留所有具体数字和限制条件,每句话后面用 [kb-xxx] 标出处(只用事实里出现过的编号)。` 摘要最容易丢的就是数字,所以点名要保留。出处那半句是防模型编出事实里没有的 kb 编号。
- `groups = [g for g in sorted(groups, key=len, reverse=True) if len(g) >= 3]` 只留 3 个点以上的社区,两个点的就是一条边,单独总结似乎没意义。实测留下 19 个,扔掉 10 个。这一行练习 2 要回来改。
- `conn.execute("DROP TABLE IF EXISTS communities")` 每次重建。社区表和 `edges` 表放在同一个库里,`edges` 不动。
- `for h, t, d in G.subgraph(nodes).edges(data=True)` 子图只含社区内部的边,跨社区的边不进摘要。
- `r = client.chat([{"role": "user", "content": SUMMARY_PROMPT.format(facts=facts)}], temperature=0)` 每个社区一次调用,19 个社区 19 次。
- `print(f"社区 {i:>2}({len(nodes):>2} 个点):{r.content.replace(chr(10), ' ')[:46]}…")` `{i:>2}` 右对齐占 2 格;把换行换成空格后只打印前 46 个字,一个社区占一行。

</div>

```bash
uv run python -m part04.kg_communities
```

```text
社区  0(17 个点):专业版月付价格为 49 元，年付价格为 468 元（相当于每月 39 元），最多支持 5 个…
社区  1( 9 个点):所有退款都需要客服主管审批后执行，且客服主管会在 1 个工作日内完成审批 [kb-002][…
社区  2( 6 个点):免费版最多支持 1 个账本、每月最多记录 200 条流水，且仅限 1 名成员 [kb-001…
社区  3( 6 个点):E2017 表示发票图片无法识别 [kb-012]。针对该问题，可重新拍摄清晰的照片，或上传…
社区  4( 4 个点):这组事实说明多个项目都设有 7 天时限：到期后有 7 天宽限期，宽限期内所有功能正常 [kb…
社区  5( 4 个点):错误码 E1042 表示银行流水导入失败 [kb-010]。其解决办法是下载最新的导入模板 …
社区  6( 4 个点):E1043 表示文件不是 UTF-8 编码。[kb-011] 解决办法之一是在 Excel …
社区  7( 4 个点):E3001 表示支付渠道拒绝了这笔付款 [kb-013]。针对 E3001，解决办法包括更换…
社区  8( 4 个点):更换手机号时，若旧手机号仍可用，需要在「设置 → 账号」里通过旧手机号接收验证码来完成更换。…
社区  9( 4 个点):注销账号设有 30 天冷静期，提交后在此期间可以随时撤销。[kb-017] 若存在未结束的付…
社区 10( 3 个点):扣款失败后，系统会每 24 小时重试一次。[kb-004] 最多重试 3 次。[kb-004…
社区 11( 3 个点):申请发票需在付款后 90 天内，通过「账单 → 发票」提交申请。[kb-006] 申请时还需…
社区 12( 3 个点):开票时限为 1 到 2 个工作日，发票会在该时限内开出 [kb-006]。超过 90 天未申…
社区 13( 3 个点):发票开具后 30 天内，可以在「账单 → 发票」里申请红冲并重新开具。[kb-007] 每张…
社区 14( 3 个点):超过30天重开发票时，需要联系客服，并提供加盖公章的情况说明。[kb-007] 这一要求同时…
社区 15( 3 个点):导入银行流水时，单个文件大小上限为 10 MB，且行数上限为 5 万行。[kb-009] 这…
社区 16( 3 个点):同一账户连续 5 次支付失败会触发支付功能锁定 [kb-013]。该锁定持续 1 小时 [k…
社区 17( 3 个点):这组事实说明系统每天自动备份，备份保留 30 天 [kb-018]。所有数据在 30 天后永…
社区 18( 3 个点):这组事实讲的是 API 请求超过限制时会返回 HTTP 429 错误码 E4029 [kb-…
19 次调用 | 输入 3728 / 输出 1266 tokens | 约 ¥0.0176
```

社区 4 的摘要老老实实写着「多个项目都设有 7 天时限」,模型自己发现了这团东西唯一的共同点就是那个值。再看社区 17 的完整摘要:

```bash
sqlite3 part04/data/kg_llm.db "SELECT summary FROM communities WHERE id = 17"
```

```text
这组事实说明系统每天自动备份，备份保留 30 天 [kb-018]。所有数据在 30 天后永久删除，且无法恢复 [kb-017]。因此备份保留期与数据删除时限均为 30 天 [kb-018][kb-017]。
```

最后一句「因此」是模型自己推出来的。kb-018 讲备份,kb-017 讲注销后删数据,两件事毫无因果,只是被「30 天」这个值节点拉进了同一个社区。摘要为了「总结这一组在讲什么」,硬给它们找了个联系。这句话本身不算错,但它是一条原文里没有的新「事实」,后面会原样出现在最终答案里。

## 第三步:global search,第一版 map 提示词

查询时做 map-reduce。map-reduce 这个词你可能在 JS 里见过:`array.map()` 对每个元素各做一次,`reduce()` 把结果合成一个。这里一样:**map** 是每段社区摘要各回答一次问题,互不相干;**reduce** 是把所有非「无」的回答交给模型合成一份。

```python
# agent-zero-lab/part04/kg_global.py  global search:每个社区摘要各答一遍(map),再合成一份(reduce)
import sys

from common.llm import LLMClient
from part04.kg_store import connect

MAP_PROMPT = """根据下面这段摘要回答用户的问题。摘要里没有相关内容,就只输出「无」。

摘要:
{summary}"""

REDUCE_PROMPT = """下面是几位同事各自根据一部分资料给出的答案。合并成一份完整、不重复的回答,
按主题分组,保留每条的 kb 编号。

{partials}

问题:{question}"""

client = LLMClient()


def global_search(question: str) -> str:
    with connect() as conn:
        rows = conn.execute("SELECT id, summary FROM communities ORDER BY id").fetchall()
    partials: list[str] = []
    for r in rows:
        part = client.chat(
            [{"role": "system", "content": MAP_PROMPT.format(summary=r["summary"])},
             {"role": "user", "content": question}],
            temperature=0,
        ).content.strip()
        if part != "无":
            partials.append(f"[社区 {r['id']}]\n{part}")
    print(f"{len(rows)} 个社区里有 {len(partials)} 个给出了内容")
    if not partials:
        return "无"
    return client.chat(
        [{"role": "user", "content": REDUCE_PROMPT.format(partials="\n\n".join(partials), question=question)}],
        temperature=0,
    ).content


if __name__ == "__main__":
    q = sys.argv[1] if len(sys.argv) > 1 else "帮助中心里所有带时间期限的规则,汇总成一张清单"
    print(global_search(q))
    print("---", client.ledger)
```

<div class="line-notes">

- `MAP_PROMPT = """根据下面这段摘要回答用户的问题。摘要里没有相关内容,就只输出「无」。` 第一版 map 提示词,看着很合理。允许说「无」是为了让无关的社区不往 reduce 里塞噪声。
- `REDUCE_PROMPT = """下面是几位同事各自根据一部分资料给出的答案。` reduce 时告诉模型这些是不同来源的部分答案,要合并、去重、保留出处。
- `rows = conn.execute("SELECT id, summary FROM communities ORDER BY id").fetchall()` 读出全部社区摘要。`fetchall()` 在 `with` 块里调用,把数据一次取完。
- `part = client.chat(` map 阶段:每段摘要独立回答一次。这 19 次调用互不依赖,生产里会并发跑(Day 68 的 `asyncio.gather`),这里为了好读写成顺序的,19 次大约 20 秒。
- `).content.strip()` 去掉首尾空白,不然模型回一个「无\n」就判断不出来。
- `if part != "无":` 说「无」的社区丢掉,不进 reduce。
- `partials.append(f"[社区 {r['id']}]\n{part}")` 给每段答案标上来源社区。
- `if not partials:` 一个有内容的都没有,就不调 reduce 了,直接返回「无」。这行是我第一次跑完才加的,原因马上看到。
- `return client.chat(` reduce 阶段:一次调用合并所有部分答案。社区多到几百个时一次放不下,要分层合并,先每 10 个合一次,再合并结果。

</div>

```bash
uv run python -m part04.kg_global
```

```text
19 个社区里有 0 个给出了内容
无
--- 19 次调用 | 输入 2026 / 输出 19 tokens | 约 ¥0.0042
```

**19 个社区,0 个给出内容。** 输出一共 19 个 token,每个社区一个「无」。可社区 4 的摘要第一句就是「多个项目都设有 7 天时限」,这还不相关?单独拿社区 4 测一下,连跑两次:

```python
# agent-zero-lab/part04/kg_map_one.py  单独拿社区 4(明明全是 7 天时限)测 map 提示词,连跑两次
from part04.kg_global import MAP_PROMPT, client
from part04.kg_store import connect

with connect() as conn:
    summary = conn.execute("SELECT summary FROM communities WHERE id = 4").fetchone()["summary"]
print("社区 4 的摘要:", summary)
for i in range(2):
    r = client.chat(
        [{"role": "system", "content": MAP_PROMPT.format(summary=summary)},
         {"role": "user", "content": "帮助中心里所有带时间期限的规则,汇总成一张清单"}],
        temperature=0,
    )
    print(f"第 {i + 1} 次:", r.content)
```

<div class="line-notes">

- `from part04.kg_global import MAP_PROMPT, client` 复用同一个提示词和同一个客户端,保证测的就是刚才那一版。
- `summary = conn.execute("SELECT summary FROM communities WHERE id = 4").fetchone()["summary"]` `fetchone()` 取一行,`["summary"]` 按列名取值,前提是 `kg_store.connect()` 设了 `row_factory`。
- `for i in range(2):` 跑两次,排除偶然。

</div>

```bash
uv run python -m part04.kg_map_one
```

```text
社区 4 的摘要: 这组事实说明多个项目都设有 7 天时限：到期后有 7 天宽限期，宽限期内所有功能正常 [kb-004]；邀请链接在 7 天内有效 [kb-015]；超过 10 万行的导出链接同样在 7 天内有效 [kb-014]。
第 1 次: 无
第 2 次: 无
```

两次都是「无」。原因在问题的措辞:用户要的是「帮助中心里**所有**带时间期限的规则」,模型手里只有一小段摘要,它判断「这一段答不了『所有』」,于是老老实实说无。站在它的角度看这个判断甚至是对的,问题出在我们没告诉它:你只是一群同事里的一个,只需要交你手里那一部分。

## 第四步:让每个 map 知道自己是局部

只改 `MAP_PROMPT` 这一处,其余代码不动:

```python
# agent-zero-lab/part04/kg_global.py  第二版:只改 MAP_PROMPT,告诉每个 map 它只负责一小块
MAP_PROMPT = """下面这段摘要只是全部资料里的一小块,别的部分由其他同事负责。
把这段摘要里和问题有关的内容都列出来,保留数字和 kb 编号;一条相关的都没有,才只输出「无」。

摘要:
{summary}"""
```

<div class="line-notes">

- `MAP_PROMPT = """下面这段摘要只是全部资料里的一小块,别的部分由其他同事负责。` 关键的一句:明确告诉模型它是局部,「所有」不是它一个人的责任。和 REDUCE_PROMPT 里「几位同事」的说法也对上了。
- `把这段摘要里和问题有关的内容都列出来,保留数字和 kb 编号;一条相关的都没有,才只输出「无」。` 把「答问题」换成「列出有关的内容」,门槛从「能答」降到「沾边」;「才」字把「无」变成最后的选项。

</div>

```bash
uv run python -m part04.kg_global
```

```text
19 个社区里有 11 个给出了内容
以下是帮助中心里所有带时间期限的规则汇总清单，按主题分组：

## 一、退款与支付

1. 客服主管审批退款：1 个工作日内完成审批 [kb-002][kb-003]
2. 重复支付核实后全额退还重复的那一笔：3 个工作日内原路退回 [kb-002]
3. 支付宝退款到账：1 到 3 个工作日到账 [kb-002]
4. 银行卡退款到账：3 到 7 个工作日到账 [kb-002]
5. 扣款失败后，系统会每 24 小时重试一次 [kb-004]
6. 扣款失败最多重试 3 次 [kb-004]

## 二、审核与账号

7. 人工审核会在 2 个工作日内处理 [kb-016]
8. 注销账号设有 30 天冷静期，提交后在此期间可以随时撤销 [kb-017]

## 三、项目与链接有效期

9. 多个项目都设有 7 天时限：到期后有 7 天宽限期，宽限期内所有功能正常 [kb-004]
10. 邀请链接在 7 天内有效 [kb-015]
11. 超过 10 万行的导出链接在 7 天内有效 [kb-014]

## 四、发票

12. 申请发票需在付款后 90 天内提交申请 [kb-006]
13. 开票时限为 1 到 2 个工作日，发票会在该时限内开出 [kb-006]
14. 超过 90 天未申请的订单不再支持开票 [kb-006]
15. 发票开具后 30 天内，可以在「账单 → 发票」里申请红冲并重新开具 [kb-007]
16. 超过 30 天重开发票时，需要联系客服，并提供加盖公章的情况说明（需同时满足“联系客服”和“加盖公章的情况说明”两个条件，仅针对超过 30 天的重开发票情形）[kb-007]

## 五、数据备份与删除

17. 系统每天自动备份，备份保留 30 天 [kb-018]
18. 所有数据在 30 天后永久删除，且无法恢复 [kb-017]
19. 备份保留期与数据删除时限均为 30 天 [kb-018][kb-017]

## 六、其他

20. 等待一分钟后重试 [kb-019]
--- 20 次调用 | 输入 3163 / 输出 1069 tokens | 约 ¥0.0149
```

改一句话,有内容的社区从 0 个变成 11 个,清单覆盖了 9 篇不同的文章。宽限期、开票 90 天、红冲 30 天、注销冷静期、邀请链接、导出链接、备份 30 天都在。这是 top-4 检索不可能做到的。

但先别高兴,通读一遍就能挑出毛病。第 6 条「最多重试 3 次」是次数不是时限,第 20 条「等待一分钟后重试」勉强算;第 9 条把社区 4 摘要的开头原样搬了进来;第 19 条就是社区 17 那句模型自己推出来的「因此」,现在它成了清单里的一条「规则」。还有一类问题光看看不出来:漏了什么。这得靠标准答案。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="global search 的 map-reduce:19 段社区摘要各自回答,第一版提示词 19 个都回答无,第二版 11 个给出内容,再由一次 reduce 合并成清单">
<rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)"/>
<defs><marker id="gr254a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--ink-soft)"/></marker></defs>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="24" fill="var(--ink-faint)" font-size="11">19 段社区摘要</text>
<rect x="20" y="34" width="90" height="24" rx="4" fill="none" stroke="var(--compute)"/><text x="65" y="51" fill="var(--ink)" text-anchor="middle">社区 0</text>
<rect x="20" y="66" width="90" height="24" rx="4" fill="none" stroke="var(--compute)"/><text x="65" y="83" fill="var(--ink)" text-anchor="middle">社区 1</text>
<text x="65" y="112" fill="var(--ink-faint)" text-anchor="middle">…</text>
<rect x="20" y="124" width="90" height="24" rx="4" fill="none" stroke="var(--compute)"/><text x="65" y="141" fill="var(--ink)" text-anchor="middle">社区 18</text>
<line x1="110" y1="46" x2="168" y2="46" stroke="var(--ink-soft)" marker-end="url(#gr254a)"/>
<line x1="110" y1="78" x2="168" y2="78" stroke="var(--ink-soft)" marker-end="url(#gr254a)"/>
<line x1="110" y1="136" x2="168" y2="136" stroke="var(--ink-soft)" marker-end="url(#gr254a)"/>
<rect x="170" y="30" width="150" height="122" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="245" y="58" fill="var(--ink)" text-anchor="middle">map × 19</text>
<text x="245" y="80" fill="var(--ink-soft)" text-anchor="middle" font-size="11">每段各答一次</text>
<text x="245" y="110" fill="var(--ink-soft)" text-anchor="middle" font-size="11">第一版:0 个有内容</text>
<text x="245" y="130" fill="var(--ink-soft)" text-anchor="middle" font-size="11">第二版:11 个有内容</text>
<line x1="320" y1="91" x2="368" y2="91" stroke="var(--ink-soft)" marker-end="url(#gr254a)"/>
<rect x="370" y="66" width="100" height="50" rx="4" fill="none" stroke="var(--ink-soft)"/>
<text x="420" y="88" fill="var(--ink)" text-anchor="middle">去掉「无」</text>
<text x="420" y="106" fill="var(--ink-soft)" text-anchor="middle" font-size="11">纯代码</text>
<line x1="470" y1="91" x2="508" y2="91" stroke="var(--ink-soft)" marker-end="url(#gr254a)"/>
<rect x="510" y="66" width="110" height="50" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="565" y="88" fill="var(--ink)" text-anchor="middle">reduce × 1</text>
<text x="565" y="106" fill="var(--ink-soft)" text-anchor="middle" font-size="11">合并去重</text>
<text x="320" y="185" fill="var(--ink-faint)" text-anchor="middle" font-size="11">一次全局问题 = 社区数 + 1 次调用;今天 20 次,约 ¥0.015</text>
<text x="320" y="205" fill="var(--ink-faint)" text-anchor="middle" font-size="11">map 不知道自己是局部时,会因为「答不了所有」而全部说无</text>
</g>
</svg>
<figcaption>global search 的调用次数和社区数成正比。蓝框调模型。19 个 map 互不依赖,可以并发;reduce 只有一次,但社区多了要分层合并。</figcaption>
</figure>

顺便看一眼微软 GraphRAG 的正式做法([Global Search 文档](https://microsoft.github.io/graphrag/query/global_search/)):map 阶段每段输出的是一组「要点」,每个要点带一个重要性打分;reduce 前按分数排序、过滤,只把最重要的要点拼进最终上下文。它还能选在哪一层社区上做,层越低社区越细,答案越全,调用也越多。我们今天这版是它的极简形态。

## 第五步:拿标准答案打分

清单长不等于全对。把我读文章列出的 20 条时限规则写成标准答案,每条配一个正则,在回答里搜得到就算覆盖。顺便把对照组(混合检索 top-4)也放进来,同一个问题、同一个打分。

```python
# agent-zero-lab/part04/kg_global_eval.py  给「所有带时间期限的规则」列 20 条标准答案,数 global search 和混合检索各覆盖几条
import re

from part04.kg_global import client, global_search
from part04.retrieve import retrieve

QUESTION = "帮助中心里所有带时间期限的规则,汇总成一张清单"
D = r"(到|-|~|—|至)"
GOLD = [  # (出处, 规则, 匹配用的正则;匹配前先去掉所有空格)
    ("kb-002", "重复扣款 3 个工作日内退回", r"重复.{0,30}3个工作日"),
    ("kb-002", "支付宝 1 到 3 个工作日到账", rf"1{D}3个工作日"),
    ("kb-002", "银行卡 3 到 7 个工作日到账", rf"3{D}7个工作日"),
    ("kb-003", "客服主管 1 个工作日内审批", r"(?<![到\d-])1个工作日"),
    ("kb-003", "电子普通发票红冲当天完成", r"当天"),
    ("kb-004", "到期前 3 天自动扣款", r"前3天"),
    ("kb-004", "扣款失败每 24 小时重试", r"24小时"),
    ("kb-004", "7 天宽限期", r"宽限期"),
    ("kb-004", "超额数据保留 90 天", r"(数据|额度).{0,15}90天|90天.{0,8}(恢复|保留)"),
    ("kb-006", "付款后 90 天内申请发票", r"付款后90天"),
    ("kb-006", "发票 1 到 2 个工作日开出", rf"1{D}2个工作日"),
    ("kb-007", "开具后 30 天内可红冲重开", r"开具后30天"),
    ("kb-013", "连续支付失败锁定 1 小时", r"1小时"),
    ("kb-014", "导出下载链接 7 天有效", r"导出.{0,12}7天"),
    ("kb-015", "邀请链接 7 天有效", r"邀请.{0,8}7天"),
    ("kb-016", "人工审核 2 个工作日", r"(?<![到\d-])2个工作日"),
    ("kb-017", "注销 30 天冷静期", r"冷静期"),
    ("kb-017", "注销后数据 30 天永久删除", r"永久删除"),
    ("kb-018", "备份保留 30 天", r"备份.{0,6}30天"),
    ("kb-020", "汇率每天早上 8 点更新", r"8点"),
]


def score(answer: str) -> list[str]:
    text = re.sub(r"\s", "", answer)
    return [rule for _, rule, pat in GOLD if re.search(pat, text)]


def rag_answer(question: str) -> str:
    chunks = [c for c, _ in retrieve(question, k=4)]
    context = "\n\n".join(f"[{c.doc_id}] {c.text}" for c in chunks)
    return client.chat(
        [{"role": "system", "content": f"只根据下面的资料回答,标出处 [kb-xxx]。\n\n{context}"},
         {"role": "user", "content": question}],
        temperature=0,
    ).content


if __name__ == "__main__":
    for name, fn in [("混合检索 top-4", rag_answer), ("global search", global_search)]:
        got = score(fn(QUESTION))
        missed = [rule for _, rule, _ in GOLD if rule not in got]
        print(f"{name}: 覆盖 {len(got)}/{len(GOLD)}")
        print("  漏了:", "、".join(missed))
    print("---", client.ledger)
```

<div class="line-notes">

- `D = r"(到|-|~|—|至)"` 「1 到 3 个工作日」可能被模型写成「1-3 个工作日」「1~3 个工作日」,把几种连接符都列上。
- `GOLD = [  # (出处, 规则, 匹配用的正则;匹配前先去掉所有空格)` 20 条标准答案。每条的正则我都拿第四步那份输出手工核对过,该匹配的能匹配、不该匹配的不匹配。这是今天最花时间的一段,也是评测里最值钱的一段。
- `("kb-002", "支付宝 1 到 3 个工作日到账", rf"1{D}3个工作日"),` `rf"..."` 是原始字符串加 f-string,`{D}` 会被替换成上面那组连接符。
- `("kb-003", "客服主管 1 个工作日内审批", r"(?<![到\d-])1个工作日"),` `(?<!...)` 叫反向否定断言:匹配位置的前面不能是「到」、数字或减号。这条主要是给下面 kb-016 那条「2 个工作日」用的:不加的话,「1 到 2 个工作日」里的「2个工作日」会被误算成人工审核那条;「21个工作日」这种也挡掉。kb-003 这条为了对称也加上。
- `("kb-004", "超额数据保留 90 天", r"(数据|额度).{0,15}90天|90天.{0,8}(恢复|保留)"),` 帮助中心里有两个「90 天」(kb-004 数据保留和 kb-006 开票期限),正则要靠上下文把它们分开。`.{0,15}` 是中间隔 0 到 15 个任意字符。
- `text = re.sub(r"\s", "", answer)` 先去掉所有空白,模型写「3个工作日」还是「3 个工作日」都一样。
- `return [rule for _, rule, pat in GOLD if re.search(pat, text)]` 返回覆盖到的规则名。
- `chunks = [c for c, _ in retrieve(question, k=4)]` 对照组:Day 240 的混合检索取 top-4 块。
- `context = "\n\n".join(f"[{c.doc_id}] {c.text}" for c in chunks)` 块前标上文章编号拼进 system,这就是 Day 226 那种最普通的 RAG。
- `for name, fn in [("混合检索 top-4", rag_answer), ("global search", global_search)]:` 两种方法同一个问题、同一个打分,函数也能放进列表里遍历,和 JS 一样。

</div>

```bash
uv run python -W ignore -m part04.kg_global_eval
```

```text
混合检索 top-4: 覆盖 5/20
  漏了: 重复扣款 3 个工作日内退回、客服主管 1 个工作日内审批、电子普通发票红冲当天完成、到期前 3 天自动扣款、付款后 90 天内申请发票、发票 1 到 2 个工作日开出、开具后 30 天内可红冲重开、连续支付失败锁定 1 小时、导出下载链接 7 天有效、邀请链接 7 天有效、人工审核 2 个工作日、注销 30 天冷静期、注销后数据 30 天永久删除、备份保留 30 天、汇率每天早上 8 点更新
19 个社区里有 11 个给出了内容
global search: 覆盖 15/20
  漏了: 电子普通发票红冲当天完成、到期前 3 天自动扣款、超额数据保留 90 天、连续支付失败锁定 1 小时、汇率每天早上 8 点更新
--- 21 次调用 | 输入 3429 / 输出 1284 tokens | 约 ¥0.0169
```

**混合检索 5/20,global search 15/20。** 这是 GraphRAG 论文最想证明的那件事:全局问题上,社区摘要加 map-reduce 远远好过 top-k 检索。注意这次 global search 是重新跑的,和第四步那份回答不完全一样,但我用 `score()` 给第四步那份也打了分,同样是 15/20、漏的也是这五条。

漏的五条死在哪,我先剧透一部分,练习 1 让你自己查清楚:其中四条(红冲当天、到期前 3 天、数据保留 90 天、汇率 8 点)在图里都有对应的边,但它们所在的社区都只有 2 个点,第二步那行 `if len(g) >= 3` 把它们扔掉了,根本没写摘要。我在第一步说「这张图很稀,很多社区只有一条边」,代价就在这。

打分还有两件事要说明白。一是它只数覆盖,不数噪声:第 6 条「最多重试 3 次」不是时限,这里不扣分。完整的评测要再人工数一遍「混进了几条不该有的」,Day 260 讲生成评估时会让大模型当裁判来做这件事。二是正则是我手写的,它本身也可能错,换一个模型、换一种措辞,可能漏判。评测脚本也要拿几份回答人工抽查,这是 Day 255 开始那几天的主题。

## 存到哪,花多少钱

三天下来用的是 SQLite 一张边表加 networkx,几千条边以内、单机跑完全够。往上走有三条路,我 2026 年 10 月看了一下现状:

- **Postgres 邻接表 + 递归 CTE**。Day 228 起你已经有 Postgres 了,边表直接建在那里,多跳用 `WITH RECURSIVE`(Day 250 提过它可读性差)。两三跳以内性能没问题,好处是向量、全文、图都在一个库里。LightRAG 推荐生产环境用 Postgres 一个库存下全部数据,也是这个原因。
- **Apache AGE**。给 Postgres 加图查询的扩展,能在 Postgres 里写 Cypher。GitHub 上的发布标签现在是 PG18/v1.8.0-rc0(2026-07)和 PG15/v1.8.0-rc0(2026-09),都还带着 rc 字样。我自己不会在正式项目里用。
- **Neo4j**。专门的图数据库,多跳查询和 PageRank、社区发现这些图算法都内置,官方的 `neo4j-graphrag` 包把抽取、存储、检索封装好了。本机没装,我没有实跑。

我的建议是:原型阶段用今天这套,先拿评测数字确认图在你的数据上真有收益,再决定换存储。很多团队一上来就部署 Neo4j,最后发现瓶颈在抽取质量,不在存储,这三天的每一个问题(方向反、名字不一致、值节点粘连、小社区被扔)都和存储无关。

钱的账,按 `.env` 里的高峰价(0.04 / 2 / 8 元每百万 token,DeepSeek 2026 年 10 月):

```text
建图(Day 252 第二版):20 次,10681 输入 + 3866 输出   账本 ¥0.041
社区摘要(今天第二步):19 次,3728 输入 + 1266 输出     账本 ¥0.018
一次 global search:20 次,约 3200 输入 + 1100 输出      账本 ¥0.015
一次 local search:2 次                                 账本 约 ¥0.003
```

建图和摘要是一次性的,问题来了只付查询的钱。但 global search 每问一次都要把所有社区跑一遍,社区数一多,每次查询的成本就跟着线性涨:今天 19 个社区一次一分半钱,1000 个社区就是一块多钱、上千次调用。这是 global search 最大的工程问题。微软后来提出的 LazyGraphRAG(微软研究院博客,按标题搜索)换了个思路:建索引时不调大模型做摘要,查询时再按需调用,把成本从建图挪到查询、并且只在用得上的部分花。

## 动手练习

**练习 1:漏掉的五条死在哪一步?** 逐个社区跑一次 map,打印每个社区的 map 是否给出内容,以及摘要里、map 回答里有没有出现「当天」「前 3 天」「90 天」「1 小时」「8 点」这几个词。再用 SQL 查这五条在 `edges` 表里在不在。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/kg_ex254_1.py  练习 1:逐个社区看 map 的回答,找出漏掉的规则死在了哪一步
from part04.kg_global import MAP_PROMPT, client
from part04.kg_global_eval import QUESTION
from part04.kg_store import connect

LOOK_FOR = ["当天", "前 3 天", "90 天", "1 小时", "8 点"]

with connect() as conn:
    rows = conn.execute("SELECT id, summary FROM communities ORDER BY id").fetchall()
for r in rows:
    in_summary = [w for w in LOOK_FOR if w in r["summary"]]
    part = client.chat(
        [{"role": "system", "content": MAP_PROMPT.format(summary=r["summary"])},
         {"role": "user", "content": QUESTION}],
        temperature=0,
    ).content.strip()
    in_map = [w for w in LOOK_FOR if w in part]
    flag = "无" if part == "无" else "有"
    print(f"社区 {r['id']:>2} map={flag}  摘要里有 {in_summary}  map 里有 {in_map}")
print("---", client.ledger)
```

<div class="line-notes">

- `from part04.kg_global_eval import QUESTION` 导入它会顺带导入 `retrieve`,Postgres 要开着。
- `LOOK_FOR = ["当天", "前 3 天", "90 天", "1 小时", "8 点"]` 漏掉那五条的关键词。用带空格的写法,因为摘要里模型基本按原文写「90 天」。
- `in_summary = [w for w in LOOK_FOR if w in r["summary"]]` 摘要里有没有。没有,说明死在摘要之前(社区划分或建图)。
- `in_map = [w for w in LOOK_FOR if w in part]` 摘要里有、map 里没有,说明死在 map;map 里有、最终答案里没有,说明死在 reduce。

</div>

```text
社区  0 map=无  摘要里有 []  map 里有 []
社区  1 map=有  摘要里有 []  map 里有 []
社区  2 map=无  摘要里有 []  map 里有 []
社区  3 map=无  摘要里有 []  map 里有 []
社区  4 map=有  摘要里有 []  map 里有 []
社区  5 map=无  摘要里有 []  map 里有 []
社区  6 map=无  摘要里有 []  map 里有 []
社区  7 map=无  摘要里有 []  map 里有 []
社区  8 map=有  摘要里有 []  map 里有 []
社区  9 map=有  摘要里有 []  map 里有 []
社区 10 map=有  摘要里有 []  map 里有 []
社区 11 map=有  摘要里有 ['90 天']  map 里有 ['90 天']
社区 12 map=有  摘要里有 ['90 天']  map 里有 ['90 天']
社区 13 map=有  摘要里有 []  map 里有 []
社区 14 map=有  摘要里有 []  map 里有 []
社区 15 map=无  摘要里有 []  map 里有 []
社区 16 map=无  摘要里有 ['1 小时']  map 里有 []
社区 17 map=有  摘要里有 []  map 里有 []
社区 18 map=有  摘要里有 []  map 里有 []
--- 19 次调用 | 输入 2539 / 输出 532 tokens | 约 ¥0.0091
```

社区 11、12 里的「90 天」是 kb-006 开票那条,不是数据保留那条。再查 `edges` 表:

```bash
sqlite3 part04/data/kg_llm.db "SELECT head, rel, tail FROM edges WHERE tail IN ('当天','到期前 3 天','90 天','1 小时','每天早上 8 点')"
```

```text
支付失败|时限|1 小时
汇率|时限|每天早上 8 点
电子普通发票红冲|时限|当天
自动续费|时限|到期前 3 天
超出免费版额度的数据|时限|90 天
```

五条全在图里。再用 networkx 看它们分进了哪个社区(我用 `louvain_communities` 同样的 `seed=42` 查的):「当天」「到期前 3 天」「超出免费版额度的数据—90 天」「汇率—每天早上 8 点」各自所在的社区都只有 2 个点,被 `len(g) >= 3` 扔掉了,根本没写摘要;「1 小时」所在的社区 16 有 3 个点,摘要里写了「该锁定持续 1 小时」,但 map 回答了「无」,死在 map 这一步。

所以五条里四条死在社区筛选,一条死在 map。同样是「漏了」,修法完全不同,这就是为什么要一步步查,而不是直接去改提示词。

</details>

**练习 2:把小社区捡回来。** 不再扔掉 2 个点的社区,把它们统一并成一个「零散事实」社区一起写摘要,重新跑 `kg_global_eval.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/kg_ex254_2.py  练习 2:小于 3 个点的社区不再扔掉,统一并成一个「零散事实」社区
import networkx as nx

from common.llm import LLMClient
from part04.kg_communities import SUMMARY_PROMPT
from part04.kg_graph import load_graph
from part04.kg_store import connect

G = load_graph()
client = LLMClient()
groups = nx.community.louvain_communities(nx.Graph(G.to_undirected()), seed=42)
big = [g for g in sorted(groups, key=len, reverse=True) if len(g) >= 3]
leftover: set[str] = set().union(*[g for g in groups if len(g) < 3])
print(f"大社区 {len(big)} 个,零散社区并进来 {len(leftover)} 个点")

last = ""
with connect() as conn:
    conn.execute("DROP TABLE IF EXISTS communities")
    conn.execute("CREATE TABLE communities (id INTEGER PRIMARY KEY, size INTEGER, summary TEXT)")
    for i, nodes in enumerate(big + [leftover]):
        facts = "\n".join(
            f"- {h} {d['rel']} {t}(原文:{d['evidence']})[{d['doc_id']}]"
            for h, t, d in G.subgraph(nodes).edges(data=True)
        )
        r = client.chat([{"role": "user", "content": SUMMARY_PROMPT.format(facts=facts)}], temperature=0)
        conn.execute("INSERT INTO communities VALUES (?, ?, ?)", (i, len(nodes), r.content))
        last = r.content
    print(f"写入 {len(big) + 1} 个社区摘要;最后一个(零散事实):")
    print(last)
print("---", client.ledger)
```

<div class="line-notes">

- `leftover: set[str] = set().union(*[g for g in groups if len(g) < 3])` 把所有小社区的点并成一个集合。`*` 把列表拆成多个参数传进 `union`,相当于 JS 的展开运算符 `...`。
- `for i, nodes in enumerate(big + [leftover]):` 大社区照旧,最后多一个「零散事实」社区。
- `G.subgraph(nodes).edges(data=True)` 零散社区内部的边就是那 10 条孤立的边,彼此不相连,但摘要不在乎连不连。
- `last = r.content` 记住最后一段摘要打印出来。先在循环外写 `last = ""`,否则类型检查会报 `"r" is possibly unbound`(groups 为空时循环一次都不执行)。我第一版就直接打印了 `r.content`,basedpyright 报了这个错。

</div>

```bash
uv run python -m part04.kg_ex254_2
uv run python -W ignore -m part04.kg_global_eval
```

```text
大社区 19 个,零散社区并进来 20 个点
写入 20 个社区摘要;最后一个(零散事实):
这组事实主要讲 API Key 每分钟最多 60 次请求的限制，以及团队邀请需先在「设置 → 团队」生成邀请链接 [kb-019][kb-015]。计费方面，升级按当前周期剩余天数折算补差价，降级在当前计费周期结束后生效且不退差价，月付套餐不支持中途退款 [kb-005][kb-002]。自动续费订阅会在到期前 3 天自动扣款，超出免费版额度的数据保留 90 天、补缴后恢复 [kb-004]。发票方面，所有付费订单都可开电子普通发票，红冲一般当天完成 [kb-006][kb-003]。此外，汇率每天早上 8 点更新 [kb-020]。
--- 20 次调用 | 输入 4091 / 输出 1416 tokens | 约 ¥0.0190
混合检索 top-4: 覆盖 5/20
  漏了: 重复扣款 3 个工作日内退回、客服主管 1 个工作日内审批、电子普通发票红冲当天完成、到期前 3 天自动扣款、付款后 90 天内申请发票、发票 1 到 2 个工作日开出、开具后 30 天内可红冲重开、连续支付失败锁定 1 小时、导出下载链接 7 天有效、邀请链接 7 天有效、人工审核 2 个工作日、注销 30 天冷静期、注销后数据 30 天永久删除、备份保留 30 天、汇率每天早上 8 点更新
20 个社区里有 11 个给出了内容
global search: 覆盖 18/20
  漏了: 连续支付失败锁定 1 小时、人工审核 2 个工作日
--- 22 次调用 | 输入 3805 / 输出 1666 tokens | 约 ¥0.0207
```

从 15/20 升到 18/20,四条被扔掉的规则全回来了。可「人工审核 2 个工作日」这次漏了,上一轮它是覆盖到的。我在改这个脚本的前后一共跑了三轮:第一轮 17/20,中间单独跑一次 `kg_global.py` 再打分是 20/20,最后这轮 18/20。每一轮社区摘要和 map、reduce 的措辞都会变一点,某条规则这次在、下次不在。

所以这个练习的结论有两层。一是小社区确实不该扔:把零散事实合并成一个社区,成本只多一次调用,覆盖稳定地多出三四条。二是 global search 的单次结果波动很大,评测至少要跑三五次看平均和最差,只跑一次就下结论,很可能是运气。

</details>

**练习 3:调 Louvain 的 resolution。** `louvain_communities` 有个 `resolution` 参数,默认 1。分别试 0.5、1.0、2.0,看社区数、3 个点以上的社区数、最大社区里有什么。不调模型。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/kg_ex254_3.py  练习 3:调 Louvain 的 resolution,看社区切粗还是切细
import networkx as nx

from part04.kg_graph import load_graph

simple = nx.Graph(load_graph().to_undirected())
for res in (0.5, 1.0, 2.0):
    groups = nx.community.louvain_communities(simple, resolution=res, seed=42)
    sizes = sorted((len(g) for g in groups), reverse=True)
    biggest = max(groups, key=len)
    print(f"resolution={res}: {len(groups)} 个社区,≥3 个点的 {sum(s >= 3 for s in sizes)} 个,最大 {sizes[0]} 个点")
    print("   最大社区里有:", "、".join(sorted(biggest)[:10]), "…" if len(biggest) > 10 else "")
```

<div class="line-notes">

- `groups = nx.community.louvain_communities(simple, resolution=res, seed=42)` `resolution` 小于 1 倾向于切出更少、更大的社区,大于 1 倾向于更多、更小的社区。
- `biggest = max(groups, key=len)` 最大的那个社区。
- `sum(s >= 3 for s in sizes)` 布尔值相加,`True` 算 1。数 3 个点以上的社区有几个,也就是第二步会给几个社区写摘要。

</div>

```text
resolution=0.5: 28 个社区,≥3 个点的 18 个,最大 23 个点
   最大社区里有: 1 个账本、1 名成员、1908 元、199 元、200 条流水、3 名成员、30 种货币、468 元、49 元、5 个账本 …
resolution=1.0: 29 个社区,≥3 个点的 19 个,最大 17 个点
   最大社区里有: 1908 元、199 元、3 名成员、30 种货币、468 元、49 元、5 个账本、专业版、专属客服、企业版 …
resolution=2.0: 31 个社区,≥3 个点的 21 个,最大 9 个点
   最大社区里有: 1 个工作日、1 到 3 个工作日、3 个工作日、3 到 7 个工作日、发票红冲、客服主管审批、按实际支付的金额退款、申请退款、退款 
```

resolution 从 0.5 到 2,社区数只从 28 变到 31,因为连通块就有 28 个,下限卡死了。变化主要发生在最大的那一团:0.5 时套餐价格和免费版额度合成了 23 个点的一大团,2.0 时套餐那团被拆开,最大的变成了退款流程。

社区切粗,一段摘要要概括的东西多,数字容易在摘要里丢;切细,社区多,global search 每次查询的调用就多。微软 GraphRAG 用 Leiden 切出好几层,查询时可以选在哪一层回答,就是为了在这两头之间留出选择。在这张很稀的小图上,resolution 影响有限,真正的限制是图本身太散。

</details>

**练习 4(开放题):估一下 1 万篇文章时的成本。** 用今天的实测数字,估算帮助中心涨到 1 万篇时,建图、社区摘要、一次 global search 各要多少钱,并提一个降低查询成本的办法。不用写代码。

<details><summary>参考答案</summary>

示范解法:按今天的比例线性外推,这是很粗的估算,真实情况取决于文章长度和社区结构。

```text
建图:20 篇 ¥0.041 → 1 万篇约 ¥0.041 × 500 ≈ ¥20
社区摘要:89 条边 19 个社区 ¥0.018;按边数等比例,1 万篇约 4.5 万条边、近 1 万个社区,约 ¥0.018 × 500 ≈ ¥9
一次 global search:19 个社区 ¥0.015;1 万个社区约 ¥0.015 × 500 ≈ ¥7.5,上万次调用
```

建图和摘要加起来三十块钱,一次性,可以接受。问题在查询:每问一个全局问题七块多钱、上万次调用,还没算 reduce 一次放不下要分层合并。办法有几个:一是像微软那样做多层社区,全局问题先在顶层(社区少、摘要粗)上回答;二是 map 之前先用问题的 embedding 在社区摘要上做一次检索,只让最相关的几十个社区去 map,这其实就是把 Day 240 的检索搬到社区摘要这一层;三是缓存常见全局问题的答案,文章更新时再失效。第二种最容易落地,代价是可能又漏掉不像问题的社区,要拿今天这种标准答案量一量。

</details>

验收标准:`kg_louvain.py`、`kg_communities.py`、两版 `kg_global.py`、`kg_global_eval.py` 都跑通;你能说出自己第一版 map 提示词有几个社区给出内容、第二版有几个,以及原因;能对着自己的 `kg_global_eval.py` 输出,至少查清一条漏掉的规则死在了哪一步。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| global search | 每个社区摘要各答一次(map),再合并(reduce),回答全局性问题 |
| 社区(community) | 图上的一团点,团内边多、团间边少 |
| 社区发现(community detection) | 只看边,自动把图切成社区的算法 |
| Louvain / Leiden | 最常用的两个社区发现算法,Leiden 是改进版,微软 GraphRAG 用它 |
| 模块度(modularity) | 社区内部的边比随机情况多出多少,Louvain 贪心地让它变大 |
| resolution | Louvain 的参数,小于 1 切得粗,大于 1 切得细 |
| 连通块(connected component) | 彼此有路相通的一团点,不同连通块之间没有边 |
| 社区摘要(community report) | 给每个社区写的一段总结,global search 的输入 |
| map-reduce | 先对每一块各做一次(map),再把结果合成一个(reduce) |
| 值节点 | 「7 天」「30 天」这种被当成实体的值,会把不相干的事实粘进同一个社区 |
| LazyGraphRAG | 微软提出的改进思路,建索引时不调大模型,把调用推迟到查询时 |

## 常见误区

**map 提示词照着普通问答写。** 「根据摘要回答问题,没有就说无」在全局问题上会让每个 map 都觉得自己答不了「所有」,今天 19 个社区全说无。map 一定要告诉模型它只负责一小块,把门槛从「能答」降到「沾边就列」。

**看清单很长就当它全对。** 第二版清单 20 条,打分只覆盖 15 条标准答案,还混进了「最多重试 3 次」这种不是时限的东西,以及摘要里模型自己推出来的「备份和删除都是 30 天」。全局回答一样要有标准答案。

**扔掉小社区。** 两个点的社区看着不值得总结,可今天五条漏掉的规则里有四条就在它们里面。并成一个零散社区,只多一次调用,覆盖从 15 升到 18。

**只跑一次就下结论。** 同样的代码我跑了三轮,覆盖分别是 17、20、18。global search 每一步都在调模型,波动叠在一起很大,评测至少跑几次看分布。

**以为社区摘要只是压缩,不会引入新内容。** 社区 17 的摘要写出了原文里没有的「因此备份保留期与数据删除时限均为 30 天」,最后原样进了答案。摘要提示词可以加一条「不要推出事实之间的联系」,但更根本的是别让值节点把不相干的事实粘在一起。

**以为 global search 建完索引就便宜了。** 建图和摘要是一次性的,但每次全局查询要跑「社区数 + 1」次调用。社区上千时,一个问题就是上千次调用。

**做 GraphRAG 第一步是部署 Neo4j。** 这三天遇到的问题全在抽取和检索策略上,和存储无关。先用 SQLite 或 Postgres 跑出评测数字,确认有收益再换。

## 学习资料

### 文档与文章

- [From Local to Global: A Graph RAG Approach to Query-Focused Summarization(arXiv 2404.16130)](https://arxiv.org/abs/2404.16130):微软 GraphRAG 论文。今天读社区检测、社区摘要和 global 查询那几节,再看第 3 节的评测方法:他们评的正是「全局总结类问题」,用的是让大模型两两比较答案的方式,1 小时。
- [Microsoft GraphRAG · Global Search](https://microsoft.github.io/graphrag/query/global_search/):官方的 map-reduce 说明,看 map 阶段的「要点 + 重要性打分」和社区层级的取舍,15 分钟。
- [Microsoft GraphRAG · Indexing Dataflow](https://microsoft.github.io/graphrag/index/default_dataflow/):建索引的完整流程,看社区摘要(community reports)在第几步、吃什么输入。
- [networkx · louvain_communities](https://networkx.org/documentation/stable/reference/algorithms/generated/networkx.algorithms.community.louvain.louvain_communities.html):今天用的函数,`resolution` 和 `seed` 两个参数的说明。
- [Fast unfolding of communities in large networks(arXiv 0803.0476)](https://arxiv.org/abs/0803.0476):Louvain 算法原论文,只读摘要和第 2 节的两步过程就够了。
- [From Louvain to Leiden(arXiv 1810.08473)](https://arxiv.org/abs/1810.08473):Leiden 论文,读摘要,知道 Louvain 会切出内部不连通的社区,Leiden 修了这个问题。
- LazyGraphRAG:微软研究院博客文章《LazyGraphRAG: Setting a new standard for quality and cost》,按标题搜索(微软官网对命令行请求返回 403,需要浏览器打开)。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1fYZaBAEKZ&autoplay=0&high_quality=1" title="【RAG】15分钟跑通GraphRAG完整流程：从知识图谱构建到Global和Local Search问答GraphRAG实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>认真工作的JIA · 15 分钟跑通 GraphRAG 完整流程:从知识图谱构建到 Global 和 Local Search 问答 · 16 分钟,用微软 GraphRAG 官方工具走一遍 init、index、query。三天自己写完再看,就知道框架替你做了哪几步。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/c5qJHr3DnT4" title="GraphRAG methods to create optimized LLM context windows for Retrieval — Jonathan Larson, Microsoft" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · Jonathan Larson(微软研究院 GraphRAG 团队)· GraphRAG methods to create optimized LLM context windows · 原作者讲为什么要做社区摘要、怎么评测全局问题,重点听他对成本和 LazyGraphRAG 的说法。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Xt0vBtBY2BU" title="Discovering Communities: Modularity & Louvain #SoMe3" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Splience · Discovering Communities: Modularity & Louvain · 英文,动画讲模块度和 Louvain 的两步过程,比读论文直观,开自动字幕。</figcaption>
</figure>

### 书籍

- Albert-László Barabási《Network Science》(Cambridge University Press,2016)。作者把全书放在 [networksciencebook.com](http://networksciencebook.com/chapter/9) 免费在线读,第 9 章「Communities」讲社区和模块度,配图很多,想弄懂 Louvain 在干什么就读这一章。
- Tomaž Bratanič、Oskar Hane《Essential GraphRAG》(Manning,2025)。讲微软 GraphRAG 流程的那一章,包括社区摘要和 global search 在 Neo4j 上怎么实现。目前没查到中译本。

### 开源项目与代码

- [microsoft/graphrag](https://github.com/microsoft/graphrag):社区报告和 global search 的提示词都在 `prompts/` 目录里,对比今天那句「你只负责一小块」,看官方是怎么写 map 的。
- [HKUDS/LightRAG](https://github.com/HKUDS/LightRAG):LightRAG 没有做社区摘要,global 模式用的是关系上的关键词检索,可以对比两种「全局」的思路。
- [neo4j/neo4j-graphrag-python](https://github.com/neo4j/neo4j-graphrag-python):Neo4j 官方包,想把图换到 Neo4j 时从这里开始。

## 自测

**1. 什么是图的社区?Louvain 凭什么判断一种切法好?**

<details><summary>答案</summary>

社区是一团点,团内部的边多,团之间的边少。Louvain 用模块度衡量切法:社区内部的边比随机情况下多出来的部分越大越好。它先让每个点各成一团,反复把点挪到邻居的团里,只要模块度变大就挪,挪不动了把每团缩成一个点再来一轮。

</details>

**2. 第一版 map 提示词为什么让 19 个社区全部回答「无」?怎么改的?**

<details><summary>答案</summary>

问题问的是「所有」带时间期限的规则,每个 map 只看到一小段摘要,模型判断自己答不了「所有」,就说无,连明明全是 7 天时限的社区 4 也一样。改法是明确告诉它「这段只是全部资料的一小块,别的部分由其他同事负责」,并把任务从「回答问题」改成「把有关的内容都列出来,一条都没有才说无」。有内容的社区从 0 个变成 11 个。

</details>

**3. 社区 4 里宽限期、导出链接、邀请链接为什么被分到一起?这会带来什么问题?**

<details><summary>答案</summary>

因为三条事实的尾实体都是「7 天」这个值,在图上它们都是「7 天」的邻居。值节点被很多事实共享,像一个假枢纽,把不相干的事实粘进同一个社区。后果是摘要要硬找联系,社区 17 就因为「30 天」写出了原文没有的「备份保留期与数据删除时限均为 30 天」,还进了最终答案。

</details>

**4. 今天 global search 漏掉的五条规则,分别死在了哪一步?**

<details><summary>答案</summary>

五条在 `edges` 表里都有。其中四条(红冲当天、到期前 3 天、数据保留 90 天、汇率 8 点)所在的社区只有 2 个点,被 `len(g) >= 3` 的筛选扔掉,没写摘要;「锁定 1 小时」所在的社区 16 摘要里写了,但 map 回答了「无」。把小社区并成一个零散社区以后,覆盖从 15/20 升到 18/20。

</details>

**5. 为什么说 global search 的成本问题在查询,而不在建图?**

<details><summary>答案</summary>

建图和社区摘要是一次性的;但每次全局查询都要让每个社区 map 一次,再 reduce 一次,调用次数是社区数加 1。今天 19 个社区一次查询约 ¥0.015,社区到上千个时一个问题就是上千次调用。降成本的办法有分层社区、先检索出相关社区再 map、缓存常见问题的答案。

</details>

**6.(面试题)面试官问:「GraphRAG 的 global search 是怎么工作的?你在什么场景下会用它?」请用两三分钟回答。**

<details><summary>答案</summary>

参考回答:建索引时先用大模型从文档里抽实体和关系建图,再用 Louvain 或 Leiden 把图切成社区,每个社区写一段摘要。查询时做 map-reduce:每段社区摘要各回答一次,丢掉说「无」的,再合并成一份答案。它解决的是 top-k 检索答不了的全局问题,比如「所有带时间期限的规则汇总成清单」。我在一个 20 篇的帮助中心上实测,20 条标准答案,混合检索 top-4 覆盖 5 条,global search 覆盖 15 条,把被丢弃的小社区合并回来后到 18 条。踩过几个坑:map 提示词不告诉模型它只是局部,会因为答不了「所有」而全部回答无,我们第一版 19 个社区 0 个有内容;值节点会把不相干的事实粘成一个社区,摘要会编出原文没有的联系;单次结果波动大,同样的代码三轮分别是 17、20、18,评测要多跑几次。成本上每次查询是社区数加 1 次调用,社区多了要分层或先检索社区。所以我只在全局总结类问题确实常见、评测证明检索掉分的时候用它,其余问题照旧走混合检索。

</details>

## 明天预告

Day 255 · RAG 评估(一):为什么分两层。今天最后一步,我们给 global search 列了 20 条标准答案、写正则打分,还发现同样的代码三轮结果是 17、20、18。这三天每一个结论(6/9 对 8/9、5/20 对 15/20)都靠评测撑着,可评测本身怎么做才可信,一直没正经讲过。明天开始用七天把 RAG 评估讲透,第一天先把问题拆成两层:检索找没找对,和生成答没答对,两层分开量,才知道该修哪一层。
