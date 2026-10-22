---
title: 'Day 537 · 持久化执行(三):自己写一个持久化运行器'
description: '把前两天的零件拼成一个 70 多行的 durable_runner.py:日志重放、步骤指纹、幂等键,再加上崩溃注入和补偿。用 pytest 在每一步各真杀一次进程,钉死「在哪死都只退一笔」;把一个真的会调工具的 DeepSeek Agent 放上去跑,在退款之后杀掉它再恢复;最后处理业务上做到一半做不下去的情况:按相反顺序执行补偿。'
pubDate: 2026-10-22
regime: none
tags: ['durable-execution', 'saga', 'pytest', 'agent-loop', 'python', 'agent-zero']
series: 'agent-zero'
day: 537
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 536](/blog/agent-zero/day-536-durable-2/) 讲了 Agent 让持久化执行变难的两个地方。一是非确定性:模型的决定会变,代码会发版,重放时步骤可能对错号,所以一切不确定的东西都要走 `step` 记下来,每一步还要存一个名字加参数的指纹,对不上就抛 `NonDeterminismError`。二是副作用:「支付系统已经退了款、我们的日志还没写」这个窗口消不掉,运行器只能保证至少执行一次,去重交给对方,靠「运行 id + 步骤序号」算出来的幂等键,合起来是效果上恰好一次。

零件现在散在三个文件里:Day 535 的 `durable.py`、Day 536 的 `durable_fp.py` 和 `refund_demo.py` 里手算的那行幂等键。今天把它们拼成一个能长期用的运行器,并且回答一个工程上绕不开的问题:你怎么证明它真的在任何一步死掉都没事?

## 今天要解决的问题

学完今天你应该能做到:

1. 写出 `part10/durable_runner.py`:日志重放、步骤指纹、幂等键、取时间,以及今天新加的崩溃注入开关和补偿登记,说出每一部分来自哪一天。
2. 用**崩溃注入**写测试:让 pytest 用子进程把流程跑起来,在第 1、2、3、4 步各真杀一次,断言恢复后结果一样、退款只有一笔;再故意去掉幂等键,看测试准确地在第 3 步变红。
3. 把一个真的用 DeepSeek 调工具的 Agent 循环接到运行器上,在退款执行完、日志没写时杀掉它,恢复后只退一笔、模型只为没做完的步骤付钱。
4. 用 **Saga 补偿**处理业务失败:换套餐时旧订阅已取消、新订阅开不出来,按相反顺序执行补偿,并且补偿本身也经得起崩溃。

预计用时 3 小时。前置:[Day 535](/blog/agent-zero/day-535-durable-1/) 和 [Day 536](/blog/agent-zero/day-536-durable-2/) 全部、[Day 73](/blog/agent-zero/day-073-pytest-3/)(fixture 和 parametrize)、[Day 166](/blog/agent-zero/day-166-agent-min/)(最小 Agent 循环)、[Day 159](/blog/agent-zero/day-159-tool-roundtrip/)(回传 tool 消息和 `tool_call_id`)。

今天的两个新概念:**崩溃注入测试**和 **Saga 补偿**。其余都是把学过的东西拼到一起。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分(`DurableRun.step` 的完整版和 `compensate`);做练习,做不出再展开参考答案,看完关掉重写一遍。

## 拼起来:durable_runner.py

先说清楚要拼进去的东西。Day 535 给了日志和重放,Day 536 给了指纹和幂等键。今天再加三样小东西:一个 `now()`,把 Day 536 练习 1 的「取时间也要走 step」做成方法;一个崩溃注入开关,给测试用;一对 `on_failure` / `compensate`,给后面的补偿用。

新建 `part10/durable_runner.py`:

```python
# agent-zero-lab/part10/durable_runner.py
"""持久化运行器:日志重放 + 步骤指纹 + 幂等键 + 补偿 + 崩溃注入。"""
import hashlib
import json
import os
import signal
import sqlite3
import time
from typing import Any, Callable


class NonDeterminismError(RuntimeError):
    pass


def fingerprint(name: str, args: tuple) -> str:
    raw = json.dumps([name, list(args)], ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


class Journal:
    def __init__(self, path: str | None = None):
        self.db = sqlite3.connect(path or os.environ.get("JOURNAL_DB", "part10/journal.db"))
        self.db.execute("CREATE TABLE IF NOT EXISTS steps(run_id TEXT, seq INTEGER, name TEXT,"
                        " fp TEXT, result TEXT, PRIMARY KEY(run_id, seq))")

    def get(self, run_id: str, seq: int) -> tuple[str, str, str] | None:
        return self.db.execute("SELECT name, fp, result FROM steps WHERE run_id=? AND seq=?",
                               (run_id, seq)).fetchone()

    def put(self, run_id: str, seq: int, name: str, fp: str, result: Any) -> None:
        self.db.execute("INSERT INTO steps VALUES(?,?,?,?,?)",
                        (run_id, seq, name, fp, json.dumps(result, ensure_ascii=False)))
        self.db.commit()


class DurableRun:
    def __init__(self, journal: Journal, run_id: str):
        self.j, self.run_id, self.seq = journal, run_id, 0
        self.replayed = self.executed = 0
        self.undo: list[tuple[str, Callable[..., Any], tuple]] = []
        crash = os.environ.get("DURABLE_CRASH_AT")  # 测试用:第 N 步执行完、写日志前自杀
        self.crash_at = int(crash) if crash else None

    def step(self, name: str, fn: Callable[..., Any], *args: Any) -> Any:
        self.seq += 1
        fp = fingerprint(name, args)
        row = self.j.get(self.run_id, self.seq)
        if row:
            if row[1] != fp:
                raise NonDeterminismError(
                    f"第 {self.seq} 步对不上:日志里是 {row[0]}({row[1]}),这次代码是 {name}({fp})")
            self.replayed += 1
            return json.loads(row[2])
        result = fn(*args)
        if self.crash_at == self.seq:
            os.kill(os.getpid(), signal.SIGKILL)
        self.j.put(self.run_id, self.seq, name, fp, result)
        self.executed += 1
        return result

    def idempotency_key(self) -> str:
        return f"{self.run_id}-{self.seq + 1}"  # 下一步的序号:重放多少次都一样

    def now(self) -> float:
        return self.step("clock.now", time.time)

    def on_failure(self, name: str, fn: Callable[..., Any], *args: Any) -> None:
        self.undo.append((name, fn, args))  # 登记一个补偿动作,失败时倒着执行

    def compensate(self) -> None:
        while self.undo:
            name, fn, args = self.undo.pop()
            self.step(name, fn, *args)
```

<div class="line-notes">

- `"""持久化运行器:日志重放 + 步骤指纹 + 幂等键 + 补偿 + 崩溃注入。"""` 一共 74 行。下面只讲和前两天不一样的地方,一样的地方给一句提醒。
- `def fingerprint(name: str, args: tuple) -> str:` 原样来自 Day 536 的 `durable_fp.py`:名字和参数转成 JSON 再算 SHA-256,取前 16 位。
- `def __init__(self, path: str | None = None):` 路径变成可选。`path or ...` 的意思是:传了就用传的,没传(None)就用后面的。相当于 JS 的 `path || ...`。
- `self.db = sqlite3.connect(path or os.environ.get("JOURNAL_DB", "part10/journal.db"))` 没传路径时,先看环境变量 `JOURNAL_DB`,还没有就用 `part10/journal.db`。这个环境变量是给测试准备的:每个测试用自己的临时文件,不会互相踩。
- `" fp TEXT, result TEXT, PRIMARY KEY(run_id, seq))")` 和 Day 536 一样的表结构。Day 535 的 `journal.db` 没有 `fp` 列,如果你的 `part10/journal.db` 是 Day 535 留下的,先删掉:`rm -f part10/journal.db`。
- `self.replayed = self.executed = 0` Day 535 的两个计数器回来了,测试会用到。
- `self.undo: list[tuple[str, Callable[..., Any], tuple]] = []` 补偿动作的清单,每一项是「名字、函数、参数」三样。类型标注读作:一个列表,里面每个元素是一个三元组。
- `crash = os.environ.get("DURABLE_CRASH_AT")  # 测试用:第 N 步执行完、写日志前自杀` 崩溃注入的开关。没设这个环境变量时是 None,运行器行为和平时完全一样。
- `self.crash_at = int(crash) if crash else None` 环境变量读出来都是字符串,`"3"` 要转成整数 3 才能和 `seq` 比。
- `if row[1] != fp:` Day 536 的指纹检查。
- `self.replayed += 1` 重放一步,计数加一。
- `result = fn(*args)` 真正执行。退款这种步骤,这一行执行完钱就出去了。
- `if self.crash_at == self.seq:` 正好是要注入崩溃的那一步,就在执行完、写日志前自杀。为什么选这个位置?因为它是最坏的时刻:外部已经做完,自己没有记录。这个时刻能过,「执行前死」「写完日志后死」都更容易过。
- `os.kill(os.getpid(), signal.SIGKILL)` 和 Day 535 的 `no_commit.py` 一样,给自己发 `kill -9`,不是抛异常,`try/except` 接不住,和真实崩溃一模一样。
- `def idempotency_key(self) -> str:` Day 536 在 `refund_demo.py` 里手算的那一行,收进运行器。工作流代码只管调,不用知道键是怎么算的。
- `return f"{self.run_id}-{self.seq + 1}"  # 下一步的序号:重放多少次都一样` 要在调 `step` **之前**取键,所以是「下一步」的序号。比如第 2 步刚做完时取,得到的是 `run-x-3`,正好是马上要执行的那一步。
- `def now(self) -> float:` Day 536 练习 1 的结论做成方法:工作流里要当前时间,一律 `run.now()`,不直接 `time.time()`。
- `def on_failure(self, name: str, fn: Callable[..., Any], *args: Any) -> None:` 登记一个补偿动作,只是记在清单上,不执行。后面讲 Saga 时细说。
- `name, fn, args = self.undo.pop()` `pop()` 不带参数,取出并删掉最后一个元素,相当于 JS 的 `arr.pop()`。后登记的先执行,也就是倒着来。
- `self.step(name, fn, *args)` 补偿本身也走 `step`,所以也进日志、也能重放。这一点在后面「补偿时被杀」那次实验里是关键。

</div>

### 零件和大代码的对应

| 零件 | 来自哪天 | 在 `durable_runner.py` 里 |
| --- | --- | --- |
| 日志表、`put` 里 commit | Day 535 `durable.py` | `Journal` |
| 按序号重放 | Day 535 | `step` 里的 `if row:` 和 `return json.loads(row[2])` |
| 步骤指纹、`NonDeterminismError` | Day 536 `durable_fp.py` | `fingerprint`、`step` 里的 `if row[1] != fp:` |
| 幂等键「运行 id + 下一步序号」 | Day 536 `refund_demo.py` | `idempotency_key()` |
| 取时间也要走 step | Day 536 练习 1 | `now()` |
| 在窗口里 `kill -9` | Day 536 `refund_demo.py` 的 `CRASH` 开关 | `crash_at`,从退款函数里挪进了运行器 |
| 补偿 | 今天新加 | `undo`、`on_failure`、`compensate` |

### 先跑一遍退款流程

用一个四步的假流程把它跑起来:计划、查发票、退款、写回复。模型先用假函数,不花钱,而且每次输出固定,测试才好写。新建 `part10/refund_flow.py`:

```python
# agent-zero-lab/part10/refund_flow.py
import json
import sys

from durable_runner import DurableRun, Journal
from payments import create_refund


def plan(ticket: str) -> str:
    return "查发票,确认重复后退款"


def list_invoices(customer_id: str) -> list[dict]:
    return [{"id": "INV-2290", "amount": 468}, {"id": "INV-2291", "amount": 468}]


def write_reply(refund_id: str) -> str:
    return f"多扣的 468 元已退回,退款单号 {refund_id}"


def workflow(run: DurableRun) -> dict:
    p = run.step("llm.plan", plan, "C007 说 9 月被重复扣款")
    invoices = run.step("tool.list_invoices", list_invoices, "C007")
    dup = invoices[-1]
    refund = run.step("tool.create_refund", create_refund, dup["id"], dup["amount"], run.idempotency_key())
    reply = run.step("llm.reply", write_reply, refund["refund_id"])
    return {"plan": p, "refund_id": refund["refund_id"], "reply": reply}


if __name__ == "__main__":
    run = DurableRun(Journal(), sys.argv[1])
    out = workflow(run)
    print(json.dumps(out, ensure_ascii=False))
    print(f"重放 {run.replayed} 步,真正执行 {run.executed} 步")
```

<div class="line-notes">

- `from payments import create_refund` Day 536 的假支付系统,一行没改。它的数据库路径也能用环境变量 `PAYMENTS_DB` 换,今天的测试要用上。
- `dup = invoices[-1]` 两张一样的发票,退后一张。`[-1]` 是最后一个元素,JS 里是 `arr.at(-1)`。
- `refund = run.step("tool.create_refund", create_refund, dup["id"], dup["amount"], run.idempotency_key())` 现在 `refund_step` 那层包装不需要了,崩溃开关在运行器里。`run.idempotency_key()` 在进入 `step` 前取值,此时 `seq` 是 2,键是 `run-x-3`。
- `reply = run.step("llm.reply", write_reply, refund["refund_id"])` 回复里带上退款单号,恢复后单号对不对一眼能看出来。
- `print(json.dumps(out, ensure_ascii=False))` 第一行输出整个结果的 JSON,方便测试解析。
- `print(f"重放 {run.replayed} 步,真正执行 {run.executed} 步")` 第二行输出计数。

</div>

```bash
cd agent-zero-lab
rm -f part10/journal.db part10/payments.db
uv run python part10/refund_flow.py run-1
DURABLE_CRASH_AT=3 uv run python part10/refund_flow.py run-2; echo "exit=$?"
uv run python part10/refund_flow.py run-2
sqlite3 part10/payments.db "SELECT * FROM refunds"
```

```text
{"plan": "查发票,确认重复后退款", "refund_id": "RF-1", "reply": "多扣的 468 元已退回,退款单号 RF-1"}
重放 0 步,真正执行 4 步
exit=137
{"plan": "查发票,确认重复后退款", "refund_id": "RF-2", "reply": "多扣的 468 元已退回,退款单号 RF-2"}
重放 2 步,真正执行 2 步
RF-1|INV-2291|468|run-1-3
RF-2|INV-2291|468|run-2-3
```

run-1 正常跑完,四步全部真正执行。run-2 在第 3 步(退款)执行完、写日志前被杀,退出码 137;恢复时前两步重放,第 3 步再调了一次退款接口,但键 `run-2-3` 已经见过,支付系统返回原来的 RF-2;第 4 步写回复是真正执行。支付表里每个运行各一笔。

## 崩溃注入:在每一步都死一次

刚才只在第 3 步杀了一次。第 1 步、第 2 步、第 4 步呢?手动一个个试太累,而且改了代码以后要重试一遍。这正是测试该干的活。

**崩溃注入**(crash injection,也叫故障注入 fault injection)的意思是:不等真实环境里碰巧出事,而是在你指定的位置故意制造故障,看系统表现对不对。前端里类似的做法是在 DevTools 里把网络调成 Offline 或者给某个请求返回 500,看页面会不会白屏。我们的运行器已经有了开关,剩下的就是让 pytest 把「第 N 步死,然后恢复」对每个 N 都跑一遍。

有一个细节必须想清楚:`kill -9` 会杀掉整个进程。如果在 pytest 自己的进程里触发,pytest 就跟着死了。所以每次运行都放到一个**子进程**里:pytest 启动一个新的 Python 进程去跑 `refund_flow.py`,那个进程被杀,pytest 自己还活着,能检查结果。Python 用标准库 `subprocess` 做这件事,相当于 Node 里的 `child_process.spawnSync`。

新建 `part10/test_durable_runner.py`:

```python
# agent-zero-lab/part10/test_durable_runner.py
import json
import os
import sqlite3
import subprocess
import sys

import pytest

from durable_runner import DurableRun, Journal, NonDeterminismError

FLOW = os.path.join(os.path.dirname(__file__), "refund_flow.py")


def run_flow(tmp_path, run_id: str, crash_at: int | None = None) -> subprocess.CompletedProcess:
    env = {**os.environ, "JOURNAL_DB": str(tmp_path / "journal.db"),
           "PAYMENTS_DB": str(tmp_path / "payments.db")}
    if crash_at:
        env["DURABLE_CRASH_AT"] = str(crash_at)
    return subprocess.run([sys.executable, FLOW, run_id], env=env, capture_output=True, text=True)


def refunds(tmp_path) -> int:
    return sqlite3.connect(tmp_path / "payments.db").execute("SELECT count(*) FROM refunds").fetchone()[0]


@pytest.mark.parametrize("crash_at", [1, 2, 3, 4])
def test_crash_anywhere_then_resume(tmp_path, crash_at):
    first = run_flow(tmp_path, "run-x", crash_at)
    assert first.returncode == -9  # 真的被 SIGKILL 杀掉了
    second = run_flow(tmp_path, "run-x")
    assert second.returncode == 0, second.stderr
    out = json.loads(second.stdout.splitlines()[0])
    assert out["refund_id"] == "RF-1"
    assert refunds(tmp_path) == 1  # 不管在哪一步被杀,只退一笔


def test_finished_run_replays_everything(tmp_path):
    run_flow(tmp_path, "run-y")
    again = run_flow(tmp_path, "run-y")
    assert again.stdout.splitlines()[1] == "重放 4 步,真正执行 0 步"
    assert refunds(tmp_path) == 1


def test_changed_code_is_detected(tmp_path):
    j = Journal(str(tmp_path / "j.db"))
    DurableRun(j, "run-z").step("tool.list_invoices", lambda cid: [], "C007")
    with pytest.raises(NonDeterminismError):
        DurableRun(j, "run-z").step("tool.search_kb", lambda q: [], "重复扣款")
```

<div class="line-notes">

- `import subprocess` 标准库,启动和管理子进程。
- `FLOW = os.path.join(os.path.dirname(__file__), "refund_flow.py")` `__file__` 是当前这个测试文件的路径,`dirname` 取它所在的目录,再拼上 `refund_flow.py`。这样不管从哪个目录运行 pytest,都能找到流程脚本。相当于 Node 里的 `path.join(__dirname, "refund_flow.py")`。
- `def run_flow(tmp_path, run_id: str, crash_at: int | None = None) -> subprocess.CompletedProcess:` 跑一次流程的辅助函数。`tmp_path` 是 pytest 自带的 fixture([Day 73](/blog/agent-zero/day-073-pytest-3/)),每个测试拿到一个全新的临时目录,测试之间互不干扰。
- `env = {**os.environ, "JOURNAL_DB": str(tmp_path / "journal.db"),` 子进程的环境变量:复制当前所有的(`**os.environ`,和 JS 的 `{...process.env}` 一样),再覆盖两个数据库路径,指向临时目录。`tmp_path / "journal.db"` 是 pathlib 拼路径的写法(Day 37)。
- `env["DURABLE_CRASH_AT"] = str(crash_at)` 只有要注入崩溃时才设。环境变量只能是字符串。
- `return subprocess.run([sys.executable, FLOW, run_id], env=env, capture_output=True, text=True)` 启动子进程并等它结束。`sys.executable` 是当前正在运行的 Python 解释器的路径,保证子进程用的是同一个 `.venv`;`capture_output=True` 把子进程的输出收集起来,不打到屏幕上;`text=True` 让输出是字符串而不是字节。
- `return sqlite3.connect(tmp_path / "payments.db").execute("SELECT count(*) FROM refunds").fetchone()[0]` 直接打开支付系统的数据库数一下退款笔数。测试不相信流程自己打印的话,要去「对方系统」里看事实。
- `@pytest.mark.parametrize("crash_at", [1, 2, 3, 4])` 参数化(Day 73):同一个测试函数跑四遍,`crash_at` 依次是 1 到 4,四个步骤各死一次。
- `assert first.returncode == -9  # 真的被 SIGKILL 杀掉了` 在 shell 里被 9 号信号杀死的进程退出码显示 137(128 + 9),`subprocess` 里则用负数 `-9` 表示「被信号 9 杀死」。这一条断言确认崩溃真的发生了,否则后面的测试全是白测。
- `assert second.returncode == 0, second.stderr` 恢复的那次必须正常结束。逗号后面是断言失败时显示的信息,把子进程的报错打出来,方便排查。
- `out = json.loads(second.stdout.splitlines()[0])` 子进程输出的第一行是结果 JSON。
- `assert out["refund_id"] == "RF-1"` 每个测试的支付库都是新的,所以不管在哪步死,正确的单号都只能是 RF-1。
- `assert refunds(tmp_path) == 1  # 不管在哪一步被杀,只退一笔` 这一条是整个测试的核心。
- `assert again.stdout.splitlines()[1] == "重放 4 步,真正执行 0 步"` 跑完的运行再跑一次,四步全部重放。
- `DurableRun(j, "run-z").step("tool.list_invoices", lambda cid: [], "C007")` 第三个测试不用子进程,直接在测试进程里写一步日志。`lambda cid: []` 是一个接收一个参数、返回空列表的匿名函数,相当于 JS 的 `cid => []`(Day 30)。
- `with pytest.raises(NonDeterminismError):` 断言下面这一块一定会抛这个异常,不抛反而算失败,相当于 jest 的 `expect(() => ...).toThrow(...)`。

</div>

```bash
uv run pytest part10/test_durable_runner.py -q
```

```text
......                                                                   [100%]
6 passed in 1.09s
```

四个参数化用例加两个普通用例,6 个全绿,一共 1 秒多。每个参数化用例启动两个子进程,第一个被真正的 SIGKILL 杀掉。

### 测试能不能抓到 bug:故意改坏一次

全绿的测试,只有在你见过它变红以后才值得信。把 `refund_flow.py` 里退款那一行的 `run.idempotency_key()` 临时改成 `None`,也就是不带幂等键,再跑:

```bash
uv run pytest part10/test_durable_runner.py -q
```

```text
        second = run_flow(tmp_path, "run-x")
        assert second.returncode == 0, second.stderr
        out = json.loads(second.stdout.splitlines()[0])
>       assert out["refund_id"] == "RF-1"
E       AssertionError: assert 'RF-2' == 'RF-1'
E         
E         - RF-1
E         ?    ^
E         + RF-2
E         ?    ^

part10/test_durable_runner.py:34: AssertionError
=========================== short test summary info ============================
FAILED part10/test_durable_runner.py::test_crash_anywhere_then_resume[3] - As...
1 failed, 5 passed in 1.22s
```

只有 `[3]` 那一个失败,恢复后单号变成了 RF-2,说明退了第二次。第 1、2 步死的时候,退款还没发生;第 4 步死的时候,退款已经进了日志,重放不会再调。只有死在第 3 步的窗口里,幂等键才是唯一的防线。测试精确地指出了这一点。看完把 `None` 改回 `run.idempotency_key()`,再跑一次确认回到 6 个全绿。

## 把真的 Agent 放上去

假流程验证了运行器。现在换成真的:一个用 DeepSeek 工具调用的 Agent 循环,两个工具:查发票、退款。下一步调哪个工具、调几次,全由模型决定。

和 [Day 166](/blog/agent-zero/day-166-agent-min/) 的最小循环比,结构完全一样,区别只有一条:**每一次调模型、每一次调工具都包进 `run.step`**。有一处要多想一下:`step` 的返回值必须能转成 JSON,而 openai 返回的消息对象不行,所以 `chat` 函数自己把需要的字段整理成普通 dict。

新建 `part10/agent_durable.py`:

```python
# agent-zero-lab/part10/agent_durable.py
import json
import os
import sys

from dotenv import load_dotenv
from openai import OpenAI

from durable_runner import DurableRun, Journal
from payments import create_refund

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
TOOLS = [
    {"type": "function", "function": {"name": "list_invoices", "description": "查某个客户的发票",
     "parameters": {"type": "object", "properties": {"customer_id": {"type": "string"}}, "required": ["customer_id"]}}},
    {"type": "function", "function": {"name": "create_refund", "description": "对一张发票退款",
     "parameters": {"type": "object", "properties": {"invoice_id": {"type": "string"}, "amount": {"type": "integer"}},
                    "required": ["invoice_id", "amount"]}}},
]


def chat(messages: list[dict]) -> dict:
    resp = client.chat.completions.create(model=os.environ["LLM_MODEL"], temperature=0, extra_body=EXTRA,
                                          max_tokens=200, messages=messages, tools=TOOLS)  # type: ignore[arg-type]
    m, u = resp.choices[0].message, resp.usage
    calls = [{"id": c.id, "name": c.function.name, "arguments": c.function.arguments}
             for c in (m.tool_calls or []) if c.type == "function"]
    return {"content": m.content, "tool_calls": calls, "tokens": [u.prompt_tokens, u.completion_tokens] if u else [0, 0]}


def list_invoices(customer_id: str) -> list[dict]:
    return [{"id": "INV-2290", "amount": 468, "date": "2026-09-03"},
            {"id": "INV-2291", "amount": 468, "date": "2026-09-03"}]


def call_tool(run: DurableRun, name: str, arguments: str) -> object:
    args = json.loads(arguments)
    if name == "list_invoices":
        return run.step("tool.list_invoices", list_invoices, args["customer_id"])
    key = run.idempotency_key()
    return run.step("tool.create_refund", create_refund, args["invoice_id"], args["amount"], key)


def agent(run: DurableRun, ticket: str) -> str:
    messages: list[dict] = [
        {"role": "system", "content": "你是 CloudLedger 客服。先查发票;同一天同金额的两张算重复扣款,退掉后一张;最后一句话回复客户。"},
        {"role": "user", "content": ticket}]
    for _ in range(6):
        r = run.step("llm", chat, messages)
        print(f"  [{run.seq}] llm -> {[c['name'] for c in r['tool_calls']] or r['content']} {r['tokens']}", flush=True)
        if not r["tool_calls"]:
            return r["content"]
        messages.append({"role": "assistant", "content": r["content"], "tool_calls": [
            {"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": c["arguments"]}}
            for c in r["tool_calls"]]})
        for c in r["tool_calls"]:
            out = call_tool(run, c["name"], c["arguments"])
            print(f"  [{run.seq}] {c['name']} -> {out}", flush=True)
            messages.append({"role": "tool", "tool_call_id": c["id"], "content": json.dumps(out, ensure_ascii=False)})
    return "超过轮数上限,转人工"


if __name__ == "__main__":
    run = DurableRun(Journal(), sys.argv[1])
    print("回复:", agent(run, "我是 C007,9 月被扣了两次 468 元,请处理。"), flush=True)
    print(f"重放 {run.replayed} 步,真正执行 {run.executed} 步", flush=True)
```

<div class="line-notes">

- `TOOLS = [` 两个工具的 JSON Schema,写法和 [Day 157](/blog/agent-zero/day-157-tool-schema/) 一样。`amount` 用 `integer`,金额按元算,演示够用。
- `def chat(messages: list[dict]) -> dict:` 调一次模型。它会被包进 `run.step`,所以参数(整个消息列表)会进指纹,返回值会进日志。
- `max_tokens=200, messages=messages, tools=TOOLS)  # type: ignore[arg-type]` 消息和工具都是普通 dict,openai SDK 的类型标注要的是它自己定义的 TypedDict,编辑器会画红线,运行完全没问题。这行注释告诉类型检查器「这里我知道,别报」。
- `calls = [{"id": c.id, "name": c.function.name, "arguments": c.function.arguments}` 把 SDK 的 tool_call 对象拆成普通 dict。`arguments` 是一个 JSON 字符串,原样保留。
- `for c in (m.tool_calls or []) if c.type == "function"]` 没有工具调用时 `m.tool_calls` 是 None,`or []` 换成空列表。`if c.type == "function"` 过滤掉其他类型的调用,只留函数调用。
- `return {"content": m.content, "tool_calls": calls, "tokens": [u.prompt_tokens, u.completion_tokens] if u else [0, 0]}` 只留后面用得着的三样。token 数也存进日志,重放时打印的是第一次的用量,Day 535 讲过,算钱只能算真正执行的步骤。
- `"date": "2026-09-03"},` 两张发票同一天、同金额,给模型判断「重复」的依据。
- `def call_tool(run: DurableRun, name: str, arguments: str) -> object:` 按模型给的工具名分发。每个分支都走 `run.step`,所以工具调用也进日志。
- `key = run.idempotency_key()` 退款前取键。这个 Agent 里退款通常是第 4 步,键就是 `run-a-4`,但我们不需要知道它是第几步,运行器会算。
- `for _ in range(6):` 最多 6 轮,防止模型一直调工具不收手([Day 170](/blog/agent-zero/day-170-agent-full/) 的步数上限)。`_` 表示这个循环变量用不着。
- `r = run.step("llm", chat, messages)` 整个循环里最关键的一行:模型的决定进了日志。恢复时这一步重放,模型「说过的话」原样回来,后面走的路就和第一次一样。这就是 Day 536 修 `durable_drift.py` 的第一招。
- `print(f"  [{run.seq}] llm -> {[c['name'] for c in r['tool_calls']] or r['content']} {r['tokens']}", flush=True)` 打印当前步号、模型要调的工具名(没有工具调用就打印回复文字)和 token。`[...] or r['content']` 利用了空列表为假:有工具调用显示工具名列表,没有就显示文字。
- `messages.append({"role": "assistant", "content": r["content"], "tool_calls": [` 把模型这一轮的回答按 OpenAI 的格式放回消息列表([Day 159](/blog/agent-zero/day-159-tool-roundtrip/))。注意是从 `r`(日志里的 dict)重建的,所以重放时重建出来的消息和第一次一字不差,下一次 `chat` 的指纹才对得上。
- `messages.append({"role": "tool", "tool_call_id": c["id"], "content": json.dumps(out, ensure_ascii=False)})` 工具结果回传给模型,`tool_call_id` 对应上面那次调用的 id。
- `run = DurableRun(Journal(), sys.argv[1])` 日志默认写 `part10/journal.db`。

</div>

和昨天一样,先在第 4 步(退款)执行完、写日志前杀掉,看日志和支付系统,再恢复两次:

```bash
rm -f part10/journal.db part10/payments.db
DURABLE_CRASH_AT=4 uv run python part10/agent_durable.py run-a; echo "exit=$?"
sqlite3 part10/journal.db "SELECT seq, name FROM steps WHERE run_id='run-a'"
sqlite3 part10/payments.db "SELECT * FROM refunds"
uv run python part10/agent_durable.py run-a
sqlite3 part10/payments.db "SELECT * FROM refunds"
uv run python part10/agent_durable.py run-a
```

被杀之前:

```text
  [1] llm -> ['list_invoices'] [375, 46]
  [2] list_invoices -> [{'id': 'INV-2290', 'amount': 468, 'date': '2026-09-03'}, {'id': 'INV-2291', 'amount': 468, 'date': '2026-09-03'}]
  [3] llm -> ['create_refund'] [488, 80]
exit=137
```

日志里三步,支付系统里已经有一笔:

```text
1|llm
2|tool.list_invoices
3|llm
RF-1|INV-2291|468|run-a-4
```

第一次恢复:

```text
  [1] llm -> ['list_invoices'] [375, 46]
  [2] list_invoices -> [{'id': 'INV-2290', 'amount': 468, 'date': '2026-09-03'}, {'id': 'INV-2291', 'amount': 468, 'date': '2026-09-03'}]
  [3] llm -> ['create_refund'] [488, 80]
  [4] create_refund -> {'refund_id': 'RF-1', 'invoice_id': 'INV-2291', 'amount': 468, 'replayed': True}
  [5] llm -> 已为您核实：9 月 3 日有两笔 468 元扣款（INV-2290、INV-2291），属重复扣款，已对后一笔 INV-2291 发起 468 元退款（退款单号 RF-1），款项将原路退回，请留意到账。 [612, 71]
回复: 已为您核实：9 月 3 日有两笔 468 元扣款（INV-2290、INV-2291），属重复扣款，已对后一笔 INV-2291 发起 468 元退款（退款单号 RF-1），款项将原路退回，请留意到账。
重放 3 步,真正执行 2 步
RF-1|INV-2291|468|run-a-4
```

再跑一次(全部完成以后),输出的前六行和上面完全一样,最后一行是:

```text
重放 5 步,真正执行 0 步
```

逐段看。被杀时,模型已经决定退 INV-2291,退款接口也成功了(RF-1),但第 4 步没进日志。恢复时前三步重放:模型的两次决定从日志里取,一分钱没花,打印的 `[375, 46]`、`[488, 80]` 是第一次的用量。第 4 步退款重新执行,带着同一个键 `run-a-4`,支付系统返回了原来的 RF-1,标着 `replayed: True`。第 5 步模型拿到退款结果写回复,这是真正花钱的第三次调用。支付表里始终只有一行。

`replayed: True` 这个字段也进了给模型看的 tool 消息,模型没有被它带偏。真实的支付系统(比如 Stripe)重放时返回的是和第一次一模一样的响应,不会多这个字段,这里只是为了演示看得清楚。

花费:真正调模型的是第 1、3、5 步,输入 375 + 488 + 612 = 1475 token,输出 46 + 80 + 71 = 197 token。按 Day 536 查到的 `deepseek-flash` 高峰价:1475 × 2 ÷ 1,000,000 + 197 × 8 ÷ 1,000,000 ≈ ¥0.0045。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="Agent 循环跑在运行器上:五步分别是调模型、查发票、调模型、退款、调模型;被杀在第 4 步写日志前;恢复时前三步重放,第 4 步带同一个幂等键再调一次,支付系统返回原单号,第 5 步真正执行">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11" text-anchor="middle">
    <text x="20" y="44" text-anchor="start" fill="var(--ink)">第一次</text>
    <rect x="80" y="28" width="90" height="28" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="125" y="46" fill="var(--ink)">1 llm</text>
    <rect x="180" y="28" width="90" height="28" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="225" y="46" fill="var(--ink)">2 查发票</text>
    <rect x="280" y="28" width="90" height="28" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="325" y="46" fill="var(--ink)">3 llm</text>
    <rect x="380" y="28" width="90" height="28" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="425" y="46" fill="var(--ink)">4 退款</text>
    <text x="520" y="46" fill="var(--compute)">✕ 写日志前</text>
    <rect x="380" y="86" width="140" height="28" rx="3" fill="var(--paper)" stroke="var(--compute)"/>
    <text x="450" y="104" fill="var(--ink)">支付系统 RF-1</text>
    <line x1="425" y1="56" x2="425" y2="86" stroke="var(--ink-faint)"/>
    <text x="20" y="164" text-anchor="start" fill="var(--ink)">恢复</text>
    <rect x="80" y="148" width="90" height="28" rx="3" fill="var(--paper)" stroke="var(--rule)" stroke-dasharray="4 3"/><text x="125" y="166" fill="var(--ink-faint)">1 重放</text>
    <rect x="180" y="148" width="90" height="28" rx="3" fill="var(--paper)" stroke="var(--rule)" stroke-dasharray="4 3"/><text x="225" y="166" fill="var(--ink-faint)">2 重放</text>
    <rect x="280" y="148" width="90" height="28" rx="3" fill="var(--paper)" stroke="var(--rule)" stroke-dasharray="4 3"/><text x="325" y="166" fill="var(--ink-faint)">3 重放</text>
    <rect x="380" y="148" width="90" height="28" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="425" y="166" fill="var(--ink)">4 同一个键</text>
    <rect x="480" y="148" width="90" height="28" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="525" y="166" fill="var(--ink)">5 llm</text>
    <line x1="425" y1="114" x2="425" y2="148" stroke="var(--compute)" stroke-dasharray="3 3"/>
    <text x="320" y="210" fill="var(--ink-soft)">模型的决定在日志里,路径不变;退款带 run-a-4,支付系统返回 RF-1</text>
    <text x="320" y="232" fill="var(--ink-faint)" font-size="10">花钱的只有第 1、3、5 次模型调用;重放的两次不花钱</text>
  </g>
</svg>
<figcaption>真的 Agent 跑在运行器上。虚线框是重放;第 4 步确实又调了一次退款接口,幂等键让它什么都没改。</figcaption>
</figure>

## 做到一半做不下去:补偿

到这里,运行器处理的都是**崩溃**:进程死了,恢复后接着往前走,最终把事做完。还有一类失败完全不同:进程好好的,是**业务上**做不下去了。

举个 SupportPilot 里真会遇到的例子。客户 C007 要从「基础版月付」换成「专业版年付」,Agent 的计划是两步:先取消旧订阅,再开新订阅。第一步成功了,第二步订阅系统回了一个 `PLAN_NOT_AVAILABLE`:这个套餐在客户所在地区还没上线。现在客户既没有旧套餐,也没有新套餐,服务停了。

重试没用,再试一万次这个套餐也还是没上线。能做的是把已经做过的事撤回去:旧订阅恢复。分布式系统里处理这类问题的经典模式叫 **Saga**,1987 年 Hector Garcia-Molina 和 Kenneth Salem 的论文《Sagas》提出:一个长事务拆成多个步骤,每个有副作用的步骤都配一个**补偿动作**(compensation),后面的步骤失败时,按相反顺序执行前面步骤的补偿。取消订阅的补偿是恢复订阅,扣款的补偿是退款,发出去的邮件没法撤回,补偿是再发一封更正邮件。

补偿和数据库的回滚(Day 91 讲事务时的 ROLLBACK)不是一回事。回滚是让一切像没发生过,补偿是承认已经发生了,再做一件反方向的事。客户那边可能已经收到了「订阅已取消」的邮件,补偿以后还会收到「订阅已恢复」。

### 一个假的订阅系统

新建 `part10/subs.py`,和支付系统一样有自己的数据库文件:

```python
# agent-zero-lab/part10/subs.py
"""假的订阅系统:每个客户一行,记当前套餐和状态。"""
import os
import sqlite3

db = sqlite3.connect(os.environ.get("SUBS_DB", "part10/subs.db"))
db.execute("CREATE TABLE IF NOT EXISTS subs(customer_id TEXT PRIMARY KEY, plan TEXT, status TEXT)")
db.execute("INSERT OR IGNORE INTO subs VALUES('C007', '基础版月付', 'active')")
db.commit()


def show(customer_id: str) -> tuple[str, str]:
    return db.execute("SELECT plan, status FROM subs WHERE customer_id=?", (customer_id,)).fetchone()


def cancel_subscription(customer_id: str) -> dict:
    plan, _ = show(customer_id)
    db.execute("UPDATE subs SET status='cancelled' WHERE customer_id=?", (customer_id,))
    db.commit()
    return {"cancelled_plan": plan}


def restore_subscription(customer_id: str, plan: str) -> dict:  # cancel 的补偿
    db.execute("UPDATE subs SET plan=?, status='active' WHERE customer_id=?", (plan, customer_id))
    db.commit()
    return {"restored_plan": plan}


def create_subscription(customer_id: str, plan: str) -> dict:
    if plan == "专业版年付":  # 模拟业务失败:这个套餐在客户所在地区还没上线
        return {"ok": False, "error": "PLAN_NOT_AVAILABLE"}
    db.execute("UPDATE subs SET plan=?, status='active' WHERE customer_id=?", (plan, customer_id))
    db.commit()
    return {"ok": True, "plan": plan}
```

<div class="line-notes">

- `db = sqlite3.connect(os.environ.get("SUBS_DB", "part10/subs.db"))` 和 `payments.py` 一样,路径可以用环境变量换,练习 4 的测试会用到。
- `db.execute("INSERT OR IGNORE INTO subs VALUES('C007', '基础版月付', 'active')")` 种一条初始数据。`INSERT OR IGNORE` 是 SQLite 的写法:主键已存在就什么也不做,所以模块被导入多少次都只有一行。
- `def show(customer_id: str) -> tuple[str, str]:` 查当前套餐和状态,演示时打印用。
- `plan, _ = show(customer_id)` 解构赋值,和 JS 的 `const [plan, _] = show(...)` 一样。取消前先记下原来的套餐,补偿时要用。
- `return {"cancelled_plan": plan}` 返回被取消的套餐名。它会进日志,补偿动作的参数就从这里来。
- `def restore_subscription(customer_id: str, plan: str) -> dict:  # cancel 的补偿` 补偿动作。注意它是「把套餐设成某个值、状态设成 active」,而不是「状态加一」这种操作,所以做两次和做一次结果一样,天然幂等。这一点下面会用上。
- `return {"ok": False, "error": "PLAN_NOT_AVAILABLE"}` 业务失败用**返回值**表示,不抛异常。原因在下面讲。

</div>

### 换套餐的工作流

新建 `part10/saga_demo.py`:

```python
# agent-zero-lab/part10/saga_demo.py
import sys

from durable_runner import DurableRun, Journal
from subs import cancel_subscription, create_subscription, restore_subscription, show


def change_plan(run: DurableRun, customer_id: str, new_plan: str) -> str:
    old = run.step("tool.cancel_sub", cancel_subscription, customer_id)
    run.on_failure("undo.restore_sub", restore_subscription, customer_id, old["cancelled_plan"])
    print("  取消旧套餐后:", show(customer_id), flush=True)
    created = run.step("tool.create_sub", create_subscription, customer_id, new_plan)
    if not created["ok"]:
        print("  开新套餐失败:", created["error"], "-> 开始补偿", flush=True)
        run.compensate()
        return "换套餐失败,已恢复原套餐"
    return f"已换成 {new_plan}"


if __name__ == "__main__":
    run = DurableRun(Journal(), sys.argv[1])
    print("结果:", change_plan(run, "C007", sys.argv[2]))
    print("现在:", show("C007"), f"| 重放 {run.replayed} 步,真正执行 {run.executed} 步")
```

<div class="line-notes">

- `old = run.step("tool.cancel_sub", cancel_subscription, customer_id)` 第 1 步:取消旧订阅。返回值里有原来的套餐名。
- `run.on_failure("undo.restore_sub", restore_subscription, customer_id, old["cancelled_plan"])` 第 1 步一成功,马上登记它的补偿。登记不是一步,不进日志,只是往 `undo` 清单里加一项。重放时这一行会再执行一次,清单会重新建出来,所以不用持久化它。
- `print("  取消旧套餐后:", show(customer_id), flush=True)` 直接查订阅系统的当前状态,没走 `step`。这是故意留的一个观察点,下面会看到它在重放时打印的东西和第一次不一样。
- `created = run.step("tool.create_sub", create_subscription, customer_id, new_plan)` 第 2 步:开新订阅。失败也是一个**结果**,`{"ok": False, ...}` 会被记进日志。
- `if not created["ok"]:` 业务失败,走补偿分支。
- `run.compensate()` 把清单里登记过的补偿倒着执行一遍。这里只有一项,就是恢复旧订阅,它会成为第 3 步。
- `print("结果:", change_plan(run, "C007", sys.argv[2]))` 第二个命令行参数是要换的新套餐。

</div>

为什么业务失败要返回 `{"ok": False}` 而不是 `raise`?想一下抛异常会怎样:`step` 里 `fn(*args)` 抛了异常,`put` 不会执行,这一步没有记录。恢复时它会被**重新执行**。如果那时套餐恰好上线了,第二次就成功了,于是代码不走补偿、往下走了,而第一次运行已经因为失败做过别的事。同一次运行的两次执行看到了两个不同的「事实」,这正是 Day 536 说的重放分叉。把失败当成结果记下来,重放时看到的永远是同一个失败。

规则可以记成一句:**会重试的临时错误(超时、5xx)让它抛,重放时重试是对的;业务上的最终结论(拒绝、不可用、余额不足)当结果返回,记进日志。** 这和 [Day 389](/blog/agent-zero/day-389-retry-errors/) 讲的「先分类再重试」是同一件事,只是现在多了一个日志。

跑三种情况:失败后补偿、补偿执行到一半被杀、正常成功。

```bash
rm -f part10/subs.db part10/journal.db
uv run python part10/saga_demo.py run-s1 专业版年付
rm -f part10/subs.db
DURABLE_CRASH_AT=3 uv run python part10/saga_demo.py run-s2 专业版年付; echo "exit=$?"
sqlite3 part10/subs.db "SELECT * FROM subs"
uv run python part10/saga_demo.py run-s2 专业版年付
rm -f part10/subs.db
uv run python part10/saga_demo.py run-s3 专业版月付
```

失败后补偿:

```text
  取消旧套餐后: ('基础版月付', 'cancelled')
  开新套餐失败: PLAN_NOT_AVAILABLE -> 开始补偿
结果: 换套餐失败,已恢复原套餐
现在: ('基础版月付', 'active') | 重放 0 步,真正执行 3 步
```

补偿执行完、写日志前被杀,然后恢复:

```text
  取消旧套餐后: ('基础版月付', 'cancelled')
  开新套餐失败: PLAN_NOT_AVAILABLE -> 开始补偿
exit=137
C007|基础版月付|active
  取消旧套餐后: ('基础版月付', 'active')
  开新套餐失败: PLAN_NOT_AVAILABLE -> 开始补偿
结果: 换套餐失败,已恢复原套餐
现在: ('基础版月付', 'active') | 重放 2 步,真正执行 1 步
```

正常成功:

```text
  取消旧套餐后: ('基础版月付', 'cancelled')
结果: 已换成 专业版月付
现在: ('专业版月付', 'active') | 重放 0 步,真正执行 2 步
```

第一段是补偿的基本形状:三步,取消、开新失败、恢复,客户最后回到基础版月付、状态 active。

第二段最值得看。第 3 步(恢复订阅)在订阅系统里已经生效(被杀后查表是 active),但日志里没有。恢复时第 1、2 步重放,开新套餐的失败从日志里取出来,代码照样进了补偿分支;第 3 步恢复订阅**又执行了一次**。因为 `restore_subscription` 是「设成某个值」,做两次结果一样,所以没出事。这说明**补偿动作自己也必须是幂等的**。要是补偿是「退款」,就得像正文前面那样带幂等键。

第二段还有一个小陷阱:重放时「取消旧套餐后」打印的是 `active`,第一次是 `cancelled`。因为 `show` 没走 `step`,它读的是此刻的真实状态,而那时补偿已经生效了。这一行只是打印,影响不大;如果代码拿这个值去做判断,就会和第一次走不同的路。凡是读外部状态并影响后续逻辑的,都要走 `step`。

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="Saga 补偿:第 1 步取消旧订阅并登记补偿,第 2 步开新订阅失败,于是按相反顺序执行补偿,恢复旧订阅">
  <rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11" text-anchor="middle">
    <rect x="40" y="40" width="150" height="34" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="115" y="61" fill="var(--ink)">1 取消旧订阅</text>
    <rect x="250" y="40" width="150" height="34" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="325" y="61" fill="var(--ink)">2 开新订阅</text>
    <text x="470" y="61" fill="var(--compute)">ok: False</text>
    <line x1="190" y1="57" x2="250" y2="57" stroke="var(--ink-soft)"/>
    <rect x="40" y="130" width="150" height="34" rx="3" fill="var(--paper)" stroke="var(--mem)"/>
    <text x="115" y="151" fill="var(--ink)">3 恢复旧订阅</text>
    <line x1="115" y1="74" x2="115" y2="130" stroke="var(--mem)" stroke-dasharray="3 3"/>
    <text x="210" y="105" text-anchor="start" fill="var(--ink-soft)">on_failure:成功后马上登记补偿</text>
    <path d="M 325 74 C 325 150, 260 147, 190 147" fill="none" stroke="var(--ink-faint)"/>
    <text x="400" y="150" text-anchor="start" fill="var(--ink-soft)">compensate:倒着执行</text>
    <text x="320" y="196" fill="var(--ink-faint)" font-size="10">补偿也走 step:进日志、能重放,而且自己必须幂等</text>
  </g>
</svg>
<figcaption>Saga 的形状。琥珀色是有副作用的正向步骤,蓝框是登记过的补偿。补偿是一件新的反方向的事,不是让第 1 步消失。</figcaption>
</figure>

补偿逻辑我建议一律写成确定性的代码,就像这里的 `restore_subscription`,而不是失败时把烂摊子交给模型「想办法回滚」。模型临场发挥的回滚,你没法提前测试,出了事也很难说清它当时为什么那么做。让模型决定**做什么**,让写死的代码决定**做错了怎么撤回**。

## 离生产还差什么

这个运行器七十几行,够用来理解原理,也够写测试,但离生产还差好几样东西,面试时要能主动说出来:

**同一次运行被两个进程同时恢复。** 两台机器都以为 run-a 挂了,同时去恢复,都会执行第 4 步。幂等键能挡住重复退款,但模型会被调两次,日志写入时其中一个会撞上主键冲突。练习 2 会实际制造出来,并用一张「租约」表解决。

**卡住的运行没人管。** 进程挂了以后,是谁、在什么时候用同一个 `run_id` 去恢复它?今天都是我们手动敲命令。生产上需要一个调度器定期扫描「开始了、没结束、也没有进程在跑」的运行,把它派给一台活着的机器。

**日志越积越多。** 每一步一行,一次 Agent 运行几十步,一天几万次运行。跑完的运行要归档或者清理,长运行要考虑快照(Day 535 提过)。

**长时间等待。** 等主管审批可能要一天,不能让一个进程 `sleep` 一天。练习 1 实现一个能被杀、恢复后接着睡剩下时间的定时器,但真正的等人还需要「外部信号把运行唤醒」的机制,Temporal 叫 signal。

这些正是 Temporal、DBOS、Restate 这类系统花了好几年做的事。Day 539 会拿今天的运行器做对照,看这四个现成方案分别怎么解决它们。

## 动手练习

**练习 1:能被杀的定时器。** 给工作流写一个 `durable_sleep(run, seconds)`:第一次执行时算出「醒来的时间」并记进日志;被杀后恢复,只睡剩下的时间,而不是从头再睡。用一个「发催款邮件,然后睡 6 秒」的流程,在睡到一半时 `kill -9`,恢复后看它还睡多久。

<details><summary>参考答案</summary>

新建 `part10/ex537_sleep.py`:

```python
# agent-zero-lab/part10/ex537_sleep.py
import sys
import time

from durable_runner import DurableRun, Journal


def durable_sleep(run: DurableRun, seconds: float) -> None:
    wake_at = run.step("timer.wake_at", lambda: time.time() + seconds)  # 第一次算出的醒来时间记进日志
    left = wake_at - time.time()
    print(f"  还要睡 {max(left, 0):.1f} 秒", flush=True)
    if left > 0:
        time.sleep(left)


run = DurableRun(Journal("part10/journal_sleep.db"), "run-1")
t0 = time.time()
run.step("tool.send_email", lambda: "已发催款邮件")
durable_sleep(run, 6)
print("  醒了,本进程用时", round(time.time() - t0, 1), "秒", flush=True)
```

<div class="line-notes">

- `wake_at = run.step("timer.wake_at", lambda: time.time() + seconds)  # 第一次算出的醒来时间记进日志` 记的不是「睡多久」,而是「几点醒」。`lambda` 没有参数,它读外面的 `seconds`(闭包,和 JS 的箭头函数一样)。闭包里的值不在 `args` 里,不进指纹,这里没关系,但要知道有这回事。
- `left = wake_at - time.time()` 每次运行都用**现在**的时间去算剩多少。这里直接读时钟是对的:剩余时间本来就该随真实时间变化,它只决定睡多久,不影响走哪条路。
- `print(f"  还要睡 {max(left, 0):.1f} 秒", flush=True)` 进程被杀的时间如果超过了 6 秒,`left` 是负数,`max(left, 0)` 显示成 0。
- `run.step("tool.send_email", lambda: "已发催款邮件")` 假的发邮件,有了它,第 2 次运行就能看到「邮件那一步是重放的」。

</div>

```bash
rm -f part10/journal_sleep.db
uv run python part10/ex537_sleep.py & sleep 3; pkill -9 -f ex537_sleep.py; sleep 0.5; echo "killed"
uv run python part10/ex537_sleep.py
```

```text
  还要睡 6.0 秒
killed
  还要睡 2.4 秒
  醒了,本进程用时 2.4 秒
```

第一次刚开始睡就被杀;恢复后,邮件那步重放(没有再发),醒来时间从日志里取,只睡了剩下的 2.4 秒。`uv run` 启动本身要花大约半秒,所以从开始睡到被杀不是整整 3 秒。

</details>

**练习 2:两个进程同时恢复同一次运行。** 写一个退款步骤里 `sleep(1)` 的小脚本,用 `&` 同时启动两个进程恢复同一个 `run-1`,看会发生什么,支付系统里有几笔退款。然后加一张 `leases` 表,谁先拿到租约谁跑,另一个直接退出。

<details><summary>参考答案</summary>

先制造问题。新建 `part10/ex537_twice.py`:

```python
# agent-zero-lab/part10/ex537_twice.py
import sqlite3
import sys
import time

from durable_runner import DurableRun, Journal
from payments import create_refund


def slow_refund(invoice_id: str, amount: int, key: str) -> dict:
    time.sleep(1)  # 两个进程都在这里等,谁都还没写日志
    return create_refund(invoice_id, amount, key)


if __name__ == "__main__":
    run = DurableRun(Journal(), "run-1")
    try:
        r = run.step("tool.create_refund", slow_refund, "INV-2291", 468, run.idempotency_key())
        print(sys.argv[1], "拿到", r, flush=True)
    except sqlite3.IntegrityError as e:
        print(sys.argv[1], "写日志失败:", e, flush=True)
```

<div class="line-notes">

- `time.sleep(1)  # 两个进程都在这里等,谁都还没写日志` 把执行时间拉长,保证两个进程都查过日志(都没查到)、都进了这个函数。
- `print(sys.argv[1], "拿到", r, flush=True)` 命令行参数是进程的名字,方便区分是谁打印的。
- `except sqlite3.IntegrityError as e:` 主键冲突时 SQLite 抛的异常类型。

</div>

```bash
rm -f part10/journal.db part10/payments.db
uv run python part10/ex537_twice.py 进程A & uv run python part10/ex537_twice.py 进程B; wait
sqlite3 part10/payments.db "SELECT * FROM refunds"
```

```text
进程A 拿到 {'refund_id': 'RF-1', 'invoice_id': 'INV-2291', 'amount': 468}
进程B 写日志失败: UNIQUE constraint failed: steps.run_id, steps.seq
RF-1|INV-2291|468|run-1-1
```

两个进程都执行了退款。幂等键让支付系统只退了一笔;日志表的联合主键让第二个写入失败。这次靠两道防线没出事,但退款接口被调了两次,如果这一步是调模型,钱就花了两份。

再加租约。新建 `part10/ex537_lease.py`:

```python
# agent-zero-lab/part10/ex537_lease.py
import sys
import time

from durable_runner import DurableRun, Journal
from ex537_twice import slow_refund

LEASE_SECONDS = 30


def acquire(j: Journal, run_id: str, owner: str) -> bool:
    j.db.execute("CREATE TABLE IF NOT EXISTS leases(run_id TEXT PRIMARY KEY, owner TEXT, expires REAL)")
    now = time.time()
    cur = j.db.execute(
        "INSERT INTO leases VALUES(?,?,?) ON CONFLICT(run_id) DO UPDATE"
        " SET owner=excluded.owner, expires=excluded.expires WHERE leases.expires < ?",
        (run_id, owner, now + LEASE_SECONDS, now))
    j.db.commit()
    return cur.rowcount == 1  # 插进去了,或者抢到了一个过期的租约


j = Journal()
me = sys.argv[1]
if not acquire(j, "run-1", me):
    print(me, "这次运行别人在跑,我退出", flush=True)
    sys.exit(0)
run = DurableRun(j, "run-1")
print(me, "拿到租约,执行:", run.step("tool.create_refund", slow_refund, "INV-2291", 468, run.idempotency_key()), flush=True)
```

<div class="line-notes">

- `from ex537_twice import slow_refund` 上一个脚本把演示放进了 `if __name__ == "__main__":`,导入时不会跑。
- `LEASE_SECONDS = 30` 租约 30 秒。拿到租约的进程如果死了,30 秒后别人可以接手;活着的进程要在到期前续租(这个答案没写续租,只演示抢占)。
- `j.db.execute("CREATE TABLE IF NOT EXISTS leases(run_id TEXT PRIMARY KEY, owner TEXT, expires REAL)")` 一次运行最多一个租约,`run_id` 是主键。
- `"INSERT INTO leases VALUES(?,?,?) ON CONFLICT(run_id) DO UPDATE"` 能插就插;已经有了就走 `DO UPDATE`。Day 390 用过 `ON CONFLICT DO NOTHING`,这里是它的兄弟。
- `" SET owner=excluded.owner, expires=excluded.expires WHERE leases.expires < ?",` `excluded` 指「这次本来想插进去的那一行」。只有旧租约已经过期时才改成自己的。整条语句由数据库原子地执行,两个进程同时来,只有一个能成功。
- `return cur.rowcount == 1  # 插进去了,或者抢到了一个过期的租约` `rowcount` 是这条语句影响的行数:插入成功或者更新成功都是 1,租约被别人占着且没过期时是 0。

</div>

```bash
rm -f part10/journal.db part10/payments.db
uv run python part10/ex537_lease.py 进程A & uv run python part10/ex537_lease.py 进程B; wait
sqlite3 part10/payments.db "SELECT * FROM refunds"
sqlite3 part10/journal.db "SELECT * FROM leases"
```

```text
进程A 这次运行别人在跑,我退出
进程B 拿到租约,执行: {'refund_id': 'RF-1', 'invoice_id': 'INV-2291', 'amount': 468}
RF-1|INV-2291|468|run-1-1
run-1|进程B|1792645386.99276
```

这次是 B 先抢到(谁先谁后每次可能不同),A 一看租约被占就退出了,退款接口只被调了一次。生产上还要做续租:拿到租约的进程每隔十几秒把 `expires` 往后推,进程死了不再续,租约自然过期,别人才能接手。

</details>

**练习 3(观察题):跑到一半改了提示词。** 对已经跑完的 `agent_durable.py` 运行,把系统提示词末尾的「最后一句话回复客户。」改成「最后一句话回复客户,语气要热情。」,再用同一个 `run_id` 运行。会发生什么?为什么?你觉得该怎么处理?

<details><summary>参考答案</summary>

```bash
rm -f part10/journal.db part10/payments.db
uv run python part10/agent_durable.py run-b
# 改提示词,然后:
uv run python part10/agent_durable.py run-b
```

第一次正常跑完(5 步,和正文一样的路径)。改完提示词再跑,最后一行:

```text
durable_runner.NonDeterminismError: 第 1 步对不上:日志里是 llm(b362328d6e4be2ee),这次代码是 llm(acea9a47527b6d27)
```

第 1 步就报错了。`llm` 这一步的参数是整个消息列表,系统提示词是列表的第一条,改一个字指纹就变了。这次报错是一件好事:如果不报错,前几步重放的是按旧提示词做出的决定,最后一步却按新提示词生成回复,同一次运行里混着两套规则。

怎么处理:提示词也是代码的一部分,改提示词等于发版。按 Day 536 练习 3 的思路,把提示词版本记在运行上,老运行用老提示词跑完;或者在发版前等正在跑的运行都结束。不要为了让它「不报错」而把消息列表从指纹里去掉,那等于把检测关掉了。这次报错发生在第 1 步重放时,模型一次都没被调,没有花钱。

</details>

**练习 4:给补偿写崩溃注入测试。** 参照 `test_durable_runner.py`,给 `saga_demo.py` 写一个参数化测试:在第 1、2、3 步各杀一次,恢复后断言输出里有「已恢复原套餐」,订阅系统里 C007 是基础版月付、active。

<details><summary>参考答案</summary>

新建 `part10/test_saga.py`:

```python
# agent-zero-lab/part10/test_saga.py
import os
import sqlite3
import subprocess
import sys

import pytest

SAGA = os.path.join(os.path.dirname(__file__), "saga_demo.py")


@pytest.mark.parametrize("crash_at", [1, 2, 3])
def test_compensation_survives_crash(tmp_path, crash_at):
    env = {**os.environ, "JOURNAL_DB": str(tmp_path / "j.db"), "SUBS_DB": str(tmp_path / "subs.db")}
    first = subprocess.run([sys.executable, SAGA, "run-s", "专业版年付"],
                           env={**env, "DURABLE_CRASH_AT": str(crash_at)}, capture_output=True, text=True)
    assert first.returncode == -9
    second = subprocess.run([sys.executable, SAGA, "run-s", "专业版年付"], env=env, capture_output=True, text=True)
    assert "已恢复原套餐" in second.stdout, second.stdout + second.stderr
    row = sqlite3.connect(tmp_path / "subs.db").execute("SELECT plan, status FROM subs").fetchone()
    assert row == ("基础版月付", "active")
```

<div class="line-notes">

- `SAGA = os.path.join(os.path.dirname(__file__), "saga_demo.py")` 和正文的测试一样,用测试文件所在目录定位脚本。`saga_demo.py` 的演示代码已经放在 `if __name__ == "__main__":` 下,用 `Journal()` 读 `JOURNAL_DB`。
- `env = {**os.environ, "JOURNAL_DB": str(tmp_path / "j.db"), "SUBS_DB": str(tmp_path / "subs.db")}` 日志和订阅系统都指向临时目录。
- `env={**env, "DURABLE_CRASH_AT": str(crash_at)}, capture_output=True, text=True)` 第一次带上崩溃开关,第二次不带。`{**env, ...}` 复制一份再加一个键,原来的 `env` 不变。
- `assert "已恢复原套餐" in second.stdout, second.stdout + second.stderr` `in` 判断子串,相当于 JS 的 `includes`。
- `assert row == ("基础版月付", "active")` 去订阅系统里看最终事实。

</div>

```bash
uv run pytest part10/test_saga.py part10/test_durable_runner.py -q
```

```text
.........                                                                [100%]
9 passed in 1.65s
```

三个补偿用例加上正文的六个,9 个全绿。第 1 步死(取消已生效、没记录):恢复时取消再执行一次,`cancel_subscription` 是「设成 cancelled」,幂等;第 2 步死(开新失败、没记录):恢复时再开一次,还是失败;第 3 步死(恢复已生效、没记录):恢复时再恢复一次,幂等。三处能过,靠的都是每个动作自己幂等。

</details>

**验收标准**:`test_durable_runner.py` 6 个全绿,并且你亲手把幂等键改成 `None` 看到只有 `[3]` 变红;`agent_durable.py` 在第 4 步被杀后恢复,支付系统里只有一笔、全部完成后再跑是「重放 5 步,真正执行 0 步」;`saga_demo.py` 三种情况输出和文中一致;能不看文章说出为什么业务失败要当结果返回,以及补偿为什么必须幂等。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 持久化运行器 | 包住工作流每一步的那层代码:记日志、重放、检查指纹、给幂等键,今天的 `durable_runner.py` |
| 崩溃注入 crash injection | 在指定位置故意让进程崩溃,验证恢复逻辑,属于故障注入的一种,例如 `DURABLE_CRASH_AT=3` |
| 子进程 subprocess | 由当前程序启动的另一个程序,有自己的进程,被杀不影响父进程,相当于 Node 的 `child_process` |
| returncode -9 | `subprocess` 里表示「子进程被 9 号信号(SIGKILL)杀死」,在 shell 里显示为退出码 137 |
| Saga | 把一个长流程拆成多步,每个有副作用的步骤配一个补偿动作,后面失败时倒着执行补偿 |
| 补偿 compensation | 一件反方向的新动作,用来抵消已经发生的副作用,例如取消订阅的补偿是恢复订阅;不同于数据库回滚 |
| 业务失败 | 重试也不会变的结论,例如套餐不可用、余额不足,应当作为结果记进日志,而不是抛异常 |
| 租约 lease | 一段时间内「这次运行归我跑」的标记,过期后别人可以接手,用来防止两个进程同时恢复同一次运行 |

## 常见误区

**在 pytest 自己的进程里触发 `kill -9`。** pytest 会跟着一起死,你什么结果都看不到。崩溃注入要放进子进程,测试进程负责检查。

**以为 `returncode` 是 137。** shell 里 `echo $?` 看到的是 137,`subprocess.run` 返回的却是 `-9`。断言写成 137 会一直失败。

**只测「不崩溃」的路径。** 全绿的测试要见过它变红。今天把幂等键改成 `None`,只有在第 3 步崩溃的那个用例变红,说明测试真的覆盖到了那个窗口。

**`step` 的返回值放 SDK 对象。** openai 返回的消息对象转不了 JSON,`Journal.put` 会报 `TypeError: Object of type ChatCompletionMessage is not JSON serializable`。在 `chat` 里先整理成普通 dict。

**业务失败用异常表示。** 抛异常的那一步不进日志,恢复时会被重新执行,条件变了就会走出另一条路。临时错误抛异常让它重试,最终结论当结果返回。

**补偿不幂等。** 补偿执行完、写日志前被杀,恢复时会再补偿一次。今天的 `restore_subscription` 是「设成某个值」所以没事;补偿是退款的话要带幂等键。

**在工作流里直接读外部状态做判断。** `saga_demo.py` 里没走 `step` 的 `show()` 重放时打印的值和第一次不同。只是打印无所谓,用来做 `if` 判断就会分叉。

**让模型在失败时自己想办法回滚。** 回滚的结果不可预测,也没法提前测试。补偿写成确定性代码,模型只负责决定做什么。

## 学习资料

### 文档与文章

- [microservices.io:Saga 模式](https://microservices.io/patterns/data/saga.html):Chris Richardson 对 Saga 的经典说明,讲了编排式(orchestration,今天这种,由一个流程统一调度)和协同式(choreography,各服务靠事件互相触发)两种。20 分钟。
- [Garcia-Molina & Salem《Sagas》(1987,PDF)](https://www.cs.cornell.edu/andru/cs711/2002fa/reading/sagas.pdf):Saga 这个词的出处。只读第 1 节就够,看最早的作者怎么定义「补偿事务」。
- [pytest 文档:参数化](https://docs.pytest.org/en/stable/how-to/parametrize.html):`@pytest.mark.parametrize` 的完整用法,今天用到的是最基本的一种。
- [Python 文档:subprocess](https://docs.python.org/3/library/subprocess.html):看 `subprocess.run` 和 `CompletedProcess.returncode` 两节,里面写了负数返回码表示被信号杀死。
- [DBOS 文档:Steps](https://docs.dbos.dev/python/tutorials/step-tutorial):DBOS 里的 step 和我们的 `run.step` 是同一个概念,看它的重试配置怎么写。
- [Temporal Python SDK:Core application](https://docs.temporal.io/develop/python/core-application):Temporal 里 workflow 和 activity 怎么分开写,对照我们的「工作流函数」和「被 step 包住的函数」。Day 539 会细讲。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1tvH16aEy7&autoplay=0&high_quality=1" title="【中配】Saga模式如何解决微服务中的分布式事务问题" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>再现馆 · 【中配】Saga 模式如何解决微服务中的分布式事务问题 · 25 分钟,海外技术频道的中文配音搬运,讲补偿事务代替回滚,以及编舞和编排两种做法。对照今天的 `compensate` 看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1m5pT6xEZY&autoplay=0&high_quality=1" title="用 Pi Durable 快速写一个 Agent：从 SQLite 做存储到 Tools、Skills" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>五里墩茶社 · 用 Pi Durable 快速写一个 Agent:从 SQLite 做存储到 Tools、Skills · 11 分钟,2026 年 10 月的新视频,从 `npm init` 开始,用一个叫 Pi Durable 的持久化 Agent 框架接 DeepSeek 和 SQLite。思路和今天自己写的运行器很像,而且是 Node 生态,你看起来应该很顺。我没有用过这个框架,只看了视频,把它当成「别人怎么做」的参考。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/xDuwrtwYHu8" title="Applying the Saga Pattern • Caitie McCaffrey • GOTO 2015" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>GOTO Conferences · Applying the Saga Pattern · Caitie McCaffrey · 讲 Saga 最常被推荐的一场演讲,她做过 Halo 游戏的后端服务,演讲里讲到补偿请求也要能安全地重复执行,英文。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/0yZAqIsyskA" title="Simplifying distributed systems development with Temporal's durable execution" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Stripe Developers · Simplifying distributed systems development with Temporal's durable execution · Stripe 官方频道,讲持久化执行怎么和支付这类有副作用的系统配合,英文。</figcaption>
</figure>

### 书籍

- Chris Richardson《Microservices Patterns》(Manning,2018)第 4 章「Managing transactions with sagas」:补偿事务、编排式 Saga 的完整设计,还讲了 Saga 缺少隔离性带来的问题和对策,比今天的例子深得多。
- Michael T. Nygard《Release It!》(第 2 版,Pragmatic Bookshelf,2018):讲生产系统怎么在故障里活下来,超时、断路器、隔舱这些稳定性模式和今天的崩溃注入是同一种思路。

### 开源项目与代码

- [temporalio/samples-python](https://github.com/temporalio/samples-python):看 `sleep_for_days` 目录(Temporal 版的练习 1,一个能睡好几天的工作流)和 `replay` 目录(拿历史日志重放来测试新代码,和今天的崩溃注入是一路思路);`tests` 目录里是官方怎么测 workflow。
- [dbos-inc/dbos-transact-py](https://github.com/dbos-inc/dbos-transact-py):DBOS 用 Postgres 存执行日志,README 的例子和今天的运行器结构几乎一样。
- [restatedev/sdk-python](https://github.com/restatedev/sdk-python):Restate 的 Python SDK,看它的 `ctx.run` 和我们的 `step` 怎么对应。

## 自测

1. `durable_runner.py` 里的崩溃注入为什么放在 `fn(*args)` 之后、`put` 之前?

<details><summary>答案</summary>

这是最坏的时刻:外部的副作用已经发生,自己的日志还没有记录,恢复时这一步会被再执行一次。能通过这个时刻的测试,「执行前死」和「写完日志后死」都更容易通过。今天去掉幂等键后,正好只有在第 3 步(退款)这个位置死的用例变红。

</details>

2. 为什么崩溃注入测试要用子进程?`returncode` 应该断言成多少?

<details><summary>答案</summary>

`kill -9` 会杀掉整个进程,在 pytest 自己的进程里触发,pytest 就一起死了。放进子进程,被杀的是子进程,测试进程能继续检查日志和支付系统。`subprocess.run` 用负数表示被信号杀死,SIGKILL 是 `-9`;shell 里同一件事显示为 137。

</details>

3. 把 Agent 循环接到运行器上,关键改动是什么?为什么 `chat` 要自己把响应整理成 dict?

<details><summary>答案</summary>

每一次调模型和每一次调工具都包进 `run.step`,模型的决定进了日志,恢复时重放出同样的决定,路径就不变;退款工具带 `run.idempotency_key()`。`step` 的结果要 `json.dumps` 进日志,openai 的响应对象不能转 JSON,所以先取出 content、tool_calls 和 token 数做成普通 dict。

</details>

4. Saga 的补偿和数据库回滚有什么区别?为什么业务失败要作为结果返回而不是抛异常?

<details><summary>答案</summary>

回滚是让改动像没发生过,只能在同一个数据库的事务里做;补偿是承认已经发生了,再做一件反方向的新事,可以跨系统,客户也可能看得到两次变化。业务失败抛异常的话,那一步不进日志,恢复时会重新执行,条件变了就可能成功,和第一次走出不同的路;作为结果返回会被记进日志,重放时永远看到同一个失败。

</details>

5. 面试题:「设计一个会自动给客户换套餐的 Agent:先取消旧订阅,再开新订阅。服务随时可能重启,新订阅可能开不出来。你怎么保证客户不会落在两头都没有的状态?」

<details><summary>答案</summary>

要点:流程跑在持久化运行器(或 Temporal 这类系统)上,取消和开通都是被记录的步骤,重启后重放不会重做;取消成功后立刻登记补偿(恢复旧订阅),开新订阅返回业务失败时,按相反顺序执行补偿;业务失败作为结果记进日志,临时错误才抛异常重试;每个有副作用的动作(包括补偿)都必须幂等,能带幂等键就带;补偿是写死的代码,不交给模型临场发挥;用崩溃注入测试在每一步各杀一次,断言最终状态正确。加分项:提到同一次运行被两个进程同时恢复要用租约,以及更稳的设计是先开新订阅再取消旧的,让失败时根本不需要补偿。

</details>

6. 这个运行器离生产还差什么?说出至少三样。

<details><summary>答案</summary>

一是并发恢复:两个进程同时恢复同一次运行,要用租约(练习 2);二是调度:需要有东西去发现卡住的运行并在活着的机器上恢复它;三是日志归档和快照:跑完的运行要清理,长运行要快照;四是长时间等待和外部唤醒:等审批不能让进程睡一天,需要信号机制。Temporal、DBOS、Restate 解决的就是这些。

</details>

## 明天预告

Day 538 · 第 77 周复习:进阶(Day 532–537)。这一周前三天讲记忆(跨会话记住客户),后三天讲持久化执行(一次任务里不怕重启)。明天不加新概念,画一张两条线的知识地图,默写 `MemoryStore.write` 和 `DurableRun.step`,再做一个只用本周知识的小项目:一个退款流程跑在持久化运行器上,开始时读客户记忆,结束时写回记忆,在任意一步被杀,记忆和退款都只有一份。
