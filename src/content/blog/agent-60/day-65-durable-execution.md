---
title: 'Day 65 · 持久化执行:跑几小时的 Agent 怎么不怕重启'
description: '退款审批要等主管几个小时,年度对账要跑一个下午,中间发版重启、机器被回收都很正常。今天讲持久化执行(durable execution)的原理:把每一步的结果记进日志,重启后重放。再讲 Agent 特有的麻烦:模型输出不确定,重放时怎么办;副作用做了一半,怎么不重复退款。最后自己写一个带日志重放和幂等键的运行器,并对比 Temporal、Restate、DBOS 和 LangGraph checkpoint。'
pubDate: 2026-10-12
regime: none
tags: ['durable-execution', 'temporal', 'idempotency', 'saga', 'agent-60']
series: 'agent-60'
day: 65
lang: 'zh'
---

## 今天要解决的问题

基础篇 Day 37 讲过长任务的可靠性:任务队列、重试、幂等、超时。那时候的长任务是「几分钟」。进阶篇要面对的是「几小时到几天」:退款审批要等主管下班前点同意;年度对账 Agent 要翻几百页账单;研发团队的代码 Agent 一跑就是一下午。在这么长的时间里,发版重启、容器被回收、依赖的服务短暂不可用,几乎一定会发生。

如果每次中断都要从头再来,问题不只是浪费钱。更麻烦的是那些已经做过的事:退款已经提交了,邮件已经发出去了,从头再跑一遍,客户会收到两笔退款和两封邮件。

这一类问题有一个专门的名字叫持久化执行(durable execution),Temporal 是这个领域最有名的系统。2026 年它拿到了一轮大额融资,很多报道直接把它和 AI Agent 联系在一起,原因就是 Agent 的长任务天然需要它。

学完今天你应该能:

1. 讲清楚持久化执行的核心原理:事件日志和重放。
2. 说出 Agent 让这件事变难的两个地方:非确定性和副作用,以及各自的解法。
3. 写一个最小的持久化运行器,能在任意一步崩溃后恢复,而且不会重复执行副作用。
4. 比较 Temporal、Restate、DBOS、LangGraph checkpoint,知道什么时候该引入它们。

预计用时 5–6 小时。前置:Day 37(长任务可靠性)、Day 25(审批中断)、Day 62(harness)。

## 原理:记日志,然后重放

持久化执行的思路非常朴素。一个任务由很多步组成,每做完一步,就把这一步的结果写进一个持久化的日志。进程崩溃以后,在任何一台机器上重新运行同一段代码,代码走到第一步时,运行时去日志里一查,发现这一步已经做过了,直接返回日志里记的结果,不真正执行;第二步也一样;一直到日志里没有记录的那一步,才开始真正执行。

从代码的角度看,它就像从来没崩溃过一样一路跑下来。这就是「重放」。

这个思路有一个前提:**代码在重放时必须走出和第一次一样的路径**。如果第一次走的是「查发票、退款、回复」,重放时因为某个原因走成了「查发票、回复」,日志里的第二步(退款的结果)就会被错当成回复的结果,一切都乱了。所以 Temporal 对工作流代码有严格要求:工作流里不能直接读当前时间、不能用随机数、不能直接发网络请求,这些不确定的操作都要放进叫 activity 的单元里,由运行时记录结果。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="第一次运行执行了第 1、2 步并写入日志后崩溃;第二次运行时第 1、2 步从日志重放,第 3、4 步真正执行">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <text x="20" y="44" fill="var(--ink)">第一次</text>
    <rect x="90" y="28" width="100" height="28" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="140" y="46" text-anchor="middle" fill="var(--ink)">1 调模型</text>
    <rect x="200" y="28" width="100" height="28" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="250" y="46" text-anchor="middle" fill="var(--ink)">2 查发票</text>
    <text x="320" y="46" fill="var(--compute)">✕ 进程被杀</text>
    <rect x="90" y="84" width="210" height="34" rx="3" fill="var(--paper)" stroke="var(--ink-soft)"/>
    <text x="195" y="100" text-anchor="middle" fill="var(--ink)">日志:步骤 1、2 的结果</text>
    <text x="195" y="113" text-anchor="middle" fill="var(--ink-faint)" font-size="10">每步做完先落盘</text>
    <line x1="140" y1="56" x2="140" y2="84" stroke="var(--ink-faint)"/><line x1="250" y1="56" x2="250" y2="84" stroke="var(--ink-faint)"/>
    <text x="20" y="174" fill="var(--ink)">第二次</text>
    <rect x="90" y="158" width="100" height="28" rx="3" fill="var(--paper)" stroke="var(--rule)" stroke-dasharray="4 3"/><text x="140" y="176" text-anchor="middle" fill="var(--ink-faint)">1 重放</text>
    <rect x="200" y="158" width="100" height="28" rx="3" fill="var(--paper)" stroke="var(--rule)" stroke-dasharray="4 3"/><text x="250" y="176" text-anchor="middle" fill="var(--ink-faint)">2 重放</text>
    <rect x="310" y="158" width="100" height="28" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="360" y="176" text-anchor="middle" fill="var(--ink)">3 退款</text>
    <rect x="420" y="158" width="100" height="28" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="470" y="176" text-anchor="middle" fill="var(--ink)">4 写回复</text>
    <line x1="140" y1="118" x2="140" y2="158" stroke="var(--ink-faint)"/><line x1="250" y1="118" x2="250" y2="158" stroke="var(--ink-faint)"/>
    <text x="320" y="214" text-anchor="middle" fill="var(--ink-faint)" font-size="10">虚线框:不真正执行,直接从日志取结果。模型不会被再调一次</text>
  </g>
</svg>
<figcaption>持久化执行的核心:事件日志加重放。代码看起来是一路跑下来的,实际上前两步只是在读日志。</figcaption>
</figure>

## Agent 让这件事变难的两个地方

### 非确定性

普通的业务工作流,步骤是写死的:先扣库存,再生成订单。Agent 的步骤是模型决定的:同样的输入,第二次调用模型可能决定先查知识库而不是先查发票。

如果把模型调用放在 activity(或者我们下面实现里的 `step`)里,问题就解决了一半:重放时不真的调模型,而是用日志里记录的那次输出,所以后面的路径和第一次完全一样。这也顺带省了钱,重放的那些步骤不再花 token。

另一半问题是**代码改了**。你在任务跑到一半时发了一个新版本,新版本的循环在第 3 步之后多加了一次知识库检索。重放时第 4 步在日志里是「写回复」,在新代码里是「查知识库」,对不上。Temporal 的做法是检测到这种不一致就报错,并且提供版本化的 API,让你在代码里写「老的运行走老逻辑,新的运行走新逻辑」。我们下面的实现也做了检测:每一步记下名字和参数的哈希,对不上就抛 `NonDeterminismError`,不会悄悄地用错结果。

### 副作用和恰好一次

更危险的是这种情况:第 3 步调了支付系统的退款接口,支付系统那边已经退款成功,但在结果写进日志之前,进程崩溃了。重放时日志里没有第 3 步的记录,于是又调了一次退款接口。客户收到两笔退款。

这个窗口无论怎么缩小都消不掉,因为「调外部系统」和「写自己的日志」是两个系统里的两个动作,不可能原子地同时完成。工程上的标准解法是**幂等键**:每一次有副作用的调用都带一个确定性的键(比如运行 ID 加步骤序号),外部系统看到同一个键,就返回上一次的结果而不是再做一次。这样,我们这边保证「至少一次」,对方用幂等键去重,合起来就是「效果上恰好一次」。

如果外部系统不支持幂等键怎么办?那就只能在调用前先查一下「这件事是不是已经做过了」,比如按发票号查有没有退款记录,再决定要不要调。这比幂等键脆弱,因为查和做之间还是有窗口,但总比什么都不做好。选择对接的第三方服务时,支不支持幂等键应该是一个评估项。

### 补偿:做到一半要撤回怎么办

还有一种情况是业务上的失败,不是崩溃:Agent 为一个客户办理「换套餐」,已经取消了旧订阅,创建新订阅时失败了。这时候客户既没有旧套餐也没有新套餐。分布式系统里处理这类问题的经典模式叫 Saga:每一个有副作用的步骤都配一个补偿动作(取消订阅的补偿是恢复订阅),后面的步骤失败时,按相反顺序执行前面步骤的补偿。

Agent 场景里,我的建议是把补偿逻辑写成确定性的代码,而不是失败时让模型「想办法回滚」。模型临场发挥的回滚,结果不可预测,也没法测试。

## 自己写一个持久化运行器

下面的实现大约 60 行,用 SQLite 存日志。规则是:一次运行里,所有有外部效果或者不确定的操作,都必须通过 `run.step(...)` 执行,包括调模型、调工具、取当前时间。

```python
# agentops/runtime/durable.py
"""最小的持久化执行:每一步的结果写进日志,重启后按日志重放,已经做过的步骤不再执行。"""
from __future__ import annotations

import hashlib
import json
import sqlite3
from typing import Any, Callable


class Journal:
    def __init__(self, path: str = "journal.db"):
        self.db = sqlite3.connect(path)
        self.db.execute("CREATE TABLE IF NOT EXISTS steps(run_id TEXT, seq INTEGER, name TEXT,"
                        " args_hash TEXT, result TEXT, PRIMARY KEY(run_id, seq))")

    def get(self, run_id: str, seq: int):
        return self.db.execute("SELECT name, args_hash, result FROM steps WHERE run_id=? AND seq=?",
                               (run_id, seq)).fetchone()

    def put(self, run_id: str, seq: int, name: str, args_hash: str, result: Any) -> None:
        self.db.execute("INSERT INTO steps VALUES(?,?,?,?,?)",
                        (run_id, seq, name, args_hash, json.dumps(result, ensure_ascii=False)))
        self.db.commit()  # 先落盘再返回,崩溃也不会丢已完成的步骤


class NonDeterminismError(RuntimeError):
    pass


class DurableRun:
    """在一个 run 里,所有「有外部效果或不确定的事」都必须通过 step() 执行:调模型、调工具、取时间、取随机数。"""

    def __init__(self, journal: Journal, run_id: str):
        self.j, self.run_id, self.seq = journal, run_id, 0
        self.replayed = self.executed = 0

    def step(self, name: str, fn: Callable[..., Any], *args, **kwargs) -> Any:
        self.seq += 1
        h = hashlib.sha256(json.dumps([name, args, kwargs], ensure_ascii=False, sort_keys=True,
                                      default=str).encode()).hexdigest()[:16]
        row = self.j.get(self.run_id, self.seq)
        if row:
            if (row[0], row[1]) != (name, h):
                # 代码改了,或者上一步的结果被重新算出了不同的值,导致这一步的参数变了
                raise NonDeterminismError(f"第 {self.seq} 步:日志里是 {row[0]},这次是 {name}")
            self.replayed += 1
            return json.loads(row[2])
        result = fn(*args, **kwargs)
        self.j.put(self.run_id, self.seq, name, h, result)
        self.executed += 1
        return result

    def idempotency_key(self) -> str:
        """给有副作用的调用用:同一个 run 的同一步,重试多少次都是同一个键。"""
        return f"{self.run_id}-{self.seq + 1}"
```

用一个退款流程演示三种情况:中途崩溃后恢复、全部完成后再跑一次、以及最危险的「退款成功后、写日志前崩溃」。

```python
# agentops/runtime/durable_demo.py
import os
from durable import DurableRun, Journal

CALLS = {"llm": 0, "refund": 0}
REFUNDS = {}  # 假装是支付系统,按幂等键去重


def fake_llm(prompt: str) -> str:
    CALLS["llm"] += 1
    return {"plan": "查发票,确认重复后退款", "reply": "多扣的 468 元已退回"}[prompt]


def list_invoices(customer_id: str) -> list:
    return [{"id": "INV-2290", "amount": 468}, {"id": "INV-2291", "amount": 468}]


def create_refund(invoice_id: str, amount: int, idem_key: str) -> dict:
    CALLS["refund"] += 1
    if idem_key in REFUNDS:  # 支付系统看到相同的幂等键,直接返回上次的结果
        return REFUNDS[idem_key]
    REFUNDS[idem_key] = {"refund_id": f"RF-{len(REFUNDS) + 1}", "invoice_id": invoice_id, "amount": amount}
    return REFUNDS[idem_key]


def workflow(run: DurableRun, crash_after: int | None = None):
    plan = run.step("llm", fake_llm, "plan")
    invoices = run.step("tool.list_invoices", list_invoices, "C007")
    if crash_after == 2:
        raise SystemExit("进程在第 2 步之后被杀掉")
    dup = invoices[-1]
    refund = run.step("tool.create_refund", create_refund, dup["id"], dup["amount"], run.idempotency_key())
    reply = run.step("llm", fake_llm, "reply")
    return plan, refund, reply


if os.path.exists("journal.db"):
    os.remove("journal.db")
j = Journal("journal.db")
try:
    workflow(DurableRun(j, "run-1"), crash_after=2)
except SystemExit as e:
    print("第一次:", e, "| 模型调用", CALLS["llm"], "次")

run = DurableRun(j, "run-1")
plan, refund, reply = workflow(run)
print("第二次:重放", run.replayed, "步,真正执行", run.executed, "步 | 模型累计调用", CALLS["llm"], "次")
print("结果:", refund, reply)

run = DurableRun(j, "run-1")
workflow(run)
print("第三次(全部完成后再跑):重放", run.replayed, "步,执行", run.executed, "步 | 退款接口累计被调", CALLS["refund"], "次,实际退款", len(REFUNDS), "笔")

# 最危险的情况:退款已经在支付系统里成功了,但还没来得及写日志,进程就挂了
def refund_then_crash(invoice_id, amount, idem_key):
    create_refund(invoice_id, amount, idem_key)
    raise SystemExit("退款成功后、写日志前崩溃")


def workflow2(run, crash=False):
    invoices = run.step("tool.list_invoices", list_invoices, "C009")
    dup = invoices[-1]
    fn = refund_then_crash if crash else create_refund
    return run.step("tool.create_refund", fn, dup["id"], dup["amount"], run.idempotency_key())


before = len(REFUNDS)
try:
    workflow2(DurableRun(j, "run-2"), crash=True)
except SystemExit as e:
    print("run-2 第一次:", e)
print("run-2 恢复后:", workflow2(DurableRun(j, "run-2")), "| 这个 run 实际新增退款", len(REFUNDS) - before, "笔")
```

本机运行的输出:

```text
第一次: 进程在第 2 步之后被杀掉 | 模型调用 1 次
第二次:重放 2 步,真正执行 2 步 | 模型累计调用 2 次
结果: {'refund_id': 'RF-1', 'invoice_id': 'INV-2291', 'amount': 468} 多扣的 468 元已退回
第三次(全部完成后再跑):重放 4 步,执行 0 步 | 退款接口累计被调 1 次,实际退款 1 笔
run-2 第一次: 退款成功后、写日志前崩溃
run-2 恢复后: {'refund_id': 'RF-2', 'invoice_id': 'INV-2291', 'amount': 468} | 这个 run 实际新增退款 1 笔
```

逐行看。第二次运行时,前两步从日志重放,模型只被多调了一次(用于最后写回复),而不是从头调两次。第三次运行所有步骤都在日志里,一步都不执行,退款接口一共只被调用过一次。run-2 那种情况,恢复时退款接口确实被调用了第二次,但因为幂等键相同,支付系统只退了一笔。

这个实现故意很简单,离生产还差几样东西:多个进程同时恢复同一个运行时要加锁(否则两台机器会同时执行同一步);日志要定期归档,不然长期运行的系统会越积越多;需要一个调度器去发现「卡住的运行」并在别的机器上恢复它。这些正是 Temporal 这类系统花了好几年做的事。

## 四个现成方案

| 方案 | 怎么记录 | 写法 | 部署 | 适合 |
| --- | --- | --- | --- | --- |
| Temporal | 独立服务存事件历史 | workflow 加 activity,有确定性约束 | 要运维一套 Temporal 集群,或用云版 | 跨团队、长周期、高可靠要求的核心流程 |
| Restate | 独立服务,日志驱动 | 在函数里用上下文对象包裹每个副作用 | 单个二进制,较轻 | 想要持久化执行但不想背 Temporal 的运维 |
| DBOS | 直接存在你的 Postgres 里 | 用 `@DBOS.workflow()` 和 `@DBOS.step()` 装饰函数 | 只是一个库,没有额外服务 | 已经有 Postgres、团队小、想少一套服务 |
| LangGraph checkpoint | 每个节点执行完存一次状态 | 画图,配 checkpointer | 用你自己的数据库 | 已经用 LangGraph,粒度到节点就够 |

我查到的版本(2026 年 10 月):`temporalio` 1.34.0,`dbos` 3.2.0,`restate-sdk` 1.0.5。

LangGraph 的 checkpoint 和前三者有一个重要区别:它的粒度是节点。如果一个节点内部先调了退款接口、再调了模型,在两者之间崩溃,恢复时整个节点重跑,退款会被再调一次。所以用 LangGraph 时,有副作用的操作最好单独成一个节点,并且同样要带幂等键。

用 Temporal 写同样的退款流程大概是这样。注意审批是用信号(signal)实现的:工作流在 `wait_condition` 处暂停,不占用任何进程,等几天都可以;审批人点同意时,后台给这个工作流发一个信号,它就从暂停的地方继续。

```python
# agentops/runtime/temporal_refund.py(示意,需要 pip install temporalio 并启动 Temporal 服务)
from datetime import timedelta

from temporalio import activity, workflow
from temporalio.common import RetryPolicy


@activity.defn
async def call_llm(prompt: str) -> str:
    ...  # 调模型。activity 的结果会写进 Temporal 的事件历史,重放时直接取


@activity.defn
async def create_refund(invoice_id: str, amount: int, idem_key: str) -> dict:
    ...  # 调支付系统,一定要带幂等键


@workflow.defn
class RefundWorkflow:
    def __init__(self) -> None:
        self.approved: bool | None = None

    @workflow.signal
    def approve(self, ok: bool) -> None:  # 审批人在后台点「同意」时发这个信号
        self.approved = ok

    @workflow.run
    async def run(self, customer_id: str) -> str:
        retry = RetryPolicy(maximum_attempts=3)
        plan = await workflow.execute_activity(call_llm, f"处理 {customer_id} 的退款",
                                               start_to_close_timeout=timedelta(seconds=60), retry_policy=retry)
        await workflow.wait_condition(lambda: self.approved is not None)  # 可以等几天,不占进程
        if not self.approved:
            return "审批未通过,已转人工"
        key = f"{workflow.info().workflow_id}-refund"
        await workflow.execute_activity(create_refund, args=["INV-2291", 468, key],
                                        start_to_close_timeout=timedelta(seconds=30), retry_policy=retry)
        return plan
```

这段我没有在本地起 Temporal 服务跑过,API 是按 `temporalio` 官方文档写的,用之前请对照文档核对。Temporal 还和 OpenAI Agents SDK 做了集成,能让 Agents SDK 的运行自动变成持久化的,官方频道有演示视频,放在学习资料里了。

**什么时候该引入这些系统?** 我的判断标准是三条,满足任意两条就值得考虑:任务会跨越发版窗口(超过半小时);任务里有不可逆的副作用(资金、对外发消息);需要等人(审批、补充信息)。只满足一条的话,Day 37 的任务队列加幂等通常就够了。另外,引入 Temporal 这类系统的成本主要不在代码,而在团队要学会它的确定性约束。如果团队里只有你懂,它会变成一个没人敢动的黑盒。

## 动手练习

**第一步:跑通运行器。** 把 `durable.py` 和 `durable_demo.py` 放进 `agentops/runtime/`,跑出和上面一样的输出。

**第二步:测非确定性检测。** 跑完第一次(崩溃)以后,修改 `workflow`,在查发票之前加一步 `run.step("tool.search_kb", ...)`,再恢复,确认抛出 `NonDeterminismError`。然后想一个办法让新代码能兼容老的运行(提示:在日志里记一个版本号)。

**第三步:接进 harness。** 把 Day 62 harness 里的模型调用和工具执行都改成走 `run.step`,让整个 Agent 循环变成可恢复的。用 `kill -9` 在任意一步杀掉进程,再恢复,确认最终结果和不杀的时候一样,且有副作用的工具只执行了一次。

**第四步:写一个补偿。** 给「换套餐」场景写两个工具:取消旧订阅、创建新订阅,以及取消的补偿动作。让创建新订阅失败,确认补偿被执行、客户回到旧套餐。

**第五步(选做):用 DBOS 或 Temporal 重写一遍。** 二选一,写一份半页的对比笔记:代码量、需要额外运维什么、你觉得 AgentOps 该用哪个。

**验收标准**:`kill -9` 测试至少在 3 个不同的步骤上做过且结果一致;非确定性能被检测到;补偿流程有测试;选做部分的笔记里有明确的推荐和理由。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 持久化执行 durable execution | 把每一步的结果持久化,崩溃后通过重放恢复,代码看起来像没中断过 |
| 事件日志 / 事件历史 | 记录每一步结果的持久化日志,重放的依据 |
| 重放 replay | 重新运行代码,已完成的步骤直接从日志取结果 |
| activity | Temporal 里执行不确定操作或副作用的单元,结果会被记录 |
| 幂等键 | 外部系统用来识别重复请求的键,同一个键只执行一次 |
| 恰好一次 exactly-once | 效果上只发生一次;工程上通常靠「至少一次」加幂等实现 |
| Saga | 每个步骤配一个补偿动作,失败时反向补偿的分布式事务模式 |
| signal | Temporal 里从外部给运行中的工作流发消息的机制,常用于审批 |

## 常见误区

**以为加了重试就等于持久化。** 重试只能应对单步失败,进程崩溃以后内存里的进度全没了。持久化执行要的是进度本身落盘。

**在重放的代码路径里直接调模型。** 模型每次输出不同,重放时会走出不同的路径。模型调用必须作为一步被记录,重放时用记录的结果。

**觉得自己的日志写得够快,就不需要幂等键。** 调外部系统和写日志永远是两个动作,中间的窗口消不掉。有副作用的调用一律带幂等键。

**让模型在失败时自己想办法回滚。** 回滚的结果不可预测,也没法测试。补偿逻辑应该是事先写好、测过的确定性代码。

**一上来就引入 Temporal。** 它很强,但学习曲线和运维成本都不低。先确认你的任务真的跨越发版窗口、有不可逆副作用、需要等人,再引入。

**LangGraph 的 checkpoint 就够了,不用管节点内部。** checkpoint 的粒度是节点,节点内部做到一半崩溃会整个重跑。副作用要单独成节点并带幂等键。

## 学习资料

### 文档与文章

- [Temporal 文档:Workflows](https://docs.temporal.io/workflows):确定性约束和事件历史的官方说明,一定要读「Deterministic constraints」那一节。40 分钟。
- [Temporal Python SDK 开发指南](https://docs.temporal.io/develop/python):写 workflow、activity、signal 的具体 API。
- [DBOS Python 编程指南](https://docs.dbos.dev/python/programming-guide):看它怎么只靠 Postgres 实现持久化,适合和 Temporal 对比。
- [Restate 文档](https://docs.restate.dev/):另一种轻量的实现思路。
- [LangGraph 持久化文档](https://docs.langchain.com/oss/python/langgraph/persistence):checkpointer 和 store 的区别,配合 Day 64 一起看。
- [Saga 模式](https://microservices.io/patterns/data/saga.html):Chris Richardson 对 Saga 的经典说明,编排式和协同式两种。
- [Anthropic《Effective harnesses for long-running agents》](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents):Day 62 读过。从持久化的角度再读一遍,进度文件和 git 提交其实就是一种面向模型的「事件日志」。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1JNkFBMEFH&autoplay=0&high_quality=1" title="用Temporal构建持久化AI智能体 | AI Engineer" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>7k的每日搬运 · 用Temporal构建持久化AI智能体 | AI Engineer · 78 分钟的工作坊搬运,讲 Temporal 和 Agent 结合的完整例子。播放量不高,但内容是官方工作坊。前 20 分钟讲原理,后面是动手。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/k8cnVCMYmNc" title="OpenAI + @Temporalio : Building Durable, Production Ready Agents - Cornelia Davis, Temporal" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · OpenAI + Temporal: Building Durable, Production Ready Agents - Cornelia Davis · Temporal 和 OpenAI Agents SDK 集成的讲解,看它怎么把 Agent 的每一步变成可重放的。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/GEXllEH2XiQ" title="Build an AI Agent with Temporal" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Temporal · Build an AI Agent with Temporal · 官方频道的入门演示,七万多播放,比上面那个短,适合先建立直觉。</figcaption>
</figure>

### 书籍

- Martin Kleppmann《Designing Data-Intensive Applications》(O'Reilly,2017),中文版《数据密集型应用系统设计》:第 9 章讲一致性与共识,第 11 章讲事件日志。「恰好一次」为什么难,这两章讲得最透。
- Chris Richardson《Microservices Patterns》(Manning,2018):第 4 章专讲 Saga,补偿事务的设计细节都在这里。

### 开源项目与代码

- [temporalio/samples-python](https://github.com/temporalio/samples-python):官方的 Python 示例集,找带 signal 和 activity 重试的例子看。
- [dbos-inc/dbos-transact-py](https://github.com/dbos-inc/dbos-transact-py):DBOS 的 Python 实现,README 里的示例很短,可以和我们的 60 行运行器对照。

## 自测

1. 持久化执行的核心原理用一句话怎么说?

<details><summary>答案</summary>

每一步的结果都写进持久化日志,崩溃后重新运行代码,已完成的步骤直接从日志取结果,只有未完成的步骤才真正执行。

</details>

2. 为什么模型调用必须作为一个被记录的步骤,而不能在重放时重新调用?

<details><summary>答案</summary>

模型输出不确定,重新调用可能得到不同结果,导致后续路径和第一次不同,日志里的记录就会和代码对不上。记录下来重放还能省掉重复的 token 费用。

</details>

3. 「退款成功后、写日志前崩溃」这个问题为什么无法通过把日志写得更快来解决?正确的做法是什么?

<details><summary>答案</summary>

调用外部系统和写自己的日志是两个系统里的两个动作,无法原子地同时完成,中间的窗口永远存在。正确做法是给每次副作用调用带上确定性的幂等键,由外部系统去重,实现效果上的恰好一次。

</details>

4. LangGraph 的 checkpoint 和 Temporal 在粒度上有什么区别?这对副作用意味着什么?

<details><summary>答案</summary>

LangGraph 按节点做 checkpoint,节点内部做到一半崩溃,恢复时整个节点重跑;Temporal 按 activity 记录,粒度更细。用 LangGraph 时有副作用的操作要单独成节点,并且同样要带幂等键。

</details>

5. 什么情况下值得引入 Temporal 这类系统?

<details><summary>答案</summary>

任务会跨越发版窗口(比如超过半小时)、有不可逆的副作用、需要等待人工,满足其中两条左右就值得考虑。还要考虑团队学习确定性约束和运维的成本。

</details>

6. 资深面试题:「设计一个需要人工审批、可能运行数天的退款 Agent 流程,要求服务重启不丢进度、绝不重复退款、审批拒绝后要能回滚已做的操作。」

<details><summary>答案</summary>

要点:用持久化执行(Temporal 或同类)承载流程,模型调用和工具调用都作为可记录的步骤;审批用信号或等价机制实现长时间等待,不占进程;所有副作用带确定性幂等键,对接的支付系统必须支持去重,不支持的要先查后做;有副作用的步骤都配补偿动作,审批拒绝或后续失败时按 Saga 反向补偿,补偿是确定性代码;代码升级时用版本化处理正在运行的流程;监控卡住的运行并告警。可以补充为什么不让模型自己回滚,以及如何测试(在每一步注入崩溃)。

</details>

## 明天预告

Day 66 · 编排模式的取舍:单 Agent、工作流、多 Agent、混合。W10 讲到这里,零件都齐了:harness、上下文、记忆、持久化。明天回到架构选择这个最常被问到的问题,把 Anthropic 和 Cognition 的两种观点放在一起,设计一个在 SupportPilot 上对比几种架构的实验,最后给出一棵决策树。
