---
title: 'Day 252 · GraphRAG(一):用大模型抽三元组'
description: 'Day 250 的 16 条三元组是手写的,今天换大模型来抽:先看它交回一段带 ```json 的文字把 json.loads 弄崩,再看它三篇文章造出 28 种关系,然后用关系白名单抽完 20 篇存进 SQLite,用类型规则抓出 32 条可疑的边,把方向写进提示词后降到 3 条。全程花了一毛多钱。'
pubDate: 2026-10-22
regime: none
tags: ['graphrag', 'knowledge-graph', 'rag', 'sqlite', 'agent-zero']
series: 'agent-zero'
day: 252
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 251](/blog/agent-zero/day-251-week36-review/) 是第 36 周的复习,小项目用 `ast` 把练习仓库里的 import 关系抽成三元组,回答「改了这个文件会影响谁」。代码有语法树,`ast` 抽出来的每一条关系都是确定的,一条都不会错。

帮助中心的文章是自然语言,没有语法树。[Day 250](/blog/agent-zero/day-250-kg-basics/) 的 16 条三元组是我一句句读着写的,20 篇文章还写得过来,两千篇就不可能了。今天把这活交给大模型,看它抽得怎么样,错在哪,怎么用代码把错抓出来。

## 今天要解决的问题

学完你应该能做到:

1. 说清楚 GraphRAG 分哪几步,今天做的「抽三元组」在整条流水线里的位置。
2. 用 `LLMClient` 加 JSON mode,让模型从一篇文章里抽出带出处的三元组,并且知道为什么一定要给关系白名单。
3. 把 20 篇帮助中心文章抽成一张图存进 SQLite,用类型规则自动找出方向写反、关系乱用的边。
4. 通过改提示词把可疑的边从 32 条降到 3 条,并说出这样做付出了什么代价。

预计用时 2.5 小时。API 花费约 ¥0.15(主线 ¥0.11,练习约 ¥0.03,算式在后面)。

前置:[Day 250](/blog/agent-zero/day-250-kg-basics/) 的三元组和 `part04/kg_triples.py`(今天拿它当标准答案),[Day 136](/blog/agent-zero/day-136-llm-client-2/) 的 `common/llm.py`(`LLMClient`),[Day 148](/blog/agent-zero/day-148-structured-2/) 的 JSON mode,[Day 151](/blog/agent-zero/day-151-structured-5/) 讲过的抽取的坑,[Day 222](/blog/agent-zero/day-222-kb-data/) 造的帮助中心 `data/kb/`(20 篇,今天只读不改),[Day 124](/blog/agent-zero/day-124-cost/) 的算钱和缓存价。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `kg_extract.py` 的 `extract()` 和 `kg_check.py` 的 `problems()`;做练习,做不出再展开参考答案,看完关掉重写一遍。

## GraphRAG 是什么,今天在哪一步

Day 250 讲过,GraphRAG 是 2024 年微软一篇论文([From Local to Global: A Graph RAG Approach to Query-Focused Summarization](https://arxiv.org/abs/2404.16130))带火的说法:用大模型自动从文本里抽三元组建图,再用图去增强检索和回答。说白了就是 Day 250 的事,只是「建图」这一步从人手换成了模型。

整条流水线分两段。建图是一次性的,也是花钱的大头;查询分两种,问具体事情用 local search,问整体用 global search。这个分法是微软论文定的,后来的 LightRAG 等工具基本都沿用。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="GraphRAG 流程:建图阶段大模型逐篇抽三元组存进 kg_llm.db,再切社区写摘要;查询阶段 local search 从实体沿边走,global search 对社区摘要做 map-reduce。今天做的是抽三元组这一格">
<rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)"/>
<defs><marker id="gr252a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--ink-soft)"/></marker></defs>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink-faint)">建图(一次性,花钱的大头)</text>
<rect x="20" y="38" width="110" height="34" rx="4" fill="none" stroke="var(--compute)"/>
<text x="75" y="60" fill="var(--ink)" text-anchor="middle">20 篇文章</text>
<line x1="130" y1="55" x2="168" y2="55" stroke="var(--ink-soft)" marker-end="url(#gr252a)"/>
<rect x="170" y="34" width="130" height="42" rx="4" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="2.5"/>
<text x="235" y="53" fill="var(--ink)" text-anchor="middle">LLM 抽三元组</text>
<text x="235" y="69" fill="var(--mem)" text-anchor="middle" font-size="11">今天 Day 252</text>
<line x1="300" y1="55" x2="338" y2="55" stroke="var(--ink-soft)" marker-end="url(#gr252a)"/>
<rect x="340" y="38" width="110" height="34" rx="4" fill="none" stroke="var(--compute)"/>
<text x="395" y="60" fill="var(--ink)" text-anchor="middle">kg_llm.db</text>
<line x1="450" y1="55" x2="488" y2="55" stroke="var(--ink-soft)" marker-end="url(#gr252a)"/>
<rect x="490" y="38" width="130" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="555" y="60" fill="var(--ink)" text-anchor="middle">社区 + 摘要</text>
<text x="20" y="112" fill="var(--ink-faint)">local search(具体问题,Day 253)</text>
<rect x="20" y="124" width="110" height="34" rx="4" fill="none" stroke="var(--ink-soft)"/>
<text x="75" y="146" fill="var(--ink)" text-anchor="middle">问题</text>
<line x1="130" y1="141" x2="168" y2="141" stroke="var(--ink-soft)" marker-end="url(#gr252a)"/>
<rect x="170" y="124" width="130" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="235" y="146" fill="var(--ink)" text-anchor="middle">认出实体</text>
<line x1="300" y1="141" x2="338" y2="141" stroke="var(--ink-soft)" marker-end="url(#gr252a)"/>
<rect x="340" y="124" width="110" height="34" rx="4" fill="none" stroke="var(--compute)"/>
<text x="395" y="146" fill="var(--ink)" text-anchor="middle">沿边走两步</text>
<line x1="450" y1="141" x2="488" y2="141" stroke="var(--ink-soft)" marker-end="url(#gr252a)"/>
<rect x="490" y="124" width="130" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="555" y="146" fill="var(--ink)" text-anchor="middle">带证据回答</text>
<text x="20" y="198" fill="var(--ink-faint)">global search(全局问题,Day 254)</text>
<rect x="20" y="210" width="110" height="34" rx="4" fill="none" stroke="var(--ink-soft)"/>
<text x="75" y="232" fill="var(--ink)" text-anchor="middle">问题</text>
<line x1="130" y1="227" x2="168" y2="227" stroke="var(--ink-soft)" marker-end="url(#gr252a)"/>
<rect x="170" y="210" width="130" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="235" y="232" fill="var(--ink)" text-anchor="middle">每个社区各答</text>
<line x1="300" y1="227" x2="338" y2="227" stroke="var(--ink-soft)" marker-end="url(#gr252a)"/>
<rect x="340" y="210" width="110" height="34" rx="4" fill="none" stroke="var(--ink-soft)"/>
<text x="395" y="232" fill="var(--ink)" text-anchor="middle">去掉「无」</text>
<line x1="450" y1="227" x2="488" y2="227" stroke="var(--ink-soft)" marker-end="url(#gr252a)"/>
<rect x="490" y="210" width="130" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="555" y="232" fill="var(--ink)" text-anchor="middle">合并成一份</text>
</g>
</svg>
<figcaption>GraphRAG 三天的分工。蓝框是要调大模型的步骤,琥珀框是代码和数据库。今天只做加粗的那一格;后面每一步的质量都压在它身上,抽错了,查询写得再好也没用。</figcaption>
</figure>

现成的工具我 2026 年 10 月在 PyPI 上查了一遍:微软的 `graphrag` 最新 3.3.0(2026-10-08),但它的 [README](https://github.com/microsoft/graphrag) 开头写着项目「largely in maintenance mode」,不再接新功能,只修 bug 和安全问题,并且反复提醒建索引很贵,要从小规模开始;香港大学的 LightRAG(包名 `lightrag-hku`)最新 1.5.7(2026-09-02);Neo4j 官方的 `neo4j-graphrag` 是 1.22.0(2026-10-01)。

这三天不用框架,用 SQLite 加几十行 Python 自己写一遍。原因很简单:框架里这一步就是一段很长的提示词加一个 JSON 解析,自己写过一次,再去看 LightRAG 的 [prompt.py](https://github.com/HKUDS/LightRAG/blob/main/lightrag/prompt.py),每一条规则为什么要写你都能看懂。

## 第一步:最小的抽取,先看它怎么崩

先用最笨的写法:system 里一句话「抽三元组,用 JSON 输出」,把 kb-019 整篇丢进去,拿回来直接 `json.loads`。kb-019 是开放 API 那篇,就两小节:「开放 API 仅对企业版开放」「每个 API Key 每分钟最多 60 次请求,超过返回 HTTP 429,错误码 E4029」。

在 `agent-zero-lab/` 下新建 `part04/kg_llm_first.py`。`.env` 里的 `LLM_BASE_URL / LLM_API_KEY / LLM_MODEL` 还是 Day 120 配的 DeepSeek,模型名 `deepseek-flash`。

```python
# agent-zero-lab/part04/kg_llm_first.py  第一次让大模型抽三元组:只给一句话的要求,看它交回来什么
import json
from pathlib import Path

from common.llm import LLMClient

client = LLMClient()
text = Path("data/kb/kb-019.md").read_text(encoding="utf-8")

r = client.chat([
    {"role": "system", "content": "从用户给的文章里抽出知识图谱三元组,用 JSON 输出。"},
    {"role": "user", "content": text},
], temperature=0)

print(r.content)
print("---")
print(client.ledger)
data = json.loads(r.content)
print(type(data))
```

<div class="line-notes">

- `from common.llm import LLMClient` Day 135–136 写的封装。`chat()` 返回 `ChatResult`,里面有 `content`(模型回的文字)、`prompt_tokens`、`cost` 等字段;`client.ledger` 自动累计花了多少。
- `text = Path("data/kb/kb-019.md").read_text(encoding="utf-8")` 相对路径,所以要在 `agent-zero-lab/` 下运行。整篇连 frontmatter 一起读进来,一共 174 个字符。
- `{"role": "system", "content": "从用户给的文章里抽出知识图谱三元组,用 JSON 输出。"},` 只有一句要求,没说字段叫什么、关系有哪些。这就是大多数人第一次写的样子。
- `], temperature=0)` 温度 0,让输出尽量稳定(Day 110)。「尽量」两个字后面会兑现。
- `print(r.content)` 先打印原文,再解析。解析失败时你才看得到模型到底交回了什么。
- `data = json.loads(r.content)` 把字符串解析成 Python 对象,相当于 JS 的 `JSON.parse`。

</div>

```bash
uv run python -m part04.kg_llm_first
```

真实输出(stdout 和报错我按出现的先后排好了):

````text
```json
[
  {
    "subject": "开放 API",
    "predicate": "仅对",
    "object": "企业版"
  },
  {
    "subject": "开放 API",
    "predicate": "创建位置",
    "object": "设置 → 开发者"
  },
  {
    "subject": "API Key",
    "predicate": "速率限制",
    "object": "每分钟最多 60 次请求"
  },
  {
    "subject": "超过速率限制",
    "predicate": "返回",
    "object": "HTTP 429"
  },
  {
    "subject": "HTTP 429",
    "predicate": "错误码",
    "object": "E4029"
  },
  {
    "subject": "超过速率限制",
    "predicate": "建议操作",
    "object": "等待一分钟后重试"
  }
]
```
---
1 次调用 | 输入 107 / 输出 194 tokens | 约 ¥0.0018
Traceback (most recent call last):
  File ".../part04/kg_llm_first.py", line 18, in <module>
    data = json.loads(r.content)
  ...
json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)
````

内容其实抽得不坏,6 条都有道理。崩在第一个字符上:模型很「贴心」地给 JSON 包了一层 Markdown 的 ```` ```json ```` 代码围栏,`json.loads` 读到第一个字符是反引号,直接报 `Expecting value: line 1 column 1 (char 0)`。这个报错 Day 148 见过一次,在抽取场景里它最常见。

除了崩溃,还有两件事要记下来。第一,字段名是模型自己起的(`subject / predicate / object`,这是 RDF 的叫法),换一篇文章它可能又叫 `head / relation / tail`,代码没法写。第二,关系也是它自己起的:「仅对」「创建位置」「速率限制」「返回」「错误码」「建议操作」,6 条用了 6 种。这一点下一步会放大。

## 第二步:打开 JSON mode,规定字段

修第一个问题很直接:用 Day 148 学的 JSON mode,传 `response_format={"type": "json_object"}`,DeepSeek 保证返回的是一个能解析的 JSON 对象(DeepSeek 的 [JSON Output 文档](https://api-docs.deepseek.com/zh-cn/guides/json_mode)要求提示词里出现「json」字样并给出格式样例)。字段名在提示词里写死。这次抽三篇:kb-001(套餐价格)、kb-006(发票)、kb-019(开放 API),顺便数一数一共出现了多少种关系。

```python
# agent-zero-lab/part04/kg_llm_json.py  打开 JSON mode、规定字段,抽三篇文章,数一数模型用了多少种关系
import json
from collections import Counter
from pathlib import Path

from common.llm import LLMClient

SYSTEM = """从用户给的文章里抽出知识图谱三元组。只输出 JSON,格式:
{"triples": [{"head": "...", "rel": "...", "tail": "..."}]}"""

client = LLMClient()
rels: Counter[str] = Counter()
for doc_id in ["kb-001", "kb-006", "kb-019"]:
    text = Path(f"data/kb/{doc_id}.md").read_text(encoding="utf-8")
    r = client.chat(
        [{"role": "system", "content": SYSTEM}, {"role": "user", "content": text}],
        response_format={"type": "json_object"},
        temperature=0,
    )
    triples = json.loads(r.content)["triples"]
    print(f"{doc_id}: {len(triples)} 条")
    for t in triples[:4]:
        print(f"  ({t['head']}, {t['rel']}, {t['tail']})")
    rels.update(t["rel"] for t in triples)

print(f"三篇一共用了 {len(rels)} 种关系:", "、".join(rels))
print(client.ledger)
```

<div class="line-notes">

- `from collections import Counter` `Counter` 是专门计数的 dict:键是东西,值是出现次数,没出现过的键默认是 0。和 Day 250 的 `defaultdict` 是一家人。JS 里你得自己写 `counts[k] = (counts[k] ?? 0) + 1`。
- `{"triples": [{"head": "...", "rel": "...", "tail": "..."}]}"""` 给一个格式样例,字段名用 Day 250 的 head/rel/tail。外面套一层 `{"triples": ...}`,因为 JSON mode 要求顶层是对象,不能直接是数组。
- `rels: Counter[str] = Counter()` 准备数关系。
- `response_format={"type": "json_object"},` 这一行就是 JSON mode,第一步的代码围栏问题从此消失。
- `triples = json.loads(r.content)["triples"]` 这次能直接解析了。
- `for t in triples[:4]:` 每篇只打印前 4 条,不然屏幕放不下(kb-001 抽了 25 条)。
- `rels.update(t["rel"] for t in triples)` `update` 接一串东西,每个加 1。括号里是生成器表达式,和列表推导式一样,只是不建列表。
- `print(f"三篇一共用了 {len(rels)} 种关系:", "、".join(rels))` `Counter` 遍历时按第一次出现的顺序给出键。

</div>

```bash
uv run python -m part04.kg_llm_json
```

```text
kb-001: 25 条
  (CloudLedger, 提供套餐, 免费版)
  (CloudLedger, 提供套餐, 专业版)
  (CloudLedger, 提供套餐, 企业版)
  (免费版, 账本数量, 1 个账本)
kb-006: 9 条
  (付费订单, 可以开具, 电子普通发票)
  (增值税专用发票, 仅限, 企业版)
  (增值税专用发票, 仅限, 年付的专业版)
  (发票申请, 提交位置, 账单 → 发票)
kb-019: 6 条
  (开放 API, 仅对, 企业版)
  (API Key, 创建于, 设置 → 开发者)
  (API Key, 速率限制为, 每分钟最多 60 次请求)
  (超过速率限制, 返回, HTTP 429)
三篇一共用了 28 种关系: 提供套餐、账本数量、每月流水上限、成员上限、月付价格、年付价格、年付折合月价、账本上限、流水限制、支持功能、账本限制、成员限制、包含功能、推荐套餐、可以开具、仅限、提交位置、提交时限、需要填写、开出时限、发送至、不再支持、仅对、创建于、速率限制为、返回、对应错误码、建议
3 次调用 | 输入 604 / 输出 956 tokens | 约 ¥0.0089
```

三篇文章,40 条三元组,**28 种关系**。

这就是不给白名单的后果。「账本数量」「账本上限」「账本限制」说的是一回事,kb-006 用了「仅限」,kb-019 用了「仅对」,也是一回事。Day 250 的 `find(rel="仅限", tail="企业版")` 在这张图上只能找到专票,开放 API 那条叫「仅对」,找不到。关系名字不统一,图就没法按关系查,枚举题(Day 250 说图最擅长的那类题)直接废了。

还有一条更隐蔽的错,在 kb-006:原文「增值税专用发票仅限企业版,或年付的专业版」被拆成了两条「仅限」。单看每条都像原文,合起来就是错的:按「仅限企业版」查,专票会被当成企业版独有。Day 250 我手写时专门把它写成「可开给」,就是为了躲这个坑,模型一下就踩进去了。

## 第三步:关系白名单,抽完 20 篇存进 SQLite

改法是给一份关系白名单(whitelist):只允许用这几种关系,原文表达不了的就不抽。白名单不在代码里校验一遍等于没给,因为模型不一定听话,所以代码里再过滤一次,不在名单上的扔掉并记下来。

先写一个三天共用的小模块,放路径、白名单和建表语句。

```python
# agent-zero-lab/part04/kg_store.py  GraphRAG 三天共用:关系白名单、图数据库的建表和读取
import sqlite3
from pathlib import Path

KB_DIR = Path("data/kb")
KG_DB = Path("part04/data/kg_llm.db")

RELATIONS = [
    "年付价格", "月付价格", "包含", "仅限", "可用于", "不适用于",
    "需要先", "需要", "不支持", "发生在", "解决办法", "时限", "上限",
]


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(KG_DB)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS edges (
            head     TEXT NOT NULL,
            rel      TEXT NOT NULL,
            tail     TEXT NOT NULL,
            evidence TEXT NOT NULL,
            doc_id   TEXT NOT NULL,
            UNIQUE (head, rel, tail, doc_id)
        )""")
    return conn


def load_edges() -> list[sqlite3.Row]:
    with connect() as conn:
        return conn.execute("SELECT head, rel, tail, evidence, doc_id FROM edges").fetchall()
```

<div class="line-notes">

- `KG_DB = Path("part04/data/kg_llm.db")` 模型建的图单独一个库,不和 Day 250 手写的 `kg.db` 混在一起,两张图后面要对比。
- `RELATIONS = [` 13 种关系。前 9 种基本是 Day 250 手写时用过的,「可开给」换成了更通用的「可用于」;后面加了「解决办法」「时限」「上限」,因为帮助中心里大量是错误码怎么修、多少天内、最多几次这类事实,Day 254 汇总时限要用到「时限」。
- `conn.row_factory = sqlite3.Row` 查出来的每一行可以按列名取,`row["head"]`,不用记第几列。相当于 JS 里拿到对象而不是数组。
- `evidence TEXT NOT NULL,` 比 Day 250 多一列:原文证据,模型抄的那一句。抽查时靠它判断边对不对,回答时也能直接引用。
- `UNIQUE (head, rel, tail, doc_id)` 同一篇文章里同一条边只存一次。不同文章说了同一件事会各存一条,这样每条边都能追到出处。
- `def load_edges() -> list[sqlite3.Row]:` 读出所有边,Day 253、254 的代码都从这里取图。
- `with connect() as conn:` sqlite3 的连接用在 `with` 里,出来时自动提交事务(注意:不会自动关闭连接,这里脚本很短,无所谓)。

</div>

然后是抽取脚本。提示词里四条规则,每一条对应上一步看到的一个问题。

```python
# agent-zero-lab/part04/kg_extract.py  逐篇读帮助中心,让大模型按关系白名单抽三元组,存进 kg_llm.db
import json
from pathlib import Path

from common.llm import LLMClient
from part04.kg_store import KB_DIR, KG_DB, RELATIONS, connect

SYSTEM = f"""你在给记账 SaaS「CloudLedger」的帮助中心建知识图谱。
从文章里抽出三元组,只输出 JSON:
{{"triples": [{{"head": "...", "rel": "...", "tail": "...", "evidence": "..."}}]}}

规则:
- rel 只能是这些之一:{"、".join(RELATIONS)}。原文表达不了的关系就不抽,不要发明新关系。
- 套餐统一叫「免费版」「专业版」「企业版」;原文写「年付的专业版」就写「年付专业版」。
- 实体名用最短的说法,比如「增值税专用发票」,不要写成「增值税专用发票的开具」。
- evidence 原样抄原文里支撑这条三元组的那一句,不超过 60 字。
"""


def extract(client: LLMClient, path: Path, system: str) -> list[dict[str, str]]:
    r = client.chat(
        [{"role": "system", "content": system},
         {"role": "user", "content": path.read_text(encoding="utf-8")}],
        response_format={"type": "json_object"},
        temperature=0,
    )
    return json.loads(r.content).get("triples", [])


def main(system: str = SYSTEM) -> None:
    KG_DB.unlink(missing_ok=True)
    client = LLMClient()
    conn = connect()
    dropped: list[str] = []
    for path in sorted(KB_DIR.glob("kb-*.md")):
        doc_id = path.stem
        kept = 0
        for t in extract(client, path, system):
            if t.get("rel") not in RELATIONS:
                dropped.append(f"{doc_id} ({t.get('head')}, {t.get('rel')}, {t.get('tail')})")
                continue
            conn.execute(
                "INSERT OR IGNORE INTO edges VALUES (?, ?, ?, ?, ?)",
                (t["head"], t["rel"], t["tail"], t.get("evidence", ""), doc_id),
            )
            kept += 1
        conn.commit()
        print(f"{doc_id}: {kept} 条", end="  ")
    print()
    total = conn.execute("SELECT count(*) FROM edges").fetchone()[0]
    nodes = conn.execute("SELECT count(*) FROM (SELECT head FROM edges UNION SELECT tail FROM edges)").fetchone()[0]
    print(f"合计 {total} 条边、{nodes} 个实体;丢掉白名单外的 {len(dropped)} 条:")
    for d in dropped:
        print("  ", d)
    print(client.ledger)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `SYSTEM = f"""你在给记账 SaaS「CloudLedger」的帮助中心建知识图谱。` 这是个 f-string,因为要把白名单拼进去。第一句交代背景,模型知道「套餐」「发票」是这家公司的业务词。
- `{{"triples": [{{"head": "...", "rel": "...", "tail": "...", "evidence": "..."}}]}}` f-string 里要输出字面量的大括号,得写成两个:`{{` 输出 `{`。这是最容易敲错的一行,少写一个会报 `ValueError` 或者 `NameError`。
- `- rel 只能是这些之一:{"、".join(RELATIONS)}。` 拼出来是「年付价格、月付价格、包含……上限」。后半句「原文表达不了的关系就不抽」很重要,不写的话模型会硬套,把不相干的事实塞进某个关系里。
- `- 套餐统一叫「免费版」「专业版」「企业版」` 实体归一化最便宜的办法:在提示词里点名。上一步 kb-006 抽出了「年付的专业版」,kb-002 里又叫「年付专业版」,不统一就是图里两个点。
- `- evidence 原样抄原文里支撑这条三元组的那一句` 要原样抄,不要概括。概括过的证据你没法拿去和原文比对。
- `def extract(client: LLMClient, path: Path, system: str) -> list[dict[str, str]]:` 一篇文章调一次模型。`system` 做成参数,因为第五步要换一版提示词再抽一次。
- `return json.loads(r.content).get("triples", [])` 用 `.get` 而不是 `["triples"]`:模型偶尔返回一个空对象 `{}`,`.get` 给空列表,不至于整个脚本崩掉。
- `KG_DB.unlink(missing_ok=True)` 每次全量重建,保证结果只来自这一次运行。
- `for path in sorted(KB_DIR.glob("kb-*.md")):` `glob` 找出 20 个文件,`sorted` 保证按 kb-001 到 kb-020 的顺序。
- `doc_id = path.stem` `stem` 是去掉扩展名的文件名,`kb-019.md` 得到 `kb-019`。
- `if t.get("rel") not in RELATIONS:` 代码里的第二道关。不在白名单的关系不入库,记进 `dropped` 最后打印,让你知道模型违规了多少次。
- `"INSERT OR IGNORE INTO edges VALUES (?, ?, ?, ?, ?)",` 撞上 `UNIQUE` 约束就跳过,不报错。`?` 占位符防注入,Day 92 讲过。
- `print(f"{doc_id}: {kept} 条", end="  ")` `end="  "` 让每篇的结果打印在同一行,用两个空格隔开。
- `nodes = conn.execute("SELECT count(*) FROM (SELECT head FROM edges UNION SELECT tail FROM edges)").fetchone()[0]` 实体数 = 头和尾去重后的个数。`UNION` 本身就会去重。
- `print(client.ledger)` 20 次调用的总账。

</div>

```bash
uv run python -m part04.kg_extract
```

我这里 20 次调用用了 27 秒:

```text
kb-001: 14 条  kb-002: 10 条  kb-003: 3 条  kb-004: 6 条  kb-005: 4 条  kb-006: 7 条  kb-007: 4 条  kb-008: 2 条  kb-009: 13 条  kb-010: 5 条  kb-011: 4 条  kb-012: 6 条  kb-013: 5 条  kb-014: 5 条  kb-015: 8 条  kb-016: 5 条  kb-017: 4 条  kb-018: 7 条  kb-019: 4 条  kb-020: 5 条  
合计 121 条边、163 个实体;丢掉白名单外的 0 条:
20 次调用 | 输入 6581 / 输出 5130 tokens | 约 ¥0.0542
```

白名单这次一条都没违反。121 条边、163 个实体,实体比边还多,说明很多实体只挂着一条边,这张图很「散」,先记住,Day 254 切社区时会看到它的后果。

## 第四步:抽查,用代码而不是用眼睛

121 条边,一条条读也读得完,但两千篇文章时就读不完了。Day 250 练习 4 写过一种检查:「仅限」这种关系的尾实体一定是套餐。今天把它扩成几条类型规则,再拿 Day 250 手写的 16 条当标准答案对一下。

先肉眼看几条,心里有个数。在 `agent-zero-lab/` 下:

```bash
sqlite3 part04/data/kg_llm.db "SELECT doc_id, head, rel, tail FROM edges WHERE doc_id IN ('kb-001','kb-002','kb-003','kb-006','kb-008','kb-010','kb-011','kb-018','kb-019')"
```

输出有五十多行,我只摘出 kb-003、kb-018、kb-019 三篇的行,顺序保持原样:

```text
kb-019|API Key|上限|每分钟 60 次请求
kb-018|专业版|不支持|备份恢复
kb-018|企业版|可用于|备份恢复
kb-018|免费版|不支持|备份恢复
kb-003|增值税专用发票红冲|需要|红字信息表
kb-018|备份|发生在|每天
kb-018|备份|时限|30 天
kb-018|备份恢复|年付价格|500 元
kb-019|开放 API|仅限|企业版
kb-018|数据|发生在|中国大陆杭州的数据中心
kb-003|电子普通发票红冲|时限|当天
kb-019|超过速率限制|发生在|HTTP 429
kb-019|超过速率限制|解决办法|等待一分钟后重试
kb-003|退款|需要先|发票红冲
```

SQLite 没加 ORDER BY 时顺序不保证,你那里的顺序可能不同。好的先说:(退款,需要先,发票红冲)方向完全对,原文「需要先申请发票红冲,红冲完成后才能退款」的主语和顺序都容易把模型带反,它这次没反。坏的有三种:

- (企业版,可用于,备份恢复)方向反了。「可用于」的意思是「某个功能可用于某个套餐」,头应该是功能;这里念出来是「企业版可用于备份恢复」。
- (备份恢复,年付价格,500 元)关系硬套。原文是「每次收费 500 元」,白名单里没有「每次费用」,模型就借了个最像的「年付价格」。规则里写了「表达不了就不抽」,它没听。
- (超过速率限制,发生在,HTTP 429)和(备份,发生在,每天)。「发生在」我心里想的是「错误码发生在哪个操作」,模型理解成了普通话里的「发生在」,什么都往里放。

问题的根源是一样的:**白名单只给了关系的名字,没给关系的意思**,尤其没说头和尾各是什么类型的东西。模型只能按字面猜。把这几种错写成代码规则:

```python
# agent-zero-lab/part04/kg_check.py  抽查模型建的图:一是按类型规则找方向错误,二是和 Day 250 手写的 16 条对答案
import re

from part04.kg_store import load_edges
from part04.kg_triples import TRIPLES

PLANS = {"免费版", "专业版", "企业版", "年付专业版"}
TAIL_IS_PLAN = {"仅限", "可用于", "不适用于"}  # 头是功能/单据,尾是套餐
HEAD_IS_PLAN = {"包含"}  # 头是套餐,尾是功能
ERROR_CODE = re.compile(r"E\d{4}")


def problems(h: str, r: str, t: str) -> str | None:
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
print(f"一共 {len(edges)} 条边")
print("== 类型规则抓到的:")
bad = 0
for e in edges:
    why = problems(e["head"], e["rel"], e["tail"])
    if why:
        bad += 1
        print(f"  {why:<6} ({e['head']}, {e['rel']}, {e['tail']})  {e['doc_id']}")
print(f"  共 {bad} 条")

print("== 和 Day 250 手写的 16 条对答案:")
triples = {(e["head"], e["rel"], e["tail"]) for e in edges}
pairs = {(e["head"], e["tail"]): e["rel"] for e in edges}
score = {"完全一样": 0, "关系不同": 0, "方向反了": 0, "没抽到": 0}
for h, r, t, src in TRIPLES:
    if (h, r, t) in triples:
        kind = "完全一样"
    elif (h, t) in pairs:
        kind = "关系不同"
    elif (t, h) in pairs:
        kind = "方向反了"
    else:
        kind = "没抽到"
    score[kind] += 1
    if kind != "完全一样":
        got = pairs.get((h, t)) or pairs.get((t, h)) or ""
        print(f"  {kind}  手写 ({h}, {r}, {t})  模型 {got}")
print("  ", score)
```

<div class="line-notes">

- `import re` Python 的正则模块,相当于 JS 的 `RegExp`。今天只用两个函数:`re.compile` 先编译一个模式,`.fullmatch` 要求整个字符串都匹配(JS 里相当于正则两头加 `^` 和 `$`)。
- `from part04.kg_triples import TRIPLES` Day 250 手写的 16 条,今天当标准答案(gold)。
- `PLANS = {"免费版", "专业版", "企业版", "年付专业版"}` 和 Day 250 练习 4 一样的套餐集合。
- `TAIL_IS_PLAN = {"仅限", "可用于", "不适用于"}  # 头是功能/单据,尾是套餐` 这三种关系的尾必须是套餐。
- `HEAD_IS_PLAN = {"包含"}  # 头是套餐,尾是功能` 「包含」反过来,头必须是套餐。
- `ERROR_CODE = re.compile(r"E\d{4}")` `r"..."` 是原始字符串,反斜杠不转义;`\d{4}` 是四位数字。能匹配 `E4029`,匹配不了「超过速率限制」。
- `if r in TAIL_IS_PLAN and h in PLANS and t not in PLANS:` 头是套餐、尾不是,说明头尾正好放反了。这条要放在下一条前面,否则会被「尾不是套餐」先截走,看不出是方向问题。
- `if r == "发生在" and not ERROR_CODE.fullmatch(h):` 「发生在」的头必须是错误码。
- `print(f"  {why:<6} ({e['head']}, {e['rel']}, {e['tail']})  {e['doc_id']}")` `{why:<6}` 是左对齐、占 6 格,输出对得整齐一点(中文字符宽度不同,对不太齐,凑合看)。
- `triples = {(e["head"], e["rel"], e["tail"]) for e in edges}` 集合推导式,把模型的边变成三元组集合,判断「在不在」很快。
- `pairs = {(e["head"], e["tail"]): e["rel"] for e in edges}` 字典推导式,键是(头,尾),值是关系。用来判断「两个点连上了,但关系名不一样」。
- `elif (t, h) in pairs:` 把手写答案的头尾对调了去找,找到就是方向反了。
- `got = pairs.get((h, t)) or pairs.get((t, h)) or ""` 模型给这对实体用的关系名,两个方向都试一下,都没有就是空串。`or` 链相当于 JS 的 `a || b || ""`。

</div>

```bash
uv run python -m part04.kg_check
```

```text
一共 121 条边
== 类型规则抓到的:
  头不是套餐  (年付套餐, 包含, 专业版)  kb-002
  头不是套餐  (年付套餐, 包含, 企业版)  kb-002
  头不是错误码 (自动续费, 发生在, 到期前 3 天)  kb-004
  头不是错误码 (宽限期结束仍未付款, 发生在, 账户降为免费版)  kb-004
  头不是错误码 (升级, 发生在, 立即生效)  kb-005
  头不是错误码 (降级, 发生在, 当前计费周期结束后)  kb-005
  尾不是套餐  (电子普通发票, 可用于, 付费订单)  kb-006
  头不是套餐  (银行流水, 包含, CSV)  kb-009
  头不是套餐  (银行流水, 包含, XLSX)  kb-009
  尾不是套餐  (工商银行, 可用于, 自动识别格式)  kb-009
  尾不是套餐  (招商银行, 可用于, 自动识别格式)  kb-009
  尾不是套餐  (建设银行, 可用于, 自动识别格式)  kb-009
  头不是套餐  (模板, 包含, 日期)  kb-009
  头不是套餐  (模板, 包含, 金额)  kb-009
  头不是套餐  (模板, 包含, 对方户名)  kb-009
  头不是套餐  (模板, 包含, 摘要)  kb-009
  头不是错误码 (Excel 另存为 CSV, 发生在, GBK 编码)  kb-011
  头不是错误码 (图片模糊, 发生在, E2017)  kb-012
  头不是错误码 (图片短边分辨率低于 1000 像素, 发生在, E2017)  kb-012
  头不是错误码 (PDF 文件设置了密码, 发生在, E2017)  kb-012
  尾不是套餐  (识别失败的发票, 可用于, 手动录入)  kb-012
  尾不是套餐  (管理员, 可用于, 管理账单和成员)  kb-015
  尾不是套餐  (记账员, 可用于, 新增和修改流水)  kb-015
  尾不是套餐  (只读成员, 可用于, 查看和导出)  kb-015
  头不是套餐  (两步验证, 包含, 短信验证码)  kb-016
  头不是套餐  (两步验证, 包含, 验证器 App)  kb-016
  头不是错误码 (数据, 发生在, 账号正式注销)  kb-017
  头不是错误码 (数据, 发生在, 中国大陆杭州的数据中心)  kb-018
  头不是错误码 (备份, 发生在, 每天)  kb-018
  头尾颠倒   (企业版, 可用于, 备份恢复)  kb-018
  头不是错误码 (超过速率限制, 发生在, HTTP 429)  kb-019
  头不是错误码 (汇率更新, 发生在, 每天早上 8 点)  kb-020
  共 32 条
== 和 Day 250 手写的 16 条对答案:
  方向反了  手写 (备份恢复, 仅限, 企业版)  模型 可用于
  关系不同  手写 (增值税专用发票, 可开给, 企业版)  模型 仅限
  关系不同  手写 (增值税专用发票, 可开给, 年付专业版)  模型 仅限
  没抽到  手写 (退款, 需要, 客服主管审批)  模型 
  没抽到  手写 (E1043, 发生在, 导入银行流水)  模型 
  没抽到  手写 (E1042, 发生在, 导入银行流水)  模型 
  没抽到  手写 (E4029, 发生在, 开放 API)  模型 
   {'完全一样': 9, '关系不同': 2, '方向反了': 1, '没抽到': 4}
```

121 条里有 32 条被规则抓到,超过四分之一。仔细看,它们分成两类。

第一类是**方向错误**(direction error),也就是头尾放反。最典型的是 (图片模糊,发生在,E2017):原文「E2017 表示发票图片无法识别,常见原因有三个:图片模糊……」,按我们的约定应该是错误码在头;模型把原因放在头、错误码放在尾,三条全反。(企业版,可用于,备份恢复)也是这一类。

第二类是**关系乱用**:不是头尾反了,是这条关系根本不该用在这里。(两步验证,包含,短信验证码)、(模板,包含,日期)里的「包含」是普通话的包含,不是「套餐包含功能」;(管理员,可用于,管理账单和成员)里的「可用于」也是。规则里我把它们都叫「头不是套餐」「尾不是套餐」,本质是一回事:**一个关系名在模型心里对应了好几种意思**。

对答案那段更直观。16 条手写答案,模型完全一样的 9 条。kb-006 专票那两条被写成了「仅限」,就是第二步看到的那个坑。四个错误码那几条一条都没对上,原因下一步会看到:模型其实抽了 E1042、E4029,但尾实体起的名字和我手写的不一样。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="三种抽取错误的对照:方向错误,头尾颠倒;关系乱用,同一个关系名用在不同意思上;实体名不一致,同一个东西两个名字导致断开">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<defs><marker id="gr252b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--ink-soft)"/></marker></defs>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink)">方向错误</text>
<rect x="20" y="40" width="90" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="65" y="60" fill="var(--ink)" text-anchor="middle">备份恢复</text>
<line x1="110" y1="55" x2="178" y2="55" stroke="var(--ink-soft)" marker-end="url(#gr252b)"/>
<text x="144" y="47" fill="var(--ink-soft)" text-anchor="middle" font-size="11">仅限</text>
<rect x="180" y="40" width="80" height="30" rx="15" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="220" y="60" fill="var(--ink)" text-anchor="middle">企业版</text>
<text x="280" y="60" fill="var(--ink-faint)">对</text>
<rect x="340" y="40" width="80" height="30" rx="15" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="380" y="60" fill="var(--ink)" text-anchor="middle">企业版</text>
<line x1="420" y1="55" x2="488" y2="55" stroke="var(--ink-soft)" marker-end="url(#gr252b)"/>
<text x="454" y="47" fill="var(--ink-soft)" text-anchor="middle" font-size="11">可用于</text>
<rect x="490" y="40" width="90" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="535" y="60" fill="var(--ink)" text-anchor="middle">备份恢复</text>
<text x="600" y="60" fill="var(--ink-faint)">错</text>
<text x="20" y="108" fill="var(--ink)">关系乱用</text>
<rect x="20" y="120" width="90" height="30" rx="15" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="65" y="140" fill="var(--ink)" text-anchor="middle">企业版</text>
<line x1="110" y1="135" x2="178" y2="135" stroke="var(--ink-soft)" marker-end="url(#gr252b)"/>
<text x="144" y="127" fill="var(--ink-soft)" text-anchor="middle" font-size="11">包含</text>
<rect x="180" y="120" width="80" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="220" y="140" fill="var(--ink)" text-anchor="middle">开放 API</text>
<text x="280" y="140" fill="var(--ink-faint)">对</text>
<rect x="340" y="120" width="80" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="380" y="140" fill="var(--ink)" text-anchor="middle">模板</text>
<line x1="420" y1="135" x2="488" y2="135" stroke="var(--ink-soft)" marker-end="url(#gr252b)"/>
<text x="454" y="127" fill="var(--ink-soft)" text-anchor="middle" font-size="11">包含</text>
<rect x="490" y="120" width="90" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="535" y="140" fill="var(--ink)" text-anchor="middle">日期</text>
<text x="600" y="140" fill="var(--ink-faint)">错</text>
<text x="20" y="188" fill="var(--ink)">名字不一致</text>
<rect x="20" y="200" width="90" height="30" rx="15" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="65" y="220" fill="var(--ink)" text-anchor="middle">E4029</text>
<line x1="110" y1="215" x2="178" y2="215" stroke="var(--ink-soft)" marker-end="url(#gr252b)"/>
<text x="144" y="207" fill="var(--ink-soft)" text-anchor="middle" font-size="11">发生在</text>
<rect x="180" y="200" width="80" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="220" y="220" fill="var(--ink)" text-anchor="middle">API 请求</text>
<rect x="340" y="200" width="80" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="380" y="220" fill="var(--ink)" text-anchor="middle">开放 API</text>
<line x1="420" y1="215" x2="488" y2="215" stroke="var(--ink-soft)" marker-end="url(#gr252b)"/>
<text x="454" y="207" fill="var(--ink-soft)" text-anchor="middle" font-size="11">仅限</text>
<rect x="490" y="200" width="90" height="30" rx="15" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="535" y="220" fill="var(--ink)" text-anchor="middle">企业版</text>
<text x="300" y="220" fill="var(--ink-faint)" text-anchor="middle">断开</text>
</g>
</svg>
<figcaption>今天真实抽出来的三种错。前两种类型规则能抓;第三种两条边各自都对,只是「API 请求」和「开放 API」是两个点,图从中间断开,规则抓不到,要靠实体合并(练习 3)。</figcaption>
</figure>

## 第五步:把方向写进提示词,再抽一遍

修法就是把「关系的意思」也告诉模型:每种关系写一行,箭头左边是头的类型,右边是尾的类型。再加一条自查规则:抽完把三元组从左往右念一遍,不是人话就不要。这正是 Day 250 教你自己检查方向的办法,现在让模型也照做。

```python
# agent-zero-lab/part04/kg_extract2.py  第二版抽取:给每种关系写清楚「头是什么、尾是什么」,再抽一遍
from part04.kg_extract import main
from part04.kg_store import RELATIONS

REL_DOC = {
    "年付价格": "套餐 → 金额",
    "月付价格": "套餐 → 金额",
    "包含": "套餐 → 功能(只用于套餐包含哪些功能)",
    "仅限": "功能或单据 → 套餐(原文说只有这个套餐能用;原文列了两个套餐时不要用仅限,改用可用于)",
    "可用于": "功能或单据 → 套餐",
    "不适用于": "功能或优惠 → 套餐",
    "需要先": "操作 → 必须先完成的另一个操作",
    "需要": "操作 → 前提条件或审批",
    "不支持": "套餐或操作 → 不能做的事",
    "发生在": "错误码 → 出错的操作(头必须是 E 开头的错误码)",
    "解决办法": "错误码 → 怎么解决",
    "时限": "规则或操作 → 时间长度",
    "上限": "套餐或功能 → 数量限制",
}
assert set(REL_DOC) == set(RELATIONS)

SYSTEM2 = f"""你在给记账 SaaS「CloudLedger」的帮助中心建知识图谱。
从文章里抽出三元组,只输出 JSON:
{{"triples": [{{"head": "...", "rel": "...", "tail": "...", "evidence": "..."}}]}}

关系只能用下面这些,箭头左边是 head 的类型,右边是 tail 的类型,方向不能反:
{chr(10).join(f"- {r}:{d}" for r, d in REL_DOC.items())}
原文表达不了的关系就不抽,不要发明新关系,也不要硬套。

其他规则:
- 抽完把每条三元组从左往右念一遍:「head rel tail」要是一句通顺、符合原文的话。
- 套餐统一叫「免费版」「专业版」「企业版」;原文写「年付的专业版」就写「年付专业版」。
- 实体名用最短的说法,比如「增值税专用发票」「退款」,不要写成「增值税专用发票的开具」「所有退款」。
- evidence 原样抄原文里支撑这条三元组的那一句,不超过 60 字。
"""

if __name__ == "__main__":
    main(SYSTEM2)
```

<div class="line-notes">

- `from part04.kg_extract import main` 抽取循环、过滤、入库全部复用,只换提示词。这就是上一步把 `system` 做成参数的原因。
- `REL_DOC = {` 关系的「说明书」。业内把这种「每类关系连接什么类型的实体」的约定叫 schema(模式),Day 250 练习 4 提过。
- `"仅限": "功能或单据 → 套餐(原文说只有这个套餐能用;原文列了两个套餐时不要用仅限,改用可用于)",` 专票那个坑直接写进说明里。提示词里点名具体的坑,比写一句「要准确」管用得多。
- `"发生在": "错误码 → 出错的操作(头必须是 E 开头的错误码)",` 上一轮「发生在」被乱用了 17 次,这里把头的类型钉死。
- `assert set(REL_DOC) == set(RELATIONS)` 防止以后改了白名单忘了改说明书。两个集合不相等,脚本一启动就报 `AssertionError`。
- `{chr(10).join(f"- {r}:{d}" for r, d in REL_DOC.items())}` `chr(10)` 就是换行符 `\n`。f-string 的大括号里不能直接写反斜杠(Python 3.12 之前会报错),所以用 `chr(10)` 绕一下。拼出来是 13 行「- 年付价格:套餐 → 金额」这样的列表。
- `- 抽完把每条三元组从左往右念一遍` 让模型自查方向。
- `比如「增值税专用发票」「退款」,不要写成「增值税专用发票的开具」「所有退款」` 上一轮 kb-002 抽出了「所有退款」,和 kb-003 的「退款」是两个点,这里点名。
- `main(SYSTEM2)` 用新提示词跑一遍完整流程,会覆盖 `kg_llm.db`。

</div>

```bash
uv run python -m part04.kg_extract2
uv run python -m part04.kg_check
```

```text
kb-001: 13 条  kb-002: 6 条  kb-003: 4 条  kb-004: 5 条  kb-005: 3 条  kb-006: 7 条  kb-007: 4 条  kb-008: 2 条  kb-009: 2 条  kb-010: 3 条  kb-011: 3 条  kb-012: 5 条  kb-013: 5 条  kb-014: 4 条  kb-015: 4 条  kb-016: 3 条  kb-017: 4 条  kb-018: 4 条  kb-019: 4 条  kb-020: 4 条  
合计 89 条边、109 个实体;丢掉白名单外的 0 条:
20 次调用 | 输入 10681 / 输出 3866 tokens | 约 ¥0.0413
一共 89 条边
== 类型规则抓到的:
  尾不是套餐  (电子普通发票, 可用于, 所有付费订单)  kb-006
  头尾颠倒   (专业版, 可用于, 多币种记账)  kb-020
  头尾颠倒   (企业版, 可用于, 多币种记账)  kb-020
  共 3 条
== 和 Day 250 手写的 16 条对答案:
  关系不同  手写 (增值税专用发票, 可开给, 企业版)  模型 可用于
  关系不同  手写 (增值税专用发票, 可开给, 年付专业版)  模型 可用于
  没抽到  手写 (E1043, 发生在, 导入银行流水)  模型 
  没抽到  手写 (E1042, 发生在, 导入银行流水)  模型 
  没抽到  手写 (E4029, 发生在, 开放 API)  模型 
   {'完全一样': 11, '关系不同': 2, '方向反了': 0, '没抽到': 3}
```

可疑的边从 32 条降到 3 条,对答案从 9 条完全一样升到 11 条,方向反了的从 1 条降到 0。专票那两条现在是「可用于」,意思和我手写的「可开给」一样,只是名字不同,这两条其实算对。剩下 3 条可疑的里,kb-020 那两条还是头尾颠倒:原文「专业版和企业版支持多币种记账」,主语是套餐,模型就顺着句子把套餐放在了头。说明书写得再清楚,句子的语序还是会把模型往反方向拽。

代价也写在输出里:边从 121 条降到 89 条。规则写严了,模型更愿意「不抽」,kb-009 从 13 条降到 2 条,那几条「模板包含日期」本来就是乱用,掉了不可惜;但 kb-002 也从 10 条降到 6 条,「468 元退 351 元」这种计算规则从头到尾都没进图。**三元组装不下计算方法、条件和例子**,这是图的天生短板,不是提示词能修的。Day 253 会看到它在回答时造成什么后果。

再看那三条没抽到的错误码。查一下模型到底抽成了什么:

```bash
sqlite3 part04/data/kg_llm.db "SELECT head, rel, tail FROM edges WHERE rel = '发生在'"
```

```text
E1042|发生在|银行流水导入
E1043|发生在|上传文件
E2017|发生在|发票识别
E3001|发生在|支付
E4029|发生在|API 请求
```

全对了,头都是错误码,方向也对。没对上答案只是因为名字:我手写的是「导入银行流水」「开放 API」,模型写的是「银行流水导入」「API 请求」。对答案的代码按字符串比,当然算没抽到。这种情况比方向错误更麻烦:**规则抓不到,两条边各自都是对的,但图在这里断开了**。kb-019 里明明有「开放 API 仅限企业版」,可是「E4029 → API 请求」和「开放 API → 企业版」之间没有边,Day 250 那条 E4029 走三步到 1908 元的路径就走不通了。Day 253 一开头就会撞上这个问题。

## 同一段代码,跑两次结果不一样

还有一件事必须说。写这篇时我把第一版 `kg_extract.py` 前后跑了两次,中间只是把 `system` 改成了参数(行为不变),提示词、`temperature=0` 都没动,两次结果是:

```text
第一次:合计 121 条边、163 个实体   kg_check 抓到 32 条   对答案 完全一样 9 条
第二次:合计 123 条边、160 个实体   kg_check 抓到 28 条   对答案 完全一样 8 条
```

kb-005 从 4 条变成 6 条,kb-011 从 4 条变成 3 条,(企业版,可用于,备份恢复)第二次变成了(企业版,包含,备份恢复)。`temperature=0` 只是让模型每一步都挑概率最高的词,服务端的批处理、浮点运算顺序这些因素还是会让结果有细小差别,而抽取这种长输出,前面差一个词,后面就全变了。练习 1 会让你专门测一下。

这件事的直接结论是:**建好的图要存下来,不要每次查询前重抽**。你跑出来的数字和我的大概率不完全一样,这很正常;后面两天我用的是第五步这次跑出来的 `kg_llm.db`(89 条边),你用你自己的那份就行,只要流程走通,结论的方向是一样的。

## 花了多少钱

`.env` 里 `LLM_PRICE=0.04,2,8`,是 DeepSeek 2026 年 10 月 `deepseek-flash` 的高峰价(缓存命中 / 未命中 / 输出,元每百万 token,见 [DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing));北京时间工作日 9–12 点、14–18 点以外是半价,`LLMClient` 不分时段,一律按 `.env` 里的价格记账,所以实际账单只会更少。

```text
第一步:107 输入 + 194 输出                    ≈ ¥0.0018
第二步:604 输入 + 956 输出                    ≈ ¥0.0089
第三步:6581 × 2 / 1e6 + 5130 × 8 / 1e6      = 0.0132 + 0.0410 = ¥0.0542
第五步:10681 输入 + 3866 输出,账本记 ¥0.0413
主线合计 ≈ ¥0.11;我多跑的一次第一版 ¥0.05,四道练习约 ¥0.03
```

第五步按算式应该是 10681 × 2 / 1e6 + 3866 × 8 / 1e6 ≈ ¥0.052,账本只记了 ¥0.041,差的那一截是缓存:20 次调用的 system 提示词一模一样,后面的调用命中了 DeepSeek 的上下文缓存,这部分输入按 0.04 元算(Day 124)。第二版提示词比第一版长了一倍多,输入从 6581 涨到 10681,花的钱反而少了,因为输出从 5130 降到 3866。**抽取的大头在输出**,模型要把每条三元组和证据一个字一个字写出来。按第五步的比例,1 万篇文章大约 ¥20,每次文章大改都要重抽。微软 README 里那句「start small」就是这个意思。

## 零件和整段代码的对照

| 今天的零件 | 在哪个文件 | 解决什么问题 |
| --- | --- | --- |
| `json.loads` 崩在代码围栏 | `kg_llm_first.py` | 证明一定要开 JSON mode |
| `response_format={"type": "json_object"}` + 写死字段 | `kg_llm_json.py`,`kg_extract.py` 的 `extract()` | 输出能解析,字段名固定 |
| `RELATIONS` 白名单 + `if t.get("rel") not in RELATIONS` | `kg_store.py`,`kg_extract.py` 的 `main()` | 关系从 28 种收敛到 13 种 |
| `evidence` + `doc_id` 两列 | `kg_store.py` 的 `edges` 表 | 每条边能追到原文 |
| `problems()` 类型规则 + 对答案 | `kg_check.py` | 自动找方向错误和关系乱用 |
| `REL_DOC` 说明书 | `kg_extract2.py` | 可疑的边 32 → 3 |

## 动手练习

**练习 1:同一篇文章抽三次,结果一样吗?** 用 `SYSTEM2` 对同一篇文章连续抽三次,列出三次都有的三元组,以及只在某一次出现的。先跑 kb-005,再跑 kb-002。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/kg_ex252_1.py  练习 1:同一篇文章、同一个提示词、temperature=0,抽三次,结果一样吗
import sys

from common.llm import LLMClient
from part04.kg_extract import extract
from part04.kg_extract2 import SYSTEM2
from part04.kg_store import KB_DIR

doc_id = sys.argv[1] if len(sys.argv) > 1 else "kb-005"
client = LLMClient()
runs: list[set[tuple[str, str, str]]] = []
for i in range(3):
    triples = extract(client, KB_DIR / f"{doc_id}.md", SYSTEM2)
    runs.append({(t["head"], t["rel"], t["tail"]) for t in triples})
    print(f"第 {i + 1} 次:{len(runs[-1])} 条")
common = runs[0] & runs[1] & runs[2]
print(f"三次都有的 {len(common)} 条:", sorted(common))
for i, r in enumerate(runs):
    print(f"只在第 {i + 1} 次出现:", sorted(r - common))
print("---", client.ledger)
```

<div class="line-notes">

- `from part04.kg_extract import extract` 直接复用抽取函数,不入库,只看结果。
- `doc_id = sys.argv[1] if len(sys.argv) > 1 else "kb-005"` `sys.argv` 是命令行参数列表,相当于 Node 的 `process.argv`,`[0]` 是脚本自己,`[1]` 是第一个参数。不带参数就用 kb-005。
- `runs.append({(t["head"], t["rel"], t["tail"]) for t in triples})` 每次的结果变成一个集合,方便做交集差集。证据那一列不比,模型抄原文时标点可能有出入。
- `common = runs[0] & runs[1] & runs[2]` `&` 是集合交集(Day 25),三次都有的才算稳定。
- `print(f"只在第 {i + 1} 次出现:", sorted(r - common))` `-` 是差集:这一次有、但不是三次都有的。

</div>

```bash
uv run python -m part04.kg_ex252_1
uv run python -m part04.kg_ex252_1 kb-002
```

```text
第 1 次:3 条
第 2 次:4 条
第 3 次:4 条
三次都有的 3 条: [('免费版', '上限', '1 个账本'), ('升级', '需要', '补差价'), ('降级', '时限', '当前计费周期结束后')]
只在第 1 次出现: []
只在第 2 次出现: [('降级', '不支持', '退差价')]
只在第 3 次出现: [('降级', '不支持', '退差价')]
--- 3 次调用 | 输入 1611 / 输出 470 tokens | 约 ¥0.0047
第 1 次:7 条
第 2 次:7 条
第 3 次:7 条
三次都有的 5 条: [('年付专业版', '年付价格', '468 元'), ('年付专业版', '月付价格', '39 元'), ('月付套餐', '不支持', '中途退款'), ('退款', '时限', '3 个工作日'), ('退款', '需要', '客服主管审批')]
只在第 1 次出现: [('支付宝退款', '时限', '1 到 3 个工作日'), ('银行卡退款', '时限', '3 到 7 个工作日')]
只在第 2 次出现: [('退款', '时限', '1 到 3 个工作日'), ('银行卡退款', '时限', '3 到 7 个工作日')]
只在第 3 次出现: [('支付宝退款', '时限', '1 到 3 个工作日'), ('银行卡退款', '时限', '3 到 7 个工作日')]
```

两篇都不稳定。kb-005 的(降级,不支持,退差价)三次里出现了两次;kb-002 每次都是 7 条,但头实体在「支付宝退款」和「退款」之间摇摆,第二次把支付宝到账时间挂到了「退款」上,丢掉了「支付宝」这个信息。另外(年付专业版,月付价格,39 元)三次都有,稳定地错:原文是「折合每月 39 元」,不是月付价格。稳定不等于对。

我自己的做法是:同一篇抽两到三次,三次都有的直接收,有分歧的交给人或者更强的模型裁决。这会让抽取成本翻倍,文章少的时候值得。

</details>

**练习 2:再加两条类型规则。** 给 `kg_check.py` 那套思路加规则:「时限」的尾必须像一段时间(含数字,或者是「当天」「每天」这种词),「上限」的尾必须带数字。另外找出「需要」的尾里像时限的(含数字和「天」)。在第五步那张图上跑。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/kg_ex252_2.py  练习 2:「时限」的尾必须是一段时间,「上限」的尾必须带数字
import re

from part04.kg_store import load_edges

TIME = re.compile(r"\d|当天|每天|立即")
NUMBER = re.compile(r"\d")

for e in load_edges():
    if e["rel"] == "时限" and not TIME.search(e["tail"]):
        print(f"时限的尾不像时间  ({e['head']}, {e['rel']}, {e['tail']})  {e['doc_id']}")
    if e["rel"] == "上限" and not NUMBER.search(e["tail"]):
        print(f"上限的尾没有数字  ({e['head']}, {e['rel']}, {e['tail']})  {e['doc_id']}")
    if e["rel"] == "需要" and NUMBER.search(e["tail"]) and "天" in e["tail"]:
        print(f"需要的尾像是时限  ({e['head']}, {e['rel']}, {e['tail']})  {e['doc_id']}")
```

<div class="line-notes">

- `TIME = re.compile(r"\d|当天|每天|立即")` `|` 是「或」:有一个数字,或者出现这几个词之一。
- `if e["rel"] == "时限" and not TIME.search(e["tail"]):` `search` 只要字符串里某处匹配就算,和 `fullmatch` 不同。相当于 JS 的 `regex.test(str)`。
- `if e["rel"] == "需要" and NUMBER.search(e["tail"]) and "天" in e["tail"]:` 「需要」的尾应该是条件或审批,出现「90 天」很可能是把时限塞进了「需要」。

</div>

```bash
uv run python -m part04.kg_ex252_2
```

```text
时限的尾不像时间  (降级, 时限, 当前计费周期结束后)  kb-005
需要的尾像是时限  (申请发票, 需要, 付款后 90 天内)  kb-006
```

两条都是真问题。第一条其实是「生效时间」,不是时间长度,白名单里没有合适的关系,模型借用了「时限」,这条我倾向于在白名单里加一个「生效于」。第二条「付款后 90 天内」本该是(申请发票,时限,90 天),被塞进了「需要」。Day 254 汇总时限时,这条就有可能漏掉,因为它挂错了关系。

</details>

**练习 3:找出名字很像的实体。** 第五步那张图有 109 个实体,写一段代码找出名字很像、可能是同一个东西的实体对。不调模型,用字符集合的 Jaccard 相似度(两个名字的字符交集大小除以并集大小),阈值 0.6,含数字的名字(金额、天数)先排除。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/kg_ex252_3.py  练习 3:找出名字很像、可能是同一个东西的实体
from itertools import combinations

from part04.kg_store import load_edges

names = sorted({e["head"] for e in load_edges()} | {e["tail"] for e in load_edges()})


def jaccard(a: str, b: str) -> float:
    sa, sb = set(a.replace(" ", "")), set(b.replace(" ", ""))
    return len(sa & sb) / len(sa | sb)


pairs = [(jaccard(a, b), a, b) for a, b in combinations(names, 2)]
pairs = [p for p in pairs if p[0] >= 0.6 and not any(ch.isdigit() for ch in p[1] + p[2])]
print(f"{len(names)} 个实体,相似度 ≥ 0.6 的有 {len(pairs)} 对:")
for s, a, b in sorted(pairs, reverse=True):
    print(f"  {s:.2f}  {a}  |  {b}")
```

<div class="line-notes">

- `from itertools import combinations` `combinations(names, 2)` 给出所有两两组合,109 个实体是 109 × 108 / 2 = 5886 对。JS 里你得写两层 for 循环。
- `sa, sb = set(a.replace(" ", "")), set(b.replace(" ", ""))` 字符串变成字符集合,「导入银行流水」和「银行流水导入」得到的集合完全一样。
- `return len(sa & sb) / len(sa | sb)` Jaccard 相似度:交集除以并集,1 表示字符完全相同(顺序可以不同),0 表示一个字都不共享。
- `not any(ch.isdigit() for ch in p[1] + p[2])` 排除含数字的,不然「1 个账本」和「5 个账本」会被当成很像。

</div>

```text
109 个实体,相似度 ≥ 0.6 的有 5 对:
  1.00  导入银行流水  |  银行流水导入
  0.75  电子普通发票  |  电子普通发票红冲
  0.67  生成邀请链接  |  邀请链接
  0.60  多币种  |  多币种记账
  0.60  专业版  |  年付专业版
```

5 对里只有第 1 对和第 4 对真该合并。「电子普通发票」和「电子普通发票红冲」是一个东西和对它的一个操作,「专业版」和「年付专业版」是父类和子类(Day 250 练习 1 讨论过,应该加一条「属于」边而不是合并)。字面相似只能出候选,合不合要人或模型判断。另外它漏掉了最要命的那对:「API 请求」和「开放 API」只共享 A、P、I 三个字符,相似度不到 0.6。真实系统里会用 embedding(Day 217)算名字的语义相似度,或者让模型对一批候选做判断,LightRAG 和 GraphRAG 都有类似的合并步骤。

</details>

**练习 4(开放题):让 E4029 和「开放 API」连上。** 改提示词,让「发生在」的尾只能从一份功能名清单里选,对 kb-010、kb-011、kb-019 各跑一次新旧两版提示词,比较「发生在」的尾。

<details><summary>参考答案</summary>

示范解法:在 `SYSTEM2` 后面追加一条规则,列出帮助中心里的功能名,这其实就是给尾实体也加了一份白名单。

```python
# agent-zero-lab/part04/kg_ex252_4.py  练习 4:让「发生在」的尾用功能名,E4029 才能和「开放 API」连上
from common.llm import LLMClient
from part04.kg_extract import extract
from part04.kg_extract2 import SYSTEM2
from part04.kg_store import KB_DIR

FEATURES = ["开放 API", "导入银行流水", "发票识别", "支付", "导出数据"]
SYSTEM3 = SYSTEM2 + f"""- 「发生在」的 tail 必须从这些功能名里选:{"、".join(FEATURES)}。
"""

client = LLMClient()
for doc_id in ["kb-010", "kb-011", "kb-019"]:
    for name, system in [("第二版", SYSTEM2), ("加了规则", SYSTEM3)]:
        triples = extract(client, KB_DIR / f"{doc_id}.md", system)
        occurs = [(t["head"], t["tail"]) for t in triples if t["rel"] == "发生在"]
        print(f"{doc_id} {name}:", occurs)
print("---", client.ledger)
```

<div class="line-notes">

- `FEATURES = ["开放 API", "导入银行流水", "发票识别", "支付", "导出数据"]` 功能名清单。我直接用了帮助中心文章的标题用词,和 Day 250 手写时一致。
- `SYSTEM3 = SYSTEM2 + f"""- 「发生在」的 tail 必须从这些功能名里选` 字符串拼接,在「其他规则」末尾多加一条。
- `occurs = [(t["head"], t["tail"]) for t in triples if t["rel"] == "发生在"]` 只看「发生在」这一种关系。

</div>

```text
kb-010 第二版: [('E1042', '银行流水导入')]
kb-010 加了规则: [('E1042', '导入银行流水')]
kb-011 第二版: [('E1043', '上传文件')]
kb-011 加了规则: [('E1043', '导入银行流水')]
kb-019 第二版: [('E4029', '调用开放 API')]
kb-019 加了规则: [('E4029', '开放 API')]
--- 6 次调用 | 输入 3224 / 输出 836 tokens | 约 ¥0.0089
```

三篇全部对齐到了清单里的名字,E4029 现在指向「开放 API」,和「开放 API → 企业版」那条边接上了。顺便又看到一次不稳定:kb-019 第二版这次抽成了「调用开放 API」,第五步那次是「API 请求」。这个办法的前提是你能事先列出实体清单;帮助中心有目录,功能名是有限的,能列;开放领域(新闻、论文)列不出来,只能靠抽取后合并。

</details>

验收标准:`kg_extract.py` 和 `kg_extract2.py` 都跑通,`kg_check.py` 在两版图上都有输出,并且你能对着自己的输出说出「方向错误」「关系乱用」「名字不一致」各一个例子;能不看文章说出为什么关系白名单必须在提示词里给、在代码里再查一遍;能说出第二版提示词让边变少的原因和代价。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| GraphRAG | 用大模型从文本自动抽三元组建图,再用图增强检索和回答。分建图、local search、global search 三块 |
| 抽取(extraction) | 让模型从非结构化文本里读出结构化数据,今天读出的是三元组 |
| 关系白名单(whitelist) | 允许使用的关系名列表,提示词里给,代码里再过滤一次 |
| 方向错误(direction error) | 三元组的头尾放反,比如(企业版,可用于,备份恢复),查询不报错,只是查不到 |
| 关系乱用 | 关系名对,意思不对,比如把「模板包含日期」写成套餐那种「包含」 |
| schema / 关系说明 | 每种关系连接什么类型的头和尾的约定,今天的 `REL_DOC` |
| 证据(evidence) | 支撑一条边的原文句子,用来抽查和引用 |
| 标准答案(gold) | 人工标注的正确结果,今天是 Day 250 手写的 16 条 |
| 实体合并(entity resolution) | 把同一个东西的不同叫法合成一个点,比如「API 请求」和「开放 API」 |
| `Counter` | `collections` 里专门计数的 dict,没出现的键默认 0 |
| `re` / 正则 | Python 的正则表达式模块,`fullmatch` 整串匹配,`search` 任意位置匹配 |
| Jaccard 相似度 | 两个集合的交集大小除以并集大小,0 到 1 |

## 常见误区

**不开 JSON mode,自己去剥代码围栏。** 有人看到 ```` ```json ```` 就写个 `strip("`")` 或正则去掉它。能跑,但模型下次可能在 JSON 前面加一句「好的,以下是结果:」,你又得改。开 `response_format={"type": "json_object"}`,问题从根上消失。

**只在提示词里给白名单,代码里不查。** 今天两版提示词模型都没违规,不代表永远不违规。代码里的 `if t.get("rel") not in RELATIONS` 只有一行,写上。

**只给关系的名字,不给意思。** 第一版提示词的白名单让关系从 28 种收敛到 13 种,但「发生在」被乱用了 17 次,「包含」「可用于」也被当成普通话用。名字只是标签,模型要知道头和尾各是什么类型才知道怎么用。

**以为 temperature=0 就每次一样。** 我两次跑第一版,121 条和 123 条;练习 1 里同一篇抽三次也不一样。建好的图要存下来,评测要跑多次看分布。

**以为规则越严越好。** 第二版可疑的边从 32 条降到 3 条,但边也从 121 条降到 89 条。严了会漏,松了会错,要拿标准答案量,不是凭感觉调。

**以为抽出来的图能代替原文。** 「468 元退 351 元」「优惠部分不退现金」这种计算规则,三元组装不下。图负责找到该看哪几篇,回答时还要把原文带上,明天会看到不带原文的后果。

**看到「没抽到」就以为模型漏了。** 今天那三条错误码模型其实都抽了,只是名字和标准答案不一样。对答案前先确认是真漏,还是名字没对齐,两种问题修法完全不同。

## 学习资料

### 文档与文章

- [From Local to Global: A Graph RAG Approach to Query-Focused Summarization(arXiv 2404.16130)](https://arxiv.org/abs/2404.16130):微软 GraphRAG 论文。今天读第 2 节里讲「Source Documents → Text Chunks → Element Instances」那几段,也就是抽取这一步,看他们怎么做多轮补抽(gleanings),30 分钟。
- [microsoft/graphrag 的 prompts 目录](https://github.com/microsoft/graphrag/tree/main/packages/graphrag/graphrag/prompts):官方的抽取提示词。挑实体关系抽取那份读,对比今天的四条规则,看它多写了哪些,20 分钟。
- [LightRAG · prompt.py](https://github.com/HKUDS/LightRAG/blob/main/lightrag/prompt.py):LightRAG 的抽取提示词,里面有完整的 few-shot 例子,和 GraphRAG 那份对照着看。
- [DeepSeek · JSON Output](https://api-docs.deepseek.com/zh-cn/guides/json_mode):JSON mode 的官方说明,注意它要求提示词里写「json」并给样例,10 分钟。
- [DeepSeek · 模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):今天算钱用的价格和高峰时段。
- [microsoft/graphrag README](https://github.com/microsoft/graphrag):开头的维护状态说明和建索引成本提醒,5 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1zoKuzoENM&autoplay=0&high_quality=1" title="AI知识图谱 GraphRAG 是怎么回事？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>隔壁的程序员老王 · AI知识图谱 GraphRAG 是怎么回事? · 14 分钟,播放量 15 万。Day 250 看了讲知识图谱的前半段,今天看讲 GraphRAG 怎么用大模型建图的后半段。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1NahG6ZEbB&autoplay=0&high_quality=1" title="一口气搞懂 LightRAG：分块、建图、向量化、查询全流程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>古道AI · 一口气搞懂 LightRAG:分块、建图、向量化、查询全流程 · 22 分钟,2026 年 8 月的新视频。今天看「建图」那一段,看 LightRAG 抽取时多做了哪些事(实体描述、合并),明天再看查询那段。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/JTVx6i6MzVw" title="GraphRAG: Building a Smarter AI System (full walkthrough)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Thu Vu · GraphRAG: Building a Smarter AI System (full walkthrough) · 英文,用微软 GraphRAG 从头建一张图,看她抽完以后怎么检查实体和关系,开自动字幕。</figcaption>
</figure>

### 书籍

- Tomaž Bratanič、Oskar Hane《Essential GraphRAG》(Manning,2025)。讲「从文本里抽实体和关系」的那一章正好对应今天,书里用 Neo4j 存。目前没查到中译本。
- 王昊奋、漆桂林、陈华钧《知识图谱:方法、实践与应用》(电子工业出版社,2019)。Day 250 推荐过,今天翻「知识抽取」那一章,看大模型出现之前人们怎么做关系抽取,就明白白名单和类型约束不是新发明。

### 开源项目与代码

- [microsoft/graphrag](https://github.com/microsoft/graphrag):官方实现,看抽取那步的配置项,每个参数都能对上今天的一行代码。
- [HKUDS/LightRAG](https://github.com/HKUDS/LightRAG):轻量版 GraphRAG,抽取完会做实体合并,可以和练习 3 对照。
- [neo4j/neo4j-graphrag-python](https://github.com/neo4j/neo4j-graphrag-python):Neo4j 官方包,它的抽取器支持传一个 schema(实体类型和关系类型),就是今天 `REL_DOC` 的正式版。

## 自测

**1. 第一步的 `json.loads` 为什么报 `Expecting value: line 1 column 1 (char 0)`?怎么修?**

<details><summary>答案</summary>

模型给 JSON 包了一层 Markdown 代码围栏,返回内容的第一个字符是反引号,不是 `{` 或 `[`,所以在第 1 行第 1 列就解析失败。修法是开 JSON mode(`response_format={"type": "json_object"}`),并在提示词里写出顶层是对象的格式样例,模型就只返回能解析的 JSON。

</details>

**2. 不给关系白名单会怎样?今天的实测数字是多少?**

<details><summary>答案</summary>

模型会按原文用词自己起关系名,三篇文章 40 条三元组用了 28 种关系。同一个意思有好几个名字(「仅限」和「仅对」,「账本数量」「账本上限」「账本限制」),按关系查图时查一个就漏另一个,枚举题没法答。

</details>

**3. (图片模糊,发生在,E2017)错在哪?为什么类型规则能抓到它?**

<details><summary>答案</summary>

方向反了。我们约定「发生在」是「错误码 → 出错的操作」,头必须是错误码;模型把原因放在头、错误码放在尾。规则 `r == "发生在" and not ERROR_CODE.fullmatch(h)` 检查头是不是 E 加四位数字,「图片模糊」不是,于是被抓出来。

</details>

**4. 第二版提示词把可疑的边从 32 条降到 3 条,代价是什么?**

<details><summary>答案</summary>

边从 121 条降到 89 条,实体从 163 个降到 109 个。一部分是本来就乱用的边(「模板包含日期」)被去掉了,不可惜;但也有原文里的事实没再抽出来,比如 kb-002 从 10 条降到 6 条。规则越严,模型越倾向于不抽,要拿标准答案衡量召回和准确两头。

</details>

**5. 为什么 E4029 那条三元组明明抽对了,对答案时却算「没抽到」?这对后面的查询有什么影响?**

<details><summary>答案</summary>

模型抽的是(E4029,发生在,API 请求),手写答案是(E4029,发生在,开放 API),对答案按字符串比,名字不同就不算。影响是图在这里断开了:「API 请求」和「开放 API」是两个点,从 E4029 出发走不到企业版,更走不到企业版的价格。这种错类型规则抓不到,要靠实体合并,或者像练习 4 那样给尾实体也加一份清单。

</details>

**6.(面试题)面试官问:「你们用大模型从文档里抽知识图谱,怎么保证抽取质量?」请用两三分钟回答。**

<details><summary>答案</summary>

参考回答:分三层。第一层是约束输出:开 JSON mode 固定格式,给关系白名单,并且给每种关系写清楚头和尾的类型,提示词里点名已知的坑,比如「原文列了两个套餐时不要用仅限」;白名单在代码里再过滤一次。第二层是自动检查:按类型规则找可疑的边,比如「仅限」的尾必须是套餐、「发生在」的头必须是错误码,我们实测第一版提示词 121 条边里规则抓到 32 条,改提示词后 89 条里只剩 3 条;再做实体合并,把「API 请求」和「开放 API」这种同物异名合起来。第三层是人工标注一小份标准答案,定期算抽取的准确率和召回,因为模型输出 temperature 为 0 也不完全稳定,我们同一篇抽三次结果都可能不同,所以图建好要存下来,关键文档可以多抽几次取共识。最后要知道图的边界:计算规则、条件和例子装不进三元组,回答时要回到原文。

</details>

## 明天预告

Day 253 · GraphRAG(二):local search 和混合检索比一比。今天建好了一张 89 条边的图,明天第一次拿它回答问题:从问题里认出实体,沿边走两步,把走到的边和原文证据交给模型。你会看到今天留下的两个伤疤怎么在回答里发作:E4029 那条断开的边让模型答错了价格,没进图的「351 元」让模型说「帮助中心没写」。然后拿 Day 240 的混合检索并排比一次,看图在「找文章」这件事上到底行不行。
