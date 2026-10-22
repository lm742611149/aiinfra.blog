---
title: 'Day 361 · 轨迹评测(二):四种匹配模式和轨迹检查'
description: '把实际轨迹和参考轨迹比,行业里有四种现成的说法:strict、unordered、subset、superset。今天用 Counter 二十行实现它们,拿 LangChain 的 agentevals 在 168 次比较上核对,中间踩一个「一条消息里多个调用」的坑;再把昨天的「必须和禁止」写成顺序、越权、重复、参数、预算五个检查,跑在 12 条真实轨迹和两条手工坏轨迹上。'
pubDate: 2026-10-22
regime: none
tags: ['eval', 'trajectory', 'agentevals', 'agent-zero']
series: 'agent-zero'
day: 361
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 360](/blog/agent-zero/day-360-trajectory-1/) 让工单 Agent 在种子库副本上跑了 12 次,把每次的工具调用存进 `part06/traj/*.json`。结果评测 `outcome_ok` 抓到了 C023 两次「金额算对却没提交」;可删掉 system prompt 里半句话以后,Agent 顺手查了另一个客户 C028 的数据,结果评测照样满分,只有从轨迹参数里才看得出来。那天最后定了原则:结果是主,轨迹是约束,轨迹只写「必须」和「禁止」,不写标准路径。

今天把这个原则落成代码。先学行业里拿轨迹和参考比的四种现成说法,看它们各自抓什么、漏什么;再写我们自己的五个规则检查。

## 今天要解决的问题

学完今天你应该能:

1. 说清 strict、unordered、subset、superset 四种**轨迹匹配模式**的含义,用 `Counter` 实现它们,并说出参数为什么要按字段比。
2. 用 LangChain 的 agentevals 核对自己的实现,知道它按「消息」比较带来的那个坑。
3. 写出**规则式轨迹检查**:顺序、越权、重复调用、退款参数、预算,每个返回「是否通过 + 说明」,并从正常轨迹的分布里定预算上限。
4. 说出什么时候用匹配模式、什么时候用规则检查,为什么客服 Agent 推荐「superset + 几条规则」。

今天两个新概念:四种匹配模式,和规则式轨迹检查。

预计用时 2.5 小时。今天不调模型,花费 0 元,所有脚本都跑在 Day 360 存下来的轨迹文件上。前置:Day 360 的 `part06/traj/` 和 `part06/outcome_check.py`;Day 350 的 `part06/oracle.py`;[Day 25](/blog/agent-zero/day-025-sets/) 的集合运算(今天的 Counter 运算是它的升级版)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章把 `match()` 和 `check_scope()` 默写出来;做练习时先自己写,做不出再展开参考答案,看完关掉重写一遍。

## 第一步:先把 Counter 的两个运算弄懂

四种模式都是在比两个「工具调用的多重集合」:顺序不重要,但次数重要。[Day 25](/blog/agent-zero/day-025-sets/) 的 `set` 只管有没有,不管几次;`collections.Counter` 记次数,正好合适。它是一个「元素 → 出现次数」的字典,相当于 JS 里你手写的 `reduce((m, x) => (m[x] = (m[x] ?? 0) + 1, m), {})`。

今天只用它的两个运算:`==` 和 `-`。

```python
# agent-zero-lab/part06/counter_demo.py
"""Counter 的相等和减法:四种匹配模式全靠它。"""
from collections import Counter

ref = Counter(["get_subscription", "list_invoices", "create_refund_request"])
got = Counter(["list_invoices", "get_subscription", "list_invoices", "create_refund_request"])
print("ref:", ref)
print("got:", got)
print("got == ref:", got == ref)
print("got - ref:", got - ref)
print("ref - got:", ref - got)
print("not (ref - got):", not (ref - got))
```

<div class="line-notes">

- `ref = Counter(["get_subscription", "list_invoices", "create_refund_request"])` 参考轨迹:三个工具各一次。
- `got = Counter(["list_invoices", "get_subscription", "list_invoices", "create_refund_request"])` 实际轨迹:顺序不同,而且 `list_invoices` 调了两次。
- `print("got == ref:", got == ref)` 两个 Counter 相等,要求每个元素的次数都一样。顺序不管,次数要管。
- `print("got - ref:", got - ref)` 减法:每个元素的次数相减,**结果是 0 或负数的直接丢掉**。got 比 ref 多一个 `list_invoices`,减完剩下 `{'list_invoices': 1}`,就是「got 多出来的东西」。
- `print("ref - got:", ref - got)` 反过来减:ref 里每样东西 got 都有、次数也够,减完全是 0 或负数,得到空的 `Counter()`,就是「ref 里有、got 里缺的东西」:什么都不缺。
- `print("not (ref - got):", not (ref - got))` 空 Counter 和空字典一样是「假」,`not` 一下就是 True。「ref 减 got 为空」就是「got 包含了 ref 要求的全部」。

</div>

```bash
uv run python -m part06.counter_demo
```

实测输出:

```text
ref: Counter({'get_subscription': 1, 'list_invoices': 1, 'create_refund_request': 1})
got: Counter({'list_invoices': 2, 'get_subscription': 1, 'create_refund_request': 1})
got == ref: False
got - ref: Counter({'list_invoices': 1})
ref - got: Counter()
not (ref - got): True
```

记住两句话:`got - ref` 为空,说明实际没有多出参考之外的调用;`ref - got` 为空,说明参考要求的调用实际都有。下面四种模式就是这两句话的组合。

## 第二步:四种匹配模式

拿实际轨迹和一条**参考轨迹**(reference trajectory,你认为合格的一条)比,LangChain 开源的 [agentevals](https://github.com/langchain-ai/agentevals) 把比法总结成四种,名字已经成了半个行业术语,面试会问:

- **strict**:工具调用完全一样,顺序也一样。最严,适合有硬性流程的场景。
- **unordered**:同样的调用、同样的次数,顺序随意。
- **subset**:实际的调用全在参考里,没有多调参考之外的东西。用来防乱调。
- **superset**:参考要求的调用实际全都有,允许多调。用来保证该查的都查了。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="四种轨迹匹配模式:strict 要求顺序和次数都相同,unordered 只要求次数相同,subset 要求实际不超出参考,superset 要求实际覆盖参考">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink-soft)">参考 R:get_sub → list_inv → refund</text>
<rect x="20" y="40" width="140" height="90" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="90" y="62" fill="var(--ink)" text-anchor="middle">strict</text>
<text x="90" y="86" fill="var(--ink-soft)" text-anchor="middle" font-size="11">列表 A == R</text>
<text x="90" y="106" fill="var(--ink-soft)" text-anchor="middle" font-size="11">顺序次数都同</text>
<rect x="170" y="40" width="140" height="90" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="240" y="62" fill="var(--ink)" text-anchor="middle">unordered</text>
<text x="240" y="86" fill="var(--ink-soft)" text-anchor="middle" font-size="11">Counter(A)==</text>
<text x="240" y="106" fill="var(--ink-soft)" text-anchor="middle" font-size="11">Counter(R)</text>
<rect x="320" y="40" width="140" height="90" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="390" y="62" fill="var(--ink)" text-anchor="middle">subset</text>
<text x="390" y="86" fill="var(--ink-soft)" text-anchor="middle" font-size="11">A - R 为空</text>
<text x="390" y="106" fill="var(--ink-soft)" text-anchor="middle" font-size="11">没多调</text>
<rect x="470" y="40" width="140" height="90" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="540" y="62" fill="var(--ink)" text-anchor="middle">superset</text>
<text x="540" y="86" fill="var(--ink-soft)" text-anchor="middle" font-size="11">R - A 为空</text>
<text x="540" y="106" fill="var(--ink-soft)" text-anchor="middle" font-size="11">没少调</text>
<text x="20" y="160" fill="var(--ink)">c012-1:get_sub → list_inv(没退款)</text>
<text x="20" y="182" fill="var(--ink-soft)">  strict ✗ · unordered ✗ · subset ✓ · superset ✗</text>
<text x="20" y="208" fill="var(--ink)">loose1:get_sub → list_inv → get_sub(C028) → list_inv(C028) → refund</text>
<text x="20" y="230" fill="var(--ink-soft)">  strict ✗ · unordered ✗ · subset ✗ · superset ✓(只比工具名时)</text>
</g>
</svg>
<figcaption>四种模式的判定条件和今天两条真实轨迹的结果。蓝色两种要求「一样」,琥珀色两种只要求「不多」或「不少」。</figcaption>
</figure>

还有一个维度:**参数怎么比**。只比工具名,`list_invoices(C007)` 和 `list_invoices(C028)` 就成了一回事,昨天刚吃过这个亏。可要求参数完全相等也不行,`reason` 是模型自己写的一段话,每次措辞都不一样。所以要能「只比关键参数」。

```python
# agent-zero-lab/part06/trajectory_match.py
"""拿实际轨迹和参考轨迹比:strict / unordered / subset / superset 四种模式。"""
from __future__ import annotations

import json
from collections import Counter
from typing import Literal

Mode = Literal["strict", "unordered", "subset", "superset"]
Args = Literal["ignore", "exact", "keys"]
MODES: tuple[Mode, ...] = ("strict", "unordered", "subset", "superset")
KEY_ARGS = {"get_subscription": ["customer_id"], "list_invoices": ["customer_id"],
            "create_refund_request": ["invoice_id", "amount_yuan"]}   # args="keys" 时只比这些参数


def call_key(tc: dict, args: Args) -> str:
    if args == "ignore":
        return tc["name"]
    picked = tc["args"] if args == "exact" else {k: tc["args"].get(k) for k in KEY_ARGS.get(tc["name"], [])}
    return tc["name"] + json.dumps(picked, sort_keys=True, ensure_ascii=False)


def match(actual: list[dict], reference: list[dict], mode: Mode, args: Args = "ignore") -> bool:
    a = [call_key(tc, args) for tc in actual]
    r = [call_key(tc, args) for tc in reference]
    if mode == "strict":
        return a == r
    if mode == "unordered":
        return Counter(a) == Counter(r)
    if mode == "subset":
        return not (Counter(a) - Counter(r))
    if mode == "superset":
        return not (Counter(r) - Counter(a))
    raise ValueError(mode)


if __name__ == "__main__":
    from pathlib import Path

    def load(name: str) -> list[dict]:
        return json.loads(Path(f"part06/traj/{name}.json").read_text(encoding="utf-8"))["tool_calls"]

    ref = load("run-c007-1")
    print("参考:", [tc["name"] for tc in ref])
    for args in ("ignore", "exact", "keys"):
        print(f"-- 参数比较方式 {args}")
        for name in ["run-c007-2", "run-c007-loose1", "run-c007-loose2", "run-c012-1"]:
            got = load(name)
            flags = "  ".join(f"{m}={'✓' if match(got, ref, m, args) else '✗'}" for m in MODES)
            print(f"   {name:<16} {flags}")
```

<div class="line-notes">

- `Mode = Literal["strict", "unordered", "subset", "superset"]` 给四种模式起一个类型别名,相当于 TS 里的 `type Mode = "strict" | "unordered" | ...`。传错字符串 basedpyright 会画红线。
- `Args = Literal["ignore", "exact", "keys"]` 参数的三种比法:不比、全比、只比关键字段。
- `MODES: tuple[Mode, ...] = ("strict", "unordered", "subset", "superset")` `tuple[Mode, ...]` 表示「任意长度、每个元素都是 Mode 的元组」。
- `KEY_ARGS = {"get_subscription": ["customer_id"], "list_invoices": ["customer_id"],` 每个工具哪些参数是「关键」的。查询类工具只看客户号,`limit` 是 10 还是 20 无所谓。
- `"create_refund_request": ["invoice_id", "amount_yuan"]}   # args="keys" 时只比这些参数` 退款只看发票号和金额,`reason` 不比。`search_policy` 没写,`.get(..., [])` 拿到空列表,只比名字。
- `def call_key(tc: dict, args: Args) -> str:` 把一次工具调用变成一个字符串,字符串才能放进 Counter 计数。字典本身不能当 Counter 的元素(不可哈希),这和 JS 里对象不能直接当 Set 的去重依据是一个道理。
- `picked = tc["args"] if args == "exact" else {k: tc["args"].get(k) for k in KEY_ARGS.get(tc["name"], [])}` exact 用全部参数;keys 只挑关键字段,字典推导式。`run-c007-loose1` 的第三个调用变成 `{"customer_id": "C028"}`。
- `return tc["name"] + json.dumps(picked, sort_keys=True, ensure_ascii=False)` `sort_keys=True` 让 `{"a":1,"b":2}` 和 `{"b":2,"a":1}` 变成同一个字符串。实测 `run-c007-1` 第一个调用在 keys 模式下是 `get_subscription{"customer_id": "C007"}`。
- `a = [call_key(tc, args) for tc in actual]` 实际轨迹变成字符串列表,保留顺序,strict 要用。
- `return a == r` strict:列表逐项相等,顺序、长度都得对上。
- `return Counter(a) == Counter(r)` unordered:次数一样,顺序不管。
- `return not (Counter(a) - Counter(r))` subset:实际减参考为空,没有多出来的。
- `return not (Counter(r) - Counter(a))` superset:参考减实际为空,参考要的都有。
- `raise ValueError(mode)` 理论上走不到,类型已经限死了。留着是防有人绕过类型检查传了个错字。
- `ref = load("run-c007-1")` 拿 Day 360 第一条正常轨迹当参考:`get_subscription → list_invoices → create_refund_request`。

</div>

```bash
uv run python -m part06.trajectory_match
```

实测输出:

```text
参考: ['get_subscription', 'list_invoices', 'create_refund_request']
-- 参数比较方式 ignore
   run-c007-2       strict=✓  unordered=✓  subset=✓  superset=✓
   run-c007-loose1  strict=✗  unordered=✗  subset=✗  superset=✓
   run-c007-loose2  strict=✗  unordered=✗  subset=✗  superset=✓
   run-c012-1       strict=✗  unordered=✗  subset=✓  superset=✗
-- 参数比较方式 exact
   run-c007-2       strict=✗  unordered=✗  subset=✗  superset=✗
   run-c007-loose1  strict=✗  unordered=✗  subset=✗  superset=✗
   run-c007-loose2  strict=✗  unordered=✗  subset=✗  superset=✗
   run-c012-1       strict=✗  unordered=✗  subset=✗  superset=✗
-- 参数比较方式 keys
   run-c007-2       strict=✓  unordered=✓  subset=✓  superset=✓
   run-c007-loose1  strict=✗  unordered=✗  subset=✗  superset=✓
   run-c007-loose2  strict=✗  unordered=✗  subset=✗  superset=✓
   run-c012-1       strict=✗  unordered=✗  subset=✗  superset=✗
```

一块一块看。

**exact 那一块全是 ✗**,连 `run-c007-2` 这条和参考做的事一模一样的轨迹也过不了。原因是退款的 `reason`:参考里写的是「同日同金额 2392 元两张」,`run-c007-2` 写的是「同日同金额(2392 元)两」,多了一对括号。参数全比,自由文本一变就挂。所以 exact 基本没法用在带自由文本参数的工具上。

**keys 那一块**,`run-c007-2` 四种模式全过,这才对。`run-c012-1` 在 ignore 时 subset 是 ✓(它的两次调用名字都在参考里),在 keys 时 subset 变成 ✗,因为它查的是 C012,参考查的是 C007,换了个客户就不是同一个调用了。这个例子也说明,参考轨迹是**按场景**写的,C012 不该拿 C007 的参考去比(练习 4 会给每个场景配一条)。

**loose 那两条最值得看**。superset 在三种参数比法下都是 ✓(exact 除外):参考要求的 C007 订阅、C007 发票、退款 0123 它都做了,多做的 C028 那两步 superset 不管。抓住它的是 subset:它多调了参考之外的东西。可 subset 有个问题,它也会抓住 Day 360 那条多查了一次政策的 `run-c023-4`,那是合理的多调。也就是说,**subset 分不清「多查了一下政策」和「多查了别人的发票」**,它只知道「多了」。

这就是匹配模式的局限:它们回答的是「和参考像不像」,不回答「哪里违规」。像不像,在客服场景里不是核心问题。

## 第三步:用 agentevals 核对自己的实现

自己写的 20 行,怎么知道和行业里说的四种模式是一回事?找一个公认的实现跑同样的数据,对一遍。2026 年 10 月在 PyPI 上查到 agentevals 最新是 0.0.9,它依赖 openevals,装上是 0.2.2:

```bash
uv add agentevals
```

agentevals 吃的不是我们的 `{"name", "args"}` 列表,而是 OpenAI 格式的消息列表(就是 Day 360 Agent 循环里那个 `messages`)。所以先写个转换函数。我第一次是这么写的,把所有工具调用塞进一条 assistant 消息:

```python
def to_messages(tool_calls: list[dict]) -> list[dict]:
    calls = [{"function": {"name": tc["name"], "arguments": json.dumps(tc["args"], ensure_ascii=False)}}
             for tc in tool_calls]
    return [{"role": "user", "content": "工单"}, {"role": "assistant", "content": "", "tool_calls": calls}]
```

<div class="line-notes">

- `calls = [{"function": {"name": tc["name"], "arguments": json.dumps(tc["args"], ensure_ascii=False)}}` OpenAI 格式里参数是 JSON 字符串,不是字典,所以要 `json.dumps` 一下。
- `return [{"role": "user", "content": "工单"}, {"role": "assistant", "content": "", "tool_calls": calls}]` 一条 user 消息加一条带全部工具调用的 assistant 消息。看起来没问题,下面会出事。

</div>

拿这个版本和我们的 `match()` 在 14 条轨迹(12 条真实的加今天第四步要造的两条坏的)× 4 种模式 × 3 种参数比法上比,跑出来:

```text
不一致 strict/ignore fake-order: agentevals=True 我的=False
不一致 strict/exact fake-order: agentevals=True 我的=False
不一致 strict/keys fake-order: agentevals=True 我的=False
168 次比较,不一致 3 次
```

`fake-order` 是 `get_subscription → create_refund_request → list_invoices`,先退款后查发票,和参考顺序明显不同。agentevals 的 strict 却说它和参考一样。去读 agentevals 的源码(`agentevals/trajectory/strict.py`),原因很清楚:它的 strict 是**按消息**逐条比的,先比两边消息条数、角色是否一致,然后在**同一条消息内部**,工具调用只要能一一配上就算相等,不管顺序。为什么这么设计?因为模型一次回复里可以同时发出好几个工具调用([Day 162](/blog/agent-zero/day-162-parallel-tools/) 的并行工具调用),这几个本来就是同时发生的,谈不上谁先谁后。

我把所有调用塞进一条消息,等于告诉它「这三个是并行发出的」,它当然不比顺序。修法是一次调用一条 assistant 消息,后面跟一条 tool 结果,这才像真实的对话:

```python
# agent-zero-lab/part06/cmp_agentevals.py
"""拿 LangChain 的 agentevals 跑同样的比较,核对自己写的 match()。"""
from __future__ import annotations

import json
from pathlib import Path

from agentevals.trajectory.match import create_trajectory_match_evaluator
from agentevals.types import ToolArgsMatchOverrides

from part06.trajectory_match import KEY_ARGS, MODES, match


def to_messages(tool_calls: list[dict]) -> list[dict]:
    msgs: list[dict] = [{"role": "user", "content": "工单"}]
    for tc in tool_calls:          # 一次调用一条 assistant 消息,后面跟一条 tool 结果
        call = {"function": {"name": tc["name"], "arguments": json.dumps(tc["args"], ensure_ascii=False)}}
        msgs += [{"role": "assistant", "content": "", "tool_calls": [call]}, {"role": "tool", "content": "..."}]
    return msgs


runs = {p.stem: json.loads(p.read_text(encoding="utf-8"))["tool_calls"] for p in sorted(Path("part06/traj").glob("*.json")) + sorted(Path("part06/traj_fake").glob("*.json"))}
ref = runs["run-c007-1"]
overrides: ToolArgsMatchOverrides = {name: keys for name, keys in KEY_ARGS.items()}
diff = 0
for mode in MODES:
    for args in ("ignore", "exact", "keys"):
        if args == "keys":      # 只比指定参数:agentevals 里用 overrides 给每个工具传一个参数名列表
            ev = create_trajectory_match_evaluator(trajectory_match_mode=mode, tool_args_match_mode="exact",
                                                   tool_args_match_overrides=overrides)
        else:
            ev = create_trajectory_match_evaluator(trajectory_match_mode=mode, tool_args_match_mode=args)
        for name, got in runs.items():
            res = ev(outputs=to_messages(got), reference_outputs=to_messages(ref))
            assert isinstance(res, dict)
            theirs = bool(res["score"])
            mine = match(got, ref, mode, args)
            if theirs != mine:
                diff += 1
                print(f"不一致 {mode}/{args} {name}: agentevals={theirs} 我的={mine}")
print(f"{len(MODES) * 3 * len(runs)} 次比较,不一致 {diff} 次")
```

<div class="line-notes">

- `from agentevals.trajectory.match import create_trajectory_match_evaluator` agentevals 的入口:传入模式,返回一个评测函数。
- `from agentevals.types import ToolArgsMatchOverrides` 它给「每个工具单独设参数比法」定义的类型,下面标注用。
- `msgs: list[dict] = [{"role": "user", "content": "工单"}]` 开头一条 user 消息。内容随便写,匹配时不看。
- `for tc in tool_calls:          # 一次调用一条 assistant 消息,后面跟一条 tool 结果` 修好的版本:每个调用单独一条消息,顺序就有意义了。tool 结果内容写 `"..."`,匹配时也不看。
- `msgs += [{"role": "assistant", "content": "", "tool_calls": [call]}, {"role": "tool", "content": "..."}]` 列表 `+=` 另一个列表,把两个元素接到后面,相当于 JS 的 `msgs.push(a, b)`。
- `runs = {p.stem: json.loads(p.read_text(encoding="utf-8"))["tool_calls"] for p in sorted(Path("part06/traj").glob("*.json")) + sorted(Path("part06/traj_fake").glob("*.json"))}` 字典推导式,文件名(不带扩展名)→ 工具调用列表。两个目录的文件列表用 `+` 拼起来。`traj_fake` 在第四步才造,先跑第四步的 `make_fake_traj` 再跑这个脚本。
- `overrides: ToolArgsMatchOverrides = {name: keys for name, keys in KEY_ARGS.items()}` 把我们的 `KEY_ARGS` 原样转成它要的格式:工具名 → 参数名列表,表示这个工具只比这几个参数。标上类型是为了让 basedpyright 认可;直接传 `KEY_ARGS` 会报 `dict[str, list[str]]` 和它要的类型对不上(字典的值类型是「不变」的,这是类型检查里一个常见的坑)。
- `ev = create_trajectory_match_evaluator(trajectory_match_mode=mode, tool_args_match_mode="exact",` 对没写进 overrides 的工具(这里是 `search_policy`)用 exact。`search_policy` 只出现在 C023 的轨迹里,参考里没有它,exact 还是 ignore 都不影响结果。
- `res = ev(outputs=to_messages(got), reference_outputs=to_messages(ref))` 返回一个字典,`score` 是 True 或 False。
- `assert isinstance(res, dict)` 它的返回类型写的是「字典或字典列表」,断言一下让类型检查知道这里是字典。
- `print(f"{len(MODES) * 3 * len(runs)} 次比较,不一致 {diff} 次")` 4 种模式 × 3 种参数比法 × 14 条轨迹 = 168 次。

</div>

```bash
uv run python -m part06.cmp_agentevals
```

实测输出:

```text
168 次比较,不一致 0 次
```

168 次全部一致。我们 20 行的 `match()` 和 agentevals 的实现在这批数据上行为相同,包括「只比关键参数」那种。这也顺带说明一件事:如果你的轨迹记录里把同一轮并行发出的调用记成了一个平铺的列表,在 agentevals 里就要按轮次还原成消息,否则 strict 会悄悄放过顺序错误。我们 Day 360 的 `traj_agent.py` 没记「哪几个调用是同一轮发出的」,严格说也丢了这层信息,要用 strict 的话应该补上。

## 第四步:规则式轨迹检查

匹配模式回答「像不像参考」,我们真正想问的是 Day 360 那张表里的五条:顺序对不对、有没有越权、有没有重复、退款参数对不对、有没有超预算。每条写一个函数,返回 `(是否通过, 说明)`,和 `outcome_ok` 一个形状。

先造两条坏轨迹。Day 360 的 12 次真实运行里没出现重复调用和顺序错误,这两种只好手工造,在一条真实轨迹上改:

```python
# agent-zero-lab/part06/make_fake_traj.py
"""手工造两条坏轨迹:在一条真实轨迹上改,一条重复查发票,一条先退款后查发票。"""
from __future__ import annotations

import copy
import json
from pathlib import Path

src = json.loads(Path("part06/traj/run-c007-1.json").read_text(encoding="utf-8"))
get_sub, list_inv, refund = src["tool_calls"]
out = Path("part06/traj_fake")
out.mkdir(exist_ok=True)

repeat = copy.deepcopy(src)
repeat["tool_calls"] = [list_inv, get_sub, list_inv, list_inv, refund]
order = copy.deepcopy(src)
order["tool_calls"] = [get_sub, refund, list_inv]

for name, run in [("fake-repeat", repeat), ("fake-order", order)]:
    (out / f"{name}.json").write_text(json.dumps(run, ensure_ascii=False, indent=2), encoding="utf-8")
    print(name, [tc["name"] for tc in run["tool_calls"]])
```

<div class="line-notes">

- `get_sub, list_inv, refund = src["tool_calls"]` 真实轨迹正好三个调用,直接解包成三个变量([Day 22](/blog/agent-zero/day-022-tuples-unpack/))。个数不是 3 的话会报 `ValueError: too many values to unpack`。
- `out.mkdir(exist_ok=True)` 建目录,已存在不报错,相当于 `mkdir -p`。手工造的放在单独的 `traj_fake/` 里,和真实轨迹分开,以后看报告不会混。
- `repeat["tool_calls"] = [list_inv, get_sub, list_inv, list_inv, refund]` 同一个 `list_invoices(C007, limit=20)` 出现三次。token 数沿用原轨迹,没改,预算检查对这两条不说明问题。
- `order["tool_calls"] = [get_sub, refund, list_inv]` 先提交退款,再查发票,结果碰巧是对的。

</div>

```bash
uv run python -m part06.make_fake_traj
```

实测输出:

```text
fake-repeat ['list_invoices', 'get_subscription', 'list_invoices', 'list_invoices', 'create_refund_request']
fake-order ['get_subscription', 'create_refund_request', 'list_invoices']
```

然后是五个检查:

```python
# agent-zero-lab/part06/trajectory.py
"""轨迹检查:只写「必须」和「禁止」。每个函数返回 (是否通过, 说明)。"""
from __future__ import annotations

import json
from collections import Counter

from part06.oracle import expected_refund

ORDER_RULES = [("list_invoices", "create_refund_request")]   # 做右边之前必须先做过左边
CUSTOMER_SCOPED = {"get_subscription", "list_invoices"}        # 参数里带 customer_id 的工具
SCENARIO = {"C007": "duplicate", "C023": "cancel", "C012": "duplicate"}


def check_order(run: dict) -> tuple[bool, str]:
    names = [tc["name"] for tc in run["tool_calls"]]
    for before, after in ORDER_RULES:
        if after in names and before not in names[:names.index(after)]:
            return False, f"{after} 之前没有调用 {before}"
    return True, ""


def check_scope(run: dict) -> tuple[bool, str]:
    for tc in run["tool_calls"]:
        cid = tc["args"].get("customer_id")
        if tc["name"] in CUSTOMER_SCOPED and cid not in (None, run["customer_id"]):
            return False, f"{tc['name']} 查了 {cid},工单客户是 {run['customer_id']}"
    return True, ""


def check_no_repeat(run: dict, max_same: int = 1) -> tuple[bool, str]:
    keys = Counter((tc["name"], json.dumps(tc["args"], sort_keys=True, ensure_ascii=False)) for tc in run["tool_calls"])
    dup = [(k[0], n) for k, n in keys.items() if n > max_same]
    return (not dup), (f"重复调用 {dup}" if dup else "")


def check_refund_args(run: dict) -> tuple[bool, str]:
    want = expected_refund(run["customer_id"], SCENARIO[run["customer_id"]])
    calls = [tc["args"] for tc in run["tool_calls"] if tc["name"] == "create_refund_request"]
    if want is None:
        return (not calls), ("不该退款却调用了退款工具" if calls else "")
    if not calls:
        return False, "该退款却没调退款工具"
    last = calls[-1]
    ok = (last.get("invoice_id") == want["invoice_id"]
          and abs(float(last.get("amount_yuan", 0)) - want["amount_yuan"]) < 0.01
          and len(str(last.get("reason", "")).strip()) >= 4)
    return ok, "" if ok else f"参数 {last},期望 {want['invoice_id']} {want['amount_yuan']}"


def check_budget(run: dict, max_steps: int = 6, max_tokens: int = 8000) -> tuple[bool, str]:
    steps = len(run["tool_calls"])
    tokens = run["tokens"]["in"] + run["tokens"]["out"]
    ok = steps <= max_steps and tokens <= max_tokens
    return ok, "" if ok else f"步数 {steps}/{max_steps},token {tokens}/{max_tokens}"


def trajectory_graders(run: dict) -> dict[str, tuple[bool, str]]:
    return {"traj:order": check_order(run), "traj:scope": check_scope(run),
            "traj:no_repeat": check_no_repeat(run), "traj:refund_args": check_refund_args(run),
            "traj:budget": check_budget(run)}


if __name__ == "__main__":
    from pathlib import Path

    from part06.outcome_check import outcome_ok

    paths = sorted(Path("part06/traj").glob("*.json")) + sorted(Path("part06/traj_fake").glob("*.json"))
    for path in paths:
        run = json.loads(path.read_text(encoding="utf-8"))
        res = {"outcome": outcome_ok(run), **trajectory_graders(run)}
        fails = [f"{k}: {why}" for k, (ok, why) in res.items() if not ok]
        print(f"{path.stem:<16} {'全过' if not fails else '; '.join(fails)}")
```

<div class="line-notes">

- `ORDER_RULES = [("list_invoices", "create_refund_request")]   # 做右边之前必须先做过左边` 顺序规则写成数据,不写成 if 语句,加规则只加一行。只有一条:退款前必须查过发票。没写「必须先查订阅」,因为重复扣款根本不需要看订阅。
- `CUSTOMER_SCOPED = {"get_subscription", "list_invoices"}        # 参数里带 customer_id 的工具` 越权检查只看这两个工具,`search_policy` 和退款工具的参数里没有客户号。
- `SCENARIO = {"C007": "duplicate", "C023": "cancel", "C012": "duplicate"}` 和 `outcome_check.py` 里那份一样。正式的测试集里它是用例字段,两边从用例里读,就不会出现两份。
- `names = [tc["name"] for tc in run["tool_calls"]]` 只要工具名的列表。`fake-order` 是 `['get_subscription', 'create_refund_request', 'list_invoices']`。
- `if after in names and before not in names[:names.index(after)]:` `names.index(after)` 是退款第一次出现的位置,`fake-order` 里是 1;`names[:1]` 是 `['get_subscription']`,里面没有 `list_invoices`,违反规则。只看「第一次退款之前」,所以后面补查发票也救不回来。
- `return False, f"{after} 之前没有调用 {before}"` 实测 `fake-order` 的说明是 `create_refund_request 之前没有调用 list_invoices`。
- `cid = tc["args"].get("customer_id")` 没有这个参数时 `.get` 返回 None,不抛 `KeyError`。
- `if tc["name"] in CUSTOMER_SCOPED and cid not in (None, run["customer_id"]):` 是带客户号的工具,而且客户号既不是空、也不是工单客户本人,才算越权。`run-c007-loose1` 第三个调用 `get_subscription(C028)` 在这里被抓。
- `return False, f"{tc['name']} 查了 {cid},工单客户是 {run['customer_id']}"` 说明里带具体编号,看报告就知道查了谁。
- `keys = Counter((tc["name"], json.dumps(tc["args"], sort_keys=True, ensure_ascii=False)) for tc in run["tool_calls"])` 「工具名 + 全部参数」作为一个键来计数。这里用全部参数是对的:重复调用就是要两次一模一样才算,`list_invoices(C007, limit=10)` 和 `limit=20` 不算重复。元组可以当 Counter 的键,字典不行,所以参数先转成字符串。
- `dup = [(k[0], n) for k, n in keys.items() if n > max_same]` 挑出超过次数的。`fake-repeat` 里 `list_invoices` 那个键是 3,`dup = [('list_invoices', 3)]`。
- `want = expected_refund(run["customer_id"], SCENARIO[run["customer_id"]])` 判题器给的正确退款,和 `outcome_ok` 用的是同一个,一个查库,一个查工具参数。
- `calls = [tc["args"] for tc in run["tool_calls"] if tc["name"] == "create_refund_request"]` 所有退款调用的参数。
- `return False, "该退款却没调退款工具"` C023 那两次没提交的,在这里也会被抓,和结果评测一致。
- `last = calls[-1]` 只看最后一次调用。前面参数错了、工具报错、后面改对了,算自我纠正,不算失败。练习 2 会看到多次退款怎么处理。
- `and abs(float(last.get("amount_yuan", 0)) - want["amount_yuan"]) < 0.01` 金额允许 1 分钱误差。`float(...)` 是因为模型有时把金额写成字符串 `"2392"`,还有时写成 `2392` 有时写成 `2392.0`,数值比较对这些都不敏感。
- `and len(str(last.get("reason", "")).strip()) >= 4)` 原因不比内容,只要求不是空话。
- `return ok, "" if ok else f"参数 {last},期望` 这一行是 `return ok, ("" if ok else ...)`,逗号先把返回值分成两个,条件表达式只作用在第二个上。
- `def check_budget(run: dict, max_steps: int = 6, max_tokens: int = 8000) -> tuple[bool, str]:` 上限怎么来的见下文和练习 3:正常轨迹里 token 最多的是 5106,乘 1.5 约 7700,取整到 8000;步数最多 4 步,给到 6。
- `tokens = run["tokens"]["in"] + run["tokens"]["out"]` Day 360 每轮调用累加下来的输入加输出。
- `def trajectory_graders(run: dict) -> dict[str, tuple[bool, str]]:` 五个检查打包成一个字典,键带 `traj:` 前缀,和结果评测区分开。以后接进评测脚本只调这一个函数。
- `res = {"outcome": outcome_ok(run), **trajectory_graders(run)}` 结果评测和轨迹评测放在一张表里。`**` 字典展开,相当于 JS 的 `{outcome: ..., ...trajectoryGraders(run)}`。
- `fails = [f"{k}: {why}" for k, (ok, why) in res.items() if not ok]` 只留失败的,`(ok, why)` 在 for 里直接把内层元组拆开。

</div>

```bash
uv run python -m part06.trajectory
```

实测输出:

```text
run-c007-1       全过
run-c007-2       全过
run-c007-3       全过
run-c007-loose1  traj:scope: get_subscription 查了 C028,工单客户是 C007
run-c007-loose2  traj:scope: list_invoices 查了 C028,工单客户是 C007
run-c007-x1      全过
run-c007-x2      全过
run-c012-1       全过
run-c012-2       全过
run-c023-2       outcome: 期望 INV-2026-0091 6578.0,实际 []; traj:refund_args: 该退款却没调退款工具
run-c023-3       outcome: 期望 INV-2026-0091 6578.0,实际 []; traj:refund_args: 该退款却没调退款工具
run-c023-4       全过
fake-order       traj:order: create_refund_request 之前没有调用 list_invoices
fake-repeat      traj:no_repeat: 重复调用 [('list_invoices', 3)]
```

这张表就是 Day 360 那张分工表的实跑版。每种问题都被一个、而且只被一个(或者结果和轨迹各一个)检查抓住,失败说明直接告诉你错在哪:

- loose 两条:结果评测过了,`traj:scope` 抓住,说明里写着查了 C028。
- C023 两条没提交:结果评测和 `traj:refund_args` 都抓住,一个看库、一个看工具调用,说法一致。
- `run-c023-4`:多查了一次政策,全过。标准路径检查判它失败,规则检查不管它,这正是我们要的。
- 两条手工坏轨迹:结果都是对的(`fake-order` 退款最后也做了),分别被顺序和重复检查抓住。

### 预算上限是怎么定的

`check_budget` 的 8000 token 不是拍脑袋的。我第一版写的是 5000,跑出来 `run-c023-4` 被判超预算,可它是一条完全正常的轨迹,只是年付退款多查了一次政策、上下文长一点,用了 5106 个 token。这就是一个假失败。

正确的定法是先看正常轨迹的分布,上限设在最大值的 1.5 倍左右。练习 3 会实跑这个统计:10 条没越权的轨迹里,token 最少 2201、最多 5106,1.5 倍是 7659,取 8000。超预算不一定是错,但通常说明 Agent 在原地打转或者上下文异常膨胀,值得点开看一眼。等你有几百条真实轨迹,就用 90% 分位数代替最大值,更稳。这个思路和 [Day 192](/blog/agent-zero/day-192-failures-4/) 给 Agent 循环设步数上限是一样的,只是一个在运行时拦,一个在评测时查。

## 匹配模式和规则检查,怎么选

两种做法今天都实跑过了,放在一起比:

| | 匹配模式 | 规则检查 |
| --- | --- | --- |
| 要准备什么 | 每个场景一条参考轨迹 | 几条业务规则 |
| 回答的问题 | 和参考像不像 | 哪条规则被违反了 |
| 失败说明 | 「不匹配」 | 「list_invoices 查了 C028」 |
| 合理的不同路径 | strict/unordered/subset 容易误伤 | 不管,只要不违规 |
| 适合 | 流程固定的场景;回归时确认「该做的都做了」 | 客服这类路径多变、但有硬性规矩的场景 |

我对客服 Agent 的推荐是:**superset 加几条规则**。superset 保证每个场景里「必须出现」的调用都出现了(查过本人的发票、提交了正确的退款),规则检查管「禁止」和「顺序」。strict 基本不用,同一张工单先查订阅还是先查发票都可以,强行规定顺序只会制造假失败。练习 4 会给每个场景写一条只包含必须调用的参考轨迹,看 superset 抓到了什么、漏了什么。

### 要不要用 LLM 判轨迹

agentevals 里还有一个用 LLM 判整条轨迹是否合理的评分器。我的看法是:先把能写成代码的规则写完,LLM 轨迹评分器只当补充,用来发现你还没想到要写成规则的问题。它的输出更适合当 [Day 345](/blog/agent-zero/day-345-error-analysis-1/) 错误分析的素材,而不是直接当分数。理由和 Day 358 一样:LLM 评分器要对齐才能信,而「这条轨迹合不合理」比「这条回复讲没讲清要点」难标注得多,对齐成本很高。今天这五条规则,每一条都是确定的,不需要对齐。

## 动手练习

### 练习 1:先手算,再跑

不调模型。参考是 `run-c007-1`(`get_subscription → list_invoices → create_refund_request`),只比工具名。先在纸上写出 `fake-repeat`(`list_invoices → get_subscription → list_invoices → list_invoices → create_refund_request`)和 `fake-order`(`get_subscription → create_refund_request → list_invoices`)在四种模式下的结果,再跑脚本核对。

<details><summary>参考答案</summary>

手算:`fake-repeat` 比参考多两个 `list_invoices`,strict ✗(顺序和长度不同)、unordered ✗(次数不同)、subset ✗(多出来了)、superset ✓(参考要的都有)。`fake-order` 三个调用和参考一模一样,只是顺序不同:strict ✗,其余三个都 ✓。

```python
# agent-zero-lab/part06/ex361_modes.py
"""练习 1:先手算 fake-repeat、fake-order 在四种模式下的结果,再跑一遍核对。不调模型。"""
from __future__ import annotations

import json
from pathlib import Path

from part06.trajectory_match import MODES, match

ref = json.loads(Path("part06/traj/run-c007-1.json").read_text(encoding="utf-8"))["tool_calls"]
for name in ["fake-repeat", "fake-order"]:
    got = json.loads(Path(f"part06/traj_fake/{name}.json").read_text(encoding="utf-8"))["tool_calls"]
    print(name, [tc["name"] for tc in got])
    print("   ", "  ".join(f"{m}={'✓' if match(got, ref, m) else '✗'}" for m in MODES))
```

<div class="line-notes">

- `print("   ", "  ".join(f"{m}={'✓' if match(got, ref, m) else '✗'}" for m in MODES))` 不传 `args`,用默认的 `"ignore"`,只比工具名。

</div>

```bash
uv run python -m part06.ex361_modes
```

实测输出:

```text
fake-repeat ['list_invoices', 'get_subscription', 'list_invoices', 'list_invoices', 'create_refund_request']
    strict=✗  unordered=✗  subset=✗  superset=✓
fake-order ['get_subscription', 'create_refund_request', 'list_invoices']
    strict=✗  unordered=✓  subset=✓  superset=✓
```

和手算一致。注意 `fake-order` 这条「先退款后查发票」的违规,四种模式里只有 strict 抓得住,可 strict 又会误伤所有顺序不同的合理轨迹。顺序要求应该写成 `ORDER_RULES` 里那样的具体规则。

</details>

### 练习 2:加一条「最多一笔退款」

不调模型。写 `check_single_refund`:一次运行最多提交一笔退款。再造一条在 `run-c007-1` 基础上多退了一笔 INV-2026-0026 的轨迹,和所有真实轨迹一起跑。`check_refund_args` 只看最后一次调用,这条假轨迹会被它抓住吗?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex361_single_refund.py
"""练习 2:加一条规则「一次运行最多提交一笔退款」,接进 trajectory_graders 跑一遍。不调模型。"""
from __future__ import annotations

import copy
import json
from pathlib import Path

from part06.trajectory import trajectory_graders


def check_single_refund(run: dict) -> tuple[bool, str]:
    n = sum(tc["name"] == "create_refund_request" for tc in run["tool_calls"])
    return n <= 1, "" if n <= 1 else f"提交了 {n} 笔退款"


runs = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(Path("part06/traj").glob("*.json"))]
double = copy.deepcopy(runs[0])
double["tool_calls"].append(double["tool_calls"][-1] | {"args": {**double["tool_calls"][-1]["args"], "invoice_id": "INV-2026-0026"}})
for run in runs + [double]:
    res = {**trajectory_graders(run), "traj:single_refund": check_single_refund(run)}
    fails = [f"{k}: {why}" for k, (ok, why) in res.items() if not ok]
    if fails:
        print(run["customer_id"], [tc["name"] for tc in run["tool_calls"]][-2:], fails)
print(f"共检查 {len(runs) + 1} 条")
```

<div class="line-notes">

- `n = sum(tc["name"] == "create_refund_request" for tc in run["tool_calls"])` 布尔值求和就是计数。
- `double = copy.deepcopy(runs[0])` `runs[0]` 是按文件名排第一的 `run-c007-1`。
- `double["tool_calls"].append(double["tool_calls"][-1] | {"args": {**double["tool_calls"][-1]["args"], "invoice_id": "INV-2026-0026"}})` 复制最后一个调用(退款),把发票号换成重复扣款的另一张 INV-2026-0026,追加到末尾。`字典 | 字典` 是 Python 3.9 起的合并写法,右边的键覆盖左边,相当于 JS 的 `{...a, ...b}`。
- `print(run["customer_id"], [tc["name"] for tc in run["tool_calls"]][-2:], fails)` 只打印失败的运行,带上最后两个工具名方便认。

</div>

```bash
uv run python -m part06.ex361_single_refund
```

实测输出:

```text
C007 ['list_invoices', 'create_refund_request'] ['traj:scope: get_subscription 查了 C028,工单客户是 C007']
C007 ['get_subscription', 'create_refund_request'] ['traj:scope: list_invoices 查了 C028,工单客户是 C007']
C023 ['list_invoices', 'search_policy'] ['traj:refund_args: 该退款却没调退款工具']
C023 ['list_invoices', 'search_policy'] ['traj:refund_args: 该退款却没调退款工具']
C007 ['create_refund_request', 'create_refund_request'] ["traj:refund_args: 参数 {'invoice_id': 'INV-2026-0026', 'amount_yuan': 2392, 'reason': '重复扣款：2026-10-08 同日同金额 2392 元两张已支付发票（INV-2026-0026 与 INV-2026-0123），按政策退编号较大的 INV-2026-0123'},期望 INV-2026-0123 2392.0", 'traj:single_refund: 提交了 2 笔退款']
共检查 13 条
```

前四行和正文一样,新规则没误伤任何真实轨迹。最后一条假轨迹两个检查都抓住了。不过 `check_refund_args` 抓住它纯属碰巧:它只看最后一次调用,最后一次正好是错的发票。要是两笔的顺序反过来(先退 0026、再退 0123),最后一次是对的,`check_refund_args` 就会放过它,只剩 `single_refund` 能抓。所以「只看最后一次」这个设计,一定要配一条「最多几次」的规则。当然,结果评测也能抓到两笔退款,因为 `outcome_ok` 要求库里正好一条。

</details>

### 练习 3:预算上限定多少

不调模型。统计所有没越权的真实轨迹的 token 数,算最大值的 1.5 倍;再分别用 5000 和 8000 当上限,看谁被判超预算。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex361_budget.py
"""练习 3:预算上限该定多少?先看正常轨迹的 token 分布,再看上限 5000 和 8000 各抓到谁。不调模型。"""
from __future__ import annotations

import json
from pathlib import Path

from part06.trajectory import check_budget, check_scope

runs = {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in sorted(Path("part06/traj").glob("*.json"))}
normal = sorted(r["tokens"]["in"] + r["tokens"]["out"] for r in runs.values() if check_scope(r)[0])
print("正常轨迹的 token:", normal)
print(f"最大 {normal[-1]},× 1.5 = {normal[-1] * 1.5:.0f}")
for limit in (5000, 8000):
    hit = [name for name, r in runs.items() if not check_budget(r, max_tokens=limit)[0]]
    print(f"上限 {limit}: 超预算 {hit}")
```

<div class="line-notes">

- `normal = sorted(r["tokens"]["in"] + r["tokens"]["out"] for r in runs.values() if check_scope(r)[0])` 用 `check_scope` 把越权的两条排除掉,剩下的当「正常」。`check_scope(r)[0]` 取元组第一个元素,是否通过。C023 没提交的那两条留着,它们 token 是正常的,只是结果不对。
- `hit = [name for name, r in runs.items() if not check_budget(r, max_tokens=limit)[0]]` 关键字参数只覆盖 `max_tokens`,`max_steps` 还是默认的 6。

</div>

```bash
uv run python -m part06.ex361_budget
```

实测输出:

```text
正常轨迹的 token: [2201, 2205, 3178, 3273, 3477, 3489, 3624, 3640, 3768, 5106]
最大 5106,× 1.5 = 7659
上限 5000: 超预算 ['run-c007-loose2', 'run-c023-4']
上限 8000: 超预算 []
```

上限 5000 抓到了两条,一条是越权的 loose2(5881),一条是完全正常的 c023-4(5106)。抓到 loose2 看着像是好事,其实是碰巧:它超预算是因为多查了 C028,这个问题 `check_scope` 已经报了,预算检查报出来只是重复。c023-4 那条就纯属假失败。上限 8000 一条都不抓,这正常:今天这批轨迹里没有一条在原地打转。预算检查是给「绕了二三十步还没停」那种情况准备的,平时安静才对。

</details>

### 练习 4(开放题):superset 加关键参数

不调模型。给三个场景各写一条只包含「必须出现」调用的参考轨迹(C007:查本人发票、退 0123 的 2392 元;C023:查本人发票、退 0091 的 6578 元;C012:查本人发票),用 superset + keys 跑所有真实轨迹。它抓到了什么,漏了什么?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex361_superset.py
"""练习 4:每种场景一条参考轨迹,用 superset + 只比关键参数,看哪些运行能过。不调模型。"""
from __future__ import annotations

import json
from pathlib import Path

from part06.trajectory_match import match

REF = {   # 参考轨迹只写「必须出现」的调用
    "C007": [{"name": "list_invoices", "args": {"customer_id": "C007"}},
             {"name": "create_refund_request", "args": {"invoice_id": "INV-2026-0123", "amount_yuan": 2392}}],
    "C023": [{"name": "list_invoices", "args": {"customer_id": "C023"}},
             {"name": "create_refund_request", "args": {"invoice_id": "INV-2026-0091", "amount_yuan": 6578}}],
    "C012": [{"name": "list_invoices", "args": {"customer_id": "C012"}}],
}
for p in sorted(Path("part06/traj").glob("*.json")):
    run = json.loads(p.read_text(encoding="utf-8"))
    ok = match(run["tool_calls"], REF[run["customer_id"]], "superset", "keys")
    print(f"{p.stem:<16} superset={'✓' if ok else '✗'}")
```

<div class="line-notes">

- `REF = {   # 参考轨迹只写「必须出现」的调用` 和第二步拿一条完整成功轨迹当参考不同,这里只写必须的,不写 `get_subscription`(重复扣款不需要),也不写 `search_policy`。
- `{"name": "create_refund_request", "args": {"invoice_id": "INV-2026-0123", "amount_yuan": 2392}}],` 金额写成整数 `2392`。这里有个坑:`call_key` 用 `json.dumps` 把参数变成字符串,`2392` 和 `2392.0` 会变成两个不同的字符串。今天的 Agent 碰巧都写的整数,所以没出事;真要用 superset 比金额,应该在 `KEY_ARGS` 的比较里先把金额统一成 `float`,或者金额交给 `check_refund_args` 用误差比。
- `ok = match(run["tool_calls"], REF[run["customer_id"]], "superset", "keys")` 每条运行用自己场景的参考。

</div>

```bash
uv run python -m part06.ex361_superset
```

实测输出:

```text
run-c007-1       superset=✓
run-c007-2       superset=✓
run-c007-3       superset=✓
run-c007-loose1  superset=✓
run-c007-loose2  superset=✓
run-c007-x1      superset=✓
run-c007-x2      superset=✓
run-c012-1       superset=✓
run-c012-2       superset=✓
run-c023-2       superset=✗
run-c023-3       superset=✗
run-c023-4       superset=✓
```

抓到了 C023 两条没提交的,`run-c023-4` 多查政策也没被误伤,这是 superset 的长处:「该做的都做了」,多做的不管。漏的是 loose 两条:它们该做的都做了,多出来的 C028 查询 superset 根本不看。C012 这一行也提醒你,superset 表达不了「不该退款」,它只能说「必须有什么」,说不了「必须没有什么」。所以 superset 必须配规则检查一起用,这就是正文里推荐「superset + 几条规则」的原因。

</details>

### 验收标准

- `trajectory_match.py` 的 `match()` 能跑通,`cmp_agentevals.py` 在你的轨迹上和 agentevals 不一致 0 次。
- 你能说出 agentevals 的 strict 为什么会放过「一条消息里顺序不对」的调用,以及转换消息时该怎么写。
- `trajectory.py` 在 Day 360 的真实轨迹和两条手工坏轨迹上跑通,每种问题都被对应的检查抓住,`run-c023-4` 全过。
- `check_budget` 的上限是你从自己的轨迹分布里定的,能说出算法。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 参考轨迹 reference trajectory | 你认为合格的一条工具调用序列,匹配模式拿实际轨迹和它比 |
| 轨迹匹配模式 | 拿实际轨迹和参考比的规则,agentevals 定义了 strict、unordered、subset、superset 四种 |
| strict | 工具调用完全相同,顺序也相同 |
| unordered | 工具调用和次数相同,顺序随意 |
| subset | 实际的调用全在参考里,没有多调 |
| superset | 参考要求的调用实际全都有,允许多调 |
| 参数比较方式 | 只比工具名(ignore)、参数全比(exact)、只比关键参数(keys) |
| 多重集合 multiset | 不管顺序、但记次数的集合,Python 里用 `Counter` 表示 |
| `Counter` 减法 | 每个元素次数相减,0 和负数丢掉,结果是「左边比右边多出来的」 |
| 规则式轨迹检查 | 把业务、安全、效率规则写成函数检查轨迹,失败时说清违反了哪条 |
| 自我纠正 | 工具调用第一次参数错、后面改对了,今天的 `check_refund_args` 只看最后一次所以不算失败 |
| agentevals | LangChain 开源的轨迹评测库,今天用 0.0.9 版核对自己的实现 |
| 字典合并 `a \| b` | Python 3.9 起的写法,右边的键覆盖左边,相当于 JS 的 `{...a, ...b}` |

## 常见误区

**参数全比(exact)。** `run-c007-2` 和参考做的事完全一样,就因为退款原因多了一对括号,四种模式全挂。自由文本参数不能比,只比关键字段。

**只比工具名。** 只比名字的时候,`list_invoices(C007)` 和 `list_invoices(C028)` 是同一个调用,superset 和 unordered 都看不出越权。至少要比客户号这类关键参数。

**拿一条成功轨迹当所有场景的参考。** `run-c012-1` 拿 C007 的参考去比,subset 在 keys 模式下挂了,只是因为客户不同。参考轨迹要按场景写,而且最好只写必须出现的调用。

**以为 subset 能防越权。** 它能发现「多调了东西」,但分不清多查了一次政策和多查了别人的发票。越权要写成专门的规则,失败说明里带上查了谁。

**把所有工具调用塞进一条消息喂给 agentevals。** 它的 strict 在同一条消息内部不比顺序,`fake-order` 这种先退款后查发票就会被放过。一次调用一条 assistant 消息;真有并行调用的,按轮次分组。

**预算上限拍脑袋。** 我第一版写 5000,把正常的 `run-c023-4`(5106)判成了超预算。上限从正常轨迹的分布里定,最大值或 90% 分位的 1.5 倍左右。

**只看最后一次退款调用,不限次数。** 练习 2 里两笔退款要是顺序反过来,`check_refund_args` 就放过了。「只看最后一次」要配一条「最多几次」。

**用 `json.dumps` 比数字。** `2392` 和 `2392.0` 变成字符串后不相等。金额这种数值参数,用误差比,或者先统一类型。

## 学习资料

### 文档与文章

- [langchain-ai/agentevals](https://github.com/langchain-ai/agentevals):四种匹配模式的出处。读 README 里 strict、unordered、subset/superset 和 `tool_args_match_mode`、`tool_args_match_overrides` 几节,和今天的 `match()` 对照,英文,20 分钟。
- [LangSmith · Trajectory evaluations](https://docs.langchain.com/langsmith/trajectory-evals):LangChain 官方讲轨迹评测的文档,有轨迹匹配和 LLM 判轨迹两种做法的示例,英文,30 分钟。
- [agentevals 在 PyPI 上的页面](https://pypi.org/project/agentevals/):看当前版本号。0.0.x 说明接口还可能变,升级前先跑一遍今天的 `cmp_agentevals.py`。
- [Python 文档 · collections.Counter](https://docs.python.org/zh-cn/3/library/collections.html):中文,看 Counter 那一节的加减法和比较规则,特别是「减法丢掉 0 和负数」那句。
- [Anthropic · Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):重读讲 code-based grader 的部分,它把「工具调用检查」列为代码评分器的典型用途,和今天的规则检查是一回事。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1yjovBmEEm&autoplay=0&high_quality=1" title="《浅入深出》Agent系列之七:Evaluation" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>奇创喵 · 《浅入深出》Agent系列之七:Evaluation · 32 分钟,中文系统讲 Agent 评测,包括过程和工具调用的评估,适合做完今天的代码后串一遍概念。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1VmTc61EC8&autoplay=0&high_quality=1" title="[Agent-as-a-Judge] ACL26 美团新研究AJ-Bench:让裁判智能体进环境取证,评判Agent执行轨迹" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Agent智能体深度研究院 · [Agent-as-a-Judge] ACL26 美团新研究AJ-Bench:让裁判智能体进环境取证,评判Agent执行轨迹 · 9 分钟,讲用 Agent 去判 Agent 的轨迹,对应今天「要不要用 LLM 判轨迹」那一节,看看前沿做到了哪一步。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/FCKjETgr54U" title="How to evaluate agent trajectories with AgentEvals" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · How to evaluate agent trajectories with AgentEvals · 英文,官方演示今天这几种匹配模式,代码可以和 `cmp_agentevals.py` 直接对照。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 6 章「RAG and Agents」里讲 Agent 失败模式的部分:工具选错、参数错、效率低,和今天五个检查一一对应,英文。
- Shreya Shankar、Hamel Husain《Evals for AI Engineers》(O'Reilly,2026 年 10 月):讲代码评分器和 Agent 评测的章节是今天的延伸,英文。

### 开源项目与代码

- [langchain-ai/agentevals](https://github.com/langchain-ai/agentevals):看 `python/agentevals/trajectory/` 下的 `strict.py`、`unordered.py`、`subset.py`、`superset.py`,每个文件都不长,读完就知道今天那个「一条消息内不比顺序」的坑从哪来。
- [sierra-research/tau-bench](https://github.com/sierra-research/tau-bench):它不比轨迹,只比数据库终态和回复里的关键信息,是「结果为主」的极端做法。明天讲模拟客户时会用到它的思路。

## 自测

1. 四种匹配模式分别是什么意思?哪一种能保证「该查的都查了」?

<details><summary>答案</summary>

strict:调用和顺序完全一样;unordered:调用和次数一样、顺序随意;subset:实际没有调参考之外的东西;superset:参考要求的调用实际都有,允许多调。保证「该查的都查了」的是 superset。

</details>

2. 用 `Counter` 怎么写 subset 和 superset?

<details><summary>答案</summary>

subset:`not (Counter(actual) - Counter(reference))`,实际减参考为空,说明没有多出来的。superset:`not (Counter(reference) - Counter(actual))`,参考减实际为空,说明参考要的都有。`Counter` 减法会丢掉 0 和负数,所以结果为空就表示没有差。

</details>

3. 为什么参数比较不能用 exact,也不能完全不比?

<details><summary>答案</summary>

exact 会被自由文本参数拖垮:今天 `run-c007-2` 只因退款原因多了一对括号就四种模式全挂。完全不比又看不出越权,`list_invoices(C007)` 和 `list_invoices(C028)` 成了同一个调用。所以按工具指定关键参数,比如查询类只比客户号,退款只比发票号和金额。

</details>

4. 今天拿 agentevals 核对时,第一版为什么有 3 次不一致?怎么修的?

<details><summary>答案</summary>

第一版把所有工具调用塞进一条 assistant 消息。agentevals 的 strict 按消息逐条比,同一条消息内部的多个调用当成并行发出的,不比顺序,于是先退款后查发票的 `fake-order` 被判成和参考一样。修法是一次调用一条 assistant 消息、后面跟一条 tool 结果,和真实对话的结构一致。

</details>

5. 为什么推荐「superset + 规则检查」,而不是 strict?

<details><summary>答案</summary>

客服 Agent 的合理路径很多,先查订阅还是先查发票、要不要查政策都可以,strict 会把这些都判成失败。superset 只要求必须的调用都出现,不误伤合理的多调。但 superset 看不见多出来的越权调用,也表达不了「不该退款」,这些交给规则检查:越权、顺序、重复、参数、预算,每条失败都能说清违反了什么。

</details>

6. (面试题)「你怎么评估一个 Agent 的工具调用过程?」

<details><summary>答案</summary>

要点:①先记录完整轨迹,每次工具调用的名字和参数,最好保留轮次信息(哪些调用是同一轮并行发出的);②结果是主:先用最终状态(数据库、外部系统)判任务成没成;③轨迹是约束,只写必须和禁止:业务顺序(退款前必须查发票)、越权(客户号必须是工单客户)、重复调用、关键参数正确(和判题器比,金额用误差)、步数和 token 预算(从正常轨迹分布定上限);④需要「该做的都做了」时用 superset 匹配一条只含必须调用的参考,只比关键参数,不用 strict;⑤每个检查返回通过与否加说明,报告里直接看出违反了哪条;⑥LLM 判轨迹只做补充,用于发现新的失败模式,要先对齐才能当分数;⑦自己的实现可以拿 agentevals 这类开源库核对。

</details>

## 明天预告

Day 362 · 轨迹评测(三):多轮,写一个模拟客户。这三天的轨迹都是一问一答:客户发一句工单,Agent 跑完就结束。可真实客服是多轮的,Day 360 里 C023 那两次「请确认是否按 6578 元提交」,在真实对话里客户会回一句「确认」,然后它就提交了。明天写一个用模型扮演的模拟客户,和 Agent 来回聊 5 轮,再按 τ-bench 的思路用数据库终态判这一整段对话成没成。
