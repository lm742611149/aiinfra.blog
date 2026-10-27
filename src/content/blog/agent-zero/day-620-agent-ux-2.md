---
title: 'Day 620 · Agent 产品(二):可撤销、出错体验、逐步放权、和 PM 协作'
description: '昨天把动作分了级,今天做两件让分级能往上走的事:一个带测试的撤销窗口,和一个靠样本量而不是裸比例决定升不升级的放权梯子。再补上出错时用户该看到什么,以及怎样把这些变成能和 PM 开会的一张表。'
pubDate: 2026-10-27
regime: none
tags: ['agent-ux', 'undo', 'trust', 'python', 'agent-zero']
series: 'agent-zero'
day: 620
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 619](/blog/agent-zero/day-619-agent-ux-1/) 把 Agent 的自主程度拆成五级,按「能不能撤回、客户看不看得到、涉及多少钱、一次影响几个人」四个问题给每个动作单独定级,写成了 `part10/ux/actions.py` 里的 `decide()`,还用真实模型比较了两种「把握程度」的展示方式。表里只有 `send_reply` 一行会随信任升级,条件是信任 ≥ 0.95,升到第四级「先发出去,窗口期内可撤」。

当时留了两个空:这个撤销窗口真的存在吗?这个 0.95 的「信任」是怎么算出来的?今天把这两样做出来,再把出错的体验和跟 PM 开会的那张表补上。

## 今天要解决的问题

学完今天你应该能:

1. 写一个撤销窗口:动作先排队,窗口期内能撤,到期才执行;用注入的假时钟写测试,不用真等 30 秒;并且知道第一版最容易犯的错是什么。
2. 写一个放权梯子:用「原样发送率」决定动作能不能升级,并且解释为什么不能直接看裸比例,要看置信区间下界;撤销率超标时自动降级。
3. 说清出错时用户需要看到哪三样东西,并把它们做成代码里的一个结构,而不是一句「出错了,请重试」。
4. 把 `decide()` 的结果导出成一张能拿去和 PM 开会的表。

预计用时 2.5 到 3 小时。前置:Day 619 的 `part10/ux/levels.py`、`actions.py`、`table.py`;Day 280 建的 `cloudledger/seed.py` 和 `cloudledger.db`(`errors.py` 会复制它,不改原库)。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 可撤销:把「不可逆」变成「短时间内可逆」

昨天说过一句话,今天兑现:提高自主程度的办法,很多时候不是让模型更聪明,而是让动作更可逆。邮箱的「撤回发送」是最熟悉的例子,邮件在你点发送之后会在服务器那边等 30 秒左右,这 30 秒里你点撤回,它就不发了。Agent 回复客户可以照抄这个办法。

撤销分三种,我按动作的性质选:

- 本来就能改回来的(打标签、改草稿):给一个撤销按钮。
- 可以延迟生效的(发回复、发通知):给一个撤销窗口,窗口期内排队,到期才真发。
- 真正不可逆的(退款、对外付款、删数据):不做窗口,执行前确认。有可能的话先改造成可逆的,比如把删除改成「标记已删除、保留 30 天」。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="撤销窗口的时间线">
  <rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12">
    <line x1="40" y1="100" x2="600" y2="100" stroke="var(--rule)" stroke-width="2"/>
    <rect x="80" y="84" width="320" height="32" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="240" y="105" text-anchor="middle" fill="var(--ink)">撤销窗口(排队中,可撤)</text>
    <circle cx="80" cy="100" r="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <circle cx="400" cy="100" r="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="80" y="62" text-anchor="middle" fill="var(--ink)">t=0 schedule</text>
    <text x="80" y="78" text-anchor="middle" fill="var(--ink-soft)" font-size="11">Agent 决定发送</text>
    <text x="400" y="62" text-anchor="middle" fill="var(--ink)">t=30s tick</text>
    <text x="400" y="78" text-anchor="middle" fill="var(--ink-soft)" font-size="11">到期,真正执行</text>
    <text x="240" y="150" text-anchor="middle" fill="var(--ink-soft)" font-size="11">窗口内 undo():从队列拿掉,返回 True</text>
    <text x="500" y="150" text-anchor="middle" fill="var(--ink-soft)" font-size="11">之后 undo():返回 False</text>
    <text x="500" y="84" text-anchor="middle" fill="var(--ink-faint)" font-size="11">已发出,撤不回</text>
    <text x="40" y="196" fill="var(--ink-faint)" font-size="11">时钟由外部传入:测试里拨假时钟,生产里用真时钟。</text>
  </g>
</svg>
<figcaption>撤销窗口只有三个动作:排队、撤销、到期执行。它把「发出去收不回」改造成了「30 秒内收得回」。</figcaption>
</figure>

### 第一步:写第一版,让测试告诉你哪里错了

撤销窗口的核心是一个队列。有个细节要先交代:这个类不自己去读系统时间,而是在创建时接收一个「时钟函数」。生产里传真的时钟,测试里传一个我们能随手拨动的假时钟。这个做法叫依赖注入,前端写测试时用 `vi.useFakeTimers()` 拨时间,是同一个目的。

我第一次写的 `undo` 是这样:

```python
# agent-zero-lab/part10/ux/undo.py(第一版里的 undo 方法,有 bug)
    def undo(self, action_id: str) -> bool:
        for p in self.queue:
            if p.action_id == action_id:
                return True          # 先只标「撤销成功」,到期时跳过(第一版,有 bug)
        return False
```

<div class="line-notes">

- `def undo(self, action_id: str) -> bool:` 按动作编号撤销,返回「撤成功没有」。界面会根据返回值决定显示「已撤销」还是「来不及了」。
- `for p in self.queue:` 在排队的动作里找。
- `if p.action_id == action_id:` 找到了。
- `return True          # 先只标` 我只是返回了 `True`,**没有把它从队列里拿走**。我当时想的是「到期时再检查有没有被撤」,可是 `tick()` 里并没有这个检查。这一行是个看起来对、实际什么都没做的撤销。
- `return False` 没找到:已经执行了,或者根本没排过。

</div>

测试先写好(这是完整的测试文件,三条):

```python
# agent-zero-lab/part10/ux/test_undo.py
from part10.ux.undo import UndoWindow


def make() -> tuple[UndoWindow, list[float], list[str]]:
    now = [0.0]
    sent: list[str] = []
    return UndoWindow(30, clock=lambda: now[0]), now, sent


def test_undone_action_does_not_run():
    w, now, sent = make()
    w.schedule("r1", lambda: sent.append("r1"))
    w.schedule("r2", lambda: sent.append("r2"))
    now[0] = 10
    assert w.undo("r1") is True
    now[0] = 31
    assert w.tick() == ["r2"]
    assert sent == ["r2"]


def test_cannot_undo_after_it_ran():
    w, now, _ = make()
    w.schedule("r1", lambda: None)
    now[0] = 31
    w.tick()
    assert w.undo("r1") is False


def test_second_undo_says_no():
    w, now, _ = make()
    w.schedule("r1", lambda: None)
    assert w.undo("r1") is True
    assert w.undo("r1") is False   # 已经撤过了,界面不该再显示「撤销成功」
```

<div class="line-notes">

- `from part10.ux.undo import UndoWindow` 被测的类,后面会给出完整文件。
- `def make() -> tuple[UndoWindow, list[float], list[str]]:` 一个小工厂函数,每条测试开始时造一个全新的窗口,返回窗口本身、假时钟、和「已发送」的记录。返回类型是三个东西组成的元组,相当于 TS 里的 `[UndoWindow, number[], string[]]`。
- `now = [0.0]` 假时钟的「当前时间」。用只有一个元素的列表而不是一个数字,是因为闭包里要能修改它:Python 的 lambda 不能给外层变量重新赋值,但可以改列表里的元素。
- `return UndoWindow(30, clock=lambda: now[0]), now, sent` 窗口 30 秒,时钟是一个每次返回 `now[0]` 的小函数。测试里改 `now[0]`,窗口看到的时间就跟着变。
- `w.schedule("r1", lambda: sent.append("r1"))` 排一个动作:到期时往 `sent` 里记一笔「发出了 r1」。
- `now[0] = 10` 把假时钟拨到第 10 秒,窗口期内。
- `assert w.undo("r1") is True` 窗口内撤销应该成功。
- `now[0] = 31` 拨到第 31 秒,过了 30 秒的窗口。
- `assert w.tick() == ["r2"]` `tick()` 返回这一次真正执行了的动作编号,应该只有 r2,r1 被撤了。
- `assert sent == ["r2"]` 真正「发出去」的也只有 r2。
- `def test_cannot_undo_after_it_ran():` 已经执行了的动作撤不回。
- `def test_second_undo_says_no():` 同一个动作撤两次,第二次应该返回 `False`,免得界面再显示一次「撤销成功」。
- `assert w.undo("r1") is False   # 已经撤过了` 第二次撤。

</div>

这时 `undo.py` 里是第一版的 `undo`,跑:

```bash
uv run pytest part10/ux/test_undo.py -q
```

真实输出(只留关键行):

```text
E       AssertionError: assert ['r1', 'r2'] == ['r2']
E       AssertionError: assert True is False
FAILED part10/ux/test_undo.py::test_undone_action_does_not_run - AssertionErr...
FAILED part10/ux/test_undo.py::test_second_undo_says_no - AssertionError: ass...
```

第一条失败最吓人:`['r1', 'r2']`,我「撤销」了 r1,它照样发出去了。用户在界面上看到「已撤销」,客户却收到了邮件。第二条是同一个原因的另一面:撤销没有真的改变任何东西,所以撤第二次还是返回 `True`。

注意第二条测试 `test_cannot_undo_after_it_ran` 反而通过了,因为到期执行时队列被清掉了。这是「碰巧对」,和昨天一样。

修法:撤销就是把它从队列里拿走。完整的文件:

```python
# agent-zero-lab/part10/ux/undo.py
"""撤销窗口:动作先排队,窗口期内能撤,到期才真正执行。时钟可以注入,测试不用真等。"""
from collections.abc import Callable
from dataclasses import dataclass


@dataclass
class Pending:
    action_id: str
    due: float
    run: Callable[[], None]


class UndoWindow:
    def __init__(self, seconds: float, clock: Callable[[], float]) -> None:
        self.seconds = seconds
        self.clock = clock
        self.queue: list[Pending] = []

    def schedule(self, action_id: str, run: Callable[[], None]) -> float:
        due = self.clock() + self.seconds
        self.queue.append(Pending(action_id, due, run))
        return due

    def undo(self, action_id: str) -> bool:
        for p in self.queue:
            if p.action_id == action_id:
                self.queue.remove(p)  # 真从队列里拿掉,到期就不会执行
                return True
        return False

    def tick(self) -> list[str]:
        now = self.clock()
        done = [p for p in self.queue if p.due <= now]
        self.queue = [p for p in self.queue if p.due > now]
        for p in done:
            p.run()
        return [p.action_id for p in done]
```

<div class="line-notes">

- `from collections.abc import Callable` `Callable` 是「可以被调用的东西」的类型,这里用来标注时钟函数和要执行的动作。相当于 TS 里的函数类型 `() => void`。
- `class Pending:` 队列里的一个待执行动作:编号、到期时间、到期要调用的函数。
- `run: Callable[[], None]` 一个不接收参数、没有返回值的函数,相当于 TS 的 `() => void`。
- `def __init__(self, seconds: float, clock: Callable[[], float]) -> None:` 构造函数,接收窗口长度和时钟。`clock` 是一个不接收参数、返回当前秒数的函数。
- `self.queue: list[Pending] = []` 排队的动作。
- `due = self.clock() + self.seconds` 到期时间等于「现在 + 窗口长度」。测试里 `now[0]` 是 0,窗口 30,到期时间就是 30.0。
- `self.queue.append(Pending(action_id, due, run))` 排进队列,动作先不执行。
- `return due` 把到期时间返回,界面可以拿它显示倒计时。
- `self.queue.remove(p)  # 真从队列里拿掉,到期就不会执行` **这是修好的那一行**。第一版缺的就是它。
- `return False` 队列里没有这个编号:已经执行了,或者已经撤过了。第二次撤销走到这里。
- `now = self.clock()` `tick()` 先读一次当前时间,后面都用这个值,避免循环中间时间又变了。
- `done = [p for p in self.queue if p.due <= now]` 找出已经到期的。
- `self.queue = [p for p in self.queue if p.due > now]` 没到期的留下。
- `for p in done:` 真正执行到期的动作。
- `p.run()` 调用它。比如发出邮件。
- `return [p.action_id for p in done]` 返回刚执行了哪些,测试靠它断言。

</div>

```bash
uv run pytest part10/ux/test_undo.py -q
```

```text
3 passed in 0.03s
```

### 第二步:换成真时钟跑一遍

假时钟只证明了逻辑。用真时钟看一遍实际效果,窗口缩成 2 秒:

```python
# agent-zero-lab/part10/ux/undo_live.py
"""用真时钟跑一遍:窗口 2 秒,发三封回复,第 1 秒撤掉第二封。"""
import time

from part10.ux.undo import UndoWindow

w = UndoWindow(2, clock=time.monotonic)
t0 = time.monotonic()
for rid in ("reply-1", "reply-2", "reply-3"):
    w.schedule(rid, lambda rid=rid: print(f"  [{time.monotonic() - t0:.1f}s] 真正发出 {rid}"))
time.sleep(1)
print(f"[{time.monotonic() - t0:.1f}s] 撤销 reply-2 ->", w.undo("reply-2"))
time.sleep(1.2)
print(f"[{time.monotonic() - t0:.1f}s] tick ->", w.tick())
print("再撤 reply-1 ->", w.undo("reply-1"))
```

<div class="line-notes">

- `w = UndoWindow(2, clock=time.monotonic)` `time.monotonic` 是 Python 标准库里的单调时钟:只增不减,不受系统改时间的影响,量时间间隔用它比 `time.time()` 稳。窗口 2 秒。
- `t0 = time.monotonic()` 记个起点,后面打印「过去了几秒」。
- `for rid in ("reply-1", "reply-2", "reply-3"):` 排三封回复。
- `w.schedule(rid, lambda rid=rid: print(f"  [{time.monotonic() - t0:.1f}s] 真正发出 {rid}"))` 这个 `lambda rid=rid` 不是笔误,是故意的,下面单独讲。
- `time.sleep(1)` 真等 1 秒,还在窗口内。
- `print(f"[{time.monotonic() - t0:.1f}s] 撤销 reply-2 ->", w.undo("reply-2"))` 第 1 秒撤销第二封,输出 `[1.0s] 撤销 reply-2 -> True`。
- `time.sleep(1.2)` 再等 1.2 秒,总共过了 2.2 秒,三封都到期了。
- `print(f"[{time.monotonic() - t0:.1f}s] tick ->", w.tick())` 到期的只剩两封,输出 `['reply-1', 'reply-3']`。
- `print("再撤 reply-1 ->", w.undo("reply-1"))` reply-1 已经发出去了,撤不回,输出 `False`。

</div>

```bash
uv run python -m part10.ux.undo_live
```

```text
[1.0s] 撤销 reply-2 -> True
  [2.2s] 真正发出 reply-1
  [2.2s] 真正发出 reply-3
[2.2s] tick -> ['reply-1', 'reply-3']
再撤 reply-1 -> False
```

reply-2 被撤掉了,没有出现在「真正发出」里。

那个 `lambda rid=rid` 是 Python 里一个有名的坑。如果写成 `lambda: print(..., rid)`,三个 lambda 共用同一个变量 `rid`,等它们被调用时,循环早就结束了,`rid` 停在最后一个值。我单独验证了一下,三个动作各自应该打印自己的编号,结果是:

```text
发出 reply-3
发出 reply-3
发出 reply-3
```

JS 里用 `var` 声明循环变量会遇到一模一样的问题,用 `let` 才每圈一个新变量。Python 的修法是把当前值作为默认参数「固定」在 lambda 里:`lambda rid=rid: ...`。

## 出错时用户看到什么

Agent 一定会失败,失败时的体验决定用户下次还敢不敢点。「出错了,请重试」这句话的问题在于它三样都没说。我习惯让每个错误提示必须回答三件事:

- 现在系统是什么状态:哪些已经生效,哪些没有。用户最怕的是不知道有没有重复扣款、重复发邮件。
- 为什么没完成:一句具体的原因,「邮件服务 5 秒没有响应」比「系统繁忙」好得多。
- 下一步能做什么:重试哪一步、转人工、自己来。转人工时把上下文带过去。

把这三样做成一个数据结构,比靠大家写文案时自觉要可靠:

```python
# agent-zero-lab/part10/ux/errors.py
"""两步动作(建退款申请 -> 发通知邮件),第二步失败时,用户该看到什么。库是 scratchpad 里的副本,通知是假的。"""
import shutil
import sqlite3
from dataclasses import dataclass
from pathlib import Path

SRC = Path(__file__).resolve().parents[2] / "cloudledger/cloudledger.db"
DB = Path(__file__).with_name("ux.db")


@dataclass
class Outcome:
    ok: bool
    done: list[str]      # 已经生效的
    not_done: list[str]  # 没有生效的
    next_step: str       # 用户下一步能做什么

    def message(self) -> str:
        head = "全部完成" if self.ok else "只完成了一部分"
        lines = [head]
        lines += [f"  已完成:{x}" for x in self.done]
        lines += [f"  没完成:{x}" for x in self.not_done]
        if self.next_step:
            lines.append(f"  下一步:{self.next_step}")
        return "\n".join(lines)


def send_notice(to: str, fail: bool) -> None:
    if fail:
        raise TimeoutError("邮件服务 5 秒没有响应")  # 假的故障,没有真发邮件


def refund_and_notify(invoice_id: str, cents: int, fail_notice: bool) -> Outcome:
    with sqlite3.connect(DB) as conn:
        rid = conn.execute(
            "INSERT INTO refund_requests (invoice_id, amount_cents, reason, status, created_at) "
            "VALUES (?, ?, '演示', 'pending_approval', '2026-10-27T10:00:00')", (invoice_id, cents)).lastrowid
    done = [f"退款申请 #{rid} 已创建,等待主管审批(金额 {cents / 100:.2f} 元)"]
    try:
        send_notice("demo@example.invalid", fail_notice)
    except TimeoutError as e:
        return Outcome(False, done, [f"通知邮件没有发出去({e})"],
                       "不用重复创建退款申请;可以点「重发通知」,或者转人工给客户打电话")
    return Outcome(True, done + ["通知邮件已发出"], [], "")


if __name__ == "__main__":
    shutil.copy(SRC, DB)
    print(refund_and_notify("INV-2026-0002", 9800, fail_notice=False).message())
    print(refund_and_notify("INV-2026-0002", 9800, fail_notice=True).message())
    with sqlite3.connect(DB) as c:
        print(c.execute("SELECT count(*) FROM refund_requests WHERE reason = '演示'").fetchone())
    DB.unlink()
```

<div class="line-notes">

- `"""两步动作(建退款申请 -> 发通知邮件),第二步失败时,用户该看到什么。` 场景:创建退款申请成功之后,发通知邮件失败。这是两步动作里最麻烦的情况,因为第一步已经生效,不能简单回滚。
- `SRC = Path(__file__).resolve().parents[2] / "cloudledger/cloudledger.db"` 原始的假数据库,在仓库根目录下。
- `DB = Path(__file__).with_name("ux.db")` 运行时复制一份到同目录,所有写入都发生在这个副本里,不碰原库。
- `class Outcome:` 一次动作的结果,不是一个布尔值,而是四个字段。
- `done: list[str]      # 已经生效的` 第一样:现在是什么状态,已经做了什么。
- `not_done: list[str]  # 没有生效的` 没做成什么,带原因。
- `next_step: str       # 用户下一步能做什么` 第三样。
- `head = "全部完成" if self.ok else "只完成了一部分"` 标题直接说「只完成了一部分」,不说「失败」。因为退款申请是创建成功的,说「失败」会让用户以为要重新来一遍。
- `lines += [f"  已完成:{x}" for x in self.done]` 先说已完成的,让用户第一眼知道没有白做。
- `def send_notice(to: str, fail: bool) -> None:` 假的发邮件函数,用参数控制是否故意失败。没有真的发任何邮件。
- `raise TimeoutError("邮件服务 5 秒没有响应")  # 假的故障,没有真发邮件` 主动抛出一个超时错误。`TimeoutError` 是 Python 内置的异常类型。
- `rid = conn.execute(` 往副本库里插一条退款申请,`lastrowid` 是新行的自增编号。
- `"VALUES (?, ?, '演示', 'pending_approval', '2026-10-27T10:00:00')", (invoice_id, cents)).lastrowid` 金额和发票号用占位符传入。状态是 `pending_approval`,不是已退款:这里只是建了一张待主管审批的申请,没有任何钱动。
- `done = [f"退款申请 #{rid} 已创建,等待主管审批(金额 {cents / 100:.2f} 元)"]` 第一步成功之后马上记下来。这一行必须在 `try` 之前,否则第二步一失败就丢了第一步的状态。
- `try:` 只把可能失败的第二步包起来。
- `except TimeoutError as e:` 只接住这一种已知故障。不要写成笼统的 `except Exception`,否则 bug 也会被吞掉,变成一句好看的提示。
- `return Outcome(False, done, [f"通知邮件没有发出去({e})"],` `e` 是异常对象,`f"...{e}"` 取它的文字,所以提示里有「邮件服务 5 秒没有响应」。
- `"不用重复创建退款申请;可以点「重发通知」,或者转人工给客户打电话")` 下一步里明确说「不用重复创建」,消除用户最担心的重复。
- `shutil.copy(SRC, DB)` 运行前复制库。
- `DB.unlink()` 最后删掉副本。

</div>

```bash
uv run python -m part10.ux.errors
```

```text
全部完成
  已完成:退款申请 #3 已创建,等待主管审批(金额 98.00 元)
  已完成:通知邮件已发出
只完成了一部分
  已完成:退款申请 #4 已创建,等待主管审批(金额 98.00 元)
  没完成:通知邮件没有发出去(邮件服务 5 秒没有响应)
  下一步:不用重复创建退款申请;可以点「重发通知」,或者转人工给客户打电话
(2,)
```

申请编号是 #3、#4 是因为复制过来的假库里已经有两条退款申请了;最后一行 `(2,)` 是副本库里原因为「演示」的行数,两次运行各建了一条,和输出对得上。

## 逐步放权:用数据决定,而且要小心样本量

昨天表里 `send_reply` 的升级条件是「信任 ≥ 0.95」。这个信任值来自一个很朴素的统计:Agent 起草的回复,客服最终**原样发送**的比例。客服每次点「发送」时,系统记一笔:原样发送、小改后发送、大改后发送、丢弃。

直觉做法是「原样率连续几周超过 95% 就升级」。这个做法有个陷阱,我用一行代码演示:

```python
# agent-zero-lab/part10/ux/trust.py
"""逐步放权:按「动作 + 工单类型」统计草稿原样发送率,用置信区间下界(而不是裸比例)决定升级,撤销率超标自动降级。
数据是用固定随机种子模拟的,不是真实客服数据。"""
import math
import random
from dataclasses import dataclass

from part10.ux.levels import Level


def wilson_lower(ok: int, n: int, z: float = 1.96) -> float:
    """Wilson 区间下界:样本少时会把比例往下拉。20 次全对,裸比例是 1.0,下界只有约 0.84。"""
    if n == 0:
        return 0.0
    p = ok / n
    d = 1 + z * z / n
    centre = p + z * z / (2 * n)
    margin = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (centre - margin) / d


@dataclass
class Ladder:
    level: Level = Level.COLLABORATOR
    sent_as_is: int = 0
    total: int = 0
    min_samples: int = 50
    promote_at: float = 0.90    # 下界要超过这个数才升级
    demote_undo_rate: float = 0.02
    n_live: int = 0        # 升级之后发出去的封数
    undone_live: int = 0   # 其中被撤销的封数

    def week(self, as_is: int, n: int, undone: int = 0) -> str:
        self.sent_as_is += as_is
        self.total += n
        if self.level == Level.APPROVER:
            self.n_live += n
            self.undone_live += undone
            low = wilson_lower(self.undone_live, self.n_live)
            if low > self.demote_undo_rate:
                self.level = Level.COLLABORATOR
                self.sent_as_is = self.total = self.n_live = self.undone_live = 0
                return f"撤销 {undone}/{n},累计撤销率下界 {low:.1%} 超过 {self.demote_undo_rate:.0%},降回 COLLABORATOR 并清零统计"
            return f"APPROVER 运行中,累计撤销 {self.undone_live}/{self.n_live}"
        if self.level == Level.COLLABORATOR and self.total >= self.min_samples \
                and wilson_lower(self.sent_as_is, self.total) >= self.promote_at:
            self.level = Level.APPROVER
            return "升到 APPROVER(先发送,留撤销窗口)"
        return "不变"


def simulate(name: str, p_as_is: float, weeks: int, per_week: int, seed: int) -> None:
    rng = random.Random(seed)
    lad = Ladder()
    print(f"== {name}(模拟:真实原样发送率 {p_as_is:.0%},每周 {per_week} 封)")
    for w in range(1, weeks + 1):
        as_is = sum(rng.random() < p_as_is for _ in range(per_week))
        undone = sum(rng.random() < 0.01 for _ in range(per_week)) if lad.level == Level.APPROVER else 0
        verdict = lad.week(as_is, per_week, undone)
        low = wilson_lower(lad.sent_as_is, lad.total)
        raw = lad.sent_as_is / lad.total if lad.total else 0.0
        print(f"  第 {w} 周 累计 {lad.sent_as_is}/{lad.total} 裸比例 {raw:.1%} 下界 {low:.1%} -> {verdict}")


if __name__ == "__main__":
    print("20 次全对:裸比例 100%,下界", f"{wilson_lower(20, 20):.1%}")
    simulate("账单咨询类", 0.97, 5, 25, seed=7)
    simulate("退款争议类", 0.80, 5, 25, seed=7)
    lad = Ladder(level=Level.APPROVER)
    print("一周撤了 1 封:", lad.week(as_is=24, n=25, undone=1))
    print("下一周撤了 4 封:", lad.week(as_is=21, n=25, undone=4))
```

<div class="line-notes">

- `import math` 标准库里的数学函数,下面开平方要用。
- `import random` 标准库的随机数,下面做模拟用。
- `def wilson_lower(ok: int, n: int, z: float = 1.96) -> float:` Wilson 区间的下界。`ok` 是成功次数,`n` 是总次数,`z = 1.96` 对应 95% 的置信度。我不推导公式,只讲它的行为:**样本越少,它给出的下界越低**。
- `"""Wilson 区间下界:样本少时会把比例往下拉。` 实跑 `wilson_lower(20, 20)` 输出 `83.9%`:20 次全对,裸比例 100%,但保守估计只有 83.9%。
- `if n == 0:` 一次都没发过,没有任何证据,返回 0。避免下面除以 0。
- `p = ok / n` 裸比例。
- `centre = p + z * z / (2 * n)` 公式的中心项。
- `margin = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))` 公式的误差项。`n` 越小它越大,下界被拉得越低。
- `return (centre - margin) / d` 中心减误差,得到下界。
- `class Ladder:` 一个动作类别的放权状态。注意是「一个类别」:账单咨询类和退款争议类各有各的 `Ladder`,不整个产品一起升。
- `level: Level = Level.COLLABORATOR` 起点是第二级:起草、等人发。
- `min_samples: int = 50` 至少 50 封才有资格升级。
- `promote_at: float = 0.90    # 下界要超过这个数才升级` 升级的门槛是「下界」达到 90%,不是裸比例。
- `demote_undo_rate: float = 0.02` 撤销率下界超过 2% 就降级。
- `n_live: int = 0        # 升级之后发出去的封数` 升级后单独统计,因为降级看的是升级之后的撤销情况。
- `def week(self, as_is: int, n: int, undone: int = 0) -> str:` 每周调用一次:这周发了 `n` 封,其中 `as_is` 封原样发送,`undone` 封被撤销。返回一句话说明这周发生了什么。
- `if self.level == Level.APPROVER:` 已经升上去了,这时看的是降级条件。
- `low = wilson_lower(self.undone_live, self.n_live)` 对「撤销率」同样用下界。一周撤了 1 封不要紧,下界会很低,不触发降级。
- `if low > self.demote_undo_rate:` 连保守估计都超过 2%,说明撤销确实多。
- `self.sent_as_is = self.total = self.n_live = self.undone_live = 0` 降级后清零统计,重新攒。一行连续赋值,四个变量同时归零。
- `if self.level == Level.COLLABORATOR and self.total >= self.min_samples \` 行末的反斜杠 `\` 表示这行没写完,接着下一行。条件是:还在第二级,而且样本够了。
- `and wilson_lower(self.sent_as_is, self.total) >= self.promote_at:` 下界达标才升级。
- `def simulate(name: str, p_as_is: float, weeks: int, per_week: int, seed: int) -> None:` 用固定随机种子模拟几周的数据。这是**模拟数据**,不是真实客服数据,真实数据要从产品里埋点得到。
- `rng = random.Random(seed)` 创建一个带种子的随机数生成器。种子固定,每次运行结果一样,方便你对照输出。
- `as_is = sum(rng.random() < p_as_is for _ in range(per_week))` 每封以 `p_as_is` 的概率被原样发送,统计这周有几封。`True` 在 Python 里等于 1,所以能直接 `sum`。
- `undone = sum(rng.random() < 0.01 for _ in range(per_week)) if lad.level == Level.APPROVER else 0` 升级之后,假设每封有 1% 的概率被撤销;没升级就没有撤销这回事。
- `raw = lad.sent_as_is / lad.total if lad.total else 0.0` 降级清零之后 `total` 是 0,这一行是为了防止除以 0。第一版没有它。
- `print("20 次全对:裸比例 100%,下界", f"{wilson_lower(20, 20):.1%}")` 输出 `20 次全对:裸比例 100%,下界 83.9%`。
- `simulate("账单咨询类", 0.97, 5, 25, seed=7)` 真实原样率 97% 的类别,模拟 5 周,每周 25 封。
- `simulate("退款争议类", 0.80, 5, 25, seed=7)` 真实原样率只有 80% 的类别。
- `lad = Ladder(level=Level.APPROVER)` 手动造一个已经升级的梯子,测降级。
- `print("一周撤了 1 封:", lad.week(as_is=24, n=25, undone=1))` 输出 `APPROVER 运行中,累计撤销 1/25`,不降级。
- `print("下一周撤了 4 封:", lad.week(as_is=21, n=25, undone=4))` 累计撤销 5/50,下界 4.3% 超过 2%,降级。

</div>

```bash
uv run python -m part10.ux.trust
```

```text
20 次全对:裸比例 100%,下界 83.9%
== 账单咨询类(模拟:真实原样发送率 97%,每周 25 封)
  第 1 周 累计 24/25 裸比例 96.0% 下界 80.5% -> 不变
  第 2 周 累计 49/50 裸比例 98.0% 下界 89.5% -> 不变
  第 3 周 累计 72/75 裸比例 96.0% 下界 88.9% -> 不变
  第 4 周 累计 97/100 裸比例 97.0% 下界 91.5% -> 升到 APPROVER(先发送,留撤销窗口)
  第 5 周 累计 122/125 裸比例 97.6% 下界 93.2% -> APPROVER 运行中,累计撤销 1/25
== 退款争议类(模拟:真实原样发送率 80%,每周 25 封)
  第 1 周 累计 21/25 裸比例 84.0% 下界 65.3% -> 不变
  第 2 周 累计 44/50 裸比例 88.0% 下界 76.2% -> 不变
  第 3 周 累计 63/75 裸比例 84.0% 下界 74.1% -> 不变
  第 4 周 累计 82/100 裸比例 82.0% 下界 73.3% -> 不变
  第 5 周 累计 104/125 裸比例 83.2% 下界 75.7% -> 不变
一周撤了 1 封: APPROVER 运行中,累计撤销 1/25
下一周撤了 4 封: 撤销 4/25,累计撤销率下界 4.3% 超过 2%,降回 COLLABORATOR 并清零统计
```

看第一个类别第 2 周:49/50,裸比例已经 98%,如果只看裸比例早就升级了,但下界才 89.5%,没达到 90%,于是再等一周。到第 4 周样本攒到 100 封,下界 91.5%,升级。第二个类别真实原样率只有 80%,裸比例最高到过 88%,每周都在 80% 多晃,从头到尾没有升级。

这个梯子我第一次写的时候崩过一次。第一版的降级条件是「这一周的撤销率超过 2%」,结果是这样:

```text
  第 5 周 累计 122/125 ...
ZeroDivisionError: division by zero
```

崩溃的直接原因是降级后统计清零,`total` 变成 0,打印裸比例时除以 0,这一行后来加了 `if lad.total else 0.0`。但崩溃背后还有一个更要紧的问题,模拟里第 5 周那一周碰巧撤了 1 封:1/25 = 4%,超过 2%,就降级了。**一周 25 封、撤 1 封,这个证据太薄,不应该推翻四周的积累。** 所以最后改成了和升级对称的做法:降级也看下界,累计的撤销率下界超过 2% 才降。这样撤 1 封不动,下一周撤了 4 封累计 5/50,下界 4.3%,才降。

怎么感受「裸比例会骗人」?练习 3 会跑 1000 次模拟,数一数。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="放权梯子:升级看下界,降级也看下界">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12">
    <rect x="40" y="110" width="200" height="60" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="140" y="136" text-anchor="middle" fill="var(--ink)">L2 起草,人发送</text>
    <text x="140" y="154" text-anchor="middle" fill="var(--ink-soft)" font-size="11">统计原样发送率</text>
    <rect x="400" y="40" width="200" height="60" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="500" y="66" text-anchor="middle" fill="var(--ink)">L4 先发,窗口内可撤</text>
    <text x="500" y="84" text-anchor="middle" fill="var(--ink-soft)" font-size="11">统计撤销率</text>
    <path d="M 240 125 L 400 80" stroke="var(--ink-soft)" fill="none"/>
    <text x="320" y="92" text-anchor="middle" fill="var(--ink)">升:≥50 封且</text>
    <text x="320" y="108" text-anchor="middle" fill="var(--ink)">原样率下界 ≥ 90%</text>
    <path d="M 400 90 L 240 140" stroke="var(--ink-soft)" fill="none" stroke-dasharray="4 3"/>
    <text x="320" y="170" text-anchor="middle" fill="var(--ink)">降:撤销率下界 &gt; 2%,统计清零</text>
    <text x="40" y="208" fill="var(--ink-faint)" font-size="11">退款这类「钉在 L3」的动作没有这条梯子。</text>
  </g>
</svg>
<figcaption>放权梯子只有两条边,升和降都看置信区间下界,不看裸比例。每个动作类别各有一个梯子。</figcaption>
</figure>

## 和 PM 协作:带一张表去开会

做完这些,工程师在产品评审里最有用的一件事,是别讨论「Agent 安不安全」(没法回答),而是带一张表,让业务方逐行确认。这张表里的「当前级别」一列,应该由 `decide()` 算出来,不是手填的,这样表和代码永远不会各说各话。

```python
# agent-zero-lab/part10/ux/pm_table.py
"""把动作表导出成给 PM 开会用的 markdown。级别来自 decide(),不是手填的,表和代码不会各说各话。"""
from part10.ux.actions import Action, decide
from part10.ux.levels import MODE

ROWS: list[tuple[Action, str, str, str]] = [
    (Action("list_invoices", True, False), "无", "无", "调用量、报错率"),
    (Action("tag_ticket", True, False), "无", "标签被改回的比例 >5%", "改回率"),
    (Action("send_reply", True, True), "连续 4 周原样发送率下界 ≥90%", "撤销率下界 >2%", "采纳/修改/丢弃/撤销率"),
    (Action("create_refund_request", False, True, amount=98), "不升级", "-", "审批通过率、驳回原因"),
    (Action("create_refund_request", False, True, amount=5000), "不升级", "-", "审批耗时"),
]

if __name__ == "__main__":
    print("| 动作 | 可逆 | 客户可见 | 金额 | 当前级别 | 升级条件 | 降级条件 | 要埋的指标 |")
    print("| --- | --- | --- | --- | --- | --- | --- | --- |")
    for a, up, down, metric in ROWS:
        lv = decide(a)
        print(f"| {a.name} | {'是' if a.reversible else '否'} | {'是' if a.external else '否'} | "
              f"{a.amount:g} | {lv.name}({MODE[lv]}) | {up} | {down} | {metric} |")
```

<div class="line-notes">

- `from part10.ux.actions import Action, decide` 级别来自昨天写的 `decide()`。
- `ROWS: list[tuple[Action, str, str, str]] = [` 每一行是一个四元组:动作、升级条件、降级条件、要埋的指标。类型标注写在变量名后面,相当于 TS 的 `const ROWS: [Action, string, string, string][]`。
- `(Action("list_invoices", True, False), "无", "无", "调用量、报错率"),` 只读动作,不需要升降级,但仍要埋点,否则出了问题没法查。这里 `Action` 的参数用位置传(`True, False`),因为 `reversible`、`external` 是前两个字段。
- `(Action("send_reply", True, True), "连续 4 周原样发送率下界 ≥90%", "撤销率下界 >2%", "采纳/修改/丢弃/撤销率"),` 唯一会升降级的一行,条件就是上面 `Ladder` 里写的数字。
- `(Action("create_refund_request", False, True, amount=98), "不升级", "-", "审批通过率、驳回原因"),` 退款写「不升级」,这是整张表里最重要的一格:它告诉业务方,这类动作永远要人批。
- `print("| 动作 | 可逆 | 客户可见 | 金额 | 当前级别 | 升级条件 | 降级条件 | 要埋的指标 |")` 打印 markdown 表头,输出可以直接贴进 JIRA 或文档。
- `lv = decide(a)` 级别由代码算,不手填。
- `f"{a.amount:g} | {lv.name}({MODE[lv]}) | {up} | {down} | {metric} |")` `:g` 让 `0.0` 显示成 `0`、`98.0` 显示成 `98`,表里不出现多余的小数点。

</div>

```bash
uv run python -m part10.ux.pm_table
```

```text
| 动作 | 可逆 | 客户可见 | 金额 | 当前级别 | 升级条件 | 降级条件 | 要埋的指标 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| list_invoices | 是 | 否 | 0 | OBSERVER(直接执行并记日志) | 无 | 无 | 调用量、报错率 |
| tag_ticket | 是 | 否 | 0 | OBSERVER(直接执行并记日志) | 无 | 标签被改回的比例 >5% | 改回率 |
| send_reply | 是 | 是 | 0 | COLLABORATOR(起草,等人提交) | 连续 4 周原样发送率下界 ≥90% | 撤销率下界 >2% | 采纳/修改/丢弃/撤销率 |
| create_refund_request | 否 | 是 | 98 | CONSULTANT(执行前确认) | 不升级 | - | 审批通过率、驳回原因 |
| create_refund_request | 否 | 是 | 5000 | CONSULTANT(执行前确认) | 不升级 | - | 审批耗时 |
```

这张表有三个用处。业务方逐行确认「这一行你们能接受吗」,比泛泛地问「AI 靠不靠谱」好回答得多。它还把「要埋的指标」列了出来,这些指标现在不埋,以后想放权就没有数据可用。最后,它让「放权」有了说得出口的规则:「这类工单连续四周原样发送率下界超过 90%,我们打算先对这一类开放自动发送,撤销率超标就自动退回。」

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1fykHY6EAF&autoplay=0&high_quality=1" title="LangGraph Interrupt:Human-In-The-Loop 人机交互手到擒来" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>沧海九粟 · LangGraph Interrupt:Human-In-The-Loop 人机交互手到擒来 · 2024 年底的视频,讲让 Agent 在中途停下来等人确认的写法,对应今天「执行前确认」那一级的实现。</figcaption>
</figure>

## 动手练习

**练习 1:给撤销窗口加倒计时。** 界面上的撤销按钮要显示「还剩 18 秒」。给 `UndoWindow` 写一个子类 `CountdownWindow`,加一个 `remaining(action_id)`:返回还剩几秒;已执行或已撤销返回 `None`(界面据此隐藏按钮)。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ux/ex620_remaining.py
"""练习 1:给撤销窗口加「还剩几秒」,界面倒计时用。"""
from part10.ux.undo import UndoWindow


class CountdownWindow(UndoWindow):
    def remaining(self, action_id: str) -> float | None:
        for p in self.queue:
            if p.action_id == action_id:
                return max(0.0, p.due - self.clock())
        return None  # 已经执行或已经撤销,界面应该隐藏撤销按钮


if __name__ == "__main__":
    now = [0.0]
    w = CountdownWindow(30, clock=lambda: now[0])
    w.schedule("r1", lambda: None)
    now[0] = 12
    print(w.remaining("r1"))
    now[0] = 31
    w.tick()
    print(w.remaining("r1"))
    print(w.remaining("不存在"))
```

<div class="line-notes">

- `class CountdownWindow(UndoWindow):` 括号里写父类,表示继承:`CountdownWindow` 拥有 `UndoWindow` 的所有方法,再加一个新的。相当于 JS 的 `class CountdownWindow extends UndoWindow`。
- `def remaining(self, action_id: str) -> float | None:` 返回类型是「数字或 None」。
- `for p in self.queue:` 在排队的动作里找。
- `return max(0.0, p.due - self.clock())` 到期时间减去现在,`max(0.0, ...)` 保证不会出现负数,比如正好到期还没来得及 `tick`。
- `return None  # 已经执行或已经撤销,界面应该隐藏撤销按钮` 找不到就是 `None`。
- `now[0] = 12` 拨到第 12 秒,到期时间是 30,还剩 18。
- `print(w.remaining("r1"))` 输出 `18.0`。
- `now[0] = 31` 拨到过期后。
- `w.tick()` 执行到期的动作,队列清空。
- `print(w.remaining("r1"))` 输出 `None`。
- `print(w.remaining("不存在"))` 没排过的编号也是 `None`,输出 `None`。

</div>

```bash
uv run python -m part10.ux.ex620_remaining
```

```text
18.0
None
None
```

</details>

**练习 2:三步动作里第三步失败。** `errors.py` 只有两步。现在再加一步「写审计日志」,写一个 `three_steps(fail_at)`,让第 3 步失败时,提示里要说清:钱和通知都没问题,只缺审计记录,用户不用重做。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ux/ex620_audit.py
"""练习 2:三步动作(建申请、发通知、写审计日志),第三步失败时的提示。"""
from part10.ux.errors import Outcome


def three_steps(fail_at: int) -> Outcome:
    done: list[str] = []
    steps = ["退款申请 #7 已创建", "通知邮件已发出", "审计日志已写入"]
    for i, name in enumerate(steps, 1):
        if i == fail_at:
            rest = steps[i - 1:]
            hint = "钱和客户通知都没问题,只缺审计记录;已通知值班同事补写,你不用重做" if i == 3 else "可以重试这一步"
            return Outcome(False, done, [f"{x}(没有完成)" for x in rest], hint)
        done.append(name)
    return Outcome(True, done, [], "")


if __name__ == "__main__":
    print(three_steps(3).message())
```

<div class="line-notes">

- `from part10.ux.errors import Outcome` 复用前面写的结果结构。
- `def three_steps(fail_at: int) -> Outcome:` `fail_at` 指定第几步故意失败,0 表示都不失败。
- `steps = ["退款申请 #7 已创建", "通知邮件已发出", "审计日志已写入"]` 三步的完成描述。`#7` 是演示用的编号,这里不连数据库。
- `for i, name in enumerate(steps, 1):` 序号从 1 开始,和「第几步」对得上。
- `if i == fail_at:` 轮到那一步了,让它失败。
- `rest = steps[i - 1:]` 从失败那一步起,后面的全部算「没完成」。切片 `steps[2:]` 相当于 JS 的 `steps.slice(2)`。
- `hint = "钱和客户通知都没问题,只缺审计记录;已通知值班同事补写,你不用重做" if i == 3 else "可以重试这一步"` 第三步失败有专门的话术,其他步骤用通用的。
- `return Outcome(False, done, [f"{x}(没有完成)" for x in rest], hint)` 把已完成的、没完成的、下一步都放进去。
- `done.append(name)` 没失败的步骤累加到已完成里。
- `print(three_steps(3).message())` 第 3 步失败。

</div>

```bash
uv run python -m part10.ux.ex620_audit
```

```text
只完成了一部分
  已完成:退款申请 #7 已创建
  已完成:通知邮件已发出
  没完成:审计日志已写入(没有完成)
  下一步:钱和客户通知都没问题,只缺审计记录;已通知值班同事补写,你不用重做
```

这一例里「已通知值班同事补写」是演示文案,代码里并没有真的通知谁。真实系统里,这句话必须对应一个真的补偿动作,否则等于对用户说了假话。

</details>

**练习 3:裸比例到底会误升级多少次?** 假设一类工单真实原样发送率只有 85%,低于门槛 90%,不该升级。用 1000 个不同的随机种子,各模拟 8 周(每周 25 封),分别统计「按裸比例 ≥ 90%」和「按下界 ≥ 90%」两种规则下,有多少次在 8 周内误升级。再把最少样本数从 50 改成 20 看看。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ux/ex620_sweep.py
"""练习 3:真实原样发送率只有 85% 的类别,用「裸比例 ≥90%」和「下界 ≥90%」各会误升级几次?1000 个随机种子,模拟数据。"""
import random

from part10.ux.trust import wilson_lower


def first_promotion_week(seed: int, p: float, use_lower: bool, min_samples: int = 50) -> int | None:
    rng = random.Random(seed)
    ok = n = 0
    for week in range(1, 9):
        ok += sum(rng.random() < p for _ in range(25))
        n += 25
        score = wilson_lower(ok, n) if use_lower else ok / n
        if n >= min_samples and score >= 0.90:
            return week
    return None


if __name__ == "__main__":
    for min_samples in (50, 20):
        for use_lower in (False, True):
            hits = sum(first_promotion_week(s, 0.85, use_lower, min_samples) is not None for s in range(1000))
            name = "下界" if use_lower else "裸比例"
            print(f"最少 {min_samples} 封,按{name}:1000 次里有 {hits} 次在 8 周内误升级(真实原样率 85%)")
```

<div class="line-notes">

- `from part10.ux.trust import wilson_lower` 复用上面写的下界函数。
- `def first_promotion_week(seed: int, p: float, use_lower: bool, min_samples: int = 50) -> int | None:` 用一个种子跑 8 周,返回第一次满足升级条件的周数;一直没满足返回 `None`。
- `rng = random.Random(seed)` 每个种子一条独立的随机序列,所以 1000 个种子相当于 1000 个平行世界。
- `ok += sum(rng.random() < p for _ in range(25))` 每周 25 封,每封以 `p`(0.85)的概率被原样发送。
- `score = wilson_lower(ok, n) if use_lower else ok / n` 开关:用下界还是裸比例当分数。
- `if n >= min_samples and score >= 0.90:` 样本够、分数达标,就算升级了。
- `return week` 记下升级发生在第几周。
- `for min_samples in (50, 20):` 对比两种最少样本数。
- `for use_lower in (False, True):` 再对比两种分数。
- `hits = sum(first_promotion_week(s, 0.85, use_lower, min_samples) is not None for s in range(1000))` 1000 个世界里,有多少个发生了升级。因为真实率是 85%,任何一次升级都是误升级。
- `name = "下界" if use_lower else "裸比例"` 只为打印好读。

</div>

```bash
uv run python -m part10.ux.ex620_sweep
```

```text
最少 50 封,按裸比例:1000 次里有 260 次在 8 周内误升级(真实原样率 85%)
最少 50 封,按下界:1000 次里有 1 次在 8 周内误升级(真实原样率 85%)
最少 20 封,按裸比例:1000 次里有 364 次在 8 周内误升级(真实原样率 85%)
最少 20 封,按下界:1000 次里有 1 次在 8 周内误升级(真实原样率 85%)
```

一个真实只有 85% 的类别,按裸比例,每 4 个里就有 1 个(260/1000)会在 8 周内被误升级;门槛降到 20 封,变成 36%。按下界,1000 次里只有 1 次。下界把「碰巧连续几周运气好」挡在了门外。

最少 20 封和 50 封在「按下界」那行结果一样,是因为每周只发 25 封,第一次检查时样本是 25 封,两个门槛都已满足,真正起作用的是下界。如果想看样本数门槛的单独影响,把每周封数改成 5 再跑。

这里的数据全是模拟,只说明统计方法的行为,不代表真实客服的原样发送率。

</details>

**验收标准:**`uv run pytest part10/ux -q` 全绿(今天加上昨天共 8 条);练习 3 能解释为什么按下界升级几乎不会误升级。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 撤销窗口 | 动作先排队、延迟生效,窗口期内用户可以撤回,到期才真正执行 |
| 依赖注入 | 不在代码里写死依赖(比如系统时钟),而是从外面传进来,测试时换成假的 |
| 闭包(lambda 默认参数) | lambda 引用的外层变量,在被调用时才取值;`lambda x=x: ...` 把当前值固定下来 |
| 补偿动作 | 某一步失败后,用来弥补已生效步骤的动作,比如重发通知、转人工 |
| 原样发送率 | Agent 起草的内容,被人不修改就发出的比例,是放权的核心指标 |
| 撤销率 | 已发出的动作中,在窗口期内被撤销的比例 |
| 置信区间 / Wilson 下界 | 对一个比例的保守估计,样本越少越保守;20 次全对的下界约 84% |
| 逐步放权 | 按动作、按类别,用数据决定自主程度往上走,出问题自动往下退 |
| 采纳率 / 修改率 | 用户接受或修改 Agent 产出的比例 |
| 软删除 | 只打删除标记不真正删,可以恢复,是把「不可逆」改造成「可逆」的常用办法 |

## 常见误区

**撤销只返回 True,没有真的拿掉。** 今天第一版就是这样:界面显示「已撤销」,客户照样收到邮件。撤销必须改变状态,并且第二次撤销要返回 False。

**测试里用真时间等。** 窗口 30 秒的测试跑 30 秒没人愿意跑。时钟从外部传进来,测试拨假时钟。

**循环里创建 lambda 不固定变量。** 三个 `lambda` 全打印最后一个值,`lambda rid=rid:` 才对。

**错误提示只说「出错了」。** 说清已经完成了什么、没完成什么、下一步怎么办,尤其要说「不用重复」,用户最怕重复扣款和重复发信。

**用裸比例决定放权。** 样本少时一周运气好就升级了。实测真实只有 85% 的类别,裸比例每 4 个里有 1 个误升级,下界几乎没有。

**一个坏周就降级。** 对称地,降级也看下界,一周撤 1 封不该推翻四周的积累。

**整个产品一起放权。** 账单咨询类和退款争议类的数据完全不同,一个梯子一个类别。

## 学习资料

### 文档与文章

- [Google PAIR:People + AI Guidebook](https://pair.withgoogle.com/guidebook/):看「Feedback + Control」一章,讲怎么让用户纠正 AI,30 分钟。
- [Shape of AI](https://www.shapeof.ai/):找「撤销」「确认」「预览」这几类交互模式的例子。
- [Binomial proportion confidence interval(维基百科)](https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval):讲 Wilson 区间的那一节,看它和直接用比例相比为什么在样本少时更稳。公式部分可以先跳过,看图和结论。
- [Levels of Autonomy for AI Agents(arXiv 2506.12469)](https://arxiv.org/abs/2506.12469):昨天读过的论文,回头看它怎么讨论用户能不能随时「接管」。

### B 站视频

已在正文嵌入沧海九粟《LangGraph Interrupt:Human-In-The-Loop 人机交互手到擒来》。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/7GOxUgVTz3s" title="How to Build Human-in-the-Loop for AI Agents (Practical Guide)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Dave Ebbelaar · How to Build Human-in-the-Loop for AI Agents (Practical Guide) · 按标题是一个实操指南,我只核对了视频存在和标题,没有逐段看。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 10 章后半部分讲用户反馈,今天的原样发送率、撤销率就是这一类反馈信号。英文原版。
- Ben Shneiderman《Human-Centered AI》(Oxford University Press, 2022):讲高控制和高自动化如何同时成立,可以和「按动作分级」对照着读。英文原版。

### 开源项目与代码

- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):它的 `interrupt` 机制就是「执行前确认」这一级的一种实现,第五部分 LangGraph 那几天会细讲。

## 自测

**1. 撤销窗口为什么要把时钟作为参数传进来?**

<details><summary>答案</summary>

这样测试里可以传一个能手动拨动的假时钟,瞬间验证「第 10 秒能撤、第 31 秒不能撤」,不用真等 30 秒;生产里传真时钟。这是依赖注入,前端测试里的 fake timers 是同一个思路。

</details>

**2. 今天第一版 `undo()` 的 bug 是什么?为什么有一条测试碰巧没挂?**

<details><summary>答案</summary>

它只返回了 `True`,没把动作从队列里拿掉,所以「撤销」过的动作到期照样执行,而且重复撤销还是返回 `True`。`test_cannot_undo_after_it_ran` 碰巧通过,是因为到期执行时队列本来就被清掉了,它根本没测到撤销的逻辑。

</details>

**3. 出错提示要回答哪三件事?**

<details><summary>答案</summary>

现在系统处于什么状态(哪些已生效、哪些没有)、为什么没完成(具体原因)、用户下一步能做什么(并且说明哪些不用重做)。

</details>

**4. 20 封全部原样发送,为什么不能据此升级?**

<details><summary>答案</summary>

样本太少,裸比例 100% 可能只是运气。Wilson 下界只有约 83.9%,没达到 90% 的门槛。需要样本攒多、下界也达标才升级。

</details>

**5. 为什么降级也要看下界,而不是「这周撤销率超过 2% 就降」?**

<details><summary>答案</summary>

每周样本很小(25 封),撤 1 封就是 4%,会把积累几周的证据推翻。看累计撤销率的下界,只有撤销确实偏多时才降级。第一版就是这样误降级的,同时还碰到清零后除以 0 的崩溃。

</details>

**6. 面试题:产品经理说「Agent 回复客户先别让人审了,每次都点发送太烦」。你怎么回应?**

<details><summary>答案</summary>

不直接说不行,先把「烦」量化:现在客服原样发送的比例、修改的比例。如果某一类工单的原样发送率下界已经稳定超过某个门槛(比如连续 4 周、至少 50 封、下界 ≥90%),可以对这一类开放「先发送、留撤销窗口」,而不是整个产品一起放开。同时把撤销窗口和降级规则一起上线:撤销率下界超过 2% 自动退回起草模式。退款、批量这类不可逆或大范围的动作不在这个讨论里,永远需要确认。这样既回应了体验问题,又把风险限制在可逆动作上,并且出了问题有自动退路。

</details>

## 明天预告

[Day 621](/blog/agent-zero/day-621-generative-ui/) 讲生成式 UI:MCP Apps、A2UI、AG-UI 三条路线和它们的安全边界。今天「执行前确认」那一级,在界面上到底长什么样?如果 Agent 只能回文字,主管就得在一堆字里找金额,手一滑回错数字钱就退出去了。明天给退款审批做一张带「批准」「驳回」按钮的卡片,在本地的测试环境里真的点一遍。
