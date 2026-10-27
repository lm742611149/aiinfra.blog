---
title: 'Day 373 · 反馈闭环(二):badcase 分诊、聚类、进测试集'
description: '昨天收进来 200 条回复和一堆信号。今天出分诊报表、给回复打可疑度、用 embedding 把说法不同的同一类问题聚成组(实测 41 条可疑回复聚成 3 个真问题加 2 个误点),人审以后变成带脱敏和护栏的测试用例,知识缺失的起草成帮助中心文章,最后把用例接回 Day 371 的手册门禁。'
pubDate: 2026-10-27
regime: none
tags: ['feedback', 'embedding', 'clustering', 'eval', 'agent-zero']
series: 'agent-zero'
day: 373
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 372](/blog/agent-zero/day-372-feedback-1/) 建了一张回复表和一张反馈事件表,写了三个收反馈的接口,算了草稿的改写比例,又造了一周共 200 条虚构回复。实测的两个数字要带到今天:只有 60 条回复有人点赞点踩,重度改写的 39 条里只有 8 条被点踩。也就是说,光看点踩会漏掉将近八成的问题,隐式信号要补上,但它噪声大,得有人看。

今天的问题是:信号收齐了,下一步怎么从 200 条里找出「真正该修的几件事」,并且让它们下次不再出错。

## 今天要解决的问题

学完今天你应该能:

1. 写出每周分诊脚本的前半:按类别出健康报表,给每条回复算可疑度,挑出候选。
2. 用 embedding 把说法不同的同类问题聚成组,并用一份已知答案选出聚类阈值。
3. 把人审通过的组变成带脱敏、护栏、查重的测试用例,把知识缺失的组起草成帮助中心文章。
4. 说清数据飞轮的三个出口(测试集、知识库、改提示词和手册),并把线上用例接回 [Day 371](/blog/agent-zero/day-371-prompt-opt-3/) 的门禁。

今天两个新概念:**聚类分诊**(把相似的坏回复归成一组再审),和**数据飞轮**(一次事故变成测试用例、知识库文章和手册规则,下一版挡住同样的错)。

预计用时 3 小时,是这一周里偏重的一天。实跑花费约 0.007 元:模型猜原因 5 次调用约 0.0038 元,起草文章 2 次约 0.0019 元,接回门禁 2 次约 0.0010 元;embedding 走硅基流动的 bge-m3,实测 41 条一共 1532 个 token,[Day 217](/blog/agent-zero/day-217-embed-service/) 说过它免费。前置:昨天的 `fb_store.py` 等文件和 `fb_simulate` 造好的库;[Day 217](/blog/agent-zero/day-217-embed-service/) 的 `common/embed.py`;[Day 347](/blog/agent-zero/day-347-error-analysis-3/) 的失败分类;[Day 348](/blog/agent-zero/day-348-testcase-structure/) 的用例结构(今天的用例字段是我按实跑需要定的,和你 Day 348 的 `Case` 不完全一样,字段名以你自己的为准);[Day 354](/blog/agent-zero/day-354-testset-size/) 的 md5 分组;Day 371 的 `ace_lite.py`。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章,把 `cluster()` 默写出来;做练习时先自己写,做不出再展开参考答案,看完关掉重写一遍。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="数据飞轮:线上回复和信号、每周分诊、聚类成组、人审,然后三个出口:进测试集、补知识库、改提示词或手册,过门禁后回到线上">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="14" y="24" width="112" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="26" y="46" fill="var(--ink)">线上回复</text>
<text x="26" y="63" fill="var(--ink-faint)" font-size="11">+ 反馈信号</text>
<rect x="158" y="24" width="112" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="170" y="46" fill="var(--ink)">每周分诊</text>
<text x="170" y="63" fill="var(--ink-faint)" font-size="11">报表+可疑度</text>
<rect x="302" y="24" width="112" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="314" y="46" fill="var(--ink)">聚类成组</text>
<text x="314" y="63" fill="var(--ink-faint)" font-size="11">embedding</text>
<rect x="446" y="24" width="112" height="50" rx="6" fill="none" stroke="var(--ink-soft)"/>
<text x="458" y="46" fill="var(--ink)">人审</text>
<text x="458" y="63" fill="var(--ink-faint)" font-size="11">真错?对在哪?</text>
<rect x="446" y="130" width="150" height="34" rx="6" fill="none" stroke="var(--rule)"/>
<text x="458" y="152" fill="var(--ink)">① 进测试集</text>
<rect x="446" y="176" width="150" height="34" rx="6" fill="none" stroke="var(--rule)"/>
<text x="458" y="198" fill="var(--ink)">② 补知识库</text>
<rect x="446" y="222" width="150" height="34" rx="6" fill="none" stroke="var(--rule)"/>
<text x="458" y="244" fill="var(--ink)">③ 改提示词/手册</text>
<rect x="158" y="176" width="150" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="170" y="198" fill="var(--ink)">过门禁才上线</text>
<text x="170" y="215" fill="var(--ink-faint)" font-size="11">Day 371 / 375</text>
<line x1="126" y1="49" x2="156" y2="49" stroke="var(--ink-soft)"/>
<line x1="270" y1="49" x2="300" y2="49" stroke="var(--ink-soft)"/>
<line x1="414" y1="49" x2="444" y2="49" stroke="var(--ink-soft)"/>
<line x1="502" y1="76" x2="502" y2="128" stroke="var(--ink-soft)"/>
<line x1="446" y1="147" x2="310" y2="190" stroke="var(--ink-soft)"/>
<line x1="446" y1="193" x2="310" y2="200" stroke="var(--ink-soft)"/>
<line x1="446" y1="239" x2="310" y2="214" stroke="var(--ink-soft)"/>
<line x1="170" y1="176" x2="90" y2="76" stroke="var(--ink-soft)"/>
</g>
</svg>
<figcaption>一圈大约一周。前三步全自动,人审必须是人,三个出口都要回到门禁。飞轮转起来以后,测试集里来自线上的用例会越来越多。</figcaption>
</figure>

## 第一步:报表和可疑度

分诊脚本做三件事:先出一张按类别的健康报表,看哪里在变坏;再给每条回复算一个可疑度分数;最后挑出候选。前两件放在 `fb_triage.py` 里。

```python
# agent-zero-lab/part06/fb_triage.py
"""Day 373:每周分诊的前半:健康报表 + 给每条回复算可疑度 + 挑出候选。
用法: uv run python -m part06.fb_triage"""
from __future__ import annotations

import sqlite3
from typing import Any

from part06.fb_store import connect

REPORT_SQL = """
SELECT r.category,
       COUNT(DISTINCT r.trace_id)                                   AS n,
       AVG(CASE WHEN e.kind = 'edit_ratio' THEN e.value END)        AS avg_edit,
       AVG(CASE WHEN e.kind = 'edit_ratio' THEN e.value >= 0.5 END) AS heavy_edit,
       SUM(e.kind = 'thumb' AND e.value = -1)                       AS downs,
       SUM(e.kind IN ('escalated', 'reopened'))                     AS esc_reopen
FROM replies r JOIN events e ON e.trace_id = r.trace_id
GROUP BY r.category ORDER BY heavy_edit DESC
"""


def suspicion(sig: dict[str, float]) -> tuple[float, list[str]]:
    """每种信号算几分。分数只用来排序;权重按「可信度」给,不是按「严重程度」。"""
    score, why = 0.0, []
    if sig.get("thumb") == -1:
        score += 3
        why.append("客服点踩")
    if sig.get("escalated"):
        score += 3
        why.append("转人工")
    if sig.get("reopened"):
        score += 2
        why.append("客户追问")
    if sig.get("csat", 5) <= 2:
        score += 2
        why.append("满意度低")
    if sig.get("edit_ratio", 0) >= 0.5:
        score += 1 + sig["edit_ratio"]
        why.append("重度改写")
    return score, why


def signals_by_trace(conn: sqlite3.Connection) -> dict[str, dict[str, float]]:
    out: dict[str, dict[str, float]] = {}
    for e in conn.execute("SELECT trace_id, kind, value FROM events"):
        out.setdefault(e["trace_id"], {})[e["kind"]] = e["value"]
    return out


def candidates(conn: sqlite3.Connection, min_score: float = 1.5) -> list[dict[str, Any]]:
    """可疑度不低于 min_score 的回复。单独一个重度改写是 1.5 到 2 分,门槛放在 2 它就进不来。"""
    rows: list[dict[str, Any]] = []
    for tid, sig in signals_by_trace(conn).items():
        score, why = suspicion(sig)
        if score < min_score:
            continue
        r = conn.execute("SELECT * FROM replies WHERE trace_id = ?", (tid,)).fetchone()
        rows.append({"trace_id": tid, "category": r["category"], "ticket": r["ticket"], "draft": r["draft"],
                     "sent": r["sent"], "score": round(score, 1), "why": why})
    return rows


if __name__ == "__main__":
    conn = connect()
    print(f"{'类别':<9}{'条数':>4}{'平均改写':>8}{'重度改写':>8}{'点踩':>5}{'转人工+追问':>9}")
    for r in conn.execute(REPORT_SQL):
        print(f"{r['category']:<10}{r['n']:>5}{r['avg_edit']:>10.0%}{r['heavy_edit']:>10.0%}{r['downs']:>6}{r['esc_reopen']:>9}")
    heavy = conn.execute("SELECT COUNT(*) FROM events WHERE kind = 'edit_ratio' AND value >= 0.5").fetchone()[0]
    print(f"\n重度改写共 {heavy} 条")
    for min_score in (2, 1.5):
        cands = candidates(conn, min_score)
        in_heavy = sum(1 for c in cands if "重度改写" in c["why"])
        same_draft = {(c["category"], c["draft"]) for c in cands}
        same_ticket = {(c["category"], c["ticket"]) for c in cands}
        print(f"门槛 {min_score}:可疑回复 {len(cands)} 条,其中重度改写 {in_heavy} 条;"
              f"按草稿原文精确去重 {len(same_draft)} 组,按客户原话精确去重 {len(same_ticket)} 组")
```

<div class="line-notes">

- `from typing import Any` 候选是一组字段类型不一的字典(字符串、数字、列表),给它们标 `dict[str, Any]`,`Any` 相当于 TS 的 `any`。
- `COUNT(DISTINCT r.trace_id)                                   AS n,` 一条回复会 JOIN 出好几行事件,不加 `DISTINCT` 数的是事件行数,每条回复都有一行 `edit_ratio`,条数会虚高好几倍,这是最容易踩的坑。
- `AVG(CASE WHEN e.kind = 'edit_ratio' THEN e.value >= 0.5 END) AS heavy_edit,` SQLite 里比较表达式的值是 0 或 1,对它求平均就是比例。`CASE` 没命中时是 `NULL`,`AVG` 会跳过 `NULL`,所以分母只算 `edit_ratio` 那些行。
- `SUM(e.kind = 'thumb' AND e.value = -1)                       AS downs,` 同样利用比较结果是 0/1,`SUM` 就是计数。Postgres 里要写成 `COUNT(*) FILTER (WHERE ...)`。
- `def suspicion(sig: dict[str, float]) -> tuple[float, list[str]]:` 可疑度打分。`sig` 是一条回复的所有信号,形如 `{'thumb': -1.0, 'edit_ratio': 0.872}`。分数本身没有意义,只用来排序;权重按「可信度」给,不是按「严重程度」。
- `score += 3` 显式差评给 3 分。显式信号稀有但可信,所以分高。
- `if sig.get("csat", 5) <= 2:` 没有满意度数据时默认 5 分,不加分。
- `score += 1 + sig["edit_ratio"]` 重度改写给 1 到 2 分,改得越多分越高。实测一条改写 0.872 的回复得 1.9 分。
- `out.setdefault(e["trace_id"], {})[e["kind"]] = e["value"]` 把事件表压成「每条回复一个字典」。`setdefault` 的意思是键不存在就先放一个空字典,再往里写,相当于 JS 里 `(out[id] ??= {})[kind] = value`。
- `def candidates(conn: sqlite3.Connection, min_score: float = 1.5)` 可疑度不低于门槛的回复才进候选。门槛默认 1.5,为什么是 1.5 而不是 2,下面马上讲。
- `r = conn.execute("SELECT * FROM replies WHERE trace_id = ?", (tid,)).fetchone()` 拿回复原文。`(tid,)` 末尾的逗号不能省,否则那只是括号而不是单元素元组。
- `rows.append({"trace_id": tid, "category": r["category"], "ticket": r["ticket"], "draft": r["draft"],` 候选里带上工单、草稿、最终发出的版本,下一步聚类和人审都要用。
- `for min_score in (2, 1.5):` 同一份数据,门槛 2 和 1.5 各跑一遍,对比。
- `in_heavy = sum(1 for c in cands if "重度改写" in c["why"])` 候选里有多少条是因为重度改写进来的。
- `same_draft = {(c["category"], c["draft"]) for c in cands}` 集合推导式,把「类别 + 草稿原文」相同的算一组,数有几组。`same_ticket` 同理,按客户原话。

</div>

在仓库根目录运行 `uv run python -m part06.fb_triage`,实测输出:

```text
类别         条数    平均改写    重度改写   点踩   转人工+追问
refund       24       76%       92%     4        0
account      17       74%       82%     3        6
invoice      71        6%        4%     2        3
bug          46        3%        0%     1        0
billing      42        4%        0%     0        0

重度改写共 39 条
门槛 2:可疑回复 17 条,其中重度改写 15 条;按草稿原文精确去重 8 组,按客户原话精确去重 10 组
门槛 1.5:可疑回复 41 条,其中重度改写 39 条;按草稿原文精确去重 8 组,按客户原话精确去重 10 组
```

先看报表。refund 和 account 两类的重度改写率都在 80% 以上,是一眼就能看出来的警报。invoice 平均改写只有 6%,因为专票问题只占 invoice 工单的一小部分,被大量正常的发票抬头问题稀释了,不过「转人工+追问」那一列有 3 次,全是专票。这说明**光看平均数会漏掉小类别里的问题**,报表至少按类别切,最好再按更细的粒度看。

再看门槛。我最初把门槛放在 2 分,理由是「单独一个重度改写不够可疑,必须配合点踩或转人工才进队列」,想少一些误报。结果 39 条重度改写里只有 15 条进了候选,其余 24 条因为没人点踩、没有转人工,在队列外面静静待着。**门槛放太高,漏的恰恰是显式反馈覆盖不到的那一大块**,而这一块正是隐式信号存在的意义。放到 1.5 以后,39 条重度改写全部进来,候选共 41 条,多出来的 2 条是「客服点了踩但一个字没改」,也就是误点。误点是真实世界会有的噪声,交给人审去筛,比在这里漏掉要便宜。

最后一行的精确去重,先记住 8 组和 10 组这两个数,下一步要用。

## 第二步:为什么要聚类

41 条候选一条条看,工作量其实还行。但想想真实情况:一周几千条回复,候选几百条,你不可能逐条看。要看的是「几件事」,不是「几百条」。把同一件事的归成一组,每组只看一两条代表,再看这组有多少条、影响面多大。

最朴素的做法是精确去重:草稿原文一模一样的归一组。上面的输出里,按草稿原文是 8 组,按客户原话是 10 组。表面上还行,是因为我造的数据里每个场景只有两三种草稿措辞。真实的大模型每次生成的措辞都不一样,几乎找不到两条完全相同的草稿,精确去重会退化成「每条一组」。更要紧的是,同一个问题客户有几种问法(「错误码 E4031,登不上去」「一登录就报 E4031 是什么意思」),精确去重把它们当成不同的事。

要的是**语义上相近就归一组**,这正是 embedding 的用处([Day 217](/blog/agent-zero/day-217-embed-service/) 建的 `common/embed.py`:一段文字变成 1024 个数,意思相近的文字,向量夹角小,余弦相似度高)。把每条候选的「客户问法 + Agent 草稿」拼成一段文字,变成向量,相似度够高的归一组。

聚类的方法有很多,今天用最简单的贪心聚类,二十行:一条一条处理,拿它和已有各组的中心比相似度,最像的那组够相似就加进去,否则自己开一组。

```python
# agent-zero-lab/part06/fb_cluster.py
"""Day 373:把相似的可疑回复聚成组。每条回复变成一个向量(客户问法 + Agent 草稿),
相似度够高的归一组。用法: uv run python -m part06.fb_cluster"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from common.embed import embed, usage
from part06.fb_store import connect
from part06.fb_triage import candidates

Vecs = NDArray[np.float32]


def text_of(c: dict[str, Any]) -> str:
    return f"客户:{c['ticket']}\n回复:{c['draft']}"


def cluster(vecs: Vecs, threshold: float) -> list[int]:
    """贪心聚类:按顺序处理,和已有组的中心最像的那个够相似就加入,否则自己开一组。返回每条的组号。"""
    centers: list[Vecs] = []
    sizes: list[int] = []
    labels: list[int] = []
    for v in vecs:
        sims = [float(c @ v) for c in centers]
        best = int(np.argmax(sims)) if sims else -1
        if best >= 0 and sims[best] >= threshold:
            sizes[best] += 1
            centers[best] = (centers[best] * (sizes[best] - 1) + v) / sizes[best]
            centers[best] = centers[best] / np.linalg.norm(centers[best])
            labels.append(best)
        else:
            centers.append(v.copy())
            sizes.append(1)
            labels.append(len(centers) - 1)
    return labels


def purity(labels: list[int], truth: list[str]) -> float:
    """每组里占多数的真实场景有几条,加起来除以总数。1.0 = 每组都纯。"""
    by: dict[int, list[str]] = {}
    for lab, t in zip(labels, truth):
        by.setdefault(lab, []).append(t)
    return sum(Counter(ts).most_common(1)[0][1] for ts in by.values()) / len(labels)


if __name__ == "__main__":
    conn = connect()
    cands = candidates(conn)
    truth_map: dict[str, str] = json.loads(Path(__file__).with_name("fb_truth.json").read_text(encoding="utf-8"))
    truth = [truth_map[c["trace_id"]] for c in cands]
    vecs = embed([text_of(c) for c in cands])
    print(f"候选 {len(cands)} 条,向量 {vecs.shape},embedding 用了 {usage['tokens']} token")
    print(f"{'阈值':>5} {'组数':>4} {'只有1条的组':>9} {'纯度':>6}")
    for th in [0.5, 0.6, 0.7, 0.8, 0.9]:
        labels = cluster(vecs, th)
        sizes = Counter(labels)
        print(f"{th:>5} {len(sizes):>4} {sum(1 for n in sizes.values() if n == 1):>9} {purity(labels, truth):>6.2f}")

    labels = cluster(vecs, 0.7)
    print("\n阈值 0.7 的每一组:")
    for lab, n in sorted(Counter(labels).items(), key=lambda kv: -kv[1]):
        members = [i for i, x in enumerate(labels) if x == lab]
        real = dict(Counter(truth[i] for i in members))
        print(f"  组 {lab}:{n:>2} 条  真实场景 {real}  例:{cands[members[0]]['ticket']}")
```

<div class="line-notes">

- `from numpy.typing import NDArray` 给 numpy 数组标类型用的。`Vecs = NDArray[np.float32]` 起个别名,下面写起来短。读者用 Zed 会看到红线,标上类型就没有了。
- `from common.embed import embed, usage` Day 217 建的两样东西:`embed(texts)` 返回 `(N, 1024)` 的归一化数组,`usage` 是累计用了多少 token 的字典。
- `return f"客户:{c['ticket']}\n回复:{c['draft']}"` 要聚类的文本。同时放客户问法和草稿,这样「问法不同但草稿同样错」的能聚到一起;练习 1 会比较只用其中一个。
- `centers: list[Vecs] = []` 每一组的中心向量。`sizes` 是每组现在有几条。
- `sims = [float(c @ v) for c in centers]` `@` 是矩阵乘法运算符,两个归一化的向量做 `@` 就是余弦相似度(Day 214 起学的 numpy)。第一条处理时 `centers` 是空的,`sims` 就是空列表。
- `best = int(np.argmax(sims)) if sims else -1` 最像的是哪一组。`np.argmax` 返回最大值的下标。
- `if best >= 0 and sims[best] >= threshold:` 有组可比,而且够相似,就加入。否则走 `else` 开新组。
- `centers[best] = (centers[best] * (sizes[best] - 1) + v) / sizes[best]` 更新中心:旧中心乘以旧人数,加上新向量,除以新人数,就是「平均值」的在线更新。
- `centers[best] = centers[best] / np.linalg.norm(centers[best])` 平均以后向量长度不再是 1,除以自己的长度恢复成 1,下一次 `@` 才还是余弦。
- `centers.append(v.copy())` 开新组,中心就是这一条自己。`.copy()` 避免之后原地改中心时改到原数组。
- `def purity(labels: list[int], truth: list[str]) -> float:` 纯度:每一组里占多数的真实场景有几条,加起来除以总数。1.0 就是每组都只含一种真实场景。这个指标需要答案,线上没有,只在造数据时用。
- `Counter(ts).most_common(1)[0][1]` `Counter` 数每个场景出现几次,`most_common(1)` 取最多的那个,`[0][1]` 是它的次数。
- `truth_map: dict[str, str] = json.loads(` 读昨天 `fb_simulate` 存的答案。
- `for th in [0.5, 0.6, 0.7, 0.8, 0.9]:` 阈值从松到紧试五个。
- `labels = cluster(vecs, 0.7)` 选 0.7 以后,逐组打印:几条、真实场景构成、例子。`sorted(..., key=lambda kv: -kv[1])` 按组大小从大到小。

</div>

运行:

```bash
uv run python -m part06.fb_cluster
```

实测输出:

```text
候选 41 条,向量 (41, 1024),embedding 用了 1532 token
   阈值   组数    只有1条的组     纯度
  0.5    1         0   0.54
  0.6    3         0   0.95
  0.7    5         2   1.00
  0.8    5         2   1.00
  0.9    6         3   1.00

阈值 0.7 的每一组:
  组 1:22 条  真实场景 {'bad_annual_refund': 22}  例:专业版年付用了 4 个多月,剩下的能退吗?
  组 0:14 条  真实场景 {'bad_e4031': 14}  例:错误码 E4031,登不上去
  组 2: 3 条  真实场景 {'bad_vat_docs': 3}  例:我们要专票,需要准备哪些信息
  组 3: 1 条  真实场景 {'fine': 1}  例:发票抬头写错了,能重开吗?
  组 4: 1 条  真实场景 {'fine': 1}  例:点导出以后页面卡住,一直在加载
```

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="阈值从 0.5 到 0.9 时的组数:1、3、5、5、6;纯度 0.54、0.95、1.00、1.00、1.00">
<rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="24" fill="var(--ink)">阈值 → 组数(柱)和纯度(数字)</text>
<line x1="40" y1="170" x2="610" y2="170" stroke="var(--rule)"/>
<rect x="70" y="150" width="60" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="88" y="190" fill="var(--ink-soft)">0.5</text>
<text x="76" y="140" fill="var(--ink)">1 组 · 0.54</text>
<rect x="190" y="110" width="60" height="60" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="208" y="190" fill="var(--ink-soft)">0.6</text>
<text x="196" y="100" fill="var(--ink)">3 组 · 0.95</text>
<rect x="310" y="70" width="60" height="100" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="328" y="190" fill="var(--ink-soft)">0.7</text>
<text x="316" y="60" fill="var(--ink)">5 组 · 1.00</text>
<rect x="430" y="70" width="60" height="100" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="448" y="190" fill="var(--ink-soft)">0.8</text>
<text x="436" y="60" fill="var(--ink)">5 组 · 1.00</text>
<rect x="550" y="50" width="60" height="120" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="568" y="190" fill="var(--ink-soft)">0.9</text>
<text x="556" y="40" fill="var(--ink)">6 组 · 1.00</text>
</g>
</svg>
<figcaption>太松(0.5)所有东西并成一组,三个不同的问题混在一起;太紧(0.9)开始把同一个问题拆碎。0.7 到 0.8 之间都能用,我取 0.7。</figcaption>
</figure>

怎么读。阈值 0.5 太松,41 条全并成一组,纯度只有 0.54(最大的真实场景占一半多);0.6 已经分出 3 组,纯度 0.95,但是把 2 条误点并进了别的组;0.7 到 0.8 分出 5 组,每组都纯;到 0.9 开始拆碎,多出一个只有 1 条的组。**阈值选的是「刚好把不同的事分开、又还没把同一件事拆碎」的那一段**,这一段在这份数据里很宽(0.7 到 0.8),是因为三个问题的措辞差别大。真实数据里这个区间会窄得多。

0.7 的结果:三个真问题,22 条年付退款、14 条 E4031、3 条专票资料,每一组都是同一种真实场景;还有两个单条组,是误点。41 条候选变成了 3 组需要认真处理的事和 2 个可以快速跳过的噪声。比精确去重的 8 到 10 组干净,而且不依赖措辞一不一样。

**纯度这个指标是造数据才有的奢侈,线上没有答案。** 真实系统里怎么选阈值?从 0.7 起步,每个阈值多抽几组打开看:同一组里的几条是不是真的同一件事,有没有明显两件事被并在了一起(阈值偏松),有没有明显同一件事被拆成了两组(阈值偏紧)。看十几组就能定下来。

还有一点要补充。贪心聚类的结果和处理顺序有关,换个顺序可能得到略有不同的分组。对分诊来说够用,因为后面还有人审;如果你需要稳定的聚类,可以换成层次聚类或 HDBSCAN,这些在 scikit-learn 里都有现成的,今天不展开。

## 第三步:排队,让模型猜每组错在哪

分好组以后,按组内总分从高到低排队,每组调一次模型,猜一个失败类别。类别用 [Day 347](/blog/agent-zero/day-347-error-analysis-3/) 归纳出来的那一套。

```python
# agent-zero-lab/part06/fb_queue.py
"""Day 373:聚类 → 按总分排队 → 让模型猜每组错在哪 → 写成交给人审的队列。
用法: uv run python -m part06.fb_queue"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from common.embed import embed
from common.llm import LLMClient
from part06.fb_cluster import cluster, text_of
from part06.fb_store import connect
from part06.fb_triage import candidates

OUT = Path(__file__).with_name("triage_queue.jsonl")
THRESHOLD = 0.7

TAXONOMY = ["政策理解错", "知识缺失或检索没找到", "事实或数字错误", "该调工具没调", "语气或格式", "其他"]
LABEL_PROMPT = """下面是客服 Agent 的几条草稿,和客服最终发出的版本。判断草稿错在哪,只从这些类别里选一个:{taxonomy}
只输出 JSON:{{"label": "...", "note": "一句话说明"}}

{samples}"""


def build_queue() -> list[dict[str, Any]]:
    cands = candidates(connect())
    labels = cluster(embed([text_of(c) for c in cands]), THRESHOLD)
    groups: dict[int, list[dict[str, Any]]] = {}
    for lab, c in zip(labels, cands):
        groups.setdefault(lab, []).append(c)
    queue = []
    for members in groups.values():
        why = sorted({w for m in members for w in m["why"]})
        queue.append({
            "category": members[0]["category"],
            "count": len(members),
            "score": round(sum(m["score"] for m in members), 1),
            "why": why,
            "traces": [m["trace_id"] for m in members],
            "ticket": members[0]["ticket"],
            "draft": members[0]["draft"],
            "sent": members[0]["sent"],
            "suspect": None, "accept": None, "expect": {},          # 后三个留给人审填
        })
    return sorted(queue, key=lambda g: -g["score"])


def samples_of(item: dict[str, Any], conn_rows: dict[str, dict[str, Any]]) -> str:
    lines = []
    for tid in item["traces"][:3]:
        r = conn_rows[tid]
        lines.append(f"工单:{r['ticket']}\n草稿:{r['draft']}\n最终发出:{r['sent']}")
    return "\n---\n".join(lines)


if __name__ == "__main__":
    queue = build_queue()
    conn = connect()
    rows = {r["trace_id"]: dict(r) for r in conn.execute("SELECT * FROM replies")}
    client = LLMClient()
    with OUT.open("w", encoding="utf-8") as f:
        for item in queue:
            out = client.chat([{"role": "user", "content": LABEL_PROMPT.format(
                taxonomy="、".join(TAXONOMY), samples=samples_of(item, rows))}],
                temperature=0, response_format={"type": "json_object"})
            item["suspect"] = json.loads(out.content)
            f.write(json.dumps(item, ensure_ascii=False) + "\n")
            print(f"[{item['count']:>2} 条 · {item['score']:>5}] {item['category']:<8}"
                  f"{item['suspect']['label']:<12}{item['ticket']}")
    print(client.ledger)
```

<div class="line-notes">

- `OUT = Path(__file__).with_name("triage_queue.jsonl")` 队列文件,JSONL,一组一行。
- `THRESHOLD = 0.7` 上一步选的阈值。写成模块常量,改起来只有一处。
- `TAXONOMY = ["政策理解错", "知识缺失或检索没找到", "事实或数字错误", "该调工具没调", "语气或格式", "其他"]` 失败类别。用你自己 Day 347 的那份替换这里。
- `LABEL_PROMPT = """下面是客服 Agent 的几条草稿,和客服最终发出的版本。` 一次给模型看同一组的几条样本,比只看一条判断得准。
- `labels = cluster(embed([text_of(c) for c in cands]), THRESHOLD)` 候选文本变向量,再聚类,得到每条候选的组号。
- `groups.setdefault(lab, []).append(c)` 按组号把候选分堆。
- `why = sorted({w for m in members for w in m["why"]})` 一组里出现过的所有可疑原因,去重排序。嵌套的集合推导式:外层遍历成员,内层遍历每个成员的原因。
- `"score": round(sum(m["score"] for m in members), 1),` 组内可疑度求和。总分等于「条数 × 单条可疑度」,影响面大、信号强的组排在前面。
- `"ticket": members[0]["ticket"],` 用第一条当这一组的代表。
- `"suspect": None, "accept": None, "expect": {},          # 后三个留给人审填` `suspect` 是模型的猜测,先留空;`accept` 和 `expect` 只能由人来写。
- `return sorted(queue, key=lambda g: -g["score"])` 总分高的排前面。
- `for tid in item["traces"][:3]:` 每组最多拿 3 条样本给模型,够判断了,也省 token。
- `rows = {r["trace_id"]: dict(r) for r in conn.execute("SELECT * FROM replies")}` 把整张回复表读成字典,按 `trace_id` 取。200 条没问题;几百万条的表别这么读。
- `item["suspect"] = json.loads(out.content)` 模型的猜测存进去,形如 `{"label": "...", "note": "..."}`。

</div>

`uv run python -m part06.fb_queue`,实测输出:

```text
[14 条 ·  55.6] account 知识缺失或检索没找到  错误码 E4031,登不上去
[22 条 ·  52.7] refund  政策理解错       专业版年付用了 4 个多月,剩下的能退吗?
[ 3 条 ·  15.7] invoice 知识缺失或检索没找到  我们要专票,需要准备哪些信息
[ 1 条 ·   3.0] invoice 其他          发票抬头写错了,能重开吗?
[ 1 条 ·   3.0] billing 其他          点导出以后页面卡住,一直在加载
5 次调用 | 输入 1247 / 输出 164 tokens | 约 ¥0.0038
```

注意排序:E4031 这组 14 条排第一,年付退款 22 条反而排第二。因为 E4031 同时有转人工、满意度低这些强信号,总分更高(55.6 比 52.7);退款那组主要靠重度改写。排哪个先不重要,两组都要处理。花费 0.0038 元:1247 × 2 / 100 万 + 164 × 8 / 100 万 ≈ 0.0025 + 0.0013。

三个猜测里,E4031 和专票是「知识缺失」,年付退款是「政策理解错」,和我造数据时埋的毛病一致。两个单条组是误点,模型说「其他」。**模型猜得对,不等于可以不看**:它只是给你一个先看哪里的方向。

## 第四步:人审

队列是 JSONL,一组一行。审的人(你加一位资深客服)逐行看,决定三件事:这真的是 Agent 的错吗?错在哪?正确的处理应该满足什么?审完把 `accept` 改成 `true` 或 `false`,在 `expect` 里写期望,另存成 `reviewed.jsonl`。第一组(为了好读我换了行,并去掉了 `traces` 的完整列表)审完是这样:

```json
{"category": "account", "count": 14, "score": 55.6,
 "why": ["客服点踩", "满意度低", "转人工", "重度改写"],
 "traces": ["tr-0002", "tr-0025", "tr-0041", "..."],
 "ticket": "错误码 E4031,登不上去",
 "draft": "请清除浏览器缓存后重试。",
 "sent": "E4031 表示验证码已过期,请点「重新发送」,并在 5 分钟内输入。",
 "suspect": {"label": "知识缺失或检索没找到", "note": "草稿不知道 E4031 是验证码过期,给出了无关的缓存/浏览器建议,属于知识缺失。"},
 "accept": true,
 "expect": {"category": "account",
            "reply_must_include": ["重新发送"],
            "reply_must_not_include": ["清除浏览器缓存", "更换浏览器"],
            "facts": ["E4031 表示验证码已过期", "重新发送验证码并在 5 分钟内输入"]},
 "review_note": "帮助中心里没有 E4031,已向产品确认含义"}
```

有几个判断只有人能做。E4031 到底是什么意思,要去问产品或研发,**不能信客服的一次改写,更不能信模型的猜测**(这里是虚构的 E4031 含义,真实世界里客服也会写错)。退款那一组,期望里要写清应不应该发起退款、退多少钱,这依赖测试库里具体客户的数据。最后两组误点,`accept` 填 `false`,备注写原因,下周同样的情况就能更快跳过。

审的节奏建议每周固定一次,半小时到一小时,队列太长就只审前 20 组。固定节奏比一次审完更要紧:飞轮的价值在每周都转一圈,不在某次转得特别彻底。

文章里没法真的让你手动审,所以我写了一个脚本代替「人」,把上面五组的判断写死,生成 `reviewed.jsonl`。**这个脚本不是自动审核,判断是我替你下的。**

```python
# agent-zero-lab/part06/fb_review_demo.py
"""Day 373:人审那一步在真实世界里是你打开 triage_queue.jsonl 逐行改。为了让后面的脚本能跑通,
这里用代码把「人」的判断写死,生成 reviewed.jsonl。别把它当成自动审核,判断是我替你下的。"""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).parent

REVIEW = {
    "错误码 E4031,登不上去": {
        "accept": True,
        "expect": {"category": "account",
                   "reply_must_include": ["重新发送"],
                   "reply_must_not_include": ["清除浏览器缓存", "更换浏览器"],
                   "facts": ["E4031 表示验证码已过期", "重新发送验证码并在 5 分钟内输入"]},
        "review_note": "帮助中心里没有 E4031,已向产品确认含义",
    },
    "专业版年付用了 4 个多月,剩下的能退吗?": {
        "accept": True,
        "expect": {"category": "refund"},          # 故意没写 refund_yuan,看下一步的护栏
        "review_note": "kb-002 写得很清楚,是 Agent 没按规则答",
    },
    "我们要专票,需要准备哪些信息": {
        "accept": True,
        "expect": {"category": "invoice",
                   "facts": ["专票需要公司名称、税号、注册地址和电话、开户行及账号四项"]},
        "review_note": "帮助中心 kb-006 只写了抬头和税号",
    },
    "发票抬头写错了,能重开吗?": {"accept": False, "expect": {}, "review_note": "草稿和发出版本一模一样,误点"},
    "点导出以后页面卡住,一直在加载": {"accept": False, "expect": {}, "review_note": "草稿和发出版本一模一样,误点"},
}

if __name__ == "__main__":
    items = [json.loads(line) for line in (HERE / "triage_queue.jsonl").read_text(encoding="utf-8").splitlines()]
    with (HERE / "reviewed.jsonl").open("w", encoding="utf-8") as f:
        for it in items:
            it.update(REVIEW[it["ticket"]])
            f.write(json.dumps(it, ensure_ascii=False) + "\n")
    print(f"写出 {len(items)} 行 reviewed.jsonl,通过 {sum(1 for i in items if i['accept'])} 组")
```

<div class="line-notes">

- `REVIEW = {` 键是每一组代表工单的原文,值是人的判断。真实流程里这是你打开 `triage_queue.jsonl` 逐行手改的内容。
- `"expect": {"category": "refund"},          # 故意没写 refund_yuan,看下一步的护栏` 年付退款这一组,我故意没填应退金额。
- `"review_note": "kb-002 写得很清楚,是 Agent 没按规则答",` 备注写人审的结论,日后查为什么收这条用例,靠它。
- `{"accept": False, "expect": {}, "review_note": "草稿和发出版本一模一样,误点"},` 误点那两组,不通过,写明原因。
- `it.update(REVIEW[it["ticket"]])` 把人的判断合并进队列里的那一行。`update` 相当于 JS 的 `Object.assign`。

</div>

`uv run python -m part06.fb_review_demo`,输出 `写出 5 行 reviewed.jsonl,通过 3 组`。

## 第五步:变成测试用例

审过的东西变成测试用例,进 `part06/cases/from_feedback.jsonl`。这一步有四道关:脱敏、护栏、查重、分 dev/test。

```python
# agent-zero-lab/part06/fb_promote.py
"""Day 373:把人审通过的组变成测试用例。脱敏、护栏、查重、分 dev/test 都在这里。
用法: uv run python -m part06.fb_promote part06/reviewed.jsonl"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import date
from pathlib import Path
from typing import Any

HERE = Path(__file__).parent
OUT = HERE / "cases" / "from_feedback.jsonl"
GOLDEN = HERE / "cases" / "golden.jsonl"           # Day 348 起攒下的测试集,没有就只和自己查重

PII = [
    (re.compile(r"1[3-9]\d{9}"), "<手机号>"),
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+"), "<邮箱>"),
    (re.compile(r"\d{17}[\dXx]"), "<身份证号>"),
]


def mask_pii(text: str) -> str:
    for pattern, repl in PII:
        text = pattern.sub(repl, text)
    return text


def grams(s: str, n: int = 3) -> set[str]:
    s = "".join(s.split())
    return {s[i:i + n] for i in range(max(len(s) - n + 1, 1))}


def jaccard(a: set[str], b: set[str]) -> float:
    return len(a & b) / len(a | b) if a | b else 0.0


def split_of(case_id: str) -> str:
    h = int(hashlib.md5(case_id.encode()).hexdigest(), 16) % 100
    return "test" if h < 30 else "dev"


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def promote(reviewed: list[dict[str, Any]], existing: list[str]) -> tuple[list[dict[str, Any]], list[tuple[str, str]]]:
    seen = [grams(t) for t in existing]
    cases: list[dict[str, Any]] = []
    skipped: list[tuple[str, str]] = []
    for item in reviewed:
        first = item["traces"][0]
        if item.get("accept") is not True:
            skipped.append((first, "未通过人审"))
            continue
        if item["category"] == "refund" and "refund_yuan" not in item["expect"]:
            skipped.append((first, "退款类要先在测试库里挑一个同样情况的客户,填 customer_id 和 refund_yuan"))
            continue
        ticket = mask_pii(item["ticket"])
        g = grams(ticket)
        if any(jaccard(g, s) > 0.8 for s in seen):
            skipped.append((first, "测试集里已有几乎一样的工单"))
            continue
        cid = f"prod-{first}"
        cases.append({
            "id": cid,
            "ticket": ticket,
            "customer_id": item["expect"].pop("customer_id", None),
            "expect": item["expect"],
            "tags": [item["category"], "from-feedback", item["suspect"]["label"]],
            "source": "production",
            "split": split_of(cid),
            "added": date.today().isoformat(),
            "note": f"{item['count']} 条线上回复同样出错:{'、'.join(item['why'])};"
                    f"{mask_pii(item.get('review_note', ''))};trace {', '.join(item['traces'][:3])}",
        })
        seen.append(g)
    return cases, skipped


if __name__ == "__main__":
    reviewed = read_jsonl(Path(sys.argv[1]))
    existing = [str(c["ticket"]) for c in read_jsonl(GOLDEN) + read_jsonl(OUT)]
    cases, skipped = promote(reviewed, existing)
    OUT.parent.mkdir(exist_ok=True)
    with OUT.open("a", encoding="utf-8") as f:
        for c in cases:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    print(f"新增 {len(cases)} 条用例 → {OUT.name}")
    for c in cases:
        print(f"  {c['id']:<14}{c['split']:<5}{c['expect']}")
    for tid, reason in skipped:
        print(f"  跳过 {tid}:{reason}")
```

<div class="line-notes">

- `OUT = HERE / "cases" / "from_feedback.jsonl"` 先写到单独的文件,不直接改主测试集。`Path` 对象用 `/` 拼路径,相当于 Node 的 `path.join`。
- `GOLDEN = HERE / "cases" / "golden.jsonl"           # Day 348 起攒下的测试集,没有就只和自己查重` 你在这一部分攒的测试集。文件不存在时 `read_jsonl` 返回空列表,这一步照常运行。
- `(re.compile(r"1[3-9]\d{9}"), "<手机号>"),` 中国大陆手机号:1 开头,第二位 3 到 9,后面 9 位数字。线上工单原文里一定会有客户的手机号、邮箱、证件号,测试集会进 git、被 CI 打印、被很多人看到,入库前必须换掉。
- `(re.compile(r"\d{17}[\dXx]"), "<身份证号>"),` 18 位身份证。这三个正则只是起点,真实系统里还有姓名、公司名、订单号,要用更完整的办法,Day 367 讲脱敏时说过。
- `text = pattern.sub(repl, text)` 把匹配到的部分替换掉,返回新字符串。逐个模式过一遍。
- `s = "".join(s.split())` 先把所有空白去掉,再切三字组。`s.split()` 不带参数就是按任意空白切,`"".join` 再拼起来。
- `return len(a & b) / len(a | b) if a | b else 0.0` 杰卡德相似度:交集大小除以并集大小。`&` 和 `|` 是集合的交与并。两个集合都为空时避免除以零。
- `h = int(hashlib.md5(case_id.encode()).hexdigest(), 16) % 100` 按用例 id 的 md5 分 dev 和 test,三成进 test。规则必须和 Day 354 的 `split_of` 一致(我这里按「小于 30 进 test」写,以你自己的为准),否则同一条用例换个脚本分到的份就不一样。
- `if item.get("accept") is not True:` 只认明确写了 `true` 的。`None`(还没审)和 `false`(审了不要)都跳过。
- `if item["category"] == "refund" and "refund_yuan" not in item["expect"]:` 一道护栏。测试集里退款类用例必须写明应退金额(不该退写 `null`),审的人忘了填,这条用例就会拿「没写」当「不该退」,反过来惩罚正确的退款行为。宁可跳过让人补。
- `ticket = mask_pii(item["ticket"])` 先脱敏,再查重。
- `if any(jaccard(g, s) > 0.8 for s in seen):` 和已有用例以及这一批里前面刚加的比较,太像就不加。同一个问题在测试集里出现十次,只会让分数对它过度敏感。
- `cid = f"prod-{first}"` id 带上 `prod-` 前缀和第一个 `trace_id`,之后在报告里看到这条用例挂了,能直接回到那次回复。
- `"customer_id": item["expect"].pop("customer_id", None),` 线上的客户在测试库里不存在,需要客户数据的用例,由审的人在 `expect` 里指定一个测试库里的客户。`pop` 把它从 `expect` 里取出来放到用例顶层。
- `"source": "production",` 标明这条用例来自线上,之后可以单独看「来自线上的用例现在过了几条」。
- `"note": f"{item['count']} 条线上回复同样出错:` 备注写明影响面和证据。
- `existing = [str(c["ticket"]) for c in read_jsonl(GOLDEN) + read_jsonl(OUT)]` 查重对象包括主测试集和已经导出的线上用例,所以重复运行不会重复添加。
- `with OUT.open("a", encoding="utf-8") as f:` 追加模式。每周跑一次,文件越来越长,这就是飞轮转的痕迹。

</div>

`uv run python -m part06.fb_promote part06/reviewed.jsonl`,实测输出:

```text
新增 2 条用例 → from_feedback.jsonl
  prod-tr-0002  dev  {'category': 'account', 'reply_must_include': ['重新发送'], 'reply_must_not_include': ['清除浏览器缓存', '更换浏览器'], 'facts': ['E4031 表示验证码已过期', '重新发送验证码并在 5 分钟内输入']}
  prod-tr-0079  dev  {'category': 'invoice', 'facts': ['专票需要公司名称、税号、注册地址和电话、开户行及账号四项']}
  跳过 tr-0062:退款类要先在测试库里挑一个同样情况的客户,填 customer_id 和 refund_yuan
  跳过 tr-0105:未通过人审
  跳过 tr-0123:未通过人审
```

再跑一次同样的命令:

```text
新增 0 条用例 → from_feedback.jsonl
  跳过 tr-0002:测试集里已有几乎一样的工单
  跳过 tr-0062:退款类要先在测试库里挑一个同样情况的客户,填 customer_id 和 refund_yuan
  跳过 tr-0079:测试集里已有几乎一样的工单
  跳过 tr-0105:未通过人审
  跳过 tr-0123:未通过人审
```

两条用例落在 dev,退款那组被护栏拦下来了,误点两组未通过。第二次运行一条没加:重复运行不会重复添加,每周的脚本可以放心反复跑。退款那一组怎么补,是练习 2。

为这些逻辑写几个不调模型的测试:

```python
# agent-zero-lab/part06/test_fb_promote.py
from typing import Any

from part06.fb_promote import mask_pii, promote


def item(ticket: str, category: str = "account", accept: bool | None = True, **expect: Any) -> dict[str, Any]:
    return {"traces": ["tr-1"], "ticket": ticket, "category": category, "accept": accept, "count": 3,
            "why": ["重度改写"], "suspect": {"label": "知识缺失或检索没找到"}, "expect": expect}


def test_mask_pii():
    assert mask_pii("我的手机 13812345678,邮箱 a.b@x.com") == "我的手机 <手机号>,邮箱 <邮箱>"
    assert mask_pii("发票号 20261012") == "发票号 20261012"        # 8 位数字不是手机号,不能误伤


def test_not_accepted_and_refund_guard():
    cases, skipped = promote([item("登录报 E4031", accept=None), item("年付能退吗", category="refund", facts=["按剩余整月退"])], [])
    assert cases == []
    assert [reason for _, reason in skipped] == ["未通过人审", "退款类要先在测试库里挑一个同样情况的客户,填 customer_id 和 refund_yuan"]


def test_dedupe_against_existing_and_within_batch():
    cases, skipped = promote([item("登录提示 E4031,怎么办?"), item("登录提示 E4031,怎么办?")], ["登录提示 E4031,怎么办?"])
    assert cases == []
    assert len(skipped) == 2


def test_pii_is_masked_in_case():
    cases, _ = promote([item("手机 13812345678 收不到验证码")], [])
    assert cases[0]["ticket"] == "手机 <手机号> 收不到验证码"
```

<div class="line-notes">

- `def item(ticket: str, category: str = "account", accept: bool | None = True, **expect: Any)` 造一个最小的「审过的组」。`**expect` 把多余的关键字参数收成一个字典,放进 `expect` 字段。
- `assert mask_pii("发票号 20261012") == "发票号 20261012"        # 8 位数字不是手机号,不能误伤` 脱敏函数不能把不该动的也换了。这类「不该误伤」的测试和「该换掉」的一样重要。
- `item("年付能退吗", category="refund", facts=["按剩余整月退"])` 退款类、`expect` 里有 `facts` 但没有 `refund_yuan`,应该被护栏拦下。
- `[reason for _, reason in skipped]` 只取原因,`_` 是「这个值我不用」的惯用名。
- `promote([item("登录提示 E4031,怎么办?"), item("登录提示 E4031,怎么办?")]` 同一批里两条一模一样的,一条已经在测试集里,一条是这批里重复的,都要被拦。

</div>

`uv run python -m pytest -q part06/test_fb_promote.py`,实测 `4 passed in 0.02s`。

## 第六步:飞轮的另一半,补知识库

测试集只是让同样的错误下次被门禁拦住,错误本身还得修。三组 badcase 对应不同的修法。**E4031 和专票资料是知识缺失,修法是补帮助中心文章。** 人审已经确认了正确答案(就是客服改好的那个版本),让模型照着它起草一篇,再由人批准入库,比从头写快。

```python
# agent-zero-lab/part06/fb_kb_draft.py
"""Day 373:飞轮的另一半。知识缺失类的组,用客服改好的回复起草一篇帮助中心文章,等人批准后再入库。
用法: uv run python -m part06.fb_kb_draft part06/reviewed.jsonl"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from common.llm import LLMClient

DRAFTS = Path(__file__).with_name("kb_drafts")
PROMPT = """你是 CloudLedger 帮助中心的编辑。客服在下面这个问题上反复手工改写了 Agent 的回复,说明知识库缺一篇文章。
根据客服最终发出的版本写一篇帮助中心短文:标题一行,正文 3–6 句,只写客服版本里有的事实,不要补充你不确定的内容。
输出 JSON:{{"title": "...", "body": "...", "keywords": ["..."]}}

客户问题:{ticket}
客服最终发出的回复:{sent}"""

if __name__ == "__main__":
    client = LLMClient()
    DRAFTS.mkdir(exist_ok=True)
    for line in Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
        item = json.loads(line)
        if item.get("accept") is not True or item["suspect"]["label"] != "知识缺失或检索没找到":
            continue
        r = client.chat([{"role": "user", "content": PROMPT.format(**item)}], temperature=0,
                        response_format={"type": "json_object"})
        art = json.loads(r.content)
        path = DRAFTS / f"draft-{item['traces'][0]}.md"
        path.write_text(f"---\nstatus: draft\nsource_traces: {item['traces'][:5]}\nkeywords: {art['keywords']}\n---\n\n"
                        f"# {art['title']}\n\n{art['body']}\n", encoding="utf-8")
        print(f"{path.name}:{art['title']}")
    print(client.ledger)
```

<div class="line-notes">

- `只写客服版本里有的事实,不要补充你不确定的内容。` 防止模型「顺便」补充它自己知道的内容。帮助中心是检索的数据源,一旦写进错误信息,错误会被 Agent 引用无数次。
- `if item.get("accept") is not True or item["suspect"]["label"] != "知识缺失或检索没找到":` 只处理人审通过、疑似原因是知识缺失的组。政策理解错的那组帮助中心里本来就有规则,不该补文章。
- `r = client.chat([{"role": "user", "content": PROMPT.format(**item)}], temperature=0,` `**item` 把整组的所有字段当关键字参数传给 `format`,模板里只用到 `ticket` 和 `sent`,多的忽略。
- `path = DRAFTS / f"draft-{item['traces'][0]}.md"` 文件名带上第一个 trace id,批准入库时能找回来源。
- `path.write_text(f"---\nstatus: draft` 文件头标 `status: draft` 和来源,批准入库时改成正式的 id 和分类,再重建索引([Day 225](/blog/agent-zero/day-225-numpy-index/) 讲过向量索引怎么建)。

</div>

`uv run python -m part06.fb_kb_draft part06/reviewed.jsonl`,实测输出和生成的文件:

```text
draft-tr-0002.md:错误码 E4031：验证码已过期
draft-tr-0079.md:申请增值税专用发票需要提供哪些信息
2 次调用 | 输入 307 / 输出 159 tokens | 约 ¥0.0019
```

两篇起草出来的正文:

```text
# 错误码 E4031：验证码已过期
E4031 表示验证码已过期。请点「重新发送」获取新的验证码。请在 5 分钟内输入验证码。

# 申请增值税专用发票需要提供哪些信息
申请开具增值税专用发票时，请提供公司名称、税号、注册地址和电话、开户行及账号。以上四项信息缺一不可。请确保所提供的信息完整、准确。
```

第二篇结尾多了一句「请确保所提供的信息完整、准确」,客服的版本里没有这句话。它无害,但正是「不要补充」那条要求被轻微越过的例子。**所以起草出来的文章必须人看过再入库。** 今天是两句话的小文章,真实的帮助中心文章会长得多,多出来的句子也更容易包含错误。

政策理解错的那一组(年付退款)不该补文章,帮助中心里本来就有规则。要回去查这几条回复检索到了什么:检索没把规则排到前面,是检索的问题;检索对了而 Agent 还是答反了,是提示词或模型的问题,可以手改,也可以用 [Day 371](/blog/agent-zero/day-371-prompt-opt-3/) 的办法让反思者在手册里加一条。不管怎么修,修完都要过门禁。

## 第七步:接回 Day 371 的门禁

Day 371 的手册门禁里,「关键用例」是我凭记忆挑的 10 个编号。现在有了来自线上的用例,它们可以直接当关键用例。写一个小脚本,让当前手册(BARE 加 `playbook_bare.json`)给 `from_feedback.jsonl` 里每条工单分一次类,和用例里期望的类别比:

```python
# agent-zero-lab/part06/fb_gate_cases.py
"""Day 373:把线上出过的事故用例接回 Day 371 的手册。让现在的手册(BARE + playbook_bare.json)
给 from_feedback.jsonl 里每条工单分一次类,和用例里期望的类别比。
用法: uv run python -m part06.fb_gate_cases"""
from __future__ import annotations

import json
from pathlib import Path

from common.llm import LLMClient
from part06.ace_lite import load_book, render
from part06.opt_task import BARE_PROMPT, classify

HERE = Path(__file__).parent

if __name__ == "__main__":
    cases = [json.loads(line) for line in (HERE / "cases" / "from_feedback.jsonl").read_text(encoding="utf-8").splitlines()]
    prompt = render(BARE_PROMPT, load_book(HERE / "playbook_bare.json"))
    client = LLMClient()
    for c in cases:
        got = classify(client, prompt, c["ticket"])
        want = c["expect"]["category"]
        print(f"{c['id']:<14}期望 {want:<8}实际 {got:<8}{'通过' if got == want else '不通过'}  {c['ticket']}")
    print(client.ledger)
```

<div class="line-notes">

- `cases = [json.loads(line) for line in (HERE / "cases" / "from_feedback.jsonl").read_text(encoding="utf-8").splitlines()]` 读昨天今天导出的用例。
- `prompt = render(BARE_PROMPT, load_book(HERE / "playbook_bare.json"))` 用 Day 371 存下来的手册拼出 prompt。`load_book` 和 `render` 都是 `ace_lite.py` 里的。
- `got = classify(client, prompt, c["ticket"])` Day 368 的 `classify`,返回类别。
- `want = c["expect"]["category"]` 人审时写下的期望类别。

</div>

`uv run python -m part06.fb_gate_cases`,实测输出:

```text
prod-tr-0002  期望 account 实际 account 通过  错误码 E4031,登不上去
prod-tr-0079  期望 invoice 实际 invoice 通过  我们要专票,需要准备哪些信息
2 次调用 | 输入 433 / 输出 12 tokens | 约 ¥0.0010
```

两条都通过了。别误会,这不是在说「门禁没用」。这两条线上事故里出错的是**回复的内容**(没说验证码过期、漏了四项资料),不是工单被分错了类。分类这一关它们本来就能过。用例里真正管事的是 `reply_must_include`、`reply_must_not_include` 和 `facts`,这几项要拿真的 Agent 生成回复再检查,[Day 374](/blog/agent-zero/day-374-eval-project-1/) 搭完整评测系统时会用上。今天能验证的只有 `category` 这一项。

不过这一步展示了接法:线上用例导出成 JSONL,标上 `from-feedback`,门禁脚本把它们读进来。每出一次事故,门禁就多一道防线。

## 节奏和几个提防

飞轮能不能一直转,靠固定节奏和几个一直盯着的数。每天自动跑报表,只看两个数有没有突变:各类别的重度改写率和点踩率,某个类别一天之内翻倍,通常是上了新版本、改了政策或出了新功能,值得当天看一眼。每周一次分诊和人审,产出是新增用例数、补的文章数、修的问题数,记在简单的周报里。每个提示词或手册版本上线一周后,按昨天表里的 `prompt_version` 对比上一个版本的指标,这是判断优化有没有用的唯一证据。

除了按信号挑,每周再**随机抽 20 条没有任何负面信号的回复**人工看一遍,这是练习 3。客服忙的时候不改不点,所有信号都是沉默的,而沉默的错误最危险。

最后提防一件事:指标一旦被拿来考核,行为就会变形。如果你跟客服组说「要把改写率降下来」,客服最省事的做法是少改,改写率降了,回复质量没变,甚至更差。**这些指标只用来找问题,不用来考核人,也不直接当 Agent 的优化目标。** 这条有个名字,叫古德哈特定律。

## 动手练习

1. **聚类时用什么文本?** 只用客户问法、只用 Agent 草稿、两个一起,在阈值 0.6、0.7、0.8 下比组数和纯度。
2. **补上退款那一组。** 在测试库里(这里虚构一个客户 C007)找一个同样情况的客户,按帮助中心规则算出应退金额 273 元,写进 `expect`,存成 `reviewed_fixed.jsonl`,让 `fb_promote` 把它放进测试集。
3. **随机抽查沉默的回复。** 写一个脚本,找出所有没有任何负面信号的回复,随机抽 20 条给人工看。
4. **设计一个每周的节奏。** 开放题:给你自己的团队写一份每周飞轮的时间表,说明每一步谁做、花多久、产出什么。

### 参考答案

**练习 1**

```python
# agent-zero-lab/part06/ex373_text.py
"""Day 373 练习 1:聚类时拿什么文本去做 embedding?只用客户问法、只用 Agent 草稿、两个一起,比一比。"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

from common.embed import embed
from part06.fb_cluster import cluster, purity, text_of
from part06.fb_store import connect
from part06.fb_triage import candidates

cands = candidates(connect())
truth_map: dict[str, str] = json.loads(Path(__file__).with_name("fb_truth.json").read_text(encoding="utf-8"))
truth = [truth_map[c["trace_id"]] for c in cands]
variants: dict[str, Any] = {
    "只用客户问法": lambda c: c["ticket"],
    "只用 Agent 草稿": lambda c: c["draft"],
    "两个一起": text_of,
}
print(f"{'文本':<12}{'阈值':>5}{'组数':>5}{'纯度':>6}")
for name, fn in variants.items():
    vecs = embed([fn(c) for c in cands])
    for th in (0.6, 0.7, 0.8):
        labels = cluster(vecs, th)
        print(f"{name:<12}{th:>5}{len(Counter(labels)):>5}{purity(labels, truth):>6.2f}")
```

<div class="line-notes">

- `variants: dict[str, Any] = {` 三种取文本的办法,值是函数。Python 里函数和别的值一样可以放进字典,相当于 JS 里 `{名字: c => ...}`。
- `"只用客户问法": lambda c: c["ticket"],` `lambda` 是匿名函数,`lambda c: c["ticket"]` 就是 `c => c.ticket`。
- `"两个一起": text_of,` 直接用 `fb_cluster` 里的函数。
- `vecs = embed([fn(c) for c in cands])` 对每种文本各做一次 embedding,41 条乘 3 种,共 123 条,免费。

</div>

实测输出:

```text
文本             阈值   组数    纯度
只用客户问法        0.6    4  0.98
只用客户问法        0.7    5  1.00
只用客户问法        0.8    5  1.00
只用 Agent 草稿   0.6    3  0.95
只用 Agent 草稿   0.7    5  1.00
只用 Agent 草稿   0.8    5  1.00
两个一起          0.6    3  0.95
两个一起          0.7    5  1.00
两个一起          0.8    5  1.00
```

结论是:在这份数据上三种取法没有区别,阈值 0.7 和 0.8 下都分得干净。这不能说明「用什么文本无所谓」,而是说明我造的三个问题措辞差别太大,怎么聚都能分开。真实数据里,两个不同的问题可能问法相似(都是「登录有问题」)、草稿也相似(都是「请重试」),只用一种文本就会混。两个一起是更稳妥的默认值。

**练习 2**

```python
# agent-zero-lab/part06/ex373_refund.py
"""Day 373 练习 2:补上退款那一组。在测试库里挑一个同样情况的客户(这里用虚构的 C007),
按帮助中心的规则算出应退金额,写进 expect,存成 reviewed_fixed.jsonl,再让 promote 跑一遍。"""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).parent
items = [json.loads(line) for line in (HERE / "reviewed.jsonl").read_text(encoding="utf-8").splitlines()]
for it in items:
    if it["category"] == "refund":
        it["expect"].update({"customer_id": "C007", "refund_yuan": 273.0,
                             "reply_must_not_include": ["不支持中途退款", "不可退款"]})
        print("已补:", it["expect"])
(HERE / "reviewed_fixed.jsonl").write_text("\n".join(json.dumps(i, ensure_ascii=False) for i in items) + "\n", encoding="utf-8")
```

<div class="line-notes">

- `it["expect"].update({"customer_id": "C007", "refund_yuan": 273.0,` 给退款那组补两个字段:客户编号和应退金额。`273.0` 是 7 个月 × 39 元,和帮助中心规则一致。`customer_id` 在 `fb_promote` 里会被提到用例顶层。
- `"reply_must_not_include": ["不支持中途退款", "不可退款"]})` 再补一条:回复里不能出现这两种错误说法。
- `(HERE / "reviewed_fixed.jsonl").write_text(` 写成新文件,不覆盖原来的 `reviewed.jsonl`,方便对照。

</div>

先 `uv run python -m part06.ex373_refund`,再 `uv run python -m part06.fb_promote part06/reviewed_fixed.jsonl`,实测输出:

```text
已补: {'category': 'refund', 'customer_id': 'C007', 'refund_yuan': 273.0, 'reply_must_not_include': ['不支持中途退款', '不可退款']}
新增 1 条用例 → from_feedback.jsonl
  prod-tr-0062  dev  {'category': 'refund', 'refund_yuan': 273.0, 'reply_must_not_include': ['不支持中途退款', '不可退款']}
  跳过 tr-0002:测试集里已有几乎一样的工单
  跳过 tr-0079:测试集里已有几乎一样的工单
  跳过 tr-0105:未通过人审
  跳过 tr-0123:未通过人审
```

退款那组进来了,先前已经收了的两条被查重挡在外面,`from_feedback.jsonl` 现在有 3 条用例。这个客户 C007 是我虚构的,真实流程里你要在测试库里找一个确实是「专业版年付、已用 4 个月」的客户,或者在造数脚本里造一个。

**练习 3**

```python
# agent-zero-lab/part06/ex373_silent.py
"""Day 373 练习 3:随机抽 20 条「没有任何负面信号」的回复,留给人工看。"""
from __future__ import annotations

import random

from part06.fb_store import connect

conn = connect()
rows = conn.execute("""
    SELECT r.trace_id, r.category, r.ticket FROM replies r
    WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.trace_id = r.trace_id AND (
          (e.kind = 'thumb' AND e.value = -1) OR e.kind IN ('escalated', 'reopened')
          OR (e.kind = 'csat' AND e.value <= 2) OR (e.kind = 'edit_ratio' AND e.value >= 0.5)))
""").fetchall()
print(f"没有任何负面信号的回复:{len(rows)} / 200")
for r in random.Random(1).sample(rows, 20)[:5]:
    print(f"  {r['trace_id']}  {r['category']:<8}{r['ticket']}")
print("  ……(共抽 20 条)")
```

<div class="line-notes">

- `WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.trace_id = r.trace_id AND (` 「不存在这样一条事件」:属于这条回复、并且是负面信号。`NOT EXISTS` 比 `NOT IN` 在含有空值时更安全。
- `(e.kind = 'thumb' AND e.value = -1) OR e.kind IN ('escalated', 'reopened')` 四类负面信号:点踩、转人工或追问、低满意度、重度改写,任何一种出现都不算「沉默」。
- `random.Random(1).sample(rows, 20)[:5]` 固定种子随机抽 20 条,只打印前 5 条。

</div>

实测输出:

```text
没有任何负面信号的回复:159 / 200
  tr-0042  bug     点导出以后页面卡住,一直在加载
  tr-0181  invoice 发票抬头写错了,能重开吗?
  tr-0018  bug     导出 Excel 一直转圈。
  tr-0082  bug     导出 Excel 一直转圈。
  tr-0037  billing 想问下企业版年付的价格
  ……(共抽 20 条)
```

159 条沉默。人工看这 20 条,在我造的数据里一条错的都不会有:造数据时每一条出错的回复都会被客服改写,所以都在重度改写里。**这一步在虚构数据上看不出价值,在真实数据里才有价值**:真实世界里客服忙起来会直接发送,那部分错误没有任何信号。

**练习 4**(开放题,给一个示范)

```text
周一上午(自动):脚本跑报表和候选,产出队列,不需要人。
周二上午(1 小时,我 + 一位资深客服):审队列前 20 组,判断是不是真错、正确答案是什么。
周二下午(30 分钟,我):把通过的组导成测试用例,知识缺失的起草文章交给产品批。
周三(各自):产品批文章入库;我改提示词或手册、跑门禁。
周五:对比上周版本和这周版本的重度改写率、点踩率,写三行周报:新增几条用例、补几篇文章、哪个类别在变好或变坏。
每周固定:随机抽 20 条沉默回复给资深客服看,10 分钟。
```

示范里每一步都有人名和时长。写不出「谁」和「多久」的步骤,通常说明这一步没人真的会去做。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 数据飞轮 | 上线产生反馈,反馈变成测试用例、知识库文章和提示词修复,修复让产品更好,循环往复 |
| 分诊 | 对可疑回复打分、聚类、排序,决定先看哪些 |
| 可疑度 | 给每条回复的一个分数,由各种负面信号按可信度加权求和,只用来排序 |
| badcase | 线上确认出错的案例,经人审后进入测试集或触发修复 |
| 贪心聚类 | 逐条处理,每条加入最像的已有组或自己开新组的简单聚类方法 |
| 聚类阈值 | 相似度达到多少才算同一组。太低把不同的事并一起,太高把同一件事拆碎 |
| 纯度 | 每组里占多数的真实类别的条数之和除以总数,需要有答案才能算 |
| 余弦相似度 | 两个向量夹角的余弦,归一化向量下等于它们的点积(`@`),越接近 1 越相似 |
| 误点 | 点了踩但草稿一个字没改,显式反馈里的噪声 |
| 护栏 | 导出用例前的一道检查,不满足就跳过并说明原因,如退款类必须有 `refund_yuan` |
| 脱敏 | 把手机号、邮箱、证件号等个人信息替换成占位符再入库 |
| 杰卡德相似度 | 两个集合交集除以并集,用来判断两条文字是不是几乎一样 |
| 古德哈特定律 | 一个指标一旦成为考核目标,就不再是好的指标 |

## 常见误区

**可疑度门槛放太高。** 我最初放在 2 分,39 条重度改写只有 15 条进了候选。隐式信号的价值正是补显式反馈覆盖不到的那一块,门槛别把它挡在外面。

**用精确去重代替聚类。** 真实回复措辞每次不同,精确去重会退化成每条一组。要按语义聚类,再用已知答案或抽样看来选阈值。

**阈值照搬。** 0.7 在我这份数据上能用,是因为三个问题措辞差别大。你的数据要自己抽几组看,同一组里是不是同一件事。

**让模型决定什么进测试集。** 模型可以猜原因、起草文章,但「这算不算错」「正确答案是什么」只能人来定。E4031 是什么意思,客服的一次改写和模型的猜测都不能当最终依据。

**线上原文不脱敏直接入库。** 测试集会进 git、进 CI 日志、被很多人看到。手机号、邮箱、证件号入库前换掉,脱敏函数还要有「不该误伤」的测试。

**护栏缺位。** 退款类用例缺了应退金额,会把「没写」当成「不该退」,反过来惩罚正确的行为。宁可跳过让人补。

**只补测试集,不修根因。** 用例进了门禁,下次会拦住同样的错误,但 Agent 还是会错。知识缺失要补文章,政策理解错要查检索和提示词。

**起草的文章直接入库。** 实测模型在客服版本之外多加了一句话。帮助中心是检索的数据源,错误会被 Agent 一再引用,批准这一步不能省。

**拿反馈指标考核客服。** 一旦考核改写率,客服就会少改,指标变好看,问题被藏起来。

## 学习资料

### 文档与文章

- [Langfuse · From user feedback to evaluation datasets](https://langfuse.com/resources/engineering/user-feedback-to-evaluation-datasets):官方写的完整流程,反馈存成 score、过滤失败的 trace、加进数据集、修正后的输出当期望,今天的流程和它几乎一一对应,20 分钟。
- [Langfuse · Corrections](https://langfuse.com/docs/observability/features/corrections):在 trace 上写修正输出并和原输出对比,10 分钟。
- [Agent-in-the-Loop(arXiv 2510.06674)](https://arxiv.org/abs/2510.06674):Airbnb 客服 LLM 系统在日常工作流里嵌入四种标注,论文自报重训周期从几个月缩短到几周,方法部分 30 分钟。
- [Hamel Husain · A Field Guide to Rapidly Improving AI Products](https://hamel.dev/blog/posts/field-guide/):为什么要看数据、让领域专家直接参与,30 分钟。
- [scikit-learn · 聚类](https://scikit-learn.org/stable/modules/clustering.html):英文。今天的贪心聚类够用,想换层次聚类或 HDBSCAN 时看这一页。
- [Python 文档 · re](https://docs.python.org/zh-cn/3.12/library/re.html):中文,脱敏正则的写法。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1WPnuzPEzD&autoplay=0&high_quality=1" title="为什么AI评估是产品构建者最热门的新技能 | Hamel Husain &amp; Shreya Shankar [附文稿]" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Web3天空之城 · 为什么AI评估是产品构建者最热门的新技能 | Hamel Husain &amp; Shreya Shankar · 106 分钟的访谈搬运,带中文文稿。重点听「先看线上真实数据、手工记笔记、再归类」那一段,和今天的分诊与人审是同一件事。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/e2i6JbU2R-s" title="Error Analysis: The Highest ROI Technique In AI Engineering" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hamel Husain · Error Analysis: The Highest ROI Technique In AI Engineering · 英文,讲怎么从线上 trace 里抽样、手写笔记、归类,看完更清楚为什么人审这一步省不掉。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):第 10 章后半部分专讲用户反馈和反馈的局限,英文。
- Chip Huyen《Designing Machine Learning Systems》(O'Reilly,2022):第 9 章讲持续学习和线上测试,传统机器学习视角的数据闭环,英文。

### 开源项目与代码

- [langfuse/langfuse](https://github.com/langfuse/langfuse):自托管版本,score、dataset、annotation queue 都在里面,看它的数据结构怎么承载「反馈变用例」。
- 今天的 `part06/fb_triage.py`、`fb_cluster.py`、`fb_queue.py`、`fb_promote.py`、`fb_kb_draft.py` 加昨天的三个文件,一共约 500 行,可以搬进后面的项目。

## 自测

1. 为什么可疑度的门槛放在 2 分会漏掉大量问题?

<details><summary>答案</summary>

单独一个重度改写只有 1.5 到 2 分,门槛放 2 它就进不来。实测 39 条重度改写只有 15 条进候选,其余没人点踩也没转人工,正是显式反馈覆盖不到、隐式信号该补的那一块。放到 1.5 后全部进来,多出的误点交给人审筛。

</details>

2. 精确去重和聚类的区别是什么?为什么真实数据里精确去重不够用?

<details><summary>答案</summary>

精确去重要求文字一模一样;聚类按语义相近归组。真实的大模型每次措辞都不同,客户对同一个问题也有几种问法,精确去重会把它们当成不同的事,退化成每条一组。聚类用 embedding 的余弦相似度,措辞不同但意思相近的归到一起。

</details>

3. 聚类阈值太低、太高各有什么后果?怎么在没有答案的线上数据上选?

<details><summary>答案</summary>

太低会把不同的问题并成一组(实测 0.5 时 41 条并成一组,纯度 0.54),太高会把同一个问题拆碎(0.9 时多出单条组)。线上没有答案,就从 0.7 起步,抽十几组打开看:同一组的几条是不是同一件事,有没有明显两件事被并在一起,有没有明显一件事被拆开,再调。

</details>

4. 导出用例时的护栏为什么要求退款类必须有 `refund_yuan`?

<details><summary>答案</summary>

测试集约定里 `refund_yuan` 为空(或 `null`)表示「不该产生退款」。审的人忘了填,这条用例就会把正确发起退款的 Agent 判错,等于把错误的行为写成标准答案。而且线上的客户在测试库里不存在,退款金额依赖具体订阅数据,要在测试库里指定一个对应的客户并算好金额。

</details>

5. 为什么模型起草的帮助中心文章要人批准才能入库?

<details><summary>答案</summary>

帮助中心是检索的数据源,写进去的错误会被 Agent 一再引用。实测模型在客服版本之外多加了一句「请确保所提供的信息完整、准确」,这次无害,但说明「只写客服版本里有的事实」会被轻微越过;文章更长时,多出的句子更可能是错的。

</details>

6. **面试题**:你的客服 Agent 上线三个月了,怎么系统地让它越用越好?请讲一个完整闭环。

<details><summary>答案</summary>

按飞轮讲。采集:每条回复挂 trace_id,收点赞点踩加原因、草稿改写比例、转人工、客户追问,事件表用幂等主键防重。分诊:每周按类别出报表看突变,给每条回复按可信度加权算可疑度,隐式信号别被门槛挡掉;用 embedding 把说法不同的同类问题聚成组,每组只看代表,按影响面排序,模型辅助猜失败类别。人审:确认是不是真错、正确答案是什么,误点和旧口径要能筛掉。三个出口:通过的变成带脱敏、护栏、查重的测试用例进回归门禁;知识缺失的起草帮助中心文章并人工批准;政策或检索问题回到提示词、检索或手册去修。修完过门禁才上线,按版本号对比线上指标验证。补充风险:每周随机抽沉默回复,指标不考核人。能带一个数最好,比如「我造的一周数据里,41 条可疑回复聚成 3 个真问题和 2 个误点」。

</details>

## 明天预告

Day 374 · 小项目(一):给工单 Agent 搭完整评测系统。这一周的东西要拼起来了:测试集、判题器、评分器、trace、线上来的用例。明天先把「三层评测」整合成一份评测报告,今天导出的 `from_feedback.jsonl` 里那些要看回复内容的字段(`reply_must_include` 等),明天会有一个真的 Agent 来生成回复并检查。
