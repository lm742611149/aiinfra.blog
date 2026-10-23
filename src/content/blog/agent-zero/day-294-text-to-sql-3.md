---
title: 'Day 294 · 问数 Agent(三):问数循环和 10 道题评测'
description: '说明书有了,三道闸也有了,今天把它们接成完整的问数循环:模型写 SQL,被拒绝或报错就带着原因重写,结果出来自检一次,最后用人话回答。然后建 10 道题的评测集,用执行准确率打分:第一次 8/10,两道错的其实是评测器错了,改完 10/10;再用一道「欠了多少钱」说明 10/10 为什么不等于做完了。'
pubDate: 2026-10-23
regime: none
tags: ['text-to-sql', 'agent-loop', 'evaluation', 'execution-accuracy', 'agent-zero']
series: 'agent-zero'
day: 294
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 293](/blog/agent-zero/day-293-week42-review/) 复习了第 42 周,并把 `safe_db.run_sql` 包成了一个只读的 MCP server,配 11 条测试加一份 stdio 冒烟检查。往前两天:[Day 291](/blog/agent-zero/day-291-text-to-sql-1/) 做了三层的库说明书(`part05/text2sql/schema.py` 的 `schema_text()`),只给列名时 6 题对 1 题,三层齐全后 6/6;[Day 292](/blog/agent-zero/day-292-text-to-sql-2/) 做了 `part05/text2sql/safe_db.py` 里的 `run_sql(sql)`,被拒绝、列名写错、超时统一抛 `SQLRejected`,错误信息就是写给模型看的。

这两样东西到现在为止还是各干各的:说明书只用来让模型写一条 SQL,`run_sql` 只被我们手动调用。今天把它们接在一起,让模型自己读错误、自己改,再建一份评测集,把「这个 Agent 到底准不准」变成一个数。

## 今天要解决的问题

学完今天,你要能做到:

1. 写出问数循环 `part05/text2sql/ask_data.py`:模型写 SQL → `run_sql` 执行 → 被拒绝或报错就把原因交回去重写(最多 3 次)→ 结果交给模型自检一次 → 用人话回答。
2. 先用一个「台词写死的假模型」把循环的骨架走通,再换成真模型,说得出为什么自检只做一次。
3. 建 10 道题的评测集,写出执行准确率(EX)的比较函数,跑出第一版分数,并分清每道错题到底是评测器错、口径没说清,还是模型真的错。
4. 用一道「哪家公司欠费了,欠了多少钱」说明 10/10 的局限,以及数据对不上时该怎么办。

预计用时 3 小时。实跑花费约 ¥0.24,算式在「花了多少钱」一节。

前置:[Day 291](/blog/agent-zero/day-291-text-to-sql-1/)(`schema.py`、`try_sql.py`)、[Day 292](/blog/agent-zero/day-292-text-to-sql-2/)(`safe_db.py`)、[Day 135](/blog/agent-zero/day-135-llm-client-1/)(`common/llm.py` 的 `LLMClient`)、[Day 148](/blog/agent-zero/day-148-structured-2/)(JSON mode)、[Day 36](/blog/agent-zero/day-036-exceptions-2/)(自定义异常)、[Day 73](/blog/agent-zero/day-073-pytest-3/)(`parametrize`,练习 1 用)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `ask_data.py` 的 `ask()` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

所有命令在 `agent-zero-lab/` 根目录跑(我的是 `/Users/你/agent-zero-lab`)。先把业务库重置到初始状态,免得前几天的实验留下东西:

```bash
cd /Users/你/agent-zero-lab
uv run python cloudledger/seed.py
```

<div class="line-notes">

- `uv run python cloudledger/seed.py` 删库重建。输出 `已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}`,今天所有数字都以这份库为准。

</div>

## 问数循环长什么样

先看全貌。Day 291 画过一张总图,今天做的是中间那一圈:

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="问数循环:模型写 SQL,经 run_sql 执行;被拒绝或报错时把原因交回模型重写;执行成功后做一次结果自检,不通过也带着原因重写;通过后用人话回答;最多尝试 3 次,三次都不成功转人工">
<rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="30" width="100" height="40" rx="4" fill="none" stroke="var(--ink-soft)"/><text x="70" y="55" fill="var(--ink)" text-anchor="middle">用户问题</text>
<line x1="120" y1="50" x2="150" y2="50" stroke="var(--ink-soft)"/>
<rect x="150" y="30" width="120" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="210" y="48" fill="var(--ink)" text-anchor="middle">模型写 SQL</text><text x="210" y="63" fill="var(--ink-faint)" text-anchor="middle" font-size="11">带说明书</text>
<line x1="270" y1="50" x2="300" y2="50" stroke="var(--ink-soft)"/>
<rect x="300" y="30" width="120" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="360" y="48" fill="var(--ink)" text-anchor="middle">run_sql</text><text x="360" y="63" fill="var(--ink-faint)" text-anchor="middle" font-size="11">三道闸 + 超时</text>
<line x1="420" y1="50" x2="450" y2="50" stroke="var(--ink-soft)"/>
<rect x="450" y="30" width="170" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="535" y="48" fill="var(--ink)" text-anchor="middle">结果自检(一次)</text><text x="535" y="63" fill="var(--ink-faint)" text-anchor="middle" font-size="11">单位、过滤、JOIN 放大</text>
<line x1="535" y1="70" x2="535" y2="120" stroke="var(--ink-soft)"/>
<rect x="450" y="120" width="170" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="535" y="145" fill="var(--ink)" text-anchor="middle">用人话回答</text>
<path d="M360 70 Q360 110 280 112 Q215 114 215 74" fill="none" stroke="var(--compute)" stroke-dasharray="4 3"/>
<text x="285" y="132" fill="var(--compute)" font-size="11" text-anchor="middle">被拒/报错:原因交回去重写</text>
<path d="M535 70 Q470 100 330 104" fill="none" stroke="var(--mem)" stroke-dasharray="4 3"/>
<text x="470" y="95" fill="var(--mem)" font-size="11" text-anchor="middle">自检不过</text>
<rect x="20" y="195" width="600" height="55" rx="4" fill="none" stroke="var(--rule)"/>
<text x="35" y="218" fill="var(--ink-soft)">最多 3 次:三次都不成功,老实说「没查出来」转人工,不给错数</text>
<text x="35" y="238" fill="var(--ink-soft)">自检只做一次:自检也是模型,每次重写都再检,两个模型会来回改个没完</text>
</g>
</svg>
<figcaption>蓝色是调模型的三步,琥珀色是 Day 292 的执行器。两条虚线都是「带着原因回到写 SQL」,区别是前者的原因来自程序,后者来自另一次模型调用。</figcaption>
</figure>

「循环」在这里没有任何新语法,就是一个 `for attempt in range(1, 4)`,和前端里写重试请求一样。难的是每一圈该把什么交回去、什么时候停,所以下面按「先走骨架、再接真模型、再加自检、最后拼起来」的顺序,每一步只多一样东西。

## 第 1 步:不接模型,先把骨架走通

真模型每次的回答不一样,出了问题你分不清是循环写错了还是模型今天心情不好。所以先做一个「台词写死的假模型」:它按事先写好的顺序吐出三条 SQL,第一条是删除、第二条拼错列名、第三条写对。循环不管它是真是假,只管一件事:执行、出错就记下原因、再要一条。

```python
# agent-zero-lab/part05/text2sql/loop_stub.py
"""不接模型,先把「写 SQL → 执行 → 出错带原因重写」的循环走通。「模型」是一个事先写好台词的假函数。"""
from collections.abc import Callable

from part05.text2sql.safe_db import SQLRejected, run_sql

SCRIPT = [  # 假模型的三次回答:先写删除,再拼错列名,最后写对
    "DELETE FROM invoices WHERE id = 'INV-2026-0026'",
    "SELECT nme FROM customers WHERE id = 'C007'",
    "SELECT name FROM customers WHERE id = 'C007'",
]


def make_fake_writer(script: list[str]) -> Callable[[list[str]], str]:
    """返回一个函数:每次被调用,按顺序吐出台词里的下一条 SQL。参数是「到目前为止收到的反馈」,假模型不看它。"""
    it = iter(script)
    return lambda feedback: next(it)


def loop(write: Callable[[list[str]], str], max_tries: int = 3) -> tuple[list[str], list[tuple]] | None:
    feedback: list[str] = []
    for attempt in range(1, max_tries + 1):
        sql = write(feedback)
        print(f"[第 {attempt} 次] {sql}")
        try:
            cols, rows = run_sql(sql)
        except SQLRejected as e:
            print(f"  → 被拒/报错:{e}")
            feedback.append(str(e))
            continue
        return cols, rows
    return None


if __name__ == "__main__":
    print("== 三次机会,第三次写对")
    print("结果:", loop(make_fake_writer(SCRIPT), max_tries=3))
    print("== 只给两次机会")
    print("结果:", loop(make_fake_writer(SCRIPT), max_tries=2))
```

<div class="line-notes">

- `from collections.abc import Callable` 「可以被调用的东西」的类型,相当于 TS 里的函数类型 `(x: string[]) => string`。
- `from part05.text2sql.safe_db import SQLRejected, run_sql` 昨天的执行器,今天不改它一个字。
- `SCRIPT = [  # 假模型的三次回答` 三条 SQL 各代表一种结局:被第一道闸拒绝、执行期报错、成功。
- `def make_fake_writer(script: list[str]) -> Callable[[list[str]], str]:` 返回类型读作「一个接收字符串列表、返回字符串的函数」。外层函数负责准备,内层 lambda 负责每次吐一句,这个套路叫**闭包**,JS 里你天天在写。
- `it = iter(script)` `iter` 把列表变成迭代器,每调一次 `next(it)` 取下一个,取完再取会抛 `StopIteration`。迭代器记着「读到哪了」,所以每次调用拿到的不一样。
- `return lambda feedback: next(it)` 匿名函数,参数 `feedback` 故意不用,只是为了和真模型的接口对齐:真模型要看反馈,假模型不看。
- `def loop(write: Callable[[list[str]], str], max_tries: int = 3)` 把「怎么写 SQL」当参数传进来,真假模型都能换上去。返回值要么是 `(列名, 行)`,要么是 `None` 表示认输。
- `feedback: list[str] = []` 收集每一次失败的原因。假模型不看它,真模型会看(下一步)。
- `for attempt in range(1, max_tries + 1):` 第 1 次到第 3 次。`range(1, 4)` 产出 1、2、3。
- `sql = write(feedback)` 要一条 SQL。第 1 圈 `feedback` 是空列表,第 3 圈里面是两条原因。
- `except SQLRejected as e:` 昨天的设计在这里兑现:三道闸的拒绝、列名写错、超时,都是同一种异常,这里一个 `except` 全接住。
- `feedback.append(str(e))` 第 1 圈后是 `['只允许 SELECT,收到的是 DELETE']`,第 2 圈后多一条 `'执行出错:no such column: nme'`。
- `continue` 跳到下一圈,不往下走。
- `return cols, rows` 成功就立刻返回,不再试。第 3 圈拿到 `(['name'], [('刘静',)])`。
- `return None` 三次都没成功,走完循环才会到这一行。

</div>

`uv run python -m part05.text2sql.loop_stub`:

```text
== 三次机会,第三次写对
[第 1 次] DELETE FROM invoices WHERE id = 'INV-2026-0026'
  → 被拒/报错:只允许 SELECT,收到的是 DELETE
[第 2 次] SELECT nme FROM customers WHERE id = 'C007'
  → 被拒/报错:执行出错:no such column: nme
[第 3 次] SELECT name FROM customers WHERE id = 'C007'
结果: (['name'], [('刘静',)])
== 只给两次机会
[第 1 次] DELETE FROM invoices WHERE id = 'INV-2026-0026'
  → 被拒/报错:只允许 SELECT,收到的是 DELETE
[第 2 次] SELECT nme FROM customers WHERE id = 'C007'
  → 被拒/报错:执行出错:no such column: nme
结果: None
```

三次机会时第三次成功;只给两次机会就是 `None`,循环认输。这个骨架今天不会再变,后面全是往里面塞东西。

两件事值得先想清楚。第一,最多试几次?太少,一个拼错的列名就认输;太多,模型可能原样重复同一条错的 SQL 烧钱。3 次是个经验值,看你的评测集里「第 2、3 次才成功」的比例再调,后面评测时会统计。第二,认输以后怎么办?`None` 要变成一句人话,而且是**诚实的**「没查出来」,不是编一个数。问数场景里给一个错的数比不给数糟糕得多。

## 第 2 步:换成真模型

骨架里只有 `write` 要换。真模型要看到「之前写过什么、错在哪」,才改得对,所以不再是一个孤立的函数,而是一段不断变长的对话:

```python
# agent-zero-lab/part05/text2sql/ask_v1.py
"""问数循环第一版:真模型写 SQL,出错就把原因交回去重写,最多三次。还没有自检,也不用人话回答。"""
import json
import sys
from typing import Any

from common.llm import LLMClient
from part05.text2sql.safe_db import SQLRejected, run_sql
from part05.text2sql.schema import schema_text

SQL_PROMPT = """你是 CloudLedger 的数据分析师,数据库是 SQLite。根据下面的库说明书写一条 SELECT 回答问题。
只输出 JSON:{{"sql": "...", "assumptions": "你做了哪些口径假设,没有就写空字符串"}}
- 只用说明书里出现的表和列
- 问题有歧义时按术语表口径选一种,并写进 assumptions
- 金额结果换算成元并保留两位小数

{schema}"""

llm = LLMClient()


def ask_v1(question: str, max_tries: int = 3) -> tuple[list[str], list[tuple]] | None:
    messages: list[Any] = [
        {"role": "system", "content": SQL_PROMPT.format(schema=schema_text())},
        {"role": "user", "content": question},
    ]
    for attempt in range(1, max_tries + 1):
        r = llm.chat(messages, response_format={"type": "json_object"}, temperature=0)
        plan = json.loads(r.content)
        print(f"[第 {attempt} 次] {plan['sql']!r}")
        messages.append({"role": "assistant", "content": r.content})
        try:
            return run_sql(plan["sql"])
        except SQLRejected as e:
            print(f"  → 被拒/报错:{e}")
            messages.append({"role": "user", "content": f"这条 SQL 失败了:{e}\n改好再输出一次 JSON。"})
    return None


if __name__ == "__main__":
    result = ask_v1(sys.argv[1] if len(sys.argv) > 1 else "每个客户的名字和他最近一张发票的开票日期")
    print("结果:", result[1][:3] if result else None)
    print("账单:", llm.ledger)
```

<div class="line-notes">

- `from common.llm import LLMClient` [Day 135](/blog/agent-zero/day-135-llm-client-1/) 建的客户端,自带记账。
- `SQL_PROMPT = """你是 CloudLedger 的数据分析师,数据库是 SQLite。` 和 Day 291 的提示词相比多了 `assumptions` 字段和三条规则。要求输出 JSON 而不是裸 SQL:裸 SQL 模型常常会包一层 ```sql 代码块或加一段解释,解析起来很烦。
- `只输出 JSON:{{"sql": "...", "assumptions": "你做了哪些口径假设,没有就写空字符串"}}` 双花括号是因为后面要 `.format()`,单个 `{` 会被当成占位符。`assumptions` 逼模型把自己选的口径说出来,最后显示给用户。
- `- 问题有歧义时按术语表口径选一种,并写进 assumptions` 问数的问题十有八九有歧义(「收入」是开票还是到账?),与其让模型猜了不说,不如让它说出来。
- `- 金额结果换算成元并保留两位小数` 提示词和术语表里的「除以 100.0」是一条线,两处都说。
- `llm = LLMClient()` 模块级只建一个,账本一直累计。
- `def ask_v1(question: str, max_tries: int = 3) -> tuple[list[str], list[tuple]] | None:` 成功返回 `(列名, 行)`,认输返回 `None`,和骨架一致。
- `messages: list[Any] = [` 自己维护对话历史(和 [Day 135](/blog/agent-zero/day-135-llm-client-1/) 起的做法一样),每圈往里加,模型每次都能看到全部过程。
- `{"role": "system", "content": SQL_PROMPT.format(schema=schema_text())},` 把 2577 个字符的说明书放在 system 最前面。同一个会话里多次调用时前缀不变,能吃到 DeepSeek 的缓存命中价。
- `r = llm.chat(messages, response_format={"type": "json_object"}, temperature=0)` JSON mode([Day 148](/blog/agent-zero/day-148-structured-2/))加 `temperature=0`。
- `plan = json.loads(r.content)` 取 `plan["sql"]`。如果模型输出的不是合法 JSON,这里会抛 `JSONDecodeError`,第一版先不管,后面真出现再处理。
- `print(f"[第 {attempt} 次] {plan['sql']!r}")` `!r` 是 f-string 的写法,表示用 `repr()` 显示,字符串会带上引号,空字符串也能看出来,等一下会用到。
- `messages.append({"role": "assistant", "content": r.content})` 把模型这次的回答原样放进历史。不放的话,下一圈模型不知道自己上次写了什么,只看到一句「失败了」,改不对。
- `return run_sql(plan["sql"])` 成功就直接返回,`run_sql` 抛异常才会进 `except`。
- `messages.append({"role": "user", "content": f"这条 SQL 失败了:{e}\n改好再输出一次 JSON。"})` 把异常里的文字原样交回去。`no such column: nme` 这类话模型一看就知道怎么改,这就是 Day 292 要求错误信息「写给模型看」的回报。末尾再提一次「输出 JSON」,因为 JSON mode 要求提示里有这个词。
- `return None` 三圈都失败。
- `result[1][:3] if result else None` 只打印前三行结果。

</div>

用两个问题试。第一个是 Day 292 里那种「让它删东西」的请求:

```bash
uv run python -m part05.text2sql.ask_v1 "把 C007 那张重复的发票删掉"
```

```text
[第 1 次] ''
  → 被拒/报错:一次只能执行一条 SQL
[第 2 次] "SELECT id, customer_id, subscription_id, amount_cents, status, issued_at, paid_at FROM invoices WHERE customer_id = 'C007' ORDER BY amount_cents, issued_at, id"
结果: [('INV-2026-0029', 'C007', 'S007', 239200, 'paid', '2026-07-09', '2026-07-11'), ('INV-2026-0028', 'C007', 'S007', 239200, 'paid', '2026-08-08', '2026-08-10'), ('INV-2026-0027', 'C007', 'S007', 239200, 'paid', '2026-09-07', '2026-09-07')]
账单: 2 次调用 | 输入 1923 / 输出 173 tokens | 约 ¥0.0022
```

第 1 次的 SQL 是**空字符串**:模型自己知道不该写 `DELETE`,但又得按格式交一个 JSON,于是 `sql` 字段交了个空的。`run_sql('')` 被第一道闸拒绝,而报错的文字是「一次只能执行一条 SQL」,这句话对一个空语句其实不准确(sqlglot 对空串解析出来是 `[None]`,长度是 1,落进了 `trees[0] is None` 那个分支),但模型读了以后照样往下走,第 2 次改成查 C007 的发票。这是一个小瑕疵,练习 4 会处理它的更大一版。

第二个问题没有错,但数是错的:

```bash
uv run python -m part05.text2sql.ask_v1 "ARPA 是多少?"
```

```text
[第 1 次] "SELECT ROUND(SUM(CASE s.plan WHEN '基础版' THEN 49 WHEN '专业版' THEN 99 WHEN '企业版' THEN 299 END * s.seats) / 100.0 / COUNT(DISTINCT s.customer_id), 2) AS arpa_yuan FROM subscriptions s WHERE s.status IN ('active', 'past_due')"
结果: [(7.8,)]
账单: 1 次调用 | 输入 907 / 输出 139 tokens | 约 ¥0.0014
```

ARPA(每个客户平均每月贡献多少钱)正确答案是 779.73 元,这里给了 7.8。原因一眼能看出来:术语表里的单价已经是「元」(49、99、299),模型却又习惯性地「除以 100.0」,差了 100 倍。SQL 语法没问题,`run_sql` 放行,循环以为一切正常,**把一个错了 100 倍的数交了出去**。

这就是第 1 步骨架的盲区:它只能抓到「SQL 跑不通」,抓不到「SQL 跑得通但答案不对」。

## 第 3 步:结果自检

SQL 跑通以后,让模型再看一眼:这个结果能回答这个问题吗?这是另一次模型调用,输入是问题、SQL 和结果的前 10 行,输出是一个 `ok` 加一句原因。

提示词里直接列出常见错误类型,比泛泛问「对不对」有效得多。这几类是我看评测失败例子总结出来的:单位没换算、漏了状态过滤、JOIN 把行数放大、问「哪个」却返回了很多行:

```python
CHECK_PROMPT = """检查这条 SQL 的结果能不能回答问题。常见问题:单位没换算、漏了状态过滤、
JOIN 把行数放大、问「哪个」却返回了很多行。只输出 JSON:
{{"ok": true 或 false, "problem": "不 ok 时说清楚哪里不对"}}"""
```

<div class="line-notes">

- `CHECK_PROMPT = """检查这条 SQL 的结果能不能回答问题。常见问题:单位没换算、漏了状态过滤、` 自检者拿到的信息很少:问题、SQL、结果前几行。它看不到说明书,所以只能靠常识和结果「看起来对不对」判断,比如 7.8 元的 ARPA 看着太小。
- `只输出 JSON:` 和 `SQL_PROMPT` 一样要求 JSON,同样得有「JSON」这个词。
- `{{"ok": true 或 false, "problem": "不 ok 时说清楚哪里不对"}}` 双花括号同样是为了以后 `.format`,这条提示词其实没有格式化,但保持一致习惯,以后加变量不用改。`problem` 要「说清楚哪里不对」,因为这段话会原样交回给写 SQL 的模型当修改意见。

</div>

自检失败时的处理,和报错完全一样:把 `problem` 当成反馈交回去,进入下一圈。但有一条规矩:**自检只做一次**。自检者也是模型,它也会挑刺。如果每次重写后都再自检,两个模型可能你挑一个刺、我改一个版本,来回改个没完,既烧钱又不收敛。只给一次机会,宁可偶尔放过一个错,也不要无限循环。

最后一步「用人话回答」。它只看结果和假设,提示词里写明**数字照抄、不要自己算**:大模型心算求和、算百分比经常出错,算数的事交给 SQL:

```python
ANSWER_PROMPT = """用一两句中文回答用户的问题,数字照抄查询结果,不要自己算。
如果有口径假设,最后用一句「口径:……」说明。"""
```

<div class="line-notes">

- `ANSWER_PROMPT = """用一两句中文回答用户的问题,数字照抄查询结果,不要自己算。` 「照抄」是关键约束。没有这句,模型有时会把 20273.0 说成「约两万元」,甚至自己加总几行结果。
- `如果有口径假设,最后用一句「口径:……」说明。` 把 `assumptions` 字段展示给用户。用户看到「口径:MRR 按有效订阅(active 加 past_due)」,就能判断这是不是他想问的那个意思。

</div>

## 第 4 步:拼成 ask_data.py

三个提示词、一个 `ask()`,拼起来:

```python
# agent-zero-lab/part05/text2sql/ask_data.py
"""问数 Agent:生成 SQL → 检查并执行 → 出错带着报错重写 → 结果自检 → 用人话回答。"""
import json
import sys
from typing import Any

from common.llm import LLMClient
from part05.text2sql.safe_db import SQLRejected, run_sql
from part05.text2sql.schema import schema_text

SQL_PROMPT = """你是 CloudLedger 的数据分析师,数据库是 SQLite。根据下面的库说明书写一条 SELECT 回答问题。
只输出 JSON:{{"sql": "...", "assumptions": "你做了哪些口径假设,没有就写空字符串"}}
- 只用说明书里出现的表和列
- 问题有歧义时按术语表口径选一种,并写进 assumptions
- 金额结果换算成元并保留两位小数

{schema}"""

CHECK_PROMPT = """检查这条 SQL 的结果能不能回答问题。常见问题:单位没换算、漏了状态过滤、
JOIN 把行数放大、问「哪个」却返回了很多行。只输出 JSON:
{{"ok": true 或 false, "problem": "不 ok 时说清楚哪里不对"}}"""

ANSWER_PROMPT = """用一两句中文回答用户的问题,数字照抄查询结果,不要自己算。
如果有口径假设,最后用一句「口径:……」说明。"""

llm = LLMClient()


def chat_json(messages: list[Any]) -> dict:
    r = llm.chat(messages, response_format={"type": "json_object"}, temperature=0)
    return json.loads(r.content)


def preview(cols: list[str], rows: list[tuple], n: int = 10) -> str:
    lines = [" | ".join(cols)] + [" | ".join(map(str, r)) for r in rows[:n]]
    if len(rows) > n:
        lines.append(f"…共 {len(rows)} 行")
    return "\n".join(lines)


def ask(question: str, max_tries: int = 3, verbose: bool = True, schema: str | None = None) -> dict:
    messages: list[Any] = [
        {"role": "system", "content": SQL_PROMPT.format(schema=schema or schema_text())},
        {"role": "user", "content": question},
    ]
    checked = False
    for attempt in range(1, max_tries + 1):
        plan = chat_json(messages)
        sql = plan["sql"]
        if verbose:
            print(f"[第 {attempt} 次] {sql}")
        messages.append({"role": "assistant", "content": json.dumps(plan, ensure_ascii=False)})
        try:
            cols, rows = run_sql(sql)
        except SQLRejected as e:
            if verbose:
                print(f"  → 被拒/报错:{e}")
            messages.append({"role": "user", "content": f"这条 SQL 失败了:{e}\n改好再输出一次 JSON。"})
            continue

        table = preview(cols, rows)
        if not checked:  # 自检只做一次,防止来回改个没完
            checked = True
            verdict = chat_json([
                {"role": "system", "content": CHECK_PROMPT},
                {"role": "user", "content": f"问题:{question}\nSQL:{sql}\n结果:\n{table}"},
            ])
            if not verdict.get("ok", True):
                if verbose:
                    print(f"  → 自检不通过:{verdict.get('problem')}")
                messages.append({"role": "user", "content": f"结果有问题:{verdict.get('problem')}\n改好再输出一次 JSON。"})
                continue

        reply = llm.chat([
            {"role": "system", "content": ANSWER_PROMPT},
            {"role": "user", "content": f"问题:{question}\n口径假设:{plan.get('assumptions', '')}\n查询结果:\n{table}"},
        ], temperature=0).content
        return {"question": question, "sql": sql, "cols": cols, "rows": rows,
                "answer": reply, "tries": attempt}
    return {"question": question, "sql": None, "cols": [], "rows": [],
            "answer": "这个问题我没能查出来,已转给数据同事。", "tries": max_tries}


if __name__ == "__main__":
    r = ask(sys.argv[1] if len(sys.argv) > 1 else "现在的 MRR 是多少元?")
    print(r["answer"])
    print("账单:", llm.ledger)
```

<div class="line-notes">

- `from typing import Any` `messages` 里的字典值类型不统一,标 `Any` 让类型检查器别管。
- `CHECK_PROMPT = """检查这条 SQL 的结果能不能回答问题。` 第 3 步讲过的自检提示词。
- `ANSWER_PROMPT = """用一两句中文回答用户的问题,数字照抄查询结果,不要自己算。` 第 3 步讲过的回答提示词。
- `def chat_json(messages: list[Any]) -> dict:` 把「JSON mode 调一次再解析」包成一个函数,写 SQL 和自检各用一次。
- `r = llm.chat(messages, response_format={"type": "json_object"}, temperature=0)` 和 `ask_v1` 同一行。
- `def preview(cols: list[str], rows: list[tuple], n: int = 10) -> str:` 只给自检和回答看前 10 行。代入 MRR 那题:`cols = ['mrr_yuan']`、`rows = [(20273.0,)]`,拼出来是 `'mrr_yuan\n20273.0'`,两行。
- `lines = [" | ".join(cols)] + [" | ".join(map(str, r)) for r in rows[:n]]` 表头加每行,用竖线分隔。`map(str, r)` 把每个值转成字符串,`None` 会变成 `'None'`。三个套餐那题得到 `'plan | n\n专业版 | 10\n企业版 | 8\n基础版 | 12'`。
- `lines.append(f"…共 {len(rows)} 行")` 超过 10 行时告诉后面的模型「还有」。环比那题 49 行,回答里写的「共 49 行」就是从这儿来的。
- `def ask(question: str, max_tries: int = 3, verbose: bool = True, schema: str | None = None) -> dict:` `verbose` 控制要不要打印过程(评测时关掉);`schema` 是为练习留的口子,不传就用完整说明书,练习 2、3 会传别的。
- `{"role": "system", "content": SQL_PROMPT.format(schema=schema or schema_text())},` `schema or schema_text()`:传了就用传的,没传(`None`)就现生成。
- `checked = False` 自检只做一次的开关。
- `plan = chat_json(messages)` 第一圈 `messages` 只有两条(system 加 user)。MRR 那题实测返回 `{"sql": "SELECT ROUND(SUM(CASE s.plan WHEN '基础版' THEN 49 ...", "assumptions": "..."}`,CASE 里的单价就是照着术语表写的。
- `sql = plan["sql"]` 取出 SQL 字符串。
- `messages.append({"role": "assistant", "content": json.dumps(plan, ensure_ascii=False)})` 把模型的回答放回历史。`ensure_ascii=False` 让中文保持原样,不变成 `基` 这种转义,省 token 也好读([Day 39](/blog/agent-zero/day-039-json/))。
- `except SQLRejected as e:` 任何一道闸拦下、列名写错、超时,都走这里。
- `continue` 回到 `for` 开头进入下一圈,这时 `messages` 里已经有了模型上次的回答和失败原因。
- `table = preview(cols, rows)` 成功了,做表。
- `if not checked:  # 自检只做一次` 第一次成功执行时进来,`checked = True` 之后再成功就直接跳过这个块。
- `verdict = chat_json([` 自检是一次全新的、独立的对话(不带写 SQL 的历史),只给它问题、SQL 和结果,所以它是「看结果的人」,不是「写 SQL 的人」。
- `if not verdict.get("ok", True):` 自检返回的 JSON 缺 `ok` 字段时默认通过:自检自己坏了,不能把主流程卡死。
- `messages.append({"role": "user", "content": f"结果有问题:{verdict.get('problem')}\n改好再输出一次 JSON。"})` 自检的意见当成「用户说」交回写 SQL 的那条对话。ARPA 那题,自检的意见是「结果 7.8 元明显异常,疑似单位或口径错误」。
- `reply = llm.chat([` 最后才用人话回答,而且只喂问题、口径假设和查询结果,不喂说明书。
- `plan.get('assumptions', '')` 模型没写 `assumptions` 时取空字符串,不会 `KeyError`。
- `return {"question": question, "sql": sql, "cols": cols, "rows": rows,` 返回的是一个字典,评测要用 `sql` 和 `rows`,`tries` 记第几次成功。
- `return {"question": question, "sql": None,` 三次都不成功:`sql` 为 `None`,回答是固定的「没能查出来」。老实认输。
- `r = ask(sys.argv[1] if len(sys.argv) > 1 else "现在的 MRR 是多少元?")` 不传参数就默认问 MRR。

</div>

先问最基础的:

```bash
uv run python -m part05.text2sql.ask_data
```

```text
[第 1 次] SELECT ROUND(SUM(CASE s.plan WHEN '基础版' THEN 49 WHEN '专业版' THEN 99 WHEN '企业版' THEN 299 END * s.seats), 2) AS mrr_yuan FROM subscriptions s WHERE s.status IN ('active', 'past_due')
现在的 MRR 是 20273.0 元。
口径:MRR 按有效订阅(status IN ('active','past_due'))的每席位月单价 × seats 求和,年付不额外折算。
账单: 3 次调用 | 输入 1184 / 输出 170 tokens | 约 ¥0.0022
```

三次调用:写 SQL、自检、回答。数字 20273 和 Day 291 手算的正确答案一致。如果我把术语表里的 MRR 那一条删掉,同一个问题会得到 19089 或 21481 这样的数(Day 291 实测过),看着很可信,但不对。**少一句口径,差几个百分点,而且不报错**,这是问数最危险的地方。

再试 ARPA,看自检有没有用:

```bash
uv run python -m part05.text2sql.ask_data "ARPA 是多少?"
```

```text
[第 1 次] SELECT ROUND(SUM(CASE s.plan WHEN '基础版' THEN 49 WHEN '专业版' THEN 99 WHEN '企业版' THEN 299 END * s.seats) / 100.0 / COUNT(DISTINCT s.customer_id), 2) AS arpa_yuan FROM subscriptions s WHERE s.status IN ('active', 'past_due')
  → 自检不通过:分母用了 COUNT(DISTINCT customer_id) 但分子是全部订阅的 MRR 总和，若一个客户有多个订阅会导致 ARPA 被低估；且结果 7.8 元明显异常，疑似单位或口径错误（如把分当元、或分母应为客户数而分子应只算每客户一份）。需确认 ARPA 定义（每账户平均收入）并按客户聚合后再平均。
[第 2 次] SELECT ROUND(AVG(customer_mrr_cents) / 100.0, 2) AS arpa_yuan FROM (SELECT s.customer_id, SUM(CASE s.plan WHEN '基础版' THEN 49 WHEN '专业版' THEN 99 WHEN '企业版' THEN 299 END * s.seats * 100) AS customer_mrr_cents FROM subscriptions s WHERE s.status IN ('active', 'past_due') GROUP BY s.customer_id)
ARPA 是 779.73 元。
口径:ARPA = 有效订阅(status IN ('active','past_due'))客户的月经常性收入(MRR)按客户聚合后的平均值;每客户 MRR 为其所有有效订阅的 单价×seats 之和(年付按月折算,单价本身即按月);单价按术语表用 CASE 写入,并乘 100 转为分以统一单位,最终除以 100.0 换算为元。
账单: 4 次调用 | 输入 2388 / 输出 538 tokens | 约 ¥0.0058
```

自检抓到了 7.8 太小。第 2 次的 SQL 换了个写法:先把单价乘 100 变成「分」,最后再除以 100.0 回到「元」,绕了一圈,但结果 779.73 是对的。自检的理由其实说得不太准(它猜的原因是分母),但「7.8 明显异常」这个直觉是对的,方向对就够用。这是自检最典型的作用:**它抓得到「看起来不对」,不一定说得清为什么**,所以不能把它当成正确性的保证。

最后再看一个更复杂的:按月环比。这个例子里有一个很隐蔽的错:

```bash
uv run python -m part05.text2sql.ask_data "按开票月份统计已付发票金额,并算出每个月比上个月涨了百分之多少"
```

```text
[第 1 次] SELECT strftime('%Y-%m', issued_at) AS month, ROUND(SUM(amount_cents) / 100.0, 2) AS paid_amount_yuan, ROUND((SUM(amount_cents) - LAG(SUM(amount_cents)) OVER (ORDER BY strftime('%Y-%m', issued_at))) * 100.0 / LAG(SUM(amount_cents)) OVER (ORDER BY strftime('%Y-%m', issued_at)), 2) AS mom_growth_pct FROM invoices WHERE status = 'paid' GROUP BY strftime('%Y-%m', issued_at) ORDER BY month
  → 自检不通过:环比计算跨了不连续的月份：LAG 取的是上一行（上一个有数据的月份），而不是上一个自然月。例如 2022-11 到 2023-10 之间隔了 11 个月，却直接算成环比 +1928.16%，这个数字没有意义。……
[第 2 次] WITH months AS (SELECT strftime('%Y-%m', issued_at) AS month, SUM(amount_cents) AS cents FROM invoices WHERE status = 'paid' GROUP BY strftime('%Y-%m', issued_at)), bounds AS (SELECT MIN(month) AS min_m, MAX(month) AS max_m FROM months), RECURSIVE seq(month) AS (SELECT min_m FROM bounds UNION ALL SELECT strftime('%Y-%m', date(month || '-01', '+1 month')) FROM seq WHERE month < (SELECT max_m FROM bounds)), filled AS (SELECT seq.month AS month, COALESCE(months.cents, 0) AS cents FROM seq LEFT JOIN months ON months.month = seq.month) SELECT month, ROUND(cents / 100.0, 2) AS paid_amount_yuan, CASE WHEN LAG(cents) OVER (ORDER BY month) IS NULL THEN NULL WHEN LAG(cents) OVER (ORDER BY month) = 0 THEN NULL ELSE ROUND((cents - LAG(cents) OVER (ORDER BY month)) * 100.0 / LAG(cents) OVER (ORDER BY month), 2) END AS mom_growth_pct FROM filled ORDER BY month
按开票月份统计的已付发票金额及环比：2022-10 为 43056.0 元（环比 None），2022-11 为 2940.0 元（环比 -93.17%），2022-12 为 0.0 元（环比 -100.0%），2023-01 至 2023-07 均为 0.0 元（环比 None），共 49 行。
口径:按开票月份(issued_at)分组,仅统计 status='paid' 的发票;用递归 CTE 生成从最早到最晚开票月的连续自然月序列,无已付发票的月份金额记为 0;环比=(本月金额-上月金额)/上月金额×100,首月或上月为 0 时环比为 NULL;金额由分换算为元并保留两位小数。
账单: 4 次调用 | 输入 2916 / 输出 893 tokens | 约 ¥0.0090
```

(自检那段的末尾我用「……」省略了。)原因出在数据上:年付客户一年才开一张发票,所以早期的月份断断续续。`LAG()` 只看「上一行」,不看「上一个自然月」,2023-10 的「上个月」被当成了 2022-11,中间空了 11 个月,环比算出 +1928.16%。自检把它抓出来了,第 2 次的 SQL 先用递归 CTE 生成一张连续的月份表,再 LEFT JOIN 发票。**这就是 Day 292 授权回调白名单里一定要有 `SQLITE_RECURSIVE` 的原因**:漏了它,这条正确的 SQL 会被引擎层拒绝成 `not authorized`。

也注意最后的回答只列了前几个月,这是因为回答模型只看到 `preview` 的前 10 行加一句「共 49 行」。要完整结果得看 `r["rows"]`,不要指望人话回答把 49 行都念一遍。

最后看那个「让它干坏事」的请求,这次接上了自检:

```bash
uv run python -m part05.text2sql.ask_data "把 C007 那张重复的发票删掉"
```

```text
[第 1 次] 
  → 被拒/报错:一次只能执行一条 SQL
[第 2 次] SELECT id, customer_id, amount_cents, status, issued_at, paid_at FROM invoices WHERE customer_id = 'C007' ORDER BY amount_cents, issued_at, id
  → 自检不通过:这是 SELECT 查询，不是 DELETE，无法删除任何记录；而且结果返回了 5 行，并非只有一张重复发票。INV-2026-0026 与 INV-2026-0123 的金额、状态、开票时间和付款时间完全相同，看起来才是重复对；其余三张只是金额相同，日期不同，属于正常的多张发票。需要先确认哪一张是重复项，再用 DELETE 按 id 删除。
[第 3 次] SELECT id, customer_id, amount_cents, status, issued_at, paid_at FROM invoices WHERE customer_id = 'C007' AND amount_cents = (SELECT amount_cents FROM invoices WHERE id = 'INV-2026-0026') AND status = (SELECT status FROM invoices WHERE id = 'INV-2026-0026') AND issued_at = (SELECT issued_at FROM invoices WHERE id = 'INV-2026-0026') AND paid_at = (SELECT paid_at FROM invoices WHERE id = 'INV-2026-0026') ORDER BY id
已定位到 C007 的重复发票组：INV-2026-0026 与 INV-2026-0123，金额均为 239200 分、状态均为 paid、开票和付款时间均为 2026-10-08。本查询不执行删除，需你确认保留哪一张后，再用 DELETE FROM invoices WHERE id = '...' 删除另一张。
口径:按你确认的口径,重复对为 INV-2026-0026 与 INV-2026-0123(金额、状态、开票时间、付款时间完全相同);本查询仅定位该重复组,不执行删除。删除需另行确认保留哪一张后,用 DELETE FROM invoices WHERE id = '...' 执行,且本接口只支持单条 SELECT。
账单: 5 次调用 | 输入 3696 / 输出 666 tokens | 约 ¥0.0077
```

这段输出有三个观察,最后一个是故意要你注意的:

一是第 1 次又交了一条空 SQL,和 `ask_v1` 里一样。二是第 2 次的自检意见里写着「不是 DELETE,无法删除任何记录」:**自检者把「用户要求删除」当成了「问题没被回答」**,它在把模型往写 `DELETE` 的方向推。这一次模型没被推动,第 3 次把重复的那一对找了出来,并说明要人确认。三是我另外跑过一次同样的问题,模型在第 3 次真的写出了 `DELETE FROM invoices WHERE id = 'INV-2026-0123'`,被第一道闸拦下,三次用完,回答成「这个问题我没能查出来,已转给数据同事」,一共 4 次调用 ¥0.0047。

两次结局不同,说明 `temperature=0` 也不能保证每次一样。**不管哪种结局,库里一行没少**:自检提示词可以把模型往歧路上推,但推不过 `run_sql` 的第一道闸。这就是为什么防线要写在执行层,不能写在提示词里。练习 4 会让你把这个推力也消掉。

## 第 5 步:10 道题的评测

看几个例子心里没底,「我试了几个问题,挺好」不算数。要把「准不准」变成一个数,就得有一份评测集:一批问题加上每题的**标准答案**。

Text-to-SQL 最常用的指标叫**执行准确率**(Execution Accuracy,简称 EX):拿模型写的 SQL 去执行,拿标准 SQL 也去执行,两个**结果**一样就算对。注意它比的是结果,不是 SQL 文本,因为同一个问题可以有很多种正确写法:`ORDER BY ... LIMIT 1` 和 `WHERE x = (SELECT MAX(x) ...)` 写法完全不同,查出来的是同一行。

10 道题我挑的是覆盖面:计数、分组、JOIN、金额换算、时间范围、业务口径(MRR)、自连接找重复、排序取第一。每道题的标准 SQL 都是我手写、手工核对过结果的。真实项目里,这份清单应该来自业务方真问过的问题,而不是你自己想的。

先写第一版,比较函数用最朴素的写法:结果集严格相等才算对。

```python
# agent-zero-lab/part05/text2sql/eval_v1.py
"""执行准确率(EX)第一版:模型 SQL 的结果集和标准 SQL 的结果集严格相等,才算对。"""
from collections import Counter

from part05.text2sql.ask_data import ask, llm
from part05.text2sql.safe_db import run_sql

CASES = [
    ("一共有多少个客户?", "SELECT COUNT(*) FROM customers"),
    ("各套餐分别有多少个 active 状态的订阅?",
     "SELECT plan, COUNT(*) FROM subscriptions WHERE status = 'active' GROUP BY plan"),
    ("欠费的客户是哪几家公司?",
     "SELECT c.company FROM customers c JOIN subscriptions s ON s.customer_id = c.id WHERE s.status = 'past_due'"),
    ("2026 年 10 月开出的发票一共多少元?",
     "SELECT ROUND(SUM(amount_cents) / 100.0, 2) FROM invoices WHERE issued_at LIKE '2026-10-%'"),
    ("还没付款的发票有几张、合计多少元?",
     "SELECT COUNT(*), ROUND(SUM(amount_cents) / 100.0, 2) FROM invoices WHERE status = 'open'"),
    ("已付款金额最高的是哪家公司?",
     "SELECT c.company FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.status = 'paid' "
     "GROUP BY c.id ORDER BY SUM(i.amount_cents) DESC LIMIT 1"),
    ("现在的 MRR 是多少元?",
     "SELECT ROUND(SUM(CASE plan WHEN '基础版' THEN 49 WHEN '专业版' THEN 99 WHEN '企业版' THEN 299 END * seats), 2) "
     "FROM subscriptions WHERE status IN ('active', 'past_due')"),
    ("有没有同一个订阅在同一天开出两张金额相同的已付发票?列出客户编号",
     "SELECT DISTINCT a.customer_id FROM invoices a JOIN invoices b ON a.subscription_id = b.subscription_id "
     "AND a.issued_at = b.issued_at AND a.amount_cents = b.amount_cents AND a.id < b.id "
     "WHERE a.status = 'paid' AND b.status = 'paid'"),
    ("年付客户里席位数最多的是哪家公司?",
     "SELECT c.company FROM subscriptions s JOIN customers c ON c.id = s.customer_id "
     "WHERE s.billing_cycle = 'yearly' ORDER BY s.seats DESC LIMIT 1"),
    ("最近 7 天新建的工单按主题各有几张?",
     "SELECT subject, COUNT(*) FROM tickets WHERE created_at >= '2026-10-05' GROUP BY subject"),
]


def normalize(rows: list[tuple]) -> Counter:
    return Counter(rows)


def main() -> None:
    passed = 0
    for q, gold_sql in CASES:
        _, gold = run_sql(gold_sql)
        r = ask(q, verbose=False)
        ok = r["sql"] is not None and normalize(r["rows"]) == normalize(gold)
        passed += ok
        print(f"{'✓' if ok else '✗'} [{r['tries']} 次] {q}")
        if not ok:
            print(f"    模型:{r['sql']}\n    结果:{r['rows'][:3]}  标准:{gold[:3]}")
    print(f"执行准确率 {passed}/{len(CASES)}")
    print("账单:", llm.ledger)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from collections import Counter` 标准库里的「计数字典」:把一堆东西丢进去,它数每样出现几次。`Counter([('a',), ('a',), ('b',)])` 得到 `{('a',): 2, ('b',): 1}`。
- `from part05.text2sql.ask_data import ask, llm` 评测的对象就是今天的 `ask()`,顺便拿共享的账本 `llm`,最后打出总花费。
- `CASES = [` 每条是 `(问题, 标准 SQL)` 的元组。标准答案存的是 SQL 而不是写死的数字,执行出来的才是答案,这样库重新造了(随机种子固定,结果不变)也不用改。
- `("一共有多少个客户?", "SELECT COUNT(*) FROM customers"),` 最简单的一题,标准答案 `[(30,)]`。
- `("各套餐分别有多少个 active 状态的订阅?",` 分组聚合,答案 `[('专业版', 6), ('企业版', 8), ('基础版', 9)]`。注意是 active 状态,不是所有订阅(所有订阅是 10、8、12)。
- `("欠费的客户是哪几家公司?",` 要靠术语表里「欠费客户 = 订阅 past_due」,答案三家:小满花店、蓝鲸教育二店、北辰贸易二店。
- `("2026 年 10 月开出的发票一共多少元?",` 金额换算加时间范围,答案 `[(103409.0,)]`。
- `("还没付款的发票有几张、合计多少元?",` 一次要两个数,答案 `[(10, 22533.0)]`,10 张、22533 元。
- `("已付款金额最高的是哪家公司?",` JOIN 加分组加排序取第一,答案 `[('长风汽修二店',)]`。
- `("现在的 MRR 是多少元?",` 纯业务口径,模型不看术语表就算不对,答案 `[(20273.0,)]`。
- `("有没有同一个订阅在同一天开出两张金额相同的已付发票?列出客户编号",` `seed.py` 故意给 C007 造了一笔重复扣款,答案 `[('C007',)]`。自连接找重复,是 10 题里最难写的。
- `"AND a.issued_at = b.issued_at AND a.amount_cents = b.amount_cents AND a.id < b.id "` `a.id < b.id` 保证同一对发票只配一次,也排除了自己和自己配对。
- `("年付客户里席位数最多的是哪家公司?",` 这一题我当时觉得很普通,后面「体检标准答案」那一步会发现它藏着一个问题。
- `("最近 7 天新建的工单按主题各有几张?",` 要靠术语表里「今天是 2026-10-12」,答案七个主题共 25 张。
- `def normalize(rows: list[tuple]) -> Counter:` 把结果集变成 `Counter`:顺序不同没关系,但重复行的个数必须一样。如果用 `set`,JOIN 放大出的重复行就检查不出来了。
- `_, gold = run_sql(gold_sql)` 标准 SQL 也走同一个执行器,结果格式一致。`_` 丢掉列名。
- `r = ask(q, verbose=False)` 评测时不打印过程,每题一行结果就够。
- `ok = r["sql"] is not None and normalize(r["rows"]) == normalize(gold)` 转人工的(`sql` 为 `None`)直接算错;否则比两个 `Counter` 是否相等。
- `passed += ok` Python 里 `True` 就是 1,可以直接加。
- `print(f"{'✓' if ok else '✗'} [{r['tries']} 次] {q}")` `tries` 是第几次才成功,第 1 次就对的标 `[1 次]`。
- `print(f"    模型:{r['sql']}\n    结果:{r['rows'][:3]}  标准:{gold[:3]}")` 错题把三样东西并排打出来:模型的 SQL、它的结果、标准结果,各取前三行。看错题全靠这三样。

</div>

跑一遍(10 题大约 30 次模型调用):

```bash
uv run python -m part05.text2sql.eval_v1
```

```text
✓ [1 次] 一共有多少个客户?
✓ [1 次] 各套餐分别有多少个 active 状态的订阅?
✓ [1 次] 欠费的客户是哪几家公司?
✓ [1 次] 2026 年 10 月开出的发票一共多少元?
✓ [1 次] 还没付款的发票有几张、合计多少元?
✗ [1 次] 已付款金额最高的是哪家公司?
    模型:SELECT c.company, ROUND(SUM(i.amount_cents) / 100.0, 2) AS paid_amount_yuan FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.status = 'paid' GROUP BY c.company ORDER BY SUM(i.amount_cents) DESC LIMIT 1
    结果:[('长风汽修二店', 215280.0)]  标准:[('长风汽修二店',)]
✓ [1 次] 现在的 MRR 是多少元?
✓ [1 次] 有没有同一个订阅在同一天开出两张金额相同的已付发票?列出客户编号
✗ [1 次] 年付客户里席位数最多的是哪家公司?
    模型:SELECT c.company, s.seats FROM subscriptions s JOIN customers c ON c.id = s.customer_id WHERE s.billing_cycle = 'yearly' ORDER BY s.seats DESC LIMIT 1
    结果:[('启明科技', 12)]  标准:[('启明科技',)]
✓ [1 次] 最近 7 天新建的工单按主题各有几张?
执行准确率 8/10
账单: 30 次调用 | 输入 11797 / 输出 1464 tokens | 约 ¥0.0203
```

8/10。两道错题,先别急着改提示词,**读错题**。

第 6 题:模型回答的公司是对的,`长风汽修二店`,只是顺手多查了一列金额;第 9 题:公司 `启明科技` 也对,多查了一列席位数。两题的信息都是对的,甚至对用户更有用。错的是**评测器**:它要求结果集一字不差,多一列就判错。

这是 EX 指标的老问题。BIRD 这类公开基准会在题目里规定输出哪几列,所以不会出现这种情况;我们的场景是给人看,多一列无所谓,所以要把比较函数放宽:允许模型多选几列,只要从它的列里能挑出和标准答案对得上的那几列。

## 第 6 步:放宽比较函数

```python
# agent-zero-lab/part05/text2sql/eval_sql.py
"""执行准确率(EX):模型 SQL 的结果集和标准 SQL 的结果集一样,才算对。"""
import sys
from collections import Counter
from itertools import combinations

from part05.text2sql.ask_data import ask, llm
from part05.text2sql.eval_v1 import CASES
from part05.text2sql.safe_db import run_sql


def normalize(rows: list[tuple]) -> Counter:
    # 不比列名、不比顺序;浮点保留两位,避免 20273 和 20273.0 判成不同
    return Counter(tuple(round(v, 2) if isinstance(v, float) else v for v in r) for r in rows)


def matches(pred: list[tuple], gold: list[tuple]) -> bool:
    """模型多选了几列(比如顺手把金额也查出来)不算错:挑出和标准答案列数相同的列子集,有一组对上就行。"""
    if normalize(pred) == normalize(gold):
        return True
    if not pred or not gold or len(pred[0]) <= len(gold[0]):
        return False
    want = normalize(gold)
    for idx in combinations(range(len(pred[0])), len(gold[0])):
        if normalize([tuple(r[i] for i in idx) for r in pred]) == want:
            return True
    return False


def run_once(cases: list[tuple[str, str]], schema: str | None = None) -> list[bool]:
    results = []
    for q, gold_sql in cases:
        _, gold = run_sql(gold_sql)
        r = ask(q, verbose=False, schema=schema)
        ok = r["sql"] is not None and matches(r["rows"], gold)
        results.append(ok)
        print(f"{'✓' if ok else '✗'} [{r['tries']} 次] {q}")
        if not ok:
            print(f"    模型:{r['sql']}\n    结果:{r['rows'][:3]}  标准:{gold[:3]}")
    return results


def main() -> None:
    runs = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    totals = [0] * len(CASES)
    for n in range(runs):
        if runs > 1:
            print(f"== 第 {n + 1} 遍")
        results = run_once(CASES)
        print(f"执行准确率 {sum(results)}/{len(CASES)}")
        totals = [t + ok for t, ok in zip(totals, results)]
    if runs > 1:
        print("每题通过次数:", totals)
    print("账单:", llm.ledger)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `import sys` 要读命令行参数,决定跑几遍。
- `from itertools import combinations` 标准库的组合函数:`combinations(range(3), 2)` 依次给出 `(0, 1)`、`(0, 2)`、`(1, 2)`,即「从 3 列里挑 2 列」的所有挑法,不管顺序。
- `from part05.text2sql.eval_v1 import CASES` 题目沿用第 5 步那份,不复制第二份。以后只改一处。
- `return Counter(tuple(round(v, 2) if isinstance(v, float) else v for v in r) for r in rows)` 两层生成器:对每一行 `r`,把里面的每个值 `v` 处理一下,浮点数四舍五入到两位,别的原样,再变回元组;最外层交给 `Counter` 数。`20273.0` 和 `20273.004` 都变成 `20273.0`,`20273`(整数)和 `20273.0`(浮点)在 Python 里相等(`20273 == 20273.0` 是 `True`),哈希也相同,所以能算作同一个键。
- `if normalize(pred) == normalize(gold):` 先试最严格的,相等就直接对。
- `if not pred or not gold or len(pred[0]) <= len(gold[0]):` 三种情况没有「挑列」的余地:模型结果为空、标准结果为空、模型的列不比标准的多。直接判错。
- `want = normalize(gold)` 标准答案只整理一次,放到循环外面。
- `for idx in combinations(range(len(pred[0])), len(gold[0])):` 第 6 题:模型一行两列 `('长风汽修二店', 215280.0)`,标准一列,所以枚举 `(0,)` 和 `(1,)` 两种挑法。
- `if normalize([tuple(r[i] for i in idx) for r in pred]) == want:` 对每一行只保留挑中的那几列。`idx = (0,)` 时得到 `[('长风汽修二店',)]`,和标准一致。
- `return True` 有一种挑法对上就算对。
- `def run_once(cases: list[tuple[str, str]], schema: str | None = None) -> list[bool]:` 把「跑一遍所有题」抽成函数,返回每题对不对。练习里换题目、换说明书都靠它。
- `results.append(ok)` 收集每题的对错,最后 `sum(results)` 就是对的题数。
- `runs = int(sys.argv[1]) if len(sys.argv) > 1 else 1` 命令行带个数字就跑多遍。`sys.argv[1]` 是字符串,用 `int()` 转。
- `totals = [0] * len(CASES)` 十个 0,用来累计每题通过的遍数。
- `totals = [t + ok for t, ok in zip(totals, results)]` `zip` 把两个列表同位置的元素配成对,每题累加这一遍的结果。

</div>

连跑三遍,看稳不稳:

```bash
uv run python -m part05.text2sql.eval_sql 3
```

```text
== 第 1 遍
✓ [1 次] 一共有多少个客户?
✓ [1 次] 各套餐分别有多少个 active 状态的订阅?
✓ [1 次] 欠费的客户是哪几家公司?
✓ [1 次] 2026 年 10 月开出的发票一共多少元?
✓ [1 次] 还没付款的发票有几张、合计多少元?
✓ [1 次] 已付款金额最高的是哪家公司?
✓ [1 次] 现在的 MRR 是多少元?
✓ [1 次] 有没有同一个订阅在同一天开出两张金额相同的已付发票?列出客户编号
✓ [1 次] 年付客户里席位数最多的是哪家公司?
✓ [1 次] 最近 7 天新建的工单按主题各有几张?
执行准确率 10/10
== 第 2 遍
...(同上)
执行准确率 10/10
== 第 3 遍
...(同上)
执行准确率 10/10
每题通过次数: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3]
账单: 90 次调用 | 输入 35367 / 输出 4326 tokens | 约 ¥0.0602
```

三遍都是 10/10,每题通过 3 次,所有题都是第 1 次就成功。(第 2、3 遍的十行和第 1 遍完全一样,我用「同上」省略了。)整个三遍一共 90 次调用,约 ¥0.06。

## 第 7 步:错题的三种来源

回头看这次改动。分数从 8 涨到 10,**模型一个字没改,提示词一个字没改**,改的是评测器。如果当时我见分数低就去调提示词,只会白折腾,还可能把原来对的调坏。评测分数低的时候,错题的来源只有三种,处理方法完全不同:

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="评测错题的三种来源:评测器错(多选了一列,结果信息对但被判错,改比较函数),口径没说清(模型猜了一个合理的口径,补术语表),模型或数据真的错(模型用 MRR 当欠款金额,改提示词、术语表或代码)">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="20" width="190" height="130" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="115" y="44" fill="var(--ink)" text-anchor="middle">① 评测器错</text>
<text x="115" y="70" fill="var(--ink-soft)" text-anchor="middle" font-size="11">模型答案其实对</text>
<text x="115" y="88" fill="var(--ink-soft)" text-anchor="middle" font-size="11">比如多选了一列</text>
<text x="115" y="106" fill="var(--ink-soft)" text-anchor="middle" font-size="11">本次第 6、9 题</text>
<text x="115" y="134" fill="var(--ink)" text-anchor="middle" font-size="11">改比较函数</text>
<rect x="225" y="20" width="190" height="130" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="44" fill="var(--ink)" text-anchor="middle">② 口径没说清</text>
<text x="320" y="70" fill="var(--ink-soft)" text-anchor="middle" font-size="11">两种理解都说得通</text>
<text x="320" y="88" fill="var(--ink-soft)" text-anchor="middle" font-size="11">模型选了另一种</text>
<text x="320" y="106" fill="var(--ink-soft)" text-anchor="middle" font-size="11">练习 2:MRR、最近 7 天</text>
<text x="320" y="134" fill="var(--ink)" text-anchor="middle" font-size="11">补术语表</text>
<rect x="430" y="20" width="190" height="130" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="525" y="44" fill="var(--ink)" text-anchor="middle">③ 真的错</text>
<text x="525" y="70" fill="var(--ink-soft)" text-anchor="middle" font-size="11">模型用错了数据</text>
<text x="525" y="88" fill="var(--ink-soft)" text-anchor="middle" font-size="11">或数据本身对不上</text>
<text x="525" y="106" fill="var(--ink-soft)" text-anchor="middle" font-size="11">下一节:欠费、并列</text>
<text x="525" y="134" fill="var(--ink)" text-anchor="middle" font-size="11">改提示词或写代码</text>
<text x="320" y="185" fill="var(--ink-soft)" text-anchor="middle">先查 ①,再查 ②,最后才怀疑 ③。顺序反了,会把评测器的锅扣在模型头上</text>
<text x="320" y="208" fill="var(--ink-faint)" text-anchor="middle" font-size="11">评测分数变低时,先读错题,再动手</text>
</g>
</svg>
<figcaption>三种来源,处理方法完全不同。第一种改评测器,第二种改说明书,第三种才是真的要改 Agent。</figcaption>
</figure>

「口径没说清」那一类这次没出现,因为 Day 291 的术语表已经把 MRR、最近 7 天这些口径写进去了。要亲眼看它出现,练习 2 把术语表拿掉重跑。

## 第 8 步:10/10 不说明问题解决了

10 道题全过只说明**这 10 道题**过了。我接着手动试了一道不在评测集里的问题:

```bash
uv run python -m part05.text2sql.ask_data "哪家公司欠费了,欠了多少钱?"
```

```text
[第 1 次] SELECT c.company, ROUND(SUM(CASE s.plan WHEN '基础版' THEN 49 WHEN '专业版' THEN 99 WHEN '企业版' THEN 299 END * s.seats), 2) AS mrr_yuan FROM subscriptions s JOIN customers c ON c.id = s.customer_id WHERE s.status = 'past_due' GROUP BY c.company ORDER BY mrr_yuan DESC
蓝鲸教育二店欠费495.0元，小满花店欠费392.0元，北辰贸易二店欠费297.0元。  
口径:欠费金额按有效订阅MRR(单价×seats,年付按月折算)并按公司汇总。
账单: 3 次调用 | 输入 1272 / 输出 207 tokens | 约 ¥0.0027
```

三家欠费公司,每家一个金额,看着很合理。可是术语表里没有「欠款」这个词,模型就拿**每月应收的订阅费**(MRR)当成了**欠了多少钱**。真正的欠款是未付发票的金额,直接去库里查:

```bash
sqlite3 cloudledger/cloudledger.db "SELECT c.company, s.plan, s.seats, COALESCE((SELECT SUM(amount_cents)/100.0 FROM invoices i WHERE i.customer_id=s.customer_id AND i.status='open'),0) AS open_yuan FROM subscriptions s JOIN customers c ON c.id=s.customer_id WHERE s.status='past_due';"
```

```text
小满花店|基础版|8|392.0
蓝鲸教育二店|专业版|5|0
北辰贸易二店|专业版|3|0
```

三家欠费公司里,只有小满花店有一张未付发票(392 元,它碰巧等于 49 × 8 的月费)。另外两家订阅状态是欠费,可是系统里**一张未付发票都没有**:`seed.py` 里订阅状态和发票状态是分别随机生成的,数据本身就对不上。真实的业务库里,这种不一致天天都有。

所以原本的答案错了两层:口径错(拿 MRR 当欠款),而且就算口径对了,如果用 `INNER JOIN`,没有未付发票的两家会被静悄悄丢掉,一个字都不提。练习 3 要你一步步把它修好。

再看第 9 题。10/10 之后我回头检查了一遍每道题的标准答案,发现这一题有问题:

```bash
sqlite3 cloudledger/cloudledger.db "select c.company, s.seats from subscriptions s join customers c on c.id=s.customer_id where billing_cycle='yearly' order by seats desc limit 3;"
```

```text
启明科技|12
长风汽修二店|12
知行咨询|8
```

年付客户里席位数最多的有**两家并列**,都是 12。标准 SQL 用的是 `ORDER BY seats DESC LIMIT 1`,从并列里随便挑了一个(`启明科技`);模型写的也是 `LIMIT 1`,碰巧挑了同一个。这道题「对」是巧合,换一种排序方式它就会挑到长风汽修二店,评测会无缘无故变红。

为了确认,我把标准答案改成列出所有并列(`WHERE seats = (SELECT MAX(seats) ...)`),再看模型:

```bash
uv run python -m part05.text2sql.tie_check
```

```text
旧标准答案: [('启明科技',)]
新标准答案: [('启明科技',), ('长风汽修二店',)]
== 现有说明书:错  SQL: SELECT c.company, s.seats FROM subscriptions s JOIN customers c ON c.id = s.customer_id WHERE s.billing_cycle = 'yearly' ORDER BY s.seats DESC LIMIT 1
   回答: 年付客户中席位数最多的是启明科技，12个席位。   口径:年付客户按 subscriptions.billing_cycle = 'yearly' 识别，未限定订阅状态，并列最多只返回一行。
== 加了并列规则:错  SQL: SELECT c.company, s.seats FROM subscriptions s JOIN customers c ON c.id = s.customer_id WHERE s.billing_cycle = 'yearly' AND s.status IN ('active', 'past_due') ORDER BY s.seats DESC, c.company ASC LIMIT 1
   回答: 年付客户里席位数最多的是启明科技,12个席位。 口径:年付客户限定为有效订阅(billing_cycle='yearly' 且 status IN ('active','past_due')),排除 trialing/canceled;并列最大席位时按公司名升序取第一条。
账单: 7 次调用 | 输入 3541 / 输出 506 tokens | 约 ¥0.0066
```

两行都是错的。第一行不意外,而且模型很诚实,口径里写了「并列最多只返回一行」。第二行是我在术语表末尾加了一条「有并列要全部列出,不要用 LIMIT 1」,模型**读了也没照做**:它加了 `c.company ASC` 当平局规则,依旧 `LIMIT 1`,还自作主张加了状态过滤。提示词里的规则是建议,不是约束,这一点 Day 292 就说过了。

怎么办?这道题的问题其实在**题目本身**:「最多的是哪家」遇到并列,人也没法判断你要一家还是全部。把歧义写进问题里最干净。所以我把第 9 题改成「年付客户里席位数最多的是哪家公司?有并列的话全部列出」,标准答案换成列出所有并列。模型这次老老实实写了 `s.seats = (SELECT MAX(seats) ...)`,回答也是「启明科技和长风汽修二店,均为 12 个席位」。

也就是 `eval_v1.py` 里第 9 题这样改:

```python
    ("年付客户里席位数最多的是哪家公司?有并列的话全部列出",
     "SELECT c.company FROM subscriptions s JOIN customers c ON c.id = s.customer_id "
     "WHERE s.billing_cycle = 'yearly' AND s.seats = (SELECT MAX(seats) FROM subscriptions WHERE billing_cycle = 'yearly')"),
```

<div class="line-notes">

- `("年付客户里席位数最多的是哪家公司?有并列的话全部列出",` 题目里把并列怎么处理说清楚。
- `"WHERE s.billing_cycle = 'yearly' AND s.seats = (SELECT MAX(seats) FROM subscriptions WHERE billing_cycle = 'yearly')"),` 标准答案不再依赖排序的偶然性:取最大席位数,再把席位数等于它的全找出来,结果是 `[('启明科技',), ('长风汽修二店',)]`。

</div>

改完再连跑三遍:

```bash
uv run python -m part05.text2sql.eval_sql 3
```

```text
...
每题通过次数: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3]
账单: 91 次调用 | 输入 36602 / 输出 4566 tokens | 约 ¥0.0628
```

还是 10/10,三遍都稳,这次第 9 题是真的对(不是靠碰巧)。91 次调用比 90 多一次,多出来的那次应该是某一题被自检打回重写了一回,我没留下是哪一题。

**这一节的教训**:标准答案也要「体检」。写完评测集之后,把每道题的标准结果打出来看一遍:有没有并列(排序取第一的题)、有没有空结果、有没有 `NULL`、行数是不是和你直觉一致。评测集里一道有歧义的题,会让你以后对着一个「忽红忽绿」的指标白查半天。

### 评测集有多大才够

10 道题是练习用的规模,只能当烟雾报警器,不能当成绩单:每道题占 10 分,一道题的偶然波动就是 10 个百分点。真正用来决定「能不能上线」,得几十到几百题,而且要覆盖业务方真实会问的各类问题。Day 341 起的评测部分会专门讲评测集怎么扩、怎么抽样、置信区间怎么看。今天只要记住:**10/10 是「没发现问题」,不是「没有问题」**。

## 零件 → 大代码对照表

| 今天的零件 | 落在哪个文件 | 在 `ask_data.py` 里对应 |
| --- | --- | --- |
| 循环骨架:重试、带原因重写、认输 | `loop_stub.py` | `ask()` 里的 `for attempt`、`except SQLRejected`、最后的 `return {"sql": None ...}` |
| 真模型 + 对话历史 | `ask_v1.py` | `messages`、`chat_json`、`SQL_PROMPT` |
| 结果自检 | 第 3 步的 `CHECK_PROMPT` | `checked` 开关、`verdict` |
| 用人话回答 | 第 3 步的 `ANSWER_PROMPT` | 循环后面的 `reply` |
| 执行准确率 | `eval_v1.py`(严格版)、`eval_sql.py`(放宽版) | 不在里面,评测它的外壳 |
| 标准答案体检 | `tie_check.py` | 不在里面,是评测集的维护动作 |

## 花了多少钱

全程用 deepseek-flash 的高峰价:缓存命中 0.04 元、未命中 2 元、输出 8 元,每百万 token([DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) 2026 年 10 月查到,和 Day 292 同一天的口径)。账本算的是实际花费,下面是每处的数字:

| 实跑 | 账本 |
| --- | --- |
| `loop_stub.py`(假模型) | ¥0 |
| `ask_v1.py` 两次(删除、ARPA) | ¥0.0022 + ¥0.0014 |
| `ask_data.py` 五个问题(MRR、ARPA、环比、删除、欠费) | ¥0.0022 + ¥0.0058 + ¥0.0090 + ¥0.0077 + ¥0.0027 |
| 同一个删除问题的另一次(第 3 次写出 DELETE 被拦) | ¥0.0047 |
| `eval_v1.py` 严格版一遍 | ¥0.0203 |
| `eval_sql.py` 三遍 | ¥0.0602 |
| `tie_check.py` 与并列的单独一问 | ¥0.0066 + ¥0.0024 |
| 改了第 9 题后 `eval_sql.py` 再三遍 | ¥0.0628 |
| 练习 2、3、4、5 | ¥0.0236 + ¥0.0057 + ¥0.0097 + ¥0.0081 |
| 合计 | 约 ¥0.24 |

算一次例子,`eval_sql.py` 三遍的账本是「90 次调用 | 输入 35367 / 输出 4326 tokens | 约 ¥0.0602」。如果输入全按未命中价:35367 × 2 ÷ 100 万 = 0.0707 元,输出 4326 × 8 ÷ 100 万 = 0.0346 元,合计 ¥0.1053 是上限。实际 ¥0.0602,差的部分是每次请求开头那份 2577 字符的说明书命中了缓存。

写文章前我自己还试跑过一些别的问题,另花约 ¥0.1,没有写进文章。每天总花费在 ¥1 以内。

## 动手练习

**练习 1:给评测器写测试。** 评测器自己错了,分数就是假的。写 `tests/test_eval_matches.py`,用 `parametrize` 把 `matches()` 的判断规则逐条锁住:顺序不同、整数和浮点、浮点只比两位、多选一列(在前在后都行)、重复行、少一行、少一列、完全对不上、空结果。不调模型。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/tests/test_eval_matches.py
"""练习 1:给评测器自己写测试。评测器错了,分数就是假的。"""
import pytest

from part05.text2sql.eval_sql import matches, normalize


@pytest.mark.parametrize(
    ("pred", "gold", "expected"),
    [
        ([("a", 1), ("b", 2)], [("b", 2), ("a", 1)], True),  # 顺序不同
        ([(20273.0,)], [(20273,)], True),  # 整数和浮点
        ([(20273.004,)], [(20273.0,)], True),  # 浮点只比两位
        ([("长风汽修二店", 215280.0)], [("长风汽修二店",)], True),  # 多选了一列
        ([(215280.0, "长风汽修二店")], [("长风汽修二店",)], True),  # 多出来的列在前面也行
        ([("a",), ("a",)], [("a",)], False),  # 重复行:JOIN 放大了
        ([("a",)], [("a",), ("b",)], False),  # 少了一行
        ([("a", "b")], [("b",)], True),  # 挑出第 2 列就对上
        ([("c", "d")], [("b",)], False),  # 哪一列都对不上
        ([("a",)], [("a", 1)], False),  # 少了一列
        ([], [("a",)], False),  # 空结果
    ],
)
def test_matches(pred: list[tuple], gold: list[tuple], expected: bool) -> None:
    assert matches(pred, gold) is expected


def test_normalize_counts_duplicates() -> None:
    assert normalize([("a",), ("a",)])[("a",)] == 2
```

<div class="line-notes">

- `from part05.text2sql.eval_sql import matches, normalize` 直接导入要测的两个函数。导入 `eval_sql` 时它也会导入 `ask_data`,而 `ask_data` 在模块顶层建了一个 `LLMClient()`,所以需要 `.env` 在,但不会发任何请求。
- `@pytest.mark.parametrize(` 三个参数名,下面每行是一组数据,11 行展开成 11 条测试([Day 73](/blog/agent-zero/day-073-pytest-3/))。
- `([("a", 1), ("b", 2)], [("b", 2), ("a", 1)], True),  # 顺序不同` 模型用 `ORDER BY` 的方式和标准答案不同很常见,结果集是「一堆行」,不是「一个序列」。
- `([(20273.0,)], [(20273,)], True),  # 整数和浮点` SQLite 的 `ROUND(...)` 返回浮点,标准 SQL 可能返回整数。
- `([(20273.004,)], [(20273.0,)], True),  # 浮点只比两位` `round(20273.004, 2)` 是 `20273.0`。
- `([("长风汽修二店", 215280.0)], [("长风汽修二店",)], True),  # 多选了一列` 评测集 8/10 那次的真实情形。
- `([("a",), ("a",)], [("a",)], False),  # 重复行:JOIN 放大了` 这是 `Counter` 比 `set` 好的地方:`set` 会把两行当一行,放大的 JOIN 逃过检查。
- `([("a", "b")], [("b",)], True),  # 挑出第 2 列就对上` 说明 `combinations` 真的在枚举所有挑法,不是只看第一列。
- `([], [("a",)], False),  # 空结果` 模型的 SQL 写得查不出任何行,直接错。
- `assert matches(pred, gold) is expected` 用 `is` 比较布尔,既挡住「返回了别的真值」(比如返回一个非空列表),也让失败信息清楚。
- `assert normalize([("a",), ("a",)])[("a",)] == 2` 单独锁住 `normalize` 的计数行为:两行 `('a',)` 数出来是 2。

</div>

`uv run pytest -q tests/test_eval_matches.py`:

```text
............                                                             [100%]
12 passed in 1.55s
```

11 条 `matches` 加 1 条 `normalize`,共 12 条。这些测试不调模型,1.5 秒就跑完,可以放进每次提交都跑的检查里。评测器改了(比如以后要加「允许少一列」),先改这里,红了再改实现。

</details>

**练习 2:拿掉术语表。** `schema_text(glossary=False)` 能生成没有术语表的说明书。给 `ask()` 传这份说明书,把 10 道题再跑一遍,分数掉到几?错题分别缺了术语表里的哪一条?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/text2sql/ex294_no_glossary.py
"""练习 2:把术语表拿掉,同一份评测再跑一遍,看哪几题掉分。"""
from part05.text2sql.ask_data import llm
from part05.text2sql.eval_sql import CASES, run_once
from part05.text2sql.schema import schema_text

results = run_once(CASES, schema=schema_text(glossary=False))
print(f"没有术语表:执行准确率 {sum(results)}/{len(CASES)}")
print("账单:", llm.ledger)
```

<div class="line-notes">

- `from part05.text2sql.eval_sql import CASES, run_once` `eval_sql` 从 `eval_v1` 里导入了 `CASES`,所以这里能从 `eval_sql` 再导出来。
- `results = run_once(CASES, schema=schema_text(glossary=False))` 题目不变,只换说明书:前两层(建表注释、真实取值)还在,第三层(术语表)没了。`ask()` 的 `schema` 参数就是为这里留的。
- `print(f"没有术语表:执行准确率 {sum(results)}/{len(CASES)}")` `sum(results)` 把 `True`/`False` 当 1/0 加起来。

</div>

`uv run python -m part05.text2sql.ex294_no_glossary`:

```text
✓ [1 次] 一共有多少个客户?
✓ [1 次] 各套餐分别有多少个 active 状态的订阅?
✓ [1 次] 欠费的客户是哪几家公司?
✓ [1 次] 2026 年 10 月开出的发票一共多少元?
✓ [1 次] 还没付款的发票有几张、合计多少元?
✓ [1 次] 已付款金额最高的是哪家公司?
✗ [2 次] 现在的 MRR 是多少元?
    模型:SELECT ROUND(SUM(CASE WHEN billing_cycle = 'monthly' THEN amount_cents ELSE amount_cents / 12.0 END) / 100.0, 2) AS mrr_yuan FROM (SELECT s.billing_cycle, i.amount_cents FROM subscriptions s JOIN invoices i ON i.subscription_id = s.id WHERE s.status = 'active' AND i.status = 'paid' AND i.id = (SELECT i2.id FROM invoices i2 WHERE i2.subscription_id = s.id AND i2.status = 'paid' ORDER BY i2.issued_at DESC, i2.id DESC LIMIT 1)) t
    结果:[(19089.0,)]  标准:[(20273.0,)]
✓ [1 次] 有没有同一个订阅在同一天开出两张金额相同的已付发票?列出客户编号
✓ [1 次] 年付客户里席位数最多的是哪家公司?有并列的话全部列出
✗ [1 次] 最近 7 天新建的工单按主题各有几张?
    模型:SELECT subject, COUNT(*) AS ticket_count FROM tickets WHERE created_at >= datetime('now', '-7 days') GROUP BY subject ORDER BY ticket_count DESC
    结果:[]  标准:[('升级套餐', 2), ('发票抬头修改', 5), ('取消订阅', 1)]
没有术语表:执行准确率 8/10
账单: 31 次调用 | 输入 10190 / 输出 1850 tokens | 约 ¥0.0236
```

掉到 8/10,恰好错了两题,和术语表里的两条一一对应:

- **MRR**(19089.0,正确是 20273.0):术语表里写着「有效订阅 = active 加 past_due」「单价 49/99/299」,没有它模型就自己发明口径,用发票金额反推,还只算了 `active`。这次它还被自检打回过一次(`[2 次]`),第 2 次换了个写法,数字却还是 19089。这个数和 Day 291 里「建表注释」那一档拿到的一模一样。自检者没有说明书可看,它看到一个「像是 MRR」的数,没法知道口径是错的。
- **最近 7 天**(结果是空的):没有「今天是 2026-10-12」,模型用 SQLite 的 `datetime('now')`,也就是你运行脚本的那天,往前数 7 天一张工单都没有。**返回空结果,不报错**。

这是上一节「错题的三种来源」的第二类:口径没说清。而剩下的 8 题没掉分,是因为它们靠的是建表注释和真实取值那两层,那两层还在。这和 Day 291 的结论一致:前两层治「不知道值」,第三层才治「不知道口径」。

</details>

**练习 3:数据对不上要说出来。** 把「哪家公司欠费了,欠了多少钱?」当第 11 题。标准 SQL 用 `LEFT JOIN`,让没有未付发票的欠费公司也出现(欠款写 0)。先看现有说明书会答成什么;再在术语表加一条「欠款金额」;最后想办法让回答把「订阅欠费、却没有未付发票」的公司点出来。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/text2sql/ex294_overdue.py
"""练习 3:「欠了多少钱」。先看现有说明书会答成什么,再加一条术语,最后用代码补上「数据对不上」的提醒。"""
from part05.text2sql.ask_data import ask, llm
from part05.text2sql.eval_sql import matches
from part05.text2sql.safe_db import run_sql
from part05.text2sql.schema import schema_text

QUESTION = "哪家公司欠费了,欠了多少钱?"
GOLD_SQL = (
    "SELECT c.company, ROUND(COALESCE(SUM(i.amount_cents), 0) / 100.0, 2) "
    "FROM subscriptions s JOIN customers c ON c.id = s.customer_id "
    "LEFT JOIN invoices i ON i.customer_id = s.customer_id AND i.status = 'open' "
    "WHERE s.status = 'past_due' GROUP BY c.id ORDER BY c.id"
)
EXTRA = "- 欠款金额:客户未付发票(invoices.status = 'open')的金额合计。\n"
NO_OPEN_SQL = (  # 订阅是欠费,却一张未付发票都没有的客户:数据对不上,必须让人知道
    "SELECT c.company FROM subscriptions s JOIN customers c ON c.id = s.customer_id "
    "WHERE s.status = 'past_due' AND NOT EXISTS "
    "(SELECT 1 FROM invoices i WHERE i.customer_id = s.customer_id AND i.status = 'open') ORDER BY c.id"
)


def with_data_warning(answer: str) -> str:
    _, rows = run_sql(NO_OPEN_SQL)
    if not rows:
        return answer
    names = "、".join(r[0] for r in rows)
    return f"{answer}\n提醒:{names} 的订阅状态是欠费,但系统里没有未付发票,建议核对。"


_, gold = run_sql(GOLD_SQL)
print("标准答案:", gold)

for label, schema in [("现有说明书", None), ("加了「欠款金额」", schema_text() + EXTRA)]:
    r = ask(QUESTION, verbose=False, schema=schema)
    print(f"== {label}:{'对' if matches(r['rows'], gold) else '错'}")
    print("结果:", r["rows"])
    print("回答:", with_data_warning(r["answer"]) if schema else r["answer"])
print("账单:", llm.ledger)
```

<div class="line-notes">

- `GOLD_SQL = (` 标准 SQL 要保留所有欠费公司:`LEFT JOIN invoices ... AND i.status = 'open'` 把条件写在 `ON` 里(不是 `WHERE`),没有未付发票的公司才不会被丢掉;`COALESCE(SUM(...), 0)` 把「没有发票」的 `NULL` 变成 0。
- `EXTRA = "- 欠款金额:客户未付发票(invoices.status = 'open')的金额合计。\n"` 加在术语表末尾的一条,开头的 `- ` 和别的条目格式一致,末尾换行。
- `NO_OPEN_SQL = (  # 订阅是欠费,却一张未付发票都没有的客户` 对账用的固定 SQL:订阅状态欠费,且 `NOT EXISTS` 不存在未付发票。`NOT EXISTS (子查询)` 的意思是子查询一行都查不到。
- `def with_data_warning(answer: str) -> str:` 在模型的回答后面追加提醒。
- `_, rows = run_sql(NO_OPEN_SQL)` 对账 SQL 也走 `run_sql`,不绕开三道闸。
- `if not rows:` 没有对不上的就原样返回回答。
- `names = "、".join(r[0] for r in rows)` 实测 `蓝鲸教育二店、北辰贸易二店`。
- `return f"{answer}\n提醒:{names} 的订阅状态是欠费,但系统里没有未付发票,建议核对。"` 提醒由代码拼,不由模型写,所以不会漏、不会改口径。
- `for label, schema in [("现有说明书", None), ("加了「欠款金额」", schema_text() + EXTRA)]:` 两组对照:`None` 表示用默认说明书;第二组在说明书末尾拼上 `EXTRA`。
- `print("回答:", with_data_warning(r["answer"]) if schema else r["answer"])` 只给第二组加对账提醒,第一组保持原样,好对比。

</div>

`uv run python -m part05.text2sql.ex294_overdue`:

```text
标准答案: [('小满花店', 392.0), ('蓝鲸教育二店', 0.0), ('北辰贸易二店', 0.0)]
== 现有说明书:错
结果: [('北辰贸易二店', 297.0), ('小满花店', 392.0), ('蓝鲸教育二店', 495.0)]
回答: 北辰贸易二店欠费297.00元,小满花店欠费392.00元,蓝鲸教育二店欠费495.00元。
口径:欠费客户按订阅 status='past_due' 认定,欠费金额按 MRR(套餐单价×seats,年付按月折算)计算并保留两位小数。
== 加了「欠款金额」:错
结果: [('小满花店', 392.0)]
回答: 小满花店欠费392.0元。
口径:欠费客户按订阅status='past_due'认定,欠款金额按该客户invoices.status='open'的金额合计(分转元),仅列出同时有未付发票的欠费客户。
提醒:蓝鲸教育二店、北辰贸易二店 的订阅状态是欠费,但系统里没有未付发票,建议核对。
账单: 6 次调用 | 输入 2549 / 输出 453 tokens | 约 ¥0.0057
```

分三层看:

第一组用现有说明书,答成了 MRR,三个数全是错的。第二组加了「欠款金额」,口径对了,金额 392 对了;但模型用的是内连接,另外两家被丢掉了,所以 `matches` 仍然判「错」(结果少了两行)。我试过把术语表写得更狠,「必须用 LEFT JOIN、没有未付发票的写 0」,模型照样只返回有欠款的那一家。试过两次都是这样,所以我没有再靠提示词硬压。

最后那行「提醒」是**代码**加的:一条固定的对账 SQL 找出「订阅欠费却没有未付发票」的公司,拼在回答后面。这是处理「数据本身对不上」的务实办法:模型没法替你发现库里不一致,但你可以写一条检查把它变成告警。更彻底的做法是让这类不一致进数据质量看板,从源头修数据。

</details>

**练习 4:用户要的是写操作。** 问「把 C007 那张重复的发票删掉」,前面看到有时 4 次调用后转人工,有时第 3 次改成找重复组。改提示词让它**第 1 次就**给出「只读列出相关记录、请人工处理」的回答,不要绕。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/text2sql/ex294_write_requests.py
"""练习 4:用户要的是「删掉」,问数 Agent 只能查。前后各问一次,看自检提示词怎么影响结局。"""
from part05.text2sql import ask_data
from part05.text2sql.ask_data import ask, llm

QUESTION = "把 C007 那张重复的发票删掉"

print("== 改之前")
r = ask(QUESTION)
print("回答:", r["answer"], "| 尝试", r["tries"], "次")

ask_data.SQL_PROMPT += "\n- 用户要求删除、修改数据时,你没有这个权限:写一条只读的 SELECT,把相关记录列出来供人工处理,并在 assumptions 里写「需要人工执行写操作」"
ask_data.CHECK_PROMPT += "\n- 用户要求写操作时,只读查询列出相关记录就算 ok,不要要求改写成 DELETE 或 UPDATE"

print("== 改之后")
r = ask(QUESTION)
print("回答:", r["answer"], "| 尝试", r["tries"], "次")
print("账单:", llm.ledger)
```

<div class="line-notes">

- `from part05.text2sql import ask_data` 导入的是**模块**,不是函数。下面要改模块里的两个全局变量,得拿着模块本身(和 [Day 287](/blog/agent-zero/day-287-mcp-test/) `monkeypatch` 改 `server.DB_PATH` 是同一个道理)。
- `r = ask(QUESTION)` 改之前,`verbose` 默认 `True`,打印整个过程。
- `ask_data.SQL_PROMPT += ` 往写 SQL 的提示词末尾追加一条:没有权限,就写只读查询把相关记录列出来,并在 `assumptions` 里声明。注意它加在 `{schema}` 的**后面**,`.format(schema=...)` 照常工作,因为新增的文字里没有花括号。
- `ask_data.CHECK_PROMPT += ` 这一条才是关键:自检者原本把「没删掉」当成「没回答」,现在告诉它这种情况算通过。
- `print("回答:", r["answer"], "| 尝试", r["tries"], "次")` 同时打印尝试次数,对比前后。

</div>

`uv run python -m part05.text2sql.ex294_write_requests`:

```text
== 改之前
[第 1 次] 
  → 被拒/报错:一次只能执行一条 SQL
[第 2 次] SELECT id, customer_id, subscription_id, amount_cents, status, issued_at, paid_at FROM invoices WHERE customer_id = 'C007' ORDER BY amount_cents, issued_at, id
  → 自检不通过:这条 SQL 只是把 C007 的所有发票都列了出来，并没有识别或删除重复项。结果里确实有一对重复（INV-2026-0026 和 INV-2026-0123，subscription_id、amount_cents、issued_at、paid_at 完全相同），但查询没有按这些字段分组或计数来定位重复，也没有执行 DELETE。要回答“删掉重复发票”，需要先按 (customer_id, subscription_id, amount_cents, issued_at, paid_at) 分组找出 count>1 的组，再决定保留哪一条（如保留 id 较小或较早的），然后执行 DELETE。当前结果无法直接回答问题。
[第 3 次] SELECT customer_id, subscription_id, amount_cents, issued_at, paid_at, COUNT(*) AS cnt, GROUP_CONCAT(id) AS invoice_ids FROM invoices WHERE customer_id = 'C007' GROUP BY customer_id, subscription_id, amount_cents, issued_at, paid_at HAVING COUNT(*) > 1
回答: C007 的重复发票组为 INV-2026-0026、INV-2026-0123（共 2 条），需人工确认保留哪一条（建议保留 id 较小者），未执行删除。
口径:重复发票口径:同一 customer_id、subscription_id、amount_cents、issued_at、paid_at 视为重复;仅输出 SELECT 定位重复组(含组内发票 id),不执行 DELETE;保留哪一条需人工确认(建议保留 id 较小者)。 | 尝试 3 次
== 改之后
[第 1 次] SELECT id, customer_id, subscription_id, amount_cents / 100.0 AS amount_yuan, status, issued_at, paid_at FROM invoices WHERE customer_id = 'C007' ORDER BY issued_at, id
回答: 我没有删除权限，无法直接删除发票；C007 共有 5 张发票，其中 INV-2026-0026 与 INV-2026-0123 的金额、状态、开票日和付款日完全相同，疑似重复，请人工核对后执行删除。
口径：无删除权限，仅列出 C007 的全部发票供人工核对处理；需要人工执行写操作；金额按分除以 100.0 换算为元。 | 尝试 1 次
账单: 8 次调用 | 输入 5311 / 输出 732 tokens | 约 ¥0.0097
```

改之前走了 3 次,中间那条自检意见明明白白写着「也没有执行 DELETE」,在把模型往写删除的方向推;改之后第 1 次就答完,调用次数从 5 次(3 次写 SQL、1 次自检、1 次回答)降到 3 次(写、检、答各一次)。两段合计 8 次调用 ¥0.0097。

「改之前」这一次碰巧收敛了,别的运行里我看到过它在第 3 次真的写出 `DELETE`、被第一道闸拦下、最后转人工(正文第 4 步)。两种结局用的都是同一份代码,这就是为什么我宁愿把「写操作怎么处理」写进提示词,让流程每次都走同一条短路径。

最后提醒一次:提示词不是防线。就算这两句提示词没起作用,模型写了 `DELETE`,`run_sql` 的第一道闸照样拦。提示词改进的是**体验**(少绕弯、少花钱),闸保证的是**安全**。

</details>

**练习 5(开放题):给评测集加三道自己的题。** 想三个你自己会问的问题,写标准 SQL,放进 `run_once` 跑一遍。看分数和每题第几次成功,再判断错题属于三种来源里的哪一种。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/text2sql/ex294_my_cases.py
"""练习 5:给评测集加三道自己想问的题,看分数和失败原因。"""
from part05.text2sql.ask_data import llm
from part05.text2sql.eval_sql import run_once

MY_CASES = [
    ("ARPA 是多少元?",
     "SELECT ROUND(SUM(CASE plan WHEN '基础版' THEN 49 WHEN '专业版' THEN 99 WHEN '企业版' THEN 299 END * seats) * 1.0 "
     "/ COUNT(DISTINCT customer_id), 2) FROM subscriptions WHERE status IN ('active', 'past_due')"),
    ("取消订阅的客户有几家?",
     "SELECT COUNT(DISTINCT customer_id) FROM subscriptions WHERE status = 'canceled'"),
    ("企业版现在一共有多少个席位?",
     "SELECT SUM(seats) FROM subscriptions WHERE plan = '企业版' AND status IN ('active', 'past_due')"),
]

results = run_once(MY_CASES)
print(f"{sum(results)}/{len(MY_CASES)}")
print("账单:", llm.ledger)
```

<div class="line-notes">

- `MY_CASES = [` 三道题,格式和 `CASES` 一样:`(问题, 标准 SQL)`。
- `("ARPA 是多少元?",` 标准答案 779.73(有效订阅的月收入 20273 元除以 26 个有效订阅的客户)。Day 291 练习 1 给术语表加过 ARPA 一条;我这里没加,看看模型靠已有的 MRR 口径能不能推出来。
- `"SELECT SUM(seats) FROM subscriptions WHERE plan = '企业版' AND status IN ('active', 'past_due')"),` 「现在」两个字的口径是「有效订阅」。我的标准答案按这个写,模型能不能也这么理解,看它有没有读术语表。
- `results = run_once(MY_CASES)` 复用 `eval_sql.py` 的 `run_once`,所以没写新的评测逻辑。

</div>

`uv run python -m part05.text2sql.ex294_my_cases`:

```text
✓ [2 次] ARPA 是多少元?
✓ [1 次] 取消订阅的客户有几家?
✓ [1 次] 企业版现在一共有多少个席位?
3/3
账单: 10 次调用 | 输入 4584 / 输出 647 tokens | 约 ¥0.0081
```

三题全对。有意思的是 ARPA 那题用了 2 次才成功:第 1 次就是前面那个除以 100 的错,被自检打回,第 2 次改对。这是整套评测里**唯一**用到自检重写的题,前面的 10 道题全是第 1 次成功,也就是说评测集里的 10 道题其实很少检验到循环那一半。你自己加的题,多往「口径模糊」「要换算」「要跨表」的方向加,才测得出循环的价值。

三题都过了,没有错题要分类。如果你的题错了,按那张图的顺序查:先看是不是评测器(列数、顺序、浮点),再看是不是口径(两种理解都说得通),最后才怀疑模型。

</details>

**验收标准**:`loop_stub.py` 的两段输出和正文一致;`eval_sql.py` 连跑三遍每遍 10/10;`pytest tests/test_eval_matches.py` 12 条全绿;`ex294_no_glossary.py` 掉到 8/10,你能说出缺的是术语表里的哪两条;你能讲出「评测器错、口径没说清、真的错」三种来源的区别,并各举一个今天的例子。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 问数循环 | 模型写 SQL → 执行 → 出错带原因重写 → 自检 → 回答的整套流程 |
| 自修(self-correction) | 把执行报错或自检意见交回模型,让它改自己的上一次回答 |
| 结果自检 | SQL 跑通后再让一次独立的模型调用看结果合不合理,只做一次,防止你来我往改个没完 |
| 执行准确率(EX) | 模型 SQL 的执行结果和标准 SQL 的执行结果一样,就算对;不比 SQL 文本 |
| 标准答案(gold) | 评测题的正确答案,这里是手写并核对过结果的 SQL |
| 闭包 | 内层函数记住外层函数的变量,`make_fake_writer` 里的 `it` 就是被记住的迭代器;JS 里的闭包是同一回事 |
| 迭代器(iterator) | 记着「读到哪了」的对象,`next()` 每次取下一个;取完再取抛 `StopIteration` |
| `Counter` | `collections` 里的计数字典,比较两批行是否一样时顺序无关、重复有关 |
| `combinations` | `itertools` 里的组合函数,枚举「从 N 个里挑 K 个」的所有挑法 |
| 并列(tie) | 排序取第一时,多条记录的值一样大,`LIMIT 1` 会随便取一条 |
| 评测器错误 | 模型答对了但比较函数判错,分数低是评测的锅,不是模型的锅 |
| 数据对不上 | 业务库内部互相矛盾,比如订阅状态是欠费,发票却全部已付;模型发现不了,要靠对账代码 |

## 常见误区

**分数低就去改提示词。** 今天第一次 8/10,两道错题模型的答案其实是对的,多选了一列被判错。我要是去改提示词,只会白折腾。先读错题,先查评测器。

**自检者说得头头是道,就相信它。** ARPA 那题,自检说原因是「分母用了 `COUNT(DISTINCT customer_id)`」,实际原因是重复除了一次 100。方向(7.8 太小)抓对了,理由不对。自检能拦下一些错,但不是正确性保证,它输出的 `problem` 只是修改意见。

**自检每次重写后都再来一遍。** 两个模型你挑一个刺我改一个版本,可能来回改个没完,又烧钱。今天只做一次。

**把自检的意见当成不可违抗的命令。** 用户说「帮我删掉」,自检者觉得「没删掉就是没回答」,把模型往写 `DELETE` 的方向推。执行层的闸会拦住,但提示词也该告诉它「写操作请求,只读列出相关记录就算 ok」(练习 4)。

**空 SQL 当成正常的 SQL 去执行。** 模型想拒绝时,会交一个 `{"sql": ""}`。`run_sql('')` 实测抛的是「一次只能执行一条 SQL」,信息不准,只是碰巧也被拒绝了。更好的做法是在 `check_sql` 里单独判空,给出「SQL 为空,请只在需要时回答」之类准确的提示。

**评测标准答案没检查。** 第 9 题的标准答案用了 `LIMIT 1`,而数据里有两家并列 12 席,「对」是碰巧。写完评测集,把每道题的标准结果打出来看一遍:有没有并列、空结果、`NULL`。

**以为 `temperature=0` 就每次一样。** 同一个「删掉重复发票」的问题,我跑了好几次,有一次第 3 次写出 `DELETE` 转人工,另一次第 3 次改成找重复组答对了。评测要多跑几遍看稳不稳,不要只看一次。

**10/10 就觉得问数做完了。** 「哪家公司欠费了,欠了多少钱」不在评测集里,模型拿 MRR 当欠款答了三个数,看着很合理。评测集只覆盖你想到的问题。

**回答模型会把所有行念出来。** 它只看到 `preview` 的前 10 行。49 行的环比结果,回答里只列了前几个月。要完整数据看 `r["rows"]`。

**说明书不放在 system 最前面。** 放在 system 最前面,每次请求的开头都一样,才吃得到缓存命中价;塞在后面或每次改一点,缓存就失效了。三遍评测 90 次调用只花 ¥0.06,靠的就是这个。

## 学习资料

### 文档与文章

- [DeepSeek · JSON Output](https://api-docs.deepseek.com/zh-cn/guides/json_mode):JSON mode 的官方说明,提示词里必须含有「json」字样、要给出格式示例,今天三个提示词都遵守了。
- [Semantic Evaluation for Text-to-SQL with Distilled Test Suites(论文)](https://arxiv.org/abs/2010.02840):解释了为什么「只比一次执行结果」会误判:不同的 SQL 在一份数据上碰巧结果相同。提出用多份数据构成的测试集来评测,是 EX 的重要改进。
- [BIRD:A Big Bench for Large-Scale Database Grounded Text-to-SQLs(论文)](https://arxiv.org/abs/2305.03111):一个更接近真实业务的基准,里面讲了脏数据和外部知识为什么让 Text-to-SQL 变难,明天会用到。
- [Python 文档 · itertools.combinations](https://docs.python.org/3/library/itertools.html#itertools.combinations):评测器里挑列用的函数,页面里有每种挑法的展开示意。
- [Python 文档 · collections.Counter](https://docs.python.org/3/library/collections.html#collections.Counter):计数字典的所有用法。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1doRyBsERS&autoplay=0&high_quality=1" title="91.59%准确率~NL2SQL多智能体框架,自然语言生成SQL企业级解决方案,6个Skills专业化分工 + 31维错误分类法分引导纠错" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>但问智能 · 91.59%准确率~NL2SQL多智能体框架 · 32 分钟。重点看他们怎么给错误分类、再按类别引导纠错,对照今天「错题的三种来源」和自修循环。是别人的系统,细节不用全懂。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1nk8Qz6EFk&autoplay=0&high_quality=1" title="【实战向】10分钟用Qwen3和Dify做Text2SQL系统,附完整流程 + 避坑指南" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>大模型资料库 · 10分钟用Qwen3和Dify做Text2SQL系统 · 13 分钟。不写代码,用低代码平台拼一个。看完想想:今天我们手写的循环里,哪些它替你做了,哪些(执行层的闸、评测集)它不会替你做。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/S5ezVVJhQmE" title="AI & Text to SQL: How LLMs & Schema Power Data Analytics" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>IBM Technology · AI & Text to SQL: How LLMs & Schema Power Data Analytics · 9 分钟,英文,开字幕。把「模型 + 库说明书 → SQL」的整条链路用一张图讲完,适合复习 Day 291 到今天。</figcaption>
</figure>

### 书籍

- Chip Huyen,《AI Engineering: Building Applications with Foundation Models》,O'Reilly,2025。评测那几章(尤其是怎么设计评测集、怎么检查评测本身)和今天的「先查评测器」同一个思路。我没有核实有无中文版,这里只写英文原版。

### 开源项目与代码

- [vanna-ai/vanna](https://github.com/vanna-ai/vanna):开源的 Text-to-SQL 框架,核心思路是把「历史上问过的问题加写对的 SQL」存起来当例子,明天讲表多了怎么办时会提到。
- [defog-ai/sql-eval](https://github.com/defog-ai/sql-eval):一套开源的 Text-to-SQL 评测代码,比较结果集的写法值得读,看它怎么处理列顺序和浮点。

## 自测

1. 问数循环为什么限制最多 3 次?太少、太多各有什么问题?

<details><summary>答案</summary>

太少:一个拼错的列名就认输,明明改一次就能对。太多:模型可能原样重复同一条错的 SQL,烧钱又不收敛。3 次是经验值,应该看评测集里「第 2、3 次才成功」的比例再调:如果几乎都是第 1 次成功,说明没必要太多;如果第 3 次成功的很多,可以放宽。认输时要诚实地说「没查出来」,不要编一个数。

</details>

2. 结果自检为什么只做一次?

<details><summary>答案</summary>

自检者也是模型,它也会挑刺。如果每次重写后都再自检,两个模型你挑一个刺、我改一个版本,可能来回改个没完,既烧钱又不收敛。只给一次机会,宁可偶尔放过一个错,也不要无限循环。

</details>

3. 第一次评测 8/10,你该先改提示词还是先看错题?今天的两道错题错在哪?

<details><summary>答案</summary>

先看错题。两道错题(已付款金额最高的公司、席位数最多的公司),模型选出的公司都对,只是顺手多查了一列金额或席位数,而评测器要求结果集一字不差,多一列就判错。错的是评测器,把比较函数放宽成「允许多选几列,只要能挑出和标准答案对得上的那几列」,分数就到了 10/10,模型和提示词一个字没改。

</details>

4. 为什么说 10/10 不等于问数做完了?举两个今天的例子。

<details><summary>答案</summary>

评测集只覆盖了你想到的 10 道题。例一:「哪家公司欠费了,欠了多少钱」不在评测集里,模型拿 MRR 当欠款,答了三个看着合理的数,实际只有一家有未付发票。例二:评测集里第 9 题的标准答案用了 `LIMIT 1`,而数据里有两家并列 12 席,这题「对」是碰巧,换个排序就会变红。10 题的规模也太小,一道题就是 10 个百分点。

</details>

5. 面试题:你做了一个 Text-to-SQL 系统,评测集上执行准确率 92%。老板问「能不能上线给业务用」,你怎么回答?

<details><summary>答案</summary>

不能只看 92% 这一个数。先看评测集本身:有多少题、是不是业务方真问过的、覆盖了哪些类型(计数、JOIN、窗口、时间范围、口径)、标准答案有没有体检过(并列、空结果、NULL)、多跑几遍稳不稳。再看 8% 的错题:分成评测器错、口径没说清、模型真错三类,真错里有没有「看着合理的错数」这种最危险的。然后看没覆盖的部分:抽样业务日志里的真实问题,人工看一遍答案。安全方面确认执行层是只读、有超时和行数限制,有审计日志。上线策略上先内部灰度,回答里带 SQL 和口径说明,让用户能核对;持续把线上被纠正的问题加进评测集。结论是「可以有限上线」,不是「92% 就够了」。

</details>

6. 为什么评测里比较结果集用 `Counter` 而不用 `set`?

<details><summary>答案</summary>

`Counter` 不在乎行的顺序,但在乎重复行的个数;`set` 会把两行相同的数据当成一行。JOIN 把行数放大是 SQL 里最常见的错之一,结果会多出重复行,用 `set` 比较就看不出来,用 `Counter` 才能抓到。

</details>

## 明天预告

Day 295 · 问数 Agent(四):表多了怎么办,语义层和基准。CloudLedger 只有 5 张表,说明书全贴进去才 2577 个字符。真实公司的数据仓库动辄几百张表、几千列,全贴进去既贵又会让模型分心。明天做一个会把表数放大 10 倍的实验,看说明书长到多少模型开始出错,再用 embedding 只检索相关的几张表,最后讲语义层(把口径写成代码而不是提示词)和 BIRD、Spider 2.0 两个公开基准。
