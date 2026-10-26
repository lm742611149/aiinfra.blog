---
title: 'Day 30 · 函数(三):*args、**kwargs、作用域和 lambda'
description: 'print 为什么能传任意多个参数?答案是 *args。今天学 *args 和 **kwargs(对应 JS 的 rest 参数和展开运算符),搞清函数里的名字和外面的名字谁管谁(作用域,撞一次 UnboundLocalError),再学一次性的小函数 lambda(对应箭头函数),最后拼一个规则和权重都能配置的工单打分函数。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'agent-zero']
series: 'agent-zero'
day: 30
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 29](/blog/agent-zero/day-029-functions-2/) 学了默认参数和关键字参数:`def with_tax(fen, rate_percent=6)` 不传就用 6,调用时写「名字=值」顺序随意;三个传参报错(位置跟在关键字后面、同一个参数传两次、名字拼错);以及 Python 最有名的坑:默认值只在 `def` 那一刻算一次,`tags=[]` 被所有调用共用,两个客户的对话串在一起,修法是 `None` 加 `if x is None`。小项目写了一个带四个可选条件的 `search(tickets, category=None, min_fen=0, keyword="", limit=None)`。

到现在为止,你写的函数收几个参数是定死的。可 `print("a", "b", "c")` 想传几个传几个,Day 27 里 `set.intersection(*key_sets)` 那个星号我也只说了一句「先当成把列表展开」。另外 Day 28 的 `fen = 100` 那一行留了个尾巴:函数里的名字和外面的名字,到底谁管谁?今天把这两笔账还上,顺便学 `lambda`,让 Day 28 的 `key=amount_then_id` 缩成一行。

## 今天要解决的问题

学完今天,你应该能:

1. 写出 `def total_fen(*amounts)` 这样收任意多个位置参数的函数,知道 `amounts` 在函数里是一个元组;会在调用时用 `*paid` 把列表展开成一个个参数,能解释 `set.intersection(*key_sets)` 和 `print(*ids, sep=" | ")`;认得忘了加星号的报错 `TypeError: unsupported operand type(s) for +: 'int' and 'list'`。
2. 写出 `def make_ticket(ticket_id, desc, **extra)` 收任意多个关键字参数(`extra` 是字典),会用 `label(**row)` 把字典展开成关键字参数,会写 `def call_log(func, *args, **kwargs)` 这种「原样透传」的函数;知道单独一个 `*` 的意思是「后面的参数只能按名字传」。
3. 说清作用域的三条规则:函数里能读外面的变量;函数里一赋值,这个名字就变成函数自己的;函数里的名字出了函数就没了。能复现并解释 `UnboundLocalError: cannot access local variable 'calls' where it is not associated with a value`,知道 `global` 是什么、为什么尽量不用,知道 Python 没有块级作用域(`for` 循环变量在循环外还在)。
4. 用 `lambda` 写一行的小函数,把 `sorted(..., key=)`、`max(..., key=)` 写短;知道它只能是一个表达式(写 `return` 会 `SyntaxError`);认得循环里造 lambda 的坑和 Ruff 的 B023;写出 `part01/ticket_score.py`:规则用 `*rules` 传、权重用 `**weights` 传、规则本身是 lambda 的工单打分函数。

预计用时:3 小时。`*args` 和调用时展开 40 分钟,`**kwargs` 和透传 35 分钟,作用域 50 分钟,lambda 30 分钟,小项目和练习 45 分钟。今天内容偏多,作用域那一节可以放到第二天再看。

前置:[Day 21](/blog/agent-zero/day-021-lists/)(列表、`sorted`、`append` 原地修改)、[Day 22](/blog/agent-zero/day-022-tuples-unpack/)(元组、解包)、[Day 24](/blog/agent-zero/day-024-dicts/)(字典、`.get`、`.items()`)、[Day 28](/blog/agent-zero/day-028-functions-1/)(`def`、`return`、`key=函数名`)、[Day 29](/blog/agent-zero/day-029-functions-2/)(默认参数、关键字参数)。今天不调任何 API,花费 0 元。

学法提示:先对照文章逐行敲一遍(代码自己敲,不复制粘贴)并跑通;第二天合上文章,把 `scope_err.py`(会报 `UnboundLocalError` 的那个)和 `ticket_score.py` 的 `score`、`rank` 两个函数默写出来,先写会出错的版本,确认你能让报错重现;然后做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先说清楚我是在哪跑的

输出是我 2026-10-23 在 2019 款 Intel MacBook Pro(macOS 14、zsh)上用演示家目录真跑的,家目录显示成 `/Users/你`,`~/agent-zero-lab` 接着 Day 29 的状态,`uv run python` 是 3.12.13,Ruff 是 0.17.2,basedpyright 是 standard 档。今天的脚本都放在 `part01/`,在仓库根目录用 `uv run python part01/文件名.py` 运行。JS 的对照用 `node -e` 跑,我的 Node 是 24。

## 先看 JS 里对应的四样东西

今天 Python 的四个知识点,JS 里都有对应物,先在 Node 里跑一遍,后面逐个对上:

```text
$ node -e '
function totalFen(...amounts) {
  return amounts.reduce((a, b) => a + b, 0);
}
console.log(totalFen(29900, 46800));
const paid = [59800, 46800, 29900];
console.log(totalFen(...paid));
function label(id, { note = "", ...rest } = {}) {
  return `${id} ${note} ${JSON.stringify(rest)}`;
}
console.log(label("T201", { note: "加急", urgent: true }));
let rate = 6;
function usePromo() {
  let rate = 0;
  return rate;
}
console.log(usePromo(), rate);
for (let i = 0; i < 3; i++) {}
try { console.log(i); } catch (e) { console.log(e.name + ": " + e.message); }
const double = (fen) => fen * 2;
console.log(double(150));
'
76700
136500
T201 加急 {"urgent":true}
0 6
ReferenceError: i is not defined
300
```

<div class="line-notes">

- `function totalFen(...amounts) {` JS 的 rest 参数:`...amounts` 把多出来的实参收成一个数组。Python 里写 `*amounts`,收成一个元组。
- `console.log(totalFen(...paid));` 调用时的展开运算符 `...paid`,把数组拆成一个个参数。Python 里写 `*paid`,同一个星号,位置不同意思不同。
- `function label(id, { note = "", ...rest } = {}) {` JS 想收「不定个数的具名选项」要靠解构对象,剩下的收进 `rest`。Python 用 `**extra` 直接收成字典。
- `let rate = 0;` 函数里用 `let` 另起一个同名变量,外面的 `rate` 不受影响。Python 里**不写任何关键字**,函数里一赋值就是自己的。
- `for (let i = 0; i < 3; i++) {}` `let` 声明的循环变量只在循环块里存在。
- `try { console.log(i); }` 循环外读 `i`,得到 `ReferenceError: i is not defined`。**Python 没有块级作用域**,循环结束后 `i` 还在,今天后面会看到。
- `const double = (fen) => fen * 2;` 箭头函数。Python 对应 `lambda fen: fen * 2`。

</div>

## *args:收下数量不定的位置参数

`print("T201", "T202", "T203")` 能传三个,传十个也行。它是怎么写的?参数名前加一个星号。新建 `part01/star_args.py`:

```python
# agent-zero-lab/part01/star_args.py
def total_fen(*amounts):
    print("  收到的 amounts 是:", amounts, type(amounts).__name__)
    total = 0
    for fen in amounts:
        total += fen
    return total


print(total_fen(29900, 46800))
print(total_fen(29900))
print(total_fen())


def report(title, *amounts, unit="元"):
    return f"{title}:{len(amounts)} 笔,合计 {sum(amounts) // 100}{unit}"


print(report("今日退款", 29900, 46800, 4900))
print(report("今日退款"))
print(report("Refunds", 29900, 46800, unit=" CNY"))
```

<div class="line-notes">

- `def total_fen(*amounts):` 参数名前加 `*`:调用时**所有按位置传进来的实参**,被打包成一个元组,名字叫 `amounts`。名字随便起,社区习惯叫 `args`(arguments 的缩写),所以你会常看到 `*args`。
- `print("  收到的 amounts 是:", amounts, type(amounts).__name__)` 先看看它到底是什么。第一次调用传了两个数,`amounts` 是 `(29900, 46800)`,类型是 `tuple`(Day 22)。
- `total = 0` 累加器。
- `for fen in amounts:` 元组可以直接循环。
- `total += fen` 累加。
- `return total` 交回合计。
- `print(total_fen(29900, 46800))` 传两个,合计 76700。
- `print(total_fen(29900))` 传一个,`amounts` 是 `(29900,)`,只有一项的元组,Day 22 说过那个逗号不能少。
- `print(total_fen())` 一个都不传,**不报错**,`amounts` 是空元组 `()`,合计 0。对比 Day 28:普通参数少传会 `TypeError`,`*` 参数少传没事。
- `def report(title, *amounts, unit="元"):` 三种参数混用:`title` 是普通位置参数,必须传;`*amounts` 收后面所有位置实参;`unit` 排在 `*amounts` 后面,它**只能按名字传**,因为按位置传的都被 `*amounts` 吃掉了。
- `return f"{title}:{len(amounts)} 笔,合计 {sum(amounts) // 100}{unit}"` `len` 和 `sum` 对元组都能用。
- `print(report("今日退款", 29900, 46800, 4900))` 第一个实参给 `title`,剩下三个进 `amounts`。
- `print(report("今日退款"))` 只传 `title`,`amounts` 为空,`sum(())` 是 0。
- `print(report("Refunds", 29900, 46800, unit=" CNY"))` `unit` 按名字传。要是写成 `report("Refunds", 29900, 46800, " CNY")`,那个 `" CNY"` 会被当成第三笔金额塞进 `amounts`,`sum` 时报错。

</div>

```text
$ uv run python part01/star_args.py
  收到的 amounts 是: (29900, 46800) tuple
76700
  收到的 amounts 是: (29900,) tuple
29900
  收到的 amounts 是: () tuple
0
今日退款:3 笔,合计 816元
今日退款:0 笔,合计 0元
Refunds:2 笔,合计 767 CNY
```

<div class="line-notes">

- `  收到的 amounts 是: (29900, 46800) tuple` 两个实参被装进一个元组。
- `76700` 合计。
- `  收到的 amounts 是: (29900,) tuple` 一个实参,单项元组。
- `  收到的 amounts 是: () tuple` 零个实参,空元组,不报错。
- `今日退款:3 笔,合计 816元` 29900 + 46800 + 4900 = 81600 分。
- `今日退款:0 笔,合计 0元` 零笔。
- `Refunds:2 笔,合计 767 CNY` `unit` 换成了 ` CNY`。

</div>

`print` 就是这样写的。Python 自带一个 `inspect` 模块能把函数的「签名」(参数表)打出来,在仓库根目录跑一行:

```text
$ uv run python -c "import inspect; print(inspect.signature(print))"
(*args, sep=' ', end='\n', file=None, flush=False)
```

<div class="line-notes">

- `(*args, sep=' ', end='\n', file=None, flush=False)` `print` 的参数表:开头一个 `*args` 收所有要打印的东西,后面 `sep`、`end` 等四个只能按名字传。Day 29 你写 `print("T201", "T202", sep=" | ")` 必须写 `sep=`,原因就在这里:位置实参全被 `*args` 收走了。

</div>

## 调用时的 *:把列表展开成一个个参数

星号还有另一个用处,在**调用**的括号里,意思正好反过来:把一个列表(或元组、集合)拆开,当成一个个参数传进去。对应 JS 的展开运算符 `...paid`。新建 `part01/star_call.py`:

```python
# agent-zero-lab/part01/star_call.py
def total_fen(*amounts):
    return sum(amounts)


paid = [59800, 46800, 29900, 29900, 4900]
print(total_fen(*paid))
print(total_fen(*paid, 100))

ids = ["T201", "T203", "T204"]
print(*ids)
print(*ids, sep=" | ")

key_sets = [{"id", "desc", "tags"}, {"id", "desc"}, {"id", "desc", "assignee"}]
print(set.intersection(*key_sets))

first, *rest = paid
print(first, rest)
```

<div class="line-notes">

- `def total_fen(*amounts):` 还是那个收任意多个参数的函数,这次直接 `sum`。
- `paid = [59800, 46800, 29900, 29900, 4900]` Day 21 那 5 张有金额的工单,存在一个列表里。
- `print(total_fen(*paid))` 调用时写 `*paid`:把列表的 5 项拆开,等于写了 `total_fen(59800, 46800, 29900, 29900, 4900)`。进函数后 `amounts` 又被打包成 5 项的元组。先拆再包,看着绕,但两边的写法都很自然。
- `print(total_fen(*paid, 100))` 展开的后面还可以再跟别的实参,一共 6 个。
- `ids = ["T201", "T203", "T204"]` 三个工单号。
- `print(*ids)` 等于 `print("T201", "T203", "T204")`,三个用空格隔开。对比 `print(ids)` 会打印整个列表,带方括号和引号。
- `print(*ids, sep=" | ")` 展开后再加关键字参数。
- `key_sets = [{"id", "desc", "tags"}, {"id", "desc"}, {"id", "desc", "assignee"}]` Day 27 看板里的句式:三张工单各自的键集合。
- `print(set.intersection(*key_sets))` `set.intersection` 能收任意多个集合求交集,`*key_sets` 把列表里的三个集合拆开传进去。这就是 Day 27 那句「先当成把列表展开」的真相。
- `first, *rest = paid` 解包时也能用星号(Day 22 的解包的扩展):第一项给 `first`,**剩下的全部**装成列表给 `rest`。
- `print(first, rest)` `first` 是 59800,`rest` 是剩下四项的列表。

</div>

```text
$ uv run python part01/star_call.py
171300
171400
T201 T203 T204
T201 | T203 | T204
{'id', 'desc'}
59800 [46800, 29900, 29900, 4900]
```

<div class="line-notes">

- `171300` 五张合计。
- `171400` 再加 100。
- `T201 T203 T204` 三个工单号按 `print` 的默认分隔符(空格)显示,没有方括号。
- `T201 | T203 | T204` 分隔符换成 ` | `。
- `{'id', 'desc'}` 三个集合共同的键。集合打印的顺序不固定(Day 25)。
- `59800 [46800, 29900, 29900, 4900]` 带星号的解包:一个值加一个「剩下的」列表。

</div>

一张图把定义时的 `*` 和调用时的 `*` 放在一起看:

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="星号在两个位置的意思相反:调用时 *paid 把列表拆成一个个实参;定义时 *amounts 把一个个实参打包成元组">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="12" y="16" width="190" height="60" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="22" y="38" fill="var(--ink)">paid = [59800, 46800, 4900]</text>
<text x="22" y="62" fill="var(--ink-faint)">一个列表</text>
<rect x="250" y="16" width="160" height="60" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="260" y="38" fill="var(--ink)">total_fen(*paid)</text>
<text x="260" y="62" fill="var(--ink-soft)">调用时的 *:拆开</text>
<rect x="458" y="16" width="170" height="60" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="468" y="38" fill="var(--ink)">59800, 46800, 4900</text>
<text x="468" y="62" fill="var(--ink-faint)">三个实参</text>
<line x1="202" y1="46" x2="250" y2="46" stroke="var(--compute)" stroke-width="1.5"/>
<line x1="410" y1="46" x2="458" y2="46" stroke="var(--compute)" stroke-width="1.5"/>
<rect x="458" y="130" width="170" height="60" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="468" y="152" fill="var(--ink)">59800, 46800, 4900</text>
<text x="468" y="176" fill="var(--ink-faint)">三个实参</text>
<rect x="250" y="130" width="160" height="60" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="260" y="152" fill="var(--ink)">def total_fen(*amounts)</text>
<text x="260" y="176" fill="var(--ink-soft)">定义时的 *:打包</text>
<rect x="12" y="130" width="190" height="60" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="22" y="152" fill="var(--ink)">amounts == (59800, 46800, 4900)</text>
<text x="22" y="176" fill="var(--ink-faint)">一个元组</text>
<line x1="458" y1="160" x2="410" y2="160" stroke="var(--mem)" stroke-width="1.5"/>
<line x1="250" y1="160" x2="202" y2="160" stroke="var(--mem)" stroke-width="1.5"/>
<text x="200" y="110" fill="var(--ink-faint)">上面一行:调用方;下面一行:函数内部</text>
</g>
</svg>
<figcaption>同一个星号,在调用处是「拆开」,在 def 里是「打包」。琥珀色是调用方做的事,蓝色是函数定义做的事。</figcaption>
</figure>

### 忘了加星号会怎样

最常见的错是直接把列表传给 `*amounts`。新建 `part01/star_call_err.py`:

```python
# agent-zero-lab/part01/star_call_err.py
def total_fen(*amounts):
    return sum(amounts)


paid = [59800, 46800, 29900]
print(total_fen(paid))
```

```text
$ uv run python part01/star_call_err.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/star_call_err.py", line 7, in <module>
    print(total_fen(paid))
          ^^^^^^^^^^^^^^^
  File "/Users/你/agent-zero-lab/part01/star_call_err.py", line 3, in total_fen
    return sum(amounts)
           ^^^^^^^^^^^^
TypeError: unsupported operand type(s) for +: 'int' and 'list'
```

<div class="line-notes">

- `File "/Users/你/agent-zero-lab/part01/star_call_err.py", line 7, in <module>` 调用在第 7 行。注意这次 Traceback 有**两段** `File`:下面一段才是真正出错的位置。
- `File "/Users/你/agent-zero-lab/part01/star_call_err.py", line 3, in total_fen` 错在函数体的第 3 行,`in total_fen` 告诉你是在哪个函数里。
- `return sum(amounts)` 没加星号,`amounts` 是 `([59800, 46800, 29900],)`:一个单项元组,那一项是整个列表。`sum` 从 0 开始加,`0 + [列表]`,整数加列表。
- `TypeError: unsupported operand type(s) for +: 'int' and 'list'` 整数和列表不能相加。以后看到「本来该是数字的地方出现了 `list`」,先查调用处是不是少了星号。

</div>

## **kwargs:收下数量不定的关键字参数

一个星号收位置实参,**两个星号收关键字实参**,打包成一个字典。社区习惯叫 `kwargs`(keyword arguments)。新建 `part01/kw_args.py`:

```python
# agent-zero-lab/part01/kw_args.py
def make_ticket(ticket_id, desc, **extra):
    print("  收到的 extra 是:", extra, type(extra).__name__)
    ticket = {"id": ticket_id, "desc": desc}
    ticket.update(extra)
    return ticket


print(make_ticket("T201", "重复扣款"))
print(make_ticket("T202", "验证码收不到", category="登录", urgent=True))


def label(ticket_id, category, note=""):
    text = f"{ticket_id} {category}"
    if note:
        text += f" [{note}]"
    return text


options = {"note": "加急"}
print(label("T201", "计费", **options))

row = {"ticket_id": "T203", "category": "计费", "note": "大额"}
print(label(**row))


def call_log(func, *args, **kwargs):
    print(f"  调用 {func.__name__},位置参数 {args},关键字参数 {kwargs}")
    return func(*args, **kwargs)


print(call_log(label, "T204", "功能"))
print(call_log(label, "T205", "登录", note="加急"))
```

<div class="line-notes">

- `def make_ticket(ticket_id, desc, **extra):` 两个普通参数,加一个 `**extra`:调用时所有**函数没有声明过的关键字实参**都被收进字典 `extra`,键是参数名,值是传的值。
- `print("  收到的 extra 是:", extra, type(extra).__name__)` 看一眼它是什么。
- `ticket = {"id": ticket_id, "desc": desc}` 先放两个固定字段。
- `ticket.update(extra)` `update` 把另一个字典的键值全部并进来(Day 24)。于是传了什么额外字段,工单上就多什么字段。
- `return ticket` 交回字典。
- `print(make_ticket("T201", "重复扣款"))` 没有额外的关键字实参,`extra` 是空字典 `{}`,不报错。
- `print(make_ticket("T202", "验证码收不到", category="登录", urgent=True))` `category` 和 `urgent` 都不在参数表里,Day 29 里这种调用会报 `unexpected keyword argument`;现在有了 `**extra`,它们被收进字典。
- `def label(ticket_id, category, note=""):` Day 29 的 `label` 简化版,一个可选的备注。
- `text = f"{ticket_id} {category}"` 基础文本。
- `text += f" [{note}]"` 有备注才追加。
- `return text` 交回。
- `options = {"note": "加急"}` 把可选项放在一个字典里。
- `print(label("T201", "计费", **options))` 调用时的 `**`:把字典展开成关键字实参,等于写了 `label("T201", "计费", note="加急")`。和 `*` 一样,调用处的 `**` 是「拆开」。
- `row = {"ticket_id": "T203", "category": "计费", "note": "大额"}` 一行工单数据,键名和参数名一模一样。
- `print(label(**row))` 整个字典展开,三个参数全按名字传。以后从 JSON 读出一条记录直接喂给函数,就是这个写法(键名必须和参数名对上,否则见下一个脚本)。
- `def call_log(func, *args, **kwargs):` 今天最重要的一个句式。它收一个函数 `func`,外加「不管你传什么」:位置的进 `args`,关键字的进 `kwargs`。
- `print(f"  调用 {func.__name__},位置参数 {args},关键字参数 {kwargs}")` 先记一笔日志。`func.__name__` 是函数的名字字符串(Day 28 见过 `type(x).__name__`,函数也有)。
- `return func(*args, **kwargs)` 然后把收到的东西**原样拆开**传给 `func`。`*args` 拆回位置实参,`**kwargs` 拆回关键字实参。`call_log` 自己不用知道 `func` 要几个参数、叫什么名字,这叫「透传」。第二部分要封装大模型接口时,`chat(messages, **kw)` 就是这样把 `temperature`、`tools` 这些选项原样递给底层的。
- `print(call_log(label, "T204", "功能"))` 传函数本身(不加括号,Day 28),两个位置实参。
- `print(call_log(label, "T205", "登录", note="加急"))` 多一个关键字实参,进 `kwargs`,再被拆给 `label`。

</div>

```text
$ uv run python part01/kw_args.py
  收到的 extra 是: {} dict
{'id': 'T201', 'desc': '重复扣款'}
  收到的 extra 是: {'category': '登录', 'urgent': True} dict
{'id': 'T202', 'desc': '验证码收不到', 'category': '登录', 'urgent': True}
T201 计费 [加急]
T203 计费 [大额]
  调用 label,位置参数 ('T204', '功能'),关键字参数 {}
T204 功能
  调用 label,位置参数 ('T205', '登录'),关键字参数 {'note': '加急'}
T205 登录 [加急]
```

<div class="line-notes">

- `  收到的 extra 是: {} dict` 没传额外字段,空字典。
- `{'id': 'T201', 'desc': '重复扣款'}` 只有两个固定字段。
- `  收到的 extra 是: {'category': '登录', 'urgent': True} dict` 两个额外字段被收成字典。
- `{'id': 'T202', 'desc': '验证码收不到', 'category': '登录', 'urgent': True}` `update` 之后工单上多了两个字段。
- `T201 计费 [加急]` `**options` 展开后 `note` 收到「加急」。
- `T203 计费 [大额]` `**row` 整个字典展开。
- `  调用 label,位置参数 ('T204', '功能'),关键字参数 {}` `call_log` 的日志:`args` 是元组,`kwargs` 是空字典。
- `T204 功能` 透传后 `label` 的结果。
- `  调用 label,位置参数 ('T205', '登录'),关键字参数 {'note': '加急'}` 这次 `kwargs` 里有东西。
- `T205 登录 [加急]` 备注被正确传到了 `label`。

</div>

### 字典的键和参数名对不上

`label(**row)` 要求字典的键名和函数的参数名一字不差。新建 `part01/kw_args_err.py`,把 `note` 写成 `notes`:

```python
# agent-zero-lab/part01/kw_args_err.py
def label(ticket_id, category, note=""):
    return f"{ticket_id} {category} {note}".strip()


row = {"ticket_id": "T203", "category": "计费", "notes": "大额"}
print(label(**row))
```

```text
$ uv run python part01/kw_args_err.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/kw_args_err.py", line 7, in <module>
    print(label(**row))
          ^^^^^^^^^^^^
TypeError: label() got an unexpected keyword argument 'notes'
```

<div class="line-notes">

- `print(label(**row))` 字典里有个键叫 `notes`,展开后等于传了 `notes="大额"`。
- `TypeError: label() got an unexpected keyword argument 'notes'` 和 Day 29 拼错参数名是同一个报错。区别是这次名字不在代码的调用处,而在**数据**里:从接口、文件读来的字典,键名多一个 s、大小写不同,就会在这里炸。这是以后用 `**` 喂数据给函数时最常见的坑,报错里的名字直接告诉你是哪个键。

</div>

### 单独一个 *:后面的参数只能按名字传

Day 29 说过开关类参数应该写名字,`label("T201", "计费", 29900, True)` 没人看得懂。Python 可以在参数表里放一个**单独的** `*`,它后面的参数就都不能按位置传。新建 `part01/kw_only.py`:

```python
# agent-zero-lab/part01/kw_only.py
def search(tickets, *, category=None, limit=None):
    found = [t for t in tickets if category is None or t["category"] == category]
    return found[:limit]


tickets = [
    {"id": "T901", "category": "计费"},
    {"id": "T902", "category": "登录"},
    {"id": "T903", "category": "计费"},
]
print(search(tickets, category="计费", limit=1))
print(search(tickets, "计费"))
```

<div class="line-notes">

- `def search(tickets, *, category=None, limit=None):` 中间那个 `*` 后面没有名字,它不收任何东西,只是一道线:**线后面的参数只能用「名字=值」传**。
- `found = [t for t in tickets if category is None or t["category"] == category]` 推导式加条件(Day 23):没给类别就全要,给了就只要匹配的。
- `return found[:limit]` 切片。`limit` 是 `None` 时 `found[:None]` 等于整个列表,这是切片的一个小特性,省掉一个 `if`。
- `print(search(tickets, category="计费", limit=1))` 按名字传,正常。
- `print(search(tickets, "计费"))` 想按位置传类别。

</div>

```text
$ uv run python part01/kw_only.py
[{'id': 'T901', 'category': '计费'}]
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/kw_only.py", line 13, in <module>
    print(search(tickets, "计费"))
          ^^^^^^^^^^^^^^^^^^^^^^^
TypeError: search() takes 1 positional argument but 2 were given
```

<div class="line-notes">

- `[{'id': 'T901', 'category': '计费'}]` 第一次调用正常:计费类只取 1 张。
- `TypeError: search() takes 1 positional argument but 2 were given` 第二次:`search` 只收 1 个位置参数(`tickets`),你给了 2 个。Day 28 见过这句,这次的原因是那道 `*` 线。编辑器提前画了红线 `Expected 1 positional argument`。

</div>

这个写法你会在 openai 这类库的函数签名里大量看到(第二部分),它们几乎所有选项都放在 `*` 后面,逼你写名字。写自己的工具函数时,我的习惯是:数据用位置,开关和选项放 `*` 后面。

## 作用域:函数里的名字和外面的名字

Day 28 的 `fn_params.py` 里,外面有 `fen = 100`,函数里也用 `fen`,两个互不干扰。现在把规则说全。**作用域**(scope)就是「一个名字在哪一段代码里有效」。Python 里只有三条规则需要记:

1. 函数里**能读**外面(模块层)的变量。
2. 函数里**一旦给某个名字赋值**,这个名字就是函数自己的,从头到尾都是,和外面同名的那个无关。
3. 函数里的名字,**出了函数就没了**。

新建 `part01/scope_basic.py`,先看第 1 条和第 3 条:

```python
# agent-zero-lab/part01/scope_basic.py
rate = 6


def with_tax(fen):
    taxed = fen + fen * rate // 100
    return taxed


print(with_tax(10000))
print("外面能看到 rate:", rate)
print("外面能看到 taxed 吗?")
print(taxed)
```

<div class="line-notes">

- `rate = 6` 写在最外层(没有缩进)的变量,叫**全局变量**(global),整个文件里都能读。
- `def with_tax(fen):` 函数。`fen` 是参数,也是函数自己的名字。
- `taxed = fen + fen * rate // 100` 函数里**读**了外面的 `rate`(规则 1),算出来存进 `taxed`。`taxed` 是在函数里赋值的,所以是函数自己的,叫**局部变量**(local)。
- `return taxed` 交回。
- `print(with_tax(10000))` `10000 + 10000 * 6 // 100` 是 10600。
- `print("外面能看到 rate:", rate)` 全局变量当然能看到。
- `print("外面能看到 taxed 吗?")` 提问。
- `print(taxed)` 在函数外面读 `taxed`。它是函数里的局部变量,函数一返回就没了(规则 3)。

</div>

```text
$ uv run python part01/scope_basic.py
10600
外面能看到 rate: 6
外面能看到 taxed 吗?
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/scope_basic.py", line 13, in <module>
    print(taxed)
          ^^^^^
NameError: name 'taxed' is not defined
```

<div class="line-notes">

- `10600` 函数里读到了全局的 `rate`。
- `外面能看到 rate: 6` 全局变量在外面当然能读。
- `NameError: name 'taxed' is not defined` 局部变量出了函数就不存在,和从来没定义过一样。编辑器一开始就画了红线 `"taxed" is not defined`。想拿到函数里算出的东西,只有一个办法:`return` 出来。

</div>

### 函数里赋值,就是函数自己的

规则 2 是 JS 开发者最容易想错的地方。JS 里要用 `let` 才会另起一个同名变量,不写 `let` 就是改外面的。Python 里**没有 `let`**,函数里赋值一律是新起局部变量。新建 `part01/scope_assign.py`:

```python
# agent-zero-lab/part01/scope_assign.py
rate = 6


def use_promo():
    rate = 0
    print("  函数里的 rate:", rate)


use_promo()
print("外面的 rate:", rate)
```

<div class="line-notes">

- `rate = 6` 全局的 `rate`。
- `def use_promo():` 促销:想把税率清零。
- `rate = 0` 函数里给 `rate` 赋值。这**不是**改外面的 `rate`,而是新建了一个函数自己的 `rate`,恰好同名。
- `print("  函数里的 rate:", rate)` 函数里读到的是自己的那个,0。
- `use_promo()` 调用。
- `print("外面的 rate:", rate)` 外面的 `rate` 原封不动。

</div>

```text
$ uv run python part01/scope_assign.py
  函数里的 rate: 0
外面的 rate: 6
```

<div class="line-notes">

- `  函数里的 rate: 0` 函数里是自己的 `rate`。
- `外面的 rate: 6` 外面的没被改。这种写法 basedpyright 不报错,Ruff 也不报,但如果你的本意是改外面的,它就悄悄没生效。

</div>

现在把规则 1 和规则 2 撞在一起,撞出一个只有 Python 才有的报错。「读」外面的变量可以,「改」它呢?新建 `part01/scope_err.py`,写一个调用计数器:

```python
# agent-zero-lab/part01/scope_err.py
calls = 0


def record_call():
    calls += 1
    print("已调用", calls, "次")


record_call()
```

<div class="line-notes">

- `calls = 0` 全局计数器。
- `def record_call():` 想每调一次就加一。
- `calls += 1` `calls += 1` 等于 `calls = calls + 1`,这是一个**赋值**。按规则 2,函数里给 `calls` 赋值,`calls` 就成了局部变量,**整个函数体里**的 `calls` 都指这个局部的;可等号右边要先读 `calls`,这时局部的 `calls` 还没有值。
- `print("已调用", calls, "次")` 走不到。
- `record_call()` 调用。

</div>

```text
$ uv run python part01/scope_err.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/scope_err.py", line 10, in <module>
    record_call()
  File "/Users/你/agent-zero-lab/part01/scope_err.py", line 6, in record_call
    calls += 1
    ^^^^^
UnboundLocalError: cannot access local variable 'calls' where it is not associated with a value
```

<div class="line-notes">

- `File "/Users/你/agent-zero-lab/part01/scope_err.py", line 6, in record_call` 错在函数体里的第 6 行。
- `calls += 1` 就是这一行。
- `UnboundLocalError: cannot access local variable 'calls' where it is not associated with a value` 翻译:访问了局部变量 `calls`,但它还没被赋过值。注意报错说它是「local variable」:Python 看到函数里有 `calls += 1`,就把 `calls` 整个当局部变量处理了,不去外面找。这条报错是 `NameError` 的一种,文字从 3.11 起是现在这样(更早的版本写 `local variable 'calls' referenced before assignment`)。Ruff 也提前点名了:`F823 Local variable 'calls' referenced before assignment`。

</div>

### global 能修,但尽量别用

Python 提供了 `global` 语句,在函数里声明「这个名字我指的是外面那个」。新建 `part01/scope_global.py`,左边用 `global` 修,右边用「传进去、返回出来」的写法做对比:

```python
# agent-zero-lab/part01/scope_global.py
calls = 0


def record_call():
    global calls
    calls += 1
    return calls


record_call()
record_call()
print("global 版:", calls)


def record_call2(count):
    return count + 1


calls2 = 0
calls2 = record_call2(calls2)
calls2 = record_call2(calls2)
print("传参返回版:", calls2)
```

<div class="line-notes">

- `calls = 0` 全局计数器。
- `global calls` 声明:函数里的 `calls` 就是全局那个,不要另起局部的。要写在函数体里任何使用 `calls` 之前。
- `calls += 1` 现在改的是全局变量。
- `return calls` 顺便交回。
- `record_call()` 两次调用。
- `print("global 版:", calls)` 全局的 `calls` 变成了 2。
- `def record_call2(count):` 另一种写法:不碰外面,收一个数,交回加一后的数。
- `return count + 1` 纯计算。
- `calls2 = 0` 外面自己管状态。
- `calls2 = record_call2(calls2)` 把结果接回来。两次。
- `print("传参返回版:", calls2)` 也是 2。

</div>

```text
$ uv run python part01/scope_global.py
global 版: 2
传参返回版: 2
```

<div class="line-notes">

- `global 版: 2` `global` 让函数改到了外面的变量。
- `传参返回版: 2` 结果一样,但函数本身不依赖任何外面的东西。

</div>

两种都能用,我几乎只用第二种。原因:用了 `global` 的函数,你光看它的参数和返回值不知道它干了什么,它还偷偷改了文件里别的东西;脚本一长,谁改了 `calls`、什么时候改的,要满篇找。第三部分写 Agent 循环时,状态(对话历史、调用次数、花了多少钱)都是明确地传进去、返回出来,或者装进一个对象里(Day 40 的类),不靠 `global`。

### 改列表不算赋值

这里有个常把人绕晕的地方。规则 2 说的是**赋值**(等号左边是这个名字),可 `history.append(...)` 不是赋值,它是在原地修改一个对象(Day 21)。所以函数里**不用 `global` 也能往外面的列表里加东西**。新建 `part01/scope_mutate.py`:

```python
# agent-zero-lab/part01/scope_mutate.py
history = []
stats = {"calls": 0}


def add_message(role, text):
    history.append({"role": role, "content": text})
    stats["calls"] = stats["calls"] + 1


def reset():
    history = []
    print("  reset 里的 history:", history)


add_message("user", "我的发票在哪?")
add_message("assistant", "请给我订单号")
print("外面的 history 有", len(history), "条,stats:", stats)
reset()
print("reset 之后外面的 history 还有", len(history), "条")
```

<div class="line-notes">

- `history = []` 全局的对话历史。
- `stats = {"calls": 0}` 全局的统计字典。
- `def add_message(role, text):` 追加一条消息。
- `history.append({"role": role, "content": text})` 读到全局的 `history`(规则 1),然后在它身上调用 `append`。等号左边没有 `history`,所以不算赋值,不会另起局部变量。
- `stats["calls"] = stats["calls"] + 1` 这一行有等号,但等号左边是 `stats["calls"]`,改的是字典里的一个键,不是把 `stats` 这个名字指向别的东西。同样不算给 `stats` 赋值。
- `def reset():` 想清空历史。
- `history = []` 这一行等号左边是 `history` 本身,**这才是赋值**:新建了一个局部的 `history`,指向一个新的空列表。外面的那个没被碰。
- `print("  reset 里的 history:", history)` 打印的是局部的空列表。
- `add_message("user", "我的发票在哪?")` 加两条。
- `print("外面的 history 有", len(history), "条,stats:", stats)` 全局的列表和字典都被函数改了。
- `reset()` 想清空。
- `print("reset 之后外面的 history 还有", len(history), "条")` 还是 2 条,`reset` 没起作用。

</div>

```text
$ uv run python part01/scope_mutate.py
外面的 history 有 2 条,stats: {'calls': 2}
  reset 里的 history: []
reset 之后外面的 history 还有 2 条
```

<div class="line-notes">

- `外面的 history 有 2 条,stats: {'calls': 2}` 原地修改穿透了函数边界:`append` 和 `stats["calls"] = ...` 都改到了外面。
- `  reset 里的 history: []` `reset` 里看到的是自己新建的空列表。
- `reset 之后外面的 history 还有 2 条` 外面的没清空。想清空外面那个,写 `history.clear()`(原地修改),或者老老实实传进去返回出来。

</div>

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="作用域示意:最外层是 Python 自带的名字,中间是模块层的全局名字,最里面是每次调用函数时的局部名字;函数里读名字由内往外找,赋值永远落在最里层">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="12" y="14" width="616" height="224" rx="8" fill="var(--paper)" stroke="var(--rule)"/>
<text x="24" y="36" fill="var(--ink-faint)">自带的名字:print、len、sum、max …(Day 28 的 sum = 0 就是把它盖住了)</text>
<rect x="24" y="50" width="592" height="176" rx="8" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="36" y="72" fill="var(--ink)">模块层(全局):rate = 6   calls = 0   history = []   def with_tax …</text>
<rect x="36" y="88" width="568" height="126" rx="8" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="48" y="110" fill="var(--ink)">with_tax(10000) 这一次调用(局部):fen = 10000   taxed = 10600</text>
<text x="48" y="138" fill="var(--ink-soft)">读 rate:这里没有 → 往外找 → 模块层有 6 ✓</text>
<text x="48" y="160" fill="var(--ink-soft)">rate = 0:赋值永远落在这一层,外面的 rate 不动</text>
<text x="48" y="182" fill="var(--ink-soft)">calls += 1:赋值 → calls 变成这一层的 → 读时还没值 → UnboundLocalError</text>
<text x="48" y="204" fill="var(--ink-faint)">调用结束,这一层整个消失(taxed 没了)</text>
</g>
</svg>
<figcaption>名字从里往外找:先看函数自己这一层,没有再看模块层,再看 Python 自带的。赋值只会落在最里层,除非写了 global。</figcaption>
</figure>

### Python 没有块级作用域

JS 里 `let` 声明的变量出了 `for`、`if` 的花括号就没了。Python 的 `for`、`if`、`while` **不开新的作用域**,里面赋的值,后面照样能用。新建 `part01/scope_block.py`:

```python
# agent-zero-lab/part01/scope_block.py
for i in range(3):
    square = i * i
print("循环结束后 i 是", i, ",square 是", square)

if square > 1:
    verdict = "大"
print("if 里面赋的值,外面能用:", verdict)

found = None
for t in ["T201", "T202", "T203"]:
    if t == "T202":
        found = t
        break
print("找到:", found)
```

<div class="line-notes">

- `for i in range(3):` 循环变量 `i`。
- `square = i * i` 循环体里赋值。
- `print("循环结束后 i 是", i, ",square 是", square)` 循环结束后,`i` 和 `square` 都还在,值是最后一轮留下的:2 和 4。JS 里这一行会 `ReferenceError`。
- `if square > 1:` 条件成立。
- `verdict = "大"` 在 `if` 里赋值。
- `print("if 里面赋的值,外面能用:", verdict)` `if` 不开作用域,外面能读。
- `found = None` **推荐的写法**:要在循环里找东西,先在循环外给个初始值。
- `for t in ["T201", "T202", "T203"]:` 遍历。
- `found = t` 命中就记下。
- `break` 停。
- `print("找到:", found)` 不管循环有没有命中,`found` 一定有值。

</div>

```text
$ uv run python part01/scope_block.py
循环结束后 i 是 2 ,square 是 4
if 里面赋的值,外面能用: 大
找到: T202
```

<div class="line-notes">

- `循环结束后 i 是 2 ,square 是 4` 最后一轮 `i` 是 2,`square` 是 4,都留下来了。
- `if 里面赋的值,外面能用: 大` `if` 块里的赋值也留下来了。
- `找到: T202` 带初始值的写法。

</div>

这个脚本能跑,但 basedpyright 对前两段画了四条红线:`"i" is possibly unbound`、`"square" is possibly unbound`、`"verdict" is possibly unbound`。它的意思是:如果 `range(3)` 是空的(循环一次都不跑),或者 `if` 不成立,这些名字就从来没被赋过值,后面一读就是 `NameError`。它说得对。所以「能用」不等于「该这么用」:**循环或 `if` 里赋值、外面要用的变量,先在外面给初始值**,像 `found = None` 那样,红线就没了,逻辑也稳了。

## lambda:一次性的小函数

Day 28 为了给 `sorted` 一个 `key`,专门写了四行的 `def amount_then_id(row)`。这种「只用一次、一行就能写完」的函数,Python 有个短写法 `lambda`,对应 JS 的箭头函数。新建 `part01/lambda_basic.py`:

```python
# agent-zero-lab/part01/lambda_basic.py
rows = [
    (29900, "T201"),
    (46800, "T203"),
    (4900, "T204"),
    (59800, "T206"),
    (29900, "T208"),
]


def amount_then_id(row):
    return (-row[0], row[1])


print(sorted(rows, key=amount_then_id))
print(sorted(rows, key=lambda row: (-row[0], row[1])))

counts = {"计费": 4, "登录": 2, "功能": 2}
print(max(counts, key=lambda c: counts[c]))
print(min(rows, key=lambda row: row[0]))

tickets = [
    {"id": "T901", "amount": "29900", "desc": "重复扣款,请退款"},
    {"id": "T902", "amount": "0", "desc": "验证码收不到"},
    {"id": "T903", "amount": "46800", "desc": "年付多扣了,要求退款"},
]
by_amount = sorted(tickets, key=lambda t: int(t["amount"]), reverse=True)
print([t["id"] for t in by_amount])
print(min(tickets, key=lambda t: len(t["desc"]))["id"])

double = lambda fen: fen * 2
print(double(150), type(double).__name__, double.__name__)
```

<div class="line-notes">

- `rows = [` Day 28 的五行 `(金额, 工单号)`。
- `def amount_then_id(row):` Day 28 的 `def` 写法。
- `return (-row[0], row[1])` 金额取负、工单号原样。
- `print(sorted(rows, key=amount_then_id))` 旧写法。
- `print(sorted(rows, key=lambda row: (-row[0], row[1])))` 新写法。`lambda row: (-row[0], row[1])` 读作「一个收 `row`、交回 `(-row[0], row[1])` 的函数」。`lambda` 后面是参数(不加括号),冒号后面是**一个表达式**,表达式的值就是返回值,不写 `return`。对照 JS:`row => [-row[0], row[1]]`。
- `counts = {"计费": 4, "登录": 2, "功能": 2}` Day 28 日报里的计数字典。
- `print(max(counts, key=lambda c: counts[c]))` `max` 也收 `key`。对字典用 `max` 默认比的是键(字符串比大小没意义),给 `key=lambda c: counts[c]` 就变成「按次数比,交回次数最多的那个键」。这是「找出现最多的类别」最短的写法。
- `print(min(rows, key=lambda row: row[0]))` `min` 同理:按金额找最小的那一行。
- `tickets = [` 三张字典形式的工单(Day 29 的样子,金额是字符串)。
- `by_amount = sorted(tickets, key=lambda t: int(t["amount"]), reverse=True)` 按金额从大到小排字典列表。`key` 里把字符串转成整数再比。
- `print([t["id"] for t in by_amount])` 只看顺序。
- `print(min(tickets, key=lambda t: len(t["desc"]))["id"])` 描述最短的那张。`min(...)` 交回的是整张工单字典,后面直接 `["id"]`。
- `double = lambda fen: fen * 2` 把 lambda 存进变量。**能跑,但不推荐**,下面说原因。
- `print(double(150), type(double).__name__, double.__name__)` 它就是个普通函数,类型是 `function`;但它的 `__name__` 是 `<lambda>`,不是 `double`。

</div>

```text
$ uv run python part01/lambda_basic.py
[(59800, 'T206'), (46800, 'T203'), (29900, 'T201'), (29900, 'T208'), (4900, 'T204')]
[(59800, 'T206'), (46800, 'T203'), (29900, 'T201'), (29900, 'T208'), (4900, 'T204')]
计费
(4900, 'T204')
['T903', 'T901', 'T902']
T902
300 function <lambda>
```

<div class="line-notes">

- `[(59800, 'T206'), (46800, 'T203'), (29900, 'T201'), (29900, 'T208'), (4900, 'T204')]` `def` 版。
- `[(59800, 'T206'), (46800, 'T203'), (29900, 'T201'), (29900, 'T208'), (4900, 'T204')]` `lambda` 版,一模一样。
- `计费` 次数最多的类别。
- `(4900, 'T204')` 金额最小的一行。
- `['T903', 'T901', 'T902']` 468、299、0 元。
- `T902` 「验证码收不到」最短。
- `300 function <lambda>` 存进变量的 lambda 能调用,但名字是 `<lambda>`:报错和日志里都只会显示 `<lambda>`,你不知道是哪一个。

</div>

`double = lambda fen: fen * 2` 这种写法,Ruff 有条规则专门管,叫 E731。我们的默认规则集没开它,手动开一下看看它说什么:

```text
$ uv run ruff check --select E731 --output-format concise part01/lambda_basic.py
part01/lambda_basic.py:31:1: E731 Do not assign a `lambda` expression, use a `def`
Found 1 error.
1 unsafe fix available with `--fix --unsafe-fixes`.
```

<div class="line-notes">

- `part01/lambda_basic.py:31:1: E731 Do not assign a `lambda` expression, use a `def`` 别把 lambda 赋给变量,用 `def`。理由就是上面看到的:给它起了名字却得不到名字的好处。**lambda 只用在「当场传给别人」的地方**:`key=`、下面小项目里的规则表、Day 40 以后的回调。要起名字就写 `def`。

</div>

### lambda 里不能写语句

lambda 的冒号后面只能是一个表达式。新建 `part01/lambda_err.py`,顺手写个 `return`:

```python
# agent-zero-lab/part01/lambda_err.py
is_refund = lambda desc: return "退款" in desc
print(is_refund("要求退款"))
```

```text
$ uv run python part01/lambda_err.py
  File "/Users/你/agent-zero-lab/part01/lambda_err.py", line 2
    is_refund = lambda desc: return "退款" in desc
                             ^^^^^^
SyntaxError: invalid syntax
```

<div class="line-notes">

- `is_refund = lambda desc: return "退款" in desc` `return` 是语句,不是表达式。
- `SyntaxError: invalid syntax` 语法错误,没有 Traceback,一行都没运行(Day 29)。去掉 `return` 就对了:`lambda desc: "退款" in desc`,表达式的值自动就是返回值。同理 `if`/`for`/赋值都不能写进 lambda;要写多行就用 `def`。

</div>

### 循环里造 lambda 的坑

最后一个坑把今天的作用域和 lambda 连起来。新建 `part01/lambda_loop.py`,想造三个手续费函数,分别按 3%、5%、10% 算:

```python
# agent-zero-lab/part01/lambda_loop.py
rates = []
for pct in [3, 5, 10]:
    rates.append(lambda fen: fen * pct // 100)
print([f(10000) for f in rates])

rates_fixed = []
for pct in [3, 5, 10]:
    rates_fixed.append(lambda fen, pct=pct: fen * pct // 100)
print([f(10000) for f in rates_fixed])
```

<div class="line-notes">

- `rates = []` 装三个函数。
- `for pct in [3, 5, 10]:` 三个百分比。
- `rates.append(lambda fen: fen * pct // 100)` 每轮造一个 lambda。它的函数体里用到了 `pct`,但 `pct` 不是它的参数,是外面循环的变量。**lambda 不会在造出来的那一刻把 `pct` 的值抄进去**,它只记住「有个叫 `pct` 的名字,用的时候再去外面找」。
- `print([f(10000) for f in rates])` 循环结束后才调用这三个函数。这时去外面找 `pct`,它已经是最后一轮的 10 了(Python 没有块级作用域,`pct` 还在)。三个函数算出来的全是 10%。
- `rates_fixed = []` 修法。
- `rates_fixed.append(lambda fen, pct=pct: fen * pct // 100)` 给 lambda 加一个默认参数 `pct=pct`:等号右边是当前这一轮的 `pct`,等号左边是 lambda 自己的参数。Day 29 说过**默认值在定义那一刻算一次**,这里正好利用这一点,把当时的 3、5、10 分别钉进三个函数里。
- `print([f(10000) for f in rates_fixed])` 三个不同的结果。

</div>

```text
$ uv run python part01/lambda_loop.py
[1000, 1000, 1000]
[300, 500, 1000]
```

<div class="line-notes">

- `[1000, 1000, 1000]` 三个函数都用了最后的 `pct`,全是 10%。
- `[300, 500, 1000]` 钉住默认值之后,3%、5%、10% 各算各的。

</div>

Ruff 对第一种写法也有提醒,这条规则我们是开着的:

```text
$ uv run ruff check --output-format concise part01/lambda_loop.py
part01/lambda_loop.py:4:36: B023 Function definition does not bind loop variable `pct`
Found 1 error.
```

<div class="line-notes">

- `part01/lambda_loop.py:4:36: B023 Function definition does not bind loop variable `pct`` 规则 B023:函数定义没有绑定循环变量 `pct`。看到它就加 `pct=pct`。这个坑在 JS 里用 `var` 也有,`let` 以后没了;Python 一直有。

</div>

## 小项目:可配置的打分函数

把今天的四样东西用在一个真实的小需求上:客服组长想给工单排个优先级,先处理分高的。规则会变(今天看退款,下周看等待天数),权重也会变(退款 5 分还是 1 分)。所以打分函数不能把规则写死,要做成**规则从外面传进来、权重从外面传进来**。新建 `part01/ticket_score.py`:

```python
# agent-zero-lab/part01/ticket_score.py
tickets = [
    {"id": "T901", "fen": 29900, "plan": "年付", "days": 1, "desc": "重复扣款,请退款"},
    {"id": "T902", "fen": 0, "plan": "月付", "days": 4, "desc": "验证码收不到"},
    {"id": "T903", "fen": 46800, "plan": "年付", "days": 3, "desc": "年付多扣,要退款"},
    {"id": "T904", "fen": 0, "plan": "月付", "days": 0, "desc": "导出PDF乱码"},
    {"id": "T905", "fen": 4900, "plan": "年付", "days": 2, "desc": "想要发票PDF"},
    {"id": "T906", "fen": 59800, "plan": "月付", "days": 5, "desc": "扣了两次,退款"},
    {"id": "T907", "fen": 0, "plan": "月付", "days": 1, "desc": "Forgot password"},
    {"id": "T908", "fen": 29900, "plan": "年付", "days": 0, "desc": "Refund request"},
]


def is_refund(t):
    text = t["desc"].lower()
    return "退款" in text or "refund" in text


RULES = [
    ("refund", is_refund),
    ("big", lambda t: t["fen"] >= 10000),
    ("annual", lambda t: t["plan"] == "年付"),
    ("waiting", lambda t: t["days"] >= 3),
]


def score(ticket, *rules, **weights):
    total = 0
    hits = []
    for name, rule in rules:
        if rule(ticket):
            total += weights.get(name, 1)
            hits.append(name)
    return total, hits


def rank(tickets, *rules, limit=None, **weights):
    scored = []
    for t in tickets:
        total, hits = score(t, *rules, **weights)
        scored.append((total, t["id"], hits))
    scored.sort(key=lambda item: (-item[0], item[1]))
    return scored[:limit]


def show(title, ranking, *, show_hits=True):
    print(title)
    for total, ticket_id, hits in ranking:
        line = f"  {total:2} 分  {ticket_id}"
        if show_hits:
            line += f"  {'+'.join(hits) if hits else '-'}"
        print(line)


print("单条打分:", score(tickets[2], *RULES))
print("单条打分,带权重:", score(tickets[2], *RULES, refund=5, big=3))
print()
show("每条规则 1 分:", rank(tickets, *RULES))
show("退款 5 分、大额 3 分,只看前 3:", rank(tickets, *RULES, limit=3, refund=5, big=3))
show(
    "临时加一条「英文工单」规则:",
    rank(
        tickets, *RULES, ("english", lambda t: t["desc"].isascii()), limit=3, english=4
    ),
    show_hits=False,
)
show("只用两条规则:", rank(tickets, RULES[0], RULES[3], limit=4))
```

<div class="line-notes">

- `tickets = [` 8 张工单,每张有金额(整数分)、套餐、已等待天数、描述。T903 四项都占:退款、468 元、年付、等了 3 天。
- `def is_refund(t):` 一条规则:收整张工单,交回 `True`/`False`。规则复杂到要两行,就用 `def`。
- `text = t["desc"].lower()` 转小写。
- `return "退款" in text or "refund" in text` 布尔表达式直接返回(Day 28 练习 1)。
- `RULES = [` 规则表:每条规则是 `(名字, 函数)` 的元组。名字用来对应权重和显示。
- `("refund", is_refund),` 第一条用 `def` 写的函数,不加括号。
- `("big", lambda t: t["fen"] >= 10000),` 后面三条一行就能写完,用 lambda 当场写在表里,这正是 lambda 该待的地方。
- `("annual", lambda t: t["plan"] == "年付"),` 年付客户。
- `("waiting", lambda t: t["days"] >= 3),` 等了 3 天以上。
- `def score(ticket, *rules, **weights):` 打分:第一个参数是工单,`*rules` 收任意多条规则(元组),`**weights` 收任意多个「规则名=分值」。
- `total = 0` 总分,局部变量。
- `hits = []` 命中的规则名,局部变量,每次调用新建,不会串。
- `for name, rule in rules:` 遍历规则元组,顺手解包成名字和函数。
- `if rule(ticket):` **调用传进来的函数**。`rule` 是个变量,里面装着函数,加括号就调用。第一次调用 `score(tickets[2], *RULES)` 时,四条规则对 T903 全部为真。
- `total += weights.get(name, 1)` 这条规则值几分?去 `weights` 字典里查,没写就默认 1 分(Day 24 的 `get`)。
- `hits.append(name)` 记下命中的规则名。
- `return total, hits` 交回总分和命中列表。
- `def rank(tickets, *rules, limit=None, **weights):` 排名:收工单列表、任意多条规则、一个只能按名字传的 `limit`(它在 `*rules` 后面)、任意多个权重。
- `scored = []` 结果。
- `for t in tickets:` 逐张打分。
- `total, hits = score(t, *rules, **weights)` **透传**:`rank` 收到的规则和权重,原样拆开传给 `score`。`rank` 不需要知道有几条规则、叫什么。
- `scored.append((total, t["id"], hits))` 存成三项元组。
- `scored.sort(key=lambda item: (-item[0], item[1]))` 按总分从高到低,同分按工单号从小到大,Day 28 的取负技巧,用 lambda 写成一行。
- `return scored[:limit]` `limit` 是 `None` 时切片取全部。
- `def show(title, ranking, *, show_hits=True):` 打印:`*` 后面的 `show_hits` 只能按名字传。
- `print(title)` 标题。
- `for total, ticket_id, hits in ranking:` 解包三项。
- `line = f"  {total:2} 分  {ticket_id}"` `:2` 让分数占两格对齐(Day 15)。
- `line += f"  {'+'.join(hits) if hits else '-'}"` 命中的规则名用 `+` 连起来,一个都没命中就显示 `-`。条件表达式(Day 17)。
- `print(line)` 一行一张。
- `print("单条打分:", score(tickets[2], *RULES))` 先对 T903 单独打分,`*RULES` 把规则表展开成四个位置实参。
- `print("单条打分,带权重:", score(tickets[2], *RULES, refund=5, big=3))` 加两个权重:`refund=5, big=3` 进 `weights`,其他规则还是 1 分。5 + 3 + 1 + 1 = 10。
- `show("每条规则 1 分:", rank(tickets, *RULES))` 全部工单,默认权重。
- `show("退款 5 分、大额 3 分,只看前 3:", rank(tickets, *RULES, limit=3, refund=5, big=3))` 带权重、限 3 张。
- `show(` 这个调用被 Ruff 折成了多行。
- `tickets, *RULES, ("english", lambda t: t["desc"].isascii()), limit=3, english=4` 在四条规则后面**临时追加一条**:描述全是 ASCII 字符(英文工单),权重 4 分,不用改 `RULES` 也不用改任何函数。
- `show_hits=False,` 这次不显示命中详情。
- `show("只用两条规则:", rank(tickets, RULES[0], RULES[3], limit=4))` 不展开整张表,手挑两条规则传进去。

</div>

```text
$ uv run python part01/ticket_score.py
单条打分: (4, ['refund', 'big', 'annual', 'waiting'])
单条打分,带权重: (10, ['refund', 'big', 'annual', 'waiting'])

每条规则 1 分:
   4 分  T903  refund+big+annual+waiting
   3 分  T901  refund+big+annual
   3 分  T906  refund+big+waiting
   3 分  T908  refund+big+annual
   1 分  T902  waiting
   1 分  T905  annual
   0 分  T904  -
   0 分  T907  -
退款 5 分、大额 3 分,只看前 3:
  10 分  T903  refund+big+annual+waiting
   9 分  T901  refund+big+annual
   9 分  T906  refund+big+waiting
临时加一条「英文工单」规则:
   7 分  T908
   4 分  T903
   4 分  T907
只用两条规则:
   2 分  T903  refund+waiting
   2 分  T906  refund+waiting
   1 分  T901  refund
   1 分  T902  waiting
```

<div class="line-notes">

- `单条打分: (4, ['refund', 'big', 'annual', 'waiting'])` T903 四条全中,每条 1 分。
- `单条打分,带权重: (10, ['refund', 'big', 'annual', 'waiting'])` 退款 5、大额 3、另两条各 1。
- `   4 分  T903  refund+big+annual+waiting` 默认权重下的第一名。
- `   3 分  T901  refund+big+annual` 三张 3 分的按工单号排:T901、T906、T908。
- `   0 分  T904  -` 一条都没命中。
- `  10 分  T903  refund+big+annual+waiting` 加权后 T903 还是第一。
- `   9 分  T901  refund+big+annual` T901 和 T906 都是 5 + 3 + 1 = 9,同分按工单号。
- `   7 分  T908` 英文规则 4 分加上退款、大额、年付各 1 分,T908 冲到第一。`show_hits=False`,没有详情。
- `   4 分  T907` 「Forgot password」是英文,只靠这一条就拿了 4 分,排进前三。
- `   2 分  T903  refund+waiting` 只用退款和等待两条规则时的结果。

</div>

对照表,看看今天的零件各在哪里:

| 今天的零件 | 在 `ticket_score.py` 里 |
| --- | --- |
| `*rules`(定义时打包) | `score`、`rank` 的参数表 |
| `*RULES`(调用时展开) | `score(tickets[2], *RULES)`、`rank(tickets, *RULES, ...)` |
| `**weights` 和 `**kwargs` 透传 | `rank` 收权重再 `score(t, *rules, **weights)` 原样递下去 |
| 单独的 `*` | `show(..., *, show_hits=True)` |
| 局部变量 | `total`、`hits`、`scored` 每次调用都是新的 |
| lambda | `RULES` 里的三条规则、`sort` 的 `key`、临时追加的英文规则 |
| 把函数当值传 | `("refund", is_refund)` 不加括号,`rule(ticket)` 再调用 |

这个结构以后会反复出现:第三部分给 Agent 注册工具时,工具表就是一张「名字对应函数」的表;第六部分写评测时,评分规则也是这样一条条传进去的。

basedpyright 对 `ticket_score.py` 零报错,Ruff 通过。

## 动手练习

### 练习 1:收任意多个,拼成一句话

写 `part01/ex30_1_star.py`,两个函数:

- `join_money(*fens, sep=" / ", unit="元")`:收任意多个整数分,每个显示成「整数元 + 单位」,用 `sep` 连起来。`join_money(29900, 46800)` 得 `299元 / 468元`;一个都不传得空字符串。
- `describe(**fields)`:收任意多个关键字参数,拼成 `key=value, key=value`。`describe(id="T201", category="计费", fen=29900)` 得 `id=T201, category=计费, fen=29900`;一个都不传得空字符串。

用下面的调用验证(第 2、3 行用 `*paid` 展开,第 6 行用 `**row` 展开):

```python
paid = [29900, 46800, 4900]
print(join_money(29900, 46800))
print(join_money(*paid))
print(join_money(*paid, sep=" + ", unit=" CNY"))
print(join_money())
print(describe(id="T201", category="计费", fen=29900))
row = {"id": "T202", "urgent": True}
print(describe(**row))
print(describe())
```

期望输出:

```text
299元 / 468元
299元 / 468元 / 49元
299 CNY + 468 CNY + 49 CNY

id=T201, category=计费, fen=29900
id=T202, urgent=True

```

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex30_1_star.py
def join_money(*fens, sep=" / ", unit="元"):
    parts = [f"{fen // 100}{unit}" for fen in fens]
    return sep.join(parts)


def describe(**fields):
    parts = [f"{key}={value}" for key, value in fields.items()]
    return ", ".join(parts)


paid = [29900, 46800, 4900]
print(join_money(29900, 46800))
print(join_money(*paid))
print(join_money(*paid, sep=" + ", unit=" CNY"))
print(join_money())
print(describe(id="T201", category="计费", fen=29900))
row = {"id": "T202", "urgent": True}
print(describe(**row))
print(describe())
```

<div class="line-notes">

- `def join_money(*fens, sep=" / ", unit="元"):` `*fens` 收所有位置实参;两个选项排在它后面,只能按名字传。
- `parts = [f"{fen // 100}{unit}" for fen in fens]` 推导式把每个金额变成「299元」这样的字符串。`fens` 是元组,照样能遍历。
- `return sep.join(parts)` 用分隔符连起来(Day 16)。`parts` 为空时 `join` 交回空字符串,不用特殊处理。
- `def describe(**fields):` `**fields` 收所有关键字实参成字典。
- `parts = [f"{key}={value}" for key, value in fields.items()]` 遍历键值对(Day 24)。
- `return ", ".join(parts)` 逗号连起来。
- `print(join_money(29900, 46800))` 两个位置实参。
- `print(join_money(*paid))` 列表展开成三个。
- `print(join_money(*paid, sep=" + ", unit=" CNY"))` 展开后再按名字传两个选项。
- `print(join_money())` 零个,空串,打印出一个空行。
- `print(describe(id="T201", category="计费", fen=29900))` 三个关键字实参。注意 `id` 虽然是 Python 自带函数的名字,当关键字参数名用没问题,因为它只是字典里的一个键。
- `print(describe(**row))` 字典展开。
- `print(describe())` 零个,空行。

</div>

```text
$ uv run python part01/ex30_1_star.py
299元 / 468元
299元 / 468元 / 49元
299 CNY + 468 CNY + 49 CNY

id=T201, category=计费, fen=29900
id=T202, urgent=True

```

<div class="line-notes">

- `299元 / 468元` 默认分隔符和单位。
- `299元 / 468元 / 49元` `*paid` 展开成三项。
- `299 CNY + 468 CNY + 49 CNY` 换了分隔符和单位。
- `id=T201, category=计费, fen=29900` 三对键值,按传入顺序。
- `id=T202, urgent=True` `**row` 展开。

</div>

</details>

### 练习 2:先猜,再跑

不要先运行。下面八行输出分别是什么?先写下答案再核对。重点看第 1 行(传列表不加星号,`args` 里有几项)、第 5 行(`bump` 读了全局的 `count` 但没改它)和第 7 行(循环里造的 lambda)。

```python
# agent-zero-lab/part01/ex30_2_guess.py
def f(*args):
    return len(args), args


def g(a, *rest, **opts):
    return a, rest, opts


count = 0


def bump():
    return count + 1


def tags(t, **kw):
    return sorted(kw)


nums = [1, 2, 3]
print(f(nums))
print(f(*nums))
print(g(1, 2, 3, x=4))
opts = {"y": 5}
print(g(*nums, **opts))
print(bump(), bump(), count)
print(tags("T1", b=1, a=2))
funcs = [lambda: n for n in range(3)]
print([fn() for fn in funcs])
print(sorted(["T10", "T2", "T1"], key=lambda s: int(s[1:])))
```

<details><summary>参考答案</summary>

```text
$ uv run python part01/ex30_2_guess.py
(1, ([1, 2, 3],))
(3, (1, 2, 3))
(1, (2, 3), {'x': 4})
(1, (2, 3), {'y': 5})
1 1 0
['a', 'b']
[2, 2, 2]
['T1', 'T2', 'T10']
```

<div class="line-notes">

- `(1, ([1, 2, 3],))` 第 1 行。`f(nums)` 没加星号,整个列表是**一个**实参,`args` 是只有一项的元组,那一项是列表。
- `(3, (1, 2, 3))` 第 2 行。`f(*nums)` 展开成三个实参。
- `(1, (2, 3), {'x': 4})` 第 3 行。`1` 给 `a`,`2, 3` 进 `rest`,`x=4` 进 `opts`。
- `(1, (2, 3), {'y': 5})` 第 4 行。`*nums` 展开成 `1, 2, 3`,第一个给 `a`,`**opts` 展开成 `y=5`。
- `1 1 0` 第 5 行。`bump` 只是**读**了全局的 `count`(0)再加一交回,没有赋值,所以没有 `UnboundLocalError`,也没改 `count`。两次都是 1,`count` 还是 0。
- `['a', 'b']` 第 6 行。`kw` 是 `{'b': 1, 'a': 2}`,`sorted` 对字典只排键。
- `[2, 2, 2]` 第 7 行。推导式里造的三个 lambda 都在用完循环后才调用,那时 `n` 是最后的 2。Ruff 的 B023 会点名这一行。
- `['T1', 'T2', 'T10']` 第 8 行。`key` 把 `"T10"` 切掉开头的 T 转成整数再比,所以 10 排在 2 后面;直接按字符串排的话 `"T10"` 会在 `"T2"` 前面(Day 21)。

</div>

</details>

### 练习 3:找出五个错

`part01/ex30_3_bug.py` 里藏着今天的五个坑。先照原样跑一遍,每次只修**最先露出来的那一个**,再跑,直到跑完,并且每一行输出你都能解释。

```python
# agent-zero-lab/part01/ex30_3_bug.py
is_big = lambda fen: return fen >= 10000


def total(*fens):
    return sum(fens)


paid = [29900, 4900]
print("合计:", total(paid))

hits = 0


def count_big(fens):
    for fen in fens:
        if is_big(fen):
            hits += 1
    return hits


print("大额:", count_big(paid))


def label(ticket_id, category, note=""):
    return f"{ticket_id} {category} {note}".strip()


row = {"id": "T201", "category": "计费"}
print(label(**row))


def search(tickets, *, category=None):
    return [t for t in tickets if category is None or t["category"] == category]


print(search([{"id": "T1", "category": "计费"}], "计费"))
```

<details><summary>参考答案</summary>

编辑器一开始就画了红线:第 2 行 `Expected expression`、第 18 和 19 行 `"hits" is possibly unbound`、第 37 行 `Expected 1 positional argument`。第二个坑(传列表不加星号)和第四个坑(字典键名)红线看不出来,要跑了才知道。

```text
$ uv run python part01/ex30_3_bug.py
  File "/Users/你/agent-zero-lab/part01/ex30_3_bug.py", line 2
    is_big = lambda fen: return fen >= 10000
                         ^^^^^^
SyntaxError: invalid syntax
```

<div class="line-notes">

- `is_big = lambda fen: return fen >= 10000` 第一个坑:lambda 里写了 `return`。语法错误,整个文件一行都没运行。
- `SyntaxError: invalid syntax` 修:这个函数会被用好几次,按 E731 的建议干脆改成 `def is_big(fen): return fen >= 10000`(两行)。

</div>

```text
$ uv run python part01/ex30_3_bug.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex30_3_bug.py", line 11, in <module>
    print("合计:", total(paid))
                   ^^^^^^^^^^^
  File "/Users/你/agent-zero-lab/part01/ex30_3_bug.py", line 7, in total
    return sum(fens)
           ^^^^^^^^^
TypeError: unsupported operand type(s) for +: 'int' and 'list'
```

<div class="line-notes">

- `print("合计:", total(paid))` 第二个坑:`total` 收 `*fens`,这里传了整个列表不加星号。
- `TypeError: unsupported operand type(s) for +: 'int' and 'list'` `fens` 是 `([29900, 4900],)`,`sum` 拿 0 去加一个列表。修:`total(*paid)`。

</div>

```text
$ uv run python part01/ex30_3_bug.py
合计: 34800
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex30_3_bug.py", line 23, in <module>
    print("大额:", count_big(paid))
                   ^^^^^^^^^^^^^^^
  File "/Users/你/agent-zero-lab/part01/ex30_3_bug.py", line 19, in count_big
    hits += 1
    ^^^^
UnboundLocalError: cannot access local variable 'hits' where it is not associated with a value
```

<div class="line-notes">

- `合计: 34800` 第二个坑修好了。
- `hits += 1` 第三个坑:函数里给 `hits` 赋值,它就成了局部变量,读的时候还没值。
- `UnboundLocalError: cannot access local variable 'hits' where it is not associated with a value` 修:不要用全局计数器,把 `hits = 0` 挪进函数体开头,函数自己算自己的,最后 `return hits`。

</div>

```text
$ uv run python part01/ex30_3_bug.py
合计: 34800
大额: 1
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex30_3_bug.py", line 30, in <module>
    print(label(**row))
          ^^^^^^^^^^^^
TypeError: label() got an unexpected keyword argument 'id'
```

<div class="line-notes">

- `大额: 1` 第三个坑修好:29900 一张大额。
- `print(label(**row))` 第四个坑:字典的键叫 `id`,函数的参数叫 `ticket_id`。
- `TypeError: label() got an unexpected keyword argument 'id'` 修:把字典的键改成 `ticket_id`(或者改函数参数名,两边对上就行)。

</div>

```text
$ uv run python part01/ex30_3_bug.py
合计: 34800
大额: 1
T201 计费
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex30_3_bug.py", line 37, in <module>
    print(search([{"id": "T1", "category": "计费"}], "计费"))
          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
TypeError: search() takes 1 positional argument but 2 were given
```

<div class="line-notes">

- `T201 计费` 第四个坑修好。
- `print(search([{"id": "T1", "category": "计费"}], "计费"))` 第五个坑:`category` 在 `*` 后面,只能按名字传。
- `TypeError: search() takes 1 positional argument but 2 were given` 修:`category="计费"`。

</div>

五个都改好的 `part01/ex30_3_fixed.py`:

```python
# agent-zero-lab/part01/ex30_3_fixed.py
def is_big(fen):
    return fen >= 10000


def total(*fens):
    return sum(fens)


paid = [29900, 4900]
print("合计:", total(*paid))


def count_big(fens):
    hits = 0
    for fen in fens:
        if is_big(fen):
            hits += 1
    return hits


print("大额:", count_big(paid))


def label(ticket_id, category, note=""):
    return f"{ticket_id} {category} {note}".strip()


row = {"ticket_id": "T201", "category": "计费"}
print(label(**row))


def search(tickets, *, category=None):
    return [t for t in tickets if category is None or t["category"] == category]


print(search([{"id": "T1", "category": "计费"}], category="计费"))
```

<div class="line-notes">

- `def is_big(fen):` lambda 换成 `def`,名字也正常了。
- `return fen >= 10000` 布尔表达式直接返回。
- `print("合计:", total(*paid))` 加了星号。
- `hits = 0` 计数器搬进函数,局部变量。
- `return hits` 交回。
- `row = {"ticket_id": "T201", "category": "计费"}` 键名和参数名对上。
- `print(search([{"id": "T1", "category": "计费"}], category="计费"))` 按名字传。

</div>

```text
$ uv run python part01/ex30_3_fixed.py
合计: 34800
大额: 1
T201 计费
[{'id': 'T1', 'category': '计费'}]
```

<div class="line-notes">

- `合计: 34800` 299 + 49 元。
- `大额: 1` 一张超过 100 元。
- `T201 计费` 没有备注,`strip` 去掉了末尾的空格。
- `[{'id': 'T1', 'category': '计费'}]` 查到一张。

</div>

</details>

### 练习 4:用 lambda 表做自动回复

客服系统想按类别自动回一句话。写 `part01/ex30_4_handlers.py`:

- 一张 `HANDLERS` 字典,键是类别,值是一个收整张工单、交回回复文本的 lambda:计费类回「已核对 N 元的扣款记录,3 个工作日内处理」(N 从工单金额算),登录类回一句固定话,功能类回「已记录「描述」,转给产品组排期」;
- `reply(t, handlers=HANDLERS, default=lambda t: "已收到,客服稍后联系你")`:按类别从表里取函数,取不到用 `default`,交回「工单号:回复」;
- 验证:对 5 张工单(含一张「其他」类)各回一句;再传一张只有计费的 `polite` 表和一个自定义 `default`,看结果怎么变。

期望输出:

```text
T901:已核对 299 元的扣款记录,3 个工作日内处理
T902:请先检查短信拦截,仍收不到请回复手机号后四位
T904:已记录「导出PDF乱码」,转给产品组排期
T906:已核对 598 元的扣款记录,3 个工作日内处理
T909:已收到,客服稍后联系你

T901:抱歉给您添麻烦了,299 元已安排退回
T902:登录 类暂无模板
```

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex30_4_handlers.py
tickets = [
    {"id": "T901", "category": "计费", "fen": 29900, "desc": "重复扣款,请退款"},
    {"id": "T902", "category": "登录", "fen": 0, "desc": "验证码收不到"},
    {"id": "T904", "category": "功能", "fen": 0, "desc": "导出PDF乱码"},
    {"id": "T906", "category": "计费", "fen": 59800, "desc": "扣了两次,申请退款"},
    {"id": "T909", "category": "其他", "fen": 0, "desc": "随便问问"},
]

HANDLERS = {
    "计费": lambda t: f"已核对 {t['fen'] // 100} 元的扣款记录,3 个工作日内处理",
    "登录": lambda t: "请先检查短信拦截,仍收不到请回复手机号后四位",
    "功能": lambda t: f"已记录「{t['desc']}」,转给产品组排期",
}


def reply(t, handlers=HANDLERS, default=lambda t: "已收到,客服稍后联系你"):
    handler = handlers.get(t["category"], default)
    return f"{t['id']}:{handler(t)}"


for t in tickets:
    print(reply(t))

print()
polite = {"计费": lambda t: f"抱歉给您添麻烦了,{t['fen'] // 100} 元已安排退回"}
print(reply(tickets[0], handlers=polite))
print(
    reply(tickets[1], handlers=polite, default=lambda t: f"{t['category']} 类暂无模板")
)
```

<div class="line-notes">

- `tickets = [` 5 张工单,T909 的类别「其他」不在表里。
- `HANDLERS = {` 「类别对应函数」的表。这种表在程序设计里叫**分发表**(dispatch table),用来代替一长串 `if category == ...`。
- `"计费": lambda t: f"已核对 {t['fen'] // 100} 元的扣款记录,3 个工作日内处理",` 一行的函数,从工单里取金额。f-string 外面双引号,里面取键用单引号。
- `"登录": lambda t: "请先检查短信拦截,仍收不到请回复手机号后四位",` 这个 lambda 没用到 `t`,但参数还是要收,因为 `reply` 调用时一定会传一个。
- `"功能": lambda t: f"已记录「{t['desc']}」,转给产品组排期",` 取描述。
- `def reply(t, handlers=HANDLERS, default=lambda t: "已收到,客服稍后联系你"):` 表和兜底函数都是参数,有默认值。默认值是字典和 lambda,但函数里**只读不改**它们,所以 Day 29 的可变默认值陷阱在这里不会发作(Ruff 的 B006 只盯 `[]`、`{}` 这种字面量,`HANDLERS` 是个名字,它不报;自己心里要清楚不能往里 `append`)。
- `handler = handlers.get(t["category"], default)` 按类别取函数,取不到就用 `default`。`get` 的第二个参数又是一个函数值。
- `return f"{t['id']}:{handler(t)}"` 调用取到的函数。
- `for t in tickets:` 五张各回一句。
- `print(reply(t))` 默认表、默认兜底。
- `polite = {"计费": lambda t: f"抱歉给您添麻烦了,{t['fen'] // 100} 元已安排退回"}` 另一张表,只有计费。
- `print(reply(tickets[0], handlers=polite))` T901 用新表。
- `reply(tickets[1], handlers=polite, default=lambda t: f"{t['category']} 类暂无模板")` T902 是登录类,新表里没有,走自定义的兜底。

</div>

```text
$ uv run python part01/ex30_4_handlers.py
T901:已核对 299 元的扣款记录,3 个工作日内处理
T902:请先检查短信拦截,仍收不到请回复手机号后四位
T904:已记录「导出PDF乱码」,转给产品组排期
T906:已核对 598 元的扣款记录,3 个工作日内处理
T909:已收到,客服稍后联系你

T901:抱歉给您添麻烦了,299 元已安排退回
T902:登录 类暂无模板
```

<div class="line-notes">

- `T901:已核对 299 元的扣款记录,3 个工作日内处理` 计费模板,金额 29900 分换成 299 元。
- `T909:已收到,客服稍后联系你` 「其他」类走默认兜底。
- `T901:抱歉给您添麻烦了,299 元已安排退回` 换了表,同一张工单换了说法。
- `T902:登录 类暂无模板` 新表里没有登录,走自定义兜底。

</div>

</details>

**验收标准:** `ticket_score.py` 的四段排名都能跑出来,并且你能不看文章写出 `score` 和 `rank`,说清 `*rules`、`**weights` 在两个函数之间是怎么透传的;练习 2 先自己写出八行答案再核对;练习 3 能说清第三个坑为什么报的是 `UnboundLocalError` 而不是 `NameError`;练习 4 能换一张表不改 `reply`。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| `*args` | 定义时参数名前一个星号:把多出来的位置实参打包成元组。`args` 只是习惯叫法 |
| `**kwargs` | 定义时参数名前两个星号:把函数没声明过的关键字实参打包成字典 |
| 调用时的 `*` / `**` | 把列表(元组、集合)拆成一个个位置实参;把字典拆成一个个关键字实参。和定义时方向相反 |
| 透传 | `def f(*args, **kwargs): return g(*args, **kwargs)`,收到什么原样递给下一层 |
| 仅限关键字参数 | 写在单独的 `*` 后面的参数,只能用「名字=值」传 |
| 作用域(scope) | 一个名字在哪一段代码里有效 |
| 全局变量(global) | 在模块最外层赋值的名字,整个文件都能读 |
| 局部变量(local) | 在函数里赋值的名字(含参数),函数一返回就没了 |
| `global` 语句 | 在函数里声明「这个名字指的是全局那个」,这样才能在函数里给它赋值 |
| `UnboundLocalError` | 函数里给某个名字赋过值(所以它是局部的),却在赋值前读它 |
| 块级作用域 | JS 的 `let` 让变量只在 `{}` 里有效;Python 没有这个,`for`/`if` 里赋的值外面还在 |
| `lambda` | 一行的匿名函数:`lambda 参数: 表达式`,表达式的值就是返回值,不写 `return` |
| 分发表(dispatch table) | 「键对应函数」的字典,用 `d.get(key)(x)` 代替一串 `if` |
| Ruff E731 / B023 | 别把 lambda 赋给变量;循环里造的函数没绑定循环变量 |
| `inspect.signature(f)` | 打出函数的参数表,看 `print` 为什么能收任意多个参数 |

## 常见误区

**传列表给 `*args` 忘了加星号。** `total(paid)` 让 `args` 变成 `([...],)`,一项是整个列表。报错往往出在函数体里(`'int' and 'list'`),Traceback 要看最下面那一段。

**定义时的 `*` 和调用时的 `*` 搞混。** 定义时是「打包」,调用时是「拆开」。同一个符号,看它出现在 `def` 的括号里还是调用的括号里。

**`**row` 的键名和参数名不一致。** 数据里的 `id`、`notes`,函数里的 `ticket_id`、`note`,差一个字母就是 `unexpected keyword argument`。从接口、文件读来的字典喂给函数前,先对一遍键名。

**以为函数里赋值会改到外面的变量。** Python 没有 `let`,函数里一赋值就是新的局部变量。想改外面的,要么 `return` 回去再接住,要么原地修改(`append`、改字典的键)。

**读了外面的变量又想 `+= 1`。** `calls += 1` 是赋值,`calls` 整个变成局部的,于是 `UnboundLocalError`。改法不是加 `global`,是把计数器放进函数或者传进去返回出来。

**到处用 `global`。** 能跑,但函数的行为不再只由参数决定,出了问题要满篇找谁改了它。整个课程里你几乎看不到 `global`。

**以为循环变量出了循环就没了。** Python 的 `for`、`if` 不开作用域。但 basedpyright 会提醒「possibly unbound」,因为循环可能一次都不跑。在循环外先给初始值。

**在 lambda 里写 `return` 或 `if` 语句。** lambda 的冒号后面只能是一个表达式。要分支用条件表达式 `a if c else b`,要多行就用 `def`。

**把 lambda 赋给变量当函数用。** `f = lambda x: ...` 能跑,但名字是 `<lambda>`,报错时看不出是哪个,Ruff E731 也反对。要名字就 `def`。

**循环里造 lambda,用的时候全是最后一轮的值。** lambda 用到外面的变量时,是调用那一刻才去找。要钉住当时的值,写成 `lambda x, n=n: ...`。Ruff B023 会提醒。

## 学习资料

### 文档与文章

- [Python 教程 · 任意实参列表](https://docs.python.org/zh-cn/3.12/tutorial/controlflow.html#arbitrary-argument-lists):中文,官方教程里 `*args` 的说法,后面紧跟[解包实参列表](https://docs.python.org/zh-cn/3.12/tutorial/controlflow.html#unpacking-argument-lists)(调用时的 `*` 和 `**`)和 [Lambda 表达式](https://docs.python.org/zh-cn/3.12/tutorial/controlflow.html#lambda-expressions),三节加起来不到两页。
- [Python 教程 · 特殊参数](https://docs.python.org/zh-cn/3.12/tutorial/controlflow.html#special-parameters):中文,那张 `def f(pos1, pos2, /, pos_or_kwd, *, kwd1, kwd2)` 的图,今天只用到了 `*` 右边的部分,`/` 以后再说。
- [Python FAQ · 局部变量和全局变量的规则](https://docs.python.org/zh-cn/3.12/faq/programming.html#what-are-the-rules-for-local-and-global-variables-in-python):中文,官方用两段话解释为什么「赋值就变局部」以及 `UnboundLocalError`。同一页还有[为什么循环里定义的 lambda 返回同样的值](https://docs.python.org/zh-cn/3.12/faq/programming.html#why-do-lambdas-defined-in-a-loop-with-different-values-all-return-the-same-result),就是今天 `lambda_loop.py` 的事。
- [Python 参考 · 命名与绑定](https://docs.python.org/zh-cn/3.12/reference/executionmodel.html#naming-and-binding):中文,语言参考里作用域的严格说法,「如果名称在代码块中被绑定,它就是该代码块的局部变量」这一句就是规则 2。
- [MDN · 剩余参数](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Functions/rest_parameters)、[展开语法](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Operators/Spread_syntax)、[箭头函数](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Functions/Arrow_functions):中文,JS 一侧的三个对照物。
- [Ruff · lambda-assignment (E731)](https://docs.astral.sh/ruff/rules/lambda-assignment/) 和 [function-uses-loop-variable (B023)](https://docs.astral.sh/ruff/rules/function-uses-loop-variable/):英文,今天两条规则的说明和修法。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Tk4y1F72g&autoplay=0&high_quality=1" title="python函数中的*args和**kwargs有什么用" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IT阿杰 · python函数中的*args和**kwargs有什么用 · 3 分半,2023 年,最短的一版,看完再回头读今天前两节。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Dy421e77b&autoplay=0&high_quality=1" title="7分钟搞懂变量作用域这个概念#程序员 #编程 #python" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员陈雷雷 · 7分钟搞懂变量作用域这个概念 · 7 分钟,2024 年,局部、全局、`global` 讲得很直白,对应「作用域」一节。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/QVdf0LgmICw" title="Python Tutorial: Variable Scope - Understanding the LEGB rule and global/nonlocal statements" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Variable Scope - Understanding the LEGB rule · 英文,20 分钟,「由内往外找名字」的完整版(他叫 LEGB,比今天多一层「嵌套函数」,以后用得到),`global` 的演示和今天一样。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/FFpDsC6B2qw" title="Python *args vs **kwargs - Visually Explained" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Visually Explained · Python *args vs **kwargs · 英文,动画演示打包和拆开,对应今天第一张图。</figcaption>
</figure>

### 书籍

- Eric Matthes《Python Crash Course》第 3 版,No Starch Press,2023(中译《Python编程:从入门到实践》第 3 版,人民邮电出版社)。第 8 章「Functions」里的「Passing an Arbitrary Number of Arguments」,就是今天的 `*args` 和 `**kwargs`。
- Luciano Ramalho《Fluent Python》第 2 版,O'Reilly,2022。第 7 章「Functions as First-Class Objects」:函数是一个值、可以当参数传、lambda 的限制。现在只读前几节。

### 开源项目与代码

- [Asabeneh/30-Days-Of-Python · Day 11 Functions](https://github.com/Asabeneh/30-Days-Of-Python/tree/master/11_Day_Functions):英文,Day 28 留下的后半部分,`*args`、`**kwargs`、lambda 和把函数当参数传的练习,今天可以做了。

## 自测

1. `def f(*args)`,调用 `f([1, 2])` 和 `f(*[1, 2])`,`args` 分别是什么?

<details><summary>答案</summary>

`([1, 2],)` 和 `(1, 2)`。前者整个列表是一个实参;后者先展开成两个实参再打包。

</details>

2. 下面的函数能不能按位置传 `limit`?为什么?

```python
def top(items, *, limit=3): ...
```

<details><summary>答案</summary>

不能。单独的 `*` 后面的参数只能按名字传,`top(items, 5)` 会报 `takes 1 positional argument but 2 were given`,要写 `top(items, limit=5)`。

</details>

3. 下面的代码会怎样?为什么?

```python
total = 0
def add(x):
    total += x
add(5)
```

<details><summary>答案</summary>

`UnboundLocalError: cannot access local variable 'total' where it is not associated with a value`。函数里有 `total += x`(赋值),`total` 就被当成局部变量,读的时候还没值。修法是让函数收旧值、交回新值,或者改成原地修改一个列表/字典;实在要改全局才用 `global total`。

</details>

4. `history = []` 在模块层,函数里写 `history.append(x)` 和 `history = history + [x]`,哪个会改到外面的列表?

<details><summary>答案</summary>

`append` 会。它是原地修改,不是赋值,不需要 `global`。`history = history + [x]` 是赋值,`history` 变成局部变量,而且右边读它时会直接 `UnboundLocalError`。

</details>

5. `sorted(d, key=lambda k: d[k])` 对字典 `d` 做了什么?`max(d, key=lambda k: d[k])` 呢?

<details><summary>答案</summary>

前者把字典的键按对应的值从小到大排成列表;后者交回值最大的那个键。遍历字典默认得到的是键,`key=` 告诉它拿什么来比。

</details>

6. **面试题**:`def chat(messages, **kw): return client.create(messages=messages, **kw)` 这种写法叫什么?好处和坏处各是什么?

<details><summary>答案</summary>

叫透传(或者「转发参数」)。好处:外层函数不用知道底层有哪些选项,底层新增了 `temperature`、`tools` 之类的参数,外层一行不改就能用。坏处:外层的参数表上看不出到底能传什么,拼错名字要到底层才报 `unexpected keyword argument`,编辑器也给不了提示;所以常见做法是把最常用的几个选项显式写出来,剩下的再 `**kw`。

</details>

## 明天预告

Day 31 · 小项目:纯 Python 工单分类器。这周学完了函数,Python 的「编程地基」第一段已经齐了:变量、数字、字符串、`if`、循环、列表、元组、字典、集合、函数。明天不学新东西,用这些把 Day 20 的日报升级成一个真正的分类器:20 张工单、规则写成一张可配置的关键词表、按命中次数计分而不是先到先得、拿不准的交给人工,再算一次准确率和混淆矩阵,看看规则到底错在哪。今天的 `max(..., key=lambda ...)`、`*`、`**` 都会用上。
