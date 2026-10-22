---
title: 'Day 536 · 持久化执行(二):Agent 让这件事变难的两个地方'
description: '昨天的运行器有一个默认前提:每次重放,代码走的路都和第一次一样,做过的事不会再做一遍。Agent 把这两条都打破了:模型输出不确定,路径会变;退款这种动作做完还没来得及记日志就崩了,重放会再退一次。今天先亲手把这两个问题制造出来,再分别用步骤指纹和幂等键把它们堵上。'
pubDate: 2026-10-22
regime: none
tags: ['durable-execution', 'idempotency', 'nondeterminism', 'python', 'agent-zero']
series: 'agent-zero'
day: 536
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 535](/blog/agent-zero/day-535-durable-1/) 从 Redux 的 reducer 讲到事件溯源,又把同样的思路用到 Agent 的每一步上:每一步执行完,先把结果写进 SQLite 日志并 commit,再往下走;进程被 `kill -9` 以后用同一个 `run_id` 重新运行,日志里有的步骤直接拿结果,没有的才真正执行。最后写出来的 `part10/durable.py` 只有四十来行,`DurableRun.step(名字, 函数, 参数...)` 是全部核心。

昨天的练习里已经露出了两个破绽。练习 3 发现,同一个提示词、`temperature=0`,两次调模型写出来的计划不一样;练习 2 和练习 4 发现,日志一旦少了某一步,那一步会被重新执行,而它可能是一笔已经成功的退款。今天就专门对付这两件事。

## 今天要解决的问题

学完今天你应该能做到:

1. 说清楚为什么 Agent 的重放会「走错路」,亲手造出一次「代码要查知识库、日志却还回来一份发票」的错位,并用两种办法防住它:把模型的决定也当成一步记下来,以及给每一步算一个**步骤指纹**,对不上就报 `NonDeterminismError`。
2. 说清楚「外部系统已经做完、自己的日志还没写」这个窗口为什么永远消不掉,用真的 `kill -9` 制造一次重复退款,再用**幂等键**让支付系统只退一笔。
3. 能回答面试里那句「你怎么保证不重复退款」:至少执行一次 + 幂等去重 = 效果上恰好一次。

预计用时 2.5 小时。前置:[Day 535](/blog/agent-zero/day-535-durable-1/)(`durable.py`,今天直接拿来用)、[Day 390](/blog/agent-zero/day-390-idempotency/)(至少执行一次和幂等键)、[Day 30](/blog/agent-zero/day-030-functions-3/)(`*args` 和 lambda)、[Day 39](/blog/agent-zero/day-039-json/)(`json.dumps`)。

今天只有两个新概念,正好对应标题里的「两个地方」:**非确定性**(nondeterminism)和**副作用**(side effect)。每个概念都按「先把问题造出来,再修」的顺序走。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分(`fingerprint` 函数、`step` 里的指纹检查、`create_refund` 里的幂等判断);做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先回忆重放靠的是什么

昨天的 `DurableRun.step` 里,判断「这一步做没做过」只用了一个数字:`seq`,也就是代码第几次调用 `step`。代码第 2 次调 `step`,就去日志里找第 2 行。这个办法成立的前提,昨天特意加粗写过:**每一次运行,步骤的顺序都一样**。

普通的业务流程,这个前提天然成立。下单流程永远是「扣库存、建订单、发通知」,顺序写死在代码里。Agent 不一样,下一步干什么是模型说了算的,这是 Agent 和工作流最根本的区别([Day 165](/blog/agent-zero/day-165-agent-what/) 讲 Agent 定义时就说过:循环 = 调模型 + 执行工具,模型决定调哪个工具)。所以第一个问题来了:模型的决定会变吗?

## 麻烦一:非确定性

### 先量一下:同一个问题问 6 遍

**非确定性**说的是:同样的输入,两次运行得到不同的输出。前端里最熟悉的例子是 `Math.random()` 和 `Date.now()`,每次调都不一样;对 Agent 来说,最大的非确定性来源是模型本身。

昨天练习 3 只碰巧看到了一次。今天正式量一下:同一个提示词、`temperature=0`,连问 6 遍,数数有几种不同的回答。新建 `part10/nondet_probe.py`:

```python
# agent-zero-lab/part10/nondet_probe.py
import json
import os
from collections import Counter

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
PROMPT = ("客户 C007 说 9 月被重复扣款 468 元。你可以先查发票(list_invoices)或先查知识库(search_kb)。"
          "只回答第一步要调用的工具名,再用一句话说理由。")

answers, used = [], [0, 0]
for i in range(6):
    resp = client.chat.completions.create(
        model=os.environ["LLM_MODEL"], temperature=0, extra_body=EXTRA, max_tokens=60,
        messages=[{"role": "user", "content": PROMPT}])
    answers.append(resp.choices[0].message.content)
    if resp.usage:
        used[0] += resp.usage.prompt_tokens
        used[1] += resp.usage.completion_tokens

for text, n in Counter(answers).most_common():
    print(f"{n} 次 | {text}")
print("不同的回答:", len(set(answers)), "种;第一步选 list_invoices 的:", sum(a.startswith("list_invoices") for a in answers), "次")
print("token:", used)
```

<div class="line-notes">

- `from collections import Counter` `Counter` 是一个专门用来数数的 dict:把一个列表交给它,它告诉你每个元素出现了几次。JS 里你会手写 `arr.reduce((m, x) => (m[x] = (m[x] ?? 0) + 1, m), {})`,这里一行搞定。
- `EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))` 和 Day 535 的 `durable_demo.py` 一样,从 `.env` 读额外参数。我的 `.env` 里是 `{"thinking": {"type": "disabled"}}`,关掉思考模式,省钱也省时间。
- `PROMPT = ("客户 C007 说 9 月被重复扣款 468 元。` 括号里两段字符串挨着写,Python 会自动拼成一个,相当于 JS 里用 `+` 连起来。提示词故意给了两个选项,看模型每次选哪个。
- `answers, used = [], [0, 0]` `answers` 收集 6 次回答;`used` 累计输入、输出 token,最后算钱用。
- `for i in range(6):` 同样的请求发 6 次,一次都不改。
- `model=os.environ["LLM_MODEL"], temperature=0, extra_body=EXTRA, max_tokens=60,` `temperature=0` 是「尽量别随机」。很多人以为设成 0 输出就完全固定了,下面的结果会告诉你不是。
- `answers.append(resp.choices[0].message.content)` 只存文字,`append` 相当于 JS 的 `push`。
- `for text, n in Counter(answers).most_common():` `most_common()` 按出现次数从多到少给出 `(回答, 次数)`。
- `print("不同的回答:", len(set(answers)), "种;` `set` 去重([Day 25](/blog/agent-zero/day-025-sets/) 的集合),去重后的个数就是有几种不同回答。`sum(a.startswith(...) for a in answers)` 数有几次是以 `list_invoices` 开头的,True 当 1 加。

</div>

在 `agent-zero-lab/` 下运行:

```bash
cd agent-zero-lab
uv run python part10/nondet_probe.py
```

我的输出:

```text
2 次 | list_invoices。先核对客户 9 月的发票与扣款记录，确认是否存在重复扣款，再决定是否需要查知识库。
2 次 | list_invoices。先核对客户 9 月的发票与扣款记录，确认是否真的存在重复扣款，再决定是否需要查知识库。
1 次 | list_invoices。先核对 C007 在 9 月的发票与扣款记录，确认是否存在重复扣款，再决定是否需要查知识库。
1 次 | list_invoices。因为客户说的是具体金额的重复扣款，先查发票能直接核对 9 月扣款记录、确认是否真的重复。
不同的回答: 4 种;第一步选 list_invoices 的: 6 次
token: [318, 190]
```

6 次请求,一个字都没改,出来 4 种说法。这次的「决定」倒是稳的,6 次都选了先查发票。但你别拿这个当保证:换个更模糊的问题、上下文里多一条历史消息、或者厂商在后台升级了模型版本,决定本身就可能翻。`temperature=0` 只是让模型每次挑概率最高的那个字,服务端批处理、浮点运算顺序这些因素仍会让结果有细微差别,而一个字的差别往后滚几十个字,就成了另一句话。

花费:输入 318、输出 190 token,按 `deepseek-flash` 高峰价(2026 年 10 月在 [DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) 查到:缓存未命中输入 ¥2/百万、输出 ¥8/百万):318 × 2 ÷ 1,000,000 + 190 × 8 ÷ 1,000,000 ≈ ¥0.0022。

### 路一变,日志就对错号

模型的决定会变,对重放意味着什么?用一个假模型把「变了」这件事确定地造出来:第一次它说先查发票,第二次它说先查知识库。这正好是刚才那个提示词的两个选项。

关键在于,昨天的规则是「所有调模型、调工具的动作都必须通过 `run.step`」。如果有人图省事,让模型做决定的那次调用没走 `step`,会发生什么?新建 `part10/durable_drift.py`,它导入的是 Day 535 写好的 `durable.py`:

```python
# agent-zero-lab/part10/durable_drift.py
import os
import sys

from durable import DurableRun, Journal

DB = "part10/drift.db"
CHOICES = ["list_invoices", "search_kb"]  # 假模型:第一次说先查发票,第二次说先查知识库


def decide() -> str:
    return CHOICES.pop(0)


def list_invoices(customer_id: str) -> list[dict]:
    return [{"id": "INV-2290", "amount": 468}, {"id": "INV-2291", "amount": 468}]


def search_kb(query: str) -> list[dict]:
    return [{"title": "重复扣款怎么处理", "url": "/kb/dup-charge"}]


def workflow(run: DurableRun, fixed: bool, crash: bool) -> None:
    choice = run.step("llm.decide", decide) if fixed else decide()
    if choice == "list_invoices":
        data = run.step("tool.list_invoices", list_invoices, "C007")
    else:
        data = run.step("tool.search_kb", search_kb, "重复扣款")
    print(f"  模型选了 {choice},拿到的数据: {data}")
    if crash:
        raise SystemExit("  进程挂了")


fixed = sys.argv[1] == "fixed"
if os.path.exists(DB):
    os.remove(DB)
j = Journal(DB)
print("第一次运行")
try:
    workflow(DurableRun(j, "run-1"), fixed, crash=True)
except SystemExit as e:
    print(e)
print("重启后")
workflow(DurableRun(j, "run-1"), fixed, crash=False)
```

<div class="line-notes">

- `from durable import DurableRun, Journal` Day 535 的运行器,一行没改。`Journal(path)` 可以传数据库文件路径,今天每个演示用自己的文件,互不干扰。
- `CHOICES = ["list_invoices", "search_kb"]` 假模型的「剧本」。真模型的变化是偶尔的,演示要的是每次都能复现,所以把变化写死。
- `return CHOICES.pop(0)` `pop(0)` 取出并删掉列表第一个元素,相当于 JS 的 `arr.shift()`。第一次调返回 `list_invoices`,第二次返回 `search_kb`。
- `choice = run.step("llm.decide", decide) if fixed else decide()` 这一行就是今天的分叉点。`fixed` 为 False 时直接调 `decide()`,模型的决定没进日志;为 True 时走 `run.step`,决定也成了日志里的一步。`A if 条件 else B` 是 Python 的三元表达式,等于 JS 的 `条件 ? A : B`。
- `data = run.step("tool.list_invoices", list_invoices, "C007")` 两个分支各调一个工具,但在运行器眼里,它们都只是「第 1 步」或「第 2 步」,看的是序号,不看名字。
- `raise SystemExit("  进程挂了")` 和昨天一样,用异常模拟崩溃,方便在一个脚本里演示。
- `fixed = sys.argv[1] == "fixed"` 命令行参数决定跑坏的版本还是修好的版本。
- `workflow(DurableRun(j, "run-1"), fixed, crash=False)` 「重启」:同一个 `run_id`,新建 `DurableRun`,`seq` 从 0 开始。

</div>

```bash
uv run python part10/durable_drift.py broken
uv run python part10/durable_drift.py fixed
```

```text
第一次运行
  模型选了 list_invoices,拿到的数据: [{'id': 'INV-2290', 'amount': 468}, {'id': 'INV-2291', 'amount': 468}]
  进程挂了
重启后
  模型选了 search_kb,拿到的数据: [{'id': 'INV-2290', 'amount': 468}, {'id': 'INV-2291', 'amount': 468}]
```

```text
第一次运行
  模型选了 list_invoices,拿到的数据: [{'id': 'INV-2290', 'amount': 468}, {'id': 'INV-2291', 'amount': 468}]
  进程挂了
重启后
  模型选了 list_invoices,拿到的数据: [{'id': 'INV-2290', 'amount': 468}, {'id': 'INV-2291', 'amount': 468}]
```

先看坏的那段。重启后模型改口说查知识库,代码进了 `else` 分支,调 `run.step("tool.search_kb", ...)`。这是第 1 次调 `step`,运行器去日志找第 1 行,找到了,于是把**发票列表**当成「知识库的搜索结果」还了回去。没有报错,没有警告,下游的代码会拿着两张发票当帮助文章去用。我第一次看到这个输出时愣了一下,因为它太安静了。

修好的那段,决定本身进了日志。重启后第 1 步 `llm.decide` 是重放,返回的是第一次的 `list_invoices`,`CHOICES.pop` 根本没被调到,后面的路径和第一次一模一样。

这就是对付非确定性的第一招:**一切不确定的东西都要作为一步记下来**,重放时用记录的值,不重新算。模型调用是最大的一块,时间(`time.time()`)、随机数、`uuid`、读外部数据也一样。Temporal 的文档把这条写成了硬规定:工作流代码里不准直接取时间、生成随机数、发网络请求,这些都要放进 activity 由运行时记录。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="重放错位:第一次运行第 1 步是查发票,日志里记的是发票;重启后模型改选查知识库,运行器按序号取第 1 行,把发票当成知识库结果返回">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <text x="20" y="30" fill="var(--ink)">第一次</text>
    <rect x="90" y="14" width="120" height="28" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="150" y="32" text-anchor="middle" fill="var(--ink)">模型:查发票</text>
    <rect x="230" y="14" width="150" height="28" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="305" y="32" text-anchor="middle" fill="var(--ink)">第 1 步 list_invoices</text>
    <text x="400" y="32" fill="var(--compute)">✕ 挂了</text>
    <rect x="230" y="78" width="250" height="34" rx="3" fill="var(--paper)" stroke="var(--ink-soft)"/>
    <text x="355" y="94" text-anchor="middle" fill="var(--ink)">日志 seq=1:两张发票</text>
    <text x="355" y="107" text-anchor="middle" fill="var(--ink-faint)" font-size="10">只按序号存,不知道是哪个工具</text>
    <line x1="305" y1="42" x2="305" y2="78" stroke="var(--ink-faint)"/>
    <text x="20" y="166" fill="var(--ink)">重启后</text>
    <rect x="90" y="150" width="120" height="28" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="150" y="168" text-anchor="middle" fill="var(--ink)">模型:查知识库</text>
    <rect x="230" y="150" width="150" height="28" rx="3" fill="var(--paper)" stroke="var(--rule)" stroke-dasharray="4 3"/>
    <text x="305" y="168" text-anchor="middle" fill="var(--ink-faint)">第 1 步 search_kb</text>
    <line x1="305" y1="112" x2="305" y2="150" stroke="var(--compute)" stroke-dasharray="3 3"/>
    <text x="400" y="168" fill="var(--compute)">拿到的是发票</text>
    <text x="320" y="214" text-anchor="middle" fill="var(--ink-soft)">修法一:模型的决定也走 step,重放时用旧决定</text>
    <text x="320" y="234" text-anchor="middle" fill="var(--ink-soft)">修法二:每步存名字和参数的指纹,对不上就报错</text>
  </g>
</svg>
<figcaption>没进日志的模型决定变了,路径跟着变,运行器按序号对号入座,安静地给错结果。蓝色是模型侧,琥珀色是工具侧。</figcaption>
</figure>

### 代码也会变:给每一步加指纹

第一招管住了模型。但还有一种变化,和模型无关:**代码本身改了**。

场景很常见。一张退款工单跑到一半,在等主管审批,这时候你发了个新版本,新版本的 Agent 在查发票之前先查一次知识库。旧的运行恢复时,用的是新代码,新代码的第 1 步是 `search_kb`,日志里的第 1 步却是 `list_invoices`。决定都记在日志里也没用,因为变的是代码。

我们管不住别人发版,能做的是**发现**这种错位,报错,而不是悄悄用错结果。办法是给每一步算一个**步骤指纹**:把这一步的名字和参数拼起来,算一个哈希值,和结果一起存进日志。重放时重新算一遍,和日志里的比,不一样就说明「日志里记的那件事」和「代码这次要做的事」不是同一件。

**哈希**(hash)这个词你可能在前端打包里见过:`main.3f9a2c1b.js` 里那串字符就是文件内容的哈希,内容改一个字,哈希就完全不同;内容不变,哈希永远一样。我们用的是同一个性质。Python 自带的 `hashlib` 就能算,不用装任何东西。

新建 `part10/durable_fp.py`。它是把 Day 535 的 `durable.py` 复制一份再改,改动只有三处:日志表多一列 `fp`、多一个 `fingerprint` 函数、`step` 里多一个检查:

```python
# agent-zero-lab/part10/durable_fp.py
"""Day 535 的运行器 + 步骤指纹:日志里的第 N 步和代码这次的第 N 步对不上,就报错。"""
import hashlib
import json
import sqlite3
from typing import Any, Callable


class NonDeterminismError(RuntimeError):
    pass


def fingerprint(name: str, args: tuple) -> str:
    raw = json.dumps([name, list(args)], ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


class Journal:
    def __init__(self, path: str):
        self.db = sqlite3.connect(path)
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

    def step(self, name: str, fn: Callable[..., Any], *args: Any) -> Any:
        self.seq += 1
        fp = fingerprint(name, args)
        row = self.j.get(self.run_id, self.seq)
        if row:
            if row[1] != fp:
                raise NonDeterminismError(
                    f"第 {self.seq} 步对不上:日志里是 {row[0]}({row[1]}),这次代码是 {name}({fp})")
            return json.loads(row[2])
        result = fn(*args)
        self.j.put(self.run_id, self.seq, name, fp, result)
        return result
```

<div class="line-notes">

- `class NonDeterminismError(RuntimeError):` 自己定义一个异常类型([Day 36](/blog/agent-zero/day-036-exceptions-2/) 讲过自定义异常),名字直接借 Temporal 的叫法。`pass` 表示类里什么都不加,只要一个新名字,方便调用方单独 `except` 它。
- `def fingerprint(name: str, args: tuple) -> str:` 输入是这一步的名字和参数,输出一个 16 个字符的字符串。同样的名字和参数,永远算出同一个指纹。
- `raw = json.dumps([name, list(args)], ensure_ascii=False, sort_keys=True, default=str)` 先把名字和参数变成一个字符串。`sort_keys=True` 让 dict 的键按字母排好序再输出,否则 `{"a":1,"b":2}` 和 `{"b":2,"a":1}` 是同一个东西,却会算出两个指纹。`default=str` 是兜底:遇到 JSON 不认识的类型(比如日期对象)就先转成字符串,不至于报错。
- `return hashlib.sha256(raw.encode()).hexdigest()[:16]` `encode()` 把字符串转成字节,SHA-256 只吃字节;`hexdigest()` 输出 64 位的十六进制字符串;`[:16]` 只留前 16 位。16 位十六进制有 2 的 64 次方种可能,同一次运行里两个不同步骤撞车的概率可以忽略,省一半存储也好读。
- `" fp TEXT, result TEXT, PRIMARY KEY(run_id, seq))")` 表里多了一列 `fp`。注意这是新的表结构,所以今天的演示都用新的数据库文件,别和 Day 535 的 `journal.db` 混用。
- `def get(self, run_id: str, seq: int) -> tuple[str, str, str] | None:` 返回值多了一项,现在是 `(name, fp, result)`。
- `fp = fingerprint(name, args)` 每一步都先算指纹,不管是不是重放。
- `if row[1] != fp:` 日志里有这一步,但指纹对不上。可能是步骤名字变了(代码换了工具),也可能是参数变了(比如提示词改了,或者上一步重新算出了不同的值)。
- `raise NonDeterminismError(` 宁可停下来大声报错,也不拿一个不相干的结果往下走。错误信息里写清楚是第几步、两边各是什么,排查时一眼就懂。
- `self.j.put(self.run_id, self.seq, name, fp, result)` 第一次执行时,把指纹和结果一起存下。

</div>

再写一个演示:v1 的代码跑到第 1 步挂掉,用「先查知识库」的 v2 代码去恢复。新建 `part10/fp_demo.py`:

```python
# agent-zero-lab/part10/fp_demo.py
import os
import sys

from durable_fp import DurableRun, Journal, NonDeterminismError, fingerprint

DB = "part10/fp.db"


def list_invoices(customer_id: str) -> list[dict]:
    return [{"id": "INV-2290", "amount": 468}, {"id": "INV-2291", "amount": 468}]


def search_kb(query: str) -> list[dict]:
    return [{"title": "重复扣款怎么处理", "url": "/kb/dup-charge"}]


def write_reply(prompt: str) -> str:
    return "多扣的 468 元我们会退回"


def workflow_v1(run: DurableRun, crash: bool) -> str:
    invoices = run.step("tool.list_invoices", list_invoices, "C007")
    if crash:
        raise SystemExit("  v1 跑完第 1 步后进程挂了")
    return run.step("llm.reply", write_reply, f"发票 {invoices},写回复")


def workflow_v2(run: DurableRun) -> str:  # 新版本:先查知识库,再查发票
    kb = run.step("tool.search_kb", search_kb, "重复扣款")
    invoices = run.step("tool.list_invoices", list_invoices, "C007")
    return run.step("llm.reply", write_reply, f"知识库 {kb},发票 {invoices},写回复")


if __name__ == "__main__":
    print("指纹示例:", fingerprint("tool.list_invoices", ("C007",)), fingerprint("tool.list_invoices", ("C009",)))
    if os.path.exists(DB):
        os.remove(DB)
    j = Journal(DB)
    try:
        workflow_v1(DurableRun(j, "run-1"), crash=True)
    except SystemExit as e:
        print(e)
    print("发版,用 v2 的代码恢复 run-1")
    try:
        workflow_v2(DurableRun(j, "run-1"))
    except NonDeterminismError as e:
        print("  NonDeterminismError:", e)
        sys.exit(1)
```

<div class="line-notes">

- `from durable_fp import DurableRun, Journal, NonDeterminismError, fingerprint` 这次用带指纹的新运行器。
- `def write_reply(prompt: str) -> str:` 假的「写回复」,今天不花钱。
- `return run.step("llm.reply", write_reply, f"发票 {invoices},写回复")` 提示词里用到了上一步的结果,所以它也是这一步参数的一部分,会进指纹。
- `def workflow_v2(run: DurableRun) -> str:  # 新版本:先查知识库,再查发票` 模拟发版后的代码:比 v1 多了一步,而且多在最前面。
- `if __name__ == "__main__":` 下面的演示只在直接运行这个文件时执行,别的文件 `import fp_demo` 时不会跑(练习 3 要导入这两个 workflow)。
- `fingerprint("tool.list_invoices", ("C009",))` 只有一个元素的元组要写成 `("C009",)`,带逗号。两次调用只差了客户号,看指纹差多少。
- `workflow_v2(DurableRun(j, "run-1"))` 同一个 `run_id`,用新代码恢复。
- `sys.exit(1)` 以退出码 1 结束,告诉调用它的人(比如部署脚本)「恢复失败了」。

</div>

```bash
uv run python part10/fp_demo.py; echo "exit=$?"
```

```text
指纹示例: 9103e2879c97873e 913244f85ecf9457
  v1 跑完第 1 步后进程挂了
发版,用 v2 的代码恢复 run-1
  NonDeterminismError: 第 1 步对不上:日志里是 tool.list_invoices(9103e2879c97873e),这次代码是 tool.search_kb(da08424dc750f45f)
exit=1
```

两个指纹只差一个客户号,结果从头到尾完全不同,这就是哈希的性质。恢复时第 1 步就被拦下了:日志里是 `list_invoices`,代码这次要做 `search_kb`。比起刚才那次安静的错位,这个报错好太多了,至少你知道出事了,也知道出在哪一步。

报错以后怎么办?停住只是第一步。真正的解法是让**老的运行继续走老逻辑,新的运行走新逻辑**,这叫工作流**版本化**。Temporal 的 Python SDK 提供 `workflow.patched("某个改动的名字")`,它会在事件历史里留一个标记,老的运行没有这个标记就走老分支。练习 3 会用一个更朴素的办法实现同样的效果:每次运行开始时记下它的代码版本号。

指纹还顺带拦住了另一类问题:参数变了。比如你改了系统提示词,恢复一个旧运行时,第一次调模型的参数(消息列表)就和日志里的不一样,同样会报错。明天把运行器接到真的 Agent 上时会实际碰到。

## 麻烦二:副作用

### 那个永远消不掉的窗口

**副作用**指的是一步操作在你的程序之外留下了改变:退了一笔款、发了一封邮件、改了数据库里的一行。查发票没有副作用,查一万次也不会多出一张发票;退款有,退一次少一次钱。前端类比一下:`GET` 请求刷新多少次都没事,表单提交按两下,可能就下了两单。

持久化执行对没有副作用的步骤是完全安全的:没写进日志就重新执行一遍,最多浪费点时间。有副作用的步骤就危险了。看 `step` 里这两行:

```python
result = fn(*args)                                    # ① 调支付系统退款
self.j.put(self.run_id, self.seq, name, fp, result)   # ② 写自己的日志
```

<div class="line-notes">

- `result = fn(*args)` 这一行执行完,钱已经退出去了,支付系统那边已经有记录。
- `self.j.put(self.run_id, self.seq, name, fp, result)` 这一行执行完,自己的日志里才有记录。进程如果死在 ① 和 ② 之间,支付系统记得,我们不记得。

</div>

进程要是正好死在 ① 之后、② 之前,支付系统里已经退了款,我们的日志里却没有这一步。重启后运行器一查日志,没有,于是再调一次退款。

能不能把两行调换顺序,先写日志再退款?不行,那就变成「日志说退了,其实没退」,客户的钱没回来。能不能把两行包进一个事务?也不行,支付系统的数据库和我们的 SQLite 是两个系统,一个事务管不到别人家的数据库。所以这个窗口无论代码写得多快,都只能变窄,不能消失。[Day 390](/blog/agent-zero/day-390-idempotency/) 讲队列时说过同一件事:队列只能保证至少执行一次。持久化执行也一样,它保证的是**至少执行一次**。

### 亲手造一次重复退款

光说没感觉,用真的 `kill -9` 造一次。先写一个假的支付系统,它有自己的数据库文件 `payments.db`,和运行器的日志分开,就像真实世界里是两个公司的两个系统。新建 `part10/payments.py`:

```python
# agent-zero-lab/part10/payments.py
"""假的支付系统:有自己的数据库,和运行器的日志是两个文件,就像真实世界里是两个系统。"""
import os
import sqlite3

db = sqlite3.connect(os.environ.get("PAYMENTS_DB", "part10/payments.db"))
db.execute("CREATE TABLE IF NOT EXISTS refunds(refund_id TEXT PRIMARY KEY, invoice_id TEXT,"
           " amount INTEGER, idem_key TEXT UNIQUE)")


def create_refund(invoice_id: str, amount: int, idem_key: str | None = None) -> dict:
    if idem_key is not None:
        row = db.execute("SELECT refund_id FROM refunds WHERE idem_key=?", (idem_key,)).fetchone()
        if row:  # 这个键见过:不再退,把上次的结果原样还回去
            return {"refund_id": row[0], "invoice_id": invoice_id, "amount": amount, "replayed": True}
    n = db.execute("SELECT count(*) FROM refunds").fetchone()[0]
    refund_id = f"RF-{n + 1}"
    db.execute("INSERT INTO refunds VALUES(?,?,?,?)", (refund_id, invoice_id, amount, idem_key))
    db.commit()
    return {"refund_id": refund_id, "invoice_id": invoice_id, "amount": amount}
```

<div class="line-notes">

- `db = sqlite3.connect(os.environ.get("PAYMENTS_DB", "part10/payments.db"))` 数据库路径默认是 `part10/payments.db`,也可以用环境变量 `PAYMENTS_DB` 换一个。今天用不到这个开关,明天写测试时要让每个测试用自己的文件。
- `" amount INTEGER, idem_key TEXT UNIQUE)")` `idem_key` 是幂等键这一列,`UNIQUE` 表示同一个键只能出现一次,和 Day 390 里 `refund_requests` 表的那一列是同一个思路。没传键时存的是 NULL,SQLite 允许多个 NULL 共存,所以不带键的退款不受限制。
- `def create_refund(invoice_id: str, amount: int, idem_key: str | None = None) -> dict:` 幂等键是可选参数,默认 None。真实的支付接口大多也是这样:不传就不去重。
- `row = db.execute("SELECT refund_id FROM refunds WHERE idem_key=?", (idem_key,)).fetchone()` 先按键查一下这笔退款是不是已经做过。
- `return {"refund_id": row[0], "invoice_id": invoice_id, "amount": amount, "replayed": True}` 见过这个键,就不再退款,直接返回上次的退款单号。多加一个 `replayed: True` 只是为了演示时看得出来,真实的支付系统(比如 Stripe)是原样返回第一次的响应。
- `n = db.execute("SELECT count(*) FROM refunds").fetchone()[0]` 用当前行数生成退款单号 `RF-1`、`RF-2`……演示够用,真实系统会用数据库自增 id 或者 uuid。
- `db.commit()` 支付系统自己的事务,提交以后钱就算退出去了。

</div>

这里先查再插有一个并发漏洞:两个请求同时查,都没查到,就都插入了。`UNIQUE` 约束是最后一道防线,第二个插入会报错。Day 390 用 `ON CONFLICT DO NOTHING` 把这个处理得更干净,今天的重点不在这,演示里只有一个进程。

然后是演示流程:第 1 步查发票,第 2 步退款。退款函数里留一个开关,打开时在支付系统落盘以后、运行器写日志之前,自己给自己发 `kill -9`,正好卡在那个窗口里。新建 `part10/refund_demo.py`:

```python
# agent-zero-lab/part10/refund_demo.py
import os
import signal
import sys

from durable_fp import DurableRun, Journal
from payments import create_refund

MODE, RUN_ID = sys.argv[1], sys.argv[2]  # MODE: nokey 或 key
CRASH = os.environ.get("CRASH") == "1"


def list_invoices(customer_id: str) -> list[dict]:
    return [{"id": "INV-2291", "amount": 468}]  # 只返回重复扣的那一张


def refund_step(invoice_id: str, amount: int, idem_key: str | None) -> dict:
    r = create_refund(invoice_id, amount, idem_key)
    print("  支付系统:", r, flush=True)
    if CRASH:  # 退款已经在支付系统落盘,运行器的日志还没写
        os.kill(os.getpid(), signal.SIGKILL)
    return r


run = DurableRun(Journal("part10/journal_fx.db"), RUN_ID)
invoices = run.step("tool.list_invoices", list_invoices, "C007")
key = f"{run.run_id}-{run.seq + 1}" if MODE == "key" else None
refund = run.step("tool.create_refund", refund_step, invoices[0]["id"], invoices[0]["amount"], key)
print("  第 2 步结果:", refund, flush=True)
```

<div class="line-notes">

- `MODE, RUN_ID = sys.argv[1], sys.argv[2]  # MODE: nokey 或 key` 第一个参数决定带不带幂等键,第二个是运行 id。
- `CRASH = os.environ.get("CRASH") == "1"` 用环境变量控制要不要在窗口里自杀。命令行前面写 `CRASH=1` 就打开,只对这一条命令有效。
- `def refund_step(invoice_id: str, amount: int, idem_key: str | None) -> dict:` 包一层退款调用,好在中间插入「崩溃」。真实情况里崩溃来自外面(发版、OOM、断电),这里用代码造出来,保证每次都能复现。
- `os.kill(os.getpid(), signal.SIGKILL)` Day 535 用过的那一招:给自己发 SIGKILL。这一行在 `create_refund` 已经 commit 之后,在 `step` 里的 `put` 之前。
- `run = DurableRun(Journal("part10/journal_fx.db"), RUN_ID)` 带指纹的运行器,用单独的日志文件。
- `key = f"{run.run_id}-{run.seq + 1}" if MODE == "key" else None` 幂等键的算法:运行 id 加上**下一步**的序号。此刻 `seq` 是 1(第 1 步刚做完),所以退款这一步的键是 `run-b-2`。重放多少次,这次运行的第 2 步算出来的键都一样。
- `refund = run.step("tool.create_refund", refund_step, invoices[0]["id"], invoices[0]["amount"], key)` 键作为参数传进去,它也会进指纹。

</div>

先跑不带键的。第一条命令打开崩溃开关,第二条正常恢复,最后看支付系统里有几笔退款:

```bash
rm -f part10/payments.db part10/journal_fx.db
CRASH=1 uv run python part10/refund_demo.py nokey run-a; echo "exit=$?"
sqlite3 part10/journal_fx.db "SELECT run_id, seq, name FROM steps"
uv run python part10/refund_demo.py nokey run-a
sqlite3 part10/payments.db "SELECT * FROM refunds"
```

```text
  支付系统: {'refund_id': 'RF-1', 'invoice_id': 'INV-2291', 'amount': 468}
exit=137
run-a|1|tool.list_invoices
  支付系统: {'refund_id': 'RF-2', 'invoice_id': 'INV-2291', 'amount': 468}
  第 2 步结果: {'refund_id': 'RF-2', 'invoice_id': 'INV-2291', 'amount': 468}
RF-1|INV-2291|468|
RF-2|INV-2291|468|
```

退出码 137,真的被 SIGKILL 杀了。日志里只有第 1 步,第 2 步在支付系统那边已经做完(RF-1),在我们这边却不存在。恢复时运行器很「尽职」地执行了第 2 步,于是有了 RF-2。同一张发票 INV-2291,退了两次 468 元。客户那边是多到账 468 元,公司这边是一笔要追回的坏账,财务月底对账才会发现。

### 幂等键:让对方帮你去重

**幂等**(idempotent)的意思是:做一次和做很多次,效果一样。[Day 390](/blog/agent-zero/day-390-idempotency/) 已经用过,这里提醒一句它的做法:每次有副作用的调用都带一个**幂等键**,对方系统记住见过的键,同一个键再来,就返回上次的结果,不再做一遍。

我们这边改不了「至少执行一次」,那就让对方去重。两边合起来:我们至少调一次,对方对同一个键只做一次,**效果上恰好一次**(exactly-once effect)。注意这个说法里的「效果上」,调用本身确实发生了两次,只是第二次什么也没改。

换成带键的模式再跑一遍:

```bash
CRASH=1 uv run python part10/refund_demo.py key run-b; echo "exit=$?"
uv run python part10/refund_demo.py key run-b
uv run python part10/refund_demo.py key run-b
sqlite3 part10/payments.db "SELECT * FROM refunds"
```

```text
  支付系统: {'refund_id': 'RF-3', 'invoice_id': 'INV-2291', 'amount': 468}
exit=137
  支付系统: {'refund_id': 'RF-3', 'invoice_id': 'INV-2291', 'amount': 468, 'replayed': True}
  第 2 步结果: {'refund_id': 'RF-3', 'invoice_id': 'INV-2291', 'amount': 468, 'replayed': True}
  第 2 步结果: {'refund_id': 'RF-3', 'invoice_id': 'INV-2291', 'amount': 468, 'replayed': True}
RF-1|INV-2291|468|
RF-2|INV-2291|468|
RF-3|INV-2291|468|run-b-2
```

`payments.db` 没删,所以 RF-1、RF-2 是上一轮 run-a 留下的。看 run-b 的部分:第一次退款生成 RF-3,然后在窗口里被杀;恢复时退款接口确实又被调了一次(打印了「支付系统:」那一行),但支付系统认出了键 `run-b-2`,返回的还是 RF-3,标着 `replayed: True`。第三次运行,两步都在日志里,连支付系统都没碰,打印的是日志里的结果。表里 run-b 只有一行。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="副作用的窗口:退款在支付系统落盘后、写日志前崩溃。没有幂等键时恢复会再退一次;有幂等键时支付系统认出同一个键,返回上次的结果">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <line x1="40" y1="60" x2="600" y2="60" stroke="var(--rule)"/>
    <text x="40" y="34" fill="var(--ink)">运行器</text>
    <rect x="100" y="46" width="120" height="28" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="160" y="64" text-anchor="middle" fill="var(--ink)">① 调退款接口</text>
    <rect x="380" y="46" width="120" height="28" rx="3" fill="var(--paper)" stroke="var(--rule)" stroke-dasharray="4 3"/>
    <text x="440" y="64" text-anchor="middle" fill="var(--ink-faint)">② 写日志</text>
    <rect x="236" y="40" width="128" height="40" rx="3" fill="var(--paper)" stroke="var(--compute)"/>
    <text x="300" y="58" text-anchor="middle" fill="var(--compute)">✕ kill -9</text>
    <text x="300" y="73" text-anchor="middle" fill="var(--ink-faint)" font-size="10">窗口:消不掉</text>
    <text x="40" y="128" fill="var(--ink)">支付系统</text>
    <rect x="100" y="112" width="120" height="28" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="160" y="130" text-anchor="middle" fill="var(--ink)">RF-3 已落盘</text>
    <line x1="160" y1="74" x2="160" y2="112" stroke="var(--ink-faint)"/>
    <text x="40" y="186" fill="var(--ink)">恢复时</text>
    <text x="100" y="186" fill="var(--ink-soft)">不带键:再退一笔 RF-4,同一张发票退两次</text>
    <text x="100" y="212" fill="var(--ink-soft)">带键 run-b-2:支付系统查到见过这个键,返回 RF-3</text>
    <text x="320" y="246" text-anchor="middle" fill="var(--ink-faint)" font-size="10">我们保证至少执行一次,对方按键去重,合起来是效果上恰好一次</text>
  </g>
</svg>
<figcaption>副作用的窗口在两个系统之间,任何一方都没法单独把它关上。幂等键把「去重」这件事交给真正做事的那一方。</figcaption>
</figure>

### 幂等键怎么算才对

这个键有一条死规矩:**同一次运行的同一步,不管重放多少次,算出来必须一样**。所以我们用「运行 id + 步骤序号」,两样都是确定的。

最常见的错法是每次现生成一个随机数,比如 `uuid.uuid4()`。进程重启后,新进程生成一个新的 uuid,支付系统看到的是一个从没见过的键,照退不误。练习 2 会实跑出这个后果。这里有个容易混淆的地方:Stripe 的[幂等请求文档](https://docs.stripe.com/api/idempotent_requests)里明明写着「建议用 V4 UUID」。不矛盾,Stripe 说的是**生成一次、存下来、重试时用同一个**;我们的运行器里,「存下来」这件事就是靠可以重算的确定性算法免掉的。

顺便记几个 Stripe 文档里的细节(2026 年 10 月查):键通过 `Idempotency-Key` 请求头传,最长 255 个字符;API v1 的键至少保留 24 小时,过期后再用同一个键会被当成新请求;同一个键如果参数和第一次不同,Stripe 会直接报错,防止你误用。这三条在设计自己的支付对接时都用得上,特别是最后一条,它和我们的步骤指纹是同一个想法。

对方系统不支持幂等键怎么办?退而求其次,调用前先查一下「这件事做过没有」,比如按发票号查有没有退款记录。这比幂等键脆弱,查和做之间还有窗口,两个进程同时查就都会以为没做过。练习 4 实现一次。我的建议是:选第三方服务时,支不支持幂等键应该是一条评估项。

## 动手练习

**练习 1:时间也是不确定的。** 写一个脚本,第 1 步取当前时间,一份直接用 `time.time()`,一份通过 `run.step("clock.now", time.time)`;再算出「扣款距今几天」(扣款日按 2026 年 9 月 3 日)。第一次运行后挂掉,等 2 秒重启,对比两份时间。想一想,为什么「距今几天」必须用记录下来的那一份。

<details><summary>参考答案</summary>

新建 `part10/ex536_clock.py`:

```python
# agent-zero-lab/part10/ex536_clock.py
import sys
import time

from durable_fp import DurableRun, Journal

CHARGED_AT = 1788393600  # 2026-09-03 00:00 UTC,扣款那天

run = DurableRun(Journal("part10/clock.db"), "run-1")
direct = time.time()
recorded = run.step("clock.now", time.time)
print(f"直接读: {direct:.3f} | 经过 step: {recorded:.3f}", flush=True)
print(f"扣款距今 {(recorded - CHARGED_AT) / 86400:.4f} 天", flush=True)
if sys.argv[1:] == ["crash"]:
    raise SystemExit("进程挂了")
```

<div class="line-notes">

- `CHARGED_AT = 1788393600  # 2026-09-03 00:00 UTC,扣款那天` Unix 时间戳,从 1970 年起的秒数。JS 的 `Date.now()` 是毫秒,Python 的 `time.time()` 是秒,差 1000 倍,这个坑前端转过来经常踩。
- `direct = time.time()` 直接读时钟,每次运行都不一样。
- `recorded = run.step("clock.now", time.time)` 把「取时间」当成一步。`time.time` 不带括号,传的是函数本身,昨天讲过为什么。它没有参数,所以指纹只由名字决定。
- `print(f"直接读: {direct:.3f} | 经过 step: {recorded:.3f}", flush=True)` `:.3f` 保留三位小数。
- `if sys.argv[1:] == ["crash"]:` `sys.argv[1:]` 是除脚本名以外的所有参数。传了 `crash` 就在最后「挂掉」。

</div>

```bash
rm -f part10/clock.db
uv run python part10/ex536_clock.py crash; sleep 2; uv run python part10/ex536_clock.py
```

```text
直接读: 1792644903.324 | 经过 step: 1792644903.324
扣款距今 49.2049 天
进程挂了
直接读: 1792644905.486 | 经过 step: 1792644903.324
扣款距今 49.2049 天
```

第一次两份时间一样;重启后直接读的那份往前走了 2 秒多,经过 step 的那份还是第一次的值,所以「距今 49.2049 天」两次完全一样。

为什么必须用记录的那份:假设退款规则是「扣款 60 天内可退」,一张工单在第 59.9 天开始处理,中途等主管审批等了一天。如果恢复时重新读时钟,判断就从「可以退」变成「超期了」,而前面几步(比如已经告诉客户「符合退款条件」)是按「可以退」做的,前后矛盾。用记录下来的时间,这次运行从头到尾都活在同一个「现在」里。

</details>

**练习 2:幂等键用 uuid。** 把 `refund_demo.py` 里的幂等键换成每次运行时 `str(uuid.uuid4())`,在窗口里杀一次再恢复,看支付系统里有几笔退款。恢复成功以后再跑一次,又会发生什么?

<details><summary>参考答案</summary>

新建 `part10/ex536_uuid_key.py`:

```python
# agent-zero-lab/part10/ex536_uuid_key.py
import os
import signal
import sys
import uuid

from durable_fp import DurableRun, Journal
from payments import create_refund, db


def refund_step(invoice_id: str, amount: int, idem_key: str) -> dict:
    r = create_refund(invoice_id, amount, idem_key)
    print("  支付系统:", r["refund_id"], "键", idem_key[:8], flush=True)
    if sys.argv[1:] == ["crash"]:
        os.kill(os.getpid(), signal.SIGKILL)
    return r


run = DurableRun(Journal("part10/journal_uuid.db"), "run-u")
key = str(uuid.uuid4())  # 错误示范:每次启动都是一个新键
run.step("tool.create_refund", refund_step, "INV-2291", 468, key)
print("  支付系统里这张发票的退款:", db.execute(
    "SELECT count(*) FROM refunds WHERE invoice_id='INV-2291' AND idem_key IS NOT NULL").fetchone()[0], "笔")
```

<div class="line-notes">

- `from payments import create_refund, db` 顺便把支付系统的数据库连接导进来,最后数一下退款笔数。
- `print("  支付系统:", r["refund_id"], "键", idem_key[:8], flush=True)` 只打印键的前 8 位,够看出两次是不是同一个。
- `key = str(uuid.uuid4())  # 错误示范:每次启动都是一个新键` `uuid4()` 生成一个随机 uuid,相当于浏览器里的 `crypto.randomUUID()`。每个进程启动时生成一次,所以重启后就变了。
- `"SELECT count(*) FROM refunds WHERE invoice_id='INV-2291' AND idem_key IS NOT NULL").fetchone()[0], "笔")` 只数带键的退款,和正文里不带键的那两笔分开。

</div>

```bash
rm -f part10/payments.db part10/journal_uuid.db
uv run python part10/ex536_uuid_key.py crash; echo "exit=$?"
uv run python part10/ex536_uuid_key.py
uv run python part10/ex536_uuid_key.py
```

```text
  支付系统: RF-1 键 d1eec29c
exit=137
  支付系统: RF-2 键 b8226266
  支付系统里这张发票的退款: 2 笔
```

最后一条命令的输出(只看最后一行):

```text
durable_fp.NonDeterminismError: 第 1 步对不上:日志里是 tool.create_refund(512078b994a938be),这次代码是 tool.create_refund(1923b7f8089c1ee4)
```

带了幂等键,照样退了两笔,因为两次的键根本不是同一个(`d1eec29c` 和 `b8226266`)。键只要每次运行会变,就等于没有。

第三次运行更有意思:第 2 次运行成功以后,退款这一步连同键 `b8226266…` 一起进了日志,指纹也是按这个键算的;第三次又生成了新 uuid,参数变了,指纹对不上,直接报 `NonDeterminismError`。指纹在这里帮你抓到了一个「本该确定却不确定」的参数。可惜它只能在这一步**记进日志以后**才起作用,前面那次重复退款它拦不住,拦重复退款还得靠确定性的幂等键。

</details>

**练习 3:让老运行走老逻辑。** 正文里 v2 代码恢复 v1 的运行时报错了。给每次运行记一个版本号:新运行记当前的 `CODE_VERSION = 2`,发版前开始的老运行是 1;恢复时按版本号选择用 `workflow_v1` 还是 `workflow_v2`。

<details><summary>参考答案</summary>

新建 `part10/ex536_versions.py`:

```python
# agent-zero-lab/part10/ex536_versions.py
import os

from durable_fp import DurableRun, Journal
from fp_demo import workflow_v1, workflow_v2

DB = "part10/versions.db"
CODE_VERSION = 2  # 这次发版的代码版本


def start_or_resume(j: Journal, run_id: str) -> str:
    j.db.execute("CREATE TABLE IF NOT EXISTS runs(run_id TEXT PRIMARY KEY, version INTEGER)")
    row = j.db.execute("SELECT version FROM runs WHERE run_id=?", (run_id,)).fetchone()
    if row is None:  # 新运行:记下它是用哪个版本开始的
        j.db.execute("INSERT INTO runs VALUES(?,?)", (run_id, CODE_VERSION))
        j.db.commit()
        version = CODE_VERSION
    else:
        version = row[0]
    run = DurableRun(j, run_id)
    print(f"  {run_id} 按 v{version} 的逻辑跑")
    return workflow_v1(run, crash=False) if version == 1 else workflow_v2(run)


if os.path.exists(DB):
    os.remove(DB)
j = Journal(DB)
j.db.execute("CREATE TABLE IF NOT EXISTS runs(run_id TEXT PRIMARY KEY, version INTEGER)")
j.db.execute("INSERT INTO runs VALUES('run-old', 1)")  # 发版前用 v1 开始的运行
j.db.commit()
try:
    workflow_v1(DurableRun(j, "run-old"), crash=True)
except SystemExit as e:
    print(e)
print("发版后")
print("  结果:", start_or_resume(j, "run-old"))
print("  结果:", start_or_resume(j, "run-new"))
print("  run-new 的步骤:", [r[0] for r in j.db.execute("SELECT name FROM steps WHERE run_id='run-new' ORDER BY seq")])
```

<div class="line-notes">

- `from fp_demo import workflow_v1, workflow_v2` 正文的 `fp_demo.py` 把演示放在了 `if __name__ == "__main__":` 下,导入时不会跑。
- `CODE_VERSION = 2  # 这次发版的代码版本` 每次改了工作流的步骤顺序就加一。
- `j.db.execute("CREATE TABLE IF NOT EXISTS runs(run_id TEXT PRIMARY KEY, version INTEGER)")` 和 `steps` 放在同一个数据库里,另建一张 `runs` 表,一次运行一行。
- `if row is None:  # 新运行:记下它是用哪个版本开始的` 第一次见到这个 `run_id`,就是新运行,用当前代码版本。
- `version = row[0]` 见过的运行,沿用它当初的版本,不管现在的代码是几。
- `return workflow_v1(run, crash=False) if version == 1 else workflow_v2(run)` 按版本分流。这意味着发版后**老代码不能马上删**,要等所有 v1 的运行都结束。
- `j.db.execute("INSERT INTO runs VALUES('run-old', 1)")  # 发版前用 v1 开始的运行` 手工造一个「发版前开始的」老运行。

</div>

```bash
uv run python part10/ex536_versions.py
```

```text
  v1 跑完第 1 步后进程挂了
发版后
  run-old 按 v1 的逻辑跑
  结果: 多扣的 468 元我们会退回
  run-new 按 v2 的逻辑跑
  结果: 多扣的 468 元我们会退回
  run-new 的步骤: ['tool.search_kb', 'tool.list_invoices', 'llm.reply']
```

老运行顺利跑完,没有报错;新运行用了 v2,三步里先查了知识库。Temporal 的 `workflow.patched()` 做的是更精细的版本:不是整个工作流选一个版本,而是在改动的那一处分叉,并且在事件历史里留一个标记。思路一样,都是「运行记得自己是哪个版本开始的」。

</details>

**练习 4:对方不支持幂等键。** 假设支付系统的退款接口不收幂等键,但提供了「按发票号查退款」的接口。写一个 `refund_once`:先查,查到就不退;查不到才退。用 `kill -9` 在窗口里杀一次再恢复,确认只退一笔。再想一想,这个办法还有什么漏洞。

<details><summary>参考答案</summary>

新建 `part10/ex536_check_first.py`:

```python
# agent-zero-lab/part10/ex536_check_first.py
import os
import signal
import sys

from durable_fp import DurableRun, Journal
from payments import create_refund, db


def find_refund(invoice_id: str) -> dict | None:  # 支付系统提供的查询接口
    row = db.execute("SELECT refund_id, amount FROM refunds WHERE invoice_id=?", (invoice_id,)).fetchone()
    return {"refund_id": row[0], "invoice_id": invoice_id, "amount": row[1]} if row else None


def refund_once(invoice_id: str, amount: int) -> dict:
    found = find_refund(invoice_id)
    if found:
        print("  查到已经退过,不再调退款接口:", found["refund_id"], flush=True)
        return found
    r = create_refund(invoice_id, amount)  # 不带幂等键
    print("  支付系统:", r["refund_id"], flush=True)
    if sys.argv[1:] == ["crash"]:
        os.kill(os.getpid(), signal.SIGKILL)
    return r


run = DurableRun(Journal("part10/journal_cf.db"), "run-c")
print("  第 1 步结果:", run.step("tool.refund_once", refund_once, "INV-2291", 468))
```

<div class="line-notes">

- `def find_refund(invoice_id: str) -> dict | None:  # 支付系统提供的查询接口` 用支付系统的数据库模拟一个查询接口。真实场景里这是一次 HTTP 请求。
- `return {"refund_id": row[0], "invoice_id": invoice_id, "amount": row[1]} if row else None` 查到就整理成和 `create_refund` 一样形状的 dict,这样调用方不用区分两种情况。
- `if found:` 先查后做的关键:做过了就把上次的结果当成这次的结果。
- `r = create_refund(invoice_id, amount)  # 不带幂等键` 模拟对方接口不支持幂等键。
- `print("  第 1 步结果:", run.step("tool.refund_once", refund_once, "INV-2291", 468))` 「查」和「做」包在同一步里,重放时整步跳过。

</div>

```bash
rm -f part10/payments.db part10/journal_cf.db
uv run python part10/ex536_check_first.py crash; echo "exit=$?"
uv run python part10/ex536_check_first.py
sqlite3 part10/payments.db "SELECT count(*) FROM refunds"
```

```text
  支付系统: RF-1
exit=137
  查到已经退过,不再调退款接口: RF-1
  第 1 步结果: {'refund_id': 'RF-1', 'invoice_id': 'INV-2291', 'amount': 468}
1
```

崩溃后恢复,先查到了 RF-1,没有再退。漏洞有两个。一是并发:两个进程同时恢复同一次运行,同时查,都没查到,就都退了,查和做之间的窗口还在。二是语义:「这张发票有退款记录」不等于「这次运行退过款」,如果客户上个月就因为别的原因退过一次部分款,这次真该退的反而被跳过了。幂等键没有这两个问题,因为它标识的是「这一次运行的这一步」,判断和插入由对方在一个事务里完成。

</details>

**验收标准**:`durable_drift.py` 两种模式的输出和文中一致,你能说出坏的那次为什么没报错;`fp_demo.py` 打出 `NonDeterminismError`;`refund_demo.py` 不带键时表里同一个 run 有两笔退款、带键时只有一笔,并且两次都是真的 `kill -9`(退出码 137);能不看文章说出幂等键为什么不能用 uuid4 现生成。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 非确定性 nondeterminism | 同样的输入,两次运行得到不同的输出。模型输出、当前时间、随机数、外部数据都是来源 |
| 重放错位 | 重放时代码走的路和第一次不同,运行器按序号把别的步骤的结果当成这一步的结果返回 |
| 步骤指纹 | 把步骤名字和参数拼起来算出的哈希值,和结果一起存进日志,重放时比对 |
| 哈希 hash | 把任意内容变成一串固定长度字符的算法,内容不变结果就不变,改一个字结果完全不同,例如打包产物文件名里那串字符 |
| SHA-256 | 一种常用的哈希算法,输出 64 位十六进制字符,Python 用 `hashlib.sha256` 计算 |
| NonDeterminismError | 日志里的步骤和代码这次要执行的步骤对不上时抛出的错误,名字借自 Temporal |
| 工作流版本化 | 让发版前开始的运行继续走老逻辑、新运行走新逻辑,Temporal 用 `workflow.patched()` |
| 副作用 side effect | 一个操作在程序之外留下的改变,例如退款、发邮件;查询没有副作用 |
| 至少执行一次 at-least-once | 保证一定会执行,但可能执行不止一次。持久化执行和消息队列都只能保证这个 |
| 幂等键 idempotency key | 每次有副作用的调用带上的一个确定性的键,对方见过这个键就返回上次的结果 |
| 效果上恰好一次 exactly-once effect | 至少执行一次加上幂等去重,调用可能有多次,但效果只发生一次 |

## 常见误区

**以为 `temperature=0` 就是确定的。** 今天实测 6 次请求出来 4 种说法。`temperature=0` 只是让模型每次挑最可能的字,服务端的批处理和浮点误差仍会带来差别。重放时要用记录的结果,别指望重新调一次能得到一样的。

**模型「只是做个判断」,就没走 step。** `durable_drift.py` 演示的就是这种:决定没进日志,重启后决定变了,运行器按序号返回了别的工具的结果,整个过程没有任何报错。凡是会影响后面走哪条路的东西,都要记。

**运行器只按序号对号入座,不检查是哪一步。** Day 535 的 `durable.py` 就是这样。加上指纹以后,错位会变成一个响亮的 `NonDeterminismError`,而不是安静的错误数据。

**发版时把老代码直接删了。** 正在等审批的老运行恢复时会报 `NonDeterminismError`。要么让老运行走老逻辑(练习 3),要么等它们全部跑完再删。

**以为把日志写快一点就能防重复退款。** 调外部系统和写自己的日志是两个系统的两个动作,中间的窗口只能变窄,不能消失。今天用 `kill -9` 实测,不带键时同一张发票退了两次。

**幂等键每次现生成一个 uuid。** 练习 2 实测退了两笔。键必须由确定的东西算出来,比如「运行 id + 步骤序号」,或者由业务含义算出(Day 390 的工单号 + 发票号)。

**以为先查后做和幂等键一样可靠。** 查和做之间还有窗口,而且「这张发票退过款」和「这次运行退过款」不是一回事。只有对方不支持幂等键时才用它。

## 学习资料

### 文档与文章

- [Temporal 文档:Workflow Definition](https://docs.temporal.io/workflow-definition):看「Deterministic constraints」一节,Temporal 列出了工作流代码里哪些事不能做,和今天「一切不确定的都要进日志」对照着读。30 分钟。
- [Temporal Python SDK:Versioning](https://docs.temporal.io/develop/python/versioning):`workflow.patched()` 和 Worker Versioning 两种版本化方式,以及为什么改了代码会触发 nondeterminism error。练习 3 做完再看。
- [Stripe 文档:Idempotent requests](https://docs.stripe.com/api/idempotent_requests):一页纸,幂等键怎么传、保留多久、参数不一致会怎样。10 分钟。
- [Brandur《Implementing Stripe-like Idempotency Keys in Postgres》](https://brandur.org/idempotency-keys):曾在 Stripe 工作的工程师写的长文,讲服务端怎么实现幂等键,包括「原子阶段」和恢复点,比今天的玩具支付系统完整得多。1 小时,可以分两次读。
- [AWS Builders' Library《Making retries safe with idempotent APIs》](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/):亚马逊内部怎么设计幂等 API,讲了参数不一致时为什么要报错。
- [Python 文档:hashlib](https://docs.python.org/3/library/hashlib.html):只看开头 `sha256` 的用法示例。
- [Temporal 博客:Idempotency and durable execution](https://temporal.io/blog/idempotency-and-durable-execution):从持久化执行的角度讲为什么 activity 要幂等,和今天第二部分是同一个话题。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV136My6AEue&autoplay=0&high_quality=1" title="什么是幂等？为什么支付接口必须做到幂等？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>计算机大白话 · 什么是幂等？为什么支付接口必须做到幂等？ · 3 分钟,用支付场景讲幂等键,正好是今天第二部分的大白话版本。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1mYHp6vE4G&autoplay=0&high_quality=1" title="超时三秒，库存到底扣没扣？分布式事务完整教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>简单-编程 · 超时三秒,库存到底扣没扣?分布式事务完整教程 · 15 分钟,2026 年 10 月的新视频。「重试怕扣两次,不重试怕没扣」就是今天那个消不掉的窗口,后半段讲的 Saga 是明天的内容。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/ZEN6m27JIrg" title="Ensuring Deterministic Execution in Modern Language Runtimes" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Temporal · Ensuring Deterministic Execution in Modern Language Runtimes · Temporal 官方频道,讲他们怎么在各个语言的 SDK 里拦住工作流代码里的非确定性操作,英文。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/J2IcD9FZvZU" title="Designing Idempotent API Endpoints for Payments at Stripe" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Arpit Bhayani · Designing Idempotent API Endpoints for Payments at Stripe · 拆解 Stripe 的幂等键设计,英文,适合读完 Brandur 那篇之后看。</figcaption>
</figure>

### 书籍

- Martin Kleppmann《Designing Data-Intensive Applications》(O'Reilly,2017;中文版《数据密集型应用系统设计》,中国电力出版社)第 11 章「Stream Processing」里讲容错时的「恰好一次」和幂等,第 8 章讲分布式系统里时钟为什么不可信,和练习 1 相关。
- Chris Richardson《Microservices Patterns》(Manning,2018)第 3 章讲消息处理时的重复消息和幂等消费者,第 4 章是明天要讲的 Saga。

### 开源项目与代码

- [temporalio/samples-python](https://github.com/temporalio/samples-python):找 `patching` 目录,看官方怎么用 `workflow.patched()` 做版本化。
- [restatedev/sdk-python](https://github.com/restatedev/sdk-python):Restate 用 `ctx.run(...)` 把一段不确定的代码的结果记进日志,和我们的 `run.step` 是一个意思,文档在 [Journaling results](https://docs.restate.dev/develop/python/journaling-results)。

## 自测

1. 为什么说 Agent 让持久化执行变难了?普通的下单工作流为什么没这个问题?

<details><summary>答案</summary>

重放的前提是每次运行步骤顺序一样。普通工作流的步骤写死在代码里,天然满足;Agent 的下一步由模型决定,模型输出不确定,重放时如果重新调模型,可能走出另一条路,日志就按序号对错了号。

</details>

2. `durable_drift.py` 坏的那个版本,重启后为什么没有报错,却拿到了错误的数据?怎么修?

<details><summary>答案</summary>

模型的决定没有走 `step`,重启后决定从「查发票」变成「查知识库」,代码调了 `run.step("tool.search_kb", ...)`;Day 535 的运行器只按序号查日志,第 1 步有记录就直接返回,不检查名字,所以把发票当成知识库结果返回了。修法一是让模型的决定也走 `step`,重放时用记录的决定;修法二是给每一步存名字和参数的指纹,对不上就抛 `NonDeterminismError`。两个都要做。

</details>

3. 步骤指纹是怎么算的?为什么 `json.dumps` 要加 `sort_keys=True`?

<details><summary>答案</summary>

把步骤名和参数列表用 `json.dumps` 变成字符串,再用 SHA-256 算哈希,取前 16 位。`sort_keys=True` 让 dict 的键按固定顺序输出,内容相同但键顺序不同的两个 dict 才会得到同一个指纹,否则会误报。

</details>

4. 「退款成功后、写日志前崩溃」为什么不能靠调换顺序或者事务来解决?

<details><summary>答案</summary>

先写日志再退款,崩溃时会变成「日志说退了,钱没退」;事务只能管同一个数据库,支付系统和我们的日志是两个系统,一个事务包不住。所以窗口消不掉,运行器只能保证至少执行一次,去重要交给对方,靠幂等键。

</details>

5. 面试题:「你们的 Agent 能自动退款,服务重启时怎么保证不重复退款?」

<details><summary>答案</summary>

要点分三层说。第一层:流程用持久化执行,每一步结果写日志,重启后已完成的步骤重放,不会从头再退。第二层:主动说出它的局限,外部调用成功但日志没写的窗口消不掉,所以运行器只保证至少执行一次。第三层:退款调用带确定性的幂等键(运行 id + 步骤序号,或者工单号 + 发票号),支付系统按键去重,合起来是效果上恰好一次;键不能每次随机生成;对方不支持幂等键时退而求其次先查后做,但要说明它在并发下有漏洞。加分项:提到步骤指纹或版本化,防止发版后重放错位;提到选第三方支付时把支持幂等键列为评估项。

</details>

6. 为什么幂等键不能用 `uuid.uuid4()` 现生成?Stripe 文档却建议用 V4 UUID,矛盾吗?

<details><summary>答案</summary>

进程重启后会生成一个新的 uuid,支付系统看到的是没见过的键,照样再退一次(练习 2 实测两笔)。不矛盾:Stripe 说的是客户端生成一次并保存下来,重试时用同一个;我们的运行器用「运行 id + 步骤序号」这种可以重算的确定性算法,省掉了保存这一步。关键不在于键长什么样,而在于同一件事的重试必须拿到同一个键。

</details>

## 明天预告

Day 537 · 持久化执行(三):自己写一个持久化运行器。今天的零件分散在好几个文件里:Day 535 的日志和重放、今天的指纹和幂等键。明天把它们拼成一个完整的 `durable_runner.py`,用崩溃注入在每一步各杀一次进程,写成 pytest 测试钉死「在哪死都只退一笔」;再把一个真的会调工具的 DeepSeek Agent 放到上面跑,最后处理一种今天没碰的失败:不是崩溃,而是业务上做到一半做不下去了,前面做过的事要怎么撤回。
