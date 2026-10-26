---
title: 'Day 32 · 模块:import 和 from ... import'
description: '一个 .py 文件就是一个模块,import 是把别的文件里的东西拿过来用。今天讲清 import 到底做了什么、from ... import 和它的区别、为什么导入时文件会被执行一遍,再学 __name__ 和 if __name__ == "__main__",最后把 Day 31 的 160 行工单分类器拆成两个文件。'
pubDate: 2026-10-27
regime: none
tags: ['python', 'agent-zero']
series: 'agent-zero'
day: 32
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 31](/blog/agent-zero/day-031-ticket-classifier-project/) 是一个小项目:把 20 张工单读进来、用关键词表计分分类、算准确率和混淆矩阵、出日报,全部放在一个 `part01/ticket_classifier.py` 里,160 多行,跑出 18/20。练习 4 还演示了一件事:在手里这 20 张上调规则调到满分,拿到新数据照样会错。

那个文件有个毛病。`clean`、`parse`、`classify` 这些零件以后的项目还要用,可它们和那份 `RAW` 数据、那句最后的 `main(RAW)` 焊在一起,想用只能整个复制。你其实已经一直在用「拿别人文件里的东西」这件事:`import unicodedata`、`import time`、`import json`,Day 10 的 `main.py` 里还有一句一直没讲的 `if __name__ == "__main__":`。今天把这两笔账都还上。

## 今天要解决的问题

学完今天,你应该能:

1. 说清 `import mod_util` 做了什么:第一次导入时找到 `mod_util.py`、把它从头到尾执行一遍、把结果存成一个模块对象;第二次导入不会再执行。会用 `mod_util.with_tax(...)` 的写法调用。
2. 区分三种写法:`import mod_util`、`import mod_util as mu`、`from mod_util import with_tax, RATE_PERCENT`;知道只写 `from ... import` 时 `mod_util` 这个名字并没有被定义;认得 `ModuleNotFoundError: No module named 'mod_utl'` 和 `ImportError: cannot import name 'with_taxes' from 'mod_util'`。
3. 说清 `__name__` 是什么:文件被直接运行时它是 `'__main__'`,被别的文件导入时它是模块名;会用 `if __name__ == "__main__":` 把「只在直接运行时才做的事」圈起来,并对照 Node 的 `import.meta.main`。
4. 把 Day 31 的分类器拆成 `part01/tc_rules.py`(规则和零件)和 `part01/tc_main.py`(数据和流程),拆完跑出和昨天一模一样的 18/20;能说清为什么 `tc_main.py` 最后必须有那句 `if __name__ == "__main__":`。

预计用时:2.5 小时。import 的三种写法和报错 60 分钟,`__name__` 40 分钟,拆文件 30 分钟,练习 30 分钟。今天不调任何 API,花费 0 元。

前置:[Day 8](/blog/agent-zero/day-008-python-vs-node/) 和 [Day 10](/blog/agent-zero/day-010-uv-1/)(`uv run python`、`main.py` 的样子)、[Day 28](/blog/agent-zero/day-028-functions-1/)(`def` 是一条要执行到才生效的语句)、[Day 29](/blog/agent-zero/day-029-functions-2/)(默认值只算一次,会再次用到这种「只做一次」的直觉)、[Day 31](/blog/agent-zero/day-031-ticket-classifier-project/)(要拆的那个文件)。

学法提示:先对照文章逐行敲一遍(代码自己敲,不复制粘贴)并跑通;第二天合上文章,把 `mod_util.py` 和 `mod_name.py` 默写出来,再默写 `tc_main.py` 最后那两行,确认你说得出为什么要写;然后做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先说清楚我是在哪跑的

输出是我 2026-10-27 在 2019 款 Intel MacBook Pro(macOS 14、zsh)上用演示家目录真跑的,家目录显示成 `/Users/你`,`~/agent-zero-lab` 接着 Day 31 的状态,`uv run python` 是 3.12.13,Ruff 是 0.17.2,basedpyright 是 standard 档,Node 是 24。今天的脚本都放在 `part01/`,在仓库根目录用 `uv run python part01/文件名.py` 运行。

## 先看 JS 里的模块

前端的模块你每天都在用。先花两分钟在 Node 里确认几件事,等下逐条和 Python 对照。在任意空文件夹里建两个文件(`.mjs` 是让 Node 把它当 ES Module 的扩展名):

```js
console.log("util.mjs 正在加载");
export const RATE_PERCENT = 6;
export function withTax(fen) {
  return fen + Math.floor((fen * RATE_PERCENT) / 100);
}
const secret = 1;
```

<div class="line-notes">

- `console.log("util.mjs 正在加载");` 模块顶层的代码,在模块被加载时执行。
- `export const RATE_PERCENT = 6;` 只有写了 `export` 的名字,别的文件才拿得到。
- `export function withTax(fen) {` 同上,导出一个函数。
- `const secret = 1;` 没写 `export`,是这个模块私有的,外面看不见。

</div>

```js
import { withTax } from "./util.mjs";
import { RATE_PERCENT } from "./util.mjs";
import * as util from "./util.mjs";

console.log(withTax(29900), RATE_PERCENT);
console.log(typeof util, Object.keys(util));
console.log("main.mjs 是直接运行的吗:", import.meta.main);
```

<div class="line-notes">

- `import { withTax } from "./util.mjs";` 用花括号点名要哪个。
- `import { RATE_PERCENT } from "./util.mjs";` 同一个文件导入两次,下面会看到它只加载一次。
- `import * as util from "./util.mjs";` 把整个模块当成一个对象拿过来,`util.withTax(...)` 这样用。
- `console.log(withTax(29900), RATE_PERCENT);` 29900 + 29900 × 6 / 100 向下取整 = 31694。
- `console.log(typeof util, Object.keys(util));` 模块对象里只有导出的两个名字,`secret` 不在。
- `console.log("main.mjs 是直接运行的吗:", import.meta.main);` Node 24.2 起有的 `import.meta.main`:直接 `node main.mjs` 时是 `true`,被别人导入时是 `false`。

</div>

```text
$ node main.mjs
util.mjs 正在加载
31694 6
object [ 'RATE_PERCENT', 'withTax' ]
main.mjs 是直接运行的吗: true
```

<div class="line-notes">

- `util.mjs 正在加载` 虽然 `main.mjs` 里 import 了三行,这一句只出现了一次。
- `31694 6` 29900 含税 31694,税率 6。
- `object [ 'RATE_PERCENT', 'withTax' ]` 只有 `export` 过的两个名字。
- `main.mjs 是直接运行的吗: true` 直接运行,所以是 `true`。

</div>

再建一个 `other.mjs`,只有一行 `import "./main.mjs";`,运行 `node other.mjs`:

```text
$ node other.mjs
util.mjs 正在加载
31694 6
object [ 'RATE_PERCENT', 'withTax' ]
main.mjs 是直接运行的吗: false
```

最后一行变成了 `false`。记住这四件事:加载时顶层代码会跑一遍;同一个模块只加载一次;只有导出的名字对外可见;有办法问「我是被直接运行的,还是被别人导入的」。Python 的模块是同一套想法,只是写法有几处不一样,最大的不一样是:**Python 没有 `export`**,模块里每个顶层名字都能被拿走。

## 一个 .py 文件就是一个模块

先看最小的例子。新建 `part01/mod_util.py`:

```python
# agent-zero-lab/part01/mod_util.py
print("mod_util.py 正在加载")

RATE_PERCENT = 6
_SECRET = 1


def with_tax(fen):
    return fen + fen * RATE_PERCENT // 100
```

<div class="line-notes">

- `print("mod_util.py 正在加载")` 和 JS 一样,顶层代码在文件被加载时执行。这一行是用来观察「到底什么时候加载」的。
- `RATE_PERCENT = 6` 一个顶层变量。顶层的名字(变量、函数、类)就是这个模块「对外提供」的东西。
- `_SECRET = 1` 名字前面加下划线,是 Python 程序员之间的约定:「这是内部用的,请别碰」。注意只是约定,并不拦人,我试过 `from mod_util import _SECRET` 照样拿得到,值是 1。
- `def with_tax(fen):` 含税价函数,Day 29 写过类似的。`def` 执行完,模块里就多了 `with_tax` 这个名字。
- `return fen + fen * RATE_PERCENT // 100` 函数里用模块自己的 `RATE_PERCENT`。

</div>

再新建 `part01/mod_use1.py`,去用它:

```python
# agent-zero-lab/part01/mod_use1.py
import sys

import mod_util
import mod_util  # 故意再导入一次

print("mod_util 在缓存里吗:", "mod_util" in sys.modules)
print(mod_util.with_tax(29900))
print(mod_util.RATE_PERCENT)
print(type(mod_util))
print(mod_util.__file__)
```

<div class="line-notes">

- `import sys` Python 自带的 `sys` 模块,今天用它的 `sys.modules`。它和下面一行之间空一行,是因为 Ruff 把标准库的导入和你自己文件的导入分成两组。
- `import mod_util` 找到 `mod_util.py`,执行它,把结果存成一个叫 `mod_util` 的模块对象,同名变量指向它。执行时第 2 行的 `print` 会打出一句话。
- `import mod_util  # 故意再导入一次` 同一个模块再导入一次,看看会不会再执行。答案在下面的输出里。
- `print("mod_util 在缓存里吗:", "mod_util" in sys.modules)` `sys.modules` 是一个字典,存着所有已经加载过的模块,键是模块名。导入完,`"mod_util"` 就在里面了。
- `print(mod_util.with_tax(29900))` 用「模块名.名字」取里面的函数,29900 + 29900 × 6 // 100 = 29900 + 1794 = 31694。
- `print(mod_util.RATE_PERCENT)` 取里面的变量,6。
- `print(type(mod_util))` 模块本身也是一个值,类型是 `module`,就像 JS 里 `import * as util` 得到的那个对象。
- `print(mod_util.__file__)` 模块对象的 `__file__` 属性记着它是从哪个文件来的。

</div>

```text
$ uv run python part01/mod_use1.py
mod_util.py 正在加载
mod_util 在缓存里吗: True
31694
6
<class 'module'>
/Users/你/agent-zero-lab/part01/mod_util.py
```

<div class="line-notes">

- `mod_util.py 正在加载` 这是第一行输出,而它来自 `mod_util.py` 不是 `mod_use1.py`。导入那一刻,Python 把 `mod_util.py` 从头执行了一遍。
- `mod_util 在缓存里吗: True` 加载过的模块被存进了 `sys.modules`。
- `31694` 含税价。
- `6` 税率。
- `<class 'module'>` 模块对象的类型。
- `/Users/你/agent-zero-lab/part01/mod_util.py` 它的来源文件。

</div>

注意文件里写了**两次** `import mod_util`,加载提示却只出现了一次。这就是缓存:第二次导入时 Python 先查 `sys.modules`,发现已经有了,直接把那个现成的模块对象拿来,不再执行文件。Ruff 会对这个故意写的文件报重复导入(F811)。和 JS 的「同一个模块只加载一次」一样。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="import mod_util 的四步:查缓存、找文件、执行、存缓存">
<rect x="20" y="20" width="130" height="50" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="85" y="42" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">import mod_util</text>
<text x="85" y="58" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">你写的这一行</text>
<rect x="200" y="20" width="170" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="285" y="42" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">1 查 sys.modules</text>
<text x="285" y="58" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">有?直接用,结束</text>
<rect x="420" y="20" width="200" height="50" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="520" y="42" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">2 按 sys.path 找文件</text>
<text x="520" y="58" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">先看脚本所在目录</text>
<rect x="420" y="130" width="200" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="520" y="152" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">3 从头执行一遍</text>
<text x="520" y="168" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">print、def 都在这时发生</text>
<rect x="200" y="130" width="170" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="285" y="152" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">4 存进 sys.modules</text>
<text x="285" y="168" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">下次导入走第 1 步</text>
<rect x="20" y="130" width="130" height="50" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="85" y="152" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">名字 mod_util</text>
<text x="85" y="168" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">指向模块对象</text>
<path d="M150 45 H200 M370 45 H420 M520 70 V130 M420 155 H370 M200 155 H150" stroke="var(--ink-soft)" stroke-width="1.5" fill="none"/>
<text x="320" y="214" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">第一次导入走完 1→4,之后每次只走第 1 步</text>
</svg>
<figcaption>import 的四步。你看到的「导入时文件被执行」就是第 3 步;「只加载一次」就是第 1 步的缓存。</figcaption>
</figure>

顺带一提,第一次导入之后,`part01/` 里会冒出一个 `__pycache__/` 文件夹,里面有 `mod_util.cpython-312.pyc` 这样的文件。那是 Python 把你的文件预先编译好的缓存,下次启动省点时间。它是自动生成的,不用管,也不要提交 git(`uv init` 生成的 `.gitignore` 已经写了 `__pycache__/`)。

## from ... import 和 as

`import mod_util` 之后每次都要写 `mod_util.with_tax`。想直接写 `with_tax`,有第二种写法。新建 `part01/mod_use2.py`:

```python
# agent-zero-lab/part01/mod_use2.py
import mod_util as mu
from mod_util import RATE_PERCENT, with_tax

print(with_tax(29900), RATE_PERCENT)
print(mu.with_tax(100))
print(with_tax is mu.with_tax)
print(mod_util.with_tax(100))
```

<div class="line-notes">

- `import mod_util as mu` `as` 给模块起个别名,之后用 `mu` 代替 `mod_util`。名字太长或者和别的名字冲突时用。相当于 JS 的 `import * as mu from "./mod_util.js"`。
- `from mod_util import RATE_PERCENT, with_tax` 从模块里点名拿两样,直接变成这个文件里的名字,不用再写前缀。相当于 JS 的 `import { RATE_PERCENT, withTax } from ...`。Ruff 会把点名的名字排好顺序,所以 `RATE_PERCENT` 排在前面。
- `print(with_tax(29900), RATE_PERCENT)` 不带前缀直接用,31694 和 6。
- `print(mu.with_tax(100))` 通过别名用,100 + 100 × 6 // 100 = 106。
- `print(with_tax is mu.with_tax)` 两条路拿到的是**同一个函数对象**,所以是 `True`。`from` 并没有复制一份。
- `print(mod_util.with_tax(100))` 故意写错:这个文件里只写了 `import mod_util as mu` 和 `from mod_util import ...`,`mod_util` 这个名字从来没被定义过。

</div>

```text
$ uv run python part01/mod_use2.py
mod_util.py 正在加载
31694 6
106
True
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/mod_use2.py", line 8, in <module>
    print(mod_util.with_tax(100))
          ^^^^^^^^
NameError: name 'mod_util' is not defined
```

<div class="line-notes">

- `mod_util.py 正在加载` 两种写法加起来导入了三次,还是只加载一次。
- `31694 6` `from` 拿来的名字直接能用。
- `106` 别名 `mu` 能用。
- `True` 同一个函数对象。
- `NameError: name 'mod_util' is not defined` `import mod_util as mu` 只定义了 `mu`,`from mod_util import ...` 只定义了 `with_tax` 和 `RATE_PERCENT`。**不管哪种写法,模块的原名都不会自动出现**,除非你写的就是 `import mod_util`。编辑器会提前给 `mod_util` 画红线,Ruff 报 F821。

</div>

三种写法放在一起对照 JS:

| Python | JS 里相当于 | 之后怎么用 |
| --- | --- | --- |
| `import mod_util` | `import * as mod_util from "./mod_util.js"` | `mod_util.with_tax(...)` |
| `import mod_util as mu` | `import * as mu from "./mod_util.js"` | `mu.with_tax(...)` |
| `from mod_util import with_tax` | `import { withTax } from "./mod_util.js"` | `with_tax(...)` |
| `from mod_util import with_tax as wt` | `import { withTax as wt } from ...` | `wt(...)` |

选哪个?我的习惯:函数和常量只用一两次、名字又够清楚的,用 `from ... import`;模块名本身就是上下文的(比如 `json.loads`、`math.floor`),用 `import 模块`,读代码的人一眼知道这个函数从哪来。还有一种 `from mod_util import *`(把所有名字倒进来),不要用:读代码的人没法知道一个名字从哪来,两个模块有同名函数时后导入的会悄悄盖掉前面的。

## 三种报错,和 Python 去哪里找文件

先故意错两次。新建 `part01/mod_err1.py`,把模块名少打一个字母:

```python
# agent-zero-lab/part01/mod_err1.py
import mod_utl

print(mod_utl.with_tax(100))
```

```text
$ uv run python part01/mod_err1.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/mod_err1.py", line 2, in <module>
    import mod_utl
ModuleNotFoundError: No module named 'mod_utl'
```

<div class="line-notes">

- `File "/Users/你/agent-zero-lab/part01/mod_err1.py", line 2, in <module>` 第 2 行,就是 `import mod_utl` 那行。
- `import mod_utl` 找一个叫 `mod_utl.py` 的文件,哪儿都找不到。
- `ModuleNotFoundError: No module named 'mod_utl'` 没有这个模块。常见原因:名字拼错;文件不在 Python 找得到的地方(马上讲);要导入的是第三方库却没 `uv add`(`No module named 'httpx'` 就是这个)。

</div>

再新建 `part01/mod_err2.py`,模块名对,函数名拼成复数:

```python
# agent-zero-lab/part01/mod_err2.py
from mod_util import with_taxes

print(with_taxes(100))
```

```text
$ uv run python part01/mod_err2.py
mod_util.py 正在加载
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/mod_err2.py", line 2, in <module>
    from mod_util import with_taxes
ImportError: cannot import name 'with_taxes' from 'mod_util' (/Users/你/agent-zero-lab/part01/mod_util.py). Did you mean: 'with_tax'?
```

<div class="line-notes">

- `mod_util.py 正在加载` 模块找到了,也加载了,所以先有这一句。
- `from mod_util import with_taxes` 去模块里拿 `with_taxes`。
- `ImportError: cannot import name 'with_taxes' from 'mod_util' (/Users/你/agent-zero-lab/part01/mod_util.py)` 模块有,但里面没这个名字。括号里是它找到的文件,方便你核对是不是导入错了文件。行末的 `Did you mean: 'with_tax'?` 是 Python 3.12 在名字很接近时给的提示。名字差得远(练习 3 里的 `classify_ticket`)就没有这句。

</div>

两个报错记住区别:`ModuleNotFoundError` 是**文件**找不到,`ImportError: cannot import name` 是文件找到了、**名字**找不到。`ModuleNotFoundError` 其实是 `ImportError` 的子类。

### Python 去哪里找 mod_util.py

`import mod_util` 里并没写路径,Python 怎么知道去 `part01/` 找?答案在 `sys.path`,一个字符串列表,Python 按顺序一个个目录去找。新建 `part01/mod_path.py`:

```python
# agent-zero-lab/part01/mod_path.py
import sys

print("sys.path 一共", len(sys.path), "项")
print("第 0 项:", sys.path[0])
print("第 1 项:", sys.path[1])
print("最后一项:", sys.path[-1])
```

<div class="line-notes">

- `print("sys.path 一共", len(sys.path), "项")` 我这里 5 项。
- `print("第 0 项:", sys.path[0])` 第 0 项是 `/Users/你/agent-zero-lab/part01`,**你运行的那个脚本所在的文件夹**。`mod_util.py` 和 `mod_use1.py` 在同一个文件夹,所以找得到。
- `print("第 1 项:", sys.path[1])` 后面几项是 Python 自带的标准库(`json`、`math`、`unicodedata` 都在这里)。
- `print("最后一项:", sys.path[-1])` 最后一项是 `.venv/.../site-packages`,`uv add` 装的第三方库放在这里,和 `node_modules` 的角色差不多。

</div>

```text
$ uv run python part01/mod_path.py
sys.path 一共 5 项
第 0 项: /Users/你/agent-zero-lab/part01
第 1 项: /Users/你/.local/share/uv/python/cpython-3.12.13-macos-x86_64-none/lib/python312.zip
最后一项: /Users/你/agent-zero-lab/.venv/lib/python3.12/site-packages
```

这有个很容易踩的后果:**找的是「脚本所在文件夹」,不是「你现在在哪个目录」**。`uv run python part01/mod_use1.py` 在仓库根目录运行,第 0 项仍然是 `part01`,所以能找到。可要是不运行脚本,而是用 `-c` 直接执行一句话,第 0 项变成当前目录:

```text
$ uv run python -c "import mod_util"
Traceback (most recent call last):
  File "<string>", line 1, in <module>
ModuleNotFoundError: No module named 'mod_util'
```

当前目录是仓库根目录,里面没有 `mod_util.py`,所以找不到。这是 [Day 3](/blog/agent-zero/day-003-terminal-1/) 里 `pwd` 显示的「当前目录」,和 Python 的搜索路径是两码事。这个问题的正经解法是把 `part01/` 变成一个「包」,用 `uv run python -m part01.xxx` 从根目录运行,下周的 [Day 33](/blog/agent-zero/day-033-packages/) 专门讲。今天所有脚本一律用 `uv run python part01/文件名.py` 运行就行。

## __name__:这个文件是被直接运行的,还是被导入的

现在回头看 `mod_util.py` 开头那句 `print("mod_util.py 正在加载")`。导入时它会执行,在今天这个小例子里无所谓。可要是一个文件里既有「可以被别人拿去用的零件」,又有「直接运行时要做的事」(读数据、跑流程、打印报告),别人只想用零件,却被迫把整个流程跑一遍,就麻烦了。Node 里的答案是上面那个 `import.meta.main`,Python 里是 `__name__`。

新建 `part01/mod_name.py`,只有一行:

```python
# agent-zero-lab/part01/mod_name.py
print("mod_name.py 里,__name__ 是:", repr(__name__))
```

再建 `part01/mod_name_user.py`,去导入它:

```python
# agent-zero-lab/part01/mod_name_user.py
import mod_name

print("mod_name_user.py 里,__name__ 是:", repr(__name__))
print("mod_name.__name__ 是:", repr(mod_name.__name__))
```

先直接运行 `mod_name.py`:

```text
$ uv run python part01/mod_name.py
mod_name.py 里,__name__ 是: '__main__'
```

<div class="line-notes">

- `mod_name.py 里,__name__ 是: '__main__'` 直接运行 `mod_name.py`,这时它的 `__name__` 是字符串 `'__main__'`。「main」在这里是「入口」的意思,表示这个文件是整次运行的起点。

</div>

再运行 `mod_name_user.py`,它导入了 `mod_name`:

```text
$ uv run python part01/mod_name_user.py
mod_name.py 里,__name__ 是: 'mod_name'
mod_name_user.py 里,__name__ 是: '__main__'
mod_name.__name__ 是: 'mod_name'
```

<div class="line-notes">

- `mod_name.py 里,__name__ 是: 'mod_name'` 这次 `mod_name.py` 是被导入的,它的 `__name__` 变成了模块名 `'mod_name'`,也就是文件名去掉 `.py`。同一个文件、同一句 `print`,值不一样。导入时执行的正是这句。
- `mod_name_user.py 里,__name__ 是: '__main__'` 这次**直接运行的是 `mod_name_user.py`**,所以在它自己里面 `__name__` 是 `'__main__'`。
- `mod_name.__name__ 是: 'mod_name'` 模块对象的 `__name__` 属性就是它的名字,从外面也能读到。

</div>

规律只有一条:**`__name__` 在被直接运行的那个文件里是 `'__main__'`,在被导入的文件里是它的模块名**。这样就能写出「直接运行时才做」的代码。新建 `part01/mod_guard.py`:

```python
# agent-zero-lab/part01/mod_guard.py
RATE_PERCENT = 6


def with_tax(fen):
    return fen + fen * RATE_PERCENT // 100


if __name__ == "__main__":
    print("直接运行,做个自测")
    print("29900 含税应该是 31694:", with_tax(29900) == 31694)
```

<div class="line-notes">

- `RATE_PERCENT = 6` 零件一:常量。
- `def with_tax(fen):` 零件二:函数。这两样是别人导入时想要的。
- `if __name__ == "__main__":` 一个普通的 `if`,条件是「`__name__` 等于 `'__main__'`」。只有直接运行这个文件时才成立。这句我在 Day 10 的 `main.py` 里就让你照抄了,现在你知道它的意思了。
- `print("直接运行,做个自测")` 缩进在 `if` 里面,所以导入时不会执行。
- `print("29900 含税应该是 31694:", with_tax(29900) == 31694)` 29900 + 29900 × 6 // 100 = 31694,比较结果是 `True`。

</div>

再建 `part01/mod_guard_user.py`:

```python
# agent-zero-lab/part01/mod_guard_user.py
import mod_guard

print(mod_guard.with_tax(100))
```

```text
$ uv run python part01/mod_guard.py
直接运行,做个自测
29900 含税应该是 31694: True
```

```text
$ uv run python part01/mod_guard_user.py
106
```

直接运行时跑了自测,被导入时一句也没打印,只有 `mod_guard_user.py` 自己那行的 106(100 + 100 × 6 // 100)。这个套路在 Python 里随处可见,你下载的第三方库、你在公司看到的几乎每个入口文件都有它。对照 JS:

| 要做的事 | Python | Node(ES Module) |
| --- | --- | --- |
| 我是被直接运行的吗 | `__name__ == "__main__"` | `import.meta.main`(Node 24.2 起) |
| 模块自己的名字 | `__name__` | `import.meta.url`(是个文件地址) |
| 只有直接运行时才执行 | `if __name__ == "__main__":` | `if (import.meta.main) { ... }` |

## 拆文件:把 Day 31 的分类器分成两个

动手的时候到了。目标:`tc_rules.py` 放规则和零件(别的项目也想用的),`tc_main.py` 放数据和流程(这次分类专属的)。原来的 `ticket_classifier.py` 留着别动,当作对照。

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="ticket_classifier.py 拆成 tc_rules.py 和 tc_main.py,tc_main 导入 tc_rules">
<rect x="20" y="30" width="170" height="150" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="105" y="52" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">ticket_classifier.py</text>
<text x="105" y="80" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">RAW 数据</text>
<text x="105" y="100" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">RULES / PRIORITY</text>
<text x="105" y="120" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">clean parse load</text>
<text x="105" y="140" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">classify evaluate report</text>
<text x="105" y="160" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">main + main(RAW)</text>
<path d="M190 105 H250" stroke="var(--ink-soft)" stroke-width="1.5" fill="none"/>
<text x="220" y="96" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">拆</text>
<rect x="260" y="20" width="170" height="80" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="345" y="42" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">tc_main.py</text>
<text x="345" y="64" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">RAW 数据 + main()</text>
<text x="345" y="82" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">if __name__ == "__main__"</text>
<rect x="260" y="120" width="170" height="70" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="345" y="142" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">tc_rules.py</text>
<text x="345" y="164" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">规则表 + 八个零件函数</text>
<path d="M345 120 V100" stroke="var(--ink)" stroke-width="1.5" fill="none"/>
<text x="352" y="113" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">from tc_rules import ...</text>
<text x="450" y="64" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">入口:直接运行它</text>
<text x="450" y="164" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">零件:只被导入</text>
</svg>
<figcaption>分法:被导入的一边没有「流程」,只有定义;直接运行的一边放数据和流程,并用 __name__ 守住最后一句。</figcaption>
</figure>

新建 `part01/tc_rules.py`。这些函数一行没改,是从 Day 31 原样搬过来的(逐行解释见 Day 31),只是现在它们住进了自己的文件:

```python
# agent-zero-lab/part01/tc_rules.py
import unicodedata

VALID_CATEGORIES = ("计费", "登录", "功能")
RULES = {
    "功能": ["导出", "抬头", "pdf", "方框", "乱码", "报表", "按钮"],
    "计费": ["扣", "退款", "发票", "金额", "月付", "年付", "refund", "invoice"],
    "登录": ["登录", "登不上", "验证码", "密码", "password", "2fa"],
}
PRIORITY = ["功能", "计费", "登录"]
LABELS = PRIORITY + ["未知"]


def clean(raw):
    return unicodedata.normalize("NFKC", raw).strip()


def parse(line):
    if line == "":
        return None, "空行"
    parts = line.split(maxsplit=3)
    if len(parts) < 4:
        return None, f"只有 {len(parts)} 段「{line}」"
    ticket_id, human, customer, desc = parts
    if human not in VALID_CATEGORIES:
        return None, f"{ticket_id} 的类别「{human}」不认识"
    ticket = {"id": ticket_id, "human": human, "customer": customer, "desc": desc}
    return ticket, ""


def load(raw_text):
    tickets = []
    problems = []
    for no, raw in enumerate(raw_text.split("\n"), start=1):
        ticket, reason = parse(clean(raw))
        if ticket is None:
            problems.append(f"第 {no:2} 行:{reason}")
            continue
        tickets.append(ticket)
    return tickets, problems


def classify(desc, rules=RULES, priority=PRIORITY):
    text = desc.lower()
    scores = {}
    for category, keywords in rules.items():
        scores[category] = sum(1 for kw in keywords if kw in text)
    best = max(priority, key=lambda c: scores[c])
    if scores[best] == 0:
        return "未知", scores
    return best, scores


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


def evaluate(pairs):
    correct = 0
    confusion = {}
    for human, rule in pairs:
        if human == rule:
            correct += 1
        row = confusion.setdefault(human, {})
        row[rule] = row.get(rule, 0) + 1
    return correct, confusion


def show_confusion(confusion, labels):
    print("人工\\规则 " + "".join(f"{c:>6}" for c in labels))
    for human in labels:
        row = confusion.get(human, {})
        print(f"{human:>8}  " + "".join(f"{row.get(c, 0):>6}" for c in labels))


def report(tickets, *, top=3):
    counts = {}
    fen_by_category = {}
    for t in tickets:
        c = t["rule"]
        counts[c] = counts.get(c, 0) + 1
        fen_by_category[c] = fen_by_category.get(c, 0) + t["fen"]
    print("规则分类:", counts)
    print(
        "各类提到的金额:",
        {c: f"{fen / 100:.2f} 元" for c, fen in fen_by_category.items()},
    )
    with_money = sorted(
        [t for t in tickets if t["fen"] > 0], key=lambda t: (-t["fen"], t["id"])
    )
    print(f"金额最大的 {top} 张:")
    for t in with_money[:top]:
        print(f"  {t['id']} {t['fen'] // 100} 元 {t['desc']}")
    unknown = [t["id"] for t in tickets if t["rule"] == "未知"]
    print("规则拿不准、需要人工看的:", unknown if unknown else "无")
```

<div class="line-notes">

- `import unicodedata` `clean` 用到它,所以导入跟着函数一起搬到这个文件。每个文件自己导入自己要用的东西,不会因为别的文件导入了就自动有。
- `VALID_CATEGORIES = ("计费", "登录", "功能")` 三个合法类别。
- `RULES = {` 关键词表,三类各一组词。
- `PRIORITY = ["功能", "计费", "登录"]` 同分时谁优先。
- `LABELS = PRIORITY + ["未知"]` 混淆矩阵的四个标签。
- `def clean(raw):` 全角转半角、去首尾空白。
- `def parse(line):` 一行拆成工单字典,不合格的返回 `(None, 原因)`。
- `def load(raw_text):` 一整段文本读成 `(工单列表, 问题列表)`,Day 31 里是 20 张和 4 行问题。
- `def classify(desc, rules=RULES, priority=PRIORITY):` 默认值用的 `RULES` 和 `PRIORITY` 是**这个文件里的**那两个,所以别的文件导入 `classify` 之后不传参数也能用,不需要自己再导入规则表。
- `def extract_fen(desc):` 从描述里抠金额,「年付多扣了468元」得到 46800 分。
- `def evaluate(pairs):` 数分对几张、算混淆矩阵。
- `def show_confusion(confusion, labels):` 打印混淆矩阵。
- `def report(tickets, *, top=3):` 日报:每类几张、每类金额、金额最大的 3 张、规则拿不准的。

</div>

注意这个文件末尾**没有任何「执行」的语句**:只有 `import`、赋值和 `def`。导入它不会打印任何东西,这是一个「干净」模块该有的样子。

再新建 `part01/tc_main.py`。先写**不带**那句守卫的版本(下面一会儿要踩的坑就出在这里),最后一行是 `main(RAW)`:

```python
# agent-zero-lab/part01/tc_main.py
from tc_rules import (
    LABELS,
    PRIORITY,
    RULES,
    classify,
    evaluate,
    extract_fen,
    load,
    report,
    show_confusion,
)

RAW = """T301 计费 C023 8月2日重复扣款299元,要求退款
T302 登录 C007 验证码收不到
T303 计费 C015 年付多扣了468元
T304 功能 C031 导出PDF乱码
  Ｔ305 计费 C042 发票金额对不上,多收了49元
T306 登录 C007 Forgot password
T307 计费 C015 我想要发票PDF

T308 功能 C023 报表页面按钮点不动
T309 计费 C055 发票PDF下载不了,还被多扣了299元
T310 登录 C031 登不上,提示密码错误
T311 功能 C042 发票抬头能不能改成英文
T312 计费 C007 月付改年付,差价怎么算
T313 登录 C099 扫码登录后一直转圈
T314 功能 C015 想要深色模式
T321 计费
T315 计费 C023 invoice 上的金额少了一位
T316 登录 C042 2FA 验证码过期太快
T317 功能 C031 导出的报表少了一列
T322 其他 C099 随便问问
T318 计费 C055 为什么扣了我两次钱
T319 登录 C015 换了手机号收不到登录验证码
T320 功能 C007 PDF 里中文显示成方框
"""


def main(raw_text, *, rules=RULES, priority=PRIORITY, show_errors=True):
    tickets, problems = load(raw_text)
    print(f"== 读入:有效 {len(tickets)} 张,跳过 {len(problems)} 行")
    for p in problems:
        print("  ", p)

    for t in tickets:
        t["rule"], t["scores"] = classify(t["desc"], rules, priority)
        t["fen"] = extract_fen(t["desc"]) if t["rule"] == "计费" else 0

    print("== 评测")
    correct, confusion = evaluate([(t["human"], t["rule"]) for t in tickets])
    print(f"分对 {correct}/{len(tickets)},准确率 {correct / len(tickets):.0%}")
    show_confusion(confusion, LABELS)
    if show_errors:
        for t in tickets:
            if t["rule"] != t["human"]:
                print(
                    f"  错:{t['id']} 人工={t['human']} 规则={t['rule']} 计分={t['scores']} 「{t['desc']}」"
                )

    print("== 日报")
    report(tickets)
    return correct, tickets



main(RAW)
```

<div class="line-notes">

- `from tc_rules import (` 点名从 `tc_rules.py` 里拿九样东西。名字多,一行写不下,就用括号包起来,一行一个,Ruff 格式化也会帮你排成这样。
- `LABELS,` 混淆矩阵的标签。
- `report,` 日报函数。
- `RAW = """T301 计费 C023 8月2日重复扣款299元,要求退款` 数据留在这里,和 Day 31 一样的 23 行(含一个全角的 `Ｔ305` 和几行故意写坏的)。
- `def main(raw_text, *, rules=RULES, priority=PRIORITY, show_errors=True):` 流程函数。`RULES` 和 `PRIORITY` 这里是**从 `tc_rules` 导入来的名字**,当默认值用。
- `tickets, problems = load(raw_text)` `load` 来自 `tc_rules`,用法和在同一个文件里一模一样。
- `t["rule"], t["scores"] = classify(t["desc"], rules, priority)` 同上。
- `t["fen"] = extract_fen(t["desc"]) if t["rule"] == "计费" else 0` 只给规则判成计费的抠金额。
- `correct, confusion = evaluate([(t["human"], t["rule"]) for t in tickets])` 算分。
- `show_confusion(confusion, LABELS)` 打印矩阵。
- `report(tickets)` 打日报。
- `return correct, tickets` 交回成绩,练习 4 用。
- `main(RAW)` 最后一行直接调用,这就是 Day 31 的写法。

</div>

运行,结果应该和昨天一模一样:

```text
$ uv run python part01/tc_main.py
== 读入:有效 20 张,跳过 4 行
   第  8 行:空行
   第 16 行:只有 2 段「T321 计费」
   第 20 行:T322 的类别「其他」不认识
   第 24 行:空行
== 评测
分对 18/20,准确率 90%
人工\规则     功能    计费    登录    未知
      功能       5     0     0     1
      计费       1     7     0     0
      登录       0     0     6     0
      未知       0     0     0     0
  错:T307 人工=计费 规则=功能 计分={'功能': 1, '计费': 1, '登录': 0} 「我想要发票PDF」
  错:T314 人工=功能 规则=未知 计分={'功能': 0, '计费': 0, '登录': 0} 「想要深色模式」
== 日报
规则分类: {'计费': 7, '登录': 6, '功能': 6, '未知': 1}
各类提到的金额: {'计费': '1115.00 元', '登录': '0.00 元', '功能': '0.00 元', '未知': '0.00 元'}
金额最大的 3 张:
  T303 468 元 年付多扣了468元
  T301 299 元 8月2日重复扣款299元,要求退款
  T309 299 元 发票PDF下载不了,还被多扣了299元
规则拿不准、需要人工看的: ['T314']
```

<div class="line-notes">

- `== 读入:有效 20 张,跳过 4 行` 和 Day 31 一样。
- `分对 18/20,准确率 90%` 18/20,和昨天一样。拆文件没有改变任何行为。
- `错:T307` 两张错的还是 T307(同分)和 T314(没词)。
- `各类提到的金额: {'计费': '1115.00 元'` 日报也一样,299 + 468 + 49 + 299 = 1115。

</div>

### 踩一次:别的文件想借 RAW

拆开就是为了复用。假设明天另一个脚本只想借用这 20 张样本工单,新建 `part01/tc_reuse.py`:

```python
# agent-zero-lab/part01/tc_reuse.py
from tc_main import RAW

print("RAW 的第一行:", RAW.splitlines()[0])
```

<div class="line-notes">

- `from tc_main import RAW` 只想要 `RAW` 这一个名字。
- `print("RAW 的第一行:", RAW.splitlines()[0])` `RAW` 是一大段字符串,`splitlines()` 切成行,取第 0 行。想打印的只有这一行。

</div>

```text
$ uv run python part01/tc_reuse.py
== 读入:有效 20 张,跳过 4 行
   第  8 行:空行
   第 16 行:只有 2 段「T321 计费」
...
  T309 299 元 发票PDF下载不了,还被多扣了299元
规则拿不准、需要人工看的: ['T314']
RAW 的第一行: T301 计费 C023 8月2日重复扣款299元,要求退款
```

只想要一行,却被迫看了一整份评测报告和日报。原因就是前面说过的:`from tc_main import RAW` 会把 `tc_main.py` 从头执行一遍,最后那句 `main(RAW)` 也在里面。(输出一共 23 行,这里只留了头 3 行和末 3 行,中间的 `...` 是我省掉的。想要的那句排在最后。)

修法是 `main(RAW)` 前面加守卫。把 `tc_main.py` 最后改成:

```python
if __name__ == "__main__":
    main(RAW)
```

<div class="line-notes">

- `if __name__ == "__main__":` 直接运行 `tc_main.py` 时成立,被 `tc_reuse.py` 导入时 `__name__` 是 `'tc_main'`,不成立。
- `main(RAW)` 缩进进去,只在直接运行时才调用。

</div>

再跑一遍两个命令:

```text
$ uv run python part01/tc_reuse.py
RAW 的第一行: T301 计费 C023 8月2日重复扣款299元,要求退款
```

```text
$ uv run python part01/tc_main.py | sed -n 6,7p
== 评测
分对 18/20,准确率 90%
```

`tc_reuse.py` 只剩它自己那一句,`tc_main.py` 直接运行时评测照常(我用 `sed -n 6,7p` 只看了第 6、7 行,18/20 在里面)。我用 Ruff 检查了今天所有正常的文件,`ruff format --check` 通过;basedpyright 在编辑器里能顺着 `from tc_rules import ...` 找到文件,所以点击跳转、补全都正常,只有故意写错的文件(`mod_err1.py`、`mod_err2.py`、`mod_use2.py`,和练习 3 里那几个)有红线。

对照一下「零件 → 去哪了」:

| Day 31 里的东西 | 现在在哪 |
| --- | --- |
| `RAW` | `tc_main.py` |
| `VALID_CATEGORIES`、`RULES`、`PRIORITY`、`LABELS` | `tc_rules.py` |
| `clean`、`parse`、`load`、`classify`、`extract_fen`、`evaluate`、`show_confusion`、`report` | `tc_rules.py` |
| `main` 和 `main(RAW)` | `tc_main.py`(后者加了守卫) |

## 动手练习

每道题先自己做,做不出再展开参考答案。所有文件放 `part01/`,在仓库根目录运行。

### 练习 1:先猜,再跑

下面两个文件,运行 `uv run python part01/ex32_1_b.py`。先在纸上写:`A 开始`、`A 结束` 各出现几次?`B:` 那一行出现在它们前面还是后面?最后的 `hello is a2.hello` 是 `True` 还是 `False`?

```python
# agent-zero-lab/part01/ex32_1_a.py
print("A 开始")


def hello():
    return "hello"


print("A 结束")
```

```python
# agent-zero-lab/part01/ex32_1_b.py
import ex32_1_a as a2
from ex32_1_a import hello

print("B:", hello(), a2.hello(), hello is a2.hello)
```

<details><summary>参考答案</summary>

```text
$ uv run python part01/ex32_1_b.py
A 开始
A 结束
B: hello hello True
```

<div class="line-notes">

- `A 开始` 只出现一次。`ex32_1_b.py` 里导入了两次(`import ... as a2` 和 `from ... import`),但第二次走缓存。
- `A 结束` 同样一次,紧跟在 `A 开始` 后面,因为整个文件是一口气执行完的。
- `B: hello hello True` `B:` 在它们**后面**:`import` 在第 1 行就执行完了 `ex32_1_a.py`,然后才轮到第 4 行的 `print`。`True` 是因为 `hello` 和 `a2.hello` 是同一个函数对象。

</div>

如果你的答案是 A 的两句各出现两次,说明你把 import 当成了「复制粘贴文件内容」,回到前面「import 的四步」那张图。

</details>

### 练习 2:给 tc_rules.py 加一段自测

在 `tc_rules.py` 最后加一个只在直接运行时才执行的自测:断言三条分类结果(「验证码收不到」归登录、「年付多扣了468元」归计费、「想要深色模式」归未知)和一条金额(「多扣了468元」得到 46800)。通过时打印 `tc_rules 自测通过`。然后验证:直接运行 `tc_rules.py` 会打印;运行 `tc_main.py` 的输出不多出这一句。

<details><summary>参考答案</summary>

在 `part01/tc_rules.py` 末尾追加:

```python
# agent-zero-lab/part01/tc_rules.py(末尾追加)
if __name__ == "__main__":
    assert classify("验证码收不到")[0] == "登录"
    assert classify("年付多扣了468元")[0] == "计费"
    assert classify("想要深色模式")[0] == "未知"
    assert extract_fen("多扣了468元") == 46800
    print("tc_rules 自测通过")
```

<div class="line-notes">

- `if __name__ == "__main__":` 只在直接运行 `tc_rules.py` 时执行。
- `assert classify("验证码收不到")[0] == "登录"` `classify` 返回 `(类别, 计分字典)`,`[0]` 取类别。「验证码」是登录词,得 1 分,别的类 0 分,所以是「登录」。`assert 条件` 条件为假时直接报 `AssertionError`,为真什么也不发生。
- `assert classify("年付多扣了468元")[0] == "计费"` 「年付」「扣」各 1 分,计费 2 分。
- `assert classify("想要深色模式")[0] == "未知"` 一个词都没命中,所有类 0 分,返回「未知」,这正是 Day 31 的 T314。
- `assert extract_fen("多扣了468元") == 46800` 468 元 × 100 = 46800 分。
- `print("tc_rules 自测通过")` 四条断言都没报错才会走到这里。

</div>

```text
$ uv run python part01/tc_rules.py
tc_rules 自测通过
```

```text
$ uv run python part01/tc_main.py | sed -n 1,2p
== 读入:有效 20 张,跳过 4 行
   第  8 行:空行
```

自测只在直接运行时出现,`tc_main.py` 导入了 `tc_rules` 却没有多出这一句,输出开头仍然是「== 读入」。(这一题我在另一份拷贝里跑的,没有改动前面做好的 `tc_rules.py`,你的仓库里就是直接加在末尾。)

</details>

### 练习 3:找出三个错

下面三个文件各有一个和导入有关的错。不运行,先写出每个会报什么错、为什么;再运行核对。

```python
# agent-zero-lab/part01/ex32_3_a.py
from tc_rules import classify_ticket

print(classify_ticket("验证码收不到"))
```

```python
# agent-zero-lab/part01/ex32_3_b.py
import tc_rules

print(classify("验证码收不到"))
```

```python
# agent-zero-lab/part01/ex32_3_c.py
import tc_rules.classify

print(tc_rules.classify("验证码收不到"))
```

<details><summary>参考答案</summary>

```text
$ uv run python part01/ex32_3_a.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex32_3_a.py", line 2, in <module>
    from tc_rules import classify_ticket
ImportError: cannot import name 'classify_ticket' from 'tc_rules' (/Users/你/agent-zero-lab/part01/tc_rules.py)
```

<div class="line-notes">

- `ImportError: cannot import name 'classify_ticket' from 'tc_rules'` 文件找到了,里面没有这个名字(函数叫 `classify`)。这次名字差得多,没有 `Did you mean`。修:`from tc_rules import classify`。

</div>

```text
$ uv run python part01/ex32_3_b.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex32_3_b.py", line 4, in <module>
    print(classify("验证码收不到"))
          ^^^^^^^^
NameError: name 'classify' is not defined
```

<div class="line-notes">

- `NameError: name 'classify' is not defined` `import tc_rules` 只定义了 `tc_rules` 这一个名字,`classify` 要写成 `tc_rules.classify(...)`;或者改成 `from tc_rules import classify`。Ruff 同时报了 F401(导入没用上)和 F821(`classify` 没定义),两条合起来就是这个错的指纹。

</div>

```text
$ uv run python part01/ex32_3_c.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex32_3_c.py", line 2, in <module>
    import tc_rules.classify
ModuleNotFoundError: No module named 'tc_rules.classify'; 'tc_rules' is not a package
```

<div class="line-notes">

- `ModuleNotFoundError: No module named 'tc_rules.classify'; 'tc_rules' is not a package` `import a.b` 这种写法要求 `a` 是一个「包」(文件夹),`b` 是里面的模块。`tc_rules` 是个单文件,里面的 `classify` 是函数,不能这样导入。函数用 `from tc_rules import classify`。包是什么,Day 33 讲。

</div>

</details>

### 练习 4:用 as 和 from 写一个对比脚本

写 `part01/ex32_4_compare.py`:从 `tc_main` 拿 `RAW`,用 `import tc_rules as tc` 拿规则,比较「原版规则」和「功能类加了『想要』一词的规则」在这 20 张工单上各对几张。要求:不修改 `tc_rules.RULES`,打印最后确认它没被改;对比部分放在 `if __name__ == "__main__":` 里。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex32_4_compare.py
import tc_rules as tc
from tc_main import RAW

TUNED = tc.RULES.copy()
TUNED["功能"] = tc.RULES["功能"] + ["想要"]


def score(rules):
    tickets, _ = tc.load(RAW)
    pairs = []
    for t in tickets:
        rule, _ = tc.classify(t["desc"], rules)
        pairs.append((t["human"], rule))
    correct, _ = tc.evaluate(pairs)
    return correct, len(tickets)


if __name__ == "__main__":
    for name, rules in [("原版", tc.RULES), ("加了「想要」", TUNED)]:
        correct, total = score(rules)
        print(f"{name}: {correct}/{total}")
    print("RULES 没被改:", "想要" not in tc.RULES["功能"])
```

<div class="line-notes">

- `import tc_rules as tc` 给模块起短别名,下面写 `tc.RULES`、`tc.load` 都方便。
- `from tc_main import RAW` 只拿数据;因为 `tc_main.py` 有守卫,导入它不会跑一遍评测。
- `TUNED = tc.RULES.copy()` 先复制一份外层字典(Day 24)。
- `TUNED["功能"] = tc.RULES["功能"] + ["想要"]` 给 `TUNED` 的「功能」换成一个**新列表**(`+` 拼出的是新列表)。如果写成 `TUNED["功能"].append("想要")`,会改到原来那个列表,`tc.RULES` 也被改了,最后一行就会打印 `False`。
- `def score(rules):` 对一张规则表算分对几张,返回 `(分对数, 总数)`。
- `tickets, _ = tc.load(RAW)` 读入 20 张,问题列表用不着,`_` 接住。
- `rule, _ = tc.classify(t["desc"], rules)` 用传进来的规则表分类;计分字典用不着。
- `correct, _ = tc.evaluate(pairs)` 数分对几张,混淆矩阵用不着。
- `if __name__ == "__main__":` 对比放在守卫里,以后别的文件导入 `score` 不会触发打印。
- `for name, rules in [("原版", tc.RULES), ("加了「想要」", TUNED)]:` 两张表各算一遍。
- `print("RULES 没被改:", "想要" not in tc.RULES["功能"])` 确认原版没被污染。

</div>

```text
$ uv run python part01/ex32_4_compare.py
原版: 18/20
加了「想要」: 19/20
RULES 没被改: True
```

加了「想要」后 T314「想要深色模式」从「未知」变成「功能」,对了,所以 19/20;T307「我想要发票PDF」本来就是同分判错,没变化。20 张里 19 张对,看着很棒,可它和 Day 31 练习 4 里那个道理一样:这个词是照着手里那 20 张加的,拿到新数据未必成立。

</details>

**验收标准:** `tc_rules.py` 和 `tc_main.py` 两个文件拆好,`uv run python part01/tc_main.py` 跑出 18/20,`tc_reuse.py` 只打印一行;你能不看文章写出 `mod_guard.py` 那种带守卫的文件;练习 3 能说出三个报错各自是「文件找不到」「名字找不到」还是「名字没定义」;练习 4 能解释为什么 `TUNED["功能"] = ... + [...]` 不会改到原来的 `RULES`。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 模块(module) | 一个 `.py` 文件。里面的顶层名字(变量、函数、类)可以被别的文件拿去用。≈ JS 的一个 ES Module 文件 |
| `import` | 把一个模块加载进来,得到一个模块对象,之后用「模块名.名字」取里面的东西。≈ `import * as m from` |
| `from ... import` | 从模块里点名拿几样东西,直接变成当前文件里的名字。≈ `import { a, b } from` |
| `as` | 给导入的模块或名字起别名:`import tc_rules as tc`。≈ JS 的 `as` |
| 模块对象 | `import` 之后得到的那个值,类型是 `module`,有 `__file__`、`__name__` 等属性 |
| `sys.modules` | 一个字典,存着已经加载过的所有模块,「同一模块只加载一次」靠它 |
| `sys.path` | 一个目录列表,Python 按顺序去这些目录找模块。第 0 项是脚本所在的文件夹 |
| `__name__` | 每个模块里都有的特殊变量。被直接运行时是 `'__main__'`,被导入时是模块名。≈ `import.meta.main` 能回答的问题 |
| `__main__` | 「入口」。直接运行的那个文件在这次运行里叫 `__main__` |
| `if __name__ == "__main__":` | 把「只在直接运行时才做的事」圈起来的惯用写法,也叫「守卫」 |
| `__pycache__` | 导入后自动生成的文件夹,放编译缓存(`.pyc`)。不用管,不提交 git |
| `ModuleNotFoundError` | 找不到这个模块(文件)。名字拼错、不在搜索路径里、第三方库没装都会这样 |
| `ImportError: cannot import name` | 模块找到了,但里面没有你点名要的东西 |
| 入口文件 | 你用 `uv run python 文件名` 直接运行的那个文件,例如 `tc_main.py` |

## 常见误区

**以为 `import` 只是「声明我要用」。** 它会把整个文件执行一遍,所以别在模块顶层放「导入就会发生的副作用」(打印、读文件、发请求、调 API)。Day 31 的 `main(RAW)` 就是个例子。要做的事放进函数里,再用守卫决定要不要在直接运行时调用。

**以为 `from mod_util import with_tax` 之后还能写 `mod_util.xxx`。** 不能。`from` 只定义了你点名的那几个名字,模块名本身没有。想要两个都有,写两行。

**给自己的文件起了个标准库的名字。** 这是我见过最恶心的一类 bug。我在一个空文件夹里放了一个文件 `random.py`(随手写了个函数),又写 `dice.py` 想掷骰子:

```python
# /Users/你/shadow/dice.py
import random

print(random.randint(1, 6))
```

```text
$ python dice.py
Traceback (most recent call last):
  File "/Users/你/shadow/dice.py", line 3, in <module>
    print(random.randint(1, 6))
          ^^^^^^^^^^^^^^
AttributeError: module 'random' has no attribute 'randint'
```

脚本所在目录排在 `sys.path` 的第 0 项,比标准库靠前,于是 `import random` 导入的是自己那个 `random.py`。看着像标准库出了问题,其实是你的文件把它「挡住」了。修法:改文件名。自己的文件别叫 `random.py`、`json.py`、`math.py`、`time.py`、`email.py`、`test.py` 这类名字。

**在一个模块里 `print` 一堆东西「方便调试」,别人导入时被刷屏。** 调试用的 `print` 要么删掉,要么放进守卫里。

**把 `_SECRET` 前面的下划线当成「私有」。** 它只是约定。想真的拦住,Python 没有这种东西,靠的是大家自觉和代码评审。

**`-c` 或在别的目录里运行,导入就找不到了。** 本文「Python 去哪里找」一节已经演示过,今天先记住「用 `uv run python part01/文件名.py` 运行」,Day 33 再根治。

## 学习资料

### 文档与文章

- [Python 教程 · 模块](https://docs.python.org/zh-cn/3.12/tutorial/modules.html):中文,官方教程里 `import`、`from ... import`、`as`、模块搜索路径、`__name__ == "__main__"`(他们叫「把模块当作脚本执行」)都在这一页,今天的内容基本是这一页的前半段。
- [Python 标准库 · `__main__` ——最高层级代码环境](https://docs.python.org/zh-cn/3.12/library/__main__.html):中文,`__name__ == '__main__'` 到底是什么意思,官方的说法。
- [Python 参考 · 导入系统](https://docs.python.org/zh-cn/3.12/reference/import.html):中文,`sys.modules` 缓存和搜索顺序的严格说法。现在读不懂很正常,有个印象就行。
- [MDN · JavaScript 模块](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Guide/Modules)、[import](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Statements/import)、[export](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Statements/export):中文,JS 一侧的对照物。
- [Node.js 文档 · import.meta.main](https://nodejs.org/api/esm.html):英文,页面里搜 `import.meta.main`,Node 24.2 起可用。
- [Real Python · What Does if __name__ == "__main__" Do in Python?](https://realpython.com/if-name-main-python/):英文,对守卫讲得最细的一篇。对爬虫返回 403,需浏览器打开。
- [Ruff · redefined-while-unused (F811)](https://docs.astral.sh/ruff/rules/redefined-while-unused/):英文,重复导入同一个名字时的那条提醒。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1K24y1k7XA&autoplay=0&high_quality=1" title="【python】关于import你需要知道的一切!一个视频足够了" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>码农高天 · 【python】关于import你需要知道的一切!一个视频足够了 · 约 17 分钟,2022 年。前半段对应今天(import 做了什么、`__name__`),讲包和相对导入的后半段留到 Day 33 再看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1i24y117P2&autoplay=0&high_quality=1" title="第一课:import及from...import" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>城里的青蛙 · 第一课:import及from...import · 约 12 分钟,2022 年,播放量不高但很短,只讲今天「三种写法」那一节,适合先看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/sugvnHA7ElY" title="Python Tutorial: if __name__ == '__main__'" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Tutorial: if __name__ == '__main__' · 英文,约 9 分钟,从「为什么导入时会执行」讲到守卫,和今天最后两节是同一条线。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/CqvZ3vGoGs0" title="Python Tutorial for Beginners 9: Import Modules and Exploring The Standard Library" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Tutorial for Beginners 9: Import Modules and Exploring The Standard Library · 英文,看他演示 `import` 的几种写法和 `sys.path`,再顺着看标准库里有哪些现成的模块。</figcaption>
</figure>

### 书籍

- Eric Matthes《Python Crash Course》第 3 版,No Starch Press,2023(中译《Python编程:从入门到实践》第 3 版,人民邮电出版社)。第 8 章末尾「Storing Your Functions in Modules」,讲的是今天的 `import`、`from ... import`、`as`。
- Luciano Ramalho《Fluent Python》第 2 版,O'Reilly,2022。以后想弄清导入系统的内部机制再读,今天不用。

### 开源项目与代码

- [Asabeneh/30-Days-Of-Python · Day 12 Modules](https://github.com/Asabeneh/30-Days-Of-Python/tree/master/12_Day_Modules):英文,从 `import` 到自己写模块、内置模块,篇幅短,练习可以顺手做几道。

## 自测

1. 文件里写了两次 `import mod_util`,模块顶层的 `print` 会打印几次?为什么?

<details><summary>答案</summary>

一次。第一次导入时 Python 找到文件、从头执行、存进 `sys.modules`;第二次先查 `sys.modules`,有了,直接用,不再执行。

</details>

2. `from mod_util import with_tax` 之后,写 `mod_util.RATE_PERCENT` 会怎样?

<details><summary>答案</summary>

`NameError: name 'mod_util' is not defined`。`from ... import` 只定义你点名的名字(这里是 `with_tax`),模块的原名不会出现。想用 `mod_util.RATE_PERCENT`,要么再写一行 `import mod_util`,要么把 `RATE_PERCENT` 也点名导入。

</details>

3. `ModuleNotFoundError: No module named 'mod_utl'` 和 `ImportError: cannot import name 'with_taxes' from 'mod_util'` 有什么区别?

<details><summary>答案</summary>

前者是整个模块(文件)没找到,先查名字有没有拼错、文件在不在 `sys.path` 里的目录、第三方库有没有 `uv add`。后者是文件找到了,但里面没有那个名字,去文件里看看函数到底叫什么。

</details>

4. 一个文件直接运行时 `__name__` 是什么?被别的文件导入时呢?`if __name__ == "__main__":` 圈起来的代码什么时候执行?

<details><summary>答案</summary>

直接运行时是字符串 `'__main__'`,被导入时是模块名(文件名去掉 `.py`,例如 `'tc_main'`)。所以守卫里的代码只在这个文件被直接运行时执行,被导入时不执行。

</details>

5. 面试题:你写了一个 `utils.py`,同事导入它做了一个很小的事,结果程序启动时多了一大段日志,还多花了几秒。最可能的原因是什么,你怎么改?

<details><summary>答案</summary>

最可能是 `utils.py` 顶层有「导入就会执行」的东西:打印、读文件、网络请求、直接调用了某个主流程函数。`import` 会把整个文件执行一遍。改法:把这些放进函数里,需要在直接运行时才做的部分放进 `if __name__ == "__main__":`,让导入只做定义,别的什么也不发生。

</details>

6. 你在项目里建了一个 `json.py` 放自己的小函数,之后 `import json` 开始报 `AttributeError: module 'json' has no attribute 'loads'`。为什么?

<details><summary>答案</summary>

脚本所在目录排在 `sys.path` 第 0 项,比标准库靠前,`import json` 导入的是你自己的 `json.py`,里面当然没有 `loads`。改文件名即可,别用标准库或常用第三方库的名字。

</details>

## 明天预告

Day 33 · 包:`__init__.py`、`-m` 运行和从根目录跑。今天所有脚本都靠一个前提:被导入的文件和脚本在同一个文件夹,并且用 `uv run python part01/文件名.py` 运行。一旦你想把 `part01/` 当成一个整体,用 `uv run python -m part01.tc_main` 从仓库根目录运行,或者在 `tests/` 里导入它们(Day 71 开始写测试),这个前提就不成立了。明天讲「包」:文件夹怎么变成包,`__init__.py` 是干什么的,`-m` 为什么能解决今天 `import mod_util` 在 `-c` 下找不到的问题,以及 Day 10 里那句 `uv run python main.py` 和 `-m` 到底差在哪。
