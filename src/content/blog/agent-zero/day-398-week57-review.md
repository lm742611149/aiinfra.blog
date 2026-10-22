---
title: 'Day 398 · 第 57 周复习:生产化与安全(Day 392–397)'
description: '把这一周的超时分层、断点续跑、工单 worker 上线、Temporal、成本记账和 prompt caching 串成一张图,默写计价函数和「带超时、先记账、规范在前」的模型调用,再拼一个 70 行的批量起草脚本:崩了能接着跑,每次调用都进账,规范前缀命中九成。'
pubDate: 2026-10-23
regime: none
tags: ['review', 'timeout', 'cost', 'prompt-caching', 'agent-zero']
series: 'agent-zero'
day: 398
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 397](/blog/agent-zero/day-397-prompt-caching/) 把 prompt caching 拆开看:厂商按块缓存请求的开头,只认从第一个 token 起一模一样的前缀。实测时间放在 system 第一行命中 0%,放末尾 91%;工单 worker 的起草提示词把 2300 token 的规范挪到最前面,同一批 8 张工单从 1.39 分降到 0.30 分;顺手也验证了给短小的 classify 套上长规范反而贵 30 倍。这一周六天,前四天讲「任务怎么不丢、不卡、崩了能接着跑」,后两天讲「每一步花了多少钱、怎么少花」。今天不学新东西,把它们拼在一起跑一遍。

## 今天要解决的问题

复习日的目标是确认这一周的东西真的会了。今天结束时你应该能:

1. 不看文章,画出一次模型调用外面套着的几层东西:超时、进度记录、记账、缓存友好的消息顺序,说出每层是哪天讲的、防什么事故。
2. 默写 `period_at` + `call_cost` 和一个「带总时限、规范在前、返回就记账」的 `ask_logged`,用检查脚本证明它们是对的。
3. 跑通本周小项目 `part07/review57.py`:批量给 6 张工单起草回复,中途崩一次,重跑时跳过已完成的,账单上能看到崩溃那次白调的钱。
4. 解释两个故意写错的版本:总时限设得比一次调用还短、进度文件名里混进时间戳。

预计用时 3–4 小时(复习日比平时长一点,大头在默写和练习)。前置:[Day 392](/blog/agent-zero/day-392-timeouts/) 到 [Day 397](/blog/agent-zero/day-397-prompt-caching/) 全部。

学法和平时一样:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 本周知识地图

这一周的六天,都围着「worker 里的一次模型调用」打转。从里往外看是这样:

<figure>
<svg viewBox="0 0 640 340" role="img" aria-label="本周知识地图:最里面是一次模型调用,消息顺序规范在前工单在后(397);外面一层是超时,SDK 每次 20 秒,外层总时限更长(392);调用返回立刻写 usage 日志(396);节点跑完写 checkpoint 或进度文件(393);整个任务由 arq worker 执行,开几个、怎么优雅退出(394);另一种做法是 Temporal 的 workflow 和 activity(395)">
<text x="20" y="24" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">一次模型调用外面的几层(从里往外)</text>
<rect x="20" y="40" width="400" height="280" rx="8" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="34" y="60" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">arq worker · 394:max_jobs、扩容、优雅退出</text>
<rect x="40" y="72" width="360" height="236" rx="8" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="54" y="92" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">进度记录 · 393:checkpoint / 进度文件</text>
<rect x="60" y="104" width="320" height="150" rx="8" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="74" y="124" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">超时 · 392:外层总时限 50 秒</text>
<rect x="80" y="136" width="280" height="104" rx="8" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="94" y="156" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">模型调用:SDK 20 秒 × 最多 2 次</text>
<text x="94" y="180" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">messages · 397</text>
<text x="104" y="200" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">1. system:2300 token 规范(不变)</text>
<text x="104" y="220" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">2. user:工单(每次不同)</text>
<text x="74" y="276" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">返回就写 usage 日志 · 396</text>
<text x="74" y="296" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">然后才记「这张做完了」</text>
<rect x="450" y="72" width="170" height="112" rx="8" fill="var(--paper-raised)" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="462" y="94" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">另一条路 · 395</text>
<text x="462" y="116" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">Temporal</text>
<text x="462" y="136" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">workflow 只编排</text>
<text x="462" y="156" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">activity 碰外部</text>
<text x="462" y="176" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">事件历史重放</text>
<text x="450" y="216" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">每层防的事:</text>
<text x="450" y="236" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">超时 → 卡死不返回</text>
<text x="450" y="256" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">进度 → 崩了全重来</text>
<text x="450" y="276" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">日志 → 白调的钱漏账</text>
<text x="450" y="296" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">顺序 → 规范每次原价</text>
</svg>
<figcaption>本周六天在一次模型调用周围的位置。蓝色是模型那一侧,琥珀色是我们自己加的超时。注意两个顺序:日志在调用一返回就写,「这张做完了」在日志之后才记;所以崩在两者之间时,钱进了账,活会重做。</figcaption>
</figure>

图里最容易被忽略的是右下角那两行字的顺序。Day 393 的结论是「checkpoint 只记录跑完的节点」,Day 396 的结论是「状态里的账会漏掉崩溃那一次」,两件事说的是同一个时间缝隙:模型调用已经返回(厂商收了钱),但「这一步做完了」还没写下来。今天的小项目会故意在这个缝隙里崩一次,你会同时看到这两个结论。

## 本周每天一句话

[Day 392 · 超时](/blog/agent-zero/day-392-timeouts/):每一层都要有超时,而且内层要比外层短;httpx 和 openai SDK 的 `timeout` 管的是「每一次等待」,不是总时长,总时长要在外面套 `asyncio.timeout`;超时只说明你不等了,对方可能已经做完。

[Day 393 · 断点续跑](/blog/agent-zero/day-393-resume/):用 LangGraph 的 Postgres checkpoint 加一个由工单号决定的 `thread_id`,崩了以后从断点接着跑;续跑时输入要传 None,队列任务用 `durability="sync"`,崩掉的那个节点会整个重跑。

[Day 394 · 工单 worker](/blog/agent-zero/day-394-ticket-worker/):把队列、重试、幂等、超时、续跑拼成一个真正的 worker;业务失败用 `return "needs_human"` 而不是 `raise`;开几个 worker 先算同时在途的模型请求;发版时用 `job_completion_wait` 让手上的活做完再退。

[Day 395 · Temporal](/blog/agent-zero/day-395-temporal/):workflow 只编排、activity 碰外部世界,靠事件历史重放让已完成的 activity 不重跑;workflow 里不能读系统时间,改了代码顺序旧的执行重放不过去;单服务里几分钟的任务,队列加 checkpoint 已经够用。

[Day 396 · 成本(一)](/blog/agent-zero/day-396-cost-1/):先测量再优化;从 `usage` 读输入、命中、输出三个数,按峰谷价算钱;调用一返回就写日志,对账以日志为准。

[Day 397 · 成本(二)](/blog/agent-zero/day-397-prompt-caching/):缓存只认开头、按块命中;不变的在前、会变的在后,工具排序,历史只追加,共享前缀前先算账。

## 准备环境

在 `agent-zero-lab` 目录下,用的都是前几天的东西,不装新包:

```bash
cd agent-zero-lab
ls part07/pricing.py part07/pricing_check.py part07/policy.py part07/ticket_graph.py part07/cache_report.py part07/usage_report.py
```

`pricing.py` 和 `pricing_check.py` 是 Day 396 建的;`policy.py`、`cache_report.py` 是 Day 397 建的;`ticket_graph.py` 是 Day 393 的那张三步图,今天只借它的 `maybe_crash` 自毁开关;`usage_report.py` 是 Day 396 按工单汇总日志的报表。`.env` 还是那份,`LLM_MODEL=deepseek-flash`,关掉思考模式。今天的小项目不需要 Redis 和 Postgres,一个进程就能跑。

## 默写一:计价函数

先把 `part07/pricing.py` 改个名备份(`mv part07/pricing.py part07/pricing_bak.py`),合上 Day 396,自己重写。要求:价格表按「模型 → 峰谷 → (命中, 未命中, 输出)」组织;`period_at` 按北京时间判断工作日的 9–12 点和 14–18 点为高峰;`call_cost` 返回元。写完对照下面的参考:

```python
# agent-zero-lab/part07/pricing.py
from datetime import datetime, timedelta, timezone

BEIJING = timezone(timedelta(hours=8))
# 元 / 百万 token:(缓存命中输入, 未命中输入, 输出)。2026 年 10 月 22 日从 DeepSeek 定价页抄的
PRICES = {
    "deepseek-flash": {"peak": (0.04, 2.0, 8.0), "idle": (0.02, 1.0, 4.0)},
    "deepseek-v4-pro": {"peak": (0.30, 9.0, 27.0), "idle": (0.15, 4.5, 13.5)},
}


def period_at(when: datetime) -> str:
    bj = when.astimezone(BEIJING)
    if bj.weekday() >= 5:  # 周六、周日
        return "idle"
    if 9 <= bj.hour < 12 or 14 <= bj.hour < 18:
        return "peak"
    return "idle"


def call_cost(model: str, prompt: int, hit: int, completion: int, period: str) -> float:
    p_hit, p_miss, p_out = PRICES[model][period]
    return (hit * p_hit + (prompt - hit) * p_miss + completion * p_out) / 1_000_000
```

<div class="line-notes">

- `BEIJING = timezone(timedelta(hours=8))` 峰谷按北京时间划分。默写时最容易漏的就是这一行,漏了的话在 UTC 服务器上会差 8 小时。
- `PRICES = {` 默写时最常见的错是把三元组的顺序写成「未命中、命中、输出」,下面检查脚本的数字会差好几十倍。顺序要和价格页的列一致,写在注释里。
- `bj = when.astimezone(BEIJING)` 传进来的时间必须带时区。`datetime.now()` 不带时区,要用 `datetime.now(timezone.utc)`。
- `if bj.weekday() >= 5:  # 周六、周日` Python 周一是 0,JS 的 `getDay()` 周日是 0,别搞混。
- `if 9 <= bj.hour < 12 or 14 <= bj.hour < 18:` 右边是小于不是小于等于,12:00 整已经是空闲。
- `return (hit * p_hit + (prompt - hit) * p_miss + completion * p_out) / 1_000_000` `prompt` 是全部输入,里面已经包含了命中的那部分,所以未命中是 `prompt - hit`。我见过有人写成 `prompt * p_miss + hit * p_hit`,命中的部分被算了两遍。

</div>

用 Day 396 的检查脚本验证:

```bash
uv run python -m part07.pricing_check
```

```text
2026-10-22 10:30 Thu peak
2026-10-22 12:30 Thu idle
2026-10-22 17:59 Thu peak
2026-10-24 10:30 Sat idle
peak 0.00008400 元
idle 0.00004200 元
```

和 Day 396 的输出一字不差才算过。四个时间点覆盖了高峰中间、午休、下午最后一分钟和周六;最后两行是 34 个输入、2 个输出的手算值。

## 默写二:带总时限、规范在前、返回就记账

这一段是今天小项目的心脏,把这一周三天的结论压在一个函数里。要求:

- 整个调用(包括 SDK 自己的重试)外面有一个总时限,从环境变量 `CALL_DEADLINE` 读,默认 50 秒;SDK 每次请求 20 秒、最多再试 1 次(Day 392)。
- 消息两条:system 放 Day 397 的 `SYSTEM` 规范,user 放工单(Day 397)。
- 调用一返回就往 `logs/llm_usage.jsonl` 追加一行,字段和 Day 396 的 `ask_metered` 一样,`node` 固定写 `draft`(Day 396)。

先自己写,写完对照下面小项目里的 `ask_logged`。检查脚本:

```python
# agent-zero-lab/part07/drill_ask.py
import asyncio
import json

from part07.review57 import USAGE_LOG, ask_logged


async def main():
    for tid in ("D-1", "D-2"):
        print(tid, await ask_logged(tid, "INV-0123 被重复扣款,请退款"))
    for line in USAGE_LOG.read_text(encoding="utf-8").splitlines()[-2:]:
        c = json.loads(line)
        print(c["ticket_id"], "输入", c["prompt"], "命中", c["hit"], "输出", c["completion"])


asyncio.run(main())
```

<div class="line-notes">

- `from part07.review57 import USAGE_LOG, ask_logged` 从小项目的文件里导入。你默写的函数要放进 `part07/review57.py`,这个检查脚本才找得到它。
- `for tid in ("D-1", "D-2"):` 连调两次,第二次应该命中规范前缀。
- `for line in USAGE_LOG.read_text(encoding="utf-8").splitlines()[-2:]:` `[-2:]` 取最后两个元素,相当于 JS 的 `slice(-2)`。只看刚写进去的两行。

</div>

```bash
uv run python -m part07.drill_ask
```

```text
D-1 您反映的重复扣款问题已记录,已转技术团队核实处理,工单号:INV-0123。退款申请提交后需主管审批,到账时间暂无法承诺。
D-2 您反馈的重复扣款问题,我们已转给技术团队并生成工单号 INV-0123。退款申请提交后需要主管审批,我们不承诺到账时间。涉及金额我们会核实后回复您。
D-1 输入 2371 命中 2176 输出 42
D-2 输入 2371 命中 2176 输出 46
```

日志里有这两行、字段齐全、输入 2371 左右,就算过。我这里两次都命中 2176,是因为前面几天已经用同一段规范跑过很多次,缓存是热的;你第一次跑,D-1 大概率是 0。

两条回复都有问题:把发票号 `INV-0123` 当成了「工单号」,还说「已转技术团队」,而这是一张账单问题。原因在规范第 6 条「技术问题要告诉客户已转给技术团队,并给出工单号」,模型手里没有工单号,就拿发票号顶上了。Day 394 就见过模型不守「事实里没有的不要承诺」,今天又是一例。这不是本周的主题,但要记住:规范要求给的信息,提示词里就得真的给;回复永远先当草稿。

## 本周小项目:崩了能接着跑、每次调用都进账的批量起草

需求:有 6 张工单要起草回复,逐张调模型。要满足四条:

1. 每次调用有总时限,超时的工单标成 `needs_human`,不让整批卡住(Day 392)。
2. 进程中途被 kill,重跑同一个批次时跳过已完成的工单(Day 393 的思路,用一个 JSON 进度文件代替 checkpoint)。
3. 每次调用一返回就记账,崩溃那次白调的也算(Day 396)。
4. 规范作为 system 放在最前面,让它命中缓存(Day 397)。

```python
# agent-zero-lab/part07/review57.py
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from openai import AsyncOpenAI

from part07.policy import SYSTEM
from part07.ticket_graph import maybe_crash

load_dotenv()
llm = AsyncOpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"], timeout=20, max_retries=1)
MODEL = os.environ["LLM_MODEL"]
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
CALL_DEADLINE = float(os.getenv("CALL_DEADLINE", "50"))
USAGE_LOG = Path("logs/llm_usage.jsonl")
TICKETS = [
    ("T1", "10 月 8 号被扣了两次款,INV-0123 那笔麻烦退给我"),
    ("T2", "INV-0456 是重复扣费,申请退款"),
    ("T3", "导出 PDF 发票的时候页面一直转圈"),
    ("T4", "怎么把发票抬头改成公司名"),
    ("T5", "你们的系统太烂了,我要投诉"),
    ("T6", "年付能不能开两张发票"),
]


def load_done(path: Path) -> dict[str, str]:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


async def ask_logged(ticket_id: str, text: str) -> str:
    async with asyncio.timeout(CALL_DEADLINE):
        resp = await llm.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": f"写一段不超过 80 字的中文回复。\n工单:{text}"},
            ],
            max_tokens=200,
            extra_body=EXTRA,
        )
    u = resp.usage
    call = {
        "ticket_id": ticket_id,
        "node": "draft",
        "model": resp.model,
        "at": datetime.now(timezone.utc).isoformat(),
        "prompt": u.prompt_tokens if u else 0,
        "hit": getattr(u, "prompt_cache_hit_tokens", 0) or 0,
        "completion": u.completion_tokens if u else 0,
    }
    USAGE_LOG.parent.mkdir(exist_ok=True)
    with USAGE_LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(call) + "\n")
    return (resp.choices[0].message.content or "").strip()


async def main(batch: str) -> None:
    progress = Path(f"logs/review57-{batch}.json")
    done = load_done(progress)
    for tid, text in TICKETS:
        if tid in done:
            print(f"{tid} 跳过(上次已是 {done[tid]})")
            continue
        try:
            draft = await ask_logged(f"{batch}-{tid}", text)
            status = "draft_ready"
        except TimeoutError:
            draft, status = "", "needs_human"
        maybe_crash(tid)
        done[tid] = status
        progress.parent.mkdir(exist_ok=True)
        progress.write_text(json.dumps(done, ensure_ascii=False), encoding="utf-8")
        print(f"{tid} {status} {draft[:24]}")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
```

<div class="line-notes">

- `from part07.ticket_graph import maybe_crash` Day 393 的自毁开关:环境变量 `CRASH_AT` 等于传进去的名字、而且 `.crash_flag` 文件不存在时,建这个文件然后 `os._exit(1)`。所以同样的命令跑第二次不会再崩。我们传的是工单号,`CRASH_AT=T4` 就在 T4 崩。
- `llm = AsyncOpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"], timeout=20, max_retries=1)` 内层超时:每次请求 20 秒,SDK 自己最多再试 1 次,最坏约 40 秒加上中间零点几秒的退避。Day 392 讲过,算最坏耗时一定要乘上重试次数。
- `CALL_DEADLINE = float(os.getenv("CALL_DEADLINE", "50"))` 外层总时限 50 秒,比内层最坏的 40 多秒长,内层有机会先超时、先重试。做成环境变量是为了练习 1 能改它。
- `USAGE_LOG = Path("logs/llm_usage.jsonl")` 和 Day 396 的 worker 写同一个日志文件,所以 Day 396、397 的报表能直接读。
- `TICKETS = [` 6 张工单写死在代码里。真实系统里它们来自工单表,今天只复习这一周,不碰数据库。
- `def load_done(path: Path) -> dict[str, str]:` 读进度文件,返回「工单号 → 最终状态」。文件不存在(第一次跑)就是空字典。
- `return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}` 三元表达式,一行写完「有就读、没有就空」。
- `async with asyncio.timeout(CALL_DEADLINE):` 包住整个 `create` 调用,包括 SDK 内部的重试。到点就抛 `TimeoutError`,不管 SDK 正在第几次。
- `{"role": "system", "content": SYSTEM},` 2300 token 的规范在最前面,每次一样。
- `{"role": "user", "content": f"写一段不超过 80 字的中文回复。\n工单:{text}"},` 会变的工单在最后。
- `call = {` 和 Day 396 `ask_metered` 里的字段一模一样,报表才能共用。
- `with USAGE_LOG.open("a", encoding="utf-8") as f:` 调用一返回就记账,还没轮到 `maybe_crash`,所以崩溃那次也会留下记录。
- `progress = Path(f"logs/review57-{batch}.json")` 进度文件名只由批次号决定。这就是 Day 393 「thread_id 由业务 id 决定」在这里的样子:同一批次重跑,一定找到同一个文件。练习 2 会把时间戳混进去,看看会怎样。
- `if tid in done:` 上次已经有结果的跳过。注意 `needs_human` 也算有结果,练习 1 会讨论这样对不对。
- `draft = await ask_logged(f"{batch}-{tid}", text)` 日志里的工单号带上批次前缀(如 `W-T4`),这样 Day 397 的 `cache_report.py W` 能只统计这一批。
- `except TimeoutError:` 总时限到了,这张转人工,继续下一张。SDK 自己的超时如果两次都失败,抛的是 `openai.APITimeoutError`,它不是 `TimeoutError`;本例外层 50 秒比内层最坏情况长,所以一般是 SDK 先抛,那种错误这里没接,会让整个进程退出。练习 3 会算这笔账。
- `maybe_crash(tid)` 埋在「调用已返回、日志已写、进度还没写」的缝隙里,就是知识地图里说的那个位置。
- `progress.write_text(json.dumps(done, ensure_ascii=False), encoding="utf-8")` 每张做完就把整个字典写一遍。`ensure_ascii=False` 让中文原样写出,不变成 `\u` 转义。真实系统里这一步是 checkpoint 写进 Postgres,或者工单表的状态字段。
- `print(f"{tid} {status} {draft[:24]}")` 只打印回复的前 24 个字,`[:24]` 是切片,相当于 JS 的 `slice(0, 24)`。

</div>

### 先正常跑一批

```bash
uv run python -m part07.review57 V
uv run python -m part07.cache_report V
```

```text
T1 draft_ready 您反映的情况我们已收到。关于 INV-0123 
T2 draft_ready 您反馈的重复扣费问题已转给技术团队核实,工单号:
T3 draft_ready 您的问题已转给技术团队,工单号:TC202406
T4 draft_ready 您的问题已转给技术团队处理,工单号为【待补充】。
T5 draft_ready 非常抱歉给您带来不好的体验,您反馈的问题已转给技
T6 draft_ready 您的问题我们已收到。关于年付能否开具两张发票,我
draft     调用  6 次  输入  14215  命中  13056(92%)  实付 0.2236 分  不算缓存 1.5031 分
合计 实付 0.2236 分,不算缓存 1.5031 分,省了 85%
```

6 张全部成功。规范前缀命中 92%,省了 85%,和 Day 397 定稿的 worker 一致。T3 的「工单号:TC202406」又是模型编的,和默写二看到的同一个毛病。

### 在 T4 崩一次,再接着跑

```bash
CRASH_AT=T4 uv run python -m part07.review57 W
CRASH_AT=T4 uv run python -m part07.review57 W
rm .crash_flag
cat logs/review57-W.json
uv run python -m part07.cache_report W
uv run python -m part07.usage_report W-T3 W-T4 W-T5
```

```text
T1 draft_ready 您反馈的重复扣款问题我们已收到。退款申请提交后需
T2 draft_ready 您反馈的重复扣费退款申请已收到,需主管审批,到账
T3 draft_ready 您的问题已转给技术团队,工单号:CS202406
  !! 在 T4 节点模拟进程被 kill
T1 跳过(上次已是 draft_ready)
T2 跳过(上次已是 draft_ready)
T3 跳过(上次已是 draft_ready)
T4 draft_ready 您,修改发票抬头为公司名属于技术操作问题,已转给
T5 draft_ready 非常抱歉给您带来不好的体验,您反馈的系统问题我们
T6 draft_ready 您好,年付订单能否开具两张发票,我们会核实后回复
{"T1": "draft_ready", "T2": "draft_ready", "T3": "draft_ready", "T4": "draft_ready", "T5": "draft_ready", "T6": "draft_ready"}
draft     调用  7 次  输入  16580  命中  15232(92%)  实付 0.2609 分  不算缓存 1.7536 分
合计 实付 0.2609 分,不算缓存 1.7536 分,省了 85%
W-T3  调用 1 次(draft)  0.0391 分
W-T4  调用 2 次(draft, draft)  0.0713 分
W-T5  调用 1 次(draft)  0.0386 分
```

这一组输出把一周的三个结论放在了一起:

- **进度记录让重跑跳过了 T1–T3**(Day 393)。没有它,第二次会从 T1 重新开始,前三张的钱再花一遍。
- **T4 被调了两次,6 张工单 7 次调用**(Day 393 + Day 396)。第一次调用已经返回、日志已经写了,进度还没写就崩了。重跑时进度里没有 T4,只能再调一次。这和 Day 393 「崩掉的那个节点会整个重跑」是同一件事。
- **账单上两次都在**(Day 396)。如果只看进度文件,你会以为 6 张工单调了 6 次;日志说是 7 次,厂商也是按 7 次收的。

能不能让 T4 不重调?可以把「回复内容」也和状态一起写进进度文件,调用一返回就写,再 `maybe_crash`。但这只是把缝隙挪小了,不会消失:崩在「厂商已经开始生成、响应还没收到」的时候,你什么都没拿到,钱照样收。所以真实系统的做法是接受「至少调一次」,用日志把钱记准,用幂等把副作用管住。

### 零件和大代码的对照

| 本周零件 | 来自 | 在 `review57.py` 里是哪一段 |
| --- | --- | --- |
| SDK `timeout` + `max_retries` | Day 392 | `AsyncOpenAI(..., timeout=20, max_retries=1)` |
| `asyncio.timeout` 外层总时限 | Day 392 | `async with asyncio.timeout(CALL_DEADLINE):` |
| 超时转人工、不卡整批 | Day 392、394 | `except TimeoutError:` → `needs_human` |
| 由业务 id 决定的进度 | Day 393 | `progress = Path(f"logs/review57-{batch}.json")` |
| 崩溃开关 | Day 393 | `maybe_crash(tid)` |
| 跳过已完成的 | Day 393、394 | `if tid in done:`(相当于 worker 里的 `already_done`) |
| 调用一返回就记账 | Day 396 | `USAGE_LOG.open("a")` 那三行 |
| 按日志算钱 | Day 396、397 | `cache_report.py`、`usage_report.py` |
| 规范在前、工单在后 | Day 397 | `messages=[system SYSTEM, user 工单]` |

Day 394 的扩容、优雅退出和 Day 395 的 Temporal 没有放进小项目:前者要 Redis 和多个进程,后者要起 Temporal 服务,放进来就不是「一个文件复习一周」了。它们在练习 4 和自测里复习。

## 本周错题与坑清单

| 坑 | 哪天 | 现象 | 怎么避开 |
| --- | --- | --- | --- |
| `timeout=1.0` 当成总时长 | 392 | 挤牙膏的上游读了 4.18 秒才超时 | 总时长用外层 `asyncio.timeout` |
| 最坏耗时忘了乘重试 | 392 | 内 60 外 120,实际最坏 180 | 内层 × (1 + max_retries) < 外层 |
| async 里调同步阻塞 | 392 | 设 1 秒等了 3 秒,不报错 | 用 async 库,或 `asyncio.to_thread` |
| 续跑又传一遍输入 | 393 | 图从头走,`steps` 里 classify 出现两次 | 先 `aget_state`,有 `next` 就传 None |
| thread_id 混随机数 | 393 | 永远找不回进度 | 由业务 id 唯一决定 |
| 业务失败用 `raise` | 394 | arq 记成失败,工单卡在 processing | `return "needs_human"` 并写原因 |
| 改代码不重启 worker | 394 | 「怎么没生效」 | 常驻进程,改完要重启 |
| workflow 里读系统时间 | 395 | 被沙箱拦下,workflow 卡住 | 用 `workflow.now()`,外部调用放 activity |
| 改了 workflow 顺序直接发版 | 395 | 旧执行重放报 `TMPRL1100` | `workflow.patched` + `Replayer` |
| 只从状态里记账 | 396 | 状态 2 次,日志 3 次 | 调用一返回就写日志 |
| 时间放 system 第一行 | 397 | 命中 0% | 会变的放最后 |
| 短提示词也套长规范 | 397 | classify 贵 30 倍 | 共享前缀前先算账 |
| 规范要求给的信息没给 | 398 | 模型编出「工单号:TC202406」 | 提示词里真给,回复当草稿 |

最后一行是今天新发现的。它不属于这一周的主题,但会在第八部分 SupportPilot 的评测里反复出现。

## 动手练习

### 练习 1:总时限设得太短

用 `CALL_DEADLINE=0.5` 跑一个新批次 X,看每张工单的状态、日志里有几行;然后不带这个变量再跑一次 X,看会发生什么。

<details><summary>参考答案</summary>

```bash
CALL_DEADLINE=0.5 uv run python -m part07.review57 X
cat logs/review57-X.json
grep -c '"X-' logs/llm_usage.jsonl
uv run python -m part07.review57 X
```

```text
T1 needs_human 
T2 needs_human 
T3 needs_human 
T4 needs_human 
T5 needs_human 
T6 needs_human 
{"T1": "needs_human", "T2": "needs_human", "T3": "needs_human", "T4": "needs_human", "T5": "needs_human", "T6": "needs_human"}
0
T1 跳过(上次已是 needs_human)
T2 跳过(上次已是 needs_human)
T3 跳过(上次已是 needs_human)
T4 跳过(上次已是 needs_human)
T5 跳过(上次已是 needs_human)
T6 跳过(上次已是 needs_human)
```

三个现象:

**全部转人工。** 0.5 秒连一次 2000 多 token 的请求都等不完,外层时限先到,6 张全是 `needs_human`。这是 Day 392 说的「外层比内层短,内层的超时和重试永远没机会」。

**日志里 0 行。** 请求已经发出去了,DeepSeek 那边可能已经开始生成,但我们没等到响应,拿不到 usage,账上什么都没有。DeepSeek 会不会对这种半路断开的请求收费,文档没写,我没法验证。至少要知道:超时的调用,你的账单是看不见的,和厂商对账时这里会有一块差额。

**第二次全部跳过。** 进度文件把 `needs_human` 也当成了「已完成」,时限改正常了也不会重试。这是不是 bug 取决于业务:如果 `needs_human` 意味着「已经交给坐席了,别再动」,跳过是对的;如果只是临时超时,应该允许重跑。一个简单的改法是只把 `draft_ready` 写进 `done`,或者重跑时加一个 `--retry-human` 参数,把 `needs_human` 的从字典里去掉再跑。

</details>

### 练习 2:进度文件名里混进了时间

把 `progress = Path(f"logs/review57-{batch}.json")` 改成按启动时间命名,存成 `part07/review57_bad.py`。在 T4 崩一次再重跑,看重跑从哪开始、账单多了多少。

<details><summary>参考答案</summary>

只改一行:

```python
# agent-zero-lab/part07/review57_bad.py(和 review57.py 只差这一行)
    progress = Path(f"logs/review57-{batch}-{datetime.now():%H%M%S}.json")
```

<div class="line-notes">

- `progress = Path(f"logs/review57-{batch}-{datetime.now():%H%M%S}.json")` f-string 里的 `:%H%M%S` 是 datetime 的格式说明,得到 `000237` 这样的时分秒。看起来是「给每次运行留个记录」,其实每次运行都会去找一个新文件。

</div>

```bash
CRASH_AT=T4 uv run python -m part07.review57_bad Y
CRASH_AT=T4 uv run python -m part07.review57_bad Y
rm -f .crash_flag
ls logs/ | grep Y
uv run python -m part07.usage_report Y-T1 Y-T2 Y-T3 Y-T4 Y-T5 Y-T6
```

```text
T1 draft_ready 您反馈的重复扣款问题我们已收到,非常抱歉给您带来
T2 draft_ready 您反映的重复扣费问题,我们已记录工单INV-04
T3 draft_ready 您的问题已转给技术团队,工单号:CS202506
  !! 在 T4 节点模拟进程被 kill
T1 draft_ready 您反映的情况我们已收到。关于 INV-0123 
T2 draft_ready 您反馈的重复扣费问题已记录,退款申请已提交,需主
T3 draft_ready 您反馈的导出 PDF 发票页面一直转圈的问题,已
T4 draft_ready 您的问题已转给技术团队,工单号:CS202406
T5 draft_ready 您先别着急,给您带来的不便我们深表歉意。您反馈的
T6 draft_ready 您的问题已转交技术团队核实并处理,工单号:CL-
review57-Y-000237.json
review57-Y-000247.json
Y-T1  调用 2 次(draft, draft)  0.0843 分
Y-T2  调用 2 次(draft, draft)  0.0797 分
Y-T3  调用 2 次(draft, draft)  0.0709 分
Y-T4  调用 2 次(draft, draft)  0.0785 分
Y-T5  调用 1 次(draft)  0.0386 分
Y-T6  调用 1 次(draft)  0.0348 分
```

第二次运行找的是 `000247.json`,一个新文件,里面什么都没有,于是从 T1 重新开始。前三张又起草了一遍,T4 本来就要重调,合起来 6 张工单调了 10 次。和正文 W 批的 7 次比,多出来的 3 次就是进度没找回来的代价。更麻烦的是,前三张现在有两份不同的草稿,如果后面还有「发给客户」这种副作用,就是给客户发了两次。

这和 Day 393 练习 2「thread_id 里混进了随机数」是同一个坑,换了个外形。规则不变:找回进度用的 key 只能由业务 id 决定。

</details>

### 练习 3:算一算最坏要等多久

`review57.py` 里 SDK 设的是 `timeout=20, max_retries=1`,外层 `CALL_DEADLINE=50`。假设模型 API 完全卡住、一个字节都不回。

1. 一张工单最坏多久结束?结束时抛的是什么异常?会被 `except TimeoutError` 接住吗?
2. 如果把外层改成 30 秒呢?
3. 6 张工单全部遇到这种情况,整批最坏多久?

<details><summary>参考答案</summary>

1. SDK 第一次请求等 20 秒超时,退避零点几秒后重试,第二次又等 20 秒,一共 40 秒多一点,SDK 抛 `openai.APITimeoutError`。这时外层 50 秒还没到。`APITimeoutError` 不是内置的 `TimeoutError` 的子类,`except TimeoutError` 接不住,异常会一路冒到 `asyncio.run`,整个进程退出,剩下的工单都不处理了。重跑时进度文件还在,会从这张接着来。要让它转人工,应该写成 `except (TimeoutError, openai.APITimeoutError):`,或者像 Day 394 那样先用 `is_retryable` 分类。
2. 外层 30 秒先到,在 SDK 第二次请求的第 10 秒左右把它取消,抛内置 `TimeoutError`,被接住,转人工。代价是 SDK 的重试只做了一半,内层的那层保护等于没用上。Day 392 的原则是外层要比内层最坏的情况长,这里应该是 `20 × 2 + 退避 < 外层`。
3. 按第 1 问的写法,第一张就让进程退出了,谈不上整批。如果改成能接住两种超时,逐张顺序跑,最坏 6 × 40 多秒,约 4 分钟。真实系统里这种「上游整体挂了」的情况应该靠熔断尽早停下([Day 602](/blog/agent-zero/day-602-incident-2/) 会讲自动熔断),而不是让每张工单都等满时限。

这道题是纸面推理,没有实跑(要造一个完全不回包的模型 API,Day 392 的 `drip_server.py` 可以改出来,留给你自己试)。

</details>

### 练习 4:arq + checkpoint 还是 Temporal

下面四个场景,你会用 Day 394 的 arq worker + LangGraph checkpoint,还是 Day 395 的 Temporal?说出理由。

1. 工单起草,每张 2–10 秒,一天 5000 张,只有一个服务。
2. 企业客户的开户流程:建账号、等客户签合同(可能几天)、开通权限、发欢迎邮件,中间任何一步都可能失败要人工处理。
3. 夜里给积压工单批量出草稿,跑在空闲时段,第二天早上看结果。
4. 一个 Agent 要调用三个不同团队的服务,每个服务都有自己的重试和补偿逻辑,流程会经常改。

<details><summary>参考答案</summary>

1. arq + checkpoint。任务短、单服务,Day 394 那套已经能扛住崩溃和重复投递,多一套 Temporal 基础设施不值得。
2. Temporal。流程长达几天、要等外部事件(签合同)、步骤多且每步要能单独重试和人工介入,正是持久化执行擅长的;用队列做的话,「等几天」本身就要自己写定时任务和状态机。
3. arq(或者更简单,今天这个 `review57.py` 加一个定时任务)。批量、可以重跑、单张失败不影响别的;Day 396 说过空闲时段直接五折,夜里跑正合适。用 Day 396 的日志算清这批花了多少。
4. 倾向 Temporal。跨团队、多服务、要补偿(Saga),而且流程经常改,Temporal 的 `workflow.patched` 和重放测试能让改流程这件事可控;但要付出 Day 395 讲过的代价:确定性约束、版本管理、多一套要运维的服务。如果团队里没人愿意维护它,先用队列加数据库状态表也能做,只是补偿逻辑要自己写。

</details>

**验收标准**:合上文章能默写 `pricing.py` 并让 `pricing_check` 输出一字不差;能写出 `ask_logged` 并让 `drill_ask` 在日志里留下两行;能跑出 W 批「6 张工单 7 次调用」并解释那多出来的一次;能说清练习 1 里超时的调用为什么在账上看不见。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 进度文件 | 记录「哪些工作已经做完」的文件,重跑时据此跳过。今天的 `logs/review57-批次.json`,作用相当于 Day 393 的 checkpoint |
| 总时限(deadline) | 一件事从开始到必须结束的最长时间,包括里面所有重试。用 `asyncio.timeout` 实现 |
| 时间缝隙 | 「外部调用已完成」和「完成这件事被记下来」之间的那一小段。崩在这里,活会重做、钱会多花 |
| `openai.APITimeoutError` | openai SDK 自己的超时异常,和 Python 内置的 `TimeoutError` 不是一回事,要分别接 |
| 熔断 | 发现上游整体故障时,暂时停止所有请求,而不是让每个请求都等满超时。第十部分 Day 602 会细讲 |

## 常见误区

**以为进度记录能消灭重复调用。** 它只能让「已经记下来的」不重做。崩在调用返回之后、进度写下之前,这一次一定会重做;崩在厂商生成中途,你连 usage 都拿不到。真实系统接受「至少调一次」,靠日志记准钱,靠幂等管住副作用。

**`except TimeoutError` 以为能接住所有超时。** openai SDK 自己的超时抛 `APITimeoutError`,不是内置 `TimeoutError`。外层时限比内层长的配置下,先到的往往是 SDK 的那个。

**把 `needs_human` 和 `draft_ready` 一样当成「完成」。** 重跑时会被跳过。要不要重试是业务决定,但要在代码里写明白,不要让它碰巧成了某种行为。

**找回进度的 key 里混进时间或随机数。** 进度文件名、thread_id、job id 都一样,只能由业务 id 决定。练习 2 里 6 张工单调了 10 次。

**只看命中率,不看提示词让模型干了什么。** 规范第 6 条要求给工单号,提示词里却没给,模型就编了一个。省钱的改动(把规范放前面)不能替代对回复质量的检查。

## 学习资料

### 文档与文章

- [Python 文档 · asyncio.timeout](https://docs.python.org/3/library/asyncio-task.html#timeouts):`asyncio.timeout` 和 `timeout_at` 的官方说明,复习 Day 392 的外层总时限。英文,10 分钟。
- [openai-python · Timeouts 和 Retries](https://github.com/openai/openai-python#timeouts):SDK 自己的超时和重试怎么配、抛什么异常,练习 3 第 1 问的依据。英文,5 分钟。
- [DeepSeek API 文档 · 上下文硬盘缓存](https://api-docs.deepseek.com/zh-cn/guides/kv_cache):复习 Day 397,再读一遍「落盘」和「尽力而为」两段。中文,10 分钟。
- [Temporal 文档 · Durable Execution](https://docs.temporal.io/evaluate/understanding-temporal):练习 4 做完以后看,对照它自己说的适用场景检查你的答案。英文,15 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1M2aB6MEVE&autoplay=0&high_quality=1" title="5.5 亿 E 轮拆解 Temporal:持久化执行如何拯救 AI Agent 长流程崩溃?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Product-x · 5.5 亿 E 轮拆解 Temporal:持久化执行如何拯救 AI Agent 长流程崩溃? · 约 8 分钟。从产品和商业角度讲为什么 Agent 需要持久化执行,做完练习 4 再看,听听它说的场景和你的判断是否一致。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1QVHt6XEfa&autoplay=0&high_quality=1" title="如何省token/何谓长对话/关于缓存命中/DS过于便宜以致误解/" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>蒂光松飞神 · 如何省token/何谓长对话/关于缓存命中 · 不到 3 分钟。用聊天产品的视角讲缓存命中和长对话的花费,和 Day 397 练习 2 的「历史只追加」对得上,适合复习时快速过一遍。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/1brFhM-4rUM" title="Durable Execution and Workflows: Replay, Idempotency, Determinism | DDIA Explained L39" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>The Modern SDE · Durable Execution and Workflows: Replay, Idempotency, Determinism · 英文。按《Designing Data-Intensive Applications》的思路把重放、幂等、确定性三件事放在一起讲,正好是 Day 393 到 395 的总结。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/U_eRV7ravUo" title="LLMOps #13 — Cost, Caching, and Model Routing: Making LLMs Affordable at Scale" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LLMwork · LLMOps #13 — Cost, Caching, and Model Routing · 英文。成本、缓存、模型路由三件事放在一集里讲,前两件是 Day 396、397 的复习,最后一段是明天的预习。</figcaption>
</figure>

### 书籍

- 《Designing Data-Intensive Applications》第 2 版,Martin Kleppmann、Chris Riccomini,O'Reilly,2026 年 2 月。讲超时、重试、幂等、「至少一次」的那几章是这一周后端部分的理论底子。第 1 版(2017)有中译本《数据密集型应用系统设计》(中国电力出版社);第 2 版目前我只查到 O'Reilly 平台上标明「AI 翻译」的中文版和冯若航的社区译本(前十章,ddia.vonng.com),正式纸质中译本还没查到。

### 开源项目与代码

- [temporalio/samples-python](https://github.com/temporalio/samples-python):Temporal 官方 Python 示例,复习 Day 395 时挑一个和工单流程最像的读。
- [python-arq/arq](https://github.com/python-arq/arq):arq 源码很短,`worker.py` 里能找到 `job_timeout`、`job_completion_wait` 是怎么实现的,复习 Day 394。

## 自测

1. 小项目的 W 批 6 张工单调了 7 次模型,多的那次是哪张、为什么?

<details><summary>答案</summary>

T4。`maybe_crash` 在调用返回、日志写完之后,进度写下之前。第一次运行在这里崩了,日志里有 T4 的一次调用,进度文件里没有 T4;重跑时 T4 不在 `done` 里,于是又调了一次。

</details>

2. 为什么 `ask_logged` 里写日志要在 `maybe_crash` 之前,而写进度要在它之后?反过来会怎样?

<details><summary>答案</summary>

日志的作用是记准厂商收了多少钱,所以调用一返回就写,越早越不容易漏。进度的作用是标记「这张彻底做完了」,要等所有该做的事(今天只是拿到草稿,真实系统里还有写工单表)都完成才写。反过来,先写进度再写日志,崩在中间时进度说做完了、日志里没有这次调用,下次不会重做,钱也漏了账,两头都错。

</details>

3. SDK 设 `timeout=20, max_retries=1`,外层总时限应该至少多长?为什么不能比它短?

<details><summary>答案</summary>

至少比 `20 × (1 + 1)` 再加上退避等待长,也就是 40 多秒以上,今天用 50。外层更短的话,SDK 的重试还没来得及完成就被外层取消,内层那层「第一次超时再试一次」的保护等于白配,Day 392 的原则是内层比外层短。

</details>

4. 进度文件和 Day 393 的 LangGraph checkpoint 有什么相同、有什么不同?

<details><summary>答案</summary>

相同:都是「做完一步记一笔」,都要用业务 id 当 key 才能找回,都只记录做完的步骤,崩在步骤中间的那一步会重做。不同:进度文件只记「哪张工单做完了、结果是什么」,粒度是整张工单;checkpoint 记的是图里每个节点之后的完整状态,粒度是节点,能从工单处理的中间某一步接着跑。进度文件写在本地磁盘上,多台机器之间不共享;checkpoint 在 Postgres 里,任何一个 worker 都能接手。

</details>

5. (面试题)面试官问:「你的 Agent 服务崩溃重启后,会不会重复调用模型、重复给客户发消息?钱会不会算错?」你怎么回答?

<details><summary>答案</summary>

参考答法:分三件事说。重复调用模型:会,但控制在最小范围。我们按节点写 checkpoint(或按任务写进度),key 由工单号决定,重启后从最后一个完成的节点接着跑,只有崩溃时正在跑的那一步会重做;这是「至少执行一次」的必然结果,不追求消灭它。重复发消息:不会。所有有副作用的写操作都带幂等键(工单号加动作),数据库唯一约束拦住第二次,所以重做那一步也只会有一条记录;发给客户的回复先存成草稿,由坐席确认后再发。钱:不会漏。每次模型调用一返回就写一条用量日志,和图的状态分开存,崩溃时白调的那次也在日志里,按日志对账;我们实测过一次崩溃,状态说 2 次、日志 3 次,以日志为准。超时断开的请求拿不到 usage,对账时会有一点差额,用厂商账单兜底。

</details>

## 明天预告

Day 399 · 成本(三):模型路由。这一周算清了钱花在哪、让规范前缀命中了缓存,但所有调用用的都还是同一个模型。分类只要从三个词里挑一个,起草要写一段不乱承诺的回复,它们值得用同一个模型吗?明天给工单 worker 的每个节点单独指定模型,用 `deepseek-v4-pro` 起草、`deepseek-flash` 分类,用今天的日志和报表算出每种搭配的单工单成本,再试一个「便宜模型先写、不合格再交给贵模型」的级联。
