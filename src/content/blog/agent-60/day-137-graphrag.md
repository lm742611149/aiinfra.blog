---
title: 'Day 137 · GraphRAG 与知识图谱:实体关系抽取、图检索与代码图'
description: '向量检索擅长「找一段像的话」,不擅长「把散在多篇文章里的关系串起来」和「把整个知识库总结一遍」。今天用大模型从 CloudLedger 帮助中心抽出实体和关系建一张图,手写 local search 和 global search,和 Day 18 的混合检索并排比一比,再用 ast 给代码库建一张依赖图。'
pubDate: 2026-10-22
regime: none
tags: ['graphrag', 'knowledge-graph', 'rag', 'networkx', 'agent-60']
series: 'agent-60'
day: 137
lang: 'zh'
---

## 今天要解决的问题

这是专题篇的一课,**建议在 [Day 18 · 检索质量](/blog/agent-60/day-18-retrieval-quality/) 之后读**。你需要 Day 16 的帮助中心数据(`data/helpcenter/` 里 20 篇文章)和 Day 18 的 `w3/retrieve.py`(混合检索 + rerank,要 Postgres 开着)。专题篇可以跳着读,不影响主线进度。

招聘 JD 里「知识图谱」「GraphRAG」出现的次数不算多(站长抓的 881 条 JD 里有 36 条提到),但一提到往往是金融、医疗、法律这类关系很密的行业,而且面试官很喜欢问一句:「向量检索有什么解决不了的问题,你会怎么办?」今天就把这个问题答扎实。

先说清楚我自己的结论,免得你带着过高的期待:在 CloudLedger 这种 20 篇短文章的小知识库上,图检索**找文章**的能力不如 Day 18 的混合检索,我实测下来也是这样。图真正有用的地方是另外两件事:按关系精确枚举(「哪些东西仅限企业版」),和对整个知识库做总结(「把所有带时间期限的规则列一遍」)。今天每一步都用真实运行结果说话,包括它做砸的地方。

学完你应该能做到:

1. 说清楚向量检索在哪三类问题上吃亏,知识图谱用什么方式补上。
2. 用大模型从文章里抽出「实体-关系-实体」三元组并存进 SQLite,能指出抽取结果里的典型错误。
3. 手写 local search(从问题里的实体出发沿边扩展)和 global search(社区摘要 + map-reduce),跑通 CloudLedger 的例子。
4. 拿同一批问题对比图检索和混合检索,能解释为什么小知识库上图检索不占优。
5. 知道 Microsoft GraphRAG、LightRAG、Neo4j、Apache AGE 现在(2026 年 10 月)各是什么状态,什么时候该用哪个。
6. 用 `ast` 给代码库建一张 import 依赖图,回答「改了这个文件会影响谁」。

预计用时 5 小时,API 花费不到 1 元(算式在后面)。

## 向量检索答不好的三类问题

回忆一下 Day 16 到 Day 18 的检索:把文章切成块,每块变成一个向量,问题也变成向量,找最近的几块。它默认了一个前提:**答案集中在少数几块里,而且这几块和问题长得像**。下面三类问题都不满足这个前提。

第一类是多跳问题。「我用优惠码买了年付专业版,开过增值税专票,第 3 个月想退款,要先做什么、能退多少?」答案分散在四篇文章里:退款政策(kb-002)讲怎么算钱,如何申请退款(kb-003)讲要先红冲发票,优惠码规则(kb-008)讲优惠部分不退现金,发票类型(kb-006)讲专票怎么回事。每一篇单独拿出来都只和问题沾一点边。

第二类是枚举问题。「哪些功能只有企业版才有?」开放 API 写在 kb-019,备份恢复写在 kb-018,专票写在 kb-006,专属客服写在 kb-001。向量检索给你 top-4 块,漏一个你根本不知道漏了。

第三类是全局问题。「帮助中心里所有带时间期限的规则,汇总成一张清单。」这个问题的答案遍布全部 20 篇,任何 top-k 都装不下,而且问题本身和每一块都不怎么像。

知识图谱的思路是:先把文章里的事实拆成「谁和谁是什么关系」,存成一张图。多跳问题沿着边走过去,枚举问题按关系类型查,全局问题把图切成几块分别总结。代价是建图要花钱、会出错,图里只剩下关系,原文里的细节会丢。

## 知识图谱三分钟入门

知识图谱就是一堆三元组:(头实体,关系,尾实体)。比如 (开放 API,仅限,企业版)、(E1043,导致,文件编码错误)。实体是点,关系是有方向、有名字的边。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="CloudLedger 知识图谱的一小块:企业版节点周围的仅限、包含、不适用于关系,每条边带着来源文章编号">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="262" y="105" width="116" height="36" rx="18" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="128" fill="var(--ink)" text-anchor="middle">企业版</text>
<rect x="30" y="30" width="120" height="32" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="90" y="51" fill="var(--ink)" text-anchor="middle">开放 API</text>
<rect x="30" y="185" width="120" height="32" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="90" y="206" fill="var(--ink)" text-anchor="middle">备份恢复</text>
<rect x="490" y="30" width="130" height="32" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="555" y="51" fill="var(--ink)" text-anchor="middle">增值税专用发票</text>
<rect x="490" y="185" width="130" height="32" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="555" y="206" fill="var(--ink)" text-anchor="middle">优惠码</text>
<line x1="150" y1="50" x2="262" y2="115" stroke="var(--ink-soft)"/>
<text x="160" y="80" fill="var(--ink-soft)">仅限 [kb-019]</text>
<line x1="150" y1="200" x2="262" y2="132" stroke="var(--ink-soft)"/>
<text x="160" y="180" fill="var(--ink-soft)">仅限 [kb-018]</text>
<line x1="490" y1="50" x2="378" y2="115" stroke="var(--ink-soft)"/>
<text x="395" y="80" fill="var(--ink-soft)">仅限 [kb-006]</text>
<line x1="490" y1="200" x2="378" y2="132" stroke="var(--ink-soft)"/>
<text x="380" y="180" fill="var(--ink-soft)">不适用于 [kb-008]</text>
<text x="320" y="240" fill="var(--ink-faint)" text-anchor="middle" font-size="11">箭头方向:头实体 → 尾实体;每条边记着出自哪篇文章</text>
</g>
</svg>
<figcaption>今天建出来的图里,「企业版」周围的一小块(真实抽取结果)。蓝色是被问到的中心实体,琥珀色是它的邻居。</figcaption>
</figure>

和关系数据库比,图的长处是「走几步」很便宜。SQL 里查「和企业版隔两跳的所有东西」要写自连接,跳数一多就很难写;图数据库里这是一句话。和向量比,图的长处是关系有名字:「仅限」和「不适用于」意思正好相反,向量看着却差不多。

两个容易混的词顺便分清。知识图谱(knowledge graph)是数据结构,几十年前就有,以前靠人工或规则抽取。GraphRAG 是 2024 年微软一篇论文带火的说法,指用大模型自动建图,再拿图去增强 RAG。今天说的都是后者。

## GraphRAG 的两种检索

微软 GraphRAG 的论文([From Local to Global: A Graph RAG Approach to Query-Focused Summarization](https://arxiv.org/abs/2404.16130))把检索分成两种,后来的工具基本都沿用了这个分法。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="GraphRAG 流程:建图阶段抽取三元组并做社区划分和摘要;查询阶段 local search 从实体沿边扩展,global search 对社区摘要做 map-reduce">
<rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink-faint)">建图(一次性,花钱的大头)</text>
<rect x="20" y="38" width="110" height="34" rx="4" fill="none" stroke="var(--compute)"/><text x="75" y="60" fill="var(--ink)" text-anchor="middle">20 篇文章</text>
<line x1="130" y1="55" x2="170" y2="55" stroke="var(--ink-soft)"/>
<rect x="170" y="38" width="130" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="235" y="60" fill="var(--ink)" text-anchor="middle">LLM 抽三元组</text>
<line x1="300" y1="55" x2="340" y2="55" stroke="var(--ink-soft)"/>
<rect x="340" y="38" width="110" height="34" rx="4" fill="none" stroke="var(--compute)"/><text x="395" y="60" fill="var(--ink)" text-anchor="middle">图 kg.db</text>
<line x1="450" y1="55" x2="490" y2="55" stroke="var(--ink-soft)"/>
<rect x="490" y="38" width="130" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="555" y="60" fill="var(--ink)" text-anchor="middle">社区 + LLM 摘要</text>
<text x="20" y="112" fill="var(--ink-faint)">local search(具体问题)</text>
<rect x="20" y="124" width="110" height="34" rx="4" fill="none" stroke="var(--ink-soft)"/><text x="75" y="146" fill="var(--ink)" text-anchor="middle">问题</text>
<line x1="130" y1="141" x2="170" y2="141" stroke="var(--ink-soft)"/>
<rect x="170" y="124" width="130" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="235" y="146" fill="var(--ink)" text-anchor="middle">认出实体</text>
<line x1="300" y1="141" x2="340" y2="141" stroke="var(--ink-soft)"/>
<rect x="340" y="124" width="110" height="34" rx="4" fill="none" stroke="var(--compute)"/><text x="395" y="146" fill="var(--ink)" text-anchor="middle">沿边走 2 跳</text>
<line x1="450" y1="141" x2="490" y2="141" stroke="var(--ink-soft)"/>
<rect x="490" y="124" width="130" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="555" y="146" fill="var(--ink)" text-anchor="middle">带证据回答</text>
<text x="20" y="198" fill="var(--ink-faint)">global search(全局问题)</text>
<rect x="20" y="210" width="110" height="34" rx="4" fill="none" stroke="var(--ink-soft)"/><text x="75" y="232" fill="var(--ink)" text-anchor="middle">问题</text>
<line x1="130" y1="227" x2="170" y2="227" stroke="var(--ink-soft)"/>
<rect x="170" y="210" width="130" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="235" y="232" fill="var(--ink)" text-anchor="middle">每个社区各答</text>
<line x1="300" y1="227" x2="340" y2="227" stroke="var(--ink-soft)"/>
<rect x="340" y="210" width="110" height="34" rx="4" fill="none" stroke="var(--ink-soft)"/><text x="395" y="232" fill="var(--ink)" text-anchor="middle">去掉「无」</text>
<line x1="450" y1="227" x2="490" y2="227" stroke="var(--ink-soft)"/>
<rect x="490" y="210" width="130" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="555" y="232" fill="var(--ink)" text-anchor="middle">合并成一份</text>
</g>
</svg>
<figcaption>建图只做一次,查询分两条路。蓝色框是要调大模型的步骤,数一数就知道钱花在哪。</figcaption>
</figure>

local search 适合问具体事情:先认出问题里提到了哪些实体,从这些点出发沿边走一两步,把走到的边(连同原文证据)交给大模型回答。global search 适合问整体:建图时用社区发现算法把图切成若干团,每团让大模型写一段摘要;查询时每段摘要各答一遍(map),再合并(reduce)。

现成的工具我在 2026 年 10 月查了一遍,情况和一年前不太一样:

- **Microsoft GraphRAG**:PyPI 上最新是 3.3.0(2026-10-08 发布)。但它的 [README](https://github.com/microsoft/graphrag) 开头写着项目「largely in maintenance mode」,不再接受新 PR、不加新功能,只修 bug 和安全问题。它的查询方式现在有 local、global、DRIFT(local 加上社区信息)和 basic(普通向量检索,用来做对照)四种,见[官方文档](https://microsoft.github.io/graphrag/query/overview/)。README 里反复提醒建索引很贵、要「start small」。
- **LightRAG**(香港大学 HKUDS):PyPI 包名 `lightrag-hku`,最新 1.5.7(2026-09-02)。定位是「轻量版 GraphRAG」,查询模式有 local、global、hybrid、naive、mix(默认),2026 年 5 月把多模态解析的 RAG-Anything 合并进来了。生产部署推荐用 PostgreSQL 一个库存下全部四类数据。
- **Neo4j**:最常见的图数据库,查询语言叫 Cypher。官方的 `neo4j-graphrag` Python 包 2026-10-01 出了 1.22.0。
- **Apache AGE**:给 Postgres 加图查询的扩展,能在 Postgres 里写 Cypher。GitHub 上最新是 1.8.0 的 rc 版(PG18 分支 2026-07、PG15 分支 2026-09),还没正式版。

今天不直接用这些框架,而是用 SQLite 存三元组、`networkx` 做图计算,两百行左右自己写一遍。框架帮你做的事情就这几步,自己写过一次,再看 LightRAG 的源码和配置项就能看懂每个参数在管什么。

## 第一步:用大模型抽三元组

新建目录 `agent-60-lab/topics/graphrag/`,装两个依赖:

```bash
cd agent-60-lab
uv add networkx sqlglot   # sqlglot 是 Day 138 用的,顺手一起装
```

先写一个公共模块,放路径、关系白名单和建表语句:

```python
# agent-60-lab/topics/graphrag/kg_common.py
"""专题 Day 137 共用:路径、LLM 调用、图数据库读写。"""
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "w3"))  # 复用 W3 的 llm.py、chunking.py

from llm import chat  # noqa: E402

KB_DIR = ROOT / "data" / "helpcenter"
KG_DB = Path(__file__).with_name("kg.db")

RELATIONS = ["包含", "仅限", "不适用于", "前提是", "导致", "解决办法", "限制", "费用", "时限"]


def chat_json(messages: list[Any]) -> dict:
    raw = chat(messages, response_format={"type": "json_object"}, temperature=0)
    return json.loads(raw)


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(KG_DB)
    conn.row_factory = sqlite3.Row
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS entities (
        name TEXT PRIMARY KEY,
        type TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS edges (
        head     TEXT NOT NULL,
        rel      TEXT NOT NULL,
        tail     TEXT NOT NULL,
        evidence TEXT NOT NULL,
        doc_id   TEXT NOT NULL,
        UNIQUE (head, rel, tail, doc_id)
    );
    """)
    return conn
```

<div class="line-notes">

- `ROOT = Path(__file__).resolve().parents[2]` `parents[0]` 是 `graphrag/`,`[1]` 是 `topics/`,`[2]` 是 `agent-60-lab/`。实测得到练习仓的根目录。
- `sys.path.insert(0, str(ROOT / "w3"))` W3 的文件互相用平级导入(`from llm import chat`),所以把 `w3/` 塞进模块搜索路径,这里就能直接 `import llm`。相当于 TS 里配了一个 path alias。
- `from llm import chat  # noqa: E402` E402 是 Ruff 的「import 不在文件顶部」。这里必须先改 `sys.path` 才能导入,所以显式告诉 Ruff 这是故意的。
- `KB_DIR = ROOT / "data" / "helpcenter"` Day 16 造的 20 篇帮助中心文章。
- `KG_DB = Path(__file__).with_name("kg.db")` 图存在脚本旁边的 `kg.db`,不和 Day 23 的业务库混在一起。
- `RELATIONS = [` 关系白名单,只有 9 种。不给白名单的话,模型会造出「可以开」「支持开具」「能用于」几十种说法,图就没法按关系查了。
- `raw = chat(messages, response_format={"type": "json_object"}, temperature=0)` 让 DeepSeek 只输出合法 JSON(Day 6 讲过的 JSON mode),`temperature=0` 让同一篇文章两次抽出来尽量一样。
- `conn.row_factory = sqlite3.Row` 查询结果可以用 `r["head"]` 按列名取,不用记第几列。
- `UNIQUE (head, rel, tail, doc_id)` 同一篇文章里同一条关系只存一次,重跑 `INSERT OR IGNORE` 不会重复。不同文章说了同一件事会各存一条,这样每条边都能追溯到出处。

</div>

然后是抽取脚本。提示词里我写了四条规则,每一条都是第一次跑完看到问题才加的:

```python
# agent-60-lab/topics/graphrag/extract.py
"""逐篇读帮助中心文章,让大模型抽实体和关系,存进 kg.db。"""
from kg_common import KB_DIR, KG_DB, RELATIONS, chat_json, connect

ENTITY_TYPES = ["套餐", "功能", "规则", "错误码", "操作", "单据", "渠道"]

SYSTEM = f"""你在给一家记账 SaaS 的帮助中心建知识图谱。
从文章里抽出实体和关系,只输出 JSON:
{{"entities": [{{"name": "...", "type": "..."}}],
  "relations": [{{"head": "...", "rel": "...", "tail": "...", "evidence": "..."}}]}}

规则:
- 实体类型只能是:{"、".join(ENTITY_TYPES)}
- 关系只能是:{"、".join(RELATIONS)}。原文表达不了的关系就不抽,不要发明新关系。
- 套餐统一叫「免费版」「专业版」「企业版」;原文写「年付的专业版」就用「年付专业版」。
- 实体名用最短的说法,比如「增值税专用发票」而不是「增值税专用发票的开具」。
- evidence 原样抄原文里支撑这条关系的那一句,不超过 60 字。
"""


def extract(path) -> dict:
    text = path.read_text(encoding="utf-8")
    return chat_json([
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": text},
    ])


def main() -> None:
    KG_DB.unlink(missing_ok=True)
    conn = connect()
    dropped = 0
    for path in sorted(KB_DIR.glob("kb-*.md")):
        doc_id = path.stem
        data = extract(path)
        for e in data.get("entities", []):
            conn.execute("INSERT OR IGNORE INTO entities VALUES (?, ?)", (e["name"], e["type"]))
        for r in data.get("relations", []):
            if r["rel"] not in RELATIONS:
                dropped += 1
                continue
            conn.execute(
                "INSERT OR IGNORE INTO edges VALUES (?, ?, ?, ?, ?)",
                (r["head"], r["rel"], r["tail"], r["evidence"], doc_id),
            )
        conn.commit()
        n = conn.execute("SELECT count(*) FROM edges WHERE doc_id = ?", (doc_id,)).fetchone()[0]
        print(f"{doc_id}: {n} 条关系")
    ents = conn.execute("SELECT count(*) FROM entities").fetchone()[0]
    edges = conn.execute("SELECT count(*) FROM edges").fetchone()[0]
    print(f"合计 {ents} 个实体、{edges} 条关系,丢掉不在白名单里的关系 {dropped} 条")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `ENTITY_TYPES = [` 实体类型白名单。实测模型并不完全遵守:跑完 `entities` 表里还冒出了「时限」「费用」「限制」「前提是」四种类型,一共 13 个实体。类型只用来给人看,所以我没有强制过滤;关系则必须过滤,见下面。
- `SYSTEM = f"""` f-string 里要输出字面量的 `{` `}`,得写成 `{{` `}}`,所以 JSON 示例里大括号都是双的。
- `{"、".join(ENTITY_TYPES)}` 拼出来是 `套餐、功能、规则、错误码、操作、单据、渠道`。
- `- 套餐统一叫` 实体归一化最便宜的办法就是在提示词里点名。第一版没写这条,图里同时出现了「企业版」「企业版套餐」「Enterprise」三个点,关系被拆散在三处。
- `- evidence 原样抄` 每条边带一句原文,回答时可以引用,也方便你人工抽查抽得对不对。
- `def extract(path) -> dict:` 一篇文章调一次模型。kb-001 原文 318 个字符,加上约 500 字的提示词,一次输入几百 token(估算,中文约 1.5 字符一个 token 的经验值)。
- `KG_DB.unlink(missing_ok=True)` 每次全量重建。增量更新(文章改了只重抽这一篇)留给练习 3。
- `doc_id = path.stem` `kb-002.md` 的 stem 是 `kb-002`,和 Day 16 的文章 id 一致,后面拿来和混合检索对比。
- `conn.execute("INSERT OR IGNORE INTO entities VALUES (?, ?)", (e["name"], e["type"]))` 同名实体第二次出现时忽略,所以「企业版」只记第一次抽到的类型。
- `if r["rel"] not in RELATIONS:` 白名单之外的关系直接丢掉并计数。实测 20 篇一共丢了 1 条。
- `n = conn.execute("SELECT count(*) FROM edges WHERE doc_id = ?", (doc_id,)).fetchone()[0]` 打印每篇抽了多少条,一眼就能看出哪篇抽得太少(kb-008 只有 3 条,后面会出问题)。

</div>

在练习仓根目录运行 `uv run python topics/graphrag/extract.py`,我这里 20 次调用用了大约 40 秒,最后一行是:

```text
合计 132 个实体、139 条关系,丢掉不在白名单里的关系 1 条
```

先别急着往下走,打开 `kg.db` 抽查几篇。这一步省掉的话,后面所有检索结果你都没法判断是图的问题还是检索的问题。

```bash
sqlite3 topics/graphrag/kg.db "SELECT head, rel, tail FROM edges WHERE doc_id IN ('kb-003', 'kb-008')"
```

我看到的是这样(真实结果):

```text
优惠码|不适用于|企业版
优惠码|前提是|结算页面
优惠码|限制|订单
发票红冲|前提是|退款流程
增值税专用发票|前提是|红字信息表
客服主管审批|导致|退款流程
...
```

这里能看到抽取的三种典型错误,我两次重建图都出现了:

**方向反了。** 原文是「需要先申请发票红冲,红冲完成后才能退款」,正确的边是 (退款,前提是,发票红冲),模型写成了 (发票红冲,前提是,退款流程)。图检索沿边走的时候不分方向,所以这条错边还能被用上,但如果你按方向查「退款的前提有哪些」,就查不到。

**丢了关键事实。** kb-008 第二节「使用优惠码的订单退款时,按实际支付的金额退款,优惠部分不退现金」,整句没抽出来。这句话表达的是一个计算规则,很难塞进「头-关系-尾」的格式里。这是图的天生短板:**数字、条件、计算方法这类细节,三元组装不下**。

**实体切得太碎。** 「退款」「退款流程」「退款政策」是三个点;另有「支付宝」和「支付宝1到3个工作日到账」被当成两个实体。实体越碎,图上的连接越稀,多跳就越走不通。

生产里通常会再加一步实体消歧:把所有实体名做 embedding,相似度高的合并,或者让大模型对一批候选做判断。LightRAG 和 GraphRAG 都有类似的合并步骤。今天先不做,留在练习里。

## 第二步:local search

local search 分三步:认出问题里的实体,沿边扩展,带着证据回答。

```python
# agent-60-lab/topics/graphrag/graph_search.py
"""local search:问题 → 找到图里的实体 → 沿边扩展 1~2 跳 → 把边和原文证据交给大模型。"""
import sys

import networkx as nx

from kg_common import chat, chat_json, connect

LINK_PROMPT = """下面是知识图谱里的全部实体名。找出和用户问题直接相关的实体,最多 5 个,
只能从列表里原样挑,不要自己造。只输出 JSON:{{"entities": ["..."]}}

实体列表:
{names}"""

ANSWER_PROMPT = """你是 CloudLedger 的客服。只根据下面的「事实」回答,每条结论后面用 [kb-xxx] 标出处。
事实里没有的,直接说帮助中心没写,不要猜。

事实:
{facts}"""


def load_graph() -> nx.MultiDiGraph:
    g = nx.MultiDiGraph()
    with connect() as conn:
        for r in conn.execute("SELECT head, rel, tail, evidence, doc_id FROM edges"):
            g.add_edge(r["head"], r["tail"], rel=r["rel"], evidence=r["evidence"], doc_id=r["doc_id"])
    return g


G = load_graph()


def link_entities(question: str) -> list[str]:
    names = "\n".join(sorted(G.nodes))
    data = chat_json([
        {"role": "system", "content": LINK_PROMPT.format(names=names)},
        {"role": "user", "content": question},
    ])
    return [n for n in data.get("entities", []) if n in G]


def neighborhood(seeds: list[str], hops: int = 2, max_edges: int = 40) -> list[dict]:
    undirected = G.to_undirected(as_view=True)
    keep: set[str] = set()
    for s in seeds:
        keep |= set(nx.ego_graph(undirected, s, radius=hops))
    edges = []
    for h, t, d in G.subgraph(keep).edges(data=True):
        # 离种子越近越靠前:两端有一端是种子的边先放
        near = 0 if (h in seeds or t in seeds) else 1
        edges.append({"near": near, "head": h, "tail": t, **d})
    edges.sort(key=lambda e: (e["near"], e["doc_id"]))
    return edges[:max_edges]


def graph_search(question: str, hops: int = 2) -> tuple[list[str], list[dict]]:
    seeds = link_entities(question)
    return seeds, neighborhood(seeds, hops)


def answer(question: str, edges: list[dict]) -> str:
    facts = "\n".join(
        f"- {e['head']} {e['rel']} {e['tail']}(原文:{e['evidence']})[{e['doc_id']}]" for e in edges
    )
    return chat([
        {"role": "system", "content": ANSWER_PROMPT.format(facts=facts)},
        {"role": "user", "content": question},
    ], temperature=0)


if __name__ == "__main__":
    q = sys.argv[1] if len(sys.argv) > 1 else "哪些功能只有企业版才有?"
    seeds, edges = graph_search(q)
    print("种子实体:", seeds)
    print(f"扩展出 {len(edges)} 条边,来自", sorted({e["doc_id"] for e in edges}))
    print(answer(q, edges))
```

<div class="line-notes">

- `import networkx as nx` 纯 Python 的图计算库,2026-09 发布了 3.7。几百上千个节点的图用它足够,上了十万级再换 Neo4j。
- `def load_graph() -> nx.MultiDiGraph:` Multi 表示两个点之间可以有多条边(企业版和开放 API 之间同时有「包含」和「仅限」),Di 表示有方向。
- `g.add_edge(r["head"], r["tail"], rel=r["rel"], evidence=r["evidence"], doc_id=r["doc_id"])` 边上挂三个属性。点不用单独加,`add_edge` 会自动把两端的点建出来。实测图里有 148 个点、139 条边,比 `entities` 表的 132 个多,因为有些边的端点模型没在 entities 里声明。
- `G = load_graph()` 模块导入时建一次图,和 Day 18 `retrieve.py` 顶部建 BM25 索引是同一个思路。
- `names = "\n".join(sorted(G.nodes))` 把全部 148 个实体名拼成一个列表交给模型,实测 887 个字符。实体到几千个就塞不下了,那时要先用 embedding 或 BM25 在实体名上检索出几十个候选,再让模型挑。
- `return [n for n in data.get("entities", []) if n in G]` 模型偶尔会「改写」实体名(比如写成「增值税专票」),不在图里的直接扔掉,不然后面 `ego_graph` 会报 `NodeNotFound`。
- `undirected = G.to_undirected(as_view=True)` 扩展邻居时不管方向。`as_view=True` 不复制数据,只是换个视角看同一张图。上面说的方向错误的边,也是因为这一行才没造成损失。
- `keep |= set(nx.ego_graph(undirected, s, radius=hops))` ego graph 就是「以 s 为中心、半径 hops 跳以内的所有点」。实测从「开放 API」出发半径 1 只有 3 条边,半径 2 就会把企业版的十几个邻居全带进来。
- `near = 0 if (h in seeds or t in seeds) else 1` 直接连着种子的边排前面,隔一跳的排后面。
- `edges.append({"near": near, "head": h, "tail": t, **d})` `**d` 把边属性(rel、evidence、doc_id)展开进字典,相当于 JS 的 `{...d}`。实测第一条是 `{'near': 0, 'head': '企业版', 'tail': '开放 API', 'rel': '包含', 'evidence': '包含开放 API', 'doc_id': 'kb-001'}`。
- `return edges[:max_edges]` 最多给模型 40 条边。企业版是图里连接最多的点(度为 15),从它出发两跳很容易就超过 40 条。
- `f"- {e['head']} {e['rel']} {e['tail']}(原文:{e['evidence']})[{e['doc_id']}]" for e in edges` 每条事实一行,带原文和出处,大模型回答时可以照抄 kb 编号。
- `q = sys.argv[1] if len(sys.argv) > 1 else "哪些功能只有企业版才有?"` 命令行不带参数时跑默认问题。

</div>

跑默认问题 `uv run python topics/graphrag/graph_search.py`,我得到的(真实输出,中间略):

```text
种子实体: ['企业版', '专业版', '免费版', '人数上限', '开放 API']
扩展出 40 条边,来自 ['kb-001', 'kb-002', 'kb-003', 'kb-005', 'kb-006', 'kb-008', 'kb-014', 'kb-015', 'kb-018', 'kb-019', 'kb-020']
只有企业版才有的功能如下:

- 开放 API:开放 API 仅对企业版开放 [kb-019]
- 专属客服:企业版包含专属客服 [kb-001]
- 增值税专用发票:增值税专用发票仅限企业版,或年付的专业版 [kb-006]
- 备份恢复:企业版客户误删数据后,可以申请从备份恢复;其他套餐不提供备份恢复服务 [kb-018]
```

这个回答四项全对,还主动指出专票年付专业版也能开。原因是「仅限 企业版」这几条边都直接连在种子上,一个不落地进了上下文。

再跑多跳那道题:

```bash
uv run python topics/graphrag/graph_search.py "我用优惠码买了年付专业版,开过增值税专票,第 3 个月想退款,要先做什么、能退多少?"
```

```text
种子实体: ['优惠码', '年付专业版', '增值税专用发票', '退款', '退款流程']
...
- 但具体金额的计算方式,帮助中心没有写,需要以《退款政策》为准 [kb-003]。

另外提醒一点:优惠码不适用于企业版 [kb-008],但你的订单是年付专业版,这条不影响你
```

审批、红冲、按剩余整月退款都答出来了,但有两处错:说「计算方式没写」(kb-002 里明明有 468 元退 351 元的例子),说优惠码「不影响你」(kb-008 写了优惠部分不退现金)。两处都是第一步抽取时丢掉的事实,图里没有,模型只能照着图说。这就是只靠三元组回答的代价。

修法很直接:**用图定位文章,用原文回答**。图负责告诉你「该看 kb-002、kb-003、kb-008」,真正回答时把这几篇(或它们的块)原文拼进去。微软 GraphRAG 的 local search 也是这样做的,它会把相关实体挂着的原始文本块一起放进上下文。下一节的对比就用这个思路来衡量图检索「找文章」的能力。

## 第三步:和混合检索比一比

同四道题,一边用 Day 18 的 `retrieve()`(hybrid+rerank,取 top-4 块再去重成文章),一边用图检索:按每篇文章贡献了多少条边打分,取前 4 篇。

```python
# agent-60-lab/topics/graphrag/compare.py
"""同一批问题:W3 的混合检索(hybrid+rerank, top-4 块)vs 图检索,看各自找到了哪些文章。"""
from collections import Counter

from graph_search import graph_search
from retrieve import retrieve  # W3 的检索流水线,需要 Postgres 开着

CASES = [
    ("哪些功能只有企业版才有?", {"kb-001", "kb-006", "kb-018", "kb-019"}),
    ("我用优惠码买了年付专业版,开过增值税专票,第 3 个月想退款,要先做什么、能退多少?",
     {"kb-002", "kb-003", "kb-008"}),
    ("月付专业版能开增值税专用发票吗?", {"kb-006"}),
    ("导入的时候报 E1043", {"kb-011"}),
]


def graph_docs(question: str, k: int = 4) -> list[str]:
    _, edges = graph_search(question)
    # 一篇文章贡献的边越多、越靠近种子,越可能是要找的那篇
    score = Counter()
    for e in edges:
        score[e["doc_id"]] += 2 if e["near"] == 0 else 1
    return [d for d, _ in score.most_common(k)]


def recall(found: list[str], gold: set[str]) -> str:
    hit = len(gold & set(found))
    return f"{hit}/{len(gold)}"


if __name__ == "__main__":
    for q, gold in CASES:
        vec = list(dict.fromkeys(c.doc_id for c, _ in retrieve(q, k=4)))
        gra = graph_docs(q)
        print(q[:24])
        print(f"  混合检索 {recall(vec, gold)}  {vec}")
        print(f"  图检索   {recall(gra, gold)}  {gra}")
```

<div class="line-notes">

- `from retrieve import retrieve  # W3 的检索流水线,需要 Postgres 开着` 能直接这样导入,是因为 `graph_search` 导入 `kg_common` 时已经把 `w3/` 加进了 `sys.path`。导入 `retrieve` 会立刻连 Postgres、建 BM25 索引,Postgres.app 没开的话这一行就报错。
- `("哪些功能只有企业版才有?", {"kb-001", "kb-006", "kb-018", "kb-019"}),` 每道题配一组「应该找到的文章」,是我读完 20 篇手工标的。
- `score[e["doc_id"]] += 2 if e["near"] == 0 else 1` 直接连着种子的边算 2 分,隔一跳的算 1 分。这个打分很粗糙,下面的结果会说明它的问题。
- `vec = list(dict.fromkeys(c.doc_id for c, _ in retrieve(q, k=4)))` 4 个块可能来自同一篇文章,`dict.fromkeys` 按出现顺序去重(Python 3.7 以后 dict 保持插入顺序)。实测第一题 4 块来自 `['kb-019', 'kb-018', 'kb-015', 'kb-001']`。
- `print(q[:24])` 只打印问题前 24 个字,输出对得整齐一些。

</div>

运行 `uv run python topics/graphrag/compare.py`,真实结果:

```text
哪些功能只有企业版才有?
  混合检索 3/4  ['kb-019', 'kb-018', 'kb-015', 'kb-001']
  图检索   2/4  ['kb-001', 'kb-014', 'kb-015', 'kb-018']
我用优惠码买了年付专业版,开过增值税专票,第 3
  混合检索 3/3  ['kb-002', 'kb-008', 'kb-003']
  图检索   2/3  ['kb-003', 'kb-001', 'kb-008', 'kb-006']
月付专业版能开增值税专用发票吗?
  混合检索 1/1  ['kb-006', 'kb-001', 'kb-003']
  图检索   1/1  ['kb-001', 'kb-006', 'kb-002', 'kb-018']
导入的时候报 E1043
  混合检索 1/1  ['kb-011', 'kb-009', 'kb-010']
  图检索   1/1  ['kb-009', 'kb-011', 'kb-010', 'kb-014']
```

混合检索 8/9,图检索 6/9。图在找文章这件事上输了,原因有两个,都值得在面试里讲出来。

一是枢纽节点抢分。kb-001(套餐与价格)几乎和所有套餐相关的实体都有边,不管问什么它都排在前面,挤掉了真正需要的 kb-019 和 kb-002。按边数打分天然偏向这种「什么都沾一点」的文章,需要像 IDF 那样给枢纽降权,或者改用 Personalized PageRank 之类从种子出发的打分。

二是知识库太小。20 篇文章、42 个块,rerank 模型一眼就能把相关的块挑出来,多跳问题的四篇文章各自和问题都有明显的字面重叠。图检索的优势要在几千篇以上、同一个实体散落在几十篇里的时候才显出来。

那第一题图检索为什么答得反而更好?因为回答用的是边,不是文章。看一下按关系精确查询的效果:

```bash
sqlite3 topics/graphrag/kg.db "SELECT head, doc_id FROM edges WHERE rel = '仅限' AND tail = '企业版'"
```

```text
增值税专用发票|kb-006
备份恢复|kb-018
开放 API|kb-019
```

一句查询,三项都是「仅限企业版」的独占功能,来源清清楚楚,不靠模型发挥。这才是图的正确用法:**枚举类、关系类问题按结构查,其余问题照旧走混合检索**。实际系统里常见的做法是把图检索当成第三路召回,和向量、BM25 一起送进 RRF(Day 18 那个函数直接能用),或者让 Agent 把「按关系查图」当一个工具,自己决定什么时候用。

## 第四步:社区摘要与 global search

global search 要先离线做两件事:把图切成社区,每个社区写一段摘要。

```python
# agent-60-lab/topics/graphrag/communities.py
"""global search 的准备:把图切成社区,每个社区让大模型写一段摘要,存进 kg.db。"""
import networkx as nx

from graph_search import G
from kg_common import chat, connect

SUMMARY_PROMPT = """下面是知识图谱里一组关系紧密的事实。用 3~5 句话总结这一组在讲什么,
保留所有具体数字和限制条件,最后一行写「涉及文章:kb-xxx, ...」。

事实:
{facts}"""


def main() -> None:
    undirected = nx.Graph(G.to_undirected())
    groups = nx.community.louvain_communities(undirected, seed=42)
    groups = [g for g in sorted(groups, key=len, reverse=True) if len(g) >= 3]
    with connect() as conn:
        conn.execute("DROP TABLE IF EXISTS communities")
        conn.execute("CREATE TABLE communities (id INTEGER PRIMARY KEY, size INTEGER, summary TEXT)")
        for i, nodes in enumerate(groups):
            facts = "\n".join(
                f"- {h} {d['rel']} {t}(原文:{d['evidence']})[{d['doc_id']}]"
                for h, t, d in G.subgraph(nodes).edges(data=True)
            )
            summary = chat([{"role": "user", "content": SUMMARY_PROMPT.format(facts=facts)}], temperature=0)
            conn.execute("INSERT INTO communities VALUES (?, ?, ?)", (i, len(nodes), summary))
            print(f"社区 {i}:{len(nodes)} 个实体 → {summary.splitlines()[0][:40]}…")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `undirected = nx.Graph(G.to_undirected())` Louvain 算法要普通无向图,这里把多重有向图压平:两点之间不管几条边、什么方向,都只算一条。
- `groups = nx.community.louvain_communities(undirected, seed=42)` Louvain 是经典的社区发现算法,思路是让「社区内部的边尽量多、社区之间的边尽量少」。它有随机性,`seed=42` 保证每次切法一样。微软 GraphRAG 用的是它的改进版 Leiden,还会切出多层(大社区套小社区)。
- `groups = [g for g in sorted(groups, key=len, reverse=True) if len(g) >= 3]` 按大小排序,只留 3 个实体以上的社区,小于 3 的大多是孤零零的一两条边,单独总结没意义。实测留下 20 个社区,最大的社区 0 有 31 个实体,讲的是套餐、价格和额度。
- `for h, t, d in G.subgraph(nodes).edges(data=True)` 子图只包含社区内部的边,跨社区的边不进摘要。
- `summary = chat([{"role": "user", "content": SUMMARY_PROMPT.format(facts=facts)}], temperature=0)` 每个社区一次调用,20 个社区就是 20 次。
- `print(f"社区 {i}:{len(nodes)} 个实体 → {summary.splitlines()[0][:40]}…")` 只打印摘要第一行的前 40 个字。实测社区 4 是「扣款失败后系统每24小时重试一次,最多重试3次,并进入7天宽限期…」。

</div>

然后是查询:

```python
# agent-60-lab/topics/graphrag/global_search.py
"""global search:每个社区摘要各答一遍(map),再把各段答案合成一份(reduce)。"""
import sys

from kg_common import chat, connect

MAP_PROMPT = """下面这段摘要只是全部资料里的一小块,别的部分由其他同事负责。
把这段摘要里和问题有关的内容都列出来,保留数字和 kb 编号;一条相关的都没有,才只输出「无」。

摘要:
{summary}"""

REDUCE_PROMPT = """下面是几位同事各自根据一部分资料给出的答案。合并成一份完整、不重复的回答,
按主题分组,保留每条的 kb 编号。

{partials}"""


def global_search(question: str) -> str:
    with connect() as conn:
        rows = conn.execute("SELECT id, summary FROM communities ORDER BY id").fetchall()
    partials = []
    for r in rows:
        part = chat([
            {"role": "system", "content": MAP_PROMPT.format(summary=r["summary"])},
            {"role": "user", "content": question},
        ], temperature=0).strip()
        if part != "无":
            partials.append(f"[社区 {r['id']}]\n{part}")
    print(f"{len(rows)} 个社区里有 {len(partials)} 个给出了内容")
    return chat([{"role": "user", "content": REDUCE_PROMPT.format(partials="\n\n".join(partials))
                  + f"\n\n问题:{question}"}], temperature=0)


if __name__ == "__main__":
    print(global_search(sys.argv[1] if len(sys.argv) > 1 else "帮助中心里所有带时间期限的规则,汇总成一张清单"))
```

<div class="line-notes">

- `MAP_PROMPT = """下面这段摘要只是全部资料里的一小块` 这一句是我踩坑后加的,下面正文细讲。
- `rows = conn.execute("SELECT id, summary FROM communities ORDER BY id").fetchall()` 读出全部 20 段摘要。`fetchall()` 在 `with` 里调用,连接关闭前把数据取完。
- `part = chat([` map 阶段:每段摘要独立回答一次。这 20 次调用互不依赖,生产里会用 Day 2 的 `asyncio.gather` 并发跑,这里为了好读写成了顺序的。
- `if part != "无":` 说「无」的社区丢掉,不进 reduce。实测 20 个里有 12 个给出了内容。
- `partials.append(f"[社区 {r['id']}]\n{part}")` 给每段答案标上来源社区,reduce 时模型知道这些是不同来源的。
- `return chat([{"role": "user", "content": REDUCE_PROMPT.format(partials="\n\n".join(partials))` reduce 阶段:一次调用把所有部分答案合并。社区多到几百个时,reduce 一次放不下,要分层合并(先每 10 个合一次,再合并结果)。

</div>

先跑 `uv run python topics/graphrag/communities.py`,再跑 `uv run python topics/graphrag/global_search.py`。

我第一版的 map 提示词是「根据下面这段摘要回答问题,摘要里没有相关内容就只输出无」,跑出来 22 个社区里**只有 3 个**给出了内容。单独拿「扣款失败、7 天宽限期」那个社区测,连跑两次都回答「无」。原因是问题问的是「帮助中心里**所有**带时间期限的规则」,模型看到自己手里只有一小段摘要,判断「我回答不了所有」,干脆说无。改成现在这版,明确告诉它「你只负责一小块,别的同事负责其余部分」,有内容的社区变成 20 个里 12 个。map-reduce 类的提示词都有这个坑,写的时候要让每个 map 知道自己是局部。

改完以后的结果(真实输出,节选):

```text
20 个社区里有 12 个给出了内容
## 三、退款与扣款
- 扣款失败后系统每 24 小时重试一次,最多重试 3 次(kb-004)
- 扣款失败后进入 7 天宽限期,宽限期内所有功能正常(kb-004)
...
## 六、发票相关
- 付款后需在 90 天内,通过「账单 → 发票」路径提交开票申请;……(kb-006)
- 发票开具后 30 天内,可在「账单 → 发票」里申请红冲并重新开具;……(kb-007)
...
## 八、账号注销
- 账号注销提交后有 30 天冷静期,期间可以随时撤销(kb-017)
```

覆盖面不错:宽限期、开票 90 天、红冲 30 天、注销冷静期、邀请链接 7 天、连续 5 次支付失败锁 1 小时都在,来自 9 篇不同的文章。混合检索 top-4 块不可能做到。

问题也很明显。一是混进了噪声:「免费版每月最多 200 条流水」「导出每天 20 次」是额度不是时限,也被列了进来。二是出处被污染:社区 0 的摘要末尾列了十篇文章,模型就把这十个编号原样贴在每一条后面。三是有漏项:kb-018 的「备份保留 30 天」没出现。这些都可以修(map 阶段要求逐条判断是否符合问题、出处只保留边上的 doc_id、社区切得更细),但你要知道 global search 的结果**需要评测**,不能看着清单很长就当它全对。Day 19 的召回率思路可以直接搬过来:人工列出 20 篇里所有时间期限规则作为标准答案,数一数覆盖了几条、混进了几条。

## 存到哪:SQLite、Postgres 还是 Neo4j

今天用 SQLite 一张边表加 networkx,适合几千条边以内、单机跑。往上走有三条路。

**Postgres 邻接表 + 递归 CTE。** 你已经有 Day 17 的 Postgres,边表直接建在那里,多跳查询用 `WITH RECURSIVE`。两三跳以内性能没问题,好处是不加新组件,向量、全文、图都在一个库里。LightRAG 推荐生产用 Postgres 也是这个原因。

**Apache AGE。** Postgres 扩展,能在 Postgres 里写 Cypher。现在(2026-10)最新还是 1.8.0 rc,我不建议正式项目用 rc 版。

**Neo4j。** 专门的图数据库,多跳查询、图算法(PageRank、社区发现)都内置。同样的「仅限企业版」查询用 Cypher 写是这样:

```text
MATCH (f)-[:仅限]->(p {name: '企业版'})
RETURN f.name
```

`()` 是点,`-[]->` 是带方向的边,读起来像画图。Neo4j 官方的 `neo4j-graphrag` 包把抽取、存储、检索都封装好了,还支持让大模型把自然语言问题翻译成 Cypher(Text2Cypher),思路和明天 Day 138 的 Text-to-SQL 一模一样。

我的建议是:原型阶段用今天这套,确认图检索在你的数据上真有收益(有评测数字),再决定上 Neo4j。很多团队一上来就部署 Neo4j,最后发现瓶颈在抽取质量,不在存储。

## 代码库也能建图

GraphRAG 有一个特别实用、又不用花一分钱的变种:给代码库建图。代码里的关系是确定的(谁 import 谁、谁调用谁),用语法解析就能抽准,不需要大模型。Coding Agent 的 repo map(Day 89 讲过)就是这类图。

```python
# agent-60-lab/topics/graphrag/code_graph.py
"""给代码库建一张「谁 import 谁」的图:不调大模型,用 ast 解析就够了。"""
import ast
import sys
from pathlib import Path

import networkx as nx

ROOT = Path(__file__).resolve().parents[2]


def build(folder: Path) -> nx.DiGraph:
    g = nx.DiGraph()
    local = {p.stem for p in folder.glob("*.py")}
    for path in folder.glob("*.py"):
        g.add_node(path.stem)
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module in local:
                names = [a.name for a in node.names]
                g.add_edge(path.stem, node.module, names=names)
            elif isinstance(node, ast.Import):
                for a in node.names:
                    if a.name in local:
                        g.add_edge(path.stem, a.name, names=[])
    return g


if __name__ == "__main__":
    folder = ROOT / (sys.argv[1] if len(sys.argv) > 1 else "w3")
    g = build(folder)
    print(f"{g.number_of_nodes()} 个模块,{g.number_of_edges()} 条 import 关系")
    print("被依赖最多:", sorted(g.in_degree, key=lambda x: -x[1])[:4])
    target = "chunking"
    print(f"改了 {target}.py 会影响:", sorted(nx.ancestors(g, target)))
```

<div class="line-notes">

- `import ast` Python 自带的语法树模块。它把源码解析成树,不执行代码,所以读任何文件都安全。TS 里对应的是 TypeScript Compiler API 或 Babel parser。
- `local = {p.stem for p in folder.glob("*.py")}` 本目录下所有模块名,用来区分「本地模块」和 `numpy`、`openai` 这种第三方包。实测 w3 有 30 个 .py 文件。
- `tree = ast.parse(path.read_text(encoding="utf-8"))` 整个文件变成一棵语法树。
- `for node in ast.walk(tree):` 遍历树上每个节点,不管嵌套多深(函数里的 import 也能找到)。
- `if isinstance(node, ast.ImportFrom) and node.module in local:` `from chunking import Chunk, load_chunks` 是 `ImportFrom`,`node.module` 是 `"chunking"`。
- `names = [a.name for a in node.names]` 导入的名字,比如 `['Chunk', 'load_chunks']`,存在边上,以后想精确到函数级就用得上。
- `elif isinstance(node, ast.Import):` `import retrieve` 这种写法。
- `print("被依赖最多:", sorted(g.in_degree, key=lambda x: -x[1])[:4])` 入度 = 被多少个文件导入。实测 `[('embed', 8), ('llm', 8), ('chunking', 5), ('pg_store', 4)]`。
- `sorted(nx.ancestors(g, target))` `ancestors` 是所有能沿边走到 chunking 的点,也就是直接或间接依赖它的文件。实测有 10 个:agentic_rag、bm25_index、build_index、compare_retrieval、eval_generation、eval_retrieval、mem_retriever、pg_sync、retrieve、subagent。

</div>

跑 `uv run python topics/graphrag/code_graph.py`,输出就是上面注释里的三行:30 个模块、43 条 import 关系;改了 `chunking.py` 要回归的文件有 10 个。把这个结果当成一个工具交给 Coding Agent,它在改代码前就知道影响面,Day 55 的代码审查 Agent 也可以用它判断「这个 diff 该看哪些测试」。函数级调用图可以用同样方法解析 `ast.Call`,或者直接用 tree-sitter 支持多种语言。

## 成本,以及什么时候值得上 GraphRAG

今天全部跑一遍大约是这些调用,按 `.env` 里 `LLM_PRICE=0.04,2,8`(元每百万 token,缓存命中/未命中/输出)估算,token 数是按字数估的:

```text
抽取:20 次 × (约 900 输入 + 约 800 输出) ≈ 1.8 万输入 + 1.6 万输出
社区摘要:20 次 × (约 600 输入 + 约 200 输出) ≈ 1.2 万输入 + 0.4 万输出
global search:21 次 × (约 400 输入 + 约 200 输出) ≈ 0.8 万输入 + 0.4 万输出
local search:每题 2 次,约 3000 输入 + 400 输出
合计约 4 万输入 × 2 元/百万 + 2.5 万输出 × 8 元/百万 ≈ 0.08 + 0.20 = 0.28 元
```

钱不多,但比例值得记住:**建图的输出 token 比输入还多**,因为模型要把三元组和证据一条条写出来。知识库变成 1 万篇文章,抽取就是 1 万次调用,按同样比例约 140 元,每次文章大改都要重抽。微软 README 里提醒「start small」就是这个原因。他们后来提出的 LazyGraphRAG 思路是建索引时不调大模型,只做便宜的名词短语抽取,把大模型推迟到查询时用。

什么时候值得上,我的判断标准是这几条,满足两条以上再考虑:

- 问题里经常出现「哪些」「所有」「和……有关的全部」这类枚举、汇总的问法,而且你的评测集证明混合检索在这类题上掉分。
- 领域里关系本身就是核心数据:药物和禁忌、法规条款之间的引用、公司股权关系、系统之间的依赖。
- 同一个实体散落在大量文档里,单篇文档只讲它的一部分。
- 能接受建图成本和更新延迟,并且有人负责抽查抽取质量。

不满足的话,先把 Day 18 的混合检索、Contextual Retrieval 和 Day 20 的 Agentic RAG(让 Agent 多搜几次)做好,性价比高得多。

## 动手练习

1. **跑通全流程**:按顺序运行 `extract.py`、`graph_search.py`(默认问题和多跳问题)、`compare.py`、`communities.py`、`global_search.py`、`code_graph.py`。把你自己的 `compare.py` 输出贴进笔记,和上面我的结果对比。验收:六个脚本都跑通;你的对比表里图检索和混合检索各对了几题,能说出差异的原因。
2. **抽查抽取质量**:随机挑 5 篇文章,人工判断每条边对不对(方向、事实、实体名),算出准确率。再列出每篇原文里你认为应该抽出、但没抽出来的事实。验收:一张表,至少 25 条边的判断,准确率和漏抽数各一个数字,并给出一条你打算加进提示词的规则。
3. **图定位 + 原文回答**:改 `graph_search.py`,新增 `answer_with_docs()`:用 `compare.py` 里的 `graph_docs()` 找出前 3 篇文章,把文章全文(或 Day 16 的块)而不是边交给模型回答。验收:多跳那道题的回答里出现「351 元」或「按剩余整月数」的算法说明,以及「优惠部分不退现金」。
4. **图作为第三路召回**:在 Day 18 的 `retrieve()` 里加一个 `use_graph` 参数,把 `graph_docs()` 返回的文章展开成块 id 列表,作为第三份名单送进 `rrf()`。验收:四道题的混合检索结果不变差(仍至少 8/9),并写一句你观察到的变化。
5. **给枢纽降权**(选做):把 `graph_docs()` 的打分改成「边分 ÷ log(1 + 该文章总边数)」,类似 IDF。验收:第一题图检索的召回从 2/4 提高,或者解释为什么没提高。
6. **实体合并**(选做):用 Day 15 的 `embed()` 给全部实体名做向量,余弦相似度大于 0.9 的列出来人工确认,确认后合并(改 `edges` 表里的名字)。验收:合并前后点的数量,以及多跳题的种子实体有没有变化。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 知识图谱(Knowledge Graph) | 用「实体-关系-实体」三元组表示知识的数据结构,实体是点,关系是有名字的边 |
| 三元组(triple) | (头实体,关系,尾实体),比如(开放 API,仅限,企业版) |
| GraphRAG | 用大模型自动建知识图谱,再用图来增强检索和回答的方法,微软 2024 年的论文让这个名字流行起来 |
| local search | 从问题里提到的实体出发,沿边扩展几跳,把邻近的事实交给模型回答 |
| global search | 对每个社区的摘要分别作答(map),再合并(reduce),回答全局性问题 |
| 社区发现(community detection) | 把图切成若干团,团内连接紧密、团间连接稀疏。常用 Louvain、Leiden 算法 |
| 实体链接(entity linking) | 把问题里的说法对应到图里的实体,比如「专票」对应「增值税专用发票」 |
| 实体消歧 / 合并 | 把同一个东西的不同叫法合成一个点 |
| ego graph | 以某个点为中心、半径 k 跳以内的子图 |
| 枢纽节点(hub) | 连接特别多的点,比如今天的「企业版」,会在各种查询里抢分 |
| Cypher | Neo4j 的图查询语言,`(a)-[:关系]->(b)` 的写法 |
| Apache AGE | 让 Postgres 支持图和 Cypher 的扩展 |
| repo map / 代码图 | 用语法解析得到的代码依赖关系图,Coding Agent 用它理解代码库 |

## 常见误区

**「GraphRAG 比向量 RAG 更先进,应该全面替换。」** 今天的对比里图检索找文章输给了混合检索。图是对向量检索的补充,擅长枚举、关系和全局总结,不是替代品。上不上要看你的评测集。

**「大模型抽出来的图是准确的。」** 方向反、漏事实、实体碎是常态,今天两次重建都出现了同样的错。不抽查就上线,图检索会把错误关系当事实讲给用户。

**「三元组能装下所有知识。」** 计算规则、条件、举例这类细节(468 元退 351 元)很难变成三元组。最终回答要回到原文,图只负责定位。

**「global search 列得越长越好。」** 清单长不代表全对,今天就混进了「每月 200 条流水」这种不相关的条目,还漏了备份保留 30 天。全局回答同样要有标准答案和评测。

**「做 GraphRAG 第一步是部署 Neo4j。」** 存储很少是瓶颈,抽取质量和检索策略才是。先用 SQLite 或 Postgres 验证收益。

**「建图只花一次钱。」** 文章改了要重抽,实体合并规则变了要重建,社区摘要也要跟着更新。估算成本时要把更新频率算进去。

## 学习资料

### 文档与文章

- [From Local to Global: A Graph RAG Approach to Query-Focused Summarization](https://arxiv.org/abs/2404.16130):微软 GraphRAG 论文。读第 2 节(流程)和第 3 节的评测方法,注意他们评的是「全局总结类问题」,不是普通问答。1 小时。
- [Microsoft GraphRAG 官方文档 · Query Engine](https://microsoft.github.io/graphrag/query/overview/):local、global、DRIFT、basic 四种查询方式各一句话的官方说明,15 分钟。
- [microsoft/graphrag README](https://github.com/microsoft/graphrag):看开头那段维护状态说明和成本提醒,5 分钟。
- [LightRAG 论文](https://arxiv.org/abs/2410.05779):轻量版 GraphRAG 的思路,双层检索(低层实体、高层主题)那一节和今天的 local/global 对应。40 分钟。
- [networkx · louvain_communities](https://networkx.org/documentation/stable/reference/algorithms/generated/networkx.algorithms.community.louvain.louvain_communities.html):今天用的社区发现函数,看 `resolution` 参数,它控制切得粗还是细。
- [Neo4j Cypher 手册 · Introduction](https://neo4j.com/docs/cypher-manual/current/introduction/):想上 Neo4j 时读,先看 MATCH 和模式写法。
- [Anthropic · Introducing Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval):上 GraphRAG 之前先试的便宜方案,Day 18 读过的可以跳过。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1zoKuzoENM&autoplay=0&high_quality=1" title="AI知识图谱 GraphRAG 是怎么回事?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>隔壁的程序员老王 · AI知识图谱 GraphRAG 是怎么回事? · 14 分钟,先看这个建立直觉,讲了为什么向量检索答不好全局问题。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1fYZaBAEKZ&autoplay=0&high_quality=1" title="【RAG】15分钟跑通GraphRAG完整流程:从知识图谱构建到Global和Local Search问答GraphRAG实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>认真工作的JIA · 15分钟跑通GraphRAG完整流程 · 16 分钟,用微软 GraphRAG 官方工具走一遍 init、index、query,看完再对照今天自己写的版本,就知道框架替你做了哪些事。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/c5qJHr3DnT4" title="GraphRAG methods to create optimized LLM context windows for Retrieval — Jonathan Larson, Microsoft" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · Jonathan Larson(微软研究院 GraphRAG 团队)· GraphRAG methods to create optimized LLM context windows · 原作者讲为什么要做社区摘要、怎么评测,重点看他对成本和适用场景的说法。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Za7aG-ooGLQ" title="GraphRAG Explained: AI Retrieval with Knowledge Graphs & Cypher" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>IBM Technology · GraphRAG Explained: AI Retrieval with Knowledge Graphs & Cypher · 白板讲解,Text2Cypher 那部分正好衔接明天的 Text-to-SQL。</figcaption>
</figure>

### 书籍

- Tomaž Bratanič、Oskar Hane《Essential GraphRAG》(Manning,2025)。176 页的小书,读讲「把自然语言转成 Cypher」和「Microsoft GraphRAG 流程」的两章,书里用 Neo4j,正好补今天没展开的存储部分。目前没查到中译本。
- Jesús Barrasa、Jim Webber《Building Knowledge Graphs: A Practitioner's Guide》(O'Reilly,2023)。知识图谱建模的工程书,读前三章(组织原则、图数据库基础),想深入建模时再读后面。
- Chip Huyen《AI Engineering》(O'Reilly,2025)第 6 章 RAG 部分,对比了不同检索方式的取舍,可以和今天的结论对照。

### 开源项目与代码

- [microsoft/graphrag](https://github.com/microsoft/graphrag):官方实现,看 `prompts/` 目录里的抽取和社区报告提示词,比今天的长得多,能学到很多抽取规则的写法。
- [HKUDS/LightRAG](https://github.com/HKUDS/LightRAG):想直接用现成框架时首选,带 WebUI,存储可以全放 Postgres。
- [neo4j/neo4j-graphrag-python](https://github.com/neo4j/neo4j-graphrag-python):Neo4j 官方的 GraphRAG 包,含 Text2Cypher 检索器。
- [apache/age](https://github.com/apache/age):Postgres 图扩展,关注 1.8.0 正式版什么时候出。

## 自测

1. 向量检索在哪三类问题上吃亏?各举一个 CloudLedger 的例子。

<details><summary>答案</summary>

多跳问题(优惠码买的年付专业版、开过专票、想退款,答案散在 kb-002/003/006/008);枚举问题(哪些功能只有企业版才有,散在 kb-001/006/018/019);全局问题(所有带时间期限的规则,散在全部文章)。共同点是答案不集中在少数几块里,或者每一块和问题都不太像。

</details>

2. 今天的对比里,图检索找文章的召回为什么比混合检索低?

<details><summary>答案</summary>

两个原因。一是枢纽节点 kb-001 和几乎所有套餐实体都有边,按边数打分时总排在前面,挤掉了 kb-019、kb-002;二是知识库只有 20 篇,rerank 足以挑出相关块,图的优势要在实体散落在大量文档里时才明显。另外抽取丢了事实(kb-008 的退款规则),图里没有的东西也找不到。

</details>

3. 第一版 map 提示词为什么让大部分社区回答「无」?怎么改的?

<details><summary>答案</summary>

问题问「所有」带时间期限的规则,每个 map 只看到一小段摘要,模型判断自己答不了「所有」,就说无。改成明确告诉它「这段只是全部资料的一小块,其他部分别人负责,把和问题有关的都列出来,一条都没有才说无」。有内容的社区从 3 个变成 12 个。

</details>

4. 为什么说「图负责定位,原文负责回答」?

<details><summary>答案</summary>

三元组装不下计算规则、条件和例子,比如「468 元退 351 元」「优惠部分不退现金」都没进图。只用边回答,模型会说「帮助中心没写」或者给出错误结论。用图找到该看的文章,再把原文交给模型,两边的长处都用上了。

</details>

5. 给代码库建图为什么可以不用大模型?这张图能给 Agent 带来什么?

<details><summary>答案</summary>

代码里的 import 和调用关系是确定的,用 `ast` 或 tree-sitter 解析就能百分之百准确地抽出来,不需要大模型去「理解」。有了这张图,Agent 改代码前能查影响面(改 chunking.py 会影响 10 个文件)、审查 diff 时能挑该跑的测试、回答「这个函数在哪被用到」时不用全仓库 grep。

</details>

6. **面试题**:你们的客服知识库 RAG 效果还行,但产品经理说「问汇总类问题经常漏」,有人提议上 GraphRAG。你怎么推进?

<details><summary>答案</summary>

先量化:从线上日志和评测集里挑出汇总、枚举类问题,做一份带标准答案的小测试集,测现有混合检索的召回和回答覆盖率,确认问题确实存在、有多严重。然后小规模验证:挑一个子领域(比如计费规则几百篇文档)建图,人工抽查抽取准确率,先做成第三路召回接进 RRF,或者给 Agent 一个按关系查图的工具,用同一份测试集对比。同时算清楚成本:建图调用次数、文档更新频率带来的重抽成本、延迟。指标确实提升、成本可接受,再扩大范围、考虑换 Neo4j 之类的存储。整个过程中,汇总类回答要保留出处,方便用户和客服核对。

</details>

## 明天预告

Day 138 · 问数 Agent:Text-to-SQL、语义层与结果校验。今天你把文档变成了图,明天换一种结构化数据:直接让 Agent 对 CloudLedger 的业务库写 SQL,回答「现在的 MRR 是多少」「哪几家公司欠费」。重点不在让模型会写 SQL,而在怎么把业务口径告诉它、怎么让它只读不写、怎么验证查出来的数是对的。专题篇可以跳着读,明天这课建议在 Day 23 之后读。
