---
title: 'Day 19 · while、break 和 continue'
description: '次数事先不知道的循环用 while:条件成立就一直跑。认识死循环和 Ctrl+C,用 while True 加 break 写「问到输对为止」,用 continue 跳过坏行,最后写出带最大次数和等待时间的重试循环,以及 Agent 循环的玩具版。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'agent-zero']
series: 'agent-zero'
day: 19
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 18](/blog/agent-zero/day-018-for-range/) 学了 `for`:对一批东西每个都跑一遍,用 `range` 生成数字,用累加器 `correct += 1` 数对错,用 `enumerate` 拿编号。`batch_classify.py` 一口气把 10 张工单分完,得到 9/10。

`for` 有一个前提:**循环几次,开跑之前就知道了**,列表有 10 项就是 10 轮。可是很多事情不是这样。用户输入了 `abc`,你要再问一遍,可能问一次就对,也可能问五次。调一个接口超时了,你要再试,可能第二次就好了,也可能三次都不行。大模型 Agent 不停地调工具,直到模型说「我答完了」,可能 2 步,也可能 20 步。这些都是「事先不知道几次,直到某个条件满足才停」。今天学 `while`、`break` 和 `continue`,写出第一个重试循环。

## 今天要解决的问题

学完今天,你应该能:

1. 写出 `while 条件:`,说清什么时候用 `while`、什么时候用 `for`;认出死循环的三种常见成因,会用 `Ctrl+C` 把它停下。
2. 用 `break` 提前跳出循环,用 `while True` 加 `break` 写「问到输对为止」(Python 没有 `do...while`);用 `continue` 跳过这一轮,并知道在 `while` 里用 `continue` 前要先更新变量,否则死循环。
3. 写出带「最多 N 次」的重试循环:成功就 `break`,三次都失败要有「放弃」的分支,失败后等 1 秒、2 秒再试(指数退避)。
4. 写出 `part01/ask_times.py`、`part01/retry_basic.py`,并看懂 Agent 循环的玩具版:最大步数就是它的保险。

预计用时:2.5 小时。while 和死循环 40 分钟,break 和 continue 40 分钟,重试 40 分钟,剩下做练习。

前置:[Day 12](/blog/agent-zero/day-012-numbers/)(`+=`、`%`)、[Day 16](/blog/agent-zero/day-016-strings-2/)(`strip`、`removesuffix`)、[Day 17](/blog/agent-zero/day-017-if-else/)(`if`、`isdigit`、前置校验)、[Day 18](/blog/agent-zero/day-018-for-range/)(`for`、累加器、`enumerate`)。今天不调任何 API,花费 0 元。

学法提示:先对照文章逐行敲一遍(代码自己敲,不复制粘贴)并跑通;第二天合上文章,把 `retry_basic.py` 默写出来,分别输入 `3` 和 `5` 各跑一次;然后做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先说清楚我是在哪跑的

输出是我 2026-10-23 在 2019 款 Intel MacBook Pro(macOS 14、zsh)上用演示家目录真跑的,家目录显示成 `/Users/你`,`~/agent-zero-lab` 接着 Day 18 的状态,`uv run python` 是 3.12.13,Ruff 是 0.17.2。今天的脚本都放在 `part01/`,在仓库根目录用 `uv run python part01/文件名.py` 运行。要读键盘输入的脚本,下面贴的是你在终端里敲的样子:提示文字后面跟着你敲的字(我用管道喂输入,在伪终端里记录下来)。死循环那几段,我是等了几秒按下 `Ctrl+C`,终端里显示的 `^C` 就是按下的那一下。

## while:条件成立就一直跑

### 和 JS 的 while 几乎一样

先看 JS。把 `while`、`do...while`、`continue`、`break` 一次跑完:

```text
$ node -e '
let n = 0;
while (n < 3) { n++; console.log("while", n); }
let m = 5;
do { console.log("do...while 至少跑一次,m =", m); m++; } while (m < 3);
for (let i = 0; i < 6; i++) {
  if (i % 2 === 0) continue;
  if (i === 5) break;
  console.log("奇数", i);
}
'
while 1
while 2
while 3
do...while 至少跑一次,m = 5
奇数 1
奇数 3
```

<div class="line-notes">

- `let n = 0;` 一个计数变量。
- `while (n < 3) { n++; console.log("while", n); }` 条件成立就执行花括号里的代码,每次执行完再回头检查条件。
- `let m = 5;` 一个一开始就不满足条件的变量。
- `do { console.log("do...while 至少跑一次,m =", m); m++; } while (m < 3);` `do...while` 先执行一次,再检查条件。`m` 一开始是 5,条件 `m < 3` 不成立,但它还是跑了一遍。
- `if (i % 2 === 0) continue;` 偶数就跳过这一轮,回到循环头。
- `if (i === 5) break;` `i` 到 5 就彻底跳出整个循环。
- `while 1` 前三行是第一个 `while`。
- `do...while 至少跑一次,m = 5` 虽然条件一开始不成立,仍然打印了一次。
- `奇数 1` `i` 是 1 时没被跳过,也没到 5。
- `奇数 3` `i` 是 3。`i` 等于 5 时直接 `break`,所以没有打印 `奇数 5`。

</div>

Python 里 `while` 的意思和 JS 一样,写法只有三处不同:

| 对比 | JS | Python |
| --- | --- | --- |
| 条件写在哪 | `while (n < 3) {` 加括号 | `while n < 3:` 不加括号,末尾冒号 |
| 循环体的边界 | 花括号 | 缩进 4 格(Day 17) |
| `n++` | 有 | 没有,写 `n += 1`(Day 12) |
| `do...while` | 有 | **没有**。要「至少跑一次」就写 `while True:` 加 `break`,见后文 |
| `break`、`continue` | 有 | 有,意思一样 |

### 最小的 while

新建 `part01/while_basic.py`:

```python
# agent-zero-lab/part01/while_basic.py
attempt = 1

while attempt <= 3:
    print("第", attempt, "次尝试")
    attempt += 1

print("循环结束,attempt 现在是", attempt)
```

<div class="line-notes">

- `attempt = 1` 先给计数变量一个初始值。**`while` 之前必须先有这个变量**,条件里要用它。
- `while attempt <= 3:` 先检查条件:`1 <= 3` 成立,进入循环体。读法:「当 `attempt` 不超过 3 的时候,一直做下面的事」。末尾冒号和缩进和 `for`、`if` 一样。
- `print("第", attempt, "次尝试")` 第 1 轮打印「第 1 次尝试」。
- `attempt += 1` **这一行最关键**:让 `attempt` 变大,条件才有可能变成不成立。第 1 轮后 `attempt` 是 2,第 2 轮后是 3,第 3 轮后是 4。
- `print("循环结束,attempt 现在是", attempt)` 缩进回到最左边。第 3 轮结束后回到循环头:`4 <= 3` 不成立,退出,执行这一行。

</div>

```text
$ cd ~/agent-zero-lab
$ uv run python part01/while_basic.py
第 1 次尝试
第 2 次尝试
第 3 次尝试
循环结束,attempt 现在是 4
```

<div class="line-notes">

- `$ uv run python part01/while_basic.py` 在仓库根目录运行。
- `第 1 次尝试` 第 1 轮,检查条件 `1 <= 3` 成立。
- `第 2 次尝试` 第 2 轮,`2 <= 3`。
- `第 3 次尝试` 第 3 轮,`3 <= 3`,边界上的 3 也成立(`<=` 含等号,Day 14)。
- `循环结束,attempt 现在是 4` 条件 `4 <= 3` 不成立才退出,所以退出时 `attempt` 是 4,不是 3。这和 `for` 里循环变量停在最后一个值不一样:`while` 的计数器是你自己改的,退出时一定已经让条件不成立了。

</div>

每一轮的流程是:检查条件 → 成立就执行循环体 → 回到「检查条件」;不成立就跳过整个循环体。画出来是这样:

<figure>
<svg viewBox="0 0 640 262" role="img" aria-label="while_basic.py 的流程:先设 attempt 等于 1,然后判断 attempt 是否小于等于 3,成立就执行打印和 attempt 加 1 然后回到判断,不成立就跳出,执行循环后面的 print">
<rect x="0" y="0" width="640" height="262" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="104" width="110" height="34" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="32" y="126" fill="var(--ink)">attempt = 1</text>
<line x1="130" y1="121" x2="170" y2="121" stroke="var(--ink-soft)"/>
<polygon points="168,116 176,121 168,126" fill="var(--ink-soft)"/>
<polygon points="260,70 350,121 260,172 170,121" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="206" y="125" fill="var(--ink)">attempt &lt;= 3 ?</text>
<line x1="350" y1="121" x2="400" y2="121" stroke="var(--ink-soft)"/>
<polygon points="398,116 406,121 398,126" fill="var(--ink-soft)"/>
<text x="362" y="112" fill="var(--ink-soft)">成立</text>
<rect x="408" y="88" width="212" height="66" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="420" y="112" fill="var(--ink)">print("第", attempt, "次尝试")</text>
<text x="420" y="136" fill="var(--ink)">attempt += 1</text>
<path d="M514 88 L514 36 L260 36 L260 70" fill="none" stroke="var(--ink-soft)"/>
<polygon points="255,62 260,70 265,62" fill="var(--ink-soft)"/>
<text x="330" y="28" fill="var(--ink-faint)">回到判断,再检查一次</text>
<line x1="260" y1="172" x2="260" y2="206" stroke="var(--ink-soft)"/>
<polygon points="255,204 260,212 265,204" fill="var(--ink-soft)"/>
<text x="270" y="194" fill="var(--ink-soft)">不成立</text>
<rect x="150" y="214" width="220" height="34" rx="5" fill="var(--paper)" stroke="var(--rule)"/>
<text x="162" y="236" fill="var(--ink)">print("循环结束,attempt 现在是", attempt)</text>
</g>
</svg>
<figcaption>while 的一轮:先判断,成立才进循环体,执行完回到判断。判断不成立时才离开,这时 attempt 是 4。</figcaption>
</figure>

### for 和 while 怎么选

两种循环可以互相改写,选哪个看一件事:**循环几次,开跑前知不知道**。

| 场景 | 知道几次吗 | 用哪个 |
| --- | --- | --- |
| 处理列表里的 10 张工单 | 知道,列表有 10 项 | `for` |
| 算 12 个月的累计 | 知道,就是 12 | `for` + `range` |
| 用户输入不合法就再问 | 不知道,看用户 | `while` |
| 接口超时就重试,最多 3 次 | 最多 3 次,但可能 1 次就成功 | `while` |
| Agent 一直调工具直到模型答完 | 不知道,看模型 | `while` |

能用 `for` 的时候用 `for`,它不会忘记更新计数器;只有次数事先不确定,才用 `while`。

### 死循环:忘了更新变量

`while` 的最大风险是**条件永远不变成不成立**,循环永远停不下来,这叫死循环(infinite loop)。最常见的原因就是上面那一行 `attempt += 1` 忘了写。新建 `part01/while_forever.py`(故意写错):

```python
# agent-zero-lab/part01/while_forever.py
import time

count = 0
while count < 3:
    print("还在跑,count =", count)
    time.sleep(0.5)
```

<div class="line-notes">

- `import time` 引入标准库的 `time` 模块,今天只用它的两个函数。`import` 的完整讲解在 [Day 32](/blog/agent-zero/day-032-modules/),你在 Day 10 已经见过 `import rich`。
- `count = 0` 计数变量,初值 0。
- `while count < 3:` 条件 `0 < 3` 成立。
- `print("还在跑,count =", count)` 每轮打印一次。
- `time.sleep(0.5)` 暂停 0.5 秒。我加这一行只是为了不让屏幕被刷爆,每秒打印两行,你有时间按键。**没有 `count += 1`**,`count` 永远是 0,条件永远成立。

</div>

```text
$ uv run python part01/while_forever.py
还在跑,count = 0
还在跑,count = 0
还在跑,count = 0
还在跑,count = 0
还在跑,count = 0
^CTraceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/while_forever.py", line 7, in <module>
    time.sleep(0.5)
KeyboardInterrupt
```

<div class="line-notes">

- `还在跑,count = 0` 每 0.5 秒一行,`count` 一直是 0。我等了 2.2 秒,共 5 行(第一行之前还有 `uv` 启动的零点几秒)。
- `^C` 这就是我按下 `Ctrl+C`(同时按住 `Control` 和 `C`)的那一下。终端把它回显成 `^C`。
- `File "/Users/你/agent-zero-lab/part01/while_forever.py", line 7, in <module>` 程序被打断时正在执行的位置:第 7 行。
- `time.sleep(0.5)` 被打断的那行代码,恰好是在睡觉的时候。
- `KeyboardInterrupt` 键盘中断。`Ctrl+C` 给 Python 发了一个信号,Python 在当前位置抛出这个错,程序就停了。

</div>

**程序卡住不动、或者疯狂刷屏,第一反应是按 `Ctrl+C`。** 如果按一次没反应,多按两三次;还不行就关掉这个终端窗口。Mac 上 `Ctrl+C` 是 Control 键,不是 Command 键。

死循环有三种常见成因,今天的练习 3 会让你碰到前两种:

1. **忘了更新变量**,就是上面这种。
2. **更新的方向反了**:`while count < 3:` 里写成 `count -= 1`,`count` 越来越小,永远小于 3。
3. **在更新变量之前就用了 `continue`**:`continue` 直接回到循环头,更新语句被跳过了。后面讲 `continue` 时会遇到。

有一点要提前说:写 Agent 的时候,死循环是**会花钱的**死循环。循环体里如果每一轮都调一次大模型,假设一次花 0.01 元、一秒跑一轮,没人管的话一小时就是 3600 轮、36 元。所以任何调 API 的 `while`,都必须同时有一道出口,今天后面会写。

## break:提前跳出

### while True 加 break

有一种写法乍看很怪:`while True:`,条件永远成立。它不是死循环,因为循环体里面藏着 `break`:一旦碰到,**立刻跳出整个循环**,继续执行循环后面的代码。这是 Python 里写「至少执行一次」的标准办法(Python 没有 `do...while`)。

场景:Day 14 的 `ask_amount.py` 问「被扣了几次」,用户输入「两次」这样的字,以前是直接崩溃(`ValueError`),Day 17 的 `refund_rule.py` 是提示一句然后结束。现在让它**问到对为止**。新建 `part01/ask_times.py`:

```python
# agent-zero-lab/part01/ask_times.py
while True:
    times_text = input("被扣了几次:").strip().removesuffix("次").strip()
    if times_text.isdigit():
        break
    print(f"「{times_text}」不是整数,请重新输入")

times = int(times_text)
print(f"记录:被扣 {times} 次")
```

<div class="line-notes">

- `while True:` 条件永远成立,循环靠里面的 `break` 退出。
- `times_text = input("被扣了几次:").strip().removesuffix("次").strip()` 一行里连着处理:读一行、去两头空白、去掉末尾的「次」、再去一次空白(Day 16)。输入 `2次` 得到 `"2"`,输入 `两次` 得到 `"两"`,输入 `abc` 得到 `"abc"`。
- `if times_text.isdigit():` 全是数字字符吗(Day 17)?`"2"` 是,`"两"` 不是,`"abc"` 不是。
- `break` 输入合格,**跳出循环**。循环体里 `break` 后面的代码这一轮不再执行。
- `print(f"「{times_text}」不是整数,请重新输入")` 不合格才会走到这里,提示一句,然后循环体结束,回到 `while True`,再问一遍。
- `times = int(times_text)` 缩进回到最左边,循环结束后才执行。这时 `times_text` 一定是合格的,`int()` 不会崩(Day 14)。
- `print(f"记录:被扣 {times} 次")` 打印结果。

</div>

```text
$ uv run python part01/ask_times.py
被扣了几次:两次
「两」不是整数,请重新输入
被扣了几次:abc
「abc」不是整数,请重新输入
被扣了几次:2次
记录:被扣 2 次
```

<div class="line-notes">

- `被扣了几次:两次` 第 1 轮,我故意敲中文数字。
- `「两」不是整数,请重新输入` 去掉「次」之后剩下「两」,`isdigit()` 为假,不 `break`,打印提示,进入第 2 轮。
- `被扣了几次:abc` 第 2 轮,又敲错。
- `「abc」不是整数,请重新输入` 第 2 轮同样没有 `break`。
- `被扣了几次:2次` 第 3 轮,敲对了。去掉「次」后是 `"2"`,`isdigit()` 为真,`break`。
- `记录:被扣 2 次` 循环外的两行。`times` 是整数 2,不是字符串 `"2"`。

</div>

这个模式有三个部分:**一个永远成立的循环头**、**一个检查合格就 `break` 的 if**、**不合格时的提示**。它的好处是「读输入」只写一遍;不用 `while True` 的话,常见写法是先读一次、再在循环里重复读一次,同样的 `input(...)` 要写两遍。

Day 17 里说过「前置校验」:先检查再动手。今天的 `while True` 加 `break` 是它的升级版:检查不通过,不是结束程序,而是**回头再来**。

### break 只管最里面的那一层

循环套循环(Day 18)时,`break` 只会跳出**它所在的那一层**循环,外层照常继续。这一点练习 2 会让你亲眼看一遍,先记住:想一口气跳出两层,`break` 办不到,常见的解决办法是把这段代码放进函数,用 `return`(Day 28),或者设一个标志变量。

## continue:跳过这一轮

`break` 是「整个循环不要了」,`continue` 是「**这一轮剩下的不要了,直接开始下一轮**」。典型用法是跳过不合格的数据。Day 18 的 10 张工单都是整整齐齐的,真实的工单文件常有空行、残缺行。新建 `part01/skip_bad.py`:

```python
# agent-zero-lab/part01/skip_bad.py
raw_lines = [
    "T001 计费 C023 10月3日和10月5日各扣了一次299元,被扣了两次",
    "",
    "  T002 登录 C007 手机验证码收不到  ",
    "T009 计费",
    "   ",
    "T003 计费 C015 想把月付改成年付,差价怎么算",
]

good = 0
skipped = 0
for no, raw in enumerate(raw_lines, start=1):
    line = raw.strip()
    if line == "":
        print(f"第 {no} 行是空行,跳过")
        skipped += 1
        continue

    parts = line.split(maxsplit=3)
    if len(parts) < 4:
        print(f"第 {no} 行只有 {len(parts)} 段,跳过:「{line}」")
        skipped += 1
        continue

    good += 1
    print(f"第 {no} 行 OK:{parts[0]} {parts[1]}")

print(f"有效 {good} 行,跳过 {skipped} 行,共 {len(raw_lines)} 行")
```

<div class="line-notes">

- `raw_lines = [` 6 行原始文本,故意混了坏的:第 2 行是空串,第 3 行两头有空格,第 4 行只有两段,第 5 行全是空格。
- `"",` 一行什么都没有。
- `"  T002 登录 C007 手机验证码收不到  ",` 两头有空格,`strip()` 能处理。
- `"T009 计费",` 只有两段,Day 16 里这一行让 `ticket_card2.py` 崩过。
- `"   ",` 三个空格,`strip()` 之后也是空串。
- `good = 0` 两个累加器,循环外设 0:有效行数。
- `skipped = 0` 跳过的行数。
- `for no, raw in enumerate(raw_lines, start=1):` Day 18 的写法,`no` 是行号 1 到 6。
- `line = raw.strip()` 先去两头空白。第 5 行 `"   "` 在这里变成 `""`。
- `if line == "":` 空行吗?
- `print(f"第 {no} 行是空行,跳过")` 空行就报一句。
- `skipped += 1` 跳过的计数加 1。
- `continue` **回到循环头,开始下一行**。`continue` 后面的 `parts = ...`、`good += 1` 这一轮都不会执行,所以后面的代码可以放心假设「这一行不是空的」。
- `parts = line.split(maxsplit=3)` 能走到这里的行一定非空。拆成最多 4 段。
- `if len(parts) < 4:` 段数不够(Day 17 的 `ticket_card2.py` 检查)。
- `print(f"第 {no} 行只有 {len(parts)} 段,跳过:「{line}」")` 提示是哪一行、有几段、原文是什么。
- `good += 1` 能走到这里的行才算有效。
- `print(f"第 {no} 行 OK:{parts[0]} {parts[1]}")` 打印工单号和类别。
- `print(f"有效 {good} 行,跳过 {skipped} 行,共 {len(raw_lines)} 行")` 缩进回到最左边,全部跑完后打印汇总。

</div>

```text
$ uv run python part01/skip_bad.py
第 1 行 OK:T001 计费
第 2 行是空行,跳过
第 3 行 OK:T002 登录
第 4 行只有 2 段,跳过:「T009 计费」
第 5 行是空行,跳过
第 6 行 OK:T003 计费
有效 3 行,跳过 3 行,共 6 行
```

<div class="line-notes">

- `第 1 行 OK:T001 计费` 第 1 行是好的,没碰到任何 `continue`,一路走到最后的 `print`。
- `第 2 行是空行,跳过` 第 2 行 `""`,走了第一个 `continue`。
- `第 3 行 OK:T002 登录` 第 3 行两头的空格被 `strip()` 去掉了,是好的。
- `第 4 行只有 2 段,跳过:「T009 计费」` 第 4 行拆出 `["T009", "计费"]` 两段,走了第二个 `continue`。
- `第 5 行是空行,跳过` 第 5 行 `"   "` 先被 `strip()` 变成 `""`,走第一个 `continue`。
- `第 6 行 OK:T003 计费` 第 6 行好的。
- `有效 3 行,跳过 3 行,共 6 行` 3 + 3 = 6,和 `len(raw_lines)` 对得上。

</div>

对比一下 `if`/`else` 的写法:如果不用 `continue`,每个检查都要再套一层缩进,三个检查就是四层缩进,正常逻辑被埋在最里面。`continue` 让每道关卡各占一块,「不合格就走开」,剩下的一路往下读。这叫**卫语句**(guard clause),写代码时很常用。

### continue 的陷阱:跳过了更新

在 `for` 里 `continue` 没有风险,因为 `for` 自己负责取下一个元素。但在 `while` 里,**更新变量的那一行如果在 `continue` 的后面,就被跳过了**,变量永远不变,死循环。这是死循环的第三种成因,练习 3 会让你亲手踩一次。规则很简单:`while` 里的更新语句要么放在循环体最前面,要么确保每条路径都会经过它。能用 `for` 就不要在 `while` 里自己管计数器。

## 重试:最多三次

### 一个带上限的重试循环

调接口会超时。重试是对付偶发故障的标准办法,但一定要有上限:「超时了就一直重试」遇到对方真的挂了,就是死循环加一直在敲对方的门。新建 `part01/retry_basic.py`,先用「假装第几次会成功」代替真的接口:

```python
# agent-zero-lab/part01/retry_basic.py
MAX_TRIES = 3
succeed_on = int(input("假装第几次调用会成功(1 到 5):"))

attempt = 0
success = False
while attempt < MAX_TRIES:
    attempt += 1
    print(f"第 {attempt} 次调用支付接口……", end=" ")
    if attempt == succeed_on:
        print("成功")
        success = True
        break
    print("超时")

if success:
    print(f"一共调用了 {attempt} 次,拿到结果")
else:
    print(f"调用了 {MAX_TRIES} 次都超时,放弃")
```

<div class="line-notes">

- `MAX_TRIES = 3` 最多尝试 3 次。**全大写的名字是 Python 程序员的约定,表示常量**:程序运行时不改它的值。语言本身不阻止你改,这只是写给读代码的人看的。
- `succeed_on = int(input("假装第几次调用会成功(1 到 5):"))` 我用输入代替真实的接口:输入几,就假装第几次调用才成功。输入 5 就是「三次内都不会成功」。
- `attempt = 0` 已经尝试的次数,从 0 开始。
- `success = False` 一个「标志变量」:到目前为止成功了吗?先假定没有。
- `while attempt < MAX_TRIES:` 次数还没用完就继续。`attempt` 是 0、1、2 的时候成立,变成 3 就退出,所以最多进循环体 3 次。
- `attempt += 1` 先加 1,表示「这是第几次」。放在循环体**最前面**,保证每一轮都会更新,不怕后面的 `break` 或 `continue`。
- `print(f"第 {attempt} 次调用支付接口……", end=" ")` `end=" "` 让 `print` 结尾不换行,改成一个空格,后面的「成功」或「超时」会接在同一行。`print` 默认的 `end` 是换行符 `"\n"`。
- `if attempt == succeed_on:` 这一次是不是假装成功的那次?
- `print("成功")` 成功了,接在同一行后面。
- `success = True` 记下成功了。
- `break` 成功了就**不要再重试**,直接跳出。
- `print("超时")` 能走到这里,说明这一次没成功(成功的话已经 `break`)。打印「超时」后循环体结束,回到循环头检查次数。
- `if success:` 循环结束后,要分清是怎么出来的:是 `break` 出来的(成功),还是次数用完出来的(放弃)。标志变量 `success` 就是用来区分这两种出口的。
- `print(f"一共调用了 {attempt} 次,拿到结果")` 成功分支。
- `else:` 放弃分支。
- `print(f"调用了 {MAX_TRIES} 次都超时,放弃")` 三次全失败。**不能省**,不然程序悄悄结束,调用者以为成功了。

</div>

```text
$ uv run python part01/retry_basic.py
假装第几次调用会成功(1 到 5):3
第 1 次调用支付接口…… 超时
第 2 次调用支付接口…… 超时
第 3 次调用支付接口…… 成功
一共调用了 3 次,拿到结果
$ uv run python part01/retry_basic.py
假装第几次调用会成功(1 到 5):5
第 1 次调用支付接口…… 超时
第 2 次调用支付接口…… 超时
第 3 次调用支付接口…… 超时
调用了 3 次都超时,放弃
$ uv run python part01/retry_basic.py
假装第几次调用会成功(1 到 5):1
第 1 次调用支付接口…… 成功
一共调用了 1 次,拿到结果
```

<div class="line-notes">

- `假装第几次调用会成功(1 到 5):3` 第一次运行,输入 3。
- `第 1 次调用支付接口…… 超时` 第 1 轮:`attempt == 1`,不等于 3,所以打印「超时」。注意「超时」接在同一行末尾,就是 `end=" "` 的效果。
- `第 3 次调用支付接口…… 成功` 第 3 轮:`3 == 3`,打印成功,`success` 变 True,`break`。
- `一共调用了 3 次,拿到结果` `success` 为真,走成功分支。
- `假装第几次调用会成功(1 到 5):5` 第二次运行,输入 5:3 次内都不会成功。
- `第 3 次调用支付接口…… 超时` 第 3 轮也超时,`attempt` 变成 3,回到循环头 `3 < 3` 不成立,正常退出。
- `调用了 3 次都超时,放弃` `success` 一直是 False,走放弃分支。
- `假装第几次调用会成功(1 到 5):1` 第三次运行,输入 1:第一次就成功。
- `一共调用了 1 次,拿到结果` 成功了,只调了 1 次,没有白白多调两次。

</div>

三次运行覆盖了三种出口:第 3 次成功(中途 `break`)、三次都失败(次数用完)、第 1 次就成功(最早 `break`)。每种出口都要有一组输入走过(Day 17 的教训)。

### 失败后等一等:指数退避

真实的重试几乎都要**等一等再试**。对方超时多半是太忙,你立刻又敲一下,只会让它更忙。常见的做法是每失败一次,等的时间翻倍:第一次失败等 1 秒,第二次失败等 2 秒,第三次 4 秒……这叫指数退避(exponential backoff)。新建 `part01/retry_backoff.py`:

```python
# agent-zero-lab/part01/retry_backoff.py
import time

MAX_TRIES = 3
succeed_on = int(input("假装第几次调用会成功(1 到 5):"))

start = time.monotonic()
attempt = 0
wait = 1
success = False
while attempt < MAX_TRIES:
    attempt += 1
    print(f"第 {attempt} 次调用……", end=" ")
    if attempt == succeed_on:
        print("成功")
        success = True
        break
    if attempt < MAX_TRIES:
        print(f"超时,等 {wait} 秒再试")
        time.sleep(wait)
        wait *= 2
    else:
        print("超时")

elapsed = time.monotonic() - start
print(f"结果:{'成功' if success else '放弃'},共用了 {elapsed:.1f} 秒")
```

<div class="line-notes">

- `import time` 引入时间模块,用它的 `sleep` 和 `monotonic`。
- `MAX_TRIES = 3` 最多 3 次。
- `succeed_on = int(input("假装第几次调用会成功(1 到 5):"))` 同上。
- `start = time.monotonic()` 记下开始时间。`monotonic()` 返回一个只增不减的秒数,专门用来测「过了多久」,不受系统改时钟的影响。
- `attempt = 0` 已尝试次数。
- `wait = 1` 下一次失败后要等几秒,从 1 秒开始。
- `success = False` 同上,标志变量。
- `while attempt < MAX_TRIES:` 同上。
- `attempt += 1` 同上,放在最前面。
- `print(f"第 {attempt} 次调用……", end=" ")` 不换行。
- `if attempt == succeed_on:` 这一次成功吗?
- `print("成功")` 成功。
- `success = True` 记下。
- `break` 跳出,不用再等。
- `if attempt < MAX_TRIES:` 失败了,但**后面还会再试**吗?第 1、2 次失败后还会,第 3 次失败后不会再试了。
- `print(f"超时,等 {wait} 秒再试")` 提示要等多久。
- `time.sleep(wait)` 真的暂停 `wait` 秒。第 1 次失败暂停 1 秒。
- `wait *= 2` `wait` 翻倍。`*=` 和 `+=` 是一类写法,`wait *= 2` 等于 `wait = wait * 2`。第 1 次失败后变成 2,第 2 次失败后变成 4。
- `else:` 第 3 次失败,不会再试了。
- `print("超时")` 只打印「超时」,**不再傻等**。最后一次失败还睡一觉是浪费时间。
- `elapsed = time.monotonic() - start` 现在的时间减去开始的时间,得到总共用了几秒。
- `print(f"结果:{'成功' if success else '放弃'},共用了 {elapsed:.1f} 秒")` 用 Day 17 的条件表达式,在 f-string 里选「成功」或「放弃」;`:.1f` 保留一位小数。

</div>

```text
$ uv run python part01/retry_backoff.py
假装第几次调用会成功(1 到 5):3
第 1 次调用…… 超时,等 1 秒再试
第 2 次调用…… 超时,等 2 秒再试
第 3 次调用…… 成功
结果:成功,共用了 3.0 秒
$ uv run python part01/retry_backoff.py
假装第几次调用会成功(1 到 5):5
第 1 次调用…… 超时,等 1 秒再试
第 2 次调用…… 超时,等 2 秒再试
第 3 次调用…… 超时
结果:放弃,共用了 3.0 秒
```

<div class="line-notes">

- `假装第几次调用会成功(1 到 5):3` 第一次运行,输入 3。
- `第 1 次调用…… 超时,等 1 秒再试` 第 1 次失败,`wait` 是 1,真的暂停了 1 秒。
- `第 2 次调用…… 超时,等 2 秒再试` 第 2 次失败,`wait` 翻倍成了 2,暂停 2 秒。
- `第 3 次调用…… 成功` 第 3 次成功,`break`,没有再等。
- `结果:成功,共用了 3.0 秒` 1 + 2 = 3 秒,加上程序本身的几毫秒,保留一位小数是 3.0。
- `假装第几次调用会成功(1 到 5):5` 第二次运行,输入 5。
- `第 3 次调用…… 超时` 第 3 次也失败,但这是最后一次,走 `else`,只打印「超时」。
- `结果:放弃,共用了 3.0 秒` 前两次失败各等了 1 秒和 2 秒,第 3 次失败后没有再等,一共还是 3 秒。

</div>

下面是三次尝试的时间线:

<figure>
<svg viewBox="0 0 640 190" role="img" aria-label="重试时间线:第 1 次调用超时,等 1 秒;第 2 次调用超时,等 2 秒;第 3 次调用成功,停止。上限是 3 次,如果第 3 次也失败就放弃">
<rect x="0" y="0" width="640" height="190" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="50" width="130" height="50" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="32" y="72" fill="var(--ink)">第 1 次调用</text>
<text x="32" y="90" fill="var(--ink-soft)">超时</text>
<line x1="150" y1="75" x2="214" y2="75" stroke="var(--ink-soft)"/>
<text x="158" y="66" fill="var(--ink-soft)">等 1 秒</text>
<rect x="214" y="50" width="130" height="50" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="226" y="72" fill="var(--ink)">第 2 次调用</text>
<text x="226" y="90" fill="var(--ink-soft)">超时</text>
<line x1="344" y1="75" x2="428" y2="75" stroke="var(--ink-soft)"/>
<text x="360" y="66" fill="var(--ink-soft)">等 2 秒</text>
<rect x="428" y="50" width="130" height="50" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="440" y="72" fill="var(--ink)">第 3 次调用</text>
<text x="440" y="90" fill="var(--ink-soft)">成功,break</text>
<line x1="20" y1="132" x2="620" y2="132" stroke="var(--rule)"/>
<text x="20" y="156" fill="var(--ink)">上限 MAX_TRIES = 3:第 3 次也超时就不再等,直接走「放弃」</text>
<text x="20" y="176" fill="var(--ink-faint)">等待时间翻倍:1 秒、2 秒、(4 秒……),这叫指数退避</text>
</g>
</svg>
<figcaption>retry_backoff.py 输入 3 时的时间线。琥珀色是失败,蓝色是成功;最后一次失败后不再等。</figcaption>
</figure>

真实系统里还会再加一个小小的随机数(叫抖动,jitter),免得一万个客户端在同一个整秒一起重试,又把对方压垮。今天不写,[Day 190](/blog/agent-zero/day-190-failures-2/) 会用现成的库 tenacity,几行就搞定重试、退避和抖动。亚马逊的一篇工程文章《Timeouts, retries, and backoff with jitter》把这件事讲得很透,学习资料里有链接。

### Agent 循环的玩具版

大模型 Agent 的核心就是一个 `while`:**调模型 → 如果模型要用工具就执行工具、把结果交回去 → 再调模型……直到模型给出最终答复**。次数不知道,所以是 `while`;怕模型一直不答复,所以要有最大步数。现在还没有 API,我先用一个剧本代替模型:新建 `part01/agent_loop_toy.py`:

```python
# agent-zero-lab/part01/agent_loop_toy.py
MAX_STEPS = 5
replies = [
    "工具:查客户 C023",
    "工具:查发票 C023",
    "答复:已核实重复扣款,建议退款 299 元",
]
stuck = input("假装模型一直不给答复吗(y/n):").strip().lower() == "y"

step = 0
while True:
    step += 1
    if stuck:
        reply = replies[0]
    else:
        reply = replies[step - 1]
    print(f"第 {step} 步,模型说:{reply}")

    if "答复" in reply:
        print("模型给出了最终答复,结束")
        break
    print("  (执行工具,把结果交还给模型)")
    if step >= MAX_STEPS:
        print(f"已经跑了 {MAX_STEPS} 步还没有答复,强制停止")
        break
```

<div class="line-notes">

- `MAX_STEPS = 5` 最大步数,Agent 循环的保险。常量,全大写。
- `replies = [` 模型的三句「台词」:前两句要用工具,第三句是最终答复。
- `"工具:查客户 C023",` 第 1 句,模型想先查客户。
- `"工具:查发票 C023",` 第 2 句,再查发票。
- `"答复:已核实重复扣款,建议退款 299 元",` 第 3 句,给出答复。
- `stuck = input("假装模型一直不给答复吗(y/n):").strip().lower() == "y"` 输入 `y` 就模拟「模型发疯,永远只重复第一句」。这一整行是 Day 17 练习 1 里读 y/n 的写法。
- `step = 0` 当前是第几步。
- `while True:` 不知道要跑几步,所以用 `while True`,靠 `break` 出去。
- `step += 1` 步数加 1,放在最前面。
- `if stuck:` 发疯模式。
- `reply = replies[0]` 发疯时永远取第 1 句。
- `else:` 正常模式。
- `reply = replies[step - 1]` 第 1 步取下标 0,第 2 步取下标 1,第 3 步取下标 2。下标从 0 开始(Day 15),所以要减 1。
- `print(f"第 {step} 步,模型说:{reply}")` 打印模型这一步说了什么。
- `if "答复" in reply:` 模型给出最终答复了吗?
- `print("模型给出了最终答复,结束")` 是。
- `break` 正常出口:跳出循环。
- `print("  (执行工具,把结果交还给模型)")` 能走到这里,说明模型要的是工具,这里假装执行了。
- `if step >= MAX_STEPS:` 已经跑满 5 步了吗?
- `print(f"已经跑了 {MAX_STEPS} 步还没有答复,强制停止")` 是,强制停止。
- `break` 保险出口:不管模型想干什么,到了上限就停。

</div>

```text
$ uv run python part01/agent_loop_toy.py
假装模型一直不给答复吗(y/n):n
第 1 步,模型说:工具:查客户 C023
  (执行工具,把结果交还给模型)
第 2 步,模型说:工具:查发票 C023
  (执行工具,把结果交还给模型)
第 3 步,模型说:答复:已核实重复扣款,建议退款 299 元
模型给出了最终答复,结束
$ uv run python part01/agent_loop_toy.py
假装模型一直不给答复吗(y/n):y
第 1 步,模型说:工具:查客户 C023
  (执行工具,把结果交还给模型)
第 2 步,模型说:工具:查客户 C023
  (执行工具,把结果交还给模型)
第 3 步,模型说:工具:查客户 C023
  (执行工具,把结果交还给模型)
第 4 步,模型说:工具:查客户 C023
  (执行工具,把结果交还给模型)
第 5 步,模型说:工具:查客户 C023
  (执行工具,把结果交还给模型)
已经跑了 5 步还没有答复,强制停止
```

<div class="line-notes">

- `假装模型一直不给答复吗(y/n):n` 第一次运行,输入 `n`,正常模式。
- `第 1 步,模型说:工具:查客户 C023` 第 1 步取第 1 句,不含「答复」,不 `break`。
- `(执行工具,把结果交还给模型)` 假装执行工具。
- `第 3 步,模型说:答复:已核实重复扣款,建议退款 299 元` 第 3 步,模型给出答复。
- `模型给出了最终答复,结束` 正常出口,只跑了 3 步。
- `假装模型一直不给答复吗(y/n):y` 第二次运行,输入 `y`,模型发疯。
- `第 5 步,模型说:工具:查客户 C023` 第 5 步,还在重复第 1 句。
- `已经跑了 5 步还没有答复,强制停止` 到了 `MAX_STEPS`,保险出口把循环切断。没有它,这个循环会一直转下去,每一步都在花钱。

</div>

这 20 行就是第三部分「Agent 循环」的骨架。真实版本里,「模型说」换成一次 API 调用,「执行工具」换成真的函数,出口再多几个(预算、重复检测),但骨架不变:`while True`、每轮更新状态、一个正常出口加至少一个保险出口。[Day 165](/blog/agent-zero/day-165-agent-what/) 讲 Agent 是什么,[Day 166](/blog/agent-zero/day-166-agent-min/) 写第一个 25 行的真版本,[Day 192](/blog/agent-zero/day-192-failures-4/) 专门讲循环检测和预算收尾。到那时你会觉得熟悉,因为今天已经写过了。

写完检查一遍:

```text
$ uv run ruff check part01/while_basic.py part01/while_forever.py part01/ask_times.py part01/skip_bad.py part01/retry_basic.py part01/retry_backoff.py part01/agent_loop_toy.py
All checks passed!
$ uv run ruff format --check part01/while_basic.py part01/while_forever.py part01/ask_times.py part01/skip_bad.py part01/retry_basic.py part01/retry_backoff.py part01/agent_loop_toy.py
7 files already formatted
```

<div class="line-notes">

- `All checks passed!` Ruff 检查通过。`while_forever.py` 的死循环不是语法问题,Ruff 不会报。
- `7 files already formatted` 格式化检查也过了。

</div>

basedpyright 在编辑器里对这七个脚本零报错。注意:**类型检查器和 Ruff 都发现不了死循环**。`while_forever.py` 语法没毛病、类型没毛病,它只是永远停不下来。这类问题只能靠你自己:每写一个 `while`,先问「条件靠什么变成不成立」。

| 今天的零件 | 在 `retry_basic.py` / `retry_backoff.py` 里是哪一步 |
| --- | --- |
| `while 条件:` | `while attempt < MAX_TRIES:` 次数没用完就继续 |
| 计数器在循环最前面更新 | `attempt += 1` 放在循环体第一行,不怕 `break` |
| `break` | 成功就跳出,不再多调 |
| 标志变量 | `success` 区分「break 出来」和「次数用完」 |
| 循环后分两种出口 | `if success:` 成功分支,`else:` 放弃分支 |
| `continue` | 重试里没用到,`skip_bad.py` 里用来跳过坏行 |
| 常量 | `MAX_TRIES = 3`,全大写表示不改 |
| 指数退避 | `time.sleep(wait)` 加 `wait *= 2`,最后一次失败不再等 |
| 最大步数 | `agent_loop_toy.py` 里的 `MAX_STEPS`,Agent 循环的保险 |

## 动手练习

### 练习 1:登录三次机会

写 `part01/ex19_1_login.py`:程序里写死一个演示密码 `demo-1234`,让用户输入密码,最多 3 次机会。输对了打印「登录成功」并立刻停止;每次输错提示「密码不对」,并在提示里显示还剩几次;三次都错打印「三次都输错了,账号已锁定」。用两组输入各跑一次:`wrong`、`1234`、`demo-1234`(第 3 次对),以及 `a`、`b`、`c`(三次全错)。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex19_1_login.py
SECRET = "demo-1234"
MAX_TRIES = 3

tries_left = MAX_TRIES
logged_in = False
while tries_left > 0:
    password = input(f"密码(还剩 {tries_left} 次机会):")
    if password == SECRET:
        logged_in = True
        break
    tries_left -= 1
    print("密码不对")

if logged_in:
    print("登录成功")
else:
    print("三次都输错了,账号已锁定")
```

<div class="line-notes">

- `SECRET = "demo-1234"` 演示用的假密码。**真密码绝不写进代码**,会被提交到 git 里,Day 53 讲怎么放进 `.env`。
- `MAX_TRIES = 3` 最多 3 次,常量。
- `tries_left = MAX_TRIES` 剩余机会。用「剩几次」而不是「用了几次」,提示语里直接能显示。
- `logged_in = False` 标志变量,区分「break 出来」(成功)和「次数用完」(锁定)。
- `while tries_left > 0:` 还有机会就继续。`tries_left` 是 3、2、1 时成立,减到 0 退出。
- `password = input(f"密码(还剩 {tries_left} 次机会):")` 提示里带着剩余次数,用 f-string。
- `if password == SECRET:` 对了吗?
- `logged_in = True` 对了,记下来。
- `break` 立刻跳出,不再问。
- `tries_left -= 1` 能走到这里就是输错了,机会减 1。`-=` 和 `+=` 是一类。
- `print("密码不对")` 提示。
- `if logged_in:` 循环结束后分两种出口。
- `print("登录成功")` 成功分支。
- `else:` 失败分支。
- `print("三次都输错了,账号已锁定")` 锁定。

</div>

```text
$ uv run python part01/ex19_1_login.py
密码(还剩 3 次机会):wrong
密码不对
密码(还剩 2 次机会):1234
密码不对
密码(还剩 1 次机会):demo-1234
登录成功
$ uv run python part01/ex19_1_login.py
密码(还剩 3 次机会):a
密码不对
密码(还剩 2 次机会):b
密码不对
密码(还剩 1 次机会):c
密码不对
三次都输错了,账号已锁定
```

<div class="line-notes">

- `密码(还剩 3 次机会):wrong` 第一组,第 1 次,`tries_left` 是 3。
- `密码(还剩 2 次机会):1234` 第 2 次输错后 `tries_left` 变 2。
- `密码(还剩 1 次机会):demo-1234` 第 3 次,最后一次机会,输对了。
- `登录成功` `break` 出来,`logged_in` 是 `True`。注意这一次没有再打印「密码不对」。
- `密码(还剩 3 次机会):a` 第二组,从头开始。
- `密码(还剩 1 次机会):c` 第 3 次也错。
- `三次都输错了,账号已锁定` `tries_left` 减到 0,条件不成立,正常退出,`logged_in` 仍是 `False`。

</div>

真正的程序输入密码时屏幕不能回显,要用标准库的 `getpass`,它和 `input` 用法几乎一样。这里为了让你看到输入内容,用了 `input`。

</details>

### 练习 2:先猜,再跑

下面 `part01/ex19_2_guess.py` 一共会输出 10 行。先在纸上写出每一行,再跑。特别留意第二个循环:`break` 到底跳出了几层。

```python
# agent-zero-lab/part01/ex19_2_guess.py
n = 0
while n < 6:
    n += 1
    if n % 2 == 0:
        continue
    if n == 5:
        break
    print(n)
print("n =", n)

for x in range(3):
    for y in range(3):
        if y == 2:
            break
        print(x, y)

count = 0
while True:
    count += 1
    if count * count > 30:
        break
print(count)
```

<details><summary>参考答案</summary>

```text
$ uv run python part01/ex19_2_guess.py
1
3
n = 5
0 0
0 1
1 0
1 1
2 0
2 1
6
```

<div class="line-notes">

- `1` `n` 变成 1,是奇数(`1 % 2` 是 1,不等于 0),不是 5,打印 1。
- `3` `n` 变成 2,偶数,`continue` 直接回循环头,不打印;`n` 变成 3,打印 3。
- `n = 5` `n` 变成 4,偶数跳过;`n` 变成 5,不是偶数,走到 `n == 5`,`break`。5 没有被打印,循环也没有再检查 `n < 6`,`n` 停在 5。
- `0 0` 第二块,外层 `x = 0`,里层 `y = 0`,不等于 2,打印。
- `0 1` `y = 1`,打印。
- `1 0` `y = 2` 时碰到 `break`,只跳出里层;外层继续,`x = 1`,里层从 `y = 0` 重新开始。
- `2 1` 外层最后一轮 `x = 2`,里层打印 `2 0`、`2 1` 之后碰到 `break`。一共 6 行,不是 9 行:每个 `x` 的里层都只打印 `y = 0` 和 `y = 1`。
- `6` 第三块,`count` 加到 6,`6 * 6 = 36` 大于 30 跳出;`count = 5` 时 `25` 还不大于 30。

</div>

要点:第一块里 `continue` 只是跳过这一轮的剩余部分,循环继续;`break` 是整个循环不要了。第二块里 `break` 只管里层。第三块是 `while True` 加 `break` 的标准形态:循环头永远成立,出口全在循环体里。

</details>

### 练习 3:找出两个错

`part01/ex19_3_bug.py` 想数出 5 行里有几行不是空行,应该得到 3。它有两个错,而且第一个错会把第二个错藏起来。先跑它(它不会自己停,等 1 到 2 秒按 `Ctrl+C`),修掉第一个错再跑,看第二个错露出来,最后全部修好。

```python
# agent-zero-lab/part01/ex19_3_bug.py
tickets = ["T001", "", "T003", "", "T005"]

i = 0
done = 0
while i <= len(tickets):
    line = tickets[i]
    if line == "":
        continue
    done += 1
    i += 1
print("处理了", done, "张")
```

<details><summary>参考答案</summary>

```text
$ uv run python part01/ex19_3_bug.py
^CTraceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex19_3_bug.py", line 9, in <module>
    continue
KeyboardInterrupt
```

<div class="line-notes">

- `^C` 我等了 1.5 秒按的 `Ctrl+C`。程序没有打印任何东西,最后的 `print` 也没有执行。
- `File "/Users/你/agent-zero-lab/part01/ex19_3_bug.py", line 9, in <module>` 被打断时停在第 9 行。
- `continue` 就是这一行:停在 `continue` 上,说明程序一直在重复执行它。
- `KeyboardInterrupt` 被 `Ctrl+C` 打断。

</div>

**第一个错:`continue` 跳过了 `i += 1`。** `i` 等于 1 的时候(第二个元素是空串),`continue` 直接回到循环头,`i += 1` 没机会执行,`i` 永远是 1,于是永远在同一行打转。修法:把 `i += 1` 挪到 `continue` 前面,最稳妥的位置是取完元素的下一行。改完的 `part01/ex19_3_bug_a.py`:

```python
# agent-zero-lab/part01/ex19_3_bug_a.py
tickets = ["T001", "", "T003", "", "T005"]

i = 0
done = 0
while i <= len(tickets):
    line = tickets[i]
    i += 1
    if line == "":
        continue
    done += 1
print("处理了", done, "张")
```

<div class="line-notes">

- `tickets = ["T001", "", "T003", "", "T005"]` 五行,其中 2 行是空串。
- `i = 0` 下标。
- `done = 0` 累加器。
- `while i <= len(tickets):` **第二个错藏在这里**:条件是 `<=`。`len(tickets)` 是 5,下标最大是 4。
- `line = tickets[i]` 取第 `i` 行。
- `i += 1` 已经挪到 `if` 前面,每一轮都一定会执行。
- `if line == "":` 空行就跳过。
- `continue` 现在安全了。
- `done += 1` 非空行计数。
- `print("处理了", done, "张")` 汇总。

</div>

```text
$ uv run python part01/ex19_3_bug_a.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex19_3_bug_a.py", line 7, in <module>
    line = tickets[i]
           ~~~~~~~^^^
IndexError: list index out of range
```

<div class="line-notes">

- `File "/Users/你/agent-zero-lab/part01/ex19_3_bug_a.py", line 7, in <module>` 出错在第 7 行,取元素那行。
- `line = tickets[i]` 错出在这里。
- `IndexError: list index out of range` 下标越界。

</div>

**第二个错:`<=` 多转了一圈。** 五个元素的下标是 0 到 4。`i` 变成 5 时,条件 `5 <= 5` 还成立,`tickets[5]` 就越界了。这就是 Day 15 讲过的差一错误(off-by-one)。第一个错不修,程序永远走不到 `i = 5`,所以看不到这个错,这就是「藏起来」。修法:条件改成 `i < len(tickets)`。两个都改好的 `part01/ex19_3_fixed.py`:

```python
# agent-zero-lab/part01/ex19_3_fixed.py
tickets = ["T001", "", "T003", "", "T005"]

i = 0
done = 0
while i < len(tickets):
    line = tickets[i]
    i += 1
    if line == "":
        continue
    done += 1
print("处理了", done, "张")
```

<div class="line-notes">

- `tickets = ["T001", "", "T003", "", "T005"]` 同上。
- `i = 0` 下标。
- `done = 0` 累加器。
- `while i < len(tickets):` 改成 `<`:`i` 是 0 到 4 时成立,变成 5 就停。
- `line = tickets[i]` 取元素。
- `i += 1` 先更新。
- `if line == "":` 空行。
- `continue` 跳过。
- `done += 1` 计数。
- `print("处理了", done, "张")` 汇总。

</div>

```text
$ uv run python part01/ex19_3_fixed.py
处理了 3 张
```

<div class="line-notes">

- `处理了 3 张` T001、T003、T005 三张,两个空行被跳过。

</div>

不过最好的改法是根本不用 `while`:`for line in tickets:` 加 `if line == "": continue`。能用 `for` 就用 `for`,它自己负责下标,上面两个错一个也不会有。这道题的目的是让你认出这两种死循环和越界的样子,以后在别处碰到不会慌。

</details>

### 练习 4:余额够扣几个月

客户预存了 500 元,每个月自动扣 49 元月费(Day 12 的价格)。写 `part01/ex19_4_balance.py`:用 `while` 一个月一个月地扣,每扣一次打印「第 N 个月扣 49.00 元,余额 X 元」,余额不够扣下一个月就停,最后打印一共扣了几个月、还剩多少。金额用整数分算。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex19_4_balance.py
balance_fen = 50000
monthly_fen = 4900

month = 0
while balance_fen >= monthly_fen:
    month += 1
    balance_fen -= monthly_fen
    print(
        f"第 {month:2} 个月扣 {monthly_fen / 100:.2f} 元,余额 {balance_fen / 100:7.2f} 元"
    )

print(
    f"余额 {balance_fen / 100:.2f} 元,不够扣第 {month + 1} 个月,一共扣了 {month} 个月"
)
```

<div class="line-notes">

- `balance_fen = 50000` 余额 500 元,换成分。
- `monthly_fen = 4900` 月费 49 元,换成分。
- `month = 0` 已经扣了几个月。
- `while balance_fen >= monthly_fen:` 余额还够扣一个月,就继续。`>=` 含等号:余额刚好等于月费,也能扣最后一次。
- `month += 1` 月数加 1,放在循环体最前面。
- `balance_fen -= monthly_fen` 余额减去月费。第 1 轮 50000 − 4900 = 45100。
- `f"第 {month:2} 个月扣 {monthly_fen / 100:.2f} 元,余额 {balance_fen / 100:7.2f} 元"` 金额用 `/ 100` 变回元,只在显示这一刻;`{month:2}` 和 `{... :7.2f}` 是宽度说明,让每行对齐。
- `f"余额 {balance_fen / 100:.2f} 元,不够扣第 {month + 1} 个月,一共扣了 {month} 个月"` 循环结束后:`balance_fen` 是 1000 分,不够 4900。「第几个月不够」是 `month + 1`,因为 `month` 记的是已经扣了的月数。

</div>

```text
$ uv run python part01/ex19_4_balance.py
第  1 个月扣 49.00 元,余额  451.00 元
第  2 个月扣 49.00 元,余额  402.00 元
第  3 个月扣 49.00 元,余额  353.00 元
第  4 个月扣 49.00 元,余额  304.00 元
第  5 个月扣 49.00 元,余额  255.00 元
第  6 个月扣 49.00 元,余额  206.00 元
第  7 个月扣 49.00 元,余额  157.00 元
第  8 个月扣 49.00 元,余额  108.00 元
第  9 个月扣 49.00 元,余额   59.00 元
第 10 个月扣 49.00 元,余额   10.00 元
余额 10.00 元,不够扣第 11 个月,一共扣了 10 个月
```

<div class="line-notes">

- `第  1 个月扣 49.00 元,余额  451.00 元` 第 1 轮:50000 − 4900 = 45100 分。
- `第 10 个月扣 49.00 元,余额   10.00 元` 第 10 轮:余额 1000 分,即 10 元。
- `余额 10.00 元,不够扣第 11 个月,一共扣了 10 个月` 10 元小于 49 元,条件不成立,退出。500 ÷ 49 = 10 余 10,和 `//`、`%` 的结果一致(Day 12),这里用循环一个月一个月走了一遍。

</div>

和 Day 18 的 `sum_loop.py` 比较:那里 12 个月是定死的,用 `for`;这里「够扣几个月」取决于余额,开跑前不知道,所以用 `while`。如果只想知道结果,`500 * 100 // 4900` 一行就够了,循环的价值是能把每个月的过程打印出来。

</details>

练习的验收标准:`while_basic.py`、`while_forever.py`(能用 `Ctrl+C` 停下它)、`ask_times.py`、`skip_bad.py`、`retry_basic.py`、`retry_backoff.py`、`agent_loop_toy.py` 和四道练习都能跑,输出和文中一致;能不看文章说出什么时候用 `while`、`while True` 加 `break` 为什么能代替 `do...while`、`break` 和 `continue` 各管什么、`continue` 为什么会造成死循环;能默写 `retry_basic.py`,并且三种出口(第 3 次成功、三次都失败、第 1 次成功)各跑一遍。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| `while` 循环 | `while 条件:`,条件成立就一直执行缩进的代码,每轮开头检查一次条件 |
| 死循环(infinite loop) | 条件永远不变成不成立,循环永远停不下来 |
| `Ctrl+C` | 终端里的中断键,让正在运行的程序停下,Python 里表现为 `KeyboardInterrupt` |
| `KeyboardInterrupt` | 按下 `Ctrl+C` 后 Python 抛出的错,不是 bug,是你主动叫停 |
| `break` | 立刻跳出它所在的那一层循环,继续执行循环后面的代码 |
| `continue` | 结束这一轮剩下的部分,直接开始下一轮 |
| `while True` | 条件永远成立的循环,靠里面的 `break` 退出;Python 里代替 `do...while` |
| 卫语句(guard clause) | 在循环或函数开头先检查「不合格就走开」,剩下的代码不用再多套一层缩进 |
| 标志变量 | 记录某件事有没有发生的变量,如 `success`,用来区分循环的不同出口 |
| 常量 | 运行中不改的值,Python 约定全大写命名,如 `MAX_TRIES` |
| 重试(retry) | 一次操作失败后再做一遍,通常有次数上限 |
| 指数退避(exponential backoff) | 每次失败后等待时间翻倍:1 秒、2 秒、4 秒…… |
| 抖动(jitter) | 在等待时间上加一点随机数,避免大量客户端同一时刻一起重试,Day 190 讲 |
| `time.sleep(秒)` | 让程序暂停指定的秒数 |
| `time.monotonic()` | 返回一个只增不减的秒数,用来测一段代码花了多久 |
| `end=" "` | `print` 的参数,让结尾不换行,改成指定的字符 |
| 最大步数 | Agent 循环里限制最多转几轮的上限,防止模型一直不给答复 |
| 差一错误(off-by-one) | 循环或下标多一个或少一个,如 `<=` 误写成 `<` |

## 常见误区

**忘了更新循环条件里的变量。** `while count < 3:` 里没有 `count += 1`,死循环。每写一个 `while`,先问条件靠什么变成假。

**把更新语句放在 `continue` 后面。** `continue` 直接回循环头,后面的更新被跳过,又是死循环。更新语句放在循环体最前面,或者改用 `for`。

**以为 `break` 能跳出所有层。** 它只跳出最里面那一层,外层照常继续。

**以为 `continue` 和 `break` 一样会结束整个循环。** `continue` 只结束这一轮,下一轮照常开始。

**用 `while` 写本该用 `for` 的循环。** 遍历列表、数固定次数用 `for`,自己管下标和计数器的 `while` 容易出差一错误和死循环。

**重试没有上限。** `while True` 加失败就重试,对方真的挂了就一直敲门,还可能一直在花钱。永远有最大次数,并且次数用完要有明确的「放弃」分支。

**次数用完后悄悄结束。** 没有写放弃分支,调用者以为成功了。循环后用标志变量(或 `else`)区分是怎么出来的。

**失败后立刻重试。** 对方多半是太忙,立刻再敲只会更忙。每次失败后等一等,等待时间逐次加长。

**最后一次失败后还去 `sleep`。** 没有下一次了,白等。只在「还会再试」的时候才等。

**`Ctrl+C` 没反应就放弃。** 多按几次;还不行就关掉终端窗口。程序在等输入(`input()`)时也可以按 `Ctrl+C`。

## 学习资料

### 文档与文章

- [Python 教程 · break 和 continue 语句](https://docs.python.org/zh-cn/3.12/tutorial/controlflow.html#break-and-continue-statements-and-else-clauses-on-loops):中文,官方教程里 `break`、`continue`,还有循环的 `else`(Python 特有的写法,今天不用学,留个印象)。
- [Python 语言参考 · while 语句](https://docs.python.org/zh-cn/3.12/reference/compound_stmts.html#the-while-statement):中文,`while` 的正式语法,篇幅很短。
- [Python 标准库 · KeyboardInterrupt](https://docs.python.org/zh-cn/3.12/library/exceptions.html#KeyboardInterrupt):中文,`Ctrl+C` 对应的异常,以后用 `try/except` 优雅退出时会用到。
- [Python 标准库 · time.sleep](https://docs.python.org/zh-cn/3.12/library/time.html#time.sleep):中文,暂停程序;[time.monotonic](https://docs.python.org/zh-cn/3.12/library/time.html#time.monotonic) 测时间间隔。
- [Amazon Builders' Library · Timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/):英文,亚马逊工程师 Marc Brooker 讲为什么重试要退避加抖动。文章里讲了重试怎样可能让已经过载的服务更糟,读前半部分就够。
- [MDN · while](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Statements/while)、[do...while](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Statements/do...while)、[break](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Statements/break)、[continue](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Statements/continue):中文,JS 里对应的四个语句,和 Python 对照着看。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ANMgzuEyk&autoplay=0&high_quality=1" title="3 步拆解 while 循环三要素，彻底掌握 Python 循环逻辑" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>水哥澎湃 · 3 步拆解 while 循环三要素,彻底掌握 Python 循环逻辑 · 13 分钟,2025 年 6 月。把 `while` 拆成三个要素来讲。看完对照今天 `while_basic.py` 里的初值、条件、更新三处,看他的拆法和我的一不一样。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1UcKVzDESv&autoplay=0&high_quality=1" title="10 行代码搞懂！Python 循环里 continue 和 break 的底层逻辑，附动态执行演示" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>水哥澎湃 · 10 行代码搞懂!Python 循环里 continue 和 break 的底层逻辑 · 10 分钟,2025 年 6 月。带动态执行演示,一步步看 `break`、`continue` 把控制权交到哪里。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/rRTjPnVooxE" title="While loops in Python are easy!" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Bro Code · While loops in Python are easy! · 英文,可开自动字幕。标题就是 `while` 循环入门,看完回头对照今天的 `ask_times.py`。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/6iF8Xb7Z3wQ" title="Python Tutorial for Beginners 7: Loops and Iterations - For/While Loops" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Tutorial for Beginners 7: Loops and Iterations · 英文,可开自动字幕。昨天看过 `for` 的部分,今天看 `while`、`break`、`continue` 和死循环那几段。</figcaption>
</figure>

### 书籍

- Eric Matthes《Python Crash Course》第 3 版,No Starch Press,2023(中译《Python编程:从入门到实践》)。第 7 章「User Input and while Loops」,`input`、`while`、标志变量、`break`、`continue` 和避免死循环,和今天的内容几乎一一对应。
- Al Sweigart《Automate the Boring Stuff with Python》第 2 版,No Starch Press,2019(中译《Python编程快速上手:让繁琐工作自动化》),[第 2 章 Flow Control](https://automatetheboringstuff.com/2e/chapter2/) 在作者网站免费在线读,`while`、`break`、`continue`、`for` 和 `range` 讲得很口语。
- Allen B. Downey《Think Python》第 3 版,O'Reilly,2024,[免费在线版](https://allendowney.github.io/ThinkPython/chap07.html)。第 7 章「Iteration and Search」里 `while` 和 `break` 的部分。

### 开源项目与代码

- [Asabeneh/30-Days-Of-Python](https://github.com/Asabeneh/30-Days-Of-Python/tree/master/10_Day_Loops):英文,「Day 10 Loops」,`while`、`break`、`continue` 各有小例子加练习。
- [jackfrued/Python-100-Days](https://github.com/jackfrued/Python-100-Days/blob/master/Day01-20/06.循环结构.md):中文,《06.循环结构》里的 `while` 和 `break`、`continue` 两节,以及后面的猜数字游戏例子;想多练几道可以再看《07.分支和循环结构实战》里的素数、斐波那契等例子。

## 自测

1. 下面这段代码有什么问题?怎么改?

```python
count = 0
while count < 3:
    print("重试第", count + 1, "次")
```

<details><summary>答案</summary>

没有更新 `count`,条件永远成立,死循环。在循环体里加 `count += 1`(放在最前面最稳)。

</details>

2. `break` 和 `continue` 的区别是什么?在两层 `for` 循环的里层写 `break`,会跳出几层?

<details><summary>答案</summary>

`break` 结束整个循环,继续执行循环后面的代码;`continue` 只结束这一轮剩下的部分,直接开始下一轮。里层的 `break` 只跳出里层这一层,外层继续下一轮。

</details>

3. Python 没有 `do...while`,怎么写「至少执行一次,再决定要不要继续」?

<details><summary>答案</summary>

用 `while True:`,在循环体里先做事,再用 `if 条件: break` 决定是否退出。今天的 `ask_times.py` 就是这个形态:先读输入,合格才 `break`。

</details>

4. `retry_basic.py` 里为什么要用 `success` 这个标志变量?只靠 `attempt == MAX_TRIES` 判断行不行?

<details><summary>答案</summary>

不行。第 3 次成功时 `attempt` 也等于 3,第 3 次失败时 `attempt` 同样是 3,光看 `attempt` 分不清是成功还是放弃。循环有两种出口(`break` 和次数用完),需要一个变量记下是哪种,`success` 就是干这个的。

</details>

5. 为什么重试之间要等,而且等的时间要越来越长?最后一次失败后要不要等?

<details><summary>答案</summary>

对方超时多半是太忙或者暂时有问题,立刻再敲只会加重负担,所以要等;等的时间逐次翻倍(指数退避),给对方越来越多的恢复时间,也避免自己疯狂重试。最后一次失败后没有下一次了,再等是浪费时间,应该直接放弃并报告。

</details>

6. 面试题:你写的 Agent 循环是 `while True: 调模型 → 有工具调用就执行 → 没有就 break`。线上跑了一晚,账单比预期高很多,日志里有一个对话跑了几千步。你怎么从代码层面防住这种情况?

<details><summary>答案</summary>

至少加三道保险:一是最大步数(`MAX_STEPS`),到了上限强制 `break` 并返回一个明确的「没有完成」状态,不能悄悄结束;二是预算上限,累计 token 或花费超过阈值就停;三是重复检测,模型连续几步发出完全相同的工具调用就判定为卡住。正常出口(模型给答复)和保险出口都要有日志,出口原因要能事后查出来。这些在第三部分的 Day 192 会完整实现,骨架就是今天 `agent_loop_toy.py` 里的 `MAX_STEPS`。提示词里写「不要重复调用」只能降低概率,代码里的硬上限才是保证。

</details>

## 明天预告

Day 20 · 第 3 周复习:编程地基(Day 14–19)。这一周从布尔值和 `None` 开始,经过类型转换、字符串两天、`if`、`for` 到今天的 `while`,是写程序的基本零件。明天不学新东西:画一张本周知识地图,默写三段核心代码(从键盘读金额并校验、工单分类循环、带重试的循环),只用本周知识做一个「工单日报」小项目,把本周撞过的报错整理成一张表。
