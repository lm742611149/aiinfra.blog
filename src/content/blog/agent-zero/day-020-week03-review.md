---
title: 'Day 20 · 第 3 周复习:编程地基(Day 14–19)'
description: '这一周从布尔值和 None 学到 while 循环。今天不学新东西:画本周知识地图,默写三段核心代码(读金额问到对为止、循环分类、带退避的重试),只用本周知识做一个「工单日报」,最后把这一周撞过的报错整理成表,并用 5 张没见过的工单量出分类规则真正的准确率。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'review', 'agent-zero']
series: 'agent-zero'
day: 20
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 19](/blog/agent-zero/day-019-while-break/) 学了 `while`:条件成立就一直跑,忘了更新变量就是死循环,`Ctrl+C` 能停;`break` 跳出整个循环,`continue` 跳过这一轮;`while True` 加 `break` 写「问到输对为止」;重试要有上限、失败后要等一等、次数用完要有「放弃」分支;Agent 循环的玩具版里,`MAX_STEPS` 是保险。

这一周其实是在做一件事:让程序**自己做决定**。Day 14 到 16 教你把脏数据洗成能用的样子(转类型、切、拆、清洗),Day 17 让程序会判断,Day 18 和 19 让它会重复。六天加起来,你已经能写一个像样的、会校验输入、会跳过坏数据、会重试的脚本了。今天停一天,把这周串起来,确认每块都练扎实。

## 今天要解决的问题

学完今天,你应该能:

1. 合上文章默写三段:读金额问到对为止 `ask_money.py`(Day 14、16、17、19)、循环分类并数对错 `mini_classify.py`(Day 16–18)、用 `for` 写的带退避的重试 `retry_refund.py`(Day 18、19)。
2. 只用本周学过的东西做一个小项目 `part01/daily_report.py`:一份有空行、残缺行、全角字符、陌生类别的原始工单,清洗、跳过坏行并说明原因、分类并和人工标注对照、从描述里抠出金额、问审批线、给出结论,金额全程用整数分。
3. 看到本周出现过的每一句报错,不翻文章就能说出病因和改法;能说清为什么「在调规则的数据上全对」不等于「准」,并用没见过的数据量出真实水平。

预计用时:3 小时。默写三段各 20 分钟,小项目 1 小时,剩下做练习、自测、整理错题。

前置:[Day 14](/blog/agent-zero/day-014-bool-none/) 到 [Day 19](/blog/agent-zero/day-019-while-break/) 全部。今天不调任何 API,花费 0 元。

学法提示:先对照文章逐条敲一遍(代码自己敲,不复制粘贴)并对照输出;明天合上文章,把小项目 `daily_report.py` 从空文件开始默写(分类那条长长的 if/elif 链可以用 `category = "?"` 占位,只默写循环骨架和三道关卡);做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

和前几天一样,下面的输出是我 2026-10-23 在 2019 款 Intel MacBook Pro(macOS 14、zsh)上用一个演示家目录真跑的,家目录显示成 `/Users/你`,`~/agent-zero-lab` 接着 Day 19 的状态,`uv run python` 是 3.12.13,Ruff 是 0.17.2。要读键盘输入的脚本,我用管道喂输入、在伪终端里记录,看起来和你自己在终端里敲的一样。

## 本周知识地图

这一周的六天排成一条线:数据进来是字符串、是脏的,先转成对的类型(Day 14),再切出要的部分(Day 15、16),然后做判断(Day 17),最后重复做或者重复到成功为止(Day 18、19)。后一天都在用前一天的东西:没有 Day 16 的 `split`,Day 18 的批量分类拿不到类别;没有 Day 17 的 `if`,Day 19 的 `break` 没有触发的条件。

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="第 3 周知识地图:Day 14 布尔 None 转换 input;Day 15 索引切片 f-string;Day 16 字符串方法 编码;Day 17 if elif and or not;Day 18 for range enumerate;Day 19 while break continue 重试;最下面是今天的 daily_report 小项目把六天都用上">
<rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="8" y="22" fill="var(--ink-faint)">数据进来、变对、切开</text>
<text x="330" y="22" fill="var(--ink-faint)">判断、重复</text>
<rect x="8" y="34" width="96" height="104" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="16" y="56" fill="var(--ink)">Day 14</text>
<text x="16" y="76" fill="var(--ink-soft)">True/False</text>
<text x="16" y="94" fill="var(--ink-soft)">None is</text>
<text x="16" y="112" fill="var(--ink-soft)">int() float()</text>
<text x="16" y="130" fill="var(--ink-soft)">input()</text>
<rect x="112" y="34" width="96" height="104" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="120" y="56" fill="var(--ink)">Day 15</text>
<text x="120" y="76" fill="var(--ink-soft)">索引 [0] [-1]</text>
<text x="120" y="94" fill="var(--ink-soft)">切片 [a:b]</text>
<text x="120" y="112" fill="var(--ink-soft)">f-string</text>
<text x="120" y="130" fill="var(--ink-soft)">字符串不可变</text>
<rect x="216" y="34" width="96" height="104" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="224" y="56" fill="var(--ink)">Day 16</text>
<text x="224" y="76" fill="var(--ink-soft)">strip split</text>
<text x="224" y="94" fill="var(--ink-soft)">replace find</text>
<text x="224" y="112" fill="var(--ink-soft)">in join</text>
<text x="224" y="130" fill="var(--ink-soft)">UTF-8 NFKC</text>
<rect x="330" y="34" width="96" height="104" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="338" y="56" fill="var(--ink)">Day 17</text>
<text x="338" y="76" fill="var(--ink-soft)">if elif else</text>
<text x="338" y="94" fill="var(--ink-soft)">and or not</text>
<text x="338" y="112" fill="var(--ink-soft)">短路 真值</text>
<text x="338" y="130" fill="var(--ink-soft)">过拟合</text>
<rect x="434" y="34" width="96" height="104" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="442" y="56" fill="var(--ink)">Day 18</text>
<text x="442" y="76" fill="var(--ink-soft)">for ... in</text>
<text x="442" y="94" fill="var(--ink-soft)">range 累加器</text>
<text x="442" y="112" fill="var(--ink-soft)">enumerate</text>
<text x="442" y="130" fill="var(--ink-soft)">循环变量</text>
<rect x="538" y="34" width="94" height="104" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="546" y="56" fill="var(--ink)">Day 19</text>
<text x="546" y="76" fill="var(--ink-soft)">while</text>
<text x="546" y="94" fill="var(--ink-soft)">break continue</text>
<text x="546" y="112" fill="var(--ink-soft)">重试 退避</text>
<text x="546" y="130" fill="var(--ink-soft)">MAX_STEPS</text>
<line x1="104" y1="86" x2="112" y2="86" stroke="var(--ink-soft)"/>
<line x1="208" y1="86" x2="216" y2="86" stroke="var(--ink-soft)"/>
<line x1="312" y1="86" x2="330" y2="86" stroke="var(--ink-soft)"/>
<line x1="426" y1="86" x2="434" y2="86" stroke="var(--ink-soft)"/>
<line x1="530" y1="86" x2="538" y2="86" stroke="var(--ink-soft)"/>
<rect x="8" y="164" width="624" height="84" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="20" y="188" fill="var(--ink)">Day 20 小项目 daily_report.py</text>
<text x="20" y="208" fill="var(--ink-soft)">清洗(14 16) → 跳过坏行(17 19 continue) → 分类(17) → 循环数对错(18)</text>
<text x="20" y="228" fill="var(--ink-soft)">→ 抠金额(16 19) → 问审批线 while True(19) → 结论 if(17)</text>
<line x1="320" y1="138" x2="320" y2="164" stroke="var(--ink-soft)"/>
<text x="8" y="276" fill="var(--ink)">贯穿全周的一件事:输入永远是脏的字符串,先清洗再判断</text>
<text x="8" y="298" fill="var(--ink-faint)">本周超过一半的坑「不报错、结果悄悄错」:9/9 过拟合、or "b" 永远真、累加器放进循环</text>
<text x="8" y="318" fill="var(--ink-faint)">看到结果对,先问「我拿什么验证的」</text>
</g>
</svg>
<figcaption>第 3 周知识地图。琥珀色三天处理数据,蓝色三天做判断和重复;今天的小项目把六天都用上。</figcaption>
</figure>

地图底下那句是我觉得这周最值得带走的。上周的坑大多是「你以为在用 A,其实在用 B」,会报错,逼你停下来看。这周的坑反过来:程序不报错、也跑完了,**结果却是错的**。`x == "a" or "b"` 永远为真;`total = 0` 写进循环里只剩最后一笔;`classify2.py` 在 9 张工单上全对,碰到第 10 张就翻车。这种错最难发现,因为每一步看起来都对。养成一个习惯:程序打印出结果,先问「我拿什么验证它」,有没有一组它没见过的数据、一个手算的答案、一个边界值。

## 本周每天一句话

- [Day 14](/blog/agent-zero/day-014-bool-none/):`True`/`False` 首字母大写,`==` 不转类型(`1 == "1"` 是 `False`);`None` 是唯一的「空」,判断用 `is None`;`int()` 只砍小数不四舍五入,`int("19.99")` 会报错;`input()` 读进来永远是字符串,算之前先转换。
- [Day 15](/blog/agent-zero/day-015-strings-1/):字符串的编号从 0 开始,`-1` 是最后一个;切片 `s[a:b]` 左闭右开、越界不报错;字符串不可变;f-string 里 `:.2f`、`:,` 排金额。
- [Day 16](/blog/agent-zero/day-016-strings-2/):`strip`、`removesuffix`、`replace`、`split`、`join`、`in`、`find` 都返回新字符串、不改原来的;`split()` 不带参数按任意空白拆,`"".split(",")` 是 `['']`;汉字 UTF-8 占 3 字节;全角字符先过 `unicodedata.normalize("NFKC", ...)`。
- [Day 17](/blog/agent-zero/day-017-if-else/):`if`/`elif`/`else` 用冒号加缩进,从上到下碰到第一个成立的就停,顺序写错整条链失效;`and`/`or` 返回的是某个值本身,有短路;`x == "a" or "b"` 永远为真;关键词规则 9/9 是看着答案调出来的。
- [Day 18](/blog/agent-zero/day-018-for-range/):Python 的 `for x in 一批` 对应 JS 的 `for...of`;`range` 起点包含、终点不包含;累加器在循环外设初值;`enumerate` 同时给编号和内容;循环变量出了循环还活着,一次都没跑的循环后面用它是 `NameError`。
- [Day 19](/blog/agent-zero/day-019-while-break/):`while` 用在次数事先不知道的场合,忘了更新变量就是死循环,`Ctrl+C` 能停;`break` 跳出循环,`continue` 跳过这一轮;`while True` 加 `break` 代替 `do...while`;重试要有上限、要等、次数用完要有放弃分支;Agent 循环靠 `MAX_STEPS` 兜底。

## 默写一:读金额,问到对为止

合上文章,写一个 `part01/ask_money.py`:最多给 3 次机会读一个金额。每次先清洗(过一遍 `NFKC`、去两头空白、去掉开头的 `¥` 和结尾的「元」、去掉千分位逗号),再检查是不是合法的数字(整数或带一个小数点),合法就换算成整数分并停止;三次都不合法就放弃。这一段用到 Day 14(`None`、`round`)、Day 16(清洗)、Day 17(`isdigit`)、Day 18(`for` 加 `range`)、Day 19(`break`)。

```python
# agent-zero-lab/part01/ask_money.py
import unicodedata

MAX_TRIES = 3

fen = None
for attempt in range(1, MAX_TRIES + 1):
    text = unicodedata.normalize(
        "NFKC", input(f"金额(元),第 {attempt} 次机会:")
    ).strip()
    text = text.removeprefix("¥").removesuffix("元").strip().replace(",", "")
    if text.replace(".", "", 1).isdigit():
        fen = round(float(text) * 100)
        break
    print(f"「{text}」不是金额")

if fen is None:
    print("三次都没输对,放弃")
else:
    print(f"记录:{fen} 分({fen / 100:,.2f} 元)")
```

<div class="line-notes">

- `import unicodedata` Day 16 的标准库模块,用它的 `normalize` 把全角字符变半角。
- `MAX_TRIES = 3` 最多 3 次,常量全大写(Day 19)。
- `fen = None` 「还没有金额」。用 `None` 而不是 0,因为 0 元也是合法金额,不能混(Day 14)。
- `for attempt in range(1, MAX_TRIES + 1):` 次数有上限,开跑前就知道最多 3 轮,所以用 `for` 加 `range`。终点写 `MAX_TRIES + 1`,`attempt` 才是 1、2、3(Day 18 的终点不包含)。
- `text = unicodedata.normalize(` 这一行被 `ruff format` 折成了三行,拼起来是一句话:先 `normalize`,最后再 `.strip()`。`normalize` 把 `１２３４．５０` 这样的全角变成 `1234.50`。
- `"NFKC", input(f"金额(元),第 {attempt} 次机会:")` 括号里的两个参数:第一个是规范化形式 `"NFKC"`,第二个是 `input(...)` 读进来的那一行。提示里带着第几次机会。
- `).strip()` 括号收尾,对 `normalize` 的结果再 `strip` 去两头空白。
- `text = text.removeprefix("¥").removesuffix("元").strip().replace(",", "")` 连着清洗:去掉开头的 `¥`,去掉末尾的「元」,再去空白,最后去掉千分位逗号。输入 `¥1,234.50元` 得到 `1234.50`。
- `if text.replace(".", "", 1).isdigit():` 校验:去掉一个小数点之后,剩下的全是数字吗?`"1234.50"` 去掉点是 `"123450"`,是。`"abc"` 不是。`replace` 的第三个参数 1 表示只换一次(Day 17 的 `refund_rule.py` 同款写法)。
- `fen = round(float(text) * 100)` 元换成整数分。`1234.50 * 100` 用 `round` 取整(Day 14 的教训:不要用 `int`)。
- `break` 合法就停,不用再问。
- `print(f"「{text}」不是金额")` 不合法才走到这里,提示一下,进入下一轮。
- `if fen is None:` 三轮都没 `break`,`fen` 还是 `None`。用 `is None` 判断(Day 14)。
- `print("三次都没输对,放弃")` 放弃分支。
- `else:` 拿到了金额。
- `print(f"记录:{fen} 分({fen / 100:,.2f} 元)")` 分和元都打印,元只在显示的这一刻用除法。

</div>

```text
$ uv run python part01/ask_money.py
金额(元),第 1 次机会:abc
「abc」不是金额
金额(元),第 2 次机会:¥1,234.50元
记录:123450 分(1,234.50 元)
$ uv run python part01/ask_money.py
金额(元),第 1 次机会:x
「x」不是金额
金额(元),第 2 次机会:y
「y」不是金额
金额(元),第 3 次机会:z
「z」不是金额
三次都没输对,放弃
$ uv run python part01/ask_money.py
金额(元),第 1 次机会:１２３４．５０元
记录:123450 分(1,234.50 元)
```

<div class="line-notes">

- `金额(元),第 1 次机会:abc` 第一组:第 1 次输 `abc`。
- `「abc」不是金额` 清洗后还是 `abc`,`isdigit` 为假,提示,进入第 2 轮。
- `金额(元),第 2 次机会:¥1,234.50元` 第 2 次输带符号带逗号的金额。
- `记录:123450 分(1,234.50 元)` 清洗得 `1234.50`,`round(1234.5 * 100)` 是 123450 分,`break`。
- `金额(元),第 3 次机会:z` 第二组:三次都输错。
- `三次都没输对,放弃` 三轮用完,`fen` 仍是 `None`。
- `金额(元),第 1 次机会:１２３４．５０元` 第三组:全角数字和全角句点。
- `记录:123450 分(1,234.50 元)` `NFKC` 把全角变成半角,结果和第一组一样,一次就过。

</div>

默写时容易卡在三处:`normalize` 要放在 `input` 的外面一层;`range(1, MAX_TRIES + 1)` 终点要加 1;`fen` 初值是 `None` 不是 0。卡住就回 Day 16(清洗)、Day 18(`range`)、Day 14(`None`)各看一眼。

## 默写二:循环分类并数对错

合上文章写 `part01/mini_classify.py`:6 张短工单,用 3 条简单规则给每张分类,和人工标注对照,答错的打印出来,最后打印「对了几张」。这一段是 Day 16(`split`、`lower`)、Day 17(`if`/`elif`)、Day 18(`for`、`enumerate`、累加器)的组合。

```python
# agent-zero-lab/part01/mini_classify.py
tickets = [
    "T001 计费 扣了两次",
    "T002 登录 验证码收不到",
    "T003 功能 导出PDF乱码",
    "T004 计费 发票金额不对",
    "T005 登录 Forgot password",
    "T006 计费 想改年付",
]

correct = 0
for no, line in enumerate(tickets, start=1):
    parts = line.split(maxsplit=2)
    human = parts[1]
    text = parts[2].lower()

    if "导出" in text or "pdf" in text:
        category = "功能"
    elif "扣" in text or "发票" in text or "金额" in text:
        category = "计费"
    elif "验证码" in text or "password" in text:
        category = "登录"
    else:
        category = "功能"

    if category == human:
        correct += 1
    else:
        print(f"{no}. {parts[0]} 人工={human} 规则={category}")

print(f"对了 {correct}/{len(tickets)}")
```

<div class="line-notes">

- `tickets = [` 6 张短工单。每行是「工单号 人工类别 描述」,没有客户号。
- `"T006 计费 想改年付",` 最后一张故意放一个规则里没有的关键词「年付」。
- `correct = 0` 累加器,循环外设 0。
- `for no, line in enumerate(tickets, start=1):` 取出行号和整行。
- `parts = line.split(maxsplit=2)` 这次只有三段,最多拆成 3 段,第 3 段是完整描述。
- `human = parts[1]` 人工类别。
- `text = parts[2].lower()` 描述转小写,`PDF` 变 `pdf`,`Forgot password` 变 `forgot password`。
- `if "导出" in text or "pdf" in text:` 功能词放在最前面先判断(Day 17 的顺序教训)。
- `category = "功能"` 命中功能。
- `elif "扣" in text or "发票" in text or "金额" in text:` 计费词。
- `category = "计费"` 命中计费。
- `elif "验证码" in text or "password" in text:` 登录词。
- `category = "登录"` 命中登录。
- `else:` 都没命中。
- `category = "功能"` 默认功能。
- `if category == human:` 对了吗?
- `correct += 1` 对了,计数器加 1。
- `else:` 错了。
- `print(f"{no}. {parts[0]} 人工={human} 规则={category}")` 只打印错的,用 `parts[0]` 取工单号。
- `print(f"对了 {correct}/{len(tickets)}")` 缩进回到最左边,循环结束后打印总成绩。

</div>

```text
$ uv run python part01/mini_classify.py
6. T006 人工=计费 规则=功能
对了 5/6
```

<div class="line-notes">

- `6. T006 人工=计费 规则=功能` 只有 T006 错了:「想改年付」里没有任何计费关键词,掉进默认的功能。其余 5 张都对。
- `对了 5/6` 5 张对,总数是 6。

</div>

这和 Day 17、18 的规律一样:规则的漏洞永远出在「没覆盖到的说法」上。T006 补一个「年付」就对了,但补完之后,下一个没见过的说法还会漏。

## 默写三:用 for 写的重试

合上文章写 `part01/retry_refund.py`:调用退款接口,最多 4 次,失败后等一会再试,等待时间翻倍(0.5 秒、1 秒、2 秒),第几次成功由输入决定。和 Day 19 的 `retry_backoff.py` 对比,这次用 `for` 写:**次数有上限的重试,用 `for` 加 `range` 比 `while` 更省事**,不用自己管 `attempt += 1`。

```python
# agent-zero-lab/part01/retry_refund.py
import time

MAX_TRIES = 4
succeed_on = int(input("假装第几次成功(1 到 6):"))

wait = 0.5
success = False
for attempt in range(1, MAX_TRIES + 1):
    print(f"第 {attempt} 次调用退款接口……", end=" ")
    if attempt == succeed_on:
        print("成功")
        success = True
        break
    if attempt < MAX_TRIES:
        print(f"失败,等 {wait} 秒")
        time.sleep(wait)
        wait *= 2
    else:
        print("失败")

print("退款已提交" if success else f"{MAX_TRIES} 次都失败,转人工处理")
```

<div class="line-notes">

- `import time` 为了 `time.sleep`。
- `MAX_TRIES = 4` 最多 4 次。
- `succeed_on = int(input("假装第几次成功(1 到 6):"))` 输入几就假装第几次成功,输 6 就是 4 次内不会成功。
- `wait = 0.5` 第一次失败后等 0.5 秒。
- `success = False` 标志变量。
- `for attempt in range(1, MAX_TRIES + 1):` 一共 4 轮,`attempt` 是 1、2、3、4。不用 `while`,计数器 `for` 自己管。
- `print(f"第 {attempt} 次调用退款接口……", end=" ")` 不换行,后面接结果。
- `if attempt == succeed_on:` 这次成功吗?
- `print("成功")` 成功。
- `success = True` 记下。
- `break` 跳出。
- `if attempt < MAX_TRIES:` 失败了,还会再试吗?前 3 次是,第 4 次不是。
- `print(f"失败,等 {wait} 秒")` 提示等多久。
- `time.sleep(wait)` 真的等。
- `wait *= 2` 翻倍:0.5 → 1.0 → 2.0。
- `else:` 第 4 次也失败。
- `print("失败")` 只打印失败,不再等。
- `print("退款已提交" if success else f"{MAX_TRIES} 次都失败,转人工处理")` 条件表达式(Day 17)一行选出结论。

</div>

```text
$ uv run python part01/retry_refund.py
假装第几次成功(1 到 6):3
第 1 次调用退款接口…… 失败,等 0.5 秒
第 2 次调用退款接口…… 失败,等 1.0 秒
第 3 次调用退款接口…… 成功
退款已提交
$ uv run python part01/retry_refund.py
假装第几次成功(1 到 6):6
第 1 次调用退款接口…… 失败,等 0.5 秒
第 2 次调用退款接口…… 失败,等 1.0 秒
第 3 次调用退款接口…… 失败,等 2.0 秒
第 4 次调用退款接口…… 失败
4 次都失败,转人工处理
```

<div class="line-notes">

- `假装第几次成功(1 到 6):3` 第一组,第 3 次成功。
- `第 1 次调用退款接口…… 失败,等 0.5 秒` 第 1 次失败,等 0.5 秒。
- `第 2 次调用退款接口…… 失败,等 1.0 秒` 第 2 次失败,`wait` 已经翻倍成 1.0。
- `第 3 次调用退款接口…… 成功` 第 3 次成功,`break`,没有再等。
- `退款已提交` `success` 为真,走第一个结论。
- `假装第几次成功(1 到 6):6` 第二组,4 次内都不成功。
- `第 3 次调用退款接口…… 失败,等 2.0 秒` 第 3 次失败后等 2.0 秒。
- `第 4 次调用退款接口…… 失败` 最后一次失败,不再等。
- `4 次都失败,转人工处理` 放弃分支,结论里写明下一步是「转人工」,不是悄悄结束。

</div>

默写时先想「几种出口」:第几次成功(`break`)、次数用完(放弃)。两种出口各跑一次,就是上面两组输入。

## 小项目:工单日报 daily_report

假设你是云簿 CloudLedger 的客服组长,每天下班前拿到一份客服系统导出的原始工单文本,想一眼看到:这一批有多少张有效、分类规则对了几张、各类各几张、工单里提到的金额合计多少、要不要组长审批。原始文本是人敲的,所以有空行、残缺行、全角字符、不认识的类别。

要求只用这一周学过的东西:

1. 每一行先过一遍 `NFKC`、去两头空白(Day 16)。
2. 三种坏行要**说明原因**再跳过:空行、段数不够、类别不是「计费/登录/功能」(Day 17、19 的 `continue`)。
3. 好行用 Day 17 的 `classify2.py` 规则分类,和人工类别对照,用累加器数对几张、各类几张(Day 18)。
4. 规则判成计费的工单,从描述里抠出「N元」前面的数字,累加成整数分(Day 15 切片、Day 16 `find`、Day 19 `while`)。
5. 循环结束后打印日报,再问「组长审批线」(问到输入合法整数为止,Day 19),给出结论(Day 17)。

### 第一步:抠金额,先撞一个错

最陌生的一步是从「8月2日重复扣款299元」里抠出 299。思路:找到「元」的位置,从那里往前一个字符一个字符退,只要前一个字符是数字就继续退,退到不是数字的地方为止,中间那一段就是金额。我第一次这么写:

```python
# agent-zero-lab/part01/amount_v1.py
descs = ["8月2日重复扣款299元", "验证码收不到", "多收了49元"]

for desc in descs:
    pos = desc.find("元")
    start = pos
    while start > 0 and desc[start - 1].isdigit():
        start -= 1
    amount = int(desc[start:pos])
    print(desc, "->", amount)
```

<div class="line-notes">

- `descs = ["8月2日重复扣款299元", "验证码收不到", "多收了49元"]` 三条描述:有金额(而且前面还有别的数字 `8` 和 `2`)、没有金额、有金额。
- `for desc in descs:` 一条一条取。
- `pos = desc.find("元")` 「元」的下标。第一条里「元」的下标是 11(它前面有 `8`、`月`、`2`、`日`、`重`、`复`、`扣`、`款`、`2`、`9`、`9` 共 11 个字符)。第二条没有「元」,`find` 返回 `-1`(Day 16)。
- `start = pos` 从「元」的位置开始往前退。
- `while start > 0 and desc[start - 1].isdigit():` 还没退到开头,并且前一个字符是数字,就继续退。`and` 的短路(Day 17)保证 `start` 是 0 时不会去取 `desc[-1]`。
- `start -= 1` 退一格。
- `amount = int(desc[start:pos])` 切出 `start` 到 `pos` 之间那一段,转成整数(Day 15 的切片,Day 14 的 `int`)。
- `print(desc, "->", amount)` 打印描述和抠出的金额。

</div>

```text
$ uv run python part01/amount_v1.py
8月2日重复扣款299元 -> 299
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/amount_v1.py", line 9, in <module>
    amount = int(desc[start:pos])
             ^^^^^^^^^^^^^^^^^^^^
ValueError: invalid literal for int() with base 10: ''
```

<div class="line-notes">

- `8月2日重复扣款299元 -> 299` 第一条对了:从「元」往前退过 `9`、`9`、`2`,遇到「款」停,切出 `299`。前面的 `8月2日` 里的数字被「重复扣款」隔开,没被误抠。
- `File "/Users/你/agent-zero-lab/part01/amount_v1.py", line 9, in <module>` 第二条崩了,第 9 行。
- `amount = int(desc[start:pos])` 崩在这一行。
- `ValueError: invalid literal for int() with base 10: ''` 要转成整数的是空字符串。第二条没有「元」,`pos` 是 `-1`,`start` 也是 `-1`,`while` 条件 `start > 0` 不成立,`desc[-1:-1]` 是空字符串(Day 15:切片越界不报错,得到空),`int("")` 就崩了。这条报错在 Day 14 见过。

</div>

病根有两层:`find` 返回 `-1` 我没处理(Day 16 的误区「拿 find 的结果直接切片」),以及「元」前面不一定是数字,切出来可能是空。修法是两道关卡,每一道不通过就 `continue`。`part01/amount_v2.py`:

```python
# agent-zero-lab/part01/amount_v2.py
descs = ["8月2日重复扣款299元", "验证码收不到", "多收了49元"]

for desc in descs:
    pos = desc.find("元")
    if pos == -1:
        print(desc, "-> 没有金额")
        continue

    start = pos
    while start > 0 and desc[start - 1].isdigit():
        start -= 1
    amount_text = desc[start:pos]
    if amount_text == "":
        print(desc, "-> 元字前面不是数字")
        continue
    print(desc, "->", int(amount_text))
```

<div class="line-notes">

- `descs = ["8月2日重复扣款299元", "验证码收不到", "多收了49元"]` 同样三条。
- `for desc in descs:` 逐条取。
- `pos = desc.find("元")` 找「元」。
- `if pos == -1:` 第一道关卡:没有「元」。
- `print(desc, "-> 没有金额")` 说明原因。
- `continue` 这一条不用再往下算,直接下一条。
- `start = pos` 能走到这里,说明有「元」。
- `while start > 0 and desc[start - 1].isdigit():` 同上,往前退。
- `start -= 1` 退一格。
- `amount_text = desc[start:pos]` 先存成字符串,不急着转整数。
- `if amount_text == "":` 第二道关卡:「元」前面一个数字都没有(比如「人民币元」),切出来是空。
- `print(desc, "-> 元字前面不是数字")` 说明原因。
- `continue` 跳过。
- `print(desc, "->", int(amount_text))` 两道关卡都过了,才转整数并打印。

</div>

```text
$ uv run python part01/amount_v2.py
8月2日重复扣款299元 -> 299
验证码收不到 -> 没有金额
多收了49元 -> 49
```

<div class="line-notes">

- `8月2日重复扣款299元 -> 299` 第一条不变。
- `验证码收不到 -> 没有金额` 第二条被第一道关卡拦住,不再崩。
- `多收了49元 -> 49` 第三条抠出 49。

</div>

这就是「卫语句」:每个会出事的地方先挡一道,剩下的代码可以放心假设条件成立。

### 第二步:拼成日报

把前面所有零件放进一个循环:清洗、三道坏行关卡、分类、计数、抠金额,循环结束后打印日报,再问审批线。新建 `part01/daily_report.py`:

```python
# agent-zero-lab/part01/daily_report.py
import unicodedata

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
billing = 0
login = 0
feature = 0
mentioned_fen = 0

for no, raw in enumerate(raw_lines, start=1):
    line = unicodedata.normalize("NFKC", raw).strip()
    if line == "":
        print(f"第 {no:2} 行:空行,跳过")
        skipped += 1
        continue

    parts = line.split(maxsplit=3)
    if len(parts) < 4:
        print(f"第 {no:2} 行:只有 {len(parts)} 段,跳过「{line}」")
        skipped += 1
        continue

    ticket_id = parts[0]
    human = parts[1]
    desc = parts[3]
    if human not in ("计费", "登录", "功能"):
        print(f"第 {no:2} 行:{ticket_id} 的类别「{human}」不认识,跳过")
        skipped += 1
        continue

    text = desc.lower()
    if "导出" in text or "抬头" in text or "pdf" in text or "方框" in text:
        category = "功能"
    elif (
        "扣" in text
        or "退款" in text
        or "发票" in text
        or "金额" in text
        or "月付" in text
        or "年付" in text
        or "refund" in text
        or "charge" in text
    ):
        category = "计费"
    elif "登录" in text or "验证码" in text or "密码" in text or "password" in text:
        category = "登录"
    else:
        category = "功能"

    good += 1
    if category == human:
        correct += 1
    if category == "计费":
        billing += 1
    elif category == "登录":
        login += 1
    else:
        feature += 1

    amount = 0
    pos = desc.find("元")
    if category == "计费" and pos != -1:
        start = pos
        while start > 0 and desc[start - 1].isdigit():
            start -= 1
        if start < pos:
            amount = int(desc[start:pos])
            mentioned_fen += amount * 100

    mark = "对" if category == human else "错"
    print(f"第 {no:2} 行:{ticket_id} 人工={human} 规则={category} {mark} 金额={amount}")

print("--- 日报 ---")
print(f"共 {len(raw_lines)} 行,有效 {good} 行,跳过 {skipped} 行")
print(f"规则分对 {correct}/{good}")
print(f"规则分类:计费 {billing} / 登录 {login} / 功能 {feature}")
print(f"工单里提到的金额合计:{mentioned_fen / 100:,.2f} 元")

while True:
    threshold_text = input("组长审批线(元,整数):").strip()
    if threshold_text.isdigit():
        break
    print(f"「{threshold_text}」不是整数")
threshold_fen = int(threshold_text) * 100

if mentioned_fen >= threshold_fen:
    print("合计达到审批线,需要组长审批")
else:
    print("合计没到审批线,一线可以批")
```

<div class="line-notes">

- `import unicodedata` 清洗全角字符要用。
- `raw_lines = [` 12 行原始文本,我故意混进了各种坏法。
- `"  T102 登录 C007 验证码收不到 ",` 两头有空格,`strip` 能洗掉。
- `"",` 空行。
- `"T105 计费",` 残缺行,只有两段。
- `"Ｔ106 计费 C042 发票金额对不上,多收了49元",` 开头的 `Ｔ` 是全角字母。不清洗的话,`Ｔ106` 和别的 `T` 开头的号对不上。
- `"T109 其他 C099 随便问问",` 类别是「其他」,不在三类里。
- `"   ",` 全空格,`strip` 之后是空。
- `good = 0` 以下六个都是累加器,全在循环外设 0。有效行数。
- `skipped = 0` 跳过的行数。
- `correct = 0` 规则分对几张。
- `billing = 0` 规则判成计费的张数。
- `login = 0` 规则判成登录的张数。
- `feature = 0` 规则判成功能的张数。
- `mentioned_fen = 0` 工单里提到的金额合计,单位分(整数)。
- `for no, raw in enumerate(raw_lines, start=1):` 一行一行取,`no` 是行号。
- `line = unicodedata.normalize("NFKC", raw).strip()` 清洗:全角变半角,再去两头空白。`Ｔ106` 在这里变成 `T106`。
- `if line == "":` 第一道关卡:空行。
- `print(f"第 {no:2} 行:空行,跳过")` 说明原因。
- `skipped += 1` 跳过的计数加 1。
- `continue` 回循环头,这一行后面的都不用做了。
- `parts = line.split(maxsplit=3)` 到这里 `line` 一定非空。拆成最多 4 段。
- `if len(parts) < 4:` 第二道关卡:段数不够。
- `print(f"第 {no:2} 行:只有 {len(parts)} 段,跳过「{line}」")` 说明有几段、原文是什么。
- `ticket_id = parts[0]` 工单号。
- `human = parts[1]` 人工类别。
- `desc = parts[3]` 描述,完整保留。
- `if human not in ("计费", "登录", "功能"):` 第三道关卡:类别不认识。`not in` 是 `in` 的反面(Day 17 的 `in ("a", "b")`)。
- `print(f"第 {no:2} 行:{ticket_id} 的类别「{human}」不认识,跳过")` 说明哪一张、什么类别。
- `text = desc.lower()` 通过三道关卡的行才分类。描述转小写。
- `if "导出" in text or "抬头" in text or "pdf" in text or "方框" in text:` Day 17 `classify2.py` 的整条规则链,原样搬进来。功能词在最前面。
- `elif (` 计费词。
- `elif "登录" in text or "验证码" in text or "密码" in text or "password" in text:` 登录词。
- `else:` 默认功能。
- `good += 1` 通过三道关卡才算有效行。
- `if category == human:` 规则和人工一致吗?
- `correct += 1` 是,对了一张。
- `if category == "计费":` 按**规则**判出的类别分别计数。
- `billing += 1` 计费加 1。
- `elif category == "登录":` 登录。
- `login += 1` 登录加 1。
- `else:` 其余是功能。
- `feature += 1` 功能加 1。
- `amount = 0` 这一行的金额默认是 0。
- `pos = desc.find("元")` 找「元」,和 `amount_v2.py` 一样。
- `if category == "计费" and pos != -1:` 只对规则判成计费、并且有「元」的行抠金额。两个条件缺一不可,第二个条件挡住了 `find` 的 `-1`。
- `while start > 0 and desc[start - 1].isdigit():` 往前退。
- `if start < pos:` 「元」前面至少有一个数字,切出来才不是空,这是 `amount_v2.py` 里第二道关卡的另一种写法。
- `amount = int(desc[start:pos])` 切出来转整数。
- `mentioned_fen += amount * 100` 元换成分,累加。
- `mark = "对" if category == human else "错"` 条件表达式,选出「对」或「错」。
- `print(f"第 {no:2} 行:{ticket_id} 人工={human} 规则={category} {mark} 金额={amount}")` 每个有效行一条明细。
- `print("--- 日报 ---")` 缩进回到最左边,循环全部结束后。
- `print(f"共 {len(raw_lines)} 行,有效 {good} 行,跳过 {skipped} 行")` 汇总。12 = 8 + 4。
- `print(f"规则分对 {correct}/{good}")` 成绩,分母是有效行数,不是总行数。
- `print(f"规则分类:计费 {billing} / 登录 {login} / 功能 {feature}")` 各类各几张。
- `print(f"工单里提到的金额合计:{mentioned_fen / 100:,.2f} 元")` 分变回元,只在显示的这一刻。
- `while True:` 问审批线,问到合法为止(Day 19)。
- `threshold_text = input("组长审批线(元,整数):").strip()` 读一行去空白。
- `if threshold_text.isdigit():` 合法整数吗?
- `break` 合法就停。
- `print(f"「{threshold_text}」不是整数")` 不合法就提示,再问。
- `threshold_fen = int(threshold_text) * 100` 循环外,已经确定合法,转整数再换成分。
- `if mentioned_fen >= threshold_fen:` 合计达到审批线吗?`>=` 含等号:刚好等于也要审批。
- `print("合计达到审批线,需要组长审批")` 结论一。
- `else:` 没到。
- `print("合计没到审批线,一线可以批")` 结论二。

</div>

```text
$ uv run python part01/daily_report.py
第  1 行:T101 人工=计费 规则=计费 对 金额=299
第  2 行:T102 人工=登录 规则=登录 对 金额=0
第  3 行:空行,跳过
第  4 行:T103 人工=计费 规则=计费 对 金额=468
第  5 行:T104 人工=功能 规则=功能 对 金额=0
第  6 行:只有 2 段,跳过「T105 计费」
第  7 行:T106 人工=计费 规则=计费 对 金额=49
第  8 行:T107 人工=登录 规则=登录 对 金额=0
第  9 行:T108 人工=计费 规则=功能 错 金额=0
第 10 行:T109 的类别「其他」不认识,跳过
第 11 行:T110 人工=计费 规则=计费 对 金额=598
第 12 行:空行,跳过
--- 日报 ---
共 12 行,有效 8 行,跳过 4 行
规则分对 7/8
规则分类:计费 4 / 登录 2 / 功能 2
工单里提到的金额合计:1,414.00 元
组长审批线(元,整数):五百
「五百」不是整数
组长审批线(元,整数):500
合计达到审批线,需要组长审批
```

<div class="line-notes">

- `第  1 行:T101 人工=计费 规则=计费 对 金额=299` 第 1 行,没有触发任何 `continue`,一路走到明细。「重复扣款」里的「扣」命中计费,金额 299。
- `第  2 行:T102 人工=登录 规则=登录 对 金额=0` 第 2 行两头空格被洗掉,分成登录。不是计费,金额保持 0。
- `第  3 行:空行,跳过` 第一道关卡。
- `第  4 行:T103 人工=计费 规则=计费 对 金额=468` 「年付多扣了 468 元」,从「元」往前退过 `8`、`6`、`4`,遇到「了」停,金额 468。
- `第  5 行:T104 人工=功能 规则=功能 对 金额=0` 「导出PDF乱码」命中功能。
- `第  6 行:只有 2 段,跳过「T105 计费」` 第二道关卡。
- `第  7 行:T106 人工=计费 规则=计费 对 金额=49` 全角的 `Ｔ106` 被洗成了 `T106`,金额 49。
- `第  8 行:T107 人工=登录 规则=登录 对 金额=0` 英文的 `Forgot password`,转小写后命中。
- `第  9 行:T108 人工=计费 规则=功能 错 金额=0` 唯一错的一张:「我想要发票PDF」被 `pdf` 抢先判成功能。这是 Day 18 里 T010 的同一个坑,换了个说法又出现一次。
- `第 10 行:T109 的类别「其他」不认识,跳过` 第三道关卡。
- `第 11 行:T110 人工=计费 规则=计费 对 金额=598` 「共598元」,抠出 598。
- `第 12 行:空行,跳过` 全空格的一行,先 `strip` 变成空串,走第一道关卡。
- `共 12 行,有效 8 行,跳过 4 行` 第 3、6、10、12 行被跳过,4 行,8 + 4 = 12。
- `规则分对 7/8` 8 个有效行里对了 7 张,错的是第 9 行。
- `规则分类:计费 4 / 登录 2 / 功能 2` 按规则结果数:计费是 T101、T103、T106、T110,登录 T102、T107,功能 T104 和被判错的 T108。
- `工单里提到的金额合计:1,414.00 元` 299 + 468 + 49 + 598 = 1414,换算成 141400 分。
- `组长审批线(元,整数):五百` 第一次我故意敲中文数字。
- `「五百」不是整数` 没通过校验,不 `break`,再问。
- `组长审批线(元,整数):500` 第二次敲对。
- `合计达到审批线,需要组长审批` 1414 元 ≥ 500 元。

</div>

这个流程画出来是下面这样。每一道关卡都是一个 `continue`,不合格的行从旁边「掉出去」,只有合格的往下走:

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="daily_report 的流水线:原始行先清洗,然后依次过三道关卡(空行、段数不够、类别不认识),每道不通过就记一次跳过并 continue;通过的行进入分类、对照人工类别、按规则分类计数、抠金额,最后循环结束打印日报并问审批线">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="8" y="60" width="86" height="44" rx="5" fill="var(--paper)" stroke="var(--rule)"/>
<text x="16" y="80" fill="var(--ink)">原始一行</text>
<text x="16" y="96" fill="var(--ink-faint)">raw</text>
<line x1="94" y1="82" x2="108" y2="82" stroke="var(--ink-soft)"/>
<rect x="108" y="60" width="86" height="44" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="116" y="80" fill="var(--ink)">清洗</text>
<text x="116" y="96" fill="var(--ink-faint)">NFKC strip</text>
<line x1="194" y1="82" x2="208" y2="82" stroke="var(--ink-soft)"/>
<rect x="208" y="60" width="86" height="44" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="216" y="80" fill="var(--ink)">关卡 1</text>
<text x="216" y="96" fill="var(--ink-faint)">空行?</text>
<line x1="294" y1="82" x2="308" y2="82" stroke="var(--ink-soft)"/>
<rect x="308" y="60" width="86" height="44" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="316" y="80" fill="var(--ink)">关卡 2</text>
<text x="316" y="96" fill="var(--ink-faint)">段数 &lt; 4?</text>
<line x1="394" y1="82" x2="408" y2="82" stroke="var(--ink-soft)"/>
<rect x="408" y="60" width="86" height="44" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="416" y="80" fill="var(--ink)">关卡 3</text>
<text x="416" y="96" fill="var(--ink-faint)">类别认识?</text>
<line x1="494" y1="82" x2="508" y2="82" stroke="var(--ink-soft)"/>
<rect x="508" y="60" width="124" height="44" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="516" y="80" fill="var(--ink)">分类 + 对照</text>
<text x="516" y="96" fill="var(--ink-faint)">计数 抠金额</text>
<line x1="251" y1="104" x2="251" y2="146" stroke="var(--ink-soft)" stroke-dasharray="3 3"/>
<line x1="351" y1="104" x2="351" y2="146" stroke="var(--ink-soft)" stroke-dasharray="3 3"/>
<line x1="451" y1="104" x2="451" y2="146" stroke="var(--ink-soft)" stroke-dasharray="3 3"/>
<rect x="208" y="146" width="286" height="40" rx="5" fill="var(--paper)" stroke="var(--rule)"/>
<text x="218" y="166" fill="var(--ink)">说明原因 → skipped += 1 → continue</text>
<text x="218" y="180" fill="var(--ink-faint)">不合格的行从这里掉出去,回到循环头</text>
<line x1="570" y1="104" x2="570" y2="208" stroke="var(--ink-soft)" stroke-dasharray="3 3"/>
<text x="8" y="214" fill="var(--ink-soft)">12 行全部过完 → 打印日报 → while True 问审批线 → if 给结论</text>
<text x="8" y="236" fill="var(--ink-faint)">本次:有效 8 行,四行掉出去(第 3、6、10、12 行)</text>
</g>
</svg>
<figcaption>daily_report.py 的流水线。琥珀色是三道关卡,每道不过就 continue;蓝色是通过后的处理。</figcaption>
</figure>

### 第三步:过 Ruff 和红线

```text
$ uv run ruff check part01/ask_money.py part01/mini_classify.py part01/retry_refund.py part01/amount_v2.py part01/daily_report.py part01/ex20_1_fixed.py part01/ex20_3_guess_number.py part01/ex20_4_holdout.py
All checks passed!
$ uv run ruff format --check part01/ask_money.py part01/mini_classify.py part01/retry_refund.py part01/amount_v2.py part01/daily_report.py part01/ex20_1_fixed.py part01/ex20_3_guess_number.py part01/ex20_4_holdout.py
8 files already formatted
```

<div class="line-notes">

- `All checks passed!` 本周要保留的脚本都通过。`ex20_1_bugs.py` 和 `ex20_2_guess.py` 是练习里故意写出毛病的,Ruff 会点名(`SIM222`、`PLR0133` 等),所以没放进这一次检查。
- `8 files already formatted` 格式化也过了。`ask_money.py` 里 `unicodedata.normalize(...)` 那一行原来太长,是 `ruff format` 自动折行成现在的样子。

</div>

编辑器里 basedpyright 对 `daily_report.py` 零报错;对 `ex20_1_fixed.py` 有一条 warning,说 `category == "计费"` 的条件永远为假(因为我把 `category` 写死成了 `"登录"`),演示代码的特点,真实代码里 `category` 来自输入。

| 今天的零件 | 在 `daily_report.py` 里是哪一步 |
| --- | --- |
| `NFKC` 加 `strip`(Day 16) | `line = unicodedata.normalize("NFKC", raw).strip()` |
| `continue` 做卫语句(Day 19) | 三道关卡各一个,不合格的行说明原因后跳过 |
| `split(maxsplit=3)`、`len`(Day 16) | 拆成四段,段数不够就跳过 |
| `in`、`not in`(Day 17) | `human not in ("计费", "登录", "功能")`,关键词匹配 |
| `if`/`elif`/`else`(Day 17) | 分类规则链、审批结论 |
| 累加器(Day 18) | `good`、`skipped`、`correct`、`billing`、`login`、`feature`、`mentioned_fen` |
| `enumerate(..., start=1)`(Day 18) | 行号 `no` |
| `find`、切片、`isdigit`(Day 15、16、17) | 从「元」往前退,切出金额 |
| `while` 加条件(Day 19) | `while start > 0 and desc[start - 1].isdigit():` 往前退 |
| `while True` 加 `break`(Day 19) | 问审批线问到合法为止 |
| 整数分(Day 12)、f-string 排版(Day 15) | `mentioned_fen / 100:,.2f` 只在显示的一刻除 |

## 本周错题与坑清单

把这一周真实见过的报错和「悄悄错」放在一张表里。左边一列是你会在屏幕上看到的原文(或者现象),看到它就来这张表里查。Day 13 那张表接着往后抄。

| 你看到的 | 病因 | 改法 | 出处 |
| --- | --- | --- | --- |
| `NameError: name 'true' is not defined. Did you mean: 'True'?` | 写成了 JS 的小写 `true` | `True`、`False`、`None` 首字母大写 | Day 14 |
| `ValueError: could not convert string to float: '299元'` | 字符串里混着汉字、符号 | 先清洗再转换,`removesuffix("元")` | Day 14、16 |
| `ValueError: invalid literal for int() with base 10: '19.99'` | `int()` 不认带小数点的字符串 | 先 `float()` 再 `round()` | Day 14 |
| `ValueError: invalid literal for int() with base 10: ''` | 把空字符串当数字(直接回车,或切片切空了) | 转换前先判断是不是空、是不是数字 | Day 14、20 |
| `TypeError: unsupported operand type(s) for -: 'int' and 'NoneType'` | 拿 `None` 去算 | 想清楚「没有」和「0」的区别,先判断 `is None` | Day 14 |
| `int(19.99 * 100)` 得 1998 | `int()` 只砍小数,浮点还有误差 | 元转分用 `round()` | Day 14 |
| `bool("False")` 是 `True` | 非空字符串都是真 | 读配置时自己比较字符串 | Day 14 |
| `IndexError: string index out of range` | 编号从 0 数,超过了最后一个(`s[len(s)]`) | 最后一个是 `s[-1]` 或 `s[len(s) - 1]` | Day 15 |
| `TypeError: 'str' object does not support item assignment` | 想改字符串里的某个字符 | 字符串不可变,造新字符串 | Day 15 |
| `ValueError: Unknown format code 'f' for object of type 'str'` | 对字符串用了 `:.2f` | 先 `float()` 再格式化 | Day 15 |
| `{customer}` 原样出现在输出里 | 忘了 f-string 前面的 `f` | 加上 `f` | Day 15 |
| `IndexError: list index out of range` | `split` 拆出的段数比预期少 | 先判断 `len(parts)` | Day 16 |
| `ValueError: substring not found` | `index` 找不到(`find` 找不到是 `-1`) | 用 `find` 并判断 `-1`,或者先用 `in` | Day 16 |
| `"abc.com".strip(".com")` 得到 `"ab"` | `strip` 去的是字符集合不是后缀 | `removesuffix(".com")` | Day 16 |
| `"".split(",")` 得到 `['']` | 空串拆出一个空元素 | 先判断是不是空 | Day 16 |
| `UnicodeDecodeError: 'utf-8' codec can't decode byte ...` | 文件不是 UTF-8 | 找真正的编码,别用 `errors="replace"` 糊弄 | Day 16 |
| 全角 `２９９` 转不了数字 | 全角字符编码不同 | `unicodedata.normalize("NFKC", s)` | Day 16 |
| `IndentationError: expected an indented block after 'if' statement on line 3` | `if` 后面一行没缩进 | 缩进 4 格 | Day 17 |
| `SyntaxError: expected ':'` | 漏了冒号 | 补上 | Day 17 |
| `SyntaxError: invalid syntax. Maybe you meant '==' or ':=' instead of '='?` | 用 `=` 做比较 | 比较用 `==` | Day 17 |
| `ZeroDivisionError: division by zero` | 除数是 0,红线看不出来 | 保护条件放左边,让短路替你挡 | Day 17 |
| `if x == "a" or "b":` 对谁都成立 | `"b"` 非空永远为真 | `x == "a" or x == "b"` 或 `x in ("a", "b")` | Day 17 |
| 宽条件放前面,窄条件永远走不到 | `elif` 碰到第一个成立的就停 | 窄的放前面,每道关用边界值试 | Day 17 |
| 规则在 9 张上全对,新的一张就错 | 看着答案调规则,过拟合 | 留一批不参与调规则的数据来打分 | Day 17、18、20 |
| `TypeError: 'float' object cannot be interpreted as an integer` | `range(2.5)`,或 `range(n / 2)` | 用 `//`,或先转整数 | Day 18 |
| `IndentationError: expected an indented block after 'for' statement on line 2` | `for` 下一行没缩进 | 缩进 4 格 | Day 18 |
| `NameError: name 't' is not defined`(在循环后面) | 循环体一次都没跑,循环变量不存在 | 循环前给初值,或先判断列表是不是空 | Day 18 |
| `"t" is possibly unbound`(红线) | 同上,类型检查器看出来了 | 别忽略 | Day 18 |
| 累加结果只剩最后一笔 | 累加器的初值写进了循环里 | 初值放 `for` 前面 | Day 18 |
| 求和少了第一笔 | `range(1, len(x))` 从 1 开始,漏了下标 0 | `for item in x`,不管下标 | Day 18 |
| 程序不动或疯狂刷屏,停不下来 | 死循环:忘了更新条件变量,或更新写在 `continue` 后面 | `Ctrl+C`;更新语句放循环体最前面 | Day 19 |
| `KeyboardInterrupt` | 你按了 `Ctrl+C` | 不是 bug | Day 19 |
| `IndexError` 出在 `while i <= len(x)` 的最后一轮 | `<=` 多转一圈,差一错误 | 改成 `<` | Day 19 |
| 重试三次都失败,程序悄悄结束 | 次数用完没有「放弃」分支 | 用标志变量区分两种出口,放弃要明说 | Day 19 |

这周的规律和上周相反:上周的报错几乎都发生在「代码还没开始跑」的阶段,是环境问题;这周的报错是代码本身的问题,而且表里至少有六行**根本不报错**(`int(19.99 * 100)`、`bool("False")`、`or "b"`、`elif` 顺序、过拟合、累加器放进循环)。不报错的错,靠的是第 17 天以来反复讲的那几个办法:边界值、没见过的数据、手算一个答案对一对。

## 动手练习

### 练习 1:一个文件里的五个坑

`part01/ex20_1_bugs.py` 想做五件小事,每件事里藏着本周的一个坑。先照原样跑一遍,每次只修**最先露出来的那一个**,再跑,直到跑完,并且每一行输出你都能解释。

```python
# agent-zero-lab/part01/ex20_1_bugs.py
price_text = "¥299元"
times_text = "2次"
amounts = [299, 299, 49, 468]
category = "登录"
ticket = "T001 计费 C023"

price = float(price_text)
times = int(times_text)
print("单价", price, "次数", times)

if category == "计费" or "billing":
    print("按计费处理")

total = 0
for amount in amounts:
    total = amount
print("合计", total, "元")

print("客户号最后一位:", ticket[12])
```

<details><summary>参考答案</summary>

```text
$ uv run python part01/ex20_1_bugs.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex20_1_bugs.py", line 8, in <module>
    price = float(price_text)
            ^^^^^^^^^^^^^^^^^
ValueError: could not convert string to float: '¥299元'
```

<div class="line-notes">

- `File "/Users/你/agent-zero-lab/part01/ex20_1_bugs.py", line 8, in <module>` 第一个坑在第 8 行。
- `price = float(price_text)` 崩在这一行。
- `ValueError: could not convert string to float: '¥299元'` 带着 `¥` 和「元」的字符串转不了(Day 14)。修:`float(price_text.removeprefix("¥").removesuffix("元"))`(Day 16)。

</div>

```text
$ uv run python part01/ex20_1_bugs.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex20_1_bugs.py", line 9, in <module>
    times = int(times_text)
            ^^^^^^^^^^^^^^^
ValueError: invalid literal for int() with base 10: '2次'
```

<div class="line-notes">

- `line 9, in <module>` 修完第 1 个,第 2 个露出来,在第 9 行。
- `times = int(times_text)` 同样的毛病,换成了整数这边。
- `ValueError: invalid literal for int() with base 10: '2次'` 末尾的「次」没去掉。修:`int(times_text.removesuffix("次"))`。

</div>

```text
$ uv run python part01/ex20_1_bugs.py
单价 299.0 次数 2
按计费处理
合计 468 元
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex20_1_bugs.py", line 20, in <module>
    print("客户号最后一位:", ticket[12])
                             ~~~~~~^^^^
IndexError: string index out of range
```

<div class="line-notes">

- `单价 299.0 次数 2` 两个转换都对了。
- `按计费处理` **坑 3(不报错)**:`category` 是「登录」,却打印了「按计费处理」。`category == "计费" or "billing"` 里右边的 `"billing"` 非空,永远为真(Day 17)。Ruff 的 `SIM222` 会点名。修:`category in ("计费", "billing")`。
- `合计 468 元` **坑 4(不报错)**:应该是 1115。`total = amount` 每一轮都在覆盖,只剩最后一笔,应该用 `+=`(Day 18)。
- `line 20, in <module>` **坑 5**:最后一行崩了。
- `print("客户号最后一位:", ticket[12])` 崩在这一行。
- `IndexError: string index out of range` `"T001 计费 C023"` 一共 12 个字符,下标是 0 到 11,`ticket[12]` 越界(Day 15)。修:`ticket[-1]`。

</div>

五个都改好的 `part01/ex20_1_fixed.py`:

```python
# agent-zero-lab/part01/ex20_1_fixed.py
price_text = "¥299元"
times_text = "2次"
amounts = [299, 299, 49, 468]
category = "登录"
ticket = "T001 计费 C023"

price = float(price_text.removeprefix("¥").removesuffix("元"))
times = int(times_text.removesuffix("次"))
print("单价", price, "次数", times)

if category in ("计费", "billing"):
    print("按计费处理")

total = 0
for amount in amounts:
    total += amount
print("合计", total, "元")

print("客户号最后一位:", ticket[-1])
```

<div class="line-notes">

- `price_text = "¥299元"` 带货币符号和单位的字符串。
- `times_text = "2次"` 带单位。
- `amounts = [299, 299, 49, 468]` 四笔金额。
- `category = "登录"` 这次故意是登录,用来验证坑 3 修好了。
- `ticket = "T001 计费 C023"` 工单行。
- `price = float(price_text.removeprefix("¥").removesuffix("元"))` 先去掉开头的 `¥`、末尾的「元」,再转小数:`"299"` 转 `299.0`。
- `times = int(times_text.removesuffix("次"))` 去掉「次」再转整数:`"2"` 转 2。
- `print("单价", price, "次数", times)` 打印。
- `if category in ("计费", "billing"):` 用 `in` 判断「是这两个中的任何一个」。
- `print("按计费处理")` `category` 是「登录」,所以这一行不会执行。
- `total = 0` 累加器放循环外面。
- `for amount in amounts:` 直接取元素,不管下标。
- `total += amount` 累加,299 + 299 + 49 + 468。
- `print("合计", total, "元")` 循环后读结果。
- `print("客户号最后一位:", ticket[-1])` `-1` 取最后一个字符。

</div>

```text
$ uv run python part01/ex20_1_fixed.py
单价 299.0 次数 2
合计 1115 元
客户号最后一位: 3
```

<div class="line-notes">

- `单价 299.0 次数 2` 两个转换成功。
- `合计 1115 元` 299 + 299 + 49 + 468 = 1115,和手算一致。
- `客户号最后一位: 3` `"C023"` 的最后一个字符是 `3`。注意没有「按计费处理」那一行:登录类不进计费分支,这才是对的。

</div>

教训:五个坑里两个是「一报错就知道」(1、2),三个是「悄悄错」(3、4、5 里,5 虽然报错但是在前面的输出都错的前提下才露出来)。**只有对着预期答案(1115、不该有「按计费处理」)才能发现 3 和 4**,单靠「它没报错」是发现不了的。

</details>

### 练习 2:先猜,再跑

下面的 `part01/ex20_2_guess.py` 把本周六天的东西各放了一点。先在纸上写出每一行输出,再跑。

```python
# agent-zero-lab/part01/ex20_2_guess.py
print(bool("False"), bool(0.0), bool([]), None is None)
print("T001 计费 C023"[5:7], "T001 计费 C023".split()[-1])
print(0 or "匿名", "" and 5)
print(int(9.99), round(9.99), int("42") + 1)

for i in range(10, 0, -4):
    print(i, end=" ")
print()

n = 10
while n > 0:
    n -= 3
    if n % 2 == 0:
        continue
    print("n =", n)
```

<details><summary>参考答案</summary>

```text
$ uv run python part01/ex20_2_guess.py
True False False True
计费 C023
匿名 
9 10 43
10 6 2 
n = 7
n = 1
```

<div class="line-notes">

- `True False False True` `bool("False")` 非空字符串是真(Day 14);`0.0` 和空列表是假;`None is None` 是真。
- `计费 C023` `[5:7]` 取编号 5 和 6 的两个字符,正好是「计费」(Day 15);`split()` 拆成 `['T001', '计费', 'C023']`,`[-1]` 是最后一段(Day 16)。
- `匿名 ` `0 or "匿名"`:左边是假,取右边,得 `"匿名"`;`"" and 5`:左边是假,`and` 停在左边,得 `""` 空字符串(Day 17)。所以第二个值打印出来是空的,`匿名` 后面跟着分隔的空格,再什么都没有。
- `9 10 43` `int(9.99)` 砍掉小数得 9;`round(9.99)` 四舍五入得 10;`int("42") + 1` 得 43(Day 14)。
- `10 6 2 ` `range(10, 0, -4)` 是 10、6、2,下一个 −2 越过终点 0。`end=" "` 让每个数字后面跟一个空格不换行;最后一个 `print()` 换行(Day 18、19)。
- `n = 7` `n` 从 10 开始,减 3 得 7,是奇数,打印。
- `n = 1` 7 减 3 得 4,偶数 `continue`;4 减 3 得 1,奇数,打印;1 减 3 得 −2,偶数 `continue`;回循环头 `−2 > 0` 不成立,结束(Day 19)。

</div>

第三行有 `or "匿名"`、`"" and 5` 这种写法,Ruff 的 `SIM222`、`SIM223` 会点名,因为条件是常量。真实代码里左边是变量,这里只是为了考你。

猜错的话,最容易错的是第三行(`and` 返回的是左边那个空串,不是 `False`)和最后一块(`continue` 之后 `n` 已经变了,别把「跳过打印」当成「跳过减法」)。

</details>

### 练习 3:猜数字

写 `part01/ex20_3_guess_number.py`:答案写死 37,最多 7 次机会。每次读一个输入:不是整数就提示「请输入整数,这次不扣机会」并重新问;是整数就扣一次机会,太小提示「小了」、太大提示「大了」,猜对立刻结束。结束后猜对了打印「猜对了,用了 N 次」,否则打印「7 次都没猜中,答案是 37」。用两组输入各跑一次:`50`、`abc`、`25`、`37`,以及 `10`、`20`、`30`、`40`、`50`、`60`、`70`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex20_3_guess_number.py
ANSWER = 37
MAX_TRIES = 7

tries = 0
won = False
while tries < MAX_TRIES:
    text = input(f"猜一个 1 到 100 的整数(还剩 {MAX_TRIES - tries} 次):").strip()
    if not text.isdigit():
        print("请输入整数,这次不扣机会")
        continue

    tries += 1
    guess = int(text)
    if guess == ANSWER:
        won = True
        break
    if guess < ANSWER:
        print("小了")
    else:
        print("大了")

if won:
    print(f"猜对了,用了 {tries} 次")
else:
    print(f"{MAX_TRIES} 次都没猜中,答案是 {ANSWER}")
```

<div class="line-notes">

- `ANSWER = 37` 答案,常量。
- `MAX_TRIES = 7` 最多 7 次。
- `tries = 0` 已经**计入**的猜测次数(输入不合法的不计)。
- `won = False` 标志变量,区分「猜对 break 出来」和「机会用完」。
- `while tries < MAX_TRIES:` 次数没用完就继续。输入不合法的那几轮不会让 `tries` 增加,所以事先不知道要转几圈,这里该用 `while`。
- `text = input(f"猜一个 1 到 100 的整数(还剩 {MAX_TRIES - tries} 次):").strip()` 提示里带着还剩几次,用 `MAX_TRIES - tries` 算。
- `if not text.isdigit():` 不是整数。
- `print("请输入整数,这次不扣机会")` 说明原因。
- `continue` 回循环头重新问。这里的 `continue` 在 `tries += 1` **前面**,所以不合法的输入不扣机会,这是特意的。Day 19 说过 `while` 里 `continue` 要小心跳过更新,这次是故意要跳过,而且不会死循环:每次回到循环头都会再次停在 `input()` 等你敲。
- `tries += 1` 合法输入才扣一次机会。
- `guess = int(text)` 已经确认是整数,放心转。
- `if guess == ANSWER:` 猜对了?
- `won = True` 记下。
- `break` 立刻跳出,不用再问。
- `if guess < ANSWER:` 没猜对,小了吗?
- `print("小了")` 提示小了。
- `else:` 那就是大了。
- `print("大了")` 提示大了。
- `if won:` 循环结束后分两种出口。
- `print(f"猜对了,用了 {tries} 次")` 成功分支,`tries` 不含不合法的输入。
- `else:` 机会用完。
- `print(f"{MAX_TRIES} 次都没猜中,答案是 {ANSWER}")` 放弃分支,把答案告诉用户。

</div>

```text
$ uv run python part01/ex20_3_guess_number.py
猜一个 1 到 100 的整数(还剩 7 次):50
大了
猜一个 1 到 100 的整数(还剩 6 次):abc
请输入整数,这次不扣机会
猜一个 1 到 100 的整数(还剩 6 次):25
小了
猜一个 1 到 100 的整数(还剩 5 次):37
猜对了,用了 3 次
$ uv run python part01/ex20_3_guess_number.py
猜一个 1 到 100 的整数(还剩 7 次):10
小了
猜一个 1 到 100 的整数(还剩 6 次):20
小了
猜一个 1 到 100 的整数(还剩 5 次):30
小了
猜一个 1 到 100 的整数(还剩 4 次):40
大了
猜一个 1 到 100 的整数(还剩 3 次):50
大了
猜一个 1 到 100 的整数(还剩 2 次):60
大了
猜一个 1 到 100 的整数(还剩 1 次):70
大了
7 次都没猜中,答案是 37
```

<div class="line-notes">

- `猜一个 1 到 100 的整数(还剩 7 次):50` 第一组第 1 次,50 比 37 大。
- `大了` 提示大了。
- `猜一个 1 到 100 的整数(还剩 6 次):abc` `abc` 不是整数。
- `请输入整数,这次不扣机会` 被第一道关挡住。
- `猜一个 1 到 100 的整数(还剩 6 次):25` 下一次提示里**还是还剩 6 次**:`abc` 没有扣机会。
- `小了` 25 比 37 小。
- `猜一个 1 到 100 的整数(还剩 5 次):37` 第 3 次有效猜测。
- `猜对了,用了 3 次` 有效猜测是 50、25、37,共 3 次,`abc` 不算。
- `猜一个 1 到 100 的整数(还剩 1 次):70` 第二组最后一次机会。
- `7 次都没猜中,答案是 37` 七次都没猜中,`tries` 加到 7,条件不成立,退出,`won` 仍是 `False`。

</div>

这道题把本周的东西全用上了:Day 14 的 `input` 和 `int`、Day 17 的 `isdigit` 和 `if`/`else`、Day 19 的 `while`、`break`、`continue` 和标志变量。第二组输入里每次的提示都是「小了/大了」,你可以自己想一想:这就是**二分查找**的雏形,下一步猜区间中点,7 次足够猜中 1 到 100 里的任何数(2 的 7 次方是 128)。

</details>

### 练习 4:用没见过的数据量出真实水平

Day 17 说「9/9 不等于准」,Day 18 的第 10 张已经让它露了馅。今天来量一量。`part01/ex20_4_holdout.py` 里放了 15 张工单:T001 到 T010 是调规则时见过的,T011 到 T015 是我今天新造的、规则从没见过的,人工标注都写在行里。用 Day 17 的 `classify2.py` 规则,循环分类,**分开**统计「见过的」和「没见过的」两组各对了几张,并把没见过的里面答错的打印出来(工单号、人工类别、规则结果、描述)。提示:`ticket_id.removeprefix("T")` 转成整数,小于等于 10 的算见过的。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex20_4_holdout.py
tickets = [
    "T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次",
    "T002 登录 C007 手机验证码收不到",
    "T003 计费 C015 想把月付改成年付,差价怎么算",
    "T004 功能 C023 导出发票PDF时中文显示成方框",
    "T005 登录 C031 Forgot password email never arrived",
    "T006 计费 C007 Refund request for duplicate charge",
    "T007 功能 C015 希望发票抬头能改成英文",
    "T008 计费 C042 发票金额和订单金额对不上",
    "T009 计费 C031 续费后发票没有发到邮箱",
    "T010 计费 C042 我想要一份发票的PDF版本",
    "T011 计费 C023 导出账单CSV时金额少了一行",
    "T012 功能 C031 能不能在发票上加公司logo",
    "T013 登录 C007 手机号换了收不到验证码",
    "T014 计费 C015 续费价格怎么比去年贵",
    "T015 功能 C042 希望支持导出客户列表",
]

seen_total = 0
seen_ok = 0
new_total = 0
new_ok = 0
for line in tickets:
    parts = line.split(maxsplit=3)
    ticket_id = parts[0]
    human = parts[1]
    text = parts[3].lower()

    if "导出" in text or "抬头" in text or "pdf" in text or "方框" in text:
        category = "功能"
    elif (
        "扣" in text
        or "退款" in text
        or "发票" in text
        or "金额" in text
        or "月付" in text
        or "年付" in text
        or "refund" in text
        or "charge" in text
    ):
        category = "计费"
    elif "登录" in text or "验证码" in text or "密码" in text or "password" in text:
        category = "登录"
    else:
        category = "功能"

    number = int(ticket_id.removeprefix("T"))
    if number <= 10:
        seen_total += 1
        if category == human:
            seen_ok += 1
    else:
        new_total += 1
        if category == human:
            new_ok += 1
        else:
            print(f"没见过的 {ticket_id} 人工={human} 规则={category}:{parts[3]}")

print(f"调规则时见过的:{seen_ok}/{seen_total}")
print(f"没见过的:{new_ok}/{new_total}")
```

<div class="line-notes">

- `tickets = [` 15 张,T001 到 T010 同 Day 18,后 5 张是新的。
- `"T011 计费 C023 导出账单CSV时金额少了一行",` 新工单一。人工类别是计费(金额少了),但里面有「导出」。
- `"T012 功能 C031 能不能在发票上加公司logo",` 新工单二。人工类别是功能(想加 logo),但里面有「发票」。
- `"T013 登录 C007 手机号换了收不到验证码",` 新工单三,登录,规则应该能认出。
- `"T014 计费 C015 续费价格怎么比去年贵",` 新工单四,计费,但没有任何计费关键词。
- `"T015 功能 C042 希望支持导出客户列表",` 新工单五,功能,「导出」命中。
- `seen_total = 0` 四个累加器:见过的总数。
- `seen_ok = 0` 见过的里对了几张。
- `new_total = 0` 没见过的总数。
- `new_ok = 0` 没见过的里对了几张。
- `for line in tickets:` 15 张逐个分。
- `parts = line.split(maxsplit=3)` 拆四段。
- `ticket_id = parts[0]` 工单号。
- `human = parts[1]` 人工类别。
- `text = parts[3].lower()` 描述小写。
- `if "导出" in text or "抬头" in text or "pdf" in text or "方框" in text:` `classify2.py` 的规则,和 Day 18 一样。
- `elif (` 计费词。
- `elif "登录" in text or "验证码" in text or "密码" in text or "password" in text:` 登录词。
- `else:` 默认功能。
- `number = int(ticket_id.removeprefix("T"))` 去掉开头的 `T` 转成整数,T011 变 11(Day 16 的 `removeprefix`)。
- `if number <= 10:` 编号 1 到 10 的算「见过的」。
- `seen_total += 1` 见过的总数加 1。
- `seen_ok += 1` 对了就加 1。
- `else:` 编号大于 10,没见过的。
- `new_total += 1` 总数加 1。
- `new_ok += 1` 对了就加 1。
- `print(f"没见过的 {ticket_id} 人工={human} 规则={category}:{parts[3]}")` 答错的才打印,带着描述,方便看为什么错。
- `print(f"调规则时见过的:{seen_ok}/{seen_total}")` 循环结束后打印见过的那一组。
- `print(f"没见过的:{new_ok}/{new_total}")` 打印没见过的那一组。

</div>

```text
$ uv run python part01/ex20_4_holdout.py
没见过的 T011 人工=计费 规则=功能:导出账单CSV时金额少了一行
没见过的 T012 人工=功能 规则=计费:能不能在发票上加公司logo
没见过的 T014 人工=计费 规则=功能:续费价格怎么比去年贵
调规则时见过的:9/10
没见过的:2/5
```

<div class="line-notes">

- `没见过的 T011 人工=计费 规则=功能:导出账单CSV时金额少了一行` T011:「导出」在最前面的功能规则里命中,规则没读懂这是金额问题。这和 Day 18 的 T010 同一种毛病:前面的规则为修某一张加的词,抢了别人的。
- `没见过的 T012 人工=功能 规则=计费:能不能在发票上加公司logo` T012:「发票」命中计费。Day 17 里 T004 和 T007 就是因为「发票」同时出现在计费和功能工单里被错判过,第二版靠把功能词放前面修好了那两张,但这张里没有任何功能词。
- `没见过的 T014 人工=计费 规则=功能:续费价格怎么比去年贵` T014:规则里没有「续费」「价格」,掉进默认的功能。
- `调规则时见过的:9/10` 见过的 10 张对 9 张(只有 T010 错),和 Day 18 一致。
- `没见过的:2/5` 没见过的 5 张只对了 2 张(T013、T015),40%。

</div>

对比一下:**见过的 90%,没见过的 40%**。后一个数才是它面对真实新工单时的水平,而且只有 5 张,样本太少,只能说「远低于 90%」,不能说「就是 40%」。这个对比就是评测的核心:**拿调规则时没见过的数据打分**。第六部分的评测会把它做成流程:先把数据一分为二,一份拿来调,一份锁起来只在最后打一次分。今天你已经亲手做了一次最小版本。

另外留意一件事:这 5 张里,如果你把 T011 到 T014 的关键词也补进规则,「没见过的」就变成「见过的」,这个对比会失效。这就是为什么锁起来的那份数据**不能反复看着调**,看一次调一次,它就变成调参数据了。再要验证就得重新造一批新的。

</details>

练习的验收标准:`ask_money.py`、`mini_classify.py`、`retry_refund.py`、`amount_v2.py`、`daily_report.py` 和四道练习都能跑,输出和文中一致;合上文章默写出 `ask_money.py`、`mini_classify.py`、`retry_refund.py` 的骨架并跑通;能不看表说出本周错题表里至少 15 行的病因;能解释为什么 `daily_report.py` 里「规则分对 7/8」不能直接当作规则的准确率,而练习 4 里的「没见过的 2/5」更接近真实水平。

## 名词解释

今天没有新概念,这里把本周六天的核心术语放在一起,方便回头查。

| 名词 | 意思 | 出处 |
| --- | --- | --- |
| `True` / `False` / `None` | 布尔值和「空」,首字母大写;判断 `None` 用 `is` | Day 14 |
| 类型转换 | `int()`、`float()`、`str()`、`bool()`;`input()` 读进来永远是字符串 | Day 14 |
| 索引 / 切片 | 字符串的编号(从 0)和 `s[a:b]`(左闭右开) | Day 15 |
| f-string | `f"... {变量:.2f} ..."`,Python 的模板字符串 | Day 15 |
| 方法 | `s.strip()` 这种「属于某类数据的函数」,返回新值不改原值 | Day 16 |
| 列表 | 方括号里一串东西,`split()` 的结果;Day 21 细讲 | Day 16 |
| UTF-8 / NFKC | 汉字存成 3 字节;`NFKC` 把全角字符变半角 | Day 16 |
| 条件 / 分支 | 得到真假的表达式;`if`/`elif`/`else` 让程序走不同的路 | Day 17 |
| 短路求值 | `and`/`or` 左边定了结果,右边不再计算 | Day 17 |
| 过拟合 | 按已知答案调规则,在这批数据上很准,新数据上不一定 | Day 17 |
| 循环 / 循环体 | 让一段代码重复执行;缩进的那几行 | Day 18 |
| 累加器 | 循环外设初值、循环里更新、循环后读结果的变量 | Day 18 |
| `range` / `enumerate` | 生成数字(起点含、终点不含);同时给编号和元素 | Day 18 |
| 死循环 | 条件永远不变成不成立,靠 `Ctrl+C` 停 | Day 19 |
| `break` / `continue` | 跳出整个循环 / 跳过这一轮 | Day 19 |
| 标志变量 | 记录某件事有没有发生,区分循环的不同出口 | Day 19 |
| 重试 / 指数退避 | 失败后再试,等待时间翻倍,有次数上限 | Day 19 |
| 卫语句 | 先挡掉不合格的情况(`continue`、提前结束),剩下的代码不用多套一层缩进 | Day 19、20 |
| 留出集(holdout) | 调规则时不看、只用来最后打分的数据 | Day 20 |

## 常见误区

**把「没报错」当成「对」。** 这一周最贵的教训。`or "b"`、累加器放循环里、`elif` 顺序、过拟合都不报错。每个结果都要拿一个手算的答案或没见过的数据验证一遍。

**默写时看着文章抄。** 复习日的价值在「合上文章」那一步。卡住再翻,翻完关掉重写,不要边看边敲。

**只修最后一个报错,不重新跑全部。** 练习 1 里五个坑互相藏着,每修一个都要从头再跑,看新的现象。

**拿同一批数据调规则、又拿它打分。** 分数一定好看。要留一批没参与调规则的数据,调完规则后只在它上面打一次分。

**把 `continue` 和 `break` 的位置放错。** `continue` 前面的更新语句会被跳过,`break` 之前要记下是怎么出来的(标志变量)。

**跳过类型检查器的红线。** `possibly unbound`、`reportUnnecessaryComparison` 这些提示,多半是它在提醒你「这个变量可能没值」「这个条件永远一样」,别习惯性忽略。

**把整行清洗放在循环外面。** `daily_report.py` 里 `normalize` 和 `strip` 必须每一行都做,所以写在循环体里。放在外面只会洗到第一行。

## 学习资料

### 文档与文章

- [Python 教程 · 更多控制流工具](https://docs.python.org/zh-cn/3.12/tutorial/controlflow.html):中文,官方教程整章,`if`、`for`、`range`、`break`/`continue`、函数定义(Day 28 才用)都在里面,这周六天的内容它前半章都覆盖了,适合作为本周的「复习一遍」。
- [Python 教程 · 错误和异常](https://docs.python.org/zh-cn/3.12/tutorial/errors.html):中文,这周见了一堆报错,这一章讲 `try`/`except`,Day 35 才系统学,先扫一眼标题。
- [Python 标准库 · 内置异常](https://docs.python.org/zh-cn/3.12/library/exceptions.html):中文,所有报错类型的清单和层级,碰到没见过的 `XxxError` 可以来查。
- [Python 标准库 · unicodedata](https://docs.python.org/zh-cn/3.12/library/unicodedata.html):中文,`normalize` 的四种形式,为什么用 `NFKC` 处理全角。
- [PEP 8 · Style Guide for Python Code](https://peps.python.org/pep-0008/):英文,命名(全大写常量)、缩进、空行的官方约定,Ruff 的很多规则出自这里。
- [Ruff · Rules](https://docs.astral.sh/ruff/rules/):英文,所有规则的清单,本周碰到的 `SIM222`、`SIM223`、`PLR0133` 都能查到解释和例子。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1UN4y1576f&autoplay=0&high_quality=1" title="如何看懂Python的报错" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>jiang_keqing · 如何看懂Python的报错 · 13 分钟,2022 年 8 月。标题就是怎么看懂 Python 报错,看完拿本周错题表里的几行对照一下。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV17F41137cW&autoplay=0&high_quality=1" title="python编程while循环案例—猜数字游戏" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>小昕讲堂 · python编程while循环案例—猜数字游戏 · 9 分钟,2022 年 4 月。和练习 3 同一个题目,先自己做完再对照,看他处理输入和计次的方式有什么不同。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/iaRj5xGHCuE" title="Python Loops (Visually Explained) | For, While, Break, Continue, Else" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Data with Baraa · Python Loops (Visually Explained) · 英文,可开自动字幕。用动画把 `for`、`while`、`break`、`continue` 的执行顺序走一遍,最后还讲了循环的 `else`,适合当 Day 18、19 的复习。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/kqtD5dpn9C8" title="Python for Beginners - Learn Coding with Python in 1 Hour" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Programming with Mosh · Python for Beginners - Learn Coding with Python in 1 Hour · 英文,约 1 小时,可开自动字幕。变量、输入、类型转换、`if`、`while`、`for` 一口气过一遍,当作整周的快速回放,不用都看,挑自己卡过的几段。</figcaption>
</figure>

### 书籍

- Eric Matthes《Python Crash Course》第 3 版,No Starch Press,2023(中译《Python编程:从入门到实践》)。第 2 到 7 章覆盖本周全部内容:变量与字符串、列表(Day 21 要学)、`if`、`while` 和用户输入,第 5、7 章后的练习适合当复习题。
- Allen B. Downey《Think Python》第 3 版,O'Reilly,2024,[免费在线版](https://allendowney.github.io/ThinkPython/)。第 5、7 章讲条件和迭代,习题偏数学和字符串,可以挑自己有兴趣的做。
- Brett Slatkin《Effective Python》第 3 版,Addison-Wesley,2024。写代码的「地道写法」合集,里面有专门一条讲为什么用 `enumerate` 而不是 `range(len(...))`。现在读还早,学完函数和类之后再翻会更有感觉。

### 开源项目与代码

- [Asabeneh/30-Days-Of-Python](https://github.com/Asabeneh/30-Days-Of-Python/tree/master/09_Day_Conditionals):英文,「Day 9 Conditionals」和上一篇用过的「Day 10 Loops」相邻,各有一批练习,可以挑几道做。
- [zhiwehu/Python-programming-exercises](https://github.com/zhiwehu/Python-programming-exercises):英文,100 多道经典的 Python 小题,题目短、有参考答案,适合学完本周后挑前 20 题练手。
- [karan/Projects](https://github.com/karan/Projects):英文,按难度分类的小项目点子清单(猜数字、简易计算器、单位换算等),这周的知识够做其中「入门」那一类。

## 自测

1. 下面这段代码的输出是什么?`i` 最后停在几?

```python
for i in range(3):
    pass
print(i)
```

<details><summary>答案</summary>

输出 `2`。循环变量出了循环还活着,停在最后一轮的值 2。如果把 `range(3)` 换成空列表 `[]`,`print(i)` 会报 `NameError`,因为循环体一次都没跑。(这里的 `pass` 是「什么都不做」的占位语句,今天不用学,知道循环体里需要有一句话就行。)

</details>

2. 一行文本 `"T009 计费"` 用 `split(maxsplit=3)` 拆开,`len(parts)` 是几?如果不检查就直接取 `parts[3]`,会发生什么?

<details><summary>答案</summary>

`len(parts)` 是 2。取 `parts[3]` 报 `IndexError: list index out of range`。所以拆完要先判断 `len(parts) < 4`,不合格就说明原因后 `continue`,这是 `daily_report.py` 的第二道关卡。

</details>

3. 判断下面三个条件,哪个永远成立,为什么?

```python
if category == "计费" or "billing":
if category in ("计费", "billing"):
if category == "计费" or category == "billing":
```

<details><summary>答案</summary>

第一个永远成立:`"billing"` 是非空字符串,是真,`or` 的右边永远为真。第二个和第三个是正确的写法,意思一样。

</details>

4. `total = 0` 写在 `for` 循环里面和外面,结果有什么区别?

<details><summary>答案</summary>

写在外面,每一轮在上一轮的基础上累加,循环后是所有项的总和。写在里面,每一轮开头都被清零,循环后只剩最后一轮加进去的那一项,而且不报错。

</details>

5. 为什么 `ask_money.py` 里金额的初值用 `fen = None` 而不是 `fen = 0`?

<details><summary>答案</summary>

0 元也可能是用户输入的合法金额,用 0 当「还没有」会和「输入了 0」混在一起。`None` 明确表示「还没拿到」,循环后用 `if fen is None:` 就能区分「三次都没输对」和「输了个 0」。

</details>

6. 面试题:同事说「我们的分类规则在测试集上准确率 95%」,你想验证这个数字是不是真的,你会先问哪几个问题?

<details><summary>答案</summary>

第一,这批测试数据在调规则的时候看过没有?如果规则是看着这批数据补的关键词,95% 只代表「在已知答案上调到了 95%」,说明不了新数据上的水平。第二,测试集有多少条?只有几十条的话,95% 和 80% 的差别可能只是几条数据。第三,测试集的分布和线上真实数据像不像,比如有没有残缺行、全角字符、多语言。第四,错的那些是哪一类,是关键词没覆盖,还是顺序抢了彼此。能给出一份「调规则时锁起来没看过」的新数据的成绩,才有说服力。这是第六部分(评测与可观测)的核心,今天练习 4 做的就是它的最小版本。

</details>

## 明天预告

Day 21 · 列表:增删改查和排序。这周你已经用了很多次列表:`split` 的结果是列表,`for` 遍历的是列表,`tickets = [...]` 也是列表,但一直是「拿来用」,没有系统学过。明天正式学:列表相当于 JS 的数组,`append` 加一项、`pop` 取走一项、`sort` 排序、切片和字符串同一套规则,最后用它把工单按金额排序。学完你就能把 `daily_report.py` 里那堆 `billing`、`login`、`feature` 计数器之外的东西,攒成一份可以排序、筛选的清单。
