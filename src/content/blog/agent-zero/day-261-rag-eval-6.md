---
title: 'Day 261 · RAG 评估(六):用评估集做实验,RAGAS 和其他框架'
description: '有了检索和生成两个评估脚本,今天拿它们做第一次正式实验:先原样跑两遍看噪声,再只把 k 从 4 改成 8,结果 q17 变对、输入 token 多了 46%。然后装 RAGAS 0.4.3 对照着打分,它的 context_recall 一眼抓到 q17「文章对了、块没拿到」,faithfulness 却比我们的裁判严得多,同一道题连跑 5 次还能在 0.25 和 0.8 之间跳。'
pubDate: 2026-10-23
regime: none
tags: ['rag-evaluation', 'ragas', 'python', 'agent-zero']
series: 'agent-zero'
day: 261
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 260](/blog/agent-zero/day-260-rag-eval-5/) 写了生成评估脚本 `eval_generation.py`,让大模型当裁判,分三件事判:忠实、完整、拒答。30 道题 86 次调用七分钱,结果是忠实 26/26、完整 24/26、拒答 4/4。判「不完整」的两道题,打开明细里的 `chunks` 一看都是检索的问题:q26 是讲编码的 kb-011 整篇没被检索到,q17 是 kb-002 这篇文章在,写着退款规则的那两块不在。

最后留了个问题:q17 把 k 从 4 加到 8 就判完整了,那是不是就该把 k 改成 8?只看一道题说不清,得在全部 30 道题上量。今天就做这件事,顺便看看 RAGAS 这类现成框架是怎么打分的。

## 今天要解决的问题

学完你应该能做到:

1. 说清楚「做实验」和「改一改看看」差在哪,守住四条纪律:先测噪声、一次只改一个变量、记实验日志、看失败清单而不只看分数。
2. 写出 `part04/experiment.py`:一次跑完检索评估和生成评估,结果追加进 `data/eval/experiments.jsonl`,并打印哪些题变对了、哪些变错了。
3. 在单独的项目里装好 RAGAS 0.4.3,用它的 `context_recall` 和 `faithfulness` 给同一批结果打分,说出它和我们自己写的裁判哪里一样、哪里不一样。
4. 能回答面试里那句「你们用 RAGAS 吗,为什么」。

预计用时 2.5 小时。API 花费:主线三次实验按高峰价合计约 ¥0.21,RAGAS 打两次全量分最多约 ¥0.7(算式见下文),练习约 ¥0.1。我是夜里跑的,DeepSeek 空闲时段半价,实际扣得更少。价格按 2026 年 10 月查到的 [DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):deepseek-flash 高峰时段输入缓存命中 0.04 元、未命中 2 元、输出 8 元每百万 token,北京时间工作日 9–12 点、14–18 点以外半价。

前置:[Day 257](/blog/agent-zero/day-257-rag-eval-3/) 的评估集 `data/eval/rag_eval.jsonl`;[Day 259](/blog/agent-zero/day-259-rag-eval-4/) 的 `evaluate(mode, k, rows)` 和练习 4 里给评估集算指纹的办法;[Day 260](/blog/agent-zero/day-260-rag-eval-5/) 的 `run_one`、`client`;[Day 10](/blog/agent-zero/day-010-uv-1/) 用 `uv init --no-package` 建项目;[Day 67](/blog/agent-zero/day-067-async-2/)–[68](/blog/agent-zero/day-068-async-3/) 的 `async`/`await` 和 `asyncio.gather`。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `experiment.py` 的 `main()`;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 实验和「改一改看看」差在哪

上周我们一直在看分数。比如 Day 259 的检索评估里,vector 的 hit@1 是 1.000,hybrid 是 0.923。很多人看到这里就会去把检索改成纯向量,然后在群里说「我们换了个检索方式,效果好了 8 个点」。

这句话有三个地方经不起问。差的 0.077 是两道题,两道题的差距换几道题、多跑一次可能就没了;检索好了,最后回答有没有变好,没量;换检索方式时如果顺手还改了别的(比如提示词),到底是谁的功劳也说不清。

**实验**就是把这三件事堵上的一套做法。说白了就是前端做 A/B 测试那一套搬过来:同一批用户(评估集),只改一处(一个变量),两边都量(检索和生成都跑),结果写下来(实验日志),最后看具体哪些用户行为变了(失败清单),而不是只看转化率涨没涨。

具体到我们这里是四条纪律:

**先测噪声。** 什么都不改,原样跑两次,看分数自己会晃多少。生成和裁判都是大模型,同样的输入不保证同样的输出,[Day 112](/blog/agent-zero/day-112-sampling-2/) 演示过 `temperature=0` 也会变。不知道噪声有多大,后面任何差别都没法判断是真是假。

**一次只改一个变量。** 今天要改的是 k。改 k 的那次实验,检索方式、提示词、评估集都不能动。

**记实验日志。** 每次跑完自动追加一行:什么时候、用的哪版评估集、什么配置、各项分数、哪些题失败、花了多少 token。几周以后你会忘了「上次那个 0.92 是怎么来的」,日志不会。

**看失败清单,不只看分数。** 完整率从 24/26 涨到 25/26,具体是哪道题变对了?有没有原来对的变错了?一道变对一道变错,总分不变,可系统已经变了。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="一次实验的流程:配置只改一个变量,跑检索评估和生成评估,写入实验日志,和基线比对失败清单">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="30" width="120" height="56" rx="6" fill="none" stroke="var(--ink-soft)"/>
<text x="80" y="54" fill="var(--ink)" text-anchor="middle">配置</text>
<text x="80" y="72" fill="var(--ink-soft)" text-anchor="middle" font-size="11">只改 k: 4 → 8</text>
<rect x="190" y="14" width="150" height="40" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="265" y="38" fill="var(--ink)" text-anchor="middle">检索评估 evaluate</text>
<rect x="190" y="64" width="150" height="40" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="265" y="88" fill="var(--ink)" text-anchor="middle">生成评估 run_one</text>
<line x1="140" y1="52" x2="190" y2="34" stroke="var(--rule)"/>
<line x1="140" y1="64" x2="190" y2="84" stroke="var(--rule)"/>
<rect x="390" y="30" width="230" height="56" rx="6" fill="none" stroke="var(--ink-soft)"/>
<text x="505" y="52" fill="var(--ink)" text-anchor="middle">experiments.jsonl 追加一行</text>
<text x="505" y="70" fill="var(--ink-soft)" text-anchor="middle" font-size="11">评估集指纹 · 分数 · 失败题 · token</text>
<line x1="340" y1="34" x2="390" y2="52" stroke="var(--rule)"/>
<line x1="340" y1="84" x2="390" y2="64" stroke="var(--rule)"/>
<rect x="390" y="130" width="230" height="56" rx="6" fill="none" stroke="var(--ink-soft)"/>
<text x="505" y="152" fill="var(--ink)" text-anchor="middle">和基线比失败清单</text>
<text x="505" y="170" fill="var(--ink-soft)" text-anchor="middle" font-size="11">变对了 [q17] · 变错了 []</text>
<line x1="505" y1="86" x2="505" y2="130" stroke="var(--rule)"/>
<rect x="20" y="130" width="320" height="56" rx="6" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="180" y="152" fill="var(--ink)" text-anchor="middle">先原样跑两次基线</text>
<text x="180" y="170" fill="var(--ink-soft)" text-anchor="middle" font-size="11">差别小于噪声的,不算数</text>
<line x1="340" y1="158" x2="390" y2="158" stroke="var(--rule)"/>
<text x="20" y="225" fill="var(--ink-faint)" font-size="11">蓝:大模型侧(生成+裁判)  琥珀:检索侧(向量库/BM25/rerank)  虚线:每次换配置前都要有的基线</text>
</g>
</svg>
<figcaption>一次实验的样子。配置里只动一处,两个评估脚本都跑,结果自动进日志,最后拿失败清单和基线逐题对。</figcaption>
</figure>

## 第一步:写实验脚本,原样跑两次基线

`experiment.py` 不写新的评估逻辑,只是把 Day 259 的 `evaluate` 和 Day 260 的 `run_one` 串起来,再加上「记日志」和「跟上一次比」。新建 `part04/experiment.py`:

```python
# agent-zero-lab/part04/experiment.py  一次实验:同一份评估集,检索评估+生成评估一起跑,结果追加进实验日志,并和上一次比
"""用法(在 agent-zero-lab/ 下):
  uv run python -W ignore -m part04.experiment baseline-1 hybrid+rerank 4 "基线,第一次"
"""
import hashlib
import json
import sys
from datetime import datetime

from part04.eval_generation import client, run_one
from part04.eval_retrieval import evaluate
from part04.eval_set import EVAL_PATH, load_eval_set

LOG = EVAL_PATH.parent / "experiments.jsonl"
RUNS = EVAL_PATH.parent / "runs"


def gen_failed(r: dict) -> bool:
    return "error" in r or any(r.get(key) is False for key in ("faithful", "complete", "refused"))


def last_entry() -> dict | None:
    if not LOG.exists():
        return None
    lines = [line for line in LOG.read_text(encoding="utf-8").splitlines() if line.strip()]
    return json.loads(lines[-1]) if lines else None


def main() -> None:
    name, mode, k, note = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
    rows = load_eval_set()
    summary, failures = evaluate(mode, k, rows)

    RUNS.mkdir(exist_ok=True)
    detail = RUNS / f"{name}.jsonl"
    detail.write_text("", encoding="utf-8")
    results = []
    for row in rows:
        r = run_one(row, mode, k)
        with detail.open("a", encoding="utf-8") as f:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
        results.append(r)

    answerable = [r for r in results if r["answerable"]]
    entry = {
        "name": name,
        "time": datetime.now().isoformat(timespec="seconds"),
        "eval_sha1": hashlib.sha1(EVAL_PATH.read_bytes()).hexdigest()[:8],
        "mode": mode,
        "k": k,
        "note": note,
        "recall": summary["ALL"][f"recall@{k}"],
        "faithful": sum(r.get("faithful") is True for r in answerable),
        "complete": sum(r.get("complete") is True for r in answerable),
        "refused": sum(r.get("refused") is True for r in results if not r["answerable"]),
        "retrieval_fail": [f[0] for f in failures],
        "gen_fail": [r["id"] for r in results if gen_failed(r)],
        "avg_answer_chars": round(sum(len(r["answer"]) for r in results) / len(results)),
        "prompt_tokens": client.ledger.prompt_tokens,
        "cost": round(client.ledger.cost, 4),
    }
    prev = last_entry()
    with LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    print(f"{name}: {mode} k={k}  recall={entry['recall']}  忠实 {entry['faithful']}/{len(answerable)}"
          f"  完整 {entry['complete']}/{len(answerable)}  拒答 {entry['refused']}/{len(results) - len(answerable)}")
    print(f"  生成失败 {entry['gen_fail']}  回答平均 {entry['avg_answer_chars']} 字"
          f"  输入 {entry['prompt_tokens']} tokens  ¥{entry['cost']}")
    if prev:
        if prev["eval_sha1"] != entry["eval_sha1"]:
            print(f"  ⚠ 评估集变了({prev['eval_sha1']} → {entry['eval_sha1']}),和 {prev['name']} 的分数不能直接比")
        now_ok = sorted(set(prev["gen_fail"]) - set(entry["gen_fail"]))
        now_bad = sorted(set(entry["gen_fail"]) - set(prev["gen_fail"]))
        print(f"  对比 {prev['name']}: 变对了 {now_ok}  变错了 {now_bad}")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `"""用法(在 agent-zero-lab/ 下):` 四个参数:实验名、检索方式、k、一句备注。实验名会变成明细文件名,备注写「改了什么、为什么」,以后翻日志全靠它。`-W ignore` 是 Day 259 起就加的,压掉 jieba 的一条无关警告。
- `import hashlib` 算评估集指纹用,[Day 259](/blog/agent-zero/day-259-rag-eval-4/) 练习 4 用过同一招。
- `from part04.eval_generation import client, run_one` 直接拿 Day 260 的 `run_one`(检索、生成、裁判一条龙)和它模块里那个 `client`。用同一个 `client`,`client.ledger` 才能把这次实验所有调用的 token 都记在一个账本上。
- `from part04.eval_retrieval import evaluate` Day 259 的检索评估,返回 `(summary, failures)`。
- `LOG = EVAL_PATH.parent / "experiments.jsonl"` 实验日志,和评估集同在 `data/eval/`。一次实验一行,JSONL 格式([Day 39](/blog/agent-zero/day-039-json/) 讲过),追加写不怕覆盖。
- `RUNS = EVAL_PATH.parent / "runs"` 每次实验的逐题明细放这里,一次实验一个文件。日志只记汇总,要查某道题的回答就去明细里翻。
- `def gen_failed(r: dict) -> bool:` 一道题在生成层算不算失败:裁判出错算,三个裁判里任何一个判 False 也算。
- `return "error" in r or any(r.get(key) is False for key in ("faithful", "complete", "refused"))` `any(...)` 只要有一个是真就返回 True,相当于 JS 的 `arr.some(...)`。这里用 `is False` 而不是 `not r.get(key)`:无答案题没有 `faithful` 这个键,`r.get("faithful")` 是 `None`,`not None` 是 True,会被误判成失败;`None is False` 是 False,就不会。
- `def last_entry() -> dict | None:` 读日志的最后一行,也就是上一次实验,用来比较。第一次跑时日志还不存在,返回 `None`。
- `lines = [line for line in LOG.read_text(encoding="utf-8").splitlines() if line.strip()]` 读全部行,顺手扔掉空行。日志就几十行,整个读进来没问题。
- `name, mode, k, note = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]` 四个参数一个都不能少,少了直接 `IndexError`。我故意不给备注默认值,逼自己每次写一句。
- `summary, failures = evaluate(mode, k, rows)` 先跑检索评估,不花钱,四五秒。
- `detail.write_text("", encoding="utf-8")` 同名实验重跑时先清空明细。
- `r = run_one(row, mode, k)` 每道题检索、生成、裁判。30 道题一共 86 次调用,和 Day 260 一样。
- `with detail.open("a", encoding="utf-8") as f:` 每道题判完就追加一行,中途断网也不白花钱,Day 260 讲过。
- `answerable = [r for r in results if r["answerable"]]` 26 道有答案的题,忠实和完整只在它们上面算。
- `"eval_sha1": hashlib.sha1(EVAL_PATH.read_bytes()).hexdigest()[:8],` 评估集文件内容的指纹,取前 8 位。实跑是 `2f801e53`。评估集改一个字,指纹就变。
- `"recall": summary["ALL"][f"recall@{k}"],` 检索层只记总体 recall。注意 k=8 时这里存的是 recall@8,和 recall@4 不是同一个指标,后面会说这个坑。
- `"faithful": sum(r.get("faithful") is True for r in answerable),` 数判 True 的题数。`sum` 一串布尔值,True 当 1。记题数不记百分比,题数好核对。
- `"retrieval_fail": [f[0] for f in failures],` `failures` 里每项是 `(题号, 问题, 期望, 实际)`,`f[0]` 取题号。
- `"gen_fail": [r["id"] for r in results if gen_failed(r)],` 生成层失败的题号。后面「变对了、变错了」就靠它。
- `"avg_answer_chars": round(sum(len(r["answer"]) for r in results) / len(results)),` 回答平均多少字。k 变大以后回答会不会变啰嗦,看这一项。
- `"prompt_tokens": client.ledger.prompt_tokens,` 这次实验所有调用的输入 token,包括生成和裁判。k 越大,生成和忠实裁判的输入都会变长。
- `"cost": round(client.ledger.cost, 4),` `LLMClient` 按 `.env` 里 `LLM_PRICE` 算的钱,配的是高峰价,已经考虑了缓存命中。
- `prev = last_entry()` 一定要在追加之前读,不然读到的是自己。
- `if prev["eval_sha1"] != entry["eval_sha1"]:` 评估集换过版本就大声提醒:两次分数不能直接比。Day 257 说过这件事,这里让脚本替你记着。
- `now_ok = sorted(set(prev["gen_fail"]) - set(entry["gen_fail"]))` 集合相减([Day 25](/blog/agent-zero/day-025-sets/)):上次失败、这次不失败的,就是「变对了」。
- `now_bad = sorted(set(entry["gen_fail"]) - set(prev["gen_fail"]))` 反过来就是「变错了」。这一行比总分重要。

</div>

先什么都不改,跑两次基线。在 `agent-zero-lab/` 下:

```bash
uv run python -W ignore -m part04.experiment baseline-1 hybrid+rerank 4 "基线,第一次"
uv run python -W ignore -m part04.experiment baseline-2 hybrid+rerank 4 "基线,原样再跑一次,看噪声"
```

<div class="line-notes">

- `baseline-1 hybrid+rerank 4 "基线,第一次"` 和 Day 260 主线一样的配置:混合检索加 rerank,k=4。备注里有空格或逗号时要加引号,不然终端会拆成好几个参数。
- `baseline-2 hybrid+rerank 4` 一字不改再跑一次,只有名字和备注不同。

</div>

```text
baseline-1: hybrid+rerank k=4  recall=0.981  忠实 26/26  完整 24/26  拒答 4/4
  生成失败 ['q17', 'q26']  回答平均 142 字  输入 29638 tokens  ¥0.0619
baseline-2: hybrid+rerank k=4  recall=0.981  忠实 26/26  完整 24/26  拒答 4/4
  生成失败 ['q17', 'q26']  回答平均 148 字  输入 29830 tokens  ¥0.0638
  对比 baseline-1: 变对了 []  变错了 []
```

每次大约 2 分钟。两次的分数一模一样,失败的还是 q17 和 q26。看起来很稳?回答平均字数一个 142 一个 148,说明回答其实变了。练习 3 会去逐题比,先说结果:30 道题里 **16 道的回答文字不一样**,检索到的块 30 道全一样,裁判结论一道没变。

这就是今天的噪声底线:在这份评估集和这个模型上,原样重跑,总分不动,一半的回答措辞会变。所以后面的实验里,总分差一两道题我会去看明细确认,不会直接下结论。噪声大小是这一次量出来的,换模型、换题目都要重新量。

## 第二步:只改一个变量,k 从 4 改成 8

Day 260 练习 4 只在 q17 一道题上试了 k=8。现在在全部 30 道题上试:

```bash
uv run python -W ignore -m part04.experiment k8 hybrid+rerank 8 "只把 k 从 4 改成 8"
```

```text
k8: hybrid+rerank k=8  recall=0.981  忠实 26/26  完整 25/26  拒答 4/4
  生成失败 ['q26']  回答平均 155 字  输入 43441 tokens  ¥0.0851
  对比 baseline-2: 变对了 ['q17']  变错了 []
```

一条一条读。

**变对了 q17,没有变错的。** 打开 `data/eval/runs/k8.jsonl` 找 q17,`chunks` 里多了 `kb-002#2` 和 `kb-002#1`,回答第一段就是「年付套餐中途取消的,按剩余的整月数比例退款……月付套餐不支持中途退款」。和 Day 260 单题试出来的一样,规则块进来,模型就答出来了。

**q26 没救回来。** k=8 时 q26 拿到的 8 块里还是没有 kb-011。Day 259 就发现过,讲编码的那篇在 rerank 之后排不进前 10。加大 k 救不了排得太靠后的东西,它得在检索那边修。

**recall 一直是 0.981,看起来没变。** 这里有个坑:k=8 那行存的是 recall@8,基线存的是 recall@4,名字一样、意思不一样,不能放一起比。而且它是**文章级**的,q17 在 k=4 时 kb-002 这篇已经在了,recall 本来就是 1。检索层的数字对 q17 这种块级问题是瞎的,这也是为什么要两个脚本一起跑。

**代价:输入多了 46%,回答长了一点。** 输入 token 从 29830 涨到 43441,(43441 − 29830) / 29830 ≈ 46%。钱从 ¥0.0638 涨到 ¥0.0851,涨了 33%,比 token 涨得少,是因为裁判的系统提示词那段命中了缓存。回答平均 148 字涨到 155 字。这还只是评估,线上每个用户问题都要多付这么多。

那改不改?我的结论是**先不改**,写进日志备注里:「k=8 修好 q17,代价是输入多近一半;q17 的病根是 rerank 把规则块排低了,更对症的修法应该在检索层,k=8 先作为备选。」一道题的改善,换来所有题的成本上涨,值不值要看 q17 这类口语题在线上占多少,这个评估集回答不了。

你可能会问,为什么不同时把 rerank 也换了,一次多试几样。因为那样 q17 变对了,你就说不清是 k 的功劳还是 rerank 的功劳。慢一点,每次一个。

## 日志长什么样,还有一个过拟合的坑

跑完三次,`data/eval/experiments.jsonl` 有三行,第一行是这样:

```text
{"name": "baseline-1", "time": "2026-10-22T23:52:18", "eval_sha1": "2f801e53", "mode": "hybrid+rerank", "k": 4, "note": "基线,第一次", "recall": 0.981, "faithful": 26, "complete": 24, "refused": 4, "retrieval_fail": ["q26"], "gen_fail": ["q17", "q26"], "avg_answer_chars": 142, "prompt_tokens": 29638, "cost": 0.0619}
```

JSONL 机器读着方便,人看着累。练习 2 会把它打成 Markdown 表格,贴进周报或 MR 描述里正好。日志文件和评估集一样要进 git,它是你「为什么现在 k=4」的证据。

还有一个坑,今天没踩但迟早会踩:**对评估集过拟合**。q17 修好了,q26 还红着,很自然就想围着 q26 改:给提示词加一句「如果用户问编码,要说 UTF-8」。分数马上满了,线上效果却一点没变,因为你只是把答案写进了提示词。评估集是考卷,反复对着那几道错题改,分数会越来越好看,考的东西越来越少。办法是三条:改动要讲得出对所有题都成立的道理;定期往评估集里补新题,特别是线上真实用户问的;留一小份平时不看的题,隔一阵才跑一次。最后这份叫留出集(held-out set),[Day 354](/blog/agent-zero/day-354-testset-size/) 讲测试集要多大时会细讲。

## RAGAS 是什么,和我们自己写的对得上吗

你在 JD 和面试里大概率会听到 RAGAS。它是一个开源的 RAG 评估框架,最早出自 2023 年的论文 [《RAGAS: Automated Evaluation of Retrieval Augmented Generation》](https://arxiv.org/abs/2309.15217),提出了几个后来很流行的指标。2026 年 10 月我查到的 PyPI 最新版是 0.4.3,发布于 2026 年 1 月;GitHub 仓库已经从 `explodinggradients/ragas` 迁到 [`vibrantlabsai/ragas`](https://github.com/vibrantlabsai/ragas),最后一次提交在 2026 年 2 月。更新慢下来了,这一点后面选不选它时要考虑。

**框架**在这里的意思和前端说的框架差不多:别人把常用的指标写好了,你按它的格式喂数据,它给你分数。好处是省事、指标定义大家都认;坏处是里面怎么算的你得自己去翻。

它最常被提起的四个指标,和我们这几天写的对一下:

| RAGAS 指标 | 判什么 | 需要什么 | 我们这边最像的 |
| --- | --- | --- | --- |
| context_recall | 标准答案里的每句话,能不能在检索到的资料里找到 | 问题、检索到的资料、参考答案 | Day 259 的 recall@k,但我们按**文章 id** 比,它让大模型按**内容**判 |
| context_precision | 检索到的资料里,有用的排在前面没有 | 问题、资料、参考答案 | Day 256 的 precision 和 MRR |
| faithfulness | 回答里的每条陈述,能不能从资料推出 | 问题、回答、资料 | Day 260 的忠实裁判,但它先把回答**拆成一条条陈述**再逐条判 |
| answer_relevancy | 回答是不是在答这个问题 | 问题、回答 | 没有完全对应的,完整裁判有点像 |

看第一行就知道它能帮我们什么:我们的 recall 按文章 id 比,q17 拿到了 kb-002 的块就算找到了;RAGAS 的 context_recall 拿参考答案里的话去资料里找,规则块不在,它就该给低分。今天就验证这件事。

## 第三步:装 RAGAS,先踩两个依赖的坑

照常理,在 `agent-zero-lab/` 里 `uv add ragas` 就行。我试了,命令成功了,装上的却是 **ragas 0.3.1**,不是最新的 0.4.3,而且一句提示都没有。0.3 和 0.4 的接口差别很大,照着 0.4 的文档写代码会处处报错。

为什么?强制要 0.4.3 试一下就知道了:

```bash
uv add "ragas>=0.4.3"
```

```text
  × No solution found when resolving dependencies:
  ...
         And because openai>=3.36.1 depends on jiter>=0.16.0 and instructor>=1.13.0,<=1.16.0 depends on openai>=2.0.0,<3.0.0, we can conclude that all of:
  ...
         And because your project depends on openai>=3.36.1 and ragas>=0.4.3, we can conclude that your project's requirements are unsatisfiable.
```

中间省略了好几十行,意思是:ragas 0.4.3 依赖一个叫 instructor 的库,instructor 最新版要求 `jiter<0.15`,而我们项目里的 openai 3.36 要求 `jiter>=0.16`。两边要同一个包的不同版本,装不到一起。uv 退而求其次,找了一个不依赖 instructor 的老版本 ragas,就是 0.3.1。这和 npm 里两个包要同一个依赖的不同大版本差不多,区别是 npm 可以在 `node_modules` 里各装一份,Python 一个环境里同名包只能有一个版本。

**办法是给 RAGAS 单独建一个项目**,不要往 `agent-zero-lab` 里塞。评估框架依赖重(这次装了将近 100 个包,包括 langchain 全家),隔离开也干净。先撤掉刚才的改动(如果你已经 `uv add ragas` 成功了,用 `uv remove ragas` 撤掉),然后在家目录下:

```bash
cd ~
uv init --no-package ragas-play --python 3.12
cd ragas-play
uv add ragas python-dotenv
uv run python -c "import ragas; print(ragas.__version__)"
```

<div class="line-notes">

- `cd ~` 和 `agent-zero-lab` 放在同一层,后面脚本用 `../agent-zero-lab/` 去读那边的文件。
- `uv init --no-package ragas-play --python 3.12` 和 [Day 10](/blog/agent-zero/day-010-uv-1/) 建练习仓库一样,`--no-package` 不能少。
- `uv add ragas python-dotenv` 新项目里没有 openai 3.36 这条限制,uv 就会给 openai 选 3.3.0,ragas 能装上 0.4.3。`python-dotenv` 用来读 `.env`。
- `uv run python -c "import ragas; print(ragas.__version__)"` 装完先验一下能不能 import。我就是在这一步踩到第二个坑的。

</div>

```text
Traceback (most recent call last):
  ...
  File ".../ragas/llms/base.py", line 12, in <module>
    from langchain_community.chat_models.vertexai import ChatVertexAI
ModuleNotFoundError: No module named 'langchain_community.chat_models.vertexai'
```

RAGAS 0.4.3 一 import 就去导入 langchain-community 里的一个模块,而 2026 年 5 月发布的 langchain-community 0.4.2 把这个模块删了。RAGAS 从 1 月起就没再发版,没跟上。解法是把 langchain-community 钉在上一个版本:

```bash
uv add "langchain-community==0.4.1"
uv run python -c "import ragas; print(ragas.__version__)"
```

```text
0.4.3
```

这两个坑说明了框架的一个真实成本:**它的依赖会和你的项目打架,会随着上游更新坏掉**。我们自己写的评估脚本只依赖 openai,这种事就不会发生。

## 第四步:把实验明细导出成 RAGAS 要的格式

RAGAS 的指标要四个字段:`user_input`(问题)、`retrieved_contexts`(检索到的资料原文,字符串列表)、`response`(回答)、`reference`(参考答案)。我们的明细里有问题和回答,资料只记了块 id,参考答案在评估集的 `answer_points` 里。在 `agent-zero-lab` 写个小脚本拼好,存成 JSONL,让 `ragas-play` 去读。新建 `part04/export_ragas.py`:

```python
# agent-zero-lab/part04/export_ragas.py  把一次实验的明细转成 RAGAS 要的四个字段,给另一个项目 ragas-play 用
"""用法(在 agent-zero-lab/ 下):uv run python -m part04.export_ragas baseline-1"""
import json
import sys

from part04.chunking import load_chunks
from part04.eval_set import EVAL_PATH, load_eval_set

CHUNKS = {c.id: c.text for c in load_chunks()}
POINTS = {r["id"]: r["answer_points"] for r in load_eval_set()}


def main() -> None:
    name = sys.argv[1]
    src = EVAL_PATH.parent / "runs" / f"{name}.jsonl"
    out = EVAL_PATH.parent / "runs" / f"{name}.ragas.jsonl"
    n = 0
    with src.open(encoding="utf-8") as f, out.open("w", encoding="utf-8") as g:
        for line in f:
            r = json.loads(line)
            if not r["answerable"]:
                continue
            sample = {
                "id": r["id"],
                "user_input": r["question"],
                "response": r["answer"],
                "retrieved_contexts": [CHUNKS[cid] for cid in r["chunks"]],
                "reference": ";".join(POINTS[r["id"]]),
            }
            g.write(json.dumps(sample, ensure_ascii=False) + "\n")
            n += 1
    print(f"{n} 条 → {out}")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from part04.chunking import load_chunks` 切块函数是确定性的,同样的文章切出来的块 id 和正文永远一样,所以明细里只存 id 就能还原原文。
- `CHUNKS = {c.id: c.text for c in load_chunks()}` 字典推导式,块 id → 块正文,42 块。`c.text` 是带「文章标题 > 小节名」前缀的那份,和当时塞给模型的一样。
- `POINTS = {r["id"]: r["answer_points"] for r in load_eval_set()}` 题号 → 要点列表。
- `with src.open(encoding="utf-8") as f, out.open("w", encoding="utf-8") as g:` 一个 `with` 同时开两个文件,一读一写,出了 `with` 两个都会关。
- `if not r["answerable"]:` 无答案题没有参考答案,context_recall 没法算,跳过。4 道无答案题的拒答我们自己判过了。
- `"retrieved_contexts": [CHUNKS[cid] for cid in r["chunks"]],` 块 id 换回正文,顺序保持当时的排名。
- `"reference": ";".join(POINTS[r["id"]]),` 要点列表拼成一句话当参考答案。q17 的是 `年付按剩余整月比例退款,当月不退;月付不退当期`。RAGAS 本意是要一段完整的标准答案,我们只有要点,够它拆句用了。

</div>

```bash
uv run python -m part04.export_ragas baseline-1
uv run python -m part04.export_ragas k8
```

```text
26 条 → /Users/你/agent-zero-lab/data/eval/runs/baseline-1.ragas.jsonl
26 条 → /Users/你/agent-zero-lab/data/eval/runs/k8.ragas.jsonl
```

## 第五步:用 RAGAS 打分

RAGAS 0.4 的新写法是:先用 `llm_factory` 包一个大模型客户端,再把它交给每个指标。它内部用 instructor 让模型按 pydantic 模型输出结构化结果(和 [Day 150](/blog/agent-zero/day-150-structured-4/) 我们自己写的 `extract` 是一个思路),走的是 OpenAI 兼容协议,所以 DeepSeek 能直接用。指标的打分方法是 `async` 的。

在 `ragas-play/` 下新建 `ragas_eval.py`:

```python
# ragas-play/ragas_eval.py  用 RAGAS 0.4 的两个指标给一次实验打分:context_recall(检索层)、faithfulness(生成层)
"""用法(在 ragas-play/ 下):
  uv run python ragas_eval.py ../agent-zero-lab/data/eval/runs/baseline-1.ragas.jsonl q17,q26
"""
import asyncio
import json
import os
import sys

from dotenv import load_dotenv
from openai import AsyncOpenAI
from ragas.llms import llm_factory
from ragas.metrics.collections import ContextRecall, Faithfulness

load_dotenv("../agent-zero-lab/.env")
client = AsyncOpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
usage = {"calls": 0, "prompt": 0, "completion": 0}
_create = client.chat.completions.create


async def counted_create(*args, **kwargs):
    resp = await _create(*args, **kwargs)
    usage["calls"] += 1
    if resp.usage:
        usage["prompt"] += resp.usage.prompt_tokens
        usage["completion"] += resp.usage.completion_tokens
    return resp


client.chat.completions.create = counted_create  # type: ignore[method-assign]
llm = llm_factory(os.environ["LLM_MODEL"], client=client, max_tokens=4096,
                  extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY", "{}")))
recall = ContextRecall(llm=llm)
faithful = Faithfulness(llm=llm)


async def score(s: dict) -> tuple[float, float]:
    r = await recall.ascore(user_input=s["user_input"], retrieved_contexts=s["retrieved_contexts"],
                            reference=s["reference"])
    f = await faithful.ascore(user_input=s["user_input"], response=s["response"],
                              retrieved_contexts=s["retrieved_contexts"])
    return r.value, f.value


async def main() -> None:
    path = sys.argv[1]
    only = set(sys.argv[2].split(",")) if len(sys.argv) > 2 else None
    samples = [json.loads(line) for line in open(path, encoding="utf-8")]
    samples = [s for s in samples if only is None or s["id"] in only]
    scores = await asyncio.gather(*(score(s) for s in samples))
    for s, (r, f) in zip(samples, scores):
        print(f"{s['id']}  context_recall={r:.2f}  faithfulness={f:.2f}  {s['user_input']}")
    n = len(scores)
    print(f"平均 context_recall={sum(r for r, _ in scores) / n:.3f}  faithfulness={sum(f for _, f in scores) / n:.3f}  ({n} 题)")
    print(f"--- {usage['calls']} 次调用 | 输入 {usage['prompt']} / 输出 {usage['completion']} tokens")


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `"""用法(在 ragas-play/ 下):` 第二个参数可选,逗号分隔的题号,只打这几道。花钱的东西先拿一两道试。
- `from openai import AsyncOpenAI` openai SDK 的异步版客户端,用法和 `OpenAI` 一样,只是调用方法时前面要加 `await`([Day 67](/blog/agent-zero/day-067-async-2/))。RAGAS 的指标是 `async` 的,要配这个版本。
- `from ragas.metrics.collections import ContextRecall, Faithfulness` 0.4 起推荐从 `ragas.metrics.collections` 导入,老教程里的 `from ragas.metrics import faithfulness`(小写)是 0.1–0.3 的写法,这也是装错版本时最先报错的地方。
- `load_dotenv("../agent-zero-lab/.env")` 直接读练习仓库那份 `.env`,不再复制一份 key。路径是相对当前目录的,所以必须在 `ragas-play/` 下运行。
- `usage = {"calls": 0, "prompt": 0, "completion": 0}` RAGAS 不告诉你花了多少 token,只好自己记。
- `_create = client.chat.completions.create` 先把原来的方法存起来。
- `async def counted_create(*args, **kwargs):` 一个包装函数:参数原样转给原方法,拿到返回以后把 `usage` 加到账上。`*args, **kwargs` 是「收下所有位置参数和关键字参数」,相当于 JS 的 `(...args)`。
- `client.chat.completions.create = counted_create  # type: ignore[method-assign]` 把客户端上的方法换成包装版,这叫 monkeypatch([Day 74](/blog/agent-zero/day-074-pytest-4/) 在测试里用过)。RAGAS 内部的 instructor 会调这个方法,于是每次调用都被记下来。`# type: ignore` 是告诉类型检查器「我知道这里在替换方法」。
- `llm = llm_factory(os.environ["LLM_MODEL"], client=client, max_tokens=4096,` 第一个参数是模型名 `deepseek-flash`。`max_tokens=4096` 是我踩坑以后加的,默认 1024,下面细说。
- `extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY", "{}")))` 把 `.env` 里的 `{"thinking": {"type": "disabled"}}` 传过去,关掉思考模式,和我们自己的 `LLMClient` 保持一致。
- `recall = ContextRecall(llm=llm)` 检索层指标。
- `faithful = Faithfulness(llm=llm)` 生成层指标。两个指标共用一个 `llm`,也就共用一本账。
- `r = await recall.ascore(user_input=s["user_input"], retrieved_contexts=s["retrieved_contexts"],` context_recall 要问题、资料和参考答案,不看回答。
- `f = await faithful.ascore(user_input=s["user_input"], response=s["response"],` faithfulness 要问题、回答和资料,不看参考答案。两个指标各看什么,和 Day 260 三个裁判的分工是一个道理。
- `return r.value, f.value` `ascore` 返回的是 `MetricResult` 对象,分数在 `.value` 里,0 到 1 的小数。
- `samples = [s for s in samples if only is None or s["id"] in only]` 没给题号就全打,给了只打那几道。
- `scores = await asyncio.gather(*(score(s) for s in samples))` 26 道题同时发出去,[Day 68](/blog/agent-zero/day-068-async-3/) 讲过,相当于 JS 的 `Promise.all`。全量一次大约一分多钟。
- `print(f"{s['id']}  context_recall={r:.2f}  faithfulness={f:.2f}  {s['user_input']}")` 每道题两个分数,保留两位小数。
- `if __name__ == "__main__":` 一定要有,因为下一节的 `ragas_why.py` 要 import 这个文件,没有它一 import 就会把全量打分跑一遍。我第一版就没写,import 的时候白跑了一次。

</div>

先拿 q17 一道试:

```bash
uv run python ragas_eval.py ../agent-zero-lab/data/eval/runs/baseline-1.ragas.jsonl q17
```

```text
q17  context_recall=0.00  faithfulness=0.93  买错了能把钱要回来吗
平均 context_recall=0.000  faithfulness=0.929  (1 题)
--- 3 次调用 | 输入 4017 / 输出 1066 tokens
```

**context_recall 是 0。** 我们自己的文章级 recall 给 q17 打的是 1,RAGAS 拿参考答案「年付按剩余整月比例退款,当月不退;月付不退当期」去 4 块资料里找,一句都找不到。Day 260 我们是打开 `chunks` 人工看出来的,它直接给了个数。

3 次调用是 context_recall 1 次、faithfulness 2 次(先拆陈述,再逐条判)。

再全量打 k=4 和 k=8 两次实验。第一次我没加 `max_tokens=4096`,k=4 那次顺利跑完,k=8 那次跑到一半整个程序崩了:

```text
instructor.v2.core.errors.IncompleteOutputException: The output is incomplete due to a max_tokens length limit.
```

k=8 时回答更长,拆出来的陈述更多,模型要输出的 JSON 超过了默认的 1024 个 token,被截断,instructor 解析不了就抛异常。`asyncio.gather` 里任何一个出错,整批都拿不到结果,前面已经花掉的调用也白花了。把 `max_tokens` 调到 4096 以后两次都跑通:

```bash
uv run python ragas_eval.py ../agent-zero-lab/data/eval/runs/baseline-1.ragas.jsonl
uv run python ragas_eval.py ../agent-zero-lab/data/eval/runs/k8.ragas.jsonl
```

两次的输出合在一起,只列和满分不一样的题:

| 题 | k=4 context_recall | k=4 faithfulness | k=8 context_recall | k=8 faithfulness |
| --- | --- | --- | --- | --- |
| q03 这个月被扣了两次钱 | 1.00 | 0.50 | 1.00 | 1.00 |
| q05 怎么申请退款 | 1.00 | 0.93 | 1.00 | 1.00 |
| q09 能开增值税专用发票吗 | 1.00 | 0.78 | 1.00 | 0.71 |
| q16 连续付款失败被锁了 | 1.00 | 0.25 | 1.00 | 1.00 |
| q17 买错了能把钱要回来吗 | **0.00** | 0.94 | **1.00** | 0.85 |
| q19 老板想看所有账但不能让他改 | 1.00 | 0.86 | 1.00 | 0.40 |
| q20 换了手机号收不到验证码 | 1.00 | 0.62 | 1.00 | 0.75 |
| q26 导入流水支持哪些银行,编码 | **0.50** | 0.50 | **0.50** | 0.50 |
| (另有 q01、q06、q12、q18、q23 在某一次低于 1) | | | | |
| 平均(26 题) | 0.942 | 0.897 | 0.981 | 0.904 |

```text
--- 78 次调用 | 输入 99213 / 输出 17601 tokens      (k=4 那次)
--- 78 次调用 | 输入 110199 / 输出 19143 tokens     (k=8 那次)
```

**context_recall 和我们的结论完全对上了。** q17 从 0 变 1,正是 k=8 修好的那道;q26 两次都是 0.5,参考答案两句话,银行那句找得到,编码那句找不到,正是 kb-011 没被检索到。如果当初就有这个指标,q17 的「块级漏检」在检索评估那一步就能看到,用不着等到生成评估再倒推。这是 RAGAS 今天给我们最有用的东西。

**faithfulness 就不太一样了。** 我们的忠实裁判两次都是 26/26,RAGAS 平均只有 0.9 左右,好几道题被扣分,而且同一道题在 k=4 和 k=8 之间跳得厉害(q16 从 0.25 到 1.00,q19 从 0.86 到 0.40)。是它更严,还是它在乱打?得看它到底扣了哪几句。

## 看 RAGAS 为什么扣分

`Faithfulness` 只返回一个分数,不告诉你哪条陈述没过。它内部有两个方法 `_create_statements`(拆陈述)和 `_create_verdicts`(逐条判),下划线开头表示是内部方法,不保证以后的版本还在,拿来排查可以,别写进正式代码。新建 `ragas-play/ragas_why.py`:

```python
# ragas-play/ragas_why.py  看 RAGAS 的 faithfulness 把回答拆成了哪几条陈述、每条判没判过
"""用法:uv run python ragas_why.py ../agent-zero-lab/data/eval/runs/baseline-1.ragas.jsonl q16"""
import asyncio
import json
import sys

from ragas_eval import faithful, usage


async def main() -> None:
    path, qid = sys.argv[1], sys.argv[2]
    s = next(json.loads(line) for line in open(path, encoding="utf-8") if json.loads(line)["id"] == qid)
    statements = await faithful._create_statements(s["user_input"], s["response"])
    verdicts = await faithful._create_verdicts(statements, "\n".join(s["retrieved_contexts"]))
    for v in verdicts.statements:
        print(f"{'✓' if v.verdict else '✗'} {v.statement}\n    理由: {v.reason}")
    print(f"--- {usage['calls']} 次调用 | 输入 {usage['prompt']} / 输出 {usage['completion']} tokens")


asyncio.run(main())
```

<div class="line-notes">

- `from ragas_eval import faithful, usage` 复用上一个文件里配好的指标和账本。因为那边有 `if __name__ == "__main__":`,import 时不会跑全量。
- `s = next(json.loads(line) for line in open(path, encoding="utf-8") if json.loads(line)["id"] == qid)` 找到那一道题。`next(生成器)` 取第一个满足条件的,相当于 JS 的 `arr.find(...)`。每行解析了两次,文件只有 26 行,图省事。
- `statements = await faithful._create_statements(s["user_input"], s["response"])` 第一步:让模型把回答拆成一条条独立的陈述。
- `verdicts = await faithful._create_verdicts(statements, "\n".join(s["retrieved_contexts"]))` 第二步:把资料拼成一段,让模型判每条陈述能不能从资料推出。faithfulness 分数就是判过的条数除以总条数。
- `for v in verdicts.statements:` 每条有 `statement`、`verdict`(1 或 0)、`reason` 三个字段。
- `print(f"{'✓' if v.verdict else '✗'} {v.statement}\n    理由: {v.reason}")` f-string 里套了一个三元表达式,过了打勾,没过打叉。

</div>

```bash
uv run python ragas_why.py ../agent-zero-lab/data/eval/runs/baseline-1.ragas.jsonl q16
uv run python ragas_why.py ../agent-zero-lab/data/eval/runs/baseline-1.ragas.jsonl q26
uv run python ragas_why.py ../agent-zero-lab/data/eval/runs/baseline-1.ragas.jsonl q03
```

q16 的回答是「连续 5 次支付失败会锁定支付功能 1 小时,1 小时后即可再次支付。建议在重新支付前更换银行卡或改用支付宝支付,以免再次触发锁定。」资料原文是「更换银行卡或改用支付宝支付。同一账户连续 5 次支付失败,会锁定支付功能 1 小时。」

```text
✓ 连续 5 次支付失败会锁定支付功能 1 小时。
    理由: 上下文明确说明“同一账户连续 5 次支付失败,会锁定支付功能 1 小时”。
✗ 1 小时后即可再次支付。
    理由: 上下文提到锁定支付功能 1 小时，但未明确说明 1 小时后即可再次支付。
✗ 建议在重新支付前更换银行卡或改用支付宝支付。
    理由: 上下文在支付失败解决办法中建议“更换银行卡或改用支付宝支付”，但未明确说明是在重新支付前。
✗ 更换银行卡或改用支付宝支付可以避免再次触发锁定。
    理由: 上下文未说明更换银行卡或改用支付宝支付可以避免再次触发锁定。
```

四条里只过了一条。「锁 1 小时,1 小时后能再付」是正常人都会推出来的,判它没依据有点抠字眼;最后一条「换卡可以避免再次触发锁定」倒确实是模型自己加的因果,资料里没这么说。我们的裁判对整段回答一次判,这种小推论就放过去了。RAGAS 逐条判,抓得更细,也更容易冤枉人。

q26 的回答后半句是「关于文件编码:帮助中心里没有找到这个问题的说明,建议转人工客服」:

```text
✗ 其他银行请使用模板 [kb-009#1]。
    理由: The context states that for other banks, please use the template, but the citation [kb-009#1] is not present in the context.
✗ 帮助中心里没有找到关于文件编码的说明。
    理由: The context does not mention file encoding or whether it is documented in the help center.
✗ 建议转人工客服。
    理由: The context does not suggest transferring to manual customer service.
```

三个叉都是冤枉的。第一条因为回答里带着引用标记 `[kb-009#1]`,资料里没有这串字,就判没依据;后两条是我们提示词**要求**模型说的话,它不知道这是规矩。Day 260 给我们的裁判专门加过一句「礼貌用语和『建议转人工』这类话不算事实陈述」,RAGAS 的通用提示词里没有这句。

q03 还有个现象:拆出来的陈述和理由是英文的。

```text
✓ If the same subscription is charged twice, the duplicate charge will be fully refunded after verification.
✗ It is recommended to first confirm whether the two charges belong to the same subscription.
✗ It is recommended to contact customer service for verification and handling.
```

RAGAS 的提示词模板是英文写的,模型有时跟着用英文输出。判断本身没错(「先确认是不是同一笔订阅」确实是模型自己加的建议),但你要人工复核时会更费劲。

最后,**它自己也不稳**。q16 同一个回答、同一份资料,k=4 那次全量打分是 0.25;我在没加 `max_tokens` 的那次全量打分里,它是 0.80。练习 4 会把 q16 原样打 5 次,结果是 `[0.25, 0.25, 0.25, 0.8, 0.25]`:拆陈述那一步每次拆得不一样,分母变了,分数就跳。所以 q16 和 q19 在 k=4、k=8 之间的大跳动,大部分是指标自己的噪声,不是 k 带来的。

把这些加起来,我对 RAGAS 在这份数据上的看法是:context_recall 很有用,它补上了我们文章级 recall 看不见的块级漏检,值得长期用;faithfulness 比我们的裁判严,能抓到「换卡可以避免锁定」这种小编造,但会冤枉拒答句和引用标记,还会自己晃,不能直接拿它的平均分当结论,要么改它的提示词,要么只把低分题挑出来人工看。

**钱。** 一次全量 RAGAS 打分 78 次调用(26 题 × 3),输入约 10 万 token、输出约 1.8 万。按高峰价、全部没命中缓存算:99213 × 2 / 10⁶ + 17601 × 8 / 10⁶ ≈ 0.20 + 0.14 = ¥0.34,这是上限。我们自己的整套生成评估,连生成带三个裁判,一次 ¥0.06。只打分不生成,RAGAS 就贵了五倍多,因为它每题调三次,每次都带着长长的英文示例提示词。

## 其他框架,和要不要用

RAGAS 不是唯一的选择。2026 年 10 月我查到的几个常见的:

| 框架 | 是什么 | 2026 年 10 月版本 | 我的看法 |
| --- | --- | --- | --- |
| [DeepEval](https://github.com/confident-ai/deepeval) | 写法像 pytest 的 LLM 评估库,自带 FaithfulnessMetric、ContextualRecallMetric 等几十个指标 | 4.3.1(10 月 16 日) | 更新很勤,想把评估接进 CI、写成测试用例时最顺手 |
| [TruLens](https://github.com/truera/trulens) | 提出「RAG 三角」:上下文相关性、忠实度、回答相关性,带一个看记录的界面 | 2.16.0(10 月 19 日) | 偏可观测,和 tracing 一起用 |
| [promptfoo](https://github.com/promptfoo/promptfoo) | 用 YAML 配置写测试用例,命令行一跑出对比表,Node 写的 | 0.124.1 | 前端同学上手最快,适合比较几版提示词 |
| [Arize Phoenix](https://github.com/Arize-ai/phoenix) | 开源的 LLM 可观测平台,带评估功能 | 20.24.0(10 月 21 日) | 第六部分讲 tracing 时还会遇到同类工具 |

这几个我今天都没装,版本号是查 PyPI 和 npm 得到的。指标名字各家不一样,干的事大同小异:检索层判资料找没找到、排得好不好,生成层判有没有依据、有没有答到点上。今天把 RAGAS 的两个指标拆开看过以后,再看别家的文档会很快,因为你知道每个指标背后就是一两次大模型调用加一个比例。

还有一个常被一起提到的功能:**自动出题**(RAGAS 叫 testset generation)。让大模型读你的文档,自动生成问题、参考答案,还能按类型分(单跳、多跳之类)。Day 257 我们手写了 30 道题,累,但每道都是照着真实用户会怎么问写的,q17「买错了能把钱要回来吗」这种口语题,模型从文档里出题是出不来的,它出的题往往用的就是文档里的原词,检索起来特别容易,分数虚高。我的用法是拿它补数量、找覆盖不到的文章,题目一定要人过一遍,而且线上真实问题永远比它出的题值钱。

那到底用不用框架?我的取舍是这样的:

- 先自己写。像这几天一样把每个指标写一遍、跑一遍,知道它在判什么、会在哪错。不然框架给你一个 0.897,你不知道该信多少。
- 自己的评估脚本做主线,进 CI、每次实验都跑,便宜、可控、依赖少。
- 框架当第二意见。某个指标你自己没有、写起来又麻烦(比如今天的 context_recall),就借它的,单独一个项目装,结果和你的日志放在一起看。
- 换框架、换版本,先拿同一批数据跑一遍,和旧结果对齐了再用。

面试里被问「你们用 RAGAS 吗」,别只答用或不用。说清楚你用了它的哪个指标、它是怎么算的(拆陈述、逐条判、算比例)、在你的数据上发现了什么问题(冤枉拒答句、自己会晃)、你怎么处理的。这比「我们用了 RAGAS,faithfulness 0.9」有说服力得多。

## 今天的文件

| 文件 | 干什么 | 谁会用 |
| --- | --- | --- |
| `agent-zero-lab/part04/experiment.py` | 一次实验:两个评估一起跑,写日志,和上次比 | 以后每次改 RAG 配置 |
| `agent-zero-lab/data/eval/experiments.jsonl` | 实验日志,一次一行 | 进 git,周报和 MR 里引用 |
| `agent-zero-lab/data/eval/runs/<实验名>.jsonl` | 每次实验的逐题明细 | 查某道题为什么变了 |
| `agent-zero-lab/part04/export_ragas.py` | 明细转成 RAGAS 的四个字段 | `ragas-play` |
| `ragas-play/ragas_eval.py`、`ragas_why.py` | RAGAS 打分,看它为什么扣分 | 第二意见 |

## 动手练习

**练习 1:换一个变量做实验。** 把检索方式从 `hybrid+rerank` 换成 `vector`,k 保持 4,用 `experiment.py` 跑一次,名字叫 `vector-k4`。先猜:Day 259 里纯向量的 hit@1 比混合高,生成层会不会也更好?跑完看输出最后一行在和谁比,对不对。

<details><summary>参考答案</summary>

```bash
uv run python -W ignore -m part04.experiment vector-k4 vector 4 "只把检索方式从 hybrid+rerank 换成 vector"
```

<div class="line-notes">

- `vector-k4 vector 4` 只改检索方式,k 还是 4,和 baseline 只差这一处。最后的备注写清楚这次和谁比、改了什么。

</div>

```text
vector-k4: vector k=4  recall=0.981  忠实 25/26  完整 24/26  拒答 4/4
  生成失败 ['q04', 'q17', 'q26']  回答平均 140 字  输入 29624 tokens  ¥0.0788
  对比 k8: 变对了 []  变错了 ['q04', 'q17']
```

最后一行在和 `k8` 比,这是错的。`experiment.py` 总是和日志里上一行比,而上一行恰好是 k=8 那次实验,vector-k4 应该和 k=4 的基线比。和 k8 比,q17 「变错了」完全是假象,它在基线里本来就是错的。练习 2 会修这个问题。

和基线真正的差别是 q04 变成了不忠实。打开 `data/eval/runs/vector-k4.jsonl` 看 q04:裁判说没依据的是回答开头那句总起的话「退款到账时间取决于退款原因和支付方式」,后面的具体时间都对着资料写了。这句是模型自己做的概括,算抠字眼,不是真的编规则。所以结论是:在这份评估集上,纯向量和混合加 rerank 在生成层看不出差别,差的一道是裁判的严格程度,不是检索的问题。Day 259 检索层那 0.077 的优势,传到生成层就没了。

</details>

**练习 2:日志打成表,并指定和谁比。** 写 `part04/ex261_2.py`,把 `experiments.jsonl` 打成 Markdown 表格;再接受两个实验名作参数,打印两者的分数对比和变对、变错的题。用 `baseline-2 vector-k4` 跑一次。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex261_2.py  练习 2:实验日志打成表,并指定和哪一次比(不总是和上一行比)
"""用法:uv run python -m part04.ex261_2 baseline-2 vector-k4"""
import json
import sys

from part04.experiment import LOG

entries = {e["name"]: e for e in map(json.loads, LOG.read_text(encoding="utf-8").splitlines()) if e}
print("| 名字 | 评估集 | 配置 | recall | 忠实 | 完整 | 拒答 | 输入 tokens | ¥ |")
print("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
for e in entries.values():
    print(f"| {e['name']} | {e['eval_sha1']} | {e['mode']} k={e['k']} | {e['recall']} | {e['faithful']}/26"
          f" | {e['complete']}/26 | {e['refused']}/4 | {e['prompt_tokens']} | {e['cost']} |")

base, new = entries[sys.argv[1]], entries[sys.argv[2]]
print(f"\n{new['name']} 对比 {base['name']}:")
for key in ("recall", "faithful", "complete", "refused", "prompt_tokens"):
    print(f"  {key:<14}{base[key]} → {new[key]}")
print("  变对了", sorted(set(base["gen_fail"]) - set(new["gen_fail"])))
print("  变错了", sorted(set(new["gen_fail"]) - set(base["gen_fail"])))
```

<div class="line-notes">

- `from part04.experiment import LOG` 日志路径从正文那个文件拿,不再写一遍。`experiment.py` 有 main guard,import 不会触发实验。
- `entries = {e["name"]: e for e in map(json.loads, LOG.read_text(encoding="utf-8").splitlines()) if e}` 每行解析成字典,按实验名做键。`map(json.loads, ...)` 相当于 JS 的 `lines.map(JSON.parse)`。同名实验跑了两次的话,后面那次会覆盖前面的,正好是想要的。
- `print("| 名字 | 评估集 | 配置 |` 打表头,Markdown 表格就是竖线隔开的文本。
- `{e['faithful']}/26"` 分母写死成 26,是因为四次实验都用同一版评估集。评估集换版本以后要改成从日志里存题数,这是个偷懒的地方。
- `base, new = entries[sys.argv[1]], entries[sys.argv[2]]` 两个参数:基线是谁、新的是谁。比较对象由人指定,不再默认「上一行」。
- `for key in ("recall", "faithful", "complete", "refused", "prompt_tokens"):` 逐项打印「旧 → 新」。
- `print(f"  {key:<14}{base[key]} → {new[key]}")` `:<14` 是左对齐占 14 格,让箭头对齐。
- `print("  变对了", sorted(set(base["gen_fail"]) - set(new["gen_fail"])))` 和 `experiment.py` 里一样的集合相减,只是换成了指定的两次。

</div>

```text
| 名字 | 评估集 | 配置 | recall | 忠实 | 完整 | 拒答 | 输入 tokens | ¥ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline-1 | 2f801e53 | hybrid+rerank k=4 | 0.981 | 26/26 | 24/26 | 4/4 | 29638 | 0.0619 |
| baseline-2 | 2f801e53 | hybrid+rerank k=4 | 0.981 | 26/26 | 24/26 | 4/4 | 29830 | 0.0638 |
| k8 | 2f801e53 | hybrid+rerank k=8 | 0.981 | 26/26 | 25/26 | 4/4 | 43441 | 0.0851 |
| vector-k4 | 2f801e53 | vector k=4 | 0.981 | 25/26 | 24/26 | 4/4 | 29624 | 0.0788 |

vector-k4 对比 baseline-2:
  recall        0.981 → 0.981
  faithful      26 → 25
  complete      24 → 24
  refused       4 → 4
  prompt_tokens 29830 → 29624
  变对了 []
  变错了 ['q04']
```

和基线比,真正的变化只有 q04,和练习 1 的分析一致。这张表可以直接贴进周报。

</details>

**练习 3:噪声到底有多大。** 两次基线的总分完全一样,可回答平均字数一个 142 一个 148。写 `part04/ex261_3.py`,逐题比较 `baseline-1` 和 `baseline-2` 的明细:检索块相同的有几道、回答文字不同的有几道、裁判结论不同的有几道;再挑第一道回答不同的题,打印两次从哪个字开始分叉。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex261_3.py  练习 3:什么都没改的两次运行,明细差多少?
import json
import os

from part04.experiment import RUNS


def load(name: str) -> dict[str, dict]:
    with (RUNS / f"{name}.jsonl").open(encoding="utf-8") as f:
        return {r["id"]: r for r in map(json.loads, f)}


a, b = load("baseline-1"), load("baseline-2")
same_chunks = sum(a[q]["chunks"] == b[q]["chunks"] for q in a)
diff_answer = [q for q in a if a[q]["answer"] != b[q]["answer"]]
diff_verdict = [q for q in a for key in ("faithful", "complete", "refused") if a[q].get(key) != b[q].get(key)]
print(f"检索块完全相同 {same_chunks}/{len(a)}")
print(f"回答文字不同 {len(diff_answer)}/{len(a)}: {diff_answer}")
print(f"裁判结论不同 {diff_verdict}")
q = diff_answer[0]
start = len(os.path.commonprefix([a[q]["answer"], b[q]["answer"]]))
print(f"\n{q} 前 {start} 个字一样,从这里开始分叉:")
print("  第一次:", a[q]["answer"][start:start + 40].replace("\n", " "))
print("  第二次:", b[q]["answer"][start:start + 40].replace("\n", " "))
```

<div class="line-notes">

- `import os` 只为了用 `os.path.commonprefix`。
- `def load(name: str) -> dict[str, dict]:` 读一次实验的明细,按题号做成字典,两次运行按题号对齐。
- `return {r["id"]: r for r in map(json.loads, f)}` 文件对象可以直接逐行迭代,`map(json.loads, f)` 把每行解析成字典。
- `same_chunks = sum(a[q]["chunks"] == b[q]["chunks"] for q in a)` 两个列表用 `==` 比的是内容和顺序,和 JS 里数组 `===` 比引用不一样。实跑 30/30。
- `diff_answer = [q for q in a if a[q]["answer"] != b[q]["answer"]]` 回答文字只要差一个字符就算不同。实跑 16 道。
- `diff_verdict = [q for q in a for key in ("faithful", "complete", "refused") if a[q].get(key) != b[q].get(key)]` 双层推导式,外层题号、内层三个裁判,哪一项结论变了就记下题号。实跑是空列表。
- `start = len(os.path.commonprefix([a[q]["answer"], b[q]["answer"]]))` `commonprefix` 名字里有 path,其实是逐字符比的,对任何字符串都能用,返回两个字符串共同的开头。
- `print("  第一次:", a[q]["answer"][start:start + 40].replace("\n", " "))` 从分叉处往后取 40 个字,换行替换成空格,一行看得清。

</div>

```text
检索块完全相同 30/30
回答文字不同 16/30: ['q01', 'q03', 'q06', 'q07', 'q10', 'q11', 'q13', 'q16', 'q17', 'q18', 'q19', 'q20', 'q21', 'q23', 'q25', 'q26']
裁判结论不同 []

q01 前 120 个字一样,从这里开始分叉:
  第一次: 。以年付专业版 468 元（折合每月 39 元）为例，可退 351 元 [kb-
  第二次:  [kb-002#1]。以年付专业版 468 元（每月 39 元）为例，可退 3
```

检索是确定的,30 道一模一样;生成不是,16 道措辞变了,q01 只是引用标记的位置和「折合」两个字不同。裁判对这种程度的变化很稳,一道都没改判。所以在这份评估集上,两次实验的分数差一两道题时,先打开明细看那几道是真变了还是措辞变了。

</details>

**练习 4:RAGAS 自己稳不稳。** 正文说 q16 的 faithfulness 一次 0.25 一次 0.80。在 `ragas-play/` 下写 `ex261_4.py`,拿 `baseline-1.ragas.jsonl` 里 q16 那一条,原样打 5 次 faithfulness。

<details><summary>参考答案</summary>

```python
# ragas-play/ex261_4.py  练习 4:同一道题、同一个回答,RAGAS faithfulness 连跑 5 次,看分数稳不稳
import asyncio
import json

from ragas_eval import faithful, usage

PATH = "../agent-zero-lab/data/eval/runs/baseline-1.ragas.jsonl"


async def main() -> None:
    s = next(json.loads(line) for line in open(PATH, encoding="utf-8") if json.loads(line)["id"] == "q16")
    values = []
    for _ in range(5):
        r = await faithful.ascore(user_input=s["user_input"], response=s["response"],
                                  retrieved_contexts=s["retrieved_contexts"])
        values.append(round(r.value, 2))
    print("q16 五次:", values)
    print(f"--- {usage['calls']} 次调用 | 输入 {usage['prompt']} / 输出 {usage['completion']} tokens")


asyncio.run(main())
```

<div class="line-notes">

- `from ragas_eval import faithful, usage` 复用配好的指标和账本。
- `s = next(` 取 q16 那一条,输入五次完全一样。
- `for _ in range(5):` 这里故意一次一次 `await`,不用 `gather`,让五次调用互不重叠,排除并发的影响。`_` 表示循环变量用不上。
- `values.append(round(r.value, 2))` 每次的分数保留两位。

</div>

```text
q16 五次: [0.25, 0.25, 0.25, 0.8, 0.25]
--- 10 次调用 | 输入 9563 / 输出 1599 tokens
```

五次里四次 0.25、一次 0.8。四条陈述过一条是 0.25;0.8 那次大概是拆成了五条、过了四条。同样的输入,分母不一样,分数就差了三倍多。所以单题的 RAGAS faithfulness 不能当真,平均分也要知道它带着这么大的噪声。花了约 1 万输入 token,不到两分钱。

</details>

**验收标准:** `experiment.py` 跑出至少三行日志(两次基线、一次改了一个变量);能指着失败清单说出 k=8 修好了哪道题、为什么 q26 修不好、代价是多少 token;`ragas-play` 装好 0.4.3 并跑通 `context_recall`,能解释 q17 在我们的 recall 里是 1、在 RAGAS 里是 0 的原因;能举出 RAGAS faithfulness 冤枉人的一个例子。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 实验(experiment) | 固定评估集,一次只改一处配置,两层都量,结果写进日志,和基线逐题比 |
| 基线(baseline) | 拿来对比的那次运行,通常是当前线上的配置。今天是 hybrid+rerank、k=4 |
| 噪声 | 什么都不改、原样重跑时结果自己的变化。今天测到 30 道里 16 道回答措辞变了,总分没变 |
| 实验日志 | 每次实验一行的记录:时间、评估集指纹、配置、分数、失败题、花费 |
| 过拟合评估集 | 围着评估集里那几道错题改,分数涨了、真实效果没变 |
| 留出集(held-out set) | 平时不看、隔一阵才跑一次的那份题,用来发现过拟合 |
| RAGAS | 开源的 RAG 评估框架,2026 年 10 月最新版 0.4.3,指标有 context_recall、faithfulness 等 |
| context_recall | RAGAS 的检索层指标:参考答案里的每句话,有多少能在检索到的资料里找到 |
| faithfulness(RAGAS) | 先把回答拆成陈述,再逐条判能不能从资料推出,过了的比例就是分数 |
| 依赖冲突 | 两个包要同一个依赖的不同版本,装不到一个环境里。今天是 instructor 和 openai 抢 jiter |
| 自动出题(testset generation) | 让大模型读文档生成评估题。能补数量,但题目偏书面,要人工过 |

## 常见误区

**只看总分不看失败清单。** 两次基线总分一模一样,16 道回答其实变了;vector-k4 总分只少了一道忠实,真正的原因是一句总起话被判严了。分数是入口,明细才是答案。

**不测噪声就比较。** 没跑过两次基线,就不知道差一两道题算不算数。生成和裁判都是大模型,同样的输入会给不同的输出。

**一次改好几处。** 同时换 k 和 rerank,q17 变对了你说不清是谁的功劳。

**k 变了还拿 recall 比。** 基线存的是 recall@4,k=8 那次存的是 recall@8,名字一样意思不同。而且文章级 recall 对 q17 这种块级漏检本来就看不见。

**总是和上一次比。** `experiment.py` 默认和日志上一行比,上一行不一定是你的基线。vector-k4 和 k8 比,q17 被冤枉成「变错了」。

**在练习仓库里直接 `uv add ragas`。** 不报错,装上的是 0.3.1,照着 0.4 的文档写会处处出错。看一眼 `uv pip list | grep ragas` 或者 `ragas.__version__`。

**以为装上了就能用。** RAGAS 0.4.3 配 langchain-community 0.4.2 一 import 就报 `No module named 'langchain_community.chat_models.vertexai'`,要钉 0.4.1。

**RAGAS 的 max_tokens 用默认值。** 默认 1024,回答一长就 `IncompleteOutputException`,而且 `gather` 里一个出错整批白跑。

**把 RAGAS 的 faithfulness 平均分当结论。** 它会把「建议转人工」和引用标记判成没依据,同一道题五次能在 0.25 和 0.8 之间跳。挑低分题人工看,别直接报平均分。

**自动出的题直接当评估集。** 模型出的题爱用文档原词,检索起来特别容易,分数虚高,还漏掉口语问法。

## 学习资料

### 文档与文章

- [RAGAS 文档 · Context Recall](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_recall/):今天用的检索层指标,看它的计算公式和例子,半小时。
- [RAGAS 文档 · Faithfulness](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/faithfulness/):拆陈述、逐条判的完整说明,对照今天 `ragas_why.py` 打出来的结果看。
- [RAGAS 文档 · 指标总览](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/):所有指标的列表,扫一眼知道还有哪些,不用全读。
- [RAGAS 论文(arXiv 2309.15217)](https://arxiv.org/abs/2309.15217):原始论文,看第 3 节三个指标的定义就够了。
- [Hamel Husain · Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/):讲为什么要有评估、怎么一轮轮改进,里面「先看数据」的观点和今天「看失败清单」是一回事,1 小时。
- [Eugene Yan · An LLM-as-Judge Won't Save The Product—Fixing Your Process Will](https://eugeneyan.com/writing/eval-process/):讲评估要嵌进开发流程里,和今天的实验日志是一个思路。
- [DeepEval 文档 · Faithfulness](https://deepeval.com/docs/metrics-faithfulness):另一家框架的同名指标,和 RAGAS 对照着看,会发现做法几乎一样。
- [TruLens · The RAG Triad](https://www.trulens.org/getting_started/core_concepts/rag_triad/):把 RAG 评估拆成三角,和我们的两层拆法对照。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1b69gB5E3h&autoplay=0&high_quality=1" title="面试官问:如何评估RAG系统的效果?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI深度幻觉 · 面试官问:如何评估RAG系统的效果? · 12 分钟,按面试回答的角度把检索指标、生成指标、评估框架串一遍,看完对照自测第 5 题练习怎么答。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Jz421Q7Lw&autoplay=0&high_quality=1" title="如何利用RAGAs评估RAG系统的好坏" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>果粒奶优有果粒 · 如何利用RAGAs评估RAG系统的好坏 · 25 分钟,2024 年的视频,用的是 RAGAS 老版本的写法,重点看前半段对几个指标原理的讲解,代码部分以今天的 0.4 写法为准。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/5fp6e5nhJRk" title="RAGAS: How to Evaluate a RAG Application Like a Pro for Beginners" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Mervin Praison · RAGAS: How to Evaluate a RAG Application Like a Pro for Beginners · 英文入门演示,看他怎么准备 question/contexts/answer/ground_truth 四列数据,和今天导出的四个字段一一对应,开自动字幕。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 4 章「Evaluate AI Systems」:讲怎么设计评估流水线、怎么比较不同配置,和今天的实验纪律是一套思路。

### 开源项目与代码

- [vibrantlabsai/ragas](https://github.com/vibrantlabsai/ragas):RAGAS 现在的仓库,看 `src/ragas/metrics/collections/faithfulness/` 下的 `metric.py` 和 `util.py`,前者是两步流程,后者是那段英文提示词,能看出它为什么会冤枉「建议转人工」。
- [confident-ai/deepeval](https://github.com/confident-ai/deepeval):README 里有和 pytest 结合的例子,想把评估接进 CI 时看。
- [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo):YAML 写用例、命令行出对比表,看 examples 目录里的 RAG 例子。

## 自测

**1. 两次基线总分一模一样,能说明这套系统输出稳定吗?**

<details><summary>答案</summary>

不能。总分一样只说明裁判结论没变。逐题比明细,30 道里 16 道回答文字不同,检索块倒是全一样。生成是有随机性的,只是这次的变化都在措辞层面,没跨过裁判的判断线。测噪声要看明细,不能只看总分。

</details>

**2. k 从 4 改成 8,日志里 recall 都是 0.981,能说明检索层没变吗?**

<details><summary>答案</summary>

不能,有两层原因。第一,k=8 那行存的是 recall@8,基线是 recall@4,是两个不同的指标。第二,我们的 recall 是按文章算的,q17 在 k=4 时 kb-002 这篇就已经在了,recall 本来就是 1;k=8 带来的变化是规则块进来了,这是块级的,文章级指标看不见。RAGAS 的 context_recall 按内容判,q17 从 0 变成了 1,这才反映出了变化。

</details>

**3. 为什么 RAGAS 要单独建一个项目装,而不是装进 agent-zero-lab?**

<details><summary>答案</summary>

依赖冲突。ragas 0.4.3 依赖 instructor,instructor 要求 `jiter<0.15`,而练习仓库里的 openai 3.36 要求 `jiter>=0.16`,装不到一个环境里。`uv add ragas` 不会报错,而是悄悄装上老的 0.3.1。单独一个项目,让 uv 给它挑一套兼容的版本(openai 3.3.0),通过导出的 JSONL 文件交换数据,两边互不影响。

</details>

**4. RAGAS 的 faithfulness 和我们 Day 260 的忠实裁判,做法上差在哪?各有什么毛病?**

<details><summary>答案</summary>

RAGAS 先把回答拆成一条条陈述,再逐条判,分数是过了的比例;我们的裁判整段一次判,只给是或否加一个没依据的清单。RAGAS 更细,能抓到「换卡可以避免再次触发锁定」这种小编造,但会冤枉人:引用标记 `[kb-009#1]`、我们要求模型说的「建议转人工」都被判成没依据,而且拆陈述每次不一样,q16 五次打出 0.25 和 0.8 两种分。我们的裁判稳,但粗,小推论会被放过去。

</details>

**5.(面试题)面试官问:「你们 RAG 的评估是用 RAGAS 做的吗?」你怎么回答?**

<details><summary>答案</summary>

可以这么答:主线评估是自己写的,检索层按文章 id 算 hit@1、recall@k、MRR,生成层用大模型当裁判判忠实、完整、拒答三件事,每次改配置都跑一次实验,一次只改一个变量,结果记进日志,和基线逐题比失败清单。RAGAS 我们当第二意见用,主要用它的 context_recall:它按内容判参考答案在不在检索结果里,能抓到我们文章级 recall 看不见的「文章对了、块没拿到」,有一道口语题就是靠它确认的。它的 faithfulness 我们评估过没采用为主指标,因为它会把引用标记和「建议转人工」这类话判成没依据,同一道题连跑五次分数能差三倍,所以只用它挑低分题人工复查。另外它依赖重、和我们的 openai 版本冲突,是单独一个环境跑的。

</details>

## 明天预告

Day 262 · 上下文工程(一):窗口大不等于该塞满,做预算。RAG 评估这一段到今天结束。今天 k 从 4 改成 8,q17 变好了,输入也多了 46%,这其实已经碰到下一个话题:往模型的窗口里放多少东西才合适。明天从「每次调用窗口里到底装了什么」讲起,把系统提示词、检索资料、对话历史分开算 token,给每一块定上限,超了按轮裁掉,同时不把工具调用拆散。
