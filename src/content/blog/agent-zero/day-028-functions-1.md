---
title: 'Day 28 · 函数(一):def、参数和返回值'
description: '函数就是给一段代码起个名字。今天学会用 def 定义、用括号送材料进去(参数)、用 return 把结果交出来,认得参数个数不对的报错和忘写 return 得到 None 的坑,并把 Day 20 的 90 行日报拆成四个小函数。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'agent-zero']
series: 'agent-zero'
day: 28
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 27](/blog/agent-zero/day-027-week04-review/) 是第 4 周的复习:一张「什么时候用哪种容器」的地图,默写了清洗计数排名、集合对比两批数据、摸清嵌套 JSON 三段代码,做了只用本周知识的工单看板,还把这周撞过的报错整理成表。

回头看这几周写的脚本,有一件事你可能已经烦了:**同一段判断被抄了好几遍。** Day 17 的分类规则那条长长的 `if`/`elif` 链,在 Day 18 的 `mini_classify.py`、Day 20 的 `daily_report.py` 里各抄了一份;Day 21 求中位数的 `if`/`else` 我在同一个脚本里写了两遍;「抠出金额」那七八行的 `while` 也跟着搬来搬去。抄代码的坏处是,规则要改的时候你得记得改每一份,漏一份就出一个悄悄的错。

今天学的 `def` 就是治这个的:给一段代码起个名字,以后叫它的名字就行。

## 今天要解决的问题

学完今天,你应该能:

1. 用 `def` 写出带参数的函数,说清「定义」和「调用」是两件事:定义时函数体不会运行,调用时才跑;对照 JS 说出写法上的差别(冒号加缩进、没有花括号)。
2. 说清 `print` 和 `return` 的区别:`print` 只是在屏幕上显示,`return` 才把结果交回给调用的地方;函数没写 `return` 就得到 `None`,并认得由此引起的 `TypeError: can only concatenate str (not "NoneType") to str`。
3. 认得参数个数不对的两个报错 `missing 1 required positional argument` 和 `takes 2 positional arguments but 3 were given`;知道 `return a, b` 返回的是元组(Day 22);知道 `def` 是一条要执行到才生效的语句,先调用后定义会 `NameError`。
4. 写出 `part01/ticket_funcs.py`:把 Day 20 的 `daily_report.py` 拆成 `clean`、`parse`、`classify`、`extract_fen` 四个函数,主循环缩成十几行,汇总数字和原来一模一样;顺手用 `sorted(..., key=函数名)` 收回 Day 21 留下的「并列时谁排前面」。

预计用时:3 小时。写函数和参数 40 分钟,`return` 和报错 50 分钟,多个返回值和 `def` 的执行时机 30 分钟,`key=` 15 分钟,小项目和练习 45 分钟。

前置:[Day 14](/blog/agent-zero/day-014-bool-none/)(`None`)、[Day 17](/blog/agent-zero/day-017-if-else/)(`if` 链)、[Day 20](/blog/agent-zero/day-020-week03-review/)(`daily_report.py`)、[Day 21](/blog/agent-zero/day-021-lists/)(`sorted`、中位数)、[Day 22](/blog/agent-zero/day-022-tuples-unpack/)(元组、解包)。今天不调任何 API,花费 0 元。

学法提示:先对照文章逐行敲一遍(代码自己敲,不复制粘贴)并跑通;第二天合上文章,把 `ticket_funcs.py` 里的四个函数默写出来,每写一个先在注释里写一句话「它收什么、交回什么」;然后做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先说清楚我是在哪跑的

输出是我 2026-10-23 在 2019 款 Intel MacBook Pro(macOS 14、zsh)上用演示家目录真跑的,家目录显示成 `/Users/你`,`~/agent-zero-lab` 接着 Day 27 的状态,`uv run python` 是 3.12.13,Ruff 是 0.17.2,basedpyright 是 standard 档。今天的脚本都放在 `part01/`,在仓库根目录用 `uv run python part01/文件名.py` 运行。JS 的对照用 `node -e` 跑,Node 你本来就有。

你其实已经见过 `def` 了:Day 10 的 `main.py` 里有 `def main():`,Day 22 里抄过三行 `def min_max(values)`,当时都说「Day 28 细讲」。今天细讲。

## 先看 JS 的函数

先在 Node 里做一遍今天要学的几个动作,看哪里和 Python 会不一样:

```text
$ node -e '
function withTax(fen, ratePercent) {
  return fen + Math.floor((fen * ratePercent) / 100);
}
console.log(withTax(29900, 6));
console.log(withTax(29900));
console.log(withTax(29900, 6, 1));
function noReturn(n) {
  n * 2;
}
console.log(noReturn(21));
console.log(double(21));
function double(n) {
  return n * 2;
}
'
31694
NaN
31694
undefined
42
```

<div class="line-notes">

- `function withTax(fen, ratePercent) {` JS 的函数:`function` 开头,参数放括号,函数体放花括号。
- `return fen + Math.floor((fen * ratePercent) / 100);` `return` 把结果交出去。`29900 + floor(29900 * 6 / 100)` 是 31694。
- `console.log(withTax(29900, 6));` 参数个数对,得到 31694。
- `console.log(withTax(29900));` **少传一个参数,JS 不报错**:`ratePercent` 是 `undefined`,算出 `NaN`。
- `console.log(withTax(29900, 6, 1));` **多传一个,JS 也不报错**,多的那个悄悄被忽略,还是 31694。
- `function noReturn(n) {` 一个没有 `return` 的函数。
- `console.log(noReturn(21));` 没写 `return`,得到 `undefined`。
- `console.log(double(21));` 在 `double` 还没写出来的地方就调用它。
- `function double(n) {` JS 的 `function` 声明会被「提升」,写在后面也能提前用,所以这里是 42。

</div>

三个差别先记在心里,今天后面会一个一个对上:Python 少传或多传参数都会**报错**;没有 `return` 得到 `None`(对应 JS 的 `undefined`);`def` 不会提升,必须先执行到 `def` 才能用那个名字。

## 第一个函数:def 和调用

新建 `part01/fn_hello.py`:

```python
# agent-zero-lab/part01/fn_hello.py
def greet():
    print("你好,这里是云簿客服")
    print("请问有什么可以帮你?")


print("函数定义完了,但还没有人叫它")
greet()
print("---")
greet()
```

<div class="line-notes">

- `def greet():` `def` 是「定义函数」。`greet` 是你给这段代码起的名字,括号是空的(这个函数不需要任何材料),冒号结尾。
- `print("你好,这里是云簿客服")` 函数体缩进 4 格,和 `if`、`for` 一样,缩进的这几行属于函数。
- `print("请问有什么可以帮你?")` 函数体的第二行。
- `print("函数定义完了,但还没有人叫它")` 缩进回到最左边,函数定义结束。注意:`def` 那几行**只是把名字和这段代码绑在一起,并没有运行它**。
- `greet()` 名字后面加括号叫「调用」,这时函数体才运行。
- `print("---")` 分隔线。
- `greet()` 第二次调用,函数体又跑一遍。

</div>

```text
$ uv run python part01/fn_hello.py
函数定义完了,但还没有人叫它
你好,这里是云簿客服
请问有什么可以帮你?
---
你好,这里是云簿客服
请问有什么可以帮你?
```

<div class="line-notes">

- `函数定义完了,但还没有人叫它` 第一行就是这句。如果 `def` 就会执行函数体,这里应该先看到「你好」。
- `你好,这里是云簿客服` 第一次 `greet()`。
- `请问有什么可以帮你?` 函数体第二行。
- `---` 分隔线。
- `你好,这里是云簿客服` 第二次调用,同样的两行又出现一次,不用再抄代码。

</div>

整个过程可以画成一条线:程序从上往下走,碰到调用就「跳进」函数体,跑完再「跳回」调用的地方,接着往下:

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="调用函数的执行顺序:主程序从上往下跑,第一次碰到 greet() 跳进函数体运行两行 print,然后跳回主程序,继续往下,第二次碰到 greet() 又跳进去再跳回">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="12" y="14" width="200" height="200" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="24" y="36" fill="var(--ink)">主程序(从上往下)</text>
<text x="24" y="62" fill="var(--ink-faint)">def greet(): ...</text>
<text x="24" y="86" fill="var(--ink-soft)">print("定义完了")</text>
<rect x="20" y="102" width="130" height="22" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="28" y="118" fill="var(--ink)">greet()  第 1 次</text>
<text x="24" y="150" fill="var(--ink-soft)">print("---")</text>
<rect x="20" y="164" width="130" height="22" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="28" y="180" fill="var(--ink)">greet()  第 2 次</text>
<rect x="340" y="14" width="288" height="200" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="352" y="36" fill="var(--ink)">函数体 greet</text>
<text x="352" y="70" fill="var(--ink-soft)">print("你好,这里是云簿客服")</text>
<text x="352" y="94" fill="var(--ink-soft)">print("请问有什么可以帮你?")</text>
<text x="352" y="130" fill="var(--ink-faint)">跑完最后一行,</text>
<text x="352" y="148" fill="var(--ink-faint)">回到刚才调用的那一行的后面</text>
<line x1="150" y1="113" x2="340" y2="76" stroke="var(--compute)" stroke-width="1.5"/>
<text x="204" y="86" fill="var(--compute)">跳进去</text>
<line x1="340" y1="102" x2="160" y2="140" stroke="var(--mem)" stroke-width="1.5" stroke-dasharray="4 3"/>
<text x="206" y="138" fill="var(--mem)">跳回来</text>
</g>
</svg>
<figcaption>调用一次函数,就是「跳进函数体、跑完、跳回调用处」。琥珀色是调用,蓝色是函数体。</figcaption>
</figure>

## 参数:把材料从括号送进去

没有参数的函数只能每次做同一件事。真正有用的函数要能「收材料」:括号里写的名字叫**参数**,调用时括号里放的具体值叫**实参**(参数是占位的名字,实参是真正放进去的东西,两个词常常混着叫,没关系)。新建 `part01/fn_params.py`:

```python
# agent-zero-lab/part01/fn_params.py
def yuan_text(fen):
    return f"{fen / 100:,.2f} 元"


def with_tax(fen, rate_percent):
    return fen + fen * rate_percent // 100


print(yuan_text(29900))
print(yuan_text(4900))

amount = 59800
print(yuan_text(amount))

fen = 100
print(yuan_text(1234567))
print("外面的 fen 还是:", fen)

taxed = with_tax(29900, 6)
print("含税:", taxed, "分,也就是", yuan_text(taxed))
print(with_tax(rate_percent=10, fen=1000))
```

<div class="line-notes">

- `def yuan_text(fen):` 一个收一个材料的函数。`fen` 是参数名,函数体里就把它当一个普通变量用。
- `return f"{fen / 100:,.2f} 元"` 把「分」换成带千分位、两位小数的「元」字符串交出去(Day 15 的 f-string)。`return` 下面细讲,这里先当成「把这个结果送出函数」。
- `def with_tax(fen, rate_percent):` 两个参数,用逗号隔开。调用时按顺序一一对应。
- `return fen + fen * rate_percent // 100` 含税价:原价加上「原价乘税率百分比再整除 100」。金额用整数分,没有浮点误差(Day 12)。
- `print(yuan_text(29900))` 调用:`29900` 是实参,进函数后 `fen` 就是 29900,`29900 / 100` 是 299.0,格式化成 `299.00 元`。
- `print(yuan_text(4900))` 同一个函数换个值再用。
- `amount = 59800` 外面的变量。
- `print(yuan_text(amount))` 实参可以是变量,取的是它当时的值 59800。函数里的 `fen` 和外面的 `amount` 是两个名字。
- `fen = 100` 在外面也起了一个叫 `fen` 的变量。
- `print(yuan_text(1234567))` 函数里的 `fen` 这次是 1234567,和外面这个值是 100 的 `fen` 互不相干。
- `print("外面的 fen 还是:", fen)` 外面的 `fen` 没被动过,还是 100。函数里的名字出了函数就没了,这条规则 Day 30 正式讲。
- `taxed = with_tax(29900, 6)` 两个实参按顺序进去:`fen` 是 29900,`rate_percent` 是 6。`29900 * 6 // 100` 是 1794,加上 29900 得 31694。函数的结果可以直接存进变量,这是下一节的主角。
- `print("含税:", taxed, "分,也就是", yuan_text(taxed))` 再把 31694 交给 `yuan_text`,得到 `316.94 元`。一个函数的结果可以喂给另一个函数。
- `print(with_tax(rate_percent=10, fen=1000))` 也可以写成「名字=值」,这样顺序就不重要了(Day 29 细讲)。`1000 + 1000 * 10 // 100` 是 1100。

</div>

```text
$ uv run python part01/fn_params.py
299.00 元
49.00 元
598.00 元
12,345.67 元
外面的 fen 还是: 100
含税: 31694 分,也就是 316.94 元
1100
```

<div class="line-notes">

- `299.00 元` 29900 分。
- `49.00 元` 4900 分。
- `598.00 元` 变量 `amount` 的值 59800。
- `12,345.67 元` 1234567 分,有千分位。
- `外面的 fen 还是: 100` 函数里怎么用 `fen` 都没影响外面。
- `含税: 31694 分,也就是 316.94 元` 两步合起来。
- `1100` 按名字传参数的结果。

</div>

## return:把结果交出来

很多人第一次写函数,会把「在屏幕上显示」和「交出结果」混成一件事。下面这个脚本把两者放在一起对比,新建 `part01/fn_return.py`:

```python
# agent-zero-lab/part01/fn_return.py
def show_yuan(fen):
    print(f"{fen / 100:.2f} 元")


def yuan_text(fen):
    return f"{fen / 100:.2f} 元"


a = show_yuan(29900)
print("a 是:", a)

b = yuan_text(29900)
print("b 是:", b)
print("拼起来:", "应付 " + b)

print(type(a).__name__, type(b).__name__)
```

<div class="line-notes">

- `def show_yuan(fen):` 第一个函数只显示,不交出结果。
- `print(f"{fen / 100:.2f} 元")` 函数体里只有一行 `print`,没有 `return`。
- `def yuan_text(fen):` 第二个函数交出结果。
- `return f"{fen / 100:.2f} 元"` `return` 把后面这个值送回给「调用它的那个位置」,函数在这一行结束。
- `a = show_yuan(29900)` 调用第一个函数。调用的那一刻屏幕上就显示了 `299.00 元`(`print` 干的),然后函数没有 `return`,所以 `a` 拿到的是什么?往下看。
- `print("a 是:", a)` 打印出 `None`:没写 `return` 的函数,调用的结果就是 `None`,和 JS 的 `undefined` 对应(Day 14 里 `print` 自己的返回值就是 `None`)。
- `b = yuan_text(29900)` 调用第二个函数。屏幕上这一刻**什么都没显示**,字符串 `"299.00 元"` 被交回来存进了 `b`。
- `print("b 是:", b)` 才把它打印出来。
- `print("拼起来:", "应付 " + b)` 因为 `b` 是真正的字符串,可以拿去拼接、继续加工。
- `print(type(a).__name__, type(b).__name__)` 看类型:`a` 是 `NoneType`,`b` 是 `str`。

</div>

```text
$ uv run python part01/fn_return.py
299.00 元
a 是: None
b 是: 299.00 元
拼起来: 应付 299.00 元
NoneType str
```

<div class="line-notes">

- `299.00 元` 这一行是 `show_yuan` 调用时 `print` 出来的,不是下面 `print("a 是:", a)` 打的。
- `a 是: None` 调用 `show_yuan` 的结果是 `None`。
- `b 是: 299.00 元` 调用 `yuan_text` 的结果是字符串。
- `拼起来: 应付 299.00 元` 拿到的结果可以接着用。
- `NoneType str` 两个结果的类型。

</div>

两种写法的区别用一张图看:`print` 是把东西「喊出去」给屏幕上的人看,`return` 是把东西「递回去」给调用你的那行代码。

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="print 和 return 的区别:show_yuan 里 print 把文字显示到屏幕,调用处拿到 None;yuan_text 里 return 把字符串交回调用处,可以存进变量继续使用">
<rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="12" y="14" width="300" height="182" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="24" y="38" fill="var(--ink)">print:喊给屏幕听</text>
<text x="24" y="66" fill="var(--ink-soft)">def show_yuan(fen):</text>
<text x="24" y="86" fill="var(--ink-soft)">    print("299.00 元")</text>
<text x="24" y="118" fill="var(--ink-soft)">a = show_yuan(29900)</text>
<text x="24" y="142" fill="var(--ink)">屏幕上出现 299.00 元</text>
<text x="24" y="166" fill="var(--ink)">a 里装的是 None</text>
<text x="24" y="186" fill="var(--ink-faint)">后面没法再用这个结果</text>
<rect x="328" y="14" width="300" height="182" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="340" y="38" fill="var(--ink)">return:递回给调用的人</text>
<text x="340" y="66" fill="var(--ink-soft)">def yuan_text(fen):</text>
<text x="340" y="86" fill="var(--ink-soft)">    return "299.00 元"</text>
<text x="340" y="118" fill="var(--ink-soft)">b = yuan_text(29900)</text>
<text x="340" y="142" fill="var(--ink)">屏幕上什么都没有</text>
<text x="340" y="166" fill="var(--ink)">b 里装的是 "299.00 元"</text>
<text x="340" y="186" fill="var(--ink-faint)">可以拼接、存起来、传给别的函数</text>
</g>
</svg>
<figcaption>琥珀色一侧只显示,蓝色一侧才交回结果。写函数时,大多数时候你要的是蓝色这种。</figcaption>
</figure>

### 把 None 拿去用,就会炸

不报错的情形最危险,但这里它会报错。新建 `part01/fn_return_err.py`,把 `show_yuan` 的结果直接拿去拼字符串:

```python
# agent-zero-lab/part01/fn_return_err.py
def show_yuan(fen):
    print(f"{fen / 100:.2f} 元")


text = "应付 " + show_yuan(29900)
print(text)
```

<div class="line-notes">

- `def show_yuan(fen):` 同上,只显示、没有 `return`。
- `print(f"{fen / 100:.2f} 元")` 调用时会先在屏幕上打出这一行。
- `text = "应付 " + show_yuan(29900)` 想把 `"应付 "` 和函数的结果拼起来。但函数的结果是 `None`,字符串加 `None`。
- `print(text)` 走不到这一行。

</div>

```text
$ uv run python part01/fn_return_err.py
299.00 元
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/fn_return_err.py", line 6, in <module>
    text = "应付 " + show_yuan(29900)
           ~~~~~~~~^~~~~~~~~~~~~~~~~~
TypeError: can only concatenate str (not "NoneType") to str
```

<div class="line-notes">

- `299.00 元` 先出现的这一行是 `show_yuan` 里的 `print`。
- `File "/Users/你/agent-zero-lab/part01/fn_return_err.py", line 6, in <module>` 崩在第 6 行。
- `text = "应付 " + show_yuan(29900)` 就是这一行,波浪线 `~~~~` 标出加号两边。
- `TypeError: can only concatenate str (not "NoneType") to str` 只能把字符串和字符串拼起来,右边是 `NoneType`。看到 `NoneType` 出现在报错里,第一反应:**我的某个函数忘了写 `return`。**

</div>

编辑器在你写的时候就画了红线:`Operator "+" not supported for types "Literal['应付 ']" and "None"`。以后看到类似的红线,先检查函数有没有 `return`。

## return 会立刻结束函数

`return` 还有一个作用:函数跑到 `return` 就**当场结束**,后面的代码不会再执行。这让你可以用「一道关卡一个 `return`」写出不用 `elif` 堆叠的分类函数。回忆 Day 20 里那条长长的链,现在把它包成函数 `classify`。新建 `part01/fn_early.py`:

```python
# agent-zero-lab/part01/fn_early.py
def classify(desc):
    text = desc.lower()
    if "导出" in text or "抬头" in text or "pdf" in text or "方框" in text:
        return "功能"
    if (
        "扣" in text
        or "退款" in text
        or "发票" in text
        or "金额" in text
        or "月付" in text
        or "年付" in text
        or "refund" in text
        or "charge" in text
    ):
        return "计费"
    if "登录" in text or "验证码" in text or "密码" in text or "password" in text:
        return "登录"
    return "功能"


for desc in ["8月2日重复扣款299元", "验证码收不到", "导出PDF乱码", "随便问问"]:
    print(f"{desc} → {classify(desc)}")
```

<div class="line-notes">

- `def classify(desc):` 收一个参数:工单描述。
- `text = desc.lower()` 描述转小写,英文关键词才认得(Day 16)。
- `if "导出" in text or "抬头" in text or "pdf" in text or "方框" in text:` 功能类的关键词放最前面(Day 17 的教训:窄条件在前)。
- `return "功能"` 命中就**直接交出结果,函数到此结束**,下面的 `if` 都不会再看。不需要 `elif`,也不需要一个 `category` 变量。
- `if (` 计费的关键词太长,用括号包起来换行,括号里换行不用反斜杠(Ruff 格式化的样子)。
- `"扣" in text` 第一个关键词,后面接着 `or` 等等,一共八个关键词,任何一个出现都算计费。
- `return "计费"` 命中计费。到这里的描述一定没有功能词,因为有的话前一个 `return` 已经把函数结束了。
- `if "登录" in text or "验证码" in text or "密码" in text or "password" in text:` 登录类。
- `return "登录"` 命中登录。
- `return "功能"` 前面都没命中,默认功能。这是函数的最后一行,**每条路径都要有 `return`**,否则没命中的会返回 `None`。
- `for desc in ["8月2日重复扣款299元", "验证码收不到", "导出PDF乱码", "随便问问"]:` 四条描述各调一次。注意这里循环变量也叫 `desc`,和函数的参数名相同,没有冲突:它们是两个独立的名字。
- `print(f"{desc} → {classify(desc)}")` 把调用写在 f-string 里面,函数的返回值直接显示。

</div>

```text
$ uv run python part01/fn_early.py
8月2日重复扣款299元 → 计费
验证码收不到 → 登录
导出PDF乱码 → 功能
随便问问 → 功能
```

<div class="line-notes">

- `8月2日重复扣款299元 → 计费` 没有功能词;有「扣」,命中计费那组的第一个关键词,`return "计费"`,函数结束。
- `验证码收不到 → 登录` 功能词和计费词都不在,走到登录那一关,「验证码」命中。
- `导出PDF乱码 → 功能` 第一道关卡就命中,后面的关卡一个都没看。
- `随便问问 → 功能` 三道关卡都没命中,走到最后一行默认值。

</div>

## 参数个数对不上

JS 里少传多传都能跑,Python 不行。新建 `part01/fn_args_missing.py`,只传一个参数给需要两个的 `with_tax`:

```python
# agent-zero-lab/part01/fn_args_missing.py
def with_tax(fen, rate_percent):
    return fen + fen * rate_percent // 100


print(with_tax(29900))
```

```text
$ uv run python part01/fn_args_missing.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/fn_args_missing.py", line 6, in <module>
    print(with_tax(29900))
          ^^^^^^^^^^^^^^^
TypeError: with_tax() missing 1 required positional argument: 'rate_percent'
```

<div class="line-notes">

- `File "/Users/你/agent-zero-lab/part01/fn_args_missing.py", line 6, in <module>` 在第 6 行调用时出的错。
- `print(with_tax(29900))` 只给了 `fen`,没给 `rate_percent`。
- `TypeError: with_tax() missing 1 required positional argument: 'rate_percent'` 翻译:`with_tax()` 少了 1 个必须传的位置参数,叫 `rate_percent`。报错直接告诉你缺的是哪个名字。

</div>

再多传一个,新建 `part01/fn_args_extra.py`:

```python
# agent-zero-lab/part01/fn_args_extra.py
def with_tax(fen, rate_percent):
    return fen + fen * rate_percent // 100


print(with_tax(29900, 6, 1))
```

```text
$ uv run python part01/fn_args_extra.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/fn_args_extra.py", line 6, in <module>
    print(with_tax(29900, 6, 1))
          ^^^^^^^^^^^^^^^^^^^^^
TypeError: with_tax() takes 2 positional arguments but 3 were given
```

<div class="line-notes">

- `line 6, in <module>` 同样第 6 行。
- `print(with_tax(29900, 6, 1))` 多传了一个 `1`。
- `TypeError: with_tax() takes 2 positional arguments but 3 were given` 它只收 2 个位置参数,你给了 3 个。

</div>

两个报错编辑器也会提前画红线(`Argument missing for parameter "rate_percent"`、`Expected 2 positional arguments`)。**位置参数**就是「按位置对应」的参数,`with_tax(29900, 6)` 里第一个实参对第一个参数,第二个对第二个。下一课学另一种「按名字对应」的传法和默认值。

## 一次交回多个值

Day 22 说过,「函数返回多个值」其实是返回一个元组,调用的地方顺手解包。现在你自己能写这样的函数了。顺便把 Day 21 承诺过的 `median` 也包起来。新建 `part01/fn_multi.py`:

```python
# agent-zero-lab/part01/fn_multi.py
def split_line(raw):
    parts = raw.split(maxsplit=3)
    return parts[0], parts[3]


def min_max(values):
    return min(values), max(values)


def median(values):
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2 == 1:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) // 2


ticket_id, desc = split_line("T201 计费 C023 8月2日重复扣款299元")
print(ticket_id, "|", desc)

paid = [59800, 46800, 29900, 29900, 4900]
lo, hi = min_max(paid)
print("最小", lo, "最大", hi)
print("5 张的中位数:", median(paid))
print("6 张的中位数:", median(paid + [50000]))
print("原列表没被动过:", paid)
```

<div class="line-notes">

- `def split_line(raw):` 收一行原始文本。
- `parts = raw.split(maxsplit=3)` 最多拆成四段。第一次调用时,`raw` 是 `"T201 计费 C023 8月2日重复扣款299元"`,`parts` 是 `['T201', '计费', 'C023', '8月2日重复扣款299元']`。
- `return parts[0], parts[3]` 逗号隔开的两个值,交回去的是元组 `('T201', '8月2日重复扣款299元')`。
- `def min_max(values):` 就是 Day 22 抄过的那个函数,现在每个词你都认得了。
- `return min(values), max(values)` 最小值和最大值,打包成元组。
- `def median(values):` Day 21 许诺的中位数函数。
- `ordered = sorted(values)` 先排序,得到新列表,不动传进来的列表。
- `mid = len(ordered) // 2` 中间位置的下标。5 项得 2,6 项得 3。
- `if len(ordered) % 2 == 1:` 奇数项吗?
- `return ordered[mid]` 奇数项,正中间那一个。这一行 `return` 后函数就结束了,不需要 `else`。
- `return (ordered[mid - 1] + ordered[mid]) // 2` 走到这里一定是偶数项:取中间两个的平均(整除,保持整数分)。
- `ticket_id, desc = split_line("T201 计费 C023 8月2日重复扣款299元")` 调用并解包:元组的两项分别进两个名字。
- `print(ticket_id, "|", desc)` 打印。
- `paid = [59800, 46800, 29900, 29900, 4900]` Day 21 那 5 张有金额的工单。
- `lo, hi = min_max(paid)` 解包成最小和最大。
- `print("最小", lo, "最大", hi)` 打印。
- `print("5 张的中位数:", median(paid))` 排序后是 `[4900, 29900, 29900, 46800, 59800]`,`mid` 是 2,奇数项,取 `ordered[2]` 即 29900。
- `print("6 张的中位数:", median(paid + [50000]))` `paid + [50000]` 造了一个 6 项的新列表。排序后 `[4900, 29900, 29900, 46800, 50000, 59800]`,`mid` 是 3,偶数项,`(29900 + 46800) // 2` 是 38350。
- `print("原列表没被动过:", paid)` `median` 里是对 `sorted(values)` 的结果操作,没有排序传进来的 `paid`,所以顺序还是原样。如果函数里写成 `values.sort()`,这里就会变(Day 21 的 `b = a` 是同一个列表)。

</div>

```text
$ uv run python part01/fn_multi.py
T201 | 8月2日重复扣款299元
最小 4900 最大 59800
5 张的中位数: 29900
6 张的中位数: 38350
原列表没被动过: [59800, 46800, 29900, 29900, 4900]
```

<div class="line-notes">

- `T201 | 8月2日重复扣款299元` 元组解包后的两个名字。
- `最小 4900 最大 59800` `min_max` 的两个返回值。
- `5 张的中位数: 29900` 和 Day 21 手算的一样。
- `6 张的中位数: 38350` 和 Day 21 的「多一张 500 元」那行一样,这回只写了一遍代码,用了两次。
- `原列表没被动过: [59800, 46800, 29900, 29900, 4900]` 传进去的列表原样没变。

</div>

注意函数里有**两个** `return`,但每次调用只会走到其中一个。「提前返回」让奇数、偶数两种情况各占一行,不需要 `else` 缩进一层。

## def 是一条语句:要先执行到它

JS 的 `function` 会提升,写在后面也能提前用。Python 的 `def` 不会:它是一条普通语句,**执行到它的那一刻,才把名字和函数绑起来**。新建 `part01/fn_order.py`:

```python
# agent-zero-lab/part01/fn_order.py
print(double(21))


def double(n):
    return n * 2
```

```text
$ uv run python part01/fn_order.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/fn_order.py", line 2, in <module>
    print(double(21))
          ^^^^^^
NameError: name 'double' is not defined
```

<div class="line-notes">

- `File "/Users/你/agent-zero-lab/part01/fn_order.py", line 2, in <module>` 第 2 行就出错了。
- `print(double(21))` 脚本从上往下执行,这时候还没碰到下面的 `def double`,所以 `double` 这个名字还不存在。
- `NameError: name 'double' is not defined` 和用没定义的变量是同一个报错(Day 14)。

</div>

修法很简单:把 `def` 挪到调用的上面。小脚本里,函数都写在文件最前面,调用写在后面。

既然 `def` 是「把名字绑上去」,那同一个名字绑两次会怎样?新建 `part01/fn_rebind.py`:

```python
# agent-zero-lab/part01/fn_rebind.py
def fee(amount):
    return amount * 3 // 100


print(fee(10000))


def fee(amount):
    return amount * 5 // 100


print(fee(10000))

sum = 0
for n in [1, 2, 3]:
    sum += n
print(sum)
print(sum([4, 5, 6]))
```

<div class="line-notes">

- `def fee(amount):` 第一次绑定:`fee` 是 3% 手续费。
- `return amount * 3 // 100` 整数分算百分之三。
- `print(fee(10000))` `10000 * 3 // 100` 是 300。
- `def fee(amount):` 同一个名字再 `def` 一次,**不报错**,`fee` 现在指向新的这个函数,旧的被盖掉了。
- `return amount * 5 // 100` 5% 手续费。
- `print(fee(10000))` 同样的调用,现在是 `10000 * 5 // 100`,500。
- `sum = 0` 另一个陷阱:`sum` 本来是 Python 自带的求和函数,这一行把 `sum` 这个名字改绑成了整数 0。
- `for n in [1, 2, 3]:` 循环。
- `sum += n` 当作累加器用,最后 `sum` 是 6。
- `print(sum)` 打印 6,到这里一切正常。
- `print(sum([4, 5, 6]))` 想再用一次自带的 `sum`,但名字已经指向整数 6。整数后面加括号,等于把整数当函数调用。

</div>

```text
$ uv run python part01/fn_rebind.py
300
500
6
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/fn_rebind.py", line 19, in <module>
    print(sum([4, 5, 6]))
          ^^^^^^^^^^^^^^
TypeError: 'int' object is not callable
```

<div class="line-notes">

- `300` 第一个 `fee`。
- `500` 第二个 `fee` 把第一个盖掉了,没有任何警告。多人合并代码时,如果两个人各写了一个同名函数,后面的悄悄赢,这是合并冲突里很难查的一类问题(Day 57 会遇到)。
- `6` 累加结果。
- `line 19, in <module>` 崩在第 19 行。
- `print(sum([4, 5, 6]))` 就是这一行。
- `TypeError: 'int' object is not callable` 「整数不能被调用」。看到 `'xxx' object is not callable`,先想:是不是把自带函数的名字(`sum`、`max`、`min`、`list`、`len`)拿去当变量了。累加器改叫 `total`。

</div>

basedpyright 在第 2 行画红线 `Function declaration "fee" is obscured by a declaration of the same name`,在第 19 行画 `Object of type "int" is not callable`,两个都提前告诉你了。

## 把函数交给别人用:sorted 的 key

Day 21 留了一笔账:`rows.sort(reverse=True)` 排 `[金额, 工单号]` 时,金额相同的两张(T201 和 T208 都是 29900),工单号是**倒着**排的,T208 在 T201 前面。你想要的是「金额从大到小,金额相同时工单号从小到大」。办法是给 `sorted` 一个 `key`:**一个函数的名字**,`sorted` 会对每一项调用它,拿返回的值来比大小。新建 `part01/fn_key.py`:

```python
# agent-zero-lab/part01/fn_key.py
rows = [
    (29900, "T201"),
    (46800, "T203"),
    (4900, "T204"),
    (59800, "T206"),
    (29900, "T208"),
]


def amount_then_id(row):
    fen, ticket_id = row
    return (-fen, ticket_id)


print("key 函数对每一行的返回:")
for row in rows:
    print(" ", row, "→", amount_then_id(row))

print("reverse=True:", sorted(rows, reverse=True))
print("用 key 排序:  ", sorted(rows, key=amount_then_id))
```

<div class="line-notes">

- `rows = [` 五项 `(金额分, 工单号)` 元组(Day 22 改用元组)。两个 29900:T201 和 T208。
- `def amount_then_id(row):` 一个收一项、交回「排序用的值」的函数。
- `fen, ticket_id = row` 解包这一项。比如 `(29900, "T201")` 拆成 `fen = 29900`、`ticket_id = "T201"`。
- `return (-fen, ticket_id)` 交回一个元组 `(-29900, "T201")`。金额取负数:`sorted` 默认从小到大,金额取负以后「大的金额」排前面,而工单号没取负,所以相同金额时从小到大。
- `print("key 函数对每一行的返回:")` 小标题。
- `for row in rows:` 手动对每一行调一遍,看看 `sorted` 内部拿到的是什么。
- `print(" ", row, "→", amount_then_id(row))` 左边是原来的元组,右边是 key 函数交回的元组。
- `print("reverse=True:", sorted(rows, reverse=True))` 旧办法:整个倒着排。
- `print("用 key 排序:  ", sorted(rows, key=amount_then_id))` 新办法。`key=amount_then_id` **后面没有括号**:传的是函数本身,`sorted` 自己去调用它,每一项一次。

</div>

```text
$ uv run python part01/fn_key.py
key 函数对每一行的返回:
  (29900, 'T201') → (-29900, 'T201')
  (46800, 'T203') → (-46800, 'T203')
  (4900, 'T204') → (-4900, 'T204')
  (59800, 'T206') → (-59800, 'T206')
  (29900, 'T208') → (-29900, 'T208')
reverse=True: [(59800, 'T206'), (46800, 'T203'), (29900, 'T208'), (29900, 'T201'), (4900, 'T204')]
用 key 排序:   [(59800, 'T206'), (46800, 'T203'), (29900, 'T201'), (29900, 'T208'), (4900, 'T204')]
```

<div class="line-notes">

- `key 函数对每一行的返回:` 小标题。
- `(29900, 'T201') → (-29900, 'T201')` 金额取了负。
- `(46800, 'T203') → (-46800, 'T203')` 金额越大,负数越小,在「从小到大」里就越靠前。
- `(4900, 'T204') → (-4900, 'T204')` 49 元最小,取负后最大,排最后。
- `(59800, 'T206') → (-59800, 'T206')` 598 元最大,取负后最小,排第一。
- `(29900, 'T208') → (-29900, 'T208')` 和 T201 的第一项相同,比第二项,`'T201'` 小于 `'T208'`。
- `reverse=True: [(59800, 'T206'), (46800, 'T203'), (29900, 'T208'), (29900, 'T201'), (4900, 'T204')]` 旧办法:T208 在 T201 前面。
- `用 key 排序:   [(59800, 'T206'), (46800, 'T203'), (29900, 'T201'), (29900, 'T208'), (4900, 'T204')]` 新办法:并列的两张,T201 在前,先来的排前面。

</div>

最常见的错是顺手加了括号。新建 `part01/fn_key_err.py`:

```python
# agent-zero-lab/part01/fn_key_err.py
rows = [(29900, "T201"), (4900, "T204")]


def amount_then_id(row):
    fen, ticket_id = row
    return (-fen, ticket_id)


print(sorted(rows, key=amount_then_id()))
```

```text
$ uv run python part01/fn_key_err.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/fn_key_err.py", line 10, in <module>
    print(sorted(rows, key=amount_then_id()))
                           ^^^^^^^^^^^^^^^^
TypeError: amount_then_id() missing 1 required positional argument: 'row'
```

<div class="line-notes">

- `line 10, in <module>` 第 10 行。
- `print(sorted(rows, key=amount_then_id()))` `amount_then_id()` 带括号,意思是「现在就调用它」,可你没给 `row`。
- `TypeError: amount_then_id() missing 1 required positional argument: 'row'` 和前面「少一个参数」是同一个报错。**带括号是调用,不带括号是把函数本身递过去。**

</div>

「把函数当成一个值传来传去」是 Python 里很重要的一招,Day 30 会学 `lambda`(一次性的小函数,相当于 JS 的箭头函数),让 `key=` 写起来更短;今天先会写名字清楚的 `def` 版本就够。

## 小项目:把日报拆成函数

回到 Day 20 的 `daily_report.py`:一个 90 行的大循环,清洗、坏行关卡、分类、抠金额全挤在里面。现在把能独立说清的几块拆成函数:

- `clean(raw)`:收一行原始文本,交回清洗过的字符串。
- `parse(line)`:收清洗后的一行,交回 `(记录, 原因)`:好行返回 `((工单号, 人工类别, 描述), "")`,坏行返回 `(None, "空行")` 这样的说明。
- `classify(desc)`:收描述,交回类别。
- `extract_fen(desc)`:收描述,交回金额(整数分),抠不出来返回 0。

主循环只负责「调用它们并记账」。验收标准很明确:**汇总数字要和 Day 20 的一模一样**(有效 8 行、规则分对 7/8、计费 4 / 登录 2 / 功能 2、金额合计 1,414.00 元)。新建 `part01/ticket_funcs.py`:

```python
# agent-zero-lab/part01/ticket_funcs.py
import unicodedata


def clean(raw):
    return unicodedata.normalize("NFKC", raw).strip()


def parse(line):
    if line == "":
        return None, "空行"
    parts = line.split(maxsplit=3)
    if len(parts) < 4:
        return None, f"只有 {len(parts)} 段「{line}」"
    ticket_id, human, _, desc = parts
    if human not in ("计费", "登录", "功能"):
        return None, f"{ticket_id} 的类别「{human}」不认识"
    return (ticket_id, human, desc), ""


def classify(desc):
    text = desc.lower()
    if "导出" in text or "抬头" in text or "pdf" in text or "方框" in text:
        return "功能"
    if (
        "扣" in text
        or "退款" in text
        or "发票" in text
        or "金额" in text
        or "月付" in text
        or "年付" in text
        or "refund" in text
        or "charge" in text
    ):
        return "计费"
    if "登录" in text or "验证码" in text or "密码" in text or "password" in text:
        return "登录"
    return "功能"


def extract_fen(desc):
    pos = desc.find("元")
    if pos == -1:
        return 0
    start = pos
    while start > 0 and desc[start - 1].isdigit():
        start -= 1
    if start == pos:
        return 0
    return int(desc[start:pos]) * 100


print("先单独试试零件:")
print(" ", classify("我想要发票PDF"), classify("验证码收不到"))
print(" ", extract_fen("扣了两次,共598元"), extract_fen("验证码收不到"))
print(" ", parse("T105 计费"))
print(" ", parse("T101 计费 C023 8月2日重复扣款299元"))
print()

raw_lines = [
    "T101 计费 C023 8月2日重复扣款299元",
    "  T102 登录 C007 验证码收不到 ",
    "",
    "T103 计费 C015 年付多扣了468元,要求退款",
    "T104 功能 C031 导出PDF乱码",
    "T105 计费",
    "Ｔ106 计费 C042 发票金额对不上,多收了49元",
    "T107 登录 C007 Forgot password",
    "T108 计费 C015 我想要发票PDF",
    "T109 其他 C099 随便问问",
    "T110 计费 C023 扣了两次,共598元",
    "   ",
]

good = 0
skipped = 0
correct = 0
counts = {}
mentioned_fen = 0

for no, raw in enumerate(raw_lines, start=1):
    record, reason = parse(clean(raw))
    if record is None:
        print(f"第 {no:2} 行:{reason},跳过")
        skipped += 1
        continue

    ticket_id, human, desc = record
    category = classify(desc)
    fen = extract_fen(desc) if category == "计费" else 0

    good += 1
    if category == human:
        correct += 1
    counts[category] = counts.get(category, 0) + 1
    mentioned_fen += fen
    mark = "对" if category == human else "错"
    print(
        f"第 {no:2} 行:{ticket_id} 人工={human} 规则={category} {mark} 金额={fen // 100}"
    )

print("--- 日报 ---")
print(f"共 {len(raw_lines)} 行,有效 {good} 行,跳过 {skipped} 行")
print(f"规则分对 {correct}/{good}")
print("规则分类:", counts)
print(f"工单里提到的金额合计:{mentioned_fen / 100:,.2f} 元")
```

<div class="line-notes">

- `import unicodedata` 清洗全角字符(Day 16)。`import` 写在文件最前面。
- `def clean(raw):` 第一个零件。
- `return unicodedata.normalize("NFKC", raw).strip()` 全角变半角再去两头空白,一行,直接交出。
- `def parse(line):` 第二个零件:拆行加校验。
- `if line == "":` 第一道关卡:空行。
- `return None, "空行"` 提前返回:交回 `None`(没有记录)和原因。主循环用 `record is None` 判断坏行。
- `parts = line.split(maxsplit=3)` 到这里一定非空。
- `if len(parts) < 4:` 第二道关卡:段数不够。
- `return None, f"只有 {len(parts)} 段「{line}」"` 原因里带着段数和原文。
- `ticket_id, human, _, desc = parts` 解包四段,客户号这次用不着,用 `_`(Day 22)。
- `if human not in ("计费", "登录", "功能"):` 第三道关卡:类别不认识。
- `return None, f"{ticket_id} 的类别「{human}」不认识"` 原因。
- `return (ticket_id, human, desc), ""` 三道关卡都过了:交回一个三项元组和一个空串(没有问题)。
- `def classify(desc):` 第三个零件,和 `fn_early.py` 里的一模一样,Day 20 那条 `if`/`elif` 链换成提前 `return`。
- `text = desc.lower()` 转小写。
- `return "功能"` 第一道功能关卡的结果。
- `return "计费"` 计费关卡的结果。
- `return "登录"` 登录关卡的结果。
- `return "功能"` 最后一行,默认功能。
- `def extract_fen(desc):` 第四个零件:抠金额。
- `pos = desc.find("元")` 找「元」的位置。
- `return 0` 没有「元」,金额 0。提前结束。
- `start = pos` 从「元」往前退。
- `while start > 0 and desc[start - 1].isdigit():` 前一个字符是数字就继续退。
- `return 0` 「元」前面不是数字,金额 0。
- `return int(desc[start:pos]) * 100` 切出数字、转整数、乘 100 换成分,交回。
- `print("先单独试试零件:")` 函数写好后可以**单独试**,不用跑完整个大循环,这是函数最大的好处之一。
- `print(" ", classify("我想要发票PDF"), classify("验证码收不到"))` 前一个因为有 `pdf` 被判成功能(Day 20 里唯一判错的那张 T108),后一个是登录。
- `print(" ", extract_fen("扣了两次,共598元"), extract_fen("验证码收不到"))` 598 元得 59800 分,没有「元」得 0。
- `print(" ", parse("T105 计费"))` 缺段的行,看返回的 `(None, 原因)`。
- `print(" ", parse("T101 计费 C023 8月2日重复扣款299元"))` 好行,看返回的 `(元组, "")`。
- `print()` 空一行。
- `raw_lines = [` 和 Day 20 完全相同的 12 行原始数据。
- `good = 0` 有效行数。
- `skipped = 0` 跳过的行数。
- `correct = 0` 规则分对的张数。
- `counts = {}` 这次类别计数用字典(Day 24),不再是 `billing`、`login`、`feature` 三个变量。
- `mentioned_fen = 0` 金额合计,单位分。
- `for no, raw in enumerate(raw_lines, start=1):` 主循环。
- `record, reason = parse(clean(raw))` 一行里两层调用:先 `clean` 再 `parse`,里面那个先执行,它的结果送给外面那个。`parse` 返回的元组被解包成两个名字。
- `if record is None:` 坏行(用 `is None` 判断,Day 14)。
- `print(f"第 {no:2} 行:{reason},跳过")` 把 `parse` 交回的原因直接显示。
- `skipped += 1` 记账。
- `continue` 回到循环头。
- `ticket_id, human, desc = record` 好行:三项元组解包。
- `category = classify(desc)` 调用分类。
- `fen = extract_fen(desc) if category == "计费" else 0` 只对规则判成计费的行抠金额(和 Day 20 一样),用条件表达式。
- `good += 1` 有效行加 1。
- `if category == human:` 规则和人工一致?
- `correct += 1` 一致,对了一张。
- `counts[category] = counts.get(category, 0) + 1` 计数句式。
- `mentioned_fen += fen` 金额累加。
- `mark = "对" if category == human else "错"` 显示用。
- `print(` 这条 `print` 被 Ruff 折成三行。
- `f"第 {no:2} 行:{ticket_id} 人工={human} 规则={category} {mark} 金额={fen // 100}"` 明细,和 Day 20 的格式一样。
- `print("--- 日报 ---")` 循环结束后。
- `print(f"共 {len(raw_lines)} 行,有效 {good} 行,跳过 {skipped} 行")` 汇总。
- `print(f"规则分对 {correct}/{good}")` 成绩。
- `print("规则分类:", counts)` 直接打印计数字典。
- `print(f"工单里提到的金额合计:{mentioned_fen / 100:,.2f} 元")` 分变回元,只在显示这一刻。

</div>

```text
$ uv run python part01/ticket_funcs.py
先单独试试零件:
  功能 登录
  59800 0
  (None, '只有 2 段「T105 计费」')
  (('T101', '计费', '8月2日重复扣款299元'), '')

第  1 行:T101 人工=计费 规则=计费 对 金额=299
第  2 行:T102 人工=登录 规则=登录 对 金额=0
第  3 行:空行,跳过
第  4 行:T103 人工=计费 规则=计费 对 金额=468
第  5 行:T104 人工=功能 规则=功能 对 金额=0
第  6 行:只有 2 段「T105 计费」,跳过
第  7 行:T106 人工=计费 规则=计费 对 金额=49
第  8 行:T107 人工=登录 规则=登录 对 金额=0
第  9 行:T108 人工=计费 规则=功能 错 金额=0
第 10 行:T109 的类别「其他」不认识,跳过
第 11 行:T110 人工=计费 规则=计费 对 金额=598
第 12 行:空行,跳过
--- 日报 ---
共 12 行,有效 8 行,跳过 4 行
规则分对 7/8
规则分类: {'计费': 4, '登录': 2, '功能': 2}
工单里提到的金额合计:1,414.00 元
```

<div class="line-notes">

- `先单独试试零件:` 小标题。
- `  功能 登录` `classify` 两次调用的结果。「我想要发票PDF」被 `pdf` 抢先判成功能,这个已知的规则缺陷原样保留。
- `  59800 0` `extract_fen` 的两次结果。
- `  (None, '只有 2 段「T105 计费」')` 坏行:没有记录,有原因。
- `  (('T101', '计费', '8月2日重复扣款299元'), '')` 好行:一个三项元组加一个空串的原因。
- `第  1 行:T101 人工=计费 规则=计费 对 金额=299` 主循环明细,和 Day 20 逐行一致。
- `第  3 行:空行,跳过` 第一道关卡的原因。
- `第  6 行:只有 2 段「T105 计费」,跳过` 第二道关卡。
- `第  9 行:T108 人工=计费 规则=功能 错 金额=0` 唯一判错的一张,和 Day 20 一样。
- `第 10 行:T109 的类别「其他」不认识,跳过` 第三道关卡。
- `共 12 行,有效 8 行,跳过 4 行` 和 Day 20 一样。
- `规则分对 7/8` 一样。
- `规则分类: {'计费': 4, '登录': 2, '功能': 2}` 数字一样,只是展示成了字典。
- `工单里提到的金额合计:1,414.00 元` 299 + 468 + 49 + 598 = 1414,一样。

</div>

对照表,方便你检查「零件」对应原来大循环的哪一段:

| 函数 | 原来在 `daily_report.py` 里的位置 | 收什么 | 交回什么 |
| --- | --- | --- | --- |
| `clean(raw)` | 循环开头 `line = unicodedata.normalize(...).strip()` | 原始一行 | 清洗后的字符串 |
| `parse(line)` | 三道关卡:空行、段数、类别 | 清洗后的一行 | `(记录, 原因)` |
| `classify(desc)` | 那条 `if`/`elif` 长链 | 描述 | 类别字符串 |
| `extract_fen(desc)` | `pos = desc.find("元")` 到 `mentioned_fen += ...` | 描述 | 整数分 |

拆完以后,主循环从 90 行缩到十几行。更重要的是,以后分类规则要改,只改 `classify` 一个地方,所有用它的脚本都跟着变。

## 动手练习

### 练习 1:把分类写成函数

写 `part01/ex28_1_funcs.py`,先写三个函数,再用下面的调用验证:

- `fen_to_yuan(fen)`:交回两位小数的元字符串,不带「元」字,`29900` 得 `"299.00"`,`5` 得 `"0.05"`。
- `is_refund(desc)`:描述里有「退款」或 `refund`(不分大小写)交回 `True`,否则 `False`。
- `level(fen)`:金额分档,5 万分(500 元)及以上交回 `"大额"`,1 万分(100 元)及以上交回 `"中额"`,其余 `"小额"`。要求用提前 `return`,不写 `elif`。

```python
# 写在三个函数后面的调用
print(fen_to_yuan(29900), fen_to_yuan(5), fen_to_yuan(0))
print(is_refund("年付多扣了,要求退款"), is_refund("Refund request"), is_refund("验证码收不到"))
for fen in [59800, 29900, 4900]:
    print(fen, level(fen))
```

期望输出:

```text
299.00 0.05 0.00
True True False
59800 大额
29900 中额
4900 小额
```

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex28_1_funcs.py
def fen_to_yuan(fen):
    return f"{fen / 100:.2f}"


def is_refund(desc):
    text = desc.lower()
    return "退款" in text or "refund" in text


def level(fen):
    if fen >= 50000:
        return "大额"
    if fen >= 10000:
        return "中额"
    return "小额"


print(fen_to_yuan(29900), fen_to_yuan(5), fen_to_yuan(0))
print(
    is_refund("年付多扣了,要求退款"),
    is_refund("Refund request"),
    is_refund("验证码收不到"),
)
for fen in [59800, 29900, 4900]:
    print(fen, level(fen))
```

<div class="line-notes">

- `def fen_to_yuan(fen):` 收一个整数分。
- `return f"{fen / 100:.2f}"` `29900 / 100` 是 299.0,`:.2f` 补成两位小数 `299.00`;`5 / 100` 是 0.05;`0` 得 `0.00`。
- `def is_refund(desc):` 收描述。
- `text = desc.lower()` 转小写,`Refund request` 变成 `refund request`。
- `return "退款" in text or "refund" in text` 这是一个**布尔表达式直接当返回值**:`in` 本身就得到 `True`/`False`,不需要再写 `if ...: return True else: return False`。
- `def level(fen):` 收金额。
- `if fen >= 50000:` 先看最大的一档。
- `return "大额"` 命中就结束。
- `if fen >= 10000:` 能走到这里,说明 `fen` 一定小于 50000,所以这一道只需要写下限。
- `return "中额"` 中档。
- `return "小额"` 前两道都没命中的默认值。
- `print(fen_to_yuan(29900), fen_to_yuan(5), fen_to_yuan(0))` 三次调用,一行打印三个结果。
- `print(` 这条被 Ruff 折成了多行,里面是三次 `is_refund` 调用。
- `is_refund("年付多扣了,要求退款"),` 有「退款」,`True`。
- `is_refund("Refund request"),` 小写后含 `refund`,`True`。
- `is_refund("验证码收不到"),` 两个都没有,`False`。
- `for fen in [59800, 29900, 4900]:` 三个金额。
- `print(fen, level(fen))` 59800 大额、29900 中额、4900 小额。

</div>

```text
$ uv run python part01/ex28_1_funcs.py
299.00 0.05 0.00
True True False
59800 大额
29900 中额
4900 小额
```

<div class="line-notes">

- `299.00 0.05 0.00` 三个金额的元字符串。
- `True True False` 三条描述的判断。
- `59800 大额` 598 元,大于等于 500 元。
- `29900 中额` 299 元。
- `4900 小额` 49 元。

</div>

</details>

### 练习 2:先猜,再跑

不要先运行。下面六行输出分别是什么?先写下答案再核对。重点看第 1 行(函数里改参数,外面的变量变不变)、第 2 行(函数改了传进来的列表,又没写 `return`)、第 4 行(`h(-1)` 会先打印什么,再打印什么)和第 6 行(`first_even([1, 3])`)。

```python
# agent-zero-lab/part01/ex28_2_guess.py
def f(x):
    x = x + 1
    return x


def g(items):
    items.append(99)


def h(n):
    if n > 0:
        return "正"
    print("非正")


def pair(a, b):
    return b, a


def first_even(nums):
    for v in nums:
        if v % 2 == 0:
            return v


n = 5
print(f(n), n)
data = [1, 2]
result = g(data)
print(result, data)
print(h(3))
print(h(-1))
x, y = pair(1, 2)
print(x, y, pair(1, 2))
print(first_even([3, 5, 8, 10]), first_even([1, 3]))
```

<details><summary>参考答案</summary>

```text
$ uv run python part01/ex28_2_guess.py
6 5
None [1, 2, 99]
正
非正
None
2 1 (2, 1)
8 None
```

<div class="line-notes">

- `6 5` 第 1 行。`f(n)` 里 `x = x + 1` 只是让函数里的名字 `x` 指向新的数 6,交回 6;外面的 `n` 还是 5(整数不可变,Day 14)。
- `None [1, 2, 99]` 第 2 行。`g` 没有 `return`,`result` 是 `None`;但 `items.append(99)` 改的是传进来的**同一个列表**(Day 21 的 `b = a`:参数和实参是同一个对象),所以外面的 `data` 变成了 `[1, 2, 99]`。函数能悄悄修改传进来的列表,所以要不要修改要写清楚。
- `正` 第 3 行。`h(3)` 命中 `n > 0`,`return "正"`,`print` 打出它。
- `非正` 第 4 行的上半。`h(-1)` 走过了 `if`,没有 `return`,执行函数末尾的 `print("非正")`,屏幕上出现「非正」。
- `None` 第 4 行的下半。函数没有 `return` 就是 `None`,外层的 `print(h(-1))` 把它打了出来。
- `2 1 (2, 1)` 第 5 行。`pair(1, 2)` 交回 `(2, 1)`,解包后 `x = 2`、`y = 1`;第三项直接打印元组。
- `8 None` 第 6 行。`first_even([3, 5, 8, 10])` 遇到 8 就 `return`,10 根本没看;`first_even([1, 3])` 一个偶数都没有,循环走完,函数没有 `return` 到,得到 `None`。

</div>

</details>

### 练习 3:找出四个错

`part01/ex28_3_bug.py` 想做四件小事,每件事里藏着今天的一个坑。先照原样跑一遍,每次只修**最先露出来的那一个**,再跑,直到跑完,并且每一行输出你都能解释。

```python
# agent-zero-lab/part01/ex28_3_bug.py
def total(values):
    s = 0
    for v in values:
        s += v
    print(s)


print("合计加一:", total([299, 49]) + 1)


def first_big(values, limit):
    for v in values:
        if v > limit:
            return v
        else:
            return None


print("第一个超过 100 的:", first_big([30, 500, 80], 100))

print("双倍:", double_fen(150))


def double_fen(fen):
    return fen * 2


def parse_amount(text):
    return int(text.removesuffix("元"))


print("金额:", parse_amount("299元", 100))
```

<details><summary>参考答案</summary>

编辑器一开始就画了红线:第 9 行 `Operator "+" not supported for types "None" and "Literal[1]"`、第 22 行 `"double_fen" is not defined`、第 33 行 `Expected 1 positional argument`。第二个坑(`first_big`)没有红线,也不报错,只有对着预期才发现。

```text
$ uv run python part01/ex28_3_bug.py
348
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex28_3_bug.py", line 9, in <module>
    print("合计加一:", total([299, 49]) + 1)
                       ~~~~~~~~~~~~~~~~~^~~
TypeError: unsupported operand type(s) for +: 'NoneType' and 'int'
```

<div class="line-notes">

- `348` 先打印出的这个 348 是 `total` 里 `print(s)` 打的:299 + 49。
- `line 9, in <module>` 第一个坑在第 9 行。
- `print("合计加一:", total([299, 49]) + 1)` 想把 `total` 的结果加 1。
- `TypeError: unsupported operand type(s) for +: 'NoneType' and 'int'` `total` 没有 `return`,结果是 `None`,`None + 1` 就崩了。修:把第 6 行的 `print(s)` 改成 `return s`。

</div>

```text
$ uv run python part01/ex28_3_bug.py
合计加一: 349
第一个超过 100 的: None
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex28_3_bug.py", line 22, in <module>
    print("双倍:", double_fen(150))
                   ^^^^^^^^^^
NameError: name 'double_fen' is not defined
```

<div class="line-notes">

- `合计加一: 349` 第一个修好了:348 + 1。
- `第一个超过 100 的: None` **第二个坑,不报错**:列表 `[30, 500, 80]` 里 500 明明超过 100,却得到 `None`。原因在 `first_big`:`for` 循环的第一轮,`30 > 100` 不成立,走 `else: return None`,函数当场结束,根本没轮到 500。`return` 一旦碰到就结束整个函数,不是结束这一轮。修:去掉 `else`,把 `return None` 挪到 `for` 的外面,所有项都看完还没命中才交回 `None`。
- `line 22, in <module>` **第三个坑**:`first_big` 之后的下一行就崩了。
- `print("双倍:", double_fen(150))` 调用在 `def` 的上面。
- `NameError: name 'double_fen' is not defined` 还没执行到 `def double_fen`,名字不存在。修:把 `def` 挪到调用上面。

</div>

```text
$ uv run python part01/ex28_3_bug.py
合计加一: 349
第一个超过 100 的: 500
双倍: 300
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex28_3_bug.py", line 32, in <module>
    print("金额:", parse_amount("299元", 100))
                   ^^^^^^^^^^^^^^^^^^^^^^^^^^
TypeError: parse_amount() takes 1 positional argument but 2 were given
```

<div class="line-notes">

- `合计加一: 349` 前三个坑都修好了(这个输出是改完 `first_big` 和 `double_fen` 之后)。
- `第一个超过 100 的: 500` 提前 `return` 的位置对了,500 是第一个超过 100 的。
- `双倍: 300` 函数定义在调用上面,150 乘 2。
- `line 32, in <module>` **第四个坑**:最后一行。
- `print("金额:", parse_amount("299元", 100))` 多传了一个 `100`。
- `TypeError: parse_amount() takes 1 positional argument but 2 were given` 它只收 1 个。修:去掉多余的实参。

</div>

四个都改好的 `part01/ex28_3_fixed.py`:

```python
# agent-zero-lab/part01/ex28_3_fixed.py
def total(values):
    s = 0
    for v in values:
        s += v
    return s


print("合计加一:", total([299, 49]) + 1)


def first_big(values, limit):
    for v in values:
        if v > limit:
            return v
    return None


print("第一个超过 100 的:", first_big([30, 500, 80], 100))


def double_fen(fen):
    return fen * 2


print("双倍:", double_fen(150))


def parse_amount(text):
    return int(text.removesuffix("元"))


print("金额:", parse_amount("299元"))
```

<div class="line-notes">

- `def total(values):` 求和函数。
- `s = 0` 累加器放在循环外面(Day 18)。
- `for v in values:` 遍历。
- `s += v` 累加。
- `return s` 现在把结果交出来。
- `print("合计加一:", total([299, 49]) + 1)` 348 加 1 是 349。
- `def first_big(values, limit):` 找第一个超过上限的值。
- `for v in values:` 逐个看。
- `if v > limit:` 超过上限?
- `return v` 是,交回它并结束函数。
- `return None` 缩进回到 `for` 的外面:所有值都看完了还没命中。明写 `None` 是让读代码的人知道「这是有意的」。
- `print("第一个超过 100 的:", first_big([30, 500, 80], 100))` 30 不超过,500 超过,交回 500,80 没机会看。
- `def double_fen(fen):` 现在定义在调用的上面。
- `return fen * 2` 双倍。
- `print("双倍:", double_fen(150))` 300。
- `def parse_amount(text):` 一个收一个参数的函数。
- `return int(text.removesuffix("元"))` 去掉「元」字转整数。
- `print("金额:", parse_amount("299元"))` 一个实参,299。

</div>

```text
$ uv run python part01/ex28_3_fixed.py
合计加一: 349
第一个超过 100 的: 500
双倍: 300
金额: 299
```

<div class="line-notes">

- `合计加一: 349` 第一个坑修好。
- `第一个超过 100 的: 500` 第二个坑修好,对照预期:500。
- `双倍: 300` 第三个坑修好。
- `金额: 299` 第四个坑修好。

</div>

四个坑里,第一个和第四个报错一眼就知道;第三个也报错;**第二个悄悄给出一个错的答案**,只有你心里有个预期(500)才发现得了。写函数时养成习惯:至少用一个「命中不在第一项」的数据试一遍。

</details>

### 练习 4:一页统计

下面是 6 张工单,每张 `(工单号, 描述, 金额分)`。写 `part01/ex28_4_stats.py`:

- 写 `is_refund(desc)`(同练习 1)和 `median(values)`(同今天的 `fn_multi.py`);
- 写 `stats(amounts)`,交回四项元组 `(张数, 合计, 最大值, 中位数)`;如果传进来的是空列表,交回 `(0, 0, 0, 0)`,要用提前 `return`;
- 分别对「有金额的」(金额大于 0)、「退款的」、「一张都没有的」(空列表)各出一行统计,金额以元为单位显示。

```python
rows = [
    ("T801", "重复扣款,请退款", 29900),
    ("T802", "验证码收不到", 0),
    ("T803", "年付多扣了,要求退款", 46800),
    ("T804", "Refund request: charged twice", 29900),
    ("T805", "想要发票PDF", 4900),
    ("T806", "扣了两次,申请退款", 59800),
]
```

期望输出:

```text
有金额的:5 张,合计 1713 元,最大 598 元,中位数 299 元
退款的:4 张,合计 1664 元,最大 598 元,中位数 383 元
没有的:0 张,合计 0 元,最大 0 元,中位数 0 元
```

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex28_4_stats.py
rows = [
    ("T801", "重复扣款,请退款", 29900),
    ("T802", "验证码收不到", 0),
    ("T803", "年付多扣了,要求退款", 46800),
    ("T804", "Refund request: charged twice", 29900),
    ("T805", "想要发票PDF", 4900),
    ("T806", "扣了两次,申请退款", 59800),
]


def is_refund(desc):
    text = desc.lower()
    return "退款" in text or "refund" in text


def median(values):
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2 == 1:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) // 2


def stats(amounts):
    if not amounts:
        return 0, 0, 0, 0
    return len(amounts), sum(amounts), max(amounts), median(amounts)


all_amounts = [fen for _, _, fen in rows if fen > 0]
refund_amounts = [fen for _, desc, fen in rows if is_refund(desc)]

for name, amounts in [
    ("有金额的", all_amounts),
    ("退款的", refund_amounts),
    ("没有的", []),
]:
    count, total, biggest, mid = stats(amounts)
    print(
        f"{name}:{count} 张,合计 {total // 100} 元,最大 {biggest // 100} 元,中位数 {mid // 100} 元"
    )
```

<div class="line-notes">

- `rows = [` 题目给的 6 张工单。T802 金额 0;T804 是英文的 Refund 申请;T805 是发票问题,没有「退款」字样。
- `def is_refund(desc):` 同练习 1。
- `text = desc.lower()` 小写。
- `return "退款" in text or "refund" in text` 布尔表达式直接返回。
- `def median(values):` 同 `fn_multi.py`。
- `ordered = sorted(values)` 排序,不改原列表。
- `mid = len(ordered) // 2` 中间位置。
- `if len(ordered) % 2 == 1:` 奇数项。
- `return ordered[mid]` 奇数项取正中间。
- `return (ordered[mid - 1] + ordered[mid]) // 2` 偶数项取中间两个的平均。
- `def stats(amounts):` 收一个金额列表。
- `if not amounts:` 空列表是假。这是**防空**的关卡:空列表传进 `max(...)` 会报 `ValueError: max() arg is an empty sequence`(Day 21 一样)。
- `return 0, 0, 0, 0` 空的时候交回四个 0,提前结束。
- `return len(amounts), sum(amounts), max(amounts), median(amounts)` 非空:四个值打成一个元组。
- `all_amounts = [fen for _, _, fen in rows if fen > 0]` 推导式加解包:每行拆成三项,不要的用 `_`,取金额,筛出大于 0 的。得到 `[29900, 46800, 29900, 4900, 59800]`,5 项。
- `refund_amounts = [fen for _, desc, fen in rows if is_refund(desc)]` 筛出退款的:T801、T803、T804、T806,金额 `[29900, 46800, 29900, 59800]`。
- `for name, amounts in [` 三组数据一起循环,每组是 `(名字, 金额列表)` 元组。Ruff 把这个列表折成了多行。
- `("有金额的", all_amounts),` 第一组。
- `("退款的", refund_amounts),` 第二组。
- `("没有的", []),` 第三组:空列表,用来测 `stats` 的防空分支。
- `count, total, biggest, mid = stats(amounts)` 一次解包四个返回值。
- `print(` 这条 `print` 被折行了。
- `f"{name}:{count} 张,合计 {total // 100} 元,最大 {biggest // 100} 元,中位数 {mid // 100} 元"` 分换成元。

</div>

```text
$ uv run python part01/ex28_4_stats.py
有金额的:5 张,合计 1713 元,最大 598 元,中位数 299 元
退款的:4 张,合计 1664 元,最大 598 元,中位数 383 元
没有的:0 张,合计 0 元,最大 0 元,中位数 0 元
```

<div class="line-notes">

- `有金额的:5 张,合计 1713 元,最大 598 元,中位数 299 元` 29900 + 46800 + 29900 + 4900 + 59800 = 171300 分;5 项排序后正中间 29900。
- `退款的:4 张,合计 1664 元,最大 598 元,中位数 383 元` 4 项排序 `[29900, 29900, 46800, 59800]`,中间两个 29900 和 46800 的平均是 38350 分,即 383 元。
- `没有的:0 张,合计 0 元,最大 0 元,中位数 0 元` 空列表走了 `stats` 的提前 `return`,没有崩。

</div>

</details>

**验收标准:** `ticket_funcs.py` 的汇总数字和 Day 20 完全一致,并且你能不看文章写出 `clean`、`parse`、`classify`、`extract_fen` 四个函数;练习 2 先自己写出六行答案再核对;练习 3 能说清第二个坑为什么不报错;练习 4 的空列表分支能触发。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 函数(function) | 起了名字的一段代码,可以反复调用。Python 用 `def` 定义 |
| `def` | 定义函数的关键字,是一条语句,执行到它才把名字和函数绑起来 |
| 调用(call) | 名字后面加括号,函数体才运行。`greet()` 是调用,`greet` 只是函数本身 |
| 参数(parameter) | 定义时括号里的名字,函数体里当变量用。`def f(fen):` 里的 `fen` |
| 实参(argument) | 调用时括号里放进去的具体值。`f(29900)` 里的 `29900` |
| 位置参数 | 按位置一一对应的参数,第一个实参给第一个参数 |
| 返回值 | 函数交回给调用处的结果。用 `return` 写出来 |
| `return` | 交出结果并**立刻结束函数**,后面的代码不再执行 |
| `None` | 没有 `return` 时函数的结果,类型 `NoneType`,相当于 JS 的 `undefined` |
| 提前返回(early return) | 一道关卡一个 `return`,代替层层 `elif` |
| `key=` | `sorted` 的参数,传一个函数的名字(不加括号),按它交回的值来比大小 |

## 常见误区

**以为 `print` 就是交回结果。** `print` 只管显示,函数里只写 `print` 就得到 `None`。想拿结果去算、去拼、去存,要写 `return`。

**在循环里写 `return` 以为只结束这一轮。** `return` 结束的是整个函数。想跳过这一轮用 `continue`,想结束整个循环用 `break`;`return` 是连函数一起结束。

**`else` 里放 `return None` 当「没找到」。** `for` 循环里 `if 命中: return x` 加 `else: return None`,第一项不命中就整体返回了。「没找到」的 `return None` 要写在循环外面。

**忘了每条路径都要有 `return`。** `if` 分支里写了 `return`,别的分支没写,走到函数末尾就悄悄得到 `None`。

**在函数里偷偷改传进来的列表或字典。** 参数和实参是同一个东西(Day 21),`items.append(...)` 会改动外面的数据。要么明确写成「就地修改、不返回」,要么先 `sorted(...)` 或复制一份再动。

**调用写在 `def` 上面。** `NameError: name 'xxx' is not defined`。Python 没有 JS 那样的函数声明提升。

**给 `key=` 加括号。** `key=f()` 是现在就调用,没有传参数就 `TypeError`。要写 `key=f`。

**拿 `sum`、`max`、`list`、`len` 当变量名。** 之后再调用同名的自带函数就是 `TypeError: 'int' object is not callable`。累加器叫 `total`,列表叫 `items`。

**每个小功能都包一个函数。** 函数的价值是「用得不止一次」或「名字能让这一段话变得好读」。一行就说得清、只用一次的,不用包。

## 学习资料

### 文档与文章

- [Python 教程 · 定义函数](https://docs.python.org/zh-cn/3.12/tutorial/controlflow.html#defining-functions):中文,官方教程里 `def`、`return`、「没有 return 返回 None」的讲法,几页就读完。
- [Python 参考 · 函数定义](https://docs.python.org/zh-cn/3.12/reference/compound_stmts.html#function-definitions):中文,语言参考里的严格说法,第一句就是「函数定义是一条可执行语句」,对应今天的 `NameError` 那一节。
- [排序技术指南](https://docs.python.org/zh-cn/3.12/howto/sorting.html):中文,官方的排序教程,「key 函数」一节正是今天 `key=amount_then_id` 的来龙去脉。
- [MDN · 函数](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Guide/Functions):中文,JS 一侧对照,看函数声明提升、少传参数得 `undefined` 的那几段。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1oN4y1z75i&autoplay=0&high_quality=1" title="Python里的自定义函数到底是啥啊!-换一种玩法学Python第31期" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>编程派董董董老师 · Python里的自定义函数到底是啥啊!-换一种玩法学Python第31期 · 13 分钟,从零讲 `def`、参数、调用,和今天的前半部分对应。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1vognzcECg&autoplay=0&high_quality=1" title="【保姆级教程】Python 函数返回值的使用技巧与案例" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>水哥澎湃 · 【保姆级教程】Python 函数返回值的使用技巧与案例 · 13 分钟,2025 年的视频,专讲 `return`、没写 `return` 得 `None`、返回多个值,对应「return:把结果交出来」一节。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/9Os0o3wzS_I" title="Python Tutorial for Beginners 8: Functions" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Tutorial for Beginners 8: Functions · 英文,22 分钟,看前半段的 `def`、`return`、默认参数,后半段的 `*args` 留到 Day 30。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/KW6qncswzHw" title="Python Functions - Visually Explained" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Visually Explained · Python Functions - Visually Explained · 英文,14 分钟,用动画演示调用时跳进跳出函数体、参数传进去和返回值交回来的过程,对应今天第一张图。</figcaption>
</figure>

### 书籍

- Eric Matthes《Python Crash Course》第 3 版,No Starch Press,2023(中译《Python编程:从入门到实践》)。第 8 章「Functions」:参数、返回值、返回字典、传列表,和今天一一对应。
- Al Sweigart《Automate the Boring Stuff with Python》第 2 版,No Starch Press,2019。第 3 章「Functions」:`def`、`return`、`None` 值,网上有[免费的网页版](https://automatetheboringstuff.com/2e/chapter3/)。

### 开源项目与代码

- [Asabeneh/30-Days-Of-Python · Day 11 Functions](https://github.com/Asabeneh/30-Days-Of-Python/tree/master/11_Day_Functions):英文,里面的练习题可以用来多练几道,先做前面不带 `*args`、`lambda` 的部分。

## 自测

1. 「定义函数」和「调用函数」有什么区别?下面的脚本会打印什么?

```python
def say():
    print("你好")

print("开始")
```

<details><summary>答案</summary>

只打印 `开始`。`def say():` 只是把名字和函数体绑在一起,不运行它;要写 `say()` 才会调用并打印「你好」。

</details>

2. `x = show(5)`,函数 `show` 里只有一行 `print(n * 2)`,`x` 是什么?

<details><summary>答案</summary>

`None`。函数里没有 `return`,调用的结果就是 `None`;屏幕上会显示 10,但那是 `print` 干的,不是返回值。

</details>

3. 下面三个报错分别是哪种情况?

- `TypeError: f() missing 1 required positional argument: 'b'`
- `TypeError: f() takes 2 positional arguments but 3 were given`
- `NameError: name 'f' is not defined`

<details><summary>答案</summary>

第一个:调用时少传了一个参数(缺的叫 `b`);第二个:多传了一个;第三个:`f` 这个名字还不存在,常见原因是调用写在了 `def f` 的上面,或者名字拼错了。

</details>

4. `return a, b` 交回的是什么类型?调用的地方怎么接?

<details><summary>答案</summary>

一个元组 `(a, b)`。可以不解包拿到整个元组,也可以 `x, y = f()` 一次解包给两个名字(Day 22)。

</details>

5. `sorted(rows, key=f)` 和 `sorted(rows, key=f())` 的区别?

<details><summary>答案</summary>

`key=f` 把函数本身交给 `sorted`,它会对每一项调用一次 `f`,按返回值排序。`key=f()` 是现在就调用 `f`,没有给它参数就 `TypeError`;就算 `f` 不需要参数,传进去的也是它的返回值而不是函数。

</details>

6. **面试题**:Python 的函数如果没有写 `return`,返回什么?「print 一个值」和「return 一个值」在用法上有什么区别?

<details><summary>答案</summary>

没有 `return` 返回 `None`。`print` 是副作用,把文本输出到标准输出(给人看),函数的返回值不受影响;`return` 把值交回调用处,调用者可以继续计算、存储、传给别的函数。写工具函数时一般 `return` 数据,让调用者决定要不要 `print`,这样函数才好复用和测试;Agent 的「工具」同理,工具函数要把结果返回给 Agent 循环,而不是只打印。

</details>

## 明天预告

Day 29 · 函数(二):默认参数、关键字参数和可变默认值陷阱。今天的参数都是「必须传、按位置对应」的。你其实已经用过另一种:`split(maxsplit=3)`、`sorted(rows, reverse=True)`、`enumerate(x, start=1)`,这些都是「按名字传」的关键字参数,还有不传就用默认值的写法。明天你自己写出这样的函数,并撞一次 Python 最有名的坑:把 `[]` 当默认值,两个客户的对话串在了一起。
