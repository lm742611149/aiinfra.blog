---
title: 'Day 71 · pytest(一):assert 和第一个测试'
description: '从「每次改完代码手动跑一遍」讲起,用 assert 写下「我期望的结果」,再用 pytest 自动把它们全跑一遍。对照 Jest/Vitest,读懂 pytest 的通过和失败报告。'
pubDate: 2026-10-22
regime: none
tags: ['python', 'pytest', 'testing', 'agent-zero']
series: 'agent-zero'
day: 71
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 70](/blog/agent-zero/day-070-weather-project/) 我们把 httpx、async 和错误处理拼成了一个命令行天气查询工具。写完之后你大概做过这样的事:改一行代码,在终端里敲一遍命令,眼睛盯着输出看对不对;再改一行,再敲一遍。三五个函数还好,等到后面 Agent 一次要调十几个工具、每个工具都有自己的解析逻辑,这样手动看就看不过来了。今天开始的四天专门学怎么让电脑替你「看对不对」,也就是写自动化测试。第一天只讲两件事:`assert` 这个语句,和用 pytest 跑起第一个测试文件。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说清楚 `assert` 做了什么:条件为真时什么都不发生,为假时抛出 `AssertionError`。
2. 用 `uv add --dev pytest` 装好 pytest,写一个 `test_` 开头的文件和函数,用 `uv run pytest` 跑通。
3. 看懂 pytest 的输出:`.` 和 `F` 是什么意思,失败报告里哪一行告诉你「实际是多少、期望是多少」。
4. 知道小数不能直接用 `==` 比,要用 `pytest.approx`。

预计用时:2 小时。

前置:[Day 11](/blog/agent-zero/day-011-uv-2/) 的 uv 项目和 pyproject.toml、[Day 12](/blog/agent-zero/day-012-numbers/) 的浮点误差、[Day 28](/blog/agent-zero/day-028-functions-1/) 的函数、[Day 33](/blog/agent-zero/day-033-packages/) 的包和 `-m` 运行、[Day 35](/blog/agent-zero/day-035-exceptions-1/) 的异常和 traceback。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `test_cost.py` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 测试是什么:把「我眼睛看」变成「电脑来查」

先用前端的经验对一下号。你在前端项目里可能见过这样的文件:

```ts
// sum.test.ts(Vitest 写法,只是拿来对照)
import { expect, test } from 'vitest'
import { sum } from './sum'

test('1 + 2 = 3', () => {
  expect(sum(1, 2)).toBe(3)
})
```

<div class="line-notes">

- `import { expect, test } from 'vitest'` Vitest 要你从库里导入 `test` 和 `expect` 两个函数。pytest 里这两样都不用导入,后面会看到。
- `import { sum } from './sum'` 导入被测的函数。pytest 里也一样要导入被测代码,这一点两边相同。
- `test('1 + 2 = 3', () => {` 用 `test()` 注册一个用例,第一个参数是名字。pytest 不需要注册,函数名以 `test_` 开头就自动算一个用例。
- `expect(sum(1, 2)).toBe(3)` 断言:实际值是 `sum(1, 2)`,期望值是 `3`。pytest 里这一行写成 `assert sum(1, 2) == 3`,就是普通的 Python 比较。

</div>

**测试(test)** 说白了就是一段代码,它调用你写的函数,然后检查结果是不是你期望的那个值。检查这个动作叫 **断言(assertion)**。手动测试是你自己看输出,自动化测试是把「期望是多少」写进代码,让程序自己比。好处有两个:一是快,几百个检查一秒跑完;二是不会漏,你改了 A 函数顺手搞坏了 B 函数,B 的测试会立刻变红。

两边的对照先放一张表,后面三天还会往里加东西:

| 前端(Jest / Vitest) | Python(pytest) | 说明 |
| --- | --- | --- |
| `npm i -D vitest` | `uv add --dev pytest` | 装成开发依赖 |
| `sum.test.ts` | `test_sum.py` | 测试文件命名约定 |
| `test('名字', () => {...})` | `def test_名字():` | 一个用例 |
| `expect(a).toBe(b)` | `assert a == b` | 断言 |
| `expect(a).toBeCloseTo(b)` | `assert a == pytest.approx(b)` | 小数近似相等 |
| `npx vitest run` | `uv run pytest` | 跑全部测试 |

为什么 Agent 工程师要学测试?模型的输出每次都不一样,没法用 `==` 比。但你写的工具函数、解析模型返回的代码、算钱的代码,输入一样输出就一样,这些全都该有测试。后面第六部分的评测体系也是搭在 pytest 上的。面试官点开你的 GitHub 仓库,有没有 `tests/` 目录是第一眼就看的东西。

## 第 1 步:准备一个要被测的函数

测试总得测点什么。我们写一个后面整门课都会用到的函数:算一次模型调用花了多少钱。

先查价格。2026 年 10 月我在 [DeepSeek 官方价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) 查到,`deepseek-flash` 高峰时段(北京时间工作日 9–12 点、14–18 点)输入(缓存未命中)每百万 token 2 元,输出每百万 token 8 元;空闲时段是高峰价的一半,1 元和 4 元。今天的例子都用高峰价 2.0 和 8.0。

在练习仓库 `agent-zero-lab` 的 `part01/` 目录里新建 `cost.py`。`part01/` 里应该已经有 [Day 33](/blog/agent-zero/day-033-packages/) 建的空文件 `__init__.py`,它让 `part01` 成为一个包;没有的话先在仓库根目录敲 `touch part01/__init__.py`。

```python
# agent-zero-lab/part01/cost.py
def total_cost(prompt_tokens: int, completion_tokens: int, price_in: float, price_out: float) -> float:
    """算一次模型调用花多少钱。单价单位:元 / 百万 token。"""
    return (prompt_tokens * price_in + completion_tokens * price_out) / 1_000_000
```

<div class="line-notes">

- `def total_cost(prompt_tokens: int` 四个参数:输入 token 数、输出 token 数、输入单价、输出单价。`: int`、`: float`、`-> float` 是 [Day 45](/blog/agent-zero/day-045-type-hints-1/) 学的类型标注,只给编辑器和人看,运行时不检查。
- `"""算一次模型调用花多少钱。` 三引号字符串放在函数第一行叫 docstring(文档字符串),相当于 JS 里函数上方的 JSDoc 注释,编辑器悬停时会显示它。
- `return (prompt_tokens * price_in + completion_tokens * price_out) / 1_000_000` 单价是「每百万 token」的价,所以最后除以一百万。`1_000_000` 里的下划线只是方便人数位数,和 `1000000` 完全一样。代入一次真实调用 `total_cost(8, 29, 2.0, 8.0)`:`(8×2.0 + 29×8.0) / 1_000_000 = 248 / 1_000_000 = 0.000248` 元。

</div>

在仓库根目录(`agent-zero-lab/`,不是 `part01/` 里面)试一下:

```bash
cd ~/agent-zero-lab        # 换成你自己的仓库路径
uv run python -c "from part01.cost import total_cost; print(total_cost(8, 29, 2.0, 8.0))"
```

<div class="line-notes">

- `cd ~/agent-zero-lab` 后面所有命令都在仓库根目录跑。整门课的约定是「永远从根目录跑」,[Day 33](/blog/agent-zero/day-033-packages/) 讲过原因。
- `uv run python -c` `-c` 后面跟一段 Python 代码直接执行,适合试一行小东西。`from part01.cost import total_cost` 能找到模块,是因为 `python` 会把当前目录放进模块搜索路径,而当前目录下有 `part01/` 这个包。这个细节明天会变得很重要。

</div>

实跑输出:

```text
0.000248
```

## 第 2 步:不用任何库,先认识 assert

`assert` 是 Python 自带的语句,不用装任何东西。写法是 `assert 条件` 或者 `assert 条件, "失败时的说明"`。条件为真,这一行什么都不做,程序接着往下走;条件为假,抛出一个 `AssertionError` 异常。用 JS 来想,它大概相当于:

```js
// 只是拿来对照的 JS 写法
if (!(条件)) throw new Error("失败时的说明")
```

<div class="line-notes">

- `if (!(条件)) throw new Error("失败时的说明")` 条件不成立就抛异常。Python 的 `assert` 就是把这一整句缩成一个关键字,抛出的异常类型叫 `AssertionError`。

</div>

写一个小脚本试试。第一条断言是对的,第二条我故意把期望值写错:100 万输出 token,按 8 元算应该是 8.0 元,我写成了 4.0。

```python
# agent-zero-lab/part01/assert_demo.py
from part01.cost import total_cost

assert total_cost(1_000_000, 0, 2.0, 8.0) == 2.0
print("第 1 条过了")
assert total_cost(0, 1_000_000, 2.0, 8.0) == 4.0, "100 万输出 token 我以为是 4 元"
print("第 2 条过了")
```

<div class="line-notes">

- `from part01.cost import total_cost` 从第 1 步的 `part01/cost.py` 里导入函数。
- `assert total_cost(1_000_000, 0, 2.0, 8.0) == 2.0` 先算左边:`(1_000_000×2.0 + 0×8.0) / 1_000_000 = 2.0`,再比 `2.0 == 2.0`,结果是 `True`,这一行什么也不发生。
- `print("第 1 条过了")` 能打印出来,说明上一行没抛异常。
- `assert total_cost(0, 1_000_000, 2.0, 8.0) == 4.0, "100 万输出 token 我以为是 4 元"` 左边实际是 `(0 + 1_000_000×8.0) / 1_000_000 = 8.0`,`8.0 == 4.0` 是 `False`,于是抛出 `AssertionError`,逗号后面那段字符串就是异常的说明文字。
- `print("第 2 条过了")` 永远执行不到,异常在上一行就把程序终止了。

</div>

用 [Day 33](/blog/agent-zero/day-033-packages/) 学的 `-m` 方式从根目录运行:

```bash
uv run python -m part01.assert_demo
```

实跑输出(路径换成了 `/Users/你/`,下同):

```text
第 1 条过了
Traceback (most recent call last):
  File "<frozen runpy>", line 198, in _run_module_as_main
  File "<frozen runpy>", line 88, in _run_code
  File "/Users/你/agent-zero-lab/part01/assert_demo.py", line 6, in <module>
    assert total_cost(0, 1_000_000, 2.0, 8.0) == 4.0, "100 万输出 token 我以为是 4 元"
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: 100 万输出 token 我以为是 4 元
```

traceback 怎么读在 [Day 35](/blog/agent-zero/day-035-exceptions-1/) 讲过:从下往上看,最后一行是异常类型和说明,倒数第二块告诉你出在 `assert_demo.py` 第 6 行。

光靠裸 `assert` 写测试有两个明显的问题。第一,它在第一条失败的地方就停了,后面要是还有十条检查,你一条也看不到结果。第二,它不告诉你左边实际算出来是多少。上面这个例子我自己写了说明文字还好,要是没写,只有一行光秃秃的 `AssertionError`,你得自己加 `print` 去查。我在终端里试了一下 `x = 0.1 + 0.2` 然后 `assert x == 0.3`,输出就只有:

```text
AssertionError
```

pytest 解决的就是这两个问题:每个测试单独跑,一个失败不影响别的;失败时把左右两边的值都打印出来。

## 第 3 步:装 pytest

pytest 是 Python 最常用的测试框架(2026 年 10 月在 PyPI 查到的最新版是 9.1.1,6 月发布)。它只在开发和跑测试时用,上线运行的程序用不到,所以装成 **开发依赖**,相当于 npm 的 `devDependencies`:

```bash
uv add --dev pytest
```

<div class="line-notes">

- `uv add --dev pytest` `--dev` 表示加到开发依赖组里。和 `npm i -D vitest` 是一个意思。uv 会下载 pytest 和它依赖的几个小包(pluggy、iniconfig、pygments),装进 `.venv`,同时改 `pyproject.toml` 和 `uv.lock`。

</div>

实跑输出的最后几行:

```text
 + iniconfig==2.3.1
 + pluggy==1.7.0
 + pygments==2.21.0
 + pytest==9.1.1
```

打开 `pyproject.toml`,末尾多了这一段:

```toml
[dependency-groups]
dev = [
    "pytest>=9.1.1",
]
```

<div class="line-notes">

- `[dependency-groups]` 依赖分组。`[project]` 下的 `dependencies` 是程序运行时要的,这里是额外的分组,[Day 11](/blog/agent-zero/day-011-uv-2/) 见过它的位置。
- `dev = [` 叫 `dev` 的组,`uv add --dev` 默认往这里写。`uv sync` 和 `uv run` 默认会把 dev 组也装上,所以你不用做别的。
- `"pytest>=9.1.1",` 版本约束:至少 9.1.1。实际装的是哪个精确版本记在 `uv.lock` 里。

</div>

确认一下装好了:

```bash
uv run pytest --version
```

实跑输出:

```text
pytest 9.1.1
```

## 第 4 步:第一个测试文件

pytest 找测试靠命名约定:**文件名以 `test_` 开头,文件里函数名以 `test_` 开头**,它就会自动收集并运行,不需要任何注册代码。

在 `part01/` 里新建 `test_cost.py`,和 `cost.py` 放在一起:

```python
# agent-zero-lab/part01/test_cost.py
from part01.cost import total_cost


def test_input_only():
    assert total_cost(1_000_000, 0, 2.0, 8.0) == 2.0


def test_output_only():
    assert total_cost(0, 500_000, 2.0, 8.0) == 4.0


def test_real_call():
    assert total_cost(8, 29, 2.0, 8.0) == 0.000248
```

<div class="line-notes">

- `from part01.cost import total_cost` 测试文件也是普通的 Python 文件,要用被测函数就得导入。注意这里没有 `import pytest`,今天前半段的写法根本用不到它。
- `def test_input_only():` 函数名以 `test_` 开头,pytest 就把它当一个用例。名字要能看出在测什么,失败时报告里显示的就是这个名字。函数不需要参数,也不需要返回值。
- `assert total_cost(1_000_000, 0, 2.0, 8.0) == 2.0` 只有输入:100 万输入 token × 2 元 / 100 万 = 2.0 元,正好等于单价,一眼就能核对。
- `def test_output_only():` 第二个用例,专门测输出 token 那一半公式。
- `assert total_cost(0, 500_000, 2.0, 8.0) == 4.0` 只有输出:`500_000 × 8.0 / 1_000_000 = 4.0`。一个用例只测一件事,哪个红了你就知道是公式哪一半出了问题。
- `def test_real_call():` 用一组真实调用里会出现的小数字。
- `assert total_cost(8, 29, 2.0, 8.0) == 0.000248` `248 / 1_000_000` 算出来的浮点数和你写的字面量 `0.000248` 恰好是同一个数,所以 `==` 能过。这是运气好,第 7 步会看到不走运的情况。

</div>

在仓库根目录运行:

```bash
uv run pytest part01/test_cost.py
```

<div class="line-notes">

- `uv run pytest part01/test_cost.py` `uv run` 保证用的是项目 `.venv` 里的 pytest;后面给了一个文件路径,pytest 就只跑这个文件。不给路径的话它会从当前目录往下找所有 `test_*.py`。

</div>

实跑输出:

```text
============================= test session starts ==============================
platform darwin -- Python 3.12.13, pytest-9.1.1, pluggy-1.7.0
rootdir: /Users/你/agent-zero-lab
configfile: pyproject.toml
collected 3 items

part01/test_cost.py ...                                                  [100%]

============================== 3 passed in 0.04s ===============================
```

一行行看。`platform` 那行是操作系统、Python 版本和 pytest 版本,出问题贴给别人看时这行很有用。`rootdir` 是 pytest 认定的项目根目录,它从你给的路径往上找,找到 `pyproject.toml` 所在的目录就停,`configfile` 说的就是它读了这个文件(现在里面还没有 pytest 的配置,明天会加)。`collected 3 items` 是收集到 3 个用例,正好是我们写的三个 `test_` 函数。

`part01/test_cost.py ...` 后面三个点,每个点代表一个通过的用例,按顺序排。最后一行 `3 passed in 0.04s`,全绿,0.04 秒。

想看每个用例的名字,加 `-v`(verbose,详细):

```bash
uv run pytest part01/test_cost.py -v
```

实跑输出里中间那段变成了:

```text
part01/test_cost.py::test_input_only PASSED                              [ 33%]
part01/test_cost.py::test_output_only PASSED                             [ 66%]
part01/test_cost.py::test_real_call PASSED                               [100%]
```

`文件路径::函数名` 这种写法叫 **node id**,是每个用例的唯一编号,明天会用它来只跑某一个测试。反过来,`-q`(quiet,安静)会把开头那几行也省掉,只剩 `...` 和 `3 passed in 0.03s`,测试多了以后我平时用 `-q`。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="pytest 从收集到报告的流程">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="30" width="130" height="44" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
<text x="85" y="50" text-anchor="middle" fill="var(--ink)">uv run pytest</text>
<text x="85" y="66" text-anchor="middle" fill="var(--ink-soft)">part01/</text>
<line x1="150" y1="52" x2="180" y2="52" stroke="var(--rule)" stroke-width="2"/>
<rect x="180" y="30" width="130" height="44" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
<text x="245" y="50" text-anchor="middle" fill="var(--ink)">找 test_*.py</text>
<text x="245" y="66" text-anchor="middle" fill="var(--ink-soft)">收集文件</text>
<line x1="310" y1="52" x2="340" y2="52" stroke="var(--rule)" stroke-width="2"/>
<rect x="340" y="30" width="130" height="44" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
<text x="405" y="50" text-anchor="middle" fill="var(--ink)">找 def test_*</text>
<text x="405" y="66" text-anchor="middle" fill="var(--ink-soft)">collected 3 items</text>
<line x1="470" y1="52" x2="500" y2="52" stroke="var(--rule)" stroke-width="2"/>
<rect x="500" y="30" width="120" height="44" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="560" y="50" text-anchor="middle" fill="var(--ink)">逐个调用</text>
<text x="560" y="66" text-anchor="middle" fill="var(--ink-soft)">你的测试函数</text>
<line x1="560" y1="74" x2="560" y2="110" stroke="var(--rule)" stroke-width="2"/>
<rect x="430" y="110" width="190" height="40" fill="var(--paper-raised)" stroke="var(--rule)" rx="4"/>
<text x="525" y="134" text-anchor="middle" fill="var(--ink)">assert 条件</text>
<line x1="470" y1="150" x2="380" y2="185" stroke="var(--rule)" stroke-width="2"/>
<line x1="580" y1="150" x2="580" y2="185" stroke="var(--rule)" stroke-width="2"/>
<rect x="250" y="185" width="200" height="44" fill="var(--paper-raised)" stroke="var(--rule)" rx="4"/>
<text x="350" y="205" text-anchor="middle" fill="var(--ink)">为真 → 打印 .</text>
<text x="350" y="221" text-anchor="middle" fill="var(--ink-soft)">什么都不发生</text>
<rect x="470" y="185" width="150" height="44" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="545" y="205" text-anchor="middle" fill="var(--ink)">为假 → 打印 F</text>
<text x="545" y="221" text-anchor="middle" fill="var(--ink-soft)">记下左右两边的值</text>
<text x="20" y="130" fill="var(--ink-soft)">一个用例失败</text>
<text x="20" y="148" fill="var(--ink-soft)">不影响下一个用例</text>
<text x="20" y="205" fill="var(--ink-soft)">全部跑完后</text>
<text x="20" y="223" fill="var(--ink-soft)">统一打印 FAILURES</text>
</g>
</svg>
<figcaption>pytest 做的事:按命名约定找到文件和函数,一个个调用,每个函数里的 assert 决定这个用例是 . 还是 F,最后统一汇报。</figcaption>
</figure>

## 第 5 步:故意让一个测试失败,学会读报告

测试真正有用的时候是它变红的时候,所以失败报告一定要会读。把 `test_output_only` 的期望值从 `4.0` 改成 `3.0`(模拟你心算错了),再跑:

```bash
uv run pytest part01/test_cost.py
```

实跑输出:

```text
============================= test session starts ==============================
platform darwin -- Python 3.12.13, pytest-9.1.1, pluggy-1.7.0
rootdir: /Users/你/agent-zero-lab
configfile: pyproject.toml
collected 3 items

part01/test_cost.py .F.                                                  [100%]

=================================== FAILURES ===================================
_______________________________ test_output_only _______________________________

    def test_output_only():
>       assert total_cost(0, 500_000, 2.0, 8.0) == 3.0
E       assert 4.0 == 3.0
E        +  where 4.0 = total_cost(0, 500000, 2.0, 8.0)

part01/test_cost.py:10: AssertionError
=========================== short test summary info ============================
FAILED part01/test_cost.py::test_output_only - assert 4.0 == 3.0
========================= 1 failed, 2 passed in 0.06s ==========================
```

从上往下读:

- `.F.`:第一个过、第二个挂、第三个过。第二个失败了,第三个照样跑了,这就是比裸 `assert` 脚本强的第一点。
- `FAILURES` 下面每个失败用例一块,标题是函数名 `test_output_only`。
- `>` 开头的那一行是出错的那行代码。
- `E` 开头的是 pytest 的解释。`assert 4.0 == 3.0` 告诉你左边实际算出来 4.0,右边你写的 3.0。下一行 `where 4.0 = total_cost(0, 500000, 2.0, 8.0)` 更进一步,说明 4.0 是这次函数调用的返回值。这是比裸 `assert` 强的第二点:你没写任何说明文字,它自己把值摆出来了。
- `part01/test_cost.py:10` 是文件和行号。
- 最底下 `short test summary info` 是一行一个失败的速查清单,测试多的时候先看这里。

pytest 怎么知道左边是 4.0?它在导入测试文件之前把文件里的 `assert` 语句改写了一遍(这个机制叫 **断言改写**,assertion rewriting),改写后的代码会把比较两边的中间值记下来。你写的还是普通 `assert`,它在背后帮你加了「记录」。这也是为什么 pytest 不需要 `expect().toBe()` 那一套 API。

看完把 `3.0` 改回 `4.0`。

另外留意终端最后的退出码:全部通过时 `uv run pytest` 的退出码是 0,有失败时是 1。退出码在 [Day 7](/blog/agent-zero/day-007-terminal-4/) 前后提过,后面讲 CI(自动在服务器上跑测试)时,CI 就是看这个数字决定打勾还是打叉。

## 第 6 步:让测试抓一个真 bug

刚才是测试写错了。更常见的是代码写错了。我模拟一个很容易犯的错:把 `cost.py` 里两个单价乘反了,输入乘了输出价,输出乘了输入价。

```python
# agent-zero-lab/part01/cost.py(故意写错的版本,看完改回去)
def total_cost(prompt_tokens: int, completion_tokens: int, price_in: float, price_out: float) -> float:
    """算一次模型调用花多少钱。单价单位:元 / 百万 token。"""
    return (prompt_tokens * price_out + completion_tokens * price_in) / 1_000_000
```

<div class="line-notes">

- `return (prompt_tokens * price_out + completion_tokens * price_in) / 1_000_000` 这就是 bug:`price_in` 和 `price_out` 位置对调了。肉眼看这一行很难发现,参数名都对,只是配错了对。

</div>

不改测试,直接再跑一次 `uv run pytest part01/test_cost.py`,实跑输出的末尾:

```text
part01/test_cost.py FFF                                                  [100%]
...(中间是三块 FAILURES,省略)
=========================== short test summary info ============================
FAILED part01/test_cost.py::test_input_only - assert 8.0 == 2.0
FAILED part01/test_cost.py::test_output_only - assert 1.0 == 4.0
FAILED part01/test_cost.py::test_real_call - assert 0.000122 == 0.000248
============================== 3 failed in 0.08s ===============================
```

三个全红。代入看一下 `test_input_only`:100 万输入 token 乘了输出价 8.0,得到 8.0,期望 2.0。`test_real_call`:`(8×8.0 + 29×2.0) / 1_000_000 = 122 / 1_000_000 = 0.000122`。这些数字一出来,你几乎不用看代码就能猜到「输入输出价格配反了」。

这就是测试的价值。如果没有测试,这个函数会悄悄少算你的钱(大部分调用输出 token 比输入多,算出来的花费会偏低),你可能一个月后对账才发现。看完把 `cost.py` 改回第 1 步的正确版本,再跑一次确认 `3 passed`。

## 第 7 步:小数别用 ==,用 pytest.approx

[Day 12](/blog/agent-zero/day-012-numbers/) 见过 `0.1 + 0.2` 不等于 `0.3`。算钱的代码天天跟小数打交道,这个坑在测试里一定会撞上。场景:两次调用,一次 5 万输入 token,一次 10 万输入 token,加起来的花费应该是 0.3 元。

```python
# agent-zero-lab/part01/test_sum.py
import pytest

from part01.cost import total_cost


def test_two_calls_exact():
    a = total_cost(50_000, 0, 2.0, 8.0)
    b = total_cost(100_000, 0, 2.0, 8.0)
    assert a + b == 0.3


def test_two_calls_approx():
    a = total_cost(50_000, 0, 2.0, 8.0)
    b = total_cost(100_000, 0, 2.0, 8.0)
    assert a + b == pytest.approx(0.3)
```

<div class="line-notes">

- `import pytest` 要用 pytest 提供的工具函数 `approx` 了,所以这次要导入。导入顺序习惯是标准库和第三方库在前、自己的代码在后,中间空一行。
- `a = total_cost(50_000, 0, 2.0, 8.0)` `50_000 × 2.0 / 1_000_000 = 0.1`。实测 `a` 是 `0.1`。
- `b = total_cost(100_000, 0, 2.0, 8.0)` 实测 `b` 是 `0.2`。
- `assert a + b == 0.3` 实测 `a + b` 是 `0.30000000000000004`,和 `0.3` 差了一点点,`==` 判为不相等,这个用例会失败。
- `def test_two_calls_approx():` 同样的数据,换一种比法。
- `assert a + b == pytest.approx(0.3)` `pytest.approx(0.3)` 生成一个「约等于 0.3」的对象,默认允许百万分之一的相对误差(0.3 的百万分之一是 3e-7)。`0.30000000000000004` 和 0.3 的差远小于这个范围,判为相等。相当于 Jest 的 `toBeCloseTo`。

</div>

```bash
uv run pytest part01/test_sum.py
```

实跑输出(只留中间部分):

```text
part01/test_sum.py F.                                                    [100%]

=================================== FAILURES ===================================
_____________________________ test_two_calls_exact _____________________________

    def test_two_calls_exact():
        a = total_cost(50_000, 0, 2.0, 8.0)
        b = total_cost(100_000, 0, 2.0, 8.0)
>       assert a + b == 0.3
E       assert (0.1 + 0.2) == 0.3

part01/test_sum.py:10: AssertionError
```

有个细节挺坑人:报告里写的是 `assert (0.1 + 0.2) == 0.3`,看上去「明明相等啊」。pytest 打印的是 `a` 和 `b` 各自的值,没把它们的和 `0.30000000000000004` 打出来。所以以后看到一个比小数的断言失败、两边看着一样,第一反应就是浮点误差,换 `pytest.approx`。

我的习惯是:只要期望值是小数,一律用 `pytest.approx`,不去赌这次运气好不好。第 4 步那个 `== 0.000248` 能过纯属巧合,写成 `== pytest.approx(0.000248)` 更稳。整数和字符串照常用 `==`。

演示完把 `test_sum.py` 删掉(`rm part01/test_sum.py`),它的任务已经完成了。

## 第 8 步:命名不对,pytest 就看不见

pytest 的「自动收集」全靠名字,名字错了它不报错,只是不跑。这个坑我第一次学的时候踩过,以为测试都过了,其实一个都没跑。

先把文件名改掉,让它不再以 `test_` 开头,然后让 pytest 在整个 `part01/` 目录里找:

```bash
mv part01/test_cost.py part01/x_cost.py
uv run pytest part01 -q
echo $?
mv part01/x_cost.py part01/test_cost.py
```

<div class="line-notes">

- `mv part01/test_cost.py part01/x_cost.py` 改名,文件名不再以 `test_` 开头。
- `uv run pytest part01 -q` 给的是一个目录,pytest 会在里面找所有 `test_*.py` 和 `*_test.py`。
- `echo $?` 打印上一条命令的退出码。
- `mv part01/x_cost.py part01/test_cost.py` 改回来。

</div>

实跑输出:

```text
no tests ran in 0.01s
5
```

`no tests ran`,退出码是 5(pytest 规定 5 表示「一个测试都没收集到」)。没有红字,很容易忽略过去。

函数名也一样。如果你写成 `def check_output_only():`,pytest 收集时直接跳过,`collected` 的数字会比你写的函数少一个。所以我跑测试时会扫一眼 `collected N items` 或者结尾 `N passed` 的数字,和自己写了几个对一对。

还有一个不太直观的地方:如果你在命令行里**直接点名**一个文件,比如 `uv run pytest part01/cost_check.py`,即使文件名不以 `test_` 开头,pytest 也会去收集它里面的 `test_` 函数(我实测过,`1 passed`)。命名约定管的是「给一个目录让它自己找」的情况。为了不踩坑,文件名老老实实用 `test_` 开头。

## 今天的成果

到这里,`part01/` 里和今天有关的文件是:

| 文件 | 作用 | 今天结束时的状态 |
| --- | --- | --- |
| `part01/cost.py` | 被测代码,`total_cost` | 第 1 步的正确版本 |
| `part01/test_cost.py` | 三个测试用例 | `3 passed` |
| `part01/assert_demo.py` | 演示裸 `assert` | 留着,第二条故意失败 |

明天会把 `test_cost.py` 挪到专门的 `tests/` 目录,到时候会撞上一个经典报错。

## 动手练习

**练习 1:补一个「零 token」用例。** 在 `part01/test_cost.py` 里加一个测试,验证输入输出都是 0 时花费是 0。跑一遍,确认变成 `4 passed`。

<details><summary>参考答案</summary>

在 `test_cost.py` 末尾加:

```python
# agent-zero-lab/part01/test_cost.py(末尾追加)
def test_zero_tokens():
    assert total_cost(0, 0, 2.0, 8.0) == 0
```

<div class="line-notes">

- `def test_zero_tokens():` 名字说清楚测什么。边界值(0、空、最大值)是最值得写测试的地方。
- `assert total_cost(0, 0, 2.0, 8.0) == 0` 函数返回 `(0 + 0) / 1_000_000 = 0.0`。`0.0 == 0` 在 Python 里是 `True`,浮点 0 和整数 0 相等,这里用 `==` 没问题,因为 0 能被浮点数精确表示。

</div>

```bash
uv run pytest part01/test_cost.py -q
```

实跑输出:

```text
....                                                                     [100%]
4 passed in 0.03s
```

</details>

**练习 2:三次调用加起来。** 一个用户和你的机器人聊了三轮,三次调用的 token 分别是 `(8, 29)`、`(1200, 350)`、`(3000, 800)`(输入, 输出)。新建 `part01/test_cost_more.py`,写一个测试验证三次加起来的总花费。先自己用纸笔算出期望值,再写断言。

<details><summary>参考答案</summary>

先算:第一次 `(8×2 + 29×8) / 1e6 = 248 / 1e6 = 0.000248`;第二次 `(1200×2 + 350×8) / 1e6 = (2400 + 2800) / 1e6 = 0.0052`;第三次 `(3000×2 + 800×8) / 1e6 = (6000 + 6400) / 1e6 = 0.0124`;合计 `0.000248 + 0.0052 + 0.0124 = 0.017848` 元。

我第一次写这道题时心算成了 0.017248,pytest 当场报错 `assert 0.017848 == 0.017248 ± 1.7e-08`,左边是实际值,右边是我写的期望值和允许误差。所以算完一定让测试替你复核。

```python
# agent-zero-lab/part01/test_cost_more.py
import pytest

from part01.cost import total_cost


def test_three_calls_sum():
    calls = [(8, 29), (1200, 350), (3000, 800)]
    total = sum(total_cost(p, c, 2.0, 8.0) for p, c in calls)
    assert total == pytest.approx(0.017848)
```

<div class="line-notes">

- `import pytest` 要用 `approx`。
- `def test_three_calls_sum():` 一个用例。
- `calls = [(8, 29), (1200, 350), (3000, 800)]` 一个装着三个元组的列表,每个元组是 `(输入, 输出)`。元组见 [Day 22](/blog/agent-zero/day-022-tuples-unpack/)。
- `total = sum(total_cost(p, c, 2.0, 8.0) for p, c in calls)` 括号里是生成器表达式,和 [Day 23](/blog/agent-zero/day-023-comprehensions/) 的列表推导式写法一样,只是没有方括号。`for p, c in calls` 每轮把元组解包成 `p` 和 `c`:第一轮 `p=8, c=29` 得 0.000248,第二轮得 0.0052,第三轮得 0.0124。`sum` 把它们加起来,实测是 `0.017848`。
- `assert total == pytest.approx(0.017848)` 三个小数相加,用 `approx` 比。实测这次 `total == 0.017848` 用 `==` 也恰好成立,但你不该依赖这个巧合。

</div>

```bash
uv run pytest part01/test_cost_more.py -v
```

实跑输出的中间一行:

```text
part01/test_cost_more.py::test_three_calls_sum PASSED                    [100%]
```

</details>

**练习 3:负数 token 应该报错。** token 数不可能是负数,传进来负数说明调用方有 bug。改 `part01/cost.py`,让 `total_cost` 在任一 token 数小于 0 时 `raise ValueError`([Day 36](/blog/agent-zero/day-036-exceptions-2/) 学过 `raise`)。然后在 `test_cost_more.py` 里写测试,验证「传负数一定会抛 ValueError」。提示:pytest 提供了 `with pytest.raises(异常类型):`,意思是「这个代码块里必须抛出这个异常」。

<details><summary>参考答案</summary>

`cost.py` 改成:

```python
# agent-zero-lab/part01/cost.py
def total_cost(prompt_tokens: int, completion_tokens: int, price_in: float, price_out: float) -> float:
    """算一次模型调用花多少钱。单价单位:元 / 百万 token。"""
    if prompt_tokens < 0 or completion_tokens < 0:
        raise ValueError(f"token 数不能是负数: {prompt_tokens}, {completion_tokens}")
    return (prompt_tokens * price_in + completion_tokens * price_out) / 1_000_000
```

<div class="line-notes">

- `if prompt_tokens < 0 or completion_tokens < 0:` 任一个是负数就进分支。`or` 是 [Day 17](/blog/agent-zero/day-017-if-else/) 的布尔运算,相当于 JS 的 `||`。
- `raise ValueError(f"token 数不能是负数: {prompt_tokens}, {completion_tokens}")` 用 f-string 把实际值写进错误信息。实测 `total_cost(-1, 0, 2.0, 8.0)` 抛出 `ValueError: token 数不能是负数: -1, 0`。
- `return (prompt_tokens * price_in` 正常路径不变,原来的三个测试照样能过。

</div>

`test_cost_more.py` 末尾加两个测试:

```python
# agent-zero-lab/part01/test_cost_more.py(末尾追加)
def test_negative_tokens_raise():
    with pytest.raises(ValueError):
        total_cost(-1, 0, 2.0, 8.0)


def test_negative_message():
    with pytest.raises(ValueError, match="不能是负数"):
        total_cost(0, -5, 2.0, 8.0)
```

<div class="line-notes">

- `def test_negative_tokens_raise():` 测「应该报错」的情况,这类用例和测正常值一样重要。
- `with pytest.raises(ValueError):` `with` 是 [Day 38](/blog/agent-zero/day-038-files-with/) 学的上下文管理器。这里的含义是:缩进块里必须抛出 `ValueError`,抛了,测试通过;没抛,测试失败。相当于 Jest 的 `expect(() => fn()).toThrow()`。
- `total_cost(-1, 0, 2.0, 8.0)` 第一个参数是 -1,进了 `if` 分支,抛出 `ValueError`,被 `pytest.raises` 接住,测试通过。
- `with pytest.raises(ValueError, match="不能是负数"):` 多一个 `match`,还要求错误信息里能搜到这段文字(它按正则搜索,中文普通文字不受影响)。这样能区分「抛对了异常」和「碰巧抛了个别的 ValueError」。
- `total_cost(0, -5, 2.0, 8.0)` 这次是输出 token 为负,错误信息是 `token 数不能是负数: 0, -5`,包含「不能是负数」。

</div>

```bash
uv run pytest part01 -v
```

实跑输出的中间部分:

```text
part01/test_cost.py::test_input_only PASSED                              [ 14%]
part01/test_cost.py::test_output_only PASSED                             [ 28%]
part01/test_cost.py::test_real_call PASSED                               [ 42%]
part01/test_cost.py::test_zero_tokens PASSED                             [ 57%]
part01/test_cost_more.py::test_three_calls_sum PASSED                    [ 71%]
part01/test_cost_more.py::test_negative_tokens_raise PASSED              [ 85%]
part01/test_cost_more.py::test_negative_message PASSED                   [100%]
```

最后一行 `7 passed`。为了确认这两个测试真的在把关,我把 `cost.py` 里那两行 `if ... raise` 删掉再跑,两个都红了,报的是:

```text
E       Failed: DID NOT RAISE ValueError
```

意思是「说好要抛 ValueError,结果没抛」。确认完把那两行加回去。

</details>

**练习 4(观察题):忘了写 assert 会怎样?** 在 `test_cost.py` 里临时加一个用例,里面写 `total_cost(0, 500_000, 2.0, 8.0) == 3.0`,**前面不写 assert**。跑一下,看它是过还是不过,想想为什么。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/test_cost.py(临时追加,看完删掉)
def test_forgot_assert():
    total_cost(0, 500_000, 2.0, 8.0) == 3.0
```

<div class="line-notes">

- `def test_forgot_assert():` 一个忘了写 `assert` 的用例。
- `total_cost(0, 500_000, 2.0, 8.0) == 3.0` 这一行会算出 `4.0 == 3.0`,得到 `False`,然后这个 `False` 就被扔掉了,没有任何东西去检查它。函数正常结束,pytest 认为通过。

</div>

实跑现象:这个用例显示 `PASSED`,明明期望值是错的。原因是 pytest 判断失败的唯一依据是「函数里有没有抛异常」,一个比较表达式算出 `False` 不会抛异常。所以写完一个新测试,我习惯先故意把期望值改错跑一次,看到它变红,才相信它真的在检查东西。看完删掉这个用例。

</details>

**验收标准:** `uv run pytest part01 -v` 显示 7 个用例全部 `PASSED`;你能指着一次失败报告说出哪一行是实际值、哪一行是期望值;你能说出为什么 `0.1 + 0.2` 要用 `pytest.approx` 比。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 测试(test) | 一段调用你的代码并检查结果的代码,比如 `test_input_only` |
| 单元测试(unit test) | 只测一个小函数、不碰网络和数据库的测试,今天写的都是 |
| 断言(assertion) | 「这里必须成立」的检查,Python 用 `assert` 语句写 |
| `assert` | Python 关键字,条件为假时抛 `AssertionError`,为真时什么都不做 |
| `AssertionError` | `assert` 失败时抛出的异常类型 |
| pytest | Python 最常用的测试框架,作用相当于 Jest / Vitest |
| 开发依赖(dev dependency) | 只在开发和测试时用的包,`uv add --dev` 装,≈ npm 的 devDependencies |
| 用例(test case) | 一个 `test_` 开头的函数就是一个用例 |
| 收集(collect) | pytest 按命名约定找出所有测试文件和测试函数的过程 |
| node id | 用例的唯一编号,格式 `文件路径::函数名` |
| 断言改写(assertion rewriting) | pytest 导入测试文件时改写 `assert`,好在失败时打印两边的值 |
| `pytest.approx` | 「约等于」比较,专门用来比小数 |
| `pytest.raises` | 断言一段代码必须抛出某个异常 |
| 退出码(exit code) | 程序结束时返回给终端的数字,pytest 全过是 0、有失败是 1、没收集到测试是 5 |
| docstring | 函数第一行的三引号字符串,用来写说明 |

## 常见误区

**忘写 `assert`,测试永远是绿的。** 练习 4 演示过:`x == 3.0` 单独一行只是算出一个布尔值,不会失败。写完新测试先故意改错期望值跑一次,看到 `F` 再改回来。

**给 assert 加了括号,也永远是绿的。** 有人习惯写 `assert (结果 == 期望, "说明")`,以为是函数调用。括号里有逗号,Python 把它当成一个元组,非空元组永远为真。我实测 pytest 9.1.1 会给出警告 `PytestAssertRewriteWarning: assertion is always true, perhaps remove parentheses?`,同时把这个用例算作通过。警告在输出末尾的 `warnings summary` 里,很容易被忽略。正确写法是 `assert 结果 == 期望, "说明"`,不加括号。

**两个小数用 `==` 比。** 浮点数加减乘除后常带一点误差,`0.1 + 0.2` 实测是 `0.30000000000000004`。期望值是小数时一律 `pytest.approx`。更麻烦的是 pytest 的报告可能显示 `assert (0.1 + 0.2) == 0.3`,看着像是对的。

**文件名或函数名没以 `test_` 开头。** pytest 不报错,只是不跑,输出 `no tests ran`,退出码 5。对一下 `collected N items` 的数字。

**在生产代码里用 `assert` 做校验。** 比如在 `total_cost` 里写 `assert prompt_tokens >= 0` 来拦负数。问题是 Python 用 `-O` 参数运行时会把所有 `assert` 直接删掉。我实测 `uv run python -O -m part01.assert_demo`,那条故意写错的断言被跳过了,两行「过了」都打印了出来。`assert` 只写在测试里;业务代码里要拦错误,用 `if ...: raise ValueError(...)`,就像练习 3 那样。

**不在仓库根目录跑。** 如果你 `cd part01` 进去再 `uv run pytest test_cost.py`,`from part01.cost import ...` 这一类导入在不同目录下行为不一样,容易出现找不到模块的报错。明天专门讲这个问题,今天先记住永远从根目录跑。

**一个用例里塞十几条断言。** 一个用例只要有一条失败,后面的就不执行了,你只能看到第一个错误。一个用例测一件事,名字写清楚测什么,红了一眼就知道是哪块逻辑。

## 学习资料

### 文档与文章

- [pytest 官方文档 · Get Started](https://docs.pytest.org/en/stable/getting-started.html):安装、第一个测试、`pytest.raises`,今天的内容基本都在这一页,英文但很短。
- [pytest 官方文档 · How to write and report assertions in tests](https://docs.pytest.org/en/stable/how-to/assert.html):`assert` 改写、`approx`、`raises` 的完整说明,读前半部分就够。
- [Python 官方文档(中文)· 简单语句 · assert 语句](https://docs.python.org/zh-cn/3/reference/simple_stmts.html):`assert` 的正式定义,里面写了 `-O` 时断言会被移除。
- [uv 文档 · Managing dependencies](https://docs.astral.sh/uv/concepts/projects/dependencies/):`--dev` 和 `[dependency-groups]` 的说明。
- [DeepSeek 模型价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):今天例子里单价的出处,价格会变,用之前自己再查一次。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1SP4y1D7Wd&autoplay=0&high_quality=1" title="Python单元测试-01.单元测试基础" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>跟峰哥学编程 · Python单元测试-01.单元测试基础 · 31 分钟。讲单元测试是什么、为什么要写,用的是标准库 unittest,看前 15 分钟建立概念就行,写法以今天的 pytest 为准。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1bY411y7dv&autoplay=0&high_quality=1" title="Python单元测试-08.PyTest框架" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>跟峰哥学编程 · Python单元测试-08.PyTest框架 · 21 分钟。同一个系列里专讲 pytest 的一集,和今天的内容最对口,重点看 assert 和失败报告那段。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/EgpLj86ZHFQ" title="Please Learn How To Write Tests in Python… • Pytest Tutorial" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Tech With Tim · Please Learn How To Write Tests in Python… • Pytest Tutorial · 英文,节奏快,前半段讲 assert 和第一个测试,后半段的 fixture 留到 Day 73 再看。</figcaption>
</figure>

### 书籍

- Brian Okken,《Python Testing with pytest》第 2 版,Pragmatic Bookshelf,2022。pytest 维护者圈子公认的入门书,第 1 章「Getting Started with pytest」对应今天。我没查到简体中文版,只推荐英文原版。

### 开源项目与代码

- [pytest-dev/pytest](https://github.com/pytest-dev/pytest):pytest 本身。现在不用读源码,看看 README 里的那个最小例子,和今天写的几乎一样。
- [encode/httpx 的 tests 目录](https://github.com/encode/httpx/tree/master/tests):[Day 64](/blog/agent-zero/day-064-httpx-1/) 用过的 httpx 的测试,点开任意一个 `test_*.py`,能看到大量 `assert response.status_code == 200` 这种写法。

## 自测

1. `assert 1 + 1 == 3, "算错了"` 执行后会发生什么?

<details><summary>答案</summary>

`1 + 1 == 3` 为 `False`,抛出 `AssertionError: 算错了`。如果条件为真,这一行什么都不做。

</details>

2. pytest 怎么知道哪些函数是测试?需要像 Jest 一样调用 `test()` 注册吗?

<details><summary>答案</summary>

不需要注册。文件名以 `test_` 开头(或 `_test.py` 结尾)、函数名以 `test_` 开头,pytest 就自动收集。名字不符合约定时它不会报错,只会不跑。

</details>

3. 跑完看到 `part01/test_cost.py .F.`,是什么意思?

<details><summary>答案</summary>

这个文件里收集到 3 个用例,按顺序第 1 个通过、第 2 个失败、第 3 个通过。第 2 个失败不影响第 3 个继续跑。

</details>

4. 失败报告里 `E       assert 4.0 == 3.0` 下面一行是 `E        +  where 4.0 = total_cost(0, 500000, 2.0, 8.0)`,这两行分别告诉了你什么?

<details><summary>答案</summary>

第一行:断言左边实际值是 4.0,右边期望值是 3.0。第二行:4.0 是 `total_cost(0, 500000, 2.0, 8.0)` 这次调用的返回值。pytest 通过断言改写把这些中间值记录了下来。

</details>

5. 为什么 `assert total_cost(50_000, 0, 2.0, 8.0) + total_cost(100_000, 0, 2.0, 8.0) == 0.3` 会失败?该怎么改?

<details><summary>答案</summary>

两次花费分别是 0.1 和 0.2,浮点相加得 `0.30000000000000004`,和 0.3 不严格相等。改成 `== pytest.approx(0.3)`,允许极小的相对误差(默认百万分之一)。

</details>

6. 同事在业务代码里写 `assert amount > 0` 来拦负数金额,你会怎么建议?

<details><summary>答案</summary>

改成 `if amount <= 0: raise ValueError(...)`。`assert` 在 `python -O` 下会被整句删除,校验就悄悄失效了;`assert` 只适合写在测试里。

</details>

## 明天预告

Day 72 · pytest(二):pythonpath、目录结构和只跑一个测试。今天的测试文件和被测代码放在同一个 `part01/` 目录里,正规项目会把测试统一放进 `tests/` 目录。挪过去的那一刻会撞上 `ModuleNotFoundError: No module named 'part01'`,这是新手问得最多的 pytest 报错之一。明天弄清楚 pytest 是怎么找模块的,在 `pyproject.toml` 里一行配置修好它,再学会测试多了以后怎么只跑其中一个。
