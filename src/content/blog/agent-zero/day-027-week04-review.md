---
title: 'Day 27 · 第 4 周复习:编程地基(Day 21–26)'
description: '这一周学了列表、元组、推导式、字典、集合和嵌套数据六种装数据的办法。今天不学新东西:画一张「什么时候用哪种容器」的知识地图,默写三段核心代码(清洗拆字典加计数、集合对比两批数据、摸清嵌套 JSON),只用本周知识做一个工单看板,最后把这周撞过的报错整理成表。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'review', 'agent-zero']
series: 'agent-zero'
day: 27
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 26](/blog/agent-zero/day-026-nested-data/) 学了嵌套数据:接口返回的 JSON 是列表里套字典、字典里套列表,`data["tickets"][0]["customer"]["name"]` 一层一层往里取;取不到时有四种报错(`KeyError`、把列表当字典的 `TypeError`、中间有一层是 `None` 的 `TypeError`、空列表的 `IndexError`);用 `for key, value in d.items()` 加 `type(value).__name__` 摸清陌生数据的结构;字典推导式 `{t["id"]: t for t in tickets}` 一行造出查找表;`.copy()` 只复制最外一层。

这一周六天其实在回答同一个问题:**一堆数据来了,放进什么容器里,后面才好用。** Day 21 的列表装「一排」,Day 22 的元组装「一对,不许改」,Day 23 的推导式是「一行造出一个新列表」,Day 24 的字典装「按名字查」,Day 25 的集合装「不重复、只问在不在」,Day 26 把它们套在一起。今天停一天,把这六样放在一张图上,确认你面对一份新数据时知道该伸手拿哪个。

## 今天要解决的问题

学完今天,你应该能:

1. 看到一个需求(去重、按工单号查、一对一对排序、两批数据对比、按客户汇总),不翻文章就说出该用列表、元组、字典、集合里的哪一种,以及为什么。
2. 合上文章默写三段:清洗拆字典加计数加排名 `wk4_tally.py`(Day 22–24)、集合对比两批工单 `wk4_diff.py`(Day 22、25)、摸清嵌套 JSON 的结构并安全取值 `wk4_peek.py`(Day 25、26)。
3. 只用本周学过的东西做一个小项目 `part01/ticket_board.py`:读一份嵌套 JSON,出一页「工单看板」,按负责人归拢、按套餐分客户、金额排名、标签计数、找出等回复的客户、和昨天对比新增和消失。
4. 看到本周出现过的每一句报错,不翻文章就能说出病因和改法。

预计用时:3 小时。默写三段各 20 分钟,小项目 50 分钟,剩下做练习、自测、整理错题。

前置:[Day 21](/blog/agent-zero/day-021-lists/) 到 [Day 26](/blog/agent-zero/day-026-nested-data/) 全部。今天不调任何 API,花费 0 元。

学法提示:先对照文章逐条敲一遍(代码自己敲,不复制粘贴)并对照输出;明天合上文章,把小项目 `ticket_board.py` 从空文件开始默写(JSON 数据可以只写两张工单代替,重点写后面八块处理逻辑);做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 先说清楚我是在哪跑的

输出是我 2026-10-23 在 2019 款 Intel MacBook Pro(macOS 14、zsh)上用演示家目录真跑的,家目录显示成 `/Users/你`,`~/agent-zero-lab` 接着 Day 26 的状态,`uv run python` 是 3.12.13,Ruff 是 0.17.2,basedpyright 是 standard 档。脚本都放在 `part01/`,在仓库根目录用 `uv run python part01/文件名.py` 运行,不读键盘输入。

有一处要先提醒:Python 的报错文字在不同小版本之间偶尔会变。比如把列表当字典的键,3.12 报 `TypeError: unhashable type: 'list'`,更新的 3.14 会多一句 `cannot use 'list' as a dict key (unhashable type: 'list')`。Day 24、25 里贴过后一种写法。意思完全一样,你机器上看到哪种都不用慌,下面的错题表我写 3.12 的原文,必要时标出新版本的说法。

## 本周知识地图

先看全局。五种东西各有一个括号,各有一个「最擅长」:

<figure>
<svg viewBox="0 0 640 360" role="img" aria-label="第 4 周知识地图:列表方括号按位置,元组圆括号一对不许改,字典花括号加冒号按名字查,集合花括号去重只问在不在,嵌套是容器里套容器;下面一排是选容器的口诀;最下面是推导式一行造出新容器">
<rect x="0" y="0" width="640" height="360" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="8" y="12" width="118" height="132" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="16" y="34" fill="var(--ink)">列表 [ ]</text>
<text x="16" y="54" fill="var(--ink-soft)">Day 21</text>
<text x="16" y="76" fill="var(--ink-soft)">一排东西</text>
<text x="16" y="94" fill="var(--ink-soft)">按位置取</text>
<text x="16" y="112" fill="var(--ink-soft)">能增删改排序</text>
<text x="16" y="132" fill="var(--ink-faint)">≈ JS Array</text>
<rect x="134" y="12" width="118" height="132" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="142" y="34" fill="var(--ink)">元组 ( )</text>
<text x="142" y="54" fill="var(--ink-soft)">Day 22</text>
<text x="142" y="76" fill="var(--ink-soft)">一对,不许改</text>
<text x="142" y="94" fill="var(--ink-soft)">解包 a, b = ...</text>
<text x="142" y="112" fill="var(--ink-soft)">能当字典的键</text>
<text x="142" y="132" fill="var(--ink-faint)">≈ 只读的数组</text>
<rect x="260" y="12" width="118" height="132" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="268" y="34" fill="var(--ink)">字典 { : }</text>
<text x="268" y="54" fill="var(--ink-soft)">Day 24</text>
<text x="268" y="76" fill="var(--ink-soft)">按名字查</text>
<text x="268" y="94" fill="var(--ink-soft)">get 计数 items</text>
<text x="268" y="112" fill="var(--ink-soft)">键不能重复</text>
<text x="268" y="132" fill="var(--ink-faint)">≈ Object / Map</text>
<rect x="386" y="12" width="118" height="132" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="394" y="34" fill="var(--ink)">集合 { }</text>
<text x="394" y="54" fill="var(--ink-soft)">Day 25</text>
<text x="394" y="76" fill="var(--ink-soft)">不重复</text>
<text x="394" y="94" fill="var(--ink-soft)">只问在不在</text>
<text x="394" y="112" fill="var(--ink-soft)">&amp; | - 交并差</text>
<text x="394" y="132" fill="var(--ink-faint)">≈ Set</text>
<rect x="512" y="12" width="120" height="132" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="520" y="34" fill="var(--ink)">嵌套</text>
<text x="520" y="54" fill="var(--ink-soft)">Day 26</text>
<text x="520" y="76" fill="var(--ink-soft)">容器套容器</text>
<text x="520" y="94" fill="var(--ink-soft)">一层层往里取</text>
<text x="520" y="112" fill="var(--ink-soft)">先想这层是啥</text>
<text x="520" y="132" fill="var(--ink-faint)">≈ JSON</text>
<rect x="8" y="166" width="624" height="112" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="20" y="190" fill="var(--ink)">选哪个,问自己四句</text>
<text x="20" y="212" fill="var(--ink-soft)">1. 要按顺序、要排序、会增减?        → 列表</text>
<text x="20" y="232" fill="var(--ink-soft)">2. 是固定的一对/一组,拆开用?        → 元组</text>
<text x="20" y="252" fill="var(--ink-soft)">3. 要拿名字(工单号、客户号)一步查到整条? → 字典</text>
<text x="20" y="270" fill="var(--ink-soft)">4. 只关心有没有、去重、两批比较?        → 集合</text>
<rect x="8" y="294" width="624" height="58" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="20" y="318" fill="var(--ink)">Day 23 推导式:[ ] { : } { } 三种括号都能一行造出新的</text>
<text x="20" y="338" fill="var(--ink-faint)">[x for x in xs if 条件]   {k: v for ...}   {x for ...}</text>
</g>
</svg>
<figcaption>第 4 周知识地图。上面五格是五种东西,中间是选容器的四句话,最下面的推导式是造它们的捷径。</figcaption>
</figure>

四句话里最容易混的是第 3 句和第 4 句:字典和集合都用花括号,都靠「哈希」所以查得快(Day 25 实测过 `in` 比列表快得多),区别在字典存的是「名字对应的东西」,集合只存「东西」。你要的是「T303 这张工单的整条内容」就是字典,你要的是「有没有出现过 T303」就是集合。

再把它们翻成日常需求,下面这张表建议打印出来放在手边:

| 你想做的事 | 用什么 | 一句话写法 | 哪天 |
| --- | --- | --- | --- |
| 把一批工单排名、取前三 | 列表,里面放元组 | `sorted([(fen, id), ...], reverse=True)[:3]` | Day 21、22 |
| 一行文本拆成四个名字 | 元组解包 | `ticket_id, human, customer, desc = parts` | Day 22 |
| 一批值变成另一批值 | 列表推导式 | `[int(x) for x in xs if x.isdigit()]` | Day 23 |
| 按工单号查整张工单 | 字典 | `by_id = {t["id"]: t for t in tickets}` | Day 24、26 |
| 数每一类有几张 | 字典加 `get` | `d[k] = d.get(k, 0) + 1` | Day 24 |
| 去重 | 集合 | `set(ids)`;要保序:`list(dict.fromkeys(ids))` | Day 25 |
| 两批数据谁新增、谁消失 | 集合运算 | `today - yesterday`、`yesterday - today` | Day 25 |
| 读一份陌生的接口数据 | 嵌套访问加防护 | `(t["assignee"] or {}).get("name")` 或 `if` | Day 26 |

## 本周每天一句话

- [Day 21](/blog/agent-zero/day-021-lists/):列表像 JS 数组,`append`/`insert`/`extend`/`pop`/`remove`/`del`;`append`、`sort` 这类原地修改的方法都返回 `None`,别接;`b = a` 只是多一个名字,要副本用 `a.copy()`;遍历时别删同一个列表;`sort()` 原地、`sorted()` 返回新的,混着类型排不了。
- [Day 22](/blog/agent-zero/day-022-tuples-unpack/):元组建好不能改(`TypeError: 'tuple' object does not support item assignment`),造它的是逗号不是括号,单项要写 `(5,)`;解包 `a, b = b, a`、`first, *rest = ...`、`_` 表示不要;`enumerate`、`zip`、`divmod` 返回的都是元组,函数「返回多个值」其实返回一个元组。
- [Day 23](/blog/agent-zero/day-023-comprehensions/):`[表达式 for 名字 in 一批 if 条件]` 等价于「空列表加 for 加 append」;`if` 放后面是筛掉一些,`A if 条件 else B` 放前面是每一项都留只换值;推导式里的名字不外漏;别在里面做事(`print` 得到一串 `None`)。
- [Day 24](/blog/agent-zero/day-024-dicts/):字典键不重复且必须不可变,取不到的键 `KeyError`,可能没有就用 `get(键, 默认值)`;遍历要写 `.items()`,忘写不报错但拆错;遍历时往里加删会 `RuntimeError`;`d[k] = d.get(k, 0) + 1` 是计数的万能句式。
- [Day 25](/blog/agent-zero/day-025-sets/):`set(列表)` 一行去重,空集合要写 `set()`,`{}` 是空字典;`&`、`|`、`-`、`^` 回答两批数据哪里同哪里异,`A - B` 和 `B - A` 不一样;打印顺序每次可能不同,所以先 `sorted`;`in` 比列表快得多。
- [Day 26](/blog/agent-zero/day-026-nested-data/):嵌套数据一层层取,交替用键和下标;四种取不到的报错各有病因;`.copy()` 只复制最外层,要独立副本用 `copy.deepcopy`;字典推导式造查找表,键必须唯一。

## 默写一:清洗、拆成字典、计数、排名

合上文章写 `part01/wk4_tally.py`:9 行原始工单(有空行、全角字符、段数不够的行、金额是 `abc` 的行),清洗后拆成字典,统计各类别张数、各客户金额,给客户金额排名取前两名,再建一个按工单号查的字典。这一段用到 Day 21(`sorted`、切片)、Day 22(元组、解包)、Day 23(推导式)、Day 24(`zip`、`dict`、`get` 计数)。

```python
# agent-zero-lab/part01/wk4_tally.py
import unicodedata

FIELDS = ["id", "category", "customer", "amount", "desc"]

raw_lines = [
    "T401 计费 C023 29900 重复扣款,请退款",
    "  T402 登录 C007 0 验证码收不到 ",
    "",
    "T403 计费 C015 46800 年付多扣了,要求退款",
    "T404 计费 C023 4900 想要发票PDF",
    "T405 计费 C042",
    "Ｔ406 功能 C031 0 导出PDF乱码",
    "T407 计费 C031 abc 金额字段坏了",
    "T408 登录 C007 0 Forgot password",
]

tickets = []
bad = []
for raw in raw_lines:
    line = unicodedata.normalize("NFKC", raw).strip()
    if not line:
        continue
    parts = line.split(maxsplit=4)
    if len(parts) != 5 or not parts[3].isdigit():
        bad.append(line)
        continue
    tickets.append(dict(zip(FIELDS, parts)))

print(f"好 {len(tickets)} 张,坏 {len(bad)} 行:{bad}")

by_category = {}
amount_by_customer = {}
for t in tickets:
    by_category[t["category"]] = by_category.get(t["category"], 0) + 1
    customer = t["customer"]
    fen = int(t["amount"])
    amount_by_customer[customer] = amount_by_customer.get(customer, 0) + fen
print("按类别:", by_category)
print("按客户(分):", amount_by_customer)

pairs = [(fen, customer) for customer, fen in amount_by_customer.items()]
ranking = sorted(pairs, reverse=True)
for rank, (fen, customer) in enumerate(ranking[:2], start=1):
    print(f"第 {rank} 名 {customer} {fen // 100} 元")

by_id = {t["id"]: t for t in tickets}
print("T404:", by_id["T404"]["desc"], "| T405 在吗:", "T405" in by_id)
```

<div class="line-notes">

- `import unicodedata` 清洗全角字符用(Day 16)。
- `FIELDS = [` 五个字段名,大写表示「不会变」。后面 `zip` 把它和每行拆出来的五段配成字典。
- `raw_lines = [` 9 行原始文本。第 2 行两头有空格,第 3 行是空串,第 6 行只有三段(`T405 计费 C042`),第 7 行开头是全角 `Ｔ`,第 8 行金额写成了 `abc`。
- `tickets = []` 装好的字典。
- `bad = []` 装坏行的原文。
- `for raw in raw_lines:` 一行一行取。
- `line = unicodedata.normalize("NFKC", raw).strip()` 洗两步:全角变半角,去两头空白。第 7 行的 `Ｔ406` 在这里变成 `T406`。
- `if not line:` 空串是假,`not` 把它翻成真。第 3 行走进来。
- `continue` 空行不算坏行,不记录,直接下一轮(Day 19)。
- `parts = line.split(maxsplit=4)` 最多切成五段,第五段保留完整描述。第 1 行得到 `['T401', '计费', 'C023', '29900', '重复扣款,请退款']`。
- `if len(parts) != 5 or not parts[3].isdigit():` 两种坏法合在一个条件里:段数不对,或者第四段(金额)不是纯数字。`or` 的左边为真就不看右边,所以 `T405` 只有三段时不会去碰 `parts[3]`,避免 `IndexError`(Day 17 的短路)。
- `bad.append(line)` 记下来。
- `continue` 这一行不用往下走了。
- `tickets.append(dict(zip(FIELDS, parts)))` `zip` 把字段名和值两两配对,`dict` 收成字典:`{'id': 'T401', 'category': '计费', ...}`。金额还是字符串 `'29900'`(Day 24 的约定:用的时候再 `int()`)。
- `print(f"好 {len(tickets)} 张,坏 {len(bad)} 行:{bad}")` 9 行里 1 行是空行,6 行好,2 行坏。
- `by_category = {}` 类别计数的字典。
- `amount_by_customer = {}` 客户金额汇总的字典。
- `for t in tickets:` 遍历 6 张好工单,`t` 是字典。
- `by_category[t["category"]] = by_category.get(t["category"], 0) + 1` 计数句式:没见过的类别 `get` 给 0,加 1 存回去。第一张是计费,字典里没有,`0 + 1`。
- `customer = t["customer"]` 取客户号起个名字,下一行要用两次。
- `fen = int(t["amount"])` 字符串 `'29900'` 转整数 29900。`T407` 那种 `abc` 已经被挡在 `bad` 里,这里不会炸。
- `amount_by_customer[customer] = amount_by_customer.get(customer, 0) + fen` 同一个句式,这次加的是金额不是 1。C023 先加 29900,又加 4900,得 34800。
- `print("按类别:", by_category)` 打印类别计数。
- `print("按客户(分):", amount_by_customer)` 打印客户金额。
- `pairs = [(fen, customer) for customer, fen in amount_by_customer.items()]` 推导式加解包:`.items()` 给出 `(客户, 金额)`,对调成 `(金额, 客户)`,金额放前面才能按金额排。这个 `fen` 是推导式自己的,不外漏。
- `ranking = sorted(pairs, reverse=True)` 元组按第一项比,从大到小。两个金额是 0 的客户并列,按第二项倒序,`C031` 排在 `C007` 前面。
- `for rank, (fen, customer) in enumerate(ranking[:2], start=1):` `enumerate` 给 `(名次, 元组)`,括号里再把元组解包,一行拆出三个名字。`ranking[:2]` 切前两项。
- `print(f"第 {rank} 名 {customer} {fen // 100} 元")` 分换成元用整除。
- `by_id = {t["id"]: t for t in tickets}` 字典推导式造查找表。
- `print("T404:", by_id["T404"]["desc"], "| T405 在吗:", "T405" in by_id)` 先按键取整张工单再取 `desc`;`in` 判断的是键在不在,`T405` 是坏行,没进字典,所以 `False`。

</div>

```text
$ uv run python part01/wk4_tally.py
好 6 张,坏 2 行:['T405 计费 C042', 'T407 计费 C031 abc 金额字段坏了']
按类别: {'计费': 3, '登录': 2, '功能': 1}
按客户(分): {'C023': 34800, 'C007': 0, 'C015': 46800, 'C031': 0}
第 1 名 C015 468 元
第 2 名 C023 348 元
T404: 想要发票PDF | T405 在吗: False
```

<div class="line-notes">

- `好 6 张,坏 2 行:['T405 计费 C042', 'T407 计费 C031 abc 金额字段坏了']` 空行被悄悄跳过,不算坏行;两个坏行一个缺段、一个金额不是数字。
- `按类别: {'计费': 3, '登录': 2, '功能': 1}` 计费是 T401、T403、T404,登录是 T402、T408,功能是 T406。
- `按客户(分): {'C023': 34800, 'C007': 0, 'C015': 46800, 'C031': 0}` 字典保持插入顺序,C023 先出现。C023 是 29900 加 4900。
- `第 1 名 C015 468 元` 46800 分最大。
- `第 2 名 C023 348 元` 34800 分。
- `T404: 想要发票PDF | T405 在吗: False` 查找表一步取到,坏行不在里面。

</div>

默写时容易卡在三处:计数那句 `d.get(k, 0) + 1` 少写默认值,结果 `TypeError: unsupported operand type(s) for +: 'NoneType' and 'int'`;`for rank, (fen, customer) in ...` 里面那层括号漏了会报 `ValueError: too many values to unpack`;推导式里忘了对调顺序,排出来是按客户号排的。

## 默写二:用集合对比两天的导出

合上文章写 `part01/wk4_diff.py`:昨天和今天各一批 `(工单号, 客户号, 类别)` 元组,回答五个问题:新增了谁、消失了谁、两天都在的是谁、今天有没有重复导出、同时提过计费和登录问题的客户是谁。用到 Day 22(元组、`_` 占位)、Day 24(计数)、Day 25(集合推导式、`&`、`-`、`dict.fromkeys`)。

```python
# agent-zero-lab/part01/wk4_diff.py
yesterday_rows = [
    ("T401", "C023", "计费"),
    ("T402", "C007", "登录"),
    ("T403", "C015", "计费"),
    ("T404", "C023", "计费"),
]
today_rows = [
    ("T402", "C007", "登录"),
    ("T403", "C015", "计费"),
    ("T403", "C015", "计费"),
    ("T405", "C031", "功能"),
    ("T406", "C007", "计费"),
]

yesterday_ids = {ticket_id for ticket_id, _, _ in yesterday_rows}
today_ids = {ticket_id for ticket_id, _, _ in today_rows}
print("新增:", sorted(today_ids - yesterday_ids))
print("消失:", sorted(yesterday_ids - today_ids))
print("两天都在:", sorted(today_ids & yesterday_ids))

seen = {}
for ticket_id, _, _ in today_rows:
    seen[ticket_id] = seen.get(ticket_id, 0) + 1
repeated = [ticket_id for ticket_id, n in seen.items() if n > 1]
print("今天重复导出:", repeated)

unique_rows = list(dict.fromkeys(today_rows))
print(f"去重前 {len(today_rows)} 行,去重后 {len(unique_rows)} 行,顺序不变")

billing = {customer for _, customer, cat in today_rows if cat == "计费"}
login = {customer for _, customer, cat in today_rows if cat == "登录"}
print("计费和登录都提过的客户:", sorted(billing & login))
```

<div class="line-notes">

- `yesterday_rows = [` 昨天 4 行,每行是一个三项元组。工单号 T401 到 T404。
- `today_rows = [` 今天 5 行。`T403` 出现了两次,是同一行导出了两遍。
- `yesterday_ids = {ticket_id for ticket_id, _, _ in yesterday_rows}` 集合推导式,花括号里没有冒号。`for` 后面直接把元组拆成三个名字,不要的两项用 `_`(Day 22)。得到 `{'T401', 'T402', 'T403', 'T404'}`。
- `today_ids = {ticket_id for ticket_id, _, _ in today_rows}` 今天的工单号。`T403` 两行合并成一个,所以只有四个:`T402`、`T403`、`T405`、`T406`。
- `print("新增:", sorted(today_ids - yesterday_ids))` 今天有昨天没有:读成「今天减昨天」。集合没有顺序,所以先 `sorted`。
- `print("消失:", sorted(yesterday_ids - today_ids))` 反过来,昨天有今天没有。
- `print("两天都在:", sorted(today_ids & yesterday_ids))` `&` 是交集。
- `seen = {}` 计数字典,数每个工单号在今天出现几次。
- `for ticket_id, _, _ in today_rows:` 同样的解包。
- `seen[ticket_id] = seen.get(ticket_id, 0) + 1` Day 24 的句式。`T403` 加了两次得 2。
- `repeated = [ticket_id for ticket_id, n in seen.items() if n > 1]` 列表推导式加筛选:次数大于 1 的工单号。`n > 1` 只有 `T403`。
- `print("今天重复导出:", repeated)` 打印。
- `unique_rows = list(dict.fromkeys(today_rows))` 用字典的键不重复来去重,而且保持顺序。元组可以当字典的键(Day 22 的伏笔在这里收回),列表就不行。
- `print(f"去重前 {len(today_rows)} 行,去重后 {len(unique_rows)} 行,顺序不变")` 5 行变 4 行。
- `billing = {customer for _, customer, cat in today_rows if cat == "计费"}` 集合推导式加筛选:今天提过计费问题的客户。这次元组拆成 `_`、`customer`、`cat`,取中间一项。
- `login = {customer for _, customer, cat in today_rows if cat == "登录"}` 提过登录问题的客户。
- `print("计费和登录都提过的客户:", sorted(billing & login))` 两个集合取交集。

</div>

```text
$ uv run python part01/wk4_diff.py
新增: ['T405', 'T406']
消失: ['T401', 'T404']
两天都在: ['T402', 'T403']
今天重复导出: ['T403']
去重前 5 行,去重后 4 行,顺序不变
计费和登录都提过的客户: ['C007']
```

<div class="line-notes">

- `新增: ['T405', 'T406']` 今天的 `{T402, T403, T405, T406}` 减去昨天的 `{T401, T402, T403, T404}`。
- `消失: ['T401', 'T404']` 反过来减。两个答案不一样,这就是 `A - B` 和 `B - A` 要读出声的原因。
- `两天都在: ['T402', 'T403']` 交集。
- `今天重复导出: ['T403']` 数出来次数是 2 的那个。
- `去重前 5 行,去重后 4 行,顺序不变` `T403` 的两行完全一样,所以 `dict.fromkeys` 合并了。
- `计费和登录都提过的客户: ['C007']` C007 今天有一行登录(T402)、一行计费(T406)。

</div>

卡点:`{ticket_id for ... }` 写成了 `[ticket_id for ... ]` 就不再去重了,不报错只是结果是列表;空集合那种 `{}` 这里没用到,但默写时如果你想先造一个空集合再 `add`,要记得写 `set()`。

## 默写三:摸清嵌套 JSON,再安全地取值

合上文章写 `part01/wk4_peek.py`:一份三张工单的 JSON(第三张故意没有 `tags` 键,两张的 `assignee` 是 `null`,一张没有消息),先看第一张工单每个键的类型,再用集合找出「不是每张都有的键」,最后建查找表并逐张打印负责人、标签个数和最后一条消息是谁发的。用到 Day 24(`items`)、Day 25(集合运算)、Day 26(`json.loads`、嵌套、`get`、条件表达式)。

```python
# agent-zero-lab/part01/wk4_peek.py
import json

RAW = """
{"tickets": [
  {"id": "T501", "customer": {"name": "云帆科技", "plan": "annual"},
   "tags": ["退款"], "assignee": {"name": "林舟"},
   "messages": [{"from": "customer", "text": "重复扣款"}]},
  {"id": "T502", "customer": {"name": "青禾网络", "plan": "monthly"},
   "tags": [], "assignee": null, "messages": []},
  {"id": "T503", "customer": {"name": "北辰数据", "plan": "annual"},
   "assignee": null,
   "messages": [{"from": "customer", "text": "发票呢"}, {"from": "agent", "text": "稍等"}]}
]}
"""

tickets = json.loads(RAW)["tickets"]

for key, value in tickets[0].items():
    print(f"{key}: {type(value).__name__}")

key_sets = [set(t) for t in tickets]
common = set.intersection(*key_sets)
every = set.union(*key_sets)
print("不是每张都有的键:", sorted(every - common))

by_id = {t["id"]: t for t in tickets}
for ticket_id, t in by_id.items():
    assignee = t["assignee"]
    who = assignee["name"] if assignee else "未分配"
    messages = t["messages"]
    last = messages[-1]["from"] if messages else "—"
    print(ticket_id, t["customer"]["name"], who, len(t.get("tags", [])), last)
```

<div class="line-notes">

- `import json` `json.loads` 把文本变成 Python 数据,Day 39 才正式讲,这里是黑盒。
- `RAW = """` 三引号字符串,里面是 JSON 文本。三张工单:T501 什么都有;T502 的 `tags` 是空列表、`assignee` 是 `null`、`messages` 是空列表;T503 根本没有 `tags` 这个键。
- `tickets = json.loads(RAW)["tickets"]` 一行里做两件事:解析出字典,再取 `"tickets"` 这个键,得到三张工单的列表。
- `for key, value in tickets[0].items():` 遍历第一张工单的每个键值对(Day 24)。
- `print(f"{key}: {type(value).__name__}")` `type(value).__name__` 是类型名字。`id` 是 `str`,`customer` 是 `dict`,`tags` 和 `messages` 是 `list`,`assignee` 是 `dict`。
- `key_sets = [set(t) for t in tickets]` 对字典调用 `set(...)` 得到它所有的键。三个集合,一张工单一个。
- `common = set.intersection(*key_sets)` 三个集合的共同部分。`*key_sets` 把列表拆成三个参数传进去(函数的 `*` 在 Day 30 才讲,先把它当成「把列表展开」)。这是 Day 26 里循环写法的一行版。
- `every = set.union(*key_sets)` 三个集合的并集,所有出现过的键。
- `print("不是每张都有的键:", sorted(every - common))` 差集:出现过但不是每张都有。
- `by_id = {t["id"]: t for t in tickets}` 查找表。
- `for ticket_id, t in by_id.items():` 遍历字典的键和值。
- `assignee = t["assignee"]` 先取出来,可能是字典也可能是 `None`。
- `who = assignee["name"] if assignee else "未分配"` 条件表达式:`None` 是假,走 `"未分配"`,不会碰到 `None["name"]`。
- `messages = t["messages"]` 消息列表,可能是空的。
- `last = messages[-1]["from"] if messages else "—"` 空列表是假,直接用 `—`,避开 `IndexError`。
- `print(ticket_id, t["customer"]["name"], who, len(t.get("tags", [])), last)` `get("tags", [])` 对没有这个键的 T503 给空列表,长度 0。

</div>

```text
$ uv run python part01/wk4_peek.py
id: str
customer: dict
tags: list
assignee: dict
messages: list
不是每张都有的键: ['tags']
T501 云帆科技 林舟 1 customer
T502 青禾网络 未分配 0 —
T503 北辰数据 未分配 0 agent
```

<div class="line-notes">

- `id: str` 第一张工单的各键类型,逐行对应字典里的键。
- `customer: dict` 里面还套着一层字典。
- `tags: list` 列表。
- `assignee: dict` T501 有负责人,所以是字典;如果打印 T502 的,会是 `NoneType`。
- `messages: list` 消息列表。
- `不是每张都有的键: ['tags']` T503 缺的那一个。
- `T501 云帆科技 林舟 1 customer` T501 有负责人林舟,一个标签,最后一条是客户发的。
- `T502 青禾网络 未分配 0 —` `assignee` 是 `None` 走了「未分配」,`tags` 是空列表长度 0,没有消息显示 `—`。
- `T503 北辰数据 未分配 0 agent` 没有 `tags` 键也不炸,最后一条消息是客服发的。

</div>

三段默写你可以这样检查自己:默写完先不看文章直接跑,输出和上面逐行对;不一样的地方,先用 Day 26 学的办法读报错(哪一行、哪种错),不要急着翻答案。

## 小项目:工单看板

只用这一周的东西,做一个把整份嵌套数据「翻译成一页摘要」的小程序。场景:客服组长早上想看一眼,6 张工单分别归谁、年付和月付各有哪些客户、金额最大的三张、标签热度、哪些客户在等回复,以及和昨天相比新增了谁、消失了谁。昨天只留下一份工单号列表。

要求:

1. 数据用 `json.loads` 读(Day 26);查一次的 `by_id` 查找表用字典推导式(Day 26)。
2. 不是每张都有的键用集合找出来(Day 25)。
3. 按负责人归拢,没人接的归「未分配」,用字典套列表(Day 24、21)。
4. 年付客户和月付客户各一个集合,自动去重(Day 23、25)。
5. 金额排名用「元组列表」,取前三用切片并解包(Day 21、22)。
6. 标签计数用 `get` 句式,`tags` 可能没有(Day 24、26)。
7. 等回复的客户:最后一条消息是客户发的(Day 26)。
8. 对比昨天:集合的差(Day 25)。

新建 `part01/ticket_board.py`:

```python
# agent-zero-lab/part01/ticket_board.py
import json

RAW = """
{"tickets": [
  {"id": "T601", "category": "计费", "amount": 29900,
   "customer": {"id": "C023", "name": "云帆科技", "plan": "annual"},
   "tags": ["退款", "重复扣款"],
   "messages": [{"from": "customer", "text": "重复扣款"}, {"from": "agent", "text": "已转财务"}],
   "assignee": {"name": "林舟"}},
  {"id": "T602", "category": "登录", "amount": 0,
   "customer": {"id": "C007", "name": "青禾网络", "plan": "monthly"},
   "tags": [],
   "messages": [{"from": "customer", "text": "验证码收不到"}],
   "assignee": null},
  {"id": "T603", "category": "计费", "amount": 46800,
   "customer": {"id": "C015", "name": "北辰数据", "plan": "annual"},
   "tags": ["退款", "年付"],
   "messages": [{"from": "customer", "text": "年付多扣了"}, {"from": "agent", "text": "请给发票号"},
                {"from": "customer", "text": "INV-2026-0815"}],
   "assignee": {"name": "周宁"}},
  {"id": "T604", "category": "功能", "amount": 0,
   "customer": {"id": "C031", "name": "星河软件", "plan": "monthly"},
   "messages": [],
   "assignee": null},
  {"id": "T605", "category": "计费", "amount": 4900,
   "customer": {"id": "C023", "name": "云帆科技", "plan": "annual"},
   "tags": ["发票"],
   "messages": [{"from": "customer", "text": "想要发票PDF"}],
   "assignee": {"name": "林舟"}},
  {"id": "T606", "category": "计费", "amount": 59800,
   "customer": {"id": "C042", "name": "远山传媒", "plan": "annual"},
   "tags": ["退款"],
   "messages": [{"from": "customer", "text": "扣了两次"}, {"from": "agent", "text": "核实中"}],
   "assignee": {"name": "周宁"}}
]}
"""
YESTERDAY_IDS = ["T601", "T602", "T604", "T609"]

tickets = json.loads(RAW)["tickets"]
by_id = {t["id"]: t for t in tickets}

key_sets = [set(t) for t in tickets]
missing_somewhere = set.union(*key_sets) - set.intersection(*key_sets)
print(f"共 {len(tickets)} 张,不是每张都有的键:{sorted(missing_somewhere)}")

by_assignee = {}
for t in tickets:
    assignee = t["assignee"]
    who = assignee["name"] if assignee else "未分配"
    if who not in by_assignee:
        by_assignee[who] = []
    by_assignee[who].append(t["id"])
print("按负责人:", by_assignee)

annual = {t["customer"]["name"] for t in tickets if t["customer"]["plan"] == "annual"}
monthly = {t["customer"]["name"] for t in tickets if t["customer"]["plan"] == "monthly"}
print("年付客户:", sorted(annual), "月付客户:", sorted(monthly))

ranking = sorted(
    [(t["amount"], t["id"]) for t in tickets if t["amount"] > 0], reverse=True
)
print("金额前三:")
for rank, (fen, ticket_id) in enumerate(ranking[:3], start=1):
    print(
        f"  {rank}. {ticket_id} {fen // 100} 元 {by_id[ticket_id]['customer']['name']}"
    )

tag_counts = {}
for t in tickets:
    for tag in t.get("tags", []):
        tag_counts[tag] = tag_counts.get(tag, 0) + 1
print("标签:", tag_counts)

waiting = []
for t in tickets:
    messages = t["messages"]
    if messages and messages[-1]["from"] == "customer":
        waiting.append(t["id"])
print("客户在等回复:", waiting)

print("今天新增:", sorted(set(by_id) - set(YESTERDAY_IDS)))
print("昨天有、今天没有:", sorted(set(YESTERDAY_IDS) - set(by_id)))
```

<div class="line-notes">

- `import json` 同前。
- `RAW = """` 6 张工单的 JSON。T601 和 T605 是同一个客户(云帆科技 C023);T602、T604 没人接;T604 没有 `tags` 键;T604 的消息列表是空的;T603 有三条消息,最后一条是客户发的。
- `YESTERDAY_IDS = [` 昨天只留下这四个工单号:T601、T602、T604 还在,T609 今天没了。
- `tickets = json.loads(RAW)["tickets"]` 解析并取出工单列表。
- `by_id = {t["id"]: t for t in tickets}` 查找表,后面按工单号取整张工单时用。
- `key_sets = [set(t) for t in tickets]` 每张工单的键集合。
- `missing_somewhere = set.union(*key_sets) - set.intersection(*key_sets)` 所有出现过的键减去每张都有的键。
- `print(f"共 {len(tickets)} 张,不是每张都有的键:{sorted(missing_somewhere)}")` 6 张,只有 `tags` 不齐。
- `by_assignee = {}` 负责人对应工单号列表的字典。
- `for t in tickets:` 遍历六张。
- `assignee = t["assignee"]` 字典或 `None`。
- `who = assignee["name"] if assignee else "未分配"` 防 `None`。
- `if who not in by_assignee:` 这个负责人第一次出现吗?`not in` 判断的是键。
- `by_assignee[who] = []` 第一次出现,先给他一个空列表。
- `by_assignee[who].append(t["id"])` 取出列表,往里加工单号。两步合起来,是「字典里装列表」的标准写法。
- `print("按负责人:", by_assignee)` 打印。
- `annual = {t["customer"]["name"] for t in tickets if t["customer"]["plan"] == "annual"}` 集合推导式:筛出年付的工单,取客户名,重复的客户(云帆科技有两张)自动合并。
- `monthly = {` 同样写月付。
- `print("年付客户:", sorted(annual), "月付客户:", sorted(monthly))` 先排序再打印。
- `ranking = sorted(` 这条语句被 Ruff 折成了三行,拼起来是一句话。
- `[(t["amount"], t["id"]) for t in tickets if t["amount"] > 0], reverse=True` 推导式造 `(金额, 工单号)` 元组,金额为 0 的不要,按金额从大到小。
- `print("金额前三:")` 小标题。
- `for rank, (fen, ticket_id) in enumerate(ranking[:3], start=1):` 前三项,每项再解包。
- `print(` 这条 `print` 也被折行了,里面是一条 f-string。
- `f"  {rank}. {ticket_id} {fen // 100} 元 {by_id[ticket_id]['customer']['name']}"` 用工单号去查找表里取整张工单,再往里取客户名。f-string 外面用了双引号,里面取键就只能用单引号。
- `tag_counts = {}` 标签计数。
- `for t in tickets:` 遍历工单。
- `for tag in t.get("tags", []):` `T604` 没有 `tags` 键,`get` 给空列表,内层循环一次不跑,不炸。
- `tag_counts[tag] = tag_counts.get(tag, 0) + 1` 计数句式。
- `print("标签:", tag_counts)` 打印。
- `waiting = []` 等回复的工单号。
- `messages = t["messages"]` 取消息列表。
- `if messages and messages[-1]["from"] == "customer":` 先看列表非空,再看最后一条是谁发的。`and` 左边为假就不看右边,空列表不会走到 `[-1]`。
- `waiting.append(t["id"])` 记下来。
- `print("客户在等回复:", waiting)` 打印。
- `print("今天新增:", sorted(set(by_id) - set(YESTERDAY_IDS)))` `set(by_id)` 对字典取键集合,今天的六个工单号;减去昨天的四个。
- `print("昨天有、今天没有:", sorted(set(YESTERDAY_IDS) - set(by_id)))` 反过来。

</div>

```text
$ uv run python part01/ticket_board.py
共 6 张,不是每张都有的键:['tags']
按负责人: {'林舟': ['T601', 'T605'], '未分配': ['T602', 'T604'], '周宁': ['T603', 'T606']}
年付客户: ['云帆科技', '北辰数据', '远山传媒'] 月付客户: ['星河软件', '青禾网络']
金额前三:
  1. T606 598 元 远山传媒
  2. T603 468 元 北辰数据
  3. T601 299 元 云帆科技
标签: {'退款': 3, '重复扣款': 1, '年付': 1, '发票': 1}
客户在等回复: ['T602', 'T603', 'T605']
今天新增: ['T603', 'T605', 'T606']
昨天有、今天没有: ['T609']
```

<div class="line-notes">

- `共 6 张,不是每张都有的键:['tags']` 只有 T604 缺 `tags`。
- `按负责人: {'林舟': ['T601', 'T605'], '未分配': ['T602', 'T604'], '周宁': ['T603', 'T606']}` 字典按首次出现的顺序排:T601 是林舟,T602 是未分配,T603 是周宁。
- `年付客户: ['云帆科技', '北辰数据', '远山传媒'] 月付客户: ['星河软件', '青禾网络']` 云帆科技有两张工单但只出现一次。中文排序按码点,不是拼音。
- `金额前三:` 小标题。
- `  1. T606 598 元 远山传媒` 59800 分最大。
- `  2. T603 468 元 北辰数据` 第二。
- `  3. T601 299 元 云帆科技` 第三;T605 只有 49 元,出局。
- `标签: {'退款': 3, '重复扣款': 1, '年付': 1, '发票': 1}` 退款在 T601、T603、T606 三张里出现。
- `客户在等回复: ['T602', 'T603', 'T605']` T602 只有客户一条;T603 最后一条是客户的发票号;T605 只有客户一条。T601、T606 最后是客服;T604 没有消息。
- `今天新增: ['T603', 'T605', 'T606']` 今天六张减去昨天的 T601、T602、T604、T609。
- `昨天有、今天没有: ['T609']` 昨天列表里有、今天数据里没有。

</div>

basedpyright 对这几个脚本零报错(数据是 `json.loads` 读的,类型是 `Any`,编辑器不挑),Ruff 检查通过,格式化只折了几处长行,文章里贴的已经是格式化之后的样子。

这个看板里每一块都不到十行,但每一块都要先选对容器。倒过来想会更清楚:如果 `by_assignee` 用列表装,你每次都要遍历找人;如果「年付客户」用列表装,云帆科技会出现两次;如果昨天的工单号不转成集合,「新增」就得写一个嵌套循环。选对了容器,逻辑基本是一行。

## 本周错题与坑清单

把这一周真实见过的报错和「悄悄错」放在一张表里。左边一列是你会在屏幕上看到的原文(或者现象),看到它就来这张表里查。文字是 3.12 的原文,和新版本不同的地方我在病因里注明。

| 你看到的 | 病因 | 改法 | 出处 |
| --- | --- | --- | --- |
| `IndexError: list index out of range` | 下标超出列表,或者列表是空的还取 `[0]`、`[-1]` | 先 `if lst:` 再取 | Day 21、26 |
| `ValueError: list.remove(x): x not in list` | `remove` 要删的东西不在列表里 | 先 `in` 判断 | Day 21 |
| `ValueError: 9 is not in list` | `index` 找不到(3.14 写成 `list.index(x): x not in list`) | 先 `in` 判断 | Day 21 |
| `AttributeError: 'NoneType' object has no attribute 'append'` | 写了 `ids = ids.append(x)`,`append` 返回 `None`,`ids` 变成了 `None` | 原地修改的方法不要接 | Day 21 |
| `TypeError: 'NoneType' object is not subscriptable`(在 `ids.sort()` 之后) | `x = ids.sort()` 同理,`sort` 返回 `None` | `ids.sort()` 或 `x = sorted(ids)` | Day 21 |
| `TypeError: '<' not supported between instances of 'str' and 'int'` | 一个列表里字符串和数字混着排序 | 排之前统一类型 | Day 21 |
| 改了 `b`,`a` 也变了 | `b = a` 只是多一个名字 | `b = a.copy()` | Day 21 |
| 遍历列表时删项,悄悄漏掉几项 | 删除让后面的项前移,下标跳过 | 另开新列表装要留的 | Day 21 |
| `TypeError: 'tuple' object does not support item assignment` | 想改元组里的某一项 | 造新元组,或者一开始就用列表 | Day 22 |
| `ValueError: not enough values to unpack (expected 4, got 2)` | 解包的名字比值多 | 先 `len(parts)` 检查 | Day 22 |
| `ValueError: too many values to unpack (expected 2)` | 解包的名字比值少(3.14 加一句 `, got 4`) | 补名字,或用 `*rest`、`_` | Day 22 |
| `SyntaxError: multiple starred expressions in assignment` | 一次解包写了两个星号名字 | 最多一个 | Day 22 |
| `ids = ("T001")` 不是元组,`for` 一个字符一个字符走 | 造元组的是逗号不是括号 | 单项写 `("T001",)` | Day 22 |
| `zip` 两个列表长度不同,多的悄悄丢掉 | `zip` 到较短的为止 | 重要数据加 `strict=True` | Day 22 |
| `SyntaxError: invalid syntax`(推导式末尾写了 `else`) | 「选值」的 `if ... else` 要放最前面 | `[a if 条件 else b for x in xs]` | Day 23 |
| `NameError: name 'n' is not defined`(推导式外面用里面的名字) | 推导式里的名字不外漏 | 要用就先赋给变量 | Day 23 |
| `[print(x) for x in xs]` 得到一串 `None` | 推导式是造列表的,不是做事的 | 做事用 `for` | Day 23 |
| `KeyError: 'customer'` | 字典里没有这个键 | 可能没有就 `get(键, 默认)` | Day 24、26 |
| `TypeError: unhashable type: 'list'` | 拿列表当字典的键(或放进集合,3.14 写成 `cannot use 'list' as a dict key (...)`) | 换成元组 | Day 24、25 |
| `RuntimeError: dictionary changed size during iteration` | 遍历字典时往里加或删 | 遍历 `list(d.items())` 的抄本 | Day 24 |
| `for k, v in d:` 报 `ValueError: not enough values to unpack (expected 2, got 1)` | 漏写 `.items()`,遍历出来的只是键 | `for k, v in d.items():` | Day 24 |
| `d.get("amount") or "没填"` 把真实的 0 当成了「没填」 | `or` 把所有假值都当没有 | `d.get("amount", "没填")` | Day 24 |
| `AttributeError: 'dict' object has no attribute 'add'` | `s = {}` 是空字典不是空集合 | `s = set()` | Day 25 |
| `KeyError: 9`(`s.remove(9)`) | `remove` 删不存在的东西 | 不存在也行就用 `discard` | Day 25 |
| `TypeError: 'set' object is not subscriptable` | 对集合用 `s[0]` | 集合没有位置,要位置先转列表 | Day 25 |
| 集合打印出来每次顺序不同 | 集合没有顺序 | 打印前 `sorted(...)`;要保序用 `dict.fromkeys` | Day 25 |
| 新增和消失的答案对调了 | `A - B` 不等于 `B - A` | 读出声:新增是今天减昨天 | Day 25 |
| `TypeError: list indices must be integers or slices, not str` | 把列表当字典用,拿字符串取下标 | 列表用数字,字典用键,交替出现 | Day 26 |
| `TypeError: 'NoneType' object is not subscriptable`(在 `t["assignee"]["name"]`) | 中间有一层是 `null` | `who = a["name"] if a else "未分配"` | Day 26 |
| 改了 `.copy()` 出来的副本的内层,原件也变 | `.copy()` 只复制最外一层 | `copy.deepcopy(...)` | Day 26 |
| `json.decoder.JSONDecodeError: Expecting property name enclosed in double quotes: line 1 column 2 (char 1)` | JSON 文本里用了单引号 | JSON 的字符串必须双引号 | Day 26 |
| `{t["customer"]: t["id"] for t in tickets}` 少了数据 | 键重复,后面的覆盖前面的,不报错 | 键必须唯一,用工单号 | Day 26 |

这周的规律和上周又不一样:上周很多错「不报错、结果悄悄错」,这周大部分错会报,但有一个共同的根:**你以为手里是 A,其实是 B**。以为 `ids.sort()` 返回排好的列表(其实是 `None`)、以为 `{}` 是空集合(其实是空字典)、以为 `b = a` 复制了(其实是同一个)、以为 `("T1")` 是元组(其实是字符串)、以为 `t["assignee"]` 是字典(其实是 `None`)。遇到怪错,第一件事是 `print(type(x))` 看一眼它到底是什么。

## 动手练习

### 练习 1:换个容器,代码短一半

下面 `part01/ex27_1_before.py` 是一份「没学过本周内容」的写法:两个并行列表、用 `in` 在列表里找、手写 `if/else` 计数、先造列表再排序。把它改成本周的写法,**输出必须一模一样**。

```python
# agent-zero-lab/part01/ex27_1_before.py
ids = ["T1", "T2", "T3", "T4"]
customers = ["C1", "C2", "C1", "C3"]
amounts = [100, 50, 300, 20]

target = "T3"
found = None
for i in range(len(ids)):
    if ids[i] == target:
        found = amounts[i]
print(target, "的金额:", found)

unique = []
for c in customers:
    if c not in unique:
        unique.append(c)
print("客户去重:", unique)

counts = {}
for c in customers:
    if c in counts:
        counts[c] = counts[c] + 1
    else:
        counts[c] = 1
print("每个客户几张:", counts)

pairs = []
for i in range(len(ids)):
    pairs.append((amounts[i], ids[i]))
pairs.sort(reverse=True)
top2 = []
for i in range(2):
    top2.append(pairs[i])
print("金额最高两张:", top2)
```

<details><summary>参考答案</summary>

先跑一遍原版,记下输出:

```text
$ uv run python part01/ex27_1_before.py
T3 的金额: 300
客户去重: ['C1', 'C2', 'C3']
每个客户几张: {'C1': 2, 'C2': 1, 'C3': 1}
金额最高两张: [(300, 'T3'), (100, 'T1')]
```

改写后的 `part01/ex27_1_after.py`:

```python
# agent-zero-lab/part01/ex27_1_after.py
ids = ["T1", "T2", "T3", "T4"]
customers = ["C1", "C2", "C1", "C3"]
amounts = [100, 50, 300, 20]

amount_by_id = dict(zip(ids, amounts))
target = "T3"
print(target, "的金额:", amount_by_id.get(target))

unique = list(dict.fromkeys(customers))
print("客户去重:", unique)

counts = {}
for c in customers:
    counts[c] = counts.get(c, 0) + 1
print("每个客户几张:", counts)

pairs = sorted(zip(amounts, ids), reverse=True)
print("金额最高两张:", pairs[:2])
```

<div class="line-notes">

- `ids = ["T1", "T2", "T3", "T4"]` 数据不变。
- `customers = ["C1", "C2", "C1", "C3"]` 客户 `C1` 出现两次。
- `amounts = [100, 50, 300, 20]` 金额。
- `amount_by_id = dict(zip(ids, amounts))` 两个并行列表是「按位置对应」的,正是字典的活:`zip` 配成 `('T1', 100)` 这样的对,`dict` 收成 `{'T1': 100, 'T2': 50, 'T3': 300, 'T4': 20}`(Day 24)。
- `target = "T3"` 要查的工单号。
- `print(target, "的金额:", amount_by_id.get(target))` 原来 4 行的 `for i in range(len(ids))` 加 `if` 变成一次 `get`。查不到时返回 `None`,和原版 `found = None` 的行为一致。
- `unique = list(dict.fromkeys(customers))` 原来 4 行的「不在就加」变成一行,而且保持顺序(Day 25)。得到 `['C1', 'C2', 'C3']`。
- `print("客户去重:", unique)` 打印。
- `counts = {}` 计数。
- `for c in customers:` 原版的 `if c in counts ... else` 两个分支。
- `counts[c] = counts.get(c, 0) + 1` 一行搞定(Day 24)。`C1` 加两次得 2。
- `print("每个客户几张:", counts)` 打印。
- `pairs = sorted(zip(amounts, ids), reverse=True)` `zip(amounts, ids)` 直接配出 `(金额, 工单号)` 元组,`sorted` 从大到小(Day 21、22),原版的建列表、`sort` 两步合成一步。
- `print("金额最高两张:", pairs[:2])` 切片取前两项,原版的 `for i in range(2)` 加 `append` 也省了。

</div>

```text
$ uv run python part01/ex27_1_after.py
T3 的金额: 300
客户去重: ['C1', 'C2', 'C3']
每个客户几张: {'C1': 2, 'C2': 1, 'C3': 1}
金额最高两张: [(300, 'T3'), (100, 'T1')]
```

<div class="line-notes">

- `T3 的金额: 300` 和原版一样。
- `客户去重: ['C1', 'C2', 'C3']` 一样,顺序也保持住了。
- `每个客户几张: {'C1': 2, 'C2': 1, 'C3': 1}` 一样。
- `金额最高两张: [(300, 'T3'), (100, 'T1')]` 一样,都是「元组的列表」。原版 `pairs.append((amounts[i], ids[i]))` 就是元组,所以打印出来圆括号也一致。

</div>

原版 34 行,新版 19 行,少掉的几乎都是「手动找」「手动判断在不在」。改写时容易忘的一点:并行列表之所以要改,是因为一旦其中一个少了一项,两个列表就错位了,`zip` 或字典把「对应关系」直接写进数据里。

</details>

### 练习 2:先猜,再跑

不要先运行。下面八行输出分别是什么?先写下答案再核对。重点看第 1 行(`b = a`)、第 2 行(`sorted` 之后 `a` 变没变)、第 5 行(`1 in d` 问的是键还是值)和第 7 行(`n if n % 2 else -n`)。

```python
# agent-zero-lab/part01/ex27_2_guess.py
a = [3, 1, 2]
b = a
b.append(0)
print(a)
print(sorted(a), a)
pair = ("T1",)
print(type(pair).__name__, len(pair))
first, *rest = [10, 20, 30]
print(first, rest)
d = {"a": 1}
print(d.get("b", 0) + 1, "a" in d, 1 in d)
print(sorted({n % 3 for n in range(10)}), len(set("aab")))
print([n if n % 2 else -n for n in range(4)])
nested = {"t": [{"id": 1}, {"id": 2}]}
print(nested["t"][-1]["id"], len(nested["t"]))
```

<details><summary>参考答案</summary>

```text
$ uv run python part01/ex27_2_guess.py
[3, 1, 2, 0]
[0, 1, 2, 3] [3, 1, 2, 0]
tuple 1
10 [20, 30]
1 True False
[0, 1, 2] 2
[0, 1, -2, 3]
2 2
```

<div class="line-notes">

- `[3, 1, 2, 0]` 第 1 行。`b = a` 让两个名字指向同一个列表,`b.append(0)` 改的就是 `a` 看到的那个(Day 21)。
- `[0, 1, 2, 3] [3, 1, 2, 0]` 第 2 行。`sorted(a)` 造了一个新列表,`a` 自己没有被排序,仍是上一行的 `[3, 1, 2, 0]`。
- `tuple 1` 第 3 行。`("T1",)` 带逗号,是一个只有一项的元组(Day 22)。
- `10 [20, 30]` 第 4 行。星号名字 `rest` 收走剩下的两项,它一定是列表。
- `1 True False` 第 5 行。`d.get("b", 0) + 1` 是 `0 + 1`;`"a" in d` 键在;`1 in d` 问的是「有没有叫 `1` 的键」,没有。
- `[0, 1, 2] 2` 第 6 行。0 到 9 对 3 取余只有 0、1、2 三种值,集合推导式去了重;`set("aab")` 是 `{'a', 'b'}`,长度 2(Day 25)。
- `[0, 1, -2, 3]` 第 7 行。`n if n % 2 else -n`:余数是 1(真)就保留 `n`,余数是 0(假)就取 `-n`。0 取负还是 0,2 变成 -2。条件在前、`else` 在后的写法是「每一项都留,只换值」(Day 23)。
- `2 2` 第 8 行。`nested["t"]` 是两项的列表,`[-1]` 取最后一项 `{"id": 2}`,再取 `"id"`;列表长度 2(Day 26)。

</div>

</details>

### 练习 3:找出五个错

`part01/ex27_3_bug.py` 想做五件小事,每件事里藏着本周一天的坑。先照原样跑一遍,每次只修**最先露出来的那一个**,再跑,直到跑完,并且每一行输出你都能解释。

```python
# agent-zero-lab/part01/ex27_3_bug.py
import json

RAW = '{"tickets": [{"id": "T1", "customer": {"plan": "annual"}}, {"id": "T2", "customer": {"plan": "monthly"}, "tags": ["退款"]}]}'
tickets = json.loads(RAW)["tickets"]

ids = ["T3", "T1", "T2"]
ordered = ids.sort()
print("第一个:", ordered[0])

line = "T1 计费 C023 重复扣款"
ticket_id, category = line.split(maxsplit=3)
print(ticket_id, category)

seen = {}
for t in tickets:
    seen.add(t["id"])
print("见过:", sorted(seen))

for t in tickets:
    print(t["id"], t["tags"])

draft = tickets[0].copy()
draft["customer"]["plan"] = "monthly"
print("原件的套餐:", tickets[0]["customer"]["plan"])
```

<details><summary>参考答案</summary>

编辑器其实一开始就在画红线:第 9 行 `ordered[0]`(`Object of type "None" is not subscriptable`)和第 17 行 `seen.add`(`Cannot access attribute "add" for class "dict[Unknown, Unknown]"`)。红线只能提前告诉你一部分,后面三个得靠跑。

```text
$ uv run python part01/ex27_3_bug.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex27_3_bug.py", line 9, in <module>
    print("第一个:", ordered[0])
                     ~~~~~~~^^^
TypeError: 'NoneType' object is not subscriptable
```

<div class="line-notes">

- `File "/Users/你/agent-zero-lab/part01/ex27_3_bug.py", line 9, in <module>` 第一个坑在第 9 行。
- `print("第一个:", ordered[0])` 崩在这一行。
- `TypeError: 'NoneType' object is not subscriptable` 第 8 行 `ordered = ids.sort()`,`sort` 原地排序、返回 `None`(Day 21)。修:`ids.sort()` 单独一行,后面用 `ids[0]`。

</div>

```text
$ uv run python part01/ex27_3_bug.py
第一个: T1
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex27_3_bug.py", line 12, in <module>
    ticket_id, category = line.split(maxsplit=3)
    ^^^^^^^^^^^^^^^^^^^
ValueError: too many values to unpack (expected 2)
```

<div class="line-notes">

- `第一个: T1` 修好了第一个。
- `line 12, in <module>` 第二个在第 12 行。
- `ticket_id, category = line.split(maxsplit=3)` 这一行拆成了四段,却只给两个名字。
- `ValueError: too many values to unpack (expected 2)` 名字比值少(Day 22)。修:`ticket_id, category, customer, desc = line.split(maxsplit=3)`。

</div>

```text
$ uv run python part01/ex27_3_bug.py
第一个: T1
T1 计费 C023 重复扣款
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex27_3_bug.py", line 17, in <module>
    seen.add(t["id"])
    ^^^^^^^^
AttributeError: 'dict' object has no attribute 'add'
```

<div class="line-notes">

- `T1 计费 C023 重复扣款` 第二个修好了。
- `line 17, in <module>` 第三个在第 17 行。
- `seen.add(t["id"])` 崩在这一行。
- `AttributeError: 'dict' object has no attribute 'add'` 第 15 行 `seen = {}` 是空字典(Day 25)。修:`seen = set()`。

</div>

```text
$ uv run python part01/ex27_3_bug.py
第一个: T1
T1 计费 C023 重复扣款
见过: ['T1', 'T2']
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex27_3_bug.py", line 21, in <module>
    print(t["id"], t["tags"])
                   ~^^^^^^^^
KeyError: 'tags'
```

<div class="line-notes">

- `见过: ['T1', 'T2']` 第三个修好了(打印前 `sorted`,顺序才稳定)。
- `line 21, in <module>` 第四个在第 21 行。
- `print(t["id"], t["tags"])` 崩在这一行。
- `KeyError: 'tags'` T1 这张工单就是没有 `tags` 键(Day 24、26)。修:`t.get("tags", [])`。

</div>

```text
$ uv run python part01/ex27_3_bug.py
第一个: T1
T1 计费 C023 重复扣款
见过: ['T1', 'T2']
T1 []
T2 ['退款']
原件的套餐: monthly
```

<div class="line-notes">

- `T1 []` 没有 `tags` 的工单给了空列表,不再崩。
- `T2 ['退款']` 有 `tags` 的正常。
- `原件的套餐: monthly` **第五个坑,不报错**:对副本 `draft` 改了内层的 `plan`,原件 `tickets[0]` 的套餐也变成了 `monthly`。`.copy()` 只复制最外一层,里面的 `customer` 字典两边共用(Day 26)。预期应该还是 `annual`。

</div>

五个都改好的 `part01/ex27_3_fixed.py`:

```python
# agent-zero-lab/part01/ex27_3_fixed.py
import copy
import json

RAW = '{"tickets": [{"id": "T1", "customer": {"plan": "annual"}}, {"id": "T2", "customer": {"plan": "monthly"}, "tags": ["退款"]}]}'
tickets = json.loads(RAW)["tickets"]

ids = ["T3", "T1", "T2"]
ids.sort()
print("第一个:", ids[0])

line = "T1 计费 C023 重复扣款"
ticket_id, category, customer, desc = line.split(maxsplit=3)
print(ticket_id, category, customer, desc)

seen = set()
for t in tickets:
    seen.add(t["id"])
print("见过:", sorted(seen))

for t in tickets:
    print(t["id"], t.get("tags", []))

draft = copy.deepcopy(tickets[0])
draft["customer"]["plan"] = "monthly"
print("原件的套餐:", tickets[0]["customer"]["plan"])
```

<div class="line-notes">

- `import copy` 标准库的复制模块(Day 26 提过 `deepcopy`)。
- `import json` 同前。
- `RAW = '` 一份两张工单的 JSON:第一张没有 `tags`,第二张有。
- `tickets = json.loads(RAW)["tickets"]` 解析,取出列表。
- `ids = ["T3", "T1", "T2"]` 待排序的编号。
- `ids.sort()` 原地排序,不接返回值。
- `print("第一个:", ids[0])` 排完是 `['T1', 'T2', 'T3']`,第一个是 `T1`。
- `line = "T1 计费 C023 重复扣款"` 一行文本。
- `ticket_id, category, customer, desc = line.split(maxsplit=3)` 四段对四个名字。
- `print(ticket_id, category, customer, desc)` 打印。
- `seen = set()` 空集合。
- `for t in tickets:` 遍历。
- `seen.add(t["id"])` 往集合里加。
- `print("见过:", sorted(seen))` 先排序再打印。
- `print(t["id"], t.get("tags", []))` `get` 带默认值。
- `draft = copy.deepcopy(tickets[0])` 深拷贝:从外到内全部复制。
- `draft["customer"]["plan"] = "monthly"` 改副本。
- `print("原件的套餐:", tickets[0]["customer"]["plan"])` 原件没动。

</div>

```text
$ uv run python part01/ex27_3_fixed.py
第一个: T1
T1 计费 C023 重复扣款
见过: ['T1', 'T2']
T1 []
T2 ['退款']
原件的套餐: annual
```

<div class="line-notes">

- `第一个: T1` 排完序的第一个。
- `T1 计费 C023 重复扣款` 四个名字。
- `见过: ['T1', 'T2']` 集合里两个工单号。
- `T1 []` 没有 `tags` 给空列表。
- `T2 ['退款']` 有的照常。
- `原件的套餐: annual` 原件没被动,这才是对的。

</div>

五个坑里,前四个都会报错,最后一个不会。**只有对着预期答案(原件应该还是 `annual`)才能发现它。**

</details>

### 练习 4:客户名片

下面是 5 张工单的 JSON(`T705` 没有 `tags`)。写 `part01/ex27_4_cards.py`:为每个客户出一张「名片」,包含工单张数、金额合计、出现过的所有标签(去重、排序)、最近一张工单号(数据里排在最后的那张),按金额合计从高到低打印。

```python
RAW = """
{"tickets": [
  {"id": "T701", "amount": 29900, "customer": {"name": "云帆科技"}, "tags": ["退款", "重复扣款"]},
  {"id": "T702", "amount": 0, "customer": {"name": "青禾网络"}, "tags": []},
  {"id": "T703", "amount": 46800, "customer": {"name": "北辰数据"}, "tags": ["退款", "年付"]},
  {"id": "T704", "amount": 4900, "customer": {"name": "云帆科技"}, "tags": ["发票", "退款"]},
  {"id": "T705", "amount": 0, "customer": {"name": "青禾网络"}}
]}
"""
```

期望的输出:

```text
北辰数据 1 张 468 元 标签 ['年付', '退款'] 最近 T703
云帆科技 2 张 348 元 标签 ['发票', '退款', '重复扣款'] 最近 T704
青禾网络 2 张 0 元 标签 [] 最近 T705
```

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex27_4_cards.py
import json

RAW = """
{"tickets": [
  {"id": "T701", "amount": 29900, "customer": {"name": "云帆科技"}, "tags": ["退款", "重复扣款"]},
  {"id": "T702", "amount": 0, "customer": {"name": "青禾网络"}, "tags": []},
  {"id": "T703", "amount": 46800, "customer": {"name": "北辰数据"}, "tags": ["退款", "年付"]},
  {"id": "T704", "amount": 4900, "customer": {"name": "云帆科技"}, "tags": ["发票", "退款"]},
  {"id": "T705", "amount": 0, "customer": {"name": "青禾网络"}}
]}
"""

tickets = json.loads(RAW)["tickets"]

cards = {}
for t in tickets:
    name = t["customer"]["name"]
    if name not in cards:
        cards[name] = {"count": 0, "fen": 0, "tags": set(), "last": ""}
    card = cards[name]
    card["count"] += 1
    card["fen"] += t["amount"]
    for tag in t.get("tags", []):
        card["tags"].add(tag)
    card["last"] = t["id"]

ranking = sorted([(card["fen"], name) for name, card in cards.items()], reverse=True)
for fen, name in ranking:
    card = cards[name]
    print(
        f"{name} {card['count']} 张 {fen // 100} 元 标签 {sorted(card['tags'])} 最近 {card['last']}"
    )
```

<div class="line-notes">

- `import json` 同前。
- `RAW = """` 题目里的五张工单。
- `tickets = json.loads(RAW)["tickets"]` 解析并取出列表。
- `cards = {}` 外层字典:客户名对应一张名片。
- `for t in tickets:` 遍历。
- `name = t["customer"]["name"]` 往里取两层拿到客户名。
- `if name not in cards:` 这个客户第一次出现?
- `cards[name] = {"count": 0, "fen": 0, "tags": set(), "last": ""}` 第一次就建一张空白名片:这是字典里装字典,里面的标签用集合自动去重。
- `card = cards[name]` 取出来起个名字,下面不用重复写 `cards[name]`。因为是同一个字典,改 `card` 就是改 `cards[name]`。
- `card["count"] += 1` 张数加 1。
- `card["fen"] += t["amount"]` 金额累加。
- `for tag in t.get("tags", []):` `T705` 没有 `tags`,`get` 给空列表。
- `card["tags"].add(tag)` 往集合里加,重复的自动合并。云帆科技的「退款」出现两次只留一个。
- `card["last"] = t["id"]` 每次都覆盖,循环结束留下最后一张。
- `ranking = sorted([(card["fen"], name) for name, card in cards.items()], reverse=True)` 推导式造 `(金额, 客户名)` 元组,按金额从大到小。
- `for fen, name in ranking:` 解包。
- `card = cards[name]` 用客户名回头取名片。
- `print(` 这条 `print` 被 Ruff 折成三行。
- `f"{name} {card['count']} 张 {fen // 100} 元 标签 {sorted(card['tags'])} 最近 {card['last']}"` 集合先 `sorted` 变成列表再打印,顺序才固定。

</div>

```text
$ uv run python part01/ex27_4_cards.py
北辰数据 1 张 468 元 标签 ['年付', '退款'] 最近 T703
云帆科技 2 张 348 元 标签 ['发票', '退款', '重复扣款'] 最近 T704
青禾网络 2 张 0 元 标签 [] 最近 T705
```

<div class="line-notes">

- `北辰数据 1 张 468 元 标签 ['年付', '退款'] 最近 T703` 只有 T703 一张,46800 分。
- `云帆科技 2 张 348 元 标签 ['发票', '退款', '重复扣款'] 最近 T704` T701 加 T704,29900 加 4900 是 34800 分。标签是两张的并集。
- `青禾网络 2 张 0 元 标签 [] 最近 T705` 两张金额都是 0,标签一个没有。

</div>

</details>

**验收标准:** 三段默写和小项目都能默写出来并跑通;练习 1 的新旧两版输出一致;练习 2 先自己写出八行答案再核对;练习 3 能说清五个坑各是哪一天的;练习 4 取嵌套值时有意识地想过「这一层会不会是 `None` 或缺键」。

## 名词解释

今天没有新术语,把这周的核心词放在一起,方便回头查。

| 名词 | 意思 |
| --- | --- |
| 容器 | 装着别的东西的东西:列表、元组、字典、集合都是。选哪种看你怎么用它 |
| 可变 / 不可变 | 建好以后能不能改。列表、字典、集合能改;元组、字符串、数字不能 |
| 哈希(hash) | 把一个东西算成一个数字用来快速查找。字典的键和集合的元素必须能算,所以必须不可变,列表不行 |
| 解包 | `a, b = pair` 一行把容器拆给几个名字,个数必须对得上 |
| 推导式 | `[x for x in xs if ...]`、`{k: v for ...}`、`{x for ...}`,一行造出新容器 |
| 查找表 | 用字典按键一步查到整条记录,如 `{t["id"]: t for t in tickets}` |
| 计数句式 | `d[k] = d.get(k, 0) + 1`,数每一类出现几次 |
| 浅拷贝 / 深拷贝 | `.copy()` 只复制最外层;`copy.deepcopy` 全部复制 |
| 嵌套 | 容器里套容器,取值一层接一层,每层先想它是字典还是列表、会不会是 `None` |
| 并行列表 | 两个靠「位置相同」对应的列表,容易错位,通常该换成字典或元组的列表 |

## 常见误区

**选容器时只看「能装」不看「怎么用」。** 什么都能塞进列表,但你要按工单号查就该是字典,要去重要比较就该是集合。动手前先问自己后面要对它做什么。

**用两个列表靠位置对应。** `ids[i]` 配 `amounts[i]`,哪天一个列表少了一项就整体错位且不报错。用 `dict(zip(...))` 或元组的列表。

**用列表数「有没有」,用集合数「几次」。** `x in 列表` 要从头扫,数据多了慢得离谱;集合会合并重复,数不了次数,要次数用计数字典。

**把「验证过」当成「看着对」。** 这周有两个坑(`.copy()` 的浅拷贝、`or` 吞掉 0)程序不报错,要对着手算的答案才看得出。输出打印出来后问一句:我拿什么验证它?

**对每一层都套 `.get`。** 键本来就该在的地方让它 `KeyError`,才能第一时间发现数据不对。只对确实「可能缺」的字段(`tags`)和「可能是 `null`」的字段(`assignee`)防。

**复习日只看不敲。** 这一页的价值在默写。合上文章从空文件开始写,卡住的地方就是真正没掌握的地方。

**默写时用复制粘贴「核对」。** 先自己写完、跑起来,再和文章逐行对,不一样的地方记进自己的错题表。

## 学习资料

### 文档与文章

- [Python 教程 · 数据结构](https://docs.python.org/zh-cn/3.12/tutorial/datastructures.html):中文,官方教程这一章把列表、元组、集合、字典和推导式一次讲完,正好是这周六天的内容,今天当作大复习读一遍。
- [标准库 · 映射类型 dict](https://docs.python.org/zh-cn/3.12/library/stdtypes.html#mapping-types-dict):中文,字典所有方法的权威说明,查 `get`、`items`、`update` 的细节用。
- [copy — 浅层和深层复制操作](https://docs.python.org/zh-cn/3.12/library/copy.html):中文,Day 26 的浅拷贝与深拷贝,几行就能读完。
- [Python 术语对照表](https://docs.python.org/zh-cn/3.12/glossary.html):中文,不认识的词(hashable、mutable、iterable)来这里查一句话定义。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1RK411L7zj&autoplay=0&high_quality=1" title="【39】区分列表、元组、集合和字典" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>橘色蝴蝶 · 【39】区分列表、元组、集合和字典 · 16 分钟,四种容器放在一起比较,和今天的知识地图对应,看完用自己的话再说一遍「什么时候用哪个」。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV18N41177f3&autoplay=0&high_quality=1" title="基础篇4.4.4 列表、元组、字典、集合的对比" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>明月讲解 · 基础篇4.4.4 列表、元组、字典、集合的对比 · 不到 3 分钟,一张对比表走一遍,适合默写前快速过一眼。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/W8KRzm-HUcc" title="Python Tutorial for Beginners 4: Lists, Tuples, and Sets" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Tutorial for Beginners 4: Lists, Tuples, and Sets · 英文,29 分钟,这周前半的内容,看列表、元组、集合的并排演示,字典另看他的下一集。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/h-zcj4DmqHk" title="Python Data Structures: When to Use List, Tuple, Set, Dict" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Data with Baraa · Python Data Structures: When to Use List, Tuple, Set, Dict · 英文,4 分钟,专讲「什么时候用哪个」,和今天的选容器四句话是同一个思路。</figcaption>
</figure>

### 书籍

- Eric Matthes《Python Crash Course》第 3 版,No Starch Press,2023(中译《Python编程:从入门到实践》)。第 4 章「Working with Lists」、第 6 章「Dictionaries」是这周的基础,第 6 章末尾的嵌套就是 Day 26。
- Luciano Ramalho《Fluent Python》第 2 版,O'Reilly,2022。第 2 章「An Array of Sequences」讲列表、元组、解包,第 3 章「Dictionaries and Sets」讲字典、集合和哈希,是之后很长时间都能回来翻的参考书,现在读个开头就好。

### 开源项目与代码

- [Asabeneh/30-Days-Of-Python](https://github.com/Asabeneh/30-Days-Of-Python):英文,第 5、7、8 天(`05_Day_Lists`、`07_Day_Sets`、`08_Day_Dictionaries`)的目录里有每种容器的练习题,可以拿来多做几道。

## 自测

1. 「按工单号一步查到整张工单」「去重」「一对一对按金额排序」,各自该用哪种容器?

<details><summary>答案</summary>

查整张工单用字典 `{t["id"]: t for t in tickets}`;去重用集合 `set(ids)`(要保序用 `list(dict.fromkeys(ids))`);一对一对排序用「元组的列表」`sorted([(fen, id), ...], reverse=True)`,元组按第一项先比。

</details>

2. 下面哪些能当字典的键:`"T1"`、`29900`、`("T1", "C023")`、`["T1"]`、`{"a": 1}`?为什么?

<details><summary>答案</summary>

前三个可以。字符串、整数、元组都不能改(元组里面的东西也都不能改的话),能算出哈希。列表和字典能改,不能当键,拿它们当键报 `TypeError: unhashable type`。

</details>

3. `a = [1, 2]`、`b = a`、`b.append(3)`,`a` 是什么?`ids = ids.append(x)` 又错在哪?

<details><summary>答案</summary>

`a` 是 `[1, 2, 3]`,`b = a` 只是多一个名字。`append` 返回 `None`,`ids = ids.append(x)` 之后 `ids` 变成了 `None`。

</details>

4. 昨天的工单号集合是 `y`,今天是 `t`。「新增」和「消失」分别怎么写?

<details><summary>答案</summary>

新增 `t - y`,消失 `y - t`。两个不一样,读出声:新增是今天有、昨天没有的。

</details>

5. `t["assignee"]["name"]` 报 `TypeError: 'NoneType' object is not subscriptable`,怎么改?

<details><summary>答案</summary>

`assignee` 这一层是 `None`(JSON 里的 `null`)。先取出来再判断:`a = t["assignee"]`,`who = a["name"] if a else "未分配"`。

</details>

6. **面试题**:Python 里 `list`、`tuple`、`set`、`dict` 的区别和各自的典型使用场景?`in` 判断成员时哪个最快,为什么?

<details><summary>答案</summary>

列表有序、可变、允许重复,按位置访问,适合一排要增删排序的数据;元组有序、不可变,适合固定的一组值、函数的多个返回值,能当字典的键;字典存键值对,键唯一且必须可哈希,按键查;集合无序、元素唯一、可哈希,适合去重和集合运算。`in` 判断:集合和字典用哈希,平均 O(1);列表要从头扫,O(n)。数据量大、要反复查「在不在」时,先把列表转成集合再查。

</details>

## 明天预告

Day 28 · 函数(一):def、参数和返回值。这一周你一直在写「一大段从上往下跑」的脚本,同一个判断(分类、抠金额、拆行)在好几个脚本里抄了又抄。明天开始把它们包成 `def`:给一段代码起个名字,从括号里接收材料,用 `return` 把结果交出来。Day 20 那个 90 行的 `daily_report.py` 会被拆成几个小函数,Day 21 留下的「并列时谁排前面」也会在明天解决。
