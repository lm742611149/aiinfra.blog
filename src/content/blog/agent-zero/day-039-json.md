---
title: 'Day 39 · JSON:Python 和 JSON 互转'
description: '用 json.dumps 和 json.loads 在 Python 字典和 JSON 文本之间来回转,对照你熟悉的 JSON.stringify / JSON.parse;弄清 ensure_ascii 为什么会把中文变成 发、哪些 Python 类型转不过去、坏 JSON 报什么错,最后把昨天的竖线工单文件改存成 JSON。'
pubDate: 2026-10-22
regime: none
tags: ['python', 'json', 'agent-zero']
series: 'agent-zero'
day: 39
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 38](/blog/agent-zero/day-038-files-with/) 学了读写文件:`open(path, "w", encoding="utf-8")` 写、`"a"` 追加、默认的 `"r"` 读,用 `with` 让 Python 自动 close,还亲手看到了没 close 时另一个读者读到的是空字符串。最后拼了一个 `ticket_store.py`,把工单一行一张、字段用竖线 `|` 隔开存进文本文件。

那个格式有两个毛病。一是标题里只要出现一个 `|`,split 出来就不是三段了,整行被当成坏数据;二是读回来的金额全是字符串 `"199"`,要算合计还得自己 `float()`。今天换成 JSON,这两个问题一起消失。

## 今天要解决的问题

学完今天,你应该能:

1. 用 `json.dumps` 把字典、列表变成 JSON 字符串,用 `json.loads` 把 JSON 字符串变回来,并说出它们和 `JSON.stringify` / `JSON.parse` 的对应关系。
2. 解释 `ensure_ascii=False` 是干什么的,说出不加它时中文会变成什么样。
3. 说出哪些 Python 值转成 JSON 后回不来原样(元组、数字键),哪些根本转不了(集合),并读懂 `JSONDecodeError` 的报错位置。
4. 用 `json.dump` / `json.load` 直接读写 JSON 文件,把工单存成 `tickets.json` 再读回来。

预计用时:2 小时。前置:[Day 24](/blog/agent-zero/day-024-dicts/) 的字典、[Day 26](/blog/agent-zero/day-026-nested-data/) 的嵌套数据、[Day 35](/blog/agent-zero/day-035-exceptions-1/) 的 try/except、[Day 36](/blog/agent-zero/day-036-exceptions-2/) 的 `raise ... from`、[Day 38](/blog/agent-zero/day-038-files-with/) 的 with open。

学法:先对照文章逐行敲一遍(不要复制粘贴)并跑通;第二天合上文章,把最后的 `ticket_json_store.py` 默写出来;再做动手练习,做不出来再展开参考答案,看完关掉自己重写一遍。

命令都在项目根目录 `agent-zero-lab` 里跑,新文件放进 `part01/`。`json` 是 Python 自带的标准库模块,不用 `uv add`。今天不调 API,花费 0 元。

## JSON 你其实早就会了

前端天天和 JSON 打交道:`fetch` 回来调一下 `res.json()`,发请求前 `JSON.stringify(body)`,`localStorage` 里存对象也得先 stringify。**JSON**(JavaScript Object Notation,JS 对象表示法)本质上就是一种**文本格式**:用字符串写出来的对象、数组、数字、布尔和 null。它长得像 JS 对象字面量,但规矩更严,键必须用双引号,不能有注释,最后一项后面不能带逗号。

为什么 Agent 工程师离不开它?你后面要调的大模型 API,请求体是 JSON,响应是 JSON;模型想调用一个工具时,给你的参数是一段 **JSON 字符串**,你得自己把它解析成字典才能用。可以说,从第二部分开始,你写的每个 Agent 都在 `json.loads` 和 `json.dumps` 之间来回倒腾。

先对一下表:

| JS | Python | 方向 |
| --- | --- | --- |
| `JSON.stringify(obj)` | `json.dumps(obj)` | 对象 → JSON 字符串 |
| `JSON.parse(text)` | `json.loads(text)` | JSON 字符串 → 对象 |
| `JSON.stringify(obj, null, 2)` | `json.dumps(obj, indent=2)` | 带缩进,给人看 |
| `fs.writeFileSync(p, JSON.stringify(obj))` | `json.dump(obj, f)` | 直接写进打开的文件 |
| `JSON.parse(fs.readFileSync(p, "utf8"))` | `json.load(f)` | 直接从打开的文件读 |
| `SyntaxError: Unexpected token` | `json.JSONDecodeError` | 解析失败时的异常 |

名字很好记:**带 s 的处理字符串**(dump**s** = dump string),不带 s 的处理文件。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="Python 字典通过 dumps 变成 JSON 字符串,通过 loads 变回字典;dump 直接写进文件,load 直接从文件读">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="70" width="160" height="70" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="100" y="98" text-anchor="middle" fill="var(--ink)">Python 字典/列表</text>
<text x="100" y="120" text-anchor="middle" fill="var(--ink-soft)" font-size="11">{'amount': 199}</text>
<rect x="250" y="70" width="160" height="70" rx="4" fill="none" stroke="var(--rule)"/>
<text x="330" y="98" text-anchor="middle" fill="var(--ink)">JSON 字符串</text>
<text x="330" y="120" text-anchor="middle" fill="var(--ink-soft)" font-size="11">'{"amount": 199}'</text>
<rect x="470" y="70" width="150" height="70" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="545" y="98" text-anchor="middle" fill="var(--ink)">硬盘上的文件</text>
<text x="545" y="120" text-anchor="middle" fill="var(--ink-soft)" font-size="11">tickets.json</text>
<line x1="180" y1="90" x2="250" y2="90" stroke="var(--mem)"/>
<text x="215" y="82" text-anchor="middle" fill="var(--ink)" font-size="11">dumps</text>
<line x1="250" y1="122" x2="180" y2="122" stroke="var(--mem)"/>
<text x="215" y="138" text-anchor="middle" fill="var(--ink)" font-size="11">loads</text>
<line x1="410" y1="105" x2="470" y2="105" stroke="var(--rule)"/>
<text x="440" y="98" text-anchor="middle" fill="var(--ink-faint)" font-size="11">write</text>
<path d="M100 70 C100 20, 545 20, 545 70" fill="none" stroke="var(--compute)" stroke-dasharray="5 3"/>
<text x="322" y="34" text-anchor="middle" fill="var(--ink)" font-size="11">dump(obj, f):一步写进文件</text>
<path d="M545 140 C545 200, 100 200, 100 140" fill="none" stroke="var(--compute)" stroke-dasharray="5 3"/>
<text x="322" y="196" text-anchor="middle" fill="var(--ink)" font-size="11">load(f):一步从文件读回</text>
</g>
</svg>
<figcaption>带 s 的两个函数在「对象」和「字符串」之间转;不带 s 的两个函数把「转」和「读写文件」合成一步。</figcaption>
</figure>

## 第一步:dumps 和 loads

新建 `part01/json_basic.py`。这一步故意先用英文标题,中文的事留到第二步单独讲:

```python
# agent-zero-lab/part01/json_basic.py
import json

ticket = {"id": "T-1001", "title": "invoice", "amount": 199, "paid": True, "note": None}

text = json.dumps(ticket)
print(type(text))
print(text)
print(str(ticket))

back = json.loads(text)
print(type(back))
print(back)
print(back == ticket)
print(back["amount"] + 1)
```

<div class="line-notes">

- `import json` 导入标准库的 json 模块,[Day 32](/blog/agent-zero/day-032-modules/) 讲过 import。它是 Python 自带的,不用装。
- `ticket = {"id": "T-1001", "title": "invoice", "amount": 199, "paid": True, "note": None}` 一个普通字典,故意放了五种值:两个字符串、一个整数、一个布尔、一个 None。
- `text = json.dumps(ticket)` dumps 读作「dump string」,把字典转成 JSON 格式的**字符串**,相当于 `JSON.stringify(ticket)`。
- `print(type(text))` 实测 `<class 'str'>`。转完就是一段普通字符串,可以写文件、可以拼进请求体、可以发给模型。
- `print(text)` 实测 `{"id": "T-1001", "title": "invoice", "amount": 199, "paid": true, "note": null}`。注意三处变化:单引号变成了双引号,`True` 变成了 `true`,`None` 变成了 `null`。这些都是 JSON 的写法,和 JS 一样。
- `print(str(ticket))` 对比一下直接 `str()`。实测 `{'id': 'T-1001', 'title': 'invoice', 'amount': 199, 'paid': True, 'note': None}`,单引号、大写 True、None,这是 **Python 的写法**,不是 JSON。看着很像,但别的程序(包括 JS 的 `JSON.parse`)读不了它。
- `back = json.loads(text)` loads 是「load string」,把 JSON 字符串解析回 Python 对象,相当于 `JSON.parse(text)`。
- `print(type(back))` 实测 `<class 'dict'>`,JSON 对象变回了字典。
- `print(back)` 实测 `{'id': 'T-1001', 'title': 'invoice', 'amount': 199, 'paid': True, 'note': None}`,`true` 和 `null` 又变回了 `True` 和 `None`。
- `print(back == ticket)` 实测 `True`。字典的 `==` 比较的是内容,来回转一圈,内容一模一样。
- `print(back["amount"] + 1)` 实测 `200`。金额读回来就是整数 199,能直接算,不用像昨天那样 `float("199")`。

</div>

```bash
uv run python part01/json_basic.py
```

实测输出:

```text
<class 'str'>
{"id": "T-1001", "title": "invoice", "amount": 199, "paid": true, "note": null}
{'id': 'T-1001', 'title': 'invoice', 'amount': 199, 'paid': True, 'note': None}
<class 'dict'>
{'id': 'T-1001', 'title': 'invoice', 'amount': 199, 'paid': True, 'note': None}
True
200
```

第二行和第三行放在一起看,区别就清楚了。我见过不少人想把字典存成 JSON,结果写的是 `f.write(str(d))`,文件看上去「差不多」,一用 `json.loads` 读就报错。第四步会演示那个报错长什么样。

和 JS 还有一点不同值得说一下:JS 的 `JSON.parse` 返回的是一个普通对象,你可以 `obj.amount` 也可以 `obj["amount"]`;Python 的 `json.loads` 返回的是字典,只能 `back["amount"]`,写 `back.amount` 会报 `AttributeError`。想用点号访问,得自己定义类,那是明天的事。

## 第二步:中文和 ensure_ascii

把标题换成中文。新建 `part01/json_chinese.py`:

```python
# agent-zero-lab/part01/json_chinese.py
import json

ticket = {"id": "T-1001", "title": "发票抬头开错了", "amount": 199}

a = json.dumps(ticket)
b = json.dumps(ticket, ensure_ascii=False)
print(a)
print(b)
print(len(a), len(b))
print(json.loads(a) == json.loads(b))

print(json.dumps(ticket, ensure_ascii=False, indent=2))
```

<div class="line-notes">

- `a = json.dumps(ticket)` 不加任何参数。
- `b = json.dumps(ticket, ensure_ascii=False)` `ensure_ascii` 默认是 `True`,意思是「保证输出里只有 ASCII 字符」。ASCII 是最早的那套字符表,只有英文字母、数字和常用符号,没有汉字。设成 `False` 就是「别管了,中文原样输出」。
- `print(a)` 实测 `{"id": "T-1001", "title": "发票抬头开错了", "amount": 199}`。七个汉字全变成了 `\uXXXX`,这叫 **Unicode 转义**:`发` 就是「发」这个字在 Unicode 里的编号 53d1(十六进制)。JS 字符串里写 `"发"` 也是「发」,是同一套规则。
- `print(b)` 实测 `{"id": "T-1001", "title": "发票抬头开错了", "amount": 199}`,人能直接看懂。
- `print(len(a), len(b))` 实测 `86 51`。转义版每个汉字占 6 个字符(`发`),比原样长了 35 个字符。我顺手算了字节数:转义版 86 字节,原样版 65 字节(UTF-8 里一个汉字 3 字节,Day 38 讲过)。
- `print(json.loads(a) == json.loads(b))` 实测 `True`。两种写法读回来完全一样,`ensure_ascii` 只影响「写出来长什么样」,不影响内容。
- `print(json.dumps(ticket, ensure_ascii=False, indent=2))` `indent=2` 表示每一层缩进 2 个空格,相当于 `JSON.stringify(obj, null, 2)`。

</div>

实测输出:

```text
{"id": "T-1001", "title": "发票抬头开错了", "amount": 199}
{"id": "T-1001", "title": "发票抬头开错了", "amount": 199}
86 51
True
{
  "id": "T-1001",
  "title": "发票抬头开错了",
  "amount": 199
}
```

`发` 这种写法是合法 JSON,任何解析器都能读回中文,所以它不是 bug。问题在于人看不懂:你打开日志文件想找「发票」两个字,搜不到;把它拼进提示词发给模型,模型多半也能认,但这一串转义通常比原文占更多 token,花的是你的钱。我的习惯是**只要输出里可能有中文,一律写 `ensure_ascii=False`**。

那为什么 Python 默认是 `True`?历史原因,早年很多系统只认 ASCII,转义保证了「到哪都不会乱码」。JS 的 `JSON.stringify` 默认不转义中文,所以前端同学第一次见到 `发` 会以为数据坏了。

`indent` 什么时候加?写给人看的文件(配置、导出的工单)加 `indent=2`;发给接口、发给模型的不加,省空间。

## 第三步:哪些东西转过去就回不来

JSON 只有六种值:对象、数组、字符串、数字、布尔、null。Python 的类型比这多,多出来的要么被「凑合」成某个 JSON 类型,要么直接报错。新建 `part01/json_types.py`:

```python
# agent-zero-lab/part01/json_types.py
import json

data = {
    "tags": ("billing", "refund"),
    1001: "按数字当键",
    "price": 19.9,
    "count": 3,
}
text = json.dumps(data, ensure_ascii=False)
print(text)
back = json.loads(text)
print(back)
print(back == data)
print(type(back["tags"]), list(back.keys()))

json.dumps({"tags": {"billing", "refund"}})
```

<div class="line-notes">

- `"tags": ("billing", "refund"),` 值是一个元组([Day 22](/blog/agent-zero/day-022-tuples-unpack/) 学的)。JSON 没有元组。
- `1001: "按数字当键",` 键是整数 1001。JSON 对象的键只能是字符串。
- `"price": 19.9,` 浮点数,JSON 里叫 number。
- `"count": 3,` 整数,JSON 里也叫 number。JSON 不区分整数和小数,和 JS 一样。
- `text = json.dumps(data, ensure_ascii=False)` 转。
- `print(text)` 实测 `{"tags": ["billing", "refund"], "1001": "按数字当键", "price": 19.9, "count": 3}`。元组变成了数组 `[...]`,整数键 `1001` 变成了字符串 `"1001"`。dumps 没报错,它悄悄帮你「凑合」了。
- `back = json.loads(text)` 读回来。
- `print(back)` 实测 `{'tags': ['billing', 'refund'], '1001': '按数字当键', 'price': 19.9, 'count': 3}`。
- `print(back == data)` 实测 `False`。来回一圈,数据变了:元组成了列表,`1001` 成了 `'1001'`。
- `print(type(back["tags"]), list(back.keys()))` 实测 `<class 'list'> ['tags', '1001', 'price', 'count']`。数字 19.9 和 3 倒是原样回来了,JSON 里写 `3` 读回来是 int,写 `19.9` 读回来是 float。
- `json.dumps({"tags": {"billing", "refund"}})` 值是一个集合([Day 25](/blog/agent-zero/day-025-sets/) 学的)。集合没有可以凑合的 JSON 类型,这次直接报错。

</div>

实测输出(中间四行是 json 模块内部的调用,我省略了):

```text
{"tags": ["billing", "refund"], "1001": "按数字当键", "price": 19.9, "count": 3}
{'tags': ['billing', 'refund'], '1001': '按数字当键', 'price': 19.9, 'count': 3}
False
<class 'list'> ['tags', '1001', 'price', 'count']
Traceback (most recent call last):
  File ".../agent-zero-lab/part01/json_types.py", line 17, in <module>
    json.dumps({"tags": {"billing", "refund"}})
  File ".../python3.12/json/__init__.py", line 231, in dumps
    return _default_encoder.encode(obj)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  ...
  File ".../python3.12/json/encoder.py", line 180, in default
    raise TypeError(f'Object of type {o.__class__.__name__} '
TypeError: Object of type set is not JSON serializable
```

`not JSON serializable` 意思是「不能序列化成 JSON」。**序列化**(serialize)就是把内存里的对象变成一串可以存、可以传的文本或字节,dumps 干的就是这个;反过来叫**反序列化**,loads 干的事。这个报错以后你会经常见到,除了集合,明天写的类的实例、日期时间对象,也都会触发它。解决办法是转之前先变成 JSON 认识的类型,比如 `list(s)` 或者 `sorted(s)`。

整理成一张对照表,以后忘了回来查:

| Python | 转成 JSON | 读回 Python |
| --- | --- | --- |
| dict | 对象 `{}` | dict(**非字符串的键变成字符串**) |
| list | 数组 `[]` | list |
| tuple | 数组 `[]` | **list**,回不来元组 |
| str | 字符串 | str |
| int / float | 数字 | int / float |
| True / False | `true` / `false` | True / False |
| None | `null` | None |
| set、自己写的类 | **报 TypeError** | |

## 第四步:坏 JSON 和 JSONDecodeError

dumps 出来的永远是合法 JSON,出问题的总是 loads:别人给你的、模型给你的、人手改过的文本,不一定合法。新建 `part01/json_bad.py`,四段文本里只有第一段是对的:

```python
# agent-zero-lab/part01/json_bad.py
import json

samples = [
    '{"id": "T-1001", "amount": 199}',
    "{'id': 'T-1001', 'amount': 199}",
    '{"id": "T-1001", "amount": 199,}',
    '好的,结果如下:{"id": "T-1001"}',
]

for s in samples:
    try:
        print("OK  ", json.loads(s))
    except json.JSONDecodeError as e:
        print("坏的", e.msg, "| 第", e.lineno, "行第", e.colno, "列")

print(issubclass(json.JSONDecodeError, ValueError))
json.loads(samples[1])
```

<div class="line-notes">

- `'{"id": "T-1001", "amount": 199}',` 合法 JSON。外面用单引号括起来是 Python 字符串的写法,里面全是双引号,这才是 JSON。
- `"{'id': 'T-1001', 'amount': 199}",` 键和值用的是单引号,这正是 `str(字典)` 打印出来的样子。JSON 不认单引号。
- `'{"id": "T-1001", "amount": 199,}',` 最后多了一个逗号。JS 对象字面量允许尾逗号,JSON 不允许。
- `'好的,结果如下:{"id": "T-1001"}',` JSON 部分本身是对的,但前面多了一句客套话。大模型被要求「只返回 JSON」时,还是会时不时这样回,或者在前后包上 Markdown 代码块的三个反引号。
- `for s in samples:` 逐段试。
- `print("OK  ", json.loads(s))` 只有第一段能走到这里,实测 `OK   {'id': 'T-1001', 'amount': 199}`。
- `except json.JSONDecodeError as e:` 解析失败抛的是 `json.JSONDecodeError`。它定义在 json 模块里,所以要写 `json.` 前缀。
- `print("坏的", e.msg, "| 第", e.lineno, "行第", e.colno, "列")` 这个异常对象带着三个很有用的属性:`msg` 是原因,`lineno` 是第几行,`colno` 是第几列(都从 1 开始数)。实测第二段 `Expecting property name enclosed in double quotes | 第 1 行第 2 列`:第 2 列就是那个单引号,解析器在等一个「用双引号括起来的属性名」。第三段同样的原因,位置是第 32 列,正好是尾逗号后面那个 `}`:看到逗号,它以为后面还有一个键。第四段 `Expecting value | 第 1 行第 1 列`,第一个字符是「好」,解析器在等一个 JSON 值(`{`、`[`、引号、数字……),一开头就对不上。
- `print(issubclass(json.JSONDecodeError, ValueError))` `issubclass(A, B)` 问「A 是不是 B 的子类」,实测 `True`。所以写 `except ValueError` 也能接住它,[Day 36](/blog/agent-zero/day-036-exceptions-2/) 练习 2 里 `AmountError(TicketError)` 就是同一个道理。
- `json.loads(samples[1])` 不接,让它崩一次,看完整报错。

</div>

实测输出:

```text
OK   {'id': 'T-1001', 'amount': 199}
坏的 Expecting property name enclosed in double quotes | 第 1 行第 2 列
坏的 Expecting property name enclosed in double quotes | 第 1 行第 32 列
坏的 Expecting value | 第 1 行第 1 列
True
Traceback (most recent call last):
  File ".../agent-zero-lab/part01/json_bad.py", line 18, in <module>
    json.loads(samples[1])
  ...
json.decoder.JSONDecodeError: Expecting property name enclosed in double quotes: line 1 column 2 (char 1)
```

读最后一行([Day 35](/blog/agent-zero/day-035-exceptions-1/) 教的,traceback 从下往上读):`line 1 column 2` 是第 1 行第 2 列,`char 1` 是从 0 开始数的第 1 个字符,两种说法指同一个位置。异常类型显示成 `json.decoder.JSONDecodeError`,因为它真正定义在 `json.decoder` 这个子模块里,`json.JSONDecodeError` 是同一个东西的短名字。

第四段那种「JSON 前面带了几个字」或者「被代码块包住」的回复,你在第二部分调模型时一定会遇到。到时候的做法是先让模型用 JSON 模式输出,再在解析前把多余的部分剥掉;今天你只要记住:**loads 外面要包 try**,不管文本是谁给的。

## 第五步:dump 和 load,直接读写文件

前面几步都在字符串和字典之间转。存文件当然可以先 `dumps` 再 `write`,但 json 模块直接提供了一步到位的版本。新建 `part01/json_file.py`:

```python
# agent-zero-lab/part01/json_file.py
import json
from pathlib import Path

path = Path(__file__).resolve().parent / "data" / "one.json"
ticket = {"id": "T-1001", "title": "发票抬头开错了", "amount": 199}

with open(path, "w", encoding="utf-8") as f:
    json.dump(ticket, f, ensure_ascii=False, indent=2)

print(path.read_text(encoding="utf-8"))

with open(path, encoding="utf-8") as f:
    back = json.load(f)
print(back["title"], back["amount"] * 2)
```

<div class="line-notes">

- `path = Path(__file__).resolve().parent / "data" / "one.json"` 昨天建好的 `part01/data/` 目录,今天放一个 `one.json`。
- `with open(path, "w", encoding="utf-8") as f:` 昨天学的写模式。`encoding="utf-8"` 照写,因为下一行用了 `ensure_ascii=False`,文件里会有真正的中文字节。
- `json.dump(ticket, f, ensure_ascii=False, indent=2)` 第一个参数是要存的对象,第二个参数是**打开的文件对象**(不是路径)。它在内部做了 dumps,然后把结果 write 进 f。
- `print(path.read_text(encoding="utf-8"))` 原样看一眼文件内容,实测是带缩进的四行半 JSON,中文原样。
- `with open(path, encoding="utf-8") as f:` 读模式打开。
- `back = json.load(f)` 从文件对象里读出全部内容再 loads。返回字典。
- `print(back["title"], back["amount"] * 2)` 实测 `发票抬头开错了 398`,金额是整数,能直接乘。

</div>

实测输出:

```text
{
  "id": "T-1001",
  "title": "发票抬头开错了",
  "amount": 199
}
发票抬头开错了 398
```

我更常用的其实是 Path 的一行写法:`path.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")` 和 `json.loads(path.read_text(encoding="utf-8"))`。两种写法效果一样,选一种用顺手就行,练习里两种都会出现。

## 把零件拼起来:工单存成 JSON 再读回

把昨天的 `ticket_store.py` 改成 JSON 版。新建 `part01/ticket_json_store.py`:

```python
# agent-zero-lab/part01/ticket_json_store.py
import json
from pathlib import Path
from typing import Any

DATA = Path(__file__).resolve().parent / "data" / "tickets.json"


class TicketError(Exception):
    pass


def save_tickets(path: Path, tickets: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(tickets, f, ensure_ascii=False, indent=2)


def load_tickets(path: Path) -> list[dict[str, Any]]:
    with open(path, encoding="utf-8") as f:
        try:
            data = json.load(f)
        except json.JSONDecodeError as e:
            raise TicketError(f"{path.name} 不是合法 JSON: 第 {e.lineno} 行第 {e.colno} 列 {e.msg}") from e
    if not isinstance(data, list):
        raise TicketError(f"{path.name} 最外层应该是列表,实际是 {type(data).__name__}")
    return data


def append_ticket(path: Path, ticket: dict[str, Any]) -> None:
    tickets = load_tickets(path) if path.exists() else []
    tickets.append(ticket)
    save_tickets(path, tickets)


save_tickets(DATA, [
    {"id": "T-1001", "title": "发票抬头开错了", "amount": 199},
    {"id": "T-1005", "title": "升级套餐 | 年付", "amount": 399},
])
append_ticket(DATA, {"id": "T-1007", "title": "发票邮件没收到", "amount": 0, "tags": ["email"]})

tickets = load_tickets(DATA)
for t in tickets:
    print(t["id"], t["title"], t["amount"])
print("合计:", sum(t["amount"] for t in tickets))
print(DATA.read_text(encoding="utf-8"))

with open(DATA, "a", encoding="utf-8") as f:
    f.write(',{"id": "T-1008"}\n')
load_tickets(DATA)
```

<div class="line-notes">

- `from typing import Any` `Any` 是类型标注里的「什么类型都行」。昨天工单的值全是字符串,写 `dict[str, str]`;今天值里有字符串、整数、列表,就写 `dict[str, Any]`。[Day 46](/blog/agent-zero/day-046-type-hints-2/) 会细讲,今天知道它的意思就够了。
- `DATA = Path(__file__).resolve().parent / "data" / "tickets.json"` 文件名从 `tickets.txt` 换成 `tickets.json`。
- `class TicketError(Exception):` Day 36 的老朋友。
- `def save_tickets(path: Path, tickets: list[dict[str, Any]]) -> None:` 整批写入。和昨天的区别:昨天在 for 里一行行拼竖线,今天一行 `json.dump` 搞定。
- `path.parent.mkdir(parents=True, exist_ok=True)` 目录不在就建,昨天讲过。
- `json.dump(tickets, f, ensure_ascii=False, indent=2)` 把整个列表写成一个 JSON 数组。
- `def load_tickets(path: Path) -> list[dict[str, Any]]:` 读回来。
- `try:` json.load 可能失败,包起来。
- `data = json.load(f)` 解析整个文件。
- `except json.JSONDecodeError as e:` 接住解析错误。
- `raise TicketError(f"{path.name} 不是合法 JSON: 第 {e.lineno} 行第 {e.colno} 列 {e.msg}") from e` Day 36 学的 `raise ... from e`:换成我们自己的 TicketError,带上文件名和位置,并保留原始错误。调用方只需要 `except TicketError`。
- `if not isinstance(data, list):` 合法 JSON 不一定是我们要的形状。有人把文件改成了一个对象 `{...}` 而不是数组 `[...]`,json.load 不会报错,得自己检查。`isinstance(值, 类型)` 判断一个值是不是某个类型,返回 True/False。
- `raise TicketError(f"{path.name} 最外层应该是列表,实际是 {type(data).__name__}")` `type(data).__name__` 拿到类型的名字,比如 `dict`。
- `return data` 实测返回 3 个字典组成的列表。
- `def append_ticket(path: Path, ticket: dict[str, Any]) -> None:` 追加一张。**注意它和昨天完全不一样**:昨天用 `"a"` 模式直接往后写一行;JSON 文件是一个完整的数组,不能往 `]` 后面硬接,只能「读出全部 → 列表 append → 整个重写」。
- `tickets = load_tickets(path) if path.exists() else []` 一行 if/else(条件表达式,相当于 JS 的三元 `a ? b : c`):文件在就读,不在就从空列表开始。
- `tickets.append(ticket)` Day 21 的列表 append。
- `save_tickets(path, tickets)` 整个写回去。
- `{"id": "T-1005", "title": "升级套餐 | 年付", "amount": 399},` 标题里故意带了竖线,昨天的格式会被它搞坏。
- `append_ticket(DATA, {"id": "T-1007",` 第三张多了一个 `tags` 列表。JSON 能装嵌套结构,每张工单的字段也可以不一样多。
- `tickets = load_tickets(DATA)` 读回来。
- `print(t["id"], t["title"], t["amount"])` 实测三行,第二行 `T-1005 升级套餐 | 年付 399`,竖线完好无损。
- `print("合计:", sum(t["amount"] for t in tickets))` `sum(... for ...)` 是 [Day 23](/blog/agent-zero/day-023-comprehensions/) 推导式的近亲,把每张的金额加起来。实测 `合计: 598`,整数,不用转换。
- `print(DATA.read_text(encoding="utf-8"))` 看一眼文件真实的样子。
- `with open(DATA, "a", encoding="utf-8") as f:` 演示错误做法:用昨天的 `"a"` 往 JSON 文件后面追加。
- `f.write(',{"id": "T-1008"}\n')` 接在 `]` 后面写了一段,文件从此不是合法 JSON 了。
- `load_tickets(DATA)` 再读,触发 TicketError。

</div>

```bash
uv run python part01/ticket_json_store.py
```

实测输出:

```text
T-1001 发票抬头开错了 199
T-1005 升级套餐 | 年付 399
T-1007 发票邮件没收到 0
合计: 598
[
  {
    "id": "T-1001",
    "title": "发票抬头开错了",
    "amount": 199
  },
  {
    "id": "T-1005",
    "title": "升级套餐 | 年付",
    "amount": 399
  },
  {
    "id": "T-1007",
    "title": "发票邮件没收到",
    "amount": 0,
    "tags": [
      "email"
    ]
  }
]
Traceback (most recent call last):
  File ".../agent-zero-lab/part01/ticket_json_store.py", line 22, in load_tickets
    data = json.load(f)
           ^^^^^^^^^^^^
  ...
json.decoder.JSONDecodeError: Extra data: line 20 column 2 (char 250)

The above exception was the direct cause of the following exception:

Traceback (most recent call last):
  File ".../agent-zero-lab/part01/ticket_json_store.py", line 50, in <module>
    load_tickets(DATA)
  File ".../agent-zero-lab/part01/ticket_json_store.py", line 24, in load_tickets
    raise TicketError(f"{path.name} 不是合法 JSON: 第 {e.lineno} 行第 {e.colno} 列 {e.msg}") from e
TicketError: tickets.json 不是合法 JSON: 第 20 行第 2 列 Extra data
```

`Extra data` 是「多出来的数据」:解析器读完第 20 行第 1 列的 `]`,一个完整的 JSON 数组已经结束了,后面居然还有东西。中间那句 `The above exception was the direct cause of the following exception` 是 `from e` 的效果,Day 36 讲过:上面是原始的 JSONDecodeError,下面是我们翻译后的 TicketError,两段都在。

这个崩溃告诉你一件很实际的事:**JSON 文件不能用 `"a"` 追加**。要「不停往后加一条」的场景(日志、对话记录),行业里的做法是换一种格式,每行一个独立的 JSON 对象,叫 JSON Lines,练习 2 会写一个。

和昨天对比:

| | 昨天 `tickets.txt`(竖线) | 今天 `tickets.json` |
| --- | --- | --- |
| 标题带 `\|` | 整行被当成格式错误 | 没影响 |
| 金额 | 读回来是 `"199"` 字符串 | 读回来是整数 `199` |
| 多一个字段(tags) | 要改格式和解析代码 | 直接加 |
| 追加一张 | `"a"` 模式写一行 | 读出、append、整体重写 |
| 人能不能直接看懂 | 能 | 能(加 `indent=2`) |

零件对照:

| 前面的零件 | 在 ticket_json_store.py 里是哪一段 |
| --- | --- |
| 第二步 `ensure_ascii=False`、`indent=2` | `save_tickets` 里的 `json.dump(...)` |
| 第四步 `except json.JSONDecodeError` | `load_tickets` 里的 try |
| 第五步 `json.dump` / `json.load` 配 with | `save_tickets` 和 `load_tickets` |
| Day 36 `raise ... from e` | JSONDecodeError 翻译成 TicketError |
| Day 38 `"w"` 和 `"a"` | `save_tickets` 用 `"w"`;最后那段错误示范用 `"a"` |

## 动手练习

**练习 1:解析一次工具调用的参数。** 第三部分你会看到,模型决定调用退款工具时,给你的参数是一段 JSON 字符串。现在先用两段写死的字符串模拟:一段合法、一段用了单引号。写一个循环逐段解析,合法的打印工单号、原因和金额,并算出金额的两倍;不合法的打印报错并继续。文件名 `part01/ex39_args.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex39_args.py
import json

raw_good = '{"ticket_id": "T-1002", "reason": "重复扣费", "amount": 99.5}'
raw_bad = "{'ticket_id': 'T-1002', 'reason': '重复扣费', 'amount': 99.5}"

for raw in [raw_good, raw_bad]:
    try:
        args = json.loads(raw)
    except json.JSONDecodeError as e:
        print("参数不是合法 JSON:", e)
        continue
    print(args["ticket_id"], args["reason"], "退款", args["amount"], "元")
    print("退两次就是", args["amount"] * 2)
```

<div class="line-notes">

- `raw_good = '{"ticket_id": "T-1002", "reason": "重复扣费", "amount": 99.5}'` 合法 JSON,金额是小数。
- `raw_bad = "{'ticket_id': 'T-1002', 'reason': '重复扣费', 'amount': 99.5}"` 单引号版本。
- `args = json.loads(raw)` 解析。
- `except json.JSONDecodeError as e:` 接住解析失败。
- `print("参数不是合法 JSON:", e)` 直接打印异常对象就是完整的报错句子。实测 `参数不是合法 JSON: Expecting property name enclosed in double quotes: line 1 column 2 (char 1)`。
- `continue` Day 19 学的,跳过本轮剩下的代码,去处理下一段。
- `print(args["ticket_id"], args["reason"], "退款", args["amount"], "元")` 实测 `T-1002 重复扣费 退款 99.5 元`。
- `print("退两次就是", args["amount"] * 2)` 实测 `退两次就是 199.0`。JSON 里的 `99.5` 读回来是 float,能直接算。

</div>

实测输出:

```text
T-1002 重复扣费 退款 99.5 元
退两次就是 199.0
参数不是合法 JSON: Expecting property name enclosed in double quotes: line 1 column 2 (char 1)
```

真实的 Agent 里,解析失败时通常会把这句报错原样回传给模型,让它重新生成参数。报错写得清楚,模型才改得对。

</details>

**练习 2:JSON Lines 日志。** 写一个脚本,把三条 Agent 运行事件(用户提问、调用工具、回复)逐条追加进 `part01/data/events.jsonl`,每条占一行;再逐行读回来,打印每条的 `step` 和 `type`。脚本开头先删掉旧文件,保证每次跑结果一样。文件名 `part01/ex39_jsonl.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex39_jsonl.py
import json
from pathlib import Path

log = Path(__file__).resolve().parent / "data" / "events.jsonl"
log.unlink(missing_ok=True)

events = [
    {"step": 1, "type": "user", "text": "我被扣了两次钱"},
    {"step": 2, "type": "tool", "name": "lookup_invoice", "ok": True},
    {"step": 3, "type": "reply", "text": "已为您申请退款"},
]
for e in events:
    with open(log, "a", encoding="utf-8") as f:
        f.write(json.dumps(e, ensure_ascii=False) + "\n")

print(log.read_text(encoding="utf-8"), end="")

with open(log, encoding="utf-8") as f:
    for line in f:
        event = json.loads(line)
        print(event["step"], event["type"])
```

<div class="line-notes">

- `log = Path(__file__).resolve().parent / "data" / "events.jsonl"` 扩展名 `.jsonl` 是 JSON Lines 的惯例。
- `log.unlink(missing_ok=True)` `unlink` 是 Path 删除文件的方法(和终端的 `rm` 一样)。`missing_ok=True` 表示文件本来就不存在也别报错,第一次运行时就是这种情况。
- `events = [` 三个事件字典,字段各不相同也没关系。
- `with open(log, "a", encoding="utf-8") as f:` 每条事件都用追加模式打开一次。真实的 Agent 里事件是一条一条陆续产生的,所以就是这样一条一条追加。
- `f.write(json.dumps(e, ensure_ascii=False) + "\n")` 关键行:每个事件 dumps 成一行(不加 indent,否则一个事件会占好几行),末尾自己加换行。
- `print(log.read_text(encoding="utf-8"), end="")` 实测三行,第二行是 `{"step": 2, "type": "tool", "name": "lookup_invoice", "ok": true}`,`True` 写成了 `true`。
- `for line in f:` Day 38 的逐行读。
- `event = json.loads(line)` 每一行单独 loads。`line` 末尾带着 `\n`,loads 会忽略首尾的空白,所以不用 rstrip。
- `print(event["step"], event["type"])` 实测 `1 user`、`2 tool`、`3 reply`。

</div>

实测输出:

```text
{"step": 1, "type": "user", "text": "我被扣了两次钱"}
{"step": 2, "type": "tool", "name": "lookup_invoice", "ok": true}
{"step": 3, "type": "reply", "text": "已为您申请退款"}
1 user
2 tool
3 reply
```

JSON Lines 两边的好处都占了:每行是合法 JSON,能装嵌套结构;文件整体又是「一行一条」,能用 `"a"` 追加,中间某行坏了也不影响其他行。后面讲可观测时,Agent 的运行记录很多就是这个格式。

</details>

**练习 3:观察会发生什么。** 下面的代码用整数当键统计「优先级 → 工单数」,存成 JSON 再读回来。先猜最后两个 print 各会怎样,再新建 `part01/ex39_keys.py` 跑一下。

```python
# agent-zero-lab/part01/ex39_keys.py
import json

counts = {1: 5, 2: 3}
back = json.loads(json.dumps(counts))
print(back)
print(back["1"])
print(back[1])
```

<div class="line-notes">

- `counts = {1: 5, 2: 3}` 优先级 1 有 5 张,优先级 2 有 3 张,键是整数。
- `back = json.loads(json.dumps(counts))` 一行里先转过去再转回来。
- `print(back)` 实测 `{'1': 5, '2': 3}`,键变成了字符串。
- `print(back["1"])` 实测 `5`。
- `print(back[1])` 用整数 1 去取,实测报 `KeyError: 1`。

</div>

<details><summary>参考答案</summary>

实测输出:

```text
{'1': 5, '2': 3}
5
Traceback (most recent call last):
  File ".../agent-zero-lab/part01/ex39_keys.py", line 8, in <module>
    print(back[1])
          ~~~~^^^^
KeyError: 1
```

JSON 对象的键只能是字符串,dumps 时把 `1` 悄悄变成了 `"1"`,loads 回来就是字符串键。Python 字典里 `1` 和 `"1"` 是两个不同的键,所以 `back[1]` 找不到。JS 里不会遇到这个问题,因为 JS 对象的键本来就会被转成字符串,`obj[1]` 和 `obj["1"]` 是同一个。存 JSON 时键最好一开始就用字符串。

</details>

**练习 4:读一整个目录的工单。** [Day 37](/blog/agent-zero/day-037-pathlib/) 在 `part01/tickets/` 下用 touch 建了 `T-1001.json`、`T-1002.json` 和 `archive/T-0901.json` 三个空文件。现在往 `T-1001.json` 和 `archive/T-0901.json` 里各写一张工单,`T-1002.json` 保持为空。然后用 `rglob("*.json")` 找出所有工单文件逐个读,读不了的打印原因并跳过,最后打印金额合计。文件名 `part01/ex39_folder.py`。(如果你没有 Day 37 的目录,先跑一遍那天开头的 `mkdir` 和 `touch` 命令。)

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex39_folder.py
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
folder = HERE / "tickets"

(folder / "T-1001.json").write_text(
    json.dumps({"id": "T-1001", "title": "发票抬头开错了", "amount": 199}, ensure_ascii=False),
    encoding="utf-8",
)
(folder / "archive" / "T-0901.json").write_text(
    json.dumps({"id": "T-0901", "title": "旧工单", "amount": 50}, ensure_ascii=False),
    encoding="utf-8",
)

total = 0
for path in sorted(folder.rglob("*.json")):
    try:
        with open(path, encoding="utf-8") as f:
            ticket = json.load(f)
    except json.JSONDecodeError as e:
        print("跳过", path.name, "->", e)
        continue
    total += ticket["amount"]
    print("读到", ticket["id"], ticket["amount"])
print("合计", total)
```

<div class="line-notes">

- `HERE = Path(__file__).resolve().parent` Day 37 的老写法,脚本所在目录。
- `(folder / "T-1001.json").write_text(` 用 Path 的一行写法,先把路径用括号包起来再调方法。
- `json.dumps({"id": "T-1001", "title": "发票抬头开错了", "amount": 199}, ensure_ascii=False),` 先 dumps 成字符串,再交给 write_text 写进文件。
- `encoding="utf-8",` write_text 也要写 encoding。
- `(folder / "archive" / "T-0901.json").write_text(` 子目录里那张也写上内容。
- `total = 0` 合计。
- `for path in sorted(folder.rglob("*.json")):` Day 37 的 rglob 加 sorted,顺序是 `T-1001.json`、`T-1002.json`、`archive/T-0901.json`。
- `with open(path, encoding="utf-8") as f:` 逐个打开。
- `ticket = json.load(f)` T-1002 是空文件,空字符串不是合法 JSON,这里会抛异常。
- `except json.JSONDecodeError as e:` 接住。
- `print("跳过", path.name, "->", e)` 实测 `跳过 T-1002.json -> Expecting value: line 1 column 1 (char 0)`。`char 0` 说明文件一个字符都没有。
- `continue` 跳到下一个文件。
- `total += ticket["amount"]` 累加金额。
- `print("读到", ticket["id"], ticket["amount"])` 实测 `读到 T-1001 199` 和 `读到 T-0901 50`。
- `print("合计", total)` 实测 `合计 249`。

</div>

实测输出:

```text
读到 T-1001 199
跳过 T-1002.json -> Expecting value: line 1 column 1 (char 0)
读到 T-0901 50
合计 249
```

空文件报的是 `Expecting value: line 1 column 1 (char 0)`,以后看到 `char 0` 就先怀疑是不是文件是空的,或者接口返回了空响应。

</details>

验收标准:四个练习的输出和上面一致;不看文章能写出 `json.dumps(obj, ensure_ascii=False, indent=2)` 和带 try 的 `json.loads`;能说出 dumps / loads / dump / load 四个函数各自的输入输出;能解释为什么 JSON 文件不能用 `"a"` 追加。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| JSON | 一种文本格式,用字符串写出对象、数组、字符串、数字、布尔和 null。键必须双引号,不能有尾逗号和注释 |
| json 模块 | Python 自带的标准库,`import json` 就能用 |
| json.dumps | 对象 → JSON 字符串,≈ `JSON.stringify` |
| json.loads | JSON 字符串 → 对象,≈ `JSON.parse` |
| json.dump / json.load | 和上面一样,但直接写进 / 读自一个打开的文件对象 |
| ensure_ascii | dumps/dump 的参数,默认 True 会把中文转成 `\uXXXX`;写 False 中文原样输出 |
| Unicode 转义 | `发` 这种写法,`\u` 加 4 位十六进制编号表示一个字符,这里是「发」 |
| indent | 缩进空格数,`indent=2` 让输出分行缩进,给人看 |
| 序列化 / 反序列化 | 把内存里的对象变成可存可传的文本(dumps),和反过来(loads) |
| JSONDecodeError | loads/load 解析失败时的异常,是 ValueError 的子类,带 `msg`、`lineno`、`colno` |
| not JSON serializable | dumps 遇到 JSON 表示不了的类型(set、自己写的类)时 TypeError 的报错内容 |
| isinstance | `isinstance(值, 类型)`,判断值是不是这个类型 |
| Any | 类型标注里的「什么类型都行」,来自 `typing` 模块,Day 46 细讲 |
| JSON Lines(.jsonl) | 每行一个独立 JSON 对象的文件格式,可以用 `"a"` 追加 |

## 常见误区

**用 `str(字典)` 代替 `json.dumps`。** 打出来是 `{'id': 'T-1001', 'paid': True}`,单引号加大写 True,这是 Python 的写法,不是 JSON。用 `json.loads` 读它实测报 `Expecting property name enclosed in double quotes: line 1 column 2 (char 1)`。要 JSON 就用 dumps。

**忘了 `ensure_ascii=False`。** 中文全变成 `发票...`,数据没坏,但日志里搜不到中文,发给模型也更费 token。只要可能有中文就加上。

**以为来回转一圈数据不会变。** 元组回来变列表,整数键回来变字符串键,实测 `back == data` 是 `False`;集合直接报 `TypeError: Object of type set is not JSON serializable`。

**loads 不包 try。** 模型输出、用户上传、人手改过的文件都可能不是合法 JSON,尾逗号、单引号、JSON 前面多了一句话,都实测会抛 JSONDecodeError。拿到外部文本先 try。

**用 `"a"` 往 JSON 文件追加。** 实测 `Extra data: line 20 column 2`,整个文件从此读不了。JSON 文件要「读出 → 改 → 整体写回」;要不停追加就用 JSON Lines。

**把文件路径传给 `json.load`。** `json.load` 要的是打开的文件对象,不是路径。写成 `json.load(path)` 会报 `AttributeError: 'PosixPath' object has no attribute 'read'`,它想调 `.read()` 却发现传进来的是个 Path。要么先 `with open`,要么用 `json.loads(path.read_text(encoding="utf-8"))`。

## 学习资料

### 文档与文章

- [Python 标准库 · json(中文)](https://docs.python.org/zh-cn/3.12/library/json.html):官方文档,开头的「基本使用」几个例子和今天几乎一一对应,往下翻能看到 dumps 所有参数的说明,以及今天那张类型对照表的官方版。
- [Python 官方教程 · 7.2.2 使用 json 保存结构化数据(中文)](https://docs.python.org/zh-cn/3.12/tutorial/inputoutput.html):在页面里找「使用 json 保存结构化数据」一节,只有几段,适合先看。
- [json.org 中文页](https://www.json.org/json-zh.html):JSON 格式本身的定义,几张语法图把「什么是合法 JSON」画得很清楚,看完就知道为什么不能有尾逗号。
- [MDN · JSON.stringify()](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify):你熟悉的那一边,对照着看它的 `space` 参数和 Python 的 `indent`。
- [菜鸟教程 · Python3 JSON 数据解析](https://www.runoob.com/python3/python3-json.html):中文速查,类型对照表和例子都有。
- [JSON Lines](https://jsonlines.org/):练习 2 那个格式的说明页,一页就讲完了,英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1p2ZWBHEqQ&autoplay=0&high_quality=1" title="【Python 零基础】JSON 的基础使用与文件数据交互" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>水哥澎湃 · 【Python 零基础】JSON 的基础使用与文件数据交互 · 约 14 分钟,2026 年的视频,dumps/loads 和读写文件都讲了,节奏适合 0 基础。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Nh411U7ei&autoplay=0&high_quality=1" title="如何用 Python 读写 JSON 数据?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>王树义老师 · 如何用 Python 读写 JSON 数据? · 约 10 分钟,用一个真实数据文件演示读和写,可以和第五步对照着看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/9N6a-VLBa2I" title="Python Tutorial: Working with JSON Data using the json Module" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Tutorial: Working with JSON Data using the json Module · 英文,前半段讲 dumps/loads/dump/load 四个函数,和今天的顺序一致;后半段从网络接口拉 JSON,第二部分学 HTTP 时可以回来看。</figcaption>
</figure>

### 书籍

- 《Python 编程:从入门到实践(第 3 版)》,Eric Matthes 著,人民邮电出版社。第 10 章「文件和异常」最后一节「存储数据」用 json 模块存用户数据,写法正好是 `path.write_text(json.dumps(...))`,和今天第五步末尾讲的一行写法一样。
- 《Automate the Boring Stuff with Python, 3rd Edition》,Al Sweigart 著,No Starch Press。[第 10 章在线版](https://automatetheboringstuff.com/3e/chapter10.html)讲读写文件,英文,可以和昨天、今天一起复习。

### 开源项目与代码

- [openai-python 的 `_completions.py`](https://github.com/openai/openai-python/blob/main/src/openai/lib/_parsing/_completions.py):OpenAI 官方 Python SDK 里解析工具调用参数的代码。在页面里搜 `json.loads(function.arguments)`,模型给的工具参数就是这样被一行 loads 变成字典的,和练习 1 做的事一样。
- [CPython 的 `Lib/json/__init__.py`](https://github.com/python/cpython/blob/3.12/Lib/json/__init__.py):json 模块的源码。搜 `def dumps`,能看到 `ensure_ascii=True` 就写在默认参数里;再看 `def load`,它的实现就是 `loads(fp.read(), ...)`,不带 s 的版本确实只是先 read 再 loads。

## 自测

1. `json.dumps({"ok": True, "x": None})` 的结果是什么?类型是什么?

<details><summary>答案</summary>

字符串 `'{"ok": true, "x": null}'`,类型是 `str`。`True` 变成 `true`,`None` 变成 `null`,键用双引号。

</details>

2. 不加 `ensure_ascii=False` 时,`json.dumps({"t": "发"})` 会输出什么?这样的 JSON 能被正确读回中文吗?

<details><summary>答案</summary>

输出 `{"t": "发"}`。能,`发` 是合法的 Unicode 转义,`json.loads` 读回来就是「发」。它只是人看不懂、更占长度。

</details>

3. 下面哪几段能被 `json.loads` 成功解析?不能的说出原因。
   `'[1, 2, 3]'`、`"{'a': 1}"`、`'{"a": 1,}'`、`'"hello"'`、`''`

<details><summary>答案</summary>

`'[1, 2, 3]'` 能,得到列表。`'"hello"'` 也能,一个单独的 JSON 字符串也是合法 JSON,得到 `'hello'`。`"{'a': 1}"` 不能,JSON 不认单引号。`'{"a": 1,}'` 不能,有尾逗号。`''` 不能,空字符串报 `Expecting value: line 1 column 1 (char 0)`。

</details>

4. 为什么 `ticket_json_store.py` 的 `append_ticket` 不能像昨天那样用 `"a"` 模式直接写一行?

<details><summary>答案</summary>

JSON 文件是一个完整的数组 `[...]`,往 `]` 后面接内容会让文件变成不合法的 JSON,实测读的时候报 `Extra data`。只能把整个列表读出来、append 之后整体重写;要追加写就改用 JSON Lines,每行一个独立对象。

</details>

5. 面试题:你的 Agent 让模型返回 JSON,线上偶尔会出现 `json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)`。你会从哪几个方向排查?

<details><summary>答案</summary>

`line 1 column 1 (char 0)` 说明第一个字符就不对。常见三种:模型返回了空字符串(被截断、被安全策略拦了、超时);模型在 JSON 前面加了文字或者 Markdown 代码块的反引号;拿去解析的变量根本不是模型的正文(取错字段)。排查时先把解析前的原始文本完整打进日志,看清第一个字符是什么;修法上用模型的 JSON 模式或结构化输出、解析前剥掉代码块、解析失败时把报错回传给模型重试,并给重试设上限。

</details>

## 明天预告

[Day 40 · 类(一):class、__init__ 和 self](/blog/agent-zero/day-040-classes-1/)。今天工单全是字典,`t["titel"]` 这种拼错的键要到运行时才报 KeyError,读回来也只能用方括号取值。明天学 Python 的 class,对照你写过的 JS class,把工单做成一个 `Ticket` 类,用 `t.title` 访问,再给它写 `to_dict` 方法,和今天的 JSON 接上。
