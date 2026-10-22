---
title: 'Day 538 · 第 77 周复习:进阶(Day 532–537)'
description: '这一周两条线:前三天是记忆,让 Agent 跨会话记住客户;后三天是持久化执行,让一次任务不怕重启。今天不加新概念,画出两条线的地图,默写 MemoryStore.write 和 DurableRun.step,再把两条线拼成一个小项目:退款流程跑在持久化运行器上,开始读客户记忆、结束写回记忆,用崩溃注入在六个步骤各杀一次,退款和记忆都只有一份。'
pubDate: 2026-10-22
regime: none
tags: ['memory', 'durable-execution', 'review', 'sqlite', 'agent-zero']
series: 'agent-zero'
day: 538
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 537](/blog/agent-zero/day-537-durable-3/) 把持久化执行的零件拼成了 `durable_runner.py`:日志重放、步骤指纹、幂等键、`now()`、崩溃注入开关和 Saga 补偿。用 pytest 在每一步各真杀一次进程,证明了「在哪死都只退一笔」;去掉幂等键后,测试只在退款那一步变红。还把一个真的 DeepSeek Agent 放上去跑,在退款后杀掉再恢复,模型只为没做完的步骤付钱。

这一周到这里正好六天,分成两半:Day 532–534 讲记忆,管的是**跨会话**的事;Day 535–537 讲持久化执行,管的是**一次任务之内**的事。今天把两半合在一起复习,顺便发现一个两半各自看都没问题、拼在一起才冒出来的坑。

## 今天要解决的问题

复习日不学新东西,目标是确认这一周的东西真的长在你手上了。今天结束时你应该能:

1. 不看文章,画出这一周的两条线:记忆的四个设计问题怎么一路落到 `MemoryStore`;持久化执行怎么从「记日志、重放」一路长成 `durable_runner.py`。说出每一环是哪一天讲的、防的是什么事故。
2. 默写 `MemoryStore.write` 和 `DurableRun.step` 两段核心代码,用检查脚本和 Day 537 的测试证明它们是对的。
3. 跑通本周小项目 `part10/review77.py`:六步的退款流程,第 2 步读客户记忆,第 5 步把「最近一次退款」写回记忆;用崩溃注入在 6 个步骤各杀一次,恢复后退款只有一笔、记忆只有一条,回复仍按第一次读到的记忆来写。
4. 能解释两个故意写错的版本为什么错:读记忆不走 `step`,幂等键只用运行 id。

预计用时 3–4 小时(大头在默写和练习)。前置:[Day 532](/blog/agent-zero/day-532-memory-taxonomy/) 到 [Day 537](/blog/agent-zero/day-537-durable-3/) 全部。

学法和平时一样:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 340" role="img" aria-label="本周知识地图:上面一条是记忆线,从四类记忆和四个设计问题,到两根轴和带时间的事实,再到 MemoryStore 和写入评测;下面一条是持久化执行线,从事件溯源和重放,到非确定性和副作用,再到完整运行器、崩溃注入和补偿;两条线在今天的小项目里相交">
  <rect x="0" y="0" width="640" height="340" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <text x="20" y="26" fill="var(--ink)">记忆:跨会话记住客户</text>
    <rect x="20" y="40" width="180" height="76" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="32" y="60" fill="var(--ink)">532 拆开记忆</text>
    <text x="32" y="80" fill="var(--ink-soft)">工作/情景/语义/程序</text>
    <text x="32" y="98" fill="var(--ink-soft)">何时写·写什么·谁写·冲突</text>
    <rect x="230" y="40" width="180" height="76" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="242" y="60" fill="var(--ink)">533 四个开源方案</text>
    <text x="242" y="80" fill="var(--ink-soft)">两根轴</text>
    <text x="242" y="98" fill="var(--ink-soft)">带时间的事实 as_of</text>
    <rect x="440" y="40" width="180" height="76" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="452" y="60" fill="var(--ink)">534 MemoryStore</text>
    <text x="452" y="80" fill="var(--ink-soft)">ADD/UPDATE/NOOP/REJECT</text>
    <text x="452" y="98" fill="var(--ink-soft)">过期 · 写入评测</text>
    <line x1="200" y1="78" x2="230" y2="78" stroke="var(--ink-soft)"/>
    <line x1="410" y1="78" x2="440" y2="78" stroke="var(--ink-soft)"/>
    <text x="20" y="166" fill="var(--ink)">持久化执行:一次任务不怕重启</text>
    <rect x="20" y="180" width="180" height="76" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="32" y="200" fill="var(--ink)">535 记日志、重放</text>
    <text x="32" y="220" fill="var(--ink-soft)">事件溯源 · reducer</text>
    <text x="32" y="238" fill="var(--ink-soft)">put 里必须 commit</text>
    <rect x="230" y="180" width="180" height="76" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="242" y="200" fill="var(--ink)">536 两个麻烦</text>
    <text x="242" y="220" fill="var(--ink-soft)">非确定性 → 指纹</text>
    <text x="242" y="238" fill="var(--ink-soft)">副作用 → 幂等键</text>
    <rect x="440" y="180" width="180" height="76" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="452" y="200" fill="var(--ink)">537 完整运行器</text>
    <text x="452" y="220" fill="var(--ink-soft)">崩溃注入测试</text>
    <text x="452" y="238" fill="var(--ink-soft)">Saga 补偿</text>
    <line x1="200" y1="218" x2="230" y2="218" stroke="var(--ink-soft)"/>
    <line x1="410" y1="218" x2="440" y2="218" stroke="var(--ink-soft)"/>
    <rect x="190" y="290" width="260" height="34" rx="6" fill="var(--paper)" stroke="var(--ink-soft)"/>
    <text x="320" y="311" text-anchor="middle" fill="var(--ink)">538 小项目:review77.py</text>
    <path d="M 530 116 C 530 150, 470 280, 450 300" fill="none" stroke="var(--mem)" stroke-dasharray="4 3"/>
    <path d="M 530 256 L 450 300" fill="none" stroke="var(--compute)" stroke-dasharray="4 3"/>
  </g>
</svg>
<figcaption>这一周的两条线。蓝色是记忆(给模型用的上下文从哪来),琥珀色是持久化执行(任务的进度存在哪)。两条线都用 SQLite,都是「只追加、不改旧的」,今天的小项目让它们在同一个流程里相遇。</figcaption>
</figure>

两条线看起来讲的是两件事,其实底层是同一个想法:**不在原地改,而是追加记录**。Day 534 的记忆旧值不删、只标记被替代,Day 535 的执行日志只 INSERT 不 UPDATE。区别在于记录给谁用:记忆是给下一次对话的模型用的,所以要挑、要忘、要评测写得准不准;执行日志是给重启后的运行器用的,所以要一步不差、顺序稳定、对不上就报错。

面试时被问到「Agent 的状态怎么管」,能把这两条分开讲清楚,本身就是一个加分点。很多人会把它们混在一起,用对话历史当记忆,或者用记忆库存任务进度。

## 本周每天一句话

[Day 532 · 把记忆拆开](/blog/agent-zero/day-532-memory-taxonomy/):按 CoALA 把记忆分成工作、情景、语义、程序四类,SupportPilot 主要要情景和语义两类;设计时回答四个问题(什么时候写、写什么、谁来写、冲突了听谁的),再加一个最容易忘的「怎么忘」。

[Day 533 · 四个开源方案](/blog/agent-zero/day-533-memory-oss/):用「谁来写」和「冲突怎么处理」两根轴给 mem0、Letta、Zep/Graphiti、LangGraph store 定位;Graphiti 的「带时间的事实」让旧值在新值生效那天失效,能回答「9 月扣款那天他是什么套餐」;SupportPilot 的规则和业务绑得太紧,选择自己写。

[Day 534 · 写客户记忆并评测](/blog/agent-zero/day-534-memory-build/):`MemoryStore.write` 把规则写成确定性代码,敏感字段拒绝、相同值不重复、来源低的不能覆盖来源高的、当前问题 30 天过期,返回 ADD / UPDATE / NOOP / REJECT;再用一批标注过的对话算写入的准确率和召回率。

[Day 535 · 记日志,然后重放](/blog/agent-zero/day-535-durable-1/):状态是事件折叠出来的,和 Redux 的 reducer 一个道理;每一步的结果写进 SQLite 并 commit,重启后同一个 `run_id` 从头跑,日志里有的步骤直接拿结果。

[Day 536 · 两个麻烦](/blog/agent-zero/day-536-durable-2/):模型决定会变、代码会发版,所以一切不确定的都要走 `step`,每一步存指纹,对不上抛 `NonDeterminismError`;外部做完、日志没写的窗口消不掉,用「运行 id + 步骤序号」做幂等键,至少一次加去重等于效果上恰好一次。

[Day 537 · 自己写一个运行器](/blog/agent-zero/day-537-durable-3/):74 行的 `durable_runner.py`;崩溃注入要放在子进程里,`returncode` 是 `-9`;业务失败当结果返回、不抛异常;补偿倒着执行,而且自己也要幂等。

哪一句你读着觉得「好像是这样,但说不清为什么」,先回那一天把对应小节重看一遍再往下走。

## 准备环境

今天的代码都在 `agent-zero-lab/part10/` 下,用到前几天的三个文件,先确认它们都在:

| 文件 | 哪天建的 | 今天用它做什么 |
| --- | --- | --- |
| `part10/memory_store.py` | Day 534 | 客户记忆 |
| `part10/temporal_facts.py` | Day 533 | 练习 3 默写 `as_of` |
| `part10/payments.py` | Day 536 | 假支付系统,带幂等键 |
| `part10/durable_runner.py` | Day 537 | 持久化运行器 |
| `part10/test_durable_runner.py` | Day 537 | 默写二的检查 |

```bash
cd agent-zero-lab
ls part10/memory_store.py part10/temporal_facts.py part10/payments.py part10/durable_runner.py part10/test_durable_runner.py
```

五个文件都列出来就行。今天不需要装新的包,也不调模型,**花费是 0**。我实跑时的版本:Python 3.12.13、pytest 9.1.1(2026 年 10 月在 PyPI 查到的最新版)。

## 默写一:`MemoryStore.write`

合上 Day 534,在一张白纸上(或者一个新文件里)写出 `write` 方法。它要按顺序做五件事:敏感字段直接拒绝;查出当前值;值一样就 NOOP;来源等级低于当前值就拒绝;插入新行,有旧值就把旧值标记为被替代。

写完对照下面的标准答案。这是 Day 534 `memory_store.py` 里的原文:

```python
# agent-zero-lab/part10/memory_store.py(节选:write 方法)
    def write(self, tenant: str, customer_id: str, kind: str, key: str, value: str,
              source: str = "extracted", importance: float | None = None,
              now: float | None = None) -> str:
        now = time.time() if now is None else now
        if key in FORBIDDEN_KEYS:
            return "REJECT"
        cur = self._current(tenant, customer_id, key, now)
        if cur and cur.value == value:
            return "NOOP"
        if cur and SOURCE_RANK[source] < SOURCE_RANK[cur.source]:
            return "REJECT"
        ttl = TTL[kind]
        imp = DEFAULT_IMPORTANCE[kind] if importance is None else importance
        new_id = self.db.execute(
            "INSERT INTO facts(tenant,customer_id,kind,key,value,source,created_at,expires_at,importance)"
            " VALUES(?,?,?,?,?,?,?,?,?)",
            (tenant, customer_id, kind, key, value, source, now,
             None if ttl is None else now + ttl, imp)).lastrowid
        if cur:
            self.db.execute("UPDATE facts SET superseded_by=? WHERE id=?", (new_id, cur.id))
            return "UPDATE"
        return "ADD"
```

<div class="line-notes">

- `now: float | None = None) -> str:` 时间可以从外面传进来。Day 534 这么设计是为了测试能「快进」到 31 天后;今天你会看到它的第二个用处:让持久化运行器把时间记进日志。
- `now = time.time() if now is None else now` 没传就读当前时钟。
- `if key in FORBIDDEN_KEYS:` 第一道检查,卡号、密码、身份证号这些键,不管来源多高都不收。放在最前面,连数据库都不碰。
- `cur = self._current(tenant, customer_id, key, now)` 查这个客户这个键的当前值:没被替代、没删、没过期的那一行。
- `if cur and cur.value == value:` 值没变就什么也不做。今天的小项目里,这一行意外地充当了幂等去重,后面会看到。
- `if cur and SOURCE_RANK[source] < SOURCE_RANK[cur.source]:` 来源等级:业务系统 3 > 客服确认 2 > 模型抽取 1。模型抽出来的不能覆盖客服确认过的。
- `ttl = TTL[kind]` 按类型查有效期,`situation`(当前问题)30 天,`preference` 永久(None)。
- `None if ttl is None else now + ttl, imp)).lastrowid` 算出过期时间;`lastrowid` 是刚插入那行的自增 id,下面要用它标记旧值。
- `self.db.execute("UPDATE facts SET superseded_by=? WHERE id=?", (new_id, cur.id))` 旧值不删,只记下「被哪一行替代了」。历史还在,这是和事件溯源同一个想法。
- `return "ADD"` 四种结果全都是字符串,调用方(还有评测脚本)按它统计。

</div>

检查你的默写对不对,用一个不依赖任何外部东西的小脚本。新建 `part10/check_write.py`:

```python
# agent-zero-lab/part10/check_write.py
from memory_store import DAY, MemoryStore

s = MemoryStore()
T, C, now = "cloudledger", "C007", 1_790_000_000.0
cases = [
    (("preference", "contact_channel", "邮件", "extracted"), "ADD"),
    (("preference", "contact_channel", "邮件", "extracted"), "NOOP"),
    (("preference", "contact_channel", "电话", "agent_confirmed"), "UPDATE"),
    (("preference", "contact_channel", "微信", "extracted"), "REJECT"),
    (("profile", "card_number", "6222 0000 1111", "system"), "REJECT"),
]
for (kind, key, value, source), want in cases:
    got = s.write(T, C, kind, key, value, source=source, now=now)
    print("ok " if got == want else "BAD", key, value, source, "->", got)
s.write(T, C, "situation", "open_issue", "9 月重复扣款", now=now)
print("31 天后还记得 open_issue 吗:", [f.key for f in s.recall(T, C, now=now + 31 * DAY)])
```

<div class="line-notes">

- `s = MemoryStore()` 不传路径,默认 `:memory:`,检查脚本跑完就扔。
- `T, C, now = "cloudledger", "C007", 1_790_000_000.0` 固定一个时间,结果才可复现。数字里的下划线只是为了好读,和 JS 的 `1_790_000_000` 一样。
- `(("preference", "contact_channel", "邮件", "extracted"), "NOOP"),` 和上一条完全一样,应该是 NOOP。
- `(("preference", "contact_channel", "电话", "agent_confirmed"), "UPDATE"),` 来源从 1 升到 2,可以覆盖。
- `(("preference", "contact_channel", "微信", "extracted"), "REJECT"),` 现在的值是客服确认过的「电话」,模型抽出来的「微信」不能覆盖它。
- `(("profile", "card_number", "6222 0000 1111", "system"), "REJECT"),` 敏感字段,连业务系统写都不行。
- `for (kind, key, value, source), want in cases:` 解构嵌套的元组,相当于 JS 的 `for (const [[kind, key, value, source], want] of cases)`。
- `print("31 天后还记得 open_issue 吗:", [f.key for f in s.recall(T, C, now=now + 31 * DAY)])` 当前问题 30 天过期,31 天后的 recall 里应该只剩联系方式。

</div>

```bash
uv run python part10/check_write.py
```

```text
ok  contact_channel 邮件 extracted -> ADD
ok  contact_channel 邮件 extracted -> NOOP
ok  contact_channel 电话 agent_confirmed -> UPDATE
ok  contact_channel 微信 extracted -> REJECT
ok  card_number 6222 0000 1111 system -> REJECT
31 天后还记得 open_issue 吗: ['contact_channel']
```

你把自己默写的 `write` 换进 `memory_store.py` 再跑一次,六行都对才算过。最常见的错是把来源检查和 NOOP 检查的顺序写反:那样「电话」那条之后再写一次「电话」(来源 extracted),会被判成 REJECT 而不是 NOOP。结果对调用方影响不大,但评测统计会算错。

## 默写二:`DurableRun.step`

合上 Day 537,写出完整版的 `step`:序号加一;算指纹;查日志;日志里有,指纹不对就抛错,对就重放;日志里没有,执行、(测试开关)自杀、写日志、计数。

标准答案是 `durable_runner.py` 里这一段:

```python
# agent-zero-lab/part10/durable_runner.py(节选:step 方法)
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
```

<div class="line-notes">

- `def step(self, name: str, fn: Callable[..., Any], *args: Any) -> Any:` 收的是函数本身和参数,不是函数的结果。只有这样,`step` 才有机会**不调用**它(Day 535)。
- `self.seq += 1` 第几次调 `step` 就是第几步,所以步骤顺序必须稳定。
- `fp = fingerprint(name, args)` 名字加参数的哈希(Day 536)。
- `if row[1] != fp:` 日志里记的和代码这次要做的不是同一件事,大声报错,不悄悄用错结果。
- `return json.loads(row[2])` 重放:返回日志里的结果,`fn` 根本没被调。
- `result = fn(*args)` 日志里没有,真正执行。
- `if self.crash_at == self.seq:` 崩溃注入:执行完、写日志前,最坏的时刻(Day 537)。
- `self.j.put(self.run_id, self.seq, name, fp, result)` 写日志并 commit,返回了才算这一步完成。

</div>

检查用 Day 537 的测试,它会在四个步骤各真杀一次进程:

```bash
uv run pytest part10/test_durable_runner.py -q
```

```text
......                                                                   [100%]
6 passed in 1.09s
```

默写时最容易漏的是两处。一是把 `put` 写在 `return result` 之后(根本执行不到),或者写成先 `put` 再 `fn`(变成「日志说做了,其实没做」)。二是重放分支里忘了检查指纹,直接 `return`,那 `test_changed_code_is_detected` 会失败。

## 本周小项目:记得住客户、又不怕重启的退款流程

两条线拼到一起。场景还是 C007 的重复扣款,流程六步:

1. `clock.now`:取「现在」,整次运行都用这一个时间;
2. `memory.recall`:读客户记忆,比如他偏好用邮件联系;
3. `tool.list_invoices`:查发票;
4. `tool.create_refund`:退后一张,带幂等键;
5. `memory.write`:把「最近一次退款」写进记忆,下次对话时 Agent 能想起来;
6. `llm.reply`:按记忆里的联系方式写回复。

为了能用崩溃注入在每一步各杀一次,模型还是用假函数,今天不花钱。

### 先种一条记忆

客户之前在对话里说过「以后用邮件联系我」,客服确认过。新建 `part10/seed77.py`:

```python
# agent-zero-lab/part10/seed77.py
import os

from memory_store import MemoryStore

store = MemoryStore(os.environ.get("MEMORY_DB", "part10/memory77.db"))
print(store.write("cloudledger", "C007", "preference", "contact_channel", "邮件", source="agent_confirmed"))
store.db.commit()
```

<div class="line-notes">

- `store = MemoryStore(os.environ.get("MEMORY_DB", "part10/memory77.db"))` 这次用文件,因为要跨进程:种数据是一个进程,跑流程是另一个,被杀后恢复又是一个。路径也能用环境变量换,测试要用。
- `print(store.write("cloudledger", "C007", "preference", "contact_channel", "邮件", source="agent_confirmed"))` 联系方式偏好,客服确认过(来源等级 2),永久有效。
- `store.db.commit()` 这一行很要紧,下面「本周错题」第一条专门讲。

</div>

### 流程本身

新建 `part10/review77.py`:

```python
# agent-zero-lab/part10/review77.py
"""第 77 周小项目:跑在持久化运行器上的退款流程,开始读客户记忆,结束写回记忆。"""
import json
import os
import sys

from durable_runner import DurableRun, Journal
from memory_store import MemoryStore
from payments import create_refund

store = MemoryStore(os.environ.get("MEMORY_DB", "part10/memory77.db"))
TENANT, CID = "cloudledger", "C007"


def recall(customer_id: str, now: float) -> list[dict]:
    return [{"key": f.key, "value": f.value} for f in store.recall(TENANT, customer_id, now=now)]


def list_invoices(customer_id: str) -> list[dict]:
    return [{"id": "INV-2290", "amount": 468}, {"id": "INV-2291", "amount": 468}]


def remember(customer_id: str, key: str, value: str, now: float) -> str:
    op = store.write(TENANT, customer_id, "episode", key, value, source="system", now=now)
    store.db.commit()  # Day 534 的 MemoryStore 不提交,换成文件后必须自己 commit
    return op


def write_reply(memories: list[dict], refund_id: str) -> str:
    channel = next((m["value"] for m in memories if m["key"] == "contact_channel"), "站内信")
    return f"[{channel}] 多扣的 468 元已退回,退款单号 {refund_id}"


def workflow(run: DurableRun) -> dict:
    now = run.now()
    memories = run.step("memory.recall", recall, CID, now)
    invoices = run.step("tool.list_invoices", list_invoices, CID)
    dup = invoices[-1]
    refund = run.step("tool.create_refund", create_refund, dup["id"], dup["amount"], run.idempotency_key())
    op = run.step("memory.write", remember, CID, "last_refund", f"{refund['refund_id']} {dup['id']} 468", now)
    reply = run.step("llm.reply", write_reply, memories, refund["refund_id"])
    return {"memories": len(memories), "refund_id": refund["refund_id"], "memory_op": op, "reply": reply}


if __name__ == "__main__":
    run = DurableRun(Journal(), sys.argv[1])
    print(json.dumps(workflow(run), ensure_ascii=False))
    print(f"重放 {run.replayed} 步,真正执行 {run.executed} 步")
```

<div class="line-notes">

- `store = MemoryStore(os.environ.get("MEMORY_DB", "part10/memory77.db"))` 和 `seed77.py` 同一个文件。
- `def recall(customer_id: str, now: float) -> list[dict]:` 读记忆。`store.recall` 返回的是 `Fact` 对象(dataclass),转不了 JSON,所以只取 `key` 和 `value` 两个字段做成 dict。这和 Day 537 的 `chat` 整理 openai 响应是同一个原因。
- `def remember(customer_id: str, key: str, value: str, now: float) -> str:` 写记忆。种类用 `episode`(情景记忆,Day 532:发生过的事,有时间),来源是 `system`,因为退款结果来自支付系统,是事实,不是模型猜的。
- `store.db.commit()  # Day 534 的 MemoryStore 不提交,换成文件后必须自己 commit` Day 534 的 `write` 只 `execute` 不 `commit`,在 `:memory:` 下无所谓,换成文件就是另一回事了。
- `channel = next((m["value"] for m in memories if m["key"] == "contact_channel"), "站内信")` `next(生成器, 默认值)` 取第一个符合条件的,没有就用默认值,相当于 JS 的 `memories.find(m => m.key === "contact_channel")?.value ?? "站内信"`。
- `now = run.now()` 第 1 步。整次运行用同一个时间,读记忆和写记忆都用它(Day 536 练习 1 的结论)。
- `memories = run.step("memory.recall", recall, CID, now)` 第 2 步。**读记忆也走 step**,恢复时重放出第一次读到的记忆,哪怕数据库里已经多了别的。练习 1 会演示不这么做的后果。
- `refund = run.step("tool.create_refund", create_refund, dup["id"], dup["amount"], run.idempotency_key())` 第 4 步,和 Day 537 的 `refund_flow.py` 一样。
- `op = run.step("memory.write", remember, CID, "last_refund", f"{refund['refund_id']} {dup['id']} 468", now)` 第 5 步。值里带上退款单号,同一次运行算出来的值总是一样的。
- `reply = run.step("llm.reply", write_reply, memories, refund["refund_id"])` 第 6 步,参数里有记忆,所以记忆也进了这一步的指纹。

</div>

在第 5 步(写记忆)执行完、写日志前杀掉,看记忆库,再恢复两次:

```bash
rm -f part10/journal.db part10/payments.db part10/memory77.db
uv run python part10/seed77.py
DURABLE_CRASH_AT=5 uv run python part10/review77.py run-1; echo "exit=$?"
sqlite3 part10/memory77.db "SELECT key, value FROM facts"
uv run python part10/review77.py run-1
uv run python part10/review77.py run-1
sqlite3 part10/memory77.db "SELECT key, value, superseded_by FROM facts"
sqlite3 part10/payments.db "SELECT * FROM refunds"
sqlite3 part10/journal.db "SELECT seq, name FROM steps"
```

```text
ADD
exit=137
contact_channel|邮件
last_refund|RF-1 INV-2291 468
{"memories": 1, "refund_id": "RF-1", "memory_op": "NOOP", "reply": "[邮件] 多扣的 468 元已退回,退款单号 RF-1"}
重放 4 步,真正执行 2 步
{"memories": 1, "refund_id": "RF-1", "memory_op": "NOOP", "reply": "[邮件] 多扣的 468 元已退回,退款单号 RF-1"}
重放 6 步,真正执行 0 步
contact_channel|邮件|
last_refund|RF-1 INV-2291 468|
RF-1|INV-2291|468|run-1-4
1|clock.now
2|memory.recall
3|tool.list_invoices
4|tool.create_refund
5|memory.write
6|llm.reply
```

一段一段看。

被杀时,`last_refund` 已经进了记忆库(第 5 步执行完了),但日志里没有第 5 步。恢复时前 4 步重放,第 5 步再执行一次 `remember`。这时记忆库里已经有一模一样的值,`write` 返回 **NOOP**,没有插第二行。Day 534 写那一行 `if cur and cur.value == value: return "NOOP"` 的时候,想的是「客户重复说同一件事」,没想到它在这里成了副作用的幂等去重。这是巧合吗?不完全是:只要写入是「把某个键设成某个值」,而不是「追加一条」,它就天然幂等,和 Day 537 的 `restore_subscription` 一个道理。

第二个要看的是 `"memories": 1`。恢复时,记忆库里明明已经有两条(联系方式和最近一次退款),流程看到的还是 1 条,因为第 2 步 `memory.recall` 是重放的,拿的是第一次读到的结果。回复按「邮件」来写,和第一次的决定一致。这正是我们要的:一次运行从头到尾活在同一份记忆快照里。

最后,支付系统里一笔,日志里六步,记忆库里 `last_refund` 一条、没有被替代的旧值。

### 在每一步都杀一次

和 Day 537 一样写成崩溃注入测试。新建 `part10/test_review77.py`:

```python
# agent-zero-lab/part10/test_review77.py
import json
import os
import sqlite3
import subprocess
import sys

import pytest

HERE = os.path.dirname(__file__)


def run(env: dict, *args: str, crash_at: int | None = None) -> subprocess.CompletedProcess:
    e = {**env, "DURABLE_CRASH_AT": str(crash_at)} if crash_at else env
    return subprocess.run([sys.executable, os.path.join(HERE, args[0]), *args[1:]],
                          env=e, capture_output=True, text=True)


@pytest.mark.parametrize("crash_at", [1, 2, 3, 4, 5, 6])
def test_one_refund_one_memory(tmp_path, crash_at):
    env = {**os.environ, "JOURNAL_DB": str(tmp_path / "j.db"), "PAYMENTS_DB": str(tmp_path / "p.db"),
           "MEMORY_DB": str(tmp_path / "m.db")}
    run(env, "seed77.py")
    assert run(env, "review77.py", "run-1", crash_at=crash_at).returncode == -9
    done = run(env, "review77.py", "run-1")
    out = json.loads(done.stdout.splitlines()[0])
    assert out["reply"].startswith("[邮件]")  # 恢复后仍按第一次读到的记忆回复
    refunds = sqlite3.connect(tmp_path / "p.db").execute("SELECT count(*) FROM refunds").fetchone()[0]
    facts = sqlite3.connect(tmp_path / "m.db").execute(
        "SELECT count(*) FROM facts WHERE key='last_refund'").fetchone()[0]
    assert (refunds, facts) == (1, 1)
```

<div class="line-notes">

- `def run(env: dict, *args: str, crash_at: int | None = None) -> subprocess.CompletedProcess:` 比 Day 537 的 `run_flow` 更通用:第一个参数是脚本名,后面是脚本的参数。`*args` 收集任意个位置参数(Day 30),`crash_at` 写在它后面,调用时必须写成 `crash_at=3` 这种关键字形式。
- `e = {**env, "DURABLE_CRASH_AT": str(crash_at)} if crash_at else env` 要注入崩溃就复制一份加上开关,否则原样用。
- `return subprocess.run([sys.executable, os.path.join(HERE, args[0]), *args[1:]],` `*args[1:]` 把剩下的参数展开放进列表,相当于 JS 的 `[...args.slice(1)]`。
- `@pytest.mark.parametrize("crash_at", [1, 2, 3, 4, 5, 6])` 六步各死一次。
- `"MEMORY_DB": str(tmp_path / "m.db")}` 三个数据库全部指向临时目录:日志、支付、记忆。
- `run(env, "seed77.py")` 每个用例先种好那条「邮件」偏好。
- `assert out["reply"].startswith("[邮件]")  # 恢复后仍按第一次读到的记忆回复` 不管在哪一步死,回复都要用对联系方式。
- `assert (refunds, facts) == (1, 1)` 退款一笔,`last_refund` 一条。把两个数放进一个元组一起比,失败时一眼能看出是哪一个不对。

</div>

```bash
uv run pytest part10/test_review77.py -q
```

```text
......                                                                   [100%]
6 passed in 2.44s
```

### 零件和大代码的对照

| 本周学的零件 | 在 `review77.py` 里是哪一段 |
| --- | --- |
| Day 532 情景记忆 | `remember` 里的种类 `"episode"`:「最近一次退款」是发生过的事 |
| Day 532 谁来写 | 来源 `source="system"`:退款结果来自支付系统,不是模型抽取的 |
| Day 534 `MemoryStore.write` 的 NOOP | 第 5 步被杀后重做,记忆没有多一条 |
| Day 534 `recall` 按重要性和时间排序 | `recall` 函数,第 2 步 |
| Day 535 记日志、重放 | 整个 `workflow`,每个动作都经过 `run.step` |
| Day 536 一切不确定的都要记 | `run.now()`,以及读记忆也走 `step` |
| Day 536 幂等键 | `run.idempotency_key()`,第 4 步 |
| Day 537 崩溃注入 | `test_review77.py` 的 `crash_at` 1 到 6 |

Day 533 的带时间的事实和 Day 537 的 Saga 补偿,这个流程里没用上,练习 3 单独默写 `as_of`。

## 本周错题与坑清单

下面这些是本周最容易出错的地方,能复现的我都在本机复现过。

**`MemoryStore` 换成文件后不 commit,记忆写了等于没写。** 这是今天拼项目时才发现的。Day 534 的 `write` 只 `execute` 不 `commit`,在默认的 `:memory:` 下测试全过;Day 534 的逐行讲解里说「传一个文件路径就会落盘」,只说对了一半。我把 `review77.py` 里 `remember` 的 `commit` 注释掉再跑:

```text
{"memories": 1, "refund_id": "RF-1", "memory_op": "ADD", "reply": "[邮件] 多扣的 468 元已退回,退款单号 RF-1"}
重放 0 步,真正执行 6 步
contact_channel
```

流程说 `ADD`,进程正常退出,记忆库里却只有种进去的那条 `contact_channel`。Python 的 `sqlite3` 在连接关闭时会回滚没提交的事务(Day 93),正常退出也一样。更糟的是,日志里第 5 步记着 `ADD`,以后重放都会说「写成功了」。`test_review77.py` 在这种情况下 `[5]`、`[6]` 两个用例失败(`assert (1, 0) == (1, 1)`),其他四个用例因为恢复那次也没提交,也一起失败,6 个全红。修法就是今天的写法:谁打开的文件数据库,谁负责 commit;或者给 `MemoryStore.write` 本身加一行 `self.db.commit()`。

**模型的决定没走 `step`。** Day 536 的 `durable_drift.py`:重启后决定变了,运行器按序号把发票当成知识库结果返回,没有任何报错。今天练习 1 是它的记忆版本。

**以为 `temperature=0` 就是确定的。** Day 536 实测,同一个提示词问 6 遍,4 种说法。

**幂等键每次现生成一个 uuid。** Day 536 练习 2:退了两笔;成功以后再跑一次,参数变了,报 `NonDeterminismError`。

**幂等键只用运行 id,同一张工单开了两个运行。** 运行 id + 步骤序号只能防「同一次运行重放」,防不住「同一张工单被处理了两次」,比如 webhook 重发、客户点了两次。练习 2 实测退了两笔,换成 Day 390 那种按业务含义算的键才对。

**崩溃注入断言 `returncode == 137`。** shell 里是 137,`subprocess` 里是 `-9`。

**业务失败用异常表示。** 那一步不进日志,恢复时重新执行,条件变了就走出另一条路。Day 537 的 `create_subscription` 返回 `{"ok": False}` 就是为这个。

**`step` 返回 SDK 对象或 dataclass。** `json.dumps` 直接报 `TypeError: Object of type ChatCompletionMessage is not JSON serializable`。今天的 `recall` 把 `Fact` 转成 dict 也是同一个原因。

**记忆里存业务系统能查到的东西。** Day 532 说过:套餐类型业务系统里有,记忆里再存一份只会制造不一致。今天的 `last_refund` 有点擦边:退款记录支付系统里也查得到。我留着它,是因为它的用途是「下一次对话开头就提醒模型这个客户刚退过款」,而不是当作退款的权威记录;真要判断退没退过,还是去查支付系统。

## 动手练习

### 练习 1:读记忆不走 `step`

把 `review77.py` 的工作流复制一份,只改一处:`memories = recall(CID, now)`,不经过 `run.step`。在第 5 步(这个版本里是 `llm.reply`,因为少了一步)执行完、写日志前杀掉,再恢复,对比不杀时的输出。想一想,如果回复是真的模型写的,会出什么事。

<details><summary>参考答案</summary>

新建 `part10/ex538_recall_outside.py`:

```python
# agent-zero-lab/part10/ex538_recall_outside.py
import json
import sys

from durable_runner import DurableRun, Journal
from payments import create_refund
from review77 import CID, list_invoices, recall, remember, write_reply


def workflow_bad(run: DurableRun) -> dict:
    now = run.now()
    memories = recall(CID, now)  # 错误示范:读记忆没走 step
    invoices = run.step("tool.list_invoices", list_invoices, CID)
    dup = invoices[-1]
    refund = run.step("tool.create_refund", create_refund, dup["id"], dup["amount"], run.idempotency_key())
    run.step("memory.write", remember, CID, "last_refund", f"{refund['refund_id']} {dup['id']} 468", now)
    reply = run.step("llm.reply", write_reply, memories, refund["refund_id"])
    return {"memories": [m["key"] for m in memories], "reply": reply}


run = DurableRun(Journal(), sys.argv[1])
print(json.dumps(workflow_bad(run), ensure_ascii=False))
```

<div class="line-notes">

- `from review77 import CID, list_invoices, recall, remember, write_reply` 直接复用小项目的函数。`review77.py` 的运行代码在 `if __name__ == "__main__":` 下,导入时不会跑。
- `memories = recall(CID, now)  # 错误示范:读记忆没走 step` 每次运行都现读数据库。
- `return {"memories": [m["key"] for m in memories], "reply": reply}` 输出读到了哪些键,方便对比。

</div>

```bash
rm -f part10/journal.db part10/payments.db part10/memory77.db
uv run python part10/seed77.py
uv run python part10/ex538_recall_outside.py run-ok
rm -f part10/journal.db part10/payments.db part10/memory77.db
uv run python part10/seed77.py
DURABLE_CRASH_AT=5 uv run python part10/ex538_recall_outside.py run-x; echo "exit=$?"
uv run python part10/ex538_recall_outside.py run-x
```

不杀的那次(`seed77.py` 打印的 `ADD` 省略了):

```text
{"memories": ["contact_channel"], "reply": "[邮件] 多扣的 468 元已退回,退款单号 RF-1"}
```

在第 5 步杀掉再恢复:

```text
exit=137
{"memories": ["contact_channel", "last_refund"], "reply": "[邮件] 多扣的 468 元已退回,退款单号 RF-1"}
```

同一个流程,不崩溃时回复看到的记忆是 1 条,崩溃恢复后是 2 条,多出来的 `last_refund` 是**这次运行自己刚写进去的**。没有报错,因为回复那一步在崩溃时没进日志,恢复时是第一次记录,指纹无从比对。

假函数只用了联系方式,所以回复碰巧一样。换成真的模型,它会在上下文里看到「最近一次退款:RF-1 INV-2291 468」,很可能写出「您之前已经退过一次款了,这次……」,把刚办完的这一笔当成历史。正确的写法就是正文那样,读记忆也走 `step`,一次运行只读一次、读到什么就是什么。

</details>

### 练习 2:同一张工单开了两个运行

假设 webhook 重发,工单 T-1042 被处理了两次,开了 `run-1` 和 `run-2` 两个运行。用运行 id + 步骤序号做幂等键,看会退几笔;再换成 Day 390 那种业务键 `refund:{工单号}:{发票号}`,再看。

<details><summary>参考答案</summary>

新建 `part10/ex538_business_key.py`:

```python
# agent-zero-lab/part10/ex538_business_key.py
import sys

from durable_runner import DurableRun, Journal
from payments import create_refund, db
from review77 import CID, list_invoices

TICKET = "T-1042"  # 客户提交的那张工单


def refund_flow(run: DurableRun, use_business_key: bool) -> str:
    invoices = run.step("tool.list_invoices", list_invoices, CID)
    dup = invoices[-1]
    key = f"refund:{TICKET}:{dup['id']}" if use_business_key else run.idempotency_key()
    return run.step("tool.create_refund", create_refund, dup["id"], dup["amount"], key)["refund_id"]


mode = sys.argv[1] == "business"
j = Journal()
for run_id in ["run-1", "run-2"]:  # 同一张工单被处理了两次:比如 webhook 重发,开了两个运行
    print(run_id, "->", refund_flow(DurableRun(j, f"{sys.argv[1]}-{run_id}"), mode))
print("这张发票一共退了", db.execute("SELECT count(*) FROM refunds WHERE invoice_id='INV-2291'").fetchone()[0], "笔")
```

<div class="line-notes">

- `TICKET = "T-1042"  # 客户提交的那张工单` 业务上真正「同一件事」的标识是工单,不是运行。
- `key = f"refund:{TICKET}:{dup['id']}" if use_business_key else run.idempotency_key()` 两种键:业务键由工单号和发票号算出;运行键由运行 id 和步骤序号算出。
- `for run_id in ["run-1", "run-2"]:  # 同一张工单被处理了两次:比如 webhook 重发,开了两个运行` 模拟同一张工单开了两个运行。
- `print(run_id, "->", refund_flow(DurableRun(j, f"{sys.argv[1]}-{run_id}"), mode))` 运行 id 带上模式前缀,两种模式的日志互不干扰。

</div>

```bash
rm -f part10/journal.db part10/payments.db
uv run python part10/ex538_business_key.py run
rm -f part10/journal.db part10/payments.db
uv run python part10/ex538_business_key.py business
```

```text
run-1 -> RF-1
run-2 -> RF-2
这张发票一共退了 2 笔
```

```text
run-1 -> RF-1
run-2 -> RF-1
这张发票一共退了 1 笔
```

运行键只认「这次运行的这一步」,两个运行是两件事,退了两笔。业务键认的是「这张工单对这张发票的退款」,第二个运行拿到的是第一个的 RF-1。

所以两种键各管一层:运行键防的是「同一次运行重放」,不需要懂业务,运行器自动给;业务键防的是「同一件事被发起了两次」,得由懂业务的工具层来算。退款这种动作,生产上用业务键更稳,它同时覆盖了两种情况。另一种做法是在入口就去重,同一张工单只允许开一个运行(Day 388 的 `_job_id`)。

</details>

### 练习 3:默写 `as_of`

合上 Day 533,默写 `temporal_facts.py` 里的 `Edge`、`add_fact`、`as_of`:新事实加入时,让同一主语同一关系的旧事实在新事实开始那天失效;查询某一天时,返回那天有效的值。然后用一个检查脚本验证四个日期。

<details><summary>参考答案</summary>

标准答案是 Day 533 的原文:

```python
# agent-zero-lab/part10/temporal_facts.py
from dataclasses import dataclass
from datetime import date


@dataclass
class Edge:  # 图里的一条边:主语 -关系-> 宾语,外加两个时间
    subject: str
    relation: str
    obj: str
    valid_at: date
    invalid_at: date | None = None


edges: list[Edge] = []


def add_fact(subject: str, relation: str, obj: str, valid_at: date) -> None:
    for e in edges:  # 同一主语同一关系的旧事实,让它在新事实开始那天失效
        if e.subject == subject and e.relation == relation and e.invalid_at is None:
            e.invalid_at = valid_at
    edges.append(Edge(subject, relation, obj, valid_at))


def as_of(subject: str, relation: str, day: date) -> str | None:
    for e in edges:
        if e.subject == subject and e.relation == relation and e.valid_at <= day \
                and (e.invalid_at is None or day < e.invalid_at):
            return e.obj
    return None
```

<div class="line-notes">

- `class Edge:  # 图里的一条边:主语 -关系-> 宾语,外加两个时间` Graphiti 的思路:事实是一条边,带「从哪天开始成立」和「到哪天失效」。
- `invalid_at: date | None = None` 还没失效就是 None。有默认值的字段要放在最后(dataclass 的规则,Day 50)。
- `if e.subject == subject and e.relation == relation and e.invalid_at is None:` 只处理还有效的那条,已经失效的不动。
- `e.invalid_at = valid_at` 旧事实不删,只记下失效日期,和 `MemoryStore` 的 `superseded_by` 是同一个想法。
- `if e.subject == subject and e.relation == relation and e.valid_at <= day \` 行尾的 `\` 表示这一行没写完,下一行接着。条件是「那天已经开始成立」。
- `and (e.invalid_at is None or day < e.invalid_at):` 并且「那天还没失效」。失效那天本身已经不算,所以是 `<` 不是 `<=`。

</div>

检查脚本 `part10/check_asof.py`:

```python
# agent-zero-lab/part10/check_asof.py
from datetime import date

from temporal_facts import add_fact, as_of, edges

add_fact("C007", "订阅", "年付专业版", date(2026, 1, 15))
add_fact("C007", "订阅", "月付基础版", date(2026, 10, 20))
checks = [(date(2026, 1, 1), None), (date(2026, 9, 3), "年付专业版"),
          (date(2026, 10, 20), "月付基础版"), (date(2026, 10, 22), "月付基础版")]
for day, want in checks:
    got = as_of("C007", "订阅", day)
    print("ok " if got == want else "BAD", day, "->", got)
print("旧事实的 invalid_at:", edges[0].invalid_at)
```

<div class="line-notes">

- `from temporal_facts import add_fact, as_of, edges` Day 533 的演示代码在 `if __name__ == "__main__":` 下,导入时 `edges` 是空的。
- `checks = [(date(2026, 1, 1), None), (date(2026, 9, 3), "年付专业版"),` 四个日期:第一条事实之前、9 月扣款那天、换套餐当天、今天。
- `(date(2026, 10, 20), "月付基础版"), (date(2026, 10, 22), "月付基础版")]` 换套餐当天就算新套餐,这一条专门检查 `<` 写没写成 `<=`。

</div>

```bash
uv run python part10/check_asof.py
```

```text
ok  2026-01-01 -> None
ok  2026-09-03 -> 年付专业版
ok  2026-10-20 -> 月付基础版
ok  2026-10-22 -> 月付基础版
旧事实的 invalid_at: 2026-10-20
```

如果你把 `day < e.invalid_at` 写成了 `<=`,10 月 20 日那一行会返回「年付专业版」:循环先遇到旧事实,它在失效当天还被当成有效。

</details>

### 练习 4:去掉 commit,让测试变红

把 `review77.py` 里 `remember` 函数的 `store.db.commit()` 注释掉,跑 `test_review77.py`,看几个用例失败、失败信息是什么。然后改回来。

<details><summary>参考答案</summary>

```bash
uv run pytest part10/test_review77.py -q
```

我实跑的结果是 6 个全部失败,摘两行:

```text
FAILED part10/test_review77.py::test_one_refund_one_memory[5] - assert (1, 0)...
FAILED part10/test_review77.py::test_one_refund_one_memory[6] - assert (1, 0)...
6 failed in 2.77s
```

`(1, 0)`:退款一笔是对的,记忆零条。不只是崩溃的那几个用例,恢复那次正常跑完的进程也没提交,连接关闭时事务被回滚,所以 6 个全红。这说明一件事:持久化执行保证的是**日志**落盘,工具函数自己写的数据库,要工具自己负责提交。运行器的日志写着「第 5 步 ADD」,记忆库里却什么都没有,两边对不上,这类 bug 只有去「对方系统」里查事实才抓得到,所以测试里我们总是直接打开数据库数行数。改回 `store.db.commit()` 后,6 个全绿。

</details>

**验收标准**:`check_write.py` 六行都是 ok,且用的是你自己默写的 `write`;`test_durable_runner.py` 6 个全绿,且用的是你自己默写的 `step`;`review77.py` 在第 5 步被杀后恢复,输出 `memory_op` 是 NOOP、`memories` 是 1;`test_review77.py` 6 个全绿;能不看文章说出「读记忆为什么也要走 step」和「运行键和业务键各防什么」。

## 名词解释

今天没有新术语,下面是本周的术语汇总,方便你对照着自测。

| 名词 | 意思 |
| --- | --- |
| 工作记忆 / 情景记忆 / 语义记忆 / 程序记忆 | CoALA 的四类记忆:上下文里的、发生过的事、关于客户的事实、怎么做事的规则(Day 532) |
| 热路径写入 / 后台写入 | 对话中途由 Agent 调工具写,还是对话结束后由单独的流程抽取再写(Day 532) |
| 带时间的事实 | 一条事实带「从哪天开始成立」和「到哪天失效」,能查任意一天的值(Day 533) |
| 来源优先级 | 业务系统 > 客服确认 > 模型抽取,低的不能覆盖高的(Day 534) |
| 准确率 / 召回率 | 写进去的有多少是对的 / 该写的有多少写进去了(Day 534) |
| 事件溯源 | 不存当前状态,只追加事件,状态由事件折叠出来(Day 535) |
| 重放 replay | 重新运行代码时,日志里已有的步骤直接取结果,不执行(Day 535) |
| 步骤指纹 | 步骤名字加参数的哈希,重放时比对,对不上抛 NonDeterminismError(Day 536) |
| 幂等键 | 有副作用的调用带上的确定性的键,对方按键去重(Day 536) |
| 效果上恰好一次 | 至少执行一次加幂等去重(Day 536) |
| 崩溃注入 | 在指定位置故意让进程崩溃来测试恢复(Day 537) |
| Saga / 补偿 | 每个有副作用的步骤配一个反方向的动作,失败时倒着执行(Day 537) |
| 运行键 / 业务键 | 由运行 id 和步骤序号算出的键 / 由业务含义(工单号、发票号)算出的键,今天练习 2 的叫法 |

## 常见误区

**把记忆和执行日志当成一回事。** 记忆是给下一次对话的模型挑着用的,可以忘、可以被替代;执行日志是给重启后的运行器用的,一步都不能少、不能改。用记忆库存任务进度,或者用对话历史当长期记忆,两边的规则都会被破坏。

**以为工具函数里写的数据库也会被运行器「持久化」。** 运行器只保证日志落盘。工具自己打开的数据库要工具自己 commit,今天的 `MemoryStore` 就是例子。

**一次运行里多次读记忆。** 记忆在运行过程中会被这次运行自己改掉(今天第 5 步就写了一条),多次读会读到不一样的东西。一次运行在开头读一次,而且走 `step`。

**只有运行键就以为不会重复退款。** 运行键只防同一次运行的重放;同一张工单开了两个运行,得靠业务键或入口去重。

**默写时只背代码,不跑检查。** 今天两段默写都配了检查脚本或测试。没跑过检查的默写,错了也不知道。

## 学习资料

### 文档与文章

- [Temporal 文档:Event History](https://docs.temporal.io/encyclopedia/event-history):本周学的「执行日志」在一个真正的系统里长什么样,复习时对照 `steps` 表看一遍。
- [LangGraph 文档:Persistence](https://docs.langchain.com/oss/python/langgraph/persistence):checkpointer 管一次运行之内的状态,store 管跨会话的记忆。LangGraph 把这周的两条线放进了同一个框架里,正好用来检查你分没分清。
- [Brandur《Implementing Stripe-like Idempotency Keys in Postgres》](https://brandur.org/idempotency-keys):Day 536 推荐过,复习日适合把它读完,里面的「恢复点」和我们的步骤序号是同一个想法。
- [microservices.io:Saga 模式](https://microservices.io/patterns/data/saga.html):Day 537 的补偿,复习一遍编排式和协同式的区别。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1M2aB6MEVE&autoplay=0&high_quality=1" title="5.5 亿 E 轮拆解 Temporal：持久化执行如何拯救 AI Agent 长流程崩溃？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Product-x · 5.5 亿 E 轮拆解 Temporal:持久化执行如何拯救 AI Agent 长流程崩溃? · 8 分钟,从产品和行业角度讲持久化执行为什么在 Agent 时代变得重要。融资数字是视频作者说的,我没有核实。适合复习完本周后看看这件事在业界的位置,也为 Day 539 铺垫。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV15541147z3&autoplay=0&high_quality=1" title="[动画] 事件溯源(Event Sourcing),读写分离(CQRS)与事件驱动的设计(Event-Driven Design)" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>小马过河Vizit · [动画] 事件溯源、读写分离(CQRS)与事件驱动的设计 · Day 535 推荐过的 10 分钟动画,复习日再看一遍前半段,看你能不能边看边说出它和 `durable_runner.py` 的对应关系。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/w4spcXq5uCw" title="Why Every AI Agent Needs Durable Execution | Temporal, Samar Abbas" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Lightspeed Venture Partners · Why Every AI Agent Needs Durable Execution · Temporal 联合创始人 Samar Abbas 的访谈,英文。听他怎么讲「Agent 的状态」,对照本周的两条线。</figcaption>
</figure>

### 书籍

- Martin Kleppmann《Designing Data-Intensive Applications》(O'Reilly,2017;中文版《数据密集型应用系统设计》,中国电力出版社)第 11 章:事件日志、幂等、恰好一次,本周后三天的原理基本都在这一章。
- Chip Huyen《AI Engineering》(O'Reilly,2025):讲 Agent 的章节里有记忆的分类和取舍,可以和 Day 532 的四类记忆对照。

### 开源项目与代码

- [dbos-inc/dbos-transact-py](https://github.com/dbos-inc/dbos-transact-py):README 的例子和你今天默写的 `step` 结构几乎一样,对照看能加深印象。
- [temporalio/samples-python](https://github.com/temporalio/samples-python):`replay` 目录演示怎么用历史日志测新代码,是 Day 536 指纹检查的工业版。

## 自测

1. 记忆和执行日志都用 SQLite、都「只追加不改旧的」,它们的区别是什么?

<details><summary>答案</summary>

记忆是给下一次对话的模型用的,跨会话,可以挑、可以忘、可以被新值替代,要评测写得准不准;执行日志是给重启后的运行器用的,只在一次运行之内,一步都不能少、不能改,顺序必须稳定,对不上要报错。

</details>

2. 小项目里第 5 步写记忆执行完、写日志前被杀,恢复后为什么记忆没有多一条?

<details><summary>答案</summary>

恢复时第 5 步会再执行一次 `remember`,但记忆库里已经有一样的值,`MemoryStore.write` 的「值相同就 NOOP」让它什么都没插。只要写入是「把某个键设成某个值」而不是「追加一条」,它就天然幂等。前提是第一次写入真的 commit 了。

</details>

3. 为什么读记忆也要走 `step`?

<details><summary>答案</summary>

记忆在运行过程中会变,这次运行自己就会写入。不走 `step` 的话,崩溃恢复后再读,会读到这次运行自己刚写的「最近一次退款」,模型可能把刚办完的退款当成历史。走 `step` 的话,恢复时重放出第一次读到的结果,一次运行从头到尾用同一份记忆。

</details>

4. 运行键和业务键各防什么?

<details><summary>答案</summary>

运行键(运行 id + 步骤序号)防同一次运行重放时重复执行副作用,运行器自动给,不懂业务;业务键(比如工单号 + 发票号)防同一件事被发起了两次,比如 webhook 重发开了两个运行,要由工具层按业务含义算。退款这类动作用业务键更稳,它同时覆盖两种情况。

</details>

5. 面试题:「你们的客服 Agent 既有长期记忆,又要处理跑几个小时的退款流程。说说这两块状态你怎么存、怎么保证一致。」

<details><summary>答案</summary>

要点:分两块讲。长期记忆按情景和语义分类,工单结束后后台抽取写入,写入规则是确定性代码(敏感字段拒绝、来源优先级、有效期、旧值标记被替代),并有标注数据评测准确率和召回率;业务系统能查到的事实不进记忆或只存带来源的副本。退款流程跑在持久化执行上,每一步(调模型、调工具、取时间、读记忆)结果进日志,重启后重放;退款带幂等键,最好是业务键。一致性上强调三点:一次运行开头读一次记忆并记进日志,避免读到自己写的;写记忆的步骤要幂等,而且工具自己的数据库要自己提交;用崩溃注入测试在每一步各杀一次,直接查支付系统和记忆库的行数做断言。

</details>

6. 不看文章,说出 `DurableRun.step` 里「执行」和「写日志」的顺序,以及崩溃注入为什么放在它们中间。

<details><summary>答案</summary>

先执行 `fn(*args)`,再 `put` 写日志并 commit,然后才返回。反过来会变成「日志说做了,其实没做」。崩溃注入放在两者之间,因为那是最坏的时刻:外部副作用已经发生,自己没有记录,恢复时一定会再执行一次,只有幂等的步骤能扛住。

</details>

## 明天预告

Day 539 · 持久化执行(四):四个现成方案。这一周自己写的运行器,离生产还差租约、调度、归档和长时间等待。明天看 Temporal、DBOS、Restate、LangGraph checkpoint 这四个现成方案分别怎么解决这些问题,拿 `durable_runner.py` 当对照,说清楚什么时候值得引入它们,什么时候自己的七十行就够了。
