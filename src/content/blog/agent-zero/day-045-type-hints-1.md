---
title: 'Day 45 · 类型标注(一):基础写法和编辑器红线'
description: '对照 TypeScript 讲清 Python 类型标注的基础写法:参数、默认值、返回值、变量和 -> None。亲手验证「标注在运行时不管事」,再用 basedpyright 一次揪出七条错误,学会逐段读懂一条红线在说什么。'
pubDate: 2026-10-22
regime: none
tags: ['python', 'agent-zero']
series: 'agent-zero'
day: 45
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 44](/blog/agent-zero/day-044-notebook-project/) 做完了命令行工单记事本:`TicketBook` 用组合持有一堆 Ticket 和一个 JSON 文件,`run` 按第一个参数分发命令,`main` 接住 TicketError 并返回退出码。六个命令全部跑通,删了一张再加也不会撞号。

回头看这三周写的代码,里面一直有 `title: str`、`amount: float`、`-> list[Ticket]` 这样的写法,我每次都说「这是类型标注,以后讲」。今天就讲它。做前端的你对这东西一点不陌生,TypeScript 天天在写,所以今天的重点不在语法,而在一件 TS 用户最容易想错的事:**Python 的类型标注,运行的时候根本没人看**。

## 今天要解决的问题

学完今天,你应该能:

1. 给函数的参数、默认值、返回值和变量写上类型标注,说出每种写法对应 TypeScript 的哪种写法,知道什么时候写 `-> None`。
2. 亲手证明 `uv run python` 不检查类型:传错类型的参数,程序要么照样跑出错误结果,要么在离错误很远的地方才崩。
3. 用 `uv run basedpyright` 检查一个文件,把一条报错拆成「文件:行:列、级别、说明、规则名」四段读懂,并改到 `0 errors`。
4. 用 `reveal_type` 看检查器替你推断出来的类型,说清不写标注的变量为什么拦不住错误。

预计用时:2 小时。前置:[Day 10](/blog/agent-zero/day-010-uv-1/) 建的 `agent-zero-lab` 项目、[Day 9](/blog/agent-zero/day-009-editor-setup/) 配好的编辑器、[Day 43](/blog/agent-zero/day-043-classes-3/) 改好的 `part01/ticket_model.py`、[Day 44](/blog/agent-zero/day-044-notebook-project/) 留下的 `part01/data/notebook.json`。

学法:先对照文章逐行敲一遍(不要复制粘贴)并跑通;第二天合上文章,把最后的 `typed_report.py` 默写出来;再做动手练习,做不出来再展开参考答案,看完关掉自己重写一遍。

命令都在项目根目录 `agent-zero-lab` 里跑,新文件放进 `part01/`。今天不调 API,花费 0 元。

## 先装好检查器

类型标注要配一个「读标注的人」才有用。Python 世界里这个角色叫类型检查器(type checker),常见的有 mypy、pyright、basedpyright,我们用 basedpyright:它是 pyright 的一个分支,Zed 从 v0.204.0 起默认用它做 Python 的语言服务器(Zed 官方文档 Python 一页写的),编辑器里那些红色波浪线就是它画的。

编辑器里有一份,命令行里也要一份。命令行版能一次检查一整个目录、能写进脚本和 CI,以后 Day 71 起写测试时也会和 pytest 一起跑。在项目根目录装成开发依赖:

```bash
uv add --dev basedpyright
uv run basedpyright --version
```

<div class="line-notes">

- `uv add --dev basedpyright` `--dev` 表示只在开发时用,≈ `npm i -D typescript`。如果 Day 9 已经装过,uv 会发现版本已满足,什么都不改。它会顺带装一个 `nodejs-wheel-binaries`:pyright 本身是用 TypeScript 写的,要 Node 来跑,这个包把 Node 打包成了 Python 包,所以你不用自己管。
- `uv run basedpyright --version` 2026 年 10 月我装到的是 `basedpyright 1.40.2`,第二行是 `based on pyright 1.1.414`。

</div>

然后打开 `pyproject.toml`,确认末尾有这一段,没有就加上:

```toml
[tool.basedpyright]
typeCheckingMode = "standard"
```

<div class="line-notes">

- `[tool.basedpyright]` pyproject.toml 里 `[tool.xxx]` 这种段落是留给各个工具放配置的,≈ package.json 里的 `"eslintConfig"` 字段。
- `typeCheckingMode = "standard"` 检查的严格程度。basedpyright 有 off、basic、standard、strict、recommended、all 几档。

</div>

这一段为什么必须加,我实际踩过。basedpyright 文档写明命令行的默认档是 `"recommended"`,非常严;而 Zed 文档写明它在编辑器里默认用 `standard`。不加这一段,命令行和编辑器说的就不是一回事。我没加配置时检查 Day 44 的两个文件,实测得到:

```text
2 errors, 22 warnings, 0 notes
```

22 条警告里大部分是 `Type annotation for attribute "title" is required because this class is not decorated with @final`、`Type "Any" is not allowed` 这种,对现在的你来说全是噪音。加上 standard 之后再跑:

```bash
uv run basedpyright part01/notebook.py part01/ticket_model.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
```

这就对了,编辑器里这两个文件也一条红线都没有。以后文章里说「basedpyright 0 报错」,指的都是 standard 档。

## 第一步:标注长什么样,对照 TS

新建 `part01/hints_basic.py`:

```python
# agent-zero-lab/part01/hints_basic.py
def with_tax(amount: float, rate: float = 0.06) -> float:
    return round(amount * (1 + rate), 2)


def label(id: str, closed: bool) -> str:
    mark = "已关" if closed else "处理中"
    return f"{id}({mark})"


count: int = 3
title: str = "发票抬头开错了"

print(with_tax(199))
print(with_tax(199, 0.13))
print(label("T-1001", True))
print(count, title)
print(with_tax.__annotations__)
```

<div class="line-notes">

- `def with_tax(amount: float, rate: float = 0.06) -> float:` 三种标注一行全有了。参数 `amount: float`,冒号后面是类型;带默认值的参数先写类型再写默认值 `rate: float = 0.06`;`-> float` 写在右括号后面、冒号前面,标的是返回值。
- `return round(amount * (1 + rate), 2)` `round(x, 2)` 保留两位小数。代入 199:199 × 1.06 = 210.94。
- `def label(id: str, closed: bool) -> str:` 字符串和布尔参数,返回字符串。
- `mark = "已关" if closed else "处理中"` Day 17 学过的一行 if,≈ JS 的 `closed ? "已关" : "处理中"`。这个变量没写标注,检查器会自己推断成 str,第四步细看。
- `count: int = 3` 变量也能标,写法是 `名字: 类型 = 值`。
- `title: str = "发票抬头开错了"` 同上。
- `print(with_tax(199))` 传的是整数 199,参数标的是 float。检查器允许:在类型标注里 int 可以当 float 用,和数学上「整数也是实数」一个意思。
- `print(with_tax(199, 0.13))` 199 × 1.13 = 224.87。
- `print(with_tax.__annotations__)` 标注其实存在函数身上的一个字典里,打出来看看。

</div>

```bash
uv run python part01/hints_basic.py
```

实测输出:

```text
210.94
224.87
T-1001(已关)
3 发票抬头开错了
{'amount': <class 'float'>, 'rate': <class 'float'>, 'return': <class 'float'>}
```

最后一行说明标注没被扔掉,Python 把它存进了 `__annotations__`。以后 MCP 的 Python SDK 能从函数标注自动生成工具的参数说明,读的就是这个字典(Day 281 会用到)。

和 TypeScript 对照一下,几乎一一对应,差别主要在类型名和返回值的符号:

| 写什么 | TypeScript | Python |
| --- | --- | --- |
| 参数 | `amount: number` | `amount: float` |
| 带默认值的参数 | `rate: number = 0.06` | `rate: float = 0.06` |
| 返回值 | `): number {` | `) -> float:` |
| 没有返回值 | `): void` | `) -> None:` |
| 变量 | `let count: number = 3` | `count: int = 3` |
| 字符串 / 布尔 | `string` / `boolean` | `str` / `bool` |
| 数字 | 只有 `number` | `int` 和 `float` 分开([Day 12](/blog/agent-zero/day-012-numbers/)) |
| 自己写的类 | `t: Ticket` | `t: Ticket` |

`-> None` 单独说一句。函数不写 return,Python 会默认返回 None([Day 14](/blog/agent-zero/day-014-bool-none/) 学的「空」),所以「什么都不返回」的函数标 `-> None`,就像 TS 里标 `void`。Day 44 的 `need` 函数就是 `-> None`。

## 第二步:运行时没人看标注

TS 有个你可能没细想过的事实:Vite、esbuild 在开发时编译 TS,做法是直接把类型**删掉**,根本不检查;真正检查类型的是 `tsc --noEmit` 或编辑器。Python 更彻底:解释器从头到尾就不检查标注。来验证。新建 `part01/hints_no_check.py`:

```python
# agent-zero-lab/part01/hints_no_check.py
def with_tax(amount: float, rate: float = 0.06) -> float:
    return round(amount * (1 + rate), 2)


def repeat(text: str, times: int) -> str:
    return text * times


print(repeat("好", 3))
print(repeat(3, 2))
print(with_tax("199"))
```

<div class="line-notes">

- `def repeat(text: str, times: int) -> str:` 标的是「给我一个字符串和一个整数」。
- `return text * times` 字符串乘整数是重复,`"好" * 3` 得到 `"好好好"`。整数乘整数是乘法。
- `print(repeat("好", 3))` 正常用法。
- `print(repeat(3, 2))` 第一个参数故意传整数。
- `print(with_tax("199"))` 金额故意传字符串,这是 Day 44 里 `sys.argv` 给你的那种 `'199'`。

</div>

```bash
uv run python part01/hints_no_check.py; echo "exit=$?"
```

实测输出(路径缩短了):

```text
好好好
6
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/hints_no_check.py", line 12, in <module>
    print(with_tax("199"))
          ^^^^^^^^^^^^^^^
  File "/Users/你/agent-zero-lab/part01/hints_no_check.py", line 3, in with_tax
    return round(amount * (1 + rate), 2)
                 ~~~~~~~^~~~~~~~~~~~
TypeError: can't multiply sequence by non-int of type 'float'
exit=1
```

两个结果都值得细看。

`repeat(3, 2)` 打印了 `6`。标注写着 text 是 str,你传了 int,Python 一个字都没说,高高兴兴算了 3 × 2。函数名叫 repeat,返回类型写着 str,实际返回了整数 6。这是最坏的一种错:**不崩,但结果是错的**,下游拿着它继续算,要很久以后才发现。

`with_tax("199")` 倒是崩了,但崩的理由和标注无关。它是走到乘法那一行,发现「字符串乘小数」没法算,才抛 TypeError。报错信息里说的是 sequence(序列)和 float,没有一个字提到「你违反了 amount: float」。如果 with_tax 里第一步不是乘法而是 `str(amount)`,它连崩都不会崩。

所以记住一句话:**类型标注是写给人和检查器看的说明,不是运行时的校验**。要在运行时真的拦住坏数据,得自己写 if 和 raise(Day 43 的 setter 就是这么做的),或者用 pydantic([Day 51](/blog/agent-zero/day-051-pydantic-1/))。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="同一个 py 文件走两条路:uv run python 忽略标注直接执行,出错时只报第一个且位置可能很远;basedpyright 只读不执行,一次列出所有标注冲突">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="250" y="16" width="140" height="40" rx="4" fill="none" stroke="var(--rule)"/>
<text x="320" y="41" text-anchor="middle" fill="var(--ink)">hints_no_check.py</text>
<line x1="290" y1="56" x2="150" y2="90" stroke="var(--rule)"/>
<line x1="350" y1="56" x2="490" y2="90" stroke="var(--rule)"/>
<rect x="30" y="90" width="250" height="70" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="155" y="114" text-anchor="middle" fill="var(--ink)">uv run python</text>
<text x="155" y="134" text-anchor="middle" fill="var(--ink-soft)" font-size="11">跳过标注,一行行执行</text>
<text x="155" y="150" text-anchor="middle" fill="var(--ink-faint)" font-size="11">≈ Vite / esbuild 删掉类型</text>
<rect x="360" y="90" width="250" height="70" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="485" y="114" text-anchor="middle" fill="var(--ink)">uv run basedpyright</text>
<text x="485" y="134" text-anchor="middle" fill="var(--ink-soft)" font-size="11">只读不执行,对照标注</text>
<text x="485" y="150" text-anchor="middle" fill="var(--ink-faint)" font-size="11">≈ tsc --noEmit</text>
<text x="155" y="190" text-anchor="middle" fill="var(--ink)">repeat(3, 2) → 6(错了不吭声)</text>
<text x="155" y="210" text-anchor="middle" fill="var(--ink)">with_tax("199") → 在乘法那行崩</text>
<text x="155" y="235" text-anchor="middle" fill="var(--ink-faint)" font-size="11">一次只能发现一个</text>
<text x="485" y="190" text-anchor="middle" fill="var(--ink)">11:14 error: Literal[3] → str</text>
<text x="485" y="210" text-anchor="middle" fill="var(--ink)">12:16 error: Literal['199'] → float</text>
<text x="485" y="235" text-anchor="middle" fill="var(--ink-faint)" font-size="11">2 errors,一次全列出</text>
</g>
</svg>
<figcaption>运行和检查是两件独立的事。左边是你一直在用的 uv run python,它不看标注;右边是今天的检查器,它不运行代码。两边都要用。</figcaption>
</figure>

## 第三步:让检查器读一遍

同一个文件交给 basedpyright:

```bash
uv run basedpyright part01/hints_no_check.py; echo "exit=$?"
```

实测输出:

```text
/Users/你/agent-zero-lab/part01/hints_no_check.py
  /Users/你/agent-zero-lab/part01/hints_no_check.py:11:14 - error: Argument of type "Literal[3]" cannot be assigned to parameter "text" of type "str" in function "repeat"
    "Literal[3]" is not assignable to "str" (reportArgumentType)
  /Users/你/agent-zero-lab/part01/hints_no_check.py:12:16 - error: Argument of type "Literal['199']" cannot be assigned to parameter "amount" of type "float" in function "with_tax"
    "Literal['199']" is not assignable to "float" (reportArgumentType)
2 errors, 0 warnings, 0 notes
exit=1
```

运行时只抓到一个而且没抓准,检查器一次抓到两个,而且直接说出「你违反了哪个参数的哪个标注」。它没有执行任何一行代码,`好好好` 也没打印。退出码是 1,Day 44 学的退出码在这里派上用场:以后在 CI 里写 `uv run basedpyright && uv run pytest`,类型有错就不往下跑。

### 一条报错怎么读

拿第一条拆开看,它分成五段:

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="一条 basedpyright 报错拆成五段:位置 11:14,级别 error,主说明,缩进的补充说明,括号里的规则名">
<rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="36" fill="var(--ink)">hints_no_check.py:11:14 - error: Argument of type "Literal[3]" ...</text>
<text x="40" y="58" fill="var(--ink)">"Literal[3]" is not assignable to "str" (reportArgumentType)</text>
<line x1="20" y1="44" x2="190" y2="44" stroke="var(--compute)" stroke-width="2"/>
<line x1="210" y1="44" x2="250" y2="44" stroke="var(--mem)" stroke-width="2"/>
<line x1="265" y1="44" x2="620" y2="44" stroke="var(--rule)" stroke-width="2"/>
<line x1="40" y1="66" x2="335" y2="66" stroke="var(--rule)" stroke-width="2"/>
<line x1="345" y1="66" x2="500" y2="66" stroke="var(--compute)" stroke-width="2"/>
<rect x="20" y="90" width="130" height="100" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="85" y="112" text-anchor="middle" fill="var(--ink)">① 位置</text>
<text x="85" y="134" text-anchor="middle" fill="var(--ink-soft)" font-size="11">第 11 行</text>
<text x="85" y="152" text-anchor="middle" fill="var(--ink-soft)" font-size="11">第 14 列</text>
<rect x="160" y="90" width="100" height="100" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="210" y="112" text-anchor="middle" fill="var(--ink)">② 级别</text>
<text x="210" y="134" text-anchor="middle" fill="var(--ink-soft)" font-size="11">error 红线</text>
<text x="210" y="152" text-anchor="middle" fill="var(--ink-soft)" font-size="11">warning 黄线</text>
<rect x="270" y="90" width="170" height="100" rx="4" fill="none" stroke="var(--rule)"/>
<text x="355" y="112" text-anchor="middle" fill="var(--ink)">③④ 说明</text>
<text x="355" y="134" text-anchor="middle" fill="var(--ink-soft)" font-size="11">第一行:哪里不对</text>
<text x="355" y="152" text-anchor="middle" fill="var(--ink-soft)" font-size="11">缩进行:为什么</text>
<rect x="450" y="90" width="170" height="100" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="535" y="112" text-anchor="middle" fill="var(--ink)">⑤ 规则名</text>
<text x="535" y="134" text-anchor="middle" fill="var(--ink-soft)" font-size="11">按它去搜文档</text>
<text x="535" y="152" text-anchor="middle" fill="var(--ink-soft)" font-size="11">一类错一个名字</text>
</g>
</svg>
<figcaption>命令行和编辑器是同一个 basedpyright,在 Zed 里把鼠标悬停在红线上,弹出的就是 ③④⑤ 这几段。</figcaption>
</figure>

1. **位置** `11:14`:第 11 行第 14 列。第 11 行是 `print(repeat(3, 2))`,第 14 列正好是那个 `3`(从 1 数起,`print(repeat(` 占了 13 个字符)。编辑器里红线就画在这个 3 下面。
2. **级别** `error`:错误。还有 `warning`(警告)和 `information`(提示,第四步会见到)。只有 error 会让退出码变成 1。
3. **主说明**:`Argument of type "Literal[3]" cannot be assigned to parameter "text" of type "str" in function "repeat"`,逐词翻译是「类型为 Literal[3] 的实参,不能赋给函数 repeat 里类型为 str 的形参 text」。
4. **补充说明**(缩进的那行):一句更短的原因,`"Literal[3]" is not assignable to "str"`。
5. **规则名** `(reportArgumentType)`:这类错误的名字。看不懂的时候拿它去搜 basedpyright 文档,比搜整句话准。

说明里有两个词第一次见。**Literal[3]** 是检查器对「字面量 3」的叫法:你在代码里直接写的 3,它知道的不只是「这是个 int」,而是「这就是 3」,比 int 更精确。TS 里把鼠标放到 `const x = 3` 上,看到的类型也是 `3` 而不是 `number`,一个道理。[Day 47](/blog/agent-zero/day-047-type-hints-3/) 会专门讲怎么自己写 Literal。**assignable**(可赋值)就是「能不能放进去」:int 的 3 放不进标着 str 的格子。

### 七种常见红线,一次看全

光看两条不够。我把这三周最容易犯的错攒成一个文件,一次让检查器全抓出来。新建 `part01/red_lines.py`(故意写错的文件,别照着用):

```python
# agent-zero-lab/part01/red_lines.py
from ticket_model import Ticket


def open_label(t: Ticket) -> str:
    return f"{t.id} 待处理"


def total_amount(a: Ticket, b: Ticket) -> float:
    return f"{a.amount + b.amount}"


t1 = Ticket("T-1009", "重复扣款", "99")
t2 = Ticket("T-1010", "退款")
t1.clsoe()
print(t1.amount.upper())
print(open_label("T-1009"))

count: int = 0
count = "两张"
```

<div class="line-notes">

- `from ticket_model import Ticket` Day 43 改好的 Ticket,`__init__` 标着 `id: str, title: str, amount: float, status: str = "open"`。
- `def open_label(t: Ticket) -> str:` 参数类型是我们自己写的类,检查器照样认。
- `return f"{a.amount + b.amount}"` 错误 1:返回类型写 float,实际返回的是 f-string,一个字符串。
- `t1 = Ticket("T-1009", "重复扣款", "99")` 错误 2:金额传了字符串。
- `t2 = Ticket("T-1010", "退款")` 错误 3:少传了 amount。
- `t1.clsoe()` 错误 4:close 拼错了。
- `print(t1.amount.upper())` 错误 5:amount 是 float,float 没有 upper 方法。
- `print(open_label("T-1009"))` 错误 6:要的是 Ticket 对象,传的是工单号字符串。
- `count: int = 0` 声明 count 是 int。
- `count = "两张"` 错误 7:声明过 int 的变量,后面又赋了字符串。

</div>

```bash
uv run basedpyright part01/red_lines.py
```

实测输出(路径缩短了,每条只留位置以后的部分):

```text
red_lines.py:10:12 - error: Type "str" is not assignable to return type "float"
    "str" is not assignable to "float" (reportReturnType)
red_lines.py:13:31 - error: Argument of type "Literal['99']" cannot be assigned to parameter "amount" of type "float" in function "__init__"
    "Literal['99']" is not assignable to "float" (reportArgumentType)
red_lines.py:14:6 - error: Argument missing for parameter "amount" (reportCallIssue)
red_lines.py:15:4 - error: Cannot access attribute "clsoe" for class "Ticket"
    Attribute "clsoe" is unknown (reportAttributeAccessIssue)
red_lines.py:16:17 - error: Cannot access attribute "upper" for class "float"
    Attribute "upper" is unknown (reportAttributeAccessIssue)
red_lines.py:17:18 - error: Argument of type "Literal['T-1009']" cannot be assigned to parameter "t" of type "Ticket" in function "open_label"
    "Literal['T-1009']" is not assignable to "Ticket" (reportArgumentType)
red_lines.py:20:9 - error: Type "Literal['两张']" is not assignable to declared type "int"
    "Literal['两张']" is not assignable to "int" (reportAssignmentType)
7 errors, 0 warnings, 0 notes
```

七条一条不落。按规则名归类,其实只有五种,以后见到就知道是哪一类:

| 规则名 | 意思 | 今天的例子 |
| --- | --- | --- |
| reportReturnType | 返回的东西和 `->` 后面写的对不上 | 写 float 却返回字符串 |
| reportArgumentType | 传进去的参数类型不对 | 金额传 `"99"`、工单号当 Ticket 传 |
| reportCallIssue | 调用本身不对:少参数、多参数 | 少了 amount |
| reportAttributeAccessIssue | 点出来的属性或方法不存在 | `clsoe`、float 的 `upper` |
| reportAssignmentType | 赋的值和变量声明的类型对不上 | int 变量赋字符串 |

再运行一下,对比运行时能发现几个:

```bash
uv run python part01/red_lines.py
```

实测输出(路径缩短了):

```text
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/red_lines.py", line 13, in <module>
    t1 = Ticket("T-1009", "重复扣款", "99")
         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/Users/你/agent-zero-lab/part01/ticket_model.py", line 19, in __init__
    self.amount = amount
    ^^^^^^^^^^^
  File "/Users/你/agent-zero-lab/part01/ticket_model.py", line 28, in amount
    if value < 0:
       ^^^^^^^^^
TypeError: '<' not supported between instances of 'str' and 'int'
```

运行时只报了一个,而且最后一行指向的是 `ticket_model.py` 第 28 行的 setter,是**别人的文件**。你得从 traceback 往上倒着读三层([Day 35](/blog/agent-zero/day-035-exceptions-1/) 学的读法)才找回真正的源头 red_lines.py 第 13 行。修好这一个再跑,才会撞上下一个。检查器把七个错一次摆在你面前,位置都指在你自己写错的那一行。

第 10 行那个错(返回类型)尤其要靠检查器:total_amount 根本没被调用,运行一万次也发现不了。

## 第四步:不写标注会怎样,reveal_type

上面的 `mark = "已关" if closed else "处理中"` 没写标注,检查器也知道它是字符串。这叫**类型推断**(type inference):根据你赋的值,检查器自己算出类型。TS 里 `const x = 3` 不写类型也知道是数字,一样。

想看检查器推断出了什么,在 Zed 里把鼠标放到变量上就能看到;命令行里用 `reveal_type`。新建 `part01/hints_infer.py`:

```python
# agent-zero-lab/part01/hints_infer.py
from typing import reveal_type


def with_tax(amount: float, rate: float = 0.06) -> float:
    return round(amount * (1 + rate), 2)


def shout(text):
    return text.upper() + "!"


price = 199
total = with_tax(price)
name = "云簿"
reveal_type(price)
reveal_type(total)
reveal_type(name)
reveal_type(shout)
```

<div class="line-notes">

- `from typing import reveal_type` `typing` 是 Python 自带的「类型工具箱」模块,今天先从里面拿 reveal_type。Python 3.11 起才有,我们是 3.12,没问题。
- `def shout(text):` 故意一个标注都不写。
- `price = 199` 不写标注的变量。
- `total = with_tax(price)` 函数返回值的类型来自 `-> float`。
- `reveal_type(price)` 让检查器「报出它认为的类型」。

</div>

先运行,再检查,两边都看:

```bash
uv run python part01/hints_infer.py
uv run basedpyright part01/hints_infer.py
```

实测输出(检查那部分路径缩短了):

```text
Runtime type is 'int'
Runtime type is 'float'
Runtime type is 'str'
Runtime type is 'function'
hints_infer.py:16:13 - information: Type of "price" is "Literal[199]"
hints_infer.py:17:13 - information: Type of "total" is "float"
hints_infer.py:18:13 - information: Type of "name" is "Literal['云簿']"
hints_infer.py:19:13 - information: Type of "shout" is "(text: Unknown) -> Unknown"
0 errors, 0 warnings, 4 notes
```

reveal_type 在运行时也能用,打印的是「实际是什么类型」(Runtime type),在检查时打印的是「检查器认为是什么类型」,级别是 information,不算错误。两者大多数时候一致,检查器更精确一点(`Literal[199]` 而不只是 int)。

最后一行要看仔细:shout 的参数和返回值全是 **Unknown**。没写标注的参数,检查器不知道该是什么,只能放弃检查。你调 `shout(5)`,检查器不会画红线,运行时才崩(练习 2 会看到)。所以分工是这样的:

- **函数的参数和返回值要写标注**。这是函数对外的约定,检查器靠它在每个调用处帮你把关。
- **函数里面的局部变量一般不写**,让检查器推断,`mark = ...`、`price = 199` 都不用写。
- **想锁死一个变量的类型时才写**。不写标注的变量,先赋 0 再赋 `"合计"`,检查器只会默默把它的类型改成字符串,不报错(练习 4 实测);写了 `count: int` 的,第三步你看到了,立刻红线。

## 把零件拼起来:typed_report.py

用今天的写法做一个完整标注的小报表:读 Day 44 的记事本文件,每张工单一行,可选显示含税金额,最后算未关闭的合计。新建 `part01/typed_report.py`:

```python
# agent-zero-lab/part01/typed_report.py
from pathlib import Path

from ticket_model import Ticket, load

BOOK: Path = Path(__file__).resolve().parent / "data" / "notebook.json"
TAX_RATE: float = 0.06


def with_tax(amount: float, rate: float = TAX_RATE) -> float:
    return round(amount * (1 + rate), 2)


def line(t: Ticket, show_tax: bool = False) -> str:
    text = f"{t.id} {t.title} ¥{t.amount}"
    if show_tax:
        text += f"(含税 ¥{with_tax(t.amount)})"
    return text


def open_total(tickets: list[Ticket]) -> float:
    total: float = 0
    for t in tickets:
        if not t.is_closed:
            total += t.amount
    return total


def print_report(path: Path, show_tax: bool = False) -> None:
    tickets = load(path)
    for t in tickets:
        print(line(t, show_tax))
    print(f"未关闭合计 ¥{open_total(tickets)}")


if __name__ == "__main__":
    print_report(BOOK)
    print("---")
    print_report(BOOK, show_tax=True)
```

<div class="line-notes">

- `from ticket_model import Ticket, load` Ticket 用来写标注,load 是 Day 40 起就有的「从文件读出 Ticket 列表」。
- `BOOK: Path = Path(__file__).resolve().parent / "data" / "notebook.json"` 模块级的常量也标上类型。类型名就是类名 `Path`,和 Day 37 用的同一个类。
- `TAX_RATE: float = 0.06` 税率 6%。
- `def with_tax(amount: float, rate: float = TAX_RATE) -> float:` 默认值可以是一个常量。
- `def line(t: Ticket, show_tax: bool = False) -> str:` 参数是我们自己的类。在函数里敲 `t.` 时,编辑器能补全出 `id`、`title`、`amount`、`is_closed`,就是靠这个标注。
- `text = f"{t.id} {t.title} ¥{t.amount}"` 局部变量不标,检查器推断为 str。
- `text += f"(含税 ¥{with_tax(t.amount)})"` 代入 T-1001:199 × 1.06 = 210.94。
- `def open_total(tickets: list[Ticket]) -> float:` `list[Ticket]` 读作「Ticket 组成的列表」,这三周你见过很多次了,方括号的写法明天正式讲。
- `total: float = 0` 这里写标注是有意的:从 0 开始累加的变量,明确说「我是 float」,以后有人往里加字符串会立刻红线。
- `if not t.is_closed:` Day 43 的只读 property,检查器知道它是 bool。
- `total += t.amount` 199 那张已关,不算。399 + 89.5 + 120 = 608.5。
- `def print_report(path: Path, show_tax: bool = False) -> None:` 只打印不返回,标 `-> None`。
- `tickets = load(path)` 检查器从 load 的 `-> list[Ticket]` 推断出 tickets 的类型,这里不用再写。
- `print_report(BOOK, show_tax=True)` 用关键字传参([Day 29](/blog/agent-zero/day-029-functions-2/)),一眼看出 True 是什么意思。

</div>

先检查,再运行:

```bash
uv run basedpyright part01/typed_report.py
uv run python part01/typed_report.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
T-1001 发票抬头开错了 ¥199
T-1002 升级套餐 年付 ¥399
T-1004 扣费两次 ¥89.5
T-1005 API 调用超额 ¥120
未关闭合计 ¥608.5
---
T-1001 发票抬头开错了 ¥199(含税 ¥210.94)
T-1002 升级套餐 年付 ¥399(含税 ¥422.94)
T-1004 扣费两次 ¥89.5(含税 ¥94.87)
T-1005 API 调用超额 ¥120(含税 ¥127.2)
未关闭合计 ¥608.5
```

我的 notebook.json 是做完 Day 44 练习 2 之后的状态,T-1004 改成了 89.5。如果你没做那道练习,T-1004 还是 99.5,含税是 105.47,未关闭合计是 618.5,其余一样。

「先检查再运行」这个顺序以后要养成习惯,就像你提交 TS 代码前会先看一眼 `tsc` 有没有报错。

| 今天的零件 | 在 typed_report.py 里是哪一段 |
| --- | --- |
| 准备 standard 档配置 | 让 `uv run basedpyright` 和 Zed 说同一套话 |
| 第一步 参数、默认值、返回值、变量标注 | `with_tax`、`line`、`BOOK`、`TAX_RATE` |
| 第一步 `-> None` | `print_report` |
| 第三步 读红线 | 检查结果 `0 errors`,练习 5 会故意把它弄红 |
| 第四步 推断和什么时候写标注 | `text`、`tickets` 不写,`total: float` 写 |

## 动手练习

### 练习 1:给没标注的代码补上标注

下面这个文件一个标注都没有。新建 `part01/ex45_plain.py`,原样敲进去,先跑一次、检查一次,然后另存为 `part01/ex45_typed.py` 补上标注(参数和返回值全标),再检查一次,看看最后一行能不能被检查器提前抓到。

```python
# agent-zero-lab/part01/ex45_plain.py
def discount(price, percent=10):
    return round(price * (100 - percent) / 100, 2)


def is_big(amount, limit=300):
    return amount >= limit


def tag(id, amount):
    return f"{id}{'(大单)' if is_big(amount) else ''} 折后 ¥{discount(amount)}"


print(tag("T-1002", 399))
print(tag("T-1005", 120))
print(discount("399"))
```

<div class="line-notes">

- `def discount(price, percent=10):` 打折:percent 是折扣百分比,10 表示打九折。
- `return round(price * (100 - percent) / 100, 2)` 代入 399:399 × 90 / 100 = 359.1。
- `return amount >= limit` 300 及以上算大单。
- `return f"{id}{'(大单)' if is_big(amount) else ''} 折后 ¥{discount(amount)}"` f-string 里嵌了一个一行 if。
- `print(discount("399"))` 故意传字符串。

</div>

<details><summary>参考答案</summary>

先看没标注时的情况:

```bash
uv run basedpyright part01/ex45_plain.py
uv run python part01/ex45_plain.py
```

实测输出(traceback 中间几行省略):

```text
0 errors, 0 warnings, 0 notes
T-1002(大单) 折后 ¥359.1
T-1005 折后 ¥108.0
Traceback (most recent call last):
  ...
    return round(price * (100 - percent) / 100, 2)
                 ~~~~~~~~~~~~~~~~~~~~~~~~^~~~~
TypeError: unsupported operand type(s) for /: 'str' and 'int'
```

检查器 0 报错,因为参数全是 Unknown,它什么也查不了。运行时崩在除法:`"399" * 90` 先得到一个 399 重复 90 遍的长字符串(没报错!),到 `/ 100` 才炸。

补上标注:

```python
# agent-zero-lab/part01/ex45_typed.py
def discount(price: float, percent: int = 10) -> float:
    return round(price * (100 - percent) / 100, 2)


def is_big(amount: float, limit: float = 300) -> bool:
    return amount >= limit


def tag(id: str, amount: float) -> str:
    return f"{id}{'(大单)' if is_big(amount) else ''} 折后 ¥{discount(amount)}"


print(tag("T-1002", 399))
print(tag("T-1005", 120))
print(discount("399"))
```

<div class="line-notes">

- `def discount(price: float, percent: int = 10) -> float:` 价格可能有小数,标 float;折扣百分比是整数,标 int。返回 round 的结果,是 float。
- `def is_big(amount: float, limit: float = 300) -> bool:` 比较的结果是 True 或 False,返回 bool。默认值写 300(整数)而标注写 float,没问题,第一步说过 int 可以当 float 用。
- `def tag(id: str, amount: float) -> str:` 返回 f-string,是 str。
- `print(discount("399"))` 这一行现在会被画红线。

</div>

```bash
uv run basedpyright part01/ex45_typed.py
```

实测输出(路径缩短了):

```text
ex45_typed.py:16:16 - error: Argument of type "Literal['399']" cannot be assigned to parameter "price" of type "float" in function "discount"
    "Literal['399']" is not assignable to "float" (reportArgumentType)
1 error, 0 warnings, 0 notes
```

16 行 16 列正好指着 `"399"`。把它改成 `discount(399)` 或 `discount(float("399"))`,就是 0 errors,运行输出第三行是 `359.1`。

</details>

### 练习 2:观察没标注的函数

在 `part01/hints_infer.py` 末尾加一行 `print(shout(5))`,先检查再运行,观察两边各说了什么。然后给 shout 补上 `text: str` 和 `-> str`,再检查一次。

<details><summary>参考答案</summary>

没补标注时,检查器只有原来的 4 条 information,`0 errors`,`shout(5)` 没有红线;运行时前四行照常打印,然后崩:

```text
AttributeError: 'int' object has no attribute 'upper'
```

这是因为 text 是 Unknown,检查器不知道 5 不该进来。补成 `def shout(text: str) -> str:` 后再检查,实测多出一条 error,规则名 reportArgumentType,说明是 `Argument of type "Literal[5]" cannot be assigned to parameter "text" of type "str" in function "shout"`;同时 `reveal_type(shout)` 那条 information 变成了 `Type of "shout" is "(text: str) -> str"`。参数一旦有了标注,每个调用处都受保护。

</details>

### 练习 3:把七条红线全修掉

复制 `part01/red_lines.py` 为 `part01/ex45_fix.py`,在不删除任何一行调用的前提下,改到 basedpyright 0 errors,并且能正常跑完。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex45_fix.py
from ticket_model import Ticket


def open_label(t: Ticket) -> str:
    return f"{t.id} 待处理"


def total_amount(a: Ticket, b: Ticket) -> float:
    return a.amount + b.amount


t1 = Ticket("T-1009", "重复扣款", 99)
t2 = Ticket("T-1010", "退款", 50)
t1.close()
print(str(t1.amount).upper())
print(open_label(t1))
print(total_amount(t1, t2))

count: int = 0
count = 2
print(count, "张")
```

<div class="line-notes">

- `return a.amount + b.amount` 错误 1:去掉 f-string,直接返回两个数相加。另一种修法是把返回类型改成 `-> str`,要看你本来想要什么。函数名叫 total_amount,返回数字更合理。
- `t1 = Ticket("T-1009", "重复扣款", 99)` 错误 2:金额改成数字。
- `t2 = Ticket("T-1010", "退款", 50)` 错误 3:补上金额。
- `t1.close()` 错误 4:拼写改对。
- `print(str(t1.amount).upper())` 错误 5:先转成字符串再 upper。数字转大写没有意义,这里只是演示「类型对了,检查器就不拦」。
- `print(open_label(t1))` 错误 6:传 Ticket 对象,不传工单号。
- `print(total_amount(t1, t2))` 后加的一行,让 total_amount 真的被调用一次,99 + 50 = 149。
- `count = 2` 错误 7:声明了 int 就赋 int。要显示「两张」,应该在打印时拼。

</div>

```bash
uv run basedpyright part01/ex45_fix.py
uv run python part01/ex45_fix.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
99
T-1009 待处理
149
2 张
```

</details>

### 练习 4:先猜再验证推断结果

新建 `part01/ex45_infer_total.py`,运行检查之前,先在纸上写下三个 reveal_type 你认为会报什么类型,以及会不会有 error:

```python
# agent-zero-lab/part01/ex45_infer_total.py
from typing import reveal_type

total = 0
reveal_type(total)
total += 89.5
reveal_type(total)
total = "合计"
reveal_type(total)
```

<div class="line-notes">

- `total = 0` 不写标注。
- `total += 89.5` 加一个小数。
- `total = "合计"` 换成字符串,第三步的 `count` 在这里会红线,total 呢?

</div>

<details><summary>参考答案</summary>

```bash
uv run basedpyright part01/ex45_infer_total.py
```

实测输出(路径缩短了):

```text
ex45_infer_total.py:5:13 - information: Type of "total" is "Literal[0]"
ex45_infer_total.py:7:13 - information: Type of "total" is "float"
ex45_infer_total.py:9:13 - information: Type of "total" is "Literal['合计']"
0 errors, 0 warnings, 0 notes
```

没有 error。没写标注的变量,检查器只是跟着每次赋值更新它「当前是什么」:先是字面量 0,加了 89.5 变 float,赋了字符串就变字符串。它不认为你做错了什么。第三步的 `count: int = 0` 是**声明**了类型,之后每次赋值都要和声明对得上,所以 `count = "两张"` 才红线。想让检查器帮你守住一个变量,就给它写标注。

这里和 TS 有点不一样:TS 里 `let total = 0; total = "合计"` 是会报错的,TS 用第一次赋值的类型当声明类型。Python 的检查器宽松一些,别拿 TS 的直觉套。

</details>

### 练习 5:字符串当路径传

新建 `part01/ex45_str_path.py`,只写两行:从 typed_report 导入 print_report,然后调 `print_report("part01/data/notebook.json")`。先检查,再运行,说出两边各说了什么,再改对。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex45_str_path.py
from typed_report import print_report

print_report("part01/data/notebook.json")
```

<div class="line-notes">

- `from typed_report import print_report` 导入今天写的函数。typed_report.py 底下有 `if __name__ == "__main__":`,所以导入时不会把报表打印两遍(Day 32 学的)。
- `print_report("part01/data/notebook.json")` 参数标的是 Path,这里传了字符串。

</div>

检查(路径缩短了):

```text
ex45_str_path.py:4:14 - error: Argument of type "Literal['part01/data/notebook.json']" cannot be assigned to parameter "path" of type "Path" in function "print_report"
    "Literal['part01/data/notebook.json']" is not assignable to "Path" (reportArgumentType)
1 error, 0 warnings, 0 notes
```

运行,最后几行:

```text
  File "/Users/你/agent-zero-lab/part01/ticket_model.py", line 66, in load
    data = json.loads(path.read_text(encoding="utf-8"))
                      ^^^^^^^^^^^^^^
AttributeError: 'str' object has no attribute 'read_text'
```

又是一样的模式:检查器指着你传错的那一行,运行时崩在两层之外的 ticket_model.py。改法是传 Path:先 `from pathlib import Path`,再 `print_report(Path("part01/data/notebook.json"))`,在项目根目录运行就能打出和正文一样的报表。

</details>

验收标准:`uv run basedpyright part01/typed_report.py part01/ex45_typed.py part01/ex45_fix.py` 输出 `0 errors`;`uv run python part01/typed_report.py` 的输出和正文一致(T-1004 的金额以你自己的数据为准);不看文章能写出带默认值的参数标注和 `-> None`;拿到任意一条 basedpyright 报错,能指出它在哪一行哪一列、属于哪条规则、该怎么改。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 类型标注(type hint / type annotation) | 写在参数、返回值、变量旁边的类型说明,`amount: float`、`-> str`,≈ TS 的类型注解;Python 运行时不检查 |
| 返回类型 | 函数定义里 `->` 后面的类型,标的是 return 出去的值 |
| `-> None` | 函数不返回有意义的值,≈ TS 的 `void` |
| `__annotations__` | 函数身上存标注的字典,`with_tax.__annotations__` 能看到 `{'amount': float, ...}` |
| 类型检查器(type checker) | 只读代码、不运行代码,对照标注找错的工具,≈ `tsc --noEmit` |
| basedpyright | 我们用的类型检查器,pyright 的分支,Zed 默认的 Python 语言服务器 |
| typeCheckingMode | basedpyright 的严格程度档位,我们用 standard;命令行默认是更严的 recommended |
| 语言服务器(language server) | 编辑器背后给你做补全、跳转、画红线的程序,Zed 里的 Python 由 basedpyright 担任 |
| 规则名(rule) | 一类错误的名字,如 `reportArgumentType`,写在报错末尾的括号里 |
| 字面量类型 `Literal[3]` | 检查器对「代码里直接写的 3」的精确叫法,比 int 更具体,Day 47 细讲 |
| assignable(可赋值) | 一个值能不能放进标着某类型的位置,int 能放进 float,str 不能 |
| 类型推断(type inference) | 不写标注时检查器根据赋的值自己算类型 |
| `reveal_type` | `typing` 里的函数,检查时报出检查器认为的类型,运行时打印实际类型 |
| Unknown | 检查器不知道类型,通常因为参数没写标注,这时它放弃检查 |
| typing | Python 自带的类型工具模块,reveal_type、Any、Literal、TypedDict 都从这里导入 |

## 常见误区

**以为写了标注,Python 运行时会帮你检查。** 不会。实测 `repeat(3, 2)` 标着 str 却返回了 6,一声不吭。标注只给检查器和人看,运行时要拦坏数据得自己写 if/raise 或用 pydantic。

**只跑程序不跑检查器。** 跑程序一次只能撞上一个错,还经常崩在别人的文件里;red_lines.py 的返回类型错误函数没被调用,运行一万次也发现不了。改完代码先 `uv run basedpyright`,再 `uv run python`。

**没配 typeCheckingMode,命令行和编辑器说法不一样。** basedpyright 命令行默认 recommended,实测 Day 44 的两个文件报 `2 errors, 22 warnings`;Zed 默认 standard,一条都没有。在 pyproject.toml 里写死 standard。

**参数不写标注。** 没标注的参数是 Unknown,检查器在每个调用处都放弃检查,练习 1 的 `discount("399")` 就这样溜过去了。函数的参数和返回值一定要写。

**把 `int` 和 `float` 当成要严格区分的两种类型。** 标 float 的参数传 199 完全没问题,检查器允许 int 当 float 用。反过来不行:标 int 的地方传 89.5 会红线。

**返回类型写了却忘了 return。** 标 `-> str` 的函数只 print 不 return,检查器实测报 `Function with declared return type "str" must return value on all code paths`,运行时它返回的是 None,下游调 `.upper()` 就是 `AttributeError: 'NoneType' object has no attribute 'upper'`。只打印不返回的函数标 `-> None`。

**用 `# type: ignore` 把红线压下去。** 在行尾写 `# type: ignore`,那一行的红线确实会消失(实测 `f("1")  # type: ignore` 检查结果 0 errors),但错误还在,运行时照崩。红线是在告诉你真问题,先读懂再决定;实在要压,也要在旁边写清楚为什么。

## 学习资料

### 文档与文章

- [Python 标准库 · typing(中文)](https://docs.python.org/zh-cn/3.12/library/typing.html):官方参考手册,今天只看开头那条备注,原话是「Python 运行时不强制要求函数与变量类型标注。它们可被类型检查器、IDE、语法检查器等第三方工具使用。」后面几天会一直回来查。
- [mypy · Type hints cheat sheet](https://mypy.readthedocs.io/en/stable/cheat_sheet_py3.html):一页纸的类型标注速查表,前两节「Variables」和「Functions」就是今天的内容。mypy 是另一个检查器,写法通用。
- [TypeScript Handbook · Everyday Types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html):你熟悉的那一边,对照着看今天的对照表。
- [basedpyright 文档 · Config files](https://docs.basedpyright.com/latest/configuration/config-files/):搜 typeCheckingMode,能看到六档和「默认是 recommended」那句;规则名(reportArgumentType 等)也都能在这一页搜到。
- [Zed 文档 · Python](https://zed.dev/docs/languages/python):写了 basedpyright 是默认语言服务器、编辑器里默认 standard 档,以及 pyproject.toml 和 pyrightconfig.json 谁优先。
- [PEP 484](https://peps.python.org/pep-0484/):2014 年提出类型标注的那份提案,英文,看 Rationale and Goals 和 Non-goals 两小节就行,后者写明了 Python 不打算在运行时做类型检查。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV11Z4y1h79y&autoplay=0&high_quality=1" title="【python】Type Hint入门与初探，好好的python写什么类型标注？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>码农高天 · 【python】Type Hint入门与初探,好好的python写什么类型标注? · 约 14 分钟。作者是 CPython 核心开发者,讲清楚标注是什么、为什么运行时不管,和今天第二步对着看。视频是 2022 年的,里面个别 typing.List 这类老写法明天会讲到。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1sW81zbEkD&autoplay=0&high_quality=1" title="为什么越来越多Python项目都在写类型注解？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Hucci写代码 · 为什么越来越多Python项目都在写类型注解? · 约 11 分钟,2025 年的视频,讲标注给编辑器补全和静态检查带来的好处,适合今天看完正文再看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/0oBLMwHdZ2Y" title="The REAL Reason You Should Use Type Hints in Python" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>ArjanCodes · The REAL Reason You Should Use Type Hints in Python · 英文,讲标注作为「函数对外约定」的价值,和第四步「参数和返回值一定要写」是同一个观点。</figcaption>
</figure>

### 书籍

- 《流畅的 Python(第 2 版)》,Luciano Ramalho 著,人民邮电出版社,2023。第 8 章「函数中的类型提示」专讲今天和明天的内容,包括「渐进式类型」这个说法:标注可以一点点加,不写的地方检查器就不管,正好对应第四步的 Unknown。这本书对 0 基础有点深,先读这一章的前半。

### 开源项目与代码

- [DetachHead/basedpyright](https://github.com/DetachHead/basedpyright):今天用的检查器源码。不用读代码,看 README 里它和 pyright 的区别,知道它多了哪些规则(recommended 档那 22 条警告就来自这些)。
- [python/typeshed](https://github.com/python/typeshed):检查器怎么知道 `float` 没有 `upper` 方法、`round` 返回什么?答案在这个仓库:Python 标准库每个函数的类型标注都写在这里的 `.pyi` 文件里。打开 `stdlib/builtins.pyi` 搜 `def round`,看看官方是怎么给它写标注的。

## 自测

1. 把下面这个 TS 函数翻成带类型标注的 Python:`function fee(amount: number, rate: number = 0.03): number`。

<details><summary>答案</summary>

`def fee(amount: float, rate: float = 0.03) -> float:`。number 对应 float(如果确定只会是整数也可以用 int),默认值写在类型后面,返回类型用 `->` 写在右括号和冒号之间。

</details>

2. `def repeat(text: str, times: int) -> str` 被调成 `repeat(3, 2)`,`uv run python` 会报错吗?`uv run basedpyright` 呢?

<details><summary>答案</summary>

`uv run python` 不报错,打印 6,因为运行时不看标注,3 × 2 是合法的乘法。`uv run basedpyright` 报 error,规则 reportArgumentType,说 `Literal[3]` 不能赋给类型为 str 的参数 text。

</details>

3. 报错 `red_lines.py:15:4 - error: Cannot access attribute "clsoe" for class "Ticket"` 里的 15 和 4 分别是什么?末尾括号里会是哪个规则名?

<details><summary>答案</summary>

15 是行号,4 是列号(`t1.clsoe()` 的第 4 个字符正好是 clsoe 的 c)。规则名是 `reportAttributeAccessIssue`,表示点出来的属性或方法不存在。

</details>

4. 为什么文章建议「函数的参数和返回值要写标注,局部变量一般不写」?

<details><summary>答案</summary>

参数没写标注就是 Unknown,检查器在所有调用处都放弃检查;返回值写了,调用方拿到结果后的用法也能被检查。局部变量检查器能从赋的值推断出来,写了是重复劳动。只有想锁死类型的变量(比如从 0 开始累加的 total)才值得写。

</details>

5. 一个函数只 print 不 return,返回类型该怎么写?写成 `-> str` 会怎样?

<details><summary>答案</summary>

写 `-> None`。写成 `-> str`,检查器报 `Function with declared return type "str" must return value on all code paths`;运行时它其实返回 None,调用方对结果调字符串方法就会 AttributeError。

</details>

## 明天预告

[Day 46 · 类型标注(二):X | None、容器类型和 Any](/blog/agent-zero/day-046-type-hints-2/)。今天的类型都是「一个值」:一个 float、一个 Ticket。可真实代码里到处是「可能没有」的值(Day 44 的 find 找不到工单怎么办)和装着一堆东西的容器(`list[Ticket]` 今天已经提前用了)。明天讲 `Ticket | None` 怎么逼你处理「没找到」、`list[str]` 和 `dict[str, int]` 的方括号怎么读,以及什么都不查的 `Any`,最后亲手修 3 条红线。
