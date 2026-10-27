---
title: 'Day 342 · 第 49 周复习:评测与可观测(Day 336–341)'
description: '这一周前五天是低代码平台和工单分流小项目,第六天是评测的起点。今天画一张知识地图,默写工具层的三道检查,再把这周的两条线接到一起:把三道检查写成评测用例,用 Day 341 的比较脚本和门禁抓住「写坏了」的版本。全程不调模型,一分钱不花。'
pubDate: 2026-10-27
regime: none
tags: ['review', 'eval', 'python', 'agent-zero']
series: 'agent-zero'
day: 342
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 341](/blog/agent-zero/day-341-why-evals/) 是第六部分的第一天:手动试三张工单觉得提示词改好了,跑 28 条用例才发现总分没变、坏的却换了一条(V2 修好了取消订阅,弄坏了「退自动续费的年付」)。后来写了四个小文件:用例 JSONL、`evalrun.py`、`compare.py`、`gate.py`,把「有没有变坏」变成了一个带退出码的命令。

这一周的标题写的是「评测与可观测」,但说实话,前五天讲的是另外两件事:Dify、扣子这类低代码平台什么时候该用、什么时候改成写代码(Day 336、337),以及把第五部分的 MCP 和 LangGraph 拼成一个工单分流 Agent(Day 338 到 340)。评测只有 Day 341 一天。所以今天的复习有一个明确的目标:让这三块在一个小东西里碰面。

## 今天要解决的问题

学完今天,你要能做到:

1. 合上文章,说出这六天各解决什么问题,并把它们归到三条线:平台还是代码(336、337)、工具层和图(338、339、340)、评测起步(341)。
2. 默写 `check_call`,工具层的三道检查,并用 12 条用例自检。
3. 把「工具层的规矩」写成评测用例,用 Day 341 的 `compare`、`gate` 抓住三个「写坏了」的版本,其中一个就是 Day 338 真实出过的漏洞。
4. 说出这周至少八个坑,每个都能讲出真实报错或真实现象。

预计用时 3 小时:知识地图和回顾 30 分钟,默写 30 分钟,小项目 1 小时,剩下做练习和自测。前置:[Day 336](/blog/agent-zero/day-336-low-code-1/) 到 [Day 341](/blog/agent-zero/day-341-why-evals/) 全部,尤其是 Day 340 练习 2 的 `part05/router/recall340.py`(两个纯函数 `route` 和 `check_call`),Day 341 的 `part06/evalrun.py`、`compare.py`、`gate.py`。今天所有脚本都不调模型,一分钱不花。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章,把 `check_call` 和 `run_guard` 的主体再写一遍;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="第 49 周知识地图:低代码平台两天、工单分流小项目三天、评测起步一天,三块的交汇点是把工具层规矩写成评测用例">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="12" y="14" width="190" height="120" rx="6" fill="none" stroke="var(--ink-soft)"/>
    <text x="22" y="34" font-size="12" fill="var(--ink)">336–337 平台还是代码</text>
    <text x="22" y="56" fill="var(--ink-soft)">同一流程:31 行 vs 10 节点</text>
    <text x="22" y="74" fill="var(--ink-soft)">画布全绿但类别全错</text>
    <text x="22" y="92" fill="var(--ink-soft)">接自己的数据:两个坑</text>
    <text x="22" y="110" fill="var(--ink-soft)">评测集放自己仓库</text>
    <text x="22" y="126" fill="var(--ink-faint)">判断表:何时改成写代码</text>
    <rect x="225" y="14" width="190" height="120" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="235" y="34" font-size="12" fill="var(--ink)">338–340 工单分流</text>
    <text x="235" y="56" fill="var(--ink-soft)">338 工具层:按类别给工具</text>
    <text x="235" y="74" fill="var(--ink-soft)">   三道检查,不靠提示词</text>
    <text x="235" y="92" fill="var(--ink-soft)">339 图:分类→检索→循环</text>
    <text x="235" y="110" fill="var(--ink-soft)">   审批停在 interrupt</text>
    <text x="235" y="126" fill="var(--ink-faint)">340 连跑 6 次:3 次 6458</text>
    <rect x="438" y="14" width="190" height="120" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="448" y="34" font-size="12" fill="var(--ink)">341 评测起步</text>
    <text x="448" y="56" fill="var(--ink-soft)">用例 JSONL + 期望</text>
    <text x="448" y="74" fill="var(--ink-soft)">每条跑多次,存结果</text>
    <text x="448" y="92" fill="var(--ink-soft)">逐条比,不只看总分</text>
    <text x="448" y="110" fill="var(--ink-soft)">门禁:退出码 0 / 1</text>
    <text x="448" y="126" fill="var(--ink-faint)">28 条:修 1 坏 1</text>
    <rect x="150" y="196" width="340" height="62" rx="6" fill="none" stroke="var(--ink)"/>
    <text x="320" y="220" text-anchor="middle" font-size="13" fill="var(--ink)">今天:把三道检查写成评测用例</text>
    <text x="320" y="240" text-anchor="middle" fill="var(--ink-soft)">12 条用例 · 4 个版本 · 不调模型</text>
  </g>
  <g stroke="var(--ink-soft)" fill="none">
    <line x1="107" y1="134" x2="240" y2="196"/><line x1="320" y1="134" x2="320" y2="196"/><line x1="533" y1="134" x2="400" y2="196"/>
  </g>
</svg>
<figcaption>三块各有各的结论,今天的小项目是它们的交汇:338 的工具层规矩(中)被写成 341 的评测用例(右),337 的「评测集放自己仓库」(左)就是这些 JSONL 文件的去处。</figcaption>
</figure>

## 本周每天一句话

- **[Day 336](/blog/agent-zero/day-336-low-code-1/) 低代码(一)**:Dify、扣子、百炼、n8n 的现状,同一个工单分流流程写成 31 行 Python、画成 n8n 的 10 个节点。两边花的钱一样,但 n8n 的 DeepSeek 节点没有关思考的开关,画布上所有节点全绿,类别却落回了 `other`(原因是我自己的解析节点吞掉了一个错误)。
- **[Day 337](/blog/agent-zero/day-337-low-code-2/) 低代码(二)**:接自己的数据时撞上两个坑(`localhost` 在 n8n 里连不上自己的接口;接口返回数组,后面的模型节点被跑了好几遍),再用同一份 12 条用例给两边打分,最后是一张「什么时候该改成写代码」的判断表。
- **[Day 338](/blog/agent-zero/day-338-router-project-1/) 小项目(一)**:不调模型的那一半:知识库检索、在普通函数里同步调 MCP、工具箱。工具箱按类别给工具(只有 `refund` 看得到退款),每次调用先过三道检查,并且撞出了「只检查 `customer_id` 参数拦不住 `find_customer`」的漏洞。
- **[Day 339](/blog/agent-zero/day-339-router-project-2/) 小项目(二)**:把模型接成一张六个节点的图,用假模型免费测出一个 bug(bug 工单里冒出的退款调用被送进审批),真模型跑通批准和驳回,最后同一张年付退款工单连跑 6 次结果不一样。
- **[Day 340](/blog/agent-zero/day-340-router-project-3/) 小项目(三)**:十张工单跑成一张表,越权和最小权限两个对照实验,第五部分知识地图,一张坑清单,三分钟讲清项目。
- **[Day 341](/blog/agent-zero/day-341-why-evals/) 为什么评测是分水岭**:「我试过了挺好的」不算数。V1 到 V2 总分都是 81/84,出错的却不是同一条;用逐条比较和门禁代替肉眼。

## 默写 1:工具层的三道检查

合上文章,不看 Day 338 和 Day 340,把 `check_call` 写出来。规格如下:输入是工具名 `name`、参数字典 `args`、本类别允许的工具名集合 `allowed`、工单绑定的客户 `bound_customer`(可能是 `None`);输出是拒绝的原因(一句话),放行返回 `None`。三道检查按顺序:工具不在允许名单里,以 `[工具报错]` 开头;绑定了客户却要 `find_customer`,以 `[拒绝]` 开头;绑定了客户,参数里带 `customer_id` 却和绑定的不一致,以 `[拒绝]` 开头。

先自己写,写完对照下面这份:

```python
# agent-zero-lab/part05/router/recall340.py(只看 check_call 这一个函数)
from typing import Any


def check_call(name: str, args: dict[str, Any], allowed: set[str], bound_customer: str | None) -> str | None:
    """返回拒绝原因;None 表示放行。"""
    if name not in allowed:
        return f"[工具报错] 不能调用 {name}"
    if bound_customer and name == "find_customer":
        return f"[拒绝] 客户已确定为 {bound_customer}"
    if bound_customer and "customer_id" in args and args["customer_id"] != bound_customer:
        return f"[拒绝] 只能查询工单所属客户 {bound_customer} 的数据"
    return None
```

<div class="line-notes">

- `def check_call(name: str, args: dict[str, Any], allowed: set[str], bound_customer: str | None) -> str | None:` 四个输入一个输出。输出类型 `str | None` 是「要么一句话,要么 `None`」,相当于 TS 的 `string | null`。没有 `async`,没有模型,没有 MCP,所以能被快速、免费地测上几百遍。
- `if name not in allowed:` 第一道。就算模型凭空编出一个工具名(下面评测里的 `drop_table`),这里也直接拒绝。
- `return f"[工具报错] 不能调用 {name}"` 前缀 `[工具报错]` 是 Day 338 约定的,图里造 `ToolMessage` 时靠前缀判断成败。
- `if bound_customer and name == "find_customer":` 第二道,Day 338 补漏洞时加的那一行。客户已经确定,就没有理由再去找别的客户。
- `if bound_customer and "customer_id" in args and args["customer_id"] != bound_customer:` 第三道。三个条件缺一个都不拦:没绑客户不拦,参数里没带 `customer_id` 不拦,带了但相同不拦。代入:绑定 `C007`,调用 `{"customer_id": "C008"}`,不相同,拒绝。
- `return None` 三道都过了才放行。

</div>

默写的时候最常见的错是顺序:第二道和第三道换位置不影响结果,但第一道必须在最前面,否则一个不在名单里的工具会先撞上别的检查,给出的原因就不对了。

## 默写 2:评测一条用例要做什么

不要求逐字默写,要求你能讲出骨架:读用例 → 对每条调用被测的东西 → 记下答案和是否通过 → 存成一个带标签的文件。下面是今天要用的完整版,它和 Day 341 的 `run_eval` 骨架一样,只是被测对象从「模型分类」换成了「`check_call` 函数」,所以结果文件的格式完全一致,`compare.py` 和 `gate.py` 不用改一个字。

## 小项目:给三道检查做评测

### 第 1 步:12 条用例

每条用例是一次工具调用,加上「这次调用该不该放行」。`expected` 有三个值:`allow`(放行)、`refuse`(`[拒绝]`)、`error`(`[工具报错]`)。放在 `part06/guard_cases.jsonl`:

```text
{"id": "G01", "name": "list_invoices", "args": {"customer_id": "C007"}, "allowed": ["list_invoices", "search_kb"], "bound": "C007", "expected": "allow"}
{"id": "G02", "name": "list_invoices", "args": {"customer_id": "C008"}, "allowed": ["list_invoices", "search_kb"], "bound": "C007", "expected": "refuse"}
{"id": "G03", "name": "list_invoices", "args": {"customer_id": "C008"}, "allowed": ["list_invoices", "search_kb"], "bound": null, "expected": "allow"}
{"id": "G04", "name": "find_customer", "args": {"query": "user008@example.com"}, "allowed": ["find_customer", "search_kb"], "bound": "C007", "expected": "refuse"}
{"id": "G05", "name": "find_customer", "args": {"query": "user008@example.com"}, "allowed": ["find_customer", "search_kb"], "bound": null, "expected": "allow"}
{"id": "G06", "name": "create_refund_request", "args": {"invoice_id": "INV-2026-0026", "amount_cents": 9900}, "allowed": ["list_invoices", "get_subscription", "find_customer", "search_kb"], "bound": "C007", "expected": "error"}
{"id": "G07", "name": "create_refund_request", "args": {"invoice_id": "INV-2026-0026", "amount_cents": 9900}, "allowed": ["create_refund_request", "list_invoices", "search_kb"], "bound": "C007", "expected": "allow"}
{"id": "G08", "name": "get_subscription", "args": {"customer_id": "C008"}, "allowed": ["get_subscription", "search_kb"], "bound": "C007", "expected": "refuse"}
{"id": "G09", "name": "search_kb", "args": {"query": "如何申请退款"}, "allowed": ["search_kb"], "bound": "C007", "expected": "allow"}
{"id": "G10", "name": "drop_table", "args": {"name": "invoices"}, "allowed": ["list_invoices", "search_kb"], "bound": "C007", "expected": "error"}
{"id": "G11", "name": "list_invoices", "args": {}, "allowed": ["list_invoices", "search_kb"], "bound": "C007", "expected": "allow"}
{"id": "G12", "name": "list_invoices", "args": {"customer_id": "c007"}, "allowed": ["list_invoices", "search_kb"], "bound": "C007", "expected": "refuse"}
```

这 12 条是我按 Day 338 和 Day 340 的规矩写下来的,先写期望,再跑代码:

- G01、G03、G05、G07、G09、G11 是**该放行的**:查自己的发票、没绑客户时查别人、没绑客户时找客户、本类别允许的退款申请、`search_kb`、参数里没带 `customer_id`。只写拒绝的用例,会把检查调成什么都拒绝。
- G02、G08、G12 是**该拒绝的越权**:绑了 C007 却查 C008 的发票和订阅,以及大小写不同的 `c007`。G12 值得多说一句:`c007` 和 `C007` 在业务上也许是同一个人,但检查按字符串严格比较。我们的立场是宁可拒绝,不去猜。
- G04 是 Day 338 那个漏洞:绑了客户还想按邮箱找人。
- G06、G10 是**工具不在名单里**:一个本类别不能用的退款工具,一个凭空编出来的 `drop_table`。

### 第 2 步:评测脚本

先写三个「写坏了」的版本,放在 `part06/guard_old.py`。每一个都对应真实出现过或可以想象的改动:

```python
# agent-zero-lab/part06/guard_old.py
"""两个「写坏了」的 check_call,用来验证评测抓得住。v1 是 Day 338 的第一版漏洞,no_customer_check 是 Day 340 练习 3 删掉第三道检查。"""
from typing import Any


def check_call_v1(name: str, args: dict[str, Any], allowed: set[str], bound_customer: str | None) -> str | None:
    if bound_customer and "customer_id" in args and args["customer_id"] != bound_customer:
        return f"[拒绝] 只能查询工单所属客户 {bound_customer} 的数据"
    return None


def check_call_no_customer_check(name: str, args: dict[str, Any], allowed: set[str], bound_customer: str | None) -> str | None:
    if name not in allowed:
        return f"[工具报错] 不能调用 {name}"
    if bound_customer and name == "find_customer":
        return f"[拒绝] 客户已确定为 {bound_customer}"
    return None


def check_call_lenient(name: str, args: dict[str, Any], allowed: set[str], bound_customer: str | None) -> str | None:
    """练习 2:有人为了「兼容小写的客户编号」,把第三道检查的比较改成了不区分大小写。"""
    if name not in allowed:
        return f"[工具报错] 不能调用 {name}"
    if bound_customer and name == "find_customer":
        return f"[拒绝] 客户已确定为 {bound_customer}"
    if bound_customer and "customer_id" in args and str(args["customer_id"]).upper() != bound_customer.upper():
        return f"[拒绝] 只能查询工单所属客户 {bound_customer} 的数据"
    return None
```

<div class="line-notes">

- `def check_call_v1(` 这是 Day 338 的第一版:只写了第三道检查。三个参数 `name`、`allowed` 没人用,但签名要和正式版一致,这样可以互换。
- `if bound_customer and "customer_id" in args and args["customer_id"] != bound_customer:` 只有第三道。Day 338 当时撞出的漏洞就是这样写的。
- `def check_call_no_customer_check(` Day 340 练习 3「删掉第三道检查」的结果。
- `if name not in allowed:` 第一道还在。
- `if bound_customer and name == "find_customer":` 第二道还在,只缺第三道。
- `def check_call_lenient(` 练习 2 用的版本。这种改动最阴险:不是删代码,是「好心」改一处。
- `if bound_customer and "customer_id" in args and str(args["customer_id"]).upper() != bound_customer.upper():` 比较前把两边都转成大写。表面上是兼容小写,实际上放过了 G12。

</div>

然后是评测脚本本体:

```python
# agent-zero-lab/part06/guard_eval.py
"""给「工具层三道检查」做评测:每条用例是一次工具调用加期望的裁决(allow/refuse/error)。不调模型,免费。
结果文件的格式和 Day 341 的 evalrun 一样,所以 compare、gate 直接能用。
运行:uv run python -m part06.guard_eval final guard-final"""
import hashlib
import inspect
import json
import sys
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from part05.router.recall340 import check_call
from part06.evalrun import RUNS
from part06.guard_old import check_call_lenient, check_call_no_customer_check, check_call_v1

IMPLS: dict[str, Callable[..., str | None]] = {
    "final": check_call, "v1": check_call_v1, "no_customer_check": check_call_no_customer_check,
    "lenient": check_call_lenient,
}


def verdict(reason: str | None) -> str:
    if reason is None:
        return "allow"
    return "error" if reason.startswith("[工具报错]") else "refuse"


def run_guard(impl: str, tag: str) -> dict[str, Any]:
    fn = IMPLS[impl]
    results = []
    for line in (Path(__file__).parent / "guard_cases.jsonl").read_text(encoding="utf-8").splitlines():
        case = json.loads(line)
        got = verdict(fn(case["name"], case["args"], set(case["allowed"]), case["bound"]))
        results.append({"id": case["id"], "expected": case["expected"], "answers": [got],
                        "passed": int(got == case["expected"])})
    record = {
        "tag": tag, "prompt_version": impl,
        "prompt_sha": hashlib.sha256(inspect.getsource(fn).encode()).hexdigest()[:8],
        "model": "none", "temperature": 0.0, "trials": 1, "time": time.strftime("%Y-%m-%d %H:%M:%S"),
        "cost": 0.0, "results": results,
    }
    RUNS.mkdir(exist_ok=True)
    (RUNS / f"{tag}.json").write_text(json.dumps(record, ensure_ascii=False, indent=1), encoding="utf-8")
    return record


if __name__ == "__main__":
    rec = run_guard(sys.argv[1], sys.argv[2])
    good = sum(r["passed"] for r in rec["results"])
    print(f"[{rec['tag']}] 实现 {rec['prompt_version']}({rec['prompt_sha']}) {good}/{len(rec['results'])} 条通过")
    for r in rec["results"]:
        if not r["passed"]:
            print(f"  {r['id']} 期望 {r['expected']:<7} 实际 {r['answers'][0]}")
```

<div class="line-notes">

- `from part05.router.recall340 import check_call` 被测的正式版,就是 Day 340 练习 2 的参考答案。如果你默写的放在别的文件,改这一行,或者在 `IMPLS` 里加一项。
- `from part06.evalrun import RUNS` 复用 Day 341 的结果目录,所以结果和模型评测的结果放在同一个 `runs/` 下。
- `IMPLS: dict[str, Callable[..., str | None]] = {` 实现名到函数的字典。`Callable[..., X]` 的意思是「任意参数、返回 X 的函数」。四个值:正式版和三个写坏的。
- `def verdict(reason: str | None) -> str:` 把 `check_call` 返回的原因文字翻译成三个裁决之一,用例里的 `expected` 就是它们。
- `return "error" if reason.startswith("[工具报错]") else "refuse"` 以 `[工具报错]` 开头的算 `error`,剩下的(`[拒绝]`)算 `refuse`。
- `def run_guard(impl: str, tag: str) -> dict[str, Any]:` 和 Day 341 的 `run_eval` 对应:`impl` 对应提示词版本,`tag` 是结果名。没有 `trials`,因为纯函数每次结果都一样,跑一次就够。
- `got = verdict(fn(case["name"], case["args"], set(case["allowed"]), case["bound"]))` 一条用例的核心:JSONL 里 `allowed` 是列表,函数要集合,所以 `set(...)` 转一下。
- `"passed": int(got == case["expected"])` 通过记 1,不通过记 0,和 Day 341 的 `passed` 含义一致。`answers` 存成只有一个元素的列表,同样是为了格式一致。
- `"prompt_sha": hashlib.sha256(inspect.getsource(fn).encode()).hexdigest()[:8],` 这次被测的不是提示词,是函数。`inspect.getsource(fn)` 取函数的源码文本,算出指纹:代码改一个字符指纹就变。你的值和我的不同是正常的,只要你的代码和我的不是一字不差。
- `"model": "none", "temperature": 0.0, "trials": 1,` 这几个字段在 `compare.py` 里会被读到(`trials`),填成不会出错的值。
- `print(f"[{rec['tag']}] 实现 {rec['prompt_version']}({rec['prompt_sha']}) {good}/{len(rec['results'])} 条通过")` 一行摘要。

</div>

跑三个版本,先建立基线:

```bash
cd ~/agent-zero-lab
uv run python -m part06.guard_eval final guard-final
uv run python -m part06.guard_eval v1 guard-v1
uv run python -m part06.guard_eval no_customer_check guard-no_customer_check
```

```text
[guard-final] 实现 final(40508754) 12/12 条通过
[guard-v1] 实现 v1(254b0021) 9/12 条通过
  G04 期望 refuse  实际 allow
  G06 期望 error   实际 allow
  G10 期望 error   实际 allow
[guard-no_customer_check] 实现 no_customer_check(a777fc55) 9/12 条通过
  G02 期望 refuse  实际 allow
  G08 期望 refuse  实际 allow
  G12 期望 refuse  实际 allow
```

读结果:v1 的三条错分别是找客户(G04)、不在名单的退款工具(G06)、凭空编的工具(G10),和它缺的前两道检查一一对应。`no_customer_check` 缺的是第三道,恰好错了三条越权用例。用例设计得好,每一道检查被删掉,都有至少一条用例亮红灯。

### 第 3 步:用 Day 341 的比较和门禁

```bash
uv run python -m part06.compare guard-final guard-v1
uv run python -m part06.gate guard-final guard-v1; echo "退出码 $?"
uv run python -m part06.gate guard-v1 guard-final; echo "退出码 $?"
```

```text
guard-final(40508754) -> guard-v1(254b0021),每条各跑 1 次
变好 0 条: []
变坏 3 条:
  G04 1/1→0/1 现在答 ['allow']
  G06 1/1→0/1 现在答 ['allow']
  G10 1/1→0/1 现在答 ['allow']
不通过:3 条比 guard-final 差:['G04', 'G06', 'G10']
退出码 1
通过:没有任何一条比 guard-v1 差
退出码 0
```

正式版换成 v1 被拦下(退出码 1);反过来 v1 升级到正式版则通过(退出码 0)。这就是 Day 338 当时「写一个脚本专门去撞它」的自动化版本:撞过一次的漏洞,变成了永远不会再被悄悄放回来的用例。

### 第 4 步:接成一条命令

门禁的价值在于每次改动前后自动跑。写一个 `part06/check.sh`,先跑评测再比基线,任何一步失败整条命令就失败:

```bash
#!/bin/sh
# agent-zero-lab/part06/check.sh:跑一遍护栏评测,再和基线比,有变坏就失败
set -e
uv run python -m part06.guard_eval "$1" guard-new
uv run python -m part06.gate guard-final guard-new
echo "可以合并"
```

<div class="line-notes">

- `#!/bin/sh` 告诉系统用 `sh` 解释这个文件。需要先 `chmod +x part06/check.sh` 才能直接运行。
- `set -e` 任何一条命令返回非 0,脚本立刻停下并以同样的退出码结束。没有这一行,前面的失败会被后面的 `echo` 盖掉,脚本最后一行成功,整体退出码就是 0。
- `uv run python -m part06.guard_eval "$1" guard-new` `$1` 是命令行的第一个参数,即要检查的实现名;结果存成 `guard-new`。引号防止参数里有空格被拆开。
- `uv run python -m part06.gate guard-final guard-new` 和基线 `guard-final` 比。有变坏就返回 1,`set -e` 在这里终止。
- `echo "可以合并"` 只有上面都成功才会走到这里。

</div>

```bash
chmod +x part06/check.sh
./part06/check.sh final; echo "退出码 $?"
./part06/check.sh v1; echo "退出码 $?"
```

```text
[guard-new] 实现 final(40508754) 12/12 条通过
通过:没有任何一条比 guard-final 差
可以合并
退出码 0
[guard-new] 实现 v1(254b0021) 9/12 条通过
  G04 期望 refuse  实际 allow
  G06 期望 error   实际 allow
  G10 期望 error   实际 allow
不通过:3 条比 guard-final 差:['G04', 'G06', 'G10']
退出码 1
```

第七部分会把这样一条命令放进 CI,推代码就自动跑。今天先在本地确认它「该红的时候红、该绿的时候绿」。

## 本周错题与坑清单

| 现象 | 原因 | 哪天 | 怎么发现的 |
| --- | --- | --- | --- |
| n8n 里所有节点全绿,回复也像模像样,类别却落回了 `other` | 我自己写的 `Parse category` 节点从不存在的字段取值,`JSON.parse(undefined)` 报错被自己写的 `try/catch` 吞掉 | 336 | 点进执行记录看每个节点实际吐了什么 |
| n8n 的 DeepSeek 节点关不掉思考,花的钱和代码版一样 | 节点上没有「关思考」的开关 | 336 | 对账:两边输出 token 都是 252 |
| 重新导入工作流后线上地址失效 | 导入会让工作流变成未发布 | 336 | 导入后访问报 404 |
| curl 能通,n8n 说连接被拒 | `localhost` 的解析顺序和重试策略各个客户端不一样 | 337 | 换成 `127.0.0.1` 就好 |
| 一张工单,模型被调了六次 | HTTP 节点返回数组,在 n8n 里变成多条 item,后面的节点跑多遍 | 337 | 看执行记录里每个节点跑了几次 |
| 故意改坏提示词,分类准确率没变 | 只看了分类这一个检查,坏在「承诺时限」上 | 337 | 12 条用例里「承诺时限」那个检查报了 7 条 |
| 绑定了客户,仍能用邮箱搜到别人的信息 | 越权检查只看 `customer_id` 参数,`find_customer` 的参数叫 `query` | 338 | 写脚本专门撞这一道检查 |
| 测试把真正的业务库删了 | 只改了 server 的库路径,忘了 `seed.DB_PATH` | 338 | Day 287 提过的坑,fixture 里用 `monkeypatch` |
| 第一个节点就报 400 | DeepSeek 默认开思考模式,不接受强制指定的 `tool_choice` | 339 | 故意关掉 `.env` 里关思考的那一行复现 |
| bug 工单里冒出的退款调用被送进审批 | `route` 只看工具名,不看本类能不能退款 | 339 | 假模型测试 |
| 同一张年付退款工单,3 次 6458、3 次先问客户 | 模型有随机性 | 339、340 | 连跑 6 次 |
| 十张工单没有一张触发审批 | 挑的工单偏向「好跑的」 | 340 | 表里「审批 0 次」 |
| V1 到 V2 总分都是 81/84 | 修好了一条,弄坏了另一条,一加一减 | 341 | `compare.py` 逐条比 |
| 16 张工单只有 10 种说法 | seed 脚本按模板造,同一句话配不同客户 | 341 | 数不同正文 |
| `ModuleNotFoundError: No module named 'common'` | 直接 `python part06/evalrun.py`,搜索路径里没有仓库根目录 | 341 | 改用 `uv run python -m part06.evalrun` |

这十五条里,有五条(337 的坏版本、338 的越权、339 的 route、340 的审批、341 的覆盖)都指向同一件事:**你没想到的情况,只有被写成用例才会被抓住**。这一周之所以最后落在评测上,不是编排出来的。

## 动手练习

1. **默写 `check_call` 并自检。** 把你默写的函数放进 `part05/router/recall342.py`,在 `guard_eval.py` 的 `IMPLS` 里加一项 `"mine": check_call`(记得 import),跑 12 条用例。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/router/recall342.py
from typing import Any


def check_call(name: str, args: dict[str, Any], allowed: set[str], bound_customer: str | None) -> str | None:
    if name not in allowed:
        return f"[工具报错] 不能调用 {name}"
    if bound_customer and name == "find_customer":
        return f"[拒绝] 客户已确定为 {bound_customer}"
    if bound_customer and "customer_id" in args and args["customer_id"] != bound_customer:
        return f"[拒绝] 只能查询工单所属客户 {bound_customer} 的数据"
    return None
```

在 `guard_eval.py` 里加 `from part05.router.recall342 import check_call as check_call_mine`,`IMPLS` 里加 `"mine": check_call_mine`:

```bash
uv run python -m part06.guard_eval mine guard-mine
uv run python -m part06.gate guard-final guard-mine; echo "退出码 $?"
```

```text
[guard-mine] 实现 mine(xxxxxxxx) 12/12 条通过
通过:没有任何一条比 guard-final 差
退出码 0
```

`xxxxxxxx` 是你自己代码的指纹,每个人不一样。如果默写时漏了某一道检查,会像 v1、`no_customer_check` 那样有几条红,红的用例号告诉你漏了哪一道。

</details>

2. **观察会发生什么:「好心」改出来的版本。** 把 `guard_old.py` 里的 `check_call_lenient`(第三道检查比较前转大写)加进 `IMPLS`,用 `gate` 过一遍,看是哪条用例拦下了它。

<details><summary>参考答案</summary>

`IMPLS` 里已经有 `"lenient": check_call_lenient`。

```bash
uv run python -m part06.guard_eval lenient guard-lenient
uv run python -m part06.gate guard-final guard-lenient; echo "退出码 $?"
```

```text
[guard-lenient] 实现 lenient(7f8ae875) 11/12 条通过
  G12 期望 refuse  实际 allow
不通过:1 条比 guard-final 差:['G12']
退出码 1
```

只有 G12(`c007` 对 `C007`)拦住了它,另外 11 条全部还是对的。如果当初没有写 G12 这条「看起来有点钻牛角尖」的用例,这个改动会顺利通过。这是评测集里要放「边界值」的理由,也是 Day 341 说的:能发现问题的,是评测集里有没有会暴露问题的用例。

</details>

3. **看覆盖。** 数一数 12 条用例里,三道检查各被几条「拒绝」类用例覆盖了,哪一个分支没有被任何用例碰到?

<details><summary>参考答案</summary>

第一道(不在名单里):G06、G10,共 2 条。第二道(绑定后找客户):G04,共 1 条。第三道(客户不一致):G02、G08、G12,共 3 条。

没被碰到的分支:`search_kb` 在绑定客户时的行为只有 G09 一条,且它的参数里没有 `customer_id`,所以「`search_kb` 带了一个别人的 `customer_id`」这种情况没有用例。再有,「`bound_customer` 是空字符串 `""`」也没有:代码里 `if bound_customer` 对空字符串为假,会被当成没绑定,放行。这是不是想要的行为,要和 Day 338 的约定对一下。这两个盲点可以各补一条用例。

</details>

4. **改写 `check.sh`,让它一次检查多个版本。** 命令行传进去多个实现名,只要任何一个不通过,整体就失败,并且每个版本的结果都要打印出来。

<details><summary>参考答案</summary>

```bash
#!/bin/sh
# agent-zero-lab/part06/check_many.sh:./part06/check_many.sh final v1 lenient
failed=0
for impl in "$@"; do
  echo "== $impl"
  uv run python -m part06.guard_eval "$impl" "guard-$impl" || true
  uv run python -m part06.gate guard-final "guard-$impl" || failed=1
done
exit $failed
```

<div class="line-notes">

- `failed=0` 用一个变量记「有没有失败」。
- `for impl in "$@"; do` `"$@"` 是所有命令行参数,逐个循环。
- `echo "== $impl"` 打印分隔线,输出里能分清是哪个版本。
- `uv run python -m part06.guard_eval "$impl" "guard-$impl" || true` 评测本身不决定成败(成败看门禁),所以 `|| true` 让它即使失败也不中断。这里没有用 `set -e`,因为我们要每个版本都跑完。
- `uv run python -m part06.gate guard-final "guard-$impl" || failed=1` 门禁不通过时,把标记置 1,但不退出,继续下一个。
- `exit $failed` 最后一次性给出退出码:全部通过是 0,任何一个失败是 1。

</div>

```bash
chmod +x part06/check_many.sh
./part06/check_many.sh final v1 lenient; echo "退出码 $?"
```

```text
== final
[guard-final] 实现 final(40508754) 12/12 条通过
通过:没有任何一条比 guard-final 差
== v1
[guard-v1] 实现 v1(254b0021) 9/12 条通过
  G04 期望 refuse  实际 allow
  G06 期望 error   实际 allow
  G10 期望 error   实际 allow
不通过:3 条比 guard-final 差:['G04', 'G06', 'G10']
== lenient
[guard-lenient] 实现 lenient(7f8ae875) 11/12 条通过
  G12 期望 refuse  实际 allow
不通过:1 条比 guard-final 差:['G12']
退出码 1
```

</details>

5. **开放题:三分钟复述这一周。** 对着镜子或录音,三分钟讲清:这周做了什么、哪里最出乎你的意料、哪里还没做完。

<details><summary>参考答案</summary>

没有标准答案,示范骨架:这周先比较了低代码平台和写代码,结论是平台适合快速验证,画布上全绿不等于对,评测集要放自己的仓库;然后把 MCP 和 LangGraph 拼成了一个工单分流 Agent,最小权限和越权检查都放在工具层,不靠提示词;最后开始做评测。最出乎意料的是:同一份提示词改了一句话,总分不变,却坏了一条,是逐条比较才发现的。还没做完的是:审批路径几乎没有被评测覆盖,引用只检查了编号存在没核对内容,这些是接下来几天的事。检查清单:有没有数字,有没有一个自己踩的坑,有没有一个局限。

</details>

验收标准:`runs/` 下有 `guard-final.json`、`guard-v1.json`、`guard-no_customer_check.json`、`guard-lenient.json`;`check.sh final` 退出码 0、`check.sh v1` 退出码 1;你默写的 `check_call` 在 12 条用例上全过。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 知识地图 | 把一段时间学的东西画成一张图,标出块与块的关系,用来检查自己能不能讲清楚 |
| 护栏评测 | 给工具层的检查规则写用例,每条用例是「一次调用加该不该放行」。不调模型,免费,毫秒级 |
| 裁决(verdict) | 一次检查的结论。今天分三种:`allow` 放行、`refuse` 拒绝、`error` 工具不存在或不允许 |
| 写坏了的版本 | 故意或无意改坏的实现,用来验证评测抓得住。评测好不好,看它能不能抓住你想得到的坏版本 |
| 边界值用例 | 贴着规则边界的输入,比如大小写不同的客户编号。它们不常见,但改动「好心」出错时最先暴露 |
| `set -e` | shell 脚本里「任何命令失败就立刻退出」的开关 |
| 覆盖盲点 | 一组用例没有碰到的分支或情况。数一数每条规则被几条用例碰到,是找盲点最直接的办法 |

## 常见误区

**以为复习就是重读一遍。** 把文章再看一遍是最低效的。默写、自己写小项目、用旧代码去撞新代码,才会发现自己哪里真的不会。

**只写拒绝的用例。** 12 条里有 6 条是该放行的。只写拒绝,检查被调成「什么都拒绝」也能全绿。

**用例写成对着现有代码答案抄。** 今天的期望是先按规矩写,再跑的。如果先跑,把输出当期望,评测永远满分,也永远没用。

**把「函数纯」当成偷懒。** `check_call` 不依赖模型和 MCP,是故意写成这样的:能免费、毫秒级地测上几百遍,才有条件在每次改动后都跑。

**门禁只看总分。** 今天的门禁看「有没有哪一条变坏」。总分可以一加一减抵消,Day 341 已经演示过。

**`set -e` 和「全部跑完」不能同时要。** 想一个版本失败就停,用 `set -e`;想每个版本都跑完再汇总,用变量记失败、最后统一 `exit`(练习 4)。

## 学习资料

### 文档与文章

- [Hamel Husain & Shreya Shankar · AI Evals FAQ](https://hamel.dev/blog/posts/evals-faq/):问答形式,覆盖评测里几乎所有常见疑问,很长。今天只读目录,挑两三个和「写用例」有关的问题,20 分钟。
- [Anthropic · Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):今天的「一条用例加一个打分逻辑,可以是代码」对应文中 grader 的概念,40 分钟。
- [LangGraph · Test](https://docs.langchain.com/oss/python/langgraph/test):官方的图测试指南,和 Day 339 的假模型互补,20 分钟。
- [OWASP · LLM06:2025 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/):权限、功能、自主性过多的风险和缓解办法,对照三道检查,20 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1887X65EoB&autoplay=0&high_quality=1" title="从零搭建Agent自动化评估体系,9分钟给你讲明白!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI大模型元元 · 从零搭建Agent自动化评估体系,9分钟给你讲明白! · 9 分钟,讲自动化评估体系怎么搭。看完对照今天的 `guard_eval`,哪些环节是一样的、哪些我们还没做。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1HTAHebEuj&autoplay=0&high_quality=1" title="吴恩达《评估 AI 代理|Evaluating AI Agents》中英字幕" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>GPT中英字幕课程资源 · 吴恩达《评估 AI 代理|Evaluating AI Agents》中英字幕(deepseek-R1翻译) · 共 14 P。Day 341 看了前 3 P,今天接着看第 4 到 6 P,留意课里「检查工具调用」的那部分。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/uiza7wp1KrE" title="AI Evaluations Clearly Explained in 50 Minutes (Real Example) | Hamel Husain" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Peter Yang · AI Evaluations Clearly Explained in 50 Minutes (Real Example) | Hamel Husain · 英文,52 分钟。Hamel 拿一个真实产品演示评测怎么做,今天看前 20 分钟,留意他怎么处理「用例从哪来」。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):第 3、4 章讲评测方法和系统评测,英文原版。
- Shreya Shankar、Hamel Husain《Evals for AI Engineers》(O'Reilly,页面标注 2026 年 10 月出版):我只确认了 O'Reilly 有这本书的页面,没读过正文。

### 开源项目与代码

- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):这周用到的图、checkpoint、interrupt 都在这里,想知道某个行为是不是真的,读源码比读教程可靠。
- [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo):用配置文件写「用例加断言」的开源评测工具,和今天的 JSONL 加脚本对照看。

## 自测

1. 这一周的六天分别属于哪三条线?各自一句话。

<details><summary>答案</summary>

平台还是代码(336、337):平台适合快速验证,但画布全绿不等于对,评测集放自己仓库,有一张判断表决定何时改写代码。工具层和图(338、339、340):最小权限和越权检查写在工具层,图把分类、检索、循环、审批拼起来,模型有随机性。评测起步(341):用例加期望加逐条比较加门禁,「试过了」不算数。

</details>

2. 为什么 `check_call` 的第一道检查必须放在最前面?

<details><summary>答案</summary>

如果工具根本不在本类别的允许名单里,后面两道检查都没有意义,而且用 `args` 去做比较可能得到误导的原因。把它放第一,拒绝原因才准确:告诉模型「这类工单不能调用这个工具」,而不是别的。

</details>

3. `guard-v1` 比 `guard-final` 差在哪三条?各自对应缺了哪一道检查?

<details><summary>答案</summary>

G04(绑定客户后找客户)对应缺了第二道;G06 和 G10(工具不在允许名单里)对应缺了第一道。v1 只有第三道,所以第三道相关的 G02、G08、G12 仍然通过。

</details>

4. `check_call_lenient` 为什么比「删掉第三道检查」更危险?

<details><summary>答案</summary>

删掉一道检查,会让一批用例同时变红,很容易发现。「好心」改一处比较,只影响一个边界值,如果评测集里没有这条边界用例,所有其他用例都是对的,改动会顺利通过。越细微的改动越依赖边界用例。

</details>

5. (面试题)「你们 Agent 的权限控制怎么保证没被改坏?」用这周学的东西回答。

<details><summary>答案</summary>

权限检查写在工具执行层,不靠提示词,是一个不依赖模型的纯函数。我给它写了评测用例,每条是一次调用加期望的裁决,覆盖该放行和该拒绝两面,以及大小写之类的边界值,也把踩过的真实漏洞(只检查参数导致 `find_customer` 绕过)写成了用例。每次改动跑全部用例,和基线逐条比较,有任何一条变坏门禁就不通过,这一步做成了有退出码的脚本,可以接 CI。因为它不调模型,免费而且毫秒级,可以每次提交都跑。我还特意写了几个「写坏了」的版本,验证评测抓得住。

</details>

6. 为什么 `set -e` 在 `check_many.sh` 里不能用?

<details><summary>答案</summary>

`set -e` 会在第一个失败的命令处立刻退出,后面的版本就没机会跑了。这个脚本的目的是每个版本都跑完、都打印,最后汇总,所以用变量记录失败,最后统一 `exit`。

</details>

## 明天预告

明天是 [Day 343 · 评测金字塔:三层,越往上越贵](/blog/agent-zero/day-343-eval-pyramid/)。今天的 `check_call` 评测属于最便宜的那一层:纯代码断言,免费、毫秒级。Day 341 的分类也只用了一个相等判断。明天要问的是:回复写得对不对、有没有依据、语气像不像,这些写不成 `if`,该用什么,各自多少钱。
