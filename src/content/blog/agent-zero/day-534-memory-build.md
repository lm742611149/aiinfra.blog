---
title: 'Day 534 · 记忆系统(三):给 SupportPilot 写客户记忆并评测'
description: '昨天选定了自己写客户记忆。今天用 SQLite 一步一个脚本搭出来:先存进去,再处理重复和改写,再加来源优先级和敏感字段拦截,再加有效期和衰减,最后拼成一个 MemoryStore。然后用一批标注过的客服对话测它的写入质量:抽取准不准、漏没漏、敏感信息有没有全部拦住。'
pubDate: 2026-10-22
regime: none
tags: ['memory', 'sqlite', 'evaluation', 'supportpilot', 'agent-zero']
series: 'agent-zero'
day: 534
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 533](/blog/agent-zero/day-533-memory-oss/) 把 mem0、Letta、Zep/Graphiti、LangGraph store 四个方案放在「谁来写」和「冲突怎么处理」两根轴上比了一遍,还亲手跑了 mem0:客户说「我降级了」,它只追加了一条新记忆,问「现在是什么套餐」时旧套餐反而排第一。最后的结论是,SupportPilot 的记忆规则和业务规则绑得太紧,自己写:冲突处理借 Graphiti 的「旧值不删、标记被替代」,写入借 mem0 的「对话结束后由后台流程抽取」。

今天就把它写出来,并且回答一个做完以后一定会被问的问题:你怎么知道它记对了?

## 今天要解决的问题

学完今天你应该能做到:

1. 用 SQLite 实现一个客户记忆 `MemoryStore`,支持五件事:按租户和客户隔离、来源优先级(业务系统 > 客服确认 > 模型抽取)、敏感字段直接拒绝、按类型设有效期、按客户删除;写入时返回 ADD / UPDATE / NOOP / REJECT 四种结果之一。
2. 写一个后台抽取函数 `extract_facts`,从一段客服对话里抽出候选事实喂给 `write`。
3. 用一批标注过的对话评测写入质量,算出准确率(precision)和召回率(recall),单独统计敏感信息的拦截率,并用 pytest 把「过期的不再被想起」这类规则钉死。

预计用时 3 小时。前置:[Day 532](/blog/agent-zero/day-532-memory-taxonomy/)(四个设计问题和遗忘)、[Day 533](/blog/agent-zero/day-533-memory-oss/)(选型)、[Day 92](/blog/agent-zero/day-092-python-sqlite-1/)(sqlite3 和 `?` 占位符)、[Day 93](/blog/agent-zero/day-093-python-sqlite-2/)(事务和 commit)、[Day 50](/blog/agent-zero/day-050-dataclass/)(dataclass)、[Day 148](/blog/agent-zero/day-148-structured-2/)(JSON mode)、[Day 71](/blog/agent-zero/day-071-pytest-1/)(pytest)。

今天的两个新概念:一个是**写入规则**,也就是把 Day 532 那几个问题的答案写成确定性的代码,包括「怎么忘」;另一个是**记忆的写入评测**,用标注数据给记忆系统打分。其他都是学过的 SQL 和 Python。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分(`MemoryStore.write` 和 `_current`);做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先看整体:一条记忆从对话走到数据库

动手前先把流程画出来。工单关闭以后,后台流程把整段对话交给模型抽出候选事实,每条候选事实再经过几道**确定性**的检查,最后得到四种结果之一。

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="记忆写入流程:工单关闭后由模型抽取候选事实,经过敏感字段、是否重复、来源优先级三道检查,结果是新增、更新、不变或拒绝">
  <rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11" text-anchor="middle">
    <rect x="10" y="80" width="86" height="44" rx="4" fill="var(--paper)" stroke="var(--ink-soft)"/>
    <text x="53" y="100" fill="var(--ink)">工单关闭</text><text x="53" y="116" fill="var(--ink-faint)" font-size="10">后台触发</text>
    <rect x="108" y="80" width="96" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="156" y="100" fill="var(--ink)">LLM 抽取</text><text x="156" y="116" fill="var(--ink-faint)" font-size="10">extract_facts</text>
    <rect x="216" y="80" width="90" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="261" y="100" fill="var(--ink)">敏感字段?</text><text x="261" y="116" fill="var(--ink-faint)" font-size="10">是 → REJECT</text>
    <rect x="318" y="80" width="90" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="363" y="100" fill="var(--ink)">值没变?</text><text x="363" y="116" fill="var(--ink-faint)" font-size="10">是 → NOOP</text>
    <rect x="420" y="80" width="96" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="468" y="100" fill="var(--ink)">来源够格?</text><text x="468" y="116" fill="var(--ink-faint)" font-size="10">否 → REJECT</text>
    <rect x="536" y="40" width="94" height="30" rx="4" fill="var(--paper)" stroke="var(--mem)"/><text x="583" y="60" fill="var(--ink)">ADD</text>
    <rect x="536" y="80" width="94" height="30" rx="4" fill="var(--paper)" stroke="var(--mem)"/><text x="583" y="100" fill="var(--ink)">UPDATE</text>
    <rect x="536" y="120" width="94" height="44" rx="4" fill="var(--paper)" stroke="var(--rule)"/><text x="583" y="138" fill="var(--ink-faint)">旧值标记</text><text x="583" y="154" fill="var(--ink-faint)">superseded_by</text>
    <text x="320" y="190" fill="var(--ink-faint)" font-size="10">只有抽取这一步靠模型,后面三道检查都是普通的 if,可以写单元测试</text>
  </g>
  <g stroke="var(--ink-faint)" fill="none">
    <line x1="96" y1="102" x2="108" y2="102"/><line x1="204" y1="102" x2="216" y2="102"/><line x1="306" y1="102" x2="318" y2="102"/><line x1="408" y1="102" x2="420" y2="102"/>
    <line x1="516" y1="102" x2="536" y2="55"/><line x1="516" y1="102" x2="536" y2="95"/><line x1="583" y1="110" x2="583" y2="120"/>
  </g>
</svg>
<figcaption>今天要搭的东西。蓝色是模型,琥珀色是确定性的代码。记忆系统能不能评测、能不能审计,关键在于把尽量多的判断放在琥珀色那一侧。</figcaption>
</figure>

下面按「每一步只比上一步多一个东西」的顺序来。所有文件都放在 `agent-zero-lab/part10/`,在 `agent-zero-lab/` 目录下运行。

## 第一步:先存进去,顺便踩一个 NULL 的坑

先建表,写一个最朴素的 `write`:来什么存什么。表里每一行是一条事实。新建 `part10/mem_step1.py`:

```python
# agent-zero-lab/part10/mem_step1.py
import sqlite3

db = sqlite3.connect(":memory:")
db.execute("""CREATE TABLE facts(
    id INTEGER PRIMARY KEY, tenant TEXT, customer_id TEXT, kind TEXT, key TEXT, value TEXT,
    source TEXT, created_at REAL, superseded_by INTEGER)""")


def write(tenant: str, customer_id: str, kind: str, key: str, value: str, source: str, now: float) -> int:
    cur = db.execute(
        "INSERT INTO facts(tenant,customer_id,kind,key,value,source,created_at) VALUES(?,?,?,?,?,?,?)",
        (tenant, customer_id, kind, key, value, source, now))
    return cur.lastrowid or 0


print(write("cloudledger", "C007", "profile", "plan", "年付专业版", "system", 1_790_000_000))
print(write("cloudledger", "C007", "preference", "contact", "只接受邮件", "extracted", 1_790_000_000))
db.execute("UPDATE facts SET superseded_by=99 WHERE id=1")
print("用 = NULL:", db.execute("SELECT key FROM facts WHERE superseded_by = NULL").fetchall())
print("用 IS NULL:", db.execute("SELECT key FROM facts WHERE superseded_by IS NULL").fetchall())
```

<div class="line-notes">

- `db = sqlite3.connect(":memory:")` `:memory:` 是一个特殊的文件名,数据库只存在内存里,进程结束就没了。做实验最方便,不会在硬盘上留下文件。
- `id INTEGER PRIMARY KEY, tenant TEXT, customer_id TEXT,` 每条事实带租户和客户两列,两家公司都有 C007 也不会串。`INTEGER PRIMARY KEY` 在 SQLite 里会自动递增(Day 91)。同一行后面的 kind 是事实的类型:`profile`(画像)、`preference`(偏好)、`situation`(当前问题)、`episode`(发生过的事)。key 是哪一项,比如 `plan`、`contact`。value 是值。
- `source TEXT, created_at REAL, superseded_by INTEGER)` source 记来源;`created_at` 用 Unix 时间戳(秒,浮点数),相当于 JS 的 `Date.now() / 1000`;`superseded_by` 记「被哪一条新事实替代了」,还没被替代就是 NULL。
- `def write(` 第一版什么都不检查,来一条存一条。
- `"INSERT INTO facts(tenant,customer_id,kind,key,value,source,created_at) VALUES(?,?,?,?,?,?,?)",` 七个 `?` 占位符,值由第二个参数按顺序填进去,不要用 f-string 拼 SQL(Day 92 演示过注入)。
- `return cur.lastrowid or 0` `lastrowid` 是刚插入那一行的 id,类型上可能是 None,`or 0` 兜底。第一次是 1,第二次是 2。
- `1_790_000_000` 数字里的下划线只是为了好读,等于 1790000000,对应 2026 年 9 月下旬的某个时刻。今天所有时间都从这个固定值往后加,这样输出每次都一样。
- `db.execute("UPDATE facts SET superseded_by=99 WHERE id=1")` 假装第 1 条已经被 id 为 99 的新事实替代了。
- `"SELECT key FROM facts WHERE superseded_by = NULL"` 故意写错的版本。
- `"SELECT key FROM facts WHERE superseded_by IS NULL"` 正确的写法。

</div>

```bash
cd agent-zero-lab
uv run python part10/mem_step1.py
```

```text
1
2
用 = NULL: []
用 IS NULL: [('contact',)]
```

`= NULL` 一行都查不到,没有报错,就是安安静静地返回空列表。SQL 里 NULL 表示「未知」,任何东西和未知比较,结果都是未知,不是真也不是假,所以 `WHERE` 不会选中任何一行。判断是不是 NULL 必须用 `IS NULL` 或 `IS NOT NULL`。这个坑放在记忆系统里特别隐蔽:查「当前有效的记忆」写成 `= NULL`,Agent 就什么都想不起来,但程序看上去一切正常。

## 第二步:重复的不存,改了的把旧的标记掉

同一个 key 来了新值,要先找到「当前值」,再决定怎么办:值一样就是 NOOP,不一样就插入新的,并把旧的那条的 `superseded_by` 填成新行的 id。旧值不删,这是从 Graphiti 那里借来的思路。新建 `part10/mem_step2.py`:

```python
# agent-zero-lab/part10/mem_step2.py
import sqlite3

db = sqlite3.connect(":memory:")
db.execute("""CREATE TABLE facts(
    id INTEGER PRIMARY KEY, tenant TEXT, customer_id TEXT, kind TEXT, key TEXT, value TEXT,
    source TEXT, created_at REAL, superseded_by INTEGER)""")


def current(tenant: str, customer_id: str, key: str) -> tuple | None:
    return db.execute(
        "SELECT id, value, source FROM facts WHERE tenant=? AND customer_id=? AND key=?"
        " AND superseded_by IS NULL ORDER BY created_at DESC LIMIT 1",
        (tenant, customer_id, key)).fetchone()


def write(tenant, customer_id, kind, key, value, source, now) -> str:
    cur = current(tenant, customer_id, key)
    if cur and cur[1] == value:
        return "NOOP"
    new_id = db.execute(
        "INSERT INTO facts(tenant,customer_id,kind,key,value,source,created_at) VALUES(?,?,?,?,?,?,?)",
        (tenant, customer_id, kind, key, value, source, now)).lastrowid
    if cur:
        db.execute("UPDATE facts SET superseded_by=? WHERE id=?", (new_id, cur[0]))
        return "UPDATE"
    return "ADD"


T, C, t0 = "cloudledger", "C007", 1_790_000_000
print(write(T, C, "profile", "plan", "年付专业版", "system", t0))
print(write(T, C, "profile", "plan", "年付专业版", "system", t0 + 10))
print(write(T, C, "profile", "plan", "免费版", "extracted", t0 + 20))  # 客户在对话里随口一句
print("现在的 plan:", current(T, C, "plan"))
print("全部行:", db.execute("SELECT id, value, source, superseded_by FROM facts").fetchall())
```

<div class="line-notes">

- `def current(tenant: str, customer_id: str, key: str) -> tuple | None:` 查某个客户某个 key 的当前值。找到返回一个元组 `(id, value, source)`,找不到返回 None。
- `"SELECT id, value, source FROM facts WHERE tenant=? AND customer_id=? AND key=?"` 两个相邻的字符串字面量会被 Python 自动拼成一个,这是把长 SQL 拆成多行的常用写法,注意下一行开头留一个空格。
- `" AND superseded_by IS NULL ORDER BY created_at DESC LIMIT 1",` 还没被替代的、最新的一条。第一步刚踩过的坑,这里用的是 `IS NULL`。
- `.fetchone()` 取一行,没有就是 None。
- `def write(tenant, customer_id, kind, key, value, source, now) -> str:` 这一版参数没写类型,能跑;第四步拼完整版时再补全。返回值改成字符串,告诉调用方发生了什么。
- `if cur and cur[1] == value:` `cur[1]` 是当前值。第二次写「年付专业版」时值没变,直接 NOOP,不插新行。
- `new_id = db.execute(` 值变了或者原来没有,插入新行,拿到新行的 id。
- `db.execute("UPDATE facts SET superseded_by=? WHERE id=?", (new_id, cur[0]))` 旧行不删,只记下它被谁替代了。
- `print(write(T, C, "profile", "plan", "免费版", "extracted", t0 + 20))  # 客户在对话里随口一句` 模型从对话里抽出来「客户说自己是免费版」。看看会发生什么。

</div>

```bash
uv run python part10/mem_step2.py
```

```text
ADD
NOOP
UPDATE
现在的 plan: (2, '免费版', 'extracted')
全部行: [(1, '年付专业版', 'system', 2), (2, '免费版', 'extracted', None)]
```

前两行符合预期。第三行出事了:业务系统写的「年付专业版」被模型从对话里抽出来的「免费版」替代了。客户也许是在开玩笑,也许是记错了,也许是想试探能不能少交钱,不管哪种,现在 Agent 认为他是免费版。好在旧值还在第 1 行,`superseded_by=2`,出了事至少查得到。

这正是 Day 532 说的「新的覆盖旧的」那种策略的问题。下一步加来源优先级。

## 第三步:来源优先级和敏感字段

两条新规则,都是普通的 if:

- 来源分三级:`system`(业务系统)3 分,`agent_confirmed`(客服人工确认过)2 分,`extracted`(模型从对话里抽的)1 分。低分不能覆盖高分。
- 有几个 key 永远不进记忆:`card_number`、`password`、`id_number`,写入层直接拒绝。

新建 `part10/mem_step3.py`(和第二步相比,只多了开头两个常量和 `write` 里的两个 if):

```python
# agent-zero-lab/part10/mem_step3.py
import sqlite3

SOURCE_RANK = {"system": 3, "agent_confirmed": 2, "extracted": 1}
FORBIDDEN_KEYS = {"card_number", "password", "id_number"}

db = sqlite3.connect(":memory:")
db.execute("""CREATE TABLE facts(
    id INTEGER PRIMARY KEY, tenant TEXT, customer_id TEXT, kind TEXT, key TEXT, value TEXT,
    source TEXT, created_at REAL, superseded_by INTEGER)""")


def current(tenant, customer_id, key):
    return db.execute(
        "SELECT id, value, source FROM facts WHERE tenant=? AND customer_id=? AND key=?"
        " AND superseded_by IS NULL ORDER BY created_at DESC LIMIT 1",
        (tenant, customer_id, key)).fetchone()


def write(tenant, customer_id, kind, key, value, source, now) -> str:
    if key in FORBIDDEN_KEYS:
        return "REJECT"
    cur = current(tenant, customer_id, key)
    if cur and cur[1] == value:
        return "NOOP"
    if cur and SOURCE_RANK[source] < SOURCE_RANK[cur[2]]:
        return "REJECT"
    new_id = db.execute(
        "INSERT INTO facts(tenant,customer_id,kind,key,value,source,created_at) VALUES(?,?,?,?,?,?,?)",
        (tenant, customer_id, kind, key, value, source, now)).lastrowid
    if cur:
        db.execute("UPDATE facts SET superseded_by=? WHERE id=?", (new_id, cur[0]))
        return "UPDATE"
    return "ADD"


T, C, t0 = "cloudledger", "C007", 1_790_000_000
print(write(T, C, "profile", "plan", "年付专业版", "system", t0))
print(write(T, C, "profile", "plan", "免费版", "extracted", t0 + 20))
print(write(T, C, "profile", "plan", "月付基础版", "system", t0 + 30))
print(write(T, C, "preference", "card_number", "6222 **** 1234", "extracted", t0 + 40))
print(write(T, C, "preference", "contact", "只接受邮件", "extracted", t0 + 50))
print(write(T, C, "preference", "contact", "电话也可以", "agent_confirmed", t0 + 60))
print("现在的 plan:", current(T, C, "plan"), "| contact:", current(T, C, "contact"))
```

<div class="line-notes">

- `SOURCE_RANK = {"system": 3, "agent_confirmed": 2, "extracted": 1}` 用 dict 存优先级,数字越大越可信。
- `FORBIDDEN_KEYS = {"card_number", "password", "id_number"}` 花括号里只有值没有冒号,是集合(Day 25),相当于 JS 的 `new Set([...])`,用 `in` 判断是否包含很快。
- `if key in FORBIDDEN_KEYS:` 放在最前面,连数据库都不查,直接拒绝。
- `if cur and SOURCE_RANK[source] < SOURCE_RANK[cur[2]]:` `cur[2]` 是当前值的来源。模型抽的「免费版」是 1 分,当前值来自系统是 3 分,1 < 3,拒绝。注意同级可以覆盖:两条都是 `extracted` 时,新的会替代旧的。
- `print(write(T, C, "profile", "plan", "月付基础版", "system", t0 + 30))` 业务系统确认他真的降级了,来源同为 3 分,允许替代。
- `print(write(T, C, "preference", "card_number", "6222 **** 1234",` 哪怕值已经打了码,key 是卡号就拒绝。
- `print(write(T, C, "preference", "contact", "电话也可以", "agent_confirmed", t0 + 60))` 客服人工确认的(2 分)可以覆盖模型抽的(1 分)。

</div>

```bash
uv run python part10/mem_step3.py
```

```text
ADD
REJECT
UPDATE
REJECT
ADD
UPDATE
现在的 plan: (2, '月付基础版', 'system') | contact: (4, '电话也可以', 'agent_confirmed')
```

第二行 REJECT 就是我们想要的:对话里的「免费版」碰不到业务系统的数据。因为它被拒绝了没有插入,所以后面「月付基础版」拿到的 id 是 2。第四行的卡号也拒绝了。

这里要强调一下,敏感字段的拦截**必须**是这样一个写死的 if,而不是在提示词里写「不要记录卡号」。模型听话的概率再高也不是 100%,而这里漏一次就是一次合规事故。下面评测时你会看到,模型确实会老老实实把卡号抽出来,靠的就是这一行代码把它挡在门外。

## 第四步:有效期和衰减

最后一块是 Day 532 说的「怎么忘」。两个机制:

- **有效期(TTL)**:不同 kind 过期时间不同。`situation`(当前问题,比如「正在等退款」)30 天;`episode`(发生过的事)180 天;`preference` 和 `profile` 不过期,直到被新值替代。
- **衰减**:检索打分时越旧的分越低。用「半衰期」来定义:半衰期 30 天,意思是 30 天前的记忆新近度只剩一半,60 天前剩四分之一。这个「重要性 × 新近度」的打分思路来自 2023 年斯坦福的《Generative Agents》论文。

先不碰数据库,用一个纯 Python 脚本看清这两个机制的数字。新建 `part10/mem_step4.py`:

```python
# agent-zero-lab/part10/mem_step4.py
import math

DAY = 86400
TTL = {"preference": None, "profile": None, "situation": 30 * DAY, "episode": 180 * DAY}


def decay(age_seconds: float, half_life_days: float = 30) -> float:
    return math.exp(-math.log(2) * age_seconds / (half_life_days * DAY))


for days in [0, 15, 30, 60, 90]:
    print(f"{days:>2} 天前的记忆,新近度 = {decay(days * DAY):.3f}")

t0 = 1_790_000_000
facts = [  # (key, kind, importance, created_at)
    ("contact", "preference", 0.8, t0),
    ("open_issue", "situation", 0.7, t0),
    ("last_mood", "episode", 0.3, t0 + 1 * DAY),
]
for now_day in [3, 40]:
    now = t0 + now_day * DAY
    alive = []
    for key, kind, imp, created in facts:
        ttl = TTL[kind]
        if ttl is not None and created + ttl <= now:
            continue  # 过了有效期,直接不返回
        alive.append((key, round(imp * decay(now - created), 3)))
    print(f"第 {now_day} 天:", sorted(alive, key=lambda x: x[1], reverse=True))
```

<div class="line-notes">

- `DAY = 86400` 一天的秒数,24 × 60 × 60。
- `TTL = {"preference": None, "profile": None, "situation": 30 * DAY, "episode": 180 * DAY}` None 表示不过期。
- `return math.exp(-math.log(2) * age_seconds / (half_life_days * DAY))` 半衰期公式,等价于 `0.5 ** (年龄 / 半衰期)`。代入 30 天:`0.5 ** 1 = 0.5`;代入 60 天:`0.5 ** 2 = 0.25`。写成 exp 和 log 的形式只是习惯,和论文里的写法一致。
- `print(f"{days:>2} 天前的记忆,新近度 = {decay(days * DAY):.3f}")` `:>2` 右对齐占两格,`:.3f` 保留三位小数,对应 JS 的 `padStart(2)` 和 `toFixed(3)`。
- `facts = [  # (key, kind, importance, created_at)` 三条记忆,用元组表示。`last_mood` 是「上次聊天时客户很生气」这种情景记忆,重要性只给 0.3。
- `for key, kind, imp, created in facts:` 循环里直接解包元组(Day 22),相当于 JS 的 `for (const [key, kind, imp, created] of facts)`。
- `if ttl is not None and created + ttl <= now:` 有有效期且已经过期,跳过。第 40 天时 `open_issue` 创建已经 40 天,超过 30 天,被跳过。
- `alive.append((key, round(imp * decay(now - created), 3)))` 分数 = 重要性 × 新近度。第 3 天的 contact:0.8 × 0.5^(3/30) = 0.8 × 0.933 ≈ 0.746。
- `sorted(alive, key=lambda x: x[1], reverse=True)` 按分数从高到低排。

</div>

```bash
uv run python part10/mem_step4.py
```

```text
 0 天前的记忆,新近度 = 1.000
15 天前的记忆,新近度 = 0.707
30 天前的记忆,新近度 = 0.500
60 天前的记忆,新近度 = 0.250
90 天前的记忆,新近度 = 0.125
第 3 天: [('contact', 0.746), ('open_issue', 0.653), ('last_mood', 0.286)]
第 40 天: [('contact', 0.317), ('last_mood', 0.122)]
```

第 40 天,「当前问题」因为过了 30 天有效期直接消失,不管它的重要性有多高。偏好没有有效期,但分数从 0.746 衰减到 0.317。这两个机制分工不同:有效期管「这条信息还是不是真的」,衰减管「这条信息还排不排得上号」。三个月前「正在处理退款」早就不是真的了,不应该因为它重要性高就排在前面,所以必须有有效期;而「只接受邮件」大概率一直是真的,只是在有很多新记忆时可以往后让一让。

我写这个脚本时还踩过一个坑:一开始我把 `last_mood` 的创建时间设成第 20 天,结果第 3 天查询时它的「年龄」是负数,衰减算出来大于 1,分数反而比创建时还高。来自「未来」的记忆不该被想起,所以完整版的 `recall` 会多加一个条件 `created_at <= now`。

## 拼起来:MemoryStore

四步的零件都有了。现在把它们收进一个类,再补上三样东西:每种 kind 的默认重要性、按客户删除(`forget_customer`)、查某个 key 的完整历史(`history`)。新建 `part10/memory_store.py`:

```python
# agent-zero-lab/part10/memory_store.py
"""SupportPilot 客户记忆:带来源、有效期、可撤销的事实存储。"""
import math
import sqlite3
import time
from dataclasses import dataclass

DAY = 86400
SOURCE_RANK = {"system": 3, "agent_confirmed": 2, "extracted": 1}
TTL = {"preference": None, "profile": None, "situation": 30 * DAY, "episode": 180 * DAY}
DEFAULT_IMPORTANCE = {"profile": 0.9, "preference": 0.8, "situation": 0.7, "episode": 0.4}
FORBIDDEN_KEYS = {"card_number", "password", "id_number"}
COLS = "id,customer_id,kind,key,value,source,created_at,expires_at,importance"


@dataclass
class Fact:
    id: int
    customer_id: str
    kind: str
    key: str
    value: str
    source: str
    created_at: float
    expires_at: float | None
    importance: float


class MemoryStore:
    def __init__(self, path: str = ":memory:"):
        self.db = sqlite3.connect(path)
        self.db.execute("""CREATE TABLE IF NOT EXISTS facts(
            id INTEGER PRIMARY KEY, tenant TEXT, customer_id TEXT, kind TEXT, key TEXT, value TEXT,
            source TEXT, created_at REAL, expires_at REAL, importance REAL,
            superseded_by INTEGER, deleted INTEGER DEFAULT 0)""")

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

    def _current(self, tenant: str, customer_id: str, key: str, now: float) -> Fact | None:
        row = self.db.execute(
            f"SELECT {COLS} FROM facts WHERE tenant=? AND customer_id=? AND key=?"
            " AND superseded_by IS NULL AND deleted=0 AND (expires_at IS NULL OR expires_at>?)"
            " ORDER BY created_at DESC LIMIT 1", (tenant, customer_id, key, now)).fetchone()
        return Fact(*row) if row else None

    def recall(self, tenant: str, customer_id: str, k: int = 5, now: float | None = None,
               half_life_days: float = 30) -> list[Fact]:
        now = time.time() if now is None else now
        rows = self.db.execute(
            f"SELECT {COLS} FROM facts WHERE tenant=? AND customer_id=?"
            " AND superseded_by IS NULL AND deleted=0 AND (expires_at IS NULL OR expires_at>?)"
            " AND created_at<=?", (tenant, customer_id, now, now)).fetchall()
        facts = [Fact(*r) for r in rows]

        def score(f: Fact) -> float:
            age = now - f.created_at
            return f.importance * math.exp(-math.log(2) * age / (half_life_days * DAY))

        return sorted(facts, key=score, reverse=True)[:k]

    def forget_customer(self, tenant: str, customer_id: str) -> int:
        return self.db.execute("UPDATE facts SET deleted=1 WHERE tenant=? AND customer_id=? AND deleted=0",
                               (tenant, customer_id)).rowcount

    def history(self, tenant: str, customer_id: str, key: str) -> list[tuple[str, str]]:
        return self.db.execute(
            "SELECT value, source FROM facts WHERE tenant=? AND customer_id=? AND key=? ORDER BY created_at",
            (tenant, customer_id, key)).fetchall()
```

<div class="line-notes">

- `"""SupportPilot 客户记忆:带来源、有效期、可撤销的事实存储。"""` 文件开头的三引号字符串是模块的文档字符串,编辑器悬停时会显示。
- `DEFAULT_IMPORTANCE = {"profile": 0.9, "preference": 0.8, "situation": 0.7, "episode": 0.4}` 每种 kind 一个默认重要性。调用方不传 importance 时用它,不用每次都记得传。
- `COLS = "id,customer_id,kind,key,value,source,created_at,expires_at,importance"` 两个查询都要取这 9 列,顺序必须和下面 `Fact` 的字段顺序一致,因为后面是 `Fact(*row)` 按位置填的。
- `@dataclass` 自动生成 `__init__`,`Fact(1, "C007", ...)` 就能建对象(Day 50)。
- `expires_at: float | None` 过期时间戳,None 表示不过期。
- `def __init__(self, path: str = ":memory:"):` 默认在内存里,传一个文件路径就会落盘,比如 `MemoryStore("part10/memory.db")`。
- `source TEXT, created_at REAL, expires_at REAL, importance REAL,` 比前几步多了过期时间和重要性两列。
- `superseded_by INTEGER, deleted INTEGER DEFAULT 0)""")` 多了一列删除标记,默认 0。SQLite 没有布尔类型,用 0 和 1。
- `source: str = "extracted", importance: float | None = None,` 默认来源是最低的 `extracted`,忘了传来源时宁可低估。
- `now = time.time() if now is None else now` 不传 now 就用当前时间。不要写成 `now = now or time.time()`:那样传 `now=0` 时 0 是假值,会被换成当前时间。
- `cur = self._current(tenant, customer_id, key, now)` 和第二步的 `current` 一样,只是多了过期和删除的过滤,并且返回 `Fact` 对象,所以下面能用 `cur.value`、`cur.source` 而不是 `cur[1]`。
- `ttl = TTL[kind]` 按 kind 取有效期。如果 kind 不在 dict 里,这一行会抛 `KeyError`,下面「常见误区」里有真实报错,练习 1 会修它。
- `imp = DEFAULT_IMPORTANCE[kind] if importance is None else importance` 条件表达式,相当于 JS 的 `importance ?? DEFAULT_IMPORTANCE[kind]`。
- `None if ttl is None else now + ttl, imp)).lastrowid` 过期时间 = 写入时间 + 有效期;不过期就存 NULL(Python 的 None 存进 SQLite 就是 NULL)。
- `" AND superseded_by IS NULL AND deleted=0 AND (expires_at IS NULL OR expires_at>?)"` 「当前值」的三个条件:没被替代、没删除、没过期。过期的值不算当前值,所以过期以后写入一个新值是 ADD 而不是 UPDATE。
- `return Fact(*row) if row else None` `*row` 把元组拆开按位置传参,相当于 JS 的 `new Fact(...row)`。
- `" AND created_at<=?", (tenant, customer_id, now, now)).fetchall()` 第四步说的「未来的记忆」在这里挡掉。两个 `?` 都填 now。
- `def score(f: Fact) -> float:` 函数里面定义函数,它能直接用外面的 `now` 和 `half_life_days`,相当于 JS 的闭包。
- `return sorted(facts, key=score, reverse=True)[:k]` 按分数排序取前 k 条。这里没有「相关性」,相关性留给练习 2 用 embedding 加。
- `def forget_customer(self, tenant: str, customer_id: str) -> int:` 客户要求删除个人信息时调用。这是**软删除**,只打标记;真正的物理删除应该由定时任务在保留期后执行,连同备份一起。
- `.rowcount` 这次 UPDATE 影响了多少行,也就是删了几条。
- `def history(` 不管有没有被替代、有没有过期,按时间列出某个 key 的全部值,审计时用。

</div>

用一条时间线跑一遍。新建 `part10/memory_demo.py`:

```python
# agent-zero-lab/part10/memory_demo.py
from memory_store import DAY, MemoryStore

t0 = 1_790_000_000
m = MemoryStore()
T, C = "cloudledger", "C007"
print(m.write(T, C, "profile", "plan", "年付专业版", source="system", now=t0))
print(m.write(T, C, "preference", "contact", "只接受邮件,不要打电话", now=t0))
print(m.write(T, C, "situation", "open_issue", "9 月重复扣款 468 元,已提交退款", now=t0))
print(m.write(T, C, "profile", "plan", "月付基础版", source="extracted", now=t0 + DAY))
print(m.write(T, C, "profile", "plan", "月付基础版", source="system", now=t0 + 2 * DAY))
print(m.write(T, C, "preference", "card_number", "6222 **** 1234", now=t0 + 2 * DAY))
print(m.write("other-tenant", C, "profile", "plan", "企业版", source="system", now=t0))
print("plan 的变化:", m.history(T, C, "plan"))
print("第 3 天能想起:", [(f.key, f.value) for f in m.recall(T, C, now=t0 + 3 * DAY)])
print("第 40 天能想起:", [(f.key, f.value) for f in m.recall(T, C, now=t0 + 40 * DAY)])
print("删除:", m.forget_customer(T, C), "条;之后:", m.recall(T, C, now=t0 + 41 * DAY))
print("别的租户的 C007 还在:", [(f.key, f.value) for f in m.recall("other-tenant", C, now=t0 + 41 * DAY)])
```

<div class="line-notes">

- `from memory_store import DAY, MemoryStore` 直接运行 `part10/memory_demo.py` 时,Python 会把 `part10/` 放进模块搜索路径,所以能直接 `import memory_store`(Day 32)。
- `print(m.write(T, C, "profile", "plan", "月付基础版", source="extracted", now=t0 + DAY))` 第 1 天:客户在对话里说自己降级了,模型抽出来,来源 `extracted`,碰不到系统数据。
- `print(m.write(T, C, "profile", "plan", "月付基础版", source="system", now=t0 + 2 * DAY))` 第 2 天:业务系统同步过来,确认真的降级了。
- `print(m.write("other-tenant", C, "profile", "plan", "企业版"` 另一个租户也有一个 C007,用来验证删除只删自己租户的。
- `print("第 40 天能想起:"` 「当前问题」有效期 30 天,到第 40 天应该消失。
- `print("删除:", m.forget_customer(T, C), "条;之后:"` C007 名下有 4 行:年付、月付、联系方式、当前问题。被替代的那条年付也要删,所以是 4 条而不是 3 条。

</div>

```bash
uv run python part10/memory_demo.py
```

```text
ADD
ADD
ADD
REJECT
UPDATE
REJECT
ADD
plan 的变化: [('年付专业版', 'system'), ('月付基础版', 'system')]
第 3 天能想起: [('plan', '月付基础版'), ('contact', '只接受邮件,不要打电话'), ('open_issue', '9 月重复扣款 468 元,已提交退款')]
第 40 天能想起: [('plan', '月付基础版'), ('contact', '只接受邮件,不要打电话')]
删除: 4 条;之后: []
别的租户的 C007 还在: [('plan', '企业版')]
```

一行一行对一下。第 4 行 REJECT:对话里的说法没能覆盖系统数据,所以 `history` 里只有两条系统来源的记录,模型抽的那条根本没进库。第 3 天,plan 排第一,因为 profile 的默认重要性是 0.9,而且它是第 2 天才写的,最新。第 40 天,当前问题过期消失。删除删了 4 条,包括已经被替代的那条旧套餐,这一点很重要:客户行使删除权时,历史版本也是他的个人信息。最后一行证明删除没有越过租户边界。

再对照 Day 533 跑 mem0 的结果:同样是「我降级了」这句话,mem0 存进去了而且检索时旧值排第一;我们的版本对话里的说法被挡住,等系统确认后才更新,而且检索永远只返回当前值。差别不在谁更聪明,而在规则写在了哪里。

### 零件和大代码的对应

| 零件 | 在 `memory_store.py` 里的位置 |
| --- | --- |
| 第一步:建表、INSERT、`IS NULL` | `__init__` 的建表语句;`write` 的 INSERT;两个查询里的 `superseded_by IS NULL` |
| 第二步:当前值、NOOP、标记替代 | `_current`;`write` 里的 `cur.value == value` 和最后的 UPDATE |
| 第三步:来源优先级、敏感字段 | 常量 `SOURCE_RANK`、`FORBIDDEN_KEYS`;`write` 开头两个 if |
| 第四步:有效期、衰减 | 常量 `TTL`;`expires_at` 列;`recall` 里的 `score` 和 `created_at<=?` |
| 新加的 | `DEFAULT_IMPORTANCE`、`deleted` 列和 `forget_customer`、`history` |

## 把规则钉死:四个单元测试

上面的 demo 是用眼睛看的。规则要钉死,得写成测试,以后谁改了代码把规则改坏了,测试会红。先装 pytest(Day 71 装过的话跳过):

```bash
uv add --dev pytest
```

新建 `part10/test_memory_store.py`:

```python
# agent-zero-lab/part10/test_memory_store.py
from memory_store import DAY, MemoryStore

T, C, t0 = "cloudledger", "C007", 1_790_000_000


def test_extracted_cannot_override_system():
    m = MemoryStore()
    m.write(T, C, "profile", "plan", "年付专业版", source="system", now=t0)
    assert m.write(T, C, "profile", "plan", "免费版", now=t0 + 1) == "REJECT"


def test_situation_expires_after_30_days():
    m = MemoryStore()
    m.write(T, C, "situation", "open_issue", "重复扣款待退", now=t0)
    assert [f.key for f in m.recall(T, C, now=t0 + 29 * DAY)] == ["open_issue"]
    assert m.recall(T, C, now=t0 + 31 * DAY) == []


def test_forbidden_key_rejected():
    assert MemoryStore().write(T, C, "preference", "password", "x", now=t0) == "REJECT"


def test_forget_only_this_tenant():
    m = MemoryStore()
    m.write(T, C, "preference", "contact", "邮件", now=t0)
    m.write("other", C, "preference", "contact", "电话", now=t0)
    assert m.forget_customer(T, C) == 1
    assert [f.value for f in m.recall("other", C, now=t0 + 1)] == ["电话"]
```

<div class="line-notes">

- `from memory_store import DAY, MemoryStore` pytest 收集测试时会把测试文件所在的目录(`part10/`)加进搜索路径,所以这里能直接导入。如果报 `ModuleNotFoundError`,回去看 Day 72 的 pythonpath 配置。
- `def test_extracted_cannot_override_system():` 函数名以 `test_` 开头,pytest 才会认它是测试,相当于 jest 的 `test("...", () => {})`。
- `assert m.write(T, C, "profile", "plan", "免费版", now=t0 + 1) == "REJECT"` 不传 source,默认就是 `extracted`。
- `assert [f.key for f in m.recall(T, C, now=t0 + 29 * DAY)] == ["open_issue"]` 第 29 天还在。
- `assert m.recall(T, C, now=t0 + 31 * DAY) == []` 第 31 天没了。两条断言一起卡住了「30 天」这个边界。
- `assert m.forget_customer(T, C) == 1` 只删了自己租户的那 1 条。

</div>

```bash
uv run pytest -q part10/test_memory_store.py
```

```text
....                                                                     [100%]
4 passed in 0.03s
```

这四个测试对应的正是 Day 533 自测里那道面试题的几个要点:不能用错过期信息、业务数据优先、敏感信息不进库、删除权。面试时能说出「这几条我都有测试」,比说「我用了某某框架」有分量得多。

## 后台抽取:extract_facts

存储有了,还差把对话变成候选事实的那一步。这一步要调模型,用 JSON mode 让它按固定格式输出。提示词里把允许的 key 列死,这样抽出来的东西才能直接喂给 `write`。新建 `part10/extract.py`:

```python
# agent-zero-lab/part10/extract.py
import json
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
USAGE = {"in": 0, "out": 0}

PROMPT = """你在给客服系统抽取「下次还用得上」的客户事实。只能用这些 key:
contact(联系方式偏好,kind=preference)、language(沟通语言,kind=preference)、
open_issue(还没解决的问题,kind=situation)、plan(套餐,kind=profile)、
card_number / id_number / password(敏感信息,看到也照实抽出来,系统会拦)。
寒暄、情绪、一次性的话不要抽。
只输出 JSON:{"facts": [{"kind": "...", "key": "...", "value": "..."}]}

对话:
"""


def extract_facts(dialogue: str) -> list[dict]:
    resp = client.chat.completions.create(
        model=os.environ["LLM_MODEL"], temperature=0, extra_body=EXTRA,
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": PROMPT + dialogue}])
    if resp.usage:
        USAGE["in"] += resp.usage.prompt_tokens
        USAGE["out"] += resp.usage.completion_tokens
    return json.loads(resp.choices[0].message.content or "{}").get("facts", [])


if __name__ == "__main__":
    print(extract_facts("客户:你好,我是 C007。上个月被重复扣了 468 元还没退。以后别打电话,发邮件就行。"))
    print(USAGE)
```

<div class="line-notes">

- `USAGE = {"in": 0, "out": 0}` 一个全局的计数器,每调一次模型就把 token 数累加进来,评测跑完算钱用。
- `PROMPT = """你在给客服系统抽取` 这段提示词不用 `.format()`,所以里面的花括号不用转义,直接用 `+` 拼对话。
- `card_number / id_number / password(敏感信息,看到也照实抽出来,系统会拦)。` 这一行是故意的。我**要**模型把敏感信息抽出来,原因有两个:一是评测时能统计「模型抽到了几次、写入层拦住了几次」;二是如果不让它抽,它可能把卡号塞进 `open_issue` 的值里,反而更难拦。
- `寒暄、情绪、一次性的话不要抽。` 这就是 Day 532 「写什么」的第一条规则:下次用不上的不记。
- `response_format={"type": "json_object"},` JSON mode。DeepSeek 要求提示词里出现「JSON」这个词,这里有。
- `messages=[{"role": "user", "content": PROMPT + dialogue}])` 提示词加对话原文。
- `return json.loads(resp.choices[0].message.content or "{}").get("facts", [])` 解析 JSON 再取 `facts`,取不到就返回空列表。这里没做 pydantic 校验,字段缺失时后面的 `f["kind"]` 会报 `KeyError`,生产代码应该按 Day 150 的写法校验加重试。
- `if __name__ == "__main__":` 直接运行时测一条,被别的文件导入时不跑。

</div>

```bash
uv run python part10/extract.py
```

```text
[{'kind': 'situation', 'key': 'open_issue', 'value': '上个月被重复扣了 468 元还没退'}, {'kind': 'preference', 'key': 'contact', 'value': '以后别打电话，发邮件就行'}]
{'in': 175, 'out': 63}
```

两条都抽对了,寒暄「你好,我是 C007」没有被当成事实。注意值是从原文里摘的,带着全角逗号,这没关系,值是给下一次对话里的模型看的。

## 评测写入质量

### 先想清楚测什么

记忆系统的评测可以分三层:**写入质量**(该记的记了没有、不该记的有没有混进来)、**检索质量**(新工单来了,该想起的想起了没有,方法和第四部分的检索评测一样)、**端到端**(同一批「上周来过、这周又来」的场景,有记忆和没记忆各跑一次,比任务成功率和「用了过期信息」的次数)。今天做第一层,因为它最便宜,也最先出问题。

写入质量用两个数衡量,都是第六部分评测里学过的:

- **准确率 precision**:写进去的里面,有多少是该写的。写进去 10 条,其中 9 条该写,准确率 0.9。它低说明记了垃圾。
- **召回率 recall**:该写的里面,有多少真写进去了。应该写 10 条,只写进去 8 条,召回率 0.8。它低说明漏了。

另外单独统计一个**敏感信息拦截率**:对话里出现的敏感信息,有多少被写入层拒绝了。这个数必须是 100%,不是 99%。

### 造一批标注数据

我写了 9 段对话,覆盖几种情况:正常该记的(d01、d06)、只有寒暄和一次性请求的(d02、d04、d08)、带卡号/身份证/密码的(d03、d05、d07、d09)。每段标注了「应该写进去哪些 key」和「里面有哪些敏感信息」。新建 `part10/memory_eval_cases.json`:

```json
[
  {"id": "d01", "dialogue": "客户:我是 C007,上个月被重复扣了 468 元,到现在还没退。以后别打电话,发邮件就行。", "expect": ["open_issue", "contact"], "sensitive": []},
  {"id": "d02", "dialogue": "客户:今天天气真好。帮我看下发票 INV-2291 能不能开成电子版?\n客服:已经帮您重新开了电子版。\n客户:好的谢谢。", "expect": [], "sensitive": []},
  {"id": "d03", "dialogue": "客户:I prefer English, my Chinese is not good. 我的卡号是 6222 0202 1234 5678,扣款失败了帮我查一下。", "expect": ["language", "open_issue"], "sensitive": ["card_number"]},
  {"id": "d04", "dialogue": "客户:我气死了!你们这个系统太烂了!\n客服:非常抱歉,请问遇到了什么问题?\n客户:算了,刚才刷新一下又好了。", "expect": [], "sensitive": []},
  {"id": "d05", "dialogue": "客户:我身份证号 110101199003071234,实名认证一直不过,麻烦尽快处理,周五前要用。", "expect": ["open_issue"], "sensitive": ["id_number"]},
  {"id": "d06", "dialogue": "客户:我们公司上周已经从年付专业版降成月付基础版了。另外工作时间只看企业微信,别发短信。", "expect": ["plan", "contact"], "sensitive": []},
  {"id": "d07", "dialogue": "客户:我账号密码是 Cl0ud!2026,你们直接登进去帮我把导出报表的问题看一下吧。", "expect": ["open_issue"], "sensitive": ["password"]},
  {"id": "d08", "dialogue": "客户:上次说的重复扣款,退款已经到账了,谢谢!\n客服:不客气,还有其他问题吗?\n客户:没有了。", "expect": [], "sensitive": []},
  {"id": "d09", "dialogue": "客户:我用 6222020212345678 这张卡付的款,被扣了两次 468,一直没退,你们查下这张卡的流水。", "expect": ["open_issue"], "sensitive": ["card_number"]}
]
```

卡号和身份证号都是我编的,不对应任何真人。d08 值得说一句:「退款已经到账了」说明问题解决了,不该再记一条 open_issue。d09 是我专门加的:卡号就在描述问题的那句话里,我想看模型会不会把它塞进 open_issue 的值里绕过 key 的拦截。

### 评测脚本

新建 `part10/memory_eval.py`:

```python
# agent-zero-lab/part10/memory_eval.py
import json
import re
import sys
from pathlib import Path

from extract import USAGE, extract_facts
from memory_store import MemoryStore

SENSITIVE_KEYS = {"card_number", "id_number", "password"}
LONG_DIGITS = re.compile(r"\d{12,}|\d{4}[ -]\d{4}[ -]\d{4}")

path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name("memory_eval_cases.json")
cases = json.loads(path.read_text(encoding="utf-8"))
tp = fp = fn = 0
sens_total = sens_blocked = 0
leaks = []
for case in cases:
    store = MemoryStore()
    facts = extract_facts(case["dialogue"])
    written = set()
    for f in facts:
        op = store.write("cloudledger", case["id"], f["kind"], f["key"], f["value"], now=1_790_000_000)
        if f["key"] in SENSITIVE_KEYS:
            sens_total += 1
            sens_blocked += op == "REJECT"
        elif op in ("ADD", "UPDATE"):
            written.add(f["key"])
    for f in store.recall("cloudledger", case["id"], k=20, now=1_790_000_001):
        if LONG_DIGITS.search(f.value) or "Cl0ud" in f.value:
            leaks.append((case["id"], f.key, f.value))
    expect = set(case["expect"])
    tp += len(written & expect)
    fp += len(written - expect)
    fn += len(expect - written)
    print(case["id"], "抽到", sorted(written), "应有", sorted(expect))

print(f"准确率 precision = {tp}/{tp + fp} = {tp / (tp + fp):.2f}")
print(f"召回率 recall = {tp}/{tp + fn} = {tp / (tp + fn):.2f}")
print(f"敏感 key 被拦 {sens_blocked}/{sens_total}")
print("混在别的值里漏进库的:", leaks)
print("token:", USAGE)
```

<div class="line-notes">

- `import re` 正则表达式模块,相当于 JS 的 `RegExp`。
- `from extract import USAGE, extract_facts` 导入的 `USAGE` 和 extract.py 里的是同一个 dict 对象,那边累加,这边读到的就是累加后的值。
- `LONG_DIGITS = re.compile(r"\d{12,}|\d{4}[ -]\d{4}[ -]\d{4}")` 匹配 12 位以上的连续数字,或者「四位 空格 四位 空格 四位」这种带分隔的卡号。`r"..."` 是原始字符串,反斜杠不转义,写正则时都这么写。这是第二道检查:key 没问题,但值里夹着卡号或身份证号。
- `path = Path(sys.argv[1]) if len(sys.argv) > 1 else` 命令行传了文件就用传的,没传就用同目录的 `memory_eval_cases.json`。`sys.argv` 相当于 Node 的 `process.argv`,但 `sys.argv[0]` 就是脚本名,没有 node 本身那一项。
- `tp = fp = fn = 0` 链式赋值,三个计数器都从 0 开始。tp 是该写也写了,fp 是不该写却写了,fn 是该写却没写。
- `store = MemoryStore()` 每段对话用一个全新的内存库,互不影响。
- `op = store.write("cloudledger", case["id"], f["kind"], f["key"], f["value"], now=1_790_000_000)` 用对话 id 当客户 id,来源默认 `extracted`。
- `sens_blocked += op == "REJECT"` `op == "REJECT"` 是布尔值,在 Python 里 True 加到整数上就是 1。有点取巧,但很常见。
- `elif op in ("ADD", "UPDATE"):` 真正写进库的才算「写了」,NOOP 和 REJECT 都不算。
- `for f in store.recall("cloudledger", case["id"], k=20, now=1_790_000_001):` 把库里留下的所有记忆再扫一遍,看值里有没有夹带敏感信息。`"Cl0ud" in f.value` 是专门查 d07 那个密码。
- `tp += len(written & expect)` `&` 是集合的交集,`-` 是差集(Day 25)。
- `print(f"准确率 precision = {tp}/{tp + fp} = {tp / (tp + fp):.2f}")` 如果一条都没写,`tp + fp` 是 0,这里会除以 0。正式的评测工具要处理这种情况,这里数据保证有写入。

</div>

```bash
uv run python part10/memory_eval.py
```

```text
d01 抽到 ['contact', 'open_issue'] 应有 ['contact', 'open_issue']
d02 抽到 [] 应有 []
d03 抽到 ['language', 'open_issue'] 应有 ['language', 'open_issue']
d04 抽到 [] 应有 []
d05 抽到 ['open_issue'] 应有 ['open_issue']
d06 抽到 ['contact', 'plan'] 应有 ['contact', 'plan']
d07 抽到 ['open_issue'] 应有 ['open_issue']
d08 抽到 [] 应有 []
d09 抽到 ['open_issue'] 应有 ['open_issue']
准确率 precision = 9/9 = 1.00
召回率 recall = 9/9 = 1.00
敏感 key 被拦 4/4
混在别的值里漏进库的: []
token: {'in': 1590, 'out': 395}
```

成本:1590 × 2 ÷ 1,000,000 + 395 × 8 ÷ 1,000,000 ≈ ¥0.0063(DeepSeek `deepseek-flash` 高峰价,2026-10 查)。9 段对话不到一分钱。对比一下 Day 533 的 mem0:一次两句话的 add 就用了八千个输入 token,我们的抽取提示词短得多,一段对话一百多个输入 token。

### 全对,能说明什么

全部 1.00,看起来很好,但我想把话说清楚:**9 条全对说明不了多少**。第一,样本太少。第六部分之后的 [Day 547](/blog/agent-zero/day-547-eval-stats-1/) 会讲怎么给通过率算置信区间,按那种算法,9 条全对的 95% 区间下限只有七成左右,也就是说真实准确率在 0.7 到 1.0 之间都说得通。第二,这 9 段是我自己写的,我知道系统想要什么,写出来的对话天然偏「好抽」。真实的客服对话更长、更乱、一句话里混着好几件事。

所以这个评测的价值不在今天的分数,而在**它已经是一条可以反复跑的流水线**:以后改提示词、换模型、加 key,跑一遍就知道有没有变差。下一步该做的是从真实工单里抽 50 到 100 段,让人标注,再跑。

还有两个细节是看输出才发现的。我单独打印了 d03、d05、d07 的抽取结果:

```text
d03 [{'kind': 'preference', 'key': 'language', 'value': 'English'}, {'kind': 'sensitive', 'key': 'card_number', 'value': '6222 0202 1234 5678'}, {'kind': 'situation', 'key': 'open_issue', 'value': '扣款失败，需要查询原因'}]
d05 [{'kind': 'situation', 'key': 'open_issue', 'value': '实名认证一直不过，周五前要用'}, {'kind': 'profile', 'key': 'id_number', 'value': '110101199003071234'}]
d07 [{'kind': 'sensitive', 'key': 'password', 'value': 'Cl0ud!2026'}, {'kind': 'situation', 'key': 'open_issue', 'value': '导出报表的问题'}]
```

一是模型确实老老实实把卡号、身份证号、密码原样抽了出来,全靠 `FORBIDDEN_KEYS` 那一行挡住。二是模型**自己发明了一个 kind 叫 `sensitive`**,提示词里根本没有这个类型。这次没出事,纯属运气:敏感 key 的检查排在 `TTL[kind]` 前面,先被 REJECT 了。如果模型给一个普通的 key 也编了一个新 kind,`write` 会直接崩溃:

```text
    ttl = TTL[kind]
          ~~~^^^^^^
KeyError: 'sensitive'
```

这是我用 `MemoryStore().write('cloudledger','C007','sensitive','nickname','老王')` 故意制造的。后台抽取流程里一个 KeyError 会让整张工单的记忆都写不进去,练习 1 会修它。这也是为什么评测不能只看最后的分数,要把中间结果打出来看。

## 动手练习

**练习 1:给写入层加两道防线。** 写一个 `CheckedStore` 继承 `MemoryStore`,在调用父类的 `write` 之前做两件事:kind 不认识就返回 REJECT(而不是崩溃);值里夹着卡号或身份证号这种长数字串也返回 REJECT。用四条数据验证:编造的 kind、值里带卡号、值里带身份证号、一条正常的发票问题。

<details><summary>参考答案</summary>

新建 `part10/ex534_store_checks.py`:

```python
# agent-zero-lab/part10/ex534_store_checks.py
import re

from memory_store import TTL, MemoryStore

CARD_OR_ID = re.compile(r"\d{15,19}|\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}")


class CheckedStore(MemoryStore):
    def write(self, tenant: str, customer_id: str, kind: str, key: str, value: str,
              source: str = "extracted", importance: float | None = None,
              now: float | None = None) -> str:
        if kind not in TTL:
            return "REJECT"  # 模型编了一个没见过的 kind,不让它把程序搞崩
        if CARD_OR_ID.search(value):
            return "REJECT"  # 第二道闸:key 正常,但值里夹着卡号或身份证号
        return super().write(tenant, customer_id, kind, key, value, source, importance, now)


if __name__ == "__main__":
    s = CheckedStore()
    print(s.write("cloudledger", "C007", "sensitive", "nickname", "老王", now=1_790_000_000))
    print(s.write("cloudledger", "C007", "situation", "open_issue",
                  "卡 6222020212345678 被扣两次", now=1_790_000_000))
    print(s.write("cloudledger", "C007", "situation", "open_issue",
                  "身份证 110101199003071234 实名不过", now=1_790_000_000))
    print(s.write("cloudledger", "C007", "situation", "open_issue",
                  "发票 INV-2291 被扣两次 468 元", now=1_790_000_000))
```

<div class="line-notes">

- `CARD_OR_ID = re.compile(r"\d{15,19}|\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}")` 银行卡号一般 16 到 19 位,身份证 18 位,所以连续 15 到 19 位数字都拦;另一半匹配「6222 0202 1234 5678」这种分成四组的写法。比评测脚本里的 `LONG_DIGITS` 更严。
- `class CheckedStore(MemoryStore):` 继承,相当于 JS 的 `class CheckedStore extends MemoryStore`。
- `def write(self, tenant: str, customer_id: str, kind: str, key: str, value: str,` 覆盖父类的方法,参数签名要和父类一致,否则类型检查器会报错。
- `if kind not in TTL:` 用 TTL 的 key 当「合法 kind 列表」,不用另外维护一份。
- `return super().write(tenant, customer_id, kind, key, value, source, importance, now)` 两道检查都过了,再交给父类走原来的逻辑。`super()` 和 JS 的 `super.write(...)` 一样。
- `"发票 INV-2291 被扣两次 468 元"` 正常数据,里面的数字都很短,不该被拦。

</div>

```text
REJECT
REJECT
REJECT
ADD
```

前三条拦住了,第四条正常写入。值扫描是一道兜底的防线,它会有误伤(比如 16 位的订单号也会被拦),上线前要拿真实数据看误伤率,宁可多拦,误伤的那些记忆最多是下次要客户再说一遍。

</details>

**练习 2:按相关性检索。** 现在 `recall` 只按重要性和新近度排,客户问退款时,「沟通语言是中文」这种不相关的记忆也会被塞进上下文。写一个 `recall_query(store, tenant, customer_id, query)`:先用 `recall` 拿到所有还活着的记忆,再用 bge-m3 算每条和问题的余弦相似度,低于阈值的扔掉,剩下的按相似度排。

<details><summary>参考答案</summary>

新建 `part10/ex534_recall_query.py`,embedding 的写法同 [Day 217](/blog/agent-zero/day-217-embed-service/):

```python
# agent-zero-lab/part10/ex534_recall_query.py
import math
import os

from dotenv import load_dotenv
from openai import OpenAI

from memory_store import DAY, Fact, MemoryStore

load_dotenv()
emb = OpenAI(base_url=os.environ["EMB_BASE_URL"], api_key=os.environ["EMB_API_KEY"])


def embed(texts: list[str]) -> list[list[float]]:
    return [d.embedding for d in emb.embeddings.create(model=os.environ["EMB_MODEL"], input=texts).data]


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    return dot / (math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b)))


def recall_query(store: MemoryStore, tenant: str, customer_id: str, query: str,
                 k: int = 3, min_sim: float = 0.55, now: float | None = None) -> list[tuple[Fact, float]]:
    facts = store.recall(tenant, customer_id, k=50, now=now)  # 先按规则拿到所有还活着的
    if not facts:
        return []
    vecs = embed([query] + [f"{f.key}: {f.value}" for f in facts])
    sims = [cosine(vecs[0], v) for v in vecs[1:]]
    kept = [(f, s) for f, s in zip(facts, sims) if s >= min_sim]  # 不相关的先扔掉
    return sorted(kept, key=lambda x: x[1], reverse=True)[:k]


t0 = 1_790_000_000
m = MemoryStore()
m.write("cloudledger", "C007", "profile", "plan", "月付基础版", source="system", now=t0)
m.write("cloudledger", "C007", "preference", "contact", "只接受邮件,不要打电话", now=t0)
m.write("cloudledger", "C007", "situation", "open_issue", "9 月重复扣款 468 元,已提交退款", now=t0)
m.write("cloudledger", "C007", "preference", "language", "中文", now=t0)
for q in ["退款到账了吗", "怎么通知这个客户"]:
    print(q, "->", [(f.key, round(s, 3)) for f, s in recall_query(m, "cloudledger", "C007", q, now=t0 + DAY)])
```

<div class="line-notes">

- `def cosine(a: list[float], b: list[float]) -> float:` 余弦相似度,第四部分 Day 213 学过。这里用纯 Python 写,四条记忆不需要 numpy。
- `dot = sum(x * y for x, y in zip(a, b))` `zip` 把两个列表按位置配对,相当于 JS 里 `a.map((x, i) => [x, b[i]])`。
- `facts = store.recall(tenant, customer_id, k=50, now=now)  # 先按规则拿到所有还活着的` 关键顺序:先用规则过滤掉过期、被替代、被删除的,再算相关性。反过来做,过期的记忆可能因为相关性高而被捞回来。
- `vecs = embed([query] + [f"{f.key}: {f.value}" for f in facts])` 问题和所有记忆一次发过去,只调一次接口。把 key 也拼进文字里,「contact: 只接受邮件」比单独的「只接受邮件」语义更完整。
- `sims = [cosine(vecs[0], v) for v in vecs[1:]]` 第 0 个是问题,后面每个是一条记忆。
- `kept = [(f, s) for f, s in zip(facts, sims) if s >= min_sim]  # 不相关的先扔掉` 阈值 0.55。我先试了 0.45,两个问题都几乎什么都没扔掉。
- `return sorted(kept, key=lambda x: x[1], reverse=True)[:k]` 按相似度排。也可以把相似度和 `recall` 里的分数相乘,做成综合打分。

</div>

```text
退款到账了吗 -> [('open_issue', 0.721)]
怎么通知这个客户 -> [('contact', 0.626), ('open_issue', 0.559)]
```

第一个问题只留下了 open_issue,套餐、联系方式、语言都被扔掉了。第二个问题的 open_issue 以 0.559 擦线留下,说明阈值离这批数据的边界很近。阈值不能拍脑袋,要用一批「问题 → 应该想起哪些记忆」的标注去调,和第四部分调检索阈值是同一回事。

</details>

**练习 3:再加三条难一点的评测用例。** 写一个新文件 `part10/ex534_cases.json`,至少包含:客户改了联系方式偏好、客户只报了姓名职位然后问了一个一次性问题、旧问题解决了但又提了新问题。用 `memory_eval.py` 跑一遍,报告数字。

<details><summary>参考答案</summary>

新建 `part10/ex534_cases.json`:

```json
[
  {"id": "e01", "dialogue": "客户:以后别发邮件了,我邮箱经常收不到,有事直接打电话。", "expect": ["contact"], "sensitive": []},
  {"id": "e02", "dialogue": "客户:你好,我叫王磊,在公司管财务。想问下怎么导出上季度的账单?\n客服:在「账单」页右上角点导出即可。\n客户:找到了,谢谢。", "expect": [], "sensitive": []},
  {"id": "e03", "dialogue": "客户:之前那笔重复扣款的退款已经到了。不过这个月的发票抬头又开错了,应该是「杭州云簿科技」,麻烦改一下。", "expect": ["open_issue"], "sensitive": []}
]
```

e02 的标注是「什么都不记」,因为姓名和职位不在允许的 key 里,导出账单是一次性问题。e03 要求模型分清「已解决的旧问题」和「新问题」,只记新的。

```bash
uv run python part10/memory_eval.py part10/ex534_cases.json
```

```text
e01 抽到 ['contact'] 应有 ['contact']
e02 抽到 [] 应有 []
e03 抽到 ['open_issue'] 应有 ['open_issue']
准确率 precision = 2/2 = 1.00
召回率 recall = 2/2 = 1.00
敏感 key 被拦 0/0
混在别的值里漏进库的: []
token: {'in': 528, 'out': 82}
```

又是全对。`deepseek-flash` 在这种短对话上已经很稳,想找到它的失败点,要用更长、更乱的真实对话,或者一句话里塞三四件事。还有一点:e01 如果放进一个已经有「只接受邮件」(来源 extracted)的库里,新值来源也是 extracted,同级可以覆盖,结果是 UPDATE,符合预期;但如果原来那条是客服确认过的(agent_confirmed),客户这次的改口会被拒绝,要等客服再确认一次。这是规则的取舍,不是 bug,值得写进设计文档。

</details>

**练习 4(开放题):设计端到端评测。** 写一份半页的评测方案:怎么证明加了记忆以后 SupportPilot 变好了而不是变坏了?至少给出场景怎么造、比较哪几个指标、最危险的失败怎么统计。

<details><summary>参考答案</summary>

示范方案:

场景:造 30 组「两次来访」的场景,每组第一次是一张完整的工单对话(用来写记忆),第二次是一周或四十天后的新问题。其中 10 组第二次的问题依赖第一次的信息(「退款到了吗」);10 组在两次之间业务系统发生了变化(套餐改了、问题已经解决);10 组第二次的问题和第一次无关。

对照:同一批场景跑两遍,一遍关掉记忆,一遍打开记忆,其他配置完全一样。

指标:任务成功率(用第六部分的评审方法打分);客户需要重复说明的次数(第二次对话里客服问了几个本可以从记忆里得到的问题);**用错记忆的次数**,即回答里引用了已经过期或已经被系统数据推翻的信息,这是最危险的失败,要单独统计、单独报警,目标是 0。

判定:打开记忆后成功率不降、重复说明次数下降、用错记忆为 0,才算通过。「两次之间业务系统发生变化」那 10 组专门用来抓用错记忆。

我用今天的代码验证了其中最关键的一条:`memory_demo.py` 里第 40 天 `open_issue` 不再出现,`test_situation_expires_after_30_days` 把它钉成了测试。端到端评测是在这些单元规则之上,再确认 Agent 拿到记忆以后没有用歪。

</details>

**验收标准**:`memory_demo.py` 和 `test_memory_store.py` 的输出和文中一致;`memory_eval.py` 能对任意用例文件跑出准确率、召回率和敏感拦截率,敏感拦截率是 100%;练习 1 的 `CheckedStore` 遇到编造的 kind 不再崩溃;练习 4 的方案里有「用错记忆」这个指标。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 来源优先级 | 给每条记忆的来源打分(业务系统 > 客服确认 > 模型抽取),低分的不能覆盖高分的 |
| superseded_by | 「被谁替代了」:旧事实不删,记下替代它的新事实的 id,保留完整历史 |
| REJECT | 写入被拒绝:敏感字段,或来源不够格覆盖当前值 |
| 有效期 TTL | Time To Live,一条记忆从写入起多久后失效,不同类型设不同的值 |
| 半衰期 | 衰减打分用的参数:过了这么久,新近度降到一半 |
| 衰减 | 检索打分时越旧的记忆分越低,用来控制排序,不等于删除 |
| 软删除 | 先打删除标记、之后由定时任务物理清除的删除方式 |
| `IS NULL` | SQL 里判断「是不是空」的唯一正确写法,`= NULL` 永远选不中任何行 |
| 写入评测 | 用标注好的对话检查记忆系统该记的记了没有、不该记的有没有混进来 |
| 准确率 precision | 写进去的记忆里,该写的占多少 |
| 召回率 recall | 该写的记忆里,真写进去的占多少 |
| 敏感信息拦截率 | 对话里出现的敏感信息中,被写入层拒绝的比例,必须是 100% |

## 常见误区

**用 `= NULL` 查「当前有效」的记忆。** 不报错,直接返回空列表,Agent 什么都想不起来。第一步演示过,判断空值只能用 `IS NULL`。

**新值总是覆盖旧值。** 第二步演示了后果:客户随口一句「免费版」就把系统里的年付专业版替代掉了。写入要看来源,对话里抽出来的东西不能碰业务系统的数据。

**在提示词里写「不要记录卡号」就当拦住了。** 实测模型会把卡号、身份证号、密码原样抽出来(我的提示词甚至鼓励它这么做)。拦截必须是写入层的 if,最好再加一道值扫描。

**相信模型只会输出你列出来的 kind。** 模型自己编了一个 `sensitive`,如果落在普通 key 上,`TTL[kind]` 直接 `KeyError: 'sensitive'`,整张工单的记忆写入失败。凡是模型给的枚举值,进代码之前都要校验。

**只做有效期不做衰减,或者只做衰减不做有效期。** 有效期管「还是不是真的」,衰减管「还排不排得上号」。只有衰减时,三个月前的「正在退款」只是分数低了,依然可能被想起来;只有有效期时,偏好类记忆永远一样重要。

**删除时只删当前值。** 被替代的旧版本也是客户的个人信息。`forget_customer` 按客户维度全部打标记,demo 里删了 4 条而不是 3 条就是这个原因。

**拿 9 条全对的评测当结论。** 样本少、又是自己写的,分数只能说明流水线通了。要拿真实工单标注后再跑,并且把中间结果打印出来看,我就是这样发现那个编造的 kind 的。

## 学习资料

### 文档与文章

- [Python sqlite3 官方文档(中文)](https://docs.python.org/zh-cn/3/library/sqlite3.html):`lastrowid`、`rowcount`、`?` 占位符和事务行为都在这里。查到哪看到哪。
- [Generative Agents 论文](https://arxiv.org/abs/2304.03442):第 4 节记忆检索的三项打分(新近度、重要性、相关性),今天的 `score` 和练习 2 就是这个思路。30 分钟。
- [LangGraph 文档:Memory](https://docs.langchain.com/oss/python/langgraph/memory):热路径写入和后台写入的取舍,和今天选择后台抽取互相印证。
- [LongMemEval 论文](https://arxiv.org/abs/2410.10813):一个专门评测长期记忆的基准,看它把记忆能力拆成哪几类问题(信息抽取、跨会话推理、时间推理、知识更新、拒答),设计自己的评测集时很有参考价值。
- [LOCOMO 基准主页](https://snap-research.github.io/locomo/):mem0、Zep 论文里常用的长对话记忆基准,看它的数据长什么样。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1DabS6vEba&autoplay=0&high_quality=1" title="一口气搞懂AI Agent五种记忆架构/SQLite/mem0/Zep/LangMem实测竞速" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>肖恩君Sean · 一口气搞懂AI Agent五种记忆架构/SQLite/mem0/Zep/LangMem实测竞速 · 30 分钟,2026 年 8 月发布,播放量 2.2 万。里面也有一个 SQLite 方案和几个框架放在一起实测,可以对照今天「自己写」的取舍。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/BacJ6sEhqMo" title="The Four Types of Memory Every AI Agent Needs" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>IBM Technology · The Four Types of Memory Every AI Agent Needs · 白板短视频,英文。用来复习 Day 532 的四类记忆,再想想今天的 kind 分别对应哪一类。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 3、4 章讲评测方法和评测流水线:为什么要先有可以反复跑的评测,再谈优化。
- Martin Kleppmann《Designing Data-Intensive Applications》(O'Reilly,2017;中文版《数据密集型应用系统设计》,中国电力出版社)第 3 章讲存储引擎里的追加写和标记删除,和今天「旧值不删、打标记」是同一类做法。

### 开源项目与代码

- [getzep/graphiti](https://github.com/getzep/graphiti):对照看它怎么给边设置 `invalid_at`,和我们的 `superseded_by` 比一比各自的优缺点。
- [xiaowu0162/LongMemEval](https://github.com/xiaowu0162/LongMemEval):LongMemEval 的数据和评测脚本,看它怎么组织「问题 → 标准答案」,可以借鉴到练习 4。

## 自测

1. `write` 的四种返回值分别在什么情况下出现?

<details><summary>答案</summary>

REJECT:key 是敏感字段,或者新值的来源优先级低于当前值的来源。NOOP:当前值和新值完全一样。UPDATE:有当前值、值不同、来源够格,插入新行并把旧行标记为被替代。ADD:这个 key 原来没有当前值(包括原来的已过期或已删除),直接插入。

</details>

2. 为什么 `forget_customer` 删了 4 条而当前只有 3 条有效记忆?

<details><summary>答案</summary>

被替代的旧套餐「年付专业版」那一行也属于这个客户,按客户维度删除时连历史版本一起打了删除标记。客户行使删除权时,历史版本同样是他的个人信息,必须一起删。

</details>

3. 有效期和衰减的分工是什么?各举一个例子。

<details><summary>答案</summary>

有效期决定「这条信息还是不是真的」,过了就不再返回,例如「正在等退款」30 天后过期。衰减决定「排序时还排不排得上」,只降分不删除,例如「只接受邮件」40 天后分数从 0.746 降到 0.317,但依然会被想起。

</details>

4. 评测脚本里准确率和召回率分别低了意味着什么?敏感信息拦截率为什么要单独统计?

<details><summary>答案</summary>

准确率低:写进去的东西里有不该记的,记忆被垃圾污染。召回率低:该记的漏了,下次客户要重复说。敏感信息拦截率单独统计,是因为它不能和其他指标平均:哪怕准确率和召回率都很高,漏一次敏感信息就是合规事故,目标必须是 100%。

</details>

5. 面试题:「你的记忆系统评测结果是 precision 1.00、recall 1.00,是不是就可以上线了?」

<details><summary>答案</summary>

不能。要点:样本只有 9 条,按置信区间算真实准确率可能低到七成左右;用例是自己写的,偏简单,要用真实工单标注后再测;写入质量只是三层评测的第一层,还要测检索质量和端到端(有记忆和无记忆对比,单独统计「用错过期记忆」的次数);还要看中间结果,比如模型编造枚举值这类问题分数上看不出来。能说出下一步要补什么数据、测什么指标,比报一个高分有说服力。

</details>

6. 为什么 `now = time.time() if now is None else now` 不能写成 `now = now or time.time()`?

<details><summary>答案</summary>

`or` 在左边是假值时取右边。如果调用方传 `now=0`(比如测试里用 0 当起点),0 是假值,会被换成当前时间,测试结果就错了。`is None` 只在真的没传时才用当前时间。

</details>

## 明天预告

Day 535 · 持久化执行(一):记日志,然后重放。记忆解决的是「跨会话记住」,明天换一个问题:一次任务跑到一半进程被杀掉了怎么办。我们从前端熟悉的 Redux reducer 出发理解事件溯源,再把同样的想法用到 Agent 的每一步上,写一个真的经得起 `kill -9` 的运行器。
