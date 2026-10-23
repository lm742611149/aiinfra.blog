---
title: 'Day 16 · 字符串(二):常用方法、中文和编码'
description: 'strip、removesuffix、replace、split、join、in、find 这几个字符串方法把脏输入洗干净、把工单行拆开;汉字在内存里是一个字符,存进文件或发到网络上是 3 个字节(UTF-8),编码用错就是乱码。最后让 ask_amount.py 同时认 299元、¥19.99、1,234,567 和全角数字。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'agent-zero']
series: 'agent-zero'
day: 16
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 15](/blog/agent-zero/day-015-strings-1/) 学了字符串的索引和切片,还有 f-string。最后留了两个尾巴:按固定位置切工单行,工单号一变成 `T1000` 所有字段一起错位;`ask_amount.py` 遇到 `299元` 还是崩,用 `price_text[:-1]` 去掉最后一个字符是在碰运气。

今天用字符串自带的**方法**解决这两件事:`split()` 按空格拆,不管工单号几位;`removesuffix("元")` 只在末尾真有「元」的时候才去掉。另外 Day 14 里留下的 `1,234,567` 转不了整数的问题,`replace` 一行就解决。顺着这些方法,还要把「中文在计算机里是怎么存的」讲清楚,因为你迟早会在读文件、发请求、数 token 的时候碰到乱码和字节数。

## 今天要解决的问题

学完今天,你应该能:

1. 用 `strip`、`removeprefix`、`removesuffix`、`replace` 清洗字符串,知道所有方法都返回新字符串、原字符串纹丝不动,说出 `strip(".com")` 的陷阱。
2. 用 `split` 和 `join` 把一行文字拆成几段、再拼回去,用 `in`、`startswith`、`find`、`count` 查找,看到 `ValueError: substring not found` 知道是 `index` 找不到。
3. 说清楚字符、码点、字节的区别:`len("计费")` 是 2,`"计费".encode()` 的长度是 6;知道 UTF-8 和 GBK 的差别,看到乱码和 `UnicodeDecodeError` 知道是编码对不上。
4. 把 `ask_amount.py` 改成能吃 `299元`、` 299 `、`¥19.99`、`1,234,567`、`１９．９９ 元` 这些脏输入;写出 `part01/ticket_card2.py` 用 `split` 解析工单行。

预计用时:2.5 小时。常用方法 70 分钟,中文和编码 50 分钟,拼起来 20 分钟,剩下做练习。方法一共有十来个,不用背,知道有哪些、需要时回来查就行,重点是理解「原串不变」和「编码」这两个概念。

前置:[Day 14](/blog/agent-zero/day-014-bool-none/)(`ValueError`、`ask_amount.py`)、[Day 15](/blog/agent-zero/day-015-strings-1/)(索引、切片、f-string)。今天不调任何 API,花费 0 元。

学法提示:先对照文章逐行敲一遍(代码自己敲,不复制粘贴)并跑通;第二天合上文章,把 `ask_amount.py` 的清洗那几行和 `ticket_card2.py` 默写出来;然后做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先说清楚我是在哪跑的

输出是我 2026-10-23 在 2019 款 Intel MacBook Pro(macOS 14、zsh)上用演示家目录真跑的,家目录显示成 `/Users/你`,`~/agent-zero-lab` 接着 Day 15 的状态(`rich` 是 Day 10 装的,`ruff` 是 Day 13 装进 dev 组的),`uv run python` 是 3.12.13,Ruff 是 0.17.2。今天的脚本都放在 `part01/`,在仓库根目录用 `uv run python part01/文件名.py` 运行。要从键盘读输入的脚本,和前两天一样,我用管道喂输入来记录输出,下面贴的是你在终端里敲的时候会看到的样子。

## 字符串方法

### 方法是什么,为什么原字符串不会变

`len(s)` 是把字符串放进函数。还有一类写法是 `s.strip()`:字符串后面点一个名字再加括号,这叫调用字符串的**方法**。方法是「属于这类数据」的函数,字符串有字符串的方法,Day 21 的列表有列表的方法。JS 里 `s.trim()` 也是这个写法,你已经熟悉。

Day 15 说过字符串不可变,所以**字符串的方法从不修改原来的字符串,而是返回一个新字符串**。这条规律你会反复看到,先记住。下面是 JS 方法和 Python 方法的对照,今天会逐个用到:

| 想做的事 | JS | Python |
| --- | --- | --- |
| 去掉两头空白 | `s.trim()` | `s.strip()` |
| 去掉左边/右边空白 | `s.trimStart()` / `s.trimEnd()` | `s.lstrip()` / `s.rstrip()` |
| 去掉指定的开头/结尾 | 没有现成的 | `s.removeprefix(x)` / `s.removesuffix(x)` |
| 替换 | `s.replace(a, b)`(只换第一个)<br>`s.replaceAll(a, b)` | `s.replace(a, b)`(全部都换) |
| 拆开 | `s.split(",")` | `s.split(",")` |
| 拼起来 | `arr.join(",")` | `",".join(列表)` |
| 是否包含 | `s.includes(x)` | `x in s` |
| 开头/结尾是不是 | `s.startsWith(x)` / `s.endsWith(x)` | `s.startswith(x)` / `s.endswith(x)` |
| 找位置 | `s.indexOf(x)`(找不到是 -1) | `s.find(x)`(找不到是 -1)<br>`s.index(x)`(找不到报错) |
| 大小写 | `s.toUpperCase()` / `s.toLowerCase()` | `s.upper()` / `s.lower()` |

注意两个反着来的地方:`join` 在 JS 里是数组的方法,在 Python 里是**分隔符字符串**的方法;`replace` 在 JS 里只换第一个,在 Python 里全换。

### strip:去掉两头的空白

从键盘、网页表单、文件里读来的文字,两头经常带着看不见的空格、制表符、换行。新建 `part01/strip_demo.py`:

```python
# agent-zero-lab/part01/strip_demo.py
raw = "  T001 计费 C023  "
print(repr(raw))
print(repr(raw.strip()))
print(repr(raw.lstrip()))
print(repr(raw.rstrip()))
print(repr(raw))
print(len(raw), len(raw.strip()))

print("***T001***".strip("*"))
print("cloudledger.com".strip(".com"))
```

<div class="line-notes">

- `raw = "  T001 计费 C023  "` 前面两个空格、后面两个空格。
- `print(repr(raw))` `repr()` 是内置函数,把字符串连引号一起打印出来,首尾的空格才看得见。调试字符串问题时它比 `print` 好用。
- `print(repr(raw.strip()))` `strip()` 去掉两头的空白(空格、制表符、换行都算),中间的不动。
- `print(repr(raw.lstrip()))` 只去左边。`l` 是 left。
- `print(repr(raw.rstrip()))` 只去右边。`r` 是 right。
- `print(repr(raw))` 原来的 `raw` 有没有变?
- `print(len(raw), len(raw.strip()))` 对比长度。
- `print("***T001***".strip("*"))` 括号里给一个字符串,去掉的就不是空白,而是「这个字符串里出现的任何字符」。
- `print("cloudledger.com".strip(".com"))` 这是个陷阱,看下面的输出。

</div>

```text
$ cd ~/agent-zero-lab
$ uv run python part01/strip_demo.py
'  T001 计费 C023  '
'T001 计费 C023'
'T001 计费 C023  '
'  T001 计费 C023'
'  T001 计费 C023  '
16 12
T001
loudledger
```

<div class="line-notes">

- `'  T001 计费 C023  '` 带引号打印,首尾各两个空格清清楚楚。
- `'T001 计费 C023'` `strip()` 之后两头干净。
- `'T001 计费 C023  '` `lstrip()` 只去了左边,右边的两个空格还在。
- `'  T001 计费 C023'` `rstrip()` 只去右边。
- `'  T001 计费 C023  '` 最后一次 `repr(raw)`:原字符串一点没变,这就是「方法返回新字符串」。想保留结果得存起来:`cleaned = raw.strip()`。
- `16 12` 原来 16 个字符,`strip` 后 12 个,少了 4 个空格。
- `T001` `strip("*")` 去掉了两头的星号。
- `loudledger` 想去掉 `.com`,结果连开头的 `c` 也没了。原因:`strip(".com")` 的意思是「两头凡是 `.`、`c`、`o`、`m` 这四个字符里的任何一个,都去掉」,不是去掉子串 `.com`。`cloudledger.com` 开头的 `c` 在集合里,被去掉了,接着 `l` 不在,停;结尾 `.com` 四个全在,去掉。

</div>

所以 `strip` 括号里有参数的时候,要想清楚它是「字符集合」。想去掉一个**具体的前缀或后缀**,用下一节的两个方法。

### removeprefix 和 removesuffix:去掉具体的开头结尾

Python 3.9 才加的两个方法。JS 没有对应的,要自己拼 `startsWith` 加 `slice`。新建 `part01/remove_demo.py`:

```python
# agent-zero-lab/part01/remove_demo.py
print("299元".removesuffix("元"))
print("299".removesuffix("元"))
print("¥299".removeprefix("¥"))
print("T1000".removeprefix("T"))
print(int("T1000".removeprefix("T")) + 1)
```

<div class="line-notes">

- `print("299元".removesuffix("元"))` 结尾是「元」就去掉,得 `299`。
- `print("299".removesuffix("元"))` 结尾不是「元」,什么都不做,原样返回。这是它比 `[:-1]` 安全的地方:切片不管最后一个字符是什么,一律砍掉。
- `print("¥299".removeprefix("¥"))` 去掉开头的人民币符号。
- `print("T1000".removeprefix("T"))` 去掉工单号的 `T`,得 `1000`。
- `print(int("T1000".removeprefix("T")) + 1)` 去掉 `T` 之后转成整数再加 1,得 1001。Day 15 练习 2 用 `[1:4]` 做的事,现在不管工单号几位都对。

</div>

```text
$ uv run python part01/remove_demo.py
299
299
299
1000
1001
```

<div class="line-notes">

- `299` 去掉了「元」。
- `299` 没有「元」,原样不动,不会误砍。
- `299` 去掉 `¥`。
- `1000` 去掉 `T`。
- `1001` 1000 + 1。

</div>

### replace:把所有出现的都换掉

`1,234,567` 这种带千位逗号的数字,`int("1,234,567")` 会报 `ValueError`,Day 14 说过。把逗号换成空字符串就行。新建 `part01/replace_demo.py`:

```python
# agent-zero-lab/part01/replace_demo.py
text = "1,234,567"
print(text.replace(",", ""))
print(int(text.replace(",", "")) + 1)
print("a-b-c".replace("-", "", 1))
print("299 元".replace(" ", "").replace("元", ""))
print(text)
```

<div class="line-notes">

- `text = "1,234,567"` 带千位逗号的数字字符串。
- `print(text.replace(",", ""))` 把所有逗号换成空字符串,也就是删掉,得 `1234567`。
- `print(int(text.replace(",", "")) + 1)` 先替换、再 `int()`、再加 1:1234567 + 1 = 1234568。
- `print("a-b-c".replace("-", "", 1))` 第三个参数是最多换几次。这里只换第一个,得 `ab-c`。
- `print("299 元".replace(" ", "").replace("元", ""))` 方法可以连着点:先去掉空格得 `299元`,再去掉「元」得 `299`。从左往右一步步读。
- `print(text)` 原来的 `text` 没变,还是带逗号。

</div>

```text
$ uv run python part01/replace_demo.py
1234567
1234568
ab-c
299
1,234,567
```

<div class="line-notes">

- `1234567` 逗号都没了。
- `1234568` 能转成整数并参与计算了。
- `ab-c` 只换了第一个 `-`。
- `299` 两步连着换,留下纯数字。
- `1,234,567` 原字符串没变。

</div>

JS 里 `replace` 的行为不一样,这是从 JS 转过来最容易掉进去的坑:

```text
$ node -e '
console.log("1,234,567".replace(",", ""));
console.log("1,234,567".replaceAll(",", ""));
'
1234,567
1234567
```

<div class="line-notes">

- `console.log("1,234,567".replace(",", ""));` JS 的 `replace` 只换第一个匹配。
- `console.log("1,234,567".replaceAll(",", ""));` 要全换得用 `replaceAll`(2021 年才加进 JS)。
- `1234,567` 第一行输出:只去掉了第一个逗号,剩下 `1234,567`,还是转不了数字。
- `1234567` 第二行:`replaceAll` 才和 Python 的 `replace` 行为一致。

</div>

### split 和 join:拆开和拼起来

`split` 把一个字符串按分隔符拆成几段,结果是一个**列表**(list):用方括号括起来的一串东西,相当于 JS 的数组,Day 21 会专门学。今天只用三样:`parts[0]` 取第几个、`len(parts)` 数有几个、`parts[:3]` 切片(和字符串的切片规则一模一样)。新建 `part01/split_demo.py`:

```python
# agent-zero-lab/part01/split_demo.py
line = "T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次"
parts = line.split(" ", 3)
print(parts)
print(len(parts))
print(parts[0])
print(parts[-1])

messy = "T005  登录  C031  Forgot password"
print(messy.split(" ", 3))
print(messy.split(maxsplit=3))

prices = "49元/月,468元/年"
print(prices.split(","))
holes = "a,,b"
print(holes.split(","))
nothing = ""
print(nothing.split(","))
```

<div class="line-notes">

- `line = "T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次"` 还是那张工单。
- `parts = line.split(" ", 3)` 按空格拆,第二个参数 3 是「最多拆 3 刀」,所以最多得到 4 段。描述里面的空格不会再被拆开。
- `print(parts)` 打印整个列表。
- `print(len(parts))` 有几段。
- `print(parts[0])` 第一段,编号从 0 开始,和字符串一样。
- `print(parts[-1])` 最后一段,负数也一样能用。
- `messy = "T005  登录  C031  Forgot password"` 字段之间是**两个**空格。
- `print(messy.split(" ", 3))` 明确按「一个空格」拆。
- `print(messy.split(maxsplit=3))` 不给分隔符,只给 `maxsplit=3`,表示「按任意长度的空白拆」。`maxsplit=3` 是关键字参数(Day 10 的 `Table(title=...)` 同款写法),Day 29 讲。
- `prices = "49元/月,468元/年"` 另一种用法:按逗号拆。
- `print(prices.split(","))` 得两段。
- `holes = "a,,b"` 两个逗号挨着,中间是空的。
- `print(holes.split(","))` 看看空的那段怎么处理。
- `nothing = ""` 空字符串。
- `print(nothing.split(","))` 拆一个空串,看结果。

</div>

```text
$ uv run python part01/split_demo.py
['T001', '计费', 'C023', '10月3日和10月5日各扣了一次299元,被扣了两次']
4
T001
10月3日和10月5日各扣了一次299元,被扣了两次
['T005', '', '登录', ' C031  Forgot password']
['T005', '登录', 'C031', 'Forgot password']
['49元/月', '468元/年']
['a', '', 'b']
['']
```

<div class="line-notes">

- `['T001', '计费', 'C023', '10月3日和10月5日各扣了一次299元,被扣了两次']` 四段,最后一段保留了完整描述,里面有没有空格都不再拆。列表打印出来每一项带引号,逗号分隔。
- `4` 四段。
- `T001` 第一段。
- `10月3日和10月5日各扣了一次299元,被扣了两次` 最后一段。
- `['T005', '', '登录', ' C031  Forgot password']` 按一个空格拆,两个空格之间多出一个空字符串 `''`,而且后面的段位置全乱了,`'登录'` 变成第三段,最后一段开头还带着空格。这是 `split(" ")` 的坑。
- `['T005', '登录', 'C031', 'Forgot password']` 不给分隔符,连续的空白当成一个,四段干干净净。**拆工单这类人敲的、对齐的文字,用 `split()` 不带参数。**
- `['49元/月', '468元/年']` 按逗号拆得两段。
- `['a', '', 'b']` 两个逗号之间是一个空字符串,拆出的段数比你想象的多。
- `['']` 空字符串拆出来**不是空列表**,是一个含空字符串的列表。只要你处理的是用户输入,这一条总有一天会咬你。

</div>

`join` 是反过来:把一个列表里的字符串用某个分隔符串成一个。注意写法:**分隔符在前面,列表放括号里**。新建 `part01/join_demo.py`:

```python
# agent-zero-lab/part01/join_demo.py
text = "T001 计费 C023 被扣了两次"
parts = text.split()
print(parts)
print(" | ".join(parts))
print("-".join(parts[:3]))
date_parts = ["2026", "10", "23"]
print("".join(date_parts))
```

<div class="line-notes">

- `text = "T001 计费 C023 被扣了两次"` 一个短一点的工单。
- `parts = text.split()` 按空白拆成 4 段。
- `print(parts)` 列表。
- `print(" | ".join(parts))` 用 ` | ` 把 4 段重新串起来。`" | "` 是分隔符字符串,`.join(parts)` 是它的方法,参数是列表。
- `print("-".join(parts[:3]))` `parts[:3]` 是前三段(列表切片,左闭右开),用 `-` 串起来。
- `date_parts = ["2026", "10", "23"]` 用方括号直接写一个列表。
- `print("".join(date_parts))` 分隔符是空字符串,就是把它们直接首尾相接。

</div>

```text
$ uv run python part01/join_demo.py
['T001', '计费', 'C023', '被扣了两次']
T001 | 计费 | C023 | 被扣了两次
T001-计费-C023
20261023
```

<div class="line-notes">

- `['T001', '计费', 'C023', '被扣了两次']` 拆成了 4 段。
- `T001 | 计费 | C023 | 被扣了两次` 用 `" | "` 拼回去。
- `T001-计费-C023` 只拼前三段。
- `20261023` 空分隔符。

</div>

`split` 加 `join` 是个常见的组合:先拆开,处理每一段,再拼回去。写提示词的时候,把多条规则拼成一大段文字,几乎都是 `"\n".join(规则列表)`。

### 查找:in、startswith、find、count

要判断一段文字里有没有某个词,Python 用 `in`,这个写法比 JS 的 `includes` 更像自然语言。新建 `part01/search_demo.py`:

```python
# agent-zero-lab/part01/search_demo.py
line = "T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次"
print("计费" in line)
print("退款" in line)
print(line.startswith("T"))
print(line.endswith("两次"))
print(line.count("月"))
print(line.find("299"))
print(line.find("退款"))
start = line.find("一次") + 2
end = line.find("元")
print(line[start:end])
print(line.index("退款"))
```

<div class="line-notes">

- `line = "T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次"` 同一张工单。
- `print("计费" in line)` `in` 判断左边的字符串是不是右边的一部分,返回 `True` 或 `False`。
- `print("退款" in line)` 工单里没有「退款」这两个字。
- `print(line.startswith("T"))` 是不是以 `T` 开头。
- `print(line.endswith("两次"))` 是不是以「两次」结尾。
- `print(line.count("月"))` 「月」出现几次。
- `print(line.find("299"))` 找 `299` 第一次出现的位置,返回编号。
- `print(line.find("退款"))` 找不到,返回 `-1`(和 JS 的 `indexOf` 一样)。
- `start = line.find("一次") + 2` 「一次」出现的位置,再加上它本身的 2 个字符的长度,就是后面那个字的位置。
- `end = line.find("元")` 「元」出现的位置。
- `print(line[start:end])` 用 Day 15 的切片,取两个位置之间的字符。
- `print(line.index("退款"))` `index` 和 `find` 的区别:找不到的时候不返回 -1,而是直接报错。

</div>

```text
$ uv run python part01/search_demo.py
True
False
True
True
2
29
-1
299
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/search_demo.py", line 13, in <module>
    print(line.index("退款"))
          ^^^^^^^^^^^^^^^^^^
ValueError: substring not found
```

<div class="line-notes">

- `True` 有「计费」。
- `False` 没有「退款」。
- `True` 以 T 开头。
- `True` 以「两次」结尾。
- `2` 「10月3日和10月5日」里有两个「月」。
- `29` `299` 第一次出现在 29 号。对一下 Day 15 的编号:29、30、31 号是 `2`、`9`、`9`。
- `-1` 找不到。拿 `-1` 当编号再去切片会切出奇怪的东西(`-1` 是最后一个字符),所以 `find` 之后一般要先判断是不是 `-1`,Day 17 的 if 就派上用场。
- `299` `find("一次")` 是 27,加 2 得 29;`find("元")` 是 32;`line[29:32]` 就是 `299`。这是「在两个标记之间取内容」的基本手法,后面处理模型输出会常用。
- `ValueError: substring not found` `index` 找不到就报这个错。和 `find` 比,差别是「找不到时你想不想让程序停下来」。

</div>

英文工单要忽略大小写才能匹配:`"Refund"` 和 `"refund"` 对计算机来说是两个不同的词。常见做法是先转小写再找。新建 `part01/case_demo.py`:

```python
# agent-zero-lab/part01/case_demo.py
text = "Refund request for duplicate charge"
print("refund" in text)
print("refund" in text.lower())
print(text.upper())
print(text.lower())
print(text)
```

<div class="line-notes">

- `text = "Refund request for duplicate charge"` T006 的英文工单,`R` 是大写。
- `print("refund" in text)` 直接找小写的 `refund`。
- `print("refund" in text.lower())` 先 `.lower()` 把整个文本转成小写,再找。
- `print(text.upper())` 全大写。
- `print(text.lower())` 全小写。
- `print(text)` 原字符串还是原样。

</div>

```text
$ uv run python part01/case_demo.py
False
True
REFUND REQUEST FOR DUPLICATE CHARGE
refund request for duplicate charge
Refund request for duplicate charge
```

<div class="line-notes">

- `False` 大小写不同,找不到。
- `True` 转小写后找到了。
- `REFUND REQUEST FOR DUPLICATE CHARGE` 全大写。
- `refund request for duplicate charge` 全小写。
- `Refund request for duplicate charge` 原样,`lower()` 没改它。

</div>

明天的 if 会把这些组合起来:`if "refund" in text.lower():` 就是一条最朴素的英文工单分类规则。

## 中文和编码

### 字符、码点和字节

`len("计费")` 是 2,可是如果把「计费」存进文件,文件大小是 6 个字节。这个 2 和 6 的差别,就是编码。三个词先分清楚:

- **字符**:你看到的一个字,「计」是一个字符,`a` 是一个字符。Python 的字符串是字符的序列,`len` 数的就是字符。
- **码点**:每个字符在 Unicode 这张全世界通用的大表里有个编号,「计」是 35745(十六进制 `8BA1`)。
- **字节**:计算机存文件、传网络,最小单位是字节(0 到 255 的一个数)。字符变成字节的规则叫**编码**,反过来叫**解码**。

最通行的规则叫 UTF-8:英文字母 1 个字节,常用汉字 3 个字节,emoji 4 个字节。老一点的 Windows 中文系统和国内的老软件常用 GBK:汉字 2 个字节。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="字符串 计 的编码过程:字符 计,码点 35745,UTF-8 编码成 e8 ae a1 三个字节,GBK 编码成 bc c6 两个字节;用错误的规则解码会得到乱码或报错">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="13">
<rect x="20" y="30" width="110" height="60" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="32" y="54" fill="var(--ink-faint)" font-size="11">字符(str)</text>
<text x="32" y="80" fill="var(--ink)" font-size="20">计</text>
<rect x="190" y="30" width="130" height="60" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
<text x="202" y="54" fill="var(--ink-faint)" font-size="11">码点</text>
<text x="202" y="80" fill="var(--ink)">35745 (8BA1)</text>
<line x1="130" y1="60" x2="190" y2="60" stroke="var(--ink-soft)"/>
<rect x="390" y="30" width="230" height="60" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="402" y="54" fill="var(--ink-faint)" font-size="11">UTF-8 字节(bytes)</text>
<text x="402" y="80" fill="var(--ink)">e8  ae  a1     共 3 个</text>
<line x1="320" y1="50" x2="390" y2="50" stroke="var(--ink-soft)"/>
<text x="334" y="44" fill="var(--ink-soft)" font-size="11">.encode()</text>
<rect x="390" y="110" width="230" height="60" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="402" y="134" fill="var(--ink-faint)" font-size="11">GBK 字节</text>
<text x="402" y="160" fill="var(--ink)">bc  c6          共 2 个</text>
<line x1="320" y1="70" x2="390" y2="140" stroke="var(--ink-soft)"/>
<text x="20" y="206" fill="var(--ink-soft)">.decode("utf-8")  把 e8 ae a1 变回「计」</text>
<text x="20" y="226" fill="var(--ink-soft)">用 GBK 去读 UTF-8 的字节 → 乱码;用 UTF-8 去读 GBK 的字节 → UnicodeDecodeError</text>
</g>
</svg>
<figcaption>同一个字,不同的编码规则得到不同的字节。读的时候用的规则必须和写的时候一致。</figcaption>
</figure>

新建 `part01/encoding_demo.py`,亲眼看看这些字节:

```python
# agent-zero-lab/part01/encoding_demo.py
s = "计费"
print(len(s))
b = s.encode()
print(b)
print(len(b))
print(list(b))
print(b.decode("utf-8"))
letters = "abc"
emoji = "😀"
print(len(letters.encode()), len(emoji.encode()))
print(ord("计"), hex(ord("计")), chr(35745))
print(s.encode("gbk"), len(s.encode("gbk")))
```

<div class="line-notes">

- `s = "计费"` 两个汉字。
- `print(len(s))` 字符数。
- `b = s.encode()` `encode()` 把字符串编码成字节串(`bytes` 类型),不写参数默认就是 UTF-8。
- `print(b)` 字节串打印时前面带一个 `b`,每个不能直接显示的字节写成 `\x` 加两位十六进制。
- `print(len(b))` 字节数。
- `print(list(b))` `list(...)` 把字节串转成列表,看到每个字节是 0 到 255 的一个整数。
- `print(b.decode("utf-8"))` `decode()` 反过来,把字节串变回字符串,这里要指明规则。
- `letters = "abc"` 三个英文字母。
- `emoji = "😀"` 一个 emoji。
- `print(len(letters.encode()), len(emoji.encode()))` 看这两个的字节数。
- `print(ord("计"), hex(ord("计")), chr(35745))` `ord()` 取字符的码点(十进制),`hex()` 转成十六进制,`chr()` 反过来把码点变回字符。
- `print(s.encode("gbk"), len(s.encode("gbk")))` 按 GBK 规则编码,看看字节和长度。

</div>

```text
$ uv run python part01/encoding_demo.py
2
b'\xe8\xae\xa1\xe8\xb4\xb9'
6
[232, 174, 161, 232, 180, 185]
计费
3 4
35745 0x8ba1 计
b'\xbc\xc6\xb7\xd1' 4
```

<div class="line-notes">

- `2` 两个字符。
- `b'\xe8\xae\xa1\xe8\xb4\xb9'` UTF-8 字节,每个字 3 个字节:「计」是 `e8 ae a1`,「费」是 `e8 b4 b9`。
- `6` 6 个字节。2 个字符 × 3 字节。
- `[232, 174, 161, 232, 180, 185]` 同样六个字节,换成十进制。232 就是 `e8`。
- `计费` 解码回来了。
- `3 4` 三个英文字母 3 个字节(1 字节 1 个),一个 emoji 4 个字节。
- `35745 0x8ba1 计` 码点 35745,十六进制 `8ba1`,`chr(35745)` 变回「计」。
- `b'\xbc\xc6\xb7\xd1' 4` 同样两个字,GBK 只要 4 个字节(每个字 2 个)。

</div>

JS 里也能看到同样的字节,用 `TextEncoder`(JS 的字符串内部是 UTF-16,但编码成字节时默认用 UTF-8):

```text
$ node -e '
console.log(new TextEncoder().encode("计费"));
'
Uint8Array(6) [ 232, 174, 161, 232, 180, 185 ]
```

<div class="line-notes">

- `console.log(new TextEncoder().encode("计费"));` JS 里的 `TextEncoder` 把字符串按 UTF-8 编码成字节数组。
- `Uint8Array(6) [ 232, 174, 161, 232, 180, 185 ]` 6 个字节,数字和 Python 的 `list(b)` 完全一样。

</div>

### 乱码是怎么来的

乱码只有一个原因:**写的时候用一种规则,读的时候用了另一种**。新建 `part01/mojibake_demo.py`,故意读错:

```python
# agent-zero-lab/part01/mojibake_demo.py
s = "计费"
print(s.encode().decode("gbk"))
print(s.encode("gbk").decode("utf-8", errors="replace"))
print(s.encode("gbk").decode("utf-8"))
```

<div class="line-notes">

- `s = "计费"` 原文。
- `print(s.encode().decode("gbk"))` 用 UTF-8 写出 6 个字节,却用 GBK 去读。GBK 每 2 个字节认一个字,6 个字节认成了 3 个别的字。
- `print(s.encode("gbk").decode("utf-8", errors="replace"))` 用 GBK 写出 4 个字节,用 UTF-8 去读,但这次加了 `errors="replace"`,意思是遇到读不懂的字节,用 `�` 顶替,不要报错。
- `print(s.encode("gbk").decode("utf-8"))` 同样的读法,不加 `errors`,看看会怎么样。

</div>

```text
$ uv run python part01/mojibake_demo.py
璁¤垂
�Ʒ�
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/mojibake_demo.py", line 5, in <module>
    print(s.encode("gbk").decode("utf-8"))
          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
UnicodeDecodeError: 'utf-8' codec can't decode byte 0xbc in position 0: invalid start byte
```

<div class="line-notes">

- `璁¤垂` 6 个字节被 GBK 当成 3 个字符,「计费」变成这三个完全不相干的字。看到这种「一堆生僻字夹杂符号」的,基本是 UTF-8 被当成 GBK 读了。
- `�Ʒ�` 用 `replace` 之后不报错,但 `�` 是「这里有字读不出来」的占位符,信息已经丢了,再也变不回「计费」了。看到满屏 `�` 一般是 GBK 被当成 UTF-8 读了。
- `UnicodeDecodeError: 'utf-8' codec can't decode byte 0xbc in position 0: invalid start byte` 严格模式下直接报错:第 0 个字节 `0xbc` 不是合法的 UTF-8 开头。这个报错是好事,它让你当场知道「编码错了」,而不是悄悄带着乱码走下去。

</div>

遇到乱码,别猜,先问「这份数据最初是用什么编码写出来的」。网页的 `<meta charset>`、HTTP 响应头里的 `Content-Type`、导出软件的设置,都能找到答案。国内导出的老 CSV 文件常常是 GBK 或 GB18030,用 Python 打开要写 `encoding="gbk"`;新系统几乎都是 UTF-8。读写文件时怎么指定编码,[Day 38](/blog/agent-zero/day-038-files-with/) 会正式教,现在知道有这么回事就行。

### 全角字符:看着是数字,其实不是

中文输入法下敲数字和标点,很容易敲出**全角**的:`２９９`、`，`、`．`,看着和半角的 `299`、`,`、`.` 差不多,编码完全不同。有意思的是,Python 的 `int()` 认全角数字(Day 14 提过),但 `float("１９．９９")` 里的全角小数点就不认。统一成半角的办法是 Unicode 规范化,`NFKC` 这种规则会把全角变半角。新建 `part01/normalize_demo.py`:

```python
# agent-zero-lab/part01/normalize_demo.py
import unicodedata

typed = "１９．９９　元"
print(repr(typed))
print(repr(unicodedata.normalize("NFKC", typed)))
print(repr(unicodedata.normalize("NFKC", "￥299")))
print(int("２９９") + 1)
```

<div class="line-notes">

- `import unicodedata` 把标准库里的 `unicodedata` 模块拿进来。标准库是 Python 自带的,不用 `uv add`。`import` 的细节 [Day 32](/blog/agent-zero/day-032-modules/) 讲。
- `typed = "１９．９９　元"` 模拟用户在中文输入法下敲的:全角的 1、9、小数点、9、9,再加一个全角空格,再加「元」。
- `print(repr(typed))` 带引号打印,全角空格会显示成 `　`。
- `print(repr(unicodedata.normalize("NFKC", typed)))` `unicodedata.normalize("NFKC", 文本)` 返回规范化后的新字符串。
- `print(repr(unicodedata.normalize("NFKC", "￥299")))` 全角的人民币符号 `￥` 也被换成半角 `¥`。
- `print(int("２９９") + 1)` `int()` 本来就认全角数字,299 + 1 得 300。

</div>

```text
$ uv run python part01/normalize_demo.py
'１９．９９\u3000元'
'19.99 元'
'¥299'
300
```

<div class="line-notes">

- `'１９．９９\u3000元'` 全角数字、全角小数点,中间的 `\u3000` 是全角空格。
- `'19.99 元'` 规范化后全是半角,全角空格变成了普通空格,可以交给 `strip()` 处理。
- `'¥299'` `￥` 变 `¥`。
- `300` 全角数字能直接 `int`。

</div>

### 这对 Agent 工程师为什么重要

三个地方一定会碰到。一是模型的 token:大模型按 token 计费、按 token 限制长度,字符数和字节数都不等于 token 数,中文通常 1 个字符不到 1 个 token 或者刚好 1 个,具体看分词器(这门课 [Day 107](/blog/agent-zero/day-107-tokens-1/) 起会实测)。二是读写文件和网络:请求体、响应体、文件里装的都是字节,必须指明编码才能变成字符串,不指明就靠系统默认,换一台机器就可能乱码。三是用户输入:全角、空白、不可见字符,模型也会吐出带全角标点的文字,调用工具之前都要先清洗。

## 拼起来:让 ask_amount.py 吃得下脏输入

把今天的几个零件装进 `ask_amount.py`。清洗是一条流水线,每一步只做一件事,上一步的结果交给下一步。拿用户敲的 `１９．９９ 元` 走一遍:

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="清洗流水线:原始输入 １９．９９ 元 依次经过 NFKC 规范化、strip 去空白、removesuffix 去掉元、strip 再去空白,得到 19.99,最后 float 转成数字 19.99">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="14" y="30" width="112" height="46" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
<text x="24" y="50" fill="var(--ink-faint)" font-size="11">用户敲的</text>
<text x="24" y="68" fill="var(--ink)">１９．９９ 元</text>
<rect x="136" y="30" width="112" height="46" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="146" y="50" fill="var(--ink-faint)" font-size="11">NFKC</text>
<text x="146" y="68" fill="var(--ink)">19.99 元</text>
<rect x="258" y="30" width="112" height="46" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="268" y="50" fill="var(--ink-faint)" font-size="11">removesuffix("元")</text>
<text x="268" y="68" fill="var(--ink)">'19.99 '</text>
<rect x="380" y="30" width="112" height="46" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="390" y="50" fill="var(--ink-faint)" font-size="11">strip()</text>
<text x="390" y="68" fill="var(--ink)">'19.99'</text>
<rect x="502" y="30" width="124" height="46" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="512" y="50" fill="var(--ink-faint)" font-size="11">float() × 100</text>
<text x="512" y="68" fill="var(--ink)">1998.99… → 1999</text>
<g stroke="var(--ink-soft)">
<line x1="126" y1="53" x2="136" y2="53"/><line x1="248" y1="53" x2="258" y2="53"/><line x1="370" y1="53" x2="380" y2="53"/><line x1="492" y1="53" x2="502" y2="53"/>
</g>
<text x="14" y="116" fill="var(--ink-soft)">每一步都返回新字符串,变量重新赋值接住它</text>
<text x="14" y="140" fill="var(--ink-soft)">全角空格在 NFKC 那步变成普通空格,所以最后 strip 能去掉</text>
<text x="14" y="164" fill="var(--ink-soft)">这条流水线只能把「格式不规整的数字」洗干净</text>
<text x="14" y="188" fill="var(--ink-soft)">「abc」这类根本不是数字的输入,到 float() 那步照样崩</text>
</g>
</svg>
<figcaption>清洗流水线。真实输入进来先洗成半角、去掉两头和后缀,最后才转数字。</figcaption>
</figure>

这是 Day 14 建、Day 15 改过输出的文件,今天在读输入和转换之间加一段清洗:

```python
# agent-zero-lab/part01/ask_amount.py
import unicodedata

price_text = input("单价(元,可带小数):")
times_text = input("被扣了几次:")

price_text = unicodedata.normalize("NFKC", price_text).strip()
price_text = price_text.removeprefix("¥").removesuffix("元").strip()
price_text = price_text.replace(",", "")
times_text = unicodedata.normalize("NFKC", times_text).strip()
times_text = times_text.removesuffix("次").strip()

price_fen = round(float(price_text) * 100)
times = int(times_text)

refund_fen = price_fen * (times - 1)
print(f"单价:{price_fen} 分({price_fen / 100:.2f} 元)")
print("需要退款:", times > 1)
print(f"应退:{refund_fen / 100:,.2f} 元")
```

<div class="line-notes">

- `import unicodedata` 要用规范化,先导入。
- `price_text = input("单价(元,可带小数):")` 读单价,还是字符串。
- `times_text = input("被扣了几次:")` 读次数。
- `price_text = unicodedata.normalize("NFKC", price_text).strip()` 第一步:全角变半角,再去两头空白。赋值号左右都是 `price_text`,意思是用新字符串覆盖旧变量的值。
- `price_text = price_text.removeprefix("¥").removesuffix("元").strip()` 第二步:去掉开头的 `¥`、结尾的「元」,再去一次空白(因为「299 元」中间有空格)。两个方法连着点。
- `price_text = price_text.replace(",", "")` 第三步:去掉千位逗号。
- `times_text = unicodedata.normalize("NFKC", times_text).strip()` 次数同样先规范化、去空白。
- `times_text = times_text.removesuffix("次").strip()` 用户可能输入「3 次」,去掉「次」。
- `price_fen = round(float(price_text) * 100)` 转换的部分和 Day 14 一样。
- `times = int(times_text)` 同上。
- `refund_fen = price_fen * (times - 1)` 同上。
- `print(f"单价:{price_fen} 分({price_fen / 100:.2f} 元)")` 同 Day 15。
- `print("需要退款:", times > 1)` 同上。
- `print(f"应退:{refund_fen / 100:,.2f} 元")` 在 `.2f` 前面加了逗号,大金额更好读。

</div>

先试今天几个脏输入:

```text
$ uv run python part01/ask_amount.py
单价(元,可带小数):299元
被扣了几次:2
单价:29900 分(299.00 元)
需要退款: True
应退:299.00 元
$ uv run python part01/ask_amount.py
单价(元,可带小数):  299  
被扣了几次:2
单价:29900 分(299.00 元)
需要退款: True
应退:299.00 元
$ uv run python part01/ask_amount.py
单价(元,可带小数):1,234,567
被扣了几次:2
单价:123456700 分(1234567.00 元)
需要退款: True
应退:1,234,567.00 元
$ uv run python part01/ask_amount.py
单价(元,可带小数):¥19.99
被扣了几次:3 次
单价:1999 分(19.99 元)
需要退款: True
应退:39.98 元
$ uv run python part01/ask_amount.py
单价(元,可带小数):１９．９９ 元
被扣了几次:３
单价:1999 分(19.99 元)
需要退款: True
应退:39.98 元
```

<div class="line-notes">

- `单价(元,可带小数):299元` 老毛病:Day 14 在这里崩,Day 15 也崩。现在去掉「元」,得 29900 分。
- `单价(元,可带小数):  299  ` 前后各两个空格,`strip()` 处理。
- `单价:123456700 分(1234567.00 元)` `1,234,567` 去掉逗号后是 1234567 元,乘 100 得 123456700 分。这是 Day 14 留的尾巴,这次转成功了。
- `应退:1,234,567.00 元` 退款金额用 `:,.2f` 显示,带千位逗号。
- `单价(元,可带小数):¥19.99` 带 `¥` 的也行。
- `被扣了几次:3 次` 次数带「次」也行。
- `单价:1999 分(19.99 元)` 19.99 乘 100 再 `round`,1999 分。
- `应退:39.98 元` 多扣两次,1999 × 2 = 3998 分。
- `单价(元,可带小数):１９．９９ 元` 全角数字、全角小数点、半角空格加「元」,全部处理好。
- `被扣了几次:３` 全角的 3。

</div>

但不是什么都能接住。输入 `abc` 或者直接回车,还是会崩:

```text
$ uv run python part01/ask_amount.py
单价(元,可带小数):abc
被扣了几次:2
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ask_amount.py", line 13, in <module>
    price_fen = round(float(price_text) * 100)
                      ^^^^^^^^^^^^^^^^^
ValueError: could not convert string to float: 'abc'
```

<div class="line-notes">

- `单价(元,可带小数):abc` 一个完全不是数字的输入。
- `line 13, in <module>` 现在转换那行是第 13 行,因为前面多了清洗的几行。
- `ValueError: could not convert string to float: 'abc'` 清洗只能处理「格式不规整的数字」,处理不了「根本不是数字」。要判断「这是不是数字」、不是就让用户重新输入,需要 if,明天学;要把错误接住不让程序崩,需要异常处理,[Day 35](/blog/agent-zero/day-035-exceptions-1/) 学。

</div>

## 用 split 解析工单行

回到 Day 15 的 `ticket_card.py`,它按固定位置切片,工单号变长就错。用 `split` 重写。这是新文件 `part01/ticket_card2.py`,工单行改成从键盘读:

```python
# agent-zero-lab/part01/ticket_card2.py
line = input("工单行:").strip()
parts = line.split(maxsplit=3)

ticket_id = parts[0]
category = parts[1]
customer = parts[2]
desc = parts[3]
number = int(ticket_id.removeprefix("T"))

print(f"工单 {ticket_id}(第 {number} 号) | 类别 {category} | 客户 {customer}")
print(f"描述:{desc}")
print(f"提到发票:{'发票' in desc}")
```

<div class="line-notes">

- `line = input("工单行:").strip()` 读一行,马上去掉两头的空白。`input(...)` 的结果直接点 `.strip()`,不用先存一个中间变量。
- `parts = line.split(maxsplit=3)` 不给分隔符,按任意空白拆,最多拆 3 刀。字段之间一个空格还是几个空格都行。
- `ticket_id = parts[0]` 第一段,工单号。
- `category = parts[1]` 第二段,类别。
- `customer = parts[2]` 第三段,客户号。
- `desc = parts[3]` 第四段,描述,里面的空格保留。
- `number = int(ticket_id.removeprefix("T"))` 去掉 `T`,转成整数。Day 15 练习 2 这件事,现在不依赖编号是几位。
- `print(f"工单 {ticket_id}(第 {number} 号) | 类别 {category} | 客户 {customer}")` 排成一行摘要,比 Day 15 多了「第几号」。
- `print(f"描述:{desc}")` 描述。
- `print(f"提到发票:{'发票' in desc}")` f-string 花括号里放一个 `in` 判断,得 `True` 或 `False`。注意花括号里面用单引号,外层是双引号。

</div>

跑三张工单:Day 15 的 T001、字段之间多空格的 T1000、只有两段的残缺行:

```text
$ uv run python part01/ticket_card2.py
工单行:T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次
工单 T001(第 1 号) | 类别 计费 | 客户 C023
描述:10月3日和10月5日各扣了一次299元,被扣了两次
提到发票:False
$ uv run python part01/ticket_card2.py
工单行:  T1000  计费  C023  续费后发票没有发到邮箱  
工单 T1000(第 1000 号) | 类别 计费 | 客户 C023
描述:续费后发票没有发到邮箱
提到发票:True
$ uv run python part01/ticket_card2.py
工单行:T009 计费
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ticket_card2.py", line 7, in <module>
    customer = parts[2]
               ~~~~~^^^
IndexError: list index out of range
```

<div class="line-notes">

- `工单 T001(第 1 号) | 类别 计费 | 客户 C023` T001 解析对了,`T001` 去掉 `T` 得 `001`,`int("001")` 是 1。
- `提到发票:False` T001 的描述里没有「发票」两个字。
- `工单行:  T1000  计费  C023  续费后发票没有发到邮箱  ` 前后和字段之间都有多余的空格,Day 15 的切片版在这里全错。
- `工单 T1000(第 1000 号) | 类别 计费 | 客户 C023` 五位的工单号、多余的空格,都没问题。
- `提到发票:True` 描述里有「发票」。
- `工单行:T009 计费` 只有两段的残缺行,`split` 只能拆出两段,`parts[2]` 就不存在了。
- `IndexError: list index out of range` 这和字符串的 `IndexError` 是同一类错误,只是换成了列表:`parts` 只有两个元素(编号 0 和 1),第 7 行取 `parts[2]` 越界。真实数据一定会有残缺行,所以处理之前要先 `len(parts)` 确认有 4 段,「确认了再取」就是明天 if 的活。

</div>

写完检查一遍:

```text
$ uv run ruff check part01/strip_demo.py part01/remove_demo.py part01/replace_demo.py part01/split_demo.py part01/join_demo.py part01/search_demo.py part01/case_demo.py part01/encoding_demo.py part01/mojibake_demo.py part01/normalize_demo.py part01/ask_amount.py part01/ticket_card2.py
All checks passed!
```

<div class="line-notes">

- `All checks passed!` 十二个文件都通过。`search_demo.py` 和 `mojibake_demo.py` 末尾那一行是故意让它报错的,但 Ruff 只看写法,不管运行时会不会出错,所以照样通过。我用的 Ruff 0.17.2 在默认设置下就会挑一些风格问题:我第一次写 `"".join(["2026", "10", "23"])` 和 `"abc".encode("utf-8")` 都被它提醒过「可以直接写成别的」(规则号分别是 `FLY002` 和 `UP012`),所以现在的脚本里把它们拆成了变量。

</div>

| 今天的零件 | 在 `ask_amount.py` / `ticket_card2.py` 里是哪一步 |
| --- | --- |
| 方法返回新字符串 | `price_text = ... .strip()` 要把结果重新赋给变量 |
| `strip()` 去两头空白 | 用户多敲的空格 |
| `removeprefix` / `removesuffix` | 去掉 `¥`、「元」、「次」、`T` |
| `replace` | 去掉千位逗号 |
| `split(maxsplit=3)` | 把工单行拆成四段 |
| `in` | `'发票' in desc` |
| NFKC 规范化 | `１９．９９` 变 `19.99` |
| 列表索引越界 | `parts[2]` 在只有两段时报 `IndexError` |

## 动手练习

### 练习 1:清洗一段工单文本

下面是从某个导出系统里拿到的一行工单,字段间空格数不一,还夹着全角标点和中文引号:

```text
  T010   计费   C042   客户说：“被扣了两次，299元”  
```

写 `part01/ex1_clean.py`:先打印原样(带引号,看得见空格),规范化并去空白,拆成工单号、类别、客户号、描述四段;再从描述里取出引号里的话,最后取出「元」前面的金额,算成整数分,打印 `C042 被扣金额:29900 分(299.00 元)`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex1_clean.py
import unicodedata

raw = "  T010   计费   C042   客户说：“被扣了两次，299元”  "
print(repr(raw))

text = unicodedata.normalize("NFKC", raw).strip()
parts = text.split(maxsplit=3)
ticket_id = parts[0]
category = parts[1]
customer = parts[2]
desc = parts[3]
print(ticket_id, category, customer)
print(desc)

quote = desc.removeprefix("客户说:").strip("“”")
print(quote)
amount_text = quote[quote.find(",") + 1 : quote.find("元")]
amount_fen = int(amount_text) * 100
print(f"{customer} 被扣金额:{amount_fen} 分({amount_fen / 100:.2f} 元)")
```

<div class="line-notes">

- `import unicodedata` 规范化要用。
- `raw = "  T010   计费   C042   客户说：“被扣了两次，299元”  "` 题目那行。冒号和逗号是全角,引号是中文弯引号。
- `print(repr(raw))` 带引号打印。
- `text = unicodedata.normalize("NFKC", raw).strip()` 全角冒号、逗号变半角,再去掉两头空白。中文弯引号 `“”` 不会变,它们不属于「兼容字符」。
- `parts = text.split(maxsplit=3)` 按任意空白拆成最多四段,字段之间三个空格也没关系。
- `ticket_id = parts[0]` 工单号 `T010`。
- `category = parts[1]` 类别 `计费`。
- `customer = parts[2]` 客户号 `C042`。
- `desc = parts[3]` 描述,是 `客户说:“被扣了两次,299元”`,冒号已经是半角了。
- `print(ticket_id, category, customer)` 前三段一行打印。
- `print(desc)` 看描述。
- `quote = desc.removeprefix("客户说:").strip("“”")` 先去掉开头的 `客户说:`(半角冒号,因为已经规范化),再用 `strip("“”")` 去掉两头的引号。这里 `strip` 的字符集合用法恰好合适:两个引号字符,哪个在两头都去掉。
- `print(quote)` 得 `被扣了两次,299元`。
- `amount_text = quote[quote.find(",") + 1 : quote.find("元")]` 取两个位置之间的内容:逗号的位置加 1 是金额起点,「元」的位置是终点。`被扣了两次,299元` 里逗号在 5 号,「元」在 9 号,取 6 到 8 号,就是 `299`。
- `amount_fen = int(amount_text) * 100` 转整数,乘 100 变分。
- `print(f"{customer} 被扣金额:{amount_fen} 分({amount_fen / 100:.2f} 元)")` 一行打印结果。

</div>

```text
$ uv run python part01/ex1_clean.py
'  T010   计费   C042   客户说：“被扣了两次，299元”  '
T010 计费 C042
客户说:“被扣了两次,299元”
被扣了两次,299元
C042 被扣金额:29900 分(299.00 元)
```

<div class="line-notes">

- `'  T010   计费   C042   客户说：“被扣了两次，299元”  '` 原样,全角冒号、逗号和两头的空格都看得见。
- `T010 计费 C042` 三个字段清清楚楚,`print` 多个值用空格隔开。
- `客户说:“被扣了两次,299元”` 描述里的冒号和逗号已经是半角,引号还是弯引号。
- `被扣了两次,299元` 引号和「客户说:」都去掉了。
- `C042 被扣金额:29900 分(299.00 元)` 299 × 100 = 29900 分。

</div>

`strip("“”")` 对「引号」这种成对的符号方便,但如果引号里面的话本身也以引号字符结尾,会多去掉。真实数据里要小心。

</details>

### 练习 2:字符数和字节数

不跑代码,先猜这四个字符串的字符数和 UTF-8 字节数各是多少:`"abc"`、`"计费"`、`"Refund 退款"`、`"😀"`。再写 `part01/ex2_bytes.py` 验证。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex2_bytes.py
s1 = "abc"
s2 = "计费"
s3 = "Refund 退款"
s4 = "😀"

print(len(s1), len(s1.encode()))
print(len(s2), len(s2.encode()))
print(len(s3), len(s3.encode()))
print(len(s4), len(s4.encode()))
```

<div class="line-notes">

- `s1 = "abc"` 三个英文字母。
- `s2 = "计费"` 两个汉字。
- `s3 = "Refund 退款"` 6 个字母、1 个空格、2 个汉字。
- `s4 = "😀"` 一个 emoji。
- `print(len(s1), len(s1.encode()))` 先字符数,再字节数,两个数并排。
- `print(len(s2), len(s2.encode()))` 汉字组。
- `print(len(s3), len(s3.encode()))` 混合组。
- `print(len(s4), len(s4.encode()))` emoji。

</div>

```text
$ uv run python part01/ex2_bytes.py
3 3
2 6
9 13
1 4
```

<div class="line-notes">

- `3 3` 英文字母 1 字符 1 字节。
- `2 6` 每个汉字 3 字节,2 × 3 = 6。
- `9 13` 字符数 6 + 1 + 2 = 9;字节数 7 个单字节(6 个字母加空格)加 2 × 3 = 13。
- `1 4` 1 个 emoji,4 个字节。

</div>

规律:UTF-8 里英文 1 字节,汉字 3 字节,emoji 4 字节。所以一个汉字比一个英文字母占的存储多,但模型的 token 数和这个不是一回事,分词器按自己的词表来(Day 107)。

</details>

### 练习 3:读错编码,能救回来吗

老系统导出的文件 `退款申请` 四个字是 GBK 编码的。写 `part01/ex3_recover.py`:用 GBK 编码得到字节;用 GBK 正确解码;再模拟「有人把 UTF-8 的字节当 GBK 读」产生的乱码;最后试着把乱码「救回来」(先编码成 GBK 字节、再按 UTF-8 解码,每一步都用 `errors="replace"`),看能不能还原。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex3_recover.py
data = "退款申请".encode("gbk")
print(data)
print(data.decode("gbk"))

garbled = "退款申请".encode().decode("gbk", errors="replace")
print(garbled)
print(garbled.encode("gbk", errors="replace").decode("utf-8", errors="replace"))
```

<div class="line-notes">

- `data = "退款申请".encode("gbk")` 按 GBK 编码,四个汉字每个 2 字节,共 8 字节。
- `print(data)` 字节串。
- `print(data.decode("gbk"))` 按 GBK 解码,原样还原。
- `garbled = "退款申请".encode().decode("gbk", errors="replace")` 先按 UTF-8 编码出 12 个字节,再错误地按 GBK 读,`errors="replace"` 让读不懂的字节变成 `�` 而不是报错。
- `print(garbled)` 乱码。
- `print(garbled.encode("gbk", errors="replace").decode("utf-8", errors="replace"))` 想反向操作救回来:把乱码按 GBK 编码回字节、再按 UTF-8 解码。`errors="replace"` 在编码时的意思是遇到编不了的字符用 `?` 顶替。

</div>

```text
$ uv run python part01/ex3_recover.py
b'\xcd\xcb\xbf\xee\xc9\xea\xc7\xeb'
退款申请
閫�娆剧敵璇�
�?款申�?
```

<div class="line-notes">

- `b'\xcd\xcb\xbf\xee\xc9\xea\xc7\xeb'` 8 个字节,每个字 2 个。
- `退款申请` GBK 读 GBK 的字节,还原。
- `閫�娆剧敵璇�` UTF-8 的字节被当成 GBK 读,夹杂着 `�`。
- `�?款申�?` 想救回来,只救回了「款」和「申」,另外两个字变成了 `�` 和 `?`。原因:GBK 读错的时候有些字节组合不合法,被换成 `�` 的那一刻原始字节就丢了,后面再怎么倒腾也回不来。

</div>

结论:乱码一旦被 `errors="replace"` 压过,或者已经存盘,多半救不回来。正确的做法是在**第一次读**的时候就用对编码,别指望事后修。没压过的乱码有时能原路还原:前面的 `璁¤垂` 就可以,`"璁¤垂".encode("gbk").decode("utf-8")` 会得到 `计费`(我单独试过)。可是同样是 UTF-8 读成 GBK,「退款申请」这四个字连严格模式都读不出来,直接报 `UnicodeDecodeError: 'gbk' codec can't decode byte 0x80`,只能靠 `replace` 硬读,硬读就留下了 `�`。

</details>

### 练习 4:从一句话里拆出两个价格

CloudLedger 的套餐页上有一句 `49元/月,468元/年`。写 `part01/ex4_prices.py`:从键盘读这句话,拆出月付和年付价格(整数元),换成分,打印 `月付 49 元,年付 468 元` 和 `年付比月付一年省 120.00 元`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex4_prices.py
text = input("套餐价格(如 49元/月,468元/年):")

parts = text.split(",")
month_fen = int(parts[0].split("元")[0]) * 100
year_fen = int(parts[1].split("元")[0]) * 100

saved_fen = month_fen * 12 - year_fen
print(f"月付 {month_fen / 100:.0f} 元,年付 {year_fen / 100:.0f} 元")
print(f"年付比月付一年省 {saved_fen / 100:,.2f} 元")
```

<div class="line-notes">

- `text = input("套餐价格(如 49元/月,468元/年):")` 读一行。
- `parts = text.split(",")` 按逗号拆成两段:`["49元/月", "468元/年"]`。
- `month_fen = int(parts[0].split("元")[0]) * 100` 从里往外读:`parts[0]` 是 `49元/月`;`.split("元")` 按「元」拆成 `["49", "/月"]`;`[0]` 取第一段 `49`;`int` 转成 49;乘 100 得 4900 分。这里有两层 `[...]`:先 `[0]` 选第几段字符串,再 `.split("元")[0]` 选拆出来的第几段。
- `year_fen = int(parts[1].split("元")[0]) * 100` 年付同理,`468元/年` 拆出 `468`,46800 分。
- `saved_fen = month_fen * 12 - year_fen` 月付一年 4900 × 12 = 58800 分,减去年付 46800 分,省 12000 分。
- `print(f"月付 {month_fen / 100:.0f} 元,年付 {year_fen / 100:.0f} 元")` `.0f` 是小数点后 0 位,4900 / 100 = 49.0 显示成 `49`。
- `print(f"年付比月付一年省 {saved_fen / 100:,.2f} 元")` 12000 / 100 = 120.0,显示 `120.00`。

</div>

```text
$ uv run python part01/ex4_prices.py
套餐价格(如 49元/月,468元/年):49元/月,468元/年
月付 49 元,年付 468 元
年付比月付一年省 120.00 元
```

<div class="line-notes">

- `月付 49 元,年付 468 元` 拆出来的两个数没错。
- `年付比月付一年省 120.00 元` 每个席位一年省 120 元,和 Day 12 的 600 元(5 个席位)一致:120 × 5 = 600。

</div>

这种「按已知的分隔符一层层拆」很脆弱,只要网页改成 `49 元 / 月` 或者 `¥49/月` 就会出错。真实项目里这类文本会用正则表达式(这门课后面会学)或者让模型直接输出结构化的数据。

</details>

练习的验收标准:`strip_demo.py`、`remove_demo.py`、`replace_demo.py`、`split_demo.py`、`join_demo.py`、`search_demo.py`、`case_demo.py`、`encoding_demo.py`、`mojibake_demo.py`、`normalize_demo.py`、`ask_amount.py`、`ticket_card2.py` 和四道练习都能跑,输出和文中一致;能不看文章说出 `strip(".com")` 为什么不是去掉 `.com`、`find` 和 `index` 的区别、`len("计费")` 是 2 而 UTF-8 字节数是 6、乱码两种典型样子(`璁¤垂` 和 `�`)各是哪个方向读错;能默写 `ask_amount.py` 里清洗的那几行。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 方法(method) | 属于某类数据的函数,写成 `对象.名字(...)`,如 `s.strip()`;JS 里同样写法 |
| `repr()` | 内置函数,把值连引号一起打印,看得见首尾空格和转义,调试用 |
| `strip` / `lstrip` / `rstrip` | 去掉两头 / 左边 / 右边的空白;给参数时是「去掉这些字符中的任何一个」 |
| `removeprefix` / `removesuffix` | 去掉具体的开头 / 结尾子串,不匹配就原样返回(Python 3.9 起) |
| `replace` | 把所有出现的子串换掉,返回新字符串;JS 的 `replace` 只换第一个 |
| `split` | 按分隔符拆成列表;不给分隔符时按任意空白拆;`maxsplit` 限制最多拆几刀 |
| `join` | 用分隔符把列表里的字符串串成一个,写法是 `分隔符.join(列表)` |
| 列表(list) | 用方括号括起来的一串东西,相当于 JS 的数组;Day 21 细讲 |
| `find` / `index` | 找子串位置;找不到 `find` 返回 -1,`index` 报 `ValueError` |
| `in` | 判断一个字符串是不是另一个的一部分,返回布尔值 |
| 码点(code point) | Unicode 给每个字符的编号,「计」是 35745 |
| 编码(encode) / 解码(decode) | 字符串变成字节 / 字节变回字符串的规则 |
| 字节(byte) | 0 到 255 的一个数,文件和网络里存的最小单位;Python 里叫 `bytes` |
| UTF-8 | 最通行的编码,英文 1 字节、汉字 3 字节、emoji 4 字节 |
| GBK | 老的中文编码,汉字 2 字节,国内老系统和老 CSV 里常见 |
| 乱码(mojibake) | 写入和读取用了不同编码得到的乱字 |
| `UnicodeDecodeError` | 字节按某种编码读不出来时的错误 |
| 全角 / 半角 | 中文输入法下敲出的占两格宽的数字、标点(`２９９`、`，`)和英文的普通字符(`299`、`,`) |
| NFKC | Unicode 规范化的一种,把全角变半角等「兼容字符」统一成标准写法 |
| `import` | 把别的模块拿进来用;标准库不用安装,Day 32 细讲 |

## 常见误区

**以为方法改了原字符串。** `s.strip()` 返回新字符串,`s` 没变。想保留要存起来:`s = s.strip()`。

**把 `strip(".com")` 当成去掉 `.com`。** 它去掉两头属于 `.`、`c`、`o`、`m` 的任何字符。要去具体后缀用 `removesuffix`。

**用 `split(" ")` 拆人敲的文字。** 连续空格会拆出空字符串,后面的位置全乱。拆空白用不带参数的 `split()`。

**以为空字符串拆出来是空列表。** `"".split(",")` 是 `['']`,一个元素。

**拿 `find` 的结果直接切片。** 找不到是 `-1`,切片时 `-1` 是最后一个字符,不会报错,切出奇怪的结果。先判断是不是 `-1`。

**JS 里写惯了 `replace`,以为 Python 也只换第一个。** Python 全换,`"1,234,567".replace(",", "")` 一步到位。

**把字符数当字节数。** `len` 数字符,`.encode()` 之后的 `len` 才是字节数,汉字差 3 倍。

**读文件不指定编码。** 默认值取决于系统,在你电脑上好好的,换一台机器就乱码。Day 38 会教怎么写。

**看到乱码就用 `errors="replace"` 压下去。** 错误是被压下去了,信息也丢了。乱码出现时要找真正的编码,不是让它不报错。

**漏掉全角字符。** 用户从中文输入法输入的 `２９９`、`，`、`　`(全角空格)和肉眼看到的半角几乎一样,但程序认的是编码。输入先过一遍 `unicodedata.normalize("NFKC", ...)`。

## 学习资料

### 文档与文章

- [Python 标准库 · 内置类型 · 字符串方法](https://docs.python.org/zh-cn/3.12/library/stdtypes.html#string-methods):中文,所有字符串方法的完整列表。今天用到的十来个都在里面,每个有一句说明加例子。当字典查,不用从头读。
- [Python 教程 · 数字、文本](https://docs.python.org/zh-cn/3.12/tutorial/introduction.html#text):中文,和 Day 15 同一节,官方对「字符串不可变」的说法在最后。
- [Unicode 指南](https://docs.python.org/zh-cn/3.12/howto/unicode.html):中文,官方的 Unicode HOWTO。读开头的「Unicode 概述」和「Python 对 Unicode 的支持」两节,就是今天编码那部分的权威版,有些概念比今天深,读懂前半部分就够。
- [unicodedata — Unicode 数据库](https://docs.python.org/zh-cn/3.12/library/unicodedata.html):中文,今天用到的 `normalize` 在里面,读 `normalize` 那一条,四种规范化的区别讲得很明白。
- [MDN · String.prototype.split()](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/String/split):中文,JS 的 `split`,对照 Python 看。
- [MDN · TextEncoder](https://developer.mozilla.org/zh-CN/docs/Web/API/TextEncoder):中文,JS 里把字符串变成 UTF-8 字节的 API,今天用过一次。
- [Joel Spolsky · The Absolute Minimum Every Software Developer Absolutely, Positively Must Know About Unicode and Character Sets](https://www.joelonsoftware.com/2003/10/08/the-absolute-minimum-every-software-developer-absolutely-positively-must-know-about-unicode-and-character-sets-no-excuses/):英文,2003 年的经典文章,讲清楚了「文本和字节不是一回事」。年代久,但讲的原理现在仍然成立。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1tx4y197gX&autoplay=0&high_quality=1" title="python字符串-04常用方法replace、split、join" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>数分安奇 · python字符串-04常用方法replace、split、join · 2 分钟半,2023 年。三个方法各演示一遍,很短,看完当复习。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV18a4y1E7bd&autoplay=0&high_quality=1" title="【思维教学】Python 编码与解码; encode & decode: ascii(); ord(); chr()" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>装丫的 · 【思维教学】Python 编码与解码 encode & decode · 15 分钟,2020 年,播放 5500。从 ASCII 讲到 `ord`、`chr`、`encode`、`decode`,和今天编码那部分顺序一致。讲得偏慢,可以 1.5 倍速。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/MijmeoH9LT4" title="Characters, Symbols and the Unicode Miracle - Computerphile" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Computerphile · Characters, Symbols and the Unicode Miracle · 英文,可开自动字幕。从 ASCII 讲到 Unicode 和 UTF-8,为什么一个字符可以占多个字节,不涉及 Python,概念讲得最清楚的一个,几分钟。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/sgHbC6udIqc" title="Pragmatic Unicode, or, How do I stop the pain?" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Ned Batchelder · Pragmatic Unicode, or, How do I stop the pain? · 英文,PyCon 讲座,发布在 Next Day Video 频道。专门讲 Python 里字符串和字节怎么分开处理(「Unicode 三明治」)。时间比较长,今天只看开头的几个概念,等 Day 38 读文件时再回来完整看。</figcaption>
</figure>

### 书籍

- Eric Matthes《Python Crash Course》第 3 版,No Starch Press,2023(中译《Python编程:从入门到实践》)。第 2 章「Variables and Simple Data Types」里有字符串方法(`strip`、`title`、`upper`、`lower`),按今天的内容对照看。
- Allen B. Downey《Think Python》第 3 版,O'Reilly,2024,[免费在线版](https://allendowney.github.io/ThinkPython/)。第 8 章 Strings and Regular Expressions 里有字符串方法和 `in` 的用法。后半章的正则暂时不用看。
- Luciano Ramalho《Fluent Python》第 2 版,O'Reilly,2022。第 4 章「Unicode Text Versus Bytes」专讲文本和字节,是这个主题最好的书面材料。现在读太深,等 Day 38 读文件时再回来翻。

### 开源项目与代码

- [Asabeneh/30-Days-Of-Python](https://github.com/Asabeneh/30-Days-Of-Python):英文,「Day 4 Strings」一章后半部分列了字符串方法,每个配一行例子,里面 `strip('noth')` 那条正好是今天说的字符集合用法,可以对照今天的内容再敲一遍。
- [satwikkansal/wtfpython](https://github.com/satwikkansal/wtfpython):页面里搜 `Decimal characters`,有一条讲 `int()` 连阿拉伯数字写的 `١٢٣` 都认,和今天说的全角数字是同一类现象,还附了一篇相关的小故事。

## 自测

1. `s = "  299元 "`。下面三个表达式分别得到什么:`s.strip()`、`s.strip().removesuffix("元")`、`s.strip("元")`?

<details><summary>答案</summary>

`"299元"`;`"299"`;`"  299元 "`(原样)。第三个很容易想错:`strip("元")` 只去掉**两头**的「元」,但两头是空格,不是「元」,所以什么都没去掉。要先 `strip()` 去空白,再 `removesuffix("元")` 去后缀。

</details>

2. `"T005  登录  C031".split(" ")` 和 `"T005  登录  C031".split()` 的结果各有几个元素?为什么?

<details><summary>答案</summary>

`split(" ")` 得 5 个:`['T005', '', '登录', '', 'C031']`,每两个空格之间多出一个空字符串。`split()` 得 3 个:`['T005', '登录', 'C031']`,不给分隔符时连续空白当成一个。

</details>

3. `line.find("退款")` 和 `line.index("退款")` 在找不到时有什么不同?你什么时候选 `index`?

<details><summary>答案</summary>

`find` 返回 `-1`,`index` 抛 `ValueError: substring not found`。选 `index`:你认为这个子串一定存在,找不到说明数据有问题,希望程序当场停下来。选 `find`:找不到是正常情况,你要自己判断。要注意拿 `find` 的 `-1` 去切片会得到怪结果,所以用 `find` 之后一定要判断 `-1`。

</details>

4. 同事说「`"计费"` 的长度是 2,所以我分配 2 个字节存它」。哪里错了?如果存成 UTF-8 文件要几个字节,GBK 呢?

<details><summary>答案</summary>

`len` 数的是字符,和存储字节数是两件事。UTF-8 里每个汉字 3 字节,「计费」要 6 字节;GBK 里每个汉字 2 字节,要 4 字节。

</details>

5. 面试题:Agent 要把用户发来的一段文字交给模型之前先「清洗」一遍。你会清洗哪些东西?为什么要在把文字发给模型前做,而不是让模型自己处理?

<details><summary>答案</summary>

常见的清洗:去掉两头空白和多余换行;把全角字符规范化成半角(`unicodedata.normalize("NFKC", ...)`),让后面的关键词匹配、数字转换更稳;去掉不可见字符(零宽空格等,有时是恶意注入);限制长度(按 token 估算,不是只按字符)。在发给模型之前做的原因:一是省钱,多余的空白和重复内容也要计 token;二是确定性,规则代码每次结果一样,模型处理可能变;三是安全,清洗掉可疑的控制字符能降低提示注入的风险(这门课安全那部分会讲)。当然规则只处理格式,语义上的判断仍然交给模型。

</details>

## 明天预告

Day 17 · 条件判断:if、elif、else 和布尔运算。今天做的清洗和拆分都有一个共同的漏洞:`abc` 这样根本不是数字的输入、`T009 计费` 这样缺字段的工单行、`find` 返回的 `-1`,程序都不会自己判断,直接崩了或者得到错的结果。明天学 `if`:让程序先看一眼再决定怎么走,用 `and`、`or`、`not` 把几个条件组合起来,并用关键词规则把工单自动分成「计费」「登录」「功能」三类。
