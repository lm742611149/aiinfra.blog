---
title: 'Day 116 · Agent Loupe(五):两次运行逐步对比'
description: '改了一句提示词,Agent 的行为变了,但是从哪一步开始变的?今天给 Agent Loupe 加上逐步对比:用「这一步做了什么决定」当签名,LCS 对齐两条步骤序列,标出相同、不同、多出、缺少,再用按词切分的逐词 diff 看清具体改了什么。'
pubDate: 2026-10-15
regime: none
tags: ['agent-loupe', 'diff', 'lcs', 'react', 'portfolio', 'agent-60']
series: 'agent-60'
day: 116
lang: 'zh'
---

## 今天要解决的问题

昨天的步骤详情面板解决了「这一次运行里发生了什么」:每一步的 messages、工具参数、token、成本,还有上下文被谁撑满了。看完一次运行,你多半会去改点什么,比如系统提示词里加一句「不要心算」,或者把工具描述写清楚一点,然后再跑一次。

问题从这里开始。新的运行有 9 步,旧的有 6 步,两次都答对了,第二次贵了一半。到底哪里不一样?你得把两次运行各开一个窗口,一步一步对着看,看到第 4 步才发现模型这次多调了一次计算器。步数一多,这种肉眼对比就做不下去了。

调 Agent 最常问的问题其实是「改了以后从哪一步开始不一样」。今天就做这个功能。学完你应该能:

1. 说清楚为什么不能直接对两次运行的 JSON 做文本 diff,以及「步骤签名」该包含什么、不该包含什么。
2. 写出 LCS(最长公共子序列)对齐算法,两层对齐区分「同一步但参数变了」和「多出来/少掉的步骤」,并用 pytest 证明它对。
3. 在后端提供 `GET /api/diff?a=&b=`,返回对齐结果、第一处分歧和两次运行的指标对比。
4. 在前端做一个并排对比页:自动滚到第一处分歧,点开有变化的行看逐词 diff,中文也按词对比。
5. 能在面试里讲清这个功能的设计取舍:签名粒度、算法复杂度、什么情况下对齐结果会误导人。

预计用时 5–6 小时。前置:Day 112 的 Run/Step/Trace 模型和 `samples/` 里的样例,Day 113 的 SQLite 存储(今天主要用 `db.load_trace` 把整条运行读回成 Trace)和单步接口 `GET /api/runs/{id}/steps/{idx}`,Day 114 的前端项目(`api.ts`、`store.ts`、路由),Day 115 的步骤详情面板。

## 为什么不能直接 diff 两份 JSON

最省事的想法是把两次运行导出成 JSON,丢给 `git diff --no-index` 或者 jsdiff。我第一次就是这么干的,结果满屏都是红绿。原因有三个。

第一,大量字段每次运行都必然不同:`tool_call_id` 是随机的,`started_at` 是时间戳,`id` 是 UUID。这些差异和 Agent 的行为没有任何关系,但会淹没真正的变化。

第二,LLM 步的输入是越滚越长的对话历史。第 5 步的输入包含了第 1 到第 4 步的所有内容,只要前面任何一步的回复多了一个字,后面每一步的输入都不一样。按输入对比,第一处分歧之后的每一步都会被标红,你什么也看不出来。

第三,也是最要命的:文本 diff 是按行对齐的,它不知道「步骤」这个单位。B 比 A 多了两步,文本 diff 会把这两步拆进上下文里,和 A 的某几行错位匹配,你看到的是一堆莫名其妙的半个 JSON 对象。

所以对比要分两层做。先在「步骤」这个粒度上对齐:哪一步对应哪一步、哪些步骤只在一边出现。对齐完以后,再对配上对的两步做细粒度的文本对比。前一层决定你看到的骨架,后一层只在你点开某一行时才算。这和 GitHub 的 PR 页面是同一个思路:先按文件对齐,再在文件里按行 diff。

## 步骤签名:我们关心的是「决定」

对齐要先定义「两步算不算同一步」。我们给每一步算一个签名字符串,签名相等就认为是同一步。签名太粗,不相干的步骤会被配在一起;签名太细,本质相同的步骤会因为无关的差异对不上。

5C 规格里定的签名是 `kind + name + 规范化参数摘要`。对工具步来说这很自然:`tool:get_weather:<参数摘要>`,参数一样就是同一次调用。规范化指的是先把易变字段去掉,把 `'{"city": "北京"}'` 和 `'{"city":"北京"}'` 这种只差空格的 JSON 字符串解析成同一个对象,再按 key 排序序列化,取 SHA-1 的前 8 位。

LLM 步要特殊处理。前面说了,它的输入每一步都在变,拿输入算摘要等于没有签名。我的做法是用「模型这一步做了什么决定」代替参数:这一轮请求了哪些工具(按名字排序),或者没请求工具、直接回答(记成 `<answer>`)。于是 LLM 步的签名长这样:

```text
llm:chat:get_weather+get_weather      # 一次请求了两个 get_weather
llm:chat:calculate
llm:chat:<answer>                     # 给出最终回答
```

这个选择有代价,得说清楚。两次运行的最终回答措辞完全不同,但都是「直接回答」,签名一样,会被对齐成 same。这在结构上是对的(都在这一步结束了),但如果界面只写「相同」,用户会以为回答也一样。所以对齐结果里我们额外加一个 `content_changed` 标记:决定一样,但输出文字或工具结果变了。界面上显示成「相同(内容有变)」,可以点开看逐词 diff。

为什么不把回复文本也放进签名?因为那样每一次回答都对不上,最后一步永远显示成「A 删了一步、B 加了一步」,反而丢掉了「两次都在这里结束」这个信息。签名决定骨架,细节交给第二层,这是今天最重要的一个设计取舍。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="两次运行的步骤序列经过签名后用 LCS 对齐,中间多出的步骤标为只在 B">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="28" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">运行 A(6 步)</text>
  <text x="340" y="28" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">运行 B(9 步)</text>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="20" y="40" width="270" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="28" y="55" fill="var(--mem)">0 llm:get_weather+get_weather</text>
    <rect x="20" y="66" width="270" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="28" y="81" fill="var(--compute)">1 tool:get_weather:9f3c…</text>
    <rect x="20" y="92" width="270" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="28" y="107" fill="var(--compute)">2 tool:get_weather:41ab…</text>
    <rect x="20" y="118" width="270" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="28" y="133" fill="var(--mem)">3 llm:calculate</text>
    <rect x="20" y="144" width="270" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="28" y="159" fill="var(--compute)">4 tool:calculate:77e0…</text>
    <rect x="20" y="248" width="270" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="28" y="263" fill="var(--mem)">5 llm:&lt;answer&gt;</text>
    <rect x="340" y="40" width="280" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="348" y="55" fill="var(--mem)">0 llm:get_weather+get_weather</text>
    <rect x="340" y="66" width="280" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="348" y="81" fill="var(--compute)">1 tool:get_weather:9f3c…</text>
    <rect x="340" y="92" width="280" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="348" y="107" fill="var(--compute)">2 tool:get_weather:41ab…</text>
    <rect x="340" y="118" width="280" height="22" fill="none" stroke="var(--ink-soft)" stroke-dasharray="4 3"/><text x="348" y="133" fill="var(--ink)">3 llm:calculate+calculate  changed</text>
    <rect x="340" y="144" width="280" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="348" y="159" fill="var(--compute)">4 tool:calculate:77e0…</text>
    <rect x="340" y="170" width="280" height="22" fill="none" stroke="var(--ink-faint)"/><text x="348" y="185" fill="var(--ink-soft)">5 tool:calculate:c210…   added</text>
    <rect x="340" y="196" width="280" height="22" fill="none" stroke="var(--ink-faint)"/><text x="348" y="211" fill="var(--ink-soft)">6 llm:calculate          added</text>
    <rect x="340" y="222" width="280" height="22" fill="none" stroke="var(--ink-faint)"/><text x="348" y="237" fill="var(--ink-soft)">7 tool:calculate:5be9…   added</text>
    <rect x="340" y="248" width="280" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="348" y="263" fill="var(--mem)">8 llm:&lt;answer&gt;</text>
  </g>
  <g stroke="var(--rule)">
    <line x1="290" y1="51" x2="340" y2="51"/><line x1="290" y1="77" x2="340" y2="77"/><line x1="290" y1="103" x2="340" y2="103"/>
    <line x1="290" y1="129" x2="340" y2="129" stroke-dasharray="3 3"/><line x1="290" y1="155" x2="340" y2="155"/><line x1="290" y1="259" x2="340" y2="259"/>
  </g>
  <text x="20" y="292" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">实线 = 签名相同(LCS 锚点);虚线 = 只有 kind+name 相同,算 changed;没有连线 = added</text>
</svg>
<figcaption>Day 117 会真实跑出这样一对运行:B 从 A 的第 0 步重跑,模型在第 3 步多要了一个计算,后面又补算了一次。对齐以后一眼就能看出差别从第 3 步开始。</figcaption>
</figure>

## LCS:把两条序列对齐

有了签名,两次运行就变成两个字符串列表,对齐问题就是经典的最长公共子序列(Longest Common Subsequence)。子序列不要求连续,只要求顺序一致。`[a, b, c, d]` 和 `[a, x, c, d]` 的 LCS 是 `[a, c, d]`,长度 3。LCS 里的每一对元素就是对齐的「锚点」,锚点之间没配上的元素,在 A 里就是删掉的,在 B 里就是新增的。

如果你刷过 LeetCode 1143,这就是那道题,只是我们要的不只是长度,还要把配对的下标找回来。标准写法是从后往前填一张 `(n+1) × (m+1)` 的表,`dp[i][j]` 表示 `a[i:]` 和 `b[j:]` 的 LCS 长度:

- 如果 `a[i] == b[j]`,`dp[i][j] = dp[i+1][j+1] + 1`
- 否则 `dp[i][j] = max(dp[i+1][j], dp[i][j+1])`

填完以后从 `(0, 0)` 往前走:相等就记一对、两边都前进;不等就往 `dp` 值更大的方向走。从后往前填表的好处是回溯时可以从头开始,顺序自然就是正的,不用再反转。

这个算法是 O(n·m) 的时间和空间。几十步、几百步的运行毫无压力。一万步对一万步是一亿个格子,Python 里要跑几十秒,内存也吃不消。我们的规格里 Day 114 已经要求能渲染一万步的 trace,但「对比两条一万步的运行」是另一回事,真碰到了可以先按 LLM 步切段、只对比段的序列,或者换 Myers 算法。Myers 是 git diff 默认的算法,复杂度 O((n+m)·D),D 是差异数量,两次运行差别小的时候非常快。今天先用最容易讲清楚、也最容易写对的 LCS,在常见误区里再讨论什么时候该换。

### 两层对齐:changed 是怎么来的

只用一层 LCS 有个问题。A 的第 1 步是 `get_weather(北京)`,B 的第 1 步是 `get_weather(Beijing)`,参数不同,签名不同,LCS 会把它们处理成「A 删了一步,B 加了一步」。这在技术上没错,但人看到的是两行,一红一绿,还得自己发现它们其实是同一个位置的同一个工具。

所以我们做两层。第一层用完整签名做 LCS,得到锚点。在每两个锚点之间的空隙里,再用粗粒度的键(只有 `kind + name`)做一次 LCS:粗键对上的配成 `changed`,剩下的才是 `removed` / `added`。这样参数变了的步骤会并排显示在同一行,点开就能看参数的逐词差异。

空隙里通常只有几步,第二层的开销可以忽略。

### 代码

在 `server/loupe/` 下新建 `diff.py`:

```python
# agent-loupe/server/loupe/diff.py
import hashlib
import json
from dataclasses import dataclass
from typing import Any, Literal

from loupe.models import Step, Trace

Op = Literal["same", "changed", "added", "removed"]

# 每次运行都会变、和「行为」无关的字段,算签名前去掉
VOLATILE_KEYS = {"id", "tool_call_id", "request_id", "timestamp", "created", "started_at", "ended_at"}


def canonical(obj: Any) -> Any:
    """规范化:去掉易变字段、字符串去首尾空白、dict 按 key 排序(交给 json.dumps)。"""
    if isinstance(obj, dict):
        return {k: canonical(v) for k, v in obj.items() if k not in VOLATILE_KEYS}
    if isinstance(obj, list):
        return [canonical(v) for v in obj]
    if isinstance(obj, str):
        s = obj.strip()
        # 工具参数经常是 JSON 字符串,'{"city": "北京"}' 和 '{"city":"北京"}' 应该算一样
        if s[:1] in "{[":
            try:
                return canonical(json.loads(s))
            except json.JSONDecodeError:
                pass
        return s
    return obj


def digest(obj: Any) -> str:
    raw = json.dumps(canonical(obj), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha1(raw.encode()).hexdigest()[:8]


def requested_tools(step: Step) -> list[str]:
    """LLM 步这一轮决定调用哪些工具(按名字排序),没调工具就是 ['<answer>']。"""
    out = step.output if isinstance(step.output, dict) else {}
    calls = out.get("tool_calls") or []
    names = sorted(c.get("function", {}).get("name", "?") for c in calls)
    return names or ["<answer>"]


def coarse_key(step: Step) -> str:
    return f"{step.kind}:{step.name}"


def signature(step: Step) -> str:
    if step.kind == "llm":
        # LLM 步的输入是越滚越长的历史,拿它算摘要会让每一步都不一样;
        # 我们关心的是「模型这一步做了什么决定」
        return f"llm:{step.name}:{'+'.join(requested_tools(step))}"
    return f"{coarse_key(step)}:{digest(step.input)}"


def label(step: Step) -> str:
    """对比页每一行的一句话摘要。前端拿的是轻步骤(没有 input/output),所以摘要在后端算好。"""
    if step.kind == "llm":
        tools = requested_tools(step)
        if tools != ["<answer>"]:
            return f"→ 调用 {', '.join(tools)}"
        content = (step.output or {}).get("content") if isinstance(step.output, dict) else None
        return f"回答:{(content or '').strip()[:60]}"
    if step.kind == "tool":
        args = json.dumps(canonical(step.input), ensure_ascii=False)
        return f"{step.name}({args[:80]})"
    return step.name


def lcs_pairs(a: list[str], b: list[str]) -> list[tuple[int, int]]:
    """经典 O(n*m) 动态规划,返回匹配上的下标对(按顺序)。"""
    n, m = len(a), len(b)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            dp[i][j] = dp[i + 1][j + 1] + 1 if a[i] == b[j] else max(dp[i + 1][j], dp[i][j + 1])
    pairs, i, j = [], 0, 0
    while i < n and j < m:
        if a[i] == b[j]:
            pairs.append((i, j))
            i, j = i + 1, j + 1
        elif dp[i + 1][j] >= dp[i][j + 1]:
            i += 1
        else:
            j += 1
    return pairs


@dataclass
class Row:
    op: Op
    a: int | None  # 在 A 里的 step.idx
    b: int | None
    content_changed: bool = False  # 决定一样(op=same),但回复文字或工具结果不一样


def _fill_gap(sa: list[Step], sb: list[Step], rows: list[Row]) -> None:
    """两个锚点之间没对上的步骤:粗键(kind+name)相同的配成 changed,剩下的是 removed/added。"""
    pairs = lcs_pairs([coarse_key(s) for s in sa], [coarse_key(s) for s in sb])
    i = j = 0
    for pi, pj in pairs + [(len(sa), len(sb))]:
        rows += [Row("removed", s.idx, None) for s in sa[i:pi]]
        rows += [Row("added", None, s.idx) for s in sb[j:pj]]
        if pi < len(sa) and pj < len(sb):
            rows.append(Row("changed", sa[pi].idx, sb[pj].idx))
        i, j = pi + 1, pj + 1


def align(steps_a: list[Step], steps_b: list[Step]) -> list[Row]:
    anchors = lcs_pairs([signature(s) for s in steps_a], [signature(s) for s in steps_b])
    rows: list[Row] = []
    i = j = 0
    for ai, bj in anchors + [(len(steps_a), len(steps_b))]:
        _fill_gap(steps_a[i:ai], steps_b[j:bj], rows)
        if ai < len(steps_a) and bj < len(steps_b):
            sa, sb = steps_a[ai], steps_b[bj]
            changed = digest(sa.output) != digest(sb.output) or sa.error != sb.error
            rows.append(Row("same", sa.idx, sb.idx, content_changed=changed))
        i, j = ai + 1, bj + 1
    return rows


def first_divergence(rows: list[Row]) -> int | None:
    """第一处不是 same 的行号,界面上直接滚到这里。"""
    return next((k for k, r in enumerate(rows) if r.op != "same"), None)


def metrics(t: Trace) -> dict[str, Any]:
    s = t.steps
    return {
        "steps": len(s),
        "llm_calls": sum(x.kind == "llm" for x in s),
        "tool_calls": sum(x.kind == "tool" for x in s),
        "errors": sum(x.error is not None for x in s),
        "input_tokens": t.run.total_input_tokens,
        "output_tokens": t.run.total_output_tokens,
        "cost_usd": t.run.total_cost_usd,
        "duration_s": round((t.run.ended_at - t.run.started_at).total_seconds(), 3),
        "status": t.run.status,
    }


def diff_traces(a: Trace, b: Trace) -> dict[str, Any]:
    rows = align(a.steps, b.steps)
    sa, sb = {s.idx: s for s in a.steps}, {s.idx: s for s in b.steps}
    return {
        "rows": [{**r.__dict__,
                  "label_a": label(sa[r.a]) if r.a is not None else None,
                  "label_b": label(sb[r.b]) if r.b is not None else None} for r in rows],
        "first_divergence": first_divergence(rows),
        "metrics": {"a": metrics(a), "b": metrics(b)},
    }
```

几个细节值得说一下。

`canonical` 遇到看起来像 JSON 的字符串会尝试解析。OpenAI 协议里工具参数 `arguments` 是字符串,Day 8 讲过,模型有时输出 `{"city": "北京"}`,有时输出 `{"city":"北京"}`。不解析的话,这两种写法签名不同,会被当成两次不同的调用。

`VOLATILE_KEYS` 里放的是每次运行都会变的字段名。这个集合要克制,只放你确定和行为无关的。我一开始把 `content` 也放进去过,结果 LLM 回复的变化全被吃掉了,`content_changed` 永远是 False。

`_fill_gap` 和 `align` 的循环写法一样:把锚点列表末尾补一个哨兵 `(len(a), len(b))`,这样最后一段空隙不用单独处理。这是写对齐类代码的常用技巧,能省掉一大堆边界判断。

`metrics` 算的是对比页顶部那张表:步数、模型调用次数、工具调用次数、出错步数、token、成本、耗时、成败。耗时直接用 `run.ended_at - run.started_at`,Day 112 的 `normalize` 已经保证了 run 的起止时间覆盖所有步骤,不用再自己算。

`label` 给每一步生成一句话摘要,对比页每一行就显示它。为什么在后端算?因为 Day 113 的步骤列表接口默认返回的是「轻步骤」(不带 input/output),一万步也只有两三 MB;前端要自己算摘要,就得把每一步的完整内容都拉下来。对比接口本来就要读完整的 Trace 来算签名,顺手把摘要带上,前端只在用户展开某一行时才用单步接口取完整内容。

`diff_traces` 把这几样拼在一起,是接口要返回的全部内容。

### 测试

对齐算法最怕「看起来对」。下面这组测试覆盖了五种情况:完全相同、参数变了、B 多了步骤、A 多了步骤、决定相同但措辞不同,最后再用 Day 112 的真实样例 `day09_cities.jsonl` 走一遍接口。先在 `server/tests/helpers.py` 里放几个造 Step 和 Trace 的小函数(Day 112 的模型要求 `started_at`、`ended_at` 都是 datetime,所以统一用一个固定时间):

```python
# agent-loupe/server/tests/helpers.py  测试里造 Step / Trace 的小工具
import json
from datetime import datetime, timezone

from loupe.models import Run, Step, Trace

T0 = datetime(2026, 10, 15, tzinfo=timezone.utc)


def call(i: int, name: str, args: dict) -> dict:
    return {"id": f"c{i}", "type": "function",
            "function": {"name": name, "arguments": json.dumps(args, ensure_ascii=False)}}


def llm(idx: int, *tools: str, run: str = "r", content: str = "好的", messages: list | None = None) -> Step:
    calls = [call(idx * 10 + k, t, {}) for k, t in enumerate(tools)]
    out = {"role": "assistant", "content": None if tools else content, "tool_calls": calls or None}
    return Step(run_id=run, idx=idx, kind="llm", name="chat m1", started_at=T0, ended_at=T0,
                input={"messages": messages or [], "tools": []}, output=out, model="m1")


def tool(idx: int, name: str, args: dict, result: object = None, run: str = "r") -> Step:
    return Step(run_id=run, idx=idx, kind="tool", name=name, started_at=T0, ended_at=T0,
                input=args, output=result)


def trace(run_id: str, steps: list[Step]) -> Trace:
    return Trace(run=Run(id=run_id, name=run_id, started_at=T0, ended_at=T0, model="m1"),
                 steps=[s.model_copy(update={"run_id": run_id}) for s in steps])
```

然后是 `server/tests/test_diff.py`:

```python
# agent-loupe/server/tests/test_diff.py
from loupe.diff import align, canonical, first_divergence, signature
from tests.helpers import llm, tool


def ops(rows):
    return [(r.op, r.a, r.b) for r in rows]


def test_canonical_ignores_json_spacing_and_ids():
    assert canonical('{"city": "北京"}') == canonical('{"city":"北京"}')
    assert canonical({"id": "call_1", "x": 1}) == canonical({"id": "call_2", "x": 1})


def test_llm_signature_uses_decision_not_history():
    a = llm(0, "get_weather")
    b = llm(0, "get_weather", messages=[{"role": "user", "content": "完全不同的历史"}])
    assert signature(a) == signature(b)
    assert signature(llm(0)) != signature(a)


def test_identical_runs_are_all_same():
    a = [llm(0, "get_weather"), tool(1, "get_weather", {"city": "北京"}), llm(2)]
    b = [llm(0, "get_weather"), tool(1, "get_weather", {"city": "北京"}), llm(2)]
    assert [r.op for r in align(a, b)] == ["same"] * 3
    assert first_divergence(align(a, b)) is None


def test_changed_args_become_changed_not_add_remove():
    a = [llm(0, "get_weather"), tool(1, "get_weather", {"city": "北京"}), llm(2)]
    b = [llm(0, "get_weather"), tool(1, "get_weather", {"city": "Beijing"}), llm(2)]
    assert ops(align(a, b)) == [("same", 0, 0), ("changed", 1, 1), ("same", 2, 2)]


def test_extra_steps_in_b_are_added():
    a = [llm(0, "get_weather"), tool(1, "get_weather", {"city": "北京"}), llm(2)]
    b = [llm(0, "get_weather"), tool(1, "get_weather", {"city": "北京"}),
         llm(2, "calculate"), tool(3, "calculate", {"expression": "1+1"}), llm(4)]
    rows = align(a, b)
    assert ops(rows)[:2] == [("same", 0, 0), ("same", 1, 1)]
    assert sorted(r.op for r in rows[2:]) == ["added", "added", "same"]
    assert first_divergence(rows) == 2


def test_removed_steps():
    a = [llm(0, "search"), tool(1, "search", {"q": "x"}), llm(2, "search"), tool(3, "search", {"q": "y"}), llm(4)]
    b = [llm(0, "search"), tool(1, "search", {"q": "x"}), llm(2)]
    assert [r.op for r in align(a, b)].count("removed") == 2


def test_same_decision_different_wording_is_flagged():
    [row] = align([llm(0)], [llm(0, content="换了一种说法")])
    assert row.op == "same" and row.content_changed


def test_diff_api_on_real_sample(tmp_path):
    """用 Day 112 的真实样例:同一条运行和自己比,每一行都应该是 same。"""
    from pathlib import Path

    from fastapi.testclient import TestClient

    from loupe.app import create_app

    c = TestClient(create_app(str(tmp_path / "t.db")))
    sample = Path(__file__).parents[2] / "samples" / "day09_cities.jsonl"
    [run] = c.post("/api/import", files={"file": (sample.name, sample.read_bytes())}).json()["imported"]
    d = c.get("/api/diff", params={"a": run["id"], "b": run["id"]}).json()
    assert {r["op"] for r in d["rows"]} == {"same"} and d["first_divergence"] is None
    assert len(d["rows"]) == run["steps"] and d["a"]["step_count"] == run["steps"]
    assert any(r["label_a"].startswith("→ 调用") for r in d["rows"])
```

`uv run pytest tests/test_diff.py -q` 应该 8 个全过。最后一个测试把真实样例和它自己比,每一行都应该是 same,并且至少有一行的摘要是「→ 调用」开头,顺便验证了 `label`。`test_extra_steps_in_b_are_added` 值得单独跑一下看看对齐结果:

```python
from loupe.diff import align
from tests.helpers import llm, tool

a = [llm(0, "get_weather"), tool(1, "get_weather", {"city": "北京"}), llm(2)]
b = [llm(0, "get_weather"), tool(1, "get_weather", {"city": "北京"}),
     llm(2, "calculate"), tool(3, "calculate", {"expression": "1+1"}), llm(4)]
for r in align(a, b):
    print(r)
```

输出大致长这样:

```text
Row(op='same', a=0, b=0, content_changed=False)
Row(op='same', a=1, b=1, content_changed=False)
Row(op='added', a=None, b=2, content_changed=False)
Row(op='added', a=None, b=3, content_changed=False)
Row(op='same', a=2, b=4, content_changed=False)
```

注意最后一行:A 的第 2 步(直接回答)和 B 的第 4 步(直接回答)被对齐了。这正是「用决定当签名」想要的效果:两次运行都在最后回答,B 只是中间多绕了一圈计算器。

## 后端接口

Day 116 起新增的接口,统一放进一个新文件 `server/loupe/routes.py`,每天一个注册函数。今天的部分:

```python
# agent-loupe/server/loupe/routes.py  Day 116 起新增的接口都在这里,create_app 末尾逐个注册
import sqlite3

from fastapi import FastAPI, HTTPException

from loupe import db, diff


# ---- Day 116:对比 ----
def register_diff(app: FastAPI, conn: sqlite3.Connection) -> None:
    @app.get("/api/diff")
    def diff_runs(a: str, b: str) -> dict:
        ta, tb = db.load_trace(conn, a), db.load_trace(conn, b)
        if ta is None or tb is None:
            raise HTTPException(404, "run 不存在")
        return {"a": db.get_run(conn, a), "b": db.get_run(conn, b), **diff.diff_traces(ta, tb)}
```

然后在 Day 113 的 `server/loupe/app.py` 里,`create_app` 最后的 `return app` 前面加两行:

```python
    from loupe.routes import register_diff  # Day 116

    register_diff(app, conn)
    return app
```

`db.load_trace` 是 Day 113 留好的:把一条运行连同全部步骤读回成 `Trace` 对象,步骤是 Day 112 的 `Step` 模型,正好喂给 `align`。`a`、`b` 两个字段用 `db.get_run` 返回的字典,里面带 `step_count`,前端的 `Run` 类型就是这个形状。

返回结果里没有步骤的完整内容,只有对齐后的下标和一句话摘要。一条长运行的完整内容可能有几 MB,对比页一打开就全拉下来没有必要。用户点开某一行时,前端再用 `GET /api/runs/{id}/steps/{idx}` 取那两步。

`a` 和 `b` 的顺序有意义:A 是基线,B 是新的。重跑出来的运行永远放在 B,这样「只在 B」就是「新版本多出来的步骤」。

用 curl 试一下(先在首页导入 `samples/day09_cities.jsonl`,它的 run id 是 `a0d55b7ecb94`):

```bash
curl -s "localhost:8000/api/diff?a=a0d55b7ecb94&b=a0d55b7ecb94" | python3 -m json.tool | head -40
```

自己和自己比,每一行都是 same。下面「跑起来看一眼」一节会造一条有差异的。

## 前端:并排对比页

前端分四块:类型和 API、逐词 diff 工具函数、对比页的界面状态、对比页本身。

### 类型和请求函数

前端的类型和请求函数都在 Day 114 的 `web/src/api.ts` 里。在文件末尾追加:

```typescript
// ---- Day 116 新增:对比 ----
export type DiffOp = 'same' | 'changed' | 'added' | 'removed';

export interface DiffRow {
  op: DiffOp;
  a: number | null; // 在 A 里的 step.idx
  b: number | null;
  content_changed: boolean; // 决定一样,但输出内容不一样
  label_a: string | null; // 后端算好的一句话摘要,轻步骤里没有 input/output,前端算不了
  label_b: string | null;
}

export interface RunMetrics {
  steps: number;
  llm_calls: number;
  tool_calls: number;
  errors: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  duration_s: number;
  status: 'ok' | 'error';
}

export interface DiffResponse {
  a: Run;
  b: Run;
  rows: DiffRow[];
  first_divergence: number | null;
  metrics: { a: RunMetrics; b: RunMetrics };
}

export const fetchDiff = (a: string, b: string) =>
  getJson<DiffResponse>(`/api/diff?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
```

`fetchDiff` 用的是 Day 114 写好的 `getJson`。`Run` 是 Day 114 定义的类型,`StepFull` 和 `fetchStep` 下面展开详情时会用到。

### 中文的逐词 diff

点开一行时,我们要对两步的内容做文本对比。这里用 jsdiff(npm 包名就叫 `diff`,`pnpm add diff`,8.x 自带 TypeScript 类型)。在 `web/src/lib/` 下新建 `wordDiff.ts`:

我第一次写的时候以为 `diffWords` 遇到中文会把整句当成一个词,因为中文句子里没有空格。实际跑了一下,jsdiff 8.0 的默认行为是把连续汉字逐字切开。「北京现在是晴天」改成「北京现在是阴天」,默认结果标出的是「晴」→「阴」两个单字。短句没问题,一段两三百字的回答被改写时,你会看到满屏一个字一个字的红绿碎片,很难读。

jsdiff 8 的 `diffWords` 接受一个 `intlSegmenter` 参数。`Intl.Segmenter` 是浏览器自带的分词器,`granularity: 'word'` 时会用内置词典把中文切成词。传进去以后,同样的例子标出的是「晴天」→「阴天」。

```typescript
// agent-loupe/web/src/lib/wordDiff.ts
import { diffWords } from 'diff';

export interface Piece {
  text: string;
  kind: 'same' | 'add' | 'del';
}

// jsdiff 默认把连续的汉字逐字切开,「晴天」改成「阴天」只会标出「晴→阴」,
// 一长段中文改写时满屏都是单字碎片。传一个按词切的 Intl.Segmenter(浏览器自带中文词典)就能按词对比。
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });

export function wordDiff(a: string, b: string): Piece[] {
  // 太长的文本对比算法会卡住主线程,超过阈值退化成整段对比
  if (a.length + b.length > 20000) {
    return a === b ? [{ text: a, kind: 'same' }] : [{ text: a, kind: 'del' }, { text: b, kind: 'add' }];
  }
  return diffWords(a, b, { intlSegmenter: segmenter }).map((part) => ({
    text: part.value,
    kind: part.added ? 'add' : part.removed ? 'del' : 'same',
  }));
}

/** 步骤的输入/输出转成适合逐词对比的文本。 */
export function stepText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}
```

阈值 20000 字符是个保护。jsdiff 的算法在两段文本差异很大时会很慢,LLM 步的输出偶尔有几万字(比如工具返回了整个网页),在主线程上算会让页面卡住好几秒。超过阈值就直接显示「整段删、整段加」。如果你真的需要对比长文本,可以把计算挪进 Web Worker,这是个不错的练习。

配一个测试,用 vitest(`pnpm add -D vitest`,`package.json` 的 scripts 里加 `"test": "vitest run"`),和被测文件放在同一个目录:

```typescript
// agent-loupe/web/src/lib/wordDiff.test.ts
import { diffWords } from 'diff';
import { describe, expect, it } from 'vitest';

import { wordDiff } from './wordDiff';

const changed = (ps: { text: string; kind: string }[]) => ps.filter((p) => p.kind !== 'same').map((p) => p.text);

describe('wordDiff', () => {
  it('默认逐字对比,加上 Segmenter 以后按词对比', () => {
    const a = '北京现在是晴天,气温11.9度';
    const b = '北京现在是阴天,气温11.9度';
    const naive = diffWords(a, b).filter((p) => p.added || p.removed).map((p) => p.value);
    expect(naive).toEqual(['晴', '阴']);
    expect(changed(wordDiff(a, b))).toEqual(['晴天', '阴天']);
  });

  it('超长文本退化成整段对比', () => {
    const a = 'x'.repeat(15000);
    expect(wordDiff(a, a + 'y')).toHaveLength(2);
  });
});
```

第一个测试同时验证了两件事:jsdiff 默认确实是逐字的(如果哪天 jsdiff 改了默认行为,这个测试会提醒你),以及我们的版本是按词的。把对第三方库行为的假设写成测试,是个好习惯。

显示组件很简单:

```tsx
// agent-loupe/web/src/components/WordDiffView.tsx
import { useMemo } from 'react';
import { wordDiff } from '../lib/wordDiff';

export function WordDiffView({ a, b }: { a: string; b: string }) {
  const pieces = useMemo(() => wordDiff(a, b), [a, b]);
  return (
    <pre className="word-diff pre">
      {pieces.map((p, i) => (
        <span key={i} className={p.kind === 'same' ? undefined : `wd-${p.kind}`}>
          {p.text}
        </span>
      ))}
    </pre>
  );
}
```

颜色用 Day 114 在 `index.css` 里定义的 `--good` 和 `--bad`,在 `index.css` 末尾追加对比页的样式:

```css
/* ---- Day 116 新增:对比页 ---- */
.diff-rows td { white-space: normal; vertical-align: top; }
.diff-rows tr.expandable { cursor: pointer; }
.diff-rows tr.op-changed td:last-child { color: var(--llm); font-weight: 600; }
.diff-rows tr.op-added { background: color-mix(in srgb, var(--good) 10%, transparent); }
.diff-rows tr.op-removed { background: color-mix(in srgb, var(--bad) 10%, transparent); }
.diff-detail td { background: var(--bg); }
.metrics { width: auto; margin-bottom: 12px; }
.wd-add { background: color-mix(in srgb, var(--good) 25%, transparent); }
.wd-del { background: color-mix(in srgb, var(--bad) 25%, transparent); text-decoration: line-through; }
```

`color-mix` 把语义色调淡成背景色,明暗两种模式下都能看清,不用再单独定义一套变量。

### 界面状态

「只看不同」开关和「哪些行展开了」放进 Zustand。运行详情页用的是 Day 114 的 `useUi`(选中哪一步、哪些节点折叠),对比页的状态和它没有关系,单独建一个 store,放在同一个 `web/src/store.ts` 末尾:

```typescript
// ---- Day 116 新增:对比页自己的界面状态,和运行详情页的 useUi 分开,互不干扰 ----
interface DiffState {
  hideSame: boolean;
  expanded: Set<number>; // 展开逐词 diff 的行号
  toggleHideSame: () => void;
  toggleRow: (k: number) => void;
  resetDiff: () => void;
}

export const useDiffStore = create<DiffState>((set) => ({
  hideSame: false,
  expanded: new Set(),
  toggleHideSame: () => set((s) => ({ hideSame: !s.hideSame })),
  toggleRow: (k) =>
    set((s) => {
      const next = new Set(s.expanded);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return { expanded: next };
    }),
  resetDiff: () => set({ hideSame: false, expanded: new Set() }),
}));
```

为什么不直接用 `useState`?Day 117 的重跑对话框跑完会直接跳到对比页,以后你可能还想从别的地方控制这些状态(比如键盘快捷键),放进 store 更方便。和 `useUi` 分成两个 store,是为了两个页面互不干扰:在对比页展开了几行,回到详情页时选中的步骤不会被清掉。

### 对比页

```tsx
// agent-loupe/web/src/pages/DiffPage.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchDiff, fetchStep, type DiffResponse, type DiffRow, type RunMetrics, type StepFull } from '../api';
import { WordDiffView } from '../components/WordDiffView';
import { stepText } from '../lib/wordDiff';
import { useDiffStore } from '../store';

const OP_LABEL: Record<DiffRow['op'], string> = { same: '相同', changed: '不同', added: '只在 B', removed: '只在 A' };

// 显示差异前先「洗」一遍:去掉每次运行都会变的字段,对象的 key 按字母排序。
// 不排序的话,两边 SDK 序列化的字段顺序不同(type 在前还是 function 在前),逐词 diff 会满屏红绿
const NOISE = new Set(['id', 'tool_call_id', 'index']);
function clean(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([k]) => !NOISE.has(k))
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([k, x]) => [k, clean(x)]),
    );
  }
  return v ?? null;
}

// LLM 步比较回复和工具调用,工具步比较「参数 + 结果」
function comparable(s: StepFull | null): string {
  if (!s) return '';
  if (s.kind === 'llm') return stepText(clean(s.output));
  return `参数 ${stepText(clean(s.input))}\n结果 ${stepText(s.error ?? clean(s.output))}`;
}

const METRICS: [keyof RunMetrics, string][] = [
  ['steps', '步数'], ['llm_calls', '模型调用'], ['tool_calls', '工具调用'], ['errors', '出错步'],
  ['input_tokens', '输入 token'], ['output_tokens', '输出 token'], ['cost_usd', '成本 $'], ['duration_s', '耗时 s'],
  ['status', '结果'],
];

function MetricsTable({ m }: { m: DiffResponse['metrics'] }) {
  return (
    <table className="runs metrics">
      <thead>
        <tr><th />{['A', 'B', '变化'].map((h) => <th key={h}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {METRICS.map(([k, label]) => {
          const a = m.a[k];
          const b = m.b[k];
          const delta = typeof a === 'number' && typeof b === 'number' ? b - a : null;
          return (
            <tr key={k}>
              <th>{label}</th>
              <td>{String(a)}</td>
              <td>{String(b)}</td>
              <td className={delta && delta > 0 ? 'bad' : delta && delta < 0 ? 'good' : ''}>
                {delta === null ? (a === b ? '' : '≠') : delta === 0 ? '' : `${delta > 0 ? '+' : ''}${+delta.toFixed(6)}`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** 展开的那一行:两边各取一次完整步骤(Day 113 的单步接口),再做逐词 diff */
function RowDetail({ a, b, row }: { a: string; b: string; row: DiffRow }) {
  const [pair, setPair] = useState<[StepFull | null, StepFull | null] | null>(null);
  useEffect(() => {
    let stale = false;
    Promise.all([
      row.a === null ? null : fetchStep(a, row.a),
      row.b === null ? null : fetchStep(b, row.b),
    ]).then((p) => !stale && setPair(p));
    return () => {
      stale = true;
    };
  }, [a, b, row.a, row.b]);
  if (!pair) return <p className="hint">加载两边的完整内容…</p>;
  return <WordDiffView a={comparable(pair[0])} b={comparable(pair[1])} />;
}

export function DiffPage() {
  const [params] = useSearchParams();
  const a = params.get('a') ?? '';
  const b = params.get('b') ?? '';
  const [data, setData] = useState<DiffResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { hideSame, expanded, toggleHideSame, toggleRow, resetDiff } = useDiffStore();
  const firstRef = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    if (!a || !b) return;
    let stale = false; // 地址变了或组件卸载后,旧请求回来也不要再写状态
    resetDiff();
    setData(null);
    setError(null);
    fetchDiff(a, b)
      .then((d) => !stale && setData(d))
      .catch((e: Error) => !stale && setError(e.message));
    return () => {
      stale = true;
    };
  }, [a, b, resetDiff]);

  // 数据到了以后自动滚到第一处分歧
  useEffect(() => {
    firstRef.current?.scrollIntoView({ block: 'center' });
  }, [data]);

  const rows = useMemo(
    () => (data?.rows ?? []).map((r, k) => ({ ...r, k })).filter((r) => !hideSame || r.op !== 'same' || r.content_changed),
    [data, hideSame],
  );

  if (!a || !b) return <main className="page"><p>地址里要带上 ?a=运行A&amp;b=运行B</p></main>;
  if (error) return <main className="page"><p className="bad">加载失败:{error}</p></main>;
  if (!data) return <main className="page"><p className="hint">加载中…</p></main>;

  return (
    <main className="page diff-page">
      <header className="toolbar">
        <Link to="/">← 全部运行</Link>
        <h1>对比</h1>
        <Link to={`/runs/${encodeURIComponent(a)}`}>A:{data.a.name}</Link>
        <Link to={`/runs/${encodeURIComponent(b)}`}>B:{data.b.name}</Link>
      </header>
      {data.b.parent_run_id === data.a.id && <p className="hint">B 是从 A 的第 {data.b.forked_from_step} 步重跑出来的。</p>}
      <MetricsTable m={data.metrics} />
      <p>
        {data.first_divergence === null ? '两次运行每一步的决定都一样。' : `从第 ${data.first_divergence + 1} 行开始不一样。`}
        <label>
          <input type="checkbox" checked={hideSame} onChange={toggleHideSame} /> 只看不同
        </label>
      </p>
      <table className="runs diff-rows">
        <thead>
          <tr><th>#</th><th>A</th><th>B</th><th>差异</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const expandable = r.op === 'changed' || r.content_changed;
            return [
              <tr
                key={r.k}
                ref={r.k === data.first_divergence ? firstRef : undefined}
                className={`op-${r.op}${expandable ? ' expandable' : ''}`}
                onClick={() => expandable && toggleRow(r.k)}
              >
                <td className="idx">{r.k + 1}</td>
                <td>{r.a !== null && <><span className="idx">#{r.a}</span> {r.label_a}</>}</td>
                <td>{r.b !== null && <><span className="idx">#{r.b}</span> {r.label_b}</>}</td>
                <td>
                  {OP_LABEL[r.op]}
                  {r.content_changed && '(内容有变)'}
                  {expandable ? (expanded.has(r.k) ? ' ▾' : ' ▸') : ''}
                </td>
              </tr>,
              expanded.has(r.k) && (
                <tr key={`${r.k}-detail`} className="diff-detail">
                  <td />
                  <td colSpan={3}>
                    <RowDetail a={a} b={b} row={r} />
                  </td>
                </tr>
              ),
            ];
          })}
        </tbody>
      </table>
    </main>
  );
}
```

几处值得解释:

**`stale` 标记。** 第一版我把对比结果和两边的步骤分成三个请求一起拉,没加这个标记,结果在开发模式下偶尔看到 B 列整列是空的。原因是 React 18 的 StrictMode 在开发模式下会把 effect 执行两次,两轮请求谁先回来谁就写状态,第二轮开头的重置又可能落在第一轮的结果之后。加上 `stale` 以后,只有最后一次 effect 发出的请求能写状态。Day 114 的 `RunDetail` 里用的 `cancelled` 是同一个办法。这不只是开发模式的问题,用户在地址栏换了 `b` 参数时也会遇到同样的竞态。展开详情的 `RowDetail` 也用了它。

**`clean`。** 后端算签名时去掉了易变字段,但显示逐词 diff 时如果不去掉,每个 tool_call 的 `id` 都会被标红。还有一个坑是我截图检查时才发现的:两边的 JSON 字段顺序不一样。原运行是 SDK 记下来的,`tool_calls` 里 `id`、`function`、`type` 是一个顺序;重跑出来的是另一个顺序。内容完全一样,逐词 diff 却标出一大片红绿。所以 `clean` 在去掉噪声字段的同时,把每个对象的 key 按字母排好序。

**`RowDetail` 按需取完整内容。** 展开一行时才用 Day 113 的 `fetchStep` 取两边的完整步骤。大部分行用户不会点开,没必要预先加载。

**自动滚动。** 数据到了以后,`firstRef` 指向第一处分歧那一行,`scrollIntoView({ block: 'center' })` 把它滚到屏幕中间。对比页最常见的用法就是「直接看哪里开始不一样」。

**只给需要的行加点击。** `changed` 和 `content_changed` 的行才能展开。`added` / `removed` 只有一边有内容,对比没有意义,用户想看内容可以点表头的链接去运行详情页。「只看不同」也会保留「相同(内容有变)」的行,因为它们恰恰值得看。

最后在 Day 114 的 `web/src/App.tsx` 里加一条路由,接在 `/runs/:id` 后面:

```tsx
import { DiffPage } from './pages/DiffPage';
// ...
        <Route path="/runs/:id" element={<RunDetail />} />
        <Route path="/diff" element={<DiffPage />} />
```

运行列表页也加个入口:勾选两条运行,点「对比」,跳到 `/diff?a=...&b=...`。这部分和 Day 114 的列表页耦合比较紧,留作练习。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="对比页布局:顶部指标表,中间提示第一处分歧,下面是 A、B 两列并排的步骤表,有变化的行可以展开逐词 diff">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
  <rect x="20" y="16" width="250" height="70" fill="none" stroke="var(--rule)"/>
  <text x="30" y="36" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">指标      A     B    变化</text>
  <text x="30" y="54" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">步数      6     9    +3</text>
  <text x="30" y="72" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">输入token …     …    …</text>
  <text x="290" y="54" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">从第 4 行开始不一样  □ 只看不同</text>
  <rect x="20" y="100" width="600" height="20" fill="none" stroke="var(--rule)"/>
  <text x="30" y="114" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">3  get_weather(上海)          2  get_weather(上海)          相同</text>
  <rect x="20" y="122" width="600" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="30" y="136" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">4  → 调用 calculate           3  → 调用 calculate, calculate 不同 ▾</text>
  <rect x="40" y="144" width="580" height="36" fill="none" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
  <text x="50" y="160" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">逐词 diff:"expression": "17.7 - 11.9"</text>
  <text x="50" y="174" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">+ "expression": "(17.7 - 11.9) * 9 / 5"</text>
  <rect x="20" y="184" width="600" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="30" y="198" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">6                             5  calculate(...)             只在 B</text>
  <text x="20" y="222" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">打开时自动滚到第一处分歧;只有 changed 和「内容有变」的行能展开</text>
</svg>
<figcaption>对比页的布局。指标表回答「整体差多少」,步骤表回答「从哪里开始差」,展开的逐词 diff 回答「具体差在哪」。</figcaption>
</figure>

## 跑起来看一眼

对比页要有两条相似的运行才有意思。Day 117 才会做重跑,今天先手工造一条:把 Day 112 的真实样例复制一份,改掉 run id,再把查成都天气的那次调用改成英文城市名。在仓库根目录执行:

```bash
python3 - <<'EOF'
import json
lines = [json.loads(l) for l in open("samples/day09_cities.jsonl", encoding="utf-8")]
for d in lines:
    if d.get("type") in ("run_start", "run_end"):
        d["id"] += "-edited"
    if d.get("type") == "step":
        d["run_id"] += "-edited"
        if d["kind"] == "tool" and d["name"] == "get_weather" and d["input"].get("city") == "成都":
            d["input"]["city"] = "Chengdu"
with open("/tmp/edited.jsonl", "w", encoding="utf-8") as f:
    f.writelines(json.dumps(x, ensure_ascii=False) + "\n" for x in lines)
EOF
```

然后起前后端:

```bash
cd server && uv run uvicorn loupe.app:create_app --factory --port 8000
cd web && pnpm dev            # 另一个终端
```

在首页把 `samples/day09_cities.jsonl` 和 `/tmp/edited.jsonl` 都导入,打开 `http://localhost:5173/diff?a=a0d55b7ecb94&b=a0d55b7ecb94-edited`。我这里看到的是 10 行,只有第 6 行(`get_weather({"city": "Chengdu", ...})`)是「不同」,点开以后只有城市名那个词是红绿的,其余 9 行都是相同。页面打开时已经自动滚到了这一行。

明天做完重跑以后,对比页会成为你用得最多的页面:每次重跑完自动跳到这里。

## 动手练习

1. **把今天的代码跑通。** 后端 `uv run pytest -q` 全过(包括 Day 113 的测试),前端 `pnpm typecheck` 和 `pnpm test` 通过。
2. **运行列表加「对比」按钮。** 在 Day 114 的 `RunList` 里加复选框,选中恰好两条时出现「对比」按钮,较早的那条作为 A,跳到 `/diff?a=...&b=...`。
3. **键盘导航。** 在对比页加 `n` / `p` 快捷键,跳到下一处 / 上一处非 same 的行(可以参考 Day 114 时间轴的键盘处理),并把当前行高亮。
4. **对齐算法的极端情况。** 写测试覆盖:两条都是空运行;A 为空、B 有 5 步;两条运行完全没有共同步骤(全部应该是 removed/added 或 changed);同一个工具同一个参数连续调用三次,B 只调了两次。最后一种情况想一想,哪一次应该被标成 removed?你的实现给出的结果合理吗?
5. **性能实验(选做)。** 用 Day 114 的 `samples/gen_synthetic.py --steps 2000` 造一条 2000 步的运行,再用上面「跑起来看一眼」的办法复制一份、随机改掉 5% 工具步的参数,测 `GET /api/diff` 的耗时(`time curl ...`),再换 500 步和 5000 步。把数字填进下表,判断你的系统在多少步以内可以接受 O(n·m):

| 步数 | 耗时(秒) | 峰值内存 |
| --- | --- | --- |
| 500 | | |
| 2000 | | |
| 5000 | | |

**验收标准:** 测试全过;用「跑起来看一眼」造的那两条运行打开对比页,能自动滚到第 6 行,展开后只有城市名被标出;「只看不同」开关能把相同的行藏起来;练习 4 的四个测试都写了,并能解释第四种情况的结果。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 步骤签名(step signature) | 把一步压缩成一个字符串,用来判断两次运行里的两步是不是「同一步」 |
| 规范化(canonicalization) | 去掉易变字段、统一格式后再比较,让无关差异不影响结果 |
| LCS(最长公共子序列) | 两个序列里顺序一致、不要求连续的最长公共部分;配对的元素就是对齐的锚点 |
| 锚点(anchor) | 两边签名完全相同、被 LCS 配上的步骤对 |
| changed / added / removed | 粗键相同但签名不同 / 只在 B 出现 / 只在 A 出现 |
| content_changed | 决定相同(对齐为 same),但输出内容不同 |
| Myers 算法 | git diff 的默认算法,复杂度和差异数量成正比,差异少时比 LCS 快得多 |
| Intl.Segmenter | 浏览器和 Node 自带的分词 API,可以按语言规则把文本切成词 |
| 竞态(race condition) | 多个异步请求返回顺序不确定,导致旧结果覆盖新状态 |

## 常见误区

**拿 LLM 步的输入算签名。** 输入是累积的历史,第一处分歧之后每一步都不一样,对齐退化成「从这里往后全部不同」。LLM 步要用它的决定(请求了哪些工具)当签名。

**把能变的字段都塞进 VOLATILE_KEYS。** 这个集合只放确定和行为无关的字段。放多了,真正的变化会被吃掉,对比页显示「完全相同」,你会以为改动没起作用。

**只做一层对齐。** 参数一变,同一位置的同一个工具就变成一红一绿两行,用户得自己脑补它们是同一件事。两层对齐的代码只多二十行,体验差别很大。

**界面上把 same 写成「完全一样」。** same 的意思是「决定一样」。最终回答换了措辞也是 same,一定要配合 `content_changed` 告诉用户内容有变。

**以为 LCS 对任何规模都够用。** O(n·m) 在几百步时毫无感觉,几千步对几千步就开始慢了。先测出你的上限(练习 5),再决定要不要换 Myers 或者分段对齐,而不是一开始就写最复杂的版本。

**在前端主线程上对比超长文本。** 一个工具返回了 5 万字的网页,点开那一行页面就卡住。要么设阈值退化,要么放进 Web Worker。

## 学习资料

### 文档与文章

- [Eugene W. Myers · An O(ND) Difference Algorithm and Its Variations](http://www.xmailserver.org/diff2.pdf):1986 年的原始论文,git diff 默认算法的出处。读前两节和图 1 就够了,知道「编辑图」和「D 条路径」是什么,40 分钟。
- [James Coglan · The Myers diff algorithm](https://blog.jcoglan.com/2017/02/12/the-myers-diff-algorithm-part-1/):把 Myers 算法一步步画出来讲的系列博客,比论文好懂得多,先读第一篇,30 分钟。
- [Wikipedia · Longest common subsequence](https://en.wikipedia.org/wiki/Longest_common_subsequence):LCS 的定义、动态规划解法和复杂度,复习用,15 分钟。
- [jsdiff README](https://github.com/kpdecker/jsdiff):看 `diffWords` 的 `intlSegmenter` 参数说明,以及 `diffArrays`、`diffLines` 的区别,15 分钟。
- [MDN · Intl.Segmenter](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter):中文分词的浏览器原生 API,看 `granularity` 三个取值和示例,10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1TM4y1o7ug&autoplay=0&high_quality=1" title="最长公共子序列 编辑距离【基础算法精讲 19】" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>灵茶山艾府 · 最长公共子序列 编辑距离【基础算法精讲 19】 · 11 分钟,讲 LCS 和编辑距离的递推怎么想出来,正好对应今天的 dp 表。</figcaption>
</figure>

- 邋遢大哥233《[轻松掌握动态规划]5.最长公共子序列 LCS》(BV1ey4y1d7oD,21 分钟):动画一格一格填表,如果上面那个视频跟不上,先看这个。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/rE5h11FwiVw" title="What's the algorithm behind git diff?" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Tech With Nikola · What's the algorithm behind git diff? · 15 分钟,从 LCS 讲到 Myers,看完你就知道今天的实现在什么规模下该换算法。</figcaption>
</figure>

- DevPal《Diff Algorithm Explained | The texts comparison algorithm》(YouTube `9n8jI2267MM`,14 分钟):另一个角度的 diff 算法讲解,适合复习。

### 书籍

- Thomas H. Cormen 等《Introduction to Algorithms》第 4 版(MIT Press, 2022;中文版《算法导论》机械工业出版社):第 14 章「动态规划」的 14.4 节「最长公共子序列」(第 3 版是 15.4 节)。重点看为什么 LCS 有最优子结构,以及怎么从表里回溯出序列。

### 开源项目与代码

- [kpdecker/jsdiff](https://github.com/kpdecker/jsdiff):今天前端用的库,`src/diff/word.ts` 里能看到它怎么处理 CJK 字符和 `intlSegmenter`。
- [google/diff-match-patch](https://github.com/google/diff-match-patch):Google Docs 用过的 diff 库,有语义清理(semantic cleanup)功能,能把碎片化的 diff 合并得更好读,值得对比。
- [git/git · xdiff](https://github.com/git/git/tree/master/xdiff):git 自己的 diff 实现,`xdiffi.c` 里是 Myers 算法,`xpatience.c` 和 `xhistogram.c` 是另外两种策略。只读文件开头的注释就有收获。

## 自测

1. 为什么 LLM 步不能用输入算签名?我们用什么代替?

<details><summary>答案</summary>

LLM 步的输入是累积的对话历史,前面任何一步有一点不同,后面每一步的输入都不同,对齐会从第一处分歧开始全部失效。我们用模型这一步的决定代替:请求了哪些工具(按名字排序),或者直接回答(`<answer>`)。

</details>

2. 两层对齐里,第二层为什么只用 `kind + name`?如果第二层也用完整签名会怎样?

<details><summary>答案</summary>

第二层的目的就是把「同一个位置、同一个工具、参数不同」的步骤配成 changed。完整签名在第一层已经用过了,空隙里的步骤正是完整签名对不上的,第二层再用完整签名不会配上任何东西,结果又退化成一红一绿两行。

</details>

3. 两次运行的最终回答措辞不同,对齐结果是什么?界面上应该怎么显示?

<details><summary>答案</summary>

两步签名都是 `llm:chat:<answer>`,对齐为 same,但 `content_changed` 为 True。界面上要显示成「相同(内容有变)」并允许展开逐词 diff,不能只写「相同」,否则用户会以为回答没变。

</details>

4. 对比页第一版偶尔出现 B 列整列为空,可能是什么原因?怎么修?

<details><summary>答案</summary>

异步请求的竞态。开发模式下 StrictMode 会执行两次 effect,用户切换参数时也会发多轮请求,旧请求的结果可能晚于新一轮的状态重置写进来。修法是在 effect 里设一个 `stale` 标记,cleanup 时置为 true,请求回来先检查,过期的结果直接丢掉。也可以用 AbortController 取消旧请求。

</details>

5. 为什么对比接口只返回下标和一句话摘要,不返回步骤的完整内容?摘要为什么在后端算?

<details><summary>答案</summary>

一条长运行的完整内容可能有几 MB,大部分行用户不会点开,展开时再用单步接口 `/api/runs/{id}/steps/{idx}` 取就够了。摘要在后端算,是因为前端拿到的是轻步骤(没有 input/output),自己算就得把全部内容拉下来;后端为了算签名本来就读了完整的 Trace,顺手生成摘要几乎没有额外成本。

</details>

6. 资深面试题:你的 Agent 调试工具支持对比两次运行。客户反馈说他们的运行有两三万步(长时间跑的数据处理 Agent),对比页打不开。你会怎么分析和改进?

<details><summary>答案</summary>

先量化:是后端对齐慢、传输数据大、还是前端渲染卡。对齐方面,LCS 是 O(n·m),两万对两万是四亿格子,必然不行。可以换 Myers(复杂度和差异数量成正比,相似运行很快),或者分层对齐:先按 LLM 步把运行切成「轮」,在轮的序列上对齐,再只对有变化的轮做步级对齐;还可以先用前缀和后缀剪掉完全相同的头尾(重跑出来的运行前缀往往完全一样)。传输方面,只返回非 same 的行和统计,same 行用区间表示。前端用 Day 114 的虚拟列表,默认只看不同。最后要设上限和降级策略,比如超过多少步只给统计、不给逐步对齐,并在界面上说清楚。讲的时候要带上测量数据和取舍,而不是直接说「换个更快的算法」。

</details>

## 明天预告

对比页现在有了,但两次运行还得你自己去造。明天(Day 117)做 Agent Loupe 最有意思的功能:**从任意一步改参数重跑**。你在第 3 步发现模型做了个糟糕的决定,改一下系统提示词,从第 3 步重新跑,前面的步骤原样保留,工具结果从原运行里回放,不用真的再查一遍天气、再扣一次款。跑完自动跳到今天做的对比页。
