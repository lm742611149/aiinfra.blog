---
title: 'Day 250 · 知识图谱三分钟入门:实体、关系和三元组'
description: '向量检索擅长「找一段像的话」,不擅长「哪些东西仅限企业版」这种枚举题和要跨两三篇文章的多跳题。今天不调模型,手写 16 条 CloudLedger 三元组,用列表、邻接表和 SQLite 各查一遍,顺便看清楚边的方向写反了会漏掉什么。'
pubDate: 2026-10-22
regime: none
tags: ['knowledge-graph', 'rag', 'sqlite', 'agent-zero']
series: 'agent-zero'
day: 250
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 249](/blog/agent-zero/day-249-rlm/) 用 2000 张工单做了个实验:整份塞进 prompt 让模型数数,22 答成了 8;换成 RLM,让模型在 REPL 里写代码筛选,答对了。那一课的问题有个共同点,答案散在全文各处,要「数」和「枚举」。

RLM 的办法是查询时现场写代码。今天看另一条老路:事先把资料里的事实拆成「谁和谁是什么关系」,存成一张图,问的时候沿着关系去查。这就是知识图谱。今天只讲最基础的两件事:三元组是什么,以及怎么沿着边走。不调模型,一分钱不花。

## 今天要解决的问题

学完你应该能做到:

1. 说出向量检索在哪三类问题上吃亏,各举一个 CloudLedger 的例子。
2. 说清楚实体、关系、三元组是什么,能把帮助中心里的一句话手工写成三元组,并且方向写对。
3. 用 Python 列表、邻接表(dict)和 SQLite 三种方式存同一张小图,分别回答一个枚举问题和一个多跳问题。

预计用时 2 小时。花费 ¥0。

前置:[Day 222](/blog/agent-zero/day-222-kb-data/) 造的帮助中心 `data/kb/`(20 篇 CloudLedger 文章,今天只读不改),[Day 226](/blog/agent-zero/day-226-retrieve-answer/) 的 top-k 检索,[Day 24](/blog/agent-zero/day-024-dicts/) 的字典、[Day 22](/blog/agent-zero/day-022-tuples-unpack/) 的元组和解包,[Day 85](/blog/agent-zero/day-085-sql-1/) 和 [Day 87](/blog/agent-zero/day-087-sql-3/) 的 SQLite 与 JOIN。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `kg_triples.py` 的 `find()` 和 `kg_hops.py` 的 `walk()`;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 向量检索答不好的三类问题

回忆一下 Day 224 到 Day 240 搭的检索:文章切成块,每块变成一个向量,问题也变成向量,找最近的几块。它默认了一个前提:**答案集中在少数几块里,而且这几块和问题长得像**。下面三类问题都不满足这个前提。

第一类是多跳问题(multi-hop)。「报 E4029 的客户,年付一年多少钱?」要先知道 E4029 是开放 API 的限流错误(kb-019),开放 API 只有企业版能用(也在 kb-019),再去查企业版年付价格(kb-001)。kb-001 里根本没有「E4029」这几个字,和问题一点都不像,向量检索很难把它捞上来。所谓「跳」,就是从一个事实走到下一个事实。

第二类是枚举问题。「哪些功能只有企业版才有?」开放 API 写在 kb-019,备份恢复写在 kb-018。向量检索给你 top-4,漏一个你根本不知道漏了。换成关键词搜也不行,我在 `agent-zero-lab/` 下搜一下「仅限」和「仅对」:

```bash
grep -n '仅限\|仅对' data/kb/*.md
```

```text
data/kb/kb-006.md:10:所有付费订单都可以开电子普通发票。增值税专用发票仅限企业版,或年付的专业版。
data/kb/kb-019.md:10:开放 API 仅对企业版开放。在「设置 → 开发者」创建 API Key。
```

两条结果,一条是错的,还漏了一条。kb-006 虽然写着「仅限企业版」,后面紧跟着「或年付的专业版」,所以专票并不是企业版独有。kb-018 说的是「企业版客户误删数据后,可以申请从备份恢复……其他套餐不提供备份恢复服务」,意思就是仅限企业版,可是一个「仅限」都没写。直接搜「企业版」更糟,20 篇里有 9 篇提到它(kb-001、002、006、008、014、015、018、019、020),你得一篇篇读。

第三类是全局问题。「帮助中心里所有带时间期限的规则,汇总成一张清单。」答案遍布全部 20 篇,任何 top-k 都装不下,而且问题本身和每一块都不怎么像。这一类今天只提一句,[Day 254](/blog/agent-zero/day-254-graphrag-global/) 讲 global search 时专门解决。

知识图谱的思路是:先把文章里的事实拆成「谁和谁是什么关系」,存成一张图。多跳问题沿着边走过去,枚举问题按关系类型查。代价是建图要花功夫、会出错,而且图里只剩下关系,原文里的细节(比如「每次收费 500 元」)要么另外存,要么就丢了。

## 实体、关系、三元组

知识图谱(knowledge graph)说白了就是一堆三元组。三元组(triple)是三个东西排成一排:(头实体,关系,尾实体)。

- 实体(entity)是一个「东西」:一个套餐、一个功能、一个错误码、一个金额。在图里它是一个点,也叫节点(node)。
- 关系(relation)是两个实体之间有名字的联系,比如「仅限」「包含」「发生在」。在图里它是一条有方向的线,也叫边(edge)。
- 头实体(head)是边的起点,尾实体(tail)是边的终点。

kb-019 的那句「开放 API 仅对企业版开放」,写成三元组是 (开放 API,仅限,企业版)。从左往右读就是原句的意思:开放 API 仅限企业版。

用前端的东西打个比方。一个三元组很像 JS 里的一条记录 `{ head: "开放 API", rel: "仅限", tail: "企业版" }`,一张图就是这种记录组成的数组。你在 React 里画过组件树,组件树是一种特殊的图(每个节点只有一个父节点);知识图谱更自由,一个点可以连很多条边,也可以绕回来。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="CloudLedger 知识图谱的一小块:企业版节点周围的仅限、包含、可开给、不适用于关系,每条边写着来源文章编号,箭头从头实体指向尾实体">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
<defs><marker id="kg250a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--ink-soft)"/></marker></defs>
<g font-family="var(--font-mono)" font-size="12">
<rect x="262" y="110" width="116" height="36" rx="18" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="133" fill="var(--ink)" text-anchor="middle">企业版</text>
<rect x="30" y="30" width="120" height="32" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="90" y="51" fill="var(--ink)" text-anchor="middle">开放 API</text>
<rect x="30" y="196" width="120" height="32" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="90" y="217" fill="var(--ink)" text-anchor="middle">备份恢复</text>
<rect x="490" y="30" width="130" height="32" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="555" y="51" fill="var(--ink)" text-anchor="middle">增值税专用发票</text>
<rect x="490" y="196" width="130" height="32" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="555" y="217" fill="var(--ink)" text-anchor="middle">优惠码</text>
<line x1="150" y1="52" x2="262" y2="118" stroke="var(--ink-soft)" marker-end="url(#kg250a)"/>
<text x="150" y="96" fill="var(--ink-soft)">仅限 [kb-019]</text>
<line x1="150" y1="206" x2="262" y2="140" stroke="var(--ink-soft)" marker-end="url(#kg250a)"/>
<text x="150" y="168" fill="var(--ink-soft)">仅限 [kb-018]</text>
<line x1="490" y1="52" x2="378" y2="118" stroke="var(--ink-soft)" marker-end="url(#kg250a)"/>
<text x="398" y="96" fill="var(--ink-soft)">可开给 [kb-006]</text>
<line x1="490" y1="206" x2="378" y2="140" stroke="var(--ink-soft)" marker-end="url(#kg250a)"/>
<text x="388" y="168" fill="var(--ink-soft)">不适用于 [kb-008]</text>
<text x="320" y="250" fill="var(--ink-faint)" text-anchor="middle" font-size="11">箭头从头实体指向尾实体;每条边记着出自哪篇文章</text>
</g>
</svg>
<figcaption>今天手写的图里,指向「企业版」的四条边。蓝色是被问到的中心实体,琥珀色是它的邻居。「仅限」和「不适用于」意思正好相反,但都连在同一个点上。</figcaption>
</figure>

和关系数据库比,图的长处是「走几步」很顺手。和向量比,图的长处是关系有名字。「仅限企业版」和「不适用于企业版」两句话,向量看着几乎一样(都在讲企业版和某个功能),意思却相反;在图里它们是两种不同的边,查的时候一个字都不会混。

顺便分清两个容易混的词。知识图谱是数据结构,几十年前就有,以前靠人工或者规则来建,谷歌 2012 年把它用在搜索结果右边的信息卡片上,这个名字才流行起来。GraphRAG 是 2024 年微软一篇论文带火的说法,指用大模型自动从文本里抽三元组建图,再拿图去增强 RAG。今天手写,是知识图谱;后天让模型抽,才是 GraphRAG。

## 第一步:三元组就是一个列表

新建 `agent-zero-lab/part04/kg_triples.py`。我对着 `data/kb/` 里的文章,手写了 16 条三元组,每条多带一个第四项:出处。出处不是三元组的必需部分,但做 RAG 一定要有,回答时得能告诉用户「这条出自哪篇」。

```python
# agent-zero-lab/part04/kg_triples.py  手写一小张 CloudLedger 知识图谱:每条是 (头实体, 关系, 尾实体, 出处)
Triple = tuple[str, str, str, str]

TRIPLES: list[Triple] = [
    ("企业版", "年付价格", "1908 元", "kb-001"),
    ("专业版", "年付价格", "468 元", "kb-001"),
    ("企业版", "包含", "开放 API", "kb-001"),
    ("企业版", "包含", "专属客服", "kb-001"),
    ("企业版", "包含", "增值税专用发票", "kb-001"),
    ("开放 API", "仅限", "企业版", "kb-019"),
    ("备份恢复", "仅限", "企业版", "kb-018"),
    ("增值税专用发票", "可开给", "企业版", "kb-006"),
    ("增值税专用发票", "可开给", "年付专业版", "kb-006"),
    ("优惠码", "不适用于", "企业版", "kb-008"),
    ("退款", "需要先", "发票红冲", "kb-003"),
    ("退款", "需要", "客服主管审批", "kb-002"),
    ("月付套餐", "不支持", "中途退款", "kb-002"),
    ("E1043", "发生在", "导入银行流水", "kb-011"),
    ("E1042", "发生在", "导入银行流水", "kb-010"),
    ("E4029", "发生在", "开放 API", "kb-019"),
]


def find(head: str | None = None, rel: str | None = None, tail: str | None = None) -> list[Triple]:
    return [
        t for t in TRIPLES
        if (head is None or t[0] == head) and (rel is None or t[1] == rel) and (tail is None or t[2] == tail)
    ]


if __name__ == "__main__":
    print(f"一共 {len(TRIPLES)} 条三元组,{len({t[0] for t in TRIPLES} | {t[2] for t in TRIPLES})} 个实体,"
          f"{len({t[1] for t in TRIPLES})} 种关系")
    print("问:哪些东西仅限企业版?")
    for h, r, t, src in find(rel="仅限", tail="企业版"):
        print(f"  ({h}, {r}, {t})  出处 {src}")
    print("问:企业版周围有哪些边?")
    for h, r, t, src in find(head="企业版") + find(tail="企业版"):
        print(f"  ({h}, {r}, {t})")
```

<div class="line-notes">

- `Triple = tuple[str, str, str, str]` 类型别名,给「四个字符串组成的元组」起个名字,后面少写几遍。相当于 TS 里的 `type Triple = [string, string, string, string]`。
- `TRIPLES: list[Triple] = [` 整张图就是一个列表。元组用圆括号,和列表的区别是不能改(Day 22),一条事实写进去就不该被悄悄修改。
- `("企业版", "年付价格", "1908 元", "kb-001"),` 尾实体也可以是一个值(金额、日期),不一定是「东西」。
- `("企业版", "包含", "开放 API", "kb-001"),` kb-001 只说企业版「包含」开放 API,没说别的套餐没有。所以这里用「包含」,不用「仅限」。
- `("开放 API", "仅限", "企业版", "kb-019"),` 「仅限」的意思是 kb-019 那句「仅对企业版开放」给出来的。同一对实体之间,两篇文章给了两条不同的边。
- `("备份恢复", "仅限", "企业版", "kb-018"),` 原文没写「仅限」二字,是我读了「其他套餐不提供」之后归纳的。人工建图时这一步靠理解;后天换成模型抽,它也要做这种归纳,也可能归纳错。
- `("增值税专用发票", "可开给", "企业版", "kb-006"),` kb-006 那句「仅限企业版,或年付的专业版」拆成了两条「可开给」,没用「仅限」。这就是上面 grep 把它当成「仅限企业版」的错。
- `def find(head: str | None = None, rel: str | None = None, tail: str | None = None) -> list[Triple]:` 三个参数都可以不填,不填就是「这一位随便」。这是图查询里最基本的模式匹配。
- `if (head is None or t[0] == head) and (rel is None or t[1] == rel)` 每一位要么没指定,要么相等。`t[0]` 是头,`t[1]` 是关系,`t[2]` 是尾。
- `len({t[0] for t in TRIPLES} | {t[2] for t in TRIPLES})` 两个集合推导式取并集(`|`,Day 25),头和尾里出现过的都算实体,一共 19 个。
- `for h, r, t, src in find(rel="仅限", tail="企业版"):` 枚举问题:关系是「仅限」、尾是「企业版」的所有边。解包成四个变量(Day 22)。
- `for h, r, t, src in find(head="企业版") + find(tail="企业版"):` 一个点周围的边分两种:从它出发的(它是头)和指向它的(它是尾),两个列表用 `+` 拼起来。

</div>

在 `agent-zero-lab/` 下跑:

```bash
uv run python -m part04.kg_triples
```

```text
一共 16 条三元组,19 个实体,9 种关系
问:哪些东西仅限企业版?
  (开放 API, 仅限, 企业版)  出处 kb-019
  (备份恢复, 仅限, 企业版)  出处 kb-018
问:企业版周围有哪些边?
  (企业版, 年付价格, 1908 元)
  (企业版, 包含, 开放 API)
  (企业版, 包含, 专属客服)
  (企业版, 包含, 增值税专用发票)
  (开放 API, 仅限, 企业版)
  (备份恢复, 仅限, 企业版)
  (增值税专用发票, 可开给, 企业版)
  (优惠码, 不适用于, 企业版)
```

枚举问题答出来了,两条,都对,而且带着出处。对比一下前面 grep 的结果(一错一漏),区别在于:grep 匹配的是字,`find` 匹配的是建图时就整理好的关系。**图的准确率不来自查询,来自建图。** 我手写的时候读懂了 kb-006 和 kb-018,图才是对的。

「专属客服」没出现在「仅限」里,对不对?kb-001 只说企业版包含专属客服,没说专业版没有。按原文就是不能断定它「仅限」。如果你觉得应该算,那是你在补原文没写的信息,建图时最好别这样做。

## 第二步:沿着边走,回答多跳问题

列表能查一步。多跳问题要连着走好几步,每走一步都扫一遍整个列表太慢,换一种存法:邻接表(adjacency list)。就是一个 dict,键是实体,值是从它出发的所有边。相当于 JS 里的 `Map<string, Array<[rel, tail, src]>>`。

```python
# agent-zero-lab/part04/kg_hops.py  把三元组变成「邻接表」,从一个实体出发沿边走几步
from collections import defaultdict, deque

from part04.kg_triples import TRIPLES

out_edges: dict[str, list[tuple[str, str, str]]] = defaultdict(list)
for h, r, t, src in TRIPLES:
    out_edges[h].append((r, t, src))


def walk(start: str, max_hops: int) -> list[list[str]]:
    paths: list[list[str]] = []
    queue: deque[tuple[str, list[str], int]] = deque([(start, [start], 0)])
    seen = {start}
    while queue:
        node, path, hops = queue.popleft()
        if hops == max_hops:
            continue
        for r, t, src in out_edges[node]:
            if t in seen:
                continue
            seen.add(t)
            new_path = path + [f"-{r}[{src}]->", t]
            paths.append(new_path)
            queue.append((t, new_path, hops + 1))
    return paths


if __name__ == "__main__":
    print("企业版的出边:", out_edges["企业版"])
    print("从 E4029 出发,最多走 3 步:")
    for p in walk("E4029", 3):
        print(f"  {(len(p) - 1) // 2} 步  " + " ".join(p))
```

<div class="line-notes">

- `from collections import defaultdict, deque` 两个新工具。`defaultdict(list)` 是「访问不存在的键时自动给一个空列表」的 dict,省得每次先判断键在不在;`deque` 是两头都能快速进出的队列,相当于 JS 里用数组做队列时的 `push` 加 `shift`,但 `shift` 要挪整个数组,`deque.popleft()` 不用。
- `out_edges: dict[str, list[tuple[str, str, str]]] = defaultdict(list)` 每个实体对应一个「出边」列表,每条出边是 (关系, 尾, 出处)。
- `out_edges[h].append((r, t, src))` 第一次遇到「企业版」时自动建空列表再追加。跑完以后 `out_edges["企业版"]` 有 4 条。
- `def walk(start: str, max_hops: int) -> list[list[str]]:` 从 `start` 出发,最多走 `max_hops` 步,返回所有走到的路径。
- `queue: deque[tuple[str, list[str], int]] = deque([(start, [start], 0)])` 队列里每一项是 (当前所在的点, 走到这里的路径, 已经走了几步)。一开始只有起点,0 步。
- `seen = {start}` 记住走过的点。不记的话,图里有环(企业版→开放 API→企业版)就会转圈。
- `node, path, hops = queue.popleft()` 从队头取一个。先进先出,所以总是先把 1 步能到的都走完,再走 2 步的。这种走法叫广度优先搜索(BFS)。
- `if hops == max_hops:` 步数用完了,这个点不再往外走。
- `for r, t, src in out_edges[node]:` 看这个点的每条出边。只沿出边走,也就是只顺着箭头方向走。
- `new_path = path + [f"-{r}[{src}]->", t]` 路径是「点、边、点、边、点」交替的列表,边上写着关系和出处,打印出来就是一条可读的推理链。
- `print(f"  {(len(p) - 1) // 2} 步  " + " ".join(p))` 路径长度减 1 再整除 2 就是步数:`[E4029, 边, 开放 API]` 长 3,是 1 步。

</div>

```bash
uv run python -m part04.kg_hops
```

```text
企业版的出边: [('年付价格', '1908 元', 'kb-001'), ('包含', '开放 API', 'kb-001'), ('包含', '专属客服', 'kb-001'), ('包含', '增值税专用发票', 'kb-001')]
从 E4029 出发,最多走 3 步:
  1 步  E4029 -发生在[kb-019]-> 开放 API
  2 步  E4029 -发生在[kb-019]-> 开放 API -仅限[kb-019]-> 企业版
  3 步  E4029 -发生在[kb-019]-> 开放 API -仅限[kb-019]-> 企业版 -年付价格[kb-001]-> 1908 元
  3 步  E4029 -发生在[kb-019]-> 开放 API -仅限[kb-019]-> 企业版 -包含[kb-001]-> 专属客服
  3 步  E4029 -发生在[kb-019]-> 开放 API -仅限[kb-019]-> 企业版 -包含[kb-001]-> 增值税专用发票
```

第三行就是「报 E4029 的客户年付多少钱」的答案:1908 元,推理链和出处一条不少,跨了 kb-019 和 kb-001 两篇文章。真实的 GraphRAG 做法(后天的 local search)是把这几条路径连同原文一起交给大模型,让它写成一句人话。

注意「企业版 -包含-> 开放 API」这条边没有出现:开放 API 已经在 `seen` 里了,不会再走回去。还有两条 3 步的路径(专属客服、专票)和问题无关,图只负责「把可能相关的都找出来」,挑哪条用来回答,还是要模型或者规则来做。

<figure>
<svg viewBox="0 0 640 170" role="img" aria-label="多跳问题的路径:E4029 发生在开放 API,开放 API 仅限企业版,企业版年付价格 1908 元,三条边分别来自 kb-019 和 kb-001">
<rect x="0" y="0" width="640" height="170" fill="var(--paper-raised)"/>
<defs><marker id="kg250b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--ink-soft)"/></marker></defs>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="60" width="96" height="36" rx="18" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="64" y="83" fill="var(--ink)" text-anchor="middle">E4029</text>
<rect x="180" y="60" width="110" height="36" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="235" y="83" fill="var(--ink)" text-anchor="middle">开放 API</text>
<rect x="358" y="60" width="100" height="36" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="408" y="83" fill="var(--ink)" text-anchor="middle">企业版</text>
<rect x="526" y="60" width="100" height="36" rx="18" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="576" y="83" fill="var(--ink)" text-anchor="middle">1908 元</text>
<line x1="112" y1="78" x2="178" y2="78" stroke="var(--ink-soft)" marker-end="url(#kg250b)"/>
<text x="145" y="52" fill="var(--ink-soft)" text-anchor="middle" font-size="11">发生在</text>
<line x1="290" y1="78" x2="356" y2="78" stroke="var(--ink-soft)" marker-end="url(#kg250b)"/>
<text x="323" y="52" fill="var(--ink-soft)" text-anchor="middle" font-size="11">仅限</text>
<line x1="458" y1="78" x2="524" y2="78" stroke="var(--ink-soft)" marker-end="url(#kg250b)"/>
<text x="491" y="52" fill="var(--ink-soft)" text-anchor="middle" font-size="11">年付价格</text>
<text x="235" y="124" fill="var(--ink-faint)" text-anchor="middle" font-size="11">kb-019</text>
<text x="408" y="124" fill="var(--ink-faint)" text-anchor="middle" font-size="11">kb-019 → kb-001</text>
<text x="320" y="154" fill="var(--ink-faint)" text-anchor="middle" font-size="11">问题里只有 E4029,答案在一篇不提 E4029 的文章里</text>
</g>
</svg>
<figcaption>三步走到答案。向量检索按「和问题像不像」找,kb-001 和问题不像;图按「和问题里的实体连不连得上」找,能连上就能找到。</figcaption>
</figure>

## 第三步:方向写反会怎样

边是有方向的。(开放 API,仅限,企业版)和(企业版,仅限,开放 API)是两个意思:前一个是「开放 API 只给企业版用」,后一个读出来是「企业版只能用开放 API」。后者显然不对。人手写时很少犯这个错,但后天让大模型抽三元组时,方向写反是最常见的错误之一。先故意写反一条,看后果。

```python
# agent-zero-lab/part04/kg_direction.py  故意把一条边写反,看查询漏掉什么
from part04.kg_triples import TRIPLES, Triple

wrong: list[Triple] = [t for t in TRIPLES if t[0] != "备份恢复"]
wrong.append(("企业版", "仅限", "备份恢复", "kb-018"))  # 头尾写反了

right_answer = [t[0] for t in TRIPLES if t[1] == "仅限" and t[2] == "企业版"]
wrong_answer = [t[0] for t in wrong if t[1] == "仅限" and t[2] == "企业版"]
print("方向正确时,仅限企业版的:", right_answer)
print("写反一条后,仅限企业版的:", wrong_answer)
print("写反的那条读出来是:", [f"{h}{r}{t}" for h, r, t, _ in wrong if h == "企业版" and r == "仅限"])
```

<div class="line-notes">

- `wrong: list[Triple] = [t for t in TRIPLES if t[0] != "备份恢复"]` 复制一份图,去掉头是「备份恢复」的那条正确的边。
- `wrong.append(("企业版", "仅限", "备份恢复", "kb-018"))` 换成头尾颠倒的版本。
- `right_answer = [t[0] for t in TRIPLES if t[1] == "仅限" and t[2] == "企业版"]` 和 `find(rel="仅限", tail="企业版")` 一样,只取头实体。
- `print("写反的那条读出来是:", [f"{h}{r}{t}" for h, r, t, _ in wrong` 把三元组按顺序念出来。`_` 是不用的变量的惯用名(这里是出处)。

</div>

```bash
uv run python -m part04.kg_direction
```

```text
方向正确时,仅限企业版的: ['开放 API', '备份恢复']
写反一条后,仅限企业版的: ['开放 API']
写反的那条读出来是: ['企业版仅限备份恢复']
```

一条边写反,枚举就漏了一项,而且没有任何报错。这和 Day 249 里「长上下文数错了也不告诉你」是同一种危险。检查方向最简单的办法就是最后一行那样,把三元组从左往右念一遍,念出来是人话就对了。练习 4 会让你给图加一条自动检查。

## 第四步:存进 SQLite

列表和 dict 都在内存里,程序一停就没了。存下来最省事的是 SQLite:一张四列的表就是一张图。这一步没有新概念,全是 Day 85 到 Day 92 学过的 SQL,只是换个角度看:**每一行是一条边。**

```python
# agent-zero-lab/part04/kg_sqlite.py  三元组存进 SQLite:一张表就是一张图
import sqlite3
from pathlib import Path

from part04.kg_triples import TRIPLES

DB = Path("part04/data/kg.db")
DB.unlink(missing_ok=True)
conn = sqlite3.connect(DB)
conn.execute("CREATE TABLE triples (head TEXT, rel TEXT, tail TEXT, source TEXT)")
conn.executemany("INSERT INTO triples VALUES (?, ?, ?, ?)", TRIPLES)
conn.commit()

print("一步:仅限企业版的")
for row in conn.execute("SELECT head, source FROM triples WHERE rel = '仅限' AND tail = '企业版'"):
    print("  ", row)

print("两步:E4029 走两步能到哪")
sql = """
SELECT a.head, a.rel, a.tail, b.rel, b.tail
FROM triples AS a
JOIN triples AS b ON b.head = a.tail
WHERE a.head = 'E4029'
"""
for row in conn.execute(sql):
    print("  ", row)
conn.close()
```

<div class="line-notes">

- `DB.unlink(missing_ok=True)` 每次跑先删掉旧库,保证结果可重复。`missing_ok=True` 是文件不存在也不报错。
- `conn.execute("CREATE TABLE triples (head TEXT, rel TEXT, tail TEXT, source TEXT)")` 四列,和元组的四项一一对应。
- `conn.executemany("INSERT INTO triples VALUES (?, ?, ?, ?)", TRIPLES)` 一次插入 16 行。`?` 是参数占位符,Day 92 讲过为什么不能拼字符串。
- `SELECT head, source FROM triples WHERE rel = '仅限' AND tail = '企业版'` 和 `find(rel="仅限", tail="企业版")` 完全等价,一步查询就是一个 WHERE。
- `FROM triples AS a` 同一张表起两个别名 a 和 b,当成两张表用。这叫自连接(self join)。
- `JOIN triples AS b ON b.head = a.tail` 关键一行:第二条边的头,等于第一条边的尾。也就是「走到 a 的终点,再从那里出发走 b」。
- `WHERE a.head = 'E4029'` 第一步从 E4029 出发。

</div>

```bash
uv run python -m part04.kg_sqlite
```

```text
一步:仅限企业版的
   ('开放 API', 'kb-019')
   ('备份恢复', 'kb-018')
两步:E4029 走两步能到哪
   ('E4029', '发生在', '开放 API', '仅限', '企业版')
```

两步就要一次自连接,三步要两次(练习 3),跳数不固定(「走到哪算哪」)时 SQL 就很难写了,要用递归查询 `WITH RECURSIVE`,可读性很差。这就是图数据库存在的理由。Neo4j 是最常见的图数据库,它的查询语言 Cypher 里,两步写成 `MATCH (a {name:'E4029'})-[*1..2]->(x) RETURN x`,箭头直接画在查询里,跳数写成 `*1..2`。这一句我没有实跑,本机没装 Neo4j,只是给你看看长什么样。

小知识库用不着图数据库。CloudLedger 这种几十篇文章、几百条三元组的规模,SQLite 或者 Postgres 一张表加 Python 里的邻接表完全够用。存储选型 Day 254 前后再细说。

## 动手练习

**练习 1:补上 kb-020 的多币种记账,再问「专业版能用什么」。** 读 `data/kb/kb-020.md`,手写两到三条三元组加进图里,然后列出所有和「专业版」或「年付专业版」相连的边。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/kg_ex1.py  练习 1:补上 kb-020 多币种记账,再问「专业版能用什么」
from part04.kg_triples import TRIPLES, Triple

more: list[Triple] = [
    ("多币种记账", "可用于", "专业版", "kb-020"),
    ("多币种记账", "可用于", "企业版", "kb-020"),
    ("汇率", "更新时间", "每天早上 8 点", "kb-020"),
]
graph = TRIPLES + more
print(f"现在 {len(graph)} 条")
for h, r, t, src in graph:
    if t in ("专业版", "年付专业版") or h == "专业版":
        print(f"  ({h}, {r}, {t})  {src}")
```

<div class="line-notes">

- `("多币种记账", "可用于", "专业版", "kb-020"),` kb-020 原文「专业版和企业版支持多币种记账」,拆成两条,和 kb-006 的专票拆法一样。
- `("汇率", "更新时间", "每天早上 8 点", "kb-020"),` 同一篇里的另一个事实,和套餐无关,但下次有人问「汇率多久更新」就能直接查到。
- `graph = TRIPLES + more` 不改原来的 `TRIPLES`,拼出一个新列表。
- `if t in ("专业版", "年付专业版") or h == "专业版":` 「年付专业版」和「专业版」在图里是两个实体。这是建图时的一个取舍,见下面的解释。

</div>

```text
现在 19 条
  (专业版, 年付价格, 468 元)  kb-001
  (增值税专用发票, 可开给, 年付专业版)  kb-006
  (多币种记账, 可用于, 专业版)  kb-020
```

三条都找到了,但「年付专业版」要单独写进判断条件,否则专票那条就漏了。这暴露了一个真实问题:同一个东西在图里有两个名字(或者一个是另一个的子类),查询就会漏。真实系统里有两种处理:建图时加一条 (年付专业版,属于,专业版),查询时顺着「属于」多走一步;或者在抽取后做实体合并(entity resolution),把同义的实体并成一个。后天让模型抽时你会看到更多这种情况,比如「专票」「增值税专用发票」「增值税专票」被抽成三个点。

</details>

**练习 2:反着走。** `kg_hops.py` 只顺着箭头走。写一个 `walk_back(target, max_hops)`,沿着箭头的反方向走,回答「哪些东西直接或间接指向企业版」。先不处理环,跑一次,观察输出里有什么奇怪的行。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/kg_ex2.py  练习 2:反着走,谁指向了企业版,谁又指向了它们
from collections import defaultdict

from part04.kg_triples import TRIPLES

in_edges: dict[str, list[tuple[str, str]]] = defaultdict(list)
for h, r, t, _src in TRIPLES:
    in_edges[t].append((h, r))


def walk_back(target: str, max_hops: int) -> list[str]:
    found: list[str] = []
    frontier = [(target, target)]
    for hop in range(1, max_hops + 1):
        nxt: list[tuple[str, str]] = []
        for node, chain in frontier:
            for h, r in in_edges[node]:
                line = f"{h} -{r}-> {chain}"
                found.append(f"{hop} 步  {line}")
                nxt.append((h, line))
        frontier = nxt
    return found


for line in walk_back("企业版", 2):
    print(line)
```

<div class="line-notes">

- `in_edges: dict[str, list[tuple[str, str]]] = defaultdict(list)` 入边表:键是尾实体,值是所有指向它的 (头, 关系)。和出边表正好反过来。
- `in_edges[t].append((h, r))` 用尾当键。
- `frontier = [(target, target)]` 这次换一种写法:不用队列,按「一圈一圈」往外扩。`frontier` 是当前这一圈的点,每个点带着从它到目标的那串文字。
- `for hop in range(1, max_hops + 1):` 第 1 圈、第 2 圈。
- `line = f"{h} -{r}-> {chain}"` 把新的一步加在链条左边,读起来还是顺着箭头。
- `frontier = nxt` 下一圈从这一圈新找到的点开始。这里没有 `seen`,故意的。

</div>

```text
1 步  开放 API -仅限-> 企业版
1 步  备份恢复 -仅限-> 企业版
1 步  增值税专用发票 -可开给-> 企业版
1 步  优惠码 -不适用于-> 企业版
2 步  企业版 -包含-> 开放 API -仅限-> 企业版
2 步  E4029 -发生在-> 开放 API -仅限-> 企业版
2 步  企业版 -包含-> 增值税专用发票 -可开给-> 企业版
```

奇怪的是第 5 行和第 7 行:从企业版出发绕一圈又回到企业版。图里有环(企业版包含开放 API,开放 API 又仅限企业版),不检查就会走回起点;步数再多一点,还会一直绕下去。改法是走到起点时跳过。在 `for h, r in in_edges[node]:` 下面加两行:

```python
# agent-zero-lab/part04/kg_ex2_fixed.py  练习 2 改进版:反着走并跳过环(只列出改动的三行)
            for h, r in in_edges[node]:
                if h == target:  # 绕回起点的是环,跳过
                    continue
```

<div class="line-notes">

- `if h == target:  # 绕回起点的是环,跳过` 只挡住「回到起点」这一种环。更彻底的做法和 `kg_hops.py` 一样,用一个 `seen` 集合记住所有走过的点。

</div>

改完再跑:

```text
1 步  开放 API -仅限-> 企业版
1 步  备份恢复 -仅限-> 企业版
1 步  增值税专用发票 -可开给-> 企业版
1 步  优惠码 -不适用于-> 企业版
2 步  E4029 -发生在-> 开放 API -仅限-> 企业版
```

另外注意结果里「优惠码 -不适用于-> 企业版」也算「指向企业版」。反着走只管连没连上,不管关系是正是负。回答问题时要按关系类型过滤。

</details>

**练习 3:SQL 走三步。** 在 `kg.db` 上写一条 SQL,从 E4029 出发走三步,只要最后一步关系是「年付价格」的结果。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/kg_ex3.py  练习 3:SQL 走三步,从 E4029 走到价格
import sqlite3

conn = sqlite3.connect("part04/data/kg.db")  # kg_sqlite.py 建的库
sql = """
SELECT a.head, a.rel, a.tail, b.rel, b.tail, c.rel, c.tail, c.source
FROM triples AS a
JOIN triples AS b ON b.head = a.tail
JOIN triples AS c ON c.head = b.tail
WHERE a.head = 'E4029' AND c.rel = '年付价格'
"""
for row in conn.execute(sql):
    print(row)
conn.close()
```

<div class="line-notes">

- `conn = sqlite3.connect("part04/data/kg.db")  # kg_sqlite.py 建的库` 先跑过 `kg_sqlite.py` 才有这个文件。
- `JOIN triples AS c ON c.head = b.tail` 第三次用同一张表。每多一步就多一个 JOIN,这就是 SQL 查多跳的笨拙之处。
- `WHERE a.head = 'E4029' AND c.rel = '年付价格'` 起点固定,终点的关系类型固定。

</div>

```text
('E4029', '发生在', '开放 API', '仅限', '企业版', '年付价格', '1908 元', 'kb-001')
```

一行结果,和 `kg_hops.py` 第三步那条路径一样。

</details>

**练习 4(开放题):给图加一条方向检查。** 你知道「仅限」这种关系的尾实体一定是套餐。写一个检查,找出所有违反这条规则的三元组,用 `kg_direction.py` 里那个写反的图测一下。

<details><summary>参考答案</summary>

示范解法:定义一个套餐集合,规则是「关系为仅限的三元组,尾必须在套餐集合里」。

```python
# agent-zero-lab/part04/kg_ex4.py  练习 4:「仅限」的尾实体必须是套餐,找出违反的三元组
from part04.kg_triples import TRIPLES, Triple

PLANS = {"免费版", "专业版", "企业版", "年付专业版"}


def check(graph: list[Triple]) -> list[Triple]:
    return [t for t in graph if t[1] == "仅限" and t[2] not in PLANS]


wrong = [t for t in TRIPLES if t[0] != "备份恢复"] + [("企业版", "仅限", "备份恢复", "kb-018")]
print("正确的图:", check(TRIPLES))
print("写反的图:", check(wrong))
```

<div class="line-notes">

- `PLANS = {"免费版", "专业版", "企业版", "年付专业版"}` 「套餐」这类实体的全部成员。用集合是因为下面只需要判断「在不在里面」。
- `return [t for t in graph if t[1] == "仅限" and t[2] not in PLANS]` 关系是「仅限」、尾却不是套餐的,就是可疑的三元组。
- `wrong = [t for t in TRIPLES if t[0] != "备份恢复"] + [("企业版", "仅限", "备份恢复", "kb-018")]` 和 `kg_direction.py` 一样造一个写反的图。这里没有直接 `import` 那个文件,因为它没有 `if __name__ == "__main__":`,一 import 就会把它的三行输出也打出来。

</div>

```text
正确的图: []
写反的图: [('企业版', '仅限', '备份恢复', 'kb-018')]
```

正确的图一条都没抓到,写反的那条被抓了出来,因为它的尾「备份恢复」不是套餐。这种「某种关系的头和尾必须是某类实体」的规则,在知识图谱里叫 schema(模式)或本体(ontology)约束。后天让模型抽三元组时,这类代码检查是兜底的关键:模型负责抽,代码负责查方向和类型,和 Day 246 账单抽取里「模型负责读,代码负责算」是一个道理。

</details>

验收标准:四个脚本都跑通,输出和文中一致;能不看文章把 kb-003 里「已经开票的订单要先红冲才能退款」写成三元组,并说出头、关系、尾各是什么、方向为什么是这样;能解释为什么 grep「仅限」答不对枚举题,而三元组可以。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 知识图谱(knowledge graph) | 用「实体-关系-实体」组织起来的事实集合,实体是点,关系是有方向、有名字的边 |
| 实体(entity) | 图里的一个点:套餐、功能、错误码、金额都可以 |
| 关系(relation) | 两个实体之间有名字的联系,比如「仅限」「包含」 |
| 三元组(triple) | (头实体,关系,尾实体),知识图谱的最小单位 |
| 头实体 / 尾实体 | 边的起点和终点,(开放 API,仅限,企业版)里开放 API 是头,企业版是尾 |
| 节点 / 边(node / edge) | 图论里对点和线的叫法,和实体、关系一一对应 |
| 多跳(multi-hop) | 要连着走好几条边才能回答的问题 |
| 邻接表(adjacency list) | 一个 dict,键是点,值是从它出发的所有边 |
| 广度优先搜索(BFS) | 先走完 1 步能到的,再走 2 步能到的,用队列实现 |
| 环(cycle) | 沿着边走能回到起点,遍历时要记住走过的点 |
| 自连接(self join) | 同一张表起两个别名再 JOIN,SQL 里查两步关系的写法 |
| `defaultdict` / `deque` | `collections` 里的两个工具:自动给默认值的 dict;两头都能快速进出的队列 |
| GraphRAG | 用大模型从文本自动抽三元组建图,再用图增强检索,Day 252 开始讲 |

## 常见误区

**以为图的准确率来自查询。** 查询只是照着图走。kb-006 的专票写成「仅限企业版」,图就会一本正经地给出错误答案。图对不对,全看建图时有没有读懂原文。

**把「包含」写成「仅限」。** kb-001 说企业版包含专属客服,没说别的套餐没有。建图时补原文没写的信息,图看起来更完整,实际是在造事实。

**边的方向写反。** (企业版,仅限,备份恢复)念出来是「企业版仅限备份恢复」,不是人话。查询不会报错,只是悄悄漏答案。从左往右念一遍,或者用练习 4 那种类型检查。

**同一个东西两个名字。** 「年付专业版」和「专业版」、「专票」和「增值税专用发票」,在图里是不同的点,查一个就漏另一个。要么加「属于」边,要么做实体合并。

**遍历不记走过的点。** 图里很容易有环,练习 2 第一次就绕回了起点。BFS 一定要带 `seen`。

**小知识库也上图数据库。** 几百条三元组,SQLite 一张表加 Python 邻接表就够。Neo4j 的好处在跳数多、图很大时才显出来,先别给自己加一个要运维的服务。

**以为有了图就不要原文了。** 图里只剩关系,「每次收费 500 元」「1 到 3 个工作日到账」这些细节要么写成更多三元组,要么回答时把出处的原文也带上。Day 253 的 local search 就是图和原文一起交给模型。

## 学习资料

### 文档与文章

- [知识图谱(维基百科中文)](https://zh.wikipedia.org/wiki/知识图谱):概念、历史和谷歌知识图谱的来历,15 分钟。
- [W3C · RDF 1.1 Primer](https://www.w3.org/TR/rdf11-primer/):三元组的「官方」写法,第 3 节讲 subject、predicate、object,就是今天的头、关系、尾。英文,读第 1 到 3 节,30 分钟。
- [Neo4j · What is a graph database](https://neo4j.com/docs/getting-started/graph-database/):图数据库的基本概念和 Cypher 的样子,看看就行,今天不装。
- [Python 文档 · collections](https://docs.python.org/zh-cn/3/library/collections.html):`defaultdict` 和 `deque` 两节,10 分钟。
- [SQLite · SELECT](https://www.sqlite.org/lang_select.html):JOIN 的完整语法,复习用。
- [From Local to Global: A Graph RAG Approach(arXiv 2404.16130)](https://arxiv.org/abs/2404.16130):微软 GraphRAG 论文,今天只读摘要,知道「用模型建图」这件事从哪来,Day 252 起会细读。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1H84y1Y7Vb&autoplay=0&high_quality=1" title="AI科普微视频80丨什么是知识图谱？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>中国人工智能学会 · AI科普微视频80丨什么是知识图谱? · 不到 3 分钟,学会官方的科普,先看这个建立直觉。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1zoKuzoENM&autoplay=0&high_quality=1" title="AI知识图谱 GraphRAG 是怎么回事？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>隔壁的程序员老王 · AI知识图谱 GraphRAG 是怎么回事? · 14 分钟,播放量 15 万。今天先看讲知识图谱本身的部分,讲 GraphRAG 的部分留到 Day 252 再看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1wN411X7Gw&autoplay=0&high_quality=1" title="什么是知识图谱？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>算法猪立业 · 什么是知识图谱? · 9 分钟,播放量 5 万多,入门科普,和第一个视频互相补充。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/6vG_amAshTk" title="Knowledge Graph or Vector Database… Which is Better?" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Adam Lucek · Knowledge Graph or Vector Database… Which is Better? · 英文,讲两者各擅长什么问题,和今天开头那三类问题是同一个话题。开自动字幕。</figcaption>
</figure>

### 书籍

- 王昊奋、漆桂林、陈华钧《知识图谱:方法、实践与应用》(电子工业出版社,2019)。国内知识图谱的经典教材,第 1、2 章讲概念和知识表示就够今天用,后面的抽取、存储章节可以等 Day 252 之后再翻。
- Aidan Hogan 等《Knowledge Graphs》(Morgan & Claypool,2021),作者把全书放在 [kgbook.org](https://kgbook.org/) 免费在线读,也有 [arXiv 版](https://arxiv.org/abs/2003.02320)。英文,第 2 章「Data Graphs」讲各种图模型,想打牢基础时读。

### 开源项目与代码

- [microsoft/graphrag](https://github.com/microsoft/graphrag):微软的 GraphRAG 实现,今天先看 README 里的流程图,知道它要做的第一步就是今天手写的三元组。
- [HKUDS/LightRAG](https://github.com/HKUDS/LightRAG):轻量版 GraphRAG,README 里有抽取出来的图的可视化截图,可以看看真实的图长什么样。
- [NetworkX](https://networkx.org/documentation/stable/):Python 最常用的图计算库,今天手写的 BFS 它一行就有(`nx.bfs_edges`)。Day 252 起会用到它。

## 自测

**1. 把 kb-008 里「优惠码不适用于企业版」写成三元组。如果写成(企业版,不适用于,优惠码),念出来是什么意思?**

<details><summary>答案</summary>

正确写法是(优惠码,不适用于,企业版)。写反后念出来是「企业版不适用于优惠码」,勉强也能读通,这正是危险的地方:有些关系反过来也像人话,读起来不别扭,但查询「哪些东西不适用于企业版」时它就查不到了。所以方向要靠统一的规则(这个关系的头是什么类型、尾是什么类型)来保证,不能只靠念着顺不顺。

</details>

**2. 为什么 grep「仅限」回答「哪些功能只有企业版有」会出错?举出今天的两个具体错误。**

<details><summary>答案</summary>

grep 匹配的是字,不是意思。一是把 kb-006 误算进来:原文「仅限企业版,或年付的专业版」,专票并非企业版独有;二是漏了 kb-018:备份恢复确实只有企业版有,但原文写的是「其他套餐不提供」,没有「仅限」二字。三元组在建图时已经把这两句的意思整理成了「可开给」和「仅限」两种边,查询就不会被字面骗到。

</details>

**3. 「报 E4029 的客户年付一年多少钱」为什么向量检索不好答,图怎么答?**

<details><summary>答案</summary>

答案在 kb-001(企业版年付 1908 元),而 kb-001 里没有 E4029,和问题不像,向量检索很难把它排进 top-k。图从问题里的实体 E4029 出发,沿边走:E4029 发生在开放 API,开放 API 仅限企业版,企业版年付价格 1908 元,三步走到,路径上每条边都带出处(kb-019、kb-001)。

</details>

**4. `kg_hops.py` 里去掉 `seen` 会怎样?**

<details><summary>答案</summary>

图里有环:企业版包含开放 API,开放 API 仅限企业版。去掉 `seen` 后,从 E4029 走 3 步会出现「E4029 → 开放 API → 企业版 → 开放 API」这种绕回去的路径;如果再去掉 `max_hops` 的限制,队列永远不会空,程序会一直跑下去。练习 2 第一次的输出里就有绕回起点的行。

</details>

**5.(面试题)面试官问:「向量检索有什么解决不了的问题?你会怎么办?」请用两三分钟的话回答。**

<details><summary>答案</summary>

参考回答:向量检索默认答案集中在少数几块、而且和问题长得像。三类问题不满足:一是多跳,答案分散在几篇文档里,其中一些和问题字面不像,比如「报 E4029 的客户年付多少钱」答案在价格页,价格页里没有 E4029;二是枚举,「哪些功能仅限企业版」,top-k 漏一个你不知道漏了,关键词也会被「仅限企业版或年付专业版」这种句子骗;三是全局汇总,答案遍布全库,任何 top-k 都装不下。办法分情况:多跳和枚举可以事先把文档抽成知识图谱,按实体出发沿边走或按关系类型查,回答时带上边的出处和原文;全局问题可以用 GraphRAG 的社区摘要加 map-reduce,或者 RLM 那样让模型写代码通读;如果数据本来是结构化的,直接 Text-to-SQL。代价是建图要成本、会抽错(方向反、实体重复),要有类型约束和抽查。小知识库上图检索找文档的能力往往不如混合检索,所以一般是两者结合,而不是替换。

</details>

## 明天预告

Day 251 · 第 36 周复习:RAG 与上下文(Day 245–250)。这一周从多模态看图、读 PDF、截图进检索,到代码库按 AST 切块、RLM、知识图谱,六天讲了六种「资料不是干净 Markdown 时怎么办」。明天把它们画成一张地图,做一个只用本周知识的小项目:用 `ast` 把练习仓库里的 import 关系抽成三元组,回答「改了这个文件会影响谁」,正好把 Day 248 和今天接起来。
