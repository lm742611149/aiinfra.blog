---
title: 'Day 545 · 第 78 周复习:进阶(Day 539–544)'
description: '这一周从四个现成的持久化方案,走到编排取舍的三种立场和对比实验,再到设计文档、ADR 和评测资产的生命周期。今天不加新概念:画出六天的地图,默写两段核心代码(用例状态机的毕业规则、子 Agent 交回结果的状态检查),再用一个小项目 gate78.py 把设计文档第 8 节写成能跑的门禁,拿 Day 541 的真实实验数据验证它会放行谁、拦住谁。'
pubDate: 2026-10-27
regime: none
tags: ['review', 'eval', 'architecture', 'design-doc', 'durable-execution', 'agent-zero']
series: 'agent-zero'
day: 545
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 544](/blog/agent-zero/day-544-eval-org/) 讲评测在团队里怎么活下来:一个人的评测和一个团队的评测差在评测周围那一圈「谁负责」;一条用例有生老病死,从来源、评审入库、能力集、毕业进回归集到退役;总分一样的两个版本,拆开看可能是「学会 4 条、弄坏 4 条」;还用一个状态机 `case_lifecycle.py` 把规则写成了代码。

这一周六天的内容看起来散:持久化执行、多 Agent 吵架、设计文档、评测资产。串起来其实是同一条线,**一个资深工程师在做出技术决定的前后要做的事**:先搞清楚有哪些现成方案(Day 539),再在几种架构之间拿数据做取舍(Day 540–541),把决定和理由写成设计文档和 ADR(Day 542–543),最后让决定背后的评测能被一个团队长期维护(Day 544)。今天把它们拼成一个门禁,看这条线能不能真的跑起来。

## 今天要解决的问题

复习日不学新东西,目标是确认这一周的东西真的长在你手上了。今天结束时你应该能:

1. 不看文章,画出这一周的地图,说出每一天解决什么问题、产出哪个文件、踩过哪个坑。
2. 默写两段核心代码并用测试证明它们是对的:Day 544 状态机里的 `ALLOWED` 表、`move` 和 `ready_to_graduate`;Day 541 里「子 Agent 交回结果由代码检查状态」那段。
3. 跑通本周小项目 `part10/gate78.py`:读 Day 541 的真实实验结果,回归集和能力集分开出分,回归集不全过就拦住;再把设计文档里 G4 的成本上限和 ADR 0003 的重新评估条件变成能算的检查。
4. 能解释两个故意写错的版本为什么错:门禁只看总分;解析子 Agent 的 JSON 时假设它一定交回了 JSON。

预计用时 3.5–4 小时(大头在默写和练习)。前置:[Day 539](/blog/agent-zero/day-539-durable-4/) 到 [Day 544](/blog/agent-zero/day-544-eval-org/) 全部。

学法和平时一样:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 372" role="img" aria-label="本周知识地图:第一行是怎么选和怎么做,539 四个持久化方案,540 三篇文章四种架构,541 五个维度和对比实验;第二行是怎么写下来,542 设计文档八节骨架,543 示范文档和两份 ADR;第三行是怎么管,544 评测用例的生命周期;三行最后都汇到今天的小项目 gate78.py">
  <rect x="0" y="0" width="640" height="372" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <text x="20" y="24" fill="var(--ink)">选和做:现成方案、架构取舍</text>
    <rect x="20" y="34" width="180" height="66" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="32" y="54" fill="var(--ink)">539 四个现成方案</text>
    <text x="32" y="72" fill="var(--ink-soft)">Temporal·Restate</text>
    <text x="32" y="88" fill="var(--ink-soft)">DBOS·LangGraph</text>
    <rect x="230" y="34" width="180" height="66" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="242" y="54" fill="var(--ink)">540 三种立场</text>
    <text x="242" y="72" fill="var(--ink-soft)">四种架构</text>
    <text x="242" y="88" fill="var(--ink-soft)">读好拆,写难拆</text>
    <rect x="440" y="34" width="180" height="66" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="452" y="54" fill="var(--ink)">541 五个维度</text>
    <text x="452" y="72" fill="var(--ink-soft)">静默失败·状态字段</text>
    <text x="452" y="88" fill="var(--ink-soft)">arch_bench 对比实验</text>
    <line x1="410" y1="67" x2="440" y2="67" stroke="var(--ink-soft)"/>
    <text x="20" y="130" fill="var(--ink)">写下来:设计文档与 ADR</text>
    <rect x="20" y="140" width="180" height="66" rx="6" fill="var(--paper)" stroke="var(--ink-soft)"/>
    <text x="32" y="160" fill="var(--ink)">542 八节骨架</text>
    <text x="32" y="178" fill="var(--ink-soft)">目标:指标阈值怎么测</text>
    <text x="32" y="194" fill="var(--ink-soft)">非目标·模型编数字</text>
    <rect x="230" y="140" width="180" height="66" rx="6" fill="var(--paper)" stroke="var(--ink-soft)"/>
    <text x="242" y="160" fill="var(--ink)">543 示范与 ADR</text>
    <text x="242" y="178" fill="var(--ink-soft)">被放弃的方案三段式</text>
    <text x="242" y="194" fill="var(--ink-soft)">模型预审 6 条</text>
    <line x1="200" y1="173" x2="230" y2="173" stroke="var(--ink-soft)"/>
    <text x="20" y="236" fill="var(--ink)">管起来:评测资产</text>
    <rect x="20" y="246" width="180" height="66" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="32" y="266" fill="var(--ink)">544 用例的一生</text>
    <text x="32" y="284" fill="var(--ink-soft)">能力集·回归集·毕业</text>
    <text x="32" y="300" fill="var(--ink-soft)">状态机 case_lifecycle</text>
    <rect x="230" y="326" width="260" height="34" rx="6" fill="var(--paper)" stroke="var(--ink-soft)"/>
    <text x="360" y="347" text-anchor="middle" fill="var(--ink)">545 小项目:gate78.py</text>
    <path d="M 530 100 C 530 200, 480 290, 450 326" fill="none" stroke="var(--mem)" stroke-dasharray="4 3"/>
    <path d="M 410 173 C 470 220, 440 290, 420 326" fill="none" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
    <path d="M 200 279 C 260 290, 300 310, 310 326" fill="none" stroke="var(--compute)" stroke-dasharray="4 3"/>
  </g>
</svg>
<figcaption>这一周的三层。琥珀色是「状态存在哪、规则写在哪」(持久化日志、用例状态机),蓝色是「模型和架构」,灰色是「写下来」。三条虚线汇到今天的门禁:它读实验结果(541),检查设计文档里的目标和 ADR 的条件(542、543),用生命周期的分集规则出分(544)。</figcaption>
</figure>

这一周有一句话在三个地方以不同的样子出现:**让数字和证据说话,而不是让模型或者感觉说话。** Day 541 的判题函数、Day 542 的「数字自己填」、Day 543 的 `doc_numbers.py`、Day 544 的拆开两个分数,都是在避免同一件事:一个看起来很专业的结论,背后没有可以复查的东西。

## 本周每天一句话

[Day 539 · 四个现成方案](/blog/agent-zero/day-539-durable-4/):Temporal 和 Restate 是独立服务型(日志在服务端,服务端发现挂掉并重新派活),DBOS 和 LangGraph checkpoint 是库型(日志进你的数据库,恢复靠自己的进程);四家都只保证「至少一次、结果记下后不再执行」,幂等键还是你的事;值得引入的标准是三条满足两条:跨发版窗口、动钱、要等人。

[Day 540 · 编排取舍(一)](/blog/agent-zero/day-540-orch-1/):Cognition、Anthropic、LangChain 争的不是多 Agent 好不好,而是子任务之间依赖多少;「读的事可以拆,写的事一个人干」;四种架构只问一个问题,下一步是代码决定还是模型决定;写信实验拆开 5 次 4 次对不上。

[Day 541 · 编排取舍(二)](/blog/agent-zero/day-541-orch-2/):五个维度(能不能拆、读写、上下文爆不爆、可预测性与审计、成本延迟);子 Agent 失败不能悄悄吞掉,要交回带状态字段的结果、由代码检查;对比实验要分难度、控制变量、看 pass^k 和成本,第一次跑出来先读失败案例,先抓到的往往是自己的 bug;结论写成带推翻条件的一句话。

[Day 542 · 设计文档(一)](/blog/agent-zero/day-542-design-doc-1/):八节骨架每节回答一个问题;目标要有指标、阈值、怎么测三样;非目标是「合理但这次放弃」的东西,不是目标的反面;模型能把空话改得像目标,但数字只能来自你的数据。

[Day 543 · 设计文档(二)](/blog/agent-zero/day-543-design-doc-2/):文档里的数字放进脚本从实测值算出;被放弃的方案先写优点、再写放弃原因、再写重新评估条件;ADR 一页一个决定、只追加不修改;模型预审永远挑得出毛病,真问题改、分歧写进评审记录。

[Day 544 · 评测是产品(一)](/blog/agent-zero/day-544-eval-org/):评测是一个团队的事,周围那一圈「谁负责」决定它会不会烂;用例有生命周期;能力集和回归集分开出分,门禁只看回归集;毕业规则是连续 3 个版本、每版 5 遍都 ≥95%;退役要写理由并由需求方确认。

哪一句你读着觉得「好像是这样,但说不清为什么」,先回那一天把对应小节重看一遍再往下走。

## 准备环境

今天的代码都在 `agent-zero-lab/part10/` 下,先确认前几天的文件在:

| 文件 | 哪天建的 | 今天用它做什么 |
| --- | --- | --- |
| `part10/case_lifecycle.py` | Day 544 | 默写一;小项目没直接用,但 Day 546 的 registry 会用 |
| `part10/mixed_score.py` | Day 544 | 练习 1 复现「总分一样」 |
| `part10/goal_check.py` | Day 542 | `ex542_goal_check2.py` 要 import 它的 `GOALS` 和 `VAGUE` |
| `part10/ex542_goal_check2.py` | Day 542 练习 1 | 小项目用它检查目标 |
| `part10/arch_bench.py`、`bench_tasks.py` | Day 541 | 产生小项目要读的 `arch_bench_raw.json` |
| `part10/silent_fail.py` | Day 541 | 默写二的原型 |

小项目要读的 `part10/arch_bench_raw.json` 最好包含四种架构、每张工单 5 遍。我这次是这样跑的(2026 年 10 月 27 日,约 ¥0.21,按 DeepSeek 高峰价,约 300 次调用):

```bash
cd agent-zero-lab
uv run python -m part10.arch_bench 5 workflow single hybrid2
cp part10/arch_bench_raw.json /tmp/raw_three.json   # 先留一份,下一条命令会覆盖它
uv run python -m part10.arch_bench 5 hybrid
```

最后一步要把两个文件合起来(`arch_bench.py` 每次运行都覆盖输出文件)。用 `python -c` 合并:

```bash
uv run python -c "
import json
a = json.load(open('/tmp/raw_three.json'))
b = json.load(open('part10/arch_bench_raw.json'))
json.dump(a + b, open('part10/arch_bench_raw.json', 'w'), ensure_ascii=False, indent=1)
print(len(a + b), '条')
"
```

```text
160 条
```

如果你不想花这笔钱,用 Day 541 留下的 3 遍结果也能跑,门禁的结论不变,只是数字不同;但那份文件里没有 `hybrid`(混合第一版),看不到被拦住的例子。

## 默写一:`ALLOWED`、`move` 和 `ready_to_graduate`

合上 Day 544,在白纸或者新文件里写出状态机最核心的三处:一张「从哪能去哪」的表;改状态的唯一入口 `move`,它查表、记历史、再改状态;判断能不能毕业的 `ready_to_graduate`,只返回真假、不改状态。写完对照 Day 544 `case_lifecycle.py` 的原文:

```python
# agent-zero-lab/part10/case_lifecycle.py(节选)
# 每个状态能去哪些状态。没写的路一律不许走。
ALLOWED = {
    "proposed": {"capability", "regression"},
    "capability": {"regression", "retired"},
    "regression": {"retired"},
    "retired": set(),
}
GRAD_VERSIONS = 3  # 连续几个版本
GRAD_RATE = 0.95   # 每个版本的通过率至少多少

    def move(self, to: str, why: str) -> None:
        if to not in ALLOWED[self.status]:
            raise LifecycleError(f"{self.id}: 不能从 {self.status} 到 {to}")
        self.history.append(f"{self.status} → {to}:{why}")
        self.status = to

def ready_to_graduate(case: Case) -> bool:
    recent = case.runs[-GRAD_VERSIONS:]
    if len(recent) < GRAD_VERSIONS:
        return False
    return all(sum(r) / len(r) >= GRAD_RATE for r in recent)
```

<div class="line-notes">

- `ALLOWED = {` 状态机的核心就是这张表。键是当前状态,值是允许去的状态集合。没写的路一律不许走。
- `"regression": {"retired"},` 回归用例只能退役,不能退回能力集。回归集挂了是 bug,修 Agent,不是给它降级。
- `"retired": set(),` 退役是终点。空集合要写 `set()`,`{}` 得到的是空字典。
- `GRAD_VERSIONS = 3  # 连续几个版本` 两个毕业参数写成常量放在文件顶上,团队想调一眼能看到。
- `GRAD_RATE = 0.95   # 每个版本的通过率至少多少` 5 遍里要做到 95%,其实就是 5 遍全过(4/5 是 80%)。
- `def move(self, to: str, why: str) -> None:` 这是 `Case` 类里的方法,所以有 `self`。所有状态切换都必须经过它。
- `if to not in ALLOWED[self.status]:` 查表。proposed 想直接去 retired,表里没有这条路,抛 `LifecycleError`。
- `self.history.append(f"{self.status} → {to}:{why}")` 先记历史再改状态,历史里的 `self.status` 是旧状态。
- `recent = case.runs[-GRAD_VERSIONS:]` 负数切片取最后 3 个版本。`runs` 是列表的列表,每个内层列表是一个版本跑 5 遍的 0/1。
- `if len(recent) < GRAD_VERSIONS:` 版本数不够 3 个,直接不行。
- `return all(sum(r) / len(r) >= GRAD_RATE for r in recent)` 每个版本的通过率都 ≥95%。`all` 相当于 JS 的 `every`。

</div>

检查用的测试在下面(默写二写完之后一起跑)。几个容易默写错的地方先说:

- **只看最近三个版本**:`runs = [[0]*5, [1]*5, [1]*5, [1]*5]` 应该毕业,第一个版本全挂不影响。写成 `case.runs[:3]`(前三个)就会判成不毕业。
- **版本数不够 3 个不能毕业**:新入库的用例至少观察三个版本。漏了 `len(recent) < ...` 这一行,只有两个版本的用例也会被放过去。
- **「≥ 95%」包含 95%**:用 `>` 就把刚好 95% 的版本挡了。5 遍的情形下只有全过才能到 100%,而 4/5 = 80%,所以这一条在 k = 5 时实际等价于「全过」。

## 默写二:子 Agent 交回的结果,由代码检查状态

Day 541 讲过失败隔离:子 Agent 只交回一段话,主管分不清「没查到」和「查失败了」,甚至会编一个退款单号。修法是子 Agent 交回带 `status` 字段的 JSON,主管用代码检查状态,不是 ok 就转人工,根本不给模型编成功答复的机会。默写这一段:从子 Agent 交回的文字里取出 JSON,再按状态分流。

难点是 Day 541 原来的 `status_version` 里是这样解析的:`json.loads(found[found.find("{"):found.rfind("}") + 1])`。如果专员只回了一句「抱歉,我这边查不到」,一个花括号也没有,会怎样?

```bash
uv run python -c '
import json
found = "抱歉,我这边查不到。"
json.loads(found[found.find("{"):found.rfind("}") + 1])'
```

```text
Traceback (most recent call last):
  File "<string>", line 4, in <module>
  File "/Users/你/.local/share/uv/python/cpython-3.12.13-macos-x86_64-none/lib/python3.12/json/__init__.py", line 346, in loads
    return _default_decoder.decode(s)
  ...
json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)
```

`find` 找不到返回 `-1`,`rfind` 也是 `-1`,切片 `found[-1:0]` 是空字符串,`json.loads("")` 抛 `JSONDecodeError`。整个流程崩掉,工单既没转人工,也没回复客户。**正好是 Day 541 要避免的那种静默**:失败了却没有人知道。所以默写的版本要比原版多一步:取不出 JSON、解析不了、`status` 取值不对,统统当作 `failed`,转人工。

```python
# agent-zero-lab/part10/dictation78.py
"""默写参考答案:两段。第 2 段在 Day 541 的 status_version 基础上加了一条:专员没交回 JSON 也当失败。"""
import json

# ---- 默写二:子 Agent 交回的结果由代码检查状态 ----


def parse_handoff(found: str) -> dict:
    """从子 Agent 交回的文字里取出 JSON。取不出来,当作失败,而不是抛异常。"""
    start, end = found.find("{"), found.rfind("}")
    if start == -1 or end <= start:
        return {"status": "failed", "reason": "子 Agent 没有交回结构化结果", "refund_id": None}
    try:
        res = json.loads(found[start:end + 1])
    except json.JSONDecodeError:
        return {"status": "failed", "reason": "子 Agent 交回的 JSON 解析不了", "refund_id": None}
    if not isinstance(res, dict) or res.get("status") not in ("ok", "failed"):
        return {"status": "failed", "reason": "子 Agent 交回的 status 不是 ok 或 failed", "refund_id": None}
    return res


def route(res: dict) -> str:
    """状态由代码检查:不是 ok 就转人工,不给模型编一个成功答复的机会。"""
    if res["status"] != "ok":
        return f"[转人工] 账务专员失败:{res.get('reason', '')}"
    return "继续:让主管根据专员结论回复客户"
```

<div class="line-notes">

- `def parse_handoff(found: str) -> dict:` 输入是子 Agent 交回的原文,输出一定是一个带 `status` 的字典。不管它交回什么,这个函数不抛异常。
- `start, end = found.find("{"), found.rfind("}")` 第一个 `{` 和最后一个 `}` 的位置,找不到是 `-1`。这样即使模型在 JSON 前后多写了「好的:」「谢谢」也取得出来。
- `if start == -1 or end <= start:` 一个花括号也没有,或者括号顺序不对,就是没交回结构化结果。「抱歉,我这边查不到」走这条路。
- `return {"status": "failed", "reason": "子 Agent 没有交回结构化结果", "refund_id": None}` 失败也交回同样形状的字典,调用方不用特判。
- `res = json.loads(found[start:end + 1])` 取出两个括号之间的部分解析。
- `except json.JSONDecodeError:` 半截 JSON(模型被截断了)走这里,仍然当失败。
- `if not isinstance(res, dict) or res.get("status") not in ("ok", "failed"):` 解析出来了,但不是字典,或者 `status` 的取值不是约定的两个(比如模型写了 `"done"`),也当失败。约定之外的值不能当成功。
- `if res["status"] != "ok":` 路由:只要不是 `ok`,不管原因是什么,一律转人工。是「不是 ok 就拦」,而不是「是 failed 才拦」,新增的怪状态也会被拦下。
- `return f"[转人工] 账务专员失败:{res.get('reason', '')}"` 失败信息由代码拼出来,不经过模型,所以不会被编成一句「已为您办理退款」。
- `return "继续:让主管根据专员结论回复客户"` 只有 ok 才允许继续让模型写回复。

</div>

测试文件把默写一和默写二一起检查。新建 `part10/test_dictation78.py`:

```python
# agent-zero-lab/part10/test_dictation78.py
import pytest

from part10.case_lifecycle import ALLOWED, Case, LifecycleError, graduate, ready_to_graduate
from part10.dictation78 import parse_handoff, route


# ---- 默写一:Day 544 的状态机和毕业规则 ----
def test_allowed_table():
    assert ALLOWED["regression"] == {"retired"}   # 回归用例只能退役,不能退回能力集
    assert ALLOWED["retired"] == set()


def test_illegal_move():
    c = Case("T1", source="prd", owner="a", requirement="PRD-1")
    with pytest.raises(LifecycleError):
        c.move("retired", "嫌它烦")               # proposed 不能直接退役


@pytest.mark.parametrize("runs, expected", [
    ([[1] * 5] * 3, True),                         # 三个版本都 5/5
    ([[1] * 5, [1, 1, 1, 1, 0], [1] * 5], False),  # 中间一版 4/5 = 80%
    ([[1] * 5] * 2, False),                        # 才两个版本
    ([[0] * 5, [1] * 5, [1] * 5, [1] * 5], True),  # 只看最近三个版本
])
def test_ready_to_graduate(runs, expected):
    assert ready_to_graduate(Case("T2", source="prd", runs=runs)) is expected


def test_graduate_raises():
    c = Case("T3", source="prd", status="capability", runs=[[1, 0, 1, 1, 1]] * 3)
    with pytest.raises(LifecycleError):
        graduate(c)


# ---- 默写二 ----
@pytest.mark.parametrize("text, status", [
    ('{"status": "ok", "reason": "", "refund_id": "RF-1"}', "ok"),
    ('好的:{"status": "failed", "reason": "超时", "refund_id": null} 谢谢', "failed"),
    ("抱歉,我这边查不到。", "failed"),                 # 没有 JSON
    ('{"status": "ok", "reason": ', "failed"),         # 半截 JSON
    ('{"status": "done"}', "failed"),                  # status 取值不对
])
def test_parse_handoff(text, status):
    assert parse_handoff(text)["status"] == status


def test_route_never_lets_failure_through():
    assert route({"status": "failed", "reason": "超时"}).startswith("[转人工]")
    assert route({"status": "ok"}).startswith("继续")
```

<div class="line-notes">

- `from part10.case_lifecycle import ALLOWED, Case, LifecycleError, graduate, ready_to_graduate` 默写一检查的是 Day 544 原文件(把你默写的内容放进去替换一遍再跑,才是真检查)。
- `assert ALLOWED["regression"] == {"retired"}   # 回归用例只能退役,不能退回能力集` 把「不能降级」这条规则直接写成断言。
- `with pytest.raises(LifecycleError):` 期待代码里抛出这个异常,没抛就算测试失败。
- `@pytest.mark.parametrize("runs, expected", [` 一个测试函数跑多组数据,和 Day 537 的崩溃注入用的是同一个装饰器。
- `([[1] * 5] * 3, True),                         # 三个版本都 5/5` 乘 3 是把同一个内层列表引用三遍,这里只读不改,没有风险。
- `([[0] * 5, [1] * 5, [1] * 5, [1] * 5], True),  # 只看最近三个版本` 第一个版本全挂不影响结果,这条专门抓默写成 `runs[:3]` 的错误。
- `assert ready_to_graduate(Case("T2", source="prd", runs=runs)) is expected` 用 `is` 比较布尔值,保证返回的是真正的 `True`/`False`,不是 0 和 1。
- `c = Case("T3", source="prd", status="capability", runs=[[1, 0, 1, 1, 1]] * 3)` 三个版本都是 4/5,没到 95%,`graduate` 必须抛异常。
- `("抱歉,我这边查不到。", "failed"),                 # 没有 JSON` 默写二最重要的一条,原版代码会在这里崩溃。
- `assert route({"status": "failed", "reason": "超时"}).startswith("[转人工]")` 失败状态一定转人工。

</div>

```bash
uv run pytest part10/test_dictation78.py -q
```

```text
.............                                                            [100%]
13 passed in 0.03s
```

13 个用例全过。写测试的时候我故意让第 4 个参数化用例(只看最近三个版本)能抓到 `runs[:3]` 的错误:把 `ready_to_graduate` 里的 `[-GRAD_VERSIONS:]` 改成 `[:GRAD_VERSIONS]` 再跑,这一条会变红,其他几条不会,说明测试真的有区分度。

## 本周小项目:把设计文档第 8 节写成门禁

[Day 543](/blog/agent-zero/day-543-design-doc-2/) 的设计文档第 8 节(评测与上线)写了怎么证明目标达成,[Day 541](/blog/agent-zero/day-541-orch-2/) 的 ADR 0003 写了「换模型后重跑 `arch_bench.py`,如果……就重新评估」。这些都还是文字。今天把它们变成一个会自己报告、会拦人的脚本 `gate78.py`,做四件事:

1. 用 Day 542 的规则检查文档里的目标,有没有数字和比较方向;
2. 把 Day 541 的 8 张工单分成回归集(简单和中等,5 张)和能力集(复杂,3 张),**分开出分**,回归集不全过就拦住(Day 544 的规则);
3. 检查 G4 的成本上限 0.00147 元;
4. 把 ADR 0003 的重新评估条件算一遍。

这 8 张工单分集合的依据和 Day 544 练习 3 一样:简单和中等的早该稳了,是「已经做到、不能坏」;复杂的是「希望做到、还在爬」。

```python
# agent-zero-lab/part10/gate78.py
"""第 78 周小项目:把设计文档第 8 节写成一个门禁。
读 Day 541 的 arch_bench_raw.json,分开出回归集和能力集的分数,回归集不全过就拦住;
再把 G4 的成本上限和 ADR 0003 的重新评估条件变成能算的检查。"""
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

from part10.ex542_goal_check2 import check as goal_check

RAW = Path(__file__).parent / "arch_bench_raw.json"
SUITE = {"T1": "regression", "T2": "regression", "T3": "regression", "T4": "regression", "T5": "regression",
         "T6": "capability", "T7": "capability", "T8": "capability"}  # 简单+中等:早该稳了;复杂:还在爬
GOALS = {
    "G1": "新团队基于运行时接入一个带工具和审批的 Agent,不超过 2 人日。(预期;财务 Agent 组接入时实测)",
    "G2": "进程在任意一步被杀掉后恢复,结果与不被杀一致,有副作用的工具重复执行 0 次。",
    "G4": "单张平均成本不超过 0.00147 元。",
    "G5": "让退款更智能",
}
G4_CEILING = 0.00147


def load(arch: str) -> list[dict]:
    return [r for r in json.loads(RAW.read_text()) if r["arch"] == arch]


def split(runs: list[dict]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = defaultdict(list)
    for r in runs:
        out[SUITE[r["task_id"]]].append(r)
    return out


def failed_tickets(runs: list[dict]) -> dict[str, int]:
    bad: dict[str, int] = defaultdict(int)
    for r in runs:
        if not r["ok"]:
            bad[r["task_id"]] += 1
    return dict(bad)


def gate(arch: str) -> bool:
    runs = load(arch)
    suites = split(runs)
    total = sum(r["ok"] for r in runs)
    print(f"== {arch}:总分 {total}/{len(runs)} = {total / len(runs):.1%}")
    for name in ("regression", "capability"):
        part = suites[name]
        k = sum(r["ok"] for r in part)
        print(f"   {name:<10} {k}/{len(part)}  没过的工单:{failed_tickets(part) or '无'}")
    passed = all(r["ok"] for r in suites["regression"])  # 门禁只看回归集:必须全过
    print(f"   门禁:{'放行' if passed else '拦住(回归集有失败)'}")
    return passed


def revisit_adr_0003(single: list[dict], hybrid2: list[dict]) -> bool:
    """ADR 0003 的重新评估条件:单 Agent 平均成本低于混合架构,且单 Agent 全部通过。"""
    cheaper = statistics.mean(r["cost"] for r in single) < statistics.mean(r["cost"] for r in hybrid2)
    all_pass = all(r["ok"] for r in single)
    print(f"   ADR 0003:单 Agent 更便宜={cheaper},单 Agent 全过={all_pass} -> {'该重新评估' if cheaper and all_pass else '不触发'}")
    return cheaper and all_pass


def main(arch: str) -> int:
    print("目标检查(Day 542 的规则):")
    for gid, text in GOALS.items():
        problems = goal_check(text)
        print(f"   {gid} {'通过' if not problems else '不通过:' + ';'.join(problems)}")
    ok = gate(arch)
    cost = statistics.mean(r["cost"] for r in load(arch))
    print(f"   G4 成本:{cost:.5f} 元/张,上限 {G4_CEILING} -> {'达标' if cost <= G4_CEILING else '超了'}")
    revisit_adr_0003(load("single"), load("hybrid2"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "hybrid2"))
```

<div class="line-notes">

- `from part10.ex542_goal_check2 import check as goal_check` Day 542 练习 1 的改进版目标检查,认「至少」「0 次」这类写法。`as` 起个别名,避免和文件里别的 `check` 混淆。
- `RAW = Path(__file__).parent / "arch_bench_raw.json"` 读 Day 541 的原始结果,路径相对于脚本自己,在哪个目录运行都行。
- `SUITE = {"T1": "regression", "T2": "regression", "T3": "regression", "T4": "regression", "T5": "regression",` 前五张工单(简单 2 张、中等 3 张)进回归集。
- `"T6": "capability", "T7": "capability", "T8": "capability"}  # 简单+中等:早该稳了;复杂:还在爬` 三张复杂工单进能力集:T6(一个客户两处重复要全退)、T7(同金额不同月)、T8(同一天金额不同)。
- `"G5": "让退款更智能",` 故意放一条空话目标,看目标检查会不会抓到。
- `G4_CEILING = 0.00147` Day 543 的 G4 成本上限,混合第二版实测基线 0.0014 元乘 1.05。
- `return [r for r in json.loads(RAW.read_text()) if r["arch"] == arch]` 按架构名取出那一种架构的所有运行,8 张工单 × 5 遍 = 40 条。
- `out: dict[str, list[dict]] = defaultdict(list)` 按集合分组。`defaultdict(list)` 键第一次出现时自动建空列表。
- `out[SUITE[r["task_id"]]].append(r)` 查这次运行属于哪张工单、那张工单属于哪个集合,放进对应的列表。
- `bad: dict[str, int] = defaultdict(int)` 数每张工单失败了几次,`defaultdict(int)` 初值是 0。
- `if not r["ok"]:` 只数没过的。输出里 `{'T6': 5}` 就是「T6 失败了 5 次」。
- `print(f"== {arch}:总分 {total}/{len(runs)} = {total / len(runs):.1%}")` 总分照样打出来,但只是参考。
- `for name in ("regression", "capability"):` 回归集和能力集各打一行:通过数、没过的工单。
- `passed = all(r["ok"] for r in suites["regression"])  # 门禁只看回归集:必须全过` 整个门禁的规则只有这一行。能力集只展示,不拦截,这是 Day 544 的规矩。
- `def revisit_adr_0003(single: list[dict], hybrid2: list[dict]) -> bool:` ADR 0003 的重新评估条件:单 Agent 平均成本低于混合架构,**且**单 Agent 全部通过。
- `cheaper = statistics.mean(r["cost"] for r in single) < statistics.mean(r["cost"] for r in hybrid2)` 两个平均成本比较:single 0.00202 元,hybrid2 0.00137 元,所以 `cheaper` 是 `False`。
- `all_pass = all(r["ok"] for r in single)` single 39/40,有一次没过,是 `False`。
- `return cheaper and all_pass` 两个条件都满足才触发。现在一个都不满足。
- `problems = goal_check(text)` 对每条目标跑 Day 542 的检查,返回问题列表。
- `ok = gate(arch)` 门禁的结果,决定退出码。
- `cost = statistics.mean(r["cost"] for r in load(arch))` 被检查的架构的平均成本。
- `return 0 if ok else 1` 退出码:回归集不全过返回 1,CI 会变红。
- `sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "hybrid2"))` 命令行可以指定检查哪种架构,默认 hybrid2。

</div>

先检查 Day 541 选中的混合第二版:

```bash
uv run python -m part10.gate78 hybrid2
echo "exit=$?"
```

```text
目标检查(Day 542 的规则):
   G1 通过
   G2 通过
   G4 通过
   G5 不通过:没有数字;没有比较方向
== hybrid2:总分 40/40 = 100.0%
   regression 25/25  没过的工单:无
   capability 15/15  没过的工单:无
   门禁:放行
   G4 成本:0.00137 元/张,上限 0.00147 -> 达标
   ADR 0003:单 Agent 更便宜=False,单 Agent 全过=False -> 不触发
```

```text
exit=0
```

目标检查里 G1、G2、G4 通过,G5「让退款更智能」被抓:没有数字,没有比较方向。混合第二版 40/40,回归集 25/25,能力集 15/15,放行。G4 成本是 0.00137 元,在 0.00147 的上限之内。最后一行 ADR 0003 的重新评估条件:单 Agent 并不比混合第二版便宜(0.00202 对 0.00137),所以不触发。

再看工作流,它总分只有 87.5%,按「总分不低于 90%」这种门禁会被拦:

```bash
uv run python -m part10.gate78 workflow
echo "exit=$?"
```

```text
目标检查(Day 542 的规则):
   G1 通过
   G2 通过
   G4 通过
   G5 不通过:没有数字;没有比较方向
== workflow:总分 35/40 = 87.5%
   regression 25/25  没过的工单:无
   capability 10/15  没过的工单:{'T6': 5}
   门禁:放行
   G4 成本:0.00068 元/张,上限 0.00147 -> 达标
   ADR 0003:单 Agent 更便宜=False,单 Agent 全过=False -> 不触发
```

```text
exit=0
```

总分 35/40 = 87.5%,**但门禁放行**:回归集 25/25 全过,5 次失败全部来自 T6,而 T6 属于能力集。这就是 Day 544 的教训在真实数据上的样子:总分低,是因为它在一张还在爬的难题上不会,没有弄坏任何已经做到的东西。要不要用工作流,取决于你要不要处理 T6 这类情况(Day 541 说过,工作流的规则写死,一个客户有两处重复它就处理不了),不取决于总分。

最后看混合第一版,Day 541 里 25% 的那个:

```bash
uv run python -m part10.gate78 hybrid
echo "exit=$?"
```

```text
目标检查(Day 542 的规则):
   G1 通过
   G2 通过
   G4 通过
   G5 不通过:没有数字;没有比较方向
== hybrid:总分 10/40 = 25.0%
   regression 10/25  没过的工单:{'T1': 5, 'T2': 5, 'T5': 5}
   capability 0/15  没过的工单:{'T6': 5, 'T7': 5, 'T8': 5}
   门禁:拦住(回归集有失败)
   G4 成本:0.00125 元/张,上限 0.00147 -> 达标
   ADR 0003:单 Agent 更便宜=False,单 Agent 全过=False -> 不触发
```

```text
exit=1
```

总分 10/40 = 25%,回归集 10/25,没过的是 T1、T2、T5,每张都是 5 遍全挂,拦住,退出码 1。T1、T2 是问怎么改发票抬头,混合第一版压根没做分类,把它们也当退款工单处理:T1 回复「没有发现重复扣款,已转人工复核」,T2 甚至去退了一笔不相干的 468 元;T5 是没有重复扣款,它回复「多扣的 0 元已退回」。这些全是 Day 541 里「先抓到的是自己的 bug」那一节的症状,现在变成了一个会拦人的红叉。点名到具体的工单,修起来也有方向。

注意第三件事:hybrid 的成本检查是「达标」(0.00125 元),因为它便宜,只是它不正确。**门禁里成本检查不能脱离回归集单独看**,这也是为什么脚本先看回归集、再看成本。

### 零件和大代码的对照

| 本周学的零件 | 在 `gate78.py` 里是哪一段 |
| --- | --- |
| Day 540「写的事一个人干」、四种架构 | 被比较的四个 `arch` 名字;`hybrid2` 的代码核对让它通过回归集 |
| Day 541 判题函数、`arch_bench_raw.json` | `load()` 读的数据,`r["ok"]` 就是确定性判题的结果 |
| Day 541 ADR 的推翻条件 | `revisit_adr_0003`,条件写成了能算的代码 |
| Day 542 目标检查 | `goal_check` 和 `GOALS` 里的 G5 |
| Day 543 数字放进脚本、写出处 | `G4_CEILING` 的来源写在注释里;成本从原始数据算出来,不手填 |
| Day 544 能力集和回归集 | `SUITE` 分集、`gate` 只看回归集 |
| Day 544 毕业规则 | 本周小项目没用到(只有一个版本);Day 546 的 `health` 会用 |
| Day 539 持久化执行 | 这个门禁每晚跑几小时时才需要,练习 4 讨论 |

## 本周错题与坑清单

下面这些是本周最容易出错的地方,能复现的我都在本机复现过。

**用 `kill $!` 杀 `uv run` 起的后台进程。** Day 539 练习 2 踩的。`$!` 拿到的是 `uv` 的 pid,杀掉 `uv`,真正跑 Python 的子进程还活着。练习 1 现场复现。

**以为 LangGraph 拆了节点就不会重跑副作用。** 默认 `durability="async"` 时,上一个节点的 checkpoint 可能还没写进去进程就死了,`do_refund` 就重跑了。带幂等键;关键流程用 `durability="sync"`。

**Temporal 工作流里直接 `datetime.now()`。** 沙箱当场拦下,而且工作流不是失败而是一直卡在 Running。

**Temporal CLI 连 `localhost:7233` 报 `context deadline exceeded`。** `localhost` 先解析到 IPv6 的 `::1`,开发服务端只听 IPv4,命令加 `--address 127.0.0.1:7233`。

**拿多 Agent 的 90% 提升当它一定更好。** 那个数字里有很大一部分来自花了更多 token(原文说 token 用量解释了 80% 的差异)。Day 541 实测:多 Agent 成功率和单 Agent 一样,成本 4.4 倍,P95 延迟 3.6 倍。

**多 Agent 的主管多派了一个没用的活。** 一张普通退款工单上,主管让知识库专员白搜了十次。任务边界要写清,或者干脆不给这个选项。

**子 Agent 只交回一段话。** 主管分不清「没查到」和「查失败了」,练习里甚至编出了一个退款单号。要交回带 `status` 的结构化结果,状态由代码检查。

**工具出错时返回空列表。** 对模型来说空结果和「确实没有」长得一样。出错就返回带 `ok: False` 和原因的结构。

**判题函数自己先错了。** `must` 写的是「不能」,模型答「无法」,判成失败。第一次跑完一定要人工读失败案例,别直接拿成功率去汇报。

**让模型给的值直接进入有副作用的调用。** 混合第一版用模型给的发票号和金额去退款,退了一笔「0 元」。金额、发票号从系统重新取,或者代码核对后再用。

**目标里的数字是模型编的。** 模型把「提升开发效率」改写成「降低至少 50%」,基线谁也没测过。数字自己填,没有基线就写「先测基线」。

**非目标写成反过来的目标。** 「系统不应该崩溃」不是非目标。非目标是合理、有人会想要、这次放弃了的东西。

**被放弃的方案只写缺点。** 先写优点,再写放弃原因,再写重新评估条件。

**目标和评测计划对不上。** 目标写了四条,第 8 节只证明了两条。写完逐条问「哪一行证明它」。

**把模型预审当裁判。** 它永远挑得出毛病,改到 6/6 的文档没人读得完。真问题改,分歧写进评审记录。

**只看一个总分。** 能力集和回归集混在一起,新功能变好和老功能变坏会互相抵消。今天 workflow 的总分 87.5% 看着不行,回归集却是 25/25。

**能力集的分数跨版本直接比。** 能力用例毕业走了,换上来的是新难题,分数会掉。

**dataclass 里写 `history: list = []`。** `ValueError: mutable default <class 'list'> for field history is not allowed: use default_factory`。

**Day 538 提醒过的:工具函数自己打开的数据库要自己 commit。** 这一周没出现,但下周只要碰到「工具里写库」还会遇到。

## 动手练习

**练习 1:复现两个错题。** (a) 在 `agent-zero-lab` 里复现 `kill $!` 的坑,再用 `pkill -f` 按名字杀。(b) 跑 `mixed_score.py`,说出总分一样的两个版本分别是什么情况。

<details><summary>参考答案</summary>

(a) 新建 `part10/kill_demo.sh`:

```bash
#!/bin/sh
# agent-zero-lab/part10/kill_demo.sh
uv run python -c "import time; time.sleep(30)" kill-demo-marker &
P=$!
sleep 2
echo "kill 的目标(uv)pid: $P"
echo "名字里带 kill-demo-marker 的进程:"
pgrep -fl kill-demo-marker
kill -9 $P
sleep 1
echo "kill -9 $P 之后还剩:"
pgrep -fl kill-demo-marker
pkill -9 -f kill-demo-marker
sleep 1
echo "pkill 之后还剩:"
pgrep -fl kill-demo-marker || echo "(没有了)"
```

<div class="line-notes">

- `uv run python -c "import time; time.sleep(30)" kill-demo-marker &` 末尾的 `kill-demo-marker` 是个没用的参数,只是让这个进程的命令行里带一个独一无二的标记,方便按名字找。`&` 让它在后台跑。
- `P=$!` `$!` 是上一条后台命令的 pid,这里拿到的是 `uv` 的。
- `pgrep -fl kill-demo-marker` `-f` 按完整命令行匹配,`-l` 连命令一起列出。会看到两行:`uv` 和它拉起来的 Python。
- `kill -9 $P` 只杀了 `uv`。
- `pkill -9 -f kill-demo-marker` 按标记杀。一定要用一个独一无二的标记,不然 `pkill -f` 可能误伤别的进程;我第一次写成 `sleep.30` 这种泛的模式就有这个风险,后来换成了标记。

</div>

```bash
sh part10/kill_demo.sh
```

```text
kill 的目标(uv)pid: 37340
名字里带 kill-demo-marker 的进程:
37340 uv run python -c import time; time.sleep(30) kill-demo-marker
37342 /Users/你/agent-zero-lab/.venv/bin/python -c import time; time.sleep(30) kill-demo-marker
part10/kill_demo.sh: line 10: 37340 Killed: 9               uv run python -c "import time; time.sleep(30)" kill-demo-marker
kill -9 37340 之后还剩:
37342 /Users/你/agent-zero-lab/.venv/bin/python -c import time; time.sleep(30) kill-demo-marker
pkill 之后还剩:
(没有了)
```

`uv`(37340)被杀,真正跑 `time.sleep(30)` 的 Python(37342)还活着,要靠 `pkill -f` 按标记杀。(那一行 `Killed: 9` 是 shell 的提示。)

(b) `mixed_score.py` 在 Day 544 里:

```text
v1  总分 31/40 = 77.5%    能力集 3/12 = 25.0%   回归集 28/28 = 100.0%
v2  总分 31/40 = 77.5%    能力集 7/12 = 58.3%   回归集 24/28 = 85.7%
新学会:['C04', 'C05', 'C06', 'C07']
被弄坏:['R05', 'R11', 'R17', 'R23']
```

v1 和 v2 总分都是 31/40 = 77.5%。v2 的能力集从 25% 涨到 58.3%(新学会 C04–C07),回归集从 100% 掉到 85.7%(弄坏 R05、R11、R17、R23)。一好一坏被总分抵消。门禁应该只看回归集,把 v2 拦住。

</details>

**练习 2:两个版本之间,哪些工单新修好、哪些新弄坏。** 扩展 `gate78.py` 的思路:把 workflow 当旧版本,single 当新版本,逐张工单比较通过率,列出新修好的和新弄坏的,标上它属于哪个集合。这是代码评审(Day 546 的钉子二)要看的报告。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex545_diff.py
"""练习 2:两个版本之间,哪些工单新修好、哪些新弄坏。把 workflow 当旧版本,single 当新版本。"""
import sys
from collections import defaultdict

from part10.gate78 import SUITE, load


def per_ticket(arch: str) -> dict[str, tuple[int, int]]:
    """每张工单:(通过几次, 共几次)。"""
    acc: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for r in load(arch):
        acc[r["task_id"]][0] += r["ok"]
        acc[r["task_id"]][1] += 1
    return {t: (k, n) for t, (k, n) in acc.items()}


def diff(old: str, new: str) -> None:
    a, b = per_ticket(old), per_ticket(new)
    print(f"{old} -> {new}")
    for t in sorted(a):
        (ka, na), (kb, nb) = a[t], b[t]
        if ka / na != kb / nb:
            kind = "新修好" if kb / nb > ka / na else "新弄坏"
            print(f"  {t} [{SUITE[t]}] {kind}:{ka}/{na} -> {kb}/{nb}")


if __name__ == "__main__":
    diff(sys.argv[1], sys.argv[2])
```

<div class="line-notes">

- `from part10.gate78 import SUITE, load` 复用小项目里的分集表和读数据函数。
- `acc: dict[str, list[int]] = defaultdict(lambda: [0, 0])` 每张工单记 `[通过几次, 共几次]`,初值用 `lambda` 造一个新的 `[0, 0]`,不能直接传 `[0, 0]`(所有键会共用同一个列表)。
- `acc[r["task_id"]][0] += r["ok"]` 布尔值加进整数。
- `return {t: (k, n) for t, (k, n) in acc.items()}` 字典推导式,边遍历边把列表拆成元组。
- `if ka / na != kb / nb:` 通过率不同才报告。
- `kind = "新修好" if kb / nb > ka / na else "新弄坏"` 新版通过率更高是「新修好」,否则是「新弄坏」。
- `diff(sys.argv[1], sys.argv[2])` 命令行传旧、新两个架构名。

</div>

```bash
uv run python -m part10.ex545_diff workflow single
```

```text
workflow -> single
  T6 [capability] 新修好:0/5 -> 5/5
  T7 [capability] 新弄坏:5/5 -> 4/5
```

从 workflow 到 single:T6 新修好(0/5 → 5/5),因为单 Agent 不受「只退一张」的规则限制;T7 新弄坏(5/5 → 4/5),single 有一次把「8 月和 9 月各扣 468」当成了重复。两条都在能力集,所以不拦。这份报告比「87.5% 变成 97.5%」多了两样东西:谁变了,以及变的是不是不能坏的那部分。

</details>

**练习 3:ADR 0002 的重新评估条件写成函数。** Day 543 的 ADR 0002 写了两条:运行超过 24 小时的任务占比超过 10%;一个季度内出现 2 次以上恢复相关事故。写 `should_revisit(durations_hours, recovery_incidents_this_quarter)`,返回触发了哪几条的说明列表,用造出来的运行时长试三种情形。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex545_revisit_0002.py
"""练习 3:ADR 0002 的重新评估条件写成函数。输入的日志是造的,真实的要从运行日志表里算。"""


def should_revisit(durations_hours: list[float], recovery_incidents_this_quarter: int) -> list[str]:
    reasons = []
    long_share = sum(d > 24 for d in durations_hours) / len(durations_hours)
    if long_share > 0.10:
        reasons.append(f"超过 24 小时的任务占 {long_share:.0%},超过 10%")
    if recovery_incidents_this_quarter >= 2:
        reasons.append(f"本季度 {recovery_incidents_this_quarter} 次恢复相关事故")
    return reasons


if __name__ == "__main__":
    today = [0.2, 0.3, 1.5, 3.0, 0.1, 5.0, 8.0, 0.4, 2.0, 0.6]  # 10 个运行的时长(小时)
    later = today + [30, 48, 26]                                  # 后来来了 3 个跨天的审批
    print("现在:", should_revisit(today, 0) or "不触发")
    print("后来:", should_revisit(later, 1) or "不触发")
    print("出事:", should_revisit(today, 2) or "不触发")
```

<div class="line-notes">

- `long_share = sum(d > 24 for d in durations_hours) / len(durations_hours)` 超过 24 小时的占比。布尔值求和再除以总数。
- `if long_share > 0.10:` 严格大于 10%,和 ADR 原文「超过 10%」一致。
- `if recovery_incidents_this_quarter >= 2:` 「2 次以上」按 ≥ 2 算。边界写成哪一种要和 ADR 的措辞对上,措辞含糊这里就没法写。
- `today = [0.2, 0.3, 1.5, 3.0, 0.1, 5.0, 8.0, 0.4, 2.0, 0.6]  # 10 个运行的时长(小时)` 造出来的日志,真实的要从运行日志表里算,这个数据是虚构的。
- `later = today + [30, 48, 26]                                  # 后来来了 3 个跨天的审批` 列表相加是拼接。3 个超 24 小时的,13 个里占 23%。

</div>

```bash
uv run python -m part10.ex545_revisit_0002
```

```text
现在: 不触发
后来: ['超过 24 小时的任务占 23%,超过 10%']
出事: ['本季度 2 次恢复相关事故']
```

第一种情形什么都没触发;第二种触发了「超过 24 小时占 23%」;第三种触发了「本季度 2 次恢复相关事故」。这就是 Day 543 说「重新评估条件要可检查」的意思:条件能写成函数,就能放进夜间任务里自动报警,不用靠谁记得。注意第一条依赖运行日志里有运行时长,在写 ADR 的时候就应该确认这个数据采得到,采不到的条件等于没写。

</details>

**练习 4(开放题):夜间门禁怎么跑。** Day 546 会讲评测分三层,夜间那一层全量跑,放大后可能要跑 3 小时。如果这个夜间任务要在一台机器上跑 3 小时、每次约 ¥60,不动钱,用 Day 539 的三条标准判断要不要引入持久化执行方案,再说说怎么处理「跑到一半机器重启」。

<details><summary>参考答案</summary>

三条标准:跨发版窗口、动钱、要等人。夜间评测跑 3 小时,发版窗口通常在白天,所以不跨;它调的是评测用的模型,不对客户动钱,没有不可逆的副作用;不用等人。一条都不满足,不值得引入 Temporal、DBOS 这类系统。

跑到一半重启怎么办?它的特点是「每条用例互相独立、结果可以重算、重复执行没有后果」,这正是 Day 539 说的「任务队列加断点续跑」就够的情形:把每条用例的结果(用例 id、遍数、通过与否、成本)追加写进一个 JSONL 文件;任务启动时先读这个文件,已经有结果的跳过,只跑剩下的。重启后重新启动同一个任务就能接着跑,最多重算被打断的那一条。

要注意两点。一,「重复执行没有后果」要自己确认:评测里调的工具如果有副作用(往测试库写数据),要么每次清库,要么带幂等键。二,花的钱是真的:被打断的那几次已经计费,断点续跑是为了不重算前面 2 个多小时的,不是为了省被打断的那一条。如果以后夜间任务变成「跑完自动对比、发现回归就自动开 Issue 和通知相关人」,有了对外的副作用,再回头用三条标准评估一次。

</details>

**验收标准**:能不看文章画出本周地图并说出六天各自的核心;`test_dictation78.py` 的 13 个用例全过,而且你理解为什么 `runs[:3]` 的错误能被抓到;`gate78.py` 对 hybrid2、workflow、hybrid 的结果和正文一致(放行、放行、拦住 + 退出码 1);能说出为什么 workflow 总分只有 87.5% 却放行;练习 1 看到了 `uv` 被杀而 Python 子进程还活着。

## 名词解释

今天没有新术语,下面是本周的术语汇总,方便你对照着自测。

| 名词 | 意思 |
| --- | --- |
| 独立服务型 / 库型 | 持久化执行的两种形态:要多跑一个服务端(Temporal、Restate) / 只是一个包、日志进你的库(DBOS、LangGraph)(Day 539) |
| workflow / activity / worker | Temporal 里:会被重放的编排代码 / 被记录结果的一步 / 你启动、连服务端领活的进程(Day 539) |
| durability | LangGraph checkpoint 何时写库:sync 同步、async 后台(默认)、exit 退出时(Day 539) |
| 三种立场 | Cognition(单线程线性 Agent)、Anthropic(研究系统多 Agent)、LangChain(读好拆写难拆)(Day 540) |
| 工作流 / 单 Agent / 多 Agent / 混合 | 按「下一步是代码决定还是模型决定」划分的四种架构(Day 540) |
| 共享状态 / 消息传递 | 多 Agent 之间交换信息的两种方式(Day 541) |
| 静默失败 | 出了错却没有任何报错,比如工具超时返回空列表被当成「没有发票」(Day 541) |
| 状态字段 | 子 Agent 交回结果里的 `status`,由代码检查而不是让模型读一段话判断(Day 541) |
| pass^k | 同一张工单跑 k 次全部成功的比例,衡量稳定性(Day 344,Day 541 用) |
| P95 延迟 | 所有运行耗时排序后第 95% 位置的值(Day 541) |
| 提议-核对 | 模型提议要做什么,确定性代码核对是否符合规则,通过了才执行(Day 541) |
| 设计文档 / RFC | 动手写代码前写下打算怎么做、为什么、放弃了什么的文档(Day 542) |
| 目标 / 非目标 | 要达到的可验证结果(指标、阈值、怎么测) / 合理但这次明确不做的事(Day 542) |
| 范围蔓延 | 项目里不断「顺便」加进新需求,越做越大(Day 542) |
| ADR | 架构决策记录,一页一个决定,只追加不修改(Day 543) |
| 重新评估条件 | 写在决定旁边、可检查的一句话:看到什么数据或事件时要重新评估(Day 543) |
| 能力集 / 回归集 | 测还没做到的 / 测已做到不能坏的;门禁只看回归集(Day 544) |
| 毕业 / 饱和 / 退役 | 能力用例稳定后进回归集 / 能力集顶在高位看不出进步 / 带理由、经需求方确认后不再使用(Day 544) |
| 状态机 | 一个东西在几种状态间切换,哪些切换允许写成一张表(Day 544) |
| 门禁 gate | 一个会返回通过或拦住的检查,放在 CI 里,红了就合不进去 |

## 常见误区

**把这一周当成六个互不相干的话题。** 它们是同一条线:选现成方案、用数据比架构、把决定写下来、让决定背后的评测被长期维护。面试讲「你怎么做一个架构决定」时,这四步串起来讲。

**门禁只看总分。** 今天 workflow 总分 87.5% 放行,hybrid 总分 25% 拦住,靠的是回归集而不是总分。总分会让「学会一件事」和「弄坏一件事」互相抵消。

**成本检查脱离正确性单独看。** hybrid 的成本达标,但它回归集 10/25。便宜不是理由。

**对子 Agent 的输出做假设。** 默写二里原版代码假设它一定交回了 JSON,没交回就崩溃,工单既没转人工也没回复。检查数据的代码对输入的假设越少越稳。

**默写时只背代码,不跑检查。** 今天两段默写都配了测试。没跑过检查的默写,错了也不知道。

**重新评估条件写在文档里却没人算。** ADR 的条件如果不能写成函数,就很难有人定期去查。写 ADR 的时候就确认条件依赖的数据采得到。

**拿一次实验的结果当定论。** Day 541 每种架构每张工单只跑 3 遍,今天重跑 5 遍,single 出现了一次 Day 541 没出现的失败(T7)。这个差别是真是假,明天开始的统计几天会回答。

## 学习资料

### 文档与文章

- [Anthropic · Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):本周评测那一天和 Day 546 的出处,能力集、回归集、毕业都在这里。复习时重读「capability vs regression」一节。
- [Malte Ubl《Design Docs at Google》](https://www.industrialempathy.com/posts/design-docs-at-google/):设计文档那两天的出处。复习时再读一遍「非目标」和「什么时候不写」。
- [Michael Nygard《Documenting Architecture Decisions》](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions):ADR 的出处,很短。
- [Anthropic · Building multi-agent systems: When and how to use them](https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them):Day 540 引的 2026 年更新,「按上下文拆,不要按问题类型拆」。
- [Temporal 文档:Event History](https://docs.temporal.io/encyclopedia/event-history):Day 539 那份 19 行的事件历史,在真正的系统里长什么样。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV19LdqBAErd&autoplay=0&high_quality=1" title="多智能体系统怎么搭?claude给出了5种模式和选择标准" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>慢学AI · 多智能体系统怎么搭?claude 给出了 5 种模式和选择标准 · Day 540 推荐过的视频。复习时对着本周的「五个维度」看,检查你能不能提前说出它每个结论背后的维度。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ymjN6YE4Z&autoplay=0&high_quality=1" title="【IT老齐899.59】架构决策记录ADR最佳实践" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IT老齐 · 架构决策记录 ADR 最佳实践 · Day 543 推荐过的 11 分钟视频。复习时看你的 ADR 0002 和 0003 有没有他说的几个要素。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/XueTa4qrMpg" title="How Engineers and PMs should collaborate on Evals" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hamel Husain · How Engineers and PMs should collaborate on Evals · Day 544 推荐过的英文访谈,听他怎么讲评测的分工,为 Day 546 铺垫。</figcaption>
</figure>

### 书籍

- Martin Kleppmann《Designing Data-Intensive Applications》(O'Reilly,2017;中文版《数据密集型应用系统设计》,中国电力出版社)第 11 章:持久化执行的原理。
- Chip Huyen《AI Engineering》(O'Reilly,2025):评测和系统设计相关章节,可以对照本周的评测生命周期和架构取舍。

### 开源项目与代码

- [temporalio/samples-python](https://github.com/temporalio/samples-python)、[dbos-inc/dbos-transact-py](https://github.com/dbos-inc/dbos-transact-py):Day 539 的两家,复习时各挑一个例子对照你跑过的版本。
- [joelparkerhenderson/architecture-decision-record](https://github.com/joelparkerhenderson/architecture-decision-record):大量真实 ADR,看别人怎么写代价和重新评估条件。

## 自测

1. 四个持久化方案分成哪两类?四家有什么共同的、没人替你做的事?

<details><summary>答案</summary>

独立服务型(Temporal、Restate:日志在服务端,服务端发现挂掉并派活)和库型(DBOS、LangGraph checkpoint:日志进你自己的数据库,恢复靠自己的进程)。四家都只保证「至少一次执行,结果记下后不再执行」,「执行完、结果没记下」的窗口还在,幂等键要自己带。

</details>

2. 三篇文章(Cognition、Anthropic、LangChain)真正在争的是什么?

<details><summary>答案</summary>

争的不是多 Agent 好不好,而是子任务之间依赖有多少、是读还是写。依赖少、以读为主、能并行的任务,多 Agent 赚;依赖多、以写为主、要求前后一致的任务,多 Agent 赔。两家 2026 年的共识可以记成「写的事一个人干,读和想的事可以多人分」。

</details>

3. 对比实验里,为什么「第一次跑出来的成功率」不能直接汇报?

<details><summary>答案</summary>

第一次跑,失败案例里混着判题函数的错(「不能」「无法」)、自己代码的 bug(混合架构没分类、退了 0 元)、规则没覆盖(工作流只会退一张)。不读失败案例就汇报,会把尺子的错和代码的错算到架构头上。

</details>

4. 目标「提升开发效率」要改成什么才算可验证?为什么不能让模型填数字?

<details><summary>答案</summary>

要有指标、阈值和方向、怎么测三样,比如「新团队接入不超过 2 人日(预期;财务 Agent 组接入时实测)」。模型能把格式理顺,但它没有你的数据,「至少 50%」是一个听起来合理的整数,基线没人测过。数字自己填,没有基线就写「先测基线」。

</details>

5. 为什么 workflow 总分 87.5% 而门禁放行,hybrid 总分 25% 被拦住?

<details><summary>答案</summary>

门禁只看回归集。workflow 的 5 次失败全来自 T6,T6 在能力集,回归集 25/25 全过;hybrid 的回归集 10/25,T1、T2、T5 各 5 遍全挂。总分把「还没学会的难题」和「弄坏的老功能」混在一起,分开出分才看得出前者只是进度、后者是事故。

</details>

6. 面试题:「你在团队里做过一个架构决定吗?怎么做的,怎么保证半年后别人看得懂、也敢改?」

<details><summary>答案</summary>

按这周的四步讲。选型:列现成方案(如 Temporal、DBOS、自研),按三条标准判断要不要引入;取舍:用同一批分难度的工单、同一个模型,对比成功率、pass^k、成本和延迟,先读失败案例再看数字;记录:写设计文档(目标有指标阈值怎么测、非目标、被放弃的方案先写优点)加 ADR(一页一个决定,写代价和可检查的重新评估条件),数字放进脚本写出处;维护:把评测按生命周期管起来,能力集和回归集分开,门禁只看回归集,重新评估条件写成函数,换模型时重跑实验脚本。最后举一个具体的例子:比如「单 Agent 也能全过,为什么还要加代码核对」。

</details>

## 明天预告

Day 546 · 评测是产品(二):分工、钉进流程、预算和 registry。今天的门禁回答了「分数怎么看」,但还有人的问题没回答:谁来写用例、谁来评审、谁来批退役、分数掉了谁去看;一次评测要跑多久、花多少钱,放到每个 MR 上会不会被大家绕过去。明天讲分工、四个把它钉进流程的动作和三层评测预算,并写一个 `registry.py`,让缺负责人和需求号的用例进不了仓库,毕业判断就用今天默写的 `ready_to_graduate`。
