---
title: 'Day 26 · 嵌套数据:列表套字典,读懂一份 JSON 长什么样'
description: '接口返回的 JSON 不是一层,而是列表里套字典、字典里套列表。今天学会 data["tickets"][0]["customer"]["name"] 这样一层层往里取,认得四种取不到的报错,摸清一份陌生数据的结构,并用字典推导式一行造出「工单号到工单」的查找表。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'agent-zero']
series: 'agent-zero'
day: 26
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 25](/blog/agent-zero/day-025-sets/) 学了集合:`set(列表)` 一行去重,`&`、`|`、`-` 回答「两批数据哪里相同、哪里不同」,`list(dict.fromkeys(列表))` 保序去重,空集合要写 `set()`。小项目 `batch_diff.py` 里,你先用 `dict(zip(FIELDS, ...))` 把每行工单拆成字典,再放进列表,从列表里取字段。

那里的字典还很平:一张工单就是一层 `{"id": ..., "customer": "C023"}`。你在 DevTools 的 Network 面板里看到的接口返回不是这样的。一张工单里面有客户信息(又是一个对象),有一串标签(数组),有一串聊天记录(数组,每一项又是对象),还有可能是 `null` 的负责人。今天学的就是怎么读这种一层套一层的数据:Python 的写法,取不到时的四种报错,摸清陌生数据结构的办法,以及用字典推导式做查找表。

## 今天要解决的问题

学完今天,你应该能:

1. 读懂一份嵌套 JSON,对应到 Python 的类型:`{}` 是 dict,`[]` 是 list,`true/false/null` 是 `True/False/None`;会写 `data["tickets"][0]["customer"]["name"]` 这种一层层往里取的链,能拆成中间变量,也会往里改和加。
2. 认得取嵌套数据时最常见的四个报错,并说出各自的病因:`KeyError: 'tags'`(这条数据就是没有这个键)、`TypeError: list indices must be integers or slices, not str`(把列表当成了字典)、`TypeError: 'NoneType' object is not subscriptable`(中间有一层是 `null`)、`IndexError: list index out of range`(列表是空的)。
3. 用 `for key, value in d.items()` 加 `type(value).__name__` 摸清一份陌生数据的结构,并用 Day 25 的集合找出「不是每条记录都有的字段」。
4. 写出字典推导式 `{t["id"]: t for t in tickets}`,说清它和 `{k: v for k, v in d.items() if ...}` 的区别;知道 `d.copy()` 只复制最外一层。
5. 写出 `part01/ticket_tree.py`:读一份四张工单的嵌套 JSON,按套餐、标签、负责人、等待回复的客户出一页摘要。

预计用时:3 小时。读懂结构和往里取 60 分钟,四种报错和 `peek_structure.py` 40 分钟,字典推导式 30 分钟,小项目和练习 50 分钟。今天内容多,但每一步都只比上一步多一层。

前置:[Day 17](/blog/agent-zero/day-017-if-else/)(条件表达式)、[Day 21](/blog/agent-zero/day-021-lists/)(列表、下标、`[-1]`)、[Day 23](/blog/agent-zero/day-023-comprehensions/)(列表推导式)、[Day 24](/blog/agent-zero/day-024-dicts/)(字典、`.get`、`.items()`、计数句式)、[Day 25](/blog/agent-zero/day-025-sets/)(集合、`&` 和 `-`)。今天不调任何 API,花费 0 元。

今天要用一次 `json.loads(...)`,它把一段 JSON 文本变成 Python 的字典和列表。`json` 模块在 [Day 39](/blog/agent-zero/day-039-json/) 才正式讲,今天把它当成一个黑盒:给它一段文本,它还你 Python 数据。

学法提示:先对照文章逐行敲一遍(代码自己敲,不复制粘贴)并跑通;第二天合上文章,把 `peek_structure.py` 默写出来,先不管 JSON 数据本身,只写遍历那几行;然后做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先说清楚我是在哪跑的

输出是我 2026-10-23 在 2019 款 Intel MacBook Pro(macOS 14、zsh)上用演示家目录真跑的,家目录显示成 `/Users/你`,`~/agent-zero-lab` 接着 Day 25 的状态,`uv run python` 是 3.12.13,Ruff 是 0.17.2,basedpyright 是 standard 档。今天的脚本都放在 `part01/`,在仓库根目录用 `uv run python part01/文件名.py` 运行,不读键盘输入。

今天的数据用 `json.loads(...)` 读出来,不直接写成 Python 字典。原因是 basedpyright 看到字面量字典里「有字符串、有整数、有列表、有字典」混在一起,会推断出一个很死板的类型,你一往里取就画红线(Day 47 的 `TypedDict` 才是正解);`json.loads` 返回的类型是「什么都可能」(`Any`),编辑器就不再挑剔。类型标注从 [Day 45](/blog/agent-zero/day-045-type-hints-1/) 起才系统学,现在知道原因就行。

## 先看 JS 的嵌套对象

你在前端对这种数据太熟悉了:`res.data.tickets[0].customer.name`。先在 Node 里把今天要学的每个动作做一遍:

```text
$ node -e '
const raw = `{"total": 2, "tickets": [
  {"id": "T301", "customer": {"name": "云帆科技"}, "messages": [{"from": "customer", "text": "请退款"}], "assignee": {"name": "林舟"}},
  {"id": "T302", "customer": {"name": "青禾网络"}, "messages": [], "assignee": null}
]}`;
const data = JSON.parse(raw);
console.log(data.tickets[0].customer.name);
console.log(data.tickets[0].messages[0].text);
console.log(data.tickets[1].assignee?.name ?? "未分配");
console.log(data.tickets.length, data.tickets[1].messages.length);
const byId = Object.fromEntries(data.tickets.map((t) => [t.id, t]));
console.log(Object.keys(byId));
'
云帆科技
请退款
未分配
2 0
[ 'T301', 'T302' ]
```

<div class="line-notes">

- `{"total": 2, "tickets": [` 用反引号(模板字符串)写了一段 JSON **文本**,里面有两张工单。这就是接口返回的 body 原文。
- `{"id": "T301", "customer": {"name": "云帆科技"}, "messages": [{"from": "customer", "text": "请退款"}], "assignee": {"name": "林舟"}},` 第一张:客户是一个对象,消息是一个数组,数组里每项又是对象。
- `{"id": "T302", "customer": {"name": "青禾网络"}, "messages": [], "assignee": null}` 第二张:消息是空数组,负责人是 `null`。
- `const data = JSON.parse(raw);` 文本变成 JS 对象。Python 里对应 `json.loads(raw)`。
- `console.log(data.tickets[0].customer.name);` 一路点下去取到 `云帆科技`。Python 里每个点都要换成方括号加引号:`data["tickets"][0]["customer"]["name"]`。
- `console.log(data.tickets[0].messages[0].text);` 取第一条消息的文字:`请退款`。
- `console.log(data.tickets[1].assignee?.name ?? "未分配");` 第二张的负责人是 `null`,`?.` 遇到 `null` 就停下给出 `undefined`,`??` 补上 `未分配`。**Python 没有 `?.`**,要自己判断。
- `console.log(data.tickets.length, data.tickets[1].messages.length);` 两张工单,第二张的消息数是 0。
- `const byId = Object.fromEntries(data.tickets.map((t) => [t.id, t]));` 把数组变成「工单号 → 工单」的查找表:先 `map` 成 `[键, 值]` 对,再 `fromEntries`。Python 的字典推导式一行就能做。
- `console.log(Object.keys(byId));` 输出 `[ 'T301', 'T302' ]`。

</div>

| 想做的事 | JS | Python |
| --- | --- | --- |
| 文本变数据 | `JSON.parse(raw)` | `json.loads(raw)` |
| 往里取 | `data.tickets[0].customer.name` | `data["tickets"][0]["customer"]["name"]` |
| 遇到 `null` 就停 | `a?.b ?? "默认"` | 没有对应写法,要 `if` 判断 |
| 数组变查找表 | `Object.fromEntries(arr.map(...))` | `{t["id"]: t for t in tickets}` |
| 数据变漂亮的文本 | `JSON.stringify(x, null, 2)` | `json.dumps(x, indent=2, ensure_ascii=False)` |

## 一份工单 JSON 长什么样

JSON 里一共就六种东西,每一种在 Python 里都有对应:

| JSON | 例子 | Python |
| --- | --- | --- |
| 对象 object | `{"id": "T301"}` | `dict`,字典 |
| 数组 array | `["退款", "年付"]` | `list`,列表 |
| 字符串 | `"计费"` | `str` |
| 数字 | `29900`、`0.5` | `int`、`float` |
| 布尔 | `true`、`false` | `True`、`False`(首字母大写) |
| 空 | `null` | `None` |

注意两个小差别:JSON 的字符串**必须用双引号**;`true`/`false`/`null` 是小写,Python 里是 `True`/`False`/`None`。

今天的数据有四张工单,一张工单大致长这样:

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="data 是一个 dict,有 total 和 tickets 两个键;tickets 是一个 list,第 0 项是一个 dict;这个 dict 里 customer 是 dict,tags 是 list,messages 是 list,每一项又是带 from 和 text 的 dict;琥珀色高亮的路径是 data tickets 0 messages -1 from">
<rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="20" width="110" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="26" y="40" fill="var(--ink)">data: dict</text>
<line x1="126" y1="35" x2="160" y2="35" stroke="var(--ink-faint)"/>
<text x="166" y="40" fill="var(--ink-soft)">"total": 4</text>
<line x1="70" y1="50" x2="70" y2="82" stroke="var(--ink-faint)"/>
<line x1="70" y1="82" x2="100" y2="82" stroke="var(--ink-faint)"/>
<rect x="100" y="66" width="190" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="110" y="86" fill="var(--ink)">"tickets": list(4 项)</text>
<line x1="150" y1="96" x2="150" y2="128" stroke="var(--ink-faint)"/>
<line x1="150" y1="128" x2="180" y2="128" stroke="var(--ink-faint)"/>
<rect x="180" y="112" width="140" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="190" y="132" fill="var(--ink)">[0]: dict(8 个键)</text>
<text x="340" y="132" fill="var(--ink-soft)">id category amount ...</text>
<line x1="230" y1="142" x2="230" y2="190" stroke="var(--ink-faint)"/>
<line x1="230" y1="170" x2="260" y2="170" stroke="var(--ink-faint)"/>
<rect x="260" y="156" width="170" height="28" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="270" y="175" fill="var(--ink)">"customer": dict</text>
<text x="440" y="175" fill="var(--ink-soft)">id name plan</text>
<line x1="230" y1="206" x2="260" y2="206" stroke="var(--ink-faint)"/>
<rect x="260" y="192" width="170" height="28" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="270" y="211" fill="var(--ink)">"tags": list</text>
<text x="440" y="211" fill="var(--ink-soft)">"退款" "重复扣款"</text>
<line x1="230" y1="190" x2="230" y2="242" stroke="var(--ink-faint)"/>
<line x1="230" y1="242" x2="260" y2="242" stroke="var(--ink-faint)"/>
<rect x="260" y="228" width="170" height="28" rx="4" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="2"/>
<text x="270" y="247" fill="var(--ink)">"messages": list</text>
<line x1="345" y1="256" x2="345" y2="282" stroke="var(--ink-faint)"/>
<line x1="345" y1="282" x2="372" y2="282" stroke="var(--ink-faint)"/>
<rect x="372" y="268" width="190" height="28" rx="4" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="2"/>
<text x="382" y="287" fill="var(--ink)">[-1]: dict(from, text)</text>
<text x="16" y="318" fill="var(--ink-soft)">data["tickets"][0]["messages"][-1]["from"] = "agent"</text>
</g>
</svg>
<figcaption>字典用键往下走,列表用数字往下走。粗线框是最后那条取值路径经过的地方:dict 的键、list 的下标,交替出现。</figcaption>
</figure>

读嵌套数据的诀窍只有一条:**每走一步先问自己,现在手里是 dict 还是 list**。dict 用键(字符串)往下一层,list 用数字。

## 借 json.loads 把文本变成 Python 数据

新建 `part01/nested_load.py`。这份 JSON 文本是今天所有脚本共用的,先整份看一遍:

```python
# agent-zero-lab/part01/nested_load.py
import json

RAW = """
{"total": 4, "tickets": [
  {"id": "T301", "category": "计费", "amount": 29900, "refund_requested": true,
   "customer": {"id": "C023", "name": "云帆科技", "plan": "annual"},
   "tags": ["退款", "重复扣款"],
   "messages": [{"from": "customer", "text": "8月2日被重复扣款,请退款"},
                {"from": "agent", "text": "已转财务核实"}],
   "assignee": {"id": "A01", "name": "林舟"}},
  {"id": "T302", "category": "登录", "amount": 0, "refund_requested": false,
   "customer": {"id": "C007", "name": "青禾网络", "plan": "monthly"},
   "tags": [],
   "messages": [{"from": "customer", "text": "验证码收不到"}],
   "assignee": null},
  {"id": "T303", "category": "计费", "amount": 46800, "refund_requested": true,
   "customer": {"id": "C015", "name": "北辰数据", "plan": "annual"},
   "tags": ["退款", "年付"],
   "messages": [{"from": "customer", "text": "年付多扣了,要求退款"},
                {"from": "agent", "text": "请提供发票号"},
                {"from": "customer", "text": "INV-2026-0815"}],
   "assignee": {"id": "A02", "name": "周宁"}},
  {"id": "T304", "category": "功能", "amount": 0, "refund_requested": false,
   "customer": {"id": "C031", "name": "星河软件", "plan": "monthly"},
   "messages": [],
   "assignee": null}
]}
"""

data = json.loads(RAW)
print(type(RAW), type(data))
print(list(data))
print(data["total"], type(data["tickets"]), len(data["tickets"]))

first = data["tickets"][0]
print(type(first), list(first))
print(json.dumps(first, ensure_ascii=False, indent=2))
second = data["tickets"][1]
print(first["refund_requested"], first["assignee"] is None)
print(second["refund_requested"], second["assignee"])
```

<div class="line-notes">

- `import json` 引入标准库的 `json` 模块。`import` 的完整讲解在 [Day 32](/blog/agent-zero/day-032-modules/),你在 Day 10 已经见过 `import rich`;今天只用它的两个函数。
- `RAW = """` 三引号字符串(Day 15)可以直接换行,把一大段 JSON 文本装进变量 `RAW`。名字大写表示它是个常量。
- `{"total": 4, "tickets": [` 最外层是一个对象,有两个键:`total`(数字 4)和 `tickets`(数组)。
- `{"id": "T301", "category": "计费", "amount": 29900, "refund_requested": true,` 第一张工单的开头:工单号、类别、金额(分),`refund_requested` 是布尔 `true`。
- `"customer": {"id": "C023", "name": "云帆科技", "plan": "annual"},` `customer` 的值是**一个对象**:客户号、名字、套餐。这就是「字典里套字典」。
- `"tags": ["退款", "重复扣款"],` `tags` 的值是一个数组,两个字符串:「字典里套列表」。
- `"messages": [{"from": "customer", "text": "8月2日被重复扣款,请退款"},` `messages` 是数组,每一项又是一个对象:「列表里套字典」。这是第一条,客户发的。
- `{"from": "agent", "text": "已转财务核实"}],` 第二条,客服回的。
- `"assignee": {"id": "A01", "name": "林舟"}},` 负责人是一个对象。最后的 `}` 结束这张工单。
- `{"id": "T302", "category": "登录", "amount": 0, "refund_requested": false,` 第二张,`false` 小写。
- `"tags": [],` 标签是**空数组**:有这个键,但里面没东西。
- `"assignee": null},` 负责人是 `null`:还没人接。
- `{"id": "T303", "category": "计费", "amount": 46800, "refund_requested": true,` 第三张,三条消息(最后一条是客户发的,在等回复)。
- `{"id": "T304", "category": "功能", "amount": 0, "refund_requested": false,` 第四张:这一张**没有 `tags` 这个键**(和 T302 的空数组不一样,后面的报错会用到),消息数组是空的,负责人是 `null`。
- `"messages": [],` T304 的消息是空数组。
- `"assignee": null}` T304 负责人 `null`,结束。
- `data = json.loads(RAW)` `loads` 的 s 是 string:把 JSON 文本解析成 Python 数据。结果是一个字典,`data`。
- `print(type(RAW), type(data))` `RAW` 是 `str`,`data` 是 `dict`:文本变成了结构。
- `print(list(data))` `list(字典)` 得到键(Day 24):`['total', 'tickets']`。
- `print(data["total"], type(data["tickets"]), len(data["tickets"]))` `total` 是 4;`data["tickets"]` 是一个 `list`,有 4 项。
- `first = data["tickets"][0]` 往里走两步:先取键 `tickets` 得到列表,再取下标 0 得到第一张工单(一个字典),放进 `first`。
- `print(type(first), list(first))` 第一张工单是 `dict`,八个键。
- `print(json.dumps(first, ensure_ascii=False, indent=2))` `dumps` 是 `loads` 的反向:把 Python 数据变回 JSON 文本。`indent=2` 缩进两格,方便人看;`ensure_ascii=False` 让中文直接显示(默认会变成 `云` 这种转义)。今天只借它当「漂亮打印」用。
- `second = data["tickets"][1]` 第二张工单。
- `print(first["refund_requested"], first["assignee"] is None)` 第一张:`refund_requested` 是 `True`,`assignee` 不是 `None`,所以 `is None` 是 `False`。
- `print(second["refund_requested"], second["assignee"])` 第二张:`False` 和 `None`。

</div>

```text
$ cd ~/agent-zero-lab
$ uv run python part01/nested_load.py
<class 'str'> <class 'dict'>
['total', 'tickets']
4 <class 'list'> 4
<class 'dict'> ['id', 'category', 'amount', 'refund_requested', 'customer', 'tags', 'messages', 'assignee']
{
  "id": "T301",
  "category": "计费",
  "amount": 29900,
  "refund_requested": true,
  "customer": {
    "id": "C023",
    "name": "云帆科技",
    "plan": "annual"
  },
  "tags": [
    "退款",
    "重复扣款"
  ],
  "messages": [
    {
      "from": "customer",
      "text": "8月2日被重复扣款,请退款"
    },
    {
      "from": "agent",
      "text": "已转财务核实"
    }
  ],
  "assignee": {
    "id": "A01",
    "name": "林舟"
  }
}
True False
False None
```

<div class="line-notes">

- `<class 'str'> <class 'dict'>` 同一份内容,先是字符串,解析后是字典。
- `['total', 'tickets']` 最外层两个键。
- `4 <class 'list'> 4` `total` 是 4,`tickets` 是一个有 4 项的列表。
- `<class 'dict'> ['id', 'category', 'amount', 'refund_requested', 'customer', 'tags', 'messages', 'assignee']` 第一张工单是字典,八个键,顺序和文本里一致。
- `"refund_requested": true,` 注意这是 `json.dumps` 打印的 JSON 文本,所以是小写 `true`;下面 Python 自己的 `print` 会是大写 `True`。
- `"customer": {` 嵌套的对象被缩进成下一层。
- `"tags": [` 数组展开成每行一个元素。
- `"messages": [` 每条消息又是一个小对象。
- `"assignee": {` 负责人对象。
- `True False` 第一张的 `refund_requested` 是 `True`,`assignee` 不是 `None`。
- `False None` 第二张:`False` 和 `None`。**JSON 里的 `null` 到了 Python 变成了 `None`。**

</div>

把 `loads` 想成「接口返回 body 之后你在 JS 里调的 `res.json()`」就行,它做的事一模一样。

## 一层一层往里取

新建 `part01/nested_access.py`。数据和 `nested_load.py` 里的 `RAW` 完全一样,下面的代码块里也带着它:

```python
# agent-zero-lab/part01/nested_access.py
import json

RAW = """
{"total": 4, "tickets": [
  {"id": "T301", "category": "计费", "amount": 29900, "refund_requested": true,
   "customer": {"id": "C023", "name": "云帆科技", "plan": "annual"},
   "tags": ["退款", "重复扣款"],
   "messages": [{"from": "customer", "text": "8月2日被重复扣款,请退款"},
                {"from": "agent", "text": "已转财务核实"}],
   "assignee": {"id": "A01", "name": "林舟"}},
  {"id": "T302", "category": "登录", "amount": 0, "refund_requested": false,
   "customer": {"id": "C007", "name": "青禾网络", "plan": "monthly"},
   "tags": [],
   "messages": [{"from": "customer", "text": "验证码收不到"}],
   "assignee": null},
  {"id": "T303", "category": "计费", "amount": 46800, "refund_requested": true,
   "customer": {"id": "C015", "name": "北辰数据", "plan": "annual"},
   "tags": ["退款", "年付"],
   "messages": [{"from": "customer", "text": "年付多扣了,要求退款"},
                {"from": "agent", "text": "请提供发票号"},
                {"from": "customer", "text": "INV-2026-0815"}],
   "assignee": {"id": "A02", "name": "周宁"}},
  {"id": "T304", "category": "功能", "amount": 0, "refund_requested": false,
   "customer": {"id": "C031", "name": "星河软件", "plan": "monthly"},
   "messages": [],
   "assignee": null}
]}
"""

data = json.loads(RAW)
tickets = data["tickets"]

print(tickets[0]["id"])
print(tickets[0]["customer"]["name"])
print(tickets[0]["messages"][0]["text"])
print(tickets[0]["messages"][-1]["from"])
print(tickets[2]["tags"][1], len(tickets[2]["messages"]))

customer = tickets[2]["customer"]
print(customer)
print(customer["plan"])

for t in tickets:
    n = len(t["messages"])
    print(t["id"], t["customer"]["name"], f"{n} 条消息")

for m in tickets[2]["messages"]:
    print(f"  [{m['from']}] {m['text']}")

tickets[0]["customer"]["plan"] = "monthly"
tickets[0]["tags"].append("已核实")
tickets[1]["assignee"] = {"id": "A03", "name": "吴越"}
print(tickets[0]["customer"], tickets[0]["tags"])
print(tickets[1]["assignee"]["name"])
```

<div class="line-notes">

- `import json` 同上。
- `RAW = """` 同 `nested_load.py` 里那份四张工单的 JSON,这里不再逐行解释。
- `data = json.loads(RAW)` 解析成字典。
- `tickets = data["tickets"]` 先把 `tickets` 这一层取出来,起个名字。以后不用每次都写 `data["tickets"]`,**给中间一层起名字是读嵌套数据最好用的习惯**。
- `print(tickets[0]["id"])` 列表取第 0 项(数字),字典取 `id`(键):`T301`。
- `print(tickets[0]["customer"]["name"])` 三步:列表第 0 项 → 字典的 `customer` → 字典的 `name`。`云帆科技`。
- `print(tickets[0]["messages"][0]["text"])` 四步:列表第 0 项 → `messages`(列表) → 第 0 条(字典) → `text`。`8月2日被重复扣款,请退款`。
- `print(tickets[0]["messages"][-1]["from"])` 下标 `-1` 是最后一条(Day 21):最后一条是 `agent`。
- `print(tickets[2]["tags"][1], len(tickets[2]["messages"]))` 第三张工单(下标 2)的第二个标签 `年付`,以及它有几条消息 `3`。`len` 可以直接套在中间结果上。
- `customer = tickets[2]["customer"]` 把中间一层拿出来放进变量。`customer` 现在就是那个客户字典本身。
- `print(customer)` 输出整个字典 `{'id': 'C015', 'name': '北辰数据', 'plan': 'annual'}`。
- `print(customer["plan"])` 从变量里继续取:`annual`。这和 `tickets[2]["customer"]["plan"]` 是一回事,只是分成了两步。
- `for t in tickets:` 遍历列表:每圈的 `t` 是一张工单(字典)。
- `n = len(t["messages"])` 这张工单有几条消息。
- `print(t["id"], t["customer"]["name"], f"{n} 条消息")` 一行:工单号、客户名、消息数。
- `for m in tickets[2]["messages"]:` 遍历第三张的三条消息,每圈 `m` 是一个小字典。
- `print(f"  [{m['from']}] {m['text']}")` f-string 里面已经用了双引号,里面的键就得用**单引号**:`m['from']`(Python 3.12 起允许同种引号,但为了和老版本一致,今天保持不同)。
- `tickets[0]["customer"]["plan"] = "monthly"` 往里改:取到最里面那个字典,给 `plan` 赋新值。等号左边可以是一整条取值链。
- `tickets[0]["tags"].append("已核实")` 取到 `tags` 这个列表,调它的 `append`(Day 21)。
- `tickets[1]["assignee"] = {"id": "A03", "name": "吴越"}` 把 `None` 换成一个新字典,整个值都换了。
- `print(tickets[0]["customer"], tickets[0]["tags"])` 看到改动生效:套餐变成 `monthly`,标签多了 `已核实`。
- `print(tickets[1]["assignee"]["name"])` 第二张现在有负责人了:`吴越`。

</div>

```text
$ uv run python part01/nested_access.py
T301
云帆科技
8月2日被重复扣款,请退款
agent
年付 3
{'id': 'C015', 'name': '北辰数据', 'plan': 'annual'}
annual
T301 云帆科技 2 条消息
T302 青禾网络 1 条消息
T303 北辰数据 3 条消息
T304 星河软件 0 条消息
  [customer] 年付多扣了,要求退款
  [agent] 请提供发票号
  [customer] INV-2026-0815
{'id': 'C023', 'name': '云帆科技', 'plan': 'monthly'} ['退款', '重复扣款', '已核实']
吴越
```

<div class="line-notes">

- `T301` 第一张的工单号。
- `云帆科技` 客户名。
- `8月2日被重复扣款,请退款` 第一条消息。
- `agent` 最后一条消息是客服发的。
- `年付 3` 第三张的第二个标签,以及它的消息数 3。
- `{'id': 'C015', 'name': '北辰数据', 'plan': 'annual'}` 客户字典整个。
- `annual` 套餐。
- `T301 云帆科技 2 条消息` 四行遍历输出:T301 两条。
- `T302 青禾网络 1 条消息` T302 一条。
- `T303 北辰数据 3 条消息` T303 三条。
- `T304 星河软件 0 条消息` T304 一条都没有。
- `  [customer] 年付多扣了,要求退款` 第三张的第一条,客户发的。
- `  [agent] 请提供发票号` 第二条,客服发的。
- `  [customer] INV-2026-0815` 第三条,客户发的:最后一条是客户,说明在等回复。
- `{'id': 'C023', 'name': '云帆科技', 'plan': 'monthly'} ['退款', '重复扣款', '已核实']` 改动生效。
- `吴越` 新分配的负责人。

</div>

## 取不到的四种情况

嵌套越深,中途「那一层不是你想的样子」的机会就越多。四种最常见的情况,每种造一次。

### 键不存在:KeyError

新建 `part01/nested_err_key.py`(数据缩成一行,方便看):

```python
# agent-zero-lab/part01/nested_err_key.py
import json

t = json.loads('{"id": "T304", "customer": {"name": "星河软件"}}')
print(t["id"], t["customer"]["name"])
print(t["tags"])
```

<div class="line-notes">

- `import json` 引入 `json`。
- `t = json.loads('{"id": "T304", "customer": {"name": "星河软件"}}')` 一张只有两个键的工单:没有 `tags`。外层用单引号包,里面的 JSON 用双引号,不用转义。
- `print(t["id"], t["customer"]["name"])` 这两个键在,正常。
- `print(t["tags"])` 这个键不在。

</div>

```text
$ uv run python part01/nested_err_key.py
T304 星河软件
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/nested_err_key.py", line 6, in <module>
    print(t["tags"])
          ~^^^^^^^^
KeyError: 'tags'
```

<div class="line-notes">

- `T304 星河软件` 前面的正常取值。
- `File "/Users/你/agent-zero-lab/part01/nested_err_key.py", line 6, in <module>` 第 6 行出错。
- `print(t["tags"])` 出错的行,`~^^^^^^^` 指着 `["tags"]`。
- `KeyError: 'tags'` Day 24 的老朋友。嵌套数据里它格外常见:同一类记录,有的有这个字段,有的没有(API 返回里「没有值就不给字段」很常见)。

</div>

修法在 Day 24 学过:`t.get("tags", [])`,没有就当空列表。

### 把列表当成字典:TypeError

新建 `part01/nested_err_type.py`:

```python
# agent-zero-lab/part01/nested_err_type.py
import json

data = json.loads('{"total": 2, "tickets": [{"id": "T301"}, {"id": "T302"}]}')
print(data["total"], len(data["tickets"]))
print(data["tickets"]["id"])
```

<div class="line-notes">

- `import json` 引入 `json`。
- `data = json.loads('{"total": 2, "tickets": [{"id": "T301"}, {"id": "T302"}]}')` 一份两张工单的小数据。
- `print(data["total"], len(data["tickets"]))` 正常:`2 2`。
- `print(data["tickets"]["id"])` `data["tickets"]` 是**列表**,却用键 `"id"` 去取。想拿工单号应该先选一张:`data["tickets"][0]["id"]`。

</div>

```text
$ uv run python part01/nested_err_type.py
2 2
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/nested_err_type.py", line 6, in <module>
    print(data["tickets"]["id"])
          ~~~~~~~~~~~~~~~^^^^^^
TypeError: list indices must be integers or slices, not str
```

<div class="line-notes">

- `2 2` 正常的一行。
- `File "/Users/你/agent-zero-lab/part01/nested_err_type.py", line 6, in <module>` 第 6 行。
- `print(data["tickets"]["id"])` 出错的行,`~~~~~~~~~~~~~~~^^^^^^` 的 `^` 指在最后一个 `["id"]` 上。
- `TypeError: list indices must be integers or slices, not str` 列表的下标必须是整数或切片,你给了字符串。读这条报错先问:这一层到底是 list 还是 dict?

</div>

### 中间有一层是 null:NoneType

新建 `part01/nested_err_none.py`:

```python
# agent-zero-lab/part01/nested_err_none.py
import json

t = json.loads('{"id": "T302", "assignee": null}')
print(t["id"], t["assignee"])
print(t["assignee"]["name"])
```

<div class="line-notes">

- `import json` 引入 `json`。
- `t = json.loads('{"id": "T302", "assignee": null}')` 负责人是 `null`。
- `print(t["id"], t["assignee"])` `T302 None`。
- `print(t["assignee"]["name"])` 对 `None` 再取 `["name"]`。

</div>

```text
$ uv run python part01/nested_err_none.py
T302 None
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/nested_err_none.py", line 6, in <module>
    print(t["assignee"]["name"])
          ~~~~~~~~~~~~~^^^^^^^^
TypeError: 'NoneType' object is not subscriptable
```

<div class="line-notes">

- `T302 None` `null` 变成了 `None`。
- `File "/Users/你/agent-zero-lab/part01/nested_err_none.py", line 6, in <module>` 第 6 行。
- `print(t["assignee"]["name"])` 出错的行。
- `TypeError: 'NoneType' object is not subscriptable` `NoneType` 是 `None` 的类型,「not subscriptable」是「不能用方括号取」。这是 JS 里 `Cannot read properties of null (reading 'name')` 的 Python 版,也是处理 API 数据时最常见的崩溃。

</div>

### 列表是空的:IndexError

新建 `part01/nested_err_index.py`:

```python
# agent-zero-lab/part01/nested_err_index.py
import json

t = json.loads('{"id": "T304", "messages": []}')
print(t["id"], t["messages"], len(t["messages"]))
print(t["messages"][0]["text"])
```

<div class="line-notes">

- `import json` 引入 `json`。
- `t = json.loads('{"id": "T304", "messages": []}')` 消息是空数组。
- `print(t["id"], t["messages"], len(t["messages"]))` 输出 `T304 [] 0`。
- `print(t["messages"][0]["text"])` 取空列表的第 0 项。

</div>

```text
$ uv run python part01/nested_err_index.py
T304 [] 0
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/nested_err_index.py", line 6, in <module>
    print(t["messages"][0]["text"])
          ~~~~~~~~~~~~~^^^
IndexError: list index out of range
```

<div class="line-notes">

- `T304 [] 0` 空列表,长度 0。
- `File "/Users/你/agent-zero-lab/part01/nested_err_index.py", line 6, in <module>` 第 6 行。
- `print(t["messages"][0]["text"])` 出错的行,`^^^` 指在 `[0]` 上。
- `IndexError: list index out of range` 下标超出范围(Day 21)。空列表连第 0 项都没有。`[-1]` 对空列表同样会报这个错。

</div>

### 一次性防住:nested_safe.py

四种情况放在一起,用前面学的工具各挡一下。新建 `part01/nested_safe.py`:

```python
# agent-zero-lab/part01/nested_safe.py
import json

RAW = """
{"total": 4, "tickets": [
  {"id": "T301", "category": "计费", "amount": 29900, "refund_requested": true,
   "customer": {"id": "C023", "name": "云帆科技", "plan": "annual"},
   "tags": ["退款", "重复扣款"],
   "messages": [{"from": "customer", "text": "8月2日被重复扣款,请退款"},
                {"from": "agent", "text": "已转财务核实"}],
   "assignee": {"id": "A01", "name": "林舟"}},
  {"id": "T302", "category": "登录", "amount": 0, "refund_requested": false,
   "customer": {"id": "C007", "name": "青禾网络", "plan": "monthly"},
   "tags": [],
   "messages": [{"from": "customer", "text": "验证码收不到"}],
   "assignee": null},
  {"id": "T303", "category": "计费", "amount": 46800, "refund_requested": true,
   "customer": {"id": "C015", "name": "北辰数据", "plan": "annual"},
   "tags": ["退款", "年付"],
   "messages": [{"from": "customer", "text": "年付多扣了,要求退款"},
                {"from": "agent", "text": "请提供发票号"},
                {"from": "customer", "text": "INV-2026-0815"}],
   "assignee": {"id": "A02", "name": "周宁"}},
  {"id": "T304", "category": "功能", "amount": 0, "refund_requested": false,
   "customer": {"id": "C031", "name": "星河软件", "plan": "monthly"},
   "messages": [],
   "assignee": null}
]}
"""

data = json.loads(RAW)

for t in data["tickets"]:
    assignee = t["assignee"]
    who = assignee["name"] if assignee else "未分配"

    tags = t.get("tags", [])
    messages = t["messages"]
    last = messages[-1]["text"] if messages else "(没有消息)"

    print(t["id"], who, tags, last)
```

<div class="line-notes">

- `import json` 引入 `json`。
- `RAW = """` 同样的四张工单,不再解释。
- `data = json.loads(RAW)` 解析。
- `for t in data["tickets"]:` 遍历四张工单。
- `assignee = t["assignee"]` 这个键四张都有(值可能是 `None`),所以直接用方括号。
- `who = assignee["name"] if assignee else "未分配"` 防 `NoneType`:条件表达式(Day 17)。`assignee` 是字典(非空)当真,取名字;是 `None` 当假,用 `未分配`。这就是 Python 里的「`?.` 加 `??`」。
- `tags = t.get("tags", [])` 防 `KeyError`:这个键**可能没有**,用 `.get` 并给空列表做默认值。
- `messages = t["messages"]` 这个键四张都有,但列表可能是空的。
- `last = messages[-1]["text"] if messages else "(没有消息)"` 防 `IndexError`:空列表当假,不去取 `[-1]`。
- `print(t["id"], who, tags, last)` 打印。

</div>

```text
$ uv run python part01/nested_safe.py
T301 林舟 ['退款', '重复扣款'] 已转财务核实
T302 未分配 [] 验证码收不到
T303 周宁 ['退款', '年付'] INV-2026-0815
T304 未分配 [] (没有消息)
```

<div class="line-notes">

- `T301 林舟 ['退款', '重复扣款'] 已转财务核实` 全都有。
- `T302 未分配 [] 验证码收不到` 负责人 `null` 被换成「未分配」,标签是空列表。
- `T303 周宁 ['退款', '年付'] INV-2026-0815` 最后一条是客户发的发票号。
- `T304 未分配 [] (没有消息)` 没有 `tags` 键、`null` 负责人、空消息,三种情况一次全防住,没有任何报错。

</div>

原则和 Day 24 一样:**键确定在就用方括号,可能不在才用 `.get()` 和判断**。不要为了不崩给每一层都加防护,那样真有数据问题时你会看不出来。

## 摸清一份陌生数据的结构

读别人的 API、读模型返回的 JSON,第一件事是弄清「这份数据长什么样」:哪些键、各是什么类型、是不是每条记录都有。不用一眼看完几百行,几行代码就能列出提纲。新建 `part01/peek_structure.py`:

```python
# agent-zero-lab/part01/peek_structure.py
import json

RAW = """
{"total": 4, "tickets": [
  {"id": "T301", "category": "计费", "amount": 29900, "refund_requested": true,
   "customer": {"id": "C023", "name": "云帆科技", "plan": "annual"},
   "tags": ["退款", "重复扣款"],
   "messages": [{"from": "customer", "text": "8月2日被重复扣款,请退款"},
                {"from": "agent", "text": "已转财务核实"}],
   "assignee": {"id": "A01", "name": "林舟"}},
  {"id": "T302", "category": "登录", "amount": 0, "refund_requested": false,
   "customer": {"id": "C007", "name": "青禾网络", "plan": "monthly"},
   "tags": [],
   "messages": [{"from": "customer", "text": "验证码收不到"}],
   "assignee": null},
  {"id": "T303", "category": "计费", "amount": 46800, "refund_requested": true,
   "customer": {"id": "C015", "name": "北辰数据", "plan": "annual"},
   "tags": ["退款", "年付"],
   "messages": [{"from": "customer", "text": "年付多扣了,要求退款"},
                {"from": "agent", "text": "请提供发票号"},
                {"from": "customer", "text": "INV-2026-0815"}],
   "assignee": {"id": "A02", "name": "周宁"}},
  {"id": "T304", "category": "功能", "amount": 0, "refund_requested": false,
   "customer": {"id": "C031", "name": "星河软件", "plan": "monthly"},
   "messages": [],
   "assignee": null}
]}
"""

data = json.loads(RAW)
tickets = data["tickets"]

print("顶层:")
for key, value in data.items():
    print(f"  {key}: {type(value).__name__}")

print("第一张工单:")
for key, value in tickets[0].items():
    kind = type(value).__name__
    if kind == "list":
        print(f"  {key}: list,{len(value)} 项")
    elif kind == "dict":
        print(f"  {key}: dict,键 {list(value)}")
    else:
        print(f"  {key}: {kind} = {value}")

key_sets = [set(t) for t in tickets]
common = key_sets[0]
all_keys = set()
for ks in key_sets:
    common = common & ks
    all_keys = all_keys | ks
print("每张工单都有的键:", sorted(common))
print("不是每张都有的键:", sorted(all_keys - common))
```

<div class="line-notes">

- `import json` 引入 `json`。
- `RAW = """` 同样的四张工单。
- `data = json.loads(RAW)` 解析。
- `tickets = data["tickets"]` 工单列表。
- `print("顶层:")` 标题。
- `for key, value in data.items():` 遍历最外层字典的键值对(Day 24 的 `.items()` 加解包)。
- `print(f"  {key}: {type(value).__name__}")` `type(value)` 是类型对象,`.__name__` 是它的名字字符串:`int`、`list`。输出 `total: int`、`tickets: list`。
- `print("第一张工单:")` 下一段标题。
- `for key, value in tickets[0].items():` 遍历第一张工单的八个键值对。
- `kind = type(value).__name__` 当前这个值的类型名字。
- `if kind == "list":` 是列表:不展开内容,只说有几项。
- `print(f"  {key}: list,{len(value)} 项")` 比如 `tags: list,2 项`。
- `elif kind == "dict":` 是字典:只列出它的键。
- `print(f"  {key}: dict,键 {list(value)}")` 比如 `customer: dict,键 ['id', 'name', 'plan']`。
- `else:` 剩下的是普通值(字符串、数字、布尔)。
- `print(f"  {key}: {kind} = {value}")` 打印类型和值:`amount: int = 29900`、`refund_requested: bool = True`。
- `key_sets = [set(t) for t in tickets]` 对每张工单,`set(t)` 取出它的**所有键**组成集合(`set(字典)` 得到键的集合,和 `list(字典)` 同理)。四张就得到四个键集合。
- `common = key_sets[0]` 先把第一张的键集合当作「大家都有的」。
- `all_keys = set()` 「出现过的所有键」从空集合开始。
- `for ks in key_sets:` 遍历四个键集合。
- `common = common & ks` Day 25 的交集:每过一张,只留下**这一张也有**的键。
- `all_keys = all_keys | ks` 并集:出现过的键越攒越多。
- `print("每张工单都有的键:", sorted(common))` 交集的最终结果。
- `print("不是每张都有的键:", sorted(all_keys - common))` 差集:出现过但不是每张都有的。

</div>

```text
$ uv run python part01/peek_structure.py
顶层:
  total: int
  tickets: list
第一张工单:
  id: str = T301
  category: str = 计费
  amount: int = 29900
  refund_requested: bool = True
  customer: dict,键 ['id', 'name', 'plan']
  tags: list,2 项
  messages: list,2 项
  assignee: dict,键 ['id', 'name']
每张工单都有的键: ['amount', 'assignee', 'category', 'customer', 'id', 'messages', 'refund_requested']
不是每张都有的键: ['tags']
```

<div class="line-notes">

- `顶层:` 第一段的标题。
- `  total: int` 最外层有 `total`,整数。
- `  tickets: list` 和 `tickets`,列表。
- `第一张工单:` 第二段的标题。
- `  id: str = T301` 工单号是字符串。
- `  category: str = 计费` 类别。
- `  amount: int = 29900` 金额是整数,不是字符串。
- `  refund_requested: bool = True` 布尔,`true` 变成了 `True`。
- `  customer: dict,键 ['id', 'name', 'plan']` 客户是字典,里面三个键。
- `  tags: list,2 项` 标签是列表,两项。
- `  messages: list,2 项` 消息是列表,两项。
- `  assignee: dict,键 ['id', 'name']` 负责人是字典。
- `每张工单都有的键: ['amount', 'assignee', 'category', 'customer', 'id', 'messages', 'refund_requested']` 四张都有的七个键(按字母排序)。
- `不是每张都有的键: ['tags']` 只有 `tags` 不是每张都有:T304 没有。你在读陌生数据的时候,**这一行最值钱**,它告诉你哪个字段取之前必须先防一手。

</div>

这两个循环只往里看了一层(`customer` 里面是什么没展开)。想一路展开到底,需要「函数调用自己」的递归写法,等 Day 28 学了函数再说;今天手动展开一两层就够认清数据。

## 字典推导式:一行造字典

Day 23 学了列表推导式,字典也有对应的:**花括号,表达式写成 `键: 值`**。新建 `part01/dict_comp.py`:

```python
# agent-zero-lab/part01/dict_comp.py
counts = {"计费": 6, "登录": 2, "功能": 1, "账号": 0}

kept = {category: n for category, n in counts.items() if n > 0}
print(kept)

fens = {category: n * 100 for category, n in kept.items()}
print(fens)

swapped = {n: category for category, n in kept.items()}
print(swapped)

ids = ["T301", "T302", "T303"]
amounts = [29900, 0, 46800]
amount_by_id = {ticket_id: fen for ticket_id, fen in zip(ids, amounts)}
print(amount_by_id)

tickets = [
    {"id": "T301", "customer": "C023"},
    {"id": "T302", "customer": "C007"},
    {"id": "T310", "customer": "C023"},
]
by_id = {t["id"]: t for t in tickets}
print(by_id["T302"]["customer"], len(by_id))

last_by_customer = {t["customer"]: t["id"] for t in tickets}
print(last_by_customer, len(last_by_customer))
```

<div class="line-notes">

- `counts = {"计费": 6, "登录": 2, "功能": 1, "账号": 0}` Day 24 的类别计数,有一个类别是 0。
- `kept = {category: n for category, n in counts.items() if n > 0}` 字典推导式。从 `for` 往前读:遍历 `counts.items()`,每圈解包成 `category` 和 `n`;`if n > 0` 过滤掉 0;前面的 `category: n` 是新字典的一对。**这就是 Day 24 `dict_mutate_fixed.py` 里「另建一个新字典」那几行的一行写法。**
- `print(kept)` `{'计费': 6, '登录': 2, '功能': 1}`,`账号` 被筛掉。
- `fens = {category: n * 100 for category, n in kept.items()}` 保持键不变,值做变换:每个张数乘 100(只是演示变换值)。
- `print(fens)` `{'计费': 600, '登录': 200, '功能': 100}`。
- `swapped = {n: category for category, n in kept.items()}` 键和值互换:张数当键,类别当值。**注意**:如果两个类别张数相同,后面的会覆盖前面的,互换之后键会变少。这里 6、2、1 各不相同所以安全。
- `print(swapped)` `{6: '计费', 2: '登录', 1: '功能'}`。
- `ids = ["T301", "T302", "T303"]` 三个工单号。
- `amounts = [29900, 0, 46800]` 对应的三个金额。
- `amount_by_id = {ticket_id: fen for ticket_id, fen in zip(ids, amounts)}` 和 `zip`(Day 22)配合:两个列表按位置配对,造成「工单号 → 金额」。它的效果和 `dict(zip(ids, amounts))` 一样,推导式的好处是中间可以加 `if` 或变形。
- `print(amount_by_id)` `{'T301': 29900, 'T302': 0, 'T303': 46800}`。
- `tickets = [` 三张简化的工单,每张两个键。
- `{"id": "T310", "customer": "C023"},` 注意 `T301` 和 `T310` 是同一个客户 `C023`。
- `by_id = {t["id"]: t for t in tickets}` **最常用的一种**:列表变查找表。键是每张工单的 `id`,值是整张工单。这就是开头 JS 里 `Object.fromEntries(arr.map(...))` 的 Python 版。
- `print(by_id["T302"]["customer"], len(by_id))` 用工单号一步取到工单,再取客户:`C007`;查找表有 3 项。
- `last_by_customer = {t["customer"]: t["id"] for t in tickets}` 如果键**不唯一**会怎样:`C023` 出现了两次,后面的 `T310` 覆盖前面的 `T301`。
- `print(last_by_customer, len(last_by_customer))` 只有 2 项:`{'C023': 'T310', 'C007': 'T302'}`。**字典推导式不报错,只是默默丢掉了前面的数据**,键不唯一时要警惕。

</div>

```text
$ uv run python part01/dict_comp.py
{'计费': 6, '登录': 2, '功能': 1}
{'计费': 600, '登录': 200, '功能': 100}
{6: '计费', 2: '登录', 1: '功能'}
{'T301': 29900, 'T302': 0, 'T303': 46800}
C007 3
{'C023': 'T310', 'C007': 'T302'} 2
```

<div class="line-notes">

- `{'计费': 6, '登录': 2, '功能': 1}` 过滤掉 0。
- `{'计费': 600, '登录': 200, '功能': 100}` 值乘 100。
- `{6: '计费', 2: '登录', 1: '功能'}` 键值互换。
- `{'T301': 29900, 'T302': 0, 'T303': 46800}` zip 配对。
- `C007 3` 查找表取 `T302` 的客户,共 3 项。
- `{'C023': 'T310', 'C007': 'T302'} 2` 键重复,三张工单变成两项,`T301` 丢了。

</div>

### 另一个坑:copy() 只复制最外面一层

Day 24 说想要独立副本写 `d.copy()`。对**平**的字典没错;对嵌套的字典有个陷阱,留到练习 3 里亲手踩一次。先记住结论:`copy()` 只复制最外一层,里面套着的字典、列表仍然是**同一个**,改副本里的内层,原件也变了。

## 小项目:一份嵌套 JSON 的摘要页

场景:客服系统接口返回了四张工单的 JSON(就是今天用的那份)。组长想要一页摘要:

1. 总数对不对(`total` 和实际条数是否一致);
2. 按套餐(annual/monthly)数工单;
3. 标签频次(注意不是每张都有 `tags`);
4. 申请退款的工单金额合计;
5. 还没人接的工单、客户在等回复的工单;
6. 每张工单的消息数,以及消息最多的是哪张;
7. 每张工单一行:工单号、客户、类别、负责人。

新建 `part01/ticket_tree.py`:

```python
# agent-zero-lab/part01/ticket_tree.py
import json

RAW = """
{"total": 4, "tickets": [
  {"id": "T301", "category": "计费", "amount": 29900, "refund_requested": true,
   "customer": {"id": "C023", "name": "云帆科技", "plan": "annual"},
   "tags": ["退款", "重复扣款"],
   "messages": [{"from": "customer", "text": "8月2日被重复扣款,请退款"},
                {"from": "agent", "text": "已转财务核实"}],
   "assignee": {"id": "A01", "name": "林舟"}},
  {"id": "T302", "category": "登录", "amount": 0, "refund_requested": false,
   "customer": {"id": "C007", "name": "青禾网络", "plan": "monthly"},
   "tags": [],
   "messages": [{"from": "customer", "text": "验证码收不到"}],
   "assignee": null},
  {"id": "T303", "category": "计费", "amount": 46800, "refund_requested": true,
   "customer": {"id": "C015", "name": "北辰数据", "plan": "annual"},
   "tags": ["退款", "年付"],
   "messages": [{"from": "customer", "text": "年付多扣了,要求退款"},
                {"from": "agent", "text": "请提供发票号"},
                {"from": "customer", "text": "INV-2026-0815"}],
   "assignee": {"id": "A02", "name": "周宁"}},
  {"id": "T304", "category": "功能", "amount": 0, "refund_requested": false,
   "customer": {"id": "C031", "name": "星河软件", "plan": "monthly"},
   "messages": [],
   "assignee": null}
]}
"""

data = json.loads(RAW)
tickets = data["tickets"]
print(f"共 {data['total']} 张工单,实际读到 {len(tickets)} 张")

by_id = {t["id"]: t for t in tickets}
print("T303 的客户:", by_id["T303"]["customer"]["name"])

plan_counts = {}
for t in tickets:
    plan = t["customer"]["plan"]
    plan_counts[plan] = plan_counts.get(plan, 0) + 1
print("按套餐:", plan_counts)

tag_counts = {}
for t in tickets:
    for tag in t.get("tags", []):
        tag_counts[tag] = tag_counts.get(tag, 0) + 1
print("标签计数:", tag_counts)

refund_total = 0
for t in tickets:
    if t["refund_requested"]:
        refund_total += t["amount"]
print("申请退款合计:", refund_total // 100, "元")

unassigned = [t["id"] for t in tickets if t["assignee"] is None]
print("还没人接的:", unassigned)

waiting = []
for t in tickets:
    last = t["messages"][-1] if t["messages"] else None
    if last is not None and last["from"] == "customer":
        waiting.append(t["id"])
print("客户在等回复:", waiting)

n_messages = {t["id"]: len(t["messages"]) for t in tickets}
busiest = ""
most = -1
for ticket_id, n in n_messages.items():
    if n > most:
        busiest = ticket_id
        most = n
print("消息数:", n_messages, "最多的是", busiest)

for t in tickets:
    assignee = t["assignee"]
    who = assignee["name"] if assignee else "未分配"
    print(f"{t['id']} {t['customer']['name']} {t['category']} 负责人:{who}")
```

<div class="line-notes">

- `import json` 引入 `json`。
- `RAW = """` 同样的四张工单,不再解释。
- `data = json.loads(RAW)` 解析。
- `tickets = data["tickets"]` 取出工单列表。
- `print(f"共 {data['total']} 张工单,实际读到 {len(tickets)} 张")` 核对 `total` 和实际条数。f-string 外层双引号,里面取键用单引号。都是 4。
- `by_id = {t["id"]: t for t in tickets}` 字典推导式:工单号 → 整张工单的查找表。
- `print("T303 的客户:", by_id["T303"]["customer"]["name"])` 查找表加嵌套取值:`北辰数据`。
- `plan_counts = {}` 按套餐计数的字典。
- `for t in tickets:` 遍历。
- `plan = t["customer"]["plan"]` 往里两层取套餐。
- `plan_counts[plan] = plan_counts.get(plan, 0) + 1` 计数句式。
- `print("按套餐:", plan_counts)` `annual` 2 张、`monthly` 2 张。
- `tag_counts = {}` 标签计数。
- `for t in tickets:` 遍历工单。
- `for tag in t.get("tags", []):` 里层再遍历这张工单的标签列表。`.get("tags", [])` 防住 T304 没有这个键。这是**两层循环:外层是工单,内层是标签**。
- `tag_counts[tag] = tag_counts.get(tag, 0) + 1` 计数句式。
- `print("标签计数:", tag_counts)` `退款` 出现 2 次,`重复扣款`、`年付` 各 1 次。
- `refund_total = 0` 累加器。
- `if t["refund_requested"]:` 布尔值直接当条件(Day 17)。
- `refund_total += t["amount"]` 累加金额(整数,分)。
- `print("申请退款合计:", refund_total // 100, "元")` T301 的 29900 加 T303 的 46800,共 76700 分,即 767 元。
- `unassigned = [t["id"] for t in tickets if t["assignee"] is None]` 列表推导式(Day 23):负责人是 `None` 的工单号。
- `print("还没人接的:", unassigned)` `T302` 和 `T304`。
- `waiting = []` 客户在等回复的工单:最后一条消息是客户发的。
- `for t in tickets:` 遍历。
- `last = t["messages"][-1] if t["messages"] else None` 最后一条消息(字典),消息为空就是 `None`。条件表达式防 `IndexError`。
- `if last is not None and last["from"] == "customer":` 先判断有没有最后一条,再看发件人。`and` 有短路:`last` 是 `None` 时右边根本不执行,不会触发 `NoneType` 报错。
- `waiting.append(t["id"])` 记下工单号。
- `print("客户在等回复:", waiting)` `T302`(客户发的唯一一条)和 `T303`(最后是客户发的发票号)。T304 没有消息,不算。
- `n_messages = {t["id"]: len(t["messages"]) for t in tickets}` 字典推导式:工单号 → 消息数。
- `busiest = ""` 找消息最多的:先放个空字符串占位。
- `most = -1` 起始值比任何消息数都小,Day 24 找最高客户时用过同一招。
- `for ticket_id, n in n_messages.items():` 遍历键值对。
- `if n > most:` 比当前最多的大。
- `busiest = ticket_id` 换人。
- `most = n` 换数。
- `print("消息数:", n_messages, "最多的是", busiest)` 全部消息数和消息最多的工单。
- `for t in tickets:` 最后一段:每张工单一行。
- `assignee = t["assignee"]` 负责人。
- `who = assignee["name"] if assignee else "未分配"` 防 `None`。
- `print(f"{t['id']} {t['customer']['name']} {t['category']} 负责人:{who}")` 工单号、客户名、类别、负责人拼成一行。

</div>

```text
$ uv run python part01/ticket_tree.py
共 4 张工单,实际读到 4 张
T303 的客户: 北辰数据
按套餐: {'annual': 2, 'monthly': 2}
标签计数: {'退款': 2, '重复扣款': 1, '年付': 1}
申请退款合计: 767 元
还没人接的: ['T302', 'T304']
客户在等回复: ['T302', 'T303']
消息数: {'T301': 2, 'T302': 1, 'T303': 3, 'T304': 0} 最多的是 T303
T301 云帆科技 计费 负责人:林舟
T302 青禾网络 登录 负责人:未分配
T303 北辰数据 计费 负责人:周宁
T304 星河软件 功能 负责人:未分配
```

<div class="line-notes">

- `共 4 张工单,实际读到 4 张` `total` 和实际条数一致。
- `T303 的客户: 北辰数据` 查找表加嵌套取值。
- `按套餐: {'annual': 2, 'monthly': 2}` T301、T303 是年付,T302、T304 是月付。
- `标签计数: {'退款': 2, '重复扣款': 1, '年付': 1}` T304 没有 `tags` 也没崩。
- `申请退款合计: 767 元` 29900 + 46800 = 76700 分。
- `还没人接的: ['T302', 'T304']` 负责人是 `null`。
- `客户在等回复: ['T302', 'T303']` 最后一条是客户发的。
- `消息数: {'T301': 2, 'T302': 1, 'T303': 3, 'T304': 0} 最多的是 T303` T303 三条最多。
- `T301 云帆科技 计费 负责人:林舟` 七行摘要的第一行。
- `T302 青禾网络 登录 负责人:未分配` 第二张。
- `T303 北辰数据 计费 负责人:周宁` 第三张。
- `T304 星河软件 功能 负责人:未分配` 第四张。

</div>

对照 Day 24 的 `ticket_dicts.py`:那边的工单是平的一层,这边是三层以上,但用的还是同一批工具:方括号取值、`.get()` 防缺失、`.items()` 遍历、计数句式、`in`、推导式,只是多了「中间一层先起个名字」和「取之前先想一想这一层会不会是 `None`、空列表」这两个习惯。

basedpyright 在 standard 档对今天的正常脚本零报错(数据是 `json.loads` 读出来的,编辑器不会挑类型);Ruff 通过。

## 动手练习

### 练习 1:读出、改掉、列出来

下面这份小数据有三张工单(`T503` 故意没有 `tags` 键)。写 `part01/ex26_1_walk.py`,依次做:

1. 打印第二张工单的客户名;
2. 打印第一张工单的第二个标签;
3. 算出所有工单的消息总条数;
4. 对每张工单打印「最后一条消息来自谁」,没有消息的写 `—`;
5. 把第三张工单分配给 `{"name": "吴越"}`,再打印负责人的名字;
6. 每张工单一行,打印工单号、客户名、套餐、标签个数(没有 `tags` 键的算 0 个)。

```python
# 题目里的数据,写在 ex26_1_walk.py 的开头(import json 之后)
RAW = """
{"tickets": [
  {"id": "T501", "customer": {"name": "云帆科技", "plan": "annual"},
   "tags": ["退款", "重复扣款"],
   "messages": [{"from": "customer", "text": "重复扣款"}, {"from": "agent", "text": "已转财务"}],
   "assignee": {"name": "林舟"}},
  {"id": "T502", "customer": {"name": "青禾网络", "plan": "monthly"},
   "tags": [],
   "messages": [{"from": "customer", "text": "验证码收不到"}],
   "assignee": null},
  {"id": "T503", "customer": {"name": "北辰数据", "plan": "annual"},
   "messages": [],
   "assignee": null}
]}
"""
```

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex26_1_walk.py
import json

RAW = """
{"tickets": [
  {"id": "T501", "customer": {"name": "云帆科技", "plan": "annual"},
   "tags": ["退款", "重复扣款"],
   "messages": [{"from": "customer", "text": "重复扣款"}, {"from": "agent", "text": "已转财务"}],
   "assignee": {"name": "林舟"}},
  {"id": "T502", "customer": {"name": "青禾网络", "plan": "monthly"},
   "tags": [],
   "messages": [{"from": "customer", "text": "验证码收不到"}],
   "assignee": null},
  {"id": "T503", "customer": {"name": "北辰数据", "plan": "annual"},
   "messages": [],
   "assignee": null}
]}
"""

data = json.loads(RAW)
tickets = data["tickets"]

print(tickets[1]["customer"]["name"])
print(tickets[0]["tags"][1])

total = 0
for t in tickets:
    total += len(t["messages"])
print("消息总数:", total)

for t in tickets:
    messages = t["messages"]
    last_from = messages[-1]["from"] if messages else "—"
    print(t["id"], "最后一条来自", last_from)

tickets[2]["assignee"] = {"name": "吴越"}
print(tickets[2]["assignee"]["name"])

for t in tickets:
    n_tags = len(t.get("tags", []))
    print(f"{t['id']} {t['customer']['name']} {t['customer']['plan']} 标签 {n_tags} 个")
```

<div class="line-notes">

- `import json` 引入 `json`。
- `RAW = """` 题目里的三张工单:T501 有两条消息、两个标签;T502 一条消息、标签空、没人接;T503 没有 `tags` 键、没有消息、没人接。
- `data = json.loads(RAW)` 解析成字典。
- `tickets = data["tickets"]` 取出工单列表。
- `print(tickets[1]["customer"]["name"])` 第 1 步:列表下标 1(第二张),取 `customer`,再取 `name`。`青禾网络`。
- `print(tickets[0]["tags"][1])` 第 2 步:第一张的 `tags` 列表的下标 1(第二个)。`重复扣款`。
- `total = 0` 第 3 步:累加器。
- `for t in tickets:` 遍历三张。
- `total += len(t["messages"])` 加上这张的消息数:2、1、0。
- `print("消息总数:", total)` 3。
- `for t in tickets:` 第 4 步:再遍历一遍。
- `messages = t["messages"]` 把这一层取出来起个名字。
- `last_from = messages[-1]["from"] if messages else "—"` 有消息取最后一条的 `from`,没有消息(空列表当假)就用 `—`,不会触发 `IndexError`。
- `print(t["id"], "最后一条来自", last_from)` 三行输出。
- `tickets[2]["assignee"] = {"name": "吴越"}` 第 5 步:往里改,把第三张的 `assignee` 从 `None` 换成新字典。
- `print(tickets[2]["assignee"]["name"])` 读回来:`吴越`。
- `for t in tickets:` 第 6 步。
- `n_tags = len(t.get("tags", []))` `.get` 带默认值 `[]`,T503 没有这个键就当空列表,长度 0。
- `print(f"{t['id']} {t['customer']['name']} {t['customer']['plan']} 标签 {n_tags} 个")` 一行拼出来。

</div>

```text
$ uv run python part01/ex26_1_walk.py
青禾网络
重复扣款
消息总数: 3
T501 最后一条来自 agent
T502 最后一条来自 customer
T503 最后一条来自 —
吴越
T501 云帆科技 annual 标签 2 个
T502 青禾网络 monthly 标签 0 个
T503 北辰数据 annual 标签 0 个
```

<div class="line-notes">

- `青禾网络` 第 1 步。
- `重复扣款` 第 2 步。
- `消息总数: 3` 第 3 步:2 + 1 + 0。
- `T501 最后一条来自 agent` 第 4 步,T501 的最后一条是客服发的。
- `T502 最后一条来自 customer` T502 只有一条,客户发的。
- `T503 最后一条来自 —` T503 没有消息。
- `吴越` 第 5 步。
- `T501 云帆科技 annual 标签 2 个` 第 6 步。
- `T502 青禾网络 monthly 标签 0 个` 标签是空列表。
- `T503 北辰数据 annual 标签 0 个` 没有 `tags` 键,按 0 个。

</div>

</details>

### 练习 2:先猜,再跑

不要先运行。下面八行输出分别是什么?先写下答案再核对。重点看第 3 行(下标 `-1` 取到的是什么)、第 5 行(`t.get("tags")` 作条件)和第 7 行(`.get` 带默认值)。

```python
# agent-zero-lab/part01/ex26_2_guess.py
import json

RAW = """
{"tickets": [
  {"id": "T501", "customer": {"name": "云帆科技", "plan": "annual"},
   "tags": ["退款", "重复扣款"],
   "messages": [{"from": "customer", "text": "重复扣款"}, {"from": "agent", "text": "已转财务"}],
   "assignee": {"name": "林舟"}},
  {"id": "T502", "customer": {"name": "青禾网络", "plan": "monthly"},
   "tags": [],
   "messages": [{"from": "customer", "text": "验证码收不到"}],
   "assignee": null},
  {"id": "T503", "customer": {"name": "北辰数据", "plan": "annual"},
   "messages": [],
   "assignee": null}
]}
"""

data = json.loads(RAW)
tickets = data["tickets"]

print(tickets[1]["tags"])
print(len(tickets[0]["messages"]))
print(tickets[0]["messages"][-1])
print(tickets[2]["assignee"])
print([t["id"] for t in tickets if t.get("tags")])
print({t["id"]: len(t["messages"]) for t in tickets})
print(tickets[2].get("tags", "没有这个键"))
print(tickets[0]["customer"]["plan"] == tickets[2]["customer"]["plan"])
```

<details><summary>参考答案</summary>

```text
$ uv run python part01/ex26_2_guess.py
[]
2
{'from': 'agent', 'text': '已转财务'}
None
['T501']
{'T501': 2, 'T502': 1, 'T503': 0}
没有这个键
True
```

<div class="line-notes">

- `[]` 第 1 行:`tickets[1]["tags"]` 是 T502 的标签,空列表。
- `2` 第 2 行:T501 有两条消息。
- `{'from': 'agent', 'text': '已转财务'}` 第 3 行:`[-1]` 是最后一条,**整个字典**,不只是文字。要文字得再取 `["text"]`。
- `None` 第 4 行:T503 的负责人是 `null`,解析后是 `None`,`print` 打印出 `None`。
- `['T501']` 第 5 行:`t.get("tags")` 作条件:T501 有两个标签(非空列表,当真);T502 是空列表(假);T503 没有这个键,`.get` 返回 `None`(假)。所以只有 T501。
- `{'T501': 2, 'T502': 1, 'T503': 0}` 第 6 行:字典推导式:工单号 → 消息数。
- `没有这个键` 第 7 行:`.get("tags", "没有这个键")`,T503 没有 `tags`,返回默认值。
- `True` 第 8 行:T501 和 T503 的套餐都是 `annual`,字符串相等。

</div>

</details>

### 练习 3:找出两个错

下面两段代码,第一段会崩,第二段不崩但结果是错的。运行它们,说出病因和改法。

```python
# agent-zero-lab/part01/ex26_3_bug.py
import json

data = json.loads("""
{"tickets": [
  {"id": "T501", "tags": ["退款"]},
  {"id": "T502", "tags": []},
  {"id": "T503"}
]}
""")

for t in data["tickets"]:
    print(t["id"], len(t["tags"]))
```

```python
# agent-zero-lab/part01/ex26_3_bug_b.py
import json

t = json.loads('{"id": "T501", "customer": {"name": "云帆科技", "plan": "annual"}}')

draft = t.copy()
draft["id"] = "T501-draft"
draft["customer"]["plan"] = "monthly"

print("草稿:", draft["id"], draft["customer"]["plan"])
print("原件:", t["id"], t["customer"]["plan"])
```

<details><summary>参考答案</summary>

```text
$ uv run python part01/ex26_3_bug.py
T501 1
T502 0
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex26_3_bug.py", line 13, in <module>
    print(t["id"], len(t["tags"]))
                       ~^^^^^^^^
KeyError: 'tags'
$ uv run python part01/ex26_3_bug_b.py
草稿: T501-draft monthly
原件: T501 monthly
```

<div class="line-notes">

- `T501 1` 第一段前两张正常:T501 有一个标签。
- `T502 0` T502 的 `tags` 是空列表,长度 0。
- `File "/Users/你/agent-zero-lab/part01/ex26_3_bug.py", line 13, in <module>` 第三张时崩了,第 13 行。
- `print(t["id"], len(t["tags"]))` 崩的那一行。注意前两行已经打印出来了:这种「跑到一半才崩」是遍历一批数据时的典型表现。
- `KeyError: 'tags'` `T503` 没有 `tags` 这个键。改法:`len(t.get("tags", []))`。
- `草稿: T501-draft monthly` 第二段不报错。草稿改成了 `monthly`,符合预期。
- `原件: T501 monthly` 但**原件的套餐也被改成了 `monthly`**。`t.copy()` 只复制最外一层:`draft` 和 `t` 是两个不同的外层字典,但里面的 `customer` 是**同一个字典**。改 `draft["customer"]["plan"]`,等于改了原件。

</div>

改完的版本 `part01/ex26_3_fixed.py`:

```python
# agent-zero-lab/part01/ex26_3_fixed.py
import copy
import json

data = json.loads("""
{"tickets": [
  {"id": "T501", "tags": ["退款"]},
  {"id": "T502", "tags": []},
  {"id": "T503"}
]}
""")

for t in data["tickets"]:
    print(t["id"], len(t.get("tags", [])))

t = json.loads('{"id": "T501", "customer": {"name": "云帆科技", "plan": "annual"}}')

draft = copy.deepcopy(t)
draft["id"] = "T501-draft"
draft["customer"]["plan"] = "monthly"

print("草稿:", draft["id"], draft["customer"]["plan"])
print("原件:", t["id"], t["customer"]["plan"])
```

<div class="line-notes">

- `import copy` 标准库的 `copy` 模块,里面有 `deepcopy`(深拷贝):连里面套着的东西一层层全复制。
- `import json` 引入 `json`。
- `data = json.loads("""` 同样的三张工单,第三张没有 `tags`。
- `for t in data["tickets"]:` 遍历。
- `print(t["id"], len(t.get("tags", [])))` 第一处修复:没有 `tags` 就当空列表,三张都不崩。
- `t = json.loads('{"id": "T501", "customer": {"name": "云帆科技", "plan": "annual"}}')` 一张带嵌套客户的工单。
- `draft = copy.deepcopy(t)` 第二处修复:深拷贝,`draft` 和 `t` 从外到内都是独立的。
- `draft["id"] = "T501-draft"` 改草稿的外层。
- `draft["customer"]["plan"] = "monthly"` 改草稿的内层。
- `print("草稿:", draft["id"], draft["customer"]["plan"])` 草稿是 `monthly`。
- `print("原件:", t["id"], t["customer"]["plan"])` 原件还是 `annual`。

</div>

```text
$ uv run python part01/ex26_3_fixed.py
T501 1
T502 0
T503 0
草稿: T501-draft monthly
原件: T501 annual
```

<div class="line-notes">

- `T501 1` 第一段三行都能打印了。
- `T502 0` 空列表。
- `T503 0` 没有 `tags` 键,当 0 个。
- `草稿: T501-draft monthly` 草稿改了。
- `原件: T501 annual` 原件没被牵连。

</div>

第二个错最难发现,因为它**不报错、结果也看着正常**,只是别处的数据被悄悄改了。记住:拷贝嵌套数据用 `copy.deepcopy`;只复制最外层的 `.copy()`、`dict(d)`、`[:]` 对嵌套数据都不够。

</details>

### 练习 4:出一页报告

用练习 1 里那份三张工单的数据,写 `part01/ex26_4_report.py`,打印:

1. 套餐 → 该套餐下的工单号**列表**(例如 `annual` 对应哪几张);
2. 每张工单的消息数(用字典推导式);消息最多的是哪张;
3. 标签频次(没有 `tags` 键的不能崩);
4. 最后一条消息是客户发的工单,列出它的客户名;
5. 「工单号 → 客户名」的查找表(字典推导式)。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex26_4_report.py
import json

RAW = """
{"tickets": [
  {"id": "T501", "customer": {"name": "云帆科技", "plan": "annual"},
   "tags": ["退款", "重复扣款"],
   "messages": [{"from": "customer", "text": "重复扣款"}, {"from": "agent", "text": "已转财务"}],
   "assignee": {"name": "林舟"}},
  {"id": "T502", "customer": {"name": "青禾网络", "plan": "monthly"},
   "tags": [],
   "messages": [{"from": "customer", "text": "验证码收不到"}],
   "assignee": null},
  {"id": "T503", "customer": {"name": "北辰数据", "plan": "annual"},
   "messages": [],
   "assignee": null}
]}
"""

data = json.loads(RAW)
tickets = data["tickets"]

ids_by_plan = {}
for t in tickets:
    plan = t["customer"]["plan"]
    if plan not in ids_by_plan:
        ids_by_plan[plan] = []
    ids_by_plan[plan].append(t["id"])
print("按套餐:", ids_by_plan)

n_messages = {t["id"]: len(t["messages"]) for t in tickets}
print("消息数:", n_messages)

busiest = ""
most = -1
for ticket_id, n in n_messages.items():
    if n > most:
        busiest = ticket_id
        most = n
print("消息最多的工单:", busiest, most)

tag_counts = {}
for t in tickets:
    for tag in t.get("tags", []):
        tag_counts[tag] = tag_counts.get(tag, 0) + 1
print("标签计数:", tag_counts)

waiting_names = []
for t in tickets:
    if t["messages"] and t["messages"][-1]["from"] == "customer":
        waiting_names.append(t["customer"]["name"])
print("在等回复的客户:", waiting_names)

names_by_id = {t["id"]: t["customer"]["name"] for t in tickets}
print(names_by_id)
```

<div class="line-notes">

- `import json` 引入 `json`。
- `RAW = """` 和练习 1 同一份三张工单。
- `data = json.loads(RAW)` 解析。
- `tickets = data["tickets"]` 工单列表。
- `ids_by_plan = {}` 值是列表的字典:套餐 → 工单号列表。
- `for t in tickets:` 遍历。
- `plan = t["customer"]["plan"]` 往里两层取套餐。
- `if plan not in ids_by_plan:` 这个套餐第一次出现吗?
- `ids_by_plan[plan] = []` 第一次:先给一个空列表(Day 24 练习 4 的写法)。
- `ids_by_plan[plan].append(t["id"])` 取出这个套餐的列表,加上工单号。
- `print("按套餐:", ids_by_plan)` `annual` 是 T501、T503;`monthly` 是 T502。
- `n_messages = {t["id"]: len(t["messages"]) for t in tickets}` 字典推导式:工单号 → 消息数。
- `print("消息数:", n_messages)` 2、1、0。
- `busiest = ""` 找最多的:占位。
- `most = -1` 起始值比任何消息数都小。
- `for ticket_id, n in n_messages.items():` 遍历键值对。
- `if n > most:` 比当前最多的大。
- `busiest = ticket_id` 换人。
- `most = n` 换数。
- `print("消息最多的工单:", busiest, most)` T501,2 条。
- `tag_counts = {}` 标签频次。
- `for t in tickets:` 外层遍历工单。
- `for tag in t.get("tags", []):` 内层遍历标签;`.get` 防住 T503。
- `tag_counts[tag] = tag_counts.get(tag, 0) + 1` 计数句式。
- `print("标签计数:", tag_counts)` 只有 T501 有标签:各 1 次。
- `waiting_names = []` 在等回复的客户名。
- `for t in tickets:` 遍历。
- `if t["messages"] and t["messages"][-1]["from"] == "customer":` 先判断消息不是空列表,再看最后一条是不是客户发的。`and` 短路:空列表时右边不会执行,不会 `IndexError`。
- `waiting_names.append(t["customer"]["name"])` 记下客户名。
- `print("在等回复的客户:", waiting_names)` 只有 T502。
- `names_by_id = {t["id"]: t["customer"]["name"] for t in tickets}` 字典推导式:工单号 → 客户名。
- `print(names_by_id)` 打印查找表。

</div>

```text
$ uv run python part01/ex26_4_report.py
按套餐: {'annual': ['T501', 'T503'], 'monthly': ['T502']}
消息数: {'T501': 2, 'T502': 1, 'T503': 0}
消息最多的工单: T501 2
标签计数: {'退款': 1, '重复扣款': 1}
在等回复的客户: ['青禾网络']
{'T501': '云帆科技', 'T502': '青禾网络', 'T503': '北辰数据'}
```

<div class="line-notes">

- `按套餐: {'annual': ['T501', 'T503'], 'monthly': ['T502']}` 套餐归拢。
- `消息数: {'T501': 2, 'T502': 1, 'T503': 0}` 每张工单的消息数。
- `消息最多的工单: T501 2` T501 两条最多。
- `标签计数: {'退款': 1, '重复扣款': 1}` T502 的空标签和 T503 的缺失都没贡献。
- `在等回复的客户: ['青禾网络']` T501 最后是客服,T503 没有消息,只有 T502。
- `{'T501': '云帆科技', 'T502': '青禾网络', 'T503': '北辰数据'}` 查找表。

</div>

</details>

**验收标准:** 四道题的脚本都跑通;练习 2 先自己写出八行答案再核对;练习 3 说得出为什么 `.copy()` 改了内层原件也变;练习 4 里取嵌套值时有意识地想过「这一层会不会是 `None` 或空列表」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 嵌套(nested) | 容器里装着容器:列表里套字典、字典里套列表、字典里套字典 |
| JSON | 一种文本格式,接口之间传数据用。长得像 JS 对象,但键必须双引号,有 `true`/`false`/`null` |
| `json.loads(文本)` | 把 JSON 文本解析成 Python 的字典和列表。Day 39 正式讲 |
| `json.dumps(数据, indent=2, ensure_ascii=False)` | 把 Python 数据变回 JSON 文本;`indent` 缩进,`ensure_ascii=False` 让中文不转义 |
| `null` | JSON 里的空,解析后是 Python 的 `None` |
| 取值链 | `data["tickets"][0]["customer"]["name"]` 这样一层接一层的方括号 |
| 中间变量 | 把取值链中间的某一层放进一个变量,方便阅读和复用,比如 `customer = tickets[2]["customer"]` |
| `NoneType` | `None` 的类型。`TypeError: 'NoneType' object is not subscriptable` 就是对 `None` 用了方括号 |
| 字典推导式 | `{键: 值 for 名字 in 一批 if 条件}`,一行造出字典 |
| 查找表 | 用字典按键直接找到整条记录,比如 `{t["id"]: t for t in tickets}` |
| 浅拷贝(shallow copy) | 只复制最外一层,里面套着的字典和列表仍然是同一个。`d.copy()` 就是 |
| 深拷贝(deep copy) | 从外到内全部复制,互不影响。`copy.deepcopy(d)` |
| `type(x).__name__` | 取一个值的类型名字字符串,如 `'int'`、`'list'`,用来摸清数据结构 |
| `TypeError: list indices must be integers or slices, not str` | 把列表当字典用,用字符串去取下标 |
| `IndexError` | 下标超出列表范围,空列表取 `[0]` 或 `[-1]` 都会 |

## 常见误区

**取嵌套值时不先想「这一层是 dict 还是 list」。** `data["tickets"]["id"]` 会 `TypeError: list indices must be integers or slices, not str`。列表用数字,字典用键,交替出现。

**以为 JSON 的 `null` 只是个空。** 它变成 `None`,再往里取 `["name"]` 就 `TypeError: 'NoneType' object is not subscriptable`。取之前判断一下,`who = a["name"] if a else "未分配"`。

**对「可能没有的键」用方括号。** 同一类记录,有的有这个字段,有的没有。`t["tags"]` 会 `KeyError`,`t.get("tags", [])` 才稳。

**对可能为空的列表取 `[0]` 或 `[-1]`。** `IndexError: list index out of range`。先 `if messages:`。

**`.copy()` 就以为全复制了。** 嵌套数据里 `.copy()` 只复制最外层,改副本的内层,原件跟着变。要独立副本用 `copy.deepcopy(...)`。

**字典推导式的键不唯一。** `{t["customer"]: t["id"] for t in tickets}` 同一个客户的多张工单会互相覆盖,不报错,只是少了数据。键必须能唯一标识每一项,工单号可以,客户号不行。

**把字面量字典里混着字符串、整数和列表,然后抱怨编辑器画红线。** 编辑器是对的,Day 47 的 `TypedDict` 才是处理它的办法;今天用 `json.loads` 读数据可以先绕开。

**对每一层都加 `.get` 防护。** 键本来就该在的地方不要防,让它 `KeyError` 才能尽早发现数据不对。只对确实「可能没有」的字段防。

**JSON 文本里用单引号或末尾多一个逗号。** `json.loads` 会报 `JSONDecodeError`。JSON 比 Python 字典字面量更严格:字符串必须双引号,最后一项后面不能有逗号。Day 39 会专门讲。

## 学习资料

### 文档与文章

- [Python 教程 · 字典](https://docs.python.org/zh-cn/3.12/tutorial/datastructures.html#dictionaries):中文,官方教程里字典一节,最后有字典推导式 `{x: x**2 for x in (2, 4, 6)}` 这个例子。
- [json — JSON 编码和解码器](https://docs.python.org/zh-cn/3.12/library/json.html):中文,开头有 JSON 与 Python 类型对应表(`true` ↔ `True`、`null` ↔ `None`),今天只用 `loads` 和 `dumps`,Day 39 再细看。
- [copy — 浅层和深层复制操作](https://docs.python.org/zh-cn/3.12/library/copy.html):中文,官方对浅拷贝和深拷贝区别的解释,几行,配 `ex26_3_bug_b.py` 一起看。
- [PEP 274 · Dict Comprehensions](https://peps.python.org/pep-0274/):英文,字典推导式的原始提案,很短。
- [MDN · JSON](https://developer.mozilla.org/zh-CN/docs/Learn_web_development/Core/Scripting/JSON)、[json.org 中文版](https://www.json.org/json-zh.html):中文,前一篇是前端视角的 JSON 入门,后一篇是 JSON 的正式语法图,一页就能看完。
- [MDN · Object.fromEntries](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Object/fromEntries)、[可选链 ?.](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Operators/Optional_chaining):中文,JS 一侧对照,今天开头 Node 代码用到的。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1yY411h7TW&autoplay=0&high_quality=1" title="python基础巩固38：字典嵌套" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>明月讲解 · python基础巩固38:字典嵌套 · 9 分钟,字典里套字典、字典里套列表怎么取,和今天的 `nested_access.py` 对应。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1p2ZWBHEqQ&autoplay=0&high_quality=1" title="【Python 零基础】JSON 的基础使用与文件数据交互" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>水哥澎湃 · 【Python 零基础】JSON 的基础使用与文件数据交互 · 14 分钟,2026 年的新视频,前半讲 JSON 和 Python 字典怎么互转,正是今天用的 `loads`、`dumps`;后半的读写文件留到 Day 38 之后再看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/9N6a-VLBa2I" title="Python Tutorial: Working with JSON Data using the json Module" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Tutorial: Working with JSON Data using the json Module · 英文,开头讲 JSON 和 Python 的类型对应、`loads` 与 `dumps`,今天看这一段;后面读写文件的部分以后再看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/cj3h3Fb10QY" title="What is JSON? (Explained in 5 minutes)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hostinger Academy · What is JSON? (Explained in 5 minutes) · 英文,5 分钟,从前端视角说明 JSON 是什么,前端同学可以倍速看。</figcaption>
</figure>

### 书籍

- Eric Matthes《Python Crash Course》第 3 版,No Starch Press,2023(中译《Python编程:从入门到实践》)。第 6 章「Dictionaries」里的「Nesting」一节:列表里放字典、字典里放列表、字典里放字典,和今天一一对应。
- Al Sweigart《Automate the Boring Stuff with Python》第 2 版,No Starch Press,2019。第 5 章「Dictionaries and Structuring Data」里有「Nested Dictionaries and Lists」一节,用一个野餐物品清单做例子。

### 开源项目与代码

- [Asabeneh/30-Days-Of-Python · Day 19 File handling](https://github.com/Asabeneh/30-Days-Of-Python/tree/master/19_Day_File_handling):英文,里面有 JSON 一节,文件读写的部分现在不用看。

## 自测

1. `data = {"tickets": [{"id": "T1", "tags": ["退款"]}]}`,怎么取出 `"退款"`?

<details><summary>答案</summary>

`data["tickets"][0]["tags"][0]`。字典用键 `"tickets"`,列表用下标 0,字典用键 `"tags"`,列表用下标 0,一共四步。

</details>

2. 下面三个报错分别是哪种情况?

- `KeyError: 'tags'`
- `TypeError: 'NoneType' object is not subscriptable`
- `IndexError: list index out of range`

<details><summary>答案</summary>

第一个:这条数据里没有 `tags` 这个键;第二个:中间有一层是 `None`(JSON 里的 `null`),还用方括号往里取;第三个:列表是空的(或下标超出长度),取了不存在的位置。

</details>

3. JSON 里的 `true`、`false`、`null` 在 Python 里分别是什么?

<details><summary>答案</summary>

`True`、`False`、`None`。

</details>

4. `{t["id"]: t for t in tickets}` 做了什么?如果两张工单的 `id` 一样会怎样?

<details><summary>答案</summary>

造一个「工单号 → 整张工单」的查找表。`id` 重复时后面的覆盖前面的,不报错,字典里就少了一项。所以键一定要选能唯一标识每条记录的字段。

</details>

5. `draft = t.copy()` 之后改 `draft["customer"]["plan"]`,为什么 `t` 里的也变了?怎么避免?

<details><summary>答案</summary>

`.copy()` 是浅拷贝,只复制最外层:`draft` 和 `t` 的外层是两个字典,但里面的 `customer` 是同一个字典。用 `copy.deepcopy(t)` 得到全部独立的副本。

</details>

6. **面试题**:一份第三方接口返回的 JSON,里面的字段可能缺失、可能是 `null`、数组可能为空。你读取其中的 `order["customer"]["address"]["city"]` 时怎么写才稳?

<details><summary>答案</summary>

每一层都先想它「可能不是什么样」:`customer` 可能缺失,`address` 可能是 `null`,`city` 可能缺失。常见写法是逐层 `.get`:`(order.get("customer") or {}).get("address") or {}` 再 `.get("city", "未知")`;或者写成几个中间变量加 `if`,更好读。再往后的课会用 pydantic 在读进来的时候统一校验,不用每次手写防护,但思路是一样的:把外部数据当作「不可信」,在边界上一次性处理缺失和 `null`。

</details>

## 明天预告

Day 27 · 第 4 周复习:编程地基(Day 21–26)。这周你学了列表、元组、推导式、字典、集合、嵌套数据,六种装数据的容器,以及一路都在用的「遍历、筛选、计数」。明天不学新东西:画一张本周的知识地图(什么时候该用哪种容器),每天一句话回顾,做一个只用本周知识的小练习,把这周踩过的坑整理成清单,并默写本周核心代码。
