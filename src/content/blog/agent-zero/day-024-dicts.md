---
title: 'Day 24 · 字典:键值对和 .items()'
description: '列表和元组靠位置找东西,字典靠名字找东西:ticket["amount"] 代替 p[3]。相当于 JS 的 Object 或 Map。今天学会建、读、改、删,用 get 避开 KeyError,用 .items() 遍历,用字典按类别计数,并把一行工单拆成带名字的字典。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'agent-zero']
series: 'agent-zero'
day: 24
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 23](/blog/agent-zero/day-023-comprehensions/) 学了列表推导式:`[表达式 for 名字 in 一批 if 条件]` 一行就能做完「建空列表、遍历、筛选、`append`」。最后的 `refund_report.py` 里,每一行工单拆成 `p`,金额是 `p[3]`,描述是 `p[4]`,工单号是 `p[0]`。

这些数字下标是今天要解决的问题。你现在盯着 `p[3]` 看得懂,过两天就不一定了,换个同事来读更是一头雾水:3 到底是金额还是客户号?Python 为「用名字找东西」准备了一个类型,叫字典(dict)。把 `p[3]` 换成 `ticket["amount"]`,代码自己就在说明每一项是什么。今天学字典的建、读、改、删,学 `.get()` 和 `.items()`,最后用它按类别数一数每类工单各有几张。

## 今天要解决的问题

学完今天,你应该能:

1. 对照 JS 的对象说清字典的写法:`{"id": "T201", "amount": 29900}`,会用 `d["key"]` 读、`d["key"] = v` 加或改、`del` 和 `pop` 删、`in` 判断键在不在、`len` 数个数,并认得两个报错:`KeyError: 'customer'` 和 `TypeError: cannot use 'list' as a dict key (unhashable type: 'list')`。
2. 会用 `d.get("key", 默认值)` 避开 `KeyError`,说得出 `d.get("amount") or "没填"` 在金额是 0 时会出什么错。
3. 会用 `.keys()`、`.values()`、`.items()` 遍历字典,明白 `for k, v in d.items()` 里的逗号就是 Day 22 学过的解包;认得两个坑:`for k, v in d`(漏了 `.items()`)和遍历时往字典里删东西(`RuntimeError: dictionary changed size during iteration`)。
4. 写出 `part01/ticket_dicts.py`:把 Day 23 那批带坏行的工单拆成字典,按类别数张数,按客户汇总金额,按工单号建查找表。

预计用时:2.5 小时。读写删和 `get` 50 分钟,遍历和 `.items()` 40 分钟,计数和小项目 40 分钟,剩下做练习。

前置:[Day 16](/blog/agent-zero/day-016-strings-2/)(`split(maxsplit=...)`)、[Day 18](/blog/agent-zero/day-018-for-range/)(`for`)、[Day 21](/blog/agent-zero/day-021-lists/)(列表、`b = a` 只是多一个名字)、[Day 22](/blog/agent-zero/day-022-tuples-unpack/)(元组、解包、`zip`)、[Day 23](/blog/agent-zero/day-023-comprehensions/)(列表推导式、`refund_report.py` 里的那批原始工单)。今天不调任何 API,花费 0 元。

学法提示:先对照文章逐行敲一遍(代码自己敲,不复制粘贴)并跑通;第二天合上文章,把 `ticket_dicts.py` 默写出来,默写时每次想写 `p[3]` 就改成 `ticket["amount"]`;然后做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先说清楚我是在哪跑的

输出是我 2026-10-23 在 2019 款 Intel MacBook Pro(macOS 14、zsh)上用演示家目录真跑的,家目录显示成 `/Users/你`,`~/agent-zero-lab` 接着 Day 23 的状态,`uv run python` 是 3.12.13,Ruff 是 0.17.2,basedpyright 是 standard 档。今天的脚本都放在 `part01/`,在仓库根目录用 `uv run python part01/文件名.py` 运行,不读键盘输入。

## 先看 JS 的对象和 Map

你写前端时每天都在用对象:`user.name`、`{ ...state, loading: true }`、`Object.entries(obj)`。先在 Node 里把今天要学的操作都跑一遍,Python 版本和它们一一对应:

```text
$ node -e '
const ticket = { id: "T201", category: "计费", amount: 29900 };
console.log(ticket.id, ticket["category"]);
ticket.status = "open";
delete ticket.amount;
console.log(ticket, "amount" in ticket);
console.log(ticket.customer, ticket.customer ?? "未知");

const counts = new Map();
for (const c of ["计费", "登录", "计费"]) {
  counts.set(c, (counts.get(c) ?? 0) + 1);
}
console.log(counts);
for (const [k, v] of counts) console.log(k, v);
console.log(Object.entries(ticket));
'
T201 计费
{ id: 'T201', category: '计费', status: 'open' } false
undefined 未知
Map(2) { '计费' => 2, '登录' => 1 }
计费 2
登录 1
[ [ 'id', 'T201' ], [ 'category', '计费' ], [ 'status', 'open' ] ]
```

<div class="line-notes">

- `const ticket = { id: "T201", category: "计费", amount: 29900 };` 一个对象,三对「名字:值」。
- `console.log(ticket.id, ticket["category"]);` 两种取法:点号和方括号。输出 `T201 计费`。**Python 的字典只有方括号这一种**,没有 `ticket.id`。
- `ticket.status = "open";` 加一个新键。JS 里「加」和「改」是同一个写法,Python 也是。
- `delete ticket.amount;` 删掉一个键。
- `console.log(ticket, "amount" in ticket);` 对象里少了 `amount`,`in` 判断键在不在,得到 `false`。Python 也用 `in` 判断键。
- `console.log(ticket.customer, ticket.customer ?? "未知");` 取不存在的键,JS **不报错**,给你 `undefined`;`??` 补一个默认值。Python 取不存在的键**会报错**,补默认值要用 `.get()`,这是今天最重要的一个区别。
- `const counts = new Map();` 想要「键可以不是字符串」或者要严格保持顺序时,JS 用 `Map`。Python 的字典同时有对象和 `Map` 的特点。
- `for (const c of ["计费", "登录", "计费"]) {` 遍历三个类别。
- `counts.set(c, (counts.get(c) ?? 0) + 1);` 计数的经典写法:取出旧值(没有就当 0),加 1,再存回去。Python 里是 `counts[c] = counts.get(c, 0) + 1`,今天会反复用。
- `console.log(counts);` 输出 `Map(2) { '计费' => 2, '登录' => 1 }`。
- `for (const [k, v] of counts) console.log(k, v);` 遍历 Map,用解构同时拿到键和值。Python 的 `for k, v in d.items():` 是同一回事。
- `console.log(Object.entries(ticket));` 把对象变成「[键, 值] 对」的数组:`[ [ 'id', 'T201' ], ... ]`。Python 的 `.items()` 给出的是元组对。

</div>

| 想做的事 | JS | Python |
| --- | --- | --- |
| 建 | `{ id: "T201", amount: 29900 }` | `{"id": "T201", "amount": 29900}` |
| 读 | `t.id` 或 `t["id"]` | `t["id"]` |
| 读不存在的键 | `undefined` | `KeyError`,要默认值用 `t.get("x", 默认)` |
| 加或改 | `t.x = 1` | `t["x"] = 1` |
| 删 | `delete t.x` | `del t["x"]` 或 `t.pop("x")` |
| 有没有这个键 | `"x" in t` | `"x" in t` |
| 个数 | `Object.keys(t).length` | `len(t)` |
| 键值对一起遍历 | `Object.entries(t)` | `t.items()` |

注意两个小差别:Python 的键要加引号(`"id"`,不加引号的 `id` 会被当成变量名);Python 的字典**一定按你放进去的顺序**排列,JS 对象在键像数字时顺序有特殊规则,所以 JS 里要保证顺序才用 `Map`,Python 不用操心。

## 字典:花括号里的键值对

### 建、读、改、删

上一课到今天你一直用「位置」找东西:列表的 `p[3]`、元组的第几项。字典换成「名字」。每一项叫一个**键值对**(key-value pair):冒号左边是键(key,名字),右边是值(value,内容)。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="左边是列表,用位置 0 到 4 找值,p[3] 是金额;右边是字典,用名字找值,ticket[amount] 是金额,两边装着同样的五个值">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink-soft)">列表:靠位置找</text>
<text x="340" y="26" fill="var(--ink-soft)">字典:靠名字找</text>
<g>
<rect x="20" y="44" width="40" height="30" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="34" y="64" fill="var(--ink-faint)">0</text>
<rect x="62" y="44" width="230" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="72" y="64" fill="var(--ink)">"T301"</text>
<rect x="20" y="80" width="40" height="30" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="34" y="100" fill="var(--ink-faint)">1</text>
<rect x="62" y="80" width="230" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="72" y="100" fill="var(--ink)">"计费"</text>
<rect x="20" y="116" width="40" height="30" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="34" y="136" fill="var(--ink-faint)">2</text>
<rect x="62" y="116" width="230" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="72" y="136" fill="var(--ink)">"C023"</text>
<rect x="20" y="152" width="40" height="30" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="34" y="172" fill="var(--ink-faint)">3</text>
<rect x="62" y="152" width="230" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="72" y="172" fill="var(--ink)">"29900"</text>
<rect x="20" y="188" width="40" height="30" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="34" y="208" fill="var(--ink-faint)">4</text>
<rect x="62" y="188" width="230" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="72" y="208" fill="var(--ink)">"8月2日重复扣款,请退款"</text>
</g>
<g>
<rect x="340" y="44" width="100" height="30" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="350" y="64" fill="var(--ink-faint)">"id"</text>
<rect x="442" y="44" width="180" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="452" y="64" fill="var(--ink)">"T301"</text>
<rect x="340" y="80" width="100" height="30" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="350" y="100" fill="var(--ink-faint)">"category"</text>
<rect x="442" y="80" width="180" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="452" y="100" fill="var(--ink)">"计费"</text>
<rect x="340" y="116" width="100" height="30" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="350" y="136" fill="var(--ink-faint)">"customer"</text>
<rect x="442" y="116" width="180" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="452" y="136" fill="var(--ink)">"C023"</text>
<rect x="340" y="152" width="100" height="30" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="350" y="172" fill="var(--ink-faint)">"amount"</text>
<rect x="442" y="152" width="180" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="452" y="172" fill="var(--ink)">"29900"</text>
<rect x="340" y="188" width="100" height="30" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="350" y="208" fill="var(--ink-faint)">"desc"</text>
<rect x="442" y="188" width="180" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="452" y="208" fill="var(--ink)">"8月2日重复扣款…"</text>
</g>
<text x="20" y="240" fill="var(--ink-soft)">p[3] 要记得 3 是金额</text>
<text x="340" y="240" fill="var(--ink-soft)">ticket["amount"] 一眼看懂</text>
</g>
</svg>
<figcaption>同样五个值。列表要记住第几项是什么,字典把名字直接写在值旁边。金额那一格用琥珀色标出来,两边指的是同一个值。</figcaption>
</figure>

新建 `part01/dict_basic.py`:

```python
# agent-zero-lab/part01/dict_basic.py
ticket = {"id": "T201", "category": "计费", "amount": 29900}
print(ticket)
print(type(ticket), len(ticket))

print(ticket["id"], ticket["amount"])

ticket["status"] = "open"
ticket["amount"] = 46800
print(ticket)

ticket.update({"customer": "C023", "status": "closed"})
print(ticket)

print("amount" in ticket, "refund" in ticket)

removed = ticket.pop("category")
print(removed, ticket)
del ticket["customer"]
print(ticket)

empty = {}
print(empty, len(empty), bool(empty))
```

<div class="line-notes">

- `ticket = {"id": "T201", "category": "计费", "amount": 29900}` 花括号里三对键值对,键和值之间用冒号,各对之间用逗号。键是字符串,值有字符串也有整数,字典不要求值的类型一样(列表也不要求)。
- `print(ticket)` 输出 `{'id': 'T201', 'category': '计费', 'amount': 29900}`。Python 打印字符串时默认用单引号,中文直接显示,不会变成 `计` 之类的转义。
- `print(type(ticket), len(ticket))` `type` 看类型:`<class 'dict'>`,`dict` 是 dictionary 的缩写。`len` 数键值对个数:3。
- `print(ticket["id"], ticket["amount"])` 用方括号加键取值:`T201 29900`。键要写成字符串 `"id"`,带引号。
- `ticket["status"] = "open"` 给一个**原来没有**的键赋值,字典里就多出一对。
- `ticket["amount"] = 46800` 给一个**已经有**的键赋值,就是改:旧值 29900 被换成 46800。加和改是同一个写法,和 JS 一样。
- `print(ticket)` 现在四对:`id`、`category`、`amount`(46800)、`status`(open)。新键排在最后,旧键的位置没动。
- `ticket.update({"customer": "C023", "status": "closed"})` `update` 一次合并另一个字典进来:没有的键(`customer`)加上,已经有的键(`status`)覆盖成新值 `closed`。相当于 JS 的 `Object.assign(ticket, {...})`。
- `print(ticket)` 五对:`status` 还在原来的位置但值变成了 `closed`,`customer` 排在最后。
- `print("amount" in ticket, "refund" in ticket)` `in` 问「这个**键**在不在」:`True False`。注意它**只看键,不看值**:`46800 in ticket` 是 `False`。
- `removed = ticket.pop("category")` `pop` 删掉一个键,**并把它的值返回**,这里 `removed` 是 `计费`。
- `print(removed, ticket)` 输出 `计费 {...}`,字典里已经没有 `category`。
- `del ticket["customer"]` `del` 也能删一个键,但不返回值。想要被删的值就用 `pop`,不要就用 `del`。
- `print(ticket)` 剩 `id`、`amount`、`status` 三对。
- `empty = {}` 空字典就是一对空花括号。
- `print(empty, len(empty), bool(empty))` 输出 `{} 0 False`:空字典长度 0,当条件用时是假(Day 21 的空列表也是这样),所以 `if ticket:` 可以判断字典里有没有东西。

</div>

```text
$ cd ~/agent-zero-lab
$ uv run python part01/dict_basic.py
{'id': 'T201', 'category': '计费', 'amount': 29900}
<class 'dict'> 3
T201 29900
{'id': 'T201', 'category': '计费', 'amount': 46800, 'status': 'open'}
{'id': 'T201', 'category': '计费', 'amount': 46800, 'status': 'closed', 'customer': 'C023'}
True False
计费 {'id': 'T201', 'amount': 46800, 'status': 'closed', 'customer': 'C023'}
{'id': 'T201', 'amount': 46800, 'status': 'closed'}
{} 0 False
```

<div class="line-notes">

- `{'id': 'T201', 'category': '计费', 'amount': 29900}` 刚建好的字典。
- `<class 'dict'> 3` 类型是 `dict`,三对。
- `T201 29900` 取出两个值。
- `{'id': 'T201', 'category': '计费', 'amount': 46800, 'status': 'open'}` 改了金额,新增了状态。
- `{'id': 'T201', 'category': '计费', 'amount': 46800, 'status': 'closed', 'customer': 'C023'}` `status` 被覆盖,`customer` 新增在末尾。
- `True False` 有 `amount`,没有 `refund`。
- `计费 {'id': 'T201', 'amount': 46800, 'status': 'closed', 'customer': 'C023'}` `pop` 拿到 `计费`,字典里 `category` 没了。
- `{'id': 'T201', 'amount': 46800, 'status': 'closed'}` `del` 之后 `customer` 也没了。
- `{} 0 False` 空字典。

</div>

字典**不是按位置存**的,所以没有「第 0 项」。`ticket[0]` 会去找一个叫 `0` 的键,找不到就报 `KeyError: 0`。反过来,**顺序是保证的**:Python 3.7 起字典严格按插入顺序保存,打印、遍历出来都是这个顺序,上面输出里 `status` 排在 `amount` 后面就是这个道理。

### 取不存在的键:KeyError 和 get

这是 JS 程序员最容易不适应的一点。JS 里 `ticket.customer` 没有这个键就悄悄给你 `undefined`,然后你在三行之后才因为 `undefined.toLowerCase()` 崩溃。Python 要求**取不存在的键就当场报错**。新建 `part01/dict_missing.py`:

```python
# agent-zero-lab/part01/dict_missing.py
ticket = {"id": "T201", "category": "计费", "amount": 29900}
print(ticket["id"])
print(ticket["customer"])
print("走不到这里")
```

<div class="line-notes">

- `ticket = {"id": "T201", "category": "计费", "amount": 29900}` 三对,没有 `customer`。
- `print(ticket["id"])` 这个键在,打印 `T201`。
- `print(ticket["customer"])` 这个键不在,程序在这里停下。
- `print("走不到这里")` 前一行已经报错,这一行不会执行。

</div>

```text
$ uv run python part01/dict_missing.py
T201
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/dict_missing.py", line 4, in <module>
    print(ticket["customer"])
          ~~~~~~^^^^^^^^^^^^
KeyError: 'customer'
```

<div class="line-notes">

- `T201` 第一个 `print` 正常。
- `Traceback (most recent call last):` 报错开头(Day 8 起你见过很多次)。
- `File "/Users/你/agent-zero-lab/part01/dict_missing.py", line 4, in <module>` 出错在第 4 行。
- `print(ticket["customer"])` 出错的那一行,下面的 `~~~~~~^^^^^^^^^^^^^` 指向 `["customer"]` 这一段。
- `KeyError: 'customer'` 错误名叫 `KeyError`,后面是**没找到的那个键**,带着引号。看到它先想:这个键是不是拼错了、大小写对不对、这条数据是不是就是没有这一项。

</div>

不想让它崩,就用 `.get()`。它像一个「取不到不报错」的方括号。新建 `part01/dict_get.py`:

```python
# agent-zero-lab/part01/dict_get.py
ticket = {"id": "T201", "category": "计费", "amount": 0}

print(ticket.get("customer"))
print(ticket.get("customer", "未知"))
print(ticket.get("category", "未知"))

amount = ticket.get("amount") or "没填"
amount2 = ticket.get("amount", "没填")
print(amount, amount2)

print(ticket.pop("customer", None))
print(ticket)

if ticket.get("customer") is None:
    print("这张工单没有客户号")
```

<div class="line-notes">

- `ticket = {"id": "T201", "category": "计费", "amount": 0}` 这次金额是 0,后面要用到。
- `print(ticket.get("customer"))` `get` 取不存在的键,**返回 `None`**(Day 14),不报错。
- `print(ticket.get("customer", "未知"))` 第二个参数是默认值:键不存在时返回它。相当于 JS 的 `ticket.customer ?? "未知"`。
- `print(ticket.get("category", "未知"))` 键存在时,默认值**不起作用**,返回真实的值 `计费`。
- `amount = ticket.get("amount") or "没填"` 想表达「金额没填就写没填」,用了 `or`。但 `ticket.get("amount")` 是 `0`,而 `0` 在 `or` 里算假(Day 14、17),所以走到右边,得到 `"没填"`。**这是错的**:金额明明填了,是 0。
- `amount2 = ticket.get("amount", "没填")` 用默认值参数:键存在,就返回 0,默认值不起作用。这才对。
- `print(amount, amount2)` 输出 `没填 0`,两种写法结果不同。
- `print(ticket.pop("customer", None))` `pop` 也可以带默认值:键不存在时不报错,返回你给的默认值 `None`。
- `print(ticket)` 字典没变。
- `if ticket.get("customer") is None:` 想判断「有没有这一项」,可以用 `get` 加 `is None`(Day 14),也可以用 `"customer" in ticket`。
- `print("这张工单没有客户号")` 条件成立,会打印。

</div>

```text
$ uv run python part01/dict_get.py
None
未知
计费
没填 0
None
{'id': 'T201', 'category': '计费', 'amount': 0}
这张工单没有客户号
```

<div class="line-notes">

- `None` 没有这个键,`get` 给 `None`。
- `未知` 带了默认值,给 `未知`。
- `计费` 键存在,给真实值。
- `没填 0` `or` 的写法把 0 当成了「没有」,`get` 带默认值的写法才对。
- `None` `pop` 带默认值,没有这个键就给 `None`。
- `{'id': 'T201', 'category': '计费', 'amount': 0}` 字典没动过。
- `这张工单没有客户号` `is None` 判断成立。

</div>

怎么选?你**确定键一定在**(比如刚用代码塞进去的),就用方括号,出错说明程序有 bug,崩得越早越容易查。键**可能不在**(外部来的数据、用户填的表单、模型返回的 JSON),就用 `.get()` 并想好默认值。别为了不报错到处写 `.get()`,那样出了问题只会在很远的地方显出来。

### 键有规则:不重复,而且不能是列表

字典的键有两条规则,一次跑出来。新建 `part01/dict_keys_rules.py`:

```python
# agent-zero-lab/part01/dict_keys_rules.py
by_pair = {("T201", "C023"): 29900, ("T203", "C015"): 46800}
print(by_pair[("T203", "C015")])

by_number = {1: "一", 2: "二"}
print(by_number[1], "1" in by_number, 1 in by_number)

by_text = {"1": "一", "2": "二"}
print(by_text["1"], "1" in by_text, 1 in by_text)
```

<div class="line-notes">

- `by_pair = {("T201", "C023"): 29900, ("T203", "C015"): 46800}` 键是**元组**(Day 22)。「某个工单加某个客户」这一对作为键,值是金额。元组建好不能改,所以能当键。
- `print(by_pair[("T203", "C015")])` 用同一个元组取值。注意是双层括号:外层是方括号,里层是元组的括号。输出 `46800`。
- `by_number = {1: "一", 2: "二"}` 键是整数。字典的键不一定是字符串。
- `print(by_number[1], "1" in by_number, 1 in by_number)` 整数 `1` 和字符串 `"1"` **是两个不同的键**:`by_number[1]` 取到 `一`,`"1" in by_number` 是 `False`,`1 in by_number` 是 `True`。
- `by_text = {"1": "一", "2": "二"}` 键是字符串 `"1"`。
- `print(by_text["1"], "1" in by_text, 1 in by_text)` 这回反过来:字符串 `"1"` 在,整数 `1` 不在,输出 `一 True False`。从 JSON 或文本里读出来的编号是字符串,别拿整数去查。

</div>

```text
$ uv run python part01/dict_keys_rules.py
46800
一 False True
一 True False
```

<div class="line-notes">

- `46800` 元组做键查到了。
- `一 False True` 整数键 1 在,字符串键 `"1"` 不在。
- `一 True False` 字符串键 `"1"` 在,整数键 1 不在。

</div>

**第一条:键不能重复。** 写两次同一个键,后面的覆盖前面的,而且 Python 不报错。新建 `part01/dict_dup_key.py`:

```python
# agent-zero-lab/part01/dict_dup_key.py
d = {"a": 1, "b": 2, "a": 3}
print(d, len(d))
```

<div class="line-notes">

- `d = {"a": 1, "b": 2, "a": 3}` `"a"` 写了两次,值分别是 1 和 3。
- `print(d, len(d))` 只剩两对,`a` 的值是后写的 3。

</div>

```text
$ uv run python part01/dict_dup_key.py
{'a': 3, 'b': 2} 2
```

<div class="line-notes">

- `{'a': 3, 'b': 2} 2` `a` 是 3,不是 1;一共 2 对,不是 3 对。位置还是第一次出现的位置,所以 `a` 排在 `b` 前面。

</div>

程序跑得通,但 Ruff 在编辑器里会给这一行画线。在终端里跑 `uv run ruff check part01/dict_dup_key.py`:

```text
F601 Dictionary key literal `"a"` repeated
 --> part01/dict_dup_key.py:2:22
  |
1 | # agent-zero-lab/part01/dict_dup_key.py
2 | d = {"a": 1, "b": 2, "a": 3}
  |                      ^^^
3 | print(d, len(d))
  |
help: Remove repeated key literal `"a"`
```

<div class="line-notes">

- `F601 Dictionary key literal `"a"` repeated` Ruff 的规则编号 `F601`,意思是「字典里的键字面量重复了」。
- `--> part01/dict_dup_key.py:2:22` 出问题的位置:第 2 行第 22 列,就是第二个 `"a"`。
- `^^^` 指在重复的那个键上。
- `help: Remove repeated key literal `"a"`` 建议删掉重复的键。这种重复多半是手滑复制粘贴出来的,覆盖掉的值就这样默默丢了。

</div>

**第二条:键必须是「建好之后不会变」的东西。** 字符串、数字、元组可以,列表不行。新建 `part01/dict_list_key.py`:

```python
# agent-zero-lab/part01/dict_list_key.py
bad = {["T201", "C023"]: 29900}
print(bad)
```

<div class="line-notes">

- `bad = {["T201", "C023"]: 29900}` 用一个**列表**当键。列表能改,如果字典用它当键存了,之后有人改了列表,字典就找不到这一对了,所以 Python 一开始就不让。
- `print(bad)` 走不到这里。

</div>

```text
$ uv run python part01/dict_list_key.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/dict_list_key.py", line 2, in <module>
    bad = {["T201", "C023"]: 29900}
          ^^^^^^^^^^^^^^^^^^^^^^^^^
TypeError: cannot use 'list' as a dict key (unhashable type: 'list')
```

<div class="line-notes">

- `File "/Users/你/agent-zero-lab/part01/dict_list_key.py", line 2, in <module>` 在第 2 行。
- `bad = {["T201", "C023"]: 29900}` 出错的那一行,`^^^` 指着整个 `{...}`。
- `TypeError: cannot use 'list' as a dict key (unhashable type: 'list')` 类型错误:不能用列表当字典的键。括号里的 `unhashable`(不可哈希)是 Python 内部的说法,你只要记住:**能改的东西(列表、字典)不能当键,不能改的(字符串、数字、元组)可以**。

</div>

basedpyright 在编辑器里同样会给这一行画红线:`Dictionary key must be hashable`。把列表换成元组 `("T201", "C023")` 就好了。

## 遍历字典

### 键、值、键值对

新建 `part01/dict_loop.py`:

```python
# agent-zero-lab/part01/dict_loop.py
counts = {"计费": 6, "登录": 2, "功能": 1}

for key in counts:
    print("键:", key)

print(counts.keys())
print(counts.values())
print(counts.items())

for category, n in counts.items():
    print(f"{category} 有 {n} 张")

print(list(counts))
print(list(counts.values()))
print(sum(counts.values()))
print(max(counts.values()))

counts["账号"] = 0
counts["登录"] = 5
print(counts)
```

<div class="line-notes">

- `counts = {"计费": 6, "登录": 2, "功能": 1}` 一个「类别 → 张数」的字典,键是中文字符串,值是整数。
- `for key in counts:` 直接遍历字典,**得到的是键**,不是值,也不是键值对。
- `print("键:", key)` 每次打印一个键。
- `print(counts.keys())` `.keys()` 返回所有键。输出 `dict_keys(['计费', '登录', '功能'])`,是一个叫 `dict_keys` 的「视图」,像列表但不是列表。
- `print(counts.values())` `.values()` 返回所有值:`dict_values([6, 2, 1])`。
- `print(counts.items())` `.items()` 返回所有键值对,每一对是一个**元组**(Day 22):`dict_items([('计费', 6), ('登录', 2), ('功能', 1)])`。
- `for category, n in counts.items():` 遍历键值对,每次得到一个元组 `('计费', 6)`,**逗号两边的两个名字把它解包**:`category` 是 `计费`,`n` 是 6。这就是 Day 22 学的 `for no, line in enumerate(...)` 的同一种写法。
- `print(f"{category} 有 {n} 张")` 用两个名字拼一句话。
- `print(list(counts))` 把字典交给 `list(...)`,得到的是**键**的列表:`['计费', '登录', '功能']`。
- `print(list(counts.values()))` 值的列表:`[6, 2, 1]`。
- `print(sum(counts.values()))` `sum`(Day 21)对所有值求和:6 + 2 + 1 = 9。
- `print(max(counts.values()))` 最大的值,6。
- `counts["账号"] = 0` 加一个新类别,值是 0。
- `counts["登录"] = 5` 把登录的张数改成 5。
- `print(counts)` 现在 `登录` 是 5,`账号` 排在最后。

</div>

```text
$ uv run python part01/dict_loop.py
键: 计费
键: 登录
键: 功能
dict_keys(['计费', '登录', '功能'])
dict_values([6, 2, 1])
dict_items([('计费', 6), ('登录', 2), ('功能', 1)])
计费 有 6 张
登录 有 2 张
功能 有 1 张
['计费', '登录', '功能']
[6, 2, 1]
9
6
{'计费': 6, '登录': 5, '功能': 1, '账号': 0}
```

<div class="line-notes">

- `键: 计费` 到 `键: 功能` 三行,顺序和建字典时一致。
- `dict_keys(['计费', '登录', '功能'])` 键的视图。
- `dict_values([6, 2, 1])` 值的视图。
- `dict_items([('计费', 6), ('登录', 2), ('功能', 1)])` 键值对的视图,里面是三个元组。
- `计费 有 6 张` 到 `功能 有 1 张` 三行,解包出的 `category` 和 `n`。
- `['计费', '登录', '功能']` `list(counts)` 是键的列表。
- `[6, 2, 1]` 值的列表。
- `9` 求和。
- `6` 最大值。
- `{'计费': 6, '登录': 5, '功能': 1, '账号': 0}` 改过、加过之后的字典。

</div>

画个图,看 `.items()` 把字典变成什么:

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="字典 counts 有三对键值对;items 方法把它变成三个二元组;for category, n in counts.items() 每次取一个元组并解包成 category 和 n">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink-soft)">counts</text>
<rect x="20" y="40" width="130" height="28" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="59" fill="var(--ink)">"计费": 6</text>
<rect x="20" y="76" width="130" height="28" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="95" fill="var(--ink)">"登录": 2</text>
<rect x="20" y="112" width="130" height="28" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="131" fill="var(--ink)">"功能": 1</text>
<line x1="156" y1="90" x2="206" y2="90" stroke="var(--ink-faint)"/>
<text x="160" y="80" fill="var(--ink-soft)">.items()</text>
<text x="222" y="26" fill="var(--ink-soft)">三个元组</text>
<rect x="222" y="40" width="130" height="28" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="232" y="59" fill="var(--ink)">("计费", 6)</text>
<rect x="222" y="76" width="130" height="28" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="232" y="95" fill="var(--ink)">("登录", 2)</text>
<rect x="222" y="112" width="130" height="28" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="232" y="131" fill="var(--ink)">("功能", 1)</text>
<line x1="358" y1="58" x2="418" y2="58" stroke="var(--ink-faint)"/>
<text x="426" y="26" fill="var(--ink-soft)">第一圈解包</text>
<rect x="426" y="40" width="110" height="28" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="436" y="59" fill="var(--ink)">category = "计费"</text>
<rect x="426" y="76" width="110" height="28" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="436" y="95" fill="var(--ink)">n = 6</text>
<text x="20" y="176" fill="var(--ink)">for category, n in counts.items():</text>
<text x="20" y="200" fill="var(--ink-soft)">每圈从 items 里取一个元组,逗号左右的两个名字把它拆开</text>
</g>
</svg>
<figcaption>`.items()` 给出的是一串元组,`for category, n in ...` 里的逗号就是 Day 22 的解包。</figcaption>
</figure>

### 第一个坑:忘了 .items()

漏写 `.items()`,有时候直接报错,有时候**不报错但结果是错的**,后者更可怕。新建 `part01/dict_unpack_trap.py`:

```python
# agent-zero-lab/part01/dict_unpack_trap.py
counts = {"计费": 6, "登录": 2, "功能": 1}

for category, n in counts:
    print(category, n)

print("---")
english = {"billing": 6, "login": 2}
for category, n in english:
    print(category, n)
```

<div class="line-notes">

- `counts = {"计费": 6, "登录": 2, "功能": 1}` 键都是两个汉字的字符串。
- `for category, n in counts:` 漏了 `.items()`。直接遍历字典得到的是键,比如 `"计费"`,然后 Python 试图把这个**字符串**解包成两个名字。字符串也能被解包,因为它就是一串字符(这是第一次见,Day 22 的解包对任何「一串东西」都管用);`"计费"` 恰好两个字,于是 `category` 拿到 `计`,`n` 拿到 `费`。
- `print(category, n)` 打印出这对错位的字符。
- `print("---")` 分隔。
- `english = {"billing": 6, "login": 2}` 换成英文键,`billing` 有 7 个字母。
- `for category, n in english:` 同样漏了 `.items()`。7 个字母解包成 2 个名字,个数对不上。
- `print(category, n)` 走不到这里。

</div>

```text
$ uv run python part01/dict_unpack_trap.py
计 费
登 录
功 能
---
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/dict_unpack_trap.py", line 9, in <module>
    for category, n in english:
        ^^^^^^^^^^^
ValueError: too many values to unpack (expected 2)
```

<div class="line-notes">

- `计 费` 第一圈:键 `计费` 被拆成两个字。**没有任何报错**,但完全不是你想要的。
- `登 录` 第二圈。
- `功 能` 第三圈。
- `---` 分隔线。
- `File "/Users/你/agent-zero-lab/part01/dict_unpack_trap.py", line 9, in <module>` 第二个循环报错。
- `for category, n in english:` 出错的那行。
- `ValueError: too many values to unpack (expected 2)` 想拆成 2 个,字符串 `billing` 有 7 个字符,多了。这是 Day 22 见过的那个报错,原因是同一个。

</div>

所以键恰好是两个字符时最阴险,什么都不报,只是数据错了。**遍历字典要键和值,永远写 `.items()`。**

### 第二个坑:遍历时改字典

Day 21 讲过遍历列表时往里删东西会漏项。字典更干脆,直接不让你这么做。新建 `part01/dict_mutate_loop.py`:

```python
# agent-zero-lab/part01/dict_mutate_loop.py
counts = {"计费": 6, "登录": 2, "功能": 1, "账号": 0}

for category, n in counts.items():
    if n == 0:
        del counts[category]
print(counts)
```

<div class="line-notes">

- `counts = {"计费": 6, "登录": 2, "功能": 1, "账号": 0}` 四个类别,`账号` 是 0 张。
- `for category, n in counts.items():` 遍历字典,同时下面要改它。
- `if n == 0:` 张数为 0 的就不要了。
- `del counts[category]` 在遍历中间删掉一对。遍历是按「当前字典有几项」往前走的,中途变了,Python 无法保证接下来走到哪,干脆报错。
- `print(counts)` 走不到这里。

</div>

```text
$ uv run python part01/dict_mutate_loop.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/dict_mutate_loop.py", line 4, in <module>
    for category, n in counts.items():
                       ~~~~~~~~~~~~^^
RuntimeError: dictionary changed size during iteration
```

<div class="line-notes">

- `for category, n in counts.items():` 报错落在 `for` 这一行,而不是 `del` 那一行:是遍历下一圈时发现字典变了。
- `RuntimeError: dictionary changed size during iteration` 运行时错误:遍历过程中字典大小变了。

</div>

两种修法都行。新建 `part01/dict_mutate_fixed.py`:

```python
# agent-zero-lab/part01/dict_mutate_fixed.py
counts = {"计费": 6, "登录": 2, "功能": 1, "账号": 0}

for category, n in list(counts.items()):
    if n == 0:
        del counts[category]
print(counts)

counts = {"计费": 6, "登录": 2, "功能": 1, "账号": 0}
kept = {}
for category, n in counts.items():
    if n > 0:
        kept[category] = n
print(kept)
print(counts)
```

<div class="line-notes">

- `counts = {"计费": 6, "登录": 2, "功能": 1, "账号": 0}` 同样的字典。
- `for category, n in list(counts.items()):` 修法一:先用 `list(...)` 把键值对**抄成一个独立的列表**,遍历这份抄本,删的是原字典,互不干扰。
- `if n == 0:` 还是为 0 的不要。
- `del counts[category]` 删原字典的这一对,这次不会报错。
- `print(counts)` 输出 `{'计费': 6, '登录': 2, '功能': 1}`,`账号` 不见了。
- `counts = {"计费": 6, "登录": 2, "功能": 1, "账号": 0}` 修法二之前,把字典恢复成原样,方便对比。
- `kept = {}` 修法二:不改原字典,另建一个空字典。
- `for category, n in counts.items():` 遍历原字典(只读)。
- `if n > 0:` 留下大于 0 的。
- `kept[category] = n` 加进新字典。
- `print(kept)` 新字典里没有 `账号`。
- `print(counts)` 原字典完整,四对都在。

</div>

```text
$ uv run python part01/dict_mutate_fixed.py
{'计费': 6, '登录': 2, '功能': 1}
{'计费': 6, '登录': 2, '功能': 1}
{'计费': 6, '登录': 2, '功能': 1, '账号': 0}
```

<div class="line-notes">

- `{'计费': 6, '登录': 2, '功能': 1}` 修法一:原字典被改了。
- `{'计费': 6, '登录': 2, '功能': 1}` 修法二:新字典里只有三对。
- `{'计费': 6, '登录': 2, '功能': 1, '账号': 0}` 修法二里原字典没动。

</div>

我偏向修法二:建新的、不动旧的,出了问题还能回头看原始数据。Day 26 会学到用「字典推导式」一行做同样的事。

## 把一行工单拆成字典

### zip 配对,dict 收尾

Day 23 的 `refund_report.py` 把每行工单拆成列表 `p`,再用 `p[0]`、`p[3]` 这样的数字取值。字典能让这件事自己写清楚。办法是:准备一个字段名列表,和拆出来的值列表用 Day 22 的 `zip` 配成对,再交给 `dict(...)`。新建 `part01/dict_zip.py`:

```python
# agent-zero-lab/part01/dict_zip.py
fields = ["id", "category", "customer", "amount", "desc"]
line = "T301 计费 C023 29900 8月2日重复扣款,请退款"
values = line.split(maxsplit=4)
print(values)

ticket = dict(zip(fields, values))
print(ticket)

print(ticket["category"], ticket["desc"])
print(int(ticket["amount"]) + 100)
```

<div class="line-notes">

- `fields = ["id", "category", "customer", "amount", "desc"]` 五个字段名,顺序和工单行里五段的顺序一致。
- `line = "T301 计费 C023 29900 8月2日重复扣款,请退款"` Day 23 `raw_lines` 里的第一行。
- `values = line.split(maxsplit=4)` 最多拆五段(Day 16),第五段是完整描述。
- `print(values)` 五个字符串的列表,**金额也是字符串** `'29900'`。
- `ticket = dict(zip(fields, values))` `zip` 把字段名和值按位置配成对:`("id", "T301")`、`("category", "计费")` ……(Day 22);`dict(...)` 把一串这样的二元组收成字典。你可以把 `dict(zip(a, b))` 记成一个固定句式:**两个列表,一个当键一个当值**。
- `print(ticket)` 输出带名字的字典,五对。
- `print(ticket["category"], ticket["desc"])` 现在取值靠名字:`计费 8月2日重复扣款,请退款`。读代码的人不用查「第 1 项是什么」。
- `print(int(ticket["amount"]) + 100)` 金额是字符串 `'29900'`,要做加法先 `int(...)`(Day 12)转成整数,29900 加 100 得 30000。

</div>

```text
$ uv run python part01/dict_zip.py
['T301', '计费', 'C023', '29900', '8月2日重复扣款,请退款']
{'id': 'T301', 'category': '计费', 'customer': 'C023', 'amount': '29900', 'desc': '8月2日重复扣款,请退款'}
计费 8月2日重复扣款,请退款
30000
```

<div class="line-notes">

- `['T301', '计费', 'C023', '29900', '8月2日重复扣款,请退款']` 拆出来的列表。
- `{'id': 'T301', 'category': '计费', 'customer': 'C023', 'amount': '29900', 'desc': '8月2日重复扣款,请退款'}` 配好名字的字典。金额的引号还在,说明它是字符串。
- `计费 8月2日重复扣款,请退款` 用名字取值。
- `30000` 转成整数再加。

</div>

### 金额还是字符串:报错和红线

如果忘了 `int(...)` 直接加,会发生什么?新建 `part01/dict_str_amount.py`:

```python
# agent-zero-lab/part01/dict_str_amount.py
line = "T301 29900"
ticket = dict(zip(["id", "amount"], line.split()))
print(ticket)
print(ticket["amount"] + 100)
```

<div class="line-notes">

- `line = "T301 29900"` 一行简化的工单,只有两段。
- `ticket = dict(zip(["id", "amount"], line.split()))` 字段名 `["id", "amount"]` 和 `line.split()` 拆出的两段配对。
- `print(ticket)` 输出 `{'id': 'T301', 'amount': '29900'}`,金额带引号,是字符串。
- `print(ticket["amount"] + 100)` 字符串加整数。

</div>

```text
$ uv run python part01/dict_str_amount.py
{'id': 'T301', 'amount': '29900'}
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/dict_str_amount.py", line 5, in <module>
    print(ticket["amount"] + 100)
          ~~~~~~~~~~~~~~~~~^~~~~
TypeError: can only concatenate str (not "int") to str
```

<div class="line-notes">

- `{'id': 'T301', 'amount': '29900'}` 注意 `'29900'` 的引号。
- `print(ticket["amount"] + 100)` 出错的那行,`^` 和 `~` 标出 `+` 两边。
- `TypeError: can only concatenate str (not "int") to str` 字符串只能和字符串拼接,不能和整数相加。又是字符串和整数混用的老问题,只是这次字符串藏在字典里。

</div>

这一步在编辑器里**不用跑**就能发现。basedpyright 对这一行画红线:

```text
/Users/你/agent-zero-lab/part01/dict_str_amount.py:5:7 - error: Operator "+" not supported for types "LiteralString" and "Literal[100]" (reportOperatorIssue)
```

<div class="line-notes">

- `dict_str_amount.py:5:7 - error: Operator "+" not supported` 第 5 行第 7 列,就是 `ticket["amount"]` 的开头。加号两边是「字符串」(`LiteralString`)和「整数 100」(`Literal[100]`),不支持。编辑器推断出这个字典里的值全是字符串(`dict(zip(...))` 的两边都是字符串列表),所以不用运行就知道会出错。

</div>

那为什么不干脆在存进字典时就把金额换成整数,`ticket["amount"] = int(ticket["amount"])`?这样写也能运行,但 basedpyright 会对这一行报红线,因为它认定这个字典「值都是字符串」,不让你放整数进去。想让一个字典里同时放字符串和整数而不报红线,要用到 Day 47 的 `TypedDict`。所以今天的做法是:**字典里的金额先保持字符串,用的时候写 `int(ticket["amount"])`**。今天后面的脚本都这样写,红线都是干净的。

## 按类别数张数

最常见的字典用法是计数:一批东西里,每一类各有几个。思路是让字典的键是「类别」,值是「到目前为止数到几个」。新建 `part01/count_category.py`:

```python
# agent-zero-lab/part01/count_category.py
categories = ["计费", "登录", "计费", "功能", "计费", "登录", "计费"]

counts_v1 = {}
for category in categories:
    if category in counts_v1:
        counts_v1[category] = counts_v1[category] + 1
    else:
        counts_v1[category] = 1
print("v1:", counts_v1)

counts = {}
for category in categories:
    counts[category] = counts.get(category, 0) + 1
print("v2:", counts, counts == counts_v1)

ranking = [(n, category) for category, n in counts.items()]
ranking.sort(reverse=True)
print(ranking)

for n, category in ranking:
    print(f"{category} {'#' * n} {n}")
```

<div class="line-notes">

- `categories = ["计费", "登录", "计费", "功能", "计费", "登录", "计费"]` 七张工单的类别:计费 4、登录 2、功能 1。
- `counts_v1 = {}` 从空字典开始。
- `for category in categories:` 逐个看类别。
- `if category in counts_v1:` 这个类别以前见过吗?`in` 判断键在不在。
- `counts_v1[category] = counts_v1[category] + 1` 见过:取出旧的数,加 1,存回去。
- `else:` 没见过。
- `counts_v1[category] = 1` 第一次见,写进去 1。
- `print("v1:", counts_v1)` 输出 `{'计费': 4, '登录': 2, '功能': 1}`。键的顺序是**第一次出现的顺序**:计费、登录、功能。
- `counts = {}` 第二种写法,同样从空字典开始。
- `for category in categories:` 同样的遍历。
- `counts[category] = counts.get(category, 0) + 1` 一行搞定:`counts.get(category, 0)` 取旧的数,没见过的类别当 0;加 1;存回去。第一次见 `计费` 时,`get` 返回默认值 0,存进去 1;第二次见,`get` 返回 1,存进去 2,以此类推。
- `print("v2:", counts, counts == counts_v1)` 两种写法的字典用 `==` 比较(Day 21 的相等),内容相同,输出 `True`。字典比较不看顺序,只看有没有同样的键和值。
- `ranking = [(n, category) for category, n in counts.items()]` 想按张数排名。字典不能直接排,先用推导式(Day 23)把每一对翻成 `(张数, 类别)` 的元组,**张数放前面**,这样排序时先比张数(Day 21 讲过元组排序)。这里 `for category, n in counts.items()` 又是解包。
- `ranking.sort(reverse=True)` 从大到小,原地排。
- `print(ranking)` 输出 `[(4, '计费'), (2, '登录'), (1, '功能')]`。
- `for n, category in ranking:` 遍历排好的元组,解包成 `n` 和 `category`。
- `print(f"{category} {'#' * n} {n}")` 画一个文字条形图:`'#' * n` 是把 `#` 重复 n 遍(字符串乘整数,Day 14 里 `"2" * 3` 那个坑的正面用法)。f-string 里面用了单引号,因为外面是双引号。

</div>

```text
$ uv run python part01/count_category.py
v1: {'计费': 4, '登录': 2, '功能': 1}
v2: {'计费': 4, '登录': 2, '功能': 1} True
[(4, '计费'), (2, '登录'), (1, '功能')]
计费 #### 4
登录 ## 2
功能 # 1
```

<div class="line-notes">

- `v1: {'计费': 4, '登录': 2, '功能': 1}` 第一种写法的结果。
- `v2: {'计费': 4, '登录': 2, '功能': 1} True` 第二种写法一样,`==` 为 `True`。
- `[(4, '计费'), (2, '登录'), (1, '功能')]` 排好的排名。
- `计费 #### 4` 计费 4 张,四个 `#`。
- `登录 ## 2` 登录 2 张。
- `功能 # 1` 功能 1 张。

</div>

`counts[category] = counts.get(category, 0) + 1` 这一行以后会写几十遍,值得现在记牢,第二天默写也先从它开始。标准库里有一个专门做这件事的 `collections.Counter`,以后读别人的代码会碰到;先不学它,因为你得先明白它替你做了什么。

## 小项目:拆成字典的工单报表

把今天的东西串起来。数据还是 Day 23 的 13 行原始工单(两个空行、一个全角 `Ｔ306`、一个只有三段的 T305、一个金额是 `abc` 的 T309)。这次要做的事:

1. 清洗、拆行,坏行(不是五段,或者金额不是纯数字)记下来;
2. 每张好工单拆成一个字典,不再用 `p[3]`;
3. 按类别数张数;按客户汇总金额;
4. 按工单号建一个查找表,`by_id["T308"]` 一步取到整张工单;
5. 找出退款相关的工单号,以及金额合计最高的客户。

新建 `part01/ticket_dicts.py`:

```python
# agent-zero-lab/part01/ticket_dicts.py
import unicodedata

FIELDS = ["id", "category", "customer", "amount", "desc"]

raw_lines = [
    "T301 计费 C023 29900 8月2日重复扣款,请退款",
    "  T302 登录 C007 0 验证码收不到 ",
    "",
    "T303 计费 C015 46800 年付多扣了,要求退款",
    "T304 功能 C031 0 导出PDF乱码",
    "T305 计费 C042",
    "Ｔ306 计费 C042 4900 发票金额对不上,多收了49元",
    "T307 登录 C007 0 Forgot password",
    "T308 计费 C031 29900 Refund request: charged twice",
    "T309 计费 C023 abc 金额字段坏了,要退款",
    "T310 计费 C023 59800 扣了两次,共598元,申请退款",
    "   ",
    "T311 计费 C015 4900 想要发票PDF",
]

tickets = []
bad_lines = []
for raw in raw_lines:
    line = unicodedata.normalize("NFKC", raw).strip()
    if not line:
        continue
    parts = line.split(maxsplit=4)
    if len(parts) != 5 or not parts[3].isdigit():
        bad_lines.append(line)
        continue
    ticket = dict(zip(FIELDS, parts))
    tickets.append(ticket)

print(f"可用 {len(tickets)} 张,坏行 {len(bad_lines)} 行")
print(tickets[0])

by_category = {}
for ticket in tickets:
    category = ticket["category"]
    by_category[category] = by_category.get(category, 0) + 1
print("各类别张数:", by_category)

amount_by_customer = {}
for ticket in tickets:
    customer = ticket["customer"]
    fen = int(ticket["amount"])
    amount_by_customer[customer] = amount_by_customer.get(customer, 0) + fen
print("各客户金额(分):", amount_by_customer)

by_id = {}
for ticket in tickets:
    by_id[ticket["id"]] = ticket
print("T308 是:", by_id["T308"]["desc"])
print("T999 在吗:", "T999" in by_id)

refund_ids = []
for ticket_id, ticket in by_id.items():
    if "退款" in ticket["desc"] or "refund" in ticket["desc"].lower():
        refund_ids.append(ticket_id)
print("退款相关:", refund_ids)

top_customer = ""
top_amount = -1
for customer, amount in amount_by_customer.items():
    if amount > top_amount:
        top_customer = customer
        top_amount = amount
print(f"金额最高的客户: {top_customer},{top_amount // 100} 元")
```

<div class="line-notes">

- `import unicodedata` Day 16 的全角转半角工具。
- `FIELDS = ["id", "category", "customer", "amount", "desc"]` 字段名放在一个大写的名字里,表示它是个常量,以后不会改(大写是 Python 程序员的约定,语法上没有区别)。
- `raw_lines = [` 13 行原始数据,和 Day 23 的 `refund_report.py` 一样。
- `"Ｔ306 计费 C042 4900 发票金额对不上,多收了49元",` 开头的 `Ｔ` 是全角字符,清洗之后变成普通 `T`。
- `tickets = []` 装好工单的列表,里面每一项将是一个字典。
- `bad_lines = []` 装坏行的列表。
- `for raw in raw_lines:` 一行一行处理。
- `line = unicodedata.normalize("NFKC", raw).strip()` 清洗:全角变半角,去掉两头空白。
- `if not line:` 清洗后是空串(`""` 和只有空格的行)。
- `continue` 跳过这一圈,直接去看下一行(Day 19)。这样后面的代码不用再多缩进一层。
- `parts = line.split(maxsplit=4)` 拆成最多五段。
- `if len(parts) != 5 or not parts[3].isdigit():` 坏行条件:段数不对,**或者**金额不是纯数字。`or` 有短路:`len(parts) != 5` 为真时,右边的 `parts[3]` 根本不会执行,所以三段的 T305 不会触发 `IndexError`。
- `bad_lines.append(line)` 把坏行存起来。
- `continue` 坏行处理完,也跳过这一圈。
- `ticket = dict(zip(FIELDS, parts))` 好行:字段名和五段配成字典。
- `tickets.append(ticket)` 加进列表。这时 `tickets` 是「列表套字典」,Day 26 会专门学。
- `print(f"可用 {len(tickets)} 张,坏行 {len(bad_lines)} 行")` 9 张好工单,2 行坏行。
- `print(tickets[0])` 第一张:`T301`,字典里金额还是字符串 `'29900'`。
- `by_category = {}` 按类别计数的字典。
- `for ticket in tickets:` 遍历好工单,每个 `ticket` 是一个字典。
- `category = ticket["category"]` 用名字取类别,不用记第几项。
- `by_category[category] = by_category.get(category, 0) + 1` 刚学的计数句式。
- `print("各类别张数:", by_category)` 计费 6、登录 2、功能 1,合计 9。
- `amount_by_customer = {}` 按客户汇总金额的字典。
- `for ticket in tickets:` 再遍历一遍。
- `customer = ticket["customer"]` 客户号。
- `fen = int(ticket["amount"])` 字典里的金额是字符串,先 `int(...)` 转成整数,放进名字 `fen`(「分」)。
- `amount_by_customer[customer] = amount_by_customer.get(customer, 0) + fen` 还是计数句式,只是这次加的不是 1 而是这张工单的金额:旧合计(没见过的客户当 0)加 `fen`。
- `print("各客户金额(分):", amount_by_customer)` 每个客户的金额合计,单位是分。
- `by_id = {}` 按工单号建查找表。
- `for ticket in tickets:` 遍历。
- `by_id[ticket["id"]] = ticket` 键是工单号,值是**整张工单字典**。这样以后用工单号一步取到整张工单。
- `print("T308 是:", by_id["T308"]["desc"])` 两层方括号:先 `by_id["T308"]` 取出整张工单字典,再 `["desc"]` 取描述。Day 26 会系统学这种「一层套一层」。
- `print("T999 在吗:", "T999" in by_id)` 没有这张工单,`in` 给 `False`,不报错。
- `refund_ids = []` 装退款相关工单号。
- `for ticket_id, ticket in by_id.items():` 遍历查找表的键值对:`ticket_id` 是工单号,`ticket` 是整张工单。
- `if "退款" in ticket["desc"] or "refund" in ticket["desc"].lower():` 描述里有「退款」或 `refund`。
- `refund_ids.append(ticket_id)` 记下工单号。
- `print("退款相关:", refund_ids)` 四个:T301、T303、T308、T310。
- `top_customer = ""` 找金额最高客户,先放一个空字符串占位。
- `top_amount = -1` 起始值取 -1,比任何合计都小(包括 0),第一个客户一定会替换它。
- `for customer, amount in amount_by_customer.items():` 遍历客户和合计。
- `if amount > top_amount:` 比当前最高的大。
- `top_customer = customer` 换人。
- `top_amount = amount` 换数。
- `print(f"金额最高的客户: {top_customer},{top_amount // 100} 元")` `//` 是整除(Day 12):89700 分 // 100 = 897 元。

</div>

```text
$ uv run python part01/ticket_dicts.py
可用 9 张,坏行 2 行
{'id': 'T301', 'category': '计费', 'customer': 'C023', 'amount': '29900', 'desc': '8月2日重复扣款,请退款'}
各类别张数: {'计费': 6, '登录': 2, '功能': 1}
各客户金额(分): {'C023': 89700, 'C007': 0, 'C015': 51700, 'C031': 29900, 'C042': 4900}
T308 是: Refund request: charged twice
T999 在吗: False
退款相关: ['T301', 'T303', 'T308', 'T310']
金额最高的客户: C023,897 元
```

<div class="line-notes">

- `可用 9 张,坏行 2 行` 13 行去掉两个空行是 11 行,T305 和 T309 是坏行,剩 9 张。和 Day 23 一致。
- `{'id': 'T301', 'category': '计费', 'customer': 'C023', 'amount': '29900', 'desc': '8月2日重复扣款,请退款'}` 第一张工单,每一项都有名字。
- `各类别张数: {'计费': 6, '登录': 2, '功能': 1}` 计费 T301、T303、T306、T308、T310、T311 共 6 张;登录 T302、T307;功能 T304。
- `各客户金额(分): {'C023': 89700, 'C007': 0, 'C015': 51700, 'C031': 29900, 'C042': 4900}` C023 有 T301(29900)和 T310(59800),合计 89700;C015 有 T303(46800)和 T311(4900),合计 51700;C007 的两张金额都是 0;C031 一张 T308(29900),T304 金额 0;C042 一张 T306(4900)。
- `T308 是: Refund request: charged twice` 用工单号一步取到描述。
- `T999 在吗: False` 查找表里没有。
- `退款相关: ['T301', 'T303', 'T308', 'T310']` 和 Day 23 的报表是同样四张。
- `金额最高的客户: C023,897 元` C023 的 89700 分最高。

</div>

对照 Day 23 的 `refund_report.py`:那边是 `p[3]`、`p[4]`,这边是 `ticket["amount"]`、`ticket["desc"]`。多出来的只有一行 `dict(zip(FIELDS, parts))`,换来的是每一处取值都不用再数下标。万一哪天工单格式加了一列,你只改 `FIELDS` 和拆行逻辑,后面按名字取值的代码一行都不用动;用下标的话每个 `p[3]` 都要逐个检查。

basedpyright 在 standard 档对今天这些正常脚本零报错;红线只出现在故意写错的三个文件里:`dict_str_amount.py`(字符串加整数)、`dict_list_key.py`(列表当键),以及 `dict_dup_key.py`(Ruff 的 `F601`)。

## 动手练习

### 练习 1:改一张工单

有一张工单字典 `{"id": "T201", "category": "计费", "amount": 29900}`。依次做这几件事,每做一步就 `print` 一次:

1. 取出 `id`;
2. 把金额改成 46800;
3. 加一个键 `status`,值是 `"open"`;
4. 删掉 `category`;
5. 判断有没有 `customer` 这个键;
6. 取 `customer`,没有就得到 `"未知"`,不能报错;
7. 最后打印字典有几对,以及所有的键。

写 `part01/ex24_1_ticket_edit.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex24_1_ticket_edit.py
ticket = {"id": "T201", "category": "计费", "amount": 29900}

print(ticket["id"])

ticket["amount"] = 46800
print(ticket)

ticket["status"] = "open"
print(ticket)

del ticket["category"]
print(ticket)

print("customer" in ticket)

print(ticket.get("customer", "未知"))

print(len(ticket), list(ticket))
```

<div class="line-notes">

- `ticket = {"id": "T201", "category": "计费", "amount": 29900}` 题目给的字典。
- `print(ticket["id"])` 第 1 步:方括号加键,输出 `T201`。
- `ticket["amount"] = 46800` 第 2 步:键已经存在,赋值就是改。
- `print(ticket)` 看到金额变成 46800。
- `ticket["status"] = "open"` 第 3 步:键不存在,赋值就是加。
- `print(ticket)` 末尾多了 `'status': 'open'`。
- `del ticket["category"]` 第 4 步:删掉一个键。
- `print(ticket)` 只剩 `id`、`amount`、`status`。
- `print("customer" in ticket)` 第 5 步:`in` 只看键,`customer` 从来没加过,`False`。
- `print(ticket.get("customer", "未知"))` 第 6 步:`get` 带默认值,不报错,得到 `未知`。
- `print(len(ticket), list(ticket))` 第 7 步:`len` 数键值对,3;`list(ticket)` 得到键的列表。

</div>

```text
$ uv run python part01/ex24_1_ticket_edit.py
T201
{'id': 'T201', 'category': '计费', 'amount': 46800}
{'id': 'T201', 'category': '计费', 'amount': 46800, 'status': 'open'}
{'id': 'T201', 'amount': 46800, 'status': 'open'}
False
未知
3 ['id', 'amount', 'status']
```

<div class="line-notes">

- `T201` 第 1 步。
- `{'id': 'T201', 'category': '计费', 'amount': 46800}` 第 2 步之后。
- `{'id': 'T201', 'category': '计费', 'amount': 46800, 'status': 'open'}` 第 3 步之后。
- `{'id': 'T201', 'amount': 46800, 'status': 'open'}` 第 4 步之后。
- `False` 没有客户号。
- `未知` 默认值。
- `3 ['id', 'amount', 'status']` 三对,三个键。

</div>

</details>

### 练习 2:先猜,再跑

不要先运行。下面的输出一共七行,每行是什么?先写下答案再核对。重点看第 2 行(`e` 和 `d` 是什么关系)、第 4 行(`2 in d` 是在问键还是值)和第 6 行(`pop` 的返回值)。

```python
# agent-zero-lab/part01/ex24_2_guess.py
d = {"a": 1, "b": 2}
d["a"] = 3
print(len(d), d)

e = d
e["c"] = 4
print(d)

print(d.get("z"), d.get("z", 0))
print("b" in d, 2 in d)
print(list(d), list(d.values()))
print(d.pop("b"), d)

total = 0
for value in d.values():
    total += value
print(total)
```

<details><summary>参考答案</summary>

```text
$ uv run python part01/ex24_2_guess.py
2 {'a': 3, 'b': 2}
{'a': 3, 'b': 2, 'c': 4}
None 0
True False
['a', 'b', 'c'] [3, 2, 4]
2 {'a': 3, 'c': 4}
7
```

<div class="line-notes">

- `2 {'a': 3, 'b': 2}` 第 1 行:先建 `{"a": 1, "b": 2}`,再 `d["a"] = 3` 改了 `a`,所以 `len` 是 2,`a` 变成 3,位置没动。
- `{'a': 3, 'b': 2, 'c': 4}` 第 2 行:`e = d` 不是复制,两个名字指同一个字典(Day 21 的 `b = a`)。通过 `e` 加了 `c`,`d` 也看到了。想要独立的副本要写 `d.copy()`。
- `None 0` 第 3 行:`d.get("z")` 没有这个键,给 `None`;`d.get("z", 0)` 给默认值 0。
- `True False` 第 4 行:`"b" in d` 是键,有;`2 in d` 问的是「有没有叫 2 的**键**」,没有,虽然 `b` 的**值**是 2。
- `['a', 'b', 'c'] [3, 2, 4]` 第 5 行:`list(d)` 是键,`list(d.values())` 是值,顺序是插入顺序。
- `2 {'a': 3, 'c': 4}` 第 6 行:`d.pop("b")` 返回被删掉的值 2,并且 `b` 不在字典里了。注意 `print` 先算出 `d.pop("b")` 再算 `d`,所以第二项已经是删完之后的字典。
- `7` 第 7 行:对剩下的值 3 和 4 求和。

</div>

</details>

### 练习 3:找出两个错

两段代码都想「数每个类别有几张」,第一段会崩,第二段不崩但结果是错的。运行它们,说出病因和改法。

```python
# agent-zero-lab/part01/ex24_3_bug.py
categories = ["计费", "登录", "计费", "功能", "计费"]

counts = {}
for category in categories:
    counts[category] += 1
print(counts)
```

```python
# agent-zero-lab/part01/ex24_3_bug_b.py
counts = {"计费": 3, "登录": 1, "功能": 1}

for category, n in counts:
    print(f"{category}: {n} 张")
```

<details><summary>参考答案</summary>

```text
$ uv run python part01/ex24_3_bug.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex24_3_bug.py", line 6, in <module>
    counts[category] += 1
    ~~~~~~^^^^^^^^^^
KeyError: '计费'
$ uv run python part01/ex24_3_bug_b.py
计: 费 张
登: 录 张
功: 能 张
```

<div class="line-notes">

- `File "/Users/你/agent-zero-lab/part01/ex24_3_bug.py", line 6, in <module>` 第一段崩在第 6 行。
- `counts[category] += 1` 崩的那一行。`+=` 要先**读**旧值再写回去,而 `counts` 是空字典,`计费` 这个键从来没出现过,读的时候就失败了。
- `KeyError: '计费'` 键 `计费` 不存在。改法:`counts[category] = counts.get(category, 0) + 1`,第一次见时当作旧值是 0。
- `计: 费 张` 第二段**没有任何报错**,三行输出全是错的:漏写了 `.items()`,`for category, n in counts:` 得到的是键 `"计费"`,恰好两个字,被拆成 `计` 和 `费`。
- `登: 录 张` 第二个类别同理。
- `功: 能 张` 第三个类别同理。改法:`for category, n in counts.items():`。

</div>

改完的版本 `part01/ex24_3_fixed.py`:

```python
# agent-zero-lab/part01/ex24_3_fixed.py
categories = ["计费", "登录", "计费", "功能", "计费"]

counts = {}
for category in categories:
    counts[category] = counts.get(category, 0) + 1
print(counts)

for category, n in counts.items():
    print(f"{category}: {n} 张")
```

<div class="line-notes">

- `categories = ["计费", "登录", "计费", "功能", "计费"]` 五个类别:计费 3、登录 1、功能 1。
- `counts = {}` 空字典。
- `for category in categories:` 遍历类别。
- `counts[category] = counts.get(category, 0) + 1` 取旧值(没有就 0),加 1,存回去。
- `print(counts)` 输出 `{'计费': 3, '登录': 1, '功能': 1}`。
- `for category, n in counts.items():` 加上 `.items()`,每圈得到一个 `(类别, 张数)` 元组并解包。
- `print(f"{category}: {n} 张")` 三行,每个类别一行。

</div>

```text
$ uv run python part01/ex24_3_fixed.py
{'计费': 3, '登录': 1, '功能': 1}
计费: 3 张
登录: 1 张
功能: 1 张
```

<div class="line-notes">

- `{'计费': 3, '登录': 1, '功能': 1}` 计数结果。
- `计费: 3 张` 解包出的类别和张数。
- `登录: 1 张` 第二个。
- `功能: 1 张` 第三个。

</div>

</details>

### 练习 4:按客户归拢

下面有七张工单,每张是 `(工单号, 客户号, 金额(分))` 的元组。写 `part01/ex24_4_by_customer.py`,做出两个字典:

- `ids_by_customer`:客户号 → 他的工单号**列表**;
- `total_by_customer`:客户号 → 金额合计。

再打印:每个客户几张、合计多少元;金额合计前两名;提过两张及以上工单的客户有哪些(用推导式)。

```python
rows = [
    ("T301", "C023", 29900),
    ("T302", "C007", 0),
    ("T303", "C015", 46800),
    ("T306", "C042", 4900),
    ("T308", "C031", 29900),
    ("T310", "C023", 59800),
    ("T311", "C015", 4900),
]
```

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex24_4_by_customer.py
rows = [
    ("T301", "C023", 29900),
    ("T302", "C007", 0),
    ("T303", "C015", 46800),
    ("T306", "C042", 4900),
    ("T308", "C031", 29900),
    ("T310", "C023", 59800),
    ("T311", "C015", 4900),
]

ids_by_customer = {}
total_by_customer = {}
for ticket_id, customer, fen in rows:
    if customer not in ids_by_customer:
        ids_by_customer[customer] = []
    ids_by_customer[customer].append(ticket_id)
    total_by_customer[customer] = total_by_customer.get(customer, 0) + fen

print(ids_by_customer)
print(total_by_customer)

for customer, ids in ids_by_customer.items():
    print(f"{customer}: {len(ids)} 张,合计 {total_by_customer[customer] // 100} 元")

ranking = [(fen, customer) for customer, fen in total_by_customer.items()]
ranking.sort(reverse=True)
print("前两名:", ranking[:2])

repeat_customers = [c for c, ids in ids_by_customer.items() if len(ids) >= 2]
print("提过两张以上的客户:", repeat_customers)
```

<div class="line-notes">

- `rows = [` 七张工单,每张是三项的元组。
- `("T301", "C023", 29900),` C023 的第一张。
- `("T303", "C015", 46800),` C015 的第一张。
- `("T310", "C023", 59800),` C023 的第二张,59800 分。
- `("T311", "C015", 4900),` C015 的第二张。
- `ids_by_customer = {}` 值是列表的字典:每个客户一个工单号列表。
- `total_by_customer = {}` 值是整数的字典:每个客户一个合计。
- `for ticket_id, customer, fen in rows:` 一圈取一个元组,直接解包成三个名字(Day 22)。
- `if customer not in ids_by_customer:` 这个客户第一次出现吗?
- `ids_by_customer[customer] = []` 第一次出现,先给他一个空列表。这一步是关键:**列表也要先建好**,否则下一行的 `append` 会 `KeyError`。
- `ids_by_customer[customer].append(ticket_id)` 取出这个客户的列表,往里加工单号。`ids_by_customer[customer]` 本身就是列表,所以后面直接接 `.append(...)`。
- `total_by_customer[customer] = total_by_customer.get(customer, 0) + fen` 计数句式,这次加的是金额。
- `print(ids_by_customer)` 输出 `{'C023': ['T301', 'T310'], ...}`。
- `print(total_by_customer)` 输出每个客户的合计分数。
- `for customer, ids in ids_by_customer.items():` 遍历客户和他的工单号列表。
- `print(f"{customer}: {len(ids)} 张,合计 {total_by_customer[customer] // 100} 元")` 用客户号去另一个字典里取合计,整除 100 换成元。
- `ranking = [(fen, customer) for customer, fen in total_by_customer.items()]` 把每一对翻成 `(合计, 客户号)` 元组。
- `ranking.sort(reverse=True)` 从大到小排。
- `print("前两名:", ranking[:2])` 切片取前两个。
- `repeat_customers = [c for c, ids in ids_by_customer.items() if len(ids) >= 2]` 推导式里同样可以遍历 `.items()` 并解包;`if` 里用 `len(ids)` 筛出工单号不少于 2 个的客户。

</div>

```text
$ uv run python part01/ex24_4_by_customer.py
{'C023': ['T301', 'T310'], 'C007': ['T302'], 'C015': ['T303', 'T311'], 'C042': ['T306'], 'C031': ['T308']}
{'C023': 89700, 'C007': 0, 'C015': 51700, 'C042': 4900, 'C031': 29900}
C023: 2 张,合计 897 元
C007: 1 张,合计 0 元
C015: 2 张,合计 517 元
C042: 1 张,合计 49 元
C031: 1 张,合计 299 元
前两名: [(89700, 'C023'), (51700, 'C015')]
提过两张以上的客户: ['C023', 'C015']
```

<div class="line-notes">

- `{'C023': ['T301', 'T310'], 'C007': ['T302'], 'C015': ['T303', 'T311'], 'C042': ['T306'], 'C031': ['T308']}` 每个客户一个工单号列表,键按第一次出现的顺序。
- `{'C023': 89700, 'C007': 0, 'C015': 51700, 'C042': 4900, 'C031': 29900}` 每个客户的合计:C023 是 29900 + 59800,C015 是 46800 + 4900。
- `C023: 2 张,合计 897 元` C023 两张,89700 分是 897 元。
- `C007: 1 张,合计 0 元` C007 一张,金额 0。
- `C015: 2 张,合计 517 元` C015 两张,51700 分是 517 元。
- `C042: 1 张,合计 49 元` C042 一张,49 元。
- `C031: 1 张,合计 299 元` C031 一张,299 元。
- `前两名: [(89700, 'C023'), (51700, 'C015')]` 合计最高的两位客户。
- `提过两张以上的客户: ['C023', 'C015']` 只有这两位提过两张。

</div>

</details>

**验收标准:** 四道题的脚本都跑通;练习 2 先自己写出七行答案再核对,错了的行回头看对应的小节;练习 3 说得出为什么第二段不报错却错了;练习 4 能不看答案写出「第一次出现先建空列表」那三行。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 字典(dict) | 用「键」找「值」的容器,写成 `{"id": "T201"}`。相当于 JS 的对象或 `Map` |
| 键(key) | 字典里的名字,用来找值。字符串、数字、元组可以当键 |
| 值(value) | 字典里和键配对的内容,什么类型都行 |
| 键值对(key-value pair) | 字典里的一项:一个键加它的值。`{"id": "T201"}` 有一对 |
| `KeyError` | 用方括号取了一个不存在的键。例如 `KeyError: 'customer'` |
| `.get(键, 默认值)` | 取值的另一种写法:键不存在时返回默认值(不写就是 `None`),不报错 |
| `.items()` | 返回所有键值对,每对是一个元组。`for k, v in d.items()` 是遍历字典的标准写法 |
| `.keys()` / `.values()` | 返回所有键 / 所有值 |
| `.pop(键)` | 删掉一个键并返回它的值;键不存在会 `KeyError`,可以给默认值避免 |
| `.update(另一个字典)` | 把另一个字典合并进来:没有的键加上,有的键覆盖 |
| `del d[键]` | 删掉一个键,不返回值 |
| 可哈希(hashable) | 能当字典键的东西:建好后不会变的类型(字符串、数字、元组)。列表不行,会报 `unhashable type: 'list'` |
| 插入顺序 | 字典按键第一次放进去的顺序保存和遍历,Python 3.7 起是语言保证 |
| 视图(view) | `.keys()`、`.values()`、`.items()` 返回的对象,不是列表,但能遍历,也能用 `list(...)` 转成列表 |
| 计数句式 | `counts[k] = counts.get(k, 0) + 1`,数每个类别各出现几次 |

## 常见误区

**以为取不存在的键会像 JS 一样给个 `undefined`。** 会 `KeyError`。键确定在的时候用方括号,可能不在的时候用 `.get()`。

**用 `or` 给 `.get()` 补默认值。** `ticket.get("amount") or "没填"` 在金额是 0 时会把真实的 0 当成「没填」。把默认值直接写进 `.get("amount", "没填")`。

**遍历字典漏写 `.items()`。** `for k, v in d:` 对两个字符的键不报错,但 `k` 和 `v` 是键拆开的两个字符;键更长就 `ValueError: too many values to unpack`。要键和值就写 `.items()`。

**遍历字典的同时往里加或删。** `RuntimeError: dictionary changed size during iteration`。遍历 `list(d.items())` 的抄本,或者另建一个新字典。

**`e = d` 以为复制了字典。** 两个名字指向同一个字典(和 Day 21 的列表一样),想要副本写 `d.copy()`。

**以为 `in` 查的是值。** `46800 in ticket` 问的是「有没有叫 46800 的键」。要查值,写 `46800 in ticket.values()`。

**拿整数去查字符串键。** `{"1": "一"}` 里 `d[1]` 是 `KeyError: 1`,`"1"` 和 `1` 是两个不同的键。从文本读出来的编号一般是字符串。

**键写了两遍。** `{"a": 1, "a": 3}` 不报错,后面的覆盖前面的,Ruff 会提示 `F601`。

**用列表当键。** `TypeError: cannot use 'list' as a dict key (unhashable type: 'list')`。换成元组。

**为了不报错到处写 `.get()`。** 键本来就该在的地方,让它 `KeyError` 才能尽早发现数据不对。

## 学习资料

### 文档与文章

- [Python 教程 · 字典](https://docs.python.org/zh-cn/3.12/tutorial/datastructures.html#dictionaries):中文,官方教程里字典一节,例子很短;后面接的「循环的技巧」里有 `.items()`。
- [Python 标准库 · 映射类型 dict](https://docs.python.org/zh-cn/3.12/library/stdtypes.html#mapping-types-dict):中文,字典所有方法的正式说明,`get`、`pop`、`update`、`items` 都在里面,当手册查。
- [Python 术语对照表(glossary)](https://docs.python.org/zh-cn/3.12/glossary.html):中文,查「hashable(可哈希)」「mapping(映射)」这两条,看官方怎么解释。
- [MDN · Map](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Map)、[Object.entries](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Object/entries):中文,JS 一侧对照,今天开头那段 Node 代码用到的就是它们。
- [Real Python · Dictionaries in Python](https://realpython.com/python-dicts/):英文,讲得全,有图;对爬虫返回 403,需要用浏览器打开。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1xM2vBoErX&autoplay=0&high_quality=1" title="5分钟学编程 · Python篇 #36｜字典（Dict）：键值对结构与常用方法" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>猫小申 · 5分钟学编程 · Python篇 #36｜字典(Dict):键值对结构与常用方法 · 6 分钟,2025 年底的新视频,概览一遍今天的读写删。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ehTQzBEMH&autoplay=0&high_quality=1" title="【Python 零基础】字典遍历 + 嵌套实战！10 分钟搞懂键值对操作" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>水哥澎湃 · 【Python 零基础】字典遍历 + 嵌套实战!10 分钟搞懂键值对操作 · 12 分钟,前半讲 `keys`、`values`、`items` 遍历,正好对着今天的 `dict_loop.py`;后半的嵌套留到 Day 26 再看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/_4wOvc-vt4k" title="Python Dictionaries: {key: value} Pairs #17" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Programiz · Python Dictionaries: {key: value} Pairs #17 · 英文,按「建、取、改、删、遍历」的顺序讲,和今天一致。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/4t10v2QmTHU" title="Python Dictionaries - Visually Explained" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Visually Explained · Python Dictionaries - Visually Explained · 英文,用动画解释字典是怎么按键找值的,看完更容易明白为什么列表不能当键。</figcaption>
</figure>

### 书籍

- Eric Matthes《Python Crash Course》第 3 版,No Starch Press,2023(中译《Python编程:从入门到实践》)。第 6 章「Dictionaries」从一个外星人游戏的字典讲起,有「遍历字典」「字典里嵌套」,今天和 Day 26 都能对上。
- Al Sweigart《Automate the Boring Stuff with Python》第 2 版,No Starch Press,2019。第 5 章「Dictionaries and Structuring Data」,有 `get()`、`setdefault()` 和用字典计数的例子。
- Luciano Ramalho《Fluent Python》第 2 版,O'Reilly,2022。第 3 章「Dictionaries and Sets」,讲字典内部怎么按键找值、为什么键要可哈希,比今天讲得深,以后再看;中文版第 2 版出版情况我没核实,按英文书名找。

### 开源项目与代码

- [Asabeneh/30-Days-Of-Python · Day 8 Dictionaries](https://github.com/Asabeneh/30-Days-Of-Python/tree/master/08_Day_Dictionaries):英文,每个方法一两行例子,后面有一批练习。
- [jackfrued/Python-100-Days · 13.常用数据结构之字典](https://github.com/jackfrued/Python-100-Days/blob/master/Day01-20/13.常用数据结构之字典.md):中文,字典的创建、运算、方法和遍历,例子偏生活化。

## 自测

1. `{"a": 1, "b": 2}["c"]` 会怎样?怎么改成不报错、给 0?

<details><summary>答案</summary>

`KeyError: 'c'`。改成 `{"a": 1, "b": 2}.get("c", 0)`,得到 0。

</details>

2. `for k, v in {"计费": 6, "登录": 2}:` 打印出什么?哪里错了?

<details><summary>答案</summary>

打印 `计 费` 和 `登 录`(各一行),没有报错但是错的。直接遍历字典拿到的是键,两个字的键被解包成了两个字符。要写 `for k, v in {...}.items():`。

</details>

3. `d = {"a": 1}`,执行 `e = d; e["b"] = 2` 之后 `d` 是什么?想要一个独立的副本怎么写?

<details><summary>答案</summary>

`{'a': 1, 'b': 2}`,`e = d` 只是多了一个名字,指向同一个字典。独立副本写 `e = d.copy()`。

</details>

4. 下面这个字典有几对?最终 `d["x"]` 是多少?

```python
d = {"x": 1, "y": 2, "x": 3}
```

<details><summary>答案</summary>

两对,`d["x"]` 是 3。重复的键不报错,后面的覆盖前面的(位置仍在第一次出现的地方)。Ruff 会提示 `F601`。

</details>

5. **面试题**:Python 字典的键为什么不能是列表?哪些类型可以?

<details><summary>答案</summary>

字典按键的哈希值找值,所以要求键「建好后不会变」(可哈希)。列表能增删改,如果它当键存进去之后被改了,哈希值就变了,字典再也找不到这一对,所以 Python 直接拒绝(`unhashable type: 'list'`)。字符串、数字、布尔值、`None`、元组(里面的东西也都不可变时)可以当键。

</details>

6. 下面这行想统计每个类别的张数,会报什么错?怎么改?

```python
counts = {}
for c in ["计费", "登录", "计费"]:
    counts[c] += 1
```

<details><summary>答案</summary>

`KeyError: '计费'`,`+=` 要先读旧值,而字典里一开始什么都没有。改成 `counts[c] = counts.get(c, 0) + 1`。

</details>

## 明天预告

Day 25 · 集合:去重和集合运算。今天的计数句式有个前提:你知道有哪些类别。如果只想知道「这批工单一共涉及哪些客户」「两批导出里哪些工单是重复的」,不需要数量,只关心「有没有」,那字典里的值就是多余的。明天学集合(set),相当于 JS 的 `Set`:一堆不重复的东西,没有顺序,不能按位置取,但它能一行去重,还能做交集、并集、差集:`A & B`、`A | B`、`A - B`。学完你就能找出两批工单的重复。
