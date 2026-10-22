---
title: 'Day 466 · 记忆(三):跨工单的客户画像和新问题'
description: '给 SupportPilot 加第三种记忆:把客户档案、订阅和已解决的历史工单压成一段 100 字左右的画像,存在业务库里,只在历史工单数变了时重建。踩了三个真坑:没给客户档案,模型写成「非 VIP」;把当前工单算进历史,画像来回重建;模型拿画像推算日期推错了。最后写 forget_customer,客户要求删除时把快照和画像删干净,并找出删了工单却留下的孤儿快照。'
pubDate: 2026-10-22
regime: none
tags: ['memory', 'privacy', 'postgres', 'supportpilot', 'agent-zero']
series: 'agent-zero'
day: 466
lang: 'zh'
draft: true
---

## 上一课回顾

昨天([Day 465](/blog/agent-zero/day-465-memory-compact/))做了第二种记忆:对话摘要。`prepare_context` 节点粗估「摘要 + 还没摘要的对话」,超过预算才把早期部分压成一段滚动摘要,原文 turns 一条不删,只用 `summarized_upto` 记切点。实测压缩那一轮输入少了 16%,也看到了代价:清单外的细节(报错时间)被压掉了,Agent 答不上来。

前两种记忆都活在一张工单里面,工单关了就结束。可吴刚这已经是第四次来问银行同步了。Day 464 那张工单的第一轮回复是从「E3001 表示银行流水同步失败,最常见的原因是授权过期」讲起的,和他前三次听到的一模一样。今天做第三种:跨工单的客户画像。然后把三种记忆合起来,看看加了记忆以后多出来哪些新问题,其中最重要的是客户要求删除数据时怎么删干净。

## 今天要解决的问题

学完今天你应该能做到:

1. 写出 `get_or_build_profile`:把客户档案、订阅、已解决的历史工单交给模型写一段画像,存进 `biz.customer_profiles`,历史工单数没变就直接读表、不花钱。
2. 通过依赖注入把画像接进 `load_customer`,让所有调模型的节点都能看到;用假零件写 4 个测试(其中 2 个连真 Postgres)全部通过。
3. 亲手复现三个坑:输入里缺了提示词要求的字段、把当前工单算成历史、模型拿画像做了错误推断,并说清每个怎么修。
4. 写出 `forget_customer`,客户要求删除时删掉他所有工单的对话快照和画像;能查出「删了工单却忘了删快照」留下的孤儿。

预计用时 2.5 小时。前置:[Day 264](/blog/agent-zero/day-264-memory-short-long/)(短期记忆和长期记忆)、[Day 416](/blog/agent-zero/day-416-pii-audit/)(数据脱敏和审计日志)、[Day 459](/blog/agent-zero/day-459-flow-di/)(依赖注入)、[Day 464](/blog/agent-zero/day-464-memory-session/)–[465](/blog/agent-zero/day-465-memory-compact/)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `get_or_build_profile` 和 `forget_customer` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 画像存什么、存在哪、什么时候更新

还是 Day 464 开头那三个问题。

**存什么。** 一段 100 字左右的话,给客服同事看的那种:用什么套餐、是不是 VIP、反复出了什么问题、以前答应过客户什么。不存对话原文,不存性格评价。

**存在哪。** 业务库里单独一张表 `biz.customer_profiles`,Day 443 建表时就留好了:`customer_id` 主键、`summary` 正文、`source_ticket_count` 记「这份画像是基于几张已解决的工单写的」、`updated_at`。和客户数据放在同一个库,一起备份、一起删除。

**什么时候更新。** 只在这个客户「已解决的历史工单数」变了的时候。平时直接读表,一条 SQL,零成本。另一种做法是每张工单结束时都重写一次,那样每张工单都多一次模型调用,而大多数工单不会让画像有实质变化。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="客户画像的数据流:业务表到画像表,再到 load_customer 和给模型的文本">
<g font-family="var(--font-mono)" font-size="11">
<rect x="10" y="20" width="170" height="110" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="95" y="42" text-anchor="middle" font-size="12" fill="var(--ink)">业务库(事实)</text>
<text x="95" y="66" text-anchor="middle" fill="var(--ink-soft)">biz.customers</text>
<text x="95" y="86" text-anchor="middle" fill="var(--ink-soft)">biz.subscriptions</text>
<text x="95" y="106" text-anchor="middle" fill="var(--ink-soft)">biz.tickets(已解决)</text>
<rect x="235" y="20" width="170" height="110" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="42" text-anchor="middle" font-size="12" fill="var(--ink)">get_or_build_profile</text>
<text x="320" y="66" text-anchor="middle" fill="var(--ink-soft)">数一下历史工单</text>
<text x="320" y="86" text-anchor="middle" fill="var(--ink-soft)">没变:读表(0 元)</text>
<text x="320" y="106" text-anchor="middle" fill="var(--mem)">变了:调模型重写</text>
<rect x="460" y="20" width="170" height="110" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="545" y="42" text-anchor="middle" font-size="12" fill="var(--ink)">biz.customer_profiles</text>
<text x="545" y="66" text-anchor="middle" fill="var(--ink-soft)">summary</text>
<text x="545" y="86" text-anchor="middle" fill="var(--ink-soft)">source_ticket_count</text>
<text x="545" y="106" text-anchor="middle" fill="var(--ink-soft)">updated_at</text>
<line x1="180" y1="75" x2="231" y2="75" stroke="var(--ink-faint)"/><polygon points="231,71 235,75 231,79" fill="var(--ink-faint)"/>
<line x1="405" y1="75" x2="456" y2="75" stroke="var(--ink-faint)"/><polygon points="456,71 460,75 456,79" fill="var(--ink-faint)"/>
<rect x="135" y="170" width="370" height="80" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="320" y="192" text-anchor="middle" font-size="12" fill="var(--ink)">每轮 load_customer → state["profile"]</text>
<text x="320" y="214" text-anchor="middle" fill="var(--ink-soft)">_ticket_text:基本信息 → 客户画像 → 早期摘要</text>
<text x="320" y="234" text-anchor="middle" fill="var(--ink-soft)">→ 对话记录 → 客户最新消息</text>
<line x1="320" y1="130" x2="320" y2="166" stroke="var(--ink-faint)"/><polygon points="316,166 320,170 324,166" fill="var(--ink-faint)"/>
<text x="330" y="152" fill="var(--ink-faint)">deps.profile_for(customer_id, 当前工单号)</text>
</g>
</svg>
<figcaption>画像只从结构化的事实生成,不从对话原文里自由提取。每轮都读一次,但只有历史变了才花钱重写。</figcaption>
</figure>

为什么不用 LangGraph 自带的 Store?LangGraph 有一个跨 thread 的长期记忆存储,按命名空间存任意 JSON,还能做语义检索,适合「Agent 在对话里自己决定记什么」的场景。我们的画像是结构化的、一个客户一份、由固定规则触发更新,放在业务库的一张表里最直接,用的都是 Day 228 起学的普通 SQL。哪天要做「Agent 在对话中主动记下客户偏好」,再上 Store 或 mem0 这种专门的记忆库,进阶篇 Day 532–534 会专门对比。

## 第一步:写画像

新建 `memory/profile.py`:

```python
# supportpilot/src/supportpilot/memory/profile.py
"""客户画像:把一个客户的档案、订阅和已解决的历史工单压成一段 100 字左右的话,存在业务库里。
只在「已解决的历史工单数」变了的时候重建,平时直接读表,不花钱。"""

import json

from ..llm import LLMClient
from ..tools import business as biz

PROFILE_PROMPT = """根据客户档案、订阅信息和历史工单,写一段不超过 100 字的客户画像,给客服同事看。
只写对处理新工单有用的事实:套餐、是否 VIP、反复出现过什么问题、之前答应过客户什么。
不要评价客户的性格和情绪,不要写没有依据的推测。没有历史工单就只写订阅情况。只输出画像正文,不要标题。"""


def count_history(conn, customer_id: str, exclude_ticket: str | None = None) -> int:
    row = conn.execute("SELECT count(*) AS n FROM biz.tickets WHERE customer_id = %s AND status = 'resolved' "
                       "AND id IS DISTINCT FROM %s", (customer_id, exclude_ticket)).fetchone()
    return row["n"] if row else 0


def profile_facts(conn, customer_id: str, exclude_ticket: str | None = None) -> dict:
    customer = conn.execute("SELECT name, company, region, is_vip FROM biz.customers WHERE id = %s",
                            (customer_id,)).fetchone()
    past = [t for t in biz.search_past_tickets(conn, customer_id, limit=11) if t["id"] != exclude_ticket][:10]
    return {"customer": customer, "subscriptions": biz.list_subscriptions(conn, customer_id), "past_tickets": past}


def get_or_build_profile(conn, llm: LLMClient, customer_id: str, exclude_ticket: str | None = None) -> str:
    n = count_history(conn, customer_id, exclude_ticket)
    row = conn.execute("SELECT summary, source_ticket_count FROM biz.customer_profiles WHERE customer_id = %s",
                       (customer_id,)).fetchone()
    if row and row["source_ticket_count"] == n:
        return row["summary"]
    facts = profile_facts(conn, customer_id, exclude_ticket)
    res = llm.chat([{"role": "system", "content": PROFILE_PROMPT},
                    {"role": "user", "content": json.dumps(facts, ensure_ascii=False, default=str)}], temperature=0)
    summary = res.content.strip()[:300]
    conn.execute(
        "INSERT INTO biz.customer_profiles (customer_id, summary, source_ticket_count) VALUES (%s, %s, %s) "
        "ON CONFLICT (customer_id) DO UPDATE SET summary = EXCLUDED.summary, "
        "source_ticket_count = EXCLUDED.source_ticket_count, updated_at = now()",
        (customer_id, summary, n))
    return summary
```

<div class="line-notes">

- `from ..tools import business as biz` 复用 Day 452 的业务函数,订阅和历史工单不重新写 SQL。
- `PROFILE_PROMPT = """根据客户档案、订阅信息和历史工单,写一段不超过 100 字的客户画像,给客服同事看。` 输入是三类事实,下面 `profile_facts` 正好给这三样。
- `只写对处理新工单有用的事实:套餐、是否 VIP、反复出现过什么问题、之前答应过客户什么。` 要求写哪几项,输入里就必须有哪几项的数据。第二步会实测少给一项的后果。
- `不要评价客户的性格和情绪,不要写没有依据的推测。` 「该客户脾气急躁」这种话对处理工单没帮助,而且客户依法要求查看自己的数据时会很难看。同一行末尾的「只输出画像正文,不要标题」是旧课踩过坑后加的:同一个提示词两次输出,一次带 `**客户画像**` 标题一次不带。
- `def count_history(conn, customer_id: str, exclude_ticket: str | None = None) -> int:` 数这个客户已解决的工单,可以排除一张。为什么要排除,第三步实测。
- `"AND id IS DISTINCT FROM %s", (customer_id, exclude_ticket)).fetchone()` `IS DISTINCT FROM` 是「不等于」的 NULL 安全版本:`id <> NULL` 的结果是 NULL(当成假),一行都数不到;`id IS DISTINCT FROM NULL` 对每一行都是真。所以不传 exclude_ticket 时就是全部都数。相当于 JS 里 `!==` 和 `!=` 的那种差别,只是方向反过来,SQL 的普通比较遇到 NULL 会「吞掉」结果。
- `return row["n"] if row else 0` `connect()` 返回的连接设了 dict_row(Day 443),所以能按列名取。
- `customer = conn.execute("SELECT name, company, region, is_vip FROM biz.customers WHERE id = %s",` 客户档案。不取 email:画像里用不到的个人信息,一开始就不要交给模型。
- `past = [t for t in biz.search_past_tickets(conn, customer_id, limit=11) if t["id"] != exclude_ticket][:10]` 多取一张,排除当前工单后最多留 10 张,防止老客户的历史太长。`search_past_tickets` 只返回 resolved 的工单,带 `resolution_summary`。
- `return {"customer": customer, "subscriptions": biz.list_subscriptions(conn, customer_id), "past_tickets": past}` 三类事实打包成一个字典。
- `n = count_history(conn, customer_id, exclude_ticket)` 先数,一条 SQL。
- `if row and row["source_ticket_count"] == n:` 表里有画像,而且当时是基于同样多张工单写的,直接返回。实测这条路 0.001 秒。
- `res = llm.chat([{"role": "system", "content": PROFILE_PROMPT},` 要重写时才调模型。传进来的是 `deps.small_llm`。
- `{"role": "user", "content": json.dumps(facts, ensure_ascii=False, default=str)}], temperature=0)` `default=str`:日期这种 JSON 不认识的类型一律转字符串;`ensure_ascii=False` 中文原样输出,不变成 `\uXXXX`,省 token。
- `summary = res.content.strip()[:300]` 硬截断到 300 个字符,防模型写长了。提示词说 100 字,实测写了 90 字左右。
- `"INSERT INTO biz.customer_profiles (customer_id, summary, source_ticket_count) VALUES (%s, %s, %s) "` 配合下一行的 `ON CONFLICT … DO UPDATE` 就是 upsert:没有就插入,有就更新。
- `"ON CONFLICT (customer_id) DO UPDATE SET summary = EXCLUDED.summary, "` `EXCLUDED` 指的是这次想插入、因为主键冲突没插进去的那一行。相当于前端常写的 `map.set(key, value)`,有没有都一样调。
- `(customer_id, summary, n))` 记下这次基于几张工单。`connect()` 是 autocommit,这条语句执行完就提交了。

</div>

给吴刚建一份,连调两次:

```python
# supportpilot/scratch/d466/try_profile.py
"""给吴刚(C0010)建画像,连调两次:第一次调模型写,第二次直接读表。"""

import time

from supportpilot.db import connect
from supportpilot.llm import LLMClient
from supportpilot.memory.profile import get_or_build_profile

conn = connect()
llm = LLMClient()
for i in (1, 2):
    t0 = time.perf_counter()
    text = get_or_build_profile(conn, llm, "C0010")
    print(f"第 {i} 次  {time.perf_counter() - t0:.3f}s  累计调用 {llm.ledger.calls} 次")
print(text)
print(conn.execute("SELECT source_ticket_count, updated_at FROM biz.customer_profiles WHERE customer_id = 'C0010'")
      .fetchone())
print(f"花费 ¥{llm.ledger.cost_cny(llm.s):.5f}")
```

<div class="line-notes">

- `for i in (1, 2):` 遍历一个元组,跑两次。
- `text = get_or_build_profile(conn, llm, "C0010")` 第一次表里没有,要写;第二次数字没变,读表。
- `print(f"第 {i} 次  {time.perf_counter() - t0:.3f}s  累计调用 {llm.ledger.calls} 次")` 看耗时和账本里的调用次数。
- `print(conn.execute("SELECT source_ticket_count, updated_at FROM biz.customer_profiles WHERE customer_id = 'C0010'")` 直接看表里存了什么。末尾换行接 `.fetchone()`,括号没闭合时 Python 允许换行。

</div>

在 supportpilot 根目录跑:

```bash
mkdir -p scratch/d466
uv run python scratch/d466/try_profile.py
```

真实输出:

```text
第 1 次  0.961s  累计调用 1 次
第 2 次  0.001s  累计调用 1 次
上海刚正财税，VIP客户，Pro年付套餐（1席位，2027-01-10到期，自动续费）。历史三次工单均为银行流水不同步，原因均为银行授权90天到期，已指导重新授权恢复；客户多次要求授权到期前提醒。
{'source_ticket_count': 3, 'updated_at': datetime.datetime(2026, 10, 22, 13, 22, 48, 964995, tzinfo=zoneinfo.ZoneInfo(key='Asia/Shanghai'))}
花费 ¥0.00136
```

第一次 0.96 秒、一次模型调用;第二次 0.001 秒,调用次数还是 1。画像里的事实都能在种子数据里对上:吴刚 `is_vip` 是 true,订阅 S0010 是 pro 年付 1 席位、2027-01-10 到期、自动续费,三张已解决的工单(4 月、7 月、9 月)的处理摘要都是「银行授权 90 天到期,指导客户重新授权后恢复。客户希望到期前能提醒」。

## 第二步:故意犯错,少给一项事实

我照着旧课写第一版时,`profile_facts` 只给了订阅和历史工单,没有客户档案。提示词却要求写「是否 VIP」。复现一下:

```python
# supportpilot/scratch/d466/bug_no_customer.py
"""故意犯错:事实里不给客户档案,只给订阅和历史工单。提示词却要求写「是否 VIP」。"""

import json

from supportpilot.db import connect
from supportpilot.llm import LLMClient
from supportpilot.memory.profile import PROFILE_PROMPT, profile_facts

conn = connect()
llm = LLMClient()
facts = profile_facts(conn, "C0010")
del facts["customer"]                                     # 模拟第一版:忘了把客户档案交给模型
for _ in range(2):
    res = llm.chat([{"role": "system", "content": PROFILE_PROMPT},
                    {"role": "user", "content": json.dumps(facts, ensure_ascii=False, default=str)}], temperature=0)
    print(res.content, "\n")
```

<div class="line-notes">

- `del facts["customer"]` 从字典里删掉一个键,相当于 JS 的 `delete facts.customer`。
- `for _ in range(2):` 跑两次看稳不稳定。变量名用 `_` 表示「这个值我不用」。

</div>

```bash
uv run python scratch/d466/bug_no_customer.py
```

真实输出:

```text
Pro 年付套餐（1 席位，2027-01-10 到期，自动续费），非 VIP。历史三次工单均为银行流水不同步，原因均为银行授权 90 天到期，已指导重新授权恢复；客户多次要求到期前提醒。 

Pro 年付套餐（1 席位，自动续费，当前周期至 2027-01-10），非 VIP。历史三次工单均为银行流水不同步，原因均为银行授权 90 天到期，已指导重新授权恢复；客户多次希望到期前能提醒。 
```

两次都写了「非 VIP」。吴刚明明是 VIP。旧课里同样的错误,模型写的是「未标注 VIP」,至少还算老实;这次直接写成了一个错误的事实,而且两次都一样,`temperature=0` 下非常「稳定」地错。

教训很具体:**提示词要求写的每一项,输入里都得有对应的数据。** 没有的话,模型要么写「未知」,要么按最常见的情况猜。VIP 是少数,猜就猜成了「非 VIP」。这比写「未知」更危险,因为看起来像真的。

## 第三步:接进 load_customer

### Deps 多一个依赖

打开 Day 459 写的 `agent/deps.py`,导入里加一行,`Deps` 里加一个带默认值的字段,`from_conn` 里多传一个参数:

```python
# supportpilot/src/supportpilot/agent/deps.py(三处改动)
from ..memory.profile import get_or_build_profile

    settings: Settings
    # Day 466:客户画像。(customer_id, 当前工单号) -> 画像文本;默认不查,Day 463 的测试不用改
    profile_for: Callable[[str, str | None], str] = lambda customer_id, ticket_id: ""

                   finish_ticket=partial(biz.finish_ticket, conn), settings=s,
                   profile_for=partial(get_or_build_profile, conn, small))
```

<div class="line-notes">

- `from ..memory.profile import get_or_build_profile` 加在文件开头的导入里。
- `settings: Settings` 原来的最后一个字段,新字段接在它后面。
- `profile_for: Callable[[str, str | None], str] = lambda customer_id, ticket_id: ""` `Callable[[参数类型...], 返回类型]`,相当于 TS 的 `(customerId: string, ticketId: string | null) => string`。默认值是一个返回空字符串的 lambda,Day 463 的 `make_deps` 没传这个参数,照样能用。dataclass 里有默认值的字段必须排在没有默认值的后面,所以它放最后。
- `finish_ticket=partial(biz.finish_ticket, conn), settings=s,` 原来这一行末尾是 `settings=s)`,把右括号挪到下一行。
- `profile_for=partial(get_or_build_profile, conn, small))` `partial` 固定前两个参数(连接和小模型),剩下 `customer_id`、`exclude_ticket` 两个由 load_customer 传。和 Day 459 的 `call_tool=partial(call_tool, conn)` 一样的手法。

</div>

### 状态多一个字段

```python
# supportpilot/src/supportpilot/agent/state.py(customer 下面加一行)
    customer: dict | None
    profile: str            # Day 466:客户画像,每轮由 load_customer 读一次
```

<div class="line-notes">

- `customer: dict | None` 原来就有。
- `profile: str            # Day 466:客户画像,每轮由 load_customer 读一次` 没有 reducer,每轮覆盖。它其实不需要进 checkpoint(每轮都重新读),放进状态是为了 `_ticket_text` 和测试能拿到。

</div>

### load_customer 和 _ticket_text

```python
# supportpilot/src/supportpilot/agent/nodes.py(load_customer 整个替换)
    def load_customer(state: SupportState) -> dict:
        before = deps.spent()
        tid = state["ticket"]["id"]
        text, err = deps.call_tool("get_customer", {"email": state["ticket"]["customer_email"]}, ticket_id=tid)
        customer = None if err else json.loads(text)
        profile = deps.profile_for(customer["id"], tid) if customer else ""   # Day 466
        _emit({"type": "step", "node": "load_customer", "found": customer is not None, "profile": bool(profile)})
        update: dict = {"customer": customer, "profile": profile, "cost_cny": deps.spent() - before,
                        "revisions": 0, "refund_request": None, "approval": None,
                        "followup": "", "review": {}, "findings": "", "hits": [], "handoff_reason": ""}
        if not state.get("turns"):  # 第一轮:把工单正文当作客户的第一条消息
            update["turns"] = [{"role": "customer", "content": state["ticket"]["body"]}]
        return update
```

<div class="line-notes">

- `before = deps.spent()` 新增。load_customer 以前不调模型,现在重写画像时会调,要记账。
- `tid = state["ticket"]["id"]` 当前工单号下面用两次,先取出来。
- `profile = deps.profile_for(customer["id"], tid) if customer else ""   # Day 466` 找到客户才读画像,并把当前工单号传进去排除。实测吴刚这一轮拿到的就是上一步那段话。
- `_emit({"type": "step", "node": "load_customer", "found": customer is not None, "profile": bool(profile)})` 步骤事件里多一个「有没有画像」,Day 467 推给前端时用得上。只推布尔值,不推画像全文,画像是内部信息,不该出现在客户能看到的事件流里。
- `update: dict = {"customer": customer, "profile": profile, "cost_cny": deps.spent() - before,` 画像和这个节点的花费一起返回。画像不在重置列表里,但它每轮都会被重新赋值,效果一样。
- `"revisions": 0, "refund_request": None, "approval": None,` 后面这些是 Day 464 的重置列表,没变。

</div>

```python
# supportpilot/src/supportpilot/agent/nodes.py(_ticket_text 里,在 summary 那段前面插入)
    parts = [f"发件邮箱:{t['customer_email']}\n主题:{t['subject']}"]
    profile = state.get("profile")
    if profile:                                       # Day 466:跨工单的客户画像
        parts.append(f"客户画像(来自历史工单,仅供参考):\n{profile}")
    summary = state.get("summary")
```

<div class="line-notes">

- `parts = [f"发件邮箱:{t['customer_email']}\n主题:{t['subject']}"]` 原来的第一段。
- `profile = state.get("profile")` 先取出来,和昨天的 summary 一样,避免 basedpyright 的 not-required-key 报错。
- `parts.append(f"客户画像(来自历史工单,仅供参考):\n{profile}")` 「仅供参考」是给模型的提示:这是背景,不是这张工单的调查结果。第五步会看到光靠这四个字还不够。
- `summary = state.get("summary")` 昨天加的,接在后面。顺序是基本信息 → 画像 → 早期摘要 → 对话记录 → 最新消息,从「这个人是谁」到「他刚说了什么」。

</div>

画像放在 `_ticket_text` 里,分诊、调查、起草、质检四个节点都会看到。质检也要看:草稿里写了「您是 VIP 客户」,质检得知道这句话有没有依据。

### 测试

FakeLLM 加一个分支认出画像请求。在 `tests/fakes.py` 里:

```python
# supportpilot/tests/fakes.py(两处改动)
from supportpilot.memory.profile import PROFILE_PROMPT

        if messages[0]["content"] == PROFILE_PROMPT:   # Day 466:在写客户画像
            return ChatResult(content="Pro 年付 VIP,银行同步 E3001 出现过 3 次")
```

<div class="line-notes">

- `from supportpilot.memory.profile import PROFILE_PROMPT` 加在导入里,紧挨着昨天的 `SUMMARY_PROMPT`。
- `if messages[0]["content"] == PROFILE_PROMPT:   # Day 466:在写客户画像` 加在 `chat` 里昨天那个摘要分支后面、`if not self.act_script:` 前面。

</div>

新建 `tests/test_profile.py`:

```python
# supportpilot/tests/test_profile.py
"""客户画像:注入进上下文;只在历史工单数变了时重建;删除客户时快照和画像都删干净。"""

from typing import cast

import pytest
from fakes import FakeLLM, FakeTools, make_deps
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from test_memory import DRAFT, TICKET, TRIAGE

from supportpilot.agent.graph import build_graph
from supportpilot.llm import LLMClient
from supportpilot.memory.forget import forget_customer
from supportpilot.memory.profile import get_or_build_profile


def test_profile_goes_into_context():
    llm = FakeLLM(TRIAGE, [], DRAFT)
    deps = make_deps(llm, FakeTools(customer={"id": "C0010"}))
    asked: list[tuple] = []
    deps.profile_for = lambda cid, tid: asked.append((cid, tid)) or "Pro 年付 VIP,E3001 出现过 3 次"
    graph = build_graph(deps, checkpointer=InMemorySaver())
    out = graph.invoke({"ticket": TICKET}, {"configurable": {"thread_id": TICKET["id"]}})
    assert out["profile"].startswith("Pro 年付 VIP")
    assert asked == [("C0010", "T000901")]                  # 带上了当前工单号,好把它排除在历史之外


def test_no_customer_no_profile():
    deps = make_deps(FakeLLM(TRIAGE, [], DRAFT), FakeTools(customer=None))
    deps.profile_for = lambda cid, tid: pytest.fail("找不到客户时不该去读画像")
    out = build_graph(deps).invoke({"ticket": TICKET})
    assert out["profile"] == ""


@pytest.fixture
def conn():
    from supportpilot.db import connect
    c = connect()
    c.execute("DELETE FROM biz.customer_profiles WHERE customer_id = 'C0010'")
    yield c
    c.execute("DELETE FROM biz.tickets WHERE id = 'T999901'")
    c.execute("DELETE FROM biz.customer_profiles WHERE customer_id = 'C0010'")
    c.close()


@pytest.mark.db
def test_rebuild_only_when_history_changes(conn):
    llm = FakeLLM(TRIAGE, [], DRAFT)
    fake = cast(LLMClient, llm)
    get_or_build_profile(conn, fake, "C0010")
    get_or_build_profile(conn, fake, "C0010")
    assert llm.ledger.calls == 1                             # 第二次直接读表
    conn.execute("INSERT INTO biz.tickets (id, customer_id, customer_email, subject, body, status) "
                 "VALUES ('T999901', 'C0010', 'wugang@example.com', '测试', '测试', 'resolved')")
    get_or_build_profile(conn, fake, "C0010", exclude_ticket="T999901")
    assert llm.ledger.calls == 1                             # 当前这张不算历史,不重建
    get_or_build_profile(conn, fake, "C0010")
    assert llm.ledger.calls == 2                             # 真的多了一张历史工单,重建


@pytest.mark.db
def test_forget_customer_removes_memory(conn):
    get_or_build_profile(conn, cast(LLMClient, FakeLLM(TRIAGE, [], DRAFT)), "C0010")
    saver = InMemorySaver()
    deps = make_deps(FakeLLM(TRIAGE, [], DRAFT), FakeTools(customer={"id": "C0010"}))
    graph = build_graph(deps, checkpointer=saver)
    for tid in ("T000001", "T000002"):                       # 吴刚的两张历史工单各留一份对话快照
        cfg: RunnableConfig = {"configurable": {"thread_id": tid}}
        graph.invoke({"ticket": {**TICKET, "id": tid}}, cfg)
    n = conn.execute("SELECT count(*) AS n FROM biz.tickets WHERE customer_id = 'C0010'").fetchone()["n"]
    result = forget_customer(conn, saver, "C0010")
    assert result == {"customer_id": "C0010", "threads_deleted": n, "profiles_deleted": 1}
    assert graph.get_state({"configurable": {"thread_id": "T000001"}}).values == {}
```

<div class="line-notes">

- `from supportpilot.memory.forget import forget_customer` 第六步才写的函数。照着文章敲时,可以先把最后一个测试留空,第六步再补。
- `asked: list[tuple] = []` 记下 profile_for 被怎么调用,又是一个 spy。
- `deps.profile_for = lambda cid, tid: asked.append((cid, tid)) or "Pro 年付 VIP,E3001 出现过 3 次"` lambda 里只能写一个表达式。`append` 返回 None,`None or "…"` 取右边,所以这个 lambda 先记录、再返回画像。这种写法在测试里图省事可以,正式代码里别这么写。
- `assert asked == [("C0010", "T000901")]` 只调了一次,而且带着当前工单号。
- `deps.profile_for = lambda cid, tid: pytest.fail("找不到客户时不该去读画像")` 被调用就直接让测试失败。`FakeTools(customer=None)` 让 get_customer 返回错误。
- `out = build_graph(deps).invoke({"ticket": TICKET})` 不需要多轮,不传 checkpointer。
- `@pytest.fixture` 和 Day 452 `test_tools.py` 里的 conn fixture 一个写法:`yield` 之前准备,之后清理(Day 73)。
- `c.execute("DELETE FROM biz.customer_profiles WHERE customer_id = 'C0010'")` 测试前后都清掉吴刚的画像,保证起点一样,也不把假画像留在库里。
- `@pytest.mark.db` 这个标记 Day 446 在 pyproject 里定义过,`make test` 跑的是 `-m "not db and not llm"`,会跳过它;直接 `uv run pytest` 会跑。
- `get_or_build_profile(conn, fake, "C0010")` 第一次写,第二次读表。
- `conn.execute("INSERT INTO biz.tickets (id, customer_id, customer_email, subject, body, status) "` 插一张已解决的工单 T999901,模拟「刚刚 finalize 完的这一张」。
- `get_or_build_profile(conn, fake, "C0010", exclude_ticket="T999901")` 排除它,数字还是 3,不重建。
- `get_or_build_profile(conn, fake, "C0010")` 不排除,数字变成 4,重建。
- `for tid in ("T000001", "T000002"):` 吴刚种子数据里的两张工单,用假零件各跑一轮,在内存存档里留下快照。
- `n = conn.execute("SELECT count(*) AS n FROM biz.tickets WHERE customer_id = 'C0010'").fetchone()["n"]` 先数吴刚现在有几张工单。种子数据里是 3 张,但你跑过第五步的 chat_ticket 就会多出来,所以别把 3 写死。我第一版写死了 3,跑完第五步再跑测试就挂了:`assert {'customer_id...s_deleted': 1} == {'customer_id...s_deleted': 1}`。
- `assert result == {"customer_id": "C0010", "threads_deleted": n, "profiles_deleted": 1}` 每张工单都按 thread 删一遍,没有快照的那几张(比如 T000003)删一个不存在的 thread 也不报错。
- `assert graph.get_state({"configurable": {"thread_id": "T000001"}}).values == {}` 删完再读,状态是空的。

</div>

```bash
uv run pytest tests/test_profile.py -v
```

真实输出:

```text
tests/test_profile.py::test_profile_goes_into_context PASSED             [ 25%]
tests/test_profile.py::test_no_customer_no_profile PASSED                [ 50%]
tests/test_profile.py::test_rebuild_only_when_history_changes PASSED     [ 75%]
tests/test_profile.py::test_forget_customer_removes_memory PASSED        [100%]

============================== 4 passed in 5.38s ===============================
```

全部测试 `uv run pytest -q`,加上练习 1 的两个,实测 `50 passed in 8.75s`。

## 第四步:为什么要排除当前工单

`exclude_ticket` 这个参数,是旧课里踩出来的。流程是这样的:第一轮 finalize 调 `finish_ticket` 把当前工单标成 resolved;第二轮 load_customer 再读画像,已解决数从 3 变成 4,画像重建,而且新画像把「正在处理的这一张」也当成了历史。复现一下:

```python
# supportpilot/scratch/d466/bug_count_current.py
"""故意犯错:数历史工单时把「正在处理的这张」也数进去。第一轮结束 finalize 把它标成 resolved,
第二轮一读画像,数字从 3 变 4,画像重建,而且把当前这张当成了历史。"""

from supportpilot.db import connect
from supportpilot.llm import LLMClient
from supportpilot.memory.profile import count_history, get_or_build_profile
from supportpilot.tools import business as biz

conn = connect()
llm = LLMClient()
tid = biz.create_ticket(conn, "wugang@example.com", "银行流水又同步失败了", "银行流水又同步失败了,提示E3001")
biz.finish_ticket(conn, tid, "resolved", "technical", "重新授权后恢复")    # 模拟第一轮跑完
print("新工单", tid, " 不排除:", count_history(conn, "C0010"), " 排除当前:", count_history(conn, "C0010", tid))

print("排除当前 →", get_or_build_profile(conn, llm, "C0010", tid)[:40], " 调用", llm.ledger.calls)
print("不排除   →", get_or_build_profile(conn, llm, "C0010"), " 调用", llm.ledger.calls)
get_or_build_profile(conn, llm, "C0010", tid)                     # 再用正确的方式读一次,数字又变回 3
print("再排除   → 调用", llm.ledger.calls, f" 花费 ¥{llm.ledger.cost_cny(llm.s):.5f}")
conn.execute("DELETE FROM biz.tickets WHERE id = %s", (tid,))    # 演示完把这张删掉,别影响后面
```

<div class="line-notes">

- `tid = biz.create_ticket(conn, "wugang@example.com", "银行流水又同步失败了", "银行流水又同步失败了,提示E3001")` `business.py` 里的建工单函数,返回新编号,实测是 T000153。
- `biz.finish_ticket(conn, tid, "resolved", "technical", "重新授权后恢复")` 模拟第一轮 finalize 做的事。
- `print("排除当前 →", get_or_build_profile(conn, llm, "C0010", tid)[:40], " 调用", llm.ledger.calls)` 第一步已经建过画像(基于 3 张),排除当前后还是 3,直接读表。
- `print("不排除   →", get_or_build_profile(conn, llm, "C0010"), " 调用", llm.ledger.calls)` 不排除,4 ≠ 3,重建。
- `get_or_build_profile(conn, llm, "C0010", tid)` 表里现在记的是 4,再用正确方式数出 3,又重建一次。
- `conn.execute("DELETE FROM biz.tickets WHERE id = %s", (tid,))` 收尾删掉演示工单。

</div>

```bash
uv run python scratch/d466/bug_count_current.py
```

真实输出:

```text
新工单 T000153  不排除: 4  排除当前: 3
排除当前 → 上海刚正财税，VIP客户，Pro年付套餐（1席位，2027-01-10到期，自动  调用 0
不排除   → 上海刚正财税吴刚，VIP客户，Pro年付套餐（1席位，2027-01-10到期，自动续费）。历史工单多次反映银行流水不同步，均为银行授权90天到期，重新授权后恢复；客户多次要求授权到期前提醒。  调用 1
再排除   → 调用 2  花费 ¥0.00282
```

两个问题都看到了。一是白花钱:同一个客户,排除和不排除交替出现,画像来回重写,两次调用 0.0028 元。真实系统里如果有的地方传了工单号、有的地方没传,就会每轮都重建。二是内容变了:「历史三次工单」变成了「多次反映」,当前这张没解决完的工单也被算进了历史。

修法就是现在的写法:**画像只描述「这张工单之前」的这个客户**,数数和取历史都排除当前工单。load_customer 传 `tid`,`test_rebuild_only_when_history_changes` 钉住了这条规则。

## 第五步:真模型跑一张工单,看画像带来了什么

先清快照(Day 464 第七步的坑,工单号会重用),再让吴刚开一张新工单。Day 464 的 `scripts/chat_ticket.py` 里加一行,把画像也打印出来:

```python
# supportpilot/scripts/chat_ticket.py(run 函数末尾加一行)
    print(f"[记忆] 对话记录共 {len(v.get('turns', []))} 条,累计花费 ¥{v.get('cost_cny', 0):.4f}")
    print(f"[画像] {(v.get('profile') or '无')[:60]}")                     # Day 466
```

<div class="line-notes">

- `print(f"[记忆] 对话记录共 {len(v.get('turns', []))} 条` Day 464 原来的最后一行。
- `print(f"[画像] {(v.get('profile') or '无')[:60]}")                     # Day 466` 没有画像时打印「无」,有就打前 60 个字。

</div>

```bash
uv run python -m supportpilot.memory.checkpoint
printf '' | uv run python scripts/chat_ticket.py wugang@example.com "银行流水又同步失败了,提示E3001"
```

真实输出(工具调用和最终回复):

```text
cleared 18 checkpoints

  [tool] list_subscriptions({"customer_id": "C0010"})

  [tool] search_past_tickets({"customer_id": "C0010"})

  [tool] query_customer_data({"sql": "SELECT id, subject, category, status, created_at, resolved_at, resolution_summary FROM tickets ORDER BY created_at DESC"})
...
--- 发给客户(resolved)---
您好，E3001 通常是银行授权超过 90 天已过期导致的 [1]。请按以下步骤处理：进入「银行账户」点击「重新授权」，授权成功后点「立即同步」；若仍失败，请确认网银没有修改密码或注销 [1]。按 90 天周期推算，您上次恢复为 2026-09-02，本次报错与授权再次到期高度吻合。您多次提出的授权到期前提醒需求，我会转给同事跟进。如按上述步骤仍未解决，请提交工单并附上报错截图、报错码 E3001 和发生时间 [1]。

参考文章:
[1] E3001 银行流水同步失败 https://help.cloudledger.example/help/error/005

[记忆] 对话记录共 2 条,累计花费 ¥0.0235
[画像] 上海刚正财税，VIP客户，Pro年付套餐（1席位，2027-01-10到期，自动续费）。历史三次工单均为银行流水不同步，
```

和 Day 464 同一句话的第一轮回复对比,变化有三处。

好的两处:一是这次分诊判了要查账,act 去查了订阅和历史工单,Day 464 那次没查,结尾还冒出一句「我们暂未查到您的账户信息」(Day 463 问题清单第 1 条),这次没有了。二是回复里接上了客户以前提过的需求:「您多次提出的授权到期前提醒需求,我会转给同事跟进」。老客户不用再从头讲。

坏的一处,很值得记住:「按 90 天周期推算,您上次恢复为 2026-09-02,本次报错与授权再次到期高度吻合」。算一下:9 月 2 日加 90 天是 12 月 1 日,而系统的「今天」(`SP_TODAY`)是 10 月 1 日,才过了 29 天。**这句推断是错的**,质检也没拦住,因为每个数字单独看都有依据。模型拿着画像里的「90 天」和工单里的日期,自己做了一道算术题,还算错了。

这就是记忆带来的第一个新问题:模型会把记忆当成推理的原料。画像写的是事实,模型却会在事实上面加推断。我的修法是在起草提示词里明确限制画像的用途,练习 4 实测了加这条规则以后的效果。

花费 0.0235 元,比 Day 464 第一轮的 0.0054 多,主要不是因为画像(画像约 58 个 token,四个节点各带一次也就两百多个),而是这次分诊判了查账,多跑了 act 的几次工具调用。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1k8L3zxEDz&autoplay=0&high_quality=1" title="基于【LangGraph】构建长期记忆Agent,吴恩达联手LangChain创始人!附课件代码 DeepLearning.AI" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>吴恩达大模型 · 基于 LangGraph 构建长期记忆 Agent(DeepLearning.AI 课程中文字幕版,共 7 集)· 讲语义、情景、程序三类长期记忆和 LangGraph Store。先看第 2 集(Agent Memory 简介)和第 4 集(语义记忆),对照想一想:我们的画像算哪一类,为什么只用了最简单的做法。</figcaption>
</figure>

## 第六步:客户要求删除数据

现在 SupportPilot 有三种记忆,存在三个地方:

| 记忆 | 存在哪 | 按什么找 | 删除办法 |
| --- | --- | --- | --- |
| 对话状态(含 turns) | Postgres 里 checkpoint 那三张表 | thread_id = 工单号 | `saver.delete_thread(工单号)` |
| 对话摘要 | 同上,是状态的一部分 | 同上 | 同上 |
| 客户画像 | `biz.customer_profiles` | customer_id | `DELETE` 一行 |

还有两样不归 Agent 管、但也存着这个客户的东西:业务表(工单、订阅、账单、审计日志)和 Day 364 起接的 tracing 平台(每次调用的完整提示词都在里面)。

客户说「把我的数据删了」,这几处都要考虑。《个人信息保护法》第四十七条规定了个人信息处理者应当主动删除、或者个人有权请求删除的几种情形,比如处理目的已实现、个人撤回同意;同一条也说了,法律法规规定的保存期限未届满的,应当停止除存储和必要安全保护之外的处理。账单、发票这类财务记录通常有法定保存期限,删不删、保留多久要问法务和财务,不是写代码的人能决定的。

所以我的分工是:Agent 自己产生的记忆(快照、摘要、画像),由 Agent 这边删干净;业务记录交给业务流程。新建 `memory/forget.py`:

```python
# supportpilot/src/supportpilot/memory/forget.py
"""客户要求删除数据时,把 Agent 自己存的记忆删干净:每张工单的对话快照(含摘要)和客户画像。
业务记录(工单、账单、审计日志)删不删、保留多久,是法务和财务的决定,不在这里做。"""

from langgraph.checkpoint.base import BaseCheckpointSaver


def forget_customer(conn, saver: BaseCheckpointSaver, customer_id: str) -> dict:
    tickets = [r["id"] for r in conn.execute("SELECT id FROM biz.tickets WHERE customer_id = %s ORDER BY id",
                                             (customer_id,)).fetchall()]
    for tid in tickets:                                  # 先删快照:thread_id 就是工单号,要靠工单表才找得到
        saver.delete_thread(tid)
    cur = conn.execute("DELETE FROM biz.customer_profiles WHERE customer_id = %s", (customer_id,))
    return {"customer_id": customer_id, "threads_deleted": len(tickets), "profiles_deleted": cur.rowcount}


def orphan_threads(conn) -> list[str]:
    """快照表里有、工单表里已经没有的 thread。删了工单却没删快照,就会留下这种「孤儿」。"""
    rows = conn.execute("SELECT DISTINCT thread_id FROM checkpoints "
                        "WHERE thread_id NOT IN (SELECT id FROM biz.tickets) ORDER BY thread_id").fetchall()
    return [r["thread_id"] for r in rows]
```

<div class="line-notes">

- `from langgraph.checkpoint.base import BaseCheckpointSaver` 所有 checkpointer 的基类。标这个类型,PostgresSaver 和测试里的 InMemorySaver 都能传进来。
- `def forget_customer(conn, saver: BaseCheckpointSaver, customer_id: str) -> dict:` 返回删了多少,调用方可以写进审计日志。
- `tickets = [r["id"] for r in conn.execute("SELECT id FROM biz.tickets WHERE customer_id = %s ORDER BY id",` 找出这个客户的所有工单号。存档里只有 thread_id,没有 customer_id,要靠工单表把客户和 thread 对上。
- `for tid in tickets:                                  # 先删快照:thread_id 就是工单号,要靠工单表才找得到` 顺序很重要:如果业务流程先把工单删了,这里就找不到 thread 了。练习 3 实测。
- `saver.delete_thread(tid)` LangGraph checkpointer 的标准方法,删掉这个 thread 在三张表里的所有行。不存在的 thread 也不报错。
- `cur = conn.execute("DELETE FROM biz.customer_profiles WHERE customer_id = %s", (customer_id,))` `execute` 返回游标,`cur.rowcount` 是影响了几行。
- `def orphan_threads(conn) -> list[str]:` 体检用:找出没有对应工单的快照。
- `"WHERE thread_id NOT IN (SELECT id FROM biz.tickets) ORDER BY thread_id").fetchall()` 子查询:先取所有工单号,再筛出不在里面的 thread。`biz.tickets.id` 是 NOT NULL 主键,所以 `NOT IN` 不会碰到 NULL 的坑。

</div>

先体检一下我本机的库:

```bash
uv run python -c "from supportpilot.db import connect; from supportpilot.memory.forget import orphan_threads; print(orphan_threads(connect()))"
```

写今天的代码之前跑的这一次,真实输出是 `['T000153']`。这是 Day 464 最后一次实验留下的:聊完以后又重新造了一次数,`seed_db.py` 清空了工单表,快照没清。这个 thread 里存着吴刚的完整对话,却已经没有任何工单指向它,按客户删除时永远找不到。这正是「删了工单没删快照」的样子。上一步跑 chat_ticket 之前清快照时,它被一起清掉了。

现在给吴刚跑一次删除,删之前、删之后各数一遍:

```python
# supportpilot/scratch/d466/forget_demo.py
"""客户 C0010 要求删除数据:删之前、删之后各数一遍 Agent 存的记忆。"""

from supportpilot.db import connect
from supportpilot.memory.checkpoint import make_checkpointer
from supportpilot.memory.forget import forget_customer, orphan_threads

SQL = """SELECT
  (SELECT count(*) FROM checkpoints c JOIN biz.tickets t ON t.id = c.thread_id WHERE t.customer_id = %(c)s) AS snapshots,
  (SELECT count(*) FROM checkpoint_writes w JOIN biz.tickets t ON t.id = w.thread_id WHERE t.customer_id = %(c)s) AS writes,
  (SELECT count(*) FROM checkpoint_blobs b JOIN biz.tickets t ON t.id = b.thread_id WHERE t.customer_id = %(c)s) AS blobs,
  (SELECT count(*) FROM biz.customer_profiles WHERE customer_id = %(c)s) AS profiles,
  (SELECT count(*) FROM biz.tickets WHERE customer_id = %(c)s) AS tickets"""

conn = connect()
saver = make_checkpointer()
print("删除前", conn.execute(SQL, {"c": "C0010"}).fetchone())
print(forget_customer(conn, saver, "C0010"))
print("删除后", conn.execute(SQL, {"c": "C0010"}).fetchone())
print("孤儿 thread:", orphan_threads(conn))
```

<div class="line-notes">

- `from supportpilot.memory.checkpoint import make_checkpointer` Day 464 写的 PostgresSaver 工厂。
- `(SELECT count(*) FROM checkpoints c JOIN biz.tickets t ON t.id = c.thread_id WHERE t.customer_id = %(c)s) AS snapshots,` 用 JOIN 把快照和工单连起来,只数这个客户的。`%(c)s` 是 psycopg 的命名参数写法,下面传字典 `{"c": "C0010"}`,同一个值用五次只传一次。
- `(SELECT count(*) FROM checkpoint_writes w JOIN biz.tickets t ON t.id = w.thread_id` checkpoint 那三张表都要看,`delete_thread` 应该把三张都删掉。
- `(SELECT count(*) FROM biz.tickets WHERE customer_id = %(c)s) AS tickets"""` 工单数,删除后应该不变,因为工单不归我们删。

</div>

```bash
uv run python scratch/d466/forget_demo.py
```

真实输出:

```text
删除前 {'snapshots': 10, 'writes': 39, 'blobs': 11, 'profiles': 1, 'tickets': 4}
{'customer_id': 'C0010', 'threads_deleted': 4, 'profiles_deleted': 1}
删除后 {'snapshots': 0, 'writes': 0, 'blobs': 0, 'profiles': 0, 'tickets': 4}
孤儿 thread: []
```

上一步那张 T000153 的 10 份快照、39 条中间写入、11 个大字段,加上画像,全部清零;4 张工单还在。

还有三处这个函数管不到,写进上线清单:一是 tracing 平台里的调用记录,要用平台自己的删除接口按工单号删(Day 367 讲过 tracing 里的隐私问题);二是 `biz.audit_log` 的 payload 里可能带着客户信息,保留还是脱敏(Day 416)要和法务定;三是数据库备份,备份里的旧数据要等备份过期。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/3aS1A-0775s" title="Approaches for Managing Agent Memory" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Approaches for Managing Agent Memory · 官方讲记忆什么时候写入(对话中实时写还是事后后台写)、存成什么形状。我们的画像属于「事后、按规则、后台写」那一种。英文,开字幕看。</figcaption>
</figure>

## 记忆带来的新问题

三天做完三种记忆,系统好用多了,也多了几类以前没有的问题。把这三天实测到的放在一起:

**记错的东西会一直错下去。** 第二步实测:少给一项事实,画像写成「非 VIP」,之后吴刚每张工单都会带着这句错话。对策是画像只从结构化数据和已解决工单的处理摘要生成,不从对话原文里自由提取;提示词要求写的每一项,输入里都有数据。

**模型会拿记忆做推断。** 第五步实测:模型用画像里的「90 天」和历史日期推出了「授权再次到期高度吻合」,算错了。对策是在起草提示词里限定画像只当背景,练习 4。

**摘要会丢信息。** Day 465 实测:报错时间不在「必须保留」清单里,被压掉,客户问的时候答不上来。

**隐私和删除。** 记忆分散在 checkpoint、画像表、tracing、备份好几处。设计时就要知道每种记忆存在哪、按什么键能找到,第六步的 `forget_customer` 和 `orphan_threads` 就是为这个写的。

**成本。** 画像约 58 个 token,每次调模型都带着;压缩一次一两分钱;画像重建一次 0.0014 元左右。单看都不多,但 Day 485 做成本账本时要能单独看到这几项,否则说不清钱花在哪。

**画像会过期。** 我们只在已解决工单数变了时重建,客户换了套餐、加了席位,画像不会知道。练习 2 实测并给出改法。

## 零件和大代码的对照

| 零件 | 改了哪个文件 | 作用 |
| --- | --- | --- |
| `PROFILE_PROMPT`、`profile_facts`、`get_or_build_profile` | `memory/profile.py`(新) | 写画像、按历史工单数缓存、排除当前工单 |
| `profile_for` | `agent/deps.py` | 依赖注入,测试里换成 lambda |
| `profile` 字段 | `agent/state.py` | 每轮由 load_customer 写 |
| 新 `load_customer` | `agent/nodes.py` | 读画像并记账 |
| `_ticket_text` 加画像段 | `agent/nodes.py` | 四个调模型的节点都看到画像 |
| `forget_customer`、`orphan_threads` | `memory/forget.py`(新) | 按客户删记忆;找孤儿快照 |
| PROFILE 分支 | `tests/fakes.py` | 假画像 |
| `test_profile.py` | `tests/`(新) | 注入、缓存、删除 4 个测试 |

## 动手练习

**练习 1:画像放在哪一段。** 写一个不花钱的测试,断言 `_ticket_text` 里「客户画像」出现在「早期对话摘要」和「对话记录」之前、「发件邮箱」之后;没有画像时不出现这一段。

<details><summary>参考答案</summary>

```python
# supportpilot/tests/test_profile_more.py
"""练习 1:_ticket_text 里各段的顺序。"""

from typing import cast

from test_memory import TICKET

from supportpilot.agent.nodes import _ticket_text
from supportpilot.agent.state import SupportState

TURNS = [{"role": "customer", "content": "第一句"}, {"role": "agent", "content": "回复"},
         {"role": "customer", "content": "追问"}]


def test_profile_section_order():
    text = _ticket_text(cast(SupportState, {"ticket": TICKET, "turns": TURNS, "profile": "VIP,E3001 三次",
                                            "summary": "- 摘要", "summarized_upto": 0}))
    pos = [text.index(k) for k in ("发件邮箱", "客户画像", "早期对话摘要", "对话记录", "客户最新消息")]
    assert pos == sorted(pos)


def test_no_profile_no_section():
    text = _ticket_text(cast(SupportState, {"ticket": TICKET, "turns": TURNS, "profile": ""}))
    assert "客户画像" not in text
```

<div class="line-notes">

- `pos = [text.index(k) for k in ("发件邮箱", "客户画像", "早期对话摘要", "对话记录", "客户最新消息")]` `str.index` 返回子串第一次出现的位置,找不到会抛 ValueError,所以这一行同时也检查了五段都在。相当于 JS 的 `indexOf`,但找不到时不是返回 -1 而是报错。
- `assert pos == sorted(pos)` 位置是递增的,就说明顺序对。`sorted` 返回排好序的新列表,不改原列表。
- `text = _ticket_text(cast(SupportState, {"ticket": TICKET, "turns": TURNS, "profile": ""}))` 空字符串为假,不加这一段。

</div>

```bash
uv run pytest tests/test_profile_more.py -q
```

实测 `2 passed in 2.75s`。

</details>

**练习 2:画像过期。** 把吴刚的席位从 1 改成 3(他的已解决工单数没变),看 `get_or_build_profile` 会不会重建。然后改成按「事实指纹」触发:把 `profile_facts` 的结果算一个哈希存起来,哈希变了就重建。用 FakeLLM,不花钱。

<details><summary>参考答案</summary>

```python
# supportpilot/scratch/d466/ex2_stale.py
"""练习 2:吴刚把席位从 1 加到 3,已解决工单数没变,画像还写着 1 席位。换成「事实指纹」触发重建。"""

import hashlib
import json
import sys
from typing import cast

sys.path.insert(0, "tests")

from fakes import FakeLLM

from supportpilot.db import connect
from supportpilot.llm import LLMClient
from supportpilot.memory.profile import PROFILE_PROMPT, get_or_build_profile, profile_facts


def fingerprint(facts: dict) -> str:
    return hashlib.sha256(json.dumps(facts, ensure_ascii=False, default=str, sort_keys=True).encode()).hexdigest()[:16]


def get_or_build_profile_v2(conn, llm: LLMClient, customer_id: str, exclude_ticket: str | None = None) -> str:
    facts = profile_facts(conn, customer_id, exclude_ticket)
    fp = fingerprint(facts)
    row = conn.execute("SELECT summary, source_hash FROM biz.customer_profiles WHERE customer_id = %s",
                       (customer_id,)).fetchone()
    if row and row["source_hash"] == fp:
        return row["summary"]
    res = llm.chat([{"role": "system", "content": PROFILE_PROMPT},
                    {"role": "user", "content": json.dumps(facts, ensure_ascii=False, default=str)}], temperature=0)
    conn.execute("INSERT INTO biz.customer_profiles (customer_id, summary, source_ticket_count, source_hash) "
                 "VALUES (%s, %s, %s, %s) ON CONFLICT (customer_id) DO UPDATE SET summary = EXCLUDED.summary, "
                 "source_hash = EXCLUDED.source_hash, updated_at = now()",
                 (customer_id, res.content.strip()[:300], len(facts["past_tickets"]), fp))
    return res.content.strip()


conn = connect()
conn.execute("ALTER TABLE biz.customer_profiles ADD COLUMN IF NOT EXISTS source_hash text")
llm = FakeLLM({}, [], "")
fake = cast(LLMClient, llm)

for name, fn in [("按工单数", get_or_build_profile), ("按指纹", get_or_build_profile_v2)]:
    conn.execute("DELETE FROM biz.customer_profiles WHERE customer_id = 'C0010'")
    conn.execute("UPDATE biz.subscriptions SET seats = 1 WHERE customer_id = 'C0010'")
    llm.ledger.calls = 0
    fn(conn, fake, "C0010")
    conn.execute("UPDATE biz.subscriptions SET seats = 3 WHERE customer_id = 'C0010'")   # 客户加了两个席位
    fn(conn, fake, "C0010")
    print(f"{name}: 加席位前后共调用模型 {llm.ledger.calls} 次")

conn.execute("UPDATE biz.subscriptions SET seats = 1 WHERE customer_id = 'C0010'")       # 还原种子数据
conn.execute("DELETE FROM biz.customer_profiles WHERE customer_id = 'C0010'")
```

<div class="line-notes">

- `import hashlib` 标准库的哈希函数,相当于浏览器里的 `crypto.subtle.digest`,但它是同步的。
- `return hashlib.sha256(json.dumps(facts, ensure_ascii=False, default=str, sort_keys=True).encode()).hexdigest()[:16]` 从里往外读:字典转 JSON 字符串(`sort_keys=True` 保证键的顺序固定,同样的内容永远得到同样的字符串),`.encode()` 转成字节,算 SHA-256,转成十六进制字符串,取前 16 位就够区分了。
- `if row and row["source_hash"] == fp:` 事实一个字都没变,才直接读表。
- `"VALUES (%s, %s, %s, %s) ON CONFLICT (customer_id) DO UPDATE SET summary = EXCLUDED.summary, "` 和正文一样的 upsert,多写一列 source_hash。
- `conn.execute("ALTER TABLE biz.customer_profiles ADD COLUMN IF NOT EXISTS source_hash text")` 给表加一列,`IF NOT EXISTS` 让脚本可以重复跑。真正上线要写进 Day 443 的建表脚本。
- `llm.ledger.calls = 0` 每种做法开始前把计数清零。
- `conn.execute("UPDATE biz.subscriptions SET seats = 3 WHERE customer_id = 'C0010'")   # 客户加了两个席位` 改订阅,不动工单。
- `conn.execute("UPDATE biz.subscriptions SET seats = 1 WHERE customer_id = 'C0010'")       # 还原种子数据` 演示完改回去,别影响后面的课。

</div>

```bash
uv run python scratch/d466/ex2_stale.py
```

```text
按工单数: 加席位前后共调用模型 1 次
按指纹: 加席位前后共调用模型 2 次
```

按工单数,加了席位也不重建,画像还写着「1 席位」;按指纹,订阅一变就重建。代价是每次读画像都要把三类事实全查一遍(三条 SQL 加一次哈希),比数一次工单贵一点,但仍然不调模型。我会选指纹:画像里写错套餐,比多跑两条 SQL 糟糕得多。

</details>

**练习 3:删除顺序反了会怎样。** 用假模型加真 Postgres 存档:建一张吴刚的工单 T999902,跑一轮留下快照;然后**先删工单**,再调 `forget_customer`,看快照还剩多少;最后用 `orphan_threads` 补救。

<details><summary>参考答案</summary>

```python
# supportpilot/scratch/d466/ex3_wrong_order.py
"""练习 3:先删工单、再删记忆,会漏掉什么。假模型 + 真 Postgres 存档,不花钱。"""

import sys

sys.path.insert(0, "tests")

from fakes import FakeLLM, FakeTools, make_deps
from langchain_core.runnables import RunnableConfig
from test_memory import DRAFT, TICKET, TRIAGE

from supportpilot.agent.graph import build_graph
from supportpilot.db import connect
from supportpilot.memory.checkpoint import make_checkpointer
from supportpilot.memory.forget import forget_customer, orphan_threads

conn = connect()
saver = make_checkpointer()
conn.execute("INSERT INTO biz.tickets (id, customer_id, customer_email, subject, body) "
             "VALUES ('T999902', 'C0010', 'wugang@example.com', '银行流水又不同步了', '提示 E3001')")
graph = build_graph(make_deps(FakeLLM(TRIAGE, [], DRAFT), FakeTools(customer={"id": "C0010"})), checkpointer=saver)
cfg: RunnableConfig = {"configurable": {"thread_id": "T999902"}}
graph.invoke({"ticket": {**TICKET, "id": "T999902"}}, cfg)
print("跑完一轮,快照数:", len(list(saver.list(cfg))))

conn.execute("DELETE FROM biz.tickets WHERE id = 'T999902'")      # 错误顺序:先把工单删了
print(forget_customer(conn, saver, "C0010"))
print("孤儿 thread:", orphan_threads(conn), " 还剩快照:", len(list(saver.list(cfg))))

for tid in orphan_threads(conn):                                   # 补救:按孤儿清单删
    saver.delete_thread(tid)
print("补救后孤儿:", orphan_threads(conn))
```

<div class="line-notes">

- `graph = build_graph(make_deps(FakeLLM(TRIAGE, [], DRAFT), FakeTools(customer={"id": "C0010"})), checkpointer=saver)` 假模型、假工具,但存档是真的 Postgres,这样 `orphan_threads` 的 SQL 才查得到。假工具的 finish_ticket 只是往列表里记一笔,不会改工单表。
- `print("跑完一轮,快照数:", len(list(saver.list(cfg))))` `saver.list(cfg)` 逐份产出这个 thread 的快照,是生成器,`list()` 全取出来再数。
- `conn.execute("DELETE FROM biz.tickets WHERE id = 'T999902'")      # 错误顺序:先把工单删了` 模拟业务流程先删了工单。
- `for tid in orphan_threads(conn):                                   # 补救:按孤儿清单删` 孤儿清单就是补救的依据。

</div>

```bash
uv run python scratch/d466/ex3_wrong_order.py
```

```text
跑完一轮,快照数: 9
{'customer_id': 'C0010', 'threads_deleted': 4, 'profiles_deleted': 0}
孤儿 thread: ['T999902']  还剩快照: 9
补救后孤儿: []
```

forget_customer 按工单表找到了吴刚的 4 张工单,T999902 不在里面,它的 9 份快照一份没删。这份对话里有客户说过的所有话,客户以为已经删了,其实还在。所以删除流程要么严格先删记忆再删业务记录,要么定期跑 `orphan_threads` 兜底,我两个都做:删除流程里先调 forget_customer,每天再跑一次孤儿体检。

</details>

**练习 4(开放题):不让模型拿画像做推断。** 第五步的回复里,模型用画像推算了授权到期日,推错了。在 DRAFT 提示词里加一条限制,用同一句话再开一张新工单跑一次,对比回复。

<details><summary>参考答案</summary>

```python
# supportpilot/scratch/d466/ex4_profile_rule.py
"""练习 4:起草提示词加一条「画像只当背景」的规则,看回复里还会不会拿画像推算日期。真模型,跑 1 次。"""

from langgraph.checkpoint.memory import InMemorySaver

from supportpilot.agent import prompts
from supportpilot.agent.deps import Deps
from supportpilot.agent.graph import build_graph
from supportpilot.db import connect
from supportpilot.tools import business as biz

prompts.DRAFT += "\n- 【客户画像】只用来了解背景,不要据此推算日期、判断原因或下结论;具体事实以【调查结论】为准。"

conn = connect()
deps = Deps.from_conn(conn)
graph = build_graph(deps, checkpointer=InMemorySaver())
tid = biz.create_ticket(conn, "wugang@example.com", "银行流水又同步失败了", "银行流水又同步失败了,提示E3001")
out = graph.invoke({"ticket": {"id": tid, "customer_email": "wugang@example.com", "subject": "银行流水又同步失败了",
                               "body": "银行流水又同步失败了,提示E3001"}}, {"configurable": {"thread_id": tid}})
print(tid, out["outcome"])
print(out["reply"].split("\n\n参考文章")[0])
print(f"花费 ¥{deps.spent():.4f}")
```

<div class="line-notes">

- `from supportpilot.agent import prompts` 导入整个模块,下面才能改它的属性。Day 465 练习 4 讲过为什么不能 `from … import DRAFT`。
- `prompts.DRAFT += "\n- 【客户画像】只用来了解背景,不要据此推算日期、判断原因或下结论;具体事实以【调查结论】为准。"` 在原提示词末尾追加一条规则。draft 节点每次调用时读 `prompts.DRAFT`,拿到的就是新值。真要上线,改的是 prompts.py 本身,并按 Day 458 的规矩把 `PROMPT_VERSION` 升一版。
- `tid = biz.create_ticket(conn, "wugang@example.com", "银行流水又同步失败了", "银行流水又同步失败了,提示E3001")` 新开一张工单,实测编号 T000154。
- `print(out["reply"].split("\n\n参考文章")[0])` 只看正文。

</div>

```bash
uv run python scratch/d466/ex4_profile_rule.py
```

```text
T000154 resolved
您好，E3001 提示银行流水同步失败，最常见的原因是银行授权超过 90 天已过期 [1]。银行授权有效期为 90 天，到期需重新授权，否则同步会失败并提示 E3001 [2]。

处理步骤：
1. 进入「银行账户」点击「重新授权」；
2. 授权成功后点「立即同步」；
3. 仍失败的，请确认网银没有修改密码或注销 [1]。

如按上述操作仍未解决，请提交工单并附上报错截图、报错码 E3001 和发生时间，我们会转技术同事跟进 [1]。

您多次提出的"授权到期前提醒"需求目前尚未落实，我会将此诉求转给相关同事跟进。
花费 ¥0.0179
```

推算日期那句没有了,接上客户历史需求那句还在,这正是想要的效果:画像用来「认出这个人」,不用来「替调查下结论」。

一次只能看个方向。我第一版脚本是循环跑两次,第二次又踩了 Day 464 的坑:第一次跑完我把演示工单删了,第二次 `create_ticket` 又拿到同一个编号 T000154,而内存存档里这个 thread 还在,第二次其实成了第二轮对话。所以现在的脚本只跑一次。要下结论,得把「老客户、画像里有日期」这类工单放进 Day 476 的评测集里批量比。

</details>

验收标准:`uv run pytest` 全部通过(含 `test_profile.py` 4 个);你亲手复现过「少给事实写成非 VIP」和「当前工单算进历史导致重建」;真模型跑过一张带画像的工单,并且自己验算过回复里的日期推断;`forget_demo.py` 删除后快照和画像都是 0;今天真模型花费在 0.15 元以内。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 客户画像 | 跨工单的长期记忆,一段 100 字左右的事实描述。例:「VIP,Pro 年付,三次银行同步问题,要求到期前提醒」。 |
| 长期记忆 | 跨会话保留的记忆,跟着人走,不跟着一次对话走。Day 264 第一次讲。 |
| 触发重建 | 什么条件下重新生成记忆。今天用「已解决的历史工单数变了」,练习 2 换成事实指纹。 |
| upsert | 有就更新、没有就插入。Postgres 写法是 `INSERT … ON CONFLICT … DO UPDATE`。 |
| EXCLUDED | upsert 里指「这次想插入、因主键冲突没插进去的那一行」。 |
| IS DISTINCT FROM | NULL 安全的不等于,和 NULL 比较时也能得到真或假。 |
| LangGraph Store | LangGraph 自带的跨 thread 长期记忆存储,按命名空间存 JSON,今天没用。 |
| 删除权 | 个人要求删除其个人信息的权利,《个人信息保护法》第四十七条。 |
| delete_thread | checkpointer 的方法,删掉一个 thread 的全部快照。 |
| 孤儿快照 | 对应的工单已经不在了、却还留在 checkpoint 表里的快照。 |
| 事实指纹 | 把生成画像用的全部事实算一个哈希,哈希变了就说明事实变了。 |

## 常见误区

**提示词要求写什么,输入里却没给。** 第二步实测:没给客户档案,模型两次都写成「非 VIP」。模型缺数据时会按最常见的情况猜,猜出来的东西看着像真的。

**把当前工单算进历史。** 第四步实测:第一轮 finalize 把它标成 resolved,第二轮画像就重建,排除和不排除交替时画像来回重写。数数和取历史都要排除当前工单。

**以为画像只是背景,模型不会拿它推理。** 第五步实测:模型用画像推算授权到期,推错了,质检也没拦住。在起草提示词里明确画像的用途。

**每张工单结束都重写画像。** 大多数工单不会让画像有实质变化,每张都写就是每张都多一次模型调用。按条件触发,平时读表。

**画像里写评价和推测。** 「客户脾气急躁」对处理工单没帮助,还会在客户要求查看自己数据时变成问题。提示词里明确只写事实。

**以为删了工单就删干净了。** 快照按工单号存,不认识客户;画像在另一张表;tracing 平台和备份里也有。第六步列了一张表,练习 3 实测了先删工单留下 9 份孤儿快照。

**以为 Agent 这边能决定业务记录删不删。** 账单、发票往往有法定保存期限,法律也允许在期限内只存储不处理。删不删业务记录是法务和财务定的,Agent 这边负责把自己产生的记忆删干净。

**画像只在工单数变时更新就够了。** 练习 2 实测:客户加了席位,画像不变。用事实指纹更稳。

## 学习资料

### 文档与文章

- [LangGraph Memory 概念](https://docs.langchain.com/oss/python/langgraph/memory):短期记忆和长期记忆在 LangGraph 里怎么分,长期记忆部分讲了 Store 和「什么时候写入」,读完能判断自己的场景要不要上 Store。
- [LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence):checkpointer 的接口说明,`delete_thread` 在这里。
- [中华人民共和国个人信息保护法(全国人大网)](http://www.npc.gov.cn/npc/c2/c30834/202108/t20210820_313088.html):看第四章「个人在个人信息处理活动中的权利」,第四十四到五十条,15 分钟。
- [OWASP LLM02:2025 Sensitive Information Disclosure](https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/):大模型应用泄露敏感信息的常见途径,其中就有「记忆里存了不该存的东西」。
- [PostgreSQL INSERT 文档](https://www.postgresql.org/docs/current/sql-insert.html):`ON CONFLICT` 和 `EXCLUDED` 的官方说明,看 ON CONFLICT Clause 一节。
- [PostgreSQL 比较函数和运算符](https://www.postgresql.org/docs/current/functions-comparison.html):`IS DISTINCT FROM` 的定义和例子。

### B 站视频

- 吴恩达大模型《基于 LangGraph 构建长期记忆 Agent》(DeepLearning.AI 课程中文字幕版):上面嵌入的那个,7 集,先看第 2 集和第 4 集。

### 其他经典视频

- LangChain《Approaches for Managing Agent Memory》:上面嵌入的那个。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 6 章讲 Agents,其中 memory 一节讲了记忆的存储、取用和取舍,和今天的「存什么、存在哪、什么时候更新」对照着读,约 30 分钟。

### 开源项目与代码

- [mem0ai/mem0](https://github.com/mem0ai/mem0):专门做 Agent 长期记忆的开源库,会从对话里自动抽取事实、去重、更新。看它的 README 里「添加记忆」的例子,对比我们「只从结构化数据生成」的做法,想想各自适合什么场景。进阶篇 Day 533 会正式对比。

## 自测

1. 画像为什么只在「已解决的历史工单数」变了时才重建?有什么缺点?

<details><summary>答案</summary>

因为大多数工单不会让画像有实质变化,按条件触发能让绝大多数读取只是一条 SQL、零成本。缺点是工单数之外的事实变了(换套餐、加席位、VIP 状态变了)它察觉不到,练习 2 实测过,改成事实指纹能解决。

</details>

2. load_customer 为什么要把当前工单号传给 profile_for?

<details><summary>答案</summary>

第一轮结束时 finalize 会把当前工单标成 resolved。不排除的话,第二轮已解决数多 1,画像会重建,而且把正在处理、还没结束的这一张当成历史。排除当前工单,画像描述的就始终是「这张工单之前」的客户。

</details>

3. 第二步里模型为什么会写「非 VIP」?怎么避免这类问题?

<details><summary>答案</summary>

提示词要求写是否 VIP,输入里却没有客户档案,模型只能猜,按最常见的情况猜成了非 VIP。避免办法:提示词要求输出的每一项,输入里都要有对应的数据;评测时专门检查画像里的事实能不能在数据库里对上。

</details>

4. 客户要求删除数据,`forget_customer` 删了什么、没删什么?为什么要先删快照再删工单?

<details><summary>答案</summary>

删了这个客户所有工单的对话快照(包括 turns 和摘要)和画像。没删业务记录(工单、订阅、账单、审计日志),它们可能有法定保存期限,要法务和财务决定;tracing 平台和备份也不在这个函数里。先删快照,是因为快照只按工单号存,要靠工单表才能从客户找到 thread,工单先删了就找不到了,会留下孤儿快照。

</details>

5. 面试题:你的客服 Agent 有长期记忆吗?怎么设计的?会带来什么问题?

<details><summary>答案</summary>

示范回答:有,我把记忆按「存什么、存在哪、什么时候读写」拆成三种。工单内的对话状态存在 Postgres checkpoint 里,thread_id 是工单号;对话太长时压成滚动摘要,也在状态里;跨工单的是客户画像,一段 100 字的事实描述,存在业务库单独一张表。画像只从客户档案、订阅和已解决工单的处理摘要生成,不从对话原文里抽,只在事实变了时重建,平时零成本读表,数历史时排除当前工单。我实测踩过三个坑:输入少给了客户档案,模型把 VIP 写成了非 VIP;当前工单被算进历史,画像来回重建;模型拿画像里的周期去推算日期,推错了,后来在起草提示词里限定画像只当背景。隐私上,我写了按客户删除记忆的函数,先删快照再删画像,另外每天跑一次孤儿快照体检;业务记录的保留期限交给法务。没用 LangGraph Store 或 mem0,因为画像是结构化、一客户一份、规则触发的,一张表最直接,以后要做「对话中主动记偏好」再引入。

</details>

## 明天预告

明天是 Day 467,界面(一):并发成本 bug、接口设计和 SSE 事件协议。到今天为止,SupportPilot 有了完整的工作流和三种记忆,但只能在终端里用 `chat_ticket.py` 跑。明天用 FastAPI 把它包成 HTTP 接口:建工单、跑工单、追问、查状态、列待审批、审批,其中跑工单、追问、审批三个用 SSE 流式推送。动手之前先修一个只有在服务端才会出现的 bug:所有请求共用一个 LLM 客户端的账本,两张工单同时跑时,成本会算到别人头上。今天 load_customer 新加的那行 `before = deps.spent()` 也会被这个 bug 影响。
