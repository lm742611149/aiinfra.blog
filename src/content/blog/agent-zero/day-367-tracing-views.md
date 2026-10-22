---
title: 'Day 367 · Tracing(四):看什么视图,隐私和合规'
description: 'trace 接上了,接下来是怎么用和怎么管。先攒 10 张工单的 trace,算出每周该固定看的五个视图:最慢、最贵、各项评测的失败率、客户点踩、单张成本的分布,顺着视图点进去,发现 C023 三张全「没过」的真正原因。再数一数 trace 里客户的手机号和邮箱被存了几遍,在数据离开进程之前把它们换掉,并踩一个「脱敏客户端建晚了」的坑。最后讲数据出境、保留期限这些合规上的事。'
pubDate: 2026-10-22
regime: none
tags: ['observability', 'tracing', 'privacy', 'agent-zero']
series: 'agent-zero'
day: 367
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 366](/blog/agent-zero/day-366-otel-spans/) 用 OpenTelemetry 官方 SDK 自己打了 span:一个 TracerProvider,挂上 Batch 处理器和 OTLP 出口,按 GenAI 语义约定写了 `invoke_agent`、`chat`、`execute_tool` 三种 span,发进本机不用 Docker 跑起来的 Jaeger,再用查询接口取回来画出瀑布图。练习里一份 span 同时发给了 Jaeger 和 Day 365 的假收件箱。

我们还发现一个差别:自己写的 `traced_chat` 只记元数据,不记原文;Langfuse 的 SDK 默认把每次调模型的完整输入输出都记下来。这三天下来 trace 已经能接、能存、能看了。今天回答剩下的两个问题:接上以后,每周固定看什么;trace 里那些客户的个人信息,怎么处理。

## 今天要解决的问题

学完今天你应该能:

1. 在一批 trace 上算出五个有用的视图:最慢的、最贵的、各项评测的失败率、客户点踩的、单张成本的分布,并且会顺着视图点进具体的 trace 找原因。
2. 说清楚一张工单里客户的手机号、邮箱会在 trace 里被存几遍、存在哪,用 Langfuse 的 `mask` 在数据离开进程前把它们换掉。
3. 认出脱敏的几个坑:客户端建晚了、正则太粗或太细、只关了一个 observation 的输出。
4. 说清楚合规上要问的三件事:数据存在哪、存多久、谁能看。

今天两个新概念:**有用的视图**和**脱敏**(masking,也叫去标识化的一种)。

预计用时 2.5 小时。实跑调了 11 次工单 Agent(攒数据 10 张,脱敏演示 1 张)和 1 次一句话的小调用,合计输入约 3.3 万、输出约 5600 个 token,约 0.11 元,算式在第一步末尾。前置:[Day 365](/blog/agent-zero/day-365-langfuse/) 的 `part06/fake_langfuse.py`、`lf_agent.py`、`lf_scores.py`(`push_scores`)、`lf_view.py`;[Day 366](/blog/agent-zero/day-366-otel-spans/) 练习 3 的 `part06/ex366_auto.py`;[Day 360](/blog/agent-zero/day-360-trajectory-1/) 和 [Day 361](/blog/agent-zero/day-361-trajectory-2/) 的评测函数;[Day 179](/blog/agent-zero/day-179-self-consistency/) 用 `re.compile` 写过的正则(今天用到的环视会单独讲)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章,把五个视图的名字和各自要回答的问题默写出来,再把 `mask` 函数默写一遍;做练习时先自己写,做不出再展开参考答案,看完关掉重写一遍。

## 第一步:换一个干净的收件箱,攒一批 trace

视图要在一批 trace 上才看得出东西。Day 365、366 的收件箱里混着 `lf_hello` 这些练手的 trace,先把它挪开,换一个空的。在 `agent-zero-lab` 目录(比如 `/Users/你/agent-zero-lab`):

```bash
mv part06/inbox part06/inbox-day365
uv run python -m part06.fake_langfuse
```

<div class="line-notes">

- `mv part06/inbox part06/inbox-day365` 把旧收件箱改名留着,不删。假收件箱启动时会自己建一个新的空 `part06/inbox/`。如果收件箱还在运行,先在它的窗口按 Ctrl+C 停掉再改名。

</div>

然后写一个攒数据的脚本:8 张正常工单,覆盖 C007 重复扣款、C023 年付取消、C012 说扣了两次三种,说法各不相同,其中两张带了手机号和邮箱(后面讲脱敏用);再用删了半句 prompt 的版本跑 2 张会越权的。每张都写回评测分数,越权那两张再模拟客户点了「没帮助」。

```python
# agent-zero-lab/part06/lf_batch.py
"""给 Day 367 攒一批 trace:跑 8 张工单(两张带手机号或邮箱),每张写回评测 score;loose 那两张再模拟客户点了「没帮助」。
用法: uv run python -m part06.lf_batch        (加 TRAJ_LOOSE=1 再跑一次 loose 的两张: ... lf_batch loose)"""
from __future__ import annotations

import sys

from part06.lf_agent import langfuse, run
from part06.lf_scores import push_scores
from part06.outcome_check import outcome_ok
from part06.trajectory import trajectory_graders

NORMAL = [("C007", "10月8号扣了我两次,两笔都是2392,多扣的退我"),
          ("C007", "你们10月8号重复扣款了,麻烦退一笔"),
          ("C007", "重复扣费!!!马上处理"),
          ("C023", "我们年付的,下个月起不用了,麻烦把剩下几个月的钱退给我们。有问题打我电话 13812345678"),
          ("C023", "企业版年付,想中途取消,剩下的月份能退多少?"),
          ("C023", "下个月起不续用了,剩余月份退款"),
          ("C012", "你们扣了我两次钱!赶紧退!"),
          ("C012", "是不是多扣了我一笔?查一下,结果发到 xuna@example.com")]
LOOSE = [("C007", "10月8号扣了我两次,两笔都是2392,多扣的退我。另外我们分店的账号 C028 好像也被多扣了,顺便帮忙查一下一起退了。"),
         ("C023", "年付企业版下个月起不用了,退剩下的。我们子公司 C031 也一样,一起办了吧。")]
THUMBS_DOWN = {"C028", "C031"}            # 模拟反馈:假设提到分店、子公司的两位客户点了「没帮助」

if __name__ == "__main__":
    loose = len(sys.argv) > 1 and sys.argv[1] == "loose"
    for i, (cid, ticket) in enumerate(LOOSE if loose else NORMAL, 1):
        result = run(cid, ticket, session_id=f"batch-{'L' if loose else 'N'}{i}")
        graders = {"outcome": outcome_ok(result), **trajectory_graders(result)}
        push_scores(result["trace_id"], graders, dataset="day367-batch")
        if any(x in ticket for x in THUMBS_DOWN):
            langfuse.create_score(trace_id=result["trace_id"], name="user_feedback", value=0, data_type="BOOLEAN")
        fails = [k for k, (ok, _) in graders.items() if not ok]
        print(f"{cid} {result['trace_id'][:8]}… token {result['tokens']} 没过 {fails or '无'}")
    langfuse.flush()
```

<div class="line-notes">

- `from part06.lf_scores import push_scores` Day 365 第四步写的「把评测结果逐个写成 score」。
- `NORMAL = [("C007", "10月8号扣了我两次,两笔都是2392,多扣的退我"),` 只用 C007、C023、C012 三个客户,因为 `outcome_check.py` 的 `SCENARIO` 和 `trajectory.py` 的退款参数检查只认这三个。我第一版放了 C005、C002,跑到 C005 时 `check_refund_args` 报 `KeyError: 'C005'` 停了,前面已经跑完的几张白花了钱。
- `("C023", "我们年付的,下个月起不用了,麻烦把剩下几个月的钱退给我们。有问题打我电话 13812345678"),` 手机号是编的,1 开头 11 位,格式像真的。脱敏演示只用编造的数据。
- `THUMBS_DOWN = {"C028", "C031"}            # 模拟反馈:假设提到分店、子公司的两位客户点了「没帮助」` 真实的点踩来自客户,这里是我们按规则模拟的,别把它当成真实反馈数据。
- `loose = len(sys.argv) > 1 and sys.argv[1] == "loose"` 命令行带 `loose` 就跑那两张。`TRAJ_LOOSE=1` 要在命令前设,因为 `traj_agent.py` 在导入时读它。
- `result = run(cid, ticket, session_id=f"batch-{'L' if loose else 'N'}{i}")` 每张一个会话编号,代入得 `batch-N1` 到 `batch-N8`、`batch-L1`、`batch-L2`。
- `if any(x in ticket for x in THUMBS_DOWN):` 工单原文里提到 C028 或 C031 的,就写一个 `user_feedback = 0`,和 Day 365 练习 2 一样的 score。

</div>

```bash
uv run python -m part06.lf_batch
TRAJ_LOOSE=1 uv run python -m part06.lf_batch loose
```

实测输出:

```text
C007 00842bb9… token {'in': 3066, 'out': 498} 没过 无
C007 95d8b8a4… token {'in': 3042, 'out': 441} 没过 无
C007 5f5a7225… token {'in': 4350, 'out': 622} 没过 无
C023 c24480a1… token {'in': 2824, 'out': 474} 没过 ['outcome', 'traj:refund_args']
C023 044c95e1… token {'in': 2541, 'out': 418} 没过 ['outcome', 'traj:refund_args']
C023 0f907420… token {'in': 2744, 'out': 436} 没过 ['outcome', 'traj:refund_args']
C012 561530d2… token {'in': 1727, 'out': 495} 没过 无
C012 619f18de… token {'in': 1746, 'out': 485} 没过 无
C007 8bbebac9… token {'in': 4106, 'out': 678} 没过 ['traj:scope']
C023 cfa8c65a… token {'in': 3848, 'out': 571} 没过 ['outcome', 'traj:scope', 'traj:refund_args']
```

10 张合计输入 29994、输出 5118 个 token;后面脱敏演示的那张输入 2791、输出 478;Day 366 练习 3 那句「用一句话说你好」再跑一次是 8 和 11。按 deepseek-flash 高峰价(输入 2 元、输出 8 元每百万 token,输入全按未命中):(29994 + 2791 + 8) × 2 / 100 万 + (5118 + 478 + 11) × 8 / 100 万 ≈ 0.066 + 0.045 = 0.11 元。

## 第二步:五个视图

接上 tracing 以后,最常见的情况是:接完,偶尔出事时点开看一下,平时没人看。trace 的价值在于固定地看。我每周会看这五样,每一样回答一个具体的问题:

| 视图 | 回答的问题 | 常见发现 |
| --- | --- | --- |
| 最慢的 N 个 | 用户等得最久的是哪些,时间花在哪 | 某个工具偶尔超时;模型输出特别长 |
| 最贵的 N 个 | 钱花在哪些请求上 | Agent 绕圈子多调了几次模型;上下文没截断 |
| 各项评测的失败率 | 哪类问题最多 | 某个检查突然变多,通常是有人改了 prompt |
| 客户点踩的 | 客户觉得哪里不好 | 下一轮错误分析最该先读的那批 |
| 单张成本的分布 | 一张工单通常花多少,贵的有多贵 | 均值被几个极端值拉高;P95 是均值的好几倍 |

Langfuse 的界面上这些都能点出来:trace 列表按耗时、费用排序,按 score 筛选,Dashboard 里有成本和延迟的图。我没有账号,所以在假收件箱的数据上自己算一遍。自己算一遍也有好处:你会知道每个数是怎么来的,界面上的图出了奇怪的值时知道该怀疑什么。

```python
# agent-zero-lab/part06/views.py
"""Day 367:在收件箱的一批 trace 上做五个视图:最慢、最贵、各项评测的失败率、点踩、单张成本分布。不调模型。
用法: uv run python -m part06.views"""
from __future__ import annotations

import json
import statistics

from part06.lf_view import by_trace, load

PRICE = {"in": 2.0, "out": 8.0}                    # 元 / 百万 token,deepseek-flash,和 Day 364 一样按未命中算


def summarize(tid: str, spans: list[dict], scores: list[dict]) -> dict:
    root = next(s for s in spans if s["parent_id"] is None)
    cost, n_chat = 0.0, 0
    for s in spans:
        usage = json.loads(s["attrs"].get("langfuse.observation.usage_details") or "{}")
        if usage:
            n_chat += 1
            cost += (usage["prompt_tokens"] * PRICE["in"] + usage["completion_tokens"] * PRICE["out"]) / 1e6
    return {"tid": tid[:8], "user": root["attrs"].get("user.id"), "sec": root["end"] - root["start"],
            "cost": cost, "n_chat": n_chat, "scores": {sc["name"]: sc["value"] for sc in scores if sc["traceId"] == tid}}


if __name__ == "__main__":
    scores = load("scores.jsonl")
    rows = [summarize(tid, spans, scores) for tid, spans in by_trace(load("spans.jsonl")).items()]
    print(f"一共 {len(rows)} 个 trace\n\n① 最慢的 3 个")
    for r in sorted(rows, key=lambda r: r["sec"], reverse=True)[:3]:
        print(f"  {r['tid']}  {r['user']}  {r['sec']:.1f}s  调模型 {r['n_chat']} 次")
    print("\n② 最贵的 3 个")
    for r in sorted(rows, key=lambda r: r["cost"], reverse=True)[:3]:
        print(f"  {r['tid']}  {r['user']}  {r['cost']:.4f} 元  调模型 {r['n_chat']} 次")
    print("\n③ 各项评测的失败率")
    names = sorted({n for r in rows for n in r["scores"] if n != "user_feedback"})
    for n in names:
        vals = [r["scores"][n] for r in rows if n in r["scores"]]
        bad = sum(1 for v in vals if v == 0)
        print(f"  {n:<17} {bad}/{len(vals)}")
    print("\n④ 客户点了「没帮助」的")
    for r in rows:
        if r["scores"].get("user_feedback") == 0:
            fails = [n for n, v in r["scores"].items() if v == 0 and n != "user_feedback"]
            print(f"  {r['tid']}  {r['user']}  同时没过: {fails}")
    costs = sorted(r["cost"] for r in rows)
    q = statistics.quantiles(costs, n=20, method="inclusive")
    print(f"\n⑤ 单张成本  均值 {statistics.mean(costs):.4f}  P50 {statistics.median(costs):.4f}  "
          f"P95 {q[18]:.4f}  最高 {costs[-1]:.4f} 元")
```

<div class="line-notes">

- `import statistics` 标准库的统计模块,均值、中位数、分位数都有,不用装 numpy。
- `from part06.lf_view import by_trace, load` Day 365 写的两个函数:读收件箱、按 trace 分组。
- `PRICE = {"in": 2.0, "out": 8.0}                    # 元 / 百万 token,deepseek-flash,和 Day 364 一样按未命中算` 真实账单里命中缓存的输入更便宜,这里统一按未命中算,所以是偏高的估计。真 Langfuse 在服务端按你配的模型单价算,结果会和这里有差。
- `def summarize(tid: str, spans: list[dict], scores: list[dict]) -> dict:` 把一个 trace 压成一行摘要:谁、多久、多少钱、调了几次模型、有哪些分数。五个视图都从这些摘要里算。
- `usage = json.loads(s["attrs"].get("langfuse.observation.usage_details") or "{}")` 只有 generation 有用量,其他 observation 这里是空字典,跳过。
- `cost += (usage["prompt_tokens"] * PRICE["in"] + usage["completion_tokens"] * PRICE["out"]) / 1e6` 每次调模型的钱加起来就是这张工单的钱。和 Day 364 练习 4 按 span 算钱是一个算式。
- `"cost": cost, "n_chat": n_chat, "scores": {sc["name"]: sc["value"] for sc in scores if sc["traceId"] == tid}}` 这个 trace 的所有分数,变成 `{"outcome": 1.0, "traj:scope": 0.0, ...}`。
- `for r in sorted(rows, key=lambda r: r["sec"], reverse=True)[:3]:` 按耗时从大到小排,取前 3。`reverse=True` 相当于 JS 里 `sort((a, b) => b.sec - a.sec)`。
- `names = sorted({n for r in rows for n in r["scores"] if n != "user_feedback"})` 集合推导式收集所有出现过的分数名,去重后排序。客户反馈单独看,不放进评测失败率里。
- `vals = [r["scores"][n] for r in rows if n in r["scores"]]` 只统计有这个分数的 trace。分母要写对:不是每个 trace 都有每种分数。
- `if r["scores"].get("user_feedback") == 0:` 只列点了「没帮助」的。顺便列出它同时没过哪些评测,看客户的不满和我们的检查对不对得上。
- `q = statistics.quantiles(costs, n=20, method="inclusive")` 把数据切成 20 份,返回 19 个切点,第 19 个(下标 18)就是 P95。P95 的意思是「95% 的工单花的钱不超过这个数」。`method="inclusive"` 适合「手上这批就是全部数据」的情况。
- `f"P95 {q[18]:.4f}  最高 {costs[-1]:.4f} 元")` 只有 10 个数时 P95 很不稳,基本就落在最高的两个之间。真实环境里至少攒几百张再看分位数。

</div>

```bash
uv run python -m part06.views
```

实测输出:

```text
一共 10 个 trace

① 最慢的 3 个
  cfa8c65a  C023  6.1s  调模型 4 次
  5f5a7225  C007  4.7s  调模型 4 次
  8bbebac9  C007  4.7s  调模型 3 次

② 最贵的 3 个
  5f5a7225  C007  0.0137 元  调模型 4 次
  8bbebac9  C007  0.0136 元  调模型 3 次
  cfa8c65a  C023  0.0123 元  调模型 4 次

③ 各项评测的失败率
  outcome           4/10
  traj:budget       0/10
  traj:no_repeat    0/10
  traj:order        0/10
  traj:refund_args  4/10
  traj:scope        2/10

④ 客户点了「没帮助」的
  8bbebac9  C007  同时没过: ['traj:scope']
  cfa8c65a  C023  同时没过: ['outcome', 'traj:scope', 'traj:refund_args']

⑤ 单张成本  均值 0.0101  P50 0.0095  P95 0.0137  最高 0.0137 元
```

## 第三步:顺着视图点进去

视图本身不给答案,它告诉你该先看哪几个 trace。一个个读。

**最慢和最贵的,是同一批。** 三个最慢的和三个最贵的是同样三个 trace,而且都调了 3 到 4 次模型,别的工单大多是 2 到 3 次。时间和钱都花在调模型上,Day 364 的瀑布图已经告诉过我们这一点;多调一次模型,时间多一秒多,钱多三分之一。其中两个是越权那两张(8bbebac9、cfa8c65a):多查了别人的数据,结果塞进上下文,下一次调模型的输入就更长。另一个 5f5a7225 是「重复扣费!!!马上处理」这张,点进去看它的工具调用顺序:

```text
chat → get_subscription(C007) → list_invoices(C007) → chat → search_policy → chat → create_refund_request → chat
```

它在提交退款前多查了一次政策原文。这不是错,只是比另外两张 C007 多走了一步。要不要优化它,取决于这种多出来的一步占多大比例;10 张里只有 1 张,先记下,不急着改。

**`outcome` 失败 4 次,其中 3 次是 C023 的正常工单。** C023 三张正常工单全部「没退款」,`traj:refund_args` 也一起挂。这是这批数据里最大的问题,点开 c24480a1、044c95e1、0f907420 三个 trace,看根 observation 输出里的回复末尾:

```text
c24480a1 …另外提醒一下：退款提交后需要主管审批，不是即时到账；审批通过后原路退回。  您确认按 **6578 元** 提交吗？确认后我就为您发起申请。
044c95e1 …如果你确认要取消，我可以帮你提交退款申请（对应发票 INV-2026-0091，金额 6,578 元），提交后由主管审批。  要我现在提交吗？
0f907420 …请确认： 1. 是现在就取消并退 6,578 元，还是希望用到某个具体日期？ 2. 退款原路退回，需主管审批，通常 3–5 个工作日。  确认后我就提交退款申请。
```

三张的钱全算对了,6578 元,发票也对;它们都停下来问客户「确认吗」。Day 365 跑 C023 时已经见过一次,今天三次全是这样,说明不是偶然,是这个 Agent 在「年付取消」这类工单上的稳定行为。原因也说得通:取消订阅是不可逆的,而客户说的「下个月起不用了」确实有两种理解。

所以这 3 个 `outcome = 0` 不是 Agent 的错,是单轮评测标准和这类工单不匹配。该改的是评测:C023 这类用例改成 [Day 362](/blog/agent-zero/day-362-simulated-user/) 的多轮评测,让模拟客户回一句「确认」再看结果。如果没有点进去看,只看 ③ 那张表,你很可能会去改 prompt 逼它「直接提交」,而 Day 362 恰恰发现过 Agent 在客户只是问一句时就提交了退款。这就是为什么视图之后一定要读 trace。

**点踩的两张,检查都抓到了。** 两位点了「没帮助」的客户,对应的 trace 都没过 `traj:scope`。反过来想更有用:如果哪天出现一张点了踩、但所有检查都过了的 trace,那就是我们的检查没覆盖到的问题,它是下一轮错误分析([Day 345](/blog/agent-zero/day-345-error-analysis-1/))最该读的。

**成本分布很集中。** 均值 0.0101 元、中位数 0.0095 元,最贵的 0.0137 元,还不到中位数的 1.5 倍。这说明这批工单里没有失控的情况。真实环境里要盯的是 P95 和最高值:一个陷入死循环的 Agent 一张工单能花掉平常的几十倍,均值被它拉高,但中位数几乎不动,只看均值会看错方向。

还有一个视图今天没做:**线上评测抽样**。Langfuse 可以配置 LLM 评分器,对线上的 trace 抽一部分自动打分,比如把 Day 357 校准过的评分器搬上去,对 10% 的流量打分。一定要抽样:评分器本身也要调模型,全量打分的钱可能比 Agent 本身还多。这需要账号,我没实跑。

## 第四步:trace 里存了多少个人信息

现在换到第二个问题。客服的 trace 里一定有客户的个人信息:工单原文里的手机号、邮箱,工具查回来的姓名、公司、发票。先数一数今天这批数据里,两张带手机号和邮箱的工单,原文被存了几遍:

```python
# agent-zero-lab/part06/pii_count.py
"""数一数收件箱里每个 trace 有几处手机号、邮箱原文,出现在哪些 observation 上。不调模型。
用法: uv run python -m part06.pii_count"""
from __future__ import annotations

import json

from part06.lf_view import by_trace, load
from part06.pii_mask import EMAIL, PHONE

for tid, spans in by_trace(load("spans.jsonl")).items():
    total, where = 0, []
    for s in spans:
        text = json.dumps(s["attrs"], ensure_ascii=False)
        n = len(PHONE.findall(text)) + len(EMAIL.findall(text))
        if n:
            total += n
            where.append(f"{s['name']}×{n}")
    if total:
        print(f"{tid[:8]}…  {total} 处: {', '.join(where)}")
```

<div class="line-notes">

- `from part06.pii_mask import EMAIL, PHONE` 两个正则,下一步的 `pii_mask.py` 里定义。先写下一步那个文件,再跑这个。
- `text = json.dumps(s["attrs"], ensure_ascii=False)` 把整个 span 的属性变成一个大字符串再搜,不管手机号藏在输入、输出还是元数据里都能找到。
- `n = len(PHONE.findall(text)) + len(EMAIL.findall(text))` `findall` 返回所有匹配,数一下个数。
- `where.append(f"{s['name']}×{n}")` 记下是哪个 observation、几处。

</div>

```bash
uv run python -m part06.pii_count
```

实测输出:

```text
c24480a1…  5 处: chat deepseek-flash×1, chat deepseek-flash×1, chat deepseek-flash×1, invoke_agent ticket×2
619f18de…  6 处: chat deepseek-flash×1, chat deepseek-flash×2, invoke_agent ticket×3
```

客户只说了一次手机号,trace 里存了 5 遍:

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="一个手机号在 trace 里的去处:工单原文进了根 observation 的输入和输出,又进了消息列表,每次调模型的 generation 输入都带着完整消息列表,所以每个 generation 存一遍">
<rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="20" width="170" height="54" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="28" y="42" fill="var(--ink)">客户:「…打我电话</text>
<text x="28" y="62" fill="var(--ink)">13812345678」</text>
<line x1="186" y1="47" x2="226" y2="47" stroke="var(--ink-soft)"/>
<rect x="226" y="20" width="398" height="54" fill="none" stroke="var(--ink-soft)"/>
<text x="238" y="42" fill="var(--ink)">invoke_agent ticket(根)</text>
<text x="238" y="62" fill="var(--ink-soft)">输入: run 的参数 ×1   输出: 返回的字典里有 ticket ×1</text>
<rect x="226" y="96" width="398" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="238" y="118" fill="var(--ink)">chat #1  输入=完整消息列表 ×1</text>
<rect x="226" y="140" width="398" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="238" y="162" fill="var(--ink)">chat #2  输入=完整消息列表 ×1</text>
<rect x="226" y="184" width="398" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="238" y="206" fill="var(--ink)">chat #3  输入=完整消息列表 ×1(回复里再提一次就 ×2)</text>
<line x1="100" y1="74" x2="100" y2="200" stroke="var(--ink-soft)"/>
<line x1="100" y1="113" x2="226" y2="113" stroke="var(--ink-soft)"/>
<line x1="100" y1="157" x2="226" y2="157" stroke="var(--ink-soft)"/>
<line x1="100" y1="201" x2="226" y2="201" stroke="var(--ink-soft)"/>
<text x="16" y="250" fill="var(--ink-soft)">每多调一次模型,原文就多存一遍;Day 365 看到第三个 generation 的输入有 5 KB 多</text>
</g>
</svg>
<figcaption>c24480a1 那张工单里手机号的 5 个去处。邮箱那张(619f18de)是 6 处,多出来的那次是模型在回复里把邮箱又写了一遍。</figcaption>
</figure>

为什么这么多?Day 365 说过,generation 的输入是**完整的消息列表**,每次调模型都把客户的原话带上,所以每个 generation 都存一遍;根 observation 用 `@observe` 记了函数参数和返回值,工单原文又在里面。邮箱那张多一处,是模型在第二次回复里把「结果会发到 xuna@example.com」又写了一遍,模型的输出也会带出个人信息。

这些数据发到哪、谁能看,决定了它是不是个问题。trace 平台通常和业务库是两个系统,能看 trace 的人(开发、测试、外包、平台厂商)往往比能看客户库的人多得多。

## 第五步:在数据离开进程前脱敏

**脱敏**(masking)就是把个人信息换成占位符,比如 `13812345678` 换成 `<phone>`,让数据还能用来排查,但认不出是谁。在哪里做很关键:最好在数据离开你的进程之前,也就是 SDK 发出去之前。这样不管后端是云版、自托管还是别的什么,收到的都是已经脱敏的数据。

Langfuse 的 SDK 提供了这个钩子:创建客户端时传一个 `mask` 函数,SDK 每次记录输入、输出、元数据时,先把数据交给它过一遍。

先写脱敏函数。这里要用到正则的**环视**(lookaround):`(?<!\d)` 是「前面不能是数字」,`(?!\d)` 是「后面不能是数字」,它们只检查位置、不吃掉字符。为什么需要,练习 3 会实测。

```python
# agent-zero-lab/part06/pii_mask.py
"""脱敏:数据发给 Langfuse 之前,把手机号和邮箱换成占位符。字符串、字典、列表一层层往里找。"""
from __future__ import annotations

import re
from typing import Any

PHONE = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")


def mask_text(text: str) -> str:
    return EMAIL.sub("<email>", PHONE.sub("<phone>", text))


def mask(*, data: Any, **kwargs: Any) -> Any:
    if isinstance(data, str):
        return mask_text(data)
    if isinstance(data, dict):
        return {k: mask(data=v) for k, v in data.items()}
    if isinstance(data, (list, tuple)):
        return [mask(data=v) for v in data]
    return data


if __name__ == "__main__":
    samples = ["有问题打我电话 13812345678", "结果发到 xuna@example.com",
               "订单号 20261008123456789 别动", "座机 010-62345678",
               {"messages": [{"role": "user", "content": "手机 13912345678"}]}]
    for s in samples:
        print(repr(s), "→", repr(mask(data=s)))
```

<div class="line-notes">

- `PHONE = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")` 大陆手机号:1 开头,第二位 3 到 9,后面 9 位数字,共 11 位;前后都不能紧挨着数字,防止把长订单号里的一段当成手机号。`re.compile` 预先编译一次,相当于 JS 里先写好一个 `/…/` 字面量反复用。
- `EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")` 粗略的邮箱规则:@ 前是字母数字和 `.+-`,@ 后至少一个「点加一段」。够脱敏用,不是严格校验。`(?:...)` 是不捕获的分组,只用来把「点加一段」当成一个整体重复,不然 `findall` 会返回分组内容而不是整个邮箱。
- `return EMAIL.sub("<email>", PHONE.sub("<phone>", text))` 先换手机号再换邮箱。`sub` 相当于 JS 的 `replace(/…/g, "…")`。
- `def mask(*, data: Any, **kwargs: Any) -> Any:` Langfuse 调用它时用关键字传 `data`,`*` 表示后面的参数只能用关键字传;以后 SDK 可能多传别的参数,用 `**kwargs` 兜住,免得升级后报错。
- `return {k: mask(data=v) for k, v in data.items()}` 字典就对每个值递归处理。Langfuse 传进来的数据可能是字符串,也可能是函数参数组成的字典和列表,只处理字符串的话,`{"phone": "13812345678"}` 这种就漏了。
- `return [mask(data=v) for v in data]` 列表和元组一样递归,结果统一变成列表,JSON 里没有元组。
- `return data` 数字、None 这些原样返回。

</div>

```bash
uv run python -m part06.pii_mask
```

实测输出:

```text
'有问题打我电话 13812345678' → '有问题打我电话 <phone>'
'结果发到 xuna@example.com' → '结果发到 <email>'
'订单号 20261008123456789 别动' → '订单号 20261008123456789 别动'
'座机 010-62345678' → '座机 010-62345678'
{'messages': [{'role': 'user', 'content': '手机 13912345678'}]} → {'messages': [{'role': 'user', 'content': '手机 <phone>'}]}
```

手机号、邮箱、嵌套在字典里的手机号都换掉了;订单号没被误伤;座机没换,因为规则里根本没写座机。脱敏规则永远是「你写了什么才换什么」,姓名、地址、身份证号这些今天都没处理,真实项目要按业务一样样加,[Day 416](/blog/agent-zero/day-416-pii-audit/) 讲权限时会系统地做一遍,还会用到 Microsoft 的 Presidio 这类专门的识别库。

现在接到 Agent 上。关键是**带 mask 的客户端必须是进程里第一个建的**:Day 365 说过 `get_client()` 是单例,`lf_agent.py` 在被导入时就调了它;我们要赶在它之前,先建一个带 mask 的。

```python
# agent-zero-lab/part06/masked_run.py
"""先建一个带 mask 的 Langfuse 客户端,再跑 Day 365 的工单 Agent:同一张带手机号的工单,看发出去的数据里还剩几处原文。
用法: uv run python -m part06.masked_run"""
from __future__ import annotations

from dotenv import load_dotenv

load_dotenv()

from langfuse import Langfuse  # noqa: E402

from part06.pii_mask import mask  # noqa: E402

Langfuse(mask=mask)                     # 必须在 lf_agent 调 get_client() 之前

from part06.lf_agent import langfuse, run  # noqa: E402

result = run("C023", "我们年付的,下个月起不用了,麻烦把剩下几个月的钱退给我们。有问题打我电话 13812345678",
             session_id="masked-1")
langfuse.flush()
print("trace_id:", result["trace_id"])
print("Agent 自己看到的原文还在:", "13812345678" in str(result["ticket"]))
```

<div class="line-notes">

- `Langfuse(mask=mask)                     # 必须在 lf_agent 调 get_client() 之前` 直接用构造函数建客户端,传入脱敏函数。建出来的对象我们不用存,因为之后 `get_client()` 会返回它。
- `from part06.lf_agent import langfuse, run  # noqa: E402` 这时 `lf_agent.py` 里的 `get_client()` 拿到的就是上一行建的那个带 mask 的客户端。`lf_agent.py` 一行没改。
- `print("Agent 自己看到的原文还在:", "13812345678" in str(result["ticket"]))` 脱敏只影响发给 Langfuse 的数据,Agent 本身、发给模型的消息都不受影响,客服该回电话还能回。

</div>

```bash
uv run python -m part06.masked_run
uv run python -m part06.pii_count
```

实测输出:

```text
trace_id: 06a690ebdc751f8e115f5fab24d5c8f9
Agent 自己看到的原文还在: True
c24480a1…  5 处: chat deepseek-flash×1, chat deepseek-flash×1, chat deepseek-flash×1, invoke_agent ticket×2
619f18de…  6 处: chat deepseek-flash×1, chat deepseek-flash×2, invoke_agent ticket×3
```

`pii_count` 的结果和脱敏前一模一样,只有之前那两个 trace;新的 06a690eb 没出现在列表里,也就是 0 处。打开收件箱里这个 trace 的根 observation,输入是:

```text
{'args': ['C023', '我们年付的,下个月起不用了,麻烦把剩下几个月的钱退给我们。有问题打我电话 <phone>'], 'kwargs': {'session_id': 'masked-1'}}
```

三个 generation 的消息列表里,客户那句话也都变成了 `…有问题打我电话 <phone>`。`langfuse.openai` 记的 generation 同样经过了 mask,一处没漏。

这里要说明一件事:2026 年 10 月的 Langfuse 文档把 `mask` 标成了旧的写法(legacy),推荐的是 `mask_otel_spans`,它在导出阶段处理原始的 OpenTelemetry 属性,所以连第三方自动埋点库产生的 span 也能管到。`mask` 只管经过 Langfuse SDK 接口的数据。我们的 Agent 只用了 Langfuse SDK,两者效果一样,`mask` 写起来简单得多,所以正文用它;练习 4 会用推荐的写法再做一遍。

## 第六步:第二道闸,有些东西干脆不记

脱敏是「记,但换掉」。有些数据连记都不该记,比如一个专门查客户联系方式的工具,它的输出整个都是个人信息。`@observe` 有两个开关 `capture_input` 和 `capture_output`,设成 False 就不记。

```python
# agent-zero-lab/part06/ex367_capture.py
"""查客户联系方式的工具,输出一律不记:capture_output=False。不调模型。
用法: uv run python -m part06.ex367_capture"""
from __future__ import annotations

from langfuse import observe

from part06.lf_hello import langfuse
from part06.lf_view import load


@observe(as_type="tool", capture_output=False)
def get_contact(customer_id: str) -> dict:
    return {"customer_id": customer_id, "email": "liujing@example.com", "phone": "13812345678"}


@observe(name="contact_demo")
def demo() -> str:
    return "已查到联系方式:" + get_contact("C007")["email"]


print(demo())
langfuse.flush()
for s in load("spans.jsonl")[-2:]:
    print(s["name"], "输出:", s["attrs"].get("langfuse.observation.output", "(没记)"))
```

<div class="line-notes">

- `from part06.lf_hello import langfuse` 借 Day 365 `lf_hello.py` 里建好的客户端(没有 mask),这样能看清 `capture_output` 自己的效果。
- `@observe(as_type="tool", capture_output=False)` 这个工具的返回值不记。输入(客户编号)照记。
- `return {"customer_id": customer_id, "email": "liujing@example.com", "phone": "13812345678"}` 编造的联系方式。
- `return "已查到联系方式:" + get_contact("C007")["email"]` 外层函数把邮箱拼进了自己的返回值。
- `for s in load("spans.jsonl")[-2:]:` 收件箱最后两行就是刚发的两个 observation,孩子先结束,排在前面。

</div>

```bash
uv run python -m part06.ex367_capture
```

实测输出:

```text
已查到联系方式:liujing@example.com
get_contact 输出: (没记)
contact_demo 输出: 已查到联系方式:liujing@example.com
```

工具那一层确实没记,但外层把邮箱拼进返回值,外层的输出照样记了下来。`capture_output=False` 只管它装饰的那一个函数,数据只要从别的地方流出去,就会被别的 observation 记下。所以它不能代替脱敏,两道闸要一起用:明确不该记的关掉,其余的过 mask。

OpenTelemetry 那边的默认态度正好相反。Day 366 练习 3 的自动埋点库,默认不记任何消息原文,要记得显式打开。用 Day 366 的 `ex366_auto.py` 实测,加上两个环境变量:

```bash
OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental \
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=SPAN_ONLY \
uv run python -m part06.ex366_auto
```

<div class="line-notes">

- `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental \` 切到最新版的 GenAI 约定。行尾的 `\` 表示命令还没完,下一行接着写。
- `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=SPAN_ONLY \` 把消息原文记到 span 属性里。我第一次照网上的教程写成 `true`,它打出 `true is not a valid option for OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT environment variable. Must be one of NO_CONTENT, SPAN_ONLY, EVENT_ONLY, SPAN_AND_EVENT. Defaulting to NO_CONTENT.`,也就是照样不记。`true` 是旧约定下的写法,新约定要写这四个值之一。

</div>

实测输出(去掉了每次都变的响应编号):

```text
chat deepseek-flash CLIENT
  gen_ai.input.messages = [{"role":"user","parts":[{"content":"用一句话说你好","type":"text"}]}]
  gen_ai.operation.name = chat
  gen_ai.output.messages = [{"role":"assistant","parts":[{"content":"你好！很高兴见到你，有什么我可以帮忙的吗？","type":"text"}],"finish_reason":"stop"}]
  gen_ai.provider.name = openai
  gen_ai.request.model = deepseek-flash
  gen_ai.request.temperature = 0
  gen_ai.response.finish_reasons = ('stop',)
  gen_ai.response.model = deepseek-flash
  gen_ai.usage.input_tokens = 8
  gen_ai.usage.output_tokens = 11
  openai.response.system_fingerprint = e72d3c7f663d3e1383b00b3884cb4501
```

多了 `gen_ai.input.messages` 和 `gen_ai.output.messages` 两个属性,里面是「用一句话说你好」和回复的原文(中文被转义了)。不加这两个变量时,Day 366 的输出里没有这两行。

两边的默认值放在一起看:Langfuse SDK 默认记原文,方便排查,要你主动去脱敏;OpenTelemetry 默认不记,保守,要你主动去打开。我的建议是开发和测试环境记原文(数据是造的),生产环境默认不记或者脱敏后记,而且这个开关的状态要写进你们的文档,别靠记忆。

## 第七步:合规上要问的三件事

技术上能做的是上面这些。剩下的是合规问题,它们不由工程师一个人决定,但工程师要知道该问什么、去哪问。三件事:

**数据存在哪。** Langfuse 云版的四个区域(欧盟、美国、日本、HIPAA)都在境外。客服 trace 里的姓名、手机号、发票都是个人信息,发到云版就是向境外提供个人信息。《个人信息保护法》第三十八条要求,向境外提供个人信息,要具备下列条件之一:通过国家网信部门组织的安全评估、经专业机构进行个人信息保护认证、按照国家网信部门制定的标准合同与境外接收方订立合同,或者法律法规规定的其他条件;第三十九条还要求告知个人境外接收方是谁、处理目的和方式等,并取得个人的**单独同意**。你们公司的业务适用哪一条、有没有走完程序,问法务。走不了的,就自托管,或者只发脱敏、去掉原文的数据。

**存多久。** trace 不该无限期保存。Langfuse 文档写的数据保留设置(按项目设,最短 3 天,每天夜里删除过期的 trace、observation、score 和附件),是 Pro 和 Enterprise 档的功能,自托管要企业版;免费的 Hobby 档只能看到 30 天内的数据。保留多久没有标准答案,通常是「排查和评测需要多久就留多久」,30 到 90 天比较常见。不管用不用 Langfuse,这个数字要定下来并写进文档。

**谁能看。** 能登录 trace 平台的人,就能看到里面的所有原文。项目的成员权限要按最小权限给,外包和实习生是否能看生产 trace 要有明确规定。《个人信息保护法》第五十一条列的措施里,就有「采取相应的加密、去标识化等安全技术措施」和「合理确定个人信息处理的操作权限」两条,今天做的脱敏属于前一条。

还有一种情况要提前想好:客户要求删除自己的数据。trace 里按 `user.id` 能找到某个客户的所有 trace,这也是为什么 Day 365 坚持要挂 user_id,统计花费靠它,删数据也靠它。

### 小结

接上 tracing 之后要固定地看:最慢的、最贵的、各项评测的失败率、客户点踩的、单张成本的分布。视图只告诉你先看哪几个,原因要点进 trace 读;今天 C023 三张「没过」,读完发现是单轮评测标准不适合「先确认再提交」的工单,该改评测而不是改 Agent。客户说一次的手机号,在一个 trace 里被存了 5 遍。在数据离开进程前脱敏:Langfuse 的 `mask` 要在第一个建的客户端上传,正则要有边界,`capture_output=False` 只管一层;OpenTelemetry 默认不记原文。合规上问三件事:存在哪(出境要走法定程序)、存多久、谁能看。

## 动手练习

### 练习 1:按客户汇总

不调模型。再加一个视图:按 `user.id` 汇总,每个客户几张工单、一共花了多少钱、几张有没过的评测。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex367_by_user.py
"""练习 1:按客户(user.id)汇总:几张工单、花了多少钱、几张没过评测。不调模型。
用法: uv run python -m part06.ex367_by_user"""
from __future__ import annotations

from part06.lf_view import by_trace, load
from part06.views import summarize

scores = load("scores.jsonl")
users: dict[str, dict] = {}
for tid, spans in by_trace(load("spans.jsonl")).items():
    if not any(s["name"] == "invoke_agent ticket" for s in spans):
        continue                                     # 只算工单 Agent 的 trace,练手脚本产生的跳过
    r = summarize(tid, spans, scores)
    u = users.setdefault(r["user"], {"n": 0, "cost": 0.0, "bad": 0})
    u["n"] += 1
    u["cost"] += r["cost"]
    u["bad"] += any(v == 0 for v in r["scores"].values())
for user, u in sorted(users.items(), key=lambda kv: kv[1]["cost"], reverse=True):
    print(f"{user}  {u['n']} 张  {u['cost']:.4f} 元  平均 {u['cost'] / u['n']:.4f}  有没过的 {u['bad']} 张")
```

<div class="line-notes">

- `from part06.views import summarize` 复用正文的摘要函数,算钱的口径一致。
- `if not any(s["name"] == "invoke_agent ticket" for s in spans):` 收件箱里还有第六步 `contact_demo` 这类练手的 trace,它们没有客户,跳过。
- `u = users.setdefault(r["user"], {"n": 0, "cost": 0.0, "bad": 0})` 第一次见到这个客户就放一个计数器进去。
- `u["bad"] += any(v == 0 for v in r["scores"].values())` `any(...)` 返回 True 或 False,加到整数上分别是 1 和 0。没有分数的 trace(脱敏演示那张)`any` 是 False,不算没过。
- `for user, u in sorted(users.items(), key=lambda kv: kv[1]["cost"], reverse=True):` 按花的钱从多到少。

</div>

```bash
uv run python -m part06.ex367_by_user
```

实测输出(在跑完第五步、第六步之后):

```text
C023  5 张  0.0485 元  平均 0.0097  有没过的 4 张
C007  4 张  0.0470 元  平均 0.0118  有没过的 1 张
C012  2 张  0.0148 元  平均 0.0074  有没过的 0 张
```

C023 是 5 张,因为第五步脱敏演示又跑了一张 C023(它没写分数)。C007 平均每张最贵,越权那张和「重复扣费!!!」那张都在它名下。这个视图在真实环境里回答的是「哪些客户最费钱」和「哪些客户最常碰到问题」,前者影响定价,后者影响客户成功团队先联系谁。真 Langfuse 的 Users 页面就是这张表。

</details>

### 练习 2:带 mask 的客户端建晚了

不调模型。把 `masked_run.py` 的顺序反过来:先导入用了 `get_client()` 的模块,再建 `Langfuse(mask=mask)`,看手机号还能不能被换掉。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex367_order.py
"""练习 2:带 mask 的客户端建晚了会怎样。先 import lf_hello(它在 import 时就 get_client 了),再建 Langfuse(mask=...)。不调模型。
用法: uv run python -m part06.ex367_order"""
from __future__ import annotations

import json

from langfuse import Langfuse

from part06.lf_hello import handle_ticket, langfuse
from part06.lf_view import load
from part06.pii_mask import mask

late = Langfuse(mask=mask)                       # 晚了:lf_hello 里的客户端已经建好
print("是同一个客户端吗:", late is langfuse)
handle_ticket("C007", "我手机 13812345678,帮我查下套餐")
langfuse.flush()
root = [s for s in load("spans.jsonl") if s["name"] == "handle_ticket"][-1]
print("发出去的输入:", json.loads(root["attrs"]["langfuse.observation.input"])["args"][1])
```

<div class="line-notes">

- `from part06.lf_hello import handle_ticket, langfuse` 导入 `lf_hello.py` 时,它的 `get_client()` 已经执行,建了一个没有 mask 的客户端。用 `lf_hello` 是因为它不调模型。
- `late = Langfuse(mask=mask)                       # 晚了:lf_hello 里的客户端已经建好` 再建一个带 mask 的。
- `print("是同一个客户端吗:", late is langfuse)` `is` 比较是不是同一个对象,相当于 JS 的 `===` 比较对象引用。
- `root = [s for s in load("spans.jsonl") if s["name"] == "handle_ticket"][-1]` 收件箱里最后一个 `handle_ticket`,就是刚才这次。

</div>

```bash
uv run python -m part06.ex367_order
```

实测输出:

```text
是同一个客户端吗: False
trace_id: f52fe491ae9bb01972268ba1347ca299
发出去的输入: 我手机 13812345678,帮我查下套餐
```

两个不同的客户端,而 `@observe` 用的是先建的那个(没有 mask),手机号原样发了出去。没有任何报错或警告。这是脱敏最容易出的事故:代码里明明写了 mask,测试时单独跑也是好的,上线时因为某个模块的导入顺序变了,mask 就失效了。两个防法:把 `Langfuse(mask=...)` 放在程序入口的最前面,紧跟 `load_dotenv()`;加一个像 `pii_count.py` 这样的检查,定期扫一遍真实发出去的数据,而不是相信代码。

</details>

### 练习 3:正则太粗和太细

不调模型。手机号正则如果不加 `(?<!\d)` 和 `(?!\d)`,会出什么问题?加了以后又会漏掉什么?用 5 条样本对比三个写法。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex367_regex.py
"""练习 3:手机号正则不加边界会误伤长数字。对比三个写法在 5 条样本上的结果。不调模型。
用法: uv run python -m part06.ex367_regex"""
from __future__ import annotations

import re

from part06.pii_mask import PHONE

NAIVE = re.compile(r"1[3-9]\d{9}")
WITH_86 = re.compile(r"(?<!\d)(?:\+?86)?1[3-9]\d{9}(?!\d)")
SAMPLES = ["电话 13812345678", "订单号 202613812345678", "发票金额 2392 元",
           "手机号+8613812345678", "两个号 13812345678、15900001111"]

for text in SAMPLES:
    print(f"{text:<26} 粗糙版 → {NAIVE.sub('<phone>', text)}")
    print(f"{'':<26} 带边界 → {PHONE.sub('<phone>', text)}")
    print(f"{'':<26} 认 +86 → {WITH_86.sub('<phone>', text)}")
```

<div class="line-notes">

- `NAIVE = re.compile(r"1[3-9]\d{9}")` 网上最常见的写法,没有边界。
- `WITH_86 = re.compile(r"(?<!\d)(?:\+?86)?1[3-9]\d{9}(?!\d)")` 在带边界的基础上,允许前面有可选的 `+86` 或 `86`。`\+?` 是「可以有一个加号」,`(?:...)?` 是「这一整段可有可无」。
- `"订单号 202613812345678"` 15 位的订单号,中间正好藏着一个像手机号的 11 位。
- `"手机号+8613812345678"` 带国际区号的写法。
- `print(f"{'':<26} 带边界 → {PHONE.sub('<phone>', text)}")` `f"{'':<26}"` 是打印 26 个空格占位,让三行对齐。

</div>

```bash
uv run python -m part06.ex367_regex
```

实测输出:

```text
电话 13812345678             粗糙版 → 电话 <phone>
                           带边界 → 电话 <phone>
                           认 +86 → 电话 <phone>
订单号 202613812345678        粗糙版 → 订单号 2026<phone>
                           带边界 → 订单号 202613812345678
                           认 +86 → 订单号 202613812345678
发票金额 2392 元                粗糙版 → 发票金额 2392 元
                           带边界 → 发票金额 2392 元
                           认 +86 → 发票金额 2392 元
手机号+8613812345678          粗糙版 → 手机号+86<phone>
                           带边界 → 手机号+8613812345678
                           认 +86 → 手机号<phone>
两个号 13812345678、15900001111 粗糙版 → 两个号 <phone>、<phone>
                           带边界 → 两个号 <phone>、<phone>
                           认 +86 → 两个号 <phone>、<phone>
```

粗糙版把订单号切成了 `2026<phone>`,排查时你会以为这里有个手机号,订单号也毁了;带 `+86` 的号码它倒是换掉了,只是留下一个 `+86`。带边界的版本修好了订单号,却**完全漏掉**了 `+8613812345678`:因为前面紧挨着的 `6` 是数字,环视判定这不是一个独立的号码。这是我写正文时没想到的,是这道练习实跑出来的。第三个写法两头都顾到了。建议把 `pii_mask.py` 里的 `PHONE` 换成 `WITH_86` 这一版。

结论:脱敏正则的每一次修改都要配一组样本测试,既测「该换的换了」,也测「不该换的没动」。这组样本就是 Day 416 要写的单元测试的雏形。

</details>

### 练习 4(开放题):用官方推荐的 mask_otel_spans

不调模型。正文说 `mask` 是旧写法,推荐的是 `mask_otel_spans`。查 SDK 里 `langfuse.types` 的说明,用它实现同样的脱敏,验证输入输出里的手机号都被换掉。

<details><summary>参考答案</summary>

`mask_otel_spans` 的工作方式和 `mask` 不同:它不是「每条数据过一遍」,而是每批 span 发出去之前,把整批交给你;你返回一个「补丁」,说明哪个 span 的哪些属性要改成什么。它看到的是最终的 OpenTelemetry 属性,输入输出都已经是 JSON 字符串了。

```python
# agent-zero-lab/part06/ex367_mask_otel.py
"""练习 4:官方推荐的导出阶段脱敏 mask_otel_spans。每批 span 发出去之前,把字符串属性里的手机号、邮箱换掉。不调模型。
用法: uv run python -m part06.ex367_mask_otel"""
from __future__ import annotations

import json

from dotenv import load_dotenv

load_dotenv()

from langfuse import Langfuse, observe  # noqa: E402
from langfuse.types import MaskOtelSpansParams, MaskOtelSpansResult, OtelSpanPatch  # noqa: E402

from part06.lf_view import load  # noqa: E402
from part06.pii_mask import mask_text  # noqa: E402


def mask_otel_spans(*, params: MaskOtelSpansParams) -> MaskOtelSpansResult | None:
    patches = {}
    for ident, span in params.spans.items():
        changed = {k: mask_text(v) for k, v in span.attributes.items() if isinstance(v, str) and mask_text(v) != v}
        if changed:
            patches[ident] = OtelSpanPatch(set_attributes=changed)
    return MaskOtelSpansResult(span_patches=patches)


langfuse = Langfuse(mask_otel_spans=mask_otel_spans)


@observe(name="handle_ticket")
def handle_ticket(ticket: str) -> str:
    return "收到,稍后联系您:" + ticket[-11:]


print(handle_ticket("麻烦回电 13812345678"))
langfuse.flush()
root = [s for s in load("spans.jsonl") if s["name"] == "handle_ticket"][-1]
print("发出去的输入:", json.loads(root["attrs"]["langfuse.observation.input"])["args"])
print("发出去的输出:", root["attrs"]["langfuse.observation.output"])
```

<div class="line-notes">

- `from langfuse.types import MaskOtelSpansParams, MaskOtelSpansResult, OtelSpanPatch  # noqa: E402` 三个类型:传进来的一批 span、要返回的结果、对单个 span 的补丁。
- `def mask_otel_spans(*, params: MaskOtelSpansParams) -> MaskOtelSpansResult | None:` 返回 None 表示这一批不改。SDK 说明里写明,这个函数如果抛异常或者返回了不合法的东西,**整批数据会被丢掉**,宁可不发也不发错。
- `for ident, span in params.spans.items():` `ident` 是 span 的标识(trace_id 加 span_id),返回补丁时要用同一个对象当键。
- `changed = {k: mask_text(v) for k, v in span.attributes.items() if isinstance(v, str) and mask_text(v) != v}` 只挑出「是字符串、而且脱敏后有变化」的属性。补丁是稀疏的,没变的不用写。`mask_text(v)` 算了两遍,写成两行能省一次,这里为了一行读完。
- `patches[ident] = OtelSpanPatch(set_attributes=changed)` 用脱敏后的值覆盖原属性。也可以用 `delete_attributes=` 直接删掉某个属性。
- `langfuse = Langfuse(mask_otel_spans=mask_otel_spans)` 同样要在第一个建。这个脚本里没有更早的 `get_client()`,所以没问题。
- `return "收到,稍后联系您:" + ticket[-11:]` 故意让输出里也带上手机号。

</div>

```bash
uv run python -m part06.ex367_mask_otel
```

实测输出:

```text
收到,稍后联系您:13812345678
发出去的输入: ['麻烦回电 <phone>']
发出去的输出: 收到,稍后联系您:<phone>
```

函数的真实返回值不变,发出去的输入和输出都换掉了。和 `mask` 比:`mask_otel_spans` 管得更全(第三方自动埋点产生的 span 也会经过它,只要是这个 Langfuse 客户端导出的),但写起来更绕,而且它在后台线程里跑,要快、不能依赖请求里的上下文。我的选择:只用 Langfuse SDK 埋点的项目,`mask` 够了;混用了 OpenTelemetry 自动埋点库的,用 `mask_otel_spans`。还有一点,它只改发给 Langfuse 的那一份,如果同一批 span 还发给了 Jaeger(Day 366 练习 2 那种),Jaeger 收到的是没改过的,那边要另外处理。

</details>

### 验收标准

- `views.py` 在你自己的一批 trace 上跑出五个视图,你能对其中至少一个异常点进 trace,说出原因。
- `pii_count.py` 能数出带手机号的工单在 trace 里存了几遍;`masked_run.py` 跑完,新 trace 是 0 处。
- 你能讲清楚练习 2 的坑为什么没有任何报错,以及怎么防。
- 你能不看文章说出合规上要问的三件事,以及《个人信息保护法》对向境外提供个人信息的要求大致是什么。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 视图 view | 在一批 trace 上按某个角度排序、筛选、汇总出来的列表或图,如「最慢的 10 个」 |
| P50 / P95 | 中位数 / 95% 的数据不超过的那个值;看极端情况用 P95 |
| `statistics.quantiles` | 标准库函数,把数据切成 n 份,返回切点 |
| 线上评测抽样 | 对线上的一部分 trace 自动打分,不全量打以省钱 |
| 个人信息 PII | 能识别出某个具体的人的信息,如姓名、手机号、邮箱、身份证号 |
| 脱敏 masking | 把个人信息换成占位符,如 `<phone>`,数据还能用但认不出是谁 |
| 去标识化 | 《个人信息保护法》里的说法,处理后不借助额外信息就无法识别特定个人,脱敏是其中一种做法 |
| `mask` / `mask_otel_spans` | Langfuse 的两个脱敏钩子:记录时逐条处理 / 导出前按批处理 OpenTelemetry 属性 |
| `capture_input` / `capture_output` | `@observe` 的开关,设成 False 就不记这个函数的参数或返回值 |
| 环视 lookaround | 正则里只检查位置不吃字符的写法,`(?<!\d)` 前面不是数字,`(?!\d)` 后面不是数字 |
| 不捕获分组 `(?:...)` | 只把几个字符当成一个整体,不单独记住它匹配到的内容 |
| 数据出境 | 把在境内收集的个人信息提供给境外的接收方,发到海外的云服务就算 |
| 单独同意 | 就某一项处理专门取得的同意,不能和其他条款捆在一起 |
| 数据保留期限 | trace 保存多久以后自动删除 |

## 常见误区

**接上 tracing 就算完事。** 接了没人看,等于没接。定一个固定的时间看这五个视图,把发现记下来。

**只看视图不读 trace。** 今天 `outcome` 失败 4/10,其中 3 张是 C023 的正常工单,不点进去看,你会去改 prompt;点进去看,发现该改的是评测。视图告诉你看哪,trace 告诉你为什么。

**只看平均成本。** 一个死循环的 Agent 能把均值拉高好几倍,而中位数几乎不动。看分布,盯 P95 和最高值。10 个数据算出来的 P95 不能当真,攒够几百个再说。

**以为写了 mask 就安全了。** 带 mask 的客户端不是第一个建的,mask 就不生效,而且没有任何报错(练习 2)。定期扫一遍真实发出去的数据。

**脱敏正则不测反例。** 粗糙的正则会把订单号切坏,加了边界的又会漏掉 `+86` 开头的号码(练习 3)。每改一次正则,跑一组「该换」和「不该换」的样本。

**以为 `capture_output=False` 能挡住数据。** 它只管一个函数。数据从外层函数的返回值、模型的回复里流出去,照样被记下。

**只脱敏输入不管输出。** 模型会在回复里把客户的邮箱再写一遍,今天邮箱那张就是这样。输出和输入一样要过 mask。

**照网上教程写 `CAPTURE_MESSAGE_CONTENT=true`。** 新约定下这个值无效,SDK 打一行警告就按「不记」处理。值要写 `SPAN_ONLY` 这类。

**数据出境是技术问题。** 不是,是法律问题,而且要先于技术选型解决。先问法务能不能上云,再选云版还是自托管。

## 学习资料

### 文档与文章

- [Langfuse · Masking](https://langfuse.com/docs/observability/features/masking):`mask` 和 `mask_otel_spans` 两种写法、各自管到哪,今天第五步和练习 4 的出处,英文。
- [Langfuse · Data Retention](https://langfuse.com/docs/administration/data-retention):保留期限怎么设、哪些档有这个功能,英文。
- [Langfuse · Metrics](https://langfuse.com/docs/metrics/overview):Langfuse 界面上的成本、延迟、评分图,就是今天五个视图的界面版,英文。
- [国家互联网信息办公室 · 中华人民共和国个人信息保护法](https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm):全文,重点读第二十八条(敏感个人信息)、第三章第三十八到四十条(跨境提供)、第五十一条(安全措施)。
- [OWASP · LLM02:2025 Sensitive Information Disclosure](https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/):LLM 应用里敏感信息泄露的常见途径和防法,Day 416 会对照它,英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1hg1vBaETP&autoplay=0&high_quality=1" title="三张图带你理解数据脱敏" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Data老毕 · 三张图带你理解数据脱敏 · 3 分钟,脱敏是什么、静态和动态脱敏的区别,先看这个建立概念。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ZH4y1D7bb&autoplay=0&high_quality=1" title="《中华人民共和国个人信息保护法》解读" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>海右网An · 《中华人民共和国个人信息保护法》解读 · 30 分钟,把法条讲成人话。重点听跨境提供和单独同意的部分,和第七步对照。视频是 2023 年的,之后出台的数据出境配套规定要以网信办最新文件为准。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/pTneXS_m1rk" title="Langfuse Intro - Observability & Tracing Deep Dive" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Langfuse 官方 · Langfuse Intro - Observability & Tracing Deep Dive · 11 分钟,英文。看 trace 列表怎么按耗时、费用、score 排序筛选,就是今天前三个视图在界面上的样子。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/a2eqVTTrDDw" title="PII Exposed in Your Logs? Fix It Fast With Observability Pipelines" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Datadog · PII Exposed in Your Logs? Fix It Fast With Observability Pipelines · 4 分钟,英文。在数据离开系统前脱敏的另一种做法:放在采集管道里统一处理,和今天在 SDK 里处理对比。</figcaption>
</figure>

### 书籍

- Nishant Bhajaria《Data Privacy: A runbook for engineers》(Manning,2022):作者做过 Netflix 隐私工程负责人,讲工程师怎么给数据分级、做去标识化、应对审计,英文。
- Chip Huyen《AI Engineering》(O'Reilly,2025)第 10 章:讲用户反馈和监控,和今天的视图部分对应,英文。

### 开源项目与代码

- [microsoft/presidio](https://github.com/microsoft/presidio):微软开源的个人信息识别和脱敏库,支持姓名、地址这类正则很难写的类型,Day 416 会用。
- [langfuse/langfuse-python](https://github.com/langfuse/langfuse-python):`langfuse/types.py` 里 `MaskOtelSpansParams` 的注释写得很详细,练习 4 就是照着它写的。

## 自测

1. 每周固定看的五个视图是哪五个?各回答什么问题?

<details><summary>答案</summary>

最慢的 N 个(用户等得最久的是哪些、时间花在哪);最贵的 N 个(钱花在哪);各项评测的失败率(哪类问题最多、有没有突然变多);客户点踩的(客户觉得哪里不好,是错误分析的首选素材);单张成本的分布(通常花多少、极端情况花多少,看 P50、P95 和最高值)。

</details>

2. 今天 C023 三张正常工单的 `outcome` 都是 0,该改 Agent 还是改评测?为什么?

<details><summary>答案</summary>

改评测。点进 trace 看,三张的退款金额和发票都算对了,只是在提交前问客户确认。「年付中途取消」不可逆,客户的说法也有歧义,先确认是合理的行为。单轮评测要求一轮内提交,和这种行为冲突。应该把这类用例改成 Day 362 的多轮评测,让模拟客户回复「确认」后再判结果。

</details>

3. 客户只说了一次手机号,为什么 trace 里会存好几遍?

<details><summary>答案</summary>

每次调模型的 generation 输入都是完整的消息列表,客户那句话在每个 generation 里存一遍;根 observation 用 `@observe` 记了函数参数和返回值,工单原文又在里面;模型的回复也可能把手机号再说一遍。今天实测一张工单 5 处、另一张 6 处。

</details>

4. 代码里写了 `Langfuse(mask=mask)`,但发出去的数据里还有手机号。最可能是什么原因?

<details><summary>答案</summary>

带 mask 的客户端不是进程里第一个建的。某个更早导入的模块已经调过 `get_client()`,建了一个没有 mask 的客户端,`@observe` 用的是那个。没有任何报错。把 `Langfuse(mask=...)` 放到程序入口最前面,并定期扫描真实发出的数据确认。

</details>

5. 《个人信息保护法》对向境外提供个人信息有什么要求?这和选 Langfuse 云版有什么关系?

<details><summary>答案</summary>

第三十八条要求具备条件之一:通过国家网信部门组织的安全评估、经专业机构个人信息保护认证、按国家网信部门的标准合同与境外接收方订立合同,或法律法规规定的其他条件;第三十九条要求告知个人境外接收方的名称、联系方式、处理目的和方式等,并取得个人单独同意。Langfuse 云版的区域都在境外,把带客户信息的 trace 发上去就是向境外提供个人信息,要先问法务是否满足这些要求;不满足就自托管,或者只发脱敏、不含原文的数据。

</details>

6. (面试题)「你的 Agent 的 trace 里有客户的个人信息,你怎么处理?」

<details><summary>答案</summary>

要点:①先摸清楚:哪些字段有个人信息、一个 trace 里存了几遍(每个 generation 的输入都是完整消息列表,模型输出也会带出来);②能不记的不记:工具输出、敏感函数用 `capture_input/capture_output=False`,OTel 自动埋点保持默认不记原文;③要记的在数据离开进程前脱敏:Langfuse 用 `mask` 或 `mask_otel_spans`,输入输出都过,规则要有正反样本测试,注意客户端要第一个建;④定期扫描真实发出的数据,别只信代码;⑤合规:数据存在哪(出境要走安全评估、认证或标准合同,并取得单独同意,不行就自托管)、存多久(定保留期限)、谁能看(最小权限);⑥按 user_id 能找到某个客户的全部 trace,以便响应删除请求。

</details>

## 明天预告

Day 368 · 自动优化提示词(一):手调的天花板,DSPy、GEPA、ACE 是什么。这四天把 trace 接上、看懂、管好了,手里攒下了一批带分数的真实运行记录。今天还看到,改 prompt 之前要先读 trace,否则会改错方向。明天换一个问题:prompt 一直靠人手调,调到某个程度就上不去了;DSPy、GEPA、ACE 这几个名字说的,就是让程序拿着评测分数自己去改 prompt。
