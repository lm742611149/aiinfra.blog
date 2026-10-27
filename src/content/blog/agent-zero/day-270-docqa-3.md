---
title: 'Day 270 · 小项目(三):知识地图、面试题和坑清单'
description: '第四部分收官。给 DocQA 出成绩单:50 道题里 32 道该答的 hit@1 29/32、MRR 0.948,14 道没答案的拒了 14 道,31 个回答 0 个编造编号,每题平均 ¥0.0009;把四道不完美的题逐个归因,画出 Day 212 到 269 的知识地图,整理 20 道面试题和一份真踩过的坑清单,最后写出能放进简历的项目说明。'
pubDate: 2026-10-27
regime: none
tags: ['rag', 'review', 'project', 'interview', 'agent-zero']
series: 'agent-zero'
day: 270
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 268](/blog/agent-zero/day-268-docqa-1/) 搭了 `DocQA` 的骨架,读文件上了两道锁;[Day 269](/blog/agent-zero/day-269-docqa-2/) 补了引用核对、拒答校准和寒暄分流。功能齐了,但还没有人问过一个问题:这个东西到底好不好?「我觉得还行」不算答案,前三十天学的评估方法今天用上。

## 今天要解决的问题

今天不写新功能。做五件事:

1. 写 `part04/docqa_eval.py`,让整个项目对 50 道题各答一遍,出一张成绩单(检索、拒答、引用、生成、耗时、花费),并读懂每个数字背后能说明什么、不能说明什么。
2. 把成绩单里不完美的几道题逐个归因,知道每一道是检索的问题、阈值的问题,还是生成的问题。
3. 画出第四部分(Day 212 到 269)的知识地图,每个方块对应哪一天。
4. 过一遍 20 道面试题,每题带着这个项目里的真实数字去讲。
5. 整理一份真踩过的坑清单,写一段能放进简历和 README 的项目说明。

预计用时 3 小时(项目日,可以到 4 小时)。API 花费约 ¥0.15:成绩单跑一遍(回答 ¥0.0443 加判分 ¥0.0204),`k=8` 对比再跑一遍(¥0.0473 加 ¥0.0271),练习 5 约 ¥0.0145,其他练习不调接口。价格按 2026 年 10 月 [DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)。

前置:[Day 268](/blog/agent-zero/day-268-docqa-1/)、[Day 269](/blog/agent-zero/day-269-docqa-2/) 的所有文件;[Day 257](/blog/agent-zero/day-257-rag-eval-3/) 的评估集;[Day 260](/blog/agent-zero/day-260-rag-eval-5/) 的「让模型当裁判」。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,不看笔记把知识地图画在纸上;做练习,做不出再展开参考答案,看完关掉重写一遍。面试题每道先自己讲两三分钟再看要点。

## 成绩单

### 先把「考卷」和「评分员」交代清楚

50 道题怎么来的:评估集 30 条(26 条该答,4 条没答案),今天补的 20 条(10 条没答案、4 句寒暄、6 个要靠历史才懂的追问)。合起来:32 道该答的,14 道没答案的,4 句寒暄。

评分的方式有三种,要分清:

- **检索指标**(hit@1、recall、MRR)是程序算的,标准答案是「这道题的答案在哪几篇文章里」,按文章编号比。
- **拒答、分流、引用**是程序判的,看 `Turn.kind` 和引用核对的结果。
- **生成质量**是模型裁判打的:每道题有几个「好回答必须包含的要点」,裁判看问题、回答、资料,判断要点有没有体现、回答里的事实资料里有没有。裁判是模型,不是真值,用法和 [Day 260](/blog/agent-zero/day-260-rag-eval-5/) 一样。

新建 `part04/docqa_eval.py`:

```python
# agent-zero-lab/part04/docqa_eval.py  给整个文档问答项目出成绩单:50 道题(评估集 30 + 补的 20)各问一遍,量检索、拒答、引用、生成、花费和耗时
import json
import os
import statistics
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from common.llm import LLMClient
from part04.docqa import DocQA

judge_client = LLMClient()  # 判分用单独的账本,和回答的花费分开算
K = int(os.environ.get("K", "4"))  # 检索几块;K=8 uv run python -m part04.docqa_eval 可以换一档对比
OUT = Path("data/eval/docqa_results.jsonl" if K == 4 else f"data/eval/docqa_results_k{K}.jsonl")


def load(path: str) -> list[dict]:
    return [json.loads(l) for l in Path(path).read_text(encoding="utf-8").splitlines() if l.strip()]


def cases() -> list[dict]:
    rows = []
    for r in load("data/eval/rag_eval.jsonl"):  # 评估集 30 条,没有 kind 和 history,这里补上
        kind = "unanswerable" if not r["expected_docs"] else "answerable"
        rows.append({**r, "kind": kind, "history": []})
    return rows + load("data/eval/extra_cases.jsonl")


JUDGE = """你是核对员。给你一个问题、客服的回答、回答时参考的资料,和一组「好回答必须包含的要点」。
判断两件事,输出 JSON:
{"covered": [每个要点是否在回答里体现,true/false,顺序和要点一致], "faithful": 回答里的事实是否都能在资料里找到(true/false)}
礼貌用语、转人工的建议不算事实。"""


def run_one(r: dict) -> dict:
    qa = DocQA(LLMClient(), k=K)  # 每题一个新客户端:线程并发时共用账本,会把别的题的花费算到自己头上
    qa.history = list(r["history"])  # 追问带着手写的前一轮对话
    t = qa.ask(r["question"])
    got = [c.doc_id for c, _ in t.hits]
    out = {"id": r["id"], "kind": r["kind"], "type": r.get("type", r["kind"]), "question": r["question"],
           "expected_docs": r["expected_docs"], "answer": t.answer, "reply_kind": t.kind,
           "docs": list(dict.fromkeys(got)), "top": t.hits[0][1] if t.hits else None,
           "cite_ok": t.cite.ok, "cite_bad": t.cite.bad, "cost": t.cost, "seconds": t.seconds}
    if r["kind"] == "answerable" and t.kind == "answer":  # 只有真回答了的、有要点的题才判生成质量
        material = "\n".join(f"[{c.id}] {c.text}" for c, _ in t.hits)
        msg = f"问题:{r['question']}\n回答:{t.answer}\n资料:\n{material}\n要点:{json.dumps(r['answer_points'], ensure_ascii=False)}"
        raw = judge_client.chat([{"role": "system", "content": JUDGE}, {"role": "user", "content": msg}],
                          temperature=0, response_format={"type": "json_object"}).content
        out["judge"] = json.loads(raw)
    return out


def first_rank(r: dict) -> int | None:
    """第一篇期望文章排第几(从 1 数);一篇都没检索到就是 None。"""
    return next((i for i, d in enumerate(r["docs"], 1) if d in r["expected_docs"]), None)


def hit1(r: dict) -> bool:
    return first_rank(r) == 1


def recall(r: dict) -> float:
    return len(set(r["docs"]) & set(r["expected_docs"])) / len(r["expected_docs"])


def mrr_of(res: list[dict]) -> float:
    return sum(1 / rk if (rk := first_rank(r)) else 0.0 for r in res) / len(res)


if __name__ == "__main__":
    with ThreadPoolExecutor(4) as pool:
        results = list(pool.map(run_one, cases()))
    OUT.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in results) + "\n", encoding="utf-8")

    ans = [r for r in results if r["kind"] in ("answerable", "followup")]  # 32 道该答的
    single = [r for r in results if r["kind"] == "answerable"]  # 26 道单轮
    unans = [r for r in results if r["kind"] == "unanswerable"]  # 14 道没答案
    chat = [r for r in results if r["kind"] == "chitchat"]  # 4 句寒暄
    print(f"检索(32 道该答的)  hit@1 {sum(hit1(r) for r in ans)}/{len(ans)}"
          f"  recall@{K} {sum(recall(r) for r in ans) / len(ans):.3f}  MRR {mrr_of(ans):.3f}")
    print(f"拒答  没答案的拒了 {sum(r['reply_kind'] == 'refused' for r in unans)}/{len(unans)}"
          f"  该答的被误拒 {sum(r['reply_kind'] == 'refused' for r in ans)}/{len(ans)}"
          f"  寒暄正确分流 {sum(r['reply_kind'] == 'small_talk' for r in chat)}/{len(chat)}")
    answered = [r for r in results if r["reply_kind"] == "answer"]
    print(f"引用  真回答了 {len(answered)} 个,带合格引用 {sum(bool(r['cite_ok']) for r in answered)} 个,"
          f"出现不合格引用 {sum(bool(r['cite_bad']) for r in results)} 个")
    judged = [r for r in single if "judge" in r]
    covered = sum(all(r["judge"]["covered"]) for r in judged)
    print(f"生成(26 道单轮里答了的 {len(judged)} 道)  要点全覆盖 {covered}/{len(judged)}"
          f"  忠实 {sum(r['judge']['faithful'] for r in judged)}/{len(judged)}")
    print("按题型的 hit@1:")
    for typ in ["policy", "error_code", "colloquial", "multi"]:
        rs = [r for r in single if r["type"] == typ]
        print(f"  {typ:<11}{sum(hit1(r) for r in rs)}/{len(rs)}")
    secs = sorted(r["seconds"] for r in results)
    print(f"耗时 中位 {statistics.median(secs):.1f}s  p90 {secs[int(len(secs) * 0.9)]:.1f}s  最慢 {secs[-1]:.1f}s")
    print(f"回答花费 平均 ¥{sum(r['cost'] for r in results) / len(results):.4f}/题  合计 ¥{sum(r['cost'] for r in results):.4f}"
          f"(含改写,不含判分)  判分 ¥{judge_client.ledger.cost:.4f}")
```

<div class="line-notes">

- `import os` 为了读环境变量 `K`。
- `judge_client = LLMClient()  # 判分用单独的账本,和回答的花费分开算` 判分的钱不属于「回答一个问题要花多少」,混在一起会高估成本。
- `K = int(os.environ.get("K", "4"))  # 检索几块;K=8 uv run python -m part04.docqa_eval 可以换一档对比` 命令前面加 `K=8` 是 zsh 里「只对这一条命令设环境变量」的写法。`os.environ.get("K", "4")` 没设就是字符串 `"4"`,再 `int()`。
- `OUT = Path("data/eval/docqa_results.jsonl" if K == 4 else f"data/eval/docqa_results_k{K}.jsonl")` 每一档存各自的文件,后面的练习读 K=4 那份,K=8 不会把它覆盖掉。条件表达式写在 `Path(...)` 括号里面。
- `rows.append({**r, "kind": kind, "history": []})` `**r` 把评估集那一行的所有字段展开,再补上 `kind` 和空的 `history`。这样评估集的 30 条和补充的 20 条字段就一致了。
- `return rows + load("data/eval/extra_cases.jsonl")` 列表相加是拼接。
- `JUDGE = """你是核对员。` 裁判提示词:一次只判两件事,要点覆盖和忠实,输出 JSON。最后一句「礼貌用语、转人工的建议不算事实」是 Day 260 学到的:不写这句,裁判会把「建议转人工」当成资料里没有的事实,忠实率被压低。
- `qa = DocQA(LLMClient(), k=K)  # 每题一个新客户端:线程并发时共用账本,会把别的题的花费算到自己头上` 这一行是改过的。第一版我所有题共用一个客户端,`Turn.cost` 是「这一轮开始和结束时账本的差」,4 个线程同时跑的时候,别的线程的花费也被算进来了:跑出来的「合计」是 ¥0.1875,而账本总数只有 ¥0.0724,差 2.6 倍。每题单独建一个客户端,各记各的账,合计才对得上(¥0.0443)。
- `qa.history = list(r["history"])  # 追问带着手写的前一轮对话` 追问题的 `history` 有内容,`ask` 就会走改写;其他题是空的。`list(...)` 复制一份,不改原数据。
- `got = [c.doc_id for c, _ in t.hits]` 检索到的块来自哪些文章(一篇文章可能有好几块)。
- `"docs": list(dict.fromkeys(got)),` 去重但保持顺序的小技巧:字典的键不重复,而且按插入顺序,所以 `dict.fromkeys(got)` 再转列表就是「去重不乱序」。第一篇文章的位置就是文章级的排名。同一行的 `"top"` 是第一名的分数,寒暄没有检索结果,是 `None`。
- `if r["kind"] == "answerable" and t.kind == "answer":  # 只有真回答了的、有要点的题才判生成质量` 追问题没有 `answer_points`,拒答的没有可判的回答,都跳过。
- `material = "\n".join(f"[{c.id}] {c.text}" for c, _ in t.hits)` 裁判看的资料就是当时给模型的那四块。
- `raw = judge_client.chat(` 判分调用,带 `response_format={"type": "json_object"}` 让接口保证返回合法 JSON。
- `def first_rank(r: dict) -> int | None:` 第一篇期望文章在检索结果里排第几。`next(生成器, None)` 取第一个满足条件的,一个都没有就返回 `None`。`enumerate(..., 1)` 从 1 开始数。
- `return sum(1 / rk if (rk := first_rank(r)) else 0.0 for r in res) / len(res)` `:=` 是海象运算符(Python 3.8 加的),在表达式里边赋值边使用:先算 `first_rank(r)` 存进 `rk`,不为 `None` 就取倒数。MRR(Day 256)就是第一个正确结果的排名的倒数的平均。
- `with ThreadPoolExecutor(4) as pool:` 4 个线程并发。并发比串行快不少。
- `ans = [r for r in results if r["kind"] in ("answerable", "followup")]  # 32 道该答的` 单轮 26 加追问 6。
- `hit1(r) for r in ans` `hit@1`:第一篇文章就是期望的文章。
- `f"  recall@{K} {sum(recall(r) for r in ans) / len(ans):.3f}` recall 按文章算,两篇期望文章只找到一篇是 0.5。
- `sum(r['reply_kind'] == 'refused' for r in unans)` 14 道没答案的里,系统最终拒答了几道。不管是被阈值拦下的,还是模型自己拒的。
- `covered = sum(all(r["judge"]["covered"]) for r in judged)` `covered` 是一个布尔列表,`all(...)` 要求每个要点都体现了。
- `secs[int(len(secs) * 0.9)]` p90 耗时:排好序后第 90% 位置的那个。50 道题就是第 45 个。
- `判分 ¥{judge_client.ledger.cost:.4f}` 判分的钱单独列。

</div>

```bash
uv run python -m part04.docqa_eval
```

```text
检索(32 道该答的)  hit@1 29/32  recall@4 0.984  MRR 0.948
拒答  没答案的拒了 14/14  该答的被误拒 1/32  寒暄正确分流 4/4
引用  真回答了 31 个,带合格引用 31 个,出现不合格引用 0 个
生成(26 道单轮里答了的 25 道)  要点全覆盖 23/25  忠实 25/25
按题型的 hit@1:
  policy     10/10
  error_code 6/6
  colloquial 4/6
  multi      4/4
耗时 中位 1.6s  p90 2.4s  最慢 3.0s
回答花费 平均 ¥0.0009/题  合计 ¥0.0443(含改写,不含判分)  判分 ¥0.0204
```

### 读成绩单

| 维度 | 数字 | 说明 |
| --- | --- | --- |
| 检索 hit@1 | 29/32 | 该答的 32 道里,第一篇文章就对的 29 道 |
| 检索 recall@4 | 0.984 | 按文章算,只有 q26 缺一篇 |
| 检索 MRR | 0.948 | 第一篇正确文章几乎总在前两位 |
| 拒答(没答案) | 14/14 | 一道没答案的题都没有编 |
| 误拒(该答的) | 1/32 | q19「老板想看所有账但不能让他改」,0.006 |
| 寒暄分流 | 4/4 | 0 元 0 秒 |
| 引用 | 31/31 合格,0 个编号错 | 真回答的 31 个回答,每个都带着至少一个合格引用 |
| 生成 要点全覆盖 | 23/25 | 单轮里真回答了的 25 道 |
| 生成 忠实 | 25/25 | 裁判认为回答里的事实资料里都有 |
| 耗时 | 中位 1.6 秒,p90 2.4 秒,最慢 3.0 秒 | 带并发 4 的测法,单个用户的感受会略快 |
| 花费 | 平均 ¥0.0009/题 | 含改写,寒暄和低分拒答拉低了平均 |

这张表看着很漂亮。**但要先说它不能证明什么**,这比数字本身更重要:

- **考卷和调参用的是同一批题。** 阈值 0.01、拒答规则、寒暄规则,都是看着这 50 道题里的分数定的、改的。「14 道没答案的拒了 14 道」是在调参用过的题上测的,换一批新的没答案的问题,拦下的比例大概率会低。这叫开发集和测试集没分开,数字偏乐观。真要对外报数字,得再收一批没看过的题。
- **评估集只有 50 道。** 29/32 和 28/32 差一道题,在这个规模上分不出好坏。每个比例的置信区间都很宽。
- **裁判是模型。** 「忠实 25/25」是 DeepSeek 看 DeepSeek 的回答,用的同一个模型家族,有「自己人看自己人」的偏向(Day 260 讲过)。Day 269 练习 4 用另一套裁判提示词核对过 12 道题的 30 个带引用的句子,也是 0 个不支持,但那一套也是模型。
- **题目的语言是我写的。** 这些「口语题」是我按用户可能的说法写的,不是线上真实用户问的。真实的流量里什么怪问法都有。

所以这张成绩单的用处,是**当一把可以反复用的尺子**:改了代码跑一遍,哪个数字变了,变好还是变坏,一目了然。而不是当「系统达到了 X 水平」的证明。

### 四道不完美的题

成绩单里真正有信息量的是不完美的那几道。看它们各自出在哪一步:

**q19「老板想看所有账但不能让他改」,被阈值误拒。** 第一名 rerank 分只有 0.006,低于 0.01。检索其实找到了 `kb-015`(团队成员与权限),排在第 3 位。问题出在 rerank 看不懂这个绕弯的说法,根子在检索,不是阈值。Day 269 练习 3 量过,第一轮也走改写、并拿改写后的话打分,能救回它(0.006 变 0.163),代价是压低别的题。

**q17「买错了能把钱要回来吗」,要点两个全漏。** 检索第一名是 `kb-003#1`(怎么申请退款),分数 0.043,贴着阈值边缘;真正讲退款规则的 `kb-002#1`(年付按月比例退)排在第 8。`k=4` 时模型手里只有申请步骤和到账时间,没有规则,答出来的只是步骤,没提年付月付。练习 5 会把 `k` 调到 8 试。

**q26「导入流水支持哪些银行,文件编码有要求吗」,漏了一篇。** `kb-011`(E1043 编码错误)检索不到,回答里「文件编码」那半句老实说「没有找到」。这是 Day 259 就量到的老问题:讲编码的文章是以「错误码」的名义写的,和「文件编码有什么要求」字面不像。`k` 调大也找不回来(Day 268 练习 5)。

**f04「怎么申请」(追问,上一轮聊发票),第一篇文章排第二。** 第一名是 `kb-003`(怎么申请退款),`kb-006`(发票怎么申请)第二。这一轮改写出了什么检索词我没有逐条看,只看到最后的排名。回答本身是对的,因为资料里两篇都在。

四道题的根都在检索这一层(rerank 看不懂口语、文章写法和问法不像、规则块排得太靠后),其中只有 q17 靠调大 `k` 能缓解。**成绩单上的生成指标看着只差 2 道,但生成层几乎没有问题;让生成不好的原因都在它上游。** 这也是 Day 259 讲的分层评估的价值:不分层,你会去改提示词,而提示词救不了检索不到的东西。

## 第四部分知识地图

第四部分从 Day 212 到 269,将近 60 天。今天先不看代码,把脑子里的东西摊在一张图上,每个方块写了在哪天学的:

<figure>
<svg viewBox="0 0 640 358" role="img" aria-label="第四部分知识地图:离线建库、在线检索、生成与把关、评估、上下文与 Agent、扩展六块,以及底下 Day 268 到 270 的文档问答项目把它们接在一起">
<rect x="0" y="0" width="640" height="358" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="11">
<rect x="10" y="12" width="200" height="126" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="20" y="32" fill="var(--compute)" font-size="12">离线:建库</text>
<text x="20" y="52" fill="var(--ink)">向量与余弦 212-219</text>
<text x="20" y="68" fill="var(--ink)">embedding 服务 217</text>
<text x="20" y="84" fill="var(--ink)">切块 224(带标题前缀)</text>
<text x="20" y="100" fill="var(--ink)">pgvector 增量同步 229-232</text>
<text x="20" y="116" fill="var(--ink)">HNSW 为什么会漏 233</text>
<text x="20" y="132" fill="var(--ink)">过滤的坑 234</text>
<rect x="220" y="12" width="200" height="126" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="230" y="32" fill="var(--mem)" font-size="12">在线:检索</text>
<text x="230" y="52" fill="var(--ink)">BM25 + jieba 235</text>
<text x="230" y="68" fill="var(--ink)">RRF 融合 236</text>
<text x="230" y="84" fill="var(--ink)">rerank 精排 238</text>
<text x="230" y="100" fill="var(--ink)">query 改写 239</text>
<text x="230" y="116" fill="var(--ink)">流水线四模式 240</text>
<text x="230" y="132" fill="var(--ink)">Contextual Retrieval 241</text>
<rect x="430" y="12" width="200" height="126" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="440" y="32" fill="var(--mem)" font-size="12">生成与把关</text>
<text x="440" y="52" fill="var(--ink)">拼 prompt 226-227</text>
<text x="440" y="68" fill="var(--ink)">引用核对 269</text>
<text x="440" y="84" fill="var(--ink)">拒答校准 269</text>
<text x="440" y="100" fill="var(--ink)">寒暄分流 269</text>
<text x="440" y="116" fill="var(--ink)">固定话术 269</text>
<rect x="10" y="150" width="200" height="126" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="20" y="170" fill="var(--compute)" font-size="12">评估</text>
<text x="20" y="190" fill="var(--ink)">为什么分两层 255</text>
<text x="20" y="206" fill="var(--ink)">hit@k、MRR 256</text>
<text x="20" y="222" fill="var(--ink)">30 条评估集 257</text>
<text x="20" y="238" fill="var(--ink)">检索评估 259</text>
<text x="20" y="254" fill="var(--ink)">LLM 当裁判 260</text>
<text x="20" y="270" fill="var(--ink)">做实验、RAGAS 261</text>
<rect x="220" y="150" width="200" height="126" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="230" y="170" fill="var(--mem)" font-size="12">上下文与 Agent</text>
<text x="230" y="190" fill="var(--ink)">预算与 token 262</text>
<text x="230" y="206" fill="var(--ink)">压缩与清理 263</text>
<text x="230" y="222" fill="var(--ink)">短期与长期记忆 264</text>
<text x="230" y="238" fill="var(--ink)">Agentic RAG 266</text>
<text x="230" y="254" fill="var(--ink)">子 Agent 与 harness 267</text>
<rect x="430" y="150" width="200" height="126" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="440" y="170" fill="var(--compute)" font-size="12">扩展:更难的资料</text>
<text x="440" y="190" fill="var(--ink)">PDF、OCR 242-243</text>
<text x="440" y="206" fill="var(--ink)">多模态 245-247</text>
<text x="440" y="222" fill="var(--ink)">代码检索 248</text>
<text x="440" y="238" fill="var(--ink)">RLM 249</text>
<text x="440" y="254" fill="var(--ink)">GraphRAG 250-254</text>
<rect x="10" y="288" width="620" height="56" rx="6" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="22" y="310" fill="var(--ink)" font-size="12">Day 268-270 文档问答项目:把上面六块接成一条线</text>
<text x="22" y="330" fill="var(--ink-soft)">改写 → 检索 → 拒答 → 生成 → 引用核对 → 记历史,外面两道锁 kb_jail + sandbox-exec</text>
</g></svg>
<figcaption>第四部分知识地图。琥珀色是离线和评估这类「准备工作」,蓝色是在线、模型参与的环节。Day 268 到 270 的项目把前面所有的块接成了一条线。</figcaption>
</figure>

六块各用一句话讲清楚它解决什么问题(这也是面试里开口的第一段):

- **离线建库**([Day 212](/blog/agent-zero/day-212-why-vectors/) 到 [219](/blog/agent-zero/day-219-embed-limits/)、[224](/blog/agent-zero/day-224-chunking/)、[229](/blog/agent-zero/day-229-pgvector-1/) 到 [234](/blog/agent-zero/day-234-filter-pitfall/)):把文档变成能按「意思」搜的索引。切块决定每个检索单位多大,embedding 把它变成向量,pgvector 存起来并且能增量更新,HNSW 让几百万个向量里也能毫秒级找到近邻,代价是会漏。
- **在线检索**([Day 235](/blog/agent-zero/day-235-bm25/) 到 [241](/blog/agent-zero/day-241-contextual-retrieval/)):向量搜不准错误码和专有名词,所以加 BM25;两路结果用 RRF 合起来;rerank 对前几十个精排;口语和追问用改写补成帮助中心的说法。
- **生成与把关**([Day 226](/blog/agent-zero/day-226-retrieve-answer/)、[227](/blog/agent-zero/day-227-rag-prompt/)、[269](/blog/agent-zero/day-269-docqa-2/)):prompt 要求只依据资料、标出处、不够就拒答;程序再核对一遍引用,低分的直接拒答。
- **评估**([Day 255](/blog/agent-zero/day-255-rag-eval-1/) 到 [261](/blog/agent-zero/day-261-rag-eval-6/)):检索和生成分开量。检索看 hit@k、recall、MRR;生成看忠实和完整;必须有「没答案」的题。
- **上下文与 Agent**([Day 262](/blog/agent-zero/day-262-context-budget/) 到 [267](/blog/agent-zero/day-267-subagent-isolation/)):窗口大不等于该塞满。预算、压缩、记忆、隔离,以及把检索做成工具让 Agent 自己决定查不查。
- **扩展**([Day 242](/blog/agent-zero/day-242-pdf-text/) 到 [254](/blog/agent-zero/day-254-graphrag-global/)):资料不是干净的文本时怎么办:PDF、扫描件、图片、代码、需要跨文档推理的问题。

这张图有一条主线,可以用一句话概括整个第四部分:**让模型回答「它本来不知道的、你们公司特有的事」,靠的是先把对的资料找出来,再让它只依据资料说话,并且每一步都能被量出来。** 面试时被问「讲讲你的 RAG 项目」,就沿着这条线讲:资料怎么进库、问题怎么变成检索、检索怎么排、回答怎么约束、整体怎么量、哪里还不好。

## 面试题

20 道题。每道先自己讲两三分钟,再展开看要点。要点里的数字都是这个项目里实测的,面试时「我自己量过」比「一般来说」有说服力得多。

**1. 介绍一下 RAG 的原理和完整流程。**

<details><summary>要点</summary>

离线:文档清洗、切块(带标题等上下文)、embedding、写入向量库建索引,按内容哈希增量更新。在线:改写(补全追问、拆多问题)、向量加 BM25 多路召回、RRF 融合、rerank、拼 prompt 生成并标出处、引用核对、低分拒答。最后补一句评估:检索和生成分层量。拿 CloudLedger 举例:42 块、20 篇文章。

</details>

**2. 切块策略怎么选?块大小怎么定?**

<details><summary>要点</summary>

有结构按结构切(标题、段落),无结构用固定长度加重叠;每块前面加文章标题。大小没有标准答案,用评估集比较几档的 recall 再定。我的项目里 q26 就是个反例:讲编码的那篇文章是按「错误码」的口径写的,切得再好,用户问「文件编码有什么要求」也检索不到,切块解决不了的问题要靠改写或补文档。

</details>

**3. 向量检索有什么缺点?怎么弥补?**

<details><summary>要点</summary>

对编号、错误码、专有名词、否定句不敏感;用户措辞和文档差别大时也会失败。弥补:BM25 混合、RRF 融合、rerank、改写、Contextual Retrieval。数字:不改写、不带历史时,追问「那年付的呢」只有 0.074,补全之后 0.989。

</details>

**4. 召回率高但回答不准,怎么排查?**

<details><summary>要点</summary>

先分层。我的成绩单:recall@4 是 0.984,可是 q17 的要点两个全漏,原因是真正讲规则的块排在第 8,`k=4` 够不着。看「正确资料在不在 top-k」:在,是生成的问题(prompt、资料冲突、k 太大引入噪音);不在,是检索的问题(排序靠后、被截断)。文章级的 recall 会掩盖块级的问题,这个坑值得提。改完回归评估集。

</details>

**5. 怎么评估一个 RAG 系统?**

<details><summary>要点</summary>

检索层 hit@k、recall、MRR,标准答案是答案所在文档;生成层忠实、完整,用模型当裁判并人工抽查;必须有没答案的题测拒答;按题型拆分。再补两个诚实的限制:评估集小、开发集和测试集没分开,数字偏乐观;裁判是模型,有偏向。说出这些限制比说「准确率 95%」更像做过项目的人。

</details>

**6. rerank 和 embedding 模型有什么区别?**

<details><summary>要点</summary>

embedding 是双塔,问题和文档分别编码,文档向量可以预先算好,快但粗;rerank 是交叉编码,问题和文档放在一起判断,实时算,慢但准。所以两段式:先召回几十个,再精排取前几个。我的项目里 rerank 分数还被拿来做拒答依据,但它衡量的是「像不像」,不是「能不能回答」:「备份码丢了怎么办」得 0.593。

</details>

**7. 向量数据库怎么选?为什么用 pgvector?**

<details><summary>要点</summary>

看规模、是否已有基础设施、是否要和业务数据联查、过滤需求、运维能力。pgvector 适合百万到千万级、已有 Postgres、要事务和权限过滤;更大规模、更高并发再考虑专用库。要能讲 HNSW 原理、`ef_search`、加过滤后结果变少的问题([Day 233](/blog/agent-zero/day-233-hnsw/)、[234](/blog/agent-zero/day-234-filter-pitfall/))。

</details>

**8. 知识库更新了怎么办?**

<details><summary>要点</summary>

增量更新:按内容哈希判断哪些块变了,只重算变化的;消失的块要删;upsert 放在事务里;换 embedding 模型必须全量重建。我的 `sync_chunks` 返回 total、written、embedded、deleted 四个数,每次同步都能对账([Day 231](/blog/agent-zero/day-231-pgvector-2/))。

</details>

**9. 多轮对话的 RAG 有什么难点?**

<details><summary>要点</summary>

追问依赖上下文,要补全后再检索;历史越来越长要压缩;检索资料不存进历史,每轮重新检索。数字:五轮对话后,只存问答是 818 个 token,连资料一起存是 2410。还有个反直觉的点:第一轮不改写,所以单轮阈值和多轮阈值分布不一样,要两种场景都量。

</details>

**10. 怎么减少幻觉?拒答怎么做?**

<details><summary>要点</summary>

三道防线:生成前低分直接拒答(阈值要用自己的数据校准,同时量误拒和漏过);生成时 prompt 要求「资料不够就说没找到」并规定固定话术;生成后引用核对。我实测的两个意外:去掉 prompt 规则,模型也不编,会用自己的话拒答,规则的价值是让程序认得出「这是拒答」;阈值 0.01 只拦下 14 道没答案的题里的 7 道,「沾边但没写」的问题分数高到 0.593,拦不住。

</details>

**11. 回答里的引用怎么做?怎么保证它是真的?**

<details><summary>要点</summary>

让模型在每个事实后标 `[kb-002#1]` 这样的编号,编号来自资料块的 id。程序核对三层:格式对不对、是不是本轮给过模型的块、这一块是否真的支持这句话。前两层用正则和集合比较,后一层要模型当裁判,成本高,适合抽样。我的 40 个回答里编号 0 个出错,但正则只认 `[kb-xxx]` 一种写法时,合并写、全角括号、大写、有空格四种变体全被静默漏掉。

</details>

**12. 什么是 Agentic RAG?什么时候用?**

<details><summary>要点</summary>

把检索做成工具,由 Agent 自己决定查不查、查什么、查几次。适合一句话问多件事、需要追查的场景;代价是延迟和成本不可控、调试难([Day 266](/blog/agent-zero/day-266-agentic-rag/) 实测费用是固定流水线的 2.7 倍)。默认用固定流程,看着不对劲的再升级。

</details>

**13. 什么是上下文工程?和提示词工程有什么区别?**

<details><summary>要点</summary>

提示词工程关心指令怎么写;上下文工程关心每次调用时窗口里放什么、放多少:预算、压缩、记忆、隔离。依据是上下文越长模型越难用好信息。要能说出手段的代价递增:清理旧工具结果(不花钱)、按轮裁剪、摘要压缩(要调模型,会丢细节)、子 Agent 隔离(总 token 反而更多)。

</details>

**14. 你怎么理解 Agent Harness?**

<details><summary>要点</summary>

模型之外让 Agent 能干活的整套工程:循环和步数预算、工具注册、上下文组装、状态持久化、沙箱和权限、可观测。上下文管理是其中最核心的一块。最好指着自己的代码讲:[Day 267](/blog/agent-zero/day-267-subagent-isolation/) 的 harness 每一轮留一份轨迹,能按轮对账。

</details>

**15. 你的 Agent 能读文件,怎么防止它读到不该读的?**

<details><summary>要点</summary>

两层。工具层:拼路径后 `resolve()`,用 `is_relative_to(根目录)` 判断,不用字符串前缀;只认固定后缀;先判范围再判存在;限制大小。进程层:操作系统沙箱(macOS 的 `sandbox-exec`、Linux 的 bubblewrap/Landlock、容器),默认拒绝只开必需。再补:密钥不能放在进程读得到的目录。我自己的实测:没有锁时 `../` 穿越、绝对路径、符号链接三种全读到了。

</details>

**16. 拒答阈值怎么定?**

<details><summary>要点</summary>

用有标注的数据:该答的、不该答的、追问、寒暄各量第一名分数,扫一遍候选阈值,数误拒和漏过,按业务代价选。别用刚好卡在缝里的数(0.006 恰好等于数据里最低的该答分数,换一批就破);别只用单轮数据(追问的分数分布不同);要有「沾边但没写」的题,否则会高估阈值的拦截能力。

</details>

**17.(手写题)实现 RRF。**

<details><summary>要点</summary>

每一路排名第 r 的结果加 `1/(k+r)`,k 通常取 60,各路相加,按总分降序。追问为什么不直接加分数:各路分数的量纲不同(BM25 分和余弦相似度不是一个尺度),只看名次更稳。

</details>

**18.(手写题)写一个函数计算 recall@k 和 MRR。**

<details><summary>要点</summary>

先把块级结果按文章去重,保留首次出现的位置;期望为空的样本要跳过;MRR 是第一个相关结果排名倒数的平均。本课 `docqa_eval.py` 里的 `first_rank`、`recall`、`mrr_of` 就是,二十行以内。

</details>

**19. 知识库里有大量 PDF、Excel 和扫描件,怎么处理?**

<details><summary>要点</summary>

先分类型:文字型 PDF 直接抽,扫描页走 OCR;表格单独识别转 Markdown,大表按行切块并带表头,需要筛选计算的进数据库做 SQL 工具;去掉页眉页脚;多栏和复杂版式用版面分析工具;图片用 OCR 或多模态模型描述。入库前抽查解析结果,评估集里加「答案在表格里」的题,解析方式变了就重跑评估([Day 242](/blog/agent-zero/day-242-pdf-text/) 到 [247](/blog/agent-zero/day-247-vision-3/))。

</details>

**20.(项目题)讲讲你这个项目里最不满意的地方,以及你会怎么改。**

<details><summary>要点</summary>

拿成绩单说话,不要泛泛而谈:口语题 hit@1 只有 4/6,rerank 看不懂绕弯的说法;文章按「错误码」口径写的,用户问「文件编码」就找不到(q26);`k=4` 够不到排在第 8 的规则块(q17);评估集小、开发集测试集没分开、裁判是模型。改进按代价排序:先补评估集,尤其是没看过的题;再试 `k=8`(q17 能救回,每 1000 次多约 ¥0.52);再看是不是把 q26 这类文章补一段「文件编码要求」。每一项都要说清楚怎么验证它真的变好了。

</details>

## 坑清单

下面每一条都是这部分里真踩过、真量过的,症状写的是当时看到的东西。前面几天的坑摘自各天的「常见误区」,后面几行是 Day 268 和 269 新出现的。

| 坑 | 症状 | 怎么发现、怎么避免 | 在哪一天 |
| --- | --- | --- | --- |
| 索引和查询用了不同的 embedding 模型 | 检索结果像随机的,不报错 | 换模型必须全量重建,表上用 `vector(维度)` 挡一部分 | [Day 231](/blog/agent-zero/day-231-pgvector-2/) |
| HNSW 加过滤后结果变少 | `LIMIT 5` 只回 2 行 | 迭代扫描、调大 `ef_search`、部分索引 | [Day 233](/blog/agent-zero/day-233-hnsw/)、[234](/blog/agent-zero/day-234-filter-pitfall/) |
| jieba 切不开业务词 | BM25 匹配不上「企业版」 | 加业务词典,索引和查询用同一套 | [Day 235](/blog/agent-zero/day-235-bm25/) |
| 只看总分 | 口语类的差被总分掩盖 | 按题型拆开看 | [Day 261](/blog/agent-zero/day-261-rag-eval-6/) |
| 一个裁判判好几件事 | 分数不稳、解释不了 | 每个裁判只判一件事 | [Day 260](/blog/agent-zero/day-260-rag-eval-5/) |
| 按条裁历史 | 400:`tool` 消息找不到对应的 `tool_calls` | 按轮裁 | [Day 262](/blog/agent-zero/day-262-context-budget/) |
| `[:-keep_recent]` 在 0 上出错 | `keep_recent=0` 时什么都没清掉 | 单独处理 0 | [Day 263](/blog/agent-zero/day-263-compaction/) |
| 记忆查询忘了 `WHERE user_id` | A 用户召回到 B 用户的记忆 | 所有记忆 SQL 带 `user_id`,写成测试 | [Day 264](/blog/agent-zero/day-264-memory-short-long/) |
| 工具直接拿模型给的编号拼路径 | `../` 读到知识库外面 | 白名单,或者解析后判范围 | [Day 266](/blog/agent-zero/day-266-agentic-rag/) |
| 子 Agent 看不到主对话 | 客户早先说过的背景它当不存在 | 背景要写进交给它的任务里 | [Day 267](/blog/agent-zero/day-267-subagent-isolation/) |
| 追问不补全就检索 | 「那年付的呢」0.074(补全后 0.989) | 先改写再检索,rerank 也用补全后的话 | [Day 268](/blog/agent-zero/day-268-docqa-1/) |
| 历史里存检索资料 | 五轮后 2410 对 818 个 token,旧资料还会过期 | 历史只存问答文本,资料每轮重检 | [Day 268](/blog/agent-zero/day-268-docqa-1/) |
| 用 `startswith` 判断路径在不在目录里 | `data/kb_evil/` 被当成 `data/kb/` 里面 | `resolve()` 加 `is_relative_to` | [Day 268](/blog/agent-zero/day-268-docqa-1/) |
| 符号链接指向目录外 | 名字是 `notes-link.md`,读出了外面的文件 | `resolve()` 会跟着链接走到真实位置 | [Day 268](/blog/agent-zero/day-268-docqa-1/) |
| `sandbox-exec` 缺项 | `execvp() … failed: Operation not permitted` | `(deny default)` 起步,实测一项项加,`process-exec*` 带星号 | [Day 268](/blog/agent-zero/day-268-docqa-1/) |
| 改写用的客户端和主流程不是同一个 | `Turn.cost` 少了改写那次;被拦下的问题显示 ¥0.0000 | 把 `DocQA` 的客户端传给 `rewrite` | [Day 268](/blog/agent-zero/day-268-docqa-1/) |
| 并发时共用一个账本 | 合计 ¥0.1875,账本总数只有 ¥0.0724 | 每个并发任务自己的客户端 | Day 270(今天) |
| 引用正则只认一种写法 | 合并写、全角括号、大写、空格四种静默漏掉 | 先统一写法再核对 | [Day 269](/blog/agent-zero/day-269-docqa-2/) |
| 逐对核对「一句话引了两块」 | 31 对里 4 对判不支持,其实是方法错 | 把一句话引用的所有块合在一起判 | [Day 269](/blog/agent-zero/day-269-docqa-2/) |
| 阈值卡在数据的缝里 | 最优阈值 0.006,恰好等于最低的该答分数 | 留余量,在更大的数据上复测 | [Day 269](/blog/agent-zero/day-269-docqa-2/) |
| 以为阈值能拦住所有没答案的 | 「备份码丢了怎么办」0.593 | 加 prompt 规则和核对,评估集里加「沾边但没写」的题 | [Day 269](/blog/agent-zero/day-269-docqa-2/) |
| 按固定话术统计拒答 | 没规则时 14/14 算漏,其实模型在用自己的话拒 | 严格和宽松两个口径都看,先读实际回答 | [Day 269](/blog/agent-zero/day-269-docqa-2/) |
| 寒暄规则只测「该拦的」 | 「你好,我想退款」被当寒暄 | 两个方向都测,误伤例子补进测试 | [Day 269](/blog/agent-zero/day-269-docqa-2/) |

## 项目说明:简历和 README 里写什么

写项目说明的要点是:做了什么、用了什么、为什么这么选、怎么验证、结果是多少、哪里不够。最后一项会让人觉得可信。下面是用今天的数字写的一版:

> 为一个虚构 SaaS(云簿 CloudLedger)的帮助中心做了多轮文档问答 Agent。离线侧用 pgvector 存向量,按内容哈希增量更新;在线侧用向量加 BM25(jieba 加业务词典)双路召回,RRF 融合,bge-reranker 精排;追问先改写再检索。生成侧用固定话术拒答,rerank 低分在生成前直接拦下,寒暄不检索不调模型,回答强制带出处,程序逐个核对编号并清理不合格的。读文件走 `resolve` 加 `is_relative_to` 的路径锁,整个进程再关进 `sandbox-exec`。用 50 道题(14 道没答案、4 句寒暄、6 个追问)的评估集量:该答的 32 道 hit@1 29/32、MRR 0.948;没答案的拒答 14/14,误拒 1/32;31 个回答的引用全部合格;裁判判忠实 25/25、要点全覆盖 23/25;平均每题 ¥0.0009,中位耗时 1.6 秒。已知局限:评估集小且调参与测试用的是同一批题;口语题 hit@1 4/6,文章写法与问法不一致时检索不到(q26)。

几点说明。数字要写你自己跑出来的,别照抄我的。「已知局限」那句别删,面试官问「有什么问题」,你已经先答了。有些数字我没写,比如「`k=8` 能救回 q17」,因为它没有在全量评估上复测过。

## 动手练习

### 练习 1:给 DocQA 写单元测试,不连网、不花钱

用假的检索、假的改写、假的模型,把 `ask` 的五条规则写成测试:寒暄什么都不碰;低分拒答不调模型,但拒答要进历史;假引用被清理;历史只存原话;追问才改写,并把改写结果传给检索。

<details><summary>参考答案</summary>

先装 pytest:

```bash
uv add --dev pytest
```

```python
# agent-zero-lab/part04/test_docqa.py  练习 1:不连网、不花钱,用假的检索和假的模型,把 DocQA.ask 的五条规则写成测试
from types import SimpleNamespace

import pytest

import part04.docqa as docqa_mod
from part04.chunking import Chunk
from part04.docqa import DocQA
from part04.prompts import REFUSAL


def chunk(cid: str) -> Chunk:
    doc = cid.split("#")[0]
    return Chunk(id=cid, doc_id=doc, title="退款政策", category="退款", section="年付套餐", text="年付按剩余整月退款")


class FakeClient:
    """假模型:每次 chat 都返回同一段话,并数自己被调了几次。"""

    def __init__(self, reply: str = "年付按剩余整月退款。[kb-002#1]") -> None:
        self.reply = reply
        self.calls = 0
        self.ledger = SimpleNamespace(cost=0.0)

    def chat(self, messages, **kw):
        self.calls += 1
        return SimpleNamespace(content=self.reply)


@pytest.fixture
def spy(monkeypatch):
    """把 docqa 里用到的 retrieve 和 rewrite 换成假的,并记下它们被调用时收到的参数。"""
    state = SimpleNamespace(score=0.9, retrieve_calls=[], rewrite_calls=[])

    def fake_retrieve(question, **kw):
        state.retrieve_calls.append(kw)
        return [(chunk("kb-002#1"), state.score)]

    def fake_rewrite(question, history, client=None):
        state.rewrite_calls.append(question)
        return ["年付套餐是否支持退款"]

    monkeypatch.setattr(docqa_mod, "retrieve", fake_retrieve)
    monkeypatch.setattr(docqa_mod, "rewrite", fake_rewrite)
    return state


def test_small_talk_touches_nothing(spy):
    client = FakeClient()
    qa = DocQA(client)  # type: ignore[arg-type]
    t = qa.ask("好的谢谢")
    assert t.kind == "small_talk"
    assert client.calls == 0 and spy.retrieve_calls == []
    assert qa.history == []  # 寒暄不进历史


def test_low_score_refuses_without_calling_model(spy):
    spy.score = 0.005
    client = FakeClient()
    qa = DocQA(client)  # type: ignore[arg-type]
    t = qa.ask("你们有学生优惠吗")
    assert t.kind == "refused" and t.answer == REFUSAL
    assert client.calls == 0  # 一次生成都不该调
    assert len(qa.history) == 2  # 但拒答要进历史,下一轮才知道上一句没答上


def test_fake_citation_is_stripped(spy):
    client = FakeClient("年付按剩余整月退款。[kb-002#1] 审批通常一天内完成。[kb-002#9]")
    t = DocQA(client).ask("年付能退款吗")  # type: ignore[arg-type]
    assert t.cite.unknown == ["kb-002#9"] and t.cite.ok == ["kb-002#1"]
    assert "kb-002#9" not in t.answer and "[kb-002#1]" in t.answer


def test_history_keeps_text_only(spy):
    qa = DocQA(FakeClient())  # type: ignore[arg-type]
    qa.ask("年付能退款吗")
    assert [m["role"] for m in qa.history] == ["user", "assistant"]
    assert qa.history[0]["content"] == "年付能退款吗"  # 是原话,不是拼了资料的那条
    assert all("<资料>" not in m["content"] for m in qa.history)


def test_followup_rewrites_and_passes_queries(spy):
    qa = DocQA(FakeClient())  # type: ignore[arg-type]
    qa.ask("月付的能退款吗")
    assert spy.rewrite_calls == []  # 第一轮没历史,不改写
    qa.ask("那年付的呢")
    assert spy.rewrite_calls == ["那年付的呢"]
    assert spy.retrieve_calls[-1]["queries"] == ["那年付的呢", "年付套餐是否支持退款"]
```

<div class="line-notes">

- `from types import SimpleNamespace` 标准库里一个「随手建对象」的工具:`SimpleNamespace(a=1)` 得到一个有属性 `.a` 的对象。测试里用它造假的结果和假的账本,不用专门写类。
- `import pytest` Day 33 或之前学过的测试框架,pytest≈jest/vitest。
- `import part04.docqa as docqa_mod` 要替换的是 `docqa` 模块里的 `retrieve` 和 `rewrite` 这两个名字,所以导入模块本身。
- `def chunk(cid: str) -> Chunk:` 造一个假块。`cid.split("#")[0]` 把 `kb-002#1` 切成 `kb-002` 当文章编号。
- `class FakeClient:` 假模型:每次 `chat` 都返回同一段话,并数自己被调了几次。测试里最重要的断言是「某条路径上它**没被调用**」。
- `self.ledger = SimpleNamespace(cost=0.0)` `DocQA` 读 `client.ledger.cost` 算成本,假客户端也得有这个属性。
- `def chat(self, messages, **kw):` 参数不用,只要接得住。
- `@pytest.fixture` 固定装置:测试函数的参数里写 `spy`,pytest 就会先调用这个函数并把返回值传进来。
- `def spy(monkeypatch):` `monkeypatch` 是 pytest 自带的固定装置,用它改的东西会在测试结束后自动恢复,不会污染别的测试。
- `state = SimpleNamespace(score=0.9, retrieve_calls=[], rewrite_calls=[])` 记录器:`score` 是假检索返回的分数,两个列表记下被调用时的参数。
- `def fake_retrieve(question, **kw):` 假检索:记下参数,返回一块 `kb-002#1` 加上 `state.score`。
- `monkeypatch.setattr(docqa_mod, "retrieve", fake_retrieve)` 把 `docqa` 模块里的 `retrieve` 换成假的。
- `qa = DocQA(client)  # type: ignore[arg-type]` `FakeClient` 不是真正的 `LLMClient`,编辑器会标红,用 `type: ignore` 告诉类型检查器「我知道,是测试」。
- `assert client.calls == 0 and spy.retrieve_calls == []` 寒暄不该碰模型,也不该碰检索。
- `assert len(qa.history) == 2  # 但拒答要进历史,下一轮才知道上一句没答上` 拒答的问答要进历史,但寒暄不进。两条规则不一样。
- `assert t.cite.unknown == ["kb-002#9"] and t.cite.ok == ["kb-002#1"]` 假模型编了 `kb-002#9`,核对要把它归进 `unknown`。
- `assert all("<资料>" not in m["content"] for m in qa.history)` 历史里任何一条都不该有 `<资料>` 标签,那是拼 prompt 时才有的。
- `assert spy.rewrite_calls == []  # 第一轮没历史,不改写` 第一轮没有指代,不该调改写。
- `assert spy.retrieve_calls[-1]["queries"] == ["那年付的呢", "年付套餐是否支持退款"]` 第二轮传给检索的 `queries` 第一条是原话,第二条是假改写返回的。

</div>

```bash
uv run python -m pytest part04/test_docqa.py -v
```

```text
============================= test session starts ==============================
platform darwin -- Python 3.12.13, pytest-9.1.1, pluggy-1.7.0 -- /Users/你/agent-zero-lab/.venv/bin/python
cachedir: .pytest_cache
rootdir: /Users/你/agent-zero-lab
configfile: pyproject.toml
plugins: anyio-4.15.1
collecting ... collected 5 items

part04/test_docqa.py::test_small_talk_touches_nothing PASSED             [ 20%]
part04/test_docqa.py::test_low_score_refuses_without_calling_model PASSED [ 40%]
part04/test_docqa.py::test_fake_citation_is_stripped PASSED              [ 60%]
part04/test_docqa.py::test_history_keeps_text_only PASSED                [ 80%]
part04/test_docqa.py::test_followup_rewrites_and_passes_queries PASSED   [100%]

============================== 5 passed in 1.57s ===============================
```

5 个全过。说明一下:`from part04.docqa import DocQA` 会顺带 import `part04.retrieve`,而它在 import 时会连 Postgres 并建 BM25 索引,所以这组测试不连模型、不花钱,但数据库要开着。想彻底脱离数据库,得把 `retrieve.py` 的初始化挪进函数里,这是后面重构的事。运行用 `python -m pytest`,会把当前目录加进搜索路径,`part04` 才找得到;直接敲 `pytest` 在这个项目结构下会报 `ModuleNotFoundError: No module named 'part04'`,要在 `pyproject.toml` 里配 `pythonpath`。

测试要能抓住问题才有用。把 `docqa.py` 里的拒答条件临时改成 `hits[0][1] < 0`(阈值失效),再跑一遍:

```text
.F
=================================== FAILURES ===================================
_________________ test_low_score_refuses_without_calling_model _________________
spy = namespace(score=0.005, retrieve_calls=[{'k': 4, 'history': [{'role': 'user', 'content': '你们有学生优惠吗'}, {'role': 'assistant', 'content': '年付按剩余整月退款。[kb-002#1]'}], 'queries': ['你们有学生优惠吗']}], rewrite_calls=[])
    def test_low_score_refuses_without_calling_model(spy):
        spy.score = 0.005
        client = FakeClient()
        qa = DocQA(client)  # type: ignore[arg-type]
        t = qa.ask("你们有学生优惠吗")
>       assert t.kind == "refused" and t.answer == REFUSAL
E       AssertionError: assert ('answer' == 'refused'
E         
E         - refused
E         + answer)
part04/test_docqa.py:62: AssertionError
=========================== short test summary info ============================
FAILED part04/test_docqa.py::test_low_score_refuses_without_calling_model - A...
!!!!!!!!!!!!!!!!!!!!!!!!!! stopping after 1 failures !!!!!!!!!!!!!!!!!!!!!!!!!!!
1 failed, 1 passed in 1.61s
```

低分拒答那条测试红了,`kind` 是 `answer` 而不是 `refused`。改回来再跑,恢复全绿。

</details>

### 练习 2:把每一道不完美的题归到一个原因里

读 `docqa_results.jsonl`,把每道不完美的题归进:检索根本没找到、找到了但排名靠后、多篇题只找到一部分、被误拒、答案漏了要点、该拒没拒、引用不合格。不调接口。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex270_2.py  练习 2:成绩单只给了总数,把每一道不完美的题归到一个原因里(检索没找到 / 排名靠后 / 被阈值误拒 / 答案漏了要点 / 该拒没拒)。不调接口,读 docqa_results.jsonl
import json
from collections import defaultdict
from pathlib import Path

rows = [json.loads(l) for l in Path("data/eval/docqa_results.jsonl").read_text(encoding="utf-8").splitlines()]
buckets: dict[str, list[str]] = defaultdict(list)

for r in rows:
    should_answer = r["kind"] in ("answerable", "followup")
    if should_answer and r["reply_kind"] == "refused":
        buckets["被阈值或模型误拒"].append(f"{r['id']} {r['question']}(最高分 {r['top']:.3f})")
        continue
    if r["kind"] == "unanswerable" and r["reply_kind"] != "refused":
        buckets["该拒没拒"].append(f"{r['id']} {r['question']}")
    if should_answer and r["docs"]:
        rank = next((i for i, d in enumerate(r["docs"], 1) if d in r["expected_docs"]), None)
        if rank is None:
            buckets["检索根本没找到"].append(f"{r['id']} {r['question']}")
        elif rank > 1:
            buckets["找到了但排名靠后"].append(f"{r['id']} {r['question']}(第 {rank} 篇)")
        missing = [d for d in r["expected_docs"] if d not in r["docs"]]
        if rank and missing:
            buckets["多篇题只找到了一部分"].append(f"{r['id']} {r['question']}(缺 {missing})")
    judge = r.get("judge")
    if judge and not all(judge["covered"]):
        buckets["答案漏了要点"].append(f"{r['id']} {r['question']}(漏 {judge['covered'].count(False)}/{len(judge['covered'])} 个)")
    if r["cite_bad"]:
        buckets["引用不合格"].append(f"{r['id']} {r['cite_bad']}")

for name in ["检索根本没找到", "找到了但排名靠后", "多篇题只找到了一部分", "被阈值或模型误拒", "答案漏了要点", "该拒没拒", "引用不合格"]:
    items = buckets.get(name, [])
    print(f"{name}:{len(items)} 道")
    for it in items:
        print(f"    {it}")
```

<div class="line-notes">

- `from collections import defaultdict` 带默认值的字典。
- `buckets: dict[str, list[str]] = defaultdict(list)` 访问不存在的键时自动建一个空列表,所以直接 `buckets["某原因"].append(...)`,不用先判断有没有这个键。
- `should_answer = r["kind"] in ("answerable", "followup")` 该答的两类。
- `if should_answer and r["reply_kind"] == "refused":` 先处理误拒。
- `continue` 被拒答的题没有回答可看,跳到下一题,不再检查后面的项。
- `if r["kind"] == "unanswerable" and r["reply_kind"] != "refused":` 没答案却没拒。
- `rank = next((i for i, d in enumerate(r["docs"], 1) if d in r["expected_docs"]), None)` 第一篇期望文章排第几,一篇都没有就是 `None`。
- `missing = [d for d in r["expected_docs"] if d not in r["docs"]]` 期望的文章里没检索到的有哪些。
- `if rank and missing:` `rank` 不是 `None` 才说明至少找到了一篇,这时还缺的才算「只找到一部分」。
- `judge = r.get("judge")` 只有真回答了的单轮题才有裁判结果。
- `judge['covered'].count(False)` 布尔列表里有几个 `False`,就是漏了几个要点。
- `items = buckets.get(name, [])` 没出现过的原因返回空列表,这样每个原因都会打印,没有就是 0 道。

</div>

```text
检索根本没找到:0 道
找到了但排名靠后:2 道
    q17 买错了能把钱要回来吗(第 2 篇)
    f04 怎么申请(第 2 篇)
多篇题只找到了一部分:1 道
    q26 导入流水支持哪些银行,文件编码有要求吗(缺 ['kb-011'])
被阈值或模型误拒:1 道
    q19 老板想看所有账但不能让他改(最高分 0.006)
答案漏了要点:2 道
    q17 买错了能把钱要回来吗(漏 2/2 个)
    q26 导入流水支持哪些银行,文件编码有要求吗(漏 1/2 个)
该拒没拒:0 道
引用不合格:0 道
```

四道题(q17 和 q26 各占了两个类别,所以下面一共七行)里,没有一道是「检索根本没找到」,也没有一道「该拒没拒」,引用 0 个不合格。问题全在中间层:rerank 排序(q17、f04 第 2 篇)、多篇题缺一篇(q26)、阈值误拒(q19)。和上面分析的一致:生成层几乎没毛病,毛病在它上游。q17 同时出现在「排名靠后」和「漏要点」两类里,一道题可以有多个原因。

</details>

### 练习 3:把踩过的坑做成回归用例

把这三天踩过的六个坑做成一份回归用例文件和一个脚本,每次改了 `citations.py`、`small_talk.py` 或 `kb_jail.py` 都跑一遍,几秒钟出结果,出错时退出码是 1。

<details><summary>参考答案</summary>

先生成用例文件:

```python
# agent-zero-lab/part04/make_regression.py  练习 3:这三天踩过的坑,每个做成一条以后每次改代码都要过的回归用例
import json
from pathlib import Path

CASES = [
    {"id": "r1", "what": "带事由的问候不能当寒暄", "text": "你好,我想退款", "check": "small_talk_is_none"},
    {"id": "r2", "what": "纯寒暄要拦住", "text": "好的谢谢", "check": "small_talk_is_reply"},
    {"id": "r3", "what": "合并写的引用要认出来", "text": "按剩余整月退款,已开票要先红冲。[kb-002#1, kb-003#2]", "check": "cites_both"},
    {"id": "r4", "what": "全角括号的引用要认出来", "text": "按剩余整月退款。【kb-002#1】", "check": "cites_one"},
    {"id": "r5", "what": "不存在的块要被标成不合格", "text": "审批在一个工作日内完成。[kb-002#9]", "check": "cites_unknown"},
    {"id": "r6", "what": "路径穿越要被锁拦下", "text": "../fake_home/secret.txt", "check": "jail_blocks"},
]
Path("data/eval/regression.jsonl").write_text("\n".join(json.dumps(c, ensure_ascii=False) for c in CASES) + "\n", encoding="utf-8")
print(f"写入 {len(CASES)} 条")
```

<div class="line-notes">

- `CASES = [` 六条用例,每条有 `id`、`what`(这条测什么,人看的)、`text`(输入)、`check`(用哪个检查函数)。
- `{"id": "r1", "what": "带事由的问候不能当寒暄", "text": "你好,我想退款", "check": "small_talk_is_none"},` Day 269 里真的误伤过的那句。
- `{"id": "r3",` 这一条的输入是 `按剩余整月退款,已开票要先红冲。[kb-002#1, kb-003#2]`,合并写的引用,检查项 `cites_both`。
- `{"id": "r6", "what": "路径穿越要被锁拦下", "text": "../fake_home/secret.txt", "check": "jail_blocks"},` Day 268 的路径锁。

</div>

再写运行脚本:

```python
# agent-zero-lab/part04/regression.py  跑回归用例。不调接口、不花钱,几秒钟跑完,每次改了 citations / small_talk / kb_jail 之后都跑一遍
import json
from pathlib import Path

from part04.ex269_1_fix import check_v2
from part04.kb_jail import JailError, resolve_inside
from part04.small_talk import small_talk

GIVEN = {"kb-002#1", "kb-003#2"}


def check(case: dict) -> bool:
    t, c = case["text"], case["check"]
    if c == "small_talk_is_none":
        return small_talk(t) is None
    if c == "small_talk_is_reply":
        return small_talk(t) is not None
    rep = check_v2(t, GIVEN)
    if c == "cites_both":
        return rep.ok == ["kb-002#1", "kb-003#2"]
    if c == "cites_one":
        return rep.ok == ["kb-002#1"]
    if c == "cites_unknown":
        return rep.unknown == ["kb-002#9"]
    if c == "jail_blocks":
        try:
            resolve_inside(t)
        except JailError:
            return True
        return False
    raise ValueError(f"不认识的检查项 {c}")


cases = [json.loads(l) for l in Path("data/eval/regression.jsonl").read_text(encoding="utf-8").splitlines()]
failed = [c for c in cases if not check(c)]
for c in cases:
    print(f"{'失败' if c in failed else '通过'}  {c['id']}  {c['what']}")
print(f"{len(cases) - len(failed)}/{len(cases)} 通过")
raise SystemExit(1 if failed else 0)  # 退出码 1,CI 或 git hook 才知道红了
```

<div class="line-notes">

- `from part04.ex269_1_fix import check_v2` 用 Day 269 练习 1 里修好的核对函数,能认合并写、全角、大写。
- `from part04.kb_jail import JailError, resolve_inside` 路径锁。
- `def check(case: dict) -> bool:` 一条用例过没过。
- `t, c = case["text"], case["check"]` 元组赋值,一行取两个字段。
- `if c == "small_talk_is_none":` 按 `check` 字段分发,每种检查几行。
- `return rep.ok == ["kb-002#1", "kb-003#2"]` 比较的是识别出的合格引用,顺序也要对。
- `resolve_inside(t)` 路径锁的判断函数,不读文件,只判断范围。
- `raise ValueError(f"不认识的检查项 {c}")` 用例文件里写错了 `check` 名字时直接报错,不要默默当通过。
- `failed = [c for c in cases if not check(c)]` 没过的用例。
- `raise SystemExit(1 if failed else 0)  # 退出码 1,CI 或 git hook 才知道红了` Python 脚本退出时的状态码,0 表示成功,非 0 表示失败。CI 或 git 钩子靠它判断红绿,只打印「失败」两个字,机器是看不懂的。

</div>

```bash
uv run python -m part04.make_regression
uv run python -m part04.regression
```

```text
通过  r1  带事由的问候不能当寒暄
通过  r2  纯寒暄要拦住
通过  r3  合并写的引用要认出来
通过  r4  全角括号的引用要认出来
通过  r5  不存在的块要被标成不合格
通过  r6  路径穿越要被锁拦下
6/6 通过
```

6 条全过。以后每次改动,先跑它,红了就别提交。把「每踩一个坑就加一条」变成习惯,这份文件就是项目的免疫系统。用例要尽量小而具体,不要把整段对话塞进去。

</details>

### 练习 4:上线以后每 1000 次提问大概花多少钱

按题型算平均花费,再按一个假设的流量比例加权,算每 1000 次提问的成本。再估一下 `k` 从 4 提到 8 会多花多少。不调接口。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex270_4.py  练习 4:上线以后每 1000 次提问大概花多少钱?按题型算平均花费,再按一个假设的流量比例加权。不调接口,读 docqa_results.jsonl
import json
from collections import defaultdict
from pathlib import Path

rows = [json.loads(l) for l in Path("data/eval/docqa_results.jsonl").read_text(encoding="utf-8").splitlines()]
by_kind: dict[str, list[float]] = defaultdict(list)
for r in rows:
    by_kind[r["kind"]].append(r["cost"])
avg = {k: sum(v) / len(v) for k, v in by_kind.items()}
for k, v in avg.items():
    print(f"{k:<13}{len(by_kind[k]):>3} 条  平均 ¥{v:.4f}/次  最贵 ¥{max(by_kind[k]):.4f}")

MIX = {"answerable": 0.6, "followup": 0.2, "unanswerable": 0.1, "chitchat": 0.1}  # 假设的流量比例,换成你自己的
per_1000 = 1000 * sum(avg[k] * w for k, w in MIX.items())
print(f"\n假设流量 {MIX}\n每 1000 次提问约 ¥{per_1000:.2f}(回答和改写,不含评估;DeepSeek 价格按 2026 年 10 月)")
CHUNK_TOKENS = 65  # Day 268 练习 5 量过:k=4 时资料部分平均 260 token,折合每块约 65
PRICE_MISS = 2  # 元/百万 token,deepseek-flash 高峰时段输入(缓存未命中),2026 年 10 月查的
extra = 4 * CHUNK_TOKENS  # k 从 4 提到 8,每次多带 4 块
print(f"如果 k 从 4 提到 8,每次多约 {extra} 个输入 token,按未命中缓存算,每 1000 次多 ¥{1000 * extra * PRICE_MISS / 1e6:.2f}")
```

<div class="line-notes">

- `by_kind: dict[str, list[float]] = defaultdict(list)` 按题型收集每题的花费。
- `avg = {k: sum(v) / len(v) for k, v in by_kind.items()}` 字典推导式:每个题型的平均花费。
- `MIX = {"answerable": 0.6, "followup": 0.2, "unanswerable": 0.1, "chitchat": 0.1}  # 假设的流量比例,换成你自己的` 线上流量里各类问题各占多少是个假设,我只是随手定的,没有真实依据。真要估成本,得拿真实日志里的比例。
- `per_1000 = 1000 * sum(avg[k] * w for k, w in MIX.items())` 加权平均乘 1000。
- `CHUNK_TOKENS = 65  # Day 268 练习 5 量过:k=4 时资料部分平均 260 token,折合每块约 65` 常量写明出处。
- `PRICE_MISS = 2  # 元/百万 token,deepseek-flash 高峰时段输入(缓存未命中),2026 年 10 月查的` 价格写明查证时间,以后改价了知道该改哪里。
- `extra = 4 * CHUNK_TOKENS  # k 从 4 提到 8,每次多带 4 块` 
- `1000 * extra * PRICE_MISS / 1e6` 每 1000 次多出的 token 数乘单价再除以一百万。`1e6` 是科学计数法的一百万。

</div>

```text
answerable    26 条  平均 ¥0.0012/次  最贵 ¥0.0025
unanswerable  14 条  平均 ¥0.0003/次  最贵 ¥0.0008
chitchat       4 条  平均 ¥0.0000/次  最贵 ¥0.0000
followup       6 条  平均 ¥0.0016/次  最贵 ¥0.0020

假设流量 {'answerable': 0.6, 'followup': 0.2, 'unanswerable': 0.1, 'chitchat': 0.1}
每 1000 次提问约 ¥1.05(回答和改写,不含评估;DeepSeek 价格按 2026 年 10 月)
如果 k 从 4 提到 8,每次多约 260 个输入 token,按未命中缓存算,每 1000 次多 ¥0.52
```

四类题里,单轮平均 ¥0.0012,追问平均 ¥0.0016(多一次改写),没答案的 ¥0.0003(一半被阈值拦下,花费是 0;另一半进了生成,资料不相关、回答很短,每次不到一分钱),寒暄 ¥0。按我假设的流量比例,每 1000 次提问约 ¥1.05。`k` 从 4 到 8,输入 token 每次多约 260,按高峰时段未命中缓存的价格,每 1000 次多约 ¥0.52,大约是总成本的一半。注意这个估算偏保守:前缀缓存命中时输入价只有 ¥0.04 每百万,不过 RAG 的资料每次都不同,命中的多半只有 system 那一小段。

</details>

### 练习 5(开放题):把 q17 救回来

成绩单里 q17「买错了能把钱要回来吗」的两个要点全漏。把 `k` 从 4 调到 6、8,看检索到的块、答案覆盖的要点、花费各怎么变。再把整张成绩单用 `K=8` 重跑一遍,看有没有别的变化。你会选 `k=4` 还是 `k=8`?

<details><summary>参考答案(示范解法,不是唯一答案)</summary>

```python
# agent-zero-lab/part04/ex270_5.py  练习 5(开放题):成绩单里 q17「买错了能把钱要回来吗」要点没答全。把 k 从 4 调到 6、8,检索到的块、答案覆盖的要点、花费各怎么变
import json
from pathlib import Path

from common.llm import LLMClient
from part04.docqa import DocQA
from part04.docqa_eval import JUDGE

row = next(r for r in map(json.loads, Path("data/eval/rag_eval.jsonl").read_text(encoding="utf-8").splitlines()) if r["id"] == "q17")
judge = LLMClient()
print(row["question"], "要点:", row["answer_points"])
for k in (4, 6, 8):
    qa = DocQA(LLMClient(), k=k)
    t = qa.ask(row["question"])
    material = "\n".join(f"[{c.id}] {c.text}" for c, _ in t.hits)
    msg = f"问题:{row['question']}\n回答:{t.answer}\n资料:\n{material}\n要点:{json.dumps(row['answer_points'], ensure_ascii=False)}"
    j = json.loads(judge.chat([{"role": "system", "content": JUDGE}, {"role": "user", "content": msg}],
                              temperature=0, response_format={"type": "json_object"}).content)
    print(f"k={k}  块 {[c.id for c, _ in t.hits]}")
    print(f"     要点覆盖 {j['covered']}  回答 ¥{t.cost:.4f}  {t.seconds:.1f}s")
```

<div class="line-notes">

- `from part04.docqa_eval import JUDGE` 复用成绩单里那份裁判提示词。import `docqa_eval` 只会定义函数和常量,不会触发跑评估,因为跑评估的部分在 `if __name__ == "__main__":` 里。
- `row = next(r for r in map(json.loads,` `map(json.loads, 行列表)` 把每一行解析成字典,`next(生成器)` 取第一个 `id` 是 `q17` 的。
- `judge = LLMClient()` 判分的客户端,和答题的分开。
- `qa = DocQA(LLMClient(), k=k)` 每个 `k` 一个新的 `DocQA`,历史不串。
- `msg = f"问题:{row['question']}\n回答:{t.answer}\n资料:\n{material}\n要点:{json.dumps(row['answer_points'], ensure_ascii=False)}"` 和成绩单里判分用的格式一样。f-string 外层用双引号,里面取字典值用单引号。
- `print(f"k={k}  块 {[c.id for c, _ in t.hits]}")` 打印这一档检索到的块编号,看 `kb-002#1` 什么时候进来。

</div>

```text
买错了能把钱要回来吗 要点: ['年付按剩余整月比例退款,当月不退', '月付不退当期']
k=4  块 ['kb-003#1', 'kb-002#4', 'kb-002#3', 'kb-003#2']
     要点覆盖 [False, False]  回答 ¥0.0020  1.8s
k=6  块 ['kb-003#1', 'kb-002#4', 'kb-002#3', 'kb-003#2', 'kb-002#2', 'kb-007#1']
     要点覆盖 [False, True]  回答 ¥0.0024  2.5s
k=8  块 ['kb-003#1', 'kb-002#4', 'kb-002#3', 'kb-003#2', 'kb-002#2', 'kb-007#1', 'kb-004#2', 'kb-002#1']
     要点覆盖 [True, True]  回答 ¥0.0028  2.5s
```

`k=4` 时模型手里没有讲规则的 `kb-002#1`,两个要点都漏;`k=6` 进来 `kb-002#2`(月付规则),要点 2 覆盖了;`k=8` 进来 `kb-002#1`(年付规则),两个全对。花费 ¥0.0020、¥0.0024、¥0.0028,每多两块贵约两成。

再把整张成绩单用 `K=8` 跑一遍:

```bash
K=8 uv run python -m part04.docqa_eval
```

```text
检索(32 道该答的)  hit@1 29/32  recall@8 0.984  MRR 0.948
拒答  没答案的拒了 14/14  该答的被误拒 1/32  寒暄正确分流 4/4
引用  真回答了 31 个,带合格引用 31 个,出现不合格引用 0 个
生成(26 道单轮里答了的 25 道)  要点全覆盖 24/25  忠实 25/25
按题型的 hit@1:
  policy     10/10
  error_code 6/6
  colloquial 4/6
  multi      4/4
耗时 中位 1.6s  p90 2.7s  最慢 2.9s
回答花费 平均 ¥0.0009/题  合计 ¥0.0473(含改写,不含判分)  判分 ¥0.0271
```

对比 `k=4` 的成绩单:要点全覆盖从 23/25 变成 24/25,也就是救回了 q17 那一道;检索的 hit@1、MRR、recall 完全不变(`k` 影响的是给模型看多少块,不改变排序);拒答、引用、忠实都不变;平均花费差不多(¥0.0009 对 ¥0.0009,取整后看不出来,判分那一栏变化只是 q17 判分内容长了)。

所以数据支持 `k=8`:多一道要点救回、没有任何指标变差。我的选择仍是先保持 `k=4`、不急着改,理由有三个。一,这次提升只有一道题,在 50 道题的评估集里可能是噪声,同样的设置再跑一次,可能变成 23/25 或 25/25;二,练习 4 的估算显示 `k=8` 每 1000 次多约 ¥0.52,大约是总成本的一半,要用一道题换一半的成本不划算;三,q17 的真正问题是 rerank 把「怎么申请退款」排在「退款规则」前面,调大 `k` 只是绕过它,更好的办法是让排序本身更准,比如给规则类文章加元数据权重,或补一条口语化的问法进检索词。这是留给你的方向。

</details>

**验收标准:**

- `docqa_eval.py` 跑通,成绩单里的数字你自己能解释每一项的含义,也能说出它不能证明什么。
- 四道不完美的题,你能说出每一道出在哪一步。
- 不看文章,在纸上画出第四部分的六块知识地图,每块写出至少三个知识点和对应的天数。
- 20 道面试题里挑 5 道,自己讲两三分钟,讲的时候带着至少一个这个项目里量过的数字。
- 项目说明那段话改成你自己的数字,并保留「已知局限」一句。
- `part04/test_docqa.py` 5 条全绿,`regression.py` 6 条全过。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 成绩单 | 一次完整评估跑出来的一组指标,放在一张表里。用法是对比前后两次,不是证明系统有多好 |
| 开发集 / 测试集 | 开发集是调参、改规则时反复看的题,测试集是留着最后验收、调参时没看过的题。今天只有一批题,两者没分开,数字偏乐观 |
| 要点覆盖 | 一道题预先写好几个「好回答必须包含的点」,裁判看回答里体现了几个 |
| 忠实 | 回答里的事实,资料里都能找到,没有凭空添加 |
| 文章级 recall / 块级 recall | 文章级只看期望文章有没有被检索到;块级要看具体讲这个知识点的那一块有没有。文章级的 recall 会掩盖块级的问题(q17) |
| 并发(threading) | 多个线程同时做事。调 API 主要在等网络,开几个线程同时发请求能快几倍。共用的状态(比如账本)要小心 |
| 海象运算符 `:=` | 在表达式里一边赋值一边使用。`(rk := first_rank(r))` |
| 回归用例 | 以前踩过的坑做成的固定测试,每次改代码都跑一遍,保证老问题不会回来 |
| 退出码(exit code) | 程序结束时返回给系统的一个数,0 是成功,非 0 是失败。CI 和 git 钩子靠它判断红绿 |
| fixture / monkeypatch | pytest 里的两个工具:fixture 是测试前准备好的东西,monkeypatch 临时替换某个对象,测试结束后自动恢复 |
| 知识地图 | 把一个阶段学过的东西按它们之间的关系画成图。画得出来才算真的串起来了 |

## 常见误区

**把成绩单当成系统水平的证明。** 考卷和调参用的是同一批题,评估集只有 50 道,裁判是同一家的模型。它是一把可以反复用的尺子,不是证书。

**只看总分。** 「29/32」看着很好,但三道没中的都是口语题,按题型拆开 colloquial 只有 4/6。

**生成层指标差一点,就去改提示词。** 成绩单里生成只差 2 道,根子全在检索(rerank 看不懂口语、文章写法和问法不一致)。改提示词救不了检索不到的东西。

**文章级 recall 高就觉得检索没问题。** recall@4 是 0.984,但 q17 的规则块排在第 8,文章是命中的、块没命中。

**并发测成本时共用一个账本。** 4 个线程同时跑,每一轮「结束时账本减开始时账本」会把别的线程的花费也算进来,我第一版跑出来合计是 ¥0.1875,真实总数是 ¥0.0724。每个并发任务用自己的客户端。

**拿一次的结果当结论。** q17 在 `k=8` 时被救回,只是一道题;再跑一次可能变,别拿它去做「`k=8` 更好」的论断。

**只写「做了 RAG」,不写局限。** 面试官最想听的是你知道哪里不好、怎么验证的。项目说明里留一句「已知局限」。

**坑清单只在脑子里。** 每踩一个坑,就加一条回归用例。没有变成测试的教训,下个月又会再踩一次。

## 学习资料

### 文档与文章

- [Hamel Husain · Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/):做 AI 产品为什么要建评估、怎么从看数据开始,和今天「成绩单是一把尺子」的态度一致。
- [Anthropic · Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval):给每个块前面补上下文再做 embedding 和 BM25,官方实测把检索失败率降了很多,对应 q26 这类「块脱离了上下文就看不懂」的问题。
- [Lost in the Middle(arXiv 2307.03172)](https://arxiv.org/abs/2307.03172):模型对放在上下文中间的信息利用得更差,解释了为什么 `k` 大了不一定更好。
- [Eugene Yan · Patterns for Building LLM-based Systems & Products](https://eugeneyan.com/writing/llm-patterns/):把评估、RAG、护栏、缓存等做法分成几个模式讲,读它能把第四部分放进更大的图里。
- [Anthropic · Citations](https://docs.anthropic.com/en/docs/build-with-claude/citations):接口原生的引用功能,对照我们手写的引用核对。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1PLe3zrEZ9&autoplay=0&high_quality=1" title="【RAG面试题系列】AI大模型·面试通关11问,一口气刷完!涨薪必备!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI大模型全栈 · 【RAG面试题系列】AI大模型·面试通关11问,一口气刷完! · 111 分钟的长视频,不用一次看完,每次挑两三道,先自己答再对照,和今天的 20 道面试题配着用。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1b69gB5E3h&autoplay=0&high_quality=1" title="面试官问:如何评估RAG系统的效果?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI深度幻觉 · 面试官问:如何评估RAG系统的效果? · 12 分钟,把检索指标、生成指标怎么量讲了一遍,今天的成绩单就是一个具体例子。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/MZgTC-VDP0A" title="I Was Given a Broken RAG Chatbot Application in an AI Interview to Debug" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Think in Models · I Was Given a Broken RAG Chatbot Application in an AI Interview to Debug · 英文,开自动字幕,一个面试场景:拿到一个坏掉的 RAG 聊天机器人现场排查,和今天「分层排查」的思路对照着看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/beVPEvMkjwE" title="Why Your RAG Chatbot Fails (and How to Evaluate It)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>CodeStoa · Why Your RAG Chatbot Fails (and How to Evaluate It) · 英文,讲 RAG 聊天机器人为什么答不好以及怎么评估,可以拿它的失败原因清单对着今天的归因表查缺漏。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):评估、RAG、Agent 的章节,把今天做的「成绩单」和「分层排查」放在系统层面讲。
- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly,2024):第四部分里语义搜索、rerank 和 RAG 部分的图解可以拿来补直觉。

### 开源项目与代码

- [explodinggradients/ragas](https://github.com/explodinggradients/ragas):RAG 评估框架,可以对照今天自己写的成绩单,看它多了哪些指标。
- [anthropics/anthropic-cookbook](https://github.com/anthropics/anthropic-cookbook):里面有 RAG、引用、评估的完整例子,读它怎么组织评估。

## 自测

1. 成绩单里「没答案的拒了 14/14」这个数字,为什么不能直接当作「系统不会编」的证据?

<details><summary>答案</summary>

这 14 道题,和调阈值、写拒答规则、写寒暄规则用的是同一批题,开发集和测试集没分开,数字偏乐观;而且只有 14 道,换一批题拦下的比例大概率会低。它的用途是当一把尺子,改了代码前后对比。

</details>

2. q17 的 recall@4 看着没问题(文章命中了),要点却两个全漏。为什么?怎么发现的?

<details><summary>答案</summary>

文章级的 recall 只看期望文章有没有被检索到,`kb-002` 里有 `kb-002#4`、`kb-002#3` 命中,所以算命中;但真正讲规则的是 `kb-002#1`,排在第 8,`k=4` 够不着。发现靠把检索到的块编号打印出来,以及裁判逐要点判的覆盖结果。`k=8` 时它进来了,要点覆盖恢复。

</details>

3. 并发跑 50 道题时,用一个共用的 `LLMClient` 统计成本,为什么会算多?

<details><summary>答案</summary>

`Turn.cost` 是「这一轮开始和结束时账本总数的差」,4 个线程同时在跑,别的线程在这一轮期间产生的花费也记进了同一本账,会被算到当前这一轮头上。每个任务用自己的客户端,各记各的账,合计才对得上。

</details>

4. 回归用例和单元测试(练习 1)各适合防什么?

<details><summary>答案</summary>

单元测试用假的检索和假的模型,专门测流程规则(「寒暄不调模型」「拒答要进历史」),防的是改代码时无意改坏了逻辑;回归用例是踩过的具体坑做成的输入输出对(「你好,我想退款」不能当寒暄),防的是老问题再回来。前者按代码结构组织,后者按坑组织。

</details>

5. (面试题)你的 RAG 项目成绩单:生成指标差一点,检索指标看着很高。下一步你怎么定位问题?

<details><summary>答案</summary>

不先改提示词。把每道不完美的题逐个看:检索到的块里有没有答案在。文章级 recall 高可能掩盖块级问题,要看具体的块编号和排名。分几种情况:块排名靠后(调 `k`、改 rerank、改写);块根本没找到(补文档、换问法检索);块在却答错(才是生成的问题,看资料是否冲突、prompt 是否约束)。每改一处,用同一批题复测,并跑多次区分噪声。

</details>

6. (面试题)讲讲你这个项目的局限。

<details><summary>答案</summary>

评估集小,而且调参和测试用的是同一批题;裁判是同一家的模型;题是自己写的,不是真实用户日志;口语题 hit@1 4/6,rerank 看不懂绕弯的说法;文章写法和问法不一致时检索不到(q26)。改进按代价排:先补没看过的题和真实日志,再看排序和 `k`,最后才碰生成。

</details>

## 明天预告

[Day 271](/blog/agent-zero/day-271-mcp-why/):MCP 是什么,每个应用都在重复接线。第四部分到今天结束,我们的文档问答 Agent 有自己的检索工具、自己的 `get_article`、自己的记忆和 harness,每一个都是手写、手接的。第五部分从一个问题开始:如果另一个团队也想用你的检索,另一个客户端也想调你的工具,每一对都要重新写一遍适配吗?MCP 是业界给的一个答案。
