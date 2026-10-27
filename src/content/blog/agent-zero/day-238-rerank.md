---
title: 'Day 238 · Rerank:先粗筛再精排'
description: '向量和 BM25 加 RRF 解决了找得全,最后几名的顺序还是粗的。今天认识 cross-encoder 重排序模型:把问题和每一块拼在一起逐字打分,接在 RRF 后面当最后一步。实测 21 道题 MRR 从 0.873 到 0.927,但也有两题变差;每次多 200 到 450 毫秒;分数能把该答和该拒拉开得比向量宽得多。'
pubDate: 2026-10-27
regime: none
tags: ['rag', 'rerank', 'cross-encoder', 'httpx', 'agent-zero']
series: 'agent-zero'
day: 238
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 237](/blog/agent-zero/day-237-week34-review/) 是第 34 周复习,最后有两个发现。一个是练习 4:补了 4 道口语题,向量 MRR 0.708、BM25 0.300、RRF 0.583,RRF 没赢向量。另一个是小项目里的 BM25 过期以后,会把新文章拖到第 4 名。两件事有个共同点:RRF 只看名次,不看每一块到底和问题有多相关,所以「两路都说还行」的块会压过「一路说最好」的块。[Day 236](/blog/agent-zero/day-236-rrf/) 里「导入时报 E2017」差 0.0005 没爬到第 1 名,也是这个原因。

今天换一种东西来补这个洞:一个专门给「问题和一段文字有多相关」打分的模型,叫重排序模型(rerank)。它不替换向量和 BM25,而是接在 RRF 后面,只对粗筛剩下的二十来块再排一次。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说清 bi-encoder(embedding 模型)和 cross-encoder(重排序模型)的区别,并用 `bi_vs_cross.py` 看到同样三段文字,embedding 把 E1042 排在 E1043 前面,rerank 把 E1043 排第一且分数是 0.895 对 0.038。
2. 写出 `part04/rerank.py`(调 `/rerank` 接口的 `rerank()` 和 `rerank_chunks()`),并故意制造三个真实报错:key 无效、模型名写错、传空列表。
3. 把它接成两阶段检索 `part04/rerank_search.py`,在 21 道题上量出 RRF 和 RRF 加 rerank 的名次,会读「3 题变好、2 题变差」这种不整齐的结果,并量出候选数和耗时、token 的关系。
4. 用 rerank 分数做「该答还是该拒」的判断:Day 227 那 10 道题上,该答最低 0.893、该拒最高 0.174,而向量相似度是 0.715 和 0.673,几乎贴着。

预计用时 3 小时:两种模型的区别和 `rerank.py` 50 分钟,接成两阶段和评测 60 分钟,候选数和拒答 30 分钟,剩下做练习。前置:[Day 237](/blog/agent-zero/day-237-week34-review/) 之前的全部检索代码,特别是 `part04/pg_store.py` 的 `search`、`part04/bm25_index.py` 的 `BM25Index`、`part04/fusion.py` 的 `rrf`、`part04/hybrid_eval.py` 的 `EVAL` 和 `first_rank`(Day 236),`part04/ex_w34_hard.py` 里那 4 道口语题(Day 237 练习 4,今天把它们放进 `rerank_eval.py`);库里要有 42 块(`uv run python -m part04.pg_sync` 输出 `written` 为 0)。

今天要用硅基流动的 rerank 接口。标准版的 `BAAI/bge-reranker-v2-m3` 是免费的(2026 年 10 月查 [siliconflow.cn/pricing](https://siliconflow.cn/pricing),Pro 版每百万输入 token ¥0.07)。今天所有脚本加起来发了不到 200 次请求,花费 0 元。如果走 Pro 版,我实测对 20 个候选重排一次约 1317 个输入 token,算式是 1317 ÷ 1,000,000 × 0.07 ≈ ¥0.00009。

需要 `httpx`:前面 HTTP 那几天装过的话不用再装,没有就在 `agent-zero-lab` 根目录 `uv add httpx`。`.env` 里不用新增东西:`rerank.py` 默认沿用 `EMB_BASE_URL`、`EMB_API_KEY`(同一家),模型名读 `RERANK_MODEL`,没配就用 `BAAI/bge-reranker-v2-m3`。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `rerank()` 和 `hybrid_rerank()`;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 两种模型:一次比两个向量,和一次看两段文字

先回忆 embedding 是怎么工作的。[Day 217](/blog/agent-zero/day-217-embed-service/) 起我们用的 bge-m3,把一句话压成一个 1024 维的向量,问题一个向量、每一块一个向量,最后算两个向量的余弦。块的向量可以提前算好存进数据库,检索时只需要给问题算一次,所以一次查询是毫秒级的。代价是问题和文档在编码的时候互相「看不见」:各自被压缩成一个点,细节丢得多。这种结构叫 bi-encoder(双塔,两个塔各编各的,最后才碰面)。

重排序模型是另一种结构,叫 cross-encoder(交叉编码)。它把问题和一段文字拼在一起,一次送进模型,模型从头到尾同时看着两段,直接吐出一个数:这段文字对这个问题有多相关。因为能逐字对照,它分得出「E1043」和「E1042」,也分得出「支持」和「不支持」。代价是没法提前算:每个(问题,文档)对都要跑一次模型,对 100 万块全跑一遍根本不现实。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="左边 bi-encoder:问题和文档各自编码成向量再算余弦,文档向量可提前存好;右边 cross-encoder:问题和文档拼在一起送进模型,直接输出一个相关性分数,每个组合都要现算">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="24" fill="var(--ink)">bi-encoder(embedding)</text>
<rect x="20" y="40" width="80" height="34" rx="4" fill="none" stroke="var(--ink-soft)"/>
<text x="60" y="61" fill="var(--ink)" text-anchor="middle">问题</text>
<rect x="20" y="120" width="80" height="34" rx="4" fill="none" stroke="var(--ink-soft)"/>
<text x="60" y="141" fill="var(--ink)" text-anchor="middle">一块文档</text>
<rect x="130" y="40" width="70" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="165" y="61" fill="var(--ink)" text-anchor="middle">编码</text>
<rect x="130" y="120" width="70" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="165" y="141" fill="var(--ink)" text-anchor="middle">编码</text>
<rect x="230" y="80" width="80" height="34" rx="4" fill="none" stroke="var(--ink)"/>
<text x="270" y="101" fill="var(--ink)" text-anchor="middle">余弦 0.67</text>
<line x1="100" y1="57" x2="130" y2="57" stroke="var(--ink-faint)"/>
<line x1="100" y1="137" x2="130" y2="137" stroke="var(--ink-faint)"/>
<line x1="200" y1="57" x2="230" y2="90" stroke="var(--ink-faint)"/>
<line x1="200" y1="137" x2="230" y2="106" stroke="var(--ink-faint)"/>
<text x="20" y="190" fill="var(--ink-soft)" font-size="11">文档向量提前算好存库里</text>
<text x="20" y="208" fill="var(--ink-soft)" font-size="11">查询毫秒级,但两边互相看不见</text>
<line x1="330" y1="20" x2="330" y2="215" stroke="var(--rule)"/>
<text x="350" y="24" fill="var(--ink)">cross-encoder(rerank)</text>
<rect x="350" y="40" width="80" height="34" rx="4" fill="none" stroke="var(--ink-soft)"/>
<text x="390" y="61" fill="var(--ink)" text-anchor="middle">问题</text>
<rect x="350" y="120" width="80" height="34" rx="4" fill="none" stroke="var(--ink-soft)"/>
<text x="390" y="141" fill="var(--ink)" text-anchor="middle">一块文档</text>
<rect x="470" y="70" width="80" height="60" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="510" y="96" fill="var(--ink)" text-anchor="middle">拼在一起</text>
<text x="510" y="114" fill="var(--ink)" text-anchor="middle">送进模型</text>
<rect x="570" y="85" width="56" height="30" rx="4" fill="none" stroke="var(--ink)"/>
<text x="598" y="105" fill="var(--ink)" text-anchor="middle">0.895</text>
<line x1="430" y1="57" x2="470" y2="90" stroke="var(--ink-faint)"/>
<line x1="430" y1="137" x2="470" y2="110" stroke="var(--ink-faint)"/>
<line x1="550" y1="100" x2="570" y2="100" stroke="var(--ink-faint)"/>
<text x="350" y="190" fill="var(--ink-soft)" font-size="11">逐字对照,准;每个(问题,文档)</text>
<text x="350" y="208" fill="var(--ink-soft)" font-size="11">对都要现算,只能对少量候选做</text>
</g>
</svg>
<figcaption>左边的分数是两个向量的余弦,右边是一个模型同时读完两段之后给的分。准确度和成本正好反着来。</figcaption>
</figure>

所以标准做法是两阶段:先用便宜的办法(向量加 BM25 再加 RRF)从全部块里粗筛出二十来块,再用贵的 cross-encoder 对这二十来块精排,取前几块交给大模型。做过电商搜索或推荐的人会觉得眼熟,这就是「召回加排序」。

光说不如跑一次。拿 [Day 235](/blog/agent-zero/day-235-bm25/) 里 E1042 和 E1043 那两块当对手:这两块都在讲错误码导入失败,embedding 眼里非常像。问题是「导入的时候报 E1043 怎么办」,第三段是个混进来的「导入银行流水」的通用说明。先用 curl 直接看一眼接口长什么样,key 从你自己的 `.env` 里取(下面命令里的 `EMB_API_KEY` 先 `export` 好):

```bash
curl -s https://api.siliconflow.cn/v1/rerank \
  -H "Authorization: Bearer $EMB_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"BAAI/bge-reranker-v2-m3","query":"导入的时候报 E1043 怎么办","documents":["错误码 E1042:银行流水导入失败。列名和模板不匹配。","错误码 E1043:文件编码错误。文件不是 UTF-8 编码。","导入银行流水:支持 CSV 和 XLSX。"],"top_n":3,"return_documents":false}'
```

我的输出(为了好读我把 JSON 排了版,只留前面的字段):

```text
{"id":"...","results":[
  {"index":1,"document":null,"relevance_score":0.8438825011253357},
  {"index":0,"document":null,"relevance_score":0.025499407202005386},
  {"index":2,"document":null,"relevance_score":0.004154537338763475}],
 "meta":{"tokens":{"input_tokens":100,"output_tokens":0,...}}}
```

请求体五个字段:`model`、`query`、`documents`(一个字符串列表)、`top_n`(只要前几名)、`return_documents`(要不要把原文在响应里带回来)。响应的 `results` 已经按分数从高到低排好,每项有两个关键字段:`index` 是这篇文档在**你传进去的列表**里的下标,`relevance_score` 是相关性分数。这个接口不是 OpenAI 协议(OpenAI 没有 rerank 接口),而是 Cohere 风格的 `/rerank`,硅基流动、Jina、Cohere 自己都是这个形状,参数以 [硅基流动 rerank 文档](https://docs.siliconflow.com/en/api-reference/rerank/create-rerank) 为准。我 2026 年 10 月去看的时候,文档里 `model` 的枚举写的是三个 Qwen3-Reranker,没有 bge-reranker,但 `max_chunks_per_doc` 这个参数的说明里还专门点了 `BAAI/bge-reranker-v2-m3`,我直接用这个模型名调通了,所以今天沿用它;模型列表会变,你读到的时候以文档为准。

## 第一步:写 rerank.py

调接口就是一次 POST,相当于 JS 里的 `fetch(url, { method: "POST", headers, body: JSON.stringify(...) })`。新建 `part04/rerank.py`:

```python
# agent-zero-lab/part04/rerank.py
"""调 /rerank 接口(Cohere 风格,硅基流动、Jina、Cohere 等都是这个形状)。"""
import os

import httpx
from dotenv import load_dotenv

from part04.chunking import Chunk

load_dotenv()
BASE = os.environ.get("RERANK_BASE_URL", os.environ["EMB_BASE_URL"]).rstrip("/")
KEY = os.environ.get("RERANK_API_KEY", os.environ["EMB_API_KEY"])
MODEL = os.environ.get("RERANK_MODEL", "BAAI/bge-reranker-v2-m3")

usage = {"requests": 0, "tokens": 0}


def rerank(query: str, documents: list[str], top_n: int = 4) -> list[tuple[int, float]]:
    """返回 [(原列表下标, 相关性分数), ...],按分数从高到低。"""
    if not documents:
        return []
    resp = httpx.post(
        f"{BASE}/rerank",
        headers={"Authorization": f"Bearer {KEY}"},
        json={
            "model": MODEL,
            "query": query,
            "documents": documents,
            "top_n": min(top_n, len(documents)),
            "return_documents": False,
        },
        timeout=30,
    )
    resp.raise_for_status()
    body = resp.json()
    usage["requests"] += 1
    usage["tokens"] += body.get("meta", {}).get("tokens", {}).get("input_tokens", 0)
    return [(r["index"], float(r["relevance_score"])) for r in body["results"]]


def rerank_chunks(query: str, chunks: list[Chunk], top_n: int = 4) -> list[tuple[Chunk, float]]:
    """对一批候选块精排,返回 [(块, 相关性分数)],形状和 pg_store.search 一样。"""
    return [(chunks[i], s) for i, s in rerank(query, [c.text for c in chunks], top_n)]


if __name__ == "__main__":
    docs = [
        "错误码 E1042:银行流水导入失败。列名和模板不匹配,或者日期格式不是 YYYY-MM-DD。",
        "错误码 E1043:文件编码错误。文件不是 UTF-8 编码,Excel 另存 CSV 默认是 GBK。",
        "导入银行流水:支持 CSV 和 XLSX,单个文件不超过 10 MB。",
    ]
    for i, s in rerank("导入的时候报 E1043 怎么办", docs, top_n=3):
        print(f"{s:.3f}  {docs[i][:14]}")
    print("请求", usage["requests"], "次,输入", usage["tokens"], "token")
```

<div class="line-notes">

- `BASE = os.environ.get("RERANK_BASE_URL",` 先读 `RERANK_BASE_URL`,没配就用 `EMB_BASE_URL`(`https://api.siliconflow.cn/v1`)。`os.environ["EMB_BASE_URL"]` 是方括号,键不存在会直接报 `KeyError`,这是故意的:连 embedding 都没配,rerank 也跑不了,早点报错好。末尾的 `.rstrip("/")` 去掉右边多余的 `/`:下面拼 `f"{BASE}/rerank"`,`.env` 里如果写成 `.../v1/`,不去掉就会拼出 `.../v1//rerank`,有的服务会 404。
- `MODEL = os.environ.get("RERANK_MODEL",` 模型名,`.env` 里配了就用配的,默认 `BAAI/bge-reranker-v2-m3`。
- `usage = {"requests": 0, "tokens": 0}` 和 `common/embed.py` 的 `usage` 同一个写法,模块级的小账本,今天后面要用它算每次精排花了多少 token。
- `if not documents:` 空列表直接返回,不发请求。后面会看到服务端对空列表是报 400 的,这里在本地先挡掉。
- `httpx.post(` 发 POST。`json={...}` 会自动把字典序列化成 JSON 并加上 `Content-Type`,`headers` 里只放鉴权,`timeout=30` 防止卡死。
- `"top_n": min(top_n, len(documents))` 最多要几名。我实测硅基流动在 `top_n` 比文档数大时也照常返回,但 Cohere 等别家不一定宽容,这个习惯顺手写上。
- `"return_documents": False` 响应里不带原文,只要下标和分数,省流量。下标够用了,因为我们手里有完整的 `Chunk` 列表。
- `resp.raise_for_status()` 状态码是 4xx/5xx 就抛 `httpx.HTTPStatusError`。`fetch` 遇到 4xx 不会抛,要自己判断 `resp.ok`,这一行相当于 `if (!resp.ok) throw ...`。
- `body.get("meta", {}).get("tokens", {})` 响应里的 token 数藏在 `meta.tokens.input_tokens`。每层都用 `.get(..., {})` 是因为别家服务的字段位置不一样,取不到就当 0,账本不准但不会崩。
- `return [(r["index"], float(r["relevance_score"]))` 把响应里的 `results` 变成 `(下标, 分数)` 的列表。上面 curl 的例子里就是 `[(1, 0.844), (0, 0.025), (2, 0.004)]`。
- `[(chunks[i], s) for i, s in rerank(` 这是 `rerank_chunks` 的核心:`rerank` 返回的下标要拿回**传给它的那个列表**里取块。文本列表是 `[c.text for c in chunks]`,下标就对应 `chunks`,一一对得上。

</div>

```bash
cd /Users/你/agent-zero-lab
uv run python -m part04.rerank
```

```text
0.896  错误码 E1043:文件编码
0.037  错误码 E1042:银行流水
0.017  导入银行流水:支持 CSV 
请求 1 次,输入 132 token
```

E1043 排第一,0.896,第二名 0.037,差了二十多倍。(和 curl 里的 0.844 不一样,因为这次文档里多写了几个字,rerank 分数对文本很敏感。)

现在拿 embedding 比一下。新建 `part04/bi_vs_cross.py`,同样三段文字、同一个问题,把两种分数并排打出来:

```python
# agent-zero-lab/part04/bi_vs_cross.py
"""同样三段文字、同一个问题:embedding 余弦(两个向量比)和 rerank(拼在一起看)各打多少分。"""
from common.embed import embed, embed_one
from part04.rerank import rerank

Q = "导入的时候报 E1043 怎么办"
DOCS = [
    "错误码 E1042:银行流水导入失败。列名和模板不匹配,或者日期格式不是 YYYY-MM-DD。",
    "错误码 E1043:文件编码错误。文件不是 UTF-8 编码,Excel 另存 CSV 默认是 GBK。",
    "导入银行流水:支持 CSV 和 XLSX,单个文件不超过 10 MB。",
]
cos = embed(DOCS) @ embed_one(Q)
cross = dict(rerank(Q, DOCS, top_n=3))
print(f"{'embedding':>10}{'rerank':>9}  文档")
for i, d in enumerate(DOCS):
    print(f"{cos[i]:>10.3f}{cross[i]:>9.3f}  {d[:16]}")
```

<div class="line-notes">

- `cos = embed(DOCS) @ embed_one(Q)` `embed(DOCS)` 是 (3, 1024) 的矩阵,`embed_one(Q)` 是 (1024,) 的向量,`@` 矩阵乘向量得到 3 个余弦(`embed` 返回的向量长度都是 1,点积就是余弦,Day 217 讲过)。
- `cross = dict(rerank(Q, DOCS, top_n=3))` `rerank` 返回 `[(下标, 分数), ...]` 并且是按分数排过序的,`dict(...)` 把它变成 `{下标: 分数}`,这样下面按原来的顺序 0、1、2 取分数。
- `for i, d in enumerate(DOCS):` 按文档的原始顺序打印,而不是 rerank 的排序顺序,方便两列对着看。
- `{cos[i]:>10.3f}` 右对齐占 10 格、保留 3 位小数,`cos[i]` 是 numpy 的 float32,格式化没问题。

</div>

```bash
uv run python -m part04.bi_vs_cross
```

```text
 embedding   rerank  文档
     0.692    0.038  错误码 E1042:银行流水导入
     0.674    0.895  错误码 E1043:文件编码错误
     0.535    0.017  导入银行流水:支持 CSV 和 XLSX
```

这张小表是今天最值得看的地方。embedding 把 **E1042(0.692)排在 E1043(0.674)前面**,排反了,差 0.018;而且在 embedding 看来这两块的分数几乎一样,这是 Day 235 里向量检索的盲区在小规模上的重现。rerank 一下子把它们拉开:0.895 对 0.038。两种分数的刻度也不同,embedding 的余弦在 0.5 到 0.7 之间挤成一团,rerank 的分数两头分得很开,这个特点后面做拒答判断时有用。

### 三个真实报错

接口调用必然会碰到的三种错,故意各制造一次,看真实的响应(我用 curl 打的,响应是 JSON,`data` 字段省略了)。key 写错:

```text
{"code":30014,"data":null,"message":"Token is invalid."}
HTTP 401
```

模型名写错(我写了个不存在的 `BAAI/bge-reranker-v9`):

```text
{"code":20012,"message":"Model does not exist. Please check it carefully.","data":null}
HTTP 400
```

传空列表(本地的 `if not documents` 就是为它准备的):

```text
{"code":20015,"message":"List should have at least 1 item after validation, not 0","data":null}
HTTP 400
```

三种都会被 `raise_for_status()` 变成 `httpx.HTTPStatusError`,异常信息里只有状态码,看不到上面这行 `message`。排查时要看响应体,在 `raise_for_status()` 前面加一句 `print(resp.text)` 就行。

还有一种不报错的怪事,我是试着玩才发现的:文档列表里混进一个**空字符串**,接口不报错,但这一项直接从结果里消失了。

```text
documents = ["退款政策", "", "发票"]   # 三项
[(0, 0.891), (2, 0.17)]                # 只返回两项,下标 1 不见了
```

好在返回的 `index` 仍然是原位置(0 和 2),用 `chunks[i]` 取块不会错位。但如果有人把结果和文档列表按位置 `zip` 起来,就会错一位。我们的块不会是空字符串,所以放在这里提醒一句:**结果的条数可能少于文档数,永远靠 `index` 对应,不要靠位置对应**,练习 2 会做一次错误的对应让你看到后果。

## 第二步:接在 RRF 后面,做成两阶段检索

现在把粗筛和精排接起来。粗筛就是 Day 236 练习 1 的 `hybrid_search` 的前半截:向量一路、BM25 一路各取前 `pool` 名,RRF 合并;精排是把合并后的前 `cand` 块送去 rerank。新建 `part04/rerank_search.py`:

```python
# agent-zero-lab/part04/rerank_search.py
"""两阶段检索:向量 + BM25 + RRF 粗筛出 cand 个候选,rerank 精排,返回前 k 块。"""
import psycopg

from common.embed import embed_one
from part04.bm25_index import BM25Index
from part04.chunking import Chunk, load_chunks
from part04.fusion import rrf
from part04.pg_store import connect, search
from part04.rerank import rerank_chunks


def candidates(
    conn: psycopg.Connection, bm25: BM25Index, query: str, pool: int = 20, cand: int = 20
) -> list[Chunk]:
    """粗筛:两路各取前 pool 名,RRF 合并,留前 cand 块(按 RRF 名次)。"""
    vec_hits = search(conn, embed_one(query), pool)
    kw_hits = bm25.search(query, pool)
    by_id = {c.id: c for c, _ in vec_hits + kw_hits}
    fused = rrf([[c.id for c, _ in vec_hits], [c.id for c, _ in kw_hits]])
    return [by_id[cid] for cid, _ in fused[:cand]]


def hybrid_rerank(
    conn: psycopg.Connection, bm25: BM25Index, query: str, k: int = 4, pool: int = 20, cand: int = 20
) -> list[tuple[Chunk, float]]:
    """粗筛 + 精排。返回 [(块, rerank 相关性分数)],最多 k 块。"""
    return rerank_chunks(query, candidates(conn, bm25, query, pool, cand), top_n=k)


if __name__ == "__main__":
    bm25 = BM25Index(load_chunks())
    with connect() as conn:
        for q in ["导入时报 E2017", "不想用了,钱能拿回来一部分吗"]:
            print(f"问:{q}")
            cands = candidates(conn, bm25, q)
            print(f"  粗筛留下 {len(cands)} 块,RRF 前 3:", [c.id for c in cands[:3]])
            for c, s in hybrid_rerank(conn, bm25, q):
                print(f"  {s:.3f}  {c.id:<9}{c.title} > {c.section}")
```

<div class="line-notes">

- `def candidates(` 单独拆出「粗筛」这半截,后面评测和练习都要单独用它拿到候选列表。返回值是 `list[Chunk]`,顺序就是 RRF 的名次。
- `pool: int = 20, cand: int = 20` 两个数管两件事:`pool` 是每一路各取多少名去做 RRF,`cand` 是 RRF 之后留多少块给 rerank。两路各取 20 名,合并后最多 40 块,`cand=20` 是只留前 20。
- `vec_hits = search(conn, embed_one(query), pool)` 向量一路,Day 232 的 `search`。
- `kw_hits = bm25.search(query, pool)` BM25 一路,Day 235 的 `BM25Index.search`,分数是 0 的块不返回,所以可能不足 20 块。
- `by_id = {c.id: c for c, _ in vec_hits + kw_hits}` `rrf` 只返回编号,这里先做一个「编号到块」的字典,融合完用它换回块对象(Day 236 常见误区里提到过)。
- `fused[:cand]` 先截断再换回块,顺序保持 RRF 的名次。精排之前和之后的名次对比就靠这个顺序。
- `rerank_chunks(query, candidates(conn` `hybrid_rerank` 只是把两步串起来。返回的分数是 rerank 的相关性分数,不再是 RRF 分数,也不是余弦。
- `print(f"  粗筛留下 {len(cands)} 块,RRF 前 3:"` 看一眼粗筛的结果,方便和精排之后对比。

</div>

```bash
uv run python -W ignore -m part04.rerank_search
```

```text
问:导入时报 E2017
  粗筛留下 20 块,RRF 前 3: ['kb-010#2', 'kb-012#1', 'kb-009#1']
  0.153  kb-012#1 错误码 E2017:发票识别失败 > 原因
  0.028  kb-012#2 错误码 E2017:发票识别失败 > 解决办法
  0.015  kb-009#2 导入银行流水 > 模板字段
  0.010  kb-010#2 错误码 E1042:银行流水导入失败 > 解决办法
问:不想用了,钱能拿回来一部分吗
  粗筛留下 20 块,RRF 前 3: ['kb-001#2', 'kb-002#1', 'kb-019#1']
  0.008  kb-002#3 退款政策 > 重复扣款
  0.005  kb-003#1 如何申请退款 > 操作步骤
  0.003  kb-002#1 退款政策 > 年付套餐
  0.003  kb-002#4 退款政策 > 审批与到账
```

第一个问题,E2017 终于排第 1:`kb-012#1` 从 RRF 的第 2 名升到了精排的第 1 名,压过了让 Day 236 头疼的 `kb-010#2`(E1042 的解决办法,掉到第 4)。注意它的分数只有 0.153,不高,「导入时报 E2017」这句话本来也没头没尾。

第二个问题不太好看:四个分数都在 0.01 以下,第一名是「重复扣款」,而我标的正确答案 `kb-002#1`(年付按比例退款)排第 3。这题我故意用得含糊,「不想用了」没说是年付还是月付,rerank 没法凭空知道,几个退款相关的块在它眼里差不多。分数全部很低也说明它「不太有把握」,这个信号后面会用上。

### 21 道题上量一量

两个例子说明不了问题。新建 `part04/rerank_eval.py`,把 Day 236 的 17 题和 Day 237 练习 4 的 4 道口语题合在一起,对每一题记「粗筛第一个正确块排第几」和「精排之后排第几」,并记 rerank 这一步花的时间:

```python
# agent-zero-lab/part04/rerank_eval.py
"""同一批题,RRF 的名次 和 RRF + rerank 的名次。EVAL 是 Day 236 的 17 题,HARD 是 Day 237 练习 4 的 4 道口语题。"""
import time

from part04.bm25_index import BM25Index
from part04.chunking import load_chunks
from part04.hybrid_eval import EVAL, first_rank, summarize
from part04.pg_store import connect
from part04.rerank import rerank_chunks
from part04.rerank_search import candidates

HARD: list[tuple[str, set[str]]] = [
    ("刷卡没成功", {"kb-013#1", "kb-013#2"}),
    ("新来的同事怎么拉进团队", {"kb-015#3"}),
    ("账本里的日期是斜杠,系统不认", {"kb-010#1"}),
    ("不想用了,钱能拿回来一部分吗", {"kb-002#1"}),
]


def evaluate(cases, pool: int = 20, cand: int = 20, verbose: bool = True):
    bm25 = BM25Index(load_chunks())
    before: list[int | None] = []
    after: list[int | None] = []
    ms: list[float] = []
    with connect() as conn:
        for q, gold in cases:
            cands = candidates(conn, bm25, q, pool, cand)
            t0 = time.perf_counter()
            ranked = rerank_chunks(q, cands, top_n=len(cands))
            ms.append((time.perf_counter() - t0) * 1000)
            b = first_rank([c.id for c in cands], gold)
            a = first_rank([c.id for c, _ in ranked], gold)
            before.append(b)
            after.append(a)
            if verbose:
                mark = "" if a == b else ("  <-- 变好" if (a or 99) < (b or 99) else "  <-- 变差")
                print(f"{b or '-':>4}{a or '-':>7}  {q}{mark}")
    return before, after, ms


if __name__ == "__main__":
    print("RRF 名次  rerank 名次(- 表示候选里一个正确块都没有)")
    before, after, ms = evaluate(EVAL + HARD)
    print()
    summarize("RRF", before)
    summarize("RRF+rerank", after)
    ms.sort()
    print(f"rerank 每次(20 个候选)耗时:中位数 {ms[len(ms) // 2]:.0f} 毫秒,最慢 {ms[-1]:.0f} 毫秒")
```

<div class="line-notes">

- `from part04.hybrid_eval import EVAL, first_rank, summarize` 复用 Day 236 的 17 题、`first_rank` 和 `summarize`(打印前 3 名命中数和 MRR)。导入 `hybrid_eval` 会顺手在模块级建一个 BM25,但评测本身在它的 `if __name__` 里,不会重跑。
- `HARD: list[tuple[str, set[str]]]` Day 237 练习 4 的 4 道口语题,每题一个问题加一个「算对的块」集合,这里原样搬过来。
- `def evaluate(cases, pool: int = 20, cand: int = 20, verbose: bool = True):` 写成函数,后面的候选数实验、练习都能直接调,`verbose=False` 时不打印每一题。
- `before: list[int | None] = []` 三个列表分别记:粗筛(RRF)的名次、精排的名次、rerank 耗时。名次是 `None` 表示候选里一个正确块都没有。
- `t0 = time.perf_counter()` 只给 rerank 这一步计时,不包括粗筛里的 embedding 调用和 SQL。
- `ranked = rerank_chunks(q, cands, top_n=len(cands))` 注意 `top_n=len(cands)`:评测要看**全部候选**精排后的完整顺序,才知道正确块排第几,所以不能只取前 4。
- `b = first_rank([c.id for c in cands], gold)` 精排之前的名次,候选顺序就是 RRF 名次。`a` 是精排之后的名次。
- `mark = "" if a == b else (` 名次变小是变好;`(a or 99)` 把 `None`(没找到)当成一个很大的数来比较。
- `ms[len(ms) // 2]` 排序后取中间那个,就是中位数。耗时有波动,中位数比平均数稳。

</div>

```bash
uv run python -W ignore -m part04.rerank_eval
```

真实输出:

```text
RRF 名次  rerank 名次(- 表示候选里一个正确块都没有)
   1      1  E1043 是什么错误
   2      1  导入时报 E2017  <-- 变好
   1      1  提示 E4029 怎么办
   1      1  支付失败 E3001 怎么处理
   2      1  买错了能把钱要回来吗  <-- 变好
   1      1  年付专业版用到第 3 个月想退,能退多少
   1      1  发票抬头开错了怎么办
   1      1  专业版最多几个人
   1      1  扣款失败了会怎样
   1      1  旧手机号不用了怎么换绑
   1      1  企业版误删数据能找回吗
   1      1  每分钟请求太多被限流了
   1      1  Excel 另存为 CSV 后导入失败
   1      1  账号注销后数据多久删除
   1      1  增值税专用发票谁能开
   1      1  优惠码能和企业版一起用吗
   1      1  钱被扣了两次
   1      1  刷卡没成功
   2      1  新来的同事怎么拉进团队  <-- 变好
   3      8  账本里的日期是斜杠,系统不认  <-- 变差
   2      3  不想用了,钱能拿回来一部分吗  <-- 变差

RRF        前 3 名命中 21/21   MRR 0.873
RRF+rerank 前 3 名命中 20/21   MRR 0.927
rerank 每次(20 个候选)耗时:中位数 380 毫秒,最慢 445 毫秒
```

读法:21 题里 3 题变好、2 题变差、16 题不变。MRR 从 0.873 到 0.927,涨了 0.054,但**前 3 名命中反而少了一题**(21/21 变成 20/21)。变好的三题是:E2017(2→1)、「买错了能把钱要回来吗」(2→1,我标的正确答案是退款三块,rerank 把申请退款那块拉到了前面)、「新来的同事怎么拉进团队」(2→1)。变差的两题:「账本里的日期是斜杠」从第 3 名掉到第 8 名,「不想用了」从第 2 名掉到第 3 名。

这个结果要老实看。rerank 不是魔法,它的平均水平比 RRF 好,但它自己也会判断失误,而且失误的时候是**把本来排得不错的挤下去**。「日期是斜杠」那题,我专门去看了:rerank 把 `kb-009#2`(导入银行流水 > 模板字段,里面写着「日期格式必须是 YYYY-MM-DD」)排第一,而我标的正确答案 `kb-010#1`(E1042 的原因,讲 Excel 把日期自动转成了 2026/… 这种斜杠格式)只拿到 0.004,掉到第 8 名。说实话 `kb-009#2` 也算半个答案,是我标得严;但 rerank 对「斜杠」这个关键细节没抓住,这也是它的真实水平。「不想用了」那题是问题本身没说清年付月付,几块退款的块分数都在 0.01 以下,谁排第一差不多是掷骰子。21 题的样本不大,0.054 的提升有一部分是偶然,别当成定律。明天的全流水线对比表会用更完整的方式比四种模式。

每次精排 380 毫秒(中位数),最慢 445 毫秒,这是对 20 个候选打分的成本。对一个本来就要等大模型回答几秒的客服问答来说可以接受,对要求几十毫秒的搜索框就太慢了。

### 候选数取多少

`cand` 越大,rerank 要读的文字越多,越慢也越贵;`cand` 越小,正确块越可能不在候选里,精排再准也没用。新建 `part04/rerank_pool.py`,把 5、10、20、40 个候选各跑一遍:

```python
# agent-zero-lab/part04/rerank_pool.py
"""候选数 cand 取多少:5 / 10 / 20 / 40 个候选送去精排,看 MRR、耗时、token。"""
from part04.hybrid_eval import EVAL
from part04.rerank import usage
from part04.rerank_eval import HARD, evaluate

cases = EVAL + HARD
print(f"{'候选数':>6}{'MRR':>8}{'没找到':>8}{'中位毫秒':>10}{'token/次':>10}")
for cand in (5, 10, 20, 40):
    t0 = usage["tokens"]
    before, after, ms = evaluate(cases, cand=cand, verbose=False)
    ms.sort()
    mrr = sum(1 / r for r in after if r) / len(after)
    missed = sum(r is None for r in after)
    print(f"{cand:>6}{mrr:>8.3f}{missed:>8}{ms[len(ms) // 2]:>10.0f}{(usage['tokens'] - t0) / len(cases):>10.0f}")
```

<div class="line-notes">

- `from part04.rerank import usage` 用 `rerank.py` 里那个小账本。每次 `rerank()` 成功就把 `input_tokens` 累加进去。
- `t0 = usage["tokens"]` 记下跑这一档之前的累计值,跑完用差值算这一档花了多少。
- `evaluate(cases, cand=cand, verbose=False)` 复用上一节的函数,只改 `cand`,不打印每题。
- `mrr = sum(1 / r for r in after if r) / len(after)` 和 Day 236 一样的 MRR,`if r` 挡掉没找到的(`None`),分母仍是全部 21 题。
- `(usage['tokens'] - t0) / len(cases)` 这一档平均每次精排用了多少个输入 token。

</div>

```bash
uv run python -W ignore -m part04.rerank_pool
```

```text
   候选数     MRR     没找到      中位毫秒  token/次
     5   0.940       0       236       335
    10   0.930       0       285       685
    20   0.927       0       392      1317
    40   0.927       0       437      1395
```

耗时和 token 基本随候选数线性涨:5 个候选 236 毫秒、335 token,20 个候选 392 毫秒、1317 token。MRR 倒是反过来,候选越少越高(0.940 对 0.927)。这看着反常,其实好解释:候选少意味着干扰项少,而我们的 42 块知识库里,RRF 前 5 名几乎总是包含正确块(「没找到」一列全是 0)。这是小知识库的特殊情况,不要拿来当「候选越少越好」的依据。40 个候选的数字和 20 个几乎一样,是因为两路各取 20 名合并后总共也就二十出头块,`cand=40` 其实没有 40 块可送。

真正要防的是另一头:候选太少,正确块被挡在门外。练习 1 会把 `cand` 压到 1、2、3,看 MRR 怎么掉。

## 第三步:rerank 分数能不能拿来判断「该答还是该拒」

Day 227 讲过拒答,Day 235 说过 BM25 的分数不能设阈值,Day 237 说过 RRF 的分数不能用。那 rerank 的呢?它和 embedding 的余弦一样是「这段文字和问题有多相关」,只是刻度不同。用 [Day 227](/blog/agent-zero/day-227-rag-prompt/) 的 10 道拒答题试一下(5 道资料里有答案,5 道没有),每题记两个数:向量检索第一名的相似度,rerank 第一名的分数。新建 `part04/rerank_score_gap.py`:

```python
# agent-zero-lab/part04/rerank_score_gap.py
"""Day 227 拒答测试的 10 道题:该答的和该拒的,向量第一名的相似度、rerank 第一名的分数,能不能拉开?"""
from common.embed import embed_one
from part04.bm25_index import BM25Index
from part04.chunking import load_chunks
from part04.pg_store import connect, search
from part04.rerank import rerank_chunks
from part04.rerank_search import candidates

ANSWER = ["年付专业版用到第 3 个月想退,能退多少", "导入流水提示 E1042 怎么办", "专业版最多几个人",
          "月付的专业版能开增值税专用发票吗", "免费版能用开放 API 吗"]
REFUSE = ["你们支持微信支付吗", "有没有手机 App 可以记账", "账本能直接导到金蝶里吗",
          "企业版专属客服的电话是多少", "发票可以邮寄纸质版吗"]
bm25 = BM25Index(load_chunks())
rows: list[tuple[str, float, float]] = []
with connect() as conn:
    for group, qs in (("该答", ANSWER), ("该拒", REFUSE)):
        for q in qs:
            vec_top = search(conn, embed_one(q), 1)[0][1]
            rr_top = rerank_chunks(q, candidates(conn, bm25, q), top_n=1)[0][1]
            rows.append((group, vec_top, rr_top))
            print(f"{group}  向量第 1 名 {vec_top:.3f}   rerank 第 1 名 {rr_top:.3f}   {q}")
for name, idx in (("向量相似度", 1), ("rerank 分数", 2)):
    a = [r[idx] for r in rows if r[0] == "该答"]
    f = [r[idx] for r in rows if r[0] == "该拒"]
    print(f"{name}:该答最低 {min(a):.3f},该拒最高 {max(f):.3f}  ->", "能用一条线分开" if min(a) > max(f) else "有重叠,分不开")
```

<div class="line-notes">

- `ANSWER = [` 前五题是 Day 227 里「资料里有答案」的,后五题是「资料里没有」的,题目和 Day 227、232 用的是同一批。
- `rows: list[tuple[str, float, float]] = []` 每题存三项:分组、向量第一名相似度、rerank 第一名分数。
- `vec_top = search(conn, embed_one(q), 1)[0][1]` `search(..., 1)` 只取 1 块,返回 `[(块, 相似度)]`,`[0][1]` 取第一项的相似度。
- `rerank_chunks(q, candidates(conn, bm25, q), top_n=1)[0][1]` 先粗筛二十块再精排取第一名,`[0][1]` 是它的 rerank 分数。
- `for name, idx in (("向量相似度", 1),` 用同一段代码处理两列:`idx` 是 `rows` 元组里的位置。`min(a)` 是该答题里最低的第一名分数,`max(f)` 是该拒题里最高的。两组之间有没有缝,看 `min(a) > max(f)`。

</div>

```bash
uv run python -W ignore -m part04.rerank_score_gap
```

```text
该答  向量第 1 名 0.839   rerank 第 1 名 0.985   年付专业版用到第 3 个月想退,能退多少
该答  向量第 1 名 0.727   rerank 第 1 名 0.979   导入流水提示 E1042 怎么办
该答  向量第 1 名 0.728   rerank 第 1 名 0.985   专业版最多几个人
该答  向量第 1 名 0.738   rerank 第 1 名 0.981   月付的专业版能开增值税专用发票吗
该答  向量第 1 名 0.715   rerank 第 1 名 0.893   免费版能用开放 API 吗
该拒  向量第 1 名 0.595   rerank 第 1 名 0.076   你们支持微信支付吗
该拒  向量第 1 名 0.611   rerank 第 1 名 0.075   有没有手机 App 可以记账
该拒  向量第 1 名 0.538   rerank 第 1 名 0.008   账本能直接导到金蝶里吗
该拒  向量第 1 名 0.571   rerank 第 1 名 0.004   企业版专属客服的电话是多少
该拒  向量第 1 名 0.673   rerank 第 1 名 0.174   发票可以邮寄纸质版吗
向量相似度:该答最低 0.715,该拒最高 0.673  -> 能用一条线分开
rerank 分数:该答最低 0.893,该拒最高 0.174  -> 能用一条线分开
```

两个分数都能把这 10 题分开,但缝的宽度差很多。向量相似度:该答最低 0.715,该拒最高 0.673,缝只有 0.042,阈值稍微挪一点就会判错;「发票可以邮寄纸质版吗」这题 0.673 已经贴着线了(它确实和发票资料很近,只是资料里没说邮寄)。rerank 分数:该答最低 0.893,该拒最高 0.174,缝有 0.719,阈值放在 0.5 附近很宽松。练习 4 会拿 6 道新题检验这条线。

这件事的意义不小:Day 227 的拒答是靠 prompt 让模型自己说「没找到」,模型要读完全部资料、花一次完整的对话调用才知道该拒。有了 rerank 分数,可以在调模型**之前**就判断:精排第一名低于阈值,直接回「建议转人工」,省一次调用。但 10 题是很小的样本,阈值要用更大的评估集定,不要拿今天的 0.5 直接上线。

## 第四步:代价和局限

放在一起说,今天的 rerank 有这几件事要心里有数。

延迟:20 个候选一次 200 到 450 毫秒。它是一次额外的网络往返,而且是串在检索后面的,没法和检索并行。自部署重排序模型要有 GPU 才快,我这台 Intel MacBook 跑不动,所以今天全部走接口。

候选决定上限:rerank 只能重新排你给它的那几块,正确块不在里面就没救(练习 1)。粗筛要保证召回,精排才有意义,这就是「粗筛宁多勿少」的原因。

文本长度:单次请求里问题加文档总共不能超过模型的 8192 个 token。我专门试过,超了接口直接返回 400,不会悄悄截断(练习 3)。我们的块不超过 200 字,不碰这个限制;块切得很长的话要留意,接口的 `max_chunks_per_doc` 参数可以把长文档拆成几段各自打分,取最高分。

它也会错:今天 21 题里有 2 题变差。所以上线前要用自己的评估集看精排是不是真的有净收益,而不是「听说 rerank 好就加上」。

## 动手练习

**练习 1:候选太少会怎样?** 把 `cand` 压到 1、2、3、5,在 21 题上看「没找到」的题数和 MRR。解释为什么 `cand=1` 时 rerank 什么都做不了。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_w38_ceiling.py
from part04.hybrid_eval import EVAL
from part04.rerank_eval import HARD, evaluate

cases = EVAL + HARD
print(f"{'候选数':>6}{'没找到':>8}{'MRR':>8}")
for cand in (1, 2, 3, 5):
    before, after, _ = evaluate(cases, cand=cand, verbose=False)
    missed = [q for (q, _), r in zip(cases, after) if r is None]
    mrr = sum(1 / r for r in after if r) / len(after)
    print(f"{cand:>6}{len(missed):>8}{mrr:>8.3f}   {missed[:3]}")
```

<div class="line-notes">

- `for cand in (1, 2, 3, 5):` 候选只留 RRF 的前几名。`cand=1` 时精排只有一块可排,等于没精排。
- `before, after, _ = evaluate(` 返回三项,这里只要 `after`(精排后的名次),`before` 和耗时用 `_` 丢掉。注意 `_` 在这个脚本里同时被 `for (q, _)` 用了一次,两处互不影响,因为推导式的变量只在推导式里有效。
- `missed = [q for (q, _), r in zip(cases, after) if r is None]` 把每题的 `(问题, 答案集合)` 和名次配对,名次是 `None` 的题记下问题文字。
- `missed[:3]` 只打印前 3 个没找到的问题,太长不好读。

</div>

```text
   候选数     没找到     MRR
     1       5   0.762   ['导入时报 E2017', '买错了能把钱要回来吗', '新来的同事怎么拉进团队']
     2       1   0.952   ['账本里的日期是斜杠,系统不认']
     3       0   0.968   []
     5       0   0.940   []
```

`cand=1` 时有 5 题没找到,恰好是 RRF 里第一名不对的那 5 题,因为 rerank 只拿到一块候选,谁也比不了,分数再准也改不了名次。`cand=2` 时只剩一题没找到:「账本里的日期是斜杠」的正确块在 RRF 排第 3,门外。`cand=3` 起全找到了,而且 MRR(0.968)还比 `cand=20`(0.927)高,理由和正文一样:候选里的干扰项少了,rerank 犯错的机会也少了。这是 42 块的小知识库里 RRF 前 3 名几乎总包含答案的结果,真实知识库不会这么顺,别学成「候选取 3 个就行」。

</details>

**练习 2:拿错了列表取块。** `rerank()` 返回的下标对应传进去的那个列表。写一个脚本,故意把下标拿到 `load_chunks()` 的原始 42 块里去取,看会取出什么,对比正确的取法。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_w38_index.py
from part04.bm25_index import BM25Index
from part04.chunking import load_chunks
from part04.pg_store import connect
from part04.rerank import rerank
from part04.rerank_search import candidates

Q = "导入时报 E2017"
all_chunks = load_chunks()
bm25 = BM25Index(all_chunks)
with connect() as conn:
    cands = candidates(conn, bm25, Q)
hits = rerank(Q, [c.text for c in cands], top_n=2)
print("rerank 返回的下标:", [i for i, _ in hits])
print("对:拿下标去 cands(传给 rerank 的那个列表)里取:", [cands[i].id for i, _ in hits])
print("错:拿下标去 all_chunks(42 块的原始顺序)里取  :", [all_chunks[i].id for i, _ in hits])
```

<div class="line-notes">

- `all_chunks = load_chunks()` 42 块的原始顺序(按文件和小节),和 RRF 之后的顺序毫无关系。
- `cands = candidates(conn, bm25, Q)` 粗筛后的 20 块,顺序是 RRF 名次。传给 rerank 的文本列表是它们的 `.text`。
- `hits = rerank(Q, [c.text for c in cands], top_n=2)` 返回 `[(下标, 分数), ...]`。下标是**这 20 块的位置**,取值范围 0 到 19。
- `[cands[i].id for i, _ in hits]` 正确的取法:用传进去的列表取。
- `[all_chunks[i].id for i, _ in hits]` 错误的取法:下标 1 和 4 去 42 块的原始顺序里取,取到的是 `kb-001#2` 和 `kb-002#3`,和问题毫无关系。

</div>

```text
rerank 返回的下标: [1, 4]
对:拿下标去 cands(传给 rerank 的那个列表)里取: ['kb-012#1', 'kb-012#2']
错:拿下标去 all_chunks(42 块的原始顺序)里取  : ['kb-001#2', 'kb-002#3']
```

错的那一行不报错,返回的也是两个合法的块编号,只是讲的是套餐怎么选和重复扣款,和 E2017 无关,下游模型拿到这样的资料就会答非所问。这个坑的根源是下标只有在「传进去的那个列表」里才有意义。`rerank_chunks` 把「传文本」和「按下标取块」放在同一个函数里,就是为了不让调用方碰到这个坑。

</details>

**练习 3:文本太长会怎样?** 做一个「答案在最前」和「答案在最后」的长文档(用一段无关的话重复很多遍,再把那句答案放在开头或结尾),看 rerank 分数随长度怎么变,以及超过模型上限时接口怎么回应。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_w38_long.py
import httpx

from part04.rerank import BASE, KEY, MODEL

Q = "导入的时候报 E1043 怎么办"
ANSWER = "错误码 E1043:文件编码错误。文件不是 UTF-8 编码,Excel 另存 CSV 默认是 GBK,在 Excel 里另存为 CSV UTF-8 即可。"
UNIT = "导入银行流水时,请先准备好模板文件,检查日期列和金额列的格式,确认文件大小不超过限制。"
OTHER = "导入银行流水:支持 CSV 和 XLSX,单个文件不超过 10 MB。"


def call(doc: str) -> httpx.Response:
    return httpx.post(
        f"{BASE}/rerank",
        headers={"Authorization": f"Bearer {KEY}"},
        json={"model": MODEL, "query": Q, "documents": [doc, OTHER], "top_n": 2},
        timeout=60,
    )


err = ""
print(f"{'文档字数':>8}  答案在最前  答案在最后")
for n in (0, 60, 400, 800, 1500):
    row = []
    for doc in (ANSWER + UNIT * n, UNIT * n + ANSWER):
        r = call(doc)
        if r.status_code != 200:
            row.append(f"HTTP {r.status_code}")
            err = r.text[:120]
        else:
            row.append(f"{next(x['relevance_score'] for x in r.json()['results'] if x['index'] == 0):.3f}")
    print(f"{len(ANSWER + UNIT * n):>8}  {row[0]:>9}  {row[1]:>9}")
print("最后一次的错误体:", err or "(没有错误)")
```

<div class="line-notes">

- `from part04.rerank import BASE, KEY, MODEL` 直接用 `rerank.py` 里读好的配置,这个脚本不用 `rerank()` 函数,因为要拿到原始响应看状态码。
- `"documents": [doc, OTHER]` 每次放两篇:一篇是被测的长文档,一篇是个短的干扰项。只看下标 0(长文档)的分数。
- `for doc in (ANSWER + UNIT * n, UNIT * n + ANSWER):` `UNIT * n` 是一段无关的话重复 `n` 次,模拟越来越长的文档,`n=0` 就是只有答案那一句。同一段内容两种排法:答案在最前、答案在最后,看位置有没有影响。
- `if r.status_code != 200:` 不用 `raise_for_status()`,而是自己判断,要把 400 的响应体存下来看(`err = r.text[:120]`)。
- `next(x['relevance_score'] for x in r.json()['results'] if x['index'] == 0)` 从结果里找下标是 0 的那一项的分数。结果顺序按分数排,长文档不一定在第一位,所以要按 `index` 找。

</div>

```text
    文档字数  答案在最前  答案在最后
      78      0.965      0.965
    2658      0.971      0.945
   17278      0.949      0.913
   34478   HTTP 400   HTTP 400
   64578   HTTP 400   HTTP 400
最后一次的错误体: {"code":20015,"message":"This model's maximum context length is 8192 tokens. However, you requested 8193 tokens in the i
```

我原本猜长文档里的答案会被「稀释」得很厉害,没想到到 1.7 万字(约几千 token)分数也只是从 0.965 掉到 0.949(答案在前)和 0.913(答案在后),答案在最后掉得略多一点,但都远高于该拒的 0.17 以下。到 3.4 万字就超过 8192 个 token,接口直接返回 400,错误体写得很清楚(后半截我截掉了)。结论是:这个模型对中等长度的文档很稳,超长会明确报错而不是悄悄截断。我们的块不超过 200 字,用不上这个余量,但如果你的知识库按整篇文章而不是按小节送去精排,就要把长度算进去。

</details>

**练习 4(开放题):用 rerank 分数拒答,拿新题验证。** 把阈值定在 0.5,用 6 道没参与定阈值的新题(3 道该答、3 道该拒)检验,看判对几道。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_w38_threshold.py
from part04.bm25_index import BM25Index
from part04.chunking import load_chunks
from part04.pg_store import connect
from part04.rerank import rerank_chunks
from part04.rerank_search import candidates

THRESHOLD = 0.5  # 上一节两组分数的分界:该拒最高 0.174,该答最低 0.893,取中间附近
NEW = [
    ("退款审批通过后几天到账", "答"), ("邀请成员的链接多久过期", "答"), ("汇率几点更新", "答"),
    ("你们公司总部在哪个城市", "拒"), ("支持 Linux 客户端吗", "拒"), ("能用 PayPal 付款吗", "拒"),
]
bm25 = BM25Index(load_chunks())
ok = 0
with connect() as conn:
    for q, want in NEW:
        top = rerank_chunks(q, candidates(conn, bm25, q), top_n=1)[0]
        got = "答" if top[1] >= THRESHOLD else "拒"
        ok += got == want
        print(f"{'✓' if got == want else '✗'} 该{want} 判{got}  最高分 {top[1]:.3f} ({top[0].id})  {q}")
print(f"{ok}/{len(NEW)}")
```

<div class="line-notes">

- `THRESHOLD = 0.5` 阈值是在上一节那 10 道题上看出来的:该答最低 0.893,该拒最高 0.174,0.5 在缝的中间。这 6 道新题没参与过定阈值。
- `NEW = [` 每题带一个「该答/该拒」的标签。三道该答的在知识库里都有明确原文(`kb-002#4`、`kb-015#3`、`kb-020#2`),三道该拒的知识库里完全没有。
- `top = rerank_chunks(q, candidates(conn, bm25, q), top_n=1)[0]` 取精排第一名,`top` 是 `(块, 分数)`,`top[1]` 是分数,`top[0].id` 是块编号。
- `got = "答" if top[1] >= THRESHOLD else "拒"` 就是整个判断规则:第一名分数不低于阈值就答,否则拒。
- `ok += got == want` 布尔值加进整数,判对一题加 1。

</div>

```text
✓ 该答 判答  最高分 0.993 (kb-002#4)  退款审批通过后几天到账
✓ 该答 判答  最高分 0.993 (kb-015#3)  邀请成员的链接多久过期
✓ 该答 判答  最高分 0.973 (kb-020#2)  汇率几点更新
✓ 该拒 判拒  最高分 0.007 (kb-018#1)  你们公司总部在哪个城市
✓ 该拒 判拒  最高分 0.005 (kb-001#2)  支持 Linux 客户端吗
✓ 该拒 判拒  最高分 0.003 (kb-013#2)  能用 PayPal 付款吗
6/6
```

6/6 全对,而且分数很两极:该答的都在 0.97 以上,该拒的都在 0.01 以下。不过这 6 题太干净了,没有一道是「资料里沾边但没说」的灰色地带(比如问「专业版能不能开发票抬头写个人」)。真正的难点在灰色地带,阈值要用成百上千道含灰色题的评估集去定,这是评测部分的事。示范的价值是让你看到流程:先用一批题定阈值,再用另一批没参与过的题检验。

</details>

验收标准:`rerank.py` 的三个真实报错(401/400/400)你能在自己机器上复现;`rerank_eval.py` 跑出的「变好/变差」题数和文中一致或接近(接口分数会有微小浮动,名次变动的题可能差一两题);`rerank_score_gap.py` 里该答和该拒能分开,并且你能说出为什么 rerank 的缝比向量宽。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 重排序(rerank) | 对已经粗筛出来的候选再排一次。模型逐个读「问题加这一块」,给出相关性分数,按分数重排 |
| bi-encoder(双塔) | embedding 模型的结构:问题和文档各自编码成向量,最后才算相似度。文档向量可以提前存,快,但两边互相看不见 |
| cross-encoder(交叉编码) | 重排序模型的结构:问题和文档拼在一起送进模型,一次看完两段,直接输出相关性分数。准,但每对都要现算 |
| 两阶段检索 | 第一阶段用便宜的办法(向量、BM25、RRF)粗筛几十块,第二阶段用贵的模型(rerank)精排。也叫「召回加排序」 |
| 候选数(cand) | 粗筛之后送去精排的块数。越多越慢越贵,太少会把正确块挡在门外 |
| 相关性分数(relevance_score) | rerank 模型给的分,0 到 1 之间,这个模型下两头分得很开。刻度和余弦不一样,不能拿余弦的阈值来比 |
| Cohere 风格接口 | `POST /rerank`,请求有 `query`、`documents`、`top_n`,响应 `results` 里每项有 `index` 和 `relevance_score`。Cohere、Jina、硅基流动等都兼容这个形状 |

## 常见误区

**以为 rerank 一定让每道题都变好。** 今天 21 题里 3 题变好、2 题变差、16 题不变。它的平均水平更好,但会把排得不错的块挤下去。上线前用评估集看净收益。

**用 `index` 去错误的列表里取块。** 下标只对「传进去的那个列表」有效,拿到别的列表里取不会报错,取出来的块和问题无关(练习 2)。`rerank_chunks` 把两步放在一起就是为了避免它。

**靠位置对应结果和文档。** 接口对空字符串的文档会直接丢掉那一项,结果条数可能少于文档数,只有 `index` 靠得住。

**候选取得太少。** `cand=1` 时精排形同虚设(练习 1),正确块不在候选里,精排再准也没用。粗筛要保证召回。

**拿 embedding 的阈值来判 rerank 分数。** 两种分数的刻度完全不同:embedding 余弦挤在 0.5 到 0.8,rerank 分数分布在 0 到 1 的两头。阈值要用自己的数据重新定,不要借。

**只看 MRR 的涨幅就下结论。** 21 题里 MRR 涨 0.054,但前 3 名命中还少了一题。样本小的时候涨跌一两题就能改变结论,至少要把变好、变差的具体题目列出来看。

**报错只看状态码。** `raise_for_status()` 的异常里只有 401、400 这样的数字。真正的原因(`Token is invalid`、`Model does not exist`、`List should have at least 1 item`)在响应体里,要自己 `print(resp.text)`。

**忽略 rerank 的延迟。** 每次多 200 到 450 毫秒,串在检索后面。如果前端有「打字即搜」这种要求,不适合直接上;客服问答等大模型本来就慢的场景才划算。

## 学习资料

### 文档与文章

- [硅基流动 · Create rerank](https://docs.siliconflow.com/en/api-reference/rerank/create-rerank):今天调的接口的官方文档。看请求参数表和响应字段,特别是 `max_chunks_per_doc` 和 `overlap_tokens` 的说明。
- [BAAI/bge-reranker-v2-m3 · Hugging Face](https://huggingface.co/BAAI/bge-reranker-v2-m3):今天用的模型的主页,看模型简介和多语言说明,模型卡里还有自己部署的示例代码。
- [Sentence-Transformers · Retrieve & Re-Rank](https://sbert.net/examples/sentence_transformer/applications/retrieve_rerank/README.html):英文,Bi-Encoder 加 Cross-Encoder 两阶段做法的经典说明,配了流程图,和今天的两种模型对比是同一个意思。
- [Cohere · Rerank overview](https://docs.cohere.com/docs/rerank-overview):`/rerank` 这个接口形状的源头。看一下请求和响应的字段,和硅基流动对照。
- Rodrigo Nogueira、Kyunghyun Cho,《Passage Re-ranking with BERT》([arXiv 1901.04085](https://arxiv.org/abs/1901.04085)):用 cross-encoder 做段落重排的早期代表工作,不用通读,看摘要和实验表,知道「先召回再精排」这条路是怎么走出来的。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1kndSB7Emx&autoplay=0&high_quality=1" title="混合检索(相似度+BM25)、RRF融合、Cross-Encoder精排序" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>_叶落秋白 · 混合检索(相似度+BM25)、RRF融合、Cross-Encoder精排序 · 约 3 分钟,从混合检索一路讲到最后的精排序,对上今天两阶段流水线的整体样子。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/7ZU85v4Kt-Y" title="Do Reranking Models Actually Improve RAG?" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Adam Lucek · Do Reranking Models Actually Improve RAG? · 英文,标题就是今天最后要问的问题:重排序有没有净收益,看他怎么设计对照实验。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/3HOOUMvN5vg" title="What's the difference between Fusion and Reranking in RAG? What's RRF? Common Interview Question" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Keerti Purswani · What's the difference between Fusion and Reranking in RAG? What's RRF? · 英文,面试常问的「融合和重排序有什么区别」,正好把 Day 236 的 RRF 和今天的 rerank 放在一起比。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):检索那一章里有重排序的段落,讲它为什么放在检索之后,以及为什么对延迟敏感。读完今天再看,把「召回加排序」的名词对上号。

### 开源项目与代码

- [FlagOpen/FlagEmbedding](https://github.com/FlagOpen/FlagEmbedding):BAAI 的 bge 系列(embedding 和 reranker)的官方仓库,README 里有 `FlagReranker` 的最小用法,想自己用 GPU 部署重排序模型时从这里开始。
- [dorianbrown/rank_bm25](https://github.com/dorianbrown/rank_bm25):Day 235 的库,粗筛里 BM25 那一路用的就是它。

## 自测

**1. bi-encoder 和 cross-encoder 的核心区别是什么?为什么前者能存向量、后者不能?**

<details><summary>答案</summary>

bi-encoder 把问题和文档各自独立编码成向量再算相似度,文档的向量只和文档自己有关,所以可以提前算好存起来,查询时只编码问题。cross-encoder 把问题和文档拼在一起输入模型,输出的分数同时取决于两者,只有问题来了才能算,所以不能提前存,每个(问题,文档)对都要跑一次模型。

</details>

**2. 为什么重排序只能对粗筛之后的二十来块做,不能对全库做?**

<details><summary>答案</summary>

cross-encoder 的成本和文档数成正比,每块都要和问题拼在一起跑一次模型。全库几十万块的话,一次查询就要几十万次模型调用,延迟和费用都不可接受。所以先用便宜的向量加 BM25 缩小到几十块,再精排。代价是粗筛漏掉的正确块,精排救不回来。

</details>

**3. `rerank()` 返回的 `index` 是什么意思?拿它去另一个列表里取块会怎样?**

<details><summary>答案</summary>

`index` 是这篇文档在你传进去的 `documents` 列表里的位置。拿它去别的列表(比如 42 块的原始顺序)取块,不会报错,但取出来的块和问题无关,下游模型会答非所问。要么在同一个函数里完成「传文本、按下标取块」,要么保证用的是同一个列表。

</details>

**4. 今天 21 题的结果:RRF 加 rerank 的 MRR 比 RRF 高 0.054,但前 3 名命中少了一题。这说明什么?**

<details><summary>答案</summary>

说明 rerank 的平均名次更好(几题从第 2 名升到第 1 名),但它也会判错,把一个原本排第 3 名的正确块推到第 8 名。MRR 对「第 2 升第 1」奖励很大,对「第 3 降第 8」惩罚很小,所以总体看涨了,但丢掉了前 3 名的稳定性。样本只有 21 题,涨跌一两题就能改变结论,所以要把变好和变差的具体题目都列出来,并在更大的评估集上验证。

</details>

**5. 面试题:你的 RAG 系统检索结果不够准,有人建议加一个 rerank 模型。你怎么决定要不要加?**

<details><summary>答案</summary>

先确认问题出在排序而不是召回:看评估集里正确块有多少在粗筛的前 20 名里,如果正确块根本没进候选,加 rerank 没用,要先改切块、混合检索、查询改写这些。如果正确块多数在前 20 但排得靠后,rerank 才对症。然后做对比实验:同一批题,量加之前和加之后的 MRR、前 3 名命中,并列出变差的题;同时量延迟(每次几百毫秒)和成本(按 token 或按次计费),看业务能不能接受。还要评估能不能顺带用它的分数做拒答,省掉一些大模型调用。最后上线时留一个开关,方便出了问题关掉。

</details>

**6. 为什么 rerank 分数比向量相似度更适合做「该答还是该拒」的判断?**

<details><summary>答案</summary>

因为它的分数分布两头分得更开。今天 10 道题上,向量相似度该答最低 0.715、该拒最高 0.673,缝只有 0.042;rerank 分数该答最低 0.893、该拒最高 0.174,缝有 0.719。它是 cross-encoder,直接读问题和块的组合判断相关性,不像 embedding 只比两个向量的方向。不过 10 题样本很小,阈值要在更大、含灰色地带的评估集上定。

</details>

## 明天预告

明天是 [Day 239 · Query 改写](/blog/agent-zero/day-239-query-rewrite/)。今天的两阶段流水线有个前提:用户的问题得能直接拿去检索。真实用户常说「那年付的呢」「我上周买的那个能退不」「发票开错了还有导入一直报错」,单独拿出来检索就是没头没尾,或者一句话里塞了两个问题。明天让大模型在检索之前先把问题改写一遍,补全上下文、拆开多个问题,并定下改写时必须守的两条规则。
